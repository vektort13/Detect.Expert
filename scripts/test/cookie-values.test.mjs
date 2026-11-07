import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CookieInspector } from '../../apps/production-extension/cookie-inspector.js';
import { cookieValueIdentity } from '../../apps/production-extension/cookie-values.js';
import { readCookieSnapshot, readCookieView, readCookieValueResult } from '../../packages/contracts/src/inspection.mjs';

const own = (value, key) => Object.getOwnPropertyDescriptor(value, key)?.value;
const cookie = overrides => ({ name: '_ga_TEST', domain: '.example.com', path: '/', storeId: 'test-store', hostOnly: false, secure: true, httpOnly: false, session: true, sameSite: 'lax', value: 'VALUE_CANARY_DEFAULT', ...overrides });
const frame = (frameId, documentId, host = 'www.example.com') => ({ frameId, documentId, url: 'https://' + host + '/account?SECRET_URL_CANARY', documentLifecycle: 'active' });
function fixture(rows = [cookie()]) {
  let now = 1700000000000, granted = true, consent = true, current = '7:0:doc', top = '7:0:doc', storeId = 'test-store', paused = false, cookieQueries = 0;
  const frames = [frame(0, 'doc')], page = { id: 'page', documentKey: current }, serialized = [];
  const runtime = {
    now: () => now, isReady: true,
    scope: { get hasDataConsent() { return consent; }, accessGeneration: 0, isHostGrantedSync: () => true },
    api: {
      permissions: { contains: async () => granted },
      webNavigation: { getAllFrames: async () => frames },
      cookies: {
        getAllCookieStores: async () => [{ id: storeId, tabIds: [7] }],
        getAll: async query => {
          cookieQueries++;
          return rows.filter(row => {
            if (own(row, 'storeId') !== query.storeId) return false;
            const domain = own(row, 'domain').replace(/^\./, '').toLowerCase();
            if (query.domain && domain !== query.domain && !domain.endsWith('.' + query.domain)) return false;
            if (query.url) { const host = new URL(query.url).hostname; if (host !== domain && !host.endsWith('.' + domain)) return false; }
            if (query.name !== undefined && own(row, 'name') !== query.name || query.path !== undefined && own(row, 'path') !== query.path) return false;
            const partition = own(row, 'partitionKey');
            return query.partitionKey ? partition?.topLevelSite === query.partitionKey.topLevelSite : !partition;
          });
        },
      },
    },
    apiResults: { operations: new Set(), authorize: async (request, operation) => !operation.invalid && !paused && (request.documentKey === current || request.documentKey === top) },
    getProjection: () => ({ documentKey: current, coverageState: paused ? 'paused' : 'partial' }),
    canObserveNetworkDocument: key => key === current || key === top,
    pro: { session: { pages: [page] }, pageFor: () => page, checkDeadline: () => true, size: () => true, mark() {}, flush: async () => { serialized.push(JSON.stringify(page)); } },
  };
  const inspector = new CookieInspector(runtime, { host: value => new URL(value).hostname, redact: host => ({ kind: 'registrable', value: host.endsWith('example.com') ? 'example.com' : host }), site: host => host.endsWith('example.com') ? 'example.com' : host });
  const request = { schemaVersion: 1, type: 'ui-get-cookie-view', tabId: 7, frameId: 0, documentKey: '7:0:doc' };
  return { inspector, runtime, page, frames, rows, request, serialized, stats: () => ({ cookieQueries }),
    setRows: next => { rows = next; }, advance: amount => { now += amount; }, revoke: () => { granted = false; }, unconsent: () => { consent = false; },
    navigate: () => { current = '7:0:next'; frames[0] = frame(0, 'next'); }, changeStore: () => { storeId = 'other-store'; }, pause: () => { paused = true; for (const operation of runtime.apiResults.operations) operation.invalid = true; },
    selectChild: () => { current = '7:1:child'; frames.push(frame(1, 'child', 'child.example.com')); page.documentKey = current; return { ...request, frameId: 1, documentKey: current }; },
    navigateTop: () => { top = '7:0:next'; frames[0] = frame(0, 'next'); },
  };
}
const reveal = (f, view, index = 0, request = f.request) => f.inspector.values.reveal({ ...request, type: 'ui-get-cookie-value', handle: view.handles[index] });
const assertNoValue = result => { assert.equal(result.type, 'error'); assert.equal(Object.hasOwn(result, 'value'), false); };

test('cookie values: inventory mints aligned handles without touching values or putting capabilities in Pro', async () => {
  let descriptors = 0;
  const native = new Proxy(cookie(), { getOwnPropertyDescriptor(target, key) { if (key === 'value') descriptors++; return Reflect.getOwnPropertyDescriptor(target, key); } });
  const f = fixture([native]), view = await f.inspector.read(f.request);
  assert.ok(readCookieView(view)); assert.ok(readCookieSnapshot(f.page.cookies));
  assert.equal(descriptors, 0); assert.equal(view.handles.length, 1); assert.match(view.handles[0], /^[0-9a-f]{32}$/);
  for (const persisted of f.serialized) { assert.equal(persisted.includes(view.handles[0]), false); assert.equal(persisted.includes('VALUE_CANARY'), false); assert.equal(persisted.includes('SECRET_URL_CANARY'), false); }
  const result = await reveal(f, view);
  assert.ok(readCookieValueResult(result)); assert.equal(result.value, 'VALUE_CANARY_DEFAULT'); assert.equal(descriptors, 1);
  assert.equal(f.inspector.values.operations.size, 0); assert.equal(f.runtime.apiResults.operations.size, 0);
  assert.equal(JSON.stringify(f.inspector.values.handles.get(view.handles[0])).includes('VALUE_CANARY'), false);
});

test('cookie values: legacy metadata requests return the unchanged canonical snapshot without capabilities', async () => {
  const f = fixture(), snapshot = await f.inspector.read({ ...f.request, type: 'ui-get-cookies' });
  assert.ok(readCookieSnapshot(snapshot)); assert.equal(snapshot.type, 'cookies-state'); assert.equal(f.inspector.values.handles.size, 0); assert.equal(Object.hasOwn(snapshot, 'handles'), false);
});

test('cookie values: absent permission yields a live empty snapshot and no cookie queries', async () => {
  const f = fixture(); f.revoke(); const view = await f.inspector.read(f.request);
  assert.ok(readCookieView(view)); assert.equal(view.snapshot.permission, 'required'); assert.deepEqual(view.handles, []); assert.equal(f.stats().cookieQueries, 0);
});

test('cookie values: sorted masked-name entries map to exact native names, paths and subdomains after reordering', async () => {
  const rows = [cookie({ name: '_ga_Z', domain: 'z.example.com', hostOnly: true, value: 'Z_SUBDOMAIN' }), cookie({ name: '_ga_A', path: '/account', value: 'A_ACCOUNT' }), cookie({ name: '_ga_A', path: '/', value: 'A_ROOT' })];
  const f = fixture(rows), view = await f.inspector.read(f.request);
  assert.equal(view.snapshot.entries.length, 3); assert.ok(view.snapshot.entries.every(entry => entry.name === '_ga_*'));
  const nativeKeys = view.handles.map(handle => f.inspector.values.handles.get(handle).identity);
  f.setRows([...rows].reverse());
  for (let index = 0; index < view.handles.length; index++) {
    const identity = nativeKeys[index], expected = rows.find(row => row.name === identity.name && row.path === identity.path && row.domain === identity.rawDomain).value;
    assert.equal((await reveal(f, view, index)).value, expected);
  }
});

test('cookie values: partition handles never select an unpartitioned or other-site cookie', async () => {
  const current = { topLevelSite: 'https://example.com', hasCrossSiteAncestor: false };
  const rows = [cookie({ value: 'UNPARTITIONED' }), cookie({ partitionKey: current, value: 'CURRENT_PARTITION' }), cookie({ partitionKey: { topLevelSite: 'https://other.test', hasCrossSiteAncestor: false }, value: 'OTHER_PARTITION' })];
  const f = fixture(rows), view = await f.inspector.read(f.request);
  assert.equal(view.handles.length, 2);
  for (let index = 0; index < view.handles.length; index++) assert.equal((await reveal(f, view, index)).value, f.inspector.values.handles.get(view.handles[index]).identity.partitionKey ? 'CURRENT_PARTITION' : 'UNPARTITIONED');
});

test('cookie values: observed external service cookies remain metadata-only', async () => {
  const f = fixture([cookie(), cookie({ name: '_ga', domain: '.external.test', value: 'EXTERNAL_ACCOUNT_CANARY' })]);
  f.inspector.observe({ tabId: 7, frameId: 0, documentId: 'doc', url: 'https://external.test/sdk.js' }, 'response');
  const view = await f.inspector.read(f.request), foreign = view.snapshot.entries.findIndex(entry => entry.domain === 'external.test');
  assert.equal(view.snapshot.entries.length, 2); assert.notEqual(foreign, -1); assert.equal(view.handles[foreign], null);
  assert.equal(JSON.stringify(view).includes('EXTERNAL_ACCOUNT_CANARY'), false);
});

test('cookie values: exact raw domain and hostOnly reject lookalike replacement cookies', async () => {
  const f = fixture(), view = await f.inspector.read(f.request);
  f.setRows([cookie({ domain: 'example.com', hostOnly: true, value: 'LOOKALIKE_CANARY' })]);
  assertNoValue(await reveal(f, view));
});

test('cookie values: current value changes on the same identity are shown without caching', async () => {
  const f = fixture(), view = await f.inspector.read(f.request);
  f.setRows([cookie({ value: 'CURRENT_VALUE' })]); assert.equal((await reveal(f, view)).value, 'CURRENT_VALUE');
  f.setRows([cookie({ value: 'NEXT_VALUE' })]); assert.equal((await reveal(f, view)).value, 'NEXT_VALUE');
});

test('cookie values: empty and opaque HTML/control strings are returned literally with bounded truncation', async () => {
  const f = fixture(), view = await f.inspector.read(f.request);
  for (const value of ['', '<img src="https://external.test/" onerror="VALUE_CANARY">\u0000\u202e']) { f.setRows([cookie({ value })]); const result = await reveal(f, view); assert.equal(result.value, value); assert.equal(result.truncated, false); }
  f.setRows([cookie({ value: 'x'.repeat(20000) })]); const result = await reveal(f, view); assert.equal(result.value.length, 16384); assert.equal(result.truncated, true);
});

test('cookie values: value accessors and non-string values are refused without coercion', async () => {
  const f = fixture(), view = await f.inspector.read(f.request); let invoked = 0;
  const getter = cookie(); Object.defineProperty(getter, 'value', { get() { invoked++; throw Error('accessor'); } });
  for (const native of [getter, cookie({ value: { toString() { invoked++; throw Error('coercion'); } } }), cookie({ value: undefined })]) { f.setRows([native]); assertNoValue(await reveal(f, view)); }
  assert.equal(invoked, 0);
});

test('cookie values: expired or duplicated native identities do not expose a value', async () => {
  const f = fixture(), view = await f.inspector.read(f.request);
  for (const rows of [[], [cookie(), cookie()]]) { f.setRows(rows); assertNoValue(await reveal(f, view)); }
});

test('cookie values: forged handles and caller-supplied selectors are rejected before native queries', async () => {
  const f = fixture(), view = await f.inspector.read(f.request), before = f.stats().cookieQueries;
  for (const extra of [{ handle: '0'.repeat(32) }, { domain: 'external.test' }, { name: '_ga' }, { url: 'https://external.test/' }, { storeId: 'other-store' }, { tabId: 8, documentKey: '8:0:doc' }]) {
    const result = await f.inspector.values.reveal({ ...f.request, type: 'ui-get-cookie-value', handle: view.handles[0], ...extra }); assertNoValue(result);
  }
  assert.equal(f.stats().cookieQueries, before);
});

for (const mode of ['navigate', 'revoke', 'unconsent', 'pause', 'changeStore', 'epoch', 'generation']) test('cookie values: ' + mode + ' while native query is pending discards result before value inspection', async () => {
  const f = fixture(), view = await f.inspector.read(f.request); let descriptors = 0;
  const native = new Proxy(cookie(), { getOwnPropertyDescriptor(target, key) { if (key === 'value') descriptors++; return Reflect.getOwnPropertyDescriptor(target, key); } });
  f.runtime.api.cookies.getAll = async () => { if (mode === 'epoch') f.inspector.invalidateSite('example.com'); else if (mode === 'generation') f.runtime.scope.accessGeneration++; else f[mode](); return [native]; };
  assertNoValue(await reveal(f, view)); assert.equal(descriptors, 0); assert.equal(f.runtime.apiResults.operations.size, 0);
});

test('cookie values: selected child retains its identity but changed top document blocks reveal', async () => {
  const f = fixture(), request = f.selectChild(), view = await f.inspector.read(request);
  f.runtime.api.cookies.getAll = async () => { f.navigateTop(); return [cookie()]; };
  assertNoValue(await reveal(f, view, 0, request));
});

test('cookie values: permission lost during final contains check does not inspect the value', async () => {
  const f = fixture(), view = await f.inspector.read(f.request); let checks = 0, descriptors = 0;
  const native = new Proxy(cookie(), { getOwnPropertyDescriptor(target, key) { if (key === 'value') descriptors++; return Reflect.getOwnPropertyDescriptor(target, key); } });
  f.runtime.api.cookies.getAll = async () => [native];
  f.runtime.api.permissions.contains = async () => ++checks < 2;
  assertNoValue(await reveal(f, view)); assert.equal(descriptors, 0);
});

test('cookie values: refreshed inventory, clear and forget invalidate older capabilities', async () => {
  for (const mode of ['refresh', 'clear', 'forget']) {
    const f = fixture(), view = await f.inspector.read(f.request);
    if (mode === 'refresh') await f.inspector.read(f.request); else if (mode === 'clear') f.inspector.clear(); else f.inspector.forget(f.request.documentKey);
    const before = f.stats().cookieQueries; assertNoValue(await reveal(f, view)); assert.equal(f.stats().cookieQueries, before);
  }
});

test('cookie values: 60 second TTL rejects handles before any API query and frees retained identity memory', async () => {
  const f = fixture(), view = await f.inspector.read(f.request); f.advance(60000);
  const before = f.stats().cookieQueries; assertNoValue(await reveal(f, view)); assert.equal(f.stats().cookieQueries, before); assert.equal(f.inspector.values.handles.size, 0); assert.equal(f.inspector.values.identityBytes, 0);
});

test('cookie values: global count and identity-memory budgets leave null capabilities rather than overflow', async () => {
  const f = fixture(), snapshot = { entries: new Array(256).fill({}) }, identity = cookieValueIdentity(cookie({ name: 'a'.repeat(1000), path: '/' + 'p'.repeat(500) }), 'test-store', 'https://example.com');
  const context = { topRequest: f.request, partitionSite: 'https://example.com', site: 'example.com' };
  const view = f.inspector.values.createView(f.request, snapshot, new Array(256).fill(identity), context);
  assert.ok(view.handles.some(handle => handle === null)); assert.ok(f.inspector.values.handles.size <= 512); assert.ok(f.inspector.values.identityBytes <= 131072);
  f.inspector.values.invalidate();
  const short = cookieValueIdentity(cookie({ name: 'a' }), 'test-store', 'https://example.com');
  for (let index = 0; index < 4; index++) f.inspector.values.createView({ ...f.request, documentKey: '7:0:doc' + index }, snapshot, new Array(256).fill(short), context);
  assert.ok(f.inspector.values.handles.size <= 512); assert.ok(f.inspector.values.identityBytes <= 131072);
});

test('cookie values: two pending reveals remain bounded and a third performs no API work', async () => {
  const f = fixture(), view = await f.inspector.read(f.request), releases = [];
  f.runtime.api.cookies.getAll = () => new Promise(resolve => { releases.push(resolve); });
  const first = reveal(f, view), second = reveal(f, view);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.inspector.values.operations.size, 2); assertNoValue(await reveal(f, view));
  f.inspector.values.invalidate(); for (const release of releases) release([cookie()]);
  const results = await Promise.all([first, second]); assert.ok(results.every(result => result.type === 'error')); assert.equal(f.inspector.values.operations.size, 0);
});

test('cookie values: timed-out physical value queries remain bounded until their native promises settle', async () => {
  const f = fixture(), view = await f.inspector.read(f.request), releases = [];
  f.runtime.api.cookies.getAll = () => new Promise(resolve => { releases.push(resolve); });
  const results = await Promise.all([reveal(f, view), reveal(f, view)]);
  assert.ok(results.every(result => result.type === 'error')); assert.equal(f.inspector.values.operations.size, 0); assert.equal(f.inspector.values.physicalQueries.size, 2);
  assertNoValue(await reveal(f, view)); assert.equal(releases.length, 2);
  for (const release of releases) release([cookie()]); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.inspector.values.physicalQueries.size, 0);
});

test('cookie values: identity accessors and foreign partitions are never accepted for a handle', () => {
  let invoked = 0;
  const partition = { topLevelSite: 'https://example.com' }; Object.defineProperty(partition, 'hasCrossSiteAncestor', { get() { invoked++; return false; } });
  const native = cookie(); Object.defineProperty(native, 'partitionKey', { get() { invoked++; return partition; } });
  for (const row of [native, cookie({ partitionKey: partition }), cookie({ partitionKey: { topLevelSite: 'https://other.test' } }), cookie({ storeId: 'other-store' })]) assert.equal(cookieValueIdentity(row, 'test-store', 'https://example.com'), null);
  assert.equal(invoked, 0);
});
