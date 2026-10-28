// 驗收測試 A（1–5）：身份與權限（經 HTTP API 測試）
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import './helpers.js';

const { startServer } = await import('../server/index.js');
let srv;
let base;

function agent() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}

let T; let compId; let joinCode; let projectorKey;
const students = [];

before(async () => {
  srv = startServer(0);
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}/api`;
  T = agent();
  await T('POST', '/auth/demo', { role: 'teacher', pin: '2468' });
  compId = (await T('POST', '/teacher/competitions', { teamCount: 6, classCode: '4A' })).body.id;
});
after(() => srv.stop());

test('5. 教師在未批准資料前無法開始正式競賽', async () => {
  const r = await T('POST', `/teacher/competitions/${compId}/levels/1/start`);
  assert.equal(r.status, 409);
  await T('POST', `/teacher/competitions/${compId}/generate`, {});
  const r2 = await T('POST', `/teacher/competitions/${compId}/levels/1/start`);
  assert.equal(r2.status, 409);
  assert.equal((await T('POST', `/teacher/competitions/${compId}/approve`)).status, 200);
  assert.equal((await T('POST', `/teacher/competitions/${compId}/lobby`)).status, 200);
  const v = (await T('GET', `/teacher/competitions/${compId}`)).body;
  joinCode = v.joinCode;
  projectorKey = v.projectorKey;
});

test('1. 一場 6 隊、20 人能正常加入；亦可設定 4 或 7 隊', async () => {
  const layout = [4, 4, 3, 3, 3, 3]; // 20 人
  let k = 0;
  for (let ti = 0; ti < 6; ti++) {
    for (let j = 0; j < layout[ti]; j++) {
      const S = agent();
      await S('POST', '/auth/demo', { role: 'student', name: `Student ${String(++k).padStart(2, '0')}` });
      const r = await S('POST', '/student/join', { joinCode, teamId: `t${ti + 1}` });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      students.push({ S, team: `t${ti + 1}` });
    }
  }
  const v = (await T('GET', `/teacher/competitions/${compId}`)).body;
  assert.deepEqual(v.teams.map((t) => t.members.length), layout);
  for (const n of [4, 7]) {
    const c = (await T('POST', '/teacher/competitions', { teamCount: n })).body.id;
    assert.equal((await T('GET', `/teacher/competitions/${c}`)).body.teams.length, n);
  }
  assert.equal((await T('POST', '/teacher/competitions', { teamCount: 8 })).status, 400);
  assert.equal((await T('POST', '/teacher/competitions', { teamCount: 3 })).status, 400);
});

test('2. 學生不可在未授權下讀寫另一隊的工作表', async () => {
  await T('POST', `/teacher/competitions/${compId}/start-episode`);
  await T('POST', `/teacher/competitions/${compId}/levels/1/start`);
  const { S } = students[0]; // t1
  // 學生 API 一律以登入身份決定隊伍：沒有任何參數可以指定其他隊伍
  const edit = await S('POST', '/student/demo-sheet/L1_Fare/edit', { edits: [{ addr: 'D2', input: '=1' }], teamId: 't2' });
  assert.equal(edit.status, 200);
  const other = students.find((x) => x.team === 't2').S;
  const sheet2 = (await other('GET', '/student/demo-sheet/L1_Fare')).body;
  assert.notEqual(sheet2.cells.D2.i, '=1', '另一隊的工作表不受影響');
  // 受保護原始數據不可修改
  assert.equal((await S('POST', '/student/demo-sheet/L1_Fare/edit', { edits: [{ addr: 'B2', input: '9' }] })).status, 403);
  // 未開始的關卡不可讀取
  assert.equal((await S('GET', '/student/demo-sheet/L5_Announcement')).status, 403);
  // 學生不可轉隊
  assert.equal((await S('POST', '/student/join', { joinCode, teamId: 't2' })).status, 409);
});

test('3. 非教師帳戶無法開啟 Teacher Answers／Preflight', async () => {
  const { S } = students[0];
  for (const url of [`/teacher/competitions/${compId}`, `/teacher/competitions/${compId}/preflight/t1`, '/teacher/competitions', `/teacher/competitions/${compId}/export.csv`]) {
    const r = await S('GET', url);
    assert.equal(r.status, 403, url);
  }
  assert.equal((await S('POST', `/teacher/competitions/${compId}/adjust`, { teamId: 't1', delta: 500, reason: 'hack' })).status, 403);
  const anon = agent();
  assert.equal((await anon('GET', `/teacher/competitions/${compId}/preflight/t1`)).status, 401);
  // 學生視圖不含參考公式或隱藏測試
  const st = JSON.stringify((await S('GET', '/student/state')).body);
  assert.ok(!st.includes('referenceFormulas') && !st.includes('hiddenRef') && !st.includes('teamSeed'));
  assert.ok(!st.includes('=B2*C2*$H$1'));
});

test('4. 投影端不顯示任何學生 Google Email；錯誤金鑰被拒', async () => {
  const pj = await fetch(`${base}/projector/${compId}?key=${projectorKey}`).then((r) => r.json());
  const text = JSON.stringify(pj);
  assert.ok(!text.includes('@'));
  assert.ok(!/Student \d\d/.test(text), '投影不顯示學生姓名');
  assert.ok(!text.includes(joinCode), '公開視圖不包含 Join Code');
  assert.equal((await fetch(`${base}/projector/${compId}?key=WRONG`)).status, 403);
});

test('學生不能自行提交「我答啱了」：分數只來自伺服器核實', async () => {
  const { S } = students[0];
  const r = await S('POST', '/student/submit', { taskId: 'L1-T1', idempotencyKey: 'abcdefgh1', earned: 2, status: 'VERIFIED' });
  assert.equal(r.status, 200);
  assert.notEqual(r.body.status, 'VERIFIED', '工作表未正確作答，提交的偽造欄位會被忽略');
});
