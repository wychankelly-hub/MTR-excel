// AST 工具：序列化、公式複製時的參照位移、R1C1 相對形式、函數/參照收集。
import { indexToCol } from './refs.js';

function refStr(r) {
  if (r.invalid) return '#REF!';
  return `${r.colAbs ? '$' : ''}${indexToCol(r.col)}${r.rowAbs ? '$' : ''}${r.row}`;
}

function sheetPrefix(s) {
  if (!s) return '';
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s) ? `${s}!` : `'${s}'!`;
}

/** 正規化的公式字串（大寫函數、去掉多餘空格），不含開頭的 = */
export function toFormulaString(n) {
  switch (n.type) {
    case 'num': return String(n.value);
    case 'str': return `"${n.value.replace(/"/g, '""')}"`;
    case 'bool': return n.value ? 'TRUE' : 'FALSE';
    case 'errlit': return n.value;
    case 'empty': return '';
    case 'ref': return sheetPrefix(n.sheet) + refStr(n);
    case 'range': return sheetPrefix(n.sheet) + refStr(n.start) + ':' + refStr(n.end);
    case 'colrange': return `${sheetPrefix(n.sheet)}${n.colAbs1 ? '$' : ''}${indexToCol(n.c1)}:${n.colAbs2 ? '$' : ''}${indexToCol(n.c2)}`;
    case 'func': return `${n.name}(${n.args.map(toFormulaString).join(',')})`;
    case 'paren': return `(${toFormulaString(n.arg)})`;
    case 'unary': return n.op + toFormulaString(n.arg);
    case 'percent': return toFormulaString(n.arg) + '%';
    case 'bin': return toFormulaString(n.left) + n.op + toFormulaString(n.right);
    default: throw new Error(`未知節點 ${n.type}`);
  }
}

function mapRefs(n, fn) {
  switch (n.type) {
    case 'ref': return fn(n);
    case 'range': return { ...n, start: fn(n.start), end: fn(n.end) };
    case 'colrange': return { ...n };
    case 'func': return { ...n, args: n.args.map((a) => mapRefs(a, fn)) };
    case 'paren': case 'unary': case 'percent': return { ...n, arg: mapRefs(n.arg, fn) };
    case 'bin': return { ...n, left: mapRefs(n.left, fn), right: mapRefs(n.right, fn) };
    default: return { ...n };
  }
}

/** 複製公式：相對參照按 (dRow, dCol) 位移，絕對參照不變；超出邊界變成 #REF! */
export function shiftAst(ast, dRow, dCol) {
  return mapRefs(ast, (r) => {
    const col = r.colAbs ? r.col : r.col + dCol;
    const row = r.rowAbs ? r.row : r.row + dRow;
    if (col < 1 || row < 1) return { ...r, invalid: true, col: Math.max(col, 1), row: Math.max(row, 1) };
    return { ...r, col, row };
  });
}

/** 以 R1C1 相對形式表示（用作檢查「複製是否一致」）。 */
export function toRelativeForm(ast, baseRow, baseCol) {
  const rel = mapRefs(ast, (r) => ({ ...r, rc: `${r.rowAbs ? `R${r.row}` : `R[${r.row - baseRow}]`}${r.colAbs ? `C${r.col}` : `C[${r.col - baseCol}]`}` }));
  const s = (n) => {
    switch (n.type) {
      case 'ref': return (n.sheet ? n.sheet + '!' : '') + n.rc;
      case 'range': return (n.sheet ? n.sheet + '!' : '') + n.start.rc + ':' + n.end.rc;
      case 'func': return `${n.name}(${n.args.map(s).join(',')})`;
      case 'paren': return `(${s(n.arg)})`;
      case 'unary': return n.op + s(n.arg);
      case 'percent': return s(n.arg) + '%';
      case 'bin': return s(n.left) + n.op + s(n.right);
      default: return toFormulaString(n);
    }
  };
  return s(rel);
}

export function walk(n, visit) {
  visit(n);
  switch (n.type) {
    case 'range': visit(n.start); visit(n.end); break;
    case 'func': n.args.forEach((a) => walk(a, visit)); break;
    case 'paren': case 'unary': case 'percent': walk(n.arg, visit); break;
    case 'bin': walk(n.left, visit); walk(n.right, visit); break;
    default: break;
  }
}

export function collectFunctions(ast) {
  const s = new Set();
  walk(ast, (n) => { if (n.type === 'func') s.add(n.name); });
  return s;
}

/** 所有單一儲存格參照（不含範圍端點） */
export function collectCellRefs(ast) {
  const out = [];
  const visit = (n, inRange) => {
    if (n.type === 'ref' && !inRange) out.push(n);
    if (n.type === 'range') return;
    if (n.type === 'func') n.args.forEach((a) => visit(a));
    else if (n.type === 'bin') { visit(n.left); visit(n.right); }
    else if (n.arg) visit(n.arg);
  };
  visit(ast);
  return out;
}

export function collectRanges(ast) {
  const out = [];
  walk(ast, (n) => { if (n.type === 'range' || n.type === 'colrange') out.push(n); });
  return out;
}

export function collectLiterals(ast) {
  const out = [];
  walk(ast, (n) => { if (n.type === 'num' || n.type === 'str' || n.type === 'bool') out.push(n); });
  return out;
}

export function findFuncs(ast, name) {
  const out = [];
  walk(ast, (n) => { if (n.type === 'func' && n.name === name) out.push(n); });
  return out;
}

export function rangeAddr(n) {
  if (n.type === 'range') return `${indexToCol(n.start.col)}${n.start.row}:${indexToCol(n.end.col)}${n.end.row}`;
  if (n.type === 'colrange') return `${indexToCol(n.c1)}:${indexToCol(n.c2)}`;
  if (n.type === 'ref') return `${indexToCol(n.col)}${n.row}`;
  return null;
}

/** 去掉多餘括號 */
export function unwrap(n) {
  while (n && n.type === 'paren') n = n.arg;
  return n;
}
