# 雲端部署指南（全部在網頁完成，不需要終端機）

部署後，遊戲在雲端 24 小時運行：老師及學生在學校電腦用 Chrome／Edge 開啟一個 HTTPS 網址即可，**不需要安裝任何軟件、不需要管理員權限、不需要老師的手提電腦一直開著**。所有比賽資料存放在雲端資料庫，老師關掉電腦、伺服器重新啟動或重新部署，資料都不會消失。

## 架構（已經做好）
| 部分 | 服務 | 說明 |
|-|-|-|
| 網站及伺服器（前端＋後端＋即時排行榜） | **Render Web Service** | Node.js，自動 HTTPS 網址，例如 `https://taiyau-station.onrender.com` |
| 資料庫（比賽、隊伍、提交、分數、登入 session） | **Render PostgreSQL**（或 Neon／Supabase） | 透過 `DATABASE_URL` 連接 |
| 資產（廣東話配音、角色圖片） | 附帶配音隨網站部署；老師上載的錄音及角色圖片存於資料庫 | 不需另外開設儲存服務 |
| 密碼及金鑰 | Render 的 Environment 設定頁 | 只在伺服器，不會傳到瀏覽器 |

專案已包含 `render.yaml`（Render Blueprint），一次建立網站及資料庫。

---

## 你需要親自完成的步驟

### 步驟 1：把程式碼放到 GitHub（一次）
Render 由 GitHub 讀取程式碼並自動部署。
1. 到 <https://github.com> 登記免費帳戶（如未有）。
2. 按右上角「＋」→「New repository」，名稱例如 `taiyau-station`，選 **Private**，**不要**勾選任何初始化選項，按「Create repository」。
3. 告訴 Claude 這個 repo 的名稱（例如 `你的帳戶/taiyau-station`）並在 Claude 連接 GitHub，Claude 會把全部程式碼推送上去。
   （或者在 repo 頁面按「uploading an existing file」，把專案資料夾內容拖放上傳；`node_modules`、`data`、`models` 不用上傳。）

### 步驟 2：在 Render 建立網站及資料庫（約 10 分鐘）
1. 到 <https://render.com>，按「Get Started」，選 **Sign in with GitHub**。
2. 授權 Render 存取剛才的 repo。
3. 在 Render Dashboard 按「**New +**」→「**Blueprint**」→ 選擇 `taiyau-station` repo。
4. Render 會讀取 `render.yaml`，列出：
   - Web Service `taiyau-station`（Starter 方案）
   - PostgreSQL `taiyau-db`（Basic-256mb 方案）
5. 頁面會要求填寫：
   - **DEMO_TEACHER_PIN**：老師登入碼（至少 8 個字元，例如 `Tai-You-2026!`，請保密）。
   - 其餘（GOOGLE_CLIENT_ID 等）可以**留空**，日後再填。
6. 按「**Apply**」。第一次建立約需 3–6 分鐘。
7. 完成後，在 Web Service 頁面頂部會見到網址，例如 `https://taiyau-station.onrender.com`。這就是給老師及學生的網址。

### 步驟 3：測試
1. 用學校電腦開啟網址 → 「訪客登入 → 老師」輸入老師登入碼。
2. 建立比賽 → 生成數據 → 批准 → 開放大堂。
3. 在投影電腦開啟「投影畫面」，按一次「🔊 啟用投影聲音」。
4. 用另一部電腦／手機以學生身份加入，試玩第 1 關。
5. 關掉老師電腦，再用另一部電腦開啟網址 → 比賽及分數仍在。

### 費用（請以 Render 網站最新價格為準）
| 項目 | 方案 | 約價 | 說明 |
|-|-|-|-|
| Web Service | Starter | 約 US$7／月 | 一直運行，不會休眠（**建議**） |
| PostgreSQL | Basic-256mb | 約 US$6／月 | 資料長期保存（**建議**） |
| 免費選項 | Free web + Free Postgres | US$0 | Free web 閒置 15 分鐘會休眠，第一次開啟要等約 1 分鐘；Free Postgres **30 天後到期**，不適合正式使用 |

需要信用卡才可以使用付費方案。如學校不容許，可改用下面「免費資料庫」做法。

### （可選）免費的長期資料庫：Neon
1. 到 <https://neon.tech> 以 GitHub／Google 登記免費帳戶 → 建立 Project（Region 選 Singapore）。
2. 複製「Connection string」（`postgresql://…`）。
3. 在 Render 的 Web Service →「Environment」→ 把 `DATABASE_URL` 改為這個字串 → Save（會自動重新部署）。
4. 可以刪除 Render 的 `taiyau-db`。

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
| 更改老師登入碼、Google 設定 | Render → Web Service → Environment |
| 查看伺服器狀態及記錄 | Render → Web Service → Logs／Metrics；或開啟 `https://你的網址/healthz` |
| 備份資料庫 | Render → PostgreSQL → Backups（付費方案每日自動備份） |
| 更新程式 | 程式碼推送到 GitHub 後 Render 自動重新部署（資料不受影響） |

## 技術備註（給協助的 IT 同事）
- 單一實例設計（`numInstances: 1`）：遊戲狀態在記憶體並即時寫入 PostgreSQL（只寫入有改變的資料，約 0.2 秒內）；重新啟動時由資料庫載入。
- 健康檢查：`GET /healthz`（資料庫就緒才回傳 200）。
- 亦可用 `Dockerfile` 部署到 Google Cloud Run（設定 `--max-instances=1 --min-instances=1 --timeout=3600`）配合 Neon／Cloud SQL。
