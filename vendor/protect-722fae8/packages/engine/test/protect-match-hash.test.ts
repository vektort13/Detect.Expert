// ADR-020 §B (S07): own synchronous MD5 / SHA-1 / SHA-256 / SHA-512 (SP-13: no crypto.subtle in ISOLATED on http
// pages). Published vectors (RFC 1321 §A.5, FIPS 180-2 appendices / NIST examples) and node:crypto as the oracle for
// Cyrillic, emoji, lone surrogates and every padding boundary.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fromBase64, md5, sha1, sha256, sha512, toBase64, toHex, utf8Bytes } from '../src/protect/match/index';

const hex = (f: (b: Uint8Array) => Uint8Array, s: string): string => toHex(f(utf8Bytes(s)));

describe('MD5 (RFC 1321 §A.5)', () => {
  it.each([
    ['', 'd41d8cd98f00b204e9800998ecf8427e'],
    ['a', '0cc175b9c0f1b6a831c399e269772661'],
    ['abc', '900150983cd24fb0d6963f7d28e17f72'],
    ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
    ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
    ['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 'd174ab98d277d9f5a5611c2c9f419d9f'],
    ['1234567890'.repeat(8), '57edf4a22be3c955ac49da2e2107b67a'],
  ])('md5(%j)', (input, expected) => expect(hex(md5, input)).toBe(expected));
});

describe('SHA-1 / SHA-256 / SHA-512 (FIPS 180 examples)', () => {
  const two = 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq';
  const four = 'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu';
  it('SHA-1', () => {
    expect(hex(sha1, 'abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(hex(sha1, '')).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
    expect(hex(sha1, two)).toBe('84983e441c3bd26ebaae4aa1f95129e5e54670f1');
  });
  it('SHA-256', () => {
    expect(hex(sha256, 'abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hex(sha256, '')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(hex(sha256, two)).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });
  it('SHA-512', () => {
    expect(hex(sha512, 'abc')).toBe(
      'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
    );
    expect(hex(sha512, '')).toBe(
      'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e',
    );
    expect(hex(sha512, four)).toBe(
      '8e959b75dae313da8cf4f72814fc143f8f7779c6eb9f7fa17299aeadb6889018501d289e4900f7e4331b99dec4b5433ac7d329eeb6dd26545e96e55b874be909',
    );
  });
});

describe('against node:crypto (UTF-8, padding boundaries)', () => {
  const inputs = ['Анна Иванова', 'пользователь@пример.рф', '😀 emoji', 'a\uD800b', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'x'.repeat(111), 'x'.repeat(112), 'x'.repeat(128), 'y'.repeat(1000)];
  for (const algo of ['md5', 'sha1', 'sha256', 'sha512'] as const) {
    const f = { md5, sha1, sha256, sha512 }[algo];
    it(algo, () => {
      for (const s of inputs) {
        const ref = createHash(algo).update(Buffer.from(new TextEncoder().encode(s))).digest();
        expect(toHex(f(utf8Bytes(s))), algo + ' ' + JSON.stringify(s.slice(0, 12))).toBe(ref.toString('hex'));
        expect(toBase64(f(utf8Bytes(s)))).toBe(ref.toString('base64'));
      }
    });
  }
  it('utf8Bytes equals TextEncoder (lone surrogates become U+FFFD)', () => {
    for (const s of inputs) expect([...utf8Bytes(s)]).toEqual([...new TextEncoder().encode(s)]);
  });
  it('Base64 / base64url round trip and rejection of non-Base64', () => {
    for (const s of inputs) {
      const b = utf8Bytes(s);
      expect(toBase64(b)).toBe(Buffer.from(b).toString('base64'));
      expect(toBase64(b, true)).toBe(Buffer.from(b).toString('base64url'));
      expect([...(fromBase64(toBase64(b)) ?? [])]).toEqual([...b]);
      expect([...(fromBase64(toBase64(b, true)) ?? [])]).toEqual([...b]);
    }
    expect(fromBase64('abc$')).toBeNull();
    expect(fromBase64('abcde')).toBeNull();
  });
});
