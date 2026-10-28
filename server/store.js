// 資料儲存（兩種驅動）：
//   postgres —— 雲端部署（設定 DATABASE_URL）：比賽、成績、隊伍、登入 session、
//              老師上載的錄音及角色圖片全部存放在託管 PostgreSQL（Render／Neon／Supabase 等）。
//              伺服器重新啟動、重新部署或老師關掉電腦，進度都不會消失。
//   file     —— 本機開發／測試：data/state.json（原子寫入）及 data/assets/。
// 數據集本身不儲存：由 seed + Generator Version 重新生成，並以 checksum 核實（可重現）。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import { config } from './config.js';

const FILE = () => path.join(config.dataDir, 'state.json');
const ASSET_DIR = () => path.join(config.dataDir, 'assets');

const empty = () => ({
  version: 1,
  users: {},
  sessions: {},
  competitions: {},
  demoSheets: {}, // compId -> teamId -> sheet -> { addr: input }
  audioAssets: {}, // lineId -> { status, reviewedBy, reviewedAt }
  googleOAuth: null, // { refreshToken, email, connectedAt }
  heartbeat: null, // { at } 比賽進行中每 5 秒更新：重新啟動時用來計算伺服器中斷了多久
});

// lastAliveAt：上次關閉／當機前最後一次確認伺服器仍在運行的時間（重新啟動後補回比賽時間用）
// fenced：另一個伺服器實例（例如雲端重新部署時的新版本）已接手資料庫，本實例不可再寫入
export const db = { state: empty(), driver: 'file', ready: false, lastAliveAt: null, fenced: false };

let pool = null;
const lastSaved = new Map(); // key -> JSON 字串（只寫入有改變的資料）
let writing = Promise.resolve(true);
const instanceId = `${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
// 只檢查有改變的部分：competition:<id>、demoSheets:<id>；不指明時檢查全部
let dirtyAll = true;
const dirty = new Set();
const stats = { since: Date.now(), writes: 0, keysWritten: 0, bytesWritten: 0, bytesRead: 0, failures: 0, lastWriteMs: null };
// 提交紀錄及審計紀錄分段儲存：每次只需寫入核心資料及最新一段，而不是整個比賽紀錄
const SUB_CHUNK = 25;
const AUDIT_CHUNK = 100;
const assetIndex = new Map(); // path -> { contentType, size, version }
const assetCache = new Map(); // path -> Buffer

export function storageInfo() {
  return {
    driver: db.driver, ready: db.ready && !db.fenced, persistent: db.driver === 'postgres', fenced: db.fenced,
    usage: { ...stats, mbWritten: +(stats.bytesWritten / 1048576).toFixed(2), mbRead: +(stats.bytesRead / 1048576).toFixed(2) },
  };
}

// ---------------------------------------------------------------- 初始化
/** 同步載入（檔案模式；測試及命令列工具使用） */
export function load() {
  db.driver = 'file';
  fs.mkdirSync(config.dataDir, { recursive: true });
  if (fs.existsSync(FILE())) {
    try {
      db.state = { ...empty(), ...JSON.parse(fs.readFileSync(FILE(), 'utf8')) };
      db.lastAliveAt = Math.max(db.state.heartbeat?.at || 0, fs.statSync(FILE()).mtimeMs) || null;
    } catch (e) {
      const bad = `${FILE()}.corrupt-${Date.now()}`;
      fs.renameSync(FILE(), bad);
      console.error(`state.json 無法讀取，已另存為 ${bad}`, e);
      db.state = empty();
    }
  }
  loadFileAssetIndex();
  db.ready = true;
  return db.state;
}

function sslFor(url) {
  if (/sslmode=disable/.test(url)) return undefined;
  const host = new URL(url).hostname;
  // localhost 及 Render 內部主機名（沒有「.」）不使用 SSL；其他託管資料庫一律 SSL
  if (host === 'localhost' || host === '127.0.0.1' || !host.includes('.')) return undefined;
  return { rejectUnauthorized: false };
}

/** 啟動時呼叫：有 DATABASE_URL 就使用雲端資料庫，否則使用檔案 */
export async function init() {
  if (!config.databaseUrl) return load();
  db.driver = 'postgres';
  pool = new pg.Pool({ connectionString: config.databaseUrl, ssl: sslFor(config.databaseUrl), max: 5, idleTimeoutMillis: 30000 });
  pool.on('error', (e) => console.error('資料庫連線錯誤：', e.message));
  await pool.query(`CREATE TABLE IF NOT EXISTS ty_kv (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS ty_assets (path TEXT PRIMARY KEY, content_type TEXT NOT NULL, data BYTEA NOT NULL, size INTEGER NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  // 先「接手」資料庫才讀取：之後舊實例（例如重新部署時仍在運行的舊版本）的寫入會被拒絕，
  // 避免兩個實例互相覆蓋。舊實例正在進行的寫入會先完成（行鎖），所以這裏讀到的是最新資料。
  await pool.query(`INSERT INTO ty_kv (key, value, updated_at) VALUES ('owner', $1::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [JSON.stringify({ instance: instanceId, at: Date.now() })]);
  const state = empty();
  const { rows } = await pool.query(`SELECT key, value, extract(epoch from updated_at)*1000 AS t FROM ty_kv WHERE key <> 'owner'`);
  const comps = {};
  let lastWrite = 0;
  for (const { key, value, t } of rows) {
    lastSaved.set(key, JSON.stringify(value));
    stats.bytesRead += lastSaved.get(key).length;
    lastWrite = Math.max(lastWrite, Number(t));
    const m = key.match(/^competition:([^:]+)(?::(sub|audit):(\d+))?$/);
    if (m) {
      const c = (comps[m[1]] ??= { core: null, sub: [], audit: [] });
      if (m[2]) c[m[2]][Number(m[3])] = value;
      else c.core = value;
    } else if (key.startsWith('demoSheets:')) state.demoSheets[key.slice(11)] = value;
    else if (key in state) state[key] = value;
  }
  for (const [id, { core, sub, audit }] of Object.entries(comps)) {
    if (!core) continue;
    // 新格式：分段；舊格式（整個比賽一個值）照樣讀取，下次寫入時自動轉為分段
    if (core.submissionChunks !== undefined) core.submissions = Array.from({ length: core.submissionChunks }, (_, i) => sub[i] || []).flat();
    if (core.auditChunks !== undefined) core.audit = Array.from({ length: core.auditChunks }, (_, i) => audit[i] || []).flat();
    delete core.submissionChunks;
    delete core.auditChunks;
    core.submissions ??= [];
    core.audit ??= [];
    state.competitions[id] = core;
  }
  db.state = state;
  db.lastAliveAt = Math.max(state.heartbeat?.at || 0, lastWrite) || null;
  const a = await pool.query('SELECT path, content_type, size, extract(epoch from updated_at)*1000 AS v FROM ty_assets');
  for (const r of a.rows) assetIndex.set(r.path, { contentType: r.content_type, size: r.size, version: Math.round(Number(r.v)) });
  db.ready = true;
  return state;
}

// ---------------------------------------------------------------- 儲存
let timer = null;
/** 標記有改變並在約 0.15 秒內寫入。group：只檢查這部分（例如 `competition:<id>`）；不指明則檢查全部 */
export function save(group) {
  if (group) dirty.add(group);
  else dirtyAll = true;
  if (timer) return;
  timer = setTimeout(() => { timer = null; flush(); }, 150);
}

/** 伺服器仍在運行（比賽進行中每 5 秒）：寫入一個很小的紀錄 */
export function heartbeat(at) {
  db.state.heartbeat = { at };
  save('heartbeat');
}

function pruneSessions() {
  const now = Date.now();
  for (const [sid, s] of Object.entries(db.state.sessions)) if (now - s.createdAt > 13 * 3600 * 1000) delete db.state.sessions[sid];
}

function addCompetition(out, id, c) {
  const { submissions = [], audit = [], ...core } = c;
  // 投影畫面每 15 秒的狀態回報只屬即時資訊，不寫入資料庫（重新啟動後投影畫面會再次回報）
  if (core.audio) {
    core.audio = { ...core.audio };
    delete core.audio.projectors;
    delete core.audio.projector;
  }
  core.submissionChunks = Math.ceil(submissions.length / SUB_CHUNK);
  core.auditChunks = Math.ceil(audit.length / AUDIT_CHUNK);
  out.set(`competition:${id}`, core);
  for (let i = 0; i < core.submissionChunks; i++) out.set(`competition:${id}:sub:${i}`, submissions.slice(i * SUB_CHUNK, (i + 1) * SUB_CHUNK));
  for (let i = 0; i < core.auditChunks; i++) out.set(`competition:${id}:audit:${i}`, audit.slice(i * AUDIT_CHUNK, (i + 1) * AUDIT_CHUNK));
}

function snapshotKeys(all, groups) {
  const s = db.state;
  const out = new Map();
  if (all) {
    for (const k of ['users', 'sessions', 'audioAssets', 'googleOAuth', 'heartbeat']) out.set(k, s[k]);
    for (const [id, c] of Object.entries(s.competitions)) addCompetition(out, id, c);
    for (const [id, d] of Object.entries(s.demoSheets)) out.set(`demoSheets:${id}`, d);
    return out;
  }
  for (const g of groups) {
    if (g === 'heartbeat') out.set(g, s.heartbeat);
    else if (g.startsWith('competition:')) { const c = s.competitions[g.slice(12)]; if (c) addCompetition(out, g.slice(12), c); }
    else if (g.startsWith('demoSheets:')) { const d = s.demoSheets[g.slice(11)]; if (d) out.set(g, d); }
  }
  return out;
}

/** 寫入。檔案模式為同步；資料庫模式按次序寫入，回傳 Promise<boolean>（是否已成功寫入） */
export function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  const all = dirtyAll;
  const groups = [...dirty];
  dirtyAll = false;
  dirty.clear();
  if (db.driver !== 'postgres') {
    pruneSessions();
    fs.mkdirSync(config.dataDir, { recursive: true });
    const tmp = `${FILE()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db.state));
    fs.renameSync(tmp, FILE());
    return Promise.resolve(true);
  }
  if (db.fenced) return Promise.resolve(false);
  if (all) pruneSessions();
  const keys = snapshotKeys(all, groups);
  const changes = [];
  for (const [k, v] of keys) {
    const json = JSON.stringify(v ?? null);
    if (lastSaved.get(k) !== json) changes.push([k, json]);
  }
  const removed = all ? [...lastSaved.keys()].filter((k) => !keys.has(k)) : [];
  if (!changes.length && !removed.length) return writing;
  for (const [k, json] of changes) lastSaved.set(k, json);
  for (const k of removed) lastSaved.delete(k);
  writing = writing.then(async () => {
    let client = null;
    const t0 = Date.now();
    try {
      // Neon 免費資料庫閒置會休眠並中斷連線；connect 失敗亦要重試，不可令之後的寫入停止
      client = await pool.connect();
      await client.query('BEGIN');
      const owner = await client.query(`SELECT value FROM ty_kv WHERE key = 'owner' FOR UPDATE`);
      if (owner.rows[0]?.value?.instance !== instanceId) {
        const e = new Error('另一個伺服器實例已接手資料庫，本實例停止寫入');
        e.fenced = true;
        throw e;
      }
      let bytes = 0;
      for (const [k, json] of changes) {
        await client.query('INSERT INTO ty_kv (key, value, updated_at) VALUES ($1, $2::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()', [k, json]);
        bytes += json.length;
      }
      if (removed.length) await client.query('DELETE FROM ty_kv WHERE key = ANY($1)', [removed]);
      await client.query('COMMIT');
      stats.writes += 1;
      stats.keysWritten += changes.length;
      stats.bytesWritten += bytes;
      stats.lastWriteMs = Date.now() - t0;
      return true;
    } catch (e) {
      await client?.query('ROLLBACK').catch(() => {});
      for (const [k] of changes) lastSaved.delete(k); // 下次重試
      stats.failures += 1;
      dirtyAll = true;
      if (e.fenced) {
        if (!db.fenced) console.error(`⚠️ ${e.message}（雲端重新部署時屬正常）`);
        db.fenced = true;
        return false;
      }
      console.error('寫入資料庫失敗，稍後重試：', e.message);
      setTimeout(() => save(), 2000);
      return false;
    } finally {
      client?.release();
    }
  });
  return writing;
}

/**
 * 立即寫入並等待完成，回傳是否所有改變都已安全寫入資料庫。
 * 會改變資料的請求（例如提交答案）在回覆學生「已核實」之前先呼叫這個函數：
 * 伺服器即使在回覆後立即當機，已回覆的結果亦已存於資料庫。
 */
export async function persistNow() {
  if (db.driver !== 'postgres') { flush(); return true; }
  for (let i = 0; i < 3; i++) {
    const ok = await flush();
    if (db.fenced) return false;
    if (ok && !dirtyAll && dirty.size === 0) return true;
  }
  return false;
}

export async function close() {
  await flush();
  await writing;
  if (pool) { await pool.end(); pool = null; }
}

export function reset() {
  db.state = empty();
}

// ---------------------------------------------------------------- 雲端資產（錄音、角色圖片）
function loadFileAssetIndex() {
  assetIndex.clear();
  const root = ASSET_DIR();
  if (!fs.existsSync(root)) return;
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else if (!f.name.endsWith('.meta.json')) {
        const rel = path.relative(root, p).split(path.sep).join('/');
        let meta = {};
        try { meta = JSON.parse(fs.readFileSync(`${p}.meta.json`, 'utf8')); } catch { /* 舊檔案 */ }
        const st = fs.statSync(p);
        assetIndex.set(rel, { contentType: meta.contentType || 'application/octet-stream', size: st.size, version: Math.round(st.mtimeMs) });
      }
    }
  };
  walk(root);
}

export function assetInfo(p) { return assetIndex.get(p) || null; }

export function listAssets(prefix = '') {
  return [...assetIndex].filter(([p]) => p.startsWith(prefix)).map(([p, m]) => ({ path: p, ...m }));
}

export async function putAsset(p, contentType, buffer) {
  if (!/^[a-z0-9_\-/.]+$/i.test(p) || p.includes('..')) throw new Error('資產路徑不正確');
  const version = Date.now();
  if (db.driver === 'postgres') {
    await pool.query('INSERT INTO ty_assets (path, content_type, data, size, updated_at) VALUES ($1,$2,$3,$4,to_timestamp($5/1000.0)) ON CONFLICT (path) DO UPDATE SET content_type=EXCLUDED.content_type, data=EXCLUDED.data, size=EXCLUDED.size, updated_at=EXCLUDED.updated_at', [p, contentType, buffer, buffer.length, version]);
  } else {
    const f = path.join(ASSET_DIR(), p);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, buffer);
    fs.writeFileSync(`${f}.meta.json`, JSON.stringify({ contentType }));
  }
  assetIndex.set(p, { contentType, size: buffer.length, version });
  assetCache.set(p, buffer);
  return assetIndex.get(p);
}

export async function getAsset(p) {
  const meta = assetIndex.get(p);
  if (!meta) return null;
  let data = assetCache.get(p);
  if (!data) {
    if (db.driver === 'postgres') {
      const r = await pool.query('SELECT data FROM ty_assets WHERE path = $1', [p]);
      data = r.rows[0]?.data;
      stats.bytesRead += data?.length || 0;
    } else {
      data = fs.readFileSync(path.join(ASSET_DIR(), p));
    }
    if (!data) return null;
    if (data.length < 2_000_000) assetCache.set(p, data);
  }
  return { ...meta, data };
}

export async function deleteAsset(p) {
  if (db.driver === 'postgres') await pool.query('DELETE FROM ty_assets WHERE path = $1', [p]);
  else {
    const f = path.join(ASSET_DIR(), p);
    fs.rmSync(f, { force: true });
    fs.rmSync(`${f}.meta.json`, { force: true });
  }
  assetIndex.delete(p);
  assetCache.delete(p);
}
