// Round 5 (ADR-101 amendment): canPlayType / isTypeSupported report a hidden codec family as unsupported, never raise a native
// answer, and leave every receiver, argument and exception the matcher does not recognize exactly native.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installMediaTypeHooks } from '../../apps/production-extension/api-custom-media-types.js';
import { createMediaCodecMatcher } from '../../apps/production-extension/api-custom-media-codecs.js';

const H264 = 'video/mp4; codecs="avc1.42E01E"', VP8 = 'video/webm; codecs="vp8"';
// A model of the native surface: the answer depends only on the text of the type, the brand check is a WeakSet, and every call is logged.
function fixture({ managed = true, recorder = true, element = true, source = true } = {}) {
  const context = vm.createContext({});
  vm.runInContext(`
    globalThis.log = [];
    globalThis.illegal = new TypeError('Illegal invocation');
    globalThis.missing = new TypeError('1 argument required, but only 0 present.');
    const answer = value => { const text = String(value); return text.includes('absent') ? '' : text.includes('codecs') ? 'probably' : text.length ? 'maybe' : ''; };
    const brand = new WeakSet();
    ${element ? `globalThis.HTMLMediaElement = class HTMLMediaElement {
      constructor() { brand.add(this); }
      canPlayType(type) { log.push(['canPlayType', this, [...arguments]]); if (!brand.has(this)) throw illegal; if (arguments.length < 1) throw missing; return answer(type); }
    };
    globalThis.video = new HTMLMediaElement();` : ''}
    ${source ? `globalThis.MediaSource = class MediaSource { static isTypeSupported(type) { log.push(['MediaSource.isTypeSupported', this, [...arguments]]); if (arguments.length < 1) throw missing; return answer(type) === 'probably'; } };` : ''}
    ${source && managed ? 'globalThis.ManagedMediaSource = class ManagedMediaSource extends MediaSource {};' : ''}
    ${recorder ? `globalThis.MediaRecorder = class MediaRecorder { static isTypeSupported(type) { log.push(['MediaRecorder.isTypeSupported', this, [...arguments]]); if (arguments.length < 1) throw missing; return answer(type) !== ''; } };` : ''}
    globalThis.codecs = (${createMediaCodecMatcher.toString()})();
    globalThis.install = (${installMediaTypeHooks.toString()});
  `, context);
  return { context, run: code => vm.runInContext(code, context) };
}
const hide = 'codecs.mask({supported:true,hidden:["h264"]})';

test('canPlayType hides a hidden family, keeps every other answer native, and calls the original once with the original receiver and arguments', () => {
  const f = fixture();
  f.run(`globalThis.original = HTMLMediaElement.prototype.canPlayType; globalThis.guard = install(globalThis, ${hide}, codecs);`);
  assert.notEqual(f.run('HTMLMediaElement.prototype.canPlayType === original'), true);
  assert.equal(f.run(`video.canPlayType(${JSON.stringify(H264)})`), '');
  assert.equal(f.run(`video.canPlayType(${JSON.stringify(VP8)})`), 'probably');
  assert.equal(f.run("video.canPlayType('video/mp4')"), 'maybe');
  assert.equal(f.run("video.canPlayType('')"), '');
  assert.equal(f.run('log.length'), 4, 'exactly one native call per page call');
  f.run('log.length = 0');
  assert.equal(f.run(`video.canPlayType(${JSON.stringify(H264)}, 'extra', 7)`), '');
  assert.equal(f.run('log.length'), 1);
  assert.equal(f.run('log[0][1] === video'), true);
  assert.deepEqual(JSON.parse(f.run('JSON.stringify(log[0][2])')), [H264, 'extra', 7]);
  assert.deepEqual(JSON.parse(f.run('JSON.stringify(guard.snapshot())')), { installed: 3, unavailable: 0, changed: 2, stopped: false });
});

test('a native empty answer or false is never raised and the matcher is not even consulted', () => {
  const f = fixture();
  f.run(`globalThis.calls = 0; globalThis.counting = { families(...a) { calls++; return codecs.families(...a); }, mask: codecs.mask };
    globalThis.guard = install(globalThis, ${hide}, counting);`);
  assert.equal(f.run(`video.canPlayType(${JSON.stringify(H264 + '; absent=1')})`), '');
  assert.equal(f.run('calls'), 0, 'native "" is returned as is');
  assert.equal(f.run(`MediaSource.isTypeSupported(${JSON.stringify(H264 + '; absent=1')})`), false);
  assert.equal(f.run('calls'), 0, 'native false is returned as is');
  assert.equal(f.run(`MediaSource.isTypeSupported(${JSON.stringify(H264)})`), false);
  assert.equal(f.run('calls'), 1);
});

test('non-string arguments, wrong receivers and exceptions pass through untouched', () => {
  const f = fixture();
  f.run(`globalThis.calls = 0; globalThis.counting = { families(...a) { calls++; return codecs.families(...a); }, mask: codecs.mask };
    globalThis.guard = install(globalThis, ${hide}, counting);`);
  // The native model coerces its argument exactly once: the wrapper adds no coercion and no read of its own.
  f.run(`globalThis.coerced = 0; globalThis.object = { toString() { coerced++; return ${JSON.stringify(H264)}; } };
    globalThis.boxed = new String(${JSON.stringify(H264)});`);
  assert.equal(f.run('video.canPlayType(object)'), 'probably');
  assert.equal(f.run('coerced'), 1);
  assert.equal(f.run('video.canPlayType(boxed)'), 'probably', 'a String object is not a primitive string: native decides');
  assert.equal(f.run('MediaSource.isTypeSupported(object)'), true);
  assert.equal(f.run('coerced'), 2);
  assert.equal(f.run('calls'), 0);
  assert.throws(() => f.run('video.canPlayType()'), error => error === f.context.missing);
  assert.throws(() => f.run('MediaSource.isTypeSupported()'), error => error === f.context.missing);
  assert.throws(() => f.run(`Reflect.apply(HTMLMediaElement.prototype.canPlayType, {}, [${JSON.stringify(H264)}])`), error => error === f.context.illegal);
  assert.throws(() => f.run(`Reflect.apply(HTMLMediaElement.prototype.canPlayType, undefined, [${JSON.stringify(H264)}])`), error => error === f.context.illegal);
  assert.equal(f.run('calls'), 0, 'a native exception ends the call before the matcher');
  assert.throws(() => f.run("video.canPlayType({ toString() { throw 'page error'; } })"), error => error === 'page error');
  assert.equal(f.run('log.length'), 8, 'every call above ran the native model exactly once');
});

test('isTypeSupported of MediaSource, ManagedMediaSource and MediaRecorder hides the family; the inherited static is wrapped once', () => {
  const f = fixture();
  f.run(`globalThis.guard = install(globalThis, ${hide}, codecs);`);
  for (const owner of ['MediaSource', 'ManagedMediaSource', 'MediaRecorder']) {
    f.run('log.length = 0');
    assert.equal(f.run(`${owner}.isTypeSupported(${JSON.stringify(H264)})`), false, owner);
    assert.equal(f.run(`${owner}.isTypeSupported(${JSON.stringify(VP8)})`), true, owner);
    assert.equal(f.run('log.length'), 2, owner + ': one native call per page call, no double wrapping');
    assert.equal(f.run('log[0][1] === ' + owner), true, owner + ' receiver kept');
  }
  assert.equal(f.run("Object.hasOwn(ManagedMediaSource, 'isTypeSupported')"), false, 'ManagedMediaSource keeps inheriting');
  assert.equal(f.run('ManagedMediaSource.isTypeSupported === MediaSource.isTypeSupported'), true);
  assert.equal(JSON.parse(f.run('JSON.stringify(guard.snapshot())')).installed, 3);
});

test('absent APIs are neither created nor counted as unavailable', () => {
  const f = fixture({ managed: false, recorder: false });
  f.run(`globalThis.guard = install(globalThis, ${hide}, codecs);`);
  assert.deepEqual(JSON.parse(f.run('JSON.stringify(guard.snapshot())')), { installed: 2, unavailable: 0, changed: 0, stopped: false });
  assert.equal(f.run("typeof ManagedMediaSource + typeof MediaRecorder"), 'undefinedundefined');
  const bare = fixture({ element: false, source: false, recorder: false });
  bare.run(`globalThis.guard = install(globalThis, ${hide}, codecs);`);
  assert.deepEqual(JSON.parse(bare.run('JSON.stringify(guard.snapshot())')), { installed: 0, unavailable: 0, changed: 0, stopped: false });
});

test('a zero mask installs nothing and leaves every descriptor untouched', () => {
  const f = fixture();
  f.run(`globalThis.before = [Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'canPlayType'), Object.getOwnPropertyDescriptor(MediaSource, 'isTypeSupported'), Object.getOwnPropertyDescriptor(MediaRecorder, 'isTypeSupported')];
    globalThis.guard = install(globalThis, 0, codecs);`);
  assert.equal(f.run(`before[0].value === HTMLMediaElement.prototype.canPlayType && before[1].value === MediaSource.isTypeSupported && before[2].value === MediaRecorder.isTypeSupported`), true);
  assert.deepEqual(JSON.parse(f.run('JSON.stringify(guard.snapshot())')), { installed: 0, unavailable: 0, changed: 0, stopped: false });
  assert.equal(f.run(`codecs.mask({ supported: true, smooth: true, powerEfficient: true, hidden: [] })`), 0, 'the identity profile has a zero mask');
});

test('supported false hides every query that names a codec and leaves container-only queries native', () => {
  const f = fixture();
  f.run('globalThis.guard = install(globalThis, codecs.mask({ supported: false, smooth: false, powerEfficient: false, hidden: [] }), codecs);');
  assert.equal(f.run(`video.canPlayType(${JSON.stringify(VP8)})`), '');
  assert.equal(f.run(`video.canPlayType('video/mp4; codecs="zzzz"')`), '');
  assert.equal(f.run("video.canPlayType('audio/mpeg')"), '', 'a codec-specific MIME type names its codec');
  assert.equal(f.run("video.canPlayType('video/mp4')"), 'maybe');
  assert.equal(f.run("video.canPlayType('application/x-mpegURL')"), 'maybe');
  assert.equal(f.run(`MediaSource.isTypeSupported(${JSON.stringify(VP8)})`), false);
  assert.equal(f.run(`MediaRecorder.isTypeSupported(${JSON.stringify(VP8)})`), false);
  assert.equal(f.run("MediaRecorder.isTypeSupported('video/webm')"), true, 'container-only stays native');
});

test('each hidden family hides its own codec strings and no other', () => {
  const f = fixture();
  const samples = { h264: 'video/mp4; codecs="avc1.42E01E"', h265: 'video/mp4; codecs="hvc1.1.6.L93.B0"', av1: 'video/mp4; codecs="av01.0.04M.08"', vp9: 'video/webm; codecs="vp09.00.10.08"', vp8: VP8,
    aac: 'audio/mp4; codecs="mp4a.40.2"', opus: 'audio/webm; codecs="opus"', vorbis: 'audio/ogg; codecs="vorbis"', flac: 'audio/flac', mp3: 'audio/mpeg', dolby: 'audio/mp4; codecs="ec-3"' };
  for (const family of Object.keys(samples)) {
    const g = fixture();
    g.run(`globalThis.guard = install(globalThis, codecs.mask({ supported: true, hidden: [${JSON.stringify(family)}] }), codecs);`);
    for (const [other, text] of Object.entries(samples)) assert.equal(g.run(`video.canPlayType(${JSON.stringify(text)})`), other === family ? '' : text.includes('codecs') ? 'probably' : 'maybe', family + ' vs ' + other);
  }
  assert.ok(f);
});

test('Stop restores the descriptors it owns and leaves a page replacement alone; retained wrappers answer natively', () => {
  const f = fixture();
  f.run(`globalThis.original = HTMLMediaElement.prototype.canPlayType; globalThis.originalStatic = MediaSource.isTypeSupported;
    globalThis.guard = install(globalThis, ${hide}, codecs); globalThis.retained = HTMLMediaElement.prototype.canPlayType;
    globalThis.replacement = function() { return 'page'; }; Object.defineProperty(MediaRecorder, 'isTypeSupported', { value: replacement, configurable: true, writable: true });`);
  f.run('guard.stop()');
  assert.equal(f.run('HTMLMediaElement.prototype.canPlayType === original && MediaSource.isTypeSupported === originalStatic'), true);
  assert.equal(f.run('MediaRecorder.isTypeSupported === replacement'), true);
  assert.equal(f.run(`Reflect.apply(retained, video, [${JSON.stringify(H264)}])`), 'probably', 'a retained wrapper is inert after Stop');
  assert.equal(JSON.parse(f.run('JSON.stringify(guard.snapshot())')).stopped, true);
  f.run('guard.stop()');
});

test('descendant realms reuse the intrinsics captured by the first installation after the page replaced the globals', () => {
  const f = fixture();
  f.run(`globalThis.first = install(globalThis, ${hide}, codecs);
    globalThis.child = { HTMLMediaElement: class HTMLMediaElement { canPlayType() { return 'probably'; } } };
    Reflect.apply = () => { throw new Error('page apply'); }; Object.defineProperty = () => { throw new Error('page define'); };
    Object.getOwnPropertyDescriptor = () => { throw new Error('page descriptor'); }; Object.getPrototypeOf = () => { throw new Error('page prototype'); }; Object.freeze = () => { throw new Error('page freeze'); };
    globalThis.second = install(child, ${hide}, codecs);`);
  assert.equal(f.run(`new child.HTMLMediaElement().canPlayType(${JSON.stringify(H264)})`), '');
  assert.equal(f.run(`new child.HTMLMediaElement().canPlayType(${JSON.stringify(VP8)})`), 'probably');
  assert.deepEqual(JSON.parse(f.run('JSON.stringify(second.snapshot())')), { installed: 1, unavailable: 0, changed: 1, stopped: false });
});

test('a non-configurable native property is left alone and counted; a failing matcher falls back to the native answer', () => {
  const f = fixture();
  f.run("Object.defineProperty(MediaRecorder, 'isTypeSupported', { configurable: false }); globalThis.fixed = MediaRecorder.isTypeSupported;");
  f.run(`globalThis.broken = { families() { throw new Error('matcher failure'); }, mask: codecs.mask }; globalThis.guard = install(globalThis, ${hide}, broken);`);
  assert.equal(f.run('MediaRecorder.isTypeSupported === fixed'), true);
  assert.equal(f.run(`video.canPlayType(${JSON.stringify(H264)})`), 'probably', 'a matcher failure never changes the native answer');
  assert.deepEqual(JSON.parse(f.run('JSON.stringify(guard.snapshot())')), { installed: 2, unavailable: 2, changed: 0, stopped: false });
});

test('the wrappers keep the native property attributes and are methods, not constructors', () => {
  const f = fixture();
  f.run(`globalThis.shape = () => [HTMLMediaElement.prototype, MediaSource, MediaRecorder].map((target, index) => { const d = Object.getOwnPropertyDescriptor(target, ['canPlayType', 'isTypeSupported', 'isTypeSupported'][index]); return [d.writable, d.enumerable, d.configurable, typeof d.value]; });
    globalThis.nativeShape = shape(); globalThis.guard = install(globalThis, ${hide}, codecs);`);
  assert.deepEqual(JSON.parse(f.run('JSON.stringify(shape())')), JSON.parse(f.run('JSON.stringify(nativeShape)')));
  assert.throws(() => f.run('new HTMLMediaElement.prototype.canPlayType()'), error => error.name === 'TypeError');
  assert.throws(() => f.run('new MediaSource.isTypeSupported()'), error => error.name === 'TypeError');
});

test('a hot loop of wrapped calls stays cheap', () => {
  const f = fixture();
  f.run(`globalThis.guard = install(globalThis, ${hide}, codecs);`);
  const started = performance.now();
  f.run(`for (let i = 0; i < 100000; i++) { video.canPlayType(i % 2 ? 'video/webm; codecs="vp8"' : 'video/mp4'); MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E"'); } log.length = 0;`);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 3000, '200000 wrapped calls took ' + Math.round(elapsed) + ' ms');
});
