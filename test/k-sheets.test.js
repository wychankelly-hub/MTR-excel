// 驗收測試 K：內置工作表（逐格儲存、版本衝突、同步、複製公式、批改、資料轉移）
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cookieJar } from './cookie-jar.js';
import { store, C } from './helpers.js';

const { startServer } = await import('../server/index.js');
const sheets = await import('../server/sheets.js');
const { correctInputs } = await import('../server/episode1/fixtures.js');
const { parseFormula } = await import('../server/engine/parser.js');
const { shiftAst, toFormulaString } = await import('../server/engine/ast.js');
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

let T; let compId; let joinCode;
const team1 = []; const team2 = [];

before(async () => {
  srv = startServer(0);
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}/api`;
  T = agent();
  await T('POST', '/auth/demo', { role: 'teacher', pin: '2468' });
  compId = (await T('POST', '/teacher/competitions', { teamCount: 4, classCode: '4K' })).body.id;
  await T('POST', `/teacher/competitions/${compId}/generate`, {});
  await T('POST', `/teacher/competitions/${compId}/approve`);
  await T('POST', `/teacher/competitions/${compId}/lobby`);
  joinCode = (await T('GET', `/teacher/competitions/${compId}`)).body.joinCode;
  for (const [list, teamId, names] of [[team1, 't1', ['Ann', 'Bob']], [team2, 't2', ['Cal']]]) {
    for (const n of names) {
      const S = agent();
      await S('POST', '/auth/demo', { role: 'student', name: n });
      await S('POST', '/student/join', { joinCode, teamId });
      list.push(S);
    }
  }
});
after(() => srv.stop());

const ops = (S, sheet, o, layer = 'main') => S('POST', `/sheet/${sheet}/ops`, { layer, ops: o });

test('未開始的關卡：不能讀取或修改工作表', async () => {
  const [A] = team1;
  assert.equal((await A('GET', '/sheet/L1_Fare')).status, 403);
  assert.equal((await ops(A, 'L1_Fare', [{ a: 'D2', i: '=1', base: 0 }])).status, 403);
  await T('POST', `/teacher/competitions/${compId}/start-episode`);
  await T('POST', `/teacher/competitions/${compId}/levels/1/start`);
  const p = (await A('GET', '/sheet/L1_Fare')).body;
  assert.equal(p.sheet, 'L1_Fare');
  assert.ok(p.data.B2 !== undefined, '包含本隊原始數據');
  assert.ok(p.editable.includes('D2') && p.editable.includes('F21') && p.editable.includes('H3'));
  assert.ok(!p.editable.includes('B2'), '原始數據不可編輯');
  assert.equal(p.cells.D2.i, '=B2*C2*H1', '起始內容：火箭仔寫錯的公式');
  assert.ok(!JSON.stringify(p).includes('$H$1'), '不含參考答案');
  assert.equal((await A('GET', '/sheet/L2_Crowd')).status, 403, '下一關的數據未公開');
});

test('同一格同時修改：後到的修改不會覆蓋，回報衝突', async () => {
  const [A, B] = team1;
  const v0 = (await A('GET', '/sheet/L1_Fare')).body.cells.F2?.v ?? 0;
  const ra = (await ops(A, 'L1_Fare', [{ a: 'F2', i: '=E2-D2', base: v0 }])).body;
  assert.equal(ra.applied[0].i, '=E2-D2');
  const rb = (await ops(B, 'L1_Fare', [{ a: 'F2', i: '=999', base: v0 }])).body;
  assert.equal(rb.conflicts.length, 1, 'B 以舊版本修改 → 衝突');
  assert.equal(rb.conflicts[0].i, '=E2-D2');
  assert.equal(rb.conflicts[0].byName, 'Ann');
  const now = (await B('GET', '/sheet/L1_Fare')).body.cells.F2;
  assert.equal(now.i, '=E2-D2', 'A 的修改沒有被覆蓋');
  // B 看到最新版本後再改：成功
  const rb2 = (await ops(B, 'L1_Fare', [{ a: 'F2', i: '=E2 - D2', base: now.v }])).body;
  assert.equal(rb2.applied[0].v, now.v + 1);
  // 相同內容重送（例如網絡重試）：不算衝突
  const again = (await ops(B, 'L1_Fare', [{ a: 'F2', i: '=E2 - D2', base: now.v }])).body;
  assert.equal(again.conflicts.length, 0);
});

test('兩名隊友同時修改不同儲存格：全部保留', async () => {
  const [A, B] = team1;
  const p = (await A('GET', '/sheet/L1_Fare')).body;
  const ref = correctInputs('L1-T1');
  const addrs = Object.keys(ref);
  const half = Math.ceil(addrs.length / 2);
  const [ra, rb] = await Promise.all([
    ops(A, 'L1_Fare', addrs.slice(0, half).map((a) => ({ a, i: ref[a], base: p.cells[a]?.v ?? 0 }))),
    ops(B, 'L1_Fare', addrs.slice(half).map((a) => ({ a, i: ref[a], base: p.cells[a]?.v ?? 0 }))),
  ]);
  assert.equal(ra.body.conflicts.length + rb.body.conflicts.length, 0);
  const after2 = (await B('GET', '/sheet/L1_Fare')).body.cells;
  for (const a of addrs) assert.equal(after2[a].i, ref[a], a);
});

test('受保護及其他隊伍：不能修改原始數據；另一隊的工作表不受影響', async () => {
  const [A] = team1;
  const [C1] = team2;
  const r = (await ops(A, 'L1_Fare', [{ a: 'B2', i: '0', base: 0 }, { a: 'Z99', i: '1', base: 0 }])).body;
  assert.equal(r.applied.length, 0);
  assert.deepEqual(r.rejected.map((x) => x.code), ['PROTECTED', 'PROTECTED']);
  const other = (await C1('GET', '/sheet/L1_Fare')).body;
  assert.equal(other.cells.D2.i, '=B2*C2*H1', '另一隊仍是起始內容');
  assert.notEqual(other.data.B2, undefined);
});

test('公式複製：相對參照位移、絕對參照不變（伺服器與瀏覽器使用同一引擎）', () => {
  const shift = (f, dr, dc) => '=' + toFormulaString(shiftAst(parseFormula(f), dr, dc));
  assert.equal(shift('=B2*C2*$H$1', 19, 0), '=B21*C21*$H$1');
  assert.equal(shift('=B2*C2*H$1', 3, 0), '=B5*C5*H$1');
  assert.equal(shift('=$B2*C$2', 2, 1), '=$B4*D$2');
  assert.equal(shift('=SUM($F$2:F2)', 5, 0), '=SUM($F$2:F7)');
  assert.equal(shift('=A1', -1, 0), '=#REF!');
  const comp = store.db.state.competitions[compId];
  const team = comp.teams[0];
  const pasted = sheets.pasteOps(comp, team, 'L1_Fare', 'main', 'D2', 'D3:D5');
  assert.deepEqual(pasted.map((o) => o.i), ['=B3*C3*$H$1', '=B4*C4*$H$1', '=B5*C5*$H$1']);
});

test('以內置工作表作答：正確公式核實、錯誤公式不得分，完成後該題鎖定', async () => {
  const [A] = team1;
  const r1 = (await A('POST', '/student/submit', { taskId: 'L1-T1', idempotencyKey: 'sheet-k-0001' })).body;
  assert.equal(r1.status, 'VERIFIED', JSON.stringify(r1.errors));
  const p = (await A('GET', '/sheet/L1_Fare')).body;
  assert.ok(!p.editable.includes('D2'), '已完成的題目鎖定');
  assert.equal(p.tasks.find((t) => t.id === 'L1-T1').state, 'completed');
  const locked = (await ops(A, 'L1_Fare', [{ a: 'D2', i: '=1', base: p.cells.D2.v }])).body;
  assert.equal(locked.rejected[0].code, 'LOCKED');
  // 錯誤：H3 寫死數值
  await ops(A, 'L1_Fare', [{ a: 'H3', i: '12345', base: p.cells.H3?.v ?? 0 }]);
  const r3 = (await A('POST', '/student/submit', { taskId: 'L1-T3', idempotencyKey: 'sheet-k-0002' })).body;
  assert.equal(r3.status, 'REJECTED');
  assert.ok(r3.errors.some((e) => /公式/.test(e.text)));
});

test('暫停期間不可修改；繼續後可以', async () => {
  const [A] = team1;
  await T('POST', `/teacher/competitions/${compId}/pause`, { reason: '測試' });
  const p = (await A('GET', '/sheet/L1_Fare')).body;
  assert.equal(p.editable.length, 0);
  assert.equal((await ops(A, 'L1_Fare', [{ a: 'H3', i: '=SUM(F2:F21)', base: p.cells.H3.v }])).body.rejected[0].code, 'PAUSED');
  await T('POST', `/teacher/competitions/${compId}/resume`);
  const p2 = (await A('GET', '/sheet/L1_Fare')).body;
  assert.equal((await ops(A, 'L1_Fare', [{ a: 'H3', i: '=SUM(F2:F21)', base: p2.cells.H3.v }])).body.applied[0].i, '=SUM(F2:F21)');
});

test('老師可以讀取任何一隊的工作表（唯讀），學生不可以', async () => {
  const p = (await T('GET', `/teacher/competitions/${compId}/sheet/t1/L1_Fare`)).body;
  assert.equal(p.readOnly, true);
  assert.equal(p.cells.H3.i, '=SUM(F2:F21)');
  const [C1] = team2;
  assert.equal((await C1('GET', `/teacher/competitions/${compId}/sheet/t1/L1_Fare`)).status, 403);
});

test('重新啟動後（重新載入資料）：作答及版本號保留；舊版作答會轉為逐格儲存', async () => {
  await store.flush();
  const file = path.join(process.env.DATA_DIR, 'state.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.cells[compId].t1.L1_Fare.H3.i, '=SUM(F2:F21)');
  const ver = saved.cells[compId].t1.L1_Fare.H3.v;
  // 模擬舊版資料：另一場比賽只有 demoSheets（整份工作表一個紀錄）
  const t = store.db.state.users[Object.keys(store.db.state.users).find((k) => store.db.state.users[k].role === 'teacher')];
  const old = C.createCompetition(t, { teamCount: 4, adapter: 'demo' });
  C.generate(old, t);
  await C.approve(old, t);
  delete store.db.state.cells[old.id];
  store.db.state.demoSheets[old.id] = { t1: { L1_Fare: { D2: '=B2*C2*$H$1', H3: '=SUM(F2:F21)' } } };
  old.cellsMigratedAt = undefined;
  await store.flush();
  store.load();
  const moved = sheets.migrateLegacySheets();
  assert.ok(moved >= 2);
  assert.equal(store.db.state.cells[compId].t1.L1_Fare.H3.v, ver, '版本號保留');
  assert.equal(store.db.state.cells[old.id].t1.L1_Fare.D2.i, '=B2*C2*$H$1', '舊版作答已轉移');
  assert.ok(store.db.state.demoSheets[old.id], '舊紀錄保留（不刪除）');
  assert.equal(sheets.migrateLegacySheets(), 0, '重複執行不會重複轉移');
});
