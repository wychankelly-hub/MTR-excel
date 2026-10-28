// 本機（離線）廣東話語音合成：sherpa-onnx + 開源粵語 VITS 模型（vits-cantonese-hf-xiaomaiiwn）。
// - 模型以粵語拼音音素及聲調發音，不會讀成普通話。
// - 不需要任何雲端金鑰；模型由 `npm run tts:setup` 下載（約 110 MB）。
// - 每個角色以不同的語速、音高及共振峰處理（ffmpeg rubberband），形成可辨識的聲線。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { ROOT } from '../config.js';

const require = createRequire(import.meta.url);
export const MODEL_NAME = 'vits-cantonese-hf-xiaomaiiwn';
export const MODEL_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/${MODEL_NAME}.tar.bz2`;
export const MODEL_DIR = process.env.TTS_MODEL_DIR || path.join(ROOT, 'models', MODEL_NAME);

// 角色聲線（speed：語速；pitch：音高倍數；bass：低音加強 dB）
export const VOICE_PROFILES = {
  chanding: { label: '陳定：平穩、清晰、略慢（較低沉）', speed: 0.95, pitch: 0.86, bass: 2 },
  fatmaster: { label: '肥站長：低沉、誇張', speed: 1.0, pitch: 0.76, bass: 4 },
  rocket: { label: '火箭仔：語速快、自信', speed: 1.15, pitch: 0.93, bass: 0 },
  bat: { label: '八仔：活潑、清脆（較高音）', speed: 1.0, pitch: 1.12, bass: 0 },
  uncle: { label: '喂喂叔：大聲、低沉', speed: 1.05, pitch: 0.74, bass: 3 },
  passenger: { label: '乘客甲：原聲', speed: 1.0, pitch: 1.0, bass: 0 },
};

let t2s = null;
function prepareText(text) {
  t2s ??= JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 't2s-fallback.json'), 'utf8'));
  // 模型詞典中部分繁體字沒有讀音，改用讀音相同的簡體字（只影響合成輸入，字幕不變）；英文轉小寫字母
  return [...text.replace(/[「」『』]/g, '')].map((c) => t2s[c] || c).join('').replace(/[A-Z]/g, (c) => c.toLowerCase());
}

export function hasFfmpeg() {
  try { return spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0; } catch { return false; }
}

export function localTtsStatus() {
  let binding = false;
  try { require.resolve('sherpa-onnx-node'); binding = true; } catch { /* 未安裝 */ }
  const model = fs.existsSync(path.join(MODEL_DIR, `${MODEL_NAME}.onnx`));
  const ffmpeg = hasFfmpeg();
  return {
    ready: binding && model,
    binding, model, ffmpeg,
    modelDir: MODEL_DIR,
    reason: !binding ? '未安裝 sherpa-onnx-node（npm install）' : !model ? '未下載粵語模型（npm run tts:setup）' : null,
  };
}

let engine = null;
function getEngine() {
  if (engine) return engine;
  const st = localTtsStatus();
  if (!st.ready) throw new Error(`本機粵語 TTS 未就緒：${st.reason}`);
  const sherpa = require('sherpa-onnx-node');
  engine = new sherpa.OfflineTts({
    model: {
      vits: { model: path.join(MODEL_DIR, `${MODEL_NAME}.onnx`), lexicon: path.join(MODEL_DIR, 'lexicon.txt'), tokens: path.join(MODEL_DIR, 'tokens.txt') },
      numThreads: Math.max(1, Math.min(4, os.cpus().length - 1)),
      provider: 'cpu',
      debug: false,
    },
    ruleFsts: path.join(MODEL_DIR, 'rule.fst'),
    maxNumSentences: 2,
  });
  engine.sherpa = sherpa;
  return engine;
}

/**
 * 合成一句對白並輸出到 outFile（.mp3；沒有 ffmpeg 時改為 .wav 且不做聲線處理）。
 * 回傳實際輸出的檔案路徑。
 */
export function synthesizeLine({ text, speaker }, outFile) {
  const e = getEngine();
  const prof = VOICE_PROFILES[speaker] || VOICE_PROFILES.passenger;
  const audio = e.generate({ text: prepareText(text), sid: 0, speed: prof.speed });
  if (!audio.samples?.length) throw new Error('合成結果是空的');
  const tmp = path.join(os.tmpdir(), `taiyau-tts-${process.pid}-${Date.now()}.wav`);
  e.sherpa.writeWave(tmp, { samples: audio.samples, sampleRate: audio.sampleRate });
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  if (!hasFfmpeg()) {
    const wav = outFile.replace(/\.mp3$/, '.wav');
    fs.renameSync(tmp, wav);
    return wav;
  }
  const filters = [
    'adelay=120:all=1',
    prof.pitch !== 1 ? `rubberband=pitch=${prof.pitch}:formant=shifted` : null,
    prof.bass ? `bass=g=${prof.bass}` : null,
    'apad=pad_dur=0.15',
    'loudnorm=I=-16:TP=-1.5:LRA=11',
  ].filter(Boolean).join(',');
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', tmp, '-af', filters, '-ar', '24000', '-ac', '1', '-b:a', '64k', outFile]);
  fs.rmSync(tmp, { force: true });
  if (r.status !== 0) throw new Error(`ffmpeg 失敗：${r.stderr?.toString().slice(0, 200)}`);
  return outFile;
}
