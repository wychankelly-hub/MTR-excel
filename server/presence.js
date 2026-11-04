// 學生即時連線狀態（只存於記憶體）：用來選擇 Driver（排除未連線的學生）及顯示 Driver 是否離線。
// 伺服器重新啟動後，學生的即時連線會在數秒內自動重新建立。
const conns = new Map(); // `${compId}\u0001${userId}` -> { n, since, offlineSince }
const k = (compId, userId) => `${compId}\u0001${userId}`;

export function connected(compId, userId) {
  const c = conns.get(k(compId, userId)) || { n: 0, since: Date.now(), offlineSince: null };
  if (c.n === 0) c.since = Date.now();
  c.n += 1;
  c.offlineSince = null;
  conns.set(k(compId, userId), c);
  return c.n === 1; // 由離線變為在線
}

export function disconnected(compId, userId) {
  const c = conns.get(k(compId, userId));
  if (!c) return false;
  c.n = Math.max(0, c.n - 1);
  if (c.n === 0) c.offlineSince = Date.now();
  return c.n === 0;
}

/** { online, offlineSince（毫秒時間戳或 null）, seen（本次伺服器運行期間曾經連線） } */
export function presenceOf(compId, userId) {
  const c = conns.get(k(compId, userId));
  return { online: !!c && c.n > 0, offlineSince: c?.offlineSince ?? null, seen: !!c };
}

/** 可以擔任 Driver：在線，或剛離線不久（例如重新整理頁面） */
export function isAvailable(compId, userId, graceMs = Number(process.env.DRIVER_REFRESH_GRACE_MS) || 20000) {
  const p = presenceOf(compId, userId);
  return p.online || (p.offlineSince !== null && Date.now() - p.offlineSince < graceMs);
}

export function resetPresence() { conns.clear(); }
