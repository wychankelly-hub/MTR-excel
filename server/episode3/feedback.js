// 第三集：錯誤代碼 → 繁體中文 Feedback 及概念分類（教師報告用）。對學生只提示概念，不直接給出標準答案。

export const CONCEPTS = {
  SORT: '排序（保持資料列完整、多欄排序）',
  FILTER: '篩選及 SUBTOTAL',
  SHEETS: '多工作表及跨工作表參照',
  CHART: '圖表（類型、數據範圍、標題及圖例）',
  INTERPRET: '解讀數據及異常',
  PIVOT: '樞紐分析表及樞紐分析圖',
  WHATIF: '假設分析（變數、藍本、目標搜尋）',
  REASON: '以數據支持結論',
  ABS_REF: '絕對參照 $ 與公式複製',
  FORMULA: '需要使用公式（不可寫死數值）',
  SYNTAX: '公式語法',
  OTHER: '其他',
};

const C = (concept, text) => ({ concept, text });

export const ERRORS = {
  EMPTY: C('FORMULA', '{cell} 仍是空白。'),
  FORMULA_REQUIRED: C('FORMULA', '{cell} 需要使用公式（以 = 開始）。直接輸入數值，數據改變時不會更新。'),
  SYNTAX_ERROR: C('SYNTAX', '{cell} 的公式有語法錯誤：{detail}'),
  NON_ASCII: C('SYNTAX', '{cell} 含有全形或中文字元：{detail}。請改用半形英文符號。'),
  UNKNOWN_NAME: C('SYNTAX', '{cell}：{detail}'),
  UNSUPPORTED_FUNCTION: C('OTHER', '{cell} 使用了本系統未能核實的函數 {detail}。此情況不會扣分，請通知老師覆核。'),
  CIRCULAR: C('OTHER', '{cell} 出現循環參照：公式直接或間接引用了自己。'),
  VALUE_WRONG: C('OTHER', '{cell} 的結果不正確。'),
  HIDDEN_FAIL: C('FORMULA', '{cell} 在本隊數據下看似正確，但換了另一組測試數據（或另一次排序）後不正確。請檢查是否寫死了數值或位置。'),
  COPY_INCOMPLETE: C('ABS_REF', '以下儲存格未正確複製公式或結果不正確：{detail}。'),
  FORMULA_ERROR_VALUE: C('OTHER', '{cell} 顯示錯誤值 {detail}，請檢查公式。'),
  FUNCTION_REQUIRED: C('FORMULA', '{cell} 題目要求使用 {detail}。'),
  HARDCODED_TEXT: C('FORMULA', '{cell} 直接輸入了答案。請用查找函數由表格找出，數據重新排列時結果才會更新。'),

  // 排序
  NOT_SORTED: C('SORT', '表格仍是原本的次序，請先排序。'),
  ROWS_BROKEN: C('SORT', '表格 {cell} 的資料列被拆散了：只排序了部分欄，其他欄沒有一起移動，紀錄已經對不上。請按「↺ 原本次序」，再選擇「擴展選取範圍」排序整個表格。'),
  SORT_DIRECTION: C('SORT', '排序方向相反：題目要求 {detail}。由大至小（降序）與由小至大（升序）不同。'),
  SORT_KEY_WRONG: C('SORT', '排序的欄位不正確：題目要求按 {detail} 排序。'),
  SORT_LEVELS: C('SORT', '多欄排序的層級不正確：題目要求 {detail}。主要排序相同的資料列，才按第二層排序。如逐次排序，要先排次要欄，最後才排主要欄。'),

  // 篩選
  NOT_FILTERED: C('FILTER', '仍未設定篩選。請用標題列的篩選按鈕 ▾。'),
  FILTER_ONE_CONDITION: C('FILTER', '篩選只用了一個條件。題目要求兩個條件「同時」成立（AND）：在兩個欄位都要設定篩選。'),
  FILTER_WRONG: C('FILTER', '篩選後可見的資料列不正確，請檢查每個欄位的篩選條件。'),
  FILTER_HARDCODED: C('FILTER', '篩選看似正確，但換了數據後顯示的資料列不對：可能是逐一勾選了個別紀錄，而不是按欄位的條件篩選。'),
  SUBTOTAL_NEEDED: C('FILTER', '{cell} 把被篩選隱藏的資料列也計算在內。COUNTA、SUM 會計算所有列；只計算可見列要用 SUBTOTAL（例如 SUBTOTAL(3,…)、SUBTOTAL(9,…)），或用 COUNTIFS／SUMIFS 寫出同樣的條件。'),

  // 多工作表
  CROSS_SHEET_REQUIRED: C('SHEETS', '{cell} 需要參照另一張工作表 {detail}（寫法：工作表名稱!儲存格），不可以直接輸入數字。'),
  LOOKUP_SHEET: C('SHEETS', '{cell} 的查找範圍及傳回範圍要在 {detail} 工作表。'),
  XLOOKUP_REQUIRED: C('SHEETS', '{cell} 題目要求使用 XLOOKUP。行車紀錄的次序與時間表不同，不可以直接按同一列參照。'),
  NOT_FOUND_MISSING: C('SHEETS', '{cell} 沒有設定「找不到時的值」，消失的列車會顯示 #N/A。XLOOKUP 的第四個參數應是 "{detail}"。'),
  NOT_FOUND_TEXT: C('SHEETS', '{cell} 找不到時應顯示 "{detail}"。'),
  RANGE_NOT_ABSOLUTE: C('ABS_REF', '{cell} 向下複製後查找範圍跟着移動，部分列車找不到。請用 $ 固定範圍。'),
  IF_REQUIRED: C('SHEETS', '{cell} 需要使用 IF 判斷狀態。'),
  LIMIT_REF: C('SHEETS', '{cell} 應引用時間表工作表的容許分鐘（E3L2_Timetable!$F$2）。'),
  LIMIT_HARDCODED: C('FORMULA', '{cell} 直接寫入了容許分鐘。容許分鐘改變時結果不會更新，請引用 E3L2_Timetable!$F$2。'),
  LIMIT_NOT_FIXED: C('ABS_REF', '{cell} 引用容許分鐘時沒有固定（$F$2），向下複製後會變成 F3、F4……'),
  MISSING_NOT_HANDLED: C('SHEETS', '{cell} 沒有先處理 MISSING：文字 "MISSING" 減去數字會出現 #VALUE!。先判斷是否 MISSING，再計算延誤。'),
  BOUNDARY_GE: C('SHEETS', '{cell} 用了 >=：延誤剛好等於容許分鐘的列車不算 LATE。題目要求「大於」。'),
  COUNTIFS_REQUIRED: C('SHEETS', '{cell} 題目要求使用 COUNTIFS 同時檢查兩個條件。'),

  // 圖表
  NO_CHART: C('CHART', '仍未建立圖表。選取數據後按「📊 插入圖表」。'),
  CHART_TYPE_TREND: C('CHART', '圖表 {cell} 是 {detail}：顯示數據「隨時間的變化趨勢」應使用折線圖。'),
  CHART_TYPE_COMPARE: C('CHART', '圖表 {cell} 是 {detail}：比較不同類別的數量應使用柱形圖或棒形圖（圓形圖只適合顯示一個整體的組成比例）。'),
  CATS_MISSING: C('CHART', '圖表 {cell} 沒有設定類別（X 軸標籤），讀者看不到每一棒／每一點代表哪個時段。'),
  CATS_WRONG: C('CHART', '圖表 {cell} 的類別範圍不正確，應是全部時段（Hour）。'),
  HEADER_IN_DATA: C('CHART', '圖表 {cell} 的範圍包括了標題列：標題是文字，不是數據，應由第 2 列開始（標題可作數列名稱）。'),
  HOUR_AS_SERIES: C('CHART', '圖表 {cell} 把 Hour 當作數列畫了出來。Hour 是類別（X 軸標籤），不是要比較的數值。'),
  SERIES_WRONG: C('CHART', '圖表 {cell} 的數列不正確，應包括 {detail}。'),
  CHART_SOURCE: C('CHART', '這個圖表應使用工作表範圍，而不是樞紐分析表。'),
  CHART_TITLES: C('CHART', '圖表 {cell} 缺少標題或座標軸標題。讀者需要知道圖表、X 軸及 Y 軸各代表甚麼（包括單位）。'),
  LEGEND_MISSING: C('CHART', '圖表 {cell} 沒有顯示圖例：有多個數列時，讀者分不清哪一組是平日、哪一組是星期日。'),
  SERIES_NAMES: C('CHART', '圖表 {cell} 的數列名稱不正確，應是 Weekday 及 Sunday。'),

  // 樞紐分析表
  PIVOT_MISSING: C('PIVOT', '仍未建立樞紐分析表。按「🧮 樞紐分析表」。'),
  PIVOT_FIELDS: C('PIVOT', '樞紐分析表的列／欄欄位不正確，題目要求 {detail}。'),
  PIVOT_AGG: C('PIVOT', '樞紐分析表的彙總方式不正確：題目要求 {detail}。COUNT 是計算紀錄數目，SUM 是加總數值。'),
  PIVOT_VALUE_FIELD: C('PIVOT', '樞紐分析表的「值」欄位不正確，應是 {detail}。'),
  PIVOT_FILTER_MISSING: C('PIVOT', '樞紐分析表沒有篩選：題目只計算 {detail} 的紀錄。'),
  PIVOT_FILTER_EXTRA: C('PIVOT', '樞紐分析表多了篩選條件，部分紀錄沒有計算在內。'),
  PIVOT_FILTER_WRONG: C('PIVOT', '樞紐分析表的結果與題目要求不符，請檢查篩選選取的值。'),
  PIVOT_CHART_MISSING: C('PIVOT', '仍未建立樞紐分析圖：插入圖表時，「數據來源」選擇樞紐分析表。'),
  PIVOT_CHART_SOURCE: C('PIVOT', '樞紐分析圖 {cell} 使用的樞紐分析表不符合題目要求。'),

  // 假設分析＋推理
  IF_AND_REQUIRED: C('WHATIF', '{cell} 需要用 IF 及 AND 同時檢查多個條件。'),
  WINDOW_REFS: C('WHATIF', '{cell} 需要引用 B2（離開時間）及 B3（假設的鎖定分鐘）。'),
  LOCK_NOT_FIXED: C('ABS_REF', '{cell} 引用 B2／B3 時沒有用 $ 固定，向下複製後會參照錯誤的儲存格。'),
  COMPUTER_MISSING: C('WHATIF', '{cell} 沒有檢查電腦是否 FSM-PC：其他電腦在同一時間的修改與站長室無關。'),
  WINDOW_BOUNDARY: C('WHATIF', '{cell} 的時間範圍包括了 B2+B3：螢幕在那一刻已經鎖上，應使用 <。'),
  WHATIF_WRONG: C('WHATIF', '{cell} 在假設 {detail} 時結果不正確：公式要引用變數儲存格，B3 改變時自動重新計算。'),
  LEN_REQUIRED: C('WHATIF', '{cell} 需要用 LEN 檢查字元數目。'),
  LENGTH_MISSING: C('WHATIF', '{cell} 把少於 5 個字元的值也當作貓咪痕跡（例如 7777 只是正常的數字）。題目要求最少 5 個字元。'),
  SCENARIO_MISSING: C('WHATIF', '仍未建立分析藍本。按「🔀 分析藍本」。'),
  SCENARIO_VALUES: C('WHATIF', '分析藍本缺少 B3＝{detail} 的藍本。'),
  SCENARIO_RESULT: C('WHATIF', '分析藍本的結果儲存格要包括 {cell}，才可以比較不同假設的結果。'),
  MIN_LOCK_WRONG: C('WHATIF', '{cell} 的最少鎖定分鐘不正確。可用「🎯 目標搜尋」：目標儲存格 I1、目標值等於 I2、變數儲存格 B3。'),
  MIN_LOCK_NOT_MIN: C('WHATIF', '{cell} 的分鐘可以解釋全部痕跡，但不是「最少」的分鐘：再試較小的數值。'),
  ACTUAL_SETTING: C('REASON', 'B3 要設為 IT 部記錄的實際設定（{detail} 分鐘，即 B4），結論才建基於真實情況，而不是假設。'),
  CONCLUSION_UNCLE: C('REASON', '{cell}：修改日誌沒有阿叔的帳戶紀錄；他的投訴只是指出數據有錯。沒有數據支持他改過紀錄。'),
  CONCLUSION_ROCKET: C('REASON', '{cell}：火箭仔的修改來自售票處電腦，是他自己的公式錯誤（I4）；站長室的亂碼在 FSM-PC 未鎖上時出現，兩者要分開。'),
  CONCLUSION_CODE: C('REASON', '{cell} 請輸入 CAT、UNCLE 或 ROCKET。'),
};

export function renderError(e) {
  const def = ERRORS[e.code] || { text: e.code, concept: 'OTHER' };
  const text = def.text.replace('{cell}', e.cell || '').replace('{detail}', e.detail ?? '');
  return { code: e.code, cell: e.cell || null, concept: def.concept, text };
}

/** 賽後回顧（只顯示概念，不點名任何隊伍或學生） */
export const REVIEW_CARDS = {
  ROWS_BROKEN: {
    wrong: '只選取 H 欄再按 Z→A', why: '只有 WaitMin 移動了，ComplaintID、Station 等留在原位，紀錄全部對不上。', keyword: '擴展選取範圍：整列一起排序', fixed: '點選表格內任何一格，再排序整個表格',
    clue: '「把整個表格排序」', apply: '為何排序前要確保表格沒有空白列或空白欄？',
  },
  SORT_LEVELS: {
    wrong: '先按 Category 排序，再按 Time 排序', why: '最後一次排序成為主要次序，之前的 Category 次序被打亂。', keyword: '多層排序：主要 → 次要 → 第三', fixed: '⇅ 自訂排序：Category ↑、Severity ↓、Time ↑',
    clue: '「先按……，同一……再按……」', apply: '如只能逐次排序，應先排哪一欄？',
  },
  SUBTOTAL_NEEDED: {
    wrong: '=COUNTA(A2:A121)', why: 'COUNTA 會計算被篩選隱藏的資料列，結果仍是 120。', keyword: 'SUBTOTAL 只計算可見列', fixed: '=SUBTOTAL(3,A2:A121)',
    clue: '「篩選後可見的……」', apply: 'SUBTOTAL(9,…) 與 SUM(…) 有甚麼分別？',
  },
  FILTER_ONE_CONDITION: {
    wrong: '只篩選 Caller＝UNCLE-WONG', why: '阿叔其他類別的投訴亦顯示了出來。', keyword: '多欄篩選＝AND（同時成立）', fixed: 'Caller＝UNCLE-WONG 而且 Category＝DATA',
    clue: '「……而且……」', apply: '如要顯示「阿叔或者 DATA」的投訴，篩選做得到嗎？',
  },
  BOUNDARY_GE: {
    wrong: '=IF(C2-B2>=E3L2_Timetable!$F$2,"LATE","OK")', why: '延誤剛好等於容許分鐘的列車被當作 LATE。', keyword: '「大於」→ >', fixed: '=IF(C2-B2>E3L2_Timetable!$F$2,"LATE","OK")',
    clue: '「超過容許分鐘」', apply: '「不少於」應用哪個運算符？',
  },
  HOUR_AS_SERIES: {
    wrong: '選取 A1:D19 直接插入圖表', why: 'Hour 是數字，被當作一組數列畫出來。', keyword: '類別（X 軸）與數列（Y 軸）', fixed: '類別 A2:A19，數列 D2:D19',
    clue: '「以 Hour 為類別」', apply: '如 Hour 寫成文字「06:00」，會有同樣問題嗎？',
  },
  CHART_TYPE_TREND: {
    wrong: '用圓形圖顯示每小時人流', why: '圓形圖只顯示組成比例，看不到隨時間的變化。', keyword: '趨勢 → 折線圖；比較 → 柱形圖；比例 → 圓形圖', fixed: '折線圖',
    clue: '「隨時間的變化」', apply: '比較五個車站的投訴數目，應用哪種圖表？',
  },
  PIVOT_AGG: {
    wrong: '值：COUNT of Cells', why: '計算的是紀錄數目，不是改動的儲存格總數。', keyword: 'COUNT＝數目；SUM＝加總；AVERAGE＝平均', fixed: '值：SUM of Cells',
    clue: '「改動了多少格」→ 加總', apply: '「平均每次改動多少格」應選哪種彙總方式？',
  },
  PIVOT_FILTER_MISSING: {
    wrong: '沒有篩選 Computer', why: '所有電腦的修改都計算在內，看不到站長室電腦的模式。', keyword: '篩選（Filters）', fixed: '篩選 Computer＝FSM-PC',
    clue: '「只計算……的紀錄」', apply: '樞紐分析表的「篩選」與工作表的「篩選」有甚麼相似？',
  },
  LOCK_NOT_FIXED: {
    wrong: '=IF(AND(…>=B2,…<B2+B3),1,0)', why: '向下複製後 B2 變成 B3、B4……', keyword: '$B$2、$B$3', fixed: '=IF(AND(…>=$B$2,…<$B$2+$B$3),1,0)',
    clue: '「每一列都用同一個假設」', apply: '為何把假設放在一個儲存格，比寫在公式內更適合做假設分析？',
  },
  ACTUAL_SETTING: {
    wrong: '用 B3＝5 下結論', why: '結論建基於一個假設，而不是實際的設定。', keyword: '假設 vs 實際數據', fixed: 'B3＝B4（實際設定）',
    clue: '「哪個結論有數據支持」', apply: '為甚麼調查時要比較多個藍本，而不只看一個？',
  },
  CONCLUSION_UNCLE: {
    wrong: 'I5 輸入 UNCLE', why: '阿叔的投訴指出問題，但修改日誌沒有他的紀錄。', keyword: '以證據支持結論', fixed: 'CAT（未鎖上的 FSM-PC、同一字元重複的輸入）',
    clue: '「哪些數據支持」', apply: '站長室應如何防止同類事件？（例如自動鎖定、保護工作表、權限控制）',
  },
};
