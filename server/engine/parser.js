// 試算表公式解析器：Tokenizer + Pratt Parser -> AST。
// 只產生資料結構，絕不執行任何程式碼（不使用 eval / Function）。
import { colToIndex } from './refs.js';

export class FormulaSyntaxError extends Error {
  constructor(message, pos, code = 'SYNTAX_ERROR') {
    super(message);
    this.pos = pos;
    this.code = code;
  }
}

const ERROR_LITERALS = ['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A'];

export function tokenize(src) {
  // 先找出字串以外的全形／中文字元，給予最清楚的提示
  let inStr = false;
  for (let k = 0; k < src.length; k++) {
    if (src[k] === '"') inStr = !inStr;
    else if (!inStr && src.charCodeAt(k) > 127) throw new FormulaSyntaxError(`第 ${k + 1} 個字元「${src[k]}」不是半形英文符號`, k, 'NON_ASCII');
  }
  const tokens = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }
    // 非 ASCII（全形符號、中文字）
    if (ch.charCodeAt(0) > 127) {
      throw new FormulaSyntaxError(`第 ${i + 1} 個字元「${ch}」不是半形英文符號`, i, 'NON_ASCII');
    }
    if (ch === '"') {
      let j = i + 1;
      let s = '';
      for (;;) {
        if (j >= n) throw new FormulaSyntaxError('字串缺少結束的雙引號 "', i);
        if (src[j] === '"') {
          if (src[j + 1] === '"') { s += '"'; j += 2; continue; }
          break;
        }
        s += src[j++];
      }
      tokens.push({ t: 'STR', v: s, pos: i });
      i = j + 1;
      continue;
    }
    if (ch === '#') {
      const lit = ERROR_LITERALS.find((e) => src.substr(i, e.length).toUpperCase() === e);
      if (!lit) throw new FormulaSyntaxError(`無法辨識「${src.substr(i, 6)}」`, i);
      tokens.push({ t: 'ERR', v: lit, pos: i });
      i += lit.length;
      continue;
    }
    const num = /^(\d+\.?\d*([eE][+-]?\d+)?|\.\d+([eE][+-]?\d+)?)/.exec(src.slice(i));
    if (num && !/^[A-Za-z]/.test(src.slice(i + num[0].length)) ) {
      tokens.push({ t: 'NUM', v: Number(num[0]), pos: i });
      i += num[0].length;
      continue;
    }
    // 工作表名稱前綴：'Sheet Name'!A1
    if (ch === "'") {
      const end = src.indexOf("'!", i + 1);
      if (end < 0) throw new FormulaSyntaxError('工作表名稱格式錯誤', i);
      tokens.push({ t: 'SHEET', v: src.slice(i + 1, end), pos: i });
      i = end + 2;
      continue;
    }
    const id = /^[A-Za-z_$][A-Za-z0-9_.$]*/.exec(src.slice(i));
    if (id) {
      const word = id[0];
      const after = src[i + word.length];
      if (after === '!') {
        tokens.push({ t: 'SHEET', v: word, pos: i });
        i += word.length + 1;
        continue;
      }
      const cell = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/.exec(word);
      if (cell) {
        tokens.push({ t: 'REF', pos: i, col: colToIndex(cell[2]), row: Number(cell[4]), colAbs: cell[1] === '$', rowAbs: cell[3] === '$' });
        i += word.length;
        continue;
      }
      const colOnly = /^(\$?)([A-Za-z]{1,3})$/.exec(word);
      // 函數名稱
      let k = i + word.length;
      while (src[k] === ' ') k++;
      if (src[k] === '(' && !word.includes('$')) {
        tokens.push({ t: 'FUNC', v: word.toUpperCase(), pos: i });
        i = k + 1;
        continue;
      }
      const up = word.toUpperCase();
      if (up === 'TRUE' || up === 'FALSE') {
        tokens.push({ t: 'BOOL', v: up === 'TRUE', pos: i });
        i += word.length;
        continue;
      }
      if (colOnly && (src[k] === ':' || tokens.at(-1)?.t === 'COLON')) {
        tokens.push({ t: 'COLREF', pos: i, col: colToIndex(colOnly[2]), colAbs: colOnly[1] === '$' });
        i += word.length;
        continue;
      }
      throw new FormulaSyntaxError(`無法辨識「${word}」（文字需要放在雙引號內）`, i, 'UNKNOWN_NAME');
    }
    const two = src.substr(i, 2);
    if (two === '<=' || two === '>=' || two === '<>') { tokens.push({ t: 'OP', v: two, pos: i }); i += 2; continue; }
    if ('+-*/^&=<>%'.includes(ch)) { tokens.push({ t: 'OP', v: ch, pos: i }); i++; continue; }
    if (ch === '(') { tokens.push({ t: 'LP', pos: i }); i++; continue; }
    if (ch === ')') { tokens.push({ t: 'RP', pos: i }); i++; continue; }
    if (ch === ',') { tokens.push({ t: 'COMMA', pos: i }); i++; continue; }
    if (ch === ':') { tokens.push({ t: 'COLON', pos: i }); i++; continue; }
    if (ch === ';') throw new FormulaSyntaxError('本比賽的公式使用逗號 , 分隔參數，而不是分號 ;', i);
    throw new FormulaSyntaxError(`無法辨識符號「${ch}」`, i);
  }
  tokens.push({ t: 'EOF', pos: n });
  return tokens;
}

const BINARY = {
  '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1,
  '&': 2,
  '+': 3, '-': 3,
  '*': 4, '/': 4,
  '^': 5,
};

/** 解析公式（可含或不含開頭的 =）。 */
export function parseFormula(text) {
  let src = String(text);
  if (src.startsWith('=')) src = src.slice(1);
  if (src.trim() === '') throw new FormulaSyntaxError('公式內容是空的', 0);
  const tokens = tokenize(src);
  let p = 0;
  const peek = () => tokens[p];
  const next = () => tokens[p++];
  const expect = (t, msg) => {
    const tok = next();
    if (tok.t !== t) throw new FormulaSyntaxError(msg, tok.pos);
    return tok;
  };

  function parseExpr(minPrec) {
    let left = parseUnary();
    for (;;) {
      const tok = peek();
      if (tok.t === 'OP' && tok.v === '%') { next(); left = { type: 'percent', arg: left }; continue; }
      if (tok.t !== 'OP' || !(tok.v in BINARY)) break;
      const prec = BINARY[tok.v];
      if (prec < minPrec) break;
      next();
      const right = parseExpr(tok.v === '^' ? prec : prec + 1);
      left = { type: 'bin', op: tok.v, left, right };
    }
    return left;
  }

  function parseUnary() {
    const tok = peek();
    if (tok.t === 'OP' && (tok.v === '-' || tok.v === '+')) {
      next();
      return { type: 'unary', op: tok.v, arg: parseUnary() };
    }
    return parsePrimary();
  }

  function parseRefWithSheet(sheet) {
    const tok = next();
    if (tok.t === 'REF') {
      const start = { type: 'ref', sheet, col: tok.col, row: tok.row, colAbs: tok.colAbs, rowAbs: tok.rowAbs };
      if (peek().t === 'COLON') {
        next();
        const e = next();
        if (e.t !== 'REF') throw new FormulaSyntaxError('範圍的結尾需要是儲存格，例如 B2:B21', e.pos);
        return { type: 'range', sheet, start, end: { type: 'ref', sheet, col: e.col, row: e.row, colAbs: e.colAbs, rowAbs: e.rowAbs } };
      }
      return start;
    }
    if (tok.t === 'COLREF') {
      expect('COLON', '欄範圍格式應為例如 F:F');
      const e = next();
      if (e.t !== 'COLREF') throw new FormulaSyntaxError('欄範圍格式應為例如 F:F', e.pos);
      return { type: 'colrange', sheet, c1: tok.col, c2: e.col, colAbs1: tok.colAbs, colAbs2: e.colAbs };
    }
    throw new FormulaSyntaxError('工作表名稱之後需要儲存格參照', tok.pos);
  }

  function parsePrimary() {
    const tok = peek();
    switch (tok.t) {
      case 'NUM': next(); return { type: 'num', value: tok.v };
      case 'STR': next(); return { type: 'str', value: tok.v };
      case 'BOOL': next(); return { type: 'bool', value: tok.v };
      case 'ERR': next(); return { type: 'errlit', value: tok.v };
      case 'SHEET': next(); return parseRefWithSheet(tok.v);
      case 'REF':
      case 'COLREF':
        return parseRefWithSheet(null);
      case 'FUNC': {
        next();
        const args = [];
        if (peek().t === 'RP') { next(); return { type: 'func', name: tok.v, args }; }
        for (;;) {
          if (peek().t === 'COMMA' || peek().t === 'RP') args.push({ type: 'empty' });
          else args.push(parseExpr(1));
          const sep = next();
          if (sep.t === 'COMMA') continue;
          if (sep.t === 'RP') break;
          throw new FormulaSyntaxError(`${tok.v} 的參數之間需要逗號，或缺少右括號 )`, sep.pos);
        }
        return { type: 'func', name: tok.v, args };
      }
      case 'LP': {
        next();
        const e = parseExpr(1);
        expect('RP', '缺少右括號 )');
        return { type: 'paren', arg: e };
      }
      case 'EOF':
        throw new FormulaSyntaxError('公式未完成（結尾缺少內容）', tok.pos);
      case 'OP':
        throw new FormulaSyntaxError(`運算符「${tok.v}」位置不正確（如果是條件文字，需要放在雙引號內，例如 ">="）`, tok.pos, 'BAD_OPERATOR');
      default:
        throw new FormulaSyntaxError('公式結構不正確', tok.pos);
    }
  }

  const ast = parseExpr(1);
  if (peek().t !== 'EOF') {
    const t = peek();
    if (t.t === 'RP') throw new FormulaSyntaxError('多了一個右括號 )', t.pos);
    throw new FormulaSyntaxError('公式結構不正確（可能缺少運算符或逗號）', t.pos);
  }
  return ast;
}
