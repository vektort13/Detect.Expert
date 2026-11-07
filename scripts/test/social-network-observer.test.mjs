import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SocialNetworkObserver } from '../../apps/production-extension/social-network-observer.js';
import { readSocialRows } from '../../packages/contracts/src/inspection.mjs';

const key = '7:0:doc', request = { schemaVersion: 1, type: 'ui-get-social-networks', tabId: 7, frameId: 0, documentKey: key };
const pageRow = { service: 'facebook', kind: 'tracking-pixel', endpoint: 'pixel', method: 'GET', requestType: 'image', count: 2, evidenceSource: 'page-hook', integrity: 'page-controlled', attributionConfidence: 'exact-resource', initiatorHost: null, script: { host: 'assets.site.example.com', pathTemplate: '/tracker.js' } };
function fixture() {
  let now = 1700000000000, allowed = true, authorize = true, message = true;
  const scope = { hasDataConsent: true, accessReady: true, accessGeneration: 1, hasAnyHostAccess: () => true, isHostGrantedSync: () => true };
  const runtime = { isReady: true, scope, now: () => now, canObserveNetworkDocument: () => allowed, getProjection: () => ({ documentKey: key }),
    apiResults: { authorize: async () => authorize }, api: { tabs: { sendMessage: async () => message ? { schemaVersion: 1, type: 'social-values-cache', available: true, rows: [pageRow], truncated: false } : null } }, pro: { session: null, mark() {} } };
  const helpers = { host: raw => { try { return new URL(raw).hostname; } catch { return null; } }, redact: host => ({ kind: 'registrable', value: host.split('.').slice(-2).join('.') }) };
  return { observer: new SocialNetworkObserver(runtime, helpers), runtime, tick: ms => { now += ms; }, allow: value => { allowed = value; }, auth: value => { authorize = value; }, message: value => { message = value; } };
}
const network = overrides => ({ tabId: 7, frameId: 0, documentId: 'doc', documentLifecycle: 'active', type: 'image', url: 'https://www.facebook.com/tr/?token=TOKEN_SENTINEL', method: 'GET', initiator: 'https://private.site.example.com/path?token=INITIATOR_SENTINEL', ...overrides });
test('social observer keeps only canonical browser metadata and redacts initiator', () => {
  const { observer } = fixture(); let reads = 0;
  const details = network();
  Object.defineProperties(details, { requestHeaders: { get() { ++reads; throw Error('headers'); } }, responseHeaders: { get() { ++reads; throw Error('headers'); } }, requestBody: { get() { ++reads; throw Error('body'); } } });
  observer.observe(details); observer.observe(details);
  const snapshot = observer.snapshot(key);
  assert.equal(snapshot.rows[0].count, 2); assert.equal(snapshot.rows[0].script, null);
  assert.equal(snapshot.rows[0].attributionConfidence, 'frame-only'); assert.equal(snapshot.rows[0].initiatorHost, 'example.com');
  assert.ok(readSocialRows(snapshot.rows)); assert.equal(reads, 0);
  assert.doesNotMatch(JSON.stringify(snapshot), /TOKEN_SENTINEL|INITIATOR_SENTINEL|requestHeaders|responseHeaders|requestBody|private\.site/);
});
test('social observer rejects missing browser identity, inaccessible or inactive documents', () => {
  for (const overrides of [{ documentId: undefined }, { documentId: 'bad:id' }, { frameId: -1 }, { tabId: -1 }, { documentLifecycle: 'cached' }, { initiator: undefined }]) {
    const f = fixture(); f.observer.observe(network(overrides)); assert.equal(f.observer.snapshot(key).rows.length, 0);
  }
  for (const control of ['isReady', 'consent', 'scope', 'document']) {
    const f = fixture();
    if (control === 'isReady') f.runtime.isReady = false;
    if (control === 'consent') f.runtime.scope.hasDataConsent = false;
    if (control === 'scope') f.runtime.scope.isHostGrantedSync = () => false;
    if (control === 'document') f.allow(false);
    f.observer.observe(network()); assert.equal(f.observer.snapshot(key).rows.length, 0);
  }
});
test('social observer uses an authoritative parent for frame requests and never time-correlates scripts', () => {
  const f = fixture();
  f.observer.observe(network({ frameId: 3, documentId: 'child', type: 'sub_frame', parentFrameId: 0, parentDocumentId: 'doc', url: 'https://www.youtube.com/embed/VIDEO_SENTINEL' }));
  assert.equal(f.observer.snapshot(key).rows[0].kind, 'embedded-content');
  assert.equal(f.observer.snapshot(key).rows[0].script, null);
  assert.equal(f.observer.snapshot('7:3:child').rows.length, 0);
});
test('social page rows retain their separate counts and selected script templates', () => {
  const f = fixture(); f.observer.observe(network());
  assert.equal(f.observer.recordPage(key, [pageRow]), true);
  assert.equal(f.observer.recordPage(key, [pageRow]), true);
  const rows = f.observer.snapshot(key).rows;
  assert.equal(rows.length, 2); assert.equal(rows[0].count, 1); assert.equal(rows[1].count, 2);
  assert.equal(rows[1].script.host, 'example.com');
  assert.equal(f.observer.recordPage(key, [{ ...pageRow, script: { host: 'example.com', pathTemplate: '/private-account-id.js' } }]), false);
  assert.equal(f.observer.recordPage(key, [{ ...pageRow, token: 'SECRET' }]), false);
});
test('social denied read and revocation races return no retained observations', async () => {
  const f = fixture(); f.observer.observe(network()); f.auth(false);
  assert.equal((await f.observer.read(request)).coverageState, 'no-access');
  assert.deepEqual((await f.observer.read(request)).rows, []);
  f.auth(true);
  f.runtime.api.tabs.sendMessage = async () => { f.runtime.scope.accessGeneration++; return { schemaVersion: 1, type: 'social-values-cache', available: true, rows: [pageRow], truncated: false }; };
  assert.deepEqual((await f.observer.read(request)).rows, []);
  assert.deepEqual(f.observer.snapshot(key).rows, []);
});
test('social live read retrieves a trusted bridge reply and never promotes browser attribution', async () => {
  const f = fixture(); f.observer.observe(network());
  let sends = 0;
  f.runtime.api.tabs.sendMessage = async (tabId, message, options) => {
    ++sends; assert.equal(tabId, 7); assert.deepEqual(message, { schemaVersion: 1, type: 'social-values-query' }); assert.deepEqual(options, { frameId: 0, documentId: 'doc' });
    return { schemaVersion: 1, type: 'social-values-cache', available: true, rows: [pageRow], truncated: false };
  };
  const result = await f.observer.read(request);
  assert.equal(sends, 1); assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].script, null); assert.equal(result.rows[1].script.pathTemplate, '/tracker.js');
});
test('social observation budgets are bounded and capture loss is explicit', () => {
  const f = fixture();
  for (let i = 0; i < 21; ++i) f.observer.observe(network());
  assert.equal(f.observer.snapshot(key).rows[0].count, 20); assert.equal(f.observer.snapshot(key).truncated, true);
  f.tick(1000); f.observer.observe(network()); assert.equal(f.observer.snapshot(key).rows[0].count, 21);
  f.tick(600000); assert.deepEqual(f.observer.snapshot(key).rows, []);
  f.observer.observe(network()); f.observer.clear(); assert.deepEqual(f.observer.snapshot(key).rows, []);
});
