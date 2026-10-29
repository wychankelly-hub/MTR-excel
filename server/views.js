// 依角色過濾的資料視圖（Permission matrix §11）。
// Projector/公開：沒有電郵、學生姓名、答案或未公布劇情。
// Student：只看到自己隊伍；任務內容只在該關開始後才提供；標準答案只在該關結束後的回顧顯示。
// Teacher：全部。
import { db } from './store.js';
import { episodeOf } from './episodes/index.js';
import { clock } from './clock.js';
import { rankTeams, computeTeamScore, breakdownLines, RULES } from './scoring.js';
import { levelTiming, publicRankRow, untaughtFor, audioAllowed, audioOutput, teamTaskState, isBuiltin, openReopens, practiceItemsFor } from './competition.js';
import { submissionSummary } from './submission.js';
import { googleCredentialStatus } from './adapters/google-adapter.js';
import { features } from './config.js';
import { expandRange } from './engine/refs.js';

function levelPublic(comp, lv) {
  const ep = episodeOf(comp);
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
    clue: ['ended', 'skipped'].includes(l.phase) && l.startedAt ? ep.storyClues[lv.level] : null,
    successEffect: ['ended'].includes(l.phase) ? lv.successEffect : null,
  };
}

export function publicView(comp) {
  const ep = episodeOf(comp);
  const lb = comp.leaderboard;
  let leaderboard = null;
  if (!lb.hidden) leaderboard = lb.frozen ? lb.snapshot : rankTeams(comp).map(publicRankRow(comp));
  return {
    id: comp.id,
    title: comp.title,
    classCode: comp.classCode,
    demo: false,
    builtin: isBuiltin(comp),
    adapter: comp.adapter,
    status: comp.status,
    paused: comp.paused,
    pauseReason: comp.paused ? comp.pauseReason : null,
    serverNow: clock.now(),
    currentLevel: comp.currentLevel,
    episodeStarted: !!comp.episodeStartedAt,
    episode: ep.id,
    episodeNumber: ep.number,
    episodeTitle: ep.title,
    seriesTitle: ep.seriesTitle,
    levels: ep.levels.map((lv) => levelPublic(comp, lv)),
    teams: comp.teams.map((t) => ({ id: t.id, name: t.name, code: t.code, color: t.color, memberCount: t.memberIds.length })),
    leaderboard,
    leaderboardState: { hidden: lb.hidden, frozen: lb.frozen },
    reveal: comp.levels[ep.lastLevel].phase === 'ended' ? ep.reveal : null,
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

function reviewForLevel(ep, lv) {
  const codes = Object.keys(ep.reviewCards).filter((c) => ep.codeLevel[c] === lv.level);
  return {
    references: Object.fromEntries(lv.tasks.map((t) => [t.id, Object.entries(lv.referenceFormulas).filter(([a]) => t.cells.flatMap(expandRange).includes(a)).slice(0, 2).map(([a, f]) => `${a}: ${f}`)])),
    cards: codes.map((c) => ({ code: c, ...ep.reviewCards[c] })),
  };
}

export function studentView(comp, user) {
  const ep = episodeOf(comp);
  const pub = publicView(comp);
  const team = comp.teams.find((t) => t.memberIds.includes(user.id));
  if (!team) return { ...pub, me: { id: user.id, name: user.name }, team: null, waiting: (comp.waiting || []).includes(user.id) };
  const score = computeTeamScore(comp, team.id);
  const subs = comp.submissions.filter((s) => s.teamId === team.id);
  const cancelled = comp.cancelledTasks.map((c) => c.taskId);
  const levels = [];
  for (const lv of ep.levels) {
    const l = comp.levels[lv.level];
    if (l.phase === 'pending' || (l.phase === 'skipped' && !l.startedAt)) continue;
    const pl = ep.publicLevel(lv, { bonusEnabled: comp.settings.bonusEnabled });
    const ls = score.levels[lv.level];
    pl.phase = l.phase;
    pl.tasks = pl.tasks.map((t) => {
      const mine = subs.filter((s) => s.taskId === t.id && !s.practice);
      const latest = mine.at(-1);
      const st = teamTaskState(comp, team, t.id);
      // 老師未開放的題目：只顯示題號，不提前公開題目內容
      if (st.state === 'locked') return { id: t.id, cells: t.cells, focus: t.focus, points: t.points, bonus: t.bonus, state: 'locked', instruction: null, markingPoints: [], best: 0, latest: null, attempts: 0 };
      return {
        ...t,
        state: st.reopen ? 'reopened' : st.state,
        reopen: st.reopen,
        cancelled: cancelled.includes(t.id),
        best: ls.best[t.id] ?? 0,
        latest: latest ? submissionSummary(latest) : null,
        attempts: mine.filter((s) => ['VERIFIED', 'REJECTED'].includes(s.status)).length,
      };
    });
    pl.hints = comp.hintUses.filter((h) => h.teamId === team.id && h.level === lv.level).map((h) => ({ tier: h.tier, text: lv.hints[h.tier - 1] }));
    pl.score = { ...ls, lines: breakdownLines(ls) };
    pl.teamCompleted = ls.completed;
    pl.successEffect = ls.completed ? (lv.level === ep.lastLevel && l.phase !== 'ended' && ep.secretNotice ? ep.secretNotice : lv.successEffect) : null;
    // 本隊正在重做（練習）此關的題目時，暫時不顯示可得分公式
    const practicing = openReopens(comp, team.id).some((r) => r.level === lv.level);
    pl.review = l.phase === 'ended' && !practicing ? reviewForLevel(ep, lv) : null;
    const dl = (id) => (ep.audioEventById[id]?.lines || []).map((x) => ({ speaker: x.speaker_name, text: x.subtitle_zh_Hant }));
    pl.dialogue = dl(ep.audio.open(lv.level));
    pl.closing = l.phase === 'ended' && lv.level < ep.lastLevel ? dl(ep.audio.close(lv.level)) : [];
    pl.roles = team.roles[lv.level] ? Object.fromEntries(Object.entries(team.roles[lv.level]).filter(([, v]) => v).map(([k, v]) => [k, { label: ep.roleLabels[k], name: nameOf(v), isMe: v === user.id }])) : null;
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
    practice: practiceItemsFor(user),
    score: { total: score.total, baseTotal: score.baseTotal, combo: score.combo, manual: score.manual, completedLevels: score.completedLevels },
    bonusEnabled: comp.settings.bonusEnabled,
  };
}

export function diagnostics(comp) {
  const ep = episodeOf(comp);
  const { concepts: CONCEPTS, reviewCards: REVIEW_CARDS, errors: ERRORS } = ep;
  const graded = comp.submissions.filter((s) => ['VERIFIED', 'REJECTED'].includes(s.status) && !s.practice);
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
    const all = comp.submissions.filter((s) => s.teamId === t.id);
    const mine = all.filter((s) => !s.practice);
    const score = computeTeamScore(comp, t.id);
    return {
      teamId: t.id, name: t.name, color: t.color,
      submissions: mine.length,
      practice: all.length - mine.length,
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
  const ep = episodeOf(comp);
  const scores = rankTeams(comp);
  return {
    ...publicView(comp),
    leaderboardLive: scores.map(publicRankRow(comp)),
    joinCode: comp.joinCode,
    projectorKey: comp.projectorKey,
    settings: comp.settings,
    skills: ep.skills,
    untaught: Object.fromEntries(ep.levels.map((l) => [l.level, untaughtFor(comp, l.level)])),
    levelsTeacher: ep.levels.map((lv) => ({
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
    episode: comp.episode || 'E1',
    episodeTitle: ep.title,
    waiting: (comp.waiting || []).map(personOf),
    taskStates: Object.fromEntries(comp.teams.map((t) => [t.id, Object.fromEntries(ep.tasks.map((task) => { const st = teamTaskState(comp, t, task); return [task.id, st.reopen ? 'reopened' : st.state]; }))])),
    taskOverrides: comp.taskOverrides || {},
    reopens: comp.reopens || [],
    generation: comp.generation ? { ...comp.generation } : null,
    // 預檢表的數據摘要欄（每集不同）
    flagTable: comp.generation ? {
      labels: ep.flagColumns.map(([, label]) => label),
      rows: Object.fromEntries(Object.entries(comp.generation.teams || {}).map(([id, gt]) => [id, ep.flagColumns.map(([k]) => (typeof k === 'function' ? k(gt.flags || {}) : gt.flags?.[k]) ?? '—')])),
    } : null,
    approval: comp.approval,
    scores: scores.map((s) => ({ ...s, levelsLines: Object.fromEntries(Object.values(s.levels).map((l) => [l.level, breakdownLines(l)])) })),
    rules: RULES,
    submissions: comp.submissions.slice(-400).map((s) => ({
      ...submissionSummary(s), teamId: s.teamId, userName: nameOf(s.userId), elapsedMs: s.elapsedMs, practice: !!s.practice, makeup: s.makeup || null,
      snapshot: s.snapshot ? { provider: s.snapshot.provider, readAt: s.snapshot.readAt, inputs: Object.fromEntries(Object.entries(s.snapshot.inputs).filter(([, v]) => v !== null)) } : null,
      engineMismatch: s.engineMismatch || null, integrityCells: s.integrityCells || null,
    })),
    hintUses: comp.hintUses,
    adjustments: comp.adjustments,
    cancelledTasks: comp.cancelledTasks,
    tasks: ep.tasks.map((t) => ({ id: t.id, level: t.level, points: t.points, bonus: !!t.bonus })),
    audit: comp.audit.slice(-300),
    health: { ...comp.health, google: googleCredentialStatus(), features: features() },
    audio: {
      designated: audioOutput(comp), bgm: !!comp.audio.bgm, projectors: comp.audio.projectors || {},
      log: comp.audio.log.slice(-50),
      projector: comp.audio.projector,
      events: ep.audioEvents.filter((e) => e.public).map((e) => ({ id: e.id, trigger: e.trigger, level: e.level, spoiler: e.spoiler, lineCount: e.lines.length, allowed: audioAllowed(comp, e) })),
    },
    diagnostics: diagnostics(comp),
  };
}

export function resultsCsv(comp) {
  const ep = episodeOf(comp);
  const LEVELS = ep.levels;
  const scores = rankTeams(comp);
  const diag = diagnostics(comp);
  const taskIds = ep.tasks.filter((t) => !t.bonus || comp.settings.bonusEnabled).map((t) => t.id);
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
      ...taskIds.map((id) => s.levels[ep.taskById[id].level].best[id] ?? 0),
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
