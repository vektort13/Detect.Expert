// ADR-029 / REQ-004/005/011: privileged current-visit resource inventory.
export const THIRD_PARTY_RESOURCE_TYPES = Object.freeze(['sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'webtransport', 'webbundle', 'other']);
const own = (value, key) => Object.getOwnPropertyDescriptor(value, key)?.value;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, 'value'));
const array = (value, max) => Array.isArray(value) && value.length <= max && Reflect.ownKeys(value).length === value.length + 1 && Array.from({ length: value.length }, (_, index) => Object.hasOwn(Object.getOwnPropertyDescriptor(value, index) ?? {}, 'value')).every(Boolean);
const document = value => typeof value === 'string' && /^[0-9]+:[0-9]+:[A-Za-z0-9_-]{1,64}$/.test(value) && value.length <= 160;
const host = value => typeof value === 'string' && value.length <= 253 && value.includes('.') && value.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 2147483647;
const paths = new Set('account accounts api app assets auth authentication blog browser browserleaks canvas cart catalog categories checkout client contact css dashboard data docs download fingerprint fonts forgot-password home images img index js javascript login logout main media news oauth password password-recovery pixelscan privacy product products profile recover recovery register registration reset reset-password resources script scripts search service services settings signup static status styles terms test tests user users v1 v2 v3 vendor vendors webgl webgpu webrtc'.split(' '));
const extensions = new Set(['js', 'mjs', 'css', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'woff', 'woff2', 'ttf', 'wasm', 'json', 'html', 'htm', 'php', 'aspx', 'map']);
export function thirdPartyPathTemplate(path) {
  if (typeof path !== 'string' || path.length > 16384) return null;
  return '/' + path.split('/').slice(1, 13).map(part => {
    if (!part) return '';
    const lower = part.toLowerCase();
    if (paths.has(lower)) return lower;
    const dot = lower.lastIndexOf('.'), extension = dot >= 0 ? lower.slice(dot + 1) : '';
    return extensions.has(extension) ? (paths.has(lower.slice(0, dot)) ? lower.slice(0, dot) : ':resource') + '.' + extension : ':segment';
  }).join('/');
}
const path = value => typeof value === 'string' && value.length <= 512 && value.startsWith('/') && thirdPartyPathTemplate(value) === value;
export function readThirdPartyRequest(value) {
  try {
    if (!exact(value, ['schemaVersion', 'type', 'tabId', 'frameId', 'documentKey']) || own(value, 'schemaVersion') !== 1 || own(value, 'type') !== 'ui-get-third-party' || !Number.isSafeInteger(own(value, 'tabId')) || own(value, 'tabId') < 0 || own(value, 'frameId') !== 0 || !document(own(value, 'documentKey')) || !own(value, 'documentKey').startsWith(own(value, 'tabId') + ':0:')) return null;
    return { schemaVersion: 1, type: 'ui-get-third-party', tabId: own(value, 'tabId'), frameId: 0, documentKey: own(value, 'documentKey') };
  } catch { return null; }
}
export function readThirdPartyRows(value, max = 1024) {
  try {
    if (!array(value, max)) return null;
    const keys = ['domain', 'pathTemplate', 'type', 'relation', 'requestCount', 'completedCount', 'failedCount', 'redirectCount', 'statusCodes', 'documentKey', 'documentHost', 'initiatorHost', 'evidenceSource', 'integrity', 'attributionConfidence', 'script'];
    const result = [], seen = new Set(), sources = new Map();
    let bytes = 512;
    for (let index = 0; index < value.length; ++index) {
      const row = own(value, index);
      if (!exact(row, keys) || !host(own(row, 'domain')) || !path(own(row, 'pathTemplate')) || !THIRD_PARTY_RESOURCE_TYPES.includes(own(row, 'type')) || !['cross-site', 'unknown'].includes(own(row, 'relation')) || !document(own(row, 'documentKey')) || !['documentHost', 'initiatorHost'].every(key => own(row, key) === null || host(own(row, key))) || !['requestCount', 'completedCount', 'failedCount', 'redirectCount'].every(key => count(own(row, key))) || own(row, 'requestCount') < 1 || !['frame-only', 'unknown'].includes(own(row, 'attributionConfidence')) || own(row, 'script') !== null) return null;
      const source = own(row, 'evidenceSource'), browser = source === 'browser-network';
      if (!(browser && own(row, 'integrity') === 'browser-observed' || source === 'page-dom' && own(row, 'integrity') === 'page-controlled') || !browser && (own(row, 'completedCount') || own(row, 'failedCount') || own(row, 'redirectCount'))) return null;
      const statuses = own(row, 'statusCodes');
      if (!array(statuses, 16) || statuses.some(status => !Number.isSafeInteger(status) || status < 100 || status > 599) || new Set(statuses).size !== statuses.length || !browser && statuses.length) return null;
      const key = [own(row, 'documentKey'), source, own(row, 'domain'), own(row, 'pathTemplate'), own(row, 'type'), own(row, 'initiatorHost') ?? ''].join('|');
      if (seen.has(key) || sources.has(own(row, 'documentKey')) && sources.get(own(row, 'documentKey')) !== source) return null;
      seen.add(key); sources.set(own(row, 'documentKey'), source);
      const output = Object.fromEntries(keys.map(key => [key, key === 'statusCodes' ? statuses.slice() : own(row, key)]));
      bytes += 256 + JSON.stringify(output).length * 2;
      if (bytes > 1048576) return null;
      result.push(output);
    }
    return result;
  } catch { return null; }
}
export function readThirdPartySnapshot(value) {
  try {
    if (!exact(value, ['schemaVersion', 'type', 'documentKey', 'coverageState', 'rows', 'truncated']) || own(value, 'schemaVersion') !== 1 || own(value, 'type') !== 'third-party-state' || !document(own(value, 'documentKey')) || own(value, 'documentKey').split(':')[1] !== '0' || !['active', 'partial', 'late-start', 'paused', 'unsupported', 'no-access', 'degraded'].includes(own(value, 'coverageState')) || typeof own(value, 'truncated') !== 'boolean') return null;
    const rows = readThirdPartyRows(own(value, 'rows'));
    if (rows === null || rows.some(row => row.documentKey.split(':')[0] !== own(value, 'documentKey').split(':')[0]) || ['no-access', 'unsupported', 'paused'].includes(own(value, 'coverageState')) && rows.length) return null;
    return { schemaVersion: 1, type: 'third-party-state', documentKey: own(value, 'documentKey'), coverageState: own(value, 'coverageState'), rows, truncated: own(value, 'truncated') };
  } catch { return null; }
}
export function readThirdPartyTiming(value) {
  try {
    if (!exact(value, ['schemaVersion', 'type', 'available', 'rows', 'truncated']) || own(value, 'schemaVersion') !== 1 || own(value, 'type') !== 'third-party-timing-cache' || typeof own(value, 'available') !== 'boolean' || typeof own(value, 'truncated') !== 'boolean' || !array(own(value, 'rows'), 256)) return null;
    const rows = [], seen = new Set();
    for (let index = 0; index < own(value, 'rows').length; ++index) {
      const row = own(own(value, 'rows'), index);
      if (!exact(row, ['domain', 'pathTemplate', 'type', 'requestCount']) || !host(own(row, 'domain')) || !path(own(row, 'pathTemplate')) || !THIRD_PARTY_RESOURCE_TYPES.includes(own(row, 'type')) || !count(own(row, 'requestCount')) || own(row, 'requestCount') < 1) return null;
      const output = { domain: own(row, 'domain'), pathTemplate: own(row, 'pathTemplate'), type: own(row, 'type'), requestCount: own(row, 'requestCount') }, key = output.domain + '|' + output.pathTemplate + '|' + output.type;
      if (seen.has(key)) return null;
      seen.add(key); rows.push(output);
    }
    if (!own(value, 'available') && rows.length) return null;
    return { schemaVersion: 1, type: 'third-party-timing-cache', available: own(value, 'available'), rows, truncated: own(value, 'truncated') };
  } catch { return null; }
}
