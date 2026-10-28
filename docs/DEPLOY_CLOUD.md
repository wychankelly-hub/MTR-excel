# 雲端部署指南（全免費，全部在網頁完成，不需要終端機）

部署後，遊戲在雲端 24 小時運行：老師及學生在學校電腦用 Chrome／Edge 開啟一個 HTTPS 網址即可，**不需要安裝任何軟件、不需要管理員權限、不需要老師的手提電腦一直開著**。所有比賽資料存放在雲端資料庫，老師關掉電腦、伺服器重新啟動或重新部署，資料都不會消失。

## 架構（已經做好）
| 部分 | 服務 | 說明 |
|-|-|-|
| 網站及伺服器（前端＋後端＋即時排行榜） | **Render Web Service（Free）** | Node.js，自動 HTTPS 網址，例如 `https://taiyau-station.onrender.com` |
| 資料庫（比賽、隊伍、提交、分數、登入 session） | **Neon PostgreSQL（Free）** | 透過 `DATABASE_URL` 連接；資料長期保存，不會到期 |
| 資產（廣東話配音、角色圖片） | 附帶配音隨網站部署；老師上載的錄音及角色圖片存於資料庫 | 不需另外開設儲存服務 |
| 密碼及金鑰 | Render 的 Environment 設定頁 | 只在伺服器，不會傳到瀏覽器 |

專案已包含 `render.yaml`（Render Blueprint，已設定為免費方案）。**全部費用：US$0。**

---

## 你需要親自完成的步驟

### 步驟 1：程式碼（已完成）
程式碼已放在 GitHub：`wychankelly-hub/MTR-SQL`。之後修改程式碼推送到這個 repo，Render 會自動重新部署。

### 步驟 2：建立免費 Neon 資料庫（約 5 分鐘）
1. 到 <https://neon.tech> → 「Sign up」，以 GitHub 或 Google 帳戶登記（**Free 方案，不需要信用卡**）。
2. 建立 Project：
   - Project name：`taiyau`
   - Postgres version：預設即可
   - **Region：AWS Asia Pacific (Singapore)**（最接近香港，亦與 Render 同區）
3. 建立後，在 Project Dashboard 按「**Connect**」，複製 **Connection string**，格式類似：
   `postgresql://neondb_owner:xxxxxxxx@ep-xxxx-xxxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require`
   - 「Connection pooling」開或關都可以。
   - 這串字包含密碼，**只貼在 Render 的設定頁**，不要放在 GitHub 或傳給學生。
4. 不需要自己建立資料表：網站第一次啟動時會自動建立。

### 步驟 3：在 Render 建立免費網站（約 10 分鐘）
1. 到 <https://render.com> →「Get Started」→ **Sign in with GitHub**。
2. 授權 Render 存取 `MTR-SQL` repo（可選「Only select repositories」並只勾選它）。
3. 在 Render Dashboard 按「**New +**」→「**Blueprint**」→ 選擇 `MTR-SQL`。
4. Render 讀取 `render.yaml` 後，會列出 Web Service `taiyau-station`（**Free** 方案），並要求填寫：
   - **DATABASE_URL**：貼上步驟 2 複製的 Neon Connection string。
   - **DEMO_TEACHER_PIN**：老師登入碼（至少 8 個字元，例如 `Tai-You-2026!`，請保密）。
   - 其餘（GOOGLE_CLIENT_ID 等）可以**留空**，日後再填。
5. 按「**Apply**」。第一次建立約需 3–6 分鐘。
6. 完成後，Web Service 頁面頂部會見到網址，例如 `https://taiyau-station.onrender.com`。這就是給老師及學生的網址。
7. 開啟 `https://你的網址/healthz`，應見到 `"driver":"postgres"`，代表已連接 Neon 資料庫。

> 如 Render 在過程中要求輸入信用卡（作身份驗證），只要所有項目都是 **Free**，就不會收費。如不想提供信用卡，可改按「New + → Web Service」手動建立（Instance Type 選 Free，Build Command `npm ci --omit=optional`，Start Command `npm start`，並在 Environment 加入 `NODE_ENV=production`、`DATABASE_URL`、`DEMO_TEACHER_PIN`、`SESSION_SECRET`（自行輸入一串長隨機字母數字）、`ALLOW_DEMO_LOGIN=true`）。

### 步驟 4：測試
1. 用學校電腦開啟網址 → 「訪客登入 → 老師」輸入老師登入碼。
2. 建立比賽 → 生成數據 → 批准 → 開放大堂。
3. 在投影電腦開啟「投影畫面」，按一次「🔊 啟用投影聲音」。
4. 用另一部電腦／手機以學生身份加入，試玩第 1 關。
5. 關掉老師電腦，再用另一部電腦開啟網址 → 比賽及分數仍在。

### 免費方案須知（重要）
| 限制 | 影響 | 做法 |
|-|-|-|
| Render Free 閒置 15 分鐘會**休眠** | 休眠後第一個人開啟網址要等約 30–60 秒 | **上課前 5 分鐘**先由老師開啟網址喚醒。比賽開放大堂後至結果期間，系統每 10 分鐘自動喚醒自己，投影畫面亦每 15 秒回報一次，課堂中不會休眠 |
| Render Free 每月 750 小時運行時間 | 一個網站整月不停運行亦不會超出 | 不要在同一 Render 帳戶建立其他免費網站 |
| Render Free CPU 較慢（0.1 CPU） | 「生成數據／預檢」可能需要數秒；一班 20 人批改無問題 | 課前先完成預檢 |
| Render 休眠／重新部署時伺服器重新啟動 | 比賽資料已存於 Neon，**不會遺失**；學生畫面會自動重新連線 | — |
| Neon Free 閒置約 5 分鐘會暫停 | 下一次讀寫自動喚醒（約 1 秒）；系統已處理斷線並自動重試寫入 | — |
| Neon Free 儲存 0.5 GB | 比賽資料很小；老師上載的錄音及角色圖片亦存於資料庫 | 角色圖片建議每張 1 MB 以下 |
| Neon Free 沒有長期自動備份 | — | 每次比賽後在「F. 結果」匯出 CSV 保存 |

（以上為現時 Render／Neon 公開的免費方案條款，如有更改以其網站為準。）

---

## 可選：Google 登入
不設定 Google 也可以完整使用（學生以英文名稱訪客登入、使用網站內置工作表）。如要用 Google 登入：
1. 到 <https://console.cloud.google.com/> 建立專案 →「API 和服務 → OAuth 同意畫面」。
   - **學校 Workspace 帳戶**：選「內部」需要學校 Google 管理員容許建立；如沒有權限，請聯絡學校 IT。
   - **個人 Gmail**：選「外部」，保持「測試中」狀態，並在「測試使用者」加入老師及學生的電郵（最多 100 個）；毋須 Google 審核。
2. 「憑證 → 建立 OAuth 用戶端 ID → 網頁應用程式」：
   - 已授權的 JavaScript 來源：`https://taiyau-station.onrender.com`
   - 已授權的重新導向 URI：`https://taiyau-station.onrender.com/api/google/callback`
3. 在 Render → Environment 填寫 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`TEACHER_EMAILS`（老師電郵），可選 `ALLOWED_EMAIL_DOMAINS`（例如學校網域）。
4. 真實 Google Sheets 模式（每隊一份 Google Sheet）需要額外的 Drive 權限，詳見 [SETUP_GOOGLE.md](SETUP_GOOGLE.md)；學校帳戶可能需要管理員批准。不設定時使用網站內置工作表。

## 可選：自訂網址
Render → Web Service → Settings → Custom Domains，可使用學校網域（需要學校 IT 設定 DNS）。如學校網絡封鎖 `onrender.com`，可用此方法。

## 學校電腦相容性
- 只需要 Chrome 或 Edge（最新版本），不需安裝、不需管理員權限。
- 學校網絡需要容許：`*.onrender.com`（或自訂網址）。字型由 `fonts.googleapis.com` 載入；如被封鎖，系統會自動用電腦內置中文字型，不影響使用。
- 即時更新使用標準 HTTPS（Server-Sent Events），一般學校防火牆可用；如連線中斷會自動重新連接。

## 日常管理（全部在網頁）
| 想做的事 | 在哪裏 |
|-|-|
| 建立／管理比賽、匯出成績 | 遊戲網站的教師控制台 |
| 更改老師登入碼、資料庫連線、Google 設定 | Render → Web Service → Environment |
| 查看伺服器狀態及記錄 | Render → Web Service → Logs／Metrics；或開啟 `https://你的網址/healthz` |
| 查看／備份資料庫 | Neon → Project → Tables；成績請在遊戲「F. 結果」匯出 CSV |
| 更新程式 | 程式碼推送到 GitHub 後 Render 自動重新部署（資料不受影響） |

## 技術備註（給協助的 IT 同事）
- 資料庫：任何 PostgreSQL 均可（`DATABASE_URL`）；Neon 使用 SSL 並驗證證書。
- 單一實例設計（`numInstances: 1`）：遊戲狀態在記憶體並即時寫入 PostgreSQL（只寫入有改變的資料，約 0.2 秒內）；重新啟動時由資料庫載入。
- 健康檢查：`GET /healthz`（資料庫就緒才回傳 200）。
- 亦可用 `Dockerfile` 部署到 Google Cloud Run（設定 `--max-instances=1 --min-instances=1 --timeout=3600`）配合 Neon／Cloud SQL。
