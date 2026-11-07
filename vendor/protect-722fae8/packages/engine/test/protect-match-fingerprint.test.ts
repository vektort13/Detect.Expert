// ADR-020 §B (S07): keyed double polynomial fingerprint. Two primes below 2^26 (checked here), bases and seeds from the
// 128-bit salt, 13 hex characters; deterministic for one salt, different under another; the rolling window equals the
// direct hash of every window; computeFieldFingerprints returns only {enc, len, h} and never the value.

import { describe, expect, it } from 'vitest';
import { FINGERPRINT_HASH_PATTERN, PROTECT_BUDGETS, SALT_PATTERN } from '@detect-expert/contracts';
import {
  FP_PRIME_1,
  FP_PRIME_2,
  computeFieldFingerprints,
  fingerprintKey,
  fp,
  fpFromHex,
  fpHex,
  fpRange,
  rolling,
  rollingParams,
  rollingScan,
} from '../src/protect/match/index';

const SALT = 'AAECAwQFBgcICQoLDA0ODw';
const SALT_2 = 'DwAODQwLCgkIBwYFBAMCAQ';

function isPrime(n: number): boolean {
  if (n < 2) return false;
  for (let i = 2; i * i <= n; i++) if (n % i === 0) return false;
  return true;
}

describe('fingerprint parameters', () => {
  it('both moduli are primes below 2^26, so every product stays below 2^53', () => {
    for (const p of [FP_PRIME_1, FP_PRIME_2]) {
      expect(isPrime(p)).toBe(true);
      expect(p).toBeLessThan(2 ** 26);
      expect(p * p + 65537).toBeLessThan(Number.MAX_SAFE_INTEGER);
    }
    expect(FP_PRIME_1).not.toBe(FP_PRIME_2);
  });

  it('the salt must be 16 bytes of base64url; bases and seeds depend on it', () => {
    expect(SALT_PATTERN.test(SALT)).toBe(true);
    expect(() => fingerprintKey('short')).toThrow();
    const a = fingerprintKey(SALT);
    const b = fingerprintKey(SALT_2);
    expect([a.b1, a.b2, a.s1, a.s2]).not.toEqual([b.b1, b.b2, b.s1, b.s2]);
    for (const k of [a, b]) {
      expect(k.b1).toBeGreaterThan(65536);
      expect(k.b1).toBeLessThan(FP_PRIME_1);
      expect(k.b2).toBeLessThan(FP_PRIME_2);
    }
  });
});

describe('fp', () => {
  it('13 lowercase hex characters, deterministic per salt, different across salts and values', () => {
    const h = fp(SALT, 'user@example.com');
    expect(FINGERPRINT_HASH_PATTERN.test(h)).toBe(true);
    expect(fp(SALT, 'user@example.com')).toBe(h);
    expect(fp(SALT_2, 'user@example.com')).not.toBe(h);
    expect(fp(SALT, 'user@example.co')).not.toBe(h);
    expect(fp(SALT, 'User@example.com')).not.toBe(h);
  });

  it('hex round trip is exact for 52 bits', () => {
    for (const s of ['a', 'Анна', 'x'.repeat(1024)]) {
      const v = fpRange(fingerprintKey(SALT), s, 0, s.length);
      expect(fpFromHex(fpHex(v))).toBe(v);
    }
    expect(fpFromHex('XYZ')).toBe(-1);
  });

  it('lowerHex hashes A-F as a-f (hex tokens are compared in lower case)', () => {
    const key = fingerprintKey(SALT);
    const upper = 'ABCDEF0123456789ABCDEF0123';
    expect(fpRange(key, upper, 0, upper.length, true)).toBe(fpRange(key, upper.toLowerCase(), 0, upper.length));
  });
});

describe('rolling', () => {
  it('every window equals the direct fingerprint of that substring', () => {
    const text = 'pre Анна Иванова, phone +7 999 123-45-67; end';
    for (const len of [1, 3, 12, 16, text.length]) {
      const windows = [...rolling(SALT, text, len)];
      expect(windows).toHaveLength(text.length - len + 1);
      for (const w of windows) expect(w.h).toBe(fp(SALT, text.slice(w.index, w.index + len)));
    }
  });

  it('rollingScan honours [start, end) and stops when the visitor returns false', () => {
    const key = fingerprintKey(SALT);
    const text = 'aaaa needle bbbb';
    const target = fpRange(key, 'needle', 0, 6);
    const hits: number[] = [];
    rollingScan(key, rollingParams(key, 6), text, 2, 14, (i, v) => {
      if (v === target) hits.push(i);
      return true;
    });
    expect(hits).toEqual([5]);
    let visits = 0;
    rollingScan(key, rollingParams(key, 3), text, 0, text.length, () => ++visits < 2);
    expect(visits).toBe(2);
  });
});

describe('computeFieldFingerprints', () => {
  it('returns {enc, len, h} only: ≤ maxVariantsPerField, unique h, valid lengths, never the value', () => {
    const value = ' Иван.Петров@Example.com ';
    const entries = computeFieldFingerprints('email', value, SALT);
    expect(entries.length).toBeGreaterThan(10);
    expect(entries.length).toBeLessThanOrEqual(PROTECT_BUDGETS.maxVariantsPerField);
    expect(new Set(entries.map((e) => e.h)).size).toBe(entries.length);
    for (const e of entries) {
      expect(Object.keys(e).sort()).toEqual(['enc', 'h', 'len']);
      expect(FINGERPRINT_HASH_PATTERN.test(e.h)).toBe(true);
      expect(e.len).toBeGreaterThanOrEqual(3);
      expect(e.len).toBeLessThanOrEqual(1024);
    }
    const json = JSON.stringify(entries);
    for (const part of ['Иван', 'Петров', 'example', 'Example']) expect(json).not.toContain(part);
  });

  it('an invalid salt or an empty value gives nothing', () => {
    expect(computeFieldFingerprints('email', 'user@example.com', 'bad')).toEqual([]);
    expect(computeFieldFingerprints('email', '', SALT)).toEqual([]);
  });
});
