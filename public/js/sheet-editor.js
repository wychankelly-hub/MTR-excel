// 內置試算表編輯器（學生作答及老師唯讀預覽共用）。
// - 使用與伺服器批改相同的公式引擎（/engine/*），在瀏覽器即時計算。
// - 每次修改以「儲存格版本號」送到伺服器：隊友剛改過同一格時不會被覆蓋，而會顯示衝突並更新為最新內容。
// - 自動儲存（約 0.15 秒內送出；網絡中斷時保留修改並自動重試）。
// - 支援：公式列、名稱方塊、方向鍵／Tab／Enter、F2、Esc、Delete、Ctrl+C/X/V（相對參照自動位移）、
//   Ctrl+D／Ctrl+R 填充、拖曳填充控點、Ctrl+Enter 填入整個選取範圍、Ctrl+Z／Ctrl+Y、F4 切換 $、
//   以滑鼠點選儲存格插入參照、函數自動完成及參數提示、Ctrl+` 顯示公式、選取範圍的總和／平均／計數。
import { Workbook } from '/engine/workbook.js';
import { parseFormula } from '/engine/parser.js';
import { shiftAst, toFormulaString } from '/engine/ast.js';
import { isError, formatNumber } from '/engine/values.js';
import { FUNCTION_HELP, SUPPORTED_FUNCTIONS } from '/engine/functions.js';
import { h, clear, toast } from './common.js';

const colName = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const colIdx = (s) => [...s.toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
const A = (c, r) => `${colName(c)}${r}`;
const P = (a) => { const m = /^\$?([A-Z]{1,3})\$?(\d+)$/i.exec(a); return m ? { c: colIdx(m[1]), r: Number(m[2]) } : null; };
const expand = (spec) => {
  const [a, b] = spec.split(':');
  const s = P(a); const e = b ? P(b) : s;
  const out = [];
  for (let r = Math.min(s.r, e.r); r <= Math.max(s.r, e.r); r++) for (let c = Math.min(s.c, e.c); c <= Math.max(s.c, e.c); c++) out.push(A(c, r));
  return out;
};
const isFormula = (v) => typeof v === 'string' && v.startsWith('=') && v.length > 1;
const PEOPLE_COLORS = ['#E8590C', '#7048E8', '#0B7285', '#C2255C', '#2B8A3E', '#5C940D', '#1864AB'];
const STATE_LABEL = { active: '開放作答', locked: '未開放', completed: '已完成（已鎖定）', closed: '已截止', reopened: '老師已重開', practice: '練習中' };

export function displayValue(v) {
  if (isError(v)) return v.code;
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '#NUM!';
    if (Number.isInteger(v)) return String(v);
    return formatNumber(parseFloat(v.toPrecision(10)));
  }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v);
}

function shiftFormula(input, dr, dc) {
  if (!isFormula(input)) return input;
  try { return '=' + toFormulaString(shiftAst(parseFormula(input), dr, dc)); } catch { return input; }
}

function inputText(i) {
  if (i === null || i === undefined) return '';
  if (i === true) return 'TRUE';
  if (i === false) return 'FALSE';
  return String(i);
}

export class SheetEditor {
  /**
   * opts.load(sheet, layer) → 工作表資料；opts.send(sheet, layer, ops) → { applied, conflicts, rejected }
   * opts.presence(sheet, layer, a, editing)；opts.readOnly；opts.me（使用者編號）
   */
  constructor(root, opts) {
    this.root = root;
    this.opts = opts;
    this.readOnly = !!opts.readOnly;
    this.tabs = [];
    this.cur = null; // { sheet, layer }
    this.payload = null;
    this.server = new Map(); // addr -> { i, v, by }（已確認）
    this.pending = new Map(); // addr -> { i, base, sent }（未確認的本機修改）
    this.data = new Map();
    this.editable = new Set();
    this.answer = new Set();
    this.taskOf = new Map();
    this.tds = new Map();
    this.anchor = { c: 1, r: 1 };
    this.focus = { c: 1, r: 1 };
    this.editing = null;
    this.clip = null;
    this.undoStack = [];
    this.redoStack = [];
    this.showFormulas = false;
    this.presenceMap = new Map();
    this.highlight = null;
    this.saveState = 'saved';
    this.sendTimer = null;
    this.retryMs = 1000;
    this.build();
    window.addEventListener('beforeunload', (e) => { if (this.pending.size) { e.preventDefault(); e.returnValue = ''; } });
  }

  // ---------------------------------------------------------------- 介面
  build() {
    this.tabsEl = h('div.se-tabs', { role: 'tablist' });
    this.saveEl = h('span.se-save', '');
    this.nameBox = h('input.se-name', { 'aria-label': '名稱方塊（儲存格位址）', spellcheck: false, autocomplete: 'off' });
    this.nameBox.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.gotoSpec(this.nameBox.value); } });
    this.fx = h('input.se-fx-input', { 'aria-label': '公式列', placeholder: this.readOnly ? '' : '選取作答格後輸入公式，例如 =SUM(B2:C2)', spellcheck: false, autocomplete: 'off', inputmode: 'latin' });
    this.fx.addEventListener('focus', () => { if (!this.readOnly && !this.editing && this.canEdit(this.anchorAddr())) this.beginEdit(undefined, 'edit', this.fx); });
    this.fx.addEventListener('input', () => this.onEditorInput(this.fx));
    this.fx.addEventListener('keydown', (e) => this.onEditorKey(e, this.fx));
    this.fx.addEventListener('click', () => this.updateHint(this.fx));
    this.lockEl = h('span.se-lock', '');
    this.hintEl = h('div.se-hint', { hidden: true });
    this.acEl = h('div.se-ac', { hidden: true, role: 'listbox' });
    const btn = (label, title, fn) => h('button.small', { type: 'button', title, onmousedown: (e) => e.preventDefault(), onclick: () => { fn(); this.sink.focus({ preventScroll: true }); } }, label);
    this.toolbar = h('div.se-toolbar',
      this.readOnly ? null : [
        btn('↶', '復原（Ctrl+Z）', () => this.undo()), btn('↷', '重做（Ctrl+Y）', () => this.redo()),
        btn('複製', '複製（Ctrl+C）', () => this.copyToInternal(false)), btn('貼上', '貼上（Ctrl+V）', () => this.pasteInternal()),
        btn('⬇ 向下填充', '向下填充（Ctrl+D）', () => this.fill('down')), btn('➡ 向右填充', '向右填充（Ctrl+R）', () => this.fill('right')),
      ],
      btn('ƒx 顯示公式', '在儲存格顯示公式（Ctrl+`）', () => { this.showFormulas = !this.showFormulas; this.refreshAll(); }),
      btn('?', '操作說明', () => this.showHelp()),
      h('span.se-spacer'), this.saveEl);
    this.wrap = h('div.se-gridwrap');
    this.scroller = h('div.se-scroll', this.wrap);
    this.status = h('div.se-status', '');
    this.sink = h('textarea.se-sink', { 'aria-label': '工作表鍵盤輸入', autocomplete: 'off', spellcheck: false, autocapitalize: 'off' });
    this.sink.addEventListener('keydown', (e) => this.onGridKey(e));
    this.sink.addEventListener('copy', (e) => this.onCopy(e, false));
    this.sink.addEventListener('cut', (e) => this.onCopy(e, true));
    this.sink.addEventListener('paste', (e) => this.onPaste(e));
    this.sink.addEventListener('compositionstart', () => toast('公式只需要英文、數字及符號，請切換至英文輸入法。', 'error'));
    clear(this.root, h(`div.se${this.readOnly ? '.se-ro' : ''}`,
      this.tabsEl,
      this.toolbar,
      h('div.se-fx', this.nameBox, h('span.se-fxlabel', 'fx'), h('div.se-fxbox', this.fx, this.acEl), this.lockEl),
      this.hintEl,
      this.scroller,
      this.status,
      this.sink));
    this.setSave('saved');
  }

  setTabs(tabs, preferred) {
    this.tabs = tabs;
    const key = (t) => `${t.sheet}|${t.layer || 'main'}`;
    clear(this.tabsEl, tabs.map((t) => h(`button.se-tab${this.cur && key(t) === key(this.cur) ? '.on' : ''}${t.practice ? '.practice' : ''}`, {
      type: 'button', role: 'tab', title: t.title || '', onclick: () => this.open(t.sheet, t.layer),
    }, t.label)));
    const want = preferred && tabs.find((t) => key(t) === key(preferred)) ? preferred
      : this.cur && tabs.find((t) => key(t) === key(this.cur)) ? this.cur : tabs.at(-1);
    if (want && (!this.cur || key(want) !== key(this.cur))) this.open(want.sheet, want.layer);
  }

  async open(sheet, layer = 'main', { keepSelection = false } = {}) {
    if (this.editing) this.commitEdit(null);
    await this.flushNow();
    let p;
    try { p = await this.opts.load(sheet, layer); } catch (e) { toast(e.message, 'error'); return; }
    const switching = !this.cur || this.cur.sheet !== sheet || this.cur.layer !== layer;
    this.cur = { sheet, layer: layer || 'main' };
    this.payload = p;
    this.server = new Map(Object.entries(p.cells || {}).map(([a, c]) => [a, { i: c.i, v: c.v, by: c.by }]));
    this.pending = new Map();
    this.data = new Map(Object.entries(p.data || {}));
    this.answer = new Set((p.answer || []).flatMap(expand));
    this.applyRules(p);
    if (switching) { this.undoStack = []; this.redoStack = []; this.presenceMap.clear(); }
    [...this.tabsEl.children].forEach((b, i) => b.classList.toggle('on', this.tabs[i] && this.tabs[i].sheet === sheet && (this.tabs[i].layer || 'main') === this.cur.layer));
    this.rebuildWorkbook();
    this.renderGrid();
    if (!keepSelection || switching) {
      const first = (p.editable || [])[0] || (p.answer || [])[0]?.split(':')[0] || 'A1';
      const fp = P(first) || { c: 1, r: 1 };
      this.anchor = { ...fp }; this.focus = { ...fp };
    }
    this.updateSelection();
    this.opts.onOpen?.(this.cur);
  }

  applyRules(p) {
    this.editable = this.readOnly ? new Set() : new Set(p.editable || []);
    this.taskOf = new Map();
    for (const t of p.tasks || []) for (const a of t.cells.flatMap(expand)) this.taskOf.set(a, t);
  }

  /** 老師開放／鎖定題目後，更新可編輯範圍（不重新載入內容） */
  async refreshRules() {
    if (!this.cur) return;
    try {
      const p = await this.opts.load(this.cur.sheet, this.cur.layer);
      this.payload = p;
      for (const [a, c] of Object.entries(p.cells || {})) {
        const s = this.server.get(a);
        if (!s || c.v > s.v) this.server.set(a, { i: c.i, v: c.v, by: c.by });
      }
      this.applyRules(p);
      this.rebuildWorkbook();
      this.refreshAll();
    } catch { /* 下次再試 */ }
  }

  rebuildWorkbook() {
    const p = this.payload;
    const wb = new Workbook();
    wb.addSheet(this.cur.sheet, p.maxRow, p.maxCol);
    for (const [a, v] of this.data) wb.setInput(this.cur.sheet, a, v);
    for (const a of new Set([...this.server.keys(), ...this.pending.keys()])) {
      const i = this.inputOf(a);
      if (i !== null && i !== undefined && !this.data.has(a)) wb.setInput(this.cur.sheet, a, i);
    }
    this.wb = wb;
  }

  inputOf(a) {
    if (this.pending.has(a)) return this.pending.get(a).i;
    if (this.server.has(a)) return this.server.get(a).i;
    return this.data.has(a) ? this.data.get(a) : null;
  }

  canEdit(a) { return !this.readOnly && this.editable.has(a); }

  renderGrid() {
    const p = this.payload;
    const head = h('tr', h('th.se-corner', { title: '全選', onmousedown: (e) => { e.preventDefault(); this.selectAll(); } }),
      Array.from({ length: p.maxCol }, (_, i) => h('th.se-colh', { 'data-c': i + 1, onmousedown: (e) => { e.preventDefault(); this.selectCol(i + 1, e.shiftKey); } }, colName(i + 1))));
    const rows = [];
    this.tds = new Map();
    for (let r = 1; r <= p.maxRow; r++) {
      const cells = [h('th.se-rowh', { 'data-r': r, onmousedown: (e) => { e.preventDefault(); this.selectRow(r, e.shiftKey); } }, String(r))];
      for (let c = 1; c <= p.maxCol; c++) {
        const a = A(c, r);
        const td = h('td', { 'data-a': a });
        this.tds.set(a, td);
        cells.push(td);
      }
      rows.push(h('tr', cells));
    }
    // 欄寬按原始數據的長度調整（每欄 84–220 像素）
    const widths = Array.from({ length: p.maxCol }, () => 84);
    for (const [a, v] of this.data) {
      const q = P(a);
      if (!q || q.c > p.maxCol) continue;
      const len = displayValue(v).length;
      widths[q.c - 1] = Math.max(widths[q.c - 1], Math.min(220, 18 + len * 8.6));
    }
    for (const a of this.answer) { const q = P(a); if (q && q.c <= p.maxCol) widths[q.c - 1] = Math.max(widths[q.c - 1], 112); }
    this.colWidths = widths;
    const width = 46 + widths.reduce((x, y) => x + y, 0);
    this.table = h('table.se-table', { style: { width: `${width}px` } }, h('colgroup', h('col', { style: { width: '46px' } }), widths.map((w) => h('col', { style: { width: `${Math.round(w)}px` } }))), h('thead', head), h('tbody', rows));
    this.selBox = h('div.se-selbox');
    this.fillHandle = h('div.se-fillh', { title: '拖曳以填充' });
    this.rangeBox = h('div.se-rangebox');
    this.taskBox = h('div.se-taskbox', { hidden: true });
    this.presenceLayer = h('div.se-presence');
    this.refLayer = h('div.se-refs');
    this.cellEditor = h('input.se-celled', { hidden: true, spellcheck: false, autocomplete: 'off', 'aria-label': '儲存格編輯', inputmode: 'latin' });
    this.cellEditor.addEventListener('input', () => this.onEditorInput(this.cellEditor));
    this.cellEditor.addEventListener('keydown', (e) => this.onEditorKey(e, this.cellEditor));
    this.cellEditor.addEventListener('click', () => this.updateHint(this.cellEditor));
    clear(this.wrap, this.table, this.refLayer, this.taskBox, this.rangeBox, this.selBox, this.fillHandle, this.presenceLayer, this.cellEditor);
    this.table.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.table.addEventListener('dblclick', (e) => { const td = e.target.closest('td'); if (td && !this.readOnly) this.beginEdit(undefined, 'edit'); });
    this.fillHandle.addEventListener('mousedown', (e) => this.onFillDown(e));
    this.refreshAll();
  }

  refreshAll() {
    if (!this.table) return;
    this.wb.recalc();
    for (const [a, td] of this.tds) this.paintCell(a, td);
    this.updateSelection();
    this.drawPresence();
  }

  paintCell(a, td = this.tds.get(a)) {
    if (!td) return;
    const input = this.inputOf(a);
    const isData = this.data.has(a);
    const v = input === null || input === undefined ? null : this.wb.getValue(this.cur.sheet, a);
    const text = this.showFormulas && isFormula(input) ? input : displayValue(v);
    const cls = ['se-c'];
    if (this.answer.has(a)) cls.push(this.editable.has(a) ? 'ans-open' : 'ans-locked');
    else if (isData) cls.push('data');
    if (typeof v === 'number' && !(this.showFormulas && isFormula(input))) cls.push('num');
    if (typeof v === 'boolean') cls.push('bool');
    if (isError(v)) cls.push('err');
    if (this.pending.has(a)) cls.push('pending');
    if (this.highlight?.has(a)) cls.push('task-hl');
    td.className = cls.join(' ');
    td.textContent = text;
    td.title = isError(v) ? `${v.code}：${v.detail || ''}` : isFormula(input) ? input : '';
  }

  changedCells(addrs) {
    this.wb.recalc();
    const set = new Set(addrs);
    for (const [a, td] of this.tds) if (set.has(a) || isFormula(this.inputOf(a))) this.paintCell(a, td);
  }

  // ---------------------------------------------------------------- 選取
  anchorAddr() { return A(this.anchor.c, this.anchor.r); }

  sel() {
    const c1 = Math.min(this.anchor.c, this.focus.c); const c2 = Math.max(this.anchor.c, this.focus.c);
    const r1 = Math.min(this.anchor.r, this.focus.r); const r2 = Math.max(this.anchor.r, this.focus.r);
    return { c1, c2, r1, r2, single: c1 === c2 && r1 === r2, spec: c1 === c2 && r1 === r2 ? A(c1, r1) : `${A(c1, r1)}:${A(c2, r2)}` };
  }

  rectOf(c1, r1, c2, r2) {
    const a = this.tds.get(A(c1, r1)); const b = this.tds.get(A(c2, r2));
    if (!a || !b) return null;
    return { left: a.offsetLeft, top: a.offsetTop, width: b.offsetLeft + b.offsetWidth - a.offsetLeft, height: b.offsetTop + b.offsetHeight - a.offsetTop };
  }

  place(el, rect) {
    if (!rect) { el.hidden = true; return; }
    el.hidden = false;
    Object.assign(el.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  }

  updateSelection(scroll = true) {
    if (!this.table) return;
    const s = this.sel();
    this.place(this.rangeBox, s.single ? null : this.rectOf(s.c1, s.r1, s.c2, s.r2));
    this.place(this.selBox, this.rectOf(this.anchor.c, this.anchor.r, this.anchor.c, this.anchor.r));
    const fr = this.rectOf(s.c2, s.r2, s.c2, s.r2);
    if (fr && !this.readOnly) { this.fillHandle.hidden = false; Object.assign(this.fillHandle.style, { left: `${fr.left + fr.width - 4}px`, top: `${fr.top + fr.height - 4}px` }); } else this.fillHandle.hidden = true;
    for (const th of this.table.querySelectorAll('th.on')) th.classList.remove('on');
    for (let c = s.c1; c <= s.c2; c++) this.table.querySelector(`th.se-colh[data-c="${c}"]`)?.classList.add('on');
    for (let r = s.r1; r <= s.r2; r++) this.table.querySelector(`th.se-rowh[data-r="${r}"]`)?.classList.add('on');
    if (scroll) this.scrollIntoView(this.focus);
    if (!this.editing) this.updateFormulaBar();
    this.updateStatus();
    clearTimeout(this.presTimer);
    this.presTimer = setTimeout(() => this.sendPresence(), 400);
  }

  scrollIntoView(p) {
    const td = this.tds.get(A(p.c, p.r));
    if (!td) return;
    const w = this.scroller;
    const headH = 30; const rowHeadW = 46;
    if (td.offsetTop - headH < w.scrollTop) w.scrollTop = td.offsetTop - headH;
    else if (td.offsetTop + td.offsetHeight > w.scrollTop + w.clientHeight) w.scrollTop = td.offsetTop + td.offsetHeight - w.clientHeight;
    if (td.offsetLeft - rowHeadW < w.scrollLeft) w.scrollLeft = td.offsetLeft - rowHeadW;
    else if (td.offsetLeft + td.offsetWidth > w.scrollLeft + w.clientWidth) w.scrollLeft = td.offsetLeft + td.offsetWidth - w.clientWidth;
  }

  /** 以不同顏色框出公式引用的儲存格／範圍（編輯中或選取公式儲存格時） */
  drawRefs(text) {
    if (!this.refLayer) return;
    clear(this.refLayer);
    if (!isFormula(text)) return;
    const colors = ['#1A73E8', '#D93025', '#188038', '#9334E6', '#E37400', '#12B5CB'];
    const re = /("[^"]*")|(\$?[A-Za-z]{1,3}\$?\d+)(?::(\$?[A-Za-z]{1,3}\$?\d+))?/g;
    let m; let k = 0;
    while ((m = re.exec(text))) {
      if (m[1]) continue;
      const a = P(m[2].replace(/\$/g, '')); const b = m[3] ? P(m[3].replace(/\$/g, '')) : a;
      if (!a || !b) continue;
      const rect = this.rectOf(Math.min(a.c, b.c), Math.min(a.r, b.r), Math.min(Math.max(a.c, b.c), this.payload.maxCol), Math.min(Math.max(a.r, b.r), this.payload.maxRow));
      if (!rect) continue;
      const color = colors[k++ % colors.length];
      this.refLayer.append(h('div.se-ref', { style: { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, borderColor: color, background: `${color}14` } }));
    }
  }

  updateFormulaBar() {
    const a = this.anchorAddr();
    this.nameBox.value = this.sel().spec;
    const input = this.inputOf(a);
    this.fx.value = inputText(input);
    this.fx.readOnly = !this.canEdit(a);
    this.drawRefs(this.sel().single ? input : null);
    const t = this.taskOf.get(a);
    let lock = '';
    if (this.answer.has(a)) lock = this.editable.has(a) ? `✏️ 作答格${t ? `（${t.id}）` : ''}` : `🔒 ${t ? `${t.id} ` : ''}${STATE_LABEL[t?.state] || '暫時不可編輯'}`;
    else if (this.data.has(a)) lock = '🔒 原始數據（受保護）';
    this.lockEl.textContent = this.readOnly ? '👁 唯讀預覽' : lock;
    this.lockEl.className = `se-lock ${this.editable.has(a) ? 'open' : ''}`;
  }

  updateStatus() {
    const s = this.sel();
    const a = this.anchorAddr();
    const v = this.wb?.getValue(this.cur.sheet, a);
    const parts = [];
    if (isError(v)) parts.push(h('span.se-err', `${a}：${v.code} ${v.detail || ''}`));
    if (!s.single) {
      let sum = 0; let n = 0; let cnt = 0;
      for (let r = s.r1; r <= s.r2; r++) for (let c = s.c1; c <= s.c2; c++) {
        const x = this.wb.getValue(this.cur.sheet, A(c, r));
        if (x !== null && x !== undefined && x !== '') cnt++;
        if (typeof x === 'number') { sum += x; n++; }
      }
      parts.push(h('span', `已選取 ${s.spec}　`), n ? h('span', `總和 ${displayValue(sum)}　平均 ${displayValue(sum / n)}　`) : null, h('span', `計數 ${cnt}`));
    } else if (!parts.length) {
      const t = this.taskOf.get(a);
      parts.push(h('span.muted', t ? `${a} 屬於 ${t.id}：${STATE_LABEL[t.state] || t.state}` : this.data.has(a) ? `${a}：原始數據（不可修改）` : a));
    }
    clear(this.status, parts);
  }

  setSelection(anchor, focus = anchor) {
    this.anchor = { ...anchor };
    this.focus = { ...focus };
    this.updateSelection();
  }

  selectAll() { this.setSelection({ c: 1, r: 1 }, { c: this.payload.maxCol, r: this.payload.maxRow }); this.sink.focus({ preventScroll: true }); }
  selectCol(c, extend) { if (extend) this.focus = { c, r: this.payload.maxRow }; else { this.anchor = { c, r: 1 }; this.focus = { c, r: this.payload.maxRow }; } this.updateSelection(false); this.sink.focus({ preventScroll: true }); }
  selectRow(r, extend) { if (extend) this.focus = { c: this.payload.maxCol, r }; else { this.anchor = { c: 1, r }; this.focus = { c: this.payload.maxCol, r }; } this.updateSelection(false); this.sink.focus({ preventScroll: true }); }

  gotoSpec(spec) {
    const t = String(spec || '').trim().toUpperCase();
    const m = /^([A-Z]{1,3}\d+)(?::([A-Z]{1,3}\d+))?$/.exec(t);
    if (!m) { toast('請輸入儲存格位址，例如 D2 或 D2:D21。', 'error'); return; }
    const a = P(m[1]); const b = m[2] ? P(m[2]) : a;
    const clampP = (x) => ({ c: Math.min(Math.max(1, x.c), this.payload.maxCol), r: Math.min(Math.max(1, x.r), this.payload.maxRow) });
    this.setSelection(clampP(a), clampP(b));
    this.sink.focus({ preventScroll: true });
  }

  /** 由題目卡跳到該題的作答範圍，並以外框標示 */
  focusTask(task) {
    if (!task || !this.payload) return;
    const cells = task.cells.flatMap(expand);
    this.highlight = new Set(cells);
    const f = P(task.focus || cells[0]);
    const r = task.cells[0].split(':');
    const s = P(r[0]); const e = P(r[1] || r[0]);
    this.place(this.taskBox, this.rectOf(s.c, s.r, e.c, e.r));
    this.refreshAll();
    this.setSelection(f);
    this.sink.focus({ preventScroll: true });
  }

  move(dr, dc, extend = false) {
    const p = extend ? this.focus : this.anchor;
    const np = { c: Math.min(this.payload.maxCol, Math.max(1, p.c + dc)), r: Math.min(this.payload.maxRow, Math.max(1, p.r + dr)) };
    if (extend) this.focus = np; else { this.anchor = np; this.focus = { ...np }; }
    this.updateSelection();
  }

  /** Ctrl+方向鍵：跳到資料區的邊緣 */
  jump(dr, dc, extend) {
    const p = extend ? { ...this.focus } : { ...this.anchor };
    const filled = (c, r) => { const i = this.inputOf(A(c, r)); return i !== null && i !== undefined && i !== ''; };
    const inside = (c, r) => c >= 1 && r >= 1 && c <= this.payload.maxCol && r <= this.payload.maxRow;
    let c = p.c; let r = p.r;
    const startFilled = filled(c, r);
    const nextFilled = inside(c + dc, r + dr) && filled(c + dc, r + dr);
    if (startFilled && nextFilled) { while (inside(c + dc, r + dr) && filled(c + dc, r + dr)) { c += dc; r += dr; } } else {
      c += dc; r += dr;
      while (inside(c, r) && !filled(c, r)) { c += dc; r += dr; }
      if (!inside(c, r)) { c -= dc; r -= dr; }
    }
    const np = { c: Math.min(this.payload.maxCol, Math.max(1, c)), r: Math.min(this.payload.maxRow, Math.max(1, r)) };
    if (extend) this.focus = np; else { this.anchor = np; this.focus = { ...np }; }
    this.updateSelection();
  }

  // ---------------------------------------------------------------- 滑鼠
  onMouseDown(e) {
    const td = e.target.closest('td');
    if (!td) return;
    const p = P(td.dataset.a);
    if (this.editing && this.pointable()) {
      e.preventDefault();
      this.startPoint(p);
      return;
    }
    if (this.editing) this.commitEdit(null);
    e.preventDefault();
    if (e.shiftKey) this.focus = p; else { this.anchor = p; this.focus = { ...p }; }
    this.updateSelection(false);
    this.sink.focus({ preventScroll: true });
    const onMove = (ev) => {
      const t = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('td');
      if (t && this.tds.get(t.dataset.a) === t) { const q = P(t.dataset.a); if (q.c !== this.focus.c || q.r !== this.focus.r) { this.focus = q; this.updateSelection(false); } }
    };
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // 公式編輯中點選儲存格：插入參照（拖曳則插入範圍）
  pointable() {
    const el = this.editing?.el;
    if (!el) return false;
    const t = el.value;
    if (!t.startsWith('=')) return false;
    if (this.editing.point) return true;
    const before = t.slice(0, el.selectionStart).replace(/\s+$/, '');
    return /[=(,+\-*/^&<>:]$/.test(before);
  }

  startPoint(p) {
    const el = this.editing.el;
    const pos = el.selectionStart;
    let start = pos;
    let end = el.selectionEnd;
    if (this.editing.point && this.editing.point.end === pos) start = this.editing.point.start;
    const put = (text) => {
      el.value = el.value.slice(0, start) + text + el.value.slice(end);
      end = start + text.length;
      el.setSelectionRange(end, end);
      this.editing.point = { start, end, anchor: p };
      this.onEditorInput(el);
    };
    put(A(p.c, p.r));
    const onMove = (ev) => {
      const t = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('td');
      if (!t || this.tds.get(t.dataset.a) !== t) return;
      const q = P(t.dataset.a);
      const a0 = this.editing?.point?.anchor || p;
      put(q.c === a0.c && q.r === a0.r ? A(q.c, q.r) : `${A(Math.min(a0.c, q.c), Math.min(a0.r, q.r))}:${A(Math.max(a0.c, q.c), Math.max(a0.r, q.r))}`);
    };
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); el.focus(); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  onFillDown(e) {
    e.preventDefault();
    e.stopPropagation();
    if (this.editing) this.commitEdit(null);
    const s = this.sel();
    const ghost = h('div.se-fillghost');
    this.wrap.append(ghost);
    let target = null;
    const onMove = (ev) => {
      const t = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('td');
      if (!t || this.tds.get(t.dataset.a) !== t) return;
      const q = P(t.dataset.a);
      const down = q.r - s.r2; const right = q.c - s.c2;
      if (down > 0 && down >= right) target = { dir: 'down', c1: s.c1, r1: s.r2 + 1, c2: s.c2, r2: q.r };
      else if (right > 0) target = { dir: 'right', c1: s.c2 + 1, r1: s.r1, c2: q.c, r2: s.r2 };
      else target = null;
      this.place(ghost, target ? this.rectOf(s.c1, s.r1, target.c2, target.r2) : null);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      ghost.remove();
      if (!target) return;
      this.fillFrom(s, target);
      this.anchor = { c: s.c1, r: s.r1 };
      this.focus = { c: target.c2, r: target.r2 };
      this.updateSelection(false);
      this.sink.focus({ preventScroll: true });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // ---------------------------------------------------------------- 鍵盤（選取模式）
  onGridKey(e) {
    if (!this.payload) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    const arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (arrows[k]) { e.preventDefault(); if (mod) this.jump(...arrows[k], e.shiftKey); else this.move(...arrows[k], e.shiftKey); return; }
    if (k === 'Tab') { e.preventDefault(); this.move(0, e.shiftKey ? -1 : 1); return; }
    if (k === 'Enter') { e.preventDefault(); if (mod) return; this.move(e.shiftKey ? -1 : 1, 0); return; }
    if (k === 'PageDown' || k === 'PageUp') { e.preventDefault(); this.move(k === 'PageDown' ? 20 : -20, 0, e.shiftKey); return; }
    if (k === 'Home') { e.preventDefault(); if (mod) this.setSelection({ c: 1, r: 1 }); else this.setSelection({ c: 1, r: this.anchor.r }); return; }
    if (k === 'F2') { e.preventDefault(); this.beginEdit(undefined, 'edit'); return; }
    if (mod && k === '`') { e.preventDefault(); this.showFormulas = !this.showFormulas; this.refreshAll(); return; }
    if (mod && k.toLowerCase() === 'a') { e.preventDefault(); this.selectAll(); return; }
    if (this.readOnly) return;
    if (mod && k.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); return; }
    if (mod && k.toLowerCase() === 'y') { e.preventDefault(); this.redo(); return; }
    if (mod && k.toLowerCase() === 'd') { e.preventDefault(); this.fill('down'); return; }
    if (mod && k.toLowerCase() === 'r') { e.preventDefault(); this.fill('right'); return; }
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); this.clearSelection(); return; }
    if (!mod && !e.altKey && k.length === 1) {
      e.preventDefault();
      if (/[^\x20-\x7E]/.test(k)) { toast('請只使用半形英文、數字及符號。', 'error'); return; }
      this.beginEdit(k, 'enter');
    }
  }

  // ---------------------------------------------------------------- 編輯
  beginEdit(initial, mode = 'edit', via = null) {
    const a = this.anchorAddr();
    if (this.readOnly) return;
    if (!this.canEdit(a)) { this.explainLocked(a); return; }
    const td = this.tds.get(a);
    const el = via || this.cellEditor;
    const text = initial !== undefined ? initial : inputText(this.inputOf(a));
    this.editing = { a, mode, el, original: this.inputOf(a), point: null };
    this.cellEditor.value = text;
    this.fx.value = text;
    const rect = this.rectOf(this.anchor.c, this.anchor.r, this.anchor.c, this.anchor.r);
    Object.assign(this.cellEditor.style, { left: `${rect.left}px`, top: `${rect.top}px`, minWidth: `${rect.width}px`, height: `${rect.height}px` });
    this.cellEditor.hidden = false;
    td?.classList.add('editing');
    if (el === this.cellEditor) {
      this.cellEditor.focus({ preventScroll: true });
      this.cellEditor.setSelectionRange(text.length, text.length);
    }
    this.onEditorInput(el);
    this.opts.presence && this.sendPresence(true);
  }

  explainLocked(a) {
    const t = this.taskOf.get(a);
    if (this.answer.has(a)) toast(`${a} 現在不可編輯：${t ? `${t.id} ${STATE_LABEL[t.state] || ''}` : ''}${this.payload?.paused ? '（比賽暫停中）' : ''}`, 'error');
    else toast(`${a} 是受保護的原始資料或說明，不可修改。黃色儲存格才是作答格。`, 'error');
  }

  onEditorInput(el) {
    if (!this.editing) return;
    const other = el === this.fx ? this.cellEditor : this.fx;
    other.value = el.value;
    if (this.editing.point && el.selectionStart !== this.editing.point.end) this.editing.point = null;
    this.editing.el = el;
    this.drawRefs(el.value);
    // 中文或全形字元：提示改用英文輸入法
    if (/[^\x00-\x7F]/.test(el.value)) this.hintEl.textContent = '⚠ 公式只需要半形英文、數字及符號（請切換至英文輸入法）';
    this.updateHint(el);
  }

  /** 函數自動完成及參數提示 */
  updateHint(el) {
    const t = el.value;
    const pos = el.selectionStart ?? t.length;
    if (!t.startsWith('=')) { this.hintEl.hidden = true; this.acEl.hidden = true; return; }
    const before = t.slice(0, pos);
    const word = /(^|[=(,+\-*/^&<>:\s])([A-Za-z][A-Za-z.]*)$/.exec(before)?.[2] || '';
    if (word && !/^[A-Za-z]{1,3}\d/.test(word)) {
      const list = SUPPORTED_FUNCTIONS.filter((f) => f.startsWith(word.toUpperCase()) && f !== 'TRUE' && f !== 'FALSE').slice(0, 8);
      this.acList = list;
      this.acIndex = 0;
      this.acWord = word;
      if (list.length && !(list.length === 1 && list[0] === word.toUpperCase())) {
        clear(this.acEl, list.map((f, i) => h(`div.se-ac-item${i === 0 ? '.on' : ''}`, { role: 'option', onmousedown: (e) => { e.preventDefault(); this.acceptAc(f); } }, h('strong', f), h('span', ` ${FUNCTION_HELP[f]?.[1] || ''}`))));
        this.acEl.hidden = false;
      } else this.acEl.hidden = true;
    } else { this.acEl.hidden = true; this.acList = null; }
    // 目前所在的函數及第幾個參數
    let depth = 0; let argIdx = 0; let fn = null;
    for (let i = before.length - 1; i >= 0; i--) {
      const ch = before[i];
      if (ch === '"') { const j = before.lastIndexOf('"', i - 1); if (j < 0) break; i = j; continue; }
      if (ch === ')') depth++;
      else if (ch === '(') {
        if (depth === 0) { fn = /([A-Za-z][A-Za-z.]*)\s*$/.exec(before.slice(0, i))?.[1]?.toUpperCase(); break; }
        depth--;
      } else if (ch === ',' && depth === 0) argIdx++;
    }
    const help = fn && FUNCTION_HELP[fn];
    if (help) {
      const [sig, desc] = help;
      const m = /^([^(]+)\((.*)\)$/.exec(sig);
      const args = m ? m[2].split(/,\s*/) : [];
      clear(this.hintEl, h('span.se-sig', m ? m[1] : fn, '(', args.map((x, i) => [i ? ', ' : '', i === argIdx || (i === args.length - 1 && argIdx >= args.length && /…/.test(x)) ? h('b', x) : x]), ')'), h('span.muted', `　${desc}`));
      this.hintEl.hidden = false;
    } else if (/[^\x00-\x7F]/.test(t)) this.hintEl.hidden = false;
    else this.hintEl.hidden = true;
  }

  acceptAc(f) {
    const el = this.editing?.el;
    if (!el) return;
    const pos = el.selectionStart;
    const start = pos - this.acWord.length;
    el.value = `${el.value.slice(0, start)}${f}(${el.value.slice(pos)}`;
    const np = start + f.length + 1;
    el.focus();
    el.setSelectionRange(np, np);
    this.acEl.hidden = true;
    this.onEditorInput(el);
  }

  onEditorKey(e, el) {
    if (!this.editing) {
      if (e.key === 'Enter' && el === this.fx) { e.preventDefault(); this.sink.focus(); }
      return;
    }
    const k = e.key;
    if (!this.acEl.hidden && this.acList?.length) {
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        e.preventDefault();
        this.acIndex = (this.acIndex + (k === 'ArrowDown' ? 1 : -1) + this.acList.length) % this.acList.length;
        [...this.acEl.children].forEach((c, i) => c.classList.toggle('on', i === this.acIndex));
        return;
      }
      if (k === 'Tab') { e.preventDefault(); this.acceptAc(this.acList[this.acIndex]); return; }
    }
    if (k === 'Enter') {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) { this.commitToSelection(); return; }
      this.commitEdit({ dr: e.shiftKey ? -1 : 1, dc: 0 });
    } else if (k === 'Tab') { e.preventDefault(); this.commitEdit({ dr: 0, dc: e.shiftKey ? -1 : 1 }); }
    else if (k === 'Escape') { e.preventDefault(); this.cancelEdit(); }
    else if (k === 'F4') { e.preventDefault(); this.toggleAbs(el); }
    else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k) && this.editing.mode === 'enter' && !el.value.startsWith('=')) {
      e.preventDefault();
      const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[k];
      this.commitEdit({ dr: d[0], dc: d[1] });
    } else setTimeout(() => this.updateHint(el), 0);
  }

  /** F4：在 A1 → $A$1 → A$1 → $A1 之間切換游標所在的參照 */
  toggleAbs(el) {
    const t = el.value;
    const pos = el.selectionStart;
    const re = /\$?[A-Za-z]{1,3}\$?\d+/g;
    let m;
    while ((m = re.exec(t))) {
      if (pos >= m.index && pos <= m.index + m[0].length) {
        const p = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/.exec(m[0]);
        const state = (p[1] ? 2 : 0) + (p[3] ? 1 : 0); // 0:A1 3:$A$1 1:A$1 2:$A1
        const next = { 0: 3, 3: 1, 1: 2, 2: 0 }[state];
        const rep = `${next & 2 ? '$' : ''}${p[2].toUpperCase()}${next & 1 ? '$' : ''}${p[4]}`;
        el.value = t.slice(0, m.index) + rep + t.slice(m.index + m[0].length);
        const np = m.index + rep.length;
        el.setSelectionRange(np, np);
        this.onEditorInput(el);
        return;
      }
    }
    toast('F4：請把游標放在儲存格參照（例如 H1）上，再按 F4 切換 $。');
  }

  endEditUi() {
    const a = this.editing?.a;
    clear(this.refLayer);
    this.cellEditor.hidden = true;
    this.hintEl.hidden = true;
    this.acEl.hidden = true;
    if (a) this.tds.get(a)?.classList.remove('editing');
    this.editing = null;
  }

  cancelEdit() {
    this.endEditUi();
    this.updateFormulaBar();
    this.sink.focus({ preventScroll: true });
    this.sendPresence(false);
  }

  commitEdit(move) {
    if (!this.editing) return;
    const { a, el } = this.editing;
    const text = el.value;
    if (/[^\x00-\x7F]/.test(text)) { toast('請只使用半形英文、數字及符號（不需要中文字或全形符號）。', 'error'); el.focus(); return; }
    this.endEditUi();
    this.edit([{ a, i: text }]);
    if (move) this.move(move.dr, move.dc);
    else this.updateSelection(false);
    this.sink.focus({ preventScroll: true });
  }

  /** Ctrl+Enter：把輸入填入整個選取範圍（相對參照自動位移） */
  commitToSelection() {
    const { a, el } = this.editing;
    const text = el.value;
    if (/[^\x00-\x7F]/.test(text)) { toast('請只使用半形英文、數字及符號。', 'error'); return; }
    this.endEditUi();
    const s = this.sel();
    const src = P(a);
    const ops = [];
    for (let r = s.r1; r <= s.r2; r++) for (let c = s.c1; c <= s.c2; c++) ops.push({ a: A(c, r), i: shiftFormula(text, r - src.r, c - src.c) });
    this.edit(ops);
    this.sink.focus({ preventScroll: true });
  }

  /** 本機修改：立即顯示，並排隊送到伺服器 */
  edit(ops, { record = true } = {}) {
    const allowed = [];
    let blocked = 0;
    for (const op of ops) {
      if (!this.canEdit(op.a)) { blocked++; continue; }
      const norm = op.i === '' ? null : op.i;
      const before = this.inputOf(op.a);
      if (inputText(before) === inputText(norm)) continue;
      allowed.push({ a: op.a, i: norm, before });
    }
    if (blocked && !allowed.length) { this.explainLocked(ops[0].a); return; }
    if (blocked) toast(`${blocked} 個受保護或未開放的儲存格沒有被修改。`, 'error');
    if (!allowed.length) return;
    for (const op of allowed) {
      const prev = this.pending.get(op.a);
      this.pending.set(op.a, { i: op.i, base: prev ? prev.base : (this.server.get(op.a)?.v ?? 0), sent: false });
      this.wb.setInput(this.cur.sheet, op.a, op.i);
    }
    if (record) { this.undoStack.push(allowed.map(({ a, i, before }) => ({ a, before, after: i }))); if (this.undoStack.length > 100) this.undoStack.shift(); this.redoStack = []; }
    this.changedCells(allowed.map((x) => x.a));
    this.updateSelection(false);
    this.scheduleSend();
  }

  clearSelection() {
    const s = this.sel();
    const ops = [];
    for (let r = s.r1; r <= s.r2; r++) for (let c = s.c1; c <= s.c2; c++) { const a = A(c, r); if (this.canEdit(a) && this.inputOf(a) !== null) ops.push({ a, i: null }); }
    if (!ops.length) { if (!this.canEdit(this.anchorAddr())) this.explainLocked(this.anchorAddr()); return; }
    this.edit(ops);
  }

  undo() {
    const step = this.undoStack.pop();
    if (!step) return toast('沒有可以復原的修改。');
    this.redoStack.push(step);
    this.edit(step.map((x) => ({ a: x.a, i: x.before })), { record: false });
  }

  redo() {
    const step = this.redoStack.pop();
    if (!step) return toast('沒有可以重做的修改。');
    this.undoStack.push(step);
    this.edit(step.map((x) => ({ a: x.a, i: x.after })), { record: false });
  }

  // ---------------------------------------------------------------- 填充、複製、貼上
  fill(dir) {
    const s = this.sel();
    if (dir === 'down') {
      if (s.r1 === s.r2) return toast('請先選取要填充的範圍（例如由 D2 拖到 D21），再按「向下填充」或 Ctrl+D。', 'error');
      this.fillFrom({ c1: s.c1, c2: s.c2, r1: s.r1, r2: s.r1 }, { dir: 'down', c1: s.c1, r1: s.r1 + 1, c2: s.c2, r2: s.r2 });
    } else {
      if (s.c1 === s.c2) return toast('請先選取要向右填充的範圍，再按 Ctrl+R。', 'error');
      this.fillFrom({ c1: s.c1, c2: s.c1, r1: s.r1, r2: s.r2 }, { dir: 'right', c1: s.c1 + 1, r1: s.r1, c2: s.c2, r2: s.r2 });
    }
  }

  fillFrom(src, t) {
    const ops = [];
    const hgt = src.r2 - src.r1 + 1; const wid = src.c2 - src.c1 + 1;
    for (let r = t.r1; r <= t.r2; r++) for (let c = t.c1; c <= t.c2; c++) {
      const sc = t.dir === 'right' ? src.c1 + ((c - src.c1) % wid) : c;
      const sr = t.dir === 'down' ? src.r1 + ((r - src.r1) % hgt) : r;
      ops.push({ a: A(c, r), i: shiftFormula(this.inputOf(A(sc, sr)), r - sr, c - sc) });
    }
    this.edit(ops);
  }

  copyToInternal(cut) {
    const s = this.sel();
    const grid = [];
    for (let r = s.r1; r <= s.r2; r++) {
      const row = [];
      for (let c = s.c1; c <= s.c2; c++) row.push(this.inputOf(A(c, r)));
      grid.push(row);
    }
    const text = grid.map((row, i) => row.map((_, j) => displayValue(this.wb.getValue(this.cur.sheet, A(s.c1 + j, s.r1 + i)))).join('\t')).join('\n');
    this.clip = { sheet: this.cur.sheet, ...s, grid, text, cut };
    toast(`已${cut ? '剪下' : '複製'} ${s.spec}（貼上時相對參照會自動調整）`);
    return text;
  }

  onCopy(e, cut) {
    const text = this.copyToInternal(cut && !this.readOnly);
    e.clipboardData?.setData('text/plain', text);
    e.preventDefault();
  }

  onPaste(e) {
    e.preventDefault();
    if (this.readOnly) return;
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (this.clip && (text === this.clip.text || text === '')) { this.pasteInternal(); return; }
    // 由其他程式貼上：當作文字／數值
    const rows = text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map((r) => r.split('\t'));
    const s = this.sel();
    const ops = [];
    rows.forEach((row, i) => row.forEach((v, j) => ops.push({ a: A(s.c1 + j, s.r1 + i), i: v })));
    if (ops.some((o) => /[^\x00-\x7F]/.test(o.i))) { toast('貼上的內容含中文或全形字元，請只使用半形英文、數字及符號。', 'error'); return; }
    this.edit(ops.filter((o) => P(o.a) && P(o.a).c <= this.payload.maxCol && P(o.a).r <= this.payload.maxRow));
  }

  pasteInternal() {
    if (this.readOnly) return;
    if (!this.clip) return toast('請先選取並複製儲存格（Ctrl+C）。', 'error');
    const clip = this.clip;
    const s = this.sel();
    const ch = clip.r2 - clip.r1 + 1; const cw = clip.c2 - clip.c1 + 1;
    let r2 = s.r2; let c2 = s.c2;
    // 單一儲存格：貼上與複製範圍相同大小；選取範圍是複製範圍的倍數：重複貼上
    if (s.single || (s.r2 - s.r1 + 1) % ch !== 0 || (s.c2 - s.c1 + 1) % cw !== 0) { r2 = s.r1 + ch - 1; c2 = s.c1 + cw - 1; }
    const ops = [];
    for (let r = s.r1; r <= Math.min(r2, this.payload.maxRow); r++) for (let c = s.c1; c <= Math.min(c2, this.payload.maxCol); c++) {
      const i = (r - s.r1) % ch; const j = (c - s.c1) % cw;
      const input = clip.grid[i][j];
      ops.push({ a: A(c, r), i: clip.cut ? input : shiftFormula(input, r - (clip.r1 + i), c - (clip.c1 + j)) });
    }
    if (clip.cut && clip.sheet === this.cur.sheet) {
      const targets = new Set(ops.map((o) => o.a));
      for (let r = clip.r1; r <= clip.r2; r++) for (let c = clip.c1; c <= clip.c2; c++) if (!targets.has(A(c, r)) && this.canEdit(A(c, r))) ops.push({ a: A(c, r), i: null });
      this.clip = null;
    }
    this.edit(ops);
    this.focus = { c: Math.min(c2, this.payload.maxCol), r: Math.min(r2, this.payload.maxRow) };
    this.updateSelection(false);
  }

  // ---------------------------------------------------------------- 同步
  setSave(state, detail = '') {
    this.saveState = state;
    const label = { saved: '✓ 已儲存', saving: '儲存中…', offline: '⚠ 連線中斷：修改未儲存，會自動重試（請勿關閉頁面）', error: `⚠ ${detail}` }[state];
    this.saveEl.textContent = this.readOnly ? '👁 唯讀（即時更新）' : label;
    this.saveEl.className = `se-save ${state}`;
    this.opts.onSaveState?.(state);
  }

  scheduleSend(delay = 150) {
    if (this.readOnly) return;
    this.setSave('saving');
    clearTimeout(this.sendTimer);
    this.sendTimer = setTimeout(() => this.sendNow(), delay);
  }

  async flushNow() {
    clearTimeout(this.sendTimer);
    if (this.pending.size) await this.sendNow();
  }

  async sendNow() {
    if (this.sending) { this.resend = true; return; }
    const batch = [...this.pending].filter(([, p]) => !p.sent);
    if (!batch.length) { if (!this.pending.size) this.setSave('saved'); return; }
    const sheet = this.cur.sheet; const layer = this.cur.layer;
    this.sending = true;
    for (const [, p] of batch) p.sent = true;
    let res = null;
    try {
      res = await this.opts.send(sheet, layer, batch.map(([a, p]) => ({ a, i: p.i, base: p.base })));
      this.retryMs = 1000;
    } catch (e) {
      for (const [a, p] of batch) if (this.pending.get(a) === p) p.sent = false;
      this.sending = false;
      const retryable = !e.status || [502, 503, 504].includes(e.status);
      if (retryable) {
        this.setSave('offline');
        clearTimeout(this.sendTimer);
        this.sendTimer = setTimeout(() => this.sendNow(), this.retryMs);
        this.retryMs = Math.min(15000, this.retryMs * 2);
      } else {
        // 例如老師剛鎖定題目：放棄這些修改並重新載入
        for (const [a, p] of batch) if (this.pending.get(a) === p) this.pending.delete(a);
        toast(e.message, 'error', 6000);
        this.setSave('saved');
        if (sheet === this.cur?.sheet && layer === this.cur?.layer) this.refreshRules();
      }
      return;
    }
    this.sending = false;
    if (!this.cur || sheet !== this.cur.sheet || layer !== this.cur.layer) return;
    const touched = [];
    const sentOf = new Map(batch);
    for (const x of res.applied || []) {
      this.server.set(x.a, { i: x.i, v: x.v, by: x.by });
      const cur = this.pending.get(x.a);
      if (cur === sentOf.get(x.a)) this.pending.delete(x.a);
      else if (cur) cur.base = x.v; // 送出途中再修改同一格：新修改建基於剛確認的版本
      touched.push(x.a);
    }
    const names = new Set();
    for (const x of res.conflicts || []) {
      this.server.set(x.a, { i: x.i, v: x.v, by: x.by });
      this.pending.delete(x.a);
      names.add(x.byName || '隊友');
      touched.push(x.a);
    }
    if (res.conflicts?.length) toast(`${[...names].join('、')} 剛修改了 ${res.conflicts.map((x) => x.a).slice(0, 4).join('、')}${res.conflicts.length > 4 ? ' 等' : ''}：你的修改沒有覆蓋對方，已更新為最新內容。`, 'error', 7000);
    if (res.rejected?.length) {
      for (const x of res.rejected) { if (this.pending.get(x.a) === sentOf.get(x.a)) this.pending.delete(x.a); touched.push(x.a); }
      toast(`${res.rejected.map((x) => x.a).slice(0, 4).join('、')} 現在不可修改（題目已鎖定或受保護）。`, 'error', 6000);
      this.refreshRules();
    }
    for (const a of touched) this.wb.setInput(this.cur.sheet, a, this.data.has(a) ? this.data.get(a) : this.inputOf(a));
    this.changedCells(touched);
    if (this.resend || [...this.pending.values()].some((p) => !p.sent)) { this.resend = false; this.sendNow(); return; }
    this.setSave(this.pending.size ? 'saving' : 'saved');
  }

  /** 由伺服器推送的隊友修改 */
  applyRemote(msg) {
    if (!this.cur || msg.sheet !== this.cur.sheet || (msg.layer || 'main') !== this.cur.layer) return;
    const touched = [];
    for (const op of msg.ops) {
      const s = this.server.get(op.a);
      if (s && s.v >= op.v) continue;
      this.server.set(op.a, { i: op.i, v: op.v, by: op.by });
      if (!this.pending.has(op.a)) touched.push(op.a);
      if (this.editing?.a === op.a && op.by !== this.opts.me) toast(`${msg.by?.name || '隊友'} 剛修改了你正在編輯的 ${op.a}。`, 'error');
    }
    if (!touched.length) return;
    for (const a of touched) this.wb.setInput(this.cur.sheet, a, this.inputOf(a));
    this.changedCells(touched);
    for (const a of touched) { const td = this.tds.get(a); td?.classList.add('flash'); setTimeout(() => td?.classList.remove('flash'), 900); }
    if (!this.editing) this.updateFormulaBar();
    this.updateStatus();
  }

  // ---------------------------------------------------------------- 隊友位置
  sendPresence(editing = !!this.editing) {
    if (this.readOnly || !this.opts.presence || !this.cur) return;
    const spec = this.sel().spec;
    const key = `${this.cur.sheet}|${this.cur.layer}|${spec}|${editing}`;
    if (key === this.lastPresence) return;
    this.lastPresence = key;
    this.opts.presence(this.cur.sheet, this.cur.layer, spec, editing).catch(() => {});
  }

  applyPresence(msg) {
    if (!msg?.user) return;
    if (!this.cur || msg.sheet !== this.cur.sheet || (msg.layer || 'main') !== this.cur.layer) this.presenceMap.delete(msg.user.id);
    else this.presenceMap.set(msg.user.id, { ...msg, seen: Date.now() });
    this.drawPresence();
  }

  drawPresence() {
    if (!this.presenceLayer) return;
    clear(this.presenceLayer);
    const ids = [...this.presenceMap.keys()].sort();
    for (const [id, p] of this.presenceMap) {
      if (Date.now() - p.seen > 120000 || !p.a) continue;
      const [a, b] = p.a.split(':');
      const s = P(a); const e = P(b || a);
      if (!s || !e) continue;
      const rect = this.rectOf(s.c, s.r, Math.min(e.c, this.payload.maxCol), Math.min(e.r, this.payload.maxRow));
      if (!rect) continue;
      const color = PEOPLE_COLORS[ids.indexOf(id) % PEOPLE_COLORS.length];
      const box = h('div.se-peer', { style: { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, borderColor: color } },
        h('span.se-peer-name', { style: { background: color } }, `${p.user.name}${p.editing ? ' ✏️' : ''}`));
      this.presenceLayer.append(box);
    }
  }

  showHelp() {
    const dlg = h('dialog.se-help',
      h('h3', '工作表操作說明'),
      h('ul',
        h('li', '黃色儲存格是作答格；灰色鎖頭表示題目未開放或已完成；其他是受保護的原始數據。'),
        h('li', '直接輸入或按 F2／連按兩下開始編輯；Enter 確認（向下）、Tab 確認（向右）、Esc 取消。'),
        h('li', '輸入公式時（以 = 開始），用滑鼠點選或拖曳儲存格即可插入參照；按 F4 切換 $（絕對參照）。'),
        h('li', '輸入函數名稱會出現建議，按 Tab 選用；公式列下方會顯示函數的參數。'),
        h('li', 'Ctrl+C／Ctrl+V 複製貼上（相對參照自動調整）；拖曳選取框右下角的小方塊可以填充；Ctrl+D 向下填充、Ctrl+R 向右填充。'),
        h('li', '選取範圍後輸入公式再按 Ctrl+Enter，可一次填入整個範圍。'),
        h('li', 'Ctrl+Z 復原、Ctrl+Y 重做；Ctrl+` 顯示／隱藏公式；選取多格時底部會顯示總和、平均及計數。'),
        h('li', '修改會自動儲存並即時同步給隊友。兩人同時修改同一格時，後到的修改不會覆蓋對方，系統會提示並顯示最新內容。')),
      h('button', { type: 'button', onclick: (e) => e.target.closest('dialog').close() }, '關閉'));
    document.body.append(dlg);
    dlg.addEventListener('close', () => dlg.remove());
    dlg.showModal();
  }
}
