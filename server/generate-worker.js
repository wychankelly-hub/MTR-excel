// 背景執行緒：生成數據及 Preflight（見 generation.js）
import { parentPort, workerData } from 'node:worker_threads';
import { runGeneration } from './generation.js';

try {
  parentPort.postMessage({ result: runGeneration(workerData) });
} catch (e) {
  parentPort.postMessage({ error: e.message });
}
