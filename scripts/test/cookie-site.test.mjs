import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalCookieSite, cookieDomainScopeSupported } from '../../apps/production-extension/cookie-site.js';
import { syncCookieSite } from '../production/sync-cookie-site.mjs';
test('cookie site module is reproduced from pinned offline PSL', async () => { await syncCookieSite({ check: true }); });
test('schemeful partition identities use registrable private/ICANN suffixes, no port or subdomains', () => {
  for (const [input, expected] of [['https://sub.example.com:8443', 'https://example.com'], ['http://a.example.co.uk', 'http://example.co.uk'],
    ['https://a.user.github.io', 'https://user.github.io'], ['https://127.0.0.1:443', 'https://127.0.0.1'], ['http://[::1]:12', 'http://[::1]'],
    ['http://localhost:9000', 'http://localhost'], ['https://co.uk', 'https://co.uk']]) assert.equal(canonicalCookieSite(input), expected, input);
});
test('unknown suffixes, userinfo, paths and non-HTTP targets do not become guessed partitions', () => {
  for (const input of ['https://sub.unknown-test-tld', 'https://a.example.com/p', 'https://u:p@example.com', 'https://example.com?x', 'file:///a', 'https://example.com.']) assert.equal(canonicalCookieSite(input), null, input);
});
test('domain cookies cannot silently become host-only at public suffixes or unrecognized domains', () => {
  for (const host of ['example.com', 'sub.example.co.uk', 'user.github.io']) assert.equal(cookieDomainScopeSupported(host), true, host);
  for (const host of ['com', 'co.uk', 'github.io', 'localhost', '127.0.0.1', 'sub.unknown-test-tld']) assert.equal(cookieDomainScopeSupported(host), false, host);
});
