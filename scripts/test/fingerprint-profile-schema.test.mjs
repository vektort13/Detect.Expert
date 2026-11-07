// E22-19 / ADR-066: portable profile books stay inside the existing bounded configuration.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  API_CONFIG_CATALOG, API_CONFIG_CATALOG_V1, API_CONFIG_CATALOG_V2, API_CONFIG_CATALOG_V3,
  API_CONFIG_CATALOG_V4, API_CONFIG_CATALOG_V5, API_CONFIG_CATALOG_V6, API_CONFIGURATION_VERSION,
  API_CONFIGURATION_CATALOG_VERSION, API_CONFIGURATION_MAX_PROFILES,
  API_CONFIGURATION_MAX_BYTES, createApiConfiguration, validateApiConfiguration,
  validateApiValue, upgradeApiConfiguration, exportApiConfiguration,
  importApiConfiguration, diffApiConfigurations, updateApiConfiguration
} from '../../packages/contracts/src/api-configuration.mjs';

const copy = value => structuredClone(value);
const id = number => 'fp-' + number.toString(16).padStart(32, '0');
function profile(config = createApiConfiguration(), number = 1) {
  return { id: id(number), label: 'Profile ' + number, preset: config.preset, webrtcNetworkPolicy: config.webrtcNetworkPolicy,
    apis: config.apis.map(({ id: apiId, mode, selected, settings }) => ({ id: apiId, mode, selected: copy(selected), settings: copy(settings) })), tags: [], note: '' };
}
function historical(formatVersion = 3, catalogVersion = 5) {
  const config = createApiConfiguration();
  const catalog = { 1: API_CONFIG_CATALOG_V1, 2: API_CONFIG_CATALOG_V2, 3: API_CONFIG_CATALOG_V3, 4: API_CONFIG_CATALOG_V4, 5: API_CONFIG_CATALOG_V5 }[catalogVersion];
  config.formatVersion = formatVersion; config.catalogVersion = catalogVersion; delete config.fingerprintProfiles; delete config.antidetectEnabled;
  if (formatVersion === 1) delete config.webrtcNetworkPolicy;
  config.apis = catalog.map(entry => ({ ...copy(entry), mode: 'bypass', selected: { kind: 'unset' }, userValues: [], settings: {} }));
  return config;
}
const row = (profile, name) => profile.apis.find(api => api.id === name);

test('frozen catalog6 keeps catalogue5 pinned and changes only Canvas metadata; current IDs retain the full prefix', () => {
  assert.equal(createApiConfiguration().formatVersion, API_CONFIGURATION_VERSION); assert.equal(createApiConfiguration().catalogVersion, API_CONFIGURATION_CATALOG_VERSION);
  assert.equal(API_CONFIG_CATALOG_V5.length, 143); assert.equal(API_CONFIG_CATALOG_V6.length, 143);
  assert.equal(createHash('sha256').update(JSON.stringify(API_CONFIG_CATALOG_V5)).digest('hex'), 'c10b94ac123076d428a254367649a4cc168c97947aa3787bf41f9b320bccf7e1');
  assert.ok(Object.isFrozen(API_CONFIG_CATALOG_V5)); assert.ok(Object.isFrozen(API_CONFIG_CATALOG_V5[142].presets));
  assert.deepEqual(API_CONFIG_CATALOG_V6.map(api => [api.id, api.order]), API_CONFIG_CATALOG_V5.map(api => [api.id, api.order]));
  assert.deepEqual(API_CONFIG_CATALOG_V6.filter(api => api.id !== 'canvas-readback'), API_CONFIG_CATALOG_V5.filter(api => api.id !== 'canvas-readback'));
  assert.deepEqual(API_CONFIG_CATALOG.slice(0, API_CONFIG_CATALOG_V6.length).map(api => [api.id, api.order]), API_CONFIG_CATALOG_V6.map(api => [api.id, api.order]));
  assert.equal(API_CONFIG_CATALOG_V5.find(api => api.id === 'canvas-readback').customSupported, false);
  assert.equal(API_CONFIG_CATALOG.find(api => api.id === 'canvas-readback').type, 'canvas-projection');
});

test('profiles are an explicit complete field, ordered by stable IDs with rows in catalogue order', () => {
  const config = createApiConfiguration(); assert.deepEqual(config.fingerprintProfiles, []);
  config.fingerprintProfiles = [profile(config, 9), profile(config, 2)];
  config.fingerprintProfiles[0].apis.reverse();
  const result = validateApiConfiguration(config); assert.equal(result.ok, true, result.error?.message);
  assert.deepEqual(result.value.fingerprintProfiles.map(item => item.id), [id(2), id(9)]);
  for (const saved of result.value.fingerprintProfiles) assert.deepEqual(saved.apis.map(api => api.id), API_CONFIG_CATALOG.map(api => api.id));
  const missing = createApiConfiguration(); delete missing.fingerprintProfiles;
  assert.equal(validateApiConfiguration(missing).error.code, 'missing-field');
});

test('format3/catalog5 strictly upgrades values, libraries and site overrides once, adding an empty book', () => {
  const old = historical(), cpu = row(old, 'hardware-concurrency'); old.enabled = true; old.preset = 'custom';
  cpu.mode = 'custom'; cpu.selected = { kind: 'value', value: 16 }; cpu.userValues = [{ id: 'saved', label: 'Saved', value: copy(cpu.selected) }];
  old.sites = [{ host: 'exact.fixture.invalid', disabled: true, apis: profile(old).apis }];
  const retained = copy(old), result = upgradeApiConfiguration(old);
  assert.equal(result.ok, true, result.error?.message); assert.equal(result.migrated, true);
  assert.equal(result.value.formatVersion, API_CONFIGURATION_VERSION); assert.equal(result.value.catalogVersion, API_CONFIGURATION_CATALOG_VERSION); assert.deepEqual(result.value.fingerprintProfiles, []);
  for (const previous of retained.apis) {
    const current = row(result.value, previous.id);
    assert.equal(current.mode, previous.mode); assert.deepEqual(current.selected, previous.selected); assert.deepEqual(current.userValues, previous.userValues);
  }
  for (const previous of old.sites) {
    const current = result.value.sites.find(site => site.host === previous.host);
    assert.deepEqual({ ...current, apis: current.apis.slice(0, previous.apis.length) }, previous);
    assert.equal(current.apis.length, API_CONFIG_CATALOG.length);
    for (const added of current.apis.slice(previous.apis.length)) assert.deepEqual(added, { id: added.id, mode: 'bypass', selected: { kind: 'unset' }, settings: {} });
  }
  assert.deepEqual(old, retained);
  assert.equal(upgradeApiConfiguration(result.value).migrated, false);
  assert.equal(validateApiConfiguration(old).error.code, 'incompatible-version');
});

test('all published historical format/catalog pairs migrate; malformed 3/5 and unpublished 4/5 do not', () => {
  for (const [format, catalog] of [[1, 1], [1, 2], [2, 3], [3, 4], [3, 5]]) {
    const result = importApiConfiguration(JSON.stringify(historical(format, catalog)));
    assert.equal(result.ok, true, format + '/' + catalog + ': ' + result.error?.message);
    assert.equal(result.migrated, true); assert.equal(result.value.formatVersion, API_CONFIGURATION_VERSION); assert.equal(result.value.catalogVersion, API_CONFIGURATION_CATALOG_VERSION); assert.deepEqual(result.value.fingerprintProfiles, []);
  }
  for (const mutate of [
    value => { value.apis[0].order++; }, value => { value.apis.pop(); }, value => { value.fingerprintProfiles = []; },
    value => { value.formatVersion = 4; }, value => { row(value, 'canvas-readback').customSupported = true; },
    value => { row(value, 'canvas-readback').mode = 'custom'; row(value, 'canvas-readback').selected = { kind: 'value', value: { algorithm: 'stable-rgb-v1' } }; }
  ]) {
    const old = historical(); mutate(old); const retained = copy(old);
    assert.equal(upgradeApiConfiguration(old).ok, false); assert.deepEqual(old, retained);
  }
});

test('a valid near-limit format3/catalog5 file reports additive upgrade failure without dropping saved libraries', () => {
  const old = historical();
  const ids = ['hardware-concurrency', 'device-memory', 'touch-points', 'screen-extended', 'navigator-platform', 'navigator-user-agent', 'navigator-language', 'navigator-languages', 'navigator-vendor', 'navigator-app-version', 'navigator-oscpu', 'screen-width', 'screen-height', 'screen-avail-width', 'screen-avail-height', 'screen-color-depth', 'screen-pixel-depth', 'window-device-pixel-ratio', 'notifications', 'autoplay-policy'];
  for (const name of ids) {
    const api = row(old, name);
    api.userValues = Array.from({ length: 1000 }, (_, index) => ({ id: 'saved-' + index, label: 'x'.repeat(100), value: copy(api.presets[0].value) }));
  }
  let remaining = API_CONFIGURATION_MAX_BYTES - 32 - Buffer.byteLength(JSON.stringify(old));
  assert.ok(remaining > 0);
  for (const api of old.apis) for (const saved of api.userValues) {
    const added = Math.min(60, remaining); saved.label += 'x'.repeat(added); remaining -= added;
  }
  assert.equal(remaining, 0);
  const source = JSON.stringify(old), result = upgradeApiConfiguration(old);
  assert.equal(result.ok, false); assert.equal(result.error.code, 'size-limit'); assert.equal(result.upgradeFailure, true);
  assert.equal(Object.hasOwn(result, 'value'), false); assert.equal(JSON.stringify(old), source);
});

test('profile identities, labels, presets and network policies are bounded data without nested global settings', () => {
  for (const mutate of [
    saved => { saved.id = 'fp-' + 'A'.repeat(32); }, saved => { saved.id = 'fp-' + '0'.repeat(31); },
    saved => { saved.label = ''; }, saved => { saved.label = 'a'.repeat(161); }, saved => { saved.label = 3; },
    saved => { saved.preset = 'recommended'; }, saved => { saved.webrtcNetworkPolicy = 'all-udp-off'; },
    saved => { delete saved.tags; }, saved => { delete saved.note; }, saved => { saved.tags = 'work'; }, saved => { saved.tags = [3]; }, saved => { saved.note = 3; },
    saved => { saved.enabled = true; }, saved => { saved.antidetectEnabled = true; }, saved => { saved.sites = []; }, saved => { saved.userValues = []; },
    saved => { saved.mathSeed = 'aa'.repeat(32); }, saved => { saved.revision = 2; }
  ]) {
    const config = createApiConfiguration(), saved = profile(config); mutate(saved); config.fingerprintProfiles = [saved];
    assert.equal(validateApiConfiguration(config).ok, false);
  }
});

test('profile APIs require every ID once and enforce the same supported modes and typed values', () => {
  for (const mutate of [
    saved => { saved.apis.pop(); }, saved => { saved.apis[1] = copy(saved.apis[0]); },
    saved => { saved.apis[0].id = 'foreign-api'; }, saved => { saved.apis[0].settings = { seed: 'not allowed' }; },
    saved => { saved.apis[0].userValues = []; }, saved => { row(saved, 'hardware-concurrency').mode = 'custom'; },
    saved => { row(saved, 'hardware-concurrency').selected = { kind: 'value', value: -1 }; },
    saved => { row(saved, 'math-transcendentals').mode = 'on'; }, saved => { row(saved, 'audio').mode = 'custom'; }
  ]) {
    const config = createApiConfiguration(), saved = profile(config); mutate(saved); config.fingerprintProfiles = [saved];
    assert.equal(validateApiConfiguration(config).ok, false);
  }
});

test('dormant profiles validate RTC/media conflicts independently from a disabled master or other active rows', () => {
  const config = createApiConfiguration(), saved = profile(config); assert.equal(config.enabled, false);
  const rtc = row(saved, 'webrtc'); rtc.mode = 'custom'; rtc.selected = copy(config.apis.find(api => api.id === 'webrtc').presets[3].value);
  const media = row(saved, 'media-enumeration'); media.mode = 'custom'; media.selected = { kind: 'value', value: [] };
  config.fingerprintProfiles = [saved];
  const rejected = validateApiConfiguration(config); assert.equal(rejected.error.code, 'conflicting-webrtc-devices');
  assert.equal(rejected.error.path, '$.fingerprintProfiles[0].apis');
  media.mode = 'off'; assert.equal(validateApiConfiguration(config).ok, true);
});

test('profile import rejects duplicate identities and JSON fields without mutating existing configuration', () => {
  const config = createApiConfiguration(), saved = profile(config); config.fingerprintProfiles = [saved, copy(saved)];
  assert.equal(validateApiConfiguration(config).error.code, 'duplicate-profile');
  config.fingerprintProfiles = [saved]; const retained = copy(config), source = exportApiConfiguration(config);
  const duplicate = source.replace('"label": "Profile 1"', '"label": "Profile 1", "label": "Overwritten"');
  assert.equal(importApiConfiguration(duplicate).error.code, 'duplicate-field'); assert.deepEqual(config, retained);
});

test('profile accessors, symbols, sparse rows and executable coercion are never evaluated', () => {
  let calls = 0;
  for (const mutate of [
    saved => { Object.defineProperty(saved, 'label', { get() { calls++; return 'Profile'; }, enumerable: true }); },
    saved => { Object.defineProperty(saved.apis[0], 'mode', { get() { calls++; return 'off'; }, enumerable: true }); },
    saved => { saved.label = { toString() { calls++; return 'Profile'; } }; },
    saved => { delete saved.apis[1]; }, saved => { saved[Symbol('private')] = 1; }
  ]) {
    const config = createApiConfiguration(), saved = profile(config); mutate(saved); config.fingerprintProfiles = [saved];
    assert.equal(validateApiConfiguration(config).ok, false); assert.equal(calls, 0);
  }
});

test('full profile books preserve empty/null/undefined selected values, canonical order and deterministic export', () => {
  const config = createApiConfiguration(), first = profile(config, 2), second = profile(config, 1);
  row(first, 'navigator-vendor').selected = { kind: 'value', value: '' };
  row(first, 'webgpu').selected = { kind: 'null' }; row(first, 'navigator-oscpu').selected = { kind: 'undefined' };
  row(first, 'math-transcendentals').selected = { kind: 'value', value: { algorithm: 'deterministic-ulp-v1', functions: ['pow', 'sin', 'acos'] } };
  config.fingerprintProfiles = [first, second];
  const source = exportApiConfiguration(config), imported = importApiConfiguration(source);
  assert.equal(imported.ok, true); assert.equal(imported.migrated, false); assert.equal(exportApiConfiguration(imported.value), source);
  const reordered = copy(config); reordered.fingerprintProfiles.reverse(); for (const saved of reordered.fingerprintProfiles) saved.apis.reverse();
  assert.equal(exportApiConfiguration(reordered), source);
  assert.equal(source.includes('mathSeed'), false); assert.equal(source.includes('deviceSeed'), false); assert.equal(source.includes('certificateFingerprint'), false);
});

test('the 128-profile bound and shared UTF-8 byte budget apply to the complete book', () => {
  const config = createApiConfiguration(); assert.equal(API_CONFIGURATION_MAX_PROFILES, 128);
  config.fingerprintProfiles = Array.from({ length: 128 }, (_, index) => profile(config, index + 1));
  const checked = validateApiConfiguration(config); assert.equal(checked.ok, true, checked.error?.message);
  assert.ok(Buffer.byteLength(exportApiConfiguration(checked.value)) <= API_CONFIGURATION_MAX_BYTES);
  config.fingerprintProfiles.push(profile(config, 129)); assert.equal(validateApiConfiguration(config).ok, false);
  config.fingerprintProfiles.pop();
  for (const saved of config.fingerprintProfiles) {
    const ua = row(saved, 'navigator-user-agent'); ua.selected = { kind: 'value', value: 'あ'.repeat(1024) };
    const app = row(saved, 'navigator-app-version'); app.selected = { kind: 'value', value: 'あ'.repeat(1024) };
  }
  // A crowded book shares the same budget with existing custom libraries.
  const cpu = row(config, 'hardware-concurrency');
  cpu.userValues = Array.from({ length: 1000 }, (_, index) => ({ id: 'cpu-' + index, label: 'あ'.repeat(160), value: { kind: 'value', value: 16 } }));
  const platform = row(config, 'navigator-platform');
  platform.userValues = Array.from({ length: 1000 }, (_, index) => ({ id: 'platform-' + index, label: 'あ'.repeat(160), value: { kind: 'value', value: 'あ'.repeat(1024) } }));
  assert.equal(validateApiConfiguration(config).error.code, 'size-limit');
});

test('profile-book diff is canonical and ordinary API edits preserve the complete book', () => {
  const before = createApiConfiguration(), after = copy(before); after.fingerprintProfiles = [profile(after)];
  const diff = diffApiConfigurations(before, after); assert.equal(diff.ok, true);
  assert.deepEqual(diff.value.map(change => [change.scope, change.id, change.field]), [['global', null, 'fingerprintProfiles']]);
  const changed = updateApiConfiguration(after, 'hardware-concurrency', { mode: 'custom', selected: { kind: 'value', value: 16 } });
  assert.equal(changed.ok, true); assert.deepEqual(changed.value.fingerprintProfiles, after.fingerprintProfiles);
});

test('Canvas profile accepts only the declared algorithm and historical files cannot smuggle the new value', () => {
  assert.equal(validateApiValue('canvas-readback', { kind: 'value', value: { algorithm: 'stable-rgb-v1' } }).ok, true);
  for (const value of [{ algorithm: 'random' }, { algorithm: 'stable-rgb-v1', seed: 'forbidden' }, null, []]) {
    assert.equal(validateApiValue('canvas-readback', { kind: 'value', value }).ok, false);
  }
  const old = historical(); row(old, 'canvas-readback').mode = 'custom'; row(old, 'canvas-readback').selected = { kind: 'value', value: { algorithm: 'stable-rgb-v1' } };
  assert.equal(upgradeApiConfiguration(old).error.code, 'unsupported-value');
});
