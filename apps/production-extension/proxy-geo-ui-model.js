// ADR-109: pure view-model helpers of the Proxy manager's geolocation layer (notice, five columns, cell states, details, bulk lookup).
// No DOM, no chrome.*, no network: they read the GeoState of proxy-geo-controller.js and the manual check results the list already
// holds, and say what to show. The exit IP of a profile is only ever the address of its latest passing manual check; nothing here
// asks a provider for anything. Provider text is returned as is (already cleaned by proxy-geo-shared.js) and is only rendered as text.
import { GEO_COLUMNS, GEO_FLAGS, GEO_KINDS, GEO_ERRORS, GEO_LIMITS, GEO_PROVIDER_INFO, geoCanonicalIp, geoIsPublicIp, geoRecordHasData, geoIntlTag } from './proxy-geo-shared.js';
import { proxyFormatRelative } from './proxy-ui-model.js';

// ---- The dismissible notice ---------------------------------------------------------------------------------------------------
// Only the invite variant can be dismissed, once per browser profile (this page's localStorage). Storage can be blocked or throw:
// every access is guarded and the page works without it.
export const GEO_BANNER_KEY = 'proxy-geo-banner:v1';
const VIEW_MAX_CHARS = 64;
export function readGeoBannerDismissed(area) {
  try {
    const text = area?.getItem?.(GEO_BANNER_KEY);
    if (typeof text !== 'string' || text.length === 0 || text.length > VIEW_MAX_CHARS) return false;
    const value = JSON.parse(text);
    return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 2 && value.version === 1 && value.dismissed === true;
  } catch { return false; }
}
export function writeGeoBannerDismissed(area) {
  try { area.setItem(GEO_BANNER_KEY, JSON.stringify({ version: 1, dismissed: true })); return true; } catch { return false; }
}
/** Whether the manager shows the geolocation columns: the state was read and the master switch is on. */
export const proxyGeoOn = state => Boolean(state) && state.loaded === true && state.enabled === true;
/** Whether a lookup can be sent now: on, with at least one enabled provider that has what it needs. */
export const proxyGeoReady = state => proxyGeoOn(state) && state.ready === true;
/** 'invite' while the feature is off (unless dismissed), 'not-ready' while it is on without a usable provider, otherwise 'hidden'.
 *  Nothing is shown until the state is read, so a missing or broken controller leaves the manager exactly as it was. */
export function proxyGeoBannerState(state, dismissed = false) {
  if (!state || state.loaded !== true) return 'hidden';
  if (state.enabled !== true) return dismissed === true ? 'hidden' : 'invite';
  return state.ready === true ? 'hidden' : 'not-ready';
}
/** The columns to render, in canonical order: the user's selection, only while the feature is on. */
export function proxyGeoColumns(state) {
  if (!proxyGeoOn(state)) return [];
  const chosen = Array.isArray(state.settings?.columns) ? state.settings.columns : [];
  return GEO_COLUMNS.filter(column => chosen.includes(column));
}
/** The first ready provider's display name, '' when there is none. */
export function proxyGeoProviderName(state) {
  const id = Array.isArray(state?.readyProviders) ? state.readyProviders[0] : undefined;
  return typeof id === 'string' && Object.hasOwn(GEO_PROVIDER_INFO, id) ? GEO_PROVIDER_INFO[id].name : '';
}
const SERVICE_NAMES = Object.freeze({ 'geolite-city': 'GeoLite City', 'geoip-city': 'GeoIP City', 'geoip-insights': 'GeoIP Insights' });
/** The provider of a record as one line: its name, and the MaxMind service when there is one. */
export function proxyGeoSourceName(record) {
  if (!record || !Object.hasOwn(GEO_PROVIDER_INFO, record.provider)) return '';
  const service = Object.hasOwn(SERVICE_NAMES, record.service) ? SERVICE_NAMES[record.service] : '';
  return GEO_PROVIDER_INFO[record.provider].name + (service ? ' (' + service + ')' : '');
}

// ---- Exit address of a profile ----------------------------------------------------------------------------------------------------
/** The canonical exit IP of a manual check result ({ diagnostic }), or '' when the check did not pass or names no valid address. */
export function proxyGeoExitIp(check) {
  const diagnostic = check?.diagnostic;
  if (diagnostic?.state !== 'pass') return '';
  return geoCanonicalIp(diagnostic.ip) ?? '';
}
/** The same, only when it is a public address: the one thing that may ever be sent to a provider. Private, loopback, link-local,
 *  CGNAT, documentation and other reserved ranges give '' and so are never looked up. */
export function proxyGeoPublicExitIp(check) {
  const ip = proxyGeoExitIp(check);
  return ip !== '' && geoIsPublicIp(ip) ? ip : '';
}
const own = (object, key) => object !== null && typeof object === 'object' && Object.hasOwn(object, key);

// ---- What a row shows ------------------------------------------------------------------------------------------------------------------
// phase: 'no-ip' (no passing check or no valid address), 'private' (not a public address), 'data' (a record that says something),
// 'nodata' (a record without any field), 'error' (the last lookup failed and nothing is stored), 'empty' (nothing asked yet).
// `pending` is true while a lookup of the address runs; with a stored record the record stays visible beside it. The error is the newer of the
// controller's remembered one and the last failure of a lookup this page started (`failures`: { [ip]: { code, at } }, in memory only: the
// controller does not remember transient errors such as a timeout, but the person who pressed the button should see them).
export function proxyGeoRowInfo({ state, check, profile, now, failures = null }) {
  const ip = proxyGeoExitIp(check);
  const base = { ip, publicIp: false, record: null, stale: false, ageMs: 0, pending: false, error: '', canLookup: false, tag: typeof profile?.country === 'string' ? profile.country : '' };
  if (ip === '') return { ...base, phase: 'no-ip' };
  if (!geoIsPublicIp(ip)) return { ...base, phase: 'private' };
  const record = own(state?.records, ip) ? state.records[ip] : null, pending = own(state?.pending, ip) && state.pending[ip] === true;
  const remembered = own(state?.errors, ip) ? state.errors[ip] : null, local = own(failures, ip) ? failures[ip] : null;
  const failure = remembered && local ? (local.at > remembered.at ? local : remembered) : remembered ?? local;
  const error = typeof failure?.code === 'string' && GEO_ERRORS.includes(failure.code) && !(Number.isFinite(now) && Number.isFinite(failure.at) && now - failure.at >= GEO_LIMITS.errorMemoryMs) ? failure.code : '';
  const ageMs = record && Number.isFinite(now) ? Math.max(0, now - record.at) : 0;
  const info = { ...base, publicIp: true, record, pending, error, ageMs, stale: Boolean(record) && ageMs > GEO_LIMITS.freshMs, canLookup: proxyGeoReady(state) };
  if (record) return { ...info, phase: geoRecordHasData(record) ? 'data' : 'nodata' };
  return { ...info, phase: error !== '' && !pending ? 'error' : 'empty' };
}

// ---- Cells -----------------------------------------------------------------------------------------------------------------------------
/** The user's own country tag differs from the provider's country (both are ISO two-letter codes); anything else is not a mismatch. */
export function proxyGeoMismatch(tag, record) {
  return typeof tag === 'string' && /^[A-Za-z]{2}$/.test(tag) && typeof record?.country === 'string' && /^[A-Z]{2}$/.test(record.country) && tag.toUpperCase() !== record.country;
}
/** The location cell: city, region, country name and code; `hasPlace` is false when there is neither a city nor a region (the cell then shows the country name alone). */
export function proxyGeoLocation(record, tag = '') {
  const city = record?.city ?? '', region = record?.region ?? '', countryName = record?.countryName ?? '', country = record?.country ?? '';
  return { city, region, countryName, country, hasPlace: city !== '' || region !== '', mismatch: proxyGeoMismatch(tag, record), tag };
}
/** The network cell: "AS15169", the organisation (the ISP when there is none), and the ISP under it when it adds something. */
export function proxyGeoNetwork(record) {
  const asn = Number.isSafeInteger(record?.asn) ? 'AS' + record.asn : '', org = record?.org ?? '', isp = record?.isp ?? '';
  return { asn, org, isp, name: org || isp, showIsp: org !== '' && isp !== '' && isp !== org, empty: asn === '' && org === '' && isp === '' };
}
/** The flags cell: 'chips' lists the flags that are true, 'clear' means flags were reported and none is true, 'unreported' means the
 *  provider or plan reports none of them (all null). The state of a flag is the provider's statement, never ours. */
export function proxyGeoFlags(record) {
  const flags = record?.flags ?? {};
  const active = GEO_FLAGS.filter(flag => flags[flag] === true), reported = GEO_FLAGS.filter(flag => typeof flags[flag] === 'boolean');
  return { active, reported, state: active.length > 0 ? 'chips' : reported.length > 0 ? 'clear' : 'unreported' };
}
/** The three-state reading of one flag for the details list. */
export const proxyGeoFlagState = (record, flag) => record?.flags?.[flag] === true ? 'yes' : record?.flags?.[flag] === false ? 'no' : 'unreported';

/** An IANA zone at `now`: { zone, minutes, offset: 'UTC+01:00', time: '14:05' } with the time in the UI language; null for an unknown
 *  zone. Computed with Intl only (no network, no stored clock): the offset is the wall clock of the zone minus the instant. */
export function proxyGeoZone(zone, now, langTag = 'en') {
  if (typeof zone !== 'string' || zone === '' || !Number.isFinite(now)) return null;
  try {
    const instant = Math.floor(now / 1000) * 1000;
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(instant));
    const read = type => Number(parts.find(part => part.type === type)?.value);
    const wall = Date.UTC(read('year'), read('month') - 1, read('day'), read('hour') % 24, read('minute'), read('second'));
    if (!Number.isFinite(wall)) return null;
    const minutes = Math.round((wall - instant) / 60000), abs = Math.abs(minutes);
    const offset = 'UTC' + (minutes < 0 ? '-' : '+') + String(Math.floor(abs / 60)).padStart(2, '0') + ':' + String(abs % 60).padStart(2, '0');
    let time;
    try { time = new Intl.DateTimeFormat(geoIntlTag(langTag), { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(new Date(instant)); }
    catch { time = new Intl.DateTimeFormat('en', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(new Date(instant)); }
    return { zone, minutes, offset, time };
  } catch { return null; }
}
/** How long ago a record was received, in the UI language ('' when it cannot be said). */
export const proxyGeoAge = (record, now, langTag) => record ? proxyFormatRelative(record.at, now, geoIntlTag(langTag)) : '';

/** The failures worth showing after a lookup: what is wrong with the provider or the answer, not the local set-up (switch off, no key,
 *  HTTP not accepted) and not a private address, which the cells already explain. */
export const proxyGeoShowsFailure = code => GEO_ERRORS.includes(code) && !['disabled', 'no-provider', 'no-key', 'http-not-allowed', 'not-public'].includes(code);

// ---- Label keys: one table per enum, so a new enum member without a label is caught by a test ---------------------------------
export const proxyGeoKindKey = kind => kind === '' || !GEO_KINDS.includes(kind) ? 'kind_unknown' : 'kind_' + kind;
export const proxyGeoFlagKey = flag => 'flag_' + flag;
export const proxyGeoFlagTipKey = (flag, provider) => flag === 'proxy' && provider === 'ipapi' ? 'flag_proxy_ipapi_tip' : 'flag_' + flag + '_tip';
export const proxyGeoErrorKey = code => 'error_' + (GEO_ERRORS.includes(code) ? code : 'bad-response').replaceAll('-', '_');
/** The key of a plural form of `base`: "<base>_<category>" for the language's category of `count`, "<base>_other" when it has none. */
export function proxyGeoPluralKey(base, count, langTag = 'en', has = () => true) {
  let category = 'other';
  try { category = new Intl.PluralRules(langTag).select(count); } catch { /* An unknown language keeps "other". */ }
  return has(base + '_' + category) ? base + '_' + category : base + '_other';
}

// ---- Bulk lookup ------------------------------------------------------------------------------------------------------------------------
/** The distinct public exit addresses of the given profiles that have no fresh record and no lookup running, in list order. These
 *  are the only addresses "look up all" may send; capped at the size of the cache so one click stays bounded. */
export function proxyGeoLookupTargets({ profiles, checks, state, now }) {
  const found = [];
  if (!proxyGeoReady(state) || !Array.isArray(profiles)) return found;
  for (const profile of profiles) {
    const ip = proxyGeoPublicExitIp(own(checks, profile?.id) ? checks[profile.id] : null);
    if (ip === '' || found.includes(ip)) continue;
    const record = own(state.records, ip) ? state.records[ip] : null, pending = own(state.pending, ip) && state.pending[ip] === true;
    if (pending || (record && Number.isFinite(now) && now - record.at <= GEO_LIMITS.freshMs)) continue;
    found.push(ip);
    if (found.length >= GEO_LIMITS.cacheEntries) break;
  }
  return found;
}
