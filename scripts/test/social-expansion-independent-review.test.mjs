// Independent semantic/privacy regressions for ADR-026 social expansion.
// Synthetic fixtures only; no real social endpoint, profile, cookie or body.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { SocialNetworkObserver } from '../../apps/production-extension/social-network-observer.js';
import { ProCookieCapture } from '../../apps/production-extension/pro-cookie-capture.js';
import { socialSensorSupport } from '../production/social-sensor-runtime.mjs';
import { startSocialValuesBridge } from '../production/social-bridge-runtime.mjs';
import { SOCIAL_SERVICE_IDS, SOCIAL_KINDS as detectorKinds, socialNetworkDetector } from '../../apps/production-extension/social-network-detector.js';
import { SOCIAL_SERVICES, SOCIAL_KINDS, readSocialSnapshot, readSocialDocuments, readSocialRows } from '../../packages/contracts/src/inspection.mjs';

const key = '7:0:doc';
const request = { schemaVersion: 1, type: 'ui-get-social-networks', tabId: 7, frameId: 0, documentKey: key };
const row = () => ({ service: 'facebook', kind: 'tracking-pixel', endpoint: 'pixel', method: 'GET', requestType: 'image', count: 1,
  evidenceSource: 'page-hook', integrity: 'page-controlled', attributionConfidence: 'exact-resource', initiatorHost: null,
  script: { host: 'assets.private.example.com', pathTemplate: '/tracker.js' } });
const cache = (rows = [row()]) => ({ schemaVersion: 1, type: 'social-values-cache', available: true, rows, truncated: false });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const drain = async () => { for (let index = 0; index < 4; index++) await new Promise(resolve => setImmediate(resolve)); };
const secrets = /URL_CANARY|INITIATOR_CANARY|BODY_CANARY|HEADER_CANARY|VALUE_CANARY|SOURCE_CANARY|PRIVATE_CANARY/;

// Execute callbacks at their own deadlines, rather than shifting a response
// deadline to the end of a large tick. Only this fixture owns this clock.
function queuedBridgeFixture() {
  const callbacks = {}, tasks = new Map(), posts = [], replies = [];
  let now = 0, sequence = 0;
  const env = { onPage: value => { callbacks.page = value; }, onCommand: value => { callbacks.command = value; },
    onHide: value => { callbacks.hide = value; }, now: () => now,
    post: value => { posts.push({ at: now, ...value }); }, cancel: id => tasks.delete(id),
    later: (callback, delay) => { const id = ++sequence; tasks.set(id, { at: now + delay, callback }); return id; } };
  startSocialValuesBridge(env, readSocialRows);
  const query = label => callbacks.command(true, { schemaVersion: 1, type: 'social-values-query' }, value => replies.push({ label, at: now, value }));
  const reply = (index = posts.length - 1, rows = [{ ...row(), script: { host: 'example.com', pathTemplate: '/main.js' } }]) => {
    callbacks.page(true, { channel: 'detect.expert/social/v1', type: 'social-values-batch', requestId: posts[index].requestId,
      enabled: true, rows, truncated: false });
  };
  const tick = duration => {
    const until = now + duration;
    while (true) {
      const next = [...tasks].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next || next[1].at > until) break;
      now = next[1].at; tasks.delete(next[0]); next[1].callback();
    }
    now = until;
  };
  return { callbacks, tasks, posts, replies, query, reply, tick };
}

test('independent social bridge: immediate next read waits 500 ms then returns the admitted MAIN attribution', () => {
  const f = queuedBridgeFixture(); assert.equal(f.query('live'), true); f.reply();
  assert.equal(f.replies[0].value.available, true); assert.equal(f.query('pro-stop'), true);
  assert.equal(f.posts.length, 1); assert.equal(f.tasks.size, 1);
  f.tick(499); assert.equal(f.posts.length, 1); assert.equal(f.replies.length, 1);
  f.tick(1); assert.equal(f.posts.length, 2); assert.equal(f.posts[1].at, 500);
  assert.notEqual(f.posts[0].requestId, f.posts[1].requestId); f.reply();
  assert.equal(f.replies.length, 2); assert.equal(f.replies[1].label, 'pro-stop');
  assert.equal(f.replies[1].value.available, true); assert.equal(f.replies[1].value.rows[0].script.pathTemplate, '/main.js');
  assert.equal(f.replies[1].value.rows[0].evidenceSource, 'page-hook'); assert.equal(f.tasks.size, 0);
});

test('independent social bridge: queued request owns the only slot and rejected contenders do not shift its deadline', () => {
  const f = queuedBridgeFixture(); f.query('first'); f.reply(); assert.equal(f.query('queued'), true);
  for (let index = 0; index < 8; index++) {
    f.tick(50); assert.equal(f.query('rejected-' + index), false);
    assert.equal(f.replies.at(-1).value.available, false); assert.equal(f.tasks.size, 1);
  }
  f.tick(99); assert.equal(f.posts.length, 1); f.tick(1); assert.equal(f.posts.length, 2);
  assert.equal(f.posts[1].at, 500); f.reply();
  assert.equal(f.replies.at(-1).label, 'queued'); assert.equal(f.replies.at(-1).value.available, true);
  assert.equal(f.replies.filter(reply => reply.label === 'queued').length, 1); assert.equal(f.tasks.size, 0);
});

test('independent social bridge: pagehide before queued post cancels it exactly once and cannot deliver late page data', () => {
  const f = queuedBridgeFixture(); f.query('first'); f.reply(); f.query('queued'); f.tick(100);
  f.callbacks.hide(); f.callbacks.hide();
  assert.equal(f.replies.filter(reply => reply.label === 'queued').length, 1);
  assert.equal(f.replies.at(-1).value.available, false); assert.deepEqual(f.replies.at(-1).value.rows, []);
  assert.equal(f.tasks.size, 0); f.reply(0); f.tick(1000);
  assert.equal(f.posts.length, 1); assert.equal(f.replies.length, 2); assert.equal(f.tasks.size, 0);
});

test('independent social bridge: lost queued reply has its full 400 ms timeout after the 500 ms post wait', () => {
  const f = queuedBridgeFixture(); f.query('first'); f.reply(); f.query('lost');
  f.tick(499); assert.equal(f.replies.length, 1); assert.equal(f.posts.length, 1);
  f.tick(1); assert.equal(f.posts.length, 2); assert.equal(f.posts[1].at, 500);
  f.tick(399); assert.equal(f.replies.length, 1); assert.equal(f.tasks.size, 1);
  f.tick(1); assert.equal(f.replies.length, 2); assert.equal(f.replies[1].at, 900);
  assert.equal(f.replies[1].label, 'lost'); assert.equal(f.replies[1].value.available, false);
  assert.deepEqual(f.replies[1].value.rows, []); assert.equal(f.tasks.size, 0);
  f.reply(); assert.equal(f.replies.length, 2);
});

test('independent social bridge: cooldown starts after a slow reply and includes no response-latency discount', () => {
  const f = queuedBridgeFixture(); f.query('slow'); f.tick(300); f.reply();
  assert.equal(f.replies[0].at, 300); f.query('next');
  f.tick(200); assert.equal(f.posts.length, 1);
  f.tick(299); assert.equal(f.posts.length, 1); f.tick(1);
  assert.equal(f.posts.length, 2); assert.equal(f.posts[1].at, 800);
  f.tick(399); assert.equal(f.replies.length, 1); f.reply();
  assert.equal(f.replies[1].at, 1199); assert.equal(f.replies[1].value.available, true); assert.equal(f.tasks.size, 0);
});

test('independent social bridge: unsolicited replies during queued wait consume no posted-message budget', () => {
  const f = queuedBridgeFixture(); f.query('first'); f.reply(); f.query('queued');
  for (let index = 0; index < 32; index++) f.callbacks.page(true, { channel: 'detect.expert/social/v1', type: 'social-values-batch',
    requestId: 'social-2', enabled: true, rows: [row()], truncated: false });
  assert.equal(f.replies.length, 1); assert.equal(f.posts.length, 1);
  f.tick(500); f.reply(); assert.equal(f.replies.length, 2); assert.equal(f.replies[1].value.available, true);
  assert.equal(f.tasks.size, 0); assert.doesNotMatch(JSON.stringify(f.replies), secrets);
});

function observerFixture() {
  let documentAllowed = true, projection = { documentKey: key, coverageState: 'active' };
  const runtime = { isReady: true, scope: { hasDataConsent: true, accessReady: true, accessGeneration: 1,
    hasAnyHostAccess: () => true, isHostGrantedSync: () => true }, now: () => 1700000000000,
    canObserveNetworkDocument: () => documentAllowed, getProjection: () => projection,
    apiResults: { authorize: async () => true }, api: { tabs: { sendMessage: async () => cache() } }, pro: { session: null, mark() {} } };
  const helpers = { host: raw => { try { return new URL(raw).hostname; } catch { return null; } },
    redact: host => ({ kind: 'registrable', value: host.split('.').slice(-2).join('.') }) };
  const observer = new SocialNetworkObserver(runtime, helpers);
  let privateReads = 0;
  const details = { tabId: 7, frameId: 0, documentId: 'doc', documentLifecycle: 'active', type: 'image', method: 'GET',
    url: 'https://www.facebook.com/tr/?access_token=URL_CANARY#URL_CANARY', initiator: 'https://assets.private.example.com/account/INITIATOR_CANARY' };
  for (const field of ['requestHeaders', 'responseHeaders', 'requestBody']) Object.defineProperty(details, field, {
    get() { ++privateReads; throw Error('HEADER_CANARY BODY_CANARY'); } });
  observer.observe(details);
  return { observer, runtime, privateReads: () => privateReads,
    deny: () => { documentAllowed = false; }, navigate: () => { projection = { documentKey: '7:0:replacement', coverageState: 'active' }; },
    coverage: value => { projection.coverageState = value; } };
}

function assertBrowserOnly(result) {
  assert.ok(readSocialSnapshot(result));
  assert.equal(result.coverageState, 'partial'); assert.equal(result.truncated, true);
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0].evidenceSource, 'browser-network');
  assert.equal(result.rows[0].integrity, 'browser-observed'); assert.equal(result.rows[0].count, 1);
  assert.equal(result.rows[0].script, null); assert.equal(result.rows[0].attributionConfidence, 'frame-only');
  assert.equal(result.rows[0].initiatorHost, 'example.com'); assert.doesNotMatch(JSON.stringify(result), secrets);
}

for (const [name, reply] of [
  ['missing bridge', () => { throw Error('missing listener'); }], ['null reply', () => null],
  ['unavailable bridge', () => ({ ...cache([]), available: false })],
  ['malformed wrapper', () => ({ ...cache(), token: 'VALUE_CANARY' })],
  ['invalid page row', () => cache([{ ...row(), body: 'BODY_CANARY' }])],
  ['malformed page rows', () => cache(null)],
]) test('independent social: authorized browser evidence survives ' + name + ' and stale page rows are erased', async () => {
  const f = observerFixture(); assert.equal(f.observer.recordPage(key, [row()]), true);
  assert.equal(f.observer.snapshot(key).rows.length, 2);
  f.runtime.api.tabs.sendMessage = async () => reply();
  assertBrowserOnly(await f.observer.read(request)); assertBrowserOnly(f.observer.snapshot(key)); assert.equal(f.privateReads(), 0);
});

test('independent social: wrapper accessor is never evaluated and cannot hide browser evidence', async () => {
  const f = observerFixture(); let getterReads = 0;
  const response = cache(); Object.defineProperty(response, 'available', { get() { ++getterReads; throw Error('VALUE_CANARY'); } });
  f.runtime.api.tabs.sendMessage = async () => response;
  assertBrowserOnly(await f.observer.read(request)); assert.equal(getterReads, 0); assert.equal(f.privateReads(), 0);
});

for (const mode of ['false', 'reject']) test('independent social: ' + mode + ' initial authorization yields empty no-access, never browser fallback', async () => {
  const f = observerFixture(); let sends = 0;
  f.runtime.apiResults.authorize = async () => { if (mode === 'reject') throw Error('denied'); return false; };
  f.runtime.api.tabs.sendMessage = async () => { ++sends; return cache(); };
  const result = await f.observer.read(request);
  assert.equal(result.coverageState, 'no-access'); assert.deepEqual(result.rows, []); assert.equal(sends, 0);
});

for (const mode of ['false', 'reject']) test('independent social: ' + mode + ' second authorization after bridge failure denies cached data', async () => {
  const f = observerFixture(); let authorizations = 0;
  f.runtime.apiResults.authorize = async () => { if (++authorizations === 1) return true; if (mode === 'reject') throw Error('denied'); return false; };
  f.runtime.api.tabs.sendMessage = async () => { throw Error('missing bridge'); };
  const result = await f.observer.read(request);
  assert.equal(authorizations, 2); assert.equal(result.coverageState, 'no-access'); assert.deepEqual(result.rows, []);
});

const mutations = {
  revoke: f => { f.runtime.scope.hasDataConsent = false; },
  generation: f => { ++f.runtime.scope.accessGeneration; }, navigation: f => f.navigate(),
  pause: f => f.coverage('paused'), unsupported: f => f.coverage('unsupported'),
  'no-access': f => f.coverage('no-access'), document: f => f.deny(),
  clear: f => f.observer.clear(), forget: f => f.observer.forget(key),
};
for (const [name, mutate] of Object.entries(mutations)) test('independent social: ' + name + ' while bridge is pending cancels cached and page results', async () => {
  const f = observerFixture(), gate = deferred();
  f.runtime.api.tabs.sendMessage = () => gate.promise;
  const work = f.observer.read(request); await drain(); mutate(f); gate.resolve(cache());
  const result = await work;
  assert.equal(result.coverageState, 'no-access'); assert.deepEqual(result.rows, []); assert.ok(readSocialSnapshot(result));
});

for (const [name, mutate] of Object.entries(mutations)) test('independent social: ' + name + ' during first authorization prevents bridge invocation', async () => {
  const f = observerFixture(), gate = deferred(); let sends = 0;
  f.runtime.apiResults.authorize = () => gate.promise;
  f.runtime.api.tabs.sendMessage = async () => { ++sends; return cache(); };
  const work = f.observer.read(request); await drain(); mutate(f); gate.resolve(true);
  const result = await work;
  assert.equal(result.coverageState, 'no-access'); assert.deepEqual(result.rows, []); assert.equal(sends, 0);
});

test('independent social: physical bridge timeout retains one slot but valid current browser evidence survives', async () => {
  const f = observerFixture(), gate = deferred(); f.runtime.api.tabs.sendMessage = () => gate.promise;
  const result = await f.observer.read(request);
  assertBrowserOnly(result); assert.equal(f.observer.physical.size, 1); assert.equal(f.observer.operations.size, 0);
  gate.resolve(cache()); await drain(); assert.equal(f.observer.physical.size, 0);
  assertBrowserOnly(f.observer.snapshot(key));
});

class Timers {
  next = 0; jobs = new Map();
  setTimeout(callback, delay) { const id = ++this.next; this.jobs.set(id, { callback, delay }); return id; }
  clearTimeout(id) { this.jobs.delete(id); }
}
function captureFixture(childCount) {
  const page = { id: 'visit', tabId: 7, documentKey: key, endedAt: null }, projections = new Map([['7:0', { documentKey: key, coverageState: 'active' }]]);
  const reports = new Map(), calls = [], flushes = [], sizes = [];
  for (let frame = 1; frame <= childCount; frame++) {
    const child = `7:${frame}:child${frame}`; reports.set(child, { tabId: 7, frameId: frame, documentKey: child });
    projections.set(`7:${frame}`, { documentKey: child, coverageState: 'active' });
  }
  const runtime = { now: () => 1700000000000, scope: { accessGeneration: 1, hasDataConsent: true },
    cookies: { epoch: 1, read: async () => {} }, state: { reports },
    getProjection: (tab, frame) => projections.get(`${tab}:${frame}`), canObserveNetworkDocument: () => true,
    social: { read: async request => { calls.push(request); return { schemaVersion: 1, type: 'social-networks-state', documentKey: request.documentKey,
      coverageState: 'partial', rows: [], truncated: false }; } } };
  const pro = { runtime, session: { id: 'recording', pages: [page] }, currentPages: new Map([[7, 'visit']]),
    pageFor: tab => tab === 7 ? page : null, pageById: id => id === 'visit' ? page : null,
    belongsToPage: child => child.startsWith('7:'), checkDeadline: () => true,
    size: (id, bytes) => { sizes.push([id, bytes]); return true; }, mark() {}, flush: async () => { flushes.push(JSON.stringify(page.socialNetworks)); } };
  const capture = new ProCookieCapture(pro, new Timers()); capture.running = true;
  return { capture, runtime, pro, page, projections, calls, flushes, sizes };
}

for (const children of [23, 24, 30]) test('independent Pro social: ' + children + ' children gives a truthful 24-document cap without row overflow', async () => {
  const f = captureFixture(children);
  try {
    await f.capture.capture(); const documents = f.page.socialNetworks;
    assert.ok(readSocialDocuments(documents)); assert.equal(documents.length, 24); assert.equal(f.calls.length, 24);
    assert.equal(documents.some(document => document.truncated), children > 23);
    assert.equal(documents.reduce((sum, document) => sum + document.rows.length, 0), 0);
  } finally { f.capture.stop(); }
});

test('independent Pro social: stale and foreign children do not consume admitted-document budget', async () => {
  const f = captureFixture(30);
  for (let frame = 1; frame <= 10; frame++) f.projections.set(`7:${frame}`, { documentKey: `7:${frame}:replacement`, coverageState: 'active' });
  f.runtime.state.reports.set('8:1:foreign', { tabId: 8, frameId: 1, documentKey: '8:1:foreign' });
  try {
    await f.capture.capture(); const documents = f.page.socialNetworks;
    assert.ok(readSocialDocuments(documents)); assert.equal(documents.length, 21); assert.equal(documents.some(document => document.truncated), false);
    assert.ok(f.calls.every(call => call.tabId === 7 && (call.frameId === 0 || call.frameId > 10)));
  } finally { f.capture.stop(); }
});

test('independent Pro social: cookie inspection rejection does not suppress separately authorized social capture', async () => {
  const f = captureFixture(0);
  f.runtime.cookies.read = async () => { throw Error('cookie storage failure'); };
  try {
    await f.capture.capture();
    assert.equal(f.calls.length, 1); assert.ok(readSocialDocuments(f.page.socialNetworks));
    assert.equal(f.page.socialNetworks.length, 1); assert.equal(f.page.socialNetworks[0].documentKey, key);
  } finally { f.capture.stop(); }
});

for (const [name, mutate] of [
  ['generation', f => { ++f.runtime.scope.accessGeneration; }],
  ['consent', f => { f.runtime.scope.hasDataConsent = false; }],
  ['navigation', f => { f.projections.set('7:0', { documentKey: '7:0:replacement', coverageState: 'active' }); }],
  ['cookie epoch', f => { ++f.runtime.cookies.epoch; }],
  ['capture stop', f => f.capture.stop()],
]) test('independent Pro social: cookie rejection plus ' + name + ' change cancels social fallback', async () => {
  const f = captureFixture(0);
  f.runtime.cookies.read = async () => { mutate(f); throw Error('cookie storage failure'); };
  try {
    await f.capture.capture(); assert.equal(f.calls.length, 0); assert.equal(f.page.socialNetworks, undefined);
    assert.equal(f.flushes.length, 0); assert.equal(f.capture.pending.size, 0);
  } finally { f.capture.stop(); }
});

test('independent Pro social: row budget remains 256 and late child result cannot retain a replaced document', async () => {
  const f = captureFixture(5);
  f.runtime.social.read = async request => {
    f.calls.push(request);
    if (request.frameId === 2) f.projections.set('7:2', { documentKey: '7:2:replacement', coverageState: 'active' });
    return { schemaVersion: 1, type: 'social-networks-state', documentKey: request.documentKey,
      coverageState: 'partial', rows: Array.from({ length: 64 }, row), truncated: false };
  };
  try {
    await f.capture.capture(); const documents = f.page.socialNetworks;
    assert.ok(readSocialDocuments(documents)); assert.equal(documents.some(document => document.documentKey === '7:2:child2'), false);
    assert.equal(documents.reduce((sum, document) => sum + document.rows.length, 0), 256);
    assert.ok(documents.some(document => document.truncated)); assert.doesNotMatch(JSON.stringify(documents), secrets);
  } finally { f.capture.stop(); }
});

function wrappers() {
  const source = readFileSync(new URL('../../apps/production-extension/hook.main.js', import.meta.url), 'utf8');
  const from = source.indexOf('// packages/sensors/src/wrap.ts'), to = source.indexOf('// packages/sensors/src/intrinsics.ts', from);
  assert.ok(from >= 0 && to > from); const context = vm.createContext({});
  vm.runInContext(source.slice(from, to) + ';globalThis.reviewWrappers={wrapMethod,wrapSetter};', context);
  return context.reviewWrappers;
}
function productionBrowserInstaller(bundle) {
  const source = readFileSync(new URL('../../apps/production-extension/' + bundle, import.meta.url), 'utf8');
  const wrapFrom = source.indexOf('// packages/sensors/src/wrap.ts'), wrapTo = source.indexOf('// packages/sensors/src/intrinsics.ts', wrapFrom);
  const from = source.indexOf('// packages/sensors/src/browser-requests.ts'), to = source.indexOf('// packages/sensors/src/timing.ts', from);
  assert.ok(wrapFrom >= 0 && wrapTo > wrapFrom && from >= 0 && to > from);
  const context = vm.createContext({ EXTENSION_RESOURCE_METHODS: ['fetch', 'image-src', 'script-src'],
    EXTENSION_METHOD_INDEX: { 'image-src': 1, 'script-src': 2 }, TECHNIQUE_INDEX: { 'DET-059': 59 },
    API_OPERATION_INDEX: { 'Navigator.sendBeacon': 1, 'CredentialsContainer.get': 2 }, PHASE_INDEX: { 'returned-sync': 1, 'threw-sync': 2, 'settlement-unobserved': 3 },
    SIGNAL_BIT: { 'api-use': 1 }, visualCaptureFor: () => null, arrayPush: (array, value) => array.push(value),
    extensionResourceId: () => null, extensionTargetIndex: () => null });
  vm.runInContext(source.slice(wrapFrom, wrapTo) + source.slice(from, to) + ';globalThis.reviewInstaller=installBrowserRequestSensor;', context);
  return context.reviewInstaller;
}
function sensorFixture() {
  const urls = new WeakMap(), connected = new WeakMap(), names = new WeakMap(); let executing, calls = 0;
  class Node { get nodeName() { if (!names.has(this)) throw TypeError('brand'); return names.get(this); }
    get isConnected() { if (!connected.has(this)) throw TypeError('brand'); return connected.get(this); } }
  const resource = name => class extends Node { constructor() { super(); urls.set(this, ''); connected.set(this, false); names.set(this, name); }
    get src() { if (!urls.has(this) || names.get(this) !== name) throw TypeError('brand'); return urls.get(this); }
    set src(value) { urls.set(this, new URL(value, 'https://site.example.com/').href); } };
  const HTMLImageElement = resource('IMG'), HTMLScriptElement = resource('SCRIPT'), HTMLIFrameElement = resource('IFRAME');
  class Document { get currentScript() { return executing; } }
  const promise = Object.freeze({ marker: 'native-promise' });
  class CredentialsContainer { get(_options) { ++calls; if (!(this instanceof CredentialsContainer)) throw TypeError('native brand'); return promise; } }
  class NavigatorLogin { setStatus(_status) { return promise; } }
  const realm = { Node, HTMLImageElement, HTMLScriptElement, HTMLIFrameElement, Document, CredentialsContainer, NavigatorLogin,
    document: new Document(), open() { return null; } };
  executing = new HTMLScriptElement(); urls.set(executing, 'https://assets.private.example.com/main.js?token=SOURCE_CANARY');
  const runtime = { hooks: { enabled: true, observerErrors: 0 }, apiResults: { generation: 0, socialCollector: socialSensorSupport.createCollector() },
    attach() {}, onStop() {}, record() {}, recordOperation() {}, recordResult() {} };
  socialSensorSupport.install(runtime, realm, wrappers(), value => typeof value === 'function');
  return { realm, runtime, urls, connected, names, promise, calls: () => calls,
    rows: () => runtime.apiResults.socialCollector.snapshot().rows };
}
function hostileProxy(onTrap) {
  return new Proxy({}, { get() { onTrap(); throw Error('VALUE_CANARY'); },
    getOwnPropertyDescriptor() { onTrap(); throw Error('VALUE_CANARY'); }, ownKeys() { onTrap(); throw Error('VALUE_CANARY'); },
    getPrototypeOf() { onTrap(); throw Error('VALUE_CANARY'); } });
}

test('independent sensor: arbitrary fetch init Proxy is fully opaque, original social URL still classified', () => {
  const f = sensorFixture(); let traps = 0;
  f.runtime.observeSocialFetch(['https://www.facebook.com/tr/?token=URL_CANARY', hostileProxy(() => ++traps)], false);
  assert.equal(traps, 0); assert.equal(f.rows().length, 1); assert.equal(f.rows()[0].method, 'UNKNOWN');
  assert.equal(f.rows()[0].kind, 'tracking-pixel'); assert.doesNotMatch(JSON.stringify(f.rows()), secrets);
});

test('independent sensor: plain init getters are opaque and manual-redirect is not inferred by re-reading options', () => {
  const f = sensorFixture(); let getterReads = 0;
  const options = { get method() { ++getterReads; return 'POST'; }, get redirect() { ++getterReads; return 'manual'; } };
  f.runtime.observeSocialFetch(['https://www.facebook.com/login.php', options], false);
  assert.equal(getterReads, 0); assert.equal(f.rows()[0].kind, 'authentication-request'); assert.equal(f.rows()[0].method, 'UNKNOWN');
  f.runtime.observeSocialFetch(['https://www.facebook.com/login.php', { method: 'POST', redirect: 'manual' }], false);
  assert.ok(f.rows().every(row => row.kind !== 'manual-redirect-request' && row.method === 'UNKNOWN'));
});

test('independent sensor: opaque URL-like object is not coerced and a sync throw records no social request', () => {
  const f = sensorFixture(); let coercions = 0;
  f.runtime.observeSocialFetch([{ toString() { ++coercions; throw Error('URL_CANARY'); } }], false);
  f.runtime.observeSocialFetch(['https://www.facebook.com/tr/'], true);
  assert.equal(coercions, 0); assert.deepEqual(f.rows(), []);
});

test('independent sensor: normal credential requests and hostile options never invent FedCM/provider evidence', () => {
  const f = sensorFixture(); let traps = 0, getters = 0;
  const credential = new f.realm.CredentialsContainer();
  for (const options of [{ publicKey: {} }, { password: true }, { identity: { providers: [{ configURL: 'https://accounts.google.com/gsi/fedcm.json?token=VALUE_CANARY' }] } },
    hostileProxy(() => ++traps), { get identity() { ++getters; throw Error('VALUE_CANARY'); } }, { identity: hostileProxy(() => ++traps) }])
    assert.equal(credential.get(options), f.promise);
  assert.equal(f.calls(), 6); assert.equal(traps, 0); assert.equal(getters, 0); assert.deepEqual(f.rows(), []);
  assert.throws(() => Reflect.apply(credential.get, {}, [{}]), /native brand/); assert.equal(f.calls(), 7);
});

test('independent sensor: beacon sees only URL, preserves POST/ping attempt semantics, and ignores body', () => {
  const f = sensorFixture(); assert.equal(typeof f.runtime.observeSocialBeacon, 'function'); let bodyReads = 0;
  const body = hostileProxy(() => ++bodyReads);
  f.runtime.observeSocialBeacon(['https://www.facebook.com/tr/?token=URL_CANARY', body], false);
  assert.equal(bodyReads, 0); assert.equal(f.rows().length, 1); assert.equal(f.rows()[0].method, 'POST');
  assert.equal(f.rows()[0].requestType, 'ping'); assert.equal(f.rows()[0].kind, 'tracking-pixel'); assert.doesNotMatch(JSON.stringify(f.rows()), secrets);
  f.runtime.observeSocialBeacon(['https://www.facebook.com/tr/', body], true); assert.equal(f.rows()[0].count, 1);
});

test('independent sensor: attribute observer uses captured native src, ignores own getters and detached scripts', () => {
  const f = sensorFixture(); assert.equal(typeof f.runtime.observeSocialAttribute, 'function'); let ownReads = 0;
  const image = new f.realm.HTMLImageElement(); f.urls.set(image, 'https://www.facebook.com/tr/?token=URL_CANARY');
  for (const field of ['src', 'nodeName', 'isConnected']) Object.defineProperty(image, field, { get() { ++ownReads; throw Error('VALUE_CANARY'); } });
  f.runtime.observeSocialAttribute(image, ['SrC', hostileProxy(() => ++ownReads)], false);
  assert.equal(ownReads, 0); assert.equal(f.rows().length, 1); assert.equal(f.rows()[0].kind, 'tracking-pixel');
  const script = new f.realm.HTMLScriptElement(); f.urls.set(script, 'https://connect.facebook.net/en_US/fbevents.js');
  f.runtime.observeSocialAttribute(script, ['src', 'ignored'], false); assert.equal(f.rows().length, 1);
  f.connected.set(script, true); f.runtime.observeSocialAttribute(script, ['src', 'ignored'], false); assert.equal(f.rows().length, 2);
  assert.doesNotMatch(JSON.stringify(f.rows()), secrets);
});

test('independent sensor: unrelated/coerced attribute names, fake native receivers and thrown native writes are ignored', () => {
  const f = sensorFixture(); assert.equal(typeof f.runtime.observeSocialAttribute, 'function'); let reads = 0;
  const image = new f.realm.HTMLImageElement(); f.urls.set(image, 'https://www.facebook.com/tr/');
  f.runtime.observeSocialAttribute(image, ['alt', 'src'], false);
  f.runtime.observeSocialAttribute(image, [hostileProxy(() => ++reads), 'src'], false);
  f.runtime.observeSocialAttribute(image, ['src', 'anything'], true);
  const fake = Object.create(f.realm.HTMLImageElement.prototype);
  for (const field of ['src', 'nodeName', 'isConnected']) Object.defineProperty(fake, field, { get() { ++reads; throw Error('VALUE_CANARY'); } });
  f.runtime.observeSocialAttribute(fake, ['src', 'anything'], false);
  assert.equal(reads, 0); assert.deepEqual(f.rows(), []);
});

for (const bundle of ['hook.early.js', 'hook.main.js']) for (const result of [true, false])
  test('independent production wiring: ' + bundle + ' beacon ' + result + ' result is preserved and still records one page attempt', () => {
    const f = sensorFixture(); let nativeCalls = 0, bodyReads = 0, nativeReceiver, nativeArguments;
    class Navigator { sendBeacon(...args) { ++nativeCalls; nativeReceiver = this; nativeArguments = args; return result; } }
    f.realm.Navigator = Navigator;
    productionBrowserInstaller(bundle)(f.runtime, f.realm);
    const navigator = new Navigator(), body = hostileProxy(() => ++bodyReads), url = 'https://www.facebook.com/tr/?token=URL_CANARY';
    assert.equal(navigator.sendBeacon(url, body), result); assert.equal(nativeCalls, 1); assert.equal(nativeReceiver, navigator);
    assert.equal(nativeArguments[0], url); assert.equal(nativeArguments[1], body); assert.equal(bodyReads, 0);
    assert.equal(f.rows().length, 1); assert.equal(f.rows()[0].count, 1); assert.equal(f.rows()[0].method, 'POST');
    assert.equal(f.rows()[0].requestType, 'ping'); assert.doesNotMatch(JSON.stringify(f.rows()), secrets);
  });

for (const bundle of ['hook.early.js', 'hook.main.js']) test('independent production wiring: ' + bundle + ' beacon original exception is unchanged and does not record success', () => {
  const f = sensorFixture(); let nativeCalls = 0; const original = new RangeError('native beacon exception');
  class Navigator { sendBeacon() { ++nativeCalls; throw original; } }
  f.realm.Navigator = Navigator; productionBrowserInstaller(bundle)(f.runtime, f.realm);
  assert.throws(() => new Navigator().sendBeacon('https://www.facebook.com/tr/'), error => error === original);
  assert.equal(nativeCalls, 1); assert.deepEqual(f.rows(), []);
});

for (const bundle of ['hook.early.js', 'hook.main.js']) test('independent production wiring: ' + bundle + ' generic credentials retain actual Promise identity and opaque options', () => {
  const f = sensorFixture(); let nativeCalls = 0, nativeReceiver, nativeOptions, optionReads = 0, thenReads = 0;
  const promise = Promise.resolve('PRIVATE_CANARY'); Object.defineProperty(promise, 'then', { get() { ++thenReads; throw Error('observer touched Promise'); } });
  class CredentialsContainer { get(options) { ++nativeCalls; nativeReceiver = this; nativeOptions = options;
    if (!(this instanceof CredentialsContainer)) throw TypeError('native credential brand'); return promise; } }
  f.realm.CredentialsContainer = CredentialsContainer;
  const operations = []; f.runtime.recordOperation = (operation, phase) => operations.push({ operation, phase });
  productionBrowserInstaller(bundle)(f.runtime, f.realm);
  const credentials = new CredentialsContainer(), options = hostileProxy(() => ++optionReads);
  assert.equal(credentials.get(options), promise); assert.equal(nativeCalls, 1); assert.equal(nativeReceiver, credentials); assert.equal(nativeOptions, options);
  assert.equal(optionReads, 0); assert.equal(thenReads, 0); assert.deepEqual(f.rows(), []);
  assert.ok(operations.some(item => item.operation === 2 && item.phase === 3));
  assert.throws(() => Reflect.apply(credentials.get, {}, [options]), /native credential brand/);
  assert.equal(nativeCalls, 2); assert.equal(optionReads, 0); assert.equal(thenReads, 0);
});

test('independent social catalog: canonical services and tracking SDK distinction stay synchronized', () => {
  assert.deepEqual(SOCIAL_SERVICE_IDS, SOCIAL_SERVICES); assert.deepEqual(detectorKinds, SOCIAL_KINDS);
  const tracking = socialNetworkDetector.classify('https://connect.facebook.net/en_US/fbevents.js?token=URL_CANARY', 'script');
  const ordinary = socialNetworkDetector.classify('https://connect.facebook.net/en_US/sdk.js', 'script');
  assert.equal(tracking.kind, 'tracking-sdk'); assert.equal(ordinary.kind, 'sdk-load');
  assert.ok(SOCIAL_KINDS.includes('tracking-sdk')); assert.doesNotMatch(JSON.stringify(tracking), secrets);
});
