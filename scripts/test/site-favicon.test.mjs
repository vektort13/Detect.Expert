// ADR-035: trusted native identity, lifecycle revocation and bounded bitmap cache.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crc32, deflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { SITE_ICON_KEY, SITE_ICON_LIMITS, SiteFaviconCache, captureNativeSiteFavicon, readSiteIconCache, siteIconHost, siteIconPng } from '../../apps/production-extension/site-favicon.js';
import { createSiteIconStore, waitForSiteIcons } from '../../apps/production-extension/site-favicon-ui.js';
const now = 1800000000000;
function chunk(type, bytes) { const data = Buffer.from(type + '', 'ascii'), length = Buffer.alloc(4), checksum = Buffer.alloc(4); length.writeUInt32BE(bytes.length); checksum.writeUInt32BE(crc32(Buffer.concat([data, bytes]))); return Buffer.concat([length, data, bytes, checksum]); }
function png(width = 32, extra = Buffer.alloc(0), padding = 0) { const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(32, 4); header[8] = 8; header[9] = 6; return 'data:image/png;base64,' + Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', Buffer.concat([deflateSync(Buffer.alloc((width * 4 + 1) * 32)), Buffer.alloc(padding)])), extra, chunk('IEND', Buffer.alloc(0))]).toString('base64'); }
const bitmap = png();
function mock() {
  const data = {}, calls = { script: [], writes: [], reads: 0, frames: 0 }, mutable = { allowed: true, frameId: 'document-one', url: 'https://site.example.com/', favicon: 'https://site.example.com/favicon.png?FAVICON_QUERY_CANARY', incognito: false, lifecycle: 'active', perform: null };
  const api = { storage: { local: { async get(key) { calls.reads++; return { [key]: data[key] }; }, async set(value) { calls.writes.push(value); Object.assign(data, value); }, async remove(key) { delete data[key]; } } }, tabs: { async get(id) { return { id, url: mutable.url, favIconUrl: mutable.favicon, incognito: mutable.incognito }; }, async query() { return [{ id: 1 }]; } }, webNavigation: { async getFrame() { calls.frames++; return { documentId: mutable.frameId, url: mutable.url, documentLifecycle: mutable.lifecycle }; } }, scripting: { executeScript(details) { calls.script.push(details); return mutable.perform ? mutable.perform(details) : Promise.resolve([{ frameId: 0, result: bitmap }]); } } };
  const cache = new SiteFaviconCache(api, { authorize: () => mutable.allowed, host: () => 'example.com', now: () => now });
  return { api, data, calls, mutable, cache };
}
const row = (host = 'example.com', changes = {}) => ({ host, png: bitmap, at: now, ...changes });
const tick = () => new Promise(resolve => setImmediate(resolve));
function rasterCapture(width, height, loaded = true) {
  let draw = null, image;
  const window = {}; window.top = window;
  class Image { constructor() { image = this; this.naturalWidth = width; this.naturalHeight = height; } set src(value) { if (value) queueMicrotask(() => loaded ? this.onload?.() : this.onerror?.()); } }
  const context = { Image, window, location: { origin: 'https://example.com' }, URL, setTimeout, clearTimeout, document: { createElement: () => ({ getContext: () => ({ drawImage(_image, ...args) { draw = args; } }), toDataURL: () => bitmap }) } };
  return { capture: runInNewContext('(' + captureNativeSiteFavicon.toString() + ')', context), result: () => ({ draw, viewport: { width: image.width, height: image.height } }) };
}
test('only exact normalized public host strings become cache keys; no coercion', () => {
  assert.equal(siteIconHost('example.com'), 'example.com'); assert.equal(siteIconHost('xn--e1afmkfd.xn--p1ai'), 'xn--e1afmkfd.xn--p1ai');
  for (const input of ['https://example.com/', 'Example.com', 'example.com.', '..example.com', '-bad.example.com', 'example.com/path', '127.0.0.1', 'localhost', 'page.local', '__proto__', null]) assert.equal(siteIconHost(input), null, String(input));
  let coerced = 0; assert.equal(siteIconHost({ toString() { coerced++; throw Error(); } }), null); assert.equal(coerced, 0);
});
test('the image cache accepts only 32×32 PNG data with bounded structural chunks', () => {
  assert.equal(siteIconPng(bitmap), bitmap);
  for (const input of [png(31), bitmap + 'A', 'data:image/svg+xml;base64,PHN2Zz4=', png(32, chunk('tEXt', Buffer.from('URL_CANARY'))), png(32, Buffer.alloc(0), 17000), 'data:image/png;base64,AA==']) assert.equal(siteIconPng(input), null);
});
test('successfully loaded browser-native SVG with no intrinsic dimensions rasterizes in a 32px viewport', async () => {
  const { capture, result } = rasterCapture(0, 0); assert.equal(await capture('https://example.com', 'data:image/svg+xml;base64,PHN2Zy8+'), bitmap);
  assert.deepEqual(result(), { draw: [0, 0, 32, 32], viewport: { width: 32, height: 32 } });
});
test('SVG exception cannot admit HTTP/non-SVG empty images or failed SVG decoding', async () => {
  for (const source of ['https://example.com/favicon.svg', 'data:image/png;base64,AA==']) assert.equal(await rasterCapture(0, 0).capture('https://example.com', source), null);
  assert.equal(await rasterCapture(0, 0, false).capture('https://example.com', 'data:image/svg+xml;base64,PHN2Zy8+'), null);
  assert.equal(await rasterCapture(1025, 32).capture('https://example.com', 'data:image/svg+xml;base64,PHN2Zy8+'), null);
});
test('cache drops stale, future, duplicate and malformed records', () => {
  const entries = readSiteIconCache({ version: 1, entries: [row(), row(), row('stale.com', { at: now - SITE_ICON_LIMITS.ttlMs - 1 }), row('future.com', { at: now + 60001 }), row('malformed.com', { sourceUrl: 'RAW_CANARY' }), row('valid.com', { at: now - 10 })] }, now);
  assert.deepEqual(entries.map(entry => entry.host), ['example.com', 'valid.com']); assert.equal(JSON.stringify(entries).includes('CANARY'), false);
});
test('cache size and total encoded bytes are bounded', () => {
  assert.deepEqual(readSiteIconCache({ version: 1, entries: Array(65).fill(row()) }, now), []);
  const large = png(32, Buffer.alloc(0), 15000), entries = readSiteIconCache({ version: 1, entries: Array.from({ length: 64 }, (_, index) => row('host' + index + '.com', { png: large })) }, now);
  assert.ok(entries.length < 64); assert.ok(entries.reduce((bytes, entry) => bytes + entry.png.length + entry.host.length + 80, 128) <= SITE_ICON_LIMITS.cacheBytes);
});
test('native capture uses only the live top frame in ISOLATED and persists no source URL', async () => {
  const { cache, calls, data } = mock(); await cache.collect(1);
  assert.equal(calls.script.length, 1); assert.equal(calls.script[0].world, 'ISOLATED'); assert.deepEqual(calls.script[0].target, { tabId: 1, frameIds: [0] });
  assert.deepEqual(data[SITE_ICON_KEY].entries, [row()]); assert.equal(JSON.stringify(data).includes('FAVICON_QUERY_CANARY'), false); assert.equal(JSON.stringify(data).includes('https:'), false);
});

test('a valid native top-frame identity never enumerates or normalizes child frames', async () => {
  const { api, cache, data, calls } = mock(); let enumerated = 0;
  api.webNavigation.getAllFrames = async () => { enumerated++; throw Error('normalization must not run'); };
  await cache.collect(1); assert.equal(enumerated, 0); assert.equal(calls.script.length, 1); assert.deepEqual(data[SITE_ICON_KEY].entries, [row()]);
});

test('Firefox raw getFrame without ID uses the existing normalized top-frame identity before and after capture', async () => {
  const { api, cache, data, calls, mutable } = mock(); let enumerated = 0;
  api.webNavigation.getFrame = async () => ({ url: mutable.url, errorOccurred: false });
  api.webNavigation.getAllFrames = async () => { enumerated++; return [{ frameId: 7, documentId: 'child-document', url: 'https://child.example.com/', documentLifecycle: 'active' }, { frameId: 0, documentId: mutable.frameId, url: mutable.url, documentLifecycle: 'active' }]; };
  await cache.collect(1); assert.equal(enumerated, 2); assert.equal(calls.script.length, 1); assert.deepEqual(calls.script[0].target, { tabId: 1, frameIds: [0] }); assert.deepEqual(data[SITE_ICON_KEY].entries, [row()]);
});

test('missing-ID normalization rejects oversized, ambiguous, stale, inactive and failed native metadata', async () => {
  const top = { frameId: 0, documentId: 'document-one', url: 'https://site.example.com/', documentLifecycle: 'active' };
  for (const frames of [null, Array(129).fill(top), [], [{ ...top, frameId: 1 }], [top, top], [{ ...top, documentId: '' }], [{ ...top, url: 'https://other.example.com/' }], [{ ...top, documentLifecycle: 'cached' }], [{ ...top, documentLifecycle: 'prerender' }], [{ ...top, documentLifecycle: undefined }], [{ ...top, errorOccurred: true }]]) {
    const { api, cache, calls, data } = mock(); api.webNavigation.getFrame = async () => ({ url: top.url }); api.webNavigation.getAllFrames = async () => frames;
    await cache.collect(1); assert.equal(calls.script.length, 0); assert.equal(data[SITE_ICON_KEY], undefined);
  }
  for (const native of [null, { url: top.url, documentId: '' }, { url: top.url, errorOccurred: true }, { url: top.url, documentLifecycle: 'cached' }, { url: top.url, documentLifecycle: 'pending_deletion' }]) {
    const { api, cache, calls } = mock(); let enumerated = 0; api.webNavigation.getFrame = async () => native; api.webNavigation.getAllFrames = async () => { enumerated++; return [top]; };
    await cache.collect(1); assert.equal(enumerated, 0); assert.equal(calls.script.length, 0);
  }
  const { api, cache, calls } = mock(); api.webNavigation.getFrame = async () => ({ url: top.url }); api.webNavigation.getAllFrames = async () => { throw Error('native normalization failure'); };
  await cache.collect(1); assert.equal(calls.script.length, 0);
});

test('normalized identity, origin and error changes during capture cannot persist a stale icon', async () => {
  for (const changes of [{ frameId: 'document-two' }, { url: 'https://new.example.com/' }, { errorOccurred: true }, { lifecycle: 'pending_deletion' }]) {
    const { api, cache, calls, data, mutable } = mock();
    api.webNavigation.getFrame = async () => ({ url: mutable.url, errorOccurred: mutable.errorOccurred, documentLifecycle: mutable.lifecycle });
    api.webNavigation.getAllFrames = async () => [{ frameId: 0, documentId: mutable.frameId, url: mutable.url, documentLifecycle: 'active' }];
    mutable.perform = async () => { Object.assign(mutable, changes); return [{ frameId: 0, result: bitmap }]; };
    await cache.collect(1); assert.equal(calls.script.length, 1); assert.equal(data[SITE_ICON_KEY], undefined);
  }
});

test('scope revocation during native identity normalization prevents favicon injection and storage', async () => {
  const { api, cache, calls, data, mutable } = mock(); api.webNavigation.getFrame = async () => ({ url: mutable.url });
  api.webNavigation.getAllFrames = async () => { mutable.allowed = false; return [{ frameId: 0, documentId: mutable.frameId, url: mutable.url, documentLifecycle: 'active' }]; };
  await cache.collect(1); assert.equal(calls.script.length, 0); assert.equal(data[SITE_ICON_KEY], undefined);
});
test('consent or scope denial prevents capture and writes', async () => {
  const { cache, mutable, calls } = mock(); mutable.allowed = false; await cache.collect(1); assert.equal(calls.script.length, 0); assert.equal(calls.writes.length, 0);
});
test('collection waits for native runtime hydration', async () => {
  const { api, calls } = mock(); let finish; const ready = new Promise(resolve => { finish = resolve; });
  const cache = new SiteFaviconCache(api, { ready, authorize: () => false, host: () => 'example.com' }), job = cache.collect(1);
  await Promise.resolve(); assert.equal(calls.frames, 0); finish(); await job; assert.equal(calls.script.length, 0);
});
test('missing native identity and prerender/cached/incognito pages cannot be captured', async () => {
  for (const changes of [{ frameId: undefined }, { lifecycle: 'prerender' }, { lifecycle: 'cached' }, { lifecycle: 'pending_deletion' }, { incognito: true }, { favicon: '' }, { url: 'chrome-extension://id/popup.html' }]) {
    const { cache, mutable, calls } = mock(); Object.assign(mutable, changes); await cache.collect(1); assert.equal(calls.script.length, 0, JSON.stringify(changes));
  }
});
test('a document replaced during capture never populates the cache', async () => {
  const { cache, mutable, data, calls } = mock(); let finish; mutable.perform = () => new Promise(resolve => { finish = resolve; }); const job = cache.collect(1);
  while (!calls.script.length) await tick(); mutable.frameId = 'document-two'; finish([{ frameId: 0, result: bitmap }]); await job; assert.equal(data[SITE_ICON_KEY], undefined);
});
test('a changed native favicon is discarded rather than assigned to the new page', async () => {
  const { cache, mutable, data } = mock(); mutable.perform = async () => { mutable.favicon = 'https://site.example.com/next.png'; return [{ frameId: 0, result: bitmap }]; };
  await cache.collect(1); assert.equal(data[SITE_ICON_KEY], undefined);
});
test('permission revocation clears retained PNGs and cancels pending storage writes', async () => {
  const { cache, mutable, calls, data } = mock(); await cache.collect(1); assert.ok(data[SITE_ICON_KEY]); await cache.invalidate(); assert.equal(data[SITE_ICON_KEY], undefined);
  let finish; mutable.perform = () => new Promise(resolve => { finish = resolve; }); const job = cache.collect(2); while (calls.script.length < 2) await tick(); mutable.allowed = false; await cache.invalidate(); finish([{ frameId: 0, result: bitmap }]); await job; assert.equal(data[SITE_ICON_KEY], undefined);
});
test('cached icon avoids repeat capture within the same native document', async () => {
  const { cache, calls, mutable } = mock(); await cache.collect(1); await cache.collect(1); assert.equal(calls.script.length, 1);
  mutable.frameId = 'document-two'; await cache.collect(1); assert.equal(calls.script.length, 2);
});
test('only four simultaneous physical injections are permitted', async () => {
  const { cache, calls, mutable } = mock(); const finishers = []; mutable.perform = () => new Promise(resolve => finishers.push(resolve));
  const jobs = Array.from({ length: 8 }, (_, index) => cache.collect(index + 1)); while (calls.script.length < 4) await tick(); assert.equal(calls.script.length, 4);
  for (const finish of finishers) finish([{ frameId: 0, result: bitmap }]); await Promise.all(jobs); assert.equal(cache.physical.size, 0);
});
test('malformed capture result cannot become an image cache entry', async () => {
  const { cache, mutable, data } = mock(); mutable.perform = async () => [{ frameId: 0, result: 'data:image/svg+xml;base64,PHN2Zz4=' }]; await cache.collect(1); assert.equal(data[SITE_ICON_KEY], undefined);
});
test('native tab removal removes only the ephemeral document binding', async () => {
  const { cache, data } = mock(); await cache.collect(1); cache.removed(1); assert.equal(cache.tabs.size, 0); assert.ok(data[SITE_ICON_KEY]);
});
test('native startup refresh removes physically expired cache entries before enumerating tabs', async () => {
  const { cache, mutable, data, calls } = mock(); mutable.allowed = false; data[SITE_ICON_KEY] = { version: 1, entries: [row(), row('old.com', { at: now - SITE_ICON_LIMITS.ttlMs - 1 })] };
  await cache.refresh(); assert.deepEqual(data[SITE_ICON_KEY].entries.map(entry => entry.host), ['example.com']); assert.equal(calls.script.length, 0);
});
test('a persisted null cache is physically removed and does not stop startup tab enumeration', async () => {
  const { cache, mutable, data, calls } = mock(); mutable.allowed = false; data[SITE_ICON_KEY] = null;
  await cache.refresh(); assert.equal(data[SITE_ICON_KEY], undefined); assert.ok(calls.frames > 0); assert.equal(calls.script.length, 0);
});
test('same-document favicon changes trigger a fresh capture with only a source digest retained', async () => {
  const { cache, mutable, calls } = mock(); await cache.collect(1); const before = cache.tabs.get(1).sourceKey;
  mutable.favicon = 'https://site.example.com/new.png?SECOND_URL_CANARY'; await cache.collect(1);
  assert.equal(calls.script.length, 2); assert.equal(calls.script[1].args[1], mutable.favicon); assert.notEqual(cache.tabs.get(1).sourceKey, before);
  assert.equal(JSON.stringify([...cache.tabs]).includes('CANARY'), false);
});
test('updates during a job coalesce into one fresh native capture', async () => {
  const { cache, mutable, calls, data } = mock(); let finish;
  mutable.perform = () => calls.script.length === 1 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve([{ frameId: 0, result: bitmap }]);
  const job = cache.collect(1); while (!calls.script.length) await tick(); mutable.favicon = 'https://site.example.com/updated.png';
  await cache.collect(1); await cache.collect(1); finish([{ frameId: 0, result: bitmap }]); await job;
  assert.equal(calls.script.length, 2); assert.equal(calls.script[1].args[1], mutable.favicon); assert.ok(data[SITE_ICON_KEY]); assert.equal(cache.dirty.size, 0);
});
test('revocation removes a coalesced favicon retry', async () => {
  const { cache, mutable, calls } = mock(); let finish; mutable.perform = () => new Promise(resolve => { finish = resolve; });
  const job = cache.collect(1); while (!calls.script.length) await tick(); await cache.collect(1); mutable.allowed = false; await cache.invalidate(); finish([{ frameId: 0, result: bitmap }]); await job;
  assert.equal(calls.script.length, 1); assert.equal(cache.dirty.size, 0);
});
test('decorative cache remove failure cannot stop actual permission/protection reconciliation', async () => {
  const source = readFileSync(new URL('../../apps/production-extension/background.js', import.meta.url), 'utf8');
  const start = source.indexOf('  async onPermissionsChanged() {\n    await this.siteIcons.invalidate'), end = source.indexOf('  reconcileAccess(', start);
  assert.ok(start > 0 && end > start, 'production permission method is integrated');
  const method = Function('return ({' + source.slice(start, end) + '}).onPermissionsChanged;')();
  let releaseHistory;
  const history = new Promise(resolve => { releaseHistory = resolve; });
  const steps = [], part = { clear() {}, invalidate() {}, flush: async () => {} }, runtime = {
    siteIcons: { invalidate: async () => { throw Error('storage failure'); }, refresh: async () => { steps.push('favicon refresh'); } },
    proCookieValues: { clear() { steps.push('cookie values cleared'); } },
    proRequestValues: { clear() { steps.push('request values cleared'); } },
    cookieWriters: { clear() { steps.push('cookie writers cleared'); } },
    cookies: part, social: part, dbsc: part, thirdParty: part, beacons: part, backgroundActivity: part, cookieProbe: part, apiResults: part, googleIds: part, responseHeaders: part, networkAttempts: part, visual: part, rtc: part, vendorRedirects: part,
    ready: Promise.resolve(), documentAccess: new Map(), badge: { markAll() {} }, scope: { async onPermissionsChanged() { steps.push('scope'); } }, protection: { async accessChanged() { steps.push('protection'); } }, pro: { vendorRedirects: part, onPermissionsChanged() { steps.push('recording'); } },
    async ensureHistory() { steps.push('history'); await history; },
    async reconcile() { steps.push('documents'); }, reconcileAccess() {}, dirtyDocs: new Set(), async flushIndex() {}
  };
  const pending = method.call(runtime); await tick();
  assert.deepEqual(steps, ['cookie values cleared', 'request values cleared', 'cookie writers cleared', 'scope', 'protection', 'recording', 'history'], 'authority settles before document reconciliation or favicon refresh');
  releaseHistory(); await pending;
  assert.deepEqual(steps, ['cookie values cleared', 'request values cleared', 'cookie writers cleared', 'scope', 'protection', 'recording', 'history', 'documents', 'favicon refresh']);
  steps.length = 0;
  runtime.ensureHistory = async () => { steps.push('history'); throw Error('authority unavailable'); };
  await assert.rejects(method.call(runtime), /authority unavailable/);
  assert.deepEqual(steps, ['cookie values cleared', 'request values cleared', 'cookie writers cleared', 'scope', 'protection', 'recording', 'history'], 'an unread authority cannot start document reconciliation or favicon capture');
});
test('thousands of report icons share one storage read and listener and clean up at UI unmount', async () => {
  let reads = 0, added = 0, removed = 0, finish; const listeners = new Set(), values = [];
  const api = { storage: { local: { get() { reads++; return new Promise(resolve => { finish = resolve; }); } }, onChanged: { addListener(listener) { added++; listeners.add(listener); }, removeListener(listener) { removed++; listeners.delete(listener); } } } };
  const store = createSiteIconStore(api), cleanups = Array.from({ length: 2501 }, () => store.subscribe(value => { values.push(value.state); }));
  assert.equal(reads, 1); assert.equal(added, 1); finish({ [SITE_ICON_KEY]: { version: 1, entries: [row('example.com', { at: Date.now() })] } }); await tick();
  assert.equal(values.filter(value => value === 'ready').length, 2501);
  for (const cleanup of cleanups) cleanup(); assert.equal(removed, 1); assert.equal(listeners.size, 0);
});
test('shared store bounds subscribers and cannot apply an outdated storage read after a change', async () => {
  let finish, changed; const api = { storage: { local: { get: () => new Promise(resolve => { finish = resolve; }) }, onChanged: { addListener(listener) { changed = listener; }, removeListener() {} } } };
  const store = createSiteIconStore(api), snapshots = [], cleanups = Array.from({ length: 4096 }, () => store.subscribe(() => {}));
  const overBudget = store.subscribe(value => snapshots.push(value)); assert.equal(snapshots[0].state, 'ready'); assert.equal(snapshots[0].icons.size, 0);
  changed({ [SITE_ICON_KEY]: { newValue: { version: 1, entries: [] } } }, 'local'); finish({ [SITE_ICON_KEY]: { version: 1, entries: [row('old.com', { at: Date.now() })] } }); await tick();
  cleanups[0](); const cleanup = store.subscribe(value => snapshots.push(value)); assert.equal(snapshots.at(-1).icons.has('old.com'), false);
  cleanup(); overBudget(); for (const remove of cleanups.slice(1)) remove();
});
test('shared store timeout settles and does not keep late failed reads pending', async () => {
  const api = { storage: { local: { get: () => new Promise(() => {}) }, onChanged: { addListener() {}, removeListener() {} } } }, store = createSiteIconStore(api, { timeoutMs: 5 });
  let resolve; const complete = new Promise(done => { resolve = done; }), cleanup = store.subscribe(value => { if (value.state === 'ready') resolve(value); });
  assert.equal((await complete).icons.size, 0); cleanup();
});
const documentWith = icons => ({ querySelectorAll: () => icons });
const icon = (state, images = []) => ({ getAttribute: () => state, querySelectorAll: () => images });
test('print readiness accepts empty/fallback icons and decoded cached PNGs', async () => {
  assert.equal(await waitForSiteIcons(documentWith([])), true); assert.equal(await waitForSiteIcons(documentWith([icon('fallback')])), true);
  assert.equal(await waitForSiteIcons(documentWith([icon('ready', [{ complete: true, naturalWidth: 32, decode: async () => {} }])])), true);
});
test('print waits for asynchronous cache resolution before accepting the report', async () => {
  let state = 'pending', settled = false; const item = { getAttribute: () => state, querySelectorAll: () => [] };
  const job = waitForSiteIcons(documentWith([item]), 500).then(value => { settled = true; return value; }); await Promise.resolve(); assert.equal(settled, false); state = 'fallback'; assert.equal(await job, true);
});
test('failed and empty image decode prevents an incomplete print', async () => {
  assert.equal(await waitForSiteIcons(documentWith([icon('ready', [{ complete: true, naturalWidth: 32, decode: async () => { throw Error('decode'); } }])])), false);
  assert.equal(await waitForSiteIcons(documentWith([icon('ready', [{ complete: true, naturalWidth: 0 }])])), false);
});
test('hanging cache/decode has a bounded print deadline', async () => {
  assert.equal(await waitForSiteIcons(documentWith([icon('pending')]), 5), false);
  assert.equal(await waitForSiteIcons(documentWith([icon('ready', [{ decode: () => new Promise(() => {}) }])]), 5), false);
});
test('faulty DOM and excessive icons settle false without async exceptions', async () => {
  assert.equal(await waitForSiteIcons({ querySelectorAll() { throw Error('DOM'); } }), false);
  assert.equal(await waitForSiteIcons(documentWith([{ getAttribute() { throw Error('state'); } }])), false);
  assert.equal(await waitForSiteIcons(documentWith(Array(4097).fill(icon('fallback')))), false);
});
test('the legitimate maximum Pro report icon count remains printable', async () => {
  assert.equal(await waitForSiteIcons(documentWith(Array(2501).fill(icon('fallback')))), true);
});
