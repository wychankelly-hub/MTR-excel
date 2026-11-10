// 回歸測試 W（2026-11-10 生產環境事故）：保持喚醒計時器。
// 事故：lastActivity 宣告在 createApp() 之內，計時器在 startServer() 之內 → 每 10 分鐘 ReferenceError → 伺服器結束。
// 1. 以假計時器推進時間，執行真正的計時器函數（閒置、上課中、長時間思考、下課、自我請求失敗）。
// 2. 以 Render 相同的設定（RENDER_EXTERNAL_URL）啟動真正的伺服器程序，經過多次計時器週期後仍然運行。
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { store } from './helpers.js';
import { cookieJar } from './cookie-jar.js';

const ka = await import('../server/keep-awake.js');
const MIN = 60 * 1000;

test('保持喚醒計時器：只在上課中自我喚醒；計時器函數不會拋出錯誤', () => {
  mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_000_000 });
  const saved = store.db.state.competitions;
  const savedReady = store.db.ready;
  const pings = [];
  let clients = 0;
  try {
    store.db.ready = true;
    store.db.state.competitions = {};
    ka.markActivity(Date.now());
    const h = ka.startKeepAwake({ url: 'https://taiyau.example', fetchFn: async (u) => { pings.push(u); return { ok: true }; }, connectedClients: () => clients, log: { error() {}, warn() {} } });
    const advance = (ms) => mock.timers.tick(ms);

    // 沒有進行中的比賽：計時器照常執行，但不自我喚醒（網站可以休眠）
    advance(3 * ka.KEEP_AWAKE.intervalMs);
    assert.equal(h.stats.ticks, 3);
    assert.equal(h.stats.pings, 0);

    // 有比賽在進行中而且最近有學生使用：每個週期都自我喚醒（這正是事故中出錯的情況）
    store.db.state.competitions = { c1: { status: 'RUNNING_LEVEL_2' } };
    ka.markActivity(Date.now());
    advance(ka.KEEP_AWAKE.intervalMs);
    assert.equal(h.stats.pings, 1);
    assert.deepEqual(pings, ['https://taiyau.example/healthz']);
    advance(2 * ka.KEEP_AWAKE.intervalMs); // 20 分鐘沒有請求，仍在 45 分鐘內
    assert.equal(h.stats.pings, 3);

    // 學生長時間思考（沒有請求），但頁面仍然連線：繼續保持喚醒
    advance(30 * MIN);
    clients = 25;
    const before = h.stats.pings;
    advance(ka.KEEP_AWAKE.intervalMs);
    assert.equal(h.stats.pings, before + 1, '有連線的學生：保持喚醒');

    // 沒有連線、45 分鐘沒有使用：停止（下課後可以休眠）
    clients = 0;
    const b2 = h.stats.pings;
    advance(ka.KEEP_AWAKE.intervalMs);
    assert.equal(h.stats.pings, b2, '沒有連線及使用：不自我喚醒');

    // 忘記關閉的分頁：3 小時後亦停止
    clients = 1;
    advance(3 * 60 * MIN);
    const b3 = h.stats.pings;
    advance(ka.KEEP_AWAKE.intervalMs);
    assert.equal(h.stats.pings, b3, '超過 3 小時沒有請求：不自我喚醒');

    // 比賽完結（結果）：不自我喚醒
    ka.markActivity(Date.now());
    store.db.state.competitions = { c1: { status: 'RESULTS' } };
    const b4 = h.stats.pings;
    advance(ka.KEEP_AWAKE.intervalMs);
    assert.equal(h.stats.pings, b4);

    assert.equal(h.stats.errors, 0, '計時器函數沒有出錯');
    h.stop();
  } finally {
    store.db.state.competitions = saved;
    store.db.ready = savedReady;
    mock.timers.reset();
  }
});

test('保持喚醒：自我請求失敗（網絡）只記錄，不會令伺服器結束', async () => {
  const saved = store.db.state.competitions;
  store.db.ready = true;
  store.db.state.competitions = { c1: { status: 'LOBBY' } };
  ka.markActivity(Date.now());
  const warns = [];
  const h = ka.startKeepAwake({ url: 'https://x.example', fetchFn: () => Promise.reject(new Error('ECONNRESET')), log: { error() {}, warn: (m) => warns.push(m) } });
  assert.equal(h.tick(), true);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(h.stats.pingFailures, 1);
  assert.match(warns[0], /ECONNRESET/);
  h.stop();
  store.db.state.competitions = saved;
});

// ---------------------------------------------------------------- 真正的伺服器程序（與 Render 相同的設定）
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'taiyau-w-'));
const children = new Set();
test.after(() => { for (const ch of children) ch.kill('SIGKILL'); });

test('以 RENDER_EXTERNAL_URL 啟動伺服器：經過多個保持喚醒週期仍然運行；只在比賽進行中自我喚醒', { timeout: 120000 }, async () => {
  const port = 43000 + Math.floor(Math.random() * 400);
  const origin = `http://127.0.0.1:${port}`;
  const env = { ...process.env, PORT: String(port), RENDER_EXTERNAL_URL: origin, KEEP_AWAKE_INTERVAL_MS: '150', KEEP_AWAKE_ACTIVE_WINDOW_MS: '3000', KEEP_AWAKE_CONNECTED_WINDOW_MS: '3000', ALLOW_DEMO_LOGIN: 'true', DEMO_TEACHER_PIN: 'w-pin-2468', SESSION_SECRET: 'w-secret', SECURE_COOKIES: 'false', NODE_TEST_CONTEXT: '', DATA_DIR };
  delete env.DATABASE_URL;
  const child = spawn(process.execPath, ['server/index.js'], { cwd: path.resolve(import.meta.dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  let exited = null;
  child.on('exit', (c) => { exited = c; });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(out)), 30000);
    child.stdout.on('data', () => { if (out.includes('伺服器：')) { clearTimeout(t); resolve(); } });
  });
  const health = async () => (await fetch(`${origin}/healthz`)).json();
  const stats = async () => (await health()).keepAwake;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // 閒置（沒有比賽）：計時器多次執行，不自我喚醒，程序沒有結束
  await wait(1200);
  let s = await stats();
  assert.equal(exited, null, `伺服器結束了：${out}`);
  assert.equal(s.enabled, true);
  assert.ok(s.ticks >= 5, `計時器執行了 ${s.ticks} 次`);
  assert.equal(s.pings, 0);
  assert.equal(s.errors, 0);

  // 開放大堂（上課中）：每個週期都自我喚醒
  const jar = cookieJar();
  const call = async (m, u, b) => { const r = await fetch(`${origin}/api${u}`, { method: m, headers: { 'content-type': 'application/json', cookie: jar.header() }, body: b ? JSON.stringify(b) : undefined }); jar.update(r); return r.json(); };
  await call('POST', '/auth/demo', { role: 'teacher', pin: 'w-pin-2468' });
  const { id } = await call('POST', '/teacher/competitions', { teamCount: 4 });
  await call('POST', `/teacher/competitions/${id}/generate`, {});
  await call('POST', `/teacher/competitions/${id}/approve`, {});
  await call('POST', `/teacher/competitions/${id}/lobby`, {});
  const h0 = await health();
  const p0 = h0.keepAwake.pings;
  await wait(1500); // 約 10 個週期
  s = await stats();
  assert.equal(exited, null, `伺服器結束了：${out}`);
  assert.ok(s.pings - p0 >= 5, `上課中自我喚醒 ${s.pings - p0} 次`);
  assert.equal(s.errors, 0);
  assert.equal(s.pingFailures, 0, '自我請求成功（健康檢查 200）');
  // 自我喚醒只請求 /healthz（不讀寫資料庫）：多次自我請求後，資料庫寫入次數不變
  assert.equal((await health()).storage.usage.writes, h0.storage.usage.writes, '自我喚醒不會寫入資料庫');

  // 下課：沒有真實請求超過活動時限（測試設為 3 秒）、沒有即時連線 → 停止自我喚醒，網站可以休眠。
  // 期間的 /healthz 請求（包括自我喚醒本身）不算作活動，所以不會無限期保持喚醒
  await wait(2500);
  const p1 = (await stats()).pings;
  await wait(1200);
  s = await stats();
  assert.equal(s.pings, p1, `下課後仍自我喚醒 ${s.pings - p1} 次`);
  assert.ok(s.ticks > 20, '計時器繼續執行（只是不再自我喚醒）');
  assert.equal(exited, null, `伺服器結束了：${out}`);
  assert.equal(s.errors, 0);
  assert.ok(!/ReferenceError|計時器「/.test(out), out);
  child.kill('SIGKILL');
});
