// 試算表分析工具（第三集）：排序、篩選、圖表、樞紐分析表、分析藍本（Scenario）、目標搜尋（Goal Seek）。
// 所有設定經編輯器的 edit() 存成中繼資料（例如 '!SORT'），與儲存格一樣有版本號、權限（只限 Driver）及即時同步。
// 計算使用與伺服器批改相同的 /engine/analysis.js。
import { h, clear, toast } from './common.js';
import { META, parseRange, distinctValues, computePivot, chartData, scenarioSummary, goalSeek, CHART_TYPES } from '/engine/analysis.js';
import { indexToCol, colToIndex } from '/engine/refs.js';

const A = (c, r) => `${indexToCol(c)}${r}`;
const TYPE_LABEL = { column: '柱形圖（直條）', bar: '棒形圖（橫條）', line: '折線圖', pie: '圓形圖', scatter: '散佈圖' };
const AGG_LABEL = { SUM: '加總 SUM', COUNT: '計數 COUNT', AVERAGE: '平均值 AVERAGE', MAX: '最大值 MAX', MIN: '最小值 MIN' };
const OPS = [['', '（不設條件）'], ['=', '等於'], ['<>', '不等於'], ['>', '大於'], ['>=', '大於或等於'], ['<', '小於'], ['<=', '小於或等於'], ['contains', '包含'], ['begins', '開頭是']];
const COLORS = ['#2F6FB3', '#E8590C', '#2B8A3E', '#7048E8', '#C2255C', '#0B7285'];
const fmt = (v) => (v === null || v === undefined ? '' : typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(+v.toFixed(2))) : String(v));
const SVGNS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  for (const k of kids.flat()) if (k !== null && k !== undefined) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}

/** 對話框（覆蓋整個畫面）；回傳 close() */
function modal(title, body, actions) {
  const box = h('div.st-modal', { role: 'dialog', 'aria-label': title },
    h('div.st-modal-head', h('strong', title), h('button.small.ghost', { type: 'button', 'aria-label': '關閉', onclick: () => close() }, '✕')),
    h('div.st-modal-body', body),
    h('div.st-modal-actions', actions));
  const bg = h('div.st-overlay', { onmousedown: (e) => { if (e.target === bg) close(); } }, box);
  const close = () => bg.remove();
  document.body.append(bg);
  setTimeout(() => box.querySelector('input,select,button.primary')?.focus(), 30);
  return close;
}

export class SheetTools {
  constructor(ed) {
    this.ed = ed;
    try { this.drawerOpen = localStorage.getItem('ty.drawer') !== '0'; } catch { this.drawerOpen = true; }
  }

  get T() { return this.ed.payload?.levelInfo?.tools || {}; }
  get sheet() { return this.ed.cur.sheet; }
  get(c, r) { return this.ed.wb.valueAt(this.sheet, c, r); }
  meta(key) { return this.ed.metaValue(key); }
  get ro() { return this.ed.readOnly; }

  /** 只有可以修改該設定的學生（Driver、題目開放中）才可以操作 */
  can(key) {
    if (this.ro) return false;
    if (this.ed.canEdit(key)) return true;
    const t = (this.ed.payload?.tasks || []).find((x) => (x.meta || []).includes(key));
    const why = this.ed.opts.lockedReason?.(key, t);
    toast(why || (t ? `${t.id} 現在不可操作（未開放、已完成或已截止）。` : '這一關不可使用這個工具。'), 'error');
    return false;
  }

  save(key, value) {
    if (!this.can(key)) return false;
    this.ed.edit([{ a: key, i: value }]);
    return true;
  }

  // ---------------------------------------------------------------- 介面
  attach() {
    const T = this.T;
    const btn = (label, title, fn) => h('button.small', { type: 'button', title, onmousedown: (e) => e.preventDefault(), onclick: fn }, label);
    if (this.group) this.group.remove();
    const spacer = this.ed.toolbar.querySelector('.se-spacer');
    this.group = h('span.st-group',
      !this.ro && T.sort ? [btn('A→Z', '按目前欄位由小至大排序（整個表格）', () => this.quickSort('asc')), btn('Z→A', '按目前欄位由大至小排序（整個表格）', () => this.quickSort('desc')), btn('⇅ 自訂排序', '多欄排序', () => this.sortDialog()), btn('↺ 原本次序', '清除所有排序', () => this.resetSort())] : null,
      !this.ro && T.filter ? btn('✕ 清除篩選', '顯示所有資料列', () => this.save(META.FILTER, { crit: {} })) : null,
      !this.ro && T.chart ? btn('📊 插入圖表', '由選取的數據建立圖表', () => this.chartDialog()) : null,
      !this.ro && T.pivot ? btn('🧮 樞紐分析表', '建立樞紐分析表', () => this.pivotDialog()) : null,
      !this.ro && T.scenario ? btn('🔀 分析藍本', '建立及比較不同假設（What-if）', () => this.scenarioDialog()) : null,
      !this.ro && T.goalseek ? btn('🎯 目標搜尋', '找出令結果達到目標的輸入值', () => this.goalSeekDialog()) : null,
      (T.chart || T.pivot || T.scenario) ? btn('▤ 分析面板', '顯示或隱藏圖表、樞紐分析表及藍本', () => this.toggleDrawer()) : null);
    this.ed.toolbar.insertBefore(this.group, spacer);
    if (!this.drawer) this.drawer = h('aside.st-drawer', { 'aria-label': '分析面板' });
    if (T.chart || T.pivot || T.scenario) this.ed.mainRow.append(this.drawer); else this.drawer.remove();
    this.refresh();
  }

  detach() {
    this.group?.remove();
    this.drawer?.remove();
    this.filterLayer?.remove();
  }

  toggleDrawer() {
    this.drawerOpen = !this.drawerOpen;
    try { localStorage.setItem('ty.drawer', this.drawerOpen ? '1' : '0'); } catch { /* 私密模式 */ }
    this.refresh();
  }

  refresh() {
    if (!this.ed.payload?.levelInfo?.tools || this.ed.payload.readOnlyData) return;
    this.drawFilterButtons();
    this.renderDrawer();
  }

  // ---------------------------------------------------------------- 排序
  tableRange() { return parseRange(this.T.table); }
  headers() { const g = this.tableRange(); const out = []; for (let c = g.c1; c <= g.c2; c++) out.push({ col: indexToCol(c), name: String(this.get(c, g.r1) ?? indexToCol(c)) }); return out; }

  addSort(op) {
    const cur = this.meta(META.SORT) || { ops: [] };
    if (this.save(META.SORT, { ops: [...(cur.ops || []), op].slice(-30) })) {
      const name = op.keys.map((k) => `${this.headerName(k.col)} ${k.dir === 'desc' ? '由大至小' : '由小至大'}`).join('，然後 ');
      toast(op.cols ? `只排序了 ${op.cols.join('、')} 欄：${name}（其他欄沒有移動！）` : `已按 ${name} 排序整個表格`, op.cols ? 'error' : 'ok', op.cols ? 6000 : 2500);
    }
  }

  headerName(col) { const g = this.tableRange(); return String(this.get(colToIndex(col), g.r1) ?? col); }

  /** 選取範圍只包括表格的部分欄：像試算表一樣詢問是否擴展選取範圍 */
  scopeFor(sel, then) {
    const g = this.tableRange();
    const inTable = sel.c1 >= g.c1 && sel.c2 <= g.c2 && sel.r1 >= g.r1 && sel.r2 <= g.r2;
    if (!inTable) { toast(`請先選取表格（${this.T.table}）內的儲存格。`, 'error'); return; }
    const partial = !sel.single && sel.r2 > sel.r1 && (sel.c1 > g.c1 || sel.c2 < g.c2);
    if (!partial) { then(null); return; }
    const cols = []; for (let c = sel.c1; c <= sel.c2; c++) cols.push(indexToCol(c));
    const expand = h('input', { type: 'radio', name: 'scope', checked: true });
    const only = h('input', { type: 'radio', name: 'scope' });
    const close = modal('排序警告', [
      h('p', '選取範圍旁邊還有其他數據。如果只排序選取的欄，同一列的其他資料不會一起移動，紀錄會被拆散。'),
      h('label', { style: { display: 'block' } }, expand, ' 擴展選取範圍（整列一起移動，建議）'),
      h('label', { style: { display: 'block' } }, only, ` 以目前的選取範圍排序（只排序 ${cols.join('、')} 欄）`),
    ], [h('button.primary', { type: 'button', onclick: () => { close(); then(expand.checked ? null : cols); } }, '排序'), h('button', { type: 'button', onclick: () => close() }, '取消')]);
  }

  quickSort(dir) {
    if (!this.can(META.SORT)) return;
    const sel = this.ed.sel();
    this.scopeFor(sel, (cols) => this.addSort({ keys: [{ col: indexToCol(this.ed.anchor.c), dir }], ...(cols ? { cols } : {}) }));
  }

  resetSort() {
    if (!(this.meta(META.SORT)?.ops || []).length) return toast('數據已是原本次序。');
    if (this.save(META.SORT, { ops: [] })) toast('已還原原本次序。', 'ok');
  }

  sortDialog() {
    if (!this.can(META.SORT)) return;
    const sel = this.ed.sel();
    const hs = this.headers();
    const levels = [];
    const list = h('div');
    const addLevel = (col = indexToCol(this.ed.anchor.c), dir = 'asc') => {
      if (levels.length >= 3) return;
      const cs = h('select', { 'aria-label': '排序欄位' }, hs.map((x) => h('option', { value: x.col, selected: x.col === col }, `${x.name}（${x.col} 欄）`)));
      const ds = h('select', { 'aria-label': '次序' }, h('option', { value: 'asc', selected: dir === 'asc' }, '由小至大（A→Z）'), h('option', { value: 'desc', selected: dir === 'desc' }, '由大至小（Z→A）'));
      const row = h('div.row', { style: { margin: '4px 0' } }, h('span', levels.length ? '然後按' : '主要排序'), cs, ds);
      levels.push({ cs, ds, row });
      list.append(row);
    };
    const g = this.tableRange();
    addLevel(hs.some((x) => colToIndex(x.col) === this.ed.anchor.c) ? indexToCol(this.ed.anchor.c) : hs[0].col);
    const close = modal('自訂排序', [
      h('p.muted', `表格：${this.T.table}（第 ${g.r1} 列是標題，不會被排序）`),
      list,
      h('button.small', { type: 'button', onclick: () => addLevel(hs[0].col) }, '＋ 新增層級'),
    ], [h('button.primary', { type: 'button', onclick: () => {
      const keys = levels.map((l) => ({ col: l.cs.value, dir: l.ds.value }));
      close();
      this.scopeFor(sel, (cols) => this.addSort({ keys, ...(cols ? { cols: [...new Set([...cols, ...keys.map((k) => k.col)])] } : {}) }));
    } }, '排序'), h('button', { type: 'button', onclick: () => close() }, '取消')]);
  }

  // ---------------------------------------------------------------- 篩選
  drawFilterButtons() {
    if (!this.T.filter) return;
    if (!this.filterLayer || !this.ed.wrap.contains(this.filterLayer)) { this.filterLayer = h('div.st-filters'); this.ed.wrap.append(this.filterLayer); }
    const g = this.tableRange();
    const crit = this.meta(META.FILTER)?.crit || {};
    clear(this.filterLayer);
    for (let c = g.c1; c <= g.c2; c++) {
      const td = this.ed.tds.get(A(c, g.r1));
      if (!td) continue;
      const col = indexToCol(c);
      const on = !!crit[col];
      this.filterLayer.append(h(`button.st-fbtn${on ? '.on' : ''}`, {
        type: 'button', title: on ? `${this.headerName(col)}：已設定篩選` : `篩選 ${this.headerName(col)}`, 'aria-label': `篩選 ${this.headerName(col)}`,
        style: { left: `${td.offsetLeft + td.offsetWidth - 20}px`, top: `${td.offsetTop + 3}px` },
        onmousedown: (e) => e.preventDefault(),
        onclick: () => this.filterDialog(col),
      }, on ? '▼' : '▾'));
    }
    const hidden = this.ed.hidden?.size || 0;
    this.ed.status.dataset.filter = hidden ? `已篩選：顯示 ${g.r2 - g.r1 - hidden} / ${g.r2 - g.r1} 列` : '';
  }

  filterDialog(col) {
    const crit = { ...(this.meta(META.FILTER)?.crit || {}) };
    const cur = crit[col] || {};
    const g = this.tableRange();
    const vals = distinctValues((c, r) => this.ed.wb.valueAt(this.sheet, c, r), this.T.table, col);
    const keyOf = (v) => (v === null || v === undefined || v === '' ? '' : String(v));
    const chosen = new Set((cur.values || vals).map(keyOf));
    const boxes = vals.map((v) => ({ v, el: h('input', { type: 'checkbox', checked: chosen.has(keyOf(v)) }) }));
    const all = h('input', { type: 'checkbox', checked: boxes.every((b) => b.el.checked), onchange: (e) => boxes.forEach((b) => { b.el.checked = e.target.checked; }) });
    const op = h('select', { 'aria-label': '條件' }, OPS.map(([v, l]) => h('option', { value: v, selected: (cur.op || '') === v }, l)));
    const val = h('input', { value: cur.value ?? '', placeholder: '數值或文字', style: { width: '9em' }, 'aria-label': '條件數值' });
    const ro = this.ro;
    const close = modal(`篩選：${this.headerName(col)}（${col} 欄）`, [
      h('div.st-vals', h('label', all, ' （全選）'), boxes.map((b) => h('label', b.el, ` ${keyOf(b.v) || '（空白）'}`))),
      h('div.row', { style: { marginTop: '8px' } }, h('span', '數字／文字條件：'), op, val),
      h('small.muted', '可以只勾選值、只設條件，或兩者同時使用。多欄篩選時，資料列要同時符合所有欄的條件。篩選只會隱藏資料列，不會刪除數據。'),
    ], ro ? [h('button', { type: 'button', onclick: () => close() }, '關閉')] : [
      h('button.primary', { type: 'button', onclick: () => {
        const picked = boxes.filter((b) => b.el.checked).map((b) => b.v);
        const next = {};
        if (picked.length < boxes.length) next.values = picked;
        if (op.value) { next.op = op.value; next.value = val.value.trim() !== '' && Number.isFinite(Number(val.value)) ? Number(val.value) : val.value; }
        if (next.values || next.op) crit[col] = next; else delete crit[col];
        if (this.save(META.FILTER, { crit })) close();
      } }, '確定'),
      h('button', { type: 'button', onclick: () => { delete crit[col]; if (this.save(META.FILTER, { crit })) close(); } }, '清除此欄篩選'),
      h('button', { type: 'button', onclick: () => close() }, '取消')]);
    void g;
  }

  // ---------------------------------------------------------------- 樞紐分析表
  pivotFields() {
    const g = parseRange(this.T.pivotSource);
    const out = [];
    for (let c = g.c1; c <= g.c2; c++) { const n = this.get(c, g.r1); if (n !== null && n !== '') out.push(String(n)); }
    return out;
  }

  pivots() { return (this.meta(META.PIVOTS) || []).map((cfg) => ({ cfg, result: computePivot((c, r) => this.get(c, r), { ...cfg, source: this.T.pivotSource }) })); }

  pivotDialog(existing = null) {
    if (!this.can(META.PIVOTS)) return;
    const fields = this.pivotFields();
    const sel = (label, value, opts, none = true) => h('select', { 'aria-label': label }, none ? h('option', { value: '' }, '— 無 —') : null, opts.map((f) => h('option', { value: f, selected: f === value }, f)));
    const cfg = existing || { rows: [fields[0]], cols: [], values: [{ field: fields[0], agg: 'COUNT' }], filters: [] };
    const rows = sel('列', cfg.rows?.[0], fields);
    const cols = sel('欄', cfg.cols?.[0], fields);
    const vf = sel('值的欄位', cfg.values?.[0]?.field, fields, false);
    const agg = h('select', { 'aria-label': '彙總方式' }, Object.entries(AGG_LABEL).map(([k, l]) => h('option', { value: k, selected: k === (cfg.values?.[0]?.agg || 'SUM') }, l)));
    const ff = sel('篩選欄位', cfg.filters?.[0]?.field, fields);
    const fvals = h('div.st-vals', { style: { maxHeight: '120px' } });
    let fboxes = [];
    const drawFilterVals = () => {
      fboxes = [];
      clear(fvals);
      if (!ff.value) return;
      const g = parseRange(this.T.pivotSource);
      const c = g.c1 + fields.indexOf(ff.value);
      const vals = distinctValues((cc, r) => this.get(cc, r), this.T.pivotSource, indexToCol(c));
      const chosen = cfg.filters?.[0]?.field === ff.value ? new Set((cfg.filters[0].values || []).map(String)) : null;
      for (const v of vals) { const el = h('input', { type: 'checkbox', checked: !chosen || chosen.has(String(v)) }); fboxes.push({ v, el }); fvals.append(h('label', el, ` ${fmt(v)}`)); }
    };
    ff.onchange = () => { drawFilterVals(); preview(); };
    drawFilterVals();
    const pv = h('div.st-pv');
    const current = () => {
      const picked = fboxes.filter((b) => b.el.checked).map((b) => b.v);
      return {
        id: existing?.id || this.nextId(this.meta(META.PIVOTS) || [], 'P'),
        rows: rows.value ? [rows.value] : [], cols: cols.value ? [cols.value] : [],
        values: [{ field: vf.value, agg: agg.value }],
        filters: ff.value && picked.length < fboxes.length ? [{ field: ff.value, values: picked }] : [],
      };
    };
    const preview = () => clear(pv, this.pivotTable(computePivot((c, r) => this.get(c, r), { ...current(), source: this.T.pivotSource })));
    for (const x of [rows, cols, vf, agg]) x.onchange = preview;
    fvals.onchange = preview;
    preview();
    const close = modal(existing ? `修改樞紐分析表 ${existing.id}` : '建立樞紐分析表', [
      h('p.muted', `來源：${this.T.pivotSource}（第一列是欄位名稱）`),
      h('div.st-grid2', h('label', '列（Rows）', rows), h('label', '欄（Columns）', cols), h('label', '值（Values）', vf), h('label', '彙總方式', agg), h('label', '篩選（Filters）', ff)),
      fvals,
      h('div.section-title', { style: { marginTop: '8px' } }, '預覽'), pv,
    ], [h('button.primary', { type: 'button', onclick: () => {
      const list = [...(this.meta(META.PIVOTS) || [])];
      const c = current();
      const i = list.findIndex((x) => x.id === c.id);
      if (i >= 0) list[i] = c; else list.push(c);
      if (this.save(META.PIVOTS, list.slice(0, 4))) { close(); this.openDrawer(); }
    } }, existing ? '更新' : '建立'), h('button', { type: 'button', onclick: () => close() }, '取消')]);
  }

  pivotTable(p) {
    if (!p || p.error) return h('p.notice.warn', p?.error || '未能建立');
    const hasCols = !!p.colField;
    const head = h('tr', h('th', p.rowField ? `${p.rowField} ＼ ${p.colField || ''}` : ''), hasCols ? p.colKeys.map((C) => h('th', fmt(p.labels.cols[C] ?? C))) : h('th', `${p.agg} of ${p.field}`), hasCols ? h('th', '總計') : null);
    const body = p.rowKeys.map((R) => h('tr', h('th', fmt(p.labels.rows[R] ?? R)), p.colKeys.map((C) => h('td.num', fmt(p.cells.get(`${R}|${C}`)))), hasCols ? h('td.num', h('strong', fmt(p.rowTotal[R]))) : null));
    const total = p.rowField ? h('tr.total', h('th', '總計'), p.colKeys.map((C) => h('td.num', h('strong', fmt(hasCols ? p.colTotal[C] : p.grand)))), hasCols ? h('td.num', h('strong', fmt(p.grand))) : null) : null;
    return h('div.st-pivot', h('table', h('thead', head), h('tbody', body, total)));
  }

  nextId(list, prefix) { let n = 1; while (list.some((x) => x.id === `${prefix}${n}`)) n++; return `${prefix}${n}`; }

  // ---------------------------------------------------------------- 圖表
  charts() {
    const pivots = Object.fromEntries(this.pivots().map((p) => [p.cfg.id, p.result]));
    return (this.meta(META.CHARTS) || []).map((cfg) => ({ cfg, data: chartData((c, r) => this.get(c, r), cfg, pivots) }));
  }

  chartDialog(existing = null) {
    if (!this.can(META.CHARTS)) return;
    const sel = this.ed.sel();
    const pivots = this.T.pivot ? (this.meta(META.PIVOTS) || []) : [];
    const cfg = existing || this.guessChart(sel);
    const type = h('select', { 'aria-label': '圖表類型' }, CHART_TYPES.map((t) => h('option', { value: t, selected: t === cfg.type }, TYPE_LABEL[t])));
    const src = h('select', { 'aria-label': '數據來源' }, h('option', { value: '' }, '工作表範圍'), pivots.map((p) => h('option', { value: p.id, selected: cfg.source?.pivot === p.id }, `樞紐分析表 ${p.id}（樞紐分析圖）`)));
    const cats = h('input', { value: cfg.cats || '', placeholder: '例如 A2:A19', 'aria-label': '類別範圍' });
    const seriesBox = h('div');
    const seriesRows = [];
    const addSeries = (x = { name: '', ref: '' }) => {
      if (seriesRows.length >= 4) return;
      const name = h('input', { value: x.name, placeholder: '數列名稱', style: { width: '9em' }, 'aria-label': '數列名稱' });
      const ref = h('input', { value: x.ref, placeholder: '例如 D2:D19', style: { width: '8em' }, 'aria-label': '數列範圍' });
      const row = h('div.row', { style: { margin: '3px 0' } }, name, ref, h('button.small.ghost', { type: 'button', onclick: () => { row.remove(); seriesRows.splice(seriesRows.findIndex((s2) => s2.row === row), 1); preview(); } }, '移除'));
      seriesRows.push({ name, ref, row });
      seriesBox.append(row);
      name.oninput = preview; ref.oninput = preview;
    };
    (cfg.series || []).forEach((x) => addSeries(x));
    const title = h('input', { value: cfg.title || '', placeholder: '圖表標題', style: { width: '100%' }, 'aria-label': '圖表標題' });
    const xt = h('input', { value: cfg.xTitle || '', placeholder: 'X 軸標題', 'aria-label': 'X 軸標題' });
    const yt = h('input', { value: cfg.yTitle || '', placeholder: 'Y 軸標題', 'aria-label': 'Y 軸標題' });
    const legend = h('input', { type: 'checkbox', checked: cfg.legend !== false });
    const pv = h('div.st-chart-pv');
    const current = () => {
      const c = { id: existing?.id || this.nextId(this.meta(META.CHARTS) || [], 'C'), type: type.value, title: title.value, xTitle: xt.value, yTitle: yt.value, legend: legend.checked };
      if (src.value) c.source = { pivot: src.value };
      else { c.cats = cats.value.trim().toUpperCase() || null; c.series = seriesRows.map((x) => ({ name: x.name.value, ref: x.ref.value.trim().toUpperCase() })).filter((x) => x.ref); }
      return c;
    };
    const rangeBox = h('div', h('label', '類別（X 軸標籤）範圍 ', cats), h('div.section-title', '數列（Y 軸數值）'), seriesBox, h('button.small', { type: 'button', onclick: () => { addSeries(); } }, '＋ 新增數列'),
      h('button.small', { type: 'button', onclick: () => { const g = this.guessChart(this.ed.sel()); cats.value = g.cats || ''; seriesRows.splice(0).forEach((x) => x.row.remove()); (g.series || []).forEach((x) => addSeries(x)); preview(); } }, '由選取範圍填入'));
    function preview() {
      rangeBox.hidden = !!src.value;
      const c = current();
      let data;
      try { data = this_.chartDataFor(c); } catch { data = { error: '範圍不正確' }; }
      clear(pv, renderChart(c, data, { w: 360, h: 230 }));
    }
    const this_ = this;
    for (const x of [type, src, title, xt, yt, legend, cats]) { x.oninput = preview; x.onchange = preview; }
    preview();
    const close = modal(existing ? `修改圖表 ${existing.id}` : '插入圖表', [
      h('div.st-grid2', h('label', '圖表類型', type), h('label', '數據來源', src)),
      rangeBox,
      h('div.st-grid2', h('label', '圖表標題', title), h('label', h('span', '顯示圖例 '), legend), h('label', 'X 軸標題', xt), h('label', 'Y 軸標題', yt)),
      h('div.section-title', '預覽（按工作表的數據即時更新）'), pv,
    ], [h('button.primary', { type: 'button', onclick: () => {
      const list = [...(this.meta(META.CHARTS) || [])];
      const c = current();
      if (!c.source && !c.series?.length) return toast('請最少加入一個數列。', 'error');
      const i = list.findIndex((x) => x.id === c.id);
      if (i >= 0) list[i] = c; else list.push(c);
      if (this.save(META.CHARTS, list.slice(0, 4))) { close(); this.openDrawer(); }
    } }, existing ? '更新' : '插入'), h('button', { type: 'button', onclick: () => close() }, '取消')]);
  }

  chartDataFor(cfg) {
    const pivots = Object.fromEntries(this.pivots().map((p) => [p.cfg.id, p.result]));
    return chartData((c, r) => this.get(c, r), cfg, pivots);
  }

  /** 由選取範圍猜測圖表設定：第一欄是類別；第一列是文字標題時用作數列名稱（與試算表相同） */
  guessChart(sel) {
    const out = { type: 'column', title: '', xTitle: '', yTitle: '', legend: true, cats: null, series: [] };
    if (sel.single) return out;
    const headerRow = typeof this.get(sel.c2, sel.r1) === 'string';
    const r1 = headerRow ? sel.r1 + 1 : sel.r1;
    const multi = sel.c2 > sel.c1;
    if (multi) out.cats = `${A(sel.c1, r1)}:${A(sel.c1, sel.r2)}`;
    for (let c = multi ? sel.c1 + 1 : sel.c1; c <= sel.c2; c++) out.series.push({ name: headerRow ? String(this.get(c, sel.r1)) : `數列 ${out.series.length + 1}`, ref: `${A(c, r1)}:${A(c, sel.r2)}` });
    return out;
  }

  // ---------------------------------------------------------------- 分析藍本、目標搜尋
  scenarioDialog() {
    if (!this.can(META.SCEN)) return;
    const T = this.T;
    const cur = this.meta(META.SCEN) || { result: T.results || [], list: [] };
    const result = h('input', { value: (cur.result || []).join(', '), placeholder: '例如 H2, H3', 'aria-label': '結果儲存格' });
    const rowsBox = h('tbody');
    const rows = [];
    const addRow = (x = { name: '', values: {} }) => {
      const name = h('input', { value: x.name, placeholder: '藍本名稱', style: { width: '8em' }, 'aria-label': '藍本名稱' });
      const vals = (T.changing || []).map((a) => ({ a, el: h('input', { type: 'number', value: x.values?.[a] ?? '', style: { width: '6em' }, 'aria-label': `${a} 的數值` }) }));
      const tr = h('tr', h('td', name), vals.map((v) => h('td', v.el)), h('td', h('button.small.ghost', { type: 'button', onclick: () => { tr.remove(); rows.splice(rows.findIndex((r) => r.tr === tr), 1); } }, '刪除')));
      rows.push({ name, vals, tr });
      rowsBox.append(tr);
    };
    (cur.list || []).forEach((x) => addRow(x));
    if (!rows.length) addRow();
    const close = modal('分析藍本管理員（Scenario Manager）', [
      h('p.muted', `變數儲存格：${(T.changing || []).join('、')}。每個藍本是一組假設；系統會把每組數值代入，比較結果儲存格（不會改變工作表）。`),
      h('table', h('thead', h('tr', h('th', '藍本名稱'), (T.changing || []).map((a) => h('th', a)), h('th', ''))), rowsBox),
      h('button.small', { type: 'button', onclick: () => addRow() }, '＋ 新增藍本'),
      h('div', { style: { marginTop: '8px' } }, h('label', '結果儲存格（摘要比較）', result)),
    ], [h('button.primary', { type: 'button', onclick: () => {
      const list = rows.map((r) => ({ name: r.name.value.trim() || '藍本', values: Object.fromEntries(r.vals.map((v) => [v.a, v.el.value === '' ? null : Number(v.el.value)])) }))
        .filter((r) => Object.values(r.values).every((v) => v !== null && Number.isFinite(v)));
      const res = result.value.toUpperCase().split(/[\s,，、]+/).filter(Boolean);
      if (this.save(META.SCEN, { changing: T.changing, result: res, list })) { close(); this.openDrawer(); }
    } }, '儲存'), h('button', { type: 'button', onclick: () => close() }, '取消')]);
  }

  scenarioRows() {
    const scen = this.meta(META.SCEN);
    if (!scen) return null;
    return scenarioSummary(this.ed.wb.clone(), this.sheet, scen);
  }

  /** 把藍本的數值放入變數儲存格（工作表其他公式立即重新計算） */
  showScenario(row) {
    const ops = Object.entries(row.values || {}).map(([a, v]) => ({ a, i: v }));
    if (!ops.every((o) => this.ed.canEdit(o.a))) return this.can(ops[0]?.a);
    this.ed.edit(ops);
    toast(`已顯示藍本「${row.name}」：${ops.map((o) => `${o.a} = ${o.i}`).join('、')}`, 'ok');
  }

  goalSeekDialog() {
    const T = this.T;
    const target = h('input', { value: (T.results || [])[0] || this.ed.anchorAddr(), 'aria-label': '目標儲存格', style: { width: '6em' } });
    const goal = h('input', { type: 'number', value: '0', 'aria-label': '目標值', style: { width: '6em' } });
    const changing = h('select', { 'aria-label': '變數儲存格' }, (T.changing || []).map((a) => h('option', { value: a }, a)));
    const lo = h('input', { type: 'number', value: '0', style: { width: '6em' }, 'aria-label': '搜尋下限' });
    const hi = h('input', { type: 'number', value: '1440', style: { width: '6em' }, 'aria-label': '搜尋上限' });
    const out = h('div.notice.info', { hidden: true });
    let found = null;
    const close = modal('目標搜尋（Goal Seek）', [
      h('p.muted', '改變一個變數儲存格，找出令目標儲存格「剛好達到」目標值的最小數值（不會立即改變工作表）。'),
      h('div.st-grid2', h('label', '目標儲存格', target), h('label', '目標值', goal), h('label', '變數儲存格', changing), h('label', '搜尋範圍', h('span', lo, ' 至 ', hi))),
      out,
    ], [
      h('button', { type: 'button', onclick: () => {
        const wb = this.ed.wb.clone();
        const cur = wb.getInput(this.sheet, changing.value);
        const integer = Number.isInteger(Number(cur ?? 0));
        found = goalSeek(wb, this.sheet, target.value.toUpperCase(), Number(goal.value), changing.value, { lo: Number(lo.value), hi: Number(hi.value), integer });
        out.hidden = false;
        out.textContent = found === null ? '在搜尋範圍內找不到可以達到目標的數值。請檢查目標儲存格是否依賴變數儲存格，或改變搜尋範圍。' : `當 ${changing.value} = ${found} 時，${target.value.toUpperCase()} 達到目標值 ${goal.value}。`;
      } }, '搜尋'),
      h('button.primary', { type: 'button', onclick: () => {
        if (found === null) return toast('請先按「搜尋」。', 'error');
        if (!this.ed.canEdit(changing.value)) return this.can(changing.value);
        this.ed.edit([{ a: changing.value, i: found }]);
        close();
      } }, '套用到儲存格'),
      h('button', { type: 'button', onclick: () => close() }, '關閉')]);
  }

  // ---------------------------------------------------------------- 分析面板
  openDrawer() { if (!this.drawerOpen) this.toggleDrawer(); else this.refresh(); }

  renderDrawer() {
    if (!this.drawer || !this.drawer.isConnected) return;
    const T = this.T;
    this.drawer.hidden = !this.drawerOpen;
    if (!this.drawerOpen) return;
    const canC = !this.ro && this.ed.canEdit(META.CHARTS);
    const canP = !this.ro && this.ed.canEdit(META.PIVOTS);
    const parts = [];
    if (T.pivot) {
      const ps = this.pivots();
      parts.push(h('div.st-sec', h('div.st-sec-head', h('strong', '🧮 樞紐分析表'), canP ? h('button.small', { type: 'button', onclick: () => this.pivotDialog() }, '＋ 新增') : null),
        ps.length ? ps.map((p) => h('div.st-card', h('div.st-card-head', h('strong', p.cfg.id), h('small.muted', this.pivotSummary(p.cfg)),
          canP ? [h('button.chip', { type: 'button', onclick: () => this.pivotDialog(p.cfg) }, '修改'), h('button.chip', { type: 'button', onclick: () => this.save(META.PIVOTS, (this.meta(META.PIVOTS) || []).filter((x) => x.id !== p.cfg.id)) }, '刪除')] : null),
        this.pivotTable(p.result))) : h('p.muted', '未有樞紐分析表。')));
    }
    if (T.chart) {
      const cs = this.charts();
      parts.push(h('div.st-sec', h('div.st-sec-head', h('strong', '📊 圖表'), canC ? h('button.small', { type: 'button', onclick: () => this.chartDialog() }, '＋ 新增') : null),
        cs.length ? cs.map((c) => h('div.st-card', h('div.st-card-head', h('strong', c.cfg.id), h('small.muted', TYPE_LABEL[c.cfg.type]),
          canC ? [h('button.chip', { type: 'button', onclick: () => this.chartDialog(c.cfg) }, '修改'), h('button.chip', { type: 'button', onclick: () => this.save(META.CHARTS, (this.meta(META.CHARTS) || []).filter((x) => x.id !== c.cfg.id)) }, '刪除')] : null),
        renderChart(c.cfg, c.data, { w: 330, h: 220 }))) : h('p.muted', '未有圖表。選取數據後按「📊 插入圖表」。')));
    }
    if (T.scenario) {
      const rows = this.scenarioRows();
      const scen = this.meta(META.SCEN);
      const canS = !this.ro && this.ed.canEdit(META.SCEN);
      parts.push(h('div.st-sec', h('div.st-sec-head', h('strong', '🔀 分析藍本摘要'), canS ? h('button.small', { type: 'button', onclick: () => this.scenarioDialog() }, scen ? '修改' : '＋ 建立') : null),
        rows && scen.list.length ? h('table.st-scen', h('thead', h('tr', h('th', '藍本'), scen.changing.map((a) => h('th', a)), scen.result.map((a) => h('th', `→ ${a}`)), h('th', ''))),
          h('tbody', rows.map((r) => h(`tr${r.current ? '.cur' : ''}`, h('td', r.name), scen.changing.map((a) => h('td.num', fmt(r.values[a]))), scen.result.map((a) => h('td.num', h('strong', fmt(r.results[a])))),
            h('td', !r.current && !this.ro ? h('button.chip', { type: 'button', onclick: () => this.showScenario(r) }, '顯示') : null))))) : h('p.muted', '未有藍本。按「🔀 分析藍本」建立不同假設並比較結果。')));
    }
    clear(this.drawer, parts);
  }

  pivotSummary(cfg) {
    const v = cfg.values?.[0];
    return [cfg.rows?.[0] && `列：${cfg.rows[0]}`, cfg.cols?.[0] && `欄：${cfg.cols[0]}`, v && `值：${v.agg} of ${v.field}`, cfg.filters?.[0] && `篩選：${cfg.filters[0].field}＝${cfg.filters[0].values.join('/')}`].filter(Boolean).join('・');
  }
}

// ---------------------------------------------------------------- SVG 圖表
/** 繪畫圖表（柱形、棒形、折線、圓形、散佈）。標題、座標軸標題、圖例按設定顯示。 */
export function renderChart(cfg, data, { w = 340, h: H = 220 } = {}) {
  const box = h('div.st-chart');
  if (!data || data.error) { box.append(h('p.notice.warn', data?.error || '數據不正確')); return box; }
  const series = data.series.filter((x) => x.values.length);
  if (!series.length) { box.append(h('p.muted', '未有數列。')); return box; }
  const svg = s('svg', { viewBox: `0 0 ${w} ${H}`, width: '100%', role: 'img', 'aria-label': cfg.title || '圖表' });
  const top = cfg.title ? 24 : 8; const left = cfg.yTitle ? 52 : 40; const bottom = cfg.xTitle ? 46 : 32;
  const right = cfg.legend && series.length > 0 && cfg.type !== 'pie' ? 92 : 10;
  if (cfg.title) svg.append(s('text', { x: w / 2, y: 16, 'text-anchor': 'middle', class: 'st-ct' }, cfg.title));
  const pw = w - left - right; const ph = H - top - bottom;
  const cats = data.categories.length ? data.categories : series[0].values.map((_, i) => i + 1);
  const n = Math.max(...series.map((x) => x.values.length));
  if (cfg.type === 'pie') {
    const vals = series[0].values.map((v) => (typeof v === 'number' && v > 0 ? v : 0));
    const total = vals.reduce((a, b) => a + b, 0) || 1;
    const cx = left + pw / 2 - 30; const cy = top + ph / 2; const r = Math.min(pw, ph) / 2 - 4;
    let a0 = -Math.PI / 2;
    vals.forEach((v, i) => {
      const a1 = a0 + (v / total) * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      svg.append(s('path', { d: `M${cx},${cy} L${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)} A${r},${r} 0 ${large} 1 ${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)} Z`, fill: COLORS[i % COLORS.length], stroke: '#fff' }, s('title', {}, `${cats[i]}：${fmt(v)}（${Math.round((v / total) * 100)}%）`)));
      a0 = a1;
    });
    if (cfg.legend) cats.slice(0, 8).forEach((c, i) => { svg.append(s('rect', { x: w - 96, y: top + 4 + i * 16, width: 10, height: 10, fill: COLORS[i % COLORS.length] })); svg.append(s('text', { x: w - 82, y: top + 13 + i * 16, class: 'st-cl' }, String(c).slice(0, 12))); });
    box.append(svg);
    return box;
  }
  const all = series.flatMap((x) => x.values).filter((v) => typeof v === 'number');
  let min = Math.min(0, ...all); let max = Math.max(0, ...all);
  if (max === min) max = min + 1;
  const step = niceStep((max - min) / 5); min = Math.floor(min / step) * step; max = Math.ceil(max / step) * step;
  const horizontal = cfg.type === 'bar';
  const scale = (v) => (horizontal ? left + ((v - min) / (max - min)) * pw : top + ph - ((v - min) / (max - min)) * ph);
  for (let v = min; v <= max + 1e-9; v += step) {
    const p = scale(v);
    svg.append(horizontal ? s('line', { x1: p, x2: p, y1: top, y2: top + ph, class: 'st-grid' }) : s('line', { x1: left, x2: left + pw, y1: p, y2: p, class: 'st-grid' }));
    svg.append(horizontal ? s('text', { x: p, y: top + ph + 12, 'text-anchor': 'middle', class: 'st-tk' }, fmt(+v.toFixed(6))) : s('text', { x: left - 4, y: p + 3, 'text-anchor': 'end', class: 'st-tk' }, fmt(+v.toFixed(6))));
  }
  svg.append(s('line', { x1: left, x2: horizontal ? left : left + pw, y1: top + ph, y2: horizontal ? top : top + ph, class: 'st-axis' }));
  const band = (horizontal ? ph : pw) / Math.max(1, n);
  const every = Math.ceil(n / (horizontal ? 14 : 12));
  cats.slice(0, n).forEach((c, i) => {
    if (i % every) return;
    const p = (horizontal ? top : left) + band * (i + 0.5);
    svg.append(horizontal ? s('text', { x: left - 4, y: p + 3, 'text-anchor': 'end', class: 'st-tk' }, String(c).slice(0, 10)) : s('text', { x: p, y: top + ph + 12, 'text-anchor': 'middle', class: 'st-tk' }, String(c).slice(0, 8)));
  });
  series.forEach((sr, k) => {
    const color = COLORS[k % COLORS.length];
    if (cfg.type === 'line' || cfg.type === 'scatter') {
      const pts = sr.values.map((v, i) => (typeof v === 'number' ? [left + band * (i + 0.5), scale(v)] : null));
      if (cfg.type === 'line') svg.append(s('polyline', { points: pts.filter(Boolean).map((p) => p.join(',')).join(' '), fill: 'none', stroke: color, 'stroke-width': 2 }));
      pts.forEach((p, i) => { if (p) svg.append(s('circle', { cx: p[0], cy: p[1], r: cfg.type === 'scatter' ? 3.5 : 2.5, fill: color }, s('title', {}, `${cats[i]}：${fmt(sr.values[i])}`))); });
    } else {
      const bw = (band * 0.8) / series.length;
      sr.values.forEach((v, i) => {
        if (typeof v !== 'number') return;
        const o = band * 0.1 + bw * k + band * i;
        const z = scale(0); const p = scale(v);
        svg.append(horizontal
          ? s('rect', { x: Math.min(z, p), y: top + o, width: Math.abs(p - z), height: bw, fill: color }, s('title', {}, `${cats[i]}：${fmt(v)}`))
          : s('rect', { x: left + o, y: Math.min(z, p), width: bw, height: Math.abs(p - z), fill: color }, s('title', {}, `${cats[i]}：${fmt(v)}`)));
      });
    }
  });
  if (cfg.xTitle) svg.append(s('text', { x: left + pw / 2, y: H - 6, 'text-anchor': 'middle', class: 'st-at' }, cfg.xTitle));
  if (cfg.yTitle) svg.append(s('text', { x: 12, y: top + ph / 2, 'text-anchor': 'middle', transform: `rotate(-90 12 ${top + ph / 2})`, class: 'st-at' }, cfg.yTitle));
  if (cfg.legend) series.forEach((sr, k) => { svg.append(s('rect', { x: w - right + 8, y: top + 4 + k * 16, width: 10, height: 10, fill: COLORS[k % COLORS.length] })); svg.append(s('text', { x: w - right + 22, y: top + 13 + k * 16, class: 'st-cl' }, String(sr.name || `數列 ${k + 1}`).slice(0, 12))); });
  box.append(svg);
  return box;
}

function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}
