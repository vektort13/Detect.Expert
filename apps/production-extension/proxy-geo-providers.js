// ADR-109 (owner order, 2026-11-06): Proxy Manager Geolocation API. Pure functions: no network, no chrome.*, no clock.
// geoBuildRequest describes ONE GET request for one provider; geoParseResponse turns the received answer into the one normalised record
// (proxy-geo-shared.js) or into an error code. A provider answer is untrusted text. It is read only through own data properties of plain
// objects (inherited, accessor and __proto__ / constructor / prototype entries are invisible), only whitelisted fields are taken, every
// string goes through geoText, an array is never walked (MaxMind subdivisions: element 0 only) and the candidate must pass
// normalizeGeoRecord. Provider error text, the request URL and the key never reach a result: an error is a code, a pause hint and a quota
// snapshot. The host names come from the shared catalogue (the same list as the CSP), so this file holds no URL.
import {
  GEO_PROVIDERS, GEO_PROVIDER_INFO, GEO_LIMITS, geoText, geoCanonicalIp, geoIsPublicIp, geoCleanCredential, normalizeGeoSettings,
  geoEmptyFlags, normalizeGeoRecord, geoRecordHasData,
} from './proxy-geo-shared.js';

// ---- Requests --------------------------------------------------------------------------------------------------------------------
const IPAPI_FIELDS = 'status,message,country,countryCode,region,regionName,city,timezone,isp,org,as,asname,mobile,proxy,hosting,query';
const [GEOLITE, GEOIP] = GEO_PROVIDER_INFO.maxmind.origins;
const [IPGEOLOCATION] = GEO_PROVIDER_INFO.ipgeolocation.origins;
const [IPDATA] = GEO_PROVIDER_INFO.ipdata.origins;
const [IPAPI_FREE, IPAPI_PRO] = GEO_PROVIDER_INFO.ipapi.origins;
const MAXMIND_ROUTES = Object.freeze({ 'geolite-city': [GEOLITE, '/geoip/v2.1/city/'], 'geoip-city': [GEOIP, '/geoip/v2.1/city/'], 'geoip-insights': [GEOIP, '/geoip/v2.1/insights/'] });
const encode = encodeURIComponent;

const refuse = error => Object.freeze({ ok: false, error });
const request = (origin, path, bucket, extraHeaders) => Object.freeze({ ok: true, url: origin + path, headers: Object.freeze({ Accept: 'application/json', ...extraHeaders }), origin, bucket });

/** One GET request for a provider: { ok:true, url, headers, origin, bucket } or { ok:false, error }. The key is placed only where the provider documents it
 *  (a URL parameter, or MaxMind's Basic header). The address must already be canonical and public; nothing else is ever put in a URL. */
export function geoBuildRequest(providerId, ip, options) {
  if (!GEO_PROVIDERS.includes(providerId)) return refuse('no-provider');
  const canonical = geoCanonicalIp(ip);
  if (canonical === null || canonical !== ip || !geoIsPublicIp(canonical)) return refuse('not-public');
  const credential = geoCleanCredential(providerId, own(options, 'credential'));
  const config = normalizeGeoSettings(own(options, 'settings')).providers[providerId];
  if (providerId === 'ipapi') {
    if (credential) return request(IPAPI_PRO, '/json/' + ip + '?key=' + encode(credential.apiKey) + '&fields=' + IPAPI_FIELDS, 'ipapi');
    return config.http === true ? request(IPAPI_FREE, '/json/' + ip + '?fields=' + IPAPI_FIELDS, 'ipapi-free') : refuse('http-not-allowed');
  }
  if (!credential) return refuse('no-key');
  if (providerId === 'maxmind') {
    const [origin, path] = MAXMIND_ROUTES[config.service];
    return request(origin, path + ip, 'maxmind', { Authorization: 'Basic ' + btoa(credential.accountId + ':' + credential.licenseKey) });
  }
  if (providerId === 'ipgeolocation') {
    return request(IPGEOLOCATION, '/v3/ipgeo?apiKey=' + encode(credential.apiKey) + '&ip=' + encode(ip) + (config.security === true ? '&include=security' : ''), 'ipgeolocation');
  }
  return request(IPDATA, '/' + ip + '?api-key=' + encode(credential.apiKey), 'ipdata');
}

// ---- Reading untrusted JSON ------------------------------------------------------------------------------------------------------
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
/** The one accessor: an own DATA property of a plain object (or an element of an array), else undefined. Never a getter, never inherited, never __proto__. */
function own(value, key) {
  if (BLOCKED_KEYS.has(key) || !(isPlain(value) || Array.isArray(value))) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}
const bool = value => (typeof value === 'boolean' ? value : null);
const TIMEZONE = /^[A-Za-z0-9_+\-/]{1,64}$/;   // the same rule as normalizeGeoRecord
const zone = value => { const text = typeof value === 'string' && value.length <= 80 ? value.trim() : ''; return TIMEZONE.test(text) ? text : ''; };
const countryCode = value => (typeof value === 'string' && /^[A-Za-z]{2}$/.test(value) ? value.toUpperCase() : '');   // ASCII only: no case-mapping surprises
/** 'AS15169', 'AS15169 Google LLC', 15169 -> { asn, rest }; anything else (or out of range) -> { asn: null, rest: '' }. */
function asnOf(value) {
  const none = { asn: null, rest: '' };
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 1 && value <= 4294967295 ? { asn: value, rest: '' } : none;
  const match = typeof value === 'string' ? /^\s*(?:AS)?(\d{1,10})(?:\s+(.*))?$/is.exec(value.slice(0, 400)) : null;
  const asn = match ? Number(match[1]) : 0;
  return asn >= 1 && asn <= 4294967295 ? { asn, rest: match[2] ?? '' } : none;
}
// A kind word as the shared vocabulary. Maps, not objects: 'constructor' is just an unknown word. '' means the provider declined to say.
const USER_TYPES = new Map([['residential', 'residential'], ['hosting', 'hosting'], ['cellular', 'mobile'], ['business', 'business'], ['school', 'education'], ['college', 'education'],
  ['library', 'education'], ['government', 'government'], ['military', 'government'], ['content_delivery_network', 'cdn']]);
// connection_type: MaxMind (Cable/DSL, Cellular, Corporate, Satellite) and ipgeolocation.io (DSL, Cable, Fiber, Mobile, Wireless, Dial-Up/ISDN, Satellite). "Wireless" is left
// out ON PURPOSE (so is 5G): fixed-wireless and mobile networks both exist under those words and the provider does not say which, so neither becomes mobile or isp.
const CONNECTION_TYPES = new Map([['cellular', 'mobile'], ['mobile', 'mobile'], ['corporate', 'business'], ['cable/dsl', 'isp'], ['cable', 'isp'], ['dsl', 'isp'], ['fiber', 'isp'], ['dial-up/isdn', 'isp'], ['satellite', 'isp']]);
const USAGE_TYPES = new Map([['isp', 'isp'], ['hosting', 'hosting'], ['business', 'business'], ['education', 'education'], ['government', 'government'], ['cdn', 'cdn'],
  ['edu', 'education'], ['gov', 'government'], ['mil', 'government'], ['unknown', '']]);
function kindOf(map, value) {
  const word = geoText(value, 40).toLowerCase();
  return word === '' ? '' : (map.has(word) ? map.get(word) : 'other');
}
// Several sources can name a kind: the first one that gives a KNOWN kind wins. A word the vocabulary does not know ("other") only counts when no source gave a known kind
// ("traveler" next to Cable/DSL is isp), and '' (nothing said, or the provider declined) never counts.
const firstKind = (...kinds) => kinds.find(kind => kind !== '' && kind !== 'other') ?? (kinds.includes('other') ? 'other' : '');
const anyOf = (...flags) => (flags.includes(true) ? true : (flags.includes(false) ? false : null));
const quotaOf = (remaining, pausedMs) => (remaining === null && pausedMs === null ? null : Object.freeze({ remaining, pausedMs }));
const MAX_PAUSE_MS = 60 * 60 * 1000;   // ip-api bans for an hour: a longer hint from a header is not believed

function header(headers, name) {
  const value = own(headers, name);
  return typeof value === 'string' ? value : (typeof value === 'number' ? String(value) : '');
}
function headerInt(headers, name) {
  const match = /^\s*(\d{1,9})\s*$/.exec(header(headers, name));
  return match ? Number(match[1]) : null;
}
/** The body as a JSON value, or undefined. An answer over the size limit is not read at all; an error body is decoded only when its type is JSON or missing. */
function readJson(text, headers) {
  if (typeof text !== 'string' || text === '' || text.length > GEO_LIMITS.responseBytes) return undefined;
  const type = header(headers, 'content-type');
  if (type !== '' && !/json/i.test(type)) return undefined;
  try { return JSON.parse(text); } catch { return undefined; }
}
const blank = () => ({ country: '', countryName: '', region: '', city: '', timezone: '', asn: null, org: '', isp: '', kind: '', flags: {} });

// ---- One reader per provider: body -> { ip, quota, fields } or null (the body is not shaped like that provider's answer) -----------------
// MaxMind names are { locale: text }: English first, else the first text among the first few keys.
function nameOf(entity) {
  const names = own(entity, 'names');
  const english = geoText(own(names, 'en'));
  if (english !== '' || !isPlain(names)) return english;
  for (const key of Object.keys(names).slice(0, 16)) { const found = geoText(own(names, key)); if (found !== '') return found; }
  return '';
}
const ANONYMIZER_KEYS = Object.freeze({ proxy: 'is_public_proxy', vpn: 'is_anonymous_vpn', tor: 'is_tor_exit_node', hosting: 'is_hosting_provider', residentialProxy: 'is_residential_proxy' });
// What one source says about one flag: true / false as given, undefined when the key is absent, null when it is there but is not a boolean.
const stated = (source, key) => { const value = own(source, key); return value === undefined || typeof value === 'boolean' ? value : null; };
function maxmindFlags(body, service) {
  // A flag has two sources: the anonymizer object and the deprecated traits.is_* alias (Insights returns both). A true from either wins, a false counts when the other
  // source is silent, a present non-boolean is unknown. A flag nobody states: MaxMind leaves false booleans out, so false when the object is there - unless the object only
  // says "anonymous" in general (is_anonymous true, or a provider name): a VPN provider's ranges may be flagged only through is_hosting_provider, so the specifics are unknown.
  // With no object at all GeoIP Insights has left an empty value out ("nothing flagged": false); the services without anonymizer data, and a value that is not an object, say nothing.
  const anonymizer = own(body, 'anonymizer'), traits = own(body, 'traits'), object = isPlain(anonymizer);
  const general = object && (own(anonymizer, 'is_anonymous') === true || geoText(own(anonymizer, 'provider_name')) !== '');
  const nobody = object ? (general ? null : false) : (anonymizer === undefined && service === 'geoip-insights' ? false : null);
  const flags = {};
  for (const [flag, key] of Object.entries(ANONYMIZER_KEYS)) {
    // The residential sub-object may be there when no other anonymizer field is: it is a residential-proxy signal by itself.
    const fromObject = object ? (flag === 'residentialProxy' && isPlain(own(anonymizer, 'residential')) ? true : stated(anonymizer, key)) : undefined;
    const says = [fromObject, stated(traits, key)];
    flags[flag] = says.includes(true) ? true : (says.includes(false) ? false : (says.includes(null) ? null : nobody));
  }
  const connection = geoText(own(traits, 'connection_type'), 40).toLowerCase(), userType = geoText(own(traits, 'user_type'), 40).toLowerCase();
  flags.mobile = connection === 'cellular' || userType === 'cellular' ? true : (connection !== '' ? false : null);
  return flags;
}
const MAXMIND_OBJECTS = Object.freeze(['traits', 'country', 'city', 'location', 'continent', 'registered_country', 'anonymizer', 'postal', 'maxmind']);
function readMaxMind(body, headers, status, settings) {
  if (!MAXMIND_OBJECTS.some(key => isPlain(own(body, key))) && !Array.isArray(own(body, 'subdivisions'))) return null;
  const traits = own(body, 'traits'), country = own(body, 'country'), subdivisions = own(body, 'subdivisions');
  const left = own(own(body, 'maxmind'), 'queries_remaining');
  return {
    ip: own(traits, 'ip_address'),
    quota: Number.isSafeInteger(left) && left >= 0 ? quotaOf(left, null) : null,
    fields: { ...blank(), country: countryCode(own(country, 'iso_code')), countryName: nameOf(country), region: Array.isArray(subdivisions) ? nameOf(own(subdivisions, '0')) : '',
      city: nameOf(own(body, 'city')), timezone: zone(own(own(body, 'location'), 'time_zone')), asn: asnOf(own(traits, 'autonomous_system_number')).asn,
      org: geoText(own(traits, 'autonomous_system_organization')), isp: geoText(own(traits, 'isp')) || geoText(own(traits, 'organization')),
      kind: firstKind(kindOf(USER_TYPES, own(traits, 'user_type')), kindOf(CONNECTION_TYPES, own(traits, 'connection_type'))),
      flags: maxmindFlags(body, settings.providers.maxmind.service) },
  };
}
function readIpGeolocation(body) {
  const location = own(body, 'location'), asn = own(body, 'asn'), company = own(body, 'company'), network = own(body, 'network'), security = own(body, 'security');
  if (typeof own(body, 'ip') !== 'string' && ![location, asn, company, network, security, own(body, 'time_zone')].some(isPlain)) return null;
  return {
    ip: own(body, 'ip'), quota: null,
    fields: { ...blank(), country: countryCode(own(location, 'country_code2')), countryName: geoText(own(location, 'country_name')), region: geoText(own(location, 'state_prov')),
      city: geoText(own(location, 'city')), timezone: zone(own(own(body, 'time_zone'), 'name')), asn: asnOf(own(asn, 'as_number')).asn, org: geoText(own(asn, 'organization')),
      isp: geoText(own(company, 'name')),
      kind: firstKind(kindOf(USAGE_TYPES, own(asn, 'type')), kindOf(USAGE_TYPES, own(company, 'type')), own(network, 'is_cdn') === true ? 'cdn' : '', kindOf(CONNECTION_TYPES, own(network, 'connection_type'))),
      flags: { proxy: bool(own(security, 'is_proxy')), vpn: bool(own(security, 'is_vpn')), tor: bool(own(security, 'is_tor')), hosting: bool(own(security, 'is_cloud_provider')),
        relay: bool(own(security, 'is_relay')), residentialProxy: bool(own(security, 'is_residential_proxy')), threat: bool(own(security, 'is_known_attacker')) } },
  };
}
function readIpData(body) {
  const asn = own(body, 'asn'), company = own(body, 'company'), threat = own(body, 'threat'), carrier = own(body, 'carrier');
  const texts = ['ip', 'country_code', 'country_name', 'region', 'city'].some(key => typeof own(body, key) === 'string');
  if (!texts && ![asn, company, threat, carrier, own(body, 'time_zone')].some(isPlain)) return null;
  const mobile = isPlain(carrier) && geoText(own(carrier, 'name')) !== '' ? true : null;
  return {
    ip: own(body, 'ip'), quota: null,
    fields: { ...blank(), country: countryCode(own(body, 'country_code')), countryName: geoText(own(body, 'country_name')), region: geoText(own(body, 'region')), city: geoText(own(body, 'city')),
      timezone: zone(own(own(body, 'time_zone'), 'name')), asn: asnOf(own(asn, 'asn')).asn, org: geoText(own(asn, 'name')), isp: geoText(own(company, 'name')),
      kind: firstKind(kindOf(USAGE_TYPES, own(asn, 'type')), kindOf(USAGE_TYPES, own(company, 'type')), mobile === true ? 'mobile' : ''),
      flags: { proxy: bool(own(threat, 'is_proxy')), vpn: bool(own(threat, 'is_vpn')), tor: bool(own(threat, 'is_tor')), hosting: bool(own(threat, 'is_datacenter')), mobile,
        relay: bool(own(threat, 'is_icloud_relay')), threat: anyOf(bool(own(threat, 'is_known_attacker')), bool(own(threat, 'is_known_abuser')), bool(own(threat, 'is_threat'))) } },
  };
}
// ip-api: X-Rl is the number of requests left in the window, X-Ttl the seconds until it resets; at X-Rl 0 (or HTTP 429) no request may be sent for that long.
function ipApiPause(headers, status) {
  const remaining = headerInt(headers, 'x-rl'), ttl = headerInt(headers, 'x-ttl');
  const paused = (remaining === 0 || status === 429) && ttl !== null && ttl > 0 ? Math.min(ttl * 1000, MAX_PAUSE_MS) : null;
  return { pausedMs: paused, quota: quotaOf(remaining, paused) };
}
function readIpApi(body, headers, status) {
  if (own(body, 'status') !== 'success') return null;
  const parsed = asnOf(own(body, 'as')), hosting = bool(own(body, 'hosting')), mobile = bool(own(body, 'mobile'));
  return {
    ip: own(body, 'query'), quota: ipApiPause(headers, status).quota,
    fields: { ...blank(), country: countryCode(own(body, 'countryCode')), countryName: geoText(own(body, 'country')), region: geoText(own(body, 'regionName')) || geoText(own(body, 'region')),
      city: geoText(own(body, 'city')), timezone: zone(own(body, 'timezone')), asn: parsed.asn, org: geoText(parsed.rest) || geoText(own(body, 'asname')),
      isp: geoText(own(body, 'isp')) || geoText(own(body, 'org')), kind: hosting === true ? 'hosting' : (mobile === true ? 'mobile' : ''),
      flags: { proxy: bool(own(body, 'proxy')), hosting, mobile } },
  };
}
const READERS = Object.freeze({ maxmind: readMaxMind, ipgeolocation: readIpGeolocation, ipdata: readIpData, ipapi: readIpApi });

// ---- Errors ----------------------------------------------------------------------------------------------------------------------
const failure = (error, retryAfterMs = null, quota = null) => Object.freeze({ ok: false, error, retryAfterMs, quota });
/** The plain-HTTP meaning of a status, for every status a provider has no special rule for. */
function statusError(status) {
  if (status === 401) return 'unauthorized';
  if (status === 402) return 'quota';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  if (status === 429) return 'rate-limited';
  return status >= 500 && status <= 599 ? 'server' : 'bad-response';
}
const MAXMIND_CODES = new Map([['IP_ADDRESS_INVALID', 'not-public'], ['IP_ADDRESS_REQUIRED', 'not-public'], ['IP_ADDRESS_RESERVED', 'not-public'], ['SERVICE_INVALID', 'bad-response'],
  ['AUTHORIZATION_INVALID', 'unauthorized'], ['ACCOUNT_ID_REQUIRED', 'unauthorized'], ['LICENSE_KEY_REQUIRED', 'unauthorized'], ['INSUFFICIENT_FUNDS', 'quota'],
  ['PERMISSION_REQUIRED', 'forbidden'], ['IP_ADDRESS_NOT_FOUND', 'not-found'], ['SERVER_ERROR', 'server']]);
// A MaxMind error body is { code, error }: the static code decides, the status only when there is no known code. A 429 has no body. The one-minute wait returned for it is OUR
// assumption, not a documented value: MaxMind documents no Retry-After and no duration for its rate limit (it only says the limit follows excessive error responses).
function failMaxMind(status, body) {
  const known = MAXMIND_CODES.get(geoText(own(body, 'code'), 40));
  return failure(known ?? (status === 400 ? 'not-public' : statusError(status)), status === 429 ? 60000 : null);
}
// ipgeolocation.io (error bodies: the OpenAPI file ip-location-api.yaml). 400 names the address or something else. 401 is a rejected key or account (missing or not valid key, e-mail not
// verified, account locked, database plan, subscription paused) - except the ONE documented plan message, "IP-security lookup is not supported on your subscription. This feature is
// available on Paid subscriptions only.", and only when include=security was asked for. 402 is a paid subscription whose date has passed: the key is no longer accepted. 423 is a bogon.
// 429 is the used-up quota.
const PLAN_MESSAGE = /not supported on your (?:current )?subscription|paid subscriptions? only/i, ADDRESS_WORD = /\b(?:ip|address|bogon|private|reserved)\b/i;
function failIpGeolocation(status, body, settings) {
  const message = geoText(own(body, 'message'), 300);
  if (status === 401) return failure(settings.providers.ipgeolocation.security === true && PLAN_MESSAGE.test(message) ? 'plan' : 'unauthorized');
  if (status === 402) return failure('unauthorized');
  if (status === 400) return failure(ADDRESS_WORD.test(message) ? 'not-public' : 'bad-response');
  if (status === 423) return failure('not-public');
  return failure(status === 429 ? 'quota' : statusError(status));
}
// ipdata: 400 is a private / reserved / malformed address. A 403 is, told apart by the message: a used-up quota (whole words, so "unlimited" is not one) - which wins even when the
// message also says "Upgrade to a paid plan" - or a plan-gated feature (bulk, ASN: "Upgrade to a paid plan ..."), or something else (a key whitelist).
const QUOTA_WORDS = /\b(?:quota|limit|exceeded|used up)\b/i, UPGRADE_PHRASE = /upgrade to a paid plan/i;
function failIpData(status, body) {
  if (status === 400) return failure('not-public');
  if (status === 403) {
    const message = geoText(own(body, 'message'), 200);
    return failure(QUOTA_WORDS.test(message) ? 'quota' : (UPGRADE_PHRASE.test(message) ? 'plan' : 'forbidden'));
  }
  return failure(statusError(status));
}
// ip-api: {"status":"fail","message":...} comes with HTTP 200 (a bad address) or 403 (a bad key); 429 carries the pause in X-Ttl. Whatever the error,
// an exhausted window (X-Rl 0, or a 429) is returned as the pause hint.
const IPAPI_ADDRESS_MESSAGES = new Set(['private range', 'reserved range', 'invalid query']);
function failIpApi(status, body, headers) {
  const pause = ipApiPause(headers, status);
  const message = own(body, 'status') === 'fail' ? geoText(own(body, 'message'), 120).toLowerCase() : '';
  let error;
  if (status === 429) error = 'rate-limited';
  else if (/key/.test(message)) error = 'unauthorized';
  else if (IPAPI_ADDRESS_MESSAGES.has(message)) error = 'not-public';
  else error = status >= 200 && status < 300 ? 'bad-response' : statusError(status);
  return failure(error, pause.pausedMs, pause.quota);
}
function failFor(providerId, status, body, headers, settings) {
  if (providerId === 'maxmind') return failMaxMind(status, body);
  if (providerId === 'ipgeolocation') return failIpGeolocation(status, body, settings);
  if (providerId === 'ipdata') return failIpData(status, body);
  return failIpApi(status, body, headers);
}

// ---- Responses -------------------------------------------------------------------------------------------------------------------
function parseAnswer(providerId, response, context) {
  if (!GEO_PROVIDERS.includes(providerId)) return failure('no-provider');
  const requested = own(context, 'ip');
  if (geoCanonicalIp(requested) !== requested || !geoIsPublicIp(requested)) return failure('not-public');
  const status = own(response, 'status'), headers = own(response, 'headers'), now = own(context, 'now');
  if (!Number.isInteger(status) || status < 100 || status > 599) return failure('bad-response');
  const settings = normalizeGeoSettings(own(context, 'settings'));
  const body = readJson(own(response, 'text'), headers);
  if (providerId === 'ipapi' && own(body, 'status') === 'fail') return failIpApi(status, body, headers);
  if (status < 200 || status > 299) return failFor(providerId, status, body, headers, settings);
  if (!isPlain(body)) return failure('bad-response');
  const read = READERS[providerId](body, headers, status, settings);
  if (read === null) return failure('bad-response');
  // An answer about another address is never filed under this one.
  const echoed = read.ip;
  if (typeof echoed === 'string' && echoed !== '' && geoCanonicalIp(echoed) !== requested) return failure('bad-response', null, read.quota);
  const service = providerId === 'maxmind' ? settings.providers.maxmind.service : '';
  const record = normalizeGeoRecord({ provider: providerId, service, at: now, ip: requested, ...read.fields, flags: { ...geoEmptyFlags(), ...read.fields.flags } }, now);
  if (record === null) return failure('bad-response', null, read.quota);
  if (!geoRecordHasData(record)) return failure('not-found', null, read.quota);
  return Object.freeze({ ok: true, record, quota: read.quota });
}
/** The answer of a provider as { ok:true, record, quota } or { ok:false, error, retryAfterMs, quota }. Never throws, whatever the text is. */
export function geoParseResponse(providerId, response, context) {
  try { return parseAnswer(providerId, response, context); } catch { return failure('bad-response'); }
}
