import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import {
  CookieTransferError, COOKIE_TRANSFER_LIMITS, parseCookieJson,
  cookieIdentity, cookieSignature, normalizeNativeCookie, validateCookieRecord,
  parseCookieImport, exportCookieRecords, cookieSetDetails,
} from '../../apps/production-extension/cookie-transfer-core.js';

const cookie = patch => ({ name: 'session', value: 'fixture-value', domain: 'example.com', path: '/', hostOnly: true, secure: true, httpOnly: true, sameSite: 'lax', session: true, expirationDate: null, storeId: '0', partitionKey: null, firstPartyDomain: null, ...patch });
const doc = records => ({ format: 'detect.expert.cookies', formatVersion: 1, source: { browser: 'chrome' }, stores: [{ id: '0' }], cookies: records });
const error = (fn, code) => assert.throws(fn, result => result instanceof CookieTransferError && result.code === code && result.message === code);

test('cookie transfer: canonical JSON round trips all standard fields and empty values deterministically', () => {
  const records = [cookie({ name: 'z', value: '', session: false, expirationDate: 1770000000.125 }), cookie({ name: 'a', domain: 'EXAMPLE.com', path: '/a?b#c' })];
  const first = exportCookieRecords(records, { browser: 'chrome' });
  const second = exportCookieRecords(records.toReversed(), { browser: 'chrome' });
  assert.equal(first.text, second.text);
  const parsed = parseCookieImport(first.text);
  assert.equal(parsed.formatVersion, 1); assert.equal(parsed.cookies.find(record => record.name === 'a').domain, 'example.com');
  assert.equal(parsed.cookies.find(record => record.name === 'z').value, ''); assert.equal(parsed.cookies.find(record => record.name === 'z').expirationDate, 1770000000.125);
  assert.equal(exportCookieRecords(parsed.cookies, { browser: parsed.source.browser }).text, first.text);
});

test('cookie transfer: host-only and domain cookie identities remain distinct with domain normalization', () => {
  const host = cookie(), scoped = cookie({ hostOnly: false, domain: 'EXAMPLE.com' });
  assert.equal(validateCookieRecord(scoped).domain, '.example.com');
  assert.notEqual(cookieIdentity(host), cookieIdentity(scoped));
  assert.equal(cookieIdentity(scoped), cookieIdentity({ ...scoped, domain: '.example.com' }));
  assert.equal(parseCookieImport(JSON.stringify(doc([host, scoped]))).cookies.length, 2);
});

test('cookie transfer: partition ancestor, top-level site, store, FPI and path are independent identities', () => {
  const base = cookie({ partitionKey: { topLevelSite: 'https://top.example', hasCrossSiteAncestor: false } });
  const variants = [base, { ...base, storeId: '1' }, { ...base, path: '/other' }, { ...base, firstPartyDomain: 'top.example' }, { ...base, partitionKey: { ...base.partitionKey, hasCrossSiteAncestor: true } }, { ...base, partitionKey: { ...base.partitionKey, topLevelSite: 'https://other.example' } }, { ...base, partitionKey: { ...base.partitionKey, hasCrossSiteAncestor: null } }];
  assert.equal(new Set(variants.map(cookieIdentity)).size, variants.length);
  assert.equal(cookieIdentity(cookie()), cookieIdentity(cookie({ firstPartyDomain: '' })));
  assert.notEqual(cookieSignature(cookie()), cookieSignature(cookie({ firstPartyDomain: '' })));
});

test('cookie transfer: native Chrome and Firefox fields normalize without creating expiry or isolation', () => {
  const { expirationDate, partitionKey, firstPartyDomain, ...raw } = cookie();
  assert.deepEqual(normalizeNativeCookie(raw, { browser: 'chrome' }), cookie());
  assert.deepEqual(normalizeNativeCookie({ ...raw, partitionKey: { topLevelSite: 'https://top.example/' }, firstPartyDomain: '' }, { browser: 'firefox', storeId: 'firefox-default' }), cookie({ partitionKey: { topLevelSite: 'https://top.example', hasCrossSiteAncestor: null }, firstPartyDomain: '', storeId: 'firefox-default' }));
  error(() => normalizeNativeCookie({ ...raw, session: false }), 'invalid-expiration');
  error(() => normalizeNativeCookie({ ...raw, expirationDate: 99 }), 'invalid-expiration');
  const expanded = { ...raw }; Object.defineProperty(expanded, 'futureReadonlyMetadata', { enumerable: true, get() { throw new Error('must not inspect'); } });
  assert.deepEqual(normalizeNativeCookie(expanded, { browser: 'chrome' }), cookie());
});
test('cookie transfer: Firefox foreign native compartments are copied through own data descriptors only', () => {
  const foreign = runInNewContext('(' + JSON.stringify(cookie({ partitionKey: { topLevelSite: 'https://example.net', hasCrossSiteAncestor: true }, firstPartyDomain: '' })) + ')');
  assert.notEqual(Object.getPrototypeOf(foreign), Object.prototype);
  assert.notEqual(Object.getPrototypeOf(foreign.partitionKey), Object.prototype);
  assert.deepEqual(normalizeNativeCookie(foreign, { browser: 'firefox' }), cookie({ partitionKey: { topLevelSite: 'https://example.net', hasCrossSiteAncestor: true }, firstPartyDomain: '' }));
  error(() => validateCookieRecord(foreign), 'invalid-cookie');
  let calls = 0; Object.defineProperty(foreign.partitionKey, 'topLevelSite', { get() { calls++; return 'https://example.net'; } });
  error(() => normalizeNativeCookie(foreign, { browser: 'firefox' }), 'invalid-input'); assert.equal(calls, 0);
});

test('cookie transfer: native set preserves host-only and session by omitting read-only derived fields', () => {
  const result = cookieSetDetails(cookie({ path: '/a%3Fb%23c/d' }), { browser: 'chrome', storeId: '1' });
  assert.equal(result.url, 'https://example.com/'); assert.equal(result.path, '/a%3Fb%23c/d');
  assert.equal(result.storeId, '1'); assert.equal(Object.hasOwn(result, 'domain'), false);
  assert.equal(Object.hasOwn(result, 'expirationDate'), false); assert.equal(Object.hasOwn(result, 'hostOnly'), false); assert.equal(Object.hasOwn(result, 'session'), false);
  const persistent = cookieSetDetails(cookie({ hostOnly: false, session: false, expirationDate: 1 }), { browser: 'chrome' });
  assert.equal(persistent.domain, '.example.com'); assert.equal(persistent.expirationDate, 1);
});

test('cookie transfer: Chromium path canonicalization cannot silently write a different identity', () => {
  for (const path of ['/a b', '/a/../b', '/a?b#c', '/a\\b', '/кир', '/a/%2e%2e/b', '/a/%2E/b', '/a"b', '/a<b', '/a>b', '/a`b', '/a{b}', '/a|b', '/a^b', '/a;b']) {
    const record = cookie({ path });
    assert.equal(validateCookieRecord(record).path, path);
    error(() => cookieSetDetails(record, { browser: 'chrome' }), 'invalid-path');
  }
  for (const path of ['/a%20b', '/a%2e/b', '//x', '/a%2Fb', '/a%zzb', '/a[b]', '/a:b', "/a'b", '/a%2520b', '/a%b']) assert.equal(cookieSetDetails(cookie({ path }), { browser: 'chrome' }).path, path);
  for (const path of ['/a b', '/a/../b', '/a?b#c', '/a\\b', '/кир']) assert.equal(cookieSetDetails(cookie({ path }), { browser: 'firefox' }).path, path);
});

test('cookie transfer: public suffix or local domain cookie fallback cannot change host-only identity', () => {
  for (const domain of ['.com', '.co.uk', '.localhost', '.github.io', '.unknownsuffix']) {
    const record = cookie({ domain, hostOnly: false });
    assert.equal(validateCookieRecord(record).hostOnly, false);
    for (const browser of ['chrome', 'firefox']) error(() => cookieSetDetails(record, { browser }), 'invalid-domain');
  }
  for (const domain of ['.example.com', '.sub.example.com', '.foo.github.io']) assert.equal(cookieSetDetails(cookie({ domain, hostOnly: false }), { browser: 'chrome' }).domain, domain);
  assert.equal(cookieSetDetails(cookie({ domain: 'com' }), { browser: 'chrome' }).url, 'https://com/');
});

test('cookie transfer: IPv6 host URL uses brackets and never interprets cookie path as URI structure', () => {
  assert.equal(cookieSetDetails(cookie({ domain: '[::1]', secure: false }), { browser: 'chrome' }).url, 'https://[::1]/');
  for (const value of ['user@example.com', 'example.com:8080', 'example.com/path', 'example.com?query', 'example.com#hash', 'example.com\\other', 'a%2eb.com']) error(() => validateCookieRecord(cookie({ domain: value })), 'invalid-domain');
  error(() => validateCookieRecord(cookie({ domain: '127.0.0.1', hostOnly: false })), 'invalid-domain');
});

test('cookie transfer: HTTPS native context preserves an explicit false Secure attribute for edits', () => {
  for (const browser of ['chrome', 'firefox']) {
    const details = cookieSetDetails(cookie({ secure: false }), { browser });
    assert.equal(details.url, 'https://example.com/');
    assert.equal(details.secure, false);
    assert.equal(details.sameSite, 'lax');
  }
});

test('cookie transfer: native set respects partition and FPI capabilities without dropping isolation', () => {
  const record = cookie({ partitionKey: { topLevelSite: 'https://example.net', hasCrossSiteAncestor: true } });
  assert.deepEqual(cookieSetDetails(record, { browser: 'chrome' }).partitionKey, record.partitionKey);
  error(() => cookieSetDetails(record, { browser: 'firefox' }), 'unsupported-partition');
  assert.deepEqual(cookieSetDetails(record, { browser: 'firefox', capabilities: { hasCrossSiteAncestor: true } }).partitionKey, record.partitionKey);
  error(() => cookieSetDetails(record, { browser: 'chrome', capabilities: { partitionKey: false } }), 'unsupported-partition');
  const unknown = cookie({ partitionKey: { ...record.partitionKey, hasCrossSiteAncestor: null } });
  assert.deepEqual(cookieSetDetails(unknown, { browser: 'firefox' }).partitionKey, { topLevelSite: 'https://example.net' });
  error(() => cookieSetDetails(unknown, { browser: 'chrome' }), 'unsupported-partition');
  error(() => cookieSetDetails(cookie({ firstPartyDomain: 'top.example' }), { browser: 'chrome' }), 'unsupported-first-party-domain');
  assert.equal(cookieSetDetails(cookie({ firstPartyDomain: 'top.example' }), { browser: 'firefox' }).firstPartyDomain, 'top.example');
});

test('cookie transfer: partition writes reject any native schemeful-site collapse before mutation', () => {
  for (const topLevelSite of ['https://sub.example.com', 'https://example.com:123', 'https://sub.example.co.uk', 'https://sub.foo.github.io', 'https://example.unknownsuffix', 'https://example.com.']) {
    const record = cookie({ partitionKey: { topLevelSite, hasCrossSiteAncestor: true } });
    assert.equal(validateCookieRecord(record).partitionKey.topLevelSite, topLevelSite);
    error(() => cookieSetDetails(record, { browser: 'chrome' }), 'unsupported-partition');
  }
  for (const topLevelSite of ['https://example.com', 'https://example.co.uk', 'https://foo.github.io', 'http://localhost', 'http://127.0.0.1', 'https://[::1]']) {
    const record = cookie({ partitionKey: { topLevelSite, hasCrossSiteAncestor: true } });
    assert.equal(cookieSetDetails(record, { browser: 'chrome' }).partitionKey.topLevelSite, topLevelSite);
  }
});

test('cookie transfer: a false ancestor bit is allowed only for the cookie URL own schemeful site', () => {
  for (const topLevelSite of ['https://example.net', 'http://example.com']) {
    const record = cookie({ partitionKey: { topLevelSite, hasCrossSiteAncestor: false } });
    error(() => cookieSetDetails(record, { browser: 'chrome' }), 'unsupported-partition');
    if (topLevelSite === 'https://example.net') error(() => cookieSetDetails(record, { browser: 'firefox', capabilities: { hasCrossSiteAncestor: true } }), 'unsupported-partition');
    else assert.equal(cookieSetDetails(record, { browser: 'firefox', capabilities: { hasCrossSiteAncestor: true } }).partitionKey.topLevelSite, topLevelSite);
  }
  const sameSite = cookie({ domain: 'owned-cookie.example.com', partitionKey: { topLevelSite: 'https://example.com', hasCrossSiteAncestor: false } });
  assert.equal(cookieSetDetails(sameSite, { browser: 'chrome' }).partitionKey.hasCrossSiteAncestor, false);
  const nested = { ...sameSite, partitionKey: { ...sameSite.partitionKey, hasCrossSiteAncestor: true } };
  assert.equal(cookieSetDetails(nested, { browser: 'chrome' }).partitionKey.hasCrossSiteAncestor, true);
  assert.notEqual(cookieIdentity(nested), cookieIdentity(sameSite));
});

test('cookie transfer: known Chromium native pair/path limits are checked without rewriting legacy data', () => {
  const pairLimit = cookie({ name: 'k', value: 'v'.repeat(4095) });
  assert.equal(cookieSetDetails(pairLimit, { browser: 'chrome' }).value.length, 4095);
  const oversized = { ...pairLimit, value: 'v'.repeat(4096) };
  assert.equal(validateCookieRecord(oversized).value.length, 4096);
  error(() => cookieSetDetails(oversized, { browser: 'chrome' }), 'invalid-cookie');
  assert.equal(cookieSetDetails(oversized, { browser: 'firefox' }).value.length, 4096);
  assert.equal(cookieSetDetails(cookie({ name: 'k', value: 'é'.repeat(2047) + 'x' }), { browser: 'chrome' }).value.length, 2048);
  error(() => cookieSetDetails(cookie({ name: 'k', value: 'é'.repeat(2048) }), { browser: 'chrome' }), 'invalid-cookie');
  assert.equal(cookieSetDetails(cookie({ path: '/' + 'a'.repeat(1023) }), { browser: 'chrome' }).path.length, 1024);
  const longPath = cookie({ path: '/' + 'a'.repeat(1024) });
  error(() => cookieSetDetails(longPath, { browser: 'chrome' }), 'invalid-path');
  assert.equal(cookieSetDetails(longPath, { browser: 'firefox' }).path.length, 1025);
});

test('cookie transfer: native Chromium value parser restrictions do not become unproved Firefox bans', () => {
  for (const value of ['a;b', ' value ', 'leading ', ' trailing']) {
    error(() => cookieSetDetails(cookie({ value }), { browser: 'chrome' }), 'invalid-cookie');
    assert.equal(cookieSetDetails(cookie({ value }), { browser: 'firefox' }).value, value);
  }
  error(() => cookieSetDetails(cookie({ name: '', value: '' }), { browser: 'chrome' }), 'invalid-cookie');
  assert.equal(cookieSetDetails(cookie({ name: '', value: '' }), { browser: 'firefox' }).value, '');
  for (const value of ['a"b', 'a\\b', 'é']) assert.equal(cookieSetDetails(cookie({ value }), { browser: 'chrome' }).value, value);
});

test('cookie transfer: exact canonical schema rejects missing/unknown fields and incompatible versions', () => {
  const missing = cookie(); delete missing.path;
  error(() => parseCookieImport(JSON.stringify(doc([missing]))), 'invalid-cookie');
  error(() => parseCookieImport(JSON.stringify(doc([cookie({ priority: 'high' })]))), 'invalid-cookie');
  error(() => parseCookieImport(JSON.stringify({ ...doc([]), formatVersion: 2 })), 'unsupported-version');
  error(() => parseCookieImport(JSON.stringify({ ...doc([]), format: 'other' })), 'invalid-format');
  error(() => parseCookieImport(JSON.stringify({ ...doc([]), source: { browser: 'opera' } })), 'invalid-format');
  error(() => parseCookieImport(JSON.stringify({ ...doc([]), arbitrary: true })), 'invalid-format');
});

test('cookie transfer: duplicate JSON keys cannot hide records or settings, including escaped keys', () => {
  for (const input of ['{"cookies":[],"cookies":[]}', '{"name":"first","na\\u006de":"second"}', '{"a":{"x":1,"x":2}}']) error(() => parseCookieJson(input), 'duplicate-key');
  assert.deepEqual(parseCookieJson('{"a":"\\\"\\\\","b":[true,false,null,-1.25e2]}'), { a: '"\\', b: [true, false, null, -125] });
});

test('cookie transfer: parser rejects prototype keys, malformed tokens and excessive nesting', () => {
  for (const input of ['{"__proto__":{}}', '{"constructor":{}}', '{"prototype":{}}', '{"a":1,}', '[1,]', '1e999', '01', 'true false', '"unterminated', '{"a":"\n"}', '{a:1}', 'NaN']) error(() => parseCookieJson(input), 'invalid-json');
  error(() => parseCookieJson(`${'['.repeat(15)}0${']'.repeat(15)}`), 'limit-exceeded');
  assert.equal({}.polluted, undefined);
});

test('cookie transfer: canonical duplicate identities are rejected even with distinct values', () => {
  error(() => parseCookieImport(JSON.stringify(doc([cookie(), cookie({ value: 'other' })]))), 'duplicate-cookie');
  error(() => exportCookieRecords([cookie(), cookie({ value: 'other' })]), 'duplicate-cookie');
  error(() => parseCookieImport(JSON.stringify({ ...doc([]), stores: [{ id: '0' }, { id: '0' }] })), 'duplicate-store');
  error(() => parseCookieImport(JSON.stringify({ ...doc([cookie()]), stores: [] })), 'invalid-store');
});

test('cookie transfer: expiration/session consistency, finite seconds and no-restriction Secure are strict', () => {
  for (const patch of [{ session: true, expirationDate: 10 }, { session: false }, { session: false, expirationDate: NaN }, { session: false, expirationDate: Infinity }, { session: false, expirationDate: -1 }]) error(() => validateCookieRecord(cookie(patch)), 'invalid-expiration');
  error(() => validateCookieRecord(cookie({ sameSite: 'no_restriction', secure: false })), 'invalid-samesite');
  assert.equal(validateCookieRecord(cookie({ session: false, expirationDate: 0 })).expirationDate, 0);
  error(() => cookieSetDetails(cookie({ sameSite: 'unspecified' }), { browser: 'firefox' }), 'unsupported-samesite');
  assert.equal(cookieSetDetails(cookie({ sameSite: 'unspecified' }), { browser: 'firefox', capabilities: { unspecifiedSameSite: true } }).sameSite, 'unspecified');
});

test('cookie transfer: unsupported unspecified SameSite is preserved in files and rejected before native write', () => {
  const record = cookie({ sameSite: 'unspecified' });
  assert.equal(parseCookieImport(exportCookieRecords([record], { browser: 'firefox' }).text).cookies[0].sameSite, 'unspecified');
  error(() => cookieSetDetails(record, { browser: 'chrome', capabilities: { unspecifiedSameSite: false } }), 'unsupported-samesite');
  error(() => cookieSetDetails(record, { browser: 'firefox', capabilities: { unspecifiedSameSite: false } }), 'unsupported-samesite');
  assert.equal(cookieSetDetails(record, { browser: 'firefox', capabilities: { unspecifiedSameSite: true } }).sameSite, 'unspecified');
  assert.equal(cookieSetDetails(record, { browser: 'chrome' }).sameSite, 'unspecified');
});

test('cookie transfer: prefixes enforce Secure, host-only, root path and HttpOnly consistently', () => {
  for (const [name, patch] of [['__Secure-test', { secure: false }], ['__Host-test', { hostOnly: false }], ['__Host-test', { path: '/x' }], ['__Http-test', { httpOnly: false }], ['__Host-Http-test', { httpOnly: false }]]) error(() => validateCookieRecord(cookie({ name, ...patch })), 'invalid-prefix');
  for (const name of ['__Secure-test', '__Host-test', '__Http-test', '__Host-Http-test']) assert.equal(validateCookieRecord(cookie({ name })).name, name);
});

test('cookie transfer: strings preserve literal values and reject control characters and lone surrogates', () => {
  const value = ' space%2F+é=,"\\ ';
  assert.equal(parseCookieImport(exportCookieRecords([cookie({ value })]).text).cookies[0].value, value);
  for (const value of ['a\nb', 'a\rb', 'a\tb', '\ud800', '\udc00']) error(() => validateCookieRecord(cookie({ value })), 'invalid-cookie');
  error(() => validateCookieRecord(cookie({ name: 'not=token' })), 'invalid-cookie');
  assert.equal(validateCookieRecord(cookie({ name: '', value: '' })).name, '');
});

test('cookie transfer: getters and coercion hooks are never invoked by record validation', () => {
  let calls = 0;
  const record = cookie(); Object.defineProperty(record, 'value', { enumerable: true, get() { calls++; return 'secret'; } });
  error(() => validateCookieRecord(record), 'invalid-input');
  const foreign = { ...cookie(), sameSite: { toString() { calls++; return 'lax'; } } };
  error(() => parseCookieImport(JSON.stringify([foreign])), 'invalid-samesite');
  error(() => validateCookieRecord({ ...cookie(), value: { toString() { calls++; return 'secret'; } } }), 'invalid-cookie');
  assert.equal(calls, 0);
});

test('cookie transfer: Cookie-Editor array imports explicit values and determines only documented missing fields', () => {
  const legacy = { name: 'legacy', value: '', domain: '.example.com', path: '/', secure: true, httpOnly: false, sameSite: 'None', expirationDate: 1770000000, id: 1 };
  const parsed = parseCookieImport(JSON.stringify([legacy]));
  assert.equal(parsed.cookies[0].hostOnly, false); assert.equal(parsed.cookies[0].session, false); assert.equal(parsed.cookies[0].sameSite, 'no_restriction');
  assert.equal(parsed.cookies[0].storeId, 'import'); assert.equal(parsed.source.browser, 'unknown');
  const { expirationDate, ...session } = legacy;
  assert.equal(parseCookieImport(JSON.stringify([session])).cookies[0].session, true);
  error(() => parseCookieImport(JSON.stringify([{ ...legacy, priority: 'High' }])), 'unsupported-field');
  error(() => parseCookieImport(JSON.stringify([{ ...legacy, session: true }])), 'invalid-expiration');
});

test('cookie transfer: Netscape import supports HttpOnly, empty names/values, session zero and domain flags', () => {
  const text = '# Netscape HTTP Cookie File\n#HttpOnly_.example.com\tTRUE\t/\tTRUE\t1770000000\tsession\t\nexample.com\tFALSE\t/a\tFALSE\t0\t\tfixture\n';
  const result = parseCookieImport(text);
  const persistent = result.cookies.find(record => record.name === 'session');
  assert.equal(persistent.httpOnly, true); assert.equal(persistent.hostOnly, false); assert.equal(persistent.value, ''); assert.equal(persistent.expirationDate, 1770000000);
  const session = result.cookies.find(record => record.name === ''); assert.equal(session.session, true); assert.equal(session.expirationDate, null); assert.equal(session.sameSite, 'unspecified');
});

test('cookie transfer: Netscape export requires explicit lossy choice and rejects isolation flattening', () => {
  error(() => exportCookieRecords([cookie()], { format: 'netscape' }), 'lossy-export');
  const result = exportCookieRecords([cookie({ session: false, expirationDate: 1770000000.5 })], { format: 'netscape', allowLossy: true });
  assert.deepEqual(result.warnings, ['netscape-attributes-lost', 'netscape-store-lost']);
  const roundtrip = parseCookieImport(result.text).cookies[0]; assert.equal(roundtrip.httpOnly, true); assert.equal(roundtrip.expirationDate, 1770000000);
  error(() => exportCookieRecords([cookie({ firstPartyDomain: 'first.example' })], { format: 'netscape', allowLossy: true }), 'unsupported-partition');
  error(() => exportCookieRecords([cookie({ partitionKey: { topLevelSite: 'https://first.example', hasCrossSiteAncestor: true } })], { format: 'netscape', allowLossy: true }), 'unsupported-partition');
  error(() => exportCookieRecords([cookie(), cookie({ storeId: '1' })], { format: 'netscape', allowLossy: true }), 'invalid-store');
  error(() => exportCookieRecords([cookie({ session: false, expirationDate: 0.5 })], { format: 'netscape', allowLossy: true }), 'invalid-expiration');
});

test('cookie transfer: malformed Netscape fields fail before any canonical records are returned', () => {
  for (const input of ['example.com\tMAYBE\t/\tTRUE\t0\ta\tb', 'example.com\tFALSE\t/\tTRUE\t1.5\ta\tb', 'example.com\tFALSE\t/\tTRUE\t0\ta\tb\textra', 'example.com FALSE / TRUE 0 a b']) error(() => parseCookieImport(input), 'invalid-format');
});

test('cookie transfer: byte, record, string and store limits are enforced', () => {
  error(() => parseCookieJson('"éé"', { maxBytes: 5 }), 'limit-exceeded');
  error(() => validateCookieRecord(cookie({ value: 'x'.repeat(COOKIE_TRANSFER_LIMITS.value + 1) })), 'invalid-cookie');
  error(() => exportCookieRecords(Array.from({ length: COOKIE_TRANSFER_LIMITS.cookies + 1 }, (_, index) => cookie({ name: `n${index}` }))), 'limit-exceeded');
  error(() => exportCookieRecords(Array.from({ length: COOKIE_TRANSFER_LIMITS.stores + 1 }, (_, index) => cookie({ storeId: `${index}` }))), 'limit-exceeded');
  error(() => exportCookieRecords(Array.from({ length: 257 }, (_, index) => cookie({ name: `n${index}`, value: 'x'.repeat(COOKIE_TRANSFER_LIMITS.value) }))), 'limit-exceeded');
});

test('cookie transfer: ten thousand distinct fixture cookies remain portable within the bounded format', () => {
  const records = Array.from({ length: COOKIE_TRANSFER_LIMITS.cookies }, (_, index) => cookie({ name: `fixture_${index}` }));
  const exported = exportCookieRecords(records, { browser: 'chrome' });
  assert.equal(parseCookieImport(exported.text).cookies.length, COOKIE_TRANSFER_LIMITS.cookies);
  assert.ok(new TextEncoder().encode(exported.text).byteLength < COOKIE_TRANSFER_LIMITS.bytes);
});

test('cookie transfer: malformed isolation keys and unsafe expiry never silently downgrade', () => {
  for (const partitionKey of [{ topLevelSite: 'https://top.example' }, { topLevelSite: 'https://user:pass@top.example', hasCrossSiteAncestor: true }, { topLevelSite: 'https://top.example/path', hasCrossSiteAncestor: true }, { topLevelSite: 'file:///tmp', hasCrossSiteAncestor: true }, { topLevelSite: '', hasCrossSiteAncestor: false }]) error(() => validateCookieRecord(cookie({ partitionKey })), 'unsupported-partition');
  error(() => validateCookieRecord(cookie({ secure: false, partitionKey: { topLevelSite: 'https://top.example', hasCrossSiteAncestor: true } })), 'unsupported-partition');
  error(() => cookieSetDetails(cookie(), { browser: 'chrome', capabilities: { arbitrary: true } }), 'invalid-input');
});

test('cookie transfer: error messages contain only allowlisted codes and no arbitrary input', () => {
  const result = new CookieTransferError('secret-value'); assert.equal(result.code, 'invalid-input'); assert.equal(result.message, 'invalid-input');
  const unsafe = { toString() { throw new Error('must not run'); } };
  assert.equal(new CookieTransferError(unsafe).message, 'invalid-input');
});

// ADR-107: automation-tool arrays (Playwright, Puppeteer, CDP, snake_case dumps).
const tool = patch => ({ name: 'sid', value: 'TOOL_VALUE_CANARY', domain: '.example.com', path: '/', expires: 1900000000.5, httpOnly: true, secure: true, sameSite: 'Lax', ...patch });
const imported = records => parseCookieImport(JSON.stringify(records)).cookies;
test('cookie transfer: Playwright arrays map Unix-second expiry, -1 sessions, SameSite and the domain dot', () => {
  const [persistent, session, strict] = imported([tool(), tool({ name: 'tmp', domain: 'example.com', expires: -1, sameSite: 'None' }), tool({ name: 'z', sameSite: 'Strict', httpOnly: false, secure: false })]).sort((a, b) => a.name < b.name ? -1 : 1);
  assert.deepEqual(persistent, cookie({ name: 'sid', value: 'TOOL_VALUE_CANARY', domain: '.example.com', hostOnly: false, sameSite: 'lax', session: false, expirationDate: 1900000000.5, storeId: 'import' }));
  assert.deepEqual([session.hostOnly, session.session, session.expirationDate, session.sameSite], [true, true, null, 'no_restriction']);
  assert.deepEqual([strict.sameSite, strict.httpOnly, strict.secure], ['strict', false, false]);
  assert.equal(parseCookieImport(JSON.stringify([tool()])).source.browser, 'unknown');
  // Absent or null expiry is a session cookie; 0 stays the Unix epoch (an expired row in preview).
  const { expires: ignored, ...noExpiry } = tool(); void ignored;
  assert.equal(imported([noExpiry, tool({ name: 'nul', expires: null }), tool({ name: 'epoch', expires: 0 })]).map(record => [record.name, record.session, record.expirationDate]).sort().join('|'), 'epoch,false,0|nul,true,|sid,true,');
});
test('cookie transfer: Puppeteer/CDP read-only extras are a closed ignored list and stay validated', () => {
  const extras = { size: 42, priority: 'High', sourceScheme: 'Secure', sourcePort: 443, sameParty: false, partitionKeyOpaque: false, session: false };
  assert.deepEqual(imported([tool(extras)]), imported([tool()]));
  assert.equal(imported([tool({ expires: -1, session: true, sourcePort: -1 })])[0].session, true);
  for (const patch of [{ size: -1 }, { size: '42' }, { priority: 'Urgent' }, { sourceScheme: 'https' }, { sourcePort: 70000 }, { sameParty: true }, { creation: 1 }, { hostOnly: false }, { storeId: '0' }, { url: 'https://example.com/' }]) error(() => parseCookieImport(JSON.stringify([tool(patch)])), 'unsupported-field');
  error(() => parseCookieImport(JSON.stringify([tool({ partitionKeyOpaque: true })])), 'unsupported-partition');
});
test('cookie transfer: snake_case aliases are accepted once; duplicates, mixed shapes and missing flags reject', () => {
  const { httpOnly: ignoredHttp, sameSite: ignoredSite, ...base } = tool(); void ignoredHttp; void ignoredSite;
  assert.deepEqual(imported([{ ...base, http_only: true, same_site: 'lax' }]), imported([tool()]));
  assert.equal(imported([{ ...base, http_only: false, same_site: 'unspecified', expires: null }])[0].sameSite, 'unspecified');
  assert.equal(imported([{ ...base, httpOnly: false }])[0].sameSite, 'unspecified');
  error(() => parseCookieImport(JSON.stringify([tool({ http_only: true })])), 'unsupported-field');
  error(() => parseCookieImport(JSON.stringify([tool({ same_site: 'Lax' })])), 'unsupported-field');
  error(() => parseCookieImport(JSON.stringify([base])), 'unsupported-field');
  error(() => parseCookieImport(JSON.stringify([tool(), { name: 'legacy', value: '', domain: '.example.com', path: '/', secure: true, httpOnly: false, expirationDate: 1900000000 }])), 'unsupported-field');
  for (const sameSite of ['Bogus', '__proto__', 5]) error(() => parseCookieImport(JSON.stringify([tool({ sameSite })])), 'invalid-samesite');
  error(() => parseCookieImport(JSON.stringify([tool({ sameSite: 'None', secure: false })])), 'invalid-samesite');
});
test('cookie transfer: tool expiry and session flags must agree; nothing is coerced', () => {
  for (const patch of [{ expires: -2 }, { expires: '1900000000' }, { expires: true }, { session: true }, { expires: -1, session: false }, { session: 'false' }]) error(() => parseCookieImport(JSON.stringify([tool(patch)])), 'invalid-expiration');
  error(() => parseCookieImport(JSON.stringify([tool({ domain: 5 })])), 'invalid-domain');
  error(() => parseCookieImport(JSON.stringify([tool({ secure: 'true' })])), 'invalid-cookie');
});
test('cookie transfer: tool partition keys map only to a named top-level site; the ancestor bit is never invented', () => {
  assert.deepEqual(imported([tool({ partitionKey: 'https://top.example' })])[0].partitionKey, { topLevelSite: 'https://top.example', hasCrossSiteAncestor: null });
  assert.deepEqual(imported([tool({ partitionKey: { sourceOrigin: 'https://top.example', hasCrossSiteAncestor: false } })])[0].partitionKey, { topLevelSite: 'https://top.example', hasCrossSiteAncestor: false });
  assert.deepEqual(imported([tool({ partitionKey: { topLevelSite: 'https://top.example', hasCrossSiteAncestor: true } })])[0].partitionKey, { topLevelSite: 'https://top.example', hasCrossSiteAncestor: true });
  assert.equal(imported([tool({ partitionKey: null })])[0].partitionKey, null);
  for (const partitionKey of [5, [], {}, { sourceOrigin: 'https://top.example', topLevelSite: 'https://top.example' }, { topLevelSite: 'https://top.example', extra: 1 }, 'file:///tmp', 'https://top.example/path']) error(() => parseCookieImport(JSON.stringify([tool({ partitionKey })])), 'unsupported-partition');
  error(() => parseCookieImport(JSON.stringify([tool({ secure: false, sameSite: 'Lax', partitionKey: 'https://top.example' })])), 'unsupported-partition');
  // Chrome needs the ancestor bit to write the exact identity; an unknown bit stays a preview error.
  error(() => cookieSetDetails(imported([tool({ partitionKey: 'https://top.example' })])[0], { browser: 'chrome', storeId: '0' }), 'unsupported-partition');
});
test('cookie transfer: tool-array failures never echo cookie names or values', () => {
  for (const patch of [{ creation: 'TOOL_VALUE_CANARY' }, { sameSite: 'TOOL_VALUE_CANARY' }, { expires: 'TOOL_VALUE_CANARY' }]) {
    try { parseCookieImport(JSON.stringify([tool(patch)])); assert.fail('accepted'); } catch (failure) { assert.ok(failure instanceof CookieTransferError); assert.doesNotMatch(String(failure.message) + String(failure.code), /TOOL_VALUE_CANARY/); }
  }
});
