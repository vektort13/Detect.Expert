// ADR-020 §B (S07): SHA-1 (FIPS 180-4) over bytes, synchronous (SP-13). Only for value variants.

/** Big-endian 32-bit words of the padded message (FIPS 180-4 §5.1.1). Shared by SHA-1 and SHA-256. */
export function padBigEndian32(bytes: Uint8Array): Int32Array {
  const n = bytes.length;
  const blocks = ((n + 8) >>> 6) + 1;
  const m = new Int32Array(blocks * 16);
  for (let i = 0; i < n; i++) m[i >> 2] = m[i >> 2]! | (bytes[i]! << (24 - (i & 3) * 8));
  m[n >> 2] = m[n >> 2]! | (0x80 << (24 - (n & 3) * 8));
  m[blocks * 16 - 1] = (n * 8) | 0;
  m[blocks * 16 - 2] = Math.floor(n / 0x20000000) | 0;
  return m;
}

export function wordsToBytes(words: readonly number[]): Uint8Array {
  const out = new Uint8Array(words.length * 4);
  for (let w = 0; w < words.length; w++) {
    const v = words[w]!;
    out[w * 4] = (v >>> 24) & 0xff;
    out[w * 4 + 1] = (v >>> 16) & 0xff;
    out[w * 4 + 2] = (v >>> 8) & 0xff;
    out[w * 4 + 3] = v & 0xff;
  }
  return out;
}

/** SHA-1 digest (20 bytes). */
export function sha1(bytes: Uint8Array): Uint8Array {
  const m = padBigEndian32(bytes);
  const w = new Int32Array(80);
  let h0 = 0x67452301 | 0;
  let h1 = 0xefcdab89 | 0;
  let h2 = 0x98badcfe | 0;
  let h3 = 0x10325476 | 0;
  let h4 = 0xc3d2e1f0 | 0;
  for (let off = 0; off < m.length; off += 16) {
    for (let t = 0; t < 16; t++) w[t] = m[off + t]!;
    for (let t = 16; t < 80; t++) {
      const x = w[t - 3]! ^ w[t - 8]! ^ w[t - 14]! ^ w[t - 16]!;
      w[t] = (x << 1) | (x >>> 31);
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let t = 0; t < 80; t++) {
      let f: number;
      let k: number;
      if (t < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (t < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (t < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc | 0;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6 | 0;
      }
      const tmp = (((a << 5) | (a >>> 27)) + f + e + k + w[t]!) | 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = tmp;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }
  return wordsToBytes([h0, h1, h2, h3, h4]);
}
