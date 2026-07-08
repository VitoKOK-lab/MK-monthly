# MK Monthly Review — Taoyuan Gloria Outlets

每月團隊業績檢討網站（Michael Kors CIS 風格）。
線上網址：**https://vitokok-lab.github.io/MK-monthly/**

## 架構

```
index.html          ← 版型外殼（每月共用，不用改）
data/manifest.js    ← 月份清單
data/2026-06.js     ← 六月資料（數字 + 文案）
.github/workflows/  ← 推上 main 自動部署 GitHub Pages
```

## 每月新增一期的流程

1. 把新的月報 Excel 丟給 Claude，說：「產生 7 月報表」
2. Claude 會：
   - 新增 `data/2026-07.js`（複製上月結構、換數字與文案）
   - 在 `data/manifest.js` 最上方加入 `{ id: '2026-07', label: 'JULY 2026', short: '7月', fy: 'FY27 · P4' }`
   - 推上 `main`，1–2 分鐘後自動上線
3. 首頁的月份選單與趨勢列會自動出現新的一期，舊月份永久保留可回看

## 設計原則（勿破壞）

- **員工代表色固定跟人走**，每月不可重新分配（色盲安全已驗證）
- 每位員工必須至少有一個正面稱號徽章
- 「漏單王」必須附上可執行的逆轉數學（差多少 = 每天多做什麼）
- 個人頁的「我可以教 / 我想去學」兩欄都不可為空
