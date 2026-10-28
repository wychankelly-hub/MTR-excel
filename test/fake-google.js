// 測試用的「假 Google API」：模擬 Drive/Sheets API 的請求格式及回應格式，
// 讓我們可以在沒有憑證的環境驗證 Google Adapter 的邏輯（建立、保護、分享、讀取公式＋數值）。
// ⚠️ 這不能取代真實 Google Sheets 的端到端測試（見 scripts/google-smoke-test.js）。
import { Workbook } from '../server/engine/workbook.js';
import { isError } from '../server/engine/values.js';
import { indexToCol, parseAddr } from '../server/engine/refs.js';

export function makeFakeGoogle() {
  const files = new Map(); // id -> { wb, sheets: [{title, sheetId}], protected: [], permissions: [] }
  let seq = 0;
  const calls = [];
  const parseRange = (r) => {
    const m = /^'?([^'!]+)'?(?:!([A-Z]+\d+)(?::([A-Z]+\d+))?)?$/.exec(r);
    return { sheet: m[1], a: m[2] || null, b: m[3] || null };
  };
  const sheets = {
    spreadsheets: {
      async get({ spreadsheetId }) {
        const f = files.get(spreadsheetId);
        if (!f) throw Object.assign(new Error('not found'), { code: 404 });
        return { data: { sheets: f.sheets.map((s) => ({ properties: { ...s }, protectedRanges: f.protected.filter((p) => p.range.sheetId === s.sheetId) })) } };
      },
      async batchUpdate({ spreadsheetId, requestBody }) {
        const f = files.get(spreadsheetId);
        calls.push({ op: 'batchUpdate', requests: requestBody.requests });
        for (const r of requestBody.requests) {
          if (r.addSheet) { const id = ++seq; f.sheets.push({ title: r.addSheet.properties.title, sheetId: id }); f.wb.addSheet(r.addSheet.properties.title, 1000, 26); }
          if (r.deleteSheet) f.sheets = f.sheets.filter((s) => s.sheetId !== r.deleteSheet.sheetId);
          if (r.addProtectedRange) f.protected.push({ ...r.addProtectedRange.protectedRange, protectedRangeId: ++seq });
          if (r.deleteProtectedRange) f.protected = f.protected.filter((p) => p.protectedRangeId !== r.deleteProtectedRange.protectedRangeId);
          if (r.updateSpreadsheetProperties) f.locale = r.updateSpreadsheetProperties.properties.locale;
        }
        return { data: {} };
      },
      values: {
        async batchClear() { return { data: {} }; },
        async batchUpdate({ spreadsheetId, requestBody }) {
          const f = files.get(spreadsheetId);
          for (const d of requestBody.data) {
            const { sheet, a } = parseRange(d.range);
            const { col, row } = parseAddr(a || 'A1');
            d.values.forEach((rowVals, ri) => rowVals.forEach((v, ci) => {
              const addr = `${indexToCol(col + ci)}${row + ri}`;
              // RAW：以 = 開始的字串仍是文字（我們的資料不會出現這情況）
              f.wb.setInput(sheet, addr, requestBody.valueInputOption === 'RAW' && typeof v === 'string' && v.startsWith('=') ? `'${v}` : v);
            }));
          }
          return { data: {} };
        },
        async update() { return { data: {} }; },
        async batchGet({ spreadsheetId, ranges, valueRenderOption }) {
          const f = files.get(spreadsheetId);
          calls.push({ op: 'batchGet', valueRenderOption });
          const { sheet, a, b } = parseRange(ranges[0]);
          const s = parseAddr(a); const e = parseAddr(b);
          const values = [];
          for (let r = s.row; r <= e.row; r++) {
            const rowVals = [];
            for (let c = s.col; c <= e.col; c++) {
              const addr = `${indexToCol(c)}${r}`;
              if (valueRenderOption === 'FORMULA') rowVals.push(f.wb.getInput(sheet, addr) ?? '');
              else { const v = f.wb.getValue(sheet, addr); rowVals.push(isError(v) ? v.code : v ?? ''); }
            }
            values.push(rowVals);
          }
          return { data: { valueRanges: [{ values }] } };
        },
      },
    },
  };
  const drive = {
    files: {
      async create({ requestBody }) {
        const id = `fakeSheet${String(++seq).padStart(20, '0')}`;
        const wb = new Workbook();
        wb.addSheet('Sheet1', 1000, 26);
        files.set(id, { name: requestBody.name, wb, sheets: [{ title: 'Sheet1', sheetId: 0 }], protected: [], permissions: [{ id: 'p0', emailAddress: 'owner@school.test', role: 'owner' }] });
        return { data: { id } };
      },
    },
    permissions: {
      async create({ fileId, requestBody }) { files.get(fileId).permissions.push({ id: `p${++seq}`, emailAddress: requestBody.emailAddress, role: requestBody.role }); return { data: {} }; },
      async list({ fileId }) { return { data: { permissions: files.get(fileId).permissions } }; },
      async delete({ fileId, permissionId }) { const f = files.get(fileId); f.permissions = f.permissions.filter((p) => p.id !== permissionId); return { data: {} }; },
    },
  };
  return { clients: () => ({ sheets, drive, actor: 'owner@school.test' }), files, calls };
}
