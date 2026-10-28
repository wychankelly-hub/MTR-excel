// 儲存格位址工具：A1 <-> (col,row)，範圍展開。
export function colToIndex(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function indexToCol(n) {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const ADDR_RE = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/;

export function parseAddr(addr) {
  const m = ADDR_RE.exec(addr.trim());
  if (!m) throw new Error(`無效儲存格位址：${addr}`);
  return { col: colToIndex(m[2]), row: Number(m[4]), colAbs: m[1] === '$', rowAbs: m[3] === '$' };
}

export function addr(col, row) {
  return `${indexToCol(col)}${row}`;
}

/** 'D3:D21' 或 'D2' -> ['D3','D4',...] （由上至下、由左至右） */
export function expandRange(spec) {
  const [a, b] = spec.split(':');
  const s = parseAddr(a);
  const e = b ? parseAddr(b) : s;
  const out = [];
  for (let r = Math.min(s.row, e.row); r <= Math.max(s.row, e.row); r++) {
    for (let c = Math.min(s.col, e.col); c <= Math.max(s.col, e.col); c++) out.push(addr(c, r));
  }
  return out;
}

export function expandAll(specs) {
  return specs.flatMap(expandRange);
}

export function inRanges(a, specs) {
  return expandAll(specs).includes(a.toUpperCase());
}
