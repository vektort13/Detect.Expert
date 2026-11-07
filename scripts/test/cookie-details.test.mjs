// ADR-069: the read-only facts and the early problem checks of the cookie editor are pure functions of the form state.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHROME_MAX_LIFETIME_DAYS, cookieByteSize, cookiePrefixProblem, cookieScope, editorProblems, isDefaultStore, sameCookieIdentity } from '../../apps/production-extension/cookie-details.js';
import { validateCookieRecord } from '../../apps/production-extension/cookie-transfer-core.js';

const form = (changes = {}) => ({ name: 'id', value: 'v', domain: 'example.test', path: '/', hostOnly: true, secure: true, httpOnly: false, sameSite: 'lax', session: true, expirationDate: '', storeId: '0', partitioned: false, partitionTopLevelSite: '', partitionAncestor: 'unspecified', firstPartyDomain: '', ...changes });

test('size is name plus value in UTF-8 bytes, the quantity the browser limit counts', () => {
  assert.equal(cookieByteSize('', ''), 0); assert.equal(cookieByteSize('a', 'b'), 2); assert.equal(cookieByteSize('é', '€'), 5, 'é is 2 bytes, € is 3'); assert.equal(cookieByteSize('x', '😀'), 5, 'an astral character is 4 bytes');
  assert.equal(cookieByteSize('Ключ', 'значение'), 24, 'Cyrillic letters are 2 bytes each'); assert.equal(cookieByteSize(undefined, null), 0); assert.equal(cookieByteSize('n'.repeat(100), 'v'.repeat(3996)), 4096);
});

test('scope names the host (a domain cookie reaches its subdomains), the path and whether HTTPS is required', () => {
  assert.deepEqual(cookieScope(form({ domain: '.Example.Test', hostOnly: false })), { host: 'Example.Test', hostOnly: false, path: '/', secure: true });
  assert.deepEqual(cookieScope(form({ domain: 'example.test', path: '/shop/', secure: false })), { host: 'example.test', hostOnly: true, path: '/shop/', secure: false });
  assert.deepEqual(cookieScope(form({ domain: '  .a.b  ' })), { host: 'a.b', hostOnly: true, path: '/', secure: true }); assert.equal(cookieScope(form({ path: '   ' })).path, null);
  assert.equal(cookieScope(form({ domain: '' })), null); assert.equal(cookieScope(form({ domain: '.' })), null); assert.equal(cookieScope(undefined), null);
});

test('prefix rules match the record validator for every prefix and every flag', () => {
  const rejected = values => { try { validateCookieRecord({ name: values.name, value: 'v', domain: values.hostOnly ? 'example.test' : '.example.test', path: values.path, hostOnly: values.hostOnly, secure: values.secure, httpOnly: values.httpOnly, sameSite: 'lax', session: true, expirationDate: null, storeId: '0', partitionKey: null, firstPartyDomain: null }); return false; } catch (error) { return error.code === 'invalid-prefix'; } };
  for (const name of ['id', '__Secure-id', '__Host-id', '__Http-id', '__Host-Http-id', '__secure-id', 'x__Host-id']) for (const secure of [true, false]) for (const hostOnly of [true, false]) for (const httpOnly of [true, false]) for (const path of ['/', '/a']) {
    const values = form({ name, secure, hostOnly, httpOnly, path });
    assert.equal(cookiePrefixProblem(values), rejected(values), JSON.stringify({ name, secure, hostOnly, httpOnly, path }));
  }
  assert.equal(cookiePrefixProblem(undefined), false);
});

test('problems appear in a fixed order and only for what the browser really refuses', () => {
  assert.deepEqual(editorProblems(form()), []);
  assert.deepEqual(editorProblems(form({ value: 'x'.repeat(4096) }), { browser: 'chrome' }), ['size'], 'name + value = 4097 bytes'); assert.deepEqual(editorProblems(form({ value: 'x'.repeat(4094) }), { browser: 'chrome' }), [], '4096 bytes exactly');
  assert.deepEqual(editorProblems(form({ value: 'x'.repeat(9999) }), { browser: 'firefox' }), [], 'no Chrome limit for Firefox'); assert.deepEqual(editorProblems(form({ value: 'x'.repeat(9999) })), [], 'nor for an unknown browser');
  assert.deepEqual(editorProblems(form({ value: 'x'.repeat(10) }), { browser: 'chrome', pairLimit: 5 }), ['size'], 'the limit is a parameter');
  assert.deepEqual(editorProblems(form({ sameSite: 'no_restriction', secure: false })), ['samesite-none']); assert.deepEqual(editorProblems(form({ sameSite: 'no_restriction', secure: true })), []);
  assert.deepEqual(editorProblems(form({ partitioned: true, secure: false })), ['partition-secure']); assert.deepEqual(editorProblems(form({ partitioned: true, secure: true })), []);
  assert.deepEqual(editorProblems(form({ name: '__Host-id', secure: false, sameSite: 'no_restriction', partitioned: true, value: 'x'.repeat(5000) }), { browser: 'chrome' }), ['size', 'samesite-none', 'partition-secure', 'prefix'], 'display order');
});

test('an expiry in the past is flagged only for a persistent cookie with a readable expiry', () => {
  const now = Date.UTC(2026, 10, 7) , past = { session: false, expirationDate: String(now / 1000 - 1) }, future = { session: false, expirationDate: String(now / 1000 + 1) };
  assert.deepEqual(editorProblems(form(past), { now }), ['expired']); assert.deepEqual(editorProblems(form({ session: false, expirationDate: String(now / 1000) }), { now }), ['expired'], 'now is already too late');
  assert.deepEqual(editorProblems(form(future), { now }), []); assert.deepEqual(editorProblems(form(past)), [], 'without a clock nothing is judged');
  for (const bad of ['', 'abc', '0', '-5', '1e3', '8640000000001']) assert.deepEqual(editorProblems(form({ session: false, expirationDate: bad }), { now }), [], JSON.stringify(bad) + ' is the converter message, not this one');
  assert.deepEqual(editorProblems(form({ session: true, expirationDate: String(now / 1000 - 5) }), { now }), [], 'a session cookie has no expiry');
});

test('two editor states are the same cookie when store, host, host-only, path, name, partition and first-party domain agree', () => {
  const base = form({ domain: '.Example.Test', hostOnly: false });
  assert.equal(sameCookieIdentity(base, { ...base, value: 'other', secure: false, httpOnly: true, sameSite: 'strict', session: false, expirationDate: '5' }), true, 'value and attributes are not identity');
  assert.equal(sameCookieIdentity(base, { ...base, domain: 'example.test' }), true, 'the leading dot and the case of a host do not make another host'); assert.equal(sameCookieIdentity(base, { ...base, domain: 'example.test', hostOnly: true }), false, 'host-only is identity');
  for (const change of [{ name: 'other' }, { path: '/a' }, { storeId: '1' }, { domain: 'other.test' }, { firstPartyDomain: 'fp.test' }]) assert.equal(sameCookieIdentity(base, { ...base, ...change }), false, JSON.stringify(change));
  const partitioned = { ...base, partitioned: true, partitionTopLevelSite: 'https://top.test/', partitionAncestor: 'false' };
  assert.equal(sameCookieIdentity(partitioned, { ...partitioned, partitionTopLevelSite: 'https://top.test' }), true, 'a site is compared as its origin'); assert.equal(sameCookieIdentity(partitioned, base), false, 'a partitioned cookie is another cookie');
  assert.equal(sameCookieIdentity(partitioned, { ...partitioned, partitionAncestor: 'true' }), false); assert.equal(sameCookieIdentity(partitioned, { ...partitioned, partitionTopLevelSite: 'https://other.test' }), false);
  assert.equal(sameCookieIdentity(base, { ...base, partitionTopLevelSite: 'https://ignored.test', partitionAncestor: 'true' }), true, 'partition fields count only while partitioned');
});

test('the Chrome lifetime cap (400 days, observed natively) is a note for Chrome only, beyond 400 days from now, and never replaces a refusal', () => {
  const now = Date.UTC(2026, 10, 7), at = days => ({ session: false, expirationDate: String(now / 1000 + days * 86400) });
  assert.equal(CHROME_MAX_LIFETIME_DAYS, 400);
  assert.deepEqual(editorProblems(form(at(400)), { browser: 'chrome', now }), [], '400 days exactly is inside the cap'); assert.deepEqual(editorProblems(form(at(400.001)), { browser: 'chrome', now }), ['reach']);
  assert.deepEqual(editorProblems(form(at(900)), { browser: 'firefox', now }), [], 'no cap is claimed for Firefox'); assert.deepEqual(editorProblems(form(at(900)), { now }), [], 'nor for an unknown browser'); assert.deepEqual(editorProblems(form(at(900)), { browser: 'chrome' }), [], 'without a clock nothing is judged');
  assert.deepEqual(editorProblems(form({ session: true, expirationDate: String(now / 1000 + 900 * 86400) }), { browser: 'chrome', now }), [], 'a session cookie has no lifetime');
  assert.deepEqual(editorProblems(form(at(-1)), { browser: 'chrome', now }), ['expired']);
});

test('the default store is Chrome 0 and Firefox firefox-default', () => {
  assert.equal(isDefaultStore('0', 'chrome'), true); assert.equal(isDefaultStore('1', 'chrome'), false); assert.equal(isDefaultStore('firefox-default', 'firefox'), true); assert.equal(isDefaultStore('firefox-container-1', 'firefox'), false);
  assert.equal(isDefaultStore('0', 'firefox'), false); assert.equal(isDefaultStore('firefox-default', 'chrome'), false); assert.equal(isDefaultStore('0', 'unknown'), false);
});
