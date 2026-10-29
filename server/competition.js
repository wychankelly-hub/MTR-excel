// 比賽管理（§10、§12）：狀態機、隊伍、數據生成與批准、計時、提示、人工調分、音訊觸發。
import crypto from 'node:crypto';
import { db, save } from './store.js';
import { clock } from './clock.js';
import { bus } from './bus.js';
import { HttpError } from './auth.js';
import {
  LEVELS, LEVEL_BY_NUM, TASK_BY_ID, TEAM_PRESETS, SKILLS, GENERATOR_VERSION, TEMPLATE_VERSION, EPISODE_ID,
} from './episode1/blueprint.js';
import { generateCompetitionDatasets } from './episode1/generator.js';
import { checksum } from './episode1/rng.js';
import { preflightTeam } from './episode1/preflight.js';
import { AUDIO_EVENT_BY_ID } from './episode1/dialogue.js';
import { resolvedEvent } from './audio-assets.js';
import { DemoAdapter } from './adapters/demo-adapter.js';
import { GoogleAdapter } from './adapters/google-adapter.js';
import { rankTeams, computeTeamScore } from './scoring.js';

export const STATUS = {
  DRAFT: 'DRAFT', PREFLIGHT: 'PREFLIGHT', APPROVED: 'APPROVED', LOBBY: 'LOBBY',
  RESULTS: 'RESULTS', ARCHIVED: 'ARCHIVED', PAUSED: 'PAUSED', CANCELLED: 'CANCELLED',
};
export const runningStatus = (n) => `RUNNING_LEVEL_${n}`;

// ------------------------------------------------------------------ 數據集快取
const datasetCache = new Map(); // compId -> { byTeamId }

export function getDatasets(comp) {
  if (!comp.generation) throw new HttpError(409, '尚未生成數據。', 'NO_DATASET');
  let entry = datasetCache.get(comp.id);
  if (!entry || entry.seed !== comp.generation.seed) {
    const keys = comp.teams.map((t) => t.key);
    const list = generateCompetitionDatasets(comp.generation.seed, keys);
    const byTeamId = {};
    comp.teams.forEach((t, i) => {
      const ds = list[i];
      const recorded = comp.generation.teams?.[t.id]?.checksums;
      if (recorded && checksum(recorded) !== checksum(ds.checksums)) {
        throw new HttpError(500, `隊伍 ${t.name} 的數據重新生成後與批准版本不一致（Generator Version 可能已改變）。`, 'DATASET_MISMATCH');
      }
      byTeamId[t.id] = ds;
    });
    entry = { seed: comp.generation.seed, byTeamId };
    datasetCache.set(comp.id, entry);
  }
  return entry.byTeamId;
}

export function getDataset(comp, team) {
  return getDatasets(comp)[team.id];
}

export const adapters = {
  demo: new DemoAdapter(getDataset),
  google: new GoogleAdapter(getDataset),
};

export function adapterFor(comp) {
  return adapters[comp.adapter];
}

// ------------------------------------------------------------------ 工具
export function getComp(id) {
  const c = db.state.competitions[id];
  if (!c) throw new HttpError(404, '找不到此比賽。', 'NOT_FOUND');
  return c;
}

export function findByJoinCode(code) {
  const c = Object.values(db.state.competitions).find((x) => x.joinCode === String(code || '').trim().toUpperCase() && ![STATUS.ARCHIVED, STATUS.CANCELLED].includes(x.status));
  if (!c) throw new HttpError(404, '比賽代碼不正確，或比賽已結束。', 'BAD_JOIN_CODE');
  return c;
}

export function getTeam(comp, teamId) {
  const t = comp.teams.find((x) => x.id === teamId);
  if (!t) throw new HttpError(404, '找不到此隊伍。', 'NO_TEAM');
  return t;
}

export function teamOfUser(comp, userId) {
  return comp.teams.find((t) => t.memberIds.includes(userId)) || null;
}

export function audit(comp, by, action, detail = {}) {
  comp.audit.push({ at: clock.now(), by: by ? { id: by.id, name: by.name } : { id: 'system', name: '系統' }, action, detail });
}

export function changed(comp, reason) {
  save(`competition:${comp.id}`);
  bus.emit('changed', comp.id, reason);
}

const randCode = (n, alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789') => Array.from(crypto.randomBytes(n), (b) => alphabet[b % alphabet.length]).join('');

function makeTeams(count) {
  return TEAM_PRESETS.slice(0, count).map((p, i) => ({
    id: `t${i + 1}`,
    key: `team-${i + 1}`,
    index: i,
    name: p.name,
    code: p.code,
    color: p.color,
    memberIds: [],
    captainId: null,
    roles: {},
    workbook: null,
  }));
}

function isRunning(comp) {
  return /^RUNNING_LEVEL_/.test(comp.status) || (comp.status === STATUS.PAUSED && /^RUNNING_LEVEL_/.test(comp.prevStatus || ''));
}

// ------------------------------------------------------------------ A. Setup
export function createCompetition(teacher, opts = {}) {
  const teamCount = Number(opts.teamCount ?? 6);
  if (!(teamCount >= 4 && teamCount <= 7)) throw new HttpError(400, '隊伍數目須為 4–7 隊。');
  const adapter = opts.adapter === 'google' ? 'google' : 'demo';
  if (adapter === 'google' && teacher.provider === 'demo') throw new HttpError(400, 'Demo 老師帳戶只可以建立 Demo 比賽；正式 Google Sheets 比賽需要以 Google 登入。');
  const id = `c_${randCode(10, 'abcdefghijkmnpqrstuvwxyz23456789')}`;
  let joinCode = randCode(6);
  while (Object.values(db.state.competitions).some((c) => c.joinCode === joinCode)) joinCode = randCode(6);
  const comp = {
    id,
    episode: EPISODE_ID,
    title: String(opts.title || '定過抬油：站長爭奪戰 E1').slice(0, 80),
    classCode: String(opts.classCode || '').replace(/[^A-Za-z0-9 _-]/g, '').slice(0, 20),
    adapter,
    demo: adapter === 'demo',
    joinCode,
    projectorKey: randCode(16),
    ownerId: teacher.id,
    createdAt: clock.now(),
    status: STATUS.DRAFT,
    prevStatus: null,
    rulesVersion: 'E1-RULES-1.0.0',
    templateVersion: TEMPLATE_VERSION,
    generatorVersion: GENERATOR_VERSION,
    settings: {
      teamCount,
      levelSeconds: Object.fromEntries(LEVELS.map((l) => [l.level, Number(opts.levelSeconds?.[l.level] ?? l.defaultSeconds)])),
      taughtSkills: Array.isArray(opts.taughtSkills) ? opts.taughtSkills.filter((s) => SKILLS.some((k) => k.id === s)) : SKILLS.map((s) => s.id),
      bonusEnabled: !!opts.bonusEnabled,
      maxTeamSize: 5,
      captainOnlySubmit: !!opts.captainOnlySubmit,
      // 分隊：'teacher' = 學生加入後由老師分隊；'student' = 學生加入時自選一次（之後只有老師可以轉隊）
      teamSelection: opts.teamSelection === 'teacher' ? 'teacher' : 'student',
      // 只容許名單內的 Google 帳戶／網域加入（留空 = 不限制）
      allowedEmails: cleanEmails(opts.allowedEmails),
      allowedDomains: cleanDomains(opts.allowedDomains),
      requireGoogle: !!opts.requireGoogle,
    },
    waiting: [], // 已加入比賽、等候老師分隊的學生
    teams: makeTeams(teamCount),
    generation: null,
    approval: null,
    episodeStartedAt: null,
    currentLevel: 0,
    levels: Object.fromEntries(LEVELS.map((l) => [l.level, { phase: 'pending' }])),
    paused: false,
    leaderboard: { hidden: false, frozen: false, frozenAt: null, snapshot: null },
    submissions: [],
    submissionSeq: 0,
    idempotency: {},
    hintUses: [],
    adjustments: [],
    cancelledTasks: [],
    audio: { seq: 0, log: [], projector: null, onlyApproved: null },
    health: { sheets: adapter === 'demo' ? 'Ready' : 'Unavailable', sheetsFailures: 0, lastSheetsError: null },
    audit: [],
  };
  db.state.competitions[id] = comp;
  audit(comp, teacher, 'CREATE', { teamCount, adapter });
  changed(comp, 'create');
  return comp;
}

function cleanEmails(v) {
  const list = Array.isArray(v) ? v : String(v || '').split(/[\s,;]+/);
  return [...new Set(list.map((x) => String(x).trim().toLowerCase()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)))].slice(0, 300);
}

function cleanDomains(v) {
  const list = Array.isArray(v) ? v : String(v || '').split(/[\s,;]+/);
  return [...new Set(list.map((x) => String(x).trim().toLowerCase().replace(/^@/, '')).filter((x) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(x)))].slice(0, 20);
}

function requireOwner(comp, teacher) {
  if (comp.ownerId !== teacher.id) throw new HttpError(403, '只有建立此比賽的老師可以管理。', 'NOT_OWNER');
}

export function updateSettings(comp, teacher, patch) {
  requireOwner(comp, teacher);
  const s = comp.settings;
  const lockedSetup = ![STATUS.DRAFT, STATUS.PREFLIGHT].includes(comp.status);
  if (patch.teamCount !== undefined && Number(patch.teamCount) !== s.teamCount) {
    if (lockedSetup) throw new HttpError(409, '數據已批准，不能更改隊伍數目。請建立新比賽。');
    const n = Number(patch.teamCount);
    if (!(n >= 4 && n <= 7)) throw new HttpError(400, '隊伍數目須為 4–7 隊。');
    if (comp.teams.some((t, i) => i >= n && t.memberIds.length)) throw new HttpError(409, '要刪除的隊伍仍有成員，請先轉隊。');
    const old = comp.teams;
    comp.teams = makeTeams(n).map((t, i) => (old[i] ? { ...old[i] } : t));
    s.teamCount = n;
    comp.generation = null;
    comp.status = STATUS.DRAFT;
  }
  if (patch.levelSeconds) {
    for (const [k, v] of Object.entries(patch.levelSeconds)) {
      const n = Number(v);
      if (LEVEL_BY_NUM[k] && n >= 60 && n <= 3600 && comp.levels[k].phase === 'pending') s.levelSeconds[k] = n;
    }
  }
  if (Array.isArray(patch.taughtSkills)) s.taughtSkills = patch.taughtSkills.filter((x) => SKILLS.some((k) => k.id === x));
  if (patch.bonusEnabled !== undefined) {
    if (isRunning(comp) && comp.levels[1].phase !== 'pending') throw new HttpError(409, '比賽開始後不能更改 Bonus 設定（確保所有隊伍機會相同）。');
    s.bonusEnabled = !!patch.bonusEnabled;
  }
  if (patch.captainOnlySubmit !== undefined) s.captainOnlySubmit = !!patch.captainOnlySubmit;
  if (patch.teamSelection !== undefined) s.teamSelection = patch.teamSelection === 'teacher' ? 'teacher' : 'student';
  if (patch.allowedEmails !== undefined) s.allowedEmails = cleanEmails(patch.allowedEmails);
  if (patch.allowedDomains !== undefined) s.allowedDomains = cleanDomains(patch.allowedDomains);
  if (patch.requireGoogle !== undefined) s.requireGoogle = !!patch.requireGoogle;
  if (patch.title) comp.title = String(patch.title).slice(0, 80);
  if (Array.isArray(patch.teams)) {
    for (const p of patch.teams) {
      const t = comp.teams.find((x) => x.id === p.id);
      if (!t) continue;
      if (p.color && /^#[0-9a-fA-F]{6}$/.test(p.color)) t.color = p.color;
      if (p.captainId !== undefined) t.captainId = t.memberIds.includes(p.captainId) ? p.captainId : null;
    }
  }
  audit(comp, teacher, 'UPDATE_SETTINGS', patch);
  changed(comp, 'settings');
}

/** 未教授的技能 → 該關預設不開始 */
export function untaughtFor(comp, level) {
  const lv = LEVEL_BY_NUM[level];
  return lv.skills.filter((s) => !comp.settings.taughtSkills.includes(s));
}

// ------------------------------------------------------------------ C. Dataset Preflight
export function generate(comp, teacher, { newSeed = true } = {}) {
  requireOwner(comp, teacher);
  if (![STATUS.DRAFT, STATUS.PREFLIGHT].includes(comp.status)) throw new HttpError(409, '數據已批准並鎖定，不能重新生成。如需修訂請建立新比賽（會保留審計紀錄）。', 'LOCKED');
  datasetCache.delete(comp.id);
  const t0 = Date.now();
  const rejectedSeeds = [];
  let seed; let list; let teams; let preflight; let pass;
  // Preflight 未通過 → 自動以新 Seed 重抽（最多 5 次），並記錄被拒絕的 Seed
  for (let attempt = 0; attempt < 5; attempt++) {
    seed = attempt === 0 && !newSeed && comp.generation ? comp.generation.seed : `S-${randCode(12)}`;
    list = generateCompetitionDatasets(seed, comp.teams.map((t) => t.key));
    teams = {};
    preflight = {};
    comp.teams.forEach((t, i) => {
      const ds = list[i];
      teams[t.id] = { teamSeed: ds.teamSeed, attempts: ds.attempts, rejectedAttempts: ds.rejected.length, checksums: ds.checksums, flags: ds.flags };
      const p = preflightTeam(ds);
      preflight[t.id] = { pass: p.pass, total: p.total, failed: p.failed };
    });
    pass = Object.values(preflight).every((p) => p.pass);
    if (pass || (!newSeed && attempt === 0 && comp.generation)) break;
    rejectedSeeds.push({ seed, failed: Object.entries(preflight).filter(([, p]) => !p.pass).map(([k, p]) => ({ teamId: k, failed: p.failed })) });
  }
  datasetCache.set(comp.id, { seed, byTeamId: Object.fromEntries(comp.teams.map((t, i) => [t.id, list[i]])) });
  comp.generation = { seed, generatorVersion: GENERATOR_VERSION, templateVersion: TEMPLATE_VERSION, at: clock.now(), ms: Date.now() - t0, teams, preflight, pass, rejectedSeeds };
  comp.status = STATUS.PREFLIGHT;
  audit(comp, teacher, 'GENERATE_DATASETS', { seed, pass });
  changed(comp, 'generate');
  return comp.generation;
}

/** 老師預覽某隊數據、參考公式及預期值（只供老師） */
export function preflightDetail(comp, teacher, teamId) {
  requireOwner(comp, teacher);
  const team = getTeam(comp, teamId);
  const ds = getDataset(comp, team);
  return {
    team: { id: team.id, name: team.name },
    seed: comp.generation.seed,
    teamSeed: ds.teamSeed,
    generatorVersion: ds.generatorVersion,
    checksums: ds.checksums,
    flags: ds.flags,
    preflight: comp.generation.preflight[team.id],
    levels: LEVELS.map((lv) => ({
      level: lv.level,
      sheet: lv.sheet,
      title: lv.title,
      params: summarizeParams(lv.level, ds.levels[lv.level]),
      tasks: lv.tasks.map((t) => ({
        id: t.id,
        bonus: !!t.bonus,
        reference: Object.fromEntries(Object.entries(lv.referenceFormulas).filter(([a]) => t.cells.some((r) => cellInRange(a, r)))),
        expected: Object.fromEntries(Object.entries(ds.ref[lv.level]).filter(([a]) => t.cells.some((r) => cellInRange(a, r))).slice(0, 6)),
      })),
      data: ds.levels[lv.level].data,
      initial: ds.levels[lv.level].initial,
      hiddenSummary: summarizeParams(lv.level, ds.hidden[lv.level]),
    })),
  };
}

function summarizeParams(level, d) {
  const p = { ...d.params };
  if (level === 4) delete p.codes;
  return p;
}

function cellInRange(a, range) {
  const [s, e] = range.split(':');
  if (!e) return a === s;
  const m = /^([A-Z]+)(\d+)$/;
  const [, c, r] = m.exec(a);
  const [, c1, r1] = m.exec(s);
  const [, c2, r2] = m.exec(e);
  return c >= c1 && c <= c2 && Number(r) >= Number(r1) && Number(r) <= Number(r2) && c.length === c1.length;
}

export async function approve(comp, teacher) {
  requireOwner(comp, teacher);
  if (comp.status !== STATUS.PREFLIGHT || !comp.generation) throw new HttpError(409, '請先生成數據並完成 Preflight。');
  if (!comp.generation.pass) throw new HttpError(409, 'Preflight 未全部通過，不能批准。請重新生成。', 'PREFLIGHT_FAILED');
  comp.approval = { at: clock.now(), by: teacher.id, seed: comp.generation.seed, fingerprint: checksum(Object.fromEntries(Object.entries(comp.generation.teams).map(([k, v]) => [k, v.checksums]))) };
  comp.status = STATUS.APPROVED;
  audit(comp, teacher, 'APPROVE_DATASETS', { fingerprint: comp.approval.fingerprint });
  changed(comp, 'approve');
  if (comp.adapter === 'demo') await provisionAll(comp, teacher);
  return comp.approval;
}

/** 建立／分享各隊工作簿 */
export async function provisionAll(comp, teacher, { teamIds = null } = {}) {
  requireOwner(comp, teacher);
  if (!comp.approval) throw new HttpError(409, '數據未批准。');
  const adapter = adapterFor(comp);
  if (comp.adapter === 'google' && !adapter.credentials().ready) {
    throw new HttpError(409, `Google Sheets 尚未連接：${adapter.credentials().reason}。請先在「系統狀態」完成連接。`, 'GOOGLE_NOT_CONNECTED');
  }
  const results = [];
  for (const team of comp.teams) {
    if (teamIds && !teamIds.includes(team.id)) continue;
    try {
      const memberEmails = team.memberIds.map((id) => db.state.users[id]?.email).filter(Boolean);
      const wb = await adapter.provision(comp, team, { memberEmails, existingFileId: team.workbook?.presetFileId || null });
      team.workbook = { ...wb, presetFileId: team.workbook?.presetFileId || null };
      results.push({ teamId: team.id, ok: true });
    } catch (e) {
      team.workbook = { ...(team.workbook || {}), provider: comp.adapter, status: 'ERROR', error: e.message };
      results.push({ teamId: team.id, ok: false, error: e.message });
    }
  }
  comp.health.sheets = results.every((r) => r.ok) ? 'Ready' : results.some((r) => r.ok) ? 'Degraded' : 'Unavailable';
  audit(comp, teacher, 'PROVISION_WORKBOOKS', { results });
  changed(comp, 'provision');
  return results;
}

/** 最少授權替代流程：老師預先建立 Sheet、分享給系統帳戶，再輸入 Sheet ID */
export function setPresetSheet(comp, teacher, teamId, fileId) {
  requireOwner(comp, teacher);
  const team = getTeam(comp, teamId);
  const id = String(fileId || '').trim().replace(/^.*\/d\/([A-Za-z0-9_-]+).*$/, '$1');
  if (!/^[A-Za-z0-9_-]{20,}$/.test(id)) throw new HttpError(400, 'Sheet ID 格式不正確。');
  team.workbook = { ...(team.workbook || {}), provider: 'google', presetFileId: id, status: 'PENDING' };
  audit(comp, teacher, 'SET_PRESET_SHEET', { teamId, fileId: id });
  changed(comp, 'preset-sheet');
}

export function openLobby(comp, teacher) {
  requireOwner(comp, teacher);
  if (comp.status !== STATUS.APPROVED) throw new HttpError(409, '請先批准數據。');
  const notReady = comp.teams.filter((t) => t.workbook?.status !== 'READY');
  if (notReady.length) throw new HttpError(409, `以下隊伍的工作表未準備好：${notReady.map((t) => t.name).join('、')}`, 'WORKBOOK_NOT_READY');
  comp.status = STATUS.LOBBY;
  audit(comp, teacher, 'OPEN_LOBBY');
  changed(comp, 'lobby');
}

// ------------------------------------------------------------------ B. Teams
/** 學生可否加入此比賽（班別名單、Google 帳戶要求）；伺服器端檢查，不能由網址或參數繞過 */
export function checkJoinAllowed(comp, user) {
  const s = comp.settings;
  if (comp.adapter === 'google' && user.provider !== 'google') throw new HttpError(403, '此比賽使用 Google Sheets，請以 Google 帳戶登入。', 'GOOGLE_LOGIN_REQUIRED');
  if (s.requireGoogle && user.provider !== 'google') throw new HttpError(403, '此比賽只接受學校 Google 帳戶登入，請登出後以 Google 登入。', 'GOOGLE_LOGIN_REQUIRED');
  const email = (user.email || '').toLowerCase();
  const listed = (s.allowedEmails || []).length || (s.allowedDomains || []).length;
  if (listed) {
    const okEmail = email && (s.allowedEmails || []).includes(email);
    const okDomain = email && (s.allowedDomains || []).includes(email.split('@')[1]);
    if (!okEmail && !okDomain) throw new HttpError(403, `你的帳戶不在「${comp.classCode || comp.title}」的學生名單內。請確認比賽代碼是否屬於你的班別，或通知老師。`, 'NOT_ON_ROSTER');
  }
}

export function isMember(comp, userId) {
  return !!teamOfUser(comp, userId) || (comp.waiting || []).includes(userId);
}

/**
 * 學生以比賽代碼加入。
 * - teamSelection = 'teacher'：加入等候名單，由老師分隊（teamId 會被忽略）。
 * - teamSelection = 'student'：學生自選一次；已有隊伍後只有老師可以轉隊。
 */
export async function joinTeam(user, joinCode, teamId) {
  const comp = findByJoinCode(joinCode);
  checkJoinAllowed(comp, user);
  const existing = teamOfUser(comp, user.id);
  if (existing) {
    if (existing.id === teamId || !teamId || comp.settings.teamSelection === 'teacher') return { comp, team: existing };
    throw new HttpError(409, `你已加入「${existing.name}」。如需轉隊，請通知老師。`, 'ALREADY_IN_TEAM');
  }
  comp.waiting ??= [];
  if (comp.settings.teamSelection === 'teacher' || !teamId) {
    if (!comp.waiting.includes(user.id)) {
      comp.waiting.push(user.id);
      audit(comp, user, 'JOIN_WAITING', {});
      changed(comp, 'join');
    }
    return { comp, team: null };
  }
  const team = getTeam(comp, teamId);
  if (team.memberIds.length >= comp.settings.maxTeamSize) throw new HttpError(409, '此隊已滿，請選擇其他隊伍或通知老師。', 'TEAM_FULL');
  await addMember(comp, team, user);
  audit(comp, user, 'JOIN_TEAM', { teamId });
  changed(comp, 'join');
  return { comp, team };
}

async function addMember(comp, team, user) {
  comp.waiting = (comp.waiting || []).filter((x) => x !== user.id);
  team.memberIds.push(user.id);
  if (!team.captainId) team.captainId = user.id;
  assignRoles(team);
  if (comp.adapter === 'google' && team.workbook?.status === 'READY' && user.email) {
    try {
      await adapters.google.share(team.workbook, user.email);
      team.workbook.sharedWith = [...new Set([...(team.workbook.sharedWith || []), user.email])];
    } catch (e) {
      team.workbook.shareError = `${user.name}：${e.message}`;
    }
  }
}

/** 老師把等候中的學生分到某隊（或由一隊轉到另一隊） */
export async function assignStudent(comp, teacher, userId, toTeamId) {
  requireOwner(comp, teacher);
  const user = db.state.users[userId];
  if (!user || !isMember(comp, userId)) throw new HttpError(404, '此學生未加入這個比賽。');
  const from = teamOfUser(comp, userId);
  if (from) return transferStudent(comp, teacher, userId, toTeamId, '老師調動隊伍');
  const to = getTeam(comp, toTeamId);
  if (to.memberIds.length >= comp.settings.maxTeamSize) throw new HttpError(409, '目標隊伍已滿。');
  await addMember(comp, to, user);
  audit(comp, teacher, 'ASSIGN_STUDENT', { userId, to: to.id });
  changed(comp, 'assign');
}

/** 自動平均分隊：等候中的學生按人數最少的隊伍依次分配 */
export async function autoAssign(comp, teacher) {
  requireOwner(comp, teacher);
  const waiting = [...(comp.waiting || [])];
  const placed = [];
  for (const userId of waiting) {
    const user = db.state.users[userId];
    if (!user) continue;
    const team = [...comp.teams].filter((t) => t.memberIds.length < comp.settings.maxTeamSize).sort((a, b) => a.memberIds.length - b.memberIds.length || a.index - b.index)[0];
    if (!team) break;
    await addMember(comp, team, user);
    placed.push({ userId, teamId: team.id });
  }
  audit(comp, teacher, 'AUTO_ASSIGN', { placed });
  changed(comp, 'assign');
  return { placed: placed.length, remaining: (comp.waiting || []).length };
}

/** 老師把學生移出比賽（例如加入錯班）；已提交的紀錄保留 */
export async function removeStudent(comp, teacher, userId, reason) {
  requireOwner(comp, teacher);
  if (!reason || String(reason).trim().length < 2) throw new HttpError(400, '移除學生需要註明原因。');
  const from = teamOfUser(comp, userId);
  if (from) {
    from.memberIds = from.memberIds.filter((x) => x !== userId);
    if (from.captainId === userId) from.captainId = from.memberIds[0] || null;
    assignRoles(from);
    const user = db.state.users[userId];
    if (comp.adapter === 'google' && from.workbook?.fileId && user?.email) {
      try { await adapters.google.unshare(from.workbook, user.email); } catch (e) { from.workbook.shareError = e.message; }
    }
  }
  comp.waiting = (comp.waiting || []).filter((x) => x !== userId);
  const user = db.state.users[userId];
  if (user?.currentCompId === comp.id) { user.currentCompId = null; save(); }
  audit(comp, teacher, 'REMOVE_STUDENT', { userId, from: from?.id || null, reason: String(reason).slice(0, 200) });
  changed(comp, 'remove');
}

/** 由同一班另一場比賽（例如第一集）複製隊伍名單：同一隊號的成員放回同一隊 */
export async function copyRoster(comp, teacher, sourceId) {
  requireOwner(comp, teacher);
  const src = getComp(sourceId);
  requireOwner(src, teacher);
  if (src.id === comp.id) throw new HttpError(400, '請選擇另一場比賽。');
  let copied = 0;
  for (const st of src.teams) {
    const dt = comp.teams[st.index];
    if (!dt) continue;
    for (const userId of st.memberIds) {
      const user = db.state.users[userId];
      if (!user || teamOfUser(comp, userId)) continue;
      if (dt.memberIds.length >= comp.settings.maxTeamSize) break;
      await addMember(comp, dt, user);
      copied++;
    }
    if (st.captainId && dt.memberIds.includes(st.captainId)) dt.captainId = st.captainId;
  }
  audit(comp, teacher, 'COPY_ROSTER', { from: src.id, copied });
  changed(comp, 'assign');
  return { copied };
}

export async function transferStudent(comp, teacher, userId, toTeamId, reason) {
  requireOwner(comp, teacher);
  if (!reason) throw new HttpError(400, '轉隊需要註明原因。');
  const from = teamOfUser(comp, userId);
  if (!from) return assignStudent(comp, teacher, userId, toTeamId);
  const to = getTeam(comp, toTeamId);
  if (from.id === to.id) return;
  if (to.memberIds.length >= comp.settings.maxTeamSize) throw new HttpError(409, '目標隊伍已滿。');
  const user = db.state.users[userId];
  if (from) {
    from.memberIds = from.memberIds.filter((x) => x !== userId);
    if (from.captainId === userId) from.captainId = from.memberIds[0] || null;
    assignRoles(from);
    if (comp.adapter === 'google' && from.workbook?.fileId && user?.email) {
      try { await adapters.google.unshare(from.workbook, user.email); } catch (e) { from.workbook.shareError = e.message; }
    }
  }
  to.memberIds.push(userId);
  if (!to.captainId) to.captainId = userId;
  assignRoles(to);
  if (comp.adapter === 'google' && to.workbook?.fileId && user?.email) {
    try { await adapters.google.share(to.workbook, user.email); } catch (e) { to.workbook.shareError = e.message; }
  }
  audit(comp, teacher, 'TRANSFER_STUDENT', { userId, from: from?.id || null, to: to.id, reason });
  changed(comp, 'transfer');
}

/** 每關輪換角色：同一人不會連續兩關當 Driver（2 人或以上） */
export function assignRoles(team) {
  const m = team.memberIds;
  team.roles = {};
  if (!m.length) return;
  for (const lv of LEVELS) {
    const i = lv.level - 1;
    const pick = (k) => m[(i + k) % m.length];
    team.roles[lv.level] = {
      driver: pick(0),
      detective: m.length > 1 ? pick(1) : pick(0),
      checker: m.length > 2 ? pick(2) : pick(m.length > 1 ? 1 : 0),
      navigator: m.length > 3 ? pick(3) : null,
    };
  }
}

export function setRoles(comp, teacher, teamId, level, roles) {
  requireOwner(comp, teacher);
  const team = getTeam(comp, teamId);
  const clean = {};
  for (const k of ['driver', 'detective', 'checker', 'navigator']) {
    if (roles[k] && !team.memberIds.includes(roles[k])) throw new HttpError(400, '角色必須由隊員擔任。');
    clean[k] = roles[k] || null;
  }
  const prev = team.roles[level - 1]?.driver;
  team.roles[level] = clean;
  audit(comp, teacher, 'SET_ROLES', { teamId, level, roles: clean });
  changed(comp, 'roles');
  return { warning: prev && prev === clean.driver ? '提示：同一人連續兩關擔任 Driver。' : null };
}

// ------------------------------------------------------------------ D. Live Control
export function levelTiming(comp, n, now = clock.now()) {
  const l = comp.levels[n];
  if (!l || !l.startedAt) return { elapsedMs: 0, remainingMs: (comp.settings.levelSeconds[n] || 0) * 1000, durationMs: (comp.settings.levelSeconds[n] || 0) * 1000 };
  const end = l.endedAt ?? now;
  const pausedNow = l.pauseStartedAt && !l.endedAt ? end - l.pauseStartedAt : 0;
  const elapsedMs = Math.max(0, end - l.startedAt - (l.pausedMs || 0) - pausedNow);
  return { elapsedMs, durationMs: l.durationMs, remainingMs: Math.max(0, l.durationMs - elapsedMs) };
}

export function startEpisode(comp, teacher) {
  requireOwner(comp, teacher);
  if (comp.status !== STATUS.LOBBY) throw new HttpError(409, '請先開放 Lobby。');
  if (comp.episodeStartedAt) return;
  comp.episodeStartedAt = clock.now();
  comp.audio.bgm = true; // 遊戲開始：背景音樂自動開始
  audit(comp, teacher, 'START_EPISODE');
  triggerAudio(comp, 'E1_INTRO', { by: teacher, auto: true });
  changed(comp, 'episode-start');
}

export function startLevel(comp, teacher, n, { overrideUntaught = false } = {}) {
  requireOwner(comp, teacher);
  n = Number(n);
  const lv = LEVEL_BY_NUM[n];
  if (!lv) throw new HttpError(400, '沒有此關卡。');
  if (comp.paused) throw new HttpError(409, '比賽暫停中，請先繼續。');
  if (!(comp.status === STATUS.LOBBY || /^RUNNING_LEVEL_/.test(comp.status))) throw new HttpError(409, '現在不能開始關卡（請先批准數據並開放 Lobby）。');
  if (!comp.approval) throw new HttpError(409, '未批准數據，不可開始正式比賽。', 'NOT_APPROVED');
  if (comp.levels[n].phase !== 'pending') throw new HttpError(409, `第 ${n} 關已${comp.levels[n].phase === 'active' ? '在進行中' : '結束或略過'}。`);
  const active = LEVELS.find((l) => comp.levels[l.level].phase === 'active');
  if (active) throw new HttpError(409, `第 ${active.level} 關仍在進行中，請先結束該關。`);
  const earlier = LEVELS.filter((l) => l.level < n && comp.levels[l.level].phase === 'pending');
  if (earlier.length) throw new HttpError(409, `請先完成或略過第 ${earlier.map((l) => l.level).join('、')} 關。`);
  const untaught = untaughtFor(comp, n);
  if (untaught.length && !overrideUntaught) {
    throw new HttpError(409, `第 ${n} 關涉及未勾選為「已教授」的技能：${untaught.join('、')}。系統預設不開始此關。請在設定中確認已教授，或略過此關（須註明原因）。`, 'UNTAUGHT_SKILLS');
  }
  if (!comp.episodeStartedAt) comp.episodeStartedAt = clock.now();
  const now = clock.now();
  comp.levels[n] = { phase: 'active', startedAt: now, durationMs: comp.settings.levelSeconds[n] * 1000, pausedMs: 0, pauseStartedAt: null, warned: false, firstClear: null, extendedMs: 0 };
  comp.currentLevel = n;
  comp.status = runningStatus(n);
  audit(comp, teacher, 'START_LEVEL', { level: n });
  studentSfx(comp, null, 'unlock', `unlock-${n}-${now}`);
  triggerAudio(comp, `L${n}_OPEN`, { by: teacher, auto: true });
  changed(comp, 'level-start');
}

export function endLevel(comp, by, n, reason = 'manual') {
  n = Number(n);
  const l = comp.levels[n];
  if (!l || l.phase !== 'active') throw new HttpError(409, '此關不在進行中。');
  const now = clock.now();
  if (l.pauseStartedAt) { l.pausedMs += now - l.pauseStartedAt; l.pauseStartedAt = null; }
  l.endedAt = now;
  l.phase = 'ended';
  l.endReason = reason;
  audit(comp, by, 'END_LEVEL', { level: n, reason });
  if (n < 5) triggerAudio(comp, `L${n}_CLOSE`, { by, auto: true });
  else triggerAudio(comp, 'E1_FINAL_REVEAL', { by, auto: true });
  changed(comp, 'level-end');
}

export function extendLevel(comp, teacher, n, seconds) {
  requireOwner(comp, teacher);
  const l = comp.levels[Number(n)];
  const s = Number(seconds);
  if (!l || l.phase !== 'active') throw new HttpError(409, '此關不在進行中。');
  if (!(s > 0 && s <= 900)) throw new HttpError(400, '延長時間須為 1–900 秒。');
  l.durationMs += s * 1000;
  l.extendedMs = (l.extendedMs || 0) + s * 1000;
  if (levelTiming(comp, n).remainingMs > 60000) l.warned = false;
  audit(comp, teacher, 'EXTEND_LEVEL', { level: Number(n), seconds: s });
  changed(comp, 'extend');
}

export function skipLevel(comp, teacher, n, reason) {
  requireOwner(comp, teacher);
  n = Number(n);
  if (!reason || String(reason).trim().length < 2) throw new HttpError(400, '跳關需要註明理由。');
  const l = comp.levels[n];
  if (!l) throw new HttpError(400, '沒有此關卡。');
  if (l.phase === 'active') endLevel(comp, teacher, n, 'skipped');
  if (l.phase === 'pending') comp.levels[n] = { phase: 'skipped', skipReason: reason };
  else comp.levels[n].skipReason = reason;
  audit(comp, teacher, 'SKIP_LEVEL', { level: n, reason });
  changed(comp, 'skip');
}

export function pause(comp, by, reason = '老師暫停') {
  if (comp.paused) return;
  const now = clock.now();
  comp.paused = true;
  comp.pauseReason = reason;
  comp.prevStatus = comp.status;
  comp.status = STATUS.PAUSED;
  for (const lv of LEVELS) {
    const l = comp.levels[lv.level];
    if (l.phase === 'active' && !l.pauseStartedAt) l.pauseStartedAt = now;
  }
  audit(comp, by, 'PAUSE', { reason });
  changed(comp, 'pause');
}

/**
 * 伺服器重新啟動後呼叫（雲端重新部署、當機、免費方案重新啟動）。
 * 如有關卡正在進行，由「伺服器最後確認仍在運行」的時間起自動暫停：
 * 中斷期間不計時，學生不會因伺服器離線而失去作答時間；老師確認學生已重新連線後按「繼續」。
 */
export function recoverAfterRestart(lastAliveAt, now = clock.now()) {
  const recovered = [];
  if (!lastAliveAt) return recovered;
  const at = Math.min(lastAliveAt, now);
  const gapS = Math.max(1, Math.round((now - at) / 1000));
  for (const comp of Object.values(db.state.competitions)) {
    if (comp.paused) continue; // 老師在中斷前已暫停：暫停時間照常計算，不需處理
    const active = LEVELS.filter((lv) => comp.levels[lv.level]?.phase === 'active');
    if (!active.length) continue;
    comp.paused = true;
    comp.pauseReason = `伺服器曾中斷約 ${gapS} 秒，系統已自動暫停並補回中斷期間的作答時間。請確認學生已重新連線，然後按「繼續」。`;
    comp.prevStatus = comp.status;
    comp.status = STATUS.PAUSED;
    for (const lv of active) {
      const l = comp.levels[lv.level];
      if (!l.pauseStartedAt) l.pauseStartedAt = at;
    }
    audit(comp, null, 'AUTO_PAUSE_RECOVERY', { lastAliveAt: at, restartedAt: now, gapMs: now - at, levels: active.map((lv) => lv.level) });
    changed(comp, 'pause');
    recovered.push({ compId: comp.id, gapMs: now - at, levels: active.map((lv) => lv.level) });
  }
  return recovered;
}

/** 是否有關卡正在計時（需要寫入「伺服器仍在運行」紀錄） */
export function anyLevelRunning() {
  return Object.values(db.state.competitions).some((c) => !c.paused && LEVELS.some((lv) => c.levels[lv.level]?.phase === 'active'));
}

export function resume(comp, by) {
  if (!comp.paused) return;
  const now = clock.now();
  for (const lv of LEVELS) {
    const l = comp.levels[lv.level];
    if (l.pauseStartedAt) { l.pausedMs += now - l.pauseStartedAt; l.pauseStartedAt = null; }
  }
  comp.paused = false;
  comp.pauseReason = null;
  comp.status = comp.prevStatus || STATUS.LOBBY;
  comp.prevStatus = null;
  audit(comp, by, 'RESUME');
  changed(comp, 'resume');
}

export function showResults(comp, teacher) {
  requireOwner(comp, teacher);
  if (comp.paused) resume(comp, teacher);
  const active = LEVELS.find((l) => comp.levels[l.level].phase === 'active');
  if (active) endLevel(comp, teacher, active.level, 'results');
  comp.status = STATUS.RESULTS;
  audit(comp, teacher, 'SHOW_RESULTS');
  changed(comp, 'results');
}

export function archive(comp, teacher) {
  requireOwner(comp, teacher);
  comp.status = STATUS.ARCHIVED;
  audit(comp, teacher, 'ARCHIVE');
  changed(comp, 'archive');
}

export function cancelCompetition(comp, teacher, reason) {
  requireOwner(comp, teacher);
  if (!reason) throw new HttpError(400, '取消比賽需要註明原因。');
  comp.prevStatus = comp.status;
  comp.status = STATUS.CANCELLED;
  audit(comp, teacher, 'CANCEL_COMPETITION', { reason });
  changed(comp, 'cancel');
}

export function deleteCompetition(comp, teacher) {
  requireOwner(comp, teacher);
  if (![STATUS.ARCHIVED, STATUS.CANCELLED, STATUS.DRAFT, STATUS.PREFLIGHT].includes(comp.status)) throw new HttpError(409, '請先封存或取消比賽，再刪除資料。');
  adapters.demo.forget(comp);
  delete db.state.competitions[comp.id];
  datasetCache.delete(comp.id);
  save();
}

export function setLeaderboard(comp, teacher, { hidden, frozen }) {
  requireOwner(comp, teacher);
  if (hidden !== undefined) comp.leaderboard.hidden = !!hidden;
  if (frozen !== undefined) {
    comp.leaderboard.frozen = !!frozen;
    comp.leaderboard.frozenAt = frozen ? clock.now() : null;
    comp.leaderboard.snapshot = frozen ? rankTeams(comp).map(publicRankRow(comp)) : null;
  }
  audit(comp, teacher, 'LEADERBOARD', { hidden, frozen });
  changed(comp, 'leaderboard');
}

export const publicRankRow = (comp) => (s) => {
  const t = getTeam(comp, s.teamId);
  return {
    teamId: t.id, name: t.name, code: t.code, color: t.color, rank: s.rank, total: s.total, baseTotal: s.baseTotal,
    completedLevels: s.completedLevels,
    progress: Object.fromEntries(Object.values(s.levels).map((l) => [l.level, { done: l.tasksDone, total: l.tasksTotal, completed: l.completed }])),
  };
};

/** 每秒檢查：時間到自動截止、剩 60 秒提醒 */
export function tick() {
  const now = clock.now();
  for (const comp of Object.values(db.state.competitions)) {
    if (comp.paused) continue;
    for (const lv of LEVELS) {
      const l = comp.levels[lv.level];
      if (l.phase !== 'active') continue;
      const { remainingMs } = levelTiming(comp, lv.level, now);
      if (remainingMs <= 0) endLevel(comp, null, lv.level, 'timeout');
      else if (remainingMs <= 60000 && !l.warned) {
        l.warned = true;
        triggerAudio(comp, 'TIMER_WARNING', { auto: true });
        changed(comp, 'warning');
      }
    }
  }
}

// ------------------------------------------------------------------ Hints
export function requestHint(comp, user, team, level) {
  level = Number(level);
  const l = comp.levels[level];
  if (!l || l.phase !== 'active') throw new HttpError(409, '此關不在進行中，不能使用提示。');
  if (comp.paused) throw new HttpError(409, '比賽暫停中。');
  const used = comp.hintUses.filter((h) => h.teamId === team.id && h.level === level);
  const hints = LEVEL_BY_NUM[level].hints;
  if (used.length >= hints.length) throw new HttpError(409, '本關的提示已全部使用。');
  const tier = used.length + 1;
  comp.hintUses.push({ teamId: team.id, level, tier, at: clock.now(), userId: user.id });
  audit(comp, user, 'HINT', { teamId: team.id, level, tier });
  changed(comp, 'hint');
  studentSfx(comp, team.id, 'hint', `hint-${team.id}-${level}-${tier}`);
  return { tier, text: hints[tier - 1], cost: tier === 1 ? 10 : 20 };
}

// ------------------------------------------------------------------ 分數處理
export function adjustScore(comp, teacher, teamId, delta, reason) {
  requireOwner(comp, teacher);
  const d = Math.trunc(Number(delta));
  if (!d || Math.abs(d) > 2000) throw new HttpError(400, '調整分數須為非零整數（±2000 內）。');
  if (!reason || String(reason).trim().length < 2) throw new HttpError(400, '手動改分必須註明原因。');
  getTeam(comp, teamId);
  const before = computeTeamScore(comp, teamId).total;
  const adj = { id: `adj_${randCode(8)}`, teamId, delta: d, reason: String(reason).slice(0, 200), by: { id: teacher.id, name: teacher.name }, at: clock.now(), before };
  comp.adjustments.push(adj);
  adj.after = computeTeamScore(comp, teamId).total;
  audit(comp, teacher, 'MANUAL_ADJUST', adj);
  changed(comp, 'adjust');
  return adj;
}

/** 取消有 Bug 的 Task：對所有隊伍同步等值處理（該 Task 不計入基礎分分母，錯誤提交不扣分） */
export function cancelTask(comp, teacher, taskId, reason) {
  requireOwner(comp, teacher);
  if (!TASK_BY_ID[taskId]) throw new HttpError(400, '沒有此 Task。');
  if (!reason) throw new HttpError(400, '取消題目需要註明原因。');
  if (comp.cancelledTasks.some((c) => c.taskId === taskId)) return;
  const before = Object.fromEntries(comp.teams.map((t) => [t.id, computeTeamScore(comp, t.id).total]));
  comp.cancelledTasks.push({ taskId, reason, by: teacher.id, at: clock.now() });
  const after = Object.fromEntries(comp.teams.map((t) => [t.id, computeTeamScore(comp, t.id).total]));
  audit(comp, teacher, 'CANCEL_TASK', { taskId, reason, before, after });
  changed(comp, 'cancel-task');
}

// ------------------------------------------------------------------ 音訊事件（Spoiler Policy）
export function audioAllowed(comp, ev) {
  switch (ev.trigger) {
    case 'episode_start': return !!comp.episodeStartedAt;
    case 'level_open': return comp.levels[ev.level].phase !== 'pending';
    case 'level_close': return ['ended', 'skipped'].includes(comp.levels[ev.level].phase);
    case 'first_clear': return !!comp.levels[ev.level].firstClear;
    case 'final_reveal': return comp.levels[5].phase === 'ended';
    case 'timer_warning': return true;
    default: return false;
  }
}

export function triggerAudio(comp, eventId, { by = null, auto = false } = {}) {
  const ev = AUDIO_EVENT_BY_ID[eventId];
  if (!ev || !ev.public) throw new HttpError(400, '沒有此公開音訊事件。');
  if (!audioAllowed(comp, ev)) throw new HttpError(409, ev.trigger === 'final_reveal' ? 'Spoiler Policy：第 5 關公共回合未完結，不能播放最終揭曉。' : '此音訊事件的觸發條件未達成（避免劇透）。', 'SPOILER_BLOCKED');
  comp.audio.seq += 1;
  const item = { seq: comp.audio.seq, eventId, at: clock.now(), auto, by: by?.id || 'system', replay: comp.audio.log.some((x) => x.eventId === eventId) };
  comp.audio.log.push(item);
  if (comp.audio.log.length > 200) comp.audio.log.shift();
  // 字幕／音檔只在 Spoiler Policy 通過後才隨播放指令送出
  bus.emit('audio', comp.id, { type: 'play', ...item, ...resolvedEvent(eventId) });
  return item;
}

export function audioControl(comp, teacher, action, value) {
  requireOwner(comp, teacher);
  const allowed = ['mute', 'unmute', 'volume', 'skip', 'pause', 'resume', 'stop', 'replay', 'emergency_mute', 'bgm_on', 'bgm_off', 'browser_tts_on', 'browser_tts_off'];
  if (!allowed.includes(action)) throw new HttpError(400, '不支援的音訊操作。');
  audit(comp, teacher, 'AUDIO_CONTROL', { action, value });
  if (action === 'bgm_on' || action === 'bgm_off') { comp.audio.bgm = action === 'bgm_on'; changed(comp, 'bgm'); }
  bus.emit('audio', comp.id, { type: 'control', action, value: value ?? null, at: clock.now() });
  save();
}

/** 播放裝置狀態回報（投影端或老師電腦） */
// ------------------------------------------------------------------ 劇情音訊：只由「指定投影畫面」播放
const PROJECTOR_STALE_MS = 45000;

/**
 * 投影畫面狀態回報（每 15 秒一次及狀態改變時）。
 * 只有一個投影畫面會被指定為「劇情播放裝置」：
 *  - 第一個啟用聲音的投影畫面自動成為指定裝置；
 *  - 指定裝置離線超過 45 秒，下一個已啟用聲音的投影畫面自動接手；
 *  - 另一個投影畫面按「改由這個畫面播放」（claim）可以接手。
 * 老師控制台永遠不播放劇情聲音（只顯示字幕）。
 */
export function projectorStatus(comp, status) {
  const id = String(status.deviceId || '').slice(0, 40);
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) throw new HttpError(400, '投影裝置識別碼不正確。');
  comp.audio.projectors ??= {};
  for (const [k, v] of Object.entries(comp.audio.projectors)) if (clock.now() - v.at > 10 * 60000) delete comp.audio.projectors[k];
  const prev = comp.audio.designated || null;
  comp.audio.projectors[id] = {
    audioEnabled: !!status.audioEnabled, muted: !!status.muted, volume: Number(status.volume) || 0,
    playing: String(status.playing || '').slice(0, 40), queue: Number(status.queue) || 0, at: clock.now(),
  };
  const cur = prev && comp.audio.projectors[prev];
  const curOk = cur && cur.audioEnabled && clock.now() - cur.at < PROJECTOR_STALE_MS;
  if (status.audioEnabled && (status.claim || !curOk)) comp.audio.designated = id;
  comp.audio.projector = { ...comp.audio.projectors[comp.audio.designated] || comp.audio.projectors[id], deviceId: comp.audio.designated || null };
  if (prev !== comp.audio.designated) changed(comp, 'audio-output');
  else bus.emit('changed', comp.id, 'projector-status');
  return { designated: comp.audio.designated === id };
}

/** 目前負責播放劇情聲音的投影畫面（沒有則為 null） */
export function audioOutput(comp) {
  const id = comp.audio.designated;
  const p = id && comp.audio.projectors?.[id];
  return p && p.audioEnabled && clock.now() - p.at < PROJECTOR_STALE_MS ? id : null;
}

/**
 * 學生裝置的遊戲音效（與劇情聲音完全分開）。
 * teamId 有值 → 只送到該隊學生；null → 送到比賽中所有學生（例如新一關解鎖）。
 * id 用作去重：重新整理或重新連線不會再播放同一音效。
 */
export function studentSfx(comp, teamId, kind, id) {
  bus.emit('student-sfx', comp.id, teamId, { kind, id, at: clock.now() });
}

/** 公開音效事件（例如某隊完成一題／一關）：不含任何答案 */
export function publicSfx(comp, kind, team = null, level = null) {
  bus.emit('audio', comp.id, { type: 'sfx', kind, level, team: team ? { id: team.id, name: team.name, color: team.color, code: team.code } : null, at: clock.now() });
}
