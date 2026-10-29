// 計分（§8）。分數完全由伺服器核實的提交紀錄、提示紀錄及人工調整「推導」出來：
// 相同紀錄必得相同分數，重送同一提交不會重複加分（冪等）。
import { LEVELS, LEVEL_BY_NUM, requiredTasks, levelMaxPoints } from './episode1/blueprint.js';

export const RULES = {
  baseMax: 500,
  firstTry: 20,
  speedMax: 30,
  hint1: 10,
  hint2: 20,
  wrongEach: 5,
  wrongCap: 20,
  combo: 20,
  bonusMission: 50,
};

const GRADED = new Set(['VERIFIED', 'REJECTED']);

export function computeTeamScore(comp, teamId) {
  const cancelled = (comp.cancelledTasks || []).map((c) => c.taskId);
  // 練習提交不計分；補做提交只影響基礎分（不計速度獎勵、錯誤不扣分）
  const subs = comp.submissions.filter((s) => s.teamId === teamId && GRADED.has(s.status) && !s.practice && !cancelled.includes(s.taskId))
    .sort((a, b) => a.at - b.at || a.seq - b.seq);
  const levels = {};
  let lastImproveAt = null;
  let hintsTotal = 0;
  const completedSet = new Set();
  for (const lv of LEVELS) {
    const n = lv.level;
    const req = requiredTasks(n, cancelled);
    const maxPts = levelMaxPoints(n, cancelled);
    const best = {};
    const first = {};
    let completedAt = null;
    let completedSub = null;
    for (const s of subs.filter((x) => x.level === n)) {
      if (!(s.taskId in first)) first[s.taskId] = s;
      if ((best[s.taskId] ?? -1) < s.earned) {
        best[s.taskId] = s.earned;
        if (s.earned > 0) lastImproveAt = Math.max(lastImproveAt ?? 0, s.at);
      }
      if (!completedAt && req.length && req.every((t) => (best[t.id] ?? 0) === t.points)) {
        completedAt = s.at;
        completedSub = s;
      }
    }
    const earnedPts = req.reduce((sum, t) => sum + (best[t.id] ?? 0), 0);
    const base = maxPts ? Math.round((RULES.baseMax * earnedPts) / maxPts) : 0;
    const completed = !!completedAt;
    const firstTry = completed && req.every((t) => first[t.id] && first[t.id].earned === t.points) ? RULES.firstTry : 0;
    let speed = 0;
    if (completed && completedSub.durationMs > 0) {
      const remain = Math.max(0, completedSub.durationMs - completedSub.elapsedMs);
      speed = Math.round((RULES.speedMax * remain) / completedSub.durationMs);
    }
    const hints = (comp.hintUses || []).filter((h) => h.teamId === teamId && h.level === n).length;
    hintsTotal += hints;
    const hintPenalty = (hints >= 1 ? RULES.hint1 : 0) + (hints >= 2 ? RULES.hint2 : 0);
    const wrongCount = subs.filter((s) => s.level === n && s.status === 'REJECTED' && !s.noPenalty && !LEVEL_BY_NUM[n].tasks.find((t) => t.id === s.taskId)?.bonus).length;
    const wrongPenalty = Math.min(RULES.wrongCap, wrongCount * RULES.wrongEach);
    const bonusTask = lv.tasks.find((t) => t.bonus);
    const bonus = comp.settings.bonusEnabled && bonusTask && !cancelled.includes(bonusTask.id) && (best[bonusTask.id] ?? 0) === bonusTask.points ? RULES.bonusMission : 0;
    const raw = base + firstTry + speed + bonus - hintPenalty - wrongPenalty;
    const total = Math.max(0, raw);
    if (completed) completedSet.add(n);
    levels[n] = {
      level: n, earnedPts, maxPts, base, firstTry, speed, bonus, hints, hintPenalty, wrongCount, wrongPenalty,
      total, completed, completedAt, best,
      tasksDone: req.filter((t) => (best[t.id] ?? 0) === t.points).length, tasksTotal: req.length,
    };
  }
  const combo = [1, 2, 3].some((n) => completedSet.has(n) && completedSet.has(n + 1) && completedSet.has(n + 2)) ? RULES.combo : 0;
  const manual = (comp.adjustments || []).filter((a) => a.teamId === teamId).reduce((s, a) => s + a.delta, 0);
  const levelSum = Object.values(levels).reduce((s, l) => s + l.total, 0);
  const baseTotal = Object.values(levels).reduce((s, l) => s + l.base, 0);
  return {
    teamId,
    levels,
    combo,
    manual,
    baseTotal,
    total: levelSum + combo + manual,
    completedLevels: completedSet.size,
    hintsUsed: hintsTotal,
    lastCorrectAt: lastImproveAt,
  };
}

/** 排名：總分 → 完成關卡數 → 少用 Hint → 有效正確提交較早 */
export function rankTeams(comp) {
  const scores = comp.teams.map((t) => ({ ...computeTeamScore(comp, t.id), index: t.index }));
  scores.sort((a, b) =>
    b.total - a.total ||
    b.completedLevels - a.completedLevels ||
    a.hintsUsed - b.hintsUsed ||
    (a.lastCorrectAt ?? Infinity) - (b.lastCorrectAt ?? Infinity) ||
    a.index - b.index);
  let rank = 0;
  scores.forEach((s, i) => {
    const prev = scores[i - 1];
    const tied = prev && prev.total === s.total && prev.completedLevels === s.completedLevels && prev.hintsUsed === s.hintsUsed && prev.lastCorrectAt === s.lastCorrectAt;
    rank = tied ? rank : i + 1;
    s.rank = rank;
  });
  return scores;
}

export function breakdownLines(levelScore) {
  const l = levelScore;
  const out = [{ label: `基礎分（${l.earnedPts}/${l.maxPts} 評分點）`, delta: l.base }];
  if (l.firstTry) out.push({ label: '所有必答題首次提交即正確', delta: l.firstTry });
  if (l.speed) out.push({ label: '速度獎勵', delta: l.speed });
  if (l.bonus) out.push({ label: 'Bonus 加題', delta: l.bonus });
  if (l.hintPenalty) out.push({ label: `使用提示 ×${l.hints}`, delta: -l.hintPenalty });
  if (l.wrongPenalty) out.push({ label: `錯誤提交 ×${l.wrongCount}（上限 −${RULES.wrongCap}）`, delta: -l.wrongPenalty });
  return out;
}
