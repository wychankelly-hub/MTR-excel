// 測試用 cookie 儲存：保留伺服器設定的所有 cookie（登入 session 及訪客識別碼）。
export function cookieJar() {
  const jar = new Map();
  return {
    header: () => [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
    update(res) {
      for (const c of res.headers.getSetCookie?.() || []) {
        const kv = c.split(';')[0];
        const i = kv.indexOf('=');
        const k = kv.slice(0, i).trim();
        const v = kv.slice(i + 1);
        if (/Max-Age=0\b/i.test(c) || v === '') jar.delete(k); else jar.set(k, v);
      }
    },
  };
}
