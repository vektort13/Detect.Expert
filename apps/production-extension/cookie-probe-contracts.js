// ADR-032 / REQ-004/005/011/012: explicit selected-cookie experiment, metadata only.
export const COOKIE_PROBE_STATUSES = Object.freeze(['idle', 'preparing', 'watching', 'complete']);
export const COOKIE_PROBE_RESULTS = Object.freeze(['none', 'restored-same', 'recreated-different', 'not-restored', 'cancelled', 'failed']);
export const COOKIE_PROBE_REASONS = Object.freeze(['none', 'not-eligible', 'ambiguous-cookie', 'cookie-missing', 'delete-failed', 'observation-unavailable', 'access-changed', 'busy', 'timeout', 'cookie-changed']);
const own = (value, key) => Object.getOwnPropertyDescriptor(value, key)?.value;
const exact = (value, fields, optional = []) => value && typeof value === 'object' && !Array.isArray(value) && Reflect.ownKeys(value).every(key => typeof key === 'string' && [...fields, ...optional].includes(key) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) && fields.every(key => Object.hasOwn(value, key));
const document = value => typeof value === 'string' && /^[A-Za-z0-9_:.-]{1,160}$/.test(value);
const text = (value, max) => typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(value);
const integer = (value, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= 0 && value <= max;
export function readCookieProbeRequest(value) {
  try {
    const type = own(value, 'type'), start = type === 'ui-start-cookie-probe';
    if (!['ui-start-cookie-probe', 'ui-get-cookie-probe', 'ui-cancel-cookie-probe'].includes(type) || !exact(value, ['schemaVersion', 'type', 'tabId', 'documentKey', ...(start ? ['handle'] : [])], ['frameId']) || own(value, 'schemaVersion') !== 1 || !integer(own(value, 'tabId')) || !document(own(value, 'documentKey'))) return null;
    const frameId = Object.hasOwn(value, 'frameId') ? own(value, 'frameId') : 0;
    if (frameId !== 0 || !own(value, 'documentKey').startsWith(own(value, 'tabId') + ':0:') || start && (typeof own(value, 'handle') !== 'string' || !/^[a-f0-9]{32}$/.test(own(value, 'handle')))) return null;
    return { schemaVersion: 1, type, tabId: own(value, 'tabId'), frameId: 0, documentKey: own(value, 'documentKey'), ...(start ? { handle: own(value, 'handle') } : {}) };
  } catch { return null; }
}
export function readCookieProbeSnapshot(value) {
  try {
    const fields = ['schemaVersion', 'type', 'documentKey', 'status', 'result', 'reason', 'cookieName', 'domain', 'owner', 'removalConfirmed', 'observedRestorations', 'source', 'cleanup', 'startedAt', 'completedAt', 'windowMs', 'matchedStores', 'storageCoverage'];
    if (!exact(value, fields) || own(value, 'schemaVersion') !== 1 || own(value, 'type') !== 'cookie-probe-state' || !document(own(value, 'documentKey')) || !COOKIE_PROBE_STATUSES.includes(own(value, 'status')) || !COOKIE_PROBE_RESULTS.includes(own(value, 'result')) || !COOKIE_PROBE_REASONS.includes(own(value, 'reason')) || !text(own(value, 'cookieName'), 80) || !text(own(value, 'owner'), 160) || !text(own(value, 'domain'), 253) || own(value, 'domain') && !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(own(value, 'domain')) || own(value, 'domain').includes('..') || typeof own(value, 'removalConfirmed') !== 'boolean' || !integer(own(value, 'observedRestorations'), 32) || own(value, 'source') !== 'unknown' || !['none', 'not-needed', 'restored', 'skipped', 'failed'].includes(own(value, 'cleanup')) || !integer(own(value, 'startedAt')) || !integer(own(value, 'completedAt')) || own(value, 'windowMs') !== 10000 || !['not-checked', 'active', 'partial', 'unsupported'].includes(own(value, 'storageCoverage'))) return null;
    const stores = own(value, 'matchedStores');
    if (!Array.isArray(stores) || stores.length > 3 || Reflect.ownKeys(stores).length !== stores.length + 1) return null;
    const matchedStores = [], seen = new Set();
    for (let i = 0; i < stores.length; i++) {
      const row = own(stores, i), storage = own(row, 'storage'), count = own(row, 'count');
      if (!exact(row, ['storage', 'count']) || !['localStorage', 'indexedDB', 'cacheStorage'].includes(storage) || seen.has(storage) || !integer(count, 64) || count < 1) return null;
      seen.add(storage); matchedStores.push({ storage, count });
    }
    const status = own(value, 'status'), result = own(value, 'result'), removed = own(value, 'removalConfirmed'), observations = own(value, 'observedRestorations');
    if (status === 'complete' && result === 'none' || status !== 'complete' && result !== 'none' || status === 'watching' && !removed || ['restored-same', 'recreated-different'].includes(result) && (!removed || observations < 1) || result === 'not-restored' && (!removed || observations !== 0 || own(value, 'completedAt') - own(value, 'startedAt') < 10000) || status === 'idle' && (removed || observations || own(value, 'startedAt') || own(value, 'completedAt')) || status !== 'complete' && own(value, 'completedAt') || status === 'complete' && own(value, 'completedAt') < own(value, 'startedAt')) return null;
    return Object.fromEntries(fields.map(key => [key, key === 'matchedStores' ? matchedStores : own(value, key)]));
  } catch { return null; }
}
export function readCookieProbeDocuments(value) {
  try {
    if (!Array.isArray(value) || value.length > 16 || Reflect.ownKeys(value).length !== value.length + 1) return null;
    const output = [], seen = new Set();
    for (let i = 0; i < value.length; i++) {
      const snapshot = readCookieProbeSnapshot(own(value, i));
      if (!snapshot || seen.has(snapshot.documentKey)) return null;
      seen.add(snapshot.documentKey); output.push(snapshot);
    }
    return output;
  } catch { return null; }
}
