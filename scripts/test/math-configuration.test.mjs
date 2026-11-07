// ADR-065: independent catalogue migration and one-writer configuration checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  API_CONFIG_CATALOG, API_CONFIG_CATALOG_V4, API_CONFIG_CATALOG_V5, API_MATH_FUNCTIONS,
  createApiConfiguration, validateApiConfiguration, validateApiValue,
  updateApiConfiguration, upgradeApiConfiguration, importApiConfiguration,
  exportApiConfiguration, effectiveApiConfiguration
} from '../../packages/contracts/src/api-configuration.mjs';
import { antidetectDraft, applyAntidetectDraft, createAntidetectController } from '../../apps/production-extension/antidetect-controller.js';
import { customEntries } from '../../apps/production-extension/api-configuration-controller.js';
import { buildApiCustomScripts, apiCustomSiteScriptId, API_CUSTOM_SCRIPT_PREFIX } from '../../apps/production-extension/api-custom-registration.js';

const copy = value => structuredClone(value);
const mathRow = config => config.apis.find(row => row.id === 'math-transcendentals');
const selected = functions => ({ kind: 'value', value: { algorithm: 'deterministic-ulp-v1', functions } });
function previousConfiguration() {
  const value = createApiConfiguration(); value.formatVersion = 3; value.catalogVersion = 4; delete value.fingerprintProfiles; delete value.antidetectEnabled;
  value.apis = API_CONFIG_CATALOG_V4.map(entry => ({ ...copy(entry), mode: 'bypass', selected: { kind: 'unset' }, userValues: [], settings: {} }));
  value.enabled = true; value.preset = 'custom'; value.webrtcNetworkPolicy = 'disable_non_proxied_udp';
  const cpu = value.apis.find(row => row.id === 'hardware-concurrency');
  cpu.mode = 'custom'; cpu.selected = { kind: 'value', value: 16 };
  cpu.userValues = Array.from({ length: 100 }, (_, index) => ({ id: 'cpu-' + String(index).padStart(3, '0'), label: 'CPU ' + index, value: { kind: 'value', value: index + 1 } }));
  const rtc = value.apis.find(row => row.id === 'webrtc');
  rtc.mode = 'custom'; rtc.selected = copy(rtc.presets[1].value);
  rtc.userValues = [{ id: 'saved-rtc', label: 'Saved RTC', value: copy(rtc.selected) }];
  value.sites = ['disabled.fixture.invalid', 'active.fixture.invalid'].map((host, index) => ({
    host, disabled: index === 0,
    apis: value.apis.map(row => ({ id: row.id, mode: row.id === 'hardware-concurrency' ? 'off' : 'bypass', selected: { kind: 'unset' }, settings: {} }))
  }));
  return value;
}
function chosen(config = createApiConfiguration(), functions = ['sin']) {
  const result = updateApiConfiguration(config, 'math-transcendentals', { mode: 'custom', selected: selected(functions) });
  assert.equal(result.ok, true, result.error?.message); return result.value;
}

test('Math adds exactly one stable ID after the byte-pinned 142-entry catalogue', () => {
  assert.equal(API_CONFIG_CATALOG_V4.length, 142);
  assert.equal(createHash('sha256').update(JSON.stringify(API_CONFIG_CATALOG_V4)).digest('hex'), '8078b7f3f2eade1aba87a950fc1f8fa79ed75091267f798a90dcbbd9f2cc2f43');
  assert.deepEqual(API_CONFIG_CATALOG_V5.slice(0, 142), API_CONFIG_CATALOG_V4);
  // Catalog 8 changes exactly these rows of the first 142 against catalog 4: canvas-readback, webrtc, geolocation (Custom-capable),
  // the four ADR-105 header-reason rows, storage-estimate (ADR-106), the ADR-107 network/memory presets and speech-voices filter
  // (catalog 10, round 5) the media-capabilities row with its hidden codec families and (catalog 11, ADR-112) the first presets of the webgpu row.
  const changedSince4 = ['canvas-readback', 'webrtc', 'geolocation', 'navigator-user-agent', 'client-hints', 'navigator-language', 'navigator-languages', 'storage-estimate', 'network-information', 'performance-memory', 'speech-voices', 'media-capabilities', 'webgpu'];
  assert.deepEqual(API_CONFIG_CATALOG.slice(0, 142).filter(row => !changedSince4.includes(row.id)), API_CONFIG_CATALOG_V4.filter(row => !changedSince4.includes(row.id)));
  assert.equal(API_CONFIG_CATALOG_V5.length, 143);assert.equal(API_CONFIG_CATALOG_V5[142].presets[0].value.value.functions.length, 20);
  assert.deepEqual(API_MATH_FUNCTIONS.slice(0, 20), API_CONFIG_CATALOG_V5[142].presets[0].value.value.functions);
  assert.equal(API_CONFIG_CATALOG.length, 158); assert.equal(API_CONFIG_CATALOG[142].id, 'math-transcendentals');
  assert.equal(API_CONFIG_CATALOG[142].order, 142); assert.equal(API_MATH_FUNCTIONS.length, 23);
  assert.deepEqual(API_MATH_FUNCTIONS.slice(20), ['sqrt', 'cbrt', 'hypot']);
  assert.equal(new Set(API_MATH_FUNCTIONS).size, 23); assert.ok(Object.isFrozen(API_MATH_FUNCTIONS));
});

test('strict format3/catalog4 upgrade preserves libraries, native policy and every previous scope row', () => {
  const old = previousConfiguration(), retained = copy(old), upgraded = upgradeApiConfiguration(old);
  assert.equal(upgraded.ok, true, upgraded.error?.message); assert.equal(upgraded.migrated, true);
  assert.equal(upgraded.value.formatVersion, 10); assert.equal(upgraded.value.catalogVersion, 11);
  assert.equal(upgraded.value.webrtcNetworkPolicy, retained.webrtcNetworkPolicy);
  assert.equal(upgraded.value.enabled, true); assert.equal(upgraded.value.preset, 'custom');
  assert.deepEqual(upgraded.value.apis.slice(0, 142), retained.apis.map(row => ['canvas-readback', 'webrtc', 'geolocation', 'navigator-user-agent', 'client-hints', 'navigator-language', 'navigator-languages', 'storage-estimate', 'network-information', 'performance-memory', 'speech-voices', 'media-capabilities', 'webgpu'].includes(row.id) ? {
    ...copy(API_CONFIG_CATALOG.find(api => api.id === row.id)), mode: row.mode, selected: row.selected, userValues: row.userValues, settings: row.settings
  } : row));
  for (const site of upgraded.value.sites) {
    const original = retained.sites.find(row => row.host === site.host);
    assert.deepEqual(site.apis.slice(0, 142), original.apis); assert.equal(site.disabled, original.disabled);
    assert.deepEqual(site.apis[142], { id: 'math-transcendentals', mode: 'bypass', selected: { kind: 'unset' }, settings: {} });
  }
  assert.equal(mathRow(upgraded.value).mode, 'bypass'); assert.deepEqual(mathRow(upgraded.value).selected, { kind: 'unset' });
  assert.deepEqual(old, retained); assert.equal(upgradeApiConfiguration(upgraded.value).migrated, false);
  assert.equal(validateApiConfiguration(old).error.code, 'incompatible-version');
});

test('malformed previous metadata, duplicate and absent rows reject without partial migration', () => {
  for (const mutate of [
    value => { value.apis[0].order++; }, value => { value.apis.pop(); },
    value => { value.apis[1] = copy(value.apis[0]); }, value => { value.sites[0].apis.pop(); },
    value => { value.apis[0].presets.push({ id: 'foreign', label: 'Foreign', value: { kind: 'unset' } }); },
    value => { value.formatVersion = 4; }
  ]) {
    const old = previousConfiguration(); mutate(old); const retained = copy(old);
    assert.equal(upgradeApiConfiguration(old).ok, false); assert.equal(importApiConfiguration(JSON.stringify(old)).ok, false);
    assert.deepEqual(old, retained);
  }
});

test('function selections, saved libraries and exact-site profiles export in one canonical function order', () => {
  let value = chosen(createApiConfiguration(), ['pow', 'sin', 'acos']);
  const patch = updateApiConfiguration(value, 'math-transcendentals', {
    userValues: [{ id: 'saved', label: 'Saved', value: selected(['tan', 'cos', 'sin']) }]
  }); assert.equal(patch.ok, true); value = patch.value;
  const site = updateApiConfiguration(value, 'math-transcendentals', { mode: 'custom', selected: selected(['pow', 'tanh', 'exp']) }, 'exact.fixture.invalid');
  assert.equal(site.ok, true); value = site.value;
  assert.deepEqual(mathRow(value).selected.value.functions, ['acos', 'sin', 'pow']);
  assert.deepEqual(mathRow(value).userValues[0].value.value.functions, ['cos', 'sin', 'tan']);
  assert.deepEqual(value.sites[0].apis[142].selected.value.functions, ['exp', 'tanh', 'pow']);
  const exported = exportApiConfiguration(value), again = importApiConfiguration(exported);
  assert.equal(again.ok, true); assert.equal(again.migrated, false); assert.equal(exportApiConfiguration(again.value), exported);
  assert.equal(exported.includes('mathSeed'), false); assert.equal(exported.includes('session-seed'), false);
});

test('every built-in Math profile already has the canonical function order used by saved selections', () => {
  for (const preset of API_CONFIG_CATALOG[142].presets) {
    const validated = validateApiValue('math-transcendentals', preset.value);
    assert.equal(validated.ok, true); assert.deepEqual(validated.value, preset.value, preset.id);
  }
});

test('empty function list is valid, distinct from missing/null/undefined and keeps a reusable empty profile', () => {
  const empty = chosen(createApiConfiguration(), []);
  assert.deepEqual(mathRow(empty).selected, selected([]));
  for (const value of [{ kind: 'null' }, { kind: 'undefined' }, { kind: 'value', value: { algorithm: 'deterministic-ulp-v1' } }]) {
    assert.equal(validateApiValue('math-transcendentals', value).ok, false);
  }
  assert.equal(validateApiValue('math-transcendentals', { kind: 'unset' }).ok, true);
  assert.equal(updateApiConfiguration(empty, 'math-transcendentals', { mode: 'custom', selected: { kind: 'unset' } }).ok, false);
});

test('an enabled empty global Math selection plans no primary or inherited opaque registration', () => {
  const config = chosen(createApiConfiguration(), []); config.antidetectEnabled = true; config.preset = 'custom';
  assert.deepEqual(customEntries(config, null), []);
  assert.deepEqual(customEntries(config, 'empty.fixture.invalid'), []);
  assert.deepEqual(buildApiCustomScripts(config, ['https://empty.fixture.invalid/*']), [], 'empty selection needs neither a seed nor an opaque guard');
  assert.deepEqual(mathRow(config).selected, selected([]), 'the reusable empty value stays saved');
});

test('an exact-site empty Math selection overrides global Spoof without inheriting its deny-all opaque file', () => {
  let config = chosen(createApiConfiguration(), ['sin']); config.antidetectEnabled = true; config.preset = 'custom';
  const result = updateApiConfiguration(config, 'math-transcendentals', { mode: 'custom', selected: selected([]) }, 'empty.fixture.invalid');
  assert.equal(result.ok, true); config = result.value;
  assert.deepEqual(customEntries(config, 'empty.fixture.invalid'), []);
  assert.equal(customEntries(config, 'sub.empty.fixture.invalid').find(row => row.id === 'math-transcendentals').selected.value.functions[0], 'sin');
  const scripts = buildApiCustomScripts(config, ['http://*/*', 'https://*/*'], { mathSeed: '01'.repeat(32) });
  assert.equal(scripts.length, 1); assert.equal(scripts[0].id, API_CUSTOM_SCRIPT_PREFIX + 'global');
  assert.deepEqual(scripts[0].excludeMatches, ['http://empty.fixture.invalid/*', 'https://empty.fixture.invalid/*']);
  assert.equal(scripts.some(row => row.id === apiCustomSiteScriptId('empty.fixture.invalid')), false);
  assert.equal(scripts[0].js[0].code.includes('const math ='), true, 'other granted sites still receive the active global profile');
});

test('site-only active Math is planned with its persisted seed and exact granted scope even when the global selection is empty', () => {
  let config = chosen(createApiConfiguration(), []); config.antidetectEnabled = true; config.preset = 'custom';
  const result = updateApiConfiguration(config, 'math-transcendentals', { mode: 'custom', selected: selected(['tanh']) }, 'active.fixture.invalid');
  assert.equal(result.ok, true); config = result.value;
  assert.deepEqual(customEntries(config, null), []);
  assert.deepEqual(customEntries(config, 'active.fixture.invalid').map(row => [row.id, row.selected.value.functions]), [['math-transcendentals', ['tanh']]]);
  assert.throws(() => buildApiCustomScripts(config, ['https://active.fixture.invalid/*']), /persisted profile seed/);
  const scripts = buildApiCustomScripts(config, ['https://active.fixture.invalid/*'], { mathSeed: '02'.repeat(32) });
  assert.equal(scripts.length, 1); assert.equal(scripts[0].id, apiCustomSiteScriptId('active.fixture.invalid'));
  assert.deepEqual(scripts[0].matches, ['https://active.fixture.invalid/*']); assert.deepEqual(scripts[0].excludeMatches, []);
  assert.equal(scripts[0].world, 'MAIN'); assert.equal(scripts[0].runAt, 'document_start'); assert.equal(scripts[0].allFrames, true);
  assert.equal(scripts[0].js[0].code.includes('const math ='), true); assert.equal(scripts[0].js[0].code.includes('02'.repeat(32)), true);
  assert.deepEqual(buildApiCustomScripts(config, ['https://elsewhere.fixture.invalid/*']), [], 'an ungranted exact site must not widen the registration');
  config.sites[0].disabled = true;
  assert.deepEqual(customEntries(config, 'active.fixture.invalid'), []);
  assert.deepEqual(buildApiCustomScripts(config, ['https://active.fixture.invalid/*']), []);
});

test('unknown algorithms/functions, duplicate names, excessive lists and non-data values reject before user code', () => {
  let calls = 0;
  const failures = [
    { algorithm: 'fdlibm', functions: ['sin'] }, { algorithm: 'deterministic-ulp-v1', functions: ['fround'] },
    { algorithm: 'deterministic-ulp-v1', functions: ['sin', 'sin'] },
    { algorithm: 'deterministic-ulp-v1', functions: Array(21).fill('sin') },
    { algorithm: 'deterministic-ulp-v1', functions: [null] },
    { algorithm: 'deterministic-ulp-v1', functions: ['sin'], seed: 'forbidden' },
    { get algorithm() { calls++; return 'deterministic-ulp-v1'; }, functions: ['sin'] },
    { algorithm: 'deterministic-ulp-v1', get functions() { calls++; return ['sin']; } },
    { algorithm: 'deterministic-ulp-v1', functions: [{ toString() { calls++; return 'sin'; } }] }
  ];
  const list = ['sin']; Object.defineProperty(list, 0, { get() { calls++; return 'sin'; }, enumerable: true });
  failures.push({ algorithm: 'deterministic-ulp-v1', functions: list });
  for (const value of failures) assert.equal(validateApiValue('math-transcendentals', { kind: 'value', value }).ok, false);
  assert.equal(calls, 0);
});

test('Math ON is unavailable globally and for an exact site, including imported JSON', () => {
  const config = chosen();
  for (const host of [null, 'exact.fixture.invalid']) assert.equal(updateApiConfiguration(config, 'math-transcendentals', { mode: 'on' }, host).ok, false);
  const bad = copy(config); mathRow(bad).mode = 'on';
  assert.equal(importApiConfiguration(JSON.stringify(bad)).ok, false);
});

test('Math remains off under original presets and exact-site Allow overrides global Spoof without erasing it', () => {
  for (const preset of ['limited', 'strict', 'custom']) {
    const config = createApiConfiguration(); config.enabled = true; config.preset = preset;
    assert.equal(effectiveApiConfiguration(config, 'site.fixture.invalid').find(row => row.id === 'math-transcendentals').mode, 'off');
  }
  const config = chosen(); config.antidetectEnabled = true;
  const site = updateApiConfiguration(config, 'math-transcendentals', { mode: 'off' }, 'exact.fixture.invalid').value;
  assert.equal(effectiveApiConfiguration(site, 'exact.fixture.invalid').find(row => row.id === 'math-transcendentals').mode, 'off');
  assert.equal(effectiveApiConfiguration(site, 'sub.exact.fixture.invalid').find(row => row.id === 'math-transcendentals').mode, 'custom');
  assert.deepEqual(mathRow(site).selected, mathRow(config).selected);
});

test('Antidetect Math changes preserve false master, unrelated settings and dormant selected values', () => {
  const config = createApiConfiguration(), draft = antidetectDraft(config); draft.math.mode = 'spoof'; draft.math.profile.functions = ['tanh'];
  const saved = applyAntidetectDraft(config, draft);
  assert.equal(saved.enabled, false); assert.equal(mathRow(saved).mode, 'custom');
  for (const row of config.apis.slice(0, 142)) assert.deepEqual(saved.apis.find(item => item.id === row.id), row);
  assert.deepEqual(applyAntidetectDraft(saved, antidetectDraft(saved)), saved, 'same profile is not duplicated');
  for (const mode of ['allow', 'inherit']) {
    const changed = antidetectDraft(saved); changed.math.mode = mode; const next = applyAntidetectDraft(saved, changed);
    assert.deepEqual(mathRow(next).selected, mathRow(saved).selected); assert.deepEqual(mathRow(next).userValues, mathRow(saved).userValues);
  }
  const invalid = antidetectDraft(saved); invalid.math.mode = 'block'; assert.throws(() => applyAntidetectDraft(saved, invalid));
});

test('Math saves through the existing CAS message and stale revision cannot overwrite newer settings', async () => {
  const previous = { location: Object.getOwnPropertyDescriptor(globalThis, 'location'), window: Object.getOwnPropertyDescriptor(globalThis, 'window') };
  const window = {}; window.top = window;
  Object.defineProperty(globalThis, 'location', { value: { href: 'chrome-extension://math-owned/options.html#antidetect' }, configurable: true });
  Object.defineProperty(globalThis, 'window', { value: window, configurable: true });
  let current = createApiConfiguration(), revision = 3; const calls = [];
  const api = { runtime: { id: 'math-owned', getURL: path => 'chrome-extension://math-owned/' + path,
    async sendMessage(message) {
      calls.push(copy(message));
      if (message.type === 'ui-api-config-set') {
        if (message.expectedRevision !== revision) return { type: 'api-config-error', code: 'stale-revision' };
        current = copy(message.configuration); revision++;
      }
      return { schemaVersion: 1, type: 'api-config-state', configuration: copy(current), revision, registration: 'ready', reloadRequired: false };
    } } };
  const controller = createAntidetectController(api);
  try {
    const loaded = await controller.load(); loaded.draft.math.mode = 'spoof'; loaded.draft.math.profile.functions = ['cos'];
    const saved = await controller.save(loaded.draft);
    assert.equal(saved.revision, 4); assert.equal(saved.effective.math, 'inactive'); assert.equal(current.enabled, false);
    assert.equal(calls[1].type, 'ui-api-config-set'); assert.equal(calls[1].expectedRevision, 3); assert.equal(calls[1].tabId, null);
    const retained = copy(current); revision++;
    saved.draft.math.profile.functions = ['sin'];
    await assert.rejects(controller.save(saved.draft), error => error.code === 'stale-revision');
    assert.deepEqual(current, retained); assert.equal(calls.filter(item => item.type === 'ui-api-config-set').length, 2);
  } finally {
    controller.dispose();
    for (const key of ['location', 'window']) if (previous[key]) Object.defineProperty(globalThis, key, previous[key]); else delete globalThis[key];
  }
});
