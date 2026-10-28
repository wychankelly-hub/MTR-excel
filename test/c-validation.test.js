// 驗收測試 C（15–28）：Formula Validation —— 證明 Validator 不只比對最後數字
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCompetitionDatasets } from '../server/episode1/generator.js';
import { gradeTask, checkIntegrity } from '../server/episode1/validators.js';
import { preflightTeam } from '../server/episode1/preflight.js';
import { correctInputs, equivalentInputs } from '../server/episode1/fixtures.js';
import { TASKS } from '../server/episode1/blueprint.js';

const ds = generateCompetitionDatasets('VALIDATION-SEED', ['team-1', 'team-2', 'team-3', 'team-4', 'team-5', 'team-6']);
const d = ds[0];
const fill = (col, r1, r2, f) => Object.fromEntries(Array.from({ length: r2 - r1 + 1 }, (_, i) => [`${col}${r1 + i}`, f(r1 + i)]));
const codes = (r) => r.errors.map((e) => e.code);

test('Preflight：六隊所有題目的正確／等價／常見錯誤／隱藏測試全部符合預期', () => {
  for (const x of ds) {
    const p = preflightTeam(x);
    assert.ok(p.pass, JSON.stringify(p.failed));
    assert.ok(p.total >= 70);
  }
});

test('15. L1 正確 =B2*C2*$H$1 並複製全列才取得全部 T1 分', () => {
  const r = gradeTask('L1-T1', fill('D', 2, 21, (n) => `=B${n}*C${n}*$H$1`), d);
  assert.equal(r.earned, 2);
  assert.equal(r.status, 'VERIFIED');
});

test('16. L1 =B2*C2*H1 未固定參照被識別為錯誤', () => {
  const r = gradeTask('L1-T1', fill('D', 2, 21, (n) => `=B${n}*C${n}*H${n - 1}`), d);
  assert.equal(r.earned, 0);
  assert.ok(codes(r).includes('ABS_REF_MISSING'));
  // H$1 混合參照：數值正確但未達「絕對參照」要求
  const r2 = gradeTask('L1-T1', fill('D', 2, 21, (n) => `=B${n}*C${n}*H$1`), d);
  assert.equal(r2.earned, 1);
  assert.ok(codes(r2).includes('ABS_REF_PARTIAL'));
});

test('17. L1 只修好 D2 但沒複製 D3:D21，不可拿完整分', () => {
  const inputs = { ...fill('D', 2, 21, (n) => `=B${n}*C${n}*H${n - 1}`), D2: '=B2*C2*$H$1' };
  const r = gradeTask('L1-T1', inputs, d);
  assert.equal(r.earned, 1);
  assert.ok(codes(r).includes('COPY_INCOMPLETE'));
});

test('18. L1 H3 輸入手動數值，即使相同也不可冒充 SUM 公式', () => {
  const r = gradeTask('L1-T3', { H3: d.ref[1].H3 }, d);
  assert.equal(r.earned, 0);
  assert.ok(codes(r).includes('FORMULA_REQUIRED'));
  const r2 = gradeTask('L1-T3', { H3: `=${d.ref[1].H3}` }, d); // 以 = 寫死數字
  assert.equal(r2.earned, 0);
});

test('19. L2 =MAX(B2:C13) 不可冒充最高 TotalFlow', () => {
  const r = gradeTask('L2-T2', { H2: '=MAX(B2:C13)' }, d);
  assert.equal(r.earned, 0);
  assert.ok(codes(r).includes('MAX_WRONG_RANGE'));
});

test('20. L2 COUNT、AVERAGE、MAX 必須在指定範圍正確執行', () => {
  assert.equal(gradeTask('L2-T2', { H2: '=MAX(D2:D13)' }, d).earned, 1);
  assert.equal(gradeTask('L2-T3', { H3: '=AVERAGE(D2:D13)' }, d).earned, 1);
  assert.equal(gradeTask('L2-T4', { H4: '=COUNT(D2:D13)' }, d).earned, 1);
  assert.equal(gradeTask('L2-T3', { H3: '=AVERAGE(D2:D12)' }, d).earned, 0);
  assert.equal(gradeTask('L2-T4', { H4: '=COUNTA(D2:D13)' }, d).earned, 0);
  assert.equal(gradeTask('L2-T4', { H4: '=COUNT(D2:D12)' }, d).earned, 0);
  assert.equal(gradeTask('L2-T2', { H2: `=${d.ref[2].H2}` }, d).earned, 0, '寫死最高值會被隱藏測試找出');
});

test('21. L3 AND/OR 互換導致錯誤得分，Age=60 邊界可被識別', () => {
  const swapped = gradeTask('L3-T1', fill('E', 2, 25, (n) => `=IF(OR(AND(B${n}>=$H$1,C${n}="YES"),D${n}=TRUE),1,0)`), d);
  assert.ok(swapped.earned < 3);
  assert.ok(codes(swapped).includes('AND_OR_SWAPPED'));
  const gt = gradeTask('L3-T1', fill('E', 2, 25, (n) => `=IF(AND(OR(B${n}>$H$1,C${n}="YES"),D${n}=TRUE),1,0)`), d);
  assert.ok(gt.earned < 3);
  assert.ok(codes(gt).includes('BOUNDARY_GT'));
});

test('22. L3 只檢查首列、不複製到 E25，扣相應評分點', () => {
  const r = gradeTask('L3-T1', { E2: '=IF(AND(OR(B2>=$H$1,C2="YES"),D2=TRUE),1,0)' }, d);
  assert.equal(r.earned, 2);
  assert.equal(r.markingPoints.find((m) => m.id === 'c').passed, false);
});

test('23. L4 COUNTIF 與 SUMIF 被區分；I4 漏 & 或用 > 不可通過', () => {
  assert.equal(gradeTask('L4-T1', { I2: '=COUNT(B2:B501)' }, d).earned, 0);
  assert.equal(gradeTask('L4-T2', { I3: '=COUNTIF(B2:B501,H2)' }, d).earned, 0);
  const noAmp = gradeTask('L4-T3', { I4: '=SUMIF(C2:C501,>=H1,C2:C501)' }, d);
  assert.equal(noAmp.earned, 0);
  assert.ok(codes(noAmp).includes('CRITERIA_SYNTAX'));
  const gt = gradeTask('L4-T3', { I4: '=SUMIF(C2:C501,">"&H1,C2:C501)' }, d);
  assert.ok(gt.earned < 3);
  assert.ok(codes(gt).includes('CRITERIA_GT'));
  const spaces = gradeTask('L4-T3', { I4: '=SUMIF(C2:C501," >= "&H1,C2:C501)' }, d);
  assert.equal(spaces.earned, 0);
});

test('24. L4 寫死 H1 的數值，即使本隊算中，隱藏測試必須找出', () => {
  const r = gradeTask('L4-T3', { I4: `=SUMIF(C2:C501,">=${d.levels[4].data.H1}",C2:C501)` }, d);
  assert.ok(r.earned < 3);
  assert.ok(codes(r).includes('CRITERIA_HARDCODED'));
  const r2 = gradeTask('L4-T1', { I2: `=COUNTIF(B2:B501,"${d.levels[4].data.H2}")` }, d);
  assert.ok(r2.earned < 2);
});

test('25. L5 硬編碼 LUNCH 不可拿 T2 的公式分', () => {
  for (const H2 of ['="LUNCH"', 'LUNCH', '="L"&"U"&"N"&"C"&"H"', '="LU"&C4&C5&C6']) {
    const r = gradeTask('L5-T2', { H2 }, d);
    assert.equal(r.markingPoints.find((m) => m.id === 'a').passed, false, H2);
    assert.ok(r.earned < 2);
  }
});

test('26. L5 正確 LEFT/MID/RIGHT + & 通過替換 Code 的隱藏測試', () => {
  assert.equal(gradeTask('L5-T1', correctInputs('L5-T1'), d).earned, 5);
  assert.equal(gradeTask('L5-T2', { H2: '=C2&C3&C4&C5&C6' }, d).earned, 2);
  // 直接輸入字母（本隊結果正確）必須失敗
  const hard = gradeTask('L5-T1', { C2: '="L"', C3: '="U"', C4: '="N"', C5: '="C"', C6: '="H"' }, d);
  assert.equal(hard.earned, 0);
});

test('27. 等價公式不因空格／大小寫而被錯判；指定函數仍須核實', () => {
  for (const t of TASKS) {
    const r = gradeTask(t.id, equivalentInputs(t.id), d);
    assert.equal(r.earned, r.max, `${t.id} ${JSON.stringify(r.errors)}`);
  }
  // 沒有用指定函數：L2 D2 用 + 取代 SUM
  const r = gradeTask('L2-T1', fill('D', 2, 13, (n) => `=B${n}+C${n}`), d);
  assert.ok(codes(r).includes('SUM_REQUIRED'));
  assert.ok(r.earned < 2);
});

test('28. 原始數據被改動時顯示完整性錯誤，而不是扣概念分', () => {
  const cells = {};
  for (const [a, v] of Object.entries(d.levels[1].data)) cells[a] = { input: v, value: v };
  assert.deepEqual(checkIntegrity(1, cells, d), []);
  cells.B2 = { input: 99, value: 99 };
  cells.H1 = { input: '=1', value: 1 };
  const changed = checkIntegrity(1, cells, d);
  assert.ok(changed.includes('B2') && changed.includes('H1'));
});

test('全形符號、分號等輸入錯誤會得到中文提示，不會令伺服器出錯', () => {
  const r = gradeTask('L1-T3', { H3: '=SUM（F2:F21）' }, d);
  assert.ok(codes(r).includes('NON_ASCII'));
  assert.match(r.errors[0].text, /半形/);
  const r2 = gradeTask('L1-T3', { H3: '=SUM(F2;F21)' }, d);
  assert.equal(r2.earned, 0);
});
