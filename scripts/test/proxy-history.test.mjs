// ADR-070/107 round 5: the saved history of manual proxy checks is local, bounded, validated on read and free of secrets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROXY_HISTORY_KEY, PROXY_HISTORY_LIMITS, PROXY_HISTORY_FAILURES, sanitizeProxyHistoryEntry, normalizeProxyHistory, proxyHistoryEntry, proxyHistoryRows, proxyHistoryIpChanged, proxyHistoryOf, appendProxyHistory, removeProxyHistory, pruneProxyHistory, createProxyHistoryStore, isHistoryEnabled, setHistoryEnabled, withProxyHistoryEnabled } from '../../apps/production-extension/proxy-history.js';
import { PROXY_SAFE_CODES } from '../../apps/production-extension/proxy-shared.js';

const NOW = 1_800_000_000_000, MINUTE = 60_000, DAY = 24 * 60 * MINUTE;
const pass = (ip = '203.0.113.7', patch = {}) => ({ state: 'pass', reachable: true, remoteDns: true, tlsVerified: true, httpStatus: 200, ip, elapsedMs: 120, ...patch });
const fail = (code = 'timeout', phase = 'tunnel') => ({ state: 'fail', code, phase, retryable: true });
const entryOf = (diagnostic, at) => { const entry = proxyHistoryEntry(diagnostic, at); assert.ok(entry, JSON.stringify(diagnostic)); return entry; };
function chain(steps, id = 'p-1') { let history = { version: 1, items: {} }; for (const [diagnostic, at] of steps) history = appendProxyHistory(history, id, entryOf(diagnostic, at), NOW); return proxyHistoryOf(history, id); }
function area(initial) {
  const state = { value: initial, sets: 0, removes: 0, gets: 0 };
  return { state, local: { async get(key) { state.gets++; return state.value === undefined ? {} : { [key]: structuredClone(state.value) }; }, async set(value) { state.sets++; state.value = structuredClone(value[PROXY_HISTORY_KEY]); }, async remove() { state.removes++; state.value = undefined; } } };
}

test('a completed check becomes one entry of fixed fields: nothing about the target, the response, headers or credentials', () => {
  const entry = entryOf(pass('203.0.113.7', { url: 'https://secret.example/?token=PRIVATE', body: 'PRIVATE', headers: { a: 'b' }, username: 'u', password: 'p' }), NOW - 5000);
  assert.deepEqual(entry, { firstAt: NOW - 5000, lastAt: NOW - 5000, checks: 1, ok: true, code: '', ms: 120, dns: 'ok', tls: 'ok', status: 200, ip: '203.0.113.7' });
  assert.doesNotMatch(JSON.stringify(entry), /secret|PRIVATE|token|headers|username|password/);
  assert.deepEqual(entryOf(pass(null, { remoteDns: false, tlsVerified: false, httpStatus: 403 }), NOW), { firstAt: NOW, lastAt: NOW, checks: 1, ok: true, code: '', ms: 120, dns: 'unknown', tls: 'unknown', status: 403, ip: '' });
  assert.deepEqual(entryOf(fail('tls-failed', 'tls'), NOW), { firstAt: NOW, lastAt: NOW, checks: 1, ok: false, code: 'tls-failed', ms: 0, dns: 'unknown', tls: 'fail', status: 0, ip: '' });
  assert.deepEqual(entryOf(fail('dns-failed', 'dns'), NOW).dns, 'fail');
  assert.equal(entryOf(pass('203.0.113.7', { elapsedMs: 90_000 }), NOW).ms, PROXY_HISTORY_LIMITS.responseMs, 'response time is capped');
  assert.deepEqual(Object.keys(entry), ['firstAt', 'lastAt', 'checks', 'ok', 'code', 'ms', 'dns', 'tls', 'status', 'ip']);
});

test('only what says something about the proxy is history: no companion, no permission, busy, a client timeout or a skipped check are not', () => {
  for (const [code, phase] of [['native-unavailable', 'native'], ['permission-required', 'native'], ['permission-denied', 'native'], ['busy', 'tunnel'], ['active-vpn', 'tunnel'], ['native-unsupported', 'native'], ['unsupported-profile', 'parse'], ['invalid-input', 'parse'], ['vault-unavailable', 'vault'], ['operation-failed', 'native'], ['inactive', 'native'], ['profile-not-found', 'vault']]) assert.equal(proxyHistoryEntry(fail(code, phase), NOW), null, code);
  assert.equal(proxyHistoryEntry({ state: 'fail', code: 'timeout' }, NOW), null, 'a timeout without a companion phase is the client giving up');
  assert.equal(proxyHistoryEntry({ state: 'fail', code: 'timeout', phase: 'nowhere' }, NOW), null);
  for (const code of PROXY_HISTORY_FAILURES) { assert.ok(PROXY_SAFE_CODES.includes(code), code); assert.ok(proxyHistoryEntry(fail(code, 'connect'), NOW), code); }
  for (const bad of [null, undefined, 'pass', 7, [], { state: 'weird' }, { state: 'pass' }, { state: 'pass', httpStatus: 99, elapsedMs: 1 }, { ...pass(), elapsedMs: NaN }]) assert.equal(proxyHistoryEntry(bad, NOW), null, JSON.stringify(bad));
  assert.equal(proxyHistoryEntry(pass(), 1.5), null); assert.equal(proxyHistoryEntry(pass(), 'now'), null);
});

test('consecutive successful checks with the same exit IP are one stay: the first time is kept, the newest reading wins, the count grows', () => {
  const entries = chain([[pass('203.0.113.7', { elapsedMs: 100, httpStatus: 200 }), NOW - 50 * MINUTE], [pass('203.0.113.7', { elapsedMs: 250, httpStatus: 204, tlsVerified: false }), NOW - 40 * MINUTE], [pass('203.0.113.7', { elapsedMs: 300, remoteDns: false }), NOW - 30 * MINUTE]]);
  assert.deepEqual(entries, [{ firstAt: NOW - 50 * MINUTE, lastAt: NOW - 30 * MINUTE, checks: 3, ok: true, code: '', ms: 300, dns: 'unknown', tls: 'ok', status: 200, ip: '203.0.113.7' }]);
});

test('a failed check or a different exit IP always starts a new entry, failures never merge, an unknown IP never counts as the same', () => {
  const entries = chain([[pass('203.0.113.7'), NOW - 60 * MINUTE], [fail('timeout'), NOW - 50 * MINUTE], [fail('timeout'), NOW - 45 * MINUTE], [pass('203.0.113.7'), NOW - 40 * MINUTE], [pass('203.0.113.9'), NOW - 30 * MINUTE], [pass('203.0.113.9'), NOW - 20 * MINUTE], [pass(null), NOW - 10 * MINUTE], [pass(null), NOW - 5 * MINUTE]]);
  assert.deepEqual(entries.map(entry => [entry.ok, entry.ip, entry.checks]), [[true, '203.0.113.7', 1], [false, '', 1], [false, '', 1], [true, '203.0.113.7', 1], [true, '203.0.113.9', 2], [true, '', 1], [true, '', 1]]);
  assert.ok(entries.every(entry => entry.ok || entry.firstAt === entry.lastAt));
});

test('the exit IP changed marker compares each stay with the previous successful one and is what the row badge shows', () => {
  const entries = chain([[pass('203.0.113.7'), NOW - 50 * MINUTE], [fail('proxy-error', 'proxy'), NOW - 40 * MINUTE], [pass('203.0.113.7'), NOW - 30 * MINUTE], [pass('203.0.113.9'), NOW - 20 * MINUTE], [pass('203.0.113.9'), NOW - 10 * MINUTE]]);
  assert.deepEqual(proxyHistoryRows(entries).map(row => [row.ip, row.ipChanged]), [['203.0.113.9', true], ['203.0.113.7', false], ['', false], ['203.0.113.7', false]], 'newest first; a stay after a failure with the same IP is no change');
  assert.equal(proxyHistoryIpChanged(entries), true);
  assert.equal(proxyHistoryIpChanged(chain([[pass('203.0.113.7'), NOW - 20 * MINUTE], [fail('timeout'), NOW - 10 * MINUTE]])), false, 'a failure on top does not hide or invent a change');
  assert.equal(proxyHistoryIpChanged(chain([[pass('203.0.113.7'), NOW - 20 * MINUTE], [pass('203.0.113.7'), NOW - 10 * MINUTE]])), false);
  assert.equal(proxyHistoryIpChanged([]), false); assert.equal(proxyHistoryIpChanged(undefined), false);
});

test('at most ten rows are shown, newest first, while thirty stays are kept per profile', () => {
  const steps = Array.from({ length: 45 }, (_, index) => [pass('203.0.113.' + (index + 1)), NOW - (50 - index) * MINUTE]);
  const entries = chain(steps);
  assert.equal(entries.length, PROXY_HISTORY_LIMITS.entries); assert.equal(PROXY_HISTORY_LIMITS.entries, 30);
  assert.equal(entries[0].ip, '203.0.113.16'); assert.equal(entries.at(-1).ip, '203.0.113.45');
  const rows = proxyHistoryRows(entries); assert.equal(rows.length, 10); assert.equal(rows[0].ip, '203.0.113.45'); assert.equal(rows.at(-1).ip, '203.0.113.36');
});

test('the count of a long stay saturates instead of overflowing, and clock skew never makes a stay run backwards', () => {
  let history = { version: 1, items: { 'p-1': [{ firstAt: NOW - 3 * MINUTE, lastAt: NOW - MINUTE, checks: 65535, ok: true, code: '', ms: 5, dns: 'ok', tls: 'ok', status: 200, ip: '203.0.113.7' }] } };
  history = appendProxyHistory(history, 'p-1', entryOf(pass('203.0.113.7'), NOW), NOW);
  assert.equal(proxyHistoryOf(history, 'p-1')[0].checks, 65535); assert.equal(proxyHistoryOf(history, 'p-1')[0].lastAt, NOW);
  history = appendProxyHistory(history, 'p-1', entryOf(pass('203.0.113.7'), NOW - 10 * MINUTE), NOW);
  const stay = proxyHistoryOf(history, 'p-1')[0]; assert.equal(stay.firstAt, NOW - 10 * MINUTE); assert.equal(stay.lastAt, NOW); assert.ok(stay.firstAt <= stay.lastAt);
});

test('profiles are capped at one hundred (the most recently checked stay) and every entry list is bounded on read', () => {
  const items = {};
  for (let index = 0; index < 130; index++) items['p-' + index] = [entryOf(pass('203.0.113.7'), NOW - (200 - index) * MINUTE)];
  const history = normalizeProxyHistory({ version: 1, items }, NOW);
  assert.equal(Object.keys(history.items).length, 100); assert.equal(Object.hasOwn(history.items, 'p-129'), true); assert.equal(Object.hasOwn(history.items, 'p-29'), false); assert.equal(Object.hasOwn(history.items, 'p-30'), true);
  const long = normalizeProxyHistory({ version: 1, items: { 'p-1': Array.from({ length: 5000 }, (_, index) => entryOf(fail('timeout'), NOW - 5000 + index)) } }, NOW);
  assert.equal(proxyHistoryOf(long, 'p-1').length, 30);
});

test('entries last confirmed more than thirty days ago are dropped on read, a stay older than that but confirmed lately is kept', () => {
  const fresh = entryOf(pass('203.0.113.7'), NOW - 29 * DAY), edge = entryOf(pass('203.0.113.8'), NOW - 30 * DAY), old = entryOf(pass('203.0.113.9'), NOW - 30 * DAY - 1);
  assert.deepEqual(proxyHistoryOf(normalizeProxyHistory({ version: 1, items: { 'p-1': [old, edge, fresh] } }, NOW), 'p-1').map(entry => entry.ip), ['203.0.113.8', '203.0.113.7']);
  const longStay = { ...fresh, firstAt: NOW - 90 * DAY, lastAt: NOW - DAY, checks: 40 };
  assert.deepEqual(sanitizeProxyHistoryEntry(longStay, NOW), longStay);
  assert.equal(normalizeProxyHistory({ version: 1, items: { 'p-1': [old] } }, NOW).items['p-1'], undefined, 'a profile with nothing left is removed');
  assert.equal(sanitizeProxyHistoryEntry({ ...fresh, firstAt: NOW + 3 * DAY, lastAt: NOW + 3 * DAY }, NOW), null, 'entries from the future never expire and are refused');
});

test('every malformed shape is discarded and nothing is repaired from guesses', () => {
  const good = entryOf(pass('203.0.113.7'), NOW - MINUTE);
  const mutations = [{ extra: 1 }, { firstAt: 1.5 }, { firstAt: -1 }, { lastAt: '1' }, { firstAt: NOW }, { checks: 0 }, { checks: 65536 }, { checks: 1.5 }, { ok: 'true' }, { code: 'timeout' }, { code: 'native-made-up' }, { ms: -1 }, { ms: 60001 }, { ms: 1.5 }, { dns: 'yes' }, { tls: null }, { status: 0 }, { status: 99 }, { status: 600 }, { ip: 'example.com' }, { ip: '203.0.113.007' }, { ip: '127.1' }, { ip: '2001:DB8::1' }, { ip: 'x'.repeat(46) }, { ip: 5 }, { ip: '203.0.113.7 ' },
    { ip: '', checks: 2 }, { ok: false, code: '', status: 0, ms: 0, ip: '' }, { ok: false, code: 'timeout', status: 200, ms: 0, ip: '' }, { ok: false, code: 'timeout', status: 0, ms: 5, ip: '' }, { ok: false, code: 'timeout', status: 0, ms: 0, ip: '203.0.113.7' }, { ok: false, code: 'timeout', status: 0, ms: 0, ip: '', checks: 2 }];
  for (const patch of mutations) assert.equal(sanitizeProxyHistoryEntry({ ...good, ...patch }, NOW), null, JSON.stringify(patch));
  const missing = { ...good }; delete missing.tls; assert.equal(sanitizeProxyHistoryEntry(missing, NOW), null);
  const accessor = { ...good }; Object.defineProperty(accessor, 'ip', { enumerable: true, get() { throw Error('must not be read'); } }); assert.equal(sanitizeProxyHistoryEntry(accessor, NOW), null);
  assert.equal(sanitizeProxyHistoryEntry(Object.create({ ...good }), NOW), null); assert.equal(sanitizeProxyHistoryEntry([good], NOW), null); assert.equal(sanitizeProxyHistoryEntry(null, NOW), null);
  assert.deepEqual(sanitizeProxyHistoryEntry({ ...good, ip: '2001:db8::1' }, NOW).ip, '2001:db8::1');
  for (const raw of [undefined, null, 'x', 5, [], { version: 2, items: {} }, { version: 1 }, { version: 1, items: [] }, { version: 1, items: {}, extra: 1 }, { items: {} }]) assert.deepEqual(normalizeProxyHistory(raw, NOW), { version: 1, enabled: true, items: {} }, JSON.stringify(raw));
  const mixed = normalizeProxyHistory({ version: 1, items: { 'p-1': [good, null, 'x', { ...good, ms: -1 }], 'bad id!': [good], '': [good], 'p-2': 'nope', 'p-3': { 0: good } } }, NOW);
  assert.deepEqual(Object.keys(mixed.items), ['p-1']); assert.deepEqual(mixed.items['p-1'], [good]);
});

test('a profile ID that is also a prototype member never reads a prototype value', () => {
  const entry = entryOf(pass('203.0.113.7'), NOW - MINUTE);
  assert.deepEqual(proxyHistoryOf({ version: 1, items: {} }, 'constructor'), []); assert.deepEqual(proxyHistoryOf({ version: 1, items: {} }, 'toString'), []); assert.deepEqual(proxyHistoryOf(null, 'p-1'), []);
  const history = appendProxyHistory({ version: 1, items: {} }, 'constructor', entry, NOW);
  assert.deepEqual(proxyHistoryOf(history, 'constructor'), [entry]); assert.deepEqual(removeProxyHistory(history, 'constructor', NOW), { version: 1, enabled: true, items: {} });
  assert.throws(() => appendProxyHistory({ version: 1, items: {} }, '__proto__', entry, NOW)); assert.throws(() => appendProxyHistory({ version: 1, items: {} }, 'a b', entry, NOW));
  assert.equal(Object.getPrototypeOf(history.items), Object.prototype);
});

test('removing a profile and pruning to the profiles that still exist leave the others untouched', () => {
  let history = { version: 1, items: {} };
  for (const id of ['p-1', 'p-2', 'p-3']) history = appendProxyHistory(history, id, entryOf(pass('203.0.113.7'), NOW - MINUTE), NOW);
  assert.deepEqual(Object.keys(removeProxyHistory(history, 'p-2', NOW).items).sort(), ['p-1', 'p-3']);
  assert.deepEqual(Object.keys(pruneProxyHistory(history, ['p-3', 'p-9'], NOW).items), ['p-3']);
  assert.deepEqual(removeProxyHistory({ version: 1, items: {} }, 'p-1', NOW), { version: 1, enabled: true, items: {} });
});

test('the store reads, records, removes, prunes and clears through one storage key and drops what is invalid or expired', async () => {
  const { state, local } = area(undefined); let clock = NOW;
  const store = createProxyHistoryStore({ storage: { local } }, { now: () => clock });
  assert.equal(store.available, true); assert.deepEqual(await store.read(), { version: 1, enabled: true, items: {} }); assert.equal(state.sets + state.removes, 0, 'reading nothing writes nothing');
  await store.record('p-1', entryOf(pass('203.0.113.7'), clock)); clock += MINUTE; await store.record('p-1', entryOf(pass('203.0.113.7'), clock)); await store.record('p-2', entryOf(fail('auth-failed', 'auth'), clock));
  assert.deepEqual(Object.keys(state.value), ['version', 'enabled', 'items']); assert.equal(state.value.items['p-1'].length, 1); assert.equal(state.value.items['p-1'][0].checks, 2);
  assert.doesNotMatch(JSON.stringify(state.value), /http|password|username|token/i);
  assert.deepEqual(Object.keys((await store.prune(['p-1'])).items), ['p-1']); assert.equal(Object.hasOwn(state.value.items, 'p-2'), false);
  clock += 31 * DAY; assert.deepEqual(await store.read(), { version: 1, enabled: true, items: {} }); assert.equal(state.value, undefined, 'an emptied history leaves no key behind');
  await store.record('p-1', entryOf(pass('203.0.113.7'), clock)); assert.deepEqual(await store.clear(), { version: 1, enabled: true, items: {} }); assert.equal(state.value, undefined);
  await store.record('p-1', entryOf(pass('203.0.113.7'), clock)); await store.record('p-2', entryOf(pass('203.0.113.8'), clock));
  assert.deepEqual(Object.keys((await store.remove('p-1')).items), ['p-2']);
});

test('the first read removes malformed stored data, and a record merges with a change made by another page in between', async () => {
  const bad = area({ version: 1, items: { 'p-1': [{ junk: true }], 'p-2': 'x' }, secret: 'PRIVATE' });
  const store = createProxyHistoryStore({ storage: { local: bad.local } }, { now: () => NOW });
  assert.deepEqual(await store.read(), { version: 1, enabled: true, items: {} }); assert.equal(bad.state.value, undefined);
  const shared = area(undefined), pageA = createProxyHistoryStore({ storage: { local: shared.local } }, { now: () => NOW }), pageB = createProxyHistoryStore({ storage: { local: shared.local } }, { now: () => NOW });
  await pageA.record('p-1', entryOf(pass('203.0.113.7'), NOW - 2 * MINUTE)); await pageB.record('p-2', entryOf(pass('203.0.113.8'), NOW - MINUTE)); await pageA.record('p-3', entryOf(pass('203.0.113.9'), NOW));
  assert.deepEqual(Object.keys(shared.state.value.items).sort(), ['p-1', 'p-2', 'p-3'], 'each write starts from a fresh read');
});

test('two checks finishing together are both recorded in order: the store runs one task at a time', async () => {
  const slow = area(undefined), original = slow.local.get;
  slow.local.get = async key => { const value = await original(key); await new Promise(resolve => setTimeout(resolve, 5)); return value; };
  const store = createProxyHistoryStore({ storage: { local: slow.local } }, { now: () => NOW });
  await Promise.all([1, 2, 3, 4].map(index => store.record('p-1', entryOf(pass('203.0.113.7', { elapsedMs: index * 10 }), NOW - (5 - index) * 1000))));
  const stay = slow.state.value.items['p-1'][0]; assert.equal(stay.checks, 4); assert.equal(stay.ms, 40);
});

test('storage failures and a missing storage area resolve to null and never throw into the proxy features', async () => {
  const broken = { get: async () => { throw new Error('quota'); }, set: async () => { throw new Error('quota'); }, remove: async () => { throw new Error('quota'); } };
  const store = createProxyHistoryStore({ storage: { local: broken } }, { now: () => NOW });
  assert.equal(store.available, true);
  for (const result of [await store.read(), await store.record('p-1', entryOf(pass(), NOW)), await store.remove('p-1'), await store.prune([]), await store.clear(), await store.enabled(), await store.setEnabled(false), await isHistoryEnabled({ storage: { local: broken } }), await setHistoryEnabled({ storage: { local: broken } }, true)]) assert.equal(result, null);
  const none = createProxyHistoryStore({}, { now: () => NOW }); assert.equal(none.available, false);
  for (const result of [await none.read(), await none.record('p-1', entryOf(pass(), NOW)), await none.clear(), await none.enabled(), await none.setEnabled(true), await isHistoryEnabled(undefined), await isHistoryEnabled({}), await setHistoryEnabled(null, false)]) assert.equal(result, null);
  const partial = createProxyHistoryStore({ storage: { local: { get: async () => ({}), set: async () => {} } } }, { now: () => NOW }); assert.equal(partial.available, false);
  const failedCleanup = area({ version: 1, items: { 'p-1': ['junk'] } }); failedCleanup.local.remove = async () => { throw new Error('locked'); };
  assert.deepEqual(await createProxyHistoryStore({ storage: { local: failedCleanup.local } }, { now: () => NOW }).read(), { version: 1, enabled: true, items: {} }, 'a failed cleanup still returns the sanitized view');
});

test('the history is not part of the proxy configuration, a metadata export or the bundle, and has its own key', async () => {
  assert.equal(PROXY_HISTORY_KEY, 'proxy-check-history:v1');
  const { PROXY_STORAGE_KEY, exportProxyConfiguration, createDefaultProxyConfiguration } = await import('../../apps/production-extension/proxy-shared.js');
  assert.notEqual(PROXY_HISTORY_KEY, PROXY_STORAGE_KEY);
  assert.doesNotMatch(exportProxyConfiguration(createDefaultProxyConfiguration()), /history|firstAt|lastAt/i);
});

test('a profile history is read from own keys only, even when the object prototype carries an array under that name', () => {
  const real = entryOf(pass('203.0.113.7'), NOW - MINUTE);
  Object.defineProperty(Object.prototype, 'polluted-profile', { value: [real], configurable: true, enumerable: false });
  try {
    assert.deepEqual(proxyHistoryOf({ version: 1, items: {} }, 'polluted-profile'), []);
    assert.deepEqual(proxyHistoryOf(appendProxyHistory({ version: 1, items: {} }, 'p-1', real, NOW), 'polluted-profile'), []);
    assert.equal(proxyHistoryOf(appendProxyHistory({ version: 1, items: {} }, 'p-1', real, NOW), 'p-1').length, 1);
  } finally { delete Object.prototype['polluted-profile']; }
});

// ---- the switch for saving results ---------------------------------------------------------------------------------------------------------
const opts = { now: () => NOW }, on = (source, flag) => setHistoryEnabled(source, flag, opts), isOn = source => isHistoryEnabled(source, opts);
const seeded = (...ids) => { let history = { version: 1, items: {} }; for (const id of ids) history = appendProxyHistory(history, id, entryOf(pass('203.0.113.7'), NOW - MINUTE), NOW); return history; };

test('the switch is on by default: no key, a value from before the switch and a malformed flag all read as on, and reading an old value writes nothing', async () => {
  const empty = area(undefined);
  assert.equal(await isOn({ storage: { local: empty.local } }), true); assert.equal(empty.state.sets + empty.state.removes, 0);
  const old = area({ version: 1, items: seeded('p-1').items }), store = createProxyHistoryStore({ storage: { local: old.local } }, { now: () => NOW });
  assert.equal(await store.enabled(), true); const read = await store.read();
  assert.deepEqual(read, { version: 1, enabled: true, items: seeded('p-1').items }, 'old data keeps loading with its entries');
  assert.equal(old.state.sets + old.state.removes, 0); assert.equal(Object.hasOwn(old.state.value, 'enabled'), false, 'a read does not rewrite a value written before the switch');
  assert.equal(normalizeProxyHistory({ version: 1, items: {} }, NOW).enabled, true);
  // A flag that is not a boolean is discarded (the entries are judged on their own) and the first read stores what it kept.
  for (const bad of ['yes', 'false', 0, 1, null, {}, [], undefined]) {
    const odd = area({ version: 1, enabled: bad, items: seeded('p-1').items }), oddStore = createProxyHistoryStore({ storage: { local: odd.local } }, { now: () => NOW });
    assert.equal(await oddStore.enabled(), true, JSON.stringify(bad)); assert.deepEqual(Object.keys((await oddStore.read()).items), ['p-1'], JSON.stringify(bad));
    assert.deepEqual(odd.state.value, { version: 1, enabled: true, items: seeded('p-1').items }, 'the malformed flag is gone from storage: ' + JSON.stringify(bad));
  }
  // A key that does not belong is not a flag problem but a malformed value, and everything is dropped.
  const extra = area({ version: 1, enabled: false, items: seeded('p-1').items, secret: 'PRIVATE' });
  assert.deepEqual(await createProxyHistoryStore({ storage: { local: extra.local } }, { now: () => NOW }).read(), { version: 1, enabled: true, items: {} }); assert.equal(extra.state.value, undefined);
});

test('setHistoryEnabled stores the flag next to the entries and keeps them; the default is stored as no key at all; anything but a boolean changes nothing', async () => {
  const { state, local } = area(undefined), storage = { storage: { local } }, store = createProxyHistoryStore(storage, { now: () => NOW });
  assert.equal(await on(storage, true), true); assert.equal(state.sets + state.removes, 0, 'the default needs no write');
  await store.record('p-1', entryOf(pass('203.0.113.7'), NOW - MINUTE));
  assert.equal(await on(storage, false), false); assert.equal(await isOn(storage), false);
  assert.equal(state.value.enabled, false); assert.deepEqual(Object.keys(state.value), ['version', 'enabled', 'items']); assert.equal(state.value.items['p-1'].length, 1, 'turning it off keeps what was saved');
  const writes = state.sets + state.removes; assert.equal(await on(storage, false), false); assert.equal(state.sets + state.removes, writes, 'the same value is not written again');
  for (const bad of ['false', 'true', 0, 1, null, undefined, {}, []]) { assert.equal(await on(storage, bad), null, String(bad)); assert.equal(state.sets + state.removes, writes, 'a non-boolean changes nothing: ' + String(bad)); }
  assert.equal(await isOn(storage), false);
  assert.equal(await on(storage, true), true); assert.equal(await isOn(storage), true); assert.equal(state.value.enabled, true); assert.equal(state.value.items['p-1'].length, 1);
  await store.clear(); assert.equal(state.value, undefined, 'on and empty is the default again: no key');
  assert.equal(await on(storage, false), false); assert.deepEqual(state.value, { version: 1, enabled: false, items: {} }, 'off with nothing saved still stores the choice');
  assert.throws(() => withProxyHistoryEnabled({ version: 1, items: {} }, 'yes', NOW), error => error.code === 'invalid-input');
});

test('while the switch is off nothing is recorded and nothing is written, the entries stay, and removing and clearing still work and keep the choice', async () => {
  const { state, local } = area(undefined), storage = { storage: { local } }, store = createProxyHistoryStore(storage, { now: () => NOW });
  await store.record('p-1', entryOf(pass('203.0.113.7'), NOW - 2 * MINUTE)); await store.record('p-2', entryOf(pass('203.0.113.8'), NOW - MINUTE));
  await on(storage, false);
  const writes = state.sets + state.removes, before = JSON.stringify(state.value);
  const result = await store.record('p-1', entryOf(pass('203.0.113.9'), NOW)); await store.record('p-3', entryOf(fail('auth-failed', 'auth'), NOW));
  assert.deepEqual(Object.keys(result.items).sort(), ['p-1', 'p-2'], 'the result is the history as it is'); assert.equal(result.enabled, false);
  assert.equal(state.sets + state.removes, writes, 'no write at all'); assert.equal(JSON.stringify(state.value), before);
  assert.deepEqual(appendProxyHistory(result, 'p-4', entryOf(pass('203.0.113.7'), NOW), NOW), result, 'the pure update refuses as well');
  assert.deepEqual(Object.keys((await store.read()).items).sort(), ['p-1', 'p-2'], 'what was saved is still shown');
  assert.deepEqual(Object.keys((await store.remove('p-1')).items), ['p-2']); assert.equal(state.value.enabled, false, 'removing a profile keeps the choice');
  assert.deepEqual(Object.keys((await store.prune(['p-9'])).items), []); assert.deepEqual(state.value, { version: 1, enabled: false, items: {} }, 'pruning keeps the choice');
  await on(storage, true); await store.record('p-1', entryOf(pass('203.0.113.7'), NOW)); await on(storage, false);
  assert.deepEqual(await store.clear(), { version: 1, enabled: false, items: {} }); assert.deepEqual(state.value, { version: 1, enabled: false, items: {} }, 'clearing empties the entries and keeps the choice');
  await on(storage, true); await store.record('p-1', entryOf(pass('203.0.113.7'), NOW)); assert.equal(state.value.items['p-1'].length, 1, 'recording resumes when it is switched on');
  const pure = { version: 1, enabled: false, items: seeded('p-1').items };
  assert.equal(removeProxyHistory(pure, 'p-1', NOW).enabled, false); assert.equal(pruneProxyHistory(pure, ['p-1'], NOW).enabled, false); assert.equal(normalizeProxyHistory(pure, NOW).enabled, false);
});

test('the helpers and every store over one storage area share one queue: a switch change and a record made together are applied in the order they were made', async () => {
  const slow = area(undefined), original = slow.local.get;
  slow.local.get = async key => { const value = await original(key); await new Promise(resolve => setTimeout(resolve, 4)); return value; };
  const storage = { storage: { local: slow.local } }, store = createProxyHistoryStore(storage, { now: () => NOW });
  await Promise.all([store.record('p-1', entryOf(pass('203.0.113.7'), NOW - 3000)), on(storage, false), store.record('p-2', entryOf(pass('203.0.113.8'), NOW - 2000)), isOn(storage), on(storage, true), store.record('p-3', entryOf(pass('203.0.113.9'), NOW - 1000))]);
  assert.deepEqual(Object.keys(slow.state.value.items).sort(), ['p-1', 'p-3'], 'p-2 arrived while it was off, the other two while it was on'); assert.equal(slow.state.value.enabled, true);
});

test('the helpers take the browser API, the storage namespace or a storage area, and anything else is unavailable', async () => {
  const { local } = area(undefined);
  for (const source of [{ storage: { local } }, { local }, local]) { assert.equal(await on(source, false), false); assert.equal(await isOn(source), false); await on(source, true); }
  for (const source of [undefined, null, {}, { storage: {} }, { storage: { local: { get: async () => ({}) } } }, 'storage', 5]) { assert.equal(await isOn(source), null, String(source)); assert.equal(await on(source, true), null, String(source)); }
});

test('the switch strings exist in all 21 languages, are authored (not the English text), and the English note says what is saved and that nothing is sent', async () => {
  const { PROXY_WORKSPACE_MESSAGES } = await import('../production-locales-proxy.mjs'), { PRODUCTION_LANGUAGES } = await import('../production-languages.mjs');
  const en = PROXY_WORKSPACE_MESSAGES.en;
  assert.equal(en.proxy_workspace_history_save, 'Save check history');
  assert.equal(en.proxy_workspace_history_save_note, 'Save the result of each manual check on this computer (time, result, speed and the exit IP of the proxy) so you can see when it changes. This history itself is never sent anywhere.');
  assert.equal(PRODUCTION_LANGUAGES.length, 21);
  for (const language of PRODUCTION_LANGUAGES) {
    const messages = PROXY_WORKSPACE_MESSAGES[language.id];
    for (const key of ['proxy_workspace_history_save', 'proxy_workspace_history_save_note']) {
      assert.ok(messages[key] && messages[key] === messages[key].trim(), language.id + ' ' + key);
      if (language.id !== 'en') assert.notEqual(messages[key], en[key], language.id + ' ' + key + ' is untranslated');
      assert.doesNotMatch(messages[key], /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2066-\u2069\u202a-\u202e]/, language.id + ' has no control or bidi override');
    }
    assert.match(messages.proxy_workspace_history_save_note, /IP/, language.id + ' names the exit IP');
    assert.ok(messages.proxy_workspace_history_save_note.length > messages.proxy_workspace_history_save.length, language.id);
  }
});
