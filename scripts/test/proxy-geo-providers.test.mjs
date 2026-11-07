// ADR-109 (owner order, 2026-11-06): request builders and response parsers of the four geolocation providers
// (apps/production-extension/proxy-geo-providers.js). Evidence: fixtures/proxy-geo/** (live answers of 2026-11-06, documented samples, synthesized and
// hostile answers; see its README). Every expected result below is written by hand from the provider documentation and from the mapping table in
// docs/coverage/proxy-geolocation.md, never derived from the code under test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { geoBuildRequest, geoParseResponse } from '../../apps/production-extension/proxy-geo-providers.js';
import {
  GEO_PROVIDERS, GEO_PROVIDER_INFO, GEO_ERRORS, GEO_LIMITS, defaultGeoSettings, geoSettingsPatch, geoEmptyFlags, geoCanonicalIp, geoIsPublicIp,
  geoHasForbiddenText, normalizeGeoRecord,
} from '../../apps/production-extension/proxy-geo-shared.js';

const NOW = 1_800_000_000_000;
const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'proxy-geo');
const cp = (...codes) => String.fromCodePoint(...codes);
const BACKSLASH = String.fromCharCode(92);
const settingsWith = patch => geoSettingsPatch(defaultGeoSettings(), patch);
const deepFreeze = value => { if (value !== null && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(deepFreeze); } return value; };

// ======================================================================================================================================
// Requests
// ======================================================================================================================================
const KEY = 'abcdefgh12345678';
const MAXMIND_CREDENTIAL = { accountId: '123456', licenseKey: 'abcdefgh_12345678' };
const API_CREDENTIAL = { apiKey: KEY };
const BASIC = 'Basic MTIzNDU2OmFiY2RlZmdoXzEyMzQ1Njc4';   // printf '123456:abcdefgh_12345678' | base64: computed outside the code under test
const FIELDS = 'status,message,country,countryCode,region,regionName,city,timezone,isp,org,as,asname,mobile,proxy,hosting,query';
const IPV4 = '8.8.8.8', IPV6 = '2001:4860:4860::8888', IPV6_ENCODED = '2001%3A4860%3A4860%3A%3A8888';
const JSON_ONLY = { Accept: 'application/json' };
const build = (id, ip, credential, patch = {}) => geoBuildRequest(id, ip, { credential, settings: settingsWith(patch) });
const credentialOf = id => (id === 'maxmind' ? MAXMIND_CREDENTIAL : API_CREDENTIAL);

test('builder: MaxMind takes the host and path of the configured service and sends the Basic header, nothing else', () => {
  const routes = [['geolite-city', 'https://geolite.info', '/geoip/v2.1/city/'], ['geoip-city', 'https://geoip.maxmind.com', '/geoip/v2.1/city/'], ['geoip-insights', 'https://geoip.maxmind.com', '/geoip/v2.1/insights/']];
  for (const [service, origin, path] of routes) for (const ip of [IPV4, IPV6]) {
    assert.deepEqual(build('maxmind', ip, MAXMIND_CREDENTIAL, { providers: { maxmind: { service } } }),
      { ok: true, url: origin + path + ip, headers: { ...JSON_ONLY, Authorization: BASIC }, origin, bucket: 'maxmind' }, service + ' ' + ip);
  }
  assert.equal(geoBuildRequest('maxmind', IPV4, { credential: MAXMIND_CREDENTIAL }).url, 'https://geolite.info/geoip/v2.1/city/8.8.8.8', 'no settings: GeoLite City');
  assert.equal(build('maxmind', IPV4, MAXMIND_CREDENTIAL, { providers: { maxmind: { enabled: true, service: 'geoip-insights' } } }).url, 'https://geoip.maxmind.com/geoip/v2.1/insights/8.8.8.8');
  assert.equal(geoBuildRequest('maxmind', IPV4, { credential: MAXMIND_CREDENTIAL, settings: { garbage: true } }).url, 'https://geolite.info/geoip/v2.1/city/8.8.8.8', 'corrupt settings: the default service');
});

test('builder: ipgeolocation.io sends apiKey and ip as parameters and include=security only when asked', () => {
  const origin = 'https://api.ipgeolocation.io';
  assert.deepEqual(build('ipgeolocation', IPV4, API_CREDENTIAL), { ok: true, url: origin + '/v3/ipgeo?apiKey=' + KEY + '&ip=8.8.8.8', headers: JSON_ONLY, origin, bucket: 'ipgeolocation' });
  assert.equal(build('ipgeolocation', IPV6, API_CREDENTIAL).url, origin + '/v3/ipgeo?apiKey=' + KEY + '&ip=' + IPV6_ENCODED);
  const security = { providers: { ipgeolocation: { security: true } } };
  assert.equal(build('ipgeolocation', IPV4, API_CREDENTIAL, security).url, origin + '/v3/ipgeo?apiKey=' + KEY + '&ip=8.8.8.8&include=security');
  assert.equal(build('ipgeolocation', IPV6, API_CREDENTIAL, security).url, origin + '/v3/ipgeo?apiKey=' + KEY + '&ip=' + IPV6_ENCODED + '&include=security');
  assert.equal(build('ipgeolocation', IPV4, API_CREDENTIAL, { providers: { ipgeolocation: { security: false } } }).url.includes('include'), false);
  assert.equal(geoBuildRequest('ipgeolocation', IPV4, { credential: API_CREDENTIAL, settings: { providers: { ipgeolocation: { security: true } } } }).url.includes('include'), false, 'a settings value that is not a normalised settings object never turns a paid include on');
});

test('builder: ipdata puts the address in the path (an IPv6 literal as it is) and the key in api-key', () => {
  const origin = 'https://api.ipdata.co';
  assert.deepEqual(build('ipdata', IPV4, API_CREDENTIAL), { ok: true, url: origin + '/8.8.8.8?api-key=' + KEY, headers: JSON_ONLY, origin, bucket: 'ipdata' });
  assert.deepEqual(build('ipdata', IPV6, API_CREDENTIAL), { ok: true, url: origin + '/2001:4860:4860::8888?api-key=' + KEY, headers: JSON_ONLY, origin, bucket: 'ipdata' });
});

test('builder: ip-api uses the Pro host with a key, the free plain-HTTP endpoint only after consent, and the fixed field list', () => {
  const pro = ip => ({ ok: true, url: 'https://pro.ip-api.com/json/' + ip + '?key=' + KEY + '&fields=' + FIELDS, headers: JSON_ONLY, origin: 'https://pro.ip-api.com', bucket: 'ipapi' });
  const http = { providers: { ipapi: { http: true } } };
  assert.deepEqual(build('ipapi', IPV4, API_CREDENTIAL), pro(IPV4));
  assert.deepEqual(build('ipapi', IPV6, API_CREDENTIAL), pro(IPV6));
  assert.deepEqual(build('ipapi', IPV4, API_CREDENTIAL, http), pro(IPV4), 'a key always means the Pro endpoint, even when the free one is allowed');
  assert.deepEqual(build('ipapi', IPV4, null, http), { ok: true, url: 'http://ip-api.com/json/8.8.8.8?fields=' + FIELDS, headers: JSON_ONLY, origin: 'http://ip-api.com', bucket: 'ipapi-free' });
  assert.equal(build('ipapi', IPV6, null, http).url, 'http://ip-api.com/json/' + IPV6 + '?fields=' + FIELDS);
  assert.deepEqual(geoBuildRequest('ipapi', IPV4, { credential: undefined, settings: settingsWith(http) }).bucket, 'ipapi-free');
  assert.equal(FIELDS.split(',').length, 16);
  for (const wanted of ['lat', 'lon', 'zip', 'reverse', 'query']) assert.equal(FIELDS.split(',').includes(wanted), wanted === 'query', 'coordinates, zip and reverse DNS are not requested: ' + wanted);
});

test('builder: ip-api without a key and without consent is refused, a broken key counts as no key', () => {
  assert.deepEqual(geoBuildRequest('ipapi', IPV4, {}), { ok: false, error: 'http-not-allowed' });
  assert.deepEqual(geoBuildRequest('ipapi', IPV4), { ok: false, error: 'http-not-allowed' });
  assert.deepEqual(build('ipapi', IPV4, null), { ok: false, error: 'http-not-allowed' });
  for (const broken of [{ apiKey: 'short' }, {}, 'abcdefgh12345678', { apiKey: KEY, extra: 1 }, { apiKey: 'has space inside' }, []]) {
    assert.deepEqual(build('ipapi', IPV4, broken), { ok: false, error: 'http-not-allowed' }, JSON.stringify(broken));
    assert.equal(build('ipapi', IPV4, broken, { providers: { ipapi: { http: true } } }).bucket, 'ipapi-free', 'a broken key is not sent: ' + JSON.stringify(broken));
  }
});

const NOT_PUBLIC = ['10.0.0.1', '127.0.0.1', '192.168.1.1', '172.16.0.1', '169.254.1.1', '100.64.0.1', '0.0.0.0', '255.255.255.255', '224.0.0.1', '192.0.2.1', '::1', 'fe80::1', 'fc00::1', '2001:db8::1', '::',
  'example.com', '', ' ', '8.8.8.8/24', ' 8.8.8.8', '8.8.8.8 ', '8.8.8.8:53', '[2001:4860:4860::8888]', '2001:4860:4860:0:0:0:0:8888', '2001:4860:4860::8888%eth0', '::ffff:8.8.8.8', '8.8.8.8?x=1', '8.8.8.8#x',
  '8.8.8.8/../x', '8.8.8.8\n', '08.8.8.8', '8.8.8', '2001:4860:4860::8888/64', 'A'.repeat(100), '8.8.8.8' + cp(0x202e), cp(0xff18) + '.8.8.8', null, undefined, 8, {}, ['8.8.8.8'], true];
test('builder: a private, reserved or non-canonical address is refused as not-public, for every provider, before any key is looked at', () => {
  for (const id of GEO_PROVIDERS) for (const ip of NOT_PUBLIC) {
    const result = geoBuildRequest(id, ip, { credential: credentialOf(id), settings: settingsWith({ providers: { ipapi: { http: true } } }) });
    assert.deepEqual(result, { ok: false, error: 'not-public' }, id + ' ' + JSON.stringify(ip));
  }
  for (const id of GEO_PROVIDERS) assert.deepEqual(geoBuildRequest(id, '10.0.0.1', {}), { ok: false, error: 'not-public' }, 'not-public wins over a missing key: ' + id);
  assert.deepEqual(geoBuildRequest('ipdata', '10.0.0.1'), { ok: false, error: 'not-public' });
  assert.equal(geoCanonicalIp(IPV4), IPV4);
  assert.ok(geoIsPublicIp(IPV4));
});

test('builder: an unknown provider is refused (no-provider) and never throws', () => {
  for (const id of ['', 'nope', 'MAXMIND', ' maxmind', null, undefined, 5, {}, [], '__proto__', 'constructor', 'toString']) {
    assert.deepEqual(geoBuildRequest(id, IPV4, { credential: API_CREDENTIAL }), { ok: false, error: 'no-provider' }, JSON.stringify(id));
  }
  assert.ok(GEO_ERRORS.includes('no-provider'));
});

test('builder: a missing or malformed credential is no-key (a non-ASCII key never reaches the Basic encoder)', () => {
  const broken = [undefined, null, {}, [], KEY, { apiKey: 'short' }, { apiKey: 'has space inside' }, { apiKey: 12345678 }, { apiKey: KEY, extra: 1 }, { apiKey: cp(0x44f).repeat(10) }, { apiKey: KEY + cp(0x200b) }, { accountId: '123456' },
    { apiKey: 'a'.repeat(257) }];
  for (const id of ['ipgeolocation', 'ipdata']) {
    for (const credential of broken) assert.deepEqual(build(id, IPV4, credential), { ok: false, error: 'no-key' }, id + ' ' + JSON.stringify(credential));
    assert.deepEqual(geoBuildRequest(id, IPV4), { ok: false, error: 'no-key' });
    assert.deepEqual(geoBuildRequest(id, IPV4, null), { ok: false, error: 'no-key' });
    assert.deepEqual(geoBuildRequest(id, IPV4, { settings: settingsWith({}) }), { ok: false, error: 'no-key' });
  }
  const brokenMaxMind = [...broken, API_CREDENTIAL, { licenseKey: 'abcdefgh_12345678' }, { accountId: 'abc', licenseKey: 'abcdefgh_12345678' }, { accountId: '', licenseKey: 'abcdefgh_12345678' }, { accountId: '1234567890123', licenseKey: 'abcdefgh_12345678' },
    { accountId: '123456', licenseKey: cp(0x44f).repeat(10) }, { accountId: '123456', licenseKey: 'abcdefgh_12345678', apiKey: KEY }, { accountId: 123456, licenseKey: 'abcdefgh_12345678' }];
  for (const credential of brokenMaxMind) assert.deepEqual(build('maxmind', IPV4, credential), { ok: false, error: 'no-key' }, JSON.stringify(credential));
});

test('builder: a key is encoded for the one place it goes to; odd but valid characters cannot add parameters, a fragment or a host', () => {
  const odd = 'a&b=c#d+e%f/g?h;i:j@k"l<m>n[o]p{q}r|s^t' + BACKSLASH + "z~!*()'`$,._-";
  for (const wanted of odd) assert.ok(wanted.charCodeAt(0) > 32 && wanted.charCodeAt(0) < 127);
  const encoded = encodeURIComponent(odd);
  const credential = { apiKey: odd };
  for (const ip of [IPV4, IPV6]) {
    const geolocation = build('ipgeolocation', ip, credential, { providers: { ipgeolocation: { security: true } } }), url = new URL(geolocation.url);
    assert.ok(geolocation.url.includes('apiKey=' + encoded + '&ip='), 'raw form');
    assert.equal(url.searchParams.get('apiKey'), odd);
    assert.deepEqual([...url.searchParams.keys()], ['apiKey', 'ip', 'include'], 'no parameter was smuggled in by the key');
    assert.equal(url.searchParams.get('ip'), ip);
    assert.equal(url.hash, ''); assert.equal(url.username, ''); assert.equal(url.pathname, '/v3/ipgeo'); assert.equal(url.origin, 'https://api.ipgeolocation.io');

    const data = build('ipdata', ip, credential), dataUrl = new URL(data.url);
    assert.ok(data.url.endsWith('?api-key=' + encoded));
    assert.equal(dataUrl.searchParams.get('api-key'), odd);
    assert.deepEqual([...dataUrl.searchParams.keys()], ['api-key']);
    assert.equal(dataUrl.pathname, '/' + ip); assert.equal(dataUrl.hash, ''); assert.equal(dataUrl.origin, 'https://api.ipdata.co');

    const pro = build('ipapi', ip, credential), proUrl = new URL(pro.url);
    assert.ok(pro.url.includes('?key=' + encoded + '&fields=' + FIELDS));
    assert.equal(proUrl.searchParams.get('key'), odd);
    assert.deepEqual([...proUrl.searchParams.keys()], ['key', 'fields']);
    assert.equal(proUrl.searchParams.get('fields'), FIELDS); assert.equal(proUrl.pathname, '/json/' + ip); assert.equal(proUrl.hash, ''); assert.equal(proUrl.origin, 'https://pro.ip-api.com');

    const basic = build('maxmind', ip, { accountId: '123456', licenseKey: odd });
    assert.equal(Buffer.from(basic.headers.Authorization.slice('Basic '.length), 'base64').toString('latin1'), '123456:' + odd);
    assert.equal(basic.url.includes('%') || basic.url.includes('&'), false, 'the MaxMind key is not in the URL');
  }
});

test('builder: the key and the account ID appear only where the provider documents them, and nothing else is added', () => {
  const SECRET = 'SeCrEtZq9Xw7Vb', ACCOUNT = '424242';
  for (const id of GEO_PROVIDERS) {
    const credential = id === 'maxmind' ? { accountId: ACCOUNT, licenseKey: SECRET } : { apiKey: SECRET };
    const result = geoBuildRequest(id, IPV4, { credential, settings: settingsWith({}) });
    assert.equal(result.ok, true, id);
    assert.deepEqual(Object.keys(result), ['ok', 'url', 'headers', 'origin', 'bucket'], id + ': only GET data, no body, no cookies, no credentials option');
    assert.deepEqual(Object.keys(result.headers).filter(name => name !== 'Accept' && name !== 'Authorization'), [], id + ': no other header (no Cookie, Referer, User-Agent, X-Api-Key)');
    assert.equal(result.headers.Accept, 'application/json');
    for (const part of ['origin', 'bucket']) assert.equal(result[part].includes(SECRET) || result[part].includes(ACCOUNT), false, id + ' ' + part);
    if (id === 'maxmind') {
      assert.equal(result.url.includes(SECRET) || result.url.includes(ACCOUNT), false, 'MaxMind: neither in the URL');
      assert.equal(Buffer.from(result.headers.Authorization.replace('Basic ', ''), 'base64').toString(), ACCOUNT + ':' + SECRET);
      assert.equal(JSON.stringify(result).includes(SECRET), false, 'MaxMind: the licence key appears only inside the base64');
    } else {
      assert.equal(Object.hasOwn(result.headers, 'Authorization'), false, id + ': the key is a URL parameter, not a header');
      assert.equal(result.url.split(SECRET).length - 1, 1, id + ': exactly once, in the URL');
      assert.equal(JSON.stringify(result.headers).includes(SECRET), false);
    }
  }
  for (const id of GEO_PROVIDERS) for (const result of [geoBuildRequest(id, '10.0.0.1', { credential: { apiKey: SECRET } }), geoBuildRequest(id, IPV4, { credential: { apiKey: 'x' + SECRET + ' y' } })]) {
    assert.equal(result.ok, false); assert.equal(JSON.stringify(result).includes(SECRET), false, 'a refusal never contains the key');
  }
  assert.equal(geoBuildRequest('ipdata', IPV4, { credential: { apiKey: '  ' + SECRET + '\t' } }).url, 'https://api.ipdata.co/8.8.8.8?api-key=' + SECRET, 'surrounding whitespace of a pasted key is cleaned by the shared reader');
});

test('builder: bucket and origin are fixed by the provider and the endpoint; the URL parses back to exactly that origin', () => {
  const cases = [
    ['maxmind', { providers: { maxmind: { service: 'geolite-city' } } }, 'maxmind', 'https://geolite.info'], ['maxmind', { providers: { maxmind: { service: 'geoip-city' } } }, 'maxmind', 'https://geoip.maxmind.com'],
    ['maxmind', { providers: { maxmind: { service: 'geoip-insights' } } }, 'maxmind', 'https://geoip.maxmind.com'], ['ipgeolocation', {}, 'ipgeolocation', 'https://api.ipgeolocation.io'],
    ['ipdata', {}, 'ipdata', 'https://api.ipdata.co'], ['ipapi', {}, 'ipapi', 'https://pro.ip-api.com'], ['ipapi', { providers: { ipapi: { http: true } } }, 'ipapi', 'https://pro.ip-api.com'],
  ];
  for (const [id, patch, bucket, origin] of cases) for (const ip of [IPV4, IPV6]) {
    const result = build(id, ip, credentialOf(id), patch);
    assert.equal(result.bucket, bucket); assert.equal(result.origin, origin);
    assert.equal(new URL(result.url).origin, origin);
    assert.ok(result.url.startsWith(origin + '/'));
    assert.ok(GEO_PROVIDER_INFO[id].origins.includes(result.origin), 'the origin is one of the CSP hosts of the catalogue');
  }
  const free = build('ipapi', IPV4, null, { providers: { ipapi: { http: true } } });
  assert.equal(free.bucket, 'ipapi-free'); assert.equal(free.origin, 'http://ip-api.com'); assert.equal(new URL(free.url).origin, 'http://ip-api.com');
  assert.ok(GEO_PROVIDER_INFO.ipapi.origins.includes(free.origin));
  for (const id of GEO_PROVIDERS) for (const ip of [IPV4, IPV6]) {
    const result = build(id, ip, credentialOf(id), { providers: { ipapi: { http: true } } }), url = new URL(result.url);
    assert.equal(url.protocol === 'https:' || result.bucket === 'ipapi-free', true, 'only the free ip-api endpoint is plain HTTP: ' + id);
    assert.equal(url.username + url.password, '', 'no userinfo in the URL');
  }
});

test('builder: pure and safe to share: equal input gives equal output, results are fresh and frozen, the inputs are never touched', () => {
  const settings = deepFreeze(settingsWith({ providers: { ipapi: { http: true }, ipgeolocation: { security: true } } }));
  for (const id of GEO_PROVIDERS) {
    const options = deepFreeze({ credential: { ...credentialOf(id) }, settings });
    const first = geoBuildRequest(id, IPV4, options), second = geoBuildRequest(id, IPV4, options);
    assert.deepEqual(first, second);
    assert.notEqual(first, second); assert.notEqual(first.headers, second.headers);
    assert.ok(Object.isFrozen(first) && Object.isFrozen(first.headers), id);
    assert.throws(() => { first.headers.Cookie = 'x'; }, TypeError);
    assert.throws(() => { first.url = 'x'; }, TypeError);
  }
  const refusal = geoBuildRequest('ipdata', IPV4, {});
  assert.ok(Object.isFrozen(refusal));
  assert.notEqual(refusal, geoBuildRequest('ipdata', IPV4, {}));
});

// ======================================================================================================================================
// Fixtures: every recorded, documented, synthesized and hostile answer against its hand-written expected result
// ======================================================================================================================================
const fixtureNames = () => readdirSync(FIXTURE_DIR, { recursive: true }).map(name => String(name).split(BACKSLASH).join('/')).filter(name => name.endsWith('.json')).sort();
const readFixture = name => JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8'));
const textOf = fixture => ('text' in fixture ? fixture.text : JSON.stringify(fixture.body));
/** Parses one fixture the way the client would hand it over. `security` overrides the include=security setting of the request. */
function parseFixture(name, security) {
  const fixture = readFixture(name), providers = {};
  if (fixture.service) providers.maxmind = { service: fixture.service };
  if (fixture.provider === 'ipgeolocation') providers.ipgeolocation = { security: security ?? fixture.security === true };
  return geoParseResponse(fixture.provider, { status: fixture.status, headers: fixture.headers, text: textOf(fixture) }, { ip: fixture.ip, now: NOW, settings: settingsWith({ providers }) });
}

const rec = (provider, ip, patch = {}) => ({ provider, service: '', at: NOW, ip, country: '', countryName: '', region: '', city: '', timezone: '', asn: null, org: '', isp: '', kind: '', ...patch, flags: { ...geoEmptyFlags(), ...patch.flags } });
const quota = (remaining, pausedMs = null) => ({ remaining, pausedMs });
const win = (record, quotaValue = null) => ({ ok: true, record, quota: quotaValue });
const lose = (error, retryAfterMs = null, quotaValue = null) => ({ ok: false, error, retryAfterMs, quota: quotaValue });
const CLEAN = 'Be rl in (x) end';   // what the bidi fixtures' dirty text becomes: every forbidden character a space, spaces collapsed

const LOS_ANGELES = { country: 'US', countryName: 'United States', region: 'California', city: 'Los Angeles', timezone: 'America/Los_Angeles', asn: 1239, org: 'Linkem IR WiMax Network' };
const SWEDEN = { country: 'SE', countryName: 'Sweden', region: 'Stockholms l' + cp(0xe4) + 'n', city: 'Stockholm', timezone: 'Europe/Stockholm', asn: 1257, org: 'Tele2 Sverige AB' };
const ALL_FALSE = { proxy: false, vpn: false, tor: false, hosting: false, relay: false, residentialProxy: false, threat: false };

// File -> the complete result. `file#security` / `file#plain` run the same answer with include=security on / off (ipgeolocation.io).
const EXPECT = {
  // ---- MaxMind ----
  'maxmind/ok-city-plus-documented.json': win(rec('maxmind', '1.2.3.4', { service: 'geoip-city', ...LOS_ANGELES, isp: 'Linkem spa', kind: 'isp', flags: { mobile: false } }), quota(54321)),
  // The documented Insights sample says user_type "traveler" (a word the kind vocabulary does not know) and connection_type "Cable/DSL": the known word is the kind.
  'maxmind/ok-insights-documented.json': win(rec('maxmind', '1.2.3.4', { service: 'geoip-insights', ...LOS_ANGELES, isp: 'Linkem spa', kind: 'isp', flags: { proxy: true, vpn: true, tor: true, hosting: true, residentialProxy: true, mobile: false } }), quota(54321)),
  'maxmind/ok-geolite-city-adapted.json': win(rec('maxmind', '1.2.3.4', { service: 'geolite-city', ...LOS_ANGELES })),
  'maxmind/ok-country-only-synthesized.json': win(rec('maxmind', '9.9.9.9', { service: 'geolite-city', country: 'DE', countryName: 'Germany' })),
  // The residential sub-object is a residential-proxy signal by itself; nothing else in the object is "anonymous in general", so the other absent keys are false.
  'maxmind/ok-anonymizer-sparse-synthesized.json': win(rec('maxmind', '8.8.8.8', { service: 'geoip-insights', country: 'US', countryName: 'United States', asn: 15169, org: 'Google LLC', isp: 'Google LLC', kind: 'hosting',
    flags: { proxy: false, vpn: false, tor: false, hosting: true, residentialProxy: true, mobile: false } })),
  // "Anonymous" in general: the specific flags are unknown, not false. A named provider is the same, and vpn stays unknown even when a provider is named.
  'maxmind/ok-anonymizer-general-synthesized.json': win(rec('maxmind', '8.8.8.8', { service: 'geoip-insights', country: 'US', countryName: 'United States' })),
  'maxmind/ok-anonymizer-provider-synthesized.json': win(rec('maxmind', '8.8.8.8', { service: 'geoip-insights', country: 'US', countryName: 'United States', flags: { hosting: true } })),
  'maxmind/ok-anonymizer-residential-only-synthesized.json': win(rec('maxmind', '8.8.8.8', { service: 'geoip-insights', country: 'US', countryName: 'United States', flags: { proxy: false, vpn: false, tor: false, hosting: false, residentialProxy: true } })),
  'maxmind/ok-insights-no-anonymizer-synthesized.json': win(rec('maxmind', '8.8.8.8', { service: 'geoip-insights', country: 'US', countryName: 'United States', flags: { proxy: false, vpn: false, tor: false, hosting: false, residentialProxy: false } })),
  'maxmind/ok-deprecated-traits-synthesized.json': win(rec('maxmind', '8.8.8.8', { service: 'geoip-insights', country: 'US', countryName: 'United States', kind: 'business', flags: { proxy: true, vpn: false, tor: false, hosting: false, residentialProxy: false } })),
  'maxmind/ok-names-fallback-synthesized.json': win(rec('maxmind', '8.8.4.4', { service: 'geoip-city', country: 'FR', countryName: 'France', region: 'Ile-de-France', city: 'Paris', timezone: 'Europe/Paris', kind: 'isp', flags: { mobile: false } })),
  'maxmind/ok-cellular-synthesized.json': win(rec('maxmind', '1.1.1.1', { service: 'geoip-city', country: 'GB', countryName: 'United Kingdom', asn: 64500, org: 'Example Mobile AS', isp: 'Example Mobile', kind: 'mobile', flags: { mobile: true } })),
  'maxmind/ok-ipv6-synthesized.json': win(rec('maxmind', '2001:4860:4860::8888', { service: 'geoip-city', country: 'US', countryName: 'United States' })),
  'maxmind/ok-traits-only-synthesized.json': lose('not-found', null, quota(100)),
  'maxmind/ok-ip-mismatch-synthesized.json': lose('bad-response', null, quota(7)),
  'maxmind/err-400-ip-reserved-documented.json': lose('not-public'),
  'maxmind/err-400-ip-invalid-documented.json': lose('not-public'),
  'maxmind/err-400-ip-required-synthesized.json': lose('not-public'),
  'maxmind/err-400-service-invalid-synthesized.json': lose('bad-response'),
  'maxmind/err-400-unknown-code-synthesized.json': lose('not-public'),
  'maxmind/err-401-authorization-invalid-geolite-live.json': lose('unauthorized'),
  'maxmind/err-401-authorization-invalid-geoip-live.json': lose('unauthorized'),
  'maxmind/err-401-account-id-required-synthesized.json': lose('unauthorized'),
  'maxmind/err-401-license-key-required-synthesized.json': lose('unauthorized'),
  'maxmind/err-402-insufficient-funds-documented.json': lose('quota'),
  'maxmind/err-403-permission-required-documented.json': lose('forbidden'),
  'maxmind/err-403-plain-http-no-body-synthesized.json': lose('forbidden'),
  'maxmind/err-404-ip-not-found-documented.json': lose('not-found'),
  'maxmind/err-404-no-body-synthesized.json': lose('not-found'),
  'maxmind/err-429-no-body-synthesized.json': lose('rate-limited', 60000),
  'maxmind/err-500-server-error-documented.json': lose('server'),
  'maxmind/err-503-no-body-synthesized.json': lose('server'),
  'maxmind/err-502-html-synthesized.json': lose('server'),
  'maxmind/err-418-unknown-status-synthesized.json': lose('bad-response'),
  'maxmind/hostile-prototype-pollution.json': win(rec('maxmind', '8.8.8.8', { service: 'geoip-insights', country: 'US', countryName: 'United States', isp: 'Example ISP',
    flags: { proxy: false, vpn: false, tor: false, hosting: false, residentialProxy: false } })),
  'maxmind/hostile-bidi-text.json': win(rec('maxmind', '8.8.8.8', { service: 'geoip-insights', country: 'US', countryName: CLEAN, region: CLEAN, city: CLEAN, org: CLEAN, isp: CLEAN, kind: 'other',
    flags: { proxy: false, vpn: false, tor: false, hosting: false, residentialProxy: false } })),   // an Insights answer with no anonymizer object: nothing was flagged
  'maxmind/hostile-wrong-types.json': lose('not-found'),
  'maxmind/hostile-null-top-level.json': lose('bad-response'),
  'maxmind/hostile-null-fields.json': lose('not-found'),
  'maxmind/hostile-arrays-for-objects.json': lose('bad-response'),
  // ---- ipgeolocation.io ----
  'ipgeolocation/ok-free-documented.json': win(rec('ipgeolocation', '91.128.103.196', SWEDEN)),
  'ipgeolocation/ok-paid-documented.json': win(rec('ipgeolocation', '91.128.103.196', { ...SWEDEN, isp: 'Tele2 Sverige AB', kind: 'isp' })),
  'ipgeolocation/ok-security-documented.json': win(rec('ipgeolocation', '2.56.188.34', { country: 'US', countryName: 'United States', region: 'Texas', city: 'Dallas', timezone: 'America/Chicago', asn: 62240, org: 'Clouvider Limited',
    isp: 'Clouvider Limited', kind: 'hosting', flags: { proxy: false, vpn: true, tor: false, hosting: true, relay: false, residentialProxy: false, threat: true } })),
  'ipgeolocation/ok-include-all-documented.json': win(rec('ipgeolocation', '91.128.103.196', { ...SWEDEN, isp: 'Tele2 Sverige AB', kind: 'isp', flags: ALL_FALSE })),
  'ipgeolocation/ok-cdn-synthesized.json': win(rec('ipgeolocation', '1.1.1.1', { country: 'AU', countryName: 'Australia', region: 'New South Wales', city: 'Sydney', timezone: 'Australia/Sydney', asn: 13335, org: 'Example CDN Inc.', kind: 'cdn' })),
  'ipgeolocation/ok-connection-mobile-synthesized.json': win(rec('ipgeolocation', '8.8.4.4', { country: 'GB', countryName: 'United Kingdom', city: 'London', asn: 64501, org: 'Example Mobile Ltd', kind: 'mobile' })),
  'ipgeolocation/ok-ipv6-synthesized.json': win(rec('ipgeolocation', '2001:4860:4860::8888', { country: 'US', countryName: 'United States', city: 'Mountain View' })),
  'ipgeolocation/ok-ip-only-synthesized.json': lose('not-found'),
  'ipgeolocation/ok-ip-mismatch-synthesized.json': lose('bad-response'),
  // The error bodies are the provider's own OpenAPI examples (ip-location-api.yaml). A 401 is a plan problem only with include=security on AND the one plan message.
  'ipgeolocation/err-400-invalid-ip-documented.json': lose('not-public'),
  'ipgeolocation/err-400-special-characters-documented.json': lose('bad-response'),
  'ipgeolocation/err-400-invalid-lang-documented.json': lose('bad-response'),
  'ipgeolocation/err-401-missing-key-documented.json': lose('unauthorized'),
  'ipgeolocation/err-401-missing-key-documented.json#security': lose('unauthorized'),
  'ipgeolocation/err-401-invalid-key-documented.json': lose('unauthorized'),
  'ipgeolocation/err-401-invalid-key-documented.json#security': lose('unauthorized'),
  'ipgeolocation/err-401-invalid-key-live.json': lose('unauthorized'),
  'ipgeolocation/err-401-invalid-key-live.json#security': lose('unauthorized'),
  'ipgeolocation/err-401-unverified-email-documented.json': lose('unauthorized'),
  'ipgeolocation/err-401-unverified-email-documented.json#security': lose('unauthorized'),
  'ipgeolocation/err-401-locked-account-documented.json': lose('unauthorized'),
  'ipgeolocation/err-401-locked-account-documented.json#security': lose('unauthorized'),
  'ipgeolocation/err-401-database-plan-documented.json': lose('unauthorized'),
  'ipgeolocation/err-401-database-plan-documented.json#security': lose('unauthorized'),
  'ipgeolocation/err-401-paused-subscription-documented.json': lose('unauthorized'),
  'ipgeolocation/err-401-paused-subscription-documented.json#security': lose('unauthorized'),
  'ipgeolocation/err-401-free-plan-security-documented.json': lose('unauthorized'),
  'ipgeolocation/err-401-free-plan-security-documented.json#security': lose('plan'),
  'ipgeolocation/err-401-free-plan-domain-documented.json': lose('unauthorized'),
  'ipgeolocation/err-401-free-plan-domain-documented.json#security': lose('plan'),
  'ipgeolocation/err-401-free-plan-lang-documented.json': lose('unauthorized'),
  'ipgeolocation/err-401-free-plan-lang-documented.json#security': lose('unauthorized'),
  'ipgeolocation/err-402-expired-subscription-documented.json': lose('unauthorized'),
  'ipgeolocation/err-403-ip-allow-list-documented.json': lose('forbidden'),
  'ipgeolocation/err-404-ip-not-in-database-documented.json': lose('not-found'),
  'ipgeolocation/err-404-ip-as-path-documented.json': lose('not-found'),
  'ipgeolocation/err-404-wrong-endpoint-documented.json': lose('not-found'),
  'ipgeolocation/err-423-bogon-documented.json': lose('not-public'),
  'ipgeolocation/err-429-usage-limit-documented.json': lose('quota'),
  'ipgeolocation/err-429-trial-limit-documented.json': lose('quota'),
  'ipgeolocation/err-429-surcharge-limit-documented.json': lose('quota'),
  'ipgeolocation/err-499-synthesized.json': lose('bad-response'),
  'ipgeolocation/err-500-internal-documented.json': lose('server'),
  'ipgeolocation/err-503-verify-key-documented.json': lose('server'),
  'ipgeolocation/hostile-prototype-pollution.json': win(rec('ipgeolocation', '8.8.8.8', { country: 'US', countryName: 'United States', city: 'Mountain View', asn: 15169, kind: 'other', flags: { tor: false } })),
  'ipgeolocation/hostile-bidi-text.json': win(rec('ipgeolocation', '8.8.8.8', { country: 'US', countryName: CLEAN, region: CLEAN, city: CLEAN, asn: 15169, org: CLEAN, isp: CLEAN, kind: 'other' })),
  'ipgeolocation/hostile-wrong-types.json': lose('not-found'),
  'ipgeolocation/hostile-null-top-level.json': lose('bad-response'),
  'ipgeolocation/hostile-null-fields.json': lose('not-found'),
  'ipgeolocation/hostile-arrays-for-objects.json': lose('bad-response'),
  // ---- ipdata ----
  'ipdata/ok-geolocation-documented.json': win(rec('ipdata', '24.24.24.24', { country: 'US', countryName: 'United States', region: 'New York', city: 'Syracuse' })),
  'ipdata/ok-bulk-first-documented.json': win(rec('ipdata', '1.1.1.1', { country: 'AU', countryName: 'Australia', timezone: 'Australia/Sydney', asn: 13335, org: 'Cloudflare, Inc.', kind: 'hosting', flags: { proxy: false, tor: false, threat: false } })),
  'ipdata/ok-bulk-second-documented.json': win(rec('ipdata', '2.2.2.2', { country: 'FR', countryName: 'France', timezone: 'Europe/Paris', asn: 3215, org: 'Orange S.A.', kind: 'isp', flags: { proxy: false, tor: false, mobile: true, threat: false } })),
  'ipdata/ok-bulk-third-documented.json': win(rec('ipdata', '3.3.3.3', { country: 'US', countryName: 'United States', region: 'Washington', city: 'Seattle', timezone: 'America/Los_Angeles', flags: { proxy: false, tor: false, threat: false } })),
  'ipdata/ok-carrier-fields-documented.json': win(rec('ipdata', '69.78.70.144', { countryName: 'United States', region: 'Texas', city: 'Farmersville', kind: 'mobile', flags: { mobile: true } })),
  'ipdata/ok-business-full-synthesized.json': win(rec('ipdata', '8.8.8.8', { country: 'US', countryName: 'United States', region: 'California', city: 'Mountain View', timezone: 'America/Los_Angeles', asn: 15169, org: 'Google LLC',
    isp: 'Google LLC', kind: 'hosting', flags: { proxy: false, vpn: false, tor: false, hosting: true, relay: false, threat: false } })),
  'ipdata/ok-threat-sample-documented.json': win(rec('ipdata', '45.148.10.240', { country: 'NL', countryName: 'Netherlands', flags: { proxy: false, tor: false, hosting: false, relay: false, threat: true } })),
  'ipdata/ok-threat-flags-synthesized.json': win(rec('ipdata', '8.8.4.4', { country: 'US', asn: 15169, org: 'Google LLC', isp: 'Example University', kind: 'education',
    flags: { proxy: true, vpn: true, tor: true, hosting: true, relay: true, threat: true } })),
  'ipdata/ok-free-minimal-synthesized.json': win(rec('ipdata', '8.8.4.4', { country: 'US', countryName: 'United States', timezone: 'America/Chicago', asn: 15169, org: 'Google LLC', kind: 'hosting' })),
  'ipdata/ok-ipv6-synthesized.json': win(rec('ipdata', '2001:4860:4860::8888', { country: 'US', countryName: 'United States', city: 'Mountain View' })),
  'ipdata/ok-ip-only-synthesized.json': lose('not-found'),
  'ipdata/ok-ip-mismatch-synthesized.json': lose('bad-response'),
  'ipdata/err-400-private-documented.json': lose('not-public'),
  'ipdata/err-400-reserved-documented.json': lose('not-public'),
  'ipdata/err-400-not-an-ip-documented.json': lose('not-public'),
  'ipdata/err-401-invalid-key-live.json': lose('unauthorized'),
  'ipdata/err-403-free-quota-documented.json': lose('quota'),
  'ipdata/err-403-daily-quota-documented.json': lose('quota'),
  'ipdata/err-403-bulk-plan-documented.json': lose('plan'),
  'ipdata/err-403-asn-plan-documented.json': lose('plan'),
  'ipdata/err-403-whitelist-documented.json': lose('forbidden'),
  'ipdata/err-404-asn-not-found-documented.json': lose('not-found'),
  'ipdata/err-429-synthesized.json': lose('rate-limited'),
  'ipdata/err-500-synthesized.json': lose('server'),
  'ipdata/err-502-html-synthesized.json': lose('server'),
  'ipdata/hostile-prototype-pollution.json': win(rec('ipdata', '8.8.8.8', { country: 'US', countryName: 'United States', city: 'Mountain View', asn: 15169, org: 'Google LLC', kind: 'other', flags: { tor: false } })),
  'ipdata/hostile-bidi-text.json': win(rec('ipdata', '8.8.8.8', { country: 'US', countryName: CLEAN, region: CLEAN, city: CLEAN, asn: 15169, org: CLEAN, isp: CLEAN, kind: 'other' })),
  'ipdata/hostile-wrong-types.json': lose('not-found'),
  'ipdata/hostile-null-top-level.json': lose('bad-response'),
  'ipdata/hostile-null-fields.json': lose('not-found'),
  'ipdata/hostile-arrays-for-objects.json': lose('bad-response'),
  // ---- ip-api.com ----
  'ipapi/ok-free-live.json': win(rec('ipapi', '8.8.8.8', { country: 'US', countryName: 'United States', region: 'Virginia', city: 'Ashburn', timezone: 'America/New_York', asn: 15169, org: 'Google LLC', isp: 'Google LLC', kind: 'hosting',
    flags: { proxy: true, hosting: true, mobile: false } }), quota(44)),
  'ipapi/ok-free-fields-adapted.json': win(rec('ipapi', '8.8.8.8', { country: 'US', countryName: 'United States', region: 'Virginia', city: 'Ashburn', timezone: 'America/New_York', asn: 15169, org: 'Google LLC', isp: 'Google LLC', kind: 'hosting',
    flags: { proxy: true, hosting: true, mobile: false } }), quota(44)),
  'ipapi/ok-pro-synthesized.json': win(rec('ipapi', '9.9.9.9', { country: 'DE', countryName: 'Germany', region: 'Hesse', city: 'Frankfurt am Main', timezone: 'Europe/Berlin', asn: 64500, org: 'Example Hosting GmbH', isp: 'Example Hosting GmbH',
    kind: 'hosting', flags: { proxy: false, hosting: true, mobile: false } })),
  'ipapi/ok-mobile-synthesized.json': win(rec('ipapi', '1.1.1.1', { country: 'GB', countryName: 'United Kingdom', region: 'England', city: 'London', timezone: 'Europe/London', asn: 64501, org: 'Example Mobile Ltd', isp: 'Example Mobile',
    kind: 'mobile', flags: { proxy: false, hosting: false, mobile: true } }), quota(20)),
  'ipapi/ok-ipv6-synthesized.json': win(rec('ipapi', '2001:4860:4860::8888', { country: 'US', countryName: 'United States', region: 'California', city: 'Mountain View', timezone: 'America/Los_Angeles', flags: { proxy: false, hosting: false, mobile: false } })),
  'ipapi/ok-no-bgp-synthesized.json': win(rec('ipapi', '8.8.4.4', { country: 'FR', countryName: 'France', city: 'Paris', timezone: 'Europe/Paris', isp: 'Example ISP' })),
  'ipapi/ok-as-number-only-synthesized.json': win(rec('ipapi', '8.8.8.8', { country: 'US', countryName: 'United States', region: 'CA', city: 'Mountain View', asn: 15169, org: 'GOOGLE', isp: 'Google Public DNS' })),
  'ipapi/ok-window-empty-synthesized.json': win(rec('ipapi', '8.8.8.8', { country: 'US', countryName: 'United States', city: 'Ashburn' }), quota(0, 37000)),
  'ipapi/ok-empty-synthesized.json': lose('not-found', null, quota(10)),
  'ipapi/ok-ip-mismatch-synthesized.json': lose('bad-response'),
  'ipapi/err-200-private-range-live.json': lose('not-public'),
  'ipapi/err-200-reserved-range-synthesized.json': lose('not-public'),
  'ipapi/err-200-invalid-query-synthesized.json': lose('not-public'),
  'ipapi/err-200-fail-unknown-message-synthesized.json': lose('bad-response'),
  'ipapi/err-200-fail-key-message-synthesized.json': lose('unauthorized'),
  'ipapi/err-403-pro-invalid-key-live.json': lose('unauthorized'),
  'ipapi/err-403-no-body-synthesized.json': lose('forbidden'),
  'ipapi/err-429-limit-synthesized.json': lose('rate-limited', 37000, quota(0, 37000)),
  'ipapi/err-429-no-headers-synthesized.json': lose('rate-limited'),
  'ipapi/err-500-synthesized.json': lose('server'),
  'ipapi/hostile-prototype-pollution.json': win(rec('ipapi', '8.8.8.8', { country: 'US', countryName: 'United States', city: 'Mountain View', flags: { proxy: false } })),
  'ipapi/hostile-bidi-text.json': win(rec('ipapi', '8.8.8.8', { country: 'US', countryName: CLEAN, region: CLEAN, city: CLEAN, asn: 15169, org: CLEAN, isp: CLEAN, flags: { proxy: false, hosting: false, mobile: false } })),
  'ipapi/hostile-wrong-types.json': lose('not-found'),
  'ipapi/hostile-null-top-level.json': lose('bad-response'),
  'ipapi/hostile-null-fields.json': lose('not-found'),
  'ipapi/hostile-arrays-for-objects.json': lose('bad-response'),
};

for (const [key, expected] of Object.entries(EXPECT)) {
  const [name, variant] = key.split('#');
  test('fixture ' + key, () => {
    const result = parseFixture(name, variant === 'security' ? true : (variant === 'plain' ? false : undefined));
    assert.deepEqual(result, expected);
    assert.equal(({}).polluted, undefined, 'Object.prototype is untouched');
    if (result.ok) {
      assert.deepEqual(normalizeGeoRecord(result.record, NOW), result.record, 'a returned record always passes the strict reader unchanged');
      assert.equal(result.record.ip, readFixture(name).ip);
    } else {
      assert.deepEqual(Object.keys(result), ['ok', 'error', 'retryAfterMs', 'quota']);
      assert.ok(GEO_ERRORS.includes(result.error));
    }
  });
}

test('fixtures: the live answers of 2026-11-06 give exactly the results the owner side reported', () => {
  assert.deepEqual(parseFixture('ipdata/err-401-invalid-key-live.json'), lose('unauthorized'));
  assert.deepEqual(parseFixture('ipgeolocation/err-401-invalid-key-live.json'), lose('unauthorized'));
  assert.deepEqual(parseFixture('ipgeolocation/err-401-invalid-key-live.json', true), lose('unauthorized'), 'a key problem is not a plan problem, even with include=security on');
  assert.deepEqual(parseFixture('maxmind/err-401-authorization-invalid-geolite-live.json'), lose('unauthorized'));
  assert.deepEqual(parseFixture('maxmind/err-401-authorization-invalid-geoip-live.json'), lose('unauthorized'));
  assert.deepEqual(parseFixture('ipapi/err-403-pro-invalid-key-live.json'), lose('unauthorized'));
  assert.deepEqual(parseFixture('ipapi/err-200-private-range-live.json'), lose('not-public'));
  const live = parseFixture('ipapi/ok-free-live.json');
  assert.equal(live.ok, true); assert.deepEqual(live.quota, quota(44));
  assert.equal(readFixture('ipapi/ok-free-live.json').headers['x-ttl'], '60');
  assert.equal(readFixture('ipgeolocation/err-401-invalid-key-live.json').text, readFixture('ipgeolocation/err-401-invalid-key-documented.json').text, 'the live 401 body is byte-identical to the OpenAPI example: the file describes the real service');
});

test('errors: no result of a failure carries a provider message, a URL, an address of the provider or anything key-like', () => {
  for (const key of Object.keys(EXPECT)) {
    const [name, variant] = key.split('#');
    const fixture = readFixture(name), result = parseFixture(name, variant === 'security' ? true : undefined);
    if (result.ok) continue;
    const serialized = JSON.stringify(result);
    assert.equal(/https?:|:\/\/|@|key|ipgeolocation\.io|ip-api|maxmind|ipdata|members|support|account|license|renew/i.test(serialized), false, name + ' leaks: ' + serialized);
    const body = typeof fixture.text === 'string' ? fixture.text : '';
    for (const quoted of body.match(/"(?:message|error)":\s*"([^"]+)"/g) ?? []) assert.equal(serialized.includes(quoted.replace(/^[^:]+:\s*"/, '').slice(0, -1)), false, name);
  }
});

// ======================================================================================================================================
// The mapping table of docs/coverage/proxy-geolocation.md, cell by cell: one source field per synthetic body, the rest of the record untouched
// ======================================================================================================================================
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const merge = (base, patch) => { const out = { ...base }; for (const [key, value] of Object.entries(patch)) out[key] = isObject(value) && isObject(base[key]) ? merge(base[key], value) : value; return out; };
const JSON_HEADERS = { 'content-type': 'application/json' };
/** Parses a body (an object, or a ready text) as an answer to a request for `ip`. */
function answer(provider, body, { ip = IPV4, service, security = false, status = 200, headers = JSON_HEADERS, now = NOW } = {}) {
  const providers = { ipgeolocation: { security } };
  if (service) providers.maxmind = { service };
  return geoParseResponse(provider, { status, headers, text: typeof body === 'string' ? body : JSON.stringify(body) }, { ip, now, settings: settingsWith({ providers }) });
}

const ANON_KEYS = { proxy: 'is_public_proxy', vpn: 'is_anonymous_vpn', tor: 'is_tor_exit_node', hosting: 'is_hosting_provider', residentialProxy: 'is_residential_proxy' };
const ANON_FALSE = Object.fromEntries(Object.keys(ANON_KEYS).map(flag => [flag, false]));
const MAXMIND_GEO = [
  [{ country: { iso_code: 'gb' } }, { country: 'GB' }],
  [{ country: { names: { en: 'United States', de: 'USA' } } }, { countryName: 'United States' }],
  [{ country: { names: { de: 'USA', en: 'United States' } } }, { countryName: 'United States' }],
  [{ country: { names: { de: 'Deutschland', fr: 'Allemagne' } } }, { countryName: 'Deutschland' }],
  [{ country: { names: { de: 7, fr: 'Allemagne' } } }, { countryName: 'Allemagne' }],
  [{ country: { names: { en: '', de: 'Deutschland' } } }, { countryName: 'Deutschland' }],
  [{ subdivisions: [{ names: { en: 'California' } }] }, { region: 'California' }],
  [{ subdivisions: [{ names: { en: 'California' } }, { names: { en: 'Los Angeles County' } }] }, { region: 'California' }],
  [{ subdivisions: [{ iso_code: 'CA' }] }, {}],
  [{ subdivisions: [] }, {}],
  [{ city: { names: { en: 'Los Angeles' } } }, { city: 'Los Angeles' }],
  [{ location: { time_zone: 'America/Los_Angeles' } }, { timezone: 'America/Los_Angeles' }],
  [{ location: { time_zone: 'Etc/GMT+5' } }, { timezone: 'Etc/GMT+5' }],
  [{ location: { time_zone: 'not a zone' } }, {}],
  [{ traits: { autonomous_system_number: 15169 } }, { asn: 15169 }],
  [{ traits: { autonomous_system_number: 1 } }, { asn: 1 }],
  [{ traits: { autonomous_system_number: 4294967295 } }, { asn: 4294967295 }],
  [{ traits: { autonomous_system_number: 4294967296 } }, {}],
  [{ traits: { autonomous_system_number: 0 } }, {}],
  [{ traits: { autonomous_system_number: -5 } }, {}],
  [{ traits: { autonomous_system_number: 1.5 } }, {}],
  [{ traits: { autonomous_system_organization: 'Google LLC' } }, { org: 'Google LLC' }],
  [{ traits: { isp: 'ISP A' } }, { isp: 'ISP A' }],
  [{ traits: { organization: 'Org B' } }, { isp: 'Org B' }],
  [{ traits: { isp: 'ISP A', organization: 'Org B' } }, { isp: 'ISP A' }],
  [{ traits: { isp: '', organization: 'Org B' } }, { isp: 'Org B' }],
];
const MAXMIND_KIND = [
  ...[['residential', 'residential'], ['hosting', 'hosting'], ['cellular', 'mobile'], ['business', 'business'], ['school', 'education'], ['college', 'education'], ['library', 'education'], ['government', 'government'],
    ['military', 'government'], ['content_delivery_network', 'cdn'], ['cafe', 'other'], ['router', 'other'], ['search_engine_spider', 'other'], ['traveler', 'other'], ['consumer_privacy_network', 'other'],
    ['Residential', 'residential'], ['CONTENT_DELIVERY_NETWORK', 'cdn'], [' hosting ', 'hosting'], ['constructor', 'other'], ['__proto__', 'other'], ['toString', 'other'], ['hasOwnProperty', 'other'], ['something_new', 'other']]
    .map(([word, kind]) => [{ traits: { user_type: word } }, { kind, ...(word.trim().toLowerCase() === 'cellular' ? { flags: { mobile: true } } : {}) }]),
  ...[['Cellular', 'mobile', true], ['CELLULAR', 'mobile', true], ['Corporate', 'business', false], ['Cable/DSL', 'isp', false], ['cable/dsl', 'isp', false], ['Satellite', 'isp', false], ['Dialup', 'other', false], ['constructor', 'other', false]]
    .map(([word, kind, mobile]) => [{ traits: { connection_type: word } }, { kind, flags: { mobile } }]),
  // Both words known: user_type is first, connection_type is the fallback.
  [{ traits: { user_type: 'hosting', connection_type: 'Cellular' } }, { kind: 'hosting', flags: { mobile: true } }],
  [{ traits: { user_type: 'business', connection_type: 'Cable/DSL' } }, { kind: 'business', flags: { mobile: false } }],
  [{ traits: { user_type: 'cellular', connection_type: 'Cable/DSL' } }, { kind: 'mobile', flags: { mobile: true } }],
  [{ traits: { user_type: '', connection_type: 'Corporate' } }, { kind: 'business', flags: { mobile: false } }],
  [{ traits: { user_type: '  ', connection_type: 'Satellite' } }, { kind: 'isp', flags: { mobile: false } }],
  [{ traits: { user_type: 5, connection_type: 'Satellite' } }, { kind: 'isp', flags: { mobile: false } }],
  // A word the vocabulary does not know ("traveler" is in the documented Insights sample) must not hide a known one; "other" is only for when nothing is known.
  [{ traits: { user_type: 'traveler', connection_type: 'Cable/DSL' } }, { kind: 'isp', flags: { mobile: false } }],
  [{ traits: { user_type: 'traveler', connection_type: 'Corporate' } }, { kind: 'business', flags: { mobile: false } }],
  [{ traits: { user_type: 'cafe', connection_type: 'Satellite' } }, { kind: 'isp', flags: { mobile: false } }],
  [{ traits: { user_type: 'consumer_privacy_network', connection_type: 'Cellular' } }, { kind: 'mobile', flags: { mobile: true } }],
  [{ traits: { user_type: 'traveler', connection_type: 'Dialup' } }, { kind: 'other', flags: { mobile: false } }],
  [{ traits: { user_type: 'traveler', connection_type: '' } }, { kind: 'other' }],
  [{ traits: { user_type: 'business' } }, { kind: 'business' }],
  [{ traits: { user_type: 'traveler' } }, { kind: 'other' }],
  [{ traits: { connection_type: '' } }, {}],
];

// ---- MaxMind flags (D1). A flag has two sources: the anonymizer object and the deprecated traits.is_* alias. A present boolean is taken as given and a true from
// either source wins. A flag nobody states is: false when the anonymizer object is there and is not "anonymous in general" (MaxMind leaves false booleans out);
// unknown when the object says only "anonymous" (is_anonymous true, or a provider name) or is not an object; with no object at all, false for GeoIP Insights
// (empty values are left out) and unknown for the services that have no anonymizer. The residential sub-object is a residential-proxy signal by itself.
const ANON_NULL = Object.fromEntries(Object.keys(ANON_KEYS).map(flag => [flag, null]));
const everyFlag = value => (value === false ? ANON_FALSE : ANON_NULL);
// Rows whose result does not depend on the service: an anonymizer object (or a value of the wrong type) is there.
const MAXMIND_FLAGS_OBJECT = [
  // (b) not "anonymous in general": an absent key is false
  [{ anonymizer: {} }, { flags: ANON_FALSE }],
  [{ anonymizer: { confidence: 99, network_last_seen: '2025-01-15' } }, { flags: ANON_FALSE }],
  [{ anonymizer: { is_anonymous: false } }, { flags: ANON_FALSE }],
  [{ anonymizer: { is_anonymous: 'true' } }, { flags: ANON_FALSE }],   // only the boolean true makes it general
  [{ anonymizer: { provider_name: '' } }, { flags: ANON_FALSE }],
  [{ anonymizer: { provider_name: '   ' } }, { flags: ANON_FALSE }],
  [{ anonymizer: { provider_name: 5 } }, { flags: ANON_FALSE }],
  // (b) "anonymous in general" - audit probes M05 and M06: the specific flags are unknown, a key that is there is taken as given, vpn stays unknown for a named provider
  [{ anonymizer: { is_anonymous: true, confidence: 30 } }, { flags: ANON_NULL }],
  [{ anonymizer: { is_anonymous: true } }, { flags: ANON_NULL }],
  [{ anonymizer: { provider_name: 'nordvpn' } }, { flags: ANON_NULL }],
  [{ anonymizer: { is_anonymous: true, is_hosting_provider: true, provider_name: 'surfshark' } }, { flags: { ...ANON_NULL, hosting: true } }],
  // (a) the residential sub-object - audit probe M04
  [{ anonymizer: { residential: { confidence: 82 } } }, { flags: { ...ANON_FALSE, residentialProxy: true } }],
  [{ anonymizer: { residential: { confidence: 82 }, is_residential_proxy: false } }, { flags: { ...ANON_FALSE, residentialProxy: true } }],
  [{ anonymizer: { residential: { provider_name: 'quickshift' } } }, { flags: { ...ANON_FALSE, residentialProxy: true } }],   // a name inside the sub-object is not "anonymous in general"
  [{ anonymizer: { is_anonymous: true, residential: { confidence: 80 } } }, { flags: { ...ANON_NULL, residentialProxy: true } }],
  [{ anonymizer: { residential: { confidence: 82 } }, traits: { is_residential_proxy: false } }, { flags: { ...ANON_FALSE, residentialProxy: true } }],
  [{ anonymizer: { residential: 'yes' } }, { flags: ANON_FALSE }],
  [{ anonymizer: { residential: [] } }, { flags: ANON_FALSE }],
  [{ anonymizer: { residential: null } }, { flags: ANON_FALSE }],
  // a value that is not an object says nothing at all: unknown, not false
  ...['yes', [], null, 5, true].map(value => [{ anonymizer: value }, { flags: ANON_NULL }]),
  ...Object.entries(ANON_KEYS).flatMap(([flag, key]) => [
    [{ anonymizer: { [key]: true } }, { flags: { ...ANON_FALSE, [flag]: true } }],
    [{ anonymizer: { [key]: false } }, { flags: ANON_FALSE }],
    [{ anonymizer: { [key]: 'yes' } }, { flags: { ...ANON_FALSE, [flag]: null } }],
    [{ anonymizer: { [key]: null } }, { flags: { ...ANON_FALSE, [flag]: null } }],
    [{ anonymizer: { is_anonymous: true, [key]: true } }, { flags: { ...ANON_NULL, [flag]: true } }],
    [{ anonymizer: { is_anonymous: true, [key]: false } }, { flags: { ...ANON_NULL, [flag]: false } }],
    [{ anonymizer: { provider_name: 'nordvpn', [key]: true } }, { flags: { ...ANON_NULL, [flag]: true } }],
    // (d) the alias beside an anonymizer object: true from either wins, a false counts when the other source is silent
    [{ anonymizer: { [key]: false }, traits: { [key]: true } }, { flags: { ...ANON_FALSE, [flag]: true } }],
    [{ anonymizer: { [key]: true }, traits: { [key]: false } }, { flags: { ...ANON_FALSE, [flag]: true } }],
    [{ anonymizer: { [key]: false }, traits: { [key]: false } }, { flags: ANON_FALSE }],
    [{ anonymizer: {}, traits: { [key]: true } }, { flags: { ...ANON_FALSE, [flag]: true } }],
    [{ anonymizer: {}, traits: { [key]: false } }, { flags: ANON_FALSE }],
    [{ anonymizer: { is_anonymous: true }, traits: { [key]: true } }, { flags: { ...ANON_NULL, [flag]: true } }],
    [{ anonymizer: { is_anonymous: true }, traits: { [key]: false } }, { flags: { ...ANON_NULL, [flag]: false } }],
    [{ anonymizer: { [key]: 'yes' }, traits: { [key]: true } }, { flags: { ...ANON_FALSE, [flag]: true } }],
    [{ anonymizer: { [key]: 'yes' }, traits: { [key]: false } }, { flags: ANON_FALSE }],
    [{ anonymizer: 'yes', traits: { [key]: true } }, { flags: { ...ANON_NULL, [flag]: true } }],
    [{ anonymizer: [], traits: { [key]: false } }, { flags: { ...ANON_NULL, [flag]: false } }],
    [{ anonymizer: null, traits: { [key]: true } }, { flags: { ...ANON_NULL, [flag]: true } }],
  ]),
];
// Rows with no anonymizer object: only the aliases speak; whatever they do not state is `missing` (false for Insights, null for the other services).
const maxmindFlagsWithoutObject = missing => [
  [{}, { flags: everyFlag(missing) }],
  [{ traits: { is_anonymous: true } }, { flags: everyFlag(missing) }],   // not one of the five flags
  [{ traits: { is_public_proxy: true, is_tor_exit_node: false } }, { flags: { ...everyFlag(missing), proxy: true, tor: false } }],
  ...Object.entries(ANON_KEYS).flatMap(([flag, key]) => [
    [{ traits: { [key]: true } }, { flags: { ...everyFlag(missing), [flag]: true } }],
    [{ traits: { [key]: false } }, { flags: { ...everyFlag(missing), [flag]: false } }],
    [{ traits: { [key]: 'yes' } }, { flags: { ...everyFlag(missing), [flag]: null } }],
    [{ traits: { [key]: null } }, { flags: { ...everyFlag(missing), [flag]: null } }],
  ]),
];

const IPGEOLOCATION_GEO = [
  [{ location: { country_code2: 'se' } }, { country: 'SE' }],
  [{ location: { country_name: 'Sweden' } }, { countryName: 'Sweden' }],
  [{ location: { state_prov: 'Skane' } }, { region: 'Skane' }],
  [{ location: { city: 'Malmo' } }, { city: 'Malmo' }],
  [{ location: { country_code3: 'SWE', state_code: 'SE-M', district: 'X', zipcode: '1', latitude: '1', longitude: '2' } }, {}],
  [{ time_zone: { name: 'Europe/Stockholm' } }, { timezone: 'Europe/Stockholm' }],
  [{ asn: { as_number: 'AS1257' } }, { asn: 1257 }],
  [{ asn: { as_number: 'AS1257 Tele2' } }, { asn: 1257 }],
  [{ asn: { as_number: 1257 } }, { asn: 1257 }],
  [{ asn: { as_number: '1257' } }, { asn: 1257 }],
  [{ asn: { as_number: 'AS0' } }, {}], [{ asn: { as_number: 'ASx' } }, {}], [{ asn: { as_number: 'AS4294967296' } }, {}], [{ asn: { as_number: 'AS1257Tele2' } }, {}],
  [{ asn: { organization: 'Tele2 Sverige AB' } }, { org: 'Tele2 Sverige AB' }],
  [{ company: { name: 'Tele2 Sverige AB' } }, { isp: 'Tele2 Sverige AB' }],
];
const USAGE_WORDS = [['isp', 'isp'], ['ISP', 'isp'], ['hosting', 'hosting'], ['HOSTING', 'hosting'], ['Business', 'business'], ['EDUCATION', 'education'], ['GOVERNMENT', 'government'], ['CDN', 'cdn'], ['edu', 'education'],
  ['gov', 'government'], ['mil', 'government'], ['unknown', ''], ['constructor', 'other'], ['__proto__', 'other'], ['WEIRD', 'other']];
const IPGEOLOCATION_KIND = [
  ...USAGE_WORDS.map(([word, kind]) => [{ asn: { type: word } }, kind === '' ? {} : { kind }]),
  ...USAGE_WORDS.map(([word, kind]) => [{ company: { type: word } }, kind === '' ? {} : { kind }]),
  [{ asn: { type: 'HOSTING' }, company: { type: 'ISP' } }, { kind: 'hosting' }],
  [{ asn: { type: '' }, company: { type: 'ISP' } }, { kind: 'isp' }],
  [{ asn: { type: 'unknown' }, company: { type: 'BUSINESS' } }, { kind: 'business' }],
  // A word the vocabulary does not know must not hide a known one; "other" is only for when nothing is known.
  [{ asn: { type: 'WEIRD' }, company: { type: 'ISP' } }, { kind: 'isp' }],
  [{ asn: { type: 'ISP' }, company: { type: 'WEIRD' } }, { kind: 'isp' }],
  [{ asn: { type: 'WEIRD' }, network: { connection_type: 'DSL' } }, { kind: 'isp' }],
  [{ asn: { type: 'WEIRD' }, network: { is_cdn: true } }, { kind: 'cdn' }],
  [{ company: { type: 'WEIRD' }, network: { connection_type: 'Mobile' } }, { kind: 'mobile' }],
  [{ asn: { type: 'WEIRD' }, company: { type: 'WEIRD' }, network: { connection_type: 'Wireless' } }, { kind: 'other' }],
  [{ asn: { type: 'WEIRD' }, company: { type: 'unknown' } }, { kind: 'other' }],
  [{ company: { type: 'ISP' }, network: { is_cdn: true, connection_type: 'DSL' } }, { kind: 'isp' }],
  [{ network: { is_cdn: true, connection_type: 'DSL' } }, { kind: 'cdn' }],
  [{ network: { is_cdn: false, connection_type: 'DSL' } }, { kind: 'isp' }],
  [{ network: { is_cdn: 'true' } }, {}],
  [{ network: { is_cdn: true } }, { kind: 'cdn' }],
  // connection_type values of the provider's OpenAPI file: DSL, Cable, Fiber, Mobile, Wireless, Dial-Up/ISDN, Satellite. "Wireless" and "5G" stay "other" ON PURPOSE:
  // fixed-wireless and mobile networks both exist under those words and the provider does not say which, so neither is called mobile or isp. "Dialup" (no hyphen) is not a documented value.
  ...[['Mobile', 'mobile'], ['Cellular', 'mobile'], ['DSL', 'isp'], ['Cable', 'isp'], ['Cable/DSL', 'isp'], ['Fiber', 'isp'], ['fiber', 'isp'], ['FIBER', 'isp'], ['Dial-Up/ISDN', 'isp'], ['dial-up/isdn', 'isp'], ['Satellite', 'isp'],
    ['Corporate', 'business'], ['Wireless', 'other'], ['wireless', 'other'], ['5G', 'other'], ['Dialup', 'other'], ['Dial-Up', 'other']]
    .map(([word, kind]) => [{ network: { connection_type: word } }, { kind }]),
  [{ network: { connection_type: '' } }, {}],
];
const IPGEOLOCATION_FLAGS = [
  ...[['proxy', 'is_proxy'], ['vpn', 'is_vpn'], ['tor', 'is_tor'], ['hosting', 'is_cloud_provider'], ['relay', 'is_relay'], ['residentialProxy', 'is_residential_proxy'], ['threat', 'is_known_attacker']].flatMap(([flag, key]) => [
    [{ security: { [key]: true } }, { flags: { [flag]: true } }],
    [{ security: { [key]: false } }, { flags: { [flag]: false } }],
    [{ security: { [key]: 'true' } }, {}],
    [{ security: { [key]: null } }, {}],
  ]),
  [{ security: {} }, {}],
  [{ security: { is_anonymous: true, is_bot: true, is_spam: true, threat_score: 99, is_corporate_gateway: true, is_known_good_bot: true } }, {}],
  [{ network: { is_cdn: true } }, { kind: 'cdn' }],
  [{ network: { connection_type: 'Mobile' } }, { kind: 'mobile' }],
];

const IPDATA_GEO = [
  [{ country_code: 'de' }, { country: 'DE' }],
  [{ country_name: 'Germany' }, { countryName: 'Germany' }],
  [{ region: 'Hesse' }, { region: 'Hesse' }],
  [{ city: 'Frankfurt' }, { city: 'Frankfurt' }],
  [{ region_code: 'HE', continent_code: 'EU', postal: '60311', latitude: 1, longitude: 2, calling_code: '49' }, {}],
  [{ time_zone: { name: 'Europe/Berlin' } }, { timezone: 'Europe/Berlin' }],
  [{ asn: { asn: 'AS15169' } }, { asn: 15169 }],
  [{ asn: { asn: 15169 } }, { asn: 15169 }],
  [{ asn: { asn: 'AS15169 Google LLC' } }, { asn: 15169 }],
  [{ asn: { asn: 'nonsense' } }, {}],
  [{ asn: { name: 'Google LLC' } }, { org: 'Google LLC' }],
  [{ company: { name: 'Apple Inc.' } }, { isp: 'Apple Inc.' }],
  [{ city: null, region: null, country_name: null }, {}],
];
const IPDATA_KIND = [
  ...[['isp', 'isp'], ['ISP', 'isp'], ['hosting', 'hosting'], ['Hosting', 'hosting'], ['business', 'business'], ['cdn', 'cdn'], ['edu', 'education'], ['gov', 'government'], ['mil', 'government'], ['education', 'education'],
    ['government', 'government'], ['unknown', ''], ['constructor', 'other'], ['weird', 'other']].flatMap(([word, kind]) => [
    [{ asn: { type: word } }, kind === '' ? {} : { kind }],
    [{ company: { type: word } }, kind === '' ? {} : { kind }],
  ]),
  [{ asn: { type: 'hosting' }, company: { type: 'business' } }, { kind: 'hosting' }],
  [{ asn: { type: 'unknown' }, company: { type: 'edu' } }, { kind: 'education' }],
  [{ asn: { type: 'unknown' }, company: { type: 'unknown' } }, {}],
  [{ asn: { type: 'isp' }, carrier: { name: 'Verizon' } }, { kind: 'isp', flags: { mobile: true } }],
  [{ carrier: { name: 'Verizon', mcc: '310', mnc: '004' } }, { kind: 'mobile', flags: { mobile: true } }],
  [{ asn: { type: 'unknown' }, carrier: { name: 'Verizon' } }, { kind: 'mobile', flags: { mobile: true } }],
  [{ company: { type: 'business' }, carrier: { name: 'Verizon' } }, { kind: 'business', flags: { mobile: true } }],
  // A word the vocabulary does not know must not hide a known one; "other" is only for when nothing is known.
  [{ asn: { type: 'weird' }, company: { type: 'edu' } }, { kind: 'education' }],
  [{ asn: { type: 'isp' }, company: { type: 'weird' } }, { kind: 'isp' }],
  [{ asn: { type: 'weird' }, carrier: { name: 'Verizon' } }, { kind: 'mobile', flags: { mobile: true } }],
  [{ asn: { type: 'weird' }, company: { type: 'weird' } }, { kind: 'other' }],
  [{ asn: { type: 'weird' }, company: { type: 'unknown' } }, { kind: 'other' }],
  ...[{ carrier: { mcc: '310' } }, { carrier: { name: '' } }, { carrier: { name: 5 } }, { carrier: [] }, { carrier: 'Verizon' }, { carrier: null }, { carrier: [{ name: 'Verizon' }] }].map(patch => [patch, {}]),
];
const IPDATA_FLAGS = [
  ...[['proxy', 'is_proxy'], ['vpn', 'is_vpn'], ['tor', 'is_tor'], ['hosting', 'is_datacenter'], ['relay', 'is_icloud_relay']].flatMap(([flag, key]) => [
    [{ threat: { [key]: true } }, { flags: { [flag]: true } }],
    [{ threat: { [key]: false } }, { flags: { [flag]: false } }],
    [{ threat: { [key]: 'true' } }, {}],
    [{ threat: { [key]: 0 } }, {}],
    [{ threat: { [key]: null } }, {}],
  ]),
  [{ threat: { is_known_attacker: true } }, { flags: { threat: true } }],
  [{ threat: { is_known_abuser: true } }, { flags: { threat: true } }],
  [{ threat: { is_threat: true } }, { flags: { threat: true } }],
  [{ threat: { is_known_attacker: false, is_known_abuser: false, is_threat: false } }, { flags: { threat: false } }],
  [{ threat: { is_threat: false } }, { flags: { threat: false } }],
  [{ threat: { is_known_attacker: false } }, { flags: { threat: false } }],
  [{ threat: { is_known_attacker: false, is_known_abuser: true } }, { flags: { threat: true } }],
  [{ threat: { is_known_attacker: 'true', is_known_abuser: null } }, {}],
  [{ threat: { is_anonymous: true, is_bogon: true, blocklists: [{ name: 'x' }], scores: { vpn_score: 99 } } }, {}],
  [{ threat: {} }, {}],
];

const IPAPI_GEO = [
  [{ countryCode: 'de' }, { country: 'DE' }],
  [{ country: 'Germany' }, { countryName: 'Germany' }],
  [{ regionName: 'Hesse' }, { region: 'Hesse' }],
  [{ regionName: 'Hesse', region: 'HE' }, { region: 'Hesse' }],
  [{ region: 'HE' }, { region: 'HE' }],
  [{ regionName: '', region: 'HE' }, { region: 'HE' }],
  [{ city: 'Frankfurt am Main' }, { city: 'Frankfurt am Main' }],
  [{ timezone: 'Europe/Berlin' }, { timezone: 'Europe/Berlin' }],
  [{ continent: 'Europe', continentCode: 'EU', district: 'X', zip: '1', lat: 1, lon: 2, offset: 3600, currency: 'EUR', reverse: 'x.example' }, {}],
  [{ as: 'AS15169 Google LLC' }, { asn: 15169, org: 'Google LLC' }],
  [{ as: 'AS15169 Google LLC', asname: 'GOOGLE' }, { asn: 15169, org: 'Google LLC' }],
  [{ as: 'AS15169', asname: 'GOOGLE' }, { asn: 15169, org: 'GOOGLE' }],
  [{ as: '', asname: 'GOOGLE' }, { org: 'GOOGLE' }],
  [{ as: 'Google LLC', asname: 'GOOGLE' }, { org: 'GOOGLE' }],
  [{ asname: 'GOOGLE' }, { org: 'GOOGLE' }],
  [{ as: 'AS15169   Google    LLC' }, { asn: 15169, org: 'Google LLC' }],
  [{ as: 'AS0 Nothing' }, {}],
  [{ as: 'AS15169' }, { asn: 15169 }],
  [{ isp: 'Google LLC' }, { isp: 'Google LLC' }],
  [{ org: 'Google Public DNS' }, { isp: 'Google Public DNS' }],
  [{ isp: 'A', org: 'B' }, { isp: 'A' }],
  [{ isp: '', org: 'B' }, { isp: 'B' }],
];
const IPAPI_FLAGS = [
  [{ hosting: true }, { kind: 'hosting', flags: { hosting: true } }],
  [{ hosting: false }, { flags: { hosting: false } }],
  [{ mobile: true }, { kind: 'mobile', flags: { mobile: true } }],
  [{ mobile: false }, { flags: { mobile: false } }],
  [{ hosting: true, mobile: true }, { kind: 'hosting', flags: { hosting: true, mobile: true } }],
  [{ hosting: false, mobile: true }, { kind: 'mobile', flags: { hosting: false, mobile: true } }],
  [{ proxy: true }, { flags: { proxy: true } }],
  [{ proxy: false }, { flags: { proxy: false } }],
  ...[{ proxy: 'true' }, { proxy: 1 }, { hosting: 'yes' }, { mobile: null }, { proxy: [] }, { hosting: {} }].map(patch => [patch, {}]),
  [{ vpn: true, tor: true, relay: true, residentialProxy: true, threat: true }, {}],
];

// A group is a list of cells, or { options, cells } when it must run under another service of the provider. The MaxMind default is GeoIP City (no anonymizer data of its own).
const insights = { service: 'geoip-insights' }, geolite = { service: 'geolite-city' };
const CELLS = [
  ['maxmind', { traits: { ip_address: IPV4 }, country: { iso_code: 'US' } }, { service: 'geoip-city' }, {
    geo: MAXMIND_GEO, kind: MAXMIND_KIND,
    'flags, anonymizer object (City)': MAXMIND_FLAGS_OBJECT, 'flags, anonymizer object (Insights)': { options: insights, cells: MAXMIND_FLAGS_OBJECT }, 'flags, anonymizer object (GeoLite)': { options: geolite, cells: MAXMIND_FLAGS_OBJECT },
    'flags, no anonymizer object (City)': maxmindFlagsWithoutObject(null), 'flags, no anonymizer object (GeoLite)': { options: geolite, cells: maxmindFlagsWithoutObject(null) },
    'flags, no anonymizer object (Insights: nothing flagged means false)': { options: insights, cells: maxmindFlagsWithoutObject(false) },
  }],
  ['ipgeolocation', { ip: IPV4, location: { country_code2: 'US' } }, {}, { geo: IPGEOLOCATION_GEO, kind: IPGEOLOCATION_KIND, flags: IPGEOLOCATION_FLAGS }],
  ['ipdata', { ip: IPV4, country_code: 'US' }, {}, { geo: IPDATA_GEO, kind: IPDATA_KIND, flags: IPDATA_FLAGS }],
  ['ipapi', { status: 'success', query: IPV4, countryCode: 'US' }, {}, { geo: IPAPI_GEO, flags: IPAPI_FLAGS }],
];
for (const [provider, base, options, groups] of CELLS) for (const [group, entry] of Object.entries(groups)) {
  const cells = Array.isArray(entry) ? entry : entry.cells, groupOptions = Array.isArray(entry) ? options : { ...options, ...entry.options };
  test('cells ' + provider + ': ' + group + ' (' + cells.length + ' cells)', () => {
    for (const [patch, expected] of cells) {
      const body = merge(base, patch);
      assert.deepEqual(answer(provider, body, groupOptions), win(rec(provider, IPV4, { service: groupOptions.service ?? '', country: 'US', ...expected })), 'cell ' + JSON.stringify(patch));
    }
  });
}

test('cells: a source field the table does not name never changes the record (coordinates, postal codes, currencies, names of other languages)', () => {
  const extra = { latitude: 1.5, longitude: 2.5, lat: 1.5, lon: 2.5, postal: { code: '90001' }, zip: '90001', currency: { code: 'USD' }, languages: [{ name: 'x' }], flag: 'https://example.invalid/f.png', hostname: 'x.example', reverse: 'x.example' };
  for (const [provider, base, options] of CELLS) {
    const plain = answer(provider, base, options), withExtra = answer(provider, { ...base, ...extra }, options);
    assert.deepEqual(withExtra, plain, provider);
    assert.equal(JSON.stringify(withExtra).includes('90001') || JSON.stringify(withExtra).includes('1.5'), false, 'no coordinate or postal code in the record');
  }
});

// ---- D1, one test per rule with its positive and its negative side. `five` is the five flags the anonymizer decides (proxy, vpn, tor, hosting, residentialProxy).
const maxmindFlagsOf = (extra, service = 'geoip-insights') => answer('maxmind', merge({ traits: { ip_address: IPV4 }, country: { iso_code: 'US' } }, extra), { service }).record.flags;
const five = flags => ({ proxy: flags.proxy, vpn: flags.vpn, tor: flags.tor, hosting: flags.hosting, residentialProxy: flags.residentialProxy });
const fiveWith = (rest, shown = {}) => ({ proxy: rest, vpn: rest, tor: rest, hosting: rest, residentialProxy: rest, ...shown });

test('maxmind flags (a): the residential sub-object is a residential-proxy signal by itself (audit probe M04), a lookalike is not', () => {
  assert.deepEqual(five(maxmindFlagsOf({ anonymizer: { residential: { confidence: 82 } } })), fiveWith(false, { residentialProxy: true }));
  assert.deepEqual(five(maxmindFlagsOf({ anonymizer: { residential: { confidence: 82 } } }, 'geoip-city')), fiveWith(false, { residentialProxy: true }), 'whatever the service: the object is there');
  assert.deepEqual(five(maxmindFlagsOf({ anonymizer: { residential: { confidence: 82 }, is_residential_proxy: false } })), fiveWith(false, { residentialProxy: true }), 'the sub-object outranks a false key');
  assert.deepEqual(five(maxmindFlagsOf({ anonymizer: { is_residential_proxy: true } })), fiveWith(false, { residentialProxy: true }), 'the explicit key still works without the sub-object');
  assert.equal(maxmindFlagsOf({ anonymizer: { is_hosting_provider: true } }).residentialProxy, false, 'no sub-object, no key: not residential');
  for (const lookalike of ['yes', 5, [], null, true]) assert.equal(maxmindFlagsOf({ anonymizer: { residential: lookalike } }).residentialProxy, false, 'residential is ' + JSON.stringify(lookalike));
  assert.equal(maxmindFlagsOf({ residential: { confidence: 82 } }).residentialProxy, false, 'a residential object outside the anonymizer object is not read');
  assert.equal(maxmindFlagsOf({ anonymizer: { is_anonymous: true, residential: { confidence: 80 } } }).residentialProxy, true);
});

test('maxmind flags (b): "anonymous in general" leaves the specific flags unknown; otherwise a key MaxMind omitted is false (audit probes M05, M06)', () => {
  assert.deepEqual(five(maxmindFlagsOf({ anonymizer: { is_anonymous: true, confidence: 30 } })), fiveWith(null), 'M05');
  assert.deepEqual(five(maxmindFlagsOf({ anonymizer: { is_anonymous: true, is_hosting_provider: true, provider_name: 'surfshark' } })), fiveWith(null, { hosting: true }), 'M06: hosting is given, vpn is NOT inferred from the provider name');
  assert.deepEqual(five(maxmindFlagsOf({ anonymizer: { provider_name: 'nordvpn' } })), fiveWith(null), 'a named provider is "general" too');
  assert.deepEqual(five(maxmindFlagsOf({ anonymizer: { is_anonymous: true, is_anonymous_vpn: false } })), fiveWith(null, { vpn: false }), 'a key that is there is taken as given, also a false');
  assert.deepEqual(five(maxmindFlagsOf({ anonymizer: { is_hosting_provider: true } })), fiveWith(false, { hosting: true }), 'negative: not general, the omitted keys are false');
  assert.deepEqual(five(maxmindFlagsOf({ anonymizer: {} })), fiveWith(false));
  assert.deepEqual(five(maxmindFlagsOf({ anonymizer: { is_anonymous: false, provider_name: '' } })), fiveWith(false), 'negative: a false is_anonymous and an empty name are not "general"');
  assert.deepEqual(five(maxmindFlagsOf({ anonymizer: { is_anonymous: 'true', provider_name: 5 } })), fiveWith(false), 'negative: only a boolean true and a text name count');
  assert.deepEqual(five(maxmindFlagsOf({ anonymizer: { residential: { provider_name: 'quickshift' } } })), fiveWith(false, { residentialProxy: true }), 'negative: a name inside the residential sub-object is not "general"');
  for (const service of ['geolite-city', 'geoip-city', 'geoip-insights']) assert.deepEqual(five(maxmindFlagsOf({ anonymizer: { is_anonymous: true } }, service)), fiveWith(null), 'the object decides, not the service: ' + service);
});

test('maxmind flags (c): with no anonymizer object, GeoIP Insights says false (empty values are left out) and the other services say unknown', () => {
  assert.deepEqual(five(maxmindFlagsOf({}, 'geoip-insights')), fiveWith(false));
  assert.deepEqual(five(maxmindFlagsOf({}, 'geoip-city')), fiveWith(null));
  assert.deepEqual(five(maxmindFlagsOf({}, 'geolite-city')), fiveWith(null));
  assert.deepEqual(five(answer('maxmind', { traits: { ip_address: IPV4 }, country: { iso_code: 'US' } }, {}).record.flags), fiveWith(null), 'no settings at all: the default service is GeoLite City');
  for (const value of ['yes', 5, [], null, true]) {
    assert.deepEqual(five(maxmindFlagsOf({ anonymizer: value }, 'geoip-insights')), fiveWith(null), 'negative: an anonymizer value of the wrong type is unknown, not "nothing flagged": ' + JSON.stringify(value));
  }
  assert.deepEqual(five(maxmindFlagsOf({ anonymizer: {} }, 'geoip-city')), fiveWith(false), 'negative: an (empty) object is there, so nothing was flagged, on any service');
  assert.equal(maxmindFlagsOf({}, 'geoip-insights').mobile, null, 'the mobile flag is not an anonymizer flag');
  // an Insights answer that carries nothing but traits still has something to say: nothing was flagged
  assert.equal(answer('maxmind', { traits: { ip_address: IPV4 } }, { service: 'geoip-insights' }).ok, true);
  assert.deepEqual(answer('maxmind', { traits: { ip_address: IPV4 } }, { service: 'geoip-city' }), lose('not-found'));
});

test('maxmind flags (d): the deprecated traits.is_* aliases are read too; a true from either source wins, a false counts when the other source is silent', () => {
  for (const [flag, key] of Object.entries(ANON_KEYS)) {
    assert.equal(maxmindFlagsOf({ anonymizer: { [key]: false }, traits: { [key]: true } })[flag], true, 'the alias is true, the object false: ' + flag);
    assert.equal(maxmindFlagsOf({ anonymizer: { [key]: true }, traits: { [key]: false } })[flag], true, 'negative: an alias false never overrides a true: ' + flag);
    assert.equal(maxmindFlagsOf({ anonymizer: { is_anonymous: true }, traits: { [key]: false } })[flag], false, 'the object is silent, the alias says false: ' + flag);
    assert.equal(maxmindFlagsOf({ anonymizer: { is_anonymous: true }, traits: { [key]: true } })[flag], true, 'the object is silent, the alias says true: ' + flag);
    assert.equal(maxmindFlagsOf({ traits: { [key]: true } }, 'geoip-city')[flag], true, 'no object: the alias alone: ' + flag);
    assert.equal(maxmindFlagsOf({ traits: { [key]: false } }, 'geoip-city')[flag], false, 'no object: a lone alias false is taken: ' + flag);
    assert.equal(maxmindFlagsOf({ anonymizer: {} })[flag], false, 'negative: no alias and no key: nobody states it, the default stands: ' + flag);
  }
  assert.deepEqual(five(maxmindFlagsOf({ traits: { is_public_proxy: true, is_tor_exit_node: false } }, 'geoip-city')), fiveWith(null, { proxy: true, tor: false }));
  assert.deepEqual(five(maxmindFlagsOf({ traits: { is_public_proxy: true, is_tor_exit_node: false } }, 'geoip-insights')), fiveWith(false, { proxy: true }), 'on Insights the flags nobody states are false');
  assert.equal(maxmindFlagsOf({ traits: { is_anonymous: true } }, 'geoip-city').proxy, null, 'is_anonymous is not one of the five');
});

test('kind (D5): a word the vocabulary does not know never hides a known one; "other" only when nothing at all is known (MaxMind, ipgeolocation.io, ipdata)', () => {
  const kind = (provider, patch) => answer(provider, merge(BASES[provider].base, patch), BASES[provider].options).record.kind;
  assert.equal(kind('maxmind', { traits: { user_type: 'traveler', connection_type: 'Cable/DSL' } }), 'isp', 'the documented Insights sample');
  assert.equal(kind('maxmind', { traits: { user_type: 'consumer_privacy_network', connection_type: 'Corporate' } }), 'business');
  assert.equal(kind('maxmind', { traits: { user_type: 'business', connection_type: 'Cable/DSL' } }), 'business', 'both known: the first source wins');
  assert.equal(kind('maxmind', { traits: { user_type: 'traveler', connection_type: 'Dialup' } }), 'other', 'nothing known');
  assert.equal(kind('maxmind', { traits: { user_type: 'traveler' } }), 'other');
  assert.equal(kind('maxmind', { traits: { connection_type: 'Dialup' } }), 'other');
  assert.equal(kind('maxmind', { traits: { user_type: '', connection_type: '' } }), '', 'nothing said stays empty');
  assert.equal(kind('ipgeolocation', { asn: { type: 'WEIRD' }, company: { type: 'ISP' } }), 'isp');
  assert.equal(kind('ipgeolocation', { asn: { type: 'WEIRD' }, network: { is_cdn: true } }), 'cdn');
  assert.equal(kind('ipgeolocation', { asn: { type: 'WEIRD' }, network: { connection_type: 'Fiber' } }), 'isp');
  assert.equal(kind('ipgeolocation', { asn: { type: 'HOSTING' }, company: { type: 'ISP' } }), 'hosting', 'both known: the first source wins');
  assert.equal(kind('ipgeolocation', { asn: { type: 'WEIRD' }, company: { type: 'WEIRD' } }), 'other');
  assert.equal(kind('ipgeolocation', { asn: { type: 'WEIRD' }, company: { type: 'unknown' } }), 'other', '"unknown" is the provider declining, the weird word is still a word');
  assert.equal(kind('ipgeolocation', { asn: { type: 'unknown' } }), '');
  assert.equal(kind('ipdata', { asn: { type: 'weird' }, company: { type: 'edu' } }), 'education');
  assert.equal(kind('ipdata', { asn: { type: 'weird' }, carrier: { name: 'Verizon' } }), 'mobile');
  assert.equal(kind('ipdata', { asn: { type: 'isp' }, carrier: { name: 'Verizon' } }), 'isp', 'both known: the first source wins');
  assert.equal(kind('ipdata', { asn: { type: 'weird' } }), 'other');
  assert.equal(kind('ipdata', { asn: { type: 'unknown' } }), '');
});

test('cells maxmind: queries_remaining is the quota, a count of zero or more and nothing else', () => {
  const body = remaining => merge({ traits: { ip_address: IPV4 }, country: { iso_code: 'US' } }, { maxmind: { queries_remaining: remaining } });
  for (const [remaining, expected] of [[54321, quota(54321)], [0, quota(0)], [1, quota(1)], [-1, null], [1.5, null], ['5', null], [null, null], [{}, null], [[], null], [true, null], [Number.MAX_SAFE_INTEGER, quota(Number.MAX_SAFE_INTEGER)]]) {
    assert.deepEqual(answer('maxmind', JSON.stringify(body(remaining)), { service: 'geoip-city' }).quota, expected, JSON.stringify(remaining));
  }
  assert.equal(answer('maxmind', { traits: { ip_address: IPV4 }, country: { iso_code: 'US' } }, { service: 'geoip-city' }).quota, null, 'GeoLite has no maxmind object');
  assert.equal(answer('maxmind', { traits: { ip_address: IPV4 }, country: { iso_code: 'US' }, maxmind: [] }, { service: 'geoip-city' }).quota, null);
  for (const provider of ['ipgeolocation', 'ipdata']) assert.equal(answer(provider, CELLS.find(cell => cell[0] === provider)[1]).quota, null, provider + ' reports no remaining count in the body');
});

test('cells: the service of a MaxMind record is the configured one; every other provider has an empty service', () => {
  for (const service of ['geolite-city', 'geoip-city', 'geoip-insights']) {
    assert.equal(answer('maxmind', { traits: { ip_address: IPV4 }, country: { iso_code: 'US' } }, { service }).record.service, service);
  }
  assert.equal(geoParseResponse('maxmind', { status: 200, headers: JSON_HEADERS, text: '{"country":{"iso_code":"US"}}' }, { ip: IPV4, now: NOW }).record.service, 'geolite-city', 'no settings: the default service');
  for (const [provider, base] of CELLS.slice(1)) assert.equal(answer(provider, base).record.service, '', provider);
});

// How one source field is written into a body of each provider (used by the generic field tests below).
const FIELD_BODIES = {
  maxmind: { countryName: v => ({ country: { names: { en: v } } }), region: v => ({ subdivisions: [{ names: { en: v } }] }), city: v => ({ city: { names: { en: v } } }), org: v => ({ traits: { autonomous_system_organization: v } }),
    isp: v => ({ traits: { isp: v } }), country: v => ({ country: { iso_code: v } }), timezone: v => ({ location: { time_zone: v } }) },
  ipgeolocation: { countryName: v => ({ location: { country_name: v } }), region: v => ({ location: { state_prov: v } }), city: v => ({ location: { city: v } }), org: v => ({ asn: { organization: v } }),
    isp: v => ({ company: { name: v } }), country: v => ({ location: { country_code2: v } }), timezone: v => ({ time_zone: { name: v } }) },
  ipdata: { countryName: v => ({ country_name: v }), region: v => ({ region: v }), city: v => ({ city: v }), org: v => ({ asn: { name: v } }), isp: v => ({ company: { name: v } }),
    country: v => ({ country_code: v }), timezone: v => ({ time_zone: { name: v } }) },
  ipapi: { countryName: v => ({ country: v }), region: v => ({ regionName: v }), city: v => ({ city: v }), org: v => ({ as: 'AS15169 ' + v }), isp: v => ({ isp: v }), country: v => ({ countryCode: v }), timezone: v => ({ timezone: v }) },
};
/** The record field a provider answer yields when only that one source field carries `value` (the base keeps a country so the record exists). */
function fieldResult(provider, field, value) {
  const [, base, options] = CELLS.find(cell => cell[0] === provider);
  const carrier = field === 'country' ? { maxmind: { city: { names: { en: 'X' } } }, ipgeolocation: { location: { city: 'X' } }, ipdata: { city: 'X' }, ipapi: { city: 'X' } }[provider] : {};
  const result = answer(provider, merge(merge(base, carrier), FIELD_BODIES[provider][field](value)), options);
  assert.equal(result.ok, true, provider + ' ' + field + ' ' + JSON.stringify(value).slice(0, 40));
  return result.record[field];
}

test('text: every text field of every provider is cleaned (forbidden characters become spaces, spaces collapse) and cut to 80 code points', () => {
  const dirty = 'A' + cp(0x202e, 0x200b, 0x200f, 0x2066, 0xfeff, 7, 0x2028, 0x85) + '  B\t\nC';
  for (const provider of GEO_PROVIDERS) for (const field of ['countryName', 'region', 'city', 'org', 'isp']) {
    assert.equal(fieldResult(provider, field, dirty), 'A B C', provider + ' ' + field);
    assert.equal(fieldResult(provider, field, 'x'.repeat(500)), 'x'.repeat(80), provider + ' ' + field);
    assert.equal(fieldResult(provider, field, cp(0x1f600).repeat(200)), cp(0x1f600).repeat(80), provider + ' ' + field + ' counted in code points');
    assert.equal(fieldResult(provider, field, '<img src=x onerror=alert(1)>'), '<img src=x onerror=alert(1)>', 'kept as text; the UI renders text nodes only');
    assert.equal(geoHasForbiddenText(fieldResult(provider, field, dirty)), false);
  }
});

test('text: a country code is two ASCII letters, upper-cased; look-alikes and case-mapping tricks give an empty country', () => {
  const codes = [['us', 'US'], ['Us', 'US'], ['US', 'US'], ['de', 'DE'], ['', ''], ['u', ''], ['usa', ''], [' us', ''], ['us ', ''], ['U S', ''], ['U' + cp(0x200b) + 'S', ''], [cp(0x17f) + 's', ''], [cp(0x131) + 'i', ''], [cp(0xdf) + 'a', ''],
    [cp(0xff35, 0xff33), ''], ['1a', ''], ['a1', ''], ['--', ''], [cp(0x55, 0x301), ''], [5, ''], [null, ''], [['US'], ''], [{ a: 1 }, '']];
  for (const provider of GEO_PROVIDERS) for (const [code, expected] of codes) assert.equal(fieldResult(provider, 'country', code), expected, provider + ' ' + JSON.stringify(code));
});

test('text: a time zone is an IANA-looking name of at most 64 characters, anything else is empty', () => {
  const zones = [['Europe/Paris', 'Europe/Paris'], ['UTC', 'UTC'], ['Etc/GMT+5', 'Etc/GMT+5'], ['America/Argentina/Buenos_Aires', 'America/Argentina/Buenos_Aires'], ['America/Port-au-Prince', 'America/Port-au-Prince'],
    ['A'.repeat(64), 'A'.repeat(64)], ['', ''], ['Europe/Par is', ''], ['Europe/Paris' + cp(0x202e), ''], ['Europe/Pari' + cp(0xe9) + 's', ''], ['A'.repeat(65), ''], ['A'.repeat(50000), ''], ['Europe/Paris;rm', ''], ['../etc/passwd', ''],
    [5, ''], [null, ''], [['UTC'], ''], [{ name: 'UTC' }, '']];
  for (const provider of GEO_PROVIDERS) for (const [zone, expected] of zones) assert.equal(fieldResult(provider, 'timezone', zone), expected, provider + ' ' + JSON.stringify(zone).slice(0, 40));
});

// ======================================================================================================================================
// Rules that hold for every provider
// ======================================================================================================================================
const ECHO = {
  maxmind: echo => ({ traits: { ip_address: echo }, country: { iso_code: 'US' } }),
  ipgeolocation: echo => ({ ip: echo, location: { country_code2: 'US' } }),
  ipdata: echo => ({ ip: echo, country_code: 'US' }),
  ipapi: echo => ({ status: 'success', query: echo, countryCode: 'US' }),
};
const BASES = Object.fromEntries(CELLS.map(([provider, base, options]) => [provider, { base, options }]));
const ok = (provider, body, options = {}) => answer(provider, body, { ...BASES[provider].options, ...options });

test('rule: an answer about another address is never filed under the requested one (bad-response, no record)', () => {
  const v4 = { accept: ['8.8.8.8', '::ffff:8.8.8.8', '::FFFF:808:808', undefined, '', 5, true, {}, [], null, ['8.8.8.8'], 0],
    reject: ['8.8.4.4', '8.8.8.9', 'not an ip', ' 8.8.8.8', '8.8.8.8 ', '8.8.8.8/32', '8.8.8.8:80', '2001:4860:4860::8888', '10.0.0.1', '8.8.8.8\n', '08.8.8.8', 'localhost', 'x'.repeat(2000)] };
  const v6 = { accept: ['2001:4860:4860::8888', '2001:4860:4860:0:0:0:0:8888', '2001:4860:4860:0000:0000:0000:0000:8888', '2001:4860:4860::8888'.toUpperCase()],
    reject: ['2001:4860:4860::8889', '8.8.8.8', '2001:4860:4860::8888%eth0', '[2001:4860:4860::8888]', '2001:4860:4860::8888/64', '2001:4860:4860::'] };
  for (const provider of GEO_PROVIDERS) for (const [ip, cases] of [[IPV4, v4], [IPV6, v6]]) {
    for (const echo of cases.accept) {
      const result = answer(provider, JSON.stringify(ECHO[provider](echo)), { ip, service: 'geoip-city' });
      assert.equal(result.ok, true, provider + ' accepts echo ' + JSON.stringify(echo));
      assert.equal(result.record.ip, ip, 'the record carries the requested canonical address');
    }
    for (const echo of cases.reject) {
      const result = answer(provider, JSON.stringify(ECHO[provider](echo)), { ip, service: 'geoip-city' });
      assert.equal(result.ok, false, provider + ' rejects echo ' + JSON.stringify(echo).slice(0, 30));
      assert.equal(result.error, 'bad-response');
      assert.equal(Object.hasOwn(result, 'record'), false);
    }
  }
});

test('rule: a body without any data is not-found (and flags the provider did report count as data)', () => {
  const empty = {
    maxmind: [{ traits: { ip_address: IPV4 } }, { traits: {} }, { traits: { ip_address: IPV4 }, maxmind: { queries_remaining: 5 } }, { country: {} }, { country: { names: {} } }, { city: {}, location: {}, subdivisions: [] }, { traits: { ip_address: IPV4 }, anonymizer: null }],
    ipgeolocation: [{ ip: IPV4 }, { location: {} }, { asn: {} }, { ip: IPV4, security: {} }, { company: { name: '' } }, { network: { is_cdn: false } }],
    ipdata: [{ ip: IPV4 }, { asn: {} }, { threat: {} }, { ip: IPV4, city: '', region: '' }, { carrier: {} }],
    ipapi: [{ status: 'success' }, { status: 'success', query: IPV4 }, { status: 'success', country: '', city: '', as: '', asname: '' }],
  };
  for (const provider of GEO_PROVIDERS) for (const body of empty[provider]) {
    const result = ok(provider, body);
    assert.equal(result.ok, false, provider + ' ' + JSON.stringify(body)); assert.equal(result.error, 'not-found'); assert.equal(result.retryAfterMs, null);
  }
  assert.equal(ok('maxmind', { traits: { ip_address: IPV4 }, anonymizer: {} }).record.flags.tor, false, 'an empty anonymizer object says "not anonymous": data');
  assert.equal(ok('ipgeolocation', { ip: IPV4, security: { is_tor: false } }).record.flags.tor, false);
  assert.equal(ok('ipdata', { ip: IPV4, threat: { is_tor: false } }).record.flags.tor, false);
  assert.equal(ok('ipapi', { status: 'success', proxy: false }).record.flags.proxy, false);
});

// Direct calls: the `answer` helper fills a default for an undefined ip, clock, status or headers, which is exactly what these cases must not get.
const settingsOf = provider => settingsWith(BASES[provider].options.service ? { providers: { maxmind: { service: BASES[provider].options.service } } } : {});
const direct = (provider, response, context) => geoParseResponse(provider, response, { ip: IPV4, now: NOW, settings: settingsOf(provider), ...context });
const goodResponse = provider => ({ status: 200, headers: JSON_HEADERS, text: JSON.stringify(BASES[provider].base) });

test('rule: the requested address is checked again; a private, non-canonical or missing one gives not-public whatever the body says', () => {
  for (const provider of GEO_PROVIDERS) for (const ip of [undefined, null, '', ' ', '10.0.0.1', '127.0.0.1', '8.8.8.8 ', ' 8.8.8.8', '::ffff:8.8.8.8', '2001:4860:4860:0:0:0:0:8888', 'example.com', 5, {}, ['8.8.8.8'], '8.8.8.8/32', '2001:db8::1']) {
    assert.deepEqual(direct(provider, { status: 200, headers: JSON_HEADERS, text: JSON.stringify(ECHO[provider](IPV4)) }, { ip }), lose('not-public'), provider + ' ' + JSON.stringify(ip));
  }
  assert.deepEqual(geoParseResponse('ipdata', { status: 200, headers: JSON_HEADERS, text: '{"ip":"8.8.8.8","city":"X"}' }, {}), lose('not-public'));
  assert.deepEqual(geoParseResponse('ipdata', { status: 200, headers: JSON_HEADERS, text: '{"ip":"8.8.8.8","city":"X"}' }), lose('not-public'));
});

test('rule: an unknown provider, an invalid clock or an invalid status never throws and gives a plain error', () => {
  for (const provider of ['', 'nope', 'MAXMIND', null, undefined, 5, {}, '__proto__', 'constructor']) {
    assert.deepEqual(geoParseResponse(provider, goodResponse('ipdata'), { ip: IPV4, now: NOW }), lose('no-provider'), JSON.stringify(provider));
  }
  for (const now of [undefined, null, String(NOW), NaN, -1, 1.5, Infinity, {}, [], true]) {
    for (const provider of GEO_PROVIDERS) assert.deepEqual(direct(provider, goodResponse(provider), { now }), lose('bad-response'), provider + ' now ' + String(now));
  }
  assert.equal(direct('ipdata', goodResponse('ipdata'), { now: 0 }).record.at, 0, 'a zero clock is a valid time');
  assert.equal(direct('ipdata', goodResponse('ipdata')).record.at, NOW);
  for (const status of [undefined, null, '200', 200.5, NaN, 99, 600, -1, Infinity, {}, [200], true, 0]) {
    for (const provider of GEO_PROVIDERS) assert.deepEqual(direct(provider, { ...goodResponse(provider), status }), lose('bad-response'), provider + ' status ' + String(status));
  }
  for (const response of [undefined, null, 'text', 5, [], {}]) assert.deepEqual(geoParseResponse('ipdata', response, { ip: IPV4, now: NOW }), lose('bad-response'), JSON.stringify(response));
  for (const context of [undefined, null, 'x', 5, []]) assert.deepEqual(geoParseResponse('ipdata', goodResponse('ipdata'), context), lose('not-public'));
  assert.deepEqual(geoParseResponse('ipdata', { status: 200, text: JSON.stringify(BASES.ipdata.base) }, { ip: IPV4, now: NOW }).ok, true, 'a response without a headers key is read');
  assert.deepEqual(geoParseResponse('ipdata', { status: 200, headers: JSON_HEADERS }, { ip: IPV4, now: NOW }), lose('bad-response'), 'a response without a body');
  for (const text of [undefined, null, 5, {}, ['{}']]) assert.deepEqual(geoParseResponse('ipdata', { status: 200, headers: JSON_HEADERS, text }, { ip: IPV4, now: NOW }), lose('bad-response'), 'a body that is not a string');
});

test('rule: every 2xx status is an answer, every other class is not; an empty 204 has nothing to read', () => {
  for (const provider of GEO_PROVIDERS) {
    for (const status of [200, 201, 203, 206, 299]) assert.equal(ok(provider, BASES[provider].base, { status }).ok, true, provider + ' ' + status);
    for (const status of [100, 101, 199, 300, 301, 302, 304, 399]) assert.deepEqual(ok(provider, BASES[provider].base, { status }), lose('bad-response'), provider + ' ' + status);
    assert.deepEqual(ok(provider, '', { status: 204 }), lose('bad-response'));
  }
});

test('rule: a success must be JSON; an error body is decoded only when its type is JSON or missing', () => {
  for (const provider of GEO_PROVIDERS) {
    const base = BASES[provider].base;
    for (const type of ['text/html', 'text/plain', 'application/xml', 'image/png', 'text/html; charset=utf-8']) assert.deepEqual(ok(provider, base, { headers: { 'content-type': type } }), lose('bad-response'), provider + ' ' + type);
    for (const headers of [{ 'content-type': 'application/json; charset=utf-8' }, { 'content-type': 'APPLICATION/JSON' }, { 'content-type': 'application/vnd.maxmind.com-city+json; charset=UTF-8; version=2.1' }, {}, undefined, null, [], 'x', { 'content-type': ['application/json'] }]) {
      assert.equal(ok(provider, base, { headers }).ok, true, provider + ' ' + JSON.stringify(headers));
    }
  }
  const maxmind = headers => answer('maxmind', '{"code":"AUTHORIZATION_INVALID","error":"x"}', { status: 400, headers });
  assert.equal(maxmind({ 'content-type': 'application/vnd.maxmind.com-error+json; charset=UTF-8; version=2.1' }).error, 'unauthorized');
  assert.equal(maxmind({}).error, 'unauthorized', 'no type: decoded');
  assert.equal(maxmind({ 'content-type': 'text/html' }).error, 'not-public', 'an HTML page is not decoded: the status decides');
  const ipdata = headers => answer('ipdata', '{"message":"You have exceeded your free quota."}', { status: 403, headers });
  assert.equal(ipdata(JSON_HEADERS).error, 'quota'); assert.equal(ipdata({ 'content-type': 'text/plain' }).error, 'forbidden');
  const ipapi = headers => answer('ipapi', '{"status":"fail","message":"invalid/expired key"}', { status: 403, headers });
  assert.equal(ipapi(JSON_HEADERS).error, 'unauthorized'); assert.equal(ipapi({ 'content-type': 'text/plain' }).error, 'forbidden');
});

test('rule: the size limit is a precondition: at the limit an answer is read, one character more is not read at all', () => {
  for (const provider of GEO_PROVIDERS) {
    const { base, options } = BASES[provider], json = JSON.stringify(base);
    const exact = json + ' '.repeat(GEO_LIMITS.responseBytes - json.length), over = exact + ' ';
    assert.equal(exact.length, GEO_LIMITS.responseBytes);
    assert.equal(answer(provider, exact, options).ok, true, provider);
    assert.deepEqual(answer(provider, over, options), lose('bad-response'), provider);
  }
  const huge = '{"code":"IP_ADDRESS_NOT_FOUND","error":"' + 'x'.repeat(GEO_LIMITS.responseBytes) + '"}';
  assert.equal(answer('maxmind', huge, { status: 401 }).error, 'unauthorized', 'an oversized error body is not decoded: the status decides');
});

test('rule: results are frozen and fresh; the record is a new object every time; the key is not an input and never appears', () => {
  for (const provider of GEO_PROVIDERS) {
    const { base, options } = BASES[provider];
    const first = answer(provider, base, options), second = answer(provider, base, options);
    assert.deepEqual(first, second);
    assert.ok(Object.isFrozen(first)); assert.notEqual(first, second); assert.notEqual(first.record, second.record); assert.notEqual(first.record.flags, second.record.flags);
    first.record.city = 'changed'; first.record.flags.proxy = true;
    assert.equal(answer(provider, base, options).record.city, ''); assert.equal(answer(provider, base, options).record.flags.proxy, null, 'mutating one record never reaches the next');
    const failure = answer(provider, '[]', options);
    assert.ok(Object.isFrozen(failure)); assert.notEqual(failure, answer(provider, '[]', options));
  }
  const withQuota = answer('maxmind', { traits: { ip_address: IPV4 }, country: { iso_code: 'US' }, maxmind: { queries_remaining: 5 } }, { service: 'geoip-city' });
  assert.ok(Object.isFrozen(withQuota.quota));
  const SECRET = 'SeCrEtZq9Xw7Vb';
  const settings = settingsWith({});
  const result = geoParseResponse('ipdata', { status: 200, headers: JSON_HEADERS, text: JSON.stringify(ECHO.ipdata(IPV4)) }, { ip: IPV4, now: NOW, settings, credential: { apiKey: SECRET }, key: SECRET });
  assert.equal(JSON.stringify(result).includes(SECRET), false);
  assert.equal(geoParseResponse.length, 3);
});

test('rule: inherited properties are invisible: a polluted Object.prototype changes nothing', () => {
  const bodies = [['maxmind', { traits: { ip_address: IPV4 }, country: { iso_code: 'US' } }], ['ipgeolocation', { ip: IPV4, location: { country_code2: 'US' } }], ['ipdata', { ip: IPV4, country_code: 'US' }], ['ipapi', { status: 'success', query: IPV4, countryCode: 'US' }]];
  const objects = ['names', 'anonymizer', 'security', 'threat', 'carrier', 'asn', 'company', 'network', 'location', 'time_zone', 'maxmind', 'country', 'city', 'traits'];
  const texts = ['en', 'user_type', 'connection_type', 'is_public_proxy', 'is_tor_exit_node', 'is_tor', 'name', 'type', 'as', 'asname', 'isp', 'org', 'region', 'regionName', 'country_name', 'state_prov', 'queries_remaining', 'is_cdn', 'timezone',
    'autonomous_system_number', 'autonomous_system_organization', 'organization', 'message', 'code', 'ip_address', 'iso_code', 'country_code', 'country_code2', 'proxy', 'hosting', 'mobile', 'as_number', 'is_proxy', 'is_vpn', 'is_datacenter'];
  const polluted = Object.fromEntries([...objects.map(name => [name, { en: 'Polluted', name: 'Polluted', is_tor: true, iso_code: 'ZZ', time_zone: 'Polluted/Zone', queries_remaining: 3 }]), ...texts.map(name => [name, 'Polluted']),
    ['subdivisions', [{ names: { en: 'Polluted' } }]], ['0', { names: { en: 'Polluted' } }], ['status', 'success']]);
  // Everything the module is handed is built before the window opens; inside it only the module under test runs.
  const calls = [...bodies, ['ipapi', { query: IPV4, countryCode: 'US' }], ['maxmind', { traits: {} }], ['ipdata', {}]]
    .map(([provider, body]) => [provider, { status: 200, headers: JSON_HEADERS, text: JSON.stringify(body) }, { ip: IPV4, now: NOW, settings: settingsOf(provider) }]);
  const run = () => calls.map(([provider, response, context]) => geoParseResponse(provider, response, context));
  const before = run();
  let after;
  try {
    for (const [name, value] of Object.entries(polluted)) Object.defineProperty(Object.prototype, name, { value, configurable: true, writable: true, enumerable: false });
    after = run();
  } finally {
    for (const name of Object.keys(polluted)) delete Object.prototype[name];
  }
  assert.deepEqual(after, before, 'inherited values were read');
  assert.equal(JSON.stringify(after).includes('Polluted'), false);
  assert.deepEqual(after.slice(4), [lose('bad-response'), lose('not-found'), lose('bad-response')], 'an inherited status or inherited objects are not an answer');
  assert.equal(after.slice(0, 4).every(result => result.ok), true);
  assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype, 'Polluted'), false);
});

// ======================================================================================================================================
// Error tables
// ======================================================================================================================================
const STATUS_TABLE = {
  maxmind: { 400: 'not-public', 401: 'unauthorized', 402: 'quota', 403: 'forbidden', 404: 'not-found', 429: 'rate-limited', 500: 'server', 502: 'server', 503: 'server', 599: 'server', 300: 'bad-response', 301: 'bad-response', 405: 'bad-response', 418: 'bad-response', 451: 'bad-response', 499: 'bad-response' },
  ipgeolocation: { 400: 'bad-response', 401: 'unauthorized', 402: 'unauthorized', 403: 'forbidden', 404: 'not-found', 423: 'not-public', 429: 'quota', 500: 'server', 503: 'server', 599: 'server', 301: 'bad-response', 405: 'bad-response', 413: 'bad-response', 415: 'bad-response', 499: 'bad-response' },
  ipdata: { 400: 'not-public', 401: 'unauthorized', 402: 'quota', 403: 'forbidden', 404: 'not-found', 429: 'rate-limited', 500: 'server', 502: 'server', 599: 'server', 301: 'bad-response', 405: 'bad-response', 418: 'bad-response' },
  ipapi: { 400: 'bad-response', 401: 'unauthorized', 402: 'quota', 403: 'forbidden', 404: 'not-found', 429: 'rate-limited', 500: 'server', 503: 'server', 599: 'server', 301: 'bad-response', 405: 'bad-response' },
};
test('errors: the status table of every provider (ADR-109), with no body, an irrelevant JSON body and an HTML body', () => {
  for (const [provider, table] of Object.entries(STATUS_TABLE)) for (const [status, error] of Object.entries(table)) for (const [text, headers] of [['', {}], ['{"x":1}', JSON_HEADERS], ['<html>Oops</html>', { 'content-type': 'text/html' }]]) {
    const retry = provider === 'maxmind' && error === 'rate-limited' ? 60000 : null;
    assert.deepEqual(answer(provider, text, { ...BASES[provider].options, status: Number(status), headers }), lose(error, retry), provider + ' ' + status + ' ' + JSON.stringify(text));
  }
});

test('errors: MaxMind - the static code of the error body decides, the status only when there is no known code; a 429 waits a minute', () => {
  const codes = [[400, 'IP_ADDRESS_INVALID', 'not-public'], [400, 'IP_ADDRESS_REQUIRED', 'not-public'], [400, 'IP_ADDRESS_RESERVED', 'not-public'], [400, 'SERVICE_INVALID', 'bad-response'],
    [401, 'AUTHORIZATION_INVALID', 'unauthorized'], [401, 'LICENSE_KEY_REQUIRED', 'unauthorized'], [401, 'ACCOUNT_ID_REQUIRED', 'unauthorized'], [402, 'INSUFFICIENT_FUNDS', 'quota'], [403, 'PERMISSION_REQUIRED', 'forbidden'],
    [404, 'IP_ADDRESS_NOT_FOUND', 'not-found'], [500, 'SERVER_ERROR', 'server'],
    [400, 'AUTHORIZATION_INVALID', 'unauthorized'], [500, 'IP_ADDRESS_NOT_FOUND', 'not-found'], [404, 'SERVER_ERROR', 'server'], [403, 'INSUFFICIENT_FUNDS', 'quota'],
    [400, 'NEW_CODE', 'not-public'], [401, 'NEW_CODE', 'unauthorized'], [402, 'authorization_invalid', 'quota'], [418, 'NEW_CODE', 'bad-response'], [503, 'NEW_CODE', 'server']];
  for (const [status, code, error] of codes) assert.deepEqual(answer('maxmind', JSON.stringify({ code, error: 'text' }), { status, headers: JSON_HEADERS }), lose(error), status + ' ' + code);
  for (const code of [5, null, [], {}, true, ['IP_ADDRESS_NOT_FOUND']]) assert.equal(answer('maxmind', JSON.stringify({ code, error: 'x' }), { status: 402, headers: JSON_HEADERS }).error, 'quota', JSON.stringify(code));
  for (const body of ['[]', '"AUTHORIZATION_INVALID"', 'null', '5', '{', '']) assert.equal(answer('maxmind', body, { status: 403, headers: JSON_HEADERS }).error, 'forbidden', body);
  assert.deepEqual(answer('maxmind', '', { status: 429, headers: {} }), lose('rate-limited', 60000));
  for (const provider of ['ipgeolocation', 'ipdata']) assert.equal(answer(provider, '', { status: 429, headers: {} }).retryAfterMs, null);
});

const message = text => JSON.stringify({ message: text });
test('errors: ipgeolocation.io 401 - a plan problem ONLY with include=security on and the one documented plan message; every other 401 is a rejected key', () => {
  const PLAN = 'IP-security lookup is not supported on your subscription. This feature is available on Paid subscriptions only.';   // the OpenAPI example text
  const table = [   // [body text, result with include=security off, result with it on]
    [message(PLAN), 'unauthorized', 'plan'],
    [message('IP-security lookup is not supported on your subscription.'), 'unauthorized', 'plan'],
    [message('This feature is available on Paid subscriptions only.'), 'unauthorized', 'plan'],
    [message('available on a paid subscription only'), 'unauthorized', 'plan'],
    [message('lookup is NOT SUPPORTED ON YOUR CURRENT SUBSCRIPTION'), 'unauthorized', 'plan'],
    // every other documented 401 is the key (or the account) being rejected
    [message('Provided API key is not valid. Contact technical support for assistance at support@ipgeolocation.io'), 'unauthorized', 'unauthorized'],
    [message("Please provide an API key (as 'apiKey=YOUR_API_KEY' URL parameter) to use IPGeolocation API. To get your free API Key, sign up at the provider"), 'unauthorized', 'unauthorized'],
    [message('Please verify your email before using IPGeolocation API.'), 'unauthorized', 'unauthorized'],
    [message('Your account has been locked to use IPGeolocation API.'), 'unauthorized', 'unauthorized'],
    [message('You cannot query IPGeolocation API on a database plan subscription.'), 'unauthorized', 'unauthorized'],
    [message('Your subscription has been paused. Please resume your subscription to use IPGeolocation API.'), 'unauthorized', 'unauthorized'],
    [message("This 'de' lang is not supported for your current subscription. Please use 'en' as the default language or upgrade your subscription to use this feature."), 'unauthorized', 'unauthorized'],
    // the wordings an earlier version guessed are NOT the plan message
    [message('Your subscription does not include security'), 'unauthorized', 'unauthorized'],
    [message('This module is not available on the free plan'), 'unauthorized', 'unauthorized'],
    [message('Your API key does not include this feature'), 'unauthorized', 'unauthorized'],
    [message('synthesized: this module is not part of your subscription'), 'unauthorized', 'unauthorized'],
    ['', 'unauthorized', 'unauthorized'], ['[]', 'unauthorized', 'unauthorized'], ['"x"', 'unauthorized', 'unauthorized'], ['null', 'unauthorized', 'unauthorized'],
    ['{"message":5}', 'unauthorized', 'unauthorized'], ['{"error":"IP-security lookup is not supported on your subscription."}', 'unauthorized', 'unauthorized'],
    [message('x'.repeat(10000)), 'unauthorized', 'unauthorized'],
  ];
  for (const [text, plain, withSecurity] of table) {
    assert.deepEqual(answer('ipgeolocation', text, { status: 401, security: false, headers: JSON_HEADERS }), lose(plain), 'security off: ' + text.slice(0, 60));
    assert.deepEqual(answer('ipgeolocation', text, { status: 401, security: true, headers: JSON_HEADERS }), lose(withSecurity), 'security on: ' + text.slice(0, 60));
  }
  assert.deepEqual(answer('ipgeolocation', '<html>Unauthorized</html>', { status: 401, security: true, headers: { 'content-type': 'text/html' } }), lose('unauthorized'));
  assert.deepEqual(answer('ipgeolocation', message(PLAN), { status: 401, security: true, headers: { 'content-type': 'text/html' } }), lose('unauthorized'), 'an HTML-typed body is not decoded');
  for (const status of [400, 402, 403, 404, 423, 429, 500, 503]) assert.notEqual(answer('ipgeolocation', message(PLAN), { status, security: true, headers: JSON_HEADERS }).error, 'plan', 'only a 401 can be a plan problem: ' + status);
});

test('errors: ipgeolocation.io 402 is an expired paid subscription - the key is no longer accepted (unauthorized); the used-up quota is the 429', () => {
  for (const text of ['', message('Your subscription has expired at 2026-01-15 00:00. Please subscribe to a paid plan to continue using IPGeolocation API without interruption'), '[]', '<html>Payment required</html>']) {
    for (const security of [false, true]) {
      assert.deepEqual(answer('ipgeolocation', text, { status: 402, security, headers: JSON_HEADERS }), lose('unauthorized'), 'security ' + security + ' ' + text.slice(0, 40));
      assert.deepEqual(answer('ipgeolocation', text, { status: 429, security, headers: JSON_HEADERS }), lose('quota'));
    }
  }
});

test('errors: ipgeolocation.io 400 names the address (not-public) or something else (bad-response); 423 is a bogon; 429 is a used-up plan', () => {
  const table = [['{"message":"The IP address is invalid"}', 'not-public'], ['{"message":"Invalid IP"}', 'not-public'], ['{"message":"bogon range"}', 'not-public'], ['{"message":"private network"}', 'not-public'], ['{"message":"reserved"}', 'not-public'],
    [message("Provided name, service or IP address '999.999.999.999' is not valid."), 'not-public'],
    [message('Invalid character found in the request target.'), 'bad-response'], [message("This 'zz' lang is not valid. Please use 'en' as the default language"), 'bad-response'],
    ['{"message":"special characters in the request"}', 'bad-response'], ['{"message":"zip code is wrong"}', 'bad-response'], ['{"message":"ipgeolocation says no"}', 'bad-response'], ['', 'bad-response'], ['{"message":5}', 'bad-response'], ['[]', 'bad-response']];
  for (const [text, error] of table) assert.deepEqual(answer('ipgeolocation', text, { status: 400, headers: JSON_HEADERS }), lose(error), text);
  for (const text of ['', '{"message":"The IP address is invalid"}']) {
    assert.deepEqual(answer('ipgeolocation', text, { status: 423, headers: JSON_HEADERS }), lose('not-public'));
    assert.deepEqual(answer('ipgeolocation', text, { status: 429, headers: JSON_HEADERS }), lose('quota'));
  }
});

test('errors: ipdata 403 - a used-up quota (whole words), else a plan-gated feature ("upgrade to a paid plan"), else forbidden; 400 is an unusable address', () => {
  const table = [   // [message or raw text, result]
    // a used-up quota is told by the words quota / limit / exceeded / used up; it wins over the upgrade phrase the same message may carry
    [message('You have exceeded your free quota. Upgrade to a paid plan to re-activate your account.'), 'quota'],
    [message('You have made 20,000 requests and have exceeded your daily quota. Upgrade to the next plan to re-activate your account.'), 'quota'],
    [message('daily QUOTA reached'), 'quota'], [message('rate limit hit'), 'quota'], [message('Your requests are used up'), 'quota'], [message('exceeded'), 'quota'], [message('limit reached, upgrade to a paid plan'), 'quota'],
    // a plan-gated feature: the upgrade phrase and no quota word
    [message('Upgrade to a paid plan to make bulk requests.'), 'plan'], [message('Upgrade to a paid plan to access ASN data.'), 'plan'], [message('UPGRADE TO A PAID PLAN'), 'plan'], [message('Please upgrade to a paid plan to use this'), 'plan'],
    // neither: whole words only, so "unlimited", "unused", "refused" and "caused" are not a quota
    [message('IP or domain not in whitelist.'), 'forbidden'], [message('unlimited access denied'), 'forbidden'], [message('unused module'), 'forbidden'], [message('access refused'), 'forbidden'], [message('caused by you'), 'forbidden'],
    [message('Upgrade to the next plan'), 'forbidden'], ['', 'forbidden'], ['[]', 'forbidden'], ['{"message":5}', 'forbidden'], ['{"msg":"quota"}', 'forbidden'], ['{"msg":"upgrade to a paid plan"}', 'forbidden'],
  ];
  for (const [text, error] of table) assert.deepEqual(answer('ipdata', text, { status: 403, headers: JSON_HEADERS }), lose(error), text);
  assert.deepEqual(answer('ipdata', message('Upgrade to a paid plan to access ASN data.'), { status: 403, headers: { 'content-type': 'text/html' } }), lose('forbidden'), 'an HTML-typed body is not decoded');
  for (const status of [400, 401, 402, 404, 429, 500]) assert.notEqual(answer('ipdata', message('Upgrade to a paid plan to access ASN data.'), { status, headers: JSON_HEADERS }).error, 'plan', 'only a 403 can be a plan problem: ' + status);
  for (const text of ['', '{"message":"127.0.0.1 is a private IP address"}', '{"message":"bleh does not appear to be an IPv4 or IPv6 address"}', '{"message":"quota"}']) assert.deepEqual(answer('ipdata', text, { status: 400, headers: JSON_HEADERS }), lose('not-public'));
});

test('errors: ip-api - fail bodies decide by their message under 200 and 403, 429 wins over everything, plain statuses follow the HTTP meaning', () => {
  const fail = message => JSON.stringify({ status: 'fail', message, query: 'x' });
  const table = [[200, fail('private range'), 'not-public'], [200, fail('reserved range'), 'not-public'], [200, fail('invalid query'), 'not-public'], [200, fail('Private Range'), 'not-public'], [200, fail(' reserved range '), 'not-public'], [200, fail('INVALID QUERY'), 'not-public'],
    [200, fail('invalid/expired key'), 'unauthorized'], [200, fail('Invalid API KEY'), 'unauthorized'], [200, fail('key'), 'unauthorized'], [200, fail('something new'), 'bad-response'], [200, fail(5), 'bad-response'], [200, fail(''), 'bad-response'],
    [200, '{"status":"fail"}', 'bad-response'], [200, '{"status":"Success"}', 'bad-response'], [200, '{"status":"ok"}', 'bad-response'], [200, '{"status":1}', 'bad-response'], [200, '{}', 'bad-response'], [200, '[]', 'bad-response'],
    [403, fail('invalid/expired key, renew at somewhere'), 'unauthorized'], [403, fail('private range'), 'not-public'], [403, fail('something else'), 'forbidden'], [403, '{"status":"success"}', 'forbidden'], [403, '[]', 'forbidden'], [403, '', 'forbidden'],
    [401, fail('invalid/expired key'), 'unauthorized'], [401, '', 'unauthorized'], [402, '', 'quota'], [404, '', 'not-found'], [500, '', 'server'], [503, fail('down'), 'server'], [400, fail('invalid query'), 'not-public'], [400, '', 'bad-response'],
    [429, fail('invalid/expired key'), 'rate-limited'], [429, '', 'rate-limited'], [429, fail('private range'), 'rate-limited']];
  for (const [status, text, error] of table) assert.equal(answer('ipapi', text, { status, headers: JSON_HEADERS }).error, error, status + ' ' + text);
  for (const [status, text] of table) assert.deepEqual(Object.keys(answer('ipapi', text, { status, headers: JSON_HEADERS })).filter(key => key === 'record'), [], 'no record in an error');
});

test('errors: the ip-api rate headers - X-Rl is what is left, X-Ttl the wait, at X-Rl 0 or a 429 the wait is returned as a pause', () => {
  const body = '{"status":"success","countryCode":"US","query":"8.8.8.8"}';
  const run = (headers, status = 200, text = status === 429 ? '' : body) => answer('ipapi', text, { status, headers: { 'content-type': 'application/json', ...headers } });
  const quotaOf = (headers, status, text) => run(headers, status, text).quota;
  const retryOf = (headers, status, text) => run(headers, status, text).retryAfterMs;
  assert.deepEqual(quotaOf({ 'x-rl': '44', 'x-ttl': '60' }), quota(44));
  assert.deepEqual(quotaOf({ 'x-rl': '0', 'x-ttl': '37' }), quota(0, 37000));
  assert.deepEqual(quotaOf({ 'x-rl': '0' }), quota(0));
  assert.equal(quotaOf({ 'x-ttl': '37' }), null, 'a wait without a remaining count of 0 is no pause');
  assert.equal(quotaOf({}), null);
  assert.deepEqual(quotaOf({ 'x-rl': ' 12 ' }), quota(12));
  assert.deepEqual(quotaOf({ 'x-rl': 12 }), quota(12), 'a number header value is accepted');
  assert.deepEqual(quotaOf({ 'x-rl': '999999999' }), quota(999999999));
  for (const bad of ['abc', '', '-5', '1.5', '12345678901', '1e3', '0x10', '12 13', 'NaN', cp(0x663)]) assert.equal(quotaOf({ 'x-rl': bad }), null, JSON.stringify(bad));
  assert.deepEqual(quotaOf({ 'x-rl': '0', 'x-ttl': '999999' }), quota(0, 3600000), 'a wait is believed for at most an hour');
  assert.deepEqual(quotaOf({ 'x-rl': '0', 'x-ttl': '0' }), quota(0));
  for (const bad of ['abc', '-1', '1.5', '']) assert.deepEqual(quotaOf({ 'x-rl': '0', 'x-ttl': bad }), quota(0), 'x-ttl ' + JSON.stringify(bad));
  assert.deepEqual(quotaOf({ 'x-rl': '5', 'x-ttl': '30' }, 429), quota(5, 30000), 'a 429 is a pause whatever X-Rl says');
  assert.deepEqual(quotaOf({ 'x-ttl': '30' }, 429), quota(null, 30000));
  assert.equal(quotaOf({}, 429), null);
  assert.equal(retryOf({ 'x-rl': '0', 'x-ttl': '37' }, 429), 37000); assert.equal(retryOf({ 'x-ttl': '30' }, 429), 30000); assert.equal(retryOf({}, 429), null); assert.equal(retryOf({ 'x-rl': '0' }, 429), null);
  const privateRange = '{"status":"fail","message":"private range"}';
  assert.equal(retryOf({ 'x-rl': '0', 'x-ttl': '37' }, 200, privateRange), 37000, 'an exhausted window pauses the provider whatever the error is');
  assert.equal(retryOf({ 'x-rl': '5', 'x-ttl': '37' }, 200, privateRange), null, 'a window with requests left asks for no pause');
  assert.equal(retryOf({}, 200, privateRange), null);
  assert.deepEqual(quotaOf({ 'x-rl': '0', 'x-ttl': '37' }, 200, privateRange), quota(0, 37000), 'the counters are reported with any answer');
  assert.equal(retryOf({ 'x-rl': '0', 'x-ttl': '37' }, 403, '{"status":"fail","message":"invalid/expired key"}'), 37000);
  assert.equal(retryOf({ 'x-rl': '0', 'x-ttl': '37' }, 500, ''), 37000);
  for (const headers of [undefined, null, [], 'x', 5, { 'x-rl': null }, { 'x-rl': {} }, { 'x-rl': ['5'] }]) assert.equal(answer('ipapi', body, { headers }).ok, true, JSON.stringify(headers));
  for (const provider of ['maxmind', 'ipgeolocation', 'ipdata']) assert.equal(answer(provider, BASES[provider].base, { ...BASES[provider].options, headers: { 'content-type': 'application/json', 'x-rl': '0', 'x-ttl': '37' } }).quota, null, provider + ' ignores ip-api headers');
});

// ======================================================================================================================================
// Hostile and huge input: no throw, no pollution, bounded work
// ======================================================================================================================================
const prototypeNames = () => [Object.getOwnPropertyNames(Object.prototype).sort().join(), Object.getOwnPropertyNames(Array.prototype).sort().join()];
const NAMES_BEFORE = prototypeNames();
const timed = run => { const start = performance.now(); const value = run(); return { value, ms: performance.now() - start }; };
const CITY_BODY = {
  maxmind: city => ({ traits: { ip_address: IPV4 }, city: { names: { en: city } } }),
  ipgeolocation: city => ({ ip: IPV4, location: { city } }),
  ipdata: city => ({ ip: IPV4, city }),
  ipapi: city => ({ status: 'success', query: IPV4, city }),
};
/** Runs `run` with JSON.parse replaced by a parse whose result is wrapped in Proxies that log every property the code under test touches. */
function withInstrumentedParse(run) {
  const original = JSON.parse, touched = new Map();
  const wrap = (value, label) => {
    if (value === null || typeof value !== 'object') return value;
    if (!touched.has(label)) touched.set(label, []);
    const log = touched.get(label);
    return new Proxy(value, {
      get(target, key, receiver) { log.push(String(key)); return Reflect.get(target, key, receiver); },
      has(target, key) { log.push('has:' + String(key)); return Reflect.has(target, key); },
      ownKeys(target) { log.push('<ownKeys>'); return Reflect.ownKeys(target); },
      getOwnPropertyDescriptor(target, key) {
        log.push(String(key));
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
        return descriptor && Object.hasOwn(descriptor, 'value') && descriptor.configurable ? { ...descriptor, value: wrap(descriptor.value, label + '.' + String(key)) } : descriptor;
      },
    });
  };
  JSON.parse = (text, reviver) => wrap(original.call(JSON, text, reviver), 'root');
  try { return { result: run(), touched }; } finally { JSON.parse = original; }
}

test('hostile: a city of one MiB is never read (over the size limit); one of 60,000 characters is cut to 80; both are fast', () => {
  for (const provider of GEO_PROVIDERS) {
    const huge = timed(() => answer(provider, JSON.stringify(CITY_BODY[provider]('A'.repeat(1024 * 1024))), BASES[provider].options));
    assert.deepEqual(huge.value, lose('bad-response'), provider); assert.ok(huge.ms < 1000, provider + ' took ' + huge.ms + ' ms');
    const text = JSON.stringify(CITY_BODY[provider]('B' + cp(0x202e) + 'C'.repeat(60000)));
    assert.ok(text.length < GEO_LIMITS.responseBytes, 'this case stays inside the size limit');
    const medium = timed(() => answer(provider, text, BASES[provider].options));
    assert.equal(medium.value.record.city, 'B ' + 'C'.repeat(78), provider); assert.ok(medium.ms < 1000, provider + ' took ' + medium.ms + ' ms');
  }
});

test('hostile: 100,000 subdivisions are over the limit; 30,000 inside it are never walked (only element 0 is touched)', () => {
  const big = '{"subdivisions":[' + '0,'.repeat(99999) + '0],"traits":{"ip_address":"8.8.8.8"}}';
  assert.ok(big.length > GEO_LIMITS.responseBytes);
  const rejected = timed(() => answer('maxmind', big, { service: 'geoip-city' }));
  assert.deepEqual(rejected.value, lose('bad-response')); assert.ok(rejected.ms < 1000);
  const inside = '{"subdivisions":[{"names":{"en":"First"}},' + '0,'.repeat(29990) + '0],"traits":{"ip_address":"8.8.8.8"},"country":{"iso_code":"US"}}';
  assert.ok(inside.length < GEO_LIMITS.responseBytes);
  const { result, touched } = withInstrumentedParse(() => answer('maxmind', inside, { service: 'geoip-city' }));
  assert.equal(result.ok, true); assert.equal(result.record.region, 'First');
  assert.deepEqual(touched.get('root.subdivisions'), ['0'], 'the array itself is asked for element 0 and nothing else (no length, no iteration)');
  assert.ok(touched.get('root').length < 40, 'the top level is read key by key');
  const instrumented = withInstrumentedParse(() => answer('maxmind', '{"traits":{"ip_address":"8.8.8.8"},"country":{"iso_code":"US","names":{"en":"United States"}}}', { service: 'geoip-city' }));
  assert.equal(instrumented.result.record.countryName, 'United States', 'the instrumented parse is transparent');
  assert.ok(![...instrumented.touched.values()].flat().includes('<ownKeys>'), 'no object is enumerated when its English name exists');
});

test('hostile: only the first 16 keys of a names object are looked at, and blocked keys are skipped', () => {
  const names = (count, at) => Object.fromEntries(Array.from({ length: count }, (_, index) => ['k' + index, index === at ? 'Found' : index]));
  const city = value => answer('maxmind', { traits: { ip_address: IPV4 }, country: { iso_code: 'US' }, city: { names: value } }, { service: 'geoip-city' }).record.city;
  assert.equal(city(names(5000, 4999)), '');
  assert.equal(city(names(5000, 15)), 'Found');
  assert.equal(city(names(5000, 16)), '');
  assert.equal(city(names(1, 0)), 'Found');
  const withBlocked = '{"traits":{"ip_address":"8.8.8.8"},"country":{"iso_code":"US"},"city":{"names":{"__proto__":"X","constructor":"Y","prototype":"Z","zz":"Found"}}}';
  assert.equal(answer('maxmind', withBlocked, { service: 'geoip-city' }).record.city, 'Found');
  const only = '{"traits":{"ip_address":"8.8.8.8"},"country":{"iso_code":"US"},"city":{"names":{"__proto__":"X","constructor":"Y","prototype":"Z"}}}';
  assert.equal(answer('maxmind', only, { service: 'geoip-city' }).record.city, '');
});

test('hostile: deeply nested input does not throw (an error code or an empty field, never a crash)', () => {
  const depth = 30000, deepArray = '['.repeat(depth) + ']'.repeat(depth), objectDepth = 10000, deepObject = '{"a":'.repeat(objectDepth) + '1' + '}'.repeat(objectDepth);
  assert.ok(deepArray.length < GEO_LIMITS.responseBytes && deepObject.length < GEO_LIMITS.responseBytes, 'both stay inside the size limit');
  for (const provider of GEO_PROVIDERS) {
    assert.deepEqual(answer(provider, deepArray, BASES[provider].options), lose('bad-response'), provider);
    assert.equal(answer(provider, deepObject, BASES[provider].options).ok, false, provider);
  }
  const nested = '{"traits":{"ip_address":"8.8.8.8"},"city":{"names":{"en":' + deepArray + '}},"country":{"iso_code":"US"}}';
  const result = answer('maxmind', nested, { service: 'geoip-city' });
  assert.ok(result.ok ? result.record.city === '' : result.error === 'bad-response', 'deep nesting inside a field: an empty city, or a bad-response where the JSON parser itself gives up');
});

const NON_OBJECT_TEXTS = ['', ' ', '\n', 'null', 'true', 'false', '0', '123', '-1', '"x"', '[]', '[1,2,3]', '[{"traits":{"ip_address":"8.8.8.8"}}]', '{', '}', '{"a":', '{"a":1,}', "{'a':1}", 'undefined', 'NaN', 'Infinity', cp(0), cp(0xfeff) + '{}',
  '{}', '{"a":1}', '<html></html>', 'x'.repeat(1000), '{"traits":{"ip_address":"8.8.8.8"}}garbage', '{"__proto__":{"polluted":true}}', '{"constructor":{"prototype":{"polluted":true}}}', '['.repeat(100)];
test('hostile: any text that is not an answer object is a bad-response under 200, and a plain status error otherwise; nothing throws', () => {
  for (const provider of GEO_PROVIDERS) for (const text of NON_OBJECT_TEXTS) {
    assert.deepEqual(answer(provider, text, BASES[provider].options), lose('bad-response'), provider + ' ' + JSON.stringify(text.slice(0, 30)));
    for (const status of [400, 401, 403, 404, 429, 500, 503, 302]) {
      const result = answer(provider, text, { ...BASES[provider].options, status });
      assert.equal(result.ok, false); assert.ok(GEO_ERRORS.includes(result.error), provider + ' ' + status);
    }
  }
  assert.equal(({}).polluted, undefined); assert.equal(Object.hasOwn(Object.prototype, 'polluted'), false);
});

// A corpus-based fuzz: every fixture body of a provider is the template, random mutations (a key deleted, a key added, a value replaced by a random scalar,
// array or object) make it hostile. Deterministic: a fixed seed. Whatever comes out must be a well-formed result.
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => { state = (state + 0x6d2b79f5) >>> 0; let t = Math.imul(state ^ (state >>> 15), 1 | state); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const JUNK_KEYS = ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty', '0', '1', 'length', 'names', 'en', 'status', 'message', 'code', 'ip', 'ip_address', 'query', 'traits', 'anonymizer', 'security', 'threat', 'carrier', 'asn', 'as', 'type', 'name',
  'user_type', 'connection_type', 'is_tor', 'is_proxy', 'proxy', 'hosting', 'mobile', 'city', 'country', 'iso_code', 'time_zone', 'location', 'subdivisions', 'maxmind', 'queries_remaining'];
const FUZZ_SCALARS = [null, true, false, 0, 1, -1, 1.5, 4294967295, 4294967296, 1e308, -1e308, '', ' ', 'x', 'success', 'fail', 'US', 'us', 'AS15169 Google', 'AS1', '8.8.8.8', '2001:4860:4860::8888', 'Europe/Paris', 'private range', 'residential', 'Cellular',
  'constructor', '__proto__', 'A' + cp(0x202e, 0x200b, 7, 0x2028) + 'B', 'x'.repeat(300), cp(0x1f600).repeat(100), [], {}, [[]], [null], { names: { en: 'N' } }];
const defineKey = (object, key, value) => Object.defineProperty(object, key, { value, enumerable: true, configurable: true, writable: true });
const pick = (random, list) => list[Math.floor(random() * list.length)];
function mutate(random, value, depth = 0) {
  if (value === null || typeof value !== 'object' || depth > 4) return pick(random, FUZZ_SCALARS);
  const copy = Array.isArray(value) ? [...value] : { ...value }, keys = Object.keys(copy), action = random();
  if (action < 0.15 && keys.length) delete copy[pick(random, keys)];
  else if (action < 0.3) defineKey(copy, pick(random, Array.isArray(copy) ? ['0', '1', '2'] : JUNK_KEYS), pick(random, FUZZ_SCALARS));
  else if (keys.length) { const key = pick(random, keys); copy[key] = random() < 0.5 ? mutate(random, copy[key], depth + 1) : pick(random, FUZZ_SCALARS); }
  return copy;
}
function wellFormed(provider, result, ip) {
  assert.ok(result !== null && typeof result === 'object' && Object.isFrozen(result));
  const sound = value => value === null || (Number.isSafeInteger(value) && value >= 0);
  if (result.ok) {
    assert.deepEqual(Object.keys(result), ['ok', 'record', 'quota']);
    assert.deepEqual(normalizeGeoRecord(result.record, NOW), result.record);
    assert.equal(result.record.provider, provider); assert.equal(result.record.ip, ip);
    assert.ok(result.quota === null || (Object.keys(result.quota).join() === 'remaining,pausedMs' && sound(result.quota.remaining) && sound(result.quota.pausedMs)));
  } else {
    assert.deepEqual(Object.keys(result), ['ok', 'error', 'retryAfterMs', 'quota']);
    assert.ok(GEO_ERRORS.includes(result.error), String(result.error));
    assert.ok(result.retryAfterMs === null || (sound(result.retryAfterMs) && result.retryAfterMs <= 3600000));
    assert.ok(result.quota === null || (Object.keys(result.quota).join() === 'remaining,pausedMs' && sound(result.quota.remaining) && sound(result.quota.pausedMs)));
  }
}
test('fuzz: 8,000 mutated answers of the four providers all give a well-formed, frozen result, never throw and never pollute', t => {
  const random = mulberry32(20261106);
  // Real recorded answers, each with its own status, headers, address and request settings, are the templates: mutating them is what a damaged answer looks like.
  const templates = Object.fromEntries(GEO_PROVIDERS.map(provider => [provider, fixtureNames().filter(name => name.startsWith(provider + '/')).flatMap(name => {
    const fixture = readFixture(name);
    try { const body = JSON.parse(textOf(fixture)); return isObject(body) ? [{ body, fixture }] : []; } catch { return []; }
  })]));
  const statuses = [200, 201, 400, 401, 402, 403, 404, 423, 429, 499, 500, 503, 301, 100, 700, undefined, 'x'];
  const headerSets = [{}, JSON_HEADERS, { 'content-type': 'text/html' }, { 'x-rl': '0', 'x-ttl': '10' }, { 'x-rl': 'abc', 'x-ttl': '-1' }, { 'x-rl': '5' }, null, 'x', { 'content-type': 'application/json', 'x-ttl': '99999999' }];
  const start = performance.now();
  let successes = 0, failures = 0;
  for (let index = 0; index < 8000; index++) {
    const provider = GEO_PROVIDERS[index % GEO_PROVIDERS.length];
    const { body: template, fixture } = pick(random, templates[provider]);
    let body = template;
    for (let round = 1 + Math.floor(random() * 3); round > 0; round--) body = mutate(random, body);
    const text = random() < 0.08 ? JSON.stringify(body).slice(0, Math.floor(random() * 300)) : JSON.stringify(body);
    const own = random() < 0.8;   // most cases keep what the recorded answer came with, the rest get a random envelope
    const ip = own ? fixture.ip : (random() < 0.5 ? IPV6 : IPV4);
    const service = own && fixture.service ? fixture.service : pick(random, ['geolite-city', 'geoip-city', 'geoip-insights']);
    const settings = settingsWith({ providers: { maxmind: { service }, ipgeolocation: { security: own ? fixture.security === true : random() < 0.5 } } });
    const response = { status: own ? fixture.status : pick(random, statuses), headers: own ? fixture.headers : pick(random, headerSets), text };
    const result = geoParseResponse(provider, response, { ip, now: NOW, settings });
    wellFormed(provider, result, ip);
    if (result.ok) successes++; else failures++;
  }
  t.diagnostic('fuzz outcomes: ' + successes + ' records, ' + failures + ' error results');
  assert.ok(successes > 1000 && failures > 1000, 'the mutations reach both outcomes: ' + successes + ' / ' + failures);
  assert.ok(performance.now() - start < 8000, 'bounded work');
  assert.deepEqual(prototypeNames(), NAMES_BEFORE); assert.equal(({}).polluted, undefined);
});

// ======================================================================================================================================
// The fixture set itself
// ======================================================================================================================================
test('consistency: every fixture file has an expectation above and every expectation has a file', () => {
  const expected = [...new Set(Object.keys(EXPECT).map(key => key.split('#')[0]))].sort();
  assert.deepEqual(fixtureNames(), expected);
  for (const provider of GEO_PROVIDERS) {
    const names = expected.filter(name => name.startsWith(provider + '/'));
    for (const kind of ['ok-', 'err-', 'hostile-']) assert.ok(names.some(name => name.split('/')[1].startsWith(kind)), provider + ' has ' + kind + ' fixtures');
  }
});

test('consistency: every fixture file has the documented envelope and is clean text (invisible characters only as JSON escapes)', () => {
  const allowed = ['provider', 'ip', 'service', 'security', 'note', 'status', 'headers', 'body', 'text'];
  for (const name of fixtureNames()) {
    const raw = readFileSync(join(FIXTURE_DIR, name), 'utf8'), fixture = JSON.parse(raw);
    assert.ok(raw.endsWith('}\n'), name);
    assert.deepEqual(Object.keys(fixture).filter(key => !allowed.includes(key)), [], name);
    assert.equal(name.split('/')[0], fixture.provider, name);
    assert.equal(geoCanonicalIp(fixture.ip), fixture.ip, name); assert.ok(geoIsPublicIp(fixture.ip), name);
    assert.ok(Number.isInteger(fixture.status) && fixture.status >= 100 && fixture.status <= 599, name);
    assert.ok(isObject(fixture.headers), name);
    for (const [header, value] of Object.entries(fixture.headers)) { assert.equal(header, header.toLowerCase(), name); assert.equal(typeof value, 'string', name + ' ' + header); }
    assert.equal(Number('body' in fixture) + Number('text' in fixture), 1, name + ': exactly one of body / text');
    if ('text' in fixture) assert.equal(typeof fixture.text, 'string', name);
    if (fixture.provider === 'maxmind') assert.ok(['geolite-city', 'geoip-city', 'geoip-insights'].includes(fixture.service), name + ': a MaxMind fixture names its service');
    else assert.equal(fixture.service, undefined, name);
    if (fixture.security !== undefined) { assert.equal(fixture.provider, 'ipgeolocation', name); assert.equal(typeof fixture.security, 'boolean', name); }
    assert.equal(geoHasForbiddenText(raw.replace(/[\n\r\t]/g, ' ')), false, name + ' holds a raw invisible or control character');
    if (name.endsWith('hostile-bidi-text.json')) assert.ok(fixture.text.includes(BACKSLASH + 'u202e') && fixture.text.includes(BACKSLASH + 'u0007'), name + ': the characters are present as escapes');
  }
});

test('consistency: the README lists every fixture once with its provenance and an exact source, and nothing that is not a file', () => {
  const readme = readFileSync(join(FIXTURE_DIR, 'README.md'), 'utf8');
  assert.equal(geoHasForbiddenText(readme.replace(/[\n\r\t]/g, ' ')), false, 'README has no invisible characters');
  const rows = readme.split('\n').filter(line => line.startsWith('| `') && line.includes('.json`'));
  const parsed = rows.map(row => {
    const match = /^\| `([^`]+)` \| (\w+) \| (.+) \| \*\*(live 2026-11-06, verbatim|verbatim|adapted|synthesized)\*\* - (.+) \|$/.exec(row);
    assert.ok(match, 'README row: ' + row.slice(0, 100));
    return { file: match[1], provider: match[2], label: match[3], provenance: match[4], source: match[5] };
  });
  assert.deepEqual(parsed.map(row => row.file).sort(), fixtureNames());
  assert.equal(new Set(parsed.map(row => row.file)).size, parsed.length, 'each file once');
  for (const row of parsed) {
    assert.equal(row.provider, row.file.split('/')[0], row.file);
    const suffix = row.file.endsWith('-live.json') ? ['live 2026-11-06, verbatim'] : (row.file.endsWith('-documented.json') ? ['verbatim', 'adapted'] : (row.file.endsWith('-adapted.json') ? ['adapted'] : ['synthesized']));
    assert.ok(suffix.includes(row.provenance), row.file + ' is labelled ' + row.provenance);
    if (row.provenance === 'verbatim' || row.provenance === 'adapted') assert.ok(/https:\/\/[a-z.-]+\//.test(row.source), row.file + ': an exact documentation address');
    if (row.provenance.startsWith('live')) assert.ok(row.source.includes('request GET '), row.file + ': the live request is named');
    assert.ok(row.label.length > 5 && row.source.length > 10, row.file);
  }
  assert.ok(readme.includes('live-verified for the invalid-key path; success path not verified (no key)'), 'the Pro URL form is marked as the owner asked');
  for (const phrase of ['verbatim', 'adapted', 'synthesized', 'live 2026-11-06, verbatim']) assert.ok(readme.includes('**' + phrase + '**'), 'the legend explains ' + phrase);
});
