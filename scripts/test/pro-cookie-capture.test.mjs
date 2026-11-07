import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProCookieCapture } from '../../apps/production-extension/pro-cookie-capture.js';
import { CookieInspector } from '../../apps/production-extension/cookie-inspector.js';
import { readCookieSnapshot, readSocialDocuments, readSocialRows } from '../../packages/contracts/src/inspection.mjs';

const drain = async () => { for (let index = 0; index < 4; index++) await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
class Timers {
  next = 0; tasks = new Map();
  setTimeout(callback, delay) { const id = ++this.next; this.tasks.set(id, { callback, delay }); return id; }
  clearTimeout(id) { this.tasks.delete(id); }
  fire(delay) { for (const [id, task] of [...this.tasks]) if (task.delay === delay) { this.tasks.delete(id); task.callback(); } }
}
const socialRow = (changes = {}) => ({ service: 'facebook', kind: 'tracking-pixel', endpoint: 'pixel', method: 'GET', requestType: 'image', count: 1, evidenceSource: 'page-hook', integrity: 'page-controlled', attributionConfidence: 'exact-resource', initiatorHost: null, script: { host: 'example.test', pathTemplate: '/tracker.js' }, ...changes });
const socialSnapshot = (key, rows = [socialRow()]) => ({ schemaVersion: 1, type: 'social-networks-state', documentKey: key, coverageState: 'active', rows, truncated: false });
function fixture(count = 1) {
  let now = 1700000000000, deadline = true, documentAllowed = true;
  const timers = new Timers(), cookieCalls = [], socialCalls = [], sizes = [], persisted = [];
  const pages = Array.from({ length: count }, (_, index) => ({ id: 'page-' + index, tabId: index + 7, documentKey: `${index + 7}:0:doc${index}`, endedAt: null }));
  const current = new Map(pages.map(page => [page.tabId, page])), projections = new Map(pages.map(page => [`${page.tabId}:0`, { documentKey: page.documentKey, coverageState: 'active' }]));
  const runtime = {
    now: () => now, scope: { accessGeneration: 1, hasDataConsent: true },
    state: { reports: new Map() }, getProjection: (tab, frame) => projections.get(`${tab}:${frame}`), canObserveNetworkDocument: () => documentAllowed,
    cookies: { epoch: 1, read: async (request, context) => { cookieCalls.push({ request, context }); } },
    social: { read: async request => { socialCalls.push(request); return socialSnapshot(request.documentKey); } },
  };
  const pro = {
    runtime, session: { id: 'recording-1', pages }, currentPages: new Map(pages.map(page => [page.tabId, page.id])),
    pageFor: tab => current.get(tab), pageById: id => [...current.values()].find(page => page.id === id), belongsToPage: (key, page) => key.startsWith(page.tabId + ':'),
    checkDeadline: () => deadline, size: (key, value) => { sizes.push([key, value]); return true; }, mark() {},
    flush: async () => { persisted.push(JSON.stringify(pro.session.pages)); },
  };
  const capture = new ProCookieCapture(pro, timers); capture.running = true;
  return { capture, pro, runtime, pages, timers, cookieCalls, socialCalls, sizes, persisted, current, projections, tick: ms => { now += ms; }, expire: () => { deadline = false; }, denyDocument: () => { documentAllowed = false; } };
}

test('Pro capture: closed UI records only cookie metadata and authorized social scripts', async () => {
  const f = fixture();
  try {
    f.runtime.cookies.read = async (request, context) => {
      f.cookieCalls.push({ request, context }); assert.equal(context.current(), true);
      assert.equal(request.type, 'ui-get-cookies'); assert.equal(Object.hasOwn(request, 'handle'), false);
      f.pages[0].cookies = { documentKey: request.documentKey, entries: [] };
    };
    f.capture.start(); await drain();
    assert.equal(f.cookieCalls.length, 1); assert.equal(f.socialCalls.length, 1);
    assert.ok(readSocialDocuments(f.pages[0].socialNetworks)); assert.ok(f.persisted.length);
    assert.equal(f.capture.pending.size, 0);
  } finally { f.capture.stop(); }
});
test('Pro capture: fair refresh does not duplicate a pending page or starve another current page', async () => {
  const f = fixture(3);
  try {
    await f.capture.capture(); await f.capture.capture(); await f.capture.capture();
    assert.deepEqual(f.cookieCalls.map(call => call.request.tabId), [7, 8, 9]);
    f.tick(5001); await f.capture.capture(); assert.equal(f.cookieCalls.length, 5);
    await f.capture.capture(true); assert.equal(f.cookieCalls.length, 7);
  } finally { f.capture.stop(); }
});
test('Pro capture: current-page budget remains bounded when recording has twenty pages', async () => {
  const f = fixture(20);
  try { for (let index = 0; index < 12; index++) await f.capture.capture(); assert.equal(new Set(f.cookieCalls.map(call => call.request.tabId)).size, 16); assert.ok(f.cookieCalls.every(call => call.request.tabId < 23)); }
  finally { f.capture.stop(); }
});
test('Pro capture: unsettled physical slots survive wait timeout, stop, and a new recording', async () => {
  const f = fixture(3), gate = deferred();
  f.runtime.cookies.read = async (request, context) => { f.cookieCalls.push({ request, context }); await gate.promise; };
  const first = f.capture.capture(); await drain(); const duplicate = f.capture.capture(true); await drain();
  assert.equal(f.cookieCalls.length, 2); assert.equal(f.capture.pending.size, 2);
  f.capture.stop(); f.pro.session = { id: 'recording-2', pages: f.pages }; f.capture.running = true;
  const next = f.capture.capture(true); await drain(); assert.equal(f.cookieCalls.length, 2);
  f.timers.fire(6000); await Promise.all([first, duplicate, next]); assert.equal(f.capture.pending.size, 2);
  gate.resolve(); await drain(); assert.equal(f.capture.pending.size, 0); assert.equal(f.socialCalls.length, 0);
  try { await f.capture.capture(true); assert.equal(f.cookieCalls.length, 4); assert.ok(f.socialCalls.length > 0); }
  finally { f.capture.stop(); }
});
for (const change of ['stop', 'recording', 'page', 'navigation', 'generation', 'cookie-epoch', 'consent', 'pause', 'ended', 'deadline', 'document-access']) {
  test('Pro capture: ' + change + ' while cookie read is pending cannot retain social results', async () => {
    const f = fixture(), gate = deferred(); f.runtime.cookies.read = () => gate.promise;
    const work = f.capture.capture(); await drain();
    if (change === 'stop') f.capture.stop();
    if (change === 'recording') f.pro.session = { ...f.pro.session };
    if (change === 'page') f.current.set(7, { ...f.pages[0] });
    if (change === 'navigation') f.projections.set('7:0', { documentKey: '7:0:new', coverageState: 'active' });
    if (change === 'generation') ++f.runtime.scope.accessGeneration;
    if (change === 'cookie-epoch') ++f.runtime.cookies.epoch;
    if (change === 'consent') f.runtime.scope.hasDataConsent = false;
    if (change === 'pause') f.projections.get('7:0').coverageState = 'paused';
    if (change === 'ended') f.pages[0].endedAt = 1700000000001;
    if (change === 'deadline') f.expire();
    if (change === 'document-access') f.denyDocument();
    gate.resolve(); await work;
    assert.equal(f.socialCalls.length, 0); assert.equal(f.pages[0].socialNetworks, undefined); f.capture.stop();
  });
}
test('Pro capture: cancellation while social read is pending removes the result before persistence', async () => {
  const f = fixture(), gate = deferred(); f.runtime.social.read = () => gate.promise;
  const work = f.capture.capture(); await drain(); ++f.runtime.scope.accessGeneration;
  gate.resolve(socialSnapshot(f.pages[0].documentKey)); await work;
  assert.equal(f.pages[0].socialNetworks, undefined); assert.equal(f.persisted.length, 0); f.capture.stop();
});
test('Pro capture: cancellation during flush removes only its own social snapshot and accounting', async () => {
  const f = fixture(); let first = true;
  f.pro.flush = async () => { if (first) { first = false; ++f.runtime.scope.accessGeneration; } };
  try { await f.capture.capture(); assert.equal(f.pages[0].socialNetworks, undefined); assert.ok(f.sizes.some(([key, bytes]) => key === 'social:page-0' && bytes === 0)); }
  finally { f.capture.stop(); }
});
test('Pro capture: a newer social snapshot is not erased by a canceled older flush', async () => {
  const f = fixture(), newer = [socialSnapshot('7:0:doc0', [socialRow({ service: 'instagram' })])];
  f.pro.flush = async () => { f.pages[0].socialNetworks = newer; ++f.runtime.scope.accessGeneration; };
  try { await f.capture.capture(); assert.equal(f.pages[0].socialNetworks, newer); assert.equal(f.sizes.some(([, bytes]) => bytes === 0), false); }
  finally { f.capture.stop(); }
});
test('Pro capture: social results with wrong document, unvalidated payload, or unavailable coverage are not recorded', async () => {
  for (const response of [socialSnapshot('7:0:other'), { ...socialSnapshot('7:0:doc0'), token: 'SECRET' }, { ...socialSnapshot('7:0:doc0'), coverageState: 'no-access' }]) {
    const f = fixture(); f.runtime.social.read = async () => response;
    try { await f.capture.capture(); assert.equal(f.pages[0].socialNetworks, undefined); assert.equal(f.persisted.length, 0); }
    finally { f.capture.stop(); }
  }
});
test('Pro capture: authorized child documents and total social rows are bounded and distinguish truncation', async () => {
  const f = fixture();
  for (let frame = 1; frame <= 30; frame++) {
    const key = `7:${frame}:child${frame}`; f.runtime.state.reports.set(key, { tabId: 7, frameId: frame, documentKey: key });
    f.projections.set(`7:${frame}`, { documentKey: key, coverageState: 'active' });
  }
  f.runtime.social.read = async request => { f.socialCalls.push(request); return socialSnapshot(request.documentKey, Array.from({ length: 64 }, () => socialRow())); };
  try {
    await f.capture.capture(); const documents = f.pages[0].socialNetworks;
    assert.ok(readSocialDocuments(documents)); assert.equal(documents.length, 24); assert.equal(f.socialCalls.length, 24);
    assert.equal(documents.reduce((sum, document) => sum + document.rows.length, 0), 256);
    assert.ok(documents.slice(4).every(document => document.truncated && document.rows.length === 0));
  } finally { f.capture.stop(); }
});

function cookieFixture() {
  const f = fixture(), page = f.pages[0]; let permission = true, queryCount = 0, valueReads = 0, prompts = 0;
  f.runtime.isReady = true; f.runtime.scope.isHostGrantedSync = () => true;
  const secret = { name: '_ga_SESSION_CANARY', domain: '.example.test', path: '/', storeId: 'selected-container', hostOnly: false, secure: true, httpOnly: false, session: false, sameSite: 'lax', expirationDate: 1900000000 };
  Object.defineProperty(secret, 'value', { get() { ++valueReads; throw Error('private value'); } });
  f.runtime.apiResults = { authorize: async request => f.runtime.getProjection(request.tabId, request.frameId)?.documentKey === request.documentKey };
  f.runtime.api = {
    permissions: { contains: async () => permission, request: async () => { ++prompts; throw Error('unsolicited permission prompt'); } },
    cookies: { getAllCookieStores: async () => [{ id: 'selected-container', tabIds: [7] }], getAll: async () => { ++queryCount; return [secret]; } },
    webNavigation: { getAllFrames: async () => [{ frameId: 0, documentId: 'doc0', url: 'https://www.example.test/path?URL_SECRET_CANARY' }] },
  };
  const inspector = new CookieInspector(f.runtime, { host: raw => new URL(raw).hostname, site: host => host.endsWith('.example.test') ? 'example.test' : host, redact: () => ({ kind: 'registrable', value: 'example.test' }) });
  f.runtime.cookies = inspector; f.runtime.pro = f.pro;
  return { ...f, inspector, page, secret, request: { schemaVersion: 1, type: 'ui-get-cookies', tabId: 7, frameId: 0, documentKey: page.documentKey }, revoke: () => { permission = false; }, stats: () => ({ queryCount, valueReads, prompts }) };
}
test('Pro CookieInspector integration: no open UI, no value reads, removed bound membership stays absent', async () => {
  const f = cookieFixture(); f.runtime.dbsc = { classifyCookie: () => 'matched' };
  try {
    f.capture.start(); await drain(); const snapshot = f.page.cookies;
    assert.ok(readCookieSnapshot(snapshot)); assert.equal(snapshot.entries[0].boundSessionStatus, undefined); assert.equal(snapshot.entries[0].tpmProtected, undefined);
    assert.deepEqual(f.stats(), { queryCount: 4, valueReads: 0, prompts: 0 });
    assert.doesNotMatch(JSON.stringify(snapshot), /SESSION_CANARY|URL_SECRET_CANARY|"value"|"handle"/);
  } finally { f.capture.stop(); }
});
test('Pro CookieInspector integration: absent optional permission never prompts or queries cookies', async () => {
  const f = cookieFixture(); f.revoke();
  try { await f.capture.capture(); assert.equal(f.stats().queryCount, 0); assert.equal(f.stats().prompts, 0); assert.equal(f.page.cookies, undefined); }
  finally { f.capture.stop(); }
});
for (const changed of ['recording-object', 'recording-id', 'page-object']) test('Pro CookieInspector integration: ' + changed + ' during native await cannot attach data to a replacement recording', async () => {
  const f = cookieFixture(), gate = deferred(); let first = true;
  f.runtime.api.cookies.getAll = async () => { if (first) { first = false; await gate.promise; } return [f.secret]; };
  const work = f.inspector.read(f.request); await drain();
  if (changed === 'recording-object') f.pro.session = { ...f.pro.session };
  if (changed === 'recording-id') f.pro.session.id = 'replacement-id';
  if (changed === 'page-object') f.current.set(7, { ...f.page });
  gate.resolve(); const snapshot = await work;
  assert.ok(readCookieSnapshot(snapshot)); assert.equal(f.page.cookies, undefined); assert.equal(f.pro.pageFor(7).cookies, undefined); assert.equal(f.persisted.length, 0); f.capture.stop();
});
test('Pro CookieInspector integration: canceled capture during flush clears owned metadata', async () => {
  const f = cookieFixture(); let first = true;
  f.pro.flush = async () => { if (first) { first = false; ++f.runtime.scope.accessGeneration; } };
  try { await f.capture.capture(); assert.equal(f.page.cookies, undefined); assert.equal(f.stats().valueReads, 0); }
  finally { f.capture.stop(); }
});
test('Pro CookieInspector integration: hanging native queries retain both physical slots after timeout and clear', async () => {
  const f = cookieFixture(), gate = deferred(); let calls = 0;
  f.runtime.api.cookies.getAll = async () => { ++calls; await gate.promise; return [f.secret]; };
  const first = f.inspector.read(f.request, { key: 'capture-a', current: () => true });
  const second = f.inspector.read(f.request, { key: 'capture-b', current: () => true });
  await drain(); assert.equal(calls, 2); assert.equal(f.inspector.jobs.size, 2);
  await Promise.all([first, second]); assert.equal(f.inspector.jobs.size, 2);
  f.inspector.clear(); await f.inspector.read(f.request, { key: 'capture-c', current: () => true }); assert.equal(calls, 2);
  gate.resolve(); await drain(); assert.equal(f.inspector.jobs.size, 0);
  f.runtime.api.cookies.getAll = async () => [f.secret];
  const result = await f.inspector.read(f.request, { key: 'capture-d', current: () => true }); assert.ok(readCookieSnapshot(result)); assert.equal(f.stats().valueReads, 0); f.capture.stop();
});
test('Pro CookieInspector integration: rejecting flush after access revocation cannot leave an owned snapshot', async () => {
  const f = cookieFixture();
  f.pro.flush = async () => { ++f.runtime.scope.accessGeneration; throw Error('storage unavailable'); };
  try { await f.capture.capture(); assert.equal(f.page.cookies, undefined); }
  finally { f.capture.stop(); }
});
test('Pro capture: rejecting social flush after access revocation cannot leave an owned snapshot', async () => {
  const f = fixture();
  f.pro.flush = async () => { ++f.runtime.scope.accessGeneration; throw Error('storage unavailable'); };
  try { await f.capture.capture(); assert.equal(f.pages[0].socialNetworks, undefined); }
  finally { f.capture.stop(); }
});
test('Pro contracts: retired DBSC metadata is dropped from old Cookie snapshots and rejects false TPM or raw identity fields', async () => {
  const f = cookieFixture(), snapshot = await f.inspector.read(f.request); assert.ok(readCookieSnapshot(snapshot));
  for (const status of ['matched', 'not-observed', 'unknown']) assert.ok(readCookieSnapshot({ ...snapshot, entries: snapshot.entries.map(entry => ({ ...entry, boundSessionStatus: status })) }));
  for (const fields of [{ tpmProtected: true }, { sessionId: 'SECRET' }, { value: 'SECRET' }]) assert.equal(readCookieSnapshot({ ...snapshot, entries: snapshot.entries.map(entry => ({ ...entry, ...fields })) }), null);
  f.capture.stop();
});
test('Pro contracts: social script evidence cannot claim browser stack attribution or carry account state', () => {
  const browser = socialRow({ evidenceSource: 'browser-network', integrity: 'browser-observed', attributionConfidence: 'frame-only', script: null });
  assert.ok(readSocialRows([browser, socialRow()]));
  for (const row of [{ ...browser, script: { host: 'example.test', pathTemplate: '/tracker.js' } }, { ...browser, attributionConfidence: 'exact-resource' }, socialRow({ loggedIn: true }), socialRow({ script: { host: 'example.test', pathTemplate: '/private-user.js?token=SECRET' } })]) assert.equal(readSocialRows([row]), null);
  let reads = 0; const accessor = socialRow(); Object.defineProperty(accessor, 'script', { get() { ++reads; throw Error('getter'); } });
  assert.equal(readSocialRows([accessor]), null); assert.equal(reads, 0);
});
