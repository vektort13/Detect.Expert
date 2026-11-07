// ADR-020 §B (S07): SHA-512 (FIPS 180-4) over bytes, synchronous (SP-13). 64-bit words as (hi, lo) pairs of
// 32-bit integers; additions accumulate the low halves as doubles (exact below 2^53) and carry into the high halves.

// First 64 bits of the fractional parts of the cube roots of the first 80 primes, as hi, lo (FIPS 180-4 §4.2.3).
const K = /* @__PURE__ */ Int32Array.from([
  0x428a2f98, 0xd728ae22, 0x71374491, 0x23ef65cd, 0xb5c0fbcf, 0xec4d3b2f, 0xe9b5dba5, 0x8189dbbc,
  0x3956c25b, 0xf348b538, 0x59f111f1, 0xb605d019, 0x923f82a4, 0xaf194f9b, 0xab1c5ed5, 0xda6d8118,
  0xd807aa98, 0xa3030242, 0x12835b01, 0x45706fbe, 0x243185be, 0x4ee4b28c, 0x550c7dc3, 0xd5ffb4e2,
  0x72be5d74, 0xf27b896f, 0x80deb1fe, 0x3b1696b1, 0x9bdc06a7, 0x25c71235, 0xc19bf174, 0xcf692694,
  0xe49b69c1, 0x9ef14ad2, 0xefbe4786, 0x384f25e3, 0x0fc19dc6, 0x8b8cd5b5, 0x240ca1cc, 0x77ac9c65,
  0x2de92c6f, 0x592b0275, 0x4a7484aa, 0x6ea6e483, 0x5cb0a9dc, 0xbd41fbd4, 0x76f988da, 0x831153b5,
  0x983e5152, 0xee66dfab, 0xa831c66d, 0x2db43210, 0xb00327c8, 0x98fb213f, 0xbf597fc7, 0xbeef0ee4,
  0xc6e00bf3, 0x3da88fc2, 0xd5a79147, 0x930aa725, 0x06ca6351, 0xe003826f, 0x14292967, 0x0a0e6e70,
  0x27b70a85, 0x46d22ffc, 0x2e1b2138, 0x5c26c926, 0x4d2c6dfc, 0x5ac42aed, 0x53380d13, 0x9d95b3df,
  0x650a7354, 0x8baf63de, 0x766a0abb, 0x3c77b2a8, 0x81c2c92e, 0x47edaee6, 0x92722c85, 0x1482353b,
  0xa2bfe8a1, 0x4cf10364, 0xa81a664b, 0xbc423001, 0xc24b8b70, 0xd0f89791, 0xc76c51a3, 0x0654be30,
  0xd192e819, 0xd6ef5218, 0xd6990624, 0x5565a910, 0xf40e3585, 0x5771202a, 0x106aa070, 0x32bbd1b8,
  0x19a4c116, 0xb8d2d0c8, 0x1e376c08, 0x5141ab53, 0x2748774c, 0xdf8eeb99, 0x34b0bcb5, 0xe19b48a8,
  0x391c0cb3, 0xc5c95a63, 0x4ed8aa4a, 0xe3418acb, 0x5b9cca4f, 0x7763e373, 0x682e6ff3, 0xd6b2b8a3,
  0x748f82ee, 0x5defb2fc, 0x78a5636f, 0x43172f60, 0x84c87814, 0xa1f0ab72, 0x8cc70208, 0x1a6439ec,
  0x90befffa, 0x23631e28, 0xa4506ceb, 0xde82bde9, 0xbef9a3f7, 0xb2c67915, 0xc67178f2, 0xe372532b,
  0xca273ece, 0xea26619c, 0xd186b8c7, 0x21c0c207, 0xeada7dd6, 0xcde0eb1e, 0xf57d4f7f, 0xee6ed178,
  0x06f067aa, 0x72176fba, 0x0a637dc5, 0xa2c898a6, 0x113f9804, 0xbef90dae, 0x1b710b35, 0x131c471b,
  0x28db77f5, 0x23047d84, 0x32caab7b, 0x40c72493, 0x3c9ebe0a, 0x15c9bebc, 0x431d67c4, 0x9c100d4c,
  0x4cc5d4be, 0xcb3e42b6, 0x597f299c, 0xfc657e2a, 0x5fcb6fab, 0x3ad6faec, 0x6c44198c, 0x4a475817,
]);

const H0 = /* @__PURE__ */ Int32Array.from([
  0x6a09e667, 0xf3bcc908, 0xbb67ae85, 0x84caa73b, 0x3c6ef372, 0xfe94f82b, 0xa54ff53a, 0x5f1d36f1,
  0x510e527f, 0xade682d1, 0x9b05688c, 0x2b3e6c1f, 0x1f83d9ab, 0xfb41bd6b, 0x5be0cd19, 0x137e2179,
]);

const TWO32 = 0x100000000;

/** High half of rotr64((h, l), n) for 0 < n < 64, n ≠ 32. */
function rotrHi(h: number, l: number, n: number): number {
  return n < 32 ? (h >>> n) | (l << (32 - n)) : (l >>> (n - 32)) | (h << (64 - n));
}

function rotrLo(h: number, l: number, n: number): number {
  return n < 32 ? (l >>> n) | (h << (32 - n)) : (h >>> (n - 32)) | (l << (64 - n));
}

/** SHA-512 digest (64 bytes). Inputs up to 2^29 bytes. */
export function sha512(bytes: Uint8Array): Uint8Array {
  const n = bytes.length;
  const blocks = ((n + 16) >>> 7) + 1;
  const m = new Int32Array(blocks * 32);
  for (let i = 0; i < n; i++) m[i >> 2] = m[i >> 2]! | (bytes[i]! << (24 - (i & 3) * 8));
  m[n >> 2] = m[n >> 2]! | (0x80 << (24 - (n & 3) * 8));
  m[blocks * 32 - 1] = (n * 8) | 0;
  m[blocks * 32 - 2] = Math.floor(n / 0x20000000) | 0;
  const w = new Int32Array(160);
  const h = Int32Array.from(H0);
  for (let off = 0; off < m.length; off += 32) {
    for (let t = 0; t < 32; t++) w[t] = m[off + t]!;
    for (let t = 16; t < 80; t++) {
      const xh = w[(t - 15) * 2]!;
      const xl = w[(t - 15) * 2 + 1]!;
      const yh = w[(t - 2) * 2]!;
      const yl = w[(t - 2) * 2 + 1]!;
      // σ0 = rotr1 ^ rotr8 ^ shr7; σ1 = rotr19 ^ rotr61 ^ shr6
      const s0h = rotrHi(xh, xl, 1) ^ rotrHi(xh, xl, 8) ^ (xh >>> 7);
      const s0l = rotrLo(xh, xl, 1) ^ rotrLo(xh, xl, 8) ^ ((xl >>> 7) | (xh << 25));
      const s1h = rotrHi(yh, yl, 19) ^ rotrHi(yh, yl, 61) ^ (yh >>> 6);
      const s1l = rotrLo(yh, yl, 19) ^ rotrLo(yh, yl, 61) ^ ((yl >>> 6) | (yh << 26));
      const lo = (w[(t - 16) * 2 + 1]! >>> 0) + (s0l >>> 0) + (w[(t - 7) * 2 + 1]! >>> 0) + (s1l >>> 0);
      const hi = w[(t - 16) * 2]! + s0h + w[(t - 7) * 2]! + s1h + Math.floor(lo / TWO32);
      w[t * 2] = hi | 0;
      w[t * 2 + 1] = lo | 0;
    }
    let ah = h[0]!, al = h[1]!, bh = h[2]!, bl = h[3]!, ch = h[4]!, cl = h[5]!, dh = h[6]!, dl = h[7]!;
    let eh = h[8]!, el = h[9]!, fh = h[10]!, fl = h[11]!, gh = h[12]!, gl = h[13]!, hh = h[14]!, hl = h[15]!;
    for (let t = 0; t < 80; t++) {
      // Σ1(e) = rotr14 ^ rotr18 ^ rotr41; ch = (e & f) ^ (~e & g)
      const S1h = rotrHi(eh, el, 14) ^ rotrHi(eh, el, 18) ^ rotrHi(eh, el, 41);
      const S1l = rotrLo(eh, el, 14) ^ rotrLo(eh, el, 18) ^ rotrLo(eh, el, 41);
      const chh = (eh & fh) ^ (~eh & gh);
      const chl = (el & fl) ^ (~el & gl);
      const t1l = (hl >>> 0) + (S1l >>> 0) + (chl >>> 0) + (K[t * 2 + 1]! >>> 0) + (w[t * 2 + 1]! >>> 0);
      const t1h = (hh + S1h + chh + K[t * 2]! + w[t * 2]! + Math.floor(t1l / TWO32)) | 0;
      const t1lo = t1l | 0;
      // Σ0(a) = rotr28 ^ rotr34 ^ rotr39; maj = (a & b) ^ (a & c) ^ (b & c)
      const S0h = rotrHi(ah, al, 28) ^ rotrHi(ah, al, 34) ^ rotrHi(ah, al, 39);
      const S0l = rotrLo(ah, al, 28) ^ rotrLo(ah, al, 34) ^ rotrLo(ah, al, 39);
      const mjh = (ah & bh) ^ (ah & ch) ^ (bh & ch);
      const mjl = (al & bl) ^ (al & cl) ^ (bl & cl);
      const t2l = (S0l >>> 0) + (mjl >>> 0);
      const t2h = (S0h + mjh + Math.floor(t2l / TWO32)) | 0;
      const t2lo = t2l | 0;
      hh = gh;
      hl = gl;
      gh = fh;
      gl = fl;
      fh = eh;
      fl = el;
      const el2 = (dl >>> 0) + (t1lo >>> 0);
      eh = (dh + t1h + Math.floor(el2 / TWO32)) | 0;
      el = el2 | 0;
      dh = ch;
      dl = cl;
      ch = bh;
      cl = bl;
      bh = ah;
      bl = al;
      const al2 = (t1lo >>> 0) + (t2lo >>> 0);
      ah = (t1h + t2h + Math.floor(al2 / TWO32)) | 0;
      al = al2 | 0;
    }
    const add = (i: number, xh: number, xl: number): void => {
      const lo = (h[i + 1]! >>> 0) + (xl >>> 0);
      h[i] = (h[i]! + xh + Math.floor(lo / TWO32)) | 0;
      h[i + 1] = lo | 0;
    };
    add(0, ah, al);
    add(2, bh, bl);
    add(4, ch, cl);
    add(6, dh, dl);
    add(8, eh, el);
    add(10, fh, fl);
    add(12, gh, gl);
    add(14, hh, hl);
  }
  const out = new Uint8Array(64);
  for (let i = 0; i < 16; i++) {
    const v = h[i]!;
    out[i * 4] = (v >>> 24) & 0xff;
    out[i * 4 + 1] = (v >>> 16) & 0xff;
    out[i * 4 + 2] = (v >>> 8) & 0xff;
    out[i * 4 + 3] = v & 0xff;
  }
  return out;
}
