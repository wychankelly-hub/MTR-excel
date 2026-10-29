#!/usr/bin/env node
// 以雲端 TTS 產生廣東話配音初稿 → public/audio/<line_id>.mp3（狀態：待試聽）。
// ⚠️ 產生後必須由老師在「配音資產」逐句試聽、確認是自然香港粵語（不是普通話）才按「批准」。
//
// 支援：
//   local（預設）：本機離線粵語 VITS（sherpa-onnx），不需金鑰；先執行 npm run tts:setup
//   Azure Speech（建議，zh-HK 神經語音較自然）：AZURE_SPEECH_KEY、AZURE_SPEECH_REGION
//   Google Cloud Text-to-Speech（yue-HK）：GOOGLE_TTS_API_KEY
// 用法：
//   node scripts/generate-tts.js --provider azure [--only L1_OPEN] [--force] [--dry-run]
//   node scripts/generate-tts.js --provider google
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../server/config.js';
import { allAudioEvents } from '../server/episodes/index.js';
import { localTtsStatus, synthesizeLine, VOICE_PROFILES } from '../server/tts/local-tts.js';

const args = process.argv.slice(2);
const opt = (k, d = null) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const provider = opt('--provider', localTtsStatus().ready ? 'local' : process.env.AZURE_SPEECH_KEY ? 'azure' : 'google');
const only = opt('--only');
const force = args.includes('--force');
const dry = args.includes('--dry-run');
const outDir = path.join(ROOT, 'public', 'audio');

// 角色聲線設定（可按試聽結果調整）
const VOICES = {
  azure: {
    chanding: { voice: 'zh-HK-WanLungNeural', rate: '-8%', pitch: '-2%' },
    fatmaster: { voice: 'zh-HK-WanLungNeural', rate: '+6%', pitch: '-12%' },
    rocket: { voice: 'zh-HK-WanLungNeural', rate: '+22%', pitch: '+10%' },
    bat: { voice: 'zh-HK-HiuGaaiNeural', rate: '+4%', pitch: '+8%' },
    uncle: { voice: 'zh-HK-WanLungNeural', rate: '+10%', pitch: '-18%' },
    passenger: { voice: 'zh-HK-HiuMaanNeural', rate: '0%', pitch: '0%' },
  },
  google: {
    chanding: { name: 'yue-HK-Standard-B', speakingRate: 0.92, pitch: -1 },
    fatmaster: { name: 'yue-HK-Standard-D', speakingRate: 1.05, pitch: -4 },
    rocket: { name: 'yue-HK-Standard-B', speakingRate: 1.22, pitch: 3 },
    bat: { name: 'yue-HK-Standard-A', speakingRate: 1.02, pitch: 3 },
    uncle: { name: 'yue-HK-Standard-D', speakingRate: 1.08, pitch: -6 },
    passenger: { name: 'yue-HK-Standard-C', speakingRate: 1.0, pitch: 0 },
  },
};

const esc = (s) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

async function azure(line) {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  if (!key || !region) throw new Error('需要 AZURE_SPEECH_KEY 及 AZURE_SPEECH_REGION');
  const v = VOICES.azure[line.speaker];
  const ssml = `<speak version="1.0" xml:lang="zh-HK"><voice name="${v.voice}"><prosody rate="${v.rate}" pitch="${v.pitch}">${esc(line.spoken_cantonese_text)}</prosody></voice></speak>`;
  const r = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-96kbitrate-mono-mp3', 'User-Agent': 'taiyau-ep1' },
    body: ssml,
  });
  if (!r.ok) throw new Error(`Azure ${r.status}: ${await r.text()}`);
  return Buffer.from(await r.arrayBuffer());
}

async function google(line) {
  const key = process.env.GOOGLE_TTS_API_KEY;
  if (!key) throw new Error('需要 GOOGLE_TTS_API_KEY');
  const v = VOICES.google[line.speaker];
  const r = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: { text: line.spoken_cantonese_text }, voice: { languageCode: 'yue-HK', name: v.name }, audioConfig: { audioEncoding: 'MP3', speakingRate: v.speakingRate, pitch: v.pitch } }),
  });
  if (!r.ok) throw new Error(`Google TTS ${r.status}: ${await r.text()}`);
  return Buffer.from((await r.json()).audioContent, 'base64');
}

fs.mkdirSync(outDir, { recursive: true });
// 所有劇集的對白；--only 可以是事件、句子或劇集編號（例如 E2）
const ALL_LINES = allAudioEvents().flatMap((e) => e.lines.map((l) => ({ ...l, episode: e.episode })));
const lines = ALL_LINES.filter((l) => !only || l.event_id === only || l.line_id === only || l.episode === only);
let made = 0;
const manifestFile = path.join(outDir, 'tts-manifest.json');
const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};
for (const line of lines) {
  const file = path.join(outDir, `${line.line_id}.mp3`);
  const exists = ['mp3', 'm4a', 'ogg', 'wav', 'webm'].some((e) => fs.existsSync(path.join(outDir, `${line.line_id}.${e}`)));
  if (exists && !force) { console.log(`略過（已有音檔）${line.line_id}`); continue; }
  console.log(`${dry ? '[dry-run] ' : ''}${provider} ${line.line_id} ${line.speaker_name}：${line.spoken_cantonese_text}`);
  if (dry) continue;
  try {
    let written = file;
    if (provider === 'local') written = synthesizeLine({ text: line.tts_input, speaker: line.speaker }, file);
    else fs.writeFileSync(file, provider === 'azure' ? await azure(line) : await google(line));
    manifest[line.line_id] = { source: provider === 'local' ? 'local-tts:sherpa-onnx/vits-cantonese' : `cloud-tts:${provider}`, voice: provider === 'local' ? VOICE_PROFILES[line.speaker].label : null, text: line.spoken_cantonese_text, file: path.basename(written), generatedAt: new Date().toISOString() };
    made++;
  } catch (e) {
    console.error(`  ✗ ${e.message}`);
    process.exitCode = 1;
  }
}
if (!dry) fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
console.log(`\n完成：產生 ${made} 個音檔。可在教師控制台「配音資產」試聽；如某句讀得不自然，可按「退回」或改用真人錄音。`);
