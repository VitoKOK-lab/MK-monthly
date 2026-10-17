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
const SHIFT_NAME = ['早','中','晚','休','出差'];
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
function saveState(){ try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch(e){} }
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
  for (const d of Object.keys(effAssign(i)).map(Number)) s.add(d);
  return s;
}
/* 總休假目標 = 正常額度 + 特殊假天數 */
const totalQuota = i => S.staff[i].quota + specialSet(i).size;

/* 店長 = 規則外額外人力：照樣排班，但不計入任何每日人力數量規則、
   早班平衡與假日休 2–3 天限制（額度、週律、連五禁止仍適用） */
/* 規則外的額外人力：店長一律不計；其他人可在員工表勾「不計人力」（p.extra）。
   這些人照樣上班、照樣算休假額度，但不計入每日早/中/晚人數，也不參與班別平衡。 */
const exemptSet = () => new Set(S.staff.map((p,i) => (p.role === '店長' || p.extra) ? i : -1).filter(i => i >= 0));

/* 每日需求（以「規則內」員工計，店長另外加不計數）：
   週五、六、日（含國定假日）：「早1、中1、晚3–4」，5–6 人
   週一～週四：            「早1、中1、晚2–3」，4–5 人（晚班 3 人尤佳 → pref）
   註：週五只是「人力配置」比照假日；休假額度上「週五休」仍算平日休，
       不佔假日休 2–3 天的配額（假日認定仍只看 isRest）。 */
function demand(d){
  if (isRest(d) || isFri(d)) return { m:1, mid:1, e:3, min:5, cap:6 };
  return { m:1, mid:1, e:2, min:4, cap:5, pref:5 };
}
/* Demi 的早班要比其他人少幾天（其他人平均 − 這個數，最低仍為 1 天） */
const DEMI_MORN_GAP = 3;

/* ---------- 全域狀態（三個檔案共用） ---------- */
let S = loadState() || defaultState();
normalize(S);
let RESULT = null;          /* 目前套用的班表 { grid, days, month, offScore } */
/* 自動排班產生的候選方案（最多 3 版）與目前套用的索引；只存在記憶體，重排即重算 */
let ALTS = [];
let ALT_SEL = 0;
let LOCKED = false;
let selPerson = 0;
