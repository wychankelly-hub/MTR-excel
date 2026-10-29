// 已支援的試算表函數。每個函數收到「未求值的 AST 參數」以支援 IF 的惰性求值。
import { ErrorValue, isError, isRange, isBlank, toNumber, toText, toBool, compare } from './values.js';

/** 把參數展開為值列表；fromRange 標記值是否來自範圍（Excel 對範圍內文字/布林的處理不同） */
function flatten(ev, args) {
  const out = [];
  for (const a of args) {
    if (a.type === 'empty') continue;
    const v = ev.evalNode(a);
    if (isRange(v)) {
      for (const row of v.values()) for (const x of row) out.push({ v: x, fromRange: true });
    } else out.push({ v, fromRange: false });
  }
  return out;
}

function numericArgs(ev, args) {
  const nums = [];
  for (const { v, fromRange } of flatten(ev, args)) {
    if (isError(v)) return v;
    if (fromRange) {
      if (typeof v === 'number') nums.push(v);
      continue;
    }
    const n = toNumber(v);
    if (isError(n)) return n;
    nums.push(n);
  }
  return nums;
}

function scalar(ev, node) {
  const v = ev.evalNode(node);
  if (isRange(v)) return v.single();
  return v;
}

function argCount(name, args, min, max) {
  if (args.length < min || args.length > max) {
    const exp = min === max ? `${min}` : max === Infinity ? `至少 ${min}` : `${min}–${max}`;
    return new ErrorValue('#N/A', `${name} 需要 ${exp} 個參數，現在有 ${args.length} 個`);
  }
  return null;
}

// ---------- COUNTIF / SUMIF 條件 ----------
function wildcardToRegex(s) {
  let re = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '~' && i + 1 < s.length) { re += s[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue; }
    if (c === '*') re += '.*';
    else if (c === '?') re += '.';
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'is');
}

export function makeCriteria(crit) {
  if (isError(crit)) return crit;
  if (typeof crit === 'number') return (v) => typeof v === 'number' && compare(v, crit) === 0;
  if (typeof crit === 'boolean') return (v) => v === crit;
  if (isBlank(crit)) crit = '';
  const m = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(crit);
  const op = m[1] || '=';
  const operand = m[2];
  const num = operand.trim() !== '' && Number.isFinite(Number(operand)) ? Number(operand) : null;
  const opFn = {
    '=': (c) => c === 0, '<>': (c) => c !== 0, '<': (c) => c < 0, '>': (c) => c > 0, '<=': (c) => c <= 0, '>=': (c) => c >= 0,
  }[op];
  if (num !== null) {
    return (v) => {
      if (typeof v === 'number') return opFn(compare(v, num));
      return op === '<>';
    };
  }
  const up = operand.toUpperCase();
  if (up === 'TRUE' || up === 'FALSE') {
    const b = up === 'TRUE';
    return (v) => (typeof v === 'boolean' ? opFn(v === b ? 0 : 1) : op === '<>');
  }
  if (op === '=' || op === '<>') {
    if (operand === '') return (v) => (op === '=' ? isBlank(v) || v === '' : !(isBlank(v) || v === ''));
    const re = wildcardToRegex(operand);
    return (v) => {
      const hit = typeof v === 'string' && re.test(v);
      return op === '=' ? hit : !hit;
    };
  }
  return (v) => typeof v === 'string' && opFn(compare(v, operand));
}

function textArg(ev, node) {
  const v = scalar(ev, node);
  return toText(v);
}

function intArg(ev, node, dflt) {
  if (!node || node.type === 'empty') return dflt;
  const v = toNumber(scalar(ev, node));
  if (isError(v)) return v;
  return Math.trunc(v);
}

export const FUNCTIONS = {
  SUM(ev, args) {
    const e = argCount('SUM', args, 1, 255); if (e) return e;
    const nums = numericArgs(ev, args);
    return isError(nums) ? nums : nums.reduce((a, b) => a + b, 0);
  },
  AVERAGE(ev, args) {
    const e = argCount('AVERAGE', args, 1, 255); if (e) return e;
    const nums = numericArgs(ev, args);
    if (isError(nums)) return nums;
    if (nums.length === 0) return new ErrorValue('#DIV/0!', 'AVERAGE 範圍內沒有數值');
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  },
  MAX(ev, args) {
    const e = argCount('MAX', args, 1, 255); if (e) return e;
    const nums = numericArgs(ev, args);
    if (isError(nums)) return nums;
    return nums.length ? Math.max(...nums) : 0;
  },
  MIN(ev, args) {
    const e = argCount('MIN', args, 1, 255); if (e) return e;
    const nums = numericArgs(ev, args);
    if (isError(nums)) return nums;
    return nums.length ? Math.min(...nums) : 0;
  },
  COUNT(ev, args) {
    const e = argCount('COUNT', args, 1, 255); if (e) return e;
    let c = 0;
    for (const { v, fromRange } of flatten(ev, args)) {
      if (typeof v === 'number') c++;
      else if (!fromRange && !isError(v) && !isError(toNumber(v)) && !isBlank(v)) c++;
    }
    return c;
  },
  COUNTA(ev, args) {
    const e = argCount('COUNTA', args, 1, 255); if (e) return e;
    return flatten(ev, args).filter(({ v }) => !isBlank(v)).length;
  },
  COUNTBLANK(ev, args) {
    const e = argCount('COUNTBLANK', args, 1, 1); if (e) return e;
    return flatten(ev, args).filter(({ v }) => isBlank(v) || v === '').length;
  },
  IF(ev, args) {
    const e = argCount('IF', args, 2, 3); if (e) return e;
    const c = toBool(scalar(ev, args[0]));
    if (isError(c)) return c;
    if (c) return args[1].type === 'empty' ? 0 : scalar(ev, args[1]);
    if (args.length < 3) return false;
    return args[2].type === 'empty' ? 0 : scalar(ev, args[2]);
  },
  AND(ev, args) {
    const e = argCount('AND', args, 1, 255); if (e) return e;
    let any = false;
    let res = true;
    for (const { v, fromRange } of flatten(ev, args)) {
      if (isError(v)) return v;
      if (fromRange && (typeof v === 'string' || isBlank(v))) continue;
      const b = toBool(v);
      if (isError(b)) return b;
      any = true;
      res = res && b;
    }
    return any ? res : new ErrorValue('#VALUE!', 'AND 沒有可判斷的條件');
  },
  OR(ev, args) {
    const e = argCount('OR', args, 1, 255); if (e) return e;
    let any = false;
    let res = false;
    for (const { v, fromRange } of flatten(ev, args)) {
      if (isError(v)) return v;
      if (fromRange && (typeof v === 'string' || isBlank(v))) continue;
      const b = toBool(v);
      if (isError(b)) return b;
      any = true;
      res = res || b;
    }
    return any ? res : new ErrorValue('#VALUE!', 'OR 沒有可判斷的條件');
  },
  NOT(ev, args) {
    const e = argCount('NOT', args, 1, 1); if (e) return e;
    const b = toBool(scalar(ev, args[0]));
    return isError(b) ? b : !b;
  },
  COUNTIF(ev, args) {
    const e = argCount('COUNTIF', args, 2, 2); if (e) return e;
    const rng = ev.evalNode(args[0]);
    if (!isRange(rng)) return new ErrorValue('#VALUE!', 'COUNTIF 第一個參數需要是儲存格範圍');
    const match = makeCriteria(scalar(ev, args[1]));
    if (isError(match)) return match;
    let c = 0;
    for (const row of rng.values()) for (const v of row) if (match(v)) c++;
    return c;
  },
  SUMIF(ev, args) {
    const e = argCount('SUMIF', args, 2, 3); if (e) return e;
    const rng = ev.evalNode(args[0]);
    if (!isRange(rng)) return new ErrorValue('#VALUE!', 'SUMIF 第一個參數需要是儲存格範圍');
    const match = makeCriteria(scalar(ev, args[1]));
    if (isError(match)) return match;
    let sumRng = rng;
    if (args.length === 3 && args[2].type !== 'empty') {
      sumRng = ev.evalNode(args[2]);
      if (!isRange(sumRng)) return new ErrorValue('#VALUE!', 'SUMIF 第三個參數需要是儲存格範圍');
      sumRng = sumRng.resize(rng.height, rng.width);
    }
    const cv = rng.values();
    const sv = sumRng.values();
    let s = 0;
    for (let i = 0; i < cv.length; i++) {
      for (let j = 0; j < cv[i].length; j++) {
        if (match(cv[i][j])) {
          const x = sv[i]?.[j];
          if (isError(x)) return x;
          if (typeof x === 'number') s += x;
        }
      }
    }
    return s;
  },
  LEFT(ev, args) {
    const e = argCount('LEFT', args, 1, 2); if (e) return e;
    const t = textArg(ev, args[0]); if (isError(t)) return t;
    const n = intArg(ev, args[1], 1); if (isError(n)) return n;
    if (n < 0) return new ErrorValue('#VALUE!', 'LEFT 的字元數不可以是負數');
    return t.slice(0, n);
  },
  RIGHT(ev, args) {
    const e = argCount('RIGHT', args, 1, 2); if (e) return e;
    const t = textArg(ev, args[0]); if (isError(t)) return t;
    const n = intArg(ev, args[1], 1); if (isError(n)) return n;
    if (n < 0) return new ErrorValue('#VALUE!', 'RIGHT 的字元數不可以是負數');
    return n === 0 ? '' : t.slice(-n);
  },
  MID(ev, args) {
    const e = argCount('MID', args, 3, 3); if (e) return e;
    const t = textArg(ev, args[0]); if (isError(t)) return t;
    const s = intArg(ev, args[1], NaN); if (isError(s)) return s;
    const n = intArg(ev, args[2], NaN); if (isError(n)) return n;
    if (!(s >= 1)) return new ErrorValue('#VALUE!', 'MID 的開始位置必須由 1 起計');
    if (!(n >= 0)) return new ErrorValue('#VALUE!', 'MID 的字元數不可以是負數');
    return t.substr(s - 1, n);
  },
  LEN(ev, args) {
    const e = argCount('LEN', args, 1, 1); if (e) return e;
    const t = textArg(ev, args[0]);
    return isError(t) ? t : t.length;
  },
  UPPER(ev, args) {
    const e = argCount('UPPER', args, 1, 1); if (e) return e;
    const t = textArg(ev, args[0]);
    return isError(t) ? t : t.toUpperCase();
  },
  LOWER(ev, args) {
    const e = argCount('LOWER', args, 1, 1); if (e) return e;
    const t = textArg(ev, args[0]);
    return isError(t) ? t : t.toLowerCase();
  },
  TRIM(ev, args) {
    const e = argCount('TRIM', args, 1, 1); if (e) return e;
    const t = textArg(ev, args[0]);
    return isError(t) ? t : t.trim().replace(/ +/g, ' ');
  },
  CONCATENATE(ev, args) {
    const e = argCount('CONCATENATE', args, 1, 255); if (e) return e;
    let s = '';
    for (const { v } of flatten(ev, args)) {
      const t = toText(v);
      if (isError(t)) return t;
      s += t;
    }
    return s;
  },
  CONCAT(ev, args) { return FUNCTIONS.CONCATENATE(ev, args); },
  ABS(ev, args) {
    const e = argCount('ABS', args, 1, 1); if (e) return e;
    const n = toNumber(scalar(ev, args[0]));
    return isError(n) ? n : Math.abs(n);
  },
  ROUND(ev, args) {
    const e = argCount('ROUND', args, 1, 2); if (e) return e;
    const n = toNumber(scalar(ev, args[0])); if (isError(n)) return n;
    const d = intArg(ev, args[1], 0); if (isError(d)) return d;
    const f = 10 ** d;
    return Math.sign(n) * Math.round(Math.abs(n) * f + 1e-9) / f;
  },
  INT(ev, args) {
    const e = argCount('INT', args, 1, 1); if (e) return e;
    const n = toNumber(scalar(ev, args[0]));
    return isError(n) ? n : Math.floor(n);
  },
  LARGE(ev, args) {
    const e = argCount('LARGE', args, 2, 2); if (e) return e;
    const nums = numericArgs(ev, [args[0]]); if (isError(nums)) return nums;
    const k = intArg(ev, args[1], 1); if (isError(k)) return k;
    const s = [...nums].sort((a, b) => b - a);
    return k >= 1 && k <= s.length ? s[k - 1] : new ErrorValue('#NUM!');
  },
  SMALL(ev, args) {
    const e = argCount('SMALL', args, 2, 2); if (e) return e;
    const nums = numericArgs(ev, [args[0]]); if (isError(nums)) return nums;
    const k = intArg(ev, args[1], 1); if (isError(k)) return k;
    const s = [...nums].sort((a, b) => a - b);
    return k >= 1 && k <= s.length ? s[k - 1] : new ErrorValue('#NUM!');
  },
  TRUE() { return true; },
  FALSE() { return false; },

  // ---------- Episode 1／2 新增 ----------
  FIND(ev, args) {
    const e = argCount('FIND', args, 2, 3); if (e) return e;
    const f = textArg(ev, args[0]); if (isError(f)) return f;
    const t = textArg(ev, args[1]); if (isError(t)) return t;
    const st = intArg(ev, args[2], 1); if (isError(st)) return st;
    if (st < 1 || st > t.length + 1) return new ErrorValue('#VALUE!', 'FIND 的開始位置超出文字長度');
    const i = t.indexOf(f, st - 1);
    return i < 0 ? new ErrorValue('#VALUE!', `FIND 找不到「${f}」（FIND 會分大小寫）`) : i + 1;
  },
  SEARCH(ev, args) {
    const e = argCount('SEARCH', args, 2, 3); if (e) return e;
    const f = textArg(ev, args[0]); if (isError(f)) return f;
    const t = textArg(ev, args[1]); if (isError(t)) return t;
    const st = intArg(ev, args[2], 1); if (isError(st)) return st;
    if (st < 1 || st > t.length + 1) return new ErrorValue('#VALUE!', 'SEARCH 的開始位置超出文字長度');
    const re = new RegExp(wildcardToRegex(f).source.replace(/^\^|\$$/g, ''), 'is');
    const m = re.exec(t.slice(st - 1));
    return m ? st + m.index : new ErrorValue('#VALUE!', `SEARCH 找不到「${f}」`);
  },
  XLOOKUP(ev, args) {
    const e = argCount('XLOOKUP', args, 3, 6); if (e) return e;
    const key = scalar(ev, args[0]); if (isError(key)) return key;
    const look = ev.evalNode(args[1]);
    const ret = ev.evalNode(args[2]);
    if (!isRange(look) || !isRange(ret)) return new ErrorValue('#VALUE!', 'XLOOKUP 的查找範圍及傳回範圍需要是儲存格範圍');
    if (look.width > 1 && look.height > 1) return new ErrorValue('#VALUE!', 'XLOOKUP 的查找範圍只可以是一欄或一列');
    const vertical = look.width === 1;
    const n = vertical ? look.height : look.width;
    if ((vertical ? ret.height : ret.width) !== n) return new ErrorValue('#VALUE!', 'XLOOKUP 的查找範圍及傳回範圍大小不一致');
    if ((vertical ? ret.width : ret.height) !== 1) return new ErrorValue('#VALUE!', '本系統的 XLOOKUP 只支援傳回一欄（或一列）的結果');
    const lv = look.values().flat();
    const rv = ret.values().flat();
    const mode = args[4] && args[4].type !== 'empty' ? intArg(ev, args[4], 0) : 0; if (isError(mode)) return mode;
    const search = args[5] && args[5].type !== 'empty' ? intArg(ev, args[5], 1) : 1; if (isError(search)) return search;
    const order = search === -1 ? [...Array(n).keys()].reverse() : [...Array(n).keys()];
    let hit = -1;
    if (mode === 2) {
      const match = makeCriteria(typeof key === 'string' ? `=${key}` : key);
      hit = order.find((i) => match(lv[i])) ?? -1;
    } else {
      hit = order.find((i) => !isBlank(lv[i]) && !isError(lv[i]) && compare(lv[i], key) === 0 && typeof lv[i] === typeof key) ?? -1;
      if (hit < 0 && (mode === -1 || mode === 1)) {
        let best = -1;
        for (const i of order) {
          const v = lv[i];
          if (typeof v !== typeof key || isBlank(v)) continue;
          const c = compare(v, key);
          if (mode === -1 && c < 0 && (best < 0 || compare(v, lv[best]) > 0)) best = i;
          if (mode === 1 && c > 0 && (best < 0 || compare(v, lv[best]) < 0)) best = i;
        }
        hit = best;
      }
    }
    if (hit < 0) {
      if (args[3] && args[3].type !== 'empty') return scalar(ev, args[3]);
      return new ErrorValue('#N/A', `XLOOKUP 找不到「${key}」`);
    }
    return rv[hit];
  },
  RANK(ev, args) {
    const e = argCount('RANK', args, 2, 3); if (e) return e;
    const n = toNumber(scalar(ev, args[0])); if (isError(n)) return n;
    const ref = ev.evalNode(args[1]);
    if (!isRange(ref)) return new ErrorValue('#VALUE!', 'RANK 的第二個參數需要是儲存格範圍');
    const asc = args[2] && args[2].type !== 'empty' ? toBool(scalar(ev, args[2])) : false;
    if (isError(asc)) return asc;
    const nums = ref.values().flat().filter((v) => typeof v === 'number');
    if (!nums.some((v) => compare(v, n) === 0)) return new ErrorValue('#N/A', 'RANK：數值不在範圍之內');
    return 1 + nums.filter((v) => (asc ? compare(v, n) < 0 : compare(v, n) > 0)).length;
  },
  'RANK.EQ'(ev, args) { return FUNCTIONS.RANK(ev, args); },
  RAND(ev, args) {
    const e = argCount('RAND', args, 0, 0); if (e) return e;
    return (ev.rng || Math.random)();
  },
  RANDBETWEEN(ev, args) {
    const e = argCount('RANDBETWEEN', args, 2, 2); if (e) return e;
    const lo = toNumber(scalar(ev, args[0])); if (isError(lo)) return lo;
    const hi = toNumber(scalar(ev, args[1])); if (isError(hi)) return hi;
    const a = Math.ceil(lo); const b = Math.floor(hi);
    if (a > b) return new ErrorValue('#NUM!', 'RANDBETWEEN 的下限大於上限');
    return a + Math.floor((ev.rng || Math.random)() * (b - a + 1));
  },
  SQRT(ev, args) {
    const e = argCount('SQRT', args, 1, 1); if (e) return e;
    const n = toNumber(scalar(ev, args[0])); if (isError(n)) return n;
    return n < 0 ? new ErrorValue('#NUM!', 'SQRT 不能計算負數的平方根') : Math.sqrt(n);
  },
  MOD(ev, args) {
    const e = argCount('MOD', args, 2, 2); if (e) return e;
    const a = toNumber(scalar(ev, args[0])); if (isError(a)) return a;
    const b = toNumber(scalar(ev, args[1])); if (isError(b)) return b;
    if (b === 0) return new ErrorValue('#DIV/0!', 'MOD 的除數為 0');
    return a - b * Math.floor(a / b);
  },
  ROUNDUP(ev, args) {
    const e = argCount('ROUNDUP', args, 1, 2); if (e) return e;
    const n = toNumber(scalar(ev, args[0])); if (isError(n)) return n;
    const d = intArg(ev, args[1], 0); if (isError(d)) return d;
    const f = 10 ** d;
    return Math.sign(n) * Math.ceil(Math.abs(n) * f - 1e-9) / f;
  },
  ROUNDDOWN(ev, args) {
    const e = argCount('ROUNDDOWN', args, 1, 2); if (e) return e;
    const n = toNumber(scalar(ev, args[0])); if (isError(n)) return n;
    const d = intArg(ev, args[1], 0); if (isError(d)) return d;
    const f = 10 ** d;
    return Math.sign(n) * Math.floor(Math.abs(n) * f + 1e-9) / f;
  },
};

/** 函數說明（學生介面的公式提示；繁體中文） */
export const FUNCTION_HELP = {
  SUM: ['SUM(數值1, [數值2], …)', '加總'], AVERAGE: ['AVERAGE(數值1, …)', '平均值'], COUNT: ['COUNT(值1, …)', '計算含數值的儲存格數目'],
  COUNTA: ['COUNTA(值1, …)', '計算非空白儲存格數目'], MAX: ['MAX(數值1, …)', '最大值'], MIN: ['MIN(數值1, …)', '最小值'],
  IF: ['IF(條件, 條件成立時的值, [不成立時的值])', '按條件傳回不同結果'], AND: ['AND(條件1, 條件2, …)', '全部條件成立才是 TRUE'],
  OR: ['OR(條件1, 條件2, …)', '任何一個條件成立便是 TRUE'], NOT: ['NOT(條件)', '把 TRUE／FALSE 反轉'],
  COUNTIF: ['COUNTIF(範圍, 條件)', '計算符合條件的儲存格數目'], SUMIF: ['SUMIF(條件範圍, 條件, [總和範圍])', '加總符合條件的數值'],
  LEFT: ['LEFT(文字, [字元數])', '由左邊擷取字元'], RIGHT: ['RIGHT(文字, [字元數])', '由右邊擷取字元'], MID: ['MID(文字, 開始位置, 字元數)', '由中間擷取字元'],
  LEN: ['LEN(文字)', '文字的字元數目'], FIND: ['FIND(要找的文字, 文字, [開始位置])', '找出文字的位置（分大小寫）'],
  SEARCH: ['SEARCH(要找的文字, 文字, [開始位置])', '找出文字的位置（不分大小寫）'],
  XLOOKUP: ['XLOOKUP(查找值, 查找範圍, 傳回範圍, [找不到時的值])', '在範圍中查找並傳回對應的值'],
  ROUND: ['ROUND(數值, 小數位)', '四捨五入'], ROUNDUP: ['ROUNDUP(數值, 小數位)', '向上捨入'], ROUNDDOWN: ['ROUNDDOWN(數值, 小數位)', '向下捨去'],
  INT: ['INT(數值)', '向下取整數'], RANK: ['RANK(數值, 範圍, [次序])', '數值在範圍中的排名（次序 0＝由大至小，1＝由小至大）'],
  'RANK.EQ': ['RANK.EQ(數值, 範圍, [次序])', '同 RANK'], RAND: ['RAND()', '0 至 1 之間的隨機數（每次重算都會改變）'],
  RANDBETWEEN: ['RANDBETWEEN(下限, 上限)', '兩數之間的隨機整數'], SQRT: ['SQRT(數值)', '平方根'], MOD: ['MOD(數值, 除數)', '餘數'],
  ABS: ['ABS(數值)', '絕對值'], CONCATENATE: ['CONCATENATE(文字1, 文字2, …)', '連接文字（亦可用 &）'], CONCAT: ['CONCAT(文字1, …)', '連接文字'],
  UPPER: ['UPPER(文字)', '轉為大寫'], LOWER: ['LOWER(文字)', '轉為小寫'], TRIM: ['TRIM(文字)', '刪除多餘空格'],
  LARGE: ['LARGE(範圍, k)', '第 k 大的數值'], SMALL: ['SMALL(範圍, k)', '第 k 小的數值'], COUNTBLANK: ['COUNTBLANK(範圍)', '計算空白儲存格數目'],
};

export const SUPPORTED_FUNCTIONS = Object.keys(FUNCTIONS);
