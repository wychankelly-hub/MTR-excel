// 驗收測試 D（29–35）：比賽流程與計分
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { C, clock, readyCompetition, typeInto, submit, key } from './helpers.js';
import { computeTeamScore, rankTeams } from '../server/scoring.js';
import { correctInputs } from '../server/episode1/fixtures.js';
import { LEVELS } from '../server/episode1/blueprint.js';

async function solveLevel(comp, team, user, level) {
  const lv = LEVELS.find((l) => l.level === level);
  for (const t of lv.tasks.filter((x) => !x.bonus)) {
    typeInto(comp, team, level, correctInputs(t.id));
    const r = await submit(comp, user, t.id);
    assert.equal(r.status, 'VERIFIED', `${t.id}: ${JSON.stringify(r.errors)}`);
  }
}

test('29. 三次重複提交同一 Snapshot 只結算一次分數', async () => {
  const { t, comp, students } = await readyCompetition();
  C.startLevel(comp, t, 1);
  const team = comp.teams[0];
  const u = students[team.id][0];
  typeInto(comp, team, 1, { D2: '=B2*C2*H1' }); // 錯誤
  const k = key();
  const a = await submit(comp, u, 'L1-T1', k);
  const b = await submit(comp, u, 'L1-T1', k); // 同一 Idempotency Key（例如網絡重試）
  const c = await submit(comp, u, 'L1-T1'); // 新的按鈕點擊，但工作表沒有改變
  assert.equal(a.status, 'REJECTED');
  assert.equal(b.replayed, true);
  assert.equal(c.status, 'DUPLICATE');
  const s = computeTeamScore(comp, team.id).levels[1];
  assert.equal(s.wrongCount, 1, '只扣一次錯誤提交');
  // 並發重複點擊
  typeInto(comp, team, 1, correctInputs('L1-T1'));
  const kk = key();
  const res = await Promise.all([submit(comp, u, 'L1-T1', kk), submit(comp, u, 'L1-T1', kk), submit(comp, u, 'L1-T1', kk)]);
  assert.ok(res.every((r) => r.status === 'VERIFIED'));
  assert.equal(comp.submissions.filter((x) => x.teamId === team.id && x.status === 'VERIFIED').length, 1);
});

test('30. 系統／同步失敗不扣錯答分', async () => {
  const { t, comp, students } = await readyCompetition();
  C.startLevel(comp, t, 1);
  const team = comp.teams[1];
  const u = students[team.id][0];
  const orig = C.adapters.demo.readLevel;
  C.adapters.demo.readLevel = async () => { throw new Error('模擬網絡中斷'); };
  try {
    const r = await submit(comp, u, 'L1-T1');
    assert.equal(r.status, 'RETRYABLE_ERROR');
    assert.equal(r.noPenalty, true);
  } finally {
    C.adapters.demo.readLevel = orig;
  }
  const s = computeTeamScore(comp, team.id);
  assert.equal(s.total, 0);
  assert.equal(s.levels[1].wrongCount, 0);
  // 連續三次失敗會自動暫停並提示老師
  C.adapters.demo.readLevel = async () => { throw new Error('down'); };
  try { for (let i = 0; i < 2; i++) await submit(comp, u, 'L1-T1'); } finally { C.adapters.demo.readLevel = orig; }
  assert.equal(comp.paused, true);
  assert.equal(comp.health.sheets, 'Unavailable');
});

test('31. 暫停期間不扣計時，恢復後時間準確', async () => {
  const { t, comp } = await readyCompetition({ levelSeconds: { 1: 360 } });
  C.startLevel(comp, t, 1);
  clock.advance(60_000);
  assert.equal(Math.round(C.levelTiming(comp, 1).remainingMs / 1000), 300);
  C.pause(comp, t);
  clock.advance(120_000);
  assert.equal(Math.round(C.levelTiming(comp, 1).remainingMs / 1000), 300, '暫停期間不消耗時間');
  C.tick();
  assert.equal(comp.levels[1].phase, 'active');
  C.resume(comp, t);
  clock.advance(30_000);
  assert.equal(Math.round(C.levelTiming(comp, 1).remainingMs / 1000), 270);
  C.extendLevel(comp, t, 1, 60);
  assert.equal(Math.round(C.levelTiming(comp, 1).remainingMs / 1000), 330);
  clock.advance(330_001);
  C.tick();
  assert.equal(comp.levels[1].phase, 'ended', '時間到自動截止');
  assert.equal(comp.levels[1].endReason, 'timeout');
});

test('32. 各關評分點數目不同，但最高基礎分同為 500', async () => {
  const { t, comp, students } = await readyCompetition();
  const team = comp.teams[0];
  const u = students[team.id][0];
  for (const n of [1, 2, 3, 4, 5]) {
    C.startLevel(comp, t, n);
    await solveLevel(comp, team, u, n);
    C.endLevel(comp, t, n);
  }
  const s = computeTeamScore(comp, team.id);
  for (const n of [1, 2, 3, 4, 5]) assert.equal(s.levels[n].base, 500);
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => s.levels[n].maxPts), [6, 5, 4, 7, 7]);
  assert.equal(s.baseTotal, 2500);
});

test('33. Bonus、Hint、Speed、Combo、錯誤扣分符合規則，重送不會重複加分', async () => {
  const { t, comp, students } = await readyCompetition({ bonusEnabled: true });
  const team = comp.teams[2];
  const u = students[team.id][0];
  C.startLevel(comp, t, 1);
  C.requestHint(comp, u, team, 1);
  C.requestHint(comp, u, team, 1);
  assert.throws(() => C.requestHint(comp, u, team, 1));
  typeInto(comp, team, 1, { D2: '=B2+C2' });
  await submit(comp, u, 'L1-T1'); // 錯 1
  typeInto(comp, team, 1, { D2: '=B2*C2' });
  await submit(comp, u, 'L1-T1'); // 錯 2
  await solveLevel(comp, team, u, 1);
  typeInto(comp, team, 1, correctInputs('L1-B1'));
  assert.equal((await submit(comp, u, 'L1-B1')).status, 'VERIFIED');
  await submit(comp, u, 'L1-B1'); // 重送
  const l1 = computeTeamScore(comp, team.id).levels[1];
  assert.equal(l1.base, 500);
  assert.equal(l1.hintPenalty, 30);
  assert.equal(l1.wrongPenalty, 10);
  assert.equal(l1.firstTry, 0, 'T1 首次提交錯誤 → 沒有首次全對獎勵');
  assert.equal(l1.bonus, 50);
  assert.ok(l1.speed > 25 && l1.speed <= 30, `speed=${l1.speed}`);
  assert.equal(l1.total, 500 + l1.speed + 50 - 30 - 10);
  // 錯誤扣分上限 −20
  for (let i = 0; i < 6; i++) { typeInto(comp, team, 1, { H3: `=${i}` }); await submit(comp, u, 'L1-T3'); }
  assert.equal(computeTeamScore(comp, team.id).levels[1].wrongPenalty, 20);
  C.endLevel(comp, t, 1);
  // L2、L3 首次全對 → firstTry +20；連續三關完成 → Combo +20（只一次）
  for (const n of [2, 3]) { C.startLevel(comp, t, n); await solveLevel(comp, team, u, n); C.endLevel(comp, t, n); }
  const s = computeTeamScore(comp, team.id);
  assert.equal(s.levels[2].firstTry, 20);
  assert.equal(s.combo, 20);
  const before = s.total;
  C.startLevel(comp, t, 4);
  for (let i = 0; i < 3; i++) await submit(comp, u, 'L3-T1').catch(() => {}); // 已截止的關卡不可再提交
  assert.equal(computeTeamScore(comp, team.id).total, before);
  // 單關最低為 0
  const other = comp.teams[3];
  const o = students[other.id][0];
  C.requestHint(comp, o, other, 4); C.requestHint(comp, o, other, 4);
  for (let i = 0; i < 5; i++) { typeInto(comp, other, 4, { I2: `=COUNT(B2:B${400 + i})` }); await submit(comp, o, 'L4-T1'); }
  assert.equal(computeTeamScore(comp, other.id).levels[4].total, 0);
});

test('34. 同分時依 Tie-breaker 排列（總分 → 完成關數 → 少用提示 → 較早正確提交）', () => {
  const mk = (id, idx) => ({ id, index: idx, name: id, color: '#000', code: id, memberIds: [], roles: {} });
  const comp = {
    teams: [mk('a', 0), mk('b', 1), mk('c', 2)],
    settings: { bonusEnabled: false }, cancelledTasks: [], adjustments: [], hintUses: [],
    submissions: [],
  };
  const sub = (teamId, taskId, earned, at) => ({ teamId, taskId, level: Number(taskId[1]), earned, status: 'VERIFIED', at, seq: at, elapsedMs: 300000, durationMs: 360000 });
  // a、b、c 都完成 L1-T3（2 分）→ 同樣基礎分
  comp.submissions.push(sub('a', 'L1-T3', 2, 3000), sub('b', 'L1-T3', 2, 1000), sub('c', 'L1-T3', 2, 2000));
  let r = rankTeams(comp).map((x) => x.teamId);
  assert.deepEqual(r, ['b', 'c', 'a'], '同分同提示 → 較早取得正確提交者排先');
  comp.hintUses.push({ teamId: 'b', level: 1, tier: 1 });
  comp.adjustments.push({ teamId: 'b', delta: 10 }); // 抵銷提示扣分，總分仍相同
  r = rankTeams(comp);
  assert.equal(r[0].total, r[1].total);
  assert.deepEqual(r.map((x) => x.teamId), ['c', 'a', 'b'], '同分 → 少用提示者排先');
});

test('35. 老師手動改分可追蹤原值、原因、操作者和時間', async () => {
  const { t, comp } = await readyCompetition();
  const team = comp.teams[0];
  assert.throws(() => C.adjustScore(comp, t, team.id, 30, ''), /原因/);
  const adj = C.adjustScore(comp, t, team.id, 30, '題目投影錯誤補分');
  assert.equal(adj.before, 0);
  assert.equal(adj.after, 30);
  assert.equal(adj.reason, '題目投影錯誤補分');
  assert.ok(adj.by.name && adj.at);
  const log = comp.audit.find((a) => a.action === 'MANUAL_ADJUST');
  assert.equal(log.detail.after, 30);
  // 取消題目：所有隊伍同步等值處理
  C.cancelTask(comp, t, 'L1-T3', '題目 Bug');
  assert.equal(computeTeamScore(comp, comp.teams[1].id).levels[1].maxPts, 4);
  assert.equal(computeTeamScore(comp, comp.teams[2].id).levels[1].maxPts, 4);
});

test('未教授技能的關卡預設不能開始；跳關必須註明理由', async () => {
  const { t, comp } = await readyCompetition();
  C.updateSettings(comp, t, { taughtSkills: ['SUM', 'ABS_REF', 'AVERAGE', 'COUNT', 'MAX', 'IF', 'AND', 'OR', 'COUNTIF', 'SUMIF', 'AMP', 'LEFT'] });
  for (const n of [1, 2, 3, 4]) { C.startLevel(comp, t, n); C.endLevel(comp, t, n); }
  assert.throws(() => C.startLevel(comp, t, 5), (e) => e.code === 'UNTAUGHT_SKILLS');
  assert.throws(() => C.skipLevel(comp, t, 5, ''), /理由/);
  C.skipLevel(comp, t, 5, '未教 MID/RIGHT，延後');
  assert.equal(comp.levels[5].phase, 'skipped');
});

test('回合同步：未開始的關卡內容不會提前給學生；截止後提交鎖定', async () => {
  const { t, comp, students } = await readyCompetition();
  const { studentView } = await import('../server/views.js');
  const team = comp.teams[0];
  const u = students[team.id][0];
  C.startLevel(comp, t, 1);
  let v = studentView(comp, u);
  assert.deepEqual(v.levelDetails.map((l) => l.level), [1]);
  C.endLevel(comp, t, 1);
  await assert.rejects(() => submit(comp, u, 'L1-T1'), /截止/);
  v = studentView(comp, u);
  assert.ok(v.levelDetails[0].review, '回合結束後才提供回顧（可得分公式）');
});
