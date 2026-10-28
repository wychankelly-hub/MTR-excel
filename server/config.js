// 環境設定（讀取 .env）。所有正式外部憑證皆為可選；未設定時只開放 Demo Mode。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envFile = process.env.ENV_FILE || path.join(ROOT, '.env');
if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);

const env = (k, d = '') => (process.env[k] ?? d).trim();
const list = (k) => env(k).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const bool = (k, d) => (process.env[k] === undefined ? d : /^(1|true|yes)$/i.test(env(k)));

const googleClientId = env('GOOGLE_CLIENT_ID');

const production = process.env.NODE_ENV === 'production';

export const config = {
  production,
  // 雲端資料庫（PostgreSQL）。設定後所有比賽資料、成績、上載的錄音及圖片都存放在雲端，不依賴伺服器硬碟。
  databaseUrl: env('DATABASE_URL'),
  port: Number(env('PORT', '3000')),
  // Render 會自動提供 RENDER_EXTERNAL_URL；其他平台請設定 PUBLIC_BASE_URL
  publicBaseUrl: env('PUBLIC_BASE_URL', env('RENDER_EXTERNAL_URL', `http://localhost:${env('PORT', '3000')}`)).replace(/\/$/, ''),
  dataDir: env('DATA_DIR', path.join(ROOT, 'data')),
  sessionSecret: env('SESSION_SECRET') || crypto.randomBytes(32).toString('hex'),
  secureCookies: bool('SECURE_COOKIES', production),

  // Demo Mode（模擬）
  allowDemoLogin: bool('ALLOW_DEMO_LOGIN', true),
  // 雲端（production）必須自行設定；未設定時停用老師的訪客登入，以免任何人用預設 PIN 登入
  demoTeacherPin: env('DEMO_TEACHER_PIN', production ? '' : '2468'),

  // Google Sign-in（學生及老師登入）
  googleClientId,
  googleClientSecret: env('GOOGLE_CLIENT_SECRET'),
  teacherEmails: list('TEACHER_EMAILS'),
  allowedEmailDomains: list('ALLOWED_EMAIL_DOMAINS'),

  // Google Sheets / Drive（真實工作表）
  // 方式 A：老師以 OAuth 連接（drive.file 權限，最少授權）—— 需要 GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET
  // 方式 B：Service Account JSON 金鑰（配合 Shared Drive 資料夾或老師預先分享的 Sheet）
  googleServiceAccountKeyFile: env('GOOGLE_SERVICE_ACCOUNT_KEY_FILE'),
  googleDriveFolderId: env('GOOGLE_DRIVE_FOLDER_ID'),

  // 音訊
  // false（預設）：未被老師退回的音檔都會自動播放；true：只播放老師已批准的音檔
  audioRequireApproval: bool('AUDIO_REQUIRE_APPROVAL', false),
};

export const features = () => ({
  demoLogin: config.allowDemoLogin,
  googleSignIn: !!config.googleClientId,
  googleOAuthConnect: !!(config.googleClientId && config.googleClientSecret),
  googleServiceAccount: !!config.googleServiceAccountKeyFile && fs.existsSync(config.googleServiceAccountKeyFile),
});
