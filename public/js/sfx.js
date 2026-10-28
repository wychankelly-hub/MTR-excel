// 學生裝置的遊戲音效（與老師／投影的劇情聲音完全獨立）。
// - 只播放本隊相關的音效（伺服器只把該隊事件送到該隊裝置）；新一關解鎖則全班都會聽到。
// - 音效短、柔和、音量偏低；學生可以靜音及調校音量（只影響本機，記在瀏覽器）。
// - 瀏覽器自動播放限制：第一次在頁面任何位置點擊／按鍵即自動啟用（只需一次）。
// - 去重：同一事件（id）只播放一次；重新整理或重新連線不會重播。
// 全部聲音以 Web Audio 即時合成，屬原創。
const LS = 'ty.sfx';
const SEEN = 'ty.sfx.seen';

function readJSON(store, key, dflt) {
  try { return JSON.parse(store.getItem(key)) ?? dflt; } catch { return dflt; }
}

export class GameSfx {
  constructor({ onChange } = {}) {
    const saved = readJSON(localStorage, LS, {});
    this.muted = !!saved.muted;
    this.volume = typeof saved.volume === 'number' ? saved.volume : 0.5;
    this.ctx = null;
    this.onChange = onChange || (() => {});
    this.seen = new Set(readJSON(sessionStorage, SEEN, []));
    this.loadedAt = Date.now();
    this.log = []; // 測試／除錯用
    const unlock = () => this.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
  }

  get ready() { return !!this.ctx && this.ctx.state === 'running'; }

  async unlock() {
    try {
      this.ctx ??= new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state !== 'running') await this.ctx.resume();
      if (!this.master) {
        this.master = this.ctx.createGain();
        const comp = this.ctx.createDynamicsCompressor(); // 防止過大聲
        comp.threshold.value = -18;
        this.master.connect(comp).connect(this.ctx.destination);
      }
      this.applyVolume();
    } catch { /* 瀏覽器不支援 */ }
    this.onChange(this.state());
  }

  state() { return { ready: this.ready, muted: this.muted, volume: this.volume }; }

  persist() {
    try { localStorage.setItem(LS, JSON.stringify({ muted: this.muted, volume: this.volume })); } catch { /* 私密模式 */ }
    this.onChange(this.state());
  }

  setMuted(m) { this.muted = !!m; this.applyVolume(); this.persist(); }
  setVolume(v) { this.volume = Math.max(0, Math.min(1, Number(v))); this.applyVolume(); this.persist(); }
  applyVolume() { if (this.master) this.master.gain.value = this.muted ? 0 : this.volume * 0.6; }

  /** 處理伺服器事件：{ kind, id, at } */
  handle(ev) {
    if (!ev?.id || this.seen.has(ev.id)) return false;
    this.seen.add(ev.id);
    try { sessionStorage.setItem(SEEN, JSON.stringify([...this.seen].slice(-200))); } catch { /* 私密模式 */ }
    this.play(ev.kind);
    return true;
  }

  play(kind) {
    this.log.push({ kind, at: Date.now(), audible: this.ready && !this.muted });
    if (!this.ready || this.muted) return;
    const SOUNDS = {
      correct: () => { this.note(880, 0, 0.12, 'sine', 0.5); this.note(1318.5, 0.09, 0.22, 'sine', 0.45); },
      wrong: () => { this.note(330, 0, 0.14, 'triangle', 0.35); this.note(262, 0.13, 0.22, 'triangle', 0.3); },
      mission: () => { [784, 988, 1175, 1568].forEach((f, i) => this.note(f, i * 0.08, 0.28, 'sine', 0.4)); this.note(1568, 0.34, 0.5, 'triangle', 0.2); },
      unlock: () => { this.sweep(300, 900, 0, 0.18, 0.25); this.note(1175, 0.18, 0.3, 'sine', 0.4); },
      bonus: () => { [1319, 1568, 2093, 2637].forEach((f, i) => this.note(f, i * 0.05, 0.14, 'square', 0.12)); this.note(2093, 0.22, 0.35, 'sine', 0.3); },
      hint: () => { this.note(1046.5, 0, 0.09, 'sine', 0.3); this.note(1568, 0.08, 0.12, 'sine', 0.22); },
      notice: () => { this.note(660, 0, 0.1, 'sine', 0.25); },
    };
    (SOUNDS[kind] || SOUNDS.notice)();
  }

  note(f, t, dur, type = 'sine', g = 0.4) {
    const now = this.ctx.currentTime + t;
    const o = this.ctx.createOscillator();
    const gg = this.ctx.createGain();
    o.type = type;
    o.frequency.value = f;
    gg.gain.setValueAtTime(0, now);
    gg.gain.linearRampToValueAtTime(g, now + 0.01);
    gg.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(gg).connect(this.master);
    o.start(now);
    o.stop(now + dur + 0.05);
  }

  sweep(f1, f2, t, dur, g) {
    const now = this.ctx.currentTime + t;
    const o = this.ctx.createOscillator();
    const gg = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(f1, now);
    o.frequency.exponentialRampToValueAtTime(f2, now + dur);
    gg.gain.setValueAtTime(0, now);
    gg.gain.linearRampToValueAtTime(g, now + 0.02);
    gg.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(gg).connect(this.master);
    o.start(now);
    o.stop(now + dur + 0.05);
  }
}
