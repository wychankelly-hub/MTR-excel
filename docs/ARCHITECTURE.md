# 架構說明

## 技術選擇
規格建議 Next.js + Firebase；本實作以「同等安全、可擴充」為原則改用較少外部依賴的方案，方便學校自行部署：

- **伺服器**：Node.js + Express 5（ESM，無需建置）
- **前端**：原生 JavaScript 模組（無需建置），三個介面：`/teacher`、`/student`、`/projector`
- **即時更新**：Server-Sent Events（按角色過濾資料）
- **儲存**：單一 JSON 檔（原子寫入）；數據集不儲存，而由 Seed + Generator Version 重新生成並以 checksum 核實
- **公式引擎**：自行實作的 Tokenizer → Pratt Parser → AST → 解譯器（`server/engine/`），**不使用 eval**
- **Google**：`@googleapis/sheets`、`@googleapis/drive`、`google-auth-library`

驗證及計分全部在伺服器；學生瀏覽器只送出「我要提交 Task X」及 Idempotency Key。

## 目錄
```
server/
  engine/          公式解析與重算（refs、parser、ast、values、functions、workbook）
  episodes/        劇集登記表（index.js：每集相同介面）、grading-kit（共用批改工具）
  episode1/        blueprint（題目藍圖）、generator（數據生成）、validators（逐題批改）、
                   feedback（中文回饋及賽後回顧）、fixtures（正確／常見錯誤公式）、preflight、dialogue（配音事件）
  episode2/        第二集《疑犯火箭仔》，結構與第一集相同
  episode3/        第三集《暴躁阿叔》：排序、篩選、多工作表、圖表、樞紐分析表、假設分析
  drivers.js       隨機 Driver：公平輪換、每題指派、伺服器端權限
  chat.js          隊伍對話（只限同隊及老師）
  presence.js      學生即時連線狀態（記憶體）
  sheets.js        內置工作表：逐格儲存（版本號）、修改／衝突、練習副本、工作表內容及編輯規則
  adapters/        demo-adapter（內置工作表；'builtin' 與 'demo' 相同）、google-adapter（舊模式 Google Sheets）、start-sheet
  competition.js   狀態機、隊伍、計時、提示、人工調分、音訊 Spoiler Policy
  submission.js    提交流程（冪等、序列化、快照、完整性、批改、交叉核對）
  scoring.js       由紀錄推導分數（冪等）及排名
  views.js         Teacher／Student／Projector 視圖（權限過濾）
  realtime.js      SSE
  audio-assets.js  音檔狀態、試聽批准、錄音上載
public/            前端（js/team-chat.js：隊伍對話面板；js/sheet-editor.js：內置工作表編輯器，直接使用伺服器的公式引擎 /engine/*）
scripts/           demo-bots、google-smoke-test、generate-tts、preflight-report
test/              驗收測試（a–g）及瀏覽器 E2E
```

## 批改流程（§7.1）
1. 身份及隊伍權限；回合進行中、未暫停、時間未到
2. Idempotency Key 檢查（同一 key 只處理一次）；每隊提交序列化
3. Adapter 讀取該關工作表：**公式字串 + 計算值**（Google：`FORMULA` 及 `UNFORMATTED_VALUE`）
4. 原始數據完整性比對 → 不一致則 `INTEGRITY_ERROR`（不扣分）
5. 同一 Task 的作答內容與上次相同 → `DUPLICATE`（沿用結果，不重複計分／扣分）
6. `gradeTask`：
   - 公式存在（拒絕固定值）、可解析（全形字元／分號／缺引號等有針對性提示）、函數是否支援
   - **隔離工作簿**：其他 Task 的作答格以參考公式填充，避免前題錯誤連累後題
   - 結構檢查：指定函數（SUM／COUNT／COUNTIF／SUMIF／LEFT／MID／RIGHT／&）、`$H$1` 絕對參照、條件範圍／總和範圍、條件是否引用 H1／H2、MID 位置引用 B 欄
   - 本隊數據重算整段範圍；**隱藏測試數據**（相同結構、不同數值；L5 換成另一個字詞）重算
   - L3 以 24 個邊界組合（年齡 = 界線 ±1、YES/NO、TRUE/FALSE，界線 60/65）探測 E2 的邏輯，辨識 AND/OR 對調、`>`、忽略 ValidCard、寫死 60
   - 逐評分點給分 + 繁體中文 Feedback
7. Google 模式：伺服器引擎結果與 Google 計算值交叉核對，不一致 → 標示老師覆核、不扣分
8. 寫入紀錄、觸發首隊完成事件、推送更新

## 資料模型（對應 §11）
| 規格 | 實作 |
|-|-|
| User | `state.users`：provider、Google sub 雜湊 ID、email、name、role |
| Competition | `state.competitions[id]`：設定、狀態、Seed、版本、levels（計時）、leaderboard、audit |
| Team | `competition.teams[]`：名稱、顏色、成員、隊長、角色輪換、workbook |
| ChallengeTemplate | `episode1/blueprint.js`（固定、已審核） |
| DatasetInstance | `generation.teams[teamId]`：teamSeed、checksums、flags、preflight；數據本身按 Seed 重新生成 |
| WorkbookLink | `team.workbook`：provider、fileId、url、status、sharedWith、error |
| Submission | `competition.submissions[]`：ID、Idempotency Key、快照（公式＋數值）、驗證版本、評分點、錯誤代碼 |
| ScoreEvent | 分數由紀錄推導（`scoring.js`），加扣分明細附理由；人工調分 `adjustments[]` |
| AudioEvent | `episode1/dialogue.js` + `competition.audio.log` |
| TeacherAuditLog | `competition.audit[]` |

## 持久化及重新啟動
- `server/store.js`：PostgreSQL（`ty_kv` 鍵值表、`ty_assets` 檔案表、`ty_cells` 工作表儲存格表）或本機檔案。比賽紀錄分成 `competition:<id>`（核心）、`competition:<id>:sub:<n>`（每 25 個提交）、`competition:<id>:audit:<n>`（每 100 項審計），只寫入有改變的鍵；投影畫面即時狀態不寫入。
- 會改變資料的 API 在回覆前呼叫 `persistNow()`；未能寫入回覆 503 `NOT_SAVED`，學生端以同一 Idempotency Key 重試。
- `owner` 鍵記錄目前負責的實例；寫入交易以 `SELECT … FOR UPDATE` 核對，舊實例被拒絕（`db.fenced`）。
- 比賽計時中每 5 秒寫入 `heartbeat`；啟動時 `recoverAfterRestart()` 由最後一次 heartbeat 起暫停進行中的關卡。

## 狀態機
`DRAFT → PREFLIGHT → APPROVED → LOBBY → RUNNING_LEVEL_1…5 → RESULTS → ARCHIVED`，另有 `PAUSED`（保留 prevStatus）及 `CANCELLED`。
提交：`SUBMITTING → RECEIVED → VALIDATING → VERIFIED / REJECTED / RETRYABLE_ERROR`，另有 `INTEGRITY_ERROR`、`DUPLICATE`。

## 主要 API
| 規格動作 | Endpoint |
|-|-|
| CreateCompetition | `POST /api/teacher/competitions` |
| JoinTeam | `POST /api/student/join` |
| GenerateDatasets | `POST /api/teacher/competitions/:id/generate` |
| ApproveDatasets | `POST …/approve`、`POST …/provision` |
| Start/Pause/Resume/EndLevel | `POST …/levels/:n/start|end|extend|skip`、`…/pause`、`…/resume` |
| SubmitTask | `POST /api/student/submit` |
| RequestHint | `POST /api/student/hint` |
| GetPublicLeaderboard | `GET /api/projector/:id?key=` 及 SSE |
| GetTeacherDiagnostics | `GET /api/teacher/competitions/:id` |
| TriggerAudioEvent | `POST …/audio/trigger`、`…/audio/control` |
| ExportResults | `GET …/export.csv`、`POST …/export-google` |

## 內置工作表（取代 Google Sheets 作答）
- **儲存**：每格一行（`ty_cells`：comp_id、team_id、sheet、addr、input、ver、by_user、at），與比賽紀錄在同一個受保護的交易內寫入；表格在啟動時自動建立。修改 API 先 `persistNow()` 才回覆及通知隊友，所以「已儲存」的修改在重新整理或伺服器重新啟動後一定存在。
- **修改協定**：瀏覽器送出 `{a, i, base}`（儲存格、輸入、讀取時的版本號）。版本不符 → 回傳衝突及最新內容（不會無聲覆蓋）；不可編輯的格 → 拒絕（`PROTECTED`／`LOCKED`／`PAUSED`）。瀏覽器把約 0.15 秒內的修改合併成一批自動儲存、失敗自動重試。
- **計算**：瀏覽器與伺服器使用同一套公式引擎（`server/engine`，以 `/engine/*` 提供給瀏覽器）；批改只採用伺服器的計算結果。
- **權限**：隊伍一律由伺服器按登入帳戶決定（`teamOfUser`），網址／參數中的隊伍編號不被採用；未開始的關卡、未開放的題目不可讀寫；SSE 的儲存格及游標事件只送給該隊成員及該比賽的老師。
- **練習副本**：工作表鍵 `sheet@reopenId`，由正式作答（或起始內容）複製；提交記錄 `practice: true`，計分一律排除。
- **擴展**：工作表以 sheet 名稱為單位，已支援同一隊多張工作表；排序、篩選、圖表、樞紐分析可加在編輯器及引擎（第三集）。

## 題目狀態及重開
- `taskPhase`：未開放（locked）／進行中（active）／已截止（closed），由關卡計時及老師逐題控制（`taskOverrides`）決定。
- `teamTaskState`：每隊每題；全對後自動鎖定（`lockOnComplete`）；`reopens[]` 記錄重開（practice／makeup、隊伍、是否重新開始、建立及結束時間），持久保存。
- `editRulesFor(comp, team, level, layer)` 統一決定可編輯的格及原因，修改 API 及編輯器同時使用。

## 多班別
每場比賽有自己的代碼、名單、工作表、分數、排行榜及計時；隊伍編號只在比賽內有效，所以不同班可用相同隊名。分隊方式（老師分隊／學生自選一次）、學生名單（網域／電郵）及「必須以 Google 登入」在加入時於伺服器檢查。

## 隨機 Driver（`server/drivers.js`）
- 狀態存於 `comp.drivers[teamId]`：`round`（本輪隨機次序）、`used`（本輪已擔任）、`tasks[taskId]`（每題的 Driver、時間、方式 auto／solo／teacher）、`history`、`current`（目前題目）。隨比賽核心紀錄寫入資料庫。
- `syncDrivers(comp)` 在每次 `changed()` 時執行：每隊的「目前題目」= 按題目次序第一題開放作答（或補做）而未全對的題目；未有 Driver 時按輪換選出。已指派的題目不會自動改變（Driver 離隊除外）。
- 權限在伺服器：`editRulesFor(…, user)` 只把目前題目的作答格開放給該題 Driver（練習副本不限）；`submitTask` 以 `driverBlock` 拒絕非 Driver（403 `NOT_DRIVER`）及非目前題目（409 `NOT_CURRENT_TASK`）。
- 連線狀態（`server/presence.js`）只在記憶體：學生的即時連線（SSE）開啟／關閉時更新，並推送給老師及隊友；重新整理有 20 秒寬限。

## 隊伍對話（`server/chat.js`）
- `comp.chat[]`：`{id, teamId, taskId, userId, name, text, at, deleted}`；資料庫按每 50 則一段（`competition:<id>:chat:<n>`），新訊息只寫入最新一段。寫入資料庫後才即時推送（SSE `chat` 事件只送到同一比賽、同一隊的學生及該比賽的老師；投影畫面及公開視圖沒有對話）。
- API：`GET/POST /api/chat`（隊伍由登入身份決定）、`GET /api/teacher/competitions/:id/chat?teamId=`、`POST …/chat/:msgId/delete`、`POST …/drivers`（重新指派）。
- 防洗版及重試：每人／每隊頻率限制、300 字上限、`clientId` 令網絡重試不會重複加入。

## 分析工具（第三集）：排序、篩選、多工作表、圖表、樞紐分析表、假設分析
- **共用程式** `server/engine/analysis.js`（瀏覽器經 `/engine/analysis.js` 使用同一份）：`applySorts`（由原始數據重做排序紀錄；穩定排序，所以逐次排序＝多欄排序；`cols` 表示只排序部分欄，用來重現「資料列被拆散」的常見錯誤）、`filterHiddenRows`（AND 條件；只隱藏不刪除）、`computePivot`（列／欄／值／篩選；SUM、COUNT、AVERAGE、MAX、MIN）、`chartData`（工作表範圍或樞紐分析表）、`scenarioSummary`、`goalSeek`（連續值及整數階梯函數）、`sanitizeMeta`（伺服器檢查學生的設定）、`loadLevelIntoWorkbook`。
- **存儲**：設定以中繼資料鍵（`!SORT`、`!FILTER`、`!CHARTS`、`!PIVOTS`、`!SCEN`）存於該隊主要工作表的儲存格表（`ty_cells`，JSONB），因此自動擁有版本號（衝突偵測）、Driver 權限、練習副本、即時同步、資料庫持久化及重新啟動恢復；不需要新增資料表。每次修改只寫入一行。
- **權限**：題目以 `task.meta` 擁有設定鍵；`editRulesFor` 與作答格同樣處理（未開放、已完成、非 Driver 都不可修改）。
- **多工作表**：關卡可有 `extraSheets`（唯讀的數據工作表）；跨工作表參照 `Sheet!A1` 由原有引擎支援；`SUBTOTAL` 讀取工作簿的 `hiddenRows`（篩選）。
- **新函數**：COUNTIFS、SUMIFS、AVERAGEIFS、MAXIFS、MINIFS、SUBTOTAL、IFERROR、REPT、EXACT、SUBSTITUTE、INDEX、MATCH。公式解析結果有快取（批改重建工作簿時不重複解析）。
- **批改**（`server/episode3/validators.js`）：檢查實際狀態（排序後資料列完整及次序、可見列、圖表範圍／類型／標題／圖例、樞紐分析結果〔接受等價設定，例如 COUNT 任何沒有空白的欄位、轉置〕、藍本數值），並把學生的設定套用到隱藏測試數據；What-if 公式以多個假設值（包括邊界值）重算。
- **編輯器**：`public/js/sheet-tools.js`（工具列、篩選按鈕、對話框、分析面板、SVG 圖表，不需要外部圖表庫）。

## 新增劇集
新增 `server/episodeN/`（blueprint、generator、validators、fixtures、feedback、dialogue、preflight），並在 `server/episodes/index.js` 登記；比賽記錄 `episode` 欄位決定使用哪一集（舊比賽沒有此欄位時視為 E1）。計分、登入、工作表、提交流程不需改寫。
