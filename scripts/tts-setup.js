#!/usr/bin/env node
// 下載本機粵語 TTS 模型（sherpa-onnx 開源 Cantonese VITS，約 110 MB）到 models/。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MODEL_URL, MODEL_DIR, MODEL_NAME, localTtsStatus } from '../server/tts/local-tts.js';

if (fs.existsSync(path.join(MODEL_DIR, `${MODEL_NAME}.onnx`))) {
  console.log(`模型已存在：${MODEL_DIR}`);
} else {
  const parent = path.dirname(MODEL_DIR);
  fs.mkdirSync(parent, { recursive: true });
  const archive = path.join(parent, `${MODEL_NAME}.tar.bz2`);
  console.log(`下載 ${MODEL_URL} …`);
  const res = await fetch(MODEL_URL);
  if (!res.ok) { console.error(`✗ 下載失敗：HTTP ${res.status}`); process.exit(1); }
  fs.writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
  const r = spawnSync('tar', ['xjf', archive, '-C', parent], { stdio: 'inherit' });
  if (r.status !== 0) { console.error('✗ 解壓失敗（需要 tar 及 bzip2）'); process.exit(1); }
  fs.rmSync(archive, { force: true });
  console.log(`✓ 已安裝到 ${MODEL_DIR}`);
}
const st = localTtsStatus();
console.log(`狀態：${st.ready ? '就緒' : `未就緒（${st.reason}）`}；ffmpeg：${st.ffmpeg ? '有（可做角色聲線處理及輸出 mp3）' : '沒有（只輸出 wav，所有角色同一聲線）'}`);
console.log('下一步：npm run tts:generate -- --provider local');
