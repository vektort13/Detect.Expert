// ADR-068: ship the same independently reviewed bytes exercised by both browsers.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { archiveProduction, validateProductionManifest } from '../build-production.mjs';
import { GUARD_LAUNCHER_FILES, expectedGuardDelivery } from './guard-launchers-delivery.mjs';
import { GUARD_LAUNCHER_UI_KEYS, GUARD_LAUNCHER_UI_MESSAGES } from '../production-locales-guard-launchers.mjs';
import { ANTIDETECT_UI_KEYS, ANTIDETECT_UI_MESSAGES } from '../production-locales-antidetect.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';
import { API_CONFIGURATION_FORMAT, API_CONFIGURATION_VERSION, API_CONFIGURATION_CATALOG_VERSION, API_CONFIG_CATALOG, API_CONFIG_CATALOG_V6, upgradeApiConfiguration } from '../../apps/production-extension/api-configuration.js';

const root = resolve(import.meta.dirname, '../..'), sha = value => createHash('sha256').update(value).digest('hex');
const evidence = { at: new Date().toISOString(), result: 'PASS', files: [], native: [], locales: [], migrations: [], archives: [] };
// The launchers read the two independent masters. The old shared master of the published format 4 / catalog 6 (before the independent Antidetect master of format 5) still maps to both
// controls of the CURRENT contract, without activating dormant rows; the whole matrix of published pairs is covered by antidetect-package.mjs.
for (const enabled of [false, true]) {
  const historical = { format: API_CONFIGURATION_FORMAT, formatVersion: 4, catalogVersion: 6, enabled, preset: 'custom', webrtcNetworkPolicy: 'default_public_interface_only',
    apis: API_CONFIG_CATALOG_V6.map(entry => ({ ...structuredClone(entry), mode: 'bypass', userValues: [], selected: { kind: 'unset' }, settings: {} })), sites: [], fingerprintProfiles: [] };
  const upgraded = upgradeApiConfiguration(historical); assert.equal(upgraded.ok, true, JSON.stringify(upgraded.error)); assert.equal(upgraded.migrated, true);
  assert.equal(upgraded.value.formatVersion, API_CONFIGURATION_VERSION); assert.equal(upgraded.value.catalogVersion, API_CONFIGURATION_CATALOG_VERSION); assert.equal(upgraded.value.apis.length, API_CONFIG_CATALOG.length);
  assert.equal(upgraded.value.enabled, enabled); assert.equal(upgraded.value.antidetectEnabled, enabled);
  assert.ok(upgraded.value.apis.every(entry => entry.mode === 'bypass'), 'no dormant row is activated by the migration');
  evidence.migrations.push({ from: 4, to: API_CONFIGURATION_VERSION, enabled, apiCount: upgraded.value.apis.length });
}
for (const browser of ['chrome', 'firefox']) {
  const directory = join(root, 'dist', browser), manifestBytes = readFileSync(join(directory, 'manifest.json')), manifest = JSON.parse(manifestBytes);
  assert.deepEqual(validateProductionManifest(manifest, browser), []);
  const baseline = JSON.parse(readFileSync(join(root, 'test-results/production-1.1.0/browser-debug', browser + '.json')));
  assert.equal(sha(manifestBytes), baseline.hashes['manifest.json'], browser + ': unchanged complete manifest');
  const native = JSON.parse(readFileSync(join(root, 'test-results/production-1.1.0/guard-launchers', browser + '.json')));
  assert.equal(native.result, 'PASS'); assert.ok(native.checks.length >= 6); assert.equal(native.ownedLoopbackOnly, true); assert.equal(native.rawUserDataRead, false);
  for (const file of GUARD_LAUNCHER_FILES) {
    const bytes = readFileSync(join(directory, file)); assert.ok(bytes.equals(expectedGuardDelivery(root, file, browser)), browser + ': exact source/dist ' + file);
    assert.equal(sha(bytes), native.hashes[file], browser + ': final native-tested ' + file); evidence.files.push({ browser, file, sha256: sha(bytes) });
  }
  evidence.native.push({ browser, version: native.version, checks: native.checks.length });
  for (const language of PRODUCTION_LANGUAGES) {
    const table = JSON.parse(readFileSync(join(directory, language.uiOnly ? 'ui-locales' : '_locales', language.id, 'messages.json')));
    for (const key of GUARD_LAUNCHER_UI_KEYS) assert.equal(table[key]?.message, GUARD_LAUNCHER_UI_MESSAGES[language.id][key]);
    for (const key of ANTIDETECT_UI_KEYS) assert.equal(table[key]?.message, ANTIDETECT_UI_MESSAGES[language.id][key]);
    evidence.locales.push({ browser, language: language.id, keys: GUARD_LAUNCHER_UI_KEYS.length + ANTIDETECT_UI_KEYS.length });
  }
  const archive = archiveProduction(directory); assert.equal(sha(archive), sha(readFileSync(join(root, 'release', 'Detect.Expert-' + manifest.version + '-' + browser + '.zip'))));
  evidence.archives.push({ browser, bytes: archive.length, sha256: sha(archive) });
}
const output = join(root, 'test-results/production-1.1.0/guard-launchers/package.json'); mkdirSync(resolve(output, '..'), { recursive: true }); writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
console.log('PASS guard launcher package: ' + evidence.files.length + ' exact files, ' + evidence.locales.length + ' locale deliveries, native master matrix and both deterministic ZIPs');
