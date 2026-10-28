// Episode 1《新人報到》Challenge Blueprint（已審核的固定題目藍圖）。
// 題目文字、分數、作答範圍、參考公式全部固定；各隊只有數據不同。
// 注意：referenceFormulas 只供伺服器及教師使用，絕不傳送到學生端。

export const EPISODE_ID = 'E1';
export const TEMPLATE_VERSION = 'E1-BP-1.0.0';
export const GENERATOR_VERSION = 'E1-GEN-1.0.0';
export const VALIDATOR_VERSION = 'E1-VAL-1.0.0';

export const SERIES_TITLE = '定過抬油：站長爭奪戰';
export const EPISODE_TITLE = 'Episode 1《新人報到》';

export const TEAM_PRESETS = [
  { name: '荃灣綫', code: 'TWL', color: '#D7262E' },
  { name: '觀塘綫', code: 'KTL', color: '#1A9A48' },
  { name: '港島綫', code: 'ISL', color: '#1A6FC4' },
  { name: '東涌綫', code: 'TCL', color: '#F08A1D' },
  { name: '屯馬綫', code: 'TML', color: '#923011' },
  { name: '東鐵綫', code: 'EAL', color: '#3EA9DA' },
  { name: '南港島綫', code: 'SIL', color: '#9AA300' },
];

export const SKILLS = [
  { id: 'SUM', label: 'SUM' },
  { id: 'AVERAGE', label: 'AVERAGE' },
  { id: 'COUNT', label: 'COUNT' },
  { id: 'MAX', label: 'MAX' },
  { id: 'MIN', label: 'MIN（Bonus 用）' },
  { id: 'IF', label: 'IF' },
  { id: 'AND', label: 'AND' },
  { id: 'OR', label: 'OR' },
  { id: 'COUNTIF', label: 'COUNTIF' },
  { id: 'SUMIF', label: 'SUMIF' },
  { id: 'LEFT', label: 'LEFT' },
  { id: 'MID', label: 'MID' },
  { id: 'RIGHT', label: 'RIGHT' },
  { id: 'ABS_REF', label: '相對／絕對參照（$）及公式複製' },
  { id: 'AMP', label: '& 連接運算符' },
];

export const ROLE_LABELS = {
  driver: '駕駛員 Driver（輸入公式）',
  detective: '公式偵探 Formula Detective（分析題目）',
  checker: '檢查員 Checker（檢查結果）',
  navigator: '領航員 Navigator／Story Reader',
};

export const LEVELS = [
  {
    level: 1,
    sheet: 'L1_Fare',
    title: '八達通危機',
    defaultSeconds: 360,
    skills: ['SUM', 'ABS_REF'],
    storyGoal: '修復火箭仔忘記固定的車費調整系數，再核實所有乘客餘額。',
    successEffect: '儀表板「車費系統」由 Error 變為 Restored。',
    maxRow: 21,
    maxCol: 8,
    editable: ['D2:D21', 'F2:F21', 'H3', 'H5'],
    hints: [
      '檢查公式複製到下一列時，哪一個儲存格不應改變。',
      '乘車次數及車費應隨列改變，但 `H1` 必須固定。絕對參照需要在欄字母和列號前加 `$`。',
    ],
    tasks: [
      {
        id: 'L1-T1', cells: ['D2:D21'], focus: 'D2', points: 2,
        instruction: 'D 欄應計算每位乘客的總車費。火箭仔把 D2 的公式複製至其他列後，發現結果錯誤。請修正 D2 的公式，將 `H1` 設為**絕對參照**，然後將正確公式複製至 `D3:D21`。',
        markingPoints: [
          { id: 'a', label: 'D2 正確固定參照 $H$1 並計算正確', max: 1 },
          { id: 'b', label: 'D3:D21 全部正確複製', max: 1 },
        ],
      },
      {
        id: 'L1-T2', cells: ['F2:F21'], focus: 'F2', points: 2,
        instruction: '在 `F2` 建立公式，計算扣除總車費後的餘額，並將公式複製至 `F3:F21`。',
        markingPoints: [
          { id: 'a', label: 'F2 公式邏輯正確', max: 1 },
          { id: 'b', label: 'F3:F21 複製正確', max: 1 },
        ],
      },
      {
        id: 'L1-T3', cells: ['H3'], focus: 'H3', points: 2,
        instruction: '在 `H3` 建立公式，計算所有乘客的剩餘餘額總和。',
        markingPoints: [
          { id: 'a', label: '使用 SUM 及正確範圍 F2:F21', max: 1 },
          { id: 'b', label: '結果正確（包括隱藏測試）', max: 1 },
        ],
      },
      {
        id: 'L1-B1', cells: ['H5'], focus: 'H5', points: 1, bonus: true, skills: ['MIN'],
        instruction: '（Bonus 加題，非必答）在 `H5` 使用 `MIN`，找出所有乘客之中最低的剩餘餘額（`F2:F21`）。',
        markingPoints: [{ id: 'a', label: '使用 MIN 及正確範圍，結果正確', max: 1 }],
      },
    ],
    referenceFormulas: (() => {
      const r = {};
      for (let i = 2; i <= 21; i++) { r[`D${i}`] = `=B${i}*C${i}*$H$1`; r[`F${i}`] = `=E${i}-D${i}`; }
      r.H3 = '=SUM(F2:F21)';
      r.H5 = '=MIN(F2:F21)';
      return r;
    })(),
  },
  {
    level: 2,
    sheet: 'L2_Crowd',
    title: '繁忙時間',
    defaultSeconds: 360,
    skills: ['SUM', 'MAX', 'AVERAGE', 'COUNT'],
    storyGoal: '用數據找出車站最繁忙的時段。',
    successEffect: '月台顯示「高峰時段已識別」，列車指示燈恢復。',
    maxRow: 13,
    maxCol: 8,
    editable: ['D2:D13', 'H2:H4'],
    hints: [
      '先把每個時段的進站及出站人數相加，再分析 D 欄。',
      '最高值用 `MAX`，平均值用 `AVERAGE`，數值儲存格數目用 `COUNT`。',
    ],
    tasks: [
      {
        id: 'L2-T1', cells: ['D2:D13'], focus: 'D2', points: 2,
        instruction: '在 `D2` 使用 `SUM` 計算第一個時段的總人流（進站及出站人數），並將公式複製至 `D3:D13`。',
        markingPoints: [
          { id: 'a', label: 'D2 使用 SUM 正確計算總人流', max: 1 },
          { id: 'b', label: 'D3:D13 複製正確', max: 1 },
        ],
      },
      {
        id: 'L2-T2', cells: ['H2'], focus: 'H2', points: 1,
        instruction: '在 `H2` 使用合適函數，找出所有時段中最高的總人流。',
        markingPoints: [{ id: 'a', label: '正確找出最高總人流（D2:D13）', max: 1 }],
      },
      {
        id: 'L2-T3', cells: ['H3'], focus: 'H3', points: 1,
        instruction: '在 `H3` 使用合適函數，計算各時段的平均總人流。',
        markingPoints: [{ id: 'a', label: '正確計算平均總人流（D2:D13）', max: 1 }],
      },
      {
        id: 'L2-T4', cells: ['H4'], focus: 'H4', points: 1,
        instruction: '在 `H4` 使用 `COUNT` 計算 D2:D13 內含有數值的儲存格數目。',
        markingPoints: [{ id: 'a', label: '使用 COUNT 及正確範圍', max: 1 }],
      },
    ],
    referenceFormulas: (() => {
      const r = {};
      for (let i = 2; i <= 13; i++) r[`D${i}`] = `=SUM(B${i}:C${i})`;
      r.H2 = '=MAX(D2:D13)';
      r.H3 = '=AVERAGE(D2:D13)';
      r.H4 = '=COUNT(D2:D13)';
      return r;
    })(),
  },
  {
    level: 3,
    sheet: 'L3_Queue',
    title: '雙行排隊大戰',
    defaultSeconds: 420,
    skills: ['IF', 'AND', 'OR', 'ABS_REF'],
    storyGoal: '按遊戲中的虛構優先通道規則，判斷每位乘客可否使用優先通道。',
    successEffect: '優先通道燈變綠，乘客不再爭執。',
    safetyNote: '此關使用虛構的遊戲規則，不是現實港鐵優惠資格或真實交通政策。AssistPass 只是遊戲中的英文欄位。',
    rule: '持卡有效 **而且**（年齡達 `H1` 所示界線 **或者** 持有 `AssistPass="YES"`）的乘客，可使用遊戲中的優先通道。',
    maxRow: 25,
    maxCol: 8,
    editable: ['E2:E25', 'H2'],
    hints: [
      '先分清楚兩個條件：「年齡達標或有通行證」與「持卡有效」。',
      '括號內的年齡及通行證條件用 `OR`，再與有效卡條件用 `AND` 連接；最外層用 `IF` 輸出 1 或 0。',
    ],
    tasks: [
      {
        id: 'L3-T1', cells: ['E2:E25'], focus: 'E2', points: 3,
        instruction: '在 `E2` 建立公式，以 `IF`、`AND`、`OR` 判斷乘客是否符合優先通道規則。符合條件顯示數字 `1`，否則顯示 `0`。請將公式複製至 `E3:E25`。',
        markingPoints: [
          { id: 'a', label: 'IF 回傳正確的 1/0', max: 1 },
          { id: 'b', label: 'AND/OR 組合與參照正確', max: 1 },
          { id: 'c', label: 'E2:E25 整段複製結果正確', max: 1 },
        ],
      },
      {
        id: 'L3-T2', cells: ['H2'], focus: 'H2', points: 1,
        instruction: '在 `H2` 計算符合優先通道規則的乘客總人數。',
        markingPoints: [{ id: 'a', label: '總人數正確（使用公式）', max: 1 }],
      },
    ],
    referenceFormulas: (() => {
      const r = {};
      for (let i = 2; i <= 25; i++) r[`E${i}`] = `=IF(AND(OR(B${i}>=$H$1,C${i}="YES"),D${i}=TRUE),1,0)`;
      r.H2 = '=SUM(E2:E25)';
      return r;
    })(),
  },
  {
    level: 4,
    sheet: 'L4_LostFound',
    title: '失物認領處',
    defaultSeconds: 480,
    skills: ['COUNTIF', 'SUMIF', 'AMP'],
    storyGoal: '用條件函數統計失物，找出異常。',
    successEffect: '畫面顯示「異常記錄集中於午飯附近時段」。',
    maxRow: 501,
    maxCol: 10,
    editable: ['I2:I4'],
    hints: [
      '計算符合條件的件數，與計算符合條件的總價值，所用函數不同。',
      '`COUNTIF` 只需條件範圍及條件；`SUMIF` 還需要總和範圍。當比較條件引用儲存格 `H1`，需要將 `">="` 和 `H1` 用 `&` 連接。',
    ],
    tasks: [
      {
        id: 'L4-T1', cells: ['I2'], focus: 'I2', points: 2,
        instruction: '在 `I2` 使用 `COUNTIF`，計算 `Category` 與 `H2` 相同的失物件數。',
        markingPoints: [
          { id: 'a', label: '使用 COUNTIF 及正確條件範圍 B2:B501', max: 1 },
          { id: 'b', label: '條件引用 H2，結果正確', max: 1 },
        ],
      },
      {
        id: 'L4-T2', cells: ['I3'], focus: 'I3', points: 2,
        instruction: '在 `I3` 使用 `SUMIF`，計算 `H2` 指定類別的失物估計價值總和。',
        markingPoints: [
          { id: 'a', label: '使用 SUMIF，條件範圍 B2:B501 及條件 H2 正確', max: 1 },
          { id: 'b', label: '總和範圍 C2:C501 正確，結果正確', max: 1 },
        ],
      },
      {
        id: 'L4-T3', cells: ['I4'], focus: 'I4', points: 3,
        instruction: '在 `I4` 使用 `SUMIF`，計算所有**估計價值大於或等於 `H1`** 的失物價值總和。條件必須引用 `H1`，不可在公式內寫死其數值。',
        markingPoints: [
          { id: 'a', label: '比較運算符 >= 正確', max: 1 },
          { id: 'b', label: '正確使用 ">="&H1（引用 H1，不寫死數值）', max: 1 },
          { id: 'c', label: '總和範圍正確並通過隱藏測試', max: 1 },
        ],
      },
    ],
    referenceFormulas: {
      I2: '=COUNTIF(B2:B501,H2)',
      I3: '=SUMIF(B2:B501,H2,C2:C501)',
      I4: '=SUMIF(C2:C501,">="&H1,C2:C501)',
    },
  },
  {
    level: 5,
    sheet: 'L5_Announcement',
    title: '神秘廣播',
    defaultSeconds: 540,
    skills: ['LEFT', 'MID', 'RIGHT', 'AMP'],
    storyGoal: '由廣播代碼擷取英文字母，拼出秘密字詞。',
    successEffect: '已破解廣播密碼（全班完成後才一齊揭曉）。',
    maxRow: 6,
    maxCol: 8,
    editable: ['C2:C6', 'H2'],
    hints: [
      '不同函數可從字串開頭、中間或結尾擷取字元。',
      '開頭用 `LEFT`、中間用 `MID`、結尾用 `RIGHT`。`MID` 的開始位置可引用 B 欄。最後用 `&` 把五個 C 欄結果連接。',
    ],
    methods: ['LEFT', 'MID', 'RIGHT', 'MID', 'RIGHT'],
    tasks: [
      {
        id: 'L5-T1', cells: ['C2:C6'], focus: 'C2', points: 5,
        instruction: '按照工作表 D 欄（Method）的指定方式，在 `C2:C6` 使用 `LEFT`、`MID` 或 `RIGHT`，由各個 `Code` 擷取一個字母。使用 `MID` 時，位置由同列的 B 欄取得。指定方式：C2 用 LEFT、C3 用 MID、C4 用 RIGHT、C5 用 MID、C6 用 RIGHT。',
        markingPoints: [
          { id: 'C2', label: 'C2 使用 LEFT 正確擷取字母', max: 1 },
          { id: 'C3', label: 'C3 使用 MID（位置引用 B3）正確擷取字母', max: 1 },
          { id: 'C4', label: 'C4 使用 RIGHT 正確擷取字母', max: 1 },
          { id: 'C5', label: 'C5 使用 MID（位置引用 B5）正確擷取字母', max: 1 },
          { id: 'C6', label: 'C6 使用 RIGHT 正確擷取字母', max: 1 },
        ],
      },
      {
        id: 'L5-T2', cells: ['H2'], focus: 'H2', points: 2,
        instruction: '在 `H2` 使用 `&` 連接 `C2:C6` 的五個結果，組成秘密字詞。**不得直接輸入固定字串**。',
        markingPoints: [
          { id: 'a', label: '使用 & 連接 C2:C6（沒有寫死文字）', max: 1 },
          { id: 'b', label: '秘密字詞正確（包括隱藏測試）', max: 1 },
        ],
      },
    ],
    referenceFormulas: {
      C2: '=LEFT(A2,1)', C3: '=MID(A3,B3,1)', C4: '=RIGHT(A4,1)', C5: '=MID(A5,B5,1)', C6: '=RIGHT(A6,1)',
      H2: '=C2&C3&C4&C5&C6',
    },
  },
];

export const LEVEL_BY_NUM = Object.fromEntries(LEVELS.map((l) => [l.level, l]));
export const TASKS = LEVELS.flatMap((l) => l.tasks.map((t) => ({ ...t, level: l.level, sheet: l.sheet })));
export const TASK_BY_ID = Object.fromEntries(TASKS.map((t) => [t.id, t]));

export function levelMaxPoints(level, cancelled = []) {
  return LEVEL_BY_NUM[level].tasks.filter((t) => !t.bonus && !cancelled.includes(t.id)).reduce((s, t) => s + t.points, 0);
}

export function requiredTasks(level, cancelled = []) {
  return LEVEL_BY_NUM[level].tasks.filter((t) => !t.bonus && !cancelled.includes(t.id));
}

/** 學生可見的題目資料（不含參考公式） */
export function publicLevel(lv, { bonusEnabled = false } = {}) {
  return {
    level: lv.level,
    sheet: lv.sheet,
    title: lv.title,
    storyGoal: lv.storyGoal,
    rule: lv.rule || null,
    safetyNote: lv.safetyNote || null,
    editable: lv.editable,
    hintCount: lv.hints.length,
    tasks: lv.tasks.filter((t) => !t.bonus || bonusEnabled).map((t) => ({
      id: t.id, cells: t.cells, focus: t.focus, points: t.points, bonus: !!t.bonus,
      instruction: t.instruction,
      markingPoints: t.markingPoints.map(({ id, label, max }) => ({ id, label, max })),
    })),
  };
}
