import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BackgroundActivityObserver, emptyBackgroundInventory } from '../../apps/production-extension/background-activity-observer.js';
import { readBackgroundSnapshot } from '../../packages/contracts/src/background-activity.mjs';

const request = { schemaVersion: 1, type: 'ui-refresh-background-activity', tabId: 1, frameId: 0, documentKey: '1:0:doc' };
const rows = [{ operation: 'ServiceWorkerContainer.register', phase: 'async-returned', count: 1, evidenceSource: 'page-hook', integrity: 'page-controlled', attributionConfidence: 'exact-resource', script: { host: 'asset.site.example.com', pathTemplate: '/main.js' }, worker: { host: 'site.example.com', pathTemplate: '/sw.js' } }];
function fixture() {
  let now = 1, response = { schemaVersion: 1, type: 'background-values-cache', available: true, rows, truncated: false, inventory: { ...emptyBackgroundInventory(), status: 'available', secureContext: true, supported: { serviceWorker: true, push: false, sync: true, periodicSync: false }, registrationCount: 1, syncTagCount: 0, checkedAt: 1, registrations: [{ scope: { host: 'site.example.com', pathTemplate: '/' }, script: { host: 'site.example.com', pathTemplate: '/sw.js' }, state: 'activated', pushSubscribed: null, syncTagCount: 0, periodicTagCount: null }] } }, authorizations = 0;
  const messages = [], scope = { hasDataConsent: true, accessGeneration: 0 }, projection = { documentKey: request.documentKey, coverageState: 'active' };
  const runtime = { scope, now: () => now, getProjection: () => projection, canObserveNetworkDocument: key => scope.hasDataConsent && projection.documentKey === key && !['paused', 'no-access'].includes(projection.coverageState), apiResults: { async authorize() { ++authorizations; return scope.hasDataConsent; } }, api: { tabs: { async sendMessage(...args) { messages.push(args); return typeof response === 'function' ? response() : response; } } } };
  const observer = new BackgroundActivityObserver(runtime, { redact: host => ({ kind: 'registrable', value: host.split('.').slice(-2).join('.') }) });
  return { runtime, observer, scope, projection, messages, authorizations: () => authorizations, response(value) { response = value; }, advance(value) { now = value; } };
}
test('background privileged observer authorizes twice and targets the exact document', async () => {
  const f = fixture(), result = await f.observer.read(request); assert.ok(readBackgroundSnapshot(result)); assert.equal(f.authorizations(), 2);
  assert.deepEqual(f.messages[0], [1, { schemaVersion: 1, type: 'background-values-query', refresh: true }, { frameId: 0, documentId: 'doc' }]);
  assert.equal(result.rows[0].script.host, 'example.com'); assert.equal(result.inventory.registrations[0].scope.host, 'example.com'); assert.equal(result.inventory.registrationCount, 1);
});
test('background passive get retains checked inventory without repeating native diagnostics', async () => {
  const f = fixture(); await f.observer.read(request);
  f.response({ schemaVersion: 1, type: 'background-values-cache', available: true, rows, truncated: false, inventory: emptyBackgroundInventory() });
  const result = await f.observer.read({ ...request, type: 'ui-get-background-activity' });
  assert.equal(f.messages[1][1].refresh, false); assert.equal(result.inventory.registrationCount, 1); assert.equal(result.inventory.checkedAt, 1);
  f.observer.clear(); const cleared = await f.observer.read({ ...request, type: 'ui-get-background-activity' }); assert.equal(cleared.inventory.registrationCount, null); assert.equal(cleared.inventory.checkedAt, 0);
});
for (const mutation of ['consent', 'generation', 'navigation', 'pause', 'clear', 'forget']) test('background cancels late replies after ' + mutation, async () => {
  const f = fixture(); let complete; const pending = new Promise(resolve => { complete = resolve; }); f.response(() => pending);
  const work = f.observer.read(request); await new Promise(setImmediate);
  if (mutation === 'consent') f.scope.hasDataConsent = false;
  if (mutation === 'generation') ++f.scope.accessGeneration;
  if (mutation === 'navigation') f.projection.documentKey = '1:0:other';
  if (mutation === 'pause') f.projection.coverageState = 'paused';
  if (mutation === 'clear') f.observer.clear();
  if (mutation === 'forget') f.observer.forget(request.documentKey);
  complete(null); const result = await work; assert.equal(result.coverageState, 'no-access'); assert.equal(result.rows.length, 0); assert.equal(result.inventory.registrations.length, 0); assert.equal(f.observer.documents.size, 0);
});
test('background rejects malformed cache and privilege upgrades instead of retaining stale observations', async () => {
  const f = fixture(); await f.observer.read(request); assert.equal(f.observer.documents.size, 1);
  f.response({ schemaVersion: 1, type: 'background-values-cache', available: true, rows: [{ ...rows[0], integrity: 'browser-observed' }], truncated: false, inventory: emptyBackgroundInventory() });
  const result = await f.observer.read(request); assert.equal(result.rows.length, 0); assert.equal(result.inventory.registrationCount, null); assert.equal(f.observer.documents.size, 0);
});
test('background TTL, host redaction failure and unsupported diagnostics preserve empty or unknown states', async () => {
  const f = fixture(); await f.observer.read(request); f.advance(600001); assert.equal(f.observer.snapshot(request.documentKey).rows.length, 0);
  f.observer.helpers.redact = () => ({ kind: 'unknown', value: 'unknown' }); const result = await f.observer.read(request);
  assert.equal(result.rows[0].script, null); assert.equal(result.rows[0].worker, null); assert.equal(result.rows[0].attributionConfidence, 'unknown'); assert.equal(result.truncated, true); assert.equal(result.inventory.registrations.length, 0); assert.equal(result.inventory.truncated, true);
});
test('background denies access before querying a frame or reading inventory', async () => {
  const f = fixture(); f.scope.hasDataConsent = false; const result = await f.observer.read(request);
  assert.equal(result.coverageState, 'no-access'); assert.equal(f.messages.length, 0); assert.equal(result.rows.length, 0);
});
