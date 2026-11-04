// Episode 3《暴躁阿叔》Challenge Blueprint（最終回；各隊只有數據不同）。
// 故事：第二集證明火箭仔沒有拿走獎座，但部分公式錯誤確實是他造成的。今集暴躁阿叔大發雷霆：
// 車站紀錄錯漏百出，他成為新的疑犯。學生以排序、篩選、多工作表、圖表、樞紐分析表及假設分析（What-if）調查，
// 證據指向站長室——真相是肥站長的貓「咪咪」在沒有鎖上的電腦鍵盤上走過，修改了數據。
// 學習重點（HKDSE ICT「資料處理及分析」）：排序（單欄／多欄、保持資料列完整）、篩選（多條件、SUBTOTAL）、
// 多工作表及跨工作表參照、圖表（選擇合適類型、標題、座標軸、圖例、解讀趨勢及異常）、樞紐分析表（列、欄、值、篩選、
// SUM／COUNT／AVERAGE、樞紐分析圖）、假設分析（變數儲存格、分析藍本、目標搜尋）、數據完整性及存取控制。
// 注意：referenceFormulas／referenceMeta／teacherNotes 只供伺服器及教師使用，絕不傳送到學生端。

export const EPISODE_ID = 'E3';
export const TEMPLATE_VERSION = 'E3-BP-1.0.0';
export const GENERATOR_VERSION = 'E3-GEN-1.0.0';
export const VALIDATOR_VERSION = 'E3-VAL-1.0.0';
export const EPISODE_TITLE = 'Episode 3《暴躁阿叔》';

export const SKILLS = [
  { id: 'SORT', label: '排序（單欄、多欄，保持資料列完整）' },
  { id: 'FILTER', label: '篩選（多條件）及 SUBTOTAL' },
  { id: 'SHEETS', label: '多工作表及跨工作表參照' },
  { id: 'CHART', label: '圖表（類型、標題、座標軸、圖例、解讀）' },
  { id: 'PIVOT', label: '樞紐分析表及樞紐分析圖' },
  { id: 'WHATIF', label: '假設分析（分析藍本、目標搜尋）' },
  { id: 'COUNTIFS', label: 'COUNTIFS 等多條件函數' },
  { id: 'XLOOKUP', label: 'XLOOKUP（第二集）' },
  { id: 'TEXT', label: 'LEN／LEFT／REPT 文字函數' },
  { id: 'ABS_REF', label: '相對／絕對參照（$）及公式複製' },
];

export const ROLE_LABELS = {
  driver: '駕駛員 Driver（操作工作表）',
  detective: '公式偵探 Formula Detective（分析題目）',
  checker: '檢查員 Checker（檢查結果）',
  navigator: '領航員 Navigator／Story Reader',
};

const fillRef = (col, r1, r2, f) => Object.fromEntries(Array.from({ length: r2 - r1 + 1 }, (_, i) => [`${col}${r1 + i}`, f(r1 + i)]));

export const LEVELS = [
  // ---------------------------------------------------------------- L1 排序及篩選
  {
    level: 1,
    sheet: 'E3L1_Complaints',
    title: '暴躁阿叔的投訴',
    defaultSeconds: 540,
    skills: ['SORT', 'FILTER', 'XLOOKUP'],
    storyGoal: '整理一天內 120 宗乘客投訴，找出暴躁阿叔（UNCLE-WONG）最憤怒的投訴是關於甚麼。',
    successEffect: '投訴整理完成：阿叔的投訴集中在「數據錯誤」（DATA）。',
    rule: '表格範圍是 `A1:H121`（第 1 列是標題）。排序時整列一起移動，紀錄才會保持完整；篩選只會隱藏資料列，不會刪除數據。工具列有「A→Z／Z→A」、「⇅ 自訂排序」，標題列每欄都有篩選按鈕 ▾。作答格在表格下方 `B123:B127`（篩選時表格旁邊的列會一同隱藏，所以答案放在表格下面）。',
    maxRow: 127,
    maxCol: 8,
    editable: ['B123:B127'],
    tools: { table: 'A1:H121', sort: true, filter: true },
    hints: [
      '先點選要排序的欄（例如 WaitMin 欄任何一格），再按「Z→A」由大至小排序。多欄排序可用「⇅ 自訂排序」加入多個層級。篩選後用 SUBTOTAL 計算，被隱藏的列才不會計算在內。',
      '排序後表格第一筆資料在第 2 列，所以 `=A2` 會顯示排第一的投訴編號。多欄排序後，`XLOOKUP("DATA",E2:E121,A2:A121)` 會找到 DATA 類別的第一筆。可見列數目：`=SUBTOTAL(3,A2:A121)`；可見列的總和：`=SUBTOTAL(9,H2:H121)`。',
    ],
    tasks: [
      {
        id: 'E3-L1-T1', cells: ['B123:B124'], meta: ['!SORT'], focus: 'H2', points: 2, tier: 'core',
        instruction: '把**整個表格**按 `WaitMin`（等候分鐘）**由大至小**排序。然後在 `B123` 用公式引用排第一的 `ComplaintID`，在 `B124` 用公式引用排第三的 `Station`。',
        markingPoints: [
          { id: 'a', label: '整個表格按 WaitMin 由大至小排序（每列資料保持完整）', max: 1 },
          { id: 'b', label: 'B123、B124 以公式引用排序後的儲存格，結果正確', max: 1 },
        ],
        teacherNotes: ['排序：WaitMin（H 欄）由大至小，整個表格', 'B123 =A2；B124 =C4'],
      },
      {
        id: 'E3-L1-T2', cells: ['B125'], meta: ['!SORT'], focus: 'E2', points: 2, tier: 'core',
        instruction: '用**多欄排序**重新整理表格：先按 `Category`（A→Z），同一類別再按 `Severity`（由大至小），同一嚴重程度再按 `Time`（由早至遲）。然後在 `B125` 用 `XLOOKUP` 找出 `Category` 是 `DATA` 的第一筆投訴的 `ComplaintID`（即最嚴重而最早的數據錯誤投訴）。',
        markingPoints: [
          { id: 'a', label: '表格按 Category ↑、Severity ↓、Time ↑ 三層排序', max: 1 },
          { id: 'b', label: 'B125 用 XLOOKUP 找出 DATA 的第一筆投訴（換了數據仍然正確）', max: 1 },
        ],
        teacherNotes: ['排序：Category A→Z，Severity Z→A，Time A→Z（或由次要至主要逐次排序）', 'B125 =XLOOKUP("DATA",E2:E121,A2:A121)'],
      },
      {
        id: 'E3-L1-T3', cells: ['B126:B127'], meta: ['!FILTER'], focus: 'G1', points: 3, tier: 'stretch',
        instruction: '用**篩選**只顯示 `Caller` 是 `UNCLE-WONG` **而且** `Category` 是 `DATA` 的投訴。然後在 `B126` 計算**篩選後可見**的投訴數目，在 `B127` 計算這些投訴的 `WaitMin` 總和。（提示：被篩選隱藏的列不應計算在內。）',
        markingPoints: [
          { id: 'a', label: '篩選條件正確（同時符合 Caller 及 Category 兩個條件）', max: 1 },
          { id: 'b', label: 'B126 只計算可見的投訴數目', max: 1 },
          { id: 'c', label: 'B127 只加總可見投訴的 WaitMin', max: 1 },
        ],
        teacherNotes: ['篩選：G 欄＝UNCLE-WONG；E 欄＝DATA', 'B126 =SUBTOTAL(3,A2:A121)（或 COUNTIFS）；B127 =SUBTOTAL(9,H2:H121)（或 SUMIFS）'],
      },
    ],
    referenceFormulas: { B123: '=A2', B124: '=C4', B125: '=XLOOKUP("DATA",E2:E121,A2:A121)', B126: '=SUBTOTAL(3,A2:A121)', B127: '=SUBTOTAL(9,H2:H121)' },
    // 參考的分析設定（T1 之後是 T2 的排序；批改時各題按自己的要求檢查）
    referenceMeta: {
      'E3-L1-T1': { '!SORT': { ops: [{ keys: [{ col: 'H', dir: 'desc' }] }] } },
      'E3-L1-T2': { '!SORT': { ops: [{ keys: [{ col: 'E', dir: 'asc' }, { col: 'F', dir: 'desc' }, { col: 'B', dir: 'asc' }] }] } },
      'E3-L1-T3': { '!SORT': { ops: [{ keys: [{ col: 'E', dir: 'asc' }, { col: 'F', dir: 'desc' }, { col: 'B', dir: 'asc' }] }] }, '!FILTER': { crit: { G: { values: ['UNCLE-WONG'] }, E: { values: ['DATA'] } } } },
    },
  },
  // ---------------------------------------------------------------- L2 多工作表
  {
    level: 2,
    sheet: 'E3L2_Check',
    title: '消失的行車紀錄',
    defaultSeconds: 540,
    skills: ['SHEETS', 'XLOOKUP', 'ABS_REF', 'COUNTIFS'],
    storyGoal: '比對「時間表」與「行車紀錄」兩張工作表，找出消失及遲開的列車——阿叔說紀錄被人改過。',
    successEffect: '比對完成：有列車在行車紀錄中消失，而且全部集中在午飯時間。',
    rule: '這一關有三張工作表：`E3L2_Check`（作答）、`E3L2_Timetable`（時間表，`F2` 是遲開的容許分鐘）、`E3L2_Log`（行車紀錄，次序不同，而且有列車不見了）。時間以「一天中的第幾分鐘」表示，例如 `750` 即 12:30。跨工作表參照的寫法是 `工作表名稱!儲存格`，例如 `E3L2_Timetable!B2`。',
    maxRow: 41,
    maxCol: 8,
    editable: ['B2:B41', 'C2:C41', 'D2:D41', 'H2:H4'],
    extraSheets: [
      { sheet: 'E3L2_Timetable', title: '時間表', maxRow: 41, maxCol: 6 },
      { sheet: 'E3L2_Log', title: '行車紀錄', maxRow: 41, maxCol: 4 },
    ],
    tools: {},
    hints: [
      '先打開下方的工作表分頁看清楚兩份紀錄。`=E3L2_Timetable!B2` 會取得時間表的 B2；向下填充時列號會跟着改變。行車紀錄的次序不同，所以要用 XLOOKUP 查找。',
      '`C2`：`=XLOOKUP(A2,E3L2_Log!$A$2:$A$41,E3L2_Log!$B$2:$B$41,"MISSING")`。`D2`：先判斷是否 MISSING，再比較 `C2-B2` 與 `E3L2_Timetable!$F$2`。最後用 COUNTIF／COUNTIFS 統計。',
    ],
    tasks: [
      {
        id: 'E3-L2-T1', cells: ['B2:B41'], focus: 'B2', points: 2, tier: 'core',
        instruction: '在 `B2` 以**跨工作表參照**取得時間表 `E3L2_Timetable` 中同一列的 `SchedMin`（預定開出時間），並向下填充至 `B41`。不可以直接輸入數字。',
        markingPoints: [
          { id: 'a', label: 'B2 參照 E3L2_Timetable 工作表', max: 1 },
          { id: 'b', label: 'B2:B41 全部正確（時間表改變時會自動更新）', max: 1 },
        ],
        teacherNotes: ['B2 =E3L2_Timetable!B2（向下填充）'],
      },
      {
        id: 'E3-L2-T2', cells: ['C2:C41'], focus: 'C2', points: 2, tier: 'core',
        instruction: '在 `C2` 用 `XLOOKUP` 在行車紀錄 `E3L2_Log` 找出該列車的 `ActualMin`（實際開出時間）；行車紀錄沒有該列車時顯示 `MISSING`。向下填充至 `C41`。',
        markingPoints: [
          { id: 'a', label: 'C2 用 XLOOKUP 查找另一張工作表', max: 1 },
          { id: 'b', label: 'C2:C41 全部正確（範圍已固定，找不到顯示 MISSING）', max: 1 },
        ],
        teacherNotes: ['C2 =XLOOKUP(A2,E3L2_Log!$A$2:$A$41,E3L2_Log!$B$2:$B$41,"MISSING")'],
      },
      {
        id: 'E3-L2-T3', cells: ['D2:D41'], focus: 'D2', points: 2, tier: 'core',
        instruction: '在 `D2` 判斷列車狀態：`C2` 是 `MISSING` 時顯示 `MISSING`；否則延誤分鐘（`C2-B2`）**大於**時間表 `F2` 的容許分鐘時顯示 `LATE`，其餘顯示 `OK`。向下填充至 `D41`。',
        markingPoints: [
          { id: 'a', label: 'D2 用 IF 並以絕對參照引用 E3L2_Timetable!$F$2', max: 1 },
          { id: 'b', label: 'D2:D41 全部正確（容許分鐘改變時仍然正確）', max: 1 },
        ],
        teacherNotes: ['D2 =IF(C2="MISSING","MISSING",IF(C2-B2>E3L2_Timetable!$F$2,"LATE","OK"))'],
      },
      {
        id: 'E3-L2-T4', cells: ['H2:H4'], focus: 'H2', points: 3, tier: 'stretch',
        instruction: '統計結果：`H2` 計算 `MISSING` 的列車數目，`H3` 計算 `LATE` 的列車數目。**挑戰：** `H4` 用 `COUNTIFS` 計算在**月台 2**（時間表 `Platform` 欄）開出而狀態是 `LATE` 的列車數目。',
        markingPoints: [
          { id: 'a', label: 'H2 MISSING 數目正確', max: 1 },
          { id: 'b', label: 'H3 LATE 數目正確', max: 1 },
          { id: 'c', label: 'H4 以 COUNTIFS 結合兩張工作表的條件', max: 1 },
        ],
        teacherNotes: ['H2 =COUNTIF(D2:D41,"MISSING")', 'H3 =COUNTIF(D2:D41,"LATE")', 'H4 =COUNTIFS(D2:D41,"LATE",E3L2_Timetable!C2:C41,2)'],
      },
    ],
    referenceFormulas: {
      ...fillRef('B', 2, 41, (r) => `=E3L2_Timetable!B${r}`),
      ...fillRef('C', 2, 41, (r) => `=XLOOKUP(A${r},E3L2_Log!$A$2:$A$41,E3L2_Log!$B$2:$B$41,"MISSING")`),
      ...fillRef('D', 2, 41, (r) => `=IF(C${r}="MISSING","MISSING",IF(C${r}-B${r}>E3L2_Timetable!$F$2,"LATE","OK"))`),
      H2: '=COUNTIF(D2:D41,"MISSING")',
      H3: '=COUNTIF(D2:D41,"LATE")',
      H4: '=COUNTIFS(D2:D41,"LATE",E3L2_Timetable!C2:C41,2)',
    },
  },
  // ---------------------------------------------------------------- L3 圖表
  {
    level: 3,
    sheet: 'E3L3_Traffic',
    title: '數據會講嘢',
    defaultSeconds: 540,
    skills: ['CHART', 'XLOOKUP'],
    storyGoal: '阿叔說今日的人流數字「癲咗」。用圖表比較今日紀錄與平日的人流，找出異常的時段。',
    successEffect: '圖表一看就明：兩個異常都在午飯時間，而且不像真實的人流。',
    rule: '`A2:A19` 是時段（6 即 06:00–06:59），`B` 欄是平日平均人流，`C` 欄是星期日平均人流，`D` 欄是系統今日記錄的人流。選取數據後按「📊 插入圖表」，圖表會顯示在右邊的分析面板，數據改變時自動更新。',
    maxRow: 19,
    maxCol: 8,
    editable: ['G2:G4'],
    tools: { chart: true },
    hints: [
      '顯示「隨時間的變化趨勢」適合用折線圖；比較兩組類別數據適合用柱形圖。圖表要有標題、X 軸標題及 Y 軸標題。注意：Hour 欄是類別（X 軸標籤），不是要畫出來的數列。',
      '折線圖：類別 `A2:A19`，數列 `D2:D19`。比較圖：數列 `B2:B19`（名稱 Weekday）及 `C2:C19`（名稱 Sunday），並顯示圖例。`G2`：`=XLOOKUP(MAX(D2:D19),D2:D19,A2:A19)`；`G3`：用該時段的今日數字除以平日數字，再 ROUND 至 1 位小數。',
    ],
    tasks: [
      {
        id: 'E3-L3-T1', cells: [], meta: ['!CHARTS'], focus: 'D1', points: 2, tier: 'core',
        instruction: '建立一個**折線圖**，以 `Hour`（`A2:A19`）為類別，顯示今日記錄 `Today`（`D2:D19`）的變化。圖表要有**標題**、**X 軸標題**及 **Y 軸標題**。',
        markingPoints: [
          { id: 'a', label: '折線圖的類別及數列正確（不包括標題列，Hour 不是數列）', max: 1 },
          { id: 'b', label: '有圖表標題、X 軸標題及 Y 軸標題', max: 1 },
        ],
        teacherNotes: ['圖表：line，cats A2:A19，series D2:D19，填寫標題及兩個座標軸標題'],
      },
      {
        id: 'E3-L3-T2', cells: [], meta: ['!CHARTS'], focus: 'B1', points: 2, tier: 'core',
        instruction: '建立另一個**柱形圖**比較每個時段的平日（`Weekday`）與星期日（`Sunday`）人流，兩個數列都要有正確名稱，並**顯示圖例**。',
        markingPoints: [
          { id: 'a', label: '柱形圖（或棒形圖）包括 Weekday 及 Sunday 兩個數列，類別是 Hour', max: 1 },
          { id: 'b', label: '數列名稱正確並顯示圖例', max: 1 },
        ],
        teacherNotes: ['圖表：column（或 bar），cats A2:A19，series B2:B19 "Weekday"、C2:C19 "Sunday"，legend 開啟'],
      },
      {
        id: 'E3-L3-T3', cells: ['G2:G4'], focus: 'G2', points: 3, tier: 'stretch',
        instruction: '解讀圖表：`G2` 找出今日記錄**異常地高**的時段（Hour）；`G3` 計算該時段今日數字是平日數字的**多少倍**（用公式，四捨五入至 1 位小數）；`G4` 找出今日記錄**異常地低**（遠低於平日）的時段。',
        markingPoints: [
          { id: 'a', label: 'G2 異常高的時段正確', max: 1 },
          { id: 'b', label: 'G3 以公式計算倍數，結果正確', max: 1 },
          { id: 'c', label: 'G4 異常低的時段正確', max: 1 },
        ],
        teacherNotes: ['G2 =XLOOKUP(MAX(D2:D19),D2:D19,A2:A19)', 'G3 =ROUND(MAX(D2:D19)/XLOOKUP(G2,A2:A19,B2:B19),1)', 'G4 =XLOOKUP(MIN(D2:D19),D2:D19,A2:A19)'],
      },
    ],
    referenceFormulas: {
      G2: '=XLOOKUP(MAX(D2:D19),D2:D19,A2:A19)',
      G3: '=ROUND(MAX(D2:D19)/XLOOKUP(G2,A2:A19,B2:B19),1)',
      G4: '=XLOOKUP(MIN(D2:D19),D2:D19,A2:A19)',
    },
    referenceMeta: {
      'E3-L3-T1': { '!CHARTS': [{ id: 'C1', type: 'line', title: 'Today passenger entries', xTitle: 'Hour', yTitle: 'Entries', legend: false, cats: 'A2:A19', series: [{ name: 'Today', ref: 'D2:D19' }] }] },
      'E3-L3-T2': { '!CHARTS': [{ id: 'C2', type: 'column', title: 'Weekday vs Sunday', xTitle: 'Hour', yTitle: 'Entries', legend: true, cats: 'A2:A19', series: [{ name: 'Weekday', ref: 'B2:B19' }, { name: 'Sunday', ref: 'C2:C19' }] }] },
    },
  },
  // ---------------------------------------------------------------- L4 樞紐分析表
  {
    level: 4,
    sheet: 'E3L4_Records',
    title: '站長的秘密報告',
    defaultSeconds: 600,
    skills: ['PIVOT', 'CHART'],
    storyGoal: '站長室的系統有 240 條修改紀錄。用樞紐分析表找出哪部電腦、甚麼時候改動了最多數據。',
    successEffect: '樞紐分析完成：大量修改來自站長室的電腦（FSM-PC），而且集中在午飯時間！',
    rule: '來源數據 `A1:G241`：`Computer`（電腦）、`User`（登入帳戶）、`Hour`（時段）、`Cells`（改動的儲存格數目）等。按「🧮 樞紐分析表」設定列（Rows）、欄（Columns）、值（Values）及篩選（Filters）；結果顯示在右邊的分析面板。可以修改同一個樞紐分析表，或建立多個。',
    maxRow: 241,
    maxCol: 10,
    editable: ['J2:J4'],
    tools: { pivot: true, pivotSource: 'A1:G241', chart: true },
    hints: [
      '「每部電腦有多少條紀錄」：列放 Computer，值用 COUNT（計數）。「每個時段改了多少格」：列放 Hour，值用 Cells 的 SUM（加總），再用篩選只看 FSM-PC。',
      '最後一題：列放 Hour、欄放 User、值放 SUM of Cells、篩選 Computer＝FSM-PC；然後插入圖表，數據來源選擇這個樞紐分析表（樞紐分析圖）。在樞紐分析表找出 FSM 那一欄在最高峰時段的數字。',
    ],
    tasks: [
      {
        id: 'E3-L4-T1', cells: ['J2'], meta: ['!PIVOTS'], focus: 'D1', points: 2, tier: 'core',
        instruction: '建立樞紐分析表：**列**放 `Computer`，**值**計算每部電腦的紀錄數目（COUNT）。在 `J2` 輸入紀錄最多的電腦名稱。',
        markingPoints: [
          { id: 'a', label: '樞紐分析表按 Computer 計算紀錄數目', max: 1 },
          { id: 'b', label: 'J2 紀錄最多的電腦正確', max: 1 },
        ],
        teacherNotes: ['樞紐：rows Computer，values COUNT of RecordID（任何沒有空白的欄位亦可）', 'J2：紀錄最多的電腦'],
      },
      {
        id: 'E3-L4-T2', cells: ['J3'], meta: ['!PIVOTS'], focus: 'C1', points: 2, tier: 'core',
        instruction: '修改或新增樞紐分析表：**列**放 `Hour`，**值**是 `Cells` 的**加總（SUM）**，並用**篩選**只計算 `Computer` 是 `FSM-PC` 的紀錄。在 `J3` 輸入 FSM-PC 改動儲存格最多的時段（Hour）。',
        markingPoints: [
          { id: 'a', label: '樞紐分析表：Hour × SUM of Cells，篩選 FSM-PC', max: 1 },
          { id: 'b', label: 'J3 改動最多的時段正確', max: 1 },
        ],
        teacherNotes: ['樞紐：rows Hour，values SUM of Cells，filter Computer = FSM-PC', 'J3：最高的時段'],
      },
      {
        id: 'E3-L4-T3', cells: ['J4'], meta: ['!PIVOTS', '!CHARTS'], focus: 'E1', points: 3, tier: 'stretch',
        instruction: '挑戰：建立樞紐分析表，**列** `Hour`、**欄** `User`、**值** `Cells` 的 SUM，**篩選** `Computer`＝`FSM-PC`；再以這個樞紐分析表建立**樞紐分析圖**（柱形圖）。在 `J4` 輸入：在 FSM-PC 改動最多的時段，帳戶 `FSM` 改動了多少格。',
        markingPoints: [
          { id: 'a', label: '二維樞紐分析表（Hour × User，SUM of Cells，篩選 FSM-PC）正確', max: 1 },
          { id: 'b', label: '以樞紐分析表建立柱形／棒形樞紐分析圖', max: 1 },
          { id: 'c', label: 'J4 讀取正確', max: 1 },
        ],
        teacherNotes: ['樞紐：rows Hour，cols User，values SUM of Cells，filter Computer = FSM-PC；圖表 source = 該樞紐', 'J4：最高時段 × FSM 的數值'],
      },
    ],
    referenceFormulas: {},
    referenceMeta: {
      'E3-L4-T1': { '!PIVOTS': [{ id: 'P1', rows: ['Computer'], cols: [], values: [{ field: 'RecordID', agg: 'COUNT' }], filters: [] }] },
      'E3-L4-T2': { '!PIVOTS': [{ id: 'P2', rows: ['Hour'], cols: [], values: [{ field: 'Cells', agg: 'SUM' }], filters: [{ field: 'Computer', values: ['FSM-PC'] }] }] },
      'E3-L4-T3': { '!PIVOTS': [{ id: 'P3', rows: ['Hour'], cols: ['User'], values: [{ field: 'Cells', agg: 'SUM' }], filters: [{ field: 'Computer', values: ['FSM-PC'] }] }], '!CHARTS': [{ id: 'C1', type: 'column', title: 'FSM-PC edits by hour', xTitle: 'Hour', yTitle: 'Cells', legend: true, source: { pivot: 'P3' } }] },
    },
  },
  // ---------------------------------------------------------------- L5 假設分析＋綜合
  {
    level: 5,
    sheet: 'E3L5_Model',
    title: '真相大白',
    defaultSeconds: 660,
    skills: ['WHATIF', 'COUNTIFS', 'TEXT', 'ABS_REF', 'SHEETS'],
    storyGoal: '用修改日誌重組午飯時間發生的事：哪些修改是在站長離開、電腦未鎖上時做的？那些亂碼是誰打的？',
    successEffect: '真相大白：亂碼全部在電腦未鎖上時出現——是貓咪咪踩過鍵盤！阿叔是清白的。',
    rule: '`E3L5_EditLog` 工作表是 60 條修改紀錄（`Minute` 是一天中的第幾分鐘，`NewValue` 是輸入的內容）。`B2` 是站長離開站長室的時間；`B3` 是**假設**的螢幕自動鎖定分鐘（變數儲存格，可以改變）；`B4` 是 IT 部記錄的實際鎖定設定。`D` 欄的 EditID 與修改日誌同一列對應。',
    maxRow: 61,
    maxCol: 9,
    editable: ['B3', 'E2:E61', 'F2:F61', 'I1:I5'],
    extraSheets: [{ sheet: 'E3L5_EditLog', title: '修改日誌', maxRow: 61, maxCol: 6 }],
    tools: { scenario: true, goalseek: true, changing: ['B3'], results: ['I1', 'I2'] },
    hints: [
      '電腦「未鎖上」的時間是 B2 至 B2+B3 之間（不包括 B2+B3）。複製公式時 B2、B3 要用 $ 固定。貓咪踩鍵盤會輸入同一個字母重複很多次（例如 kkkkkkk）：可以比較 NewValue 與 `REPT(LEFT(NewValue,1),LEN(NewValue))`。',
      '`E2`：`=IF(AND(E3L5_EditLog!C2="FSM-PC",E3L5_EditLog!B2>=$B$2,E3L5_EditLog!B2<$B$2+$B$3),1,0)`。`F2`：`=IF(AND(LEN(E3L5_EditLog!F2)>=5,E3L5_EditLog!F2=REPT(LEFT(E3L5_EditLog!F2,1),LEN(E3L5_EditLog!F2))),1,0)`。`I1`：`=COUNTIFS(E2:E61,1,F2:F61,1)`；`I2`：`=COUNTIF(F2:F61,1)`。用「🔀 分析藍本」比較 B3＝5、15、30，用「🎯 目標搜尋」找出 I1 達到 I2 的最少分鐘。',
    ],
    tasks: [
      {
        id: 'E3-L5-T1', cells: ['E2:E61'], focus: 'E2', points: 2, tier: 'core',
        instruction: '在 `E2` 判斷修改是否在**站長室電腦（FSM-PC）未鎖上**時發生：日誌的 `Computer` 是 `FSM-PC`，而且 `Minute` 在 `B2`（包括）至 `B2+B3`（不包括）之間時顯示 `1`，否則 `0`。向下填充至 `E61`。`B3` 改變時結果要自動更新。',
        markingPoints: [
          { id: 'a', label: 'E2 用 IF 及 AND，並以絕對參照引用 $B$2、$B$3', max: 1 },
          { id: 'b', label: 'E2:E61 在不同的 B3 假設下都正確', max: 1 },
        ],
        teacherNotes: ['E2 =IF(AND(E3L5_EditLog!C2="FSM-PC",E3L5_EditLog!B2>=$B$2,E3L5_EditLog!B2<$B$2+$B$3),1,0)'],
      },
      {
        id: 'E3-L5-T2', cells: ['F2:F61'], focus: 'F2', points: 2, tier: 'core',
        instruction: '在 `F2` 找出「貓咪踩鍵盤」的痕跡：日誌 `NewValue` 最少 5 個字元，而且**全部是同一個字元**（例如 `kkkkkkk`、`99999`）時顯示 `1`，否則 `0`。向下填充至 `F61`。',
        markingPoints: [
          { id: 'a', label: 'F2 使用 LEN 及 REPT／LEFT（或等效方法）', max: 1 },
          { id: 'b', label: 'F2:F61 全部正確（包括隱藏測試）', max: 1 },
        ],
        teacherNotes: ['F2 =IF(AND(LEN(E3L5_EditLog!F2)>=5,E3L5_EditLog!F2=REPT(LEFT(E3L5_EditLog!F2,1),LEN(E3L5_EditLog!F2))),1,0)'],
      },
      {
        id: 'E3-L5-T3', cells: ['B3', 'I1:I3'], meta: ['!SCEN'], focus: 'I1', points: 3, tier: 'stretch',
        instruction: '假設分析：`I1` 計算「未鎖上時出現的貓咪痕跡」數目（E、F 都是 1），`I2` 計算全部貓咪痕跡數目。用**分析藍本**建立 `LOCK5`、`LOCK15`、`LOCK30` 三個藍本（`B3` 分別是 5、15、30），結果儲存格包括 `I1`。再用**目標搜尋**（或嘗試不同數值）找出令 `I1` 等於 `I2` 的**最少**鎖定分鐘，填在 `I3`。',
        markingPoints: [
          { id: 'a', label: 'I1、I2 公式正確（B3 改變時自動重新計算）', max: 1 },
          { id: 'b', label: '分析藍本 LOCK5／LOCK15／LOCK30 設定正確，結果包括 I1', max: 1 },
          { id: 'c', label: 'I3 最少鎖定分鐘正確', max: 1 },
        ],
        teacherNotes: ['I1 =COUNTIFS(E2:E61,1,F2:F61,1)；I2 =COUNTIF(F2:F61,1)', '藍本：B3 = 5、15、30，結果 I1', 'I3：最少鎖定分鐘（目標搜尋 I1 = I2；或 =MAXIFS(E3L5_EditLog!B2:B61,F2:F61,1)-B2+1）'],
      },
      {
        id: 'E3-L5-T4', cells: ['B3', 'I4:I5'], focus: 'I4', points: 3, tier: 'stretch',
        instruction: '最終推理：把 `B3` 設為 IT 部記錄的**實際**鎖定設定（`B4`），檢查所有貓咪痕跡是否都能解釋（`I1`＝`I2`）。`I4` 計算火箭仔（帳戶 `R07`）自己做的修改數目——這些是他的公式錯誤，與貓無關。`I5` 輸入真正改動站長室數據的「疑犯」：`CAT`、`UNCLE` 或 `ROCKET`。',
        markingPoints: [
          { id: 'a', label: 'I4 正確計算 R07 的修改（換了數據仍然正確）', max: 1 },
          { id: 'b', label: 'B3 是實際設定，而且數據顯示 I1＝I2（全部痕跡都能解釋）', max: 1 },
          { id: 'c', label: 'I5 結論有數據支持', max: 1 },
        ],
        teacherNotes: ['I4 =COUNTIF(E3L5_EditLog!D2:D61,"R07")', 'B3 = B4（實際設定）', 'I5 = CAT'],
      },
    ],
    referenceFormulas: {
      B3: '=B4',
      ...fillRef('E', 2, 61, (r) => `=IF(AND(E3L5_EditLog!C${r}="FSM-PC",E3L5_EditLog!B${r}>=$B$2,E3L5_EditLog!B${r}<$B$2+$B$3),1,0)`),
      ...fillRef('F', 2, 61, (r) => `=IF(AND(LEN(E3L5_EditLog!F${r})>=5,E3L5_EditLog!F${r}=REPT(LEFT(E3L5_EditLog!F${r},1),LEN(E3L5_EditLog!F${r}))),1,0)`),
      I1: '=COUNTIFS(E2:E61,1,F2:F61,1)',
      I2: '=COUNTIF(F2:F61,1)',
      I3: '=MAXIFS(E3L5_EditLog!B2:B61,F2:F61,1)-B2+1',
      I4: '=COUNTIF(E3L5_EditLog!D2:D61,"R07")',
      I5: 'CAT',
    },
    referenceMeta: {
      'E3-L5-T3': { '!SCEN': { changing: ['B3'], result: ['I1'], list: [{ name: 'LOCK5', values: { B3: 5 } }, { name: 'LOCK15', values: { B3: 15 } }, { name: 'LOCK30', values: { B3: 30 } }] } },
    },
  },
];

export const LEVEL_BY_NUM = Object.fromEntries(LEVELS.map((l) => [l.level, l]));
export const TASKS = LEVELS.flatMap((l) => l.tasks.map((t) => ({ ...t, level: l.level, sheet: l.sheet })));
export const TASK_BY_ID = Object.fromEntries(TASKS.map((t) => [t.id, t]));

/** 學生可見的題目資料（不含參考公式、參考設定或教師備註） */
export function publicLevel(lv, { bonusEnabled = false } = {}) {
  return {
    level: lv.level,
    sheet: lv.sheet,
    title: lv.title,
    storyGoal: lv.storyGoal,
    rule: lv.rule || null,
    safetyNote: lv.safetyNote || null,
    editable: lv.editable,
    extraSheets: (lv.extraSheets || []).map((x) => ({ sheet: x.sheet, title: x.title })),
    hintCount: lv.hints.length,
    tasks: lv.tasks.filter((t) => !t.bonus || bonusEnabled).map((t) => ({
      id: t.id, cells: t.cells, meta: t.meta || [], focus: t.focus, points: t.points, bonus: !!t.bonus, tier: t.tier || 'core',
      instruction: t.instruction,
      markingPoints: t.markingPoints.map(({ id, label, max }) => ({ id, label, max })),
    })),
  };
}
