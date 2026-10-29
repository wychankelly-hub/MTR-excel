// 第二集單元測試：數據生成可重現、各隊不同、Preflight（多個 Seed）、新函數的計算結果。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCompetitionDatasets } from '../server/episode2/generator.js';
import { preflightTeam } from '../server/episode2/preflight.js';
import { gradeTask } from '../server/episode2/validators.js';
import { correctInputs } from '../server/episode2/fixtures.js';
import { ERRORS } from '../server/episode2/feedback.js';
import { AUDIO_EVENTS } from '../server/episode2/dialogue.js';
import { E1, E2, allAudioEvents } from '../server/episodes/index.js';
import { Workbook } from '../server/engine/workbook.js';
import { makeRng } from '../server/episode1/rng.js';

const KEYS = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'];

test('同一 Seed 生成相同數據；不同隊伍數據不同', () => {
  const a = generateCompetitionDatasets('seed-x', KEYS);
  const b = generateCompetitionDatasets('seed-x', KEYS);
  assert.deepEqual(a.map((d) => d.checksums), b.map((d) => d.checksums));
  for (let i = 1; i < a.length; i++) assert.notDeepEqual(a[i].levels[1].data, a[0].levels[1].data);
  // 故事約束：火箭仔永遠離辦公室最遠；目標員工證最少出現兩次
  for (const d of a) {
    const l4 = d.levels[4].data;
    const rows = [2, 3, 4, 5, 6, 7, 8, 9];
    const dist = (r) => Math.hypot(l4[`C${r}`] - l4.H1, l4[`D${r}`] - l4.H2);
    const rocket = rows.find((r) => l4[`A${r}`] === 'ROCKET');
    assert.ok(rows.every((r) => r === rocket || dist(r) < dist(rocket)));
    assert.ok(d.ref[1].H2 >= 2);
  }
});

test('Preflight：20 個 Seed × 6 隊，全部檢查通過', { timeout: 120000 }, () => {
  let total = 0;
  for (let i = 0; i < 20; i++) {
    for (const ds of generateCompetitionDatasets(`pf-${i}`, KEYS)) {
      const r = preflightTeam(ds);
      assert.ok(r.pass, `seed pf-${i}: ${r.failed.map((f) => `${f.taskId} ${f.name} ${f.detail}`).join('；')}`);
      total += r.total;
    }
  }
  assert.ok(total > 8000);
});

test('所有錯誤代碼都有繁體中文回饋；所有題目都有批改器', () => {
  const ds = generateCompetitionDatasets('codes', KEYS)[0];
  for (const t of E2.tasks) {
    const r = gradeTask(t.id, correctInputs(t.id), ds);
    assert.equal(r.earned, r.max, t.id);
  }
  const src = (await_import_src());
  const codes = new Set([...src.matchAll(/'([A-Z][A-Z0-9_]{3,})'/g)].map((m) => m[1]).filter((c) => /_/.test(c) && !/^E2|^L\d|^RANK\.|VISITOR|NONE/.test(c)));
  for (const c of codes) if (!['NOT_INT', 'OFF_BY_ONE'].includes(c)) assert.ok(ERRORS[c], `缺少回饋：${c}`);
});

import fs from 'node:fs';
function await_import_src() { return fs.readFileSync(new URL('../server/episode2/validators.js', import.meta.url), 'utf8'); }

test('配音事件：編號在各集之間不重複；每集都有開場、各關事件及最終揭曉', () => {
  const ids = allAudioEvents().map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const ep of [E1, E2]) {
    for (const id of [ep.audio.intro, ep.audio.final, ep.audio.timerWarning, ...[1, 2, 3, 4, 5].flatMap((n) => [ep.audio.open(n), ep.audio.firstClear(n)]), ...[1, 2, 3, 4].map(ep.audio.close)]) {
      assert.ok(ep.audioEventById[id], `${ep.id} 缺少 ${id}`);
    }
  }
  assert.ok(AUDIO_EVENTS.every((e) => e.episode === 'E2'));
  assert.ok(AUDIO_EVENTS.find((e) => e.id === 'E2_FINAL_REVEAL').lines.some((l) => l.subtitle_zh_Hant.includes('清白')));
});

function calc(formula, cells = {}, seed = 'x') {
  const wb = new Workbook();
  wb.addSheet('S', 30, 10);
  for (const [a, v] of Object.entries(cells)) wb.setInput('S', a, v);
  wb.setInput('S', 'Z1', formula);
  wb.rng = makeRng(seed).next;
  wb.recalc();
  return wb.getValue('S', 'Z1');
}

test('新函數：FIND、XLOOKUP、ROUND、INT、SQRT、RANK、RAND', () => {
  assert.equal(calc('=FIND("@","OFFICE@1231#R07")'), 7);
  assert.equal(calc('=MID("OFFICE@1231#R07",FIND("@","OFFICE@1231#R07")+1,4)'), '1231');
  assert.equal(calc('=XLOOKUP("B",A1:A3,B1:B3,"NO")', { A1: 'A', A2: 'B', A3: 'C', B1: 1, B2: 2, B3: 3 }), 2);
  assert.equal(calc('=XLOOKUP("Z",A1:A3,B1:B3,"NO")', { A1: 'A', A2: 'B', A3: 'C', B1: 1, B2: 2, B3: 3 }), 'NO');
  assert.equal(calc('=ROUND(2.35,1)'), 2.4);
  assert.equal(calc('=ROUND(-2.5,0)'), -3);
  assert.equal(calc('=INT(-1.5)'), -2);
  assert.equal(calc('=SQRT(3^2+4^2)'), 5);
  assert.equal(calc('=RANK(B2,B1:B3,1)', { B1: 5, B2: 9, B3: 1 }), 3);
  assert.equal(calc('=RANK(B2,B1:B3)', { B1: 5, B2: 9, B3: 1 }), 1);
  for (let i = 0; i < 50; i++) {
    const r = calc('=RAND()', {}, `r${i}`);
    assert.ok(r >= 0 && r < 1);
    const n = calc('=INT(RAND()*6)+1', {}, `n${i}`);
    assert.ok(Number.isInteger(n) && n >= 1 && n <= 6);
  }
});
