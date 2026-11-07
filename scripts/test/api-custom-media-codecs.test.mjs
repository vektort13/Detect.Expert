// Round 5 (ADR-101 amendment): the one hidden-codec matcher shared by MediaCapabilities, canPlayType and isTypeSupported.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createMediaCodecMatcher } from '../../apps/production-extension/api-custom-media-codecs.js';
import { API_MEDIA_CODEC_FAMILIES as CONTRACT_FAMILIES } from '../../packages/contracts/src/api-configuration.mjs';
import { API_MEDIA_CODEC_FAMILIES as MIRROR_FAMILIES } from '../../apps/production-extension/api-configuration.js';

const matcher = createMediaCodecMatcher();
const BACKSLASH = String.fromCharCode(92);
// Readable form of a mask: the family names in contract order, then 'any' when some codec is named at all.
const names = mask => [...CONTRACT_FAMILIES.filter((_, bit) => mask & 1 << bit), ...(mask & matcher.any ? ['any'] : [])];
const sets = (text, rtc) => names(matcher.families(text, rtc));

test('the matcher bit order is the contract order of the codec families (contract and extension mirror)', () => {
  assert.deepEqual([...matcher.names], [...CONTRACT_FAMILIES]);
  assert.deepEqual([...MIRROR_FAMILIES], [...CONTRACT_FAMILIES]);
  const canonical = { h264: 'avc1.42E01E', h265: 'hvc1.1.6.L93.B0', av1: 'av01.0.04M.08', vp9: 'vp09.00.10.08', vp8: 'vp8', aac: 'mp4a.40.2', opus: 'opus', vorbis: 'vorbis', flac: 'flac', mp3: 'mp3', dolby: 'ec-3' };
  assert.deepEqual(Object.keys(canonical), [...CONTRACT_FAMILIES]);
  CONTRACT_FAMILIES.forEach((family, bit) => {
    assert.equal(matcher.families('video/mp4; codecs="' + canonical[family] + '"'), (1 << bit) | matcher.any, family);
    assert.equal(matcher.mask({ supported: true, hidden: [family] }), 1 << bit, family);
  });
  assert.equal(matcher.any, 1 << 20);
});

const table = [
  // [type string, rtc, expected families (+ any)]
  ['video/mp4; codecs="avc1.42E01E"', false, ['h264', 'any']],
  ['video/mp4; codecs="avc1.42E01E, mp4a.40.2"', false, ['h264', 'aac', 'any']],
  ['video/mp4; codecs="avc1.42E01E,mp4a.40.2"', false, ['h264', 'aac', 'any']],
  ['video/mp4; codecs=avc1.4d401e', false, ['h264', 'any']],
  ["video/mp4; codecs='avc1.4d401e'", false, ['h264', 'any']],
  ['VIDEO/MP4; CODECS="AVC1.42E01E"', false, ['h264', 'any']],
  ['  video/mp4 ;  codecs = " avc1.42E01E , mp4a.40.2 "  ', false, ['h264', 'aac', 'any']],
  ['video/mp4;codecs="avc3.640028"', false, ['h264', 'any']],
  ['video/webm;codecs=h264', false, ['h264', 'any']],
  ['video/mp4; codecs="hvc1.1.6.L93.B0"', false, ['h265', 'any']],
  ['video/mp4; codecs="hev1.1.6.L93.B0"', false, ['h265', 'any']],
  ['video/mp4; codecs="dvh1.05.01"', false, ['h265', 'dolby', 'any']],
  ['video/mp4; codecs="dvhe.08.07"', false, ['h265', 'dolby', 'any']],
  ['video/mp4; codecs="dva1.09.01"', false, ['h264', 'dolby', 'any']],
  ['video/mp4; codecs="dvav.09.01"', false, ['h264', 'dolby', 'any']],
  ['video/mp4; codecs="dav1.10.01"', false, ['av1', 'dolby', 'any']],
  ['video/mp4; codecs="av01.0.04M.08"', false, ['av1', 'any']],
  ['video/webm; codecs="vp09.00.10.08"', false, ['vp9', 'any']],
  ['video/webm; codecs="vp9"', false, ['vp9', 'any']],
  ['video/webm; codecs="vp9.0"', false, ['vp9', 'any']],
  ['video/webm; codecs="vp8"', false, ['vp8', 'any']],
  ['video/webm; codecs="vp8, vorbis"', false, ['vp8', 'vorbis', 'any']],
  ['audio/mp4; codecs="mp4a.40.2"', false, ['aac', 'any']],
  ['audio/mp4; codecs="mp4a.40.5"', false, ['aac', 'any']],
  ['audio/mp4; codecs="mp4a.40.29"', false, ['aac', 'any']],
  ['audio/mp4; codecs="mp4a.67"', false, ['aac', 'any']],
  ['audio/mp4; codecs="mp4a.66"', false, ['aac', 'any']],
  ['audio/mp4; codecs="mp4a.68"', false, ['aac', 'any']],
  ['audio/mp4; codecs="mp4a.69"', false, ['mp3', 'any']],
  ['audio/mp4; codecs="mp4a.6B"', false, ['mp3', 'any']],
  ['audio/mp4; codecs="MP4A.6b"', false, ['mp3', 'any']],
  ['audio/mp4; codecs="mp4a.a5"', false, ['dolby', 'any']],
  ['audio/mp4; codecs="mp4a.A6"', false, ['dolby', 'any']],
  ['audio/mp4; codecs="mp4a.7f"', false, ['any']],
  ['audio/mp4; codecs="mp4a"', false, ['any']],
  ['audio/mp4; codecs="ac-3"', false, ['dolby', 'any']],
  ['audio/mp4; codecs="ec-3"', false, ['dolby', 'any']],
  ['audio/mp4; codecs="ac-4"', false, ['dolby', 'any']],
  ['audio/webm; codecs="opus"', false, ['opus', 'any']],
  ['audio/webm; codecs="Opus"', false, ['opus', 'any']],
  ['audio/ogg; codecs="vorbis"', false, ['vorbis', 'any']],
  ['audio/mp4; codecs="flac"', false, ['flac', 'any']],
  ['audio/ogg; codecs=flac', false, ['flac', 'any']],
  ['audio/mp4; codecs="mp3"', false, ['mp3', 'any']],
  ['audio/mp4; codecs="aac"', false, ['aac', 'any']],
  // Codecs that belong to no family only mark that some codec is named.
  ['video/ogg; codecs="theora"', false, ['any']],
  ['video/mp4; codecs="zzzz"', false, ['any']],
  ['video/mp4; codecs="avc1.42E01E, zzzz"', false, ['h264', 'any']],
  // No codec named: nothing to hide, neither family nor any.
  ['video/mp4; codecs=""', false, []],
  ['video/mp4; codecs=', false, []],
  ['video/mp4; codecs=" , ,"', false, []],
  ['video/mp4', false, []],
  ['video/webm', false, []],
  ['audio/webm', false, []],
  ['audio/ogg', false, []],
  ['application/ogg', false, []],
  ['audio/mp4', false, []],
  ['audio/wav', false, []],
  ['video/mp4;', false, []],
  [';', false, []],
  ['', false, []],
  [' ', false, []],
  // Codec-specific MIME types name their codec without a codecs parameter.
  ['audio/mpeg', false, ['mp3', 'any']],
  ['AUDIO/MPEG', false, ['mp3', 'any']],
  ['audio/mp3', false, ['mp3', 'any']],
  ['audio/x-mp3', false, ['mp3', 'any']],
  ['audio/flac', false, ['flac', 'any']],
  ['audio/x-flac', false, ['flac', 'any']],
  ['audio/aac', false, ['aac', 'any']],
  ['audio/aacp', false, ['aac', 'any']],
  ['audio/x-aac', false, ['aac', 'any']],
  [' audio/mpeg ; foo=bar', false, ['mp3', 'any']],
  ['audio/mpeg; codecs="mp3"', false, ['mp3', 'any']],
  ['audio/flac; codecs="zzzz"', false, ['any']],
  // Other parameters and the order of parameters.
  ['video/mp4; profiles="avc1.42E01E"', false, []],
  ['video/mp4; foo="codecs=avc1.42E01E"', false, []],
  ['video/mp4; xcodecs="avc1.42E01E"', false, []],
  ['video/mp4; codecs2="avc1.42E01E"', false, []],
  ['video/mp4; profiles="isom"; codecs="avc1.42E01E"', false, ['h264', 'any']],
  ['video/mp4; codecs="avc1.42E01E"; profiles="isom"', false, ['h264', 'any']],
  ['video/mp4; x="a;codecs=avc1"; codecs="vp8"', false, ['vp8', 'any']],
  ['video/mp4; codecs=avc1; codecs=vp8', false, ['h264', 'vp8', 'any']],
  ['video/mp4; codecs="avc1.42E01E', false, ['h264', 'any']],
  ['video/mp4; codecs="', false, []],
  ['video/mp4; codecs="avc1.42E01E"junk', false, ['h264', 'any']],
  // A WebRTC configuration names its codec by the RTP subtype.
  ['video/H264', true, ['h264', 'any']],
  ['video/h264;profile-level-id=42e01e', true, ['h264', 'any']],
  ['video/VP8', true, ['vp8', 'any']],
  ['video/VP9', true, ['vp9', 'any']],
  ['video/AV1', true, ['av1', 'any']],
  ['video/H265', true, ['h265', 'any']],
  ['audio/opus', true, ['opus', 'any']],
  ['audio/PCMU', true, ['any']],
  ['video/H264', false, []],
  ['video/mp4; codecs="avc1.42E01E"', true, ['h264', 'any']]
];
for (const [text, rtc, expected] of table) test('matcher: ' + JSON.stringify(text) + (rtc ? ' (webrtc)' : ''), () => assert.deepEqual(sets(text, rtc), expected));

test('matcher: a backslash escape inside a double-quoted parameter does not end the quote early', () => {
  assert.deepEqual(sets('video/mp4; x="a' + BACKSLASH + '"b"; codecs="vp8"'), ['vp8', 'any']);
  assert.deepEqual(sets('video/mp4; codecs="avc1.42E01E' + BACKSLASH), ['h264', 'any']);
  assert.deepEqual(sets('video/mp4; codecs="' + BACKSLASH), ['any'], 'a lone backslash is a non-empty token that names no family');
});

test('matcher: only primitive strings are read; nothing is coerced and no page code runs', () => {
  let touched = 0;
  const hostile = { toString() { touched++; return 'video/mp4; codecs="avc1"'; }, valueOf() { touched++; return 'x'; }, [Symbol.toPrimitive]() { touched++; return 'x'; } };
  for (const value of [undefined, null, 0, 5, true, false, 1n, Symbol('s'), {}, [], ['video/mp4; codecs="avc1"'], hostile, new String('video/mp4; codecs="avc1.42E01E"'), () => 'x']) {
    assert.equal(matcher.families(value), 0);
    assert.equal(matcher.families(value, true), 0);
  }
  assert.equal(touched, 0);
});

test('matcher: the first 512 UTF-16 units are inspected and a longer string goes to the native result untouched', () => {
  const tail = '; codecs="avc1.42E01E"', head = 'video/mp4; pad="';
  const exact = head + 'a'.repeat(512 - head.length - 1 - tail.length) + '"' + tail;
  assert.equal(exact.length, 512);
  assert.deepEqual(names(matcher.families(exact)), ['h264', 'any']);
  const longer = exact + ' ';
  assert.equal(longer.length, 513);
  assert.equal(matcher.families(longer), 0);
  assert.equal(matcher.families('video/mp4; codecs="avc1.42E01E"' + ';'.repeat(5000)), 0);
});

test('matcher: hostile strings finish quickly, never throw and never loop', () => {
  const hostile = [
    ';'.repeat(512), '='.repeat(512), ','.repeat(512), '"'.repeat(512), "'".repeat(512), (BACKSLASH + '"').repeat(256), ' '.repeat(512), '; codecs='.repeat(56),
    'video/mp4; codecs="' + 'a,'.repeat(240), 'video/mp4' + '; a'.repeat(250), 'video/mp4; codecs="' + BACKSLASH.repeat(480), String.fromCharCode(0).repeat(512),
    '\ud800'.repeat(256), 'video/mp4; codecs="avc1\u0000.42E01E"', 'video/mp4; codecs=' + String.fromCodePoint(0x212a) + 'avc1', String.fromCodePoint(0x130).repeat(3)
  ];
  const started = performance.now();
  for (let round = 0; round < 400; round++) for (const text of hostile) assert.equal(typeof matcher.families(text), 'number');
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 2000, 'about 6000 scans of at most 512 units took ' + Math.round(elapsed) + ' ms');
});

test('matcher: a typical hot-path call (canPlayType / isTypeSupported strings) is cheap', () => {
  const typical = ['video/mp4; codecs="avc1.42E01E, mp4a.40.2"', 'video/webm; codecs="vp09.00.10.08"', 'audio/mpeg', 'video/mp4', 'application/vnd.apple.mpegurl'];
  const started = performance.now();
  let total = 0;
  for (let round = 0; round < 40000; round++) total += matcher.families(typical[round % typical.length]);
  const elapsed = performance.now() - started;
  assert.ok(total > 0);
  assert.ok(elapsed < 1500, '40000 typical scans took ' + Math.round(elapsed) + ' ms');
});

test('mask: hidden families become bits, supported false adds the any bit, unknown names and accessors are ignored', () => {
  assert.equal(matcher.mask({ supported: true, hidden: [] }), 0);
  assert.equal(matcher.mask({ supported: true, smooth: true, powerEfficient: true }), 0, 'an older value without hidden hides nothing');
  assert.equal(matcher.mask({ supported: true, hidden: ['h264', 'mp3'] }), 1 | 512);
  assert.equal(matcher.mask({ supported: false, hidden: [] }), matcher.any);
  assert.equal(matcher.mask({ supported: false, hidden: ['dolby'] }), matcher.any | 1024);
  assert.equal(matcher.mask({ supported: true, hidden: ['h263', 7, null, {}, 'H264'] }), 0);
  assert.equal(matcher.mask(null), 0);
  assert.equal(matcher.mask('profile'), 0);
  assert.equal(matcher.mask(undefined), 0);
  const accessor = { supported: true };
  Object.defineProperty(accessor, 'hidden', { get() { throw new Error('accessor read'); }, enumerable: true });
  assert.equal(matcher.mask(accessor), 0);
  const listed = ['h264'];
  Object.defineProperty(listed, 1, { get() { throw new Error('accessor read'); }, enumerable: true });
  assert.equal(matcher.mask({ supported: true, hidden: listed }), 1);
});

test('the serialized factory is self-contained and keeps working after the page replaces the String and Reflect intrinsics', () => {
  const context = vm.createContext({});
  vm.runInContext('globalThis.matcher=(' + createMediaCodecMatcher.toString() + ')();', context);
  const inContext = vm.runInContext('matcher', context);
  vm.runInContext(`
    for (const key of ['charCodeAt', 'slice', 'toLowerCase', 'indexOf', 'substring', 'trim', 'split']) String.prototype[key] = function() { throw new Error('page ' + key); };
    Reflect.apply = () => { throw new Error('page apply'); };
    Array.isArray = () => { throw new Error('page isArray'); };
    Object.getOwnPropertyDescriptor = () => { throw new Error('page descriptor'); };
  `, context);
  for (const [text, rtc] of table) assert.deepEqual(names(inContext.families(text, rtc)), names(matcher.families(text, rtc)), text);
  assert.equal(inContext.mask({ supported: true, hidden: ['h264', 'mp3'] }), 1 | 512);
  assert.equal(inContext.mask({ supported: false, hidden: [] }), matcher.any);
});
