import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CookieInspector } from '../../apps/production-extension/cookie-inspector.js';
import { CookieProbe } from '../../apps/production-extension/cookie-probe.js';
import { readCookieProbeSnapshot, readCookieProbeDocuments } from '../../packages/contracts/src/cookie-probe.mjs';
const own = (value, key) => Object.getOwnPropertyDescriptor(value, key)?.value;
const nativeCookie = extra => ({ name: '_ga', value: 'COOKIE_IDENTIFIER_CANARY_123', domain: '.example.com', path: '/', hostOnly: false, secure: true, httpOnly: false, session: false, sameSite: 'lax', storeId: 'test-store', expirationDate: 1700100000, ...extra });
async function fixture(input = [nativeCookie()]) {
  let rows = input, now = 1700000000000, granted = true, consent = true, current = '7:0:doc', storeId = 'test-store', paused = false;
  const listeners = new Set(), updates = [], mutations = [], timers = new Map(); let nextTimer = 0;
  const emit = (cookie, removed, cause = 'explicit') => { for (const listener of listeners) listener({ cookie, removed, cause }); };
  const matches = (cookie, query) => {
    if (cookie.storeId !== query.storeId || query.name !== undefined && cookie.name !== query.name) return false;
    if (query.path && cookie.path !== query.path) return false;
    const domain = cookie.domain.replace(/^\./, '');
    if (query.domain && domain !== query.domain && !domain.endsWith('.' + query.domain)) return false;
    if (query.url) {
      const url = new URL(query.url);
      if (url.hostname !== domain && (cookie.hostOnly || !url.hostname.endsWith('.' + domain))) return false;
      if (!url.pathname.startsWith(cookie.path) || cookie.secure && url.protocol !== 'https:') return false;
    }
    return query.partitionKey ? cookie.partitionKey?.topLevelSite === query.partitionKey.topLevelSite && cookie.partitionKey?.hasCrossSiteAncestor === query.partitionKey.hasCrossSiteAncestor : !cookie.partitionKey;
  };
  const runtime = {
    now: () => now, isReady: true,
    scope: { get hasDataConsent() { return consent; }, accessGeneration: 0, isHostGrantedSync: () => true },
    getProjection: () => ({ documentKey: current, coverageState: paused ? 'paused' : 'partial' }),
    canObserveNetworkDocument: key => key === current,
    apiResults: { operations: new Set(), authorize: async (request, operation) => !operation.invalid && !paused && consent && request.documentKey === current },
    api: {
      permissions: { contains: async () => granted },
      webNavigation: { getAllFrames: async () => [{ frameId: 0, documentId: current.split(':')[2], url: 'https://www.example.com/landing?URL_SECRET_CANARY', documentLifecycle: 'active' }] },
      cookies: {
        getAllCookieStores: async () => [{ id: storeId, tabIds: [7] }], getAll: async query => rows.filter(cookie => matches(cookie, query)),
        onChanged: { addListener: listener => listeners.add(listener), removeListener: listener => listeners.delete(listener) },
        remove: async query => {
          const cookie = rows.find(row => matches(row, query)); mutations.push({ action: 'remove', query });
          if (!cookie) return null;
          rows = rows.filter(row => row !== cookie); emit(cookie, true);
          await f.onRemove?.(cookie);
          return { name: cookie.name, storeId: cookie.storeId };
        },
        set: async details => {
          mutations.push({ action: 'set', details });
          const cookie = nativeCookie({ ...details, domain: details.domain ?? new URL(details.url).hostname, hostOnly: !details.domain });
          rows = rows.filter(row => !(row.name === cookie.name && row.domain === cookie.domain && row.path === cookie.path && row.storeId === cookie.storeId)); rows.push(cookie); emit(cookie, false); return cookie;
        }
      }
    },
    pro: { session: { pages: [] }, pageFor: () => null, checkDeadline: () => true, size: () => true, mark() {} },
  };
  const inspector = new CookieInspector(runtime, { host: value => new URL(value).hostname, site: host => host.endsWith('example.com') ? 'example.com' : host, redact: () => ({ kind: 'registrable', value: 'example.com' }) });
  const manager = new CookieProbe(inspector, { onUpdate: snapshot => updates.push(snapshot), clock: { setTimeout: callback => { const id = ++nextTimer; timers.set(id, callback); return id; }, clearTimeout: id => timers.delete(id) } });
  const viewRequest = { schemaVersion: 1, type: 'ui-get-cookie-view', tabId: 7, frameId: 0, documentKey: current };
  const view = await inspector.read(viewRequest), handle = view.handles[0];
  const start = { ...viewRequest, type: 'ui-start-cookie-probe', handle };
  const f = {
    runtime, inspector, manager, view, start, updates, mutations, listeners,
    rows: () => rows, setRows: value => { rows = value; },
    add: cookie => { rows.push(cookie); emit(cookie, false); }, emit,
    waitComplete: async () => { for (let i = 0; i < 40 && manager.active; i++) await new Promise(resolve => setImmediate(resolve)); return manager.snapshot(start.documentKey); },
    advance: async () => { now += 10000; for (const callback of [...timers.values()]) callback(); await f.waitComplete(); return manager.snapshot(start.documentKey); },
    revoke: () => { granted = false; runtime.scope.accessGeneration++; }, unconsent: () => { consent = false; },
    navigate: () => { current = '7:0:next'; }, pause: () => { paused = true; for (const op of runtime.apiResults.operations) op.invalid = true; }, changeStore: () => { storeId = 'other-store'; },
  };
  return f;
}
const assertClean = f => { assert.equal(f.listeners.size, 0); assert.equal(f.runtime.apiResults.operations.size, 0); assert.equal(f.manager.active, null); assert.equal(f.manager.physical.size, 0); };

test('selected cookie probe: genuine page recreation with the same native identity and value is detected', async () => {
  const f = await fixture(); assert.equal((await f.manager.start(f.start)).status, 'watching');
  f.add(nativeCookie()); const result = await f.waitComplete();
  assert.ok(readCookieProbeSnapshot(result)); assert.equal(result.result, 'restored-same'); assert.equal(result.removalConfirmed, true); assert.equal(result.observedRestorations, 1); assert.equal(result.source, 'unknown'); assert.equal(result.cleanup, 'not-needed');
  assert.deepEqual(f.mutations.map(row => row.action), ['remove']); assertClean(f);
});
test('selected cookie probe: a replacement value is distinguished and never overwritten by cleanup', async () => {
  const f = await fixture(); await f.manager.start(f.start);
  f.add(nativeCookie({ value: 'DIFFERENT_IDENTIFIER_CANARY' })); const result = await f.waitComplete();
  assert.equal(result.result, 'recreated-different'); assert.equal(f.rows()[0].value, 'DIFFERENT_IDENTIFIER_CANARY'); assert.deepEqual(f.mutations.map(row => row.action), ['remove']); assertClean(f);
});
test('selected cookie probe: immediate recreation while remove Promise is pending retains the explicit removal event', async () => {
  const f = await fixture(); f.onRemove = cookie => f.add({ ...cookie });
  const result = await f.manager.start(f.start); assert.equal(result.result, 'restored-same'); assert.equal(result.status, 'complete'); assertClean(f);
});
test('selected cookie probe: cancellation waits for dispatched native remove before restoring the original', async () => {
  const f = await fixture(); let release;
  f.runtime.api.cookies.remove = query => new Promise(resolve => { release = () => {
    const original = f.rows()[0]; f.setRows([]); f.mutations.push({ action: 'remove', query }); f.emit(original, true); resolve({ name: original.name, storeId: original.storeId });
  }; });
  const starting = f.manager.start(f.start);
  for (let i = 0; i < 30 && !release; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof release, 'function');
  const { handle, ...base } = f.start;
  const cancelling = f.manager.cancel({ ...base, type: 'ui-cancel-cookie-probe' });
  await new Promise(resolve => setImmediate(resolve)); release();
  const result = await cancelling; await starting;
  assert.equal(result.result, 'cancelled'); assert.equal(result.cleanup, 'restored'); assert.equal(f.rows()[0].value, 'COOKIE_IDENTIFIER_CANARY_123'); assert.deepEqual(f.mutations.map(row => row.action), ['remove', 'set']); assertClean(f);
});
test('selected cookie probe: late remove after native timeout is recovered inside bounded cleanup grace', async () => {
  const f = await fixture();
  f.runtime.api.cookies.remove = query => new Promise(resolve => { setTimeout(() => {
    const original = f.rows()[0]; f.setRows([]); f.mutations.push({ action: 'remove', query }); f.emit(original, true); resolve({ name: original.name, storeId: original.storeId });
  }, 1100); });
  const result = await f.manager.start(f.start);
  assert.equal(result.result, 'failed'); assert.equal(result.reason, 'timeout'); assert.equal(result.cleanup, 'restored'); assert.equal(f.rows()[0].value, 'COOKIE_IDENTIFIER_CANARY_123'); assertClean(f);
});
test('selected cookie probe: unresolved native removal keeps the physical lock without retaining a backup or overlapping set', async () => {
  const f = await fixture(); let release;
  f.runtime.api.cookies.remove = () => new Promise(resolve => { release = resolve; });
  const result = await f.manager.start(f.start);
  assert.equal(result.result, 'failed'); assert.equal(result.reason, 'timeout'); assert.equal(result.cleanup, 'skipped');
  assert.equal(f.manager.active, null); assert.equal(f.manager.physical.size, 1); assert.equal(f.mutations.length, 0); assert.equal(f.listeners.size, 0); assert.equal(f.runtime.apiResults.operations.size, 0);
  assert.equal(JSON.stringify([...f.manager.results.values()]).includes('COOKIE_IDENTIFIER_CANARY'), false);
  assert.equal((await f.manager.start(f.start)).code, 'busy'); release(null);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(f.manager.physical.size, 0);
});
test('selected cookie probe: negative 10 second observation restores only the selected original cookie', async () => {
  const f = await fixture(); const initial = await f.manager.start(f.start); assert.equal(initial.status, 'watching'); assert.equal(f.rows().length, 0);
  const result = await f.advance(); assert.equal(result.result, 'not-restored'); assert.equal(result.cleanup, 'restored'); assert.equal(result.observedRestorations, 0); assert.equal(f.rows()[0].value, 'COOKIE_IDENTIFIER_CANARY_123'); assert.deepEqual(f.mutations.map(row => row.action), ['remove', 'set']); assertClean(f);
});
test('selected cookie probe: user cancellation restores original when current authorization remains valid', async () => {
  const f = await fixture(); await f.manager.start(f.start);
  const result = await f.manager.cancel({ ...f.start, type: 'ui-cancel-cookie-probe', handle: undefined });
  assert.equal(result.type, 'error');
  const { handle, ...request } = f.start;
  const cancelled = await f.manager.cancel({ ...request, type: 'ui-cancel-cookie-probe' });
  assert.equal(cancelled.result, 'cancelled'); assert.equal(cancelled.cleanup, 'restored'); assertClean(f);
});
test('selected cookie probe: observed user creation after final absence query prevents cleanup overwrite', async () => {
  const f = await fixture(); await f.manager.start(f.start);
  const original = f.runtime.api.cookies.getAll;
  f.runtime.api.cookies.getAll = async query => {
    const rows = await original(query);
    if (f.manager.active?.finishing) f.add(nativeCookie({ value: 'USER_UPDATED_IDENTIFIER_CANARY' }));
    return rows;
  };
  const result = await f.advance();
  assert.equal(result.cleanup, 'not-needed'); assert.equal(f.rows()[0].value, 'USER_UPDATED_IDENTIFIER_CANARY'); assert.deepEqual(f.mutations.map(row => row.action), ['remove']); assertClean(f);
});
test('selected cookie probe: navigation during final cleanup query discards backup without writing', async () => {
  const f = await fixture(); await f.manager.start(f.start);
  const original = f.runtime.api.cookies.getAll;
  f.runtime.api.cookies.getAll = async query => { const rows = await original(query); if (f.manager.active?.finishing) f.navigate(); return rows; };
  const result = await f.advance(); assert.equal(result.cleanup, 'skipped'); assert.deepEqual(f.mutations.map(row => row.action), ['remove']); assertClean(f);
});
test('selected cookie probe: positive event is reauthorized before publishing after native permission loss', async () => {
  const f = await fixture(); await f.manager.start(f.start);
  f.runtime.api.permissions.contains = async () => false;
  f.add(nativeCookie()); const result = await f.waitComplete();
  assert.equal(result.result, 'cancelled'); assert.equal(result.reason, 'access-changed'); assert.equal(result.cleanup, 'skipped'); assertClean(f);
});
for (const mode of ['revoke', 'unconsent', 'navigate', 'pause', 'changeStore', 'epoch']) test('selected cookie probe: ' + mode + ' during observation never writes stale cleanup scope', async () => {
  const f = await fixture(); await f.manager.start(f.start);
  if (mode === 'epoch') f.inspector.epoch++; else f[mode]();
  const result = await f.advance(); assert.equal(result.cleanup, 'skipped'); assert.deepEqual(f.mutations.map(row => row.action), ['remove']); assertClean(f);
});
for (const extra of [{ name: 'sessionid' }, { httpOnly: true }, { session: true }, { name: 'auth_token' }, { name: 'csrf' }, { expirationDate: 1700000005 }, { value: 'short' }, { value: 'x'.repeat(16385) }]) test('selected cookie probe: ineligible cookie ' + Object.keys(extra).join(',') + ' is never removed', async () => {
  const f = await fixture([nativeCookie(extra)]); const result = await f.manager.start(f.start);
  assert.equal(result.result, 'failed'); assert.equal(result.reason, 'not-eligible'); assert.equal(f.mutations.length, 0); assertClean(f);
});
test('selected cookie probe: metadata value accessors are denied without invoking the page getter', async () => {
  const cookie = nativeCookie(); let getters = 0;
  Object.defineProperty(cookie, 'value', { get() { getters++; throw Error('getter'); } });
  const f = await fixture([cookie]); const result = await f.manager.start(f.start);
  assert.equal(result.result, 'failed'); assert.equal(getters, 0); assert.equal(f.mutations.length, 0); assertClean(f);
});
test('selected cookie probe: duplicate names at host-only/domain identities deny ambiguous native removal', async () => {
  const f = await fixture([nativeCookie(), nativeCookie({ domain: 'www.example.com', hostOnly: true, value: 'HOST_ONLY_CANARY' })]);
  const result = await f.manager.start(f.start); assert.equal(result.reason, 'ambiguous-cookie'); assert.equal(f.mutations.length, 0); assertClean(f);
});
test('selected cookie probe: longer matching paths are guarded before cookies.remove', async () => {
  const f = await fixture([nativeCookie({ path: '/landing' }), nativeCookie({ path: '/' })]);
  // Select /landing: both URL-matching native identities would be eligible for native remove.
  const index = f.view.handles.findIndex(handle => f.inspector.values.handles.get(handle)?.identity.path === '/landing');
  const result = await f.manager.start({ ...f.start, handle: f.view.handles[index] });
  assert.equal(result.reason, 'ambiguous-cookie'); assert.equal(f.mutations.length, 0); assertClean(f);
});
test('selected cookie probe: unrelated paths, partitions and stores do not appear as restoration', async () => {
  const f = await fixture(); await f.manager.start(f.start);
  for (const extra of [{ path: '/other' }, { storeId: 'foreign-store' }, { partitionKey: { topLevelSite: 'https://other.test' } }, { domain: 'example.com', hostOnly: true }]) f.emit(nativeCookie(extra), false);
  assert.equal(f.manager.snapshot(f.start.documentKey).observedRestorations, 0);
  const result = await f.advance(); assert.equal(result.result, 'not-restored'); assertClean(f);
});
test('selected cookie probe: ordinary overwrite does not fabricate a confirmed explicit removal', async () => {
  const f = await fixture(); f.runtime.api.cookies.remove = async () => { f.emit(nativeCookie(), true, 'overwrite'); f.emit(nativeCookie(), false, 'explicit'); return { name: '_ga', storeId: 'test-store' }; };
  const result = await f.manager.start(f.start); assert.equal(result.result, 'failed'); assert.equal(result.reason, 'delete-failed'); assert.equal(result.removalConfirmed, false); assert.equal(result.observedRestorations, 0); assertClean(f);
});
test('selected cookie probe: no changed-event API causes no mutation', async () => {
  const f = await fixture(); delete f.runtime.api.cookies.onChanged;
  const result = await f.manager.start(f.start); assert.equal(result.reason, 'observation-unavailable'); assert.equal(f.mutations.length, 0); assertClean(f);
});
test('selected cookie probe: one active operation is bounded and forged start cannot choose native targets', async () => {
  const f = await fixture(); await f.manager.start(f.start);
  assert.equal((await f.manager.start(f.start)).code, 'busy');
  for (const extra of [{ handle: 'f'.repeat(32), domain: 'foreign.test' }, { frameId: 1, documentKey: '7:1:child' }, { url: 'https://foreign.test/' }]) assert.equal((await f.manager.start({ ...f.start, ...extra })).code, 'invalid-request');
  await f.advance(); assertClean(f);
});
test('selected cookie probe: value and identity canaries never enter snapshots, Pro callback or canonical documents', async () => {
  const f = await fixture([nativeCookie({ name: '_ga_PRIVATE_CANARY', path: '/landing', value: 'COOKIE_IDENTIFIER_CANARY_123' })]);
  await f.manager.start(f.start); const result = await f.advance();
  assert.ok(readCookieProbeDocuments([result]));
  const publicText = JSON.stringify([result, ...f.updates]);
  for (const forbidden of ['COOKIE_IDENTIFIER_CANARY', 'PRIVATE_CANARY', '/landing', 'test-store', f.start.handle, 'URL_SECRET_CANARY']) assert.equal(publicText.includes(forbidden), false, forbidden);
  assert.equal(publicText.includes('_ga_*'), true); assertClean(f);
});
test('selected cookie probe: bounded selected-value storage correlation exports fixed enums and counts only', async () => {
  const f = await fixture(); f.runtime.api.scripting = { executeScript: async details => {
    assert.equal(details.world, 'ISOLATED'); assert.deepEqual(details.args, ['_ga']); assert.equal(JSON.stringify(details).includes('COOKIE_IDENTIFIER_CANARY'), false);
    return [{ frameId: 0, result: { matchedStores: [{ storage: 'localStorage', count: 1 }, { storage: 'indexedDB', count: 2 }], storageCoverage: 'partial' } }];
  } };
  const result = await f.manager.start(f.start); assert.deepEqual(result.matchedStores, [{ storage: 'localStorage', count: 1 }, { storage: 'indexedDB', count: 2 }]); assert.equal(result.source, 'unknown');
  await f.advance(); assertClean(f);
});
test('selected cookie probe: malformed isolated correlation cannot put values, IDs or arbitrary storage names into snapshots', async () => {
  const f = await fixture(); f.runtime.api.scripting = { executeScript: async () => [{ frameId: 0, result: { matchedStores: [{ storage: 'indexedDB', count: 1, value: 'COOKIE_IDENTIFIER_CANARY' }], storageCoverage: 'active' } }] };
  const result = await f.manager.start(f.start); assert.deepEqual(result.matchedStores, []); assert.equal(result.storageCoverage, 'partial'); await f.advance(); assertClean(f);
});
