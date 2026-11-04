// 端到端（瀏覽器）測試：隨機 Driver＋隊伍對話。
// 老師以介面建立比賽（隨機 Driver 預設開啟）→ 兩名學生同隊 → Driver 欄顯示角色 →
// 非 Driver 的工作表唯讀、提交按鈕停用 → 隊友在對話提出公式 → Driver 按「填入」並提交 →
// 下一題換另一名 Driver；老師「H. Driver 及對話」看到 Driver、對話，並可重新指派。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SHOTS = process.env.E2E_SHOTS || path.join(os.tmpdir(), 'taiyau-e2e-shots');
let chromium;
try { ({ chromium } = require('playwright')); } catch { /* 沒有 Playwright 時略過 */ }

test('隨機 Driver 及隊伍對話：角色顯示、唯讀、對話填入公式、老師控制', { skip: !chromium && '未安裝 Playwright', timeout: 180000 }, async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'taiyau-e2e3-'));
  process.env.ALLOW_DEMO_LOGIN = 'true';
  process.env.DEMO_TEACHER_PIN = '2468';
  const { startServer } = await import('../../server/index.js');
  const srv = startServer(0);
  await new Promise((r) => srv.on('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch();
  const errors = [];
  const newPage = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
    const p = await ctx.newPage();
    p.setDefaultTimeout(15000);
    p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|fonts\.googleapis/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
    p.on('dialog', (d) => d.accept());
    return p;
  };
  const api = (pg, method, url, body) => pg.evaluate(async ([m, u, b]) => {
    const r = await fetch(`/api${u}`, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, [method, url, body]);
  try {
    const T = await newPage('teacher');
    await T.goto(base);
    await T.fill('#demo-pin', '2468');
    await T.click('#demo-teacher button');
    await T.waitForURL('**/teacher');
    await T.waitForSelector('#comp-pick option', { state: 'attached' });
    const rd = T.locator('label:has-text("隨機 Driver") input[type=checkbox]').first();
    assert.equal(await rd.isChecked(), true, '新比賽預設開啟隨機 Driver');
    await T.click('button:has-text("建立比賽")');
    await T.waitForSelector('text=Dataset Preflight');
    const compId = await T.evaluate(() => document.getElementById('comp-pick').value);
    for (const p of ['/generate', '/approve', '/lobby']) assert.equal((await api(T, 'POST', `/teacher/competitions/${compId}${p}`, {})).status, 200);
    let v = (await api(T, 'GET', `/teacher/competitions/${compId}`)).body;
    assert.equal(v.settings.randomDriver, true);

    const join = async (name) => {
      const S = await newPage(name);
      await S.goto(base);
      await S.fill('#demo-name', name);
      await S.click('#demo-student button');
      await S.waitForURL('**/student');
      await S.fill('.joincode', v.joinCode);
      await S.click('.joinbox button.primary.big:has-text("加入")');
      await S.waitForSelector('text=請等候老師把你分到隊伍');
      return S;
    };
    const A = await join('Amy');
    const B = await join('Ben');
    v = (await api(T, 'GET', `/teacher/competitions/${compId}`)).body;
    for (const w of v.waiting) assert.equal((await api(T, 'POST', `/teacher/competitions/${compId}/assign`, { userId: w.id, teamId: 't1' })).status, 200);
    await api(T, 'POST', `/teacher/competitions/${compId}/start-episode`);
    await api(T, 'POST', `/teacher/competitions/${compId}/levels/1/start`);

    // Driver 欄：一人是 Driver，另一人唯讀
    for (const S of [A, B]) await S.waitForSelector('#driverbar:not([hidden])');
    await A.waitForFunction(() => /Driver/.test(document.getElementById('driverbar').textContent));
    const aIsDriver = /你是 .* 的 Driver/.test(await A.textContent('#driverbar'));
    const D = aIsDriver ? A : B;
    const N = aIsDriver ? B : A;
    assert.match(await N.textContent('#driverbar'), /Driver：(Amy|Ben)/);
    assert.match(await D.textContent('#driverbar'), /你是 T1 的 Driver/);
    // 非 Driver：工作表唯讀、提交按鈕停用
    await N.waitForSelector('.se-table td[data-a="B2"]');
    await N.click('.se-table td[data-a="B2"]');
    await N.keyboard.type('=1');
    await N.keyboard.press('Enter');
    await N.waitForSelector('.toast:has-text("只有本題的 Driver")');
    assert.equal(await N.evaluate(() => window.__tyEditor.inputOf('B2')), null, '非 Driver 不能修改');
    assert.equal(await N.locator('button:has-text("檢查／提交")').isDisabled(), true);
    assert.equal(await D.locator('button:has-text("檢查／提交")').isDisabled(), false);

    // 隊友在對話提出公式 → Driver 即時看到，按「填入」
    await N.fill('.chat-input', '試試 =FIND("@",A2) 吧');
    await N.click('.chatdock button:has-text("發送")');
    await D.waitForSelector('.chat-msg .chat-formula code:has-text("=FIND(\\"@\\",A2)")');
    assert.equal(await N.locator('.chat-msg .chip:has-text("填入")').count(), 0, '非 Driver 沒有「填入」');
    await D.click('.se-table td[data-a="B2"]');
    await D.click('.chat-msg .chip:has-text("填入")');
    await D.keyboard.press('Enter');
    await D.waitForFunction(() => window.__tyEditor.pending.size === 0 && !window.__tyEditor.sending);
    assert.equal(await D.evaluate(() => window.__tyEditor.inputOf('B2')), '=FIND("@",A2)');
    await N.waitForFunction(() => window.__tyEditor?.inputOf('B2') === '=FIND("@",A2)', null, { timeout: 10000 });
    fs.mkdirSync(SHOTS, { recursive: true });
    await D.screenshot({ path: path.join(SHOTS, 'driver-view.png') });
    await N.screenshot({ path: path.join(SHOTS, 'teammate-view.png') });
    // Driver 填充並提交 → 下一題換另一人
    await D.click('.se-table td[data-a="B2"]');
    await D.click('.se-table td[data-a="B21"]', { modifiers: ['Shift'] });
    await D.click('button:has-text("向下填充")');
    await D.waitForFunction(() => window.__tyEditor.pending.size === 0 && !window.__tyEditor.sending);
    await D.click('button:has-text("檢查／提交")');
    await N.waitForFunction(() => /你是 T2 的 Driver/.test(document.getElementById('driverbar').textContent), null, { timeout: 15000 });
    await D.waitForFunction(() => /Driver：.*正在作答 T2/.test(document.getElementById('driverbar').textContent));
    // 重新整理：Driver 及對話保留
    await D.reload();
    await D.waitForSelector('#driverbar:not([hidden])');
    assert.match(await D.textContent('#driverbar'), /正在作答 T2/);
    // 對話按題目分類：「本題」（T2）未有訊息；「全部」可看到 T1 的建議
    await D.waitForSelector('.chat-empty');
    await D.selectOption('.chat-filter', 'all');
    await D.waitForSelector('.chat-msg:has-text("試試") .chat-tag:has-text("T1")');

    // 老師：H 頁顯示 Driver 及對話，可重新抽選
    await T.click('button:has-text("H. Driver 及對話")');
    await T.waitForSelector('td.mono:has-text("L1-T2")');
    await T.waitForSelector('.tchat-msg:has-text("試試")');
    await T.locator('tr', { hasText: 'L1-T2' }).locator('button:has-text("重新抽選")').click();
    await D.waitForFunction(() => /你是 T2 的 Driver/.test(document.getElementById('driverbar').textContent), null, { timeout: 15000 });
    await T.screenshot({ path: path.join(SHOTS, 'teacher-drivers.png'), fullPage: true });
    // 老師刪除訊息
    await T.locator('.tchat-msg', { hasText: '試試' }).locator('button:has-text("刪除")').click();
    await N.selectOption('.chat-filter', 'all');
    await N.waitForSelector('.chat-msg.deleted:has-text("老師已刪除")');

    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    srv.stop();
  }
});
