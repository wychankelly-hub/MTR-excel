// 驗收測試 V：課堂可靠性（2026-11-10 課堂問題）
// 1. 生成數據在背景執行緒進行：生成期間伺服器仍然即時回應（不會因健康檢查失敗而被雲端平台重新啟動）
// 2. 數據集儲存在資料庫：伺服器重新啟動後不需要在課堂中重新生成（第一個請求不會被阻塞）
// 3. 隨機 Driver 預設開啟（包括沒有這個設定的舊比賽）：隊友不能同時修改同一題、不能人人提交
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { cookieJar } from './cookie-jar.js';

const DB = process.env.TEST_DATABASE_URL;
const ROOT = path.resolve(import.meta.dirname, '..');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'taiyau-v-'));
const children = new Set();
test.after(() => { for (const ch of children) ch.kill('SIGKILL'); });

function startServer(port) {
  const env = { ...process.env, PORT: String(port), ALLOW_DEMO_LOGIN: 'true', DEMO_TEACHER_PIN: 'v-pin-2468', SESSION_SECRET: 'v-secret', SECURE_COOKIES: 'false', NODE_TEST_CONTEXT: '', DATA_DIR };
  if (DB) env.DATABASE_URL = DB; else delete env.DATABASE_URL;
  const child = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  child.on('exit', () => children.delete(child));
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const ready = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`伺服器未能啟動：${out}`)), 60000);
    child.stdout.on('data', () => { if (out.includes('伺服器：')) { clearTimeout(t); resolve(); } });
    child.on('exit', (c) => reject(new Error(`伺服器結束 ${c}：${out}`)));
  });
  return { child, ready, log: () => out };
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

test('生成數據時伺服器仍然回應；重新啟動後不用重新生成；隨機 Driver 預設開啟', { timeout: 240000 }, async () => {
  if (DB) {
    const pg = (await import('pg')).default;
    const c = new pg.Client({ connectionString: DB });
    await c.connect();
    await c.query('DROP TABLE IF EXISTS ty_kv, ty_assets, ty_cells');
    await c.end();
  }
  const port = 42000 + Math.floor(Math.random() * 400);
  const origin = `http://127.0.0.1:${port}`;
  base = `${origin}/api`;
  let s = startServer(port);
  await s.ready;
  const T = agent();
  await T('POST', '/auth/demo', { role: 'teacher', pin: 'v-pin-2468' });
  // 不指定 randomDriver：預設開啟
  const id = (await T('POST', '/teacher/competitions', { episode: 'E3', teamCount: 6, teamSelection: 'teacher' })).body.id;
  const tp = (p, b) => T('POST', `/teacher/competitions/${id}${p}`, b || {});

  // 生成期間每 50 ms 檢查健康狀態，記錄最長的回應時間
  let generating = true; let worst = 0; let checks = 0;
  const poll = (async () => {
    while (generating) {
      const t0 = Date.now();
      const r = await fetch(`${origin}/healthz`);
      worst = Math.max(worst, Date.now() - t0); checks++;
      assert.equal(r.status, 200);
      await new Promise((x) => setTimeout(x, 50));
    }
  })();
  const t0 = Date.now();
  const g = await tp('/generate');
  const genMs = Date.now() - t0;
  generating = false;
  await poll;
  assert.equal(g.status, 200, JSON.stringify(g.body));
  assert.equal(g.body.pass, true);
  assert.ok(checks >= 5, `生成期間檢查了 ${checks} 次`);
  assert.ok(worst < 400, `生成數據（${genMs} ms）期間健康檢查最慢 ${worst} ms（伺服器沒有被阻塞）`);
  // 重複按「生成數據」：第二個請求會被拒絕，而不是同時生成兩次
  const [g1, g2] = await Promise.all([tp('/generate'), tp('/generate')]);
  assert.deepEqual([g1.status, g2.status].sort(), [200, 409]);

  await tp('/approve'); await tp('/lobby');
  let v = (await T('GET', `/teacher/competitions/${id}`)).body;
  assert.equal(v.settings.randomDriver, true, '新比賽預設開啟隨機 Driver');
  const S = {};
  for (const k of ['a', 'b']) {
    S[k] = agent();
    await S[k]('POST', '/auth/demo', { role: 'student', name: `V-${k}` });
    await S[k]('POST', '/student/join', { joinCode: v.joinCode });
  }
  v = (await T('GET', `/teacher/competitions/${id}`)).body;
  for (const w of v.waiting) await tp('/assign', { userId: w.id, teamId: 't1' });
  await tp('/start-episode'); await tp('/levels/1/start');
  // 只有 Driver 可以修改及提交
  const states = await Promise.all(['a', 'b'].map(async (k) => (await S[k]('GET', '/student/state')).body));
  const dk = states[0].driver.driver.isMe ? 'a' : 'b';
  const nk = dk === 'a' ? 'b' : 'a';
  const bad = (await S[nk]('POST', '/sheet/E3L1_Complaints/ops', { ops: [{ a: 'B123', i: '=A2', base: 0 }] })).body;
  assert.equal(bad.rejected[0]?.code, 'NOT_DRIVER');
  assert.equal((await S[nk]('POST', '/student/submit', { taskId: 'E3-L1-T1', idempotencyKey: `v-${Date.now()}` })).status, 403);

  // 強制終止並重新啟動：數據集由資料庫讀取，第一個學生請求不會被重新生成阻塞
  s.child.kill('SIGKILL');
  await new Promise((r) => s.child.once('exit', r));
  s = startServer(port);
  await s.ready;
  // 短暫中斷：自動補回時間並繼續（不需要老師按「繼續」）；老師看到提示
  const tv = (await T('GET', `/teacher/competitions/${id}`)).body;
  assert.equal(tv.paused, false, '短暫中斷後自動繼續');
  assert.ok(tv.lastRecovery?.gapMs > 0);
  const t1 = Date.now();
  const st = await S[dk]('GET', '/sheet/E3L1_Complaints');
  const firstMs = Date.now() - t1;
  assert.equal(st.status, 200);
  assert.ok(firstMs < 1000, `重新啟動後第一個工作表請求 ${firstMs} ms`);
  if (!DB) {
    const state = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'state.json'), 'utf8'));
    assert.ok(state.datasets?.[id]?.list?.length === 6, '數據集已儲存');
  }
  s.child.kill('SIGKILL');
});

test('舊比賽沒有 randomDriver 設定時亦開啟隨機 Driver；老師明確關閉才關閉；Google Sheets 舊模式不適用', async () => {
  const { driverMode } = await import('../server/drivers.js');
  assert.equal(driverMode({ settings: {} , adapter: 'demo' }), true);
  assert.equal(driverMode({ settings: { randomDriver: false }, adapter: 'builtin' }), false);
  assert.equal(driverMode({ settings: { randomDriver: true }, adapter: 'google' }), false);
});

test('更新前建立的進行中比賽（沒有 randomDriver 設定）：重新啟動後立即有 Driver，非 Driver 不能修改', { skip: !!DB && '只在檔案模式測試（需要直接修改儲存的紀錄）', timeout: 120000 }, async () => {
  const port = 42500 + Math.floor(Math.random() * 400);
  base = `http://127.0.0.1:${port}/api`;
  let s = startServer(port);
  await s.ready;
  const T = agent();
  await T('POST', '/auth/demo', { role: 'teacher', pin: 'v-pin-2468' });
  const id = (await T('POST', '/teacher/competitions', { episode: 'E2', teamCount: 4, teamSelection: 'teacher' })).body.id;
  const tp = (p, b) => T('POST', `/teacher/competitions/${id}${p}`, b || {});
  await tp('/generate'); await tp('/approve'); await tp('/lobby');
  let v = (await T('GET', `/teacher/competitions/${id}`)).body;
  const S = {};
  for (const k of ['a', 'b']) {
    S[k] = agent();
    await S[k]('POST', '/auth/demo', { role: 'student', name: `Old-${k}` });
    await S[k]('POST', '/student/join', { joinCode: v.joinCode });
  }
  v = (await T('GET', `/teacher/competitions/${id}`)).body;
  for (const w of v.waiting) await tp('/assign', { userId: w.id, teamId: 't1' });
  await tp('/start-episode'); await tp('/levels/1/start');
  s.child.kill('SIGKILL');
  await new Promise((r) => s.child.once('exit', r));
  // 模擬更新前的紀錄：沒有 randomDriver 設定、沒有 Driver
  const file = path.join(DATA_DIR, 'state.json');
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete state.competitions[id].settings.randomDriver;
  delete state.competitions[id].drivers;
  fs.writeFileSync(file, JSON.stringify(state));
  s = startServer(port);
  await s.ready;
  const d = (await T('GET', `/teacher/competitions/${id}`)).body.drivers;
  assert.equal(d.enabled, true);
  assert.ok(d.teams.t1.driver, '重新啟動後已指派 Driver');
  const dk = ['a', 'b'].find((k) => d.teams.t1.driver.name.startsWith(`Old-${k}`));
  const nk = dk === 'a' ? 'b' : 'a';
  const bad = (await S[nk]('POST', '/sheet/E2L1_DoorLog/ops', { ops: [{ a: 'B2', i: '=1', base: 0 }] })).body;
  assert.equal(bad.rejected[0]?.code, 'NOT_DRIVER');
  const ok = (await S[dk]('POST', '/sheet/E2L1_DoorLog/ops', { ops: [{ a: 'B2', i: '=FIND("@",A2)', base: 0 }] })).body;
  assert.equal(ok.rejected.length, 0);
  s.child.kill('SIGKILL');
});
