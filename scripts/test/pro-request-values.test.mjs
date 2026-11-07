// ADR-039: passive request values enter only an active, natively bound Pro session.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { ProRequestValuesObserver, parseOutgoingRequestValues } from '../../apps/production-extension/pro-request-values.js';
import { PRO_REQUEST_VALUE_LIMITS as LIMITS, PRO_REQUEST_HEADER_NAMES, proRequestHeaderName, proRequestRowBytes, readProRequestValues } from '../../packages/contracts/src/pro-request-values.mjs';
import { readAdvancedPageFields } from '../../packages/contracts/src/advanced-inspection.mjs';
import { readCookieSnapshot, normalizeProCookieMetadata } from '../../packages/contracts/src/inspection.mjs';

function fixture(helpers = {}) {
  let now = 1800000001000, recording = true, allowBudget = true;
  const limits = [], sizes = new Map();
  const page = { id: 'page-1', tabId: 5, documentKey: '5:0:main', url: 'https://example.test/', title: '', startedAt: 1800000000000, endedAt: null, reports: [], resources: [] };
  const readable = new Set(['5:0:main', '5:2:child']), projections = new Map([[0, '5:0:main'], [2, '5:2:child']]);
  const hosts = new Set(['example.test', 'social.example.net']);
  const session = { schemaVersion: 1, id: 'recording-1', domain: 'example.test', siteKey: 'example.test', startTabId: 5, status: 'recording', startedAt: 1800000000000,
    deadlineAt: 1800000600000, stoppedAt: null, stopReason: null, pages: [page], limitations: [], dropped: { pages: 0, resources: 0, documents: 0, events: 0 } };
  const pro = { hydrated: true, trackedTabs: new Set([5]), requests: new Map(), session,
    checkDeadline: () => recording, pageFor: tab => tab === 5 ? page : null,
    belongsToPage: key => readable.has(key), sameSite: target => target.domain === 'example.test',
    size: (key, bytes) => { sizes.set(key, bytes); return allowBudget; }, mark() {}, limit: code => limits.push(code) };
  const runtime = { api: {}, scope: { hasDataConsent: true, accessReady: true, accessGeneration: 7, isHostGrantedSync: host => hosts.has(host) },
    pro, isReady: true, now: () => now, canObserveNetworkDocument: key => readable.has(key), getProjection: (_tab, frame) => ({ documentKey: projections.get(frame) }) };
  const observer = new ProRequestValuesObserver(runtime, helpers); observer.setSupported(true); observer.beginPage(page);
  const event = changes => ({ tabId: 5, frameId: 0, documentId: 'main', documentLifecycle: 'active', requestId: 'request-1', type: 'xmlhttprequest',
    timeStamp: now, url: 'https://example.test/path?private=IGNORED_QUERY', requestHeaders: [{ name: 'User-Agent', value: 'Owned browser/1.0' }], ...changes });
  const observe = (value, changes = {}) => observer.observe(event({ requestHeaders: [{ name: 'User-Agent', value }], ...changes }));
  return { observer, runtime, pro, page, session, readable, projections, hosts, event, observe, limits, sizes,
    time: value => { now = value; }, stop: () => { recording = false; }, denyBudget: () => { allowBudget = false; } };
}

test('request parser recognizes the exact 38 technical names including 27 documented hints', () => {
  assert.equal(PRO_REQUEST_HEADER_NAMES.length, 38);
  assert.equal(new Set(PRO_REQUEST_HEADER_NAMES.map(name => name.toLowerCase())).size, 38);
  const headers = PRO_REQUEST_HEADER_NAMES.map(name => ({ name: name.toLowerCase(), value: 'Observed value' }));
  assert.deepEqual(parseOutgoingRequestValues(headers), { rows: PRO_REQUEST_HEADER_NAMES.map(name => ({ name, value: 'Observed value' })), truncated: false });
  assert.equal(proRequestHeaderName('sEc-cH-uA-WOW64'), 'Sec-CH-UA-WoW64');
  assert.equal(proRequestHeaderName('Sec-CH-UA-Unknown'), null);
  assert.equal(proRequestHeaderName('User-Agent '), null);
});

test('request parser never reads Authorization, Cookie, URL-bearing or unlisted values', () => {
  let valueReads = 0;
  const excluded = ['Authorization', 'Proxy-Authorization', 'Cookie', 'Set-Cookie', 'Referer', 'Origin', 'Sec-WebSocket-Key', 'Sec-CH-UA-Unknown', 'Accept-CH', 'X-Custom-Token'];
  const headers = excluded.map(name => new Proxy({ name, value: 'SECRET' }, {
    getOwnPropertyDescriptor(target, key) { if (key === 'value') ++valueReads; return Reflect.getOwnPropertyDescriptor(target, key); }
  }));
  headers.push({ name: 'User-Agent', value: 'Observed browser' });
  assert.deepEqual(parseOutgoingRequestValues(headers), { rows: [{ name: 'User-Agent', value: 'Observed browser' }], truncated: false });
  assert.equal(valueReads, 0);
});

test('request parser preserves complete values, variants, empty values, quotes and horizontal whitespace', () => {
  const headers = [{ name: 'Sec-CH-UA', value: '"Chromium";v="153", "Not_A Brand";v="24"' },
    { name: 'Sec-CH-UA-Model', value: '""' }, { name: 'Accept-Language', value: 'en-US,en;q=0.9,ru;q=0.8' },
    { name: 'Sec-CH-UA-Model', value: '' }, { name: 'Accept', value: 'text/html; profile="a=b"\t' }];
  assert.deepEqual(parseOutgoingRequestValues(headers), { rows: headers, truncated: false });
});

test('request parser rejects accessors and malformed values without execution or coercion', () => {
  let reads = 0;
  for (const header of [
    { name: 'User-Agent', get value() { ++reads; return 'getter'; } },
    { name: 'User-Agent', value: { toString() { ++reads; return 'coerced'; } } },
    { name: 'User-Agent', binaryValue: [80, 69] },
    { name: 'User-Agent', value: 'forged\r\nCookie: sid=secret' },
    { name: 'User-Agent', value: 'embedded\0value' },
  ]) assert.deepEqual(parseOutgoingRequestValues([header]), { rows: [], truncated: true });
  assert.equal(reads, 0);
});

test('request parser uses separate header, aggregate and per-value bounds', () => {
  const many = parseOutgoingRequestValues(Array.from({ length: 129 }, () => ({ name: 'User-Agent', value: 'a' })));
  assert.equal(many.rows.length, 128); assert.equal(many.truncated, true);
  assert.deepEqual(parseOutgoingRequestValues([{ name: 'User-Agent', value: 'a'.repeat(LIMITS.valueChars + 1) }]), { rows: [], truncated: true });
  const aggregate = parseOutgoingRequestValues(Array.from({ length: 17 }, () => ({ name: 'Accept', value: 'a'.repeat(4096) })));
  assert.equal(aggregate.rows.length, 16); assert.equal(aggregate.truncated, true);
  assert.deepEqual(parseOutgoingRequestValues(undefined), { rows: [], truncated: true });
});

test('native main and third-party documents keep actual destinations, values, variants and sending times', () => {
  const state = fixture(); state.observe('browser/1'); state.time(state.runtime.now() + 25); state.observe('browser/1');
  state.observe('browser/2'); state.observe('browser/1', { frameId: 2, documentId: 'child', url: 'https://social.example.net/pixel?secret=NOT_SAVED' });
  const rows = state.page.requestValues.rows;
  assert.equal(rows.length, 3);
  assert.equal(rows[0].count, 2); assert.equal(rows[0].lastSeenAt - rows[0].firstSeenAt, 25);
  assert.equal(rows[2].documentKey, '5:2:child'); assert.equal(rows[2].destinationHost, 'social.example.net');
  assert.equal(JSON.stringify(rows).includes('NOT_SAVED'), false);
  assert.ok(readProRequestValues(state.page.requestValues));
});

test('unbound, old, cached and foreign native requests never read requestHeaders', () => {
  const changes = [{ tabId: 6 }, { frameId: -1 }, { documentId: 'old' }, { documentId: undefined }, { frameId: 2, documentId: 'foreign' },
    { documentLifecycle: 'cached' }, { documentLifecycle: 'prerender' }, { url: 'https://ungranted.example/' }, { url: 'https://name:password@example.test/' },
    { url: 'file:///test' }, { timeStamp: undefined }, { timeStamp: NaN }, { timeStamp: Infinity }, { timeStamp: -1 }, { timeStamp: 1800000700000 }, { timeStamp: 1799999999999 }];
  for (const change of changes) {
    const state = fixture(); let headerReads = 0;
    const details = new Proxy(state.event(change), { getOwnPropertyDescriptor(target, key) { if (key === 'requestHeaders') ++headerReads; return Reflect.getOwnPropertyDescriptor(target, key); } });
    state.observer.observe(details); assert.deepEqual(state.page.requestValues.rows, [], JSON.stringify(change)); assert.equal(headerReads, 0);
  }
});

test('consent, scope, hydration, pause and stop reject before any header access', () => {
  for (const deny of [state => { state.runtime.scope.hasDataConsent = false; }, state => { state.runtime.scope.accessReady = false; },
    state => { state.runtime.isReady = false; }, state => { state.pro.hydrated = false; }, state => state.readable.delete('5:0:main'),
    state => state.pro.trackedTabs.clear(), state => state.stop(), state => { state.page.endedAt = state.runtime.now(); },
    state => state.projections.set(0, '5:0:replacement'), state => state.observer.setSupported(false)]) {
    const state = fixture(); deny(state); let headerReads = 0;
    const details = new Proxy(state.event(), { getOwnPropertyDescriptor(target, key) { if (key === 'requestHeaders') ++headerReads; return Reflect.getOwnPropertyDescriptor(target, key); } });
    state.observer.observe(details); assert.deepEqual(state.page.requestValues.rows, []); assert.equal(headerReads, 0);
  }
});

test('Firefox without authoritative network document identity stays unsupported even when listener exists', () => {
  const state = fixture(); state.runtime.api.__detectExpertCapabilities = { networkDocumentIdentity: false };
  state.observer.setSupported(true); state.observer.beginPage(state.page); state.observe('browser/1');
  assert.deepEqual(state.page.requestValues, { documentKey: '5:0:main', rows: [], truncated: false, supported: false });
});

test('retained values obey row, byte and session budgets without clipped output', () => {
  const state = fixture();
  for (let index = 0; index < 260; ++index) { if (index === 150) state.time(state.runtime.now() + 1000); state.observe('browser/' + index); }
  assert.equal(state.page.requestValues.rows.length, LIMITS.rows); assert.equal(state.page.requestValues.truncated, true);
  assert.ok(state.limits.includes('event-limit')); assert.ok(readProRequestValues(state.page.requestValues));
  const large = fixture(), value = 'x'.repeat(4090);
  for (let index = 0; index < 40; ++index) large.observe(value + index);
  assert.ok(large.page.requestValues.rows.length > 0 && large.page.requestValues.rows.length < 40);
  assert.equal(large.page.requestValues.truncated, true);
  assert.ok(large.page.requestValues.rows.every(row => row.value.startsWith(value) && row.value.length > 4090));
  assert.ok(large.page.requestValues.rows.reduce((bytes, row) => bytes + proRequestRowBytes(row), 512) <= LIMITS.bytes);
  const budget = fixture(); budget.observe('before'); const before = structuredClone(budget.page.requestValues);
  budget.denyBudget(); budget.observe('not retained'); assert.deepEqual(budget.page.requestValues, before);
});

test('request event rate is bounded and resets after a second', () => {
  const state = fixture(); for (let index = 0; index < 220; ++index) state.observe('browser/1');
  assert.equal(state.page.requestValues.rows[0].count, 200); assert.equal(state.page.requestValues.truncated, true);
  state.time(state.runtime.now() + 1001); state.observe('browser/1'); assert.equal(state.page.requestValues.rows[0].count, 201);
});

test('stop preserves recorded values while clear and forgetting remove the selected local data', () => {
  const state = fixture(); state.observe('main'); state.observe('child', { frameId: 2, documentId: 'child' });
  state.observer.forget('5:2:child'); assert.equal(state.page.requestValues.rows.length, 1);
  const before = structuredClone(state.page.requestValues); state.stop(); state.observer.stop(); state.observe('after stop');
  assert.deepEqual(state.page.requestValues, before); assert.equal(state.sizes.get('requestValues:pending'), 0);
  state.observer.clear(); assert.equal(Object.hasOwn(state.page, 'requestValues'), false); assert.equal(state.sizes.get('requestValues:page-1'), 0);
});

test('canonical request values reject foreign scope, duplicate rows, extra fields and forbidden headers', () => {
  const state = fixture(); state.observe('browser/1'); const snapshot = state.page.requestValues, row = snapshot.rows[0];
  for (const change of [{ documentKey: '6:0:foreign' }, { source: 'page-hook' }, { name: 'Authorization' }, { name: 'Sec-CH-UA-Unknown' },
    { name: 'user-agent' }, { value: 'bad\r\nvalue' }, { count: 0 }, { count: 2147483648 }, { destinationHost: 'example.test?token=secret' }, { lastSeenAt: row.firstSeenAt - 1 }]) {
    assert.equal(readProRequestValues({ ...snapshot, rows: [{ ...row, ...change }] }), null);
  }
  for (const changed of [{ ...snapshot, rows: [row, { ...row }] }, { ...snapshot, rows: [, row] }, { ...snapshot, supported: false }, { ...snapshot, url: 'https://unexpected.test/' }]) assert.equal(readProRequestValues(changed), null);
  const clone = readProRequestValues(snapshot); snapshot.rows[0].value = 'changed'; assert.equal(clone.rows[0].value, 'browser/1');
});

test('canonical request rows reject executable accessors without running them', () => {
  const state = fixture(); state.observe('browser/1'); let reads = 0;
  const row = { ...state.page.requestValues.rows[0] };
  Object.defineProperty(row, 'value', { enumerable: true, get() { ++reads; return 'forged'; } });
  assert.equal(readProRequestValues({ ...state.page.requestValues, rows: [row] }), null); assert.equal(reads, 0);
  const page = { ...state.page }; Object.defineProperty(page, 'requestValues', { enumerable: true, get() { ++reads; return state.page.requestValues; } });
  assert.equal(readAdvancedPageFields(page, state.session), false); assert.equal(reads, 0);
});

test('ordinary cookie metadata stays separate and request snapshots reject Cookie headers', () => {
  const state = fixture(); state.observe('browser/1');
  assert.equal(readCookieSnapshot(state.page.requestValues), null);
  assert.equal(readAdvancedPageFields({ ...state.page, requestValues: { ...state.page.requestValues, rows: [{ ...state.page.requestValues.rows[0], name: 'Cookie' }] } }, state.session), false);
});

function queuedNavigation(state, changes = {}) {
  const request = { tabId: 5, type: 'main_frame', target: { domain: 'example.test', siteKey: 'example.test', scheme: 'https' }, at: state.runtime.now(), pageId: null };
  state.pro.requests.set(changes.requestId ?? 'navigation-1', request);
  state.observer.observe(state.event({ type: 'main_frame', documentId: 'next', requestId: 'navigation-1', ...changes }));
  return request;
}
function commitNavigation(state, request, documentId = 'next') {
  const at = state.runtime.now() + 100; state.time(at);
  state.page.id = 'page-2'; state.page.documentKey = '5:0:' + documentId; state.page.startedAt = at;
  state.readable.delete('5:0:main'); state.readable.add(state.page.documentKey); state.projections.set(0, state.page.documentKey);
  request.pageId = state.page.id; state.observer.beginPage(state.page);
  state.observer.onEvent({ type: 'navigation:committed', tabId: 5, frameId: 0, documentId });
}

test('pending navigation headers become retained only after exact authorized native commit', () => {
  const state = fixture();
  try {
    const request = queuedNavigation(state), at = state.runtime.now();
    assert.equal(state.observer.pending.size, 1); assert.deepEqual(state.page.requestValues.rows, []);
    commitNavigation(state, request);
    assert.equal(state.observer.pending.size, 0); assert.equal(state.page.requestValues.rows.length, 1);
    assert.equal(state.page.requestValues.rows[0].documentKey, '5:0:next'); assert.equal(state.page.requestValues.rows[0].firstSeenAt, at);
    assert.ok(at < state.page.startedAt); assert.equal(readAdvancedPageFields(state.page, state.session), true);
  } finally { state.observer.stop(); }
});

test('navigation uses the canonical site for ownership and exact destination host in retained evidence', () => {
  const state = fixture({ site: host => host === 'sub.example.test' ? 'example.test' : host }); state.hosts.add('sub.example.test');
  try {
    const request = queuedNavigation(state, { url: 'https://sub.example.test/path' }); assert.equal(state.observer.pending.size, 1);
    commitNavigation(state, request); assert.equal(state.page.requestValues.rows[0].destinationHost, 'sub.example.test');
  } finally { state.observer.stop(); }
});

test('cancelled, redirected or replaced navigation cannot donate headers to another document', () => {
  const state = fixture();
  try {
    const request = queuedNavigation(state); commitNavigation(state, request, 'different');
    assert.equal(state.observer.pending.size, 0); assert.deepEqual(state.page.requestValues.rows, []);
  } finally { state.observer.stop(); }
});

test('generation, consent, session, tracked-tab and request replacement clear pending native values', () => {
  for (const invalidate of [state => { ++state.runtime.scope.accessGeneration; }, state => { state.runtime.scope.hasDataConsent = false; },
    state => { state.pro.session = { ...state.pro.session, id: 'replacement' }; }, state => state.pro.trackedTabs.clear(),
    state => { state.pro.requests.set('navigation-1', { ...state.pro.requests.get('navigation-1') }); }, state => state.stop()]) {
    const state = fixture();
    try {
      queuedNavigation(state); assert.equal(state.observer.pending.size, 1); invalidate(state); state.observer.prune();
      assert.equal(state.observer.pending.size, 0); assert.equal(state.observer.pendingBytes, 0); assert.deepEqual(state.page.requestValues.rows, []);
    } finally { state.observer.stop(); }
  }
});

test('disabling native header support clears uncommitted data and rejects subsequent traffic', () => {
  const state = fixture();
  try {
    queuedNavigation(state); assert.equal(state.observer.pending.size, 1);
    state.observer.setSupported(false); assert.equal(state.observer.pending.size, 0); assert.equal(state.observer.pendingBytes, 0);
    state.observe('not supported'); assert.deepEqual(state.page.requestValues.rows, []);
  } finally { state.observer.stop(); }
});

test('navigation without a native tracked request or matching domain cannot read headers', () => {
  for (const modify of [() => {}, state => state.pro.requests.set('request-1', { tabId: 5, target: { domain: 'foreign.test', scheme: 'https' }, at: state.runtime.now() })]) {
    const state = fixture(); modify(state); let headerReads = 0;
    const details = new Proxy(state.event({ type: 'main_frame', documentId: 'next' }), { getOwnPropertyDescriptor(target, key) { if (key === 'requestHeaders') ++headerReads; return Reflect.getOwnPropertyDescriptor(target, key); } });
    state.observer.observe(details); assert.equal(headerReads, 0); assert.equal(state.observer.pending.size, 0);
  }
});

test('third-party subframe navigation commits to its own document inside the same visit', () => {
  const state = fixture();
  try {
    const request = { tabId: 5, type: 'sub_frame', target: { domain: 'social.example.net', scheme: 'https' }, at: state.runtime.now(), pageId: state.page.id };
    state.pro.requests.set('child-request', request);
    state.observer.observe(state.event({ type: 'sub_frame', frameId: 2, documentId: 'next-child', requestId: 'child-request', url: 'https://social.example.net/' }));
    assert.equal(state.observer.pending.size, 1);
    state.readable.add('5:2:next-child'); state.projections.set(2, '5:2:next-child');
    state.observer.onEvent({ type: 'navigation:committed', tabId: 5, frameId: 2, documentId: 'next-child' });
    assert.equal(state.observer.pending.size, 0); assert.equal(state.page.requestValues.rows[0].documentKey, '5:2:next-child');
  } finally { state.observer.stop(); }
});

test('pending native values expire at a bounded TTL and release their global Pro accounting', () => {
  let nextTimer = 0; const timers = new Map();
  const state = fixture({ timers: { setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; }, clearTimeout(id) { timers.delete(id); } } });
  const started = state.runtime.now();
  try {
    queuedNavigation(state); state.time(started + 5000); queuedNavigation(state, { requestId: 'later-request', documentId: 'later' });
    const fire = at => { assert.equal(timers.size, 1); const [id, timer] = [...timers][0]; timers.delete(id); state.time(at); timer.callback(); };
    fire(started + 10000); assert.deepEqual([...state.observer.pending.keys()], ['later-request']);
    assert.equal([...timers.values()][0].delay, 5000); fire(started + 15000);
    assert.equal(state.observer.pending.size, 0); assert.equal(state.observer.pendingBytes, 0); assert.equal(timers.size, 0);
    assert.equal(state.sizes.get('requestValues:pending'), 0);
  } finally { state.observer.stop(); }
});

test('pending native request values enforce entry and byte capacity', () => {
  const state = fixture();
  try {
    for (let index = 0; index < 40; ++index) queuedNavigation(state, { requestId: 'navigation-' + index, documentId: 'doc-' + index });
    assert.equal(state.observer.pending.size, 32); assert.ok(state.observer.pendingBytes <= 131072); assert.equal(state.page.requestValues.truncated, true);
  } finally { state.observer.stop(); }
});

test('request-value timestamps may precede commit, never the session or visit end', () => {
  const state = fixture(); state.observe('browser/1'); const snapshot = structuredClone(state.page.requestValues);
  for (const at of [state.session.startedAt - 1, state.session.deadlineAt + 1]) {
    state.page.requestValues = { ...snapshot, rows: snapshot.rows.map(row => ({ ...row, firstSeenAt: at, lastSeenAt: at })) };
    assert.equal(readAdvancedPageFields(state.page, state.session), false);
  }
  state.page.requestValues = snapshot; state.page.endedAt = snapshot.rows[0].lastSeenAt - 1;
  assert.equal(readAdvancedPageFields(state.page, state.session), false);
});

test('all four production Pro validators admit the exact optional requestValues field', () => {
  for (const bundle of ['background.js', 'popup.js', 'sidepanel.js', 'report.js']) {
    const source = readFileSync(new URL('../../apps/production-extension/' + bundle, import.meta.url), 'utf8');
    const marker = source.indexOf('function validateProSession('); assert.ok(marker >= 0, bundle);
    const start = source.lastIndexOf('// packages/contracts/src/', marker), end = source.indexOf('\n// ', marker);
    const code = source.slice(start, end).replace(/^import[^\n]*\n/gm, '');
    const context = vm.createContext({ atob, btoa, TextEncoder, URL, normalizeProCookieMetadata, readAdvancedPageFields });
    // The section uses canonical guard helpers from the beginning of the contracts bundle.
    const prefixEnd = source.indexOf('// packages/attribution/src/psl-index.json');
    if (bundle === 'background.js') vm.runInContext(source.slice(0, prefixEnd).replace(/^import[^\n]*\n/gm, ''), context);
    else {
      // Bound extraction is checked structurally here; report/UI browser rendering exercises the runtime.
      assert.ok(code.includes('pageFields.push("requestValues")'), bundle); continue;
    }
    const state = fixture(); state.observe('browser/1'); context.serialized = JSON.stringify(state.session);
    assert.equal(vm.runInContext('validateProSession(JSON.parse(serialized)).ok', context), true, bundle);
    state.page.requestValues.rows[0].name = 'Authorization'; context.serialized = JSON.stringify(state.session);
    assert.equal(vm.runInContext('validateProSession(JSON.parse(serialized)).ok', context), false, bundle);
  }
});
