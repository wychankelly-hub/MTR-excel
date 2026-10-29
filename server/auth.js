// 身份驗證：Google Sign-in（ID Token 由伺服器核實）或 Demo 登入（清楚標示為模擬）。
// 只保存最少個人資料：Google sub、電郵（分享工作表所需）、顯示名稱。
import crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { config } from './config.js';
import { db, save } from './store.js';

const COOKIE = 'tyid';
const SESSION_TTL_MS = 12 * 3600 * 1000;

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function sign(v) {
  return crypto.createHmac('sha256', config.sessionSecret).update(v).digest('base64url');
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function createSession(res, userId) {
  const sid = crypto.randomBytes(24).toString('base64url');
  db.state.sessions[sid] = { userId, createdAt: Date.now() };
  save();
  const value = `${sid}.${sign(sid)}`;
  res.append('Set-Cookie', `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${config.secureCookies ? '; Secure' : ''}`);
  return sid;
}

export function destroySession(req, res) {
  const sid = sessionId(req);
  if (sid) { delete db.state.sessions[sid]; save(); }
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function sessionId(req) {
  const raw = parseCookies(req)[COOKIE];
  if (!raw) return null;
  const [sid, sig] = raw.split('.');
  if (!sid || !sig) return null;
  const expect = sign(sid);
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  const s = db.state.sessions[sid];
  if (!s || Date.now() - s.createdAt > SESSION_TTL_MS) return null;
  return sid;
}

export function currentUser(req) {
  const sid = sessionId(req);
  if (!sid) return null;
  return db.state.users[db.state.sessions[sid].userId] || null;
}

export function requireUser(req) {
  const u = currentUser(req);
  if (!u) throw new HttpError(401, '請先登入。', 'AUTH_REQUIRED');
  return u;
}

export function requireTeacher(req) {
  const u = requireUser(req);
  if (u.role !== 'teacher') throw new HttpError(403, '只有老師可以使用此功能。', 'TEACHER_ONLY');
  return u;
}

export function requireStudent(req) {
  const u = requireUser(req);
  if (u.role !== 'student') throw new HttpError(403, '此功能只供學生使用。', 'STUDENT_ONLY');
  return u;
}

function upsertUser(key, fields) {
  const id = `u_${crypto.createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
  const prev = db.state.users[id];
  db.state.users[id] = { ...(prev || { createdAt: Date.now() }), ...fields, id };
  save();
  return db.state.users[id];
}

let oauthClient = null;
export async function loginWithGoogle(credential) {
  if (!config.googleClientId) throw new HttpError(400, '伺服器尚未設定 Google Sign-in（GOOGLE_CLIENT_ID）。', 'GOOGLE_NOT_CONFIGURED');
  oauthClient ??= new OAuth2Client(config.googleClientId);
  let payload;
  try {
    const ticket = await oauthClient.verifyIdToken({ idToken: credential, audience: config.googleClientId });
    payload = ticket.getPayload();
  } catch {
    throw new HttpError(401, 'Google 登入核實失敗，請重新登入。', 'GOOGLE_TOKEN_INVALID');
  }
  if (!payload.email_verified) throw new HttpError(403, 'Google 帳戶電郵未核實。', 'EMAIL_UNVERIFIED');
  const email = payload.email.toLowerCase();
  const domain = email.split('@')[1];
  const isTeacher = config.teacherEmails.includes(email);
  if (!isTeacher && config.allowedEmailDomains.length && !config.allowedEmailDomains.includes(domain)) {
    throw new HttpError(403, `只接受以下網域的學校帳戶：${config.allowedEmailDomains.join(', ')}`, 'DOMAIN_NOT_ALLOWED');
  }
  return upsertUser(`google:${payload.sub}`, {
    provider: 'google',
    email,
    name: payload.given_name || payload.name || email.split('@')[0],
    role: isTeacher ? 'teacher' : 'student',
  });
}

/**
 * 訪客（Demo）學生身份。deviceKey 是存在該瀏覽器的隨機識別碼：
 * 不同電腦輸入相同英文名稱會成為不同的學生，不能冒認同學（舊版本只以名稱識別）。
 * 沒有 deviceKey（只在測試／命令列工具）時沿用以名稱識別。
 */
export function loginDemo({ role, name, pin, deviceKey }) {
  if (!config.allowDemoLogin) throw new HttpError(403, '此伺服器已停用 Demo 登入。', 'DEMO_DISABLED');
  if (role === 'teacher') {
    if (!config.demoTeacherPin) throw new HttpError(403, '此伺服器未設定老師登入碼（DEMO_TEACHER_PIN），請使用 Google 登入，或在雲端平台設定此環境變數。', 'NO_TEACHER_PIN');
    if (String(pin || '') !== config.demoTeacherPin) throw new HttpError(403, 'Demo 老師 PIN 不正確。', 'BAD_PIN');
    return upsertUser('demo:teacher', { provider: 'demo', email: null, name: 'Demo Teacher', role: 'teacher' });
  }
  const clean = String(name || '').trim();
  if (!/^[A-Za-z0-9 _.-]{1,24}$/.test(clean)) throw new HttpError(400, '請選擇或輸入英文／數字名稱（1–24 字元）。', 'BAD_NAME');
  const dk = deviceKey && /^[A-Za-z0-9_-]{16,64}$/.test(deviceKey) ? deviceKey : null;
  const key = dk ? `demo:student:${dk}:${clean.toLowerCase()}` : `demo:student:${clean.toLowerCase()}`;
  return upsertUser(key, { provider: 'demo', email: null, name: clean, role: 'student', guestTag: dk ? crypto.createHash('sha256').update(key).digest('hex').slice(0, 4) : null });
}

const GUEST_COOKIE = 'tyguest';

/** 取得（或建立）此瀏覽器的訪客識別碼；存放在已簽署的 cookie，一年有效 */
export function guestDeviceKey(req, res) {
  const raw = parseCookies(req)[GUEST_COOKIE];
  if (raw) {
    const [k, sig] = raw.split('.');
    const expect = k ? sign(`guest:${k}`) : '';
    if (k && sig && sig.length === expect.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return k;
  }
  const k = crypto.randomBytes(18).toString('base64url');
  res.append('Set-Cookie', `${GUEST_COOKIE}=${k}.${sign(`guest:${k}`)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${365 * 24 * 3600}${config.secureCookies ? '; Secure' : ''}`);
  return k;
}

export function publicUser(u) {
  if (!u) return null;
  return { id: u.id, name: u.name, role: u.role, provider: u.provider, email: u.email || null, guestTag: u.guestTag || null };
}
