// 投影端（觀眾畫面）：角色劇情、對白字幕、倒數、即時列車競賽排行榜。只取得公開資料。
import { api, h, clear, fmtTime, serverClock, stream, STATUS_LABEL, demoBanner } from './common.js';
import { StoryStage, createAudioDevice, remainingOf } from './stage.js';
import { routeMap, pids, RaceBoard, levelTransition } from './rail.js';

const $ = (id) => document.getElementById(id);
const qs = new URLSearchParams(location.search);
const compId = qs.get('comp');
const key = qs.get('key');
let state = null;
let joinCode = null;
let lastActive;
let revealShown = false;
const shownClears = new Set();

window.__tyStage = null;
const stage = new StoryStage({ castEl: $('cast'), bubbleEl: $('bubble'), size: 170 });
const board = new RaceBoard($('race'));
const device = createAudioDevice({
  role: 'projector',
  stage,
  report: (s) => api('POST', `/projector/${compId}/status?key=${encodeURIComponent(key)}`, s).catch(() => {}),
  onSfx: (msg) => {
    if (!msg.team) return;
    ticker(msg.kind === 'level_clear' ? `🎉 ${msg.team.name} 完成第 ${msg.level} 關！` : `🚉 ${msg.team.name} 完成一題`, msg.team.color, msg.kind === 'level_clear');
    window.__tyTicks = (window.__tyTicks || 0) + 1;
    stage.react(msg.kind === 'level_clear' ? 'fatmaster' : 'chanding', 'happy');
  },
  onState: (s, isOutput) => {
    const other = s.designated && !isOutput;
    $('audio-state').textContent = isOutput ? `🔊 此投影畫面正在播放劇情聲音${s.muted ? '（靜音）' : ''}`
      : !s.enabled ? '🔇 聲音未啟用（只顯示字幕）'
        : other ? '🔈 另一個投影畫面正在播放聲音，此畫面只顯示字幕' : '⏳ 連接中…';
    $('enable').hidden = !!s.enabled;
    $('claim').hidden = !(s.enabled && other);
    $('overlay').hidden = !!s.enabled || overlayDismissed;
    $('mute').textContent = s.muted ? '取消靜音' : '靜音';
  },
});

// 一次性啟用：按畫面任何位置
// 一次性啟用（瀏覽器自動播放限制）：按大按鈕或畫面任何位置；之後所有劇情自動播放
let overlayDismissed = false;
const enableOnce = async () => { document.removeEventListener('pointerdown', enableOnce); await device.enable(); };
document.addEventListener('pointerdown', enableOnce);
$('enable').onclick = () => device.enable();
$('enable2').onclick = () => device.enable();
$('nosound').onclick = (e) => { e.stopPropagation(); overlayDismissed = true; $('overlay').hidden = true; document.removeEventListener('pointerdown', enableOnce); };
$('claim').onclick = () => device.claim();
$('mute').onclick = () => device.player.control(device.player.muted ? 'unmute' : 'mute');
$('vol').oninput = (e) => device.player.control('volume', e.target.value);
$('replay').onclick = () => device.player.replay();
$('skip').onclick = () => device.player.control('skip');
$('bgmbtn').onclick = () => device.player.setBgmWanted(!device.player.bgmWanted);

function ticker(text, color, big = false) {
  const el = h(`div.tick${big ? '.big' : ''}`, { style: { '--c': color } }, text);
  $('ticker').prepend(el);
  while ($('ticker').childElementCount > 4) $('ticker').lastChild.remove();
  setTimeout(() => el.remove(), big ? 7000 : 4500);
}

async function init() {
  if (!compId || !key) { clear($('bubble'), h('p.notice.bad', '投影連結不完整，請由老師控制台開啟。')); return; }
  try {
    setState(await api('GET', `/projector/${compId}?key=${encodeURIComponent(key)}`));
  } catch (e) { clear($('bubble'), h('p.notice.bad', e.message)); return; }
  stream(`/api/stream?role=projector&comp=${encodeURIComponent(compId)}&key=${encodeURIComponent(key)}`, {
    state: setState,
    audio: (m) => device.onAudio(m),
  }, (ok) => { $('conn').textContent = ok ? '● 已連線' : '重新連線中…'; $('conn').className = `pill right ${ok ? 'ok' : 'warn'}`; });
  setInterval(tick, 250);
}

function setState(s) {
  state = s;
  serverClock.sync(s.serverNow);
  device.onPublicState(s);
  for (const l of s.levels) {
    if (l.firstClear && !shownClears.has(l.level)) {
      if (shownClears.size || lastActive !== undefined) ticker(`🏆 ${l.firstClear.name} 率先完成第 ${l.level} 關！`, l.firstClear.color, true);
      shownClears.add(l.level);
    }
  }
  const activeNow = s.levels.find((l) => l.phase === 'active')?.level ?? null;
  if (lastActive !== undefined && activeNow && activeNow !== lastActive) levelTransition({ level: activeNow, title: s.levels[activeNow - 1].title });
  lastActive = activeNow;
  render();
}

function render() {
  $('title').textContent = state.title;
  $('subtitle').textContent = `${state.episodeTitle || ''}${state.classCode ? `・${state.classCode}` : ''}`;
  $('status').textContent = state.paused ? '⏸ 暫停中' : STATUS_LABEL[state.status] || state.status;
  const lv = state.levels.find((l) => l.phase === 'active') || [...state.levels].reverse().find((l) => l.phase !== 'pending');
  clear($('lvl'), lv ? [h('span.line-chip', { style: { background: 'var(--accent)', fontSize: '1rem', height: '1.9em' } }, `L${lv.level}`), h('strong', { style: { fontSize: '1.3rem' } }, lv.title)] : null);
  clear($('banner'), demoBanner(state.demo), state.paused ? h('div.notice.warn', { style: { margin: 0, borderRadius: 0, fontSize: '1.4rem', textAlign: 'center', fontWeight: 900 } }, `⏸ 比賽暫停中（暫停期間不計時）${state.pauseReason ? `：${state.pauseReason}` : ''}`) : null);
  clear($('route'), routeMap(state.levels, { color: '#D12B2B' }));
  // 調查線索（L1–L4 只暗示時段異常）
  clear($('clues'), state.reveal ? null : state.levels.filter((l) => l.clue && l.level < state.levels.length).map((l) => h('div.clue', `🔎 L${l.level}：${l.clue}`)));
  renderOverlay(lv);
  board.update(state.leaderboard);
  $('board').querySelector('h2').replaceChildren('🚆 即時排行榜', state.leaderboardState.frozen ? h('span.pill.warn', '❄ 已凍結') : '');
}

async function renderOverlay(lv) {
  const box = $('overlaybox');
  if (state.reveal) {
    if (!revealShown) {
      revealShown = true;
      clear(box, h('div.reveal', h('div.reveal-word', [...state.reveal.word].map((c, i) => h('span', { style: { animationDelay: `${0.25 * i}s` } }, c))), h('div', h('div.reveal-teaser', state.reveal.teaser))));
      stage.celebrate();
    }
    return;
  }
  revealShown = false;
  const lobby = !lv;
  if (!lobby) { clear(box); return; }
  if (!joinCode) {
    try { joinCode = (await api('GET', `/projector/${compId}/join?key=${encodeURIComponent(key)}`)).joinCode; } catch { /* 比賽已結束 */ }
  }
  if (box.dataset.code === joinCode && box.childElementCount) return;
  box.dataset.code = joinCode || '';
  clear(box, h('div.lobby', h('div.joinsign',
    h('div', { style: { color: '#B8C4CF', fontWeight: 700 } }, '學生登入後輸入比賽代碼'),
    h('div.joinbig', joinCode || '······'),
    h('div', { style: { fontWeight: 700 } }, `${location.origin}/student`))));
}

function tick() {
  if (!state) return;
  const active = state.levels.find((l) => l.phase === 'active');
  const box = $('pidsbox');
  if (!active) { if (box.childElementCount) clear(box); return; }
  const remain = remainingOf(active, state);
  if (!box.firstChild || box.dataset.level !== String(active.level)) { box.dataset.level = active.level; clear(box, pids({ label: `第 ${active.level} 關 尚餘時間` })); }
  box.firstChild.querySelector('[data-pids-time]').textContent = fmtTime(remain);
  box.firstChild.classList.toggle('low', remain <= 60000);
  box.firstChild.classList.toggle('paused', !!state.paused);
  device.onTimer(remain, active.running && !state.paused);
}

init();

window.__ty = { device };
