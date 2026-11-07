import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserDebugDataDriver } from '../../apps/production-extension/browser-debug-data.js';

const clone = value => structuredClone(value);
const code = expected => error => error?.code === expected;
function fixture(overrides = {}, browser = 'chrome') {
  let active = true;
  const calls = [], api = { runtime: { id: 'self' }, ...overrides };
  const driver = createBrowserDebugDataDriver({ api, env: globalThis, browser,
    check() { if (!active) { const error = new Error('inactive'); error.code = 'inactive'; throw error; } },
    async call(target, method, args) { calls.push({ namespace: Object.keys(api).find(key => api[key] === target), method, args: clone(args) }); return Reflect.apply(target[method], target, args); }
  });
  return { driver, calls, api, stop() { active = false; } };
}
const cookie = patch => Object.defineProperty({ name: 'session', domain: 'www.example.test', path: '/', storeId: '0', secure: true, httpOnly: true, hostOnly: true, session: true, sameSite: 'lax', ...patch }, 'value', {
  get() { throw new Error('COOKIE_VALUE_MUST_NEVER_BE_READ'); }, enumerable: true
});
const bookmark = patch => ({ id: 'b1', title: 'Saved', url: 'https://example.test/', parentId: 'folder', dateAdded: 12, ...patch });
const extension = patch => ({ id: 'other', name: 'Other', version: '1', type: 'extension', installType: 'normal', enabled: true, mayDisable: true, ...patch });

test('read projection is detached, bounded, and unsupported APIs fail explicitly', async () => {
  const source = Array.from({ length: 201 }, (_, index) => ({ url: `https://example.test/${index}`, title: `Title ${index}`, lastVisitTime: index, visitCount: 1, hiddenNative: 'excluded' }));
  const f = fixture({ history: { search: async () => source, deleteUrl: async () => {} } });
  const result = await f.driver.read('history');
  assert.equal(result.records.length, 200); assert.equal(result.truncated, true);
  assert.deepEqual(f.calls[0].args, [{ text: '', startTime: 0, maxResults: 201 }]);
  source[0].title = 'Changed'; source[0].visitCount = 500;
  assert.equal(result.records[0].values.title, 'Title 0'); assert.equal(result.records[0].reference.visitCount, 1);
  assert.equal(JSON.stringify(result).includes('hiddenNative'), false);
  assert.equal(f.driver.supports('cookies'), false);
  await assert.rejects(f.driver.read('cookies'), code('unsupported'));
});

test('history create passes only native URL and rejects fabricated time, credentials, and accessor patches', async () => {
  const f = fixture({ history: { search: async () => [], addUrl: async () => {} } });
  assert.deepEqual(f.driver.describe('history', 'create', null).fields.map(field => field.key), ['url']);
  await f.driver.write('history', 'create', null, { url: 'https://example.test/new' });
  assert.deepEqual(f.calls, [{ namespace: 'history', method: 'addUrl', args: [{ url: 'https://example.test/new' }] }]);
  f.calls.length = 0;
  for (const patch of [{ url: 'https://example.test/', visitTime: 1 }, { url: 'javascript:alert(1)' }, { url: 'https://user:password@example.test/' }, {}]) {
    await assert.rejects(f.driver.write('history', 'create', null, patch), code('invalid-input'));
  }
  const accessor = Object.defineProperty({}, 'url', { get() { throw new Error('accessor-read'); }, enumerable: true });
  await assert.rejects(f.driver.write('history', 'create', null, accessor), code('invalid-input'));
  assert.equal(f.calls.length, 0);
});

test('history deletion revalidates URL visit metadata and never fabricates individual visits', async () => {
  const item = { url: 'https://example.test/', title: 'x', lastVisitTime: 10, visitCount: 2 };
  const f = fixture({ history: { search: async () => [item], deleteUrl: async () => {} } });
  const ref = (await f.driver.read('history')).records[0].reference;
  item.visitCount++;
  await assert.rejects(f.driver.write('history', 'remove', ref, {}), code('stale-record'));
  assert.equal(f.calls.some(call => call.method === 'deleteUrl'), false);
  item.visitCount--;
  await f.driver.write('history', 'remove', ref, {});
  assert.deepEqual(f.calls.at(-1).args, [{ url: ref.url }]);
});

test('bookmarks expose only nonfolder mutable records; edit preserves omitted title and verifies native result', async () => {
  let item = bookmark();
  const f = fixture({ bookmarks: {
    getRecent: async () => [item, bookmark({ id: 'folder', url: undefined }), bookmark({ id: 'managed', unmodifiable: 'managed' }), bookmark({ id: 'root', parentId: undefined })],
    get: async id => id === item.id ? [item] : [],
    update: async (id, patch) => { assert.equal(id, item.id); item = { ...item, ...patch }; }, move: async () => {}, remove: async () => {}
  } });
  const records = (await f.driver.read('bookmarks')).records;
  assert.deepEqual(records.map(row => row.actions), [['edit', 'move', 'remove'], [], [], []]);
  await f.driver.write('bookmarks', 'edit', records[0].reference, { url: 'https://example.test/changed' });
  assert.equal(item.title, 'Saved'); assert.equal(item.url, 'https://example.test/changed');
  await assert.rejects(f.driver.write('bookmarks', 'edit', records[0].reference, { url: 'https://example.test/again' }), code('stale-record'));
  assert.equal(f.calls.filter(call => call.method === 'update').length, 1);
  assert.throws(() => f.driver.describe('bookmarks', 'remove', records[1].reference), code('unsupported'));
});

test('bookmark move is one mutation and rejects selected record drift during destination validation', async () => {
  let item = bookmark(), changeDuringParent = false;
  const f = fixture({ bookmarks: {
    getRecent: async () => [item],
    get: async id => { if (id === 'destination') { if (changeDuringParent) item = { ...item, url: 'https://example.test/replaced' }; return [{ id, parentId: 'root', title: 'Folder' }]; } return id === item.id ? [item] : [{ id, title: 'Root' }]; },
    move: async (id, patch) => { item = { ...item, ...patch }; }, remove: async () => {}, update: async () => {}
  } });
  let ref = (await f.driver.read('bookmarks')).records[0].reference;
  await f.driver.write('bookmarks', 'move', ref, { parentId: 'destination' });
  assert.equal(item.parentId, 'destination');
  assert.deepEqual(f.calls.filter(call => ['move', 'update', 'remove'].includes(call.method)).map(call => call.method), ['move']);
  ref = (await f.driver.read('bookmarks')).records[0].reference; changeDuringParent = true;
  await assert.rejects(f.driver.write('bookmarks', 'move', ref, { parentId: 'destination' }), code('stale-record'));
  assert.equal(f.calls.filter(call => call.method === 'move').length, 1);
  await assert.rejects(f.driver.write('bookmarks', 'move', ref, { parentId: 'destination', url: 'https://other.test/' }), code('invalid-input'));
});

test('bookmark creation validates destination folder and never allows root or recursive removal', async () => {
  const f = fixture({ bookmarks: { getRecent: async () => [], get: async id => [{ id, title: 'root' }], create: async value => ({ id: 'new', ...value }) } });
  await assert.rejects(f.driver.write('bookmarks', 'create', null, { url: 'https://example.test/', parentId: 'root' }), code('invalid-input'));
  assert.equal(f.calls.some(call => call.method === 'create'), false);
  await f.driver.write('bookmarks', 'create', null, { url: 'https://example.test/', title: '', parentId: '' });
  assert.deepEqual(f.calls.at(-1).args, [{ url: 'https://example.test/', title: '' }]);
  assert.throws(() => f.driver.describe('bookmarks', 'removeTree', bookmark()), code('unsupported'));
});

test('download actions revalidate state and erase only the selected history record', async () => {
  let item = { id: 3, url: 'https://example.test/file', filename: 'C:\\Users\\Private\\file.txt', state: 'in_progress', paused: false, canResume: false, bytesReceived: 1, totalBytes: 10 };
  const f = fixture({ downloads: { search: async () => [item], pause: async () => { item = { ...item, paused: true, canResume: true }; }, resume: async () => {}, cancel: async () => {}, erase: async query => [query.id], removeFile: async () => { throw new Error('FORBIDDEN'); }, open: async () => { throw new Error('FORBIDDEN'); } } });
  const row = (await f.driver.read('downloads')).records[0];
  assert.equal(row.values.name, 'file.txt'); assert.equal(JSON.stringify(row).includes('Private'), false);
  assert.deepEqual(row.actions, ['pause', 'cancel', 'erase']);
  await f.driver.write('downloads', 'pause', row.reference, {});
  await assert.rejects(f.driver.write('downloads', 'cancel', row.reference, {}), code('stale-record'));
  const paused = (await f.driver.read('downloads')).records[0]; assert.deepEqual(paused.actions, ['resume', 'cancel', 'erase']);
  await f.driver.write('downloads', 'erase', paused.reference, {});
  assert.deepEqual(f.calls.at(-1).args, [{ id: 3 }]);
  assert.throws(() => f.driver.describe('downloads', 'removeFile', paused.reference), code('unsupported'));
  assert.equal(f.calls.some(call => call.method === 'removeFile' || call.method === 'open'), false);
});

test('cookie reads require explicit origin, include parent domains/deep paths/partitions, and never read values', async () => {
  const host = cookie({ path: '/account/deep' }), parent = cookie({ name: 'parent', domain: '.example.test', hostOnly: false, partitionKey: { topLevelSite: 'https://partition.test', hasCrossSiteAncestor: true } }), sibling = cookie({ name: 'sibling', domain: 'other.example.test' });
  const f = fixture({ cookies: { getAll: async details => details.domain === 'www.example.test' ? [host, sibling] : [parent, host], get: async () => host, remove: async () => ({ name: host.name, storeId: host.storeId }) } });
  await assert.rejects(f.driver.read('cookies'), code('invalid-input'));
  assert.equal(f.calls.length, 0);
  const result = await f.driver.read('cookies', { origin: 'https://www.example.test/settings' });
  assert.equal(result.records.length, 2); assert.equal(result.truncated, false);
  assert.deepEqual(result.records.map(row => row.values.name), ['session', 'parent']);
  assert.deepEqual(f.calls.map(call => call.args[0]), [{ domain: 'www.example.test', partitionKey: {} }, { domain: 'example.test', partitionKey: {} }]);
  assert.equal(JSON.stringify(result).includes('"value"'), false);
  assert.equal(result.records[0].reference.path, '/account/deep'); assert.equal(result.records[1].reference.partitionKey.topLevelSite, 'https://partition.test');
  assert.equal(result.records[0].values.storeId, host.storeId); assert.equal(result.records[1].values.partitionTopLevelSite, 'https://partition.test'); assert.equal(result.records[1].values.hasCrossSiteAncestor, true);
});

test('Firefox unpartitioned native null partitionKey remains visible and removable without reading a value', async () => {
  const item = cookie({ partitionKey: null, firstPartyDomain: '' });
  const f = fixture({ cookies: { getAll: async () => [item], get: async () => item, remove: async () => ({ name: item.name, storeId: item.storeId }) } }, 'firefox');
  const result = await f.driver.read('cookies', { origin: 'https://www.example.test' });
  assert.equal(result.records.length, 1); assert.equal(result.records[0].values.partitionTopLevelSite, null); assert.equal(result.records[0].values.firstPartyDomain, '');
  await f.driver.write('cookies', 'remove', result.records[0].reference, {});
  assert.equal(f.calls.at(-1).method, 'remove'); assert.equal(Object.hasOwn(f.calls.at(-1).args[0], 'partitionKey'), false); assert.equal(f.calls.at(-1).args[0].firstPartyDomain, '');
});

test('cookie native removal checks exact path/store/partition winner before deleting', async () => {
  const selected = cookie({ path: '/private/deep', storeId: 'profile', partitionKey: { topLevelSite: 'https://partition.test', hasCrossSiteAncestor: false } });
  let winner = selected;
  const f = fixture({ cookies: { getAll: async () => [selected], get: async () => winner, remove: async () => ({ name: selected.name, storeId: selected.storeId }) } });
  const ref = (await f.driver.read('cookies', { origin: 'https://www.example.test/' })).records[0].reference;
  winner = cookie({ ...Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(selected)).filter(([key]) => key !== 'value').map(([key, descriptor]) => [key, descriptor.value])), path: '/private/deep/other' });
  await assert.rejects(f.driver.write('cookies', 'remove', ref, {}), code('stale-record'));
  assert.equal(f.calls.some(call => call.method === 'remove'), false);
  winner = selected;
  await f.driver.write('cookies', 'remove', ref, {});
  assert.deepEqual(f.calls.at(-1).args, [{ url: 'https://www.example.test/private/deep', name: 'session', storeId: 'profile', partitionKey: { topLevelSite: 'https://partition.test', hasCrossSiteAncestor: false } }]);
  assert.equal(f.calls.some(call => call.method === 'set'), false);
});

test('cookie normalization ambiguities and stale metadata fail closed without remove', async () => {
  let selected = cookie({ path: '/a/../b' });
  const f = fixture({ cookies: { getAll: async () => [selected], get: async () => selected, remove: async () => { throw new Error('FORBIDDEN'); } } });
  let ref = (await f.driver.read('cookies', { origin: 'https://www.example.test/' })).records[0].reference;
  await assert.rejects(f.driver.write('cookies', 'remove', ref, {}), code('unsupported'));
  selected = cookie({ path: '/normal' }); ref = (await f.driver.read('cookies', { origin: 'https://www.example.test/' })).records[0].reference;
  selected = cookie({ path: '/normal', httpOnly: false });
  await assert.rejects(f.driver.write('cookies', 'remove', ref, {}), code('stale-record'));
  assert.equal(f.calls.some(call => call.method === 'remove'), false);
});

test('cookie scanning and ancestor queries have aggregate limits; localhost is one query', async () => {
  let count = 0;
  const crowded = fixture({ cookies: { getAll: async () => Array.from({ length: 3000 }, (_, index) => ({ get domain() { count++; return 'not-applicable.test'; } })) } });
  const result = await crowded.driver.read('cookies', { origin: 'https://a.b.example.test/' });
  assert.equal(result.truncated, true); assert.equal(count, 2000); assert.equal(crowded.calls.length, 1);
  const empty = fixture({ cookies: { getAll: async () => [] } });
  const long = await empty.driver.read('cookies', { origin: 'https://a.b.c.d.e.f.g.h.i.j.test/' });
  assert.equal(long.truncated, true); assert.equal(empty.calls.length, 8);
  empty.calls.length = 0; await empty.driver.read('cookies', { origin: 'http://localhost/' }); assert.equal(empty.calls.length, 1);
});

test('Firefox cookie calls preserve empty first-party domain explicitly and scoped partitions', async () => {
  const selected = cookie({ firstPartyDomain: '', path: '/deep' });
  const f = fixture({ cookies: { getAll: async () => [selected], get: async () => selected, remove: async () => ({ name: selected.name, storeId: selected.storeId }) } }, 'firefox');
  const ref = (await f.driver.read('cookies', { origin: 'https://www.example.test/' })).records[0].reference;
  assert.equal(f.calls[0].args[0].firstPartyDomain, null);
  await f.driver.write('cookies', 'remove', ref, {});
  assert.equal(f.calls.at(-1).args[0].firstPartyDomain, '');
});

test('tab editing pins/mutes only a freshly identical native tab and excludes incognito', async () => {
  let item = { id: 7, windowId: 2, url: 'https://example.test/', title: 'Page', pinned: false, mutedInfo: { muted: false }, incognito: false };
  const f = fixture({ tabs: { query: async () => [item, { ...item, id: 8, incognito: true }], get: async () => item, update: async (id, patch) => { assert.equal(id, 7); item = { ...item, ...patch, mutedInfo: { muted: patch.muted ?? item.mutedInfo.muted } }; } } });
  const result = await f.driver.read('tabs'); assert.equal(result.records.length, 1);
  const ref = result.records[0].reference;
  await f.driver.write('tabs', 'edit', ref, { pinned: true, muted: true });
  assert.deepEqual(f.calls.find(call => call.method === 'update').args, [7, { pinned: true, muted: true }]);
  const next = (await f.driver.read('tabs')).records[0].reference; item = { ...item, pendingUrl: 'https://other.test/' };
  await assert.rejects(f.driver.write('tabs', 'activate', next, {}), code('stale-record'));
  await assert.rejects(f.driver.write('tabs', 'edit', next, { pinned: false, muted: false, url: 'https://other.test/' }), code('invalid-input'));
  assert.equal(f.calls.filter(call => call.method === 'update').length, 1);
});

test('sessions restore only current recent native IDs; synced sessions are read-only', async () => {
  let recent = [{ lastModified: 10, tab: { sessionId: 'closed1', title: 'Closed', url: 'https://example.test/' } }];
  const f = fixture({ sessions: { getRecentlyClosed: async () => recent, getDevices: async () => [{ deviceName: 'Laptop', sessions: [{ lastModified: 11, tab: { sessionId: 'remote', title: 'Remote', url: 'https://remote.test/' } }] }], restore: async () => ({}) } });
  const result = await f.driver.read('sessions');
  assert.deepEqual(result.records.map(row => row.actions), [['restore'], []]);
  assert.equal(result.records[1].reference, null);
  await f.driver.write('sessions', 'restore', result.records[0].reference, {});
  assert.deepEqual(f.calls.at(-1).args, ['closed1']);
  recent = [];
  await assert.rejects(f.driver.write('sessions', 'restore', result.records[0].reference, {}), code('stale-record'));
  assert.equal(f.calls.filter(call => call.method === 'restore').length, 1);
});

test('nested empty synced sessions consume aggregate traversal budget', async () => {
  let reads = 0;
  const empty = Array.from({ length: 4000 }, () => ({ get window() { reads++; return { tabs: [] }; } }));
  const f = fixture({ sessions: { getRecentlyClosed: async () => [], getDevices: async () => [{ deviceName: 'Laptop', sessions: empty }] } });
  const result = await f.driver.read('sessions');
  assert.equal(result.truncated, true); assert.equal(reads, 1999); assert.equal(result.records.length, 0);
});

test('reading list URL is immutable, remove patch is empty, and create never overwrites', async () => {
  let item = { title: 'Saved', url: 'https://example.test/', hasBeenRead: false, creationTime: 1, lastUpdateTime: 2 };
  const f = fixture({ readingList: { query: async details => !details.url || details.url === item?.url ? [item].filter(Boolean) : [], updateEntry: async patch => { item = { ...item, ...patch, lastUpdateTime: 3 }; }, addEntry: async record => { item = record; }, removeEntry: async () => { item = null; } } });
  let ref = (await f.driver.read('reading-list')).records[0].reference;
  await assert.rejects(f.driver.write('reading-list', 'edit', ref, { url: 'https://other.test/', hasBeenRead: true }), code('invalid-input'));
  await assert.rejects(f.driver.write('reading-list', 'create', null, { url: item.url, hasBeenRead: false }), code('stale-record'));
  await f.driver.write('reading-list', 'edit', ref, { hasBeenRead: true }); assert.equal(item.title, 'Saved'); assert.equal(item.hasBeenRead, true);
  ref = (await f.driver.read('reading-list')).records[0].reference;
  await assert.rejects(f.driver.write('reading-list', 'remove', ref, { title: 'unexpected' }), code('invalid-input'));
  await f.driver.write('reading-list', 'remove', ref, {}); assert.equal(item, null);
  await f.driver.write('reading-list', 'create', null, { url: 'https://example.test/new', title: '', hasBeenRead: false }); assert.equal(item.url, 'https://example.test/new');
});

test('extension toggles prohibit self, managed/component, and Firefox non-theme modifications', async () => {
  let items = [extension(), extension({ id: 'self' }), extension({ id: 'admin', installType: 'admin' }), extension({ id: 'component', installType: 'component' }), extension({ id: 'locked', mayDisable: false }), extension({ id: 'theme', type: 'theme' })];
  const f = fixture({ management: { getAll: async () => items, get: async id => items.find(item => item.id === id), setEnabled: async (id, enabled) => { items = items.map(item => item.id === id ? { ...item, enabled } : item); } } });
  let result = await f.driver.read('extensions'); assert.deepEqual(result.records.map(row => row.actions), [['edit'], [], [], [], [], ['edit']]);
  await f.driver.write('extensions', 'edit', result.records[0].reference, { enabled: false });
  assert.deepEqual(f.calls.find(call => call.method === 'setEnabled').args, ['other', false]);
  result = await f.driver.read('extensions'); items[0] = { ...items[0], installType: 'admin' };
  await assert.rejects(f.driver.write('extensions', 'edit', result.records[0].reference, { enabled: true }), code('stale-record'));
  const ff = fixture(f.api, 'firefox'); assert.deepEqual((await ff.driver.read('extensions')).records.map(row => row.actions), [[], [], [], [], [], ['edit']]);
  assert.equal(f.calls.filter(call => call.method === 'setEnabled').length, 1);
});

test('mayEnable false and native postwrite mismatch are reported without false success', async () => {
  let item = extension({ enabled: false, mayEnable: false });
  const f = fixture({ management: { getAll: async () => [item], get: async () => item, setEnabled: async () => {} } });
  let ref = (await f.driver.read('extensions')).records[0].reference;
  await assert.rejects(f.driver.write('extensions', 'edit', ref, { enabled: true }), code('unsupported'));
  assert.equal(f.calls.some(call => call.method === 'setEnabled'), false);
  item = extension({ enabled: false, mayEnable: true }); ref = (await f.driver.read('extensions')).records[0].reference;
  await assert.rejects(f.driver.write('extensions', 'edit', ref, { enabled: true }), code('operation-failed'));
});

test('revocation during a native read prevents any following mutation', async () => {
  let f;
  const item = bookmark();
  f = fixture({ bookmarks: { getRecent: async () => [item], get: async () => { f.stop(); return [item]; }, remove: async () => { throw new Error('FORBIDDEN'); } } });
  const ref = (await f.driver.read('bookmarks')).records[0].reference;
  await assert.rejects(f.driver.write('bookmarks', 'remove', ref, {}), code('inactive'));
  assert.equal(f.calls.some(call => call.method === 'remove'), false);
});

test('top sites are projected without write actions or raw native properties', async () => {
  const f = fixture({ topSites: { get: async () => [{ title: 'Site', url: 'https://example.test/', internal: 'not projected' }] } });
  const result = await f.driver.read('top-sites');
  assert.deepEqual(result.records[0], { values: { title: 'Site', url: 'https://example.test/' }, reference: null, actions: [] });
  assert.throws(() => f.driver.describe('top-sites', 'edit', {}), code('unsupported'));
});
