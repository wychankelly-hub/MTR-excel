// 第二集 Dynamic Dataset Generator：同一藍圖，各隊不同數據，難度一致；同一 seed 必得相同結果。
// 每關另有一組「隱藏測試」數據（結構相同、數值及長度不同），用來找出寫死數值或參照錯誤的公式。
import { makeRng, checksum } from '../episode1/rng.js';
import { LEVELS, LEVEL_BY_NUM, GENERATOR_VERSION, TEMPLATE_VERSION } from './blueprint.js';
import { Workbook } from '../engine/workbook.js';
import { isError } from '../engine/values.js';

const MAX_ATTEMPTS = 80;
const ALL = [1, 2, 3, 4, 5];

// ---------------------------------------------------------------- L1 門禁紀錄
const PLACES = ['GATE', 'LIFT', 'OFFICE', 'KIOSK', 'CONTROL', 'PLATFORM', 'LOCKER', 'CONCOURSE', 'EXITB', 'TICKETS'];
const HIDDEN_PLACES = ['STAIRS', 'FIRSTAID', 'BOOTH', 'CCTVROOM', 'BRIDGE', 'SUBWAYC', 'LOBBY', 'STOREROOM'];
const CODES = ['R07', 'CD1', 'FSM', 'B8', 'SEC12', 'CLN3', 'TK44', 'OP9'];
const HIDDEN_CODES = ['Q5', 'MX210', 'ZT8', 'HELP1', 'K44', 'W3'];

function hhmm(rng, lo = 1100, hi = 1359) {
  let t;
  do { t = rng.int(lo, hi); } while (t % 100 > 59);
  return String(t);
}

function genL1(rng, { places = PLACES, codes = CODES, target = 'R07', story = true } = {}) {
  const data = { A1: 'Log', B1: 'AtPos', C1: 'Time', D1: 'StaffCode', G1: 'TargetCode', G2: 'TargetCount' };
  data.H1 = target;
  const rows = [];
  const targetCount = rng.int(2, 4);
  if (story) rows.push(['OFFICE', hhmm(rng, 1225, 1240), target]);
  while (rows.filter((r) => r[2] === target).length < targetCount) rows.push([rng.pick(places), hhmm(rng), target]);
  while (rows.length < 20) {
    const code = rng.pick(codes.filter((c) => c !== target));
    rows.push([rng.pick(places), hhmm(rng), code]);
  }
  rng.shuffle(rows).forEach(([place, time, code], i) => { data[`A${i + 2}`] = `${place}@${time}#${code}`; });
  return { data, initial: {}, params: { target, targetCount } };
}

// ---------------------------------------------------------------- L2 員工名冊
const STAFF = [
  ['R07', 'ROCKET'], ['CD1', 'DING'], ['FSM', 'BOSS'], ['B8', 'BAT'],
  ['SEC12', 'GUARD'], ['CLN3', 'CLEANER'], ['TK44', 'TICKETMAN'], ['OP9', 'OPERATOR'],
];
const HIDDEN_STAFF = [
  ['Q5', 'QUINN'], ['MX210', 'MAX'], ['ZT8', 'ZOE'], ['HELP1', 'HELPER'],
  ['K44', 'KIT'], ['W3', 'WING'], ['LK9', 'LOK'], ['PY2', 'PUI'],
];
const SHIFTS = ['0700-1500', '0900-1700', '1100-1900', '1200-2000', '1500-2300'];

function genL2(rng, { staff = STAFF, visitorPrefix = 'V' } = {}) {
  const data = { A1: 'StaffCode', B1: 'Name', C1: 'Shift', G1: 'Code', H1: 'StaffName', I1: 'ShiftTime', G11: 'FindCodeOf', G12: 'Code' };
  const roster = rng.shuffle(staff).map(([code, name]) => [code, name, rng.pick(SHIFTS)]);
  roster.forEach(([code, name, shift], i) => { data[`G${i + 2}`] = code; data[`H${i + 2}`] = name; data[`I${i + 2}`] = shift; });
  const visitors = rng.uniqueInts(rng.int(2, 4), 10, 99).map((n) => `${visitorPrefix}${String(n).padStart(3, '0')}`);
  const codes = [];
  codes.push(roster[rng.int(1, 7)][0]); // 第一列一定是員工（避免第一列就測出「找不到」）
  codes.push(roster[0][0]); // 名冊第一行的號碼出現在下面：範圍沒有固定時會找不到
  codes.push(roster[7][0]); // 名冊最後一行亦要出現
  for (const v of visitors) codes.push(v);
  while (codes.length < 15) codes.push(rng.pick(roster)[0]);
  const rest = rng.shuffle(codes.slice(1));
  [codes[0], ...rest].forEach((c, i) => { data[`A${i + 2}`] = c; });
  const ask = roster[rng.int(2, 7)];
  data.H11 = ask[1];
  return { data, initial: {}, params: { visitors: visitors.length, ask: ask[1] } };
}

// ---------------------------------------------------------------- L3 現金箱對數
const ITEMS = ['TICKET', 'SNACK', 'DRINK', 'MAP', 'BADGE', 'KEYRING', 'POSTER', 'CARDFEE', 'TOWEL', 'UMBRELLA', 'PEN', 'MUG', 'BOOKMARK', 'STICKER'];

function genL3(rng, { bags = [20, 25, 50], avoidBag } = {}) {
  const data = { A1: 'Item', B1: 'UnitPrice', C1: 'Qty', D1: 'Amount', E1: 'Bags', G1: 'BagValue', G3: 'TotalDollars' };
  data.H1 = rng.pick(bags.filter((b) => b !== avoidBag));
  rng.shuffle(ITEMS).slice(0, 12).forEach((item, i) => {
    const r = i + 2;
    data[`A${r}`] = item;
    data[`B${r}`] = rng.int(105, 4995) / 100;
    data[`C${r}`] = rng.int(1, 9);
  });
  return { data, initial: {}, params: { bagValue: data.H1 } };
}

// ---------------------------------------------------------------- L4 不在場證明
const PEOPLE = ['ROCKET', 'DING', 'BOSS', 'BAT', 'GUARD', 'CLEANER', 'TICKETMAN', 'OPERATOR'];
const HIDDEN_PEOPLE = ['QUINN', 'MAX', 'ZOE', 'HELPER', 'KIT', 'WING', 'LOK', 'PUI'];
const SPOTS = ['PLATFORM-4', 'CONCOURSE', 'LIFT-LOBBY', 'CONTROL', 'KIOSK', 'EXIT-B', 'TICKET-HALL', 'STAFF-ROOM'];

function genL4(rng, { people = PEOPLE, rocketFar = true } = {}) {
  const data = { A1: 'StaffName', B1: 'Where', C1: 'X', D1: 'Y', E1: 'Distance', F1: 'Rank', G1: 'OfficeX', G2: 'OfficeY', G4: 'Closest' };
  data.H1 = rng.int(90, 130);
  data.H2 = rng.int(90, 130);
  const names = rng.shuffle(people);
  const spots = rng.shuffle(SPOTS);
  // 先決定每人的目標距離（互不相同，最少相差 3 米），再隨機方向放置；火箭仔在故事中離辦公室最遠
  const dists = [];
  while (dists.length < 8) {
    const d = rng.int(12, 85);
    if (dists.every((x) => Math.abs(x - d) >= 3)) dists.push(d);
  }
  dists.sort((a, b) => a - b);
  const far = rng.int(110, 125);
  const order = rng.shuffle(names.map((_, i) => i));
  names.forEach((name, i) => {
    const r = i + 2;
    const d = rocketFar && name === 'ROCKET' ? far : dists[order[i]];
    const t = rng.next() * Math.PI * 2;
    data[`A${r}`] = name;
    data[`B${r}`] = spots[i];
    data[`C${r}`] = Math.max(0, Math.round(data.H1 + d * Math.cos(t)));
    data[`D${r}`] = Math.max(0, Math.round(data.H2 + d * Math.sin(t)));
  });
  return { data, initial: {}, params: { office: [data.H1, data.H2], rocketFar } };
}

// ---------------------------------------------------------------- L5 隨機抽查
function genL5(rng, { lockers = 12 } = {}) {
  const data = { A1: 'Locker', B1: 'RandomKey', C1: 'CheckOrder', G1: 'Lockers', G2: 'LuckyLocker' };
  data.H1 = lockers;
  const prefix = rng.pick(['L', 'K', 'S', 'T']);
  for (let i = 0; i < 12; i++) data[`A${i + 2}`] = `${prefix}${String(i + 1).padStart(2, '0')}`;
  return { data, initial: {}, params: { lockers } };
}

const GENERATORS = { 1: genL1, 2: genL2, 3: genL3, 4: genL4, 5: genL5 };

/** 每關獨立重抽（同一 rng 繼續抽，結果仍可重現），直至該關的約束全部成立 */
function genLevel(n, rng, opts, isHidden) {
  let last = null;
  for (let i = 0; i < 200; i++) {
    const d = GENERATORS[n](rng, opts);
    const ref = solveReference(d, n);
    last = levelProblems(n, d, ref, { isHidden });
    if (!last.length) return d;
  }
  throw new Error(`L${n} 數據未能符合約束：${last.join('；')}`);
}

// ---------------------------------------------------------------- 工作簿與參考解答
/** RAND 使用固定 seed：同一數據的參考解答可重現 */
export function buildLevelWorkbook(levelData, levelNum, answerInputs = {}) {
  const lv = LEVEL_BY_NUM[levelNum];
  const wb = new Workbook();
  wb.rng = makeRng(`E2:ref:${levelNum}`).next;
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

const roundTo = (x, d) => Math.sign(x) * Math.round(Math.abs(x) * 10 ** d + 1e-9) / 10 ** d;

// ---------------------------------------------------------------- 約束
function levelProblems(n, level, ref, { isHidden = false } = {}) {
  const problems = [];
  for (const [a, v] of Object.entries(ref)) if (isError(v)) problems.push(`L${n} ${a} 參考答案出現錯誤值 ${v.code}`);
  const d = level.data;
  if (n === 1) {
    // 地點及號碼長度要不同，否則寫死位置的公式會巧合正確
    const logs = []; for (let r = 2; r <= 21; r++) logs.push(d[`A${r}`]);
    const atPos = new Set(logs.map((l) => l.indexOf('@')));
    const codeLen = new Set(logs.map((l) => l.length - l.indexOf('#') - 1));
    if (atPos.size < 3) problems.push('L1 地點長度變化不足');
    if (codeLen.size < 3) problems.push('L1 員工證號碼長度變化不足');
    const a2 = logs[0];
    if (logs.filter((l) => l.indexOf('@') === a2.indexOf('@')).length > 12) problems.push('L1 太多紀錄與第一列的 @ 位置相同');
    const c2 = a2.length - a2.indexOf('#') - 1;
    if (logs.filter((l) => l.length - l.indexOf('#') - 1 === c2).length > 12) problems.push('L1 太多號碼與第一列長度相同');
    if (ref.H2 < 2 || ref.H2 > 5) problems.push('L1 目標號碼次數不合適');
    if (!isHidden && !logs.some((l) => l.startsWith('OFFICE@12') && l.endsWith(`#${d.H1}`))) problems.push('L1 缺少故事紀錄（OFFICE 午飯時間）');
  }
  if (n === 2) {
    // 至少兩名訪客；名冊第一行及最後一行的號碼要出現在第二列或之後（範圍沒有固定時會找不到）
    const a = []; for (let r = 2; r <= 16; r++) a.push(d[`A${r}`]);
    const roster = []; for (let r = 2; r <= 9; r++) roster.push(d[`G${r}`]);
    if (a.filter((c) => !roster.includes(c)).length < 2) problems.push('L2 訪客不足');
    if (!roster.includes(a[0])) problems.push('L2 第一列不是員工');
    if (!a.slice(1).includes(roster[0])) problems.push('L2 名冊第一行的號碼沒有在下面出現');
    if (!a.slice(1).includes(roster.at(-1))) problems.push('L2 名冊最後一行的號碼沒有出現');
    if (d.H11 === d.H2) problems.push('L2 H11 是名冊第一行');
  }
  if (n === 3) {
    // ROUND 與 ROUNDUP／捨去、INT 與 ROUND 的結果要有分別
    let upDiff = 0; let downDiff = 0; let intDiff = 0; let twoDp = 0;
    for (let r = 2; r <= 13; r++) {
      const x = d[`B${r}`] * d[`C${r}`];
      const rd = roundTo(x, 1);
      if (Math.abs(rd - Math.ceil(x * 10 - 1e-9) / 10) > 1e-9) upDiff++;
      if (Math.abs(rd - Math.floor(x * 10 + 1e-9) / 10) > 1e-9) downDiff++;
      if (Math.abs(rd - roundTo(x, 2)) > 1e-9) twoDp++;
      if (Math.round(rd / d.H1) !== Math.floor(rd / d.H1)) intDiff++;
    }
    if (upDiff < 2) problems.push('L3 ROUND 與 ROUNDUP 結果相同的列太多');
    if (downDiff < 2) problems.push('L3 ROUND 與捨去結果相同的列太多');
    if (twoDp < 4) problems.push('L3 兩位小數的金額不足');
    if (intDiff < 2) problems.push('L3 INT 與 ROUND 的袋數相同的列太多');
    let full = 0; for (let r = 2; r <= 13; r++) if (ref[`E${r}`] >= 1) full++;
    if (full < 4) problems.push('L3 可以裝滿現金袋的金額太少');
    const sum = Object.keys(ref).filter((a) => a.startsWith('D')).reduce((t, a) => t + ref[a], 0);
    const frac = sum % 1;
    if (Math.abs(frac - 0.5) < 0.05 || frac < 0.05 || frac > 0.95) problems.push('L3 總和的小數部分不適合（太接近 0 或 0.5）');
  }
  if (n === 4) {
    const dist = []; for (let r = 2; r <= 9; r++) dist.push(ref[`E${r}`]);
    const sorted = [...dist].sort((x, y) => x - y);
    for (let i = 1; i < sorted.length; i++) if (sorted[i] - sorted[i - 1] < 1) problems.push('L4 兩位同事的距離太接近');
    if (sorted[0] < 5) problems.push('L4 有同事太接近辦公室');
    if (level.params.rocketFar) {
      const rocketRow = [2, 3, 4, 5, 6, 7, 8, 9].find((r) => d[`A${r}`] === 'ROCKET');
      if (ref[`F${rocketRow}`] !== 8) problems.push('L4 火箭仔不是最遠');
    }
    if (ref.H4 === d.A2) problems.push('L4 最接近的同事在第一列');
  }
  if (n === 5) {
    const ranks = []; for (let r = 2; r <= 13; r++) ranks.push(ref[`C${r}`]);
    if ([...ranks].sort((x, y) => x - y).join() !== '1,2,3,4,5,6,7,8,9,10,11,12') problems.push('L5 參考排名不是 1 至 12');
  }
  return problems;
}

/** 全隊檢查（重新計算參考解答；隱藏測試與公開數據要有分別） */
export function checkTeamConstraints(levels, hidden, { isHidden = false } = {}) {
  const problems = [];
  const ref = {};
  for (const n of ALL) {
    ref[n] = solveReference(levels[n], n);
    problems.push(...levelProblems(n, levels[n], ref[n], { isHidden }));
  }
  if (hidden) {
    problems.push(...checkTeamConstraints(hidden, null, { isHidden: true }).problems.map((p) => `［隱藏測試］${p}`));
    if (hidden[3].data.H1 === levels[3].data.H1) problems.push('L3 隱藏測試的現金袋面值與公開數據相同');
    if (hidden[5].data.H1 === levels[5].data.H1) problems.push('L5 隱藏測試的儲物櫃數目與公開數據相同');
  }
  return { problems, ref };
}

function crossTeamProblems(cand, prev) {
  const problems = [];
  for (const p of prev) {
    if (cand.levels[1].data.A2 === p.levels[1].data.A2) problems.push(`L1 第一條紀錄與 ${p.teamKey} 相同`);
    if (cand.ref[3].H3 === p.ref[3].H3) problems.push(`L3 總數與 ${p.teamKey} 相同`);
    if (cand.ref[4].H4 === p.ref[4].H4 && cand.levels[4].data.H1 === p.levels[4].data.H1) problems.push(`L4 與 ${p.teamKey} 太相似`);
  }
  return problems;
}

function genTeamLevels(teamSeed) {
  const levels = {};
  for (const n of ALL) levels[n] = genLevel(n, makeRng(`${teamSeed}:L${n}`), {}, false);
  const hRng = (n) => makeRng(`${teamSeed}:HIDDEN:L${n}`);
  const r1 = hRng(1);
  const r5 = hRng(5);
  const hidden = {
    1: genLevel(1, r1, { places: HIDDEN_PLACES, codes: HIDDEN_CODES, target: r1.pick(HIDDEN_CODES), story: false }, true),
    2: genLevel(2, hRng(2), { staff: HIDDEN_STAFF, visitorPrefix: 'X' }, true),
    3: genLevel(3, hRng(3), { bags: [10, 20, 25, 50], avoidBag: levels[3].data.H1 }, true),
    4: genLevel(4, hRng(4), { people: HIDDEN_PEOPLE, rocketFar: false }, true),
    5: genLevel(5, r5, { lockers: r5.pick([9, 15, 20]) }, true),
  };
  return { levels, hidden };
}

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
    chosen.hiddenRef = Object.fromEntries(ALL.map((n) => [n, solveReference(chosen.hidden[n], n)]));
    chosen.checksums = Object.fromEntries(ALL.map((n) => [n, checksum(chosen.levels[n].data)]));
    chosen.generatorVersion = GENERATOR_VERSION;
    chosen.templateVersion = TEMPLATE_VERSION;
    chosen.flags = difficultyFlags(chosen);
    out.push(chosen);
  }
  return out;
}

function difficultyFlags(ds) {
  return {
    L1_target: `${ds.levels[1].data.H1}×${ds.ref[1].H2}`,
    L2_visitors: ds.levels[2].params.visitors,
    L3_bag: ds.levels[3].data.H1,
    L3_total: ds.ref[3].H3,
    L4_closest: ds.ref[4].H4,
    L5_lockers: ds.levels[5].data.H1,
    attempts: ds.attempts,
  };
}

export const ALL_LEVELS = LEVELS.map((l) => l.level);
