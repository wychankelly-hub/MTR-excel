# 部署檢查清單

## 雲端（建議）
- [ ] 按 [DEPLOY_CLOUD.md](DEPLOY_CLOUD.md) 建立 Neon Free 資料庫（Singapore），複製 Connection string
- [ ] 以 Render Blueprint 建立 Free Web Service；填寫 `DATABASE_URL`（Neon）及 `DEMO_TEACHER_PIN`（至少 8 字元）；`SESSION_SECRET` 由 Blueprint 自動產生
- [ ] 開啟 `https://你的網址/healthz` 顯示 `"driver":"postgres"`
- [ ] cron-job.org：每 10 分鐘 GET `https://你的網址/healthz`，24 小時、每日；已開啟失敗電郵通知；History 顯示 200
- [ ] 該 Render Workspace 只有這一個免費網站；沒有開啟 Preview Environments
- [ ] 每月約 25 日在 Render → Billing 查看 Free instance hours（31 日月份需 744 小時，上限 750）
- [ ] 首次部署後：在 Render 按「Restart service」，確認進行中的關卡自動暫停、時間補回、分數保留（DEPLOY_CLOUD.md「首次部署後請做一次驗證」）
- [ ] 課堂中不推送程式碼到 GitHub
- [ ] 學校電腦可開啟網址（如被封鎖，請 IT 容許 `*.onrender.com` 或設定自訂網址）
- [ ] 投影電腦按一次「啟用投影聲音」後，開始遊戲有配音及背景音樂；學生裝置有遊戲音效

## 自行託管伺服器（進階）
- [ ] Node.js 20+；`npm ci`（或 `npm install`）
- [ ] 以 HTTPS 提供服務（例如 Nginx / Caddy 反向代理）。SSE 需要關閉代理緩衝（`proxy_buffering off;`），本系統已送出 `X-Accel-Buffering: no`。
- [ ] `.env`：`PUBLIC_BASE_URL`、`SESSION_SECRET`（長隨機字串）、`SECURE_COOKIES=true`
- [ ] 正式課堂：`ALLOW_DEMO_LOGIN=false`（或至少更改 `DEMO_TEACHER_PIN`）
- [ ] `DATA_DIR` 放在有備份的位置，權限只限服務帳戶（內含成績及 Google refresh token）
- [ ] 以 systemd / pm2 等常駐執行 `npm start`；**只執行一個實例**（狀態存於記憶體及單一 JSON 檔）
- [ ] `npm test` 全部通過；`npm run demo:bots` 顯示「不變量全部成立」

## Google（正式模式）
- [ ] 已按 [SETUP_GOOGLE.md](SETUP_GOOGLE.md) 建立 OAuth Client、啟用 Sheets API 及 Drive API
- [ ] `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`TEACHER_EMAILS`、`ALLOWED_EMAIL_DOMAINS`
- [ ] 老師已在「系統狀態」連接 Google Drive（或已設定 Service Account）
- [ ] `npm run google:smoke` 全部 ✓
- [ ] 以學生帳戶確認：可開啟自己隊的 Sheet、只能編輯黃色儲存格、看不到其他隊的 Sheet

## 課室
- [ ] 每隊一部主要作答電腦、穩定 Wi-Fi；瀏覽器可開啟 Google Sheets 及本網站
- [ ] 投影電腦接駁喇叭，開啟投影畫面並按「啟用聲音」
- [ ] 學生電腦預設靜音（本系統學生端預設不播放劇情音訊）
- [ ] 正式音檔已試聽並批准（可選；缺少時只顯示字幕）

## 試跑（規格 §14 要求）
- [ ] 最少兩隊真實 Google Sheets 端到端測試（`google:smoke` 加上人手測試）
- [ ] 一場完整 45 分鐘、六隊試跑（Appendix B：招募 Level 1–2、Level 3、Level 5 測試者），記錄看不懂的字句及失誤
