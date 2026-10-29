// 內置工作表服務：每隊（每場比賽）一份工作簿，儲存格逐格存於資料庫。
// - 隊伍一律由呼叫者按伺服器的隊伍名單決定（不接受客戶端提供的隊伍編號）。
// - 每格有版本號：客戶端以「基於版本」提交修改，版本不符（隊友剛修改）時不會覆蓋，而是回報衝突。
// - 原始數據由 Seed 重新生成（不存於儲存格表），學生不能修改。
// - 練習（重做）使用獨立的副本（layer），不會改動原來的作答。
import { Workbook, isFormulaInput } from './engine/workbook.js';
import { parseFormula } from './engine/parser.js';
import { shiftAst, toFormulaString } from './engine/ast.js';
import { expandRange, parseAddr, addr as mkAddr } from './engine/refs.js';
import { isError, formatNumber } from './engine/values.js';
import { db, cellBook, putCell, deleteCompCells } from './store.js';
import { HttpError } from './auth.js';
import { clock } from './clock.js';
import { bus } from './bus.js';
import { startSheetLines } from './adapters/start-sheet.js';

export const MAIN = 'main';

let episodeOf = null; // (comp) => episode；由 competition.js 注入，避免循環 import
let datasetOf = null; // (comp, team) => dataset
let editRules = null; // (comp, team, level, layer) => { editable: Set<addr>, tasks: [...] }
export function configureSheets({ episode, dataset, rules }) {
  episodeOf = episode;
  datasetOf = dataset;
  editRules = rules;
}

const levelOfSheet = (comp, sheet) => episodeOf(comp).levels.find((l) => l.sheet === sheet) || null;
export const levelForSheet = levelOfSheet;

/** 儲存格表中的工作表鍵：正式作答 = 工作表名稱；練習副本 = 名稱@練習編號 */
export function sheetKey(sheet, layer) {
  return !layer || layer === MAIN ? sheet : `${sheet}@${layer}`;
}

const wbCache = new Map(); // `${compId}|${teamId}|${layer}` -> Workbook

function cacheKey(comp, team, layer) { return `${comp.id}|${team.id}|${layer || MAIN}`; }

export function forgetComp(compId) {
  for (const k of [...wbCache.keys()]) if (k.startsWith(`${compId}|`)) wbCache.delete(k);
  deleteCompCells(compId);
}

export function forgetWorkbooks(compId) {
  for (const k of [...wbCache.keys()]) if (k.startsWith(`${compId}|`)) wbCache.delete(k);
}

/** 正式作答的儲存格（第一次使用時放入該關的起始內容，例如火箭仔寫錯的公式） */
function mainBook(comp, team, lv) {
  const existing = cellBook(comp.id, team.id, lv.sheet, false);
  if (existing) return existing;
  const ds = datasetOf(comp, team);
  const book = cellBook(comp.id, team.id, lv.sheet);
  for (const [a, v] of Object.entries(ds.levels[lv.level].initial || {})) putCell(comp.id, team.id, lv.sheet, a, { i: v, v: 1, by: 'system', at: clock.now() });
  return book;
}

/** 練習副本：第一次開啟時複製當時的正式作答（之後兩者互不影響） */
function practiceBook(comp, team, lv, layer) {
  const key = sheetKey(lv.sheet, layer);
  const existing = cellBook(comp.id, team.id, key, false);
  if (existing) return existing;
  const src = mainBook(comp, team, lv);
  const book = cellBook(comp.id, team.id, key);
  for (const [a, e] of Object.entries(src)) if (e && e.i !== null && e.i !== undefined) putCell(comp.id, team.id, key, a, { i: e.i, v: 1, by: 'copy', at: clock.now() });
  return book;
}

export function bookFor(comp, team, lv, layer = MAIN) {
  return !layer || layer === MAIN ? mainBook(comp, team, lv) : practiceBook(comp, team, lv, layer);
}

/** 該隊的工作簿（含所有關卡的原始數據及作答），用作計算數值及批改 */
export function workbookFor(comp, team, layer = MAIN) {
  const k = cacheKey(comp, team, layer);
  if (wbCache.has(k)) return wbCache.get(k);
  const ep = episodeOf(comp);
  const ds = datasetOf(comp, team);
  const wb = new Workbook();
  const st = wb.addSheet('START', 30, 2);
  startSheetLines(comp, team).forEach((line, i) => st.cells.set(`A${i + 1}`, { input: line }));
  for (const lv of ep.levels) {
    wb.addSheet(lv.sheet, lv.maxRow, lv.maxCol);
    for (const [a, v] of Object.entries(ds.levels[lv.level].data)) wb.setInput(lv.sheet, a, v);
    const useLayer = layer !== MAIN && cellBook(comp.id, team.id, sheetKey(lv.sheet, layer), false) ? layer : MAIN;
    const book = bookFor(comp, team, lv, useLayer);
    for (const [a, e] of Object.entries(book)) if (e && e.i !== null && e.i !== undefined) wb.setInput(lv.sheet, a, e.i);
  }
  wbCache.set(k, wb);
  return wb;
}

export function normalizeInput(input) {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number' || typeof input === 'boolean') return input;
  const t = String(input).replace(/\r?\n/g, ' ');
  if (t.trim() === '') return null;
  if (t.startsWith('=')) return t;
  if (/^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/.test(t)) return Number(t);
  if (/^\s*true\s*$/i.test(t)) return true;
  if (/^\s*false\s*$/i.test(t)) return false;
  return t;
}

const sameInput = (a, b) => (a ?? null) === (b ?? null);

/**
 * 套用一批儲存格修改。
 * ops: [{ a: 'D2', i: '=B2*C2', base: 版本 }]；base 不符時回報衝突（不覆蓋隊友的修改）。
 * force：舊介面（沒有版本號）使用，最後寫入為準。
 */
export function applyOps(comp, team, user, sheet, layer, ops, { force = false } = {}) {
  const lv = levelOfSheet(comp, sheet);
  if (!lv) throw new HttpError(404, '沒有此工作表，或此工作表不可編輯。', 'NO_SHEET');
  if (!Array.isArray(ops) || !ops.length) return { applied: [], conflicts: [], rejected: [] };
  if (ops.length > 1200) throw new HttpError(413, '一次修改太多儲存格。');
  const rules = editRules(comp, team, lv.level, layer || MAIN, user);
  const key = sheetKey(sheet, layer);
  const book = bookFor(comp, team, lv, layer);
  const wb = workbookFor(comp, team, layer);
  const applied = [];
  const conflicts = [];
  const rejected = [];
  const now = clock.now();
  for (const op of ops) {
    const A = String(op?.a || '').toUpperCase();
    if (!/^[A-Z]{1,3}[1-9][0-9]{0,4}$/.test(A)) { rejected.push({ a: A, code: 'BAD_ADDR' }); continue; }
    if (!rules.editable.has(A)) { rejected.push({ a: A, code: rules.reasonFor(A) }); continue; }
    let input = normalizeInput(op.i);
    if (typeof input === 'string' && input.length > 2000) { rejected.push({ a: A, code: 'TOO_LONG' }); continue; }
    const cur = book[A];
    const curVer = cur?.v ?? 0;
    const curInput = cur?.i ?? null;
    if (!force && op.base !== undefined && op.base !== null && Number(op.base) !== curVer) {
      if (sameInput(curInput, input)) applied.push({ a: A, i: curInput, v: curVer, by: cur?.by || null });
      else conflicts.push({ a: A, i: curInput, v: curVer, by: cur?.by || null, byName: nameOf(cur?.by) });
      continue;
    }
    if (sameInput(curInput, input)) { applied.push({ a: A, i: curInput, v: curVer, by: cur?.by || null }); continue; }
    const entry = { i: input, v: curVer + 1, by: user?.id || 'system', at: now };
    putCell(comp.id, team.id, key, A, entry);
    wb.setInput(sheet, A, input);
    applied.push({ a: A, i: input, v: entry.v, by: entry.by, changed: true });
  }
  return { applied, conflicts, rejected };
}

/** 修改已寫入資料庫後，通知同隊隊友（及老師）—— 不會送到其他隊伍 */
export function broadcastOps(comp, team, user, sheet, layer, applied) {
  const ops = applied.filter((x) => x.changed).map(({ a, i, v, by }) => ({ a, i, v, by }));
  if (!ops.length) return;
  bus.emit('cells', comp.id, team.id, { sheet, layer: layer || MAIN, ops, by: user ? { id: user.id, name: nameOf(user.id) } : null, at: clock.now() });
}

function nameOf(id) {
  const u = id && db.state.users[id];
  return u ? u.name : null;
}

/** 由一個範圍複製到另一個範圍時的輸入內容（相對參照自動位移） */
export function shiftInput(input, dRow, dCol) {
  if (!isFormulaInput(input)) return input;
  try {
    return '=' + toFormulaString(shiftAst(parseFormula(input), dRow, dCol));
  } catch {
    return input;
  }
}

export function pasteOps(comp, team, sheet, layer, source, target) {
  const wb = workbookFor(comp, team, layer);
  const srcCells = expandRange(source);
  const tgtCells = expandRange(target);
  const s0 = parseAddr(srcCells[0]);
  const sEnd = parseAddr(srcCells.at(-1));
  const hgt = sEnd.row - s0.row + 1;
  const wid = sEnd.col - s0.col + 1;
  const t0 = parseAddr(tgtCells[0]);
  const srcInputs = Object.fromEntries(srcCells.map((a) => [a, wb.getInput(sheet, a)]));
  return tgtCells.map((t) => {
    const tp = parseAddr(t);
    const src = mkAddr(s0.col + ((tp.col - t0.col) % wid), s0.row + ((tp.row - t0.row) % hgt));
    const sp = parseAddr(src);
    return { a: t, i: shiftInput(srcInputs[src], tp.row - sp.row, tp.col - sp.col) };
  });
}

export function displayValue(v) {
  if (isError(v)) return v.code;
  if (typeof v === 'number') return formatNumber(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return v ?? '';
}

export function serializeValue(v) {
  if (isError(v)) return v.code;
  return v ?? null;
}

/**
 * 學生（或老師預覽）開啟工作表時的資料：
 * 原始數據、作答儲存格（連版本號）、目前可編輯範圍、各題狀態。不含參考答案或隱藏測試。
 */
export function sheetPayload(comp, team, sheet, layer = MAIN, { viewer = null } = {}) {
  const lv = levelOfSheet(comp, sheet);
  if (!lv) throw new HttpError(404, '沒有此工作表。', 'NO_SHEET');
  const ds = datasetOf(comp, team);
  const book = bookFor(comp, team, lv, layer);
  const rules = editRules(comp, team, lv.level, layer || MAIN, viewer);
  const cells = {};
  for (const [a, e] of Object.entries(book)) if (e) cells[a] = { i: e.i ?? null, v: e.v, by: e.by || null };
  return {
    sheet, layer: layer || MAIN, level: lv.level, title: lv.title,
    maxRow: lv.maxRow, maxCol: lv.maxCol,
    data: ds.levels[lv.level].data,
    cells,
    answer: lv.editable,
    editable: [...rules.editable],
    tasks: rules.tasks,
    people: Object.fromEntries(team.memberIds.map((id) => [id, nameOf(id)])),
  };
}

/** 舊介面（及老師診斷）：伺服器計算後的顯示值 */
export function legacySheetView(comp, team, sheet, layer = MAIN, viewer = null) {
  const wb = workbookFor(comp, team, layer);
  if (sheet === 'START') {
    const sh = wb.sheet('START');
    return { sheet: 'START', maxRow: sh.maxRow, maxCol: 1, editable: [], cells: Object.fromEntries([...sh.cells].map(([a, c]) => [a, { i: c.input, v: c.input }])) };
  }
  const lv = levelOfSheet(comp, sheet);
  if (!lv) throw new HttpError(404, '沒有此工作表。');
  const sh = wb.sheet(sheet);
  const rules = editRules(comp, team, lv.level, layer, viewer);
  const cells = {};
  const addrs = new Set([...sh.cells.keys(), ...lv.editable.flatMap(expandRange)]);
  for (const a of addrs) {
    const c = sh.cells.get(a);
    const v = wb.getValue(sheet, a);
    cells[a] = { i: c ? c.input : null, v: displayValue(v), e: isError(v) ? (v.detail || v.code) : undefined };
  }
  return { sheet, maxRow: sh.maxRow, maxCol: sh.maxCol, editable: lv.editable, editableNow: [...rules.editable], cells };
}

/** 提交時的快照：公式字串 + 伺服器計算的數值 */
export function readLevelSnapshot(comp, team, levelNum, layer = MAIN) {
  const lv = episodeOf(comp).levels.find((l) => l.level === levelNum);
  const wb = workbookFor(comp, team, layer);
  wb.recalc();
  const sh = wb.sheet(lv.sheet);
  const cells = {};
  const addrs = new Set([...sh.cells.keys(), ...lv.editable.flatMap(expandRange)]);
  for (const a of addrs) cells[a] = { input: wb.getInput(lv.sheet, a), value: serializeValue(wb.getValue(lv.sheet, a)) };
  return { provider: 'builtin', readAt: Date.now(), layer: layer || MAIN, cells };
}

/** 重新建立某隊的正式作答（批准數據時）：清除舊作答並放入起始內容 */
export function resetTeam(comp, team) {
  const ep = episodeOf(comp);
  for (const lv of ep.levels) {
    const book = cellBook(comp.id, team.id, lv.sheet, false);
    if (book) {
      for (const [a, e] of Object.entries(book)) if (e && e.i !== null) putCell(comp.id, team.id, lv.sheet, a, { i: null, v: (e.v || 0) + 1, by: 'system', at: clock.now() });
      const ds = datasetOf(comp, team);
      for (const [a, v] of Object.entries(ds.levels[lv.level].initial || {})) putCell(comp.id, team.id, lv.sheet, a, { i: v, v: (book[a]?.v || 0) + 1, by: 'system', at: clock.now() });
    } else mainBook(comp, team, lv);
  }
  wbCache.delete(cacheKey(comp, team, MAIN));
}

/**
 * 舊版資料轉移：舊版把整隊的作答存成一個紀錄（demoSheets）。啟動時把仍未轉移的作答轉為逐格儲存。
 * 舊紀錄保留不刪除（只讀），轉移可重複執行而不會重複寫入。
 */
export function migrateLegacySheets() {
  let moved = 0;
  for (const [compId, teams] of Object.entries(db.state.demoSheets || {})) {
    const comp = db.state.competitions[compId];
    if (!comp || comp.cellsMigratedAt) continue;
    for (const [teamId, sheets] of Object.entries(teams || {})) {
      for (const [sheet, inputs] of Object.entries(sheets || {})) {
        if (cellBook(compId, teamId, sheet, false)) continue;
        cellBook(compId, teamId, sheet);
        for (const [a, i] of Object.entries(inputs || {})) {
          putCell(compId, teamId, sheet, a, { i, v: 1, by: 'migration', at: clock.now() });
          moved++;
        }
      }
    }
    comp.cellsMigratedAt = clock.now();
  }
  return moved;
}
