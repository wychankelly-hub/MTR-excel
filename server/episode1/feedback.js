// 錯誤代碼 → 繁體中文 Feedback 及概念分類（教師報告用）。
// 對學生只提示概念，不直接給出標準答案公式。

export const CONCEPTS = {
  ABS_REF: '絕對參照 $ 與公式複製',
  RANGE: 'SUM／MAX／AVERAGE 範圍選擇',
  AND_OR: 'IF／AND／OR 邏輯條件',
  CONDITIONAL: 'COUNTIF／SUMIF 條件函數',
  TEXT_AMP: '& 連接及 LEFT／MID／RIGHT 文字函數',
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

  // L1
  ABS_REF_MISSING: C('ABS_REF', '{cell} 引用 H1 時沒有使用絕對參照。公式向下複製時，H1 會變成 H2、H3……，所以計錯車費。'),
  ABS_REF_PARTIAL: C('ABS_REF', '{cell} 使用了 {detail}，只固定了欄或列其中一部分。題目明確要求「絕對參照」，欄字母和列號前都需要加 $。'),
  HARDCODED_MULTIPLIER: C('FORMULA', '{cell} 直接寫入了調整系數的數值。系數應該引用儲存格 H1，否則系數改變時結果不會更新。'),
  FARE_OPERATOR: C('OTHER', '{cell} 的運算不正確：總車費 = 乘車次數 × 每程車費 × 系數，請檢查是否把乘號寫成加號。'),
  BALANCE_DIRECTION: C('OTHER', '{cell} 的扣款方向相反：剩餘餘額應是「初始餘額減去總車費」。'),
  SUM_REQUIRED: C('RANGE', '{cell} 題目要求使用 SUM 函數。'),
  SUM_RANGE: C('RANGE', '{cell} 的 SUM 範圍不正確，應包括全部乘客的剩餘餘額。'),
  MIN_REQUIRED: C('RANGE', '{cell} 題目要求使用 MIN 函數。'),

  // L2
  FLOW_ONE_COLUMN: C('RANGE', '{cell} 只計算了其中一欄。總人流需要同時包括進站（Entries）及出站（Exits）人數。'),
  MAX_WRONG_RANGE: C('RANGE', '{cell} 應先計算每個時段的總人流（D 欄），再找最高值；不要直接在 B、C 欄找最大的單項人數。'),
  AVERAGE_WRONG_RANGE: C('RANGE', '{cell} 計算的是單項人數的平均，而不是各時段「總人流」的平均。請使用 D 欄。'),
  COUNT_REQUIRED: C('RANGE', '{cell} 題目要求使用 COUNT 函數計算含有數值的儲存格。'),
  RANGE_WRONG: C('RANGE', '{cell} 的範圍不正確，請檢查起點及終點儲存格。'),

  // L3
  IF_REQUIRED: C('AND_OR', '{cell} 需要使用 IF 函數輸出結果。'),
  AND_OR_REQUIRED: C('AND_OR', '{cell} 題目要求同時使用 AND 及 OR。'),
  AND_OR_SWAPPED: C('AND_OR', '{cell} 的 AND 與 OR 位置可能對調了。「或者」通常用 OR；「而且」通常用 AND。'),
  BOUNDARY_GT: C('AND_OR', '{cell} 的年齡界線判斷不正確：「達到」界線包括剛好等於，應使用 >=，而不是 >。'),
  VALIDCARD_IGNORED: C('AND_OR', '{cell} 忽略了「持卡有效」（ValidCard）這個條件。'),
  OUTPUT_NOT_1_0: C('AND_OR', '{cell} 的輸出應是數字 1 或 0，而不是 {detail}。'),
  H1_NOT_ABSOLUTE: C('ABS_REF', '{cell} 起的公式向下複製後，年齡界線的參照跟着移動了。請固定 H1（$H$1）。'),
  H1_HARDCODED: C('FORMULA', '{cell} 直接寫入了年齡界線數字。條件應引用 H1，界線改變時結果才會更新。'),
  LOGIC_WRONG: C('AND_OR', '{cell} 的條件組合未能正確判斷所有情況（例如剛好達到界線、只有通行證、卡無效等）。'),

  // L4
  COUNTIF_REQUIRED: C('CONDITIONAL', '{cell} 題目要求使用 COUNTIF。COUNT 只計算數值儲存格的數目，不能加入條件。'),
  SUMIF_REQUIRED: C('CONDITIONAL', '{cell} 題目要求使用 SUMIF。'),
  CRITERIA_RANGE_WRONG: C('CONDITIONAL', '{cell} 的條件範圍不正確：應檢查 {detail} 欄的全部記錄。'),
  CRITERIA_NOT_H2: C('CONDITIONAL', '{cell} 的條件應引用儲存格 H2，而不是直接寫入類別文字。'),
  SUM_RANGE_WRONG: C('CONDITIONAL', '{cell} 的總和範圍不正確：需要加總的是 EstimatedValue（C 欄）。SUMIF 的第三個參數是總和範圍。'),
  CRITERIA_GT: C('CONDITIONAL', '{cell} 用了 >，會漏計剛好等於門檻 H1 的失物。題目要求「大於或等於」。'),
  CRITERIA_SPACES: C('CONDITIONAL', '{cell} 的條件文字含多餘空格（例如 " >= "），試算表會把它當成普通文字比較。'),
  CRITERIA_HARDCODED: C('CONDITIONAL', '{cell} 在條件內寫死了門檻數值。請以 ">="&H1 的方式引用 H1。'),
  CRITERIA_SYNTAX: C('CONDITIONAL', '{cell} 的比較條件需要寫成文字：用雙引號包住比較運算符，再用 & 連接 H1。'),
  CRITERIA_NO_AMP: C('CONDITIONAL', '{cell} 的條件需要用 & 把比較運算符 ">=" 與 H1 連接。'),

  // L5
  TEXT_FUNC_WRONG: C('TEXT_AMP', '{cell} 應使用工作表 D 欄指定的 {detail} 函數。'),
  TEXT_REF_WRONG: C('TEXT_AMP', '{cell} 應引用同一列的 Code（A 欄）。'),
  MID_POSITION: C('TEXT_AMP', '{cell} 的 MID 開始位置不正確。位置由 1 起計，並應引用同列的 B 欄。'),
  MID_ARGS: C('TEXT_AMP', '{cell} 的 MID 需要三個參數：文字、開始位置、字元數目。'),
  HARDCODED_LETTER: C('TEXT_AMP', '{cell} 直接輸入了字母。請使用文字函數由 Code 擷取。'),
  AMP_REQUIRED: C('TEXT_AMP', '{cell} 題目要求使用 & 連接 C2:C6 五個儲存格（不要用 + 或其他函數）。'),
  HARDCODED_WORD: C('TEXT_AMP', '{cell} 直接寫入了文字。秘密字詞必須由 C2:C6 的結果連接而成。'),
  AMP_REFS: C('TEXT_AMP', '{cell} 需要依次連接 C2、C3、C4、C5、C6 五個儲存格。'),
};

export function renderError(e) {
  const def = ERRORS[e.code] || { text: e.code, concept: 'OTHER' };
  const text = def.text.replace('{cell}', e.cell || '').replace('{detail}', e.detail ?? '');
  return { code: e.code, cell: e.cell || null, concept: def.concept, text };
}

/** 賽後回顧（§16 格式）：只顯示概念，不點名任何隊伍或學生 */
export const REVIEW_CARDS = {
  ABS_REF_MISSING: {
    wrong: '=B2*C2*H1', why: '公式向下複製時，H1 會變成 H2、H3……', keyword: '絕對參照 ($H$1)', fixed: '=B2*C2*$H$1',
    clue: '「將公式複製至其他列，但參照設定值不應變」→ 想起 $', apply: '請解釋：條件函數的門檻存放在一個儲存格時，為何複製公式仍需固定該儲存格？',
  },
  ABS_REF_PARTIAL: {
    wrong: '=B2*C2*H$1', why: '只固定了列號；題目明確要求絕對參照，即欄及列都要固定。', keyword: '絕對參照 ($H$1)、混合參照 (H$1)', fixed: '=B2*C2*$H$1',
    clue: '題目寫明「絕對參照」→ 欄字母及列號前都加 $', apply: '把公式向右複製時，H$1 會變成甚麼？',
  },
  MAX_WRONG_RANGE: {
    wrong: '=MAX(B2:C13)', why: '找出的是單項最大人數，而不是每個時段的總人流最大值。', keyword: '先計 TotalFlow，再 MAX', fixed: '=MAX(D2:D13)',
    clue: '「最繁忙」→ 先算總流量，再 MAX', apply: '如要找平均總人流，應用哪一個範圍？',
  },
  AND_OR_SWAPPED: {
    wrong: '=IF(OR(AND(B2>=$H$1,C2="YES"),D2=TRUE),1,0)', why: '把「或者」與「而且」對調，令持卡無效或只符合一項的乘客判斷錯誤。', keyword: '「或者」→ OR；「而且」→ AND', fixed: '=IF(AND(OR(B2>=$H$1,C2="YES"),D2=TRUE),1,0)',
    clue: '「持卡有效而且（年齡達標或者有通行證）」', apply: '如規則改為「年齡達標而且有通行證」，公式應如何修改？',
  },
  BOUNDARY_GT: {
    wrong: '=IF(AND(OR(B2>$H$1,C2="YES"),D2=TRUE),1,0)', why: '剛好 60 歲的乘客被排除。', keyword: '「達到／大於或等於」→ >=', fixed: '=IF(AND(OR(B2>=$H$1,C2="YES"),D2=TRUE),1,0)',
    clue: '「達到界線」包括等於', apply: '「低於 60 歲」應用哪個運算符？',
  },
  COUNTIF_REQUIRED: {
    wrong: '=COUNT(B2:B501)', why: 'COUNT 只計算數值儲存格，不會按類別篩選。', keyword: 'COUNTIF(條件範圍, 條件)', fixed: '=COUNTIF(B2:B501,H2)',
    clue: '「計算符合條件的件數」→ COUNTIF', apply: '如要計算符合條件的「總價值」，應改用哪個函數？',
  },
  CRITERIA_SYNTAX: {
    wrong: '=SUMIF(C2:C501,>=H1,C2:C501)', why: '比較運算符必須是文字（放在雙引號內），再用 & 連接儲存格。', keyword: '">="&H1', fixed: '=SUMIF(C2:C501,">="&H1,C2:C501)',
    clue: '「條件由 H1 決定」→ ">="&H1', apply: '如要計算「少於 H1」的總值，條件應怎樣寫？',
  },
  CRITERIA_GT: {
    wrong: '=SUMIF(C2:C501,">"&H1,C2:C501)', why: '漏計剛好等於門檻的失物。', keyword: '「大於或等於」→ >=', fixed: '=SUMIF(C2:C501,">="&H1,C2:C501)',
    clue: '「大於或等於 H1」', apply: '「不等於 H2」的條件應怎樣寫？',
  },
  CRITERIA_HARDCODED: {
    wrong: '=SUMIF(C2:C501,">=800",C2:C501)', why: '門檻改變時公式不會更新，換數據就會出錯。', keyword: '">="&H1（引用儲存格）', fixed: '=SUMIF(C2:C501,">="&H1,C2:C501)',
    clue: '「條件必須引用 H1」', apply: '為何引用儲存格比寫死數值更適合重複使用？',
  },
  HARDCODED_WORD: {
    wrong: '="LUNCH"', why: '直接輸入答案，數據改變時不會更新，亦沒有使用指定運算。', keyword: '& 連接儲存格', fixed: '=C2&C3&C4&C5&C6',
    clue: '「連接五個結果」→ &', apply: '如要在字母之間加入「-」，公式應如何修改？',
  },
  MID_POSITION: {
    wrong: '=MID(A3,B3-1,1)', why: 'MID 的位置由 1 起計，不是由 0 起計。', keyword: 'MID(文字, 開始位置, 字元數)', fixed: '=MID(A3,B3,1)',
    clue: '「擷取字串指定位置」→ MID', apply: '如要擷取最後兩個字元，應使用哪個函數？',
  },
  AMP_REQUIRED: {
    wrong: '=C2+C3+C4+C5+C6', why: '+ 是數學運算，用在文字上會出現 #VALUE!。', keyword: '& 文字連接運算符', fixed: '=C2&C3&C4&C5&C6',
    clue: '「把文字連接起來」→ &', apply: '=1&2 的結果是數字還是文字？',
  },
  FLOW_ONE_COLUMN: {
    wrong: '=SUM(B2:B2)', why: '只計算了進站人數，忽略出站人數。', keyword: 'SUM 範圍要包括所有相關欄', fixed: '=SUM(B2:C2)',
    clue: '「總人流（進站及出站人數）」', apply: '如要計算全日進站總人數，應用哪個範圍？',
  },
  FORMULA_REQUIRED: {
    wrong: '2552（直接輸入數字）', why: '固定數字不會隨數據更新，亦不能證明使用了指定函數。', keyword: '公式以 = 開始', fixed: '=SUM(F2:F21)',
    clue: '「建立公式」', apply: '為何試算表比計算機更適合處理會改變的數據？',
  },
};
