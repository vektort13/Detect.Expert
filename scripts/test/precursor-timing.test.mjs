import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startPrecursorTimingBridge, classifyPrecursorTimingResource, readPrecursorTimingCache, installPrecursorTimingBridge } from '../../apps/production-extension/precursor-timing.js';
import { PrecursorObserver, classifyPrecursorResource } from '../../apps/production-extension/precursor-observer.js';

const path = '/cdn-cgi/challenge-platform/h/g/scripts/precursor/a012b345c678/main.js';
const origin = 'https://example.com', rule = 'cf-precursor-versioned-loader-v1';
const resource = (change = {}) => ({ name: origin + path + '?URL_CANARY', start: 10, initiator: 'script', status: 200, contentType: 'text/javascript', ...change });
test('Chrome never installs the unused timing observer or reads timing prototypes', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'PerformanceEntry'); let reads = 0, starts = 0;
  Object.defineProperty(globalThis, 'PerformanceEntry', { configurable: true, get() { reads++; throw Error('must not read'); } });
  try { installPrecursorTimingBridge(() => { starts++; }, classifyPrecursorTimingResource, () => true, { runtime: { getURL: () => 'chrome-extension://owned/' } }); }
  finally { if (original) Object.defineProperty(globalThis, 'PerformanceEntry', original); else delete globalThis.PerformanceEntry; }
  assert.equal(reads, 0); assert.equal(starts, 0);
});
function collector({ available = true, observeFailure = false, entries = [] } = {}) {
  let now = 100, command, deliver, hide, restore, full, queue = [], disconnects = 0, connects = 0, reads = 0;
  const env = { available, classify: classifyPrecursorTimingResource, origin: () => origin, now: () => now,
    name: value => value.name, start: value => value.start, initiator: value => value.initiator, status: value => value.status, contentType: value => value.contentType,
    entries: () => { reads++; return entries; }, observe: callback => { connects++; if (observeFailure) throw Error('unsupported'); deliver = callback; return { disconnect: () => { disconnects++; }, takeRecords: () => { const result = queue; queue = []; return result; } }; },
    onCommand: callback => { command = callback; }, onHide: callback => { hide = callback; }, onRestore: callback => { restore = callback; }, onBufferFull: callback => { full = callback; } };
  startPrecursorTimingBridge(env);
  const send = (message, trusted = true) => { let reply; command(trusted, message, value => { reply = value; }); return reply; };
  return { env, send, record: values => deliver?.(values), query: (sessionId = 'sessionA') => send({ schemaVersion: 1, type: 'precursor-timing-query', sessionId }),
    reset: resetId => send({ schemaVersion: 1, type: 'precursor-timing-reset', resetId }), tick: delta => { now += delta; }, queue: value => { queue = value; },
    control: command => send({ schemaVersion: 1, type: 'bridge-control', command }), hide: () => hide(), restore: () => restore(), full: () => full(),
    stats: () => ({ disconnects, connects, reads }) };
}

test('timing path rules match the approved network classifier; no URL or build ID is returned', () => {
  for (const url of [origin + path, origin + path + '?QUERY_CANARY', origin + path.replace('/h/g/', '/h/b/'), origin + path.replace('a012b345c678', 'ABCDEFABCDEF'), origin + path + '#fragment', 'http://example.com' + path, 'https://user:password@example.com' + path, origin + path + '/extra']) {
    assert.equal(classifyPrecursorTimingResource(url, origin), classifyPrecursorResource(url));
  }
  assert.equal(classifyPrecursorTimingResource('https://other.com' + path, origin), null);
  assert.equal(classifyPrecursorTimingResource(origin + path, origin + ':444'), null);
});

test('collector admits only successful native same-origin JavaScript script timing', () => {
  for (const change of [{ status: 200 }, { status: 299 }, { status: 304 }, { contentType: 'application/javascript' }]) {
    const f = collector(); f.record([resource(change)]); const reply = f.query();
    assert.deepEqual(reply.ruleIds, [rule]); assert.ok(readPrecursorTimingCache(reply));
    assert.ok(!JSON.stringify(reply).includes('CANARY')); assert.ok(!JSON.stringify(reply).includes('a012b345c678'));
  }
  for (const change of [{ status: 0 }, { status: 404 }, { status: 500 }, { status: 200.5 }, { status: '200' }, { contentType: 'text/html' }, { contentType: '' }, { contentType: 'application/json' },
    { initiator: 'fetch' }, { initiator: 'img' }, { start: NaN }, { start: -1 }, { start: 101 }, { name: 'https://foreign.example' + path }, { name: origin + path.replace('/h/g/', '/h/b/') }]) {
    const f = collector(); f.record([resource(change)]); assert.deepEqual(f.query().ruleIds, [], JSON.stringify(change));
  }
});

test('strict trusted query/reset channel ignores MAIN-like, foreign, getter and additional fields', () => {
  const f = collector(); f.record([resource()]);
  for (const value of [{ schemaVersion: 1, type: 'precursor-timing-query', sessionId: 'sessionA', mode: 'arm' }, { schemaVersion: 2, type: 'precursor-timing-query', sessionId: 'sessionA' },
    { schemaVersion: 1, type: 'precursor-timing-query', sessionId: 'bad:id' }, { channel: 'detect.expert/v1', type: 'precursor-timing-query', sessionId: 'sessionA' }]) assert.equal(f.send(value), undefined);
  assert.equal(f.send({ schemaVersion: 1, type: 'precursor-timing-query', sessionId: 'sessionA' }, false), undefined);
  assert.equal(f.send({ schemaVersion: 1, type: 'precursor-timing-reset', resetId: 'r1' }, false), undefined);
  let getterCalls = 0; const hostile = { schemaVersion: 1, type: 'precursor-timing-query', get sessionId() { getterCalls++; return 'sessionA'; } };
  assert.equal(f.send(hostile), undefined); assert.equal(getterCalls, 0); assert.deepEqual(f.query().ruleIds, [rule]);
});

test('producer clear is idempotent, discards queued old entries and excludes pre-clear start times', () => {
  const f = collector(); f.record([resource()]); f.query(); f.queue([resource()]);
  assert.deepEqual(f.reset('reset-1'), { schemaVersion: 1, type: 'precursor-timing-reset-ack', resetId: 'reset-1' });
  assert.deepEqual(f.query().ruleIds, []); f.tick(5); f.record([resource({ start: 101 })]);
  assert.deepEqual(f.query().ruleIds, [rule]); f.reset('reset-1'); assert.deepEqual(f.query().ruleIds, [rule], 'same ACK retry cannot clear fresh evidence twice');
  f.send({ schemaVersion: 1, type: 'bridge-control', command: 'reset', resetId: 'core-reset' });
  f.record([resource({ start: 101 })]); assert.deepEqual(f.query().ruleIds, []);
});

test('pause/resume and BFCache page lifecycle start fresh windows; core collector owns ACK', () => {
  const f = collector(); f.record([resource()]); assert.equal(f.control('pause'), undefined);
  assert.equal(f.query().available, false); assert.deepEqual(f.query().ruleIds, []);
  f.control('resume'); f.tick(10); f.record([resource({ start: 105 })]); assert.deepEqual(f.query().ruleIds, [rule]);
  f.hide(); assert.equal(f.query().available, false); f.restore(); assert.deepEqual(f.query().ruleIds, []);
  assert.ok(f.stats().disconnects >= 2);
});

test('new background session cannot recover a previous queried producer cache', () => {
  const f = collector(); f.record([resource()]); assert.deepEqual(f.query('old-session').ruleIds, [rule]);
  assert.deepEqual(f.query('new-session').ruleIds, []); f.tick(10); f.record([resource({ start: 105 })]); assert.deepEqual(f.query('new-session').ruleIds, [rule]);
});

test('producer TTL and clock rollback expire evidence; timing revision does not refresh on query', () => {
  for (const delta of [600000, -1]) { const f = collector(); f.record([resource()]); const first = f.query(); assert.equal(f.query().revision, first.revision); f.tick(delta); assert.deepEqual(f.query().ruleIds, []); }
});

test('absent getters and unavailable APIs never downgrade to DOM presence', () => {
  const unavailable = collector({ available: false }); assert.equal(unavailable.query().available, false); assert.equal(unavailable.stats().connects, 0);
  const fallback = collector({ observeFailure: true, entries: [resource()] }); assert.deepEqual(fallback.query().ruleIds, [rule]); fallback.query(); assert.equal(fallback.stats().reads, 1); assert.equal(fallback.query().truncated, true);
});

test('resource bursts and timing buffer pressure preserve bounded processing and explicit gaps', () => {
  const f = collector(); f.record(new Array(2049).fill(resource())); assert.deepEqual(f.query().ruleIds, []); assert.equal(f.query().truncated, true);
  const capped = collector(); capped.record(new Array(2048).fill(resource({ initiator: 'image' }))); capped.record(new Array(2048).fill(resource({ initiator: 'image' }))); capped.record([resource()]);
  assert.deepEqual(capped.query().ruleIds, []); assert.equal(capped.query().truncated, true);
  capped.tick(1000); capped.record([resource()]); assert.deepEqual(capped.query().ruleIds, [rule]);
  const full = collector(); full.full(); assert.equal(full.query().truncated, true);
});

test('cache exact schema rejects identifiers, forged rules, accessors and unavailable positives', () => {
  const f = collector(); f.record([resource()]); const valid = f.query();
  for (const change of [{ url: origin }, { ruleIds: ['candidate'] }, { revision: NaN }, { revision: 2147483648 }, { available: false }, { truncated: 1 }, { mode: 'armed' }]) assert.equal(readPrecursorTimingCache({ ...valid, ...change }), null);
  const sparse = { ...valid, ruleIds: new Array(1) }; assert.equal(readPrecursorTimingCache(sparse), null);
  assert.equal(readPrecursorTimingCache({ ...valid, get ruleIds() { throw Error('getter'); } }), null);
});

const request = { schemaVersion: 1, type: 'ui-get-precursor', tabId: 7, frameId: 0, documentKey: '7:0:private-id' };
function observerFixture() {
  const producer = collector(); let now = 1700000000000, coverage = 'partial', allowed = true;
  const calls = [], binding = { tabId: 7, frameId: 0, documentId: 'private-id', documentKey: request.documentKey, documentLifecycle: 'active', boundAt: now };
  const runtime = { isReady: true, now: () => now, state: { bindings: new Map([['7:0', binding]]) },
    scope: { hasDataConsent: true, accessReady: true, accessGeneration: 1 },
    canObserveNetworkDocument: key => allowed && runtime.scope.hasDataConsent && runtime.state.bindings.get('7:0')?.documentKey === key,
    getProjection: () => ({ documentKey: runtime.state.bindings.get('7:0')?.documentKey, coverageState: coverage }),
    api: { __detectExpertCapabilities: { networkDocumentIdentity: false }, tabs: { sendMessage: async (tabId, message, options) => { calls.push({ tabId, message, options }); return producer.send(message); } } } };
  const observer = new PrecursorObserver(runtime, { policy: { enabled: true, stage: 'production-approved', reviewDueAt: now + 86400000 } });
  return { observer, producer, runtime, calls, tick: delta => { now += delta; producer.tick(delta); }, coverage: value => { coverage = value; }, allow: value => { allowed = value; } };
}
test('Firefox exact-document timing fallback returns partial source with no mode and no raw data', async () => {
  const f = observerFixture(); f.producer.record([resource()]); const state = await f.observer.read(request);
  assert.equal(state.presence, 'observed'); assert.equal(state.evidenceSource, 'browser-resource-timing'); assert.equal(state.integrity, 'browser-observed'); assert.equal(state.coverageState, 'partial'); assert.equal(state.mode, 'unknown');
  assert.equal(state.capabilities.presenceDetection, true); assert.deepEqual(f.calls[0].options, { frameId: 0, documentId: 'private-id' });
  assert.ok(!JSON.stringify(state).includes('CANARY')); const at = state.lastObservedAt; f.tick(1000); assert.equal((await f.observer.read(request)).lastObservedAt, at);
});
test('fresh native commit keeps timing history while user clear and pause require producer reset', async () => {
  const f = observerFixture(); f.producer.record([resource()]); f.observer.forget(request.documentKey, 'navigation'); assert.equal((await f.observer.read(request)).presence, 'observed');
  f.observer.forget(request.documentKey); assert.equal((await f.observer.read(request)).presence, 'not-observed'); assert.ok(f.calls.some(call => call.message.type === 'precursor-timing-reset'));
  f.tick(10); f.producer.record([resource({ start: 105 })]); assert.equal((await f.observer.read(request)).presence, 'observed');
  f.observer.clear(); assert.equal((await f.observer.read(request)).presence, 'not-observed');
});
test('late timing replies after clear, revoke, same-URL replacement or BFCache recommit cannot revive evidence', async () => {
  for (const mutate of [f => f.observer.clear(), f => f.observer.forget(request.documentKey), f => f.observer.clearTab(7), f => { f.runtime.scope.hasDataConsent = false; }, f => { f.runtime.scope.accessGeneration++; },
    f => { f.runtime.state.bindings.set('7:0', { ...f.runtime.state.bindings.get('7:0'), documentKey: '7:0:new', documentId: 'new' }); }, f => { f.runtime.state.bindings.get('7:0').boundAt++; }]) {
    const f = observerFixture(); f.producer.record([resource()]); let resolve;
    f.runtime.api.tabs.sendMessage = () => new Promise(done => { resolve = done; }); const pending = f.observer.read(request); await Promise.resolve(); mutate(f);
    resolve(f.producer.query()); const result = await pending; assert.notEqual(result?.presence, 'observed'); assert.equal(f.observer.documents.size, 0);
  }
});
test('a rejected or malformed timing read yields explicit unavailable evidence; valid empty remains partial', async () => {
  for (const impl of [async () => { throw Error('native'); }, async () => ({ available: true, ruleIds: [rule], url: 'URL_CANARY' })]) {
    const f = observerFixture(); f.runtime.api.tabs.sendMessage = impl; const state = await f.observer.read(request);
    assert.equal(state.presence, 'not-observed'); assert.equal(state.coverageState, 'degraded'); assert.equal(state.capabilities.presenceDetection, false);
  }
  const f = observerFixture(); const state = await f.observer.read(request); assert.equal(state.coverageState, 'partial'); assert.equal(state.capabilities.presenceDetection, true);
});
test('timing transport physical slots and document dedup survive logical timeout and clear', async () => {
  const f = observerFixture(); let settle; f.runtime.api.tabs.sendMessage = () => new Promise(done => { settle = done; });
  const waiting = f.observer.read(request); await Promise.resolve(); assert.equal(f.observer.physical.size, 1); assert.equal(f.observer.pending.size, 1);
  await f.observer.read(request); assert.equal(f.observer.physical.size, 1); await waiting;
  f.observer.clear(); await f.observer.read(request); assert.equal(f.observer.physical.size, 1); assert.equal(f.observer.pending.size, 1);
  settle(null); await Promise.resolve(); await Promise.resolve(); assert.equal(f.observer.physical.size, 0); assert.equal(f.observer.pending.size, 0);
});
