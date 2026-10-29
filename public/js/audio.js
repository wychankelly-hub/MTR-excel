// 廣東話配音、背景音樂及鐵路風格音效（播放端：投影或老師電腦）。
// - 一次性啟用：老師按「開始遊戲」（或投影端按一下）解除瀏覽器自動播放限制，之後全部自動播放。
// - 事件排隊，不重疊；配音時背景音樂自動降低音量；字幕與音檔同步（以音檔播放開始／結束為準）。
// - 口型同步：以 Web Audio 分析音量，驅動角色嘴巴開合。
// - 所有音樂及音效以 Web Audio 即時合成，屬原創，不使用任何受版權保護的車站聲音。
// - 只有被指定為「音訊輸出」的裝置會發聲（active）；其他裝置只顯示字幕。
export class VoicePlayer {
  constructor({ onLine, onState, onLevel } = {}) {
    this.onLine = onLine || (() => {});
    this.onState = onState || (() => {});
    this.onLevel = onLevel || (() => {});
    this.queue = [];
    this.enabled = false;
    this.active = true;
    this.muted = false;
    this.volume = 0.9;
    this.paused = false;
    this.browserTts = false;
    this.playing = null;
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.ctx = null;
    this.bgm = null;
    this.bgmWanted = false;
    this.lastItem = null;
    this._skip = null;
  }

  get audible() { return this.enabled && this.active && !this.muted; }

  async enable() {
    try {
      this.ctx ??= new (window.AudioContext || window.webkitAudioContext)();
      await this.ctx.resume();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.audio.crossOrigin = 'anonymous';
      // 配音經分析器輸出（口型同步）
      if (!this.mediaSrc) {
        this.mediaSrc = this.ctx.createMediaElementSource(this.audio);
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 512;
        this.mediaSrc.connect(this.analyser);
        this.analyser.connect(this.ctx.destination);
      }
      this.enabled = true;
      this.applyVolume();
      this.tone('unlock');
      if (this.bgmWanted) this.startBgm();
    } catch {
      this.enabled = false;
    }
    this.emit();
    this.pump();
  }

  setActive(on) {
    if (this.active === !!on) return;
    this.active = !!on;
    if (!this.active) { this.stopBgm(); this.audio.pause(); } else if (this.bgmWanted) this.startBgm();
    this.applyVolume();
    this.emit();
  }

  setBgmWanted(on) {
    this.bgmWanted = !!on;
    if (on) this.startBgm(); else this.stopBgm();
  }

  emit() {
    this.onState({ enabled: this.enabled, active: this.active, muted: this.muted, volume: this.volume, paused: this.paused, queue: this.queue.length, playing: this.playing?.eventId || '', browserTts: this.browserTts, bgm: !!this.bgm });
  }

  enqueue(item) {
    // 老師連續觸發多個事件時，只保留最新幾個，避免字幕遠遠落後（最終揭曉永不丟棄）
    while (this.queue.length >= 2) {
      const i = this.queue.findIndex((q) => !/_FINAL_REVEAL$/.test(q.eventId));
      if (i < 0) break;
      this.queue.splice(i, 1);
    }
    this.queue.push(item);
    this.emit();
    this.pump();
  }

  replay() { if (this.lastItem) this.enqueue({ ...this.lastItem, replay: true }); }

  applyVolume() {
    this.audio.volume = this.muted || !this.active ? 0 : this.volume;
    if (this.master) this.master.gain.value = this.muted || !this.active ? 0 : this.volume;
    this.applyBgmGain();
  }

  control(action, value) {
    switch (action) {
      case 'mute': this.muted = true; break;
      case 'unmute': this.muted = false; break;
      case 'volume': this.volume = Math.max(0, Math.min(1, Number(value))); break;
      case 'skip': this._skip?.(); break;
      case 'pause': this.paused = true; this.audio.pause(); window.speechSynthesis?.pause(); break;
      case 'resume': this.paused = false; if (this.playing && this.audio.src && !this.audio.ended) this.audio.play().catch(() => {}); window.speechSynthesis?.resume(); this._resume?.(); break;
      case 'stop': this.queue = []; this._skipAll = true; this._skip?.(); break;
      case 'emergency_mute': this.muted = true; this.queue = []; this._skipAll = true; this._skip?.(); break;
      case 'bgm_on': this.setBgmWanted(true); break;
      case 'bgm_off': this.setBgmWanted(false); break;
      case 'browser_tts_on': this.browserTts = true; break;
      case 'browser_tts_off': this.browserTts = false; break;
      default: break;
    }
    this.applyVolume();
    this.emit();
  }

  async pump() {
    if (this.playing || !this.queue.length) return;
    const item = this.queue.shift();
    this.playing = item;
    this.lastItem = item;
    this._skipAll = false;
    this.emit();
    try {
      if (item.sfx) { this.tone(item.sfx); await this.wait(item.lines?.length ? 900 : 1100); }
      for (const line of item.lines || []) {
        if (this._skipAll) break;
        this.duck(true);
        await this.playLine(line, item);
        this.duck(false);
        await this.wait(220);
      }
      if (item.caption && !this._skipAll) { this.onLine({ speaker: null, speaker_name: '', subtitle_zh_Hant: item.caption, caption: true }, item); await this.wait(3500); }
    } finally {
      this.duck(false);
      this.onLine(null, item);
      this.onLevel(null);
      this.playing = null;
      this.emit();
      setTimeout(() => this.pump(), 200);
    }
  }

  wait(ms) {
    return new Promise((resolve) => {
      let left = ms;
      let t0 = Date.now();
      let timer = setTimeout(done, left);
      const self = this;
      function done() { clearInterval(check); self._skip = null; self._resume = null; resolve(); }
      this._skip = () => { clearTimeout(timer); done(); };
      const check = setInterval(() => {
        if (this.paused && !this._resume) {
          clearTimeout(timer);
          left -= Date.now() - t0;
          this._resume = () => { t0 = Date.now(); this._resume = null; timer = setTimeout(done, Math.max(0, left)); };
        }
      }, 100);
    });
  }

  lipLoop() {
    if (!this.analyser) return;
    const buf = new Uint8Array(this.analyser.fftSize);
    const tick = () => {
      if (!this._lip) return;
      this.analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += (v - 128) ** 2;
      this.onLevel(Math.min(1, Math.sqrt(sum / buf.length) / 30));
      requestAnimationFrame(tick);
    };
    this._lip = true;
    requestAnimationFrame(tick);
  }

  async playLine(line, item) {
    const minMs = (line.estimated_duration || 3) * 1000;
    if (this.audible && line.audio_url) {
      const ok = await new Promise((resolve) => {
        const a = this.audio;
        let settled = false;
        const finish = (v) => { if (settled) return; settled = true; this._lip = false; a.onended = a.onerror = a.onplaying = null; this._skip = null; resolve(v); };
        a.onended = () => finish(true);
        a.onerror = () => finish(false);
        // 字幕在音檔真正開始播放時才出現（同步）
        a.onplaying = () => { this.onLine(line, item, { audio: true }); this.lipLoop(); };
        this._skip = () => { a.pause(); finish(true); };
        a.src = line.audio_url;
        a.volume = this.volume;
        a.play().catch(() => finish(false));
        setTimeout(() => finish(false), minMs + 15000);
      });
      if (ok) return;
    }
    this.onLine(line, item, { audio: false });
    this.onLevel(null);
    // 後備：只在電腦有真正粵語（zh-HK／yue）語音時才使用；絕不以普通話代替
    if (this.audible && this.browserTts && window.speechSynthesis) {
      const voice = speechSynthesis.getVoices().find((v) => /^(zh[-_]HK|yue)/i.test(v.lang));
      if (voice) {
        await new Promise((resolve) => {
          const u = new SpeechSynthesisUtterance(line.subtitle_zh_Hant);
          u.voice = voice; u.lang = voice.lang; u.volume = this.volume;
          let done = false;
          const fin = () => { if (!done) { done = true; this._skip = null; resolve(); } };
          u.onend = fin; u.onerror = fin;
          this._skip = () => { speechSynthesis.cancel(); fin(); };
          speechSynthesis.speak(u);
          setTimeout(fin, minMs + 6000);
        });
        return;
      }
    }
    await this.wait(minMs + 500);
  }

  // ---------------------------------------------------------------- 原創鐵路風格音效
  out() { return this.master || this.ctx?.destination; }

  bell(f, t, dur = 1.2, g = 0.16) {
    const now = this.ctx.currentTime + t;
    for (const [ratio, amp] of [[1, 1], [2.01, 0.35], [3.02, 0.12]]) {
      const o = this.ctx.createOscillator();
      const gg = this.ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f * ratio;
      gg.gain.setValueAtTime(0, now);
      gg.gain.linearRampToValueAtTime(g * amp, now + 0.01);
      gg.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      o.connect(gg).connect(this.out());
      o.start(now); o.stop(now + dur + 0.05);
    }
  }

  beep(f, t, dur, g = 0.07, type = 'square') {
    const now = this.ctx.currentTime + t;
    const o = this.ctx.createOscillator();
    const gg = this.ctx.createGain();
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 2400;
    o.type = type;
    o.frequency.value = f;
    gg.gain.setValueAtTime(0, now);
    gg.gain.linearRampToValueAtTime(g, now + 0.008);
    gg.gain.setValueAtTime(g, now + dur - 0.02);
    gg.gain.linearRampToValueAtTime(0, now + dur);
    o.connect(lp).connect(gg).connect(this.out());
    o.start(now); o.stop(now + dur + 0.02);
  }

  tone(kind) {
    if (!this.audible || !this.ctx) return;
    switch (kind) {
      case 'unlock': this.bell(784, 0, 0.6, 0.1); this.bell(1047, 0.12, 0.8, 0.1); break;
      case 'departure': // 月台開出提示：三音鐘聲 + 關門嗶聲
        this.bell(880, 0, 1.0); this.bell(740, 0.28, 1.0); this.bell(587, 0.56, 1.4);
        for (let i = 0; i < 4; i++) this.beep(1046, 1.5 + i * 0.22, 0.12, 0.05);
        break;
      case 'arrival': case 'success': case 'task_clear': // 到站「叮咚」
        this.bell(1319, 0, 0.9, 0.12); this.bell(1047, 0.22, 1.2, 0.12); break;
      case 'level_clear': case 'unlock_level':
        [784, 988, 1175, 1568].forEach((f, i) => this.bell(f, i * 0.12, 1.4, 0.11)); break;
      case 'gentle': case 'wrong':
        this.beep(392, 0, 0.16, 0.06, 'triangle'); this.beep(330, 0.18, 0.24, 0.06, 'triangle'); break;
      case 'warning':
        this.bell(988, 0, 0.7, 0.12); this.bell(784, 0.35, 0.9, 0.12); break;
      case 'tick': this.beep(1175, 0, 0.09, 0.05); break;
      case 'time_up': this.beep(880, 0, 0.35, 0.08); this.beep(660, 0.4, 0.6, 0.08); break;
      case 'reveal':
        [523, 659, 784, 1047].forEach((f) => this.bell(f, 0, 2.4, 0.08));
        [1319, 1568].forEach((f, i) => this.bell(f, 0.6 + i * 0.2, 1.6, 0.08));
        break;
      default: break;
    }
  }

  // ---------------------------------------------------------------- 背景音樂（原創，鐵路節奏）
  startBgm() {
    if (!this.ctx || !this.enabled || !this.active || this.bgm) return;
    const bus = this.ctx.createGain();
    bus.gain.value = 0;
    bus.connect(this.ctx.destination);
    const bpm = 108;
    const beat = 60 / bpm;
    const prog = [[220, 277.18, 329.63], [196, 246.94, 293.66], [174.61, 220, 261.63], [196, 246.94, 329.63]]; // A F#? 柔和進行
    const melody = [659, 0, 587, 659, 740, 0, 659, 587, 523, 0, 587, 659, 587, 0, 494, 0];
    let step = 0;
    let next = this.ctx.currentTime + 0.1;
    const noiseBuf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.05, this.ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const note = (f, t, dur, g, type = 'triangle') => {
      const o = this.ctx.createOscillator();
      const gg = this.ctx.createGain();
      o.type = type; o.frequency.value = f;
      gg.gain.setValueAtTime(0, t);
      gg.gain.linearRampToValueAtTime(g, t + 0.02);
      gg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(gg).connect(bus);
      o.start(t); o.stop(t + dur + 0.05);
    };
    const clack = (t, g) => {
      const s = this.ctx.createBufferSource();
      s.buffer = noiseBuf;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 3;
      const gg = this.ctx.createGain(); gg.gain.value = g;
      s.connect(bp).connect(gg).connect(bus);
      s.start(t);
    };
    const schedule = () => {
      while (next < this.ctx.currentTime + 0.4) {
        const bar = Math.floor(step / 8) % prog.length;
        const chord = prog[bar];
        const eighth = step % 8;
        if (eighth === 0) chord.forEach((f) => note(f, next, beat * 3.6, 0.05, 'sine'));
        if (eighth % 2 === 0) note(chord[0] / 2, next, beat * 0.8, 0.12, 'triangle');
        // 「咔嚓咔嚓」路軌節奏
        if (eighth === 0 || eighth === 1 || eighth === 4 || eighth === 5) clack(next, eighth % 4 === 0 ? 0.18 : 0.1);
        const m = melody[step % melody.length];
        if (m && Math.floor(step / 16) % 2 === 1) note(m, next, beat * 0.45, 0.045, 'square');
        next += beat / 2;
        step++;
      }
    };
    schedule();
    const timer = setInterval(schedule, 120);
    this.bgm = { bus, timer, ducked: false };
    this.applyBgmGain();
    this.emit();
  }

  stopBgm() {
    if (!this.bgm) return;
    clearInterval(this.bgm.timer);
    const { bus } = this.bgm;
    bus.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.3);
    setTimeout(() => bus.disconnect(), 400);
    this.bgm = null;
    this.emit();
  }

  duck(on) { if (this.bgm) { this.bgm.ducked = on; this.applyBgmGain(); } }

  applyBgmGain() {
    if (!this.bgm || !this.ctx) return;
    const target = this.muted || !this.active ? 0 : (this.bgm.ducked ? 0.12 : 0.55) * this.volume;
    this.bgm.bus.gain.cancelScheduledValues(this.ctx.currentTime);
    this.bgm.bus.gain.linearRampToValueAtTime(target, this.ctx.currentTime + 0.35);
  }
}
