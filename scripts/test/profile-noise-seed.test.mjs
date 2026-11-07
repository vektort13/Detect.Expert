// ADR-106: Canvas and Math noise keys follow the applied profile. One local root, HMAC derivation, no portable value.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { ProfileNoiseSeeds, PROFILE_NOISE_ROOT_KEY, profileIdentity, NOISE_IDENTITY_EXCLUDED } from '../../apps/production-extension/profile-noise-seed.js';
import { CanvasProfileSeed, CANVAS_NOISE_PURPOSE } from '../../apps/production-extension/canvas-profile-seed.js';
import { MathProfileSeed, MATH_NOISE_PURPOSE } from '../../apps/production-extension/math-profile-seed.js';

const row = (id, value, mode = 'custom') => ({ id, mode, selected: value === undefined ? { kind: 'unset' } : { kind: 'value', value } });
const canvas = row('canvas-readback', { algorithm: 'stable-rgb-v1' });
const math = row('math-transcendentals', { algorithm: 'deterministic-ulp-v1', functions: ['sin'] });
const device = [row('hardware-concurrency', 8), row('screen-width', 1920)];
// Node defines globalThis.crypto as an accessor, so keep both the descriptor and the real object.
const REAL_DESCRIPTOR = Object.getOwnPropertyDescriptor(globalThis, 'crypto'), REAL_CRYPTO = globalThis.crypto;
const restoreCrypto = () => Object.defineProperty(globalThis, 'crypto', REAL_DESCRIPTOR);

// A tiny storage.local with call recording and failure injection; crypto keeps the real subtle.
function fixture(initial = {}, firstByte = 0) {
  const values = { ...initial }, calls = []; let getError = null, setError = null, entropy = firstByte;
  const local = {
    async get(key) { calls.push(['get', key]); if (getError) throw getError; return { [key]: values[key] }; },
    async set(input) { calls.push(['set', { ...input }]); if (setError) throw setError; Object.assign(values, input); }
  };
  const forbidden = { get() { assert.fail('session/sync storage must not hold noise keys'); }, set() { assert.fail('session/sync storage must not hold noise keys'); } };
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { subtle: REAL_CRYPTO.subtle, getRandomValues(bytes) { entropy++; assert.equal(bytes.length, 32); bytes.fill(entropy); return bytes; } } });
  return {
    values, calls, api: { storage: { local, session: forbidden, sync: forbidden } }, entropy: () => entropy,
    failGet: error => { getError = error; }, failSet: error => { setError = error; },
    restore: restoreCrypto
  };
}
const run = async body => { const f = fixture(); try { await body(f); } finally { f.restore(); } };

test('the profile identity is canonical, ordered and ignores noise rows, blocks and unset values', () => {
  const a = profileIdentity([row('screen-width', 1920), row('webgl', { b: 1, a: 2 })]);
  const b = profileIdentity([row('webgl', { a: 2, b: 1 }), row('screen-width', 1920)]);
  assert.equal(a, b);
  assert.equal(profileIdentity([...device, canvas, math, row('battery', undefined, 'on'), row('usb', undefined, 'bypass')]), profileIdentity(device));
  assert.deepEqual([...NOISE_IDENTITY_EXCLUDED], ['canvas-readback', 'math-transcendentals']);
  assert.notEqual(profileIdentity([row('screen-width', 1920)]), profileIdentity([row('screen-width', 2560)]));
});

test('site scopes repeat global rows; duplicates never rotate the key but a distinct site value does', () => {
  const global = [row('hardware-concurrency', 8), row('screen-width', 1920)];
  assert.equal(profileIdentity([...global, ...global, ...global]), profileIdentity(global), 'a site that overrides nothing repeats the global rows');
  assert.equal(profileIdentity([...global, ...global]), profileIdentity(global.slice().reverse()), 'order and repetition are irrelevant');
  assert.notEqual(profileIdentity([...global, row('hardware-concurrency', 4)]), profileIdentity(global), 'a site-specific Custom value is part of the applied profile');
});

test('concurrent requests share one local root; a restarted worker reuses it', () => run(async f => {
  const noise = new ProfileNoiseSeeds(f.api), keys = await Promise.all(Array.from({ length: 30 }, () => noise.derive(CANVAS_NOISE_PURPOSE, device)));
  assert.equal(new Set(keys).size, 1); assert.match(keys[0], /^[a-f0-9]{64}$/); assert.equal(f.entropy(), 1);
  assert.equal(f.calls.filter(call => call[0] === 'set').length, 1); assert.deepEqual(Object.keys(f.values), [PROFILE_NOISE_ROOT_KEY]);
  assert.match(f.values[PROFILE_NOISE_ROOT_KEY], /^[a-f0-9]{64}$/);
  assert.equal(await new ProfileNoiseSeeds(f.api).derive(CANVAS_NOISE_PURPOSE, device), keys[0]); assert.equal(f.entropy(), 1);
}));

test('the key is HMAC-SHA256 of purpose and identity under the local root', () => run(async f => {
  const noise = new ProfileNoiseSeeds(f.api), key = await noise.derive('canvas-projection:v1', device);
  const expected = createHmac('sha256', Buffer.from(f.values[PROFILE_NOISE_ROOT_KEY], 'hex')).update('canvas-projection:v1\0' + profileIdentity(device)).digest('hex');
  assert.equal(key, expected);
}));

test('the same profile keeps its key, any device change or a new local root derives a new one', () => run(async f => {
  const noise = new ProfileNoiseSeeds(f.api), first = await noise.derive(CANVAS_NOISE_PURPOSE, device);
  assert.equal(await noise.derive(CANVAS_NOISE_PURPOSE, [...device, canvas, math]), first, 'tuning the noise rows does not rotate the key');
  assert.notEqual(await noise.derive(CANVAS_NOISE_PURPOSE, [device[0], row('screen-width', 2560)]), first);
  assert.notEqual(await noise.derive(MATH_NOISE_PURPOSE, device), first, 'Canvas and Math keys are independent');
  const other = fixture({}, 100); try { assert.notEqual(await new ProfileNoiseSeeds(other.api).derive(CANVAS_NOISE_PURPOSE, device), first); } finally { other.restore(); }
}));

test('only a complete lowercase root is reused; malformed stored state is replaced locally', async () => {
  const valid = 'abcdef01'.repeat(8), kept = fixture({ [PROFILE_NOISE_ROOT_KEY]: valid });
  try { await new ProfileNoiseSeeds(kept.api).derive('x', device); assert.equal(kept.entropy(), 0); assert.equal(kept.values[PROFILE_NOISE_ROOT_KEY], valid); } finally { kept.restore(); }
  for (const bad of [null, '', 'a'.repeat(63), 'A'.repeat(64), 'z'.repeat(64), 42]) {
    const f = fixture({ [PROFILE_NOISE_ROOT_KEY]: bad });
    try { await new ProfileNoiseSeeds(f.api).derive('x', device); assert.match(f.values[PROFILE_NOISE_ROOT_KEY], /^[a-f0-9]{64}$/); assert.notEqual(f.values[PROFILE_NOISE_ROOT_KEY], bad); } finally { f.restore(); }
  }
});

test('failed storage never yields an unpersisted key and a retry starts a fresh attempt', () => run(async f => {
  const noise = new ProfileNoiseSeeds(f.api), readFailure = Error('read failed'), writeFailure = Error('write failed');
  f.failGet(readFailure); await assert.rejects(noise.derive('x', device), error => error === readFailure); assert.equal(f.entropy(), 0);
  f.failGet(null); f.failSet(writeFailure); await assert.rejects(noise.derive('x', device), error => error === writeFailure); assert.equal(f.values[PROFILE_NOISE_ROOT_KEY], undefined);
  f.failSet(null); assert.match(await noise.derive('x', device), /^[a-f0-9]{64}$/); assert.equal(f.entropy(), 2);
}));

test('missing local storage or Web Crypto fails closed with no fallback', async () => {
  await assert.rejects(new ProfileNoiseSeeds({ storage: {} }).derive('x', device), /unavailable/);
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues: bytes => bytes } });
  try { await assert.rejects(new ProfileNoiseSeeds({ storage: { local: { get: async () => ({}), set: async () => {} } } }).derive('x', device), /Web Crypto/); } finally { restoreCrypto(); }
});

test('entropy failure is propagated and no partial root reaches storage', async () => {
  const f = fixture(), failure = Error('entropy unavailable');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { subtle: REAL_CRYPTO.subtle, getRandomValues() { throw failure; } } });
  try { await assert.rejects(new ProfileNoiseSeeds(f.api).derive('x', device), error => error === failure); assert.equal(f.calls.filter(call => call[0] === 'set').length, 0); assert.deepEqual(f.values, {}); } finally { restoreCrypto(); }
});

test('inactive, Allow, Block and empty profiles never touch storage or entropy', () => run(async f => {
  const seeds = [new CanvasProfileSeed(f.api), new MathProfileSeed(f.api)];
  const inactive = [[], [{ ...canvas, mode: 'off' }, { ...math, mode: 'off' }], [{ ...canvas, mode: 'on' }, { ...math, mode: 'on' }], [{ ...canvas, mode: 'bypass' }, { ...math, mode: 'bypass' }],
    [row('math-transcendentals', { algorithm: 'deterministic-ulp-v1', functions: [] })]];
  for (const entries of inactive) for (const seed of seeds) assert.equal(await seed.prepare(entries), null);
  assert.equal(f.entropy(), 0); assert.equal(f.calls.length, 0);
}));

test('Canvas and Math prepare keys from the shared root and the same profile gives the same keys after a restart', () => run(async f => {
  const entries = [...device, canvas, math], first = [await new CanvasProfileSeed(f.api).prepare(entries), await new MathProfileSeed(f.api).prepare(entries)];
  assert.notEqual(first[0], first[1]); assert.equal(f.entropy(), 1);
  assert.deepEqual([await new CanvasProfileSeed(f.api).prepare(entries), await new MathProfileSeed(f.api).prepare(entries)], first);
  const changed = [row('hardware-concurrency', 4), device[1], canvas, math];
  assert.notEqual(await new CanvasProfileSeed(f.api).prepare(changed), first[0]);
}));

test('row keys for Audio, WebGL readPixels and Network Information derive from the same root with their own purposes (ADR-107)', async () => {
  const { RowNoiseSeed, AUDIO_NOISE_PURPOSE, WEBGL_NOISE_PURPOSE, NETWORK_NOISE_PURPOSE } = await import('../../apps/production-extension/profile-noise-seed.js');
  const f = fixture({}, 7);
  try {
    const rows = [...device, row('audio-fingerprint', { seed: 'ab'.repeat(16), amplitude: 0.00001 }), row('webgl-readback', { seed: 'cd'.repeat(16) }), row('network-information', { downlink: 10, effectiveType: '4g', rtt: 50, saveData: false })];
    const seeds = [new RowNoiseSeed(f.api, 'audio-fingerprint', AUDIO_NOISE_PURPOSE), new RowNoiseSeed(f.api, 'webgl-readback', WEBGL_NOISE_PURPOSE), new RowNoiseSeed(f.api, 'network-information', NETWORK_NOISE_PURPOSE)];
    const keys = []; for (const seed of seeds) keys.push(await seed.prepare(rows));
    assert.equal(new Set(keys).size, 3); for (const key of keys) assert.match(key, /^[a-f0-9]{64}$/);
    assert.equal(await new ProfileNoiseSeeds(f.api).derive(AUDIO_NOISE_PURPOSE, rows), keys[0]);
    for (const seed of seeds) assert.equal(await seed.prepare(device), null, 'inactive rows need no key');
    assert.equal(await seeds[0].prepare([...device, { ...rows[2], mode: 'on' }]), null);
  } finally { f.restore(); }
});
