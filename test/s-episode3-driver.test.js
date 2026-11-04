// 驗收測試 S：第三集與隨機 Driver、隊伍對話、練習重開、老師預覽的整合（經 HTTP）。
// 非 Driver 不能排序、篩選、建立圖表／樞紐分析表／藍本，亦不能提交；其他隊伍不能讀取；練習不改變分數。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cookieJar } from './cookie-jar.js';
import { store, C } from './helpers.js';

const { startServer } = await import('../server/index.js');
const { correctInputs } = await import('../server/episode3/fixtures.js');
let srv; let base; let T; let id;
const S = {}; const names = {};
let seq = 0;
const key = () => `s-key-${Date.now()}-${++seq}`;

function agent() {
  const jar = cookieJar();
  return async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', cookie: jar.header() }, body: body ? JSON.stringify(body) : undefined });
    jar.update(r);
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}
const tp = (p, b) => T('POST', `/teacher/competitions/${id}${p}`, b || {});
const uid = (k) => Object.values(store.db.state.users).find((u) => u.name === names[k])?.id;
async function write(A, sheet, inputs, path = `/sheet/${sheet}`) {
  const p = (await A('GET', path)).body;
  const ops = Object.entries(inputs).map(([a, i]) => ({ a, i, base: p.cells[a]?.v ?? 0 }));
  return (await A('POST', `${path.replace(/\/sheet$/, '')}${path.endsWith('/sheet') ? '/ops' : '/ops'}`, { ops })).body;
}

before(async () => {
  srv = startServer(0);
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}/api`;
  T = agent();
  await T('POST', '/auth/demo', { role: 'teacher', pin: '2468' });
  id = (await T('POST', '/teacher/competitions', { episode: 'E3', teamCount: 4, randomDriver: true, teamSelection: 'teacher' })).body.id;
  await tp('/generate'); await tp('/approve'); await tp('/lobby');
  const joinCode = (await T('GET', `/teacher/competitions/${id}`)).body.joinCode;
  for (const [k, team] of [['a', 't1'], ['b', 't1'], ['x', 't2']]) {
    S[k] = agent(); names[k] = `S3-${k}-${Date.now().toString(36)}`;
    await S[k]('POST', '/auth/demo', { role: 'student', name: names[k] });
    await S[k]('POST', '/student/join', { joinCode });
    await tp('/assign', { userId: uid(k), teamId: team });
  }
  await tp('/start-episode');
  await tp('/levels/1/start');
});
after(() => srv.stop());

const drivers = async () => {
  const d = (await T('GET', `/teacher/competitions/${id}`)).body.drivers.teams.t1;
  const dk = ['a', 'b'].find((k) => uid(k) === d.driver.id);
  return { dk, nk: dk === 'a' ? 'b' : 'a', taskId: d.current };
};

test('非 Driver 不能排序、篩選或提交；Driver 可以；伺服器驗證設定', async () => {
  const { dk, nk, taskId } = await drivers();
  assert.equal(taskId, 'E3-L1-T1');
  const sortOp = { ops: [{ keys: [{ col: 'H', dir: 'desc' }] }] };
  const bad = await write(S[nk], 'E3L1_Complaints', { '!SORT': sortOp });
  assert.equal(bad.rejected[0]?.code, 'NOT_DRIVER');
  const badFilter = await write(S[nk], 'E3L1_Complaints', { '!FILTER': { crit: { G: { values: ['UNCLE-WONG'] } } } });
  assert.equal(badFilter.rejected[0]?.code, 'NOT_DRIVER', '篩選屬於 T3，亦不是目前題目');
  // 惡意或錯誤的設定：伺服器拒絕
  const evil = await write(S[dk], 'E3L1_Complaints', { '!SORT': { ops: [{ keys: [{ col: 'Z', dir: 'desc' }] }] } });
  assert.equal(evil.rejected[0]?.code, 'BAD_META');
  const good = await write(S[dk], 'E3L1_Complaints', { '!SORT': sortOp, B123: '=A2', B124: '=C4' });
  assert.equal(good.rejected.length, 0, JSON.stringify(good.rejected));
  assert.equal((await S[nk]('POST', '/student/submit', { taskId, idempotencyKey: key() })).status, 403);
  const r = (await S[dk]('POST', '/student/submit', { taskId, idempotencyKey: key() })).body;
  assert.equal(r.status, 'VERIFIED', JSON.stringify(r.errors));
  // 隊友即時讀到排序後的設定
  const p = (await S[nk]('GET', '/sheet/E3L1_Complaints')).body;
  assert.deepEqual(p.cells['!SORT'].i, sortOp);
  // 下一題換人
  const next = await drivers();
  assert.equal(next.taskId, 'E3-L1-T2');
  assert.notEqual(next.dk, dk);
});

test('其他隊伍及老師：隊伍隔離；老師可讀取該隊的分析設定及教師備註', async () => {
  const other = (await S.x('GET', '/sheet/E3L1_Complaints')).body;
  assert.ok(!other.cells['!SORT'], '另一隊的工作表沒有 t1 的排序');
  const tv = (await T('GET', `/teacher/competitions/${id}/sheet/t1/E3L1_Complaints`)).body;
  assert.ok(tv.cells['!SORT']);
  const pv = (await T('GET', `/teacher/competitions/${id}/preview?teamId=t1&taskId=E3-L1-T2`)).body;
  assert.ok(pv.teacher.teacherNotes.length);
  assert.ok(pv.teacher.commonErrors.some((c) => c.codes.includes('SORT_LEVELS')));
  assert.equal((await S.a('GET', `/teacher/competitions/${id}/preview?teamId=t1&taskId=E3-L1-T2`)).status, 403);
});

test('練習重開（第三集）：任何隊員可練習排序，不改變分數', async () => {
  const before = (await T('GET', `/teacher/competitions/${id}`)).body.scores.find((s) => s.teamId === 't1').total;
  const ro = (await tp('/reopen', { taskId: 'E3-L1-T1', teamIds: ['t1'], mode: 'practice', fresh: true })).body;
  const rid = ro.id || store.db.state.competitions[id].reopens.at(-1).id;
  const { nk } = await drivers();
  const path = `/practice/${id}/${rid}/sheet`;
  const p = (await S[nk]('GET', path)).body;
  assert.ok(!p.cells['!SORT']?.i?.ops?.length, '由起始內容重新開始');
  const ops = Object.entries(correctInputs('E3-L1-T1')).map(([a, i]) => ({ a, i, base: p.cells[a]?.v ?? 0 }));
  const w = (await S[nk]('POST', `/practice/${id}/${rid}/ops`, { ops })).body;
  assert.equal(w.rejected.length, 0, JSON.stringify(w.rejected));
  const r = (await S[nk]('POST', `/practice/${id}/${rid}/submit`, { idempotencyKey: key() })).body;
  assert.equal(r.status, 'VERIFIED');
  assert.equal((await T('GET', `/teacher/competitions/${id}`)).body.scores.find((s) => s.teamId === 't1').total, before);
  // 正式作答的排序不受練習影響
  const main = (await S[nk]('GET', '/sheet/E3L1_Complaints')).body;
  assert.equal(main.cells['!SORT'].i.ops.length, 1);
});
