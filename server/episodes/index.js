// 劇集登記表：每一集提供相同介面（關卡、題目、數據生成、批改、劇情、回饋）。
// 比賽紀錄的 episode 欄位（例如 'E1'）決定使用哪一集；舊比賽沒有此欄位時視為 E1。
import * as bp1 from '../episode1/blueprint.js';
import * as gen1 from '../episode1/generator.js';
import * as val1 from '../episode1/validators.js';
import * as fx1 from '../episode1/fixtures.js';
import * as dlg1 from '../episode1/dialogue.js';
import * as fb1 from '../episode1/feedback.js';
import { preflightTeam as preflight1 } from '../episode1/preflight.js';

function makeEpisode(def) {
  const levels = def.levels;
  const levelByNum = Object.fromEntries(levels.map((l) => [l.level, l]));
  const tasks = levels.flatMap((l) => l.tasks.map((t) => ({ ...t, level: l.level, sheet: l.sheet })));
  const taskById = Object.fromEntries(tasks.map((t) => [t.id, t]));
  return {
    ...def,
    levelByNum,
    tasks,
    taskById,
    lastLevel: Math.max(...levels.map((l) => l.level)),
    requiredTasks: (level, cancelled = []) => levelByNum[level].tasks.filter((t) => !t.bonus && !cancelled.includes(t.id)),
    levelMaxPoints: (level, cancelled = []) => levelByNum[level].tasks.filter((t) => !t.bonus && !cancelled.includes(t.id)).reduce((s, t) => s + t.points, 0),
  };
}

export const E1 = makeEpisode({
  id: 'E1',
  number: 1,
  title: bp1.EPISODE_TITLE,
  shortTitle: '新人報到',
  seriesTitle: bp1.SERIES_TITLE,
  defaultCompTitle: '定過抬油：站長爭奪戰 E1',
  templateVersion: bp1.TEMPLATE_VERSION,
  generatorVersion: bp1.GENERATOR_VERSION,
  validatorVersion: bp1.VALIDATOR_VERSION,
  rulesVersion: 'E1-RULES-1.0.0',
  levels: bp1.LEVELS,
  skills: bp1.SKILLS,
  roleLabels: bp1.ROLE_LABELS,
  publicLevel: bp1.publicLevel,
  generateCompetitionDatasets: gen1.generateCompetitionDatasets,
  preflightTeam: preflight1,
  gradeTask: val1.gradeTask,
  checkIntegrity: val1.checkIntegrity,
  evaluateStudentLevel: val1.evaluateStudentLevel,
  correctInputs: fx1.correctInputs,
  equivalentInputs: fx1.equivalentInputs,
  wrongCases: fx1.wrongCases,
  audioEvents: dlg1.AUDIO_EVENTS,
  audioEventById: dlg1.AUDIO_EVENT_BY_ID,
  storyClues: dlg1.STORY_CLUES,
  audio: {
    intro: 'E1_INTRO',
    open: (n) => `L${n}_OPEN`,
    close: (n) => `L${n}_CLOSE`,
    firstClear: (n) => `L${n}_FIRST_CLEAR`,
    final: 'E1_FINAL_REVEAL',
    timerWarning: 'TIMER_WARNING',
  },
  reveal: { word: 'LUNCH', teaser: '第二集預告：疑犯火箭仔' },
  concepts: fb1.CONCEPTS,
  errors: fb1.ERRORS,
  reviewCards: fb1.REVIEW_CARDS,
  codeLevel: {
    ABS_REF_MISSING: 1, ABS_REF_PARTIAL: 1, FORMULA_REQUIRED: 1, MAX_WRONG_RANGE: 2, FLOW_ONE_COLUMN: 2,
    AND_OR_SWAPPED: 3, BOUNDARY_GT: 3, COUNTIF_REQUIRED: 4, CRITERIA_SYNTAX: 4, CRITERIA_GT: 4, CRITERIA_HARDCODED: 4,
    HARDCODED_WORD: 5, MID_POSITION: 5, AMP_REQUIRED: 5,
  },
  // 老師預檢表的數據摘要欄
  flagColumns: [
    ['L1_multiplier', 'L1 系數'], ['L2_peakFlow', 'L2 最高人流'], ['L3_eligible', 'L3 合資格'],
    [(f) => `${f.L4_targetCategory} / ${f.L4_minValue}（${f.L4_itemsExactlyAtThreshold}）`, 'L4 類別／門檻（=門檻件數）'], ['L5_codes', 'L5 代碼'],
  ],
  summarizeParams: (level, d) => {
    const p = { ...d.params };
    if (level === 4) delete p.codes;
    return p;
  },
});

export const EPISODES = { E1 };
export const EPISODE_LIST = [E1];

export function episodeById(id) {
  return EPISODES[id || 'E1'] || null;
}

export function episodeOf(comp) {
  const ep = EPISODES[comp?.episode || 'E1'];
  if (!ep) throw new Error(`未知劇集 ${comp?.episode}`);
  return ep;
}

/** 所有劇集的公開音訊事件（事件編號在各集之間不重複） */
export function allAudioEvents() {
  return EPISODE_LIST.flatMap((e) => e.audioEvents);
}
