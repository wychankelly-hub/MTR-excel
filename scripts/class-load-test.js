#!/usr/bin/env node
// 課堂負載測試（HTTP，與真實學生相同的路徑）：一班 30 名學生、6 隊，第二集五關。
// - 學生登入 → 輸入代碼 → 等候 → 老師自動分隊
// - 每關：同隊學生同時在內置工作表輸入（每次送出數格，模擬自動儲存的批次）；部分學生先輸入錯誤再更正；
//   兩名隊友故意同時修改同一格（必須偵測到衝突，不可無聲覆蓋）
// - 提交：先提交錯誤答案、再提交正確答案；同一 Idempotency Key 連按兩次
// - 完成後：老師為全部隊伍重開一題（練習模式），學生練習提交 → 分數及排行榜不變
// 預設開啟隨機 Driver：每題只有 Driver 輸入及提交，其餘隊員在隊伍對話提出公式（亦嘗試直接修改，必須被拒絕）；
// 全部學生保持即時連線（SSE），檢查對話只送到同一隊。--no-driver 測試舊模式（全隊同時輸入）。
// 用法：node scripts/class-load-test.js [--students 30] [--teams 6] [--no-driver]
//   設定 DATABASE_URL 即使用 PostgreSQL（例如 Neon），否則使用暫存資料夾。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cookieJar } from '../test/cookie-jar.js';

const arg = (k, d) => (process.argv.includes(k) ? Number(process.argv[process.argv.indexOf(k) + 1]) : d);
const STUDENTS = arg('--students', 30);
const TEAMS = arg('--teams', 6);
const DRIVER = !process.argv.includes('--no-driver'); // 預設使用隨機 Driver＋隊伍對話
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

const lat = { edit: [], submit: [], read: [], chat: [] };
let blocked = 0;
let chatSent = 0;
let rateLimited = 0;
const errors = [];
let conflicts = 0;
let seq = 0;
const key = () => `load-${Date.now()}-${++seq}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function agent(name) {
  const jar = cookieJar();
  const fn = async (method, url, body, kind) => {
    const t0 = performance.now();
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', cookie: jar.header() }, body: body ? JSON.stringify(body) : undefined });
    jar.update(r);
    const json = await r.json().catch(() => null);
    if (kind) lat[kind].push(performance.now() - t0);
    if (r.status >= 500) errors.push(`${name} ${method} ${url} → ${r.status} ${json?.error || ''}`);
    return { status: r.status, body: json };
  };
  fn.jar = jar;
  return fn;
}

/** 學生的即時連線（SSE）：記錄收到的對話 */
function openStream(jarHeader, onEvent) {
  const ctrl = new AbortController();
  (async () => {
    try {
      const r = await fetch(`${base}/stream?role=student`, { headers: { cookie: jarHeader() }, signal: ctrl.signal });
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /^event: (.*)$/m.exec(chunk)?.[1];
          const data = /^data: (.*)$/m.exec(chunk)?.[1];
          if (ev && data) onEvent(ev, JSON.parse(data));
        }
      }
    } catch { /* 已關閉 */ }
  })();
  return () => ctrl.abort();
}

const T = agent('teacher');
await T('POST', '/auth/demo', { role: 'teacher', pin: process.env.DEMO_TEACHER_PIN });
const id = (await T('POST', '/teacher/competitions', { episode: 'E2', teamCount: TEAMS, classCode: 'LOAD', teamSelection: 'teacher', randomDriver: DRIVER })).body.id;
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
  st.uid = s.me.id;
  st.chatGot = [];
  byTeam[st.teamId].push(st);
}
console.log(`分隊：${Object.values(byTeam).map((x) => x.length).join(' + ')}`);
// 全部學生保持即時連線（在線的學生才會被選為 Driver；對話經即時連線送達）
const closers = students.map((st) => openStream(st.S.jar.header, (ev, d) => { if (ev === 'chat' && d.type === 'message') st.chatGot.push(d.message); }));
await sleep(500);
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

/** 隨機 Driver：逐題由 Driver 作答，其餘隊員在對話提出建議 */
async function driverTask(teamId, members, lv, task, ds) {
  const st = (await members[0].S('GET', '/student/state', null, 'read')).body;
  if (st.driver?.taskId !== task.id) { errors.push(`${teamId}：目前題目應為 ${task.id}，實際 ${st.driver?.taskId}`); return; }
  const drv = members.find((m) => m.uid === st.driver.driver?.id);
  if (!drv) { errors.push(`${teamId} ${task.id}：沒有 Driver`); return; }
  const others = members.filter((m) => m !== drv);
  const sample = Object.entries(correctInputs(task.id))[0];
  // 隊友：在對話提出公式；其中一人嘗試直接修改（必須被拒絕）
  await Promise.all(others.map(async (m, k) => {
    await sleep(900 + Math.random() * 700); // 學生閱讀題目、輸入訊息需要時間（亦低於每人的發送頻率限制）
    const r = await m.S('POST', '/chat', { text: `${task.id} 試試 ${sample[1]}（${k}）`, taskId: task.id, clientId: `ld-${m.i}-${task.id}` }, 'chat');
    if (r.status === 429) rateLimited += 1; // 防洗版限制（機械人遠比真實學生快）
    else if (r.status !== 200) errors.push(`對話失敗 ${r.status} ${r.body?.error}`);
    else chatSent += 1;
    if (k === 0) {
      const p = (await m.S('GET', `/sheet/${lv.sheet}`, null, 'read')).body;
      const w = (await m.S('POST', `/sheet/${lv.sheet}/ops`, { ops: [{ a: sample[0], i: sample[1], base: p.cells[sample[0]]?.v ?? 0 }] }, 'edit')).body;
      if (w.applied.length || w.rejected[0]?.code !== 'NOT_DRIVER') errors.push(`${teamId} ${task.id}：非 Driver 的修改沒有被拒絕`); else blocked += 1;
      const sub = await m.S('POST', '/student/submit', { taskId: task.id, idempotencyKey: key() }, 'submit');
      if (sub.status !== 403) errors.push(`${teamId} ${task.id}：非 Driver 提交沒有被拒絕（${sub.status}）`); else blocked += 1;
    }
  }));
  // Driver：第一題先輸入常見錯誤並提交，再更正
  const wc = task === lv.tasks[0] ? wrongCases(task.id, ds)[0] : null;
  if (wc) {
    await writeCells(drv.S, lv.sheet, wc.inputs);
    const w = await drv.S('POST', '/student/submit', { taskId: task.id, idempotencyKey: key() }, 'submit');
    if (w.body?.status === 'VERIFIED' && w.body.earned === task.points) errors.push(`${teamId} ${task.id}：錯誤答案得到滿分`);
  }
  await writeCells(drv.S, lv.sheet, correctInputs(task.id));
  const kk = key();
  const [a, b] = await Promise.all([drv.S('POST', '/student/submit', { taskId: task.id, idempotencyKey: kk }, 'submit'), drv.S('POST', '/student/submit', { taskId: task.id, idempotencyKey: kk }, 'submit')]);
  if (a.body?.status !== 'VERIFIED') errors.push(`${teamId} ${task.id}：${a.body?.status} ${JSON.stringify(a.body?.errors?.slice(0, 2) || a.body?.error)}`);
  if (a.body?.submissionId && b.body?.submissionId && a.body.submissionId !== b.body.submissionId) errors.push(`${teamId} ${task.id}：同一 Key 產生兩個提交`);
}

for (const lv of LEVELS) {
  await tp(`/levels/${lv.level}/start`);
  t0 = Date.now();
  if (DRIVER) {
    await Promise.all(Object.entries(byTeam).map(async ([teamId, members]) => {
      const ds = C.getDataset(comp, comp.teams.find((t) => t.id === teamId));
      for (const task of lv.tasks) await driverTask(teamId, members, lv, task, ds);
    }));
    await tp(`/levels/${lv.level}/end`);
    console.log(`L${lv.level} ${lv.title}：${Date.now() - t0} ms`);
    continue;
  }
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

// 對話：每名學生收到本隊全部訊息，沒有收到其他隊的訊息；所有隊員都擔任過 Driver
await sleep(300);
let chatLeak = 0; let chatMissing = 0;
for (const [teamId, members] of Object.entries(byTeam)) {
  const teamMsgs = comp.chat.filter((m) => m.teamId === teamId).map((m) => m.id);
  for (const m of members) {
    chatLeak += m.chatGot.filter((x) => x.teamId !== teamId).length;
    const got = new Set(m.chatGot.map((x) => x.id));
    chatMissing += teamMsgs.filter((x) => !got.has(x)).length;
  }
}
if (chatLeak) errors.push(`對話洩漏到其他隊：${chatLeak}`);
if (chatMissing) errors.push(`即時對話未送達：${chatMissing}`);
const turns = {};
if (DRIVER) {
  for (const t of comp.teams) {
    const counts = t.memberIds.map((uid) => Object.values(comp.drivers[t.id].tasks).filter((a) => a.userId === uid).length);
    turns[t.id] = counts;
    if (Math.max(...counts) - Math.min(...counts) > 1) errors.push(`${t.id} Driver 次數不平均：${counts}`);
  }
}
for (const c of closers) c();

const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(0) : '—'; };
const info = storageInfo();
console.log('\n===== 結果 =====');
console.log(`學生 ${STUDENTS}、隊伍 ${TEAMS}、儲存：${info.driver}`);
console.log(`修改請求 ${lat.edit.length}：p50 ${pct(lat.edit, 0.5)} ms、p95 ${pct(lat.edit, 0.95)} ms、最慢 ${pct(lat.edit, 1)} ms`);
console.log(`提交請求 ${lat.submit.length}：p50 ${pct(lat.submit, 0.5)} ms、p95 ${pct(lat.submit, 0.95)} ms、最慢 ${pct(lat.submit, 1)} ms`);
if (DRIVER) {
  console.log(`隊伍對話：送出 ${chatSent} 則、被頻率限制 ${rateLimited} 則（每人 0.8 秒最少一則、20 秒最多 8 則；每隊每分鐘最多 40 則）`);
  console.log(`對話請求 ${lat.chat.length} 次：p50 ${pct(lat.chat, 0.5)} ms、p95 ${pct(lat.chat, 0.95)} ms；即時送達遺漏 ${chatMissing}、洩漏到其他隊 ${chatLeak}`);
  console.log(`非 Driver 的修改／提交被拒絕：${blocked} 次`);
  console.log(`每隊各隊員擔任 Driver 的題數：${Object.entries(turns).map(([t, c]) => `${t} ${c.join('/')}`).join('，')}`);
}
console.log(`讀取工作表 ${lat.read.length}：p50 ${pct(lat.read, 0.5)} ms、p95 ${pct(lat.read, 0.95)} ms`);
console.log(`偵測到的衝突（沒有無聲覆蓋）：${conflicts}`);
console.log(`五關全部完成的隊伍：${done}/${TEAMS}`);
console.log(`練習提交後分數不變：${before === after ? '是' : '否'}`);
console.log(`資料庫寫入：${info.usage.writes} 次、${info.usage.cellsWritten} 格、${info.usage.mbWritten} MB`);
console.log(`伺服器錯誤／不變量失敗：${errors.length}`);
for (const [e, n] of Object.entries(errors.reduce((o, x) => { const k = x.replace(/[0-9a-f]{6,}|\d+/g, '#'); o[k] = (o[k] || 0) + 1; return o; }, {})).slice(0, 20)) console.log(`  ✗ ${e}${n > 1 ? `（×${n}）` : ''}`);
srv.stop();
process.exit(errors.length || done !== TEAMS ? 1 : 0);
