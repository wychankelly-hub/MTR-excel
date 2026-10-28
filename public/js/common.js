// 前端共用工具（無需建置步驟）。
export async function api(method, url, body) {
  const res = await fetch(`/api${url}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await res.json(); } catch { /* 非 JSON */ }
  if (!res.ok) {
    const err = new Error(data?.error || `網絡錯誤（${res.status}）`);
    err.status = res.status;
    err.code = data?.code;
    throw err;
  }
  return data;
}

/** h('div.class#id', {attrs}, ...children) */
export function h(tag, attrs, ...children) {
  const m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i.exec(String(tag).replace(/[.#]+$/, '').replace(/\.{2,}/g, '.'));
  if (!m) throw new Error(`h(): 無效標籤 ${tag}`);
  const el = document.createElement(m[1] || 'div');
  for (const part of (m[2] || '').match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1);
  }
  if (attrs !== null && attrs !== undefined && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { children.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && k !== 'list' && k !== 'form') { try { el[k] = v; } catch { el.setAttribute(k, v); } }
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 題目文字：支援 `code` 及 **粗體**（先轉義，安全） */
export function richText(s) {
  const span = document.createElement('span');
  span.innerHTML = esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
  return span;
}

export function fmtTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtClock(ts) {
  return new Date(ts).toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

/** 伺服器時間偏差（倒數以伺服器時間為準，客戶端只負責顯示） */
export const serverClock = {
  offset: 0,
  sync(serverNow) { this.offset = serverNow - Date.now(); },
  now() { return Date.now() + this.offset; },
};

/** SSE 連線，自動重連；斷線時呼叫 onStatus(false) */
export function stream(url, handlers, onStatus) {
  let es;
  let retry = 1000;
  const connect = () => {
    es = new EventSource(url);
    es.onopen = () => { retry = 1000; onStatus?.(true); };
    for (const [ev, fn] of Object.entries(handlers)) es.addEventListener(ev, (e) => fn(JSON.parse(e.data)));
    es.onerror = () => {
      onStatus?.(false);
      es.close();
      setTimeout(connect, retry);
      retry = Math.min(retry * 2, 10000);
    };
  };
  connect();
  return { close: () => es?.close() };
}

export function toast(msg, kind = 'info', ms = 3500) {
  let box = document.getElementById('toasts');
  if (!box) { box = h('div#toasts'); document.body.append(box); }
  const t = h(`div.toast.${kind}`, { role: kind === 'error' ? 'alert' : 'status' }, msg);
  box.append(t);
  setTimeout(() => t.remove(), ms);
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '');
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

export const STATUS_LABEL = {
  DRAFT: '草稿', PREFLIGHT: '數據預檢', APPROVED: '已批准', LOBBY: '等候大堂', RESULTS: '結果', ARCHIVED: '已封存',
  PAUSED: '暫停中', CANCELLED: '已取消',
  RUNNING_LEVEL_1: '第 1 關', RUNNING_LEVEL_2: '第 2 關', RUNNING_LEVEL_3: '第 3 關', RUNNING_LEVEL_4: '第 4 關', RUNNING_LEVEL_5: '第 5 關',
};

export const PHASE_LABEL = { pending: '未開始', active: '進行中', ended: '已結束', skipped: '已略過' };

export const SUB_LABEL = {
  SUBMITTING: '提交中', RECEIVED: '已收到', VALIDATING: '驗證中', VERIFIED: '已核實 ✓', REJECTED: '未通過',
  RETRYABLE_ERROR: '同步失敗', INTEGRITY_ERROR: '資料完整性錯誤', DUPLICATE: '與上次相同',
};

export function demoBanner(isDemo) {
  if (!isDemo) return null;
  return h('div.demo-banner', { role: 'note' }, '🧪 DEMO 模擬模式：工作表為伺服器模擬，並非真實 Google Sheets。批改引擎與正式模式相同。');
}
