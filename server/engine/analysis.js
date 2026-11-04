// 試算表分析工具（第三集）：排序、篩選、樞紐分析表、圖表數據、分析藍本（Scenario）。
// 瀏覽器（/engine/analysis.js）與伺服器批改共用同一份程式，結果一定一致。
// 這些設定以「中繼資料」（例如 '!SORT'）存於每隊的工作表，與儲存格一樣有版本號、存於資料庫、即時同步。
import { colToIndex, indexToCol } from './refs.js';
import { isError } from './values.js';

export const META = { SORT: '!SORT', FILTER: '!FILTER', CHARTS: '!CHARTS', PIVOTS: '!PIVOTS', SCEN: '!SCEN' };
export const META_KEYS = Object.values(META);
export const isMetaKey = (a) => typeof a === 'string' && a.startsWith('!');

export const CHART_TYPES = ['column', 'bar', 'line', 'pie', 'scatter'];
export const AGGS = ['SUM', 'COUNT', 'AVERAGE', 'MAX', 'MIN'];
const LIMITS = { sortOps: 30, charts: 4, pivots: 4, scenarios: 6, filterValues: 80 };

const A = (c, r) => `${indexToCol(c)}${r}`;
export function parseRange(spec) {
  const m = /^\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?$/i.exec(String(spec || '').trim());
  if (!m) return null;
  const c1 = colToIndex(m[1].toUpperCase()); const r1 = Number(m[2]);
  const c2 = m[3] ? colToIndex(m[3].toUpperCase()) : c1; const r2 = m[4] ? Number(m[4]) : r1;
  return { c1: Math.min(c1, c2), r1: Math.min(r1, r2), c2: Math.max(c1, c2), r2: Math.max(r1, r2) };
}
const rangeSpec = (g) => `${A(g.c1, g.r1)}:${A(g.c2, g.r2)}`;
const inside = (outer, inner) => inner.c1 >= outer.c1 && inner.c2 <= outer.c2 && inner.r1 >= outer.r1 && inner.r2 <= outer.r2;

// ---------------------------------------------------------------- 比較（與試算表相同：數字 < 文字 < 布林；空白永遠排最後）
const blank = (v) => v === null || v === undefined || v === '';
function typeRank(v) { return typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : typeof v === 'boolean' ? 2 : 3; }
export function sortCompare(a, b) {
  const ta = typeRank(a); const tb = typeRank(b);
  if (ta !== tb) return ta - tb;
  if (typeof a === 'number') return a - b;
  if (typeof a === 'string') { const x = a.toUpperCase(); const y = b.toUpperCase(); return x < y ? -1 : x > y ? 1 : 0; }
  if (typeof a === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0);
  return 0;
}
function keyCompare(a, b, dir) {
  // 空白在升序及降序都排最後（試算表的做法）
  if (blank(a) || blank(b)) return blank(a) && blank(b) ? 0 : blank(a) ? 1 : -1;
  const c = sortCompare(a, b);
  return dir === 'desc' ? -c : c;
}

// ---------------------------------------------------------------- 排序
/**
 * 把排序紀錄（由原始數據開始逐次重做）套用到數據。
 * data：{ A1: 值 }（原始數據）；table：表格範圍（第一列是標題）；sortMeta：{ ops: [...] }
 * 每次排序 { keys: [{ col: 'H', dir: 'desc' }], cols?: ['F'] }：
 *   沒有 cols ＝ 整個表格（整列一起移動，資料列保持完整）
 *   有 cols   ＝ 只排序選取的欄（常見錯誤：其他欄不動，資料列會被拆散）
 * 排序是穩定的：先按次要欄、再按主要欄排序，結果與一次多欄排序相同。
 */
export function applySorts(data, table, sortMeta) {
  const ops = sortMeta?.ops || [];
  if (!ops.length) return data;
  const g = parseRange(table);
  const out = { ...data };
  for (const op of ops) {
    const cols = op.cols?.length ? op.cols.map(colToIndex) : range(g.c1, g.c2);
    const rows = range(g.r1 + 1, g.r2).map((r) => ({ r, vals: Object.fromEntries(cols.map((c) => [c, out[A(c, r)] ?? null])) }));
    const keys = op.keys.map((k) => ({ c: colToIndex(k.col), dir: k.dir }));
    const sorted = rows.map((x, i) => ({ ...x, i })).sort((x, y) => {
      for (const k of keys) { const c = keyCompare(x.vals[k.c], y.vals[k.c], k.dir); if (c) return c; }
      return x.i - y.i;
    });
    sorted.forEach((src, i) => {
      const r = g.r1 + 1 + i;
      for (const c of cols) { const v = src.vals[c]; if (v === null || v === undefined) delete out[A(c, r)]; else out[A(c, r)] = v; }
    });
  }
  return out;
}

function range(a, b) { return Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i); }

/** 表格的數據列（每列是 { 欄號: 值 }） */
export function tableRows(get, table) {
  const g = parseRange(table);
  return range(g.r1 + 1, g.r2).map((r) => Object.fromEntries(range(g.c1, g.c2).map((c) => [c, get(c, r)])));
}

/** 表格的標題（欄號 → 標題文字） */
export function tableHeaders(get, table) {
  const g = parseRange(table);
  return Object.fromEntries(range(g.c1, g.c2).map((c) => [c, String(get(c, g.r1) ?? indexToCol(c))]));
}

/** 資料列是否按 keys 排列（批改用） */
export function isSortedBy(rows, keys) {
  for (let i = 1; i < rows.length; i++) {
    for (const k of keys) {
      const c = keyCompare(rows[i - 1][k.c], rows[i][k.c], k.dir);
      if (c < 0) break;
      if (c > 0) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------- 篩選
/**
 * 篩選：不刪除任何資料，只隱藏不符合條件的列。多欄條件同時成立（AND）。
 * crit[欄] = { values?: [可顯示的值], op?, value?, op2?, value2?, join?: 'and'|'or' }
 */
export function filterHiddenRows(get, table, filterMeta) {
  const hidden = new Set();
  const crit = filterMeta?.crit || {};
  const cols = Object.keys(crit);
  if (!cols.length) return hidden;
  const g = parseRange(table);
  const tests = cols.map((col) => ({ c: colToIndex(col), t: makeColumnTest(crit[col]) }));
  for (let r = g.r1 + 1; r <= g.r2; r++) if (!tests.every(({ c, t }) => t(get(c, r)))) hidden.add(r);
  return hidden;
}

const valueKey = (v) => (blank(v) ? '' : typeof v === 'number' ? String(+v.toPrecision(12)) : String(v));

function condTest(op, value) {
  if (!op) return () => true;
  const num = value !== '' && value !== null && Number.isFinite(Number(value)) ? Number(value) : null;
  const text = String(value ?? '').toUpperCase();
  return (v) => {
    if (op === 'contains') return typeof v === 'string' && v.toUpperCase().includes(text);
    if (op === 'begins') return typeof v === 'string' && v.toUpperCase().startsWith(text);
    let c;
    if (num !== null && typeof v === 'number') c = v - num;
    else if (num === null && typeof v === 'string') c = v.toUpperCase() < text ? -1 : v.toUpperCase() > text ? 1 : 0;
    else return op === '<>';
    return { '=': c === 0, '<>': c !== 0, '>': c > 0, '>=': c >= 0, '<': c < 0, '<=': c <= 0 }[op] ?? false;
  };
}

function makeColumnTest(cr) {
  const set = Array.isArray(cr?.values) ? new Set(cr.values.map(valueKey)) : null;
  const t1 = condTest(cr?.op, cr?.value);
  const t2 = cr?.op2 ? condTest(cr.op2, cr.value2) : null;
  return (v) => {
    if (set && !set.has(valueKey(v))) return false;
    if (!cr?.op) return true;
    return t2 ? (cr.join === 'or' ? t1(v) || t2(v) : t1(v) && t2(v)) : t1(v);
  };
}

export function distinctValues(get, table, col) {
  const g = parseRange(table);
  const c = colToIndex(col);
  const seen = new Map();
  for (let r = g.r1 + 1; r <= g.r2; r++) { const v = get(c, r); const k = valueKey(v); if (!seen.has(k)) seen.set(k, v); }
  return [...seen.values()].sort((a, b) => keyCompare(a, b, 'asc'));
}

// ---------------------------------------------------------------- 樞紐分析表
/**
 * cfg: { id, source: 'A1:G241', rows: [欄名], cols: [欄名], values: [{ field, agg }], filters: [{ field, values: [...] }] }
 * 回傳 { rowKeys, colKeys, cells: Map('列鍵|欄鍵' → 值), rowTotal, colTotal, grand, field, agg } 或 { error }
 */
export function computePivot(get, cfg) {
  const g = parseRange(cfg?.source);
  if (!g) return { error: '來源範圍不正確' };
  const headers = {};
  for (let c = g.c1; c <= g.c2; c++) headers[String(get(c, g.r1) ?? '').trim().toUpperCase()] = c;
  const col = (f) => headers[String(f || '').trim().toUpperCase()];
  const rowF = cfg.rows?.[0]; const colF = cfg.cols?.[0]; const val = cfg.values?.[0];
  if (!val) return { error: '請在「值」加入一個欄位' };
  for (const f of [rowF, colF, val.field, ...(cfg.filters || []).map((x) => x.field)].filter(Boolean)) if (!col(f)) return { error: `來源沒有欄位 ${f}` };
  const filters = (cfg.filters || []).filter((f) => Array.isArray(f.values) && f.values.length).map((f) => ({ c: col(f.field), set: new Set(f.values.map(valueKey)) }));
  const agg = AGGS.includes(val.agg) ? val.agg : 'SUM';
  const buckets = new Map();
  const add = (k, v) => { if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(v); };
  const rk = new Map(); const ck = new Map();
  for (let r = g.r1 + 1; r <= g.r2; r++) {
    if (filters.some((f) => !f.set.has(valueKey(get(f.c, r))))) continue;
    const rv = rowF ? get(col(rowF), r) : null;
    const cv = colF ? get(col(colF), r) : null;
    if (rowF && blank(rv)) continue;
    const v = get(col(val.field), r);
    const R = rowF ? valueKey(rv) : '總計'; const C = colF ? valueKey(cv) : '';
    if (!rk.has(R)) rk.set(R, rv ?? R);
    if (colF && !ck.has(C)) ck.set(C, cv);
    for (const key of [`${R}|${C}`, `${R}|*`, `*|${C}`, '*|*']) add(key, v);
  }
  const reduce = (list) => {
    if (!list) return null;
    const nums = list.filter((x) => typeof x === 'number');
    if (agg === 'COUNT') return list.filter((x) => !blank(x) && !isError(x)).length;
    if (agg === 'SUM') return nums.reduce((a, b) => a + b, 0);
    if (!nums.length) return null;
    if (agg === 'AVERAGE') return nums.reduce((a, b) => a + b, 0) / nums.length;
    return agg === 'MAX' ? Math.max(...nums) : Math.min(...nums);
  };
  const order = (m) => [...m.entries()].sort((a, b) => keyCompare(a[1], b[1], 'asc')).map(([k]) => k);
  const rowKeys = order(rk); const colKeys = colF ? order(ck) : [''];
  const cells = new Map();
  for (const R of rowKeys) for (const C of colKeys) cells.set(`${R}|${C}`, reduce(buckets.get(`${R}|${C}`)));
  return {
    rowKeys, colKeys, cells, field: val.field, agg, rowField: rowF || null, colField: colF || null,
    labels: { rows: Object.fromEntries(rk), cols: Object.fromEntries(ck) },
    rowTotal: Object.fromEntries(rowKeys.map((R) => [R, reduce(buckets.get(`${R}|*`))])),
    colTotal: Object.fromEntries(colKeys.map((C) => [C, reduce(buckets.get(`*|${C}`))])),
    grand: reduce(buckets.get('*|*')),
  };
}

/** 樞紐分析表結果轉為 { '列|欄': 值 }（批改比較用；可選擇轉置） */
export function pivotMap(p, transpose = false) {
  const out = {};
  if (!p || p.error) return out;
  for (const [k, v] of p.cells) {
    if (v === null) continue;
    const [R, C] = k.split('|');
    out[transpose ? `${C}|${R}` : k] = typeof v === 'number' ? +v.toPrecision(10) : v;
  }
  return out;
}

// ---------------------------------------------------------------- 圖表
/** 圖表的類別及數列（直接由工作表或樞紐分析表取得，數據改變時自動更新） */
export function chartData(get, cfg, pivotsById = {}) {
  if (cfg?.source?.pivot) {
    const p = pivotsById[cfg.source.pivot];
    if (!p || p.error) return { error: '找不到樞紐分析表' };
    const cats = p.rowKeys.map((k) => p.labels.rows[k] ?? k);
    const series = p.colKeys.map((C) => ({ name: C === '' ? `${p.agg} of ${p.field}` : String(p.labels.cols[C] ?? C), values: p.rowKeys.map((R) => p.cells.get(`${R}|${C}`)) }));
    return { categories: cats, series };
  }
  const cg = cfg?.cats ? parseRange(cfg.cats) : null;
  const series = (cfg?.series || []).map((s) => {
    const g = parseRange(s.ref);
    if (!g) return { name: s.name || '', values: [] };
    const vals = [];
    for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) vals.push(get(c, r));
    return { name: s.name || '', values: vals.map((v) => (typeof v === 'number' ? v : null)), raw: vals };
  });
  const n = Math.max(0, ...series.map((s) => s.values.length));
  let categories = [];
  if (cg) { for (let r = cg.r1; r <= cg.r2; r++) for (let c = cg.c1; c <= cg.c2; c++) categories.push(get(c, r)); } else categories = range(1, n);
  return { categories: categories.map((v) => (blank(v) ? '' : v)), series };
}

// ---------------------------------------------------------------- 分析藍本（What-if）
/**
 * scen: { changing: ['B3'], result: ['H2'], list: [{ name, values: { B3: 10 } }] }
 * 逐個藍本代入「變數儲存格」，讀取「結果儲存格」，然後還原（不改變工作表）。
 */
export function scenarioSummary(wb, sheet, scen) {
  const changing = scen?.changing || []; const result = scen?.result || [];
  const original = Object.fromEntries(changing.map((a) => [a, wb.getInput(sheet, a)]));
  const rows = [];
  const read = () => Object.fromEntries(result.map((a) => [a, wb.getValue(sheet, a)]));
  rows.push({ name: '目前數值', values: { ...original }, results: read(), current: true });
  for (const s of scen?.list || []) {
    for (const a of changing) wb.setInput(sheet, a, s.values?.[a] ?? original[a]);
    rows.push({ name: s.name, values: { ...s.values }, results: read() });
  }
  for (const a of changing) wb.setInput(sheet, a, original[a]);
  return rows;
}

/**
 * 目標搜尋（Goal Seek）：改變一個變數儲存格，找出令目標儲存格「剛好達到」指定值的最小數值。
 * 支援連續數值（二分法逼近）及整數的階梯函數（例如計數）。找不到時回傳 null。不會改變工作表。
 */
export function goalSeek(wb, sheet, target, goal, changing, { lo = 0, hi = 1000, integer = false } = {}) {
  const original = wb.getInput(sheet, changing);
  const f = (x) => { wb.setInput(sheet, changing, x); const v = wb.getValue(sheet, target); return typeof v === 'number' ? v - goal : NaN; };
  const sgn = (x) => (Math.abs(x) < 1e-9 ? 0 : Math.sign(x));
  let result = null;
  try {
    const s0 = sgn(f(lo));
    if (Number.isNaN(s0)) return null;
    if (s0 === 0) { result = lo; return result; }
    const sh = sgn(f(hi));
    if (Number.isNaN(sh) || (sh === s0)) return null;
    let a = lo; let b = hi; // f(a) 與 s0 同號；f(b) 已達到或越過目標
    for (let i = 0; i < 200; i++) {
      if (integer ? b - a <= 1 : b - a < 1e-7) break;
      const m = integer ? Math.floor((a + b) / 2) : (a + b) / 2;
      if (sgn(f(m)) === s0) a = m; else b = m;
    }
    result = integer ? b : +b.toFixed(6);
    return result;
  } finally {
    wb.setInput(sheet, changing, original);
  }
}

// ---------------------------------------------------------------- 工作簿
/**
 * 把一關的所有工作表放入工作簿：原始數據（按排序紀錄重排）、額外工作表、學生作答，並按篩選設定隱藏列。
 * 伺服器（學生工作簿、批改）及瀏覽器使用相同的規則。
 */
export function loadLevelIntoWorkbook(wb, lv, levelData, inputs, meta = {}) {
  wb.addSheet(lv.sheet, lv.maxRow, lv.maxCol);
  const table = lv.tools?.table;
  const data = table ? applySorts(levelData.data, table, meta[META.SORT]) : levelData.data;
  for (const [a, v] of Object.entries(data)) wb.setInput(lv.sheet, a, v);
  for (const x of lv.extraSheets || []) {
    wb.addSheet(x.sheet, x.maxRow, x.maxCol);
    for (const [a, v] of Object.entries(levelData.extra?.[x.sheet] || {})) wb.setInput(x.sheet, a, v);
  }
  for (const [a, i] of Object.entries(inputs || {})) if (!isMetaKey(a) && i !== null && i !== undefined && !(a in data)) wb.setInput(lv.sheet, a, i);
  if (table && meta[META.FILTER]) {
    wb.hiddenRows ??= new Map();
    wb.hiddenRows.set(lv.sheet, filterHiddenRows((c, r) => wb.valueAt(lv.sheet, c, r), table, meta[META.FILTER]));
  } else wb.hiddenRows?.delete(lv.sheet);
  return wb;
}

// ---------------------------------------------------------------- 驗證（伺服器接收學生設定時）
const cleanText = (s, n = 60) => String(s ?? '').replace(/[\u0000-\u001F]/g, '').slice(0, n);
const COL = /^[A-Z]{1,3}$/;
const ADDR = /^[A-Z]{1,3}[1-9][0-9]{0,4}$/;

/**
 * 檢查並整理學生送出的分析設定。tools：該關可用的工具及範圍 { table, sortable, pivotSource, changing, results }。
 * 不符合時拋出 { message }。
 */
export function sanitizeMeta(key, v, tools = {}) {
  if (v === null || v === undefined) return null;
  const fail = (m) => { const e = new Error(m); e.code = 'BAD_META'; throw e; };
  const table = tools.table ? parseRange(tools.table) : null;
  const colOk = (c) => COL.test(c) && table && colToIndex(c) >= table.c1 && colToIndex(c) <= table.c2;
  switch (key) {
    case META.SORT: {
      if (!table || !tools.sort) fail('這一關不能排序。');
      const ops = (v.ops || []).slice(-LIMITS.sortOps).map((op) => {
        const keys = (op.keys || []).slice(0, 3).map((k) => ({ col: String(k.col || '').toUpperCase(), dir: k.dir === 'desc' ? 'desc' : 'asc' }));
        if (!keys.length || !keys.every((k) => colOk(k.col))) fail('排序欄位不正確。');
        const cols = op.cols ? [...new Set(op.cols.map((c) => String(c).toUpperCase()))] : null;
        if (cols && (!cols.every(colOk) || !keys.every((k) => cols.includes(k.col)))) fail('排序範圍不正確。');
        return cols ? { keys, cols } : { keys };
      });
      return { ops };
    }
    case META.FILTER: {
      if (!table || !tools.filter) fail('這一關不能篩選。');
      const crit = {};
      for (const [c, cr] of Object.entries(v.crit || {}).slice(0, 8)) {
        const col = c.toUpperCase();
        if (!colOk(col)) fail('篩選欄位不正確。');
        const out = {};
        if (Array.isArray(cr.values)) out.values = cr.values.slice(0, LIMITS.filterValues).map((x) => (typeof x === 'number' ? x : cleanText(x)));
        const ops = ['=', '<>', '>', '>=', '<', '<=', 'contains', 'begins'];
        if (cr.op) { if (!ops.includes(cr.op)) fail('篩選條件不正確。'); out.op = cr.op; out.value = typeof cr.value === 'number' ? cr.value : cleanText(cr.value); }
        if (cr.op2) { if (!ops.includes(cr.op2)) fail('篩選條件不正確。'); out.op2 = cr.op2; out.value2 = typeof cr.value2 === 'number' ? cr.value2 : cleanText(cr.value2); out.join = cr.join === 'or' ? 'or' : 'and'; }
        if (out.values || out.op) crit[col] = out;
      }
      return { crit };
    }
    case META.CHARTS: {
      if (!tools.chart) fail('這一關不能建立圖表。');
      const list = (Array.isArray(v) ? v : []).slice(0, LIMITS.charts).map((c, i) => {
        const type = CHART_TYPES.includes(c.type) ? c.type : fail('圖表類型不正確。');
        const out = { id: cleanText(c.id || `C${i + 1}`, 8), type, title: cleanText(c.title, 60), xTitle: cleanText(c.xTitle, 40), yTitle: cleanText(c.yTitle, 40), legend: !!c.legend };
        if (c.source?.pivot) out.source = { pivot: cleanText(c.source.pivot, 8) };
        else {
          if (c.cats && !parseRange(c.cats)) fail('類別範圍不正確。');
          out.cats = c.cats ? rangeSpec(parseRange(c.cats)) : null;
          out.series = (c.series || []).slice(0, 4).map((s) => { const g = parseRange(s.ref); if (!g) fail('數列範圍不正確。'); return { name: cleanText(s.name, 30), ref: rangeSpec(g) }; });
          if (!out.series.length) fail('圖表最少需要一個數列。');
        }
        return out;
      });
      return list;
    }
    case META.PIVOTS: {
      if (!tools.pivot) fail('這一關不能建立樞紐分析表。');
      return (Array.isArray(v) ? v : []).slice(0, LIMITS.pivots).map((p, i) => ({
        id: cleanText(p.id || `P${i + 1}`, 8),
        source: tools.pivotSource,
        rows: (p.rows || []).slice(0, 1).map((f) => cleanText(f, 30)),
        cols: (p.cols || []).slice(0, 1).map((f) => cleanText(f, 30)),
        values: (p.values || []).slice(0, 1).map((x) => ({ field: cleanText(x.field, 30), agg: AGGS.includes(x.agg) ? x.agg : 'SUM' })),
        filters: (p.filters || []).slice(0, 2).map((f) => ({ field: cleanText(f.field, 30), values: (f.values || []).slice(0, LIMITS.filterValues).map((x) => (typeof x === 'number' ? x : cleanText(x))) })),
      }));
    }
    case META.SCEN: {
      if (!tools.scenario) fail('這一關不能使用分析藍本。');
      const changing = (tools.changing || []);
      const result = (v.result || []).map((a) => String(a).toUpperCase()).filter((a) => ADDR.test(a)).slice(0, 4);
      const list = (v.list || []).slice(0, LIMITS.scenarios).map((s) => ({
        name: cleanText(s.name, 24) || '藍本',
        values: Object.fromEntries(changing.map((a) => [a, typeof s.values?.[a] === 'number' && Number.isFinite(s.values[a]) ? s.values[a] : Number(s.values?.[a]) || 0])),
      }));
      return { changing, result, list };
    }
    default: fail('未知的設定。');
  }
  return null;
}
