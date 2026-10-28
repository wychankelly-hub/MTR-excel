// 雲端重新啟動可靠性測試（需要真實 PostgreSQL：設定 TEST_DATABASE_URL）。
// 以真正的程序強制終止（SIGKILL，模擬 Render 當機／重新啟動）測試：
//   1. 學生正在提交時伺服器被終止：已回覆的答案及分數不會遺失，亦不會重複計分；
//   2. 關卡計時中伺服器離線：重新啟動後自動暫停並補回中斷時間；
//   3. 重新部署時新舊兩個實例同時運行：舊實例不可再寫入（不會覆蓋新實例的資料）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import pg from 'pg';
import { correctInputs } from '../server/episode1/fixtures.js';

const DB = process.env.TEST_DATABASE_URL;
const ROOT = path.resolve(import.meta.dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer(port) {
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: DB, PORT: String(port), DEMO_TEACHER_PIN: 'cloud-pin-8899', SESSION_SECRET: 'fixed-secret-for-test', SECURE_COOKIES: 'false', NODE_TEST_CONTEXT: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  child.on('exit', () => children.delete(child));
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const ready = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`伺服器未能啟動：${out}`)), 20000);
    child.stdout.on('data', () => { if (out.includes('伺服器：')) { clearTimeout(t); resolve(); } });
    child.on('exit', (c) => { clearTimeout(t); reject(new Error(`伺服器結束 ${c}：${out}`)); });
  });
  ready.catch(() => {});
  const exited = new Promise((r) => child.on('exit', r));
  return { child, ready, exited, log: () => out };
}

function agent(base) {
  let cookie = '';
  return async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* 非 JSON */ }
    return { status: r.status, body: json };
  };
}

/** 與學生端相同的重試規則：網絡錯誤或 502／503／504 → 以同一個 Key 重試 */
async function withRetry(fn, deadline = Date.now() + 60000) {
  for (;;) {
    try {
      const r = await fn();
      if (![502, 503, 504].includes(r.status)) return r;
    } catch { /* 伺服器離線 */ }
    if (Date.now() > deadline) throw new Error('重試逾時');
    await sleep(300);
  }
}

/** 直接由資料庫讀取完整比賽紀錄（核心＋分段的提交紀錄） */
async function rawCompetition(id) {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  const core = (await c.query('SELECT value FROM ty_kv WHERE key = $1', [`competition:${id}`])).rows[0].value;
  const rows = (await c.query('SELECT key, value FROM ty_kv WHERE key LIKE $1', [`competition:${id}:sub:%`])).rows;
  const owner = (await c.query(`SELECT value FROM ty_kv WHERE key = 'owner'`)).rows[0].value;
  await c.end();
  const chunks = rows.sort((a, b) => Number(a.key.split(':').pop()) - Number(b.key.split(':').pop())).map((r) => r.value);
  return { core, chunks, owner, submissions: chunks.flat() };
}

const L1 = { 'L1-T1': 'D', 'L1-T2': 'F', 'L1-T3': 'H' };
function inputsFor(taskId, correct) {
  const ok = correctInputs(taskId);
  return Object.entries(ok).map(([addr, input]) => ({ addr, input: correct ? input : '=1' }));
}

const children = new Set();
test.after(() => { for (const ch of children) ch.kill('SIGKILL'); });

test('伺服器在提交途中被強制終止：已回覆的答案不遺失、不重複；計時自動暫停並補回；新舊實例不會互相覆蓋', { skip: !DB && '未設定 TEST_DATABASE_URL', timeout: 240000 }, async () => {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  await c.query('DROP TABLE IF EXISTS ty_kv, ty_assets');
  await c.end();

  const port = 40000 + Math.floor(Math.random() * 500);
  const base = `http://127.0.0.1:${port}`;
  let srv = startServer(port);
  await srv.ready;
  const T = agent(base);
  assert.equal((await T('POST', '/api/auth/demo', { role: 'teacher', pin: 'cloud-pin-8899' })).status, 200);
  const { id } = (await T('POST', '/api/teacher/competitions', { teamCount: 6, classCode: '4R' })).body;
  await T('POST', `/api/teacher/competitions/${id}/generate`, {});
  await T('POST', `/api/teacher/competitions/${id}/approve`);
  await T('POST', `/api/teacher/competitions/${id}/lobby`);
  const joinCode = (await T('GET', `/api/teacher/competitions/${id}`)).body.joinCode;
  const run = Date.now().toString(36);
  const students = [];
  for (let i = 0; i < 12; i++) {
    const S = agent(base);
    assert.equal((await S('POST', '/api/auth/demo', { role: 'student', name: `Kid ${run} ${i}` })).status, 200);
    assert.equal((await S('POST', '/api/student/join', { joinCode, teamId: `t${(i % 6) + 1}` })).status, 200);
    students.push(S);
  }
  await T('POST', `/api/teacher/competitions/${id}/start-episode`);
  assert.equal((await T('POST', `/api/teacher/competitions/${id}/levels/1/start`)).status, 200);

  // ---- 學生不停作答及提交（模擬學生端：網絡錯誤／502–504 以同一 Key 重試）
  const acked = []; // 伺服器已回覆的提交 { key, id, status, replayed }
  const pausedRejects = [];
  let stop = false;
  let seq = 0;
  const worker = async (S, w) => {
    while (!stop) {
      const taskId = Object.keys(L1)[seq % 3];
      const correct = (seq + w) % 3 !== 0;
      const key = `k-${run}-${w}-${seq++}`;
      const sheetEdit = await withRetry(() => S('POST', '/api/student/demo-sheet/L1_Fare/edit', { edits: inputsFor(taskId, correct) }));
      if (sheetEdit.status === 409) { await sleep(200); continue; }
      const r = await withRetry(() => S('POST', '/api/student/submit', { taskId, idempotencyKey: key }));
      if (r.status === 200 && r.body?.id) acked.push({ key, id: r.body.id, status: r.body.status, replayed: !!r.body.replayed });
      else if (r.status === 409) { pausedRejects.push(key); await sleep(200); }
      await sleep(50 + Math.random() * 100);
    }
  };
  const workers = students.map((S, w) => worker(S, w));

  // ---- 第一次強制終止（關卡計時中），離線 4 秒
  await sleep(2500);
  const v1 = (await T('GET', `/api/teacher/competitions/${id}`)).body;
  const t1 = Date.now();
  const r1 = v1.levels.find((l) => l.level === 1).remainingMs;
  srv.child.kill('SIGKILL');
  await srv.exited;
  const tk = Date.now();
  await sleep(4000);
  srv = startServer(port);
  await srv.ready;
  assert.match(srv.log(), /已自動暫停/);

  const v2 = (await T('GET', `/api/teacher/competitions/${id}`)).body;
  assert.equal(v2.paused, true, '重新啟動後關卡自動暫停');
  assert.match(v2.pauseReason, /伺服器曾中斷約 \d+ 秒/);
  const r2 = v2.levels.find((l) => l.level === 1).remainingMs;
  const expected = r1 - (tk - t1); // 終止一刻的剩餘時間
  assert.ok(r2 >= expected - 300, `離線期間不計時：剩餘 ${r2} ms，終止時約 ${expected} ms`);
  assert.ok(r2 <= expected + 5500, `補回的時間不多於「仍在運行」紀錄的間隔：剩餘 ${r2} ms`);
  await sleep(1500);
  const r3 = (await T('GET', `/api/teacher/competitions/${id}`)).body.levels.find((l) => l.level === 1).remainingMs;
  assert.equal(r3, r2, '暫停期間時間不減少');
  assert.equal((await T('POST', `/api/teacher/competitions/${id}/resume`)).status, 200);

  // ---- 第二次強制終止，立即重新啟動
  await sleep(2500);
  srv.child.kill('SIGKILL');
  await srv.exited;
  srv = startServer(port);
  await srv.ready;
  assert.equal((await T('POST', `/api/teacher/competitions/${id}/resume`)).status, 200);
  await sleep(1500);
  stop = true;
  await Promise.all(workers);

  // ---- 檢查（直接讀取資料庫）：已回覆的提交全部存在且只有一份
  const final = (await T('GET', `/api/teacher/competitions/${id}`)).body;
  const raw = await rawCompetition(id);
  const subs = raw.submissions;
  const byId = new Map();
  for (const s of subs) {
    assert.ok(!byId.has(s.id), `提交 ${s.id} 重複`);
    byId.set(s.id, s);
  }
  assert.ok(acked.length >= 30, `應有足夠提交（${acked.length}）`);
  for (const a of acked) {
    const s = byId.get(a.id);
    assert.ok(s, `已回覆的提交 ${a.id}（${a.key}）在資料庫中遺失`);
    assert.equal(s.status, a.status, `提交 ${a.id} 結果改變`);
    assert.equal(s.idempotencyKey, a.key);
  }
  const ackIds = new Map();
  for (const a of acked) {
    if (ackIds.has(a.key)) assert.equal(ackIds.get(a.key), a.id, `同一 Key ${a.key} 對應兩個不同提交`);
    ackIds.set(a.key, a.id);
  }
  const perKey = new Map();
  for (const s of subs.filter((x) => ['VERIFIED', 'REJECTED'].includes(x.status))) {
    const k = `${s.teamId}:${s.idempotencyKey}`;
    assert.ok(!perKey.has(k), `同一 Idempotency Key 計分兩次：${k}`);
    perKey.set(k, s.id);
  }
  assert.equal(new Set(subs.map((s) => s.seq)).size, subs.length, '提交序號沒有重複');
  assert.equal(raw.core.submissionChunks, raw.chunks.length, '提交紀錄分段儲存');
  assert.ok(!('submissions' in raw.core), '核心紀錄不再包含全部提交');
  assert.ok(final.audit.some((a) => a.action === 'AUTO_PAUSE_RECOVERY'), '審計紀錄記錄自動暫停');
  const replays = acked.filter((a) => a.replayed).length;

  // ---- 再強制終止一次：資料庫內容與記憶體完全一致（所有已回覆的改變都已寫入）
  srv.child.kill('SIGKILL');
  await srv.exited;
  srv = startServer(port);
  await srv.ready;
  const reloaded = (await T('GET', `/api/teacher/competitions/${id}`)).body;
  assert.deepEqual(reloaded.scores.map((s) => [s.teamId, s.total]), final.scores.map((s) => [s.teamId, s.total]), '分數在重新啟動後不變');
  assert.ok(final.scores.some((s) => s.total > 0));
  assert.equal(reloaded.paused, true, '每次在關卡進行中重新啟動都會自動暫停');
  assert.equal((await T('POST', `/api/teacher/competitions/${id}/resume`)).status, 200);

  // ---- 新舊實例同時運行（雲端重新部署）：新實例接手後，舊實例不可再寫入
  const port2 = port + 1000;
  const fresh = startServer(port2);
  await fresh.ready;
  const old = await students[0]('POST', '/api/student/submit', { taskId: 'L1-T3', idempotencyKey: `late-${run}` });
  assert.equal(old.status, 503, '舊實例不可再確認提交（學生端會重試到新實例）');
  assert.equal(old.body.code, 'NOT_SAVED');
  assert.equal((await fetch(`${base}/healthz`)).status, 503, '舊實例健康檢查失敗，雲端平台會停用它');
  const afterFence = await rawCompetition(id);
  assert.notEqual(afterFence.owner.instance, raw.owner.instance, '新實例已接手');
  assert.equal(afterFence.submissions.length, subs.length, '舊實例被拒後沒有寫入任何資料');
  assert.ok(!afterFence.submissions.some((s) => s.idempotencyKey === `late-${run}`));

  srv.child.kill('SIGTERM');
  fresh.child.kill('SIGTERM');
  await Promise.all([srv.exited, fresh.exited]);
  console.log(`  已回覆提交 ${acked.length}（其中重試後重播 ${replays}）、暫停期間被拒 ${pausedRejects.length}、資料庫提交紀錄 ${subs.length}`);
});
