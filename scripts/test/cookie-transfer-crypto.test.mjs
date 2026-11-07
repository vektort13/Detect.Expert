import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptCookieTransfer, decryptCookieTransfer, isEncryptedCookieTransfer } from '../../apps/production-extension/cookie-transfer-crypto.js';

const safe = code => error => error.code === code && error.message === code;
test('encrypted cookie files preserve Unicode/empty values; fresh random IV/salt per file', async () => {
  const text = '{"cookies":[{"value":""},{"value":"кириллица 🍪 %20"}]}\n';
  const first = await encryptCookieTransfer(text, 'test fixture');
  const second = await encryptCookieTransfer(text, 'test fixture');
  assert.equal(isEncryptedCookieTransfer(first), true); assert.notEqual(first, second);
  assert.equal(await decryptCookieTransfer(first, 'test fixture'), text);
  assert.equal(first.includes('кириллица'), false);
});
test('wrong password, modified ciphertext, and modified authenticated header never yield plaintext', async () => {
  const file = await encryptCookieTransfer('owned-cookie-fixture', 'password');
  await assert.rejects(decryptCookieTransfer(file, 'wrong'), safe('decryption-failed'));
  const changed = JSON.parse(file); changed.ciphertext = (changed.ciphertext[0] === 'A' ? 'B' : 'A') + changed.ciphertext.slice(1);
  await assert.rejects(decryptCookieTransfer(JSON.stringify(changed), 'password'), safe('decryption-failed'));
  changed.iterations = 1;
  await assert.rejects(decryptCookieTransfer(JSON.stringify(changed), 'password'), safe('invalid-encrypted'));
});
test('strict envelope rejects duplicate keys, unknown fields, noncanonical base64 and unbounded work', async () => {
  const file = await encryptCookieTransfer('', 'password'); const data = JSON.parse(file);
  for (const text of [file.replace('"iterations": 600000', '"iterations": 600000,"iterations": 600000'),
    JSON.stringify({ ...data, extra: true }), JSON.stringify({ ...data, salt: data.salt.replace(/=+$/, '') }),
    JSON.stringify({ ...data, formatVersion: 2 }), JSON.stringify({ ...data, iterations: 1000000000 })]) {
    await assert.rejects(decryptCookieTransfer(text, 'password'), safe('invalid-encrypted'));
  }
  await assert.rejects(encryptCookieTransfer('x', ''), safe('invalid-password'));
  await assert.rejects(encryptCookieTransfer('x'.repeat(16 * 1024 * 1024 + 1), 'p'), safe('too-large'));
});
test('unsupported WebCrypto does not fall back to plaintext', async () => {
  await assert.rejects(encryptCookieTransfer('fixture', 'password', { cryptoProvider: {} }), safe('unsupported-crypto'));
  assert.equal(isEncryptedCookieTransfer('{"cookies":[]}'), false);
});
test('setup failures clear allocated buffers and never derive or output a file', async () => {
  const buffers = [], original = TextEncoder.prototype.encode;
  TextEncoder.prototype.encode = function (value) { const bytes = Reflect.apply(original, this, [value]); buffers.push(bytes); return bytes; };
  try {
    const cryptoProvider = { subtle: { deriveKey() { throw Error('must not derive'); } }, getRandomValues(bytes) { bytes.fill(31); buffers.push(bytes); throw Error('owned injected CSPRNG failure'); } };
    await assert.rejects(encryptCookieTransfer('owned plaintext fixture', 'owned password fixture', { cryptoProvider }), safe('unsupported-crypto'));
    assert.ok(buffers.length >= 3); for (const bytes of buffers) assert.equal(bytes.every(byte => byte === 0), true);
    buffers.length = 0;
    await assert.rejects(encryptCookieTransfer('owned plaintext fixture', '', { cryptoProvider }), safe('invalid-password'));
    assert.equal(buffers.length, 0, 'invalid password is rejected before allocating plaintext');
  } finally { TextEncoder.prototype.encode = original; }
});
