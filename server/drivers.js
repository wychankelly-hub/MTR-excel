// 隨機 Driver（輪流駕駛）：每一題（Task）由隊中一名學生擔任 Driver，只有 Driver 可以修改該題的作答格及提交。
// 公平輪換：把隊員隨機排列，每人輪到一次後才重新洗牌；未連線的學生不會被選中（全部未連線時才不計連線狀態）。
// 輪換狀態及每題的 Driver 存於比賽紀錄（comp.drivers），隨比賽一同寫入資料庫，重新整理或伺服器重新啟動都不會改變。
// 題目未完成前不會自動更換 Driver（即使答錯或短暫斷線）；只有老師可以重新指派。
import crypto from 'node:crypto';
import { clock } from './clock.js';
import { db } from './store.js';
import { HttpError } from './auth.js';
import { episodeOf } from './episodes/index.js';
import { isAvailable, presenceOf } from './presence.js';
import { taskPhase, openReopens, audit } from './competition.js';

export const OFFLINE_GRACE_MS = 45000; // Driver 離線超過此時間，老師畫面提示可重新指派
const HISTORY_MAX = 400;

export const driverMode = (comp) => !!comp?.settings?.randomDriver;

function stateOf(comp, teamId) {
  comp.drivers ??= {};
  return (comp.drivers[teamId] ??= { round: [], used: [], roundNo: 0, tasks: {}, history: [], last: null, current: null });
}

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 每隊每題的最高（非練習）得分，一次計算 */
function bestMap(comp) {
  const m = new Map();
  for (const s of comp.submissions) {
    if (s.practice || s.status !== 'VERIFIED') continue;
    const key = `${s.teamId}\u0001${s.taskId}`;
    m.set(key, Math.max(m.get(key) || 0, s.earned || 0));
  }
  return m;
}

/**
 * 某隊「目前題目」：按題目次序，第一題開放作答（或老師開放補做）而未全對的題目。
 * 一次只有一題有 Driver；完成後下一題開始時才選下一位 Driver。
 */
export function currentTaskFor(comp, team, best = bestMap(comp)) {
  const ep = episodeOf(comp);
  const cancelled = new Set((comp.cancelledTasks || []).map((c) => c.taskId));
  const reopens = openReopens(comp, team.id).filter((r) => r.mode === 'makeup');
  for (const t of ep.tasks) {
    if (cancelled.has(t.id)) continue;
    if ((best.get(`${team.id}\u0001${t.id}`) || 0) >= t.points) continue;
    if (taskPhase(comp, t) === 'active' || reopens.some((r) => r.taskId === t.id)) return t;
  }
  return null;
}

/** 由輪換表選出下一位 Driver（不改變已指派的題目） */
function pickNext(comp, team, d, { exclude = null } = {}) {
  const members = team.memberIds;
  if (!members.length) return null;
  let eligible = members.filter((id) => isAvailable(comp.id, id));
  if (!eligible.length) eligible = [...members]; // 全部未連線（例如伺服器剛重新啟動）：不計連線狀態
  if (eligible.length > 1 && exclude) eligible = eligible.filter((id) => id !== exclude);
  if (eligible.length === 1) return { userId: eligible[0], solo: members.length === 1 || eligible.length === 1 };
  // 隊員改變：移除已離隊的，新加入的排在本輪最後（未輪到）
  d.round = d.round.filter((id) => members.includes(id));
  d.used = d.used.filter((id) => members.includes(id));
  for (const id of shuffle(members.filter((x) => !d.round.includes(x)))) d.round.push(id);
  let cand = d.round.filter((id) => !d.used.includes(id) && eligible.includes(id));
  if (!cand.length) {
    // 本輪所有可選的隊員都已擔任：重新洗牌開始新一輪（避免同一人連續兩題）
    d.round = shuffle(members);
    if (d.round.length > 1 && d.round[0] === d.last) {
      const j = 1 + crypto.randomInt(d.round.length - 1);
      [d.round[0], d.round[j]] = [d.round[j], d.round[0]];
    }
    d.used = [];
    d.roundNo += 1;
    cand = d.round.filter((id) => eligible.includes(id));
  }
  return { userId: cand[0], solo: false };
}

function record(comp, team, d, taskId, userId, by, reason = '', actor = null) {
  const prev = d.tasks[taskId]?.userId || null;
  d.tasks[taskId] = { userId, at: clock.now(), by };
  if (!d.used.includes(userId) && d.round.includes(userId)) d.used.push(userId);
  d.last = userId;
  d.history.push({ taskId, userId, prev, at: clock.now(), by, reason, actor: actor ? { id: actor.id, name: actor.name } : null, round: d.roundNo });
  if (d.history.length > HISTORY_MAX) d.history.splice(0, d.history.length - HISTORY_MAX);
}

/**
 * 為每隊目前的題目指派 Driver（如尚未指派）。比賽紀錄每次改變時呼叫；回傳是否有新指派。
 * 已指派的題目不會改變（答錯、斷線都不會）；Driver 離隊時才自動改派。
 */
export function syncDrivers(comp) {
  if (!driverMode(comp) || !comp.teams) return false;
  const best = bestMap(comp);
  let changed = false;
  for (const team of comp.teams) {
    const d = stateOf(comp, team.id);
    const cur = team.memberIds.length ? currentTaskFor(comp, team, best) : null;
    const curId = cur?.id || null;
    if (d.current !== curId) { d.current = curId; changed = true; }
    if (!cur) continue;
    const a = d.tasks[cur.id];
    if (a && team.memberIds.includes(a.userId)) continue;
    const p = pickNext(comp, team, d);
    if (!p) continue;
    record(comp, team, d, cur.id, p.userId, p.solo ? 'solo' : 'auto', a ? '原 Driver 已離開隊伍' : '');
    changed = true;
  }
  return changed;
}

/** 某隊某題的 Driver（userId 或 null） */
export function driverOf(comp, team, taskId) {
  return comp.drivers?.[team.id]?.tasks?.[taskId]?.userId || null;
}

/**
 * 伺服器端權限：Random Driver 模式下，正式作答（非練習）只有目前題目的 Driver 可以修改及提交。
 * 回傳 null（可以）或 { code, message }。
 */
export function driverBlock(comp, team, user, taskId) {
  if (!driverMode(comp) || !user) return null;
  const d = comp.drivers?.[team.id];
  const cur = d?.current ?? currentTaskFor(comp, team)?.id ?? null;
  if (taskId !== cur) {
    return { code: 'NOT_CURRENT_TASK', message: cur ? `Random Driver 模式：請先完成目前的題目 ${cur}。` : 'Random Driver 模式：現在沒有開放的題目。' };
  }
  const driver = d?.tasks?.[taskId]?.userId || null;
  if (driver !== user.id) {
    return { code: 'NOT_DRIVER', message: `只有本題的 Driver（${nameOf(comp, driver)}）可以輸入及提交。你可以在隊伍對話提出建議。` };
  }
  return null;
}

function nameOf(comp, id) {
  if (!id) return '未指派';
  const u = db.state.users[id];
  if (!u) return '—';
  return u.guestTag ? `${u.name}（#${u.guestTag}）` : u.name;
}

/** 老師重新指派（userId 留空 = 按輪換表選下一位，並排除目前的 Driver） */
export function setDriver(comp, teacher, { teamId, taskId, userId, reason = '' }) {
  if (!driverMode(comp)) throw new HttpError(409, '此比賽未開啟 Random Driver 模式。', 'DRIVER_OFF');
  const team = comp.teams.find((t) => t.id === teamId);
  if (!team) throw new HttpError(404, '找不到此隊伍。');
  if (!team.memberIds.length) throw new HttpError(409, '此隊伍沒有隊員。');
  const ep = episodeOf(comp);
  const d = stateOf(comp, team.id);
  const tid = taskId || d.current || currentTaskFor(comp, team)?.id;
  if (!tid || !ep.taskById[tid]) throw new HttpError(400, '請選擇題目（此隊現在沒有開放的題目）。');
  const prev = d.tasks[tid]?.userId || null;
  let next = userId ? String(userId) : null;
  if (next && !team.memberIds.includes(next)) throw new HttpError(400, 'Driver 必須是本隊隊員。');
  if (!next) next = pickNext(comp, team, d, { exclude: prev })?.userId;
  if (!next) throw new HttpError(409, '沒有可以擔任 Driver 的隊員。');
  // 原 Driver 未曾為此題提交（例如一直離線）：退回本輪的機會，之後仍會輪到
  if (prev && prev !== next && !comp.submissions.some((s) => s.teamId === team.id && s.taskId === tid && s.userId === prev && !s.practice)) {
    d.used = d.used.filter((id) => id !== prev);
  }
  record(comp, team, d, tid, next, 'teacher', String(reason || '').slice(0, 120), teacher);
  audit(comp, teacher, 'SET_DRIVER', { teamId, taskId: tid, from: prev, to: next, manual: !!userId });
  return { teamId, taskId: tid, userId: next, prev };
}

/** 學生畫面：本隊目前題目及 Driver */
export function studentDriverView(comp, team, user) {
  if (!driverMode(comp)) return { enabled: false };
  const d = comp.drivers?.[team.id];
  const cur = d?.current || null;
  const driver = cur ? d.tasks[cur]?.userId || null : null;
  const p = driver ? presenceOf(comp.id, driver) : null;
  return {
    enabled: true,
    taskId: cur,
    driver: driver ? { id: driver, name: nameOf(comp, driver), isMe: driver === user.id, online: p.online || !p.seen, offlineSince: p.online ? null : p.offlineSince } : null,
    tasks: Object.fromEntries(Object.entries(d?.tasks || {}).map(([tid, a]) => [tid, { name: nameOf(comp, a.userId), isMe: a.userId === user.id }])),
    myTurns: Object.values(d?.tasks || {}).filter((a) => a.userId === user.id).length,
  };
}

/** 老師畫面：每隊目前 Driver、連線狀態、指派紀錄、參與次數 */
export function teacherDriverView(comp) {
  if (!comp.teams) return { enabled: false, teams: {} };
  const teams = {};
  for (const team of comp.teams) {
    const d = comp.drivers?.[team.id];
    const cur = d?.current || null;
    const driver = cur ? d.tasks[cur]?.userId || null : null;
    const p = driver ? presenceOf(comp.id, driver) : null;
    const counts = Object.fromEntries(team.memberIds.map((id) => [id, 0]));
    for (const a of Object.values(d?.tasks || {})) if (a.userId in counts) counts[a.userId] += 1;
    teams[team.id] = {
      current: cur,
      driver: driver ? { id: driver, name: nameOf(comp, driver), online: p.online, seen: p.seen, offlineSince: p.offlineSince } : null,
      tasks: Object.fromEntries(Object.entries(d?.tasks || {}).map(([tid, a]) => [tid, { id: a.userId, name: nameOf(comp, a.userId), by: a.by, at: a.at }])),
      members: team.memberIds.map((id) => ({ id, name: nameOf(comp, id), turns: counts[id], online: presenceOf(comp.id, id).online })),
      history: (d?.history || []).slice(-60).map((h) => ({ ...h, name: nameOf(comp, h.userId), prevName: h.prev ? nameOf(comp, h.prev) : null })),
      round: d?.roundNo ?? 0,
    };
  }
  return { enabled: driverMode(comp), graceMs: OFFLINE_GRACE_MS, teams };
}
