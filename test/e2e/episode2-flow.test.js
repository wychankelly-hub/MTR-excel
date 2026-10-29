// 端到端（瀏覽器）測試：第二集《疑犯火箭仔》在內置工作表上作答。
// 老師以介面建立第二集比賽（預設最新一集）→ 學生加入 → 在工作表輸入 FIND／MID 公式並向下填充 → 提交得分；
// 標題、題目分頁及投影畫面都顯示第二集；老師「G. 題目及工作表」可以預覽題目及即時工作表。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { /* 沒有 Playwright 時略過 */ }

test('第二集：內置工作表作答（FIND／MID）、提交及老師預覽', { skip: !chromium && '未安裝 Playwright', timeout: 180000 }, async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'taiyau-e2e2-'));
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
    // 預設劇集是第二集
    assert.equal(await T.locator('label:has-text("劇集") select').inputValue(), 'E2');
    await T.click('button:has-text("建立比賽")');
    await T.waitForSelector('text=Dataset Preflight');
    await T.click('button:has-text("生成數據")');
    await T.waitForSelector('span.pill.ok:has-text("全部通過")', { timeout: 30000 });
    assert.ok(await T.isVisible('th:has-text("L4 最接近")'), '預檢表顯示第二集的數據摘要');
    const compId = await T.evaluate(() => document.getElementById('comp-pick').value);
    assert.equal((await api(T, 'POST', `/teacher/competitions/${compId}/approve`)).status, 200);
    assert.equal((await api(T, 'POST', `/teacher/competitions/${compId}/lobby`)).status, 200);
    const view = (await api(T, 'GET', `/teacher/competitions/${compId}`)).body;
    assert.equal(view.episode, 'E2');

    // 學生加入並由老師分隊
    const S = await newPage('student');
    await S.goto(base);
    await S.fill('#demo-name', 'Rocket Fan');
    await S.click('#demo-student button');
    await S.waitForURL('**/student');
    await S.fill('.joincode', view.joinCode);
    await S.click('.joinbox button.primary.big:has-text("加入")');
    await S.waitForSelector('text=請等候老師把你分到隊伍');
    const waiting = (await api(T, 'GET', `/teacher/competitions/${compId}`)).body.waiting;
    assert.equal((await api(T, 'POST', `/teacher/competitions/${compId}/assign`, { userId: waiting[0].id, teamId: 't1' })).status, 200);
    await S.waitForSelector('text=等候老師開始');
    assert.match(await S.textContent('#subtitle'), /疑犯火箭仔/);

    const P = await newPage('projector');
    await P.goto(`${base}/projector?comp=${compId}&key=${view.projectorKey}`);
    await P.waitForFunction(() => /疑犯火箭仔/.test(document.getElementById('subtitle').textContent));

    assert.equal((await api(T, 'POST', `/teacher/competitions/${compId}/start-episode`)).status, 200);
    assert.equal((await api(T, 'POST', `/teacher/competitions/${compId}/levels/1/start`)).status, 200);

    // 作答：B2 =FIND("@",A2) → 向下填充；即時計算顯示位置
    const saved = () => S.waitForFunction(() => window.__tyEditor && window.__tyEditor.pending.size === 0 && !window.__tyEditor.sending, null, { timeout: 10000 });
    await S.waitForSelector('.se-table td[data-a="B2"]');
    const tabs = await S.locator('.task-tab').allTextContents();
    assert.deepEqual(tabs.map((t) => t.replace(/[^T0-9]/g, '')), ['T1', 'T2', 'T3', 'T4']);
    await S.click('.se-table td[data-a="B2"]');
    await S.keyboard.type('=FIND("@",A2)');
    await S.keyboard.press('Enter');
    await saved();
    const a2 = await S.textContent('.se-table td[data-a="A2"]');
    assert.equal((await S.textContent('.se-table td[data-a="B2"]')).trim(), String(a2.indexOf('@') + 1));
    await S.click('.se-table td[data-a="B2"]');
    await S.click('.se-table td[data-a="B21"]', { modifiers: ['Shift'] });
    await S.click('button:has-text("向下填充")');
    await saved();
    assert.equal(await S.evaluate(() => window.__tyEditor.inputOf('B21')), '=FIND("@",A21)');
    await S.click('button:has-text("檢查／提交")');
    // 全對後 T1 分頁顯示 ✓，並自動前往下一題
    await S.waitForSelector('.task-tab.done:has-text("T1")', { timeout: 15000 });
    await S.waitForSelector('.task .id:has-text("E2-L1-T2")');

    // 老師預覽題目（含老師專用參考公式）及即時工作表
    await T.click('button:has-text("G. 題目及工作表")');
    await T.waitForSelector('.teacher-only');
    assert.match(await T.textContent('.teacher-only'), /FIND\("@"/);
    await T.waitForFunction(() => window.__tyTeacherEditor?.inputOf('B21') === '=FIND("@",A21)', null, { timeout: 15000 });

    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    srv.stop();
  }
});
