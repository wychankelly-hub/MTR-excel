// 共用批改工具（第二集起使用；第一集保留原有已測試的版本）。
// 與第一集相同的原則：AST 分析（非字串比對、非 eval）、本隊數據＋隱藏測試數據重算、
// 「隔離」批改（其他題目的作答格以參考公式填充）、逐評分點給分、繁體中文回饋。
// 新增：含 RAND 的公式以多組可重現的隨機數重算（統計檢查）。
import { parseFormula } from '../engine/parser.js';
import { collectFunctions, collectCellRefs, collectLiterals, findFuncs, walk, unwrap } from '../engine/ast.js';
import { FUNCTIONS } from '../engine/functions.js';
import { expandRange, parseAddr } from '../engine/refs.js';
import { isError, valuesEqual } from '../engine/values.js';
import { makeRng } from '../episode1/rng.js';

export { collectFunctions, collectCellRefs, collectLiterals, findFuncs, walk, unwrap };

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

export function issueOf(cell, info) {
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

/** 範圍 node 是否為指定欄、指定列範圍（容許包括標題列） */
export function rangeIs(node, c1, r1, r2, c2 = c1) {
  node = unwrap(node);
  if (!node || node.type !== 'range') return false;
  const { start: s, end: e } = node;
  if (Math.min(s.col, e.col) !== c1 || Math.max(s.col, e.col) !== c2) return false;
  const lo = Math.min(s.row, e.row);
  const hi = Math.max(s.row, e.row);
  return (lo === r1 || lo === r1 - 1) && hi === r2;
}

/** 範圍兩端是否都以 $ 固定列號（向下複製時不會移動） */
export function rangeRowsAbsolute(node) {
  node = unwrap(node);
  return !!node && node.type === 'range' && node.start.rowAbs && node.end.rowAbs;
}

export function refsCell(ast, col, row) {
  let hit = false;
  walk(ast, (n) => { if (n.type === 'ref' && n.col === col && n.row === row) hit = true; });
  return hit;
}

export function hasBinOp(ast, op) {
  let hit = false;
  walk(ast, (n) => { if (n.type === 'bin' && n.op === op) hit = true; });
  return hit;
}

export const rowsOf = (col, r1, r2) => Array.from({ length: r2 - r1 + 1 }, (_, i) => `${col}${r1 + i}`);

export class GradeContext {
  /**
   * @param {object} opts { task, inputs, dataset, levelByNum, buildLevelWorkbook }
   */
  constructor({ task, inputs, dataset, levelByNum, buildLevelWorkbook }) {
    this.task = task;
    this.level = task.level;
    this.lv = levelByNum[task.level];
    this.inputs = inputs;
    this.dataset = dataset;
    this.build = buildLevelWorkbook;
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

  answers() {
    const answers = { ...this.lv.referenceFormulas };
    for (const a of this.taskCells) answers[a] = this.inputs[a] ?? null;
    return answers;
  }

  /** 隔離工作簿：其他題的作答格用參考公式，本題作答格用學生公式 */
  wb(kind) {
    if (!this.wbs[kind]) this.wbs[kind] = this.build(this.levelData(kind), this.level, this.answers());
    return this.wbs[kind];
  }

  val(kind, a) { return this.wb(kind).getValue(this.lv.sheet, a); }

  ok(kind, a) { return valuesEqual(this.val(kind, a), this.expected(kind, a)); }

  good(a) {
    const info = this.info(a);
    return info.kind === 'formula' && !issueOf(a, info) && this.ok('team', a) && this.ok('hidden', a);
  }

  err(code, cell, detail) { this.errors.push({ code, cell, detail }); }

  award(id, pass) { this.mp[id] = pass; }

  checkBasic(a) {
    const issue = issueOf(a, this.info(a));
    if (issue) { this.errors.push(issue); return false; }
    return true;
  }

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

  checkRows(cells) {
    const bad = cells.filter((a) => !this.good(a));
    if (bad.length) {
      const shown = bad.slice(0, 6).join('、') + (bad.length > 6 ? ` 等 ${bad.length} 格` : '');
      this.err('COPY_INCOMPLETE', `${cells[0]}:${cells.at(-1)}`, shown);
    }
    return bad.length === 0;
  }

  /**
   * 以多組可重現的隨機數重算（RAND 題目）。
   * fn(wb) 回傳每次重算要檢查的資料；回傳所有結果的陣列。
   */
  randomRuns(kind, runs, fn) {
    const wb = this.build(this.levelData(kind), this.level, this.answers());
    const out = [];
    for (let i = 0; i < runs; i++) {
      wb.rng = makeRng(`grade:${this.task.id}:${kind}:${i}`).next;
      wb.recalc();
      out.push(fn(wb));
    }
    return out;
  }
}

/** 建立批改函數（每集的 validators 使用） */
export function makeGrader({ validators, taskById, levelByNum, buildLevelWorkbook, validatorVersion, renderError }) {
  return function gradeTask(taskId, inputs, dataset) {
    const task = taskById[taskId];
    if (!task) throw new Error(`未知 Task ${taskId}`);
    const g = new GradeContext({ task, inputs, dataset, levelByNum, buildLevelWorkbook });
    validators[taskId](g);
    const markingPoints = task.markingPoints.map((mp) => ({
      id: mp.id, label: mp.label, max: mp.max, earned: g.mp[mp.id] ? mp.max : 0, passed: !!g.mp[mp.id],
    }));
    const earned = markingPoints.reduce((s, m) => s + m.earned, 0);
    const seen = new Set();
    const errors = g.errors.filter((e) => {
      const k = `${e.code}|${e.cell}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).map(renderError);
    return {
      taskId,
      validatorVersion,
      earned,
      max: task.points,
      status: earned === task.points ? 'VERIFIED' : 'REJECTED',
      needsReview: errors.some((e) => e.code === 'UNSUPPORTED_FUNCTION'),
      markingPoints,
      errors,
      hiddenTested: true,
    };
  };
}

/** 原始資料完整性（與第一集相同的規則） */
export function makeIntegrityCheck({ levelByNum }) {
  return function checkIntegrity(levelNum, snapshotCells, dataset) {
    const data = dataset.levels[levelNum].data;
    const changed = [];
    for (const [a, v] of Object.entries(data)) {
      const got = snapshotCells[a]?.value ?? null;
      const input = snapshotCells[a]?.input;
      if (typeof input === 'string' && input.startsWith('=')) { changed.push(a); continue; }
      if (!valuesEqual(got, v, 1e-9) && !(typeof v === 'number' && typeof got === 'string' && Number(got) === v)) changed.push(a);
    }
    const lv = levelByNum[levelNum];
    const editable = new Set(lv.editable.flatMap(expandRange));
    for (const [a, c] of Object.entries(snapshotCells)) {
      if (a in data || editable.has(a)) continue;
      if (c.input !== null && c.input !== undefined && c.input !== '') {
        const { row, col } = parseAddr(a);
        if (row <= lv.maxRow && col <= lv.maxCol) changed.push(a);
      }
    }
    return changed;
  };
}
