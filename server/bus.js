import { EventEmitter } from 'node:events';

// 比賽狀態改變 → 即時推送（SSE）
export const bus = new EventEmitter();
bus.setMaxListeners(200);
