// ADR-107 audio-fingerprint (serialized production surfaces installer, synthetic Web Audio): the private per-profile key,
// AnalyserNode readouts, the per-channel projection cache, ScriptProcessor event buffers and an aggregate-noise regression.
import test from 'node:test';
import assert from 'node:assert/strict';
import { surfaceFixture, originOf, AUDIO_MOCKS } from './surface-test-kit.mjs';

const KEY = '0f1e2d3c4b5a69788796a5b4c3d2e1f0'.repeat(2), OTHER_KEY = '9'.repeat(64);
const audioRow = (extra = {}, amplitude = 0.00001) => ({ id: 'audio-fingerprint', value: { seed: '00112233445566778899aabbccddeeff', amplitude }, audioKey: KEY, ...extra });
const securityError = error => error.name === 'SecurityError' && /unavailable/.test(error.message);

// AnalyserNode (frequencyBinCount = fftSize / 2; each readout writes min(array length, bins or fftSize) entries of fixed synthetic data)
// and AudioProcessingEvent (page constructor + an engine-side factory that bypasses the page-visible binding, like a dispatched event).
const EXTRA_MOCKS = `(() => {
  const nodes = new WeakMap(), events = new WeakMap(), stats = globalThis.analyserStats = { calls: 0, constructed: 0 };
  function node(receiver) { const found = nodes.get(receiver); if (!found) throw new TypeError('Illegal invocation'); return found; }
  function fill(receiver, array, type, kind) {
    const found = node(receiver); stats.calls++;
    if (Object.prototype.toString.call(array) !== '[object ' + type + ']') throw new TypeError("parameter 1 is not of type '" + type + "'.");
    const source = found[kind], count = Math.min(array.length, kind === 'freq' || kind === 'byteFreq' ? found.fftSize / 2 : found.fftSize);
    for (let index = 0; index < count; index++) array[index] = source[index % source.length];
  }
  class AnalyserNode {
    get frequencyBinCount() { return node(this).fftSize / 2; } get fftSize() { return node(this).fftSize; }
    getFloatFrequencyData(array) { fill(this, array, 'Float32Array', 'freq'); }
    getByteFrequencyData(array) { fill(this, array, 'Uint8Array', 'byteFreq'); }
    getFloatTimeDomainData(array) { fill(this, array, 'Float32Array', 'time'); }
    getByteTimeDomainData(array) { fill(this, array, 'Uint8Array', 'byteTime'); }
  }
  // Silent bins are -Infinity; finite levels from -30 to -150 dB; 0 and NaN as edge cases.
  globalThis.FREQ = Array.from({ length: 1024 }, (_, index) => index % 97 === 0 ? -Infinity : index === 5 ? 0 : index === 6 ? NaN : Math.fround(-30 - (index * 7919 % 12000) / 100));
  globalThis.BYTE_FREQ = Array.from({ length: 1024 }, (_, index) => index % 50 === 0 ? 0 : index % 51 === 0 ? 255 : index % 7 === 0 ? 1 : index % 11 === 0 ? 254 : index * 37 % 256);
  globalThis.TIME = Array.from({ length: 2048 }, (_, index) => index % 64 === 0 ? 0 : Math.fround(Math.sin(index / 9) * 0.6));
  globalThis.BYTE_TIME = Array.from({ length: 2048 }, (_, index) => index % 9 === 0 ? 128 : index % 31 === 0 ? 0 : index % 37 === 0 ? 255 : 128 + Math.round(Math.sin(index / 9) * 100));
  globalThis.makeAnalyser = (fftSize = 2048) => { const created = Object.create(AnalyserNode.prototype); nodes.set(created, { fftSize, freq: FREQ, byteFreq: BYTE_FREQ, time: TIME, byteTime: BYTE_TIME }); return created; };
  class AudioProcessingEvent {
    constructor(type, init) { stats.constructed++; events.set(this, { input: init.inputBuffer, output: init.outputBuffer }); }
    get inputBuffer() { const found = events.get(this); if (!found) throw new TypeError('Illegal invocation'); return found.input; }
    get outputBuffer() { const found = events.get(this); if (!found) throw new TypeError('Illegal invocation'); return found.output; }
  }
  const NativeEvent = AudioProcessingEvent;
  globalThis.engineEvent = (input, output) => new NativeEvent('audioprocess', { inputBuffer: input, outputBuffer: output });
  for (const [name, value] of Object.entries({ AnalyserNode, AudioProcessingEvent })) Object.defineProperty(globalThis, name, { value, writable: true, configurable: true, enumerable: false });
})();`;
const audio = (entries = [audioRow()], setup = '') => surfaceFixture(entries, { mocks: AUDIO_MOCKS + EXTRA_MOCKS, setup: originOf('https://top.example') + setup });
const CHANNEL0 = '(() => { const buffer = engineBuffer({ length: 64, sampleRate: 44100 }); buffer.getChannelData(0); return bitsOf(rawChannel(buffer), 0, 16); })()';

test('the private key drives the noise: the portable value seed plays no part; without a valid key engine reads fail closed', () => {
  const first = audio()(CHANNEL0);
  assert.equal(audio([{ ...audioRow(), value: { seed: 'ffffffffffffffffffffffffffffffff', amplitude: 0.00001 } }])(CHANNEL0), first, 'another value seed, same key');
  assert.notEqual(audio([audioRow({ audioKey: OTHER_KEY })])(CHANNEL0), first, 'another key');
  for (const audioKey of [undefined, KEY.slice(1), KEY.toUpperCase(), 'g'.repeat(64), 42]) {
    const run = audio([audioRow({ audioKey })]);
    run('globalThis.engine = engineBuffer({ length: 64, sampleRate: 44100 }); globalThis.node = makeAnalyser(); globalThis.levels = new Float32Array(8).fill(-7);');
    assert.throws(() => run('engine.getChannelData(0)'), securityError, String(audioKey));
    assert.throws(() => run('engine.copyFromChannel(new Float32Array(8), 0, 0)'), securityError);
    assert.throws(() => run('node.getFloatFrequencyData(levels)'), securityError);
    assert.equal(run('counts.channelReads + counts.copies + analyserStats.calls'), 0, 'denied before every native call');
    assert.equal(run('levels.every(value => value === -7)'), true);
    // Buffers the page created stay readable: nothing of the engine is involved.
    assert.equal(run('const own = new AudioBuffer({ length: 8, sampleRate: 44100 }); own.getChannelData(0).set([0.5]); own.getChannelData(0)[0]'), 0.5);
    assert.ok(run('guard.snapshot().entries[0].unavailable') >= 4);
  }
});

test('AnalyserNode float frequency data: a keyed relative step on every finite level; -Infinity, NaN and 0 stay exact', () => {
  for (const amplitude of [0.00001, 0.0000001, 0.001]) {
    const run = audio([audioRow({}, amplitude)]), relative = Math.max(amplitude, 2 ** -20);
    const levels = run('globalThis.node = makeAnalyser(); const levels = new Float32Array(1024); node.getFloatFrequencyData(levels); Array.from(levels)');
    const native = run('FREQ');
    let moved = 0;
    levels.forEach((value, index) => {
      const original = native[index];
      if (!Number.isFinite(original) || original === 0) { assert.ok(Object.is(value, original), 'bin ' + index + ' exact'); return; }
      const ratio = Math.abs(value - original) / Math.abs(original);
      assert.ok(ratio >= relative * 0.5 - 2 ** -23 && ratio <= relative + 2 ** -23, `bin ${index}: ${original} -> ${value} (ratio ${ratio})`);
      if (value !== original) moved++;
    });
    assert.equal(moved, native.filter(value => Number.isFinite(value) && value !== 0).length, amplitude + ': every finite level between -30 and -150 dB moved');
    assert.equal(run('analyserStats.calls'), 1, 'the native readout ran once');
    // Deterministic per (key, bin): a second readout of the same levels returns the same bytes; another key differs.
    assert.deepEqual(run('const again = new Float32Array(1024); node.getFloatFrequencyData(again); Array.from(again)'), levels);
  }
  const other = audio([audioRow({ audioKey: OTHER_KEY })])('const levels = new Float32Array(1024); makeAnalyser().getFloatFrequencyData(levels); Array.from(levels)');
  assert.notDeepEqual(other, audio()('const levels = new Float32Array(1024); makeAnalyser().getFloatFrequencyData(levels); Array.from(levels)'));
});

test('AnalyserNode readouts touch only the entries the native call wrote, in the page array itself', () => {
  const run = audio();
  // fftSize 64: 32 bins; a longer array keeps its page-written tail, a shorter array is projected up to its own length.
  assert.equal(run('globalThis.node = makeAnalyser(64); globalThis.long = new Float32Array(40).fill(-5); globalThis.result = node.getFloatFrequencyData(long); result === undefined && long.subarray(32).every(value => value === -5)'), true);
  assert.equal(run('long.subarray(1, 32).some((value, index) => value !== FREQ[index + 1])'), true);
  assert.equal(run('const time = new Float32Array(80).fill(0.5); node.getFloatTimeDomainData(time); time.subarray(64).every(value => value === 0.5) && time.subarray(0, 64).some((value, index) => value !== TIME[index])'), true);
  assert.equal(run('const short = new Uint8Array(3).fill(9); node.getByteFrequencyData(short); short.length'), 3);
  // Wrong array types are rejected by the native call and nothing is projected.
  assert.throws(() => run('node.getFloatFrequencyData(new Float64Array(4))'), /Float32Array/);
  assert.throws(() => run('node.getByteTimeDomainData([1, 2, 3])'), /Uint8Array/);
  assert.throws(() => run('AnalyserNode.prototype.getFloatFrequencyData.call({}, new Float32Array(4))'), /Illegal invocation/);
});

test('AnalyserNode bytes: a keyed eighth moves by one level, never from or onto 0/255; time-domain 128 (silence) stays', () => {
  const run = audio();
  const frequency = run('globalThis.node = makeAnalyser(); (() => { const bytes = new Uint8Array(1024); node.getByteFrequencyData(bytes); return Array.from(bytes); })()'), nativeFrequency = run('BYTE_FREQ');
  const time = run('(() => { const bytes = new Uint8Array(2048); node.getByteTimeDomainData(bytes); return Array.from(bytes); })()'), nativeTime = run('BYTE_TIME');
  for (const [values, native, silence] of [[frequency, nativeFrequency, null], [time, nativeTime, 128]]) {
    let moved = 0, eligible = 0;
    values.forEach((value, index) => {
      const original = native[index];
      if (original === 0 || original === 255 || original === silence) { assert.equal(value, original, 'bin ' + index); return; }
      eligible++; assert.ok(Math.abs(value - original) <= 1 && value !== 0 && value !== 255, `bin ${index}: ${original} -> ${value}`);
      if (value !== original) moved++;
    });
    assert.ok(moved > eligible * 0.08 && moved < eligible * 0.18, `about an eighth moved: ${moved} of ${eligible}`);
  }
  // Float time-domain data are samples: the sample projection (low mantissa, within the amplitude), zeros exact.
  const samples = run('(() => { const values = new Float32Array(2048); node.getFloatTimeDomainData(values); return Array.from(values); })()'), nativeSamples = run('TIME');
  assert.ok(samples.every((value, index) => nativeSamples[index] === 0 ? Object.is(value, nativeSamples[index]) : Math.abs(value - nativeSamples[index]) <= 0.00001));
  assert.ok(samples.filter((value, index) => value !== nativeSamples[index]).length > 1800);
});

test('a projected channel is not projected again: page writes survive, copies equal the projected channel, other channels are independent', () => {
  const run = audio();
  run('globalThis.engine = engineBuffer({ numberOfChannels: 2, length: 4096, sampleRate: 44100 }); globalThis.view = engine.getChannelData(0); globalThis.first = Float32Array.from(view);');
  assert.equal(run('view.some((value, index) => value !== sampleAt(index))'), true, 'projected on the first read');
  // The widely copied loop: getChannelData(0)[i] for 500 samples returns the first projection every time.
  assert.equal(run('(() => { for (let index = 3500; index < 4000; index++) if (engine.getChannelData(0)[index] !== first[index]) return false; return true; })()'), true);
  run('view[5] = 0.123; view[6] = -0.75;');
  assert.equal(run('engine.getChannelData(0)[5] === Math.fround(0.123) && engine.getChannelData(0)[6] === -0.75'), true, 'a page write reads back as written');
  assert.equal(run('(() => { const out = new Float32Array(16); engine.copyFromChannel(out, 0, 0); return out.every((value, index) => value === view[index]); })()'), true);
  // Channel 1: a copy before any view is projected like the later view.
  assert.equal(run('(() => { const out = new Float32Array(64); engine.copyFromChannel(out, 1, 100); const later = engine.getChannelData(1); return out.every((value, index) => value === later[index + 100]) && out.some((value, index) => value !== sampleAt(index + 100)); })()'), true);
  assert.equal(run('counts.channelReads'), 504, 'one native call per read (1 + 500 + 2 + channel 1)');
});

test('ScriptProcessor: engine input buffers are projected on every read (refilled per event), outputBuffer reads back natively', () => {
  const run = audio();
  run('globalThis.input = engineBuffer({ length: 256, sampleRate: 44100 }); globalThis.output = engineBuffer({ length: 256, sampleRate: 44100 }, false); globalThis.event = engineEvent(input, output);');
  assert.equal(run('event.inputBuffer === input && event.outputBuffer === output'), true);
  assert.equal(run('event.inputBuffer.getChannelData(0).some((value, index) => value !== sampleAt(index))'), true, 'input is projected');
  // The engine refills the same AudioBuffer for the next event: the new samples are projected again, not served raw.
  run('globalThis.raw = rawChannel(input); for (let index = 0; index < 256; index++) raw[index] = Math.fround(Math.cos(index) * 0.5); globalThis.refilled = Float32Array.from(raw);');
  assert.equal(run('engineEvent(input, output).inputBuffer.getChannelData(0).some((value, index) => value !== refilled[index])'), true);
  assert.equal(run('input.getChannelData(0).every((value, index) => Math.abs(value - refilled[index]) <= 0.00001)'), true);
  // outputBuffer is the page's to fill: whatever it holds (here: what the page wrote in an earlier event) reads back exactly, also on the
  // first read, and what the page writes now reads back as written.
  run('rawChannel(output).set(Float32Array.from({ length: 256 }, (_, index) => Math.fround(Math.sin(index) * 0.4)));');
  assert.equal(run('event.outputBuffer.getChannelData(0).every((value, index) => value === Math.fround(Math.sin(index) * 0.4))'), true, 'first read is native');
  assert.equal(run('const data = event.outputBuffer.getChannelData(0); data.set(Float32Array.from({ length: 256 }, (_, index) => Math.fround(index / 300))); output.getChannelData(0).every((value, index) => value === Math.fround(index / 300))'), true);
  // A buffer read (and cached) before it became an engine input is projected again once the engine refills it.
  run('globalThis.early = engineBuffer({ length: 128, sampleRate: 44100 }); early.getChannelData(0); engineEvent(early, output).inputBuffer; globalThis.earlyRaw = rawChannel(early); for (let index = 0; index < 128; index++) earlyRaw[index] = Math.fround(Math.cos(index * 3) * 0.5); globalThis.earlyRefill = Float32Array.from(earlyRaw);');
  assert.equal(run('early.getChannelData(0).some((value, index) => value !== earlyRefill[index])'), true, 'refilled engine input is projected again');
  // An event the page constructs around an engine buffer cannot make that buffer native.
  run('globalThis.rendered = engineBuffer({ length: 256, sampleRate: 44100 }); globalThis.fake = new AudioProcessingEvent("audioprocess", { inputBuffer: rendered, outputBuffer: rendered, playbackTime: 0 });');
  assert.equal(run('fake.outputBuffer === rendered && analyserStats.constructed'), 4, 'three engine events and the page event, each constructed natively once');
  assert.equal(run('rendered.getChannelData(0).some((value, index) => value !== sampleAt(index))'), true, 'still projected');
  assert.equal(run('fake instanceof AudioProcessingEvent && AudioProcessingEvent.prototype.constructor === AudioProcessingEvent'), true);
});

test('ScriptProcessor: without a replaceable AudioProcessingEvent constructor outputBuffer stays projected (safe default)', () => {
  const run = audio([audioRow()], 'Object.defineProperty(globalThis, "AudioProcessingEvent", { value: AudioProcessingEvent, writable: false, configurable: false });');
  run('globalThis.output = engineBuffer({ length: 64, sampleRate: 44100 }); engineEvent(engineBuffer({ length: 64, sampleRate: 44100 }), output).outputBuffer;');
  assert.equal(run('output.getChannelData(0).some((value, index) => value !== sampleAt(index))'), true);
});

// FingerprintJS-style aggregate: a compressed 10 kHz triangle (average |x| about 0.25), summed as |x| over samples 4500..5000 through the
// getChannelData(0)[i] loop. Every key must give a different sum, none the native one, and the change must stay within the amplitude.
test('aggregate noise: 1000 keys give 1000 distinct compressor sums, none native, each within 500 x amplitude', () => {
  const signal = Array.from({ length: 5000 }, (_, index) => { const phase = (index * 10000 / 44100) % 1, triangle = phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase; return Math.fround(Math.tanh(3 * triangle) * 0.3 * (1 - Math.exp(-index / 300))); });
  const native = signal.slice(4500).reduce((sum, value) => sum + Math.abs(value), 0), sums = new Set(), deltas = [];
  for (let index = 0; index < 1000; index++) {
    const key = (index * 2654435761 >>> 0).toString(16).padStart(8, '0').repeat(8);
    const run = audio([audioRow({ audioKey: key })]); run.signal = signal;
    const sum = run('(() => { const buffer = engineBuffer({ length: 5000, sampleRate: 44100 }, false); rawChannel(buffer).set(' + JSON.stringify(signal) + '); let sum = 0; for (let index = 4500; index < 5000; index++) sum += Math.abs(buffer.getChannelData(0)[index]); return sum; })()');
    sums.add(sum); deltas.push(Math.abs(sum - native));
  }
  assert.equal(sums.size, 1000, 'all sums distinct'); assert.equal(sums.has(native), false);
  deltas.sort((left, right) => left - right);
  assert.ok(deltas[999] <= 500 * 0.00001, 'largest change ' + deltas[999]);
  assert.ok(deltas[500] > 1e-6 && deltas[500] < 1e-3, 'median change ' + deltas[500] + ' (native ' + native + ')');
});
