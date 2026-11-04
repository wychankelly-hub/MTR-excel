// 第三集 Dataset Preflight：對所有隊伍、所有題目執行正確作答、等價作答、常見錯誤及隱藏測試。
import { TASKS } from './blueprint.js';
import { gradeTask } from './validators.js';
import { correctInputs, equivalentInputs, wrongCases } from './fixtures.js';

export function preflightTeam(dataset) {
  const checks = [];
  for (const t of TASKS) {
    const correct = gradeTask(t.id, correctInputs(t.id, dataset), dataset);
    checks.push({ taskId: t.id, kind: 'correct', name: '參考作答', pass: correct.earned === correct.max, detail: `${correct.earned}/${correct.max} ${correct.errors.map((e) => e.code).join(',')}` });
    const eq = gradeTask(t.id, equivalentInputs(t.id, dataset), dataset);
    checks.push({ taskId: t.id, kind: 'equivalent', name: '等價作答（不同做法）', pass: eq.earned === eq.max, detail: `${eq.earned}/${eq.max} ${eq.errors.map((e) => e.code).join(',')}` });
    for (const w of wrongCases(t.id, dataset)) {
      const r = gradeTask(t.id, w.inputs, dataset);
      const codes = r.errors.map((e) => e.code);
      const pass = r.earned <= w.maxEarned && r.earned < r.max && w.codes.every((c) => codes.includes(c));
      checks.push({ taskId: t.id, kind: 'wrong', name: w.name, pass, detail: `${r.earned}/${r.max} · ${codes.join(',') || '—'}` });
    }
  }
  return { pass: checks.every((c) => c.pass), total: checks.length, failed: checks.filter((c) => !c.pass), checks };
}
