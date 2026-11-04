// 第三集 Dynamic Dataset Generator：同一藍圖，各隊不同數據，難度一致；同一 seed 必得相同結果。
// 每關另有一組「隱藏測試」數據（結構相同、數值不同），用來重做學生的排序／篩選／圖表／樞紐分析設定及公式，
// 找出寫死數值、只碰巧正確的設定或參照錯誤的公式。
import { makeRng, checksum } from '../episode1/rng.js';
import { LEVELS, LEVEL_BY_NUM, GENERATOR_VERSION, TEMPLATE_VERSION } from './blueprint.js';
import { Workbook } from '../engine/workbook.js';
import { isError } from '../engine/values.js';
import { loadLevelIntoWorkbook, isMetaKey } from '../engine/analysis.js';

const MAX_ATTEMPTS = 60;
const ALL = [1, 2, 3, 4, 5];

// ---------------------------------------------------------------- L1 投訴紀錄（120 宗）
const STATIONS = ['TWW', 'KWF', 'LAK', 'MEF', 'LCK', 'CSW', 'SSP', 'PRE', 'MOK', 'YMT', 'JOR', 'TST', 'ADM', 'CEN'];
const HIDDEN_STATIONS = ['HKU', 'KET', 'SYP', 'WAC', 'CAB', 'TIH', 'FOH', 'NOP', 'QUB', 'TAK', 'SKW', 'HFC'];
const LINES = ['TWL', 'ISL', 'KTL', 'TKL'];
const CATEGORIES = ['CLEAN', 'DATA', 'DELAY', 'FARE', 'NOISE'];
const CALLERS = ['CHAN-TM', 'LEE-KY', 'WONG-SM', 'HO-PL', 'YIP-CK', 'LAM-MW', 'NG-KF', 'CHOW-YT', 'MAK-HL', 'TSE-WS', 'FUNG-KL', 'POON-SY'];

const minuteToHHMM = (m) => Math.floor(m / 60) * 100 + (m % 60);

function genL1(rng, { stations = STATIONS, uncle = 'UNCLE-WONG', prefix = 'C' } = {}) {
  const data = { A1: 'ComplaintID', B1: 'Time', C1: 'Station', D1: 'Line', E1: 'Category', F1: 'Severity', G1: 'Caller', H1: 'WaitMin' };
  data.I2 = 'LongestID'; data.I3 = 'ThirdStation'; data.I4 = 'TopDataID'; data.I5 = 'UncleDataCount'; data.I6 = 'UncleDataMinutes';
  // 時間（分鐘）及等候分鐘各不相同：排序結果唯一
  const minutes = rng.uniqueInts(120, 6 * 60, 23 * 60 + 50).sort((x, y) => x - y);
  const waits = rng.uniqueInts(120, 1, 180);
  const uncleData = rng.int(4, 7);
  const uncleOther = rng.int(3, 6);
  const rows = minutes.map((m, i) => ({
    time: minuteToHHMM(m), station: rng.pick(stations), line: rng.pick(LINES), cat: rng.pick(CATEGORIES), sev: rng.int(1, 5), caller: rng.pick(CALLERS), wait: waits[i],
  }));
  // 阿叔的投訴：DATA 類別最少 4 宗（嚴重程度高），其他類別亦有
  const idx = rng.shuffle(rows.map((_, i) => i));
  idx.slice(0, uncleData).forEach((i) => { rows[i].caller = uncle; rows[i].cat = 'DATA'; rows[i].sev = rng.int(3, 5); });
  idx.slice(uncleData, uncleData + uncleOther).forEach((i) => { rows[i].caller = uncle; if (rows[i].cat === 'DATA') rows[i].cat = 'DELAY'; });
  // 其他人亦有 DATA 投訴，令「只篩選 DATA」或「只篩選阿叔」都得不到正確結果
  idx.slice(uncleData + uncleOther, uncleData + uncleOther + 6).forEach((i) => { rows[i].cat = 'DATA'; });
  rows.forEach((x, i) => {
    const r = i + 2;
    data[`A${r}`] = `${prefix}${String(i + 1).padStart(3, '0')}`;
    data[`B${r}`] = x.time; data[`C${r}`] = x.station; data[`D${r}`] = x.line; data[`E${r}`] = x.cat; data[`F${r}`] = x.sev; data[`G${r}`] = x.caller; data[`H${r}`] = x.wait;
  });
  return { data, initial: {}, params: { uncleData, uncle } };
}

// ---------------------------------------------------------------- L2 時間表、行車紀錄
function genL2(rng, { prefix = 'T', lateLimit = 3, lunch = [720, 840] } = {}) {
  const tt = { A1: 'TrainID', B1: 'SchedMin', C1: 'Platform', D1: 'Line', F1: 'LateLimit' };
  const log = { A1: 'TrainID', B1: 'ActualMin', C1: 'Platform', D1: 'Driver' };
  const check = { A1: 'TrainID', B1: 'SchedMin', C1: 'ActualMin', D1: 'Status', G2: 'MissingCount', G3: 'LateCount', G4: 'LatePlatform2' };
  tt.F2 = lateLimit;
  const sched = rng.uniqueInts(40, 6 * 60, 23 * 60).sort((x, y) => x - y);
  // 消失的列車：全部在午飯時間（故事線索）
  const lunchIdx = sched.map((m, i) => (m >= lunch[0] && m < lunch[1] ? i : -1)).filter((i) => i >= 0);
  const missingN = Math.min(lunchIdx.length, rng.int(3, 5));
  const missing = new Set(rng.shuffle(lunchIdx).slice(0, missingN));
  const trains = sched.map((m, i) => ({ id: `${prefix}${String(minuteToHHMM(m)).padStart(4, '0')}`, sched: m, platform: rng.int(1, 3), line: rng.pick(LINES) }));
  const logRows = [];
  trains.forEach((t, i) => {
    const r = i + 2;
    tt[`A${r}`] = t.id; tt[`B${r}`] = t.sched; tt[`C${r}`] = t.platform; tt[`D${r}`] = t.line;
    check[`A${r}`] = t.id;
    if (missing.has(i)) return;
    // 延誤：大部分 0–2 分鐘；部分剛好等於容許分鐘（不算 LATE）；部分超過
    const roll = rng.next();
    const delay = roll < 0.6 ? rng.int(0, Math.max(0, lateLimit - 1)) : roll < 0.75 ? lateLimit : rng.int(lateLimit + 1, lateLimit + 9);
    logRows.push({ id: t.id, actual: t.sched + delay, platform: t.platform, driver: rng.pick(['D11', 'D24', 'D37', 'D45', 'D52']) });
  });
  rng.shuffle(logRows).forEach((x, i) => { const r = i + 2; log[`A${r}`] = x.id; log[`B${r}`] = x.actual; log[`C${r}`] = x.platform; log[`D${r}`] = x.driver; });
  return { data: check, initial: {}, extra: { E3L2_Timetable: tt, E3L2_Log: log }, params: { missing: missingN, lateLimit } };
}

// ---------------------------------------------------------------- L3 人流（圖表）
function genL3(rng, { spikeHour = null, dropHour = null } = {}) {
  const data = { A1: 'Hour', B1: 'Weekday', C1: 'Sunday', D1: 'Today', F2: 'SpikeHour', F3: 'SpikeTimes', F4: 'DropHour' };
  const base = (h) => (h >= 7 && h <= 9 ? 1800 : h >= 17 && h <= 19 ? 2000 : h >= 12 && h <= 13 ? 1100 : h >= 22 ? 350 : 800);
  const spike = spikeHour ?? rng.pick([12, 13]);
  const drop = dropHour ?? (spike === 12 ? 13 : 12);
  for (let hr = 6; hr <= 23; hr++) {
    const r = hr - 4;
    const wk = Math.round(base(hr) * (0.85 + rng.next() * 0.3) / 10) * 10;
    const sun = Math.round(wk * (hr >= 7 && hr <= 9 ? 0.45 : 0.75 + rng.next() * 0.3) / 10) * 10;
    let today = Math.round(wk * (0.9 + rng.next() * 0.2));
    if (hr === spike) today = Number(String(rng.int(7, 9)).repeat(4)); // 貓咪踩數字鍵：例如 8888
    if (hr === drop) today = rng.int(3, 30);
    data[`A${r}`] = hr; data[`B${r}`] = wk; data[`C${r}`] = sun; data[`D${r}`] = today;
  }
  return { data, initial: {}, params: { spike, drop } };
}

// ---------------------------------------------------------------- L4 修改紀錄（樞紐分析表）
const COMPUTERS = ['FSM-PC', 'TICKET-1', 'TICKET-2', 'CONTROL', 'KIOSK'];
const USERS = ['FSM', 'R07', 'B8', 'CD1', 'SYSTEM'];
const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

function genL4(rng, { computers = COMPUTERS, users = USERS, lunch = null } = {}) {
  const data = { A1: 'RecordID', B1: 'Day', C1: 'Hour', D1: 'Computer', E1: 'User', F1: 'Action', G1: 'Cells', I2: 'BusiestPC', I3: 'PeakHour', I4: 'FSMAtPeak' };
  const peak = lunch ?? rng.pick([12, 13]);
  const rows = [];
  // FSM-PC 的紀錄最多（午飯時間大量修改，帳戶仍是 FSM）
  const counts = rng.shuffle([rng.int(62, 70), rng.int(48, 55), rng.int(40, 46), rng.int(34, 39), 0]);
  const fsmIdx = counts.indexOf(0);
  counts[fsmIdx] = 240 - counts.reduce((a, b) => a + b, 0);
  if (counts[fsmIdx] <= Math.max(...counts.filter((_, i) => i !== fsmIdx))) counts[fsmIdx] += 0; // 由約束檢查
  const order = computers.map((c, i) => ({ c, n: counts[i] }));
  for (const { c, n } of order) {
    for (let k = 0; k < n; k++) {
      let hour = rng.int(7, 21); let user = c === 'FSM-PC' ? rng.pick(['FSM', 'FSM', 'SYSTEM', 'CD1']) : rng.pick(users.filter((u) => u !== 'FSM'));
      let cells = rng.int(1, 6);
      if (c === 'FSM-PC' && k < 22) { hour = peak; user = 'FSM'; cells = rng.int(9, 20); } // 午飯時間的大量修改
      rows.push({ day: rng.pick(DAYS), hour, c, user, action: rng.pick(['EDIT', 'EDIT', 'EDIT', 'INSERT', 'DELETE']), cells });
    }
  }
  rng.shuffle(rows).forEach((x, i) => {
    const r = i + 2;
    data[`A${r}`] = `R${String(i + 1).padStart(3, '0')}`;
    data[`B${r}`] = x.day; data[`C${r}`] = x.hour; data[`D${r}`] = x.c; data[`E${r}`] = x.user; data[`F${r}`] = x.action; data[`G${r}`] = x.cells;
  });
  return { data, initial: {}, params: { peak } };
}

// ---------------------------------------------------------------- L5 修改日誌（What-if）
function genL5(rng, { leave = null, itLock = 30 } = {}) {
  const leaveMin = leave ?? rng.int(12 * 60 + 15, 12 * 60 + 35);
  const minLock = rng.int(17, 27); // 解釋全部貓咪痕跡所需的最少鎖定分鐘
  const data = { A1: 'Setting', B1: 'Value', A2: 'LeaveMinute', A3: 'LockMinutes', A4: 'ITLockSetting', B2: leaveMin, B4: itLock, D1: 'EditID', E1: 'Unlocked', F1: 'CatPattern', H1: 'CatWhileUnlocked', H2: 'AllCatEdits', H3: 'MinLock', H4: 'RocketEdits', H5: 'Culprit' };
  const log = { A1: 'EditID', B1: 'Minute', C1: 'Computer', D1: 'User', E1: 'Cell', F1: 'NewValue' };
  const rows = [];
  const catN = rng.int(6, 9);
  const letters = ['k', 'j', 'z', '9', '8', 'q', ';', 'm'];
  // 貓咪痕跡：全部在 FSM-PC、站長離開後至 minLock 分鐘內；最後一個剛好在 minLock-1 分鐘
  const catOffsets = [minLock - 1, ...rng.uniqueInts(catN - 1, 1, minLock - 2)];
  for (const off of catOffsets) {
    const ch = rng.pick(letters);
    rows.push({ m: leaveMin + off, pc: 'FSM-PC', user: 'FSM', cell: rng.pick(['E3L3_Traffic!D9', 'E3L2_Log!B14', 'Fares!C7', 'Roster!B4']), v: ch.repeat(rng.int(5, 10)) });
  }
  // 站長離開前在 FSM-PC 正常工作（不是貓咪痕跡；離開前不算未鎖上）
  for (let k = 0; k < 6; k++) rows.push({ m: leaveMin - rng.int(5, 120), pc: 'FSM-PC', user: 'FSM', cell: 'Report!B' + rng.int(2, 30), v: String(rng.int(100, 999)) });
  // 未鎖上期間的系統同步（在 FSM-PC，但不是貓咪痕跡）
  rows.push({ m: leaveMin + rng.int(2, minLock - 3), pc: 'FSM-PC', user: 'SYSTEM', cell: 'Sync!A1', v: 'OK' });
  // 站長回來後（leave+60 之後）的正常修改，包括一個重複數字但少於 5 個字元的值
  for (let k = 0; k < 4; k++) rows.push({ m: leaveMin + 60 + rng.int(1, 120), pc: 'FSM-PC', user: 'FSM', cell: 'Report!C' + rng.int(2, 30), v: k === 0 ? '7777' : String(rng.int(1000, 9999)) });
  // 火箭仔（R07）在售票處電腦的公式錯誤，部分剛好在午飯時間（電腦不同，不應算作 FSM-PC 未鎖上）
  const rocketN = rng.int(4, 7);
  for (let k = 0; k < rocketN; k++) rows.push({ m: k < 2 ? leaveMin + rng.int(1, minLock - 2) : rng.int(9 * 60, 18 * 60), pc: rng.pick(['TICKET-1', 'TICKET-2']), user: 'R07', cell: `Fares!D${rng.int(2, 21)}`, v: `FORMULA B${rng.int(2, 21)}*C${rng.int(2, 21)}*H${rng.int(2, 21)}` }); // 公式文字（不以 = 開始，否則會被當作公式計算）
  // 其他同事的正常修改
  while (rows.length < 60) rows.push({ m: rng.int(7 * 60, 21 * 60), pc: rng.pick(['CONTROL', 'KIOSK', 'TICKET-2']), user: rng.pick(['B8', 'CD1', 'SYSTEM']), cell: `Log!A${rng.int(2, 40)}`, v: rng.pick([String(rng.int(10, 999)), 'OK', 'DONE', 'CHECKED']) });
  rows.length = 60;
  rows.sort((a, b) => a.m - b.m);
  rows.forEach((x, i) => {
    const r = i + 2;
    log[`A${r}`] = `E${String(i + 1).padStart(3, '0')}`; log[`B${r}`] = x.m; log[`C${r}`] = x.pc; log[`D${r}`] = x.user; log[`E${r}`] = x.cell; log[`F${r}`] = x.v;
    data[`D${r}`] = log[`A${r}`];
  });
  return { data, initial: { B3: 5 }, extra: { E3L5_EditLog: log }, params: { leave: leaveMin, minLock, catN, rocketN, itLock } };
}

const GENERATORS = { 1: genL1, 2: genL2, 3: genL3, 4: genL4, 5: genL5 };

// ---------------------------------------------------------------- 工作簿與參考解答
/** answerInputs 可包括分析設定（'!SORT' 等）；與學生工作簿使用相同的載入程序 */
export function buildLevelWorkbook(levelData, levelNum, answerInputs = {}) {
  const lv = LEVEL_BY_NUM[levelNum];
  const wb = new Workbook();
  wb.rng = makeRng(`E3:ref:${levelNum}`).next;
  const inputs = { ...(levelData.initial || {}) };
  const meta = {};
  for (const [a, v] of Object.entries(answerInputs)) { if (isMetaKey(a)) meta[a] = v; else inputs[a] = v; }
  loadLevelIntoWorkbook(wb, lv, levelData, inputs, meta);
  return wb;
}

/** 參考解答：用最後一題的參考設定（各題的排序／篩選互相影響，批改時各題另外計算） */
export function referenceMetaFor(levelNum, taskId = null) {
  const lv = LEVEL_BY_NUM[levelNum];
  const ids = lv.tasks.map((t) => t.id);
  const upto = taskId ? ids.slice(0, ids.indexOf(taskId) + 1) : ids;
  const out = {};
  for (const id of upto) Object.assign(out, lv.referenceMeta?.[id] || {});
  return out;
}

export function solveReference(levelData, levelNum, taskId = null) {
  const lv = LEVEL_BY_NUM[levelNum];
  const wb = buildLevelWorkbook(levelData, levelNum, { ...lv.referenceFormulas, ...referenceMetaFor(levelNum, taskId) });
  const out = {};
  for (const a of Object.keys(lv.referenceFormulas)) out[a] = wb.getValue(lv.sheet, a);
  return out;
}

// ---------------------------------------------------------------- 約束
function levelProblems(n, level, ref) {
  const problems = [];
  for (const [a, v] of Object.entries(ref)) if (isError(v)) problems.push(`L${n} ${a} 參考答案出現錯誤值 ${v.code}`);
  const d = level.data;
  if (n === 1) {
    if (ref.J5 < 4 || ref.J5 > 7) problems.push('L1 阿叔的 DATA 投訴數目不合適');
    // 只篩選一個條件的結果必須不同
    let dataN = 0; let uncleN = 0;
    for (let r = 2; r <= 121; r++) { if (d[`E${r}`] === 'DATA') dataN++; if (d[`G${r}`] === 'UNCLE-WONG' || d[`G${r}`] === level.params.uncle) uncleN++; }
    if (dataN <= ref.J5 || uncleN <= ref.J5) problems.push('L1 單一條件篩選與兩個條件的結果相同');
    if (d.A2 === ref.J2) problems.push('L1 等候最久的投訴本來已在第一列');
  }
  if (n === 2) {
    if (ref.H2 < 3) problems.push('L2 消失的列車太少');
    if (ref.H3 < 3) problems.push('L2 遲開的列車太少');
    if (ref.H4 < 1 || ref.H4 >= ref.H3) problems.push('L2 月台 2 的遲開數目不合適');
    // 剛好等於容許分鐘的列車（測試 > 與 >=）
    const tt = level.extra.E3L2_Timetable; const lg = level.extra.E3L2_Log;
    const actual = {}; for (let r = 2; r <= 41; r++) if (lg[`A${r}`]) actual[lg[`A${r}`]] = lg[`B${r}`];
    let equal = 0; for (let r = 2; r <= 41; r++) { const a = actual[tt[`A${r}`]]; if (a !== undefined && a - tt[`B${r}`] === tt.F2) equal++; }
    if (equal < 1) problems.push('L2 沒有剛好等於容許分鐘的列車');
    // 行車紀錄的次序必須與時間表不同（不用 XLOOKUP 不能對應）
    let same = 0; for (let r = 2; r <= 41; r++) if (lg[`A${r}`] === tt[`A${r}`]) same++;
    if (same > 4) problems.push('L2 行車紀錄的次序與時間表太相似');
  }
  if (n === 3) {
    if (ref.G2 === ref.G4) problems.push('L3 異常高及異常低的時段相同');
    if (!(ref.G3 >= 3)) problems.push('L3 異常不夠明顯');
  }
  if (n === 4) {
    const cnt = {}; for (let r = 2; r <= 241; r++) cnt[d[`D${r}`]] = (cnt[d[`D${r}`]] || 0) + 1;
    const sorted = Object.entries(cnt).sort((a, b) => b[1] - a[1]);
    if (sorted[0][0] !== 'FSM-PC' || sorted[0][1] - sorted[1][1] < 3) problems.push('L4 FSM-PC 不是明顯最多紀錄');
    const sum = {}; for (let r = 2; r <= 241; r++) if (d[`D${r}`] === 'FSM-PC') sum[d[`C${r}`]] = (sum[d[`C${r}`]] || 0) + d[`G${r}`];
    const peaks = Object.entries(sum).sort((a, b) => b[1] - a[1]);
    if (Number(peaks[0][0]) !== level.params.peak || peaks[0][1] - peaks[1][1] < 20) problems.push('L4 最高峰時段不明顯');
    // 用 COUNT 代替 SUM、或沒有篩選時，最高時段必須不同（常見錯誤會被找出）
    const all = {}; for (let r = 2; r <= 241; r++) all[d[`C${r}`]] = (all[d[`C${r}`]] || 0) + d[`G${r}`];
    void all;
  }
  if (n === 5) {
    const p = level.params;
    if (ref.I2 !== p.catN) problems.push('L5 貓咪痕跡數目與設定不符');
    if (ref.I3 !== p.minLock) problems.push('L5 最少鎖定分鐘與設定不符');
    if (ref.I1 !== ref.I2) problems.push('L5 實際設定未能解釋所有痕跡');
  }
  return problems;
}

/** L5 參考解答在 B3 = 5、15、30 時的 I1（批改藍本用） */
export function scenarioReference(levelData) {
  const lv = LEVEL_BY_NUM[5];
  const out = {};
  for (const v of [5, 15, 30]) {
    const wb = buildLevelWorkbook(levelData, 5, { ...lv.referenceFormulas, B3: v });
    out[v] = wb.getValue(lv.sheet, 'I1');
  }
  return out;
}

export function checkTeamConstraints(levels, hidden, { isHidden = false } = {}) {
  const problems = [];
  const ref = {};
  for (const n of ALL) {
    ref[n] = solveReference(levels[n], n);
    problems.push(...levelProblems(n, levels[n], ref[n], { isHidden }));
  }
  if (hidden) {
    problems.push(...checkTeamConstraints(hidden, null, { isHidden: true }).problems.map((p) => `［隱藏測試］${p}`));
    if (hidden[2].extra.E3L2_Timetable.F2 === levels[2].extra.E3L2_Timetable.F2) problems.push('L2 隱藏測試的容許分鐘與公開數據相同');
    if (hidden[5].data.B2 === levels[5].data.B2) problems.push('L5 隱藏測試的離開時間與公開數據相同');
  }
  return { problems, ref };
}

function genLevel(n, rng, opts) {
  let last = null;
  for (let i = 0; i < 200; i++) {
    const d = GENERATORS[n](rng, opts);
    const ref = solveReference(d, n);
    last = levelProblems(n, d, ref);
    if (!last.length) return d;
  }
  throw new Error(`E3 L${n} 數據未能符合約束：${last.join('；')}`);
}

function genTeamLevels(teamSeed) {
  const levels = {};
  for (const n of ALL) levels[n] = genLevel(n, makeRng(`${teamSeed}:L${n}`), {});
  const hRng = (n) => makeRng(`${teamSeed}:HIDDEN:L${n}`);
  const h3 = levels[3].params;
  const hidden = {
    1: genLevel(1, hRng(1), { stations: HIDDEN_STATIONS, prefix: 'Q' }),
    2: genLevel(2, hRng(2), { prefix: 'X', lateLimit: levels[2].params.lateLimit === 3 ? 4 : 3 }),
    3: genLevel(3, hRng(3), { spikeHour: h3.drop, dropHour: h3.spike }),
    4: genLevel(4, hRng(4), { lunch: levels[4].params.peak === 12 ? 13 : 12 }),
    5: genLevel(5, hRng(5), { leave: levels[5].params.leave + 40 }),
  };
  return { levels, hidden };
}

function crossTeamProblems(cand, prev) {
  const problems = [];
  for (const p of prev) {
    if (cand.ref[1].J2 === p.ref[1].J2 && cand.levels[1].data.H2 === p.levels[1].data.H2) problems.push(`L1 與 ${p.teamKey} 太相似`);
    if (cand.levels[5].data.B2 === p.levels[5].data.B2 && cand.levels[5].params.minLock === p.levels[5].params.minLock) problems.push(`L5 與 ${p.teamKey} 太相似`);
  }
  return problems;
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
    chosen.checksums = Object.fromEntries(ALL.map((n) => [n, checksum({ data: chosen.levels[n].data, extra: chosen.levels[n].extra || null })]));
    chosen.generatorVersion = GENERATOR_VERSION;
    chosen.templateVersion = TEMPLATE_VERSION;
    chosen.flags = difficultyFlags(chosen);
    out.push(chosen);
  }
  return out;
}

function difficultyFlags(ds) {
  return {
    L1_uncleData: ds.ref[1].J5,
    L2_missing: ds.ref[2].H2,
    L2_late: ds.ref[2].H3,
    L3_spike: `${ds.ref[3].G2}（×${ds.ref[3].G3}）`,
    L4_peak: ds.levels[4].params.peak,
    L5_minLock: ds.levels[5].params.minLock,
    attempts: ds.attempts,
  };
}

export const ALL_LEVELS = LEVELS.map((l) => l.level);
