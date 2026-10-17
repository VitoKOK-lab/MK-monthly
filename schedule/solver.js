/* ============================================================
   schedule/solver.js
   求解器：休假日分配（模擬退火）→ 班別分配 → 體檢 validate()。
   純計算，不碰 DOM；只讀 rules.js 提供的 S 與 helper。
============================================================ */

/* ============================================================
   PHASE 1 — 休假日分配
============================================================ */
function scoreOff(off, cfg){
  const { days, N, quotas, trioIdx, exempt } = cfg;
  const altIdx = cfg.altIdx || new Set();   /* 喜歡做一休一的人（Liv/Demi） */
  let sc = 0;
  /* offCount 只計「規則內」員工 — 店長為規則外額外人力，不佔人力數；
     出差日視同不在店，一併從當日人力扣除 */
  const offCount = new Array(days+1).fill(0);
  const bizCnt = new Array(days+1).fill(0);
  let nReg = 0;
  for (let i=0;i<N;i++){
    if (exempt.has(i)) continue;
    nReg++;
    for (const d of (cfg.biz && cfg.biz[i] ? cfg.biz[i] : [])) bizCnt[d]++;
  }
  for (let i=0;i<N;i++){
    const isEx = exempt.has(i);
    let restDays = 0;
    for (const d of off[i]) { if (!isEx) offCount[d]++; if (isRest(d)) restDays++; }
    if (off[i].size !== quotas[i]) sc += 1000 * Math.abs(off[i].size - quotas[i]);
    if (!isEx){
      if (restDays > 3) sc += 800 * (restDays - 3);          /* 假日休上限 3（硬） */
      if (restDays === 3) sc += 60;                          /* 3 天可通融，但優先 2 天 */
      if (restDays < 2) sc += 120 * (2 - restDays);          /* 假日至少休 2（公平性） */
    }
    /* 連上偏好：Liv/Demi 喜歡做一休一（工作段越短越好）；
       其他人不喜歡單日工作段（傾向連上 2–3 天）；連四重罰、連五禁止 */
    const likesAlt = altIdx.has(i);
    let run = 0;
    for (let d=1; d<=days; d++){
      if (off[i].has(d)){
        if (likesAlt){ if (run >= 2) sc += (run - 1) * 8; }
        else if (run === 1) sc += 25;
        run = 0;
      }
      else { run++; if (run === 4) sc += 60; else if (run > 4) sc += 500; }  /* 連四哇哇叫、連五爆炸 */
    }
    if (run > 4) sc += 500 * (run - 4);
    else if (likesAlt && run >= 2) sc += (run - 1) * 8;
  }
  for (let d=1; d<=days; d++){
    const workers = nReg - offCount[d] - bizCnt[d];
    const dem = demand(d);
    if (workers < dem.min) sc += 1000 * (dem.min - workers);
    /* 超過上限＝晚班擠太多人（假日晚班上限 4、平日 3），罰則需夠重才會被真正避開，
       但仍低於「人力不足」，確保萬一無解時寧可多一人上班也不要缺人。 */
    if (workers > dem.cap) sc += 400 * (workers - dem.cap);
    /* 平日晚班 2–3 人都合規，但 3 人尤佳 → 有餘裕時輕推到滿編。
       （本店人力通常只夠少數幾天達成，這是軟性偏好，達不到不算違規。） */
    if (dem.pref && workers < dem.pref) sc += 10 * (dem.pref - workers);
  }
  if (trioIdx.length >= 2){
    const th = cfg.trioMode === 'pair' ? 2 : Math.min(3, trioIdx.length);
    for (let d=1; d<=days; d++){
      let c = 0;
      for (const i of trioIdx) if (off[i].has(d)) c++;
      if (c >= th) sc += 800 * (c - th + 1);
    }
  }
  /* 禁止 Liv、Demi 同一個週一都休（避免店長被迫在週一鎮晚班） */
  if (altIdx.size >= 2){
    const alt = [...altIdx];
    for (let d=1; d<=days; d++){
      if (dowOf(d) === 1 && alt.every(i => off[i].has(d))) sc += 900;
    }
  }
  return sc;
}

function solveOff(cfg, rng){
  const { days, N, quotas, fixed, blocked } = cfg;
  const off = [];
  for (let i=0;i<N;i++){
    const s = new Set(fixed[i]);
    const pool = [];
    for (let d=1; d<=days; d++) if (!s.has(d) && !blocked[i].has(d)) pool.push(d);
    while (s.size < quotas[i] && pool.length){
      const k = Math.floor(rng()*pool.length);
      s.add(pool.splice(k,1)[0]);
    }
    off.push(s);
  }
  let cur = scoreOff(off, cfg);
  let T = 60;
  const ITER = 24000;
  for (let t=0; t<ITER; t++){
    T *= 0.99975;
    if (rng() < 0.5){
      const i = Math.floor(rng()*N);
      const movable = [...off[i]].filter(d => !fixed[i].has(d));
      if (!movable.length) continue;
      const from = movable[Math.floor(rng()*movable.length)];
      const to = 1 + Math.floor(rng()*days);
      if (off[i].has(to) || blocked[i].has(to)) continue;
      off[i].delete(from); off[i].add(to);
      const ns = scoreOff(off, cfg);
      if (ns <= cur || rng() < Math.exp((cur-ns)/T)) cur = ns;
      else { off[i].delete(to); off[i].add(from); }
    } else {
      const i = Math.floor(rng()*N);
      let j = Math.floor(rng()*N);
      if (i === j) continue;
      const mi = [...off[i]].filter(d => !fixed[i].has(d) && !off[j].has(d) && !blocked[j].has(d));
      const mj = [...off[j]].filter(d => !fixed[j].has(d) && !off[i].has(d) && !blocked[i].has(d));
      if (!mi.length || !mj.length) continue;
      const a = mi[Math.floor(rng()*mi.length)];
      const b = mj[Math.floor(rng()*mj.length)];
      off[i].delete(a); off[i].add(b);
      off[j].delete(b); off[j].add(a);
      const ns = scoreOff(off, cfg);
      if (ns <= cur || rng() < Math.exp((cur-ns)/T)) cur = ns;
      else {
        off[i].delete(b); off[i].add(a);
        off[j].delete(a); off[j].add(b);
      }
    }
  }
  cur = repairOff(off, cfg, cur);
  return { off, score: cur };
}

function repairOff(off, cfg, cur){
  const { days, N, fixed, blocked } = cfg;
  let guard = 0, improved = true;
  while (improved && cur > 0 && guard++ < 14){
    improved = false;
    for (let i=0; i<N; i++){
      const movable = [...off[i]].filter(d => !fixed[i].has(d));
      for (const from of movable){
        let bestTo = null, bestSc = cur;
        for (let to=1; to<=days; to++){
          if (off[i].has(to) || blocked[i].has(to)) continue;
          off[i].delete(from); off[i].add(to);
          const s = scoreOff(off, cfg);
          off[i].delete(to); off[i].add(from);
          if (s < bestSc){ bestSc = s; bestTo = to; }
        }
        if (bestTo !== null){
          off[i].delete(from); off[i].add(bestTo);
          cur = bestSc; improved = true;
        }
      }
    }
    if (!improved && cur > 0){
      outer:
      for (let i=0; i<N; i++){
        for (let j=i+1; j<N; j++){
          const mi = [...off[i]].filter(d => !cfg.fixed[i].has(d) && !off[j].has(d) && !blocked[j].has(d));
          const mj = [...off[j]].filter(d => !cfg.fixed[j].has(d) && !off[i].has(d) && !blocked[i].has(d));
          for (const a of mi){
            for (const b of mj){
              off[i].delete(a); off[i].add(b);
              off[j].delete(b); off[j].add(a);
              const s = scoreOff(off, cfg);
              if (s < cur){ cur = s; improved = true; break outer; }
              off[i].delete(b); off[i].add(a);
              off[j].delete(a); off[j].add(b);
            }
          }
        }
      }
    }
  }
  return cur;
}

/* ============================================================
   PHASE 2 — 班別分配
============================================================ */
function assignShifts(off, cfg){
  const { days, N } = cfg;
  const grid = Array.from({length:N}, () => new Array(days+1).fill(3));
  const mCount = new Array(N).fill(0);
  const midCount = new Array(N).fill(0);   /* 中班次數，用來公平輪中班 */
  const eveCount = new Array(N).fill(0);   /* 晚班次數，用來公平輪鎮店與晚班 */
  /* 晚班鎮店：互斥名單三人（Wiggie/Liv/Demi）每天至少一人晚班；
     Wiggie 沒上晚班時由 Liv、Demi 輪流補位 */
  const wiggieIdx = S.staff.findIndex(s => s.name === S.trio[0]);
  const livIdx    = S.staff.findIndex(s => s.name === S.trio[1]);
  const demiIdx   = S.staff.findIndex(s => s.name === S.trio[2]);
  const trioAll   = [wiggieIdx, livIdx, demiIdx].filter(i => i >= 0);
  let lastCover = demiIdx;   /* 上一位補晚班的人（Liv/Demi 輪流用） */

  const exempt = cfg.exempt || exemptSet();
  /* 有效指班（手動指班 ＋ 週律固定早班）— 迴圈內會反覆查詢，先展開一次 */
  const asgAll = S.staff.map((_, i) => effAssign(i));

  for (let d=1; d<=days; d++){
    /* 0a. 出差：不在店，畫記 4，之後所有分配都跳過 */
    const workers = [];
    for (let i=0;i<N;i++){
      if (off[i].has(d)) continue;
      if (bizOf(i).has(d)){ grid[i][d] = 4; continue; }
      workers.push(i);
    }
    if (!workers.length) continue;
    const dem = demand(d);
    const w = dowOf(d);
    /* 0b. 指班：先套用強制班別（硬條件） */
    workers.forEach(i => {
      const a = asgAll[i][d];
      if (a !== undefined){
        grid[i][d] = a;
        if (!exempt.has(i)){ if (a === 0) mCount[i]++; else if (a === 1) midCount[i]++; else if (a === 2) eveCount[i]++; }
      }
    });
    /* 人力規則只對「規則內」員工計數；店長是額外加上去的 */
    const regular = workers.filter(i => !exempt.has(i));

    /* 1. 晚班鎮店：若已有管理職被指班晚班則直接算數；否則鎖定一位。
       規則外人力（店長）鎮店是「免費」的 — 不佔計入的晚班名額，所以優先由他頂；
       他不在時才在 Liv/Demi 之間挑「目前晚班最少」的人，避免這兩位被鎮店綁死
       （曾出現 Liv 整月 15 個晚班、中班只有 1 個）。 */
    let anchor = -1;
    const preEve = trioAll.filter(t => workers.includes(t) && grid[t][d] === 2);
    if (preEve.length){
      anchor = preEve[0];
      if (anchor === livIdx || anchor === demiIdx) lastCover = anchor;
    } else {
      const avail = i => i >= 0 && workers.includes(i) && grid[i][d] === 3;
      const cands = trioAll.filter(avail);
      if (cands.length){
        /* 三人之中挑「目前晚班最少」的頂，同分時沿用上一輪的輪替方向 */
        const lo = Math.min(...cands.map(t => eveCount[t]));
        const tied = cands.filter(t => eveCount[t] === lo);
        anchor = tied.length > 1 && tied.includes(lastCover)
          ? tied.find(t => t !== lastCover) : tied[0];
        if (anchor === livIdx || anchor === demiIdx) lastCover = anchor;
      }
      else if (avail(wiggieIdx)) anchor = wiggieIdx;
      if (anchor >= 0){ grid[anchor][d] = 2; eveCount[anchor]++; }   /* 規則外人力也計，鎮店才輪得平均 */
    }

    /* 2. 早班（週一早班盡量從前一天週日晚班的人挑；
       其中「週二剛好休假」的人最優先 — 晚→早→休 補償輪轉；
       Demi 減少早班：挑選時排最後順位） */
    const pool = regular.filter(i => grid[i][d] === 3);
    let mHave = regular.filter(i => grid[i][d] === 0).length;
    const morning = [];
    const demiBias = i => i === demiIdx ? 100 : 0;
    if (w === 1 && d > 1){
      const tueOff = i => (d + 1 <= days) && off[i].has(d + 1);
      const sunEve = pool.filter(i => grid[i][d-1] === 2)
        .sort((a,b) => (demiBias(a) - demiBias(b)) || (tueOff(b) - tueOff(a)) || (mCount[a] - mCount[b]));
      for (const i of sunEve){ if (mHave + morning.length >= dem.m) break; morning.push(i); }
    }
    const fairKey = i => mCount[i] + (d>1 && grid[i][d-1]===2 ? 0.6 : 0) + demiBias(i);
    const sorted = pool.slice().sort((a,b) => fairKey(a) - fairKey(b));
    for (const i of sorted){
      if (mHave + morning.length >= dem.m) break;
      if (!morning.includes(i)) morning.push(i);
    }
    morning.forEach(i => { grid[i][d] = 0; mCount[i]++; });

    /* 3. 中班／晚班（只以規則內員工湊數）
       假日固定 1 中班；週二/五「早1」必開 1 中班；週一/三/四「早2」不開中班 */
    let rest = regular.filter(i => grid[i][d] === 3);
    const midHave = regular.filter(i => grid[i][d] === 1).length;
    const mids = Math.max(0, Math.min(dem.mid - midHave, rest.length));
    /* 中班也要公平輪 — 依「目前中班次數」由少到多挑，否則會固定落在名單前面的人
       （曾出現某位同事整月 13 個中班、另一位 0 個）。晚班是扣掉早/中後的其餘人，
       早班與中班都平均了，晚班自然跟著平均。 */
    rest.sort((a,b) => midCount[a] - midCount[b]);
    for (let k=0; k<mids; k++){ const i = rest.shift(); grid[i][d] = 1; midCount[i]++; }
    rest.forEach(i => { grid[i][d] = 2; eveCount[i]++; });

    /* 4. 店長（不做業績、只算人頭）上班日班別：
       前一天休假 → 晚班；前一天有上班（含出差）→ 中班（週日接週六休＝晚班、
       週一接週日班＝中班，自動滿足「週一固定中班」）；
       Liv/Demi 同天都休時已被步驟 1 鎮為晚班；指班日已於步驟 0b 套用 */
    workers.filter(i => exempt.has(i) && grid[i][d] === 3)
           .forEach(i => { grid[i][d] = (d > 1 && grid[i][d-1] === 3) ? 2 : 1; });
  }

  /* 早班平衡修復（只平衡規則內員工；Demi 與週律固定早班者不計入平衡；
     不可換走當天唯一的管理職晚班；不可動指班格）
     掃描所有落差 ≥2 的配對，避免單一配對無日可換就卡住 */
  const canTake = (i, d) =>
    (grid[i][d]===1 || grid[i][d]===2) &&
    asgAll[i][d] === undefined &&
    !(grid[i][d]===2 && trioAll.includes(i) && !trioAll.some(t => t !== i && grid[t][d] === 2));
  const peers = [];
  for (let i=0;i<N;i++) if (!exempt.has(i) && i !== demiIdx && !mornFixed(i)) peers.push(i);
  const balancePeers = () => {
    for (let pass=0; pass<80; pass++){
      let done = false;
      const order = peers.slice().sort((a,b) => mCount[b] - mCount[a]);
      outer:
      for (const hi of order){
        for (let k=order.length-1; k>=0; k--){
          const lo = order[k];
          if (mCount[hi] - mCount[lo] <= 1) continue;
          for (let d=1; d<=days; d++){
            if (grid[hi][d]===0 && asgAll[hi][d] === undefined && canTake(lo, d)){
              const tmp = grid[lo][d]; grid[lo][d] = 0; grid[hi][d] = tmp;
              mCount[hi]--; mCount[lo]++; done = true;
              break outer;
            }
          }
        }
      }
      if (!done) break;
    }
  };
  balancePeers();

  /* Demi 早班：刻意比別人少「約 3 天」，但不可為 0（目標 = 其他人平均 − 3，至少 1 天）。
     兩個方向都要修 — 太少就從早班最多的人手上換過來，太多就讓給早班最少的人。
     換完再跑一次平衡，避免為了喬 Demi 反而把某位同事的早班壓出新的落差。 */
  if (demiIdx >= 0 && !exempt.has(demiIdx) && peers.length){
    const peerAvg = peers.reduce((a,i) => a + mCount[i], 0) / peers.length;
    const target = Math.max(1, Math.round(peerAvg) - DEMI_MORN_GAP);
    /* 把 hi 的一個早班換給 lo（lo 當天要是可動的中/晚班） */
    const swapMorning = (hi, lo) => {
      for (let d=1; d<=days; d++){
        if (grid[hi][d] !== 0 || asgAll[hi][d] !== undefined) continue;
        if (!canTake(lo, d)) continue;
        const tmp = grid[lo][d];
        grid[lo][d] = 0; grid[hi][d] = tmp;
        mCount[lo]++; mCount[hi]--;
        return true;
      }
      return false;
    };
    for (let guard=0; guard<40 && mCount[demiIdx] < target; guard++){
      /* 太少：從早班最多的人補過來，且捐出後仍須多於 Demi，維持「Demi 最少」 */
      const donors = peers.slice().sort((a,b) => mCount[b] - mCount[a])
                          .filter(hi => mCount[hi] >= mCount[demiIdx] + 2);
      if (!donors.some(hi => swapMorning(hi, demiIdx))) break;
    }
    for (let guard=0; guard<40 && mCount[demiIdx] > target; guard++){
      /* 太多：讓給早班最少的人 */
      const takers = peers.slice().sort((a,b) => mCount[a] - mCount[b]);
      if (!takers.some(lo => swapMorning(demiIdx, lo))) break;
    }
    balancePeers();
  }
  return grid;
}


/* ============================================================
   驗證 + 統計
============================================================ */
function validate(){
  const { grid, days } = RESULT;
  const N = S.staff.length;
  const v = [];
  const stats = [];
  const trioIdx = S.trio.map(n => S.staff.findIndex(s => s.name===n)).filter(i => i>=0);
  const exempt = exemptSet();
  const demiIdxV = S.staff.findIndex(p => p.name === S.trio[2]);
  const livIdxV = S.staff.findIndex(p => p.name === S.trio[1]);
  const mCounts = [], midCounts = [], eveCounts = [];
  for (let i=0;i<N;i++){
    const sp = specialSet(i);
    const isEx = exempt.has(i);
    const asg = effAssign(i);
    let offN=0, restOff=0, spN=0, bizN=0, m=0, mid=0, e=0, maxRun=0, run=0;
    for (let d=1; d<=days; d++){
      const s = grid[i][d];
      if (s===3){
        if (sp.has(d)) spN++; else offN++;
        if (isRest(d)) restOff++;
        run=0;
      }
      else { run++; maxRun = Math.max(maxRun, run); if (s===0) m++; else if (s===1) mid++; else if (s===2) e++; else if (s===4) bizN++; }
    }
    if (!isEx && i !== demiIdxV && !mornFixed(i)) mCounts.push(m);
    /* 晚班平衡不計 Liv/Demi：「晚班鎮店」本來就讓兩人晚班偏多，計入必然誤報 */
    if (!isEx){ midCounts.push(mid); if (i !== livIdxV && i !== demiIdxV) eveCounts.push(e); }
    /* 店長與「不計人力」的額外人力不排早班（柏鴻的週律固定早班除外） */
    if (isEx && m > 0 && !mornFixed(i) && !Object.values(asg).includes(0))
      v.push(`${S.staff[i].name}：排了 ${m} 個早班（規則外人力不上早班）`);
    stats.push({ offN, restOff, spN, bizN, m, mid, e, maxRun });
    if (offN !== S.staff[i].quota) v.push(`${S.staff[i].name}：正常休假 ${offN} 天 ≠ 額度 ${S.staff[i].quota} 天`);
    if (!isEx){
      if (restOff > 3) v.push(`${S.staff[i].name}：假日休了 ${restOff} 天（上限 3 天）`);
      if (restOff < 2) v.push(`${S.staff[i].name}：假日只休 ${restOff} 天（建議 2–3 天，公平性提醒）`);
    }
    if (maxRun > 4) v.push(`${S.staff[i].name}：連續上班 ${maxRun} 天（連五爆炸，禁止）`);
    for (const d of fixedOf(i)) if (grid[i][d] !== 3) v.push(`${S.staff[i].name}：${d} 日為指休/固定休/特殊假，卻被排班`);
    for (const d of weeklyDays(i,'work')) if (grid[i][d] === 3) v.push(`${S.staff[i].name}：${d} 日為週律固定上班，卻排了休假`);
    for (const d of bizOf(i)) if (grid[i][d] !== 4) v.push(`${S.staff[i].name}：${d} 日為出差，卻被排班或休假`);
    for (const dStr of Object.keys(asg)){
      const dd = Number(dStr);
      if (grid[i][dd] !== asg[dStr]) v.push(`${S.staff[i].name}：${dd} 日為指班（${SHIFT_NAME[asg[dStr]]}），實際排成「${SHIFT_NAME[grid[i][dd]] || '?'}」`);
    }
  }
  if (mCounts.length){
    const mMax = Math.max(...mCounts), mMin = Math.min(...mCounts);
    if (mMax - mMin > 1) v.push(`早班天數落差 ${mMax - mMin}（最多 ${mMax}、最少 ${mMin}，應 ≤ 1，店長/${S.trio[2]}/週律固定早班者不計）`);
  }
  /* 中／晚班也要盡量平均（規則外人力不計）。早班另有 ≤1 的嚴格檢查，
     中晚班受每日班型與休假日牽動，落差門檻放寬到 3。 */
  const spread = (arr, name, lim) => {
    if (arr.length < 2) return;
    const hi = Math.max(...arr), lo = Math.min(...arr);
    if (hi - lo > lim) v.push(`${name}天數落差 ${hi - lo}（最多 ${hi}、最少 ${lo}，應 ≤ ${lim}，規則外人力不計）`);
  };
  spread(midCounts, '中班', 3);
  spread(eveCounts, `晚班（${S.trio[1]}/${S.trio[2]} 鎮店不計）`, 3);
  /* Demi 早班刻意比別人少約 DEMI_MORN_GAP 天，但不可為 0、也不該差太多 */
  if (demiIdxV >= 0 && !exempt.has(demiIdxV)){
    let dm = 0;
    for (let d=1; d<=days; d++) if (grid[demiIdxV][d] === 0) dm++;
    if (dm === 0) v.push(`${S.staff[demiIdxV].name}：整月 0 個早班（可比別人少，但不應完全沒有）`);
    else if (mCounts.length){
      const avg = mCounts.reduce((a,b) => a+b, 0) / mCounts.length;
      const gap = avg - dm;
      if (gap > DEMI_MORN_GAP + 1.5)
        v.push(`${S.staff[demiIdxV].name}：早班 ${dm} 天，比其他人平均少 ${gap.toFixed(1)} 天（目標約少 ${DEMI_MORN_GAP} 天，差太多）`);
    }
  }
  const th = S.trioMode === 'pair' ? 2 : Math.min(3, trioIdx.length);
  for (let d=1; d<=days; d++){
    let c=0;
    for (const i of trioIdx) if (grid[i][d]===3) c++;
    if (c>=th && th>=2) v.push(`${d} 日：互斥名單 ${c} 人同日休（${trioIdx.filter(i=>grid[i][d]===3).map(i=>S.staff[i].name).join('、')}）`);
    if (dowOf(d) === 1 && livIdxV >= 0 && demiIdxV >= 0 && grid[livIdxV][d] === 3 && grid[demiIdxV][d] === 3)
      v.push(`${d} 日（週一）：${S.trio[1]} 與 ${S.trio[2]} 同時休假（週一禁止兩人同休）`);
    /* 每日人力結構只計「規則內」員工（店長為額外人力不計數；出差不在店不計） */
    let m=0, mid=0, e=0, workers=0;
    for (let i=0;i<N;i++){ if (exempt.has(i)) continue; const s=grid[i][d]; if(s!==3 && s!==4)workers++; if(s===0)m++; else if(s===1)mid++; else if(s===2)e++; }
    const dem = demand(d);
    const eMin = Math.min(dem.e, Math.max(0, workers - dem.m - dem.mid));
    const shape = (isRest(d) || isFri(d)) ? '早1、中1、晚3–4' : '早1、中1、晚2–3';
    if (workers < dem.min) v.push(`${d} 日：僅 ${workers} 人上班（最少 ${dem.min} 人）`);
    if (workers > dem.cap) v.push(`${d} 日：${workers} 人上班（上限 ${dem.cap} 人，${shape}）`);
    if (m < Math.min(dem.m, workers)) v.push(`${d} 日：早班 ${m} 人（應 ${dem.m} 人）`);
    if (m > dem.m) v.push(`${d} 日：早班 ${m} 人超額（應 ${dem.m} 人，${shape}）`);
    if (e < eMin) v.push(`${d} 日：晚班缺 ${eMin-e} 人`);
    if (dem.mid > 0 && mid < dem.mid && workers >= dem.min)
      v.push(`${d} 日：應開 1 個中班（${shape}），目前中班 ${mid} 人`);
    const trioWorking = trioIdx.some(i => grid[i][d] !== 3);
    if (trioWorking && !trioIdx.some(i => grid[i][d] === 2))
      v.push(`${d} 日：${trioIdx.map(i=>S.staff[i].name).join('/')} 無人上晚班（每天至少一位管理職晚班）`);
  }
  return { violations: v, stats };
}

