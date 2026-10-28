// Server-Sent Events：每個連線按角色取得過濾後的資料。
import { bus } from './bus.js';
import { db } from './store.js';

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
  const ka = setInterval(() => res.write(': keep-alive\n\n'), 20000);
  req.on('close', () => { clearInterval(ka); clients.delete(client); });
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

bus.on('sheet', (compId, teamId, sheet, byUserId) => {
  for (const c of clients) if (c.info.compId === compId && c.info.role === 'student' && c.info.teamId === teamId) send(c, 'sheet', { sheet, byUserId });
});

export function clientCount(compId) {
  const out = { teacher: 0, student: 0, projector: 0 };
  for (const c of clients) if (c.info.compId === compId) out[c.info.role]++;
  return out;
}
