import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { socialSensorSupport as support, socialSensorRuntimeSource } from '../production/social-sensor-runtime.mjs';
import { startSocialValuesBridge, socialBridgeRuntimeSource } from '../production/social-bridge-runtime.mjs';
import { readSocialRows } from '../../packages/contracts/src/inspection.mjs';

function wrappers() {
  const source = readFileSync(new URL('../../apps/production-extension/hook.main.js', import.meta.url), 'utf8');
  const from = source.indexOf('// packages/sensors/src/wrap.ts'), to = source.indexOf('// packages/sensors/src/intrinsics.ts', from);
  const context = vm.createContext({});
  vm.runInContext(source.slice(from, to) + ';globalThis.api = {wrapMethod, wrapSetter};', context);
  return context.api;
}
function fixture({ nodeName = false } = {}) {
  const nativeURLs = new WeakMap(), connections = new WeakMap(), names = new WeakMap();
  const sourceReads = { image: 0, script: 0, iframe: 0 };
  let executing, calls = 0, attributeCalls = 0, connectedReads = 0;
  class Node { get isConnected() { ++connectedReads; if (!connections.has(this)) throw TypeError('brand'); return connections.get(this); } }
  if (nodeName) Object.defineProperty(Node.prototype, 'nodeName', { configurable: true, get() { if (!names.has(this)) throw TypeError('node brand'); return names.get(this); } });
  class Element extends Node {
    setAttribute(name, value) {
      ++attributeCalls;
      if (!nativeURLs.has(this)) throw TypeError('attribute brand');
      if (String(name).toLowerCase() === 'src') nativeURLs.set(this, new URL(value, 'https://site.example.com/').href);
    }
  }
  const element = () => class extends Element {
    constructor() { super(); nativeURLs.set(this, ''); connections.set(this, false); }
    get src() { if (!nativeURLs.has(this) || !(this instanceof this.constructor)) throw TypeError('brand'); return nativeURLs.get(this); }
    set src(value) { nativeURLs.set(this, new URL(value, 'https://site.example.com/').href); }
  };
  class HTMLScriptElement extends element() {
    get src() { ++sourceReads.script; if (!(this instanceof HTMLScriptElement)) throw TypeError('script brand'); return nativeURLs.get(this); }
    set src(value) { nativeURLs.set(this, new URL(value, 'https://site.example.com/').href); }
  }
  class HTMLImageElement extends element() {
    get src() { ++sourceReads.image; if (!(this instanceof HTMLImageElement)) throw TypeError('image brand'); return nativeURLs.get(this); }
    set src(value) { nativeURLs.set(this, new URL(value, 'https://site.example.com/').href); }
  }
  class HTMLIFrameElement extends element() {
    get src() { ++sourceReads.iframe; if (!(this instanceof HTMLIFrameElement)) throw TypeError('frame brand'); return nativeURLs.get(this); }
    set src(value) { nativeURLs.set(this, new URL(value, 'https://site.example.com/').href); }
  }
  const promise = Object.freeze({ marker: 'native-promise-identity' }), popup = {};
  class CredentialsContainer { get(options) { ++calls; if (!(this instanceof CredentialsContainer)) throw TypeError('credentials brand'); if (options.identity === 'throw') throw RangeError('native exception'); return promise; } }
  class NavigatorLogin { setStatus(_status) { ++calls; return promise; } }
  class Document { get currentScript() { return executing; } }
  const realm = { Node, Element, Request, HTMLScriptElement, HTMLImageElement, HTMLIFrameElement, CredentialsContainer, NavigatorLogin, Document, document: new Document(), open(..._args) { ++calls; return popup; } };
  executing = new HTMLScriptElement(); nativeURLs.set(executing, 'https://assets.site.example.com/main.js?token=SOURCE_SENTINEL');
  const runtime = { hooks: { enabled: true, observerErrors: 0 }, apiResults: { socialCollector: support.createCollector(), generation: 0 }, handles: [], stops: [], attach(handles) { this.handles.push(...handles); }, onStop(fn) { this.stops.push(fn); } };
  support.install(runtime, realm, wrappers(), value => typeof value === 'function');
  return { runtime, realm, promise, popup, calls: () => calls, attributeCalls: () => attributeCalls, executing: value => { executing = value; }, urls: nativeURLs, connected: connections, names, sourceReads, connectedReads: () => connectedReads };
}
test('social serialized runtime and bridge match production source exactly', () => {
  for (const name of ['hook.early.js', 'hook.main.js']) assert.ok(readFileSync(new URL('../../apps/production-extension/' + name, import.meta.url), 'utf8').includes(socialSensorRuntimeSource));
  assert.ok(readFileSync(new URL('../../apps/production-extension/bridge.js', import.meta.url), 'utf8').includes(socialBridgeRuntimeSource));
});
test('social credential and popup hooks preserve native result, receiver and exceptions', () => {
  const f = fixture(), credentials = new f.realm.CredentialsContainer();
  assert.equal(credentials.get({ identity: { providers: [{ configURL: 'https://accounts.google.com/gsi/fedcm.json?token=SECRET' }] } }), f.promise);
  assert.equal(f.calls(), 1);
  assert.throws(() => Reflect.apply(credentials.get, {}, [{ identity: {} }]), /credentials brand/);
  assert.throws(() => credentials.get({ identity: 'throw' }), /native exception/);
  assert.equal(f.calls(), 3);
  assert.equal(f.realm.open('https://github.com/login'), f.popup); assert.equal(f.calls(), 4);
  const rows = f.runtime.apiResults.socialCollector.snapshot().rows;
  assert.ok(readSocialRows(rows)); assert.equal(rows.some(row => row.kind === 'fedcm-call'), false);
  assert.equal(rows.find(row => row.kind === 'authentication-navigation').attributionConfidence, 'exact-resource');
  assert.doesNotMatch(JSON.stringify(rows), /SOURCE_SENTINEL|SECRET|logged-in|access_token/);
});
test('social hook ignores hostile optional getters after the native call', () => {
  const f = fixture(); let getterCalls = 0, coercions = 0;
  const options = { get identity() { ++getterCalls; return {}; } };
  assert.equal(new f.realm.CredentialsContainer().get(options), f.promise); assert.equal(getterCalls, 1);
  const evil = { toString() { ++coercions; throw Error('coercion'); } };
  f.runtime.observeSocialFetch([evil, { get method() { ++getterCalls; return 'GET'; }, get redirect() { ++getterCalls; return 'manual'; } }], false);
  assert.equal(getterCalls, 1); assert.equal(coercions, 0);
});
test('social fetch keeps arbitrary init opaque and reads only native branded Request data', () => {
  const f = fixture(); let traps = 0, getterReads = 0;
  const options = new Proxy({ method: 'POST', redirect: 'manual' }, {
    getOwnPropertyDescriptor() { ++traps; throw Error('descriptor trap'); },
    getPrototypeOf() { ++traps; throw Error('prototype trap'); },
    ownKeys() { ++traps; throw Error('keys trap'); },
    get() { ++traps; throw Error('get trap'); },
  });
  f.runtime.observeSocialFetch(['https://www.facebook.com/tr/', options], false);
  const request = new Request('https://alb.reddit.com/rp.gif?PRIVATE_CANARY', { method: 'POST' });
  Object.defineProperty(request, 'url', { get() { ++getterReads; throw Error('own url'); } });
  Object.defineProperty(request, 'method', { get() { ++getterReads; throw Error('own method'); } });
  f.runtime.observeSocialFetch([request], false);
  assert.equal(traps, 0); assert.equal(getterReads, 0);
  const rows = f.runtime.apiResults.socialCollector.snapshot().rows;
  assert.equal(rows.find(row => row.service === 'facebook').method, 'UNKNOWN');
  assert.equal(rows.find(row => row.service === 'reddit').method, 'POST');
  assert.equal(rows.some(row => row.kind === 'manual-redirect-request'), false);
  assert.doesNotMatch(JSON.stringify(rows), /PRIVATE_CANARY|redirect|options/);
});
test('social beacon observes only the native attempt URL, never the body or queue outcome', () => {
  const f = fixture(); let reads = 0;
  const body = new Proxy({}, { get() { ++reads; throw Error('body'); }, getOwnPropertyDescriptor() { ++reads; throw Error('body'); } });
  f.runtime.observeSocialBeacon(['https://www.facebook.com/tr/?PRIVATE_CANARY', body], false);
  f.runtime.observeSocialBeacon(['https://www.facebook.com/tr/', body], true);
  const rows = f.runtime.apiResults.socialCollector.snapshot().rows;
  assert.equal(reads, 0); assert.equal(rows.length, 1); assert.equal(rows[0].method, 'POST');
  assert.equal(rows[0].requestType, 'ping'); assert.equal(rows[0].count, 1);
  assert.doesNotMatch(JSON.stringify(rows), /PRIVATE_CANARY|body|queued|delivered/);
});
test('social attribute and src observation use native post-call state and deduplicate following insertion', () => {
  const f = fixture({ nodeName: true }), image = new f.realm.HTMLImageElement(); let reads = 0;
  f.names.set(image, 'IMG'); f.urls.set(image, 'https://alb.reddit.com/rp.gif');
  const opaque = { toString() { ++reads; throw Error('conversion must be native only'); } };
  f.runtime.observeSocialAttribute(image, ['SRC', opaque], false);
  f.connected.set(image, true); f.runtime.observeSocialInsertedNode(image, false);
  assert.equal(f.runtime.apiResults.socialCollector.snapshot().rows[0].count, 1);
  // A second setter call is a second page action even if the URL is unchanged.
  f.runtime.observeSocialSource('HTMLImageElement', image, [opaque], false);
  f.runtime.observeSocialInsertedNode(image, false);
  assert.equal(f.runtime.apiResults.socialCollector.snapshot().rows[0].count, 2);
  f.runtime.observeSocialAttribute(image, [opaque, opaque], false);
  assert.equal(reads, 0); assert.equal(f.runtime.apiResults.socialCollector.snapshot().rows[0].count, 2);
});
test('social Login Status API retains native result without reading the supplied account status', () => {
  const f = fixture(), login = new f.realm.NavigatorLogin(); let reads = 0;
  const status = new Proxy({}, { get() { ++reads; throw Error('status'); } });
  assert.equal(login.setStatus(status), f.promise); assert.equal(reads, 0); assert.equal(f.calls(), 1);
  const row = f.runtime.apiResults.socialCollector.snapshot().rows[0];
  assert.equal(row.service, 'unknown'); assert.equal(row.kind, 'login-status-api');
  assert.equal(Object.hasOwn(row, 'status'), false); assert.ok(readSocialRows([row]));
});
test('social installed setAttribute preserves one native conversion, receiver, result and exception', () => {
  const f = fixture({ nodeName: true }), image = new f.realm.HTMLImageElement(); let conversions = 0;
  f.names.set(image, 'IMG');
  const value = { toString() { ++conversions; return 'https://alb.reddit.com/rp.gif?PRIVATE_CANARY'; } };
  assert.equal(image.setAttribute('SRC', value), undefined);
  assert.equal(conversions, 1); assert.equal(f.attributeCalls(), 1);
  const before = f.runtime.apiResults.socialCollector.snapshot().rows;
  assert.equal(before.length, 1); assert.equal(before[0].count, 1);
  f.connected.set(image, true); f.runtime.observeSocialInsertedNode(image, false);
  assert.equal(f.runtime.apiResults.socialCollector.snapshot().rows[0].count, 1);
  assert.throws(() => Reflect.apply(image.setAttribute, {}, ['src', value]), /attribute brand/);
  assert.equal(f.attributeCalls(), 2); assert.equal(conversions, 1);
  assert.doesNotMatch(JSON.stringify(before), /PRIVATE_CANARY/);
});
test('social source hooks keep image observations and connected script loads distinct', () => {
  const f = fixture(), image = new f.realm.HTMLImageElement(), script = new f.realm.HTMLScriptElement();
  f.urls.set(image, 'https://www.facebook.com/login.php');
  f.runtime.observeSocialSource('HTMLImageElement', image, ['https://www.facebook.com/login.php'], false);
  f.urls.set(script, 'https://connect.facebook.net/en_US/sdk.js');
  f.runtime.observeSocialSource('HTMLScriptElement', script, ['https://connect.facebook.net/en_US/sdk.js'], false);
  assert.equal(f.runtime.apiResults.socialCollector.snapshot().rows.length, 1);
  f.connected.set(script, true); f.runtime.observeSocialInsertedNode(script, false); f.runtime.observeSocialInsertedNode(script, false);
  const rows = f.runtime.apiResults.socialCollector.snapshot().rows;
  assert.equal(rows.length, 2); assert.equal(rows.find(row => row.kind === 'sdk-load').count, 1);
  assert.equal(rows.find(row => row.kind === 'possible-login-probe').script.pathTemplate, '/main.js');
});

test('social insertion rejects ordinary nodes using the captured native nodeName without src probes', () => {
  const f = fixture({ nodeName: true }), node = new f.realm.Node(); let ownReads = 0;
  f.names.set(node, 'SPAN'); f.connected.set(node, true);
  for (const key of ['nodeName', 'src', 'isConnected', 'constructor']) Object.defineProperty(node, key, { get() { ++ownReads; throw Error('page getter'); } });
  for (let index = 0; index < 1000; ++index) f.runtime.observeSocialInsertedNode(node, false);
  assert.equal(ownReads, 0); assert.equal(f.connectedReads(), 0);
  assert.deepEqual(f.sourceReads, { image: 0, script: 0, iframe: 0 });
  assert.deepEqual(f.runtime.apiResults.socialCollector.snapshot().rows, []);
});

test('social insertion selects one native resource getter and preserves lower-case names and deduplication', () => {
  const f = fixture({ nodeName: true }), iframe = new f.realm.HTMLIFrameElement();
  f.names.set(iframe, 'iframe'); f.connected.set(iframe, true); f.urls.set(iframe, 'https://www.youtube.com/embed/fixed-fixture');
  Object.defineProperty(iframe, 'src', { get() { throw Error('own src must not execute'); } });
  f.runtime.observeSocialInsertedNode(iframe, false); f.runtime.observeSocialInsertedNode(iframe, false);
  // CurrentScript uses the script getter for attribution; image getter is
  // never probed and each insertion reads exactly the selected iframe getter.
  assert.deepEqual(f.sourceReads, { image: 0, script: 2, iframe: 2 });
  const rows = f.runtime.apiResults.socialCollector.snapshot().rows;
  assert.equal(rows.length, 1); assert.equal(rows[0].kind, 'embedded-content'); assert.equal(rows[0].count, 1);
  f.connected.set(iframe, false); f.runtime.observeSocialInsertedNode(iframe, false);
  assert.equal(f.sourceReads.iframe, 2);
  f.runtime.observeSocialInsertedNode(iframe, true); assert.equal(f.sourceReads.iframe, 2);
});

test('social insertion ignores fake native prototypes and does not invoke an unverified nodeName getter', () => {
  const f = fixture({ nodeName: true }), fake = Object.create(f.realm.HTMLScriptElement.prototype); let ownReads = 0;
  for (const key of ['nodeName', 'src', 'isConnected', 'constructor']) Object.defineProperty(fake, key, { get() { ++ownReads; throw Error('fake getter'); } });
  f.runtime.observeSocialInsertedNode(fake, false);
  assert.equal(ownReads, 0); assert.equal(f.connectedReads(), 0);
  assert.deepEqual(f.sourceReads, { image: 0, script: 0, iframe: 0 });
  assert.deepEqual(f.runtime.apiResults.socialCollector.snapshot().rows, []);
  const fallback = fixture(); let descriptorGetterReads = 0;
  Object.defineProperty(fallback.realm.Node.prototype, 'nodeName', { get() { ++descriptorGetterReads; throw Error('non-native getter'); } });
  // Reinstallation rejects this page-defined getter; the bounded legacy probe
  // still observes genuine fixture resources when no verified native exists.
  const rejected = Object.getOwnPropertyDescriptor(fallback.realm.Node.prototype, 'nodeName').get;
  support.install(fallback.runtime, fallback.realm, wrappers(), value => typeof value === 'function' && value !== rejected);
  const script = new fallback.realm.HTMLScriptElement(); fallback.connected.set(script, true); fallback.urls.set(script, 'https://connect.facebook.net/en_US/sdk.js');
  fallback.runtime.observeSocialInsertedNode(script, false);
  assert.equal(descriptorGetterReads, 0); assert.equal(fallback.runtime.apiResults.socialCollector.snapshot().rows[0].kind, 'sdk-load');
});
test('social fetch/XHR observations never read responses and capture the sending script', () => {
  const f = fixture(), xhr = {};
  f.runtime.observeSocialFetch(['https://www.facebook.com/login.php', { redirect: 'manual', method: 'get' }], false);
  f.runtime.observeSocialXhrOpen(xhr, ['GET', 'https://px.ads.linkedin.com/collect/?token=SECRET'], false);
  const sending = new f.realm.HTMLScriptElement(); f.urls.set(sending, 'https://assets.site.example.com/tracker.js'); f.executing(sending);
  f.runtime.observeSocialXhrSend(xhr, false);
  const rows = f.runtime.apiResults.socialCollector.snapshot().rows;
  assert.equal(rows.find(row => row.service === 'facebook').kind, 'authentication-request');
  assert.equal(rows.find(row => row.service === 'facebook').method, 'UNKNOWN');
  assert.equal(rows.find(row => row.service === 'linkedin').script.pathTemplate, '/tracker.js');
  assert.doesNotMatch(JSON.stringify(rows), /SECRET|response|body|token=/);
});
test('social stack sampling accepts only bounded final locations and retains no raw stack', () => {
  const collector = support.createCollector();
  const result = support.stackSource('Error\n    at loader (https://assets.example.com/private/account/main.js?token=STACK_SENTINEL:12:34)', collector);
  assert.deepEqual(result, { script: { host: 'assets.example.com', pathTemplate: '/main.js' }, attributionConfidence: 'sampled-stack' });
  assert.equal(support.stackSource('Error\n    at https://assets.example.com/fake-name (native)', collector), null);
  assert.doesNotMatch(JSON.stringify(result), /STACK_SENTINEL|private|account|loader|:12:34/);
  for (let i = 0; i < 64; ++i) assert.equal(collector.sample(), true);
  assert.equal(collector.sample(), false); assert.equal(collector.snapshot().truncated, true);
});
test('social stack formatter accessors are not invoked and source attribution degrades', () => {
  const original = Object.getOwnPropertyDescriptor(Error, 'prepareStackTrace'); let calls = 0;
  try {
    Object.defineProperty(Error, 'prepareStackTrace', { configurable: true, get() { ++calls; return () => 'SECRET'; } });
    const f = fixture(); f.executing(null);
    f.runtime.observeSocialFetch(['https://www.facebook.com/tr/'], false);
    const row = f.runtime.apiResults.socialCollector.snapshot().rows[0];
    assert.equal(calls, 0); assert.equal(row.script, null); assert.equal(row.attributionConfidence, 'unknown');
  } finally { if (original) Object.defineProperty(Error, 'prepareStackTrace', original); else delete Error.prepareStackTrace; }
});
test('social observation reset stops data delivery and discards stale XHR attribution', () => {
  const f = fixture(), xhr = {};
  f.runtime.observeSocialXhrOpen(xhr, ['GET', 'https://www.facebook.com/tr/'], false);
  f.runtime.apiResults.generation++; f.runtime.observeSocialXhrSend(xhr, false);
  assert.deepEqual(f.runtime.apiResults.socialCollector.snapshot().rows, []);
  f.runtime.hooks.enabled = false; f.runtime.observeSocialFetch(['https://www.facebook.com/tr/'], false);
  assert.deepEqual(f.runtime.apiResults.socialCollector.snapshot().rows, []);
  const output = [];
  f.runtime.apiResults.socialCollector.handleControl({ channel: 'detect.expert/social/v1', type: 'social-values-read', requestId: 'social-1' }, false, { now: () => 1000, postMessage: data => output.push(data) });
  assert.deepEqual(output[0].rows, []); assert.equal(output[0].enabled, false);
});
function bridgeFixture() {
  const callbacks = {}, timers = new Map(), deadlines = new Map(), posts = [], replies = []; let timer = 0, now = 0;
  const cancel = id => { timers.delete(id); deadlines.delete(id); };
  startSocialValuesBridge({ onPage: callback => { callbacks.page = callback; }, onCommand: callback => { callbacks.command = callback; }, onHide: callback => { callbacks.hide = callback; }, post: value => posts.push(value), later: (callback, delay) => { timers.set(++timer, callback); deadlines.set(timer, now + delay); return timer; }, cancel, now: () => now }, readSocialRows);
  return { callbacks, timers, posts, replies, query: trusted => callbacks.command(trusted, { schemaVersion: 1, type: 'social-values-query' }, reply => replies.push(reply)), tick: ms => {
    now += ms;
    for (const [id, callback] of timers) if (deadlines.get(id) <= now) { cancel(id); callback(); }
  } };
}
const bridgeRow = { service: 'facebook', kind: 'tracking-pixel', endpoint: 'pixel', method: 'GET', requestType: 'image', count: 1, evidenceSource: 'page-hook', integrity: 'page-controlled', attributionConfidence: 'exact-resource', initiatorHost: null, script: { host: 'example.com', pathTemplate: '/main.js' } };
test('social bridge accepts only the own SW command and a canonical same-window reply', () => {
  const f = bridgeFixture(); assert.equal(f.query(false), false); assert.equal(f.posts.length, 0); assert.equal(f.query(true), true);
  const reply = { channel: 'detect.expert/social/v1', type: 'social-values-batch', requestId: f.posts[0].requestId, enabled: true, rows: [bridgeRow], truncated: false };
  f.callbacks.page(false, reply); assert.equal(f.replies.length, 0);
  f.callbacks.page(true, { ...reply, token: 'SECRET' }); assert.equal(f.replies.length, 0);
  f.callbacks.page(true, reply); assert.equal(f.replies[0].available, true); assert.deepEqual(f.replies[0].rows, [bridgeRow]);
});
test('social bridge refuses forged browser integrity, raw paths and command accessors', () => {
  const f = bridgeFixture(); let reads = 0;
  const command = { schemaVersion: 1, get type() { ++reads; return 'social-values-query'; } };
  assert.equal(f.callbacks.command(true, command, () => {}), false); assert.equal(reads, 0);
  f.query(true);
  const data = { channel: 'detect.expert/social/v1', type: 'social-values-batch', requestId: f.posts[0].requestId, enabled: true, rows: [{ ...bridgeRow, integrity: 'browser-observed' }], truncated: false };
  f.callbacks.page(true, data); assert.equal(f.replies.length, 0);
  f.callbacks.page(true, { ...data, rows: [{ ...bridgeRow, script: { host: 'example.com', pathTemplate: '/secret-account-id.js' } }] }); assert.equal(f.replies.length, 0);
  f.callbacks.hide(); assert.equal(f.replies[0].available, false); assert.deepEqual(f.replies[0].rows, []);
});
test('social bridge queues rate-limited reads in one pending slot before its response deadline', () => {
  const f = bridgeFixture(); f.query(true); assert.equal(f.query(true), false); assert.deepEqual(f.replies[0].rows, []);
  f.tick(400);
  assert.equal(f.replies.at(-1).available, false); assert.equal(f.timers.size, 0);
  assert.equal(f.query(true), true); assert.equal(f.posts.length, 1); assert.equal(f.timers.size, 1);
  // The queued trusted request owns the only pending slot; another command
  // cannot post early or replace its callback.
  assert.equal(f.query(true), false); assert.deepEqual(f.replies.at(-1).rows, []);
  const before = f.replies.length;
  f.tick(499); assert.equal(f.posts.length, 1); assert.equal(f.replies.length, before);
  f.tick(1); assert.equal(f.posts.length, 2); assert.equal(f.timers.size, 1);
  f.tick(399); assert.equal(f.replies.length, before);
  f.tick(1); assert.equal(f.replies.length, before + 1);
  assert.equal(f.replies.at(-1).available, false); assert.equal(f.timers.size, 0);
});
