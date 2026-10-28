// Dynamic Dataset Generator：同一藍圖，各隊不同數據，難度一致。
// 同一 competition seed + GENERATOR_VERSION 一定產生完全相同的結果。
import { makeRng, checksum } from './rng.js';
import { LEVELS, LEVEL_BY_NUM, GENERATOR_VERSION, TEMPLATE_VERSION } from './blueprint.js';
import { Workbook } from '../engine/workbook.js';
import { addr } from '../engine/refs.js';
import { isError } from '../engine/values.js';

const MAX_ATTEMPTS = 60;

// ---------------------------------------------------------------- 各關生成
function genL1(rng, { avoidMultiplier } = {}) {
  const data = { A1: 'CardID', B1: 'Trips', C1: 'FarePerTrip', D1: 'TotalFare', E1: 'StartingBalance', F1: 'EndingBalance', G1: 'FareMultiplier', G3: 'AllEndingBalances', G5: 'BONUS LowestBalance' };
  const mults = [1.1, 1.2, 1.3, 1.4].filter((m) => m !== avoidMultiplier);
  const mult = rng.pick(mults);
  data.H1 = mult;
  const ids = rng.uniqueInts(20, 100, 999);
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (let i = 0; i < 20; i++) {
    const r = i + 2;
    const trips = rng.int(1, 4);
    const fare = rng.pick([10, 20, 30, 40]);
    const total = Math.round(trips * fare * mult * 100) / 100;
    const start = Math.ceil((total + 10) / 10) * 10 + 10 * rng.int(0, 25);
    data[`A${r}`] = `${letters[rng.int(0, letters.length - 1)]}${letters[rng.int(0, letters.length - 1)]}${ids[i]}`;
    data[`B${r}`] = trips;
    data[`C${r}`] = fare;
    data[`E${r}`] = start;
  }
  // 火箭仔的錯誤版本：D2 =B2*C2*H1，並以相對參照複製至 D3:D21
  const initial = {};
  for (let r = 2; r <= 21; r++) initial[`D${r}`] = `=B${r}*C${r}*H${r - 1}`;
  return { data, initial, params: { multiplier: mult } };
}

function genL2(rng) {
  const data = { A1: 'TimeSlot', B1: 'Entries', C1: 'Exits', D1: 'TotalFlow', G2: 'PeakFlow', G3: 'AverageFlow', G4: 'NumberOfSlots' };
  const startHour = rng.pick([6, 7]);
  const kinds = rng.shuffle(['zero', 'peak', 'busy', 'busy', 'busy', 'normal', 'normal', 'normal', 'normal', 'normal', 'quiet', 'quiet']);
  // D2 是學生最先作答（及最先被檢查）的一列：不可以是 0 人流時段，否則「只加一欄」的錯誤會巧合正確
  if (kinds[0] === 'zero') [kinds[0], kinds[1]] = [kinds[1], kinds[0]];
  for (let i = 0; i < 12; i++) {
    const r = i + 2;
    const h = startHour + i;
    data[`A${r}`] = `${String(h).padStart(2, '0')}:00`;
    let e; let x;
    switch (kinds[i]) {
      case 'zero': e = 0; x = 0; break;
      case 'peak': e = rng.int(420, 640); x = rng.int(160, 300); break;
      case 'busy': e = rng.int(220, 380); x = rng.int(120, 260); break;
      case 'normal': e = rng.int(80, 200); x = rng.int(50, 160); break;
      default: e = rng.int(10, 60); x = rng.int(5, 50); break;
    }
    data[`B${r}`] = e;
    data[`C${r}`] = x;
  }
  return { data, initial: {}, params: { startHour } };
}

function genL3(rng, { ageLimit = 60 } = {}) {
  const data = { A1: 'PassengerID', B1: 'Age', C1: 'AssistPass', D1: 'ValidCard', E1: 'PriorityFlag', G1: 'AgeLimit', G2: 'EligibleTotal' };
  data.H1 = ageLimit;
  const L = ageLimit;
  // 必備的診斷案例（spec §5 L3 Dataset constraints）
  const required = [
    [L, 'NO', true], // 剛好達標（>= vs >）
    [L - 1, 'NO', true], // 差一歲
    [rng.int(L + 3, L + 25), 'NO', true], // 只有年齡符合
    [rng.int(15, L - 10), 'YES', true], // 只有 AssistPass 符合
    [rng.int(L + 1, L + 20), 'YES', false], // 兩者皆符合但卡無效
    [rng.int(12, L - 15), 'NO', true], // 兩者皆不符合
    [rng.int(L + 2, L + 25), 'YES', true], // 兩者皆符合且有效
    [L - 1, 'YES', true], // 差一歲但有通行證
  ];
  const rows = [...required];
  while (rows.length < 24) {
    const age = rng.chance(0.4) ? rng.int(L, L + 28) : rng.int(10, L - 1);
    rows.push([age, rng.chance(0.25) ? 'YES' : 'NO', rng.chance(0.78)]);
  }
  const ids = rng.uniqueInts(24, 100, 999);
  rng.shuffle(rows).forEach((row, i) => {
    const r = i + 2;
    data[`A${r}`] = `P${ids[i]}`;
    data[`B${r}`] = row[0];
    data[`C${r}`] = row[1];
    data[`D${r}`] = row[2];
  });
  return { data, initial: {}, params: { ageLimit } };
}

const CATS = ['UMBRELLA', 'BAG', 'PHONE', 'JACKET', 'OTHER'];
const CAT_VALUE = { UMBRELLA: [2, 18], BAG: [5, 90], PHONE: [40, 600], JACKET: [10, 95], OTHER: [1, 60] }; // x10

function genL4(rng, { avoidCategory, avoidMin } = {}) {
  const data = { A1: 'ItemID', B1: 'Category', C1: 'EstimatedValue', D1: 'FoundTime', G1: 'MinValue', G2: 'TargetCategory', I1: 'ANSWER', J2: 'CategoryCount', J3: 'CategoryTotalValue', J4: 'HighValueTotal' };
  const weights = CATS.map(() => rng.int(80, 130));
  const wsum = weights.reduce((a, b) => a + b, 0);
  const counts = weights.map((w) => Math.floor((w / wsum) * 500));
  counts[0] += 500 - counts.reduce((a, b) => a + b, 0);
  const cats = rng.shuffle(CATS.flatMap((c, i) => Array(counts[i]).fill(c)));
  const ids = rng.uniqueInts(500, 10000, 99999);
  const values = [];
  for (let i = 0; i < 500; i++) {
    const r = i + 2;
    const cat = cats[i];
    const [lo, hi] = CAT_VALUE[cat];
    const v = rng.int(lo, hi) * 10;
    values.push(v);
    const lunch = rng.chance(0.34);
    const hh = lunch ? rng.int(12, 13) : rng.pick([7, 8, 9, 10, 11, 14, 15, 16, 17, 18, 19, 20, 21, 22]);
    const mm = rng.int(0, 59);
    data[`A${r}`] = `LF${ids[i]}`;
    data[`B${r}`] = cat;
    data[`C${r}`] = v;
    data[`D${r}`] = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  const candidates = [...new Set(values.filter((v) => v >= 300 && v <= 1500 && v !== avoidMin))];
  data.H1 = rng.pick(candidates);
  data.H2 = rng.pick(CATS.filter((c) => c !== 'OTHER' && c !== avoidCategory));
  return { data, initial: {}, params: { minValue: data.H1, targetCategory: data.H2 } };
}

const CODE_POOL = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'.split('');
const HIDDEN_WORDS = ['TRAIN', 'PLATE', 'GHOST', 'CRANE', 'STAMP', 'BRICK', 'FROST'];

function genL5(rng, word = 'LUNCH') {
  const lv = LEVEL_BY_NUM[5];
  const data = { A1: 'Code', B1: 'Position', C1: 'Letter', D1: 'Method', G2: 'SecretWord' };
  const lengths = [4, 4, 3, 4, 3];
  const codes = [];
  lv.methods.forEach((method, i) => {
    const r = i + 2;
    const len = lengths[i];
    const target = word[i];
    const pos = method === 'LEFT' ? 1 : method === 'RIGHT' ? len : rng.int(2, len - 1);
    const pool = CODE_POOL.filter((c) => c !== target);
    const chars = [];
    for (let k = 1; k <= len; k++) {
      if (k === pos) { chars.push(target); continue; }
      let c;
      do { c = rng.pick(pool); } while (chars.includes(c));
      chars.push(c);
    }
    // 確保最少有一個數字，令代碼是「英文及數字混合」
    if (!chars.some((c) => /\d/.test(c))) {
      const k = [...Array(len).keys()].find((j) => j + 1 !== pos);
      chars[k] = rng.pick('23456789'.split('').filter((d) => !chars.includes(d)));
    }
    const code = chars.join('');
    codes.push(code);
    data[`A${r}`] = code;
    if (method === 'MID') data[`B${r}`] = pos;
    data[`D${r}`] = method;
  });
  return { data, initial: {}, params: { word, codes } };
}

const GENERATORS = { 1: genL1, 2: genL2, 3: genL3, 4: genL4, 5: genL5 };

// ---------------------------------------------------------------- 工作簿與參考解答
export function buildLevelWorkbook(levelData, levelNum, answerInputs = {}) {
  const lv = LEVEL_BY_NUM[levelNum];
  const wb = new Workbook();
  wb.addSheet(lv.sheet, lv.maxRow, lv.maxCol);
  for (const [a, v] of Object.entries(levelData.data)) wb.setInput(lv.sheet, a, v);
  for (const [a, v] of Object.entries(levelData.initial)) wb.setInput(lv.sheet, a, v);
  for (const [a, v] of Object.entries(answerInputs)) wb.setInput(lv.sheet, a, v);
  return wb;
}

export function solveReference(levelData, levelNum) {
  const lv = LEVEL_BY_NUM[levelNum];
  const wb = buildLevelWorkbook(levelData, levelNum, lv.referenceFormulas);
  const out = {};
  for (const a of Object.keys(lv.referenceFormulas)) out[a] = wb.getValue(lv.sheet, a);
  return out;
}

// ---------------------------------------------------------------- 單隊約束
export function checkTeamConstraints(levels, hidden) {
  const problems = [];
  const ref = {};
  for (const n of [1, 2, 3, 4, 5]) {
    ref[n] = solveReference(levels[n], n);
    for (const [a, v] of Object.entries(ref[n])) if (isError(v)) problems.push(`L${n} ${a} 參考答案出現錯誤值 ${v.code}`);
  }
  // L1
  {
    const d = levels[1].data;
    for (let r = 2; r <= 21; r++) if (ref[1][`F${r}`] < 0) problems.push(`L1 第 ${r} 列出現負餘額`);
    const buggy = buildLevelWorkbook(levels[1], 1, { H3: ref[1].H3 });
    let differ = 0;
    for (let r = 2; r <= 21; r++) if (Math.abs((buggy.getValue('L1_Fare', `D${r}`) ?? 0) - ref[1][`D${r}`]) > 1e-9) differ++;
    if (differ < 10) problems.push('L1 錯誤複製版本與正確版本不同的列少於 10');
    const fares = []; for (let r = 2; r <= 21; r++) fares.push(d[`C${r}`]);
    if (fares.some((f) => f % 10 !== 0)) problems.push('L1 FarePerTrip 必須是 10 的倍數');
    const fs = []; for (let r = 2; r <= 21; r++) fs.push(ref[1][`F${r}`]);
    if (fs.filter((x) => x === Math.min(...fs)).length > 1) problems.push('L1 Bonus 最低餘額不唯一');
  }
  // L2
  {
    const tot = []; const singles = [];
    for (let r = 2; r <= 13; r++) { tot.push(ref[2][`D${r}`]); singles.push(levels[2].data[`B${r}`], levels[2].data[`C${r}`]); }
    const mx = Math.max(...tot);
    if (tot.filter((t) => t === mx).length !== 1) problems.push('L2 最高 TotalFlow 不唯一');
    if (Math.max(...singles) === mx) problems.push('L2 MAX(B2:C13) 等於最高 TotalFlow，無法辨識錯誤');
    if (!tot.includes(0)) problems.push('L2 缺少 0 人流時段');
    if (levels[2].data.B2 === 0 || levels[2].data.C2 === 0) problems.push('L2 第一個時段的進站或出站為 0，無法辨識只加一欄的錯誤');
  }
  // L3
  {
    const lvl3 = levels[3].data; const L = lvl3.H1;
    const rows = []; for (let r = 2; r <= 25; r++) rows.push([lvl3[`B${r}`], lvl3[`C${r}`], lvl3[`D${r}`]]);
    const has = (f) => rows.some(f);
    const checks = [
      [(x) => x[0] === L, `Age=${L}`], [(x) => x[0] === L - 1, `Age=${L - 1}`],
      [(x) => x[0] >= L && x[1] === 'NO' && x[2], '只有年齡符合'], [(x) => x[0] < L && x[1] === 'YES' && x[2], '只有 AssistPass 符合'],
      [(x) => x[0] >= L && x[1] === 'YES' && !x[2], '兩者皆符合但 ValidCard=FALSE'], [(x) => x[0] < L && x[1] === 'NO', '兩者皆不符合'],
      [(x) => x[0] >= L && x[1] === 'YES' && x[2], '兩者皆符合且有效'],
    ];
    for (const [f, name] of checks) if (!has(f)) problems.push(`L3 缺少案例：${name}`);
    const elig = ref[3].H2;
    if (elig < 5 || 24 - elig < 5) problems.push('L3 合資格／不合資格人數少於 5');
  }
  // L4
  {
    const d = levels[4].data;
    const vals = []; const cats = {};
    for (let r = 2; r <= 501; r++) { vals.push(d[`C${r}`]); cats[d[`B${r}`]] = (cats[d[`B${r}`]] || 0) + 1; }
    if (new Set(Object.keys(cats)).size !== 5 || Object.values(cats).some((c) => c < 50)) problems.push('L4 某類別資料不足');
    if (!vals.includes(d.H1)) problems.push('L4 沒有剛好等於門檻 H1 的記錄');
    if (!cats[d.H2]) problems.push('L4 H2 類別不存在');
    const total = vals.reduce((a, b) => a + b, 0);
    if ([ref[4].I3, ref[4].I4].includes(total) || ref[4].I3 === ref[4].I4) problems.push('L4 類別總和與其他總和巧合相同');
    const ids = new Set(); for (let r = 2; r <= 501; r++) ids.add(d[`A${r}`]);
    if (ids.size !== 500) problems.push('L4 ItemID 不唯一');
  }
  // L5
  {
    if (ref[5].H2 !== levels[5].params.word) problems.push(`L5 秘密字詞不是 ${levels[5].params.word}`);
  }
  // 隱藏測試數據亦須通過
  if (hidden) {
    const hp = checkTeamConstraints(hidden, null).problems.map((p) => `［隱藏測試］${p}`);
    problems.push(...hp);
    const hRef5 = solveReference(hidden[5], 5).H2;
    if (hRef5 === ref[5].H2) problems.push('L5 隱藏測試字詞與公開字詞相同');
    if (hidden[1].data.H1 === levels[1].data.H1) problems.push('L1 隱藏測試的系數與公開數據相同');
    if (hidden[4].data.H1 === levels[4].data.H1 || hidden[4].data.H2 === levels[4].data.H2) problems.push('L4 隱藏測試門檻／類別與公開數據相同');
  }
  return { problems, ref };
}

/** 主要數值答案：用來比較跨隊差異 */
function mainAnswers(ref) {
  return [ref[1].H3, ref[2].H2, ref[2].H3, ref[3].H2, ref[4].I2, ref[4].I3, ref[4].I4];
}

function crossTeamProblems(cand, prev) {
  const problems = [];
  const a = mainAnswers(cand.ref);
  for (const p of prev) {
    const b = mainAnswers(p.ref);
    const diff = a.filter((x, i) => x !== b[i]).length / a.length;
    if (diff < 0.8) problems.push(`與 ${p.teamKey} 的主要答案相同比例過高`);
    if (cand.ref[1].H3 === p.ref[1].H3) problems.push(`L1 H3 與 ${p.teamKey} 相同`);
    if (cand.ref[2].H2 === p.ref[2].H2) problems.push(`L2 最高人流與 ${p.teamKey} 相同`);
    if (cand.ref[3].H2 === p.ref[3].H2) problems.push(`L3 合資格人數與 ${p.teamKey} 相同`);
    if (cand.ref[4].I4 === p.ref[4].I4) problems.push(`L4 I4 與 ${p.teamKey} 相同`);
    const pc = p.levels[5].params.codes;
    if (cand.levels[5].params.codes.some((c, i) => c === pc[i])) problems.push(`L5 代碼與 ${p.teamKey} 重複`);
  }
  return problems;
}

function genTeamLevels(teamSeed) {
  const levels = {};
  for (const n of [1, 2, 3, 4, 5]) levels[n] = GENERATORS[n](makeRng(`${teamSeed}:L${n}`));
  const hRng = (n) => makeRng(`${teamSeed}:HIDDEN:L${n}`);
  const hidden = {
    1: genL1(hRng(1), { avoidMultiplier: levels[1].data.H1 }),
    2: genL2(hRng(2)),
    3: genL3(hRng(3), { ageLimit: 65 }),
    4: genL4(hRng(4), { avoidCategory: levels[4].data.H2, avoidMin: levels[4].data.H1 }),
    5: genL5(hRng(5), hRng(5).pick(HIDDEN_WORDS)),
  };
  return { levels, hidden };
}

/** 生成全部隊伍數據（含約束檢查、自動重抽紀錄）。 */
export function generateCompetitionDatasets(competitionSeed, teamKeys) {
  const out = [];
  for (const teamKey of teamKeys) {
    const baseSeed = `${competitionSeed}:${GENERATOR_VERSION}:${teamKey}`;
    const rejected = [];
    let chosen = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const teamSeed = attempt === 0 ? baseSeed : `${baseSeed}:retry${attempt}`;
      const { levels, hidden } = genTeamLevels(teamSeed);
      const { problems, ref } = checkTeamConstraints(levels, hidden);
      const cand = { teamKey, teamSeed, levels, hidden, ref };
      if (!problems.length) problems.push(...crossTeamProblems(cand, out));
      if (problems.length) { rejected.push({ attempt, problems }); continue; }
      chosen = { ...cand, attempts: attempt + 1, rejected };
      break;
    }
    if (!chosen) throw new Error(`隊伍 ${teamKey} 的數據在 ${MAX_ATTEMPTS} 次嘗試後仍未符合約束`);
    const hiddenRef = {};
    for (const n of [1, 2, 3, 4, 5]) hiddenRef[n] = solveReference(chosen.hidden[n], n);
    chosen.hiddenRef = hiddenRef;
    chosen.checksums = Object.fromEntries([1, 2, 3, 4, 5].map((n) => [n, checksum(chosen.levels[n].data)]));
    chosen.generatorVersion = GENERATOR_VERSION;
    chosen.templateVersion = TEMPLATE_VERSION;
    chosen.flags = difficultyFlags(chosen);
    out.push(chosen);
  }
  return out;
}

function difficultyFlags(ds) {
  const d3 = ds.levels[3].data;
  let eligible = 0; for (let r = 2; r <= 25; r++) eligible += ds.ref[3][`E${r}`];
  const d4 = ds.levels[4].data;
  let atThreshold = 0; for (let r = 2; r <= 501; r++) if (d4[`C${r}`] === d4.H1) atThreshold++;
  return {
    L1_multiplier: ds.levels[1].data.H1,
    L1_rowsAffectedByMissingDollar: 19,
    L2_peakFlow: ds.ref[2].H2,
    L3_eligible: eligible,
    L3_ageLimit: d3.H1,
    L4_targetCategory: d4.H2,
    L4_minValue: d4.H1,
    L4_itemsExactlyAtThreshold: atThreshold,
    L5_codes: ds.levels[5].params.codes.join(' '),
    attempts: ds.attempts,
  };
}

export { addr };
export const ALL_LEVELS = LEVELS.map((l) => l.level);
