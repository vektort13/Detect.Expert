// DET-049 / REQ-002/004/005/011: cookie setter names and script attribution only.
export const COOKIE_WRITER_LIMITS = Object.freeze({ rows: 64, bytes: 24576, documents: 24, totalRows: 256, nameChars: 256 });
const own = (value, key) => value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, 'value'));
const doc = value => typeof value === 'string' && /^[0-9]+:[0-9]+:[A-Za-z0-9_-]{1,64}$/.test(value) && value.length <= 160;
const array = (value, max) => Array.isArray(value) && value.length <= max && Reflect.ownKeys(value).length === value.length + 1;
const cookieName = value => typeof value === 'string' && /^[!#$%&'*+\-.^_\x60|~0-9A-Za-z]{1,256}$/.test(value);
const scriptHost = value => typeof value === 'string' && value.length <= 253 && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value) && !value.includes('..');
const scriptPath = value => typeof value === 'string' && /^\/(?:<script>|(?:main|client|script|sdk|gtm|fbevents|widgets|tracker|analytics)\.(?:js|mjs))$/.test(value);
export const cookieWriterRowKey = row => row.name.length + ':' + row.name + ':' + row.phase + ':' + row.attributionConfidence + ':' + (row.script?.host ?? '') + ':' + (row.script?.pathTemplate ?? '');
export const cookieWriterRowBytes = row => 512 + cookieWriterRowKey(row).length * 2;
export function readCookieWriterRequest(value) {
  try {
    const frameId = Object.hasOwn(value, 'frameId') ? own(value, 'frameId') : 0;
    const keys = ['schemaVersion', 'type', 'tabId', 'documentKey']; if (Object.hasOwn(value, 'frameId')) keys.push('frameId');
    const tabId = own(value, 'tabId'), documentKey = own(value, 'documentKey');
    if (!exact(value, keys) || own(value, 'schemaVersion') !== 1 || own(value, 'type') !== 'ui-get-cookie-writers' || !Number.isSafeInteger(tabId) || tabId < 0 || !Number.isSafeInteger(frameId) || frameId < 0 || !doc(documentKey) || !documentKey.startsWith(tabId + ':' + frameId + ':')) return null;
    return { schemaVersion: 1, type: 'ui-get-cookie-writers', tabId, frameId, documentKey };
  } catch { return null; }
}
export function readCookieWriterRows(value) {
  try {
    if (!array(value, COOKIE_WRITER_LIMITS.rows)) return null;
    const rows = [], seen = new Set(); let bytes = 512;
    const keys = ['name', 'phase', 'script', 'attributionConfidence', 'evidenceSource', 'integrity', 'count'];
    for (let index = 0; index < value.length; ++index) {
      const item = own(value, index);
      if (!exact(item, keys)) return null;
      const row = Object.fromEntries(keys.map(key => [key, own(item, key)]));
      if (!cookieName(row.name) || !['returned-sync', 'threw-sync'].includes(row.phase) || row.evidenceSource !== 'page-hook' || row.integrity !== 'page-controlled' || !['exact-resource', 'sampled-stack', 'unknown'].includes(row.attributionConfidence) || !Number.isSafeInteger(row.count) || row.count < 1 || row.count > 2147483647) return null;
      if (row.script === null) { if (row.attributionConfidence !== 'unknown') return null; }
      else {
        if (row.attributionConfidence === 'unknown' || !exact(row.script, ['host', 'pathTemplate'])) return null;
        const host = own(row.script, 'host'), pathTemplate = own(row.script, 'pathTemplate');
        if (!scriptHost(host) || !scriptPath(pathTemplate)) return null;
        row.script = { host, pathTemplate };
      }
      const key = cookieWriterRowKey(row);
      if (seen.has(key) || (bytes += cookieWriterRowBytes(row)) > COOKIE_WRITER_LIMITS.bytes) return null;
      seen.add(key); rows.push(row);
    }
    return rows;
  } catch { return null; }
}
export function readCookieWriterSnapshot(value) {
  try {
    if (!exact(value, ['schemaVersion', 'type', 'documentKey', 'coverageState', 'rows', 'truncated']) || own(value, 'schemaVersion') !== 1 || own(value, 'type') !== 'cookie-writers-state' || !doc(own(value, 'documentKey')) || !['active', 'partial', 'late-start', 'paused', 'unsupported', 'no-access', 'degraded'].includes(own(value, 'coverageState')) || typeof own(value, 'truncated') !== 'boolean') return null;
    const rows = readCookieWriterRows(own(value, 'rows'));
    if (!rows || rows.length && ['paused', 'unsupported', 'no-access'].includes(own(value, 'coverageState'))) return null;
    return { schemaVersion: 1, type: 'cookie-writers-state', documentKey: own(value, 'documentKey'), coverageState: own(value, 'coverageState'), rows, truncated: own(value, 'truncated') };
  } catch { return null; }
}
export function readCookieWriterCache(value) {
  try {
    if (!exact(value, ['schemaVersion', 'type', 'available', 'rows', 'truncated']) || own(value, 'schemaVersion') !== 1 || own(value, 'type') !== 'cookie-writers-cache' || typeof own(value, 'available') !== 'boolean' || typeof own(value, 'truncated') !== 'boolean') return null;
    const rows = readCookieWriterRows(own(value, 'rows'));
    if (!rows || !own(value, 'available') && rows.length) return null;
    return { schemaVersion: 1, type: 'cookie-writers-cache', available: own(value, 'available'), rows, truncated: own(value, 'truncated') };
  } catch { return null; }
}
export function readCookieWriterDocuments(value) {
  try {
    if (!array(value, COOKIE_WRITER_LIMITS.documents)) return null;
    const documents = [], seen = new Set(); let count = 0;
    for (let index = 0; index < value.length; ++index) {
      const snapshot = readCookieWriterSnapshot(own(value, index));
      if (!snapshot || seen.has(snapshot.documentKey) || (count += snapshot.rows.length) > COOKIE_WRITER_LIMITS.totalRows) return null;
      seen.add(snapshot.documentKey); documents.push(snapshot);
    }
    return documents;
  } catch { return null; }
}
