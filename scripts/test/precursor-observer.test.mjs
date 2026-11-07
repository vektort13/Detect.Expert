import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrecursorObserver, PRECURSOR_LIMITS, PRECURSOR_POLICY, classifyPrecursorCandidate, classifyPrecursorResource, precursorJavaScriptResponse } from '../../apps/production-extension/precursor-observer.js';

const path = '/cdn-cgi/challenge-platform/h/g/scripts/precursor/a012b345c678/main.js';
const canonical = '/cdn-cgi/challenge-platform/scripts/precursor/main.js';
const key = '7:0:root';
const request = { schemaVersion: 1, type: 'ui-get-precursor', tabId: 7, frameId: 0, documentKey: key };
const network = (overrides = {}) => ({ tabId: 7, frameId: 0, documentId: 'root', documentLifecycle: 'active', type: 'script', statusCode: 200,
  url: 'https://www.example.com' + path + '?QUERY_CANARY', initiator: 'https://www.example.com', responseHeaders: [{ name: 'Content-Type', value: 'application/javascript; charset=utf-8' }], ...overrides });
function fixture(options = {}) {
  let now = 1700000000000, allowed = true, coverage = 'active', calls = 0;
  const bindings = new Map();
  const runtime = { isReady: true, now: () => now,
    scope: { hasDataConsent: true, accessReady: true, accessGeneration: 1, isHostGrantedSync: () => true },
    state: { bindings }, api: { webNavigation: { getFrame: async details => { ++calls; return { documentId: details.documentId, documentLifecycle: 'active', errorOccurred: false, url: 'https://www.example.com/account/USER_CANARY?TOKEN_CANARY#FRAGMENT_CANARY' }; } } },
    canObserveNetworkDocument: doc => allowed && runtime.scope.hasDataConsent && bindings.get(doc.slice(0, doc.lastIndexOf(':')))?.documentKey === doc,
    getProjection: (tabId, frameId) => { const binding = bindings.get(tabId + ':' + frameId); return binding ? { documentKey: binding.documentKey, coverageState: coverage } : null; } };
  const add = (tabId = 7, frameId = 0, documentId = 'root') => { const documentKey = `${tabId}:${frameId}:${documentId}`; bindings.set(`${tabId}:${frameId}`, { tabId, frameId, documentId, documentKey, documentLifecycle: 'active', host: 'example.com', scheme: 'https', boundAt: now }); return documentKey; };
  add();
  const policy = { enabled: true, stage: 'production-approved', reviewDueAt: now + 86400000 };
  const observer = new PrecursorObserver(runtime, { policy, ...options });
  return { runtime, observer, add, policy, tick: delta => { now += delta; }, allow: value => { allowed = value; }, coverage: value => { coverage = value; }, calls: () => calls };
}
const absent = f => { const snapshot = f.observer.read(request); assert.equal(snapshot.presence, 'not-observed'); assert.equal(snapshot.mode, 'unknown'); assert.equal(snapshot.lastObservedAt, null); return snapshot; };

test('candidate classifier is broader than the independently restricted production resource shape', () => {
  assert.ok(classifyPrecursorCandidate('https://www.example.com' + canonical));
  assert.ok(classifyPrecursorCandidate('https://www.example.com' + path.replace('/h/g/', '/h/b/')));
  assert.ok(classifyPrecursorResource('https://www.example.com' + path));
  for (const value of [canonical, path.replace('/h/g/', '/h/b/'), path.replace('a012b345c678', 'A012B345C678'), path.replace('a012b345c678', 'a012b345c67'), path + '/extra', path + '.map', path.replace('/precursor/', '/jsd/'), '/turnstile/v0/api.js']) assert.equal(classifyPrecursorResource('https://www.example.com' + value), null);
  for (const value of ['http://www.example.com' + path, 'https://user:pass@www.example.com' + path, 'https://www.example.com' + path + '#mode=armed', 'https://www.example.com' + path.replace('precursor', '%70recursor'), 'https://www.example.com\\' + path, ' '.repeat(20000)]) assert.equal(classifyPrecursorResource(value), null);
});
test('reviewed release policy enables resource presence; candidate and a lone boolean never do', async () => {
  assert.equal(PRECURSOR_POLICY.enabled, true); assert.equal(PRECURSOR_POLICY.stage, 'production-approved'); assert.equal(PRECURSOR_POLICY.reviewDueAt, Date.UTC(2027, 0, 28));
  const approved = fixture({ policy: PRECURSOR_POLICY }); assert.equal(await approved.observer.observe(network()), true);
  for (const policy of [{ enabled: false, stage: 'documented-candidate', reviewDueAt: null }, { enabled: true, stage: 'documented-candidate', reviewDueAt: Date.UTC(2027, 0, 28) }, { enabled: true }, { enabled: true, stage: 'production-approved', reviewDueAt: null }, { enabled: true, stage: 'production-approved', reviewDueAt: 1 }]) {
    const f = fixture({ policy }); assert.equal(await f.observer.observe(network()), false); assert.equal(absent(f).capabilities.presenceDetection, false); assert.equal(f.calls(), 0);
  }
});
test('native versioned JavaScript completion records safe presence and never a mode', async () => {
  const f = fixture(); assert.equal(await f.observer.observe(network()), true);
  const first = f.observer.read(request); assert.equal(first.presence, 'observed'); assert.equal(first.mode, 'unknown'); assert.deepEqual(first.capabilities, { presenceDetection: true, modeDetection: false });
  assert.equal(first.evidenceSource, 'browser-network'); assert.equal(first.integrity, 'browser-observed'); assert.equal(first.ruleIds.length, 1);
  f.tick(1000); await f.observer.observe(network()); assert.equal(f.observer.read(request).lastObservedAt, first.lastObservedAt + 1000);
  assert.doesNotMatch(JSON.stringify([...f.observer.documents]), /https|QUERY_CANARY|USER_CANARY|TOKEN_CANARY|FRAGMENT_CANARY|example\.com|responseHeaders|a012b345c678/);
  assert.doesNotMatch(JSON.stringify(first), /changed|armed|monitor|\boff\b/);
});
test('Content-Type discriminator ignores unrelated header values and rejects missing, duplicate, HTML and malformed metadata', () => {
  let sensitiveReads = 0;
  const secret = { name: 'Set-Cookie' }; Object.defineProperty(secret, 'value', { get() { ++sensitiveReads; throw Error('secret'); } });
  assert.equal(precursorJavaScriptResponse([secret, { name: 'cOnTeNt-TyPe', value: 'Text/JavaScript;charset=utf-8' }]), true);
  for (const headers of [undefined, [], [{ name: 'Content-Type', value: 'text/html' }], [{ name: 'Content-Type', value: 'application/json' }], [{ name: 'Content-Type', value: 'application/javascript\r\nSet-Cookie: x' }], [{ name: 'Content-Type', value: 'application/javascript' }, { name: 'Content-Type', value: 'application/javascript' }], new Array(1), new Array(257)]) assert.equal(precursorJavaScriptResponse(headers), false);
  assert.equal(sensitiveReads, 0);
});
test('only script success with verified MIME and matching native origins reaches the native query', async () => {
  for (const change of [{ statusCode: 302 }, { statusCode: 404 }, { statusCode: 0 }, { statusCode: 200.5 }, { type: 'xmlhttprequest' }, { type: 'main_frame' },
    { url: 'https://www.example.com' + canonical }, { responseHeaders: [] }, { responseHeaders: [{ name: 'Content-Type', value: 'text/html' }] },
    { initiator: undefined }, { initiator: 'null' }, { initiator: 'https://other.example.com' }, { url: 'https://www.example.com:444' + path }]) {
    const f = fixture(); assert.equal(await f.observer.observe(network(change)), false); absent(f); assert.equal(f.calls(), 0);
  }
  for (const phase of ['before', 'redirect', 'error']) { const f = fixture(); assert.equal(await f.observer.observe(network(), phase), false); assert.equal(f.calls(), 0); }
  const cached = fixture(); assert.equal(await cached.observer.observe(network({ statusCode: 304 })), true);
});
test('native frame confirmation requires exact identity, active lifecycle and exact origin', async () => {
  for (const change of [{ documentId: 'new' }, { frameId: 1 }, { documentLifecycle: 'cached' }, { documentLifecycle: undefined }, { errorOccurred: true },
    { url: 'https://other.example.com/' }, { url: 'http://www.example.com/' }, { url: 'https://www.example.com:444/' }]) {
    const f = fixture(); f.runtime.api.webNavigation.getFrame = async details => ({ documentId: details.documentId, documentLifecycle: 'active', url: 'https://www.example.com/', ...change });
    assert.equal(await f.observer.observe(network()), false); absent(f);
  }
});
test('missing native identities, permissions, readiness and Firefox identity support fail closed', async () => {
  for (const change of [{ tabId: -1 }, { frameId: -1 }, { documentId: undefined }, { documentId: 'bad:id' }, { documentLifecycle: 'prerender' }, { documentLifecycle: 'cached' }]) {
    const f = fixture(); assert.equal(await f.observer.observe(network(change)), false); absent(f); assert.equal(f.calls(), 0);
  }
  for (const mutate of [f => { f.runtime.isReady = false; }, f => { f.runtime.scope.hasDataConsent = false; }, f => { f.runtime.scope.accessReady = false; }, f => { f.allow(false); },
    f => { f.runtime.scope.isHostGrantedSync = () => false; }, f => { f.runtime.api.__detectExpertCapabilities = { networkDocumentIdentity: false }; }, f => { delete f.runtime.api.webNavigation.getFrame; }]) {
    const f = fixture(); mutate(f); assert.equal(await f.observer.observe(network()), false); absent(f); assert.equal(f.calls(), 0);
  }
});
test('header body and URL getters never execute', async () => {
  const f = fixture(); let reads = 0; const details = network();
  for (const field of ['requestBody', 'requestHeaders', 'responseBody', 'cookie', 'mode']) Object.defineProperty(details, field, { get() { ++reads; throw Error('sensitive'); } });
  assert.equal(await f.observer.observe(details), true);
  const hostile = network(); Object.defineProperty(hostile, 'url', { get() { ++reads; throw Error('getter'); } });
  assert.equal(await f.observer.observe(hostile), false); assert.equal(reads, 0);
});
test('clear, forget, revoke and replacement invalidate a pending native lookup', async () => {
  for (const mutate of [f => f.observer.clear(), f => f.observer.forget(key), f => f.observer.clearTab(7), f => { f.runtime.scope.accessGeneration++; }, f => { f.runtime.scope.hasDataConsent = false; }, f => f.allow(false), f => f.add(7, 0, 'replacement')]) {
    const f = fixture(); let finish; f.runtime.api.webNavigation.getFrame = () => new Promise(resolve => { finish = resolve; });
    const result = f.observer.observe(network()); await Promise.resolve(); mutate(f);
    finish({ documentId: 'root', documentLifecycle: 'active', url: 'https://www.example.com/' });
    assert.equal(await result, false); absent(f);
  }
});
test('SPA keeps identity; child evidence never becomes top evidence; retired BFCache data cannot revive', async () => {
  const f = fixture(); f.add(7, 3, 'child');
  assert.equal(await f.observer.observe(network({ frameId: 3, documentId: 'child' })), true); absent(f);
  assert.equal(f.observer.read({ ...request, frameId: 3, documentKey: '7:3:child' }).presence, 'observed');
  assert.equal(await f.observer.observe(network()), true);
  f.runtime.state.bindings.get('7:0').routeChangedAt = 10; assert.equal(f.observer.read(request).presence, 'observed');
  f.runtime.state.bindings.get('7:0').documentLifecycle = 'cached'; absent(f);
  f.runtime.state.bindings.get('7:0').documentLifecycle = 'active'; absent(f);
  f.observer.clearTab(7); assert.equal(f.observer.documents.size, 0);
});
test('same document restored from BFCache during native lookup and wall-clock expired lookups cannot revive pending evidence', async () => {
  for (const mutate of [f => { f.add(7, 0, 'other'); f.tick(1); f.add(7, 0, 'root'); }, f => f.tick(PRECURSOR_LIMITS.timeoutMs), f => f.tick(-1)]) {
    const f = fixture(); let finish; f.runtime.api.webNavigation.getFrame = () => new Promise(resolve => { finish = resolve; });
    const result = f.observer.observe(network()); await Promise.resolve(); mutate(f);
    finish({ documentId: 'root', documentLifecycle: 'active', url: 'https://www.example.com/' });
    assert.equal(await result, false); absent(f);
  }
});
test('BFCache restoration cannot revive retained presence when no poll ran while the document was absent', async () => {
  const f = fixture(); await f.observer.observe(network());
  f.add(7, 0, 'other'); f.tick(1); f.add(7, 0, 'root');
  absent(f); assert.equal(f.observer.documents.size, 0);
  assert.equal(await f.observer.observe(network()), true, 'a new confirmed completion can establish fresh presence');
});
test('API reset metadata binding copies preserve committed and pending observations without a navigation', async () => {
  const copy = f => f.runtime.state.bindings.set('7:0', { ...f.runtime.state.bindings.get('7:0'), apiResultsResetRequired: false });
  const retained = fixture(); await retained.observer.observe(network()); copy(retained);
  assert.equal(retained.observer.read(request).presence, 'observed');
  const pending = fixture(); let finish; pending.runtime.api.webNavigation.getFrame = () => new Promise(resolve => { finish = resolve; });
  const result = pending.observer.observe(network()); await Promise.resolve(); copy(pending);
  finish({ documentId: 'root', documentLifecycle: 'active', url: 'https://www.example.com/' });
  assert.equal(await result, true); assert.equal(pending.observer.read(request).presence, 'observed');
});
test('invalid native commit timestamps fail closed and legacy timestamp-less fixtures use exact references', async () => {
  for (const boundAt of [null, -1, NaN, Infinity, '1700000000000']) {
    const f = fixture(); f.runtime.state.bindings.get('7:0').boundAt = boundAt;
    assert.equal(await f.observer.observe(network()), false); absent(f);
  }
  const f = fixture(); delete f.runtime.state.bindings.get('7:0').boundAt;
  assert.equal(await f.observer.observe(network()), true);
  f.runtime.state.bindings.set('7:0', { ...f.runtime.state.bindings.get('7:0') }); absent(f);
});
test('native recommit invalidation also clears evidence when the commit timestamp collides', async () => {
  const f = fixture(); await f.observer.observe(network());
  const oldAt = f.runtime.state.bindings.get('7:0').boundAt;
  f.add(7, 0, 'root'); assert.equal(f.runtime.state.bindings.get('7:0').boundAt, oldAt);
  f.observer.forget(key); // The production native onCommitted listener always performs this invalidation.
  absent(f);
});
test('TTL, backwards clock, grant generations and review expiry erase stale presence without Off', async () => {
  for (const mutate of [f => f.tick(PRECURSOR_LIMITS.ttlMs), f => f.tick(-1), f => { f.runtime.scope.accessGeneration++; }, f => f.tick(86400000), f => { f.allow(false); f.coverage('paused'); }]) {
    const f = fixture(); await f.observer.observe(network()); mutate(f); absent(f); assert.equal(f.observer.documents.size, 0);
  }
  const f = fixture(); await f.observer.observe(network()); f.policy.enabled = false; assert.equal(f.observer.read(request).presence, 'observed', 'external caller cannot mutate captured policy');
});
test('document retention is bounded and overflow is explicit', async () => {
  const f = fixture();
  for (let index = 0; index <= PRECURSOR_LIMITS.maxDocuments; ++index) {
    f.add(index + 10, 0, 'doc'); await f.observer.observe(network({ tabId: index + 10, documentId: 'doc' }));
  }
  assert.equal(f.observer.documents.size, PRECURSOR_LIMITS.maxDocuments); assert.equal(f.observer.read(request).truncated, true);
  f.observer.clear(); assert.equal(f.observer.documents.size, 0); assert.equal(f.observer.read(request).truncated, false);
});
test('physical cap and duplicate cap survive timeout and clear until native promises settle', async () => {
  const f = fixture(), finishers = [], jobs = [];
  f.runtime.api.webNavigation.getFrame = () => new Promise(resolve => finishers.push(resolve));
  for (let index = 0; index < PRECURSOR_LIMITS.maxPhysical; ++index) { f.add(7, index, index ? 'doc' + index : 'root'); jobs.push(f.observer.observe(network({ frameId: index, documentId: index ? 'doc' + index : 'root' }))); }
  await Promise.resolve();
  assert.equal(f.observer.physical.size, PRECURSOR_LIMITS.maxPhysical); assert.equal(await f.observer.observe(network()), false);
  f.add(7, 10, 'extra'); assert.equal(await f.observer.observe(network({ frameId: 10, documentId: 'extra' })), false);
  assert.deepEqual(await Promise.all(jobs), [false, false, false, false]);
  assert.equal(f.observer.physical.size, PRECURSOR_LIMITS.maxPhysical);
  f.observer.clear(); assert.equal(f.observer.physical.size, PRECURSOR_LIMITS.maxPhysical); assert.equal(await f.observer.observe(network()), false);
  for (const finish of finishers) finish(null); await Promise.resolve(); await Promise.resolve();
  assert.equal(f.observer.physical.size, 0); assert.equal(f.observer.pending.size, 0); absent(f);
});
test('native rejection and synchronous exceptions leave no pending slot or false evidence', async () => {
  for (const impl of [() => { throw Error('native'); }, () => Promise.reject(Error('native'))]) {
    const f = fixture(); f.runtime.api.webNavigation.getFrame = impl; assert.equal(await f.observer.observe(network()), false);
    assert.equal(f.observer.physical.size, 0); assert.equal(f.observer.pending.size, 0); absent(f);
  }
  const f = fixture(); assert.equal(f.observer.read({ ...request, tabId: 8 }), null);
});
