// ADR-107: private per-profile keys reach exactly their rows in the registered MAIN source: audio-fingerprint -> entry.audioKey,
// webgl-readback -> entry.webglKey (+ entry.canvasKey when canvas-readback is Custom in the same scope), network-information ->
// entry.networkKey. A Custom row with a value and no valid key is a registration error, never a silently unkeyed projection.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
// The production copy of the contract: the module buildApiCustomScripts validates with.
import { createApiConfiguration, updateApiConfiguration } from '../../apps/production-extension/api-configuration.js';
import { buildApiCustomScripts, apiCustomSiteScriptId } from '../../apps/production-extension/api-custom-registration.js';
import { AUDIO_MOCKS, surfaceFixture, originOf } from './surface-test-kit.mjs';
import { GL_MOCKS, canvasReference, flipRows, pixels } from './webgl-readback-kit.mjs';

const KEYS = { canvasSeed: '1'.repeat(64), audioSeed: 'a1'.repeat(32), webglSeed: 'b2'.repeat(32), networkSeed: 'c3'.repeat(32) };
const AUDIO_VALUE = { seed: '00112233445566778899aabbccddeeff', amplitude: 0.00001 };
function change(config, id, patch, host = null) { const result = updateApiConfiguration(config, id, patch, host); assert.equal(result.ok, true, result.error?.message); return result.value; }
const custom = (config, id, value, host = null) => change(config, id, { mode: 'custom', selected: { kind: 'value', value } }, host);
const base = () => ({ ...createApiConfiguration(), enabled: true, antidetectEnabled: true });
// The packed entries embedded in the generated source (the literal is JSON with <, >, &, U+2028/9 escaped).
const packed = script => JSON.parse(/\n {2}const packed = (.*);\n/.exec(script.js[0].code)[1]);
const row = (script, id) => packed(script).find(entry => entry.id === id);

test('every keyed row requires its own valid key; rows that are not Custom need none and embed none', () => {
  const rows = [['audio-fingerprint', AUDIO_VALUE, 'audioSeed', /Audio profiles require a persisted profile key/], ['webgl-readback', { seed: AUDIO_VALUE.seed }, 'webglSeed', /WebGL readback profiles require a persisted profile key/],
    ['network-information', { downlink: 10, effectiveType: '4g', rtt: 50, saveData: false }, 'networkSeed', /Network Information profiles require a persisted profile key/]];
  for (const [id, value, seed, message] of rows) {
    const config = custom(base(), id, value), others = Object.fromEntries(Object.entries(KEYS).filter(([name]) => name !== seed));
    assert.throws(() => buildApiCustomScripts(config, ['https://*/*'], others), error => error instanceof TypeError && message.test(error.message), id + ': missing');
    for (const invalid of ['ab'.repeat(31), 'AB'.repeat(32), 'g'.repeat(64), 42, null]) assert.throws(() => buildApiCustomScripts(config, ['https://*/*'], { ...others, [seed]: invalid }), message, id + ': ' + invalid);
    const [script] = buildApiCustomScripts(config, ['https://*/*'], KEYS);
    const field = { audioSeed: 'audioKey', webglSeed: 'webglKey', networkSeed: 'networkKey' }[seed];
    assert.equal(row(script, id)[field], KEYS[seed], id + ' carries ' + field);
    assert.deepEqual(row(script, id).selected, { kind: 'value', value }, 'the portable value (and its seed) stays as it was');
    // Allow / inherited Bypass: no key is required and no key is embedded (these rows have no Block mode).
    for (const mode of ['off', 'bypass']) {
      const scripts = buildApiCustomScripts(custom(change(config, id, { mode }), 'hardware-concurrency', 8), ['https://*/*']);
      for (const key of Object.values(KEYS)) assert.equal(scripts[0].js[0].code.includes(key), false, id + ' ' + mode);
    }
  }
  // Unrelated keys are never embedded.
  const [only] = buildApiCustomScripts(custom(base(), 'hardware-concurrency', 8), ['https://*/*'], KEYS);
  for (const key of Object.values(KEYS)) assert.equal(only.js[0].code.includes(key), false);
});

test('webgl-readback carries canvasKey only in scopes where canvas-readback is Custom too', () => {
  let config = custom(base(), 'webgl-readback', { seed: AUDIO_VALUE.seed });
  config = custom(config, 'canvas-readback', { algorithm: 'sparse-rgb-v1' });
  config = change(config, 'canvas-readback', { mode: 'off' }, 'plain.example');
  config = custom(config, 'hardware-concurrency', 4, 'other.example');
  const scripts = buildApiCustomScripts(config, ['https://*/*'], KEYS);
  const global = scripts.find(script => script.id.endsWith('-global')), plain = scripts.find(script => script.id === apiCustomSiteScriptId('plain.example'));
  const other = scripts.find(script => script.id === apiCustomSiteScriptId('other.example'));
  assert.deepEqual([row(global, 'webgl-readback').webglKey, row(global, 'webgl-readback').canvasKey], [KEYS.webglSeed, KEYS.canvasSeed]);
  assert.equal(row(global, 'canvas-readback').canvasSeed, KEYS.canvasSeed);
  assert.equal(row(other, 'webgl-readback').canvasKey, KEYS.canvasSeed, 'an inherited global canvas row counts');
  assert.equal(row(plain, 'webgl-readback').webglKey, KEYS.webglSeed); assert.equal(Object.hasOwn(row(plain, 'webgl-readback'), 'canvasKey'), false);
  assert.equal(plain.js[0].code.includes(KEYS.canvasSeed), false, 'no Canvas key where Canvas is not Custom');
  // The Canvas key is still validated when the WebGL row comes first.
  assert.throws(() => buildApiCustomScripts(config, ['https://*/*'], { ...KEYS, canvasSeed: 'x' }), /Canvas profiles require a persisted profile seed/);
});

test('the compiled source hands the keys to the installers: audio is keyed by audioKey, readPixels equals the Canvas projection', () => {
  let config = custom(base(), 'audio-fingerprint', AUDIO_VALUE);
  config = custom(config, 'webgl-readback', { seed: AUDIO_VALUE.seed });
  config = custom(config, 'canvas-readback', { algorithm: 'stable-rgb-v1' });
  const [script] = buildApiCustomScripts(config, ['https://*/*'], KEYS);
  const realm = vm.createContext({ DOMException });
  // The document installer only treats a realm with Navigator.prototype as a window.
  vm.runInContext(AUDIO_MOCKS + GL_MOCKS + originOf('https://top.example') + 'globalThis.Navigator = function Navigator() {}; globalThis.navigator = new Navigator(); globalThis.document = { querySelectorAll() { return []; } };', realm);
  vm.runInContext(script.js[0].code, realm);
  // Audio: the registered source and a direct installation with the same private key give the same bits; another key does not.
  const sample = '(() => { const buffer = engineBuffer({ length: 64, sampleRate: 44100 }); buffer.getChannelData(0); return bitsOf(rawChannel(buffer), 0, 16); })()';
  const direct = key => surfaceFixture([{ id: 'audio-fingerprint', value: AUDIO_VALUE, audioKey: key }], { mocks: AUDIO_MOCKS, setup: originOf('https://top.example') })(sample);
  assert.equal(vm.runInContext(sample, realm), direct(KEYS.audioSeed)); assert.notEqual(direct(KEYS.audioSeed), direct(KEYS.webglSeed));
  // WebGL: keyed by the Canvas key and the Canvas algorithm of the same scope.
  const source = pixels(24, 18, 'mixed', 11); realm.source = source;
  const bytes = vm.runInContext('sources.s = source; const gl = makeContext(false, 24, 18, "s"); const out = new Uint8Array(24 * 18 * 4); gl.readPixels(0, 0, 24, 18, 6408, 5121, out); out', realm);
  const expected = canvasReference({ algorithm: 'stable-rgb-v1', seed: KEYS.canvasSeed, origin: 'https://top.example' })(source, 24, 18);
  assert.ok(Buffer.from(flipRows(bytes, 24, 18)).equals(Buffer.from(expected)));
});
