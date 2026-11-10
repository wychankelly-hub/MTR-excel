// 數據生成＋Preflight（計算量大）：可在主執行緒直接執行（測試、命令列），
// 亦可在背景執行緒（worker_threads）執行，令伺服器在生成期間仍可回應學生及健康檢查。
import crypto from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { episodeById } from './episodes/index.js';

const SEED_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newSeed = () => `S-${Array.from(crypto.randomBytes(12), (b) => SEED_ALPHABET[b % SEED_ALPHABET.length]).join('')}`;

/**
 * Preflight 未通過 → 自動以新 Seed 重抽（最多 5 次），並記錄被拒絕的 Seed。
 * fixedSeed：以相同 Seed 重現（不重抽）。
 */
export function runGeneration({ episodeId, teamKeys, fixedSeed = null }) {
  const ep = episodeById(episodeId);
  const t0 = Date.now();
  const rejectedSeeds = [];
  let seed; let list; let preflight; let pass;
  for (let attempt = 0; attempt < 5; attempt++) {
    seed = attempt === 0 && fixedSeed ? fixedSeed : newSeed();
    list = ep.generateCompetitionDatasets(seed, teamKeys);
    preflight = list.map((ds) => { const p = ep.preflightTeam(ds); return { pass: p.pass, total: p.total, failed: p.failed }; });
    pass = preflight.every((p) => p.pass);
    if (pass || (fixedSeed && attempt === 0)) break;
    rejectedSeeds.push({ seed, failed: preflight.map((p, i) => ({ teamKey: teamKeys[i], failed: p.failed })).filter((x) => x.failed.length) });
  }
  // 生成紀錄中的被拒絕嘗試可能很長，只保留數目
  for (const ds of list) ds.rejected = (ds.rejected || []).map((r) => ({ attempt: r.attempt }));
  return { seed, list, preflight, pass, rejectedSeeds, ms: Date.now() - t0 };
}

/** 在背景執行緒執行 runGeneration（主執行緒不會被阻塞） */
export function runGenerationInWorker(args) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./generate-worker.js', import.meta.url), { workerData: args });
    w.once('message', (m) => (m.error ? reject(new Error(m.error)) : resolve(m.result)));
    w.once('error', reject);
    w.once('exit', (code) => { if (code !== 0) reject(new Error(`生成數據的背景程序異常結束（${code}）`)); });
  });
}
