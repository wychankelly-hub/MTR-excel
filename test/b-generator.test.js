// 驗收測試 B（6–14）：Dynamic Dataset Generator
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCompetitionDatasets, solveReference, buildLevelWorkbook } from '../server/episode1/generator.js';
import { LEVELS } from '../server/episode1/blueprint.js';
import { checksum } from '../server/episode1/rng.js';

const KEYS = ['team-1', 'team-2', 'team-3', 'team-4', 'team-5', 'team-6'];
const ds = generateCompetitionDatasets('ACCEPT-SEED', KEYS);

test('6. 同一 Seed + Generator Version 輸出完全一致', () => {
  const again = generateCompetitionDatasets('ACCEPT-SEED', KEYS);
  for (let i = 0; i < KEYS.length; i++) {
    assert.equal(checksum(again[i].levels), checksum(ds[i].levels));
    assert.equal(checksum(again[i].hidden), checksum(ds[i].hidden));
  }
  const other = generateCompetitionDatasets('OTHER-SEED', KEYS);
  assert.notEqual(checksum(other[0].levels), checksum(ds[0].levels));
});

test('7. 不同 Team Seed 產生不同數據，主要答案大多不同（≥80%）', () => {
  const main = (d) => [d.ref[1].H3, d.ref[2].H2, d.ref[2].H3, d.ref[3].H2, d.ref[4].I2, d.ref[4].I3, d.ref[4].I4];
  for (let i = 0; i < ds.length; i++) {
    for (let j = i + 1; j < ds.length; j++) {
      assert.notEqual(ds[i].teamSeed, ds[j].teamSeed);
      assert.notEqual(checksum(ds[i].levels[1].data), checksum(ds[j].levels[1].data));
      const a = main(ds[i]); const b = main(ds[j]);
      assert.ok(a.filter((x, k) => x !== b[k]).length / a.length >= 0.8, `${KEYS[i]} vs ${KEYS[j]}`);
    }
  }
});

test('8. 六隊各關有相同題量、資料筆數、評分點及函數要求（版面不變）', () => {
  for (const lv of LEVELS) {
    const shapes = ds.map((d) => Object.keys(d.levels[lv.level].data).sort().join(','));
    // 數據儲存格位置完全相同（L5 的 Position 只在 MID 列，各隊亦相同）
    assert.equal(new Set(shapes).size, 1, `L${lv.level} 版面不一致`);
  }
  const rows = (d, lvl, col, from) => Object.keys(d.levels[lvl].data).filter((a) => new RegExp(`^${col}\\d+$`).test(a) && Number(a.slice(1)) >= from).length;
  for (const d of ds) {
    assert.equal(rows(d, 1, 'A', 2), 20);
    assert.equal(rows(d, 2, 'A', 2), 12);
    assert.equal(rows(d, 3, 'A', 2), 24);
    assert.equal(rows(d, 4, 'A', 2), 500);
    assert.equal(rows(d, 5, 'A', 2), 5);
    assert.equal(d.levels[3].data.H1, 60);
  }
});

test('9. L1 至少十列能區分錯誤（H1 相對）／正確（$H$1）公式', () => {
  for (const d of ds) {
    const buggy = buildLevelWorkbook(d.levels[1], 1, { H3: d.ref[1].H3 });
    let differ = 0;
    for (let r = 2; r <= 21; r++) if (buggy.getValue('L1_Fare', `D${r}`) !== d.ref[1][`D${r}`]) differ++;
    assert.ok(differ >= 10);
    for (let r = 2; r <= 21; r++) assert.ok(d.ref[1][`F${r}`] >= 0, '不得出現負餘額');
  }
});

test('10. L2 最高時段唯一，MAX 結果與逐時段 SUM 一致', () => {
  for (const d of ds) {
    const totals = [];
    for (let r = 2; r <= 13; r++) totals.push(d.levels[2].data[`B${r}`] + d.levels[2].data[`C${r}`]);
    const mx = Math.max(...totals);
    assert.equal(totals.filter((t) => t === mx).length, 1);
    assert.equal(d.ref[2].H2, mx);
    assert.ok(totals.includes(0), '包括 0 人流時段');
  }
  assert.equal(new Set(ds.map((d) => d.ref[2].H2)).size, ds.length, '各隊最高人流不同');
});

test('11. L3 必有 Age=60、Age=59、ValidCard=FALSE 及 OR/AND 邊界案例', () => {
  for (const d of ds) {
    const rows = [];
    for (let r = 2; r <= 25; r++) rows.push([d.levels[3].data[`B${r}`], d.levels[3].data[`C${r}`], d.levels[3].data[`D${r}`]]);
    assert.ok(rows.some((x) => x[0] === 60));
    assert.ok(rows.some((x) => x[0] === 59));
    assert.ok(rows.some((x) => x[2] === false && x[0] >= 60 && x[1] === 'YES'));
    assert.ok(rows.some((x) => x[0] >= 60 && x[1] === 'NO' && x[2] === true), '只有年齡符合');
    assert.ok(rows.some((x) => x[0] < 60 && x[1] === 'YES' && x[2] === true), '只有 AssistPass 符合');
    assert.ok(rows.every((x) => typeof x[2] === 'boolean'), 'ValidCard 必須是真正布林');
    assert.ok(d.ref[3].H2 >= 5 && 24 - d.ref[3].H2 >= 5);
  }
  assert.equal(new Set(ds.map((d) => d.ref[3].H2)).size, ds.length, '各隊合資格人數不同');
});

test('12. L4 每隊恰有 500 筆獨立 Item，存在 Value=H1', () => {
  for (const d of ds) {
    const data = d.levels[4].data;
    const ids = new Set();
    let atThreshold = 0;
    for (let r = 2; r <= 501; r++) { ids.add(data[`A${r}`]); if (data[`C${r}`] === data.H1) atThreshold++; }
    assert.equal(ids.size, 500);
    assert.ok(atThreshold >= 1);
    assert.ok(d.ref[4].I4 !== d.ref[4].I3);
  }
});

test('13. L5 六隊 Code 不同，但正確公式均得 LUNCH', () => {
  const codes = ds.map((d) => d.levels[5].params.codes);
  for (let i = 0; i < codes.length; i++) for (let j = i + 1; j < codes.length; j++) codes[i].forEach((c, k) => assert.notEqual(c, codes[j][k]));
  for (const d of ds) {
    assert.equal(solveReference(d.levels[5], 5).H2, 'LUNCH');
    assert.notEqual(d.hiddenRef[5].H2, 'LUNCH', '隱藏測試使用另一個字詞');
    for (const c of d.levels[5].params.codes) assert.match(c, /^[A-Z0-9]+$/);
  }
});

test('14. 不合約束的 Team Dataset 會自動重抽，並且可重現', () => {
  // 在多個 seed 中必定會遇到需要重抽的情況（例如 L1 Bonus 最低值不唯一或跨隊答案相同）
  let found = null;
  for (let s = 0; s < 20 && !found; s++) {
    const list = generateCompetitionDatasets(`RETRY-${s}`, KEYS);
    found = list.find((d) => d.attempts > 1) ? { seed: `RETRY-${s}`, list } : null;
  }
  assert.ok(found, '應找到需要重抽的例子');
  const d = found.list.find((x) => x.attempts > 1);
  assert.ok(d.rejected.length >= 1 && d.rejected[0].problems.length >= 1);
  const again = generateCompetitionDatasets(found.seed, KEYS).find((x) => x.teamKey === d.teamKey);
  assert.equal(again.attempts, d.attempts);
  assert.equal(checksum(again.levels), checksum(d.levels));
});

test('壓力：多個 Seed（共 120 隊數據）全部通過 Preflight', async () => {
  const { preflightTeam } = await import('../server/episode1/preflight.js');
  for (let s = 0; s < 20; s++) {
    for (const d of generateCompetitionDatasets(`STRESS-${s}`, KEYS)) {
      const p = preflightTeam(d);
      assert.ok(p.pass, `STRESS-${s} ${d.teamKey}: ${JSON.stringify(p.failed)}`);
    }
  }
});
