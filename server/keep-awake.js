// 課堂期間保持 Render 免費網站喚醒（閒置 15 分鐘會休眠）；下課後讓它照常休眠，不會 24 小時運行。
//
// 「上課中」的條件（全部成立才自我喚醒）：
//   1. 有比賽在大堂或進行中（LOBBY／RUNNING_LEVEL_n／PAUSED）；
//   2. 最近有真實使用：45 分鐘內有任何請求（健康檢查不計），
//      或者仍有學生／老師／投影畫面的即時連線，而且 3 小時內有請求（學生長時間思考、未提交也算上課中；
//      忘記關閉的分頁不會令網站整晚保持喚醒）。
//
// 2026-11-10 課堂事故：舊版把 lastActivity 宣告在 createApp() 之內，而計時器在 startServer() 之內，
// 每 10 分鐘執行時拋出 ReferenceError，令整個伺服器結束。現在活動紀錄集中在這個模組，兩邊共用。
import { db } from './store.js';

export const KEEP_AWAKE = {
  intervalMs: Number(process.env.KEEP_AWAKE_INTERVAL_MS) || 10 * 60 * 1000,
  activeWindowMs: Number(process.env.KEEP_AWAKE_ACTIVE_WINDOW_MS) || 45 * 60 * 1000,
  connectedWindowMs: Number(process.env.KEEP_AWAKE_CONNECTED_WINDOW_MS) || 3 * 60 * 60 * 1000,
};
const LIVE_STATUS = /^(LOBBY|RUNNING_|PAUSED)/;

let lastActivityAt = Date.now();

/** 有真實請求時呼叫（express 中介軟體；健康檢查除外） */
export function markActivity(now = Date.now()) { lastActivityAt = now; }
export function lastActivity() { return lastActivityAt; }

export function liveCompetitions(competitions = db.state.competitions) {
  return Object.values(competitions || {}).filter((c) => LIVE_STATUS.test(c?.status || ''));
}

/** 現在是否需要保持喚醒 */
export function shouldKeepAwake({ now = Date.now(), competitions = db.state.competitions, ready = db.ready, connectedClients = 0 } = {}) {
  if (!ready || !liveCompetitions(competitions).length) return false;
  const idle = now - lastActivityAt;
  if (idle < KEEP_AWAKE.activeWindowMs) return true;
  return connectedClients > 0 && idle < KEEP_AWAKE.connectedWindowMs;
}

/**
 * 啟動自我喚醒計時器。url：網站的公開網址（Render 會提供 RENDER_EXTERNAL_URL）；沒有網址時不啟動。
 * 回傳 { tick, stop, stats }：tick() 就是計時器每次執行的函數（測試直接呼叫或以假計時器推進）。
 */
export function startKeepAwake({ url, fetchFn = (...a) => fetch(...a), connectedClients = () => 0, log = console } = {}) {
  const stats = { enabled: !!url, intervalMs: KEEP_AWAKE.intervalMs, ticks: 0, pings: 0, lastPingAt: null, pingFailures: 0, errors: 0 };
  const tick = () => {
    stats.ticks += 1;
    let wake;
    try {
      wake = shouldKeepAwake({ connectedClients: connectedClients() });
    } catch (e) {
      // 不應發生；記錄完整錯誤（不會無聲忽略），但不可令課堂中的伺服器結束
      stats.errors += 1;
      log.error('保持喚醒檢查出錯（伺服器繼續運行）：', e);
      return false;
    }
    if (!wake) return false;
    stats.pings += 1;
    stats.lastPingAt = Date.now();
    const fail = (e) => { stats.pingFailures += 1; log.warn?.(`保持喚醒的自我請求失敗：${e?.message || e}`); };
    try {
      Promise.resolve(fetchFn(`${url}/healthz`, { headers: { 'user-agent': 'taiyau-keep-awake' } })).catch(fail);
    } catch (e) { fail(e); }
    return true;
  };
  const timer = url ? setInterval(tick, KEEP_AWAKE.intervalMs) : null;
  return { tick, stats, stop: () => { if (timer) clearInterval(timer); } };
}
