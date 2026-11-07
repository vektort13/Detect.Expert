// ADR-037 / REQ-004/005/011/013: privileged outgoing Cookie values, Pro only.
export const PRO_COOKIE_VALUE_LIMITS = Object.freeze({ rows: 256, bytes: 262144, nameChars: 256, valueChars: 16384, headerChars: 65536, headerCount: 128, pairs: 512 });
const own = (value, key) => value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, 'value'));
const documentKey = value => typeof value === 'string' && /^[0-9]+:[0-9]+:[A-Za-z0-9_-]{1,64}$/.test(value) && value.length <= 160;
export const validProCookieName = value => typeof value === 'string' && /^[!#$%&'*+\-.^_\x60|~0-9A-Za-z]{1,256}$/.test(value);
export const validProCookieValue = value => typeof value === 'string' && value.length <= PRO_COOKIE_VALUE_LIMITS.valueChars && !/[\x00-\x1f\x7f;]/.test(value);
export const proCookieRowKey = row => JSON.stringify([row.documentKey, row.destinationHost, row.name, row.value]);
export const proCookieRowBytes = row => 256 + JSON.stringify(row).length * 2;
export function readProCookieValues(value) {
  try {
    if (!exact(value, ['documentKey', 'rows', 'truncated', 'supported']) || !documentKey(own(value, 'documentKey')) || typeof own(value, 'truncated') !== 'boolean' || typeof own(value, 'supported') !== 'boolean') return null;
    const input = own(value, 'rows');
    if (!Array.isArray(input) || input.length > PRO_COOKIE_VALUE_LIMITS.rows || Reflect.ownKeys(input).length !== input.length + 1 || !own(value, 'supported') && input.length) return null;
    const rows = [], seen = new Set(); let bytes = 512;
    const keys = ['documentKey', 'destinationHost', 'name', 'value', 'count', 'firstSeenAt', 'lastSeenAt'];
    const tabPrefix = own(value, 'documentKey').split(':')[0] + ':';
    for (let index = 0; index < input.length; ++index) {
      const item = own(input, index);
      if (!exact(item, keys)) return null;
      const row = Object.fromEntries(keys.map(key => [key, own(item, key)]));
      if (!documentKey(row.documentKey) || !row.documentKey.startsWith(tabPrefix) || typeof row.destinationHost !== 'string' || row.destinationHost.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:]+\])$/.test(row.destinationHost) || !validProCookieName(row.name) || !validProCookieValue(row.value) || !Number.isSafeInteger(row.count) || row.count < 1 || row.count > 2147483647 || !Number.isSafeInteger(row.firstSeenAt) || row.firstSeenAt < 0 || !Number.isSafeInteger(row.lastSeenAt) || row.lastSeenAt < row.firstSeenAt || row.lastSeenAt > 8640000000000000) return null;
      const key = proCookieRowKey(row);
      if (seen.has(key) || (bytes += proCookieRowBytes(row)) > PRO_COOKIE_VALUE_LIMITS.bytes) return null;
      seen.add(key); rows.push(row);
    }
    return { documentKey: own(value, 'documentKey'), rows, truncated: own(value, 'truncated'), supported: own(value, 'supported') };
  } catch { return null; }
}
