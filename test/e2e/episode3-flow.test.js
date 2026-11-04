// 端到端（瀏覽器）測試：第三集《暴躁阿叔》——學生在內置工作表實際使用排序、自訂排序、篩選、多工作表、
// 圖表、樞紐分析表、分析藍本及目標搜尋，並提交得分；隊友只可觀看（隨機 Driver）。
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

test('第三集：排序、篩選、多工作表、圖表、樞紐分析表、分析藍本及目標搜尋（瀏覽器）', { skip: !chromium && '未安裝 Playwright', timeout: 300000 }, async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'taiyau-e2e4-'));
  process.env.ALLOW_DEMO_LOGIN = 'true';
  process.env.DEMO_TEACHER_PIN = '2468';
  fs.mkdirSync(SHOTS, { recursive: true });
  const { startServer } = await import('../../server/index.js');
  const store = await import('../../server/store.js');
  const C = await import('../../server/competition.js');
  const fx = await import('../../server/episode3/fixtures.js');
  const srv = startServer(0);
  await new Promise((r) => srv.on('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch();
  const errors = [];
  const newPage = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
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
    assert.equal(await T.locator('label:has-text("劇集") select').inputValue(), 'E3', '新比賽預設最新一集（第三集）');
    await T.click('button:has-text("建立比賽")');
    await T.waitForSelector('text=Dataset Preflight');
    const compId = await T.evaluate(() => document.getElementById('comp-pick').value);
    for (const p of ['/generate', '/approve', '/lobby']) assert.equal((await api(T, 'POST', `/teacher/competitions/${compId}${p}`, {})).status, 200);
    const tp = (p, b) => api(T, 'POST', `/teacher/competitions/${compId}${p}`, b || {});
    let v = (await api(T, 'GET', `/teacher/competitions/${compId}`)).body;

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
    const A = await join('Ada');
    const B = await join('Bob');
    v = (await api(T, 'GET', `/teacher/competitions/${compId}`)).body;
    for (const w of v.waiting) await tp('/assign', { userId: w.id, teamId: 't1' });
    await tp('/start-episode');
    await tp('/levels/1/start');
    const comp = () => store.db.state.competitions[compId];
    const ds = () => C.getDataset(comp(), comp().teams[0]);

    // 每一題由 Driver 操作：找出目前的 Driver 頁面
    const order = ['E3-L1-T1', 'E3-L1-T2', 'E3-L1-T3', 'E3-L2-T1', 'E3-L3-T1', 'E3-L4-T1', 'E3-L5-T1', 'E3-L5-T2', 'E3-L5-T3'];
    let step = 0;
    const driverPage = async () => {
      const taskId = order[step++];
      for (const P of [A, B]) await P.waitForFunction((t) => window.__tyState?.driver?.taskId === t && window.__tyEditor?.cur?.sheet && document.getElementById('driverbar')?.textContent.includes(t.split('-').at(-1)), taskId, { timeout: 15000 });
      const meA = await A.evaluate(() => window.__tyState.driver.driver.isMe);
      return meA ? [A, B] : [B, A];
    };
    const onSheet = (S, name) => S.waitForFunction((n) => window.__tyEditor?.cur?.sheet === n && window.__tyEditor.payload?.sheet === n, name, { timeout: 15000 })
      .catch(async (e) => { console.log('DBG onSheet', name, await S.evaluate(() => JSON.stringify({ cur: window.__tyEditor?.cur, payload: window.__tyEditor?.payload?.sheet, tabs: window.__tyEditor?.tabs?.map((t) => t.sheet), levels: window.__tyState?.levels?.map((l) => l.phase), status: window.__tyState?.status }))); throw e; });
    const saved = (S) => S.waitForFunction(() => window.__tyEditor.pending.size === 0 && !window.__tyEditor.sending, null, { timeout: 10000 });
    const typeCell = async (S, a, text) => { await S.click(`.se-table td[data-a="${a}"]`); await S.keyboard.type(text); await S.keyboard.press('Enter'); await saved(S); };
    const fillDown = async (S, from, to) => { await S.click(`.se-table td[data-a="${from}"]`); await S.click(`.se-table td[data-a="${to}"]`, { modifiers: ['Shift'] }); await S.click('button:has-text("向下填充")'); await saved(S); };
    const submitDone = async (S, short) => {
      await S.click('.task button:has-text("檢查／提交")');
      await S.waitForSelector(`.task-tab.done:has-text("${short}")`, { timeout: 20000 }).catch(async (e) => { console.log('DBG', (await S.textContent('.task')).slice(0, 700)); throw e; });
    };

    // ---------------- L1：排序（按鈕）、自訂多欄排序、篩選
    let [D, N] = await driverPage();
    await D.waitForSelector('.se-table td[data-a="H5"]');
    // 隊友：沒有工具按鈕權限（唯讀），按排序會被拒絕
    await N.click('.se-table td[data-a="H5"]');
    await N.click('button:has-text("Z→A")');
    await N.waitForSelector('.toast:has-text("Driver")');
    await D.click('.se-table td[data-a="H5"]');
    await D.click('button:has-text("Z→A")');
    await saved(D);
    const h2 = Number(await D.textContent('.se-table td[data-a="H2"]')); const h3 = Number(await D.textContent('.se-table td[data-a="H3"]'));
    assert.ok(h2 > h3, `排序後 H2 (${h2}) > H3 (${h3})`);
    await N.waitForFunction((x) => window.__tyEditor.wb.getValue(window.__tyEditor.cur.sheet, 'H2') === x, h2, { timeout: 10000 });
    await typeCell(D, 'B123', '=A2');
    await typeCell(D, 'B124', '=C4');
    await D.screenshot({ path: path.join(SHOTS, 'e3-l1-sorted.png') });
    await submitDone(D, 'T1');

    [D, N] = await driverPage();
    await D.click('.se-table td[data-a="E3"]');
    await D.click('button:has-text("自訂排序")');
    await D.click('.st-modal button:has-text("新增層級")');
    await D.click('.st-modal button:has-text("新增層級")');
    const sels = D.locator('.st-modal select[aria-label="排序欄位"]');
    const dirs = D.locator('.st-modal select[aria-label="次序"]');
    await sels.nth(0).selectOption('E'); await dirs.nth(0).selectOption('asc');
    await sels.nth(1).selectOption('F'); await dirs.nth(1).selectOption('desc');
    await sels.nth(2).selectOption('B'); await dirs.nth(2).selectOption('asc');
    await D.click('.st-modal button.primary:has-text("排序")');
    await saved(D);
    await typeCell(D, 'B125', '=XLOOKUP("DATA",E2:E121,A2:A121)');
    await submitDone(D, 'T2');

    [D, N] = await driverPage();
    const filterCol = async (S, header, value) => {
      await S.click(`.st-fbtn[aria-label="篩選 ${header}"]`);
      await S.locator('.st-modal label:has-text("（全選）") input').uncheck();
      await S.locator(`.st-modal .st-vals label:text-is(" ${value}") input`).check();
      await S.click('.st-modal button.primary:has-text("確定")');
      await saved(S);
    };
    await filterCol(D, 'Caller', 'UNCLE-WONG');
    await filterCol(D, 'Category', 'DATA');
    const expCount = fx.correctInputs('E3-L1-T3', ds()) && (() => { let n = 0; const d = ds().levels[1].data; for (let r = 2; r <= 121; r++) if (d[`G${r}`] === 'UNCLE-WONG' && d[`E${r}`] === 'DATA') n++; return n; })();
    const visible = await D.evaluate(() => [...document.querySelectorAll('.se-table tbody tr')].filter((tr) => tr.style.display !== 'none').length);
    assert.equal(visible, 127 - (120 - expCount), '篩選後只顯示符合兩個條件的資料列（標題列及表格下方的作答列仍然可見）');
    await typeCell(D, 'B126', '=SUBTOTAL(3,A2:A121)');
    await typeCell(D, 'B127', '=SUBTOTAL(9,H2:H121)');
    assert.equal(Number(await D.textContent('.se-table td[data-a="B126"]')), expCount);
    await D.screenshot({ path: path.join(SHOTS, 'e3-l1-filter.png') });
    await submitDone(D, 'T3');

    // ---------------- L2：多工作表
    await tp('/levels/1/end');
    await tp('/levels/2/start');
    [D, N] = await driverPage();
    await D.waitForSelector('.se-tab:has-text("時間表")');
    await D.click('.se-tab:has-text("時間表")');
    await D.waitForFunction(() => window.__tyEditor.cur.sheet === 'E3L2_Timetable');
    const sched2 = Number(await D.textContent('.se-table td[data-a="B2"]'));
    await D.click('.se-tab:has-text("L2 消失的行車紀錄")');
    await D.waitForFunction(() => window.__tyEditor.cur.sheet === 'E3L2_Check');
    await typeCell(D, 'B2', '=E3L2_Timetable!B2');
    assert.equal(Number(await D.textContent('.se-table td[data-a="B2"]')), sched2, '跨工作表參照即時計算');
    await fillDown(D, 'B2', 'B41');
    await submitDone(D, 'T1');

    // ---------------- L3：圖表
    await tp('/levels/2/end');
    await tp('/levels/3/start');
    [D, N] = await driverPage();
    await onSheet(D, 'E3L3_Traffic');
    await onSheet(N, 'E3L3_Traffic');
    await D.click('button:has-text("插入圖表")');
    await D.selectOption('.st-modal select[aria-label="圖表類型"]', 'line');
    await D.fill('.st-modal input[aria-label="類別範圍"]', 'A2:A19');
    await D.click('.st-modal button:has-text("新增數列")');
    await D.fill('.st-modal input[aria-label="數列名稱"]', 'Today');
    await D.fill('.st-modal input[aria-label="數列範圍"]', 'D2:D19');
    await D.fill('.st-modal input[aria-label="圖表標題"]', '今日入閘人次');
    await D.fill('.st-modal input[aria-label="X 軸標題"]', 'Hour');
    await D.fill('.st-modal input[aria-label="Y 軸標題"]', 'Entries');
    await D.click('.st-modal button.primary:has-text("插入")');
    await saved(D);
    await D.waitForSelector('.st-drawer .st-chart svg polyline');
    // 隊友亦即時看到圖表
    await N.waitForSelector('.st-drawer .st-chart svg polyline', { timeout: 10000 }).catch(async (e) => { await N.screenshot({ path: path.join(SHOTS, 'e3-dbg-n.png') }); console.log('DBG', await N.evaluate(() => JSON.stringify({ sheet: window.__tyEditor.cur, charts: window.__tyEditor.inputOf('!CHARTS'), drawer: !!document.querySelector('.st-drawer'), hidden: document.querySelector('.st-drawer')?.hidden }))); throw e; });
    await D.screenshot({ path: path.join(SHOTS, 'e3-l3-chart.png') });
    await submitDone(D, 'T1');

    // ---------------- L4：樞紐分析表
    await tp('/levels/3/end');
    await tp('/levels/4/start');
    [D, N] = await driverPage();
    await onSheet(D, 'E3L4_Records');
    await D.click('button:has-text("樞紐分析表")');
    await D.selectOption('.st-modal select[aria-label="列"]', 'Computer');
    await D.selectOption('.st-modal select[aria-label="值的欄位"]', 'RecordID');
    await D.selectOption('.st-modal select[aria-label="彙總方式"]', 'COUNT');
    await D.click('.st-modal button.primary:has-text("建立")');
    await saved(D);
    await D.waitForSelector('.st-drawer .st-pivot td');
    const j2 = fx.correctInputs('E3-L4-T1', ds()).J2;
    assert.ok(await D.isVisible(`.st-drawer .st-pivot th:text-is("${j2}")`));
    await typeCell(D, 'J2', j2);
    await D.screenshot({ path: path.join(SHOTS, 'e3-l4-pivot.png') });
    await submitDone(D, 'T1');

    // ---------------- L5：What-if（分析藍本＋目標搜尋）
    await tp('/levels/4/end');
    await tp('/levels/5/start');
    for (const [col, f, short] of [['E', '=IF(AND(E3L5_EditLog!C2="FSM-PC",E3L5_EditLog!B2>=$B$2,E3L5_EditLog!B2<$B$2+$B$3),1,0)', 'T1'], ['F', '=IF(AND(LEN(E3L5_EditLog!F2)>=5,E3L5_EditLog!F2=REPT(LEFT(E3L5_EditLog!F2,1),LEN(E3L5_EditLog!F2))),1,0)', 'T2']]) {
      [D, N] = await driverPage();
      await onSheet(D, 'E3L5_Model');
      await typeCell(D, `${col}2`, f);
      await fillDown(D, `${col}2`, `${col}61`);
      await submitDone(D, short);
    }
    [D, N] = await driverPage();
    await typeCell(D, 'I1', '=COUNTIFS(E2:E61,1,F2:F61,1)');
    await typeCell(D, 'I2', '=COUNTIF(F2:F61,1)');
    await D.click('button:has-text("分析藍本")');
    for (const [i, val] of [5, 15, 30].entries()) {
      if (i > 0) await D.click('.st-modal button:has-text("新增藍本")');
      await D.locator('.st-modal input[aria-label="藍本名稱"]').nth(i).fill(`LOCK${val}`);
      await D.locator('.st-modal input[aria-label="B3 的數值"]').nth(i).fill(String(val));
    }
    await D.click('.st-modal button.primary:has-text("儲存")');
    await saved(D);
    await D.waitForSelector('.st-drawer .st-scen td:text-is("LOCK30")');
    // 目標搜尋：I1 達到 I2
    await D.waitForFunction(() => typeof window.__tyEditor.wb.getValue('E3L5_Model', 'I2') === 'number' && window.__tyEditor.wb.getValue('E3L5_Model', 'I2') > 0);
    const i2 = await D.evaluate(() => window.__tyEditor.wb.getValue('E3L5_Model', 'I2'));
    await D.click('button:has-text("目標搜尋")');
    await D.fill('.st-modal input[aria-label="目標儲存格"]', 'I1');
    await D.fill('.st-modal input[aria-label="目標值"]', String(i2));
    await D.fill('.st-modal input[aria-label="搜尋上限"]', '120');
    await D.click('.st-modal button:has-text("搜尋")');
    await D.waitForSelector('.st-modal .notice:has-text("達到目標值")').catch(async (e) => { console.log('DBG goal', i2, await D.evaluate(() => JSON.stringify([...document.querySelectorAll('.st-modal input, .st-modal select')].map((x) => [x.getAttribute('aria-label'), x.value]))), await D.evaluate(() => JSON.stringify({ b3: window.__tyEditor.inputOf('B3'), i1: window.__tyEditor.wb.getValue('E3L5_Model', 'I1'), e: window.__tyEditor.inputOf('E2'), f: window.__tyEditor.inputOf('F2') })), await D.evaluate(async () => { const ed = window.__tyEditor; const w = ed.wb.clone(); const out = []; for (const x of [0, 30, 120]) { w.setInput('E3L5_Model', 'B3', x); out.push([x, w.getValue('E3L5_Model', 'I1'), w.getValue('E3L5_Model', 'I2'), w.getValue('E3L5_Model', 'E2')]); } return JSON.stringify({ out, sheets: [...ed.wb.sheets.keys()], cells: ed.wb.sheet('E3L5_Model').cells.size }); })); throw e; });
    await D.click('.st-modal button.primary:has-text("套用到儲存格")');
    await saved(D);
    const minLock = ds().levels[5].params.minLock;
    assert.equal(Number(await D.evaluate(() => window.__tyEditor.inputOf('B3'))), minLock, '目標搜尋找到最少鎖定分鐘');
    assert.equal(Number(await D.textContent('.se-table td[data-a="I1"]')), i2, 'B3 改變後 I1 自動重新計算');
    await typeCell(D, 'I3', String(minLock));
    await D.screenshot({ path: path.join(SHOTS, 'e3-l5-whatif.png') });
    await submitDone(D, 'T3');

    // 老師：G 頁即時工作表及教師備註；重新整理後設定仍在
    await T.reload();
    await T.click('button:has-text("G. 題目及工作表")');
    await T.waitForSelector('.teacher-only:has-text("預期操作及答案")');
    await T.waitForSelector('.teacher-sheet .st-drawer .st-scen');
    await T.screenshot({ path: path.join(SHOTS, 'e3-teacher-g.png'), fullPage: true });
    await D.reload();
    await D.waitForSelector('.st-drawer .st-scen td:text-is("LOCK15")');

    assert.deepEqual(errors, []);
    const v2 = (await api(T, 'GET', `/teacher/competitions/${compId}`)).body;
    const s = v2.scores.find((x) => x.teamId === 't1');
    assert.ok(s.levels[1].earnedPts === s.levels[1].maxPts, '第 1 關全對');
  } finally {
    await browser.close();
    srv.stop();
  }
});
