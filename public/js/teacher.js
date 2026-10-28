import { api, h, clear, richText, fmtTime, fmtClock, serverClock, stream, toast, STATUS_LABEL, PHASE_LABEL, SUB_LABEL, demoBanner } from './common.js';
import { routeMap, RaceBoard, levelTransition } from './rail.js';
import { Character, CHARACTERS } from './characters.js';
import { StoryStage, createAudioDevice, remainingOf } from './stage.js';

const $ = (id) => document.getElementById(id);
let me = null;
let cfg = null;
let comps = [];
let comp = null; // teacherView
let compId = null;
let tab = 'setup';
let sse = null;
let dirty = false;
let sys = null;

const TABS = [
  ['setup', 'A. 設定'], ['teams', 'B. 隊伍'], ['preflight', 'C. 數據預檢'], ['live', 'D. 即時控制'],
  ['diag', 'E. 即時診斷'], ['results', 'F. 結果'], ['audio', '配音資產'], ['chars', '角色圖片'], ['system', '系統狀態'], ['audit', '審計紀錄'],
];

async function act(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg, 'ok');
    await reload();
    return r;
  } catch (e) {
    toast(e.message, 'error', 7000);
    return null;
  }
}

const post = (path, body) => api('POST', `/teacher/competitions/${compId}${path}`, body ?? {});

// 老師控制台只顯示劇情字幕，不播放劇情聲音（聲音只由指定的投影畫面播放）
const dockStage = new StoryStage({ castEl: document.getElementById('dock-cast'), bubbleEl: document.getElementById('dock-bubble'), size: 64, idleText: '劇情字幕會在這裏同步顯示（聲音由投影畫面播放）' });
const device = createAudioDevice({
  role: 'teacher',
  stage: dockStage,
  onState: (st) => {
    const el = document.getElementById('dock-audio');
    if (el) el.textContent = st.designated ? '🔊 聲音由投影畫面播放' : '🔇 投影畫面尚未啟用聲音';
  },
});
let lastActiveLevel;
window.__ty = { device }; // 方便測試及除錯：檢查播放裝置狀態

async function init() {
  me = (await api('GET', '/me')).user;
  if (!me) { location.href = '/'; return; }
  if (me.role !== 'teacher') { location.href = '/student'; return; }
  cfg = await api('GET', '/config');
  $('who').textContent = `${me.name}${me.provider === 'demo' ? '（Demo）' : ''}`;
  $('logout').onclick = async () => { await api('POST', '/auth/logout'); location.href = '/'; };
  const hashTab = location.hash.replace('#', '').split('?')[0];
  if (TABS.some(([k]) => k === hashTab)) tab = hashTab;
  sys = await api('GET', '/system/status').catch(() => null);
  await loadComps();
  compId = localStorage.getItem('ty.comp');
  if (!comps.some((c) => c.id === compId)) compId = comps[0]?.id || null;
  $('comp-pick').onchange = (e) => selectComp(e.target.value || null);
  await selectComp(compId);
  setInterval(tickTimer, 250);
  document.addEventListener('focusout', () => setTimeout(() => { if (dirty && !editing()) { dirty = false; renderView(); } }, 50));
}

async function loadComps() {
  comps = await api('GET', '/teacher/competitions');
  clear($('comp-pick'), h('option', { value: '' }, '＋ 新增比賽'), comps.map((c) => h('option', { value: c.id, selected: c.id === compId }, `${c.title}${c.classCode ? ` · ${c.classCode}` : ''}（${STATUS_LABEL[c.status] || c.status}${c.adapter === 'demo' ? '・Demo' : ''}）`)));
}

async function selectComp(id) {
  compId = id;
  try { localStorage.setItem('ty.comp', id || ''); } catch { /* 私密模式 */ }
  sse?.close();
  comp = null;
  $('comp-pick').value = id || '';
  if (!id) { tab = 'setup'; renderAll(); return; }
  await reload();
  sse = stream(`/api/stream?role=teacher&comp=${encodeURIComponent(id)}`, {
    state: (s) => { comp = s; serverClock.sync(s.serverNow); onComp(); if (editing()) dirty = true; else renderAll(); },
    audio: (m) => device.onAudio(m),
  }, (ok) => { $('conn').textContent = ok ? '即時連線' : '重新連線中…'; $('conn').className = `conn pill ${ok ? 'ok' : 'warn'}`; });
}

async function reload() {
  if (!compId) return;
  comp = await api('GET', `/teacher/competitions/${compId}`);
  serverClock.sync(comp.serverNow);
  onComp();
  renderAll();
}

function onComp() {
  device.onPublicState(comp);
  const active = comp.levels.find((l) => l.phase === 'active')?.level ?? null;
  if (lastActiveLevel !== undefined && active && active !== lastActiveLevel) levelTransition({ level: active, title: comp.levels[active - 1].title });
  lastActiveLevel = active;
}

function editing() {
  const a = document.activeElement;
  return a && $('view').contains(a) && ['INPUT', 'SELECT', 'TEXTAREA'].includes(a.tagName) && a.type !== 'checkbox' && a.type !== 'range';
}

function renderAll() {
  const opt = comp && [...$('comp-pick').options].find((o) => o.value === comp.id);
  if (opt) opt.textContent = `${comp.title}${comp.classCode ? ` · ${comp.classCode}` : ''}（${STATUS_LABEL[comp.status] || comp.status}${comp.demo ? '・Demo' : ''}）`;
  $('status').textContent = comp ? (STATUS_LABEL[comp.status] || comp.status) : '未選擇比賽';
  clear($('banner'), comp ? demoBanner(comp.demo) : null, comp?.paused ? h('div.notice.warn', { style: { margin: 0, borderRadius: 0 } }, `⏸ 比賽暫停中：${comp.pauseReason || ''}`) : null,
    comp && comp.health?.sheets !== 'Ready' && comp.adapter === 'google' ? h('div.notice.bad', { style: { margin: 0, borderRadius: 0 } }, `Google Sheets 狀態：${comp.health.sheets}${comp.health.lastSheetsError ? `（${comp.health.lastSheetsError.message}）` : ''}`) : null);
  clear($('tabs'), TABS.map(([k, label]) => h('button', { type: 'button', role: 'tab', className: tab === k ? 'active' : '', disabled: !comp && !['setup', 'audio', 'chars', 'system'].includes(k), onclick: () => { tab = k; history.replaceState(null, '', `#${k}`); renderAll(); } }, label)));
  renderView();
}

function renderView() {
  const v = $('view');
  const fn = { setup: viewSetup, teams: viewTeams, preflight: viewPreflight, live: viewLive, diag: viewDiag, results: viewResults, audio: viewAudio, chars: viewChars, system: viewSystem, audit: viewAudit }[tab];
  const scroll = window.scrollY;
  clear(v, comp ? stepper() : null, fn());
  window.scrollTo(0, scroll);
}

function stepper() {
  const st = comp.status;
  const anyLevel = comp.levels.some((l) => l.phase !== 'pending');
  const steps = [
    ['生成數據', !!comp.generation],
    ['Preflight 通過', comp.generation?.pass],
    ['批准鎖定', !!comp.approval],
    ['工作表就緒', comp.teams.every((t) => t.workbook?.status === 'READY')],
    ['開放大堂', !['DRAFT', 'PREFLIGHT', 'APPROVED'].includes(st)],
    ['開始 Episode', comp.episodeStarted],
    ...comp.levels.map((l) => [`L${l.level}`, ['ended', 'skipped'].includes(l.phase), l.phase === 'active']),
    ['結果', ['RESULTS', 'ARCHIVED'].includes(st)],
  ];
  let nowMarked = false;
  return h('div.stepper', steps.map(([label, done, active]) => {
    let cls = done ? 'done' : '';
    if (active || (!done && !nowMarked && !anyLevel)) { if (!done) { cls = 'now'; nowMarked = true; } }
    return h(`span.${cls || 'x'}`, label);
  }));
}

// ======================================================================= A. 設定
function viewSetup() {
  const isNew = !comp;
  const s = comp?.settings;
  const googleReady = sys?.google?.ready;
  const f = {
    title: h('input', { value: comp?.title || '定過抬油：站長爭奪戰 E1', maxlength: 80, style: { width: '100%' } }),
    classCode: h('input', { value: comp?.classCode || '', maxlength: 20, placeholder: '例如 4A', disabled: !isNew }),
    teamCount: h('select', { disabled: !isNew && !['DRAFT', 'PREFLIGHT'].includes(comp.status) }, [4, 5, 6, 7].map((n) => h('option', { value: n, selected: (s?.teamCount ?? 6) === n }, `${n} 隊`))),
    adapter: h('select', { disabled: !isNew },
      h('option', { value: 'demo', selected: !comp || comp.adapter === 'demo' }, 'Demo 模擬工作表（不需要 Google 設定）'),
      h('option', { value: 'google', selected: comp?.adapter === 'google', disabled: me.provider === 'demo' }, `真實 Google Sheets${me.provider === 'demo' ? '（需以 Google 登入）' : googleReady ? '' : '（Google 尚未連接）'}`)),
    bonus: h('input', { type: 'checkbox', checked: !!s?.bonusEnabled }),
    captain: h('input', { type: 'checkbox', checked: !!s?.captainOnlySubmit }),
  };
  const times = cfg.levels.map((l) => h('input', { type: 'number', min: 1, max: 60, step: 0.5, value: (s?.levelSeconds?.[l.level] ?? l.defaultSeconds) / 60, style: { width: '5em' }, disabled: comp && comp.levels[l.level - 1].phase !== 'pending', 'aria-label': `第 ${l.level} 關分鐘` }));
  const skills = comp?.skills || [];
  const skillBoxes = (comp ? skills : DEFAULT_SKILLS).map((k) => h('label', h('input', { type: 'checkbox', value: k.id, checked: !s || s.taughtSkills.includes(k.id) }), k.label));
  const gather = () => ({
    title: f.title.value,
    classCode: f.classCode.value,
    teamCount: Number(f.teamCount.value),
    adapter: f.adapter.value,
    bonusEnabled: f.bonus.checked,
    captainOnlySubmit: f.captain.checked,
    levelSeconds: Object.fromEntries(cfg.levels.map((l, i) => [l.level, Math.round(Number(times[i].value) * 60)])),
    taughtSkills: skillBoxes.map((l) => l.querySelector('input')).filter((x) => x.checked).map((x) => x.value),
  });
  const untaught = comp ? Object.entries(comp.untaught).filter(([, v]) => v.length) : [];
  return h('div.grid2',
    h('div.card',
      h('h2', isNew ? '建立新比賽' : '比賽設定'),
      h('div.col',
        h('label', { style: { display: 'block' } }, '比賽標題', f.title),
        h('div.row', h('label', '班別代號', f.classCode), h('label', '隊伍數目', f.teamCount)),
        h('label', '工作表模式', f.adapter),
        f.adapter.value === 'google' || comp?.adapter === 'google' ? null : h('small.muted', 'Demo 模式的工作表是伺服器模擬，畫面會清楚標示「模擬」。正式課堂請使用真實 Google Sheets。'),
        h('div', h('strong', '每關時間（分鐘）'), h('div.row', cfg.levels.map((l, i) => h('label', `L${l.level}`, times[i])))),
        h('label', f.bonus, '開啟 Bonus 加題（L1 MIN，+50；所有隊伍相同機會）'),
        h('label', f.captain, '只容許隊長（Captain）提交'),
        h('div.row',
          isNew ? h('button.primary', { type: 'button', onclick: async () => {
            try {
              const r = await api('POST', '/teacher/competitions', gather());
              await loadComps();
              tab = 'preflight';
              await selectComp(r.id);
              toast('已建立比賽。下一步：生成數據並完成 Preflight。', 'ok');
            } catch (e) { toast(e.message, 'error'); }
          } }, '建立比賽') : h('button.primary', { type: 'button', onclick: () => act(() => api('PATCH', `/teacher/competitions/${compId}`, gather()), '已儲存設定') }, '儲存設定')))),
    h('div.card',
      h('h2', '已教授的技能'),
      h('p.muted', '如某關涉及未勾選的技能，系統預設不開始該關（不會自動以未審核題目替換）。'),
      h('div.grid3', skillBoxes),
      untaught.length ? h('div.notice.warn', untaught.map(([lv, v]) => h('div', `第 ${lv} 關涉及未教授：${v.join('、')}`))) : null,
      !isNew ? h('div.row', { style: { marginTop: '10px' } }, h('button', { type: 'button', onclick: () => act(() => api('PATCH', `/teacher/competitions/${compId}`, { taughtSkills: gather().taughtSkills }), '已更新已教授技能') }, '只儲存技能設定')) : null));
}

const DEFAULT_SKILLS = ['SUM', 'AVERAGE', 'COUNT', 'MAX', 'MIN', 'IF', 'AND', 'OR', 'COUNTIF', 'SUMIF', 'LEFT', 'MID', 'RIGHT', 'ABS_REF', 'AMP'].map((id) => ({ id, label: { ABS_REF: '相對／絕對參照（$）及公式複製', AMP: '& 連接運算符', MIN: 'MIN（Bonus 用）' }[id] || id }));

// ======================================================================= B. 隊伍
function projectorUrl() { return `${location.origin}/projector?comp=${comp.id}&key=${comp.projectorKey}`; }

function viewTeams() {
  const members = comp.teams.flatMap((t) => t.members.map((m) => ({ ...m, teamId: t.id })));
  return h('div',
    h('div.card', h('div.row',
      h('div', h('div.muted', '學生比賽代碼（Join Code）'), h('div.big-code', comp.joinCode)),
      h('div', h('div.muted', '學生網址'), h('code', `${location.origin}/student`)),
      h('div.right.col', h('a.btn', { href: projectorUrl(), target: '_blank', rel: 'noopener' }, '開啟投影畫面 ↗'), h('small.muted', `已連線：老師 ${comp.clients?.teacher ?? 0}・學生 ${comp.clients?.student ?? 0}・投影 ${comp.clients?.projector ?? 0}`)))),
    h('div.grid2', { style: { marginTop: '14px' } }, comp.teams.map((t) => h('div.card.team-card', { style: { '--c': t.color } },
      h('div.row', h('span.dot', { style: { background: t.color } }), h('h3', { style: { margin: 0 } }, `${t.name}（${t.code}）`), h('span.pill.right', `${t.members.length} 人`)),
      workbookLine(t),
      t.members.length ? h('table', h('thead', h('tr', h('th', '成員'), h('th', '隊長'), h('th', '轉隊'))), h('tbody', t.members.map((m) => h('tr',
        h('td', m.name, m.email ? h('div.muted', m.email) : h('div.muted', m.provider === 'demo' ? 'Demo 帳戶' : '')),
        h('td', h('input', { type: 'radio', name: `cap-${t.id}`, checked: t.captainId === m.id, onchange: () => act(() => api('PATCH', `/teacher/competitions/${compId}`, { teams: [{ id: t.id, captainId: m.id }] }), '已設定隊長') })),
        h('td', h('select', { onchange: async (e) => {
          const to = e.target.value; if (!to) return;
          const reason = prompt('轉隊原因（會寫入審計紀錄）：', '學生加入錯誤隊伍');
          if (!reason) { e.target.value = ''; return; }
          await act(() => post('/transfer', { userId: m.id, toTeamId: to, reason }), '已轉隊');
        } }, h('option', { value: '' }, '轉至…'), comp.teams.filter((x) => x.id !== t.id).map((x) => h('option', { value: x.id }, x.name)))))))) : h('p.muted', '尚未有成員。'),
      t.members.length ? rolesTable(t) : null))),
    members.length ? null : h('p.muted', { style: { marginTop: '10px' } }, '建議分組：20 人可用四隊 3 人、兩隊 4 人；19 人可用五隊 3 人、一隊 4 人。'));
}

function workbookLine(t) {
  const wb = t.workbook;
  const parts = [];
  if (!wb) parts.push(h('span.pill', '工作表：未建立'));
  else {
    parts.push(h(`span.pill.${wb.status === 'READY' ? 'ok' : wb.status === 'ERROR' ? 'bad' : 'warn'}`, `工作表：${wb.provider === 'demo' ? '模擬' : 'Google'}・${wb.status}`));
    if (wb.url) parts.push(h('a', { href: wb.url, target: '_blank', rel: 'noopener' }, '開啟 ↗'));
    if (wb.error) parts.push(h('div.notice.bad', wb.error));
    if (wb.shareError) parts.push(h('div.notice.warn', `分享問題：${wb.shareError}`));
  }
  if (comp.adapter === 'google' && !comp.approval) {
    const inp = h('input', { placeholder: '（可選）老師預先建立的 Sheet ID 或網址', style: { width: '100%' }, value: wb?.presetFileId || '' });
    parts.push(h('div.row', { style: { marginTop: '6px' } }, inp, h('button.small', { type: 'button', onclick: () => act(() => post(`/teams/${t.id}/preset-sheet`, { fileId: inp.value }), '已記錄 Sheet ID') }, '使用此 Sheet')));
  }
  return h('div', { style: { margin: '6px 0' } }, parts);
}

function rolesTable(t) {
  const opts = (sel) => [h('option', { value: '' }, '—'), ...t.members.map((m) => h('option', { value: m.id, selected: sel === m.id }, m.name))];
  const keys = [['driver', 'Driver'], ['detective', 'Detective'], ['checker', 'Checker'], ['navigator', 'Navigator']];
  return h('details', h('summary', '每關角色輪換'),
    h('div.table-scroll', h('table', h('thead', h('tr', h('th', '關'), keys.map(([, l]) => h('th', l)))),
      h('tbody', [1, 2, 3, 4, 5].map((lv) => h('tr', h('td', `L${lv}`), keys.map(([k]) => h('td', h('select', {
        onchange: async (e) => {
          const roles = Object.fromEntries(keys.map(([kk]) => [kk, t.roles?.[lv]?.[kk]?.id || null]));
          roles[k] = e.target.value || null;
          const r = await act(() => post('/roles', { teamId: t.id, level: lv, roles }));
          if (r?.warning) toast(r.warning, 'error');
        },
      }, opts(t.roles?.[lv]?.[k]?.id))))))))));
}

// ======================================================================= C. 數據預檢
function viewPreflight() {
  const g = comp.generation;
  const locked = !['DRAFT', 'PREFLIGHT'].includes(comp.status);
  return h('div',
    h('div.card',
      h('h2', 'Dataset Preflight'),
      h('p', '系統會為每隊生成不同數據（相同題目藍圖、評分點及難度），並對每隊每題執行：參考公式、等價公式、常見錯誤公式及隱藏測試。全部通過後才可批准。'),
      h('p.notice.info', '此頁含標準答案，只供老師預覽。請勿在投影幕顯示。'),
      h('div.row',
        h('button', { type: 'button', disabled: locked, onclick: () => act(() => post('/generate', { newSeed: true }), '已生成新數據') }, g ? '🔄 重新生成（新 Seed）' : '生成數據'),
        g ? h('button', { type: 'button', disabled: locked, onclick: () => act(() => post('/generate', { newSeed: false }), '已用相同 Seed 重新生成（結果應完全一致）') }, '以相同 Seed 重現') : null,
        h('button.primary', { type: 'button', disabled: !g?.pass || locked, onclick: () => { if (confirm('批准後數據會鎖定，不能無聲地變動。確定批准？')) act(() => post('/approve'), comp.adapter === 'demo' ? '已批准並建立模擬工作表' : '已批准。下一步：建立 Google Sheets'); } }, '✓ 批准並鎖定'),
        comp.approval && comp.adapter === 'google' ? h('button.primary', { type: 'button', onclick: () => act(() => post('/provision'), '已建立／更新 Google Sheets') }, '建立／重試 Google Sheets 並分享') : null,
        comp.status === 'APPROVED' ? h('button.ok', { type: 'button', onclick: () => act(() => post('/lobby'), '已開放大堂，學生可以加入') }, '開放大堂（Lobby）') : null),
      g ? h('dl.kv', { style: { marginTop: '12px' } },
        h('dt', 'Seed'), h('dd.mono', g.seed),
        h('dt', 'Generator / Template'), h('dd.mono', `${g.generatorVersion} / ${g.templateVersion}`),
        h('dt', '生成時間'), h('dd', `${fmtClock(g.at)}（${g.ms} ms）`),
        h('dt', 'Preflight'), h('dd', g.pass ? h('span.pill.ok', '全部通過') : h('span.pill.bad', '未通過')),
        comp.approval ? [h('dt', '批准'), h('dd', `${fmtClock(comp.approval.at)}・指紋 ${comp.approval.fingerprint.slice(0, 12)}…`)] : null) : null),
    g ? h('div.card', h('div.table-scroll', h('table',
      h('thead', h('tr', h('th', '隊伍'), h('th', 'Preflight'), h('th', '生成嘗試'), h('th', 'L1 系數'), h('th', 'L2 最高人流'), h('th', 'L3 合資格'), h('th', 'L4 類別／門檻（=門檻件數）'), h('th', 'L5 代碼'), h('th', ''))),
      h('tbody', comp.teams.map((t) => {
        const gt = g.teams[t.id]; const p = g.preflight[t.id];
        if (!gt) return null;
        return h('tr',
          h('td', h('span.dot', { style: { background: t.color } }), ' ', t.name),
          h('td', p.pass ? h('span.pill.ok', `${p.total}/${p.total}`) : h('span.pill.bad', `${p.total - p.failed.length}/${p.total}`)),
          h('td.num', gt.attempts),
          h('td.flag', gt.flags.L1_multiplier),
          h('td.flag', gt.flags.L2_peakFlow),
          h('td.flag', gt.flags.L3_eligible),
          h('td.flag', `${gt.flags.L4_targetCategory} / ${gt.flags.L4_minValue}（${gt.flags.L4_itemsExactlyAtThreshold}）`),
          h('td.flag', gt.flags.L5_codes),
          h('td', h('button.small', { type: 'button', onclick: () => showPreflight(t.id) }, '查看')));
      }))))) : null);
}

async function showPreflight(teamId) {
  try {
    const d = await api('GET', `/teacher/competitions/${compId}/preflight/${teamId}`);
    clear($('dlg-body'),
      h('h2', `${d.team.name}：數據及標準答案（只供老師）`),
      h('p.mono', `Team Seed：${d.teamSeed}`),
      d.levels.map((lv) => h('details', h('summary', `L${lv.level} ${lv.title}（${lv.sheet}）`),
        h('div.mono', `參數：${JSON.stringify(lv.params)}；隱藏測試參數：${JSON.stringify(lv.hiddenSummary)}`),
        h('table', h('thead', h('tr', h('th', 'Task'), h('th', '參考公式'), h('th', '預期值（部分）'))), h('tbody', lv.tasks.map((t) => h('tr',
          h('td', t.id, t.bonus ? '（Bonus）' : ''),
          h('td.mono', Object.entries(t.reference).slice(0, 3).map(([a, f]) => h('div', `${a}: ${f}`)), Object.keys(t.reference).length > 3 ? h('div.muted', `…共 ${Object.keys(t.reference).length} 格`) : null),
          h('td.mono', Object.entries(t.expected).map(([a, v]) => h('div', `${a} = ${typeof v === 'object' && v ? JSON.stringify(v) : v}`))))))))),
      h('h3', 'Preflight 檢查'),
      h('div.table-scroll', h('table', h('tbody', (d.preflight.failed.length ? d.preflight.failed : []).map((c) => h('tr', h('td', c.taskId), h('td', c.name), h('td.fail', c.detail)))))),
      h('p', d.preflight.pass ? `✓ 全部 ${d.preflight.total} 項檢查通過（正確公式、等價公式、常見錯誤公式及隱藏測試）。` : `✗ ${d.preflight.failed.length} 項未通過。`));
    $('dlg').showModal();
  } catch (e) { toast(e.message, 'error'); }
}

// ======================================================================= D. 即時控制（控制室）
function viewLive() {
  const lb = comp.leaderboardState;
  const proj = comp.audio.projector;
  const canStartEpisode = comp.status === 'LOBBY' && !comp.episodeStarted;
  const anyActive = comp.levels.some((x) => x.phase === 'active');
  const raceBox = h('div');
  new RaceBoard(raceBox).update(comp.leaderboardLive);
  const hero = canStartEpisode
    ? h('div.card.hero',
      h('div.row',
        h('div.grow', h('h2', { style: { margin: 0 } }, '一切準備就緒！'), h('p', { style: { margin: '4px 0 0' } }, '先在投影電腦開啟投影畫面並按一次「啟用投影聲音」，再按「開始遊戲」：開場廣東話劇情及背景音樂會在投影畫面自動播放，之後所有劇情亦會自動播放。'), h('div', { style: { marginTop: '6px' } }, h(`span.pill.${comp.audio.designated ? 'ok' : 'warn'}`, comp.audio.designated ? '✓ 投影畫面聲音已啟用' : '投影畫面聲音未啟用'))),
        h('button.primary.big', { type: 'button', onclick: () => { if (!comp.audio.designated && !confirm('投影畫面尚未啟用聲音：劇情只會顯示字幕。\n請先開啟投影畫面並按「啟用投影聲音」。\n\n仍然開始遊戲？')) return; act(() => post('/start-episode'), '遊戲開始！投影畫面播放開場劇情'); } }, '▶ 開始遊戲'),
        h('a.btn', { href: projectorUrl(), target: '_blank', rel: 'noopener' }, '開啟投影畫面 ↗')))
    : h('div.card.hero',
      h('div.row',
        comp.status === 'APPROVED' || comp.status === 'PREFLIGHT' || comp.status === 'DRAFT' ? h('div.notice.info.grow', { style: { margin: 0 } }, '請先在「C. 數據預檢」批准數據並開放大堂。') : h('div.grow', h('strong', comp.episodeStarted ? '🚆 遊戲進行中' : ''), comp.paused ? h('span.pill.warn', { style: { marginLeft: '8px' } }, '暫停中（不計時）') : null),
        comp.paused ? h('button.ok.big', { type: 'button', onclick: () => act(() => post('/resume'), '已繼續') }, '▶ 繼續') : h('button.big', { type: 'button', disabled: !comp.episodeStarted, onclick: () => act(() => post('/pause', { reason: '老師暫停' }), '已暫停（暫停期間不計時）') }, '⏸ 暫停'),
        h('a.btn', { href: projectorUrl(), target: '_blank', rel: 'noopener' }, '投影畫面 ↗'),
        h('button', { type: 'button', onclick: () => { if (confirm('顯示最終結果？進行中的關卡會被結束。')) act(() => post('/results'), '已進入結果畫面'); } }, '🏁 顯示結果')));
  return h('div.col',
    hero,
    h('div.card', { style: { padding: '6px 16px' } }, routeMap(comp.levels, { color: '#D12B2B' })),
    h('div.stations', comp.levelsTeacher.map((l) => {
      const pub = comp.levels[l.level - 1];
      const untaught = comp.untaught[l.level];
      return h(`div.st-card.${l.phase}`,
        h('div.st-head', h('span.line-chip', { style: { background: l.phase === 'pending' ? '#8795A3' : '#D12B2B' } }, `L${l.level}`), h('strong', l.title)),
        h(`span.pill.${l.phase === 'active' ? 'info' : l.phase === 'ended' ? 'ok' : ''}`, PHASE_LABEL[l.phase]),
        l.phase === 'active' ? h('div.pids', { style: { width: '100%' } }, h('div.pids-label', '尚餘'), h('div.pids-time', { 'data-timer': l.level }, '--:--')) : h('small.muted', `${Math.round(comp.settings.levelSeconds[l.level] / 60 * 10) / 10} 分鐘`),
        pub.firstClear ? h('span.pill.ok', `🏆 ${pub.firstClear.name}`) : null,
        untaught.length ? h('span.pill.warn', `未教授：${untaught.join('、')}`) : null,
        l.skipReason ? h('small.muted', `略過：${l.skipReason}`) : null,
        h('div.st-actions',
          l.phase === 'pending' ? h('button.primary', { type: 'button', disabled: anyActive || comp.levels.some((x) => x.level < l.level && x.phase === 'pending') || (!['LOBBY'].includes(comp.status) && !/^RUNNING/.test(comp.status)), onclick: () => act(() => post(`/levels/${l.level}/start`), `第 ${l.level} 關開出！`) }, '▶ 開始') : null,
          l.phase === 'active' ? [
            h('div.row', { style: { gap: '6px' } },
              h('button.small', { type: 'button', onclick: () => act(() => post(`/levels/${l.level}/extend`, { seconds: 60 }), '已延長 1 分鐘') }, '+1 分'),
              h('button.small', { type: 'button', onclick: () => act(() => post(`/levels/${l.level}/extend`, { seconds: 120 }), '已延長 2 分鐘') }, '+2 分')),
            h('button.small.danger', { type: 'button', onclick: () => { if (confirm(`提前結束第 ${l.level} 關？提交會鎖定，已核實分數保留。`)) act(() => post(`/levels/${l.level}/end`), '已結束此關'); } }, '結束此關'),
          ] : null,
          ['pending', 'active'].includes(l.phase) ? h('button.small.ghost', { type: 'button', onclick: () => { const r = prompt('跳關理由（必填，會寫入審計紀錄）：'); if (r) act(() => post(`/levels/${l.level}/skip`, { reason: r }), '已略過此關'); } }, '略過') : null));
    })),
    h('div.grid2',
      h('div.card',
        h('div.row', h('div.section-title', { style: { margin: 0 } }, '即時排行榜'),
          h('label.right', h('input', { type: 'checkbox', checked: lb.hidden, onchange: (e) => act(() => post('/leaderboard', { hidden: e.target.checked })) }), '隱藏'),
          h('label', h('input', { type: 'checkbox', checked: lb.frozen, onchange: (e) => act(() => post('/leaderboard', { frozen: e.target.checked })) }), '凍結')),
        h('div', { style: { marginTop: '10px' } }, raceBox)),
      h('div.card',
        h('div.section-title', '劇情配音及音樂'),
        h('div.audio-out',
          h('div', h('small.muted', '劇情聲音輸出（只由一個投影畫面播放）'), h('div', { style: { fontWeight: 900, fontSize: '1.1rem' } }, comp.audio.designated ? `🔊 投影畫面（${comp.audio.designated.slice(-4)}）` : '🔇 未有投影畫面啟用聲音')),
          h('a.btn.small', { href: projectorUrl(), target: '_blank', rel: 'noopener' }, '開啟投影畫面 ↗')),
        h('div.row', { style: { margin: '8px 0', fontSize: '.9rem' } },
          h(`span.pill.${comp.audio.designated ? 'ok' : 'warn'}`, `投影：${!comp.audio.designated ? '未啟用聲音（請在投影畫面按「啟用投影聲音」）' : proj?.muted ? '靜音中' : proj?.playing ? `播放中 ${proj.playing}` : '待命'}`),
          h(`span.pill.${comp.audio.bgm ? 'info' : ''}`, `背景音樂：${comp.audio.bgm ? '開' : '關'}`),
          h('span.pill', '學生裝置：只播放各自隊伍的遊戲音效')),
        h('div.row',
          h('button.danger', { type: 'button', onclick: () => act(() => post('/audio/control', { action: 'emergency_mute' }), '已緊急靜音') }, '🔇 緊急靜音'),
          h('button', { type: 'button', onclick: () => act(() => post('/audio/control', { action: 'unmute' })) }, '取消靜音'),
          h('button', { type: 'button', onclick: () => act(() => post('/audio/control', { action: 'replay' })) }, '⟲ 重播'),
          h('button', { type: 'button', onclick: () => act(() => post('/audio/control', { action: 'skip' })) }, '⏭ 跳過'),
          h('button', { type: 'button', title: '暫停配音', onclick: () => act(() => post('/audio/control', { action: 'pause' })) }, '⏸'),
          h('button', { type: 'button', title: '繼續配音', onclick: () => act(() => post('/audio/control', { action: 'resume' })) }, '▶'),
          h('button', { type: 'button', onclick: () => act(() => post('/audio/control', { action: comp.audio.bgm ? 'bgm_off' : 'bgm_on' })) }, comp.audio.bgm ? '♫ 關音樂' : '♫ 開音樂'),
          h('label', '投影音量', h('input', { type: 'range', min: 0, max: 1, step: 0.1, value: proj?.volume ?? 0.9, onchange: (e) => act(() => post('/audio/control', { action: 'volume', value: Number(e.target.value) })) }))),
        h('div.event-chips', comp.audio.events.map((e) => h('button.small', {
          type: 'button', disabled: !e.allowed, title: e.allowed ? `${e.lineCount} 句` : 'Spoiler Policy：條件未達成',
          onclick: () => act(() => post('/audio/trigger', { eventId: e.id }), `已播放 ${e.id}`),
        }, comp.audio.log.some((x) => x.eventId === e.id) ? '⟲ ' : '▶ ', EVENT_LABEL[e.id] || e.id))))));
}

const EVENT_LABEL = {
  E1_INTRO: '開場', L1_OPEN: 'L1 開場', L1_FIRST_CLEAR: 'L1 首隊', L1_CLOSE: 'L1 結束', L2_OPEN: 'L2 開場', L2_FIRST_CLEAR: 'L2 首隊', L2_CLOSE: 'L2 結束',
  L3_OPEN: 'L3 開場', L3_FIRST_CLEAR: 'L3 首隊', L3_CLOSE: 'L3 結束', L4_OPEN: 'L4 開場', L4_FIRST_CLEAR: 'L4 首隊', L4_CLOSE: 'L4 結束（線索）',
  L5_OPEN: 'L5 開場', L5_FIRST_CLEAR: 'L5 首隊', E1_FINAL_REVEAL: '最終揭曉', TIMER_WARNING: '剩一分鐘',
};

function miniBoard(rows) {
  return h('table', h('thead', h('tr', h('th', '#'), h('th', '隊伍'), h('th', '進度'), h('th.num', '基礎'), h('th.num', '總分'))),
    h('tbody', rows.map((r) => h('tr', h('td', r.rank), h('td', h('span.dot', { style: { background: r.color } }), ' ', r.name),
      h('td', Object.entries(r.progress).map(([lv, p]) => h('span', { title: `L${lv}`, style: { marginRight: '4px' } }, p.completed ? '●' : p.done ? '◐' : '○'))),
      h('td.num', r.baseTotal), h('td.num', h('strong', r.total))))));
}

// ======================================================================= E. 即時診斷
function viewDiag() {
  const d = comp.diagnostics;
  const teamName = (id) => comp.teams.find((t) => t.id === id)?.name || id;
  return h('div',
    h('div.card', h('h2', '各隊進度'), h('div.table-scroll', h('table',
      h('thead', h('tr', h('th', '隊伍'), [1, 2, 3, 4, 5].map((n) => h('th', `L${n}`)), h('th.num', '提交'), h('th.num', '核實'), h('th.num', '未通過'), h('th.num', '同步失敗'), h('th.num', '完整性'), h('th.num', '待覆核'), h('th.num', '提示'), h('th', '最常見錯誤'))),
      h('tbody', d.perTeam.map((t) => h('tr',
        h('td', h('span.dot', { style: { background: t.color } }), ' ', t.name),
        [1, 2, 3, 4, 5].map((n) => h('td', h('div.bar', { title: `${t.levels[n].done}/${t.levels[n].total}` }, h('i', { style: { width: `${(t.levels[n].done / Math.max(1, t.levels[n].total)) * 100}%` } })))),
        h('td.num', t.submissions), h('td.num', t.verified), h('td.num', t.rejected),
        h('td.num', t.syncFailures ? h('span.pill.warn', t.syncFailures) : 0), h('td.num', t.integrityErrors ? h('span.pill.bad', t.integrityErrors) : 0),
        h('td.num', t.needsReview ? h('span.pill.warn', t.needsReview) : 0), h('td.num', t.hints),
        h('td.mono', t.topErrors.map(([c, n]) => `${c}×${n}`).join(' ')))))))),
    h('div.grid2', { style: { marginTop: '14px' } },
      h('div.card', h('h2', '全班最常見錯誤'), d.codes.length ? h('table', h('thead', h('tr', h('th', '錯誤'), h('th', '概念'), h('th.num', '次數'), h('th.num', '隊數'))),
        h('tbody', d.codes.slice(0, 15).map((c) => h('tr', h('td', h('div.mono', c.code), h('small.muted', c.sample)), h('td', c.conceptLabel), h('td.num', c.count), h('td.num', c.teamCount))))) : h('p.muted', '暫時未有錯誤提交。')),
      h('div.card', h('h2', '最新提交'), h('div.feed', [...comp.submissions].reverse().slice(0, 80).map((s) => h('details', { style: { borderBottom: '1px solid var(--line)', padding: '4px 0' } },
        h('summary', h('span.mono', s.taskId), ' ', teamName(s.teamId), ' ', h(`span.pill.${s.status === 'VERIFIED' ? 'ok' : s.status === 'REJECTED' ? 'bad' : 'warn'}`, SUB_LABEL[s.status] || s.status), ' ', s.earned !== null ? `${s.earned}/${s.max}` : '', h('small.muted', ` ${s.userName}・${fmtClock(s.at)}`)),
        s.message ? h('div.notice.warn', s.message) : null,
        s.errors?.length ? h('ul', s.errors.map((e) => h('li', h('span.mono', e.code), ' ', e.text))) : null,
        s.engineMismatch ? h('div.notice.warn', `Google 計算結果與伺服器引擎不一致：${s.engineMismatch.join('、')}（已標示待覆核，不扣分）`) : null,
        s.snapshot ? h('div.mono', { style: { fontSize: '.82em', maxHeight: '160px', overflow: 'auto' } }, Object.entries(s.snapshot.inputs).slice(0, 25).map(([a, v]) => h('div', `${a}: ${v}`))) : null))))));
}

// ======================================================================= F. 結果
function viewResults() {
  const teamSel = h('select', comp.teams.map((t) => h('option', { value: t.id }, t.name)));
  const delta = h('input', { type: 'number', step: 1, placeholder: '±分數', style: { width: '7em' } });
  const reason = h('input', { placeholder: '原因（必填）', style: { flex: 1 } });
  const taskSel = h('select', comp.tasks.map((t) => h('option', { value: t.id }, `${t.id}${t.bonus ? '（Bonus）' : ''}`)));
  const taskReason = h('input', { placeholder: '取消原因（例如題目 Bug）', style: { flex: 1 } });
  const d = comp.diagnostics;
  return h('div',
    h('div.card',
      h('div.row', h('h2', { style: { margin: 0 } }, '成績'),
        h('div.right.row',
          h('a.btn', { href: `/api/teacher/competitions/${compId}/export.csv` }, '⬇ 匯出 CSV'),
          comp.health.google?.ready ? h('button', { type: 'button', onclick: async () => { const r = await act(() => post('/export-google'), '已匯出到 Google Sheets'); if (r?.url) window.open(r.url, '_blank'); } }, '匯出到 Google Sheets') : null,
          !['RESULTS', 'ARCHIVED'].includes(comp.status) ? h('button', { type: 'button', onclick: () => { if (confirm('顯示最終結果？')) act(() => post('/results'), '已顯示結果'); } }, '🏁 顯示結果') : null,
          comp.status === 'RESULTS' ? h('button', { type: 'button', onclick: () => act(() => post('/archive'), '已封存') }, '封存') : null)),
      h('div.table-scroll', h('table',
        h('thead', h('tr', h('th', '#'), h('th', '隊伍'), [1, 2, 3, 4, 5].map((n) => h('th.num', `L${n}`)), h('th.num', 'Combo'), h('th.num', '人手'), h('th.num', '提示'), h('th.num', '完成關'), h('th.num', '基礎分'), h('th.num', '總分'))),
        h('tbody', comp.scores.map((s) => {
          const t = comp.teams.find((x) => x.id === s.teamId);
          return h('tr',
            h('td', s.rank), h('td', h('span.dot', { style: { background: t.color } }), ' ', t.name),
            [1, 2, 3, 4, 5].map((n) => h('td.num', { title: comp.scores && s.levelsLines[n].map((l) => `${l.label} ${l.delta}`).join('\n') }, `${s.levels[n].total}`, h('div.muted', { style: { fontSize: '.75em' } }, `${s.levels[n].earnedPts}/${s.levels[n].maxPts}`))),
            h('td.num', s.combo), h('td.num', s.manual), h('td.num', s.hintsUsed), h('td.num', s.completedLevels), h('td.num', s.baseTotal), h('td.num', h('strong', s.total)));
        })))),
      h('small.muted', '排名：總分 → 已完成關卡數 → 少用提示 → 較早取得有效正確提交。把滑鼠移到每關分數可看加扣分明細。')),
    h('div.grid2', { style: { marginTop: '14px' } },
      h('div.card',
        h('h3', '手動調分（會記錄原因、改前改後分數、操作者、時間）'),
        h('div.row', teamSel, delta, reason, h('button', { type: 'button', onclick: () => act(() => post('/adjust', { teamId: teamSel.value, delta: Number(delta.value), reason: reason.value }), '已調整分數') }, '確認')),
        comp.adjustments.length ? h('table', h('thead', h('tr', h('th', '時間'), h('th', '隊伍'), h('th.num', '調整'), h('th.num', '改前'), h('th.num', '改後'), h('th', '原因'), h('th', '操作者'))),
          h('tbody', comp.adjustments.map((a) => h('tr', h('td', fmtClock(a.at)), h('td', comp.teams.find((t) => t.id === a.teamId)?.name), h('td.num', a.delta > 0 ? `+${a.delta}` : a.delta), h('td.num', a.before), h('td.num', a.after), h('td', a.reason), h('td', a.by.name))))) : h('p.muted', '未有手動調分。'),
        h('h3', { style: { marginTop: '14px' } }, '取消有問題的題目（所有隊伍同步等值處理）'),
        h('div.row', taskSel, taskReason, h('button.danger', { type: 'button', onclick: () => { if (confirm('取消後該題不計入所有隊伍的基礎分分母，相關錯誤提交亦不扣分。確定？')) act(() => post('/cancel-task', { taskId: taskSel.value, reason: taskReason.value }), '已取消題目'); } }, '取消題目')),
        comp.cancelledTasks.length ? h('ul', comp.cancelledTasks.map((c) => h('li', `${c.taskId}：${c.reason}（${fmtClock(c.at)}）`))) : null),
      h('div.card',
        h('h3', '賽後回顧（最常見的 2–3 個錯誤，不顯示哪隊犯錯）'),
        d.reviewCards.length ? d.reviewCards.map((c) => h('div', { style: { borderLeft: '4px solid var(--accent)', paddingLeft: '10px', margin: '10px 0' } },
          h('div', h('strong', '錯誤公式：'), h('code', c.wrong), h('small.muted', `（全班出現 ${c.count} 次）`)),
          h('div', h('strong', '錯在甚麼地方：'), c.why),
          h('div', h('strong', 'Keyword：'), c.keyword),
          h('div', h('strong', '可得分公式：'), h('code', c.fixed)),
          h('div', h('strong', 'Question Clue：'), c.clue),
          h('div', h('strong', '應用：'), c.apply))) : h('p.muted', '提交數據不足，暫未有回顧建議。'),
        h('h3', '概念錯誤分佈'),
        d.concepts.length ? h('table', h('tbody', d.concepts.map((c) => h('tr', h('td', c.label), h('td.num', c.count))))) : h('p.muted', '—'))),
    h('div.card', { style: { marginTop: '14px' } },
      h('h3', '比賽資料管理'),
      h('div.row',
        h('button.danger', { type: 'button', onclick: () => { const r = prompt('取消比賽的原因：'); if (r) act(() => post('/cancel', { reason: r }), '已取消比賽'); } }, '取消比賽'),
        h('button.danger', { type: 'button', onclick: async () => { if (!confirm('永久刪除此比賽的所有資料（包括提交紀錄）？請先匯出成績。')) return; try { await api('DELETE', `/teacher/competitions/${compId}`); toast('已刪除', 'ok'); await loadComps(); selectComp(comps[0]?.id || null); } catch (e) { toast(e.message, 'error'); } } }, '刪除比賽資料'))));
}

// ======================================================================= 配音資產
let assets = null;
function viewAudio() {
  const box = h('div', h('p.muted', '載入中…'));
  api('GET', '/teacher/audio/assets').then((r) => { assets = r; clear(box, audioTable()); }).catch((e) => clear(box, h('p.notice.bad', e.message)));
  return h('div.card',
    h('h2', '廣東話配音資產'),
    h('p', '系統已附帶 30 句以本機開源粵語語音模型（sherpa-onnx Cantonese VITS，按粵語音素及聲調發音，不是普通話）產生的配音，每個角色用不同的語速及音高。遊戲開始後會自動播放，字幕與音檔同步。'),
    h('p', '想要更自然的效果，可以按「🎙 錄音」由老師／同學親自配音，或上載錄音檔；讀得不自然的句子可按「退回」（退回後該句只顯示字幕）或「重新合成」。'),
    box);
}

function audioTable() {
  const status = { missing: ['bad', '缺少音檔'], unreviewed: ['info', '可播放'], approved: ['ok', '已批准'], rejected: ['bad', '已退回'] };
  const tts = assets.localTts;
  return h('div',
    h('div.row', { style: { marginBottom: '8px' } },
      h(`span.pill.${tts?.ready ? 'ok' : 'warn'}`, tts?.ready ? '本機粵語 TTS：就緒' : `本機粵語 TTS：未就緒（${tts?.reason || ''}）`),
      assets.requireApproval ? h('span.pill.warn', '設定：只播放已批准的音檔') : h('span.pill', '設定：未退回的音檔都會自動播放')),
    h('div.table-scroll', h('table',
      h('thead', h('tr', h('th', 'Line'), h('th', '角色／聲線'), h('th', '廣東話對白（字幕）'), h('th', '狀態'), h('th', '操作'))),
      h('tbody', assets.lines.map((l) => {
        const [cls, label] = status[l.asset_status];
        const file = h('input', { type: 'file', accept: 'audio/*', hidden: true, onchange: async (e) => { const f = e.target.files[0]; if (f) await uploadAudio(l.line_id, f, f.type); } });
        return h('tr',
          h('td.mono', { style: { fontSize: '.8rem' } }, l.line_id),
          h('td', h('strong', l.speaker_name), h('div.muted', { style: { fontSize: '.78rem' } }, l.voice || '')),
          h('td', l.subtitle_zh_Hant, l.source ? h('div.muted', { style: { fontSize: '.75rem' } }, `來源：${l.source.startsWith('local-tts') ? '本機粵語 TTS' : l.source}`) : null),
          h('td', h(`span.pill.${cls}`, label)),
          h('td', h('div.row', { style: { gap: '4px' } },
            l.url ? h('button.small', { type: 'button', onclick: () => new Audio(`${l.url}?t=${Date.now()}`).play().catch((e) => toast(e.message, 'error')) }, '▶ 試聽') : null,
            l.url && l.asset_status !== 'approved' ? h('button.small.ok', { type: 'button', onclick: () => reviewAudio(l.line_id, 'approved') }, '批准') : null,
            l.url && l.asset_status !== 'rejected' ? h('button.small', { type: 'button', onclick: () => reviewAudio(l.line_id, 'rejected') }, '退回') : null,
            tts?.ready ? h('button.small', { type: 'button', onclick: async (e) => { e.target.disabled = true; e.target.textContent = '合成中…'; try { await api('POST', `/teacher/audio/assets/${l.line_id}/tts`); toast('已重新合成', 'ok'); } catch (err) { toast(err.message, 'error'); } renderView(); } }, '🗣 重新合成') : null,
            h('button.small', { type: 'button', onclick: () => recordAudio(l) }, '🎙 錄音'),
            h('button.small', { type: 'button', onclick: () => file.click() }, '上載'), file)));
      })))));
}

async function reviewAudio(lineId, status) {
  try { await api('POST', `/teacher/audio/assets/${lineId}/review`, { status }); toast('已更新', 'ok'); renderView(); } catch (e) { toast(e.message, 'error'); }
}

async function uploadAudio(lineId, blob, type) {
  try {
    const res = await fetch(`/api/teacher/audio/assets/${lineId}/upload`, { method: 'POST', headers: { 'Content-Type': (type || 'audio/webm').split(';')[0] }, body: blob });
    if (!res.ok) throw new Error((await res.json()).error);
    toast('已上載，請試聽後批准。', 'ok');
    renderView();
  } catch (e) { toast(e.message, 'error'); }
}

async function recordAudio(line) {
  if (!navigator.mediaDevices?.getUserMedia) return toast('此瀏覽器不支援錄音。', 'error');
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return toast('未能使用麥克風。', 'error'); }
  const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || '';
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  const status = h('p', '🔴 錄音中…請以', h('strong', ` ${line.speaker_name} `), '的語氣讀出：');
  rec.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
    const url = URL.createObjectURL(blob);
    clear($('dlg-body'), h('h3', `${line.line_id} 錄音完成`), h('audio', { controls: true, src: url }),
      h('div.row', { style: { marginTop: '10px' } }, h('button.primary', { type: 'button', onclick: async () => { $('dlg').close(); await uploadAudio(line.line_id, blob, rec.mimeType); } }, '上載此錄音'), h('button', { type: 'button', onclick: () => { $('dlg').close(); recordAudio(line); } }, '重錄')));
  };
  clear($('dlg-body'), h('h3', `錄音：${line.line_id}`), status, h('p', { style: { fontSize: '1.5rem' } }, `「${line.subtitle_zh_Hant}」`), h('button.danger', { type: 'button', onclick: () => rec.stop() }, '⏹ 停止'));
  $('dlg').showModal();
  rec.start();
}

// ======================================================================= 角色圖片
const CHAR_SLOTS = [
  ['neutral', '平常（必需）'], ['talk', '說話（張口）'], ['blink', '眨眼（閉眼）'],
  ['happy', '開心'], ['worried', '擔心'], ['surprised', '驚訝'], ['think', '思考'],
];
function viewChars() {
  const box = h('div', h('p.muted', '載入中…'));
  api('GET', '/characters').then((imgs) => clear(box, charTable(imgs))).catch((e) => clear(box, h('p.notice.bad', e.message)));
  return h('div.card',
    h('h2', '角色圖片'),
    h('p', '可以為每個角色上載插圖（存放在雲端，所有裝置即時使用）。沒有上載的表情會用「平常」圖片；完全沒有圖片的角色會使用系統內建的原創插圖。'),
    h('details', h('summary', '圖片規格'),
      h('ul',
        h('li', '格式：PNG 或 WebP，透明背景；每張不超過 4 MB。'),
        h('li', '尺寸：建議 800 × 960 像素（寬 : 高 = 5 : 6），角色上半身正面，頭頂留少許空位，腳／身體底部貼齊畫布底邊。'),
        h('li', '同一角色所有表情的位置、大小及構圖必須一致（只改變臉部），切換時才不會跳動。'),
        h('li', '「說話（張口）」與「平常」完全相同，只是嘴巴張開 —— 用於說話時的口型動畫。'),
        h('li', '「眨眼」與「平常」完全相同，只是眼睛閉上 —— 每隔數秒自動眨眼。'),
        h('li', '請使用原創或已取得授權的插圖，不要使用港鐵或其他機構的標誌。'))),
    box);
}

function charTable(imgs) {
  return h('div.table-scroll', h('table',
    h('thead', h('tr', h('th', '角色'), CHAR_SLOTS.map(([, l]) => h('th', l)))),
    h('tbody', Object.entries(CHARACTERS).map(([id, c]) => h('tr',
      h('td', h('div', { style: { width: '72px' } }, new Character(id, { size: 72 }).el), h('strong', c.name), h('div.muted', { style: { fontSize: '.75rem' } }, id)),
      CHAR_SLOTS.map(([expr]) => {
        const url = imgs[id]?.[expr];
        const file = h('input', { type: 'file', accept: 'image/png,image/webp,image/jpeg,image/gif', hidden: true, onchange: async (e) => {
          const f = e.target.files[0];
          if (!f) return;
          try {
            const r = await fetch(`/api/teacher/characters/${id}/${expr}`, { method: 'POST', headers: { 'Content-Type': f.type }, body: f });
            if (!r.ok) throw new Error((await r.json()).error);
            toast(`已上載 ${c.name}（${expr}）`, 'ok');
            renderView();
          } catch (err) { toast(err.message, 'error'); }
        } });
        return h('td', { style: { textAlign: 'center' } },
          url ? h('img', { src: url, alt: '', style: { width: '64px', height: '77px', objectFit: 'contain', display: 'block', margin: '0 auto 4px', background: 'var(--panel-2)', borderRadius: '8px' } }) : h('div.muted', { style: { height: '77px', display: 'grid', placeItems: 'center', fontSize: '.75rem' } }, '（內建）'),
          h('div.row', { style: { gap: '4px', justifyContent: 'center' } },
            h('button.small', { type: 'button', onclick: () => file.click() }, url ? '更換' : '上載'),
            url ? h('button.small.danger', { type: 'button', onclick: async () => { await api('DELETE', `/teacher/characters/${id}/${expr}`); toast('已刪除', 'ok'); renderView(); } }, '刪除') : null),
          file);
      }))))));
}

// ======================================================================= 系統狀態
function viewSystem() {
  const s = sys;
  if (!s) return h('div.card', h('p.notice.bad', '未能讀取系統狀態。'));
  const f = s.features;
  const row = (label, ok, text) => h('tr', h('td', label), h('td', h(`span.pill.${ok ? 'ok' : 'warn'}`, ok ? 'Ready' : '未設定')), h('td', text));
  return h('div.grid2',
    h('div.card',
      h('h2', '已實作 vs 已連接'),
      h('table', h('tbody',
        row('Demo Mode（模擬工作表）', f.demoLogin, f.demoLogin ? '已開放。Demo 帳戶只可參加 Demo 比賽，畫面清楚標示「模擬」。' : '已停用（ALLOW_DEMO_LOGIN=false）'),
        row('Google Sign-in', f.googleSignIn, f.googleSignIn ? '學生及老師可用 Google 帳戶登入。' : '需要 GOOGLE_CLIENT_ID。'),
        row('Google Sheets / Drive', s.google.ready, s.google.ready ? `已連接（${s.google.mode === 'oauth' ? '老師 OAuth' : 'Service Account'}：${s.google.actor}）` : s.google.reason),
        row('伺服器批改引擎', true, 'AST 公式解析 + 重算 + 隱藏測試（Demo 與正式模式相同）。'),
        row('廣東話配音音檔', true, '字幕、事件排隊、播放控制已可用；正式音檔需老師錄音或以 TTS 產生並試聽批准（見「配音資產」）。'),
        row('Microsoft Excel 桌面版', false, '未支援（只預留 Adapter 介面，不會宣稱可自動讀取本機 Excel）。'))),
      h('p.muted', '詳細設定步驟：', h('code', 'docs/SETUP_GOOGLE.md'), '、', h('code', 'docs/SETUP_AUDIO_TTS.md'), '。')),
    h('div.card',
      h('h2', '連接 Google Drive／Sheets'),
      s.googleOAuth ? h('div', h('p.notice.ok', `已由 ${s.googleOAuth.email} 連接（${fmtClock(s.googleOAuth.connectedAt)}）。授權範圍：`, h('code', (s.googleOAuth.scopes || []).join(' '))),
        h('button.danger', { type: 'button', onclick: async () => { await api('POST', '/google/disconnect'); sys = await api('GET', '/system/status'); renderView(); } }, '中斷連接')) : null,
      !s.googleOAuth && f.googleOAuthConnect && me.provider === 'google' ? h('div',
        h('p', '以老師的 Google 帳戶授權本系統建立及管理「由本系統建立」的工作表（drive.file 權限，最少授權；系統看不到你其他的 Drive 檔案）。'),
        h('a.btn.primary', { href: '/api/google/connect' }, '連接 Google Drive')) : null,
      !s.googleOAuth && !f.googleOAuthConnect ? h('p.notice.warn', '需要在伺服器設定 GOOGLE_CLIENT_ID 及 GOOGLE_CLIENT_SECRET 才可用 OAuth 連接；或設定 Service Account（GOOGLE_SERVICE_ACCOUNT_KEY_FILE）。') : null,
      !s.googleOAuth && f.googleOAuthConnect && me.provider !== 'google' ? h('p.notice.warn', '請以 Google 帳戶（列於 TEACHER_EMAILS）登入，才可以連接 Google Drive。') : null,
      h('p.muted', '若學校 Workspace 不容許 OAuth 範圍：可改用 Service Account，並由老師預先建立 6 份 Sheet、分享給 Service Account，再在「B. 隊伍」輸入各隊 Sheet ID。')));
}

// ======================================================================= 審計
function viewAudit() {
  return h('div.card', h('h2', '審計紀錄'), h('div.table-scroll', h('table',
    h('thead', h('tr', h('th', '時間'), h('th', '操作者'), h('th', '動作'), h('th', '內容'))),
    h('tbody', [...comp.audit].reverse().map((a) => h('tr', h('td', fmtClock(a.at)), h('td', a.by.name), h('td.mono', a.action), h('td.mono', { style: { fontSize: '.82em', maxWidth: '640px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' } }, Object.keys(a.detail || {}).length ? JSON.stringify(a.detail) : '')))))));
}

function tickTimer() {
  if (!comp) { $('timer').textContent = ''; return; }
  const active = comp.levels.find((l) => l.phase === 'active');
  const remain = active ? remainingOf(active, comp) : 0;
  const text = active ? fmtTime(remain) : '';
  $('timer').textContent = active ? `L${active.level} ${comp.paused ? '⏸ ' : ''}${text}` : '';
  $('timer').className = `timer right${active && remain <= 60000 ? ' low' : ''}${comp.paused ? ' paused' : ''}`;
  for (const el of document.querySelectorAll('[data-timer]')) el.textContent = text;
  if (active) device.onTimer(remain, active.running && !comp.paused);
}

init();
