#!/usr/bin/env node
// 壓力測試及「45 分鐘課堂」加速模擬（Demo Mode，使用伺服器同一套批改及計分流程）。
// 模擬：6 隊 × 3–4 人、各隊不同能力（先犯常見錯誤再修正）、同時提交、重複點擊、
// 網絡失敗重試、老師暫停／延長、時間到自動截止、L5 揭曉、結果匯出。
// 用法：node scripts/demo-bots.js [--report docs/TEST_RESULTS-sim.json]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'taiyau-sim-'));
const C = await import('../server/competition.js');
const auth = await import('../server/auth.js');
const { submitTask } = await import('../server/submission.js');
const { clock } = await import('../server/clock.js');
const { rankTeams } = await import('../server/scoring.js');
const { resultsCsv } = await import('../server/views.js');
const { LEVELS } = await import('../server/episode1/blueprint.js');
const { correctInputs, wrongCases } = await import('../server/episode1/fixtures.js');
const { bus } = await import('../server/bus.js');

const log = [];
const say = (m) => { log.push(m); console.log(m); };
const audio = [];
bus.on('audio', (_, p) => { if (p.type === 'play') audio.push(p.eventId); });

const teacher = auth.loginDemo({ role: 'teacher', pin: process.env.DEMO_TEACHER_PIN || '2468' });
const comp = C.createCompetition(teacher, { teamCount: 6, classCode: 'SIM4A' });
let t0 = Date.now();
C.generate(comp, teacher);
say(`生成及 Preflight：${Date.now() - t0} ms，pass=${comp.generation.pass}`);
await C.approve(comp, teacher);
C.openLobby(comp, teacher);
const layout = [4, 4, 3, 3, 3, 3];
const members = {};
let k = 0;
for (const [i, team] of comp.teams.entries()) {
  members[team.id] = [];
  for (let j = 0; j < layout[i]; j++) {
    const s = auth.loginDemo({ role: 'student', name: `Sim ${String(++k).padStart(2, '0')}` });
    await C.joinTeam(s, comp.joinCode, team.id);
    members[team.id].push(s);
  }
}
say(`學生加入：${k} 人，6 隊`);
C.startEpisode(comp, teacher);

// 能力設定：skill 越高越少犯錯、越快完成
const skill = { t1: 0.9, t2: 0.75, t3: 0.6, t4: 0.5, t5: 0.35, t6: 0.2 };
let rnd = 7;
const rand = () => { rnd = (rnd * 1103515245 + 12345) % 2147483648; return rnd / 2147483648; };
const sheetOf = (lvl) => LEVELS.find((l) => l.level === lvl).sheet;
const stats = { autoPauses: 0, submits: 0, verified: 0, rejected: 0, duplicate: 0, retryable: 0, replayed: 0, maxLatencyMs: 0, totalLatencyMs: 0 };

async function doSubmit(user, taskId, key) {
  const s = Date.now();
  try {
    const r = await submitTask(comp, user, { taskId, idempotencyKey: key });
    const ms = Date.now() - s;
    stats.submits++; stats.totalLatencyMs += ms; stats.maxLatencyMs = Math.max(stats.maxLatencyMs, ms);
    if (r.replayed) stats.replayed++;
    else if (r.status === 'VERIFIED') stats.verified++;
    else if (r.status === 'REJECTED') stats.rejected++;
    else if (r.status === 'DUPLICATE') stats.duplicate++;
    else if (r.status === 'RETRYABLE_ERROR') stats.retryable++;
    return r;
  } catch (e) {
    return { status: 'BLOCKED', message: e.message };
  }
}

// 模擬間歇性網絡失敗（5%），不應扣分
const realRead = C.adapters.demo.readLevel.bind(C.adapters.demo);
C.adapters.demo.readLevel = async (...a) => { if (rand() < 0.05) throw new Error('模擬 Wi-Fi 中斷'); return realRead(...a); };

for (const lv of LEVELS) {
  C.startLevel(comp, teacher, lv.level);
  const minutes = comp.settings.levelSeconds[lv.level] / 60;
  if (lv.level === 3) { C.pause(comp, teacher, '模擬：老師講解'); clock.advance(90_000); C.resume(comp, teacher); }
  // 每個「回合」約 30 秒；各隊同時行動
  for (let round = 0; round < minutes * 2 && comp.levels[lv.level].phase === 'active'; round++) {
    if (comp.paused) { stats.autoPauses++; say(`  ⏸ 系統自動暫停（${comp.pauseReason}）→ 老師檢查網絡後繼續`); C.resume(comp, teacher); }
    clock.advance(30_000);
    await Promise.all(comp.teams.map(async (team) => {
      const users = members[team.id];
      const driver = users[(lv.level - 1) % users.length];
      if (rand() > skill[team.id] + 0.25) return; // 這一回合仍在思考
      const ds = C.getDataset(comp, team);
      for (const task of lv.tasks.filter((t) => !t.bonus)) {
        const done = comp.submissions.some((s) => s.teamId === team.id && s.taskId === task.id && s.status === 'VERIFIED');
        if (done) continue;
        const wrongs = wrongCases(task.id, ds);
        const tried = comp.submissions.filter((s) => s.teamId === team.id && s.taskId === task.id && s.status === 'REJECTED').length;
        const makeMistake = wrongs.length && rand() > skill[team.id] && tried < 2;
        const inputs = makeMistake ? wrongs[Math.floor(rand() * wrongs.length)].inputs : correctInputs(task.id);
        C.adapters.demo.applyEdits(comp, team, sheetOf(lv.level), Object.entries(inputs).map(([addr, input]) => ({ addr, input })));
        if (rand() < 0.15 && makeMistake) { try { C.requestHint(comp, driver, team, lv.level); } catch { /* 已用完 */ } }
        const key = `sim-${team.id}-${task.id}-${round}-${Math.floor(rand() * 1e9)}`;
        // 重複點擊：同一 key 三次並發 + 另一位隊員同時按
        const other = users[(lv.level) % users.length];
        await Promise.all([doSubmit(driver, task.id, key), doSubmit(driver, task.id, key), doSubmit(driver, task.id, key), doSubmit(other, task.id, `${key}-b`)]);
        break; // 每回合每隊處理一題
      }
    }));
  }
  if (lv.level === 2) C.extendLevel(comp, teacher, 2, 60);
  // 時間到自動截止
  if (comp.paused) C.resume(comp, teacher);
  clock.advance(comp.levels[lv.level].durationMs);
  C.tick();
  say(`L${lv.level} 結束：${comp.levels[lv.level].phase}（${comp.levels[lv.level].endReason}），首隊：${comp.levels[lv.level].firstClear ? comp.teams.find((x) => x.id === comp.levels[lv.level].firstClear.teamId).name : '—'}`);
}
C.adapters.demo.readLevel = realRead;
C.showResults(comp, teacher);

// 驗證不變量
const problems = [];
const verifiedPerTask = {};
for (const s of comp.submissions.filter((x) => x.status === 'VERIFIED')) {
  const kk = `${s.teamId}:${s.taskId}`;
  verifiedPerTask[kk] = (verifiedPerTask[kk] || 0) + 1;
}
for (const [kk, n] of Object.entries(verifiedPerTask)) if (n > 1) problems.push(`${kk} 有 ${n} 次 VERIFIED（同一 snapshot 不應重複批改）`);
const keys = new Set();
// 同一 Idempotency Key 最多只有一筆成功處理的紀錄（同步失敗後以同一 key 重試是容許的）
for (const s of comp.submissions.filter((x) => x.status !== 'RETRYABLE_ERROR')) { const kk = `${s.teamId}:${s.idempotencyKey}`; if (keys.has(kk)) problems.push(`重複處理 ${kk}`); keys.add(kk); }
if (comp.submissions.some((s) => s.status === 'RETRYABLE_ERROR' && !s.noPenalty)) problems.push('同步失敗被扣分');
if (!audio.includes('E1_FINAL_REVEAL') || audio.indexOf('E1_FINAL_REVEAL') < audio.indexOf('L5_OPEN')) problems.push('最終揭曉時序不正確');
for (const t of rankTeams(comp)) for (const l of Object.values(t.levels)) if (l.total < 0 || l.base > 500) problems.push(`${t.teamId} L${l.level} 分數越界`);

say('\n最終排名：');
for (const s of rankTeams(comp)) say(`  ${s.rank}. ${comp.teams.find((t) => t.id === s.teamId).name}  ${s.total} 分（基礎 ${s.baseTotal}，完成 ${s.completedLevels} 關，提示 ${s.hintsUsed}）`);
say(`\n提交統計：${JSON.stringify({ ...stats, avgLatencyMs: Math.round(stats.totalLatencyMs / Math.max(1, stats.submits)) })}`);
say(`音訊事件順序：${audio.join(' → ')}`);
say(`CSV 行數：${resultsCsv(comp).length}`);
say(problems.length ? `\n✗ 發現問題：\n${problems.join('\n')}` : '\n✓ 不變量全部成立：沒有重複計分、同步失敗不扣分、揭曉時序正確、分數在範圍內。');

const out = process.argv.includes('--report') ? process.argv[process.argv.indexOf('--report') + 1] : null;
if (out) fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), stats, problems, log, audio }, null, 2));
process.exit(problems.length ? 1 : 0);
