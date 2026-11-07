// ADR-109 (owner order, 2026-11-06): storage of the Proxy Manager Geolocation API. The settings and the result cache live in storage.local.
// The credentials container lives where the user's "remember" choice says: storage.local when true (on disk, unencrypted: the user opted
// in), storage.session when false (trusted contexts only, gone when the browser closes). A browser without storage.session keeps the keys
// in the memory of this store only, whatever "remember" says. Credentials are never written to storage.local while "remember" is false; the
// one exception is the first step of moving the keys to the disk, which the user has just asked for (the flag is saved right after). The
// area that the choice does not name is emptied when the choice changes and by a tidy load. Every value read goes through the strict readers
// of proxy-geo-shared.js. All reads and writes of one store run one after another, so no read-modify-write interleaves. Writes answer
// { ok:true[, value] } or { ok:false, error:'storage-unavailable' }, never a platform error text. Nothing here reaches the network.
import { GEO_SETTINGS_KEY, GEO_CREDENTIALS_KEY, GEO_CACHE_KEY, normalizeGeoSettings, normalizeGeoCredentials, normalizeGeoCache } from './proxy-geo-shared.js';

const KEYS = Object.freeze([GEO_SETTINGS_KEY, GEO_CREDENTIALS_KEY, GEO_CACHE_KEY]);
const FAILED = Object.freeze({ ok: false, error: 'storage-unavailable' });
const own = (found, key) => (found !== null && typeof found === 'object' && Object.hasOwn(found, key) ? found[key] : undefined);
const hasItems = container => Object.keys(container.items).length > 0;

export function createGeoStore({ api = globalThis.chrome, now = Date.now } = {}) {
  const local = api?.storage?.local, session = api?.storage?.session ?? null;
  let chain = Promise.resolve(), memory, trustedSession = null;
  const enqueue = job => { const run = chain.then(job); chain = run.then(() => {}, () => {}); return run; };
  // storage.session is limited to trusted contexts before its first use; a browser that refuses is still used (best effort).
  const trusted = () => (trustedSession ??= (async () => {
    try { if (typeof session.setAccessLevel === 'function') await session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }); } catch { /* best effort */ }
  })());
  // The two places a credentials container can be in; without storage.session the "session" place is this store's memory.
  const places = {
    local: {
      get: async () => own(await local.get(GEO_CREDENTIALS_KEY), GEO_CREDENTIALS_KEY),
      set: async value => { await local.set({ [GEO_CREDENTIALS_KEY]: value }); },
      remove: async () => { await local.remove(GEO_CREDENTIALS_KEY); },
    },
    session: session === null
      ? { get: async () => memory, set: async value => { memory = value; }, remove: async () => { memory = undefined; } }
      : {
        get: async () => { await trusted(); return own(await session.get(GEO_CREDENTIALS_KEY), GEO_CREDENTIALS_KEY); },
        set: async value => { await trusted(); await session.set({ [GEO_CREDENTIALS_KEY]: value }); },
        remove: async () => { await trusted(); await session.remove(GEO_CREDENTIALS_KEY); },
      },
  };
  const placeFor = remember => (remember && session !== null ? 'local' : 'session');
  const done = async (action, value) => { try { await action(); return value === undefined ? { ok: true } : { ok: true, value }; } catch { return FAILED; } };

  async function readAll(tidy) {
    const found = await local.get([...KEYS]);
    const settings = normalizeGeoSettings(own(found, GEO_SETTINGS_KEY)), cache = normalizeGeoCache(own(found, GEO_CACHE_KEY), now());
    const raw = placeFor(settings.remember) === 'local' ? own(found, GEO_CREDENTIALS_KEY) : await places.session.get();
    // A copy in the area the choice does not name is never used. A tidy load also removes it (best effort), so a secret is not left on disk.
    // A reload caused by another page is not tidy: that page may be half way through moving the keys, and the copy is the keys.
    if (tidy) {
      const stray = settings.remember ? (session === null ? undefined : await places.session.get().catch(() => undefined)) : own(found, GEO_CREDENTIALS_KEY);
      if (stray !== undefined) await places[settings.remember ? 'session' : 'local'].remove().catch(() => {});
    }
    return { settings, credentials: normalizeGeoCredentials(raw), cache };
  }

  // The area is the one the PERSISTED choice names, read at write time, so a page that has not heard of a change still writes right.
  const saveCredentials = credentials => enqueue(async () => {
    const value = normalizeGeoCredentials(credentials);
    let remember;
    try { remember = normalizeGeoSettings(own(await local.get(GEO_SETTINGS_KEY), GEO_SETTINGS_KEY)).remember; } catch { return FAILED; }
    if (!hasItems(value)) { // nothing to keep: leave no container (and no residue) in either area
      const removed = await Promise.all([places.local.remove().then(() => true, () => false), places.session.remove().then(() => true, () => false)]);
      return removed.every(Boolean) ? { ok: true, value } : FAILED;
    }
    const saved = await done(() => places[placeFor(remember)].set(value), value);
    if (saved.ok) { const stray = remember ? (session === null ? null : 'session') : 'local'; if (stray) await places[stray].remove().catch(() => {}); }
    return saved;
  });

  // Moves the container to the area the new choice names: the new area is written first and the old one is emptied only after that
  // worked; if emptying fails the new copy is taken back, so a failure leaves the keys where they were.
  const moveCredentials = remember => enqueue(async () => {
    if (typeof remember !== 'boolean') return FAILED;
    const to = placeFor(remember), from = placeFor(!remember);
    if (to === from) return remember ? { ok: true } : done(() => places.local.remove()); // no storage.session: only the disk must stay clean
    let raw;
    try { raw = await places[from].get(); } catch { return FAILED; }
    const value = normalizeGeoCredentials(raw);
    if (!hasItems(value)) return raw === undefined ? { ok: true } : done(() => places[from].remove());
    try { await places[to].set(value); } catch { return FAILED; }
    try { await places[from].remove(); } catch { await places[to].remove().catch(() => {}); return FAILED; }
    return { ok: true };
  });

  const saveSettings = settings => enqueue(() => { const value = normalizeGeoSettings(settings); return done(() => local.set({ [GEO_SETTINGS_KEY]: value }), value); });
  const saveCache = cache => enqueue(() => { const value = normalizeGeoCache(cache, now()); return done(() => local.set({ [GEO_CACHE_KEY]: value }), value); });
  const clearCache = () => enqueue(() => done(() => local.remove(GEO_CACHE_KEY)));

  // The listener is called without a payload for a change of one of the three values in storage.local or storage.session; the caller re-reads.
  function watch(listener) {
    const onChanged = api?.storage?.onChanged;
    if (typeof listener !== 'function' || typeof onChanged?.addListener !== 'function') return () => {};
    const handler = (changes, area) => {
      if ((area !== 'local' && area !== 'session') || changes === null || typeof changes !== 'object' || !KEYS.some(key => Object.hasOwn(changes, key))) return;
      try { listener(); } catch { /* a broken listener must not stop the others */ }
    };
    onChanged.addListener(handler);
    return () => { try { onChanged.removeListener(handler); } catch { /* already gone */ } };
  }

  return Object.freeze({ loadAll: options => enqueue(() => readAll(options?.tidy !== false)), saveSettings, saveCredentials, moveCredentials, saveCache, clearCache, watch });
}
