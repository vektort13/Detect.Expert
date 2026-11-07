// ADR-020 §B (S07): keyed fingerprints of value variants. ISOLATED (packages/collector/src/protect/session.ts) calls
// computeFieldFingerprints with the value read by field-value.ts and the SW salt; only `{enc, len, h}` leaves the
// world. The SW (value-match service) uses the same keyed hash over request tokens and rolling windows.

import { PROTECT_BUDGETS } from '@detect-expert/contracts';
import type { FieldKind, ProtectFingerprintEntry } from '@detect-expert/contracts';
import { fingerprintKey, fpHex, fpRange } from './fingerprint';
import { buildVariants } from './variants';

export { FP_PRIME_1, FP_PRIME_2, fingerprintKey, fp, fpFromHex, fpHex, fpPair, fpRange, rolling, rollingParams, rollingScan } from './fingerprint';
export type { FingerprintKey, RollingParams, RollingWindow } from './fingerprint';
export { HASH_ALGORITHMS, buildVariants } from './variants';
export type { HashAlgorithm, ValueVariant } from './variants';
export { isBase64Char, isHexChar, isMultiWord, isTokenChar } from './tokens';
export { base64Digit, fromBase64, toBase64, toHex, utf8Bytes } from './hash/bytes';
export { md5 } from './hash/md5';
export { sha1 } from './hash/sha1';
export { sha256 } from './hash/sha256';
export { sha512 } from './hash/sha512';

/**
 * `{enc, len, h}` of every variant of `value` (≤ maxVariantsPerField, unique h): `len` is the variant length in UTF-16
 * code units, `h` its 13-hex keyed fingerprint under `salt`. An invalid salt or an empty result returns []. The value
 * and its variants are not retained.
 */
export function computeFieldFingerprints(kind: FieldKind, value: string, salt: string): ProtectFingerprintEntry[] {
  if (typeof value !== 'string' || value.length === 0) return [];
  let key;
  try {
    key = fingerprintKey(salt);
  } catch {
    return [];
  }
  const out: ProtectFingerprintEntry[] = [];
  const seen = new Set<number>();
  for (const v of buildVariants(kind, value)) {
    const h = fpRange(key, v.text, 0, v.text.length);
    if (seen.has(h)) continue;
    seen.add(h);
    out.push({ enc: v.enc, len: v.text.length, h: fpHex(h) });
    if (out.length >= PROTECT_BUDGETS.maxVariantsPerField) break;
  }
  return out;
}
