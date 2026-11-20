/* ============================================================
   schedule/rules.js
   規則與狀態：常數、每月狀態 S 的讀寫與一次性補寫、月曆快取、
   假別／指班／週律的展開、每日人力需求 demand()。
   不碰 DOM。載入順序：rules.js → solver.js → ui.js（皆為全域 script）。
============================================================ */

/* ============================================================
   自動排班 — 限制條件求解器（模擬退火＋交換移動＋最陡下降修復）
   規則：
   0. 店長（職級＝店長）不做業績、只算上班人頭：與大家同一張班表
      （排第一列），但不計入「業務人數」與任何人力規則；班別＝
      前一天休假→晚班、前一天有上班→中班（週日固定上班、週一
      自然為中班）；Liv/Demi 同天都休時店長補晚班鎮店
   1. 每人每月正常休假 10 天（可調）；BL/AL 特殊假另外加，不佔額度
   2. 假日（週六日＋國定假日）每人休 2–3 天（>3 違規、<2 提醒；
      BL/AL 特殊假若落在假日，也計入此限制；店長不受此限）
   3. 人力下限（不含規則外人力）：平日至少 4 人、假日至少 5 人
   4. 每天固定「早 1、中 1」，其餘全部排晚班：
      週五/六/日（含國定假日）晚班至少 3 人、週一～週四晚班至少 2 人。
      晚班人數是下限不是上限 — 當天人力有多的就加開晚班，不算違規
   5. 晚班鎮店：Wiggie/Liv/Demi 每天至少一人晚班；Wiggie 沒上晚班
      時由 Liv、Demi 輪流補位（三人可同時晚班）
   6. 週一早班盡量從前一天（週日）晚班的人挑；其中「週二剛好休假」
      者最優先（晚→早→休 補償輪轉，軟性偏好）
   7. 連上偏好（軟性，喜好不強迫）：Liv/Demi 喜歡做一休一（休假盡量
      打散）；其他人不喜歡做一休一（傾向連上 2–3 天）；連四重罰、
      連五禁止（硬）
   8. 早班天數各人差距 ≤ ±1（店長/Demi 不計；Demi 減少排早班）
   9. 管理職互斥：三人不可同天全休（或最嚴格：任兩人不可同休）；
      Liv、Demi 不可同一個週一都休（避免店長被迫週一鎮晚班）
   10. 指休、BL/AL、週律（固定休／固定班）為硬條件
   11. 出差＝當日不在店：不排班、不佔休假額度、不計每日人力，
       格子顯示「出差」（Excel 匯出對應 OL 公假代碼）
   12. 指班＝指定某日必須上某時段（早/中/晚）：硬條件，格子顯示
       「指班」字樣（指早/指中/指晚）
============================================================ */
const DOW = ['日','一','二','三','四','五','六'];
const SHIFT_NAME = ['早','中','晚','休','出差','—'];   /* 5 = 未到職／已離職（不在職）；體檢訊息用 */
/* 畫面顯示用的公司班別代號（與 Excel 一致）：A 早、M 中、P 晚、RL 例假（週末／國定假日）、RL/ 休假（平日）、OL 出差 */
const SHIFT_CODE = ['A','M','P','RL','OL','—'];
function cellCode(s, d, restFn){
  if (s === 3) return (restFn ? restFn(d) : isRest(d)) ? 'RL' : 'RL/';
  return SHIFT_CODE[s] || '';
}
const ROLES = ['店長','Sup','SSA','SA'];
const LS_KEY = 'mk-scheduler-v2';

function defaultState(){
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth()+1, 1);
  return {
    month: `${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}`,
    staff: [
      { name:'Wiggie', role:'店長', quota:10, week:{ 0:'work', 1:'work', 2:'off' } },
      { name:'Liv',    role:'Sup', quota:10, week:{} },
      { name:'Demi',   role:'SSA', quota:10, week:{} },
      { name:'Yvette', role:'SA',  quota:10, week:{} },
      { name:'Alvin',  role:'SA',  quota:10, week:{} },
      { name:'Kai',    role:'SA',  quota:10, week:{} },
      { name:'Bailey', role:'SA',  quota:10, week:{} },
      { name:'Vina',   role:'SA',  quota:10, week:{} },
      /* 柏鴻：週三、週五、週日固定上早班（必上班且必早班） */
      { name:'柏鴻',   role:'SA',  quota:10, extra:true, week:{ 0:'morn', 3:'morn', 5:'morn' } },
    ],
    trio: ['Wiggie','Liv','Demi'],
    trioMode: 'all3',
    holidays: {},
    fixed: {},      // {'YYYY-MM': {staffIdx:[days]}} 手動指休
  };
}
function normalize(s){
  s.staff.forEach(p => { if (!p.role) p.role = 'SA'; if (!p.week) p.week = {}; });
  if (!s.trioMode) s.trioMode = 'all3';
}
function saveState(){ invalidateParams(); try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch(e){} if (typeof cloudMarkDirty === 'function') cloudMarkDirty(); }
function loadState(){ try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch(e){ return null; } }

/* ---------- 一次性資料補寫 ----------
   店長的設定存在自己的瀏覽器，改 defaultState() 只影響全新的裝置，
   已經有存檔的機器不會拿到新資料。這裡替「規則已經談定、但舊存檔還沒有」
   的內容做一次性補寫：每則以 id 記在 S.migrations，同一台裝置只跑一次，

   之後店長自己改動不會被蓋回去。新增一則就在下面加一個 key。 */
const MIGRATIONS = {
  /* 2026-09：新夥伴柏鴻進來、9/25–28 連假、九月 AL 天數 */
  '2026-09-setup'(){
    if (!S.staff.some(p => p.name === '柏鴻'))
      S.staff.push({ name:'柏鴻', role:'SA', quota:10, week:{ 0:'morn', 3:'morn', 5:'morn' } });

    /* 9/25（五）、9/28（一）補進國定假日；26、27 本來就是週末不用加 */
    if (!S.holidays) S.holidays = {};
    const holi = new Set(S.holidays['2026-09'] || []);
    [25, 28].forEach(d => holi.add(d));
    S.holidays['2026-09'] = [...holi].sort((a,b) => a - b);

    /* AL：Demi 2 天、Vina 1 天、Wiggie 1 天，名單上其他人不安插。
       排除名單依當下實際名單算，店長改過名單也不會漏人。 */
    const days = { Demi:2, Vina:1, Wiggie:1 };
    if (!S.al) S.al = {};
    S.al['2026-09'] = { days, excluded: S.staff.map(p => p.name).filter(n => !(n in days)) };
  },

  /* 柏鴻改為「規則外額外人力」，跟店長一樣不計入每日早/中/晚人數。
     獨立成一則，讓已經跑過上一則的裝置也拿得到。 */
  '柏鴻-不計人力'(){
    const p = S.staff.find(x => x.name === '柏鴻');
    if (p) p.extra = true;
  },

  /* 2026-11：新進 Ruby 11/9 到職。11 月額度由系統依在職天數折算（10 × 22/30 ≈ 7）。
     插在 Vina 之後、額外人力之前。 */
  /* 2026-11-20 Vito：業績同仁 10 人，每天至少 6 人、最多 7 人（平日與假日相同）。
     寫進 S.params（＝規則設定頁的值），店長可再調。 */
  '人力6-7-2026-12'(){
    if (!S.params) S.params = {};
    Object.assign(S.params, { wdMin: 6, wdCap: 7, weMin: 6, weCap: 7, wdPref: 6 });
  },
  /* 2026-11-20 定案版：平日 5–6（5＝早1晚4、6＝早2晚4）、假日 7–8（早2中1其餘晚）、週五算平日。
     這些已成為程式預設，把先前補寫進 S.params 的舊值清掉，規則設定頁回到「全部預設」。 */
  '人力5-6_7-8-2026-11-20'(){
    if (!S.params) return;
    ['wdMin','wdCap','weMin','weCap','wdPref','wdEve','weEve','friAsWeekend'].forEach(k => delete S.params[k]);
    if (!Object.keys(S.params).length) delete S.params;
  },

  'Ruby-2026-11-09'(){
    if (S.staff.some(x => x.name === 'Ruby')) return;
    const p = { name:'Ruby', role:'SA', quota:10, week:{}, joined:'2026-11-09' };
    const at = S.staff.findIndex((x, idx) => idx > 0 && x.extra);
    if (at >= 0) S.staff.splice(at, 0, p); else S.staff.push(p);
  },
};
function runMigrations(){
  if (!Array.isArray(S.migrations)) S.migrations = [];
  let changed = false;
  for (const [id, apply] of Object.entries(MIGRATIONS)){
    if (S.migrations.includes(id)) continue;
    try { apply(); } catch(e){ console.warn('資料補寫失敗：' + id, e); continue; }
    S.migrations.push(id);
    changed = true;
  }
  if (changed) saveState();
}

/* ---------- month helpers ---------- */

function monthInfo(){
  const [y,m] = S.month.split('-').map(Number);
  return { y, m, days: new Date(y, m, 0).getDate(), firstDow: new Date(y, m-1, 1).getDay() };
}
/* 月曆快取：dowOf/isRest 在求解器內每秒被呼叫數十萬次，每次 new Date 與重建 Set 是主要耗時。
   以「月份＋國定假日清單」為 key 快取，任一項改變就自動重算，行為完全相同。 */
let CAL_KEY = '', CAL = null;
function cal(){
  const key = S.month + '|' + (S.holidays[S.month] || []).join(',');
  if (key !== CAL_KEY){
    const { y, m, days } = monthInfo();
    const holi = new Set(S.holidays[S.month] || []);
    const dow = new Array(days+2).fill(0), rest = new Array(days+2).fill(false);
    for (let d=1; d<=days; d++){ dow[d] = new Date(y, m-1, d).getDay(); rest[d] = dow[d]===0 || dow[d]===6 || holi.has(d); }
    CAL = { dow, rest, holi }; CAL_KEY = key;
  }
  return CAL;
}
const dowOf = d => { const c = cal(); return c.dow[d] !== undefined ? c.dow[d] : new Date(monthInfo().y, monthInfo().m-1, d).getDay(); };
const holiSet = () => cal().holi;
const isRest = d => { const c = cal(); return c.rest[d] !== undefined ? c.rest[d] : false; };
const isFri = d => dowOf(d) === 5;

const manualFixed = i => new Set((S.fixed[S.month]||{})[i] || []);
/* 特殊假：{day: 'BL'|'AL'|'OL'}，皆不佔正常休假額度、不計每日人力 */
const specialOf = i => ((S.special||{})[S.month]||{})[i] || {};
const specialSet = i => new Set(Object.keys(specialOf(i)).map(Number));
/* 週律展開 */
function weeklyDays(i, kind){
  const { days } = monthInfo();
  const w = S.staff[i].week || {};
  const out = new Set();
  for (let d=1; d<=days; d++) if (w[dowOf(d)] === kind) out.add(d);
  return out;
}
/* 固定休 = 手動指休 + BL/AL + 週律休；固定班 = 週律班（不可休） */
function fixedOf(i){
  const s = new Set(manualFixed(i));
  for (const d of weeklyDays(i,'off')) s.add(d);
  for (const d of specialSet(i)) s.add(d);
  return s;
}
/* 出差：當日不在店 — 不排班、不佔休假額度、不計入當日人力 */
const bizOf = i => new Set((((S.biz||{})[S.month])||{})[i] || []);
/* 指班：指定某日必須上某時段 {day: 0早|1中|2晚}（硬條件） */
const assignOf = i => (((S.assign||{})[S.month])||{})[i] || {};
/* 週律固定早班（week[dow] === 'morn'）：該星期幾「必須上班且必須早班」。
   展開成與「指班・早」完全等價的硬條件；同一天若另有手動指班，以手動指班為準。 */
function effAssign(i){
  const out = {};
  for (const d of weeklyDays(i,'morn')) out[d] = 0;
  return Object.assign(out, assignOf(i));
}
/* 是否為「週律固定早班」員工 — 早班次數天生遠高於他人，不納入早班平衡 */
const mornFixed = i => Object.values(S.staff[i].week || {}).includes('morn');
/* 不可休 = 週律固定班 + 週律固定早班 + 出差 + 指班 */
function blockedOf(i){
  const s = weeklyDays(i,'work');
  for (const d of bizOf(i)) s.add(d);
  for (const d of absentOf(i)) s.add(d);
  for (const d of Object.keys(effAssign(i)).map(Number)) s.add(d);
  return s;
}
/* 到職／離職：staff.joined / staff.left = 'YYYY-MM-DD'（可空）。
   當月不在職的日子 → 不排班、不佔額度、不計人力、不算連上，格子顯示「—」。 */
function absentOf(i){
  const p = S.staff[i], { y, m, days } = monthInfo();
  const out = new Set();
  const parse = s => { const mm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return mm ? { y:+mm[1], m:+mm[2], d:+mm[3] } : null; };
  const j = parse(p.joined), l = parse(p.left);
  for (let d=1; d<=days; d++){
    const key = y*10000 + m*100 + d;
    if (j && key < j.y*10000 + j.m*100 + j.d) out.add(d);
    if (l && key > l.y*10000 + l.m*100 + l.d) out.add(d);
  }
  return out;
}
/* 本月正常休假額度：到職／離職月份依在職天數比例折算（四捨五入），可用 S.quotaOv[月][姓名] 覆寫 */
function quotaFor(i){
  const p = S.staff[i];
  const ov = ((S.quotaOv||{})[S.month]||{})[p.name];
  if (Number.isInteger(ov)) return ov;
  const { days } = monthInfo();
  const abs = absentOf(i).size;
  if (!abs) return p.quota;
  if (abs >= days) return 0;
  return Math.round(p.quota * (days - abs) / days);
}
/* 總休假目標 = 本月額度 + 特殊假天數 */
const totalQuota = i => quotaFor(i) + specialSet(i).size;

/* 店長 = 規則外額外人力：照樣排班，但不計入任何每日人力數量規則、
   早班平衡與假日休 2–3 天限制（額度、週律、連五禁止仍適用） */
/* 規則外的額外人力：店長一律不計；其他人可在員工表勾「不計人力」（p.extra）。
   這些人照樣上班、照樣算休假額度，但不計入每日早/中/晚人數，也不參與班別平衡。 */
const exemptSet = () => new Set(S.staff.map((p,i) => (p.role === '店長' || p.extra) ? i : -1).filter(i => i >= 0));

/* 每日需求（以「規則內」員工計，店長與額外人力不計數）— 見下方 PARAMS_DEFAULT 與 demand() */
/* ---------- 可調參數（Step① 規則設定；存在 S.params，雲端同步） ---------- */
/* 2026-11-20 Vito 定案：平日（含週五）5–6 人，5 人＝早1晚4、6 人＝早2晚4，不排中班；
   假日（六日＋國定假日）7–8 人，早2中1其餘晚。 */
const PARAMS_DEFAULT = Object.freeze({
  wdMin: 5,  wdCap: 6,                           /* 平日：最少、上限 */
  wdMornLow: 1, wdMornHigh: 2, wdMid: 0,         /* 平日：人數＝下限時早班數、人數多於下限時早班數、中班數 */
  weMin: 7,  weCap: 8,                           /* 假日：最少、上限 */
  weMorn: 2, weMid: 1,                           /* 假日：早班數、中班數（其餘晚班） */
  friAsWeekend: false,                           /* 週五人力比照假日 */
  restMin: 2, restMax: 3,                        /* 假日休天數範圍 */
  maxRun: 4,                                     /* 連上上限（超過＝硬違規） */
  demiGap: 3,                                    /* Demi 早班比其他人平均少幾天 */
  mornSpread: 1, shiftSpread: 3,                 /* 早班落差、中／晚班落差門檻 */
});
const PARAM_META = [
  ['wdMin','平日 最少人數',1,12],['wdCap','平日 上限人數',1,12],['wdMornLow','平日 人數＝下限時 早班數',0,4],['wdMornHigh','平日 人數＞下限時 早班數',0,4],['wdMid','平日 中班數',0,4],
  ['weMin','假日 最少人數',1,12],['weCap','假日 上限人數',1,12],['weMorn','假日 早班數',0,4],['weMid','假日 中班數',0,4],
  ['restMin','假日休 至少（天）',0,10],['restMax','假日休 至多（天）',0,10],['maxRun','連上上限（天）',1,7],
  ['demiGap','Demi 早班少於平均（天）',0,10],['mornSpread','早班落差 ≤',0,10],['shiftSpread','中／晚班落差 ≤',0,15],
];
/* 求解器每秒讀參數數十萬次，快取一份；saveState／載入雲端時失效 */
let P_CACHE = null;
function P(){ if (!P_CACHE) P_CACHE = Object.assign({}, PARAMS_DEFAULT, S.params || {}); return P_CACHE; }
function invalidateParams(){ P_CACHE = null; }
/* 每日需求：min／cap 給休假分配用；shape(w) 依「當天實際上班人數」回傳 {m, mid, e} 給班別分配與體檢用 */
function demand(d){
  const p = P();
  const we = isRest(d) || (p.friAsWeekend && isFri(d));
  const min = we ? p.weMin : p.wdMin, cap = we ? p.weCap : p.wdCap;
  const shape = w => {
    let m = we ? p.weMorn : (w > p.wdMin ? p.wdMornHigh : p.wdMornLow);
    let mid = we ? p.weMid : p.wdMid;
    m = Math.max(0, Math.min(m, w)); mid = Math.max(0, Math.min(mid, w - m));
    return { m, mid, e: Math.max(0, w - m - mid) };
  };
  return { we, min, cap, shape };
}
/* 班型文字，例如「早2、中1、晚4」 */
const shapeText = sh => `早${sh.m}${sh.mid ? `、中${sh.mid}` : ''}、晚${sh.e}`;
/* ---------- 跨月連上：上月月底連上天數 ----------
   自動：讀已發布的上月班表（window.MK_SCHED_PUB，按姓名對應），從月底往回數上班天（早/中/晚/出差）。
   手動：S.prevRuns[本月][姓名] 覆寫（上月沒發布、或店長知道實況時用）。 */
function prevMonthId(){ const { y, m } = monthInfo(); const d = new Date(y, m-2, 1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }
function prevRunAuto(name){
  const pub = (typeof pubData === 'function' ? pubData() : (window.MK_SCHED_PUB || {}));
  const rec = pub[prevMonthId()];
  if (!rec || !Array.isArray(rec.staff) || !Array.isArray(rec.grid)) return null;   /* null = 上月沒資料 */
  const k = rec.staff.findIndex(s => s && s.name === name);
  if (k < 0 || !rec.grid[k]) return null;
  let n = 0;
  for (let d = rec.days; d >= 1; d--){ const s = rec.grid[k][d]; if (s === 0 || s === 1 || s === 2 || s === 4) n++; else break; }
  return n;
}
function prevRunOf(i){
  const name = S.staff[i].name;
  const ov = ((S.prevRuns || {})[S.month] || {})[name];
  if (Number.isInteger(ov) && ov >= 0) return ov;
  const auto = prevRunAuto(name);
  return auto == null ? 0 : auto;
}
/* 規則覆寫（Step① 規則設定）：S.rules[id] = { on, level, w }，沒設的用程式預設 */
function ruleCfg(c){ const o = (S.rules || {})[c.id] || {}; return { on: o.on !== false, level: o.level || c.level, w: Number.isFinite(o.w) ? o.w : c.w }; }

/* ---------- 全域狀態（三個檔案共用） ---------- */
let S = loadState() || defaultState();
normalize(S);
let RESULT = null;          /* 目前套用的班表 { grid, days, month, offScore } */
/* 自動排班產生的候選方案（最多 3 版）與目前套用的索引；只存在記憶體，重排即重算 */
let ALTS = [];
let ALT_SEL = 0;
let LOCKED = false;
let selPerson = 0;
