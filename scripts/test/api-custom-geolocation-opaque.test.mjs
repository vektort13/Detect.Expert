// Opaque inherited realms (about:/data:/blob: whose parent profile cannot be read) never receive a native position.
// The guard is the generated bundle api-custom-opaque.geolocation.js, run exactly as the fallback content script runs it.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { API_CONFIG_CATALOG } from '../../packages/contracts/src/api-configuration.mjs';
import { API_CUSTOM_OPAQUE_NEUTRALS } from '../../apps/production-extension/api-custom-opaque.entry.js';
import { API_CUSTOM_OPAQUE_IDS, apiCustomOpaqueFile } from '../production/sync-api-custom-opaque.mjs';
import { createRealm, run } from './api-custom-geolocation-kit.mjs';

const directory = new URL('../../apps/production-extension/', import.meta.url);
// GEOLOCATION_GUARD_BUNDLE lets a mutation harness run the behaviour tests against a deliberately broken copy of the bundle.
const bundlePath = process.env.GEOLOCATION_GUARD_BUNDLE ?? new URL(apiCustomOpaqueFile('geolocation'), directory);
const bundle = readFileSync(bundlePath, 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const documentMarker = Symbol.for('detect.expert/api-custom/document/v2');
const deny = Symbol.for('detect.expert/api-custom/value-capture-deny/v1');

// A browser-shaped realm at the given protocol and origin; `inherited` plants the profile marker the document runtime sets.
function opaque({ protocol = 'data:', origin = 'null', inherited = false, setup = '' } = {}) {
  const context = createRealm({ setup });
  vm.runInContext(`Object.defineProperty(globalThis, 'location', { value: { protocol: ${JSON.stringify(protocol)} }, configurable: true });
    ${origin === false ? '' : `Object.defineProperty(globalThis, 'origin', { value: ${JSON.stringify(origin)}, configurable: true, enumerable: true });`}`, context);
  if (inherited) vm.runInContext(`Object.defineProperty(globalThis, Symbol.for('detect.expert/api-custom/document/v2'), { value: true });`, context);
  return context;
}
const guard = context => vm.runInContext(bundle, context);
const attempt = (context, method) => run(context, `(() => { try { navigator.geolocation.${method}(() => { throw new Error('delivered'); }); return 'returned'; } catch (error) { return error.name + ':' + error.message; } })()`);

test('the opaque neutral state and the generated bundle exist for geolocation and match a fresh build of its entry', async () => {
  assert.equal(Object.hasOwn(API_CUSTOM_OPAQUE_NEUTRALS, 'geolocation'), true);
  assert.equal(API_CUSTOM_OPAQUE_NEUTRALS.geolocation, null, 'hold: no neutral position is ever fabricated');
  assert.ok(API_CUSTOM_OPAQUE_IDS.includes('geolocation'));
  assert.equal(API_CONFIG_CATALOG.find(entry => entry.id === 'geolocation').customSupported, true);
  const result = await build({ entryPoints: [fileURLToPath(new URL('api-custom-geolocation-opaque.entry.js', directory))], bundle: true, write: false,
    format: 'iife', target: 'chrome119', platform: 'browser', minify: false, legalComments: 'none', logLevel: 'silent', define: { __DETECT_EXPERT_OPAQUE_API_ID__: JSON.stringify('geolocation') } });
  const body = bundle.slice(bundle.indexOf('\n') + 1);
  assert.equal(body, result.outputFiles[0].text, 'run node scripts/production/sync-api-custom-opaque.mjs after editing the entry');
  assert.ok(bundle.length < 4000, 'bundle size ' + bundle.length);
});

test('about:, data: and blob: realms without an inherited profile refuse both position requests before the native method runs', () => {
  for (const protocol of ['about:', 'data:', 'blob:']) {
    const context = opaque({ protocol, origin: 'null' });
    const before = run(context, `({ get: Geolocation.prototype.getCurrentPosition, watch: Geolocation.prototype.watchPosition, clear: Geolocation.prototype.clearWatch, flags: ['getCurrentPosition', 'watchPosition'].map(key => { const d = Object.getOwnPropertyDescriptor(Geolocation.prototype, key); return [d.writable, d.enumerable, d.configurable]; }) })`);
    guard(context);
    assert.equal(attempt(context, 'getCurrentPosition'), 'SecurityError:Geolocation profile unavailable in this frame', protocol);
    assert.equal(attempt(context, 'watchPosition'), 'SecurityError:Geolocation profile unavailable in this frame', protocol);
    const outcome = plain(run(context, `({ nativeCalls: native.calls.length, pending: native.pending.length, watchers: native.watchers.size, navigatorReads: native.navigatorReads })`));
    assert.deepEqual(outcome, { nativeCalls: 0, pending: 0, watchers: 0, navigatorReads: 2 }, 'the page reached navigator.geolocation only itself; the native requests never ran');
    assert.notEqual(run(context, 'Geolocation.prototype.getCurrentPosition'), before.get);
    assert.equal(run(context, 'Geolocation.prototype.clearWatch'), before.clear, 'clearWatch stays the native function');
    assert.deepEqual(plain(run(context, `['getCurrentPosition', 'watchPosition'].map(key => { const d = Object.getOwnPropertyDescriptor(Geolocation.prototype, key); return [d.writable, d.enumerable, d.configurable]; })`)), plain(before.flags), 'descriptor flags are kept');
    const veto = run(context, `Object.getOwnPropertyDescriptor(globalThis, Symbol.for('detect.expert/api-custom/value-capture-deny/v1'))`);
    assert.deepEqual(plain(veto), { value: true, writable: false, enumerable: false, configurable: false });
  }
});

test('a realm that did inherit the profile (marker plus a readable origin) is never touched', () => {
  for (const protocol of ['about:', 'data:', 'blob:']) {
    const context = opaque({ protocol, origin: 'https://example.test', inherited: true });
    const before = run(context, 'Geolocation.prototype.getCurrentPosition');
    guard(context);
    assert.equal(run(context, 'Geolocation.prototype.getCurrentPosition'), before);
    assert.equal(attempt(context, 'getCurrentPosition'), 'returned');
    assert.equal(run(context, 'native.calls.length'), 1, 'the native request ran once');
  }
});

test('a planted marker cannot exempt an opaque origin, and a throwing or missing origin is treated as opaque', () => {
  for (const [label, options] of [
    ['marker with null origin', { origin: 'null', inherited: true }],
    ['marker with a throwing origin', { origin: false, inherited: true, setup: `Object.defineProperty(globalThis, 'origin', { get() { throw new Error('inaccessible'); }, configurable: true });` }],
    ['marker without any origin', { origin: false, inherited: true }],
    ['no marker and a readable origin', { origin: 'https://example.test', inherited: false }]
  ]) {
    const context = opaque(options);
    guard(context);
    assert.equal(attempt(context, 'getCurrentPosition'), 'SecurityError:Geolocation profile unavailable in this frame', label);
    assert.equal(run(context, 'native.calls.length'), 0, label);
  }
});

test('ordinary documents (http, https, file, extension pages) are not touched by the guard', () => {
  for (const protocol of ['http:', 'https:', 'file:', 'chrome-extension:', 'moz-extension:']) {
    const context = opaque({ protocol, origin: 'https://example.test' });
    const before = run(context, 'Geolocation.prototype.getCurrentPosition');
    guard(context);
    assert.equal(run(context, 'Geolocation.prototype.getCurrentPosition'), before, protocol);
    assert.equal(run(context, `Object.getOwnPropertyDescriptor(globalThis, Symbol.for('detect.expert/api-custom/value-capture-deny/v1'))`), undefined, 'no veto outside opaque realms');
  }
  const bare = createRealm();
  assert.doesNotThrow(() => guard(bare), 'a realm without location is left alone');
  assert.equal(run(bare, 'native.calls.length'), 0);
});

test('the guard is idempotent, ignores a missing Geolocation, and a page cannot pre-empt it with the generic opaque marker', () => {
  const context = opaque();
  run(context, `Object.defineProperty(globalThis, Symbol.for('detect.expert/api-custom/opaque/geolocation/v1'), { value: true });`);
  guard(context);
  const once = run(context, 'Geolocation.prototype.getCurrentPosition');
  guard(context);
  assert.equal(run(context, 'Geolocation.prototype.getCurrentPosition'), once, 'no second layer');
  assert.equal(attempt(context, 'getCurrentPosition'), 'SecurityError:Geolocation profile unavailable in this frame');
  const absent = opaque({ setup: 'delete globalThis.Geolocation;' });
  assert.doesNotThrow(() => guard(absent));
  assert.deepEqual(plain(run(absent, `Reflect.ownKeys(globalThis).filter(key => typeof key === 'symbol').map(String).sort()`)), [
    'Symbol(detect.expert/api-custom/opaque/geolocation-deny/v1)', 'Symbol(detect.expert/api-custom/value-capture-deny/v1)']);
});
