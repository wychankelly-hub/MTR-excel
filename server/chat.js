// 隊伍對話：只限同一比賽、同一隊的學生及該比賽的老師；投影畫面及其他隊伍永遠看不到。
// 訊息存於比賽紀錄（comp.chat），按每 50 則分段寫入資料庫：每次只寫入最新一段，適合免費資料庫。
import { clock } from './clock.js';
import { db } from './store.js';
import { bus } from './bus.js';
import { HttpError } from './auth.js';
import { episodeOf } from './episodes/index.js';
import { audit } from './competition.js';

export const CHAT_MAX_LEN = 300;
const RATE = { minGapMs: 800, windowMs: 20000, perWindow: 8, teamPerMinute: 40 };
const recent = new Map(); // userId -> [時間]
const teamRecent = new Map(); // `${compId}:${teamId}` -> [時間]

function nameOf(id) {
  const u = db.state.users[id];
  if (!u) return '—';
  return u.guestTag ? `${u.name}（#${u.guestTag}）` : u.name;
}

export function chatAllowed(comp, team) {
  if (comp.settings.chatEnabled === false) return { ok: false, message: '老師已關閉隊伍對話。' };
  if ((comp.settings.chatMutedTeams || []).includes(team.id)) return { ok: false, message: '老師已暫停你們隊的對話。' };
  return { ok: true };
}

function cleanText(raw) {
  // 移除控制字元及不可見的方向控制字元（\u200B–\u200F、\u2028–\u202E）
  let t = String(raw ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F\u200B-\u200F\u2028-\u202E]/g, '');
  t = t.replace(/\n{3,}/g, '\n\n').trim();
  return t;
}

function rateCheck(comp, team, user) {
  const now = Date.now();
  const mine = (recent.get(user.id) || []).filter((x) => now - x < RATE.windowMs);
  if (mine.length && now - mine.at(-1) < RATE.minGapMs) throw new HttpError(429, '訊息發送太快，請稍等一下。', 'CHAT_RATE');
  if (mine.length >= RATE.perWindow) throw new HttpError(429, `短時間內訊息太多，請 ${Math.ceil((RATE.windowMs - (now - mine[0])) / 1000)} 秒後再試。`, 'CHAT_RATE');
  const tk = `${comp.id}:${team.id}`;
  const tm = (teamRecent.get(tk) || []).filter((x) => now - x < 60000);
  if (tm.length >= RATE.teamPerMinute) throw new HttpError(429, '你們隊這一分鐘的訊息太多，請稍後再試。', 'CHAT_RATE');
  mine.push(now);
  tm.push(now);
  recent.set(user.id, mine);
  teamRecent.set(tk, tm);
}

const publicMsg = (m) => ({ id: m.id, teamId: m.teamId, taskId: m.taskId, userId: m.userId, name: m.name, text: m.deleted ? '' : m.text, at: m.at, deleted: !!m.deleted });

/** 學生發送訊息（伺服器決定隊伍；之後由呼叫者 persistNow 再回覆） */
export function postChat(comp, team, user, { text, taskId, clientId }) {
  // 網絡重試：同一 clientId 只會加入一次
  const cid = /^[A-Za-z0-9_-]{6,64}$/.test(String(clientId || '')) ? String(clientId) : null;
  if (cid) {
    const dup = (comp.chat || []).find((m) => m.userId === user.id && m.clientId === cid);
    if (dup) return { message: publicMsg(dup), duplicate: true };
  }
  const allowed = chatAllowed(comp, team);
  if (!allowed.ok) throw new HttpError(403, allowed.message, 'CHAT_DISABLED');
  const body = cleanText(text);
  if (!body) throw new HttpError(400, '訊息不能空白。', 'CHAT_EMPTY');
  if ([...body].length > CHAT_MAX_LEN) throw new HttpError(400, `訊息最多 ${CHAT_MAX_LEN} 字。`, 'CHAT_TOO_LONG');
  const tid = taskId ? String(taskId) : null;
  if (tid && !episodeOf(comp).taskById[tid]) throw new HttpError(400, '沒有此題目。');
  rateCheck(comp, team, user);
  comp.chat ??= [];
  comp.chatSeq = (comp.chatSeq || 0) + 1;
  const m = { id: `m${comp.chatSeq}`, teamId: team.id, taskId: tid, userId: user.id, name: nameOf(user.id), text: body, at: clock.now(), ...(cid ? { clientId: cid } : {}) };
  comp.chat.push(m);
  return { message: publicMsg(m), duplicate: false };
}

/** 寫入資料庫後才通知隊友及老師 */
export function announceChat(comp, message) {
  bus.emit('chat', comp.id, message.teamId, { type: 'message', message });
}

/** 某隊的對話（學生只可讀取自己隊伍；老師可讀取任何一隊） */
export function chatFor(comp, teamId, { after = 0, limit = 400 } = {}) {
  const list = (comp.chat || []).filter((m) => m.teamId === teamId && (!after || Number(m.id.slice(1)) > after));
  return list.slice(-limit).map(publicMsg);
}

/** 老師刪除訊息（內容記錄於審計紀錄） */
export function deleteChat(comp, teacher, msgId) {
  const m = (comp.chat || []).find((x) => x.id === msgId);
  if (!m) throw new HttpError(404, '找不到此訊息。');
  if (m.deleted) return publicMsg(m);
  audit(comp, teacher, 'CHAT_DELETE', { teamId: m.teamId, messageId: m.id, userId: m.userId, text: m.text });
  m.deleted = true;
  m.text = '';
  m.deletedBy = teacher.id;
  bus.emit('chat', comp.id, m.teamId, { type: 'delete', id: m.id });
  return publicMsg(m);
}

/** 老師畫面：每隊訊息數目 */
export function chatSummary(comp) {
  const out = Object.fromEntries((comp.teams || []).map((t) => [t.id, { count: 0, last: null }]));
  for (const m of comp.chat || []) {
    const s = out[m.teamId];
    if (!s || m.deleted) continue;
    s.count += 1;
    s.last = m.at;
  }
  return out;
}

export function resetChatRate() { recent.clear(); teamRecent.clear(); }
