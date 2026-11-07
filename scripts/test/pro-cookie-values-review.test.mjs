// Independent ADR-037 review: privileged request data, native identity and recording boundaries.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProCookieValuesObserver, parseOutgoingCookies } from '../../apps/production-extension/pro-cookie-values.js';
import { readProCookieValues } from '../../packages/contracts/src/pro-cookie-values.mjs';
import { readCookieSnapshot } from '../../packages/contracts/src/inspection.mjs';
import { readAdvancedPageFields } from '../../packages/contracts/src/advanced-inspection.mjs';

function fixture(helpers = {}) {
  let now = 1800000001000, recording = true;
  const page = { id: 'page-1', tabId: 5, documentKey: '5:0:main', startedAt: 1800000000000, endedAt: null };
  const readable = new Set(['5:0:main', '5:2:child']);
  const projections = new Map([[0, '5:0:main'], [2, '5:2:child']]);
  const hosts = new Set(['example.test', 'social.example.net']);
  const pro = { hydrated: true, trackedTabs: new Set([5]), requests: new Map(), session: { id: 'session-1', startedAt: 1800000000000, deadlineAt: 1800000600000, pages: [page] },
    checkDeadline: () => recording, pageFor: tab => tab === 5 ? page : null,
    belongsToPage: key => readable.has(key), sameSite: target => target.domain === 'example.test', size: () => true, mark() {}, limit() {} };
  const runtime = { api: {}, scope: { hasDataConsent: true, accessReady: true, accessGeneration: 7, isHostGrantedSync: host => hosts.has(host) },
    pro, isReady: true, now: () => now, canObserveNetworkDocument: key => readable.has(key), getProjection: (_tab, frame) => ({ documentKey: projections.get(frame) }) };
  const observer = new ProCookieValuesObserver(runtime, helpers); observer.setSupported(true); observer.beginPage(page);
  const event = changes => ({ tabId: 5, frameId: 0, documentId: 'main', documentLifecycle: 'active', requestId: 'request-1', type: 'xmlhttprequest',
    timeStamp: now, url: 'https://example.test/path?private=IGNORED_QUERY', requestHeaders: [{ name: 'Cookie', value: 'sid=OWNED_VALUE' }], ...changes });
  return { observer, runtime, pro, page, readable, projections, hosts, event, time: value => { now = value; }, stop: () => { recording = false; } };
}

test('review: cookie parser preserves equals, empty values and repeated names without touching unrelated secrets', () => {
  let forbiddenReads = 0;
  const auth = { name: 'Authorization', get value() { ++forbiddenReads; throw Error('secret'); } };
  const result = parseOutgoingCookies([auth, { name: 'Cookie', value: 'id=one; id=two; encoded=a=b==; empty=' }]);
  assert.deepEqual(result, { rows: [{ name: 'id', value: 'one' }, { name: 'id', value: 'two' }, { name: 'encoded', value: 'a=b==' }, { name: 'empty', value: '' }], truncated: false });
  assert.equal(forbiddenReads, 0);
});

test('review: a getter cannot supply a privileged outgoing Cookie value', () => {
  let reads = 0;
  const result = parseOutgoingCookies([{ name: 'Cookie', get value() { ++reads; return 'sid=FORGED_VALUE'; } }]);
  assert.equal(reads, 0); assert.deepEqual(result.rows, []); assert.equal(result.truncated, true);
});

test('review: overlong values are omitted and marked, not silently exported as a different credential', () => {
  const result = parseOutgoingCookies([{ name: 'Cookie', value: 'sid=' + 'x'.repeat(16385) }]);
  assert.deepEqual(result, { rows: [], truncated: true });
});

test('review: only current recorded native documents can contribute Cookie values', () => {
  for (const change of [{ tabId: 6 }, { frameId: -1 }, { documentId: 'old' }, { frameId: 2, documentId: 'foreign' }, { documentLifecycle: 'cached' }, { documentLifecycle: 'prerender' }, { url: 'https://ungranted.example/path' }, { url: 'https://name:secret@example.test/path' }]) {
    const { observer, page, event } = fixture(); observer.observe(event(change)); assert.deepEqual(page.cookieValues.rows, [], JSON.stringify(change));
  }
});

test('review: consent, permissions, hydration, document pause and stopping gate raw capture', () => {
  for (const deny of [state => { state.runtime.scope.hasDataConsent = false; }, state => { state.runtime.scope.accessReady = false; },
    state => { state.runtime.isReady = false; }, state => { state.pro.hydrated = false; }, state => state.readable.delete('5:0:main'),
    state => state.pro.trackedTabs.clear(), state => state.stop(), state => { state.page.endedAt = state.runtime.now(); }]) {
    const state = fixture(); deny(state); state.observer.observe(state.event()); assert.deepEqual(state.page.cookieValues.rows, []);
  }
});

test('review: native subdocument values retain their own document and actual destination', () => {
  const { observer, page, event } = fixture();
  observer.observe(event({ frameId: 2, documentId: 'child', url: 'https://social.example.net/pixel?token=DO_NOT_RETAIN' }));
  assert.equal(page.cookieValues.rows.length, 1);
  assert.equal(page.cookieValues.rows[0].documentKey, '5:2:child');
  assert.equal(page.cookieValues.rows[0].destinationHost, 'social.example.net');
  assert.equal(JSON.stringify(page.cookieValues).includes('DO_NOT_RETAIN'), false);
});

test('review: values do not enter an unsupported Firefox capture channel', () => {
  const { observer, runtime, page, event } = fixture();
  runtime.api.__detectExpertCapabilities = { networkDocumentIdentity: false }; observer.setSupported(true); observer.beginPage(page); observer.observe(event());
  assert.equal(page.cookieValues.supported, false); assert.deepEqual(page.cookieValues.rows, []);
});

test('review: delayed headers from before this visit do not contaminate a new Pro or SPA period', () => {
  const { observer, page, event } = fixture();
  observer.observe(event({ timeStamp: page.startedAt - 1 }));
  assert.deepEqual(page.cookieValues.rows, []);
});

test('review: future, missing and invalid native timestamps cannot manufacture outgoing evidence', () => {
  for (const timeStamp of [undefined, NaN, Infinity, -1, 1800000700000]) {
    const { observer, page, event } = fixture(); observer.observe(event({ timeStamp })); assert.deepEqual(page.cookieValues.rows, []);
  }
});

test('review: cookie value clearing and per-document forgetting retain unrelated recorded documents', () => {
  const { observer, page, event } = fixture();
  observer.observe(event()); observer.observe(event({ frameId: 2, documentId: 'child', url: 'https://social.example.net/pixel' }));
  observer.forget('5:2:child'); assert.equal(page.cookieValues.rows.length, 1); assert.equal(page.cookieValues.rows[0].documentKey, '5:0:main');
  observer.clear(); assert.equal(Object.hasOwn(page, 'cookieValues'), false);
});

test('review: canonical Pro values reject cross-tab, fabricated fields and executable accessors', () => {
  const { observer, page, event } = fixture(); observer.observe(event());
  const snapshot = page.cookieValues; assert.ok(readProCookieValues(snapshot));
  for (const change of [{ documentKey: '6:0:foreign' }, { source: 'page-hook' }, { value: 'bad\r\nvalue' }, { count: 0 }]) {
    assert.equal(readProCookieValues({ ...snapshot, rows: [{ ...snapshot.rows[0], ...change }] }), null);
  }
  let reads = 0;
  const getterRow = { ...snapshot.rows[0] }; Object.defineProperty(getterRow, 'value', { enumerable: true, get() { ++reads; return 'FORGED'; } });
  assert.equal(readProCookieValues({ ...snapshot, rows: [getterRow] }), null); assert.equal(reads, 0);
});

test('review: ordinary Cookie metadata does not accept the new privileged value channel', () => {
  const { observer, page, event } = fixture(); observer.observe(event());
  assert.equal(readCookieSnapshot(page.cookieValues), null);
});

function queuedNavigation(state, changes = {}) {
  const request = { tabId: 5, type: 'main_frame', target: { domain: 'example.test', siteKey: 'example.test', scheme: 'https' }, at: state.runtime.now(), pageId: null };
  state.pro.requests.set(changes.requestId ?? 'navigation-1', request);
  state.observer.observe(state.event({ type: 'main_frame', documentId: 'next', requestId: 'navigation-1', ...changes }));
  return request;
}

function commitNavigation(state, request, documentId = 'next') {
  const at = state.runtime.now() + 100;
  state.time(at);
  state.page.id = 'page-2'; state.page.documentKey = '5:0:' + documentId; state.page.startedAt = at;
  state.readable.delete('5:0:main'); state.readable.add(state.page.documentKey); state.projections.set(0, state.page.documentKey);
  request.pageId = state.page.id; state.observer.beginPage(state.page);
  state.observer.onEvent({ type: 'navigation:committed', tabId: 5, frameId: 0, documentId });
}

test('review: pending navigation cookies become report data only after an exact authorized native commit', () => {
  const state = fixture();
  try {
    const request = queuedNavigation(state), sentAt = state.runtime.now();
    assert.equal(state.observer.pending.size, 1); assert.deepEqual(state.page.cookieValues.rows, []);
    commitNavigation(state, request);
    assert.equal(state.observer.pending.size, 0); assert.equal(state.page.cookieValues.rows.length, 1);
    assert.equal(state.page.cookieValues.rows[0].documentKey, '5:0:next');
    assert.equal(state.page.cookieValues.rows[0].firstSeenAt, sentAt, 'retain the actual pre-commit sending timestamp');
    assert.ok(sentAt < state.page.startedAt);
    assert.equal(readAdvancedPageFields(state.page, state.pro.session), true, 'a legitimate pre-commit Cookie cannot invalidate the complete Pro session');
  } finally { state.observer.stop(); }
});

test('review: cancelled or mismatched navigation cannot donate cookies to the next document', () => {
  const state = fixture();
  try {
    const request = queuedNavigation(state); assert.equal(state.observer.pending.size, 1);
    commitNavigation(state, request, 'different');
    assert.equal(state.observer.pending.size, 0); assert.deepEqual(state.page.cookieValues.rows, []);
  } finally { state.observer.stop(); }
});

test('review: queued navigation values are discarded on access generation, consent, session or request replacement', () => {
  for (const invalidate of [state => { ++state.runtime.scope.accessGeneration; }, state => { state.runtime.scope.hasDataConsent = false; },
    state => { state.pro.session = { ...state.pro.session, id: 'replacement' }; }, state => { state.pro.requests.set('navigation-1', { ...state.pro.requests.get('navigation-1') }); }, state => state.stop()]) {
    const state = fixture();
    try {
      queuedNavigation(state); assert.equal(state.observer.pending.size, 1); invalidate(state); state.observer.prune();
      assert.equal(state.observer.pending.size, 0); assert.equal(state.observer.pendingBytes, 0); assert.deepEqual(state.page.cookieValues.rows, []);
    } finally { state.observer.stop(); }
  }
});

test('review: navigation without an existing tracked native request never captures Cookie values', () => {
  const state = fixture();
  try {
    state.observer.observe(state.event({ type: 'main_frame', documentId: 'next' }));
    assert.equal(state.observer.pending.size, 0); assert.deepEqual(state.page.cookieValues.rows, []);
  } finally { state.observer.stop(); }
});

test('review: navigation compares the canonical site but preserves the exact destination subdomain', () => {
  const state = fixture({ site: host => host === 'sub.example.test' ? 'example.test' : host });
  state.hosts.add('sub.example.test');
  try {
    const request = queuedNavigation(state, { url: 'https://sub.example.test/path' });
    assert.equal(state.observer.pending.size, 1);
    commitNavigation(state, request);
    assert.equal(state.page.cookieValues.rows.length, 1);
    assert.equal(state.page.cookieValues.rows[0].destinationHost, 'sub.example.test');
    assert.equal(readAdvancedPageFields(state.page, state.pro.session), true);
  } finally { state.observer.stop(); }
});

test('review: pending navigation TTL rearms for later entries and releases all raw memory', () => {
  let nextTimer = 0;
  const timers = new Map();
  const state = fixture({ timers: {
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  } });
  const started = state.runtime.now();
  const fire = at => {
    assert.equal(timers.size, 1, 'one bounded expiry timer is active');
    const [id, timer] = [...timers][0]; timers.delete(id); state.time(at); timer.callback();
  };
  try {
    queuedNavigation(state);
    state.time(started + 5000);
    queuedNavigation(state, { requestId: 'navigation-2', documentId: 'later' });
    assert.equal(state.observer.pending.size, 2); assert.ok(state.observer.pendingBytes > 0);
    fire(started + 10000);
    assert.deepEqual([...state.observer.pending.keys()], ['navigation-2']);
    assert.equal([...timers.values()][0].delay, 5000, 'the later entry still has its own expiry');
    fire(started + 15000);
    assert.equal(state.observer.pending.size, 0); assert.equal(state.observer.pendingBytes, 0);
    assert.equal(timers.size, 0); assert.equal(state.observer.pendingTimer, null);
  } finally { state.observer.stop(); }
});

test('review: removed tracked tabs and paused documents cannot retain pending navigation values', () => {
  const state = fixture();
  try {
    queuedNavigation(state); assert.equal(state.observer.pending.size, 1);
    state.pro.trackedTabs.clear(); state.observer.prune();
    assert.equal(state.observer.pending.size, 0); assert.equal(state.observer.pendingBytes, 0);
    state.pro.trackedTabs.add(5); state.readable.delete('5:0:main');
    queuedNavigation(state); assert.equal(state.observer.pending.size, 0);
    assert.deepEqual(state.page.cookieValues.rows, []);
  } finally { state.observer.stop(); }
});

test('review: advanced snapshot timestamps may precede commit, never the session or its deadline', () => {
  const state = fixture(); state.observer.observe(state.event());
  const snapshot = structuredClone(state.page.cookieValues);
  for (const timestamp of [state.pro.session.startedAt - 1, state.pro.session.deadlineAt + 1]) {
    state.page.cookieValues = { ...snapshot, rows: snapshot.rows.map(row => ({ ...row, firstSeenAt: timestamp, lastSeenAt: timestamp })) };
    assert.equal(readAdvancedPageFields(state.page, state.pro.session), false);
  }
});
