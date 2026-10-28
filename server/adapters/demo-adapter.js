// Demo／模擬 Sheet Adapter。
// ⚠️ 這不是 Google Sheets：只是伺服器端的模擬工作表（使用同一個公式引擎），
// 介面上一律清楚標示「模擬工作表（Demo）」。用途是在未設定 Google 憑證前試玩完整流程。
import { Workbook, isFormulaInput } from '../engine/workbook.js';
import { parseFormula } from '../engine/parser.js';
import { shiftAst, toFormulaString } from '../engine/ast.js';
import { expandRange, parseAddr, addr as mkAddr } from '../engine/refs.js';
import { isError, formatNumber } from '../engine/values.js';
import { LEVELS } from '../episode1/blueprint.js';
import { db, save } from '../store.js';
import { HttpError } from '../auth.js';
import { startSheetLines } from './start-sheet.js';

const wbs = new Map(); // `${compId}:${teamId}` -> Workbook

const levelBySheet = Object.fromEntries(LEVELS.map((l) => [l.sheet, l]));

function key(comp, team) { return `${comp.id}:${team.id}`; }

function stored(comp, team) {
  db.state.demoSheets[comp.id] ??= {};
  db.state.demoSheets[comp.id][team.id] ??= {};
  return db.state.demoSheets[comp.id][team.id];
}

export function serializeValue(v) {
  if (isError(v)) return v.code;
  return v ?? null;
}

export class DemoAdapter {
  constructor(getDataset) {
    this.getDataset = getDataset;
    this.name = 'demo';
    this.isReal = false;
  }

  build(comp, team) {
    const k = key(comp, team);
    if (wbs.has(k)) return wbs.get(k);
    const ds = this.getDataset(comp, team);
    const wb = new Workbook();
    const st = wb.addSheet('START', 30, 2);
    startSheetLines(comp, team).forEach((line, i) => st.cells.set(`A${i + 1}`, { input: line }));
    for (const lv of LEVELS) {
      wb.addSheet(lv.sheet, lv.maxRow, lv.maxCol);
      const d = ds.levels[lv.level];
      for (const [a, v] of Object.entries(d.data)) wb.setInput(lv.sheet, a, v);
      const saved = stored(comp, team)[lv.sheet];
      const inputs = saved || d.initial;
      for (const [a, v] of Object.entries(inputs)) wb.setInput(lv.sheet, a, v);
    }
    wbs.set(k, wb);
    return wb;
  }

  async provision(comp, team) {
    // 重新建立：清除舊作答
    wbs.delete(key(comp, team));
    if (db.state.demoSheets[comp.id]) delete db.state.demoSheets[comp.id][team.id];
    save();
    this.build(comp, team);
    return { provider: 'demo', fileId: `demo-${comp.id}-${team.id}`, url: null, status: 'READY', provisionedAt: Date.now() };
  }

  forget(comp) {
    for (const k of [...wbs.keys()]) if (k.startsWith(`${comp.id}:`)) wbs.delete(k);
    delete db.state.demoSheets[comp.id];
    save();
  }

  sheetView(comp, team, sheetName, { unlockedLevels }) {
    const wb = this.build(comp, team);
    if (sheetName === 'START') {
      const sh = wb.sheet('START');
      return { sheet: 'START', maxRow: sh.maxRow, maxCol: 1, editable: [], cells: Object.fromEntries([...sh.cells].map(([a, c]) => [a, { i: c.input, v: c.input }])) };
    }
    const lv = levelBySheet[sheetName];
    if (!lv) throw new HttpError(404, '沒有此工作表。');
    if (!unlockedLevels.includes(lv.level)) throw new HttpError(403, '此關尚未開始。', 'LEVEL_LOCKED');
    const sh = wb.sheet(sheetName);
    const cells = {};
    const editable = new Set(lv.editable.flatMap(expandRange));
    const addrs = new Set([...sh.cells.keys(), ...editable]);
    for (const a of addrs) {
      const c = sh.cells.get(a);
      const v = wb.getValue(sheetName, a);
      cells[a] = { i: c ? c.input : null, v: displayValue(v), e: isError(v) ? (v.detail || v.code) : undefined };
    }
    return { sheet: sheetName, maxRow: sh.maxRow, maxCol: sh.maxCol, editable: lv.editable, cells };
  }

  applyEdits(comp, team, sheetName, edits) {
    const lv = levelBySheet[sheetName];
    if (!lv) throw new HttpError(400, '此工作表不可編輯。');
    const editable = new Set(lv.editable.flatMap(expandRange));
    const wb = this.build(comp, team);
    for (const { addr: a, input } of edits) {
      const A = String(a).toUpperCase();
      if (!editable.has(A)) throw new HttpError(403, `${A} 是受保護的原始資料，不可修改。只可以編輯作答範圍：${lv.editable.join('、')}。`, 'PROTECTED_CELL');
      const val = normalizeInput(input);
      wb.setInput(sheetName, A, val);
    }
    this.persist(comp, team, sheetName, lv);
  }

  /** 複製／貼上（或向下填充）：相對參照自動位移 */
  copyPaste(comp, team, sheetName, source, target) {
    const lv = levelBySheet[sheetName];
    if (!lv) throw new HttpError(400, '此工作表不可編輯。');
    const editable = new Set(lv.editable.flatMap(expandRange));
    const srcCells = expandRange(source);
    const tgtCells = expandRange(target);
    for (const t of tgtCells) if (!editable.has(t)) throw new HttpError(403, `${t} 是受保護的原始資料，不可貼上。只可以編輯作答範圍：${lv.editable.join('、')}。`, 'PROTECTED_CELL');
    const wb = this.build(comp, team);
    const s0 = parseAddr(srcCells[0]);
    const sEnd = parseAddr(srcCells.at(-1));
    const h = sEnd.row - s0.row + 1;
    const w = sEnd.col - s0.col + 1;
    const t0 = parseAddr(tgtCells[0]);
    // 先取得來源內容，避免來源與目標重疊時互相影響
    const srcInputs = Object.fromEntries(srcCells.map((a) => [a, wb.getInput(sheetName, a)]));
    const results = tgtCells.map((t) => {
      const tp = parseAddr(t);
      const src = mkAddr(s0.col + ((tp.col - t0.col) % w), s0.row + ((tp.row - t0.row) % h));
      const sp = parseAddr(src);
      return [t, shiftInput(srcInputs[src], tp.row - sp.row, tp.col - sp.col)];
    });
    for (const [t, v] of results) wb.setInput(sheetName, t, v);
    this.persist(comp, team, sheetName, lv);
  }

  persist(comp, team, sheetName, lv) {
    const wb = this.build(comp, team);
    const out = {};
    for (const a of lv.editable.flatMap(expandRange)) {
      const v = wb.getInput(sheetName, a);
      if (v !== null && v !== undefined && v !== '') out[a] = v;
    }
    stored(comp, team)[sheetName] = out;
    save();
  }

  /** 提交時讀取快照：公式字串 + 計算後數值 */
  async readLevel(comp, team, levelNum) {
    const lv = LEVELS.find((l) => l.level === levelNum);
    const wb = this.build(comp, team);
    const sh = wb.sheet(lv.sheet);
    const cells = {};
    const addrs = new Set([...sh.cells.keys(), ...lv.editable.flatMap(expandRange)]);
    for (const a of addrs) {
      cells[a] = { input: wb.getInput(lv.sheet, a), value: serializeValue(wb.getValue(lv.sheet, a)) };
    }
    return { provider: 'demo', readAt: Date.now(), cells };
  }
}

export function shiftInput(input, dRow, dCol) {
  if (!isFormulaInput(input)) return input;
  try {
    return '=' + toFormulaString(shiftAst(parseFormula(input), dRow, dCol));
  } catch {
    return input;
  }
}

export function normalizeInput(input) {
  if (input === null || input === undefined) return null;
  if (typeof input !== 'string') return input;
  const t = input.replace(/\r?\n/g, ' ');
  if (t.trim() === '') return null;
  if (t.startsWith('=')) return t;
  if (/^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/.test(t)) return Number(t);
  if (/^\s*true\s*$/i.test(t)) return true;
  if (/^\s*false\s*$/i.test(t)) return false;
  return t;
}

function displayValue(v) {
  if (isError(v)) return v.code;
  if (typeof v === 'number') return formatNumber(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return v ?? '';
}
