import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBrowserDebugController, exportBrowserDebugSnapshot } from '../../apps/production-extension/browser-debug-controller.js';
import { BROWSER_DEBUG_CHROME_OPTIONAL, BrowserDebugError } from '../../apps/production-extension/browser-debug-shared.js';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture({ granted = true, deadline = 5000 } = {}) {
  const events = new Set(), invalidations = [], calls = [], records = new Map();
  let permission = granted;
  const env = { location: { href: 'chrome-extension://owned/options.html#browser-debug' }, navigator: { userAgent: 'Own browser', language: 'ru' } }; env.top = env;
  const api = {
    runtime: { id: 'owned', getURL: name => 'chrome-extension://owned/' + name, getManifest: () => ({ version: '1.1.0', permissions: [], optional_permissions: [...BROWSER_DEBUG_CHROME_OPTIONAL] }) },
    permissions: { contains: async () => permission, request: input => { calls.push(['request', input]); permission = true; return Promise.resolve(true); }, onRemoved: { addListener: fn => events.add(fn), removeListener: fn => events.delete(fn) } },
    bookmarks: {
      getRecent: async () => [...records.values()].map(item => ({ ...item })),
      get: async id => records.has(id) ? [{ ...records.get(id) }] : [],
      create: async input => { calls.push(['create', input]); const item = { ...input, id: String(records.size + 1), parentId: 'root', dateAdded: 1 }; records.set(item.id, item); return { ...item }; },
      update: async (id, patch) => { calls.push(['update', id, patch]); records.set(id, { ...records.get(id), ...patch }); return { ...records.get(id) }; },
      remove: async id => { calls.push(['remove', id]); records.delete(id); },
    },
  };
  records.set('1', { id: '1', parentId: 'root', title: 'Owned', url: 'https://example.test/path?private=token#fragment', dateAdded: 1 });
  const controller = createBrowserDebugController(api, { env, deadline, onInvalidate: event => invalidations.push(event) });
  return { env, api, controller, events, invalidations, calls, records, revoke() { permission = false; for (const event of events) event({ permissions: ['bookmarks'] }); } };
}
const rejects = (promise, code) => assert.rejects(promise, error => error instanceof BrowserDebugError && error.code === code);

test('no data API reads on construction/access; request dispatch remains synchronous and native namespaces may appear after grant', async () => {
  const f = fixture({ granted: false }); let reads = 0;
  const bookmarks = f.api.bookmarks; f.api.bookmarks = undefined;
  assert.equal((await f.controller.access('bookmarks')).status, 'permission-required');
  const request = f.controller.grant('bookmarks'); assert.equal(f.calls[0][0], 'request'); await request;
  f.api.bookmarks = { ...bookmarks, getRecent: async () => { reads++; return []; } };
  assert.equal((await f.controller.access('bookmarks')).status, 'ready'); assert.equal(reads, 0);
  await f.controller.load('bookmarks'); assert.equal(reads, 1); f.controller.dispose();
});
test('exact own Options top-level boundary rejects websites, other extension pages and frames before dispatch', async () => {
  for (const href of ['https://example.test/options.html', 'chrome-extension://other/options.html', 'chrome-extension://owned/popup.html', 'chrome-extension://owned/options.html/extra']) {
    const f = fixture(); f.env.location.href = href;
    await rejects(f.controller.load('bookmarks'), 'unauthorized'); await rejects(f.controller.grant('bookmarks'), 'unauthorized'); assert.equal(f.calls.length, 0); f.controller.dispose();
  }
  const f = fixture(); f.env.top = {}; await rejects(f.controller.load('bookmarks'), 'unauthorized'); f.controller.dispose();
});
test('missing declaration or implementation never requests an unsupported permission', async () => {
  const f = fixture(); f.api.runtime.getManifest = () => ({ permissions: [] });
  assert.equal((await f.controller.access('bookmarks')).status, 'unsupported'); await rejects(f.controller.grant('bookmarks'), 'unsupported'); assert.equal(f.calls.length, 0);
  f.controller.dispose();
});
test('opaque handles expose only metadata, mutation validates fields and detects external record changes', async () => {
  const f = fixture(), snapshot = await f.controller.load('bookmarks');
  const row = snapshot.rows[0]; assert.deepEqual(Object.keys(row), ['handle', 'values', 'actions']); assert.equal(Object.hasOwn(row.values, 'id'), false);
  assert.equal(f.controller.describe('bookmarks', 'edit', row.handle).fields[0].value, 'Owned');
  await rejects(f.controller.mutate('bookmarks', 'edit', row.handle, { title: 'New', url: 'javascript:alert(1)' }), 'invalid-input');
  await rejects(f.controller.mutate('bookmarks', 'edit', row.handle, { title: 'New', url: row.values.url, id: 'other' }), 'invalid-input');
  f.records.get('1').title = 'Changed outside';
  await rejects(f.controller.mutate('bookmarks', 'remove', row.handle, {}), 'stale-record'); assert.equal(f.calls.length, 0);
  f.controller.dispose();
});
test('refresh invalidates old handles; successful write is verified and does not expose native references', async () => {
  const f = fixture(), first = await f.controller.load('bookmarks'), next = await f.controller.load('bookmarks');
  assert.throws(() => f.controller.describe('bookmarks', 'remove', first.rows[0].handle), { code: 'stale-handle' });
  await f.controller.mutate('bookmarks', 'edit', next.rows[0].handle, { title: 'Edited', url: 'https://example.test/edited' });
  assert.equal(f.records.get('1').title, 'Edited'); assert.equal(f.calls.filter(item => item[0] === 'update').length, 1);
  assert.throws(() => f.controller.describe('bookmarks', 'remove', next.rows[0].handle), { code: 'stale-handle' }); f.controller.dispose();
});
test('permission revocation clears handles and notifies UI; hidden view never dispatches another read or write', async () => {
  const f = fixture(), snapshot = await f.controller.load('bookmarks'); f.revoke();
  assert.equal(f.invalidations.at(-1).reason, 'permissions'); assert.throws(() => f.controller.describe('bookmarks', 'remove', snapshot.rows[0].handle), { code: 'stale-handle' });
  await rejects(f.controller.load('bookmarks'), 'permission-required'); f.controller.setVisible(false);
  await rejects(f.controller.load('bookmarks'), 'inactive'); await rejects(f.controller.grant('bookmarks'), 'inactive'); assert.equal(f.calls.length, 0);
  f.controller.dispose(); assert.equal(f.events.size, 0);
});
test('out-of-order loads cannot publish stale results or handles', async () => {
  const f = fixture(), old = deferred(); let reads = 0;
  f.api.bookmarks.getRecent = () => ++reads === 1 ? old.promise : Promise.resolve([{ ...f.records.get('1'), title: 'Latest' }]);
  const first = f.controller.load('bookmarks'); await new Promise(done => setImmediate(done));
  const second = await f.controller.load('bookmarks'); old.resolve([{ ...f.records.get('1'), title: 'Old' }]);
  await rejects(first, 'stale'); assert.equal(second.rows[0].values.title, 'Latest');
  assert.equal(f.controller.describe('bookmarks', 'remove', second.rows[0].handle).destructive, true); f.controller.dispose();
});
test('timeout never retries a physical mutation and keeps the writer locked until the native promise settles', async () => {
  const f = fixture({ deadline: 25 }), pending = deferred(); let writes = 0;
  f.api.bookmarks.create = () => { writes++; return pending.promise; };
  await rejects(f.controller.mutate('bookmarks', 'create', null, { url: 'https://example.test/new', title: 'New' }), 'timeout');
  await rejects(f.controller.mutate('bookmarks', 'create', null, { url: 'https://example.test/other' }), 'busy'); assert.equal(writes, 1);
  pending.resolve({ id: '2', title: 'New', url: 'https://example.test/new' }); await new Promise(done => setImmediate(done));
  f.api.bookmarks.create = async input => { writes++; return { id: '3', title: input.title ?? '', url: input.url }; };
  await f.controller.mutate('bookmarks', 'create', null, { url: 'https://example.test/final' }); assert.equal(writes, 2); f.controller.dispose();
});
test('native errors never disclose native messages and are not retried with callbacks', async () => {
  const f = fixture(); let calls = 0; f.api.bookmarks.getRecent = async () => { calls++; throw Error('secret token and full private URL'); };
  await assert.rejects(f.controller.load('bookmarks'), error => error.message === 'operation-failed' && !error.stack.includes('secret token'));
  assert.equal(calls, 1); f.controller.dispose();
});
test('bounded snapshots mark truncation; invalid options do not touch data APIs', async () => {
  const f = fixture(); let calls = 0; f.api.bookmarks.getRecent = async () => { calls++; return Array.from({ length: 300 }, (_, index) => ({ id: String(index), parentId: 'root', title: 'x'.repeat(4096), url: 'https://example.test/' + index })); };
  const snapshot = await f.controller.load('bookmarks'); assert.ok(snapshot.rows.length < 200); assert.equal(snapshot.truncated, true); assert.ok(new TextEncoder().encode(JSON.stringify(snapshot)).length <= 262144);
  await rejects(f.controller.load('bookmarks', { limit: 201 }), 'invalid-input'); await rejects(f.controller.load('cookies', { origin: 'https://user:secret@example.test/' }), 'invalid-input');
  assert.equal(calls, 1); f.controller.dispose();
});
test('origin-scoped queries reject paths, query strings and fragments at the controller boundary', async () => {
  const f = fixture(); let reads = 0; f.api.cookies = { getAll: async () => { reads++; return []; } };
  for (const origin of ['https://example.test/deep', 'https://example.test/?private=token', 'https://example.test/#private']) await rejects(f.controller.load('cookies', { origin }), 'invalid-input');
  await f.controller.load('cookies', { origin: 'https://example.test' }); assert.ok(reads > 0); f.controller.dispose();
});
test('export is the exact preview data without private handles, URL tokens or account identity', async () => {
  const f = fixture(), snapshot = await f.controller.load('bookmarks'), text = exportBrowserDebugSnapshot(snapshot), exported = JSON.parse(text);
  assert.equal(exported.records[0].url, 'https://example.test/path'); assert.equal(exported.records[0].title, 'Owned');
  assert.equal(text.includes('private=token'), false); assert.equal(text.includes('fragment'), false); assert.equal(text.includes('handle'), false); assert.equal(text.includes('reference'), false);
  assert.equal(exportBrowserDebugSnapshot(snapshot), text);
  const account = JSON.parse(exportBrowserDebugSnapshot({ ...snapshot, dataset: 'account', rows: [{ values: { name: 'account.email', value: 'private@example.test' } }] }));
  assert.equal(account.records[0].value, '[redacted]'); f.controller.dispose();
});
