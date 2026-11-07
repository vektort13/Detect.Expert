// Round 5 (ADR-101 amendment): what the generated document-start script installs for a Custom media-capabilities row.
// A profile that keeps every flag and hides nothing is the native answer, so it installs nothing at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createApiConfiguration, updateApiConfiguration } from '../../packages/contracts/src/api-configuration.mjs';
import { buildApiCustomScripts } from '../../apps/production-extension/api-custom-registration.js';

const tagged = value => ({ kind: 'value', value });
function change(config, id, patch, host = null) {
  const result = updateApiConfiguration(config, id, patch, host);
  assert.equal(result.ok, true, result.error?.message);
  return result.value;
}
const profile = (flags, hidden = []) => ({ supported: flags[0], smooth: flags[1], powerEfficient: flags[2], hidden });
function generated(value, id = 'media-capabilities') {
  const config = change({ ...createApiConfiguration(), enabled: true, antidetectEnabled: true }, id, { mode: 'custom', selected: tagged(value) });
  const scripts = buildApiCustomScripts(config, ['https://*/*']);
  assert.equal(scripts.length, 1);
  return scripts[0].js[0].code;
}
function page() {
  const context = vm.createContext({ setTimeout, clearTimeout });
  vm.runInContext(`
    globalThis.Navigator = function Navigator() {}; globalThis.navigator = new Navigator();
    globalThis.document = { querySelectorAll() { return []; } };
    globalThis.origin = 'https://example.test'; globalThis.posted = 0;
    globalThis.postMessage = () => { posted++; }; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
    const native = Promise.resolve({ supported: true, smooth: true, powerEfficient: false, keySystemAccess: null });
    // The model converts the dictionary like the native WebIDL converter (audio, video, then type), so the page-side recorder sees every string.
    function convert(input) { for (const part of ['audio', 'video']) { const track = input[part]; if (track !== undefined) String(track.contentType); } String(input.type); return native; }
    globalThis.MediaCapabilities = class MediaCapabilities { decodingInfo(input) { return convert(input); } encodingInfo(input) { return convert(input); } };
    globalThis.ask = (type, contentType) => new MediaCapabilities().decodingInfo({ type, video: { contentType, width: 1, height: 1, bitrate: 1, framerate: 1 } });
    globalThis.HTMLMediaElement = class HTMLMediaElement { canPlayType(type) { return String(type).includes('codecs') ? 'probably' : 'maybe'; } };
    globalThis.MediaSource = class MediaSource { static isTypeSupported(type) { return String(type).includes('codecs'); } };
    globalThis.MediaRecorder = class MediaRecorder { static isTypeSupported() { return true; } };
    globalThis.slots = () => [MediaCapabilities.prototype.decodingInfo, MediaCapabilities.prototype.encodingInfo, HTMLMediaElement.prototype.canPlayType, MediaSource.isTypeSupported, MediaRecorder.isTypeSupported];
    globalThis.nativeSlots = slots();
  `, context);
  return { context, run: code => vm.runInContext(code, context) };
}
const changed = f => JSON.parse(f.run('JSON.stringify(slots().map((value, index) => value !== nativeSlots[index]))'));
const H264 = 'video/mp4; codecs="avc1.42E01E"', VP8 = 'video/webm; codecs="vp8"';

test('a profile that keeps every flag and hides nothing installs neither the bridge nor a type hook', () => {
  const code = generated(profile([true, true, true]));
  for (const marker of ['installMediaCapabilitiesBridge', 'installMediaTypeHooks', 'createMediaCodecMatcher']) assert.equal(code.includes(marker), false, marker);
  const f = page();
  f.run(code);
  assert.deepEqual(changed(f), [false, false, false, false, false]);
  assert.equal(f.run('posted'), 0);
  assert.equal(f.run(`new HTMLMediaElement().canPlayType(${JSON.stringify(H264)})`), 'probably');
});

test('a hidden codec family installs the bridge and the type hooks, and the base installer does not wrap decodingInfo a second time', async () => {
  const code = generated(profile([true, true, true], ['h264']));
  assert.equal(code.includes('mediaTypes(realm, 1, mediaCodecs)'), true);
  const f = page();
  f.run(code);
  assert.deepEqual(changed(f), [true, true, true, true, true]);
  assert.equal(f.run(`new HTMLMediaElement().canPlayType(${JSON.stringify(H264)})`), '');
  assert.equal(f.run(`new HTMLMediaElement().canPlayType(${JSON.stringify(VP8)})`), 'probably');
  assert.equal(f.run("new HTMLMediaElement().canPlayType('video/mp4')"), 'maybe');
  assert.equal(f.run(`MediaSource.isTypeSupported(${JSON.stringify(H264)})`), false);
  assert.equal(f.run(`MediaSource.isTypeSupported(${JSON.stringify(VP8)})`), true);
  assert.equal(f.run(`MediaRecorder.isTypeSupported(${JSON.stringify(H264)})`), false);
  assert.equal(f.run(`MediaRecorder.isTypeSupported(${JSON.stringify(VP8)})`), true);
  const wrapper = f.run('String(MediaCapabilities.prototype.decodingInfo)');
  assert.equal(wrapper.includes('recordArguments'), true, 'the bridge owns decodingInfo');
  assert.equal(wrapper.includes('asyncPreflight'), false, 'the legacy flag installer is not layered on top');
  assert.equal(f.run('posted'), 0, 'installing sends nothing');
  // decodingInfo lowers the page's own native answer ({supported, smooth, no power efficiency}) by the hidden family of the codec string.
  const answer = async (type, contentType) => { const value = await f.run(`ask(${JSON.stringify(type)}, ${JSON.stringify(contentType)})`); return [value.supported, value.smooth, value.powerEfficient]; };
  assert.deepEqual(await answer('file', H264), [false, false, false]);
  assert.deepEqual(await answer('file', VP8), [true, true, false]);
  assert.deepEqual(await answer('webrtc', 'video/H264'), [false, false, false]);
  assert.equal(f.run('posted'), 0, 'a configuration without a key system never reaches the relay');
});

test('lowered flags without a hidden family install the bridge only', () => {
  const code = generated(profile([true, false, false]));
  assert.equal(code.includes('installMediaCapabilitiesBridge'), true);
  assert.equal(code.includes('installMediaTypeHooks'), false);
  const f = page();
  f.run(code);
  assert.deepEqual(changed(f), [true, true, false, false, false]);
});

test('supported false hides every codec-naming query and keeps container-only queries native', () => {
  const code = generated(profile([false, false, false]));
  assert.equal(code.includes('mediaTypes(realm, 1048576, mediaCodecs)'), true);
  const f = page();
  f.run(code);
  assert.deepEqual(changed(f), [true, true, true, true, true]);
  assert.equal(f.run(`new HTMLMediaElement().canPlayType(${JSON.stringify(VP8)})`), '');
  assert.equal(f.run("new HTMLMediaElement().canPlayType('audio/mpeg')"), '');
  assert.equal(f.run("new HTMLMediaElement().canPlayType('video/mp4')"), 'maybe');
  assert.equal(f.run(`MediaSource.isTypeSupported(${JSON.stringify(VP8)})`), false);
});

test('the hidden-family mask in the script follows the contract bit order', () => {
  assert.equal(generated(profile([true, true, true], ['mp3', 'dolby'])).includes('mediaTypes(realm, 1536, mediaCodecs)'), true, 'mp3 is bit 9 and dolby bit 10: 512 + 1024');
  assert.equal(generated(profile([true, true, true], ['av1', 'h265', 'h264'])).includes('mediaTypes(realm, 7, mediaCodecs)'), true);
});

// A catalog-9 export (round 4, published) stores the media-capabilities value with three flags. It migrates with no hidden family
// and from then on the page only ever sees the native answer lowered by those flags.
import { readFileSync } from 'node:fs';
import { importApiConfiguration, validateApiConfiguration } from '../../apps/production-extension/api-configuration.js';
const PUBLISHED = JSON.parse(readFileSync(new URL('./api-configuration-catalog9-export.fixture.json', import.meta.url), 'utf8'));
function stored(value) {
  const config = structuredClone(PUBLISHED);
  config.enabled = true;
  config.antidetectEnabled = true;
  // Only the media row is Custom: the other published rows would need persisted seeds, which this test is not about.
  config.sites = [];
  config.fingerprintProfiles = [];
  for (const entry of config.apis) if (entry.id !== 'media-capabilities') { entry.mode = 'bypass'; entry.selected = { kind: 'unset' }; }
  const row = config.apis.find(entry => entry.id === 'media-capabilities');
  row.mode = 'custom';
  row.selected = { kind: 'value', value };
  return config;
}
test('a stored catalog 9 value migrates with no hidden family and only lowers the native answer from then on', () => {
  const forced = stored({ supported: true, smooth: true, powerEfficient: true });
  assert.equal(forced.catalogVersion, 9);
  const migrated = importApiConfiguration(JSON.stringify(forced));
  assert.equal(migrated.ok, true, migrated.error?.message);
  assert.deepEqual(migrated.value.apis.find(entry => entry.id === 'media-capabilities').selected.value, { hidden: [], powerEfficient: true, smooth: true, supported: true });
  // Before round 5 this profile FORCED supported/smooth/powerEfficient to true even where the browser said false; now it is the native answer.
  const [identity] = buildApiCustomScripts(migrated.value, ['https://*/*']);
  const f = page();
  f.run(identity.js[0].code);
  assert.deepEqual(changed(f), [false, false, false, false, false]);
  // A lowered stored value keeps lowering: the bridge answers with native AND the stored flags.
  const [lowered] = buildApiCustomScripts(importApiConfiguration(JSON.stringify(stored({ supported: true, smooth: false, powerEfficient: false }))).value, ['https://*/*']);
  const g = page();
  g.run(lowered.js[0].code);
  assert.deepEqual(changed(g), [true, true, false, false, false]);
  assert.equal(lowered.js[0].code.includes('installMediaTypeHooks'), false);
  // The older three-field shape is not valid input of the current catalog, so nothing can reach the backend without the hidden field.
  const current = structuredClone(migrated.value);
  delete current.apis.find(entry => entry.id === 'media-capabilities').selected.value.hidden;
  assert.equal(validateApiConfiguration(current).ok, false);
});
