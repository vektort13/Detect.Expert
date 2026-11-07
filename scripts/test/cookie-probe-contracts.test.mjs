import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readCookieProbeRequest, readCookieProbeSnapshot, readCookieProbeDocuments } from '../../packages/contracts/src/cookie-probe.mjs';
const request = () => ({ schemaVersion: 1, type: 'ui-start-cookie-probe', tabId: 7, frameId: 0, documentKey: '7:0:doc', handle: 'a'.repeat(32) });
const state = () => ({ schemaVersion: 1, type: 'cookie-probe-state', documentKey: '7:0:doc', status: 'complete', result: 'restored-same', reason: 'none', cookieName: '_ga', domain: 'example.com', owner: 'Google Analytics', removalConfirmed: true, observedRestorations: 1, source: 'unknown', cleanup: 'not-needed', startedAt: 1, completedAt: 2, windowMs: 10000, matchedStores: [{ storage: 'localStorage', count: 1 }], storageCoverage: 'partial' });
test('cookie probe canonical runtime is exact and rejects forged targets', () => {
  assert.equal(readFileSync(new URL('../../packages/contracts/src/cookie-probe.mjs', import.meta.url), 'utf8'), readFileSync(new URL('../../apps/production-extension/cookie-probe-contracts.js', import.meta.url), 'utf8'));
  assert.deepEqual(readCookieProbeRequest(request()), request());
  for (const extra of [{ frameId: 1 }, { url: 'https://foreign.test/' }, { name: '_ga' }, { value: 'VALUE_CANARY' }, { storeId: 'foreign-store' }, { documentKey: '8:0:doc' }, { handle: 'z'.repeat(32) }]) assert.equal(readCookieProbeRequest({ ...request(), ...extra }), null);
});
test('cookie probe canonical snapshots admit metadata and deny causation/values/capabilities', () => {
  assert.deepEqual(readCookieProbeSnapshot(state()), state());
  for (const extra of [{ value: 'VALUE_CANARY' }, { hash: 'HASH_CANARY' }, { path: '/private' }, { handle: 'a'.repeat(32) }, { source: 'indexedDB' }, { status: 'watching' }, { removalConfirmed: false }, { result: 'not-restored' }, { observedRestorations: 33 }, { windowMs: 11000 }, { matchedStores: [{ storage: 'localStorage', count: 0 }] }, { matchedStores: [{ storage: 'localStorage', count: 1 }, { storage: 'localStorage', count: 2 }] }, { matchedStores: [{ storage: 'cookies', count: 1 }] }]) assert.equal(readCookieProbeSnapshot({ ...state(), ...extra }), null);
});
test('cookie probe canonical readers never call getters or coercion', () => {
  let invoked = 0;
  for (const [reader, input, key] of [[readCookieProbeRequest, request(), 'handle'], [readCookieProbeSnapshot, state(), 'cookieName'], [readCookieProbeSnapshot, state(), 'matchedStores']]) {
    Object.defineProperty(input, key, { get() { invoked++; throw Error('getter'); } }); assert.equal(reader(input), null);
  }
  const stores = [{ storage: 'localStorage', count: 1 }]; Object.defineProperty(stores, 0, { get() { invoked++; throw Error('arraygetter'); } });
  assert.equal(readCookieProbeSnapshot({ ...state(), matchedStores: stores }), null);
  assert.equal(readCookieProbeRequest({ ...request(), tabId: { valueOf() { invoked++; return 7; } } }), null); assert.equal(invoked, 0);
});
test('cookie probe canonical document history is bounded with unique document identities', () => {
  assert.deepEqual(readCookieProbeDocuments([state()]), [state()]);
  assert.equal(readCookieProbeDocuments([state(), state()]), null); assert.equal(readCookieProbeDocuments(new Array(1)), null);
  assert.equal(readCookieProbeDocuments(Array.from({ length: 17 }, (_, index) => ({ ...state(), documentKey: '7:0:doc' + index }))), null);
});
test('cookie probe canonical negative outcome requires a full ten-second window and confirmed removal', () => {
  const negative = { ...state(), result: 'not-restored', observedRestorations: 0, completedAt: 10001, cleanup: 'restored' };
  assert.ok(readCookieProbeSnapshot(negative));
  assert.equal(readCookieProbeSnapshot({ ...negative, completedAt: 10000 }), null);
  assert.equal(readCookieProbeSnapshot({ ...state(), status: 'watching', result: 'none', completedAt: 0, removalConfirmed: false, observedRestorations: 0 }), null);
});
