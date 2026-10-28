// Formula / Workbook Validation（§7）。
// 每個 Task 都會：
//   1. 檢查作答格是公式（不接受固定數值）並可解析（AST，非字串比對、非 eval）；
//   2. 驗證指定函數／絕對參照／運算符／參照儲存格；
//   3. 在本隊數據下重算並核對整段範圍；
//   4. 在隱藏測試數據（相同結構、不同數值）下重算，找出寫死數值與參照錯誤；
//   5. 逐 marking point 給分，並回傳繁體中文 Feedback。
// 批改採「隔離」方式：其他 Task 的儲存格以參考公式填充，避免前一題錯誤連累後一題。
import { parseFormula } from '../engine/parser.js';
import { collectFunctions, collectCellRefs, collectLiterals, findFuncs, walk, unwrap, toRelativeForm } from '../engine/ast.js';
import { FUNCTIONS } from '../engine/functions.js';
import { expandRange, parseAddr } from '../engine/refs.js';
import { isError, valuesEqual, describeValue } from '../engine/values.js';
import { LEVEL_BY_NUM, TASK_BY_ID, VALIDATOR_VERSION } from './blueprint.js';
import { buildLevelWorkbook } from './generator.js';
import { renderError } from './feedback.js';

export function analyzeInput(input) {
  if (input === null || input === undefined || input === '') return { kind: 'empty' };
  if (typeof input === 'string' && input.startsWith('=')) {
    try {
      const ast = parseFormula(input);
      return { kind: 'formula', ast, fns: collectFunctions(ast) };
    } catch (e) {
      return { kind: 'error', error: e };
    }
  }
  return { kind: 'constant', value: input };
}

function issueOf(cell, info) {
  if (info.kind === 'empty') return { code: 'EMPTY', cell };
  if (info.kind === 'constant') return { code: 'FORMULA_REQUIRED', cell };
  if (info.kind === 'error') {
    const code = info.error.code === 'NON_ASCII' ? 'NON_ASCII' : info.error.code === 'UNKNOWN_NAME' ? 'UNKNOWN_NAME' : 'SYNTAX_ERROR';
    return { code, cell, detail: info.error.message };
  }
  const bad = [...info.fns].filter((f) => !FUNCTIONS[f]);
  if (bad.length) return { code: 'UNSUPPORTED_FUNCTION', cell, detail: bad.join(', ') };
  return null;
}

/** 範圍 node 是否覆蓋指定欄的資料列（容許包括標題列或整欄） */
function rangeIs(node, col, r1, r2) {
  node = unwrap(node);
  if (!node) return false;
  if (node.type === 'colrange') return node.c1 === col && node.c2 === col;
  if (node.type !== 'range') return false;
  const { start: s, end: e } = node;
  if (s.col !== col || e.col !== col) return false;
  const lo = Math.min(s.row, e.row);
  const hi = Math.max(s.row, e.row);
  return (lo === r1 || lo === r1 - 1) && hi === r2;
}

function rangeTouchesCols(ast, cols) {
  let hit = false;
  walk(ast, (n) => {
    if (n.type === 'range' && cols.some((c) => c >= Math.min(n.start.col, n.end.col) && c <= Math.max(n.start.col, n.end.col))) hit = true;
    if (n.type === 'colrange' && cols.some((c) => c >= n.c1 && c <= n.c2)) hit = true;
  });
  return hit;
}

function refsCell(ast, col, row) {
  let hit = false;
  walk(ast, (n) => { if (n.type === 'ref' && n.col === col && n.row === row) hit = true; });
  return hit;
}

function hasBinOp(ast, op) {
  let hit = false;
  walk(ast, (n) => { if (n.type === 'bin' && n.op === op) hit = true; });
  return hit;
}

class GradeContext {
  constructor(task, inputs, dataset) {
    this.task = task;
    this.level = task.level;
    this.lv = LEVEL_BY_NUM[task.level];
    this.inputs = inputs;
    this.dataset = dataset;
    this.taskCells = task.cells.flatMap(expandRange);
    this.infos = {};
    for (const a of this.taskCells) this.infos[a] = analyzeInput(inputs[a]);
    this.wbs = {};
    this.errors = [];
    this.mp = {};
  }

  info(a) { return this.infos[a]; }

  levelData(kind) { return kind === 'team' ? this.dataset.levels[this.level] : this.dataset.hidden[this.level]; }

  expected(kind, a) { return (kind === 'team' ? this.dataset.ref : this.dataset.hiddenRef)[this.level][a]; }

  /** 隔離工作簿：其他題的作答格用參考公式，本題作答格用學生公式 */
  wb(kind) {
    if (!this.wbs[kind]) {
      const answers = { ...this.lv.referenceFormulas };
      for (const a of this.taskCells) answers[a] = this.inputs[a] ?? null;
      this.wbs[kind] = buildLevelWorkbook(this.levelData(kind), this.level, answers);
    }
    return this.wbs[kind];
  }

  val(kind, a) { return this.wb(kind).getValue(this.lv.sheet, a); }

  ok(kind, a) {
    const v = this.val(kind, a);
    return valuesEqual(v, this.expected(kind, a));
  }

  /** 公式存在且在本隊及隱藏數據下都正確 */
  good(a) {
    const info = this.info(a);
    return info.kind === 'formula' && !issueOf(a, info) && this.ok('team', a) && this.ok('hidden', a);
  }

  err(code, cell, detail) { this.errors.push({ code, cell, detail }); }

  award(id, pass) { this.mp[id] = pass; }

  /** 在本隊工作簿的副本中，更改部分儲存格後計算某格（用於邊界探測） */
  probe(target, overrides) {
    const wb = this.wb('team').clone();
    for (const [a, v] of Object.entries(overrides)) wb.setInput(this.lv.sheet, a, v);
    return wb.getValue(this.lv.sheet, target);
  }

  evalNode(kind, node) {
    return this.wb(kind).evalNode(node, this.lv.sheet);
  }

  /** 公式格常見錯誤：空白／固定值／語法／未支援函數。回傳 true 表示可繼續檢查 */
  checkBasic(a) {
    const issue = issueOf(a, this.info(a));
    if (issue) { this.errors.push(issue); return false; }
    return true;
  }

  /** 值錯誤時加入合適的提示 */
  explainValue(a) {
    const v = this.val('team', a);
    if (isError(v)) {
      if (v.detail?.startsWith('循環參照')) this.err('CIRCULAR', a);
      else this.err('FORMULA_ERROR_VALUE', a, `${v.code}${v.detail && !v.detail.startsWith('UNSUPPORTED') ? `（${v.detail}）` : ''}`);
      return;
    }
    if (this.ok('team', a) && !this.ok('hidden', a)) this.err('HIDDEN_FAIL', a);
    else this.err('VALUE_WRONG', a);
  }

  /** 整段範圍複製檢查 */
  checkRows(cells) {
    const bad = cells.filter((a) => !this.good(a));
    if (bad.length) {
      const shown = bad.slice(0, 6).join('、') + (bad.length > 6 ? ` 等 ${bad.length} 格` : '');
      this.err('COPY_INCOMPLETE', `${cells[0]}:${cells.at(-1)}`, shown);
    }
    return bad.length === 0;
  }
}

const rowsOf = (col, r1, r2) => Array.from({ length: r2 - r1 + 1 }, (_, i) => `${col}${r1 + i}`);

// ============================================================ 各題驗證器
const VALIDATORS = {
  'L1-T1'(g) {
    const H1 = { col: 8, row: 1 };
    let a = false;
    if (g.checkBasic('D2')) {
      const { ast } = g.info('D2');
      const h1refs = collectCellRefs(ast).filter((r) => r.col === H1.col && r.row === H1.row);
      const abs = h1refs.some((r) => r.colAbs && r.rowAbs);
      const valOK = g.ok('team', 'D2') && g.ok('hidden', 'D2');
      const mult = g.levelData('team').data.H1;
      if (!h1refs.length) {
        if (collectLiterals(ast).some((l) => l.type === 'num' && Math.abs(l.value - mult) < 1e-9)) g.err('HARDCODED_MULTIPLIER', 'D2');
        else if (!valOK) g.explainValue('D2');
      } else if (!abs) {
        const r = h1refs[0];
        if (r.colAbs || r.rowAbs) g.err('ABS_REF_PARTIAL', 'D2', r.colAbs ? '$H1' : 'H$1');
        else g.err('ABS_REF_MISSING', 'D2');
      }
      if (h1refs.length && !valOK) {
        if (hasBinOp(ast, '+')) g.err('FARE_OPERATOR', 'D2');
        else g.explainValue('D2');
      }
      a = abs && valOK;
    }
    g.award('a', a);
    const rows = rowsOf('D', 3, 21);
    const b = g.checkRows(rows);
    if (!b) {
      // 是否仍是火箭仔的相對參照版本
      const rel = rows.map((x) => g.info(x)).filter((i) => i.kind === 'formula');
      const buggy = rel.some((i, k) => collectCellRefs(i.ast).some((r) => r.col === 8 && !r.rowAbs && r.row !== 1) && k >= 0);
      if (buggy && !g.errors.some((e) => e.code === 'ABS_REF_MISSING')) g.err('ABS_REF_MISSING', 'D3:D21');
    }
    g.award('b', b);
  },

  'L1-T2'(g) {
    let a = false;
    if (g.checkBasic('F2')) {
      a = g.ok('team', 'F2') && g.ok('hidden', 'F2');
      if (!a) {
        const d = g.levelData('team').data;
        const v = g.val('team', 'F2');
        if (typeof v === 'number' && Math.abs(v - (d.E2 + g.expected('team', 'D2'))) < 1e-6) g.err('BALANCE_DIRECTION', 'F2');
        else g.explainValue('F2');
      }
    }
    g.award('a', a);
    g.award('b', g.checkRows(rowsOf('F', 3, 21)));
  },

  'L1-T3'(g) {
    let a = false; let b = false;
    if (g.checkBasic('H3')) {
      const { ast } = g.info('H3');
      const sums = findFuncs(ast, 'SUM');
      if (!sums.length) g.err('SUM_REQUIRED', 'H3');
      else if (sums.some((f) => f.args.some((x) => rangeIs(x, 6, 2, 21)))) a = true;
      else g.err('SUM_RANGE', 'H3');
      b = g.ok('team', 'H3') && g.ok('hidden', 'H3');
      if (!b) g.explainValue('H3');
    }
    g.award('a', a);
    g.award('b', b);
  },

  'L1-B1'(g) {
    let a = false;
    if (g.checkBasic('H5')) {
      const { ast } = g.info('H5');
      const mins = findFuncs(ast, 'MIN');
      if (!mins.length) g.err('MIN_REQUIRED', 'H5');
      const ok = g.ok('team', 'H5') && g.ok('hidden', 'H5');
      if (!ok) g.explainValue('H5');
      a = mins.some((f) => f.args.some((x) => rangeIs(x, 6, 2, 21))) && ok;
      if (mins.length && ok && !a) g.err('RANGE_WRONG', 'H5');
    }
    g.award('a', a);
  },

  'L2-T1'(g) {
    let a = false;
    if (g.checkBasic('D2')) {
      const { fns } = g.info('D2');
      const ok = g.ok('team', 'D2') && g.ok('hidden', 'D2');
      if (!fns.has('SUM')) g.err('SUM_REQUIRED', 'D2');
      if (!ok) {
        const v = g.val('team', 'D2');
        const d = g.levelData('team').data;
        if (v === d.B2 || v === d.C2) g.err('FLOW_ONE_COLUMN', 'D2');
        else g.explainValue('D2');
      }
      a = fns.has('SUM') && ok;
    }
    g.award('a', a);
    g.award('b', g.checkRows(rowsOf('D', 3, 13)));
  },

  'L2-T2'(g) { singleAggregate(g, 'H2', 'MAX_WRONG_RANGE'); },
  'L2-T3'(g) { singleAggregate(g, 'H3', 'AVERAGE_WRONG_RANGE'); },

  'L2-T4'(g) {
    let a = false;
    if (g.checkBasic('H4')) {
      const { ast, fns } = g.info('H4');
      const ok = g.ok('team', 'H4') && g.ok('hidden', 'H4');
      const counts = findFuncs(ast, 'COUNT');
      if (!counts.length) g.err('COUNT_REQUIRED', 'H4');
      else if (!counts.some((f) => f.args.some((x) => rangeIs(x, 4, 2, 13)))) g.err('RANGE_WRONG', 'H4');
      else if (!ok) g.explainValue('H4');
      a = fns.has('COUNT') && counts.some((f) => f.args.some((x) => rangeIs(x, 4, 2, 13))) && ok;
    }
    g.award('a', a);
  },

  'L3-T1'(g) {
    let a = false; let b = false;
    if (g.checkBasic('E2')) {
      const { fns } = g.info('E2');
      const limits = [g.levelData('team').data.H1, g.levelData('team').data.H1 + 5];
      const combos = [];
      for (const L of limits) {
        for (const age of [L - 1, L, L + 1, L + 12, 20]) {
          for (const assist of ['YES', 'NO']) for (const valid of [true, false]) combos.push({ L, age, assist, valid });
        }
      }
      const outs = combos.map((c) => g.probe('E2', { H1: c.L, B2: c.age, C2: c.assist, D2: c.valid }));
      const to01 = (v) => (v === 1 || v === true || v === 'YES' ? 1 : v === 0 || v === false || v === 'NO' ? 0 : NaN);
      const logic = outs.map(to01);
      const rule = (c, { gt = false, swap = false, ignoreValid = false, fixedL = null } = {}) => {
        const L = fixedL ?? c.L;
        const ageOK = gt ? c.age > L : c.age >= L;
        if (swap) return (ageOK && c.assist === 'YES') || c.valid ? 1 : 0;
        if (ignoreValid) return ageOK || c.assist === 'YES' ? 1 : 0;
        return c.valid && (ageOK || c.assist === 'YES') ? 1 : 0;
      };
      const same = (opts) => combos.every((c, i) => logic[i] === rule(c, opts));
      // a：IF 回傳 1/0
      const nonNumeric = outs.find((v) => !(v === 0 || v === 1));
      if (!fns.has('IF')) g.err('IF_REQUIRED', 'E2');
      else if (nonNumeric !== undefined && !isError(nonNumeric)) g.err('OUTPUT_NOT_1_0', 'E2', describeValue(nonNumeric));
      a = fns.has('IF') && nonNumeric === undefined;
      // b：AND/OR 組合與參照
      const logicOK = same();
      if (!fns.has('AND') || !fns.has('OR')) g.err('AND_OR_REQUIRED', 'E2');
      if (!logicOK) {
        if (outs.some(isError)) g.explainValue('E2');
        else if (same({ swap: true })) g.err('AND_OR_SWAPPED', 'E2');
        else if (same({ gt: true })) g.err('BOUNDARY_GT', 'E2');
        else if (same({ ignoreValid: true })) g.err('VALIDCARD_IGNORED', 'E2');
        else if (same({ fixedL: limits[0] })) g.err('H1_HARDCODED', 'E2');
        else g.err('LOGIC_WRONG', 'E2');
      }
      b = fns.has('AND') && fns.has('OR') && logicOK && g.ok('team', 'E2');
    }
    g.award('a', a);
    g.award('b', b);
    const rows = rowsOf('E', 2, 25);
    const c = rows.every((x) => g.good(x));
    if (!c && b) {
      const rel = rows.slice(1).map((x) => g.info(x)).filter((i) => i.kind === 'formula');
      const movedH = rel.some((i) => collectCellRefs(i.ast).some((r) => r.col === 8 && r.row !== 1));
      const e2Ref = collectCellRefs(g.info('E2').ast).find((r) => r.col === 8 && r.row === 1);
      if (movedH || (e2Ref && !e2Ref.rowAbs)) g.err('H1_NOT_ABSOLUTE', 'E2');
      else g.checkRows(rows);
    } else if (!c) {
      g.checkRows(rows.slice(1));
    }
    g.award('c', c);
  },

  'L3-T2'(g) {
    let a = false;
    if (g.checkBasic('H2')) {
      a = g.ok('team', 'H2') && g.ok('hidden', 'H2');
      if (!a) g.explainValue('H2');
    }
    g.award('a', a);
  },

  'L4-T1'(g) {
    let a = false; let b = false;
    if (g.checkBasic('I2')) {
      const { ast } = g.info('I2');
      const f = findFuncs(ast, 'COUNTIF')[0];
      if (!f) g.err('COUNTIF_REQUIRED', 'I2');
      else {
        a = rangeIs(f.args[0], 2, 2, 501);
        if (!a) g.err('CRITERIA_RANGE_WRONG', 'I2', 'B（Category）');
        const critRefH2 = f.args[1] && refsCell(f.args[1], 8, 2);
        if (!critRefH2) g.err('CRITERIA_NOT_H2', 'I2');
        const ok = g.ok('team', 'I2') && g.ok('hidden', 'I2');
        if (!ok && critRefH2) g.explainValue('I2');
        b = !!critRefH2 && ok;
      }
    }
    g.award('a', a);
    g.award('b', b);
  },

  'L4-T2'(g) {
    let a = false; let b = false;
    if (g.checkBasic('I3')) {
      const { ast } = g.info('I3');
      const f = findFuncs(ast, 'SUMIF')[0];
      if (!f) g.err('SUMIF_REQUIRED', 'I3');
      else {
        const rangeOK = rangeIs(f.args[0], 2, 2, 501);
        const critOK = f.args[1] && refsCell(f.args[1], 8, 2);
        if (!rangeOK) g.err('CRITERIA_RANGE_WRONG', 'I3', 'B（Category）');
        if (!critOK) g.err('CRITERIA_NOT_H2', 'I3');
        a = rangeOK && !!critOK;
        const sumOK = f.args.length === 3 && rangeIs(f.args[2], 3, 2, 501);
        if (!sumOK) g.err('SUM_RANGE_WRONG', 'I3');
        const ok = g.ok('team', 'I3') && g.ok('hidden', 'I3');
        if (!ok && sumOK && a) g.explainValue('I3');
        b = sumOK && ok;
      }
    }
    g.award('a', a);
    g.award('b', b);
  },

  'L4-T3'(g) {
    let a = false; let b = false; let c = false;
    const info = g.info('I4');
    if (info.kind === 'error' && (info.error.code === 'BAD_OPERATOR' || /SUMIF/i.test(String(g.inputs.I4)) && />=?\s*\$?H\$?1/i.test(String(g.inputs.I4)))) {
      g.err('CRITERIA_SYNTAX', 'I4');
    } else if (g.checkBasic('I4')) {
      const f = findFuncs(info.ast, 'SUMIF')[0];
      if (!f) g.err('SUMIF_REQUIRED', 'I4');
      else {
        const critNode = f.args[1];
        const crit = critNode ? g.evalNode('team', critNode) : null;
        const critHidden = critNode ? g.evalNode('hidden', critNode) : null;
        const h1 = g.levelData('team').data.H1;
        const hh1 = g.levelData('hidden').data.H1;
        // a：比較運算符 >=
        if (typeof crit === 'string' && crit.startsWith('>=')) a = true;
        else if (typeof crit === 'string' && /^\s+[<>=]/.test(crit)) g.err('CRITERIA_SPACES', 'I4');
        else if (typeof crit === 'string' && crit.startsWith('>')) g.err('CRITERIA_GT', 'I4');
        else g.err('CRITERIA_NO_AMP', 'I4');
        // b：">="&H1
        const usesAmp = critNode && hasBinOp(critNode, '&');
        const refH1 = critNode && refsCell(critNode, 8, 1);
        const hard = critNode && collectLiterals(critNode).some((l) => (l.type === 'num' && l.value === h1) || (l.type === 'str' && l.value.replace(/\s/g, '').includes(String(h1))));
        if (hard || (critNode && !refH1)) g.err('CRITERIA_HARDCODED', 'I4');
        else if (!usesAmp) g.err('CRITERIA_NO_AMP', 'I4');
        b = a && usesAmp && refH1 && !hard && crit === `>=${h1}` && critHidden === `>=${hh1}`;
        // c：總和範圍與結果
        const rangeOK = rangeIs(f.args[0], 3, 2, 501);
        const sumOK = f.args.length === 2 || (f.args.length === 3 && rangeIs(f.args[2], 3, 2, 501));
        if (!rangeOK) g.err('CRITERIA_RANGE_WRONG', 'I4', 'C（EstimatedValue）');
        if (!sumOK) g.err('SUM_RANGE_WRONG', 'I4');
        const ok = g.ok('team', 'I4') && g.ok('hidden', 'I4');
        if (!ok && rangeOK && sumOK && a && b) g.explainValue('I4');
        c = rangeOK && sumOK && ok;
      }
    }
    g.award('a', a);
    g.award('b', b);
    g.award('c', c);
  },

  'L5-T1'(g) {
    const methods = g.lv.methods;
    methods.forEach((m, i) => {
      const r = i + 2;
      const cell = `C${r}`;
      const info = g.info(cell);
      let pass = false;
      if (info.kind === 'constant' && typeof info.value === 'string') g.err('HARDCODED_LETTER', cell);
      else if (g.checkBasic(cell)) {
        const { ast, fns } = info;
        const refA = refsCell(ast, 1, r);
        const onlyLiteral = !collectCellRefs(ast).length && !walkHasRange(ast);
        if (onlyLiteral) g.err('HARDCODED_LETTER', cell);
        else if (!fns.has(m)) g.err('TEXT_FUNC_WRONG', cell, m);
        else if (!refA) g.err('TEXT_REF_WRONG', cell);
        let midOK = true;
        if (m === 'MID' && fns.has('MID')) {
          const f = findFuncs(ast, 'MID')[0];
          if (f.args.length !== 3) { g.err('MID_ARGS', cell); midOK = false; }
          else if (!refsCell(f.args[1], 2, r)) { g.err('MID_POSITION', cell); midOK = false; }
        }
        const ok = g.ok('team', cell) && g.ok('hidden', cell);
        if (!ok && midOK && fns.has(m) && refA) {
          if (m === 'MID') g.err('MID_POSITION', cell);
          else g.explainValue(cell);
        }
        pass = !onlyLiteral && fns.has(m) && refA && midOK && ok;
      }
      g.award(cell, pass);
    });
  },

  'L5-T2'(g) {
    let a = false; let b = false;
    const info = g.info('H2');
    if (info.kind === 'constant' && typeof info.value === 'string') g.err('HARDCODED_WORD', 'H2');
    else if (g.checkBasic('H2')) {
      const { ast, fns } = info;
      const strLits = collectLiterals(ast).filter((l) => l.type === 'str' && l.value !== '');
      const refs = collectCellRefs(ast);
      const allC = [2, 3, 4, 5, 6].every((r) => refs.some((x) => x.col === 3 && x.row === r));
      const amp = hasBinOp(ast, '&');
      if (strLits.length) g.err('HARDCODED_WORD', 'H2');
      else if (!amp || fns.has('CONCATENATE') || fns.has('CONCAT') || hasBinOp(ast, '+')) g.err('AMP_REQUIRED', 'H2');
      else if (!allC) g.err('AMP_REFS', 'H2');
      a = !strLits.length && amp && allC && !fns.has('CONCATENATE') && !fns.has('CONCAT');
      b = g.ok('team', 'H2') && g.ok('hidden', 'H2');
      if (!b && !strLits.length) g.explainValue('H2');
    }
    g.award('a', a);
    g.award('b', b);
  },
};

function walkHasRange(ast) {
  let hit = false;
  walk(ast, (n) => { if (n.type === 'range' || n.type === 'colrange') hit = true; });
  return hit;
}

function singleAggregate(g, cell, rangeErr) {
  let a = false;
  if (g.checkBasic(cell)) {
    const { ast } = g.info(cell);
    a = g.ok('team', cell) && g.ok('hidden', cell);
    if (!a) {
      if (rangeTouchesCols(ast, [2, 3])) g.err(rangeErr, cell);
      else g.explainValue(cell);
    }
  }
  g.award('a', a);
}

/**
 * 批改一個 Task。
 * @param {string} taskId
 * @param {Record<string, any>} inputs  該關工作表作答格的「輸入內容」（公式字串或常數）
 * @param {object} dataset              伺服器端的隊伍數據（含隱藏測試及參考答案）
 */
export function gradeTask(taskId, inputs, dataset) {
  const task = TASK_BY_ID[taskId];
  if (!task) throw new Error(`未知 Task ${taskId}`);
  const g = new GradeContext(task, inputs, dataset);
  VALIDATORS[taskId](g);
  const markingPoints = task.markingPoints.map((mp) => ({
    id: mp.id, label: mp.label, max: mp.max, earned: g.mp[mp.id] ? mp.max : 0, passed: !!g.mp[mp.id],
  }));
  const earned = markingPoints.reduce((s, m) => s + m.earned, 0);
  const max = task.points;
  // 去除重複錯誤
  const seen = new Set();
  const errors = g.errors.filter((e) => {
    const k = `${e.code}|${e.cell}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).map(renderError);
  const needsReview = errors.some((e) => e.code === 'UNSUPPORTED_FUNCTION');
  return {
    taskId,
    validatorVersion: VALIDATOR_VERSION,
    earned,
    max,
    status: earned === max ? 'VERIFIED' : 'REJECTED',
    needsReview,
    markingPoints,
    errors,
    hiddenTested: true,
  };
}

/** 以學生全部作答（不隔離）計算數值：顯示用、以及與 Google Sheets 結果交叉核對 */
export function evaluateStudentLevel(levelNum, inputs, dataset) {
  const lv = LEVEL_BY_NUM[levelNum];
  const wb = buildLevelWorkbook(dataset.levels[levelNum], levelNum, inputs);
  const out = {};
  for (const a of lv.editable.flatMap(expandRange)) out[a] = wb.getValue(lv.sheet, a);
  return out;
}

/** 數據完整性：學生不可修改的原始資料是否與伺服器版本一致 */
export function checkIntegrity(levelNum, snapshotCells, dataset) {
  const data = dataset.levels[levelNum].data;
  const changed = [];
  for (const [a, v] of Object.entries(data)) {
    const got = snapshotCells[a]?.value ?? null;
    const input = snapshotCells[a]?.input;
    if (typeof input === 'string' && input.startsWith('=')) { changed.push(a); continue; }
    if (!valuesEqual(got, v, 1e-9) && !(typeof v === 'number' && typeof got === 'string' && Number(got) === v)) changed.push(a);
  }
  // 原始資料範圍內不應出現額外內容（例如插入資料）
  const lv = LEVEL_BY_NUM[levelNum];
  const editable = new Set(lv.editable.flatMap(expandRange));
  for (const [a, c] of Object.entries(snapshotCells)) {
    if (a in data || editable.has(a)) continue;
    if (c.input !== null && c.input !== undefined && c.input !== '') {
      const { row, col } = parseAddr(a);
      if (row <= lv.maxRow && col <= lv.maxCol) changed.push(a);
    }
  }
  return changed;
}

/** 學生輸入的相對形式（教師診斷用，例如找出最常見的錯誤寫法） */
export function relativeForm(input, a) {
  const info = analyzeInput(input);
  if (info.kind !== 'formula') return null;
  const { row, col } = parseAddr(a);
  return toRelativeForm(info.ast, row, col);
}

export const VALIDATED_TASKS = Object.keys(VALIDATORS);
