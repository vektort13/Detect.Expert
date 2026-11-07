// REQ-005/008/011: browser-observed provenance only; never retain a URL or query.
// Exact final-resource matching remains separate from this redirect-only helper.
export const VENDOR_REDIRECT_LIMITS = Object.freeze({ maxEntries: 128, maxHops: 5, ttlMs: 30000 });

const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const DOCUMENT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const RULE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const PHASES = new Set(['before', 'redirect', 'completed', 'error']);
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const MAX_URL_LENGTH = 8192;
const MAX_RULES = 32;
const MAX_COUNT = 65535;

function httpsOrigin(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_URL_LENGTH) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password ? url.origin : null;
  } catch { return null; }
}

function identity(details, scopeKey) {
  if (!details || !Number.isSafeInteger(details.tabId) || details.tabId < 0 ||
      !Number.isSafeInteger(details.frameId) || details.frameId < 0 ||
      typeof details.documentId !== 'string' || !DOCUMENT_ID.test(details.documentId) ||
      typeof details.type !== 'string' || !/^[a-z_]{1,32}$/.test(details.type) ||
      typeof scopeKey !== 'string' || !ID.test(scopeKey) ||
      typeof details.timeStamp !== 'number' || !Number.isFinite(details.timeStamp) || details.timeStamp < 0 ||
      (details.documentLifecycle !== undefined && details.documentLifecycle !== 'active')) return null;
  return { tabId: details.tabId, frameId: details.frameId, documentId: details.documentId,
    type: details.type, scopeKey, stamp: details.timeStamp };
}

function sameIdentity(entry, current) {
  return entry.tabId === current.tabId && entry.frameId === current.frameId &&
    entry.documentId === current.documentId && entry.type === current.type && entry.scopeKey === current.scopeKey;
}

/**
 * `match` is the existing reviewed exact-resource matcher, invoked only transiently.
 * `allowed` and `scopeKey` are supplied by the browser-authorized listener, never a page message.
 * scopeKey must change when consent, grants, observation scope or the Pro session changes.
 * Missing native document identity deliberately cannot establish redirect provenance.
 */
export function createVendorRedirectTracker({ match, now = Date.now, onLimit = () => {},
  maxEntries = VENDOR_REDIRECT_LIMITS.maxEntries, maxHops = VENDOR_REDIRECT_LIMITS.maxHops,
  ttlMs = VENDOR_REDIRECT_LIMITS.ttlMs } = {}) {
  if (typeof match !== 'function' || typeof now !== 'function' || typeof onLimit !== 'function' ||
      !Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 128 ||
      !Number.isSafeInteger(maxHops) || maxHops < 1 || maxHops > 5 ||
      !Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 30000) throw new TypeError('Invalid redirect tracker options');
  const entries = new Map();
  const counts = { capacity: 0, hops: 0, ttl: 0 };
  let previousNow = null;

  function limit(reason, entry) {
    counts[reason] = Math.min(MAX_COUNT, counts[reason] + 1);
    try { onLimit(reason, { tabId: entry.tabId, frameId: entry.frameId, documentId: entry.documentId }); } catch { /* Observer errors stay local. */ }
  }
  function time() {
    const at = now();
    if (typeof at !== 'number' || !Number.isFinite(at) || at < 0 || (previousNow !== null && at < previousNow)) {
      entries.clear(); previousNow = null; return null;
    }
    previousNow = at;
    for (const [id, entry] of entries) {
      if (at - entry.startedAt >= ttlMs) {
        entries.delete(id);
        if (entry.phase !== 'terminal') limit('ttl', entry);
      }
    }
    return at;
  }
  function terminate(entry) {
    // Tombstones prevent a completed, rejected or reused native request ID from being reseeded.
    entry.phase = 'terminal'; entry.ruleIds = []; entry.origin = null;
  }
  function matched(raw, type, at) {
    let result;
    try { result = match(raw, type, at); } catch { return []; }
    if (!Array.isArray(result) || result.length > MAX_RULES) return [];
    const ids = [];
    for (const item of result) {
      const id = typeof item === 'string' ? item : item && typeof item === 'object' ? item.ruleId : null;
      if (typeof id !== 'string' || !RULE_ID.test(id)) return [];
      if (!ids.includes(id)) ids.push(id);
    }
    return ids.sort();
  }
  function observe(details, phase, { allowed = false, scopeKey = null } = {}) {
    const at = time();
    if (at === null || !details || typeof details.requestId !== 'string' || !ID.test(details.requestId)) return [];
    const requestId = details.requestId, entry = entries.get(requestId);
    const current = identity(details, scopeKey);
    if (!allowed || !PHASES.has(phase) || !current || current.stamp <= at - ttlMs || current.stamp > at + 1000) {
      if (entry) terminate(entry);
      return [];
    }
    const origin = httpsOrigin(details.url);
    if (entry) {
      if (entry.phase === 'terminal') return [];
      if (!sameIdentity(entry, current) || current.stamp < entry.stamp || current.stamp - entry.firstStamp >= ttlMs ||
          origin === null || origin !== entry.origin) { terminate(entry); return []; }
      entry.stamp = current.stamp;
      if (phase === 'error') { terminate(entry); return []; }
      if (phase === 'before') {
        if (entry.phase !== 'redirect') { terminate(entry); return []; }
        entry.phase = 'before';
        return [];
      }
      if (phase === 'redirect') {
        if (entry.phase !== 'before' || !REDIRECT_STATUS.has(details.statusCode) || httpsOrigin(details.redirectUrl) !== entry.origin) {
          terminate(entry); return [];
        }
        if (entry.hops >= maxHops) { limit('hops', entry); terminate(entry); return []; }
        ++entry.hops; entry.phase = 'redirect';
        return [];
      }
      const successful = Number.isInteger(details.statusCode) &&
        (details.statusCode >= 200 && details.statusCode <= 299 || details.statusCode === 304);
      const ids = successful && entry.phase === 'before' && entry.hops > 0 ? [...entry.ruleIds] : [];
      terminate(entry);
      return ids;
    }
    if (phase !== 'before' || origin === null) return [];
    const ruleIds = matched(details.url, details.type, at);
    if (ruleIds.length === 0) return [];
    if (entries.size >= maxEntries) { limit('capacity', current); return []; }
    entries.set(requestId, { ...current, firstStamp: current.stamp, startedAt: at, origin, ruleIds, hops: 0, phase: 'before' });
    return [];
  }
  function clear(scopeKey) {
    if (scopeKey === undefined) { entries.clear(); return; }
    for (const [id, entry] of entries) if (entry.scopeKey === scopeKey) entries.delete(id);
  }
  function clearTab(tabId) {
    for (const [id, entry] of entries) if (entry.tabId === tabId) entries.delete(id);
  }
  function clearDocument(documentKey) {
    for (const [id, entry] of entries) {
      if (`${entry.tabId}:${entry.frameId}:${entry.documentId}` === documentKey) entries.delete(id);
    }
  }
  function stats() {
    time();
    let active = 0;
    for (const entry of entries.values()) if (entry.phase !== 'terminal') ++active;
    return { entries: entries.size, active, limited: Object.values(counts).some(count => count > 0), ...counts };
  }
  return { observe, clear, clearTab, clearDocument, stats };
}
