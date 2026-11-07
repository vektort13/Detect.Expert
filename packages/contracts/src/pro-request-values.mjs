// ADR-039 / REQ-004/005/011/013: native outgoing technical request values, Pro only.
export const PRO_REQUEST_VALUE_LIMITS = Object.freeze({ rows: 256, bytes: 262144, valueChars: 4096, headerChars: 65536, headerCount: 128 });
// Exact names only: never widen this into a Sec-* / Sec-CH-* wildcard.
export const PRO_REQUEST_HEADER_NAMES = Object.freeze([
  'User-Agent', 'Accept', 'Accept-Language', 'Accept-Encoding', 'DNT', 'Sec-GPC',
  'Sec-CH-UA', 'Sec-CH-UA-Arch', 'Sec-CH-UA-Bitness', 'Sec-CH-UA-Full-Version',
  'Sec-CH-UA-Full-Version-List', 'Sec-CH-UA-Mobile', 'Sec-CH-UA-Model',
  'Sec-CH-UA-Platform', 'Sec-CH-UA-Platform-Version', 'Sec-CH-UA-WoW64', 'Sec-CH-UA-Form-Factors',
  'Sec-CH-Prefers-Color-Scheme', 'Sec-CH-Prefers-Reduced-Motion', 'Sec-CH-Prefers-Reduced-Transparency',
  'Sec-CH-Device-Memory', 'Sec-CH-DPR', 'Sec-CH-Viewport-Height', 'Sec-CH-Viewport-Width', 'Sec-CH-Width',
  'Device-Memory', 'DPR', 'Viewport-Width', 'Width', 'Downlink', 'ECT', 'RTT', 'Save-Data',
  'Sec-Fetch-Site', 'Sec-Fetch-Mode', 'Sec-Fetch-User', 'Sec-Fetch-Dest', 'Sec-Fetch-Storage-Access'
]);
const headerNames = new Map(PRO_REQUEST_HEADER_NAMES.map(name => [name.toLowerCase(), name]));
const own = (value, key) => value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, 'value'));
const documentKey = value => typeof value === 'string' && /^[0-9]+:[0-9]+:[A-Za-z0-9_-]{1,64}$/.test(value) && value.length <= 160;
export const proRequestHeaderName = value => typeof value === 'string' && value.length <= 64 ? headerNames.get(value.toLowerCase()) ?? null : null;
export const validProRequestValue = value => typeof value === 'string' && value.length <= PRO_REQUEST_VALUE_LIMITS.valueChars && !/[\x00-\x08\x0a-\x1f\x7f]/.test(value);
export const proRequestRowKey = row => JSON.stringify([row.documentKey, row.destinationHost, row.name, row.value]);
export const proRequestRowBytes = row => 256 + JSON.stringify(row).length * 2;
export function readProRequestValues(value) {
  try {
    if (!exact(value, ['documentKey', 'rows', 'truncated', 'supported']) || !documentKey(own(value, 'documentKey')) || typeof own(value, 'truncated') !== 'boolean' || typeof own(value, 'supported') !== 'boolean') return null;
    const input = own(value, 'rows');
    if (!Array.isArray(input) || input.length > PRO_REQUEST_VALUE_LIMITS.rows || Reflect.ownKeys(input).length !== input.length + 1 || !own(value, 'supported') && input.length) return null;
    const rows = [], seen = new Set(); let bytes = 512;
    const keys = ['documentKey', 'destinationHost', 'name', 'value', 'count', 'firstSeenAt', 'lastSeenAt'];
    const tabPrefix = own(value, 'documentKey').split(':')[0] + ':';
    for (let index = 0; index < input.length; ++index) {
      const item = own(input, index);
      if (!exact(item, keys)) return null;
      const row = Object.fromEntries(keys.map(key => [key, own(item, key)]));
      if (!documentKey(row.documentKey) || !row.documentKey.startsWith(tabPrefix) || typeof row.destinationHost !== 'string' || row.destinationHost.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:]+\])$/.test(row.destinationHost) || proRequestHeaderName(row.name) !== row.name || !validProRequestValue(row.value) || !Number.isSafeInteger(row.count) || row.count < 1 || row.count > 2147483647 || !Number.isSafeInteger(row.firstSeenAt) || row.firstSeenAt < 0 || !Number.isSafeInteger(row.lastSeenAt) || row.lastSeenAt < row.firstSeenAt || row.lastSeenAt > 8640000000000000) return null;
      const key = proRequestRowKey(row);
      if (seen.has(key) || (bytes += proRequestRowBytes(row)) > PRO_REQUEST_VALUE_LIMITS.bytes) return null;
      seen.add(key); rows.push(row);
    }
    return { documentKey: own(value, 'documentKey'), rows, truncated: own(value, 'truncated'), supported: own(value, 'supported') };
  } catch { return null; }
}
