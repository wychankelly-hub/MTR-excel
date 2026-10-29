// 驗收測試 F（42–45）：教學與語言
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LEVELS, TASKS } from '../server/episode1/blueprint.js';
import { ERRORS, REVIEW_CARDS } from '../server/episode1/feedback.js';
import { AUDIO_EVENTS } from '../server/episode1/dialogue.js';
import { generateCompetitionDatasets } from '../server/episode1/generator.js';
import { gradeTask } from '../server/episode1/validators.js';
import { wrongCases } from '../server/episode1/fixtures.js';

// 常見簡體字（若出現代表誤用簡體中文）
const SIMPLIFIED = '这们题数计错误时关复参应选择输结论单绝对范围条隐测试华网络页显总额费开实员组检报过还发现为与从车门站长' + '时间问场乐书龙鸡响边听说读写类动态区级点线递连转进运迟';
const TRAD_OK = new Set([...'站長']); // 繁簡同形
const simplifiedIn = (s) => [...s].filter((c) => SIMPLIFIED.includes(c) && !TRAD_OK.has(c));

const studentTexts = [
  ...LEVELS.flatMap((l) => [l.title, l.storyGoal, l.successEffect, l.rule || '', l.safetyNote || '', ...l.hints]),
  ...TASKS.flatMap((t) => [t.instruction, ...t.markingPoints.map((m) => m.label)]),
  ...Object.values(ERRORS).map((e) => e.text),
  ...Object.values(REVIEW_CARDS).flatMap((c) => [c.why, c.keyword, c.clue, c.apply]),
  ...AUDIO_EVENTS.flatMap((e) => e.lines.map((l) => l.subtitle_zh_Hant)),
];

test('42. 學生須閱讀的題目、Hints、Feedback 均為繁體中文', () => {
  for (const s of studentTexts) {
    if (!s) continue;
    assert.deepEqual(simplifiedIn(s), [], `疑似簡體字：${s}`);
  }
  for (const t of TASKS) assert.match(t.instruction, /[一-鿿]/);
  for (const l of LEVELS) for (const h of l.hints) assert.match(h, /[一-鿿]/);
  // 前端可見文字
  const root = path.resolve(import.meta.dirname, '..', 'public');
  for (const f of ['index.html', 'student.html', 'projector.html', 'teacher.html', 'js/student.js', 'js/projector.js', 'js/sheet-grid.js', 'js/common.js', 'js/teacher.js', 'js/characters.js', 'js/rail.js', 'js/stage.js', 'js/audio.js']) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    const zh = (src.match(/[一-鿿]+/g) || []).join('');
    assert.deepEqual(simplifiedIn(zh), [], `${f} 含疑似簡體字`);
  }
});

test('43. 所有學生答案只需英文、數字、符號及公式', () => {
  for (const lv of LEVELS) for (const [a, f] of Object.entries(lv.referenceFormulas)) assert.match(f, /^[\x20-\x7E]+$/, `${lv.sheet}!${a}`);
  // 工作表數據及標題全部英文／數字
  const [d] = generateCompetitionDatasets('LANG', ['team-1']);
  for (const n of [1, 2, 3, 4, 5]) for (const [a, v] of Object.entries(d.levels[n].data)) if (typeof v === 'string') assert.match(v, /^[\x20-\x7E]*$/, `L${n} ${a}`);
  // 學生介面上的輸入欄：比賽代碼、Demo 名稱及公式列都限制為 ASCII
  const root = path.resolve(import.meta.dirname, '..', 'public');
  const student = fs.readFileSync(path.join(root, 'js/student.js'), 'utf8');
  assert.match(student, /pattern: '\[A-Za-z0-9\]\{6\}'/);
  const grid = fs.readFileSync(path.join(root, 'js/sheet-grid.js'), 'utf8');
  assert.match(grid, /\[\^\\x00-\\x7F\]/, '公式列會提示不需輸入中文');
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(index, /pattern="\[A-Za-z0-9 _\.\\-\]\{1,24\}"/);
  // 學生介面沒有 textarea（沒有中文自由作答欄）
  assert.ok(!/textarea/.test(student) && !/textarea/.test(grid));
});

test('44. 回合未結束時看不到標準答案（學生視圖測試見 d-competition）', () => {
  const src = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'server/views.js'), 'utf8');
  assert.match(src, /pl\.review = l\.phase === 'ended' && !practicing \? reviewForLevel\(lv\) : null/);
});

test('45. 成績報告能指出五種概念錯誤：$、SUM/MAX 範圍、AND/OR、COUNTIF/SUMIF、&／文字函數', () => {
  const [d] = generateCompetitionDatasets('CONCEPT', ['team-1']);
  const concepts = new Set();
  for (const t of TASKS) for (const w of wrongCases(t.id, d)) for (const e of gradeTask(t.id, w.inputs, d).errors) concepts.add(e.concept);
  for (const c of ['ABS_REF', 'RANGE', 'AND_OR', 'CONDITIONAL', 'TEXT_AMP']) assert.ok(concepts.has(c), c);
});
