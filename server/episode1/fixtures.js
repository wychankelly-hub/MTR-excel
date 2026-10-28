// Preflight / 測試用：每題的正確公式及常見錯誤公式（以隊伍數據產生）。
// 只在伺服器端使用。Preflight 會對每一隊執行：正確公式必須全對；常見錯誤必須失分並出現指定錯誤代碼。
import { LEVEL_BY_NUM, TASK_BY_ID } from './blueprint.js';
import { expandRange } from '../engine/refs.js';

const fill = (col, r1, r2, f) => Object.fromEntries(Array.from({ length: r2 - r1 + 1 }, (_, i) => [`${col}${r1 + i}`, f(r1 + i)]));

export function correctInputs(taskId) {
  const t = TASK_BY_ID[taskId];
  const ref = LEVEL_BY_NUM[t.level].referenceFormulas;
  return Object.fromEntries(t.cells.flatMap(expandRange).map((a) => [a, ref[a]]));
}

/** 正確但寫法不同的等價公式（空格、大小寫、括號、不同但合理的函數） */
export function equivalentInputs(taskId) {
  switch (taskId) {
    case 'L1-T1': return fill('D', 2, 21, (r) => `= c${r} * b${r} * $h$1`);
    case 'L1-T2': return fill('F', 2, 21, (r) => `=(E${r}-D${r})`);
    case 'L1-T3': return { H3: '=sum( F2:F21 )' };
    case 'L2-T1': return fill('D', 2, 13, (r) => `=SUM(B${r},C${r})`);
    case 'L2-T2': return { H2: '=max(D2:D13)' };
    case 'L2-T3': return { H3: '=SUM(D2:D13)/COUNT(D2:D13)' };
    case 'L2-T4': return { H4: '=count(D2:D13)' };
    case 'L3-T1': return fill('E', 2, 25, (r) => `=IF(AND(D${r},OR(B${r}>=$H$1,C${r}="yes")),1,0)`);
    case 'L3-T2': return { H2: '=COUNTIF(E2:E25,1)' };
    case 'L4-T1': return { I2: '=countif(B2:B501, H2)' };
    case 'L4-T2': return { I3: '=SUMIF(B2:B501,$H$2,C2:C501)' };
    case 'L4-T3': return { I4: '=SUMIF(C2:C501,">="&$H$1)' };
    case 'L5-T1': return { C2: '=LEFT(A2)', C3: '=MID(A3,B3,1)', C4: '=RIGHT(A4)', C5: '=mid(A5, B5, 1)', C6: '=RIGHT(A6,1)' };
    case 'L5-T2': return { H2: '=C2 & C3 & C4 & C5 & C6' };
    default: return correctInputs(taskId);
  }
}

/** 常見錯誤：{ name, inputs, maxEarned, codes } */
export function wrongCases(taskId, dataset) {
  const d1 = dataset.levels[1].data;
  const d4 = dataset.levels[4].data;
  const ref = dataset.ref;
  switch (taskId) {
    case 'L1-T1': return [
      { name: '漏絕對參照（火箭仔原版）', inputs: fill('D', 2, 21, (r) => `=B${r}*C${r}*H${r - 1}`), maxEarned: 0, codes: ['ABS_REF_MISSING'] },
      { name: '只用 H$1 混合參照', inputs: fill('D', 2, 21, (r) => `=B${r}*C${r}*H$1`), maxEarned: 1, codes: ['ABS_REF_PARTIAL'] },
      { name: '只修正 D2 未複製', inputs: { ...fill('D', 2, 21, (r) => `=B${r}*C${r}*H${r - 1}`), D2: '=B2*C2*$H$1' }, maxEarned: 1, codes: ['COPY_INCOMPLETE'] },
      { name: '乘法寫成加法', inputs: fill('D', 2, 21, (r) => `=B${r}+C${r}*$H$1`), maxEarned: 0, codes: ['FARE_OPERATOR'] },
      { name: '寫死系數', inputs: fill('D', 2, 21, (r) => `=B${r}*C${r}*${d1.H1}`), maxEarned: 0, codes: ['HARDCODED_MULTIPLIER'] },
      { name: '直接輸入數值', inputs: fill('D', 2, 21, (r) => ref[1][`D${r}`]), maxEarned: 0, codes: ['FORMULA_REQUIRED'] },
    ];
    case 'L1-T2': return [
      { name: '扣款方向反轉', inputs: fill('F', 2, 21, (r) => `=E${r}+D${r}`), maxEarned: 0, codes: ['BALANCE_DIRECTION'] },
      { name: '只完成 F2', inputs: { F2: '=E2-D2' }, maxEarned: 1, codes: ['COPY_INCOMPLETE'] },
    ];
    case 'L1-T3': return [
      { name: 'H3 直接輸入數字', inputs: { H3: ref[1].H3 }, maxEarned: 0, codes: ['FORMULA_REQUIRED'] },
      { name: '不用 SUM 逐格相加', inputs: { H3: '=' + Array.from({ length: 20 }, (_, i) => `F${i + 2}`).join('+') }, maxEarned: 1, codes: ['SUM_REQUIRED'] },
      { name: 'SUM 範圍漏最後一列', inputs: { H3: '=SUM(F2:F20)' }, maxEarned: 0, codes: ['SUM_RANGE'] },
    ];
    case 'L1-B1': return [
      { name: '用 MAX 代替 MIN', inputs: { H5: '=MAX(F2:F21)' }, maxEarned: 0, codes: ['MIN_REQUIRED'] },
    ];
    case 'L2-T1': return [
      { name: '只用 B 欄', inputs: fill('D', 2, 13, (r) => `=SUM(B${r})`), maxEarned: 0, codes: ['FLOW_ONE_COLUMN'] },
      { name: '不用 SUM', inputs: fill('D', 2, 13, (r) => `=B${r}+C${r}`), maxEarned: 1, codes: ['SUM_REQUIRED'] },
    ];
    case 'L2-T2': return [
      { name: 'MAX(B2:C13)', inputs: { H2: '=MAX(B2:C13)' }, maxEarned: 0, codes: ['MAX_WRONG_RANGE'] },
      { name: '直接輸入數字', inputs: { H2: ref[2].H2 }, maxEarned: 0, codes: ['FORMULA_REQUIRED'] },
    ];
    case 'L2-T3': return [
      { name: 'AVERAGE(B2:C13)', inputs: { H3: '=AVERAGE(B2:C13)' }, maxEarned: 0, codes: ['AVERAGE_WRONG_RANGE'] },
    ];
    case 'L2-T4': return [
      { name: '用 COUNTA', inputs: { H4: '=COUNTA(D2:D13)' }, maxEarned: 0, codes: ['COUNT_REQUIRED'] },
      { name: '直接輸入 12', inputs: { H4: 12 }, maxEarned: 0, codes: ['FORMULA_REQUIRED'] },
    ];
    case 'L3-T1': return [
      { name: 'AND/OR 對調', inputs: fill('E', 2, 25, (r) => `=IF(OR(AND(B${r}>=$H$1,C${r}="YES"),D${r}=TRUE),1,0)`), maxEarned: 1, codes: ['AND_OR_SWAPPED'] },
      { name: '用 > 代替 >=', inputs: fill('E', 2, 25, (r) => `=IF(AND(OR(B${r}>$H$1,C${r}="YES"),D${r}=TRUE),1,0)`), maxEarned: 1, codes: ['BOUNDARY_GT'] },
      { name: '忽略 ValidCard', inputs: fill('E', 2, 25, (r) => `=IF(OR(B${r}>=$H$1,C${r}="YES"),1,0)`), maxEarned: 1, codes: ['VALIDCARD_IGNORED'] },
      { name: '輸出 YES/NO', inputs: fill('E', 2, 25, (r) => `=IF(AND(OR(B${r}>=$H$1,C${r}="YES"),D${r}=TRUE),"YES","NO")`), maxEarned: 1, codes: ['OUTPUT_NOT_1_0'] },
      { name: '忘記固定 $H$1', inputs: fill('E', 2, 25, (r) => `=IF(AND(OR(B${r}>=H${r - 1},C${r}="YES"),D${r}=TRUE),1,0)`), maxEarned: 2, codes: ['H1_NOT_ABSOLUTE'] },
      { name: '只完成 E2', inputs: { E2: '=IF(AND(OR(B2>=$H$1,C2="YES"),D2=TRUE),1,0)' }, maxEarned: 2, codes: ['COPY_INCOMPLETE'] },
      { name: '寫死 60', inputs: fill('E', 2, 25, (r) => `=IF(AND(OR(B${r}>=60,C${r}="YES"),D${r}=TRUE),1,0)`), maxEarned: 1, codes: ['H1_HARDCODED'] },
    ];
    case 'L3-T2': return [
      { name: '直接輸入人數', inputs: { H2: ref[3].H2 }, maxEarned: 0, codes: ['FORMULA_REQUIRED'] },
    ];
    case 'L4-T1': return [
      { name: '用 COUNT 代替 COUNTIF', inputs: { I2: '=COUNT(B2:B501)' }, maxEarned: 0, codes: ['COUNTIF_REQUIRED'] },
      { name: '條件寫死類別', inputs: { I2: `=COUNTIF(B2:B501,"${d4.H2}")` }, maxEarned: 1, codes: ['CRITERIA_NOT_H2'] },
    ];
    case 'L4-T2': return [
      { name: '漏總和範圍', inputs: { I3: '=SUMIF(B2:B501,H2)' }, maxEarned: 1, codes: ['SUM_RANGE_WRONG'] },
      { name: '用 COUNTIF', inputs: { I3: '=COUNTIF(B2:B501,H2)' }, maxEarned: 0, codes: ['SUMIF_REQUIRED'] },
    ];
    case 'L4-T3': return [
      { name: '缺引號及 &', inputs: { I4: '=SUMIF(C2:C501,>=H1,C2:C501)' }, maxEarned: 0, codes: ['CRITERIA_SYNTAX'] },
      { name: '用 > 代替 >=', inputs: { I4: '=SUMIF(C2:C501,">"&H1,C2:C501)' }, maxEarned: 1, codes: ['CRITERIA_GT'] },
      { name: '寫死門檻', inputs: { I4: `=SUMIF(C2:C501,">=${d4.H1}",C2:C501)` }, maxEarned: 1, codes: ['CRITERIA_HARDCODED'] },
      { name: '條件多餘空格', inputs: { I4: '=SUMIF(C2:C501," >= "&H1,C2:C501)' }, maxEarned: 0, codes: ['CRITERIA_SPACES'] },
    ];
    case 'L5-T1': return [
      { name: '直接輸入字母', inputs: { C2: 'L', C3: 'U', C4: 'N', C5: 'C', C6: 'H' }, maxEarned: 0, codes: ['HARDCODED_LETTER'] },
      { name: 'MID 位置由 0 起計', inputs: { ...correctInputs('L5-T1'), C3: '=MID(A3,B3-1,1)', C5: '=MID(A5,B5-1,1)' }, maxEarned: 3, codes: ['MID_POSITION'] },
      { name: 'MID 漏第三個參數', inputs: { ...correctInputs('L5-T1'), C3: '=MID(A3,B3)' }, maxEarned: 4, codes: ['MID_ARGS'] },
      { name: '用錯文字函數', inputs: { ...correctInputs('L5-T1'), C4: '=LEFT(A4,1)' }, maxEarned: 4, codes: ['TEXT_FUNC_WRONG'] },
    ];
    case 'L5-T2': return [
      { name: '硬編碼 LUNCH', inputs: { H2: '="LUNCH"' }, maxEarned: 0, codes: ['HARDCODED_WORD'] },
      { name: '直接輸入 LUNCH', inputs: { H2: 'LUNCH' }, maxEarned: 0, codes: ['HARDCODED_WORD'] },
      { name: '用 + 連接', inputs: { H2: '=C2+C3+C4+C5+C6' }, maxEarned: 0, codes: ['AMP_REQUIRED'] },
      { name: '部分寫死', inputs: { H2: '="LU"&C4&C5&C6' }, maxEarned: 0, codes: ['HARDCODED_WORD'] },
    ];
    default: return [];
  }
}
