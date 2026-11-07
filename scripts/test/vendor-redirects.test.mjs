import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createVendorRedirectTracker, VENDOR_REDIRECT_LIMITS } from '../../apps/production-extension/vendor-redirects.js';

const canonical = 'https://challenges.cloudflare.com/turnstile/v0/api.js?secret=QUERY_CANARY';
const target = 'https://challenges.cloudflare.com/turnstile/v0/version/api.js?secret=REDIRECT_CANARY';
const ctx = { allowed: true, scopeKey: '3:all-sites:pro-1' };
const detail = (overrides = {}) => ({ requestId: '123.4', tabId: 7, frameId: 0, documentId: 'native-doc',
  documentLifecycle: 'active', type: 'script', timeStamp: 1700000000000, url: canonical, ...overrides });
function fixture(options = {}) {
  let at = 1700000000000;
  const calls = [], limits = [];
  const tracker = createVendorRedirectTracker({ match(url, type, time) {
    calls.push({ url, type, time });
    return typeof url === 'string' && new URL(url).pathname === '/turnstile/v0/api.js' ? [{ ruleId: 'CF_TURNSTILE_SCRIPT' }] : [];
  }, now: () => at, onLimit: (reason, ids) => limits.push({ reason, ...ids }), ...options });
  return { tracker, calls, limits, tick: amount => { at += amount; } };
}
function redirect(tracker, overrides = {}, context = ctx) {
  tracker.observe(detail(), 'before', ctx);
  tracker.observe(detail({ statusCode: 302, redirectUrl: target, timeStamp: 1700000000001, ...overrides }), 'redirect', context);
}
function complete(tracker, overrides = {}, context = ctx) {
  tracker.observe(detail({ url: target, timeStamp: 1700000000002 }), 'before', ctx);
  return tracker.observe(detail({ url: target, statusCode: 200, timeStamp: 1700000000003, ...overrides }), 'completed', context);
}

test('canonical exact resource carries only its rule ID through a verified same-origin browser redirect', () => {
  const f = fixture();
  assert.deepEqual(f.tracker.observe(detail(), 'before', ctx), []);
  assert.deepEqual(f.tracker.observe(detail({ statusCode: 302, redirectUrl: target, timeStamp: 1700000000001 }), 'redirect', ctx), []);
  assert.deepEqual(complete(f.tracker), ['CF_TURNSTILE_SCRIPT']);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.tracker.stats(), { entries: 1, active: 0, limited: false, capacity: 0, hops: 0, ttl: 0 });
  assert.deepEqual(complete(f.tracker), []);
});

test('no missing-before, exact final-only or noncanonical URL becomes redirect provenance', () => {
  for (const input of [detail({ url: target }), detail({ url: 'https://other.example/sdk.js' })]) {
    const f = fixture(); f.tracker.observe(input, 'before', ctx);
    assert.deepEqual(f.tracker.observe({ ...input, statusCode: 200 }, 'completed', ctx), []);
  }
  const f = fixture();
  assert.deepEqual(f.tracker.observe(detail({ statusCode: 302, redirectUrl: target }), 'redirect', ctx), []);
  assert.deepEqual(complete(f.tracker), []);
  f.tracker.observe(detail(), 'before', ctx);
  assert.deepEqual(f.tracker.observe(detail({ statusCode: 200 }), 'completed', ctx), []);
});

test('final success status is limited to 2xx or 304 and completion consumes the chain', () => {
  for (const statusCode of [200, 204, 299, 304, 0, 199, 300, 302, 307, 400, 404, 500, 200.5, undefined, '200']) {
    const f = fixture(); redirect(f.tracker);
    assert.deepEqual(complete(f.tracker, { statusCode }), [200, 204, 299, 304].includes(statusCode) ? ['CF_TURNSTILE_SCRIPT'] : []);
    assert.deepEqual(complete(f.tracker), []);
  }
});

test('cross-origin, scheme, credentials and malformed redirect targets invalidate the entire chain', () => {
  for (const redirectUrl of ['https://other.example/api.js', 'http://challenges.cloudflare.com/api.js',
    'https://challenges.cloudflare.com:444/api.js', 'data:text/javascript,x', 'about:blank',
    'https://user:secret@challenges.cloudflare.com/api.js', 'not a URL', undefined]) {
    const f = fixture(); redirect(f.tracker, { redirectUrl });
    assert.deepEqual(complete(f.tracker), []);
  }
  const f = fixture(); redirect(f.tracker, { redirectUrl: 'https://CHALLENGES.CLOUDFLARE.COM:443/api.js' });
  assert.deepEqual(complete(f.tracker), ['CF_TURNSTILE_SCRIPT']);
});

test('native tab/frame/document/type identity and trusted scope must remain exact at every phase', () => {
  for (const overrides of [{ tabId: 8 }, { frameId: 1 }, { documentId: 'other' }, { documentId: undefined },
    { documentLifecycle: 'cached' }, { type: 'image' }, { timeStamp: 1699999999999 }]) {
    const f = fixture(); redirect(f.tracker, overrides);
    assert.deepEqual(complete(f.tracker), []);
  }
  for (const context of [{ ...ctx, allowed: false }, { ...ctx, scopeKey: '4:all-sites:pro-1' }, { ...ctx, scopeKey: null }]) {
    const f = fixture(); redirect(f.tracker, {}, context);
    assert.deepEqual(complete(f.tracker), []);
  }
  for (const overrides of [{ tabId: -1 }, { frameId: -1 }, { documentId: undefined }, { documentId: 'unsafe:doc' },
    { requestId: '' }, { type: '' }, { timeStamp: NaN }, { timeStamp: -1 }]) {
    const f = fixture(); f.tracker.observe(detail(overrides), 'before', ctx);
    assert.equal(f.tracker.stats().entries, 0);
  }
});

test('final origin, identity, scope, lifecycle, timestamp and missing redirect-followup are checked again', () => {
  for (const overrides of [{ url: 'https://other.example/sdk.js' }, { url: 'http://challenges.cloudflare.com/sdk.js' },
    { tabId: 8 }, { documentId: 'other' }, { frameId: 1 }, { type: 'image' },
    { timeStamp: 1700000000001 }, { documentLifecycle: 'prerender' }]) {
    const f = fixture(); redirect(f.tracker);
    assert.deepEqual(complete(f.tracker, overrides), []);
  }
  const f = fixture(); redirect(f.tracker);
  assert.deepEqual(f.tracker.observe(detail({ url: target, statusCode: 200, timeStamp: 1700000000002 }), 'completed', ctx), []);
  const denied = fixture(); redirect(denied.tracker);
  assert.deepEqual(complete(denied.tracker, {}, { ...ctx, allowed: false }), []);
});

test('errors, duplicate-before, reused IDs and unexpected ordering never resurrect a chain', () => {
  for (const phase of ['error', 'before', 'unknown']) {
    const f = fixture(); f.tracker.observe(detail(), 'before', ctx);
    f.tracker.observe(detail(), phase, ctx);
    redirect(f.tracker);
    assert.deepEqual(complete(f.tracker), []);
  }
  const f = fixture(); redirect(f.tracker);
  f.tracker.observe(detail({ url: target }), 'error', ctx);
  redirect(f.tracker);
  assert.deepEqual(complete(f.tracker), []);
});

test('redirect status and hop count are bounded with a native-identity-only limit signal', () => {
  for (const statusCode of [200, 304, 300, 305, 306, 400, undefined]) {
    const f = fixture(); redirect(f.tracker, { statusCode }); assert.deepEqual(complete(f.tracker), []);
  }
  const f = fixture({ maxHops: 2 });
  f.tracker.observe(detail(), 'before', ctx);
  for (let index = 0; index < 3; ++index) {
    f.tracker.observe(detail({ statusCode: 307, redirectUrl: target, timeStamp: 1700000000001 + index * 2 }), 'redirect', ctx);
    f.tracker.observe(detail({ url: target, timeStamp: 1700000000002 + index * 2 }), 'before', ctx);
  }
  assert.deepEqual(complete(f.tracker), []);
  assert.deepEqual(f.limits, [{ reason: 'hops', tabId: 7, frameId: 0, documentId: 'native-doc' }]);
  assert.equal(f.tracker.stats().hops, 1);
});

test('local and native timestamps independently expire chains; backwards local clocks clear state', () => {
  const f = fixture({ ttlMs: 10 }); redirect(f.tracker); f.tick(10);
  assert.deepEqual(complete(f.tracker), []);
  assert.equal(f.tracker.stats().ttl, 1);
  const native = fixture({ ttlMs: 10 }); redirect(native.tracker);
  assert.deepEqual(complete(native.tracker, { timeStamp: 1700000000010 }), []);
  const backwards = fixture(); redirect(backwards.tracker); backwards.tick(-1);
  assert.deepEqual(complete(backwards.tracker), []);
  assert.equal(backwards.tracker.stats().active, 0);
  const replay = fixture({ ttlMs: 10 }); redirect(replay.tracker); replay.tick(10);
  replay.tracker.observe(detail(), 'before', ctx);
  assert.equal(replay.tracker.stats().entries, 0, 'An expired native before cannot reseed an old request ID');
  const future = fixture(); future.tracker.observe(detail({ timeStamp: 1700000001001 }), 'before', ctx);
  assert.equal(future.tracker.stats().entries, 0);
});

test('capacity counts tombstones, rejects new chains without eviction and recovers only after expiry', () => {
  const f = fixture({ maxEntries: 1, ttlMs: 10 }); redirect(f.tracker); complete(f.tracker);
  const next = detail({ requestId: 'next' });
  f.tracker.observe(next, 'before', ctx);
  assert.deepEqual(f.tracker.stats(), { entries: 1, active: 0, limited: true, capacity: 1, hops: 0, ttl: 0 });
  assert.deepEqual(f.limits, [{ reason: 'capacity', tabId: 7, frameId: 0, documentId: 'native-doc' }]);
  f.tick(10); f.tracker.observe({ ...next, timeStamp: 1700000000010 }, 'before', ctx);
  assert.equal(f.tracker.stats().active, 1);
});

test('clearTab and scope clear remove only their native-bound entries; full clear discards all provenance', () => {
  const f = fixture();
  f.tracker.observe(detail(), 'before', ctx);
  f.tracker.observe(detail({ requestId: 'other', tabId: 8 }), 'before', { ...ctx, scopeKey: 'other' });
  f.tracker.clearTab(7); assert.equal(f.tracker.stats().entries, 1);
  f.tracker.clear('other'); assert.equal(f.tracker.stats().entries, 0);
  redirect(f.tracker); f.tracker.clear(); assert.deepEqual(complete(f.tracker), []);
});

test('observer errors, invalid matches and URL objects cannot coerce or retain sensitive inputs', () => {
  for (const match of [() => { throw Error('MATCH_CANARY'); }, () => ['invalid id'], () => Array(33).fill('valid'), () => null]) {
    const f = fixture({ match }); redirect(f.tracker); assert.deepEqual(complete(f.tracker), []);
  }
  let coerced = 0, forbiddenReads = 0;
  const f = fixture({ onLimit() { throw Error('LIMIT_CANARY'); }, maxEntries: 1 });
  const input = detail();
  for (const key of ['requestBody', 'requestHeaders', 'responseHeaders']) Object.defineProperty(input, key, { get() { ++forbiddenReads; throw Error(key); } });
  f.tracker.observe(input, 'before', ctx);
  f.tracker.observe(detail({ requestId: 'other' }), 'before', ctx);
  f.tracker.observe(detail({ requestId: 'object', url: { toString() { ++coerced; return canonical; } } }), 'before', ctx);
  assert.equal(coerced, 0); assert.equal(forbiddenReads, 0);
  assert.doesNotMatch(JSON.stringify(f.tracker.stats()), /CANARY|https|url|query|requestBody|Headers/);
  assert.deepEqual(VENDOR_REDIRECT_LIMITS, { maxEntries: 128, maxHops: 5, ttlMs: 30000 });
});

test('the shipped exact Turnstile rule gains successful redirect provenance without broadening its matcher', () => {
  const source = readFileSync(new URL('../../apps/production-extension/background.js', import.meta.url), 'utf8');
  const start = source.indexOf('// packages/catalog/src/vendors.runtime.json');
  const end = source.indexOf('// packages/catalog/src/vendors.rtc.runtime.json', start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({ URL, Date });
  vm.runInContext(source.slice(start, end), context);
  const matcher = context.createVendorResourceMatcher(context.vendors_runtime_default.rules);
  const at = Date.parse('2026-10-20T00:00:00Z');
  const direct = matcher.matchVendorResource(canonical, 'script', at);
  assert.equal(direct.length, 1); assert.equal(direct[0].vendorId, 'cloudflare-turnstile');
  assert.equal(matcher.matchVendorResource(target, 'script', at).length, 0);
  const tracker = createVendorRedirectTracker({ match: matcher.matchVendorResource, now: () => at });
  tracker.observe(detail({ timeStamp: at }), 'before', ctx);
  tracker.observe(detail({ statusCode: 302, redirectUrl: target, timeStamp: at + 1 }), 'redirect', ctx);
  assert.equal(tracker.stats().active, 1, 'A 302 alone never establishes a successful resource');
  tracker.observe(detail({ url: target, timeStamp: at + 2 }), 'before', ctx);
  const ids = tracker.observe(detail({ url: target, statusCode: 200, timeStamp: at + 3 }), 'completed', ctx);
  assert.deepEqual(ids, [direct[0].ruleId]);
  assert.equal(matcher.lookupVendorResourceRule(ids[0], at).vendorId, 'cloudflare-turnstile');
  assert.equal(matcher.matchVendorResource(target, 'script', at).length, 0);
});

test('clearDocument discards only the exact native document among same-tab frames and navigations', () => {
  const f = fixture();
  const requests = [
    detail({ requestId: 'cleared' }),
    detail({ requestId: 'same-tab-other-frame', frameId: 1 }),
    detail({ requestId: 'same-tab-other-document', documentId: 'other-native-doc' }),
    detail({ requestId: 'other-tab', tabId: 8 }),
  ];
  for (const request of requests) f.tracker.observe(request, 'before', ctx);
  assert.equal(f.tracker.stats().active, 4);
  f.tracker.clearDocument('7:0:native-doc');
  assert.equal(f.tracker.stats().active, 3);
  for (const [index, request] of requests.entries()) {
    f.tracker.observe({ ...request, statusCode: 302, redirectUrl: target, timeStamp: 1700000000001 }, 'redirect', ctx);
    f.tracker.observe({ ...request, url: target, timeStamp: 1700000000002 }, 'before', ctx);
    const ids = f.tracker.observe({ ...request, url: target, statusCode: 200, timeStamp: 1700000000003 }, 'completed', ctx);
    assert.deepEqual(ids, index === 0 ? [] : ['CF_TURNSTILE_SCRIPT']);
  }
  assert.equal(f.tracker.stats().active, 0);
});
