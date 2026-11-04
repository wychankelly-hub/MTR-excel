// 驗收測試 Q：伺服器被強制終止（SIGKILL，模擬 Render 當機／重新部署）後，
// 每題的 Driver、輪換狀態、隊伍對話及已儲存的公式全部保留；重新啟動後輪換繼續（不會重新開始）。
// 設定 TEST_DATABASE_URL 時使用 PostgreSQL，否則使用同一個本機資料夾。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { cookieJar } from './cookie-jar.js';

const DB = process.env.TEST_DATABASE_URL;
const ROOT = path.resolve(import.meta.dirname, '..');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'taiyau-q-'));
const children = new Set();
test.after(() => { for (const ch of children) ch.kill('SIGKILL'); });

function startServer(port) {
  const env = { ...process.env, PORT: String(port), ALLOW_DEMO_LOGIN: 'true', DEMO_TEACHER_PIN: 'q-pin-2468', SESSION_SECRET: 'q-fixed-secret', SECURE_COOKIES: 'false', NODE_TEST_CONTEXT: '', DATA_DIR };
  if (DB) env.DATABASE_URL = DB; else delete env.DATABASE_URL;
  const child = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  child.on('exit', () => children.delete(child));
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const ready = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`伺服器未能啟動：${out}`)), 20000);
    child.stdout.on('data', () => { if (out.includes('伺服器：')) { clearTimeout(t); resolve(); } });
    child.on('exit', (c) => reject(new Error(`伺服器結束 ${c}：${out}`)));
  });
  return { child, ready };
}

let base;
function agent() {
  const jar = cookieJar();
  return async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', cookie: jar.header() }, body: body ? JSON.stringify(body) : undefined });
    jar.update(r);
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}

test('8. 強制終止伺服器後：Driver 指派、輪換、對話及公式全部保留', { timeout: 120000 }, async () => {
  if (DB) {
    const pg = (await import('pg')).default;
    const c = new pg.Client({ connectionString: DB });
    await c.connect();
    await c.query('DROP TABLE IF EXISTS ty_kv, ty_assets, ty_cells');
    await c.end();
  }
  const port = 40500 + Math.floor(Math.random() * 400);
  base = `http://127.0.0.1:${port}/api`;
  let s = startServer(port);
  await s.ready;
  const T = agent();
  await T('POST', '/auth/demo', { role: 'teacher', pin: 'q-pin-2468' });
  const id = (await T('POST', '/teacher/competitions', { episode: 'E1', teamCount: 4, randomDriver: true, teamSelection: 'teacher' })).body.id;
  const tp = (p, b) => T('POST', `/teacher/competitions/${id}${p}`, b);
  await tp('/generate', {});
  await tp('/approve');
  await tp('/lobby');
  let v = (await T('GET', `/teacher/competitions/${id}`)).body;
  const S = {};
  for (const k of ['a', 'b', 'c']) {
    S[k] = agent();
    await S[k]('POST', '/auth/demo', { role: 'student', name: `Q-${k}` });
    await S[k]('POST', '/student/join', { joinCode: v.joinCode });
  }
  v = (await T('GET', `/teacher/competitions/${id}`)).body;
  for (const w of v.waiting) await tp('/assign', { userId: w.id, teamId: 't1' });
  await tp('/start-episode');
  await tp('/levels/1/start');
  v = (await T('GET', `/teacher/competitions/${id}`)).body;
  const before = v.drivers.teams.t1;
  assert.ok(before.driver, '第一題已有 Driver');
  const meOf = async (k) => (await S[k]('GET', '/student/state')).body;
  const states = await Promise.all(['a', 'b', 'c'].map(meOf));
  const dk = ['a', 'b', 'c'][states.findIndex((x) => x.driver.driver?.isMe)];
  // Driver 輸入一格，三人各發一則訊息
  const p = (await S[dk]('GET', '/sheet/L1_Fare')).body;
  const ops = (await S[dk]('POST', '/sheet/L1_Fare/ops', { ops: [{ a: 'D2', i: '=B2*C2*$H$1', base: p.cells.D2?.v ?? 0 }] })).body;
  assert.equal(ops.applied.length, 1);
  for (const k of ['a', 'b', 'c']) assert.equal((await S[k]('POST', '/chat', { text: `restart test ${k}`, taskId: before.current })).status, 200);

  // ---- 強制終止（不給伺服器任何機會寫入）並重新啟動
  s.child.kill('SIGKILL');
  await new Promise((r) => s.child.once('exit', r));
  s = startServer(port);
  await s.ready;

  v = (await T('GET', `/teacher/competitions/${id}`)).body;
  const after = v.drivers.teams.t1;
  assert.equal(after.current, before.current);
  assert.equal(after.driver.id, before.driver.id, '重新啟動後 Driver 不變');
  assert.deepEqual(after.tasks, before.tasks);
  const st = await meOf(dk);
  assert.equal(st.driver.driver.isMe, true, '學生 session 及 Driver 身份保留');
  assert.equal((await S[dk]('GET', '/sheet/L1_Fare')).body.cells.D2.i, '=B2*C2*$H$1', '已儲存的公式保留');
  const msgs = (await S.a('GET', '/chat')).body.messages;
  assert.deepEqual(msgs.map((m) => m.text).sort(), ['restart test a', 'restart test b', 'restart test c']);
  // 當機後關卡自動暫停（原有保護）；老師按「繼續」
  assert.equal(v.paused, true);
  assert.equal((await tp('/resume')).status, 200);
  // 非 Driver 仍然被拒絕
  const nd = ['a', 'b', 'c'].find((k) => k !== dk);
  const bad = (await S[nd]('POST', '/sheet/L1_Fare/ops', { ops: [{ a: 'D3', i: '=1', base: 0 }] })).body;
  assert.equal(bad.rejected[0]?.code, 'NOT_DRIVER');
  // 輪換延續：完成第一題後，下一題的 Driver 是另一人
  const fx = await import('../server/episode1/fixtures.js');
  const cur = (await S[dk]('GET', '/sheet/L1_Fare')).body;
  const fill = Object.entries(fx.correctInputs(after.current)).map(([a, i]) => ({ a, i, base: cur.cells[a]?.v ?? 0 }));
  assert.equal((await S[dk]('POST', '/sheet/L1_Fare/ops', { ops: fill })).body.rejected.length, 0);
  assert.equal((await S[dk]('POST', '/student/submit', { taskId: after.current, idempotencyKey: `q-restart-${Date.now()}` })).body.status, 'VERIFIED');
  v = (await T('GET', `/teacher/competitions/${id}`)).body;
  assert.notEqual(v.drivers.teams.t1.current, after.current);
  assert.notEqual(v.drivers.teams.t1.driver.id, before.driver.id, '下一題由另一名隊員擔任');
  s.child.kill('SIGKILL');
});

test('第三集：強制終止伺服器後，排序、篩選、圖表設定及作答全部保留，批改結果一致', { timeout: 120000 }, async () => {
  const port = 41000 + Math.floor(Math.random() * 400);
  base = `http://127.0.0.1:${port}/api`;
  let s = startServer(port);
  await s.ready;
  const T = agent();
  await T('POST', '/auth/demo', { role: 'teacher', pin: 'q-pin-2468' });
  const id = (await T('POST', '/teacher/competitions', { episode: 'E3', teamCount: 4, teamSelection: 'teacher' })).body.id;
  const tp = (p, b) => T('POST', `/teacher/competitions/${id}${p}`, b);
  await tp('/generate', {}); await tp('/approve'); await tp('/lobby');
  let v = (await T('GET', `/teacher/competitions/${id}`)).body;
  const A = agent();
  await A('POST', '/auth/demo', { role: 'student', name: 'Q3-a' });
  await A('POST', '/student/join', { joinCode: v.joinCode });
  v = (await T('GET', `/teacher/competitions/${id}`)).body;
  await tp('/assign', { userId: v.waiting[0].id, teamId: 't1' });
  await tp('/start-episode'); await tp('/levels/1/start');
  const p = (await A('GET', '/sheet/E3L1_Complaints')).body;
  const sort = { ops: [{ keys: [{ col: 'H', dir: 'desc' }] }] };
  const filter = { crit: { G: { values: ['UNCLE-WONG'] }, E: { values: ['DATA'] } } };
  const w = (await A('POST', '/sheet/E3L1_Complaints/ops', { ops: [{ a: '!SORT', i: sort, base: 0 }, { a: '!FILTER', i: filter, base: 0 }, { a: 'B123', i: '=A2', base: 0 }, { a: 'B124', i: '=C4', base: 0 }, { a: 'B126', i: '=SUBTOTAL(3,A2:A121)', base: 0 }] })).body;
  assert.equal(w.rejected.length + w.conflicts.length, 0, JSON.stringify(w));
  void p;
  s.child.kill('SIGKILL');
  await new Promise((r) => s.child.once('exit', r));
  s = startServer(port);
  await s.ready;
  const after = (await A('GET', '/sheet/E3L1_Complaints')).body;
  assert.deepEqual(after.cells['!SORT'].i, sort, '排序設定保留');
  assert.deepEqual(after.cells['!FILTER'].i, filter, '篩選設定保留');
  assert.equal(after.cells.B126.i, '=SUBTOTAL(3,A2:A121)');
  await tp('/resume');
  const r = (await A('POST', '/student/submit', { taskId: 'E3-L1-T1', idempotencyKey: `q3-${Date.now()}` })).body;
  assert.equal(r.status, 'VERIFIED', JSON.stringify(r.errors));
  s.child.kill('SIGKILL');
});
