// ADR-087: independent historical metadata pins, lossless scope migration and
// closed Custom data validation. No browser/backend access or runtime mocks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as contract from '../../packages/contracts/src/api-configuration.mjs';
import { FINGERPRINT_CUSTOM_ENTRIES, GL_CUSTOM_PARAMETERS, GPU_CUSTOM_LIMITS } from '../../packages/contracts/src/fingerprint-custom-values.mjs';

const copy = value => structuredClone(value);
const selected = value => ({ kind: 'value', value });
const ids = FINGERPRINT_CUSTOM_ENTRIES.map(row => row.id);
const scope = entries => entries.map(({ id }) => ({ id, mode: 'bypass', selected: { kind: 'unset' }, settings: {} }));
function previous(version = 6, format = 5) {
  const catalog = contract['API_CONFIG_CATALOG_V' + version];
  const value = { format: contract.API_CONFIGURATION_FORMAT, formatVersion: format, catalogVersion: version, enabled: false, preset: 'custom', apis: catalog.map(entry => ({ ...copy(entry), mode: 'bypass', selected: { kind: 'unset' }, userValues: [], settings: {} })), sites: [{ host: 'exact.example', disabled: false, apis: scope(catalog) }, { host: 'disabled.example', disabled: true, apis: scope(catalog) }] };
  if (format >= 2) value.webrtcNetworkPolicy = 'default_public_interface_only';
  if (format >= 4) value.fingerprintProfiles = [{ id: 'fp-' + '01'.repeat(16), label: 'Saved original', preset: 'custom', webrtcNetworkPolicy: 'system', apis: scope(catalog) }];
  if (format >= 5) value.antidetectEnabled = false;
  const cpu = value.apis.find(row => row.id === 'hardware-concurrency');
  cpu.mode = 'custom';cpu.selected = selected(8);cpu.userValues = [{ id: 'custom-keep', label: 'Saved CPU', value: selected(16) }];
  value.sites[0].apis.find(row => row.id === cpu.id).mode = 'off';
  if (value.fingerprintProfiles) Object.assign(value.fingerprintProfiles[0].apis.find(row => row.id === cpu.id), { mode: 'custom', selected: selected(32) });
  return value;
}
function expectDefault(row) { assert.equal(row.mode, 'bypass');assert.deepEqual(row.selected, { kind: 'unset' });assert.deepEqual(row.settings, {}); }

test('catalog7 stays a published, byte-pinned historical catalog (all seven hashes) that appends exactly fifteen Custom-only IDs', () => {
  const hashes = ['b3e069dab278027ebecbe06af3dd5b2642b5d9b5b84061230253df87dfbeecc4', '30118d27ae2c5ba117f4616dd4fbd4cfacd6814410d19a749b10464782aa4ff4', 'c2e6678fb9e94f612ce3b7f4842c8dfeb933157797784c10a602a2216408bdac', '8078b7f3f2eade1aba87a950fc1f8fa79ed75091267f798a90dcbbd9f2cc2f43', 'c10b94ac123076d428a254367649a4cc168c97947aa3787bf41f9b320bccf7e1', 'e03c14158d199bdac78dbdac56c748171a5fa1b89dc4b8b9301e899236d8f286', '04ab7486cfab75d88db1f55a6e47288f0f4864f61bfaf66801b9a07e1c25b646'];
  for (let version = 1; version <= 7; version++) assert.equal(createHash('sha256').update(JSON.stringify(contract['API_CONFIG_CATALOG_V' + version])).digest('hex'), hashes[version - 1], 'Frozen catalog ' + version);
  const v7 = contract.API_CONFIG_CATALOG_V7;
  assert.equal(v7.length, 158);assert.equal(v7.filter(row => row.customSupported).length, 55);assert.equal(v7.find(row => row.id === 'geolocation').customSupported, false);
  assert.deepEqual(v7.slice(0, 143).map(row => row.id), contract.API_CONFIG_CATALOG_V6.map(row => row.id));
  assert.deepEqual(v7.slice(143).map(row => row.id), ids);
  assert.deepEqual(v7.map(row => row.order), Array.from({ length: 158 }, (_, index) => index));
  assert.equal(new Set(ids).size, 15);assert.ok(ids.every(id => contract.API_CUSTOM_ONLY_IDS.includes(id)));
  assert.deepEqual(contract.API_CONFIG_CATALOG.slice(0, 143).map(row => row.id), contract.API_CONFIG_CATALOG_V6.map(row => row.id));
  assert.deepEqual(contract.API_CONFIG_CATALOG.slice(143).map(row => row.id), ids);
});

test('format5/catalog6 upgrade preserves all four independent master states, every old selected/library row and native policy', () => {
  for (const enabled of [false, true]) for (const antidetectEnabled of [false, true]) {
    const before = previous();before.enabled = enabled;before.antidetectEnabled = antidetectEnabled;
    const retained = copy(before), result = contract.upgradeApiConfiguration(before);
    assert.equal(result.ok, true, JSON.stringify(result.error));assert.equal(result.migrated, true);
    const after = result.value;
    assert.equal(after.enabled, enabled);assert.equal(after.antidetectEnabled, antidetectEnabled);
    assert.equal(after.webrtcNetworkPolicy, before.webrtcNetworkPolicy);assert.equal(after.preset, before.preset);
    for (const old of before.apis) {
      const current = after.apis.find(row => row.id === old.id);
      for (const field of ['mode', 'selected', 'userValues', 'settings']) assert.deepEqual(current[field], old[field]);
    }
    for (const site of before.sites) {
      const current = after.sites.find(row => row.host === site.host);assert.equal(current.disabled, site.disabled);
      assert.deepEqual(current.apis.slice(0, 143), site.apis);current.apis.slice(143).forEach(expectDefault);
    }
    const saved = after.fingerprintProfiles[0];
    for (const field of ['id', 'label', 'preset', 'webrtcNetworkPolicy']) assert.deepEqual(saved[field], before.fingerprintProfiles[0][field]);
    assert.deepEqual(saved.apis.slice(0, 143), before.fingerprintProfiles[0].apis);saved.apis.slice(143).forEach(expectDefault);
    for (const row of after.apis.slice(143)) { expectDefault(row);assert.deepEqual(row.userValues, []); }
    assert.deepEqual(before, retained);assert.equal(contract.upgradeApiConfiguration(after).migrated, false);
    assert.equal(contract.importApiConfiguration(contract.exportApiConfiguration(after)).ok, true);
  }
});

test('every published format/catalog pair upgrades without activating new scopes or erasing the legacy shared master', () => {
  for (const [version, format] of [[1, 1], [2, 1], [3, 2], [4, 3], [5, 3], [6, 4]]) {
    const old = previous(version, format);old.enabled = true;
    const result = contract.upgradeApiConfiguration(old);
    assert.equal(result.ok, true, `${version}/${format}: ${JSON.stringify(result.error)}`);
    assert.equal(result.value.enabled, true);assert.equal(result.value.antidetectEnabled, true);
    assert.equal(result.value.apis.find(row => row.id === 'hardware-concurrency').selected.value, 8);
    result.value.apis.filter(row => ids.includes(row.id)).forEach(expectDefault);
    for (const site of result.value.sites) site.apis.filter(row => ids.includes(row.id)).forEach(expectDefault);
    for (const saved of result.value.fingerprintProfiles) saved.apis.filter(row => ids.includes(row.id)).forEach(expectDefault);
  }
});

test('historical strict validation rejects future fields/function names, damaged metadata and missing rows without mutating input', () => {
  for (const mutate of [
    value => { value.apis[0].name = 'Changed'; }, value => { value.apis[0].extra = true; },
    value => { value.sites[0].apis.pop(); }, value => { value.fingerprintProfiles[0].apis.pop(); },
    value => { const row = value.apis.find(row => row.id === 'math-transcendentals');row.mode = 'custom';row.selected = selected({ algorithm: 'deterministic-ulp-v1', functions: ['sqrt'] }); },
    value => { value.apis.push(copy(contract.createApiConfiguration().apis[143])); }
  ]) {
    const before = previous();mutate(before);const retained = copy(before);
    assert.equal(contract.upgradeApiConfiguration(before).ok, false);assert.deepEqual(before, retained);
  }
});

test('all built-in profiles validate and Custom-only ON cannot be imported or selected globally or in a site', () => {
  for (const entry of contract.API_CONFIG_CATALOG) for (const preset of entry.presets) {
    const result = contract.validateApiValue(entry.id, preset.value);
    assert.equal(result.ok, true, entry.id + ':' + JSON.stringify(result.error));assert.deepEqual(result.value, preset.value);
  }
  for (const id of contract.API_CUSTOM_ONLY_IDS.filter(id => id !== 'timezone')) for (const host of [null, 'exact.example']) {
    const config = contract.createApiConfiguration();
    assert.equal(contract.updateApiConfiguration(config, id, { mode: 'on' }, host).ok, false, id);
  }
});

test('legacy timezone ON remains losslessly importable while UI-only Custom availability stays declared', () => {
  const old = previous();old.apis.find(row => row.id === 'timezone').mode = 'on';
  const result = contract.upgradeApiConfiguration(old);
  assert.equal(result.ok, true);assert.equal(result.value.apis.find(row => row.id === 'timezone').mode, 'on');
  assert.ok(contract.API_CUSTOM_ONLY_IDS.includes('timezone'));
});

test('formFactors is available only in catalog7, with bounded unique strings and frozen historical validation', () => {
  const hints = { brands: [{ brand: 'Chromium', version: '153' }], mobile: false, platform: 'Windows', formFactors: ['Desktop'] };
  assert.equal(contract.validateApiValue('client-hints', selected(hints)).ok, true);
  for (const formFactors of [Array(17).fill('Desktop'), ['Desktop', 'Desktop'], [1], ['x'.repeat(129)]]) assert.equal(contract.validateApiValue('client-hints', selected({ ...hints, formFactors })).ok, false);
  const old = previous();Object.assign(old.apis.find(row => row.id === 'client-hints'), { mode: 'custom', selected: selected(hints) });
  assert.equal(contract.upgradeApiConfiguration(old).ok, false);
});

test('new bundle schema rejects unknown fields/nonfinite values/oversized collections and executes no accessor', () => {
  const bad = [
    ['navigator-metadata', {}], ['navigator-metadata', { cookieEnabled: 1 }], ['navigator-metadata', { unknown: 'x' }],
    ['screen-geometry', { innerWidth: 0 }], ['screen-geometry', { screenX: -131073 }],
    ['css-media', { pointer: 'touch' }], ['css-media', { resolutionDppx: Infinity }],
    ['css-supports', { queries: [{ query: 'x', supported: true }, { query: 'x', supported: false }] }],
    ['css-supports', { queries: [{ query: 'x', supported: true }, { query: ' x ', supported: false }] }], ['css-supports', { queries: [{ query: '   ', supported: true }] }],
    ['intl-formatting', { overrideExplicitLocale: true }], ['intl-formatting', { timeZone: 'Invalid/Zone' }], ['intl-formatting', { locale: 'not a language' }],
    ['webgl-capabilities', { parameters: { UNKNOWN_ENUM: 1 } }], ['webgl-capabilities', { parameters: { ALIASED_LINE_WIDTH_RANGE: [2, 1] } }],
    ['webgpu-capabilities', { limits: { nonexistent: 1 } }], ['webgpu-capabilities', { limits: { maxBufferSize: -1 } }],
    ['canvas-text-metrics', { scale: 1.2 }], ['audio-fingerprint', { seed: 'x'.repeat(32) }], ['audio-fingerprint', { seed: '00'.repeat(16), amplitude: 1 }],
    ['audio-metadata', { sampleRate: 7999 }], ['clock-precision', { resolutionMs: 0 }],
    // The cap is 256 families (it was 64 before the Windows font groups); distinct names, so only the count is wrong.
    ['canvas-font-policy', { families: Array.from({ length: 257 }, (_, index) => 'Family ' + index), fallback: 'sans-serif' }],
    ...['bad\nfont', '"Arial"', "'Arial'", 'Arial\\32', 'Arial,serif', 'serif;monospace', '   '].map(fallback => ['canvas-font-policy', { families: [], fallback }]),
    ['canvas-font-policy', { families: ['Arial,serif'], fallback: 'sans-serif' }],
    ['browser-surface', { disabledGlobals: ['fetch'] }], ['browser-surface', { disabledNavigator: ['gpu', 'gpu'] }],
    ['webgpu-capabilities', { limits: { maxBufferSize: 0 } }], ['webgpu-capabilities', { limits: { minUniformBufferOffsetAlignment: 3 } }],
    ['webgl-readback', { seed: '00'.repeat(16), extra: true }]
  ];
  for (const [id, value] of bad) assert.equal(contract.validateApiValue(id, selected(value)).ok, false, id + ':' + JSON.stringify(value));
  let reads = 0;
  const accessor = { get scale() { reads++;throw new Error('No page getter'); } };
  assert.equal(contract.validateApiValue('canvas-text-metrics', selected(accessor)).ok, false);assert.equal(reads, 0);
  assert.equal(contract.validateApiValue('css-supports', selected({ queries: [{ query: ' display:grid ', supported: false }] })).value.value.queries[0].query, 'display:grid');
});

test('canvas-font-policy accepts exactly 256 distinct family names (the Windows font groups) and the canonical file equals the production mirror', () => {
  const families = Array.from({ length: 256 }, (_, index) => 'Family ' + index);
  assert.equal(contract.validateApiValue('canvas-font-policy', selected({ families, fallback: 'sans-serif' })).ok, true);
  assert.equal(contract.validateApiValue('canvas-font-policy', selected({ families: [...families, 'Family 256'], fallback: 'sans-serif' })).ok, false);
  const canonical = readFileSync(new URL('../../packages/contracts/src/fingerprint-custom-values.mjs', import.meta.url), 'utf8');
  assert.equal(readFileSync(new URL('../../apps/production-extension/fingerprint-custom-values.js', import.meta.url), 'utf8'), canonical, 'the production mirror is byte-identical');
});

test('plugins/MIME topology rejects aliases with conflicting metadata, accepts empty and coherent shared types', () => {
  const plugin = name => ({ name, filename: 'fixture', description: '', mimeTypes: [{ type: 'application/example', suffixes: 'ex', description: 'Example' }] });
  const profile = { plugins: [plugin('One'), plugin('Two')] };
  assert.equal(contract.validateApiValue('navigator-plugins', selected(profile)).ok, true);
  const bad = copy(profile);bad.plugins[1].mimeTypes[0].suffixes = 'other';
  assert.equal(contract.validateApiValue('navigator-plugins', selected(bad)).ok, false);
  assert.equal(contract.validateApiValue('navigator-plugins', selected({ plugins: Array.from({ length: 17 }, (_, index) => plugin(String(index))) })).ok, false);
  assert.equal(contract.validateApiValue('navigator-plugins', selected({ plugins: [] })).ok, true);
});

test('every fixed GL/GPU field accepts a bounded literal and preserves enum closure', () => {
  const parameters = Object.fromEntries(GL_CUSTOM_PARAMETERS.map(key => [key, ['VERSION', 'SHADING_LANGUAGE_VERSION'].includes(key) ? 'Fixture' : ['MAX_VIEWPORT_DIMS', 'ALIASED_LINE_WIDTH_RANGE', 'ALIASED_POINT_SIZE_RANGE'].includes(key) ? [1, 2] : 8]));
  assert.equal(contract.validateApiValue('webgl-capabilities', selected({ parameters, extensions: [] })).ok, true);
  assert.equal(contract.validateApiValue('webgpu-capabilities', selected({ limits: Object.fromEntries(GPU_CUSTOM_LIMITS.map(key => [key, 256])), features: [] })).ok, true);
  const normalized = contract.validateApiValue('audio-fingerprint', selected({ seed: '00'.repeat(16) }));
  assert.equal(normalized.ok, true);assert.equal(normalized.value.value.amplitude, 0.00001);
});
