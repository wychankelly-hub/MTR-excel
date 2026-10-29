// 內置工作表 Adapter（舊比賽的 adapter 名稱為 'demo'，新比賽為 'builtin'，兩者相同）。
// 工作表存放在伺服器（逐格儲存於資料庫），使用與批改相同的公式引擎；學生不需要開啟 Google Sheets。
import { expandRange } from '../engine/refs.js';
import { HttpError } from '../auth.js';
import * as sheets from '../sheets.js';

export { shiftInput, normalizeInput, serializeValue } from '../sheets.js';

export class DemoAdapter {
  constructor(getDataset) {
    this.getDataset = getDataset;
    this.name = 'builtin';
    this.isReal = true;
  }

  build(comp, team, layer = sheets.MAIN) {
    return sheets.workbookFor(comp, team, layer);
  }

  async provision(comp, team) {
    // 批准數據時建立：清除舊作答並放入起始內容
    sheets.resetTeam(comp, team);
    return { provider: 'builtin', fileId: `builtin-${comp.id}-${team.id}`, url: null, status: 'READY', provisionedAt: Date.now() };
  }

  forget(comp) {
    sheets.forgetWorkbooks(comp.id);
  }

  /** 舊介面：伺服器計算後的顯示值 */
  sheetView(comp, team, sheetName, { unlockedLevels, layer = sheets.MAIN }) {
    if (sheetName !== 'START') {
      const lv = comp && this.levelOf(comp, sheetName);
      if (!lv) throw new HttpError(404, '沒有此工作表。');
      if (!unlockedLevels.includes(lv.level)) throw new HttpError(403, '此關尚未開始。', 'LEVEL_LOCKED');
    }
    return sheets.legacySheetView(comp, team, sheetName, layer);
  }

  levelOf(comp, sheetName) {
    return sheets.levelForSheet(comp, sheetName);
  }

  /** 舊介面：沒有版本號的修改（最後寫入為準）；仍然只可修改目前開放的作答格 */
  applyEdits(comp, team, sheetName, edits, user = null) {
    const ops = edits.map(({ addr, input }) => ({ a: String(addr).toUpperCase(), i: input }));
    const r = sheets.applyOps(comp, team, user, sheetName, sheets.MAIN, ops, { force: true });
    if (r.rejected.length) {
      const lv = this.levelOf(comp, sheetName);
      const first = r.rejected[0];
      const msg = first.code === 'PROTECTED'
        ? `${first.a} 是受保護的原始資料，不可修改。只可以編輯作答範圍：${lv.editable.join('、')}。`
        : `${first.a} 現在不可編輯（題目未開放、已完成或比賽暫停中）。`;
      throw new HttpError(403, msg, first.code === 'PROTECTED' ? 'PROTECTED_CELL' : 'LOCKED_CELL');
    }
    return r;
  }

  /** 複製／貼上（或向下填充）：相對參照自動位移 */
  copyPaste(comp, team, sheetName, source, target, user = null) {
    expandRange(source);
    const ops = sheets.pasteOps(comp, team, sheetName, sheets.MAIN, source, target);
    return this.applyEdits(comp, team, sheetName, ops.map((o) => ({ addr: o.a, input: o.i })), user);
  }

  /** 提交時讀取快照：公式字串 + 計算後數值 */
  async readLevel(comp, team, levelNum, layer = sheets.MAIN) {
    return sheets.readLevelSnapshot(comp, team, levelNum, layer);
  }
}
