// 第二集 Preflight／測試用：每題的正確公式、等價公式及常見錯誤公式（以隊伍數據產生）。
// 只在伺服器端使用。Preflight 會對每一隊執行：正確公式必須全對；常見錯誤必須失分並出現指定錯誤代碼。
import { LEVEL_BY_NUM, TASK_BY_ID } from './blueprint.js';
import { expandRange } from '../engine/refs.js';

const fill = (col, r1, r2, f) => Object.fromEntries(Array.from({ length: r2 - r1 + 1 }, (_, i) => [`${col}${r1 + i}`, f(r1 + i)]));

export function correctInputs(taskId) {
  const t = TASK_BY_ID[taskId];
  const ref = LEVEL_BY_NUM[t.level].referenceFormulas;
  return Object.fromEntries(t.cells.flatMap(expandRange).map((a) => [a, ref[a]]));
}

/** 正確但寫法不同的等價公式（空格、大小寫、引用輔助欄、不同但合理的函數） */
export function equivalentInputs(taskId) {
  switch (taskId) {
    case 'E2-L1-T1': return fill('B', 2, 21, (r) => `=find( "@", a${r} )`);
    case 'E2-L1-T2': return fill('C', 2, 21, (r) => `=MID(A${r},B${r}+1,4)`);
    case 'E2-L1-T3': return fill('D', 2, 21, (r) => `=MID(A${r},FIND("#",A${r})+1,LEN(A${r}))`);
    case 'E2-L1-T4': return { H2: '=COUNTIF($D$2:$D$21,$H$1)' };
    case 'E2-L2-T1': return fill('B', 2, 16, (r) => `=xlookup(A${r}, $G$2:$G$9, $H$2:$H$9, "VISITOR")`);
    case 'E2-L2-T2': return fill('C', 2, 16, (r) => `=XLOOKUP($A${r},G$2:G$9,I$2:I$9,"NONE")`);
    case 'E2-L2-T3': return { H12: '=XLOOKUP(H11,$H$2:$H$9,$G$2:$G$9,"?")' };
    case 'E2-L3-T1': return fill('D', 2, 13, (r) => `=round(C${r}*B${r}, 1)`);
    case 'E2-L3-T2': return fill('E', 2, 13, (r) => `=INT(ROUND(B${r}*C${r},1)/$H$1)`);
    case 'E2-L3-T3': return { H3: '=ROUND( SUM(D2:D13) , 0 )' };
    case 'E2-L4-T1': return fill('E', 2, 9, (r) => `=SQRT(($H$1-C${r})^2 + ($H$2-D${r})^2)`);
    case 'E2-L4-T2': return fill('F', 2, 9, (r) => `=RANK.EQ(E${r},E$2:E$9,1)`);
    case 'E2-L4-T3': return { H4: '=XLOOKUP(MIN(E2:E9),E2:E9,A2:A9)' };
    case 'E2-L5-T1': return fill('B', 2, 13, () => '=rand()');
    case 'E2-L5-T2': return fill('C', 2, 13, (r) => `=RANK(B${r},$B$2:$B$13,1)`);
    case 'E2-L5-T3': return { H2: '=1+INT(H1*RAND())' };
    default: return correctInputs(taskId);
  }
}

/** 常見錯誤：{ name, inputs, maxEarned, codes } */
export function wrongCases(taskId, dataset) {
  const d1 = dataset.levels[1].data;
  const d3 = dataset.levels[3].data;
  const ref = dataset.ref;
  // 第一列的 @ 位置（寫死開始位置時用）
  const at2 = String(d1.A2).indexOf('@') + 1;
  switch (taskId) {
    case 'E2-L1-T1': return [
      { name: '找錯符號 #', inputs: fill('B', 2, 21, (r) => `=FIND("#",A${r})`), maxEarned: 0, codes: ['FIND_WRONG_CHAR'] },
      { name: '直接輸入位置', inputs: fill('B', 2, 21, (r) => ref[1][`B${r}`]), maxEarned: 0, codes: ['FORMULA_REQUIRED'] },
      { name: '只完成 B2', inputs: { B2: '=FIND("@",A2)' }, maxEarned: 1, codes: ['COPY_INCOMPLETE'] },
    ];
    case 'E2-L1-T2': return [
      { name: '開始位置寫死', inputs: fill('C', 2, 21, (r) => `=MID(A${r},${at2 + 1},4)`), maxEarned: 0, codes: ['MID_START_HARDCODED'] },
      { name: '漏了 +1（包括 @）', inputs: fill('C', 2, 21, (r) => `=MID(A${r},FIND("@",A${r}),4)`), maxEarned: 0, codes: ['MID_START_OFF_BY_ONE'] },
      { name: '不用 MID', inputs: fill('C', 2, 21, (r) => `=RIGHT(A${r},4)`), maxEarned: 0, codes: ['MID_REQUIRED'] },
    ];
    case 'E2-L1-T3': return [
      { name: '固定取 3 個字元', inputs: fill('D', 2, 21, (r) => `=RIGHT(A${r},3)`), maxEarned: 0, codes: ['FIND_REQUIRED', 'CODE_LENGTH_FIXED'] },
      { name: '只完成 D2', inputs: { D2: '=RIGHT(A2,LEN(A2)-FIND("#",A2))' }, maxEarned: 1, codes: ['COPY_INCOMPLETE'] },
    ];
    case 'E2-L1-T4': return [
      { name: '條件寫死號碼', inputs: { H2: `=COUNTIF(D2:D21,"${d1.H1}")` }, maxEarned: 0, codes: ['CRITERIA_NOT_H1'] },
      { name: '用 COUNT', inputs: { H2: '=COUNT(D2:D21)' }, maxEarned: 0, codes: ['COUNTIF_REQUIRED'] },
      { name: '直接輸入數目', inputs: { H2: ref[1].H2 }, maxEarned: 0, codes: ['FORMULA_REQUIRED'] },
    ];
    case 'E2-L2-T1': return [
      { name: '漏「找不到時的值」', inputs: fill('B', 2, 16, (r) => `=XLOOKUP(A${r},$G$2:$G$9,$H$2:$H$9)`), maxEarned: 1, codes: ['NOT_FOUND_MISSING'] },
      { name: '名冊範圍沒有固定', inputs: fill('B', 2, 16, (r) => `=XLOOKUP(A${r},G${r}:G${r + 7},H${r}:H${r + 7},"VISITOR")`), maxEarned: 1, codes: ['RANGE_NOT_ABSOLUTE'] },
      { name: '傳回錯欄（時段）', inputs: fill('B', 2, 16, (r) => `=XLOOKUP(A${r},$G$2:$G$9,$I$2:$I$9,"VISITOR")`), maxEarned: 0, codes: ['RETURN_RANGE_WRONG'] },
      { name: '找不到時文字錯', inputs: fill('B', 2, 16, (r) => `=XLOOKUP(A${r},$G$2:$G$9,$H$2:$H$9,"GUEST")`), maxEarned: 1, codes: ['NOT_FOUND_TEXT'] },
    ];
    case 'E2-L2-T2': return [
      { name: '漏「找不到時的值」', inputs: fill('C', 2, 16, (r) => `=XLOOKUP(A${r},$G$2:$G$9,$I$2:$I$9)`), maxEarned: 1, codes: ['NOT_FOUND_MISSING'] },
      { name: '用錯查找範圍', inputs: fill('C', 2, 16, (r) => `=XLOOKUP(A${r},$H$2:$H$9,$I$2:$I$9,"NONE")`), maxEarned: 0, codes: ['LOOKUP_RANGE_WRONG'] },
    ];
    case 'E2-L2-T3': return [
      { name: '沒有反向查找', inputs: { H12: '=XLOOKUP(H11,G2:G9,H2:H9)' }, maxEarned: 0, codes: ['REVERSE_LOOKUP'] },
      { name: '直接輸入號碼', inputs: { H12: ref[2].H12 }, maxEarned: 0, codes: ['HARDCODED_TEXT'] },
    ];
    case 'E2-L3-T1': return [
      { name: '四捨五入至整數', inputs: fill('D', 2, 13, (r) => `=ROUND(B${r}*C${r},0)`), maxEarned: 0, codes: ['ROUND_DIGITS'] },
      { name: '用 INT 代替 ROUND', inputs: fill('D', 2, 13, (r) => `=INT(B${r}*C${r}*10)/10`), maxEarned: 0, codes: ['ROUND_REQUIRED'] },
      { name: '只完成 D2', inputs: { D2: '=ROUND(B2*C2,1)' }, maxEarned: 1, codes: ['COPY_INCOMPLETE'] },
    ];
    case 'E2-L3-T2': return [
      { name: '用 ROUND 代替 INT', inputs: fill('E', 2, 13, (r) => `=ROUND(D${r}/$H$1,0)`), maxEarned: 0, codes: ['INT_REQUIRED'] },
      { name: '寫死每袋金額', inputs: fill('E', 2, 13, (r) => `=INT(D${r}/${d3.H1})`), maxEarned: 0, codes: ['BAG_HARDCODED'] },
      { name: 'H1 沒有固定', inputs: fill('E', 2, 13, (r) => `=INT(D${r}/H${r - 1})`), maxEarned: 0, codes: ['H1_NOT_FIXED'] },
    ];
    case 'E2-L3-T3': return [
      { name: '不用 ROUND', inputs: { H3: '=SUM(D2:D13)' }, maxEarned: 1, codes: ['ROUND_REQUIRED'] },
      { name: 'SUM 範圍漏最後一列', inputs: { H3: '=ROUND(SUM(D2:D12),0)' }, maxEarned: 0, codes: ['SUM_RANGE'] },
    ];
    case 'E2-L4-T1': return [
      { name: '括號位置錯', inputs: fill('E', 2, 9, (r) => `=SQRT(C${r}-$H$1)^2+(D${r}-$H$2)^2`), maxEarned: 0, codes: ['DIST_FORMULA'] },
      { name: '忘記開方', inputs: fill('E', 2, 9, (r) => `=(C${r}-$H$1)^2+(D${r}-$H$2)^2`), maxEarned: 0, codes: ['SQRT_REQUIRED'] },
      { name: '辦公室位置沒有固定', inputs: fill('E', 2, 9, (r) => `=SQRT((C${r}-H${r - 1})^2+(D${r}-H${r})^2)`), maxEarned: 1, codes: ['OFFICE_NOT_FIXED'] },
    ];
    case 'E2-L4-T2': return [
      { name: '排名方向相反', inputs: fill('F', 2, 9, (r) => `=RANK(E${r},$E$2:$E$9)`), maxEarned: 0, codes: ['RANK_ORDER'] },
      { name: '排名範圍沒有固定', inputs: fill('F', 2, 9, (r) => `=RANK(E${r},E${r}:E9,1)`), maxEarned: 1, codes: ['RANK_RANGE_NOT_FIXED'] },
      { name: '用 MIN 代替 RANK', inputs: fill('F', 2, 9, (r) => `=MIN(E${r})`), maxEarned: 0, codes: ['RANK_REQUIRED'] },
    ];
    case 'E2-L4-T3': return [
      { name: '直接輸入姓名', inputs: { H4: ref[4].H4 }, maxEarned: 0, codes: ['HARDCODED_TEXT'] },
      { name: '傳回錯欄', inputs: { H4: '=XLOOKUP(1,F2:F9,B2:B9)' }, maxEarned: 0, codes: ['VALUE_WRONG'] },
    ];
    case 'E2-L5-T1': return [
      { name: '直接輸入小數', inputs: fill('B', 2, 13, (r) => (r * 7 % 13) / 13), maxEarned: 0, codes: ['RAND_REQUIRED'] },
      { name: '只有 B2', inputs: { B2: '=RAND()' }, maxEarned: 0, codes: ['RAND_REQUIRED'] },
    ];
    case 'E2-L5-T2': return [
      { name: '排名範圍沒有固定', inputs: fill('C', 2, 13, (r) => `=RANK(B${r},B${r}:B13)`), maxEarned: 1, codes: ['RANK_RANGE_NOT_FIXED'] },
      { name: '直接輸入 1 至 12', inputs: fill('C', 2, 13, (r) => r - 1), maxEarned: 0, codes: ['FORMULA_REQUIRED'] },
    ];
    case 'E2-L5-T3': return [
      { name: '漏了 +1', inputs: { H2: '=INT(RAND()*$H$1)' }, maxEarned: 1, codes: ['RANDOM_OFF_BY_ONE'] },
      { name: '寫死儲物櫃數目', inputs: { H2: '=INT(RAND()*12)+1' }, maxEarned: 0, codes: ['H1_REQUIRED'] },
      { name: '用 ROUND 代替 INT', inputs: { H2: '=ROUND(RAND()*$H$1,0)' }, maxEarned: 0, codes: ['INT_REQUIRED'] },
    ];
    default: return [];
  }
}
