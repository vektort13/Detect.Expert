// ADR-063: own Options-only browser data, never a page sensor or a background collector.
export const BROWSER_DEBUG_LIMITS = Object.freeze({ rows: 200, scan: 2000, string: 4096, bytes: 262144, deadline: 5000, snapshots: 8 });
const dataset = (id, permissions, columns, create = false, options = {}) => Object.freeze({ id, permissions: Object.freeze(permissions), columns: Object.freeze(columns), create, ...options });
export const BROWSER_DEBUG_DATASETS = Object.freeze([
  dataset('overview', [], ['name', 'value']),
  dataset('history', ['history'], ['title', 'url', 'lastVisitTime', 'visitCount'], true),
  dataset('bookmarks', ['bookmarks'], ['title', 'url', 'parentId', 'dateAdded'], true),
  dataset('downloads', ['downloads'], ['name', 'url', 'state', 'bytesReceived', 'totalBytes']),
  dataset('cookies', ['cookies'], ['name', 'domain', 'path', 'expirationDate', 'secure', 'httpOnly'], false, { origin: true }),
  dataset('tabs', ['tabs'], ['title', 'url', 'windowId', 'pinned', 'muted']),
  dataset('sessions', ['sessions'], ['name', 'title', 'url', 'lastModified']),
  dataset('top-sites', ['topSites'], ['title', 'url']),
  dataset('reading-list', ['readingList'], ['title', 'url', 'hasBeenRead', 'creationTime'], true),
  dataset('extensions', ['management'], ['name', 'version', 'enabled', 'type', 'installType']),
  dataset('privacy', ['privacy'], ['name', 'value', 'levelOfControl']),
  dataset('site-permissions', ['contentSettings'], ['name', 'value', 'origin'], false, { origin: true }),
  dataset('system', ['system.cpu', 'system.memory', 'system.storage', 'system.display'], ['name', 'value']),
  dataset('account', ['identity', 'identity.email'], ['name', 'value']),
  dataset('internals', [], ['name', 'url']),
]);
export const BROWSER_DEBUG_CHROME_OPTIONAL = Object.freeze([...new Set(BROWSER_DEBUG_DATASETS.flatMap(item => item.permissions))]);
export const BROWSER_DEBUG_FIREFOX_OPTIONAL = Object.freeze(BROWSER_DEBUG_CHROME_OPTIONAL.filter(permission => !['readingList', 'contentSettings', 'identity.email', 'system.cpu', 'system.memory', 'system.storage', 'system.display'].includes(permission)));

export class BrowserDebugError extends Error {
  constructor(code = 'operation-failed') { super(code); this.name = 'BrowserDebugError'; this.code = code; }
}
export const debugFail = code => { throw new BrowserDebugError(code); };
export function debugText(value, max = BROWSER_DEBUG_LIMITS.string) { return typeof value === 'string' ? value.slice(0, max) : ''; }
export function debugNumber(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
export function debugHttpUrl(value, { origin = false } = {}) {
  if (typeof value !== 'string' || value.length > BROWSER_DEBUG_LIMITS.string) debugFail('invalid-input');
  let parsed; try { parsed = new URL(value); } catch { debugFail('invalid-input'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || !parsed.hostname) debugFail('invalid-input');
  return origin ? parsed.origin : parsed.href;
}
export function debugInputText(value, max = 512, empty = false) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) debugFail('invalid-input');
  return value;
}
export function debugExact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) debugFail('invalid-input');
  return value;
}
export function debugField(key, type, value, options = {}) { return { key, type, value, ...options }; }
export function debugRecord(values, reference = null, actions = []) { return { values, reference, actions }; }
export function debugSame(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
