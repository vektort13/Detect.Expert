// Registration of the geolocation Custom row: the generated early MAIN source, site scopes, inheritance into child realms
// and the opaque-realm fallback list. The runtime semantics themselves are covered by api-custom-geolocation.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { existsSync, readFileSync } from 'node:fs';
import { API_CONFIG_CATALOG, API_CONFIGURATION_CATALOG_VERSION, createApiConfiguration, updateApiConfiguration } from '../../packages/contracts/src/api-configuration.mjs';
import { API_CUSTOM_SCRIPT_PREFIX, apiCustomSiteScriptId, buildApiCustomScripts } from '../../apps/production-extension/api-custom-registration.js';
import { apiCustomOpaqueFile } from '../production/sync-api-custom-opaque.mjs';
import { createRealm, run, once, REAL_POSITION } from './api-custom-geolocation-kit.mjs';

const tagged = value => ({ kind: 'value', value });
const PARIS = { latitude: 48.8566, longitude: 2.3522, accuracy: 25 }, TOKYO = { latitude: 35.6762, longitude: 139.6503, accuracy: 25 };
function change(config, id, patch, host = null) {
  const result = updateApiConfiguration(config, id, patch, host);
  assert.equal(result.ok, true, result.error?.message); return result.value;
}
const base = () => ({ ...createApiConfiguration(), enabled: true, antidetectEnabled: true });
const geo = (config, value = PARIS, host = null) => change(config, 'geolocation', { mode: 'custom', selected: tagged(value) }, host);
const plain = value => JSON.parse(JSON.stringify(value));
const SETUP = `Object.defineProperty(globalThis, 'self', { configurable: true, get() { return this; } });
  globalThis.window = globalThis; globalThis.document = { querySelectorAll() { return []; } };
  Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { configurable: true, enumerable: true, get() { return 32; } });`;
const realm = (extra = {}) => createRealm({ setup: SETUP, ...extra });
const position = context => plain(run(context, '(p => [p.coords.latitude, p.coords.longitude, p.coords.accuracy, p.coords.altitude, p.coords.speed])')(once(context)));
const selectedOf = value => [value.latitude, value.longitude, value.accuracy, null, null];
const nativeOf = [REAL_POSITION.latitude, REAL_POSITION.longitude, REAL_POSITION.accuracy, REAL_POSITION.altitude, REAL_POSITION.speed];
// Structural wiring of the generated source: the installer is embedded, called per realm and kept out of the generic installer.
function assertWiring(code) {
  assert.ok(code.includes('customGeolocationCoordinate'), 'installer source embedded');
  assert.ok(/const geolocation = \(function installGeolocationCustom/.test(code), 'bound to a local installer');
  assert.ok(/geolocation\(realm, entries\);/.test(code), 'invoked for every realm');
  const ids = /const extendedIds = (\[[^\]]*\]);/.exec(code);
  assert.ok(ids && JSON.parse(ids[1]).includes('geolocation'), 'excluded from the generic installer rows');
}

test('a global geolocation profile registers one early immutable MAIN source that carries the installer and the selected numbers only', () => {
  const [script, ...rest] = buildApiCustomScripts(geo(base()), ['https://*/*', 'http://*/*']);
  assert.equal(rest.length, 0);
  assert.equal(script.id, API_CUSTOM_SCRIPT_PREFIX + 'global');
  assert.equal(script.world, 'MAIN'); assert.equal(script.runAt, 'document_start'); assert.equal(script.allFrames, true);
  assert.deepEqual(Object.keys(script.js[0]), ['code']);
  assertWiring(script.js[0].code);
  assert.ok(script.js[0].code.includes('48.8566') && script.js[0].code.includes('2.3522'));
  const context = realm(); vm.runInContext(script.js[0].code, context);
  assert.deepEqual(position(context), selectedOf(PARIS));
  assert.equal(run(context, `globalThis[Symbol.for('detect.expert/api-custom/document/v2')]`), true);
  assert.equal(run(context, `Object.hasOwn(globalThis, Symbol.for('detect.expert/api-custom/installation/v1'))`), false, 'no public stop or restore handle');
});

test('without a geolocation row the source carries no geolocation installer at all', () => {
  const config = change(base(), 'hardware-concurrency', { mode: 'custom', selected: tagged(16) });
  const [script] = buildApiCustomScripts(config, ['https://*/*']);
  assert.ok(!script.js[0].code.includes('customGeolocation'));
  assert.ok(!/geolocation\(realm, entries\)/.test(script.js[0].code));
  const [withGeo] = buildApiCustomScripts(geo(config), ['https://*/*']);
  const growth = withGeo.js[0].code.length - script.js[0].code.length;
  assert.ok(growth > 2000 && growth < 14000, 'the installer adds ' + growth + ' bytes');
  const context = realm(); vm.runInContext(script.js[0].code, context);
  assert.deepEqual(position(context), nativeOf, 'native stays native');
});

test('geolocation composes with other Custom rows: both apply and the generic installer never sees the geolocation row', () => {
  const config = geo(change(base(), 'hardware-concurrency', { mode: 'custom', selected: tagged(16) }), TOKYO);
  const [script] = buildApiCustomScripts(config, ['https://*/*']);
  const context = realm(); vm.runInContext(script.js[0].code, context);
  assert.equal(run(context, 'navigator.hardwareConcurrency'), 16);
  assert.deepEqual(position(context), selectedOf(TOKYO));
  assertWiring(script.js[0].code);
  // Hardware-only profile: no geolocation traces and the position stays native.
  const [other] = buildApiCustomScripts(change(base(), 'hardware-concurrency', { mode: 'custom', selected: tagged(8) }), ['https://*/*']);
  const second = realm(); vm.runInContext(other.js[0].code, second);
  assert.equal(run(second, 'navigator.hardwareConcurrency'), 8);
  assert.deepEqual(position(second), nativeOf);
});

test('exact-site overrides: a site profile replaces the global one, Bypass inherits it, Off and a disabled site keep it native', () => {
  let config = geo(base(), PARIS);
  config = geo(config, TOKYO, 'tokyo.example');
  config = change(config, 'geolocation', { mode: 'bypass' }, 'inherit.example');
  config = change(config, 'geolocation', { mode: 'off' }, 'off.example');
  const scripts = buildApiCustomScripts(config, ['https://*/*']);
  assert.equal(scripts.length, 3, 'global, tokyo and the bypass site');
  const byId = id => scripts.find(script => script.id === id);
  const global = byId(API_CUSTOM_SCRIPT_PREFIX + 'global');
  assert.deepEqual(global.excludeMatches, ['http://inherit.example/*', 'http://off.example/*', 'http://tokyo.example/*', 'https://inherit.example/*', 'https://off.example/*', 'https://tokyo.example/*']);
  for (const [id, expected] of [[global.id, PARIS], [apiCustomSiteScriptId('tokyo.example'), TOKYO], [apiCustomSiteScriptId('inherit.example'), PARIS]]) {
    const context = realm(); vm.runInContext(byId(id).js[0].code, context);
    assert.deepEqual(position(context), selectedOf(expected), id);
  }
  assert.equal(byId(apiCustomSiteScriptId('off.example')), undefined, 'Off registers nothing: the excluded site stays native');
  config.sites.find(site => site.host === 'tokyo.example').disabled = true;
  assert.equal(buildApiCustomScripts(config, ['https://*/*']).some(script => script.id === apiCustomSiteScriptId('tokyo.example')), false);
});

test('a site-only geolocation profile registers that site alone and leaves every other site native', () => {
  const config = geo(base(), TOKYO, 'tokyo.example');
  const scripts = buildApiCustomScripts(config, ['https://*/*']);
  assert.deepEqual(scripts.map(script => script.id), [apiCustomSiteScriptId('tokyo.example')]);
  assert.deepEqual(scripts[0].matches, ['https://tokyo.example/*']);
  const context = realm(); vm.runInContext(scripts[0].js[0].code, context);
  assert.deepEqual(position(context), selectedOf(TOKYO));
  assertWiring(scripts[0].js[0].code);
});

test('Allow and Block never register a Custom position; Custom needs the antidetect master', () => {
  assert.deepEqual(buildApiCustomScripts(change(geo(base()), 'geolocation', { mode: 'off' }), ['https://*/*']), []);
  // Block (ON) belongs to the protection module, never to the Custom MAIN source.
  assert.deepEqual(buildApiCustomScripts(change(base(), 'geolocation', { mode: 'on' }), ['https://*/*']), []);
  assert.deepEqual(buildApiCustomScripts({ ...geo(base()), antidetectEnabled: false, enabled: false }, ['https://*/*']), []);
  assert.deepEqual(buildApiCustomScripts(geo(base()), []), []);
});

test('the contract accepts exactly the geolocation domain and rejects everything else before registration', () => {
  assert.ok(API_CONFIGURATION_CATALOG_VERSION >= 8);
  const row = API_CONFIG_CATALOG.find(entry => entry.id === 'geolocation');
  assert.equal(row.customSupported, true); assert.equal(row.type, 'geolocation');
  assert.deepEqual(row.presets.map(preset => preset.label), ['New York', 'London', 'Berlin', 'Paris', 'Tokyo', 'Sydney']);
  assert.ok(row.presets.every(preset => preset.value.kind === 'value' && preset.value.value.accuracy === 25 && Object.keys(preset.value.value).join() === 'latitude,longitude,accuracy'));
  for (const value of [{ latitude: 91, longitude: 0, accuracy: 25 }, { latitude: 0, longitude: -181, accuracy: 25 }, { latitude: 0, longitude: 0, accuracy: 0 }, { latitude: 0, longitude: 0, accuracy: 100001 },
    { latitude: NaN, longitude: 0, accuracy: 25 }, { latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0, accuracy: 25, altitude: 5 }, { latitude: '0', longitude: 0, accuracy: 25 }]) {
    assert.equal(updateApiConfiguration(base(), 'geolocation', { mode: 'custom', selected: tagged(value) }, null).ok, false, JSON.stringify(value));
  }
  // A forged configuration cannot reach the generated source either.
  const forged = geo(base()); forged.apis.find(entry => entry.id === 'geolocation').selected = tagged({ latitude: 999, longitude: 0, accuracy: 25 });
  assert.throws(() => buildApiCustomScripts(forged, ['https://*/*']), /selected.value.latitude/);
});

test('generation is deterministic and the geolocation source never embeds anything but the selected numbers', () => {
  const left = buildApiCustomScripts(geo(base()), ['https://*/*', 'http://*/*']), right = buildApiCustomScripts(geo(base()), ['http://*/*', 'https://*/*']);
  assert.deepEqual(left, right);
  const code = left[0].js[0].code;
  assert.ok(!code.includes('New York') && !code.includes('Paris'), 'preset labels never reach MAIN');
});

test('a same-origin child realm receives the profile through the real inheritance path; the opaque guard leaves it alone', () => {
  const brands = new WeakMap();
  const parent = realm({ brands }), child = realm({ brands });
  const [script] = buildApiCustomScripts(geo(base()), ['https://*/*']);
  vm.runInContext(script.js[0].code, parent);
  child.parent = vm.runInContext('globalThis', parent);
  vm.runInContext("Object.defineProperty(globalThis, 'location', { value: { protocol: 'about:' }, configurable: true }); globalThis.origin = 'https://example.test';", child);
  const nativeRequest = run(child, 'Geolocation.prototype.getCurrentPosition');
  vm.runInContext(readFileSync(new URL('../../apps/production-extension/api-custom-inherit.main.js', import.meta.url), 'utf8'), child);
  assert.equal(run(child, `Object.getOwnPropertyDescriptor(globalThis, Symbol.for('detect.expert/api-custom/document/v2'))?.value`), true, 'inherited');
  vm.runInContext(readFileSync(new URL('../../apps/production-extension/' + apiCustomOpaqueFile('geolocation'), import.meta.url), 'utf8'), child);
  assert.equal(run(child, 'Geolocation.prototype.getCurrentPosition'), nativeRequest, 'the guard does not touch an inherited realm');
  assert.deepEqual(position(child), selectedOf(PARIS), 'the child shows the selected position');
  assert.deepEqual(position(parent), selectedOf(PARIS));
  // The parent's coordinates read through the child's replaced getters stay selected, in both directions.
  const crossed = plain(run(child, `(p => [Object.getOwnPropertyDescriptor(GeolocationCoordinates.prototype, 'latitude').get.call(p.coords), GeolocationPosition.prototype.toJSON.call(p).coords.longitude])`)(once(parent)));
  assert.deepEqual(crossed, [PARIS.latitude, PARIS.longitude]);
});

test('a child realm that cannot inherit the profile is refused by the opaque guard: no native position, no prompt, nothing delivered', () => {
  const brands = new WeakMap();
  const parent = realm({ brands }), orphan = realm({ brands });
  const [script] = buildApiCustomScripts(geo(base()), ['https://*/*']);
  vm.runInContext(script.js[0].code, parent);
  vm.runInContext("Object.defineProperty(globalThis, 'location', { value: { protocol: 'data:' }, configurable: true }); globalThis.origin = 'null';", orphan);
  vm.runInContext(readFileSync(new URL('../../apps/production-extension/api-custom-inherit.main.js', import.meta.url), 'utf8'), orphan);
  assert.equal(run(orphan, `Object.getOwnPropertyDescriptor(globalThis, Symbol.for('detect.expert/api-custom/document/v2'))`), undefined, 'nothing was inherited');
  vm.runInContext(readFileSync(new URL('../../apps/production-extension/' + apiCustomOpaqueFile('geolocation'), import.meta.url), 'utf8'), orphan);
  const outcome = plain(run(orphan, `(() => {
    const rows = [];
    for (const method of ['getCurrentPosition', 'watchPosition']) {
      try { navigator.geolocation[method](() => rows.push('delivered')); rows.push('returned'); } catch (error) { rows.push(error.name); }
    }
    native.deliver(); native.update();
    return { rows, nativeCalls: native.calls.length, pending: native.pending.length, watchers: native.watchers.size };
  })()`));
  assert.deepEqual(outcome, { rows: ['SecurityError', 'SecurityError'], nativeCalls: 0, pending: 0, watchers: 0 });
  assert.equal(run(orphan, `Object.getOwnPropertyDescriptor(globalThis, Symbol.for('detect.expert/api-custom/value-capture-deny/v1')).value`), true);
});

test('the opaque fallback file exists for geolocation and the control path lists it for every Custom geolocation profile', () => {
  const name = apiCustomOpaqueFile('geolocation');
  assert.equal(name, 'api-custom-opaque.geolocation.js');
  assert.ok(existsSync(new URL('../../apps/production-extension/' + name, import.meta.url)));
  const controller = readFileSync(new URL('../../apps/production-extension/api-configuration-controller.js', import.meta.url), 'utf8');
  assert.ok(controller.includes("'api-custom-opaque.' + entry.id + '.js'"), 'the controller derives the fallback file from each Custom entry id');
});

// Test the test: the structural wiring check fails when the source is mutated in the ways that would silently disable the feature.
test('wiring assertions detect a source that no longer installs, invokes or isolates the geolocation installer', () => {
  const [script] = buildApiCustomScripts(geo(base()), ['https://*/*']);
  const code = script.js[0].code;
  assertWiring(code);
  const mutations = [
    code.replace(' geolocation(realm, entries);', ''),
    code.replace(/const geolocation = \(function installGeolocationCustom[\s\S]*?\n  const extendedIds/, 'const extendedIds'),
    code.replace(/(const extendedIds = \[[^\]]*?),?"geolocation"/, '$1'),
    code.replace(/customGeolocationCoordinate/g, 'renamed')
  ];
  for (const mutated of mutations) assert.notEqual(mutated, code);
  mutations.forEach((mutated, index) => assert.throws(() => assertWiring(mutated), undefined, 'mutation ' + index + ' must be detected'));
});
