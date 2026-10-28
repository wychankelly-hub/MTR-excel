#!/usr/bin/env python3
# 以開源粵語語音辨識（sherpa-onnx Paraformer：普通話／粵語／英語三語模型）把配音轉回文字，
# 與劇本比較相似度，客觀檢查配音是否可聽懂。
# 需要：pip install sherpa-onnx numpy opencc；模型：
#   https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-paraformer-trilingual-zh-cantonese-en.tar.bz2
# 用法：python3 scripts/verify-tts-asr.py <模型資料夾>
import sherpa_onnx, json, subprocess, numpy as np, opencc, difflib, glob, os, sys
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D=(sys.argv[1] if len(sys.argv)>1 else 'models/sherpa-onnx-paraformer-trilingual-zh-cantonese-en').rstrip('/')+'/'
rec=sherpa_onnx.OfflineRecognizer.from_paraformer(paraformer=D+('model.int8.onnx' if os.path.exists(D+'model.int8.onnx') else 'model.onnx'),tokens=D+'tokens.txt',num_threads=4)
cc=opencc.OpenCC('t2s')
man=json.load(open(os.path.join(ROOT,'public/audio/tts-manifest.json')))
norm=lambda s: ''.join(c for c in cc.convert(s).lower() if c.isalnum())
scores=[]
for lid,m in sorted(man.items()):
    pcm=subprocess.run(['ffmpeg','-loglevel','error','-i',os.path.join(ROOT,'public/audio',m['file']),'-f','s16le','-ac','1','-ar','16000','-'],capture_output=True).stdout
    a=np.frombuffer(pcm,dtype=np.int16).astype(np.float32)/32768
    s=rec.create_stream(); s.accept_waveform(16000,a); rec.decode_stream(s)
    hyp=s.result.text
    r=difflib.SequenceMatcher(None,norm(m['text']),norm(hyp)).ratio()
    scores.append(r)
    print(f"{r:.2f} {lid:22s} {m['text']}  ⇒  {hyp}")
print('mean similarity', round(sum(scores)/len(scores),3))
