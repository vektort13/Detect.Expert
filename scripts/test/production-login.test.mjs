// REQ-002/012, ADR-006: regressions against the actual packaged production runtime.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { PROTECTION_FEATURES } from '../../packages/contracts/src/protection-features.mjs';
import { splitProtectionRuntime, switchBounds } from '../production/protection-runtime-split.mjs';

const root = new URL('../../', import.meta.url);
function section(file, start, end) {
  const source = readFileSync(new URL('apps/production-extension/' + file, root), 'utf8');
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, file + ': expected audited module boundaries');
  return source.slice(from, to);
}

for (const file of ['hook.early.js', 'hook.main.js']) {
  test(file + ': child-realm method/getter/setter prototypes and call results survive wrapping', () => {
    const context = vm.createContext({});
    vm.runInContext(section(file, '// packages/sensors/src/wrap.ts', '// packages/sensors/src/intrinsics.ts') +
      ';globalThis.hooks = {wrapMethod, wrapPreparedMethod, wrapOutcomeMethod, wrapResultMethod, wrapGetter, wrapSetter};', context);
    const child = vm.createContext({});
    const target = vm.runInContext('({ method(x) { return x; }, get property() { return this.saved; }, set property(x) { this.saved = x; } })', child);
    const prototype = Object.getPrototypeOf(target.method);
    const original = Object.getOwnPropertyDescriptor(target, 'property');
    const marker = {};
    for (const name of ['wrapMethod', 'wrapPreparedMethod', 'wrapOutcomeMethod', 'wrapResultMethod']) {
      const instance = vm.runInContext('({ method(x) { return x; } })', child);
      const wrapped = name === 'wrapPreparedMethod'
        ? context.hooks[name](instance, 'method', () => marker, () => undefined)
        : context.hooks[name](instance, 'method', () => undefined);
      assert.equal(wrapped.status, 'installed');
      assert.equal(Object.getPrototypeOf(instance.method), prototype, name);
      assert.equal(instance.method(marker), marker);
      assert.equal(wrapped.restore(), true);
    }
    const getter = context.hooks.wrapGetter(target, 'property', () => undefined);
    assert.equal(Object.getPrototypeOf(Object.getOwnPropertyDescriptor(target, 'property').get), prototype);
    target.saved = marker;
    assert.equal(target.property, marker);
    assert.equal(getter.restore(), true);
    const setter = context.hooks.wrapSetter(target, 'property', () => undefined);
    assert.equal(Object.getPrototypeOf(Object.getOwnPropertyDescriptor(target, 'property').set), prototype);
    target.property = marker;
    assert.equal(target.saved, marker);
    assert.equal(setter.restore(), true);
    assert.deepEqual(Object.getOwnPropertyDescriptor(target, 'property'), original);
  });
}

// ADR-046: every rule bundle carries the shared recovery code with only its own switch case.
const protectionMarker = '// packages/sensors/src/protection.ts';
const protectionSources = new Map(PROTECTION_FEATURES.map((feature) => [feature, section('protection.' + feature + '.js',
  protectionMarker, '// apps/extension/entrypoints/protection.main.ts')]));
const protectionRuntime = readFileSync(new URL('apps/production-extension/protection-runtime.js', root), 'utf8');
const runtimeSection = protectionRuntime.slice(protectionRuntime.indexOf(protectionMarker))
  .replace('export function installProtection(', 'function installProtection(');
function withoutCases(source) {
  const { head, tail } = switchBounds(source);
  return (head + tail).trimEnd();
}
test('all protection bundles share the reviewed recovery implementation and carry only their own case', () => {
  assert.ok(protectionRuntime.indexOf(protectionMarker) >= 0, 'protection-runtime.js: expected audited module boundary');
  const expected = withoutCases(runtimeSection), cases = splitProtectionRuntime(runtimeSection, PROTECTION_FEATURES);
  assert.equal(protectionSources.size, PROTECTION_FEATURES.length);
  for (const [feature, source] of protectionSources) {
    assert.equal(withoutCases(source), expected, feature);
    assert.equal(switchBounds(source).body, switchBounds(cases.get(feature)).body, feature);
    const code = readFileSync(new URL('apps/production-extension/protection.' + feature + '.js', root), 'utf8');
    assert.equal(code.split('case "').length, 2, feature + ': exactly one switch case');
    assert.equal(code.indexOf('case "'), code.indexOf('case "' + feature + '":'), feature);
  }
});
function installer(feature) {
  const context = vm.createContext({ DOMException, arrayPush: (array, item) => array.push(item) });
  vm.runInContext(protectionSources.get(feature) + ';globalThis.install = installProtection;', context);
  return context.install;
}
test('stopping protection restores deleted data and accessor descriptors without reading their values', () => {
  for (const [feature, key, accessor] of [['webassembly', 'WebAssembly', false], ['client-hints', 'userAgentData', true],
    ['network-information', 'connection', true], ['keyboard', 'keyboard', true], ['battery', 'getBattery', false],
    ['audio', 'AudioContext', false], ['webrtc', 'RTCPeerConnection', false]]) {
    let reads = 0;
    const realm = { Navigator: function Navigator() {} };
    const owner = ['webassembly', 'audio', 'webrtc'].includes(feature) ? realm : realm.Navigator.prototype;
    const original = accessor ? { get() { reads++; return {}; }, enumerable: true, configurable: true }
      : { value: function Original() {}, writable: true, configurable: true, enumerable: false };
    Object.defineProperty(owner, key, original);
    const before = Object.getOwnPropertyDescriptor(owner, key);
    const protection = installer(feature)(realm, feature);
    assert.equal(Object.getOwnPropertyDescriptor(owner, key), undefined, feature);
    protection.stop();
    assert.deepEqual(Object.getOwnPropertyDescriptor(owner, key), before, feature);
    assert.equal(reads, 0);
    protection.stop();
    assert.deepEqual(Object.getOwnPropertyDescriptor(owner, key), before);
  }
});
test('deleted API recovery preserves a later page replacement', () => {
  const realm = { WebAssembly: {} }, replacement = {};
  const protection = installer('webassembly')(realm, 'webassembly');
  Object.defineProperty(realm, 'WebAssembly', { value: replacement, configurable: true });
  protection.stop();
  assert.equal(realm.WebAssembly, replacement);
});
test('stopped retained denial wrapper invokes the original once with unchanged arguments and result', () => {
  const result = {}, receiver = {}, argument = {};
  let calls = 0;
  const realm = { queryLocalFonts(...args) { calls++; assert.equal(this, receiver); assert.equal(args[0], argument); return result; } };
  const original = realm.queryLocalFonts;
  const protection = installer('local-fonts')(realm, 'local-fonts'), retained = realm.queryLocalFonts;
  protection.stop();
  assert.equal(realm.queryLocalFonts, original);
  assert.equal(Reflect.apply(retained, receiver, [argument]), result);
  assert.equal(calls, 1);
});

function controllerFixture(saved, marker = false, rejectWrite = false) {
  const store = { 'protection:v1': saved, 'protection:compatibility:1.1.0': marker };
  const events = [], scripts = [];
  const api = {
    storage: { local: {
      get: async () => ({ ...store }),
      set: async (value) => { if (rejectWrite) throw Error('storage unavailable'); Object.assign(store, value); },
    } },
    scripting: {
      getRegisteredContentScripts: async () => [...scripts],
      unregisterContentScripts: async () => { events.push('unregister'); scripts.length = 0; },
      updateContentScripts: async () => {},
      registerContentScripts: async (items) => { events.push('register'); scripts.push(...items); },
    },
    tabs: { query: async () => [{ id: 1 }], sendMessage: async (_id, message) => { events.push(message.type); } },
  };
  const scope = { accessReady: true, desiredMatches: () => ['https://example.com/*'] };
  const context = vm.createContext({ api, scope, setTimeout, clearTimeout, URL,
    isSanitizedHost: (value) => value === 'example.com' || value === 'protection.invalid',
    hostPatterns: (host) => ['http://' + host + '/*', 'https://' + host + '/*'], patternCoversHost: () => true });
  vm.runInContext(section('background.js', '// packages/contracts/src/protection.ts', '// packages/contracts/src/rtc-values.ts') +
    section('background.js', '// packages/background/src/protection-plan.ts', '// packages/background/src/api-results.ts') +
    ';globalThis.controller = new ProtectionController(api, scope);', context);
  return { controller: context.controller, store, events };
}
const oldSettings = { schemaVersion: 1, revision: 9, enabled: true, preset: 'strict',
  global: [{ feature: 'webassembly', state: 'block' }], sites: [] };
test('1.1.0 resets existing denials once, keeps rules and stops open documents', async () => {
  const fixture = controllerFixture(oldSettings);
  await fixture.controller.start();
  assert.equal(fixture.store['protection:v1'].enabled, false);
  assert.equal(fixture.store['protection:v1'].revision, 10);
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.store['protection:v1'].global)), oldSettings.global);
  assert.equal(fixture.store['protection:compatibility:1.1.0'], true);
  assert.ok(fixture.events.includes('protection-stop'));
  assert.ok(!fixture.events.includes('register'));
});
test('1.1.0 leaves a subsequently enabled policy enabled on worker restart', async () => {
  const fixture = controllerFixture(oldSettings, true);
  await fixture.controller.start();
  assert.equal(fixture.controller.settings.enabled, true);
  assert.equal(fixture.controller.settings.revision, 9);
  assert.ok(fixture.events.includes('register'));
});
test('failed compatibility persistence remains disabled and retries on the next worker start', async () => {
  const fixture = controllerFixture(oldSettings, false, true);
  await fixture.controller.start();
  assert.equal(fixture.controller.settings.enabled, false);
  assert.equal(fixture.controller.registration, 'error');
  assert.equal(fixture.store['protection:compatibility:1.1.0'], false);
  assert.ok(!fixture.events.includes('register'));
  const retry = controllerFixture(fixture.store['protection:v1']);
  await retry.controller.start();
  assert.equal(retry.store['protection:v1'].enabled, false);
  assert.equal(retry.store['protection:compatibility:1.1.0'], true);
});
