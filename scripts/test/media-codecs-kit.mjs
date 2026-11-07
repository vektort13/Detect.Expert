// Round 5 (ADR-101 amendment): shared by the two native codec checks (api-custom-native-shapes-native.mjs runs the real pieces in a
// page, api-custom-media-extension-native.mjs runs the packaged extension). A Custom media profile can only LOWER what the browser
// really reports, so every expectation comes from an independent oracle over the NATIVE answers of the same browser: the check adapts
// to the codecs the machine really has. Only booleans, short strings and counts are compared; no media is decoded or encoded.
import assert from 'node:assert/strict';

const videoConfig = contentType => ({ type: 'file', video: { contentType, width: 640, height: 360, bitrate: 1000000, framerate: 30 } });
const audioConfig = contentType => ({ type: 'file', audio: { contentType, channels: '2', bitrate: 128000, samplerate: 48000 } });
// family null = a container-only type, which is never hidden. audio/flac and audio/mpeg are codec-specific MIME types.
export const CODEC_QUERIES = Object.freeze([
  { family: 'h264', type: 'video/mp4; codecs="avc1.42E01E"', config: videoConfig('video/mp4; codecs="avc1.42E01E"') },
  { family: 'h265', type: 'video/mp4; codecs="hvc1.1.6.L93.B0"', config: videoConfig('video/mp4; codecs="hvc1.1.6.L93.B0"') },
  { family: 'av1', type: 'video/mp4; codecs="av01.0.04M.08"', config: videoConfig('video/mp4; codecs="av01.0.04M.08"') },
  { family: 'vp9', type: 'video/webm; codecs="vp09.00.10.08"', config: videoConfig('video/webm; codecs="vp09.00.10.08"') },
  { family: 'vp8', type: 'video/webm; codecs="vp8"', config: videoConfig('video/webm; codecs="vp8"') },
  { family: 'aac', type: 'audio/mp4; codecs="mp4a.40.2"', config: audioConfig('audio/mp4; codecs="mp4a.40.2"') },
  { family: 'opus', type: 'audio/webm; codecs="opus"', config: audioConfig('audio/webm; codecs="opus"') },
  { family: 'vorbis', type: 'audio/ogg; codecs="vorbis"', config: audioConfig('audio/ogg; codecs="vorbis"') },
  { family: 'flac', type: 'audio/flac', config: audioConfig('audio/flac') },
  { family: 'mp3', type: 'audio/mpeg', config: audioConfig('audio/mpeg') },
  { family: 'dolby', type: 'audio/mp4; codecs="ec-3"', config: audioConfig('audio/mp4; codecs="ec-3"') },
  { family: null, type: 'video/mp4', config: videoConfig('video/mp4') },
  { family: null, type: 'audio/webm', config: audioConfig('audio/webm') }
]);
// A key-system configuration (ClearKey is the one every browser ships): it keeps the private route, so it is probed separately.
export const DRM_QUERY = Object.freeze({ type: 'file', video: { contentType: 'video/webm; codecs="vp8"', width: 640, height: 360, bitrate: 1000000, framerate: 30 },
  keySystemConfiguration: { keySystem: 'org.w3.clearkey', initDataType: 'keyids', distinctiveIdentifier: 'optional', persistentState: 'optional', sessionTypes: ['temporary'], video: { robustness: '' } } });
export const RTC_QUERIES = Object.freeze([
  { family: 'h264', config: { type: 'webrtc', video: { contentType: 'video/H264', width: 640, height: 360, bitrate: 1000000, framerate: 30 } } },
  { family: 'vp8', config: { type: 'webrtc', video: { contentType: 'video/VP8', width: 640, height: 360, bitrate: 1000000, framerate: 30 } } },
  { family: 'opus', config: { type: 'webrtc', audio: { contentType: 'audio/opus', channels: '2', bitrate: 128000, samplerate: 48000 } } }
]);
export const CODEC_PROFILES = Object.freeze({
  hide: { supported: true, smooth: true, powerEfficient: true, hidden: ['h264', 'aac', 'mp3', 'h265', 'dolby'] },
  lower: { supported: true, smooth: false, powerEfficient: false, hidden: [] },
  mixed: { supported: true, smooth: true, powerEfficient: false, hidden: ['vp8', 'opus'] },
  unsupported: { supported: false, smooth: false, powerEfficient: false, hidden: [] },
  same: { supported: true, smooth: true, powerEfficient: true, hidden: [] }
});

// Runs inside a page or frame (serialized with toString): reads every answer and the outcomes of calls a profile must not touch.
export function pageKit() {
  const outcome = async operation => { try { return await operation(); } catch (error) { return 'throw:' + error.name; } };
  const detail = async operation => { try { return await operation(); } catch (error) { return 'throw:' + error.name + ':' + error.message; } };
  const triple = info => [info.supported, info.smooth, info.powerEfficient];
  async function snapshot(queries, rtc, drm) {
    const video = document.createElement('video'), audio = document.createElement('audio'), result = { decode: [], play: [], mse: [], rec: [], rtcDecode: [], rtcEncode: [] };
    for (const query of queries) {
      result.decode.push(await outcome(async () => triple(await navigator.mediaCapabilities.decodingInfo(query.config))));
      result.play.push([video.canPlayType(query.type), audio.canPlayType(query.type)]);
      result.mse.push(MediaSource.isTypeSupported(query.type));
      result.rec.push(MediaRecorder.isTypeSupported(query.type));
    }
    for (const query of rtc) {
      result.rtcDecode.push(await outcome(async () => triple(await navigator.mediaCapabilities.decodingInfo(query.config))));
      result.rtcEncode.push(await outcome(async () => triple(await navigator.mediaCapabilities.encodingInfo(query.config))));
    }
    result.drm = await outcome(async () => { const info = await navigator.mediaCapabilities.decodingInfo(drm); return [...triple(info), info.keySystemAccess === null ? 'null' : typeof info.keySystemAccess]; });
    return result;
  }
  // Outcomes (value, error name and message) that must be identical with and without a profile: wrong receivers, missing and odd arguments.
  async function edges(queries) {
    const video = document.createElement('video'), config = queries[0].config, object = { toString() { return queries[0].type; } };
    return {
      playNone: await detail(() => video.canPlayType()), playUndefined: video.canPlayType(undefined), playNull: video.canPlayType(null), playNumber: video.canPlayType(5), playObject: video.canPlayType(object),
      playWrongReceiver: await detail(() => Reflect.apply(HTMLMediaElement.prototype.canPlayType, {}, ['video/mp4'])), mseNone: await detail(() => MediaSource.isTypeSupported()),
      mseObject: MediaSource.isTypeSupported(object), recNone: await detail(() => MediaRecorder.isTypeSupported()),
      decodeNone: await detail(() => navigator.mediaCapabilities.decodingInfo()), decodeEmpty: await detail(() => navigator.mediaCapabilities.decodingInfo({})),
      decodeBadType: await detail(() => navigator.mediaCapabilities.decodingInfo({ ...config, type: 'nonsense' })),
      decodeWrongReceiver: await detail(() => Reflect.apply(MediaCapabilities.prototype.decodingInfo, {}, [config])),
      decodeNullVideo: await detail(() => navigator.mediaCapabilities.decodingInfo({ type: 'file', video: null }))
    };
  }
  async function shape(queries) {
    const info = navigator.mediaCapabilities.decodingInfo(queries[0].config), value = await info;
    return { promise: info instanceof Promise, plain: Object.getPrototypeOf(value) === Object.prototype, keys: Reflect.ownKeys(value).join(','), access: value.keySystemAccess };
  }
  const references = () => [HTMLMediaElement.prototype.canPlayType, MediaSource.isTypeSupported, MediaRecorder.isTypeSupported, MediaCapabilities.prototype.decodingInfo, MediaCapabilities.prototype.encodingInfo];
  return { snapshot, edges, shape, references };
}
// `target.evaluate(function, argument)` is the one shape a Playwright page and the geckodriver wrapper of the Firefox native share.
const KIT_SOURCE = 'globalThis.__codecKit = (' + pageKit.toString() + ')()';
// Defines globalThis.__codecKit in the page.
export const installKit = target => target.evaluate(source => { (0, eval)(source); }, KIT_SOURCE);
// Reads the answers in the page, or in a new same-origin about:blank frame of it (the descendant realm gets its own installation).
export const readKit = (target, queries = CODEC_QUERIES, rtc = RTC_QUERIES, { frame = false } = {}) => target.evaluate(async ([q, r, framed, source, drm]) => {
  let scope = globalThis;
  if (framed) { const element = document.createElement('iframe'); document.body.append(element); scope = element.contentWindow; scope.eval(source); }
  return { snapshot: await scope.__codecKit.snapshot(q, r, drm), edges: await scope.__codecKit.edges(q) };
}, [queries, rtc, frame, KIT_SOURCE, DRM_QUERY]);

// The independent oracle: what a Custom profile may make of one NATIVE answer.
export const codecHidden = (query, profile) => query.family !== null && (!profile.supported || profile.hidden.includes(query.family));
export const lowerTriple = (native, query, profile) => {
  if (typeof native === 'string') return native;
  const shown = profile.supported && native[0] && !(query.family !== null && profile.hidden.includes(query.family));
  return [shown, shown && profile.smooth && native[1], shown && profile.powerEfficient && native[2]];
};

// Asserts one profile's answers against the native ones; returns counters so a caller can prove the check was not vacuous.
export function assertLowered(name, profile, native, got) {
  let lowered = 0, kept = 0, neverRaised = 0;
  CODEC_QUERIES.forEach((query, index) => {
    const label = name + ' ' + (query.family ?? 'container') + ' ' + query.type;
    const expectedDecode = lowerTriple(native.decode[index], query, profile);
    assert.deepEqual(got.decode[index], expectedDecode, label + ': decodingInfo is native AND custom, lowered by a hidden family');
    if (JSON.stringify(expectedDecode) !== JSON.stringify(native.decode[index])) lowered++; else kept++;
    if (typeof native.decode[index] !== 'string' && native.decode[index][0] === false) { neverRaised++; assert.deepEqual(got.decode[index], [false, false, false], label + ': a native false is never raised'); }
    native.play[index].forEach((answer, element) => {
      assert.equal(got.play[index][element], answer === '' ? '' : codecHidden(query, profile) ? '' : answer, label + ': canPlayType (' + (element ? 'audio' : 'video') + ')');
      if (answer === '') neverRaised++;
    });
    for (const [key, what] of [['mse', 'MediaSource'], ['rec', 'MediaRecorder']]) {
      assert.equal(got[key][index], native[key][index] === true && codecHidden(query, profile) ? false : native[key][index], label + ': ' + what + '.isTypeSupported');
      if (native[key][index] === false) neverRaised++;
    }
  });
  RTC_QUERIES.forEach((query, index) => {
    for (const [key, what] of [['rtcDecode', 'decodingInfo'], ['rtcEncode', 'encodingInfo']]) {
      assert.deepEqual(got[key][index], lowerTriple(native[key][index], query, profile), name + ' webrtc ' + query.family + ': ' + what);
      if (typeof native[key][index] !== 'string' && native[key][index][0] === false) assert.deepEqual(got[key][index], [false, false, false], name + ' webrtc ' + query.family + ': a native false is never raised');
    }
  });
  const identity = profile.supported && profile.smooth && profile.powerEfficient && profile.hidden.length === 0;
  if (identity) assert.equal(lowered, 0, name + ': a profile that keeps every flag lowers nothing'); else assert.ok(lowered >= 1, name + ': the profile lowered at least one real answer');
  return { lowered, kept, neverRaised };
}
// A key-system configuration keeps the private route: with an installed profile Custom true rejects it (a MediaKeySystemAccess cannot be
// synthesized) and Custom false is virtual unsupported; without an installed profile the answer is the native one.
export function assertDrm(name, profile, native, got, { installed }) {
  const expected = !installed ? native.drm : profile.supported ? 'throw:NotSupportedError' : [false, false, false, 'null'];
  assert.deepEqual(got.drm, expected, name + ': key-system configuration (ClearKey)');
}
// Families whose typed query this browser answers with "" (so "never raised above native" is exercised).
export const absentFamilies = native => CODEC_QUERIES.filter((query, index) => query.family !== null && native.play[index][0] === '').map(query => query.family);
