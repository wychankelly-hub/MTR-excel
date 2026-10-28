// Google Sheets Adapter 邏輯測試（使用模擬的 Google API 回應格式）。
// ⚠️ 這證明 Adapter 的請求及解析邏輯；真實帳戶的端到端測試請執行 `npm run google:smoke`。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { C, store, student, submit } from './helpers.js';
import { GoogleAdapter } from '../server/adapters/google-adapter.js';
import { makeFakeGoogle } from './fake-google.js';
import { correctInputs } from '../server/episode1/fixtures.js';
import { LEVELS } from '../server/episode1/blueprint.js';

const fake = makeFakeGoogle();
C.adapters.google = new GoogleAdapter(C.getDataset, { clients: fake.clients });

function googleUser(email, role) {
  const id = `u_google_${email}`;
  store.db.state.users[id] = { id, provider: 'google', email, name: email.split('@')[0], role };
  return store.db.state.users[id];
}

/** 學生在「Google Sheets」輸入（直接改模擬檔案，相當於學生在瀏覽器編輯） */
function typeInGoogle(team, sheet, inputs) {
  const f = fake.files.get(team.workbook.fileId);
  for (const [a, v] of Object.entries(inputs)) f.wb.setInput(sheet, a, v);
}

test('Google 模式：建立兩隊工作表、保護範圍、只分享給該隊、讀取公式＋數值並批改，兩隊互不干擾', async () => {
  const t = googleUser('teacher@school.test', 'teacher');
  const comp = C.createCompetition(t, { adapter: 'google', teamCount: 4 });
  C.generate(comp, t);
  await C.approve(comp, t);
  const a = googleUser('amy@school.test', 'student');
  const b = googleUser('ben@school.test', 'student');
  await C.joinTeam(a, comp.joinCode, 't1');
  await C.joinTeam(b, comp.joinCode, 't2');
  const res = await C.provisionAll(comp, t);
  assert.ok(res.every((r) => r.ok), JSON.stringify(res));
  C.openLobby(comp, t);

  const [t1, t2] = comp.teams;
  assert.notEqual(t1.workbook.fileId, t2.workbook.fileId);
  assert.match(t1.workbook.url, /^https:\/\/docs\.google\.com\/spreadsheets\/d\//);
  const f1 = fake.files.get(t1.workbook.fileId);
  // 分享：只有該隊成員
  assert.ok(f1.permissions.some((p) => p.emailAddress === 'amy@school.test'));
  assert.ok(!f1.permissions.some((p) => p.emailAddress === 'ben@school.test'));
  // Locale 固定、工作表齊全、保護範圍只開放作答格
  assert.equal(f1.locale, 'en_US');
  assert.deepEqual(f1.sheets.map((s) => s.title), ['START', ...LEVELS.map((l) => l.sheet)]);
  const l1 = f1.protected.find((p) => p.description.startsWith('L1_Fare'));
  assert.equal(l1.unprotectedRanges.length, 4);
  assert.equal(l1.warningOnly, false);
  // 標準答案／隱藏測試沒有寫入工作簿
  const allInputs = JSON.stringify([...f1.wb.sheets.values()].map((s) => [...s.cells.values()].map((c) => c.input)));
  assert.ok(!allInputs.includes('$H$1'), '沒有參考公式');
  assert.ok(!allInputs.includes('LUNCH'));
  // 火箭仔的錯誤公式以 USER_ENTERED 寫入（是公式而不是文字）
  assert.equal(f1.wb.getInput('L1_Fare', 'D3'), '=B3*C3*H2');
  // L2 時段及 L4 時間保持文字
  assert.equal(typeof f1.wb.getInput('L2_Crowd', 'A2'), 'string');

  C.startLevel(comp, t, 1);
  typeInGoogle(t1, 'L1_Fare', correctInputs('L1-T1'));
  typeInGoogle(t2, 'L1_Fare', { D2: '=B2*C2*H$1' });
  const r1 = await submit(comp, a, 'L1-T1');
  const r2 = await submit(comp, b, 'L1-T1');
  assert.equal(r1.status, 'VERIFIED');
  assert.equal(r2.status, 'REJECTED');
  // 同時讀取公式（FORMULA）及計算結果（UNFORMATTED_VALUE）
  const renders = fake.calls.filter((c) => c.op === 'batchGet').map((c) => c.valueRenderOption);
  assert.ok(renders.includes('FORMULA') && renders.includes('UNFORMATTED_VALUE'));
  const sub = comp.submissions.find((s) => s.status === 'VERIFIED');
  assert.equal(sub.snapshot.provider, 'google');
  assert.equal(sub.snapshot.inputs.D2, '=B2*C2*$H$1');
  assert.ok(!sub.needsReview, 'Google 計算結果與伺服器引擎一致');

  // 學生修改了保護數據（例如老師暫時解除保護時）→ 完整性錯誤，不扣分
  typeInGoogle(t2, 'L1_Fare', { B2: 99, ...correctInputs('L1-T1') });
  const r3 = await submit(comp, b, 'L1-T1');
  assert.equal(r3.status, 'INTEGRITY_ERROR');
  assert.equal(r3.noPenalty, true);

  // 轉隊：撤銷舊隊權限，分享新隊
  await C.transferStudent(comp, t, b.id, 't1', '分錯隊');
  assert.ok(f1.permissions.some((p) => p.emailAddress === 'ben@school.test'));
  assert.ok(!fake.files.get(t2.workbook.fileId).permissions.some((p) => p.emailAddress === 'ben@school.test'));
});

test('Google 模式：老師預先建立的 Sheet ID（最少授權替代流程）', async () => {
  const t = googleUser('teacher2@school.test', 'teacher');
  const comp = C.createCompetition(t, { adapter: 'google', teamCount: 4 });
  const pre = (await fake.clients().drive.files.create({ requestBody: { name: 'pre' } })).data.id;
  C.setPresetSheet(comp, t, 't1', `https://docs.google.com/spreadsheets/d/${pre}/edit#gid=0`);
  C.generate(comp, t);
  await C.approve(comp, t);
  await C.provisionAll(comp, t);
  assert.equal(comp.teams[0].workbook.fileId, pre);
  assert.equal(comp.teams[0].workbook.status, 'READY');
});

test('Google 模式：Demo 帳戶不能加入；未連接 Google 時不能建立工作表', async () => {
  const t = googleUser('teacher3@school.test', 'teacher');
  const comp = C.createCompetition(t, { adapter: 'google', teamCount: 4 });
  C.generate(comp, t);
  await C.approve(comp, t);
  await assert.rejects(() => C.joinTeam(student('DemoKid'), comp.joinCode, 't1'), /Google 帳戶/);
  const saved = C.adapters.google;
  C.adapters.google = new GoogleAdapter(C.getDataset);
  try {
    await assert.rejects(() => C.provisionAll(comp, t), (e) => e.code === 'GOOGLE_NOT_CONNECTED');
  } finally {
    C.adapters.google = saved;
  }
  assert.throws(() => C.createCompetition(student('x'), { adapter: 'google' }));
});
