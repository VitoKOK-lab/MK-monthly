/* ============================================================
   schedule/ui.js
   畫面：方案比較、班表存檔、產生流程 generate()、渲染、體檢頁、
   手動微調、匯出、設定頁、AL 自動安插、步驟精靈、看班／發布。
============================================================ */

const cloneResult = r => ({ grid: r.grid.map(row => row.slice()), days: r.days, month: r.month, offScore: r.offScore });
async function pickAlt(k){
  if (!ALTS[k] || LOCKED) return;
  if (manualEdits.size > 0 && !await uiConfirm('切換方案',
      `你已手動調整 ${manualEdits.size} 格班別，切換方案會捨棄這些調整。確定切換嗎？`)) return;
  ALT_SEL = k;
  RESULT = cloneResult(ALTS[k]);
  UNDO.length = 0; manualEdits.clear();
  render();
}
function renderAltStrip(){
  const wrap = document.getElementById('altWrap');
  if (!wrap) return;
  if (!RESULT || ALTS.length < 2 || ALTS[0].month !== S.month){ wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  const base = RESULT;
  const keep = RESULT;
  const cards = ALTS.map((alt, k) => {
    RESULT = alt;                       /* validate() 讀全域 RESULT，暫時借用 */
    const { violations, stats } = validate();
    RESULT = keep;
    let diff = 0;
    for (let i=0;i<alt.grid.length;i++) for (let d=1; d<=alt.days; d++) if (alt.grid[i][d] !== base.grid[i][d]) diff++;
    const maxRun = Math.max(...stats.map(s => s.maxRun));
    const runs4 = stats.filter(s => s.maxRun >= 4).length;
    const restLow = stats.filter((s,i) => !exemptSet().has(i) && s.restOff < 2).length;
    return `<div class="alt-card ${k===ALT_SEL?'active':''}" onclick="pickAlt(${k})">
      <b>方案 ${'ABC'[k]}${k===ALT_SEL?' ・ 套用中':''}</b>
      分數 <span class="num">${alt.offScore}</span> ・ 體檢 ${violations.length ? `<span style="color:var(--crit)">${violations.length} 項</span>` : '<span style="color:var(--good)">全過</span>'}<br>
      連上四天：${runs4} 人 ・ 假日休不足 2 天：${restLow} 人 ・ 最長連上 ${maxRun} 天<br>
      <span style="color:var(--muted)">${k===ALT_SEL ? '目前套用' : `與套用中方案相差 ${diff} 格`}</span>
    </div>`;
  });
  document.getElementById('altStrip').innerHTML = cards.join('');
}


/* ---------- 班表存檔（每月一份，可鎖定回顧） ---------- */
const SAVE_KEY = 'mk-sched-results-v1';
function loadSavedAll(){ try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch(e){ return {}; } }
function persistResult(){
  if (!RESULT) return;
  const all = loadSavedAll();
  all[S.month] = {
    grid: RESULT.grid, days: RESULT.days, locked: LOCKED,
    manual: [...manualEdits], savedAt: new Date().toISOString().slice(0,10),
  };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(all)); } catch(e){}
}
function restoreResult(){
  const rec = loadSavedAll()[S.month];
  if (!rec){ RESULT = null; LOCKED = false; manualEdits.clear(); UNDO.length = 0;
    document.getElementById('resultSec').style.display = 'none'; updateButtons(); return; }
  /* 名單增減過的話，舊班表的列數會對不上現在的員工數。
     少的列補「休」（那位同事當月本來就不在），多的列直接丟掉，
     避免 render() 讀到 undefined 整頁掛掉。 */
  const grid = rec.grid.slice(0, S.staff.length).map(r => r.slice());
  while (grid.length < S.staff.length) grid.push(new Array(rec.days + 1).fill(3));
  RESULT = { grid, days: rec.days, month: S.month, offScore: 0 };
  LOCKED = !!rec.locked;
  manualEdits.clear(); (rec.manual||[]).forEach(k => manualEdits.add(k));
  UNDO.length = 0;
  render();
  document.getElementById('status').textContent = LOCKED
    ? `🔒 此月班表已於 ${rec.savedAt} 鎖定 — 唯讀回顧中（可按「解除鎖定」修改）`
    : `已載入先前儲存的班表（${rec.savedAt}）`;
}
async function clearResult(){
  if (LOCKED){ await uiConfirm('班表已鎖定', '請先解除鎖定再清除。'); return; }
  if (!await uiConfirm('清除班表', `確定清除 ${S.month} 的班表重新開始？\n（指休與設定會保留）`)) return;
  const all = loadSavedAll();
  delete all[S.month];
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(all)); } catch(e){}
  RESULT = null; ALTS = []; manualEdits.clear(); UNDO.length = 0;
  document.getElementById('resultSec').style.display = 'none';
  document.getElementById('status').textContent = '已清除，可重新排班';
  updateButtons();
}
function toggleLock(){
  if (!RESULT) return;
  const wasLocked = LOCKED;
  LOCKED = !LOCKED;
  persistResult(); render();
  document.getElementById('status').textContent = LOCKED
    ? '🔒 班表已鎖定 — 不可再修改；切換月份即可回顧歷史班表'
    : '🔓 已解除鎖定，可繼續調整';
  if (wasLocked && !LOCKED){
    gotoStep(3);
    requestAnimationFrame(() => {
      const an = document.getElementById('anomalySec');
      const target = an && an.style.display !== 'none' ? an : document.getElementById('resultSec');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
}
function updateButtons(){
  const has = !!RESULT;
  document.getElementById('lockBtn').style.display = has ? '' : 'none';
  document.getElementById('clearBtn').style.display = has ? '' : 'none';
  document.getElementById('pubBtn').style.display = has ? '' : 'none';
  document.getElementById('lockBtn').textContent = LOCKED ? '🔓 解除鎖定' : '🔒 鎖定班表';
  document.getElementById('genBtn').disabled = LOCKED;
}


/* ============================================================
   產生
============================================================ */
function generate(){
  if (LOCKED){ document.getElementById('status').textContent = '🔒 班表已鎖定，請先解除鎖定'; return; }
  const btn = document.getElementById('genBtn');
  btn.disabled = true;
  document.getElementById('status').textContent = '計算中…（嘗試上萬種組合）';
  setTimeout(() => {
    const { days } = monthInfo();
    const N = S.staff.length;
    const trioIdx = S.trio.map(n => S.staff.findIndex(s => s.name===n)).filter(i => i>=0);
    /* 預檢 1：固定休超過額度 / 休假與必須上班（週律班、出差、指班）衝突 / 可休天數不足 */
    for (let i=0;i<N;i++){
      const fx = fixedOf(i), bl = blockedOf(i);
      if (fx.size > totalQuota(i)){
        document.getElementById('status').textContent = `⚠ ${S.staff[i].name}：固定休＋指休＋特殊假共 ${fx.size} 天 > 總額度 ${totalQuota(i)} 天（正常 ${S.staff[i].quota}＋特假 ${specialSet(i).size}）`;
        btn.disabled = false; return;
      }
      const clash = [...fx].filter(d => bl.has(d));
      if (clash.length){
        document.getElementById('status').textContent = `⚠ ${S.staff[i].name}：${clash[0]} 日同時被設為休假（指休/特假/週律休）與必須上班（週律班/出差/指班），請先解衝突`;
        btn.disabled = false; return;
      }
      if (days - bl.size < totalQuota(i)){
        document.getElementById('status').textContent = `⚠ ${S.staff[i].name}：扣除固定班/出差/指班後僅剩 ${days - bl.size} 天可排休，不足額度 ${totalQuota(i)} 天`;
        btn.disabled = false; return;
      }
    }
    /* 預檢 2：最嚴格互斥模式可行性 */
    if (S.trioMode === 'pair' && trioIdx.length >= 2){
      const trioQuota = trioIdx.reduce((a,i) => a + totalQuota(i), 0);
      let weekdays = 0;
      for (let d=1; d<=days; d++) if (!isRest(d)) weekdays++;
      const needRest = Math.max(0, trioQuota - weekdays);
      const allowRest = 2 * trioIdx.length;
      if (trioQuota > days || needRest > allowRest){
        document.getElementById('status').textContent =
          `⚠ 無解：互斥 ${trioIdx.length} 人共 ${trioQuota} 天休假需完全不重疊，平日僅 ${weekdays} 天，至少 ${needRest} 天須落在假日，但假日上限共 ${allowRest} 天。請改用「至少一人在班」。`;
        btn.disabled = false; return;
      }
    }
    const cfg = {
      days, N,
      quotas: S.staff.map((_,i) => totalQuota(i)),
      fixed: S.staff.map((_,i) => fixedOf(i)),
      blocked: S.staff.map((_,i) => blockedOf(i)),
      special: S.staff.map((_,i) => specialSet(i)),
      trioIdx,
      trioMode: S.trioMode,
      exempt: exemptSet(),   /* 店長 = 不做業績、只算人頭 */
      altIdx: new Set([S.trio[1], S.trio[2]].map(n => S.staff.findIndex(s => s.name===n)).filter(i => i>=0)),
      biz: S.staff.map((_,i) => bizOf(i)),
      absent: S.staff.map((_,i) => absentOf(i)),
    };
    /* 8 個隨機起點各解一次，留下分數最好的 3 個「彼此不同」方案讓店長挑。
       以前只回傳最佳一版；多版本不增加計算量，只是把原本丟掉的解留下來。 */
    const sols = [];
    let seed = Date.now() % 100000;
    const rand = s => () => { s = (s*1664525 + 1013904223) % 4294967296; return s/4294967296; };
    for (let r=0; r<8; r++) sols.push(solveOff(cfg, rand(seed + r*7919)));
    sols.sort((a,b) => a.score - b.score);
    const offKey = sol => sol.off.map(s => [...s].sort((a,b)=>a-b).join(',')).join('|');
    const seen = new Set();
    ALTS = [];
    for (const sol of sols){
      const k = offKey(sol);
      if (seen.has(k)) continue;
      seen.add(k);
      const grid = assignShifts(sol.off, cfg);
      ALTS.push({ grid, days, month: S.month, offScore: sol.score });
      if (ALTS.length >= 3) break;
    }
    ALT_SEL = 0;
    RESULT = cloneResult(ALTS[0]);
    UNDO.length = 0; manualEdits.clear();
    render();
    btn.disabled = false;
    const nViol = validate().violations.length;
    document.getElementById('status').textContent = nViol === 0
      ? '✓ 完成 — 體檢全數通過，請往下確認'
      : `完成 — 體檢發現 ${nViol} 項須留意，請看下方「每日人力體檢」`;
    const an = document.getElementById('anomalySec');
    if (an && an.style.display !== 'none') an.scrollIntoView({ behavior: 'smooth' });
  }, 30);
}


/* ============================================================
   RENDER
============================================================ */
function render(){
  if (!RESULT) return;
  const { grid, days } = RESULT;
  const N = S.staff.length;
  const { violations, stats } = validate();
  document.getElementById('resultSec').style.display = 'block';
  const [y,m] = S.month.split('-');
  document.getElementById('resultTitle').textContent = `${y} 年 ${Number(m)} 月排班表`;

  const exemptF = exemptSet();
  const regIdx = [], exIdx = [];
  for (let i=0;i<N;i++) (exemptF.has(i) ? exIdx : regIdx).push(i);

  const headRow = () => {
    let hh = '<thead><tr><th class="name-col">員工</th>';
    for (let d=1; d<=days; d++){
      const w = dowOf(d), holi = holiSet().has(d);
      hh += `<th class="${holi?'holi':(w===0||w===6?'wkend':'')}">${d}<span class="dow">${DOW[w]}${holi?' 假':''}</span></th>`;
    }
    return hh + '</tr></thead>';
  };
  const bodyRows = idxList => {
    let hh = '<tbody>';
    for (const i of idxList){
      hh += `<tr><td class="name-col">${S.staff[i].name}<span class="role-tag">${S.staff[i].role}</span></td>`;
      const fx = fixedOf(i);
      const sp = specialOf(i);
      const asg = effAssign(i);
      for (let d=1; d<=days; d++){
        const s = grid[i][d];
        if (s===5){
          hh += `<td><button class="cell s5" title="未到職／已離職（於 Step 1 修改到職日）" style="cursor:not-allowed">—</button></td>`;
        } else if (s===4){
          hh += `<td><button class="cell s4" title="出差（於 Step 2 修改）" style="cursor:not-allowed">OL</button></td>`;
        } else if (asg[d] !== undefined){
          hh += `<td><button class="cell s${s} asg" title="指班・${SHIFT_NAME[asg[d]]}（於 Step 2 修改）" style="cursor:not-allowed">${SHIFT_CODE[asg[d]]}</button></td>`;
        } else if (s===3 && sp[d]){
          hh += `<td><button class="cell s3 sp" title="特殊假（於 Step 2 修改）" style="cursor:not-allowed;color:var(--gold-dark);font-weight:700">${sp[d]}</button></td>`;
        } else {
          const man = manualEdits.has(i + ':' + d) ? 'manual' : '';
          hh += `<td><button class="cell s${s} ${fx.has(d)&&s===3?'fixed':''} ${man}" onclick="cycle(${i},${d})">${cellCode(s, d)}</button></td>`;
        }
      }
      hh += '</tr>';
    }
    return hh + '</tbody>';
  };

  /* 單一班表：店長排第一列；表尾「早/中/晚」只計業務
     （店長有上班但不計數；出差不在店也不計） */
  let h = headRow() + bodyRows([...exIdx, ...regIdx]);
  h += '<tfoot><tr><td class="name-col" style="font-weight:400;color:var(--muted)">A/M/P<br><span style="font-size:9px">（不含額外人力）</span></td>';
  for (let d=1; d<=days; d++){
    const dem = demand(d);
    let m=0, mid=0, e=0, workers=0;
    for (let i=0;i<N;i++){
      if (exemptF.has(i)) continue;
      const s=grid[i][d];
      if(s!==3 && s!==4 && s!==5)workers++;
      if(s===0)m++; else if(s===1)mid++; else if(s===2)e++;
    }
    const eMin = Math.min(dem.e, Math.max(0, workers - dem.m - dem.mid));
    const short = workers<dem.min || m<Math.min(dem.m, workers) || e<eMin || (dem.mid>0 && mid<dem.mid && workers>dem.m+eMin);
    h += `<td class="${short?'short':''} num">${m}/${mid}/${e}</td>`;
  }
  h += '</tr></tfoot>';
  document.getElementById('schedTable').innerHTML = h;

  let st = `<thead><tr><th>員工</th><th>職級</th><th>上班</th><th>出差</th><th>正常休</th><th>BL/AL/OL</th><th>假日休</th><th>早班</th><th>中班</th><th>晚班</th><th>最長連上</th></tr></thead><tbody>`;
  for (const i of [...exIdx, ...regIdx]){
    const s = stats[i];
    st += `<tr><td>${S.staff[i].name}</td><td>${S.staff[i].role}</td><td class="num">${days - s.offN - s.spN - s.bizN}</td>
      <td class="num">${s.bizN}</td>
      <td class="num ${s.offN!==quotaFor(i)?'bad':''}">${s.offN}${quotaFor(i)!==S.staff[i].quota?`<span style="color:var(--muted);font-size:10px">/${quotaFor(i)}</span>`:''}</td>
      <td class="num">${s.spN}</td>
      <td class="num ${!exemptF.has(i)&&(s.restOff>3||s.restOff<2)?'bad':''}">${s.restOff}</td>
      <td class="num">${s.m}</td><td class="num">${s.mid}</td><td class="num">${s.e}</td>
      <td class="num ${s.maxRun>4?'bad':''}">${s.maxRun}</td></tr>`;
  }
  st += '</tbody>';
  document.getElementById('statTable').innerHTML = st;

  renderAltStrip();
  renderAnomalies(violations);
  renderStep4Sum(violations);
  const ub = document.getElementById('undoBtn');
  if (ub) ub.disabled = UNDO.length === 0 || LOCKED;
  updateButtons();
  persistResult();   /* 每次變動即自動存檔 — 重新整理或換月都不會遺失 */
}

/* ============================================================
   每日人力體檢：把違規翻譯成「哪幾天異常＋建議怎麼做」
============================================================ */
const ANOMALY_ADVICE = [
  [/人上班|人力/, '回步驟②減少該日的指休／出差，或按「重排」換一個方案'],
  [/早班已有|未開中班|中班缺|早班 \d|晚班缺/, '按「重排」換方案；還是一樣的話，點該日格子手動微調'],
  [/假日/, '回步驟②調整該員工的休假分佈'],
  [/連續上班/, '按「重排」換方案，或回步驟②幫他加一天指休'],
  [/落差/, '按「重排」通常可解；此為提醒性質，不影響定案'],
  [/互斥|同時休假/, '回步驟②錯開兩人的休假'],
  [/指休|指班|出差|週律/, '回步驟②檢查該日的設定是否衝突'],
];
function anomalyAdvice(msg){
  for (const [re, adv] of ANOMALY_ADVICE) if (re.test(msg)) return adv;
  return '按「重排」換方案，或手動微調後再定案';
}
/* 抓出訊息裡直接點名的同事；若無人被點名（純人力不足），改列出當天休假中的同事作為可調整候選 */
function culpritsForDay(d, msgs){
  const named = new Set();
  msgs.forEach(msg => S.staff.forEach((p,i) => { if (msg.includes(p.name)) named.add(i); }));
  if (named.size) return { idx: [...named], maybe: false };
  return { idx: offStaffOnDay(d).slice(0,3), maybe: true };
}
function offStaffOnDay(d){
  if (!RESULT) return [];
  const exempt = exemptSet();
  const out = [];
  for (let i=0;i<S.staff.length;i++){
    if (exempt.has(i)) continue;
    if (RESULT.grid[i][d] === 3) out.push(i);
  }
  return out;
}
function whoChips(idxs, d, maybe){
  if (!idxs.length) return '';
  return idxs.map(i =>
    `<span class="who-chip${maybe?' maybe':''}" title="跳到 ${d} 日、${S.staff[i].name} 的班表格" onclick="jumpToPerson(${i},${d})">${maybe?'可調整→':'→'} ${S.staff[i].name}</span>`
  ).join('');
}
function jumpToPerson(i, d){
  gotoStep(3);
  requestAnimationFrame(() => {
    const table = document.getElementById('schedTable');
    const resultSec = document.getElementById('resultSec');
    if (!table || !resultSec) return;
    const exemptF = exemptSet();
    const order = [];
    S.staff.forEach((_,k) => { if (exemptF.has(k)) order.push(k); });
    S.staff.forEach((_,k) => { if (!exemptF.has(k)) order.push(k); });
    const rowPos = order.indexOf(i);
    const rows = table.querySelectorAll('tbody tr');
    const row = rows[rowPos];
    if (!row) return;
    const cell = row.children[d];
    (cell || row).scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    row.classList.add('row-flash');
    if (cell) cell.classList.add('cell-flash');
    setTimeout(() => { row.classList.remove('row-flash'); if (cell) cell.classList.remove('cell-flash'); }, 3200);
  });
}
/* 規則清單：每條規則一列，過關打勾、違規列出細節。順序＝店長關心的優先序。
   每則違規訊息依第一個符合的 regex 歸類；沒對到的歸入「其他」。 */
const RULE_CHECKS = [
  ['休假額度：每人正常休假 = 額度', /≠ 額度/],
  ['指休／特殊假／出差／指班／週律：全部照設定', /指休\/固定休|週律固定上班|為出差|為指班/],
  ['每日人力下限：平日 ≥4、五六日假日 ≥5', /僅 \d+ 人上班/],
  ['每日人力上限：平日 ≤5、五六日假日 ≤6', /人上班（上限/],
  ['班型：每天早 1、中 1，其餘晚班', /早班 \d 人|晚班缺|應開 1 個中班/],
  ['晚班鎮店：管理職每天至少一人晚班', /無人上晚班/],
  ['管理職互斥：不可同天全休；週一 Liv/Demi 不同休', /互斥名單|同時休假/],
  ['連續上班：禁止連五', /連續上班/],
  ['假日休：每人 2–3 天', /假日休了|假日只休/],
  ['早班平衡：落差 ≤1；Demi 少排但不為 0', /^早班天數落差|個早班|比其他人平均少/],
  ['中／晚班平衡：落差 ≤3（鎮店者不計）', /^中班天數落差|^晚班（/],
];
function renderRuleList(violations){
  const buckets = RULE_CHECKS.map(() => []);
  const other = [];
  violations.forEach(msg => {
    const k = RULE_CHECKS.findIndex(([, re]) => re.test(msg));
    (k >= 0 ? buckets[k] : other).push(msg);
  });
  const row = (label, msgs) => `<div class="rule-row ${msgs.length ? 'bad' : 'ok'}">
    <span class="ic">${msgs.length ? '✗' : '✓'}</span>
    <div><div class="lab">${label}${msgs.length ? `（${msgs.length}）` : ''}</div>
    ${msgs.length ? `<div class="det">${msgs.slice(0,4).join('<br>')}${msgs.length > 4 ? `<br>…另 ${msgs.length-4} 項` : ''}</div>` : ''}</div>
  </div>`;
  return `<div class="card"><div class="subhead">規則總覽（${RULE_CHECKS.length - buckets.filter(b => b.length).length - (other.length?1:0)} / ${RULE_CHECKS.length + (other.length?1:0)} 項通過）</div>
    <div class="rule-list">${RULE_CHECKS.map(([lab], k) => row(lab, buckets[k])).join('')}${other.length ? row('其他', other) : ''}</div></div>`;
}
function renderAnomalies(violations){
  const sec = document.getElementById('anomalySec');
  if (!sec) return;
  if (!RESULT){ sec.style.display = 'none'; return; }
  sec.style.display = '';
  const box = document.getElementById('anomalyBox');
  const q = document.getElementById('anomalyQ');
  const ruleHtml = renderRuleList(violations);
  if (!violations.length){
    box.innerHTML = ruleHtml + `<div class="ok-note" style="font-size:14px">✓ 體檢通過：${RESULT.days} 天的班型、人力下限、晚班鎮店與休假規則全部正常，沒有需要調整的異常日。</div>`;
    q.textContent = '沒有異常 — 直接前往定案？';
    return;
  }
  const dayIssues = new Map();
  const otherIssues = [];
  violations.forEach(msg => {
    const m = msg.match(/^(\d+) 日/);
    if (m){
      const d = Number(m[1]);
      if (!dayIssues.has(d)) dayIssues.set(d, []);
      dayIssues.get(d).push(msg);
    } else otherIssues.push(msg);
  });
  let h = ruleHtml;
  if (dayIssues.size){
    const dayList = [...dayIssues.keys()].sort((a,b) => a-b);
    h += `<div class="card"><div class="subhead">異常日（${dayList.length} 天）</div>
      <div style="overflow-x:auto"><table class="stat-table">
      <thead><tr><th style="text-align:left">日期</th><th style="text-align:left">問題</th><th style="text-align:left">相關同事</th><th style="text-align:left">建議</th></tr></thead><tbody>` +
      dayList.map(d => {
        const msgs = dayIssues.get(d);
        const { idx, maybe } = culpritsForDay(d, msgs);
        return `<tr>
          <td style="text-align:left;white-space:nowrap;font-weight:700">${d} 日（${DOW[dowOf(d)]}）</td>
          <td style="text-align:left">${msgs.map(m => m.replace(/^\d+ 日[：:（(]?\s*/, '')).join('<br>')}</td>
          <td style="text-align:left;white-space:nowrap">${whoChips(idx, d, maybe) || '<span style="color:var(--muted)">—</span>'}</td>
          <td style="text-align:left;color:var(--ink2)">${anomalyAdvice(msgs[0])}</td>
        </tr>`;
      }).join('') + '</tbody></table></div></div>';
  }
  if (otherIssues.length){
    h += `<div class="card"><div class="subhead">個人／整體提醒（${otherIssues.length} 項）</div>` +
      otherIssues.map(m => {
        const who = S.staff.findIndex(p => m.includes(p.name));
        return `<div class="viol">⚠ ${m}${who>=0 ? ` ${whoChips([who], 0, false)}` : ''}<div style="font-size:11.5px;color:var(--muted);margin-top:3px">建議：${anomalyAdvice(m)}</div></div>`;
      }).join('') +
      '</div>';
  }
  box.innerHTML = h;
  q.textContent = `發現 ${dayIssues.size} 個異常日、${otherIssues.length} 項提醒 — 要重排、回步驟②調整，還是接受後前往定案？`;
}

/* 手動微調：允許違背規定（違規只會顯示警告）；支援復原 */
const UNDO = [];
const manualEdits = new Set();
function cycle(i, d){
  if (!RESULT) return;
  if (LOCKED){ document.getElementById('status').textContent = '🔒 班表已鎖定，如需修改請先按「解除鎖定」'; return; }
  UNDO.push({ i, d, val: RESULT.grid[i][d] });
  if (UNDO.length > 50) UNDO.shift();
  manualEdits.add(i + ':' + d);
  RESULT.grid[i][d] = (RESULT.grid[i][d] + 1) % 4;
  render();
}
function undo(){
  const u = UNDO.pop();
  if (!u || !RESULT || LOCKED) return;
  RESULT.grid[u.i][u.d] = u.val;
  /* 若該格已回到未改狀態就清除紅點（簡化：只要沒有其他紀錄就移除） */
  if (!UNDO.some(x => x.i===u.i && x.d===u.d)) manualEdits.delete(u.i + ':' + u.d);
  render();
}

/* ============================================================
   CSV
============================================================ */
function exportCsv(){
  if (!RESULT) return alert('請先產生排班表');
  const { grid, days } = RESULT;
  let rows = ['員工,職級,' + Array.from({length:days}, (_,k) => `${k+1}(${DOW[dowOf(k+1)]})`).join(',')];
  S.staff.forEach((p,i) => {
    const sp = specialOf(i);
    rows.push(p.name + ',' + p.role + ',' + Array.from({length:days}, (_,k) => {
      const d = k+1, s = grid[i][d];
      return (s===3 && sp[d]) ? sp[d] : cellCode(s, d);
    }).join(','));
  });
  const blob = new Blob(['﻿' + rows.join('\n')], { type:'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `MK排班_${S.month}.csv`;
  a.click();
}

/* ============================================================
   匯出公司標準格式 Excel（比照「Store 月班表」範本：日期橫排、
   班別代號＋顏色、早/中/晚人數統計、班別代號說明、使用規範）
============================================================ */
const XLSX_FILL = {
  RL: 'FFFFFF00', 'RL/': 'FFFF2F2F', AL: 'FFA5A5A5', BL: 'FFB2A1C7',
  SL: 'FFFABF8F', ML: 'FFF2DBDB', FL: 'FFB2B1A8', PL: 'FFD6E3BC',
  OL: 'FF00FFFF', WL: 'FFFF99FF',
};
function xlsxCodeFor(i, d, grid){
  const s = grid[i][d];
  if (s === 0) return 'A';
  if (s === 1) return 'M';
  if (s === 2) return 'P';
  if (s === 4) return 'OL';   /* 出差 → 公假/培訓代碼 */
  if (s === 5) return '';     /* 未到職／已離職 → 空白 */
  const sp = specialOf(i)[d];
  if (sp === 'BL') return 'BL';
  if (sp === 'AL') return 'AL';
  if (sp === 'OL') return 'OL';
  return isRest(d) ? 'RL' : 'RL/';
}
function b64ToArrayBuffer(b64){
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i=0; i<bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/* 主要路徑：直接以店長上傳的公司範本檔案為底，只替換「班表」本體
   （員工姓名＋每日班別，含每人中間的空白列），其餘表頭／備註列／
   特休統計欄／圖例／使用規範完全維持範本原樣，逐一比對填入。
   範本目前只涵蓋 2026 年 1–12 月；其餘年份自動改用程式產生的相容版本。 */
async function exportCompanyExcel(){
  if (!RESULT) return alert('請先產生排班表');
  if (!window.ExcelJS){ alert('Excel 匯出元件載入中，請稍後再試一次'); return; }
  const btn = document.getElementById('xlsxBtn');
  btn.disabled = true; btn.textContent = '匯出中…';
  try {
    const { grid, days } = RESULT;
    const N = S.staff.length;
    const [y, mNum] = S.month.split('-').map(Number);
    const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const monAbbr = MONTH_ABBR[mNum-1];
    const sheetName = `${y} ${monAbbr}`;

    if (window.MK_TEMPLATE_XLSX_B64){
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(b64ToArrayBuffer(window.MK_TEMPLATE_XLSX_B64));
      const ws = wb.getWorksheet(sheetName);
      if (ws){
        /* 範本是店長手填的原檔：活動列、PT 列、小列記號、公式、備註全部保留，
           只改「正職同事的班別格」。列位置依 B 欄姓名比對（不分大小寫、去空白、
           含舊寫法別名）；名單上有、範本沒有的人，放進正職區塊第一個空列。 */
        const setFill = (cell, fill) => { cell.style = Object.assign({}, cell.style, { fill }); };
        const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, '');
        const ALIAS = { '伯鴻':'柏鴻' };
        const canon = s => { const n = norm(s); return norm(ALIAS[n] || n); };
        const isPtOrFooter = v => /^pt/i.test(norm(v)) || /人數|時數|使用規範/.test(String(v || ''));
        let blockEnd = ws.rowCount;
        for (let r = 7; r <= ws.rowCount; r++){
          const v = ws.getCell(r, 2).value;
          if (v != null && String(v).trim() && isPtOrFooter(v)){ blockEnd = r - 1; break; }
        }
        const rowOf = {};
        const emptyRows = [];
        for (let r = 7; r <= blockEnd; r += 2){
          const v = ws.getCell(r, 2).value;
          if (v != null && String(v).trim()) rowOf[canon(v)] = r; else emptyRows.push(r);
        }
        /* 每一欄的「底色」＝星期列（第 3 列）該欄的填色：週末／國定假日欄的灰底就靠它保留。
           （不取活動列：店長會在活動列填自己的顏色） */
        const baseFill = {};
        for (let d = 1; d <= 31; d++){
          const f = ws.getCell(3, 2 + d).fill;
          baseFill[d] = f && f.type ? JSON.parse(JSON.stringify(f)) : { type:'pattern', pattern:'none' };
        }
        const missing = [];
        for (let i = 0; i < N; i++){
          const p = S.staff[i];
          if (absentOf(i).size >= days) continue;   /* 整月不在職（尚未到職／已離職）不寫入 */
          let row = rowOf[canon(p.name)];
          if (!row){
            if (!emptyRows.length){ missing.push(p.name); continue; }
            row = emptyRows.shift();
            ws.getCell(row, 2).value = p.name;
          }
          const mf = manualFixed(i), sp = specialOf(i);
          for (let d = 1; d <= days; d++){
            const code = xlsxCodeFor(i, d, grid);
            const cell = ws.getCell(row, 2 + d);
            cell.value = code || null;
            /* 上色照範本圖例：指休例假 RL 黃、指休休假 RL/ 紅；一般 RL／RL/ 不上色（保留欄底色）；
               AL 灰、BL 紫、OL 青 */
            let fill = null;
            if (code === 'RL' || code === 'RL/'){ if (mf.has(d)) fill = XLSX_FILL[code]; }
            else if (sp[d] || grid[i][d] === 4) fill = XLSX_FILL[code];
            setFill(cell, fill ? { type:'pattern', pattern:'solid', fgColor:{ argb: fill } } : baseFill[d]);
          }
        }
        if (missing.length) alert(`範本「${sheetName}」正職區塊已無空列，以下同事未寫入：${missing.join('、')}。請在 Excel 補列後自行填入。`);
        const buf = await wb.xlsx.writeBuffer();
        const blob = new Blob([buf], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `MK排班_${S.month}_公司格式.xlsx`;
        a.click();
        URL.revokeObjectURL(a.href);
        return;
      }
    }
    /* 找不到範本分頁（非 2026 年）→ 改用程式產生的相容版本 */
    await exportCompanyExcelFromScratch({ grid, days, N, y, monAbbr });
  } catch(e){
    console.error(e);
    alert('匯出失敗：' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = '📊 匯出公司格式 Excel';
  }
}

/* 備援路徑：範本沒有對應年份時，程式產生格式相容（非逐格複製）的版本 */
async function exportCompanyExcelFromScratch({ grid, days, N, y, monAbbr }){
  {
    const FONT = 'Microsoft JhengHei UI';
    const hair = { style:'hair' }, thin = { style:'thin' }, medium = { style:'medium' };
    const cellBorder = { top:hair, bottom:hair, left:hair, right:hair };

    const wb = new ExcelJS.Workbook();
    wb.creator = 'MK 華泰店 排班系統';
    wb.created = new Date();
    const ws = wb.addWorksheet(`${y} ${monAbbr}`, { views:[{ state:'frozen', xSplit:2, ySplit:3 }] });

    ws.getColumn(1).width = 4;
    ws.getColumn(2).width = 14;
    for (let d=1; d<=days; d++) ws.getColumn(2+d).width = 5.3;

    /* Row 1 — 店名／本月應休天數 */
    ws.mergeCells(1,3,1,6);
    ws.getCell(1,2).value = 'Store: ';
    ws.getCell(1,3).value = 'MICHAEL KORS 華泰店';
    ws.mergeCells(1,7,1,11);
    const quotaMode = (() => {
      const counts = {};
      S.staff.forEach(p => counts[p.quota] = (counts[p.quota]||0)+1);
      let best = (S.staff[0]||{}).quota || 10, bc = 0;
      Object.entries(counts).forEach(([k,c]) => { if (c>bc){ bc=c; best=Number(k); } });
      return best;
    })();
    ws.getCell(1,7).value = `本月應休天數 ${quotaMode}天`;
    ws.getCell(1,2).font = { name:FONT, bold:true, size:18 };
    ws.getCell(1,3).font = { name:FONT, bold:true, size:18 };
    ws.getCell(1,3).alignment = { horizontal:'center', vertical:'middle' };
    ws.getCell(1,7).font = { name:FONT, bold:true, size:16, color:{argb:'FFFF0000'} };
    ws.getCell(1,7).alignment = { horizontal:'center', vertical:'middle' };
    ws.getRow(1).height = 30;

    /* Row 2 — 月份縮寫／日期數字 */
    ws.getCell(2,2).value = monAbbr;
    ws.getCell(2,2).font = { name:FONT, bold:true, size:14 };
    ws.getCell(2,2).alignment = { horizontal:'center', vertical:'middle' };
    for (let d=1; d<=days; d++){
      const cell = ws.getCell(2, 2+d);
      cell.value = d;
      cell.font = { name:FONT, bold:true, size:11 };
      cell.alignment = { horizontal:'center', vertical:'middle' };
      cell.border = cellBorder;
    }

    /* Row 3 — 星期 */
    for (let d=1; d<=days; d++){
      const w = dowOf(d);
      const cell = ws.getCell(3, 2+d);
      cell.value = DOW[w];
      cell.font = { name:FONT, bold:true, size:11 };
      cell.alignment = { horizontal:'center', vertical:'middle' };
      cell.border = cellBorder;
      let bg = null;
      if (holiSet().has(d)) bg = 'FFF1DFAF';
      else if (w===0 || w===6) bg = 'FFF4F3EF';
      if (bg){
        cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:bg} };
        ws.getCell(2,2+d).fill = cell.fill;
      }
    }
    ws.getRow(2).height = 20; ws.getRow(3).height = 20;

    /* 員工列 */
    let r = 4;
    for (let i=0; i<N; i++){
      const p = S.staff[i];
      const nameCell = ws.getCell(r,2);
      nameCell.value = p.role ? `${p.name}（${p.role}）` : p.name;
      nameCell.font = { name:FONT, bold:true, size:12 };
      nameCell.alignment = { horizontal:'center', vertical:'middle' };
      nameCell.border = { top:thin, bottom:thin, left:medium, right:medium };
      for (let d=1; d<=days; d++){
        const code = xlsxCodeFor(i, d, grid);
        const cell = ws.getCell(r, 2+d);
        cell.value = code;
        cell.font = { name:FONT, bold:true, size:11 };
        cell.alignment = { horizontal:'center', vertical:'middle' };
        cell.border = cellBorder;
        if (XLSX_FILL[code]) cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:XLSX_FILL[code]} };
      }
      ws.getRow(r).height = 20;
      r++;
    }

    /* 早／中／晚班人數統計 */
    const sumStart = r + 1;
    ['早班人數','中班人數','晚班人數'].forEach((label, k) => {
      const rr = sumStart + k;
      const labelCell = ws.getCell(rr,2);
      labelCell.value = label;
      labelCell.font = { name:FONT, bold:true, size:11 };
      for (let d=1; d<=days; d++){
        let cnt = 0;
        for (let i=0; i<N; i++) if (grid[i][d] === k) cnt++;
        const cell = ws.getCell(rr, 2+d);
        cell.value = cnt;
        cell.font = { name:FONT, size:10 };
        cell.alignment = { horizontal:'center', vertical:'middle' };
        cell.border = cellBorder;
      }
    });
    const totalRow = sumStart + 3;
    ws.getCell(totalRow,2).value = '合計上班人數';
    ws.getCell(totalRow,2).font = { name:FONT, bold:true, size:11 };
    for (let d=1; d<=days; d++){
      let cnt = 0;
      for (let i=0; i<N; i++) if (grid[i][d] !== 3) cnt++;
      const cell = ws.getCell(totalRow, 2+d);
      cell.value = cnt;
      cell.font = { name:FONT, bold:true, size:10 };
      cell.alignment = { horizontal:'center', vertical:'middle' };
      cell.border = { top:thin, bottom:thin, left:hair, right:hair };
    }

    /* 班別代號說明 */
    let lr = totalRow + 3;
    ws.getCell(lr,2).value = '班別代號';
    ws.getCell(lr,2).font = { name:FONT, bold:true, size:12 };
    lr++;
    const LEGEND = [
      ['A','早班 10:00–19:00', null], ['M','中班 12:00–21:00', null],
      ['P','晚班 12:30–21:30', null], ['F','全班', null],
      ['RL','例假', XLSX_FILL.RL], ['RL/','指休', XLSX_FILL['RL/']],
      ['AL','年假', XLSX_FILL.AL], ['BL','生日假', XLSX_FILL.BL],
      ['SL','病假', XLSX_FILL.SL], ['ML','產假', XLSX_FILL.ML],
      ['PL','事假', XLSX_FILL.PL], ['FL','喪假', XLSX_FILL.FL],
      ['WL','婚假', XLSX_FILL.WL], ['OL','公假／培訓', XLSX_FILL.OL],
    ];
    LEGEND.forEach(([code, desc, fill]) => {
      const c1 = ws.getCell(lr,2), c2 = ws.getCell(lr,3);
      c1.value = code; c2.value = desc;
      c1.font = { name:FONT, bold:true, size:10 };
      c2.font = { name:FONT, size:10 };
      c1.alignment = { horizontal:'center', vertical:'middle' };
      c1.border = { top:hair, bottom:hair, left:thin, right:hair };
      c2.border = { top:hair, bottom:hair, left:hair, right:thin };
      if (fill) c1.fill = { type:'pattern', pattern:'solid', fgColor:{argb:fill} };
      lr++;
    });

    /* 班表使用規範 */
    lr += 1;
    ws.getCell(lr,2).value = '班表使用規範';
    ws.getCell(lr,2).font = { name:FONT, bold:true, size:13 };
    lr++;
    const mergeSpan = Math.min(days, 12);
    [
      '1. 每月20日由店主管排好班表Email給零售經理核准',
      '2. 班別請依照「班別代號」及「顏色」填入班表中,不應有任何其他記號',
      '3. 補休規定：應事先排定於班表內，除班表排定之臨時補休需經由店主管核准。假日及特殊活動檔期不可抵休、補休；當日同一班別不可申請兩人補休。',
      '4. 店主管有權依照實際營業需求安排及調整同事的休假。',
      '5. 若遇國定假日上班同仁，請務必於班表中註記挪移休假之日期。',
    ].forEach(txt => {
      ws.mergeCells(lr,2,lr,2+mergeSpan);
      const c = ws.getCell(lr,2);
      c.value = txt;
      c.font = { name:FONT, size:10 };
      c.alignment = { horizontal:'left', vertical:'middle', wrapText:true };
      ws.getRow(lr).height = 28;
      lr++;
    });

    /* 製表資訊（本次匯出日期，每次匯出自動更新） */
    lr += 1;
    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    ws.getCell(lr,2).value = `製表日期：${stamp}　製表人：＿＿＿＿＿＿　主管核准：＿＿＿＿＿＿`;
    ws.getCell(lr,2).font = { name:FONT, size:10, italic:true, color:{argb:'FF8A887F'} };

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `MK排班_${S.month}_公司格式.xlsx`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}

/* ============================================================
   SETTINGS UI
============================================================ */
const WK_STATE = { off:['off','休','固定休'], work:['work','班','固定上班（班別由系統決定）'], morn:['morn','早','固定上早班（必上班且必早班）'] };
function weekCells(i){
  const w = S.staff[i].week || {};
  return `<div class="wkrow">` + DOW.map((lab, k) => {
    const [st, stLab, tip] = WK_STATE[w[k]] || ['','·','未設定'];
    return `<button class="wk ${st}" onclick="cycleWeek(${i},${k})" title="週${lab}：${tip}">${lab}<span class="st">${stLab}</span></button>`;
  }).join('') + `</div>`;
}
function cycleWeek(i, k){
  const w = S.staff[i].week || (S.staff[i].week = {});
  const cur = w[k];
  const next = cur === undefined ? 'off' : cur === 'off' ? 'work' : cur === 'work' ? 'morn' : undefined;
  if (next === undefined) delete w[k]; else w[k] = next;
  syncAll();
}
function renderStaff(){
  document.getElementById('staffBody').innerHTML = S.staff.map((p,i) => `
    <tr>
      <td class="ordcell"><button class="ord" onclick="moveStaff(${i},-1)" ${i===0?'disabled':''} title="上移">▲</button><button class="ord" onclick="moveStaff(${i},1)" ${i===S.staff.length-1?'disabled':''} title="下移">▼</button></td>
      <td><input type="text" value="${p.name}" onchange="S.staff[${i}].name=this.value;syncAll()"></td>
      <td><select onchange="S.staff[${i}].role=this.value;saveState();if(RESULT)render()">${ROLES.map(r=>`<option ${p.role===r?'selected':''}>${r}</option>`).join('')}</select></td>
      <td><input type="number" min="0" max="15" value="${p.quota}" onchange="S.staff[${i}].quota=Number(this.value);saveState();renderFixChips();renderStep1Sum()"> 天${quotaFor(i)!==p.quota?`<div class="hint" style="margin-top:2px;white-space:nowrap">本月 <b>${quotaFor(i)}</b> 天（在職 ${monthInfo().days-absentOf(i).size}/${monthInfo().days} 天折算）</div>`:''}</td>
      <td><input type="date" value="${p.joined||''}" title="到職日（空＝早已在職）" onchange="S.staff[${i}].joined=this.value||undefined;syncAll()"><br><input type="date" value="${p.left||''}" title="離職日（空＝仍在職）" style="margin-top:3px" onchange="S.staff[${i}].left=this.value||undefined;syncAll()"></td>
      <td style="text-align:center"><input type="checkbox" ${p.role==='店長'?'checked disabled title="店長一律不計入人力"':(p.extra?'checked':'')} onchange="S.staff[${i}].extra=this.checked;syncAll()"></td>
      <td>${weekCells(i)}</td>
      <td><button class="del" onclick="delStaff(${i})">✕</button></td>
    </tr>`).join('');
  renderTrio(); renderFixChips(); saveState();
}

/* 員工排序上下移動 — 指休/特殊假/已存班表都以序號記錄，必須一併對調 */
function moveStaff(i, dir){
  const j = i + dir;
  if (j < 0 || j >= S.staff.length) return;
  [S.staff[i], S.staff[j]] = [S.staff[j], S.staff[i]];
  const swapKeys = obj => {
    if (!obj) return;
    const a = obj[i], b = obj[j];
    if (b === undefined) delete obj[i]; else obj[i] = b;
    if (a === undefined) delete obj[j]; else obj[j] = a;
  };
  Object.keys(S.fixed || {}).forEach(m => swapKeys(S.fixed[m]));
  Object.keys(S.special || {}).forEach(m => swapKeys(S.special[m]));
  Object.keys(S.biz || {}).forEach(m => swapKeys(S.biz[m]));
  Object.keys(S.assign || {}).forEach(m => swapKeys(S.assign[m]));
  const remapManual = arr => arr.map(k => {
    const [pi, pd] = k.split(':').map(Number);
    return (pi===i ? j : pi===j ? i : pi) + ':' + pd;
  });
  if (RESULT && RESULT.grid && RESULT.grid[i] && RESULT.grid[j]){
    [RESULT.grid[i], RESULT.grid[j]] = [RESULT.grid[j], RESULT.grid[i]];
    const remapped = remapManual([...manualEdits]);
    manualEdits.clear(); remapped.forEach(k => manualEdits.add(k));
    UNDO.length = 0;
  }
  const all = loadSavedAll();
  let changed = false;
  Object.entries(all).forEach(([mo, rec]) => {
    if (mo === S.month) return;   /* 本月由 persistResult 依 RESULT 覆寫 */
    if (rec.grid && rec.grid[i] && rec.grid[j]){
      [rec.grid[i], rec.grid[j]] = [rec.grid[j], rec.grid[i]];
      if (rec.manual) rec.manual = remapManual(rec.manual);
      changed = true;
    }
  });
  if (changed) try { localStorage.setItem(SAVE_KEY, JSON.stringify(all)); } catch(e){}
  if (selPerson === i) selPerson = j; else if (selPerson === j) selPerson = i;
  syncAll();
  if (RESULT) render();
}
async function delStaff(i){
  if (!await uiConfirm('移除員工', `確定移除 ${S.staff[i].name}？`)) return;
  S.staff.splice(i,1);
  const fx = S.fixed[S.month] || {};
  const nf = {};
  Object.keys(fx).forEach(k => { const n = Number(k); if (n < i) nf[n] = fx[k]; else if (n > i) nf[n-1] = fx[k]; });
  S.fixed[S.month] = nf;
  if (selPerson >= S.staff.length) selPerson = 0;
  syncAll();
}
function renderTrio(){
  ['trio1','trio2','trio3'].forEach((id,k) => {
    const sel = document.getElementById(id);
    sel.innerHTML = '<option value="">（無）</option>' + S.staff.map(p => `<option ${S.trio[k]===p.name?'selected':''}>${p.name}</option>`).join('');
    sel.onchange = () => { S.trio[k] = sel.value; saveState(); renderFixCal(); };
  });
}
function renderHoliCal(){
  const { days, firstDow } = monthInfo();
  const hs = holiSet();
  let h = DOW.map(d => `<div class="mc-h">${d}</div>`).join('');
  for (let k=0; k<firstDow; k++) h += '<div class="mc-d empty"></div>';
  for (let d=1; d<=days; d++){
    const w = dowOf(d);
    h += `<div class="mc-d ${w===0||w===6?'wkend':''} ${hs.has(d)?'holi sel':''}" onclick="toggleHoli(${d})">${d}</div>`;
  }
  document.getElementById('holiCal').innerHTML = h;
}
function toggleHoli(d){
  const w = dowOf(d);
  if (w===0 || w===6) return;
  const arr = S.holidays[S.month] || [];
  const k = arr.indexOf(d);
  if (k>=0) arr.splice(k,1); else arr.push(d);
  S.holidays[S.month] = arr;
  saveState(); renderHoliCal(); renderFixCal();
}
function renderFixChips(){
  document.getElementById('fixChips').innerHTML = S.staff.map((p,i) =>
    `<button class="pchip ${i===selPerson?'active':''}" onclick="selPerson=${i};renderFixChips();renderFixCal()">${p.name}<span class="cnt num">${fixedOf(i).size}/${totalQuota(i)}</span></button>`).join('');
}
function renderFixCal(){
  const { days, firstDow } = monthInfo();
  const manual = manualFixed(selPerson);
  const wkOff = weeklyDays(selPerson,'off');
  const wkWork = weeklyDays(selPerson,'work');
  const trioIdx = S.trio.map(n => S.staff.findIndex(s => s.name===n)).filter(i => i>=0);
  const iAmTrio = trioIdx.includes(selPerson);
  let h = DOW.map(d => `<div class="mc-h">${d}</div>`).join('');
  for (let k=0; k<firstDow; k++) h += '<div class="mc-d empty"></div>';
  for (let d=1; d<=days; d++){
    const w = dowOf(d);
    if (wkWork.has(d)){ h += `<div class="mc-d blk">${d}<span class="sub">班</span></div>`; continue; }
    if (wkOff.has(d)){ h += `<div class="mc-d lock">${d}<span class="sub">固休</span></div>`; continue; }
    const bz = bizOf(selPerson).has(d);
    const asg = assignOf(selPerson)[d];
    if (bz){ h += `<div class="mc-d" style="background:var(--biz-ink);color:#fff;border-color:var(--biz-ink)" onclick="toggleFix(${d})">${d}<span class="sub">出差</span></div>`; continue; }
    if (asg !== undefined){ h += `<div class="mc-d" style="background:var(--gold-wash);border:2px solid var(--gold-dark);font-weight:700" onclick="toggleFix(${d})">${d}<span class="sub">指${SHIFT_NAME[asg]}</span></div>`; continue; }
    const sp = specialOf(selPerson)[d];
    let conflict = false;
    if (iAmTrio && (manual.has(d) || sp)){
      for (const j of trioIdx) if (j!==selPerson && fixedOf(j).has(d)) conflict = true;
    }
    const selCls = (manual.has(d) || sp) ? 'sel' : '';
    const sub = sp ? `<span class="sub">${sp}</span>` : (manual.has(d) ? '<span class="sub">休</span>' : '');
    h += `<div class="mc-d ${w===0||w===6?'wkend':''} ${holiSet().has(d)?'holi':''} ${selCls} ${conflict?'conflict':''}" ${sp?'style="background:var(--gold-dark);border-color:var(--gold-dark)"':''} onclick="toggleFix(${d})">${d}${sub}</div>`;
  }
  document.getElementById('fixCal').innerHTML = h;
  renderStep2Sum();   /* 假別調整時同步更新②的確認摘要 */
}
function fixMode(){
  const r = document.querySelector('input[name="fixMode"]:checked');
  return r ? r.value : 'cycle';
}
/* 依模式設定：休假循環（空→指休→BL→AL→清除）／出差／指班；
   同一天設新狀態會先清掉舊狀態，再點一次即清除 */
function toggleFix(d){
  if (!S.fixed[S.month]) S.fixed[S.month] = {};
  if (!S.special) S.special = {};
  if (!S.special[S.month]) S.special[S.month] = {};
  if (!S.biz) S.biz = {};
  if (!S.biz[S.month]) S.biz[S.month] = {};
  if (!S.assign) S.assign = {};
  if (!S.assign[S.month]) S.assign[S.month] = {};
  const fx = S.fixed[S.month];
  const sp = S.special[S.month];
  const bz = S.biz[S.month];
  const ag = S.assign[S.month];
  if (!fx[selPerson]) fx[selPerson] = [];
  if (!sp[selPerson]) sp[selPerson] = {};
  if (!bz[selPerson]) bz[selPerson] = [];
  if (!ag[selPerson]) ag[selPerson] = {};
  const clearDay = () => {
    const k = fx[selPerson].indexOf(d); if (k >= 0) fx[selPerson].splice(k,1);
    delete sp[selPerson][d];
    const b = bz[selPerson].indexOf(d); if (b >= 0) bz[selPerson].splice(b,1);
    delete ag[selPerson][d];
  };
  const mode = fixMode();
  if (mode === 'biz'){
    const had = bz[selPerson].includes(d);
    clearDay();
    if (!had) bz[selPerson].push(d);
  } else if (mode === 'a0' || mode === 'a1' || mode === 'a2'){
    const sh = Number(mode[1]);
    const had = ag[selPerson][d] === sh;
    clearDay();
    if (!had) ag[selPerson][d] = sh;
  } else {
    /* 休假循環：若該日是出差/指班，先清掉再從「指休」開始 */
    if (bz[selPerson].includes(d) || ag[selPerson][d] !== undefined){
      clearDay();
      fx[selPerson].push(d);
    } else {
      const k = fx[selPerson].indexOf(d);
      if (k >= 0){                       /* 指休 → BL */
        fx[selPerson].splice(k,1);
        sp[selPerson][d] = 'BL';
      } else if (sp[selPerson][d] === 'BL'){   /* BL → AL */
        sp[selPerson][d] = 'AL';
      } else if (sp[selPerson][d] === 'AL'){   /* AL → OL */
        sp[selPerson][d] = 'OL';
      } else if (sp[selPerson][d] === 'OL'){   /* OL → 空 */
        delete sp[selPerson][d];
      } else {                           /* 空 → 指休 */
        fx[selPerson].push(d);
      }
    }
  }
  saveState(); renderFixChips(); renderFixCal();
}

/* ============================================================
   自動安插 AL 年假：沒有指休/特假的同事每人安插 2–3 天 AL
   （平日、跨週分散、優先人力最鬆的日子）；可點名排除
============================================================ */
/* AL 天數／排除名單存進 S 並依月份分開（以姓名記錄，員工排序改變不受影響）。
   以前只放在記憶體，重新整理或換月就重置，店長每次都得重點一遍。 */
function alBucket(){
  if (!S.al) S.al = {};
  const b = S.al[S.month] || (S.al[S.month] = {});
  if (!b.days) b.days = {};
  if (!Array.isArray(b.excluded)) b.excluded = [];
  return b;
}
function alDaysFor(name){
  const b = alBucket(), v = b.days[name];
  if (b.excluded.includes(name)) return 0;      /* 舊存檔的「排除」 = 0 天 */
  return Number.isInteger(v) && v >= 0 ? Math.min(v, 15) : 2;
}
function setAlDays(name, v){
  const b = alBucket();
  b.excluded = b.excluded.filter(n => n !== name);
  b.days[name] = Math.max(0, Math.min(15, Math.floor(Number(v)) || 0));
  saveState();
}
function renderAlChips(){
  const el = document.getElementById('alExChips');
  if (!el) return;
  el.innerHTML = S.staff.map(p => {
    const nm = p.name.replace(/'/g,"\\'");
    return `<label class="pchip" style="display:inline-flex;align-items:center;gap:6px;cursor:default">${p.name}<input type="number" min="0" max="15" value="${alDaysFor(p.name)}" style="width:52px" onchange="setAlDays('${nm}',this.value)"> 天</label>`;
  }).join('');
}
const weekOf = (d, firstDow) => Math.floor((d + firstDow - 1) / 7);
/* 聯合＋人力感知分配：所有待安插的同事一起看，每輪先處理「可選日子最少」的人（最容易卡住的優先），
   替他挑「當天人力餘裕最高、且還沒用過的那一週」的日子；選完立刻扣減當天餘裕，
   下一位馬上看得到最新狀況，避免大家的 AL 擠在同一天造成人力缺口 */
function autoInsertAL(){
  const { days, firstDow } = monthInfo();
  if (!S.special) S.special = {};
  if (!S.special[S.month]) S.special[S.month] = {};
  const sp = S.special[S.month];
  const trioIdx = S.trio.map(n => S.staff.findIndex(s => s.name === n)).filter(i => i >= 0);
  const targets = S.staff.map((p,i) => i)
    .filter(i => alDaysFor(S.staff[i].name) > 0);
  if (!targets.length){
    document.getElementById('alStatus').textContent = '沒有要安插的同事（所有人的額外 AL 天數都是 0）';
    return;
  }
  const exempt = exemptSet();
  const totalReg = S.staff.length - exempt.size;
  const lockedOff = new Array(days+1).fill(0);
  for (let i=0;i<S.staff.length;i++){
    if (exempt.has(i)) continue;
    for (const d of fixedOf(i)) lockedOff[d]++;
    for (const d of bizOf(i)) lockedOff[d]++;
    for (const d of absentOf(i)) lockedOff[d]++;
  }
  /* 餘裕 = 目前上班人數 − 當天最低需求；每分配一天 AL 就會扣 1 */
  const slack = new Array(days+1).fill(0);
  for (let d=1; d<=days; d++) slack[d] = (totalReg - lockedOff[d]) - demand(d).min;

  const people = targets.map(i => {
    const bl = blockedOf(i), fx = fixedOf(i);
    const cands = [];
    for (let d=1; d<=days; d++){
      if (isRest(d)) continue;                 /* 只挑平日，不吃假日休 2–3 天額度 */
      if (bl.has(d) || fx.has(d)) continue;
      if (trioIdx.includes(i) && trioIdx.filter(j => j !== i && fixedOf(j).has(d)).length >= (S.trioMode === 'pair' ? 1 : trioIdx.length - 1)) continue;   /* 管理職互斥：不讓三人同天全休 */
      cands.push(d);
    }
    return { i, need: alDaysFor(S.staff[i].name), usedWeeks: new Set(), cands, chosen: [] };
  });

  const pickDay = (p, allowSameWeek) => {
    let best = null, bestSlack = -Infinity;
    for (const d of p.cands){
      if (!allowSameWeek && p.usedWeeks.has(weekOf(d, firstDow))) continue;
      if (trioIdx.includes(p.i)){   /* 本輪其他管理職已選的日子也算進互斥 */
        const offN = trioIdx.filter(j => j !== p.i && (fixedOf(j).has(d) || (people.find(q => q.i === j) || {chosen:[]}).chosen.includes(d))).length;
        if (offN >= (S.trioMode === 'pair' ? 1 : trioIdx.length - 1)) continue;
      }
      if (slack[d] > bestSlack || (slack[d] === bestSlack && (best === null || d < best))){ bestSlack = slack[d]; best = d; }
    }
    return best;
  };
  for (const allowSameWeek of [false, true]){   /* 第一輪：跨週分散；第二輪：不足再補（可同週） */
    let pending = people.filter(p => p.chosen.length < p.need);
    let guard = 0;
    while (pending.length && guard++ < 500){
      pending.sort((a,b) => a.cands.length - b.cands.length);   /* 可選日子最少的人優先挑 */
      const p = pending[0];
      const d = pickDay(p, allowSameWeek);
      if (d == null){ pending.shift(); continue; }
      p.chosen.push(d); p.usedWeeks.add(weekOf(d, firstDow));
      p.cands = p.cands.filter(x => x !== d);
      slack[d]--;
      if (p.chosen.length >= p.need) pending = pending.filter(x => x !== p);
    }
  }

  const summary = [];
  for (const p of people){
    if (!sp[p.i]) sp[p.i] = {};
    p.chosen.forEach(d => { sp[p.i][d] = 'AL'; });
    const days_ = p.chosen.sort((a,b) => a-b).join('、');
    summary.push(p.chosen.length < p.need
      ? `${S.staff[p.i].name} ${days_ || '（找不到適合日子）'}（僅排到 ${p.chosen.length}/${p.need} 天）`
      : `${S.staff[p.i].name} ${days_} 日`);
  }
  saveState(); renderFixChips(); renderFixCal(); renderAlChips();
  document.getElementById('alStatus').textContent =
    `✓ 已安插 AL（${summary.join('；')}）— 請按「⚙ 自動排班」重新產生班表`;
}
function syncAll(){ saveState(); renderStaff(); renderHoliCal(); renderFixCal(); renderAlChips(); renderStep1Sum(); renderStep2Sum(); }

/* ============================================================
   排班流程精靈：①員工 → ②假別 → ③排班體檢 → ④定案
============================================================ */
let WSTEP = 1;
function gotoStep(n){
  WSTEP = Math.min(4, Math.max(1, n));
  try { sessionStorage.setItem('mk-wstep', String(WSTEP)); } catch(e){}
  document.querySelectorAll('#stepper .stp').forEach(b => {
    const k = Number(b.dataset.step);
    b.classList.toggle('active', k === WSTEP);
    b.classList.toggle('done', k < WSTEP);
  });
  ['wstep1','wstep2','wstep3','wstep4'].forEach((id, k) => {
    const el = document.getElementById(id);
    if (el) el.style.display = (k + 1 === WSTEP) ? '' : 'none';
  });
  if (WSTEP === 1) renderStep1Sum();
  if (WSTEP === 2) renderStep2Sum();
  if (WSTEP === 4) renderStep4Sum();
  window.scrollTo({ top: 0 });
}
function renderStep1Sum(){
  const el = document.getElementById('step1Sum');
  if (!el) return;
  const ex = exemptSet();
  const nReg = S.staff.length - ex.size;
  const quotas = [...new Set(S.staff.map((p,i) => quotaFor(i)))].join('／');
  const joiners = S.staff.map((p,i) => ({p,i,n:absentOf(i).size})).filter(x => x.n > 0 && x.n < monthInfo().days)
    .map(x => `${x.p.name}（${x.p.joined && absentOf(x.i).has(1) ? '到職 ' + x.p.joined : '離職 ' + x.p.left}，本月額度 ${quotaFor(x.i)} 天）`);
  const [y, m] = S.month.split('-');
  el.innerHTML = `排班月份 <b>${y} 年 ${Number(m)} 月</b> ・ 共 <b>${S.staff.length}</b> 位員工（業務 ${nReg} 位＋店長 ${ex.size} 位）・ 休假額度 ${quotas} 天${joiners.length ? ' ・ ' + joiners.join('；') : ''} ・ 晚班鎮店三人組：${S.trio.filter(Boolean).join('、')}`;
}
function renderStep2Sum(){
  const el = document.getElementById('step2Sum');
  if (!el) return;
  const hol = (S.holidays[S.month] || []).slice().sort((a,b) => a-b);
  const rows = S.staff.map((p,i) => {
    const parts = [];
    const mf = [...manualFixed(i)].sort((a,b) => a-b);
    if (mf.length) parts.push(`指休 ${mf.join('、')} 日`);
    const sp = specialOf(i);
    const bl = Object.keys(sp).filter(d => sp[d] === 'BL').map(Number).sort((a,b) => a-b);
    const al = Object.keys(sp).filter(d => sp[d] === 'AL').map(Number).sort((a,b) => a-b);
    if (bl.length) parts.push(`BL ${bl.join('、')} 日`);
    if (al.length) parts.push(`AL ${al.join('、')} 日`);
    const ol = Object.keys(sp).filter(d => sp[d] === 'OL').map(Number).sort((a,b) => a-b);
    if (ol.length) parts.push(`OL ${ol.join('、')} 日`);
    const bz = [...bizOf(i)].sort((a,b) => a-b);
    if (bz.length) parts.push(`出差 ${bz.join('、')} 日`);
    const ab = [...absentOf(i)].sort((a,b) => a-b);
    if (ab.length) parts.push(`不在職 ${ab[0]}–${ab[ab.length-1]} 日（${p.joined && ab[0]===1 ? '到職 ' + p.joined : '離職 ' + p.left}）`);
    const ag = assignOf(i);
    const agD = Object.keys(ag).map(Number).sort((a,b) => a-b);
    if (agD.length) parts.push(`指班 ${agD.map(d => `${d} 日${SHIFT_NAME[ag[d]]}`).join('、')}`);
    const wk = p.week || {};
    const wkWorks = DOW.filter((_,k) => wk[k] === 'work');
    const wkOffs = DOW.filter((_,k) => wk[k] === 'off');
    if (wkWorks.length) parts.push(`每週${wkWorks.join('、')}固定班`);
    if (wkOffs.length) parts.push(`每週${wkOffs.join('、')}固定休`);
    return `<tr><td style="text-align:left;font-weight:700;white-space:nowrap">${p.name}</td>
      <td style="text-align:left">${parts.length ? parts.join('；') : '<span style="color:var(--muted)">無特別安排 — 由系統自動排休</span>'}</td></tr>`;
  }).join('');
  el.innerHTML = `
    <div style="margin-bottom:8px">國定假日：${hol.length ? '<b>' + hol.join('、') + ' 日</b>' : '（本月無）'}</div>
    <div style="overflow-x:auto"><table class="stat-table" style="font-size:12.5px"><tbody>${rows}</tbody></table></div>`;
}
function renderStep4Sum(violations){
  const el = document.getElementById('step4Sum');
  if (!el) return;
  if (!RESULT){
    el.innerHTML = '<div class="viol">⚠ 尚未產生班表 — 請回步驟③先完成自動排班與體檢。</div>';
    return;
  }
  const v = violations || validate().violations;
  const [y, m] = S.month.split('-');
  el.innerHTML = `<div style="font-size:14.5px"><b>${y} 年 ${Number(m)} 月班表</b> ・ ${
    v.length === 0
      ? '<span style="color:var(--good);font-weight:700">✓ 體檢全數通過</span>'
      : `<span style="color:var(--crit);font-weight:700">尚有 ${v.length} 項提醒</span>（可回步驟③查看，接受亦可定案）`
  } ・ ${LOCKED ? '🔒 已鎖定' : '🔓 未鎖定'}</div>`;
}

/* ---------- init ---------- */
document.getElementById(S.trioMode === 'pair' ? 'tmPair' : 'tmAll3').checked = true;
document.querySelectorAll('input[name="trioMode"]').forEach(r =>
  r.addEventListener('change', () => { S.trioMode = document.getElementById('tmPair').checked ? 'pair' : 'all3'; saveState(); }));
document.getElementById('monthInput').value = S.month;
document.getElementById('monthInput').addEventListener('change', e => { S.month = e.target.value; syncAll(); restoreResult(); });
document.getElementById('addStaff').addEventListener('click', () => { S.staff.push({ name:'新員工', role:'SA', quota:10, week:{} }); syncAll(); });
document.getElementById('genBtn').addEventListener('click', generate);
document.getElementById('regenBtn').addEventListener('click', async () => {
  if (manualEdits.size > 0 && !await uiConfirm('重新排班',
      `你已手動調整 ${manualEdits.size} 格班別。\n重排會產生新方案並覆蓋這些調整，確定要重排嗎？`)) return;
  generate();
});
document.getElementById('alAutoBtn').addEventListener('click', autoInsertAL);
document.querySelectorAll('#stepper .stp').forEach(b =>
  b.addEventListener('click', () => gotoStep(Number(b.dataset.step))));
document.getElementById('csvBtn').addEventListener('click', exportCsv);
document.getElementById('xlsxBtn').addEventListener('click', exportCompanyExcel);
document.getElementById('undoBtn').addEventListener('click', undo);
document.getElementById('lockBtn').addEventListener('click', toggleLock);
document.getElementById('clearBtn').addEventListener('click', clearResult);
document.getElementById('pdfBtn').addEventListener('click', () => {
  if (!RESULT) return alert('請先產生排班表');
  const [y,m] = S.month.split('-');
  document.getElementById('printTitle').textContent = `${y} 年 ${Number(m)} 月排班表`;
  const now = new Date();
  document.getElementById('printMeta').textContent =
    `產出時間 ${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} · A 早／M 中／P 晚／RL 例假／RL/ 休假 · BL/AL = 特殊假 · 底線 = 指休`;
  window.print();   /* 列印對話框選「另存為 PDF」即可 */
});
runMigrations();   /* 補寫規則已談定、但這台裝置的存檔還沒有的資料 */
renderStaff(); renderHoliCal(); renderFixCal(); renderAlChips(); renderStep1Sum();
restoreResult();   /* 開啟頁面時自動載入本月已存的班表 */
gotoStep(Number(sessionStorage.getItem('mk-wstep')) || 1);   /* 回到上次所在步驟 */

/* ============================================================
   同事看班（預設畫面）＋ 店長 PIN 後台 ＋ 發布
============================================================ */
const ADMIN_PIN = '0000';
let pubSel = { month: null, person: -1 };

/* ------------------------------------------------------------
   頁內對話框 — 取代 prompt()／confirm()
   LINE、FB、IG 等 App 內建瀏覽器與部分 webview 會「直接忽略」原生
   prompt()／confirm()：prompt 回傳 null、confirm 回傳 false，畫面毫無
   反應，使用者只會看到「按了沒用」。改用頁內元素才能在所有環境運作。
------------------------------------------------------------ */
function uiDialog({ title, desc, input, okText = '確定', cancelText = '取消', okOnly = false }){
  return new Promise(resolve => {
    const back = document.createElement('div');
    back.className = 'dlg-back';
    back.innerHTML = `
      <div class="dlg" role="dialog" aria-modal="true">
        <div class="dlg-title"></div>
        <div class="dlg-desc"></div>
        ${input ? `<input class="dlg-input" type="${input.password ? 'password' : 'text'}"
            inputmode="${input.password ? 'numeric' : 'text'}" placeholder="${input.placeholder || ''}">` : ''}
        <div class="dlg-btns">
          <button class="btn ghost dlg-no"></button>
          <button class="btn gold dlg-ok"></button>
        </div>
      </div>`;
    back.querySelector('.dlg-title').textContent = title || '';
    back.querySelector('.dlg-desc').textContent = desc || '';
    back.querySelector('.dlg-ok').textContent = okText;
    back.querySelector('.dlg-no').textContent = cancelText;
    const field = back.querySelector('.dlg-input');
    if (!desc) back.querySelector('.dlg-desc').style.display = 'none';
    if (okOnly) back.querySelector('.dlg-no').style.display = 'none';

    const done = val => { document.removeEventListener('keydown', onKey); back.remove(); resolve(val); };
    const ok = () => done(field ? field.value : true);
    const no = () => done(field ? null : false);
    function onKey(e){
      if (e.key === 'Escape') no();
      else if (e.key === 'Enter' && field) ok();
    }
    back.querySelector('.dlg-ok').addEventListener('click', ok);
    back.querySelector('.dlg-no').addEventListener('click', no);
    back.addEventListener('click', e => { if (e.target === back) no(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(back);
    if (field) field.focus();
  });
}
const uiPrompt  = (title, desc, opts = {}) => uiDialog({ title, desc, input: opts });
const uiConfirm = (title, desc) => uiDialog({ title, desc });
const uiAlert   = (title, desc) => uiDialog({ title, desc, okOnly: true, okText: '知道了' });
/* 舊有的 alert() 在 App 內建瀏覽器同樣會被忽略 — 統一改走頁內對話框。
   宣告在此之後才被呼叫（全部都在事件處理器內），不會有 TDZ 問題。 */
window.alert = (msg) => { uiAlert(String(msg)); };

function pubData(){ return window.MK_SCHED_PUB || {}; }

async function enterAdmin(){
  const pin = await uiPrompt('店長排班', '請輸入店長密碼', { password: true, placeholder: '密碼' });
  if (pin === null) return;
  if (pin !== ADMIN_PIN){ await uiConfirm('密碼錯誤', '請再試一次。'); return; }
  sessionStorage.setItem('mk-admin','1');
  applyMode();
}
function exitAdmin(){ sessionStorage.removeItem('mk-admin'); applyMode(); }
function applyMode(){
  const admin = sessionStorage.getItem('mk-admin') === '1';
  document.getElementById('adminArea').style.display = admin ? '' : 'none';
  document.getElementById('viewerWrap').style.display = admin ? 'none' : '';
  document.getElementById('adminBtn').textContent = '🔑 店長排班';
  if (!admin) renderViewer();
  else window.scrollTo({top: document.getElementById('adminArea').offsetTop - 20});
}

/* ---- viewer ---- */
function renderViewer(){
  const pub = pubData();
  const months = Object.keys(pub).sort().reverse();
  const selEl = document.getElementById('pubMonthSel');
  if (!months.length){
    document.getElementById('pubBody').style.display = 'none';
    document.getElementById('pubEmpty').style.display = '';
    /* 空下拉看起來像壞掉 — 明講「還沒有已發布的班表」並停用選單 */
    selEl.innerHTML = '<option>尚無已發布的班表</option>';
    selEl.disabled = true;
    return;
  }
  selEl.disabled = false;
  document.getElementById('pubBody').style.display = '';
  document.getElementById('pubEmpty').style.display = 'none';
  if (!pubSel.month || !pub[pubSel.month]) pubSel.month = months[0];
  selEl.innerHTML = months.map(m => `<option value="${m}" ${m===pubSel.month?'selected':''}>${m.replace('-',' 年 ')} 月</option>`).join('');
  const rec = pub[pubSel.month];
  const [y,mm] = pubSel.month.split('-').map(Number);
  const dow = d => new Date(y, mm-1, d).getDay();
  const holi = new Set(rec.holidays || []);
  const today = new Date();
  const todayD = (today.getFullYear()===y && today.getMonth()+1===mm) ? today.getDate() : -1;

  /* person filter chips */
  document.getElementById('pubChips').innerHTML =
    `<button class="pchip ${pubSel.person<0?'active':''}" onclick="pubSel.person=-1;renderViewer()">全部</button>` +
    rec.staff.map((p,i) => `<button class="pchip ${pubSel.person===i?'active':''}" onclick="pubSel.person=${i};renderViewer()">${p.name}</button>`).join('');

  const pubHead = () => {
    let hh = '<thead><tr><th class="name-col">員工</th>';
    for (let d=1; d<=rec.days; d++){
      const w = dow(d), hl = holi.has(d);
      hh += `<th class="${hl?'holi':(w===0||w===6?'wkend':'')}" ${d===todayD?'style="background:var(--gold-wash);color:var(--gold-dark);font-weight:700"':''}>${d}<span class="dow">${DOW[w]}${hl?' 假':''}</span></th>`;
    }
    return hh + '</tr></thead>';
  };
  const pubRow = (p, i) => {
    let hh = `<tr><td class="name-col">${p.name}<span class="role-tag">${p.role}</span></td>`;
    const sp = (rec.special||{})[i] || {};
    const asg = (rec.assign||{})[i] || {};
    for (let d=1; d<=rec.days; d++){
      const s = rec.grid[i][d];
      const isAsg = asg[d] !== undefined && s === asg[d];
      const label = (s===3 && sp[d]) ? sp[d] : cellCode(s, d, x => { const w = dow(x); return w===0 || w===6 || holi.has(x); });
      const spStyle = (s===3 && sp[d]) ? 'color:var(--gold-dark);font-weight:700' : '';
      hh += `<td><div class="cell s${s} ${isAsg?'asg':''}" style="cursor:default;${spStyle}${d===todayD?';outline:2px solid var(--gold);outline-offset:-2px':''}">${label}</div></td>`;
    }
    return hh + '</tr>';
  };

  /* 單一班表：規則外人力（店長／不計人力者）排在最下面；統計列不計這些人。
     舊的發布資料沒有 extra 欄位，會自動退回「只看店長」的舊行為。 */
  const isExtra = q => q.role === '店長' || q.extra;
  let exRows = '', regRows = '';
  rec.staff.forEach((p,i) => {
    if (pubSel.person >= 0 && pubSel.person !== i) return;
    if (isExtra(p)) exRows += pubRow(p, i);
    else regRows += pubRow(p, i);
  });
  let foot = '';
  if (pubSel.person < 0){
    foot = '<tfoot><tr><td class="name-col" style="font-weight:400;color:var(--muted)">A/M/P<br><span style="font-size:9px">（不含額外人力）</span></td>';
    for (let d=1; d<=rec.days; d++){
      let m=0, mid=0, e=0;
      rec.staff.forEach((p,i) => {
        if (isExtra(p)) return;
        const s = rec.grid[i][d];
        if(s===0)m++; else if(s===1)mid++; else if(s===2)e++;
      });
      foot += `<td class="num" style="font-size:10px;padding:5px 2px;color:var(--muted);background:var(--paper)">${m}/${mid}/${e}</td>`;
    }
    foot += '</tr></tfoot>';
  }
  document.getElementById('pubTable').innerHTML = pubHead() + '<tbody>' + exRows + regRows + '</tbody>' + foot;
  document.getElementById('pubMeta').textContent = `發布時間：${rec.savedAt || '—'} · 如有異動以最新發布為準 · A/M/P 人數不含額外人力（店長等）`;
}
document.getElementById('pubMonthSel').addEventListener('change', e => { pubSel.month = e.target.value; pubSel.person = -1; renderViewer(); });
document.getElementById('adminBtn').addEventListener('click', () => {
  if (sessionStorage.getItem('mk-admin') === '1') applyMode();
  else enterAdmin();
});

/* ---- publish ---- */
function buildPubRecord(){
  return {
    days: RESULT.days,
    grid: RESULT.grid,
    staff: S.staff.map(p => ({ name: p.name, role: p.role, extra: !!p.extra })),
    holidays: S.holidays[S.month] || [],
    special: (S.special||{})[S.month] || {},
    assign: (S.assign||{})[S.month] || {},
    savedAt: new Date().toISOString().slice(0,16).replace('T',' '),
  };
}
async function publish(){
  if (!RESULT){ alert('請先產生班表'); return; }
  let token = localStorage.getItem('mk-gh-token');
  if (!token){
    token = await uiPrompt('設定 GitHub Token',
      '第一次發布需要設定 Token（只需一次，之後自動記住）：\n' +
      '1. github.com → Settings → Developer settings → Fine-grained tokens → Generate new token\n' +
      '2. Repository access 選「Only select repositories」→ MK-monthly\n' +
      '3. Permissions → Contents → Read and write\n' +
      '4. 產生後貼在下面\n\n' +
      '按取消可改用「下載檔案」請 Claude 代為發布。',
      { placeholder: 'github_pat_...' });
    if (!token || !token.trim()){ downloadPubFile(); return; }
    localStorage.setItem('mk-gh-token', token.trim());
    token = token.trim();
  }
  const st = document.getElementById('status');
  st.textContent = '發布中…';
  try {
    const pub = { ...pubData() };
    pub[S.month] = buildPubRecord();
    const content = '/* 已發布的班表 — 由排班頁「發布給同事」自動更新，請勿手動編輯 */\nwindow.MK_SCHED_PUB = ' + JSON.stringify(pub) + ';\n';
    const api = 'https://api.github.com/repos/VitoKOK-lab/MK-monthly/contents/data/schedule/published.js';
    const headers = { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json' };
    let sha;
    const g = await fetch(api + '?ref=main', { headers });
    if (g.ok) sha = (await g.json()).sha;
    const put = await fetch(api, {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `Publish schedule ${S.month}`,
        content: btoa(unescape(encodeURIComponent(content))),
        sha, branch: 'main',
      }),
    });
    if (!put.ok){
      const err = await put.json().catch(()=>({}));
      if (put.status === 401 || put.status === 403){ localStorage.removeItem('mk-gh-token'); throw new Error('Token 無效或權限不足（已清除，請重試重新輸入）'); }
      throw new Error(err.message || ('HTTP ' + put.status));
    }
    window.MK_SCHED_PUB = pub;   /* 本機立即生效 */
    st.textContent = '✓ 已發布！同事約 1–2 分鐘後重新整理頁面即可看到新班表';
  } catch(e){
    st.textContent = '⚠ 發布失敗：' + e.message + '（可改用下載檔案）';
    if (await uiConfirm('線上發布失敗', e.message + '\n\n要下載班表檔案改用手動方式嗎？')) downloadPubFile();
  }
}
function downloadPubFile(){
  const pub = { ...pubData() };
  pub[S.month] = buildPubRecord();
  const content = '/* 已發布的班表 — 由排班頁「發布給同事」自動更新，請勿手動編輯 */\nwindow.MK_SCHED_PUB = ' + JSON.stringify(pub) + ';\n';
  const blob = new Blob([content], { type: 'text/javascript' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'published.js';
  a.click();
  alert('已下載 published.js。\n把這個檔案傳給 Claude 說「發布班表」，或自行上傳到 GitHub 的 data/schedule/ 資料夾覆蓋。');
}
document.getElementById('pubBtn').addEventListener('click', publish);

applyMode();
