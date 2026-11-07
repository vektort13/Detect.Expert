import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCookieRequest, readClearCookiesRequest, readClearCookiesResult, readCookieSnapshot, readLoaderRows, readTagManagerDocuments, mergeLoaderRows } from '../../packages/contracts/src/inspection.mjs';
const row = { source: 'google-tag-manager', target: 'facebook-pixel', attributionConfidence: 'exact-resource', evidenceSource: 'page-hook', integrity: 'page-controlled', count: 2 };
const cookie = { name: '_ga', domain: 'example.com', hostOnly: false, secure: true, httpOnly: false, session: false, sameSite: 'lax', partitioned: false, tracking: true, category: 'analytics', owner: 'Google', purpose: 'Analytics identifier', confidence: 'documented', ruleIds: ['cookie-ga'], sourceUrls: ['https://developers.google.com/analytics/devguides/collection/analyticsjs/cookie-usage'], expirationDate: 1900000000 };
const snapshot = () => ({ schemaVersion: 1, type: 'cookies-state', documentKey: '7:0:doc', coverageState: 'partial', permission: 'granted', trackingCount: 1, entries: [cookie], truncated: false, observedAt: 1700000000000, sessionBinding: { status: 'registration-observed', headers: ['secure-session-registration'] } });
test('inspection: privileged cookie request identity and exact shape', () => {
  assert.deepEqual(readCookieRequest({ schemaVersion: 1, type: 'ui-get-cookies', tabId: 7, documentKey: '7:0:doc' })?.frameId, 0);
  for (const change of [{ tabId: 8 }, { frameId: 1 }, { frameId: -1 }, { url: 'https://other.example/' }, { type: 'sensor-events' }]) assert.equal(readCookieRequest({ schemaVersion: 1, type: 'ui-get-cookies', tabId: 7, documentKey: '7:0:doc', ...change }), null);
});
test('inspection: cookie metadata cannot carry raw values, secrets or a TPM assertion', () => {
  assert.ok(readCookieSnapshot(snapshot()));
  for (const [key, value] of [['value', 'AUTH_SENTINEL'], ['path', '/private/id'], ['storeId', '0'], ['partitionKey', { topLevelSite: 'https://other.example' }], ['tpm', true], ['cannotExport', true]]) assert.equal(readCookieSnapshot({ ...snapshot(), entries: [{ ...cookie, [key]: value }] }), null);
  assert.equal(readCookieSnapshot({ ...snapshot(), trackingCount: 2 }), null);
  assert.equal(readCookieSnapshot({ ...snapshot(), permission: 'required' }), null);
  assert.equal(readCookieSnapshot({ ...snapshot(), entries: [{ ...cookie, category: 'security' }] }), null);
  assert.equal(Object.hasOwn(readCookieSnapshot({ ...snapshot(), sessionBinding: { status: 'tpm-bound', headers: [] } }), 'sessionBinding'), false);
});
test('inspection: hostile accessors are rejected without invocation', () => {
  let calls = 0;
  for (const [reader, value, key] of [[readCookieRequest, { schemaVersion: 1, type: 'ui-get-cookies', tabId: 7, documentKey: '7:0:doc' }, 'tabId'], [readCookieSnapshot, snapshot(), 'entries'], [value => readLoaderRows([value]), { ...row }, 'target']]) {
    Object.defineProperty(value, key, { enumerable: true, get() { calls++; throw Error('secret getter'); } });
    assert.equal(reader(value), null);
  }
  assert.equal(calls, 0);
});
test('inspection: loader evidence admits fixed services and canonical attribution only', () => {
  assert.deepEqual(readLoaderRows([row]), [row]);
  for (const change of [{ target: 'arbitrary-sdk' }, { source: 'other-sdk' }, { integrity: 'browser-observed' }, { attributionConfidence: 'temporal' }, { url: 'https://host/path?secret=token' }, { stack: 'raw stack' }, { count: 0 }, { count: 2147483648 }]) assert.equal(readLoaderRows([{ ...row, ...change }]), null);
  assert.equal(readLoaderRows([row, row]), null);
  assert.equal(readLoaderRows(new Array(129).fill(row)), null);
  const document = { documentKey: '7:0:doc', rows: [row], truncated: false };
  assert.deepEqual(readTagManagerDocuments([document]), [document]);
  assert.equal(readTagManagerDocuments([document, document]), null);
});
test('inspection: Pro epoch merge avoids recounting polls and retains restart baselines', () => {
  assert.deepEqual(mergeLoaderRows([row], [row]), [row]);
  assert.equal(mergeLoaderRows([row], [{ ...row, count: 3 }])[0].count, 3);
  assert.equal(mergeLoaderRows([row], [{ ...row, count: 1 }], [row])[0].count, 3);
  assert.equal(mergeLoaderRows([{ ...row, count: 2147483647 }], [row], [{ ...row, count: 2147483647 }])[0].count, 2147483647);
  assert.equal(mergeLoaderRows([], [{ ...row, value: 'secret' }]), null);
});

test('inspection: cookie cleanup admits an exact privileged document request and bounded metadata-only result', () => {
  const request = { schemaVersion: 1, type: 'ui-clear-site-cookies', tabId: 7, documentKey: '7:0:doc' };
  assert.equal(readClearCookiesRequest(request).frameId, 0);
  for (const change of [{ tabId: 8 }, { frameId: 1 }, { domain: 'foreign.test' }, { storeId: 'other-container' }, { partitionKey: { topLevelSite: 'https://foreign.test' } }, { type: 'ui-get-cookies' }]) assert.equal(readClearCookiesRequest({ ...request, ...change }), null);
  const result = { schemaVersion: 1, type: 'cookies-clear-state', documentKey: '7:0:doc', removedCount: 3, failedCount: 1, truncated: false };
  assert.deepEqual(readClearCookiesResult(result), result);
  for (const change of [{ removedCount: -1 }, { failedCount: 4097 }, { removedCount: 4096 }, { names: ['AUTH_NAME'] }, { value: 'AUTH_CANARY' }, { truncated: 1 }]) assert.equal(readClearCookiesResult({ ...result, ...change }), null);
  let calls = 0; Object.defineProperty(request, 'tabId', { get() { calls++; return 7; } });
  Object.defineProperty(result, 'removedCount', { get() { calls++; return 3; } });
  assert.equal(readClearCookiesRequest(request), null); assert.equal(readClearCookiesResult(result), null); assert.equal(calls, 0);
});

test('inspection: total and site counts preserve old snapshots while describing a bounded larger inventory', () => {
  assert.equal(Object.hasOwn(readCookieSnapshot(snapshot()), 'totalCount'), false);
  const counted = { ...snapshot(), totalCount: 300, siteCount: 290, truncated: true };
  assert.equal(readCookieSnapshot(counted).totalCount, 300);
  assert.equal(readCookieSnapshot(counted).siteCount, 290);
  for (const change of [{ totalCount: 0 }, { totalCount: 4097 }, { siteCount: -1 }, { siteCount: 301 }, { siteCount: NaN }]) assert.equal(readCookieSnapshot({ ...counted, ...change }), null);
  assert.equal(readCookieSnapshot({ ...snapshot(), entries: [], trackingCount: 0, totalCount: 3, permission: 'required' }), null);
});
