// S2 (surfaces installer): buffers the page created itself (createBuffer, new AudioBuffer) are never projected, so a noise trap that
// writes samples and reads them back sees delta 0 like in an unmodified browser; engine-produced buffers keep the projection.
// Actual serialized production installer, synthetic Web Audio.
import test from 'node:test';
import assert from 'node:assert/strict';
import { surfaceFixture, AUDIO_MOCKS } from './surface-test-kit.mjs';

const AUDIO = { id: 'audio-fingerprint', value: { seed: '00112233445566778899aabbccddeeff', amplitude: 0.00001 }, audioKey: '0f1e2d3c4b5a69788796a5b4c3d2e1f0'.repeat(2) };
const OPTIONS = '{ numberOfChannels: 2, length: 64, sampleRate: 44100 }';
// A CreepJS-style noise trap: write known samples into a buffer, read them back through both readers, report the worst delta of each.
const TRAP = `globalThis.trap = (buffer, channel = 0) => {
  const written = Float32Array.from({ length: buffer.length }, (_, index) => Math.fround(Math.cos(index * 0.37) * 0.6 + 0.0123));
  buffer.getChannelData(channel).set(written);
  const view = buffer.getChannelData(channel), copy = new Float32Array(buffer.length); buffer.copyFromChannel(copy, channel, 0);
  let viewDelta = 0, copyDelta = 0;
  for (let index = 0; index < written.length; index++) { viewDelta = Math.max(viewDelta, Math.abs(view[index] - written[index])); copyDelta = Math.max(copyDelta, Math.abs(copy[index] - written[index])); }
  return JSON.stringify([viewDelta, copyDelta, view === buffer.getChannelData(channel), bitsOf(rawChannel(buffer, channel), 0, 8) === bitsOf(written, 0, 8)]);
};`;
const UNTOUCHED = '[0,0,true,true]';
const audio = (entries = [AUDIO], setup = '') => surfaceFixture(entries, { mocks: AUDIO_MOCKS, setup: TRAP + '\n' + setup });
const tick = () => new Promise(resolve => setImmediate(resolve));
// Engine buffers are projected: nearly every non-silent sample moved, never beyond the selected amplitude.
const PROJECTED = 'JSON.stringify((view => { let moved = 0, worst = 0; for (let index = 0; index < view.length; index++) { const delta = Math.abs(view[index] - sampleAt(index)); if (delta) moved++; worst = Math.max(worst, delta); } return [moved >= 50, worst <= 0.00001]; })(SUBJECT.getChannelData(0)))';
const projected = subject => PROJECTED.replace('SUBJECT', subject);

test('createBuffer on AudioContext and OfflineAudioContext: written samples read back exactly (delta 0, same native array)', () => {
  const run = audio();
  assert.equal(run('trap(new AudioContext().createBuffer(2, 64, 44100))'), UNTOUCHED);
  assert.equal(run('trap(new OfflineAudioContext().createBuffer(2, 64, 44100), 1)'), UNTOUCHED, 'channel 1 of an offline context');
  assert.equal(run('globalThis.made = new AudioContext().createBuffer(1, 64, 44100); made.getChannelData(0) === rawChannel(made)'), true, 'the native array itself is returned');
});

test('new AudioBuffer(options): written samples read back exactly on every channel, copyToChannel included', () => {
  const run = audio();
  assert.equal(run('trap(new AudioBuffer(' + OPTIONS + '))'), UNTOUCHED);
  assert.equal(run('trap(new AudioBuffer(' + OPTIONS + '), 1)'), UNTOUCHED);
  run('globalThis.fed = new AudioBuffer(' + OPTIONS + '); fed.copyToChannel(Float32Array.from({ length: 64 }, (_, index) => Math.fround(index * 0.001)), 0, 0);');
  assert.equal(run('(() => { const out = new Float32Array(64); fed.copyFromChannel(out, 0, 0); return out.every((value, index) => value === Math.fround(index * 0.001)) && fed.getChannelData(0).every((value, index) => value === Math.fround(index * 0.001)); })()'), true);
});

test('engine-produced buffers (startRendering, decodeAudioData, engine factory) keep being projected', async () => {
  const run = audio();
  run('globalThis.rendered = null; globalThis.decoded = null; new OfflineAudioContext().startRendering().then(buffer => { globalThis.rendered = buffer; }); new AudioContext().decodeAudioData(new ArrayBuffer(8)).then(buffer => { globalThis.decoded = buffer; });');
  await tick();
  assert.equal(run(projected('rendered')), '[true,true]', 'startRendering result');
  assert.equal(run(projected('decoded')), '[true,true]', 'decodeAudioData result');
  assert.equal(run(projected('engineBuffer(' + OPTIONS + ')')), '[true,true]', 'any other engine buffer');
  assert.equal(run('(() => { const buffer = engineBuffer(' + OPTIONS + '); const out = new Float32Array(64); buffer.copyFromChannel(out, 0, 0); return out.some((value, index) => value !== sampleAt(index)); })()'), true, 'copyFromChannel of an engine buffer');
  // The page cannot launder an engine buffer: writing into it does not move it to the authored side. Samples it overwrote after
  // the projection read back as written (the channel is projected once, ADR-107), every other engine sample stays projected,
  // and a channel it never read is projected on its first read.
  run('globalThis.engine = engineBuffer(' + OPTIONS + '); engine.getChannelData(0).set(Float32Array.from({ length: 32 }, () => 0.25));');
  assert.equal(run('(() => { const view = engine.getChannelData(0); return view.subarray(0, 32).every(value => value === 0.25) && view.subarray(32).some((value, index) => value !== sampleAt(index + 32)); })()'), true);
  assert.equal(run(projected('engine').replace('getChannelData(0)', 'getChannelData(1)')), '[true,true]', 'channel 1 of the same engine buffer');
  assert.equal(run('(() => { const out = new Float32Array(64); engine.copyFromChannel(out, 0, 0); return out.subarray(0, 32).every(value => value === 0.25) && out.subarray(32).every((value, index) => value === rawChannel(engine)[index + 32]); })()'), true, 'a copy of a projected channel is the projected channel');
});

test('subclass and Reflect.construct newTarget cases: prototype from newTarget, buffer tracked, original runs once with new.target', () => {
  const run = audio();
  run('class Sub extends AudioBuffer { constructor(options) { super(options); this.tag = 7; } } globalThis.sub = new Sub(' + OPTIONS + ');');
  assert.equal(run('sub instanceof Sub && sub instanceof AudioBuffer && Object.getPrototypeOf(sub) === Sub.prototype && sub.tag === 7'), true);
  assert.equal(run('last.construct.target === Sub'), true, 'the native saw the subclass as new.target');
  assert.equal(run('trap(sub, 1)'), UNTOUCHED);
  run('globalThis.reflected = Reflect.construct(AudioBuffer, [' + OPTIONS + '], Sub);');
  assert.equal(run('Object.getPrototypeOf(reflected) === Sub.prototype && reflected instanceof AudioBuffer'), true);
  assert.equal(run('trap(reflected)'), UNTOUCHED);
  assert.equal(run('function Other() {} Other.prototype = Object.create(AudioBuffer.prototype); const other = Reflect.construct(AudioBuffer, [' + OPTIONS + '], Other); Object.getPrototypeOf(other) === Other.prototype && last.construct.target === Other'), true);
  assert.equal(run('trap(other)'), UNTOUCHED);
  assert.equal(run('globalThis.plain = new AudioBuffer(' + OPTIONS + '); last.construct.target === NativeAudioBufferClass'), true, 'a plain new passes the original class, not the Proxy');
});

test('wrong receivers, bad arguments and native errors stay native (identity, brand and coercion order)', () => {
  const run = audio();
  const brand = code => assert.throws(() => run(code), error => error.name === 'TypeError' && /Illegal invocation/.test(error.message), code);
  for (const receiver of ['{}', 'null', '5', 'undefined', 'new Proxy({}, {})', 'Object.create(AudioBuffer.prototype)']) {
    brand('AudioBuffer.prototype.getChannelData.call(' + receiver + ', 0)');
    brand('AudioBuffer.prototype.copyFromChannel.call(' + receiver + ', new Float32Array(4), 0)');
    brand('BaseAudioContext.prototype.createBuffer.call(' + receiver + ', 1, 8, 44100)');
  }
  assert.equal(run('counts.channelReads + counts.copies + counts.create'), 0, 'no native method body ran for a foreign receiver');
  // Authored buffer: native range error, native coercion exactly once, no SecurityError and no deny counter.
  run('globalThis.mine = new AudioContext().createBuffer(1, 64, 44100); globalThis.coerced = 0;');
  assert.throws(() => run('mine.getChannelData(5)'), error => error.name === 'IndexSizeError');
  assert.equal(run('mine.getChannelData({ valueOf() { coerced++; return 0; } }) === rawChannel(mine) && coerced'), 1);
  assert.equal(run('mine.copyFromChannel(new Float32Array(4), { valueOf() { coerced++; return 0; } }, { valueOf() { coerced++; return 0; } }), coerced'), 3);
  // Engine buffer: an opaque channel argument is still denied before the native call (unchanged).
  run('globalThis.engine = engineBuffer(' + OPTIONS + '); coerced = 0;');
  assert.throws(() => run('engine.getChannelData({ valueOf() { coerced++; return 0; } })'), error => error.name === 'SecurityError');
  assert.equal(run('coerced'), 0);
  // Constructor and createBuffer failures are the native ones, thrown once.
  const before = Number(run('counts.construct'));
  assert.throws(() => run('new AudioBuffer()'), error => error.name === 'TypeError' && /AudioBufferOptions/.test(error.message));
  assert.throws(() => run('AudioBuffer(' + OPTIONS + ')'), error => error.name === 'TypeError' && /constructor|new/i.test(error.message));
  assert.equal(Number(run('counts.construct')) - before, 1, 'the failed new reached the original once; a call without new never did');
  assert.throws(() => run('new AudioBuffer({ length: 0, sampleRate: 44100 })'), error => error === run('failure'));
  assert.throws(() => run('new AudioContext().createBuffer(1, 0, 44100)'), error => error === run('failure'));
});

test('the original runs exactly once with the original this and arguments', () => {
  const run = audio();
  run('globalThis.context = new AudioContext(); globalThis.options = ' + OPTIONS + '; globalThis.made = context.createBuffer(2, 32, 22050); globalThis.built = new AudioBuffer(options);');
  assert.equal(run('counts.create'), 1);
  assert.equal(run('JSON.stringify(last.create.args)'), '[2,32,22050]');
  assert.equal(run('last.create.receiver === context'), true);
  assert.equal(run('counts.construct'), 1);
  assert.equal(run('last.construct.args.length === 1 && last.construct.args[0] === options'), true, 'the options object is passed by identity, never read or copied');
  run('globalThis.hostile = new Proxy({}, { get() { throw new Error("PAGE_READ"); }, getPrototypeOf() { throw new Error("PAGE_PROTO"); }, ownKeys() { throw new Error("PAGE_KEYS"); } });');
  assert.throws(() => run('new AudioBuffer(hostile)'), error => /PAGE_READ/.test(error.message), 'a hostile options Proxy only runs inside the native constructor');
  assert.equal(run('counts.construct'), 2, 'one call, one native construction');
});

test('constructor wrapper keeps identity, descriptors and instanceof; every wrapper is counted as installed, none as changed', () => {
  const run = audio();
  assert.equal(run('AudioBuffer.prototype.constructor === AudioBuffer && AudioBuffer.name === "AudioBuffer" && AudioBuffer.length === 1 && typeof AudioBuffer === "function"'), true);
  assert.equal(run('const field = Object.getOwnPropertyDescriptor(globalThis, "AudioBuffer"); field.writable && field.configurable && !field.enumerable'), true);
  assert.equal(run('engineBuffer(' + OPTIONS + ') instanceof AudioBuffer && new AudioBuffer(' + OPTIONS + ') instanceof AudioBuffer'), true);
  const row = () => JSON.parse(run('JSON.stringify(guard.snapshot().entries[0])'));
  // getChannelData, copyFromChannel, createBuffer, AudioBuffer.prototype.constructor and the AudioBuffer binding.
  assert.equal(row().installed, 5); assert.equal(row().unavailable, 0);
  const changed = () => Number(run('guard.snapshot().changed'));
  const base = changed();
  run('trap(new AudioContext().createBuffer(1, 64, 44100)); trap(new AudioBuffer(' + OPTIONS + '));');
  assert.equal(changed(), base, 'authored buffers, createBuffer and the constructor change nothing and count nothing');
  run('engineBuffer(' + OPTIONS + ').getChannelData(0);');
  assert.equal(changed(), base + 1, 'an engine read is still a counted projection');
});

test('stop restores the constructor and prototype link; retained wrappers pass through and a newer owner survives', () => {
  const run = audio();
  run('globalThis.wrapped = AudioBuffer; globalThis.before = new AudioBuffer(' + OPTIONS + '); globalThis.engine = engineBuffer(' + OPTIONS + ');');
  assert.equal(run('AudioBuffer === wrapped && wrapped !== NativeAudioBufferClass'), true);
  run('guard.stop(); guard.stop();');
  assert.equal(run('AudioBuffer === NativeAudioBufferClass && AudioBuffer.prototype.constructor === NativeAudioBufferClass'), true, 'original binding and constructor link restored');
  assert.equal(run('engine.getChannelData(0).every((value, index) => value === sampleAt(index))'), true, 'stopped: engine buffers read natively');
  assert.equal(run('const count = counts.construct; const retained = new wrapped(' + OPTIONS + '); retained instanceof NativeAudioBufferClass && counts.construct === count + 1'), true, 'a retained wrapper constructs once and does not track');
  const later = audio();
  later('globalThis.Next = function Next() {}; AudioBuffer = Next; guard.stop();');
  assert.equal(later('AudioBuffer === Next'), true, 'a newer owner is never overwritten');
});

test('realms without Web Audio or without createBuffer degrade without fabricating anything', () => {
  const empty = surfaceFixture([AUDIO], { mocks: '' });
  assert.equal(empty('typeof AudioBuffer + typeof BaseAudioContext'), 'undefinedundefined');
  assert.equal(empty('guard.snapshot().installed'), 0); assert.ok(empty('guard.snapshot().unavailable') >= 1);
  // No BaseAudioContext.createBuffer: the projection and the constructor tracking still install, the gap is counted as unavailable.
  const partial = surfaceFixture([AUDIO], { mocks: AUDIO_MOCKS, setup: 'delete BaseAudioContext.prototype.createBuffer; ' + TRAP });
  assert.equal(partial('trap(new AudioBuffer(' + OPTIONS + '))'), UNTOUCHED);
  assert.equal(partial('guard.snapshot().entries[0].unavailable'), 1);
  assert.equal(partial(projected('engineBuffer(' + OPTIONS + ')')), '[true,true]', 'engine buffers are still projected on their first read');
});

test('many page buffers are cheap: the tracking set is weak and the wrappers stay O(1) per call', () => {
  const run = audio();
  const started = performance.now();
  assert.equal(run('(() => { const context = new AudioContext(); let ok = 0; for (let index = 0; index < 4000; index++) { const buffer = index % 2 ? context.createBuffer(1, 16, 44100) : new AudioBuffer({ length: 16, sampleRate: 44100 }); buffer.getChannelData(0)[0] = 0.5; if (buffer.getChannelData(0)[0] === 0.5) ok++; } return ok; })()'), 4000);
  assert.ok(performance.now() - started < 5000, 'sanity bound only');
});
