// 值的類型與轉換規則（盡量貼近 Excel / Google Sheets 的行為）。
export class ErrorValue {
  constructor(code, detail = '') {
    this.code = code; // '#VALUE!' 等
    this.detail = detail;
  }
  toString() { return this.code; }
}

export const isError = (v) => v instanceof ErrorValue;
export const isRange = (v) => v && typeof v === 'object' && v.kind === 'range';
export const isBlank = (v) => v === null || v === undefined;

export function toNumber(v) {
  if (isError(v)) return v;
  if (isBlank(v)) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return new ErrorValue('#VALUE!', '空白文字不能用作數值');
    const n = Number(t);
    return Number.isFinite(n) ? n : new ErrorValue('#VALUE!', `文字「${v}」不能用作數值運算`);
  }
  return new ErrorValue('#VALUE!');
}

export function formatNumber(n) {
  if (!Number.isFinite(n)) return '#NUM!';
  if (Number.isInteger(n)) return String(n);
  return String(parseFloat(n.toPrecision(15)));
}

export function toText(v) {
  if (isError(v)) return v;
  if (isBlank(v)) return '';
  if (typeof v === 'number') return formatNumber(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v);
}

export function toBool(v) {
  if (isError(v)) return v;
  if (isBlank(v)) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const u = v.trim().toUpperCase();
    if (u === 'TRUE') return true;
    if (u === 'FALSE') return false;
  }
  return new ErrorValue('#VALUE!', `「${v}」不是 TRUE/FALSE`);
}

const rank = (v) => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2);

/** 比較兩個值：回傳 -1/0/1（文字不分大小寫；數字 < 文字 < 布林） */
export function compare(a, b) {
  if (isBlank(a)) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
  if (isBlank(b)) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra < rb ? -1 : 1;
  if (typeof a === 'string') {
    const x = a.toUpperCase();
    const y = b.toUpperCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  if (typeof a === 'number') {
    if (Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b))) return 0;
    return a < b ? -1 : 1;
  }
  return a === b ? 0 : a ? 1 : -1;
}

/** 測試比對（批改用）：數值容許合理浮點誤差 */
export function valuesEqual(a, b, tol = 1e-6) {
  if (isError(a) || isError(b)) return isError(a) && isError(b) && a.code === b.code;
  if (isBlank(a) && isBlank(b)) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
  if (typeof a === 'string' && typeof b === 'string') return a === b;
  return a === b;
}

export function describeValue(v) {
  if (isError(v)) return v.code;
  if (isBlank(v)) return '（空白）';
  if (typeof v === 'number') return formatNumber(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return `"${v}"`;
}
