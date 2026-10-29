// 依角色過濾的資料視圖（Permission matrix §11）。
// Projector/公開：沒有電郵、學生姓名、答案或未公布劇情。
// Student：只看到自己隊伍；任務內容只在該關開始後才提供；標準答案只在該關結束後的回顧顯示。
// Teacher：全部。
import { db } from './store.js';
import { clock } from './clock.js';
import { LEVELS, LEVEL_BY_NUM, publicLevel, ROLE_LABELS, SKILLS, TASKS } from './episode1/blueprint.js';
import { STORY_CLUES, AUDIO_EVENTS, AUDIO_EVENT_BY_ID } from './episode1/dialogue.js';
import { CONCEPTS, REVIEW_CARDS, ERRORS } from './episode1/feedback.js';
import { rankTeams, computeTeamScore, breakdownLines, RULES } from './scoring.js';
import { levelTiming, publicRankRow, untaughtFor, audioAllowed, audioOutput } from './competition.js';
import { submissionSummary } from './submission.js';
import { googleCredentialStatus } from './adapters/google-adapter.js';
import { features } from './config.js';
import { expandRange } from './engine/refs.js';

function levelPublic(comp, lv) {
  const l = comp.levels[lv.level];
  const t = levelTiming(comp, lv.level);
  const fc = l.firstClear ? comp.teams.find((x) => x.id === l.firstClear.teamId) : null;
  return {
    level: lv.level,
    title: lv.title,
    phase: l.phase,
    durationMs: t.durationMs,
    remainingMs: l.phase === 'active' ? t.remainingMs : l.phase === 'pending' ? (comp.settings.levelSeconds[lv.level] * 1000) : 0,
    running: l.phase === 'active' && !comp.paused,
    firstClear: fc ? { name: fc.name, color: fc.color } : null,
    clue: ['ended', 'skipped'].includes(l.phase) && l.startedAt ? STORY_CLUES[lv.level] : null,
    successEffect: ['ended'].includes(l.phase) ? lv.successEffect : null,
  };
}

export function publicView(comp) {
  const lb = comp.leaderboard;
  let leaderboard = null;
  if (!lb.hidden) leaderboard = lb.frozen ? lb.snapshot : rankTeams(comp).map(publicRankRow(comp));
  return {
    id: comp.id,
    title: comp.title,
    classCode: comp.classCode,
    demo: comp.adapter === 'demo',
    adapter: comp.adapter,
    status: comp.status,
    paused: comp.paused,
    pauseReason: comp.paused ? comp.pauseReason : null,
    serverNow: clock.now(),
    currentLevel: comp.currentLevel,
    episodeStarted: !!comp.episodeStartedAt,
    levels: LEVELS.map((lv) => levelPublic(comp, lv)),
    teams: comp.teams.map((t) => ({ id: t.id, name: t.name, code: t.code, color: t.color, memberCount: t.memberIds.length })),
    leaderboard,
    leaderboardState: { hidden: lb.hidden, frozen: lb.frozen },
    reveal: comp.levels[5].phase === 'ended' ? { word: 'LUNCH', teaser: '第二集預告：疑犯火箭仔' } : null,
    audioSeq: comp.audio.seq,
    audio: { designated: audioOutput(comp), bgm: !!comp.audio.bgm },
  };
}

function nameOf(id) {
  const u = db.state.users[id];
  if (!u) return '—';
  return u.guestTag ? `${u.name}（訪客 #${u.guestTag}）` : u.name;
}

function personOf(id) {
  const u = db.state.users[id];
  return { id, name: nameOf(id), email: u?.email || null, provider: u?.provider };
}

function reviewForLevel(lv) {
  const codes = Object.keys(REVIEW_CARDS).filter((c) => reviewCodeLevel(c) === lv.level);
  return {
    references: Object.fromEntries(lv.tasks.map((t) => [t.id, Object.entries(lv.referenceFormulas).filter(([a]) => t.cells.flatMap(expandRange).includes(a)).slice(0, 2).map(([a, f]) => `${a}: ${f}`)])),
    cards: codes.map((c) => ({ code: c, ...REVIEW_CARDS[c] })),
  };
}

const CODE_LEVEL = {
  ABS_REF_MISSING: 1, ABS_REF_PARTIAL: 1, FORMULA_REQUIRED: 1, MAX_WRONG_RANGE: 2, FLOW_ONE_COLUMN: 2,
  AND_OR_SWAPPED: 3, BOUNDARY_GT: 3, COUNTIF_REQUIRED: 4, CRITERIA_SYNTAX: 4, CRITERIA_GT: 4, CRITERIA_HARDCODED: 4,
  HARDCODED_WORD: 5, MID_POSITION: 5, AMP_REQUIRED: 5,
};
const reviewCodeLevel = (c) => CODE_LEVEL[c];

export function studentView(comp, user) {
  const pub = publicView(comp);
  const team = comp.teams.find((t) => t.memberIds.includes(user.id));
  if (!team) return { ...pub, me: { id: user.id, name: user.name }, team: null, waiting: (comp.waiting || []).includes(user.id) };
  const score = computeTeamScore(comp, team.id);
  const subs = comp.submissions.filter((s) => s.teamId === team.id);
  const cancelled = comp.cancelledTasks.map((c) => c.taskId);
  const levels = [];
  for (const lv of LEVELS) {
    const l = comp.levels[lv.level];
    if (l.phase === 'pending' || (l.phase === 'skipped' && !l.startedAt)) continue;
    const pl = publicLevel(lv, { bonusEnabled: comp.settings.bonusEnabled });
    const ls = score.levels[lv.level];
    pl.phase = l.phase;
    pl.tasks = pl.tasks.map((t) => {
      const mine = subs.filter((s) => s.taskId === t.id);
      const latest = mine.at(-1);
      return {
        ...t,
        cancelled: cancelled.includes(t.id),
        best: ls.best[t.id] ?? 0,
        latest: latest ? submissionSummary(latest) : null,
        attempts: mine.filter((s) => ['VERIFIED', 'REJECTED'].includes(s.status)).length,
      };
    });
    pl.hints = comp.hintUses.filter((h) => h.teamId === team.id && h.level === lv.level).map((h) => ({ tier: h.tier, text: lv.hints[h.tier - 1] }));
    pl.score = { ...ls, lines: breakdownLines(ls) };
    pl.teamCompleted = ls.completed;
    pl.successEffect = ls.completed ? (lv.level === 5 && l.phase !== 'ended' ? '你們已破解廣播密碼！請保密，等全班完成後一齊揭曉。' : lv.successEffect) : null;
    pl.review = l.phase === 'ended' ? reviewForLevel(lv) : null;
    const dl = (id) => (AUDIO_EVENT_BY_ID[id]?.lines || []).map((x) => ({ speaker: x.speaker_name, text: x.subtitle_zh_Hant }));
    pl.dialogue = dl(`L${lv.level}_OPEN`);
    pl.closing = l.phase === 'ended' && lv.level < 5 ? dl(`L${lv.level}_CLOSE`) : [];
    pl.roles = team.roles[lv.level] ? Object.fromEntries(Object.entries(team.roles[lv.level]).filter(([, v]) => v).map(([k, v]) => [k, { label: ROLE_LABELS[k], name: nameOf(v), isMe: v === user.id }])) : null;
    levels.push(pl);
  }
  return {
    ...pub,
    me: { id: user.id, name: user.name },
    team: {
      id: team.id, name: team.name, code: team.code, color: team.color,
      members: team.memberIds.map((id) => ({ id, name: nameOf(id), captain: id === team.captainId })),
      captainOnlySubmit: comp.settings.captainOnlySubmit,
      isCaptain: team.captainId === user.id,
      workbook: team.workbook ? { provider: team.workbook.provider, url: team.workbook.url || null, status: team.workbook.status, error: team.workbook.status === 'ERROR' ? '工作表連線有問題，請通知老師。' : null } : null,
    },
    levelDetails: levels,
    score: { total: score.total, baseTotal: score.baseTotal, combo: score.combo, manual: score.manual, completedLevels: score.completedLevels },
    bonusEnabled: comp.settings.bonusEnabled,
  };
}

export function diagnostics(comp) {
  const graded = comp.submissions.filter((s) => ['VERIFIED', 'REJECTED'].includes(s.status));
  const byCode = {};
  const byConcept = {};
  for (const s of graded) {
    for (const e of s.errors || []) {
      byCode[e.code] = byCode[e.code] || { code: e.code, concept: e.concept, count: 0, teams: new Set(), levels: new Set() };
      byCode[e.code].count++;
      byCode[e.code].teams.add(s.teamId);
      byCode[e.code].levels.add(s.level);
      byConcept[e.concept] = (byConcept[e.concept] || 0) + 1;
    }
  }
  const codes = Object.values(byCode).map((x) => ({ code: x.code, concept: x.concept, conceptLabel: CONCEPTS[x.concept], count: x.count, teamCount: x.teams.size, levels: [...x.levels], sample: ERRORS[x.code]?.text.replace('{cell}', '').replace('{detail}', '…') })).sort((a, b) => b.count - a.count);
  const perTeam = comp.teams.map((t) => {
    const mine = comp.submissions.filter((s) => s.teamId === t.id);
    const score = computeTeamScore(comp, t.id);
    return {
      teamId: t.id, name: t.name, color: t.color,
      submissions: mine.length,
      verified: mine.filter((s) => s.status === 'VERIFIED').length,
      rejected: mine.filter((s) => s.status === 'REJECTED').length,
      syncFailures: mine.filter((s) => s.status === 'RETRYABLE_ERROR').length,
      integrityErrors: mine.filter((s) => s.status === 'INTEGRITY_ERROR').length,
      needsReview: mine.filter((s) => s.needsReview).length,
      hints: score.hintsUsed,
      levels: Object.fromEntries(Object.values(score.levels).map((l) => [l.level, { done: l.tasksDone, total: l.tasksTotal, completed: l.completed }])),
      topErrors: Object.entries(mine.flatMap((s) => (s.errors || []).map((e) => e.code)).reduce((m, c) => ({ ...m, [c]: (m[c] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1]).slice(0, 3),
    };
  });
  return {
    codes,
    concepts: Object.entries(byConcept).map(([k, v]) => ({ concept: k, label: CONCEPTS[k], count: v })).sort((a, b) => b.count - a.count),
    perTeam,
    reviewCards: codes.filter((c) => REVIEW_CARDS[c.code]).slice(0, 3).map((c) => ({ code: c.code, count: c.count, ...REVIEW_CARDS[c.code] })),
  };
}

export function teacherView(comp) {
  const scores = rankTeams(comp);
  return {
    ...publicView(comp),
    leaderboardLive: scores.map(publicRankRow(comp)),
    joinCode: comp.joinCode,
    projectorKey: comp.projectorKey,
    settings: comp.settings,
    skills: SKILLS,
    untaught: Object.fromEntries(LEVELS.map((l) => [l.level, untaughtFor(comp, l.level)])),
    levelsTeacher: LEVELS.map((lv) => ({
      level: lv.level, sheet: lv.sheet, title: lv.title, skills: lv.skills, editable: lv.editable,
      ...comp.levels[lv.level],
      timing: levelTiming(comp, lv.level),
      tasks: lv.tasks.map((t) => ({ id: t.id, points: t.points, bonus: !!t.bonus, instruction: t.instruction })),
    })),
    teams: comp.teams.map((t) => ({
      id: t.id, name: t.name, code: t.code, color: t.color, captainId: t.captainId,
      members: t.memberIds.map(personOf),
      roles: Object.fromEntries(Object.entries(t.roles || {}).map(([lvl, r]) => [lvl, Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v ? { id: v, name: nameOf(v) } : null]))])),
      workbook: t.workbook,
    })),
    waiting: (comp.waiting || []).map(personOf),
    generation: comp.generation ? { ...comp.generation } : null,
    approval: comp.approval,
    scores: scores.map((s) => ({ ...s, levelsLines: Object.fromEntries(Object.values(s.levels).map((l) => [l.level, breakdownLines(l)])) })),
    rules: RULES,
    submissions: comp.submissions.slice(-400).map((s) => ({
      ...submissionSummary(s), teamId: s.teamId, userName: nameOf(s.userId), elapsedMs: s.elapsedMs,
      snapshot: s.snapshot ? { provider: s.snapshot.provider, readAt: s.snapshot.readAt, inputs: Object.fromEntries(Object.entries(s.snapshot.inputs).filter(([, v]) => v !== null)) } : null,
      engineMismatch: s.engineMismatch || null, integrityCells: s.integrityCells || null,
    })),
    hintUses: comp.hintUses,
    adjustments: comp.adjustments,
    cancelledTasks: comp.cancelledTasks,
    tasks: TASKS.map((t) => ({ id: t.id, level: t.level, points: t.points, bonus: !!t.bonus })),
    audit: comp.audit.slice(-300),
    health: { ...comp.health, google: googleCredentialStatus(), features: features() },
    audio: {
      designated: audioOutput(comp), bgm: !!comp.audio.bgm, projectors: comp.audio.projectors || {},
      log: comp.audio.log.slice(-50),
      projector: comp.audio.projector,
      events: AUDIO_EVENTS.filter((e) => e.public).map((e) => ({ id: e.id, trigger: e.trigger, level: e.level, spoiler: e.spoiler, lineCount: e.lines.length, allowed: audioAllowed(comp, e) })),
    },
    diagnostics: diagnostics(comp),
  };
}

export function resultsCsv(comp) {
  const scores = rankTeams(comp);
  const diag = diagnostics(comp);
  const taskIds = TASKS.filter((t) => !t.bonus || comp.settings.bonusEnabled).map((t) => t.id);
  const header = ['Rank', 'Team', 'Code', 'Total', 'BaseTotal', ...LEVELS.map((l) => `L${l.level}_Score`), ...LEVELS.map((l) => `L${l.level}_Points`), 'Combo', 'ManualAdjust', 'HintsUsed', 'Submissions', 'RejectedSubmissions', 'SyncFailures', 'CompletedLevels', ...taskIds.map((t) => `${t}_Best`), 'TopErrors'];
  const rows = [header];
  for (const s of scores) {
    const t = comp.teams.find((x) => x.id === s.teamId);
    const d = diag.perTeam.find((x) => x.teamId === s.teamId);
    rows.push([
      s.rank, t.name, t.code, s.total, s.baseTotal,
      ...LEVELS.map((l) => s.levels[l.level].total),
      ...LEVELS.map((l) => `${s.levels[l.level].earnedPts}/${s.levels[l.level].maxPts}`),
      s.combo, s.manual, s.hintsUsed, d.submissions, d.rejected, d.syncFailures, s.completedLevels,
      ...taskIds.map((id) => s.levels[LEVEL_BY_NUM[Number(id[1])].level].best[id] ?? 0),
      d.topErrors.map(([c, n]) => `${c}×${n}`).join(' '),
    ]);
  }
  rows.push([]);
  rows.push(['ErrorCode', 'Concept', 'Count', 'TeamsAffected']);
  for (const c of diag.codes) rows.push([c.code, c.conceptLabel, c.count, c.teamCount]);
  rows.push([]);
  rows.push(['ManualAdjustment', 'Team', 'Delta', 'Before', 'After', 'Reason', 'By', 'At']);
  for (const a of comp.adjustments) rows.push(['', comp.teams.find((t) => t.id === a.teamId)?.name, a.delta, a.before, a.after, a.reason, a.by.name, new Date(a.at).toISOString()]);
  return rows;
}

export function toCsv(rows) {
  return '﻿' + rows.map((r) => r.map((v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\r\n');
}
