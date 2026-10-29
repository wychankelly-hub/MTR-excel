// 第二集 Dataset Preflight：對所有隊伍、所有題目執行正確公式、等價公式、典型錯誤公式及隱藏測試。
import { TASKS } from './blueprint.js';
import { gradeTask } from './validators.js';
import { correctInputs, equivalentInputs, wrongCases } from './fixtures.js';

export function preflightTeam(dataset) {
  const checks = [];
  for (const t of TASKS) {
    const correct = gradeTask(t.id, correctInputs(t.id), dataset);
    checks.push({ taskId: t.id, kind: 'correct', name: '參考公式', pass: correct.earned === correct.max, detail: `${correct.earned}/${correct.max}` });
    const eq = gradeTask(t.id, equivalentInputs(t.id), dataset);
    checks.push({ taskId: t.id, kind: 'equivalent', name: '等價公式（空格／大小寫／不同寫法）', pass: eq.earned === eq.max, detail: `${eq.earned}/${eq.max}` });
    for (const w of wrongCases(t.id, dataset)) {
      const r = gradeTask(t.id, w.inputs, dataset);
      const codes = r.errors.map((e) => e.code);
      const pass = r.earned <= w.maxEarned && r.earned < r.max && w.codes.every((c) => codes.includes(c));
      checks.push({ taskId: t.id, kind: 'wrong', name: w.name, pass, detail: `${r.earned}/${r.max} · ${codes.join(',') || '—'}` });
    }
  }
  return { pass: checks.every((c) => c.pass), total: checks.length, failed: checks.filter((c) => !c.pass), checks };
}
