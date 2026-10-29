// 廣東話配音資產管理：
// - 附帶的配音在 public/audio（隨程式部署）；
// - 老師錄音、上載或重新合成的配音存放在雲端資產庫（資料庫），會覆蓋附帶版本，重新部署亦不會消失。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, config } from './config.js';
void ROOT;
import { db, save, listAssets, putAsset, deleteAsset } from './store.js';
import { SPEAKERS } from './episode1/dialogue.js';
import { allAudioEvents } from './episodes/index.js';

// 所有劇集的對白（配音資產表、自動補齊、重新合成）
const AUDIO_EVENTS = allAudioEvents();
const ALL_LINES = AUDIO_EVENTS.flatMap((e) => e.lines.map((l) => ({ ...l, episode: e.episode || 'E1' })));
import { HttpError } from './auth.js';
import { clock } from './clock.js';
import { localTtsStatus, synthesizeLine, VOICE_PROFILES } from './tts/local-tts.js';

export const AUDIO_DIR = path.join(ROOT, 'public', 'audio');
const EXTS = ['mp3', 'm4a', 'ogg', 'wav', 'webm'];
const MIME = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/webm': 'webm' };

function fileFor(lineId) {
  const cloud = listAssets(`audio/${lineId}.`)[0];
  if (cloud) return { cloud: true, path: cloud.path, url: `/media/${cloud.path}`, mtime: cloud.version };
  for (const ext of EXTS) {
    const p = path.join(AUDIO_DIR, `${lineId}.${ext}`);
    if (fs.existsSync(p)) return { path: p, url: `/audio/${lineId}.${ext}`, mtime: fs.statSync(p).mtimeMs };
  }
  return null;
}

export function assetStatus(lineId) {
  const f = fileFor(lineId);
  if (!f) return { status: 'missing', url: null };
  const rec = db.state.audioAssets[lineId];
  // 檔案在批准後被替換 → 需要重新試聽
  if (rec?.status === 'approved' && rec.fileMtime === f.mtime) return { status: 'approved', url: f.url, reviewedBy: rec.reviewedBy, reviewedAt: rec.reviewedAt };
  if (rec?.status === 'rejected' && rec.fileMtime === f.mtime) return { status: 'rejected', url: f.url };
  return { status: 'unreviewed', url: f.url, source: rec?.source || (f.cloud ? null : ttsManifest()[lineId]?.source) || null };
}

const MANIFEST = () => path.join(AUDIO_DIR, 'tts-manifest.json');
function ttsManifest() {
  try { return JSON.parse(fs.readFileSync(MANIFEST(), 'utf8')); } catch { return {}; }
}

async function storeLine(lineId, buffer, contentType) {
  for (const a of listAssets(`audio/${lineId}.`)) await deleteAsset(a.path);
  await putAsset(`audio/${lineId}.${MIME[contentType] || 'mp3'}`, contentType, buffer);
}

/** 以本機粵語 TTS（重新）產生一句對白，存入雲端資產庫 */
export async function regenerateAsset(teacher, lineId) {
  const line = ALL_LINES.find((l) => l.line_id === lineId);
  if (!line) throw new HttpError(404, '沒有此配音行。');
  const st = localTtsStatus();
  if (!st.ready) throw new HttpError(409, `本機粵語 TTS 未就緒：${st.reason}`);
  const tmp = path.join(os.tmpdir(), `ty-${lineId}-${Date.now()}.mp3`);
  const file = synthesizeLine({ text: line.tts_input, speaker: line.speaker }, tmp);
  const type = file.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg';
  await storeLine(lineId, fs.readFileSync(file), type);
  fs.rmSync(file, { force: true });
  db.state.audioAssets[lineId] = { status: 'unreviewed', source: 'local-tts:sherpa-onnx/vits-cantonese', by: teacher?.name || 'system' };
  save();
}

/** 伺服器啟動時：如本機 TTS 已就緒，自動補齊缺少的配音（逐句，在背景進行） */
export function autoFillMissingAudio(log = console.log) {
  if (!localTtsStatus().ready) return 0;
  const missing = ALL_LINES.filter((l) => !fileFor(l.line_id));
  missing.forEach((l, i) => setTimeout(() => {
    regenerateAsset(null, l.line_id).then(() => log(`  已產生粵語配音 ${l.line_id}`), (e) => log(`  ✗ ${l.line_id}：${e.message}`));
  }, 200 * (i + 1)));
  return missing.length;
}

/** 播放指令內容：字幕永遠提供；音檔只在「已批准」（或設定容許未試聽）時提供 URL */
export function resolvedEvent(eventId) {
  const e = AUDIO_EVENTS.find((x) => x.id === eventId);
  return {
    sfx: e.sfx || null,
    caption: e.caption || null,
    spoiler: e.spoiler,
    lines: e.lines.map((l) => {
      const st = assetStatus(l.line_id);
      const playable = st.url && (st.status === 'approved' || (!config.audioRequireApproval && st.status !== 'rejected'));
      return {
        line_id: l.line_id, speaker: l.speaker, speaker_name: l.speaker_name, color: SPEAKERS[l.speaker].color,
        subtitle_zh_Hant: l.subtitle_zh_Hant, estimated_duration: l.estimated_duration, asset_status: st.status,
        audio_url: playable ? `${st.url}?v=${Math.round(fileFor(l.line_id).mtime)}` : null,
      };
    }),
  };
}

export function assetTable() {
  const m = ttsManifest();
  return ALL_LINES.map((l) => ({ ...l, ...assetStatus(l.line_id), asset_status: assetStatus(l.line_id).status, voice: m[l.line_id]?.voice || VOICE_PROFILES[l.speaker]?.label }));
}

/** 刪除雲端版本，回復使用附帶的配音 */
export async function revertAsset(teacher, lineId) {
  for (const a of listAssets(`audio/${lineId}.`)) await deleteAsset(a.path);
  delete db.state.audioAssets[lineId];
  save();
}

export function reviewAsset(teacher, lineId, status) {
  if (!ALL_LINES.some((l) => l.line_id === lineId)) throw new HttpError(404, '沒有此配音行。');
  if (!['approved', 'rejected', 'unreviewed'].includes(status)) throw new HttpError(400, '狀態不正確。');
  const f = fileFor(lineId);
  if (!f) throw new HttpError(409, '尚未有音檔，不能批准。');
  db.state.audioAssets[lineId] = { ...(db.state.audioAssets[lineId] || {}), status, reviewedBy: teacher.name, reviewedAt: clock.now(), fileMtime: f.mtime };
  save();
}

export async function uploadAsset(teacher, lineId, buffer, contentType) {
  if (!ALL_LINES.some((l) => l.line_id === lineId)) throw new HttpError(404, '沒有此配音行。');
  const ext = MIME[String(contentType).split(';')[0].trim().toLowerCase()];
  if (!ext) throw new HttpError(415, '只接受 mp3 / m4a / ogg / wav / webm 音檔。');
  if (!buffer?.length) throw new HttpError(400, '音檔是空的。');
  const type = Object.keys(MIME).find((k) => MIME[k] === ext && k === String(contentType).split(';')[0].trim().toLowerCase()) || 'audio/mpeg';
  await storeLine(lineId, buffer, type);
  db.state.audioAssets[lineId] = { status: 'unreviewed', source: `teacher-upload:${teacher.name}`, uploadedAt: clock.now() };
  save();
}
