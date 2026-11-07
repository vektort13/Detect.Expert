import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCookiesWorkspaceController } from '../../apps/production-extension/cookies-workspace-controller.js';
import { cookieIdentity, normalizeNativeCookie, exportCookieRecords } from '../../apps/production-extension/cookie-transfer-core.js';

const NOW = 1800000000000;
const record = patch => ({ name: 'owned', value: 'OWNED_VALUE_CANARY', domain: 'example.test', path: '/', hostOnly: true, secure: true, httpOnly: true, sameSite: 'lax', session: true, expirationDate: null, storeId: '0', partitionKey: null, firstPartyDomain: null, ...patch });
const code = expected => error => error?.code === expected;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture({ rows = [], browser = 'chrome', firefoxVersion = '137', permission = true, stores = ['0'], deadlineMs = 1000, href, framed = false } = {}) {
  let values = rows.map(item => ({ ...item })), granted = permission;
  const calls = [], listeners = new Set(), notices = [], overrides = {};
  const base = browser === 'firefox' ? 'moz-extension://owned/' : 'chrome-extension://owned/';
  const events = new Map(), documentEvents = new Map();
  const eventOwner = map => ({ addEventListener: (name, fn) => { if (!map.has(name)) map.set(name, new Set()); map.get(name).add(fn); }, removeEventListener: (name, fn) => map.get(name)?.delete(fn) });
  const env = { location: { href: href ?? base + 'options.html#cookies' }, ...eventOwner(events), document: { visibilityState: 'visible', ...eventOwner(documentEvents) } }; env.window = env; env.top = framed ? {} : env;
  const api = {
    runtime: { id: 'owned', getURL: path => base + path, getManifest: () => ({ optional_permissions: ['cookies'] }), ...(browser === 'firefox' ? { getBrowserInfo: async () => ({ version: firefoxVersion }) } : {}) },
    permissions: { contains: async () => granted, request: async () => { granted = true; return true; }, onRemoved: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) } },
    cookies: {
      getAllCookieStores: async () => stores.map(id => ({ id, tabIds: [] })),
      getAll: async details => values.filter(item => {
        if (details.storeId !== undefined && item.storeId !== details.storeId || details.name !== undefined && item.name !== details.name || details.path !== undefined && item.path !== details.path) return false;
        const bare = item.domain.replace(/^\./, '');
        if (details.domain && bare !== details.domain && !bare.endsWith('.' + details.domain)) return false;
        if (details.partitionKey === undefined && item.partitionKey) return false;
        if (details.partitionKey?.topLevelSite && item.partitionKey?.topLevelSite !== details.partitionKey.topLevelSite) return false;
        if (Object.hasOwn(details.partitionKey ?? {}, 'hasCrossSiteAncestor') && item.partitionKey?.hasCrossSiteAncestor !== details.partitionKey.hasCrossSiteAncestor) return false;
        if (details.firstPartyDomain !== undefined && details.firstPartyDomain !== null && (item.firstPartyDomain ?? '') !== details.firstPartyDomain) return false;
        return true;
      }).map(item => ({ ...item })),
      set: async details => {
        const url = new URL(details.url), next = record({ name: details.name, value: details.value, domain: details.domain ? '.' + details.domain.replace(/^\./, '') : url.hostname, path: details.path, hostOnly: !details.domain, secure: details.secure, httpOnly: details.httpOnly, sameSite: details.sameSite, session: !Object.hasOwn(details, 'expirationDate'), expirationDate: details.expirationDate ?? null, storeId: details.storeId,
          partitionKey: details.partitionKey ? { topLevelSite: details.partitionKey.topLevelSite, hasCrossSiteAncestor: browser === 'chrome' || parseInt(firefoxVersion, 10) >= 138 ? details.partitionKey.hasCrossSiteAncestor ?? false : null } : null, firstPartyDomain: browser === 'firefox' ? details.firstPartyDomain ?? '' : null });
        const identity = cookieIdentity(next); values = values.filter(item => cookieIdentity(normalizeNativeCookie(item, { browser, storeId: item.storeId })) !== identity);
        if (next.expirationDate !== null && next.expirationDate <= NOW / 1000) return null;
        values.push(next); return { ...next };
      },
      get: async () => { throw Error('URL winner access is forbidden'); }, remove: async () => { throw Error('URL winner deletion is forbidden'); },
    },
  };
  for (const [target, methods] of [[api.cookies, ['getAllCookieStores', 'getAll', 'set']], [api.permissions, ['contains', 'request']]]) for (const name of methods) {
    const original = target[name]; target[name] = (...args) => { calls.push({ name, args }); return overrides[name] ? overrides[name](...args) : original(...args); };
  }
  if (browser === 'firefox') env.browser = api;
  const controller = createCookiesWorkspaceController(api, { env, deadlineMs, now: () => NOW, onInvalidate: event => notices.push(event) });
  return { controller, api, env, calls, notices, overrides, get rows() { return values; }, set rows(next) { values = next; }, revoke() { granted = false; for (const listener of listeners) listener({ permissions: ['cookies'] }); }, setPermission(value) { granted = value; }, visibility(state) { env.document.visibilityState = state; for (const fn of documentEvents.get('visibilitychange') ?? []) fn(); }, event(name) { for (const fn of events.get(name) ?? []) fn(); }, get eventCount() { return [...events.values(), ...documentEvents.values()].reduce((total, value) => total + value.size, 0); } };
}
const backup = rows => exportCookieRecords(rows, { format: 'json', browser: 'chrome' }).text;
async function loaded(f) { return f.controller.load({ storeId: '0', domain: '' }); }

test('construction and access never read cookie values or inventory', async () => {
  const f = fixture(); assert.equal(f.calls.length, 0);
  assert.deepEqual(await f.controller.access(), { status: 'ready', stores: [{ id: '0' }], capabilities: { partitionKey: true, hasCrossSiteAncestor: true, firstPartyDomain: false, unspecifiedSameSite: true }, browser: 'chrome' });
  assert.equal(f.calls.some(call => call.name === 'getAll'), false);
});
test('only exact owned top Options may dispatch native calls', async () => {
  for (const options of [{ href: 'chrome-extension://foreign/options.html' }, { href: 'chrome-extension://owned/popup.html' }, { framed: true }, { href: 'https://example.test/options.html' }]) {
    const f = fixture(options); await assert.rejects(f.controller.access(), code('unauthorized')); assert.equal(f.calls.length, 0);
  }
});
test('optional permission blocks reads and grant dispatch remains synchronous', async () => {
  const f = fixture({ permission: false }); assert.equal((await f.controller.access()).status, 'permission-required');
  await assert.rejects(loaded(f), code('permission-required')); assert.equal(f.calls.some(call => call.name === 'getAll'), false);
  let synchronous = false; f.overrides.request = () => { synchronous = true; f.setPermission(true); return Promise.resolve(true); };
  const request = f.controller.grant(); assert.equal(synchronous, true); assert.equal((await request).status, 'ready');
});
test('an optional native namespace absent before grant still exposes the permission request', async () => {
  for (const browser of ['chrome', 'firefox']) {
    const f = fixture({ browser, permission: false }), cookies = f.api.cookies; delete f.api.cookies;
    assert.equal((await f.controller.access()).status, 'permission-required');
    f.overrides.request = () => { f.api.cookies = cookies; f.setPermission(true); return true; };
    assert.equal((await f.controller.grant()).status, 'ready'); assert.equal(f.calls.some(call => call.name === 'getAll'), false);
  }
});
test('private stores are excluded and target store must be explicit and currently real', async () => {
  const f = fixture({ stores: ['0', '1'] }); assert.deepEqual((await f.controller.access()).stores, [{ id: '0' }]);
  await assert.rejects(f.controller.load({ domain: '' }), code('unknown-store')); await assert.rejects(f.controller.save(null, record({ storeId: 'missing' })), code('unknown-store'));
  assert.equal(f.calls.some(call => call.name === 'set'), false);
});
test('load metadata excludes values; explicit reveal/describe preserves empty values', async () => {
  const f = fixture({ rows: [record({ value: '' })] }), snapshot = await loaded(f);
  assert.equal(snapshot.rows.length, 1); assert.equal(Object.hasOwn(snapshot.rows[0], 'value'), false); assert.equal(snapshot.count, 1);
  assert.equal(await f.controller.reveal(snapshot.rows[0].id), ''); assert.equal((await f.controller.describe(snapshot.rows[0].id)).value, '');
  assert.deepEqual(f.calls.find(call => call.name === 'getAll').args[0], { storeId: '0', partitionKey: {} });
});
test('fresh signature conflict rejects reveal, edit, delete, and export before writing', async () => {
  for (const operation of ['reveal', 'save', 'remove', 'export']) {
    const f = fixture({ rows: [record()] }), snapshot = await loaded(f), id = snapshot.rows[0].id;
    f.rows = [record({ value: 'EXTERNAL_NEW_VALUE' })];
    await assert.rejects(operation === 'reveal' ? f.controller.reveal(id) : operation === 'save' ? f.controller.save(id, record({ value: 'EDIT' })) : operation === 'remove' ? f.controller.remove([id]) : f.controller.prepareExport(snapshot.token), code('conflict'));
    assert.equal(f.calls.some(call => call.name === 'set'), false);
  }
});
test('create and undo operate through exact expired-set deletion', async () => {
  const f = fixture(), created = await f.controller.save(null, record()); assert.equal(created.applied, 1); assert.equal(created.undoAvailable, true); assert.equal(f.rows.length, 1);
  const undone = await f.controller.undo(); assert.equal(undone.applied, 1); assert.equal(f.rows.length, 0); assert.equal(f.calls.filter(call => call.name === 'set').at(-1).args[0].expirationDate, 1);
});
test('edit locks identity, changes attributes/value, and undo restores original signature', async () => {
  const f = fixture({ rows: [record()] }), snapshot = await loaded(f), id = snapshot.rows[0].id;
  await assert.rejects(f.controller.save(id, record({ path: '/renamed' })), code('identity-change'));
  const saved = await f.controller.save(id, record({ value: 'EDIT', secure: false })); assert.equal(saved.applied, 1); assert.equal(f.rows[0].value, 'EDIT');
  await f.controller.undo(); assert.equal(f.rows[0].value, 'OWNED_VALUE_CANARY'); assert.equal(f.rows[0].secure, true);
});
test('delete targets exact selected path and leaves same-name siblings', async () => {
  const f = fixture({ rows: [record(), record({ path: '/deep', value: 'DEEP' })] }), snapshot = await loaded(f);
  await f.controller.remove([snapshot.rows.find(row => row.path === '/').id]); assert.deepEqual(f.rows.map(row => row.path), ['/deep']);
  await f.controller.undo(); assert.equal(f.rows.length, 2);
});
test('ambiguous visible duplicates never become editable or exportable', async () => {
  const f = fixture({ rows: [record(), record({ value: 'HIDDEN_SOURCE_VARIANT' })] }); await assert.rejects(loaded(f), code('ambiguous'));
  assert.equal(f.calls.some(call => call.name === 'set'), false);
});
test('native raw error text and nonwhitelisted codes never escape', async () => {
  const f = fixture(); f.overrides.getAll = () => { throw Object.assign(Error('SECRET_VALUE_CANARY'), { code: 'SECRET_VALUE_CANARY' }); };
  await assert.rejects(loaded(f), error => error.code === 'operation-failed' && !String(error).includes('SECRET'));
});
test('read timeout returns immediately but holds physical mutex until late settlement', async () => {
  const f = fixture({ deadlineMs: 15 }), pending = deferred(); f.overrides.getAll = () => pending.promise;
  await assert.rejects(loaded(f), code('timeout')); await assert.rejects(f.controller.access(), code('busy'));
  pending.resolve([record()]); await wait(2); assert.equal((await f.controller.access()).status, 'ready'); await assert.rejects(f.controller.reveal('c1'), code('stale'));
});
test('write timeout holds physical mutex and never automatically retries', async () => {
  const f = fixture({ deadlineMs: 15 }), pending = deferred(); f.overrides.set = () => pending.promise;
  await assert.rejects(f.controller.save(null, record()), code('timeout')); await assert.rejects(f.controller.access(), code('busy'));
  assert.equal(f.calls.filter(call => call.name === 'set').length, 1); pending.resolve(record()); await wait(2);
  assert.equal((await f.controller.access()).status, 'ready'); assert.equal(f.calls.filter(call => call.name === 'set').length, 1);
});
test('hide/revoke/dispose clear private snapshots and reject stale pending data', async () => {
  for (const mode of ['hide', 'revoke', 'dispose']) {
    const f = fixture({ rows: [record()] }), snapshot = await loaded(f), pending = deferred(); f.overrides.getAll = () => pending.promise;
    const request = f.controller.reveal(snapshot.rows[0].id);
    while (!f.calls.filter(call => call.name === 'getAll').slice(1).length) await wait(1);
    if (mode === 'hide') f.controller.setActive(false); else if (mode === 'revoke') f.revoke(); else f.controller.dispose();
    pending.resolve([record()]); await assert.rejects(request, error => ['inactive', 'stale'].includes(error.code));
    if (mode === 'hide') { f.controller.setActive(true); await assert.rejects(f.controller.reveal(snapshot.rows[0].id), code('stale')); }
    assert.ok(f.notices.length);
  }
});
test('malformed imports fail before any native access or mutation', async () => {
  const f = fixture(); await assert.rejects(f.controller.prepareImport('{"cookies":['), code('invalid-json')); assert.equal(f.calls.length, 0);
});
test('missing map and mapping collisions are preview errors blocking the entire import', async () => {
  const f = fixture(), text = backup([record({ storeId: 'source-a' }), record({ storeId: 'source-b' })]);
  let preview = await f.controller.prepareImport(text); assert.equal(preview.errors.length, 2); await assert.rejects(f.controller.applyImport(preview.token), code('invalid-input'));
  preview = await f.controller.updateImport(preview.token, { storeMap: { 'source-a': '0', 'source-b': '0' } }); assert.equal(preview.errors.length, 2); assert.ok(preview.errors.every(error => error.code === 'duplicate-target'));
  await assert.rejects(f.controller.applyImport(preview.token), code('invalid-input')); assert.equal(f.calls.some(call => call.name === 'set'), false);
});
test('skip policy preserves existing data; overwrite preview and undo use the recorded native signature', async () => {
  const f = fixture({ rows: [record()] }), text = backup([record({ value: 'IMPORTED', storeId: 'source' })]);
  let preview = await f.controller.prepareImport(text, { storeMap: { source: '0' } }); assert.equal(preview.rows[0].action, 'skip');
  const skipped = await f.controller.applyImport(preview.token); assert.equal(skipped.skipped, 1); assert.equal(f.rows[0].value, 'OWNED_VALUE_CANARY');
  preview = await f.controller.prepareImport(text, { storeMap: { source: '0' }, policy: 'overwrite' }); assert.equal(preview.rows[0].action, 'overwrite');
  const applied = await f.controller.applyImport(preview.token); assert.equal(applied.applied, 1); assert.equal(f.rows[0].value, 'IMPORTED'); await f.controller.undo(); assert.equal(f.rows[0].value, 'OWNED_VALUE_CANARY');
});
test('all import destinations are freshly preflighted before the first write', async () => {
  const f = fixture(), text = backup([record({ name: 'a', storeId: 'source' }), record({ name: 'b', storeId: 'source' })]);
  const preview = await f.controller.prepareImport(text, { storeMap: { source: '0' } }); f.rows = [record({ name: 'b', value: 'EXTERNAL' })];
  await assert.rejects(f.controller.applyImport(preview.token), code('conflict')); assert.equal(f.calls.some(call => call.name === 'set'), false);
});
test('ADR-107: a Playwright/Puppeteer cookie array uses the same preview, store mapping and readback before writing', async () => {
  const f = fixture(), text = JSON.stringify([
    { name: 'tool', value: 'TOOL_ARRAY_CANARY', domain: '.example.com', path: '/', expires: 1900000000, size: 21, httpOnly: true, secure: true, session: false, sameSite: 'Lax', priority: 'Medium', sourceScheme: 'Secure', sourcePort: 443 },
    { name: 'old', value: 'x', domain: 'example.test', path: '/', expires: 10, httpOnly: false, secure: true, sameSite: 'Strict' },
  ]);
  const preview = await f.controller.prepareImport(text, { storeMap: { import: '0' } });
  assert.equal(f.calls.some(call => call.name === 'set'), false); assert.deepEqual(preview.sourceStores.map(store => typeof store === 'string' ? store : store.id), ['import']);
  assert.deepEqual(preview.rows.map(row => [row.name, row.action ?? null, row.code ?? null]).sort(), [['old', 'skip', 'expired'], ['tool', 'create', null]]);
  const result = await f.controller.applyImport(preview.token); assert.equal(result.applied, 1); assert.equal(result.skipped, 1);
  const written = f.calls.filter(call => call.name === 'set').map(call => call.args[0]); assert.equal(written.length, 1);
  assert.deepEqual({ ...written[0], value: undefined }, { url: 'https://example.com/', name: 'tool', value: undefined, path: '/', secure: true, httpOnly: true, sameSite: 'lax', storeId: '0', domain: '.example.com', expirationDate: 1900000000 });
});
test('expired import rows skip without deletion or native writes', async () => {
  const f = fixture(), preview = await f.controller.prepareImport(backup([record({ storeId: 'source', session: false, expirationDate: 10 })]), { storeMap: { source: '0' } });
  assert.equal(preview.rows[0].code, 'expired'); const result = await f.controller.applyImport(preview.token); assert.equal(result.skipped, 1); assert.equal(f.calls.some(call => call.name === 'set'), false);
});
test('partial batch failure reports exact applied/failed counts and undo only restores successful changes', async () => {
  const f = fixture(), original = f.api.cookies.set, nativeSet = [];
  f.overrides.set = details => { if (details.name === 'b') throw Error('NATIVE_SECRET'); nativeSet.push(details); delete f.overrides.set; const promise = original(details); f.overrides.set = handler; return promise; };
  const handler = f.overrides.set;
  const preview = await f.controller.prepareImport(backup([record({ name: 'a', storeId: 'source' }), record({ name: 'b', storeId: 'source' })]), { storeMap: { source: '0' } });
  const result = await f.controller.applyImport(preview.token); assert.equal(result.applied, 1); assert.equal(result.failed, 1); assert.equal(result.undoAvailable, true); assert.equal(JSON.stringify(result).includes('NATIVE_SECRET'), false);
  delete f.overrides.set; await f.controller.undo(); assert.equal(f.rows.length, 0);
});
test('an unknown native import outcome stops later writes and leaves successful changes undoable', async () => {
  const f = fixture(), original = f.api.cookies.set, attempted = [];
  f.overrides.set = details => {
    attempted.push(details.name); if (details.name === 'b') throw Error('UNKNOWN_NATIVE_CANARY');
    delete f.overrides.set; const result = original(details); f.overrides.set = handler; return result;
  };
  const handler = f.overrides.set;
  const preview = await f.controller.prepareImport(backup(['a','b','c'].map(name => record({ name, storeId: 'source' }))), { storeMap: { source: '0' } });
  const result = await f.controller.applyImport(preview.token);
  assert.deepEqual(attempted, ['a','b']); assert.equal(result.applied, 1); assert.equal(result.unknown, 1); assert.equal(result.skipped, 1);
  assert.deepEqual(result.results.map(row => row.status), ['applied','unknown','skipped']); assert.equal(result.undoAvailable, true);
  assert.equal(JSON.stringify(result).includes('UNKNOWN_NATIVE_CANARY'), false);
  delete f.overrides.set; await f.controller.undo(); assert.equal(f.rows.length, 0);
});

test('undo rejects conflicts before restoring any selected row', async () => {
  const f = fixture(); await f.controller.save(null, record()); f.rows = [record({ value: 'EXTERNAL' })];
  const before = f.calls.filter(call => call.name === 'set').length; await assert.rejects(f.controller.undo(), code('conflict')); assert.equal(f.calls.filter(call => call.name === 'set').length, before);
});
test('Firefox destination normalizes empty FPI representation and does not flatten nonempty FPI', async () => {
  const f = fixture({ browser: 'firefox' }); const result = await f.controller.save(null, record()); assert.equal(result.applied, 1); assert.equal(f.rows[0].firstPartyDomain, '');
  const chrome = fixture(); await assert.rejects(chrome.controller.save(null, record({ firstPartyDomain: 'example.org' })), code('unsupported-first-party-domain')); assert.equal(chrome.calls.length, 0);
});
test('unsupported partition ancestor context is rejected before native writes', async () => {
  for (const [browser, ancestor] of [['chrome', null], ['firefox', false], ['firefox', true]]) {
    const f = fixture({ browser }); await assert.rejects(f.controller.save(null, record({ partitionKey: { topLevelSite: 'https://example.test', hasCrossSiteAncestor: ancestor } })), code('unsupported-partition')); assert.equal(f.calls.some(call => call.name === 'set'), false);
  }
});
test('successful native expiry clamp returns adjusted actual metadata and remains undoable', async () => {
  const f = fixture(), original = f.api.cookies.set;
  f.overrides.set = details => { delete f.overrides.set; return original({ ...details, expirationDate: NOW / 1000 + 1000 }); };
  const result = await f.controller.save(null, record({ session: false, expirationDate: NOW / 1000 + 999999999 }));
  assert.equal(result.applied, 1); assert.equal(result.adjusted, 1); assert.equal(result.results[0].metadata.expirationDate, NOW / 1000 + 1000); assert.equal(result.undoAvailable, true);
  await f.controller.undo(); assert.equal(f.rows.length, 0);
});
test('unexpected native attribute adjustment reports failure but retains exact actual state for undo', async () => {
  const f = fixture(), original = f.api.cookies.set;
  f.overrides.set = details => { delete f.overrides.set; return original({ ...details, httpOnly: false }); };
  const result = await f.controller.save(null, record()); assert.equal(result.applied, 0); assert.equal(result.failed, 1); assert.equal(result.results[0].code, 'not-applied'); assert.equal(result.undoAvailable, true);
  await f.controller.undo(); assert.equal(f.rows.length, 0);
});
test('export uses fresh exact selected records and never includes internal handles', async () => {
  const f = fixture({ rows: [record(), record({ name: 'unselected', value: 'OTHER_CANARY' })] }), snapshot = await loaded(f);
  const exported = await f.controller.prepareExport(snapshot.token, [snapshot.rows.find(row => row.name === 'owned').id], { format: 'json' });
  assert.ok(exported.text.includes('OWNED_VALUE_CANARY')); assert.equal(exported.text.includes('OTHER_CANARY'), false); assert.equal(exported.text.includes(snapshot.rows[0].id), false); assert.equal(exported.filename, 'detect-expert-cookies.json');
});
test('explicitly loaded empty snapshots export valid empty backups without another cookie read', async () => {
  const f = fixture(), snapshot = await loaded(f), reads = f.calls.filter(call => call.name === 'getAll').length;
  const json = await f.controller.prepareExport(snapshot.token, null, { format: 'json' }); assert.deepEqual(JSON.parse(json.text).cookies, []);
  const netscape = await f.controller.prepareExport(snapshot.token, [], { format: 'netscape', allowLossy: true }); assert.equal(netscape.text, '# Netscape HTTP Cookie File\n');
  assert.equal(f.calls.filter(call => call.name === 'getAll').length, reads);
});

test('explicit all-store load preserves store identity and exports separate stores', async () => {
  const f = fixture({ browser: 'firefox', stores: ['firefox-default', 'firefox-container-1', 'firefox-private'], rows: [record({ storeId: 'firefox-default', firstPartyDomain: '' }), record({ storeId: 'firefox-container-1', firstPartyDomain: '', value: 'CONTAINER' })] });
  const snapshot = await f.controller.load({ storeId: '*', domain: '' }); assert.equal(snapshot.count, 2); assert.deepEqual(snapshot.rows.map(row => row.storeId), ['firefox-default', 'firefox-container-1']);
  const exported = await f.controller.prepareExport(snapshot.token); assert.equal(JSON.parse(exported.text).stores.length, 2); assert.equal((await f.controller.describe(null)).storeId, 'firefox-default');
  assert.equal(f.calls.filter(call => call.name === 'getAll').some(call => call.args[0].storeId === 'firefox-private'), false);
});
test('document visibility and BFCache lifecycle clear secrets and remove listeners on disposal', async () => {
  const f = fixture({ rows: [record()] }), snapshot = await loaded(f);
  f.visibility('hidden'); await assert.rejects(f.controller.access(), code('inactive')); f.visibility('visible'); await assert.rejects(f.controller.reveal(snapshot.rows[0].id), code('stale'));
  await f.controller.save(null, record({ name: 'created' })); f.event('pagehide'); await assert.rejects(f.controller.access(), code('inactive')); f.event('pageshow'); await assert.rejects(f.controller.undo(), code('stale'));
  assert.equal(f.eventCount, 3); f.controller.dispose(); assert.equal(f.eventCount, 0);
});
test('full host-permission preflight prevents writes before an inaccessible import row', async () => {
  const f = fixture(); f.overrides.contains = details => !details.origins?.some(origin => origin.includes('blocked.example'));
  const preview = await f.controller.prepareImport(backup([record({ name: 'allowed', storeId: 'source' }), record({ name: 'blocked', domain: 'blocked.example', storeId: 'source' })]), { storeMap: { source: '0' } });
  assert.equal(preview.errors.length, 1); assert.equal(preview.errors[0].code, 'permission-required'); await assert.rejects(f.controller.applyImport(preview.token), code('invalid-input')); assert.equal(f.calls.some(call => call.name === 'set'), false);
});
test('host permission revocation after preview blocks the complete selected batch before its first write', async () => {
  const f = fixture(), preview = await f.controller.prepareImport(backup([record({ storeId: 'source' })]), { storeMap: { source: '0' } });
  f.overrides.contains = details => !details.origins;
  await assert.rejects(f.controller.applyImport(preview.token), code('permission-required')); assert.equal(f.calls.some(call => call.name === 'set'), false);
});
test('batch timeout reports prior confirmed changes and unknown operation while holding the physical lock', async () => {
  const f = fixture({ deadlineMs: 15 }), original = f.api.cookies.set, pending = deferred();
  const handler = details => { if (details.name === 'b') return pending.promise; delete f.overrides.set; const request = original(details); f.overrides.set = handler; return request; }; f.overrides.set = handler;
  const preview = await f.controller.prepareImport(backup(['a', 'b', 'c'].map(name => record({ name, storeId: 'source' }))), { storeMap: { source: '0' } });
  const result = await f.controller.applyImport(preview.token); assert.equal(result.applied, 1); assert.equal(result.unknown, 1); assert.equal(result.skipped, 1); assert.equal(result.results[1].status, 'unknown'); assert.equal(result.results[2].code, 'not-attempted'); assert.equal(result.undoAvailable, true);
  await assert.rejects(f.controller.access(), code('busy')); pending.resolve(record({ name: 'b' })); await wait(2); delete f.overrides.set; await f.controller.undo(); assert.equal(f.rows.length, 0);
});
test('a single mutating readback failure exposes only an unknown outcome and never retries', async () => {
  const f = fixture(), original = f.api.cookies.set;
  f.overrides.set = details => { delete f.overrides.set; return original(details).then(value => { f.overrides.getAll = () => { throw Error('RAW_SECRET_FAILURE'); }; return value; }); };
  await assert.rejects(f.controller.save(null, record()), error => error.code === 'operation-failed' && error.outcome === 'unknown' && !String(error).includes('RAW_SECRET'));
  assert.equal(f.rows.length, 1); assert.equal(f.calls.filter(call => call.name === 'set').length, 2); // Wrapper + one underlying native dispatch in this fixture.
});
test('error accessors are never invoked while sanitizing native failure', async () => {
  const f = fixture(); let reads = 0;
  const error = {}; Object.defineProperty(error, 'code', { get() { reads++; return 'SECRET'; } }); f.overrides.getAll = () => { throw error; };
  await assert.rejects(loaded(f), code('operation-failed')); assert.equal(reads, 0);
});
test('Chrome path/domain and cross-site ancestor aliases fail the complete import preview before writes', async () => {
  for (const [patch, expected] of [[{ path: '/a b' }, 'invalid-path'], [{ domain: '.com', hostOnly: false }, 'invalid-domain'], [{ partitionKey: { topLevelSite: 'https://example.net', hasCrossSiteAncestor: false } }, 'unsupported-partition']]) {
    const f = fixture({ rows: [record({ name: 'sibling', path: '/a%20b' })] }), preview = await f.controller.prepareImport(backup([record({ storeId: 'source' }), record({ name: 'alias', storeId: 'source', ...patch })]), { storeMap: { source: '0' }, policy: 'overwrite' });
    assert.ok(preview.errors.some(error => error.code === expected)); await assert.rejects(f.controller.applyImport(preview.token), code('invalid-input')); assert.equal(f.calls.some(call => call.name === 'set'), false); assert.equal(f.rows[0].value, 'OWNED_VALUE_CANARY');
  }
});
test('Firefox ancestor capability is native-version gated without inventory reads and unknown ancestor rejects before writes', async () => {
  for (const [firefoxVersion, expected] of [['137.0', false], ['138.0.4', true], ['139.0', true], ['invalid', false]]) {
    const f = fixture({ browser: 'firefox', firefoxVersion }); assert.equal((await f.controller.access()).capabilities.hasCrossSiteAncestor, expected); assert.equal(f.calls.some(call => call.name === 'getAll'), false);
    if (expected) await assert.rejects(f.controller.save(null, record({ partitionKey: { topLevelSite: 'https://example.net', hasCrossSiteAncestor: null } })), code('unsupported-partition'));
    assert.equal(f.calls.some(call => call.name === 'set'), false);
  }
  const fresh = fixture({ browser: 'firefox', firefoxVersion: '138.0.4' });
  assert.equal((await fresh.controller.save(null, record({ partitionKey: { topLevelSite: 'https://example.net', hasCrossSiteAncestor: true } }))).applied, 1);
});
test('owned Options documents share a Web Lock for writes while reads and permission gestures remain independent', async () => {
  let held = false;
  const manager = { request: async (name, options, callback) => { assert.equal(name, 'detect.expert/cookies-write/v1'); assert.equal(options.ifAvailable, true); if (held) return callback(null); held = true; try { return await callback({ name }); } finally { held = false; } } };
  const first = fixture(), second = fixture(), pending = deferred(); first.env.navigator = { locks: manager }; second.env.navigator = { locks: manager };
  first.overrides.set = () => pending.promise;
  const write = first.controller.save(null, record());
  while (!first.calls.some(call => call.name === 'set')) await wait(1);
  await assert.rejects(second.controller.save(null, record({ name: 'second' })), code('busy'));
  assert.equal((await second.controller.access()).status, 'ready'); assert.equal(second.calls.some(call => call.name === 'set'), false);
  pending.resolve(record()); await assert.rejects(write, error => error.outcome === 'unknown'); await wait(1);
  assert.equal((await second.controller.save(null, record({ name: 'second' }))).applied, 1);
});
test('shared Web Lock remains held after a public timeout until the actual native call settles', async () => {
  let held = false;
  const manager = { request: async (name, options, callback) => { if (held) return callback(null); held = true; try { return await callback({ name }); } finally { held = false; } } };
  const first = fixture({ deadlineMs: 15 }), second = fixture(), pending = deferred(); first.env.navigator = { locks: manager }; second.env.navigator = { locks: manager }; first.overrides.set = () => pending.promise;
  await assert.rejects(first.controller.save(null, record()), error => error.code === 'timeout' && error.outcome === 'unknown'); assert.equal(held, true);
  await assert.rejects(second.controller.save(null, record({ name: 'second' })), code('busy')); pending.resolve(record()); await wait(2); assert.equal(held, false);
  assert.equal((await second.controller.save(null, record({ name: 'second' }))).applied, 1);
});
test('Firefox unsupported SameSite cannot partially import or silently change an existing native cookie', async () => {
  const f = fixture({ browser: 'firefox', firefoxVersion: '138.0.4', rows: [record({ sameSite: 'unspecified', firstPartyDomain: '' })] });
  assert.equal((await f.controller.access()).capabilities.unspecifiedSameSite, false);
  const snapshot = await loaded(f), exported = await f.controller.prepareExport(snapshot.token);
  assert.equal(JSON.parse(exported.text).cookies[0].sameSite, 'unspecified');
  const preview = await f.controller.prepareImport(backup([record({ name: 'valid', storeId: 'source' }), record({ name: 'unsupported', sameSite: 'unspecified', storeId: 'source' })]), { storeMap: { source: '0' } });
  assert.ok(preview.errors.some(error => error.code === 'unsupported-samesite')); await assert.rejects(f.controller.applyImport(preview.token), code('invalid-input'));
  await assert.rejects(f.controller.save(snapshot.rows[0].id, record({ sameSite: 'unspecified', firstPartyDomain: '', value: 'EDIT' })), code('unsupported-samesite'));
  assert.equal(f.calls.some(call => call.name === 'set'), false); assert.equal(f.rows[0].sameSite, 'unspecified');
});
test('Firefox SameSite capability follows the vendor documented Firefox 140 API addition', async () => {
  for (const [firefoxVersion, supported] of [['138.0.4', false], ['139.0', false], ['140.0', true], ['141.0', true], ['invalid', false]]) {
    const f = fixture({ browser: 'firefox', firefoxVersion }); assert.equal((await f.controller.access()).capabilities.unspecifiedSameSite, supported); assert.equal(f.calls.some(call => call.name === 'getAll'), false);
    if (supported) assert.equal((await f.controller.save(null, record({ sameSite: 'unspecified' }))).applied, 1);
  }
});
