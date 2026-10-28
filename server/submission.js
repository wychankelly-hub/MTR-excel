// 提交與批改流程（§7.1、§7.3、§12）。
// READY → SUBMITTING → RECEIVED → VALIDATING → VERIFIED / REJECTED / RETRYABLE_ERROR
// - 顯式按鈕觸發；同一 Idempotency Key 只處理一次
// - 每隊提交序列化（避免較舊結果覆蓋新答案）
// - 讀取公式字串 + 計算後數值並保存 Snapshot
// - 同步／系統錯誤不扣分；原始資料被改動 → 完整性錯誤（不當作概念錯誤）
import crypto from 'node:crypto';
import { clock } from './clock.js';
import { HttpError } from './auth.js';
import { TASK_BY_ID, LEVEL_BY_NUM, requiredTasks } from './episode1/blueprint.js';
import { gradeTask, checkIntegrity, evaluateStudentLevel } from './episode1/validators.js';
import { expandRange } from './engine/refs.js';
import { isError } from './engine/values.js';
import { checksum } from './episode1/rng.js';
import {
  adapterFor, getDataset, levelTiming, audit, changed, triggerAudio, pause, teamOfUser, publicSfx, studentSfx,
} from './competition.js';
import { computeTeamScore } from './scoring.js';
import { bus } from './bus.js';

const teamLocks = new Map();
function withTeamLock(key, fn) {
  const prev = teamLocks.get(key) || Promise.resolve();
  const run = prev.then(fn, fn);
  teamLocks.set(key, run.catch(() => {}));
  return run;
}

function valuesMatch(google, engine) {
  if (isError(engine)) return typeof google === 'string' && google.startsWith('#');
  if (engine === null || engine === '') return google === null || google === '';
  if (typeof engine === 'number' && typeof google === 'number') return Math.abs(engine - google) <= 1e-6 * Math.max(1, Math.abs(engine));
  return engine === google;
}

export function submissionSummary(s) {
  return {
    id: s.id, taskId: s.taskId, level: s.level, status: s.status, at: s.at,
    earned: s.earned ?? null, max: s.max ?? null,
    markingPoints: s.markingPoints || null,
    errors: s.errors || null,
    message: s.message || null,
    duplicateOf: s.duplicateOf || null,
    needsReview: !!s.needsReview,
    noPenalty: !!s.noPenalty,
  };
}

export async function submitTask(comp, user, { taskId, idempotencyKey }) {
  const team = teamOfUser(comp, user.id);
  if (!team) throw new HttpError(403, '你未加入任何隊伍。', 'NO_TEAM');
  const task = TASK_BY_ID[taskId];
  if (!task) throw new HttpError(400, '沒有此題目。');
  const key = String(idempotencyKey || '').slice(0, 80);
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(key)) throw new HttpError(400, '缺少有效的提交識別碼（Idempotency Key）。');
  const idemKey = `${team.id}:${key}`;
  const prevId = comp.idempotency[idemKey];
  if (prevId) {
    const prev = comp.submissions.find((s) => s.id === prevId);
    if (prev) return { ...submissionSummary(prev), replayed: true };
  }
  if (comp.settings.captainOnlySubmit && team.captainId && team.captainId !== user.id) throw new HttpError(403, '老師設定了只有隊長（Captain）可以提交。', 'CAPTAIN_ONLY');
  if (task.bonus && !comp.settings.bonusEnabled) throw new HttpError(403, 'Bonus 加題未開放。');
  if (comp.cancelledTasks.some((c) => c.taskId === taskId)) throw new HttpError(409, '老師已取消此題，所有隊伍會獲同等處理。');

  return withTeamLock(`${comp.id}:${team.id}`, async () => {
    // 再檢查一次（等待鎖期間狀態可能改變）
    const again = comp.idempotency[idemKey];
    if (again) {
      const prev = comp.submissions.find((s) => s.id === again);
      if (prev) return { ...submissionSummary(prev), replayed: true };
    }
    const lvState = comp.levels[task.level];
    if (comp.paused) throw new HttpError(409, '比賽暫停中，暫時不能提交。', 'PAUSED');
    if (!lvState || lvState.phase !== 'active') throw new HttpError(409, lvState?.phase === 'ended' ? '此關已截止，提交已鎖定。已核實的分數會保留。' : '此關尚未開始。', 'LEVEL_NOT_ACTIVE');
    const timing = levelTiming(comp, task.level);
    if (timing.remainingMs <= 0) throw new HttpError(409, '時間到，此關提交已鎖定。', 'TIME_UP');

    comp.submissionSeq += 1;
    const sub = {
      id: `sub_${comp.submissionSeq}_${crypto.randomBytes(3).toString('hex')}`,
      seq: comp.submissionSeq,
      idempotencyKey: key,
      teamId: team.id,
      userId: user.id,
      taskId,
      level: task.level,
      at: clock.now(),
      elapsedMs: timing.elapsedMs,
      durationMs: timing.durationMs,
      status: 'SUBMITTING',
      provider: comp.adapter,
    };
    comp.idempotency[idemKey] = sub.id;
    comp.submissions.push(sub);

    // 1. 讀取工作表
    let snap;
    try {
      snap = await adapterFor(comp).readLevel(comp, team, task.level);
      sub.status = 'RECEIVED';
      comp.health.sheetsFailures = 0;
      if (comp.adapter === 'google') comp.health.sheets = 'Ready';
    } catch (e) {
      sub.status = 'RETRYABLE_ERROR';
      sub.noPenalty = true;
      sub.message = `同步失敗（不會扣分）：${e.message}`;
      comp.health.sheetsFailures = (comp.health.sheetsFailures || 0) + 1;
      comp.health.lastSheetsError = { at: clock.now(), teamId: team.id, message: e.message };
      comp.health.sheets = comp.health.sheetsFailures >= 3 ? 'Unavailable' : 'Degraded';
      // 連續失敗：自動暫停計時並提示老師（§12）
      if (comp.health.sheetsFailures >= 3 && !comp.paused) pause(comp, null, `${comp.adapter === 'google' ? 'Google Sheets' : '工作表'}連續讀取失敗，系統自動暫停計時，請檢查網絡後按「繼續」`);
      delete comp.idempotency[idemKey]; // 讓學生以新的嘗試重試
      audit(comp, null, 'SYNC_FAILED', { teamId: team.id, taskId, message: e.message });
      changed(comp, 'submission');
      return submissionSummary(sub);
    }

    const dataset = getDataset(comp, team);
    const lv = LEVEL_BY_NUM[task.level];
    const taskCells = task.cells.flatMap(expandRange);
    const editableCells = lv.editable.flatMap(expandRange);
    const inputs = Object.fromEntries(editableCells.map((a) => [a, snap.cells[a]?.input ?? null]));
    sub.snapshot = {
      provider: snap.provider,
      readAt: snap.readAt,
      inputs,
      values: Object.fromEntries(editableCells.map((a) => [a, snap.cells[a]?.value ?? null])),
      dataChecksum: dataset.checksums[task.level],
    };
    sub.snapshotHash = checksum({ task: taskId, inputs: Object.fromEntries(taskCells.map((a) => [a, inputs[a]])) });

    // 2. 完整性
    sub.status = 'VALIDATING';
    const changedCells = snap.sheetMissing ? ['（整張工作表）'] : checkIntegrity(task.level, snap.cells, dataset);
    if (changedCells.length) {
      sub.status = 'INTEGRITY_ERROR';
      sub.noPenalty = true;
      sub.message = `資料已被修改，請通知老師（${changedCells.slice(0, 5).join('、')}${changedCells.length > 5 ? ' 等' : ''}）。此情況不會當作公式錯誤扣分。`;
      sub.integrityCells = changedCells.slice(0, 50);
      audit(comp, null, 'INTEGRITY_ERROR', { teamId: team.id, taskId, cells: sub.integrityCells });
      changed(comp, 'submission');
      return submissionSummary(sub);
    }

    // 3. 同一 Snapshot 重複提交：不重新計分
    const prevSame = [...comp.submissions].reverse().find((s) => s !== sub && s.teamId === team.id && s.taskId === taskId && ['VERIFIED', 'REJECTED'].includes(s.status));
    if (prevSame && prevSame.snapshotHash === sub.snapshotHash) {
      sub.status = 'DUPLICATE';
      sub.duplicateOf = prevSame.id;
      sub.earned = prevSame.earned;
      sub.max = prevSame.max;
      sub.markingPoints = prevSame.markingPoints;
      sub.errors = prevSame.errors;
      sub.message = '工作表內容與上一次提交相同，沿用上次結果，不會重複計分或扣分。';
      changed(comp, 'submission');
      return submissionSummary(sub);
    }

    // 4. 批改（伺服器端 AST + 重算 + 隱藏測試）
    const result = gradeTask(taskId, inputs, dataset);
    Object.assign(sub, {
      status: result.status,
      earned: result.earned,
      max: result.max,
      markingPoints: result.markingPoints,
      errors: result.errors,
      validatorVersion: result.validatorVersion,
      needsReview: result.needsReview,
      noPenalty: result.needsReview,
    });

    // 5. Google Sheets 計算結果與伺服器引擎交叉核對（不一致 → 老師覆核，不扣分）
    if (comp.adapter === 'google') {
      const engineVals = evaluateStudentLevel(task.level, inputs, dataset);
      const mismatch = taskCells.filter((a) => !valuesMatch(snap.cells[a]?.value ?? null, engineVals[a]));
      if (mismatch.length) {
        sub.engineMismatch = mismatch.slice(0, 20);
        sub.needsReview = true;
        sub.noPenalty = true;
      }
    }
    if (sub.needsReview) sub.message = '部分結果需要老師覆核，此提交不會扣分。';
    // 全部作答格仍是空白（例如誤按）：顯示提示但不當作錯誤提交扣分
    if (taskCells.every((a) => inputs[a] === null || inputs[a] === '')) {
      sub.noPenalty = true;
      sub.message = '作答範圍仍是空白，這次提交不扣分。';
    }

    // 6. 過關事件
    const score = computeTeamScore(comp, team.id);
    const ls = score.levels[task.level];
    const reqIds = requiredTasks(task.level, comp.cancelledTasks.map((c) => c.taskId)).map((t) => t.id);
    if (ls.completed && reqIds.includes(taskId) && !comp.levels[task.level].firstClear) {
      comp.levels[task.level].firstClear = { teamId: team.id, at: sub.at };
      try { triggerAudio(comp, `L${task.level}_FIRST_CLEAR`, { auto: true }); } catch { /* 不影響提交 */ }
    }
    // 投影端的公開音效／動畫（只有隊名，沒有答案）
    if (sub.status === 'VERIFIED') {
      publicSfx(comp, ls.completed && ls.completedAt === sub.at ? 'level_clear' : 'task_clear', team, task.level);
    }
    // 只送到提交隊伍的學生裝置：答對／答錯／完成一關／Bonus
    if (sub.status === 'VERIFIED') {
      const kind = task.bonus ? 'bonus' : ls.completed && ls.completedAt === sub.at ? 'mission' : 'correct';
      studentSfx(comp, team.id, kind, sub.id);
    } else if (!sub.noPenalty || sub.status === 'REJECTED') {
      studentSfx(comp, team.id, 'wrong', sub.id);
    }
    audit(comp, user, 'SUBMIT', { teamId: team.id, taskId, status: sub.status, earned: sub.earned, id: sub.id });
    changed(comp, 'submission');
    return submissionSummary(sub);
  });
}
