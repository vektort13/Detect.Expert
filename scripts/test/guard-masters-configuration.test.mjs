// E22-22 / ADR-068: independent masters, strict published migration and dormant data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  API_CONFIG_CATALOG, API_CONFIG_CATALOG_V6, API_CONFIGURATION_VERSION, API_CONFIGURATION_CATALOG_VERSION, createApiConfiguration, validateApiConfiguration,
  upgradeApiConfiguration, importApiConfiguration, exportApiConfiguration,
  configurationToLegacy, effectiveApiConfiguration, diffApiConfigurations,
  updateApiConfiguration
} from '../../packages/contracts/src/api-configuration.mjs';

const copy = value => structuredClone(value);
const value = raw => ({ kind: 'value', value: raw });
const row = (configuration, id) => configuration.apis.find(entry => entry.id === id);
function patch(configuration, id, changes, host = null) {
  const result = updateApiConfiguration(configuration, id, changes, host);
  assert.equal(result.ok, true, result.error?.message);
  return result.value;
}
function publishedFormat4(enabled = false) {
  let configuration = createApiConfiguration();
  configuration = patch(configuration, 'hardware-concurrency', {
    mode: 'custom', selected: value(16), userValues: [{ id: 'saved-cpu', label: 'CPU 16', value: value(16) }]
  });
  configuration = patch(configuration, 'hardware-concurrency', { mode: 'custom', selected: value(8) }, 'exact.fixture.invalid');
  configuration = patch(configuration, 'battery', { mode: 'custom', selected: copy(row(configuration, 'battery').presets[0].value) });
  configuration.enabled = enabled; configuration.preset = 'strict';
  configuration.webrtcNetworkPolicy = 'disable_non_proxied_udp';
  configuration.fingerprintProfiles = [{ id: 'fp-' + '1'.repeat(32), label: 'Retained', preset: 'custom', webrtcNetworkPolicy: 'system',
    apis: configuration.apis.map(({ id, mode, selected, settings }) => ({ id, mode, selected: copy(selected), settings: copy(settings) })) }];
  const previousRows = new Map(configuration.apis.map(row => [row.id, row]));
  configuration.apis = API_CONFIG_CATALOG_V6.map(entry => {
    const current = previousRows.get(entry.id);
    return { ...copy(entry), mode: current.mode, userValues: copy(current.userValues), selected: copy(current.selected), settings: copy(current.settings) };
  });
  const oldIds = new Set(API_CONFIG_CATALOG_V6.map(entry => entry.id));
  for (const site of configuration.sites) site.apis = site.apis.filter(row => oldIds.has(row.id));
  for (const saved of configuration.fingerprintProfiles) saved.apis = saved.apis.filter(row => oldIds.has(row.id));
  configuration.formatVersion = 4;configuration.catalogVersion = 6;delete configuration.antidetectEnabled;
  return configuration;
}

test('ADR-068: catalogue6 is unchanged and both masters are required booleans, disabled by default', () => {
  assert.equal(createHash('sha256').update(JSON.stringify(API_CONFIG_CATALOG_V6)).digest('hex'), 'e03c14158d199bdac78dbdac56c748171a5fa1b89dc4b8b9301e899236d8f286');
  assert.ok(Object.isFrozen(API_CONFIG_CATALOG_V6));
  const configuration = createApiConfiguration();
  assert.equal(configuration.formatVersion, API_CONFIGURATION_VERSION); assert.equal(configuration.catalogVersion, API_CONFIGURATION_CATALOG_VERSION);
  assert.equal(configuration.enabled, false); assert.equal(configuration.antidetectEnabled, false);
  for (const key of ['enabled', 'antidetectEnabled']) {
    const missing = copy(configuration); delete missing[key];
    assert.equal(validateApiConfiguration(missing).error.code, 'missing-field');
    for (const invalid of [0, 1, 'true', null, {}]) assert.equal(validateApiConfiguration({ ...configuration, [key]: invalid }).ok, false);
    let reads = 0;
    const accessor = copy(configuration); Object.defineProperty(accessor, key, { get() { reads++; return true; }, enumerable: true });
    assert.equal(validateApiConfiguration(accessor).ok, false); assert.equal(reads, 0);
  }
});

for (const enabled of [false, true]) for (const antidetectEnabled of [false, true]) {
  test(`ADR-068: API Guard=${enabled}, Antidetect=${antidetectEnabled} gate explicit blocks, preset blocks and Custom independently`, () => {
    let configuration = createApiConfiguration();
    configuration = patch(configuration, 'hardware-concurrency', { mode: 'on', selected: value(16) });
    configuration = patch(configuration, 'battery', { mode: 'custom', selected: copy(row(configuration, 'battery').presets[0].value) });
    configuration = patch(configuration, 'navigator-platform', { mode: 'off', selected: value('Win32') });
    configuration.enabled = enabled; configuration.antidetectEnabled = antidetectEnabled; configuration.preset = 'strict';
    const retained = exportApiConfiguration(configuration), effective = effectiveApiConfiguration(configuration, 'site.fixture.invalid');
    if (!enabled && !antidetectEnabled) assert.deepEqual(effective, []);
    else {
      const mode = id => effective.find(entry => entry.id === id).mode;
      assert.equal(mode('hardware-concurrency'), enabled ? 'on' : 'off');
      assert.equal(mode('local-fonts'), enabled ? 'on' : 'off');
      assert.equal(mode('battery'), antidetectEnabled ? 'custom' : 'off', 'inactive Custom must not fall back to the strict preset block');
      assert.equal(mode('navigator-platform'), 'off');
    }
    assert.equal(exportApiConfiguration(configuration), retained, 'effective planning never rewrites saved modes, values or masters');
    const imported = importApiConfiguration(retained);
    assert.equal(imported.ok, true); assert.equal(imported.migrated, false);
    assert.equal(imported.value.enabled, enabled); assert.equal(imported.value.antidetectEnabled, antidetectEnabled);
    assert.equal(exportApiConfiguration(imported.value), retained);
    const legacy = configurationToLegacy(configuration);
    assert.equal(legacy.enabled, enabled); assert.equal(Object.hasOwn(legacy, 'antidetectEnabled'), false);
    assert.equal(legacy.global.find(entry => entry.feature === 'battery').state, 'allow');
  });
}

test('ADR-068: exact-site overrides resolve before independent master gating and never inherit after gating', () => {
  let configuration = createApiConfiguration();
  configuration = patch(configuration, 'battery', { mode: 'custom', selected: copy(row(configuration, 'battery').presets[0].value) });
  configuration = patch(configuration, 'hardware-concurrency', { mode: 'on' });
  configuration = patch(configuration, 'hardware-concurrency', { mode: 'custom', selected: value(8) }, 'exact.fixture.invalid');
  configuration = patch(configuration, 'battery', { mode: 'on' }, 'exact.fixture.invalid');
  configuration.enabled = true; configuration.antidetectEnabled = false; configuration.preset = 'strict';
  const active = effectiveApiConfiguration(configuration, 'exact.fixture.invalid');
  assert.equal(active.find(entry => entry.id === 'hardware-concurrency').mode, 'off', 'dormant local Custom must not inherit the global On');
  assert.equal(active.find(entry => entry.id === 'battery').mode, 'on');
  configuration.enabled = false; configuration.antidetectEnabled = true;
  const custom = effectiveApiConfiguration(configuration, 'exact.fixture.invalid');
  assert.equal(custom.find(entry => entry.id === 'hardware-concurrency').mode, 'custom');
  assert.equal(custom.find(entry => entry.id === 'battery').mode, 'off', 'disabled explicit On must not reveal global Custom');
  const inherited = effectiveApiConfiguration(configuration, 'sub.exact.fixture.invalid');
  assert.equal(inherited.find(entry => entry.id === 'hardware-concurrency').mode, 'off');
  assert.equal(inherited.find(entry => entry.id === 'battery').mode, 'custom');
  configuration.sites[0].disabled = true;
  assert.deepEqual(effectiveApiConfiguration(configuration, 'exact.fixture.invalid'), []);
  assert.deepEqual(effectiveApiConfiguration(configuration, 'https://exact.fixture.invalid'), []);
});

test('ADR-068: a master-only change produces a precise deterministic import preview without API changes', () => {
  const before = createApiConfiguration(), after = { ...before, antidetectEnabled: true };
  assert.deepEqual(diffApiConfigurations(before, after).value, [{ scope: 'global', id: null, field: 'antidetectEnabled', before: false, after: true }]);
  const reordered = Object.fromEntries(Object.entries(after).reverse());
  assert.equal(exportApiConfiguration(after), exportApiConfiguration(reordered));
  assert.deepEqual(Object.keys(JSON.parse(exportApiConfiguration(after))).slice(0, 7), ['format', 'formatVersion', 'catalogVersion', 'enabled', 'antidetectEnabled', 'preset', 'webrtcNetworkPolicy']);
});

for (const enabled of [false, true]) {
  test(`ADR-068: published format4 master=${enabled} migrates to both masters without losing libraries, profile books or dormant selections`, () => {
    const old = publishedFormat4(enabled), retained = copy(old), result = upgradeApiConfiguration(old);
    assert.equal(result.ok, true, result.error?.message); assert.equal(result.migrated, true);
    assert.equal(result.value.enabled, enabled); assert.equal(result.value.antidetectEnabled, enabled);
    assert.equal(result.value.formatVersion, API_CONFIGURATION_VERSION); assert.equal(result.value.catalogVersion, API_CONFIGURATION_CATALOG_VERSION);
    for (const previous of old.apis) {
      const current = row(result.value, previous.id);
      assert.deepEqual(current, { ...copy(API_CONFIG_CATALOG.find(entry => entry.id === previous.id)), mode: previous.mode, selected: previous.selected, userValues: previous.userValues, settings: previous.settings });
    }
    for (const added of result.value.apis.slice(old.apis.length)) {
      assert.equal(added.mode, 'bypass');assert.deepEqual(added.selected, { kind: 'unset' });assert.deepEqual(added.userValues, []);assert.deepEqual(added.settings, {});
    }
    for (const key of ['sites', 'fingerprintProfiles']) {
      assert.equal(result.value[key].length, old[key].length);
      for (let index = 0; index < old[key].length; index++) {
        const current = result.value[key][index], previous = old[key][index];
        // Format 9 gives every migrated library record an empty tag list and an empty note (site records have neither).
        const { tags, note, ...bare } = current;
        if (key === 'fingerprintProfiles') { assert.deepEqual(tags, []); assert.equal(note, ''); } else assert.equal(tags, undefined);
        assert.deepEqual({ ...bare, apis: current.apis.slice(0, previous.apis.length) }, previous);
        assert.equal(current.apis.length, API_CONFIG_CATALOG.length);
        for (const added of current.apis.slice(previous.apis.length)) assert.deepEqual(added, { id: added.id, mode: 'bypass', selected: { kind: 'unset' }, settings: {} });
      }
    }
    assert.equal(result.value.webrtcNetworkPolicy, old.webrtcNetworkPolicy); assert.deepEqual(old, retained);
    if (!enabled) assert.deepEqual(effectiveApiConfiguration(result.value, 'exact.fixture.invalid'), []);
    else assert.equal(effectiveApiConfiguration(result.value, 'exact.fixture.invalid').find(entry => entry.id === 'hardware-concurrency').mode, 'custom');
    assert.equal(importApiConfiguration(JSON.stringify(old)).ok, true);
    assert.equal(upgradeApiConfiguration(result.value).migrated, false);
    assert.equal(validateApiConfiguration(old).error.code, 'incompatible-version');
  });
}

test('ADR-068: format4 validation stays strict before migration, including the old shared-master conflict semantics', () => {
  for (const mutate of [
    configuration => { configuration.antidetectEnabled = false; },
    configuration => { configuration.apis[0].order++; },
    configuration => { delete configuration.fingerprintProfiles; },
    configuration => { configuration.fingerprintProfiles[0].antidetectEnabled = false; },
    configuration => { configuration.fingerprintProfiles.push(copy(configuration.fingerprintProfiles[0])); }
  ]) {
    const old = publishedFormat4(); mutate(old); const retained = copy(old), result = upgradeApiConfiguration(old);
    assert.equal(result.ok, false); assert.equal(result.upgradeFailure, undefined);
    assert.deepEqual(old, retained);
  }
  const conflict = publishedFormat4(true); conflict.fingerprintProfiles = [];
  row(conflict, 'webrtc').mode = 'custom'; row(conflict, 'webrtc').selected = copy(row(conflict, 'webrtc').presets[3].value);
  row(conflict, 'media-enumeration').mode = 'custom'; row(conflict, 'media-enumeration').selected = value([]);
  assert.equal(upgradeApiConfiguration(conflict).error.code, 'conflicting-webrtc-devices');
  conflict.enabled = false;
  const dormant = upgradeApiConfiguration(conflict); assert.equal(dormant.ok, true);
  assert.equal(dormant.value.antidetectEnabled, false);
  assert.equal(validateApiConfiguration({ ...dormant.value, enabled: true }).ok, true, 'API Guard alone cannot activate conflicting Custom values');
  assert.equal(validateApiConfiguration({ ...dormant.value, antidetectEnabled: true }).error.code, 'conflicting-webrtc-devices');
});

test('ADR-068: legacy imports preserve their old master state for both new controls', () => {
  for (const enabled of [false, true]) {
    const legacy = { schemaVersion: 1, revision: 1, enabled, preset: 'limited', global: [], sites: [] };
    const configuration = createApiConfiguration(legacy);
    assert.equal(configuration.enabled, enabled); assert.equal(configuration.antidetectEnabled, enabled);
    assert.deepEqual(configurationToLegacy(configuration, legacy), legacy);
  }
});
