// 驗收測試 J：隊伍及班別隔離（經 HTTP API；嘗試以網址、參數、隊伍編號存取其他隊伍／班別）
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cookieJar } from './cookie-jar.js';
import './helpers.js';

const { startServer } = await import('../server/index.js');
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

/** 讀取 SSE 一段時間，回傳收到的事件 */
async function collect(S, url, ms, during) {
  const ctrl = new AbortController();
  const res = await fetch(base + url, { headers: { cookie: S.jar.header() }, signal: ctrl.signal });
  const reader = res.body.getReader();
  const events = [];
  let buf = '';
  const pump = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += Buffer.from(value).toString('utf8');
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(chunk)?.[1];
          const data = /^data: (.+)$/m.exec(chunk)?.[1];
          if (ev) events.push({ ev, data: data ? JSON.parse(data) : null });
        }
      }
    } catch { /* aborted */ }
  })();
  await during?.();
  await new Promise((r) => setTimeout(r, ms));
  ctrl.abort();
  await pump;
  return events;
}

let T;
async function makeComp(body) {
  const id = (await T('POST', '/teacher/competitions', body)).body.id;
  await T('POST', `/teacher/competitions/${id}/generate`, {});
  await T('POST', `/teacher/competitions/${id}/approve`);
  await T('POST', `/teacher/competitions/${id}/lobby`);
  const v = (await T('GET', `/teacher/competitions/${id}`)).body;
  return { id, joinCode: v.joinCode };
}

before(async () => {
  srv = startServer(0);
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}/api`;
  T = agent();
  await T('POST', '/auth/demo', { role: 'teacher', pin: '2468' });
});
after(() => srv.stop());

test('訪客登入：不同電腦輸入相同名稱是不同學生，不能冒認同學', async () => {
  const A = agent();
  const B = agent();
  const a = (await A('POST', '/auth/demo', { role: 'student', name: 'Amy' })).body.user;
  const b = (await B('POST', '/auth/demo', { role: 'student', name: 'Amy' })).body.user;
  assert.notEqual(a.id, b.id, '相同名稱在另一部電腦不會登入同一個學生帳戶');
  const a2 = (await A('POST', '/auth/demo', { role: 'student', name: 'Amy' })).body.user;
  assert.equal(a2.id, a.id, '同一部電腦再次登入仍是同一學生');
});

test('老師分隊模式：學生不能自選或自行轉隊，只可等候老師分隊', async () => {
  const c = await makeComp({ teamCount: 6, classCode: '4T', teamSelection: 'teacher' });
  const S = agent();
  await S('POST', '/auth/demo', { role: 'student', name: 'Ben' });
  const look = (await S('POST', '/student/lookup', { joinCode: c.joinCode })).body;
  assert.equal(look.teamSelection, 'teacher');
  assert.equal(look.teams.length, 0, '老師分隊模式不顯示隊伍選擇');
  const j = await S('POST', '/student/join', { joinCode: c.joinCode, teamId: 't3' });
  assert.equal(j.status, 200);
  assert.equal(j.body.waiting, true, 'teamId 被忽略，學生進入等候名單');
  const st = (await S('GET', '/student/state')).body;
  assert.equal(st.team, null);
  assert.equal(st.waiting, true);
  assert.equal((await S('GET', '/student/demo-sheet/L1_Fare')).status, 403, '未分隊不可讀取任何工作表');
  const v = (await T('GET', `/teacher/competitions/${c.id}`)).body;
  assert.equal(v.waiting.length, 1);
  assert.equal((await T('POST', `/teacher/competitions/${c.id}/assign`, { userId: v.waiting[0].id, teamId: 't2' })).status, 200);
  assert.equal((await S('GET', '/student/state')).body.team.id, 't2');
  // 學生不能自行轉隊
  await S('POST', '/student/join', { joinCode: c.joinCode, teamId: 't5' });
  assert.equal((await S('GET', '/student/state')).body.team.id, 't2');
  // 老師移除後，學生失去存取權
  assert.equal((await T('POST', `/teacher/competitions/${c.id}/remove-student`, { userId: v.waiting[0].id, reason: '加入錯班' })).status, 200);
  assert.equal((await S('GET', '/student/state')).status, 404);
  assert.equal((await S('GET', '/student/demo-sheet/L1_Fare')).status, 404);
});

test('自動平均分隊', async () => {
  const c = await makeComp({ teamCount: 4, classCode: '4U', teamSelection: 'teacher' });
  for (let i = 0; i < 10; i++) {
    const S = agent();
    await S('POST', '/auth/demo', { role: 'student', name: `Auto ${i}` });
    await S('POST', '/student/join', { joinCode: c.joinCode });
  }
  const r = (await T('POST', `/teacher/competitions/${c.id}/auto-assign`)).body;
  assert.equal(r.placed, 10);
  const v = (await T('GET', `/teacher/competitions/${c.id}`)).body;
  assert.deepEqual(v.teams.map((t) => t.members.length).sort(), [2, 2, 3, 3]);
  assert.equal(v.waiting.length, 0);
});

test('班別名單：不在名單內的帳戶不能加入；要求 Google 時訪客不能加入', async () => {
  const c = await makeComp({ teamCount: 4, classCode: '4V', allowedDomains: 'school.edu.hk' });
  const S = agent();
  await S('POST', '/auth/demo', { role: 'student', name: 'Guest' });
  assert.equal((await S('POST', '/student/lookup', { joinCode: c.joinCode })).status, 403);
  const j = await S('POST', '/student/join', { joinCode: c.joinCode, teamId: 't1' });
  assert.equal(j.status, 403);
  assert.equal(j.body.code, 'NOT_ON_ROSTER');
  const g = await makeComp({ teamCount: 4, classCode: '4W', requireGoogle: true });
  assert.equal((await S('POST', '/student/join', { joinCode: g.joinCode, teamId: 't1' })).body.code, 'GOOGLE_LOGIN_REQUIRED');
});

test('兩班同時進行（4A／4B，隊伍名稱相同）：資料、分數、計時完全分開', async () => {
  const A = await makeComp({ teamCount: 6, classCode: '4A' });
  const B = await makeComp({ teamCount: 6, classCode: '4B' });
  assert.notEqual(A.joinCode, B.joinCode);
  const SA = agent();
  const SB = agent();
  await SA('POST', '/auth/demo', { role: 'student', name: 'Cara' });
  await SB('POST', '/auth/demo', { role: 'student', name: 'Dan' });
  await SA('POST', '/student/join', { joinCode: A.joinCode, teamId: 't1' });
  await SB('POST', '/student/join', { joinCode: B.joinCode, teamId: 't1' });
  for (const c of [A, B]) await T('POST', `/teacher/competitions/${c.id}/start-episode`);
  await T('POST', `/teacher/competitions/${A.id}/levels/1/start`);
  // B 班未開始第 1 關：B 班學生不可讀取第 1 關
  assert.equal((await SB('GET', '/student/demo-sheet/L1_Fare')).status, 403);
  await T('POST', `/teacher/competitions/${B.id}/levels/1/start`);
  await SA('POST', '/student/demo-sheet/L1_Fare/edit', { edits: [{ addr: 'D2', input: '=B2*C2*$H$1' }], compId: B.id });
  const sb = (await SB('GET', '/student/demo-sheet/L1_Fare')).body;
  assert.notEqual(sb.cells.D2?.i, '=B2*C2*$H$1', '另一班同名隊伍的工作表不受影響');
  const sub = (await SA('POST', '/student/submit', { taskId: 'L1-T1', idempotencyKey: 'class-iso-0001', compId: B.id })).body;
  assert.ok(sub.id);
  const va = (await T('GET', `/teacher/competitions/${A.id}`)).body;
  const vb = (await T('GET', `/teacher/competitions/${B.id}`)).body;
  assert.equal(va.submissions.length, 1);
  assert.equal(vb.submissions.length, 0, '另一班沒有任何提交');
  // 學生不能以比賽編號讀取另一班的教師資料或投影資料
  assert.equal((await SA('GET', `/teacher/competitions/${B.id}`)).status, 403);
  assert.equal((await SA('GET', `/projector/${B.id}`)).status, 403);
  // 學生的即時推送只屬自己的比賽及隊伍
  const evs = await collect(SA, '/stream?role=student&comp=' + B.id, 300);
  const st = evs.find((e) => e.ev === 'state').data;
  assert.equal(st.id, A.id, '即時推送不能以參數改為另一班');
});

test('學生即時推送：只收到自己隊伍的工作表更新', async () => {
  const c = await makeComp({ teamCount: 4, classCode: '4X' });
  const S1 = agent();
  const S2 = agent();
  const S3 = agent();
  await S1('POST', '/auth/demo', { role: 'student', name: 'Eve' });
  await S2('POST', '/auth/demo', { role: 'student', name: 'Fay' });
  await S3('POST', '/auth/demo', { role: 'student', name: 'Gus' });
  await S1('POST', '/student/join', { joinCode: c.joinCode, teamId: 't1' });
  await S2('POST', '/student/join', { joinCode: c.joinCode, teamId: 't1' });
  await S3('POST', '/student/join', { joinCode: c.joinCode, teamId: 't2' });
  await T('POST', `/teacher/competitions/${c.id}/start-episode`);
  await T('POST', `/teacher/competitions/${c.id}/levels/1/start`);
  const [teammate, rival] = await Promise.all([
    collect(S2, '/stream?role=student', 600, () => S1('POST', '/student/demo-sheet/L1_Fare/edit', { edits: [{ addr: 'D3', input: '=7' }] })),
    collect(S3, '/stream?role=student', 600),
  ]);
  assert.ok(teammate.some((e) => e.ev === 'sheet' || e.ev === 'cells'), '隊友收到更新');
  assert.ok(!rival.some((e) => e.ev === 'sheet' || e.ev === 'cells'), '另一隊收不到更新');
  assert.ok(!JSON.stringify(rival).includes('=7'));
});
