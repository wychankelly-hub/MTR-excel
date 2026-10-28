// 廣東話配音／字幕事件（§9）。每句 Dialogue Asset 保存 spec §9.3 要求的欄位。
// 音檔放在 public/audio/<line_id>.mp3（或 .wav/.ogg/.m4a）；缺失時只顯示字幕，競賽不受影響。

export const SPEAKERS = {
  chanding: { name: '陳定', tone: '平穩、清晰、節奏較慢', color: '#2f6fb3' },
  fatmaster: { name: '肥站長', tone: '誇張緊張、搞笑但不尖銳', color: '#c0392b' },
  rocket: { name: '火箭仔', tone: '語速偏快、自信、偶爾尷尬', color: '#e67e22' },
  bat: { name: '八仔', tone: '活潑、溫和、發音清楚', color: '#16a085' },
  uncle: { name: '喂喂叔', tone: '大聲、熱情', color: '#8e44ad' },
  passenger: { name: '乘客甲', tone: '不滿但有禮', color: '#7f8c8d' },
};

// trigger_policy：
//   episode_start  老師按「開始 Episode」
//   level_open     該關開始
//   first_clear    該關第一隊完成（不含答案）
//   level_close    該關截止（所有隊伍同步）
//   final_reveal   L5 截止後（Spoiler Policy：L5 未完結前一律拒絕播放）
//   timer_warning  回合剩 60 秒
// spoiler_level：none / partial（只有部分線索）/ final（揭曉 LUNCH）
const E = (id, trigger, level, spoiler, lines, extra = {}) => ({ id, trigger, level, spoiler, lines, ...extra });

const RAW_EVENTS = [
  E('E1_INTRO', 'episode_start', 0, 'none', [
    ['fatmaster', '各位實習生，今日邊條綫做得最好，就有機會攞到最佳站長獎！'],
    ['rocket', 'Excel？小意思啦，我一定第一！', '試算表？小意思啦，我一定第一！'],
    ['chanding', '做得快係好事，不過計啱最重要。'],
  ], { sfx: 'departure' }),
  E('L1_OPEN', 'level_open', 1, 'none', [
    ['rocket', '搞掂！我三秒就整好成張車費表！'],
    ['fatmaster', '弊啦！點解有啲乘客扣錯錢？我個菠蘿包都嚇跌咗！'],
    ['chanding', '先檢查公式，再睇吓複製落去之後邊啲參照變咗。'],
  ], { sfx: 'departure' }),
  E('L1_FIRST_CLEAR', 'first_clear', 1, 'none', [['fatmaster', '車費系統開始恢復啦！做得好！']], { sfx: 'level_clear' }),
  E('L1_CLOSE', 'level_close', 1, 'none', [['bat', '複製公式時，要分清邊啲參照會變，邊啲一定要固定呀！']], { sfx: 'time_up' }),
  E('L2_OPEN', 'level_open', 2, 'none', [
    ['fatmaster', '好多人呀！究竟邊個鐘頭最逼？'],
    ['uncle', '我打電話畀全家人，話呢度逼過年宵呀！'],
    ['chanding', '用數據搵答案，唔使靠估。'],
  ], { sfx: 'departure' }),
  E('L2_FIRST_CLEAR', 'first_clear', 2, 'none', [], { sfx: 'level_clear' }),
  E('L2_CLOSE', 'level_close', 2, 'none', [['chanding', '最高人流唔可以靠估，要先計好每個時段嘅總人流。']], { sfx: 'time_up' }),
  E('L3_OPEN', 'level_open', 3, 'none', [
    ['passenger', '點解佢可以行優先通道，我唔得？'],
    ['rocket', '我用 IF 一秒幫你決定啦！', '我用 I F 一秒幫你決定啦！'],
    ['bat', '先睇清楚「或者」同「而且」，唔好又搞錯。'],
  ], { sfx: 'departure' }),
  E('L3_FIRST_CLEAR', 'first_clear', 3, 'none', [], { sfx: 'level_clear' }),
  E('L3_CLOSE', 'level_close', 3, 'none', [['bat', '記住，「或者」通常要諗 OR，「而且」通常要諗 AND。', '記住，或者通常要諗 O R，而且通常要諗 A N D。']], { sfx: 'time_up' }),
  E('L4_OPEN', 'level_open', 4, 'none', [
    ['fatmaster', '成個失物房都塞爆啦！仲有人執到個梳化咕𠱸？', '成個失物房都塞爆啦！仲有人執到個梳化咕臣？'],
    ['rocket', '我計好晒！吓……點解同尋日唔同？'],
    ['chanding', '用條件函數逐項核對，唔好靠人手數。'],
  ], { sfx: 'departure' }),
  E('L4_FIRST_CLEAR', 'first_clear', 4, 'none', [], { sfx: 'level_clear' }),
  E('L4_CLOSE', 'level_close', 4, 'partial', [['fatmaster', '咦？點解啲奇怪紀錄成日喺午飯附近出現？']], { sfx: 'time_up' }),
  E('L5_OPEN', 'level_open', 5, 'none', [
    ['fatmaster', '車站廣播全部變晒亂碼！係咪有人喺度搞鬼？'],
    ['rocket', '唔關我事呀！我今日冇掂過廣播系統！'],
    ['bat', '每條代碼都有一個英文字母，搵齊五個就有線索啦。'],
  ], { sfx: 'departure' }),
  E('L5_FIRST_CLEAR', 'first_clear', 5, 'none', [['bat', '有隊伍已經破解咗廣播密碼，等全班完成先一齊揭曉！']], { sfx: 'level_clear' }),
  E('E1_FINAL_REVEAL', 'final_reveal', 5, 'final', [
    ['chanding', '五個字母連埋，原來係 LUNCH。', '五個字母連埋，原來係 L U N C H。'],
    ['chanding', '點解啲異常次次都係午飯時間？'],
    ['rocket', '午飯時間？唔係又賴我呀嘛！'],
    ['rocket', '……你哋唔係懷疑我呀嘛？'],
    ['fatmaster', '下次一定要查清楚！唔好亂咁冤枉人！'],
  ], { sfx: 'reveal', caption: '第二集預告：疑犯火箭仔' }),
  // spec §9.2「站長短廣播＋柔和提醒音」：此句為補充的短廣播，須經老師試聽批准
  E('TIMER_WARNING', 'timer_warning', null, 'none', [['fatmaster', '仲有一分鐘！大家檢查清楚先好提交！']], { sfx: 'warning' }),
  E('SUBMIT_CORRECT', 'team_only', null, 'none', [], { sfx: 'success', teamOnly: true }),
  E('SUBMIT_WRONG', 'team_only', null, 'none', [], { sfx: 'gentle', teamOnly: true }),
];

function estimateSeconds(text) {
  // 粵語約每秒 4.5 字；限制於 2–5 秒（以實際音檔長度為準）
  const n = [...text.replace(/[，。！？、「」…\s]/g, '')].length;
  return Math.max(2, Math.min(5, Math.round((n / 4.5) * 10) / 10));
}

export const AUDIO_EVENTS = RAW_EVENTS.map((ev) => ({
  ...ev,
  public: !ev.teamOnly,
  lines: ev.lines.map(([speaker, text, ttsText], i) => {
    const lineId = `${ev.id}_${String(i + 1).padStart(2, '0')}`;
    return {
      event_id: ev.id,
      line_id: lineId,
      speaker,
      speaker_name: SPEAKERS[speaker].name,
      spoken_cantonese_text: text,
      // 語音合成用的輸入（英文字母逐個讀出、罕用字改用同音字）；字幕仍顯示原句
      tts_input: ttsText || text,
      subtitle_zh_Hant: text,
      audio_url: `/audio/${lineId}.mp3`,
      estimated_duration: estimateSeconds(text),
      trigger_policy: ev.trigger,
      spoiler_level: ev.spoiler,
      asset_status: 'missing', // 伺服器啟動時會按 public/audio 實際檔案更新
    };
  }),
}));

export const AUDIO_EVENT_BY_ID = Object.fromEntries(AUDIO_EVENTS.map((e) => [e.id, e]));
export const ALL_LINES = AUDIO_EVENTS.flatMap((e) => e.lines);

// 每關的故事線索（投影端在該關截止後顯示；L1–L4 只暗示時段異常）
export const STORY_CLUES = {
  1: '車費紀錄之中，有幾筆異常扣款發生在同一段時間附近……',
  2: '人流數據顯示，某段時間的系統紀錄特別混亂。',
  3: '優先通道的錯誤判斷，似乎集中在中午前後出現。',
  4: '異常記錄集中於午飯附近時段。',
  5: '五個字母連埋：LUNCH。',
};
