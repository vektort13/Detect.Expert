// ADR-017: syntax and source provenance checks for the delivered codebase.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runtimeSource } from './pro-values-runtime.mjs';
import { proTechnicalRuntimeSource } from './pro-technical-values-runtime.mjs';
import { loaderSensorRuntimeSource } from './loader-sensor-runtime.mjs';
import { socialSensorRuntimeSource } from './social-sensor-runtime.mjs';
import { workerSurfacesRuntimeSource } from './worker-surfaces-runtime.mjs';
import { extendedSurfacesRuntimeSource } from './extended-surfaces-runtime.mjs';
import { mathSignatureRuntimeSource } from './math-signature-runtime.mjs';
import { cookieWriterRuntimeSource } from './cookie-writer-runtime.mjs';
const root = resolve(import.meta.dirname, '../..');
export function verifyProductionSource(source) {
  assert.equal(resolve(source), join(root, 'apps/production-extension'));
  const provenance = JSON.parse(readFileSync(join(source, 'PROVENANCE.json'), 'utf8'));
  const baseline = resolve(root, provenance.baseline);
  assert.ok(baseline.startsWith(join(root, 'release') + sep));
  for (const entry of existsSync(baseline) ? provenance.files : []) {
    const file = resolve(baseline, entry.path);
    assert.ok(file.startsWith(baseline + sep));
    assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), entry.sha256, 'preserved baseline changed: ' + entry.path);
  }
  const common = ['hook.early.js', 'hook.main.js', 'bridge.js', 'background.js', 'popup.js', 'sidepanel.js', 'report.js'];
  const precursorModes = spawnSync(process.execPath, [join(root, 'scripts/production/sync-precursor-modes.mjs'), '--check'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(precursorModes.status, 0, precursorModes.error?.message ?? (precursorModes.stderr || precursorModes.stdout));
  const autosurf = spawnSync(process.execPath, [join(root, 'scripts/production/sync-autosurf-runtime.mjs'), '--check'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(autosurf.status, 0, autosurf.error?.message ?? (autosurf.stderr || autosurf.stdout));
  const autosurfSites = spawnSync(process.execPath, [join(root, 'scripts/build-autosurf-sites.mjs'), '--check'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(autosurfSites.status, 0, autosurfSites.error?.message ?? (autosurfSites.stderr || autosurfSites.stdout));
  const siteSystems = spawnSync(process.execPath, [join(root, 'scripts/production/sync-site-systems-ui.mjs'), '--check'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(siteSystems.status, 0, siteSystems.error?.message ?? (siteSystems.stderr || siteSystems.stdout));
  const systemIcons = spawnSync(process.execPath, [join(root, 'scripts/build-system-icons.mjs'), '--check'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(systemIcons.status, 0, systemIcons.error?.message ?? (systemIcons.stderr || systemIcons.stdout));
  const precursor = spawnSync(process.execPath, [join(root, 'scripts/production/sync-precursor-runtime.mjs'), '--check'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(precursor.status, 0, precursor.error?.message ?? (precursor.stderr || precursor.stdout));
  const clearReset = spawnSync(process.execPath, [join(root, 'scripts/production/sync-clear-reset.mjs'), '--check'], { encoding: 'utf8', timeout: 60000 });
  assert.equal(clearReset.status, 0, clearReset.error?.message ?? (clearReset.stderr || clearReset.stdout));
  const documentLifecycle = spawnSync(process.execPath, [join(root, 'scripts/production/sync-pro-document-lifecycle.mjs'), '--check'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(documentLifecycle.status, 0, documentLifecycle.stderr || documentLifecycle.stdout);
  const webAssemblyProtection = spawnSync(process.execPath, [join(root, 'scripts/production/sync-webassembly-protection.mjs'), '--check'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(webAssemblyProtection.status, 0, webAssemblyProtection.stderr || webAssemblyProtection.stdout);
  const protection = spawnSync(process.execPath, [join(root, 'scripts/production/sync-protection-runtime.mjs'), '--check'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(protection.status, 0, protection.stderr || protection.stdout);
  const webAssembly = spawnSync(process.execPath, [join(root, 'scripts/production/sync-webassembly-runtime.mjs'), '--check'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(webAssembly.status, 0, webAssembly.stderr || webAssembly.stdout);
  const toolbar = spawnSync(process.execPath, [join(root, 'scripts/production/toolbar-icons.mjs'), '--check'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(toolbar.status, 0, toolbar.stderr || toolbar.stdout);
  const configuration = spawnSync(process.execPath, [join(root, 'scripts/production/sync-api-configuration.mjs'), '--check'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(configuration.status, 0, configuration.stderr || configuration.stdout);
  const frameIds = spawnSync(process.execPath, [join(root, 'scripts/production/sync-ui-frame-ids.mjs'), '--check'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(frameIds.status, 0, frameIds.stderr || frameIds.stdout);
  const redirects = spawnSync(process.execPath, [join(root, 'scripts/production/sync-vendor-redirects.mjs'), '--check'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(redirects.status, 0, redirects.stderr || redirects.stdout);
  // ADR-047: vendored 722fae8 sources, module bundles, the background.js (S2) and popup/sidepanel/options (S3) integration of «Защита».
  for (const name of ['vendor-protect.mjs', 'build-protect.mjs', 'sync-protect-sw.mjs', 'sync-protect-ui.mjs', 'sync-management-navigation.mjs', 'sync-cookie-site.mjs', 'sync-redesign-ui.mjs', 'sync-sensor-quiet-ui.mjs']) {
    const protect = spawnSync(process.execPath, [join(root, 'scripts/production', name), '--check'], { encoding: 'utf8', timeout: 180000 });
    assert.equal(protect.status, 0, name + ': ' + (protect.error?.message ?? (protect.stderr || protect.stdout)));
  }
  for (const name of common) assert.ok(readFileSync(join(source, name), 'utf8').includes(runtimeSource), name + ': Pro runtime drift; run sync-pro-runtime.mjs');
  for (const name of ['hook.early.js', 'hook.main.js']) assert.ok(readFileSync(join(source, name), 'utf8').includes(proTechnicalRuntimeSource), name + ': technical values drift; run sync-pro-technical-values.mjs');
  assert.equal(readFileSync(join(source, 'inspection-contracts.js'), 'utf8'), readFileSync(join(root, 'packages/contracts/src/inspection.mjs'), 'utf8'), 'inspection contract drift; run sync-inspection-runtime.mjs');
  assert.equal(readFileSync(join(source, 'third-party-contracts.js'), 'utf8'), readFileSync(join(root, 'packages/contracts/src/third-party.mjs'), 'utf8'), 'third-party contract drift; run sync-third-party-runtime.mjs');
  for (const [runtime, canonical] of [['beacon-contracts.js', 'beacons.mjs'], ['background-activity-contracts.js', 'background-activity.mjs'], ['cookie-probe-contracts.js', 'cookie-probe.mjs'], ['pro-cookie-values-contracts.js', 'pro-cookie-values.mjs'], ['cookie-writers-contracts.js', 'cookie-writers.mjs'], ['pro-request-values-contracts.js', 'pro-request-values.mjs']]) {
    assert.equal(readFileSync(join(source, runtime), 'utf8'), readFileSync(join(root, 'packages/contracts/src', canonical), 'utf8'), runtime + ': canonical contract drift');
  }
  for (const name of ['hook.early.js', 'hook.main.js']) assert.ok(readFileSync(join(source, name), 'utf8').includes(loaderSensorRuntimeSource), name + ': loader runtime drift; run sync-loader-runtime.mjs');
  const valueCapture = spawnSync(process.execPath, [join(root, 'scripts/production/sync-visual-capture.mjs'), '--check'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(valueCapture.status, 0, valueCapture.stderr || valueCapture.stdout);
  for (const name of ['hook.early.js', 'hook.main.js']) assert.ok(readFileSync(join(source, name), 'utf8').includes(socialSensorRuntimeSource), name + ': social runtime drift; run sync-social-runtime.mjs');
  for (const name of ['hook.early.js', 'hook.main.js']) for (const runtime of [workerSurfacesRuntimeSource, extendedSurfacesRuntimeSource, mathSignatureRuntimeSource, cookieWriterRuntimeSource]) assert.ok(readFileSync(join(source, name), 'utf8').includes(runtime), name + ': ADR-038 sensor drift');
  for (const name of readdirSync(source).filter(name => name.endsWith('.js') && statSync(join(source, name)).isFile())) {
    const checked = spawnSync(process.execPath, ['--check', join(source, name)], { encoding: 'utf8', timeout: 10000 });
    assert.equal(checked.status, 0, name + ': ' + (checked.error?.message ?? checked.stderr));
  }
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  assert.equal(JSON.parse(readFileSync(join(source, 'manifest.json'), 'utf8')).version, version);
  return { baselineFiles: provenance.files.length, baselineVerified: existsSync(baseline), commonRuntimes: common.length };
}
