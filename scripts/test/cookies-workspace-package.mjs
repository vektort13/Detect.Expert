// ADR-069: final native-tested bytes, optional grants, complete locales and deterministic release archives.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { archiveProduction, productionManifest, validateProductionManifest } from '../build-production.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';
import { COOKIE_FILES, expectedCookieDelivery } from './cookies-workspace-delivery.mjs';
import { COOKIES_WORKSPACE_KEYS, COOKIES_WORKSPACE_MESSAGES } from '../production-locales-cookies.mjs';
import { readEvidence, writeEvidence } from './native-evidence.mjs';

const root = resolve(import.meta.dirname, '../..'), sha = value => createHash('sha256').update(value).digest('hex');
const result = { at: new Date().toISOString(), result: 'PASS', files: [], locales: [], native: [], archives: [] };
for (const browser of ['chrome', 'firefox']) {
  const directory = join(root, 'dist', browser), manifestBytes = readFileSync(join(directory, 'manifest.json')), manifest = JSON.parse(manifestBytes);
  assert.deepEqual(validateProductionManifest(manifest, browser), []); assert.deepEqual(manifest, productionManifest(browser, manifest.version));
  // ADR-069: the workspace adds no install-time permission and no CSP host; cookies is an optional grant asked for by a button.
  assert.ok(!manifest.permissions.includes('cookies'), browser + ': cookies is never an install-time permission');
  assert.ok(manifest.optional_permissions.includes('cookies'), browser + ': cookies is an optional permission');
  // Metadata-only Browser Debug (ADR-063) is delivered byte for byte from source; its own unit tests pin the behaviour.
  for (const file of ['browser-debug-controller.js', 'browser-debug-data.js']) assert.ok(readFileSync(join(directory, file)).equals(readFileSync(join(root, 'apps/production-extension', file))), browser + ': ' + file + ' is delivered from source');
  // The evidence of the current version only: an older folder could never describe these bytes (the hashes below would differ anyway).
  const found = readEvidence('cookies-workspace/' + browser + '.json');
  assert.ok(found && found.legacy === false, browser + ': no Cookies native evidence for this version (run the native first: pnpm test:cookies)');
  const native = found.value;
  assert.equal(native.result, 'PASS'); assert.equal(native.disposableProfile, true); assert.equal(native.rawUserDataRead, false); assert.ok(native.checks.length >= 8);
  for (const file of COOKIE_FILES) {
    const bytes = readFileSync(join(directory, file));
    if (file !== 'manifest.json') assert.ok(bytes.equals(expectedCookieDelivery(root, file, browser)), browser + ': full source/dist ' + file);
    assert.equal(sha(bytes), native.hashes[file], browser + ': final native-tested ' + file); result.files.push({ browser, file, sha256: sha(bytes) });
  }
  result.native.push({ browser, version: native.version, checks: native.checks.length });
  for (const language of PRODUCTION_LANGUAGES) {
    const table = JSON.parse(readFileSync(join(directory, language.uiOnly ? 'ui-locales' : '_locales', language.id, 'messages.json')));
    for (const key of COOKIES_WORKSPACE_KEYS) assert.equal(table[key]?.message, COOKIES_WORKSPACE_MESSAGES[language.id][key], browser + ':' + language.id + ':' + key);
    result.locales.push({ browser, language: language.id, keys: COOKIES_WORKSPACE_KEYS.length });
  }
  const archive = archiveProduction(directory), file = join(root, 'release', 'Detect.Expert-' + manifest.version + '-' + browser + '.zip');
  assert.equal(sha(archive), sha(readFileSync(file))); result.archives.push({ browser, bytes: archive.length, sha256: sha(archive) });
}
writeEvidence('cookies-workspace/package.json', result);
console.log('PASS Cookies package: ' + result.files.length + ' exact files, ' + result.locales.length + ' locale deliveries and both deterministic ZIPs');
