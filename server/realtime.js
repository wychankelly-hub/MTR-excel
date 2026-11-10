// Server-Sent Events：每個連線按角色取得過濾後的資料。
import { bus } from './bus.js';
import { db } from './store.js';
import { connected, disconnected } from './presence.js';

const clients = new Set(); // { res, viewFn, info: { role, compId, userId, teamId } }
const pending = new Map(); // compId -> timer

export function addClient(req, res, info, viewFn) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const client = { res, viewFn, info }; // info 可含 getter（例如 teamId 會隨轉隊改變）
  clients.add(client);
  send(client, 'state', viewFn());
  const ka = setInterval(() => { try { res.write(': keep-alive\n\n'); } catch { /* 連線已關閉 */ } }, 20000);
  res.on?.('error', () => { clearInterval(ka); clients.delete(client); });
  // 學生連線狀態（選擇 Driver、顯示 Driver 是否離線）：上線／離線時更新老師及隊友的畫面（不寫入資料庫）
  const student = info.role === 'student' && info.userId ? [info.compId, info.userId] : null;
  if (student && connected(...student)) bus.emit('changed', info.compId, 'presence');
  req.on('close', () => {
    clearInterval(ka);
    clients.delete(client);
    if (student && disconnected(...student)) bus.emit('changed', info.compId, 'presence');
  });
}

function send(client, event, data) {
  try {
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch { /* 連線已關閉 */ }
}

function flushComp(compId) {
  pending.delete(compId);
  if (!db.state.competitions[compId]) return;
  for (const c of clients) {
    if (c.info.compId !== compId) continue;
    try { send(c, 'state', c.viewFn()); } catch (e) { send(c, 'error', { message: e.message }); }
  }
}

bus.on('changed', (compId) => {
  if (pending.has(compId)) return;
  pending.set(compId, setTimeout(() => flushComp(compId), 120));
});

bus.on('audio', (compId, payload) => {
  for (const c of clients) if (c.info.compId === compId && (c.info.role === 'projector' || c.info.role === 'teacher')) send(c, 'audio', payload);
});

// 學生遊戲音效：teamId 為 null 時送到所有學生，否則只送到該隊
bus.on('student-sfx', (compId, teamId, payload) => {
  for (const c of clients) if (c.info.compId === compId && c.info.role === 'student' && (teamId === null || c.info.teamId === teamId)) send(c, 'sfx', payload);
});

// 工作表修改：只送到同一比賽、同一隊的學生，以及該比賽的老師（唯讀預覽）
// 練習可以屬於之前的劇集：學生的即時連線屬另一場比賽時，仍按隊伍名單送到同隊隊友
function isTeamMember(compId, teamId, userId) {
  return !!db.state.competitions[compId]?.teams.find((t) => t.id === teamId)?.memberIds.includes(userId);
}

bus.on('cells', (compId, teamId, payload) => {
  for (const c of clients) {
    if (c.info.role === 'teacher' ? c.info.compId === compId : c.info.role === 'student' && isTeamMember(compId, teamId, c.info.userId)) send(c, 'cells', { compId, teamId, ...payload });
  }
});

bus.on('presence', (compId, teamId, payload) => {
  for (const c of clients) {
    if (c.info.role === 'student' && c.info.userId === payload.user.id) continue;
    if (c.info.role === 'teacher' ? c.info.compId === compId : c.info.role === 'student' && isTeamMember(compId, teamId, c.info.userId)) send(c, 'presence', { compId, teamId, ...payload });
  }
});

// 隊伍對話：只送到同一比賽、同一隊的學生及該比賽的老師；投影畫面永遠收不到
bus.on('chat', (compId, teamId, payload) => {
  for (const c of clients) {
    if (c.info.compId !== compId) continue;
    if (c.info.role === 'teacher' || (c.info.role === 'student' && c.info.teamId === teamId && isTeamMember(compId, teamId, c.info.userId))) send(c, 'chat', { teamId, ...payload });
  }
});

/** 所有即時連線（學生、老師、投影畫面）的數目：上課中仍開着的頁面 */
export function totalClients() {
  return clients.size;
}

export function clientCount(compId) {
  const out = { teacher: 0, student: 0, projector: 0 };
  for (const c of clients) if (c.info.compId === compId) out[c.info.role]++;
  return out;
}
