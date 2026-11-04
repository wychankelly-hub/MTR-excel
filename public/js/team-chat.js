// 隊伍對話面板（學生）：固定在題目欄底部，編輯工作表時仍然看得到；可按題目分類、複製公式或填入選取的儲存格。
// 訊息以純文字顯示（不使用 innerHTML）。即時訊息經 SSE 送達；重新連線後補回錯過的訊息。
import { api, h, clear, toast, uuid } from './common.js';

const FORMULA = /(=[A-Za-z$][^\s，。、；]*)/g;

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* 非安全環境：改用舊方法 */ }
  const ta = h('textarea', { value: text, style: { position: 'fixed', opacity: '0' } });
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

export class TeamChat {
  /**
   * @param {HTMLElement} root
   * @param {object} opts { me, taskContext(): 目前查看的題目 id, canInsert(): 是否 Driver, insert(text) }
   */
  constructor(root, opts) {
    this.root = root;
    this.opts = opts;
    this.messages = [];
    this.lastId = 0;
    this.filter = 'task';
    this.unread = 0;
    this.allowed = { ok: true, message: '' };
    this.maxLen = 300;
    try { this.open = localStorage.getItem('ty.chatOpen') !== '0'; } catch { this.open = true; }
    this.build();
  }

  build() {
    this.list = h('div.chat-list', { role: 'log', 'aria-live': 'polite' });
    this.input = h('textarea.chat-input', {
      rows: 1, maxLength: this.maxLen, placeholder: '提出想法或公式，例如 =FIND("@",A2)', 'aria-label': '隊伍對話訊息',
      onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.send(); } },
      oninput: () => this.updateCount(),
    });
    this.count = h('small.chat-count.muted', '');
    this.sendBtn = h('button.small.primary', { type: 'button', onclick: () => this.send() }, '發送');
    this.filterSel = h('select.chat-filter', { 'aria-label': '顯示哪些訊息', onchange: (e) => { this.filter = e.target.value; this.renderList(true); } },
      h('option', { value: 'task' }, '本題'), h('option', { value: 'all' }, '全部'));
    this.badge = h('span.chat-badge', { hidden: true });
    this.toggleBtn = h('button.small.ghost', { type: 'button', 'aria-label': '收起或展開隊伍對話', onclick: () => this.setOpen(!this.open) });
    this.note = h('div.chat-note');
    this.ctx = h('small.chat-ctx.muted');
    clear(this.root,
      h('div.chat-head', h('strong', '💬 隊伍對話'), this.badge, this.filterSel, h('span.chat-spacer'), this.toggleBtn),
      h('div.chat-body', this.list, this.note, h('div.chat-form', this.input, h('div.chat-actions', this.ctx, this.count, this.sendBtn))));
    this.setOpen(this.open);
  }

  setOpen(open) {
    this.open = open;
    try { localStorage.setItem('ty.chatOpen', open ? '1' : '0'); } catch { /* 私密模式 */ }
    this.root.classList.toggle('collapsed', !open);
    this.toggleBtn.textContent = open ? '▾ 收起' : '▴ 展開';
    if (open) { this.unread = 0; this.updateBadge(); this.scrollBottom(); }
  }

  updateBadge() {
    this.badge.hidden = !this.unread;
    this.badge.textContent = this.unread > 9 ? '9+' : String(this.unread);
  }

  updateCount() {
    const n = [...this.input.value].length;
    this.count.textContent = n > this.maxLen - 60 ? `${n}/${this.maxLen}` : '';
  }

  setAllowed(allowed, maxLen) {
    this.allowed = allowed || { ok: true };
    if (maxLen) { this.maxLen = maxLen; this.input.maxLength = maxLen; }
    this.input.disabled = !this.allowed.ok;
    this.sendBtn.disabled = !this.allowed.ok;
    this.note.textContent = this.allowed.ok ? '' : this.allowed.message || '對話已關閉。';
    this.note.hidden = this.allowed.ok;
    this.refreshContext();
  }

  /** 學生切換題目或 Driver 改變：更新「本題」篩選及按鈕 */
  refreshContext() {
    const t = this.opts.taskContext();
    this.ctx.textContent = t ? `關於 ${t.split('-').at(-1)}` : '';
    const key = `${t}|${this.opts.canInsert()}`;
    if (key !== this.ctxKey) { this.ctxKey = key; this.renderList(false); }
  }

  async load() {
    try {
      const r = await api('GET', `/chat${this.lastId ? `?after=${this.lastId}` : ''}`);
      this.setAllowed({ ok: r.ok, message: r.message });
      for (const m of r.messages) this.add(m, { silent: true });
      this.renderList(true);
    } catch { /* 下次重新連線再試 */ }
  }

  /** SSE 事件 */
  onEvent(d) {
    if (d.type === 'message') {
      const fresh = this.add(d.message, { silent: false });
      if (fresh) this.renderList(false);
    } else if (d.type === 'delete') {
      const m = this.messages.find((x) => x.id === d.id);
      if (m) { m.deleted = true; m.text = ''; this.renderList(false); }
    }
  }

  add(m, { silent }) {
    if (this.messages.some((x) => x.id === m.id)) return false;
    this.messages.push(m);
    this.messages.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
    this.lastId = Math.max(this.lastId, Number(m.id.slice(1)) || 0);
    if (!silent && !this.open && m.userId !== this.opts.me) { this.unread += 1; this.updateBadge(); }
    return true;
  }

  visible() {
    const t = this.opts.taskContext();
    if (this.filter === 'all' || !t) return this.messages;
    return this.messages.filter((m) => m.taskId === t);
  }

  renderList(forceBottom) {
    const near = this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight < 40;
    const items = this.visible();
    clear(this.list, items.length ? items.map((m) => this.msgEl(m)) : h('p.chat-empty.muted', this.filter === 'task' && this.opts.taskContext() ? '本題未有訊息。說說你的想法，或建議 Driver 試一條公式。' : '未有訊息。'));
    if (forceBottom || near) this.scrollBottom();
  }

  scrollBottom() { requestAnimationFrame(() => { this.list.scrollTop = this.list.scrollHeight; }); }

  msgEl(m) {
    const mine = m.userId === this.opts.me;
    const time = new Date(m.at).toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit', hour12: false });
    const head = h('div.chat-meta', h('strong', mine ? '你' : m.name), ` ${time}`, this.filter === 'all' && m.taskId ? h('span.chat-tag', m.taskId.split('-').at(-1)) : null);
    if (m.deleted) return h('div.chat-msg.deleted', head, h('em.muted', '（老師已刪除此訊息）'));
    return h(`div.chat-msg${mine ? '.mine' : ''}`, head, h('div.chat-text', this.textParts(m.text)));
  }

  textParts(text) {
    const whole = text.trim();
    const parts = whole.startsWith('=') && !whole.includes('\n') ? [whole] : text.split(FORMULA).filter((x) => x !== '');
    return parts.map((p) => (p.startsWith('=') && /^=[A-Za-z$]/.test(p) ? this.formulaEl(p) : p));
  }

  formulaEl(f) {
    return h('span.chat-formula',
      h('code', f),
      h('button.chip', { type: 'button', title: '複製公式', onclick: async () => toast(await copyText(f) ? '已複製公式' : '未能複製，請手動選取', 'ok', 1500) }, '📋'),
      this.opts.canInsert() ? h('button.chip', { type: 'button', title: '填入目前選取的儲存格（之後按 Enter 確認）', onclick: () => this.opts.insert(f) }, '⤵ 填入') : null);
  }

  async send() {
    const text = this.input.value.trim();
    if (!text || !this.allowed.ok) return;
    const clientId = uuid().slice(0, 24);
    this.sendBtn.disabled = true;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const m = await api('POST', '/chat', { text, taskId: this.opts.taskContext(), clientId });
        this.input.value = '';
        this.updateCount();
        this.add(m, { silent: true });
        this.renderList(true);
        break;
      } catch (e) {
        if ((!e.status || [502, 503, 504].includes(e.status)) && attempt < 3) { await new Promise((r) => setTimeout(r, 1000 * (attempt + 1))); continue; }
        toast(e.message, 'error', 4000);
        break;
      }
    }
    this.sendBtn.disabled = !this.allowed.ok;
    this.input.focus();
  }
}
