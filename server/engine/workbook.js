// 伺服器端試算表模型與重算引擎（安全：只解譯 AST）。
import { parseFormula, FormulaSyntaxError } from './parser.js';
import { shiftAst, toFormulaString } from './ast.js';
import { addr as mkAddr, parseAddr } from './refs.js';
import { FUNCTIONS } from './functions.js';
import { ErrorValue, isError, isRange, toNumber, toText, toBool, compare } from './values.js';

export function isFormulaInput(input) {
  return typeof input === 'string' && input.startsWith('=') && input.length > 1;
}

/** 把學生在儲存格輸入的文字轉成值（數字、布林或文字），公式除外 */
export function coerceLiteralInput(text) {
  if (text === null || text === undefined || text === '') return null;
  if (typeof text !== 'string') return text;
  const t = text.trim();
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return Number(t);
  if (/^true$/i.test(t)) return true;
  if (/^false$/i.test(t)) return false;
  return text;
}

class RangeValue {
  constructor(wb, sheet, c1, r1, c2, r2) {
    this.kind = 'range';
    Object.assign(this, { wb, sheet, c1: Math.min(c1, c2), r1: Math.min(r1, r2), c2: Math.max(c1, c2), r2: Math.max(r1, r2) });
  }
  get height() { return this.r2 - this.r1 + 1; }
  get width() { return this.c2 - this.c1 + 1; }
  values() {
    const out = [];
    for (let r = this.r1; r <= this.r2; r++) {
      const row = [];
      for (let c = this.c1; c <= this.c2; c++) row.push(this.wb.valueAt(this.sheet, c, r));
      out.push(row);
    }
    return out;
  }
  resize(h, w) { return new RangeValue(this.wb, this.sheet, this.c1, this.r1, this.c1 + w - 1, this.r1 + h - 1); }
  single() {
    if (this.height === 1 && this.width === 1) return this.wb.valueAt(this.sheet, this.c1, this.r1);
    return new ErrorValue('#VALUE!', '範圍不能直接當作單一數值使用');
  }
}

export class Workbook {
  constructor() {
    this.sheets = new Map(); // name -> { cells: Map<addr,{input,ast,parseError}>, maxRow, maxCol }
    this.cache = new Map();
    this.evaluating = new Set();
    this.rng = Math.random; // RAND／RANDBETWEEN 使用；批改時改為可重現的隨機數
  }

  /** 重新計算（例如 RAND 需要新的隨機數） */
  recalc() { this.cache.clear(); }

  addSheet(name, maxRow = 1000, maxCol = 26) {
    if (!this.sheets.has(name)) this.sheets.set(name, { cells: new Map(), maxRow, maxCol });
    return this.sheets.get(name);
  }

  sheet(name) {
    const s = this.sheets.get(name);
    if (!s) throw new Error(`沒有工作表 ${name}`);
    return s;
  }

  setInput(sheetName, a, input) {
    const sh = this.addSheet(sheetName);
    const key = a.toUpperCase();
    this.cache.clear();
    if (input === null || input === undefined || input === '') { sh.cells.delete(key); return; }
    const cell = { input };
    if (isFormulaInput(input)) {
      try { cell.ast = parseFormula(input); } catch (e) { cell.parseError = e; }
    }
    sh.cells.set(key, cell);
  }

  /** 以 AST 設定公式（公式複製時使用） */
  setAst(sheetName, a, ast) {
    this.setInput(sheetName, a, '=' + toFormulaString(ast));
  }

  getInput(sheetName, a) {
    return this.sheets.get(sheetName)?.cells.get(a.toUpperCase())?.input ?? null;
  }

  getCell(sheetName, a) {
    return this.sheets.get(sheetName)?.cells.get(a.toUpperCase()) ?? null;
  }

  getValue(sheetName, a) {
    const { col, row } = parseAddr(a);
    return this.valueAt(sheetName, col, row);
  }

  valueAt(sheetName, col, row) {
    const sh = this.sheets.get(sheetName);
    if (!sh) return new ErrorValue('#REF!', `沒有工作表 ${sheetName}`);
    const key = mkAddr(col, row);
    const cell = sh.cells.get(key);
    if (!cell) return null;
    if (cell.parseError) return new ErrorValue('#ERROR!', cell.parseError.message);
    if (!cell.ast) return cell.input;
    const ck = `${sheetName}!${key}`;
    if (this.cache.has(ck)) return this.cache.get(ck);
    if (this.evaluating.has(ck)) return new ErrorValue('#REF!', '循環參照（公式直接或間接引用了自己）');
    this.evaluating.add(ck);
    let v;
    try {
      v = this.evalNode(cell.ast, sheetName);
      if (isRange(v)) v = v.single();
    } finally {
      this.evaluating.delete(ck);
    }
    // 循環參照的錯誤不寫入快取，避免影響其他起點的計算
    if (!(isError(v) && v.detail.startsWith('循環參照'))) this.cache.set(ck, v);
    return v;
  }

  evalNode(n, sheetName) {
    const ev = { evalNode: (x) => this.evalNode(x, sheetName), rng: this.rng };
    const scalar = (x) => {
      const v = this.evalNode(x, sheetName);
      return isRange(v) ? v.single() : v;
    };
    switch (n.type) {
      case 'num': case 'str': case 'bool': return n.value;
      case 'errlit': return new ErrorValue(n.value);
      case 'empty': return null;
      case 'ref':
        if (n.invalid) return new ErrorValue('#REF!', '參照超出工作表範圍');
        return this.valueAt(n.sheet || sheetName, n.col, n.row);
      case 'range':
        if (n.start.invalid || n.end.invalid) return new ErrorValue('#REF!');
        return new RangeValue(this, n.sheet || sheetName, n.start.col, n.start.row, n.end.col, n.end.row);
      case 'colrange': {
        const s = n.sheet || sheetName;
        const sh = this.sheets.get(s);
        return new RangeValue(this, s, n.c1, 1, n.c2, sh ? sh.maxRow : 1000);
      }
      case 'paren': return this.evalNode(n.arg, sheetName);
      case 'unary': {
        const v = toNumber(scalar(n.arg));
        if (isError(v)) return v;
        return n.op === '-' ? -v : v;
      }
      case 'percent': {
        const v = toNumber(scalar(n.arg));
        return isError(v) ? v : v / 100;
      }
      case 'func': {
        const f = FUNCTIONS[n.name];
        if (!f) return new ErrorValue('#NAME?', `UNSUPPORTED:${n.name}`);
        return f(ev, n.args);
      }
      case 'bin': {
        const a = scalar(n.left);
        if (isError(a)) return a;
        const b = scalar(n.right);
        if (isError(b)) return b;
        switch (n.op) {
          case '&': {
            const x = toText(a); const y = toText(b);
            if (isError(x)) return x;
            if (isError(y)) return y;
            return x + y;
          }
          case '=': return compare(a, b) === 0;
          case '<>': return compare(a, b) !== 0;
          case '<': return compare(a, b) < 0;
          case '>': return compare(a, b) > 0;
          case '<=': return compare(a, b) <= 0;
          case '>=': return compare(a, b) >= 0;
          default: {
            const x = toNumber(a); const y = toNumber(b);
            if (isError(x)) return x;
            if (isError(y)) return y;
            if (n.op === '+') return x + y;
            if (n.op === '-') return x - y;
            if (n.op === '*') return x * y;
            if (n.op === '/') return y === 0 ? new ErrorValue('#DIV/0!', '除數為 0') : x / y;
            if (n.op === '^') return x ** y;
            return new ErrorValue('#VALUE!');
          }
        }
      }
      default:
        return new ErrorValue('#VALUE!', `未知節點 ${n.type}`);
    }
  }

  clone() {
    const wb = new Workbook();
    for (const [name, sh] of this.sheets) {
      wb.rng = this.rng;
      const ns = wb.addSheet(name, sh.maxRow, sh.maxCol);
      for (const [k, c] of sh.cells) ns.cells.set(k, c); // cell 物件不可變，可共用
    }
    return wb;
  }

  /** 將 source 儲存格的公式／數值複製到 targets（相對參照自動位移） */
  copyCell(sheetName, source, targets) {
    const src = this.getCell(sheetName, source);
    const s = parseAddr(source);
    for (const t of targets) {
      const d = parseAddr(t);
      if (!src) { this.setInput(sheetName, t, null); continue; }
      if (src.ast) this.setAst(sheetName, t, shiftAst(src.ast, d.row - s.row, d.col - s.col));
      else if (src.parseError) this.setInput(sheetName, t, src.input);
      else this.setInput(sheetName, t, src.input);
    }
  }
}

export { FormulaSyntaxError, toBool };
