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
  episode1/        blueprint（題目藍圖）、generator（數據生成）、validators（逐題批改）、
                   feedback（中文回饋及賽後回顧）、fixtures（正確／常見錯誤公式）、preflight、dialogue（配音事件）
  adapters/        demo-adapter（模擬工作表）、google-adapter（真實 Google Sheets）、start-sheet
  competition.js   狀態機、隊伍、計時、提示、人工調分、音訊 Spoiler Policy
  submission.js    提交流程（冪等、序列化、快照、完整性、批改、交叉核對）
  scoring.js       由紀錄推導分數（冪等）及排名
  views.js         Teacher／Student／Projector 視圖（權限過濾）
  realtime.js      SSE
  audio-assets.js  音檔狀態、試聽批准、錄音上載
public/            前端
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

## 擴展到 Episode 2／3
新增 `server/episodeN/`（blueprint、generator、validators、fixtures、dialogue），計分（`scoring.js`）、登入、Adapter、提交流程不需改寫。Excel 桌面版可新增 Adapter，實作 `provision` 及 `readLevel` 兩個方法即可。
