# （備選方案，目前未啟用）部署到 Cloudflare Pages（網頁 ＋ API 同網域）

> 2026-11-20 決定維持 GitHub Pages。程式碼已就緒，哪天需要跨裝置同步或即時發布，照下面步驟啟用即可，前端不用再改。

> 2026-11 起，排班資料改存 Cloudflare KV：店長設定跨裝置同步、發布班表即時生效、PIN 在伺服器驗證。
> 程式碼仍在 GitHub；推上 `main` 由 GitHub Actions 自動部署。API Token 只放在 GitHub repo secrets，不經過 Claude。

## 架構
```
Cloudflare Pages 專案 mk-monthly
 ├ 靜態網頁：index.html、schedule.html、schedule/*.js、data/*
 └ functions/api/[[route]].js  →  /api/*（Pages Functions）
      ├ GET  /api/state                 店長設定（公開可讀）
      ├ PUT  /api/state                 需 X-PIN
      ├ GET  /api/published             已發布班表（公開）
      ├ PUT  /api/published/2026-12     需 X-PIN；同時寫一份歷史 hist:published:月:時間
      ├ GET  /api/published/2026-12/history
      └ POST /api/auth  { pin }         店長登入驗證
KV namespace：mk-schedule（id 54a96bfb44fc45f9b8428f4d71c08291，綁定名 MK，已寫在 wrangler.toml）
```

## 一次性設定（Vito 操作，約 10 分鐘）

1. **Cloudflare 建 Pages 專案**
   Workers & Pages → Create → Pages → **Upload assets（Direct Upload）** → 專案名稱填 `mk-monthly`（必須一致）→ 隨便上傳一個空資料夾完成建立。
   或在本機跑一次：`npx wrangler pages project create mk-monthly --production-branch main`。
2. **設定店長 PIN**
   Pages 專案 → Settings → Variables and Secrets → Add → 名稱 `ADMIN_PIN`、值填店長密碼、勾 **Encrypt** → 環境選 Production（Preview 也加一份）。
   沒設時系統退回 `0000`。
3. **GitHub repo secrets**
   GitHub → MK-monthly → Settings → Secrets and variables → Actions → New repository secret：
   - `CLOUDFLARE_API_TOKEN`：Cloudflare → My Profile → API Tokens → Create Token → 範本「Edit Cloudflare Workers」，權限至少含 **Cloudflare Pages: Edit**、**Workers KV Storage: Edit**、**Account Settings: Read**。
   - `CLOUDFLARE_ACCOUNT_ID`：Cloudflare 儀表板右側 Account ID。
4. **推一次 main**（或 Actions 手動跑「Deploy to Cloudflare Pages」）。沒設 secrets 時該 workflow 會略過並提示，不會失敗。
5. **網址**：`https://mk-monthly.pages.dev/schedule`（Pages 會把 `/schedule.html` 轉成 `/schedule`）。
   要綁自己的網域：Pages 專案 → Custom domains。
6. **通知同事換網址**。舊的 `vitokok-lab.github.io/MK-monthly` 仍會部署，而且已允許跨網域讀雲端班表（`ALLOWED_ORIGINS`），過渡期兩邊都能看；店長後台請改用新網址（寫入只在同網域）。

## 第一次打開新網址會發生什麼
- 雲端 KV 是空的 → 頁面顯示「☁ 雲端尚無設定，登入後首次存檔即建立」。
- 店長在**原本那台裝置**用新網址登入後台 → 本機的設定自動推上雲端（本機有未同步變更且較新時以本機為準）。之後任何裝置打開都是同一份。
- 已發布班表：雲端空的時候沿用 repo 內 `data/schedule/published.js`（九月）；店長發布新月份後，雲端與靜態檔合併顯示。

## 日常
- 店長存檔：每次變動 1.2 秒後自動推雲端，右上角「☁ 已同步 hh:mm」。離線時變更留本機、標記未同步，下次登入補推。
- 發布：Step④「發布給同事」→ 寫 KV → 同事重新整理即見。不再需要 GitHub Token（離線時才會退回舊的 GitHub 方式）。
- 本機測試：`npx wrangler pages dev . --port 8788`（用本機模擬 KV，不需 Token）。

## 風險與備援
- KV 單一來源：發布歷史每次都另存一份（保留一年），可用 `/api/published/<月>/history` 查。要還原某版請 Claude 處理。
- 兩位店長同時改設定：最後寫入者為準，沒有合併。目前一家店一位店長，先不處理。
- `ALLOWED_ORIGINS` 只開放 github.io 舊網址讀取；新網址同網域不受 CORS 限制。
