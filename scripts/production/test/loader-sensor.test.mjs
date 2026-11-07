// REQ-002/004/005/011, ADR-021. Actual serialized MAIN modules + native API stand-ins.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { loaderSensorSupport, loaderSensorRuntimeSource } from '../loader-sensor-runtime.mjs';
import { proValueKey } from '../pro-values-runtime.mjs';
import { readLoaderRows } from '../../../packages/contracts/src/inspection.mjs';

const root = new URL('../../../', import.meta.url);
// Node URL and its getters are native API stand-ins for serialized browser tests.
// Transparent proxies preserve the real URL brand/implementation; they run no page handler.
function browserURLStandIn() {
  function URLStandIn(raw) { return new URL(raw); }
  for (const key of ['protocol', 'hostname', 'pathname', 'search', 'username', 'password', 'port']) Object.defineProperty(URLStandIn.prototype, key, {get:new Proxy(Object.getOwnPropertyDescriptor(URL.prototype,key).get,{})});
  return new Proxy(URLStandIn, {});
}
const gtm = 'https://www.googletagmanager.com/gtm.js?id=GTM-TEST&secret=QUERY_CANARY';
const fb = 'https://connect.facebook.net/en_US/fbevents.js?secret=QUERY_CANARY';
const positive = new Map([
  [gtm, 'google-tag-manager'],
  ['https://www.googletagmanager.com/gtag/js?id=G-TEST', 'google-analytics'],
  ['https://www.googletagmanager.com/gtag/js?id=UA-123-4', 'google-analytics'],
  ['https://www.googletagmanager.com/gtag/js?id=AW-123', 'google-ads'],
  ['https://www.google-analytics.com/analytics.js', 'google-analytics'], [fb, 'facebook-pixel'],
  ['https://static.hotjar.com/c/hotjar-123.js?sv=6', 'hotjar'],
  ['https://dynamic.criteo.com/js/ld/ld.js?a=1', 'criteo'],
  ['http://dynamic.criteo.com/js/ld/ld.js?a=1', 'criteo'],
  ['https://analytics.tiktok.com/i18n/pixel/events.js', 'tiktok-pixel'],
  ['https://snap.licdn.com/li.lms-analytics/insight.min.js', 'linkedin-insight'],
  ['https://bat.bing.com/bat.js', 'bing-uet'], ['http://bat.bing.com/bat.js', 'bing-uet'],
  ['https://www.clarity.ms/tag/abc123?ref=npm', 'microsoft-clarity'],
]);
test('only documented exact hosts, paths, schemes and Google product prefixes classify', () => {
  for (const [url, id] of positive) assert.equal(loaderSensorSupport.classify(url), id, url);
  for (const url of [
    'https://www.googletagmanager.com/gtm.js?id=AW-123', 'https://www.googletagmanager.com/gtag/js?id=GTM-TEST',
    'https://www.googletagmanager.com/gtag/js?id=GT-TEST', 'https://www.googletagmanager.com/gtm.js',
    'https://www.googletagmanager.com/gtag/js?id=GA-TEST',
    'https://www.googletagmanager.com/gtm.js?id=AW-123&id=GTM-TEST',
    'https://www.googletagmanager.com/gtm.js?id=GTM-TEST&%69%64=AW-123',
    'https://www.googletagmanager.com/gtag/js?id=AW-123&id=G-TEST',
    'https://www.googletagmanager.com/gtm.js?id=GTM-TEST.extra', 'https://static.criteo.net/js/ld/ld.js',
    'https://connect.facebook.net/en_GB/fbevents.js', 'https://connect.facebook.net.example.com/en_US/fbevents.js',
    'https://example.com/?url=' + fb, 'https://connect.facebook.net@evil.example/en_US/fbevents.js',
    'https://user:password@connect.facebook.net/en_US/fbevents.js', 'http://connect.facebook.net/en_US/fbevents.js',
    'https://connect.facebook.net:444/en_US/fbevents.js', 'https://static.hotjar.com/c/hotjar-x.js',
    'https://static.hotjar.com/c/hotjar-123.js/extra', 'https://www.clarity.ms/collect', 'javascript:' + fb,
    fb + 'x'.repeat(4096), ' ' + fb, 'https://www.clarity.ms/tag/mobile/abc123',
    'https://www.clarity.ms/tag/uet/123', 'https://www.clarity.ms/tag/',
  ]) assert.equal(loaderSensorSupport.classify(url), null, url.slice(0, 160));
  let reads = 0;
  assert.equal(loaderSensorSupport.classify({ toString() { reads++; return fb; } }), null);
  assert.equal(reads, 0);
});
test('sampled stack requires a GTM frame, not temporal cooccurrence or a query URL', () => {
  const collector = loaderSensorSupport.createCollector();
  assert.equal(loaderSensorSupport.stackSource('Error\n    at loader (' + gtm + ':12:34)', collector), true);
  assert.equal(loaderSensorSupport.stackSource('Error\nloader@' + gtm + ':12:34', collector), true);
  assert.equal(loaderSensorSupport.stackSource('Error\n    at loader (https://example.com/?nested=' + gtm + ':12:34)', collector), false);
  assert.equal(loaderSensorSupport.stackSource('Error\n    at ' + gtm + ' (https://example.com/app.js:12:34)', collector), false);
  assert.equal(loaderSensorSupport.stackSource(gtm + '\n    at unrelated (https://example.com/app.js:1:1)', collector), false);
  assert.equal(loaderSensorSupport.stackSource('Error\n' + '    at unrelated (https://example.com/app.js:1:1)\n'.repeat(9) + '    at late (' + gtm + ':1:1)', collector), false);
  assert.equal(collector.snapshot().truncated, true);
});
test('collector bounds nodes/samples, ignores unknown service IDs, copies snapshots and resets', () => {
  const collector = loaderSensorSupport.createCollector(), node = {};
  collector.record('facebook-pixel', 'exact-resource', node); collector.record('facebook-pixel', 'exact-resource', node);
  assert.equal(collector.snapshot().rows[0].count, 1);
  collector.record('facebook-pixel', 'exact-resource', node, true);
  collector.record('__proto__', 'exact-resource', {}); collector.record('constructor', 'sampled-stack', {});
  collector.record('hotjar', 'invented-confidence', {}); collector.record('hotjar', 'exact-resource', null);
  const copy = collector.snapshot(); copy.rows[0].count = 1000;
  assert.equal(collector.snapshot().rows[0].count, 2);
  for (let i = 0; i < 511; i++) collector.record('hotjar', 'sampled-stack', {});
  collector.record('criteo', 'exact-resource', {});
  assert.equal(collector.snapshot().rows.length, 2); assert.equal(collector.snapshot().truncated, true);
  collector.reset();
  for (let i = 0; i < 64; i++) assert.equal(collector.sample(), true);
  assert.equal(collector.sample(), false); assert.equal(collector.snapshot().truncated, true);
  collector.reset(); assert.deepEqual(collector.snapshot(), { rows: [], truncated: false });
});
test('canonical target/confidence combinations cap wire rows at eighteen', () => {
  const collector = loaderSensorSupport.createCollector();
  for (const target of new Set([...positive.values()].filter(target => target !== 'google-tag-manager'))) {
    collector.record(target, 'exact-resource', {}); collector.record(target, 'sampled-stack', {});
  }
  const rows = collector.snapshot().rows;
  assert.equal(rows.length, 18); assert.ok(readLoaderRows(rows));
  assert.ok(512 + rows.length * 256 < 16384);
});
test('actual collector count saturates at signed 32-bit maximum', () => {
  const c = vm.createContext({ URL: browserURLStandIn() });
  vm.runInContext(`globalThis.maps = []; class TrackingMap extends Map { constructor() { super(); maps.push(this); } } globalThis.Map = TrackingMap;` + loaderSensorRuntimeSource, c);
  const collector = c.loaderSensorSupport.createCollector(), node = {};
  collector.record('facebook-pixel', 'exact-resource', node);
  c.maps[0].get('facebook-pixel:exact-resource').count = 2147483646; // expose fixture-owned backing Map, not production output
  collector.record('facebook-pixel', 'exact-resource', node, true); collector.record('facebook-pixel', 'exact-resource', node, true);
  assert.equal(collector.snapshot().rows[0].count, 2147483647);
});
function section(source, first, last) {
  const start = source.indexOf(first), end = source.indexOf(last, start);
  assert.ok(start >= 0 && end > start, first); return source.slice(start, end);
}
function fixture(file, { stack = 'Error\n    at unrelated (https://example.com/app.js:1:1)', allowErrorConstructor = true } = {}) {
  const source = readFileSync(new URL('apps/production-extension/' + file, root), 'utf8');
  assert.equal(section(source, '  // packages/sensors/src/pro-loader.ts', '  // packages/sensors/src/api-results.ts'), loaderSensorRuntimeSource);
  const context = vm.createContext({ URL:browserURLStandIn(), stack, allowErrorConstructor, exception: new Error('original exception'), proValueKey, arrayPush: (array, value) => array.push(value), arraySlice: array => array.slice(), getDescriptor: Object.getOwnPropertyDescriptor });
  vm.runInContext(`
    globalThis.stackConstructions = 0;
    class StackError { constructor() { stackConstructions++; Object.defineProperty(this, 'stack', { value: stack }); } }
    globalThis.Error = StackError;
  ` + section(source, '// packages/contracts/src/technique-ids.ts', '// packages/sensors/src/wrap.ts') +
    section(source, '// packages/sensors/src/wrap.ts', '// packages/sensors/src/intrinsics.ts') +
    section(source, '// packages/sensors/src/codes.ts', '// ADR-017: Pro values') +
    section(source, '// ADR-030 beacon MAIN sensor start', '// ADR-030 beacon MAIN sensor end') +
    section(source, '// packages/sensors/src/social-network.ts', '// packages/sensors/src/runtime.ts') +
    section(source, '// packages/sensors/src/extension-resource.ts', '// packages/sensors/src/timing.ts') + `
    globalThis.recorder = new ApiResultRecorder(false);
    globalThis.originalCalls = 0; globalThis.srcWrites = 0; globalThis.currentLoader = null;
    globalThis.originalAction = null; globalThis.throwOriginal = false;
    const sourceData = new WeakMap(), connectedData = new WeakMap();
    function nativeInsert(receiver, node) { originalCalls++; if (originalAction) originalAction(); if (throwOriginal) throw exception; connectedData.set(node, connectedData.get(receiver) === true); }
    class TestNode {
      constructor(connected = false) { connectedData.set(this, connected); }
      get isConnected() { if (!connectedData.has(this)) throw new TypeError('brand'); return connectedData.get(this); }
      appendChild(node) { nativeInsert(this, node); return node; }
      insertBefore(node, before) { nativeInsert(this, node); return node; }
      replaceChild(node, old) { nativeInsert(this, node); return old; }
    }
    class TestScript extends TestNode {
      constructor(raw = '') { super(); sourceData.set(this, raw); connectedData.set(this, false); }
      get src() { if (!sourceData.has(this)) throw new TypeError('brand'); return sourceData.get(this); }
      set src(value) { srcWrites++; if (throwOriginal) throw exception; sourceData.set(this, String(value)); }
    }
    class TestDocument { get currentScript() { if (this !== documentFixture) throw new TypeError('brand'); return currentLoader; } }
    const documentFixture = new TestDocument();
    const realm = { HTMLScriptElement: TestScript, Document: TestDocument, Node: TestNode, document: documentFixture };
    globalThis.visualCaptureFor = () => null;
    globalThis.runtime = { hooks: createHookContext(), apiResults: recorder, handles: [], flags: [], extensionEvents: [], onStop() {}, record() {}, recordResult() {}, recordOperation() {}, recordExtensionResource(target,method,phase) {this.extensionEvents.push({target,method,phase});}, attach(handles) { for (const handle of handles) { if (handle.status === 'installed') this.handles.push(handle); else this.flags.push(handle.coverageFlag); } } };
    globalThis.host = new TestNode(true); globalThis.detached = new TestNode(false); globalThis.script = new TestScript(${JSON.stringify(fb)});
    globalThis.loader = new TestScript(${JSON.stringify(gtm)});
    globalThis.other = new TestScript('https://example.com/app.js');
    globalThis.makeScript = raw => new TestScript(raw);
    loaderSensorSupport.install(runtime, realm, { wrapPreparedMethod, wrapSetter }, fn => typeof fn === 'function' && (allowErrorConstructor || fn !== Error));
    installBrowserRequestSensor(runtime, realm);
    globalThis.run = fn => fn();
  `, context);
  return context;
}
const plain = value => JSON.parse(JSON.stringify(value));
const numberRow = value => ({ operation: 'Window.innerWidth', techniqueId: 'DET-030', phase: 'returned-sync', value: {kind:'number',value}, parameters: [], count: 1 });
test('a preinstalled URL subclass/accessor cannot abort bootstrap or run page URL code', () => {
  let constructions = 0;
  class CustomURL extends URL { constructor(...args) { constructions++; super(...args); } }
  const c = vm.createContext({URL:CustomURL}); vm.runInContext(loaderSensorRuntimeSource, c);
  assert.equal(c.loaderSensorSupport.classify(fb), null); assert.equal(constructions, 0);
  assert.equal(c.loaderSensorSupport.createCollector().snapshot().truncated, true);
  const getter = vm.createContext({});
  vm.runInContext("globalThis.urlReads=0; Object.defineProperty(globalThis,'URL',{configurable:true,get(){urlReads++;throw new Error('page URL accessor');}});" + loaderSensorRuntimeSource, getter);
  assert.equal(getter.urlReads, 0); assert.equal(getter.loaderSensorSupport.classify(fb), null);
});
for (const file of ['hook.early.js', 'hook.main.js']) {
  test(file + ': originals once, return identity, detached src + insertion one observation', () => {
    const c = fixture(file); c.recorder.proSession = 'test'; c.currentLoader = c.loader;
    c.script.src = fb; assert.equal(c.srcWrites, 1); assert.equal(c.recorder.loaderCollector.snapshot().rows.length, 0);
    assert.equal(c.host.appendChild(c.script), c.script); assert.equal(c.originalCalls, 1);
    let rows = plain(c.recorder.loaderCollector.snapshot().rows);
    assert.equal(rows[0].attributionConfidence, 'exact-resource'); assert.equal(rows[0].count, 1);
    assert.ok(readLoaderRows(rows)); assert.doesNotMatch(JSON.stringify(rows), /QUERY_CANARY|GTM-TEST|https:/);
    c.script.src = fb; assert.equal(c.srcWrites, 2); assert.equal(c.recorder.loaderCollector.snapshot().rows[0].count, 2);
    c.host.appendChild(c.script); assert.equal(c.originalCalls, 2); assert.equal(c.recorder.loaderCollector.snapshot().rows[0].count, 2);
    assert.equal(c.runtime.hooks.observerErrors, 0);
    for (const handle of c.runtime.handles) assert.equal(handle.restore(), true);
    assert.equal(c.host.appendChild(c.script), c.script); assert.equal(c.originalCalls, 3);
    assert.equal(c.recorder.loaderCollector.snapshot().rows[0].count, 2);
  });
  test(file + ': original exceptions retain identity and never create a loader row', () => {
    const c = fixture(file); c.recorder.proSession = 'test'; c.currentLoader = c.loader; c.throwOriginal = true;
    assert.throws(() => c.host.appendChild(c.script), error => error === c.exception);
    assert.throws(() => { c.script.src = fb; }, error => error === c.exception);
    assert.equal(c.originalCalls, 1); assert.equal(c.srcWrites, 1);
    assert.equal(c.recorder.loaderCollector.snapshot().rows.length, 0); assert.equal(c.runtime.hooks.observerErrors, 0);
  });
  test(file + ': a single actual script setter observer preserves DET-059 and loader evidence', () => {
    const c = fixture(file); c.recorder.proSession = 'test'; c.currentLoader = c.loader;
    c.host.appendChild(c.script); c.script.src = 'chrome-extension://' + c.EXTENSION_TARGET_IDS[0] + '/resource.js';
    assert.equal(c.srcWrites, 1); assert.equal(c.originalCalls, 1);
    assert.equal(c.runtime.extensionEvents.length, 1);
    assert.equal(c.runtime.extensionEvents[0].target, 1); assert.equal(c.runtime.extensionEvents[0].method, c.EXTENSION_METHOD_INDEX['script-src']);
    assert.equal(c.runtime.extensionEvents[0].phase, c.PHASE_INDEX['returned-sync']);
    assert.equal(c.recorder.loaderCollector.snapshot().rows[0].target, 'facebook-pixel');
    assert.equal(c.runtime.handles.filter(handle=>handle.kind==='setter'&&handle.key==='src').length,1);
    assert.equal(c.runtime.hooks.observerErrors, 0);
  });
  test(file + ': detached insertion is not a resource load, all native insertion returns stay intact', () => {
    const c = fixture(file); c.recorder.proSession = 'test'; c.currentLoader = c.loader;
    assert.equal(c.detached.appendChild(c.script), c.script); assert.equal(c.originalCalls, 1);
    assert.equal(c.recorder.loaderCollector.snapshot().rows.length, 0);
    assert.equal(c.host.insertBefore(c.script, null), c.script); assert.equal(c.originalCalls, 2);
    const fresh = c.makeScript('https://static.hotjar.com/c/hotjar-123.js?sv=6'), old = {};
    assert.equal(c.host.replaceChild(fresh, old), old); assert.equal(c.originalCalls, 3);
    assert.equal(c.recorder.loaderCollector.snapshot().rows.length, 2); assert.equal(c.runtime.hooks.observerErrors, 0);
  });
  test(file + ': objects/getters never coerced or read by the observer', () => {
    const c = fixture(file); c.recorder.proSession = 'test'; c.currentLoader = c.loader;
    let reads = 0, coerces = 0;
    const hostile = { get src() { reads++; throw Error('forbidden src'); }, get ownerDocument() { reads++; throw Error('forbidden document'); }, toString() { coerces++; return fb; } };
    assert.equal(c.host.appendChild(hostile), hostile); assert.equal(reads, 0); assert.equal(coerces, 0);
    c.script.src = hostile; assert.equal(coerces, 1); assert.equal(reads, 0); // native setter's own WebIDL coercion only
    assert.equal(c.recorder.loaderCollector.snapshot().rows.length, 0); assert.equal(c.runtime.hooks.observerErrors, 0);
  });
  test(file + ': no temporal, inactive, paused, or cross-token edge', () => {
    const c = fixture(file); c.currentLoader = c.loader; c.host.appendChild(c.script);
    c.recorder.proSession = 'test'; c.currentLoader = c.other; c.host.appendChild(c.makeScript(fb));
    c.currentLoader = null; c.host.appendChild(c.makeScript(fb));
    c.currentLoader = c.loader; c.runtime.hooks.enabled = false; c.host.appendChild(c.makeScript(fb));
    c.runtime.hooks.enabled = true;
    c.originalAction = () => { c.recorder.clearPro(); c.recorder.proSession = 'new-token'; };
    c.host.appendChild(c.makeScript(fb));
    assert.equal(c.recorder.loaderCollector.snapshot().rows.length, 0); assert.equal(c.runtime.hooks.observerErrors, 0);
  });
  test(file + ': reentrant src mutation inside insertion cannot attribute a stale target', () => {
    const c = fixture(file); c.recorder.proSession = 'test'; c.currentLoader = c.loader;
    c.originalAction = () => { c.script.src = 'https://static.hotjar.com/c/hotjar-123.js?sv=6'; };
    assert.equal(c.host.appendChild(c.script), c.script); assert.equal(c.originalCalls, 1); assert.equal(c.srcWrites, 1);
    assert.equal(c.recorder.loaderCollector.snapshot().rows.length, 0); assert.equal(c.runtime.hooks.observerErrors, 0);
  });
  test(file + ': stack confidence remains distinct; custom formatter accessor is never called', () => {
    const c = fixture(file, { stack: 'Error\n    at asyncLoader (' + gtm + ':10:20)' }); c.recorder.proSession = 'test';
    c.host.appendChild(c.script); assert.equal(c.recorder.loaderCollector.snapshot().rows[0].attributionConfidence, 'sampled-stack');
    vm.runInContext("globalThis.formatterReads = 0; Object.defineProperty(Error, 'prepareStackTrace', { configurable:true, get() { formatterReads++; throw exception; } });", c);
    c.host.appendChild(c.makeScript('https://static.hotjar.com/c/hotjar-123.js?sv=6'));
    assert.equal(c.formatterReads, 0); assert.equal(c.recorder.loaderCollector.snapshot().rows.length, 1);
    assert.equal(c.recorder.loaderCollector.snapshot().truncated, true); assert.equal(c.runtime.hooks.observerErrors, 0);
  });
  test(file + ': inherited formatter/getter and non-native Error constructors are not invoked', () => {
    const c = fixture(file, { allowErrorConstructor: false }); c.recorder.proSession = 'test'; c.host.appendChild(c.script);
    assert.equal(c.stackConstructions, 0); assert.equal(c.recorder.loaderCollector.snapshot().truncated, true);
    const inherited = fixture(file); inherited.recorder.proSession = 'test';
    vm.runInContext("globalThis.inheritedReads=0; Object.defineProperty(Object.getPrototypeOf(Error), 'prepareStackTrace', { configurable:true, get() { inheritedReads++; throw exception; } });", inherited);
    inherited.host.appendChild(inherited.script);
    assert.equal(inherited.inheritedReads, 0); assert.equal(inherited.stackConstructions, 0);
    assert.equal(inherited.recorder.loaderCollector.snapshot().truncated, true); assert.equal(inherited.runtime.hooks.observerErrors, 0);
  });
  test(file + ': captured regex/string intrinsics ignore page prototype replacements', () => {
    const c = fixture(file); c.recorder.proSession = 'test'; c.currentLoader = c.loader;
    vm.runInContext("RegExp.prototype.exec = () => { throw exception; }; RegExp.prototype.test = () => { throw exception; }; String.prototype.match = () => { throw exception; }; String.prototype.replace = () => { throw exception; }; String.prototype.split = () => { throw exception; };", c);
    c.host.appendChild(c.script); assert.equal(c.recorder.loaderCollector.snapshot().rows[0].target, 'facebook-pixel');
    assert.equal(c.runtime.hooks.observerErrors, 0);
  });
  test(file + ': fallback sampling never invokes a replaced Array iterator', () => {
    const c = fixture(file, {stack:'Error\n    at asyncLoader (' + gtm + ':1:2)'}); c.recorder.proSession = 'test';
    vm.runInContext("globalThis.iteratorReads=0; Object.defineProperty(Array.prototype, Symbol.iterator, {configurable:true,get() { iteratorReads++; throw exception; }});", c);
    c.host.appendChild(c.script); assert.equal(c.iteratorReads, 0);
    assert.equal(c.recorder.loaderCollector.snapshot().rows[0].attributionConfidence, 'sampled-stack'); assert.equal(c.runtime.hooks.observerErrors, 0);
  });
  test(file + ': final-only wire metadata and stop/start/read token lifecycle', () => {
    const c = fixture(file), messages = []; let now = 1000;
    const control = (type, token = 'session') => c.recorder.handleProControl({ channel: 'detect.expert/pro-values/v1', type, sessionId: token, requestId: 'pro-1' }, true, { now: () => now += 1000, postMessage: value => messages.push(plain(value)) });
    control('pro-values-start'); c.currentLoader = c.loader; c.host.appendChild(c.script);
    c.recorder.storePro(numberRow(1000)); control('pro-values-read');
    const body = messages.at(-2), final = messages.at(-1);
    assert.equal(body.final, false); assert.equal(Object.hasOwn(body, 'loaderRows'), false);
    assert.equal(final.final, true); assert.deepEqual(final.rows, []); assert.equal(final.loaderRows[0].count, 1); assert.ok(readLoaderRows(final.loaderRows));
    control('pro-values-stop', 'wrong'); assert.equal(c.recorder.proSession, 'session');
    control('pro-values-read', 'wrong'); assert.equal(messages.at(-1).enabled, false); assert.deepEqual(messages.at(-1).loaderRows, []);
    control('pro-values-start'); assert.equal(messages.at(-1).loaderRows[0].count, 1); // same-token start keeps baseline
    control('pro-values-stop'); assert.equal(c.recorder.proSession, ''); assert.equal(c.recorder.loaderCollector.snapshot().rows.length, 0);
    control('pro-values-start', 'new-token'); assert.deepEqual(messages.at(-1).loaderRows, []); assert.equal(messages.at(-1).loaderTruncated, false);
    assert.equal(c.runtime.hooks.observerErrors, 0);
  });
  test(file + ': unsupported loader installation remains limited across new recording tokens', () => {
    const c = fixture(file);
    vm.runInContext('loaderSensorSupport.install(runtime, {}, { wrapPreparedMethod, wrapSetter });', c);
    assert.equal(c.recorder.loaderCollector.snapshot().truncated, true);
    c.recorder.clearPro(); assert.equal(c.recorder.loaderCollector.snapshot().truncated, true);
    assert.equal(c.runtime.hooks.observerErrors, 0);
  });
  test(file + ': full API history emits bounded chunks and independent final loader metadata', () => {
    const c = fixture(file), messages = []; c.recorder.proSession = 'full';
    for (let i = 0; i < 256; i++) c.recorder.storePro(numberRow(i));
    const admitted = c.recorder.proRows.size; assert.ok(admitted > 32 && admitted < 256); assert.equal(c.recorder.proTruncated, true);
    for (const target of new Set([...positive.values()].filter(target => target !== 'google-tag-manager'))) {
      c.recorder.loaderCollector.record(target, 'exact-resource', {}); c.recorder.loaderCollector.record(target, 'sampled-stack', {});
    }
    c.recorder.handleProControl({channel:'detect.expert/pro-values/v1',type:'pro-values-read',sessionId:'full',requestId:'pro-1'}, true, {now:()=>1000,postMessage:value=>messages.push(plain(value))});
    assert.equal(messages.length, Math.ceil(admitted / 32) + 1); assert.equal(messages.slice(0, -1).reduce((sum, row) => sum + row.rows.length, 0), admitted);
    assert.deepEqual(messages.at(-1).rows, []); assert.equal(messages.at(-1).loaderRows.length, 18);
    assert.equal(messages.at(-1).truncated, true);
    for (let i = 0; i < messages.length; i++) { assert.equal(messages[i].batchSeq, i); assert.equal(messages[i].final, i === messages.length - 1); assert.ok(messages[i].rows.length <= 32); }
  });
}
