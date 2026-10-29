// 第二集：錯誤代碼 → 繁體中文 Feedback 及概念分類（教師報告用）。
// 對學生只提示概念，不直接給出標準答案公式。

export const CONCEPTS = {
  FIND_TEXT: 'FIND 與 LEFT／MID／RIGHT／LEN 文字擷取',
  LOOKUP: 'XLOOKUP 查找（包括找不到時的值）',
  ROUNDING: 'ROUND 與 INT（四捨五入 vs 向下取整）',
  DISTANCE: 'SQRT、^ 次方與 RANK 排名',
  RANDOM: 'RAND 隨機數',
  ABS_REF: '絕對參照 $ 與公式複製',
  CONDITIONAL: 'COUNTIF 條件函數（第一集）',
  FORMULA: '需要使用公式（不可寫死數值）',
  SYNTAX: '公式語法',
  OTHER: '其他',
};

const C = (concept, text) => ({ concept, text });

export const ERRORS = {
  EMPTY: C('FORMULA', '{cell} 仍是空白，請輸入公式。'),
  FORMULA_REQUIRED: C('FORMULA', '{cell} 需要使用公式（以 = 開始）。直接輸入數值或文字，即使結果相同亦不能得分。'),
  SYNTAX_ERROR: C('SYNTAX', '{cell} 的公式有語法錯誤：{detail}'),
  NON_ASCII: C('SYNTAX', '{cell} 含有全形或中文字元：{detail}。請改用半形英文符號（例如 $ , ( ) "）。'),
  UNKNOWN_NAME: C('SYNTAX', '{cell}：{detail}'),
  UNSUPPORTED_FUNCTION: C('OTHER', '{cell} 使用了本系統未能核實的函數 {detail}。此情況不會扣分，請通知老師覆核。'),
  CIRCULAR: C('OTHER', '{cell} 出現循環參照：公式直接或間接引用了自己。'),
  VALUE_WRONG: C('OTHER', '{cell} 的計算結果不正確。'),
  HIDDEN_FAIL: C('FORMULA', '{cell} 在本隊數據下結果看似正確，但換了另一組測試數據後結果不正確。請檢查是否寫死了數值，或參照了錯誤的儲存格。'),
  COPY_INCOMPLETE: C('ABS_REF', '以下儲存格未正確複製公式或結果不正確：{detail}。請確認已把正確公式複製至整個範圍。'),
  FORMULA_ERROR_VALUE: C('OTHER', '{cell} 顯示錯誤值 {detail}，請檢查公式。'),

  // L1 門禁紀錄
  FIND_REQUIRED: C('FIND_TEXT', '{cell} 需要使用 FIND 找出符號 {detail} 的位置。紀錄長度不固定，不能靠數字元。'),
  FIND_WRONG_CHAR: C('FIND_TEXT', '{cell} 的 FIND 應該尋找符號 {detail}。'),
  MID_REQUIRED: C('FIND_TEXT', '{cell} 需要使用 MID 由紀錄中間取出時間。'),
  MID_START_HARDCODED: C('FIND_TEXT', '{cell} 的 MID 開始位置寫死了數字。地點名稱長度不同，開始位置要由 @ 的位置計算（可以引用 B 欄）。'),
  MID_START_OFF_BY_ONE: C('FIND_TEXT', '{cell} 取出的文字包括了 @ 本身。時間在 @「之後」，開始位置要再加 1。'),
  CODE_LENGTH_FIXED: C('FIND_TEXT', '{cell} 假設員工證號碼的長度固定。號碼長度不同（例如 R07、SEC12），字元數目要用 LEN 及 # 的位置計算。'),
  COUNTIF_REQUIRED: C('CONDITIONAL', '{cell} 題目要求使用 COUNTIF 計算符合條件的紀錄數目。'),
  CRITERIA_NOT_H1: C('CONDITIONAL', '{cell} 的條件應引用儲存格 H1，而不是直接寫入號碼。'),
  RANGE_WRONG: C('CONDITIONAL', '{cell} 的範圍不正確，請檢查起點及終點儲存格。'),

  // L2 員工名冊
  XLOOKUP_REQUIRED: C('LOOKUP', '{cell} 題目要求使用 XLOOKUP。'),
  LOOKUP_VALUE_WRONG: C('LOOKUP', '{cell} 的查找值應是同一列的 {detail}。'),
  LOOKUP_RANGE_WRONG: C('LOOKUP', '{cell} 的查找範圍不正確：應在名冊的 Code 欄（G2:G9）尋找號碼。'),
  RETURN_RANGE_WRONG: C('LOOKUP', '{cell} 的傳回範圍不正確：應傳回 {detail}。'),
  NOT_FOUND_MISSING: C('LOOKUP', '{cell} 沒有設定「找不到時的值」，訪客的號碼會顯示 #N/A。XLOOKUP 的第四個參數可以設定為 "{detail}"。'),
  NOT_FOUND_TEXT: C('LOOKUP', '{cell} 找不到時應顯示 "{detail}"（全大寫英文，放在雙引號內）。'),
  RANGE_NOT_ABSOLUTE: C('ABS_REF', '{cell} 向下複製後，名冊範圍跟着移動了，部分號碼查不到。請用 $ 固定名冊範圍（例如 $G$2:$G$9）。'),
  REVERSE_LOOKUP: C('LOOKUP', '{cell} 是「反向查找」：已知的是姓名，所以查找範圍應是 StaffName 欄（H2:H9），傳回 Code 欄。'),
  HARDCODED_TEXT: C('FORMULA', '{cell} 直接輸入了答案。請用 XLOOKUP 由表格找出結果，數據改變時才會更新。'),

  // L3 現金箱
  ROUND_REQUIRED: C('ROUNDING', '{cell} 題目要求使用 ROUND 四捨五入（目前：{detail}）。'),
  ROUND_DIGITS: C('ROUNDING', '{cell} 的 ROUND 小數位數不正確（目前是 {detail}）。題目要求四捨五入至一位小數（即一毫）。'),
  INT_REQUIRED: C('ROUNDING', '{cell} 需要使用 INT 向下取整：不足一袋不計，所以不可以四捨五入。'),
  BAG_HARDCODED: C('FORMULA', '{cell} 直接寫入了每袋金額。請引用 H1，金額改變時結果才會更新。'),
  H1_NOT_FIXED: C('ABS_REF', '{cell} 起的公式向下複製後，H1 變成了 H2、H3……。請用 $H$1 固定。'),
  SUM_REQUIRED: C('ROUNDING', '{cell} 需要使用 SUM 計算總和。'),
  SUM_RANGE: C('ROUNDING', '{cell} 的 SUM 範圍不正確，應包括全部金額（D2:D13）。'),

  // L4 不在場證明
  SQRT_REQUIRED: C('DISTANCE', '{cell} 需要使用 SQRT 計算平方根。'),
  DIST_FORMULA: C('DISTANCE', '{cell} 的距離公式不正確：要把 X 差的平方與 Y 差的平方「相加」，再開平方根。留意括號位置。'),
  OFFICE_NOT_FIXED: C('ABS_REF', '{cell} 引用辦公室位置時沒有使用 $（$H$1、$H$2）。結果今次正確，但向下複製時參照會移動，請養成固定參照的習慣。'),
  RANK_REQUIRED: C('DISTANCE', '{cell} 題目要求使用 RANK 排名。'),
  RANK_ORDER: C('DISTANCE', '{cell} 的排名方向相反：最接近（距離最小）要排第 1，RANK 的第三個參數要設定為 1（由小至大）。'),
  RANK_RANGE_NOT_FIXED: C('ABS_REF', '{cell} 的排名範圍向下複製後跟着移動了，所以排名不正確。請用 $ 固定整個排名範圍。'),
  RANK_REFS: C('RANDOM', '{cell} 的 RANK 應以 B2 為數值，B2:B13 為排名範圍。'),

  // L5 隨機抽查
  RAND_REQUIRED: C('RANDOM', '以下儲存格需要使用 RAND()（括號內不需要任何參數）：{cell}{detail}'),
  RAND_RANGE: C('RANDOM', '{cell} 的結果不是每次都會改變的 0 至 1 隨機數。請只使用 RAND()。'),
  H1_REQUIRED: C('FORMULA', '{cell} 需要引用 H1（儲物櫃數目），H1 改變時結果範圍才會跟着改變。'),
  RANDOM_OFF_BY_ONE: C('RANDOM', '{cell} 的隨機號碼範圍差了 1：結果可能出現 0 或 H1+1，或者永遠抽不到最後一個號碼。想想 INT(RAND()*H1) 的最小值及最大值，再決定要不要加 1。'),
  RANDOM_RANGE: C('RANDOM', '{cell} 的隨機號碼範圍不是 1 至 H1（每個號碼都要有機會出現）。'),
};

export function renderError(e) {
  const def = ERRORS[e.code] || { text: e.code, concept: 'OTHER' };
  const text = def.text.replace('{cell}', e.cell || '').replace('{detail}', e.detail ?? '');
  return { code: e.code, cell: e.cell || null, concept: def.concept, text };
}

/** 賽後回顧：只顯示概念，不點名任何隊伍或學生 */
export const REVIEW_CARDS = {
  MID_START_HARDCODED: {
    wrong: '=MID(A2,8,4)', why: '地點名稱長度不同，第 8 個字元不一定是時間的開始。', keyword: 'FIND 找位置，再交給 MID', fixed: '=MID(A2,FIND("@",A2)+1,4)',
    clue: '「長度不固定」→ 用 FIND 計位置', apply: '如要取出 @ 之前的地點名稱，應用哪個函數？長度怎樣計？',
  },
  MID_START_OFF_BY_ONE: {
    wrong: '=MID(A2,FIND("@",A2),4)', why: 'FIND 回傳的是 @ 本身的位置，所以結果包括了 @。', keyword: '位置 + 1', fixed: '=MID(A2,FIND("@",A2)+1,4)',
    clue: '「在某符號之後」→ 位置 + 1', apply: '如要取出 # 之前一個字元，開始位置應是多少？',
  },
  CODE_LENGTH_FIXED: {
    wrong: '=RIGHT(A2,3)', why: '號碼長度不同（R07、SEC12），固定取 3 個字元會截斷較長的號碼。', keyword: 'LEN(A2) − FIND("#",A2)', fixed: '=RIGHT(A2,LEN(A2)-FIND("#",A2))',
    clue: '「直到最後」→ 總長度減去符號位置', apply: '如號碼前面多了一個空格，應怎樣處理？',
  },
  NOT_FOUND_MISSING: {
    wrong: '=XLOOKUP(A2,$G$2:$G$9,$H$2:$H$9)', why: '名冊找不到訪客號碼，結果顯示 #N/A。', keyword: 'XLOOKUP 第四個參數：找不到時的值', fixed: '=XLOOKUP(A2,$G$2:$G$9,$H$2:$H$9,"VISITOR")',
    clue: '「找不到時顯示……」→ 第四個參數', apply: '如找不到時想顯示空白，第四個參數應寫甚麼？',
  },
  RANGE_NOT_ABSOLUTE: {
    wrong: '=XLOOKUP(A2,G2:G9,H2:H9,"VISITOR")', why: '向下複製後名冊範圍變成 G3:G10、G4:G11……，前面的員工被漏掉。', keyword: '固定查找表 $G$2:$G$9', fixed: '=XLOOKUP(A2,$G$2:$G$9,$H$2:$H$9,"VISITOR")',
    clue: '「每列都查同一個名冊」→ 名冊要加 $', apply: '查找值 A2 需要加 $ 嗎？為甚麼？',
  },
  REVERSE_LOOKUP: {
    wrong: '=XLOOKUP(H11,G2:G9,H2:H9)', why: '已知的是姓名，卻在號碼欄尋找，所以甚麼都找不到。', keyword: '查找範圍 = 已知資料所在的欄', fixed: '=XLOOKUP(H11,H2:H9,G2:G9)',
    clue: '「由姓名找號碼」→ 姓名欄查找、號碼欄傳回', apply: 'XLOOKUP 可以向左查找嗎？這比舊的 VLOOKUP 方便在哪裏？',
  },
  ROUND_DIGITS: {
    wrong: '=ROUND(B2*C2,0)', why: '四捨五入至整數，失去了毫子。', keyword: 'ROUND(數值, 小數位數)', fixed: '=ROUND(B2*C2,1)',
    clue: '「一位小數」→ 第二個參數是 1', apply: 'ROUND(1234,-2) 的結果是甚麼？',
  },
  INT_REQUIRED: {
    wrong: '=ROUND(D2/$H$1,0)', why: '不足一袋也被四捨五入成一袋，袋數多計了。', keyword: 'INT 向下取整', fixed: '=INT(D2/$H$1)',
    clue: '「不足一個不計」→ INT', apply: '「最少需要多少個袋」又應怎樣計算？',
  },
  H1_NOT_FIXED: {
    wrong: '=INT(D2/H1)', why: '向下複製後變成 D3/H2、D4/H3……，除以空白儲存格。', keyword: '$H$1', fixed: '=INT(D2/$H$1)',
    clue: '「每列都用同一個設定值」→ 固定參照', apply: 'F4 鍵按一下、兩下、三下，參照分別變成甚麼？',
  },
  DIST_FORMULA: {
    wrong: '=SQRT(C2-$H$1)^2+(D2-$H$2)^2', why: '括號位置錯了：SQRT 只包住了第一部分。', keyword: 'SQRT( (X差)^2 + (Y差)^2 )', fixed: '=SQRT((C2-$H$1)^2+(D2-$H$2)^2)',
    clue: '「兩點距離」→ 先相加，再開方', apply: '(-3)^2 與 -3^2 的結果一樣嗎？',
  },
  RANK_ORDER: {
    wrong: '=RANK(E2,$E$2:$E$9)', why: '預設由大至小排名，最遠的人排了第 1。', keyword: 'RANK 第三個參數 1 = 由小至大', fixed: '=RANK(E2,$E$2:$E$9,1)',
    clue: '「最接近／最少排第 1」→ 由小至大', apply: '跑步比賽的時間排名應用哪個方向？',
  },
  RANK_RANGE_NOT_FIXED: {
    wrong: '=RANK(B2,B2:B13)', why: '向下複製後排名範圍縮小，排名出現重複。', keyword: '$B$2:$B$13', fixed: '=RANK(B2,$B$2:$B$13)',
    clue: '「與全部數值比較」→ 範圍固定', apply: '為甚麼數值 B2 不需要加 $？',
  },
  RANDOM_OFF_BY_ONE: {
    wrong: '=INT(RAND()*$H$1)', why: '結果是 0 至 H1−1，可能抽到不存在的 0 號儲物櫃。', keyword: 'INT(RAND()*N)+1 → 1 至 N', fixed: '=INT(RAND()*$H$1)+1',
    clue: '「1 至 N 的隨機整數」→ 乘 N、取整、加 1', apply: '如要隨機抽 10 至 20 的整數，公式應如何修改？',
  },
  HARDCODED_TEXT: {
    wrong: '火箭仔（直接輸入）', why: '直接輸入答案不能證明推理過程，數據改變時亦不會更新。', keyword: '用公式找出答案', fixed: '=XLOOKUP(1,F2:F9,A2:A9)',
    clue: '「找出……的姓名」→ 查找函數', apply: '如要找出排名最後的同事，公式應如何修改？',
  },
};
