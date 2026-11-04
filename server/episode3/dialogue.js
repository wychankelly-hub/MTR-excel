// 第三集《暴躁阿叔》（最終回）廣東話配音／字幕事件。格式與第一集相同（見 episode1/dialogue.js）。
// 故事：獎座找到了，但車站紀錄仍然亂七八糟。暴躁阿叔投訴連連，被懷疑改過紀錄；
// 學生用排序、篩選、多工作表、圖表、樞紐分析表及假設分析一步步追查——證據指向站長室。
// 真相：肥站長午飯時沒有鎖上電腦，貓咪咪在鍵盤上走來走去，改了數據。阿叔是清白的；
// 火箭仔有部分公式錯誤確實是他自己的，要分開處理。結尾帶出數據完整性、保護工作表、存取控制及核對資料。
// 第三個欄位（如有）是語音合成用的輸入；字幕仍顯示原句。
import { E, buildAudioEvents } from '../episode1/dialogue.js';

const RAW_EVENTS = [
  E('E3_INTRO', 'episode_start', 0, 'none', [
    ['grumpy', '你哋個車站啲紀錄亂晒龍！我投訴咗成十次啦！'],
    ['fatmaster', '阿叔，你成日嚟投訴，啲紀錄會唔會係你改㗎？', '阿叔，你成日嚟投訴，啲紀錄會唔會係你改架？'],
    ['grumpy', '吓？我連你部電腦點開都唔知呀！'],
    ['chanding', '唔好亂估。今次我哋用數據，由頭查到尾。'],
  ], { sfx: 'departure' }),
  E('E3_L1_OPEN', 'level_open', 1, 'none', [
    ['bat', '一百二十宗投訴，邊宗最緊要？'],
    ['chanding', '排序同篩選可以幫你搵出重點，不過記住整行資料要一齊移動。'],
  ], { sfx: 'departure' }),
  E('E3_L1_FIRST_CLEAR', 'first_clear', 1, 'none', [['bat', '有隊伍已經整理好阿叔嘅投訴！']], { sfx: 'level_clear' }),
  E('E3_L1_CLOSE', 'level_close', 1, 'partial', [
    ['grumpy', '睇到未？我投訴嘅全部都係數據錯誤！'],
    ['chanding', '佢唔係搞事，佢係最早發現問題嘅人。'],
  ], { sfx: 'time_up' }),
  E('E3_L2_OPEN', 'level_open', 2, 'none', [
    ['fatmaster', '時間表同行車紀錄點解對唔上？'],
    ['rocket', '我記得有幾班車明明開咗，但係紀錄冇咗！'],
    ['chanding', '兩張工作表要互相參照，資料一改，結果就會自動更新。'],
  ], { sfx: 'departure' }),
  E('E3_L2_FIRST_CLEAR', 'first_clear', 2, 'none', [], { sfx: 'level_clear' }),
  E('E3_L2_CLOSE', 'level_close', 2, 'partial', [['bat', '消失咗嘅紀錄，全部都係午飯時間！']], { sfx: 'time_up' }),
  E('E3_L3_OPEN', 'level_open', 3, 'none', [
    ['grumpy', '今日話有成八千人一個鐘頭入閘？你呃鬼咩！'],
    ['chanding', '畫個圖出嚟，數據有冇古怪，一眼就睇到。'],
  ], { sfx: 'departure' }),
  E('E3_L3_FIRST_CLEAR', 'first_clear', 3, 'none', [], { sfx: 'level_clear' }),
  E('E3_L3_CLOSE', 'level_close', 3, 'partial', [['chanding', '一個時段高到離譜，另一個時段又差唔多係零，兩個都喺午飯時間。']], { sfx: 'time_up' }),
  E('E3_L4_OPEN', 'level_open', 4, 'none', [
    ['fatmaster', '站長室部電腦都有紀錄？唔好睇我呀！'],
    ['bat', '用樞紐分析表，幾百條紀錄都可以即刻分類統計。'],
  ], { sfx: 'departure' }),
  E('E3_L4_FIRST_CLEAR', 'first_clear', 4, 'none', [], { sfx: 'level_clear' }),
  E('E3_L4_CLOSE', 'level_close', 4, 'partial', [
    ['chanding', '大量修改都係嚟自站長室部電腦，而且係用站長個帳戶。'],
    ['fatmaster', '冇可能！嗰陣我出咗去食飯㗎！', '冇可能！嗰陣我出咗去食飯架！'],
  ], { sfx: 'time_up' }),
  E('E3_L5_OPEN', 'level_open', 5, 'none', [
    ['chanding', '如果你出去食飯，部電腦幾耐先會自動鎖機？'],
    ['fatmaster', '呃……我都唔記得有冇設定過……'],
    ['bat', '改吓假設，睇吓邊個結論先有數據支持。'],
  ], { sfx: 'departure' }),
  E('E3_L5_FIRST_CLEAR', 'first_clear', 5, 'none', [['bat', '有隊伍已經搵到真相，等全班完成先一齊揭曉！']], { sfx: 'level_clear' }),
  E('E3_FINAL_REVEAL', 'final_reveal', 5, 'final', [
    ['cat', '喵～'],
    ['chanding', '真相大白：站長出去食飯冇鎖機，咪咪喺鍵盤上面行嚟行去，打咗成堆亂碼。'],
    ['fatmaster', '咪咪！原來係你！'],
    ['grumpy', '我就話唔關我事啦！不過你哋肯認真查清楚，我收貨。'],
    ['rocket', '咁……我嗰啲漏咗 $ 號嘅公式，就真係我自己寫錯嘅。', '咁……我嗰啲漏咗錢號嘅公式，就真係我自己寫錯嘅。'],
    ['bat', '記住：離開座位要鎖機，重要嘅工作表要保護，唔同人要有唔同權限。'],
    ['chanding', '最重要係：見到數據，要先核對，先好落結論。'],
    ['fatmaster', '今年最佳站長獎，就頒畀全班數據偵探！'],
  ], { sfx: 'reveal', caption: '全劇完：多謝各位數據偵探！' }),
  E('E3_TIMER_WARNING', 'timer_warning', null, 'none', [['grumpy', '仲有一分鐘呀！快啲檢查清楚啦！']], { sfx: 'warning' }),
];

export const AUDIO_EVENTS = buildAudioEvents(RAW_EVENTS, 'E3');
export const AUDIO_EVENT_BY_ID = Object.fromEntries(AUDIO_EVENTS.map((e) => [e.id, e]));
export const ALL_LINES = AUDIO_EVENTS.flatMap((e) => e.lines);

// 每關的故事線索（投影端在該關截止後顯示）
export const STORY_CLUES = {
  1: '阿叔的投訴集中在「數據錯誤」（DATA）——他是最早發現問題的人。',
  2: '在行車紀錄中消失的列車，全部集中在午飯時間。',
  3: '今日的人流圖有兩個異常：一個高得離譜、一個接近零，都在午飯時間。',
  4: '大量修改來自站長室的電腦（FSM-PC），用的是站長的帳戶。',
  5: '電腦沒有鎖上，貓咪咪踩過鍵盤——阿叔是清白的；火箭仔的公式錯誤是另一回事。',
};
