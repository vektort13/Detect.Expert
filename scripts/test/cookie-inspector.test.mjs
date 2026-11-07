import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CookieInspector } from '../../apps/production-extension/cookie-inspector.js';
import { readCookieSnapshot, readClearCookiesResult } from '../../packages/contracts/src/inspection.mjs';
function fixture() {
  let granted = true, current = '7:0:doc', reads = 0, valueReads = 0;
  const secret = { name: '_ga', domain: 'example.com', path: '/', storeId: 'firefox-container-2', hostOnly: false, secure: true, httpOnly: false, session: false, sameSite: 'lax', expirationDate: 1900000000 };
  Object.defineProperty(secret, 'value', { get() { valueReads++; throw Error('cookie secret accessed'); } });
  const frames = [{ frameId: 0, documentId: 'doc', url: 'https://www.example.com/account?secret=CANARY', documentLifecycle: 'active' }];
  const page = { id: 'page-1', documentKey: current };
  const runtime = {
    now: () => 1700000000000, isReady: true,
    scope: { hasDataConsent: true, accessGeneration: 0, isHostGrantedSync: () => true },
    api: { permissions: { contains: async () => granted }, cookies: { getAllCookieStores: async () => [{ id: 'firefox-container-2', tabIds: [7] }], getAll: async () => { reads++; return [secret]; } }, webNavigation: { getAllFrames: async () => frames } },
    apiResults: { authorize: async request => request.documentKey === current },
    getProjection: () => ({ documentKey: current }),
    canObserveNetworkDocument: key => key === current,
    pro: { session: { pages: [page] }, pageFor: () => page, checkDeadline: () => true, size: () => true, mark() {}, flush: async () => {} },
  };
  const inspector = new CookieInspector(runtime, { host: value => new URL(value).hostname, redact: host => ({ kind: 'registrable', value: host }), site: host => host.replace(/^www\./, '') });
  return { inspector, runtime, page, secret, frames, request: { schemaVersion: 1, type: 'ui-get-cookies', tabId: 7, frameId: 0, documentKey: '7:0:doc' }, revoke: () => { granted = false; }, navigate: () => { current = '7:0:next'; }, stats: () => ({ reads, valueReads }) };
}
test('cookie inspector: missing optional permission performs no cookie query', async () => {
  const f = fixture(); f.revoke();
  const state = await f.inspector.read(f.request);
  assert.equal(state.permission, 'required'); assert.equal(state.entries.length, 0); assert.equal(f.stats().reads, 0);
});
test('cookie inspector: projects metadata, deduplicates partition queries and records same-document Pro', async () => {
  const f = fixture(), queries = [];
  const getAll = f.runtime.api.cookies.getAll;
  f.runtime.api.cookies.getAll = async query => { queries.push(query); return getAll(query); };
  const state = await f.inspector.read(f.request);
  assert.ok(readCookieSnapshot(state), JSON.stringify(state)); assert.equal(state.entries.length, 1);
  assert.equal(f.stats().valueReads, 0); assert.equal(JSON.stringify(state).includes('CANARY'), false);
  assert.ok(queries.every(query => !JSON.stringify(query).includes('CANARY')));
  assert.deepEqual(f.page.cookies, state);
});
test('cookie inspector: protocol header values and cookie headers are never read', async () => {
  const f = fixture(); let reads = 0;
  const header = { name: 'Secure-Session-Registration' }; Object.defineProperty(header, 'value', { get() { reads++; throw Error('secret'); } });
  const cookieHeader = { name: 'Cookie' }; Object.defineProperty(cookieHeader, 'value', { get() { reads++; throw Error('secret'); } });
  f.inspector.observe({ tabId: 7, frameId: 0, documentId: 'doc', url: 'https://www.example.com/account', responseHeaders: [header, cookieHeader] }, 'response');
  const state = await f.inspector.read(f.request);
  assert.equal(Object.hasOwn(state, 'sessionBinding'), false); assert.equal(reads, 0);
  assert.equal(state.entries.length, 1);
});

test('cookie inspector: resource host inventory survives without reading header collections', () => {
  const f = fixture(); let reads = 0;
  const event = { tabId: 7, frameId: 0, documentId: 'doc', url: 'https://third.example.net/pixel' };
  for (const key of ['requestHeaders', 'responseHeaders']) Object.defineProperty(event, key, { get() { ++reads; throw Error('unneeded headers'); } });
  f.inspector.observe(event);
  assert.equal(f.inspector.documents.get('7:0:doc').hosts.get('third.example.net'), 'https');
  assert.equal(reads, 0);
});
test('cookie inspector: missing network identity does not add retired session fields', async () => {
  const f = fixture(); f.runtime.api.__detectExpertCapabilities = { networkDocumentIdentity: false };
  f.inspector.observe({ tabId: 7, frameId: 0, url: 'https://example.com/', responseHeaders: [{ name: 'Secure-Session-Registration', value: 'secret' }] }, 'response');
  assert.equal(Object.hasOwn(await f.inspector.read(f.request), 'sessionBinding'), false);
});
test('cookie inspector: navigation while API read is pending discards result', async () => {
  const f = fixture();
  f.runtime.api.cookies.getAll = async () => { f.navigate(); return [f.secret]; };
  const state = await f.inspector.read(f.request);
  assert.equal(state.entries?.length ?? 0, 0); assert.equal(f.page.cookies, undefined);
});
test('cookie inspector: permission revoked during API read discards metadata and Pro snapshot', async () => {
  const f = fixture(); f.runtime.api.cookies.getAll = async () => { f.revoke(); return [f.secret]; };
  const state = await f.inspector.read(f.request);
  assert.equal(state.permission, 'required'); assert.deepEqual(state.entries, []); assert.equal(f.page.cookies, undefined);
});
test('cookie inspector: clear invalidates an in-flight read and removes retained snapshots', async () => {
  const f = fixture(); f.page.cookies = { documentKey: f.request.documentKey };
  f.runtime.api.cookies.getAll = async () => { f.inspector.clear(); return [f.secret]; };
  const state = await f.inspector.read(f.request);
  assert.equal(state.entries?.length ?? 0, 0); assert.equal(f.page.cookies, undefined);
});
test('cookie inspector: hostile or oversized results remain bounded and omit values', async () => {
  const f = fixture(); f.runtime.api.cookies.getAll = async () => new Array(10000).fill(f.secret);
  const state = await f.inspector.read(f.request);
  assert.equal(state.truncated, true); assert.equal(state.entries.length, 1); assert.equal(f.stats().valueReads, 0);
});
test('cookie inspector: selected tab cookie store is explicit and cannot fall back to another container', async () => {
  const f = fixture(), queries = [];
  f.runtime.api.cookies.getAll = async query => { queries.push(query); return [f.secret]; };
  await f.inspector.read(f.request);
  assert.ok(queries.length); assert.ok(queries.every(query => query.storeId === 'firefox-container-2'));
  f.runtime.api.cookies.getAllCookieStores = async () => [{ id: 'firefox-default', tabIds: [8] }];
  queries.length = 0; assert.equal((await f.inspector.read(f.request)).coverageState, 'unsupported'); assert.equal(queries.length, 0);
});
test('cookie inspector: distinct dynamic names, paths and subdomains retain cookie multiplicity without identifiers', async () => {
  const f = fixture();
  f.runtime.api.cookies.getAll = async () => [{ ...f.secret, name: '_ga_FIRST', path: '/account/PRIVATE_PATH_CANARY' }, { ...f.secret, name: '_ga_SECOND', path: '/account' }, { ...f.secret, name: '_ga_FIRST', path: '/other' }];
  const snapshot = await f.inspector.read(f.request);
  assert.equal(snapshot.entries.length, 3); assert.equal(snapshot.trackingCount, 3); assert.ok(snapshot.entries.every(entry => entry.name === '_ga_*'));
  for (const secret of ['_ga_FIRST', '_ga_SECOND', 'PRIVATE_PATH_CANARY']) assert.equal(JSON.stringify(snapshot).includes(secret), false);
});
test('cookie inspector: unknown cookie name survives metadata projection', async () => {
  const f = fixture(); f.runtime.api.cookies.getAll = async () => [{ ...f.secret, name: 'site-preferences' }];
  const snapshot = await f.inspector.read(f.request); assert.equal(snapshot.entries[0].name, 'site-preferences'); assert.equal(snapshot.trackingCount, 0);
});
for (const change of ['navigate', 'revoke']) test('cookie inspector: ' + change + ' during Pro flush removes the owned snapshot before returning', async () => {
  const f = fixture(); let first = true;
  f.runtime.pro.flush = async () => { if (first) { first = false; f[change](); } };
  const snapshot = await f.inspector.read(f.request); assert.equal(snapshot.entries?.length ?? 0, 0); assert.equal(f.page.cookies, undefined);
});
for (const stage of ['authorize', 'contains']) test('cookie inspector: clear during final ' + stage + ' is checked after the awaited result', async () => {
  const f = fixture(); let armed = false, changed = false;
  f.runtime.pro.flush = async () => { armed = true; };
  const object = stage === 'authorize' ? f.runtime.apiResults : f.runtime.api.permissions;
  const original = object[stage]; object[stage] = async (...args) => { const value = await original(...args); if (armed && !changed) { changed = true; f.inspector.clear(); } return value; };
  const state = await f.inspector.read(f.request); assert.equal(state.entries?.length ?? 0, 0); assert.equal(f.page.cookies, undefined);
});
test('cookie inspector: simultaneous views coalesce the same document and permission epoch', async () => {
  const f = fixture(); const first = f.inspector.read(f.request), second = f.inspector.read(f.request);
  assert.equal(first, second); const [left, right] = await Promise.all([first, second]); assert.deepEqual(left, right);
  assert.equal(f.inspector.pendingReads.size, 0); assert.equal(f.inspector.reads.size, 0);
});

// Native Cookie API stand-in models URL/domain/store/partition filters and path selection.
function clearingFixture() {
  const f = fixture(), cookies = [], queries = [], removals = [];
  let secretReads = 0;
  f.page.url = 'https://www.example.com/account'; f.runtime.pro.session.siteKey = 'example.com';
  f.inspector.helpers.site = host => host === 'example.com' || host.endsWith('.example.com') ? 'example.com' : host === 'other.test' ? 'other.test' : null;
  const add = fields => {
    const cookie = { ...f.secret, ...fields };
    Object.defineProperty(cookie, 'value', { get() { ++secretReads; throw Error('private value'); } });
    cookies.push(cookie); return cookie;
  };
  const samePartition = (cookie, query) => (cookie.partitionKey?.topLevelSite ?? '') === (query.partitionKey?.topLevelSite ?? '') && (cookie.partitionKey?.hasCrossSiteAncestor ?? false) === (query.partitionKey?.hasCrossSiteAncestor ?? false);
  const matches = (cookie, query) => {
    const domain = cookie.domain.replace(/^\./, '');
    if (cookie.storeId !== query.storeId || !samePartition(cookie, query)) return false;
    if (query.domain && domain !== query.domain && !domain.endsWith('.' + query.domain)) return false;
    if (query.name !== undefined && query.name !== cookie.name) return false;
    if (query.url) {
      const url = new URL(query.url);
      if (cookie.secure && url.protocol !== 'https:') return false;
      if (cookie.hostOnly ? url.hostname !== domain : url.hostname !== domain && !url.hostname.endsWith('.' + domain)) return false;
      if (url.pathname !== cookie.path && !(url.pathname.startsWith(cookie.path) && (cookie.path.endsWith('/') || url.pathname[cookie.path.length] === '/'))) return false;
    }
    return true;
  };
  f.runtime.api.cookies.getAll = async query => { queries.push(query); return cookies.filter(cookie => matches(cookie, query)).sort((a, b) => b.path.length - a.path.length); };
  f.runtime.api.cookies.remove = async query => {
    removals.push(query);
    const cookie = cookies.filter(cookie => matches(cookie, query)).sort((a, b) => b.path.length - a.path.length)[0];
    if (!cookie) return null;
    cookies.splice(cookies.indexOf(cookie), 1); return cookie;
  };
  return { ...f, add, cookies, queries, removals, clearRequest: { ...f.request, type: 'ui-clear-site-cookies' }, secretReads: () => secretReads };
}

test('cookie inventory: counts all unique same-site paths/subdomains before the display limit', async () => {
  const f = clearingFixture();
  for (let index = 0; index < 300; ++index) f.add({ name: '_ga_' + index, path: '/account/' + index, domain: index % 2 ? 'api.example.com' : '.example.com' });
  const state = await f.inspector.read(f.request);
  assert.ok(readCookieSnapshot(state)); assert.equal(state.totalCount, 300); assert.equal(state.siteCount, 300);
  assert.ok(state.entries.length <= 256); assert.equal(state.truncated, true);
  assert.equal(state.trackingCount, state.entries.filter(row => row.tracking).length);
  assert.equal(f.secretReads(), 0); assert.ok(f.queries.every(query => query.partitionKey === undefined || query.partitionKey.topLevelSite === 'https://example.com'));
});

test('cookie inventory: observed external service increases total but not site count', async () => {
  const f = clearingFixture(); f.add({ name: '_ga' }); f.add({ name: '_fbp', domain: 'facebook.com' });
  f.inspector.observe({ tabId: 7, frameId: 0, documentId: 'doc', url: 'https://facebook.com/sdk.js' }, 'response');
  const state = await f.inspector.read(f.request);
  assert.equal(state.totalCount, 2); assert.equal(state.siteCount, 1); assert.equal(state.trackingCount, 2);
});

test('cookie clear: removes same-site Secure/HttpOnly, subdomains, paths and current partition only', async () => {
  const f = clearingFixture();
  f.add({ name: 'auth', httpOnly: true, secure: true, path: '/account/CLEAR_PATH_CANARY' });
  f.add({ name: 'same-name', path: '/' }); f.add({ name: 'same-name', path: '/account' });
  f.add({ name: 'subdomain', domain: 'api.example.com', hostOnly: true });
  f.add({ name: 'current-chip', partitionKey: { topLevelSite: 'https://example.com', hasCrossSiteAncestor: false } });
  f.add({ name: 'foreign-chip', partitionKey: { topLevelSite: 'https://other.test' } });
  f.add({ name: 'foreign-service', domain: 'facebook.com' });
  f.add({ name: 'sibling-site', domain: 'example.com.evil.test' });
  f.add({ name: 'other-container', storeId: 'firefox-default' });
  f.page.cookies = { documentKey: f.request.documentKey };
  const result = await f.inspector.clearSite(f.clearRequest);
  assert.ok(readClearCookiesResult(result), JSON.stringify(result)); assert.equal(result.removedCount, 5); assert.equal(result.failedCount, 0); assert.equal(result.truncated, false);
  assert.deepEqual(f.cookies.map(cookie => cookie.name).sort(), ['foreign-chip', 'foreign-service', 'other-container', 'sibling-site'].sort());
  assert.equal(f.page.cookies, undefined); assert.equal(f.secretReads(), 0);
  assert.ok(f.queries.every(query => query.domain === 'example.com' && query.storeId === 'firefox-container-2'));
  assert.deepEqual(f.removals.map(row => new URL(row.url).pathname.length), [...f.removals].map(row => new URL(row.url).pathname.length).sort((a, b) => b - a));
  for (const raw of ['auth', 'CLEAR_PATH_CANARY', 'firefox-container-2', 'current-chip']) assert.equal(JSON.stringify(result).includes(raw), false);
});

test('cookie clear: no optional permission, no consent or wrong native store performs no query/removal', async () => {
  for (const mode of ['permission', 'consent', 'store']) {
    const f = clearingFixture(); f.add({ name: 'auth' });
    if (mode === 'permission') f.revoke();
    if (mode === 'consent') f.runtime.scope.hasDataConsent = false;
    if (mode === 'store') f.runtime.api.cookies.getAllCookieStores = async () => [{ id: 'foreign-container', tabIds: [8] }];
    const result = await f.inspector.clearSite(f.clearRequest);
    assert.equal(result.type, 'error'); assert.equal(f.queries.length, 0); assert.equal(f.removals.length, 0);
  }
});

for (const change of ['navigate', 'revoke']) test('cookie clear: ' + change + ' while collection is pending prevents deletion', async () => {
  const f = clearingFixture(); f.add({ name: 'auth' });
  const native = f.runtime.api.cookies.getAll;
  f.runtime.api.cookies.getAll = async query => { const rows = await native(query); f[change](); return rows; };
  const result = await f.inspector.clearSite(f.clearRequest);
  assert.equal(result.truncated, true); assert.equal(result.removedCount, 0); assert.equal(f.removals.length, 0);
});

test('cookie clear: generation/store transition immediately before native deletion stops it', async () => {
  for (const mode of ['generation', 'store']) {
    const f = clearingFixture(); f.add({ name: 'auth' });
    let armed = false;
    const getAll = f.runtime.api.cookies.getAll;
    f.runtime.api.cookies.getAll = async query => { const rows = await getAll(query); if (query.partitionKey) armed = true; return rows; };
    const native = f.runtime.api.cookies.getAllCookieStores;
    f.runtime.api.cookies.getAllCookieStores = async () => { const stores = await native(); if (armed) { if (mode === 'generation') ++f.runtime.scope.accessGeneration; else stores[0].id = 'foreign-container'; } return stores; };
    assert.equal((await f.inspector.clearSite(f.clearRequest)).removedCount, 0); assert.equal(f.removals.length, 0);
  }
});

test('cookie clear: child selection must also authorize unchanged top document', async () => {
  const f = clearingFixture(); f.add({ name: 'auth' });
  f.clearRequest.frameId = 2; f.clearRequest.documentKey = '7:2:child';
  f.runtime.getProjection = (_, frame) => ({ documentKey: frame === 2 ? '7:2:child' : '7:0:doc' });
  f.frames.push({ frameId: 2, documentId: 'child', url: 'https://facebook.com/embed' });
  const calls = []; f.runtime.apiResults.authorize = async request => { calls.push(request.documentKey); return request.documentKey === '7:2:child'; };
  assert.equal((await f.inspector.clearSite(f.clearRequest)).type, 'error'); assert.equal(f.removals.length, 0); assert.ok(calls.includes('7:0:doc'));
});

test('cookie clear: unknown domains are exact-host scoped without invented registrable relation', async () => {
  const f = clearingFixture(); f.frames[0].url = 'http://localhost/'; f.runtime.pro.session.siteKey = 'localhost';
  f.add({ name: 'own', domain: 'localhost', secure: false }); f.add({ name: 'other-host', domain: 'evil.localhost', secure: false });
  const result = await f.inspector.clearSite(f.clearRequest);
  assert.equal(result.removedCount, 1); assert.deepEqual(f.cookies.map(cookie => cookie.name), ['other-host']);
});

test('cookie clear: hostile optional identity accessors and URL-changing paths never invoke deletion', async () => {
  const f = clearingFixture(); let accessorReads = 0;
  const malicious = f.add({ name: 'hostile' }); Object.defineProperty(malicious, 'partitionKey', { get() { ++accessorReads; throw Error('partition getter'); } });
  for (const path of ['/account?token=CANARY', '/account#CANARY', '/account/../CANARY']) f.add({ name: 'path-cookie', path });
  f.runtime.api.cookies.getAll = async () => f.cookies;
  const result = await f.inspector.clearSite(f.clearRequest);
  assert.equal(result.removedCount, 0); assert.equal(result.truncated, true); assert.equal(f.removals.length, 0); assert.equal(accessorReads, 0); assert.equal(f.secretReads(), 0);
});

test('cookie clear: in-flight old inventory cannot recreate cleared Pro snapshot', async () => {
  const f = clearingFixture(); f.add({ name: 'auth' }); let release, started;
  const pending = new Promise(resolve => { started = resolve; }); const native = f.runtime.api.cookies.getAll;
  let first = true;
  f.runtime.api.cookies.getAll = async query => { if (first) { first = false; started(); await new Promise(resolve => { release = resolve; }); } return native(query); };
  const oldRead = f.inspector.read(f.request); await pending;
  const clear = await f.inspector.clearSite(f.clearRequest); assert.equal(clear.removedCount, 1);
  release(); await oldRead; assert.equal(f.page.cookies, undefined);
});

test('cookie clear: concurrent clear and inventory are refused while deletion is unresolved', async () => {
  const f = clearingFixture(); f.add({ name: 'auth' }); let release, notify;
  const started = new Promise(resolve => { notify = resolve; });
  f.runtime.api.cookies.remove = () => { notify(); return new Promise(resolve => { release = resolve; }); };
  const first = f.inspector.clearSite(f.clearRequest); await started;
  assert.equal((await f.inspector.clearSite(f.clearRequest)).code, 'busy'); assert.equal((await f.inspector.read(f.request)).code, 'busy');
  release({ name: 'auth', storeId: 'firefox-container-2' }); assert.equal((await first).removedCount, 1);
});

test('cookie clear: timeout stops future deletions and retains the physical-operation guard', async () => {
  const f = clearingFixture(); f.add({ name: 'first' }); f.add({ name: 'second' }); let calls = 0, release;
  f.runtime.api.cookies.remove = () => { ++calls; return new Promise(resolve => { release = resolve; }); };
  const state = await f.inspector.clearSite(f.clearRequest);
  assert.equal(state.failedCount, 1); assert.equal(state.truncated, true); assert.equal(calls, 1); assert.equal(f.inspector.physicalRemoves.size, 1);
  assert.equal((await f.inspector.clearSite(f.clearRequest)).code, 'busy');
  release({ name: 'first', storeId: 'firefox-container-2' }); await new Promise(resolve => setImmediate(resolve)); assert.equal(f.inspector.physicalRemoves.size, 0);
});

test('cookie clear: mismatched native removal result is counted as a failure without accessing value', async () => {
  const f = clearingFixture(); f.add({ name: 'auth' }); let reads = 0;
  f.runtime.api.cookies.remove = async () => { const result = { name: 'different', storeId: 'firefox-container-2' }; Object.defineProperty(result, 'value', { get() { ++reads; throw Error('value'); } }); return result; };
  const state = await f.inspector.clearSite(f.clearRequest); assert.equal(state.removedCount, 0); assert.equal(state.failedCount, 1); assert.equal(reads, 0);
});

test('cookie clear: changed top document while a selected child stays live prevents deletion', async () => {
  const f = clearingFixture(); f.add({ name: 'auth' });
  f.clearRequest.frameId = 2; f.clearRequest.documentKey = '7:2:child';
  f.frames.push({ frameId: 2, documentId: 'child', url: 'https://facebook.com/embed' });
  f.runtime.getProjection = (_, frame) => ({ documentKey: frame === 2 ? '7:2:child' : '7:0:' + f.frames[0].documentId });
  f.runtime.apiResults.authorize = async request => request.documentKey === f.runtime.getProjection(7, request.frameId).documentKey;
  const native = f.runtime.api.cookies.getAll;
  f.runtime.api.cookies.getAll = async query => { const result = await native(query); f.frames[0].documentId = 'next-top'; return result; };
  const state = await f.inspector.clearSite(f.clearRequest); assert.equal(state.removedCount, 0); assert.equal(state.truncated, true); assert.equal(f.removals.length, 0);
});

test('cookie inventory: large raw identity strings exhaust bounded memory with honest lower-bound counts', async () => {
  const f = clearingFixture();
  for (let index = 0; index < 100; ++index) f.add({ name: 'long-' + index + 'X'.repeat(4000) });
  const state = await f.inspector.read(f.request);
  assert.equal(state.truncated, true); assert.ok(state.totalCount > 0 && state.totalCount < 100); assert.equal(state.siteCount, state.totalCount); assert.equal(f.secretReads(), 0);
});

test('cookie inventory: ambiguous selected native cookie stores perform no query', async () => {
  const f = clearingFixture(); f.add({ name: 'auth' });
  f.runtime.api.cookies.getAllCookieStores = async () => [{ id: 'first', tabIds: [7] }, { id: 'second', tabIds: [7] }];
  const state = await f.inspector.read(f.request);
  assert.equal(state.coverageState, 'unsupported'); assert.equal(state.totalCount, 0); assert.equal(f.queries.length, 0);
});

for (const host of ['localhost', '127.0.0.1']) test('cookie inventory: valid native ' + host + ' identities count before display projection', async () => {
  const f = clearingFixture(); f.frames[0].url = 'http://' + host + '/';
  f.add({ name: 'local-pref', domain: host, secure: false });
  const state = await f.inspector.read(f.request);
  assert.ok(readCookieSnapshot(state)); assert.equal(state.totalCount, 1); assert.equal(state.siteCount, 1);
  assert.equal(state.entries.length, 0); assert.equal(state.truncated, true); assert.equal(f.secretReads(), 0);
});
