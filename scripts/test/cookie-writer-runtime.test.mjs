import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createCookieWriterSupport, cookieWriterRuntimeSource } from '../production/cookie-writer-runtime.mjs';
import { createSocialSensorSupport } from '../production/social-sensor-runtime.mjs';
import { createSocialNetworkDetector } from '../../apps/production-extension/social-network-detector.js';
import { COOKIE_WRITER_LIMITS, cookieWriterRowKey, cookieWriterRowBytes, readCookieWriterRows, readCookieWriterSnapshot, readCookieWriterDocuments } from '../../packages/contracts/src/cookie-writers.mjs';

const plain = value => JSON.parse(JSON.stringify(value));
function fixture({ stack = 'Error\n    at caller (https://cdn.example.com/tracker.js?PRIVATE_QUERY:12:34)' } = {}) {
  const context = vm.createContext({ URL, stack });
  vm.runInContext(`
    globalThis.stackConstructions = 0;
    class FakeError { constructor() { stackConstructions++; Object.defineProperty(this, 'stack', { value: stack }); } }
    globalThis.Error = FakeError;
    globalThis.maps = [];
    class TrackingMap extends Map { constructor() { super(); maps.push(this); } }
    globalThis.Map = TrackingMap;
    var detector = (${createSocialNetworkDetector.toString()})(true);
    var social = (${createSocialSensorSupport.toString()})(detector, true);
    var support = (${createCookieWriterSupport.toString()})(detector, social, true);
    class Script { constructor(url) { this.raw = url; } get src() { return this.raw; } }
    class Doc { get currentScript() { return globalThis.executing; } }
    var document = new Doc(), executing = new Script('https://assets.example.com/client.js?PRIVATE_QUERY#PRIVATE_FRAGMENT');
    var realm = { Document: Doc, HTMLScriptElement: Script, document };
    var stopHandlers = [];
    var collector = support.createCollector();
    var runtime = { hooks: { enabled: true }, apiResults: { generation: 0, cookieWriterCollector: collector }, onStop: callback => stopHandlers.push(callback) };
    support.install(runtime, realm, () => true);
    var write = (raw, threw = false, receiver = document) => runtime.observeCookieWrite(receiver, [raw], threw);
  `, context);
  return context;
}

test('cookie writer inspects only a bounded name prefix and never coerces non-strings', () => {
  const c = fixture(); let operations = 0;
  const hostile = new Proxy({}, { get() { ++operations; throw Error('forbidden'); }, getOwnPropertyDescriptor() { ++operations; throw Error('forbidden'); } });
  assert.equal(c.support.cookieName(hostile), null); c.write(hostile); assert.equal(operations, 0);
  assert.equal(c.support.cookieName(' \t_cookie-name\t =VALUE_CANARY; Path=/'), '_cookie-name');
  assert.equal(c.support.cookieName('a=' + 'PRIVATE'.repeat(100000)), 'a');
  assert.equal(c.support.cookieName('a'.repeat(256) + '=private'), 'a'.repeat(256));
  for (const raw of ['a'.repeat(257) + '=private', ' '.repeat(512) + 'id=private', '=private', 'bare-value', 'a;b=private', 'bad name=private', 'a\r=private', 'é=private']) assert.equal(c.support.cookieName(raw), null);
  assert.deepEqual(plain(c.collector.snapshot().rows), []);
});

test('writer preserves phase variants and exact currentScript attribution without Cookie value or query', () => {
  const c = fixture(); c.write('_id=COOKIE_VALUE_CANARY; Path=/'); c.write('_id=OTHER_VALUE_CANARY'); c.write('_id=THROWN_VALUE_CANARY', true);
  const snapshot = plain(c.collector.snapshot());
  assert.equal(snapshot.rows.length, 2); assert.equal(snapshot.rows[0].count, 2);
  assert.equal(snapshot.rows[0].phase, 'returned-sync'); assert.equal(snapshot.rows[1].phase, 'threw-sync');
  assert.deepEqual(snapshot.rows[0].script, { host: 'assets.example.com', pathTemplate: '/client.js' });
  assert.equal(snapshot.rows[0].attributionConfidence, 'exact-resource'); assert.equal(c.stackConstructions, 0);
  assert.ok(readCookieWriterRows(snapshot.rows)); assert.doesNotMatch(JSON.stringify(snapshot), /VALUE_CANARY|PRIVATE_QUERY|PRIVATE_FRAGMENT|https:|Path=/);
  assert.equal(snapshot.rows[0].evidenceSource, 'page-hook'); assert.equal(snapshot.rows[0].integrity, 'page-controlled');
});

test('missing currentScript reuses bounded Social stack parsing and does not invent exact-resource', () => {
  const c = fixture(); c.executing = null; c.write('id=SECRET');
  const row = plain(c.collector.snapshot().rows[0]);
  assert.equal(row.attributionConfidence, 'sampled-stack'); assert.deepEqual(row.script, { host: 'cdn.example.com', pathTemplate: '/tracker.js' });
  assert.equal(c.stackConstructions, 1); assert.doesNotMatch(JSON.stringify(row), /PRIVATE_QUERY|SECRET|:12:34/);
  const noSource = fixture({ stack: 'Error\n    at anonymous (<anonymous>:1:2)' }); noSource.executing = null; noSource.write('id=SECRET');
  assert.equal(noSource.collector.snapshot().rows[0].script, null); assert.equal(noSource.collector.snapshot().rows[0].attributionConfidence, 'unknown');
});

test('stack attribution skips page formatters and accessors without invoking them', () => {
  for (const declaration of [
    "Object.defineProperty(Error, 'prepareStackTrace', { get() { forbidden++; throw 1; } });",
    "Error.prepareStackTrace = () => { forbidden++; return 'forged'; };",
    "Object.defineProperty(Error, 'stackTraceLimit', { get() { forbidden++; return 10; } });",
    'Error.stackTraceLimit = 100000;'
  ]) {
    const c = fixture(); vm.runInContext('var forbidden = 0;' + declaration, c); c.executing = null; c.write('id=SECRET');
    assert.equal(c.forbidden, 0); assert.equal(c.stackConstructions, 0);
    assert.equal(c.collector.snapshot().rows[0].attributionConfidence, 'unknown'); assert.equal(c.collector.snapshot().truncated, true);
  }
});

test('stack samples, retained rows and bytes stay bounded and disclose loss', () => {
  const c = fixture(); c.executing = null;
  for (let index = 0; index < 100; ++index) c.write('id' + index + '=SECRET');
  const snapshot = plain(c.collector.snapshot());
  assert.equal(c.stackConstructions, 64); assert.equal(snapshot.truncated, true);
  assert.ok(snapshot.rows.length <= COOKIE_WRITER_LIMITS.rows);
  assert.ok(snapshot.rows.reduce((bytes, row) => bytes + cookieWriterRowBytes(row), 512) <= COOKIE_WRITER_LIMITS.bytes);
  assert.ok(readCookieWriterRows(snapshot.rows));
  const hugeStack = fixture({ stack: 'Error\n' + '    at a (https://one.example.com/main.js:1:1)\n'.repeat(400) }); hugeStack.executing = null; hugeStack.write('id=SECRET');
  assert.equal(hugeStack.collector.snapshot().truncated, true);
});

test('a different receiver, disabled hooks, generation clear and stop cannot preserve stale writer data', () => {
  const c = fixture(); c.write('foreign=SECRET', false, {}); assert.equal(c.collector.snapshot().rows.length, 0);
  c.runtime.hooks.enabled = false; c.write('paused=SECRET'); assert.equal(c.collector.snapshot().rows.length, 0);
  c.runtime.hooks.enabled = true; c.write('old=SECRET'); ++c.runtime.apiResults.generation; c.write('new=SECRET');
  assert.deepEqual(plain(c.collector.snapshot().rows.map(row => row.name)), ['new']);
  vm.runInContext('for (const stop of stopHandlers) stop();', c); assert.equal(c.collector.snapshot().rows.length, 0);
});

test('captured intrinsics ignore post-install page prototype poisoning and instance source accessors', () => {
  const c = fixture();
  vm.runInContext(`
    var forbidden = 0;
    Object.defineProperty(document, 'currentScript', { get() { forbidden++; throw 1; } });
    Object.defineProperty(executing, 'src', { get() { forbidden++; throw 1; } });
    String.prototype.slice = String.prototype.charCodeAt = RegExp.prototype.exec = Map.prototype.get = Map.prototype.set = Map.prototype.forEach = Array.prototype.push = function() { forbidden++; throw 1; };
    write('_safe=VALUE_CANARY');
  `, c);
  const snapshot = plain(c.collector.snapshot()); assert.equal(c.forbidden, 0); assert.equal(snapshot.rows[0].name, '_safe');
  assert.doesNotMatch(JSON.stringify(snapshot), /VALUE_CANARY/);
});

test('writer counts saturate, snapshots are detached and row keys retain all source variants', () => {
  const c = fixture(); c.write('id=SECRET'); const row = plain(c.collector.snapshot().rows[0]);
  c.maps[0].get(cookieWriterRowKey(row)).count = 2147483646; c.write('id=SECRET'); c.write('id=SECRET');
  assert.equal(c.collector.snapshot().rows[0].count, 2147483647); assert.equal(c.collector.snapshot().truncated, true);
  const snapshot = c.collector.snapshot(); snapshot.rows[0].script.host = 'changed.test'; snapshot.rows[0].count = 0;
  assert.equal(c.collector.snapshot().rows[0].script.host, 'assets.example.com');
  c.collector.record('id', 'returned-sync', { script: { host: 'other.test', pathTemplate: '/main.js' }, attributionConfidence: 'sampled-stack' });
  assert.equal(c.collector.snapshot().rows.length, 2);
});

test('MAIN control replies contain only metadata and are rate limited or empty when disabled', () => {
  const c = fixture(); c.write('id=SECRET'); const sent = []; let now = 0;
  const env = { now: () => now, postMessage: value => sent.push(plain(value)) };
  const request = { channel: 'detect.expert/cookie-writers/v1', type: 'cookie-writers-read', requestId: 'cookie-writers-1' };
  c.collector.handleControl(request, true, env); c.collector.handleControl(request, true, env);
  assert.equal(sent.length, 1); assert.ok(readCookieWriterRows(sent[0].rows)); assert.doesNotMatch(JSON.stringify(sent), /SECRET/);
  now = 501; c.collector.handleControl(request, false, env); assert.equal(sent.length, 2); assert.deepEqual(sent[1].rows, []); assert.equal(sent[1].enabled, false);
  now = 1002; c.collector.handleControl({ ...request, requestId: 'cookie-writers-FORGED' }, true, env); assert.equal(sent.length, 2);
});

test('canonical writer schema refuses values, browser trust, forged attribution, unknown paths and executable fields', () => {
  const c = fixture(); c.write('id=SECRET'); const row = plain(c.collector.snapshot().rows[0]);
  for (const change of [ { value: 'SECRET' }, { cookieValue: 'SECRET' }, { evidenceSource: 'browser-network', integrity: 'browser-observed' }, { phase: 'attempted' },
    { script: null }, { attributionConfidence: 'unknown' }, { script: { host: 'example.com', pathTemplate: '/private-id.js' } },
    { script: { host: 'example.com?private', pathTemplate: '/<script>' } }, { count: 0 } ]) assert.equal(readCookieWriterRows([{ ...row, ...change }]), null);
  assert.equal(readCookieWriterRows([row, row]), null);
  let reads = 0; const hostile = { ...row }; Object.defineProperty(hostile, 'name', { get() { ++reads; return 'id'; } });
  assert.equal(readCookieWriterRows([hostile]), null); assert.equal(reads, 0);
  const script = { ...row.script }; Object.defineProperty(script, 'host', { get() { ++reads; return 'example.com'; } });
  assert.equal(readCookieWriterRows([{ ...row, script }]), null); assert.equal(reads, 0);
});

test('canonical document snapshots preserve independent identities and constrain aggregate capacity', () => {
  const c = fixture(); c.write('id=SECRET'); const row = plain(c.collector.snapshot().rows[0]);
  const snapshot = { schemaVersion: 1, type: 'cookie-writers-state', documentKey: '1:0:native', coverageState: 'partial', rows: [row], truncated: false };
  assert.ok(readCookieWriterSnapshot(snapshot)); assert.equal(readCookieWriterSnapshot({ ...snapshot, coverageState: 'paused' }), null);
  assert.equal(readCookieWriterDocuments([snapshot, snapshot]), null);
  assert.equal(readCookieWriterDocuments(Array.from({ length: 25 }, (_, i) => ({ ...snapshot, documentKey: `1:${i}:native` }))), null);
  const rows = Array.from({ length: 26 }, (_, i) => ({ ...row, name: 'id' + i, script: null, attributionConfidence: 'unknown' }));
  assert.ok(readCookieWriterRows(rows));
  assert.equal(readCookieWriterDocuments(Array.from({ length: 10 }, (_, i) => ({ ...snapshot, documentKey: `1:${i}:native`, rows }))), null);
  const read = readCookieWriterSnapshot(snapshot); snapshot.rows[0].script.host = 'changed.test'; assert.notEqual(read.rows[0].script.host, 'changed.test');
});

test('serialized module uses the injected detector and stack helper without privileged APIs', () => {
  const context = vm.createContext({ socialNetworkDetector: { ready: false }, socialSensorSupport: { stackSource() { throw Error('unused'); } } });
  vm.runInContext(cookieWriterRuntimeSource, context);
  assert.equal(context.cookieWriterSupport.cookieName('id=SECRET'), 'id');
  assert.equal(context.cookieWriterSupport.createCollector().snapshot().truncated, true);
  assert.doesNotMatch(cookieWriterRuntimeSource, /chrome\.|browser\.|fetch\(|XMLHttpRequest|document\.cookie\s*=/);
});

function accessorFixture(file) {
  const c = fixture(), source = readFileSync(new URL('../../apps/production-extension/' + file, import.meta.url), 'utf8');
  const start = source.indexOf('  // packages/sensors/src/wrap.ts'), end = source.indexOf('  // packages/sensors/src/intrinsics.ts', start);
  assert.ok(start >= 0 && end > start);
  assert.match(source.slice(start, end), /options\?\.observeSetter/);
  vm.runInContext(source.slice(start, end) + `
    var getCalls = 0, setCalls = 0, shouldThrow = false, marker = {}, failure = {}, argument, receiver;
    var nativeGetter = function() { ++getCalls; if (shouldThrow) throw failure; return marker; };
    var nativeSetter = function(value) { ++setCalls; argument = value; receiver = this; if (shouldThrow) throw failure; if (typeof value !== 'string') String(value); return marker; };
    Object.defineProperty(Doc.prototype, 'cookie', { configurable: true, enumerable: true, get: nativeGetter, set: nativeSetter });
    runtime.hooks.observerErrors = 0;
    var getterObservations = 0;
    var handle = wrapGetter(Doc.prototype, 'cookie', () => { ++getterObservations; }, {
      context: runtime.hooks, observeSetter: (receiver, args, threw) => runtime.observeCookieWrite(receiver, args, threw)
    });
    var wrapped = Object.getOwnPropertyDescriptor(Doc.prototype, 'cookie');
  `, c);
  return c;
}
for (const file of ['hook.early.js', 'hook.main.js']) {
  test(file + ': combined getter/setter calls each original once and preserves result, receiver and descriptors', () => {
    const c = accessorFixture(file);
    assert.equal(c.handle.status, 'installed');
    assert.equal(Reflect.apply(c.wrapped.set, c.document, ['id=VALUE_CANARY']), c.marker);
    assert.equal(c.setCalls, 1); assert.equal(c.argument, 'id=VALUE_CANARY'); assert.equal(c.receiver, c.document);
    assert.equal(c.getCalls, 0, 'setter observation never reads cookie jar');
    assert.equal(Reflect.apply(c.wrapped.get, c.document, []), c.marker); assert.equal(c.getCalls, 1); assert.equal(c.getterObservations, 1);
    assert.equal(c.wrapped.enumerable, true); assert.equal(c.wrapped.configurable, true);
    assert.equal(c.collector.snapshot().rows[0].phase, 'returned-sync');
    assert.equal(c.handle.restore(), true);
    const restored = vm.runInContext('Object.getOwnPropertyDescriptor(Doc.prototype, "cookie")', c);
    assert.equal(restored.get, c.nativeGetter); assert.equal(restored.set, c.nativeSetter);
    assert.doesNotMatch(JSON.stringify(plain(c.collector.snapshot())), /VALUE_CANARY/);
  });
  test(file + ': original thrown identity, disabled observation and observer faults leave native behavior intact', () => {
    const c = accessorFixture(file); c.shouldThrow = true;
    assert.throws(() => Reflect.apply(c.wrapped.set, c.document, ['id=SECRET']), error => error === c.failure);
    assert.equal(c.setCalls, 1); assert.equal(c.collector.snapshot().rows[0].phase, 'threw-sync');
    c.shouldThrow = false; c.runtime.hooks.enabled = false;
    assert.equal(Reflect.apply(c.wrapped.set, c.document, ['disabled=SECRET']), c.marker); assert.equal(c.setCalls, 2); assert.equal(c.collector.snapshot().rows.length, 1);
    c.runtime.hooks.enabled = true; c.runtime.observeCookieWrite = () => { throw Error('observer failure'); };
    assert.equal(Reflect.apply(c.wrapped.set, c.document, ['id=SECRET']), c.marker); assert.equal(c.setCalls, 3); assert.equal(c.runtime.hooks.observerErrors, 1);
  });
  test(file + ': non-string native conversion executes once and observer never inspects the argument Proxy', () => {
    const c = accessorFixture(file); let reads = 0, descriptors = 0, coercions = 0;
    const input = new Proxy({ toString() { ++coercions; return 'id=PRIVATE'; } }, { get(target, key, receiver) { ++reads; return Reflect.get(target, key, receiver); }, getOwnPropertyDescriptor() { ++descriptors; throw Error('observer inspected argument'); } });
    Reflect.apply(c.nativeSetter, c.document, [input]); const baselineReads = reads; assert.equal(coercions, 1);
    Reflect.apply(c.wrapped.set, c.document, [input]); assert.equal(coercions, 2); assert.equal(reads, baselineReads * 2); assert.equal(descriptors, 0);
    assert.equal(c.setCalls, 2); assert.equal(c.collector.snapshot().rows.length, 0); assert.equal(c.collector.snapshot().truncated, true);
  });
  test(file + ': one registry handle owns both accessors and cannot overwrite a page replacement', () => {
    const c = accessorFixture(file);
    vm.runInContext('var sameHandle = wrapSetter(Doc.prototype, "cookie", () => { throw 1; }, { context: runtime.hooks }); var replacement = function() {}; Object.defineProperty(Doc.prototype, "cookie", { set: replacement });', c);
    assert.equal(c.sameHandle, c.handle); assert.equal(c.handle.restore(), false);
    assert.equal(vm.runInContext('Object.getOwnPropertyDescriptor(Doc.prototype, "cookie").set', c), c.replacement);
  });
}
