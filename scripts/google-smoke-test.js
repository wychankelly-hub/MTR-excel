#!/usr/bin/env node
// 真實 Google Sheets 端到端煙霧測試（需要已設定的 Google 憑證）。
// 會：建立 2 隊的正式比賽 → 生成及批准數據 → 在 Google Drive 建立 2 份真實工作表
//   → 經 Sheets API 代替學生輸入公式（一隊正確、一隊錯誤）→ 經正式提交流程讀取及批改
//   → 驗證兩隊互不干擾、批改結果正確、Google 計算值與伺服器引擎一致。
// 用法：
//   npm run google:smoke                       （使用 .env 及 data/state.json 中的 OAuth 連接）
//   SMOKE_SHARE_EMAIL=you@school.edu npm run google:smoke   （另外把工作表分享給該帳戶以便檢查）
//   SMOKE_KEEP=1 ...                           （保留測試比賽紀錄）
import { config } from '../server/config.js';
import { init, db, close } from '../server/store.js';

await init();
const C = await import('../server/competition.js');
const { submitTask } = await import('../server/submission.js');
const { googleCredentialStatus } = await import('../server/adapters/google-adapter.js');
const { correctInputs } = await import('../server/episode1/fixtures.js');

const st = googleCredentialStatus();
if (!st.ready) {
  console.error(`✗ Google 未連接：${st.reason}\n  請先依 docs/SETUP_GOOGLE.md 設定，並在教師控制台「系統狀態」按「連接 Google Drive」，或設定 Service Account。`);
  process.exit(2);
}
console.log(`使用憑證：${st.mode}（${st.actor}）`);

const teacher = { id: 'u_smoke_teacher', provider: 'google', email: st.actor, name: 'Smoke Test', role: 'teacher' };
db.state.users[teacher.id] = teacher;
const mk = (n) => {
  const u = { id: `u_smoke_${n}`, provider: 'google', email: n === 'a' ? (process.env.SMOKE_SHARE_EMAIL || null) : null, name: `Smoke ${n}`, role: 'student' };
  db.state.users[u.id] = u;
  return u;
};
const comp = C.createCompetition(teacher, { adapter: 'google', teamCount: 4, title: 'SMOKE TEST（可刪除）', classCode: 'SMOKE' });
const ok = (c, msg) => { console.log(`${c ? '✓' : '✗'} ${msg}`); if (!c) process.exitCode = 1; };
try {
  C.generate(comp, teacher);
  ok(comp.generation.pass, 'Preflight 通過');
  await C.approve(comp, teacher);
  const a = mk('a'); const b = mk('b');
  await C.joinTeam(a, comp.joinCode, 't1');
  await C.joinTeam(b, comp.joinCode, 't2');
  const res = await C.provisionAll(comp, teacher, { teamIds: ['t1', 't2'] });
  ok(res.every((r) => r.ok), `建立兩份 Google Sheets：${JSON.stringify(res)}`);
  const [t1, t2] = comp.teams;
  console.log(`  t1：${t1.workbook.url}\n  t2：${t2.workbook.url}`);
  for (const t of comp.teams.slice(2)) t.workbook = { provider: 'google', status: 'READY', fileId: null };
  C.openLobby(comp, teacher);
  C.startLevel(comp, teacher, 1);

  const { sheets } = C.adapters.google.clients();
  const write = (fileId, inputs) => sheets.spreadsheets.values.batchUpdate({ spreadsheetId: fileId, requestBody: { valueInputOption: 'USER_ENTERED', data: Object.entries(inputs).map(([k, v]) => ({ range: `'L1_Fare'!${k}`, values: [[v]] })) } });
  await write(t1.workbook.fileId, { ...correctInputs('L1-T1'), ...correctInputs('L1-T2'), ...correctInputs('L1-T3') });
  await write(t2.workbook.fileId, Object.fromEntries(Object.keys(correctInputs('L1-T1')).map((k) => [k, `=B${k.slice(1)}*C${k.slice(1)}*H$1`])));

  for (const id of ['L1-T1', 'L1-T2', 'L1-T3']) {
    const r = await submitTask(comp, a, { taskId: id, idempotencyKey: `smoke-${id}-${Date.now()}` });
    ok(r.status === 'VERIFIED' && !r.needsReview, `t1 ${id}：${r.status} ${r.earned}/${r.max}${r.needsReview ? '（待覆核：引擎與 Google 結果不一致）' : ''}`);
  }
  const r2 = await submitTask(comp, b, { taskId: 'L1-T1', idempotencyKey: `smoke-b-${Date.now()}` });
  ok(r2.status === 'REJECTED' && r2.earned === 1 && r2.errors.some((e) => e.code === 'ABS_REF_PARTIAL'), `t2 L1-T1（H$1）：${r2.status} ${r2.earned}/${r2.max} ${r2.errors.map((e) => e.code).join(',')}`);
  const sub = comp.submissions.find((s) => s.teamId === 't1' && s.status === 'VERIFIED');
  ok(sub.snapshot.provider === 'google' && sub.snapshot.inputs.D2 === '=B2*C2*$H$1', '快照包含從 Google Sheets 讀取的公式字串');

  // 保護範圍：嘗試以「學生」帳戶修改需要學生自己的 OAuth，這裏只檢查設定存在
  const meta = await sheets.spreadsheets.get({ spreadsheetId: t1.workbook.fileId, fields: 'sheets(properties(title),protectedRanges(description,unprotectedRanges))' });
  const prot = meta.data.sheets.find((s) => s.properties.title === 'L1_Fare').protectedRanges?.[0];
  ok(prot && prot.unprotectedRanges?.length === 4, 'L1_Fare 已設定保護，只開放 4 個作答範圍');
  console.log('\n請另外以學生帳戶開啟工作表，確認：只可以編輯黃色作答格；不能看到其他隊的工作表。');
} catch (e) {
  console.error('✗ 測試失敗：', e.message);
  process.exitCode = 1;
} finally {
  if (!process.env.SMOKE_KEEP) { C.cancelCompetition(comp, teacher, 'smoke test'); C.deleteCompetition(comp, teacher); }
  for (const id of ['u_smoke_teacher', 'u_smoke_a', 'u_smoke_b']) delete db.state.users[id];
  await close();
  console.log(process.exitCode ? '\n結果：未通過' : '\n結果：通過（Google Drive 中的 SMOKE 工作表可以手動刪除）');
  void config;
}
