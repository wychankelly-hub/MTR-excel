// 伺服器時鐘（比賽時間一律以此為準）。測試時可以手動推進。
let offset = 0;
export const clock = {
  now: () => Date.now() + offset,
  advance(ms) { offset += ms; },
  reset() { offset = 0; },
};
