// ADR-107 round 5: the link between a library profile and a saved proxy ("identity bundle"). One small machine-local storage.local key:
//   'identity-bundles:v1'   { version: 1, links: { [profileId]: proxyId } }
// profileId is a library profile id (fp-<32 hex>), proxyId is an id of the Proxy workspace (the proxyId rule of proxy-shared.js). The link
// is only a pointer for the user's convenience: it never touches the proxy configuration, is not part of the portable API configuration
// (proxy ids mean nothing on another machine), and is never exported. At most BUNDLES_MAX_LINKS links; stored data is never trusted
// (malformed entries are dropped on read); links of deleted profiles, and of proxies that are gone when the caller knows the proxy list,
// are pruned lazily on the next write.
import { proxyId } from './proxy-shared.js';

export const BUNDLES_KEY = 'identity-bundles:v1';
export const BUNDLES_VERSION = 1;
export const BUNDLES_MAX_LINKS = 128;
const PROFILE_ID = /^fp-[a-f0-9]{32}$/;

export class BundleError extends Error { constructor(code) { super(code); this.name = 'BundleError'; this.code = code; } }

export const validProfileId = value => typeof value === 'string' && PROFILE_ID.test(value);
export function validProxyId(value) { try { proxyId(value); return true; } catch { return false; } }
const has = (object, key) => Object.hasOwn(object, key) && Object.hasOwn(Object.getOwnPropertyDescriptor(object, key), 'value');
const plainLinks = () => Object.create(null);
const keysOf = links => Object.keys(links).sort();

/**
 * The stored value as { links, changed }. `links` is a null-prototype object { profileId: proxyId } holding only valid pairs, at most
 * BUNDLES_MAX_LINKS (the first ones in profile id order); `changed` is true when the stored value differs from it. Anything that is not
 * a version-1 record reads as no links.
 */
export function readBundles(raw) {
  const links = plainLinks();
  if (raw === undefined) return { links, changed: false };
  const keys = raw && typeof raw === 'object' && !Array.isArray(raw) ? Reflect.ownKeys(raw) : [];
  if (keys.length !== 2 || !has(raw, 'version') || !has(raw, 'links') || raw.version !== BUNDLES_VERSION || !raw.links || typeof raw.links !== 'object' || Array.isArray(raw.links)) return { links, changed: true };
  let changed = false, kept = 0;
  const stored = Reflect.ownKeys(raw.links);
  if (stored.length > 4 * BUNDLES_MAX_LINKS) changed = true;
  for (const key of stored.slice(0, 4 * BUNDLES_MAX_LINKS).sort()) {
    if (typeof key !== 'string' || !validProfileId(key) || !has(raw.links, key) || !validProxyId(raw.links[key]) || kept >= BUNDLES_MAX_LINKS) { changed = true; continue; }
    links[key] = raw.links[key]; kept++;
  }
  return { links, changed };
}
/** A copy of `links` with profileId -> proxy; throws BundleError('invalid') for a bad id and ('limit') for a new link over the cap. */
export function linkProfile(links, profileId, proxy) {
  if (!validProfileId(profileId) || !validProxyId(proxy)) throw new BundleError('invalid');
  if (!Object.hasOwn(links, profileId) && keysOf(links).length >= BUNDLES_MAX_LINKS) throw new BundleError('limit');
  return Object.assign(plainLinks(), links, { [profileId]: proxy });
}
export function unlinkProfile(links, profileId) {
  const next = Object.assign(plainLinks(), links);
  delete next[profileId];
  return next;
}
/** The profile ids linked to one proxy, in id order. */
export const profilesOfProxy = (links, proxy) => keysOf(links).filter(profileId => links[profileId] === proxy);
/**
 * Drops the links of profiles that are not in `profileIds` and, when `proxyIds` is given (the caller has just read the proxy list),
 * the links of proxies that are not in it. Without a list a link is kept: an unavailable Proxy workspace proves nothing.
 */
export function pruneLinks(links, { profileIds = null, proxyIds = null } = {}) {
  const next = plainLinks();
  for (const profileId of keysOf(links)) {
    if (profileIds && !profileIds.has(profileId) || proxyIds && !proxyIds.has(links[profileId])) continue;
    next[profileId] = links[profileId];
  }
  return next;
}

/** The links over a browser storage object ({ local: { get, set, remove }, onChanged }); operations are serialized in one chain. */
export function createBundleStore(storage, { key = BUNDLES_KEY } = {}) {
  let chain = Promise.resolve();
  const serialize = task => { const next = chain.then(task, task); chain = next.catch(() => {}); return next; };
  async function load() { const stored = await storage.local.get(key); return readBundles(Object.hasOwn(stored ?? {}, key) ? stored[key] : undefined); }
  async function save(links) {
    if (keysOf(links).length) await storage.local.set({ [key]: { version: BUNDLES_VERSION, links: Object.assign({}, links) } });
    else await storage.local.remove(key);
  }
  return {
    // `profileIds` (a Set of the saved library ids) lets the read drop the links of deleted profiles.
    read: ({ profileIds = null } = {}) => serialize(async () => {
      const { links, changed } = await load(), pruned = profileIds ? pruneLinks(links, { profileIds }) : links;
      if (changed || keysOf(pruned).length !== keysOf(links).length) { try { await save(pruned); } catch { /* The pruned links are still the truth for this call. */ } }
      return pruned;
    }),
    // `context` ({ profileIds, proxyIds }) lets the write prune dead links first.
    link: (profileId, proxy, context = {}) => serialize(async () => { const { links } = await load(), next = linkProfile(pruneLinks(links, context), profileId, proxy); await save(next); return next; }),
    unlink: (profileId, context = {}) => serialize(async () => { const { links } = await load(), next = unlinkProfile(pruneLinks(links, context), profileId); await save(next); return next; }),
    watch(callback) {
      const listener = (changes, area) => { if (area === 'local' && changes && Object.hasOwn(changes, key)) { try { callback(); } catch { /* A repaint has no privileged effects. */ } } };
      storage.onChanged?.addListener(listener);
      return () => storage.onChanged?.removeListener(listener);
    }
  };
}
