// ADR-064/ADR-065/ADR-066/ADR-068/ADR-104..107: source, native evidence, browser deliveries and archives agree.
// The current format/catalog/row counts follow the contract constants; every published catalog stays pinned byte for byte.
// Native evidence is read from test-results/production-<manifest version>/ (falling back to the legacy production-1.1.0
// folder of natives that still write there); every evidence file must pin the final dist bytes it tested.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { archiveProduction, productionManifest, validateProductionManifest } from '../build-production.mjs';
import { findEvidence, writeEvidence } from './native-evidence.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';
import { ANTIDETECT_UI_KEYS, ANTIDETECT_EDITOR_KEYS, applyAntidetectCopy } from '../production-locales-antidetect.mjs';
import { MATH_UI_KEYS, MATH_UI_ALIAS_KEYS, applyMathCopy } from '../production-locales-math.mjs';
import { FINGERPRINT_UI_KEYS, applyFingerprintCopy } from '../production-locales-fingerprint.mjs';
import { MANAGEMENT_SECTIONS, managementSectionForHash, managementHashForSection } from '../../apps/production-extension/management-ui.js';
import * as contract from '../../apps/production-extension/api-configuration.js';
const { API_CONFIG_CATALOG, API_MATH_FUNCTIONS, API_CONFIGURATION_VERSION, API_CONFIGURATION_CATALOG_VERSION, API_CONFIGURATION_FORMAT, createApiConfiguration, upgradeApiConfiguration, exportApiConfiguration } = contract;
const catalogOf = version => contract['API_CONFIG_CATALOG_V' + version];

const root = resolve(import.meta.dirname, '../..'), source = join(root, 'apps/production-extension');
const sha = value => createHash('sha256').update(value).digest('hex'), read = (directory, file) => readFileSync(join(directory, file));
const localeKeys = [...ANTIDETECT_UI_KEYS, ...ANTIDETECT_EDITOR_KEYS, ...MATH_UI_KEYS, ...MATH_UI_ALIAS_KEYS, ...FINGERPRINT_UI_KEYS];
const result = { result: 'PASS', at: new Date().toISOString(), checks: [], native: [], matches: [], locales: [], migrations: [], archives: [] };
const check = (condition, text) => { assert.ok(condition, text); result.checks.push(text); };
// An explicit --<name> <path> wins; otherwise the evidence folder of this version, then the legacy one (null when absent).
function evidenceFile(name, relative) {
  const index = process.argv.indexOf('--' + name);
  if (index < 0) return findEvidence(relative)?.path ?? null;
  assert.ok(process.argv[index + 1], 'missing argument ' + name); return resolve(root, process.argv[index + 1]);
}
const readNative = (path, label) => { assert.ok(path && existsSync(path), label + ' evidence exists'); return JSON.parse(readFileSync(path, 'utf8')); };

// ADR-103: the hub leads, then Анализ, Защита, Атака and Инструменты; Browser Debug stays a Settings sub-route.
assert.deepEqual(MANAGEMENT_SECTIONS, ['hub', 'detector', 'api', 'firewall', 'antidetect', 'autosurf', 'cookies', 'proxy', 'integrations', 'settings', 'contacts', 'browser-debug']);
assert.equal(managementSectionForHash('#antidetect'), 'antidetect'); assert.equal(managementHashForSection('antidetect'), '#antidetect');
result.checks.push('six unified sections include Antidetect immediately after API Guard; the canonical route round-trips');
// Published catalogues (metadata as shipped) never change; catalog 8 is the round-3 2.0.0 delivery. Only a catalogue older
// than the current one is pinned: the current catalogue is the one under development.
const PUBLISHED_CATALOG_SHA256 = {
  5: 'c10b94ac123076d428a254367649a4cc168c97947aa3787bf41f9b320bccf7e1', 6: 'e03c14158d199bdac78dbdac56c748171a5fa1b89dc4b8b9301e899236d8f286',
  7: '04ab7486cfab75d88db1f55a6e47288f0f4864f61bfaf66801b9a07e1c25b646', 8: '6a8d1b4ad09efee6237b4ac8bad9ed79a5789c1d86d01d24de50b7e36db6f447',
  9: '2200ab966b82da57e0245cbc79d7ad3d3428675f8c8e554a48f58cc1c4f648a0', 10: 'be9cdc97c5a279b9230ae94c1d30632f02d1ce144b8cfdacca226f2327c13599' };
assert.equal(catalogOf(API_CONFIGURATION_CATALOG_VERSION), API_CONFIG_CATALOG, 'API_CONFIG_CATALOG is the catalogue named by API_CONFIGURATION_CATALOG_VERSION');
assert.ok(API_CONFIGURATION_VERSION >= 7 && API_CONFIGURATION_CATALOG_VERSION >= 8 && API_CONFIG_CATALOG.length >= 158 && API_MATH_FUNCTIONS.length >= 23, 'formats, catalogues, rows and Math functions only grow');
for (const [version, digest] of Object.entries(PUBLISHED_CATALOG_SHA256)) if (Number(version) < API_CONFIGURATION_CATALOG_VERSION) assert.equal(sha(JSON.stringify(catalogOf(version))), digest, 'published catalogue ' + version + ' metadata stays byte-for-byte pinned');
const previousCatalog = catalogOf(API_CONFIGURATION_CATALOG_VERSION - 1);
assert.deepEqual(API_CONFIG_CATALOG.slice(0, previousCatalog.length).map(row => row.id), previousCatalog.map(row => row.id), 'the current catalogue keeps every earlier identifier in its order');
assert.deepEqual(API_CONFIG_CATALOG.filter((row, index) => index < previousCatalog.length && previousCatalog[index].customSupported && !row.customSupported).map(row => row.id), [], 'no Custom capability silently disappears');
assert.deepEqual(API_CONFIG_CATALOG.find(row => row.id === 'math-transcendentals').presets[0].value.value.functions, [...API_MATH_FUNCTIONS], 'the Math row offers every Math function');
result.contract = { formatVersion: API_CONFIGURATION_VERSION, catalogVersion: API_CONFIGURATION_CATALOG_VERSION, rows: API_CONFIG_CATALOG.length, custom: API_CONFIG_CATALOG.filter(row => row.customSupported).length, mathFunctions: API_MATH_FUNCTIONS.length };
result.checks.push('contract format' + result.contract.formatVersion + '/catalog' + result.contract.catalogVersion + ': ' + result.contract.rows + ' rows, ' + result.contract.custom + ' Custom, ' + result.contract.mathFunctions + ' Math functions; published catalogues stay pinned');
const defaults = createApiConfiguration(); assert.equal(defaults.enabled, false); assert.equal(defaults.antidetectEnabled, false);
// The same module-path adaptation as scripts/production/sync-api-configuration.mjs (browserImports).
const canonical = readFileSync(join(root, 'packages/contracts/src/api-configuration.mjs'), 'utf8').replaceAll("from './protection-features.mjs'", "from './api-protection-features.js'").replaceAll("from './webassembly-apis.mjs'", "from './webassembly-apis.js'")
  .replaceAll("from './math-functions.mjs'", "from './math-functions.js'").replaceAll("from './fingerprint-custom-values.mjs'", "from './fingerprint-custom-values.js'");
assert.equal(read(source, 'api-configuration.js').toString(), canonical, 'the browser contract is the canonical source with only module-path adaptation');

// Every published (formatVersion, catalogVersion) pair, oldest first; the current pair is the target, not a migration.
const PUBLISHED_PAIRS = [[1, 1], [1, 2], [2, 3], [3, 4], [3, 5], [4, 6], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10]].filter(([format, version]) => catalogOf(version) && !(format === API_CONFIGURATION_VERSION && version === API_CONFIGURATION_CATALOG_VERSION));
for (const [format, version] of PUBLISHED_PAIRS) for (const enabled of [false, true]) {
  const catalog = catalogOf(version);
  const configuration = { format: API_CONFIGURATION_FORMAT, formatVersion: format, catalogVersion: version, enabled, ...(format >= 5 ? { antidetectEnabled: enabled } : {}), preset: 'custom',
    ...(format >= 2 ? { webrtcNetworkPolicy: 'default_public_interface_only' } : {}), apis: catalog.map(entry => ({ ...clone(entry), mode: 'bypass', userValues: [], selected: { kind: 'unset' }, settings: {} })), sites: [], ...(format >= 4 ? { fingerprintProfiles: [] } : {}) };
  const cpu = configuration.apis.find(entry => entry.id === 'hardware-concurrency'); cpu.mode = 'custom'; cpu.selected = { kind: 'value', value: 16 }; cpu.userValues = [{ id: 'owned-cpu', label: 'Owned CPU', value: clone(cpu.selected) }];
  if (version >= 3) {
    const rtc = configuration.apis.find(entry => entry.id === 'webrtc'), value = clone(rtc.presets[1].value); rtc.mode = 'custom'; rtc.selected = value; rtc.userValues = [{ id: 'owned-rtc', label: 'Owned RTC', value: clone(value) }];
    configuration.sites = [{ host: 'owned.fixture.invalid', disabled: false, apis: configuration.apis.map(entry => ({ id: entry.id, mode: entry.id === 'webrtc' ? 'custom' : 'bypass', selected: entry.id === 'webrtc' ? clone(value) : { kind: 'unset' }, settings: {} })) }];
  }
  if (version >= 6) {
    for (const id of ['canvas-readback', 'math-transcendentals']) {
      const api = configuration.apis.find(entry => entry.id === id); api.mode = 'custom'; api.selected = clone(api.presets[0].value);
    }
    configuration.fingerprintProfiles = [{ id: 'fp-' + '1'.repeat(32), label: 'Published format' + format + ' profile', preset: 'custom', webrtcNetworkPolicy: 'system',
      apis: configuration.apis.map(({ id, mode, selected, settings }) => ({ id, mode, selected: clone(selected), settings: clone(settings) })), ...(format >= 9 ? { tags: [], note: '' } : {}) }];
  }
  const before = JSON.stringify(configuration), upgraded = upgradeApiConfiguration(configuration), label = 'format' + format + '/catalog' + version;
  assert.equal(upgraded.ok, true, label + ' upgrades: ' + JSON.stringify(upgraded.error)); assert.equal(upgraded.migrated, true); assert.equal(JSON.stringify(configuration), before, 'historical input remains untouched');
  assert.equal(upgraded.value.formatVersion, API_CONFIGURATION_VERSION); assert.equal(upgraded.value.catalogVersion, API_CONFIGURATION_CATALOG_VERSION); assert.equal(upgraded.value.apis.length, API_CONFIG_CATALOG.length);
  assert.equal(upgraded.value.enabled, enabled); assert.equal(upgraded.value.antidetectEnabled, enabled, 'the old shared master maps to both independent controls without activating dormant configurations');
  // A profile book keeps its profiles and their rows; rows of newer catalogues are added empty.
  assert.deepEqual(upgraded.value.fingerprintProfiles.map(profile => [profile.id, profile.label]), (configuration.fingerprintProfiles ?? []).map(profile => [profile.id, profile.label]));
  for (const [index, profile] of (configuration.fingerprintProfiles ?? []).entries()) for (const row of profile.apis) assert.deepEqual(upgraded.value.fingerprintProfiles[index].apis.find(entry => entry.id === row.id), row, label + ' profile row ' + row.id);
  const upgradedCpu = upgraded.value.apis.find(entry => entry.id === 'hardware-concurrency'); assert.equal(upgradedCpu.selected.value, 16); assert.deepEqual(upgradedCpu.userValues, cpu.userValues);
  if (version >= 3) { const rtc = upgraded.value.apis.find(entry => entry.id === 'webrtc'); assert.equal(rtc.selected.value.addresses.ipv4.stun, '198.51.100.10'); assert.equal(rtc.selected.value.addresses.ipv6.stun, null); assert.equal(rtc.userValues[0].id, 'owned-rtc'); assert.deepEqual(upgraded.value.sites[0].apis.find(entry => entry.id === 'webrtc').selected, rtc.selected); }
  const math = upgraded.value.apis.find(entry => entry.id === 'math-transcendentals'); assert.equal(math.mode, version >= 6 ? 'custom' : 'bypass'); assert.deepEqual(math.selected, version >= 6 ? configuration.apis.find(entry => entry.id === 'math-transcendentals').selected : { kind: 'unset' }); assert.deepEqual(math.userValues, []);
  const canvas = upgraded.value.apis.find(entry => entry.id === 'canvas-readback'); assert.equal(canvas.customSupported, true); assert.equal(canvas.mode, version >= 6 ? 'custom' : 'bypass'); assert.deepEqual(canvas.selected, version >= 6 ? configuration.apis.find(entry => entry.id === canvas.id).selected : { kind: 'unset' });
  const corrupted = clone(configuration); corrupted.apis[0].name += '-modified'; assert.equal(upgradeApiConfiguration(corrupted).ok, false, 'historical metadata is checked before migration');
  const duplicate = clone(configuration); duplicate.apis[1] = clone(duplicate.apis[0]); assert.equal(upgradeApiConfiguration(duplicate).ok, false, 'historical duplicate IDs are rejected');
  if (format < 5) { const smuggledMaster = { ...configuration, antidetectEnabled: enabled }; assert.equal(upgradeApiConfiguration(smuggledMaster).ok, false, 'formats before 5 cannot carry the independent master'); }
  result.migrations.push({ formatVersion: format, catalogVersion: version, enabled, antidetectEnabled: upgraded.value.antidetectEnabled, previousRows: catalog.length, currentRows: upgraded.value.apis.length, exportSHA256: sha(exportApiConfiguration(upgraded.value)) });
}
result.checks.push(PUBLISHED_PAIRS.length + ' published format/catalog pairs migrate strictly into format' + API_CONFIGURATION_VERSION + '/catalog' + API_CONFIGURATION_CATALOG_VERSION + ' for both old master states, preserving libraries/sites/profile books and dormant selections without auto-activation');

const files = [
  'antidetect-controller.js', 'antidetect-protocol-controller.js', 'antidetect-header-controller.js', 'antidetect-ui.js', 'antidetect-ui.css', 'antidetect-block-runtime.js',
  'sensor-quiet.js', 'antidetect-quiet-ui.js', 'antidetect-quiet-labels.js',
  'antidetect-block-opaque.entry.js', 'antidetect-block-opaque.webrtc.js', 'antidetect-block-opaque.websocket.js', 'antidetect-block-opaque.webtransport.js',
  'api-configuration.js', 'api-configuration-controller.js', 'api-configuration-ui.js', 'api-configuration-ui.css', 'api-custom-registration.js',
  'api-custom-webrtc-runtime.js', 'api-custom-runtime.js', 'api-custom-document-runtime.js', 'api-custom.main.js', 'api-custom-opaque.webrtc.js',
  'hook.early.js', 'hook.main.js', 'font-probe-names.js', 'api-custom-font-shield-runtime.js',
  'antidetect-math-ui.js', 'antidetect-math-ui.css', 'api-custom-math-runtime.js', 'api-custom-math-opaque.entry.js', 'api-custom-opaque.math-transcendentals.js', 'math-functions.js', 'math-profile-seed.js',
  'fingerprint-profiles.js', 'fingerprint-profiles-controller.js', 'fingerprint-profile-ui.js', 'fingerprint-profile-ui.css', 'fingerprint-library-ui.js', 'fingerprint-library-ui.css', 'fingerprint-library-labels.js',
  'fingerprint-field-hints.js', 'ui-announcer.js', 'ui-shortcuts.js',
  'fingerprint-device-labels.js', 'fingerprint-identity-labels.js', 'fingerprint-trash.js', 'fingerprint-temporary.js', 'identity-bundles.js', 'api-custom-media-codecs.js', 'api-custom-media-types.js', 'media-codec-configuration-ui.js', 'ui-tour.js', 'ui-tour.css', 'ui-tour-labels.js',
  'api-custom-canvas-runtime.js', 'api-custom-canvas-opaque.entry.js', 'api-custom-opaque.canvas-readback.js', 'canvas-profile-seed.js', 'profile-noise-seed.js',
  'api-custom-geolocation-runtime.js', 'api-custom-geolocation-opaque.entry.js', 'api-custom-opaque.geolocation.js',
  'fingerprint-region-data.js', 'fingerprint-region-names.js', 'REGION-DATA-NOTICE.txt',
  'webrtc-configuration-ui.js', 'management-ui.js', 'management-ui.css', 'management-navigation.js', 'options.html'
];
for (const browser of ['chrome', 'firefox']) {
  const directory = join(root, 'dist', browser), manifest = JSON.parse(read(directory, 'manifest.json'));
  assert.deepEqual(validateProductionManifest(manifest, browser), [], browser + ': permissions/CSP/manifest policies');
  // The packaged manifest is exactly what the build derives from apps/production-extension/manifest.json for this browser.
  assert.deepEqual(manifest, productionManifest(browser, JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version), browser + ': dist manifest equals the build output of the production manifest');
  result.checks.push(browser + ': required/optional permissions, hosts, CSP and every other manifest field equal the build output of the production manifest');
  for (const file of files) {
    const bytes = read(directory, file), expected = read(source, file); assert.ok(bytes.equals(expected), browser + ': source → dist ' + file);
    result.matches.push({ browser, file, sha256: sha(bytes), bytes: bytes.length });
  }
  const options = read(directory, 'options.html').toString(); assert.equal((options.match(/href="antidetect-ui\.css"/g) ?? []).length, 1, browser + ': one Antidetect stylesheet');
  assert.equal((options.match(/href="antidetect-math-ui\.css"/g) ?? []).length, 1, browser + ': one Math profile stylesheet');
  assert.equal((options.match(/href="fingerprint-profile-ui\.css"/g) ?? []).length, 1, browser + ': one fingerprint profile stylesheet');
  check(options.includes('href="api-configuration-ui.css"') && options.includes('href="webrtc-configuration-ui.css"') && options.includes('href="management-ui.css"'), browser + ': shared editor and navigation styles remain linked');
  const ui = read(directory, 'antidetect-ui.js').toString(); assert.doesNotMatch(ui, /Anti-Detect/); assert.match(ui, /children: 'Antidetect'/); assert.match(ui, /createAntidetectController/);
  const registration = read(directory, 'api-custom-registration.js').toString(); for (const id of ['webrtc', 'websocket', 'webtransport']) assert.ok(registration.includes(id), browser + ': protocol guard registration ' + id);
  for (const language of PRODUCTION_LANGUAGES) {
    const file = (language.uiOnly ? 'ui-locales/' : '_locales/') + language.id + '/messages.json', bytes = read(directory, file), sourceBytes = read(source, file);
    assert.ok(bytes.equals(sourceBytes), browser + ': exact locale copy ' + language.id);
    const table = JSON.parse(bytes), expected = applyFingerprintCopy(applyMathCopy(applyAntidetectCopy(clone(table), language.id), language.id), language.id);
    for (const key of localeKeys) { assert.equal(table[key]?.message, expected[key].message, browser + ': localized ' + language.id + '/' + key); assert.ok(table[key].message.trim()); assert.doesNotMatch(table[key].message, /Anti-Detect/); }
    assert.equal(table.protection_feature_math_transcendentals.message, table.antidetect_math_title.message, browser + ': localized generic Math API row ' + language.id);
    assert.equal(table.management_tab_antidetect.message, 'Antidetect');
    assert.equal(table.antidetect_category_profiles.message, table.fingerprint_title.message, browser + ': localized fingerprint category aliases its title ' + language.id);
    const embedded = read(directory, 'options.js').toString();
    for (const key of localeKeys) { assert.ok(embedded.includes(JSON.stringify(key)), browser + ': embedded key ' + language.id + '/' + key); assert.ok(embedded.includes(JSON.stringify(table[key].message)), browser + ': embedded translated value ' + language.id + '/' + key); }
    result.locales.push({ browser, locale: language.id, antidetectMessages: localeKeys.length, sha256: sha(bytes) });
  }
  const evidencePath = evidenceFile(browser + '-evidence', 'antidetect/ui-' + browser + '.json');
  const evidence = readNative(evidencePath, browser + ': native UI (or --' + browser + '-evidence)'); assert.equal(evidence.result, 'PASS', browser + ': native UI result'); assert.equal(evidence.browser, browser);
  for (const [file, expected] of Object.entries(evidence.hashes)) assert.equal(sha(read(directory, file)), expected, browser + ': native-tested bytes → dist ' + file);
  result.native.push({ browser, path: evidencePath, checks: evidence.checks.length, hashes: Object.keys(evidence.hashes).length, nativeVersion: evidence.version });
  const version = JSON.parse(String(read(directory, 'manifest.json'))).version;
  const path = join(root, 'release/Detect.Expert-' + version + '-' + browser + '.zip'), bytes = readFileSync(path);
  assert.equal(sha(archiveProduction(directory)), sha(bytes), browser + ': complete deterministic archive exactly equals final dist');
  result.archives.push({ browser, path, bytes: bytes.length, sha256: sha(bytes) });
}
const protocolPath = evidenceFile('protocol-evidence', 'antidetect/protocol-native-chrome.json'), protocol = readNative(protocolPath, 'chrome: native protocol');
assert.equal(protocol.result, 'PASS'); for (const [file, expected] of Object.entries(protocol.hashes)) assert.equal(sha(read(source, file)), expected, 'native protocol fixture → final source ' + file);
result.native.push({ browser: 'chrome', path: protocolPath, checks: protocol.checks.length, hashes: Object.keys(protocol.hashes).length, scope: 'native DNR with actual owned HTTP/Window/worker WebSocket traffic' });
for (const browser of ['chrome', 'firefox']) {
  const path = evidenceFile('math-' + browser + '-evidence', 'math-transcendentals/' + browser + '.json');
  const evidence = readNative(path, browser + ': native Math'); assert.equal(evidence.result, 'PASS', browser + ': native Math result');
  assert.equal(evidence.functions, API_MATH_FUNCTIONS.length, browser + ': the native Math run covered every Math function of the contract');
  assert.ok(evidence.hashes && Object.keys(evidence.hashes).length, browser + ': native Math evidence pins product files');
  for (const [file, expected] of Object.entries(evidence.hashes)) assert.equal(sha(read(join(root, 'dist', browser), file)), expected, browser + ': native Math-tested bytes → final dist ' + file);
  result.native.push({ browser, path, checks: evidence.checks?.length ?? evidence.scenarios?.length ?? 0, hashes: Object.keys(evidence.hashes).length, scope: 'native Math semantic and registration evidence' });
}
const nativeRequiredHashes = {
  fingerprint: ['fingerprint-profiles.js', 'fingerprint-profiles-controller.js', 'fingerprint-profile-ui.js', 'fingerprint-profile-ui.css', 'fingerprint-library-ui.js', 'fingerprint-library-ui.css', 'api-configuration.js', 'options.js'],
  canvas: ['api-custom-canvas-runtime.js', 'api-custom-canvas-opaque.entry.js', 'api-custom-opaque.canvas-readback.js', 'canvas-profile-seed.js', 'api-custom-registration.js', 'api-configuration.js'],
  'custom-value-composition': ['hook.early.js', 'hook.main.js', 'api-custom-document-runtime.js', 'api-custom-runtime.js', 'api-custom-canvas-runtime.js', 'api-custom-webrtc-runtime.js', 'api-custom-math-runtime.js', 'api-custom-registration.js']
};
const compositionCases = ['early-inactive-positive', 'early-observer-first', 'early-custom-first',
  'main-inactive-positive', 'main-observer-first', 'main-custom-first',
  'early-metadata-only-observer-first', 'early-metadata-only-custom-first', 'early-late-queued',
  'early-inherited-blank-child', 'early-opaque-observer-first', 'early-opaque-custom-first'];
for (const browser of ['chrome', 'firefox']) for (const [feature, defaultPath, scope] of [
  ['fingerprint', 'antidetect-profiles/profiles-' + browser + '.json', 'native fingerprint profile preview, CAS persistence and application evidence'],
  ['canvas', 'antidetect-profiles/canvas-' + browser + '.json', 'native Canvas readback semantics and early registration evidence'],
  ['custom-value-composition', 'antidetect-profiles/custom-value-composition-' + browser + '.json', 'production observer and active Custom value channels in both installation orders']
]) {
  const path = evidenceFile(feature + '-' + browser + '-evidence', defaultPath);
  const evidence = readNative(path, browser + ': native ' + feature); assert.equal(evidence.result, 'PASS', browser + ': native ' + feature + ' result'); assert.equal(evidence.browser, browser, browser + ': native ' + feature + ' browser');
  assert.ok(evidence.hashes && Object.keys(evidence.hashes).length, browser + ': native ' + feature + ' evidence pins product files');
  const requiredHashes = nativeRequiredHashes[feature];
  if (feature === 'custom-value-composition') {
    assert.equal(evidence.sourceDistMatch, true, browser + ': composition evidence ran the final delivery');
    assert.match(evidence.version ?? '', /^\d+\./, browser + ': composition evidence includes native version');
    assert.deepEqual(evidence.checks, compositionCases, browser + ': all production early/main, metadata-only, queued, inherited and opaque composition cases pass');
    assert.equal(evidence.ownedLocalhostOnly, true, browser + ': composition uses owned local fixtures');
    assert.equal(evidence.rawValuesPersisted, false, browser + ': composition evidence contains no raw native metadata');
  }
  for (const file of requiredHashes) assert.match(evidence.hashes[file] ?? '', /^[a-f0-9]{64}$/, browser + ': native ' + feature + ' evidence requires hash for ' + file);
  for (const [file, expected] of Object.entries(evidence.hashes)) assert.equal(sha(read(join(root, 'dist', browser), file)), expected, browser + ': native ' + feature + '-tested bytes → final dist ' + file);
  result.native.push({ browser, path, checks: evidence.checks?.length ?? evidence.scenarios?.length ?? 0, hashes: Object.keys(evidence.hashes).length, scope });
}
// The installed branded Chrome run supplements the mandatory bundled Chromium
// gate. If supplied/present, its evidence must pin the same final delivery.
const installedCanvasPath = evidenceFile('canvas-chrome-installed-evidence', 'antidetect-profiles/canvas-chrome-installed.json');
if (installedCanvasPath && existsSync(installedCanvasPath)) {
  const evidence = JSON.parse(readFileSync(installedCanvasPath, 'utf8'));
  assert.equal(evidence.result, 'PASS'); assert.equal(evidence.browser, 'chrome'); assert.equal(evidence.channel, 'chrome');
  assert.match(evidence.version ?? '', /^\d+\./, 'installed Chrome evidence includes its native version');
  for (const file of ['api-custom-canvas-runtime.js', 'api-custom-canvas-opaque.entry.js', 'api-custom-opaque.canvas-readback.js', 'canvas-profile-seed.js', 'api-custom-registration.js', 'api-configuration.js']) assert.match(evidence.hashes?.[file] ?? '', /^[a-f0-9]{64}$/);
  for (const [file, expected] of Object.entries(evidence.hashes)) assert.equal(sha(read(join(root, 'dist/chrome'), file)), expected, 'installed Chrome Canvas-tested bytes → final dist ' + file);
  result.native.push({ browser: 'chrome', nativeVersion: evidence.version, path: installedCanvasPath, checks: evidence.checks?.length ?? 0, hashes: Object.keys(evidence.hashes).length, scope: 'additional installed branded Chrome Canvas evidence' });
}
// Cross-surface consistency of generated profiles (antidetect-consistency-native.mjs): a complete, unmutated run on the final dist.
for (const browser of ['chrome', 'firefox']) {
  const path = evidenceFile('consistency-' + browser + '-evidence', 'antidetect-consistency/' + browser + '.json'), evidence = readNative(path, browser + ': native consistency');
  assert.equal(evidence.result, 'PASS', browser + ': consistency result'); assert.equal(evidence.browser, browser); assert.equal(evidence.complete, true); assert.equal(evidence.mutation, null);
  assert.deepEqual(evidence.unexpected, [], browser + ': no unexpected inconsistency'); assert.deepEqual(evidence.staleLimits, [], browser + ': no stale known limit');
  for (const [file, expected] of Object.entries(evidence.hashes)) assert.equal(sha(read(join(root, 'dist', browser), file)), expected, browser + ': consistency-tested bytes → final dist ' + file);
  result.native.push({ browser, path, checks: evidence.runs.length, hashes: Object.keys(evidence.hashes).length, knownLimits: evidence.knownLimits.map(item => item.check), scope: 'generated profiles agree across realms, headers and workers' });
}
result.legacyEvidence = result.native.filter(item => /production-1\.1\.0/u.test(item.path)).map(item => item.path);
const output = writeEvidence('antidetect/package.json', result);
console.log('PASS Antidetect package: ' + result.matches.length + ' exact source/dist files; ' + result.locales.length + ' locale deliveries × ' + localeKeys.length + ' messages; ' + result.migrations.length + ' historical migration states; build-derived manifests; native UI/profile/Canvas/composition/consistency hashes and complete ZIPs -> ' + output);
function clone(value) { return JSON.parse(JSON.stringify(value)); }
