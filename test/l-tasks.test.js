// 驗收測試 L：題目開放／鎖定、重開題目（練習／補做）、老師題目預覽
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cookieJar } from './cookie-jar.js';
import { store, clock } from './helpers.js';

const { startServer } = await import('../server/index.js');
const { correctInputs } = await import('../server/episode1/fixtures.js');
let srv;
let base;

function agent() {
  const jar = cookieJar();
  return async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', cookie: jar.header() }, body: body ? JSON.stringify(body) : undefined });
    jar.update(r);
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}

let T;
let seq = 0;
const key = () => `l-test-key-${Date.now()}-${++seq}`;

async function setup(opts = {}) {
  const id = (await T('POST', '/teacher/competitions', { teamCount: 4, classCode: opts.classCode || '4L', ...opts })).body.id;
  await T('POST', `/teacher/competitions/${id}/generate`, {});
  await T('POST', `/teacher/competitions/${id}/approve`);
  await T('POST', `/teacher/competitions/${id}/lobby`);
  const joinCode = (await T('GET', `/teacher/competitions/${id}`)).body.joinCode;
  const S = {};
  for (const [tid, name] of [['t1', `A${id}`], ['t2', `B${id}`]]) {
    S[tid] = agent();
    await S[tid]('POST', '/auth/demo', { role: 'student', name: name.slice(0, 20) });
    await S[tid]('POST', '/student/join', { joinCode, teamId: tid });
  }
  await T('POST', `/teacher/competitions/${id}/start-episode`);
  return { id, joinCode, S };
}

const putMain = async (S, sheet, inputs) => {
  const p = (await S('GET', `/sheet/${sheet}?layer=main`)).body;
  return (await S('POST', `/sheet/${sheet}/ops`, { layer: 'main', ops: Object.entries(inputs).map(([a, i]) => ({ a, i, base: p.cells[a]?.v ?? 0 })) })).body;
};

before(async () => {
  srv = startServer(0);
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}/api`;
  T = agent();
  await T('POST', '/auth/demo', { role: 'teacher', pin: '2468' });
});
after(() => srv.stop());

test('老師鎖定題目：學生不能編輯或提交，題目內容不提前公開；開始後恢復', async () => {
  const { id, S } = await setup();
  await T('POST', `/teacher/competitions/${id}/levels/1/start`);
  assert.equal((await T('POST', `/teacher/competitions/${id}/tasks/L1-T2/lock`)).status, 200);
  const st = (await S.t1('GET', '/student/state')).body;
  const t2 = st.levelDetails[0].tasks.find((t) => t.id === 'L1-T2');
  assert.equal(t2.state, 'locked');
  assert.equal(t2.instruction, null, '未開放的題目不顯示內容');
  const r = await putMain(S.t1, 'L1_Fare', { F2: '=E2-D2' });
  assert.equal(r.rejected[0].code, 'LOCKED');
  const sub = await S.t1('POST', '/student/submit', { taskId: 'L1-T2', idempotencyKey: key() });
  assert.equal(sub.status, 409);
  assert.equal(sub.body.code, 'TASK_LOCKED');
  // 其他題目不受影響
  assert.equal((await putMain(S.t1, 'L1_Fare', { H3: '=SUM(F2:F21)' })).applied[0].i, '=SUM(F2:F21)');
  assert.equal((await T('POST', `/teacher/competitions/${id}/tasks/L1-T2/start`)).status, 200);
  assert.equal((await putMain(S.t1, 'L1_Fare', { F2: '=E2-D2' })).applied[0].i, '=E2-D2');
  // 學生不能使用老師的控制
  assert.equal((await S.t1('POST', `/teacher/competitions/${id}/tasks/L1-T2/lock`)).status, 403);
});

test('逐題開放模式：開始關卡時只開放第一題', async () => {
  const { id, S } = await setup({ taskByTask: true, classCode: '4M' });
  await T('POST', `/teacher/competitions/${id}/levels/1/start`);
  const p = (await S.t1('GET', '/sheet/L1_Fare')).body;
  assert.ok(p.editable.includes('D2'));
  assert.ok(!p.editable.includes('F2') && !p.editable.includes('H3'));
  assert.deepEqual(p.tasks.map((t) => t.state), ['active', 'locked', 'locked', 'locked']);
});

test('時間到：作答格鎖定，不能提交', async () => {
  const { id, S } = await setup({ classCode: '4N', levelSeconds: { 1: 60 } });
  await T('POST', `/teacher/competitions/${id}/levels/1/start`);
  clock.advance(61000);
  await new Promise((r) => setTimeout(r, 800)); // 伺服器每 0.5 秒檢查一次時間
  clock.reset();
  const st = (await S.t1('GET', '/student/state')).body;
  assert.equal(st.levelDetails[0].phase, 'ended');
  const p = (await S.t1('GET', '/sheet/L1_Fare')).body;
  assert.equal(p.editable.length, 0);
  assert.equal((await S.t1('POST', '/student/submit', { taskId: 'L1-T1', idempotencyKey: key() })).status, 409);
});

test('重開題目（練習）：可以修改及提交，但不會重複加分或改變排名；不影響進行中的關卡', async () => {
  const { id, S } = await setup({ classCode: '4P' });
  await T('POST', `/teacher/competitions/${id}/levels/1/start`);
  await putMain(S.t1, 'L1_Fare', correctInputs('L1-T1'));
  assert.equal((await S.t1('POST', '/student/submit', { taskId: 'L1-T1', idempotencyKey: key() })).body.status, 'VERIFIED');
  await T('POST', `/teacher/competitions/${id}/levels/1/end`);
  await T('POST', `/teacher/competitions/${id}/levels/2/start`);
  const before1 = (await T('GET', `/teacher/competitions/${id}`)).body;
  const scoreBefore = before1.scores.map((x) => [x.teamId, x.total]);
  const timerBefore = before1.levels.find((l) => l.level === 2).remainingMs;
  const r = (await T('POST', `/teacher/competitions/${id}/reopen`, { taskId: 'L1-T1', teamIds: ['t1'], mode: 'practice' })).body;
  assert.ok(r.id);
  // 學生看到練習；第 1 關的可得分公式暫時隱藏
  const st = (await S.t1('GET', '/student/state')).body;
  assert.equal(st.practice.length, 1);
  assert.equal(st.levelDetails.find((l) => l.level === 1).review, null);
  const pr = st.practice[0];
  const sheetUrl = `/practice/${pr.compId}/${pr.reopenId}/sheet`;
  const ps = (await S.t1('GET', sheetUrl)).body;
  assert.equal(ps.cells.D2.i, '=B2*C2*$H$1', '練習副本由原來的作答開始');
  assert.ok(ps.editable.includes('D2') && !ps.editable.includes('F2'), '只開放重開的題目');
  // 修改練習副本：正式作答不變
  const ops = (await S.t1('POST', `/practice/${pr.compId}/${pr.reopenId}/ops`, { ops: [{ a: 'D2', i: '=B2*C2*H1', base: ps.cells.D2.v }] })).body;
  assert.equal(ops.applied[0].i, '=B2*C2*H1');
  assert.equal((await S.t1('GET', '/sheet/L1_Fare')).body.cells.D2.i, '=B2*C2*$H$1', '正式作答保留');
  const wrong = (await S.t1('POST', `/practice/${pr.compId}/${pr.reopenId}/submit`, { idempotencyKey: key() })).body;
  assert.equal(wrong.status, 'REJECTED');
  assert.equal(wrong.practice, true);
  const p2 = (await S.t1('GET', sheetUrl)).body;
  await S.t1('POST', `/practice/${pr.compId}/${pr.reopenId}/ops`, { ops: [{ a: 'D2', i: '=B2*C2*$H$1', base: p2.cells.D2.v }] });
  const k = key();
  const right = (await S.t1('POST', `/practice/${pr.compId}/${pr.reopenId}/submit`, { idempotencyKey: k })).body;
  assert.equal(right.status, 'VERIFIED');
  assert.equal((await S.t1('POST', `/practice/${pr.compId}/${pr.reopenId}/submit`, { idempotencyKey: k })).body.replayed, true);
  const after1 = (await T('GET', `/teacher/competitions/${id}`)).body;
  assert.deepEqual(after1.scores.map((x) => [x.teamId, x.total]), scoreBefore, '練習不改變分數');
  assert.deepEqual(after1.leaderboardLive.map((x) => x.teamId), before1.leaderboardLive.map((x) => x.teamId), '排名不變');
  assert.ok(after1.levels.find((l) => l.level === 2).remainingMs <= timerBefore, '第 2 關計時繼續，不受影響');
  assert.equal(after1.levels.find((l) => l.level === 2).phase, 'active');
  assert.equal(after1.taskStates.t1['L1-T1'], 'reopened');
  // 另一隊不能存取這個練習
  assert.equal((await S.t2('GET', sheetUrl)).status, 403);
  assert.equal((await S.t2('POST', `/practice/${pr.compId}/${pr.reopenId}/submit`, { idempotencyKey: key() })).status, 403);
  // 重新載入資料（模擬伺服器重新啟動）：重開狀態及練習作答保留
  await store.flush();
  store.load();
  const again = (await S.t1('GET', '/student/state')).body;
  assert.equal(again.practice[0].reopenId, pr.reopenId);
  assert.equal((await S.t1('GET', sheetUrl)).body.cells.D2.i, '=B2*C2*$H$1');
  // 老師結束練習：不能再修改或提交
  await T('POST', `/teacher/competitions/${id}/reopen/${pr.reopenId}/close`);
  assert.equal((await S.t1('POST', `/practice/${pr.compId}/${pr.reopenId}/submit`, { idempotencyKey: key() })).status, 409);
  assert.equal((await S.t1('GET', '/student/state')).body.practice.length, 0);
});

test('補做（計分）：只計基礎分，不計速度獎勵，錯誤不扣分', async () => {
  const { id, S } = await setup({ classCode: '4Q' });
  await T('POST', `/teacher/competitions/${id}/levels/1/start`);
  await T('POST', `/teacher/competitions/${id}/levels/1/end`);
  const before1 = (await T('GET', `/teacher/competitions/${id}`)).body.scores.find((x) => x.teamId === 't2');
  assert.equal((await T('POST', `/teacher/competitions/${id}/reopen`, { taskId: 'L1-T1', teamIds: ['t2'], mode: 'makeup' })).status, 200);
  const p = (await S.t2('GET', '/sheet/L1_Fare')).body;
  assert.ok(p.editable.includes('D2') && !p.editable.includes('F2'));
  await putMain(S.t2, 'L1_Fare', { D2: '=1' });
  const bad = (await S.t2('POST', '/student/submit', { taskId: 'L1-T1', idempotencyKey: key() })).body;
  assert.equal(bad.status, 'REJECTED');
  assert.equal(bad.noPenalty, true);
  await putMain(S.t2, 'L1_Fare', correctInputs('L1-T1'));
  assert.equal((await S.t2('POST', '/student/submit', { taskId: 'L1-T1', idempotencyKey: key() })).body.status, 'VERIFIED');
  const after1 = (await T('GET', `/teacher/competitions/${id}`)).body.scores.find((x) => x.teamId === 't2');
  assert.ok(after1.levels[1].base > before1.levels[1].base, '基礎分增加');
  assert.equal(after1.levels[1].speed, 0, '沒有速度獎勵');
  assert.equal(after1.levels[1].wrongPenalty, 0, '錯誤不扣分');
  // 其他隊伍沒有補做權
  assert.equal((await S.t1('POST', '/student/submit', { taskId: 'L1-T1', idempotencyKey: key() })).status, 409);
});

test('之前劇集的練習：學生已進入另一場比賽，仍可以練習（只限自己的隊伍）', async () => {
  const A = await setup({ classCode: '4R' });
  await T('POST', `/teacher/competitions/${A.id}/levels/1/start`);
  await T('POST', `/teacher/competitions/${A.id}/levels/1/end`);
  const B = (await T('POST', '/teacher/competitions', { teamCount: 4, classCode: '4R' })).body.id;
  await T('POST', `/teacher/competitions/${B}/generate`, {});
  await T('POST', `/teacher/competitions/${B}/approve`);
  await T('POST', `/teacher/competitions/${B}/lobby`);
  const codeB = (await T('GET', `/teacher/competitions/${B}`)).body.joinCode;
  await A.S.t1('POST', '/student/join', { joinCode: codeB, teamId: 't1' });
  assert.equal((await A.S.t1('GET', '/student/state')).body.id, B);
  const r = (await T('POST', `/teacher/competitions/${A.id}/reopen`, { taskId: 'L1-T1', teamIds: ['t1'], mode: 'practice', fresh: true })).body;
  const items = (await A.S.t1('GET', '/student/state')).body.practice;
  assert.ok(items.some((x) => x.compId === A.id && x.reopenId === r.id && x.classCode === '4R'));
  const ps = (await A.S.t1('GET', `/practice/${A.id}/${r.id}/sheet`)).body;
  assert.equal(ps.cells.D2.i, '=B2*C2*H1', '「重新開始」由起始內容開始');
});

test('老師題目預覽：顯示該隊實際題目、數據、參考公式、評分點及常見錯誤；學生不可存取', async () => {
  const { id, S } = await setup({ classCode: '4S' });
  await T('POST', `/teacher/competitions/${id}/levels/1/start`);
  const pv = (await T('GET', `/teacher/competitions/${id}/preview?teamId=t2&taskId=L1-T1`)).body;
  assert.match(pv.task.instruction, /絕對參照/);
  assert.equal(pv.teacher.reference.D2, '=B2*C2*$H$1');
  assert.ok(pv.teacher.expected.D2 !== undefined);
  assert.equal(pv.teacher.markingPoints.length, 2);
  assert.ok(pv.teacher.commonErrors.some((c) => c.codes.includes('ABS_REF_MISSING')));
  assert.equal(pv.states.length, 4);
  assert.equal(pv.states.find((x) => x.teamId === 't2').state, 'active');
  const sheet = (await T('GET', `/teacher/competitions/${id}/sheet/t2/L1_Fare`)).body;
  assert.equal(sheet.readOnly, true);
  assert.ok(sheet.data.B2 !== undefined);
  assert.equal((await S.t1('GET', `/teacher/competitions/${id}/preview?teamId=t2&taskId=L1-T1`)).status, 403);
});
