// 資料儲存（兩種驅動）：
//   postgres —— 雲端部署（設定 DATABASE_URL）：比賽、成績、隊伍、登入 session、
//              老師上載的錄音及角色圖片全部存放在託管 PostgreSQL（Render／Neon／Supabase 等）。
//              伺服器重新啟動、重新部署或老師關掉電腦，進度都不會消失。
//   file     —— 本機開發／測試：data/state.json（原子寫入）及 data/assets/。
// 數據集本身不儲存：由 seed + Generator Version 重新生成，並以 checksum 核實（可重現）。
import fs from 'node:fs';
import path from 'node:path';
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
});

export const db = { state: empty(), driver: 'file', ready: false };

let pool = null;
const lastSaved = new Map(); // key -> JSON 字串（只寫入有改變的資料）
let writing = Promise.resolve();
const assetIndex = new Map(); // path -> { contentType, size, version }
const assetCache = new Map(); // path -> Buffer

export function storageInfo() {
  return { driver: db.driver, ready: db.ready, persistent: db.driver === 'postgres' };
}

// ---------------------------------------------------------------- 初始化
/** 同步載入（檔案模式；測試及命令列工具使用） */
export function load() {
  db.driver = 'file';
  fs.mkdirSync(config.dataDir, { recursive: true });
  if (fs.existsSync(FILE())) {
    try {
      db.state = { ...empty(), ...JSON.parse(fs.readFileSync(FILE(), 'utf8')) };
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
  const state = empty();
  const { rows } = await pool.query('SELECT key, value FROM ty_kv');
  for (const { key, value } of rows) {
    if (key.startsWith('competition:')) state.competitions[key.slice(12)] = value;
    else if (key.startsWith('demoSheets:')) state.demoSheets[key.slice(11)] = value;
    else if (key in state) state[key] = value;
    lastSaved.set(key, JSON.stringify(value));
  }
  db.state = state;
  const a = await pool.query('SELECT path, content_type, size, extract(epoch from updated_at)*1000 AS v FROM ty_assets');
  for (const r of a.rows) assetIndex.set(r.path, { contentType: r.content_type, size: r.size, version: Math.round(Number(r.v)) });
  db.ready = true;
  return state;
}

// ---------------------------------------------------------------- 儲存
let timer = null;
export function save() {
  if (timer) return;
  timer = setTimeout(() => { timer = null; flush(); }, 150);
}

function pruneSessions() {
  const now = Date.now();
  for (const [sid, s] of Object.entries(db.state.sessions)) if (now - s.createdAt > 13 * 3600 * 1000) delete db.state.sessions[sid];
}

function snapshotKeys() {
  const s = db.state;
  const out = new Map([
    ['users', s.users], ['sessions', s.sessions], ['audioAssets', s.audioAssets], ['googleOAuth', s.googleOAuth],
  ]);
  for (const [id, c] of Object.entries(s.competitions)) out.set(`competition:${id}`, c);
  for (const [id, d] of Object.entries(s.demoSheets)) out.set(`demoSheets:${id}`, d);
  return out;
}

/** 寫入（檔案模式為同步；資料庫模式回傳 Promise，並按次序寫入） */
export function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  pruneSessions();
  if (db.driver !== 'postgres') {
    fs.mkdirSync(config.dataDir, { recursive: true });
    const tmp = `${FILE()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db.state));
    fs.renameSync(tmp, FILE());
    return Promise.resolve();
  }
  const keys = snapshotKeys();
  const changes = [];
  for (const [k, v] of keys) {
    const json = JSON.stringify(v ?? null);
    if (lastSaved.get(k) !== json) changes.push([k, json]);
  }
  const removed = [...lastSaved.keys()].filter((k) => !keys.has(k));
  if (!changes.length && !removed.length) return writing;
  for (const [k, json] of changes) lastSaved.set(k, json);
  for (const k of removed) lastSaved.delete(k);
  writing = writing.then(async () => {
    let client = null;
    try {
      // Neon 免費資料庫閒置會休眠並中斷連線；connect 失敗亦要重試，不可令之後的寫入停止
      client = await pool.connect();
      await client.query('BEGIN');
      for (const [k, json] of changes) {
        await client.query('INSERT INTO ty_kv (key, value, updated_at) VALUES ($1, $2::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()', [k, json]);
      }
      if (removed.length) await client.query('DELETE FROM ty_kv WHERE key = ANY($1)', [removed]);
      await client.query('COMMIT');
    } catch (e) {
      await client?.query('ROLLBACK').catch(() => {});
      for (const [k] of changes) lastSaved.delete(k); // 下次重試
      console.error('寫入資料庫失敗，稍後重試：', e.message);
      setTimeout(save, 2000);
    } finally {
      client?.release();
    }
  });
  return writing;
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
