// 第三集 Preflight／測試用：每題的正確作答（公式＋分析設定）、等價作答及常見錯誤（以隊伍數據產生）。只在伺服器端使用。
import { LEVEL_BY_NUM, TASK_BY_ID } from './blueprint.js';
import { solveReference, referenceMetaFor, buildLevelWorkbook } from './generator.js';
import { computePivot } from '../engine/analysis.js';
import { expandRange } from '../engine/refs.js';

const fill = (col, r1, r2, f) => Object.fromEntries(Array.from({ length: r2 - r1 + 1 }, (_, i) => [`${col}${r1 + i}`, f(r1 + i)]));
const clone = (x) => JSON.parse(JSON.stringify(x));

function pivotAnswer(dataset, ref, pick) {
  const lv = LEVEL_BY_NUM[4];
  const wb = buildLevelWorkbook(dataset.levels[4], 4, {});
  const p = computePivot((c, r) => wb.valueAt(lv.sheet, c, r), { ...ref, source: lv.tools.pivotSource });
  return pick(p);
}
const topRow = (p) => p.rowKeys.reduce((b, k) => ((p.cells.get(`${k}|`) ?? -1) > (p.cells.get(`${b}|`) ?? -1) ? k : b), p.rowKeys[0]);

/** 正確作答：該題的參考公式＋參考分析設定（之前題目的設定亦包括在內，與學生工作表的實際狀態一致） */
export function correctInputs(taskId, dataset = null) {
  const t = TASK_BY_ID[taskId];
  const lv = LEVEL_BY_NUM[t.level];
  const out = {};
  for (const a of t.cells.flatMap(expandRange)) if (a in lv.referenceFormulas) out[a] = lv.referenceFormulas[a];
  Object.assign(out, clone(referenceMetaFor(t.level, taskId)));
  if (t.level === 4 && dataset) {
    const rm = lv.referenceMeta;
    if (taskId === 'E3-L4-T1') out.J2 = pivotAnswer(dataset, rm[taskId]['!PIVOTS'][0], (p) => topRow(p));
    if (taskId === 'E3-L4-T2') out.J3 = pivotAnswer(dataset, rm[taskId]['!PIVOTS'][0], (p) => p.labels.rows[topRow(p)]);
    if (taskId === 'E3-L4-T3') out.J4 = pivotAnswer(dataset, rm[taskId]['!PIVOTS'][0], (p) => { const pk = p.rowKeys.reduce((b, k) => (p.rowTotal[k] > (p.rowTotal[b] ?? -1) ? k : b), p.rowKeys[0]); return p.cells.get(`${pk}|FSM`); });
  }
  if (taskId === 'E3-L5-T3' && dataset) out.I3 = dataset.levels[5].params.minLock;
  return out;
}

/** 正確但做法不同（逐次排序、INDEX/MATCH、COUNTIFS、條件篩選、轉置的樞紐分析表…） */
export function equivalentInputs(taskId, dataset = null) {
  const base = correctInputs(taskId, dataset);
  switch (taskId) {
    case 'E3-L1-T1': return { ...base, J2: '=INDEX(A2:A121,1)', J3: '=index(c2:c121, 3)', '!SORT': { ops: [{ keys: [{ col: 'B', dir: 'asc' }] }, { keys: [{ col: 'H', dir: 'desc' }] }] } };
    case 'E3-L1-T2': return { ...base, J4: '=INDEX(A2:A121,MATCH("DATA",E2:E121,0))', '!SORT': { ops: [{ keys: [{ col: 'H', dir: 'desc' }] }, { keys: [{ col: 'B', dir: 'asc' }] }, { keys: [{ col: 'F', dir: 'desc' }] }, { keys: [{ col: 'E', dir: 'asc' }] }] } };
    case 'E3-L1-T3': return { ...base, J5: '=COUNTIFS(G2:G121,"UNCLE-WONG",E2:E121,"DATA")', J6: '=SUMIFS(H2:H121,G2:G121,"UNCLE-WONG",E2:E121,"DATA")', '!FILTER': { crit: { G: { op: '=', value: 'UNCLE-WONG' }, E: { op: 'begins', value: 'DAT' } } } };
    case 'E3-L2-T1': return fill('B', 2, 41, (r) => `=E3L2_Timetable!$B${r}`);
    case 'E3-L2-T2': return fill('C', 2, 41, (r) => `=xlookup(A${r},E3L2_Log!A$2:A$41,E3L2_Log!B$2:B$41,"MISSING")`);
    case 'E3-L2-T3': return fill('D', 2, 41, (r) => `=IF(C${r}="MISSING","MISSING",IF(C${r}-B${r}<=E3L2_Timetable!$F$2,"OK","LATE"))`);
    case 'E3-L2-T4': return { H2: '=COUNTIF($D$2:$D$41,"MISSING")', H3: '=COUNTIFS(D2:D41,"LATE")', H4: '=COUNTIFS(E3L2_Timetable!C2:C41,2,D2:D41,"LATE")' };
    case 'E3-L3-T1': return { '!CHARTS': [{ id: 'C1', type: 'line', title: '今日人流', xTitle: '時段', yTitle: '人次', legend: true, cats: 'A2:A19', series: [{ name: 'Today', ref: 'D2:D19' }] }] };
    case 'E3-L3-T2': return { '!CHARTS': [{ id: 'C1', type: 'line', title: 'x', xTitle: 'x', yTitle: 'y', legend: false, cats: 'A2:A19', series: [{ name: 'Today', ref: 'D2:D19' }] }, { id: 'C2', type: 'bar', title: '平日與星期日', xTitle: 'Hour', yTitle: 'Entries', legend: true, cats: 'A2:A19', series: [{ name: 'sunday', ref: 'C2:C19' }, { name: 'weekday', ref: 'B2:B19' }] }] };
    case 'E3-L3-T3': {
      const ref = solveReference(dataset.levels[3], 3);
      return { G2: ref.G2, G3: '=ROUND(INDEX(D2:D19,MATCH(MAX(D2:D19),D2:D19,0))/INDEX(B2:B19,MATCH(MAX(D2:D19),D2:D19,0)),1)', G4: '=INDEX(A2:A19,MATCH(MIN(D2:D19),D2:D19,0))' };
    }
    case 'E3-L4-T1': return { ...base, '!PIVOTS': [{ id: 'P1', rows: ['computer'], cols: [], values: [{ field: 'Day', agg: 'COUNT' }], filters: [] }] };
    case 'E3-L4-T2': return { ...base, J3: Number(base.J3), '!PIVOTS': [{ id: 'P1', rows: ['Hour'], cols: [], values: [{ field: 'Cells', agg: 'SUM' }], filters: [{ field: 'Computer', values: ['FSM-PC'] }, { field: 'Action', values: ['EDIT', 'INSERT', 'DELETE'] }] }] };
    case 'E3-L4-T3': return { ...base, '!PIVOTS': [{ id: 'P9', rows: ['User'], cols: ['Hour'], values: [{ field: 'Cells', agg: 'SUM' }], filters: [{ field: 'Computer', values: ['FSM-PC'] }] }], '!CHARTS': [{ id: 'C1', type: 'bar', title: 't', xTitle: '', yTitle: '', legend: true, source: { pivot: 'P9' } }] };
    case 'E3-L5-T1': return fill('E', 2, 61, (r) => `=IF(AND($B$2<=E3L5_EditLog!B${r},E3L5_EditLog!B${r}<$B$2+$B$3,E3L5_EditLog!C${r}="FSM-PC"),1,0)`);
    case 'E3-L5-T2': return fill('F', 2, 61, (r) => `=IF(AND(LEN(E3L5_EditLog!F${r})>=5,SUBSTITUTE(E3L5_EditLog!F${r},LEFT(E3L5_EditLog!F${r},1),"")=""),1,0)`);
    case 'E3-L5-T3': return { ...base, I1: '=SUMIFS(E2:E61,F2:F61,1)', I2: '=SUM(F2:F61)', I3: '=MAXIFS(E3L5_EditLog!B2:B61,F2:F61,1)-$B$2+1', '!SCEN': { changing: ['B3'], result: ['I1', 'I2'], list: [{ name: '30 分鐘', values: { B3: 30 } }, { name: '15 分鐘', values: { B3: 15 } }, { name: '5 分鐘', values: { B3: 5 } }, { name: '1 分鐘', values: { B3: 1 } }] } };
    case 'E3-L5-T4': return { B3: 30, I4: '=COUNTIFS(E3L5_EditLog!D2:D61,"R07")', I5: ' cat ' };
    default: return base;
  }
}

/** 常見錯誤：{ name, inputs, maxEarned, codes } */
export function wrongCases(taskId, dataset) {
  const base = correctInputs(taskId, dataset);
  const ref = (n, tid) => solveReference(dataset.levels[n], n, tid);
  const T1SORT = { ops: [{ keys: [{ col: 'H', dir: 'desc' }] }] };
  const T2SORT = LEVEL_BY_NUM[1].referenceMeta['E3-L1-T2']['!SORT'];
  switch (taskId) {
    case 'E3-L1-T1': return [
      { name: '只排序 WaitMin 一欄（資料列被拆散）', inputs: { ...base, '!SORT': { ops: [{ keys: [{ col: 'H', dir: 'desc' }], cols: ['H'] }] } }, maxEarned: 0, codes: ['ROWS_BROKEN'] },
      { name: '由小至大排序', inputs: { ...base, '!SORT': { ops: [{ keys: [{ col: 'H', dir: 'asc' }] }] } }, maxEarned: 0, codes: ['SORT_DIRECTION'] },
      { name: '直接輸入答案', inputs: { ...base, J2: ref(1, taskId).J2, J3: ref(1, taskId).J3 }, maxEarned: 1, codes: ['FORMULA_REQUIRED'] },
      { name: '沒有排序', inputs: { ...base, '!SORT': { ops: [] } }, maxEarned: 0, codes: ['NOT_SORTED'] },
    ];
    case 'E3-L1-T2': return [
      { name: '只按 Category 排序', inputs: { ...base, '!SORT': { ops: [{ keys: [{ col: 'E', dir: 'asc' }] }] } }, maxEarned: 1, codes: ['SORT_LEVELS'] },
      { name: '逐次排序的次序相反', inputs: { ...base, '!SORT': { ops: [{ keys: [{ col: 'E', dir: 'asc' }] }, { keys: [{ col: 'F', dir: 'desc' }] }, { keys: [{ col: 'B', dir: 'asc' }] }] } }, maxEarned: 1, codes: ['SORT_KEY_WRONG'] },
      { name: '直接輸入編號', inputs: { ...base, J4: ref(1, taskId).J4 }, maxEarned: 1, codes: ['HARDCODED_TEXT'] },
    ];
    case 'E3-L1-T3': return [
      { name: '只篩選 Caller', inputs: { ...base, '!FILTER': { crit: { G: { values: ['UNCLE-WONG'] } } } }, maxEarned: 0, codes: ['FILTER_ONE_CONDITION'] },
      { name: '用 COUNTA／SUM（計算了隱藏列）', inputs: { ...base, J5: '=COUNTA(A2:A121)', J6: '=SUM(H2:H121)' }, maxEarned: 1, codes: ['SUBTOTAL_NEEDED'] },
      { name: '逐一勾選投訴編號', inputs: (() => { const wb = buildLevelWorkbook(dataset.levels[1], 1, { '!SORT': T2SORT }); const ids = []; for (let r = 2; r <= 121; r++) if (wb.getValue('E3L1_Complaints', `G${r}`) === 'UNCLE-WONG' && wb.getValue('E3L1_Complaints', `E${r}`) === 'DATA') ids.push(wb.getValue('E3L1_Complaints', `A${r}`)); return { ...base, '!FILTER': { crit: { A: { values: ids } } } }; })(), maxEarned: 0, codes: ['FILTER_HARDCODED'] },
      { name: '沒有篩選', inputs: { ...base, '!FILTER': { crit: {} } }, maxEarned: 0, codes: ['NOT_FILTERED'] },
    ];
    case 'E3-L2-T1': return [
      { name: '直接輸入數字', inputs: fill('B', 2, 41, (r) => dataset.levels[2].extra.E3L2_Timetable[`B${r}`]), maxEarned: 0, codes: ['FORMULA_REQUIRED'] },
      { name: '只完成 B2', inputs: { B2: '=E3L2_Timetable!B2' }, maxEarned: 1, codes: ['COPY_INCOMPLETE'] },
    ];
    case 'E3-L2-T2': return [
      { name: '漏「找不到時的值」', inputs: fill('C', 2, 41, (r) => `=XLOOKUP(A${r},E3L2_Log!$A$2:$A$41,E3L2_Log!$B$2:$B$41)`), maxEarned: 1, codes: ['NOT_FOUND_MISSING'] },
      { name: '範圍沒有固定', inputs: fill('C', 2, 41, (r) => `=XLOOKUP(A${r},E3L2_Log!A${r}:A${r + 39},E3L2_Log!B${r}:B${r + 39},"MISSING")`), maxEarned: 1, codes: ['RANGE_NOT_ABSOLUTE'] },
      { name: '按同一列參照（不用 XLOOKUP）', inputs: fill('C', 2, 41, (r) => `=E3L2_Log!B${r}`), maxEarned: 0, codes: ['XLOOKUP_REQUIRED'] },
    ];
    case 'E3-L2-T3': return [
      { name: '用 >=', inputs: fill('D', 2, 41, (r) => `=IF(C${r}="MISSING","MISSING",IF(C${r}-B${r}>=E3L2_Timetable!$F$2,"LATE","OK"))`), maxEarned: 1, codes: ['BOUNDARY_GE'] },
      { name: '寫死容許分鐘', inputs: fill('D', 2, 41, (r) => `=IF(C${r}="MISSING","MISSING",IF(C${r}-B${r}>${dataset.levels[2].extra.E3L2_Timetable.F2},"LATE","OK"))`), maxEarned: 0, codes: ['LIMIT_HARDCODED'] },
      { name: '容許分鐘沒有固定', inputs: fill('D', 2, 41, (r) => `=IF(C${r}="MISSING","MISSING",IF(C${r}-B${r}>E3L2_Timetable!F${r},"LATE","OK"))`), maxEarned: 0, codes: ['LIMIT_NOT_FIXED'] },
      { name: '沒有處理 MISSING', inputs: fill('D', 2, 41, (r) => `=IF(C${r}-B${r}>E3L2_Timetable!$F$2,"LATE","OK")`), maxEarned: 1, codes: ['MISSING_NOT_HANDLED'] },
    ];
    case 'E3-L2-T4': return [
      { name: 'H4 只用 COUNTIF', inputs: { ...base, H4: '=COUNTIF(D2:D41,"LATE")' }, maxEarned: 2, codes: ['COUNTIFS_REQUIRED'] },
      { name: '直接輸入數目', inputs: { ...base, H2: ref(2).H2 }, maxEarned: 2, codes: ['FORMULA_REQUIRED'] },
    ];
    case 'E3-L3-T1': {
      const c = base['!CHARTS'][0];
      return [
        { name: '用柱形圖顯示趨勢', inputs: { '!CHARTS': [{ ...c, type: 'column' }] }, maxEarned: 0, codes: ['CHART_TYPE_TREND'] },
        { name: '包括標題列', inputs: { '!CHARTS': [{ ...c, cats: 'A1:A19', series: [{ name: 'Today', ref: 'D1:D19' }] }] }, maxEarned: 0, codes: ['HEADER_IN_DATA'] },
        { name: 'Hour 被當作數列', inputs: { '!CHARTS': [{ ...c, cats: null, series: [{ name: 'Hour', ref: 'A2:A19' }, { name: 'Today', ref: 'D2:D19' }] }] }, maxEarned: 0, codes: ['HOUR_AS_SERIES'] },
        { name: '沒有座標軸標題', inputs: { '!CHARTS': [{ ...c, xTitle: '', yTitle: '' }] }, maxEarned: 1, codes: ['CHART_TITLES'] },
        { name: '選錯數列（平日）', inputs: { '!CHARTS': [{ ...c, series: [{ name: 'Weekday', ref: 'B2:B19' }] }] }, maxEarned: 0, codes: ['SERIES_WRONG'] },
        { name: '沒有圖表', inputs: { '!CHARTS': [] }, maxEarned: 0, codes: ['NO_CHART'] },
      ];
    }
    case 'E3-L3-T2': {
      const c = base['!CHARTS'].find((x) => x.id === 'C2');
      return [
        { name: '用圓形圖比較', inputs: { '!CHARTS': [{ ...c, type: 'pie' }] }, maxEarned: 0, codes: ['CHART_TYPE_COMPARE'] },
        { name: '沒有圖例', inputs: { '!CHARTS': [{ ...c, legend: false }] }, maxEarned: 1, codes: ['LEGEND_MISSING'] },
        { name: '數列名稱錯誤', inputs: { '!CHARTS': [{ ...c, series: [{ name: '數列 1', ref: 'B2:B19' }, { name: '數列 2', ref: 'C2:C19' }] }] }, maxEarned: 1, codes: ['SERIES_NAMES'] },
        { name: '只有一個數列', inputs: { '!CHARTS': [{ ...c, series: [{ name: 'Weekday', ref: 'B2:B19' }] }] }, maxEarned: 0, codes: ['SERIES_WRONG'] },
      ];
    }
    case 'E3-L3-T3': {
      const r = ref(3);
      return [
        { name: 'G3 直接輸入倍數', inputs: { ...base, G3: r.G3 }, maxEarned: 2, codes: ['FORMULA_REQUIRED'] },
        { name: '高低對調', inputs: { ...base, G2: r.G4, G4: r.G2 }, maxEarned: 1, codes: ['VALUE_WRONG'] },
      ];
    }
    case 'E3-L4-T1': return [
      { name: '列放 Hour', inputs: { ...base, '!PIVOTS': [{ id: 'P1', rows: ['Hour'], cols: [], values: [{ field: 'RecordID', agg: 'COUNT' }], filters: [] }] }, maxEarned: 1, codes: ['PIVOT_FIELDS'] },
      { name: '用 SUM of Cells', inputs: { ...base, '!PIVOTS': [{ id: 'P1', rows: ['Computer'], cols: [], values: [{ field: 'Cells', agg: 'SUM' }], filters: [] }] }, maxEarned: 1, codes: ['PIVOT_AGG'] },
      { name: '沒有樞紐分析表', inputs: { ...base, '!PIVOTS': [] }, maxEarned: 1, codes: ['PIVOT_MISSING'] },
    ];
    case 'E3-L4-T2': return [
      { name: '用 COUNT（紀錄數目）', inputs: { ...base, '!PIVOTS': [{ id: 'P1', rows: ['Hour'], cols: [], values: [{ field: 'Cells', agg: 'COUNT' }], filters: [{ field: 'Computer', values: ['FSM-PC'] }] }] }, maxEarned: 1, codes: ['PIVOT_AGG'] },
      { name: '沒有篩選 FSM-PC', inputs: { ...base, '!PIVOTS': [{ id: 'P1', rows: ['Hour'], cols: [], values: [{ field: 'Cells', agg: 'SUM' }], filters: [] }] }, maxEarned: 1, codes: ['PIVOT_FILTER_MISSING'] },
    ];
    case 'E3-L4-T3': return [
      { name: '沒有樞紐分析圖', inputs: { ...base, '!CHARTS': [] }, maxEarned: 2, codes: ['PIVOT_CHART_MISSING'] },
      { name: '沒有欄（User）', inputs: { ...base, '!PIVOTS': [{ id: 'P3', rows: ['Hour'], cols: [], values: [{ field: 'Cells', agg: 'SUM' }], filters: [{ field: 'Computer', values: ['FSM-PC'] }] }] }, maxEarned: 1, codes: ['PIVOT_FIELDS'] },
    ];
    case 'E3-L5-T1': return [
      { name: '沒有固定 B2／B3', inputs: fill('E', 2, 61, (r) => `=IF(AND(E3L5_EditLog!C${r}="FSM-PC",E3L5_EditLog!B${r}>=B${r},E3L5_EditLog!B${r}<B${r}+B${r + 1}),1,0)`), maxEarned: 0, codes: ['LOCK_NOT_FIXED'] },
      { name: '沒有檢查電腦', inputs: fill('E', 2, 61, (r) => `=IF(AND(E3L5_EditLog!B${r}>=$B$2,E3L5_EditLog!B${r}<$B$2+$B$3),1,0)`), maxEarned: 0, codes: ['COMPUTER_MISSING'] },
      { name: '時間範圍包括 B2+B3（<=）', inputs: fill('E', 2, 61, (r) => `=IF(AND(E3L5_EditLog!C${r}="FSM-PC",E3L5_EditLog!B${r}>=$B$2,E3L5_EditLog!B${r}<=$B$2+$B$3),1,0)`), maxEarned: 1, codes: ['WINDOW_BOUNDARY'] },
      { name: '寫死鎖定分鐘', inputs: fill('E', 2, 61, (r) => `=IF(AND(E3L5_EditLog!C${r}="FSM-PC",E3L5_EditLog!B${r}>=$B$2,E3L5_EditLog!B${r}<$B$2+5),1,0)`), maxEarned: 0, codes: ['WINDOW_REFS'] },
    ];
    case 'E3-L5-T2': return [
      { name: '沒有檢查長度（7777 被當作痕跡）', inputs: fill('F', 2, 61, (r) => `=IF(E3L5_EditLog!F${r}=REPT(LEFT(E3L5_EditLog!F${r},1),LEN(E3L5_EditLog!F${r})),1,0)`), maxEarned: 1, codes: ['LENGTH_MISSING'] },
      { name: '直接輸入 1／0', inputs: fill('F', 2, 61, () => 0), maxEarned: 0, codes: ['FORMULA_REQUIRED'] },
    ];
    case 'E3-L5-T3': return [
      { name: '藍本缺少 15 分鐘', inputs: { ...base, '!SCEN': { changing: ['B3'], result: ['I1'], list: [{ name: 'LOCK5', values: { B3: 5 } }, { name: 'LOCK30', values: { B3: 30 } }] } }, maxEarned: 2, codes: ['SCENARIO_VALUES'] },
      { name: 'I3 不是最少分鐘', inputs: { ...base, I3: 30 }, maxEarned: 2, codes: ['MIN_LOCK_NOT_MIN'] },
      { name: 'I1 沒有同時檢查兩個條件', inputs: { ...base, I1: '=COUNTIF(E2:E61,1)' }, maxEarned: 2, codes: ['WHATIF_WRONG'] },
      { name: '沒有分析藍本', inputs: { ...base, '!SCEN': null }, maxEarned: 2, codes: ['SCENARIO_MISSING'] },
    ];
    case 'E3-L5-T4': return [
      { name: '結論是阿叔', inputs: { ...base, I5: 'UNCLE' }, maxEarned: 2, codes: ['CONCLUSION_UNCLE'] },
      { name: '結論是火箭仔', inputs: { ...base, I5: 'ROCKET' }, maxEarned: 2, codes: ['CONCLUSION_ROCKET'] },
      { name: '用假設而不是實際設定', inputs: { ...base, B3: 5 }, maxEarned: 1, codes: ['ACTUAL_SETTING'] },
      { name: 'I4 直接輸入數目', inputs: { ...base, I4: ref(5).I4 }, maxEarned: 2, codes: ['FORMULA_REQUIRED'] },
    ];
    default: return [];
  }
  void T1SORT;
}
