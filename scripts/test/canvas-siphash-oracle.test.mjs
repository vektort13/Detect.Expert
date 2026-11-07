// ADR-066: independent verification of the duplicated Canvas split-word hash.
// Official vectors: https://github.com/veorq/SipHash/blob/master/vectors.h
import test from 'node:test';
import assert from 'node:assert/strict';
import { installCanvasCustom } from '../../apps/production-extension/api-custom-canvas-runtime.js';

const VECTORS = Object.freeze([
  '726fdb47dd0e0e31','74f839c593dc67fd','0d6c8009d9a94f5a','85676696d7fb7e2d','cf2794e0277187b7','18765564cd99a68d','cbc9466e58fee3ce','ab0200f58b01d137',
  '93f5f5799a932462','9e0082df0ba9e4b0','7a5dbbc594ddb9f3','f4b32f46226bada7','751e8fbc860ee5fb','14ea5627c0843d90','f723ca908e7af2ee','a129ca6149be45e5',
  '3f2acc7f57c29bdb','699ae9f52cbe4794','4bc1b3f0968dd39c','bb6dc91da77961bd','bed65cf21aa2ee98','d0f2cbb02e3b67c7','93536795e3a33e88','a80c038ccd5ccec8',
  'b8ad50c6f649af94','bce192de8a85b8ea','17d835b85bbb15f3','2f2e6163076bcfad','de4daaaca71dc9a5','a6a2506687956571','ad87a3535c49ef28','32d892fad841c342',
  '7127512f72f27cce','a7f32346f95978e3','12e0b01abb051238','15e034d40fa197ae','314dffbe0815a3b4','027990f029623981','cadcd4e59ef40c4d','9abfd8766a33735c',
  '0e3ea96b5304a7d0','ad0c42d6fc585992','187306c89bc215a9','d4a60abcf3792b95','f935451de4f21df2','a9538f0419755787','db9acddff56ca510','d06c98cd5c0975eb',
  'e612a3cb9ecba951','c766e62cfcadaf96','ee64435a9752fe72','a192d576b245165a','0a8787bf8ecb74b2','81b3e73d20b49b6f','7fa8220ba3b2ecea','245731c13ca42499',
  'b78dbfaf3a8d83bd','ea1ad565322a1a0b','60e61c23a3795013','6606d7e446282b93','6ca4ecb15c5f91e1','9f626da15c9625f3','e51b38608ef25f57','958a324ceb064572'
]);

function canvasHash() {
  const absent = {}; installCanvasCustom(absent, []); assert.deepEqual(absent, {});
  // The exported installer is private in the page bootstrap. This Node-only
  // import reads its existing cache; no production handle or export is added.
  return installCanvasCustom.__detectExpertCanvasIntrinsicsV1.sipHash24;
}
const MASK = (1n << 64n) - 1n;
const rotate = (value, bits) => ((value << BigInt(bits)) | (value >> BigInt(64 - bits))) & MASK;
function reference(bytes, key) {
  const k0 = BigInt(key[0]) | BigInt(key[1]) << 32n, k1 = BigInt(key[2]) | BigInt(key[3]) << 32n;
  const state = [k0 ^ 0x736f6d6570736575n, k1 ^ 0x646f72616e646f6dn, k0 ^ 0x6c7967656e657261n, k1 ^ 0x7465646279746573n];
  function round() {
    state[0] = (state[0] + state[1]) & MASK; state[1] = rotate(state[1], 13) ^ state[0]; state[0] = rotate(state[0], 32);
    state[2] = (state[2] + state[3]) & MASK; state[3] = rotate(state[3], 16) ^ state[2];
    state[0] = (state[0] + state[3]) & MASK; state[3] = rotate(state[3], 21) ^ state[0];
    state[2] = (state[2] + state[1]) & MASK; state[1] = rotate(state[1], 17) ^ state[2]; state[2] = rotate(state[2], 32);
  }
  let position = 0;
  while (position + 8 <= bytes.length) {
    let word = 0n;
    for (let offset = 0; offset < 8; offset++) word |= BigInt(bytes[position + offset]) << BigInt(8 * offset);
    state[3] ^= word; round(); round(); state[0] ^= word; position += 8;
  }
  let tail = BigInt(bytes.length & 255) << 56n;
  for (let offset = 0; position + offset < bytes.length; offset++) tail |= BigInt(bytes[position + offset]) << BigInt(8 * offset);
  state[3] ^= tail; round(); round(); state[0] ^= tail; state[2] ^= 255n;
  round(); round(); round(); round(); return state[0] ^ state[1] ^ state[2] ^ state[3];
}

test('Canvas SipHash-2-4 matches all 64 published vectors with correct byte order', () => {
  const hash = canvasHash(), output = new Uint32Array(2); assert.equal(VECTORS.length, 64);
  for (let length = 0; length < VECTORS.length; length++) {
    hash(Uint8Array.from({ length }, (_, index) => index), 0x03020100, 0x07060504, 0x0b0a0908, 0x0f0e0d0c, output);
    const hex = output[1].toString(16).padStart(8, '0') + output[0].toString(16).padStart(8, '0');
    assert.equal(hex, VECTORS[length], 'published message length ' + length);
  }
});

test('Canvas split-word hash matches 45 independent BigInt cases across length and carry boundaries', () => {
  const hash = canvasHash(), output = new Uint32Array(2);
  const keys = [[0, 0, 0, 0], [0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff], [0xcafebabe, 0x88776655, 0x80000000, 0x12345678]];
  const lengths = [0, 1, 7, 8, 9, 63, 64, 127, 255, 256, 257, 511, 512, 4095, 4118];
  assert.equal(keys.length * lengths.length, 45);
  for (const key of keys) for (const length of lengths) {
    const bytes = Uint8Array.from({ length }, (_, index) => (index * 197 + 251) & 255);
    hash(bytes, ...key, output);
    assert.equal(BigInt(output[0]) | BigInt(output[1]) << 32n, reference(bytes, key), 'length=' + length + ', key=' + key);
  }
});
