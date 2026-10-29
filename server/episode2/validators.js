// 第二集 Formula Validation：FIND、XLOOKUP、ROUND、INT、SQRT、RANK、RAND。
// 與第一集相同的原則（見 episodes/grading-kit.js）；RAND 題目以多組可重現隨機數作統計檢查。
import {
  GradeContext, makeGrader, makeIntegrityCheck, analyzeInput, findFuncs, collectCellRefs, collectLiterals, walk,
  refsCell, hasBinOp, rangeIs, rangeRowsAbsolute, rowsOf, unwrap,
} from '../episodes/grading-kit.js';
import { isError, valuesEqual } from '../engine/values.js';
import { LEVEL_BY_NUM, TASK_BY_ID, VALIDATOR_VERSION } from './blueprint.js';
import { buildLevelWorkbook } from './generator.js';
import { renderError } from './feedback.js';

void GradeContext;

/** 參數是否為指定文字（例如 "@"） */
function argIsText(g, node, text) {
  const n = unwrap(node);
  if (!n) return false;
  if (n.type === 'str') return n.value === text;
  try { return g.wb('team').evalNode(n, g.lv.sheet) === text; } catch { return false; }
}

const literalNumbers = (ast) => collectLiterals(ast).filter((l) => l.type === 'num').map((l) => l.value);

function rowAbsRefs(ast, col, row) {
  return collectCellRefs(ast).filter((r) => r.col === col && r.row === row);
}

/** 某個儲存格的公式在第一列之外是否有參照跟着移動（例如 H1 變成 H2） */
function movedRef(g, cells, col, row) {
  return cells.slice(1).some((a) => {
    const info = g.info(a);
    return info.kind === 'formula' && collectCellRefs(info.ast).some((r) => r.col === col && r.row !== row && r.row <= 20 && r.col === col);
  });
}

const VALIDATORS = {
  // ---------------------------------------------------------------- L1 門禁紀錄
  'E2-L1-T1'(g) {
    let a = false;
    if (g.checkBasic('B2')) {
      const { ast } = g.info('B2');
      const f = findFuncs(ast, 'FIND')[0];
      if (!f) g.err('FIND_REQUIRED', 'B2');
      else if (!argIsText(g, f.args[0], '@')) g.err('FIND_WRONG_CHAR', 'B2', '@');
      const ok = g.ok('team', 'B2') && g.ok('hidden', 'B2');
      if (f && !ok && argIsText(g, f.args[0], '@')) g.explainValue('B2');
      a = !!f && ok && refsCell(ast, 1, 2);
    }
    g.award('a', a);
    g.award('b', g.checkRows(rowsOf('B', 3, 21)));
  },

  'E2-L1-T2'(g) {
    let a = false;
    if (g.checkBasic('C2')) {
      const { ast } = g.info('C2');
      const f = findFuncs(ast, 'MID')[0];
      if (!f) g.err('MID_REQUIRED', 'C2');
      else {
        const start = f.args[1];
        const fromAt = start && (findFuncs(start, 'FIND').length || refsCell(start, 2, 2));
        if (!fromAt) g.err('MID_START_HARDCODED', 'C2');
        const ok = g.ok('team', 'C2') && g.ok('hidden', 'C2');
        if (!ok && fromAt) {
          const v = g.val('team', 'C2');
          if (typeof v === 'string' && v.startsWith('@')) g.err('MID_START_OFF_BY_ONE', 'C2');
          else g.explainValue('C2');
        }
        a = !!fromAt && ok;
      }
    }
    g.award('a', a);
    const rows = rowsOf('C', 2, 21);
    const b = rows.every((x) => g.good(x));
    if (!b && a) g.checkRows(rows.slice(1));
    g.award('b', b);
  },

  'E2-L1-T3'(g) {
    let a = false;
    if (g.checkBasic('D2')) {
      const { ast } = g.info('D2');
      const finds = findFuncs(ast, 'FIND').filter((f) => argIsText(g, f.args[0], '#'));
      if (!finds.length) g.err('FIND_REQUIRED', 'D2', '#');
      const ok = g.ok('team', 'D2') && g.ok('hidden', 'D2');
      const fixedLen = findFuncs(ast, 'RIGHT').some((f) => f.args[1] && unwrap(f.args[1])?.type === 'num')
        || findFuncs(ast, 'MID').some((f) => f.args[2] && unwrap(f.args[2])?.type === 'num' && unwrap(f.args[2]).value < 6);
      // 第 2 列的號碼剛好是固定長度時亦要指出（其他列或隱藏測試會出錯）
      if (fixedLen && !rowsOf('D', 2, 21).every((x) => g.good(x))) g.err('CODE_LENGTH_FIXED', 'D2');
      else if (!ok && finds.length) g.explainValue('D2');
      a = finds.length > 0 && ok;
    }
    g.award('a', a);
    const rows = rowsOf('D', 3, 21);
    if (g.errors.some((e) => e.code === 'CODE_LENGTH_FIXED')) g.award('b', rows.every((x) => g.good(x)));
    else g.award('b', g.checkRows(rows));
  },

  'E2-L1-T4'(g) {
    let a = false;
    if (g.checkBasic('H2')) {
      const { ast } = g.info('H2');
      const f = findFuncs(ast, 'COUNTIF')[0];
      if (!f) g.err('COUNTIF_REQUIRED', 'H2');
      else {
        const rangeOK = rangeIs(f.args[0], 4, 2, 21);
        const critH1 = f.args[1] && refsCell(f.args[1], 8, 1);
        if (!rangeOK) g.err('RANGE_WRONG', 'H2');
        if (!critH1) g.err('CRITERIA_NOT_H1', 'H2');
        const ok = g.ok('team', 'H2') && g.ok('hidden', 'H2');
        if (!ok && rangeOK && critH1) g.explainValue('H2');
        a = rangeOK && !!critH1 && ok;
      }
    }
    g.award('a', a);
  },

  // ---------------------------------------------------------------- L2 員工名冊
  'E2-L2-T1'(g) { lookupTask(g, 'B', 8, 'VISITOR'); },
  'E2-L2-T2'(g) { lookupTask(g, 'C', 9, 'NONE'); },

  'E2-L2-T3'(g) {
    let a = false;
    const info = g.info('H12');
    if (info.kind === 'constant' && typeof info.value === 'string') g.err('HARDCODED_TEXT', 'H12');
    else if (g.checkBasic('H12')) {
      const { ast } = info;
      const f = findFuncs(ast, 'XLOOKUP')[0];
      if (!f) g.err('XLOOKUP_REQUIRED', 'H12');
      else {
        const lookOK = rangeIs(f.args[1], 8, 2, 9);
        const retOK = rangeIs(f.args[2], 7, 2, 9);
        if (!lookOK) g.err('REVERSE_LOOKUP', 'H12');
        else if (!retOK) g.err('RETURN_RANGE_WRONG', 'H12', 'Code（G 欄）');
        if (!refsCell(f.args[0], 8, 11)) g.err('LOOKUP_VALUE_WRONG', 'H12', 'H11');
        const ok = g.ok('team', 'H12') && g.ok('hidden', 'H12');
        if (!ok && lookOK && retOK) g.explainValue('H12');
        a = lookOK && retOK && ok;
      }
    }
    g.award('a', a);
  },

  // ---------------------------------------------------------------- L3 現金箱對數
  'E2-L3-T1'(g) {
    let a = false;
    let digits = null;
    if (g.checkBasic('D2')) {
      const { ast, fns } = g.info('D2');
      const f = findFuncs(ast, 'ROUND')[0];
      if (!f) g.err('ROUND_REQUIRED', 'D2', [...fns].filter((x) => /ROUND|INT/.test(x)).join('、') || '（沒有四捨五入）');
      else {
        digits = f.args[1] ? g.wb('team').evalNode(unwrap(f.args[1]), g.lv.sheet) : 0;
        if (digits !== 1) g.err('ROUND_DIGITS', 'D2', String(digits));
      }
      const ok = g.ok('team', 'D2') && g.ok('hidden', 'D2');
      if (!ok && f && digits === 1) g.explainValue('D2');
      // 金額剛好是整數時 ROUND(…,0) 亦會「看似正確」，所以小數位數必須是 1
      a = !!f && digits === 1 && ok;
    }
    g.award('a', a);
    g.award('b', g.checkRows(rowsOf('D', 3, 13)));
  },

  'E2-L3-T2'(g) {
    let a = false;
    const rows = rowsOf('E', 2, 13);
    if (g.checkBasic('E2')) {
      const { ast, fns } = g.info('E2');
      const h1 = rowAbsRefs(ast, 8, 1);
      const fixed = h1.some((r) => r.rowAbs);
      const bagValue = g.levelData('team').data.H1;
      if (!fns.has('INT')) g.err('INT_REQUIRED', 'E2');
      if (!h1.length && literalNumbers(ast).includes(bagValue)) g.err('BAG_HARDCODED', 'E2');
      else if (h1.length && !fixed) g.err('H1_NOT_FIXED', 'E2');
      const ok = g.ok('team', 'E2') && g.ok('hidden', 'E2');
      if (!ok && fns.has('INT') && h1.length) g.explainValue('E2');
      a = fns.has('INT') && fixed && ok;
    }
    g.award('a', a);
    const b = rows.every((x) => g.good(x));
    if (!b && !g.errors.some((e) => ['H1_NOT_FIXED', 'BAG_HARDCODED', 'INT_REQUIRED'].includes(e.code))) {
      if (movedRef(g, rows, 8, 1)) g.err('H1_NOT_FIXED', 'E2');
      else g.checkRows(rows.slice(1));
    }
    g.award('b', b);
  },

  'E2-L3-T3'(g) {
    let a = false; let b = false;
    if (g.checkBasic('H3')) {
      const { ast } = g.info('H3');
      const round = findFuncs(ast, 'ROUND')[0];
      const sum = findFuncs(ast, 'SUM')[0];
      if (!round) g.err('ROUND_REQUIRED', 'H3', '整數');
      if (!sum) g.err('SUM_REQUIRED', 'H3');
      else if (!sum.args.some((x) => rangeIs(x, 4, 2, 13))) g.err('SUM_RANGE', 'H3');
      a = !!round && !!sum && sum.args.some((x) => rangeIs(x, 4, 2, 13));
      b = g.ok('team', 'H3') && g.ok('hidden', 'H3');
      if (!b && a) g.explainValue('H3');
    }
    g.award('a', a);
    g.award('b', b);
  },

  // ---------------------------------------------------------------- L4 不在場證明
  'E2-L4-T1'(g) {
    let a = false;
    const rows = rowsOf('E', 2, 9);
    if (g.checkBasic('E2')) {
      const { ast, fns } = g.info('E2');
      if (!fns.has('SQRT')) g.err('SQRT_REQUIRED', 'E2');
      const ok = g.ok('team', 'E2') && g.ok('hidden', 'E2');
      if (!ok && fns.has('SQRT')) {
        const v = g.val('team', 'E2');
        // SQRT 只包住了一部分時，負數開方會出現 #NUM!
        if (isError(v) && v.code !== '#NUM!') g.explainValue('E2');
        else g.err('DIST_FORMULA', 'E2');
      }
      a = fns.has('SQRT') && ok;
      const officeRefs = collectCellRefs(ast).filter((r) => r.col === 8 && (r.row === 1 || r.row === 2));
      if (a && officeRefs.some((r) => !r.rowAbs)) g.err('OFFICE_NOT_FIXED', 'E2');
    }
    g.award('a', a);
    const b = rows.every((x) => g.good(x));
    if (!b && a && !g.errors.some((e) => e.code === 'OFFICE_NOT_FIXED')) g.checkRows(rows.slice(1));
    g.award('b', b);
  },

  'E2-L4-T2'(g) {
    let a = false;
    const rows = rowsOf('F', 2, 9);
    if (g.checkBasic('F2')) {
      const { ast } = g.info('F2');
      const f = findFuncs(ast, 'RANK')[0] || findFuncs(ast, 'RANK.EQ')[0];
      if (!f) g.err('RANK_REQUIRED', 'F2');
      else {
        const asc = f.args[2] && g.wb('team').evalNode(unwrap(f.args[2]), g.lv.sheet);
        const ok = g.ok('team', 'F2') && g.ok('hidden', 'F2');
        if (!asc || asc === 0) g.err('RANK_ORDER', 'F2');
        else if (!ok) g.explainValue('F2');
        a = !!asc && ok && refsCell(f.args[0], 5, 2);
        if (a && !rangeRowsAbsolute(f.args[1])) g.err('RANK_RANGE_NOT_FIXED', 'F2');
      }
    }
    g.award('a', a);
    const b = rows.every((x) => g.good(x));
    if (!b && a && !g.errors.some((e) => e.code === 'RANK_RANGE_NOT_FIXED')) g.checkRows(rows.slice(1));
    g.award('b', b);
  },

  'E2-L4-T3'(g) {
    let a = false;
    const info = g.info('H4');
    if (info.kind === 'constant' && typeof info.value === 'string') g.err('HARDCODED_TEXT', 'H4');
    else if (g.checkBasic('H4')) {
      const { ast, fns } = info;
      if (!fns.has('XLOOKUP')) g.err('XLOOKUP_REQUIRED', 'H4');
      if (!collectCellRefs(ast).length && !hasRange(ast)) g.err('HARDCODED_TEXT', 'H4');
      const ok = g.ok('team', 'H4') && g.ok('hidden', 'H4');
      if (!ok && fns.has('XLOOKUP')) g.explainValue('H4');
      a = fns.has('XLOOKUP') && ok;
    }
    g.award('a', a);
  },

  // ---------------------------------------------------------------- L5 隨機抽查（統計檢查）
  'E2-L5-T1'(g) {
    const cells = rowsOf('B', 2, 13);
    const bad = cells.filter((a) => {
      const info = g.info(a);
      return info.kind !== 'formula' || !info.fns.has('RAND') || findFuncs(info.ast, 'RAND').some((f) => f.args.length);
    });
    if (bad.length) g.err('RAND_REQUIRED', bad.slice(0, 6).join('、') + (bad.length > 6 ? ` 等 ${bad.length} 格` : ''));
    let a = !bad.length;
    if (a) {
      const runs = g.randomRuns('team', 30, (wb) => cells.map((c) => wb.getValue(g.lv.sheet, c)));
      const inRange = runs.every((vals) => vals.every((v) => typeof v === 'number' && v >= 0 && v < 1));
      const varies = new Set(runs.map((v) => v[0])).size > 20;
      if (!inRange || !varies) { g.err('RAND_RANGE', 'B2'); a = false; }
    }
    g.award('a', a);
  },

  'E2-L5-T2'(g) {
    let a = false;
    if (g.checkBasic('C2')) {
      const { ast } = g.info('C2');
      const f = findFuncs(ast, 'RANK')[0] || findFuncs(ast, 'RANK.EQ')[0];
      if (!f) g.err('RANK_REQUIRED', 'C2');
      else {
        a = refsCell(f.args[0], 2, 2) && rangeIs(f.args[1], 2, 2, 13);
        if (!a) g.err('RANK_REFS', 'C2');
      }
    }
    g.award('a', a);
    // b：在任何隨機數下，C2:C13 都是 1 至 12 各一次，並與 B 欄的大小次序一致
    const rows = rowsOf('C', 2, 13);
    const allFormula = rows.every((x) => g.info(x).kind === 'formula');
    let b = false;
    if (allFormula) {
      const runs = g.randomRuns('team', 30, (wb) => ({
        b: rowsOf('B', 2, 13).map((x) => wb.getValue(g.lv.sheet, x)),
        c: rows.map((x) => wb.getValue(g.lv.sheet, x)),
      }));
      b = runs.every(({ b: bv, c }) => {
        if (c.some((v) => typeof v !== 'number')) return false;
        if ([...c].sort((x, y) => x - y).join() !== '1,2,3,4,5,6,7,8,9,10,11,12') return false;
        const desc = bv.map((x) => 1 + bv.filter((y) => y > x).length);
        const asc = bv.map((x) => 1 + bv.filter((y) => y < x).length);
        return c.every((v, i) => v === desc[i]) || c.every((v, i) => v === asc[i]);
      });
    }
    if (!b && a) {
      const f = findFuncs(g.info('C2').ast, 'RANK')[0] || findFuncs(g.info('C2').ast, 'RANK.EQ')[0];
      if (f && !rangeRowsAbsolute(f.args[1])) g.err('RANK_RANGE_NOT_FIXED', 'C2');
      else g.err('COPY_INCOMPLETE', 'C2:C13', '部分儲存格');
    } else if (!b && !allFormula) g.err('COPY_INCOMPLETE', 'C2:C13', rows.filter((x) => g.info(x).kind !== 'formula').slice(0, 6).join('、'));
    g.award('b', b);
  },

  'E2-L5-T3'(g) {
    let a = false; let b = false;
    if (g.checkBasic('H2')) {
      const { ast, fns } = g.info('H2');
      if (!fns.has('RAND')) g.err('RAND_REQUIRED', 'H2');
      if (!fns.has('INT')) g.err('INT_REQUIRED', 'H2');
      const h1 = refsCell(ast, 8, 1);
      if (!h1) g.err('H1_REQUIRED', 'H2');
      a = fns.has('RAND') && fns.has('INT') && h1;
      const check = (kind) => {
        const n = g.levelData(kind).data.H1;
        const vals = g.randomRuns(kind, 400, (wb) => wb.getValue(g.lv.sheet, 'H2'));
        if (vals.some((v) => typeof v !== 'number' || !Number.isInteger(v))) return 'NOT_INT';
        const mn = Math.min(...vals); const mx = Math.max(...vals);
        if (mn < 1 || mx > n || mn !== 1 || mx !== n) return mn === 0 || mx === n + 1 || mx === n - 1 ? 'OFF_BY_ONE' : 'RANGE';
        return null;
      };
      const t = check('team');
      const hdn = t ? null : check('hidden');
      if (t === 'OFF_BY_ONE' || hdn === 'OFF_BY_ONE') g.err('RANDOM_OFF_BY_ONE', 'H2');
      else if (t === 'NOT_INT' || hdn === 'NOT_INT') g.err('INT_REQUIRED', 'H2');
      else if (t || hdn) g.err(h1 ? 'RANDOM_RANGE' : 'H1_REQUIRED', 'H2');
      b = !t && !hdn;
    }
    g.award('a', a);
    g.award('b', b);
  },
};

function hasRange(ast) {
  let hit = false;
  walk(ast, (n) => { if (n.type === 'range' || n.type === 'colrange') hit = true; });
  return hit;
}

/** L2：XLOOKUP 查名冊（姓名或時段），找不到時顯示指定文字 */
function lookupTask(g, col, retCol, notFound) {
  const cell = `${col}2`;
  const rows = rowsOf(col, 2, 16);
  let a = false;
  let f = null;
  if (g.checkBasic(cell)) {
    const { ast } = g.info(cell);
    f = findFuncs(ast, 'XLOOKUP')[0];
    if (!f) g.err('XLOOKUP_REQUIRED', cell);
    else {
      const lookOK = rangeIs(f.args[1], 7, 2, 9);
      const retOK = rangeIs(f.args[2], retCol, 2, 9);
      if (!refsCell(f.args[0], 1, 2)) g.err('LOOKUP_VALUE_WRONG', cell, 'A2');
      if (!lookOK) g.err('LOOKUP_RANGE_WRONG', cell);
      if (!retOK) g.err('RETURN_RANGE_WRONG', cell, retCol === 8 ? 'StaffName（H 欄）' : 'ShiftTime（I 欄）');
      const ok = g.ok('team', cell) && g.ok('hidden', cell);
      if (!ok && lookOK && retOK) g.explainValue(cell);
      a = lookOK && retOK && ok;
    }
  }
  g.award('a', a);
  const b = rows.every((x) => g.good(x));
  if (!b && f) {
    if (f.args.length < 4) g.err('NOT_FOUND_MISSING', cell, notFound);
    else if (!argIsText(g, f.args[3], notFound)) g.err('NOT_FOUND_TEXT', cell, notFound);
    if (!rangeRowsAbsolute(f.args[1]) || !rangeRowsAbsolute(f.args[2])) g.err('RANGE_NOT_ABSOLUTE', cell);
    if (!g.errors.some((e) => ['NOT_FOUND_MISSING', 'NOT_FOUND_TEXT', 'RANGE_NOT_ABSOLUTE'].includes(e.code))) g.checkRows(rows.slice(1));
  }
  g.award('b', b);
}

export const gradeTask = makeGrader({ validators: VALIDATORS, taskById: TASK_BY_ID, levelByNum: LEVEL_BY_NUM, buildLevelWorkbook, validatorVersion: VALIDATOR_VERSION, renderError });

export const checkIntegrity = makeIntegrityCheck({ levelByNum: LEVEL_BY_NUM });

/** 以學生全部作答（不隔離）計算數值 */
export function evaluateStudentLevel(levelNum, inputs, dataset) {
  const lv = LEVEL_BY_NUM[levelNum];
  const wb = buildLevelWorkbook(dataset.levels[levelNum], levelNum, inputs);
  const out = {};
  for (const a of Object.keys(lv.referenceFormulas)) out[a] = wb.getValue(lv.sheet, a);
  return out;
}

export { analyzeInput, valuesEqual, hasBinOp };
export const VALIDATED_TASKS = Object.keys(VALIDATORS);
