// ADR-109: the pure view-model helpers of the Proxy manager's geolocation layer (apps/production-extension/proxy-geo-ui-model.js): the
// notice state machine and its dismissal, the columns, the exit address of a profile, every state of a row, the cell models, the mismatch
// rule, the zone clock, plural forms, label keys for every enum member, and the bulk-lookup targets. The rendering of these models is
// covered by the manager tests (proxy-ui.test.mjs) and proxy-geo-manager-native.mjs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  GEO_BANNER_KEY, readGeoBannerDismissed, writeGeoBannerDismissed, proxyGeoOn, proxyGeoReady, proxyGeoBannerState, proxyGeoColumns, proxyGeoProviderName, proxyGeoSourceName,
  proxyGeoExitIp, proxyGeoPublicExitIp, proxyGeoRowInfo, proxyGeoMismatch, proxyGeoLocation, proxyGeoNetwork, proxyGeoFlags, proxyGeoFlagState, proxyGeoZone, proxyGeoAge,
  proxyGeoKindKey, proxyGeoFlagKey, proxyGeoFlagTipKey, proxyGeoErrorKey, proxyGeoPluralKey, proxyGeoShowsFailure, proxyGeoLookupTargets,
} from '../../apps/production-extension/proxy-geo-ui-model.js';
import { GEO_COLUMNS, GEO_KINDS, GEO_FLAGS, GEO_ERRORS, GEO_LIMITS, defaultGeoSettings, geoEmptyFlags, normalizeGeoRecord } from '../../apps/production-extension/proxy-geo-shared.js';
import { GEO_MANAGER_LABELS } from '../../apps/production-extension/proxy-geo-manager-labels.js';

const NOW = Date.UTC(2026, 10, 6, 12, 0, 0), MINUTE = 60000, HOUR = 3600000;
const dictionary = entries => Object.assign(Object.create(null), entries);
const record = (patch = {}) => ({ provider: 'maxmind', service: 'geolite-city', at: NOW - 5 * MINUTE, ip: '8.8.8.8', country: 'US', countryName: 'United States', region: 'California', city: 'Mountain View', timezone: 'America/Los_Angeles', asn: 15169, org: 'Google LLC', isp: 'Google Fiber', kind: 'hosting', flags: { ...geoEmptyFlags(), hosting: true }, ...patch });
const state = (patch = {}) => ({ loaded: true, revision: 1, settings: { ...defaultGeoSettings(), enabled: true }, enabled: true, ready: true, readyProviders: ['maxmind'], hasCredentials: { maxmind: true }, providers: {}, records: dictionary({}), pending: dictionary({}), errors: dictionary({}), cacheCount: 0, ...patch });
const pass = (ip, patch = {}) => ({ diagnostic: { state: 'pass', reachable: true, remoteDns: true, tlsVerified: true, httpStatus: 200, ip, elapsedMs: 40, ...patch }, checkedAt: NOW });
const withRecord = (rec, over = {}) => state({ records: dictionary({ [rec.ip]: rec }), ...over });

test('the fixtures are real records: they pass the strict reader of the shared contract', () => {
  assert.ok(normalizeGeoRecord(record(), NOW));
  assert.ok(normalizeGeoRecord(record({ ip: '2606:4700:4700::1111', provider: 'ipapi', service: '', kind: '', flags: geoEmptyFlags() }), NOW));
});

test('the notice dismissal is one strict value in this page storage and never throws', () => {
  assert.equal(GEO_BANNER_KEY, 'proxy-geo-banner:v1');
  const store = new Map(), area = { getItem: key => store.has(key) ? store.get(key) : null, setItem: (key, value) => { store.set(key, value); } };
  assert.equal(readGeoBannerDismissed(area), false);
  assert.equal(writeGeoBannerDismissed(area), true);
  assert.equal(store.get(GEO_BANNER_KEY), '{"version":1,"dismissed":true}');
  assert.equal(readGeoBannerDismissed(area), true);
  for (const bad of ['1', 'true', '', 'null', '[]', '{', '{"version":1}', '{"version":1,"dismissed":false}', '{"version":2,"dismissed":true}', '{"version":1,"dismissed":"true"}', '{"version":1,"dismissed":true,"x":1}', '{"version":1,"dismissed":true}' + ' '.repeat(80)]) {
    store.set(GEO_BANNER_KEY, bad); assert.equal(readGeoBannerDismissed(area), false, 'not a dismissal: ' + JSON.stringify(bad.slice(0, 40)));
  }
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(readGeoBannerDismissed(blocked), false); assert.equal(writeGeoBannerDismissed(blocked), false);
  for (const nothing of [null, undefined, {}, 42]) { assert.equal(readGeoBannerDismissed(nothing), false); assert.equal(writeGeoBannerDismissed(nothing), false); }
});

test('the notice state machine: invite while off (dismissible), a reminder while on without a provider (not dismissible), nothing otherwise', () => {
  const cases = [
    [null, false, 'hidden'], [undefined, false, 'hidden'], [{}, false, 'hidden'], [{ loaded: false, enabled: false }, false, 'hidden'], [{ loaded: false, enabled: true, ready: true }, false, 'hidden'],
    [{ loaded: true, enabled: false, ready: false }, false, 'invite'], [{ loaded: true, enabled: false, ready: false }, true, 'hidden'],
    [{ loaded: true, enabled: true, ready: false }, false, 'not-ready'], [{ loaded: true, enabled: true, ready: false }, true, 'not-ready'],
    [{ loaded: true, enabled: true, ready: true }, false, 'hidden'], [{ loaded: true, enabled: true, ready: true }, true, 'hidden'],
    [{ loaded: 1, enabled: false }, false, 'hidden'], [{ loaded: true, enabled: 'yes' }, false, 'invite'],
  ];
  for (const [value, dismissed, expected] of cases) assert.equal(proxyGeoBannerState(value, dismissed), expected, JSON.stringify(value) + ' dismissed=' + dismissed);
  assert.equal(proxyGeoBannerState({ loaded: true, enabled: false }), 'invite', 'dismissal defaults to not dismissed');
  assert.equal(proxyGeoBannerState({ loaded: true, enabled: false }, 'true'), 'invite', 'only the boolean true dismisses');
  assert.equal(proxyGeoOn({ loaded: true, enabled: true }), true); assert.equal(proxyGeoOn({ loaded: true, enabled: false }), false); assert.equal(proxyGeoOn({ loaded: false, enabled: true }), false); assert.equal(proxyGeoOn(null), false);
  assert.equal(proxyGeoReady({ loaded: true, enabled: true, ready: true }), true); assert.equal(proxyGeoReady({ loaded: true, enabled: true, ready: false }), false); assert.equal(proxyGeoReady({ loaded: true, enabled: false, ready: true }), false);
});

test('the columns shown are the user selection in canonical order, and none while the feature is off or unread', () => {
  const on = columns => state({ settings: { ...defaultGeoSettings(), enabled: true, columns } });
  assert.deepEqual(proxyGeoColumns(on([...GEO_COLUMNS])), ['geo', 'geonet', 'geokind', 'geoflags', 'geotime']);
  assert.deepEqual(proxyGeoColumns(on(['geotime', 'geo', 'geo', 'nope', 7])), ['geo', 'geotime']);
  assert.deepEqual(proxyGeoColumns(on([])), []);
  assert.deepEqual(proxyGeoColumns(state({ settings: { columns: 'geo' } })), []);
  assert.deepEqual(proxyGeoColumns(state({ settings: null })), []);
  assert.deepEqual(proxyGeoColumns(state({ enabled: false })), []); assert.deepEqual(proxyGeoColumns(state({ loaded: false })), []); assert.deepEqual(proxyGeoColumns(null), []);
  assert.deepEqual([...GEO_COLUMNS], ['geo', 'geonet', 'geokind', 'geoflags', 'geotime']);
});

test('the exit IP is the canonical address of a PASSING check; only a public one may ever be looked up', () => {
  assert.equal(proxyGeoExitIp(pass('8.8.8.8')), '8.8.8.8');
  assert.equal(proxyGeoExitIp(pass('2606:4700:4700:0:0:0:0:1111')), '2606:4700:4700::1111', 'IPv6 is canonical');
  assert.equal(proxyGeoExitIp(pass('2606:4700:4700::1111'.toUpperCase())), '2606:4700:4700::1111');
  assert.equal(proxyGeoExitIp(pass('::ffff:8.8.4.4')), '8.8.4.4', 'a mapped IPv4 address is the plain one');
  for (const check of [null, undefined, {}, { diagnostic: null }, { diagnostic: { state: 'fail', code: 'auth-failed' } }, { diagnostic: { state: 'fail', ip: '8.8.8.8' } }, pass(null), pass(''), pass(8), pass('example.com'), pass('8.8.8.8:80'), pass('[::1]'), pass('8.8.8.8/32'), pass({ toString: () => '8.8.8.8' })]) assert.equal(proxyGeoExitIp(check), '', JSON.stringify(check));
  const privateRanges = ['10.0.0.5', '172.16.4.4', '192.168.1.1', '127.0.0.1', '100.64.0.1', '169.254.1.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '203.0.113.9', '198.51.100.7', '192.0.2.1', '198.18.0.1', '::1', 'fd00::1', 'fe80::1', '2001:db8::1', '::'];
  for (const ip of privateRanges) { assert.notEqual(proxyGeoExitIp(pass(ip)), '', ip + ' is a valid address'); assert.equal(proxyGeoPublicExitIp(pass(ip)), '', ip + ' is never looked up'); }
  for (const ip of ['8.8.8.8', '1.1.1.1', '9.9.9.9', '94.140.14.14', '2606:4700:4700::1111']) assert.equal(proxyGeoPublicExitIp(pass(ip)), ip);
  assert.equal(proxyGeoPublicExitIp({ diagnostic: { state: 'fail', ip: '8.8.8.8' } }), '');
});

test('a row is in exactly one phase: no address, private, empty, pending, error, no data, data (fresh or stale)', () => {
  const profile = { id: 'p', country: 'DE' };
  const row = (check, over = {}) => proxyGeoRowInfo({ state: state(), check, profile, now: NOW, ...over });
  for (const check of [null, { diagnostic: { state: 'fail', code: 'timeout' } }, pass(null), pass('nonsense')]) { const info = row(check); assert.equal(info.phase, 'no-ip'); assert.equal(info.ip, ''); assert.equal(info.canLookup, false); assert.equal(info.publicIp, false); assert.equal(info.record, null); }
  for (const ip of ['10.1.1.1', '203.0.113.9', 'fd00::5']) { const info = row(pass(ip)); assert.equal(info.phase, 'private', ip); assert.equal(info.canLookup, false, 'a private address offers no lookup'); assert.equal(info.publicIp, false); }
  const empty = row(pass('8.8.8.8')); assert.deepEqual([empty.phase, empty.canLookup, empty.pending, empty.error, empty.stale, empty.ip, empty.tag], ['empty', true, false, '', false, '8.8.8.8', 'DE']);
  assert.equal(row(pass('8.8.8.8'), { state: state({ ready: false }) }).canLookup, false, 'no ready provider: no lookup offered');
  assert.equal(row(pass('8.8.8.8'), { state: state({ enabled: false }) }).canLookup, false);
  const pending = row(pass('8.8.8.8'), { state: state({ pending: dictionary({ '8.8.8.8': true }) }) }); assert.deepEqual([pending.phase, pending.pending], ['empty', true]);
  const failed = row(pass('8.8.8.8'), { state: state({ errors: dictionary({ '8.8.8.8': { code: 'quota', at: NOW - MINUTE } }) }) }); assert.deepEqual([failed.phase, failed.error], ['error', 'quota']);
  const retrying = row(pass('8.8.8.8'), { state: state({ errors: dictionary({ '8.8.8.8': { code: 'quota', at: NOW - MINUTE } }), pending: dictionary({ '8.8.8.8': true }) }) }); assert.deepEqual([retrying.phase, retrying.pending], ['empty', true], 'a retry in flight shows busy, not the old error');
  for (const code of ['nonsense', 7, null, '']) assert.equal(row(pass('8.8.8.8'), { state: state({ errors: dictionary({ '8.8.8.8': { code, at: NOW } }) }) }).phase, 'empty', 'an unknown error code is ignored: ' + String(code));
  assert.equal(row(pass('8.8.8.8'), { state: state({ errors: dictionary({ '8.8.8.8': { code: 'quota', at: NOW - GEO_LIMITS.errorMemoryMs - 1 } }) }) }).phase, 'empty', 'an old error is forgotten');
  assert.equal(row(pass('8.8.8.8'), { state: state({ errors: dictionary({ '8.8.8.8': { code: 'quota', at: NOW + 5 * MINUTE } }) }) }).error, 'quota', 'a failure stamped after the last clock tick is current');
  assert.deepEqual(row(pass('8.8.8.8'), { failures: { '8.8.8.8': { code: 'timeout', at: NOW - MINUTE } } }), { ...failedShape('timeout'), phase: 'error' }, 'a failure of a lookup started on this page is shown');
  assert.equal(row(pass('8.8.8.8'), { state: state({ errors: dictionary({ '8.8.8.8': { code: 'quota', at: NOW } }) }), failures: { '8.8.8.8': { code: 'timeout', at: NOW } } }).error, 'quota', 'a tie goes to the controller memory');
  assert.equal(row(pass('8.8.8.8'), { state: state({ errors: dictionary({ '8.8.8.8': { code: 'not-found', at: NOW - 5 * MINUTE } }) }), failures: { '8.8.8.8': { code: 'server', at: NOW - MINUTE } } }).error, 'server', 'a newer failure of a lookup started here wins over an older remembered one');
  assert.equal(row(pass('8.8.8.8'), { state: state({ errors: dictionary({ '8.8.8.8': { code: 'not-found', at: NOW - MINUTE } }) }), failures: { '8.8.8.8': { code: 'server', at: NOW - 5 * MINUTE } } }).error, 'not-found', 'and the other way round');
  assert.equal(row(pass('8.8.8.8'), { failures: { '8.8.8.8': { code: 'timeout', at: NOW - GEO_LIMITS.errorMemoryMs } } }).phase, 'empty');
  const fresh = row(pass('8.8.8.8'), { state: withRecord(record()) }); assert.deepEqual([fresh.phase, fresh.stale, fresh.ageMs, fresh.canLookup], ['data', false, 5 * MINUTE, true]); assert.equal(fresh.record.city, 'Mountain View');
  const edge = row(pass('8.8.8.8'), { state: withRecord(record({ at: NOW - GEO_LIMITS.freshMs })) }); assert.equal(edge.stale, false, 'exactly 24 hours is still fresh');
  const stale = row(pass('8.8.8.8'), { state: withRecord(record({ at: NOW - GEO_LIMITS.freshMs - 1 })) }); assert.deepEqual([stale.phase, stale.stale], ['data', true]);
  const refreshing = row(pass('8.8.8.8'), { state: withRecord(record(), { pending: dictionary({ '8.8.8.8': true }) }) }); assert.deepEqual([refreshing.phase, refreshing.pending], ['data', true], 'a stored record stays visible while it is refreshed');
  const refreshFailed = row(pass('8.8.8.8'), { state: withRecord(record(), { errors: dictionary({ '8.8.8.8': { code: 'server', at: NOW } }) }) }); assert.deepEqual([refreshFailed.phase, refreshFailed.error], ['data', 'server'], 'a failed refresh keeps the record and reports the error');
  const nothing = record({ country: '', countryName: '', region: '', city: '', timezone: '', asn: null, org: '', isp: '', kind: '', flags: geoEmptyFlags() });
  assert.equal(row(pass('8.8.8.8'), { state: withRecord(nothing) }).phase, 'nodata');
  const v6 = record({ ip: '2606:4700:4700::1111' }); assert.equal(row(pass('2606:4700:4700:0:0:0:0:1111'), { state: withRecord(v6) }).phase, 'data', 'records are found by the canonical address');
  assert.equal(row(pass('8.8.8.8'), { state: state({ records: Object.create({ '8.8.8.8': record() }) }) }).phase, 'empty', 'only own properties are records');
  assert.equal(row(pass('8.8.8.8'), { state: null }).phase, 'empty'); assert.equal(row(pass('8.8.8.8'), { state: null }).canLookup, false);
  assert.equal(row(pass('8.8.8.8'), { now: undefined, state: withRecord(record()) }).stale, false);
});
function failedShape(code) { return { ip: '8.8.8.8', publicIp: true, record: null, stale: false, ageMs: 0, pending: false, error: code, canLookup: true, tag: 'DE' }; }

test('the mismatch rule compares the user tag with the provider country, and only then', () => {
  const rec = country => ({ country });
  for (const [tag, country, expected] of [['DE', 'DE', false], ['de', 'DE', false], ['DE', 'US', true], ['us', 'DE', true], ['', 'US', false], ['DE', '', false], ['', '', false], ['DEU', 'DE', false], ['D', 'DE', false], [undefined, 'DE', false], [null, 'DE', false], [7, 'DE', false], ['DE', 'de', false], ['DE', undefined, false]]) assert.equal(proxyGeoMismatch(tag, rec(country)), expected, JSON.stringify([tag, country]));
  assert.equal(proxyGeoMismatch('DE', null), false);
  assert.equal(proxyGeoLocation(record(), 'DE').mismatch, true); assert.equal(proxyGeoLocation(record(), 'US').mismatch, false); assert.equal(proxyGeoLocation(record()).mismatch, false);
});

test('cell models: location, network, flags and the single flag states', () => {
  const place = proxyGeoLocation(record(), 'US'); assert.deepEqual(place, { city: 'Mountain View', region: 'California', countryName: 'United States', country: 'US', hasPlace: true, mismatch: false, tag: 'US' });
  assert.equal(proxyGeoLocation(record({ city: '', region: '' })).hasPlace, false); assert.equal(proxyGeoLocation(record({ city: '' })).hasPlace, true); assert.equal(proxyGeoLocation(null).hasPlace, false);
  assert.deepEqual(proxyGeoNetwork(record()), { asn: 'AS15169', org: 'Google LLC', isp: 'Google Fiber', name: 'Google LLC', showIsp: true, empty: false });
  assert.deepEqual(proxyGeoNetwork(record({ isp: 'Google LLC' })), { asn: 'AS15169', org: 'Google LLC', isp: 'Google LLC', name: 'Google LLC', showIsp: false, empty: false }, 'the same name is not repeated');
  assert.deepEqual(proxyGeoNetwork(record({ org: '', isp: 'Only ISP' })), { asn: 'AS15169', org: '', isp: 'Only ISP', name: 'Only ISP', showIsp: false, empty: false }, 'the ISP stands in for a missing organisation');
  assert.deepEqual(proxyGeoNetwork(record({ asn: null, org: '', isp: '' })), { asn: '', org: '', isp: '', name: '', showIsp: false, empty: true });
  assert.equal(proxyGeoNetwork(record({ asn: 0 })).asn, 'AS0', 'whatever integer the record holds is shown as is'); assert.equal(proxyGeoNetwork(record({ asn: null })).asn, ''); assert.equal(proxyGeoNetwork(null).empty, true);
  const some = proxyGeoFlags(record({ flags: { ...geoEmptyFlags(), proxy: true, vpn: false, tor: true } })); assert.deepEqual(some, { active: ['proxy', 'tor'], reported: ['proxy', 'vpn', 'tor'], state: 'chips' });
  const clear = proxyGeoFlags(record({ flags: { ...geoEmptyFlags(), proxy: false, hosting: false } })); assert.deepEqual([clear.state, clear.active, clear.reported], ['clear', [], ['proxy', 'hosting']], 'reported and none true');
  const none = proxyGeoFlags(record({ flags: geoEmptyFlags() })); assert.deepEqual([none.state, none.active, none.reported], ['unreported', [], []], 'every flag null: the provider or plan reports none');
  assert.equal(proxyGeoFlags(null).state, 'unreported'); assert.deepEqual(proxyGeoFlags(record({ flags: Object.fromEntries(GEO_FLAGS.map(flag => [flag, true])) })).active, [...GEO_FLAGS], 'chips follow the catalogue order');
  const flags = record({ flags: { ...geoEmptyFlags(), proxy: true, vpn: false } }); assert.deepEqual(['proxy', 'vpn', 'tor'].map(flag => proxyGeoFlagState(flags, flag)), ['yes', 'no', 'unreported']); assert.equal(proxyGeoFlagState(null, 'proxy'), 'unreported');
});

test('the zone clock is computed with Intl only: UTC offset (including half and three-quarter hours, DST) and the local time in the UI language', () => {
  const JAN = Date.UTC(2026, 0, 15, 12, 0, 0), JUL = Date.UTC(2026, 6, 15, 12, 0, 0);
  const read = (zone, at, tag) => { const value = proxyGeoZone(zone, at, tag); return value && [value.offset, value.minutes]; };
  assert.deepEqual(read('Europe/Berlin', JAN), ['UTC+01:00', 60]); assert.deepEqual(read('Europe/Berlin', JUL), ['UTC+02:00', 120]);
  assert.deepEqual(read('America/New_York', JAN), ['UTC-05:00', -300]); assert.deepEqual(read('America/New_York', JUL), ['UTC-04:00', -240]);
  assert.deepEqual(read('Asia/Kolkata', JAN), ['UTC+05:30', 330]); assert.deepEqual(read('Asia/Kathmandu', JAN), ['UTC+05:45', 345]); assert.deepEqual(read('Pacific/Chatham', JAN), ['UTC+13:45', 825]);
  assert.deepEqual(read('UTC', JAN), ['UTC+00:00', 0]); assert.deepEqual(read('Etc/GMT+3', JAN), ['UTC-03:00', -180]); assert.deepEqual(read('Asia/Tokyo', JUL), ['UTC+09:00', 540]);
  const berlin = proxyGeoZone('Europe/Berlin', JAN, 'de'); assert.equal(berlin.time, '13:00'); assert.equal(berlin.zone, 'Europe/Berlin');
  assert.match(proxyGeoZone('Europe/Berlin', JAN, 'en').time, /^1:00\s?PM$/u); assert.equal(proxyGeoZone('Europe/Berlin', JAN, 'ru').time, '13:00');
  assert.equal(proxyGeoZone('Europe/Berlin', JAN + 59 * 1000, 'de').time, '13:00', 'seconds do not move the minute'); assert.equal(proxyGeoZone('Europe/Berlin', JAN + 60 * 1000, 'de').time, '13:01');
  assert.match(proxyGeoZone('Europe/Berlin', JAN, '@@not-a-language').time, /1:00\s?PM/u, 'an unusable language tag falls back to English instead of throwing');
  for (const zone of ['Not/AZone', '', null, undefined, 7, 'x'.repeat(100), 'Europe/Berlin' + String.fromCharCode(0)]) assert.equal(proxyGeoZone(zone, JAN), null, 'unknown zone: ' + String(zone).slice(0, 20));
  for (const at of [NaN, Infinity, undefined, null, 'now']) assert.equal(proxyGeoZone('Europe/Berlin', at), null, 'no valid instant: ' + String(at));
});

test('the age of a record uses the UI language and says nothing without a record', () => {
  assert.match(proxyGeoAge(record({ at: NOW - 5 * MINUTE }), NOW, 'en'), /5/); assert.equal(proxyGeoAge(null, NOW, 'en'), ''); assert.equal(proxyGeoAge(record(), NaN, 'en'), '');
  assert.notEqual(proxyGeoAge(record({ at: NOW - 3 * HOUR }), NOW, 'en'), proxyGeoAge(record({ at: NOW - 3 * HOUR }), NOW, 'ru'));
});

test('the sources and providers are named from the catalogue, never from provider text', () => {
  assert.equal(proxyGeoSourceName(record()), 'MaxMind GeoIP / GeoLite (GeoLite City)'); assert.equal(proxyGeoSourceName(record({ service: 'geoip-insights' })), 'MaxMind GeoIP / GeoLite (GeoIP Insights)');
  assert.equal(proxyGeoSourceName(record({ provider: 'ipdata', service: '' })), 'ipdata'); assert.equal(proxyGeoSourceName(record({ provider: 'ipapi', service: '' })), 'ip-api.com');
  assert.equal(proxyGeoSourceName({ provider: 'constructor' }), ''); assert.equal(proxyGeoSourceName(null), '');
  assert.equal(proxyGeoProviderName({ readyProviders: ['ipdata', 'maxmind'] }), 'ipdata'); assert.equal(proxyGeoProviderName({ readyProviders: [] }), ''); assert.equal(proxyGeoProviderName({ readyProviders: ['__proto__'] }), ''); assert.equal(proxyGeoProviderName(null), '');
});

test('every enum member has a label key and a label in every language written so far', () => {
  for (const [locale, table] of Object.entries(GEO_MANAGER_LABELS)) {
    for (const kind of GEO_KINDS) assert.equal(typeof table[proxyGeoKindKey(kind)], 'string', locale + ' kind ' + kind);
    assert.equal(typeof table[proxyGeoKindKey('')], 'string'); assert.equal(proxyGeoKindKey('nonsense'), 'kind_unknown'); assert.equal(proxyGeoKindKey(''), 'kind_unknown');
    for (const flag of GEO_FLAGS) { assert.equal(typeof table[proxyGeoFlagKey(flag)], 'string', locale + ' flag ' + flag); assert.equal(typeof table[proxyGeoFlagTipKey(flag, 'maxmind')], 'string', locale + ' tip ' + flag); }
    assert.equal(proxyGeoFlagTipKey('proxy', 'ipapi'), 'flag_proxy_ipapi_tip'); assert.equal(proxyGeoFlagTipKey('vpn', 'ipapi'), 'flag_vpn_tip', 'only the proxy flag of ip-api carries the extra note'); assert.equal(typeof table.flag_proxy_ipapi_tip, 'string');
    for (const code of GEO_ERRORS) assert.equal(typeof table[proxyGeoErrorKey(code)], 'string', locale + ' error ' + code);
    for (const column of GEO_COLUMNS) assert.equal(typeof table['col_' + column], 'string', locale + ' column ' + column);
  }
  assert.equal(proxyGeoErrorKey('rate-limited'), 'error_rate_limited'); assert.equal(proxyGeoErrorKey('nonsense'), 'error_bad_response'); assert.equal(proxyGeoErrorKey(undefined), 'error_bad_response');
  assert.equal(new Set(GEO_ERRORS.map(proxyGeoErrorKey)).size, GEO_ERRORS.length, 'one key per code');
});

test('plural forms: the language category picks the key, with "other" as the fallback', () => {
  for (const [count, expected] of [[1, 'one'], [2, 'few'], [4, 'few'], [5, 'many'], [11, 'many'], [21, 'one'], [22, 'few'], [0, 'many'], [1.5, 'other']]) assert.equal(proxyGeoPluralKey('confirm', count, 'ru'), 'confirm_' + expected, 'ru ' + count);
  assert.equal(proxyGeoPluralKey('confirm', 1, 'en'), 'confirm_one'); assert.equal(proxyGeoPluralKey('confirm', 2, 'en'), 'confirm_other');
  assert.equal(proxyGeoPluralKey('confirm', 1, 'en', key => key === 'confirm_other'), 'confirm_other', 'a language without the form falls back to other');
  assert.equal(proxyGeoPluralKey('confirm', 3, '@@bad'), 'confirm_other'); assert.equal(proxyGeoPluralKey('confirm', 1), 'confirm_one');
  // As the UI asks it: a category without its own key (Arabic zero and two) falls back to the table's 'other' form.
  for (const [locale, table] of Object.entries(GEO_MANAGER_LABELS)) for (const count of [0, 1, 2, 3, 5, 11, 21, 100, 1.5]) assert.equal(typeof table[proxyGeoPluralKey('confirm', count, locale, key => Object.hasOwn(table, key))], 'string', locale + ' ' + count);
});

test('only provider or answer problems are shown as failures; local set-up and private addresses are explained elsewhere', () => {
  for (const code of ['unauthorized', 'forbidden', 'plan', 'quota', 'rate-limited', 'not-found', 'timeout', 'network', 'server', 'bad-response']) assert.equal(proxyGeoShowsFailure(code), true, code);
  for (const code of ['disabled', 'no-provider', 'no-key', 'http-not-allowed', 'not-public', 'nonsense', undefined, 7]) assert.equal(proxyGeoShowsFailure(code), false, String(code));
});

test('"look up all" targets: distinct public addresses without a fresh record or a running lookup, in list order, bounded', () => {
  const profiles = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }, { id: 'f' }, { id: 'g' }, { id: 'h' }, { id: 'i' }];
  const checks = { a: pass('8.8.8.8'), b: pass('8.8.8.8'), c: pass('1.1.1.1'), d: pass('9.9.9.9'), e: pass('10.0.0.1'), f: { diagnostic: { state: 'fail', code: 'timeout' } }, g: pass('2606:4700:4700:0:0:0:0:1111'), h: pass('2606:4700:4700::1111'), i: pass('94.140.14.14') };
  const targets = over => proxyGeoLookupTargets({ profiles, checks, state: state(), now: NOW, ...over });
  assert.deepEqual(targets(), ['8.8.8.8', '1.1.1.1', '9.9.9.9', '2606:4700:4700::1111', '94.140.14.14'], 'two profiles with one exit IP count once; private, failed and duplicate spellings are left out');
  assert.deepEqual(targets({ state: withRecord(record({ ip: '1.1.1.1', at: NOW - HOUR })) }), ['8.8.8.8', '9.9.9.9', '2606:4700:4700::1111', '94.140.14.14'], 'a fresh record needs no lookup');
  assert.ok(targets({ state: withRecord(record({ ip: '1.1.1.1', at: NOW - GEO_LIMITS.freshMs - 1 })) }).includes('1.1.1.1'), 'a stale record is asked again');
  assert.ok(!targets({ state: state({ pending: dictionary({ '9.9.9.9': true }) }) }).includes('9.9.9.9'), 'a running lookup is not started twice');
  assert.ok(targets({ state: state({ errors: dictionary({ '9.9.9.9': { code: 'quota', at: NOW } }) }) }).includes('9.9.9.9'), 'an address that failed is tried again when the person asks');
  assert.deepEqual(targets({ state: state({ ready: false }) }), [], 'nothing is sent without a ready provider'); assert.deepEqual(targets({ state: state({ enabled: false }) }), []); assert.deepEqual(targets({ state: null }), []);
  assert.deepEqual(targets({ profiles: null }), []); assert.deepEqual(targets({ checks: null }), []); assert.deepEqual(targets({ profiles: [null, undefined, {}] }), []);
  const many = Array.from({ length: 400 }, (_, index) => ({ id: 'p' + index })), manyChecks = Object.fromEntries(many.map((profile, index) => [profile.id, pass('8.' + (index % 250) + '.' + Math.floor(index / 250) + '.9')]));
  assert.ok(proxyGeoLookupTargets({ profiles: many, checks: manyChecks, state: state(), now: NOW }).length <= GEO_LIMITS.cacheEntries, 'one click is bounded by the size of the cache');
  const hostile = { constructor: pass('8.8.8.8') }; assert.deepEqual(proxyGeoLookupTargets({ profiles: [{ id: 'constructor' }, { id: 'toString' }], checks: {}, state: state(), now: NOW }), [], 'prototype members are not check results');
  assert.deepEqual(proxyGeoLookupTargets({ profiles: [{ id: 'constructor' }], checks: hostile, state: state(), now: NOW }), ['8.8.8.8'], 'an own property is');
});

test('the helper modules reach no network and never write markup', () => {
  const dir = new URL('../../apps/production-extension/', import.meta.url);
  const FORBIDDEN = /\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts)\b|innerHTML|outerHTML|insertAdjacentHTML|dangerouslySetInnerHTML|document\.write|\beval\s*\(|new\s+Function\b|https?:\/\//u;
  for (const file of ['proxy-geo-ui-model.js', 'proxy-geo-manager-labels.js']) assert.doesNotMatch(readFileSync(new URL(file, dir), 'utf8'), FORBIDDEN, file);
  const NETWORK = /\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource)\b\s*\(|new\s+(XMLHttpRequest|WebSocket|EventSource)\b|innerHTML|outerHTML|insertAdjacentHTML|dangerouslySetInnerHTML|document\.write|\beval\s*\(|new\s+Function\b/u;
  for (const file of ['proxy-ui.js', 'proxy-list-ui.js', 'proxy-peek-ui.js']) assert.doesNotMatch(readFileSync(new URL(file, dir), 'utf8'), NETWORK, file + ' has no network call and no markup injection');
});
