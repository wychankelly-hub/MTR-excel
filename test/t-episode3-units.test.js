// 第三集單元測試：新函數、分析工具（排序、篩選、樞紐分析表、圖表、藍本、目標搜尋）、數據生成及 Preflight。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Workbook } from '../server/engine/workbook.js';
import * as an from '../server/engine/analysis.js';
import { generateCompetitionDatasets } from '../server/episode3/generator.js';
import { preflightTeam } from '../server/episode3/preflight.js';
import { ERRORS } from '../server/episode3/feedback.js';
import { AUDIO_EVENTS } from '../server/episode3/dialogue.js';
import { E3, allAudioEvents } from '../server/episodes/index.js';
import fs from 'node:fs';

const KEYS = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'];

function sheet(rows) {
  const wb = new Workbook(); wb.addSheet('S', 40, 10);
  rows.forEach((row, r) => row.forEach((v, c) => wb.setInput('S', `${'ABCDEFGHIJ'[c]}${r + 1}`, v)));
  return wb;
}

test('新函數：COUNTIFS／SUMIFS／AVERAGEIFS／MAXIFS／MINIFS、SUBTOTAL（只計可見列）、IFERROR、REPT、EXACT、SUBSTITUTE、INDEX／MATCH', () => {
  const wb = sheet([['K', 'V'], ['X', 5], ['Y', 3], ['X', 7], ['Y', 1]]);
  const f = (x) => { wb.setInput('S', 'H1', x); return wb.getValue('S', 'H1'); };
  assert.equal(f('=COUNTIFS(A2:A5,"X",B2:B5,">4")'), 2);
  assert.equal(f('=SUMIFS(B2:B5,A2:A5,"Y")'), 4);
  assert.equal(f('=AVERAGEIFS(B2:B5,A2:A5,"X")'), 6);
  assert.equal(f('=MAXIFS(B2:B5,A2:A5,"Y")'), 3);
  assert.equal(f('=MINIFS(B2:B5,A2:A5,"X")'), 5);
  assert.equal(f('=REPT("k",4)'), 'kkkk');
  assert.equal(f('=EXACT("a","A")'), false);
  assert.equal(f('=SUBSTITUTE("kkk","k","")'), '');
  assert.equal(f('=INDEX(B2:B5,MATCH("Y",A2:A5,0))'), 3);
  assert.equal(f('=IFERROR(1/0,"x")'), 'x');
  assert.equal(f('=SUBTOTAL(9,B2:B5)'), 16);
  wb.hiddenRows = new Map([['S', new Set([3, 5])]]);
  assert.equal(f('=SUBTOTAL(9,B2:B5)'), 12, '被篩選隱藏的列不計算');
  assert.equal(f('=SUBTOTAL(3,A2:A5)'), 2);
  assert.equal(f('=SUM(B2:B5)'), 16, 'SUM 仍計算所有列');
});

test('排序：穩定、多欄、只排序一欄會拆散資料列；篩選不刪除數據；樞紐分析表；圖表數據；藍本；目標搜尋', () => {
  const data = { A1: 'ID', B1: 'Sev', C1: 'Min', A2: 'a', B2: 2, C2: 40, A3: 'b', B3: 5, C3: 10, A4: 'c', B4: 5, C4: 30, A5: 'd', B5: 1, C5: 25 };
  const multi = an.applySorts(data, 'A1:C5', { ops: [{ keys: [{ col: 'B', dir: 'desc' }, { col: 'C', dir: 'asc' }] }] });
  const successive = an.applySorts(data, 'A1:C5', { ops: [{ keys: [{ col: 'C', dir: 'asc' }] }, { keys: [{ col: 'B', dir: 'desc' }] }] });
  assert.deepEqual([2, 3, 4, 5].map((r) => multi[`A${r}`]), ['b', 'c', 'a', 'd']);
  assert.deepEqual(multi, successive, '逐次排序（先次要後主要）＝多欄排序');
  const broken = an.applySorts(data, 'A1:C5', { ops: [{ keys: [{ col: 'C', dir: 'desc' }], cols: ['C'] }] });
  assert.equal(broken.A2, 'a'); assert.equal(broken.C2, 40); assert.equal(broken.C3, 30, '只有 C 欄移動');
  const wb = sheet([['ID', 'Sev', 'Min'], ['a', 2, 40], ['b', 5, 10], ['c', 5, 30], ['d', 1, 25]]);
  const get = (c, r) => wb.valueAt('S', c, r);
  assert.deepEqual([...an.filterHiddenRows(get, 'A1:C5', { crit: { B: { values: [5] }, C: { op: '>', value: 15 } } })], [2, 3, 5]);
  assert.equal(wb.getValue('S', 'A3'), 'b', '篩選後數據仍在');
  const p = an.computePivot(get, { source: 'A1:C5', rows: ['Sev'], cols: [], values: [{ field: 'Min', agg: 'SUM' }], filters: [] });
  assert.deepEqual(an.pivotMap(p), { '1|': 25, '2|': 40, '5|': 40 });
  const cnt = an.computePivot(get, { source: 'A1:C5', rows: ['Sev'], values: [{ field: 'ID', agg: 'COUNT' }], filters: [{ field: 'Min', values: [10, 25, 40] }] });
  assert.deepEqual(an.pivotMap(cnt), { '1|': 1, '2|': 1, '5|': 1 });
  const cd = an.chartData(get, { cats: 'A2:A5', series: [{ name: 'Min', ref: 'C2:C5' }] });
  assert.deepEqual(cd.categories, ['a', 'b', 'c', 'd']); assert.deepEqual(cd.series[0].values, [40, 10, 30, 25]);
  wb.setInput('S', 'C3', 99);
  assert.equal(an.chartData(get, { cats: 'A2:A5', series: [{ ref: 'C2:C5' }] }).series[0].values[1], 99, '圖表跟隨數據更新');
  wb.setInput('S', 'E1', 5); wb.setInput('S', 'E2', '=E1*2');
  const rows = an.scenarioSummary(wb, 'S', { changing: ['E1'], result: ['E2'], list: [{ name: 'x', values: { E1: 7 } }] });
  assert.deepEqual(rows.map((r) => r.results.E2), [10, 14]);
  assert.equal(wb.getInput('S', 'E1'), 5, '藍本比較不改變工作表');
  wb.setInput('S', 'F1', 0); wb.setInput('S', 'F2', '=COUNTIF(C2:C5,"<="&F1)');
  assert.equal(an.goalSeek(wb, 'S', 'F2', 3, 'F1', { lo: 0, hi: 200, integer: true }), 40);
  assert.equal(an.goalSeek(wb, 'S', 'E2', 13, 'E1', { lo: 0, hi: 100 }), 6.5);
});

test('伺服器驗證學生的分析設定（拒絕不在表格內的欄、太多數列、未知圖表類型）', () => {
  const tools = { table: 'A1:H121', sort: true, filter: true, chart: true };
  assert.throws(() => an.sanitizeMeta('!SORT', { ops: [{ keys: [{ col: 'Z', dir: 'asc' }] }] }, tools));
  assert.throws(() => an.sanitizeMeta('!CHARTS', [{ type: 'radar', series: [{ ref: 'A1:A2' }] }], tools));
  assert.throws(() => an.sanitizeMeta('!PIVOTS', [], tools), /不能/);
  assert.equal(an.sanitizeMeta('!CHARTS', [1, 2, 3, 4, 5, 6].map(() => ({ type: 'line', series: [{ ref: 'D2:D19' }] })), tools).length, 4);
  assert.deepEqual(an.sanitizeMeta('!SORT', { ops: [{ keys: [{ col: 'h', dir: 'desc' }] }] }, tools), { ops: [{ keys: [{ col: 'H', dir: 'desc' }] }] });
});

test('數據：同一 Seed 相同；各隊不同；Preflight 10 個 Seed × 6 隊全部通過', { timeout: 300000 }, () => {
  const a = generateCompetitionDatasets('e3-x', KEYS); const b = generateCompetitionDatasets('e3-x', KEYS);
  assert.deepEqual(a.map((d) => d.checksums), b.map((d) => d.checksums));
  for (let i = 1; i < a.length; i++) assert.notDeepEqual(a[i].levels[1].data, a[0].levels[1].data);
  let total = 0;
  for (let i = 0; i < 10; i++) {
    for (const ds of generateCompetitionDatasets(`e3-pf-${i}`, KEYS)) {
      const r = preflightTeam(ds);
      assert.ok(r.pass, `seed e3-pf-${i}: ${r.failed.map((f) => `${f.taskId} ${f.name} ${f.detail}`).join('；')}`);
      total += r.total;
    }
  }
  assert.ok(total > 5000);
});

test('回饋及配音：所有錯誤代碼都有繁體中文回饋；每關都有開場、首隊、結束及揭曉事件', () => {
  const src = fs.readFileSync(new URL('../server/episode3/validators.js', import.meta.url), 'utf8') + fs.readFileSync(new URL('../server/episode3/fixtures.js', import.meta.url), 'utf8');
  const codes = new Set([...src.matchAll(/'([A-Z][A-Z0-9]+_[A-Z0-9_]+)'/g)].map((m) => m[1]).filter((c) => !/^E3_|^UNCLE_|^FSM_/.test(c) && !['UNCLE-WONG'].includes(c)));
  for (const c of codes) assert.ok(ERRORS[c], `缺少回饋：${c}`);
  const ids = allAudioEvents().map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of [E3.audio.intro, E3.audio.final, E3.audio.timerWarning, ...[1, 2, 3, 4, 5].flatMap((n) => [E3.audio.open(n), E3.audio.firstClear(n)]), ...[1, 2, 3, 4].map(E3.audio.close)]) assert.ok(E3.audioEventById[id], id);
  assert.ok(AUDIO_EVENTS.find((e) => e.id === 'E3_FINAL_REVEAL').lines.some((l) => l.subtitle_zh_Hant.includes('咪咪')));
  assert.ok(AUDIO_EVENTS.every((e) => e.episode === 'E3'));
});
