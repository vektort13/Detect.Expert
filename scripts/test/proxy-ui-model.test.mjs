// Round 5: the pure helpers behind the redesigned Proxy manager (filter, sort, selection, grid keyboard, check queue, view preferences,
// relative time, sparkline, domain chips, per-field errors). No DOM and no browser API: everything here is a function of its arguments.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROXY_VIEW_KEY, PROXY_VIEW_COLUMNS, PROXY_VIEW_SORTS, PROXY_VIEW_DENSITIES, DEFAULT_PROXY_VIEW, PROXY_LATENCY_STEPS, PROXY_STATUS_FILTERS,
  normalizeProxyView, readProxyView, writeProxyView, clearProxyView, proxyViewPatch, proxyRovingTarget, proxyLatencyBucket, proxyEntryDiagnostic, proxyMergedChecks, proxyCheckStateOf,
  proxyRelativeParts, proxyFormatRelative, proxySparkline, proxyFilterProfiles, proxyFacetCounts, proxyCountriesPresent, proxyHasFilters,
  proxyCompare, proxyToggleSelection, proxySelectRange, proxyReconcileSelection, proxyGridKeyAction, runProxyCheckQueue,
  proxyDomainEntry, proxyDomainTokens, proxyDraftErrors,
} from '../../apps/production-extension/proxy-ui-model.js';
import { PROXY_LIMITS } from '../../apps/production-extension/proxy-shared.js';

const profile = (id, patch = {}) => ({ id, name: id, type: 'socks5', host: id + '.example.test', port: 1080, ...patch });
const pass = (ms, extra = {}) => ({ diagnostic: { state: 'pass', reachable: true, remoteDns: true, tlsVerified: true, httpStatus: 200, ip: '203.0.113.9', elapsedMs: ms }, checkedAt: 1000, ...extra });
const fail = (code = 'auth-failed', extra = {}) => ({ diagnostic: { state: 'fail', code }, checkedAt: 1000, ...extra });
const storageOf = (initial = null) => { const state = { value: initial, writes: 0 }; return { state, getItem: key => key === PROXY_VIEW_KEY ? state.value : null, setItem: (key, value) => { if (key !== PROXY_VIEW_KEY) throw Error('unexpected key'); state.value = value; state.writes++; } }; };
const goodView = { version: 1, density: 'compact', columns: ['checked', 'type', 'ip'], sort: 'latency', dir: 'desc' };

// ---- View preferences -------------------------------------------------------------------------------------------------------------
test('view preferences: a valid value is read back in canonical column order and the result is frozen', () => {
  const view = normalizeProxyView(goodView);
  assert.deepEqual({ ...view }, { density: 'compact', columns: ['type', 'ip', 'checked'], sort: 'latency', dir: 'desc' });
  assert.ok(Object.isFrozen(view) && Object.isFrozen(view.columns));
  assert.deepEqual(normalizeProxyView({ ...goodView, columns: [] }).columns, [], 'every optional column may be hidden');
  assert.equal(normalizeProxyView(null), DEFAULT_PROXY_VIEW); assert.equal(DEFAULT_PROXY_VIEW.columns.length, PROXY_VIEW_COLUMNS.length);
});

test('view preferences: any unexpected shape is the default and never throws', () => {
  const accessor = { ...goodView }; Object.defineProperty(accessor, 'sort', { enumerable: true, get() { throw Error('must not run'); } });
  const inherited = Object.create({ version: 1 }); Object.assign(inherited, goodView);
  const bad = [
    undefined, 7, 'x', [], [goodView], () => goodView, accessor, inherited, new (class V { constructor() { Object.assign(this, goodView); } })(),
    { ...goodView, version: 2 }, { ...goodView, extra: 1 }, { ...goodView, density: 'tight' }, { ...goodView, sort: 'password' }, { ...goodView, dir: 'up' },
    { ...goodView, columns: 'type' }, { ...goodView, columns: ['type', 'type'] }, { ...goodView, columns: ['type', 'secret'] }, { ...goodView, columns: [...PROXY_VIEW_COLUMNS, 'type'] }, { ...goodView, columns: [1] },
    (() => { const copy = { ...goodView }; delete copy.dir; return copy; })(), (() => { const copy = { ...goodView }; Object.defineProperty(copy, Symbol('x'), { value: 1, enumerable: true }); return copy; })(),
  ];
  bad.forEach((value, index) => assert.equal(normalizeProxyView(value), DEFAULT_PROXY_VIEW, 'case ' + index));
});

test('view preferences: storage is read strictly and guarded, written canonically and never throws', () => {
  assert.equal(readProxyView(null), DEFAULT_PROXY_VIEW); assert.equal(readProxyView({}), DEFAULT_PROXY_VIEW);
  assert.equal(readProxyView(storageOf('{not json')), DEFAULT_PROXY_VIEW); assert.equal(readProxyView(storageOf('')), DEFAULT_PROXY_VIEW);
  assert.equal(readProxyView(storageOf(JSON.stringify({ ...goodView, pad: 'x'.repeat(2000) }))), DEFAULT_PROXY_VIEW, 'an oversized value is not parsed');
  assert.equal(readProxyView({ getItem() { throw Error('storage disabled'); } }), DEFAULT_PROXY_VIEW);
  assert.deepEqual({ ...readProxyView(storageOf(JSON.stringify(goodView))) }, { density: 'compact', columns: ['type', 'ip', 'checked'], sort: 'latency', dir: 'desc' });
  const area = storageOf(); assert.equal(writeProxyView(area, { density: 'compact', columns: ['ip', 'type'], sort: 'host', dir: 'asc', secret: 'LOGIN_CANARY' }), true);
  assert.deepEqual(JSON.parse(area.state.value), { version: 1, density: 'compact', columns: ['type', 'ip'], sort: 'host', dir: 'asc' }); assert.doesNotMatch(area.state.value, /LOGIN_CANARY/);
  assert.equal(writeProxyView({ setItem() { throw Error('quota'); } }, DEFAULT_PROXY_VIEW), false);
  const before = area.state.writes; assert.equal(writeProxyView(area, { density: 'nope' }), true, 'an invalid view is stored as the default, not as given'); assert.equal(area.state.writes, before + 1);
  assert.deepEqual(JSON.parse(area.state.value), { version: 1, density: 'comfortable', columns: [...PROXY_VIEW_COLUMNS], sort: 'name', dir: 'asc' });
  assert.deepEqual([...PROXY_VIEW_DENSITIES], ['comfortable', 'compact']); assert.ok(PROXY_VIEW_SORTS.includes('country') && PROXY_VIEW_SORTS.includes('latency'));
});

test('the view can be cleared, and a patch never lets one bad value reset the rest', () => {
  const area = storageOf(JSON.stringify(goodView)); area.removeItem = key => { if (key !== PROXY_VIEW_KEY) throw Error('unexpected key'); area.state.value = null; };
  assert.equal(clearProxyView(area), true); assert.equal(readProxyView(area), DEFAULT_PROXY_VIEW, 'a cleared view reads as the default'); assert.equal(clearProxyView({ removeItem() { throw Error('blocked'); } }), false); assert.equal(clearProxyView(null), false);
  const base = normalizeProxyView(goodView);
  assert.deepEqual({ ...proxyViewPatch(base, { density: 'comfortable' }) }, { density: 'comfortable', columns: ['type', 'ip', 'checked'], sort: 'latency', dir: 'desc' });
  assert.deepEqual({ ...proxyViewPatch(base, { sort: 'password', density: 'tight', dir: 'up', columns: ['type', 'secret'], extra: 1 }) }, { ...base, columns: [...base.columns] }, 'every invalid part is ignored');
  assert.deepEqual([...proxyViewPatch(base, { columns: ['checked', 'checked', 'type'] }).columns], ['type', 'checked'], 'duplicates fold and the order is canonical');
  assert.deepEqual({ ...proxyViewPatch(null, null) }, { ...DEFAULT_PROXY_VIEW, columns: [...DEFAULT_PROXY_VIEW.columns] }); assert.deepEqual({ ...proxyViewPatch({ junk: true }, 'text') }, { ...DEFAULT_PROXY_VIEW, columns: [...DEFAULT_PROXY_VIEW.columns] });
});

// ---- Latency and stored results ----------------------------------------------------------------------------------------------------
test('latency buckets use the documented steps and say nothing for a value that is not a time', () => {
  assert.deepEqual([0, 1, PROXY_LATENCY_STEPS.fast, PROXY_LATENCY_STEPS.fast + 1, PROXY_LATENCY_STEPS.ok, PROXY_LATENCY_STEPS.ok + 1, 60000].map(proxyLatencyBucket), ['fast', 'fast', 'fast', 'ok', 'ok', 'slow', 'slow']);
  for (const value of [-1, NaN, Infinity, -Infinity, null, undefined, '12', {}, [], 12n]) assert.equal(proxyLatencyBucket(value), null, String(value));
});

test('stored history entries become the same result shape as live checks, and live results of this visit win', () => {
  assert.deepEqual(proxyEntryDiagnostic({ ok: true, dns: 'ok', tls: 'fail', status: 204, ip: '203.0.113.5', ms: 80 }), { state: 'pass', reachable: true, remoteDns: true, tlsVerified: false, httpStatus: 204, ip: '203.0.113.5', elapsedMs: 80 });
  assert.equal(proxyEntryDiagnostic({ ok: true, dns: 'unknown', tls: 'unknown', status: 200, ip: '', ms: 5 }).ip, null);
  assert.deepEqual(proxyEntryDiagnostic({ ok: false, code: 'timeout' }), { state: 'fail', code: 'timeout' });
  for (const value of [null, undefined, 3, 'x', {}, { ok: false }, { ok: false, code: 7 }]) assert.equal(proxyEntryDiagnostic(value), null, JSON.stringify(value));
  const profiles = [profile('a'), profile('b'), profile('c')];
  const history = { items: { a: [{ ok: true, dns: 'ok', tls: 'ok', status: 200, ip: '203.0.113.5', ms: 90, firstAt: 1, lastAt: 500, checks: 1 }], b: [{ ok: false, code: 'timeout', firstAt: 1, lastAt: 700, checks: 1 }] } };
  const merged = proxyMergedChecks({ b: fail('auth-failed', { checkedAt: 900 }), ghost: pass(1) }, history, profiles);
  assert.deepEqual(Object.keys(merged).sort(), ['a', 'b']); assert.equal(merged.a.stored, true); assert.equal(merged.a.checkedAt, 500); assert.equal(merged.b.diagnostic.code, 'auth-failed', 'a result of this visit replaces the stored one'); assert.equal(merged.b.stored, undefined);
  assert.equal(merged.c, undefined, 'no check, no result');
  assert.deepEqual(proxyMergedChecks(null, null, profiles), {}); assert.deepEqual(proxyMergedChecks({}, { items: {} }, []), {});
});

test('the check state of a profile is pass, fail or unchecked, never inherited from the prototype', () => {
  const checks = { a: pass(10), b: fail(), c: { diagnostic: { state: 'weird' } } };
  assert.deepEqual(['a', 'b', 'c', 'd', 'toString', '__proto__'].map(id => proxyCheckStateOf(checks, id)), ['pass', 'fail', 'unchecked', 'unchecked', 'unchecked', 'unchecked']);
  assert.equal(proxyCheckStateOf(null, 'a'), 'unchecked');
});

// ---- Relative time ---------------------------------------------------------------------------------------------------------------------
test('relative time rounds into the right unit at the boundaries and refuses what is not a time', () => {
  const now = Date.UTC(2026, 10, 6, 12, 0, 0), at = offset => proxyRelativeParts(now + offset, now);
  assert.deepEqual(at(0), { unit: 'second', value: 0 }); assert.deepEqual(at(-44999), { unit: 'second', value: 0 });
  assert.deepEqual(at(-45000), { unit: 'minute', value: -1 }); assert.deepEqual(at(-90 * 1000), { unit: 'minute', value: -2 }); assert.deepEqual(at(-44 * 60000), { unit: 'minute', value: -44 });
  assert.deepEqual(at(-45 * 60000), { unit: 'hour', value: -1 }); assert.deepEqual(at(-5 * 3600000), { unit: 'hour', value: -5 });
  assert.deepEqual(at(-22 * 3600000), { unit: 'day', value: -1 }); assert.deepEqual(at(-3 * 86400000), { unit: 'day', value: -3 });
  assert.deepEqual(at(-26 * 86400000), { unit: 'month', value: -1 }); assert.deepEqual(at(-100 * 86400000), { unit: 'month', value: -3 });
  assert.deepEqual(at(-320 * 86400000), { unit: 'year', value: -1 }); assert.deepEqual(at(-800 * 86400000), { unit: 'year', value: -2 });
  assert.deepEqual(at(5 * 60000), { unit: 'minute', value: 5 }, 'a clock that is a little ahead is a positive value, not an error');
  for (const bad of [NaN, Infinity, undefined, null, '5']) assert.equal(proxyRelativeParts(bad, now), null, String(bad)); assert.equal(proxyRelativeParts(now, NaN), null);
});

test('relative time is localized with Intl and falls back to an empty string rather than throwing', () => {
  const now = Date.UTC(2026, 10, 6, 12, 0, 0);
  assert.equal(proxyFormatRelative(now - 5 * 60000, now, 'en'), '5 min. ago'); assert.equal(proxyFormatRelative(now - 10000, now, 'en'), 'now');
  assert.match(proxyFormatRelative(now - 3 * 3600000, now, 'ru'), /3\s*ч/); assert.notEqual(proxyFormatRelative(now - 3 * 3600000, now, 'ar'), proxyFormatRelative(now - 3 * 3600000, now, 'en'));
  assert.equal(proxyFormatRelative(NaN, now, 'en'), ''); assert.equal(proxyFormatRelative(now, now, 'not a language tag!!'), '');
  for (let index = 0; index < 20; index++) proxyFormatRelative(now - index * 3600000, now, 'en-US-x-' + 'a'.repeat(index + 1)); // the formatter cache stays bounded and valid
});

// ---- Sparkline -------------------------------------------------------------------------------------------------------------------------
test('sparkline needs two real response times, ignores anything else and stays inside its box', () => {
  assert.equal(proxySparkline([]), null); assert.equal(proxySparkline([40]), null); assert.equal(proxySparkline([NaN, -5, Infinity, 'x', null, 40]), null); assert.equal(proxySparkline('nope'), null); assert.equal(proxySparkline(undefined), null);
  const line = proxySparkline([100, 'x', 300, NaN, 200, -1], { width: 100, height: 40, pad: 4 });
  assert.equal(line.count, 3); assert.equal(line.min, 100); assert.equal(line.max, 300); assert.equal(line.median, 200); assert.equal(line.width, 100); assert.equal(line.height, 40);
  assert.deepEqual(line.points.map(point => point.x), [4, 50, 96]); assert.deepEqual(line.points.map(point => point.y), [36, 4, 20], 'the slowest value is the highest point of the line');
  for (const point of line.points) assert.ok(point.x >= 4 && point.x <= 96 && point.y >= 4 && point.y <= 36);
  assert.match(line.line, /^M4 36L50 4L96 20$/); assert.match(line.area, /^M4 36L50 4L96 20L96 36L4 36Z$/); assert.deepEqual(line.last, { x: 96, y: 20 });
  const flat = proxySparkline([70, 70, 70]); assert.deepEqual(new Set(flat.points.map(point => point.y)), new Set([18]), 'a flat series is a line in the middle'); assert.equal(flat.median, 70);
  assert.equal(proxySparkline([10, 20, 30, 50]).median, 25, 'the median of an even count is the rounded mean of the middle pair');
  assert.doesNotMatch(JSON.stringify(proxySparkline([5, 6])), /NaN|null|Infinity/);
});

// ---- Filter, facets, sort -----------------------------------------------------------------------------------------------------------
const roster = [
  profile('alpha', { name: 'Alpha', country: 'DE', port: 1080 }), profile('bravo', { name: 'bravo', type: 'http', country: 'FR', port: 8080 }),
  profile('charlie', { name: 'Charlie', type: 'https', port: 443 }), profile('delta', { name: 'Delta', type: 'vless', country: 'DE' }),
  profile('echo', { name: 'Echo', type: 'openvpn', host: 'vpn.example.test', port: 1194 }),
];
const checks = { alpha: pass(120, { checkedAt: 3000 }), bravo: fail('timeout', { checkedAt: 2000 }), delta: pass(900, { checkedAt: 1000 }) };
const ids = list => list.map(item => item.id);

test('filtering narrows by type, status, country and a case-insensitive query over name, host, endpoint, type label and tag', () => {
  assert.deepEqual(ids(proxyFilterProfiles(roster, {}, checks)), ['alpha', 'bravo', 'charlie', 'delta', 'echo']);
  assert.deepEqual(ids(proxyFilterProfiles(roster, { type: 'vless' }, checks)), ['delta']);
  assert.deepEqual(ids(proxyFilterProfiles(roster, { status: 'pass' }, checks)), ['alpha', 'delta']); assert.deepEqual(ids(proxyFilterProfiles(roster, { status: 'fail' }, checks)), ['bravo']); assert.deepEqual(ids(proxyFilterProfiles(roster, { status: 'unchecked' }, checks)), ['charlie', 'echo']);
  assert.deepEqual(ids(proxyFilterProfiles(roster, { country: 'DE' }, checks)), ['alpha', 'delta']); assert.deepEqual(ids(proxyFilterProfiles(roster, { country: 'none' }, checks)), ['charlie', 'echo'], 'the "no tag" choice');
  assert.deepEqual(ids(proxyFilterProfiles(roster, { query: '  ALPHA ' }, checks)), ['alpha']); assert.deepEqual(ids(proxyFilterProfiles(roster, { query: 'vpn.example' }, checks)), ['echo']); assert.deepEqual(ids(proxyFilterProfiles(roster, { query: ':1194' }, checks)), ['echo']);
  assert.deepEqual(ids(proxyFilterProfiles(roster, { query: 'openvpn' }, checks)), ['echo']); assert.deepEqual(ids(proxyFilterProfiles(roster, { query: 'fr' }, checks)), ['bravo']);
  assert.deepEqual(ids(proxyFilterProfiles(roster, { type: 'http', status: 'pass' }, checks)), [], 'filters combine');
  assert.deepEqual(ids(proxyFilterProfiles(roster, { query: 'zzz' }, checks)), []);
  assert.deepEqual(ids(proxyFilterProfiles(roster, { status: 'pass' }, null)), [], 'without results nothing has passed');
});

test('facet counts show what choosing a chip would leave, given the other active filters', () => {
  const all = proxyFacetCounts(roster, {}, checks);
  assert.deepEqual({ ...all.type }, { all: 5, socks5: 1, http: 1, https: 1, vless: 1, openvpn: 1 }); assert.deepEqual({ ...all.status }, { all: 5, pass: 2, fail: 1, unchecked: 2 }); assert.equal(all.none, 2);
  assert.deepEqual(all.country, [{ code: 'DE', count: 2 }, { code: 'FR', count: 1 }]);
  const narrowed = proxyFacetCounts(roster, { country: 'DE' }, checks);
  assert.deepEqual({ ...narrowed.type }, { all: 2, socks5: 1, http: 0, https: 0, vless: 1, openvpn: 0 }); assert.deepEqual({ ...narrowed.status }, { all: 5 - 3 + 0 + 0, pass: 2, fail: 0, unchecked: 0 });
  assert.deepEqual(narrowed.country, [{ code: 'DE', count: 2 }, { code: 'FR', count: 1 }], 'the country chips ignore the country filter itself');
  const failedOnly = proxyFacetCounts(roster, { status: 'fail' }, checks); assert.equal(failedOnly.type.all, 1); assert.equal(failedOnly.status.pass, 2, 'status chips ignore the status filter itself');
  assert.deepEqual(proxyCountriesPresent(roster), [{ code: 'DE', count: 2 }, { code: 'FR', count: 1 }]); assert.deepEqual(proxyCountriesPresent([]), []);
  assert.equal(proxyHasFilters({}), false); assert.equal(proxyHasFilters({ query: '   ' }), false); assert.equal(proxyHasFilters({ query: 'x' }), true); assert.equal(proxyHasFilters({ type: 'http' }), true); assert.equal(proxyHasFilters({ status: 'fail' }), true); assert.equal(proxyHasFilters({ country: 'DE' }), true); assert.equal(proxyHasFilters(), false);
  assert.deepEqual([...PROXY_STATUS_FILTERS], ['all', 'pass', 'fail', 'unchecked']);
});

test('sorting is deterministic, honours both directions, and puts a missing value last either way', () => {
  const order = (sort, dir) => ids([...roster].sort(proxyCompare(sort, dir, checks)));
  assert.deepEqual(order('name', 'asc'), ['alpha', 'bravo', 'charlie', 'delta', 'echo']); assert.deepEqual(order('name', 'desc'), ['echo', 'delta', 'charlie', 'bravo', 'alpha']);
  assert.deepEqual(order('type', 'asc'), ['bravo', 'charlie', 'echo', 'alpha', 'delta']);
  assert.deepEqual(order('host', 'asc'), ['alpha', 'bravo', 'charlie', 'delta', 'echo']);
  assert.deepEqual(order('country', 'asc'), ['alpha', 'delta', 'bravo', 'charlie', 'echo']); assert.deepEqual(order('country', 'desc'), ['bravo', 'alpha', 'delta', 'charlie', 'echo'], 'no tag stays last when reversed');
  assert.deepEqual(order('latency', 'asc'), ['alpha', 'delta', 'bravo', 'charlie', 'echo']); assert.deepEqual(order('latency', 'desc'), ['delta', 'alpha', 'bravo', 'charlie', 'echo'], 'failed and unchecked have no time and stay last');
  assert.deepEqual(order('health', 'asc'), ['alpha', 'delta', 'bravo', 'charlie', 'echo']); assert.deepEqual(order('health', 'desc'), ['charlie', 'echo', 'bravo', 'alpha', 'delta']);
  assert.deepEqual(order('checked', 'asc'), ['delta', 'bravo', 'alpha', 'charlie', 'echo']); assert.deepEqual(order('checked', 'desc'), ['alpha', 'bravo', 'delta', 'charlie', 'echo']);
  assert.deepEqual(order('unknown-key', 'asc'), order('name', 'asc'), 'an unknown key sorts by name');
  const twins = [profile('b', { name: 'Same' }), profile('a', { name: 'Same' }), profile('c', { name: 'same' })]; assert.deepEqual(ids([...twins].sort(proxyCompare('name', 'asc', {}))), ['a', 'b', 'c'], 'equal names fall back to the ID');
  const input = Object.freeze([...roster]); assert.doesNotThrow(() => [...input].sort(proxyCompare('latency', 'asc', null))); assert.deepEqual(ids(roster), ['alpha', 'bravo', 'charlie', 'delta', 'echo'], 'the registry order is not touched');
});

// ---- Selection -----------------------------------------------------------------------------------------------------------------------------
test('selection toggles, extends over a range in the order shown, and drops what is no longer listed', () => {
  assert.deepEqual(proxyToggleSelection([], 'a'), ['a']); assert.deepEqual(proxyToggleSelection(['a', 'b'], 'a'), ['b']); const sel = ['a']; proxyToggleSelection(sel, 'b'); assert.deepEqual(sel, ['a'], 'the input is not mutated');
  const order = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(proxySelectRange(order, 'b', 'd'), ['b', 'c', 'd']); assert.deepEqual(proxySelectRange(order, 'd', 'b'), ['b', 'c', 'd'], 'either direction'); assert.deepEqual(proxySelectRange(order, 'c', 'c'), ['c']);
  assert.deepEqual(proxySelectRange(order, null, 'c'), ['c'], 'no anchor selects the target'); assert.deepEqual(proxySelectRange(order, 'a', 'missing'), []); assert.deepEqual(proxySelectRange([], 'a', 'b'), []);
  const selected = ['a', 'x', 'c']; assert.deepEqual(proxyReconcileSelection(selected, order), ['a', 'c']); assert.equal(proxyReconcileSelection(['a', 'c'], order).length, 2);
  const same = ['a', 'b']; assert.equal(proxyReconcileSelection(same, order), same, 'an unchanged selection keeps its identity so nothing re-renders');
});

// ---- Grid keyboard -------------------------------------------------------------------------------------------------------------------
test('the grid keyboard model maps keys to actions, clamps movement and ignores composition, Alt and the wrong modifiers', () => {
  const act = (key, extra = {}, state = { index: 3, count: 10, page: 4 }) => proxyGridKeyAction({ key, ...extra }, state);
  assert.deepEqual(act('ArrowDown'), { type: 'focus', index: 4, extend: false }); assert.deepEqual(act('ArrowUp'), { type: 'focus', index: 2, extend: false });
  assert.deepEqual(act('Home'), { type: 'focus', index: 0, extend: false }); assert.deepEqual(act('End'), { type: 'focus', index: 9, extend: false });
  assert.deepEqual(act('PageDown'), { type: 'focus', index: 7, extend: false }); assert.deepEqual(act('PageUp'), { type: 'focus', index: 0, extend: false }, 'PageUp stops at the first row');
  assert.deepEqual(act('ArrowDown', {}, { index: 9, count: 10 }), { type: 'focus', index: 9, extend: false }, 'no wrap at the end'); assert.deepEqual(act('ArrowUp', {}, { index: 0, count: 10 }), { type: 'focus', index: 0, extend: false });
  assert.deepEqual(act('ArrowDown', { shiftKey: true }), { type: 'focus', index: 4, extend: true }); assert.deepEqual(act('End', { shiftKey: true }), { type: 'focus', index: 9, extend: true });
  assert.deepEqual(act('ArrowDown', { shiftKey: true, ctrlKey: true }), { type: 'focus', index: 4, extend: false }, 'Ctrl moves without extending');
  assert.deepEqual(act(' '), { type: 'toggle' }); assert.deepEqual(act('Spacebar'), { type: 'toggle' }); assert.equal(act(' ', { shiftKey: true }), null);
  assert.deepEqual(act('Enter'), { type: 'open' }); assert.deepEqual(act('Delete'), { type: 'delete' }); assert.deepEqual(act('c'), { type: 'check' }); assert.deepEqual(act('C'), { type: 'check' }); assert.equal(act('c', { shiftKey: true }), null);
  assert.deepEqual(act('/'), { type: 'search' }); assert.deepEqual(act('Escape'), { type: 'escape' });
  assert.deepEqual(act('a', { ctrlKey: true }), { type: 'select-all' }); assert.deepEqual(act('A', { metaKey: true }), { type: 'select-all' }); assert.equal(act('a'), null, 'a plain a is not select all');
  assert.equal(act('c', { ctrlKey: true }), null, 'Ctrl+C stays the browser copy'); assert.equal(act('Enter', { metaKey: true }), null); assert.equal(act('Delete', { ctrlKey: true }), null);
  assert.equal(act('ArrowDown', { altKey: true }), null, 'Alt+Arrow is the browser history'); assert.equal(act('ArrowDown', { isComposing: true }), null); assert.equal(act('Enter', { isComposing: true }), null);
  assert.equal(act('Tab'), null); assert.equal(act('x'), null); assert.equal(proxyGridKeyAction(null), null); assert.equal(proxyGridKeyAction({ key: 'Enter' }, { count: -1 }), null);
  assert.equal(act('ArrowDown', {}, { index: 0, count: 0 }), null, 'an empty list has nowhere to move'); assert.equal(act('a', { ctrlKey: true }, { index: 0, count: 0 }), null);
});

// ---- Check queue ------------------------------------------------------------------------------------------------------------------------
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
test('the check queue runs in order, never exceeds its limit, and reports every result', async () => {
  for (const limit of [1, 2, 3]) {
    let running = 0, peak = 0; const started = [], results = [];
    const summary = await runProxyCheckQueue({ ids: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], limit, check: async id => { running++; peak = Math.max(peak, running); await tick(); await tick(); running--; return { id }; }, onStart: id => started.push(id), onResult: (id, result) => results.push([id, result.id]) });
    assert.equal(peak, limit, 'limit ' + limit); assert.deepEqual(started, ['a', 'b', 'c', 'd', 'e', 'f', 'g']); assert.equal(results.length, 7); assert.deepEqual(summary, { started: 7, finished: 7, total: 7, cancelled: false });
    assert.deepEqual(results.map(([id]) => id).sort(), ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  }
  const sequential = []; await runProxyCheckQueue({ ids: ['x', 'y', 'z'], limit: 1, check: async id => { sequential.push('start ' + id); await tick(); sequential.push('end ' + id); } });
  assert.deepEqual(sequential, ['start x', 'end x', 'start y', 'end y', 'start z', 'end z'], 'with one at a time, a check finishes before the next starts');
  assert.deepEqual(await runProxyCheckQueue({ ids: [], check: async () => { throw Error('never'); } }), { started: 0, finished: 0, total: 0, cancelled: false });
  let peak = 0, running = 0; await runProxyCheckQueue({ ids: Array.from({ length: 30 }, (_, index) => 'p' + index), limit: 1000, check: async () => { running++; peak = Math.max(peak, running); await tick(); running--; } }); assert.ok(peak <= 8, 'the limit is capped at 8: ' + peak);
  let one = 0; await runProxyCheckQueue({ ids: ['a', 'b'], limit: 0, check: async () => { one++; } }); assert.equal(one, 2, 'a nonsense limit still runs the queue, one at a time');
});

test('cancelling stops new checks while the running ones finish, and a throwing check is a result, not a crash', async () => {
  let stop = false; const started = [], finished = [];
  const summary = await runProxyCheckQueue({ ids: ['a', 'b', 'c', 'd', 'e'], limit: 2, stopped: () => stop, check: async id => { await tick(); if (id === 'a') stop = true; await tick(); finished.push(id); return id; }, onStart: id => started.push(id) });
  assert.deepEqual(started, ['a', 'b'], 'only the checks that were already started'); assert.deepEqual(finished.sort(), ['a', 'b'], 'and they ran to the end'); assert.deepEqual(summary, { started: 2, finished: 2, total: 5, cancelled: true });
  const before = await runProxyCheckQueue({ ids: ['a', 'b'], stopped: () => true, check: async () => { throw Error('must not start'); } }); assert.deepEqual(before, { started: 0, finished: 0, total: 2, cancelled: true });
  const seen = []; const crash = await runProxyCheckQueue({ ids: ['a', 'b', 'c'], limit: 1, check: async id => { if (id === 'b') throw Object.assign(Error('PRIVATE_TEXT'), { code: 'busy' }); return 'ok'; }, onResult: (id, result) => seen.push([id, result === 'ok' ? 'ok' : 'error' in result ? 'error' : '?']) });
  assert.deepEqual(seen, [['a', 'ok'], ['b', 'error'], ['c', 'ok']]); assert.equal(crash.finished, 3, 'the queue continued after the failed check');
  const sync = await runProxyCheckQueue({ ids: ['a'], check: () => { throw Error('sync'); } }); assert.equal(sync.finished, 1);
});

// ---- Domain chips ------------------------------------------------------------------------------------------------------------------------
test('a routing entry is an exact host or *.domain, normalized, and rejected with a reason when it cannot be kept', () => {
  assert.deepEqual(proxyDomainEntry('Example.COM'), { ok: true, value: 'example.com' }); assert.deepEqual(proxyDomainEntry(' *.Example.com '), { ok: true, value: '*.example.com' }); assert.deepEqual(proxyDomainEntry('203.0.113.7'), { ok: true, value: '203.0.113.7' }); assert.deepEqual(proxyDomainEntry('[2001:DB8::1]'), { ok: true, value: '2001:db8::1' });
  for (const text of ['', '   ', null, undefined]) assert.deepEqual(proxyDomainEntry(text), { ok: false, reason: 'empty' }, String(text));
  for (const text of ['has space.com', 'a/b', 'user@host', 'a?b', 'a#b', 'a%41.com', 'back\\slash', '*.', '*.localhost', '*.203.0.113.7', '*.2001:db8::1', '999.1.1.1', 'x'.repeat(254)]) assert.deepEqual(proxyDomainEntry(text), { ok: false, reason: 'invalid' }, text);
  assert.deepEqual(proxyDomainEntry('a.example', { list: ['a.example'] }), { ok: false, reason: 'duplicate', value: 'a.example' }); assert.deepEqual(proxyDomainEntry('A.example', { list: ['a.example'] }), { ok: false, reason: 'duplicate', value: 'a.example' });
  assert.deepEqual(proxyDomainEntry('a.example', { other: ['a.example'] }), { ok: false, reason: 'conflict', value: 'a.example' }, 'one name cannot be both proxied and direct');
  const full = Array.from({ length: PROXY_LIMITS.domains }, (_, index) => 'h' + index + '.example'); assert.deepEqual(proxyDomainEntry('new.example', { list: full }), { ok: false, reason: 'limit', value: 'new.example' });
  assert.deepEqual(proxyDomainTokens('a.example, b.example;c.example\n\td.example  '), ['a.example', 'b.example', 'c.example', 'd.example']); assert.deepEqual(proxyDomainTokens(''), []); assert.deepEqual(proxyDomainTokens(null), []);
  assert.equal(proxyDomainTokens('x.example '.repeat(PROXY_LIMITS.domains + 50)).length, PROXY_LIMITS.domains + 1, 'a huge paste is cut, not processed');
});

// ---- Per-field draft errors -----------------------------------------------------------------------------------------------------------
test('draft errors name only the failing fields and mirror what Save would refuse', () => {
  const direct = { type: 'socks5', name: 'Office', host: 'proxy.example.test', port: '1080' };
  assert.deepEqual(proxyDraftErrors(direct), {}); assert.deepEqual(proxyDraftErrors({ ...direct, type: 'https', port: '443' }), {});
  assert.deepEqual(proxyDraftErrors({ ...direct, name: '   ', host: '', port: '' }), { name: 'required', host: 'required', port: 'invalid' });
  assert.deepEqual(proxyDraftErrors({ ...direct, name: 'x'.repeat(PROXY_LIMITS.name + 1) }), { name: 'long' }); assert.deepEqual(proxyDraftErrors({ ...direct, name: 'x'.repeat(PROXY_LIMITS.name) }), {});
  for (const host of ['a b', 'a/b', 'user@host', 'a?b', 'a#b']) assert.deepEqual(proxyDraftErrors({ ...direct, host }), { host: 'invalid' }, host);
  for (const port of ['0', '65536', '-1', '1.5', '08a', '123456', ' 80', '1e3']) assert.deepEqual(proxyDraftErrors({ ...direct, port }), { port: 'invalid' }, port);
  for (const port of ['1', '80', '65535']) assert.deepEqual(proxyDraftErrors({ ...direct, port }), {}, port);
  assert.deepEqual(proxyDraftErrors({ type: 'vless', name: 'V', uri: '' }), { uri: 'required' }); assert.deepEqual(proxyDraftErrors({ type: 'vless', name: 'V', uri: '' , id: 'saved' }), {}, 'a saved profile keeps its stored link when the field is left empty');
  assert.deepEqual(proxyDraftErrors({ type: 'vless', name: 'V', uri: 'not a link' }), { uri: 'invalid' });
  assert.deepEqual(proxyDraftErrors({ type: 'openvpn', name: 'O', config: '' }), { config: 'required' }); assert.deepEqual(proxyDraftErrors({ type: 'openvpn', name: 'O', config: 'x'.repeat(PROXY_LIMITS.openVpnBytes + 1) }), { config: 'long' }); assert.deepEqual(proxyDraftErrors({ type: 'openvpn', name: 'O', config: 'client' }), {});
  assert.deepEqual(proxyDraftErrors({ type: 'ftp', name: '' }), {}); assert.deepEqual(proxyDraftErrors(null), {}); assert.deepEqual(proxyDraftErrors({ type: 'socks5' }), { name: 'required', host: 'required', port: 'invalid' });
  assert.doesNotMatch(JSON.stringify(proxyDraftErrors({ ...direct, host: 'LOGIN_CANARY@x', password: 'PASSWORD_CANARY' })), /CANARY/, 'an error is a reason code, never the typed text');
});

// ---- Toolbars ---------------------------------------------------------------------------------------------------------------------------
test('a toolbar moves the focus with the arrows (mirrored right to left, wrapping), Home and End, and leaves every other key to the page', () => {
  const go = (key, index, count, extra = {}, rtl = false) => proxyRovingTarget({ key, ...extra }, { index, count, rtl });
  assert.deepEqual([go('ArrowRight', 0, 4), go('ArrowRight', 2, 4), go('ArrowRight', 3, 4)], [1, 3, 0], 'Right goes forward and wraps');
  assert.deepEqual([go('ArrowLeft', 3, 4), go('ArrowLeft', 1, 4), go('ArrowLeft', 0, 4)], [2, 0, 3], 'Left goes back and wraps');
  assert.deepEqual([go('Home', 2, 4), go('End', 1, 4), go('Home', 0, 1), go('End', 0, 1)], [0, 3, 0, 0]);
  assert.deepEqual([go('ArrowRight', 0, 4, {}, true), go('ArrowLeft', 0, 4, {}, true), go('ArrowRight', 3, 4, {}, true), go('ArrowLeft', 3, 4, {}, true)], [3, 1, 2, 0], 'in a right-to-left language Left is forward and Right is back');
  assert.deepEqual([go('Home', 2, 4, {}, true), go('End', 1, 4, {}, true)], [0, 3], 'Home and End do not mirror');
  assert.equal(go('ArrowRight', 0, 4, {}, 'true'), 1, 'only the boolean true mirrors');
  for (const extra of [{ shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }]) assert.equal(go('ArrowRight', 0, 4, extra), null, JSON.stringify(extra));
  for (const key of ['ArrowDown', 'ArrowUp', 'Tab', ' ', 'Enter', 'Escape', 'a', 'PageDown']) assert.equal(go(key, 1, 4), null, key + ' is not the toolbar\'s');
  assert.equal(go('ArrowRight', -1, 4), null, 'a target that is not one of the items'); assert.equal(go('ArrowRight', 4, 4), null); assert.equal(go('ArrowRight', 0, 0), null, 'no items'); assert.equal(go('ArrowRight', 0, NaN), null); assert.equal(proxyRovingTarget(null), null); assert.equal(proxyRovingTarget({ key: 'Home' }), null, 'no state, no move');
});
