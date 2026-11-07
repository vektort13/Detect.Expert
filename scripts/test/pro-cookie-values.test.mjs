import { normalizeProCookieMetadata } from '../../packages/contracts/src/inspection.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { ProCookieValuesObserver, parseOutgoingCookies } from '../../apps/production-extension/pro-cookie-values.js';
import { PRO_COOKIE_VALUE_LIMITS as LIMITS, proCookieRowBytes, readProCookieValues } from '../../packages/contracts/src/pro-cookie-values.mjs';
import { readAdvancedPageFields } from '../../packages/contracts/src/advanced-inspection.mjs';

function fixture() {
  let now = 1800000001000, active = true, allowBudget = true;
  const limits = [], sizes = new Map();
  const page = { id: 'page-1', tabId: 9, documentKey: '9:0:main', url: 'https://example.com/', title: '', startedAt: now - 1000, endedAt: null, reports: [], resources: [] };
  const session = { schemaVersion: 1, id: 'recording-1', domain: 'example.com', siteKey: 'example.com', startTabId: 9, status: 'recording', startedAt: now - 1000, deadlineAt: now - 1000 + 600000, stoppedAt: null, stopReason: null, pages: [page], limitations: [], dropped: { pages: 0, resources: 0, documents: 0, events: 0 } };
  const pro = { session, hydrated: true, trackedTabs: new Set([9]), requests: new Map(), checkDeadline: () => active,
    pageFor: tab => tab === 9 ? page : null, belongsToPage: key => key === page.documentKey, mark() {},
    size: (key, bytes) => { sizes.set(key, bytes); return allowBudget; }, limit: code => limits.push(code), sameSite: target => target.domain === 'example.com' };
  const runtime = { api: {}, pro, isReady: true, now: () => now,
    scope: { hasDataConsent: true, accessReady: true, accessGeneration: 1, isHostGrantedSync: () => true },
    canObserveNetworkDocument: key => key === page.documentKey, getProjection: () => ({ documentKey: page.documentKey }) };
  const observer = new ProCookieValuesObserver(runtime); observer.setSupported(true); observer.beginPage(page);
  const observe = (value, changes = {}) => observer.observe({ tabId: 9, frameId: 0, documentId: 'main', type: 'image', timeStamp: now,
    url: 'https://pixel.example.net/pixel', requestHeaders: [{ name: 'Cookie', value }], ...changes });
  return { observer, page, pro, runtime, session, limits, sizes, observe, tick: ms => { now += ms; }, stop: () => { active = false; }, denyBudget: () => { allowBudget = false; } };
}

test('outgoing parser applies independent header, aggregate and pair bounds', () => {
  assert.equal(parseOutgoingCookies(Array.from({ length: 129 }, (_, index) => ({ name: 'Cookie', value: `id${index}=v` }))).rows.length, 128);
  const tooMany = parseOutgoingCookies([{ name: 'Cookie', value: Array.from({ length: 513 }, (_, i) => `id${i}=v`).join(';') }]);
  assert.equal(tooMany.rows.length, 512); assert.equal(tooMany.truncated, true);
  const headers = Array.from({ length: 5 }, (_, i) => ({ name: 'Cookie', value: 'id' + i + '=' + 'x'.repeat(16380) }));
  const aggregate = parseOutgoingCookies(headers); assert.equal(aggregate.rows.length, 4); assert.equal(aggregate.truncated, true);
});

test('outgoing values preserve encoding, distinct variants, source hosts and event times', () => {
  const f = fixture();
  f.observe('id=first; id=second; escaped=%2F%3B; empty='); f.tick(25); f.observe('id=first');
  f.observe('id=first', { url: 'https://other.example.net/' });
  const rows = f.page.cookieValues.rows; assert.equal(rows.length, 5);
  const first = rows.find(row => row.name === 'id' && row.value === 'first' && row.destinationHost === 'pixel.example.net');
  assert.equal(first.count, 2); assert.equal(first.lastSeenAt - first.firstSeenAt, 25);
  assert.equal(rows.find(row => row.name === 'escaped').value, '%2F%3B');
  assert.equal(rows.find(row => row.name === 'empty').value, ''); assert.ok(readProCookieValues(f.page.cookieValues));
});

test('page row capacity preserves admitted rows and records the loss', () => {
  const f = fixture(); f.observe(Array.from({ length: 300 }, (_, i) => `id${i}=value`).join('; '));
  assert.equal(f.page.cookieValues.rows.length, LIMITS.rows); assert.equal(f.page.cookieValues.truncated, true);
  assert.ok(f.limits.includes('event-limit')); assert.ok(readProCookieValues(f.page.cookieValues));
  f.observe('id0=value'); assert.equal(f.page.cookieValues.rows[0].count, 2);
});

test('large values obey the page byte bound while retaining complete admitted strings', () => {
  const f = fixture(), value = 'x'.repeat(LIMITS.valueChars);
  for (let index = 0; index < 20; ++index) f.observe(`id${index}=${value}`);
  const snapshot = f.page.cookieValues;
  assert.equal(snapshot.truncated, true); assert.ok(snapshot.rows.length > 0 && snapshot.rows.length < 20);
  assert.ok(snapshot.rows.every(row => row.value === value));
  assert.ok(snapshot.rows.reduce((total, row) => total + proCookieRowBytes(row), 512) <= LIMITS.bytes);
  assert.ok(readProCookieValues(snapshot));
  assert.equal(readProCookieValues({ ...snapshot, rows: Array.from({ length: 20 }, (_, i) => ({ ...snapshot.rows[0], name: 'huge' + i })) }), null);
});

test('global Pro budget failure never commits an unaccounted Cookie value', () => {
  const f = fixture(); f.observe('id=first'); const before = JSON.stringify(f.page.cookieValues);
  f.denyBudget(); f.observe('id=second'); assert.equal(JSON.stringify(f.page.cookieValues), before);
});

test('Cookie event rate is bounded and resumes in the following window', () => {
  const f = fixture(); for (let i = 0; i < 220; ++i) f.observe('id=first');
  assert.equal(f.page.cookieValues.rows[0].count, 200); assert.equal(f.page.cookieValues.truncated, true);
  f.tick(1001); f.observe('id=first'); assert.equal(f.page.cookieValues.rows[0].count, 201);
});

test('recording stop preserves retained data and rejects subsequent traffic', () => {
  const f = fixture(); f.observe('id=first'); const before = JSON.stringify(f.page.cookieValues);
  f.stop(); f.observer.stop(); f.observe('id=later'); assert.equal(JSON.stringify(f.page.cookieValues), before);
  assert.equal(f.sizes.get('cookieValues:pending'), 0);
});

test('canonical Cookie projection rejects duplicates, sparse arrays, unsupported data and foreign tabs', () => {
  const f = fixture(); f.observe('id=first'); const snapshot = f.page.cookieValues, row = snapshot.rows[0];
  for (const changed of [ { ...snapshot, rows: [row, { ...row }] }, { ...snapshot, rows: [, row] },
    { ...snapshot, supported: false }, { ...snapshot, rows: [{ ...row, documentKey: '8:0:foreign' }] },
    { ...snapshot, rows: [{ ...row, lastSeenAt: row.firstSeenAt - 1 }] } ]) assert.equal(readProCookieValues(changed), null);
  const stable = readProCookieValues(snapshot); snapshot.rows[0].value = 'changed'; assert.equal(stable.rows[0].value, 'first');
});

test('canonical Pro timing admits pre-commit navigation only inside the recorded session', () => {
  const f = fixture(); f.observe('id=first'); f.page.startedAt += 1500;
  assert.equal(readAdvancedPageFields(f.page, f.session), true);
  assert.equal(readAdvancedPageFields(f.page), false);
  f.page.cookieValues.rows[0].firstSeenAt = f.session.startedAt - 1;
  assert.equal(readAdvancedPageFields(f.page, f.session), false);
  f.page.cookieValues.rows[0].firstSeenAt = f.session.startedAt;
  f.page.cookieValues.rows[0].lastSeenAt = f.session.deadlineAt + 1;
  assert.equal(readAdvancedPageFields(f.page, f.session), false);
});

test('actual production Pro wire validator admits Cookie values and excludes unrelated added fields', () => {
  const source = readFileSync(new URL('../../apps/production-extension/background.js', import.meta.url), 'utf8');
  const code = source.slice(0, source.indexOf('// packages/attribution/src/psl-index.json')).replace(/^import[^\n]*\n/gm, '');
  const context = vm.createContext({ atob, btoa, TextEncoder, URL, normalizeProCookieMetadata, readAdvancedPageFields }); vm.runInContext(code, context);
  const f = fixture(); f.observe('id=first'); f.page.startedAt += 1500;
  const validate = value => { context.serialized = JSON.stringify(value); return vm.runInContext('validateProSession(JSON.parse(serialized)).ok', context); };
  assert.equal(validate(f.session), true);
  f.page.cookieValues.rows[0].authorization = 'forbidden'; assert.equal(validate(f.session), false);
});
