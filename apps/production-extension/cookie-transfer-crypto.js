// ADR-069: local, user-commanded file encryption. No storage, bridge, network or native cookie reads.
import { parseCookieJson } from './cookie-transfer-core.js';

const FORMAT = 'detect.expert.cookies.encrypted';
const VERSION = 1;
const ITERATIONS = 600000;
const MAX_PLAIN = 16 * 1024 * 1024;
const MAX_FILE = 22 * 1024 * 1024;
const HEADER = { format: FORMAT, formatVersion: VERSION, cipher: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iterations: ITERATIONS };
const AAD = new TextEncoder().encode(JSON.stringify(HEADER));
const encoder = new TextEncoder();

export class CookieTransferCryptoError extends Error {
  constructor(code) { super(code); this.name = 'CookieTransferCryptoError'; this.code = code; }
}
const fail = code => { throw new CookieTransferCryptoError(code); };
function provider(options) {
  const api = options?.cryptoProvider ?? globalThis.crypto;
  if (typeof api?.getRandomValues !== 'function' || typeof api?.subtle?.deriveKey !== 'function') fail('unsupported-crypto');
  return api;
}
function passwordBytes(password) {
  if (typeof password !== 'string' || password.length === 0 || password.length > 1024) fail('invalid-password');
  return encoder.encode(password);
}
function encode64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}
function decode64(value, min, max) {
  if (typeof value !== 'string' || value.length > Math.ceil(max / 3) * 4 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) fail('invalid-encrypted');
  let bytes;
  try { bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0)); } catch { fail('invalid-encrypted'); }
  if (bytes.length < min || bytes.length > max || encode64(bytes) !== value) fail('invalid-encrypted');
  return bytes;
}
async function derive(api, bytes, salt, usage) {
  const key = await api.subtle.importKey('raw', bytes, 'PBKDF2', false, ['deriveKey']);
  return api.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key,
    { name: 'AES-GCM', length: 256 }, false, [usage]);
}
function envelope(text) {
  if (typeof text !== 'string' || text.length > MAX_FILE) fail('too-large');
  let data;
  try { data = parseCookieJson(text, { maxBytes: MAX_FILE }); } catch { fail('invalid-encrypted'); }
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).sort().join(',') !== 'cipher,ciphertext,format,formatVersion,iterations,iv,kdf,salt') fail('invalid-encrypted');
  if (Object.entries(HEADER).some(([key, value]) => data[key] !== value)) fail('invalid-encrypted');
  return { salt: decode64(data.salt, 16, 16), iv: decode64(data.iv, 12, 12), ciphertext: decode64(data.ciphertext, 16, MAX_PLAIN + 16) };
}
export function isEncryptedCookieTransfer(text) {
  if (typeof text !== 'string' || text.length > MAX_FILE) return false;
  // Detection only; decryption performs strict whole-envelope validation before deriving a key.
  return /"format"\s*:\s*"detect\.expert\.cookies\.encrypted"/.test(text);
}
export async function encryptCookieTransfer(text, password, options) {
  if (typeof text !== 'string' || text.length > MAX_PLAIN) fail('too-large');
  let plain = null, bytes = null, salt = null, iv = null;
  try {
    const api = provider(options); bytes = passwordBytes(password); plain = encoder.encode(text);
    if (plain.length > MAX_PLAIN) fail('too-large');
    salt = new Uint8Array(16); iv = new Uint8Array(12); api.getRandomValues(salt); api.getRandomValues(iv);
    const key = await derive(api, bytes, salt, 'encrypt');
    const ciphertext = new Uint8Array(await api.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD, tagLength: 128 }, key, plain));
    try { return JSON.stringify({ ...HEADER, salt: encode64(salt), iv: encode64(iv), ciphertext: encode64(ciphertext) }, null, 2) + '\n'; }
    finally { ciphertext.fill(0); }
  } catch (error) {
    if (error instanceof CookieTransferCryptoError) throw error;
    fail('unsupported-crypto');
  } finally { plain?.fill(0); bytes?.fill(0); salt?.fill(0); iv?.fill(0); }
}
export async function decryptCookieTransfer(text, password, options) {
  let data = null, bytes = null;
  try {
    data = envelope(text); const api = provider(options); bytes = passwordBytes(password);
    const key = await derive(api, bytes, data.salt, 'decrypt');
    const plain = new Uint8Array(await api.subtle.decrypt({ name: 'AES-GCM', iv: data.iv, additionalData: AAD, tagLength: 128 }, key, data.ciphertext));
    try { if (plain.length > MAX_PLAIN) fail('too-large'); return new TextDecoder('utf-8', { fatal: true }).decode(plain); }
    finally { plain.fill(0); }
  } catch (error) {
    if (error instanceof CookieTransferCryptoError) throw error;
    fail('decryption-failed');
  } finally { bytes?.fill(0); data?.salt.fill(0); data?.iv.fill(0); data?.ciphertext.fill(0); }
}
