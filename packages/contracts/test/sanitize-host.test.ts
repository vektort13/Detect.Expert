import { describe, expect, it } from 'vitest';
import { isSanitizedHost, sanitizeHost } from '../src/index';

describe('sanitizeHost (REQ-005: host only, ASCII lowercase, never throws)', () => {
  const cases: Array<[string, string | null]> = [
    ['https://Example.COM/path/with/ID-123?token=SECRET#frag', 'example.com'],
    ['https://user:password@example.com:8443/', 'example.com'],
    ['http://example.com.', 'example.com'],
    ['http://EXAMPLE.com./a', 'example.com'],
    ['https://пример.рф/', 'xn--e1afmkfd.xn--p1ai'],
    ['https://[::1]:3000/', '[::1]'],
    ['https://[2001:DB8::1]/x', '[2001:db8::1]'],
    ['http://127.0.0.1:4173/fixture.html', '127.0.0.1'],
    ['wss://socket.example.org/ws?session=abc', 'socket.example.org'],
    ['ws://localhost:8080/', 'localhost'],
    ['  https://example.com/  ', 'example.com'],
    ['https://a.b-c.example.co.uk/', 'a.b-c.example.co.uk'],
    ['chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html', null],
    ['about:blank', null],
    ['about:srcdoc', null],
    ['data:text/html,hello', null],
    ['blob:https://example.com/3f2a', null],
    ['file:///C:/Users/x/page.html', null],
    ['javascript:alert(1)', null],
    ['ftp://example.com/', null],
    ['mailto:someone@example.com', null],
    ['example.com', null],
    ['//example.com/path', null],
    ['', null],
    ['https://', null],
    ['https://exa mple.com/', null],
    ['https://exa_mple.com/', null],
    ['https://' + 'a'.repeat(300) + '.com/', null],
    ['https://' + 'a'.repeat(64) + '.com/', null],
    ['https://example.com/' + 'x'.repeat(70000), null],
  ];

  for (const [input, expected] of cases) {
    it(JSON.stringify(input.length > 80 ? input.slice(0, 80) + '…' : input) + ' -> ' + JSON.stringify(expected), () => {
      expect(sanitizeHost(input)).toBe(expected);
    });
  }

  it('returns null for non-string inputs without throwing', () => {
    const fn = sanitizeHost as unknown as (v: unknown) => string | null;
    for (const v of [null, undefined, 123, {}, [], () => 'x', Symbol('s'), 10n]) {
      expect(fn(v)).toBeNull();
    }
  });

  it('result is always accepted by isSanitizedHost', () => {
    for (const url of ['https://Example.com/', 'https://[::1]/', 'http://1.2.3.4/', 'https://пример.рф/']) {
      const host = sanitizeHost(url);
      expect(host).not.toBeNull();
      expect(isSanitizedHost(host)).toBe(true);
    }
  });
});

describe('isSanitizedHost', () => {
  it('accepts sanitized forms only', () => {
    expect(isSanitizedHost('example.com')).toBe(true);
    expect(isSanitizedHost('xn--e1afmkfd.xn--p1ai')).toBe(true);
    expect(isSanitizedHost('[::1]')).toBe(true);
    expect(isSanitizedHost('127.0.0.1')).toBe(true);
    expect(isSanitizedHost('Example.com')).toBe(false);
    expect(isSanitizedHost('example.com.')).toBe(false);
    expect(isSanitizedHost('-example.com')).toBe(false);
    expect(isSanitizedHost('exa_mple.com')).toBe(false);
    expect(isSanitizedHost('example.com/path')).toBe(false);
    expect(isSanitizedHost('https://example.com')).toBe(false);
    expect(isSanitizedHost('')).toBe(false);
    expect(isSanitizedHost(42)).toBe(false);
    expect(isSanitizedHost(null)).toBe(false);
  });
});
