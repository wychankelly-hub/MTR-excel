// START 工作表內容（中文操作說明，唯讀）。不含任何答案或 Seed 運算規則。
import { SERIES_TITLE, EPISODE_TITLE, TEMPLATE_VERSION, LEVELS } from '../episode1/blueprint.js';

export function startSheetLines(comp, team) {
  return [
    `${SERIES_TITLE} ${EPISODE_TITLE}`,
    `隊伍：${team.name}（${team.code}）`,
    `Challenge Version：${TEMPLATE_VERSION}`,
    '',
    '操作說明：',
    '1. 只可以在作答範圍輸入公式；原始數據及設定儲存格已受保護。',
    '2. 所有答案只需要英文、數字、符號及公式，不需要輸入中文字。',
    '3. 完成後回到比賽網站，按該題的「檢查／提交」按鈕。網站會讀取你們的工作表並批改。',
    '4. 請不要刪除或重新命名工作表，亦不要插入／刪除列或欄。',
    '5. 老師開始某一關後，網站才會顯示該關的任務。',
    '',
    '關卡：',
    ...LEVELS.map((l) => `L${l.level}  ${l.sheet}  ${l.title}`),
  ];
}
