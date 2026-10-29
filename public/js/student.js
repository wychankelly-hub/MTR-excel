import { api, h, clear, richText, fmtTime, serverClock, stream, toast, uuid, SUB_LABEL, PHASE_LABEL, demoBanner } from './common.js';
import { SheetEditor } from './sheet-editor.js';
import { GameSfx } from './sfx.js';
import { Character, CHARACTERS, REACTIONS } from './characters.js';
import { routeMap, pids, levelTransition } from './rail.js';

const $ = (id) => document.getElementById(id);
let state = null;
let me = null;
let editor = null;
let rulesSig = '';
let wasDown = false;
let viewPractice = null; // 正在做的練習（reopenId）
const practiceInfo = {}; // reopenId -> 練習資料（題目、提交紀錄）
const practiceOf = (rid) => (state?.practice || []).find((p) => p.reopenId === rid);
let mode = null;
let viewLevel = null;
let lastActive = undefined;
let sse = null;
const pending = {};
const activeTask = {}; // level -> taskId
const storyIdx = {}; // level -> 對白索引
let reaction = null;
let lastStoryKey = null; // { kind, text, char, expr, until }
// 學生裝置只播放「遊戲音效」（本隊答對、答錯、完成、解鎖、Bonus、提示）；劇情配音及音樂只在投影畫面播放
const sfx = new GameSfx({ onChange: renderSfxControls });
window.__tySfx = sfx; // 方便測試及除錯
const nameToId = Object.fromEntries(Object.entries(CHARACTERS).map(([id, c]) => [c.name, id]));

async function init() {
  me = (await api('GET', '/me')).user;
  if (!me) { location.href = '/'; return; }
  if (me.role === 'teacher') { location.href = '/teacher'; return; }
  $('logout').onclick = async () => { await api('POST', '/auth/logout'); location.href = '/'; };
  $('switch').onclick = async () => { if (!confirm('離開目前的比賽畫面，輸入另一個比賽代碼？（已提交的分數會保留）')) return; await api('POST', '/student/leave'); location.reload(); };
  $('sound').onclick = () => sfx.setMuted(!sfx.muted);
  $('sfxvol').value = sfx.volume;
  $('sfxvol').oninput = (e) => sfx.setVolume(e.target.value);
  renderSfxControls(sfx.state());
  try {
    setState(await api('GET', '/student/state'));
    connect();
  } catch (e) {
    if (e.code === 'NOT_JOINED') renderJoin(); else clear($('main'), h('div.wrap', h('div.notice.bad', e.message)));
  }
  setInterval(tickTimer, 250);
}

function connect() {
  sse?.close();
  sse = stream('/api/stream?role=student', {
    state: (s) => setState(s),
    cells: (d) => editor?.applyRemote(d),
    presence: (d) => editor?.applyPresence(d),
    sfx: (d) => sfx.handle(d),
  }, (ok) => {
    $('conn').textContent = ok ? '● 已連線' : '重新連線中…';
    $('conn').className = `conn pill ${ok ? 'ok' : 'warn'}`;
    // 重新連線後重新載入工作表，避免錯過斷線期間隊友的修改
    if (ok && wasDown && editor?.cur) editor.open(editor.cur.sheet, editor.cur.layer, { keepSelection: true });
    wasDown = !ok;
  });
}

function renderSfxControls(st) {
  const btn = $('sound');
  if (!btn) return;
  btn.textContent = st.muted ? '🔇' : '🔊';
  btn.title = st.muted ? '音效已靜音（按此開啟）' : '音效開啟（按此靜音）';
  $('sfxvol').disabled = st.muted;
  $('sfxhint').hidden = st.ready || st.muted;
}

function setState(s) {
  state = s;
  serverClock.sync(s.serverNow);
  if (viewPractice && !practiceOf(viewPractice)) { viewPractice = null; if (editor?.cur?.layer !== 'main') editor.tabsKey = null; }
  render();
}

// ---------------------------------------------------------------- 加入比賽
function renderJoin() {
  mode = 'join';
  $('routebar').hidden = true;
  const code = h('input.joincode', { maxlength: 6, autocomplete: 'off', autocapitalize: 'characters', spellcheck: false, placeholder: 'ABC123', 'aria-label': '比賽代碼', inputmode: 'latin', pattern: '[A-Za-z0-9]{6}' });
  const teamsBox = h('div');
  const join = async (teamId) => {
    try {
      await api('POST', '/student/join', { joinCode: code.value, teamId });
      setState(await api('GET', '/student/state'));
      connect();
    } catch (e) { toast(e.message, 'error'); }
  };
  const lookup = async () => {
    try {
      const info = await api('POST', '/student/lookup', { joinCode: code.value });
      const cls = info.classCode ? `${info.classCode} 班` : '';
      clear(teamsBox,
        h('div.notice.info', { style: { marginTop: '16px', fontSize: '1.1rem' } },
          '你即將加入：', h('strong', ` ${cls}《${info.title}》`),
          h('div', { style: { fontSize: '.92rem', marginTop: '4px' } }, '請確認這是你的班別及老師在投影幕顯示的比賽。如不是，請重新輸入代碼。')),
        info.myTeam ? h('div.row', { style: { marginTop: '12px', justifyContent: 'center' } }, h('button.primary.big', { type: 'button', onclick: () => join(info.myTeam.id) }, `返回「${info.myTeam.name}」`))
          : info.teamSelection === 'teacher'
            ? h('div', { style: { textAlign: 'center', marginTop: '12px' } },
              h('p', '這場比賽由老師分隊。加入後請等候老師把你分到隊伍。'),
              h('button.primary.big', { type: 'button', onclick: () => join(null) }, `加入 ${cls}`.trim()))
            : [h('h2', { style: { marginTop: '16px' } }, '選擇你的路綫（隊伍）'),
              h('p.muted', '只可以選擇一次；如選錯，請通知老師轉隊。'),
              h('div.teams-pick', info.teams.map((t) => h('button', {
                type: 'button', style: { background: t.color }, disabled: t.full,
                onclick: () => { if (confirm(`確定加入「${t.name}」？之後只有老師可以為你轉隊。`)) join(t.id); },
              }, h('span', t.name), h('small', { style: { opacity: .9, fontWeight: 500, color: '#fff' } }, `${t.code}・${t.memberCount} 人${t.full ? '（已滿）' : ''}`))))]);
    } catch (e) { clear(teamsBox); toast(e.message, 'error', 7000); }
  };
  code.addEventListener('input', () => { code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); if (code.value.length === 6) lookup(); });
  clear($('main'), h('div.card.joinbox',
    h('div.welcome-cast', ['fatmaster', 'chanding', 'rocket', 'bat'].map((id) => new Character(id, { size: 96 }).el)),
    h('h1', { style: { textAlign: 'center' } }, `歡迎報到，${me.name}！`),
    h('p', { style: { textAlign: 'center' } }, '請輸入投影幕上的 6 位比賽代碼（英文字母及數字）。'),
    h('div.row', { style: { justifyContent: 'center' } }, code, h('button.primary.big', { type: 'button', onclick: lookup }, '下一步')),
    teamsBox));
  code.focus();
}

function renderWaiting() {
  mode = 'waiting';
  $('routebar').hidden = true;
  clear($('team'), h('span.team-chip', { style: { background: '#5B6B7A' } }, state.classCode ? `${state.classCode} 班` : '已加入'));
  clear($('main'), h('div.card.joinbox', { style: { textAlign: 'center' } },
    h('div.welcome-cast', ['fatmaster', 'chanding', 'rocket', 'bat'].map((id) => new Character(id, { size: 96 }).el)),
    h('h1', `已加入${state.classCode ? ` ${state.classCode} 班` : ''}《${state.title}》`),
    h('p', { style: { fontSize: '1.15rem' } }, '請等候老師把你分到隊伍。分隊後畫面會自動更新。'),
    h('p.muted', `你的名稱：${me.name}${me.guestTag ? `（訪客 #${me.guestTag}）` : ''}`)));
}

// ---------------------------------------------------------------- 主畫面
function currentLevel() {
  const started = state.levelDetails || [];
  return started.find((l) => l.phase === 'active') || started.at(-1) || null;
}

function render() {
  if (!state) return;
  $('title').textContent = state.title;
  clear($('banner'), demoBanner(state.demo), state.paused ? h('div.notice.warn', { style: { margin: 0, borderRadius: 0, textAlign: 'center', fontWeight: 800 } }, `⏸ 比賽暫停中：${state.pauseReason || ''}（暫停期間不計時）`) : null);
  if (!state.team) { if (state.waiting) renderWaiting(); else renderJoin(); return; }
  if (mode === 'waiting' || mode === 'join') mode = null;
  const t = state.team;
  document.documentElement.style.setProperty('--line-color', t.color);
  clear($('team'), h('span.team-chip', { style: { background: t.color } }, state.classCode ? h('span.line-chip', { style: { background: 'rgba(0,0,0,.25)' } }, state.classCode) : null, h('span.line-chip', { style: { background: 'rgba(0,0,0,.25)' } }, t.code), t.name));
  $('score').textContent = state.score.total;

  // 新一關開始：列車開出動畫
  const activeNow = state.levels.find((l) => l.phase === 'active')?.level ?? null;
  if (lastActive !== undefined && activeNow && activeNow !== lastActive) {
    const lv = state.levels.find((l) => l.level === activeNow);
    levelTransition({ level: activeNow, title: lv.title, color: t.color });
  }
  if (activeNow !== lastActive) { if (activeNow) viewLevel = activeNow; lastActive = activeNow; }

  const wantMode = state.status === 'RESULTS' || state.status === 'ARCHIVED' ? 'results' : 'play';
  if (mode !== wantMode) {
    mode = wantMode;
    editor = null;
    if (wantMode === 'results') clear($('main'), h('div#results.wrap'));
    else clear($('main'), h('div.play', h('div#panel.panel'), h('div#sheetbox.sheetbox')));
  }
  renderRoute();
  if (mode === 'results') return renderResults();
  renderPanel();
  renderSheetBox();
}

function renderRoute() {
  const bar = $('routebar');
  bar.hidden = false;
  const lv = currentLevel();
  const completed = Object.fromEntries((state.levelDetails || []).map((l) => [l.level, l.teamCompleted]));
  clear(bar,
    h('div.lvl-title', lv ? [h('span.line-chip', { style: { background: state.team.color } }, `L${lv.level}`), lv.title, h(`span.pill.${lv.phase === 'active' ? 'info' : ''}`, PHASE_LABEL[lv.phase]),
      activeTask[lv.level] ? h('span.pill', `現在：${activeTask[lv.level]}`) : null, h('small#savestate.muted', '')] : h('span.muted', '等候發車')),
    routeMap(state.levels, { color: state.team.color, done: (n) => !!completed[n], selected: viewLevel, onSelect: (n) => { viewLevel = n; renderPanel(); renderRoute(); } }),
    h('div'));
}

function renderSheetBox() {
  const box = $('sheetbox');
  const wb = state.team.workbook;
  if (!wb || wb.status !== 'READY') {
    clear(box, h('div.card', h('p.notice.warn', wb?.error || '你們的工作表尚未準備好，請等候老師。')));
    return;
  }
  if (wb.provider === 'google') {
    if (box.dataset.kind !== 'google') {
      box.dataset.kind = 'google';
      clear(box, h('div.card', { style: { height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', gap: '12px' } },
        new Character('chanding', { size: 120 }).el,
        h('h2', '你們的 Google Sheet'),
        h('a.btn.primary.big', { href: wb.url, target: '_blank', rel: 'noopener' }, '開啟我的 Google Sheet ↗'),
        h('p', { style: { maxWidth: '520px' } }, '在 Google Sheets 的黃色儲存格輸入公式，完成後回到這裏按「檢查／提交」。'),
        h('p.muted', '請不要刪除工作表、插入或刪除列／欄，亦不要修改原始數據。')));
    }
    return;
  }
  const levels = state.levelDetails || [];
  if (!levels.length) {
    if (box.dataset.kind !== 'wait') { box.dataset.kind = 'wait'; editor = null; clear(box, h('div.card.sheet-wait', h('h2', '🧮 工作表'), h('p', '老師開始第 1 關後，你們隊的工作表會在這裏出現。'), h('p.muted', '所有作答都在這個網站完成，不需要開啟 Google Sheets。'))); }
    return;
  }
  if (!editor) {
    box.dataset.kind = 'builtin';
    clear(box, h('div#editorroot', { style: { height: '100%' } }));
    // 練習副本（可能屬於之前的劇集）使用練習專用的網址；伺服器檢查學生是否屬於該隊
    const route = (sheet, layer, suffix) => {
      const p = layer && layer !== 'main' ? practiceOf(layer) : null;
      return p ? `/practice/${p.compId}/${p.reopenId}${suffix ? `/${suffix}` : '/sheet'}` : `/sheet/${encodeURIComponent(sheet)}${suffix ? `/${suffix}` : ''}`;
    };
    editor = new SheetEditor($('editorroot'), {
      me: me.id,
      load: (sheet, layer) => api('GET', `${route(sheet, layer)}?layer=${encodeURIComponent(layer || 'main')}`),
      send: (sheet, layer, ops) => api('POST', route(sheet, layer, 'ops'), { layer, ops }),
      presence: (sheet, layer, a, editing) => api('POST', route(sheet, layer, 'presence'), { layer, a, editing }),
      onOpen: (cur) => { const next = cur.layer !== 'main' ? cur.layer : null; if (next !== viewPractice) { viewPractice = next; renderPanel(); } },
      onSaveState: (st) => { const el = $('savestate'); if (el) { el.textContent = st === 'saved' ? '' : st === 'saving' ? '儲存中…' : '⚠ 未儲存'; } },
    });
    window.__tyEditor = editor;
  }
  const tabs = levels.map((l) => ({ sheet: l.sheet, layer: 'main', label: `L${l.level} ${l.title}`, title: l.sheet }));
  for (const p of state.practice || []) tabs.push({ sheet: p.sheet, layer: p.reopenId, label: `📝 練習 ${p.taskId}${p.compId !== state.id ? `（${p.episode}）` : ''}`, practice: true, title: '練習模式：不影響分數' });
  const active = levels.find((l) => l.phase === 'active');
  const key = tabs.map((t) => `${t.sheet}|${t.layer}`).join(',');
  if (editor.tabsKey !== key) {
    editor.tabsKey = key;
    editor.setTabs(tabs, active ? { sheet: active.sheet, layer: 'main' } : null);
  }
  // 題目狀態（開放／鎖定／完成）或暫停改變：更新可編輯範圍
  const sig = JSON.stringify([state.paused, levels.map((l) => [l.level, l.phase, l.tasks.map((t) => t.state)]), (state.practice || []).map((p) => [p.reopenId, p.closed])]);
  if (sig !== rulesSig) { const first = !rulesSig; rulesSig = sig; if (!first) editor.refreshRules(); }
}

function practiceList() {
  const items = state.practice || [];
  if (!items.length) return null;
  return h('div.card.practice-card',
    h('div.section-title', '📝 老師重開的題目（練習，不計分）'),
    items.map((p) => h('div.row', { style: { margin: '4px 0' } },
      h('span', `${p.compId !== state.id ? `${p.episode}・` : ''}L${p.level} ${p.levelTitle}・${p.taskId}`),
      h('button.small.right', { type: 'button', onclick: () => editor?.open(p.sheet, p.reopenId) }, viewPractice === p.reopenId ? '練習中' : '開始練習'))));
}

async function loadPractice(rid) {
  const p = practiceOf(rid);
  if (!p) return null;
  try { practiceInfo[rid] = await api('GET', `/practice/${p.compId}/${p.reopenId}`); } catch (e) { toast(e.message, 'error'); }
  return practiceInfo[rid];
}

function practicePanel(panel) {
  const p = practiceOf(viewPractice);
  if (!p) { viewPractice = null; return false; }
  const info = practiceInfo[viewPractice];
  if (!info) { loadPractice(viewPractice).then(() => renderPanel()); clear(panel, h('div.card', h('p.muted', '載入練習…'))); return true; }
  const t = info.task;
  const latest = info.submissions.filter((x) => ['VERIFIED', 'REJECTED', 'DUPLICATE'].includes(x.status)).at(-1);
  const busy = pending[`P:${viewPractice}`];
  clear(panel,
    h('div.card.lvl-card', { style: { '--line-color': '#7048E8' } },
      h('div.lvl-head', h('span.pill.warn', { style: { whiteSpace: 'nowrap' } }, '📝 練習'), h('h2', `${t.id}（${info.episodeTitle}・L${info.level.level} ${info.level.title}）`)),
      h('p.notice.info', '這是老師重開的練習：在獨立的練習工作表作答，提交不計分、不扣分，亦不會改變排行榜。原來的作答及分數保留。'),
      h('p.goal', h('strong', '🎯 任務目標：'), info.level.storyGoal),
      info.level.rule ? h('div.notice.info', h('strong', '規則：'), richText(info.level.rule)) : null),
    h('div.card',
      h('div.task', { id: `task-${t.id}` },
        h('div.head', h('span.id', t.id), h('span.pill.warn', '練習（不計分）'), latest ? h(`span.pill.${latest.status === 'VERIFIED' ? 'ok' : 'bad'}`, latest.status === 'VERIFIED' ? '練習：全對' : '練習：未全對') : null),
        h('div.task-instr', richText(t.instruction)),
        h('div.submit-row',
          h('button.primary.big', { type: 'button', disabled: busy || info.closed, onclick: () => submitPracticeNow(p) }, busy ? '⏳ 提交中…' : '📝 練習提交'),
          h('button', { type: 'button', onclick: () => editor?.focusTask(t) }, `前往 ${t.cells.join('、')}`)),
        h('ul.mp', t.markingPoints.map((m) => h(`li.${!latest?.markingPoints ? 'none' : latest.markingPoints.find((x) => x.id === m.id)?.passed ? 'pass' : 'fail'}`, `${m.label}（${m.max} 分）`))),
        latest?.message ? h(`div.notice.${latest.status === 'VERIFIED' ? 'ok' : 'warn'}`, latest.message) : null,
        latest?.errors?.length && latest.status !== 'VERIFIED' ? h('ul.feedback', latest.errors.map((e) => h('li', e.text))) : null),
      h('button', { type: 'button', style: { marginTop: '10px' }, onclick: () => { const a = (state.levelDetails || []).find((l) => l.phase === 'active') || (state.levelDetails || []).at(-1); if (a) editor?.open(a.sheet, 'main'); } }, '↩ 返回正式作答')));
  return true;
}

async function submitPracticeNow(p) {
  const k = `P:${p.reopenId}`;
  pending[k] = true;
  renderPanel();
  await editor?.flushNow();
  const idem = uuid();
  let result = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    try { result = await api('POST', `/practice/${p.compId}/${p.reopenId}/submit`, { idempotencyKey: idem }); break; } catch (e) {
      if ((!e.status || [502, 503, 504].includes(e.status)) && attempt < 11) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
      toast(e.message, 'error', 6000);
      break;
    }
  }
  pending[k] = false;
  await loadPractice(p.reopenId);
  if (result) {
    react(result.status === 'VERIFIED' ? 'correct' : 'wrong');
    toast(result.status === 'VERIFIED' ? `練習 ${p.taskId}：全對 ✓（不計分）` : `練習 ${p.taskId}：${result.earned}/${result.max}，請再試試`, result.status === 'VERIFIED' ? 'ok' : 'error');
  }
  renderPanel();
}

function renderPanel() {
  const panel = $('panel');
  if (!panel) return;
  if (viewPractice && practicePanel(panel)) return;
  const started = state.levelDetails || [];
  if (!started.length) {
    clear(panel, h('div.card', { style: { textAlign: 'center' } },
      h('div.welcome-cast', ['fatmaster', 'chanding', 'rocket', 'bat'].map((id) => new Character(id, { size: 82 }).el)),
      h('h2', state.episodeStarted ? '老師即將開始第 1 關' : '等候老師開始'),
      h('p', '比賽開始後，這裏會顯示每一關的任務。所有答案只需要英文、數字、符號及公式。'),
      teamCard()), practiceList());
    return;
  }
  if (!viewLevel || !started.some((l) => l.level === viewLevel)) viewLevel = currentLevel().level;
  const lv = started.find((l) => l.level === viewLevel);
  const pub = state.levels.find((l) => l.level === lv.level);
  const canSubmit = lv.phase === 'active' && !state.paused && pub.remainingMs > 0;
  const blockedByCaptain = state.team.captainOnlySubmit && !state.team.isCaptain;
  const tasks = lv.tasks;
  if (!activeTask[lv.level] || !tasks.some((t) => t.id === activeTask[lv.level])) {
    activeTask[lv.level] = (tasks.find((t) => t.best < t.points && !t.bonus) || tasks[0]).id;
  }
  const task = tasks.find((t) => t.id === activeTask[lv.level]);
  const story = storyBox(lv);
  clear(panel,
    h('div.card.lvl-card', { style: { '--line-color': state.team.color } },
      h('div.lvl-head', h('span.line-chip', { style: { background: state.team.color } }, `L${lv.level}`), h('h2', `第 ${lv.level} 關　${lv.title}`), h(`span.pill.right.${lv.phase === 'active' ? 'info' : 'ok'}`, PHASE_LABEL[lv.phase])),
      h('p.goal', { style: { marginTop: '8px' } }, h('strong', '🎯 任務目標：'), lv.storyGoal),
      lv.rule ? h('div.notice.info', h('strong', '規則：'), richText(lv.rule)) : null,
      lv.safetyNote ? h('small.muted', `※ ${lv.safetyNote}`) : null,
      lv.successEffect ? h('div.notice.ok', '🎉 ', lv.successEffect) : null),
    reactionBox(),
    h('div.card',
      h('div.task-tabs', tasks.map((t) => h(`button.task-tab${t.id === task.id ? '.on' : ''}${t.best === t.points ? '.done' : ''}${t.latest && t.latest.status === 'REJECTED' ? '.bad' : ''}`, {
        type: 'button', onclick: () => { activeTask[lv.level] = t.id; renderPanel(); gotoTask(lv, t); },
      }, t.state === 'locked' ? '🔒 ' : '', t.bonus ? '★ Bonus' : t.id.split('-')[1], t.best === t.points ? ' ✓' : ''))),
      taskCard(lv, task, canSubmit && !blockedByCaptain),
      blockedByCaptain ? h('p.notice.warn', '老師設定了只由隊長提交；你可以協助檢查及分析。') : null),
    story ? h('div.card', { style: { padding: '10px' } }, story) : null,
    lv.roles ? h('div.row', Object.values(lv.roles).map((r) => h(`span.pill${r.isMe ? '.info' : ''}`, `${r.label.split('（')[0]}：${r.name}${r.isMe ? '（你）' : ''}`))) : null,
    practiceList(),
    hintCard(lv),
    scoreCard(lv),
    lv.review ? reviewCard(lv) : null);
}

function storyBox(lv) {
  const lines = lv.phase === 'ended' && lv.closing?.length ? lv.closing : lv.dialogue || [];
  if (!lines.length) return null;
  const i = Math.min(storyIdx[lv.level] ?? 0, lines.length - 1);
  const line = lines[i];
  const id = nameToId[line.speaker] || 'passenger';
  const ch = new Character(id, { size: 74 });
  const key = `${lv.level}:${lv.phase}:${i}`;
  if (key !== lastStoryKey) { lastStoryKey = key; ch.setTalking(true); setTimeout(() => ch.setTalking(false), 1800); }
  const go = (d) => { storyIdx[lv.level] = (i + d + lines.length) % lines.length; renderPanel(); };
  return h('div.story',
    h('div.speech', ch.el, h('div.bubble', { style: { '--who': CHARACTERS[id]?.color } }, h('span.bubble-name', line.speaker), h('div.bubble-text', `「${line.text}」`))),
    lines.length > 1 ? h('div.story-nav',
      h('button.small.ghost', { type: 'button', onclick: () => go(-1), 'aria-label': '上一句' }, '◀'),
      h('div.story-dots', lines.map((_, k) => h(`span${k === i ? '.on' : ''}`))),
      h('button.small.ghost', { type: 'button', onclick: () => go(1), 'aria-label': '下一句' }, '▶')) : null);
}

function reactionBox() {
  if (!reaction || Date.now() > reaction.until) return h('div#react');
  const ch = new Character(reaction.char, { size: 58 });
  ch.setExpression(reaction.expr);
  if (!reaction.shown) { reaction.shown = true; ch.el.classList.add(reaction.kind === 'good' ? 'hop' : 'shake'); }
  return h(`div#react.react.${reaction.kind}`, ch.el, h('div', h('div', { style: { fontSize: '.78rem', fontWeight: 900, color: CHARACTERS[reaction.char].color } }, CHARACTERS[reaction.char].name), h('div.react-text', reaction.text)));
}

function react(kind) {
  const pool = REACTIONS[kind] || REACTIONS.correct;
  const [char, expr, text] = pool[Math.floor(Math.random() * pool.length)];
  reaction = { kind: ['correct', 'levelClear'].includes(kind) ? 'good' : 'bad', char, expr, text, until: Date.now() + 5000 };
  setTimeout(() => { if (reaction && Date.now() > reaction.until) { reaction = null; renderPanel(); } }, 5200);
}

function gotoTask(lv, t) {
  if (!editor) return;
  const go = () => editor.focusTask(t);
  if (editor.cur?.sheet !== lv.sheet || editor.cur?.layer !== 'main') editor.open(lv.sheet, 'main').then(go); else go();
}

const TASK_STATE = { active: ['info', '開放作答'], locked: ['', '🔒 未開放'], completed: ['ok', '✓ 已完成（已鎖定）'], closed: ['', '已截止'], reopened: ['warn', '老師已重開'] };

function taskCard(lv, t, canSubmit) {
  if (t.state === 'locked') {
    return h('div.task', { style: { marginTop: '10px' }, id: `task-${t.id}` },
      h('div.head', h('span.id', t.id), h('span.pill', '🔒 未開放')),
      h('p.notice.info', '老師稍後會開放這一題。開放前不能編輯或提交。'));
  }
  canSubmit = canSubmit && (t.state === 'active' || t.state === 'completed');
  const latest = t.latest;
  const done = t.best === t.points;
  const mpState = (id) => (!latest?.markingPoints ? 'none' : latest.markingPoints.find((m) => m.id === id)?.passed ? 'pass' : 'fail');
  const statusPill = latest ? h(`span.pill.${latest.status === 'VERIFIED' ? 'ok' : ['RETRYABLE_ERROR', 'INTEGRITY_ERROR', 'DUPLICATE'].includes(latest.status) ? 'warn' : 'bad'}`, SUB_LABEL[latest.status] || latest.status) : null;
  return h(`div.task${done ? '.done' : ''}`, { style: { marginTop: '10px' }, id: `task-${t.id}` },
    h('div.head', h('span.id', t.id), t.bonus ? h('span.pill.warn', 'Bonus +50（非必答）') : null, h('span.pill', `${t.best}/${t.points} 評分點`), TASK_STATE[t.state] ? h(`span.pill.${TASK_STATE[t.state][0]}`, TASK_STATE[t.state][1]) : null, t.cancelled ? h('span.pill.warn', '老師已取消此題') : null, statusPill),
    h('div.task-instr', richText(t.instruction)),
    h('div.submit-row',
      h('button.primary.big', { type: 'button', disabled: !canSubmit || pending[t.id] || t.cancelled, onclick: () => submit(t.id) }, pending[t.id] ? '⏳ 提交中…' : done ? '✓ 已核實（可再提交）' : '🚆 檢查／提交'),
      editor ? h('button', { type: 'button', onclick: () => gotoTask(lv, t) }, `前往 ${t.cells.join('、')}`) : null),
    h('small.muted', latest ? `上次提交：${new Date(latest.at).toLocaleTimeString('zh-HK', { hour12: false })}・已批改 ${t.attempts} 次` : '提交時系統會讀取你們工作表的公式及計算結果，並以隱藏測試數據檢查。'),
    h('ul.mp', t.markingPoints.map((m) => h(`li.${done ? 'pass' : mpState(m.id)}`, `${m.label}（${m.max} 分）`))),
    latest?.message ? h(`div.notice.${latest.status === 'VERIFIED' ? 'ok' : 'warn'}`, latest.message) : null,
    latest?.errors?.length && latest.status !== 'VERIFIED' ? h('ul.feedback', latest.errors.map((e) => h('li', e.text))) : null,
    latest?.status === 'VERIFIED' ? h('div.notice.ok', '已核實：所有評分點正確（包括隱藏測試）。') : null);
}

async function submit(taskId) {
  pending[taskId] = true;
  renderPanel();
  // 先確保工作表的修改已儲存，提交時伺服器才會讀到最新的公式
  await editor?.flushNow();
  if (editor?.pending.size) {
    pending[taskId] = false;
    renderPanel();
    toast('工作表的修改仍未儲存（連線中斷），請稍候自動重試後再提交。', 'error', 7000);
    return;
  }
  const key = uuid();
  const lvBefore = currentLevel();
  let result = null;
  // 網絡中斷或伺服器重新啟動（雲端平台回覆 502／503／504，約需 1 分鐘）：
  // 以同一 Idempotency Key 自動重試約 3 分鐘 —— 已收到的答案不會重複計分，未收到的會補交
  const waits = [1, 2, 3, 5, 5, 10, 10, 15, 15, 15, 15, 15, 15, 15, 15, 15];
  for (let attempt = 0; ; attempt++) {
    try {
      result = await api('POST', '/student/submit', { taskId, idempotencyKey: key });
      break;
    } catch (e) {
      const retryable = !e.status || [502, 503, 504].includes(e.status);
      if (retryable && attempt < waits.length) {
        if (attempt === 1) toast('伺服器重新連線中，正在自動重試提交…（答案不會遺失或重複計分）', 'info', 8000);
        await new Promise((r) => setTimeout(r, waits[attempt] * 1000));
        continue;
      }
      toast(e.message, 'error', 6000);
      break;
    }
  }
  pending[taskId] = false;
  try { setState(await api('GET', '/student/state')); } catch { renderPanel(); }
  if (!result) return;
  const lv = (state.levelDetails || []).find((l) => l.level === lvBefore?.level);
  if (result.status === 'VERIFIED') {
    if (lv?.teamCompleted) react('levelClear'); else react('correct');
    toast(`${taskId} 已核實 ✓`, 'ok');
    // 自動前往下一題未完成的題目
    const next = lv?.tasks.find((t) => t.best < t.points && !t.bonus && !t.cancelled);
    if (next) activeTask[lv.level] = next.id;
  } else if (result.status === 'REJECTED') {
    react(result.earned > 0 ? 'partial' : 'wrong');
    toast(`${taskId} 未通過：${result.earned}/${result.max}，請查看提示。`, 'error');
  } else if (result.status === 'RETRYABLE_ERROR') {
    react('sync');
    toast(result.message || SUB_LABEL[result.status], 'error', 6000);
  } else {
    toast(result.message || SUB_LABEL[result.status], 'error', 6000);
  }
  renderPanel();
  const card = document.getElementById(`task-${taskId}`) || document.querySelector('.task');
  card?.classList.add(result.status === 'VERIFIED' ? 'flash-ok' : 'flash-bad');
}

function hintCard(lv) {
  const used = lv.hints.length;
  const next = used + 1;
  const cost = next === 1 ? 10 : 20;
  return h('div.card',
    h('div.row',
      h('div', { style: { width: '44px' } }, new Character('bat', { size: 44 }).el),
      h('h3', { style: { margin: 0 } }, '八仔提示'),
      used < lv.hintCount ? h('button.small.right', {
        type: 'button', disabled: lv.phase !== 'active' || state.paused,
        onclick: async () => {
          if (!confirm(`使用第 ${next} 級提示會扣 ${cost} 分，確定嗎？`)) return;
          try { await api('POST', '/student/hint', { level: lv.level }); setState(await api('GET', '/student/state')); } catch (e) { toast(e.message, 'error'); }
        },
      }, `💡 第 ${next} 級提示（−${cost} 分）`) : h('small.right.muted', '提示已全部使用')),
    lv.hints.map((x) => h('div.hint', h('strong', `提示 ${x.tier}：`), richText(x.text))));
}

function scoreCard(lv) {
  const s = lv.score;
  return h('details.card',
    h('summary', `本關分數：${s.total}`),
    h('table', h('tbody', s.lines.map((l) => h('tr', h('td', l.label), h('td.num', l.delta > 0 ? `+${l.delta}` : String(l.delta)))))),
    h('small.muted', '基礎分上限 500（按評分點比例）。錯誤提交每次 −5（每關最多 −20）；同步失敗不扣分。'));
}

function reviewCard(lv) {
  return h('div.card',
    h('div.section-title', '📘 回合回顧'),
    lv.closing?.length ? h('div.dialogue', lv.closing.map((d) => h('div.line', h('span.speaker', `${d.speaker}：`), h('span', `「${d.text}」`)))) : null,
    h('details', { open: true }, h('summary', '可得分公式（回合已結束）'),
      h('ul', Object.entries(lv.review.references).map(([id, refs]) => h('li', h('strong', `${id}：`), refs.map((r, i) => [i ? '；' : '', h('code', r)]))))),
    lv.review.cards.length ? h('details', h('summary', '常見錯誤與 Keyword'),
      lv.review.cards.map((c) => h('div', { style: { margin: '8px 0', paddingLeft: '10px', borderLeft: '4px solid var(--line)' } },
        h('div', '錯誤公式：', h('code', c.wrong)),
        h('div', '錯在甚麼地方：', c.why),
        h('div', 'Keyword：', h('strong', c.keyword)),
        h('div', '可得分公式：', h('code', c.fixed)),
        h('div', 'Question Clue：', c.clue)))) : null);
}

function teamCard() {
  const t = state.team;
  return h('div', { style: { marginTop: '10px', textAlign: 'left' } },
    h('div.section-title', `${t.name} 隊員`),
    h('div.row', t.members.map((m) => h('span.pill', m.name, m.captain ? '（隊長）' : ''))),
    h('p.muted', { style: { marginTop: '10px' } }, '每一關會輪流擔任 Driver（輸入公式）、Formula Detective（分析題目）、Checker（檢查結果）。'));
}

function renderResults() {
  const box = $('results');
  const mine = state.leaderboard?.find((r) => r.teamId === state.team.id);
  const top = (state.leaderboard || []).slice(0, 3);
  const order = [top[1], top[0], top[2]].filter(Boolean);
  clear(box,
    state.reveal ? h('div.card', { style: { textAlign: 'center' } }, h('div.muted', '秘密字詞'), h('div', { style: { fontSize: '3.2rem', fontWeight: 900, letterSpacing: '.3em', color: 'var(--accent)' } }, state.reveal.word), h('div', { style: { fontWeight: 800 } }, state.reveal.teaser)) : null,
    h('div.card', { style: { textAlign: 'center' } },
      h('h1', '🏁 比賽結果'),
      mine ? h('p', { style: { fontSize: '1.2rem' } }, `你們的名次：第 ${mine.rank} 名・${mine.total} 分`) : h('p', `你們的總分：${state.score.total} 分`),
      order.length ? h('div.podium', order.map((r) => h('div', { style: { background: r.color, height: `${r.rank === 1 ? 150 : r.rank === 2 ? 115 : 90}px` } }, h('div', { style: { fontSize: '1.8rem' } }, r.rank), r.name, h('div', r.total)))) : null,
      state.leaderboard ? h('table', h('thead', h('tr', h('th', '名次'), h('th', '隊伍'), h('th.num', '基礎分'), h('th.num', '總分'))),
        h('tbody', state.leaderboard.map((r) => h('tr', h('td', r.rank), h('td', h('span.dot', { style: { background: r.color } }), ' ', r.name), h('td.num', r.baseTotal), h('td.num', h('strong', r.total)))))) : h('p.muted', '排名暫時隱藏。')),
    h('div.card', h('div.section-title', '各關回顧'), (state.levelDetails || []).filter((l) => l.review).map((l) => h('details', h('summary', `第 ${l.level} 關 ${l.title}`), reviewCard(l)))));
}

function tickTimer() {
  if (!state?.levels) return;
  const active = state.levels.find((l) => l.phase === 'active');
  const box = $('pidsbox');
  if (!active) { if (box.childElementCount) clear(box); return; }
  const remain = active.running ? active.remainingMs - (serverClock.now() - state.serverNow) : active.remainingMs;
  if (!box.firstChild || box.dataset.level !== String(active.level)) { box.dataset.level = active.level; clear(box, pids({ label: `L${active.level} 尚餘` })); }
  const el = box.firstChild;
  el.querySelector('[data-pids-time]').textContent = `${state.paused ? '⏸ ' : ''}${fmtTime(remain)}`;
  el.classList.toggle('low', remain <= 60000);
  el.classList.toggle('paused', !!state.paused);
}

init();
