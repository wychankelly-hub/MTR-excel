// 第三集 Formula & Operation Validation：排序、篩選、多工作表、圖表、樞紐分析表、假設分析。
// 原則：檢查學生工作表的「實際狀態」（排序後的資料列是否完整、可見的資料列、圖表數據、樞紐分析結果、藍本），
// 再把學生的設定套用到隱藏測試數據重做一次，找出只碰巧正確或寫死數值的答案。單純按過某個工具不會得分。
import {
  GradeContext, analyzeInput, issueOf, findFuncs, collectCellRefs, collectLiterals, walk, rangeIs, rangeRowsAbsolute, rowsOf, unwrap,
} from '../episodes/grading-kit.js';
import { isError, valuesEqual } from '../engine/values.js';
import { expandRange, parseAddr } from '../engine/refs.js';
import { META, isMetaKey, tableRows, isSortedBy, computePivot, pivotMap, parseRange } from '../engine/analysis.js';
import { LEVEL_BY_NUM, TASK_BY_ID, VALIDATOR_VERSION } from './blueprint.js';
import { buildLevelWorkbook, solveReference } from './generator.js';
import { renderError } from './feedback.js';

const col = (letter) => [...letter].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);

/** 第三集的批改情境：分析設定使用學生自己的設定；預期答案按該題的參考設定計算 */
class E3Context extends GradeContext {
  constructor(opts) {
    super(opts);
    this.refCache = {};
  }

  answers() {
    const a = { ...this.lv.referenceFormulas };
    for (const [k, v] of Object.entries(this.inputs)) if (isMetaKey(k)) a[k] = v;
    for (const c of this.taskCells) a[c] = this.inputs[c] ?? null;
    return a;
  }

  meta(k) { return this.inputs[k] ?? null; }

  expected(kind, a) {
    if (!this.refCache[kind]) this.refCache[kind] = solveReference(this.levelData(kind), this.level, this.task.id);
    return this.refCache[kind][a];
  }

  /** 以指定的儲存格覆蓋（例如假設 B3 = 30）建立工作簿：學生版本及參考版本 */
  variant(kind, overrides, { reference = false } = {}) {
    const base = reference ? { ...this.lv.referenceFormulas } : this.answers();
    return buildLevelWorkbook(this.levelData(kind), this.level, { ...base, ...overrides });
  }

  get(kind, c, r) { return this.wb(kind).valueAt(this.lv.sheet, c, r); }
}

const rowKey = (row) => JSON.stringify(Object.values(row));
const sameRows = (a, b) => JSON.stringify(a.map(rowKey).sort()) === JSON.stringify(b.map(rowKey).sort());

/** 排序檢查：資料列完整、按 keys 排列（本隊數據及隱藏測試） */
function checkSort(g, keys, keyLabel) {
  const table = g.lv.tools.table;
  const sort = g.meta(META.SORT);
  if (!sort?.ops?.length) { g.err('NOT_SORTED', g.task.focus); return false; }
  for (const kind of ['team', 'hidden']) {
    const base = buildLevelWorkbook(g.levelData(kind), g.level, {});
    const orig = tableRows((c, r) => base.valueAt(g.lv.sheet, c, r), table);
    const now = tableRows((c, r) => g.get(kind, c, r), table);
    if (!sameRows(orig, now)) { g.err('ROWS_BROKEN', table); return false; }
    if (!isSortedBy(now, keys.map((k) => ({ c: col(k.col), dir: k.dir })))) {
      if (kind === 'team') {
        const first = keys[0];
        if (isSortedBy(now, [{ c: col(first.col), dir: first.dir === 'asc' ? 'desc' : 'asc' }])) g.err('SORT_DIRECTION', first.col, keyLabel);
        else if (!isSortedBy(now, [{ c: col(first.col), dir: first.dir }])) g.err('SORT_KEY_WRONG', first.col, keyLabel);
        else g.err('SORT_LEVELS', g.task.focus, keyLabel);
      } else g.err('SORT_LEVELS', g.task.focus, keyLabel);
      return false;
    }
  }
  return true;
}

/** 公式答案：必須是公式（或指定時可以是文字），本隊及隱藏數據都正確 */
function formulaAnswer(g, a, { allowConstant = false, needFns = null } = {}) {
  const info = g.info(a);
  if (allowConstant && info.kind === 'constant') {
    if (valuesEqual(info.value, g.expected('team', a)) || String(info.value).trim().toUpperCase() === String(g.expected('team', a)).toUpperCase()) return true;
    g.err('VALUE_WRONG', a);
    return false;
  }
  if (!g.checkBasic(a)) return false;
  if (needFns && !needFns.some((f) => info.fns.has(f))) { g.err('FUNCTION_REQUIRED', a, needFns.join(' / ')); return false; }
  const ok = g.ok('team', a) && g.ok('hidden', a);
  if (!ok) g.explainValue(a);
  return ok;
}

const refsSheet = (ast, sheet) => { let hit = false; walk(ast, (n) => { if ((n.type === 'ref' || n.type === 'range') && n.sheet === sheet) hit = true; }); return hit; };

// ---------------------------------------------------------------- 圖表
function chartIssues(c, req) {
  const issues = [];
  const cats = c.cats ? parseRange(c.cats) : null;
  if (c.source?.pivot) return { score: 0, issues: ['CHART_SOURCE'] };
  if (!req.types.includes(c.type)) issues.push(req.typeCode);
  if (!cats) issues.push('CATS_MISSING');
  else if (cats.r1 === 1) issues.push('HEADER_IN_DATA');
  else if (!(cats.c1 === 1 && cats.r1 === 2 && cats.r2 === 19)) issues.push('CATS_WRONG');
  const refs = (c.series || []).map((s) => parseRange(s.ref));
  if (refs.some((r) => r && r.c1 === 1)) issues.push('HOUR_AS_SERIES');
  if (refs.some((r) => r && r.r1 === 1)) issues.push('HEADER_IN_DATA');
  const want = req.series.map((x) => col(x));
  const have = refs.filter(Boolean).map((r) => (r.c1 === r.c2 && r.r1 === 2 && r.r2 === 19 ? r.c1 : -1));
  const okSeries = want.every((w) => have.includes(w)) && have.every((h) => want.includes(h));
  if (!okSeries) issues.push('SERIES_WRONG');
  return { issues: [...new Set(issues)], dataOk: !issues.length };
}

function bestChart(g, req) {
  const charts = g.meta(META.CHARTS) || [];
  if (!charts.length) { g.err('NO_CHART', g.task.focus); return null; }
  const ranked = charts.map((c) => ({ c, ...chartIssues(c, req) })).sort((x, y) => x.issues.length - y.issues.length);
  return ranked[0];
}

// ---------------------------------------------------------------- 樞紐分析表
function pivotOn(g, kind, cfg) {
  return computePivot((c, r) => g.get(kind, c, r), { ...cfg, source: g.lv.tools.pivotSource });
}

function mapsEqual(a, b) {
  const ka = Object.keys(a).sort(); const kb = Object.keys(b).sort();
  if (ka.join('|') !== kb.join('|')) return false;
  return ka.every((k) => valuesEqual(a[k], b[k], 1e-6));
}

/** 找出與參考結果相同的樞紐分析表（本隊及隱藏數據）；allowTranspose：列與欄對調亦接受 */
function matchPivot(g, refCfg, { allowTranspose = false } = {}) {
  const pivots = g.meta(META.PIVOTS) || [];
  if (!pivots.length) { g.err('PIVOT_MISSING', g.task.focus); return null; }
  const expTeam = pivotMap(pivotOn(g, 'team', refCfg));
  const expHidden = pivotMap(pivotOn(g, 'hidden', refCfg));
  for (const p of pivots) {
    for (const tr of allowTranspose ? [false, true] : [false]) {
      if (mapsEqual(pivotMap(pivotOn(g, 'team', p), tr), expTeam) && mapsEqual(pivotMap(pivotOn(g, 'hidden', p), tr), expHidden)) return p;
    }
  }
  // 解釋最接近的一個
  const p = pivots.at(-1);
  const norm = (x) => String(x || '').toUpperCase();
  const rf = refCfg.rows[0]; const cf = refCfg.cols[0]; const v = refCfg.values[0];
  const fields = [p.rows?.[0], p.cols?.[0]].map(norm);
  if (!fields.includes(norm(rf)) || (cf && !fields.includes(norm(cf)))) g.err('PIVOT_FIELDS', g.task.focus, [rf, cf].filter(Boolean).join(' × '));
  else if ((p.values?.[0]?.agg || '') !== v.agg && !(v.agg === 'COUNT' && p.values?.[0]?.agg === 'COUNT')) g.err('PIVOT_AGG', g.task.focus, v.agg);
  else if (v.agg !== 'COUNT' && norm(p.values?.[0]?.field) !== norm(v.field)) g.err('PIVOT_VALUE_FIELD', g.task.focus, v.field);
  else if (refCfg.filters.length && !(p.filters || []).length) g.err('PIVOT_FILTER_MISSING', g.task.focus, `${refCfg.filters[0].field} = ${refCfg.filters[0].values.join('、')}`);
  else if (!refCfg.filters.length && (p.filters || []).length) g.err('PIVOT_FILTER_EXTRA', g.task.focus);
  else g.err('PIVOT_FILTER_WRONG', g.task.focus);
  return null;
}

function typedAnswer(g, a, expected) {
  const info = g.info(a);
  if (info.kind === 'empty') { g.err('EMPTY', a); return false; }
  const v = info.kind === 'formula' ? g.val('team', a) : info.value;
  const ok = valuesEqual(v, expected) || String(v ?? '').trim().toUpperCase() === String(expected ?? '').toUpperCase();
  if (!ok) g.err('VALUE_WRONG', a);
  return ok;
}

// ---------------------------------------------------------------- 各題
const VALIDATORS = {
  // L1 排序及篩選
  'E3-L1-T1'(g) {
    g.award('a', checkSort(g, [{ col: 'H', dir: 'desc' }], 'WaitMin 由大至小'));
    const b2 = formulaAnswer(g, 'J2');
    const b3 = formulaAnswer(g, 'J3');
    g.award('b', b2 && b3);
  },
  'E3-L1-T2'(g) {
    g.award('a', checkSort(g, [{ col: 'E', dir: 'asc' }, { col: 'F', dir: 'desc' }, { col: 'B', dir: 'asc' }], 'Category ↑、Severity ↓、Time ↑'));
    const info = g.info('J4');
    if (info.kind === 'constant' && typeof info.value === 'string') { g.err('HARDCODED_TEXT', 'J4'); g.award('b', false); return; }
    g.award('b', formulaAnswer(g, 'J4', { needFns: ['XLOOKUP', 'INDEX', 'MATCH'] }));
  },
  'E3-L1-T3'(g) {
    const f = g.meta(META.FILTER);
    const table = g.lv.tools.table;
    let a = false;
    if (!f || !Object.keys(f.crit || {}).length) g.err('NOT_FILTERED', 'G1');
    else {
      a = true;
      for (const kind of ['team', 'hidden']) {
        const wb = g.wb(kind);
        const hidden = wb.hiddenRows?.get(g.lv.sheet) || new Set();
        const tr = parseRange(table);
        const visible = []; const wantUncle = []; const wantData = []; const want = [];
        for (let r = tr.r1 + 1; r <= tr.r2; r++) {
          const id = wb.valueAt(g.lv.sheet, 1, r); const cat = wb.valueAt(g.lv.sheet, 5, r); const caller = wb.valueAt(g.lv.sheet, 7, r);
          if (!hidden.has(r)) visible.push(id);
          if (caller === 'UNCLE-WONG') wantUncle.push(id);
          if (cat === 'DATA') wantData.push(id);
          if (caller === 'UNCLE-WONG' && cat === 'DATA') want.push(id);
        }
        const same = (x, y) => x.length === y.length && x.every((v) => y.includes(v));
        if (!same(visible, want)) {
          if (kind === 'team' && (same(visible, wantUncle) || same(visible, wantData))) g.err('FILTER_ONE_CONDITION', 'G1');
          else if (kind === 'team') g.err('FILTER_WRONG', 'G1');
          else g.err('FILTER_HARDCODED', 'G1');
          a = false;
          break;
        }
      }
    }
    g.award('a', a);
    for (const [cell, mp, total] of [['J5', 'b', 120], ['J6', 'c', null]]) {
      const info = g.info(cell);
      if (!g.checkBasic(cell)) { g.award(mp, false); continue; }
      const ok = g.ok('team', cell) && g.ok('hidden', cell);
      if (!ok) {
        const v = g.val('team', cell);
        const sumAll = (() => { let s = 0; for (let r = 2; r <= 121; r++) s += g.levelData('team').data[`H${r}`]; return s; })();
        if ((total !== null && v === total) || (total === null && v === sumAll)) g.err('SUBTOTAL_NEEDED', cell);
        else g.explainValue(cell);
      }
      void info;
      g.award(mp, ok && a);
    }
  },

  // L2 多工作表
  'E3-L2-T1'(g) {
    let a = false;
    if (g.checkBasic('B2')) {
      const { ast } = g.info('B2');
      if (!refsSheet(ast, 'E3L2_Timetable')) g.err('CROSS_SHEET_REQUIRED', 'B2', 'E3L2_Timetable');
      else { a = g.ok('team', 'B2') && g.ok('hidden', 'B2'); if (!a) g.explainValue('B2'); }
    }
    g.award('a', a);
    g.award('b', g.checkRows(rowsOf('B', 3, 41)) && a);
  },
  'E3-L2-T2'(g) {
    let a = false; let f = null;
    if (g.checkBasic('C2')) {
      const { ast } = g.info('C2');
      f = findFuncs(ast, 'XLOOKUP')[0];
      if (!f) g.err('XLOOKUP_REQUIRED', 'C2');
      else if (!refsSheet(f.args[1], 'E3L2_Log') || !refsSheet(f.args[2], 'E3L2_Log')) g.err('LOOKUP_SHEET', 'C2', 'E3L2_Log');
      else { a = g.ok('team', 'C2') && g.ok('hidden', 'C2'); if (!a) g.explainValue('C2'); }
    }
    g.award('a', a);
    const rows = rowsOf('C', 2, 41);
    const b = rows.every((x) => g.good(x));
    if (!b && f) {
      if (f.args.length < 4) g.err('NOT_FOUND_MISSING', 'C2', 'MISSING');
      else if (unwrap(f.args[3])?.type === 'str' && unwrap(f.args[3]).value !== 'MISSING') g.err('NOT_FOUND_TEXT', 'C2', 'MISSING');
      else if (!rangeRowsAbsolute(f.args[1]) || !rangeRowsAbsolute(f.args[2])) g.err('RANGE_NOT_ABSOLUTE', 'C2');
      else g.checkRows(rows.slice(1));
    }
    g.award('b', b && a);
  },
  'E3-L2-T3'(g) {
    let a = false;
    if (g.checkBasic('D2')) {
      const { ast, fns } = g.info('D2');
      const lim = collectCellRefs(ast).filter((r) => r.sheet === 'E3L2_Timetable' && r.col === 6 && r.row === 2);
      if (!fns.has('IF')) g.err('IF_REQUIRED', 'D2');
      else if (!lim.length) {
        const nums = collectLiterals(ast).filter((x) => x.type === 'num').map((x) => x.value);
        g.err(nums.includes(g.levelData('team').extra.E3L2_Timetable.F2) ? 'LIMIT_HARDCODED' : 'LIMIT_REF', 'D2');
      } else if (lim.some((r) => !r.rowAbs)) g.err('LIMIT_NOT_FIXED', 'D2');
      else { a = g.ok('team', 'D2') && g.ok('hidden', 'D2'); if (!a) g.explainValue('D2'); }
    }
    g.award('a', a);
    const rows = rowsOf('D', 2, 41);
    const b = rows.every((x) => g.good(x));
    if (!b && g.info('D2').kind === 'formula') {
      const src = String(g.inputs.D2);
      const vals = rows.map((x) => g.val('team', x));
      if (vals.some((v) => isError(v))) g.err('MISSING_NOT_HANDLED', 'D2');
      else if (/>=/.test(src)) g.err('BOUNDARY_GE', 'D2');
      else if (!g.errors.some((e) => ['LIMIT_NOT_FIXED', 'LIMIT_HARDCODED', 'LIMIT_REF'].includes(e.code))) g.checkRows(rows.slice(1));
    }
    g.award('b', b && a);
  },
  'E3-L2-T4'(g) {
    g.award('a', formulaAnswer(g, 'H2'));
    g.award('b', formulaAnswer(g, 'H3'));
    let c = false;
    if (g.checkBasic('H4')) {
      const { fns, ast } = g.info('H4');
      if (!fns.has('COUNTIFS')) g.err('COUNTIFS_REQUIRED', 'H4');
      else if (!refsSheet(ast, 'E3L2_Timetable')) g.err('CROSS_SHEET_REQUIRED', 'H4', 'E3L2_Timetable');
      else { c = g.ok('team', 'H4') && g.ok('hidden', 'H4'); if (!c) g.explainValue('H4'); }
    }
    g.award('c', c);
  },

  // L3 圖表
  'E3-L3-T1'(g) {
    const best = bestChart(g, { types: ['line'], typeCode: 'CHART_TYPE_TREND', series: ['D'] });
    if (!best) { g.award('a', false); g.award('b', false); return; }
    for (const code of best.issues) g.err(code, best.c.id, code === 'SERIES_WRONG' ? 'Today（D2:D19）' : best.c.type);
    g.award('a', best.issues.length === 0);
    const titled = !!(best.c.title?.trim() && best.c.xTitle?.trim() && best.c.yTitle?.trim());
    if (!titled) g.err('CHART_TITLES', best.c.id);
    g.award('b', titled && best.issues.length === 0);
  },
  'E3-L3-T2'(g) {
    const best = bestChart(g, { types: ['column', 'bar'], typeCode: 'CHART_TYPE_COMPARE', series: ['B', 'C'] });
    if (!best) { g.award('a', false); g.award('b', false); return; }
    for (const code of best.issues) g.err(code, best.c.id, code === 'SERIES_WRONG' ? 'Weekday（B2:B19）及 Sunday（C2:C19）' : best.c.type);
    g.award('a', best.issues.length === 0);
    const names = (best.c.series || []).map((s) => ({ c: parseRange(s.ref)?.c1, n: String(s.name || '').trim().toUpperCase() }));
    const named = names.some((x) => x.c === 2 && x.n === 'WEEKDAY') && names.some((x) => x.c === 3 && x.n === 'SUNDAY');
    if (!best.c.legend) g.err('LEGEND_MISSING', best.c.id);
    else if (!named) g.err('SERIES_NAMES', best.c.id);
    g.award('b', best.issues.length === 0 && named && !!best.c.legend);
  },
  'E3-L3-T3'(g) {
    // 讀圖的答案可以直接輸入；如用公式，亦要在隱藏數據正確
    const read = (a) => {
      const info = g.info(a);
      if (info.kind === 'formula') return formulaAnswer(g, a);
      return typedAnswer(g, a, g.expected('team', a));
    };
    g.award('a', read('G2'));
    g.award('b', formulaAnswer(g, 'G3'));
    g.award('c', read('G4'));
  },

  // L4 樞紐分析表
  'E3-L4-T1'(g) {
    const ref = LEVEL_BY_NUM[4].referenceMeta['E3-L4-T1']['!PIVOTS'][0];
    g.award('a', !!matchPivot(g, ref));
    const exp = pivotOn(g, 'team', ref);
    const top = exp.rowKeys.reduce((best, k) => (exp.cells.get(`${k}|`) > (exp.cells.get(`${best}|`) ?? -1) ? k : best), exp.rowKeys[0]);
    g.award('b', typedAnswer(g, 'J2', top));
  },
  'E3-L4-T2'(g) {
    const ref = LEVEL_BY_NUM[4].referenceMeta['E3-L4-T2']['!PIVOTS'][0];
    g.award('a', !!matchPivot(g, ref));
    const exp = pivotOn(g, 'team', ref);
    const top = exp.rowKeys.reduce((best, k) => (exp.cells.get(`${k}|`) > (exp.cells.get(`${best}|`) ?? -1) ? k : best), exp.rowKeys[0]);
    g.award('b', typedAnswer(g, 'J3', exp.labels.rows[top] ?? top));
  },
  'E3-L4-T3'(g) {
    const ref = LEVEL_BY_NUM[4].referenceMeta['E3-L4-T3']['!PIVOTS'][0];
    const p = matchPivot(g, ref, { allowTranspose: true });
    g.award('a', !!p);
    const charts = g.meta(META.CHARTS) || [];
    const pc = charts.find((c) => c.source?.pivot && (p ? c.source.pivot === p.id : true));
    let b = false;
    if (!pc) g.err('PIVOT_CHART_MISSING', 'E1');
    else if (!['column', 'bar'].includes(pc.type)) g.err('CHART_TYPE_COMPARE', pc.id, pc.type);
    else if (!p) g.err('PIVOT_CHART_SOURCE', pc.id);
    else b = true;
    g.award('b', b);
    const exp = pivotOn(g, 'team', ref);
    const totals = exp.rowTotal;
    const peak = exp.rowKeys.reduce((best, k) => (totals[k] > (totals[best] ?? -1) ? k : best), exp.rowKeys[0]);
    g.award('c', typedAnswer(g, 'J4', exp.cells.get(`${peak}|FSM`)));
  },

  // L5 假設分析＋綜合
  'E3-L5-T1'(g) {
    let a = false;
    if (g.checkBasic('E2')) {
      const { ast, fns } = g.info('E2');
      const refs = collectCellRefs(ast).filter((r) => !r.sheet && r.col === 2 && (r.row === 2 || r.row === 3));
      if (!fns.has('IF') || !fns.has('AND')) g.err('IF_AND_REQUIRED', 'E2');
      else if (!refs.some((r) => r.row === 2) || !refs.some((r) => r.row === 3)) g.err('WINDOW_REFS', 'E2');
      else if (refs.some((r) => !r.rowAbs)) g.err('LOCK_NOT_FIXED', 'E2');
      else if (!collectCellRefs(ast).some((r) => r.sheet === 'E3L5_EditLog' && r.col === 3)) g.err('COMPUTER_MISSING', 'E2');
      else a = true;
    }
    // 在不同的假設（B3）下都要正確：本隊數據及隱藏測試
    let b = a;
    const rows = rowsOf('E', 2, 61);
    if (a) {
      outer: for (const kind of ['team', 'hidden']) {
        // 包括「最後一個貓咪痕跡剛好在 B2+B3」的情況，找出用了 <= 的公式
        for (const lock of [5, 30, 12, g.levelData(kind).params.minLock - 1]) {
          const mine = g.variant(kind, { B3: lock });
          const ref = g.variant(kind, { B3: lock }, { reference: true });
          for (const x of rows) {
            if (!valuesEqual(mine.getValue(g.lv.sheet, x), ref.getValue(g.lv.sheet, x))) {
              const src = String(g.inputs.E2);
              if (/<=\s*\$?B\$?2\s*\+\s*\$?B\$?3/i.test(src)) g.err('WINDOW_BOUNDARY', 'E2');
              else g.err('WHATIF_WRONG', x, `B3 = ${lock}`);
              b = false;
              break outer;
            }
          }
        }
      }
    }
    if (!a) g.checkRows(rows.slice(1));
    g.award('a', a);
    g.award('b', b);
  },
  'E3-L5-T2'(g) {
    let a = false;
    if (g.checkBasic('F2')) {
      const { fns } = g.info('F2');
      if (!fns.has('LEN')) g.err('LEN_REQUIRED', 'F2');
      else a = true;
    }
    g.award('a', a);
    const rows = rowsOf('F', 2, 61);
    const b = rows.every((x) => g.good(x));
    if (!b && a) {
      const log = g.levelData('team').extra.E3L5_EditLog;
      const short = rows.find((x) => { const r = parseAddr(x).row; const v = String(log[`F${r}`] ?? ''); return v.length < 5 && v.length > 1 && v === v[0].repeat(v.length); });
      if (short && g.val('team', short) === 1) g.err('LENGTH_MISSING', short);
      else g.checkRows(rows);
    }
    g.award('b', b && a);
  },
  'E3-L5-T3'(g) {
    let a = true;
    for (const c of ['I1', 'I2']) {
      if (!g.checkBasic(c)) { a = false; continue; }
      for (const kind of ['team', 'hidden']) {
        for (const lock of [5, 15, 30]) {
          const mine = g.variant(kind, { B3: lock });
          const ref = g.variant(kind, { B3: lock }, { reference: true });
          if (!valuesEqual(mine.getValue(g.lv.sheet, c), ref.getValue(g.lv.sheet, c))) { g.err('WHATIF_WRONG', c, `B3 = ${lock}`); a = false; break; }
        }
        if (!a) break;
      }
    }
    g.award('a', a);
    const scen = g.meta(META.SCEN);
    let b = false;
    if (!scen?.list?.length) g.err('SCENARIO_MISSING', 'B3');
    else {
      const vals = scen.list.map((s) => s.values?.B3);
      const missing = [5, 15, 30].filter((v) => !vals.includes(v));
      if (missing.length) g.err('SCENARIO_VALUES', 'B3', missing.join('、'));
      else if (!(scen.result || []).includes('I1')) g.err('SCENARIO_RESULT', 'I1');
      else b = true;
    }
    g.award('b', b);
    const minLock = g.levelData('team').params.minLock;
    const info = g.info('I3');
    let c = false;
    if (info.kind === 'formula') {
      const ok = valuesEqual(g.val('team', 'I3'), minLock) && valuesEqual(g.val('hidden', 'I3'), g.levelData('hidden').params.minLock);
      if (!ok) g.err('MIN_LOCK_WRONG', 'I3'); else c = true;
    } else if (info.kind === 'empty') g.err('EMPTY', 'I3');
    else if (valuesEqual(info.value, minLock)) c = true;
    else g.err(Number(info.value) > minLock ? 'MIN_LOCK_NOT_MIN' : 'MIN_LOCK_WRONG', 'I3');
    g.award('c', c);
  },
  'E3-L5-T4'(g) {
    let a = false;
    if (g.checkBasic('I4')) { a = g.ok('team', 'I4') && g.ok('hidden', 'I4'); if (!a) g.explainValue('I4'); }
    g.award('a', a);
    // B3 必須是 IT 部的實際設定（B4），在這個設定下所有貓咪痕跡都能解釋
    const b3 = g.val('team', 'B3');
    const it = g.levelData('team').data.B4;
    let b = false;
    if (!valuesEqual(b3, it)) g.err('ACTUAL_SETTING', 'B3', String(it));
    else {
      const wb = g.variant('team', {}, { reference: false });
      const ref = g.variant('team', { B3: it }, { reference: true });
      b = valuesEqual(ref.getValue(g.lv.sheet, 'I1'), ref.getValue(g.lv.sheet, 'I2'));
      void wb;
    }
    g.award('b', b);
    const v = String(g.info('I5').kind === 'constant' ? g.info('I5').value : g.val('team', 'I5') ?? '').trim().toUpperCase();
    let c = false;
    if (!v) g.err('EMPTY', 'I5');
    else if (v === 'CAT') c = true;
    else if (v === 'UNCLE') g.err('CONCLUSION_UNCLE', 'I5');
    else if (v === 'ROCKET') g.err('CONCLUSION_ROCKET', 'I5');
    else g.err('CONCLUSION_CODE', 'I5');
    g.award('c', c && b);
  },
};

// ---------------------------------------------------------------- 批改入口
export function gradeTask(taskId, inputs, dataset) {
  const task = TASK_BY_ID[taskId];
  if (!task) throw new Error(`未知 Task ${taskId}`);
  const g = new E3Context({ task, inputs, dataset, levelByNum: LEVEL_BY_NUM, buildLevelWorkbook });
  VALIDATORS[taskId](g);
  const markingPoints = task.markingPoints.map((mp) => ({ id: mp.id, label: mp.label, max: mp.max, earned: g.mp[mp.id] ? mp.max : 0, passed: !!g.mp[mp.id] }));
  const earned = markingPoints.reduce((s, m) => s + m.earned, 0);
  const seen = new Set();
  const errors = g.errors.filter((e) => { const k = `${e.code}|${e.cell}`; if (seen.has(k)) return false; seen.add(k); return true; }).map(renderError);
  return {
    taskId, validatorVersion: VALIDATOR_VERSION, earned, max: task.points,
    status: earned === task.points ? 'VERIFIED' : 'REJECTED',
    needsReview: errors.some((e) => e.code === 'UNSUPPORTED_FUNCTION'),
    markingPoints, errors, hiddenTested: true,
  };
}

/** 原始數據完整性：數據格只能經排序重排（數據本身不可修改）；比較排序後的預期數據 */
export function checkIntegrity(levelNum, snapshotCells, dataset) {
  const lv = LEVEL_BY_NUM[levelNum];
  const meta = Object.fromEntries(Object.entries(snapshotCells).filter(([a]) => isMetaKey(a)).map(([a, c]) => [a, c.input]));
  const wb = buildLevelWorkbook(dataset.levels[levelNum], levelNum, meta);
  const changed = [];
  const editable = new Set(lv.editable.flatMap(expandRange));
  for (const [a, c] of Object.entries(snapshotCells)) {
    if (isMetaKey(a) || editable.has(a)) continue;
    const expected = wb.getInput(lv.sheet, a);
    if (expected === null) { if (c.input !== null && c.input !== undefined && c.input !== '') changed.push(a); continue; }
    if (!valuesEqual(c.input, expected, 1e-9)) changed.push(a);
  }
  return changed;
}

export function evaluateStudentLevel(levelNum, inputs, dataset) {
  const lv = LEVEL_BY_NUM[levelNum];
  const wb = buildLevelWorkbook(dataset.levels[levelNum], levelNum, inputs);
  const out = {};
  for (const a of lv.editable.flatMap(expandRange)) out[a] = wb.getValue(lv.sheet, a);
  return out;
}

export { analyzeInput, issueOf, rangeIs };
export const VALIDATED_TASKS = Object.keys(VALIDATORS);
