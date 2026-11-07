// ADR-109 (owner order, 2026-11-06): Proxy Manager Geolocation API. The shared contract of the feature: names, limits, the provider
// catalogue, strict readers for every stored value and the one normalised record all four providers are mapped to. Pure data and
// validation: no chrome.*, no network, no DOM, no import of the proxy configuration, so the standalone settings page stays small.
// Every reader returns a fresh canonical object (or the default / null): an unexpected stored value is dropped, never repaired from
// guesses. External text is untrusted: it is cleaned and bounded here and is only ever rendered as a text node.

export const GEO_SETTINGS_KEY = 'proxy-geo-settings:v1';
export const GEO_CREDENTIALS_KEY = 'proxy-geo-credentials:v1';
export const GEO_CACHE_KEY = 'proxy-geo-cache:v1';

// The fixed priority order of the providers (the lookup tries them top to bottom). MaxMind is the owner's recommended one.
export const GEO_PROVIDERS = Object.freeze(['maxmind', 'ipgeolocation', 'ipdata', 'ipapi']);
export const GEO_MAXMIND_SERVICES = Object.freeze(['geolite-city', 'geoip-city', 'geoip-insights']);
// Optional columns the manager adds while the feature is on (fixed order). They describe the exit IP of a manual check.
export const GEO_COLUMNS = Object.freeze(['geo', 'geonet', 'geokind', 'geoflags', 'geotime']);
// What a provider says the address is used for, as one small vocabulary. '' means the provider did not say.
export const GEO_KINDS = Object.freeze(['residential', 'hosting', 'mobile', 'business', 'education', 'government', 'isp', 'cdn', 'other']);
// Provider flags. true / false are what the provider reported; null is "not reported" (a plan or service without that data).
// `proxy` is the provider's own proxy flag (ip-api's also covers VPN and Tor); the chip tooltip says so. No flag is a verdict.
export const GEO_FLAGS = Object.freeze(['proxy', 'vpn', 'tor', 'hosting', 'mobile', 'relay', 'residentialProxy', 'threat']);

export const GEO_ERRORS = Object.freeze([
  'disabled',          // local: the master switch is off
  'no-provider',       // local: no provider is ready (switch on, but nothing enabled with a key)
  'not-public',        // not a public IP address (checked locally before anything is sent, or refused by the provider as private/reserved)
  'no-key',            // local: the provider needs a key that is not set
  'http-not-allowed',  // local: the free ip-api endpoint is plain HTTP and the user has not accepted that
  'unauthorized',      // the provider rejected the key (HTTP 401, AUTHORIZATION_INVALID, ...)
  'forbidden',         // HTTP 403 that is not a quota (key restrictions, allow-list, missing permission)
  'plan',              // the key's plan does not include a requested feature (ipgeolocation include=security answers 401)
  'quota',             // the daily or credit quota is used up (HTTP 402, 403 on a used-up plan, MaxMind INSUFFICIENT_FUNDS)
  'rate-limited',      // HTTP 429 or the provider's own rate window
  'not-found',         // the provider has no data for this address
  'timeout', 'network',// no usable response
  'server',            // HTTP 5xx
  'bad-response',      // not JSON, wrong content type, too large or an unexpected shape
]);
// Errors after which the next ready provider may still answer (the same address goes to one more provider the user configured).
export const GEO_FAILOVER_ERRORS = Object.freeze(['unauthorized', 'forbidden', 'plan', 'quota', 'rate-limited', 'not-found', 'timeout', 'network', 'server', 'bad-response']);
// Errors that may go away by themselves: the UI offers a retry; they are not remembered as a verdict on the address.
export const GEO_TRANSIENT_ERRORS = Object.freeze(['rate-limited', 'timeout', 'network', 'server']);

export const GEO_LIMITS = Object.freeze({
  textChars: 80, keyChars: 256, keyMinChars: 8, accountIdChars: 12,
  cacheEntries: 200, cacheMaxAgeMs: 30 * 24 * 60 * 60 * 1000, freshMs: 24 * 60 * 60 * 1000, futureSlackMs: 24 * 60 * 60 * 1000,
  errorMemoryMs: 10 * 60 * 1000, responseBytes: 65536, requestMs: 12000, concurrency: 2,
});
// The key test of a provider looks this address up: a public documentation-style address of a well-known resolver, never a user's own.
export const GEO_TEST_IP = '8.8.8.8';

// One catalogue entry per provider. `origins` are exactly the CSP connect-src hosts (and so the only hosts this feature may reach);
// `credentials` are the secret fields the settings page asks for; `keyOptional` means the provider answers without a key (ip-api free).
export const GEO_PROVIDER_INFO = Object.freeze({
  maxmind: Object.freeze({ id: 'maxmind', name: 'MaxMind GeoIP / GeoLite', recommended: true, docsUrl: 'https://dev.maxmind.com/geoip/',
    origins: Object.freeze(['https://geolite.info', 'https://geoip.maxmind.com']), credentials: Object.freeze(['accountId', 'licenseKey']), keyOptional: false }),
  ipgeolocation: Object.freeze({ id: 'ipgeolocation', name: 'ipgeolocation.io', recommended: false, docsUrl: 'https://ipgeolocation.io/documentation/ip-location-api.html',
    origins: Object.freeze(['https://api.ipgeolocation.io']), credentials: Object.freeze(['apiKey']), keyOptional: false }),
  ipdata: Object.freeze({ id: 'ipdata', name: 'ipdata', recommended: false, docsUrl: 'https://docs.ipdata.co/',
    origins: Object.freeze(['https://api.ipdata.co']), credentials: Object.freeze(['apiKey']), keyOptional: false }),
  ipapi: Object.freeze({ id: 'ipapi', name: 'ip-api.com', recommended: false, docsUrl: 'https://ip-api.com/docs',
    origins: Object.freeze(['http://ip-api.com', 'https://pro.ip-api.com']), credentials: Object.freeze(['apiKey']), keyOptional: true }),
});
// The connect-src hosts of this feature in catalogue order. The manifest CSP is `connect-src https://api.cloudflare.com ` + these.
export const geoConnectOrigins = () => GEO_PROVIDERS.flatMap(id => GEO_PROVIDER_INFO[id].origins);

// ---- Small strict-reading helpers ----------------------------------------------------------------------------------------------
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
  && Reflect.ownKeys(value).every(key => typeof key === 'string' && key !== '__proto__' && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
const hasExactly = (value, keys) => { const own = Object.keys(value); return own.length === keys.length && keys.every(key => Object.hasOwn(value, key)); };
const isInt = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;

// ---- External text -------------------------------------------------------------------------------------------------------------
// Control characters, bidi controls, zero-width and line/paragraph separators never reach the UI: a provider string cannot reorder
// or hide text. Built from code points at run time so the source holds no invisible character.
const BACKSLASH = String.fromCharCode(92);
const FORBIDDEN_RANGES = Object.freeze([[0, 31], [127, 159], [0x061c, 0x061c], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x2069], [0xfeff, 0xfeff]]);
const hex = code => BACKSLASH + 'u{' + code.toString(16) + '}';
const FORBIDDEN_TEXT = new RegExp('[' + FORBIDDEN_RANGES.map(([from, to]) => hex(from) + (to > from ? '-' + hex(to) : '')).join('') + ']', 'gu');
export const geoHasForbiddenText = value => typeof value === 'string' && new RegExp(FORBIDDEN_TEXT.source, 'u').test(value);
/** A provider string as safe display text: '' for anything but a string, forbidden characters removed, spaces collapsed, bounded. */
export function geoText(value, max = GEO_LIMITS.textChars) {
  if (typeof value !== 'string') return '';
  const cleaned = value.slice(0, max * 4).replace(FORBIDDEN_TEXT, ' ').replace(/\s+/g, ' ').trim();
  return [...cleaned].slice(0, max).join('').trim();
}

// ---- Language for Intl ---------------------------------------------------------------------------------------------------------
/** The language tag to hand to Intl: Wu Chinese (wuu) has no Intl data (it would read as English), so it is formatted like Simplified
 *  Chinese; every other tag is used as given. */
export const geoIntlTag = tag => (typeof tag === 'string' && /^wuu(?:[-_]|$)/i.test(tag) ? 'zh-Hans' : tag);

// ---- Addresses -----------------------------------------------------------------------------------------------------------------
const IPV4 = /^(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})$/;
function ipv4Octets(text) {
  const match = IPV4.exec(text);
  if (!match) return null;
  const octets = match.slice(1).map(Number);
  return octets.every(part => part <= 255) ? octets : null;
}
/** The canonical lower-case text of an IPv4 / IPv6 address, or null (a host name, a zone id, a port, brackets, a prefix, anything else).
 *  An IPv4-mapped IPv6 address (::ffff:a.b.c.d) is returned as the plain IPv4 address. */
export function geoCanonicalIp(value) {
  if (typeof value !== 'string' || value.length < 2 || value.length > 45) return null;
  const text = value.toLowerCase();
  if (!text.includes(':')) return ipv4Octets(text) ? text : null;
  if (!/^[0-9a-f:.]+$/.test(text)) return null;
  let host;
  try { host = new URL('http://[' + text + ']/').hostname; } catch { return null; }
  if (!host.startsWith('[') || !host.endsWith(']')) return null;
  const canonical = host.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical);
  if (mapped) {
    const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
    return [high >> 8, high & 255, low >> 8, low & 255].join('.');
  }
  return canonical;
}
function ipv6Groups(canonical) {
  const [head, tail = null] = canonical.split('::');
  const first = head === '' ? [] : head.split(':');
  const last = tail === null || tail === '' ? [] : tail.split(':');
  if (tail === null) return first.length === 8 ? first.map(part => parseInt(part, 16)) : null;
  const fill = 8 - first.length - last.length;
  return fill < 0 ? null : [...first, ...Array(fill).fill('0'), ...last].map(part => parseInt(part, 16));
}
/** True for a globally routable unicast address; private, loopback, link-local, CGNAT, documentation, multicast, reserved and
 *  translation ranges are not public. Takes the output of geoCanonicalIp. Nothing is ever sent for a non-public address. */
export function geoIsPublicIp(canonical) {
  if (typeof canonical !== 'string') return false;
  const octets = canonical.includes(':') ? null : ipv4Octets(canonical);
  if (octets) {
    const [a, b, c] = octets;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && ((b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99) || b === 168)) return false;
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (!canonical.includes(':')) return false;
  const groups = ipv6Groups(canonical);
  if (!groups || groups.length !== 8 || groups.some(group => !Number.isInteger(group))) return false;
  const [first, second] = groups;
  if ((first & 0xe000) !== 0x2000) return false;               // only 2000::/3 is global unicast
  if (first === 0x2001 && second === 0x0db8) return false;     // documentation
  if (first === 0x3fff && (second & 0xf000) === 0) return false; // documentation (RFC 9637)
  return true;
}

// ---- Settings ------------------------------------------------------------------------------------------------------------------
const PROVIDER_SETTING_KEYS = Object.freeze({ maxmind: ['enabled', 'service'], ipgeolocation: ['enabled', 'security'], ipdata: ['enabled'], ipapi: ['enabled', 'http'] });
export function defaultGeoSettings() {
  return {
    version: 1, enabled: false, auto: true, failover: true, remember: false, columns: [...GEO_COLUMNS],
    providers: { maxmind: { enabled: false, service: 'geolite-city' }, ipgeolocation: { enabled: false, security: false }, ipdata: { enabled: false }, ipapi: { enabled: false, http: false } },
  };
}
function providerSettings(id, raw) {
  if (!isRecord(raw) || !hasExactly(raw, PROVIDER_SETTING_KEYS[id]) || typeof raw.enabled !== 'boolean') return null;
  if (id === 'maxmind') return GEO_MAXMIND_SERVICES.includes(raw.service) ? { enabled: raw.enabled, service: raw.service } : null;
  if (id === 'ipgeolocation') return typeof raw.security === 'boolean' ? { enabled: raw.enabled, security: raw.security } : null;
  if (id === 'ipapi') return typeof raw.http === 'boolean' ? { enabled: raw.enabled, http: raw.http } : null;
  return { enabled: raw.enabled };
}
const canonicalColumns = list => GEO_COLUMNS.filter(column => list.includes(column));
/** Strict read of the stored settings. Anything unexpected is the default: the feature off, nothing remembered. */
export function normalizeGeoSettings(raw) {
  if (!isRecord(raw) || raw.version !== 1 || !hasExactly(raw, ['version', 'enabled', 'auto', 'failover', 'remember', 'columns', 'providers'])) return defaultGeoSettings();
  if (['enabled', 'auto', 'failover', 'remember'].some(key => typeof raw[key] !== 'boolean')) return defaultGeoSettings();
  if (!Array.isArray(raw.columns) || raw.columns.length > GEO_COLUMNS.length || raw.columns.some(column => !GEO_COLUMNS.includes(column)) || new Set(raw.columns).size !== raw.columns.length) return defaultGeoSettings();
  if (!isRecord(raw.providers) || !hasExactly(raw.providers, GEO_PROVIDERS)) return defaultGeoSettings();
  const providers = {};
  for (const id of GEO_PROVIDERS) { const value = providerSettings(id, raw.providers[id]); if (!value) return defaultGeoSettings(); providers[id] = value; }
  return { version: 1, enabled: raw.enabled, auto: raw.auto, failover: raw.failover, remember: raw.remember, columns: canonicalColumns(raw.columns), providers };
}
/** The settings after a partial patch { enabled, auto, failover, remember, columns, providers: { id: { enabled, service, security, http } } }.
 *  Every part of the patch that is not valid is ignored, so one bad value never resets the rest. */
export function geoSettingsPatch(settings, patch) {
  const base = normalizeGeoSettings(settings), next = { ...base, columns: [...base.columns], providers: Object.fromEntries(GEO_PROVIDERS.map(id => [id, { ...base.providers[id] }])) };
  if (!isRecord(patch)) return normalizeGeoSettings(next);
  for (const key of ['enabled', 'auto', 'failover', 'remember']) if (typeof patch[key] === 'boolean') next[key] = patch[key];
  if (Array.isArray(patch.columns) && patch.columns.every(column => GEO_COLUMNS.includes(column))) next.columns = canonicalColumns(patch.columns);
  if (isRecord(patch.providers)) for (const id of GEO_PROVIDERS) {
    const part = patch.providers[id];
    if (!isRecord(part)) continue;
    const merged = { ...next.providers[id] };
    for (const key of PROVIDER_SETTING_KEYS[id]) if (Object.hasOwn(part, key)) merged[key] = part[key];
    const checked = providerSettings(id, merged);
    if (checked) next.providers[id] = checked;
    else if (typeof part.enabled === 'boolean') next.providers[id] = { ...next.providers[id], enabled: part.enabled };
  }
  return normalizeGeoSettings(next);
}

// ---- Credentials ---------------------------------------------------------------------------------------------------------------
/** A pasted key: trimmed, 8 to 256 printable ASCII characters without spaces. null for anything else. */
export function geoCleanKey(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text.length < GEO_LIMITS.keyMinChars || text.length > GEO_LIMITS.keyChars) return null;
  for (let index = 0; index < text.length; index++) { const code = text.charCodeAt(index); if (code < 0x21 || code > 0x7e) return null; }
  return text;
}
/** A MaxMind account ID: digits only. null for anything else. */
export function geoCleanAccountId(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return /^[0-9]{1,12}$/.test(text) ? text : null;
}
/** The canonical credential of a provider ({ accountId, licenseKey } or { apiKey }), or null when a field is missing or malformed. */
export function geoCleanCredential(id, value) {
  if (!GEO_PROVIDERS.includes(id) || !isRecord(value)) return null;
  if (id === 'maxmind') {
    if (!hasExactly(value, ['accountId', 'licenseKey'])) return null;
    const accountId = geoCleanAccountId(value.accountId), licenseKey = geoCleanKey(value.licenseKey);
    return accountId && licenseKey ? { accountId, licenseKey } : null;
  }
  if (!hasExactly(value, ['apiKey'])) return null;
  const apiKey = geoCleanKey(value.apiKey);
  return apiKey ? { apiKey } : null;
}
export const emptyGeoCredentials = () => ({ version: 1, items: {} });
/** Strict read of the stored credentials: each provider is kept or dropped on its own. */
export function normalizeGeoCredentials(raw) {
  if (!isRecord(raw) || raw.version !== 1 || !hasExactly(raw, ['version', 'items']) || !isRecord(raw.items)) return emptyGeoCredentials();
  const items = {};
  for (const id of GEO_PROVIDERS) if (Object.hasOwn(raw.items, id)) { const credential = geoCleanCredential(id, raw.items[id]); if (credential) items[id] = credential; }
  return { version: 1, items };
}
/** Whether a provider can be asked now, and if not why: { enabled, hasKey, ready, reason } with reason '' | 'disabled' | 'no-key' | 'http-not-allowed'. */
export function geoProviderState(settings, credentials, id) {
  const config = normalizeGeoSettings(settings).providers[id], items = normalizeGeoCredentials(credentials).items;
  if (!config) return { enabled: false, hasKey: false, ready: false, reason: 'disabled' };
  const hasKey = Object.hasOwn(items, id);
  if (!config.enabled) return { enabled: false, hasKey, ready: false, reason: 'disabled' };
  if (hasKey) return { enabled: true, hasKey, ready: true, reason: '' };
  if (id === 'ipapi') return config.http === true ? { enabled: true, hasKey, ready: true, reason: '' } : { enabled: true, hasKey, ready: false, reason: 'http-not-allowed' };
  return { enabled: true, hasKey, ready: false, reason: 'no-key' };
}
/** The ids of the providers that can be asked now, in priority order. */
export const geoReadyProviders = (settings, credentials) => GEO_PROVIDERS.filter(id => geoProviderState(settings, credentials, id).ready);

// ---- The normalised record -----------------------------------------------------------------------------------------------------
export const geoEmptyFlags = () => Object.fromEntries(GEO_FLAGS.map(flag => [flag, null]));
const RECORD_KEYS = Object.freeze(['provider', 'service', 'at', 'ip', 'country', 'countryName', 'region', 'city', 'timezone', 'asn', 'org', 'isp', 'kind', 'flags']);
const TEXT_FIELDS = Object.freeze(['countryName', 'region', 'city', 'org', 'isp']);
const TIMEZONE = /^[A-Za-z0-9_+\-/]{1,64}$/;
/** A strict read of a record (a stored one, or a freshly parsed one): a fresh canonical object, or null. `service` is '' except for MaxMind. */
export function normalizeGeoRecord(raw, now = Date.now()) {
  if (!isRecord(raw) || !hasExactly(raw, RECORD_KEYS)) return null;
  if (!GEO_PROVIDERS.includes(raw.provider) || (raw.provider === 'maxmind' ? !GEO_MAXMIND_SERVICES.includes(raw.service) : raw.service !== '')) return null;
  if (!isInt(raw.at, 0, now + GEO_LIMITS.futureSlackMs)) return null;
  const ip = geoCanonicalIp(raw.ip);
  if (ip === null || ip !== raw.ip || !geoIsPublicIp(ip)) return null;
  if (typeof raw.country !== 'string' || (raw.country !== '' && !/^[A-Z]{2}$/.test(raw.country))) return null;
  for (const field of TEXT_FIELDS) if (typeof raw[field] !== 'string' || geoText(raw[field]) !== raw[field]) return null;
  if (typeof raw.timezone !== 'string' || (raw.timezone !== '' && !TIMEZONE.test(raw.timezone))) return null;
  if (raw.asn !== null && !isInt(raw.asn, 1, 4294967295)) return null;
  if (raw.kind !== '' && !GEO_KINDS.includes(raw.kind)) return null;
  if (!isRecord(raw.flags) || !hasExactly(raw.flags, GEO_FLAGS) || GEO_FLAGS.some(flag => raw.flags[flag] !== null && typeof raw.flags[flag] !== 'boolean')) return null;
  const record = { provider: raw.provider, service: raw.service, at: raw.at, ip, country: raw.country };
  for (const field of ['countryName', 'region', 'city']) record[field] = raw[field];
  record.timezone = raw.timezone; record.asn = raw.asn; record.org = raw.org; record.isp = raw.isp; record.kind = raw.kind;
  record.flags = Object.fromEntries(GEO_FLAGS.map(flag => [flag, raw.flags[flag]]));
  return record;
}
/** Whether a record says anything at all (a provider that answered with an empty body is not a result). */
export const geoRecordHasData = record => Boolean(record) && (record.country !== '' || record.city !== '' || record.region !== '' || record.asn !== null || record.org !== '' || record.isp !== '' || record.kind !== '' || GEO_FLAGS.some(flag => record.flags[flag] !== null));

// ---- The result cache (storage.local, bounded) ----------------------------------------------------------------------------------
export const emptyGeoCache = () => ({ version: 1, items: {} });
/** Strict read of the stored cache: valid records of the right address that are not older than 30 days, the newest 200. */
export function normalizeGeoCache(raw, now = Date.now()) {
  if (!isRecord(raw) || raw.version !== 1 || !hasExactly(raw, ['version', 'items']) || !isRecord(raw.items)) return emptyGeoCache();
  const kept = [];
  for (const key of Object.keys(raw.items).slice(0, GEO_LIMITS.cacheEntries * 2)) {
    const record = normalizeGeoRecord(raw.items[key], now);
    if (record && record.ip === key && now - record.at <= GEO_LIMITS.cacheMaxAgeMs) kept.push(record);
  }
  kept.sort((a, b) => b.at - a.at);
  return { version: 1, items: Object.fromEntries(kept.slice(0, GEO_LIMITS.cacheEntries).map(record => [record.ip, record])) };
}
/** The cache with one more record (the newest of an address wins), trimmed to the limit. A record that does not validate changes nothing. */
export function geoCachePut(cache, record, now = Date.now()) {
  const checked = normalizeGeoRecord(record, now);
  const base = normalizeGeoCache(cache, now);
  if (!checked) return base;
  return normalizeGeoCache({ version: 1, items: { ...base.items, [checked.ip]: checked } }, now);
}
/** { record, fresh } for an address, or null: fresh means younger than 24 hours; an older record is still shown, marked by its age. */
export function geoCacheLookup(cache, ip, now = Date.now()) {
  const canonical = geoCanonicalIp(ip);
  if (canonical === null || !isRecord(cache) || !isRecord(cache.items) || !Object.hasOwn(cache.items, canonical)) return null;
  const record = normalizeGeoRecord(cache.items[canonical], now);
  if (!record || now - record.at > GEO_LIMITS.cacheMaxAgeMs) return null;
  return { record, fresh: now - record.at <= GEO_LIMITS.freshMs };
}
