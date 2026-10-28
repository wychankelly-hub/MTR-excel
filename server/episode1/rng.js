// 可重現的偽隨機數（同一 seed 必得同一序列）。不使用 Math.random。
import crypto from 'node:crypto';

export function hashSeed(str) {
  const h = crypto.createHash('sha256').update(String(str)).digest();
  return h.readUInt32LE(0);
}

export function makeRng(seedStr) {
  let a = hashSeed(seedStr);
  const next = () => {
    // mulberry32
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    shuffle(arr) {
      const a2 = [...arr];
      for (let i = a2.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a2[i], a2[j]] = [a2[j], a2[i]];
      }
      return a2;
    },
    uniqueInts(count, lo, hi) {
      const s = new Set();
      while (s.size < count) s.add(rng.int(lo, hi));
      return [...s];
    },
  };
  return rng;
}

export function checksum(obj) {
  return crypto.createHash('sha256').update(stableStringify(obj)).digest('hex');
}

export function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
}
