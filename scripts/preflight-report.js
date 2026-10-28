#!/usr/bin/env node
// 命令列 Preflight 報告：node scripts/preflight-report.js [SEED] [隊數]
import { generateCompetitionDatasets } from '../server/episode1/generator.js';
import { preflightTeam } from '../server/episode1/preflight.js';

const seed = process.argv[2] || `CLI-${Date.now()}`;
const n = Number(process.argv[3] || 6);
const list = generateCompetitionDatasets(seed, Array.from({ length: n }, (_, i) => `team-${i + 1}`));
console.log(`Seed：${seed}`);
let allPass = true;
for (const d of list) {
  const p = preflightTeam(d);
  allPass &&= p.pass;
  console.log(`${d.teamKey}  ${p.pass ? '✓' : '✗'} ${p.total - p.failed.length}/${p.total}  嘗試 ${d.attempts}  ${JSON.stringify(d.flags)}`);
  for (const f of p.failed) console.log(`   ✗ ${f.taskId} ${f.name}：${f.detail}`);
}
process.exit(allPass ? 0 : 1);
