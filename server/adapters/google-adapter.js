// 真實 Google Sheets Adapter（Drive API + Sheets API）。
// - 為每隊建立獨立 Spreadsheet（或使用老師預先建立並分享的 Sheet ID）
// - 寫入數據、設定保護範圍（只開放作答範圍）、只分享給該隊成員
// - 提交時以 valueRenderOption=FORMULA 及 UNFORMATTED_VALUE 讀取公式字串與計算結果
// 標準答案及隱藏測試永遠不會寫入工作簿。
import fs from 'node:fs';
import { OAuth2Client, GoogleAuth } from 'google-auth-library';
import { sheets as sheetsApi } from '@googleapis/sheets';
import { drive as driveApi } from '@googleapis/drive';
import { config } from '../config.js';
import { db } from '../store.js';
import { LEVELS, SERIES_TITLE } from '../episode1/blueprint.js';
import { expandRange, parseAddr, indexToCol } from '../engine/refs.js';
import { startSheetLines } from './start-sheet.js';

export const OAUTH_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/drive.file'];
const SA_SCOPES = ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/spreadsheets'];

export class SheetSyncError extends Error {
  constructor(message, { retryable = true, code = 'SYNC_FAILED', cause } = {}) {
    super(message);
    this.retryable = retryable;
    this.code = code;
    this.cause = cause;
  }
}

export function oauthClient() {
  return new OAuth2Client(config.googleClientId, config.googleClientSecret, `${config.publicBaseUrl}/api/google/callback`);
}

/** 目前可用的 Google 憑證：老師 OAuth（優先）或 Service Account */
export function googleCredentialStatus() {
  if (db.state.googleOAuth?.refreshToken && config.googleClientSecret) return { mode: 'oauth', actor: db.state.googleOAuth.email, ready: true };
  if (config.googleServiceAccountKeyFile && fs.existsSync(config.googleServiceAccountKeyFile)) {
    try {
      const key = JSON.parse(fs.readFileSync(config.googleServiceAccountKeyFile, 'utf8'));
      return { mode: 'service_account', actor: key.client_email, ready: true };
    } catch {
      return { mode: 'service_account', ready: false, reason: 'Service Account 金鑰檔案無法讀取' };
    }
  }
  return { mode: null, ready: false, reason: '尚未連接 Google（老師 OAuth 或 Service Account）' };
}

function defaultClients() {
  const st = googleCredentialStatus();
  if (!st.ready) throw new SheetSyncError(`Google Sheets 未連接：${st.reason}`, { retryable: false, code: 'GOOGLE_NOT_CONNECTED' });
  let auth;
  if (st.mode === 'oauth') {
    auth = oauthClient();
    auth.setCredentials({ refresh_token: db.state.googleOAuth.refreshToken });
  } else {
    auth = new GoogleAuth({ keyFile: config.googleServiceAccountKeyFile, scopes: SA_SCOPES });
  }
  return { sheets: sheetsApi({ version: 'v4', auth }), drive: driveApi({ version: 'v3', auth }), actor: st.actor };
}

function explain(err, action) {
  const status = err?.code || err?.response?.status;
  const msg = err?.errors?.[0]?.message || err?.message || String(err);
  if (status === 403) return new SheetSyncError(`${action}失敗：Google 拒絕存取（權限不足或學校 Workspace 政策限制）。${msg}`, { retryable: false, code: 'GOOGLE_FORBIDDEN', cause: err });
  if (status === 404) return new SheetSyncError(`${action}失敗：找不到工作表（可能已被刪除或未分享給系統帳戶）。`, { retryable: false, code: 'GOOGLE_NOT_FOUND', cause: err });
  if (status === 429) return new SheetSyncError(`${action}失敗：Google API 配額暫時用盡，請稍後重試。`, { retryable: true, code: 'GOOGLE_RATE_LIMIT', cause: err });
  return new SheetSyncError(`${action}失敗：${msg}`, { retryable: true, code: 'GOOGLE_ERROR', cause: err });
}

function gridRange(sheetId, spec) {
  const [a, b] = spec.split(':');
  const s = parseAddr(a);
  const e = b ? parseAddr(b) : s;
  return { sheetId, startRowIndex: s.row - 1, endRowIndex: e.row, startColumnIndex: s.col - 1, endColumnIndex: e.col };
}

function a1Range(lv) {
  return `'${lv.sheet}'!A1:${indexToCol(lv.maxCol)}${lv.maxRow}`;
}

/** 把 2D values 轉成 { A1: value } */
export function gridToCells(rows) {
  const out = {};
  (rows || []).forEach((row, ri) => row.forEach((v, ci) => {
    if (v === '' || v === null || v === undefined) return;
    out[`${indexToCol(ci + 1)}${ri + 1}`] = v;
  }));
  return out;
}

export class GoogleAdapter {
  constructor(getDataset, { clients } = {}) {
    this.getDataset = getDataset;
    this.clientsFactory = clients || defaultClients;
    this.injected = !!clients;
    this.name = 'google';
    this.isReal = true;
  }

  clients() { return this.clientsFactory(); }

  credentials() { return this.injected ? { ready: true, mode: 'injected' } : googleCredentialStatus(); }

  /**
   * 建立／填充一隊的 Spreadsheet。
   * existingFileId：老師預先建立並分享給系統帳戶的 Sheet（最少授權替代流程）。
   */
  async provision(comp, team, { memberEmails = [], existingFileId = null } = {}) {
    const { sheets, drive, actor } = this.clients();
    const ds = this.getDataset(comp, team);
    let fileId = existingFileId;
    try {
      if (!fileId) {
        const created = await drive.files.create({
          requestBody: {
            name: `${SERIES_TITLE} E1 · ${comp.classCode || comp.title} · ${team.name} ${team.code}`,
            mimeType: 'application/vnd.google-apps.spreadsheet',
            ...(config.googleDriveFolderId ? { parents: [config.googleDriveFolderId] } : {}),
          },
          supportsAllDrives: true,
          fields: 'id',
        });
        fileId = created.data.id;
      }
      const meta = await sheets.spreadsheets.get({ spreadsheetId: fileId, fields: 'sheets(properties(sheetId,title),protectedRanges(protectedRangeId))' });
      const existing = meta.data.sheets || [];
      const wanted = ['START', ...LEVELS.map((l) => l.sheet)];
      const reqs = [{ updateSpreadsheetProperties: { properties: { locale: 'en_US', timeZone: 'Asia/Hong_Kong' }, fields: 'locale,timeZone' } }];
      // 先移除舊保護（重新填充時）
      for (const s of existing) for (const p of s.protectedRanges || []) reqs.push({ deleteProtectedRange: { protectedRangeId: p.protectedRangeId } });
      wanted.forEach((title, index) => {
        if (!existing.some((s) => s.properties.title === title)) reqs.push({ addSheet: { properties: { title, index } } });
      });
      await sheets.spreadsheets.batchUpdate({ spreadsheetId: fileId, requestBody: { requests: reqs } });
      const meta2 = await sheets.spreadsheets.get({ spreadsheetId: fileId, fields: 'sheets(properties(sheetId,title))' });
      const ids = Object.fromEntries(meta2.data.sheets.map((s) => [s.properties.title, s.properties.sheetId]));
      const extra = meta2.data.sheets.filter((s) => !wanted.includes(s.properties.title));
      if (extra.length) {
        await sheets.spreadsheets.batchUpdate({ spreadsheetId: fileId, requestBody: { requests: extra.map((s) => ({ deleteSheet: { sheetId: s.properties.sheetId } })) } });
      }
      await sheets.spreadsheets.values.batchClear({ spreadsheetId: fileId, requestBody: { ranges: wanted.map((t) => `'${t}'`) } });

      // 數據：RAW（保持 "06:00"、"12:35" 等為文字；TRUE/FALSE 為真正布林）
      const raw = [{ range: `'START'!A1`, values: startSheetLines(comp, team).map((l) => [l]) }];
      const formulas = [];
      for (const lv of LEVELS) {
        const d = ds.levels[lv.level];
        for (const [a, v] of Object.entries(d.data)) raw.push({ range: `'${lv.sheet}'!${a}`, values: [[v]] });
        for (const [a, v] of Object.entries(d.initial)) formulas.push({ range: `'${lv.sheet}'!${a}`, values: [[v]] });
      }
      await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: fileId, requestBody: { valueInputOption: 'RAW', data: raw } });
      if (formulas.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: fileId, requestBody: { valueInputOption: 'USER_ENTERED', data: formulas } });

      // 保護：整張工作表受保護，只開放作答範圍；作答格以淡黃色標示
      const prot = [
        { addProtectedRange: { protectedRange: { range: { sheetId: ids.START }, description: 'START（唯讀）', warningOnly: false, editors: { users: [actor].filter(Boolean) } } } },
      ];
      for (const lv of LEVELS) {
        prot.push({
          addProtectedRange: {
            protectedRange: {
              range: { sheetId: ids[lv.sheet] },
              unprotectedRanges: lv.editable.map((r) => gridRange(ids[lv.sheet], r)),
              description: `${lv.sheet} 原始數據（只可編輯作答範圍 ${lv.editable.join(', ')}）`,
              warningOnly: false,
              editors: { users: [actor].filter(Boolean) },
            },
          },
        });
        prot.push({ repeatCell: { range: gridRange(ids[lv.sheet], `A1:${indexToCol(lv.maxCol)}1`), cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } });
        for (const r of lv.editable) {
          prot.push({ repeatCell: { range: gridRange(ids[lv.sheet], r), cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 0.97, blue: 0.8 } } }, fields: 'userEnteredFormat.backgroundColor' } });
        }
      }
      await sheets.spreadsheets.batchUpdate({ spreadsheetId: fileId, requestBody: { requests: prot } });

      const shared = [];
      for (const email of memberEmails) {
        await this.share({ fileId }, email);
        shared.push(email);
      }
      return { provider: 'google', fileId, url: `https://docs.google.com/spreadsheets/d/${fileId}/edit`, status: 'READY', sharedWith: shared, provisionedAt: Date.now(), sheetIds: ids };
    } catch (e) {
      if (e instanceof SheetSyncError) throw e;
      throw explain(e, '建立工作表');
    }
  }

  async share(workbook, email) {
    const { drive } = this.clients();
    try {
      await drive.permissions.create({ fileId: workbook.fileId, supportsAllDrives: true, sendNotificationEmail: false, requestBody: { type: 'user', role: 'writer', emailAddress: email } });
    } catch (e) {
      throw explain(e, `分享工作表給 ${email} `);
    }
  }

  async unshare(workbook, email) {
    const { drive } = this.clients();
    try {
      const list = await drive.permissions.list({ fileId: workbook.fileId, supportsAllDrives: true, fields: 'permissions(id,emailAddress,role)' });
      for (const p of list.data.permissions || []) {
        if (p.emailAddress?.toLowerCase() === email.toLowerCase() && p.role !== 'owner') {
          await drive.permissions.delete({ fileId: workbook.fileId, permissionId: p.id, supportsAllDrives: true });
        }
      }
    } catch (e) {
      throw explain(e, `移除 ${email} 的工作表權限`);
    }
  }

  /** 讀取某關工作表的公式字串與計算後數值（提交時使用） */
  async readLevel(comp, team, levelNum) {
    const { sheets } = this.clients();
    const lv = LEVELS.find((l) => l.level === levelNum);
    const fileId = team.workbook?.fileId;
    if (!fileId) throw new SheetSyncError('這一隊尚未連接 Google Sheet，請通知老師。', { retryable: false, code: 'NO_WORKBOOK' });
    let f; let v;
    try {
      [f, v] = await Promise.all([
        sheets.spreadsheets.values.batchGet({ spreadsheetId: fileId, ranges: [a1Range(lv)], valueRenderOption: 'FORMULA' }),
        sheets.spreadsheets.values.batchGet({ spreadsheetId: fileId, ranges: [a1Range(lv)], valueRenderOption: 'UNFORMATTED_VALUE' }),
      ]);
    } catch (e) {
      const status = e?.code || e?.response?.status;
      if (status === 400 && /Unable to parse range/i.test(e?.message || '')) {
        return { provider: 'google', readAt: Date.now(), cells: {}, sheetMissing: true };
      }
      throw explain(e, '讀取 Google Sheet ');
    }
    const formulas = gridToCells(f.data.valueRanges?.[0]?.values);
    const values = gridToCells(v.data.valueRanges?.[0]?.values);
    const cells = {};
    const addrs = new Set([...Object.keys(formulas), ...Object.keys(values), ...lv.editable.flatMap(expandRange)]);
    for (const a of addrs) cells[a] = { input: formulas[a] ?? null, value: values[a] ?? null };
    return { provider: 'google', readAt: Date.now(), cells };
  }

  /** 賽後匯出結果到新的 Google Sheet */
  async exportResults(comp, rows) {
    const { sheets, drive } = this.clients();
    try {
      const created = await drive.files.create({
        requestBody: { name: `${SERIES_TITLE} E1 結果 · ${comp.classCode || comp.title}`, mimeType: 'application/vnd.google-apps.spreadsheet', ...(config.googleDriveFolderId ? { parents: [config.googleDriveFolderId] } : {}) },
        supportsAllDrives: true,
        fields: 'id',
      });
      const id = created.data.id;
      await sheets.spreadsheets.values.update({ spreadsheetId: id, range: 'A1', valueInputOption: 'RAW', requestBody: { values: rows } });
      return `https://docs.google.com/spreadsheets/d/${id}/edit`;
    } catch (e) {
      throw explain(e, '匯出結果');
    }
  }
}
