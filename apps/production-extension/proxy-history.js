// ADR-070/071/107 round 5: saved history of MANUAL proxy checks. Local to this browser profile, bounded, validated on read.
// One storage.local key. It holds, per profile ID, a short list of "stays": {first and last check time, number of checks,
// outcome, response time, DNS/TLS flags, HTTP status, exit IP}. Consecutive successful checks that show the same exit IP are ONE
// stay (the newest reading wins, the count grows); a failed check or a different exit IP starts a new entry. It never holds the
// checked address, a response body or header, a credential, or the proxy host and port. The exit IP is the address of the user's
// own proxy as the check site saw it. Only the Options page writes it, only after a completed manual check; it is not part of the
// configuration, an export, a report, a snapshot or a log.
// The same value carries the user's switch, `enabled` (true when the key or the flag is missing, so older data keeps loading): while
// it is false nothing is recorded, the entries stay until the user clears them, and clearing keeps the switch.
import { PROXY_SAFE_CODES, PROXY_PHASES, proxyId, proxyHost, proxyFail } from './proxy-shared.js';

export const PROXY_HISTORY_KEY = 'proxy-check-history:v1';
export const PROXY_HISTORY_LIMITS = Object.freeze({ entries: 30, profiles: 100, maxAgeMs: 30 * 24 * 60 * 60 * 1000, shown: 10, responseMs: 60000, checks: 65535, futureSlackMs: 24 * 60 * 60 * 1000, scanEntries: 200, scanProfiles: 400 });
const CODES = new Set(PROXY_SAFE_CODES);
const FLAGS = Object.freeze(['ok', 'fail', 'unknown']);
const ENTRY_KEYS = Object.freeze(['firstAt', 'lastAt', 'checks', 'ok', 'code', 'ms', 'dns', 'tls', 'status', 'ip']);
// A failed check is recorded only when the companion reported what happened on the path to the proxy. A check that could not run
// (no companion, no permission, busy, a client-side timeout) says nothing about the proxy and is not history.
export const PROXY_HISTORY_FAILURES = Object.freeze(['auth-failed', 'auth-required', 'proxy-denied', 'network-unreachable', 'host-unreachable', 'connection-refused', 'connection-failed', 'dns-failed', 'tls-failed', 'reality-failed', 'timeout', 'proxy-error', 'tunnel-disconnected', 'engine-failed']);

const emptyHistory = () => ({ version: 1, enabled: true, items: {} });
// Own enumerable data properties only: storage values are structured clones, but nothing here trusts that.
function plain(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Reflect.ownKeys(value).every(key => typeof key === 'string' && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
}
function canonicalIp(value) {
  if (value === '') return true;
  if (typeof value !== 'string' || value.length > 45) return false;
  try { return proxyHost(value) === value && (value.includes(':') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)); } catch { return false; }
}
// A valid entry as a fresh canonical object, or null (malformed, or last confirmed more than 30 days ago).
export function sanitizeProxyHistoryEntry(raw, now = Date.now()) {
  const limits = PROXY_HISTORY_LIMITS;
  if (!plain(raw) || Object.keys(raw).length !== ENTRY_KEYS.length || !ENTRY_KEYS.every(key => Object.hasOwn(raw, key))) return null;
  const { firstAt, lastAt, checks, ok, code, ms, dns, tls, status, ip } = raw;
  if (!Number.isSafeInteger(firstAt) || !Number.isSafeInteger(lastAt) || firstAt < 0 || firstAt > lastAt || lastAt > now + limits.futureSlackMs || now - lastAt > limits.maxAgeMs) return null;
  if (!Number.isSafeInteger(checks) || checks < 1 || checks > limits.checks) return null;
  if (typeof ok !== 'boolean' || typeof code !== 'string' || (code !== '' && !CODES.has(code))) return null;
  if (!Number.isSafeInteger(ms) || ms < 0 || ms > limits.responseMs || !FLAGS.includes(dns) || !FLAGS.includes(tls)) return null;
  if (!Number.isSafeInteger(status) || (status !== 0 && (status < 100 || status > 599)) || !canonicalIp(ip)) return null;
  // A response has no failure code; a failed check has no response, time or exit IP and is always a single check. Only a known
  // exit IP can be "the same one" again, so a stay of several checks has one.
  if (ok ? code !== '' || status === 0 || (ip === '' && (checks !== 1 || firstAt !== lastAt)) : code === '' || ms !== 0 || status !== 0 || ip !== '' || checks !== 1 || firstAt !== lastAt) return null;
  return { firstAt, lastAt, checks, ok, code, ms, dns, tls, status, ip };
}
// Strict read of the stored value. Anything unexpected is dropped, never repaired from guesses; caps are enforced here too. The
// switch is the one thing that has a default: a missing flag (a value from before the switch) and a malformed one (not a boolean) are
// discarded and read as true.
export function normalizeProxyHistory(raw, now = Date.now()) {
  const limits = PROXY_HISTORY_LIMITS;
  if (!plain(raw) || raw.version !== 1 || !Object.hasOwn(raw, 'items') || !plain(raw.items) || Object.keys(raw).some(key => !['version', 'enabled', 'items'].includes(key))) return emptyHistory();
  const enabled = Object.hasOwn(raw, 'enabled') && typeof raw.enabled === 'boolean' ? raw.enabled : true;
  const kept = [];
  for (const id of Object.keys(raw.items).slice(0, limits.scanProfiles)) {
    try { proxyId(id); } catch { continue; }
    const list = Object.getOwnPropertyDescriptor(raw.items, id).value;
    if (!Array.isArray(list)) continue;
    const entries = list.slice(-limits.scanEntries).map(item => sanitizeProxyHistoryEntry(item, now)).filter(Boolean).sort((a, b) => a.lastAt - b.lastAt || a.firstAt - b.firstAt).slice(-limits.entries);
    if (entries.length) kept.push([id, entries]);
  }
  kept.sort((a, b) => b[1].at(-1).lastAt - a[1].at(-1).lastAt);
  return { version: 1, enabled, items: Object.fromEntries(kept.slice(0, limits.profiles)) };
}
// The observation for a finished manual check (a stay of one check), or null when the result says nothing about the proxy (see
// PROXY_HISTORY_FAILURES). `diagnostic` is the validated check result: { state: 'pass', remoteDns, tlsVerified, httpStatus, ip,
// elapsedMs } or { state: 'fail', code, phase }. A failed check carries no response time: it is stored as 0 and shown as a dash.
export function proxyHistoryEntry(diagnostic, at = Date.now()) {
  if (!plain(diagnostic) || !Number.isSafeInteger(at)) return null;
  let entry;
  if (diagnostic.state === 'pass') {
    entry = { firstAt: at, lastAt: at, checks: 1, ok: true, code: '', ms: Math.min(PROXY_HISTORY_LIMITS.responseMs, Math.max(0, diagnostic.elapsedMs)), dns: diagnostic.remoteDns === true ? 'ok' : 'unknown', tls: diagnostic.tlsVerified === true ? 'ok' : 'unknown', status: diagnostic.httpStatus, ip: typeof diagnostic.ip === 'string' ? diagnostic.ip : '' };
  } else if (diagnostic.state === 'fail' && PROXY_HISTORY_FAILURES.includes(diagnostic.code) && PROXY_PHASES.includes(diagnostic.phase)) {
    entry = { firstAt: at, lastAt: at, checks: 1, ok: false, code: diagnostic.code, ms: 0, dns: diagnostic.code === 'dns-failed' ? 'fail' : 'unknown', tls: diagnostic.code === 'tls-failed' ? 'fail' : 'unknown', status: 0, ip: '' };
  } else return null;
  return sanitizeProxyHistoryEntry(entry, at);
}
// Newest first, the last `shown` entries, each with `ipChanged`: its exit IP differs from the previous successful entry's IP.
export function proxyHistoryRows(entries, shown = PROXY_HISTORY_LIMITS.shown) {
  const rows = [];
  let last = null;
  for (const entry of Array.isArray(entries) ? entries : []) {
    const known = entry.ok && entry.ip !== '';
    rows.push({ ...entry, ipChanged: known && last !== null && entry.ip !== last });
    if (known) last = entry.ip;
  }
  return rows.reverse().slice(0, shown);
}
// True when the newest successful entry with an exit IP shows a different one than the successful entry before it.
export const proxyHistoryIpChanged = entries => proxyHistoryRows(entries, PROXY_HISTORY_LIMITS.entries).find(row => row.ok && row.ip !== '')?.ipChanged === true;
// The stored entries of one profile, oldest first. Own keys only: a profile ID such as "constructor" must not read a prototype member.
export const proxyHistoryOf = (history, profileId) => history && plain(history.items) && Object.hasOwn(history.items, profileId) && Array.isArray(history.items[profileId]) ? history.items[profileId] : [];

// One more check on a profile's entries (oldest first). A successful check with the same known exit IP as the newest successful
// entry extends that stay; anything else is a new entry.
function withObservation(entries, observation) {
  const last = entries.at(-1);
  if (last && last.ok && observation.ok && observation.ip !== '' && last.ip === observation.ip) {
    const stay = { ...observation, firstAt: Math.min(last.firstAt, observation.firstAt), lastAt: Math.max(last.lastAt, observation.lastAt), checks: Math.min(PROXY_HISTORY_LIMITS.checks, last.checks + observation.checks) };
    return [...entries.slice(0, -1), stay];
  }
  return [...entries, observation];
}
// Pure updates. Each returns a new normalized history, and each keeps the switch as it is. Nothing is appended while it is off.
export function appendProxyHistory(history, profileId, entry, now = Date.now()) {
  proxyId(profileId);
  const current = normalizeProxyHistory(history, now), valid = sanitizeProxyHistoryEntry(entry, now);
  if (!valid || !current.enabled) return current;
  const items = { ...current.items, [profileId]: withObservation(proxyHistoryOf(current, profileId), valid) };
  return normalizeProxyHistory({ version: 1, enabled: true, items }, now);
}
export function removeProxyHistory(history, profileId, now = Date.now()) {
  proxyId(profileId);
  const current = normalizeProxyHistory(history, now), { [profileId]: removed, ...items } = current.items; void removed;
  return { version: 1, enabled: current.enabled, items };
}
// Keeps only the profiles that still exist.
export function pruneProxyHistory(history, liveIds, now = Date.now()) {
  const current = normalizeProxyHistory(history, now), live = new Set(liveIds);
  return { version: 1, enabled: current.enabled, items: Object.fromEntries(Object.entries(current.items).filter(([id]) => live.has(id))) };
}
// The same entries with the switch set to `enabled` (a boolean).
export function withProxyHistoryEnabled(history, enabled, now = Date.now()) {
  if (typeof enabled !== 'boolean') proxyFail('invalid-input');
  return { ...normalizeProxyHistory(history, now), enabled };
}

// Storage access with a one-task-at-a-time queue per storage area (so every store and helper over the same area, in this page, runs in
// the order the calls were made), and a fresh read before every write so that a change made by another Options page between two checks
// is merged instead of replaced. `api` is the browser API, its `storage` namespace or a storage area itself. `now` is injectable for
// tests. Every method resolves to its result, or to null when storage fails: history is optional and a failure never reaches the proxy
// features.
const queues = new WeakMap();
function historyArea(source) {
  const area = source?.storage?.local ?? source?.local ?? source;
  return typeof area?.get === 'function' && typeof area?.set === 'function' && typeof area?.remove === 'function' ? area : null;
}
export function createProxyHistoryStore(api, { now = () => Date.now() } = {}) {
  const area = historyArea(api), available = area !== null;
  const enqueue = task => { const result = (queues.get(area) ?? Promise.resolve()).then(task, task); queues.set(area, result.then(() => undefined, () => undefined)); return result; };
  const guarded = task => available ? enqueue(async () => { try { return await task(); } catch { return null; } }) : Promise.resolve(null);
  // The state nobody needs a key for: switch on, nothing saved.
  const isDefault = history => history.enabled && Object.keys(history.items).length === 0;
  async function load() {
    const raw = (await area.get(PROXY_HISTORY_KEY))[PROXY_HISTORY_KEY], history = normalizeProxyHistory(raw, now());
    return { raw, history };
  }
  async function save(history) {
    if (isDefault(history)) await area.remove(PROXY_HISTORY_KEY);
    else await area.set({ [PROXY_HISTORY_KEY]: { version: 1, enabled: history.enabled, items: history.items } });
    return history;
  }
  // The stored value already is this history, so keeping it needs no write. A value from before the switch has no flag and means on.
  const same = (raw, history) => {
    if (raw === undefined) return isDefault(history);
    if (isDefault(history)) return false;
    const stored = plain(raw) && Object.hasOwn(raw, 'version') && Object.hasOwn(raw, 'items') && !Object.hasOwn(raw, 'enabled') ? { version: raw.version, enabled: true, items: raw.items } : raw;
    return JSON.stringify(stored) === JSON.stringify(history);
  };
  return {
    available,
    // Expired or malformed data is removed from storage by the first read that sees it.
    read: () => guarded(async () => { const { raw, history } = await load(); if (!same(raw, history)) { try { await save(history); } catch { /* A failed cleanup keeps the sanitized view. */ } } return history; }),
    // While the switch is off nothing is recorded and nothing is written; the result is the history as it is.
    record: (profileId, entry) => guarded(async () => { const { history } = await load(); return history.enabled ? await save(appendProxyHistory(history, profileId, entry, now())) : history; }),
    remove: profileId => guarded(async () => { const { history } = await load(); return await save(removeProxyHistory(history, profileId, now())); }),
    prune: liveIds => guarded(async () => { const { raw, history } = await load(), pruned = pruneProxyHistory(history, liveIds, now()); return same(raw, pruned) ? pruned : await save(pruned); }),
    // Clearing empties the entries and keeps the switch.
    clear: () => guarded(async () => { const { history } = await load(); return await save({ version: 1, enabled: history.enabled, items: {} }); }),
    // The switch: a boolean, or null when storage fails.
    enabled: () => guarded(async () => (await load()).history.enabled),
    // Stores the switch next to the entries (which stay) and resolves to it; anything but a boolean changes nothing and resolves to null.
    setEnabled: flag => typeof flag !== 'boolean' ? Promise.resolve(null) : guarded(async () => { const { raw, history } = await load(), next = withProxyHistoryEnabled(history, flag, now()); if (!same(raw, next)) await save(next); return flag; }),
  };
}
// The switch without a store: async, never throws, boolean or null (storage unavailable or failing). `storage` as for createProxyHistoryStore.
export const isHistoryEnabled = (storage, options) => createProxyHistoryStore(storage, options).enabled();
export const setHistoryEnabled = (storage, enabled, options) => createProxyHistoryStore(storage, options).setEnabled(enabled);
