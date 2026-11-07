// ADR-020 §B (S07): byte helpers of the value-variant hashes. Pure and synchronous: the ISOLATED world of an http page
// has no crypto.subtle (SP-13), so UTF-8, hex and Base64 are done here. Nothing is retained between calls.

/** UTF-8 bytes of a JS string (WHATWG encode: a lone surrogate becomes U+FFFD, as TextEncoder does). */
export function utf8Bytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 3);
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (next - 0xdc00);
        i++;
      } else c = 0xfffd;
    } else if (c >= 0xdc00 && c <= 0xdfff) c = 0xfffd;
    if (c < 0x80) out[n++] = c;
    else if (c < 0x800) {
      out[n++] = 0xc0 | (c >> 6);
      out[n++] = 0x80 | (c & 63);
    } else if (c < 0x10000) {
      out[n++] = 0xe0 | (c >> 12);
      out[n++] = 0x80 | ((c >> 6) & 63);
      out[n++] = 0x80 | (c & 63);
    } else {
      out[n++] = 0xf0 | (c >> 18);
      out[n++] = 0x80 | ((c >> 12) & 63);
      out[n++] = 0x80 | ((c >> 6) & 63);
      out[n++] = 0x80 | (c & 63);
    }
  }
  return out.subarray(0, n);
}

const HEX = '0123456789abcdef';

export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    s += HEX[b >> 4]! + HEX[b & 15]!;
  }
  return s;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Base64 (RFC 4648 §4, with `=` padding) or base64url (§5, without padding). */
export function toBase64(bytes: Uint8Array, url = false): string {
  const alphabet = url ? B64URL : B64;
  let s = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const v = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    s += alphabet[v >> 18]! + alphabet[(v >> 12) & 63]! + alphabet[(v >> 6) & 63]! + alphabet[v & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const v = bytes[i]! << 16;
    s += alphabet[v >> 18]! + alphabet[(v >> 12) & 63]! + (url ? '' : '==');
  } else if (rest === 2) {
    const v = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    s += alphabet[v >> 18]! + alphabet[(v >> 12) & 63]! + alphabet[(v >> 6) & 63]! + (url ? '' : '=');
  }
  return s;
}

/** Value of one Base64 or base64url character, or -1. */
export function base64Digit(c: number): number {
  if (c >= 65 && c <= 90) return c - 65;
  if (c >= 97 && c <= 122) return c - 71;
  if (c >= 48 && c <= 57) return c + 4;
  if (c === 43 || c === 45) return 62; // + or -
  if (c === 47 || c === 95) return 63; // / or _
  return -1;
}

/**
 * Bytes of a Base64 / base64url string (padding optional), or null when it is not one (a stray character or a
 * length of 4n+1). At most `maxChars` characters are decoded.
 */
export function fromBase64(text: string, maxChars = 65536): Uint8Array | null {
  let end = Math.min(text.length, maxChars);
  while (end > 0 && text.charCodeAt(end - 1) === 61) end--;
  if (end % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((end * 3) / 4));
  let n = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < end; i++) {
    const d = base64Digit(text.charCodeAt(i));
    if (d < 0) return null;
    acc = ((acc << 6) | d) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, n);
}
