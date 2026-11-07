// ADR-020 §B (S07): keyed fingerprint of a value variant. A double polynomial hash over UTF-16 code units modulo two
// primes below 2^26 (every product stays below 2^53, so plain doubles are exact). Bases and seeds come from a
// 128-bit salt that lives as long as the service worker (SW memory only): without the salt a fingerprint says
// nothing about the value, and the same value gives different fingerprints in two SW lifetimes. The output is 13 hex
// characters (26 + 26 bits). The same function slides over a text (Rabin–Karp) for multi-word variants.
// Never stored on disk, never in a projection, an export or a log (ADR-020 §4, REQ-005 revision).

import { SALT_PATTERN } from '@detect-expert/contracts';
import { fromBase64 } from './hash/bytes';

/** Moduli of the two lanes: the two largest primes below 2^26 (primality checked in protect-match-fingerprint.test). */
export const FP_PRIME_1 = 67108859;
export const FP_PRIME_2 = 67108837;
const LANE = 0x4000000; // 2^26
const MIN_BASE = 0x10001; // above every UTF-16 code unit + 1

export interface FingerprintKey {
  readonly b1: number;
  readonly b2: number;
  readonly s1: number;
  readonly s2: number;
}

function u32(bytes: Uint8Array, at: number): number {
  return ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0;
}

let cachedSalt: string | null = null;
let cachedKey: FingerprintKey | null = null;

/** Lane parameters of a salt (SALT_PATTERN: 16 bytes base64url). Throws on an invalid salt. Last salt is cached. */
export function fingerprintKey(salt: string): FingerprintKey {
  if (salt === cachedSalt && cachedKey !== null) return cachedKey;
  const bytes = typeof salt === 'string' && SALT_PATTERN.test(salt) ? fromBase64(salt) : null;
  if (bytes === null || bytes.length !== 16) throw new Error('protect: invalid fingerprint salt');
  const key: FingerprintKey = {
    b1: MIN_BASE + (u32(bytes, 0) % (FP_PRIME_1 - MIN_BASE)),
    b2: MIN_BASE + (u32(bytes, 4) % (FP_PRIME_2 - MIN_BASE)),
    s1: u32(bytes, 8) % FP_PRIME_1,
    s2: u32(bytes, 12) % FP_PRIME_2,
  };
  cachedSalt = salt;
  cachedKey = key;
  return key;
}

/** The 52-bit fingerprint as a number (h1 * 2^26 + h2, exact in a double). */
export function fpPair(h1: number, h2: number): number {
  return h1 * LANE + h2;
}

/** 13 lowercase hex characters of a 52-bit fingerprint number (FINGERPRINT_HASH_PATTERN). */
export function fpHex(value: number): string {
  return ('0000000000000' + value.toString(16)).slice(-13);
}

/** Number of a 13-hex fingerprint (parseInt is exact for 52 bits), or -1 for anything else. */
export function fpFromHex(h: string): number {
  if (typeof h !== 'string' || h.length !== 13 || !/^[0-9a-f]{13}$/.test(h)) return -1;
  return parseInt(h, 16);
}

/**
 * Fingerprint number of text[start, end) with an optional ASCII hex lowercasing (A-F → a-f), without a substring.
 * hash = seed·B^len + Σ (c_i + 1)·B^(len−1−i) (mod p) per lane.
 */
export function fpRange(key: FingerprintKey, text: string, start: number, end: number, lowerHex = false): number {
  const { b1, b2 } = key;
  let h1 = key.s1;
  let h2 = key.s2;
  for (let i = start; i < end; i++) {
    let c = text.charCodeAt(i);
    if (lowerHex && c >= 65 && c <= 70) c += 32;
    c += 1;
    h1 = (h1 * b1 + c) % FP_PRIME_1;
    h2 = (h2 * b2 + c) % FP_PRIME_2;
  }
  return fpPair(h1, h2);
}

/** `fp(salt, s)`: the keyed fingerprint of `s` as 13 hex characters. */
export function fp(salt: string, s: string): string {
  return fpHex(fpRange(fingerprintKey(salt), s, 0, s.length));
}

function powMod(base: number, exp: number, mod: number): number {
  let result = 1;
  let b = base % mod;
  let e = exp;
  while (e > 0) {
    if (e & 1) result = (result * b) % mod;
    b = (b * b) % mod;
    e = Math.floor(e / 2);
  }
  return result;
}

export interface RollingWindow {
  /** Start index of the window in the text. */
  index: number;
  /** Fingerprint number of text[index, index + len). */
  value: number;
}

/** Precomputed constants of one window length (seed·B^len and B^(len−1) per lane). */
export interface RollingParams {
  readonly len: number;
  readonly seedTerm1: number;
  readonly seedTerm2: number;
  readonly top1: number;
  readonly top2: number;
}

export function rollingParams(key: FingerprintKey, len: number): RollingParams {
  return {
    len,
    seedTerm1: (key.s1 * powMod(key.b1, len, FP_PRIME_1)) % FP_PRIME_1,
    seedTerm2: (key.s2 * powMod(key.b2, len, FP_PRIME_2)) % FP_PRIME_2,
    top1: powMod(key.b1, len - 1, FP_PRIME_1),
    top2: powMod(key.b2, len - 1, FP_PRIME_2),
  };
}

/**
 * Calls `visit(index, value)` for every window text[index, index + len) of text[start, end), in order; `visit`
 * returning false stops the scan. Each step is O(1): the outgoing character is removed and the incoming one added.
 */
export function rollingScan(key: FingerprintKey, params: RollingParams, text: string, start: number, end: number, visit: (index: number, value: number) => boolean): void {
  const { len } = params;
  if (len <= 0 || end - start < len) return;
  const { b1, b2 } = key;
  // Lane value without the seed term: Σ (c_i + 1)·B^(len−1−i).
  let r1 = 0;
  let r2 = 0;
  for (let i = start; i < start + len; i++) {
    const c = text.charCodeAt(i) + 1;
    r1 = (r1 * b1 + c) % FP_PRIME_1;
    r2 = (r2 * b2 + c) % FP_PRIME_2;
  }
  for (let i = start; ; i++) {
    if (!visit(i, fpPair((r1 + params.seedTerm1) % FP_PRIME_1, (r2 + params.seedTerm2) % FP_PRIME_2))) return;
    const next = i + len;
    if (next >= end) return;
    const out = text.charCodeAt(i) + 1;
    const inc = text.charCodeAt(next) + 1;
    r1 = (((r1 - ((out * params.top1) % FP_PRIME_1) + FP_PRIME_1) % FP_PRIME_1) * b1 + inc) % FP_PRIME_1;
    r2 = (((r2 - ((out * params.top2) % FP_PRIME_2) + FP_PRIME_2) % FP_PRIME_2) * b2 + inc) % FP_PRIME_2;
  }
}

/** `rolling(salt, text, len)`: every window of length `len` with its 13-hex fingerprint (tests, small texts). */
export function* rolling(salt: string, text: string, len: number): Generator<{ index: number; h: string }> {
  const key = fingerprintKey(salt);
  const out: RollingWindow[] = [];
  rollingScan(key, rollingParams(key, len), text, 0, text.length, (index, value) => {
    out.push({ index, value });
    return true;
  });
  for (const w of out) yield { index: w.index, h: fpHex(w.value) };
}
