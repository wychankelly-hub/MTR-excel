#!/usr/bin/env node
// 課堂負載測試（HTTP，與真實學生相同的路徑）：一班 30 名學生、6 隊，第二集五關。
// - 學生登入 → 輸入代碼 → 等候 → 老師自動分隊
// - 每關：同隊學生同時在內置工作表輸入（每次送出數格，模擬自動儲存的批次）；部分學生先輸入錯誤再更正；
//   兩名隊友故意同時修改同一格（必須偵測到衝突，不可無聲覆蓋）
// - 提交：先提交錯誤答案、再提交正確答案；同一 Idempotency Key 連按兩次
// - 完成後：老師為全部隊伍重開一題（練習模式），學生練習提交 → 分數及排行榜不變
// 用法：node scripts/class-load-test.js [--students 30] [--teams 6]
//   設定 DATABASE_URL 即使用 PostgreSQL（例如 Neon），否則使用暫存資料夾。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cookieJar } from '../test/cookie-jar.js';

const arg = (k, d) => (process.argv.includes(k) ? Number(process.argv[process.argv.indexOf(k) + 1]) : d);
const STUDENTS = arg('--students', 30);
const TEAMS = arg('--teams', 6);
if (!process.env.DATABASE_URL) process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'taiyau-load-'));
process.env.ALLOW_DEMO_LOGIN = 'true';
process.env.DEMO_TEACHER_PIN ||= '2468';

const { startServer } = await import('../server/index.js');
const { storageInfo } = await import('../server/store.js');
const { LEVELS } = await import('../server/episode2/blueprint.js');
const { correctInputs, wrongCases } = await import('../server/episode2/fixtures.js');
const C = await import('../server/competition.js');
const store = await import('../server/store.js');

const srv = startServer(0);
await new Promise((r) => srv.on('listening', r));
const base = `http://127.0.0.1:${srv.address().port}/api`;

const lat = { edit: [], submit: [], read: [] };
const errors = [];
let conflicts = 0;
let seq = 0;
const key = () => `load-${Date.now()}-${++seq}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function agent(name) {
  const jar = cookieJar();
  return async (method, url, body, kind) => {
    const t0 = performance.now();
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', cookie: jar.header() }, body: body ? JSON.stringify(body) : undefined });
    jar.update(r);
    const json = await r.json().catch(() => null);
    if (kind) lat[kind].push(performance.now() - t0);
    if (r.status >= 500) errors.push(`${name} ${method} ${url} → ${r.status} ${json?.error || ''}`);
    return { status: r.status, body: json };
  };
}

const T = agent('teacher');
await T('POST', '/auth/demo', { role: 'teacher', pin: process.env.DEMO_TEACHER_PIN });
const id = (await T('POST', '/teacher/competitions', { episode: 'E2', teamCount: TEAMS, classCode: 'LOAD', teamSelection: 'teacher' })).body.id;
const tp = (p, b) => T('POST', `/teacher/competitions/${id}${p}`, b);
let t0 = Date.now();
await tp('/generate', {});
console.log(`生成數據及預檢：${Date.now() - t0} ms`);
await tp('/approve');
await tp('/lobby');
const joinCode = (await T('GET', `/teacher/competitions/${id}`)).body.joinCode;

// 學生加入（同時）→ 等候 → 老師自動分隊
const students = await Promise.all(Array.from({ length: STUDENTS }, async (_, i) => {
  const S = agent(`S${i}`);
  await S('POST', '/auth/demo', { role: 'student', name: `Load ${i}` });
  const j = await S('POST', '/student/join', { joinCode });
  if (!j.body?.waiting) errors.push(`S${i} 應在等候名單：${JSON.stringify(j.body)}`);
  return { S, i };
}));
await tp('/auto-assign');
const comp = store.db.state.competitions[id];
const byTeam = Object.fromEntries(comp.teams.map((t) => [t.id, []]));
for (const st of students) {
  const s = (await st.S('GET', '/student/state')).body;
  st.teamId = s.team?.id || s.myTeam?.id || C.teamOfUser(comp, Object.values(store.db.state.users).find((u) => u.name === `Load ${st.i}`)?.id)?.id;
  byTeam[st.teamId].push(st);
}
console.log(`分隊：${Object.values(byTeam).map((x) => x.length).join(' + ')}`);
await tp('/start-episode');

/** 讀取工作表後送出一批修改；有衝突時重新讀取再送（如真實介面） */
async function writeCells(S, sheet, inputs, batch = 6) {
  const entries = Object.entries(inputs);
  for (let k = 0; k < entries.length; k += batch) {
    let part = entries.slice(k, k + batch);
    for (let attempt = 0; part.length && attempt < 5; attempt++) {
      const p = (await S('GET', `/sheet/${sheet}`, null, 'read')).body;
      const ops = part.map(([a, i]) => ({ a, i, base: p.cells[a]?.v ?? 0 }));
      const r = (await S('POST', `/sheet/${sheet}/ops`, { ops }, 'edit')).body;
      if (r?.rejected?.length) errors.push(`被拒絕：${JSON.stringify(r.rejected[0])}`);
      const lost = new Set((r?.conflicts || []).map((c) => c.a));
      conflicts += lost.size;
      part = part.filter(([a]) => lost.has(a));
    }
    await sleep(40 + Math.random() * 120); // 自動儲存的批次間隔
  }
}

const half = (obj, n, k) => Object.fromEntries(Object.entries(obj).filter((_, i) => i % n === k));

for (const lv of LEVELS) {
  await tp(`/levels/${lv.level}/start`);
  t0 = Date.now();
  await Promise.all(Object.entries(byTeam).map(async ([teamId, members]) => {
    const team = comp.teams.find((t) => t.id === teamId);
    const ds = C.getDataset(comp, team);
    const all = Object.assign({}, ...lv.tasks.map((t) => correctInputs(t.id)));
    // 兩名隊友同時修改同一格（衝突測試）
    const focus = lv.tasks[0].focus;
    const [p1, p2] = await Promise.all(members.slice(0, 2).map((m) => m.S('GET', `/sheet/${lv.sheet}`)));
    const [r1, r2] = await Promise.all([
      members[0].S('POST', `/sheet/${lv.sheet}/ops`, { ops: [{ a: focus, i: '=1', base: p1.body.cells[focus]?.v ?? 0 }] }, 'edit'),
      members[1].S('POST', `/sheet/${lv.sheet}/ops`, { ops: [{ a: focus, i: '=2', base: p2.body.cells[focus]?.v ?? 0 }] }, 'edit'),
    ]);
    const c = r1.body.conflicts.length + r2.body.conflicts.length;
    if (c !== 1) errors.push(`${teamId} L${lv.level}：同時修改同一格應有 1 個衝突，實際 ${c}`);
    conflicts += c;
    // 部分隊友先輸入常見錯誤
    const wc = wrongCases(lv.tasks[1]?.id || lv.tasks[0].id, ds)[0];
    if (wc) await writeCells(members[2 % members.length].S, lv.sheet, wc.inputs);
    // 全隊分工輸入正確答案（同時）
    await Promise.all(members.map((m, k) => writeCells(m.S, lv.sheet, half(all, members.length, k))));
    // 每題：先錯後對；同一 Key 連按兩次
    for (const task of lv.tasks) {
      const m = members[task.id.charCodeAt(task.id.length - 1) % members.length];
      const kk = key();
      const [a, b] = await Promise.all([m.S('POST', '/student/submit', { taskId: task.id, idempotencyKey: kk }, 'submit'), m.S('POST', '/student/submit', { taskId: task.id, idempotencyKey: kk }, 'submit')]);
      if (a.body?.status !== 'VERIFIED' && a.body?.status !== 'DUPLICATE') errors.push(`${teamId} ${task.id}：${a.body?.status} ${JSON.stringify(a.body?.errors?.slice(0, 2))}`);
      if (a.body?.submissionId && b.body?.submissionId && a.body.submissionId !== b.body.submissionId) errors.push(`${teamId} ${task.id}：同一 Key 產生兩個提交`);
    }
  }));
  await tp(`/levels/${lv.level}/end`);
  console.log(`L${lv.level} ${lv.title}：${Date.now() - t0} ms`);
}

const view = (await T('GET', `/teacher/competitions/${id}`)).body;
const done = view.scores.filter((s) => s.completedLevels === LEVELS.length).length;
const before = JSON.stringify(view.scores.map((s) => [s.teamId, s.total]));

// 確認工作表內容（已確認的修改）全部在伺服器
for (const [teamId, members] of Object.entries(byTeam)) {
  for (const lv of LEVELS) {
    const p = (await members[0].S('GET', `/sheet/${lv.sheet}`)).body;
    for (const t of lv.tasks) for (const [a, i] of Object.entries(correctInputs(t.id))) {
      if (p.cells[a]?.i !== i) { errors.push(`${teamId} ${lv.sheet}!${a} 應為 ${i}，實際 ${p.cells[a]?.i}`); break; }
    }
  }
}

// 練習（重開）：不改變分數
const ro = (await tp('/reopen', { taskId: 'E2-L1-T1', teamIds: 'all', mode: 'practice' })).body;
const rid = ro.id || ro.reopen?.id || store.db.state.competitions[id].reopens.at(-1).id;
await Promise.all(Object.values(byTeam).map(async (members) => {
  const S = members[0].S;
  const ops = Object.entries(correctInputs('E2-L1-T1')).map(([a, i]) => ({ a, i, base: 0 }));
  const p = (await S('GET', `/practice/${id}/${rid}/sheet`)).body;
  for (const o of ops) o.base = p.cells[o.a]?.v ?? 0;
  await S('POST', `/practice/${id}/${rid}/ops`, { ops }, 'edit');
  const r = (await S('POST', `/practice/${id}/${rid}/submit`, { idempotencyKey: key() }, 'submit')).body;
  if (r?.status !== 'VERIFIED') errors.push(`練習提交：${r?.status}`);
}));
const after = JSON.stringify((await T('GET', `/teacher/competitions/${id}`)).body.scores.map((s) => [s.teamId, s.total]));
if (before !== after) errors.push('練習提交改變了分數');

const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(0) : '—'; };
const info = storageInfo();
console.log('\n===== 結果 =====');
console.log(`學生 ${STUDENTS}、隊伍 ${TEAMS}、儲存：${info.driver}`);
console.log(`修改請求 ${lat.edit.length}：p50 ${pct(lat.edit, 0.5)} ms、p95 ${pct(lat.edit, 0.95)} ms、最慢 ${pct(lat.edit, 1)} ms`);
console.log(`提交請求 ${lat.submit.length}：p50 ${pct(lat.submit, 0.5)} ms、p95 ${pct(lat.submit, 0.95)} ms、最慢 ${pct(lat.submit, 1)} ms`);
console.log(`讀取工作表 ${lat.read.length}：p50 ${pct(lat.read, 0.5)} ms、p95 ${pct(lat.read, 0.95)} ms`);
console.log(`偵測到的衝突（沒有無聲覆蓋）：${conflicts}`);
console.log(`五關全部完成的隊伍：${done}/${TEAMS}`);
console.log(`練習提交後分數不變：${before === after ? '是' : '否'}`);
console.log(`資料庫寫入：${info.usage.writes} 次、${info.usage.cellsWritten} 格、${info.usage.mbWritten} MB`);
console.log(`伺服器錯誤／不變量失敗：${errors.length}`);
for (const e of errors.slice(0, 20)) console.log('  ✗', e);
srv.stop();
process.exit(errors.length || done !== TEAMS ? 1 : 0);
