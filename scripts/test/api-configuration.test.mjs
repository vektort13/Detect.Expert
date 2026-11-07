import test from 'node:test';
import assert from 'node:assert/strict';
import {
  API_CONFIG_CATALOG, API_CONFIGURATION_MAX_BYTES, API_CONFIGURATION_MAX_VALUES,
  createApiConfiguration, validateApiConfiguration, validateApiValue,
  importApiConfiguration, exportApiConfiguration, updateApiConfiguration,
  configurationToLegacy, effectiveApiConfiguration, nextApiValueId,
  diffApiConfigurations, apiConfigurationWarnings
} from '../../packages/contracts/src/api-configuration.mjs';
import { PROTECTION_FEATURES, PROTECTION_FEATURES_V1 } from '../../packages/contracts/src/protection-features.mjs';
import { WASM_SURFACES } from '../../packages/contracts/src/webassembly-apis.mjs';

const value = raw => ({ kind: 'value', value: raw });
const row = (config, id) => config.apis.find(entry => entry.id === id);
const copy = input => JSON.parse(JSON.stringify(input));
function change(config, id, patch, host = null) {
  const result = updateApiConfiguration(config, id, patch, host);
  assert.equal(result.ok, true, result.error?.message);
  return result.value;
}
const legacy = () => ({ schemaVersion: 1, revision: 17, enabled: true, preset: 'strict', global: [{ feature: 'hardware-concurrency', state: 'block' }], sites: [{ host: 'example.com', disabled: false, rules: [{ feature: 'hardware-concurrency', state: 'allow' }] }] });

test('ADR-048/059/065: catalogue retains positions and appends granular Wasm APIs then Math', () => {
  assert.deepEqual(API_CONFIG_CATALOG.slice(0, PROTECTION_FEATURES_V1.length).map(entry => entry.id), PROTECTION_FEATURES_V1);
  assert.deepEqual(API_CONFIG_CATALOG.slice(105, 142).map(entry => entry.id), WASM_SURFACES.map(surface => surface.feature));
  assert.equal(API_CONFIG_CATALOG[142].id, 'math-transcendentals');
  assert.deepEqual(PROTECTION_FEATURES.slice(PROTECTION_FEATURES_V1.length), WASM_SURFACES.map(surface => surface.feature));
  assert.equal(API_CONFIG_CATALOG.length, 158);
  assert.equal(new Set(API_CONFIG_CATALOG.map(entry => entry.id)).size, 158);
  assert.deepEqual(API_CONFIG_CATALOG.map(entry => entry.order), Array.from({ length: 158 }, (_, i) => i));
  assert.equal(API_CONFIG_CATALOG.filter(entry => entry.customSupported).length, 56);
  assert.ok(Object.isFrozen(API_CONFIG_CATALOG));
  assert.ok(Object.isFrozen(API_CONFIG_CATALOG.find(entry => entry.id === 'hardware-concurrency').presets[0].value));
  assert.equal(validateApiConfiguration(createApiConfiguration()).ok, true);
  for (const api of API_CONFIG_CATALOG) for (const preset of api.presets) assert.equal(validateApiValue(api.id, preset.value).ok, true, api.id);
});

test('full export includes inactive APIs, empty libraries and selections, without runtime revision', () => {
  const config = createApiConfiguration();
  const exported = JSON.parse(exportApiConfiguration(config));
  assert.equal(exported.enabled, false);
  assert.equal(exported.antidetectEnabled, false);
  assert.equal(exported.apis.length, 158);
  assert.equal(exported.formatVersion, 10);
  assert.equal(exported.catalogVersion, 11);
  assert.deepEqual(exported.fingerprintProfiles, []);
  assert.equal(exported.webrtcNetworkPolicy, 'system');
  assert.deepEqual(exported.sites, []);
  assert.equal(Object.hasOwn(exported, 'revision'), false);
  assert.equal(Object.hasOwn(exported, 'exportedAt'), false);
  for (const api of exported.apis) {
    assert.equal(api.mode, 'bypass');
    assert.deepEqual(api.selected, { kind: 'unset' });
    assert.deepEqual(api.settings, {});
    assert.deepEqual(api.userValues, []);
    assert.ok(Array.isArray(api.presets));
  }
});

test('identical configuration exports byte-identically regardless of insertion/host/value order', () => {
  let a = createApiConfiguration();
  a = change(a, 'hardware-concurrency', { userValues: [{ id: 'custom-z', label: 'Many', value: value(32) }, { id: 'custom-a', label: 'Few', value: value(2) }], mode: 'custom', selected: value(16) });
  a = change(a, 'navigator-platform', { mode: 'custom', selected: value('Linux x86_64') }, 'z.example');
  a = change(a, 'navigator-language', { mode: 'custom', selected: value('en-US') }, 'a.example');
  const b = copy(a);
  b.apis.reverse(); b.sites.reverse();
  for (const api of b.apis) api.userValues.reverse();
  for (const site of b.sites) site.apis.reverse();
  const unordered = Object.fromEntries(Object.entries(b).reverse());
  assert.equal(exportApiConfiguration(a), exportApiConfiguration(unordered));
  const restored = importApiConfiguration(exportApiConfiguration(a));
  assert.equal(restored.ok, true);
  assert.equal(restored.migrated, false);
  assert.equal(exportApiConfiguration(restored.value), exportApiConfiguration(a));
});

test('unset, empty string, explicit undefined and legitimate nullable result remain distinct', () => {
  let config = createApiConfiguration();
  config = change(config, 'navigator-vendor', { mode: 'custom', selected: value('') });
  config = change(config, 'navigator-oscpu', { mode: 'custom', selected: { kind: 'undefined' } });
  config = change(config, 'webgpu', { mode: 'custom', selected: { kind: 'null' } });
  const result = importApiConfiguration(exportApiConfiguration(config));
  assert.equal(result.ok, true);
  assert.deepEqual(row(result.value, 'navigator-vendor').selected, value(''));
  assert.deepEqual(row(result.value, 'navigator-oscpu').selected, { kind: 'undefined' });
  assert.deepEqual(row(result.value, 'webgpu').selected, { kind: 'null' });
  assert.deepEqual(row(result.value, 'hardware-concurrency').selected, { kind: 'unset' });
  assert.equal(validateApiValue('hardware-concurrency', { kind: 'null' }).ok, false);
  assert.equal(validateApiValue('hardware-concurrency', { kind: 'undefined' }).ok, false);
  assert.equal(validateApiValue('navigator-vendor', value(null)).ok, false);
  assert.equal(updateApiConfiguration(config, 'hardware-concurrency', { mode: 'custom' }).error.code, 'missing-value');
});

test('1000 reusable custom values survive round trip and stay reusable in exact-host overrides', () => {
  const values = Array.from({ length: API_CONFIGURATION_MAX_VALUES }, (_, index) => ({ id: `custom-${index + 1}`, label: `CPU ${index + 1}`, value: value(index + 1) }));
  let config = change(createApiConfiguration(), 'hardware-concurrency', { userValues: values, selected: value(16), mode: 'custom' }, 'test.example');
  assert.equal(config.sites[0].apis.length, API_CONFIG_CATALOG.length);
  assert.equal(row(config, 'hardware-concurrency').mode, 'bypass');
  assert.equal(row(config, 'hardware-concurrency').userValues.length, 1000);
  assert.equal(config.sites[0].apis.find(item => item.id === 'hardware-concurrency').mode, 'custom');
  const imported = importApiConfiguration(exportApiConfiguration(config));
  assert.equal(imported.ok, true);
  assert.equal(row(imported.value, 'hardware-concurrency').userValues.length, 1000);
  assert.equal(nextApiValueId(values), 'custom-1001');
  const oversized = copy(config);
  row(oversized, 'hardware-concurrency').userValues.push({ id: 'custom-1001', label: 'Extra', value: value(1) });
  assert.equal(validateApiConfiguration(oversized).ok, false);
  config = change(config, 'hardware-concurrency', { userValues: values.filter(item => item.id !== 'custom-16') });
  assert.deepEqual(config.sites[0].apis.find(item => item.id === 'hardware-concurrency').selected, value(16));
  assert.equal(nextApiValueId(values.filter(item => item.id !== 'custom-16')), 'custom-16');
});

test('legacy settings migrate preset, global/site rules and disabled sites without adding active rules', () => {
  const original = legacy(); original.sites.push({ host: 'disabled.example', disabled: true, rules: [] });
  const migrated = importApiConfiguration(JSON.stringify(original));
  assert.equal(migrated.ok, true); assert.equal(migrated.migrated, true);
  assert.equal(migrated.value.preset, 'strict');
  assert.deepEqual(configurationToLegacy(migrated.value, original), { ...original, sites: [...original.sites].sort((a, b) => a.host.localeCompare(b.host)) });
  const effective = effectiveApiConfiguration(migrated.value, 'example.com');
  assert.equal(effective.find(item => item.id === 'hardware-concurrency').mode, 'off');
  assert.equal(effective.find(item => item.id === 'battery').mode, 'on');
  assert.equal(effective.find(item => item.id === 'navigator-platform').mode, 'off');
  assert.deepEqual(effectiveApiConfiguration(migrated.value, 'disabled.example'), []);
  assert.deepEqual(effectiveApiConfiguration({ ...migrated.value, enabled: false, antidetectEnabled: false }, 'example.com'), []);
  assert.deepEqual(effectiveApiConfiguration(migrated.value, 'https://example.com'), []);
});

test('Custom cancels inherited global/preset block, Bypass inherits, and native blocking projection stays compatible', () => {
  let config = createApiConfiguration(legacy());
  config = change(config, 'hardware-concurrency', { mode: 'custom', selected: value(16) }, 'example.com');
  config = change(config, 'battery', { mode: 'custom', selected: value({ charging: true, chargingTime: 0, dischargingTime: null, level: 1 }) });
  assert.deepEqual(effectiveApiConfiguration(config, 'example.com').find(item => item.id === 'hardware-concurrency'), { id: 'hardware-concurrency', mode: 'custom', value: value(16) });
  assert.equal(effectiveApiConfiguration(config, 'other.example').find(item => item.id === 'hardware-concurrency').mode, 'on');
  const projected = configurationToLegacy(config, legacy());
  assert.equal(projected.global.find(item => item.feature === 'battery').state, 'allow');
  assert.equal(projected.sites[0].rules.find(item => item.feature === 'hardware-concurrency').state, 'allow');
  assert.equal(projected.revision, 17);
  config = change(config, 'hardware-concurrency', { mode: 'bypass' }, 'example.com');
  assert.equal(effectiveApiConfiguration(config, 'example.com').find(item => item.id === 'hardware-concurrency').mode, 'on');
});

test('import rejects malformed/duplicate escaped JSON fields without touching existing configuration', () => {
  const current = createApiConfiguration(), original = exportApiConfiguration(current);
  for (const [source, code] of [
    ['{', 'invalid-json'], ['{"format":1,}', 'invalid-json'], ['{"a":1,"a":2}', 'duplicate-field'],
    ['{"a":1,"\\u0061":2}', 'duplicate-field'], ['[1,]', 'invalid-json'], ['{} garbage', 'invalid-json'],
    ['{"__proto__":{"polluted":true}}', 'unknown-field'], ['null', 'invalid-type'], ['1e400', 'invalid-type']
  ]) assert.equal(importApiConfiguration(source).error.code, code, source);
  assert.equal(exportApiConfiguration(current), original);
  assert.equal({}.polluted, undefined);
});

test('strict import rejects missing APIs/fields, duplicates, unknowns, unsupported values and versions', () => {
  const cases = [
    [config => { delete config.enabled; }, 'missing-field'],
    [config => { delete config.antidetectEnabled; }, 'missing-field'],
    [config => { config.antidetectEnabled = 'true'; }, 'invalid-value'],
    [config => { config.formatVersion = 11; }, 'incompatible-version'],
    [config => { config.catalogVersion = 12; }, 'incompatible-version'],
    [config => { config.apis.pop(); }, 'missing-api'],
    [config => { config.apis[1] = config.apis[0]; }, 'duplicate-api'],
    [config => { config.apis[0].id = 'unknown'; }, 'unknown-api'],
    [config => { config.apis[0].mode = 'anything'; }, 'invalid-mode'],
    [config => { config.apis[0].extra = false; }, 'unknown-field'],
    [config => { row(config, 'hardware-concurrency').presets[0].value.value = 999; }, 'catalog-mismatch'],
    [config => { row(config, 'hardware-concurrency').selected = value(1.5); }, 'invalid-value'],
    [config => { row(config, 'webassembly').mode = 'custom'; }, 'unsupported-value'],
    [config => { row(config, 'hardware-concurrency').settings.command = 'anything'; }, 'unknown-field'],
    [config => { row(config, 'hardware-concurrency').userValues = [{ id: 'same', label: 'A', value: value(1) }, { id: 'same', label: 'B', value: value(2) }]; }, 'duplicate-value'],
    [config => { row(config, 'hardware-concurrency').userValues = [{ id: 'preset-1', label: 'A', value: value(1) }]; }, 'invalid-value']
  ];
  for (const [mutate, code] of cases) {
    const config = createApiConfiguration(); mutate(config);
    const result = importApiConfiguration(JSON.stringify(config));
    assert.equal(result.ok, false); assert.equal(result.error.code, code);
  }
  let config = change(createApiConfiguration(), 'hardware-concurrency', { mode: 'custom', selected: value(16) }, 'test.example');
  config.sites.push(copy(config.sites[0])); assert.equal(validateApiConfiguration(config).error.code, 'duplicate-host');
  config = change(createApiConfiguration(), 'hardware-concurrency', { mode: 'custom', selected: value(16) }, 'test.example');
  config.sites[0].apis.pop(); assert.equal(validateApiConfiguration(config).error.code, 'missing-api');
});

test('validation never invokes accessor/toJSON/value coercion and rejects sparse or decorated arrays', () => {
  let calls = 0;
  const getter = createApiConfiguration();
  Object.defineProperty(getter, 'enabled', { get() { calls++; return true; } });
  assert.equal(validateApiConfiguration(getter).ok, false);
  const malicious = { toJSON() { calls++; return 16; }, valueOf() { calls++; return 16; } };
  assert.equal(validateApiValue('hardware-concurrency', value(malicious)).ok, false);
  const decorated = createApiConfiguration(); decorated.apis.foo = 'extra';
  assert.equal(validateApiConfiguration(decorated).ok, false);
  const sparse = createApiConfiguration(); delete sparse.apis[0];
  assert.equal(validateApiConfiguration(sparse).ok, false);
  assert.equal(calls, 0);
});

test('type-specific validators accept supported snapshots and reject impossible/unsupported shapes', () => {
  const invalid = [
    ['hardware-concurrency', 0], ['device-memory', 0], ['touch-points', -1], ['screen-width', 0], ['screen-color-depth', 1000],
    ['window-device-pixel-ratio', Infinity], ['navigator-language', 'not a language'], ['navigator-languages', []], ['navigator-languages', ['en', 'EN']],
    ['screen-orientation', { type: 'diagonal', angle: 45 }], ['timezone', { timeZone: 'Invalid/Zone', offsetMinutes: 0 }], ['timezone', { timeZone: 'UTC', offsetMinutes: 10000 }],
    ['storage-estimate', { quota: 100, usage: 200 }], ['performance-memory', { jsHeapSizeLimit: 10, totalJSHeapSize: 20, usedJSHeapSize: 5 }],
    ['battery', { charging: true, chargingTime: 0, dischargingTime: null, level: 1.1 }],
    ['network-information', { downlink: 10, effectiveType: '5g', rtt: 50, saveData: false }],
    ['client-hints', { brands: [], platform: 'Windows', mobile: false, unknown: 'x' }],
    ['client-hints', { brands: [{ brand: 'X', version: '1' }, { brand: 'X', version: '2' }], platform: 'Windows', mobile: false }],
    ['gamepads', [{ id: 'invented-gamepad' }]], ['usb', [{ vendorId: 1 }]], ['bluetooth', { available: true, devices: [{ id: 'x' }] }],
    ['media-capabilities', { supported: false, smooth: true, powerEfficient: false, hidden: [] }], ['notifications', 'ask'], ['autoplay-policy', 'default'],
    ['media-enumeration', [{ deviceId: 'x', groupId: '', label: '', kind: 'invalid' }]],
    ['webgl', { vendor: 'v', renderer: 'r' }], ['webgpu', { vendor: 'v', architecture: 'a', device: 'd', description: 'x', isFallbackAdapter: true }]
  ];
  for (const [id, raw] of invalid) assert.equal(validateApiValue(id, value(raw)).ok, false, `${id}: ${JSON.stringify(raw)}`);
  const ch = { brands: [{ brand: 'Chromium', version: '130' }], mobile: false, platform: 'Windows', architecture: 'x86', bitness: '64', model: '', platformVersion: '15.0.0', uaFullVersion: '130.0.0.0', wow64: false, fullVersionList: [{ brand: 'Chromium', version: '130.0.0.0' }] };
  assert.equal(validateApiValue('client-hints', value(ch)).ok, true);
});

test('failed API update is atomic and valid edits report precise diff', () => {
  const before = createApiConfiguration(), original = exportApiConfiguration(before);
  assert.equal(updateApiConfiguration(before, 'hardware-concurrency', { mode: 'custom', selected: value('sixteen') }).ok, false);
  assert.equal(exportApiConfiguration(before), original);
  const after = change(before, 'hardware-concurrency', { mode: 'custom', selected: value(16) });
  const difference = diffApiConfigurations(before, after);
  assert.equal(difference.ok, true);
  assert.deepEqual(difference.value.map(item => [item.scope, item.id, item.field]), [['global', 'hardware-concurrency', 'mode'], ['global', 'hardware-concurrency', 'selected']]);
});

test('logical warnings account for site inheritance and preserve user-selected test cases', () => {
  let config = createApiConfiguration();
  config = change(config, 'screen-width', { mode: 'custom', selected: value(1280) });
  config = change(config, 'screen-avail-width', { mode: 'custom', selected: value(1920) }, 'test.example');
  config = change(config, 'navigator-language', { mode: 'custom', selected: value('ru-RU') });
  config = change(config, 'navigator-languages', { mode: 'custom', selected: value(['en-US', 'en']) });
  assert.ok(apiConfigurationWarnings(config).some(item => item.code === 'screen-bounds' && item.scope === 'test.example'));
  assert.ok(apiConfigurationWarnings(config).some(item => item.code === 'language-mismatch' && item.scope === 'global'));
  assert.equal(validateApiConfiguration(config).ok, true);
});

test('legacy malformed rules/hosts and incompatible versions do not partially migrate', () => {
  const cases = [
    [config => { config.schemaVersion = 2; }, 'incompatible-version'],
    [config => { config.global.push(copy(config.global[0])); }, 'duplicate-api'],
    [config => { config.sites.push(copy(config.sites[0])); }, 'duplicate-host'],
    [config => { config.sites[0].host = '*.example.com'; }, 'invalid-value'],
    [config => { config.sites[0].host = 'Example.com'; }, 'invalid-value'],
    [config => { config.global[0].state = 'custom'; }, 'invalid-value'],
    [config => { config.global[0].feature = 'new-api'; }, 'invalid-value']
  ];
  for (const [mutate, code] of cases) {
    const config = legacy(); mutate(config); assert.equal(importApiConfiguration(JSON.stringify(config)).error.code, code);
  }
});

test('file bounds count UTF-8 bytes and reject deeply nested data before it can damage state', () => {
  assert.equal(importApiConfiguration(' '.repeat(API_CONFIGURATION_MAX_BYTES + 1)).error.code, 'size-limit');
  const multibyte = JSON.stringify('я'.repeat(API_CONFIGURATION_MAX_BYTES / 2));
  assert.ok(multibyte.length < API_CONFIGURATION_MAX_BYTES);
  assert.equal(importApiConfiguration(multibyte).error.code, 'size-limit');
  assert.equal(importApiConfiguration('['.repeat(20) + '0' + ']'.repeat(20)).error.code, 'size-limit');
});

test('large valid libraries use deterministic compact export and remain importable within the UTF-8 limit', () => {
  const config = createApiConfiguration();
  for (const entry of config.apis.filter(entry => entry.customSupported && entry.presets.length).slice(0, 19)) {
    entry.userValues = Array.from({ length: 1000 }, (_, index) => ({ id: `custom-${index}`, label: 'x'.repeat(100), value: copy(entry.presets[0].value) }));
  }
  assert.ok(Buffer.byteLength(JSON.stringify(config, null, 2)) > API_CONFIGURATION_MAX_BYTES);
  assert.equal(validateApiConfiguration(config).ok, true);
  const source = exportApiConfiguration(config);
  assert.ok(Buffer.byteLength(source) <= API_CONFIGURATION_MAX_BYTES);
  assert.equal(source.split('\n').length, 2);
  const imported = importApiConfiguration(source);
  assert.equal(imported.ok, true);
  assert.equal(exportApiConfiguration(imported.value), source);
  const reversed = copy(config); reversed.apis.reverse();
  for (const entry of reversed.apis) entry.userValues.reverse();
  assert.equal(exportApiConfiguration(reversed), source);
  for (const entry of config.apis) for (const saved of entry.userValues) saved.label = 'x'.repeat(160);
  assert.equal(validateApiConfiguration(config).error.code, 'size-limit');
});

test('bounded JSON size accounting handles non-ASCII, control escapes and lone surrogates', () => {
  for (const label of ['я'.repeat(100), '\ud800'.repeat(100), '😀'.repeat(50)]) {
    let config = createApiConfiguration();
    config = change(config, 'hardware-concurrency', { userValues: [{ id: 'custom-1', label, value: value(16) }] });
    const exported = exportApiConfiguration(config);
    assert.equal(importApiConfiguration(exported).ok, true);
    assert.equal(importApiConfiguration(exported).value.apis.find(entry => entry.id === 'hardware-concurrency').userValues[0].label, label);
  }
  // Control characters are refused in labels (api-configuration-labels.test.mjs) but stay valid in string values.
  const controls = [92, 34, 10, 9, 1].map(code => String.fromCharCode(code)).join('').repeat(20);
  const config = change(createApiConfiguration(), 'navigator-platform', { mode: 'custom', selected: value(controls) });
  const imported = importApiConfiguration(exportApiConfiguration(config));
  assert.equal(imported.ok, true); assert.equal(row(imported.value, 'navigator-platform').selected.value, controls);
});
