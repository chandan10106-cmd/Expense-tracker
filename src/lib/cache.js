// Simple client-side cache with in-memory and localStorage fallback
const mem = new Map();

const now = () => Date.now();

function _readLS(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.expires) return null;
    if (parsed.expires < now()) { localStorage.removeItem(key); return null; }
    return parsed.value;
  } catch (e) { return null; }
}

function _writeLS(key, value, ttl) {
  try {
    const payload = { value, expires: now() + ttl };
    localStorage.setItem(key, JSON.stringify(payload));
  } catch (e) { /* ignore */ }
}

export async function fetchWithCache(key, fetcher, ttl = 1000 * 60 * 5) {
  // try mem
  const m = mem.get(key);
  if (m && m.expires > now()) return m.value;

  // try localStorage
  const ls = _readLS(key);
  if (ls) {
    mem.set(key, { value: ls, expires: now() + ttl });
    return ls;
  }

  // fetch
  const value = await fetcher();
  mem.set(key, { value, expires: now() + ttl });
  try { _writeLS(key, value, ttl); } catch (e) {}
  return value;
}

export function invalidateCache(key) {
  mem.delete(key);
  try { localStorage.removeItem(key); } catch (e) {}
}

export default { fetchWithCache, invalidateCache };
