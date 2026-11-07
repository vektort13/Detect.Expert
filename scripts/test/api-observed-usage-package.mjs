// ADR-067: actual native-tested UI bytes, locales, permissions and ZIP delivery.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { archiveProduction, validateProductionManifest } from '../build-production.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';
import { API_OBSERVED_UI_KEYS, API_OBSERVED_UI_MESSAGES } from '../production-locales-api-observed.mjs';
import { API_OBSERVED_DELIVERY_FILES, expectedDelivered } from './api-observed-delivery.mjs';

const root = resolve(import.meta.dirname, '../..'), source = join(root, 'apps/production-extension');
const sha = value => createHash('sha256').update(value).digest('hex');
const files = API_OBSERVED_DELIVERY_FILES;
const result = { at: new Date().toISOString(), result: 'PASS', files: [], native: [], locales: [], archives: [] };
const sourceManifest = JSON.parse(readFileSync(join(source, 'manifest.json')));
for (const browser of ['chrome', 'firefox']) {
  const directory = join(root, 'dist', browser), manifest = JSON.parse(readFileSync(join(directory, 'manifest.json')));
  assert.deepEqual(validateProductionManifest(manifest, browser), []);
  for (const key of ['permissions', 'optional_permissions', 'host_permissions', 'optional_host_permissions', 'content_security_policy']) {
    if (browser === 'chrome') assert.deepEqual(manifest[key], sourceManifest[key], 'Chrome manifest unchanged: ' + key);
  }
  // ADR-075 added the required Chrome-only debugger permission (Autosurfer); Firefox must still ship none.
  if (browser === 'firefox') assert.equal(manifest.permissions.includes('debugger') || (manifest.optional_permissions ?? []).includes('debugger'), false, 'Firefox ships no debugger permission');
  for (const file of files) {
    const delivered = readFileSync(join(directory, file)), expected = expectedDelivered(source, file, browser);
    assert.ok(delivered.equals(expected), browser + ': exact source/approved-transform/dist ' + file);
    result.files.push({ browser, file, sha256: sha(delivered) });
  }
  const evidencePath = join(root, 'test-results/production-1.1.0/api-observed/usage-' + browser + '.json');
  const evidence = JSON.parse(readFileSync(evidencePath));
  assert.equal(evidence.result, 'PASS'); assert.ok(evidence.checks.length >= 8); assert.equal(evidence.ownedLoopbackOnly, true); assert.equal(evidence.rawValuesPersisted, false);
  assert.equal(evidence.sourceDistMatch, true);
  for (const file of files) assert.equal(evidence.hashes[file], sha(readFileSync(join(directory, file))), browser + ': native-tested final file ' + file);
  result.native.push({ browser, version: evidence.version, checks: evidence.checks.length, fileHashes: files.length });
  for (const language of PRODUCTION_LANGUAGES) {
    const table = JSON.parse(readFileSync(join(directory, language.uiOnly ? 'ui-locales' : '_locales', language.id, 'messages.json')));
    for (const key of API_OBSERVED_UI_KEYS) assert.equal(table[key]?.message, API_OBSERVED_UI_MESSAGES[language.id][key], browser + ': localized ' + language.id + ':' + key);
    result.locales.push({ browser, language: language.id, keys: API_OBSERVED_UI_KEYS.length });
  }
  const archive = archiveProduction(directory), file = join(root, 'release', 'Detect.Expert-' + manifest.version + '-' + browser + '.zip');
  assert.equal(sha(readFileSync(file)), sha(archive), browser + ': full deterministic ZIP matches tested delivery');
  result.archives.push({ browser, bytes: archive.length, sha256: sha(archive) });
}
const output = join(root, 'test-results/production-1.1.0/api-observed/package.json'); mkdirSync(resolve(output, '..'), { recursive: true }); writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log('PASS observed API package: ' + result.files.length + ' exact files; ' + result.locales.length + ' locale deliveries × ' + API_OBSERVED_UI_KEYS.length + ' messages; both native proofs and complete ZIPs');
