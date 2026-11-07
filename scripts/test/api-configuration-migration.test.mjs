// ADR-059: strict historical catalogue validation, then additive migration.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  API_CONFIG_CATALOG, API_CONFIG_CATALOG_V1, API_CONFIG_CATALOG_V2, API_CONFIG_CATALOG_V4, API_CONFIG_CATALOG_V5, API_CONFIG_CATALOG_V6, API_CONFIGURATION_VERSION, API_CONFIGURATION_CATALOG_VERSION, API_CONFIGURATION_MAX_BYTES, createApiConfiguration,
  validateApiConfiguration, upgradeApiConfiguration, importApiConfiguration,
  exportApiConfiguration, configurationToLegacy, effectiveApiConfiguration
} from '../../packages/contracts/src/api-configuration.mjs';
import { PROTECTION_FEATURES_V1 } from '../../packages/contracts/src/protection-features.mjs';
import { WASM_SURFACES } from '../../packages/contracts/src/webassembly-apis.mjs';

const clone = value => JSON.parse(JSON.stringify(value));
const selected = value => ({ kind: 'value', value });
const api = (config, id) => config.apis.find(row => row.id === id);
function historical(version = 1) {
  const value = createApiConfiguration();
  value.formatVersion = 1; value.catalogVersion = version; delete value.webrtcNetworkPolicy; delete value.fingerprintProfiles; delete value.antidetectEnabled;
  value.apis = (version === 1 ? API_CONFIG_CATALOG_V1 : API_CONFIG_CATALOG_V2).map(entry => ({ ...clone(entry), mode: 'bypass', userValues: [], selected: { kind: 'unset' }, settings: {} }));
  value.enabled = true; value.preset = 'custom';
  api(value, 'hardware-concurrency').mode = 'custom';
  api(value, 'hardware-concurrency').selected = selected(16);
  api(value, 'hardware-concurrency').userValues = Array.from({ length: 100 }, (_, index) => ({ id: 'cpu-' + index, label: 'CPU ' + index, value: selected(index + 1) }));
  for (const [id, chosen] of [['navigator-vendor', selected('')], ['navigator-oscpu', { kind: 'undefined' }], ['webgpu', { kind: 'null' }]]) {
    api(value, id).selected = chosen;
    api(value, id).userValues = [{ id: 'saved', label: 'Saved', value: chosen }];
  }
  const siteRows = () => value.apis.map(row => ({ id: row.id, mode: 'bypass', selected: { kind: 'unset' }, settings: {} }));
  const disabled = { host: 'disabled.example', disabled: true, apis: siteRows() };
  const active = { host: 'active.example', disabled: false, apis: siteRows() };
  active.apis.find(row => row.id === 'hardware-concurrency').mode = 'custom';
  active.apis.find(row => row.id === 'hardware-concurrency').selected = selected(8);
  value.sites = [disabled, active];
  return value;
}

test('historical 105-record schema metadata is byte-for-byte pinned before Wasm expansion', () => {
  assert.equal(API_CONFIG_CATALOG_V1.length, 105);
  assert.equal(PROTECTION_FEATURES_V1.length, 89);
  assert.equal(createHash('sha256').update(JSON.stringify(API_CONFIG_CATALOG_V1)).digest('hex'), 'b3e069dab278027ebecbe06af3dd5b2642b5d9b5b84061230253df87dfbeecc4');
  assert.deepEqual(API_CONFIG_CATALOG_V2.slice(0, 105), API_CONFIG_CATALOG_V1);
  assert.ok(Object.isFrozen(API_CONFIG_CATALOG_V1));
});

test('valid catalogue v1 upgrades all scopes without discarding libraries or any selected state', () => {
  const before = historical(), retained = clone(before), upgraded = upgradeApiConfiguration(before);
  assert.equal(upgraded.ok, true, upgraded.error?.message);
  assert.equal(upgraded.migrated, true); assert.equal(upgraded.value.catalogVersion, API_CONFIGURATION_CATALOG_VERSION); assert.equal(upgraded.value.formatVersion, API_CONFIGURATION_VERSION);
  assert.equal(upgraded.value.webrtcNetworkPolicy, 'system');
  assert.deepEqual(before, retained, 'upgrade never mutates its input');
  assert.deepEqual(upgraded.value.apis.slice(0, 105), retained.apis.map(row => ({ ...clone(API_CONFIG_CATALOG.find(entry => entry.id === row.id)), mode: row.mode,
    userValues: [...row.userValues].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0), selected: row.selected, settings: row.settings })));
  assert.equal(upgraded.value.enabled, true); assert.equal(upgraded.value.preset, 'custom');
  assert.equal(api(upgraded.value, 'hardware-concurrency').userValues.length, 100);
  assert.deepEqual(api(upgraded.value, 'navigator-vendor').selected, selected(''));
  assert.deepEqual(api(upgraded.value, 'navigator-oscpu').selected, { kind: 'undefined' });
  assert.deepEqual(api(upgraded.value, 'webgpu').selected, { kind: 'null' });
  for (const site of upgraded.value.sites) {
    assert.equal(site.apis.length, API_CONFIG_CATALOG.length);
    assert.equal(site.disabled, retained.sites.find(row => row.host === site.host).disabled);
    assert.deepEqual(site.apis.slice(0, 105), retained.sites.find(row => row.host === site.host).apis);
  }
  for (const row of upgraded.value.apis.slice(105, 142)) {
    assert.equal(row.mode, 'bypass'); assert.equal(row.customSupported, false);
    assert.deepEqual(row.selected, { kind: 'unset' }); assert.deepEqual(row.userValues, []);
    for (const site of upgraded.value.sites) assert.deepEqual(site.apis.find(entry => entry.id === row.id), { id: row.id, mode: 'bypass', selected: { kind: 'unset' }, settings: {} });
  }
  const again = upgradeApiConfiguration(upgraded.value);
  assert.equal(again.migrated, false); assert.deepEqual(again.value, upgraded.value);
  assert.equal(validateApiConfiguration(upgraded.value).ok, true);
  assert.equal(validateApiConfiguration(before).error.code, 'incompatible-version', 'live writes require current catalogue');
});

test('historical exports import once, then export deterministically in catalogue v6', () => {
  const old = historical(), first = importApiConfiguration(JSON.stringify(old));
  assert.equal(first.ok, true); assert.equal(first.migrated, true);
  old.apis.reverse(); old.sites.reverse();
  for (const site of old.sites) site.apis.reverse();
  for (const row of old.apis) row.userValues.reverse();
  const reordered = importApiConfiguration(JSON.stringify(old));
  assert.equal(reordered.ok, true);
  const serialized = exportApiConfiguration(first.value);
  assert.equal(exportApiConfiguration(reordered.value), serialized);
  const current = importApiConfiguration(serialized);
  assert.equal(current.ok, true); assert.equal(current.migrated, false);
  assert.equal(exportApiConfiguration(current.value), serialized);
});

test('invalid historical metadata, IDs, duplicates and missing fields fail before migration', () => {
  const cases = [
    [value => { value.apis.pop(); }, 'missing-api'],
    [value => { value.apis[1] = clone(value.apis[0]); }, 'duplicate-api'],
    [value => { value.apis[0].id = WASM_SURFACES[0].feature; }, 'unknown-api'],
    [value => { value.apis[0].order++; }, 'catalog-mismatch'],
    [value => { api(value, 'hardware-concurrency').presets[0].value = selected(999); }, 'catalog-mismatch'],
    [value => { delete value.apis[0].selected; }, 'missing-field'],
    [value => { value.sites[0].apis.pop(); }, 'missing-api'],
    [value => { value.sites[0].apis[0].id = WASM_SURFACES[0].feature; }, 'unknown-api'],
    [value => { value.sites.push(clone(value.sites[0])); }, 'duplicate-host'],
    [value => { value.catalogVersion = 0; }, 'incompatible-version'],
    [value => { value.formatVersion = 2; }, 'incompatible-version']
  ];
  for (const [mutate, code] of cases) {
    const invalid = historical(); mutate(invalid); const untouched = clone(invalid);
    assert.equal(upgradeApiConfiguration(invalid).error.code, code);
    assert.equal(importApiConfiguration(JSON.stringify(invalid)).error.code, code);
    assert.deepEqual(invalid, untouched);
  }
  const duplicateKey = JSON.stringify(historical()).replace('"catalogVersion":1', '"catalogVersion":1,"catalogVersion":2');
  assert.equal(importApiConfiguration(duplicateKey).error.code, 'duplicate-field');
  const accessor = historical(); Object.defineProperty(accessor, 'catalogVersion', { get() { throw new Error('not data'); } });
  assert.equal(upgradeApiConfiguration(accessor).ok, false);
});

test('legacy parent rules migrate unchanged, granular choices stay absent from original presets', () => {
  const legacy = { schemaVersion: 1, revision: 7, enabled: true, preset: 'strict', global: [{ feature: 'webassembly', state: 'block' }], sites: [] };
  const migrated = importApiConfiguration(JSON.stringify(legacy));
  assert.equal(migrated.ok, true); assert.equal(migrated.migrated, true);
  assert.deepEqual(configurationToLegacy(migrated.value, legacy), legacy);
  assert.equal(api(migrated.value, 'webassembly').mode, 'on');
  for (const feature of WASM_SURFACES.map(row => row.feature)) assert.equal(api(migrated.value, feature).mode, 'bypass');
  for (const preset of ['limited', 'strict']) {
    const config = createApiConfiguration(); config.enabled = true; config.preset = preset;
    assert.deepEqual(effectiveApiConfiguration(config, 'example.com').filter(row => row.id.startsWith('webassembly-') && row.mode !== 'off'), []);
  }
  legacy.global.push({ feature: WASM_SURFACES[0].feature, state: 'block' });
  const granular = importApiConfiguration(JSON.stringify(legacy));
  assert.equal(granular.ok, true);
  assert.deepEqual(configurationToLegacy(granular.value, legacy), legacy);
});

test('valid historical file near 4 MiB fails its additive upgrade explicitly without returning a lossy value', () => {
  const previous = historical(); previous.sites = []; previous.enabled = false;
  for (const row of previous.apis.filter(row => row.customSupported && row.presets.length).slice(0, 20)) {
    row.userValues = Array.from({ length: 1000 }, (_, index) => ({ id: 'custom-' + index, label: 'x'.repeat(100), value: clone(row.presets[0].value) }));
  }
  let remaining = API_CONFIGURATION_MAX_BYTES - 1024 - Buffer.byteLength(JSON.stringify(previous));
  assert.ok(remaining > 0);
  for (const row of previous.apis) for (const user of row.userValues) {
    const addition = Math.min(60, remaining); user.label += 'x'.repeat(addition); remaining -= addition;
  }
  assert.equal(remaining, 0); assert.ok(Buffer.byteLength(JSON.stringify(previous)) < API_CONFIGURATION_MAX_BYTES);
  const retained = JSON.stringify(previous), result = upgradeApiConfiguration(previous);
  assert.equal(result.ok, false); assert.equal(result.error.code, 'size-limit');
  assert.equal(result.upgradeFailure, true, 'marker is set only after complete historical validation succeeded');
  assert.equal(Object.hasOwn(result, 'value'), false); assert.equal(JSON.stringify(previous), retained);
  const imported = importApiConfiguration(retained);
  assert.equal(imported.error.code, 'size-limit'); assert.equal(imported.upgradeFailure, true);
  previous.apis[0].order++;
  assert.equal(upgradeApiConfiguration(previous).error.code, 'catalog-mismatch');
  assert.equal(upgradeApiConfiguration(previous).upgradeFailure, undefined, 'malformed historical data is not a validated upgrade failure');
});

test('catalogue v2 historical metadata is pinned; catalogue v4 changes only WebRTC and v5 appends Math', () => {
  assert.equal(API_CONFIG_CATALOG_V2.length, 142);
  assert.equal(createHash('sha256').update(JSON.stringify(API_CONFIG_CATALOG_V2)).digest('hex'), '30118d27ae2c5ba117f4616dd4fbd4cfacd6814410d19a749b10464782aa4ff4');
  assert.deepEqual(API_CONFIG_CATALOG_V4.map(row => [row.id, row.order]), API_CONFIG_CATALOG_V2.map(row => [row.id, row.order]));
  assert.deepEqual(API_CONFIG_CATALOG_V4.filter(row => row.id !== 'webrtc'), API_CONFIG_CATALOG_V2.filter(row => row.id !== 'webrtc'));
  assert.deepEqual(API_CONFIG_CATALOG_V5.slice(0, 142), API_CONFIG_CATALOG_V4);
  assert.deepEqual(API_CONFIG_CATALOG_V6.filter(row => row.id !== 'canvas-readback'), API_CONFIG_CATALOG_V5.filter(row => row.id !== 'canvas-readback'));
  assert.deepEqual(API_CONFIG_CATALOG.slice(0, API_CONFIG_CATALOG_V6.length).map(row => [row.id, row.order]), API_CONFIG_CATALOG_V6.map(row => [row.id, row.order]));
  assert.equal(API_CONFIG_CATALOG[142].id, 'math-transcendentals');
  assert.equal(API_CONFIG_CATALOG_V2.find(row => row.id === 'webrtc').customSupported, false);
  assert.equal(API_CONFIG_CATALOG.find(row => row.id === 'webrtc').customSupported, true);
});

test('catalogue v2 upgrades once without changing modes, values, libraries, Wasm rows or site exceptions', () => {
  for (const mode of ['on', 'off', 'bypass']) {
    const old = historical(2); api(old, 'webrtc').mode = mode;
    api(old, WASM_SURFACES[0].feature).mode = 'on';
    old.sites[0].apis.find(row => row.id === 'webrtc').mode = 'off';
    const retained = clone(old), result = upgradeApiConfiguration(old);
    assert.equal(result.ok, true, result.error?.message); assert.equal(result.migrated, true);
    assert.equal(result.value.formatVersion, API_CONFIGURATION_VERSION); assert.equal(result.value.catalogVersion, API_CONFIGURATION_CATALOG_VERSION); assert.equal(result.value.webrtcNetworkPolicy, 'system');
    assert.deepEqual(result.value.apis.slice(0, 142).map(row => row.id), old.apis.map(row => row.id));
    assert.equal(result.value.apis[142].id, 'math-transcendentals'); assert.equal(result.value.apis[142].mode, 'bypass');
    for (const previous of old.apis) {
      const current = api(result.value, previous.id);
      assert.equal(current.mode, previous.mode); assert.deepEqual(current.selected, previous.selected); assert.deepEqual(current.settings, previous.settings);
      assert.deepEqual(current.userValues, [...previous.userValues].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    }
    for (const site of old.sites) {
      const current = result.value.sites.find(row => row.host === site.host);
      assert.deepEqual({ ...current, apis: current.apis.slice(0, 142) }, site);
      assert.deepEqual(current.apis[142], { id: 'math-transcendentals', mode: 'bypass', selected: { kind: 'unset' }, settings: {} });
    }
    assert.deepEqual(old, retained);
    const direct = importApiConfiguration(JSON.stringify(old)); assert.equal(direct.ok, true); assert.equal(direct.migrated, true);
    assert.equal(exportApiConfiguration(direct.value), exportApiConfiguration(result.value));
    const again = upgradeApiConfiguration(result.value); assert.equal(again.migrated, false); assert.deepEqual(again.value, result.value);
  }
});

test('old schemas reject newly supported WebRTC values in both global and site rows before upgrading', () => {
  const profile = API_CONFIG_CATALOG.find(row => row.id === 'webrtc').presets[0].value;
  for (const version of [1, 2]) {
    for (const location of ['global', 'site', 'library']) {
      const old = historical(version), target = location === 'site' ? old.sites[0].apis.find(row => row.id === 'webrtc') : api(old, 'webrtc');
      if (location === 'library') target.userValues = [{ id: 'new-profile', label: 'New profile', value: clone(profile) }];
      else { target.mode = 'custom'; target.selected = clone(profile); }
      const result = upgradeApiConfiguration(old); assert.equal(result.error.code, 'unsupported-value', version + ':' + location);
      assert.equal(result.upgradeFailure, undefined, 'the historical configuration itself is invalid');
    }
    const changedMetadata = historical(version); api(changedMetadata, 'webrtc').customSupported = true;
    assert.equal(upgradeApiConfiguration(changedMetadata).error.code, 'catalog-mismatch');
    const extraPolicy = historical(version); extraPolicy.webrtcNetworkPolicy = 'disable_non_proxied_udp';
    assert.equal(upgradeApiConfiguration(extraPolicy).error.code, 'unknown-field', 'old formats cannot import a hidden native policy');
  }
  for (const [formatVersion, catalogVersion] of [[1, 3], [2, 1], [2, 2], [2, 4]]) {
    const invalid = createApiConfiguration(); Object.assign(invalid, { formatVersion, catalogVersion });
    assert.equal(upgradeApiConfiguration(invalid).error.code, 'incompatible-version');
  }
});

test('valid near-limit catalogue v2 reports an upgrade failure without dropping data for new metadata', () => {
  const old = historical(2); old.sites = [];
  for (const row of old.apis.filter(row => row.customSupported && row.presets.length).slice(0, 20)) {
    row.userValues = Array.from({ length: 1000 }, (_, index) => ({ id: 'custom-' + index, label: 'x'.repeat(100), value: clone(row.presets[0].value) }));
  }
  let remaining = API_CONFIGURATION_MAX_BYTES - 128 - Buffer.byteLength(JSON.stringify(old));
  assert.ok(remaining > 0);
  for (const row of old.apis) for (const user of row.userValues) { const added = Math.min(60, remaining); user.label += 'x'.repeat(added); remaining -= added; }
  assert.equal(remaining, 0); const retained = JSON.stringify(old), result = upgradeApiConfiguration(old);
  assert.equal(result.error.code, 'size-limit'); assert.equal(result.upgradeFailure, true);
  assert.equal(JSON.stringify(old), retained); assert.equal(Object.hasOwn(result, 'value'), false);
});
