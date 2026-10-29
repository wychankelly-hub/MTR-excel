// 端到端（瀏覽器）測試：多個瀏覽器同時使用。
// - 老師建立比賽 → Preflight → 批准 → 學生（兩隊共三人）加入 → 作答、提交、提示
// - 兩套聲音獨立：
//     劇情聲音（廣東話配音、背景音樂）只由「指定投影畫面」播放；第二個投影畫面及老師控制台不發聲
//     遊戲音效只在相關隊伍的學生裝置播放；新一關解鎖全班學生都聽到；重新整理不會重播
// 可設定 E2E_BASE_URL（例如連接雲端資料庫的正式模式伺服器）及 E2E_TEACHER_PIN。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { /* 沒有 Playwright 時略過 */ }

const SHOTS = process.env.E2E_SHOTS || path.join(os.tmpdir(), 'taiyau-e2e-shots');

test('多瀏覽器：課堂流程、劇情聲音（投影）與學生遊戲音效分開', { skip: !chromium && '未安裝 Playwright', timeout: 240000 }, async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  let srv = null;
  let base = process.env.E2E_BASE_URL;
  if (!base) {
    process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'taiyau-e2e-'));
    const { startServer } = await import('../../server/index.js');
    srv = startServer(0);
    await new Promise((r) => srv.on('listening', r));
    base = `http://127.0.0.1:${srv.address().port}`;
  }
  const pin = process.env.E2E_TEACHER_PIN || '2468';
  const browser = await chromium.launch({ args: ['--autoplay-policy=user-gesture-required'] });
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
  const sfxKinds = (S) => S.evaluate(() => window.__tySfx.log.map((x) => x.kind));
  try {
    // ---- 老師
    const T = await newPage('teacher');
    await T.goto(base);
    await T.fill('#demo-pin', pin);
    await T.click('#demo-teacher button');
    await T.waitForURL('**/teacher');
    await T.waitForSelector('#comp-pick option', { state: 'attached' });
    await T.selectOption('#comp-pick', ''); // 「＋ 新增比賽」（雲端資料庫可能已有舊比賽）
    await T.click('button:has-text("建立比賽")');
    await T.waitForSelector('text=Dataset Preflight');
    await T.click('button:has-text("生成數據")');
    await T.waitForSelector('span.pill.ok:has-text("全部通過")', { timeout: 30000 });
    await T.click('button:has-text("批准並鎖定")');
    await T.waitForSelector('button:has-text("開放大堂（Lobby）")');
    await T.click('button:has-text("開放大堂（Lobby）")');
    await T.click('button:has-text("B. 隊伍")');
    const joinCode = (await T.textContent('.big-code')).trim();
    assert.match(joinCode, /^[A-Z0-9]{6}$/);
    const projUrl = await T.getAttribute('a:has-text("開啟投影畫面")', 'href');

    // ---- 兩個投影畫面：第一個啟用聲音成為指定播放裝置；第二個只顯示字幕
    const P = await newPage('projector');
    await P.goto(projUrl);
    await P.waitForSelector(`.joinbig:has-text("${joinCode}")`);
    await P.click('#enable2');
    await P.waitForSelector('#audio-state:has-text("此投影畫面正在播放")');
    const P2 = await newPage('projector2');
    await P2.goto(projUrl);
    await P2.click('#enable2');
    await P2.waitForSelector('#audio-state:has-text("另一個投影畫面正在播放")');
    assert.ok(await P2.isVisible('#claim'));

    // ---- 學生：荃灣綫 2 人、觀塘綫 1 人
    const join = async (name, teamName) => {
      const S = await newPage(name);
      await S.goto(base);
      await S.fill('#demo-name', name);
      await S.click('#demo-student button');
      await S.waitForURL('**/student');
      await S.fill('.joincode', joinCode);
      // 老師分隊模式：學生確認班別後加入等候名單，由老師分隊
      await S.click('.joinbox button.primary.big:has-text("加入")');
      await S.waitForSelector('text=請等候老師把你分到隊伍');
      await T.click('button:has-text("B. 隊伍")');
      const row = T.locator('tr', { hasText: name }).filter({ has: T.locator('select') }).first();
      await row.locator('select').selectOption({ label: new RegExp(`^${teamName}`) }).catch(async () => {
        const opt = await row.locator('option', { hasText: teamName }).first().getAttribute('value');
        await row.locator('select').selectOption(opt);
      });
      await S.waitForSelector('text=等候老師開始');
      await S.click('body'); // 學生裝置一次性啟用音效
      return S;
    };
    const run = Date.now().toString(36).slice(-4);
    const A1 = await join(`Amy ${run}`, '荃灣綫');
    const A2 = await join(`Cathy ${run}`, '荃灣綫');
    const B1 = await join(`Ben ${run}`, '觀塘綫');
    for (const S of [A1, A2, B1]) assert.equal(await S.evaluate(() => window.__tySfx.ready), true);

    // ---- 開始遊戲：劇情只在指定投影畫面播放
    await T.click('button:has-text("D. 即時控制")');
    await T.waitForSelector('span.pill.ok:has-text("投影畫面聲音已啟用")');
    await T.click('button:has-text("開始遊戲")');
    await T.waitForSelector('text=遊戲進行中');
    await P.waitForFunction(() => /E1_INTRO_0\d\.mp3/.test(window.__ty.device.player.audio.currentSrc), null, { timeout: 10000 });
    await P.waitForFunction(() => /各位實習生|小意思|計啱最重要/.test(document.getElementById('bubble').textContent));
    // 老師控制台同步顯示開場字幕（任何一句）
    await T.waitForFunction(() => /各位實習生|小意思|計啱最重要/.test(document.getElementById('dock-bubble').textContent), null, { timeout: 15000 });
    const silent = async (Pg) => Pg.evaluate(() => ({ out: window.__ty.device.isOutput, src: window.__ty.device.player.audio.currentSrc, bgm: !!window.__ty.device.player.bgm }));
    assert.deepEqual(await silent(T), { out: false, src: '', bgm: false }, '老師控制台不播放劇情聲音');
    assert.deepEqual(await silent(P2), { out: false, src: '', bgm: false }, '第二個投影畫面不播放劇情聲音');
    assert.equal(await P.evaluate(() => !!window.__ty.device.player.bgm), true, '指定投影畫面播放背景音樂');
    for (const S of [A1, A2, B1]) assert.equal(await S.evaluate(() => document.querySelectorAll('audio').length + (window.__ty ? 1 : 0)), 0, '學生裝置沒有劇情播放器');
    await P.screenshot({ path: path.join(SHOTS, 'projector-intro.png') });

    await T.locator('.st-card').first().locator('button:has-text("開始")').click();
    for (const S of [A1, A2, B1]) await S.waitForFunction(() => window.__tySfx.log.some((x) => x.kind === 'unlock'), null, { timeout: 10000 });

    // ---- 作答
    // 內置工作表：直接在儲存格輸入、Shift 點選範圍、向下填充；修改自動儲存
    const saved = (S) => S.waitForFunction(() => window.__tyEditor && window.__tyEditor.pending.size === 0 && !window.__tyEditor.sending, null, { timeout: 10000 });
    const typeCell = async (S, a, text) => {
      await S.click(`.se-table td[data-a="${a}"]`);
      await S.keyboard.type(text);
      await S.keyboard.press('Enter');
      await saved(S);
    };
    const fillDown = async (S, from, to) => {
      await S.click(`.se-table td[data-a="${from}"]`);
      await S.click(`.se-table td[data-a="${to}"]`, { modifiers: ['Shift'] });
      await S.click('button:has-text("向下填充")');
      await saved(S);
    };
    await A1.waitForSelector('.se-table td[data-a="D2"]');
    await typeCell(A1, 'D2', '=B2*C2*$H$1');
    await fillDown(A1, 'D2', 'D21');
    // 隊友即時看到修改（同一隊）
    await A2.waitForFunction(() => window.__tyEditor?.inputOf('D21') === '=B21*C21*$H$1', null, { timeout: 10000 });
    assert.equal(await B1.evaluate(() => window.__tyEditor?.inputOf('D21')), '=B21*C21*H20', '另一隊的工作表不受影響');
    await A1.click('button.task-tab:has-text("T1")');
    await A1.locator('.task button:has-text("檢查／提交")').click();
    await A1.locator('button.task-tab.done:has-text("T1")').waitFor({ timeout: 15000 });
    await A1.waitForSelector('.react.good');
    // 答對音效：只在荃灣綫兩部裝置
    for (const S of [A1, A2]) await S.waitForFunction(() => window.__tySfx.log.some((x) => x.kind === 'correct'), null, { timeout: 10000 });
    await B1.waitForTimeout(800);
    assert.ok(!(await sfxKinds(B1)).includes('correct'), '其他隊伍不會聽到');
    assert.ok(await P.evaluate(() => (window.__tyTicks || 0) >= 1), '投影顯示隊伍完成一題（只有文字）');

    // 觀塘綫：錯誤答案 + 提示
    await typeCell(B1, 'D2', '=B2*C2*H$1');
    await fillDown(B1, 'D2', 'D21');
    await B1.locator('.task button:has-text("檢查／提交")').click();
    await B1.locator('.task .feedback li').first().waitFor();
    assert.match(await B1.locator('.task .feedback').textContent(), /絕對參照/);
    await B1.waitForFunction(() => window.__tySfx.log.some((x) => x.kind === 'wrong'));
    await B1.click('button:has-text("第 1 級提示")');
    await B1.waitForFunction(() => window.__tySfx.log.some((x) => x.kind === 'hint'));
    await A1.waitForTimeout(600);
    assert.ok(!(await sfxKinds(A1)).some((k) => k === 'wrong' || k === 'hint'), '荃灣綫聽不到觀塘綫的錯誤及提示');
    await B1.screenshot({ path: path.join(SHOTS, 'student-feedback.png') });

    // 受保護儲存格不可修改
    await B1.click('.se-table td[data-a="B2"]');
    await B1.keyboard.type('9');
    await B1.waitForSelector('text=受保護的原始資料');

    // 荃灣綫完成全關 → 完成任務音效
    await typeCell(A1, 'F2', '=E2-D2');
    await fillDown(A1, 'F2', 'F21');
    await typeCell(A1, 'H3', '=SUM(F2:F21)');
    for (const id of ['T2', 'T3']) {
      await A1.click(`button.task-tab:has-text("${id}")`);
      await A1.locator('.task button:has-text("檢查／提交")').click();
      await A1.locator(`button.task-tab.done:has-text("${id}")`).waitFor({ timeout: 15000 });
    }
    for (const S of [A1, A2]) await S.waitForFunction(() => window.__tySfx.log.some((x) => x.kind === 'mission'), null, { timeout: 10000 });
    await A1.waitForSelector('text=車費系統');
    await A1.screenshot({ path: path.join(SHOTS, 'student-play.png') });

    // 重新整理不會重播已播放的音效
    await A2.reload();
    await A2.waitForSelector('.se-table');
    // 重新整理後，隊伍已確認的作答仍在
    await A2.waitForFunction(() => window.__tyEditor?.inputOf('D21') === '=B21*C21*$H$1' && window.__tyEditor?.inputOf('H3') === '=SUM(F2:F21)', null, { timeout: 10000 });
    await A2.click('body');
    await A2.waitForTimeout(1500);
    assert.deepEqual(await sfxKinds(A2), [], '重新整理後沒有重播');

    // 學生靜音（只影響本機）
    await A1.click('#sound');
    assert.equal(await A1.evaluate(() => window.__tySfx.muted), true);
    assert.equal(await A2.evaluate(() => window.__tySfx.muted), false);

    // 投影排行榜：荃灣綫第一，沒有電郵、沒有答案
    await P.waitForFunction(() => document.querySelector('.race-row .race-name')?.textContent.includes('荃灣綫'), null, { timeout: 10000 });
    const pjText = await P.textContent('body');
    assert.ok(!pjText.includes('@'));
    assert.ok(!pjText.includes('LUNCH'));
    await P.screenshot({ path: path.join(SHOTS, 'projector-level.png') });

    // 第二個投影畫面接手播放
    await P2.click('#claim');
    await P2.waitForSelector('#audio-state:has-text("此投影畫面正在播放")');
    await P.waitForSelector('#audio-state:has-text("另一個投影畫面正在播放")');

    // ---- 老師診斷 / 控制室
    await T.click('button:has-text("E. 即時診斷")');
    await T.waitForSelector('text=ABS_REF_PARTIAL');
    await T.click('button:has-text("D. 即時控制")');
    await T.screenshot({ path: path.join(SHOTS, 'teacher-control-room.png'), fullPage: true });
    await T.click('button:has-text("角色圖片")');
    await T.waitForSelector('text=圖片規格');

    assert.deepEqual(errors, []);
  } catch (e) {
    console.log('瀏覽器錯誤：', errors);
    throw e;
  } finally {
    await browser.close();
    if (srv) await srv.stop();
  }
});
