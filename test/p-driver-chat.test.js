// 驗收測試 P：隨機 Driver（每題輪流）及隊伍對話（經 HTTP，與學生瀏覽器相同的路徑）。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cookieJar } from './cookie-jar.js';
import { store } from './helpers.js';

// 測試：重新整理頁面的寬限縮短為 0.3 秒（預設 20 秒），以便測試「未連線的學生不會被選中」
process.env.DRIVER_REFRESH_GRACE_MS = '300';

const { startServer } = await import('../server/index.js');
const { correctInputs } = await import('../server/episode2/fixtures.js');
const { E2 } = await import('../server/episodes/index.js');
const { resetChatRate } = await import('../server/chat.js');
let srv;
let base;

function agent() {
  const jar = cookieJar();
  const fn = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', cookie: jar.header() }, body: body ? JSON.stringify(body) : undefined });
    jar.update(r);
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  fn.jar = jar;
  return fn;
}

/** 開啟即時連線（SSE），收集事件；close() 模擬斷線 */
function openStream(A, query = 'role=student') {
  const ctrl = new AbortController();
  const events = [];
  const ready = (async () => {
    const r = await fetch(`${base}/stream?${query}`, { headers: { cookie: A.jar.header() }, signal: ctrl.signal });
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const ev = /^event: (.*)$/m.exec(chunk)?.[1];
            const data = /^data: (.*)$/m.exec(chunk)?.[1];
            if (ev) events.push({ ev, data: data ? JSON.parse(data) : null });
          }
        }
      } catch { /* 已中斷 */ }
    })();
  })();
  return { events, ready, close: () => ctrl.abort() };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await fn()) return true; await wait(30); }
  return false;
}

let T; let id; let joinCode; const S = {}; const names = {};
let seq = 0;
const key = () => `p-key-${Date.now()}-${++seq}`;
const tp = (p, b) => T('POST', `/teacher/competitions/${id}${p}`, b);
const comp = () => store.db.state.competitions[id];
const view = async () => (await T('GET', `/teacher/competitions/${id}`)).body;
const userIdOf = (name) => Object.values(store.db.state.users).find((u) => u.name === name)?.id;

async function write(A, sheet, inputs) {
  const p = (await A('GET', `/sheet/${sheet}`)).body;
  const ops = Object.entries(inputs).map(([a, i]) => ({ a, i, base: p.cells[a]?.v ?? 0 }));
  return (await A('POST', `/sheet/${sheet}/ops`, { ops })).body;
}

/** 目前 Driver 的學生代號（a／b／c） */
async function driverKey(teamId = 't1') {
  const d = (await view()).drivers.teams[teamId];
  return Object.keys(names).find((k) => userIdOf(names[k]) === d.driver?.id);
}

before(async () => {
  srv = startServer(0);
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}/api`;
  T = agent();
  await T('POST', '/auth/demo', { role: 'teacher', pin: '2468' });
  id = (await T('POST', '/teacher/competitions', { episode: 'E2', teamCount: 4, classCode: '4P', randomDriver: true, teamSelection: 'teacher' })).body.id;
  await tp('/generate', {});
  await tp('/approve');
  await tp('/lobby');
  joinCode = (await view()).joinCode;
  // 荃灣綫（t1）三人；觀塘綫（t2）一人
  for (const [k, team] of [['a', 't1'], ['b', 't1'], ['c', 't1'], ['x', 't2']]) {
    S[k] = agent();
    names[k] = `P-${k}-${Date.now().toString(36)}`;
    await S[k]('POST', '/auth/demo', { role: 'student', name: names[k] });
    await S[k]('POST', '/student/join', { joinCode });
    assert.equal((await tp('/assign', { userId: userIdOf(names[k]), teamId: team })).status, 200);
  }
  await tp('/start-episode');
});
after(() => srv.stop());

const doneOrder = []; // 每題的 Driver（按題目次序）

/** 由目前 Driver 完成目前題目（先由非 Driver 嘗試，必須被拒絕） */
async function completeCurrent(sheet) {
  const st = (await S.a('GET', '/student/state')).body.driver;
  const taskId = st.taskId;
  const dk = await driverKey();
  assert.ok(dk, `${taskId} 應有 Driver`);
  const others = ['a', 'b', 'c'].filter((k) => k !== dk);
  // 非 Driver：不能修改、不能提交（直接呼叫 API，不是只停用按鈕）
  const bad = await write(S[others[0]], sheet, correctInputs(taskId));
  assert.ok(bad.applied.length === 0 && bad.rejected.length > 0 && bad.rejected.every((r) => r.code === 'NOT_DRIVER'), JSON.stringify(bad.rejected[0]));
  const badSub = await S[others[1]]('POST', '/student/submit', { taskId, idempotencyKey: key() });
  assert.equal(badSub.status, 403);
  assert.equal(badSub.body.code, 'NOT_DRIVER');
  // Driver：可以修改及提交
  const ok = await write(S[dk], sheet, correctInputs(taskId));
  assert.equal(ok.rejected.length, 0, JSON.stringify(ok.rejected[0]));
  const sub = (await S[dk]('POST', '/student/submit', { taskId, idempotencyKey: key() })).body;
  assert.equal(sub.status, 'VERIFIED', `${taskId}: ${JSON.stringify(sub.errors)}`);
  doneOrder.push({ taskId, driver: dk });
  return { taskId, driver: dk };
}

test('1. 三人隊伍：每題輪流，每人輪到一次才重新洗牌；跨關卡延續', { timeout: 60000 }, async () => {
  assert.equal((await tp('/levels/1/start')).status, 200);
  for (let i = 0; i < 4; i++) await completeCurrent('E2L1_DoorLog');
  await tp('/levels/1/end');
  assert.equal((await tp('/levels/2/start')).status, 200);
  for (let i = 0; i < 2; i++) await completeCurrent('E2L2_Roster');
  const seqDrivers = doneOrder.map((x) => x.driver);
  assert.equal(new Set(seqDrivers.slice(0, 3)).size, 3, `第一輪三人各一次：${seqDrivers}`);
  assert.equal(new Set(seqDrivers.slice(3, 6)).size, 3, `第二輪三人各一次（跨越第 1、2 關）：${seqDrivers}`);
  assert.notEqual(seqDrivers[2], seqDrivers[3], '新一輪不會由上一題的 Driver 開始');
  const counts = ['a', 'b', 'c'].map((k) => seqDrivers.filter((x) => x === k).length);
  assert.deepEqual(counts, [2, 2, 2]);
  // 只有一名隊員的隊伍：該學生自動成為 Driver
  const t2 = (await view()).drivers.teams.t2;
  assert.equal(t2.driver.id, userIdOf(names.x));
  assert.equal(t2.tasks[t2.current].by, 'solo');
});

test('2–3. 只有 Driver 可以修改及提交；隊友仍可即時讀取工作表及對話', { timeout: 30000 }, async () => {
  const st = (await S.a('GET', '/student/state')).body.driver;
  const dk = await driverKey();
  const other = ['a', 'b', 'c'].find((k) => k !== dk);
  // 隊友的即時連線收到 Driver 的修改
  const sse = openStream(S[other]);
  await sse.ready;
  await wait(100);
  const r = await write(S[dk], 'E2L2_Roster', { H12: '=1+1' });
  assert.equal(r.applied.length, 1);
  assert.ok(await until(() => sse.events.some((e) => e.ev === 'cells' && e.data.ops?.some((o) => o.a === 'H12'))), '隊友收到即時更新');
  const sheet = (await S[other]('GET', '/sheet/E2L2_Roster')).body;
  assert.equal(sheet.cells.H12.i, '=1+1', '隊友可以讀取工作表');
  assert.deepEqual(sheet.editable, [], '隊友的工作表是唯讀的');
  assert.ok((await S[dk]('GET', '/sheet/E2L2_Roster')).body.editable.includes('H12'), 'Driver 可編輯目前題目的作答格');
  // 非目前題目：連 Driver 亦不能提交其他題目
  const notCur = await S[dk]('POST', '/student/submit', { taskId: 'E2-L2-T1', idempotencyKey: key() });
  assert.equal(notCur.status, 409);
  assert.equal(notCur.body.code, 'NOT_CURRENT_TASK');
  // 對話：所有隊員都可以發送及讀取
  resetChatRate();
  for (const k of ['a', 'b', 'c']) {
    const m = await S[k]('POST', '/chat', { text: `我建議 =XLOOKUP(H11,H2:H9,G2:G9) (${k})`, taskId: st.taskId, clientId: `cid-${k}-${Date.now()}` });
    assert.equal(m.status, 200, JSON.stringify(m.body));
  }
  assert.ok(await until(() => sse.events.filter((e) => e.ev === 'chat').length >= 3), '隊友即時收到對話');
  const list = (await S[other]('GET', '/chat')).body.messages.filter((m) => m.taskId === st.taskId);
  assert.equal(list.length, 3);
  assert.ok(list.every((m) => m.name && m.at && m.text.includes('XLOOKUP')));
  sse.close();
  await write(S[dk], 'E2L2_Roster', { H12: null });
});

test('對話限制：長度、空白、頻率、重試不重複；老師刪除及關閉', async () => {
  resetChatRate();
  assert.equal((await S.a('POST', '/chat', { text: 'x'.repeat(301) })).status, 400);
  assert.equal((await S.a('POST', '/chat', { text: '   ' })).status, 400);
  const cid = `retry-${Date.now()}`;
  const m1 = await S.a('POST', '/chat', { text: '重試測試', clientId: cid });
  const m2 = await S.a('POST', '/chat', { text: '重試測試', clientId: cid });
  assert.equal(m1.body.id, m2.body.id, '同一 clientId 只加入一次');
  let limited = false;
  for (let i = 0; i < 12; i++) { const r = await S.b('POST', '/chat', { text: `spam ${i}` }); if (r.status === 429) { limited = true; break; } }
  assert.ok(limited, '連續發送會被限制');
  // 老師刪除
  const del = await tp(`/chat/${m1.body.id}/delete`);
  assert.equal(del.status, 200);
  const after = (await S.c('GET', '/chat')).body.messages.find((m) => m.id === m1.body.id);
  assert.equal(after.deleted, true);
  assert.equal(after.text, '');
  assert.ok(comp().audit.some((a) => a.action === 'CHAT_DELETE' && a.detail.text === '重試測試'), '原文記錄於審計紀錄');
  // 暫停一隊／關閉全部
  resetChatRate();
  await T('PATCH', `/teacher/competitions/${id}`, { chatMutedTeams: ['t1'] });
  assert.equal((await S.a('POST', '/chat', { text: 'hi' })).body.code, 'CHAT_DISABLED');
  assert.equal((await S.x('POST', '/chat', { text: 'hi from t2' })).status, 200);
  await T('PATCH', `/teacher/competitions/${id}`, { chatMutedTeams: [], chatEnabled: false });
  assert.equal((await S.x('POST', '/chat', { text: 'hi' })).body.code, 'CHAT_DISABLED');
  await T('PATCH', `/teacher/competitions/${id}`, { chatEnabled: true });
  resetChatRate();
});

test('4. 老師重新指派（抽選或指定）：已儲存的公式保留，新 Driver 接手', async () => {
  const before = (await view()).drivers.teams.t1;
  const taskId = before.current;
  const oldKey = await driverKey();
  // 舊 Driver 先輸入部分答案
  const cells = Object.entries(correctInputs(taskId));
  const partial = Object.fromEntries(cells.slice(0, Math.max(1, cells.length - 1)));
  await write(S[oldKey], 'E2L2_Roster', partial);
  const r = await tp('/drivers', { teamId: 't1' });
  assert.equal(r.status, 200);
  assert.notEqual(r.body.userId, before.driver.id, '重新抽選不會選回同一人');
  const newKey = await driverKey();
  const sheet = (await S[newKey]('GET', '/sheet/E2L2_Roster')).body;
  for (const [a, i] of Object.entries(partial)) assert.equal(sheet.cells[a].i, i, `${a} 保留`);
  assert.equal((await write(S[oldKey], 'E2L2_Roster', { [cells[0][0]]: '=0' })).rejected[0]?.code, 'NOT_DRIVER', '舊 Driver 不能再修改');
  // 老師指定一名隊員
  const pick = ['a', 'b', 'c'].find((k) => k !== newKey);
  assert.equal((await tp('/drivers', { teamId: 't1', userId: userIdOf(names[pick]) })).status, 200);
  assert.equal(await driverKey(), pick);
  assert.equal((await tp('/drivers', { teamId: 't1', userId: userIdOf(names.x) })).status, 400, '不可指定其他隊的學生');
  const hist = (await view()).drivers.teams.t1.history.filter((x) => x.by === 'teacher');
  assert.equal(hist.length, 2);
  // 學生不能使用老師的指派 API
  assert.equal((await S[pick]('POST', `/teacher/competitions/${id}/drivers`, { teamId: 't1', userId: userIdOf(names[pick]) })).status, 403);
});

test('5. Driver 斷線後重新連線：不會被自動替換；老師看到離線狀態', { timeout: 20000 }, async () => {
  const dk = await driverKey();
  const s1 = openStream(S[dk]);
  await s1.ready;
  assert.ok(await until(async () => (await view()).drivers.teams.t1.driver.online));
  s1.close();
  assert.ok(await until(async () => !(await view()).drivers.teams.t1.driver.online), '老師看到 Driver 離線');
  const v = (await view()).drivers.teams.t1;
  assert.ok(v.driver.offlineSince > 0);
  // 其他事件（隊友提交錯誤答案以外的改變）不會改變 Driver
  await tp('/pause', { reason: '測試' });
  await tp('/resume');
  assert.equal(await driverKey(), dk, '短暫斷線不會自動更換 Driver');
  const s2 = openStream(S[dk]);
  await s2.ready;
  assert.ok(await until(async () => (await view()).drivers.teams.t1.driver.online), '重新連線後顯示在線');
  assert.equal(await driverKey(), dk);
  // 重新連線後仍可繼續作答
  const st = (await S[dk]('GET', '/student/state')).body.driver;
  assert.equal(st.driver.isMe, true);
  s2.close();
});

test('未連線的學生不會被選為下一題的 Driver', { timeout: 30000 }, async () => {
  const dk = await driverKey();
  const offline = ['a', 'b', 'c'].find((k) => k !== dk);
  const online = ['a', 'b', 'c'].filter((k) => k !== offline);
  await wait(50);
  const streams = online.map((k) => openStream(S[k]));
  await Promise.all(streams.map((x) => x.ready));
  await until(async () => (await view()).drivers.teams.t1.members.filter((m) => m.online).length === 2);
  await wait(400); // 超過重新整理的寬限
  // 進入第 3 關（三題）：之後的題目都只會由在線的兩人擔任
  await tp('/levels/2/end');
  assert.equal((await tp('/levels/3/start')).status, 200);
  const picked = [];
  for (let i = 0; i < 3; i++) {
    const cur = (await view()).drivers.teams.t1;
    const k = await driverKey();
    picked.push(k);
    const lv = E2.taskById[cur.current].level;
    await write(S[k], E2.levelByNum[lv].sheet, correctInputs(cur.current));
    const sub = (await S[k]('POST', '/student/submit', { taskId: cur.current, idempotencyKey: key() })).body;
    assert.equal(sub.status, 'VERIFIED');
    if (!(await view()).drivers.teams.t1.current) break;
  }
  assert.ok(picked.length === 3 && picked.every((x) => online.includes(x)), `只選在線的學生：${picked}，離線：${offline}`);
  for (const x of streams) x.close();
});

test('6. 新題目產生新指派；分數不會重複', async () => {
  const v = await view();
  const s = v.scores.find((x) => x.teamId === 't1');
  // 第 1 關：四題全對，基礎分 500，不會因不同 Driver 而重複或改變
  assert.equal(s.levels[1].earnedPts, s.levels[1].maxPts);
  const verified = comp().submissions.filter((x) => x.teamId === 't1' && x.level === 1 && x.status === 'VERIFIED');
  assert.equal(new Set(verified.map((x) => x.taskId)).size, 4);
  // 已完成的題目不能再由舊 Driver 提交（不是目前題目）
  const first = doneOrder[0];
  const r = await S[first.driver]('POST', '/student/submit', { taskId: first.taskId, idempotencyKey: key() });
  assert.ok([409, 403].includes(r.status));
  const after = (await view()).scores.find((x) => x.teamId === 't1');
  assert.equal(after.total, s.total, '分數不變');
  // 每題的 Driver 都有紀錄
  const tasks = v.drivers.teams.t1.tasks;
  for (const x of doneOrder) assert.ok(tasks[x.taskId], `${x.taskId} 有 Driver 紀錄`);
});

test('7. 其他隊伍及投影畫面看不到對話；學生不能讀取其他隊的對話或工作表', { timeout: 20000 }, async () => {
  resetChatRate();
  const xs = openStream(S.x);
  const proj = openStream(T, `role=projector&comp=${id}&key=${(await view()).projectorKey}`);
  await Promise.all([xs.ready, proj.ready]);
  await wait(100);
  const secret = `t1-secret-${Date.now()}`;
  assert.equal((await S.a('POST', '/chat', { text: secret })).status, 200);
  await wait(300);
  assert.ok(!xs.events.some((e) => JSON.stringify(e.data).includes(secret)), '其他隊收不到');
  assert.ok(!proj.events.some((e) => JSON.stringify(e.data).includes(secret)), '投影畫面收不到');
  assert.ok(!proj.events.some((e) => e.ev === 'chat'));
  const xChat = (await S.x('GET', '/chat?teamId=t1')).body;
  assert.equal(xChat.teamId, 't2', '參數不能改變隊伍');
  assert.ok(!xChat.messages.some((m) => m.text.includes(secret)));
  assert.equal((await S.x('GET', `/teacher/competitions/${id}/chat?teamId=t1`)).status, 403);
  // 公開視圖沒有對話及 Driver 資料
  const pub = (await T('GET', `/projector/${id}?key=${(await view()).projectorKey}`)).body;
  assert.ok(!JSON.stringify(pub).includes(secret) && !('drivers' in pub) && !('driver' in pub));
  // 老師可以讀取該隊對話
  const tc = (await T('GET', `/teacher/competitions/${id}/chat?teamId=t1`)).body;
  assert.ok(tc.messages.some((m) => m.text === secret));
  // 另一場比賽的學生
  const other = agent();
  await other('POST', '/auth/demo', { role: 'student', name: 'Outsider' });
  assert.equal((await other('GET', '/chat')).status, 404);
  assert.equal((await other('GET', '/sheet/E2L1_DoorLog')).status, 404);
  xs.close();
  proj.close();
});

test('練習（重開）不受 Driver 限制，亦不計分；關閉 Random Driver 後所有隊員可作答', async () => {
  const before = (await view()).scores.find((x) => x.teamId === 't1').total;
  const ro = (await tp('/reopen', { taskId: 'E2-L1-T1', teamIds: ['t1'], mode: 'practice' })).body;
  const rid = ro.id || comp().reopens.at(-1).id;
  const dk = (await view()).drivers.teams.t1.tasks['E2-L1-T1'].id;
  const nonDriver = ['a', 'b', 'c'].find((k) => userIdOf(names[k]) !== dk);
  const p = (await S[nonDriver]('GET', `/practice/${id}/${rid}/sheet`)).body;
  const ops = Object.entries(correctInputs('E2-L1-T1')).map(([a, i]) => ({ a, i, base: p.cells[a]?.v ?? 0 }));
  const w = (await S[nonDriver]('POST', `/practice/${id}/${rid}/ops`, { ops })).body;
  assert.equal(w.rejected.length, 0);
  const r = (await S[nonDriver]('POST', `/practice/${id}/${rid}/submit`, { idempotencyKey: key() })).body;
  assert.equal(r.status, 'VERIFIED');
  assert.equal((await view()).scores.find((x) => x.teamId === 't1').total, before);
  await tp(`/reopen/${rid}/close`);
  // 關閉 Random Driver
  await T('PATCH', `/teacher/competitions/${id}`, { randomDriver: false });
  const cur = E2.levelByNum[2].tasks.map((t) => t.id).find((tid) => !(comp().submissions.some((s) => s.teamId === 't1' && s.taskId === tid && s.status === 'VERIFIED' && s.earned === E2.taskById[tid].points)));
  if (cur) {
    const anyone = await write(S[nonDriver], 'E2L2_Roster', correctInputs(cur));
    assert.equal(anyone.rejected.length, 0, '關閉後任何隊員都可以輸入');
  }
  await T('PATCH', `/teacher/competitions/${id}`, { randomDriver: true });
});
