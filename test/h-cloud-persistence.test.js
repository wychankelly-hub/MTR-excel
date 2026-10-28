// 雲端持久性測試（需要真實 PostgreSQL：設定 TEST_DATABASE_URL）。
// 以獨立程序啟動伺服器（DATABASE_URL），建立比賽、學生作答及提交、上載錄音及角色圖片，
// 然後「關掉」伺服器（模擬雲端重新部署／重啟；與老師電腦無關），再啟動新程序，檢查所有資料仍在。
// 亦測試強制終止（SIGKILL，模擬當機）後最近的提交仍然保存。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import pg from 'pg';

const DB = process.env.TEST_DATABASE_URL;
const ROOT = path.resolve(import.meta.dirname, '..');

function startServer(port) {
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: DB, PORT: String(port), DEMO_TEACHER_PIN: 'cloud-pin-8899', SESSION_SECRET: 'fixed-secret-for-test', SECURE_COOKIES: 'false', NODE_TEST_CONTEXT: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const ready = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`伺服器未能啟動：${out}`)), 20000);
    child.stdout.on('data', () => { if (out.includes('伺服器：')) { clearTimeout(t); resolve(); } });
    child.on('exit', (c) => reject(new Error(`伺服器結束 ${c}：${out}`)));
  });
  return { child, ready, log: () => out };
}

function agent(base) {
  let cookie = '';
  return async (method, url, body, headers = {}) => {
    const isBuf = Buffer.isBuffer(body);
    const r = await fetch(base + url, { method, headers: { ...(isBuf ? {} : { 'content-type': 'application/json' }), cookie, ...headers }, body: body === undefined ? undefined : isBuf ? body : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* 非 JSON */ }
    return { status: r.status, body: json, text, headers: r.headers };
  };
}

test('雲端資料庫：伺服器重啟／重新部署／當機後，比賽進度、成績、session、錄音及角色圖片全部保留', { skip: !DB && '未設定 TEST_DATABASE_URL', timeout: 120000 }, async () => {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  await c.query('DROP TABLE IF EXISTS ty_kv, ty_assets');
  await c.end();

  const port = 39000 + Math.floor(Math.random() * 500);
  const base = `http://127.0.0.1:${port}`;
  let s1 = startServer(port);
  await s1.ready;
  assert.match(s1.log(), /雲端 PostgreSQL/);
  const T = agent(base);
  const S = agent(base);
  assert.equal((await T('POST', '/api/auth/demo', { role: 'teacher', pin: '2468' })).status, 403, '雲端不接受預設 PIN');
  assert.equal((await T('POST', '/api/auth/demo', { role: 'teacher', pin: 'cloud-pin-8899' })).status, 200);
  const { id } = (await T('POST', '/api/teacher/competitions', { teamCount: 6, classCode: '4A' })).body;
  await T('POST', `/api/teacher/competitions/${id}/generate`, {});
  await T('POST', `/api/teacher/competitions/${id}/approve`);
  await T('POST', `/api/teacher/competitions/${id}/lobby`);
  const joinCode = (await T('GET', `/api/teacher/competitions/${id}`)).body.joinCode;
  await S('POST', '/api/auth/demo', { role: 'student', name: 'Cloud Kid' });
  assert.equal((await S('POST', '/api/student/join', { joinCode, teamId: 't3' })).status, 200);
  await T('POST', `/api/teacher/competitions/${id}/start-episode`);
  await T('POST', `/api/teacher/competitions/${id}/levels/1/start`);
  const edits = Array.from({ length: 20 }, (_, i) => ({ addr: `D${i + 2}`, input: `=B${i + 2}*C${i + 2}*$H$1` }));
  await S('POST', '/api/student/demo-sheet/L1_Fare/edit', { edits });
  const sub = await S('POST', '/api/student/submit', { taskId: 'L1-T1', idempotencyKey: 'cloud-key-0001' });
  assert.equal(sub.body.status, 'VERIFIED');
  const mp3 = Buffer.from('ID3\u0003fake-mp3-for-test', 'binary');
  assert.equal((await T('POST', '/api/teacher/audio/assets/L1_OPEN_01/upload', mp3, { 'content-type': 'audio/mpeg' })).status, 200);
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6360000002000154a24f5d0000000049454e44ae426082', 'hex');
  assert.equal((await T('POST', '/api/teacher/characters/chanding/neutral', png, { 'content-type': 'image/png' })).status, 200);
  const before = (await T('GET', `/api/teacher/competitions/${id}`)).body;
  const scoreBefore = before.scores.find((x) => x.teamId === 't3').total;
  assert.ok(scoreBefore > 0);

  // 1. 正常關閉（雲端重新部署會送出 SIGTERM）
  s1.child.kill('SIGTERM');
  await new Promise((r) => s1.child.on('exit', r));
  const s2 = startServer(port);
  await s2.ready;
  const after = await T('GET', `/api/teacher/competitions/${id}`);
  assert.equal(after.status, 200, '老師 session 在重啟後仍然有效');
  assert.equal(after.body.scores.find((x) => x.teamId === 't3').total, scoreBefore, '分數保留');
  assert.equal(after.body.teams.find((t) => t.id === 't3').members.length, 1, '隊伍成員保留');
  const st = await S('GET', '/api/student/state');
  assert.equal(st.status, 200, '學生 session 保留');
  assert.equal(st.body.levelDetails[0].tasks[0].best, 2, '學生已核實的分數保留');
  const sheet = await S('GET', '/api/student/demo-sheet/L1_Fare');
  assert.equal(sheet.body.cells.D2.i, '=B2*C2*$H$1', '工作表作答內容保留');
  const audio = (await T('GET', '/api/teacher/audio/assets')).body.lines.find((l) => l.line_id === 'L1_OPEN_01');
  assert.match(audio.url, /^\/media\/audio\/L1_OPEN_01\.mp3/, '老師上載的錄音存於雲端資產庫');
  const media = await T('GET', audio.url);
  assert.equal(media.headers.get('content-type'), 'audio/mpeg');
  const chars = (await T('GET', '/api/characters')).body;
  assert.ok(chars.chanding?.neutral, '角色圖片保留');
  // 同一 Idempotency Key 在重啟後仍不會重複計分
  const replay = await S('POST', '/api/student/submit', { taskId: 'L1-T1', idempotencyKey: 'cloud-key-0001' });
  assert.equal(replay.body.replayed, true);

  // 2. 強制終止（模擬當機）：最近的提交亦應已寫入資料庫
  await S('POST', '/api/student/demo-sheet/L1_Fare/edit', { edits: [{ addr: 'F2', input: '=E2-D2' }] });
  const sub2 = await S('POST', '/api/student/submit', { taskId: 'L1-T2', idempotencyKey: 'cloud-key-0002' });
  assert.equal(sub2.body.status, 'REJECTED');
  await new Promise((r) => setTimeout(r, 1200)); // 寫入延遲最多約 0.2 秒
  s2.child.kill('SIGKILL');
  await new Promise((r) => s2.child.on('exit', r));
  const s3 = startServer(port);
  await s3.ready;
  const after2 = (await T('GET', `/api/teacher/competitions/${id}`)).body;
  assert.ok(after2.submissions.some((x) => x.taskId === 'L1-T2'), '當機前的提交已保存');
  const health = await T('GET', '/healthz');
  assert.equal(health.body.storage.driver, 'postgres');
  s3.child.kill('SIGTERM');
  await new Promise((r) => s3.child.on('exit', r));
});
