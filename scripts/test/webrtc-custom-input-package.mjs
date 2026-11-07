// E22-24: ship the complete bytes exercised by the direct manual-IP browser proofs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { archiveProduction, validateProductionManifest } from '../build-production.mjs';
import { WEBRTC_CUSTOM_INPUT_FILES, expectedWebRtcInputDelivery } from './webrtc-custom-input-delivery.mjs';
import { WEBRTC_UI_KEYS, WEBRTC_UI_MESSAGES } from '../production-locales-webrtc.mjs';
import { WEBRTC_DISCOVERY_KEYS, WEBRTC_DISCOVERY_MESSAGES } from '../production-locales-webrtc-discovery.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';

const root = resolve(import.meta.dirname, '../..'), sha = bytes => createHash('sha256').update(bytes).digest('hex');
const result = { at: new Date().toISOString(), result: 'PASS', files: [], locales: [], native: [], archives: [] };
for (const browser of ['chrome', 'firefox']) {
  const directory = join(root, 'dist', browser), manifestBytes = readFileSync(join(directory, 'manifest.json')), manifest = JSON.parse(manifestBytes);
  assert.deepEqual(validateProductionManifest(manifest, browser), []);
  const baseline = JSON.parse(readFileSync(join(root, 'test-results/production-1.1.0/browser-debug', browser + '.json')));
  assert.equal(sha(manifestBytes), baseline.hashes['manifest.json'], browser + ': unchanged complete manifest/permissions/CSP');
  const native = JSON.parse(readFileSync(join(root, 'test-results/production-1.1.0/webrtc-custom-input', browser + '.json')));
  assert.equal(native.result, 'PASS'); assert.equal(native.disposableProfile, true); assert.equal(native.ownedLoopbackOnly, true);
  assert.equal(native.externalStunTurnCalls, false); assert.equal(native.rawUserDataRead, false); assert.ok(native.checks.length >= 6);
  for (const file of WEBRTC_CUSTOM_INPUT_FILES) {
    const bytes = readFileSync(join(directory, file)); assert.ok(bytes.equals(expectedWebRtcInputDelivery(root, file, browser)), browser + ': source/dist ' + file);
    assert.equal(sha(bytes), native.hashes[file], browser + ': native-tested ' + file); result.files.push({ browser, file, sha256: sha(bytes) });
  }
  result.native.push({ browser, version: native.version, checks: native.checks.length });
  for (const language of PRODUCTION_LANGUAGES) {
    const table = JSON.parse(readFileSync(join(directory, language.uiOnly ? 'ui-locales' : '_locales', language.id, 'messages.json')));
    for (const [keys, messages] of [[WEBRTC_UI_KEYS, WEBRTC_UI_MESSAGES], [WEBRTC_DISCOVERY_KEYS, WEBRTC_DISCOVERY_MESSAGES]]) for (const key of keys) assert.equal(table[key]?.message, messages[language.id][key]);
    result.locales.push({ browser, language: language.id, keys: WEBRTC_UI_KEYS.length + WEBRTC_DISCOVERY_KEYS.length });
  }
  const archive = archiveProduction(directory), file = join(root, 'release', 'Detect.Expert-' + manifest.version + '-' + browser + '.zip');
  assert.equal(sha(archive), sha(readFileSync(file))); result.archives.push({ browser, bytes: archive.length, sha256: sha(archive) });
}
const output = join(root, 'test-results/production-1.1.0/webrtc-custom-input/package.json'); mkdirSync(resolve(output, '..'), { recursive: true }); writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log('PASS WebRTC manual IP package: ' + result.files.length + ' exact native-tested files, ' + result.locales.length + ' locale deliveries and both ZIPs');
