// 驗收測試 M：第一集全部五關以內置工作表作答（經 HTTP、逐格版本化修改）
// 每一題：參考答案 → 已核實；每一個常見錯誤 → 不得滿分並出現指定錯誤代碼；等價公式 → 已核實。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cookieJar } from './cookie-jar.js';
import { store, C } from './helpers.js';

const { startServer } = await import('../server/index.js');
const { correctInputs, equivalentInputs, wrongCases } = await import('../server/episode1/fixtures.js');
const { LEVELS } = await import('../server/episode1/blueprint.js');
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

let T; let id; const S = {};
let seq = 0;
const key = () => `m-key-${Date.now()}-${++seq}`;

async function write(Sx, sheet, inputs) {
  const p = (await Sx('GET', `/sheet/${sheet}`)).body;
  const editable = new Set(p.editable);
  // 先清空本關所有作答格（避免上一個測試案例留下的內容），再寫入
  const ops = [...editable].map((a) => ({ a, i: Object.prototype.hasOwnProperty.call(inputs, a) ? inputs[a] : null, base: p.cells[a]?.v ?? 0 }));
  const r = (await Sx('POST', `/sheet/${sheet}/ops`, { ops })).body;
  assert.equal(r.conflicts.length + r.rejected.length, 0, JSON.stringify(r.rejected.slice(0, 3)));
}

before(async () => {
  srv = startServer(0);
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}/api`;
  T = agent();
  await T('POST', '/auth/demo', { role: 'teacher', pin: '2468' });
  // 這個測試會重複提交同一題，所以關閉「全對後鎖定」
  id = (await T('POST', '/teacher/competitions', { teamCount: 4, classCode: '4E', bonusEnabled: true, lockOnComplete: false })).body.id;
  await T('POST', `/teacher/competitions/${id}/generate`, {});
  await T('POST', `/teacher/competitions/${id}/approve`);
  await T('POST', `/teacher/competitions/${id}/lobby`);
  const joinCode = (await T('GET', `/teacher/competitions/${id}`)).body.joinCode;
  for (const tid of ['t1', 't2']) {
    S[tid] = agent();
    await S[tid]('POST', '/auth/demo', { role: 'student', name: `E1 ${tid}` });
    await S[tid]('POST', '/student/join', { joinCode, teamId: tid });
  }
  await T('POST', `/teacher/competitions/${id}/start-episode`);
});
after(() => srv.stop());

for (const lv of LEVELS) {
  test(`第 ${lv.level} 關（${lv.title}）：內置工作表作答及批改`, { timeout: 120000 }, async () => {
    assert.equal((await T('POST', `/teacher/competitions/${id}/levels/${lv.level}/start`)).status, 200);
    const comp = store.db.state.competitions[id];
    for (const task of lv.tasks) {
      // 常見錯誤（各隊數據不同：用 t2 的數據）
      const ds2 = C.getDataset(comp, comp.teams[1]);
      for (const wc of wrongCases(task.id, ds2)) {
        await write(S.t2, lv.sheet, { ...correctOthers(lv, task), ...wc.inputs });
        const r = (await S.t2('POST', '/student/submit', { taskId: task.id, idempotencyKey: key() })).body;
        assert.ok(r.earned <= wc.maxEarned, `${task.id}「${wc.name}」得分 ${r.earned} 超過 ${wc.maxEarned}`);
        for (const code of wc.codes) assert.ok((r.errors || []).some((e) => e.code === code), `${task.id}「${wc.name}」應有 ${code}，實際：${(r.errors || []).map((e) => e.code).join(',')}`);
      }
      // 等價公式
      await write(S.t1, lv.sheet, { ...correctOthers(lv, task), ...equivalentInputs(task.id) });
      const eq = (await S.t1('POST', '/student/submit', { taskId: task.id, idempotencyKey: key() })).body;
      assert.equal(eq.status, 'VERIFIED', `${task.id} 等價公式：${JSON.stringify(eq.errors)}`);
      // 參考答案
      await write(S.t1, lv.sheet, { ...correctOthers(lv, task), ...correctInputs(task.id) });
      const ok = (await S.t1('POST', '/student/submit', { taskId: task.id, idempotencyKey: key() })).body;
      // 若等價公式與參考答案相同，第二次提交會是「重複提交」，沿用上次（已核實）的結果
      assert.ok(ok.status === 'VERIFIED' || (ok.status === 'DUPLICATE' && ok.earned === ok.max), `${task.id} 參考答案：${ok.status} ${JSON.stringify(ok.errors)}`);
    }
    const st = (await S.t1('GET', '/student/state')).body.levelDetails.find((l) => l.level === lv.level);
    assert.equal(st.teamCompleted, true, '本關完成');
    await T('POST', `/teacher/competitions/${id}/levels/${lv.level}/end`);
  });
}

/** 同一關其他題目的正確答案（某些題目依賴其他題目的結果） */
function correctOthers(lv, task) {
  return Object.assign({}, ...lv.tasks.filter((t) => t.id !== task.id).map((t) => correctInputs(t.id)));
}

test('五關完成後：分數正確（所有題目已核實），並可正常顯示結果', async () => {
  const v = (await T('GET', `/teacher/competitions/${id}`)).body;
  const t1 = v.scores.find((x) => x.teamId === 't1');
  assert.equal(t1.completedLevels, 5);
  for (const n of [1, 2, 3, 4, 5]) assert.equal(t1.levels[n].earnedPts, t1.levels[n].maxPts);
  assert.equal((await T('POST', `/teacher/competitions/${id}/results`)).status, 200);
});
