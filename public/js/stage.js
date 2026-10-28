// 劇情舞台（投影端及老師控制台共用）：角色、對白框、口型同步；
// 以及播放裝置的音訊邏輯（只有被指定的輸出裝置發聲，其他裝置只顯示字幕）。
import { h, clear, serverClock } from './common.js';
import { Character, CHARACTERS } from './characters.js';
import { VoicePlayer } from './audio.js';

const MAIN = ['fatmaster', 'chanding', 'rocket', 'bat'];

export class StoryStage {
  constructor({ castEl, bubbleEl, size = 150, idleText = '（劇情對白會在這裏顯示）' }) {
    this.castEl = castEl;
    this.bubbleEl = bubbleEl;
    this.idleText = idleText;
    this.chars = {};
    for (const id of [...MAIN, 'uncle', 'passenger']) {
      const c = new Character(id, { size, showName: true });
      if (!MAIN.includes(id)) c.el.hidden = true;
      this.chars[id] = c;
      castEl?.append(c.el);
    }
    this.speaking = null;
    this.showLine(null);
  }

  showLine(line) {
    for (const c of Object.values(this.chars)) { c.setTalking(false); c.setMouth(null); c.el.classList.remove('speaking', 'dim'); }
    // 客串角色只在說話時出現
    for (const id of ['uncle', 'passenger']) this.chars[id].el.hidden = !(line && line.speaker === id);
    this.speaking = line && this.chars[line.speaker] ? this.chars[line.speaker] : null;
    if (this.speaking) {
      this.speaking.el.classList.add('speaking');
      this.speaking.setTalking(true);
      for (const c of Object.values(this.chars)) if (c !== this.speaking) c.el.classList.add('dim');
    }
    if (!this.bubbleEl) return;
    if (!line) { clear(this.bubbleEl, h('div.bubble', h('div.idle', this.idleText))); return; }
    const color = CHARACTERS[line.speaker]?.color || 'var(--accent)';
    clear(this.bubbleEl, h(`div.bubble${line.caption ? '.caption' : ''}`, { style: { '--who': color } },
      line.speaker_name ? h('span.bubble-name', line.speaker_name) : null,
      h('div.bubble-text', line.caption ? line.subtitle_zh_Hant : `「${line.subtitle_zh_Hant}」`)));
  }

  /** 口型同步：音量 0–1；null = 回復自動開合 */
  mouth(level) { this.speaking?.setMouth(level); }

  react(id, kind) { this.chars[id]?.react(kind); }

  celebrate() { for (const id of MAIN) this.chars[id].react('happy', 1800); }
}

/** 每個投影視窗的裝置識別碼（同一視窗重新整理後保持不變） */
export function projectorDeviceId() {
  let id = null;
  try { id = sessionStorage.getItem('ty.projectorDevice'); } catch { /* 私密模式 */ }
  if (!id) {
    id = `pj${Math.random().toString(36).slice(2, 12)}`;
    try { sessionStorage.setItem('ty.projectorDevice', id); } catch { /* 私密模式 */ }
  }
  return id;
}

/**
 * 劇情播放裝置（只用於投影畫面）：處理 audio 事件、背景音樂、倒數嗶聲、狀態回報。
 * 只有伺服器指定的投影畫面（designated）會發聲；其他投影畫面及老師控制台只顯示字幕。
 * role：'projector'（可發聲）| 'teacher'（只顯示字幕，永不發聲）
 */
export function createAudioDevice({ role, stage, report, onSfx, onState }) {
  const deviceId = role === 'projector' ? projectorDeviceId() : null;
  let isOutput = false;
  let designated = null;
  let lastSeq = null;
  let lastTick = null;
  let claim = false;
  const player = new VoicePlayer({
    onLine: (line) => stage?.showLine(line),
    onLevel: (lv) => stage?.mouth(lv),
    onState: (s) => { onState?.({ ...s, designated, deviceId }, isOutput); sendReport(); },
  });
  player.active = false;
  let reportTimer = null;
  const sendReport = () => {
    if (role !== 'projector') return;
    clearTimeout(reportTimer);
    reportTimer = setTimeout(async () => {
      const body = { deviceId, audioEnabled: player.enabled, muted: player.muted, volume: player.volume, playing: player.playing?.eventId || '', queue: player.queue.length, claim };
      claim = false;
      try { await report?.(body); } catch { /* 網絡問題，下次再報 */ }
    }, 200);
  };
  if (role === 'projector') setInterval(sendReport, 15000);

  return {
    player,
    deviceId,
    get isOutput() { return isOutput; },
    get designated() { return designated; },
    async enable() { await player.enable(); claim = !designated; sendReport(); },
    /** 由這個投影畫面接手播放 */
    claim() { claim = true; sendReport(); },
    onPublicState(st) {
      designated = st.audio?.designated || null;
      isOutput = role === 'projector' && !!deviceId && designated === deviceId;
      player.setActive(isOutput);
      if (!!st.audio?.bgm !== player.bgmWanted) player.setBgmWanted(!!st.audio?.bgm);
      if (lastSeq === null) lastSeq = st.audioSeq; // 只播放開啟後的新事件
      onState?.({ enabled: player.enabled, muted: player.muted, designated, deviceId }, isOutput);
    },
    onAudio(msg) {
      if (msg.type === 'play') {
        if (lastSeq !== null && msg.seq <= lastSeq) return;
        lastSeq = msg.seq;
        player.enqueue(msg);
      } else if (msg.type === 'control') {
        if (msg.action === 'bgm_on' || msg.action === 'bgm_off') return; // 由狀態控制
        if (msg.action === 'replay') player.replay();
        else player.control(msg.action, msg.value);
      } else if (msg.type === 'sfx') {
        // 個別隊伍答對只在投影顯示文字（音效在該隊學生裝置播放）；完成一關則全班聽到鐘聲
        if (msg.kind === 'level_clear') player.tone('level_clear');
        onSfx?.(msg);
      }
    },
    /** 計時：最後 10 秒每秒嗶一聲（關門提示音風格），只在劇情播放裝置 */
    onTimer(remainMs, running) {
      if (!running) { lastTick = null; return; }
      const s = Math.ceil(remainMs / 1000);
      if (s <= 10 && s >= 1 && s !== lastTick) { lastTick = s; player.tone('tick'); }
    },
  };
}

export function remainingOf(level, state) {
  return level.running ? level.remainingMs - (serverClock.now() - state.serverNow) : level.remainingMs;
}
