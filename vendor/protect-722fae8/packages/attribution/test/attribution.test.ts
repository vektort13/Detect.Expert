import { describe, expect, it } from 'vitest';
import { parsePsl, packRules, unpackRules, registrableDomain, redactHost, toAsciiHost, parseIpLiteral, siteRelation, isLocalTarget, leftmostSubLabel, requestScheme } from '../src/index';

describe('P01 / ADR-008 PSL', () => {
  it.each([
    ['a.b.example.com', 'example.com'], ['a.example.co.uk', 'example.co.uk'],
    ['x.user.github.io', 'user.github.io'], ['github.io', null],
    ['x.tenant.blogspot.com', 'tenant.blogspot.com'], ['x.a.ck', 'x.a.ck'],
    ['a.ck', null], ['x.www.ck', 'www.ck'], ['www.ck', 'www.ck'],
    ['x.city.kawasaki.jp', 'city.kawasaki.jp'], ['a.kawasaki.jp', null],
    ['a.unknownsuffix', null], ['com', null], ['co.uk', null],
    ['WWW.BÜCHER.DE.', 'xn--bcher-kva.de'], ['x.example.com.', 'example.com'],
  ])('%s -> %s', (host, domain) => expect(registrableDomain(host)).toBe(domain));
  it('parses both sections, IDN, comments, wildcard and exceptions', () => {
    const rules = parsePsl('// ===BEGIN ICANN DOMAINS===\ncom\n*.ck\n!www.ck\n// ===BEGIN PRIVATE DOMAINS===\ngithub.io\nрф\n');
    expect(rules).toEqual(['!www.ck', '*.ck', 'com', 'github.io', 'xn--p1ai']);
    expect(new Set(unpackRules(packRules(rules)))).toEqual(new Set(rules));
    expect(registrableDomain('a.user.github.io', new Set(rules))).toBe('user.github.io');
  });
  it.each(['evil-online-metrix.net', 'online-metrix.net.evil.example', 'online-metrix.net@evil.example', 'https://online-metrix.net@evil.example/x?q=secret'])('rejects vendor lookalike %s', (host) => {
    expect(registrableDomain(host)).not.toBe('online-metrix.net');
  });
});
describe('P01 IP classification and host normalization', () => {
  it.each([
    ['127.0.0.1', 'loopback'], ['127.255.1.2', 'loopback'], ['0x7f000001', 'loopback'],
    ['10.2.3.4', 'private'], ['172.16.1.1', 'private'], ['172.31.255.1', 'private'],
    ['172.32.1.1', 'public'], ['192.168.1.1', 'private'], ['169.254.2.3', 'link-local'],
    ['8.8.8.8', 'public'], ['[::1]', 'loopback'], ['[fe80::1234]', 'link-local'],
    ['[febf::1]', 'link-local'], ['[fc00::1]', 'ULA'], ['[fd12:3456::1]', 'ULA'],
    ['[2001:4860:4860::8888]', 'public'], ['[::ffff:192.168.1.2]', 'private'],
    ['[::ffff:127.0.0.1]', 'loopback'], ['[::ffff:a9fe:1234]', 'link-local'],
  ])('%s -> %s without retaining the address', (host, category) => {
    expect(parseIpLiteral(host)?.category).toBe(category);
    expect(redactHost(host)).toEqual({ kind: 'ip', value: category });
    expect(JSON.stringify(redactHost(host))).not.toContain(host);
  });
  it.each(['[gggg::1]', '999.1.1.1', '[::1', 'a..com', 'a b.com', 'example.com/path'])('rejects malformed %s', (host) => expect(toAsciiHost(host)).toBeNull());
  it('drops URL credentials, port, path, query and fragment', () => {
    expect(toAsciiHost('https://user:secret@WWW.BÜCHER.DE:443/id?q=token#fragment')).toBe('www.xn--bcher-kva.de');
    expect(redactHost('https://random.example.com:99/id?q=token')).toEqual({ kind: 'registrable', value: 'example.com' });
  });
  it.each([['localhost', 'localhost'], ['random.localhost', 'localhost'], ['random.local', 'local'], ['printer', 'single-label']])('categorizes %s', (host, value) => expect(redactHost(host)).toEqual({ kind: 'local', value }));
  it('fails closed for unknown suffix', () => expect(redactHost('random.corpinternal')).toEqual({ kind: 'unknown' }));
});
describe('P01 schemeful site relation', () => {
  it.each([
    ['https://a.example.com/x', 'https://a.example.com:443/y', 'same-origin'],
    ['https://a.example.com', 'https://b.example.com', 'same-site'],
    ['http://a.example.com', 'https://a.example.com', 'cross-site'],
    ['https://alice.github.io', 'https://bob.github.io', 'cross-site'],
    ['http://127.0.0.1:4173', 'http://127.0.0.1:4174', 'same-site'],
    ['http://localhost:4173', 'http://localhost:4174', 'same-site'],
    ['https://example.com', 'data:text/plain,hello', 'opaque'],
    ['blob:https://example.com/id', 'https://example.com', 'opaque'],
    ['https://random.unknownsuffix', 'https://other.unknownsuffix', 'unknown'],
    ['not a URL', 'https://example.com', 'unknown'],
    // S07 / ADR-018: WebSocket schemes compare as their HTTP equivalents (same default ports).
    ['ws://example.com/socket', 'http://example.com', 'same-origin'],
    ['wss://example.com/socket', 'https://example.com', 'same-origin'],
    ['wss://example.com:443/socket', 'https://example.com', 'same-origin'],
    ['WSS://chat.example.com/s', 'https://www.example.com', 'same-site'],
    ['ws://example.com/socket', 'https://example.com', 'cross-site'],
    ['wss://rt.vendor.net/s', 'https://example.com', 'cross-site'],
    ['ws://127.0.0.1:45123/', 'https://example.com', 'unknown'],
    ['ws://127.0.0.1:45123/', 'http://127.0.0.1:4173', 'same-site'],
  ])('%s vs %s -> %s', (a, b, relation) => expect(siteRelation(a, b)).toBe(relation));
});
describe('S07 / ADR-018 network helpers (no network, no DNS)', () => {
  it.each([
    ['127.0.0.1', true], ['[::1]', true], ['192.168.77.213', true], ['10.0.0.8', true], ['169.254.1.1', true],
    ['[fd12::1]', true], ['[fe80::1]', true], ['localhost', true], ['printer.local', true], ['printer', true],
    ['8.8.8.8', false], ['[2001:4860:4860::8888]', false], ['example.com', false], ['random.corpinternal', false],
  ])('isLocalTarget(%s) -> %s', (host, local) => expect(isLocalTarget(redactHost(host))).toBe(local));
  it('leftmostSubLabel respects label boundaries and returns null at or above the registrable domain', () => {
    expect(leftmostSubLabel('p3k9x2q8w1z7m4n6b5v0.dns.example.com', 'example.com')).toBe('p3k9x2q8w1z7m4n6b5v0');
    expect(leftmostSubLabel('www.example.co.uk', 'example.co.uk')).toBe('www');
    expect(leftmostSubLabel('example.com', 'example.com')).toBeNull();
    expect(leftmostSubLabel('evil-example.com', 'example.com')).toBeNull();
    expect(leftmostSubLabel('a.example.com.evil.net', 'example.com')).toBeNull();
    expect(leftmostSubLabel('a.example.com', '')).toBeNull();
  });
  it.each([
    ['http://a.example/x', 'http'], ['ws://a.example/x', 'http'], ['HTTPS://a.example', 'https'], ['wss://a.example', 'https'],
    ['WS://a.example', 'http'], ['ftp://a.example', null], ['data:text/plain,x', null], ['blob:https://a.example/id', null], ['', null],
  ])('requestScheme(%s) -> %s', (url, scheme) => expect(requestScheme(url)).toBe(scheme));
  it('requestScheme rejects non-strings', () => expect(requestScheme(42)).toBeNull());
});
