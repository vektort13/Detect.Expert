// ADR-104 addendum 4: the region control. A region (ISO 3166-1 alpha-2 code from the offline region data) writes the time zone,
// the language pair, the Intl locale and zone and, where the contract has the shape, the Custom geolocation of its default
// city in ONE preview; `region: null` returns those rows to "as in the browser". Plus describeDevice (region, geolocation) and
// the read-only hint `geolocation-timezone-mismatch`. The expectations come from the region data's own API.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiConfiguration, validateApiConfiguration, exportApiConfiguration, importApiConfiguration } from '../../apps/production-extension/api-configuration.js';
import { generateConsistentDevice, applyDevicePatch, fingerprintProfileIssues, editFingerprintRow, DEVICE_PATCH_KEYS, FINGERPRINT_ISSUE_CODES, GEOLOCATION_ZONE_MAX_KM, REGION_GEOLOCATION_ACCURACY, greatCircleKm, zonePrincipalPoint, regionClaim, writeRegionRows } from '../../apps/production-extension/fingerprint-profiles.js';
import { describeDevice, DEVICE_ROW_GROUPS } from '../../apps/production-extension/fingerprint-device-presets.js';
import { canonicalTimeZone, standardOffsetMinutes } from '../../apps/production-extension/fingerprint-timezone-data.js';
import { regionCodes, regionByCode, regionOfTimeZone, regionDefaults } from '../../apps/production-extension/fingerprint-region-data.js';

const base = createApiConfiguration();
const row = (configuration, id) => configuration.apis.find(entry => entry.id === id);
const val = (configuration, id) => { const found = row(configuration, id); return found?.mode === 'custom' && found.selected.kind === 'value' ? found.selected.value : undefined; };
const valueOf = configuration => id => val(configuration, id);
const ids = result => [...result.affected].sort();
const REGION_AFFECTED = ['geolocation', 'intl-formatting', 'navigator-language', 'navigator-languages', 'timezone'];
const SAMPLE = ['DE', 'US', 'JP', 'GB', 'FR', 'CH', 'IN', 'NP', 'BR', 'AU', 'RU', 'AR'];
const withRows = (rows, from = base) => rows.reduce((config, [id, value]) => editFingerprintRow(config, id, { mode: 'custom', selected: { kind: 'value', value } }), from);
const place = (latitude, longitude) => ({ latitude, longitude, accuracy: 25 });
const issueCodes = configuration => fingerprintProfileIssues(configuration).map(issue => issue.code);
// Everything a region must have written, derived from the data module (zone in the browser's spelling, standard offset, default city).
function assertRegionRows(configuration, code) {
  const defaults = regionDefaults(code), zone = canonicalTimeZone(defaults.timeZone);
  assert.deepEqual(val(configuration, 'timezone'), { timeZone: zone, offsetMinutes: standardOffsetMinutes(zone) }, code + ' timezone');
  assert.equal(val(configuration, 'navigator-language'), defaults.languages[0], code + ' language');
  assert.deepEqual(val(configuration, 'navigator-languages'), defaults.languages, code + ' languages');
  assert.deepEqual(val(configuration, 'intl-formatting'), { locale: Intl.getCanonicalLocales(defaults.locale)[0], timeZone: zone }, code + ' intl');
  assert.deepEqual(val(configuration, 'geolocation'), { latitude: defaults.latitude, longitude: defaults.longitude, accuracy: 25 }, code + ' geolocation');
}

test('the region key and its row group are part of the device patch contract', () => {
  assert.ok(DEVICE_PATCH_KEYS.includes('region'));
  assert.deepEqual([...DEVICE_ROW_GROUPS.region], ['timezone', 'navigator-language', 'navigator-languages', 'geolocation']);
  assert.ok(Object.isFrozen(DEVICE_ROW_GROUPS) && Object.isFrozen(DEVICE_PATCH_KEYS));
  assert.equal(REGION_GEOLOCATION_ACCURACY, 25);
  assert.ok(FINGERPRINT_ISSUE_CODES.includes('geolocation-timezone-mismatch'));
  assert.equal(GEOLOCATION_ZONE_MAX_KM, 2500);
});

test('a region patch writes zone, offset, language pair, Intl locale and zone and the default-city geolocation in one preview', () => {
  for (const code of SAMPLE) {
    const result = applyDevicePatch(base, { region: code });
    assert.equal(validateApiConfiguration(result.configuration).ok, true, code);
    assertRegionRows(result.configuration, code);
    assert.deepEqual(ids(result), REGION_AFFECTED, code + ' touches exactly the region rows');
    assert.equal(result.device.region, regionOfTimeZone(regionDefaults(code).timeZone), code);
    assert.deepEqual(result.device.geolocation, place(regionDefaults(code).latitude, regionDefaults(code).longitude), code);
    const codes = result.issues.map(issue => issue.code);
    assert.ok(!codes.includes('language-list') && !codes.includes('geolocation-timezone-mismatch'), code + ' raises no contradiction: ' + codes.join(','));
  }
});

test('single-zone regions report well-known literal values (not derived from the code under test)', () => {
  const cases = [['DE', 'Europe/Berlin', -60, 'de-DE'], ['JP', 'Asia/Tokyo', -540, 'ja-JP'], ['GB', 'Europe/London', 0, 'en-GB'], ['NP', 'Asia/Kathmandu', -345, 'ne-NP'], ['IN', 'Asia/Kolkata', -330, 'en-IN']];
  for (const [code, zone, offset, language] of cases) {
    const configuration = applyDevicePatch(base, { region: code }).configuration;
    assert.deepEqual(val(configuration, 'timezone'), { timeZone: canonicalTimeZone(zone), offsetMinutes: offset }, code);
    assert.ok(val(configuration, 'navigator-language').startsWith(language.slice(0, 2)), code + ' ' + val(configuration, 'navigator-language'));
    assert.equal(val(configuration, 'navigator-languages')[0], val(configuration, 'navigator-language'), code + ' list starts with the language');
  }
  // Berlin is a city in the north of Germany: latitude 52.5, longitude 13.4 (within a degree of the default).
  const berlin = val(applyDevicePatch(base, { region: 'DE' }).configuration, 'geolocation');
  assert.ok(Math.abs(berlin.latitude - 52.5) < 1 && Math.abs(berlin.longitude - 13.4) < 1 && berlin.accuracy === 25, JSON.stringify(berlin));
});

test('Randomize with a region writes the same rows (all protection levels) and a lowercase code is read as the same region', () => {
  for (const protection of ['compatibility', 'balanced', 'strict']) for (const code of ['DE', 'JP', 'IN']) {
    const configuration = generateConsistentDevice(base, { deviceType: 'laptop', protection, seed: 11, region: code }).configuration;
    assertRegionRows(configuration, code);
  }
  assert.deepEqual(applyDevicePatch(base, { region: 'de' }).configuration, applyDevicePatch(base, { region: 'DE' }).configuration);
  assert.deepEqual(generateConsistentDevice(base, { seed: 5, region: 'jp' }).configuration, generateConsistentDevice(base, { seed: 5, region: 'JP' }).configuration);
});

test('an absent region leaves the rows alone, while region null returns exactly the region rows to the browser', () => {
  const set = applyDevicePatch(base, { region: 'DE' }).configuration;
  const kept = generateConsistentDevice(set, { seed: 1 }).configuration;
  for (const id of REGION_AFFECTED) assert.deepEqual(row(kept, id), row(set, id), id + ' untouched without a region input');
  assert.deepEqual(generateConsistentDevice(set, { seed: 1, region: undefined }).configuration.apis.filter(entry => REGION_AFFECTED.includes(entry.id)), set.apis.filter(entry => REGION_AFFECTED.includes(entry.id)), 'undefined means absent');
  for (const cleared of [applyDevicePatch(set, { region: null }), generateConsistentDevice(set, { seed: 1, region: null })]) {
    for (const id of REGION_AFFECTED) assert.deepEqual(row(cleared.configuration, id), row(base, id), id + ' is back to the browser');
    assert.equal(cleared.device?.region ?? null, null);
  }
  assert.deepEqual(applyDevicePatch(set, { region: null }).configuration, base, 'nothing else was written, so the whole configuration is the original again');
  assert.deepEqual(applyDevicePatch(base, { region: null }).affected, [], 'null on a fresh profile changes nothing');
});

test('region null removes only the locale and zone of the shared Intl row and keeps its other keys', () => {
  const start = withRows([['intl-formatting', { locale: 'de-DE', timeZone: 'Europe/Berlin', calendar: 'gregory' }], ['timezone', { timeZone: 'Europe/Berlin', offsetMinutes: -60 }]]);
  const cleared = applyDevicePatch(start, { region: null }).configuration;
  assert.deepEqual(val(cleared, 'intl-formatting'), { calendar: 'gregory' });
  assert.equal(row(cleared, 'timezone').mode, 'bypass');
  const written = applyDevicePatch(start, { region: 'JP' }).configuration;
  assert.deepEqual(val(written, 'intl-formatting'), { locale: 'ja-JP', timeZone: canonicalTimeZone('Asia/Tokyo'), calendar: 'gregory' }, 'a region merges into the Intl row');
});

test('an unknown or malformed region is refused by both entry points and nothing is changed', () => {
  const before = structuredClone(base);
  for (const bad of ['XX', 'ZZ', 'QQ', '', ' ', 'D', 'DEU', 'D1', 'DE ', ' DE', 'D-', 'Germany', 'Д', 7, true, false, {}, [], ['DE'], () => 'DE', Symbol.for('DE'), undefined, NaN]) {
    assert.throws(() => applyDevicePatch(base, { region: bad }), /invalid-value/, 'patch ' + String(typeof bad === 'symbol' ? 'symbol' : bad));
    if (bad !== undefined) assert.throws(() => generateConsistentDevice(base, { seed: 1, region: bad }), /invalid-value/, 'generator ' + String(typeof bad === 'symbol' ? 'symbol' : bad));
  }
  assert.deepEqual(base, before, 'the input configuration is not mutated');
  let read = false;
  const accessor = {}; Object.defineProperty(accessor, 'region', { enumerable: true, get() { read = true; return 'DE'; } });
  assert.throws(() => applyDevicePatch(base, accessor), /invalid-value/);
  const coercible = { toString() { read = true; return 'DE'; } };
  assert.throws(() => applyDevicePatch(base, { region: coercible }), /invalid-value/);
  assert.equal(read, false, 'a region is never coerced and an accessor is never run');
  assert.throws(() => regionClaim('XX'), /invalid-value/);
  assert.throws(() => regionClaim(null), /invalid-value/);
});

test('an explicit language or time zone in the same call wins over the region, as the finer choice', () => {
  const language = applyDevicePatch(base, { region: 'DE', language: 'fr-FR' }).configuration;
  assert.equal(val(language, 'navigator-language'), 'fr-FR'); assert.deepEqual(val(language, 'navigator-languages'), ['fr-FR', 'fr', 'en-US', 'en']);
  assert.equal(val(language, 'intl-formatting').locale, 'fr-FR'); assert.equal(val(language, 'intl-formatting').timeZone, 'Europe/Berlin', 'the region still owns the zone');
  const zone = applyDevicePatch(base, { region: 'DE', timezone: { timeZone: 'Asia/Tokyo', offsetMinutes: -540 } });
  assert.equal(val(zone.configuration, 'timezone').timeZone, 'Asia/Tokyo'); assert.equal(val(zone.configuration, 'intl-formatting').timeZone, 'Asia/Tokyo');
  assert.equal(zone.device.region, 'JP', 'the region is derived from the zone that is selected now');
  assert.ok(zone.issues.some(issue => issue.code === 'geolocation-timezone-mismatch'), 'Berlin coordinates with a Tokyo zone are flagged');
  const generated = generateConsistentDevice(base, { seed: 3, region: 'DE', language: 'ja-JP', timezone: { timeZone: 'Asia/Tokyo', offsetMinutes: -540 } });
  assert.equal(val(generated.configuration, 'navigator-language'), 'ja-JP'); assert.equal(val(generated.configuration, 'timezone').timeZone, 'Asia/Tokyo');
  assert.ok(generated.issues.some(issue => issue.code === 'geolocation-timezone-mismatch'));
  const cleared = applyDevicePatch(applyDevicePatch(base, { region: 'DE' }).configuration, { region: null, language: 'ja-JP' }).configuration;
  assert.equal(val(cleared, 'navigator-language'), 'ja-JP'); assert.equal(val(cleared, 'timezone'), undefined);
});

test('switching the region replaces every region row, and a later preset or level control does not remove them', () => {
  const de = applyDevicePatch(base, { region: 'DE' }).configuration, jp = applyDevicePatch(de, { region: 'JP' }).configuration;
  assertRegionRows(jp, 'JP');
  for (const protection of ['compatibility', 'balanced', 'strict']) {
    const next = generateConsistentDevice(jp, { deviceType: 'desktop', protection, seed: 9 }).configuration;
    for (const id of REGION_AFFECTED) assert.deepEqual(row(next, id), row(jp, id), protection + '/' + id);
  }
  const patched = applyDevicePatch(jp, { cores: 8, screen: '1920x1080', canvas: true }).configuration;
  for (const id of REGION_AFFECTED) assert.deepEqual(row(patched, id), row(jp, id), id);
});

test('an explicit geolocation block is kept while the other region rows are written', () => {
  const blocked = structuredClone(base); row(blocked, 'geolocation').mode = 'on';
  for (const result of [applyDevicePatch(blocked, { region: 'DE' }), generateConsistentDevice(blocked, { seed: 2, region: 'DE' })]) {
    assert.equal(row(result.configuration, 'geolocation').mode, 'on'); assert.deepEqual(row(result.configuration, 'geolocation').selected, { kind: 'unset' });
    assert.equal(val(result.configuration, 'timezone').timeZone, 'Europe/Berlin'); assert.equal(val(result.configuration, 'navigator-language'), 'de-DE');
  }
  // region null never touches a block either.
  const cleared = applyDevicePatch(applyDevicePatch(blocked, { region: 'DE' }).configuration, { region: null }).configuration;
  assert.equal(row(cleared, 'geolocation').mode, 'on');
});

test('the geolocation row is written only where its row supports Custom values (stub rows, because the real catalogue supports it)', () => {
  const claim = regionClaim('DE'), calls = [];
  const tools = customSupported => ({ row: id => id === 'geolocation' ? { customSupported } : { customSupported: true }, value: (id, raw) => calls.push([id, raw]), intl: changes => calls.push(['intl', changes]) });
  writeRegionRows(tools(false), claim);
  assert.deepEqual(calls.map(call => call[0]), ['navigator-language', 'navigator-languages', 'intl', 'timezone'], 'no geolocation without Custom support');
  calls.length = 0; writeRegionRows(tools(true), claim);
  assert.deepEqual(calls.map(call => call[0]), ['navigator-language', 'navigator-languages', 'intl', 'timezone', 'geolocation']);
  assert.deepEqual(calls.at(-1)[1], { latitude: regionDefaults('DE').latitude, longitude: regionDefaults('DE').longitude, accuracy: 25 });
  calls.length = 0; writeRegionRows({ ...tools(true), row: () => undefined }, claim);
  assert.ok(!calls.some(call => call[0] === 'geolocation'), 'no row at all means no geolocation');
  calls.length = 0; writeRegionRows(tools(true), { ...claim, geolocation: null });
  assert.ok(!calls.some(call => call[0] === 'geolocation'), 'a region without coordinates writes none');
});

test('the region rows survive portable JSON export and import', () => {
  const configuration = applyDevicePatch(base, { region: 'IN' }).configuration;
  const imported = importApiConfiguration(exportApiConfiguration(configuration));
  assert.equal(imported.ok, true, imported.error?.message);
  for (const id of REGION_AFFECTED) assert.deepEqual(row(imported.value, id), row(configuration, id), id);
});

test('every region of the data works through the patch (and a spread of them through Randomize): valid rows, offsets in range, no contradiction', () => {
  const codes = regionCodes();
  assert.ok(codes.length >= SAMPLE.length && SAMPLE.every(code => codes.includes(code)), 'the sample regions exist');
  const mismatched = [];
  for (const code of codes) {
    const defaults = regionDefaults(code);
    assert.ok(defaults && defaults.code === code, code);
    const viaPatch = applyDevicePatch(base, { region: code });
    assertRegionRows(viaPatch.configuration, code);
    // Randomize shares the writer; every seventh region plus the sample keeps the run short.
    if (SAMPLE.includes(code) || codes.indexOf(code) % 7 === 0) assertRegionRows(generateConsistentDevice(base, { seed: 7, region: code, protection: 'compatibility' }).configuration, code);
    const zone = val(viaPatch.configuration, 'timezone');
    assert.ok(Number.isInteger(zone.offsetMinutes) && zone.offsetMinutes >= -840 && zone.offsetMinutes <= 840, code + ' offset ' + zone.offsetMinutes);
    const flagged = viaPatch.issues.map(issue => issue.code).filter(issue => ['language-list', 'geolocation-timezone-mismatch'].includes(issue));
    assert.deepEqual(flagged, [], code + ' raises ' + flagged.join(','));
    // The region is derived from the zone, so a zone that two regions share may read back as the other region (reported, not hidden).
    if (viaPatch.device.region !== code) mismatched.push(code + '->' + viaPatch.device.region);
    assert.equal(viaPatch.device.region, regionOfTimeZone(defaults.timeZone), code + ' device.region follows the zone');
  }
  if (mismatched.length) console.log('regions that read back as another region through the shared zone: ' + mismatched.join(' '));
});

test('standard offsets of all default zones are integers inside the contract range, with no negative zero', () => {
  for (const code of regionCodes()) {
    const offset = standardOffsetMinutes(canonicalTimeZone(regionDefaults(code).timeZone));
    assert.ok(Number.isInteger(offset) && offset >= -840 && offset <= 840 && !Object.is(offset, -0), code + ' ' + offset);
  }
});

// --- describeDevice ----------------------------------------------------------------------------------------------------
test('describeDevice reads the region from the selected zone and the geolocation from the Custom row', () => {
  const empty = describeDevice(() => undefined);
  assert.equal(empty.region, null); assert.equal(empty.geolocation, null);
  assert.ok(Object.values(empty).every(entry => entry === null), 'nothing is invented');
  const jp = applyDevicePatch(base, { region: 'JP' }).configuration, device = describeDevice(valueOf(jp));
  assert.equal(device.region, 'JP'); assert.deepEqual(device.geolocation, place(regionDefaults('JP').latitude, regionDefaults('JP').longitude));
  // The old time zone control also sets the region (derived), and a geolocation is not invented.
  const old = applyDevicePatch(base, { timezone: { timeZone: 'Europe/Paris', offsetMinutes: -60 } });
  assert.equal(old.device.region, 'FR'); assert.equal(old.device.geolocation, null);
  // The zone of the Intl row counts when there is no `timezone` row, and the `timezone` row wins when both exist.
  const intlOnly = withRows([['intl-formatting', { timeZone: 'Asia/Tokyo' }]]);
  assert.equal(describeDevice(valueOf(intlOnly)).region, 'JP');
  assert.equal(describeDevice(valueOf(withRows([['timezone', { timeZone: 'Europe/Paris', offsetMinutes: -60 }]], intlOnly))).region, 'FR');
  // A zone that no region lists has no region.
  assert.equal(describeDevice(valueOf(withRows([['timezone', { timeZone: 'UTC', offsetMinutes: 0 }]]))).region, null);
  // A Block is not a reported value.
  const blocked = structuredClone(jp); row(blocked, 'geolocation').mode = 'on';
  assert.equal(describeDevice(valueOf(blocked)).geolocation, null);
});

test('describeDevice returns a copy of the coordinates and reads a configuration object through data descriptors only', () => {
  const jp = applyDevicePatch(base, { region: 'JP' }).configuration;
  const device = describeDevice(valueOf(jp));
  device.geolocation.latitude = 0;
  assert.notEqual(val(jp, 'geolocation').latitude, 0, 'the caller cannot change the configuration through the description');
  assert.deepEqual(describeDevice(jp), describeDevice(valueOf(jp)), 'the configuration form equals the function form');
  assert.deepEqual(describeDevice(base), describeDevice(valueOf(base)));
  let read = false;
  const trap = {}; Object.defineProperty(trap, 'apis', { enumerable: true, get() { read = true; return jp.apis; } });
  assert.ok(Object.values(describeDevice(trap)).every(entry => entry === null)); assert.equal(read, false, 'an accessor on the configuration is never run');
  for (const junk of [null, undefined, 5, 'x', [], {}, { apis: 5 }, { apis: [null, 5, { id: 'timezone' }] }]) assert.ok(Object.values(describeDevice(junk)).every(entry => entry === null), String(junk));
  // Hostile rows: a getter on a row field is not invoked either.
  const rowTrap = { apis: [{ id: 'timezone', mode: 'custom', get selected() { read = true; return { kind: 'value', value: { timeZone: 'Europe/Paris' } }; } }] };
  assert.equal(describeDevice(rowTrap).region, null); assert.equal(read, false);
});

// --- the hint -------------------------------------------------------------------------------------------------------------
test('great-circle distances are right: known city pairs, symmetry, zero and the date line', () => {
  const near = (actual, expected, percent = 1) => assert.ok(Math.abs(actual - expected) <= expected * percent / 100, actual + ' vs ' + expected);
  const berlin = place(52.52, 13.405), paris = place(48.8566, 2.3522), london = place(51.5074, -0.1278), newYork = place(40.7128, -74.006), tokyo = place(35.6762, 139.6503);
  near(greatCircleKm(berlin, paris), 878); near(greatCircleKm(london, newYork), 5570); near(greatCircleKm(berlin, tokyo), 8920, 1.5);
  assert.equal(greatCircleKm(berlin, berlin), 0);
  assert.equal(greatCircleKm(berlin, paris), greatCircleKm(paris, berlin));
  near(greatCircleKm(place(0, 0), place(0, 180)), Math.PI * 6371, 0.01);
  // Across the date line the points are close, and a planar difference of longitudes would say they are far.
  assert.ok(greatCircleKm(place(-36.85, 174.76), place(-36.85, -179.5)) < 600);
  near(greatCircleKm(place(0, 0), place(1, 0)), 111.19, 0.1);
});

test('the zone principal point is the listed city of the zone, found through aliases, and unknown zones have none', () => {
  const berlin = zonePrincipalPoint('Europe/Berlin');
  assert.ok(Math.abs(berlin.latitude - 52.5) < 1 && Math.abs(berlin.longitude - 13.4) < 1);
  assert.deepEqual(zonePrincipalPoint(canonicalTimeZone('Asia/Kolkata')), zonePrincipalPoint('Asia/Kolkata'), 'Asia/Calcutta and Asia/Kolkata are one zone');
  assert.ok(zonePrincipalPoint('Asia/Kolkata') !== null);
  for (const unknown of ['UTC', 'Etc/GMT+5', 'Not/AZone', '', 5, null, undefined, {}]) assert.equal(zonePrincipalPoint(unknown), null, String(unknown));
});

test('geolocation-timezone-mismatch: raised beyond 2500 km from the zone principal point, silent within it (boundary 2499 / 2501)', () => {
  const anchor = zonePrincipalPoint('Europe/Berlin'), zone = ['timezone', { timeZone: 'Europe/Berlin', offsetMinutes: -60 }];
  // Due north / south on a sphere: the angular difference is distance / radius exactly.
  const shifted = (km, sign) => place(anchor.latitude + sign * km / 6371 * 180 / Math.PI, anchor.longitude);
  for (const sign of [1, -1]) {
    const near = shifted(2499, sign), far = shifted(2501, sign);
    assert.ok(Math.abs(greatCircleKm(anchor, near) - 2499) < 0.01 && Math.abs(greatCircleKm(anchor, far) - 2501) < 0.01);
    assert.ok(!issueCodes(withRows([zone, ['geolocation', near]])).includes('geolocation-timezone-mismatch'), 'inside, sign ' + sign);
    const flagged = fingerprintProfileIssues(withRows([zone, ['geolocation', far]])).find(issue => issue.code === 'geolocation-timezone-mismatch');
    assert.ok(flagged, 'outside, sign ' + sign);
    assert.equal(flagged.severity, 'warning'); assert.deepEqual(flagged.ids, ['geolocation', 'timezone']);
  }
  assert.ok(!issueCodes(withRows([zone, ['geolocation', place(anchor.latitude, anchor.longitude)]])).includes('geolocation-timezone-mismatch'), 'at the city itself');
});

test('geolocation-timezone-mismatch: far-away coordinates and near ones, in the cases a user can reach', () => {
  const flagged = rows => issueCodes(withRows(rows)).includes('geolocation-timezone-mismatch');
  const berlin = ['timezone', { timeZone: 'Europe/Berlin', offsetMinutes: -60 }];
  assert.equal(flagged([berlin, ['geolocation', place(35.6762, 139.6503)]]), true, 'Tokyo coordinates, Berlin zone');
  assert.equal(flagged([['timezone', { timeZone: 'Asia/Tokyo', offsetMinutes: -540 }], ['geolocation', place(40.7128, -74.006)]]), true, 'New York coordinates, Tokyo zone');
  assert.equal(flagged([berlin, ['geolocation', place(48.8566, 2.3522)]]), false, 'Paris is about 880 km away');
  assert.equal(flagged([berlin, ['geolocation', place(55.7558, 37.6173)]]), false, 'Moscow is about 1,600 km away');
  assert.equal(flagged([['timezone', { timeZone: 'America/New_York', offsetMinutes: 300 }], ['geolocation', place(41.8781, -87.6298)]]), false, 'Chicago is about 1,150 km from New York');
  // Only one of the two rows: nothing to compare. A zone no region lists (UTC) has no principal point and never raises it.
  assert.equal(flagged([['geolocation', place(35.6762, 139.6503)]]), false);
  assert.equal(flagged([berlin]), false);
  assert.equal(flagged([['timezone', { timeZone: 'UTC', offsetMinutes: 0 }], ['geolocation', place(35.6762, 139.6503)]]), false);
  assert.equal(flagged([['timezone', { timeZone: 'Etc/GMT+5', offsetMinutes: 300 }], ['geolocation', place(35.6762, 139.6503)]]), false);
  // The alias spelling Chrome stores is the same zone.
  assert.equal(flagged([['timezone', { timeZone: canonicalTimeZone('Asia/Kolkata'), offsetMinutes: -330 }], ['geolocation', place(28.6139, 77.209)]]), false, 'Delhi is about 1,300 km from Kolkata');
  assert.equal(flagged([['timezone', { timeZone: canonicalTimeZone('Asia/Kolkata'), offsetMinutes: -330 }], ['geolocation', place(35.6762, 139.6503)]]), true);
  // The zone of the Intl row counts when there is no `timezone` row; the `timezone` row wins when both exist.
  const viaIntl = fingerprintProfileIssues(withRows([['intl-formatting', { timeZone: 'Europe/Berlin' }], ['geolocation', place(35.6762, 139.6503)]])).find(issue => issue.code === 'geolocation-timezone-mismatch');
  assert.deepEqual(viaIntl?.ids, ['geolocation', 'intl-formatting']);
  assert.equal(flagged([['intl-formatting', { timeZone: 'Asia/Tokyo' }], berlin, ['geolocation', place(52.52, 13.405)]]), false, 'timezone row (Berlin) wins over the Intl zone (Tokyo)');
  // Across the date line the coordinates are close.
  assert.equal(flagged([['timezone', { timeZone: 'Pacific/Auckland', offsetMinutes: -720 }], ['geolocation', place(-36.85, -179.5)]]), false);
});

test('the hint is read-only: it never rewrites the configuration and appears once', () => {
  const configuration = withRows([['timezone', { timeZone: 'Europe/Berlin', offsetMinutes: -60 }], ['intl-formatting', { timeZone: 'Europe/Berlin' }], ['geolocation', place(35.6762, 139.6503)]]);
  const before = structuredClone(configuration);
  const issues = fingerprintProfileIssues(configuration);
  assert.deepEqual(configuration, before);
  assert.equal(issues.filter(issue => issue.code === 'geolocation-timezone-mismatch').length, 1);
  assert.deepEqual(val(configuration, 'geolocation'), place(35.6762, 139.6503), 'the coordinates are the user\'s and stay');
});
