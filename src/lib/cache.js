// Simple client-side cache with in-memory and localStorage fallback
const mem = new Map();
// Bumped every time a key is invalidated/patched, so an in-flight fetch that
// started *before* a write (and would otherwise resolve with stale data after
// the write completes) knows not to overwrite the newer value with its stale one.
const versions = new Map();

const now = () => Date.now();
const bump = (key) => versions.set(key, (versions.get(key) || 0) + 1);
const versionOf = (key) => versions.get(key) || 0;

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

  // fetch — remember the version at the start so a concurrent invalidate/patch
  // (e.g. a save that completes while this read is still in flight) isn't
  // clobbered by this read's now-stale result once it resolves.
  const versionAtStart = versionOf(key);
  const value = await fetcher();
  if (versionOf(key) === versionAtStart) {
    mem.set(key, { value, expires: now() + ttl });
    try { _writeLS(key, value, ttl); } catch (e) {}
  }
  return value;
}

export function invalidateCache(key) {
  mem.delete(key);
  bump(key);
  try { localStorage.removeItem(key); } catch (e) {}
}

// Patch a cached value in place (e.g. after a save) instead of just invalidating,
// so the next read is instantly correct rather than forcing a round trip — and so
// other already-mounted screens sharing the same key can be kept in sync.
// `updater` receives the previous cached value (or undefined if nothing was
// cached yet) and returns the new value to store. Returns the new value, or
// undefined if there was nothing cached and the updater wasn't called.
export function updateCache(key, updater, ttl = 1000 * 60 * 5) {
  const m = mem.get(key);
  const ls = m ? m.value : _readLS(key);
  bump(key);
  if (ls === null || ls === undefined) {
    // Nothing cached yet — nothing to patch locally. The next fetchWithCache
    // call will hit the network and pick up the true state.
    return undefined;
  }
  const next = updater(ls);
  mem.set(key, { value: next, expires: now() + ttl });
  try { _writeLS(key, next, ttl); } catch (e) {}
  return next;
}

export default { fetchWithCache, invalidateCache, updateCache };
