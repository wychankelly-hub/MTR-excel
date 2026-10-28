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
};

export const SUPPORTED_FUNCTIONS = Object.keys(FUNCTIONS);
