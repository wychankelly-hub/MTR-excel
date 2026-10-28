# Google Sign-in 及 Google Sheets 設定指南

本系統需要兩種**不同**的 Google 權限：

| 權限 | 用途 | 誰授權 | 需要的設定 |
|-|-|-|-|
| **Google Sign-in** | 學生及老師登入網站（只取得 email、名稱） | 每位使用者 | `GOOGLE_CLIENT_ID` |
| **Drive／Sheets 存取** | 為每隊建立工作表、設定保護、分享、提交時讀取公式 | 老師一次（或 Service Account） | `GOOGLE_CLIENT_SECRET`（OAuth）或 Service Account 金鑰 |

學生**不需要**授權網站讀取他們的 Drive；學生只是被分享到自己隊伍的工作表。

---

## 1. 建立 Google Cloud 專案

1. 到 <https://console.cloud.google.com/>，建立新專案（例如 `taiyau-station`）。建議用學校 Google Workspace 帳戶建立。
2. 「API 和服務 → 程式庫」：啟用 **Google Sheets API** 及 **Google Drive API**。

## 2. OAuth 同意畫面

1. 「API 和服務 → OAuth 同意畫面」。
2. 使用者類型：學校 Workspace 選 **內部（Internal）**（只限校內帳戶，毋須 Google 審查）。
3. 填寫應用程式名稱、支援電郵。
4. 範圍（Scopes）只加入：`openid`、`email`、`profile`、`https://www.googleapis.com/auth/drive.file`。
   - `drive.file` 只容許本系統存取**由本系統建立**的檔案，看不到老師其他 Drive 檔案（最少授權）。

## 3. OAuth 用戶端 ID

1. 「憑證 → 建立憑證 → OAuth 用戶端 ID」，類型選 **網頁應用程式**。
2. 已授權的 JavaScript 來源：你的網址，例如 `https://taiyau.school.edu.hk`（本機測試加 `http://localhost:3000`）。
3. 已授權的重新導向 URI：`https://taiyau.school.edu.hk/api/google/callback`（本機：`http://localhost:3000/api/google/callback`）。
4. 複製「用戶端 ID」及「用戶端密鑰」。

## 4. 設定 `.env`

```
PUBLIC_BASE_URL=https://taiyau.school.edu.hk
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxx
TEACHER_EMAILS=teacher1@school.edu.hk,teacher2@school.edu.hk
ALLOWED_EMAIL_DOMAINS=school.edu.hk
SESSION_SECRET=（長隨機字串）
SECURE_COOKIES=true
ALLOW_DEMO_LOGIN=false
```

重新啟動伺服器，啟動訊息應顯示「Google Sign-in：已設定」。

## 5. 老師連接 Google Drive

1. 以 `TEACHER_EMAILS` 內的帳戶用 Google 登入。
2. 教師控制台 →「系統狀態」→「連接 Google Drive」→ 在 Google 同意畫面允許。
3. 系統狀態應顯示「Google Sheets / Drive：Ready（老師 OAuth）」。

> refresh token 儲存在 `DATA_DIR/state.json`。請限制伺服器上該資料夾的存取權限；中斷連接可在「系統狀態」按「中斷連接」，或在 Google 帳戶「第三方存取權」移除。

## 6. 端到端驗證（必須做一次）

```bash
SMOKE_SHARE_EMAIL=你的另一個學校帳戶 npm run google:smoke
```

此測試會在你的 Drive 建立 2 份真實工作表，經 Sheets API 寫入正確及錯誤公式，然後經正式提交流程批改。全部顯示 ✓ 才代表「已正式連接」。之後請以學生帳戶開啟工作表，確認只可編輯黃色作答格。

---

## 學校 Workspace 政策限制時的替代方式

### A. Workspace 管理員把應用程式設為受信任
管理控制台 → 安全性 → API 控制項 → 管理第三方應用程式存取權 → 加入你的 OAuth Client ID 並設為「受信任」。

### B. Service Account（不需要老師 OAuth）
1. Cloud Console →「IAM 與管理 → 服務帳戶」→ 建立 → 建立 JSON 金鑰，存放於伺服器（例如 `/etc/taiyau/sa.json`，權限 600）。
2. `.env`：`GOOGLE_SERVICE_ACCOUNT_KEY_FILE=/etc/taiyau/sa.json`
3. **重要**：Service Account 自己沒有 Drive 儲存空間，請使用以下其中一種：
   - 建立 **Shared Drive（共用雲端硬碟）** 資料夾，把 Service Account 加為「內容管理員」，`.env` 設 `GOOGLE_DRIVE_FOLDER_ID=<資料夾 ID>`；或
   - **老師預先建立 Sheet**：老師在自己的 Drive 建立 6 份空白 Google Sheets，分享給 Service Account 電郵（編輯者），然後在控制台「B. 隊伍」為每隊貼上 Sheet 網址（「使用此 Sheet」），再按「建立／重試 Google Sheets 並分享」。系統會寫入數據、保護範圍及分享給隊員。
4. 學校外部分享政策可能阻止 Service Account 分享給學生：此時建議使用老師預先建立 Sheet 的方式，並由老師在 Drive 手動分享給各隊。

### 權限失敗時
系統不會靜默失敗：控制台「B. 隊伍」會在每隊顯示錯誤原因（例如「Google 拒絕存取（權限不足或學校 Workspace 政策限制）」），提交時的同步錯誤顯示「同步失敗（不會扣分）」；連續三次讀取失敗會自動暫停計時並提示老師。
