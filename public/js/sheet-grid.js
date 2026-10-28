// Demo 模擬工作表（只在 Demo 比賽使用，並清楚標示不是 Google Sheets）。
// 支援：選取／範圍選取、公式列、Enter 確認、Delete 清除、Ctrl+C / Ctrl+V（相對參照自動位移）、Ctrl+D 向下填充。
import { h, clear, toast } from './common.js';

const colName = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const colIdx = (s) => [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
const parse = (a) => { const m = /^([A-Z]+)(\d+)$/.exec(a); return { col: colIdx(m[1]), row: Number(m[2]) }; };
const A = (col, row) => `${colName(col)}${row}`;

function expand(spec) {
  const [a, b] = spec.split(':');
  const s = parse(a); const e = b ? parse(b) : s;
  const out = [];
  for (let r = s.row; r <= e.row; r++) for (let c = s.col; c <= e.col; c++) out.push(A(c, r));
  return out;
}

export class SheetGrid {
  constructor(root, { load, edit, paste }) {
    Object.assign(this, { root, load, edit, paste });
    this.sheets = [];
    this.current = null;
    this.data = null;
    this.anchor = { col: 1, row: 1 };
    this.focus = { col: 1, row: 1 };
    this.clipboard = null;
    this.busy = false;
    this.build();
  }

  build() {
    this.tabsEl = h('div.sheet-tabs', { role: 'tablist' });
    this.addrEl = h('span.addr', 'A1');
    this.input = h('input', { 'aria-label': '公式列', placeholder: '輸入公式，例如 =SUM(B2:C2)，按 Enter 確認', autocomplete: 'off', spellcheck: false, inputmode: 'latin' });
    this.input.addEventListener('keydown', (e) => this.onInputKey(e));
    this.input.addEventListener('compositionstart', () => toast('公式只需要英文、數字及符號，請切換至英文輸入法。', 'error'));
    this.lockEl = h('span.pill.warn', { hidden: true }, '🔒 受保護');
    const fill = h('button', { type: 'button', title: 'Ctrl+D', onclick: () => this.fillDown() }, '⬇ 向下填充');
    const copy = h('button', { type: 'button', title: 'Ctrl+C', onclick: () => this.copy() }, '複製');
    const pasteBtn = h('button', { type: 'button', title: 'Ctrl+V', onclick: () => this.pasteSel() }, '貼上');
    this.tableWrap = h('div.grid-scroll', { tabindex: 0, 'aria-label': '模擬工作表儲存格' });
    this.tableWrap.addEventListener('keydown', (e) => this.onGridKey(e));
    this.status = h('small.muted', '');
    clear(this.root,
      h('div.sheet-wrap',
        h('div.sheet-head', h('strong', '🧪 模擬工作表（Demo，非 Google Sheets）'), h('span', '黃色儲存格可以作答・Ctrl+C／Ctrl+V 複製貼上・Ctrl+D 向下填充'), h('span.right', this.status)),
        this.tabsEl,
        h('div.fx', this.addrEl, h('span.fxlabel', 'fx'), this.input, this.lockEl, fill, copy, pasteBtn),
        this.tableWrap));
  }

  setSheets(list, preferred) {
    this.sheets = list;
    clear(this.tabsEl, list.map((s) => h('button', { type: 'button', role: 'tab', className: s === this.current ? 'active' : '', onclick: () => this.open(s) }, s)));
    const target = preferred && list.includes(preferred) ? preferred : list.includes(this.current) ? this.current : list.at(-1);
    if (target !== this.current) this.open(target);
  }

  async open(sheet, { keepSelection = false } = {}) {
    this.current = sheet;
    [...this.tabsEl.children].forEach((b) => b.classList.toggle('active', b.textContent === sheet));
    try {
      this.data = await this.load(sheet);
    } catch (e) {
      toast(e.message, 'error');
      return;
    }
    if (!keepSelection) {
      const first = this.data.editable?.[0]?.split(':')[0];
      const p = first ? parse(first) : { col: 1, row: 1 };
      this.anchor = { ...p };
      this.focus = { ...p };
    }
    this.render();
  }

  async refresh() {
    if (this.current && !this.busy && document.activeElement !== this.input) await this.open(this.current, { keepSelection: true });
  }

  editableSet() {
    if (!this.data) return new Set();
    if (!this._edCache || this._edCache.src !== this.data) this._edCache = { src: this.data, set: new Set((this.data.editable || []).flatMap(expand)) };
    return this._edCache.set;
  }

  selRange() {
    const c1 = Math.min(this.anchor.col, this.focus.col); const c2 = Math.max(this.anchor.col, this.focus.col);
    const r1 = Math.min(this.anchor.row, this.focus.row); const r2 = Math.max(this.anchor.row, this.focus.row);
    return { c1, c2, r1, r2, spec: c1 === c2 && r1 === r2 ? A(c1, r1) : `${A(c1, r1)}:${A(c2, r2)}` };
  }

  render() {
    const d = this.data;
    if (!d) return;
    const ed = this.editableSet();
    const sel = this.selRange();
    const head = h('tr', h('th', ''), Array.from({ length: d.maxCol }, (_, i) => h('th', colName(i + 1))));
    const body = [];
    for (let r = 1; r <= d.maxRow; r++) {
      const cells = [h('th', String(r))];
      for (let c = 1; c <= d.maxCol; c++) {
        const a = A(c, r);
        const cell = d.cells[a];
        const v = cell?.v ?? '';
        const isNum = v !== '' && !Number.isNaN(Number(v)) && typeof cell?.i !== 'boolean';
        const isErr = typeof v === 'string' && v.startsWith('#');
        const cls = [ed.has(a) ? 'ed' : 'prot', isNum ? 'n' : '', isErr ? 'err' : '', c >= sel.c1 && c <= sel.c2 && r >= sel.r1 && r <= sel.r2 ? 'inrange' : '', c === this.focus.col && r === this.focus.row ? 'sel' : ''].filter(Boolean).join(' ');
        cells.push(h('td', { className: cls, 'data-a': a, title: cell?.e || (typeof cell?.i === 'string' && cell.i.startsWith('=') ? cell.i : '') }, String(v)));
      }
      body.push(h('tr', cells));
    }
    const table = h(`table.grid${this.current === 'START' ? '.wide' : ''}`, h('thead', head), h('tbody', body));
    table.addEventListener('mousedown', (e) => {
      const td = e.target.closest('td');
      if (!td) return;
      e.preventDefault();
      const p = parse(td.dataset.a);
      if (e.shiftKey) this.focus = p; else { this.anchor = p; this.focus = p; }
      this.dragging = true;
      this.updateSelection();
      this.tableWrap.focus({ preventScroll: true });
    });
    table.addEventListener('mouseover', (e) => {
      if (!this.dragging) return;
      const td = e.target.closest('td');
      if (td) { this.focus = parse(td.dataset.a); this.updateSelection(); }
    });
    table.addEventListener('dblclick', (e) => { if (e.target.closest('td')) this.beginEdit(); });
    window.addEventListener('mouseup', () => { this.dragging = false; }, { once: true });
    const scroll = { top: this.tableWrap.scrollTop, left: this.tableWrap.scrollLeft };
    clear(this.tableWrap, table);
    Object.assign(this.tableWrap, { scrollTop: scroll.top, scrollLeft: scroll.left });
    this.table = table;
    this.updateFormulaBar();
  }

  updateSelection() {
    const sel = this.selRange();
    for (const td of this.table.querySelectorAll('td.inrange, td.sel')) td.classList.remove('inrange', 'sel');
    for (let r = sel.r1; r <= sel.r2; r++) for (let c = sel.c1; c <= sel.c2; c++) this.table.querySelector(`td[data-a="${A(c, r)}"]`)?.classList.add('inrange');
    const f = this.table.querySelector(`td[data-a="${A(this.focus.col, this.focus.row)}"]`);
    f?.classList.add('sel');
    // 只捲動工作表本身，不捲動整個頁面
    if (f) {
      const w = this.tableWrap;
      const headH = 34; const rowHead = 48;
      if (f.offsetTop - headH < w.scrollTop) w.scrollTop = f.offsetTop - headH;
      else if (f.offsetTop + f.offsetHeight > w.scrollTop + w.clientHeight) w.scrollTop = f.offsetTop + f.offsetHeight - w.clientHeight;
      if (f.offsetLeft - rowHead < w.scrollLeft) w.scrollLeft = f.offsetLeft - rowHead;
      else if (f.offsetLeft + f.offsetWidth > w.scrollLeft + w.clientWidth) w.scrollLeft = f.offsetLeft + f.offsetWidth - w.clientWidth;
    }
    window.addEventListener('mouseup', () => { this.dragging = false; }, { once: true });
    this.updateFormulaBar();
  }

  updateFormulaBar() {
    const a = A(this.anchor.col, this.anchor.row);
    const sel = this.selRange();
    this.addrEl.textContent = sel.spec;
    const cell = this.data.cells[a];
    const raw = cell?.i;
    this.input.value = raw === null || raw === undefined ? '' : raw === true ? 'TRUE' : raw === false ? 'FALSE' : String(raw);
    const editable = this.editableSet().has(a);
    this.input.readOnly = !editable;
    this.lockEl.hidden = editable;
    this.status.textContent = cell?.e ? `⚠ ${a}：${cell.e}` : '';
  }

  beginEdit(initial) {
    const a = A(this.anchor.col, this.anchor.row);
    if (!this.editableSet().has(a)) { toast(`${a} 是受保護的原始資料，不能修改。`, 'error'); return; }
    this.input.focus();
    if (initial !== undefined) this.input.value = initial;
    this.input.setSelectionRange(this.input.value.length, this.input.value.length);
  }

  async commit(move = { dr: 1, dc: 0 }) {
    const a = A(this.anchor.col, this.anchor.row);
    if (!this.editableSet().has(a)) return;
    const value = this.input.value;
    if (/[^\x00-\x7F]/.test(value)) { toast('請只使用半形英文、數字及符號（不需要中文字或全形符號）。', 'error'); return; }
    await this.run(() => this.edit(this.current, [{ addr: a, input: value }]));
    this.move(move.dr, move.dc, false);
    this.tableWrap.focus({ preventScroll: true });
  }

  async run(fn) {
    this.busy = true;
    try {
      this.data = await fn();
      this.render();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      this.busy = false;
    }
  }

  move(dr, dc, extend) {
    const d = this.data;
    const p = extend ? this.focus : this.anchor;
    const np = { col: Math.min(d.maxCol, Math.max(1, p.col + dc)), row: Math.min(d.maxRow, Math.max(1, p.row + dr)) };
    if (extend) this.focus = np; else { this.anchor = np; this.focus = { ...np }; }
    this.updateSelection();
  }

  onInputKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); this.commit({ dr: 1, dc: 0 }); }
    else if (e.key === 'Tab') { e.preventDefault(); this.commit({ dr: 0, dc: 1 }); }
    else if (e.key === 'Escape') { e.preventDefault(); this.updateFormulaBar(); this.tableWrap.focus(); }
  }

  onGridKey(e) {
    const mod = e.ctrlKey || e.metaKey;
    const arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (arrows[e.key]) { e.preventDefault(); this.move(...arrows[e.key], e.shiftKey); return; }
    if (mod && e.key.toLowerCase() === 'c') { e.preventDefault(); this.copy(); return; }
    if (mod && e.key.toLowerCase() === 'v') { e.preventDefault(); this.pasteSel(); return; }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); this.fillDown(); return; }
    if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); this.beginEdit(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.clearSel(); return; }
    if (!mod && e.key.length === 1 && /[\x20-\x7E]/.test(e.key)) { e.preventDefault(); this.beginEdit(e.key); }
  }

  copy() {
    const sel = this.selRange();
    this.clipboard = { sheet: this.current, spec: sel.spec, h: sel.r2 - sel.r1 + 1, w: sel.c2 - sel.c1 + 1 };
    toast(`已複製 ${sel.spec}（貼上時相對參照會自動調整）`);
  }

  async pasteSel() {
    if (!this.clipboard) return toast('請先選取並複製儲存格。', 'error');
    if (this.clipboard.sheet !== this.current) return toast('只可以在同一工作表內貼上。', 'error');
    const sel = this.selRange();
    let target = sel.spec;
    if (sel.c1 === sel.c2 && sel.r1 === sel.r2 && (this.clipboard.h > 1 || this.clipboard.w > 1)) {
      target = `${A(sel.c1, sel.r1)}:${A(sel.c1 + this.clipboard.w - 1, sel.r1 + this.clipboard.h - 1)}`;
    }
    await this.run(() => this.paste(this.current, this.clipboard.spec, target));
  }

  async fillDown() {
    const sel = this.selRange();
    if (sel.r1 === sel.r2) return toast('請先選取要向下填充的範圍（例如由 D2 拖到 D21），再按「向下填充」。', 'error');
    await this.run(() => this.paste(this.current, `${A(sel.c1, sel.r1)}:${A(sel.c2, sel.r1)}`, `${A(sel.c1, sel.r1 + 1)}:${A(sel.c2, sel.r2)}`));
  }

  async clearSel() {
    const sel = this.selRange();
    const ed = this.editableSet();
    const edits = [];
    for (let r = sel.r1; r <= sel.r2; r++) for (let c = sel.c1; c <= sel.c2; c++) if (ed.has(A(c, r))) edits.push({ addr: A(c, r), input: '' });
    if (!edits.length) return toast('受保護的儲存格不能清除。', 'error');
    await this.run(() => this.edit(this.current, edits));
  }

  /** 跳到某題的作答格 */
  goto(sheet, addr) {
    const go = () => { const p = parse(addr); this.anchor = p; this.focus = { ...p }; this.updateSelection(); this.tableWrap.focus({ preventScroll: true }); };
    if (sheet !== this.current) this.open(sheet).then(go); else go();
  }
}
