// 測試共用工具：每個測試檔使用獨立的暫存資料夾。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'taiyau-test-'));
process.env.ALLOW_DEMO_LOGIN = 'true';
process.env.DEMO_TEACHER_PIN = '2468';

const store = await import('../server/store.js');
const auth = await import('../server/auth.js');
const C = await import('../server/competition.js');
const { submitTask } = await import('../server/submission.js');
const { clock } = await import('../server/clock.js');

export { store, auth, C, submitTask, clock };

let n = 0;
export function teacher(name = 'T') {
  return auth.loginDemo({ role: 'teacher', pin: '2468', name });
}
export function student(name) {
  return auth.loginDemo({ role: 'student', name: name || `S${++n}` });
}

/** 建立已批准、已開放大堂的 Demo 比賽，並按 perTeam 加入學生 */
export async function readyCompetition({ teamCount = 6, perTeam = 3, bonusEnabled = false, levelSeconds, lockOnComplete = false } = {}) {
  const t = teacher();
  const comp = C.createCompetition(t, { teamCount, bonusEnabled, levelSeconds, lockOnComplete });
  C.generate(comp, t);
  await C.approve(comp, t);
  C.openLobby(comp, t);
  const students = {};
  for (const team of comp.teams) {
    students[team.id] = [];
    for (let i = 0; i < perTeam; i++) {
      const s = student(`${team.code}${i}${++n}`);
      await C.joinTeam(s, comp.joinCode, team.id);
      students[team.id].push(s);
    }
  }
  return { t, comp, students };
}

let keySeq = 0;
export const key = () => `test-key-${Date.now()}-${++keySeq}`;

/** 在 Demo 工作表輸入（相當於學生在 Google Sheets 輸入） */
export function typeInto(comp, team, level, inputs) {
  const sheet = { 1: 'L1_Fare', 2: 'L2_Crowd', 3: 'L3_Queue', 4: 'L4_LostFound', 5: 'L5_Announcement' }[level];
  C.adapters.demo.applyEdits(comp, team, sheet, Object.entries(inputs).map(([addr, input]) => ({ addr, input })));
}

export function submit(comp, user, taskId, idempotencyKey = key()) {
  return submitTask(comp, user, { taskId, idempotencyKey });
}
