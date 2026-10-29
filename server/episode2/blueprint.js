// Episode 2《疑犯火箭仔》Challenge Blueprint（固定題目藍圖；各隊只有數據不同）。
// 故事：第一集發現異常都在午飯時間（LUNCH）。今集肥站長的「最佳站長獎座」在午飯時間由辦公室消失，
// 門禁紀錄顯示火箭仔的員工證曾開門。學生以數據調查：FIND、XLOOKUP、ROUND、INT、SQRT、RANK、RAND。
// 注意：referenceFormulas 只供伺服器及教師使用，絕不傳送到學生端。

export const EPISODE_ID = 'E2';
export const TEMPLATE_VERSION = 'E2-BP-1.0.0';
export const GENERATOR_VERSION = 'E2-GEN-1.0.0';
export const VALIDATOR_VERSION = 'E2-VAL-1.0.0';
export const EPISODE_TITLE = 'Episode 2《疑犯火箭仔》';

export const SKILLS = [
  { id: 'FIND', label: 'FIND（找出字元位置）' },
  { id: 'TEXT', label: 'LEFT／MID／RIGHT／LEN' },
  { id: 'XLOOKUP', label: 'XLOOKUP（包括「找不到」時的值）' },
  { id: 'ROUND', label: 'ROUND' },
  { id: 'INT', label: 'INT' },
  { id: 'SQRT', label: 'SQRT 及 ^（次方）' },
  { id: 'RANK', label: 'RANK' },
  { id: 'RAND', label: 'RAND' },
  { id: 'COUNTIF', label: 'COUNTIF（第一集）' },
  { id: 'ABS_REF', label: '相對／絕對參照（$）及公式複製' },
];

export const ROLE_LABELS = {
  driver: '駕駛員 Driver（輸入公式）',
  detective: '公式偵探 Formula Detective（分析題目）',
  checker: '檢查員 Checker（檢查結果）',
  navigator: '領航員 Navigator／Story Reader',
};

const fillRef = (col, r1, r2, f) => Object.fromEntries(Array.from({ length: r2 - r1 + 1 }, (_, i) => [`${col}${r1 + i}`, f(r1 + i)]));

export const LEVELS = [
  {
    level: 1,
    sheet: 'E2L1_DoorLog',
    title: '門禁紀錄',
    defaultSeconds: 420,
    skills: ['FIND', 'TEXT', 'COUNTIF'],
    storyGoal: '由辦公室門禁紀錄找出每次開門的時間及員工證號碼。',
    successEffect: '門禁紀錄已解碼：可以看到每張員工證的開門時間。',
    rule: '每條紀錄的格式是「地點@時間#員工證號碼」，例如 `OFFICE@1231#R07`。地點及員工證號碼的長度並不固定，所以要用 `FIND` 找出 `@` 及 `#` 的位置。',
    maxRow: 21,
    maxCol: 8,
    editable: ['B2:B21', 'C2:C21', 'D2:D21', 'H2'],
    hints: [
      '先找出 @ 在第幾個字元，時間就在 @ 之後的四個字元。',
      '`FIND("@",A2)` 會回傳 @ 的位置；`MID(A2, 位置+1, 4)` 可以取出時間。員工證號碼在 # 之後直到最後，可以用 `LEN(A2)-FIND("#",A2)` 計算長度。',
    ],
    tasks: [
      {
        id: 'E2-L1-T1', cells: ['B2:B21'], focus: 'B2', points: 2,
        instruction: '在 `B2` 使用 `FIND`，找出 A2 紀錄中「@」所在的位置，並將公式複製至 `B3:B21`。',
        markingPoints: [
          { id: 'a', label: 'B2 使用 FIND 找出 @ 的位置', max: 1 },
          { id: 'b', label: 'B3:B21 全部正確（地點長度不同亦正確）', max: 1 },
        ],
      },
      {
        id: 'E2-L1-T2', cells: ['C2:C21'], focus: 'C2', points: 2,
        instruction: '在 `C2` 取出 @ 之後的四位數時間（例如 `1231`），並將公式複製至 `C3:C21`。開始位置必須由 @ 的位置計算（可以引用 B 欄），不可以寫死數字。',
        markingPoints: [
          { id: 'a', label: 'C2 使用 MID，開始位置由 @ 的位置計算', max: 1 },
          { id: 'b', label: 'C3:C21 全部正確（包括隱藏測試）', max: 1 },
        ],
      },
      {
        id: 'E2-L1-T3', cells: ['D2:D21'], focus: 'D2', points: 2,
        instruction: '在 `D2` 取出 # 之後的整個員工證號碼（號碼長度不同，例如 `R07`、`SEC12`），並將公式複製至 `D3:D21`。必須使用 `FIND` 找出 # 的位置。',
        markingPoints: [
          { id: 'a', label: 'D2 使用 FIND 找出 # 的位置', max: 1 },
          { id: 'b', label: 'D3:D21 全部正確（不同長度的號碼亦正確）', max: 1 },
        ],
      },
      {
        id: 'E2-L1-T4', cells: ['H2'], focus: 'H2', points: 1,
        instruction: '在 `H2` 計算員工證號碼（D 欄）與 `H1` 相同的紀錄數目。',
        markingPoints: [{ id: 'a', label: '使用 COUNTIF 並引用 H1，結果正確', max: 1 }],
      },
    ],
    referenceFormulas: {
      ...fillRef('B', 2, 21, (r) => `=FIND("@",A${r})`),
      ...fillRef('C', 2, 21, (r) => `=MID(A${r},FIND("@",A${r})+1,4)`),
      ...fillRef('D', 2, 21, (r) => `=RIGHT(A${r},LEN(A${r})-FIND("#",A${r}))`),
      H2: '=COUNTIF(D2:D21,H1)',
    },
  },
  {
    level: 2,
    sheet: 'E2L2_Roster',
    title: '員工名冊',
    defaultSeconds: 420,
    skills: ['XLOOKUP', 'ABS_REF'],
    storyGoal: '用員工名冊查出每張員工證的主人及當值時段，找出誰是訪客。',
    successEffect: '名冊對照完成：訪客及當值同事一目了然。',
    rule: '員工名冊在 `G2:I9`（Code、StaffName、ShiftTime）。名冊內找不到的號碼是訪客。',
    maxRow: 16,
    maxCol: 9,
    editable: ['B2:B16', 'C2:C16', 'H12'],
    hints: [
      '查找值是 A 欄的號碼，查找範圍是名冊的 Code 欄，傳回範圍是名冊的 StaffName 或 ShiftTime 欄。',
      '`XLOOKUP(查找值, 查找範圍, 傳回範圍, 找不到時的值)`；向下複製時名冊範圍要加 $ 固定，例如 `$G$2:$G$9`。',
    ],
    tasks: [
      {
        id: 'E2-L2-T1', cells: ['B2:B16'], focus: 'B2', points: 2,
        instruction: '在 `B2` 使用 `XLOOKUP`，按 A2 的號碼在名冊（`G2:G9`）找出員工姓名（`H2:H9`）。名冊找不到的號碼要顯示 `VISITOR`。將公式複製至 `B3:B16`。',
        markingPoints: [
          { id: 'a', label: 'B2 使用 XLOOKUP，查找及傳回範圍正確', max: 1 },
          { id: 'b', label: 'B3:B16 全部正確（名冊範圍固定，訪客顯示 VISITOR）', max: 1 },
        ],
      },
      {
        id: 'E2-L2-T2', cells: ['C2:C16'], focus: 'C2', points: 2,
        instruction: '在 `C2` 使用 `XLOOKUP` 找出當值時段（`I2:I9`）。名冊找不到的號碼要顯示 `NONE`。將公式複製至 `C3:C16`。',
        markingPoints: [
          { id: 'a', label: 'C2 使用 XLOOKUP，傳回 ShiftTime 欄', max: 1 },
          { id: 'b', label: 'C3:C16 全部正確（找不到時顯示 NONE）', max: 1 },
        ],
      },
      {
        id: 'E2-L2-T3', cells: ['H12'], focus: 'H12', points: 1,
        instruction: '`H11` 是一位員工的姓名。在 `H12` 使用 `XLOOKUP` 反過來由姓名找出他的員工證號碼（Code）。',
        markingPoints: [{ id: 'a', label: '以姓名欄查找、傳回 Code 欄，結果正確', max: 1 }],
      },
    ],
    referenceFormulas: {
      ...fillRef('B', 2, 16, (r) => `=XLOOKUP(A${r},$G$2:$G$9,$H$2:$H$9,"VISITOR")`),
      ...fillRef('C', 2, 16, (r) => `=XLOOKUP(A${r},$G$2:$G$9,$I$2:$I$9,"NONE")`),
      H12: '=XLOOKUP(H11,H2:H9,G2:G9)',
    },
  },
  {
    level: 3,
    sheet: 'E2L3_Cash',
    title: '現金箱對數',
    defaultSeconds: 420,
    skills: ['ROUND', 'INT', 'ABS_REF'],
    storyGoal: '核對辦公室現金箱，確認獎座失蹤時有沒有現金短少。',
    successEffect: '現金一分不差：獎座不是被拿去換錢。',
    rule: '港幣最小單位是一毫（0.1 元），所以每項金額要四捨五入至一位小數。每個現金袋可以裝 `H1` 元。',
    maxRow: 13,
    maxCol: 8,
    editable: ['D2:D13', 'E2:E13', 'H3'],
    hints: [
      '四捨五入用 ROUND；「足夠裝滿多少個袋」要向下取整數，不可以四捨五入。',
      '金額 `=ROUND(B2*C2,1)`；袋數 `=INT(D2/$H$1)`；總數可以先 SUM 再 ROUND。',
    ],
    tasks: [
      {
        id: 'E2-L3-T1', cells: ['D2:D13'], focus: 'D2', points: 2,
        instruction: '在 `D2` 計算金額（UnitPrice × Qty），並用 `ROUND` 四捨五入至**一位小數**。將公式複製至 `D3:D13`。',
        markingPoints: [
          { id: 'a', label: 'D2 使用 ROUND 至一位小數', max: 1 },
          { id: 'b', label: 'D3:D13 全部正確（包括隱藏測試）', max: 1 },
        ],
      },
      {
        id: 'E2-L3-T2', cells: ['E2:E13'], focus: 'E2', points: 2,
        instruction: '在 `E2` 使用 `INT` 計算 D2 的金額可以裝滿多少個現金袋（每袋 `H1` 元，不足一袋不計），並將公式複製至 `E3:E13`。',
        markingPoints: [
          { id: 'a', label: 'E2 使用 INT 並固定引用 $H$1', max: 1 },
          { id: 'b', label: 'E3:E13 全部正確（包括 H1 改變的隱藏測試）', max: 1 },
        ],
      },
      {
        id: 'E2-L3-T3', cells: ['H3'], focus: 'H3', points: 2,
        instruction: '在 `H3` 計算所有金額（`D2:D13`）的總和，並四捨五入至**整數**（元）。',
        markingPoints: [
          { id: 'a', label: '使用 ROUND 及 SUM（範圍 D2:D13）', max: 1 },
          { id: 'b', label: '結果正確（包括隱藏測試）', max: 1 },
        ],
      },
    ],
    referenceFormulas: {
      ...fillRef('D', 2, 13, (r) => `=ROUND(B${r}*C${r},1)`),
      ...fillRef('E', 2, 13, (r) => `=INT(D${r}/$H$1)`),
      H3: '=ROUND(SUM(D2:D13),0)',
    },
  },
  {
    level: 4,
    sheet: 'E2L4_Alibi',
    title: '不在場證明',
    defaultSeconds: 480,
    skills: ['SQRT', 'RANK', 'XLOOKUP', 'ABS_REF'],
    storyGoal: '計算 12:31 時每位同事與辦公室的距離，看看火箭仔有沒有不在場證明。',
    successEffect: '距離排名完成：12:31 時誰最接近辦公室，一清二楚。',
    rule: '車站平面圖以米為單位。辦公室位置是（`H1`, `H2`）。兩點距離 = √((X − 辦公室X)² + (Y − 辦公室Y)²)。距離不需要四捨五入。',
    maxRow: 9,
    maxCol: 8,
    editable: ['E2:E9', 'F2:F9', 'H4'],
    hints: [
      '次方用 ^，例如 `(C2-$H$1)^2`；平方根用 SQRT。',
      '最接近排第 1，即由小至大排名：`RANK(E2,$E$2:$E$9,1)`。最後用 XLOOKUP 找出排名 1 的姓名。',
    ],
    tasks: [
      {
        id: 'E2-L4-T1', cells: ['E2:E9'], focus: 'E2', points: 2,
        instruction: '在 `E2` 使用 `SQRT` 計算 A2 同事與辦公室（`H1`, `H2`）的距離，並將公式複製至 `E3:E9`。',
        markingPoints: [
          { id: 'a', label: 'E2 使用 SQRT 及 ^2，結果正確', max: 1 },
          { id: 'b', label: 'E3:E9 全部正確（辦公室位置以 $ 固定，包括隱藏測試）', max: 1 },
        ],
      },
      {
        id: 'E2-L4-T2', cells: ['F2:F9'], focus: 'F2', points: 2,
        instruction: '在 `F2` 使用 `RANK` 排列距離：**最接近辦公室排第 1**。將公式複製至 `F3:F9`。',
        markingPoints: [
          { id: 'a', label: 'F2 使用 RANK，由小至大排名', max: 1 },
          { id: 'b', label: 'F3:F9 全部正確（排名範圍固定）', max: 1 },
        ],
      },
      {
        id: 'E2-L4-T3', cells: ['H4'], focus: 'H4', points: 1,
        instruction: '在 `H4` 使用 `XLOOKUP` 找出排名第 1（最接近辦公室）的同事姓名。',
        markingPoints: [{ id: 'a', label: '使用 XLOOKUP，以排名找出姓名，結果正確', max: 1 }],
      },
    ],
    referenceFormulas: {
      ...fillRef('E', 2, 9, (r) => `=SQRT((C${r}-$H$1)^2+(D${r}-$H$2)^2)`),
      ...fillRef('F', 2, 9, (r) => `=RANK(E${r},$E$2:$E$9,1)`),
      H4: '=XLOOKUP(1,F2:F9,A2:A9)',
    },
  },
  {
    level: 5,
    sheet: 'E2L5_Random',
    title: '隨機抽查',
    defaultSeconds: 420,
    skills: ['RAND', 'RANK', 'INT', 'ABS_REF'],
    storyGoal: '用隨機方法決定抽查儲物櫃的次序，公平地找出獎座的下落。',
    successEffect: '抽查次序已隨機決定：保安正逐個儲物櫃檢查……',
    rule: '隨機數每次重新計算都會改變，所以系統會用很多組隨機數檢查你的公式是否永遠正確。',
    maxRow: 13,
    maxCol: 8,
    editable: ['B2:B13', 'C2:C13', 'H2'],
    hints: [
      'RAND() 會產生 0 至 1 之間的隨機數，不需要任何參數。',
      '抽查次序：`RANK(B2,$B$2:$B$13)`。隨機儲物櫃號碼：`INT(RAND()*$H$1)+1` 會得到 1 至 H1 的整數。',
    ],
    tasks: [
      {
        id: 'E2-L5-T1', cells: ['B2:B13'], focus: 'B2', points: 1,
        instruction: '在 `B2:B13` 每格使用 `RAND()` 產生一個隨機數。',
        markingPoints: [{ id: 'a', label: 'B2:B13 全部使用 RAND()', max: 1 }],
      },
      {
        id: 'E2-L5-T2', cells: ['C2:C13'], focus: 'C2', points: 2,
        instruction: '在 `C2` 使用 `RANK` 按 B 欄的隨機數排列抽查次序（1 至 12，不會重複），並將公式複製至 `C3:C13`。',
        markingPoints: [
          { id: 'a', label: 'C2 使用 RANK 引用 B2 及 B2:B13', max: 1 },
          { id: 'b', label: 'C2:C13 在任何隨機數下都是 1 至 12 各一次（範圍已固定）', max: 1 },
        ],
      },
      {
        id: 'E2-L5-T3', cells: ['H2'], focus: 'H2', points: 2,
        instruction: '在 `H2` 使用 `RAND` 及 `INT` 隨機抽出一個儲物櫃號碼：結果必須是 **1 至 `H1`** 的整數（每個號碼都有機會），並引用 `H1`。',
        markingPoints: [
          { id: 'a', label: '使用 RAND 及 INT，並引用 H1', max: 1 },
          { id: 'b', label: '結果永遠是 1 至 H1 的整數，而且 1 及 H1 都會出現', max: 1 },
        ],
      },
    ],
    referenceFormulas: {
      ...fillRef('B', 2, 13, () => '=RAND()'),
      ...fillRef('C', 2, 13, (r) => `=RANK(B${r},$B$2:$B$13)`),
      H2: '=INT(RAND()*$H$1)+1',
    },
  },
];

export const LEVEL_BY_NUM = Object.fromEntries(LEVELS.map((l) => [l.level, l]));
export const TASKS = LEVELS.flatMap((l) => l.tasks.map((t) => ({ ...t, level: l.level, sheet: l.sheet })));
export const TASK_BY_ID = Object.fromEntries(TASKS.map((t) => [t.id, t]));

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
