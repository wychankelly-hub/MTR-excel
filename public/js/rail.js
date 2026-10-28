// 鐵路風格介面元件（原創設計，不使用任何官方標誌）：
// 路線圖進度、月台顯示屏（PIDS）倒數、列車開出動畫、即時「列車競賽」排行榜。
import { h, clear, fmtTime } from './common.js';

export function trainSVG(color = '#C8102E') {
  return `<svg viewBox="0 0 64 28" class="train-svg" aria-hidden="true">
    <path d="M4 6 Q4 3 7 3 H50 Q60 3 62 14 Q62 22 56 22 H7 Q4 22 4 19 Z" fill="#F4F6F8" stroke="#2A2F35" stroke-width="2"/>
    <path d="M4 15 H61" stroke="${color}" stroke-width="4"/>
    <rect x="10" y="7" width="9" height="6" rx="1.5" fill="#2A2F35"/><rect x="23" y="7" width="9" height="6" rx="1.5" fill="#2A2F35"/><rect x="36" y="7" width="9" height="6" rx="1.5" fill="#2A2F35"/>
    <path d="M50 7 H54 Q58 8 59 13 H50 Z" fill="#2A2F35"/>
    <circle cx="14" cy="24" r="3" fill="#2A2F35"/><circle cx="48" cy="24" r="3" fill="#2A2F35"/>
  </svg>`;
}

/**
 * 路線圖：五個車站（L1–L5），已完成實心、進行中閃動、列車停在目前車站。
 * levels：publicView.levels；done(level) 可選，回傳該隊是否完成該關。
 */
export function routeMap(levels, { color = '#C8102E', done = () => false, onSelect = null, selected = null } = {}) {
  const active = levels.find((l) => l.phase === 'active');
  const lastStarted = [...levels].reverse().find((l) => l.phase !== 'pending');
  const at = active || lastStarted;
  const idx = at ? levels.indexOf(at) : -1;
  const pct = idx < 0 ? 0 : (idx / (levels.length - 1)) * 100;
  const wrap = h('div.route', { style: { '--line': color } },
    h('div.route-track', h('div.route-fill', { style: { width: `${pct}%` } }), h('div.route-train', { style: { left: `${pct}%` }, html: trainSVG(color) })),
    h('div.route-stations', levels.map((l) => {
      const cls = [l.phase, done(l.level) ? 'cleared' : '', selected === l.level ? 'selected' : ''].filter(Boolean).join(' ');
      const st = h(`button.station.${cls.split(' ').join('.')}`, {
        type: 'button', disabled: !onSelect || l.phase === 'pending', title: `第 ${l.level} 關 ${l.title}`,
        onclick: onSelect ? () => onSelect(l.level) : null,
      }, h('span.station-dot', done(l.level) ? '✓' : String(l.level)), h('span.station-name', l.title));
      return st;
    })));
  return wrap;
}

/** 月台顯示屏風格倒數 */
export function pids({ label = '', remainingMs = null, paused = false, sub = '' } = {}) {
  const low = remainingMs !== null && remainingMs <= 60000;
  return h(`div.pids${low ? '.low' : ''}${paused ? '.paused' : ''}`,
    h('div.pids-label', label),
    h('div.pids-time', { 'data-pids-time': '' }, remainingMs === null ? '--:--' : fmtTime(remainingMs)),
    sub ? h('div.pids-sub', sub) : null);
}

/** 新一關開始：列車駛過並顯示「第 n 關 開出」（約 1.8 秒，不攔截操作） */
export function levelTransition({ level, title, color = '#C8102E', text = null }) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const el = h('div.depart', { style: { '--line': color }, 'aria-hidden': 'true' },
    h('div.depart-band',
      h('div.depart-train', { html: trainSVG(color) + trainSVG(color) }),
      h('div.depart-text', h('span.depart-no', `L${level}`), h('span', text || `第 ${level} 關「${title}」列車開出`))));
  document.body.append(el);
  setTimeout(() => el.remove(), 2200);
}

/** 數字滾動 */
export function countUp(el, to, ms = 700) {
  const from = Number(el.dataset.v ?? to);
  el.dataset.v = to;
  if (from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = to; return; }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    el.textContent = Math.round(from + (to - from) * (1 - (1 - k) ** 3));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
}

/**
 * 即時「列車競賽」排行榜：每隊一條路線，列車按完成進度前進；名次改變時平滑移動（FLIP）。
 * rows：leaderboard rows（publicRankRow）。
 */
export class RaceBoard {
  constructor(root, { compact = false, highlight = null } = {}) {
    this.root = root;
    this.compact = compact;
    this.highlight = highlight;
    this.rows = new Map();
    this.list = h('div.race');
    clear(root, this.list);
  }

  update(rows) {
    if (!rows) { clear(this.list, h('div.race-hidden', '排行榜暫時隱藏')); this.rows.clear(); return; }
    if (this.list.querySelector('.race-hidden')) clear(this.list);
    const before = new Map([...this.rows].map(([id, r]) => [id, r.el.getBoundingClientRect().top]));
    const seen = new Set();
    for (const r of rows) {
      seen.add(r.teamId);
      let item = this.rows.get(r.teamId);
      if (!item) {
        item = this.make(r);
        this.rows.set(r.teamId, item);
      }
      const totalTasks = Object.values(r.progress).reduce((s, p) => s + p.total, 0) || 1;
      const doneTasks = Object.values(r.progress).reduce((s, p) => s + p.done, 0);
      item.el.classList.toggle('me', r.teamId === this.highlight);
      item.el.classList.toggle('leader', r.rank === 1 && r.total > 0);
      item.rank.textContent = r.rank;
      countUp(item.score, r.total);
      item.base.textContent = `基礎 ${r.baseTotal}`;
      item.train.style.left = `${(doneTasks / totalTasks) * 100}%`;
      item.fill.style.width = `${(doneTasks / totalTasks) * 100}%`;
      item.stations.forEach((s, i) => s.classList.toggle('cleared', !!r.progress[i + 1]?.completed));
      this.list.append(item.el);
    }
    for (const [id, item] of this.rows) if (!seen.has(id)) { item.el.remove(); this.rows.delete(id); }
    // FLIP：名次變化時由舊位置滑到新位置
    for (const [id, item] of this.rows) {
      const old = before.get(id);
      if (old === undefined) continue;
      const dy = old - item.el.getBoundingClientRect().top;
      if (Math.abs(dy) > 2) {
        item.el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], { duration: 600, easing: 'cubic-bezier(.2,.8,.2,1)' });
      }
    }
  }

  make(r) {
    const stations = [1, 2, 3, 4, 5].map((n) => h('span.lane-stop', { title: `L${n}` }));
    const fill = h('div.lane-fill');
    const train = h('div.lane-train', { html: trainSVG(r.color) });
    const rank = h('div.race-rank');
    const score = h('div.race-score');
    const base = h('div.race-base');
    const el = h('div.race-row', { style: { '--line': r.color } },
      rank,
      h('div.race-main',
        h('div.race-name', h('span.line-chip', { style: { background: r.color } }, r.code), r.name),
        h('div.lane', h('div.lane-track', fill), h('div.lane-stops', stations), train)),
      h('div.race-pts', score, base));
    return { el, rank, score, base, train, fill, stations };
  }
}
