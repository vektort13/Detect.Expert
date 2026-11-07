// ADR-020 §B (S07): variants of one typed value (ISOLATED world only; the text never leaves it). The SW receives only
// keyed fingerprints of these variants. Order is priority (the list is cut at maxVariantsPerField):
//   1. base forms as typed (`plain`: trimmed, and raw when it differs),
//   2. normalized base forms (`plain-normalized`: lower case; phone digits, `+`digits and country forms; name without
//      punctuation, with and without spaces),
//   3. hashes of the canonical forms (email trim+lower; phone digits and `+`digits; name lower and lower without
//      spaces): MD5 / SHA-1 / SHA-256 / SHA-512 as lowercase hex, Base64 and Base64 without `=`,
//   4. encodings of the base forms (URL-encoded with %20 and with +, Base64, base64url).
// Plain forms and their encodings need a base of at least plaintextMinChars characters; hashes need a canonical form
// of at least hashMinChars. Variants shorter than minFingerprintLen or longer than maxFingerprintLen are dropped.

import { PROTECT_BUDGETS, PROTECT_WIRE_LIMITS } from '@detect-expert/contracts';
import type { FieldKind, FingerprintEncoding } from '@detect-expert/contracts';
import thresholds from '../thresholds/form-leak.v1.json';
import { toBase64, toHex, utf8Bytes } from './hash/bytes';
import { md5 } from './hash/md5';
import { sha1 } from './hash/sha1';
import { sha256 } from './hash/sha256';
import { sha512 } from './hash/sha512';
import { isMultiWord } from './tokens';

export interface ValueVariant {
  enc: FingerprintEncoding;
  text: string;
  /** Contains a token separator: found only by a rolling window, never as one token. */
  multiword: boolean;
}

export const HASH_ALGORITHMS = ['sha256', 'md5', 'sha1', 'sha512'] as const;
export type HashAlgorithm = (typeof HASH_ALGORITHMS)[number];

const HASHERS: Readonly<Record<HashAlgorithm, (bytes: Uint8Array) => Uint8Array>> = { md5, sha1, sha256, sha512 };

const PLAINTEXT_MIN = Math.max(thresholds.plaintextMinChars, PROTECT_BUDGETS.plaintextMinChars);
const HASH_MIN = Math.max(thresholds.hashMinChars, PROTECT_BUDGETS.minValueChars);

interface Base {
  text: string;
  enc: 'plain' | 'plain-normalized';
}

/** Name without punctuation (letters, digits and whitespace kept), lower case. */
function nameLetters(lower: string): string {
  return lower.replace(/[^\p{L}\p{N}\s]/gu, '');
}

function digitsOf(text: string): string {
  return text.replace(/[^0-9]/g, '');
}

/** Phone digits in the international form when the national form is unambiguous (8XXXXXXXXXX → 7XXXXXXXXXX). */
function internationalDigits(digits: string): string {
  return digits.length === 11 && digits.startsWith('8') ? '7' + digits.slice(1) : digits;
}

function baseForms(kind: FieldKind, raw: string): Base[] {
  const trim = raw.trim();
  const out: Base[] = [{ text: trim, enc: 'plain' }];
  if (raw !== trim) out.push({ text: raw, enc: 'plain' });
  const lower = trim.toLowerCase();
  out.push({ text: lower, enc: 'plain-normalized' });
  if (kind === 'phone') {
    const d = digitsOf(trim);
    if (d.length > 0) {
      out.push({ text: d, enc: 'plain-normalized' }, { text: '+' + d, enc: 'plain-normalized' });
      if (d.length === 11 && d.startsWith('8')) {
        const rest = d.slice(1);
        out.push({ text: '7' + rest, enc: 'plain-normalized' }, { text: '+7' + rest, enc: 'plain-normalized' });
      } else if (d.length === 10) {
        for (const cc of ['7', '1']) out.push({ text: cc + d, enc: 'plain-normalized' }, { text: '+' + cc + d, enc: 'plain-normalized' });
      }
    }
  } else if (kind === 'name') {
    const letters = nameLetters(lower);
    out.push({ text: letters.replace(/\s+/g, ''), enc: 'plain-normalized' });
    out.push({ text: letters.replace(/\s+/g, ' ').trim(), enc: 'plain-normalized' });
  }
  return out;
}

/** Canonical forms that are hashed (ADR-020 §B): what pixels and ad platforms normalize before hashing. */
function canonicalForms(kind: FieldKind, raw: string): string[] {
  const lower = raw.trim().toLowerCase();
  switch (kind) {
    case 'email':
      return [lower];
    case 'phone': {
      const d = internationalDigits(digitsOf(lower));
      return d.length === 0 ? [] : [d, '+' + d];
    }
    case 'name':
      return [lower, nameLetters(lower).replace(/\s+/g, '')];
  }
}

function urlEncoded(text: string): string | null {
  try {
    return encodeURIComponent(text);
  } catch {
    return null; // a lone surrogate
  }
}

/**
 * Variants of `raw` for a field of `kind`, in priority order, unique by text, at most maxVariantsPerField. Pure; the
 * caller keeps nothing of the result after fingerprinting it.
 */
export function buildVariants(kind: FieldKind, raw: string): ValueVariant[] {
  const out: ValueVariant[] = [];
  const seen = new Set<string>();
  const max = PROTECT_BUDGETS.maxVariantsPerField;
  const add = (enc: FingerprintEncoding, text: string): void => {
    if (out.length >= max || seen.has(text)) return;
    if (text.length < PROTECT_WIRE_LIMITS.minFingerprintLen || text.length > PROTECT_WIRE_LIMITS.maxFingerprintLen) return;
    seen.add(text);
    out.push({ enc, text, multiword: isMultiWord(text) });
  };
  const bases = baseForms(kind, raw).filter((b) => b.text.length >= PLAINTEXT_MIN);
  // 1–2. Base forms (as typed first).
  for (const b of bases) if (b.enc === 'plain') add('plain', b.text);
  for (const b of bases) if (b.enc === 'plain-normalized') add('plain-normalized', b.text);
  // 3. Hashes of the canonical forms.
  const digests: Array<{ algo: HashAlgorithm; bytes: Uint8Array }> = [];
  for (const form of new Set(canonicalForms(kind, raw))) {
    if (form.length < HASH_MIN) continue;
    const input = utf8Bytes(form);
    for (const algo of HASH_ALGORITHMS) digests.push({ algo, bytes: HASHERS[algo](input) });
  }
  for (const d of digests) add((d.algo + '-hex') as FingerprintEncoding, toHex(d.bytes));
  for (const d of digests) add((d.algo + '-base64') as FingerprintEncoding, toBase64(d.bytes));
  for (const d of digests) add((d.algo + '-base64') as FingerprintEncoding, toBase64(d.bytes).replace(/=+$/, ''));
  // 4. Encodings of the base forms.
  for (const b of bases) {
    const enc = urlEncoded(b.text);
    if (enc !== null) {
      add('url-encoded', enc);
      add('url-encoded', enc.replace(/%20/g, '+'));
    }
    const bytes = utf8Bytes(b.text);
    add('base64', toBase64(bytes));
    add('base64', toBase64(bytes, true));
  }
  return out;
}
