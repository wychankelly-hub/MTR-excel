# 雲端部署指南（全免費，全部在網頁完成，不需要終端機）

部署後，遊戲在雲端 24 小時運行（配合下面步驟 5 的免費定時喚醒，任何時間開啟都不用等待）：老師及學生在學校電腦用 Chrome／Edge 開啟一個 HTTPS 網址即可，**不需要安裝任何軟件、不需要管理員權限、不需要老師的手提電腦一直開著**。所有比賽資料存放在雲端資料庫，老師關掉電腦、伺服器重新啟動或重新部署，資料都不會消失。

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

### 步驟 5：設定 24 小時定時喚醒（cron-job.org，約 5 分鐘）
Render Free 網站如 **15 分鐘沒有任何人開啟**就會休眠，下一個人開啟時要等約 1 分鐘。用免費的 cron-job.org 每 10 分鐘自動開啟一次網站的健康檢查網址，網站便會 24 小時保持喚醒（包括晚上、周末及公眾假期），老師及學生任何時間開啟都不用等待。全部在網頁設定，不需要在學校電腦安裝任何東西。

1. 到 <https://cron-job.org> → 「Sign up」，以電郵登記免費帳戶（**不需要信用卡**），按電郵中的連結啟用帳戶。
2. 登入後按「**Cronjobs**」→「**Create cronjob**」：
   - **Title**：`taiyau-station keep awake`
   - **URL**：`https://你的網址/healthz`（例如 `https://taiyau-station.onrender.com/healthz`）
   - **Execution schedule**：選「**Every 10 minutes**」（每 10 分鐘；每日 24 小時、每星期 7 日，不設例外日子）
   - **Time zone**（時區）：`Asia/Hong_Kong`（每 10 分鐘的設定與時區無關，但方便查看紀錄）
3. 在「**Advanced**」（進階）：Request method 保持 **GET**；Timeout 用最大值（免費版為 30 秒）。
4. 在「**Notifications**」（通知）：勾選「執行失敗時」及「cronjob 因多次失敗而被停用時」以電郵通知你。（cron-job.org 會自動停用連續失敗很多次的工作，收到通知時請登入重新啟用。）
5. 按「**Create**」／「**Save**」。數分鐘後在該工作的「History」應見到 `200 OK`。
6. 確認：晚上或周末用手機開啟網址，應立即載入，而不是顯示 Render 的「Service waking up」畫面。

> 介面字眼如有更改，以 cron-job.org 網站為準；重點是：URL 用 `/healthz`、每 10 分鐘、GET、全年無休。
> `/healthz` 只檢查伺服器記憶體中的狀態，**不會讀寫 Neon 資料庫**，所以定時喚醒不會用掉 Neon 的運算時數（Neon 仍可在閒置時休眠）。
> 第一次喚醒（例如網站剛部署或曾休眠）可能超過 30 秒而在 cron-job.org 顯示「Timeout」；網站仍會被喚醒，之後的檢查會顯示 200。

#### 會否超出 Render 每月 750 小時免費額度？（已核實）
Render 每個 **Workspace** 每月有 750 小時 Free instance hours，所有免費網站共用；網站保持喚醒時才會計算。

| 月份日數 | 24 小時運行所需時數 | 剩餘 |
|-|-|-|
| 28 日（2 月） | 672 小時 | 78 小時 |
| 29 日（閏年 2 月） | 696 小時 | 54 小時 |
| 30 日 | 720 小時 | 30 小時 |
| **31 日** | **744 小時** | **6 小時** |

**結論：一個網站全年 24 小時運行不會超出額度**，但 31 日的月份只有約 6 小時餘裕，所以必須遵守：
1. **這個 Render Workspace 只放這一個免費網站**（不要另外建立其他 Free web service；Render 免費 PostgreSQL 亦不需要，因為我們用 Neon）。如需要試驗其他項目，請另開一個 Render Workspace。
2. 不要開啟 Preview Environments／Pull Request Previews（每個預覽都是另一個網站，會消耗時數）。
3. 減少不必要的重新部署：每次推送到 GitHub，新版本啟動時舊版本仍會運行一至數分鐘（零停機部署），可能令這段時間重複計算。一般每月數十次部署只佔少於 1 小時，但請避免連續大量推送。
4. 每月約 25 日到 Render 的 **Billing** 頁面查看 Free instance hours 用量。

如果額度用完：Render 會**暫停你所有的免費網站直至下個月 1 日**（資料存於 Neon，不會遺失，但網站無法開啟）。如發現用量接近 750 小時，最佳的免費應對方法是暫時把 cron-job.org 改為**香港時間 01:00–06:00 不執行**（每晚省約 5 小時、每月約 150 小時）：期間無人使用時網站會休眠，早上第一次開啟需等約 1 分鐘，06:00 起定時喚醒會自動恢復。

### 免費方案須知（重要）
| 限制 | 影響 | 做法 |
|-|-|-|
| Render Free 閒置 15 分鐘會**休眠**，喚醒約需 1 分鐘 | 未設定定時喚醒時，第一個開啟的人要等 | 完成步驟 5（cron-job.org 每 10 分鐘）。後備：比賽開放大堂至結果期間，系統每 10 分鐘自動喚醒自己，投影畫面亦每 15 秒回報一次 |
| Render Free 每個 Workspace 每月 750 小時 | 一個網站 24 小時運行：31 日月份用 744 小時 | 見上面「會否超出」；Workspace 只放這一個免費網站 |
| Render Free CPU 較慢（0.1 CPU）、512 MB 記憶體 | 「生成數據／預檢」可能需要 10–15 秒；一次批改約 1–5 毫秒（實測），20 人同時提交無問題 | 課前先完成預檢 |
| Render Free 沒有服務水平保證，可能偶爾重新啟動 | 約 1 分鐘無法連線 | 已實作自動保護，見下面「雲端中斷時的保護」 |
| Neon Free **儲存 1 GB／Project**（2026 年 10 月起，原為 0.5 GB） | 一場 20 人完整比賽約 0.4 MB 資料（實測） | 足夠存放數以百計場比賽；角色圖片建議每張 1 MB 以下 |
| Neon Free 運算 100 CU-hours／Project／月，閒置 5 分鐘自動暫停（不能關閉） | 只在有寫入時運行；一節課估計約 0.25–1 CU-hour | 定時喚醒不會觸及資料庫 |
| Neon Free 網絡傳輸 5 GB／Project／月 | 一場比賽寫入約 15 MB、伺服器啟動時讀取不足 1 MB（實測） | 遠低於上限 |
| Neon Free 不需要信用卡；只有短時間的還原紀錄 | — | 每次比賽後在「F. 結果」匯出 CSV 保存 |

（以上為 2026 年 10 月 Render／Neon 公開的免費方案條款，如有更改以其網站為準。）

## 雲端中斷時的保護（已實作並測試）
免費雲端偶然會重新啟動（平台維護、重新部署、當機）。系統已處理以下情況：

| 情況 | 系統怎樣處理 |
|-|-|
| 學生按「提交」時伺服器剛好重新啟動 | 伺服器**先把結果寫入 Neon 才回覆學生**。學生畫面一旦顯示「已核實」或分數，即使伺服器下一秒當機，結果亦已保存。未收到回覆的提交，學生畫面會以**同一個提交識別碼**自動重試約 3 分鐘（顯示「伺服器重新連線中…」）：已保存的不會重複計分，未保存的會在伺服器恢復後重新處理 |
| 關卡計時中伺服器離線 | 比賽進行時伺服器每 5 秒記錄一次「仍在運行」。重新啟動後，系統由最後一次紀錄的時間起**自動暫停該關**，中斷期間不計時（學生最多多得約 5 秒，不會少）。老師控制台顯示「伺服器曾中斷約 N 秒，系統已自動暫停並補回中斷期間的作答時間」，確認學生已重新連線後按「繼續」 |
| 重新部署時新舊兩個版本同時運行 | 新版本啟動時先「接手」資料庫，舊版本之後的寫入會被拒絕（學生端自動重試到新版本），兩者不會互相覆蓋 |
| Neon 資料庫休眠／短暫斷線 | 自動重新連線及重試寫入；未能寫入時學生端會收到「暫時未能儲存」並自動重試，不會扣分 |
| 學生畫面斷線 | 即時更新（SSE）自動重新連線；重新整理頁面不會重播音效 |

**課堂中請不要推送程式碼到 GitHub**：自動部署會重新啟動伺服器（雖然有上述保護，但會令關卡自動暫停約 1 分鐘）。

## 已測試 vs 需要在真實 Render＋Neon 上測試
開發環境沒有你的 Render／Neon 帳戶，以下以本機 PostgreSQL 及正式設定（`NODE_ENV=production`）測試：

| 項目 | 狀態 |
|-|-|
| 提交途中強制終止伺服器（真正的程序 `SIGKILL`，共 3 次，12 名學生同時提交）：已回覆的提交全部保存、沒有重複計分、分數在重新啟動後不變 | ✅ 已測試（`test/i-restart-reliability.test.js`）；另外把「先寫入才回覆」關掉時，同一測試確實失敗（證明測試有效） |
| 關卡計時中離線 4 秒：重新啟動後自動暫停，剩餘時間不少於當機一刻、最多多約 5 秒；暫停期間時間不減少 | ✅ 已測試 |
| 新舊兩個伺服器同時運行：舊版本不可再確認提交（503），健康檢查失敗，資料庫沒有被覆蓋 | ✅ 已測試 |
| 資料庫短暫停止後恢復：寫入自動重試 | ✅ 已測試（本機 PostgreSQL 停止及重新啟動） |
| 一場完整 20 人、5 關比賽的資料庫用量 | ✅ 已量度：寫入約 15 MB、平均每次 14 KB、資料約 0.4 MB、啟動時讀取不足 1 MB |
| 多瀏覽器課堂流程（老師、兩個投影、三位學生；兩套聲音分開） | ✅ 已測試（本機檔案模式及正式設定＋PostgreSQL） |
| 全部 58 項自動測試 | ✅ 通過（連同 PostgreSQL） |
| Render 實際冷啟動時間、休眠、重新部署時新舊版本交替 | ⚙️ 需要真實部署測試 |
| Render 的 750 小時計算方式（特別是部署時重疊的幾分鐘） | ⚙️ 需要在 Render Billing 頁面觀察 |
| Neon 的實際連線、休眠喚醒延遲、SSL、用量統計 | ⚙️ 需要真實部署測試 |
| cron-job.org 定時喚醒 | ⚙️ 需要你建立帳戶後確認 History 為 200 |
| 學校網絡能否開啟 `*.onrender.com`、SSE 即時更新是否被防火牆阻擋 | ⚙️ 需要在學校電腦測試 |

### 首次部署後請做一次驗證（全部用瀏覽器）
1. 開啟 `https://你的網址/healthz` → `"driver":"postgres"`、`"fenced":false`。
2. 按步驟 4 試玩，學生答對一題。
3. 在 Render → Web Service → 右上角「**Manual Deploy → Restart service**」（或「Deploy latest commit」）模擬伺服器重新啟動。
4. 約 1 分鐘後：老師控制台應顯示「伺服器曾中斷約 N 秒，系統已自動暫停…」；剩餘時間應與重新啟動前相同；學生的分數仍在。按「繼續」。
5. 第二天早上用手機開啟網址，應立即載入（cron-job.org 正常）。

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
| 查看伺服器狀態及記錄 | Render → Web Service → Logs／Metrics；或開啟 `https://你的網址/healthz`（`usage` 顯示本次啟動後寫入資料庫的次數及 MB） |
| 查看定時喚醒是否正常 | cron-job.org → Cronjobs → History（應為 200 OK） |
| 查看 Render 免費時數用量 | Render → Billing（每月約 25 日檢查一次） |
| 查看／備份資料庫 | Neon → Project → Tables；成績請在遊戲「F. 結果」匯出 CSV |
| 更新程式 | 程式碼推送到 GitHub 後 Render 自動重新部署（資料不受影響） |

## 技術備註（給協助的 IT 同事）
- 資料庫：任何 PostgreSQL 均可（`DATABASE_URL`）；Neon 使用 SSL 並驗證證書。
- 單一實例設計（`numInstances: 1`）：遊戲狀態在記憶體並寫入 PostgreSQL；重新啟動時由資料庫載入。
- 寫入：會改變資料的 API（POST）在回覆前等待寫入完成（`persistNow()`）；未能寫入回覆 503 `NOT_SAVED`。只寫入有改變的鍵：比賽核心、提交紀錄（每 25 個一段）、審計紀錄（每 100 個一段）、各比賽的模擬工作表分開儲存。投影畫面的即時狀態不寫入資料庫。
- 實例接手（fencing）：啟動時寫入 `ty_kv` 的 `owner` 鍵；每次寫入交易以 `SELECT … FOR UPDATE` 核對，舊實例的寫入會被拒絕。
- 計時補回：比賽計時中每 5 秒寫入 `heartbeat` 鍵；重新啟動時由 `heartbeat` 時間起自動暫停進行中的關卡。
- 健康檢查：`GET /healthz`（資料庫就緒才回傳 200；被新實例接手後回傳 503）。不查詢資料庫，適合作定時喚醒。
- 亦可用 `Dockerfile` 部署到 Google Cloud Run（設定 `--max-instances=1 --min-instances=1 --timeout=3600`）配合 Neon／Cloud SQL。
