// ADR-107 round 5: the proxy-country-region hint. The country tag of the connected or linked proxy is the user's own note; the hint says only
// that the applied rows point to another region, offers «Match region» through the existing region machinery, and never claims where the proxy is.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApiConfiguration } from '../../apps/production-extension/api-configuration.js';
import { fingerprintProfileIssues, editFingerprintRow, issueFix, generateConsistentDevice, proxyCountryOf, FINGERPRINT_ISSUE_CODES, FIXABLE_ISSUES } from '../../apps/production-extension/fingerprint-profiles.js';
import { placeIssues, issueTarget, LEVEL_FIELDS } from '../../apps/production-extension/fingerprint-field-hints.js';
import { FINGERPRINT_DEVICE_KEYS, FINGERPRINT_DEVICE_LABELS } from '../../apps/production-extension/fingerprint-device-labels.js';
import { fillIssueDetail, withProxyCountry } from '../../apps/production-extension/fingerprint-library-ui.js';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';

const rowsOf = list => list.reduce((config, [id, value]) => editFingerprintRow(config, id, { mode: 'custom', selected: { kind: 'value', value } }), createApiConfiguration());
const TOKYO = [['timezone', { timeZone: 'Asia/Tokyo', offsetMinutes: -540 }], ['navigator-language', 'ja-JP'], ['geolocation', { latitude: 35.6762, longitude: 139.6503, accuracy: 25 }]];
const BERLIN = [['timezone', { timeZone: 'Europe/Berlin', offsetMinutes: -60 }], ['navigator-language', 'de-DE'], ['geolocation', { latitude: 52.52, longitude: 13.405, accuracy: 25 }]];
const proxy = (country, state = 'connected') => ({ proxy: { state, country } });
const found = (rows, environment) => fingerprintProfileIssues(rowsOf(rows), environment).find(issue => issue.code === 'proxy-country-region');

test('proxyCountryOf accepts only an uppercase two-letter code that the offline region table knows, read as plain data', () => {
  assert.equal(proxyCountryOf(proxy('DE')), 'DE'); assert.equal(proxyCountryOf({ proxy: { country: 'JP' } }), 'JP');
  for (const bad of [undefined, null, {}, { proxy: null }, { proxy: {} }, proxy('de'), proxy('D'), proxy('DEU'), proxy('XX'), proxy('ZZ'), proxy(''), proxy(5), proxy(['DE']), proxy({ toString: () => 'DE' }), 'DE', 5]) assert.equal(proxyCountryOf(bad), null, JSON.stringify(bad));
  let ran = false; const accessor = { proxy: {} }; Object.defineProperty(accessor.proxy, 'country', { enumerable: true, get() { ran = true; return 'DE'; } });
  assert.equal(proxyCountryOf(accessor), null); assert.equal(ran, false, 'an accessor is never invoked');
});

test('raised as a warning when the zone or the coordinates point elsewhere, with the country as detail and the conflicting rows named', () => {
  const zone = found([TOKYO[0]], proxy('DE')); assert.equal(zone.severity, 'warning'); assert.deepEqual(zone.ids, ['timezone']); assert.deepEqual(zone.detail, { country: 'DE' });
  const place = found([TOKYO[2]], proxy('DE')); assert.equal(place.severity, 'warning'); assert.deepEqual(place.ids, ['geolocation']);
  const all = found(TOKYO, proxy('DE')); assert.deepEqual(all.ids, ['timezone', 'geolocation', 'navigator-language']); assert.equal(all.severity, 'warning');
  assert.deepEqual(found([['intl-formatting', { timeZone: 'America/New_York' }]], proxy('DE')).ids, ['intl-formatting'], 'the zone of the Intl row counts when there is no legacy timezone row');
  assert.equal(found(BERLIN, proxy('JP')).severity, 'warning'); assert.equal(found(BERLIN, proxy('JP')).detail.country, 'JP');
});

test('only the language disagreeing is information, not a warning', () => {
  const language = found([['navigator-language', 'ja-JP']], proxy('DE')); assert.equal(language.severity, 'info'); assert.deepEqual(language.ids, ['navigator-language']);
  assert.equal(found([TOKYO[0], ['navigator-language', 'ja-JP']], proxy('DE')).severity, 'warning', 'with a disagreeing zone it is a warning again'); assert.equal(found([BERLIN[0], ['navigator-language', 'ja-JP']], proxy('DE')).severity, 'info', 'a matching zone leaves the language alone as the only reason');
  assert.equal(found([['navigator-language', 'de-AT']], proxy('DE')), undefined, 'the base language is what counts'); assert.equal(found([['navigator-language', 'en-US']], proxy('DE')), undefined, 'English is in every region list');
});

test('silent without a country, without rows, for a matching region, for a zone no region lists and for coordinates near any zone of the country', () => {
  assert.equal(found(TOKYO, undefined), undefined); assert.equal(found(TOKYO, {}), undefined); assert.equal(found(TOKYO, { proxy: { state: 'connected' } }), undefined, 'no tag, no hint');
  assert.equal(found(TOKYO, proxy('de')), undefined, 'a malformed tag is no tag'); assert.equal(found(TOKYO, proxy('XX')), undefined);
  assert.equal(found([], proxy('DE')), undefined, 'rows that are not set imply nothing (that is proxy-locale-host)');
  assert.equal(found(BERLIN, proxy('DE')), undefined); assert.equal(found(TOKYO, proxy('JP')), undefined);
  assert.equal(found([['timezone', { timeZone: 'UTC', offsetMinutes: 0 }]], proxy('DE')), undefined, 'UTC names no place');
  assert.equal(found([['timezone', { timeZone: 'Europe/Busingen', offsetMinutes: -60 }]], proxy('DE')), undefined, 'every zone of the country counts');
  assert.equal(found([['timezone', { timeZone: 'Asia/Calcutta', offsetMinutes: -330 }]], proxy('IN')), undefined, 'a zone alias is the same zone');
  assert.equal(found([['timezone', { timeZone: 'Asia/Kolkata', offsetMinutes: -330 }]], proxy('IN')), undefined);
  assert.equal(found([['geolocation', { latitude: 34.05, longitude: -118.24, accuracy: 25 }]], proxy('US')), undefined, 'Los Angeles is near a zone of the US');
  assert.equal(found([['geolocation', { latitude: 48.1351, longitude: 11.582, accuracy: 25 }]], proxy('DE')), undefined);
  assert.equal(found([['geolocation', { latitude: 55.7558, longitude: 37.6173, accuracy: 25 }]], proxy('DE')), undefined, 'Moscow is within 2500 km of Berlin: the same distance rule as the zone check');
});

test('the hint needs only the tag from the environment: the older snapshot, the connected state and a linked country all reach it', () => {
  assert.ok(found(TOKYO, { userAgent: 'x', proxy: { state: 'disconnected', country: 'DE' } }), 'a linked (not connected) proxy');
  assert.ok(found(TOKYO, withProxyCountry({ proxy: { state: 'connected' }, uaMajor: 156 }, 'DE')), 'the library overlays the linked proxy country on the environment');
  assert.equal(withProxyCountry({ uaMajor: 156 }, 'DE').proxy.state, 'unknown'); assert.equal(withProxyCountry({ proxy: { state: 'connected', country: 'JP' } }, 'DE').proxy.country, 'DE', 'the linked one wins');
  const environment = { uaMajor: 156 }; assert.equal(withProxyCountry(environment, 'DE'), withProxyCountry(environment, 'DE'), 'identity-stable, so the fit memo is not recomputed per row');
  assert.equal(withProxyCountry(environment, null), environment); assert.equal(withProxyCountry(environment, undefined), environment); assert.equal(withProxyCountry(null, 'DE'), null);
  // The generator returns its issues through the normalized environment: the tag survives that path.
  const result = generateConsistentDevice(createApiConfiguration(), { region: 'JP', environment: proxy('DE') }, {});
  assert.ok(result.issues.some(issue => issue.code === 'proxy-country-region'), 'second argument path'); assert.ok(generateConsistentDevice(createApiConfiguration(), { region: 'JP' }, proxy('DE')).issues.some(issue => issue.code === 'proxy-country-region'), 'first argument path');
  assert.ok(!generateConsistentDevice(createApiConfiguration(), { region: 'DE', environment: proxy('DE') }, {}).issues.some(issue => issue.code === 'proxy-country-region'));
  assert.ok(!generateConsistentDevice(createApiConfiguration(), { region: 'JP' }, {}).issues.some(issue => issue.code === 'proxy-country-region'));
});

test('«Match region» is a previewed fix through the region rows: zone, languages, Intl locale and coordinates of the tagged country; the hint is gone afterwards', () => {
  const config = rowsOf(TOKYO), before = structuredClone(config), environment = proxy('DE'), fix = issueFix(config, { code: 'proxy-country-region' }, environment);
  assert.deepEqual(config, before, 'a preview never changes its input'); assert.ok(fix && fix.configuration);
  const value = id => { const row = fix.configuration.apis.find(item => item.id === id); return row.mode === 'custom' ? row.selected.value : undefined; };
  assert.equal(value('timezone').timeZone, 'Europe/Berlin'); assert.equal(value('navigator-language'), 'de-DE'); assert.deepEqual(value('navigator-languages'), ['de-DE', 'de', 'en-US', 'en']); assert.equal(value('intl-formatting').timeZone, 'Europe/Berlin');
  assert.ok(Math.abs(value('geolocation').latitude - 52.5) < 1 && Math.abs(value('geolocation').longitude - 13.4) < 1);
  assert.ok(!fingerprintProfileIssues(fix.configuration, environment).some(issue => issue.code === 'proxy-country-region'));
  assert.equal(issueFix(config, 'proxy-country-region', environment) !== null, true, 'the code alone works too'); assert.equal(issueFix(config, { code: 'proxy-country-region' }, {}), null, 'no tag, nothing to match'); assert.equal(issueFix(fix.configuration, { code: 'proxy-country-region' }, environment), null, 'once matched there is nothing left to write');
  // An explicit block of a row is never cancelled by the fix.
  const blocked = structuredClone(config); blocked.apis.find(row => row.id === 'geolocation').mode = 'on';
  assert.equal(issueFix(blocked, { code: 'proxy-country-region' }, environment).configuration.apis.find(row => row.id === 'geolocation').mode, 'on');
});

test('the code is exported, repairable, placed under the Region control of the OS level and has a text in every language', () => {
  assert.ok(FINGERPRINT_ISSUE_CODES.includes('proxy-country-region')); assert.ok(FIXABLE_ISSUES.includes('proxy-country-region'));
  assert.deepEqual(issueTarget({ code: 'proxy-country-region', ids: ['timezone'] }), { level: 'os', field: 'region' }, 'Show leads to the Region control, whichever row is named');
  assert.equal(placeIssues([{ code: 'proxy-country-region', ids: ['navigator-language'] }], 'os').byField.get('region').length, 1);
  assert.equal(placeIssues([{ code: 'proxy-country-region', ids: ['timezone'] }], 'device').rest.length, 1, 'on another level it stays in the list'); assert.equal(placeIssues([{ code: 'proxy-country-region', ids: ['timezone'] }], 'quick').rest.length, 1);
  assert.ok(LEVEL_FIELDS.os.includes('region'));
  assert.ok(FINGERPRINT_DEVICE_KEYS.includes('issue_proxy_country_region')); assert.ok(FINGERPRINT_DEVICE_KEYS.includes('issue_match_region'));
  const english = FINGERPRINT_DEVICE_LABELS.en;
  for (const language of PRODUCTION_LANGUAGES) {
    const words = FINGERPRINT_DEVICE_LABELS[language.id];
    assert.ok(words.issue_proxy_country_region.includes('{country}'), language.id + ' keeps the country placeholder'); assert.ok(words.issue_match_region.trim().length >= 2, language.id);
    if (language.id !== 'en') { assert.notEqual(words.issue_proxy_country_region, english.issue_proxy_country_region, language.id + ' is translated'); assert.notEqual(words.issue_match_region, english.issue_match_region, language.id); }
  }
  assert.doesNotMatch(english.issue_proxy_country_region, /invisible|undetectable|anonym|bypass|stealth|guarantee|legitimate|100\s?%/iu);
  assert.match(english.issue_proxy_country_region, /own note/u, 'the text says the tag is the user\'s note and is not verified');
});

test('the country is filled into the text in the UI language; a text without the placeholder, or an issue without a country, is returned as is', () => {
  const text = 'Tag ({country}) differs';
  assert.equal(fillIssueDetail(text, { detail: { country: 'DE' } }, 'en'), 'Tag (Germany (DE)) differs'); assert.match(fillIssueDetail(text, { detail: { country: 'DE' } }, 'de'), /Deutschland \(DE\)/u);
  assert.equal(fillIssueDetail(text, {}, 'en'), text); assert.equal(fillIssueDetail('plain', { detail: { country: 'DE' } }, 'en'), 'plain'); assert.equal(fillIssueDetail(text, { detail: { country: 5 } }, 'en'), text);
  assert.equal(fillIssueDetail('$&{country}', { detail: { country: 'DE' } }, 'en'), '$&Germany (DE)', 'replacement patterns in the country name are not interpreted');
});
