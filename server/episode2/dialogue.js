// 第二集《疑犯火箭仔》廣東話配音／字幕事件。格式與第一集相同（見 episode1/dialogue.js）。
// 故事：肥站長的「最佳站長獎座」午飯時間喺辦公室消失，門禁紀錄顯示火箭仔張員工證開過門。
// 學生用數據調查，最後發現：八仔借咗火箭仔張證，將獎座拎咗去失物認領處抹乾淨——火箭仔係清白嘅。
// 第三個欄位（如有）是語音合成用的輸入；字幕仍顯示原句。
import { E, buildAudioEvents } from '../episode1/dialogue.js';

const RAW_EVENTS = [
  E('E2_INTRO', 'episode_start', 0, 'none', [
    ['fatmaster', '大鑊！我個最佳站長獎座唔見咗！'],
    ['fatmaster', '門禁紀錄話，午飯時間有人用火箭仔張員工證開過辦公室門！'],
    ['rocket', '唔係我呀！我發誓我冇掂過！'],
    ['chanding', '唔好急住捉人。我哋用數據，一步一步查清楚。'],
  ], { sfx: 'departure' }),
  E('E2_L1_OPEN', 'level_open', 1, 'none', [
    ['bat', '門禁紀錄全部黐埋一齊，地點、時間、員工證號碼都撈埋一嚿。'],
    ['chanding', '用 FIND 搵出 @ 同井字號嘅位置，就可以逐段拆開。', '用 F I N D 搵出 A T 符號同井字號嘅位置，就可以逐段拆開。'],
  ], { sfx: 'departure' }),
  E('E2_L1_FIRST_CLEAR', 'first_clear', 1, 'none', [['fatmaster', '有隊伍拆開咗門禁紀錄！做得好！']], { sfx: 'level_clear' }),
  E('E2_L1_CLOSE', 'level_close', 1, 'partial', [
    ['fatmaster', '睇吓！十二點三十一分，火箭仔張證開過辦公室門！'],
    ['rocket', '張證係我嘅，但係嗰陣我唔喺度呀！'],
  ], { sfx: 'time_up' }),
  E('E2_L2_OPEN', 'level_open', 2, 'none', [
    ['uncle', '喂喂喂！咁多號碼，邊個打邊個呀？'],
    ['bat', '用員工名冊對一對，就知道每張證屬於邊個，邊個係訪客。'],
  ], { sfx: 'departure' }),
  E('E2_L2_FIRST_CLEAR', 'first_clear', 2, 'none', [], { sfx: 'level_clear' }),
  E('E2_L2_CLOSE', 'level_close', 2, 'none', [['chanding', '查表嘅時候，名冊範圍一定要固定，唔係複製落去就會漏人。']], { sfx: 'time_up' }),
  E('E2_L3_OPEN', 'level_open', 3, 'none', [
    ['fatmaster', '會唔會有人偷獎座拎去賣？快啲點吓個現金箱！'],
    ['chanding', '港幣最細係一毫，記得四捨五入至一個小數位。'],
  ], { sfx: 'departure' }),
  E('E2_L3_FIRST_CLEAR', 'first_clear', 3, 'none', [], { sfx: 'level_clear' }),
  E('E2_L3_CLOSE', 'level_close', 3, 'partial', [['bat', '現金一毫子都冇少，獎座唔係俾人拎去換錢。']], { sfx: 'time_up' }),
  E('E2_L4_OPEN', 'level_open', 4, 'none', [
    ['rocket', '十二點三十一分我喺月台幫緊乘客，好遠㗎！', '十二點三十一分我喺月台幫緊乘客，好遠架！'],
    ['chanding', '計吓每個人同辦公室嘅距離，再排一排名次。'],
  ], { sfx: 'departure' }),
  E('E2_L4_FIRST_CLEAR', 'first_clear', 4, 'none', [], { sfx: 'level_clear' }),
  E('E2_L4_CLOSE', 'level_close', 4, 'partial', [
    ['chanding', '數據顯示，嗰陣火箭仔係離辦公室最遠嘅人。'],
    ['rocket', '我都話唔係我啦！'],
    ['fatmaster', '咁……用佢張證開門嘅，究竟係邊個？'],
  ], { sfx: 'time_up' }),
  E('E2_L5_OPEN', 'level_open', 5, 'none', [
    ['fatmaster', '我要搜晒全部儲物櫃！'],
    ['bat', '隨機抽查先公平，唔好淨係搜火箭仔個櫃。'],
  ], { sfx: 'departure' }),
  E('E2_L5_FIRST_CLEAR', 'first_clear', 5, 'none', [['bat', '有隊伍已經排好抽查次序，等全班完成先一齊揭曉！']], { sfx: 'level_clear' }),
  E('E2_FINAL_REVEAL', 'final_reveal', 5, 'final', [
    ['uncle', '喂喂！失物認領處搵到一個好閃嘅獎座呀！'],
    ['bat', '對唔住呀……我嗰日唔記得帶證，借咗火箭仔張證。'],
    ['bat', '我見個獎座好多塵，就拎咗去失物認領處抹乾淨，之後唔記得拎返。'],
    ['chanding', '真相大白：火箭仔係清白嘅。'],
    ['fatmaster', '火箭仔，對唔住！下次一定先查清楚數據，唔好亂咁冤枉人。'],
    ['rocket', '哈！我就話唔係我啦！'],
  ], { sfx: 'reveal', caption: '第三集預告：最佳站長大決選' }),
  E('E2_TIMER_WARNING', 'timer_warning', null, 'none', [['fatmaster', '仲有一分鐘！檢查清楚啲線索先好提交！']], { sfx: 'warning' }),
];

export const AUDIO_EVENTS = buildAudioEvents(RAW_EVENTS, 'E2');
export const AUDIO_EVENT_BY_ID = Object.fromEntries(AUDIO_EVENTS.map((e) => [e.id, e]));
export const ALL_LINES = AUDIO_EVENTS.flatMap((e) => e.lines);

// 每關的故事線索（投影端在該關截止後顯示）
export const STORY_CLUES = {
  1: '12:31，有人用火箭仔的員工證（R07）開過辦公室門。',
  2: '員工證 R07 屬於火箭仔；當日亦有訪客出入。',
  3: '現金一分不差：獎座不是被拿去換錢。',
  4: '12:31 時，火箭仔是離辦公室最遠的人——他有不在場證明。',
  5: '獎座在失物認領處找到：八仔借了火箭仔的證。火箭仔是清白的！',
};
