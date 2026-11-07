import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CookieWriterObserver } from '../../apps/production-extension/cookie-writer-observer.js';
import { readCookieWriterRequest, readCookieWriterSnapshot, readCookieWriterCache } from '../../packages/contracts/src/cookie-writers.mjs';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const drain = async () => { for (let i = 0; i < 5; ++i) await new Promise(resolve => setImmediate(resolve)); };
class Timers {
  next = 0; jobs = new Map();
  setTimeout(callback, delay) { const id = ++this.next; this.jobs.set(id, { callback, delay }); return id; }
  clearTimeout(id) { this.jobs.delete(id); }
  fire(delay) { for (const [id, job] of [...this.jobs]) if (job.delay === delay) { this.jobs.delete(id); job.callback(); } }
}
const row = (changes = {}) => ({ name: '_id', phase: 'returned-sync', script: { host: 'sub.example.com', pathTemplate: '/tracker.js' }, attributionConfidence: 'exact-resource', evidenceSource: 'page-hook', integrity: 'page-controlled', count: 2, ...changes });
const cache = rows => ({ schemaVersion: 1, type: 'cookie-writers-cache', available: true, rows, truncated: false });
const request = (tabId = 1) => ({ schemaVersion: 1, type: 'ui-get-cookie-writers', tabId, frameId: 0, documentKey: tabId + ':0:main' });
function fixture() {
  let now = 1800000000000, observable = true;
  const calls = [], authorizations = [], projections = new Map(Array.from({ length: 40 }, (_, i) => [i + 1, { documentKey: (i + 1) + ':0:main', coverageState: 'active' }]));
  const runtime = { now: () => now, scope: { accessGeneration: 1, hasDataConsent: true },
    getProjection: tab => projections.get(tab), canObserveNetworkDocument: () => observable,
    apiResults: { authorize: async (request, operation) => { authorizations.push({ request, operation }); return true; } },
    api: { tabs: { sendMessage: async (...args) => { calls.push(args); return cache([row()]); } } } };
  const timers = new Timers(), observer = new CookieWriterObserver(runtime, { redact: host => host.endsWith('.example.com') ? { kind: 'registrable', value: 'example.com' } : { kind: 'unknown' } }, timers);
  return { observer, runtime, timers, calls, authorizations, projections, tick: ms => { now += ms; }, deny: () => { observable = false; } };
}
test('writer backend authorizes twice, targets exact native frame and retains only redacted metadata', async () => {
  const f = fixture(), result = await f.observer.read(request());
  assert.ok(readCookieWriterSnapshot(result)); assert.equal(f.authorizations.length, 2); assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0], [1, { schemaVersion: 1, type: 'cookie-writers-query' }, { frameId: 0, documentId: 'main' }]);
  assert.deepEqual(result.rows[0].script, { host: 'example.com', pathTemplate: '/tracker.js' });
  assert.equal(result.rows[0].evidenceSource, 'page-hook'); assert.equal(result.rows[0].integrity, 'page-controlled');
});
test('repeated writer reads replace cumulative snapshots and merge redaction collisions once', async () => {
  const f = fixture(); f.runtime.api.tabs.sendMessage = async () => cache([row(), row({ script: { host: 'other.example.com', pathTemplate: '/tracker.js' } })]);
  for (let i = 0; i < 3; ++i) { const result = await f.observer.read(request()); assert.equal(result.rows.length, 1); assert.equal(result.rows[0].count, 4); }
});
test('writer reads coalesce while the same native document query is pending', async () => {
  const f = fixture(), gate = deferred(); f.runtime.api.tabs.sendMessage = async () => { f.calls.push('read'); return gate.promise; };
  const first = f.observer.read(request()), second = f.observer.read(request()); assert.equal(first, second); await drain();
  assert.equal(f.calls.length, 1); gate.resolve(cache([row()])); await Promise.all([first, second]); assert.equal(f.observer.pending.size, 0);
});
test('invalid request identity, consent, paused projection and document denial issue no native query', async () => {
  for (const deny of [f => { f.runtime.scope.hasDataConsent = false; }, f => { f.projections.get(1).coverageState = 'paused'; }, f => { f.projections.get(1).documentKey = '1:0:next'; }, f => f.deny()]) {
    const f = fixture(); deny(f); const result = await f.observer.read(request()); assert.deepEqual(result.rows, []); assert.equal(f.calls.length, 0);
  }
  for (const change of [{ documentKey: '2:0:main' }, { frameId: null }, { tabId: -1 }, { value: 'FORBIDDEN' }]) assert.equal(readCookieWriterRequest({ ...request(), ...change }), null);
});
test('a pending MAIN reset blocks old cookie writers before query and invalidates an existing cache', async () => {
  const f = fixture(), binding = { apiResultsResetRequired: false };
  f.runtime.apiResults.binding = () => binding;
  await f.observer.read(request()); assert.equal(f.observer.documents.size, 1);
  binding.apiResultsResetRequired = true;
  assert.deepEqual(f.observer.snapshot('1:0:main').rows, []);
  assert.deepEqual((await f.observer.read(request())).rows, []);
  assert.equal(f.calls.length, 1, 'no second MAIN query while reset remains required');
  binding.apiResultsResetRequired = false;
  assert.equal((await f.observer.read(request())).rows.length, 1);
});
test('navigation, generation, consent, pause and forgetting during await discard writer responses', async () => {
  for (const invalidate of [f => { f.projections.get(1).documentKey = '1:0:next'; }, f => { ++f.runtime.scope.accessGeneration; }, f => { f.runtime.scope.hasDataConsent = false; }, f => { f.projections.get(1).coverageState = 'paused'; }, f => f.observer.forget('1:0:main')]) {
    const f = fixture(), gate = deferred(); f.runtime.api.tabs.sendMessage = async () => gate.promise;
    const job = f.observer.read(request()); await drain(); invalidate(f); gate.resolve(cache([row()]));
    assert.deepEqual((await job).rows, []); assert.equal(f.observer.documents.size, 0);
  }
});
test('an old request finishing after clear cannot erase a newer authorized writer snapshot', async () => {
  const f = fixture(), old = deferred(); let calls = 0;
  f.runtime.api.tabs.sendMessage = async () => ++calls === 1 ? old.promise : cache([row({ name: 'new' })]);
  const first = f.observer.read(request()); await drain(); f.observer.clear();
  const fresh = await f.observer.read(request()); assert.equal(fresh.rows[0].name, 'new');
  old.resolve(cache([row({ name: 'old' })])); assert.deepEqual((await first).rows, []);
  assert.equal(f.observer.snapshot('1:0:main').rows[0].name, 'new');
});
test('invalid native cache, private value fields and unredactable sources cannot escape the metadata schema', async () => {
  const f = fixture(); f.runtime.api.tabs.sendMessage = async () => cache([row({ value: 'COOKIE_VALUE_CANARY' })]);
  assert.deepEqual((await f.observer.read(request())).rows, []);
  f.runtime.api.tabs.sendMessage = async () => cache([row({ script: { host: 'private.invalid', pathTemplate: '/tracker.js' } })]);
  const result = await f.observer.read(request()); assert.equal(result.rows[0].script, null); assert.equal(result.rows[0].attributionConfidence, 'unknown'); assert.equal(result.truncated, true);
  assert.doesNotMatch(JSON.stringify([...f.observer.documents]), /COOKIE_VALUE_CANARY|private.invalid/);
  assert.equal(readCookieWriterCache({ ...cache([row()]), available: false }), null);
});
test('writer TTL and document capacity prune bounded cached metadata', async () => {
  const f = fixture(); await f.observer.read(request()); f.tick(600000); assert.deepEqual(f.observer.snapshot('1:0:main').rows, []);
  for (let tab = 1; tab <= 33; ++tab) await f.observer.read(request(tab));
  assert.equal(f.observer.documents.size, 32); assert.equal(f.observer.documents.has('1:0:main'), false); assert.equal(f.observer.limited, true);
});
test('timeouts and clear preserve two occupied physical slots until native queries really settle', async () => {
  const f = fixture(), gates = [deferred(), deferred()]; let calls = 0;
  f.runtime.api.tabs.sendMessage = async () => gates[calls++].promise;
  const first = f.observer.read(request(1)), second = f.observer.read(request(2)); await drain();
  assert.equal(f.observer.physical.size, 2); f.timers.fire(1500); await Promise.all([first, second]);
  assert.equal(f.observer.physical.size, 2); f.observer.clear(); await f.observer.read(request(3)); assert.equal(calls, 2);
  gates.forEach(gate => gate.resolve(cache([row()]))); await drain(); assert.equal(f.observer.physical.size, 0);
});
