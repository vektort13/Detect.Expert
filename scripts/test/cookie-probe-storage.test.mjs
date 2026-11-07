import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { selectedCookieStorageProbe } from '../../apps/production-extension/cookie-storage-probe.js';
const value = 'LOCAL_IDENTIFIER_CANARY_123';
async function run({ cookie = '_ga=' + value, local = [value], records = [], cache = null, input = '_ga', pendingCancel = false } = {}) {
  const operations = [], keys = local.map((_, index) => 'PRIVATE_STORAGE_KEY_CANARY_' + index);
  class Document {}
  Object.defineProperty(Document.prototype, 'cookie', { get() { operations.push('cookie-read'); return cookie; } });
  class Storage { getItem(key) { operations.push('local-read'); return local[keys.indexOf(key)]; } key(index) { return keys[index] ?? null; } }
  const storage = new Storage(); Object.defineProperty(storage, 'length', { value: local.length });
  const database = {
    objectStoreNames: ['PRIVATE_STORE_CANARY'], close() { operations.push('idb-close'); },
    transaction(name, mode) {
      assert.equal(mode, 'readonly'); operations.push('idb-readonly');
      return { abort() { operations.push('idb-abort'); }, objectStore() { return { openCursor() {
        const request = {}, queue = [...records];
        const next = () => setImmediate(() => { const item = queue.shift(); request.result = item === undefined ? null : { value: item, continue: next }; request.onsuccess?.(); });
        next(); return request;
      } }; } };
    }
  };
  const indexedDB = {
    databases: async () => records.length ? [{ name: 'PRIVATE_DB_CANARY' }] : [],
    open(name) { operations.push('idb-open'); const request = { result: database }; setImmediate(() => request.onsuccess?.()); return request; }
  };
  const caches = {
    keys: async () => cache === null ? [] : ['PRIVATE_CACHE_CANARY'],
    match: async (request, options) => {
      operations.push('cache-read'); assert.equal(request.url, 'https://example.test/'); assert.equal(options.cacheName, 'PRIVATE_CACHE_CANARY');
      let read = false; return { type: 'basic', body: { getReader() { return {
        read: async () => read ? { done: true } : (read = true, { done: false, value: new TextEncoder().encode(cache) }),
        cancel: () => { operations.push('cache-cancel'); return pendingCancel ? new Promise(() => {}) : Promise.resolve(); }
      }; } } };
    }
  };
  const context = { Document, Storage, document: new Document(), window: { localStorage: storage, caches }, indexedDB, caches, location: { origin: 'https://example.test' }, Request, TextDecoder, Uint8Array, setTimeout, clearTimeout, input };
  const result = await runInNewContext('(' + selectedCookieStorageProbe.toString() + ')(input)', context);
  return { result: JSON.parse(JSON.stringify(result)), operations };
}
test('selected local storage probe compares values locally and returns only storage kinds/counts', async () => {
  const { result, operations } = await run({ local: [value, 'unrelated'], records: [value, { identifier: value, other: 'unrelated' }] });
  assert.deepEqual(result, { matchedStores: [{ storage: 'localStorage', count: 1 }, { storage: 'indexedDB', count: 2 }], storageCoverage: 'active' });
  assert.equal(operations.includes('idb-readonly'), true); assert.equal(operations.includes('idb-close'), true);
  for (const canary of ['IDENTIFIER_CANARY', 'PRIVATE_STORAGE_KEY_CANARY', 'PRIVATE_STORE_CANARY', 'PRIVATE_DB_CANARY']) assert.equal(JSON.stringify(result).includes(canary), false);
});
test('selected local storage probe treats matching cache content as a copy with partial coverage', async () => {
  const { result, operations } = await run({ local: [], cache: value });
  assert.deepEqual(result, { matchedStores: [{ storage: 'cacheStorage', count: 1 }], storageCoverage: 'partial' });
  assert.equal(operations.includes('cache-cancel'), true); assert.equal(operations.includes('cache-open'), false);
  assert.equal(JSON.stringify(result).includes('PRIVATE_CACHE_CANARY'), false);
});
test('selected local storage probe refuses short, missing or ambiguous selected cookies', async () => {
  for (const cookie of ['_ga=short', 'other=' + value, '_ga=' + value + '; _ga=ANOTHER_CANARY']) {
    const { result, operations } = await run({ cookie });
    assert.deepEqual(result, { matchedStores: [], storageCoverage: 'partial' }); assert.deepEqual(operations, ['cookie-read']);
  }
});
test('selected local storage probe rejects unvalidated selectors before storage access', async () => {
  for (const input of ['name;_ga', 'x'.repeat(129), { toString() { throw Error('coercion'); } }, null]) {
    const { result, operations } = await run({ input }); assert.deepEqual(result, { matchedStores: [], storageCoverage: 'unsupported' }); assert.deepEqual(operations, []);
  }
});
test('selected local storage probe never invokes arbitrary structured-record getters', async () => {
  let calls = 0; const record = { identifier: value }; Object.defineProperty(record, 'account', { enumerable: true, get() { calls++; throw Error('getter'); } });
  const { result } = await run({ local: [], records: [record] }); assert.equal(calls, 0); assert.deepEqual(result.matchedStores, [{ storage: 'indexedDB', count: 1 }]);
});
test('selected local storage probe saturates storage reads and discards oversized cache content', async () => {
  const { result, operations } = await run({ local: new Array(100).fill(value), records: new Array(50).fill(value), cache: 'x'.repeat(32769) });
  assert.deepEqual(result, { matchedStores: [{ storage: 'localStorage', count: 64 }, { storage: 'indexedDB', count: 16 }], storageCoverage: 'partial' });
  assert.equal(operations.filter(item => item === 'local-read').length, 64); assert.equal(operations.includes('cache-cancel'), true);
});
test('selected local storage probe releases its result when native stream cancellation never settles', async () => {
  const result = await Promise.race([run({ local: [], cache: value, pendingCancel: true }), new Promise(resolve => { const timer = setTimeout(() => resolve(null), 1000); timer.unref(); })]);
  assert.ok(result); assert.deepEqual(result.result, { matchedStores: [{ storage: 'cacheStorage', count: 1 }], storageCoverage: 'partial' });
  assert.equal(result.operations.includes('cache-cancel'), true);
});
