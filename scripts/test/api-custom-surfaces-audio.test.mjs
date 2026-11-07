// Audio rows of the ADR-087 surfaces installer (actual serialized production installer, synthetic Web Audio):
// long-buffer readback bound, sampleRate metadata scope and per-origin noise.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installSurfaceCustom } from '../../apps/production-extension/api-custom-surfaces-runtime.js';

const SEED = '00112233445566778899aabbccddeeff';
// ADR-107: the noise follows the private per-profile key (entry.audioKey); the portable value seed only identifies the profile.
const AUDIO = { id: 'audio-fingerprint', value: { seed: SEED, amplitude: 0.00001 }, audioKey: '0f1e2d3c4b5a69788796a5b4c3d2e1f0'.repeat(2) };
const OLD_CAP = 4194304, NEW_CAP = 67108864;

// Wrapped in a function: top-level class declarations would shadow the global properties the installer replaces.
const MOCKS = `(() => {
  const contexts = new WeakMap(), buffers = new WeakMap(), destinations = new WeakSet();
  globalThis.counts = { construct: 0, rateReads: 0, channelReads: 0, copies: 0 };
  globalThis.DEVICE_RATE = 48000;
  class BaseAudioContext {
    get sampleRate() { const own = contexts.get(this); if (!own) throw new TypeError('Illegal invocation'); counts.rateReads++; return own.sampleRate; }
  }
  class AudioContext extends BaseAudioContext {
    constructor(options = undefined) {
      super(); counts.construct++;
      let rate = DEVICE_RATE;
      if (options !== undefined && options !== null) {
        if (typeof options !== 'object' && typeof options !== 'function') throw new TypeError('The provided value is not of type AudioContextOptions');
        const requested = options.sampleRate; if (requested !== undefined) rate = Number(requested);
        void options.latencyHint;
      }
      contexts.set(this, { sampleRate: rate, live: true });
    }
    get baseLatency() { const own = contexts.get(this); if (!own || !own.live) throw new TypeError('Illegal invocation'); return 0.01; }
    get outputLatency() { const own = contexts.get(this); if (!own || !own.live) throw new TypeError('Illegal invocation'); return 0; }
  }
  class OfflineAudioContext extends BaseAudioContext {
    constructor(channels, length, sampleRate) { super(); contexts.set(this, { sampleRate, live: false }); }
  }
  class AudioDestinationNode {
    constructor() { destinations.add(this); }
    get maxChannelCount() { if (!destinations.has(this)) throw new TypeError('Illegal invocation'); return 6; }
  }
  class AudioBuffer {
    constructor(length, sampleRate = DEVICE_RATE, reportedLength = length) { buffers.set(this, { data: new Float32Array(length), sampleRate, reportedLength }); }
    get length() { const own = buffers.get(this); if (!own) throw new TypeError('Illegal invocation'); return own.reportedLength; }
    get sampleRate() { const own = buffers.get(this); if (!own) throw new TypeError('Illegal invocation'); return own.sampleRate; }
    get duration() { const own = buffers.get(this); if (!own) throw new TypeError('Illegal invocation'); return own.reportedLength / own.sampleRate; }
    getChannelData(channel) {
      const own = buffers.get(this); if (!own) throw new TypeError('Illegal invocation');
      counts.channelReads++; if ((Number(channel) >>> 0) > 1) throw new RangeError('channel index'); return own.data;
    }
    copyFromChannel(destination, channel, start = 0) {
      const own = buffers.get(this); if (!own) throw new TypeError('Illegal invocation');
      counts.copies++; if ((Number(channel) >>> 0) > 1) throw new RangeError('channel index');
      start = Number(start) >>> 0;
      const count = Math.max(0, Math.min(destination.length, own.data.length - start));
      for (let index = 0; index < count; index++) destination[index] = own.data[start + index];
    }
  }
  Object.assign(globalThis, { BaseAudioContext, AudioContext, OfflineAudioContext, AudioDestinationNode, AudioBuffer });
  globalThis.webkitAudioContext = AudioContext;
  // Engine-side factory: the unwrapped class, as used for startRendering/decodeAudioData results. Since S2 the installer tracks buffers made through
  // the wrapped global constructor or createBuffer as page-authored and returns those natively; projection tests therefore build engine buffers.
  const NativeAudioBuffer = AudioBuffer; globalThis.engineBuffer = (...args) => new NativeAudioBuffer(...args);
  // Test-only back doors to the unwrapped native storage.
  globalThis.rawChannel = buffer => buffers.get(buffer).data;
  globalThis.fillNoise = buffer => { const data = buffers.get(buffer).data; for (let index = 0; index < data.length; index++) data[index] = ((Math.imul(index + 1, 2654435761) >>> 8) / 16777216 - 0.5) * 1.5; return buffer; };
  globalThis.fillSine = buffer => { const data = buffers.get(buffer).data; for (let index = 0; index < data.length; index++) data[index] = index === 0 ? 0 : Math.sin(index) * 0.75; return buffer; };
  globalThis.bitsOf = (view, from, count) => Array.from(new Uint32Array(view.buffer, view.byteOffset + from * 4, count), word => word.toString(16).padStart(8, '0')).join(',');
})();
`;

function fixture(entries, { setup = '', mocks = MOCKS } = {}) {
  const context = vm.createContext({ DOMException });
  vm.runInContext(mocks + '\n' + setup + '\nglobalThis.installSurfaceCustom = (' + installSurfaceCustom.toString() + ');', context);
  context.entries = entries.map(row => ({ ...row, mode: 'custom' }));
  vm.runInContext('globalThis.guard = installSurfaceCustom(globalThis, entries)', context);
  return source => vm.runInContext(source, context);
}
const originOf = value => 'Object.defineProperty(globalThis, "origin", { get() { return ' + JSON.stringify(value) + '; }, configurable: true, enumerable: true });';
const securityError = error => error.name === 'SecurityError' && /unavailable/.test(error.message);

// Bit patterns of a realm without a usable origin (unscoped) for the key above and sine input, pinned when ADR-107 moved the noise to
// the private key (the same values as UNSCOPED in api-custom-site-scope.test.mjs).
const LEGACY_CHANNEL0 = '00000000,3f218f83,3f2e95aa,3dd8c118,bf114e63,bf381d3d,be56964a,3efc48b9,3f3df48e,3e9e40be,bed0e794,bf3fffe7';
const LEGACY_CHANNEL1_OFFSET5 = 'bf381d09,be569729,3efc48df,3f3df4d1,3e9e40c1,bed0e709,bf3fffff,bece0b53';

// ---------------------------------------------------------------------------------------------
// D-canvas-audio-9: buffers longer than the old 4,194,304-sample cap must stay readable, projected end to end.
// ---------------------------------------------------------------------------------------------
test('audio readback above the old 4,194,304 cap works and is projected end to end', () => {
  const run = fixture([AUDIO]);
  const samples = OLD_CAP + 110000;
  run('globalThis.longBuffer = fillNoise(engineBuffer(' + samples + ')); globalThis.original = Float32Array.from(rawChannel(longBuffer));');
  assert.equal(run('longBuffer.getChannelData(0).length'), samples, 'a 3-minute-class buffer is readable');
  assert.equal(run('longBuffer.getChannelData(0) === rawChannel(longBuffer)'), true, 'native view identity is preserved');
  // The part past the old cap is not left native: nearly every sample moved, never beyond the selected amplitude.
  assert.equal(run('(() => { const data = rawChannel(longBuffer); let moved = 0, worst = 0; for (let index = ' + OLD_CAP + '; index < data.length; index++) { if (data[index] !== original[index]) moved++; worst = Math.max(worst, Math.abs(data[index] - original[index])); } return moved > (data.length - ' + OLD_CAP + ') * 0.9 && worst <= 0.00001; })()'), true);
  // Repeated reads are idempotent, and the key is offset based, not length based.
  assert.equal(run('(() => { const first = bitsOf(rawChannel(longBuffer), ' + (OLD_CAP + 5) + ', 64); longBuffer.getChannelData(0); return first === bitsOf(rawChannel(longBuffer), ' + (OLD_CAP + 5) + ', 64); })()'), true);
  assert.equal(run('(() => { const twin = fillNoise(engineBuffer(64)); twin.getChannelData(0); return bitsOf(rawChannel(twin), 0, 64) === bitsOf(rawChannel(longBuffer), 0, 64); })()'), true, 'same offset, same projection regardless of length');
  assert.equal(run('(() => { const other = fillNoise(engineBuffer(64)); other.getChannelData(1); return bitsOf(rawChannel(other), 0, 32) !== bitsOf(rawChannel(longBuffer), 0, 32); })()'), true, 'channel index is part of the key');
});

test('audio copyFromChannel into a destination above the old cap is projected and equals getChannelData', () => {
  const run = fixture([AUDIO]);
  const samples = OLD_CAP + 50000;
  run('globalThis.a = fillNoise(engineBuffer(' + samples + ')); globalThis.b = fillNoise(engineBuffer(' + samples + ')); globalThis.destination = new Float32Array(' + samples + ');');
  run('a.copyFromChannel(destination, 0, 0); b.getChannelData(0);');
  assert.equal(run('(() => { const view = rawChannel(b); return destination.every((value, index) => value === view[index]); })()'), true, 'copy and view projections agree for every sample');
  assert.equal(run('destination.some((value, index) => value !== Math.fround(((Math.imul(index + 1, 2654435761) >>> 8) / 16777216 - 0.5) * 1.5))'), true, 'copy is projected, not native');
  assert.equal(run('(() => { const view = rawChannel(a); return view.every((value, index) => value === Math.fround(((Math.imul(index + 1, 2654435761) >>> 8) / 16777216 - 0.5) * 1.5)); })()'), true, 'the source buffer is not modified by a copy');
  assert.equal(run('counts.copies'), 1);
  // A partial copy at an offset near the end keeps the same keys.
  run('globalThis.tail = new Float32Array(1000); a.copyFromChannel(tail, 0, ' + (OLD_CAP + 100) + ');');
  assert.equal(run('bitsOf(tail, 0, 1000) === bitsOf(rawChannel(b), ' + (OLD_CAP + 100) + ', 1000)'), true);
});

test('audio readback above the new cap is still denied before the native call; the cap itself is allowed', () => {
  const run = fixture([AUDIO]);
  // reportedLength lies about the buffer length so no huge allocation is needed.
  run('globalThis.atCap = engineBuffer(8, 48000, ' + NEW_CAP + '); globalThis.overCap = engineBuffer(8, 48000, ' + (NEW_CAP + 1) + ');');
  assert.equal(run('atCap.getChannelData(0).length'), 8, 'exactly at the cap is accepted');
  assert.equal(run('counts.channelReads'), 1);
  assert.throws(() => run('overCap.getChannelData(0)'), securityError);
  assert.equal(run('counts.channelReads'), 1, 'the native call is not made for an over-cap buffer');
  assert.ok(run('guard.snapshot().entries.find(row => row.id === "audio-fingerprint").unavailable') >= 1);
  // copyFromChannel is bounded by the destination length.
  assert.equal(run('atCap.copyFromChannel(new Float32Array(16), 0, 0), counts.copies'), 1);
  let allocated = true;
  // 256 MiB of untouched zero pages; skip this last step on a host that refuses the allocation.
  try { run('globalThis.hugeDestination = new Float32Array(' + (NEW_CAP + 1) + ');'); } catch (error) { if (error.name !== 'RangeError') throw error; allocated = false; }
  if (allocated) {
    assert.throws(() => run('atCap.copyFromChannel(hugeDestination, 0, 0)'), securityError);
    assert.equal(run('counts.copies'), 1, 'the native copy is not made for an over-cap destination');
  }
});

// ---------------------------------------------------------------------------------------------
// D-canvas-audio-8: audio-metadata sampleRate belongs only to the default-rate live AudioContext.
// ---------------------------------------------------------------------------------------------
const METADATA = { id: 'audio-metadata', value: { sampleRate: 44100, baseLatency: 0.011, outputLatency: 0.021, maxChannelCount: 2 } };

test('audio-metadata: a default-rate live AudioContext reports the selected sampleRate with one native read', () => {
  const run = fixture([METADATA]);
  assert.equal(run('globalThis.live = new AudioContext(); live.sampleRate'), 44100);
  assert.equal(run('counts.rateReads'), 1);
  assert.equal(run('counts.construct'), 1, 'the native constructor runs exactly once');
  assert.equal(run('new AudioContext(undefined).sampleRate + "," + new AudioContext(null).sampleRate'), '44100,44100');
  assert.equal(run('new webkitAudioContext().sampleRate'), 44100);
  assert.equal(run('class Sub extends AudioContext { constructor() { super(); this.tag = 1; } } const sub = new Sub(); sub.tag + ":" + sub.sampleRate + ":" + (Object.getPrototypeOf(sub) === Sub.prototype)'), '1:44100:true');
  assert.equal(run('Reflect.construct(AudioContext, [], Sub).sampleRate'), 44100);
});

test('audio-metadata: page-chosen rates stay native (explicit AudioContext rate, OfflineAudioContext, AudioBuffer)', () => {
  const run = fixture([METADATA]);
  assert.equal(run('new AudioContext({ sampleRate: 22050 }).sampleRate'), 22050, 'explicit sampleRate is the page choice');
  assert.equal(run('new AudioContext({ sampleRate: 16000, latencyHint: "interactive" }).sampleRate'), 16000);
  assert.equal(run('new AudioContext({ sampleRate: 48000 }).sampleRate'), 48000, 'even when it equals the device rate');
  assert.equal(run('new OfflineAudioContext(1, 22050, 22050).sampleRate'), 22050);
  assert.equal(run('new OfflineAudioContext(1, 48000, 48000).sampleRate'), 48000);
  assert.equal(run('const buffer = new AudioBuffer(16000, 8000); buffer.sampleRate + ":" + buffer.duration'), '8000:2', 'createBuffer(1,16000,8000) is still 2 seconds at 8 kHz');
  assert.equal(run('const decoded = new AudioBuffer(96000, 48000); decoded.sampleRate + ":" + decoded.duration'), '48000:2', 'decoded duration is length / native rate');
  assert.equal(run('Object.getOwnPropertyDescriptor(AudioBuffer.prototype, "sampleRate").get.call(new AudioBuffer(4, 12345))'), 12345);
});

test('audio-metadata: an options object is never read by the wrapper (page getters run once, natively)', () => {
  const run = fixture([METADATA]);
  assert.equal(run('globalThis.reads = 0; new AudioContext({ get sampleRate() { reads++; return 22050; } }).sampleRate'), 22050);
  assert.equal(run('reads'), 1, 'exactly the native dictionary read');
  assert.equal(run('globalThis.trapped = 0; const probe = new Proxy({}, { get() { trapped++; return undefined; }, getOwnPropertyDescriptor() { trapped += 100; return undefined; }, getPrototypeOf() { trapped += 1000; return null; } }); new AudioContext(probe); trapped'), 2, 'only the two native member reads touched the Proxy (latencyHint and sampleRate)');
  // Documented fail-safe: an options bag without sampleRate is treated as page-supplied, so it stays native.
  assert.equal(run('new AudioContext({ latencyHint: "interactive" }).sampleRate'), 48000);
});

test('audio-metadata: constructor wrapper keeps native errors, identity and calling convention', () => {
  const run = fixture([METADATA]);
  assert.throws(() => run('AudioContext()'), error => error.name === 'TypeError' && /without 'new'/.test(error.message));
  assert.throws(() => run('new AudioContext(5)'), /AudioContextOptions/);
  assert.equal(run('counts.construct'), 1, 'a call without new never reaches the original; the failed new reaches it exactly once');
  assert.equal(run('globalThis.ctx = new AudioContext(); ctx instanceof AudioContext && ctx instanceof BaseAudioContext'), true);
  assert.equal(run('ctx.constructor === AudioContext && AudioContext.prototype.constructor === AudioContext && webkitAudioContext === AudioContext'), true);
  assert.equal(run('AudioContext.name + ":" + AudioContext.length'), 'AudioContext:0');
  assert.throws(() => run('Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, "sampleRate").get.call({})'), /Illegal invocation/);
  assert.equal(run('counts.rateReads'), 0, 'a foreign receiver is rejected by the native getter');
});

test('audio-metadata: latency and channel rows are unchanged, including for explicit-rate contexts', () => {
  const run = fixture([METADATA]);
  assert.equal(run('const live = new AudioContext(); live.baseLatency + ":" + live.outputLatency'), '0.011:0.021');
  assert.equal(run('const explicit = new AudioContext({ sampleRate: 22050 }); explicit.baseLatency + ":" + explicit.outputLatency'), '0.011:0.021');
  assert.equal(run('new AudioDestinationNode().maxChannelCount'), 2);
  assert.throws(() => run('Object.getOwnPropertyDescriptor(AudioContext.prototype, "baseLatency").get.call(new OfflineAudioContext(1, 8, 8000))'), /Illegal invocation/);
  const rateOnly = fixture([{ id: 'audio-metadata', value: { sampleRate: 44100 } }]);
  assert.equal(rateOnly('new AudioContext().baseLatency'), 0.01, 'unselected latency stays native');
  const noRate = fixture([{ id: 'audio-metadata', value: { baseLatency: 0.02 } }]);
  assert.equal(noRate('new AudioContext().sampleRate'), 48000, 'without a sampleRate row the constructor is untouched');
  assert.equal(noRate('AudioContext.prototype.constructor === AudioContext && new AudioContext().baseLatency'), 0.02);
});

test('audio-metadata: stop restores the constructor, ignores later owners and returns native values', () => {
  const run = fixture([METADATA]);
  run('globalThis.wrapped = AudioContext; globalThis.before = new AudioContext();');
  assert.equal(run('before.sampleRate'), 44100);
  run('guard.stop(); guard.stop();');
  assert.equal(run('AudioContext !== wrapped && AudioContext.prototype.constructor === AudioContext && webkitAudioContext === AudioContext'), true, 'original binding restored');
  assert.equal(run('before.sampleRate'), 48000, 'an instance created while active reads native after stop');
  assert.equal(run('new wrapped().sampleRate'), 48000, 'a retained wrapper no longer marks or rewrites');
  const later = fixture([METADATA]);
  later('globalThis.next = function Next() {}; AudioContext = next; guard.stop();');
  assert.equal(later('AudioContext === next'), true, 'a newer owner is never overwritten');
});

test('audio-metadata: realms without Web Audio get no fabricated constructors', () => {
  const run = fixture([METADATA], { mocks: '' });
  assert.equal(run('typeof AudioContext + typeof webkitAudioContext + typeof BaseAudioContext'), 'undefinedundefinedundefined');
  assert.ok(run('guard.snapshot().unavailable') >= 1);
  assert.equal(run('guard.snapshot().installed'), 0);
});

test('audio-metadata: opaque neutral values apply to a default context with one native read', () => {
  const neutral = { id: 'audio-metadata', value: { sampleRate: 48000, baseLatency: 0, outputLatency: 0, maxChannelCount: 1 }, opaqueNeutral: true };
  const run = fixture([neutral], { setup: 'DEVICE_RATE = 96000;' });
  assert.equal(run('new AudioContext().sampleRate'), 48000);
  assert.equal(run('counts.rateReads'), 1);
  assert.equal(run('new AudioContext({ sampleRate: 11025 }).sampleRate'), 11025);
});

// ---------------------------------------------------------------------------------------------
// D-canvas-audio-10: the noise is keyed by the document origin as well as the profile seed.
// ---------------------------------------------------------------------------------------------
const SINE_BITS = 'bitsOf(fillSine(engineBuffer(64)).getChannelData(0), 0, 12)';

test('audio noise differs per origin, is stable for one origin and survives reinstall', () => {
  const siteA = fixture([AUDIO], { setup: originOf('https://a.example') });
  const siteB = fixture([AUDIO], { setup: originOf('https://b.example') });
  const siteAgain = fixture([AUDIO], { setup: originOf('https://a.example') });
  const a = siteA(SINE_BITS), b = siteB(SINE_BITS), again = siteAgain(SINE_BITS);
  assert.equal(a, again, 'one origin keeps one value');
  assert.equal(siteA(SINE_BITS), a, 'repeated reads in one document are identical');
  assert.notEqual(a, b, 'another origin gets another value');
  const differing = a.split(',').filter((word, index) => word !== b.split(',')[index]).length;
  assert.ok(differing >= 9, 'most samples differ between origins, got ' + differing + '/12');
  assert.notEqual(a, LEGACY_CHANNEL0, 'scoped output is not the unscoped one');
  // The amplitude bound still holds under origin scoping.
  assert.equal(siteB('(() => { const data = fillSine(engineBuffer(256)); const before = Float32Array.from(rawChannel(data)); data.getChannelData(0); return rawChannel(data).every((value, index) => Math.abs(value - before[index]) <= 0.00001); })()'), true);
  // copyFromChannel agrees with getChannelData under the same scoped key.
  assert.equal(siteA('(() => { const buffer = fillSine(engineBuffer(64)); const out = new Float32Array(12); buffer.copyFromChannel(out, 0, 0); return bitsOf(out, 0, 12); })()'), a);
});

test('audio noise keeps today\'s value when the origin is opaque, empty or unreadable', () => {
  const variants = [
    ['absent', ''], ['opaque null', originOf('null')], ['empty', originOf('')],
    ['not a string', 'Object.defineProperty(globalThis, "origin", { value: 42, configurable: true });'],
    ['oversized', originOf('x'.repeat(2049))],
    ['throwing getter', 'Object.defineProperty(globalThis, "origin", { get() { throw new Error("no origin"); }, configurable: true });'],
  ];
  for (const [label, setup] of variants) {
    const run = fixture([AUDIO], { setup });
    assert.equal(run(SINE_BITS), LEGACY_CHANNEL0, label + ': channel 0 matches the pre-scoping value');
    assert.equal(run('(() => { const buffer = fillSine(engineBuffer(64)); const out = new Float32Array(8); buffer.copyFromChannel(out, 1, 5); return bitsOf(out, 0, 8); })()'), LEGACY_CHANNEL1_OFFSET5, label + ': channel 1 / offset 5 matches the pre-scoping value');
  }
});

test('audio origin is read through the accessor captured at install, not a later page property', () => {
  const run = fixture([AUDIO], { setup: originOf('https://a.example') });
  const first = run(SINE_BITS);
  assert.notEqual(first, LEGACY_CHANNEL0, 'the accessor origin is used');
  run('Object.defineProperty(globalThis, "origin", { get() { return "https://evil.example"; }, configurable: true });');
  assert.equal(run('bitsOf(fillSine(engineBuffer(64)).getChannelData(0), 0, 12)'), first, 'a later page override cannot rekey a document that is already installed');
  const data = fixture([AUDIO], { setup: 'Object.defineProperty(globalThis, "origin", { value: "https://a.example", configurable: true, writable: true });' });
  assert.equal(data(SINE_BITS), first, 'a plain data origin property (non-accessor realm) is scoped identically');
});
