// ADR-109: the shared contract of the Proxy Manager Geolocation API: catalogue, address rules, external text, strict readers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GEO_PROVIDERS, GEO_PROVIDER_INFO, GEO_COLUMNS, GEO_FLAGS, GEO_KINDS, GEO_LIMITS, GEO_ERRORS, GEO_FAILOVER_ERRORS, GEO_TRANSIENT_ERRORS, GEO_TEST_IP,
  geoConnectOrigins, geoText, geoHasForbiddenText, geoCanonicalIp, geoIsPublicIp, defaultGeoSettings, normalizeGeoSettings, geoSettingsPatch,
  geoCleanKey, geoCleanAccountId, geoCleanCredential, normalizeGeoCredentials, emptyGeoCredentials, geoProviderState, geoReadyProviders,
  geoEmptyFlags, normalizeGeoRecord, geoRecordHasData, normalizeGeoCache, geoCachePut, geoCacheLookup, emptyGeoCache,
} from '../../apps/production-extension/proxy-geo-shared.js';

const NOW = 1_800_000_000_000, DAY = 24 * 60 * 60 * 1000;
const cp = (...codes) => String.fromCodePoint(...codes);
const CODES = [0, 7, 0x1b, 0x7f, 0x85, 0x9f, 0x061c, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2028, 0x2029, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2060, 0x2066, 0x2067, 0x2068, 0x2069, 0xfeff];
const record = (patch = {}) => ({ provider: 'ipdata', service: '', at: NOW - 1000, ip: '8.8.8.8', country: 'US', countryName: 'United States', region: 'Virginia', city: 'Ashburn',
  timezone: 'America/New_York', asn: 15169, org: 'Google LLC', isp: '', kind: 'hosting', flags: { ...geoEmptyFlags(), hosting: true, proxy: false }, ...patch });

test('the catalogue has four providers in a fixed order, one recommended, and exactly the hosts the CSP will name', () => {
  assert.deepEqual(GEO_PROVIDERS, ['maxmind', 'ipgeolocation', 'ipdata', 'ipapi']);
  assert.deepEqual(GEO_PROVIDERS.filter(id => GEO_PROVIDER_INFO[id].recommended), ['maxmind']);
  assert.deepEqual(geoConnectOrigins(), ['https://geolite.info', 'https://geoip.maxmind.com', 'https://api.ipgeolocation.io', 'https://api.ipdata.co', 'http://ip-api.com', 'https://pro.ip-api.com']);
  for (const id of GEO_PROVIDERS) {
    const info = GEO_PROVIDER_INFO[id];
    assert.equal(info.id, id);
    assert.ok(Object.isFrozen(info) && Object.isFrozen(info.origins) && Object.isFrozen(info.credentials));
    assert.match(info.docsUrl, /^https:\/\/[a-z.-]+\//);
    for (const origin of info.origins) assert.ok(origin === 'http://ip-api.com' || origin.startsWith('https://'), 'only the free ip-api endpoint is plain HTTP: ' + origin);
  }
  assert.deepEqual(GEO_PROVIDER_INFO.maxmind.credentials, ['accountId', 'licenseKey']);
  assert.equal(GEO_PROVIDER_INFO.ipapi.keyOptional, true);
  assert.deepEqual(GEO_PROVIDERS.filter(id => GEO_PROVIDER_INFO[id].keyOptional), ['ipapi']);
  assert.ok(GEO_FAILOVER_ERRORS.every(code => GEO_ERRORS.includes(code)) && GEO_TRANSIENT_ERRORS.every(code => GEO_ERRORS.includes(code)));
  assert.ok(!GEO_FAILOVER_ERRORS.includes('not-public') && !GEO_FAILOVER_ERRORS.includes('no-key'), 'an address no provider can answer is never forwarded');
  assert.equal(geoCanonicalIp(GEO_TEST_IP), GEO_TEST_IP);
  assert.ok(geoIsPublicIp(GEO_TEST_IP));
});

test('canonical addresses: strict IPv4 / IPv6 text only, mapped IPv6 is the IPv4 address, everything else is null', () => {
  assert.equal(geoCanonicalIp('8.8.8.8'), '8.8.8.8');
  assert.equal(geoCanonicalIp('2001:4860:4860:0:0:0:0:8888'), '2001:4860:4860::8888');
  assert.equal(geoCanonicalIp('2001:4860:4860::8888'), '2001:4860:4860::8888');
  assert.equal(geoCanonicalIp('2A00:1450:4001:81B::200E'), '2a00:1450:4001:81b::200e');
  assert.equal(geoCanonicalIp('::ffff:8.8.4.4'), '8.8.4.4');
  assert.equal(geoCanonicalIp('::FFFF:808:404'), '8.8.4.4');
  for (const bad of ['', 'a', 'example.com', '8.8.8', '8.8.8.8.8', '08.8.8.8', '256.1.1.1', '8.8.8.8:53', '8.8.8.8/24', ' 8.8.8.8', '8.8.8.8 ', '[2001:db8::1]', 'fe80::1%eth0', '2001:db8::1/64', '1:2:3:4:5:6:7:8:9', 'g::1', '8.8.8.-1', '0x08.8.8.8', '8.8.8.8\n', null, undefined, 8, {}, ['8.8.8.8']]) {
    assert.equal(geoCanonicalIp(bad), null, JSON.stringify(bad));
  }
  assert.equal(geoCanonicalIp('1'.repeat(46)), null);
});

test('public addresses: private, loopback, link-local, CGNAT, documentation, multicast, reserved and translation ranges are never sent', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '9.9.9.9', '104.16.0.1', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '192.0.1.1', '198.17.255.255', '198.20.0.1', '203.0.114.1', '223.255.255.255', '2001:4860:4860::8888', '2a00:1450:4001:81b::200e', '2606:4700:4700::1111', '2002:808:808::1']) {
    assert.equal(geoIsPublicIp(geoCanonicalIp(ip)), true, ip);
  }
  for (const ip of ['0.0.0.0', '0.1.2.3', '10.0.0.1', '10.255.255.255', '100.64.0.1', '100.127.255.255', '127.0.0.1', '127.255.255.254', '169.254.1.1', '172.16.0.1', '172.31.255.255', '192.0.0.8', '192.0.2.1', '192.88.99.1', '192.168.1.1',
    '198.18.0.1', '198.19.255.255', '198.51.100.7', '203.0.113.9', '224.0.0.1', '239.255.255.250', '240.0.0.1', '255.255.255.255',
    '::', '::1', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '2001:db8::1', '2001:db8:ffff::1', '3fff::1', '3fff:fff::1', '64:ff9b::808:808', '100::1', '1::1', '4000::1']) {
    assert.equal(geoIsPublicIp(geoCanonicalIp(ip)), false, ip);
  }
  assert.equal(geoIsPublicIp('example.com'), false);
  assert.equal(geoIsPublicIp(null), false);
  assert.equal(geoIsPublicIp(geoCanonicalIp('::ffff:10.0.0.1')), false, 'a mapped private address is a private address');
});

test('external text: control, bidi, zero-width and separator characters are removed, spaces collapsed, length bounded by code points', () => {
  assert.equal(geoText('  Frankfurt   am\tMain \n'), 'Frankfurt am Main');
  assert.equal(geoText('Berlin' + cp(0x202e) + 'gnp.exe'), 'Berlin gnp.exe');
  for (const code of CODES) {
    const dirty = 'A' + cp(code) + 'B';
    assert.equal(geoHasForbiddenText(dirty), true, code.toString(16));
    assert.equal(CODES.some(other => geoText(dirty).includes(cp(other))), false, code.toString(16));
  }
  assert.equal(geoHasForbiddenText('Plain text'), false);
  assert.equal(geoText('A'.repeat(500)).length, GEO_LIMITS.textChars);
  const astral = cp(0x1f600).repeat(200);
  assert.equal([...geoText(astral)].length, GEO_LIMITS.textChars, 'counted in code points, no split surrogate pair');
  assert.equal(geoText('abcdef', 3), 'abc');
  for (const value of [null, undefined, 5, {}, [], true]) assert.equal(geoText(value), '');
  assert.equal(geoText('<img src=x onerror=alert(1)>'), '<img src=x onerror=alert(1)>', 'text is kept as text; the UI only ever renders text nodes');
});

test('settings: the default is everything off; a stored value is read strictly and anything unexpected is the default', () => {
  const base = defaultGeoSettings();
  assert.deepEqual(base, { version: 1, enabled: false, auto: true, failover: true, remember: false, columns: [...GEO_COLUMNS],
    providers: { maxmind: { enabled: false, service: 'geolite-city' }, ipgeolocation: { enabled: false, security: false }, ipdata: { enabled: false }, ipapi: { enabled: false, http: false } } });
  assert.deepEqual(normalizeGeoSettings(base), base);
  assert.notEqual(defaultGeoSettings(), defaultGeoSettings(), 'fresh objects');
  const on = { ...base, enabled: true, columns: ['geotime', 'geo'], providers: { ...base.providers, maxmind: { enabled: true, service: 'geoip-insights' }, ipapi: { enabled: true, http: true } } };
  const read = normalizeGeoSettings(on);
  assert.equal(read.enabled, true);
  assert.deepEqual(read.columns, ['geo', 'geotime'], 'canonical column order');
  assert.deepEqual(read.providers.maxmind, { enabled: true, service: 'geoip-insights' });
  const broken = [null, undefined, 'x', [], 5, {}, { ...base, version: 2 }, { ...base, extra: 1 }, { ...base, enabled: 'yes' }, { ...base, auto: 1 }, { ...base, columns: ['geo', 'geo'] }, { ...base, columns: ['nope'] }, { ...base, columns: 'geo' },
    { ...base, columns: [...GEO_COLUMNS, 'geo'] }, { ...base, providers: { ...base.providers, maxmind: { enabled: true, service: 'enterprise' } } }, { ...base, providers: { ...base.providers, ipdata: { enabled: true, extra: 1 } } },
    { ...base, providers: { maxmind: base.providers.maxmind } }, { ...base, providers: { ...base.providers, ipapi: { enabled: true } } }];
  for (const value of broken) assert.deepEqual(normalizeGeoSettings(value), base, JSON.stringify(value));
  const poisoned = JSON.parse('{"version":1,"enabled":true,"auto":true,"failover":true,"remember":false,"columns":[],"providers":' + JSON.stringify(base.providers) + ',"__proto__":{"enabled":true}}');
  assert.deepEqual(normalizeGeoSettings(poisoned), base, 'a __proto__ key makes the value invalid');
  const getter = { ...base }; Object.defineProperty(getter, 'enabled', { get: () => true, enumerable: true });
  assert.deepEqual(normalizeGeoSettings(getter), base, 'accessors are not data');
});

test('settings patch: valid parts apply, invalid parts are ignored, one bad value never resets the rest', () => {
  const base = defaultGeoSettings();
  const first = geoSettingsPatch(base, { enabled: true, auto: false, columns: ['geonet', 'geo'], providers: { maxmind: { enabled: true, service: 'geoip-city' }, ipapi: { http: true } } });
  assert.equal(first.enabled, true); assert.equal(first.auto, false);
  assert.deepEqual(first.columns, ['geo', 'geonet']);
  assert.deepEqual(first.providers.maxmind, { enabled: true, service: 'geoip-city' });
  assert.deepEqual(first.providers.ipapi, { enabled: false, http: true });
  const second = geoSettingsPatch(first, { enabled: 'yes', failover: false, columns: ['geo', 'bogus'], providers: { maxmind: { enabled: false, service: 'enterprise' }, nope: { enabled: true }, ipdata: 'x', ipgeolocation: { security: 'yes', enabled: true } } });
  assert.equal(second.enabled, true, 'a non-boolean is ignored');
  assert.equal(second.failover, false, 'the valid part still applies');
  assert.deepEqual(second.columns, ['geo', 'geonet'], 'a column list with an unknown column is ignored as a whole');
  assert.deepEqual(second.providers.maxmind, { enabled: false, service: 'geoip-city' }, 'a bad option does not stop the enable flag');
  assert.deepEqual(second.providers.ipgeolocation, { enabled: true, security: false });
  assert.deepEqual(geoSettingsPatch(first, null), first);
  assert.deepEqual(geoSettingsPatch(first, 'x'), first);
  assert.deepEqual(geoSettingsPatch({ garbage: 1 }, { enabled: true }), { ...base, enabled: true }, 'a corrupt base is the default plus the patch');
  const patched = geoSettingsPatch(base, { columns: [] });
  assert.deepEqual(patched.columns, [], 'hiding every geo column is allowed');
});

test('keys: trimmed printable ASCII of 8 to 256 characters; MaxMind account IDs are digits; credentials have exactly the provider fields', () => {
  assert.equal(geoCleanKey('  abcd1234EFGH_-xyz  '), 'abcd1234EFGH_-xyz');
  assert.equal(geoCleanKey('a'.repeat(256)).length, 256);
  for (const bad of ['', 'short12', 'a'.repeat(257), 'has space inside', 'tab\tinside1', 'new\nline123', 'ключ-не-ascii-12', 'abcd1234' + cp(0x200b), 'abcd1234' + cp(0x7f), null, undefined, 12345678, {}, []]) assert.equal(geoCleanKey(bad), null, JSON.stringify(bad));
  assert.equal(geoCleanAccountId(' 123456 '), '123456');
  for (const bad of ['', 'abc', '12 34', '1'.repeat(13), '-1', '1.5', null, 123456]) assert.equal(geoCleanAccountId(bad), null, JSON.stringify(bad));
  assert.deepEqual(geoCleanCredential('maxmind', { accountId: ' 123456 ', licenseKey: ' abcdefgh_12345678 ' }), { accountId: '123456', licenseKey: 'abcdefgh_12345678' });
  assert.equal(geoCleanCredential('maxmind', { accountId: '123456' }), null);
  assert.equal(geoCleanCredential('maxmind', { accountId: '123456', licenseKey: 'abcdefgh', apiKey: 'abcdefgh' }), null);
  assert.deepEqual(geoCleanCredential('ipdata', { apiKey: ' abcdefgh12345678 ' }), { apiKey: 'abcdefgh12345678' });
  assert.equal(geoCleanCredential('ipdata', { apiKey: 'abcdefgh12345678', accountId: '1' }), null);
  assert.equal(geoCleanCredential('nope', { apiKey: 'abcdefgh12345678' }), null);
  assert.equal(geoCleanCredential('ipapi', 'abcdefgh12345678'), null);
});

test('credentials: each provider is kept or dropped on its own; an unexpected container is empty', () => {
  const good = { version: 1, items: { maxmind: { accountId: '123456', licenseKey: 'abcdefgh_12345678' }, ipdata: { apiKey: 'abcdefgh12345678' }, ipgeolocation: { apiKey: 'bad key' }, ipapi: { apiKey: 'abcdefgh12345678', extra: 1 }, other: { apiKey: 'abcdefgh12345678' } } };
  assert.deepEqual(normalizeGeoCredentials(good), { version: 1, items: { maxmind: { accountId: '123456', licenseKey: 'abcdefgh_12345678' }, ipdata: { apiKey: 'abcdefgh12345678' } } });
  for (const bad of [null, undefined, 'x', [], { version: 2, items: {} }, { version: 1 }, { version: 1, items: [] }, { version: 1, items: {}, extra: 1 }]) assert.deepEqual(normalizeGeoCredentials(bad), emptyGeoCredentials(), JSON.stringify(bad));
  assert.notEqual(emptyGeoCredentials(), emptyGeoCredentials());
});

test('provider state: enabled and keyed means ready; ip-api is also ready without a key once the plain-HTTP free endpoint is accepted', () => {
  const credentials = { version: 1, items: { maxmind: { accountId: '123456', licenseKey: 'abcdefgh_12345678' }, ipdata: { apiKey: 'abcdefgh12345678' } } };
  let settings = defaultGeoSettings();
  assert.deepEqual(geoProviderState(settings, credentials, 'maxmind'), { enabled: false, hasKey: true, ready: false, reason: 'disabled' });
  settings = geoSettingsPatch(settings, { providers: { maxmind: { enabled: true }, ipgeolocation: { enabled: true }, ipdata: { enabled: true }, ipapi: { enabled: true } } });
  assert.deepEqual(geoProviderState(settings, credentials, 'maxmind'), { enabled: true, hasKey: true, ready: true, reason: '' });
  assert.deepEqual(geoProviderState(settings, credentials, 'ipgeolocation'), { enabled: true, hasKey: false, ready: false, reason: 'no-key' });
  assert.deepEqual(geoProviderState(settings, credentials, 'ipapi'), { enabled: true, hasKey: false, ready: false, reason: 'http-not-allowed' });
  assert.deepEqual(geoReadyProviders(settings, credentials), ['maxmind', 'ipdata']);
  settings = geoSettingsPatch(settings, { providers: { ipapi: { http: true } } });
  assert.deepEqual(geoProviderState(settings, credentials, 'ipapi'), { enabled: true, hasKey: false, ready: true, reason: '' });
  assert.deepEqual(geoReadyProviders(settings, credentials), ['maxmind', 'ipdata', 'ipapi']);
  assert.deepEqual(geoReadyProviders(settings, emptyGeoCredentials()), ['ipapi']);
  assert.deepEqual(geoReadyProviders(defaultGeoSettings(), credentials), []);
  assert.deepEqual(geoProviderState(settings, credentials, 'nope'), { enabled: false, hasKey: false, ready: false, reason: 'disabled' });
});

test('records: a strict, canonical shape; anything off the shape is null', () => {
  const ok = normalizeGeoRecord(record(), NOW);
  assert.deepEqual(ok, record());
  assert.notEqual(ok, record());
  assert.notEqual(ok.flags, normalizeGeoRecord(record(), NOW).flags, 'fresh nested objects');
  assert.deepEqual(Object.keys(ok), ['provider', 'service', 'at', 'ip', 'country', 'countryName', 'region', 'city', 'timezone', 'asn', 'org', 'isp', 'kind', 'flags']);
  assert.deepEqual(Object.keys(ok.flags), GEO_FLAGS);
  assert.ok(normalizeGeoRecord(record({ provider: 'maxmind', service: 'geolite-city' }), NOW));
  assert.ok(normalizeGeoRecord(record({ asn: null, kind: '', country: '', countryName: '', region: '', city: '', timezone: '', org: '', flags: geoEmptyFlags() }), NOW));
  assert.ok(normalizeGeoRecord(record({ ip: '2001:4860:4860::8888' }), NOW));
  const bad = [
    { provider: 'maxmind', service: '' }, { provider: 'maxmind', service: 'enterprise' }, { provider: 'ipdata', service: 'geolite-city' }, { provider: 'other' },
    { at: -1 }, { at: 1.5 }, { at: NOW + 2 * DAY }, { at: '1' }, { ip: '10.0.0.1' }, { ip: 'example.com' }, { ip: '2001:4860:4860:0:0:0:0:8888' }, { ip: '::ffff:8.8.8.8' },
    { country: 'us' }, { country: 'USA' }, { country: 5 }, { countryName: 'x'.repeat(81) }, { city: 'A' + cp(0x202e) + 'B' }, { region: ' padded ' }, { org: 5 }, { isp: null },
    { timezone: 'bad zone' }, { timezone: 'A'.repeat(65) }, { asn: 0 }, { asn: 4294967296 }, { asn: '15169' }, { asn: 1.5 }, { kind: 'datacenter' }, { kind: null },
    { flags: null }, { flags: { ...geoEmptyFlags(), extra: true } }, { flags: { ...geoEmptyFlags(), proxy: 1 } }, { flags: { proxy: true } }, { extra: 1 },
  ];
  for (const patch of bad) assert.equal(normalizeGeoRecord(record(patch), NOW), null, JSON.stringify(patch));
  const missing = record(); delete missing.city;
  assert.equal(normalizeGeoRecord(missing, NOW), null);
  for (const value of [null, undefined, 'x', [], 5]) assert.equal(normalizeGeoRecord(value, NOW), null);
  assert.ok(GEO_KINDS.every(kind => normalizeGeoRecord(record({ kind }), NOW)));
  assert.equal(geoRecordHasData(ok), true);
  assert.equal(geoRecordHasData(normalizeGeoRecord(record({ asn: null, kind: '', country: '', countryName: '', region: '', city: '', timezone: '', org: '', flags: geoEmptyFlags() }), NOW)), false);
  assert.equal(geoRecordHasData(normalizeGeoRecord(record({ asn: null, kind: '', country: '', countryName: '', region: '', city: '', timezone: '', org: '', flags: { ...geoEmptyFlags(), tor: false } }), NOW)), true);
  assert.equal(geoRecordHasData(null), false);
});

test('cache: bounded, newest wins, old and mismatched records are dropped, fresh and stale are told apart', () => {
  let cache = emptyGeoCache();
  cache = geoCachePut(cache, record(), NOW);
  assert.deepEqual(Object.keys(cache.items), ['8.8.8.8']);
  const hit = geoCacheLookup(cache, '8.8.8.8', NOW);
  assert.equal(hit.fresh, true); assert.equal(hit.record.city, 'Ashburn');
  assert.equal(geoCacheLookup(cache, '::ffff:8.8.8.8', NOW).record.ip, '8.8.8.8', 'a mapped address finds the IPv4 entry');
  assert.equal(geoCacheLookup(cache, '9.9.9.9', NOW), null);
  assert.equal(geoCacheLookup(cache, 'example.com', NOW), null);
  assert.equal(geoCacheLookup(null, '8.8.8.8', NOW), null);
  assert.equal(geoCacheLookup(cache, '8.8.8.8', NOW + DAY + 5000).fresh, false, 'older than 24 hours is stale but still shown');
  assert.equal(geoCacheLookup(cache, '8.8.8.8', NOW + 31 * DAY), null, 'older than 30 days is gone');
  cache = geoCachePut(cache, record({ at: NOW, city: 'Newer' }), NOW);
  assert.equal(geoCacheLookup(cache, '8.8.8.8', NOW).record.city, 'Newer', 'the newest record of an address wins');
  assert.deepEqual(geoCachePut(cache, record({ ip: '10.0.0.1' }), NOW), cache, 'an invalid record changes nothing');
  assert.deepEqual(geoCachePut(cache, { nope: 1 }, NOW), cache);
  const wrongKey = { version: 1, items: { '1.1.1.1': record(), '8.8.8.8': record({ at: NOW - 40 * DAY }), '9.9.9.9': record({ ip: '9.9.9.9' }) } };
  assert.deepEqual(Object.keys(normalizeGeoCache(wrongKey, NOW).items), ['9.9.9.9'], 'a record under another key and an expired one are dropped');
  const many = { version: 1, items: {} };
  for (let index = 0; index < GEO_LIMITS.cacheEntries + 50; index++) { const ip = '11.' + (index >> 8) + '.' + (index & 255) + '.7'; many.items[ip] = record({ ip, at: NOW - index * 1000 }); }
  const trimmed = normalizeGeoCache(many, NOW);
  assert.equal(Object.keys(trimmed.items).length, GEO_LIMITS.cacheEntries);
  assert.ok(Object.hasOwn(trimmed.items, '11.0.0.7') && !Object.hasOwn(trimmed.items, '11.0.' + ((GEO_LIMITS.cacheEntries + 49) & 255) + '.7'), 'the newest entries stay');
  for (const bad of [null, 'x', [], { version: 2, items: {} }, { version: 1 }, { version: 1, items: [] }, { version: 1, items: {}, extra: 1 }]) assert.deepEqual(normalizeGeoCache(bad, NOW), emptyGeoCache());
});

test('the Intl tag: Wu Chinese has no Intl data and is formatted like Simplified Chinese; every other tag is unchanged', async () => {
  const { geoIntlTag } = await import('../../apps/production-extension/proxy-geo-shared.js');
  for (const tag of ['wuu', 'wuu-Hans', 'wuu_Hans', 'WUU']) assert.equal(geoIntlTag(tag), 'zh-Hans', tag);
  for (const tag of ['yue-Hans', 'yue', 'zh-CN', 'ru', 'en', 'pt-BR', 'wuux', 'awuu', '', undefined, null, 5]) assert.equal(geoIntlTag(tag), tag, String(tag));
  // The reason for the helper: the browser's own Intl does not know wuu, but it knows what the helper returns.
  assert.notEqual(new Intl.RelativeTimeFormat('wuu', { numeric: 'auto' }).resolvedOptions().locale === 'wuu', true);
  assert.equal(new Intl.RelativeTimeFormat(geoIntlTag('wuu-Hans'), { numeric: 'auto' }).resolvedOptions().locale, 'zh-Hans');
});
