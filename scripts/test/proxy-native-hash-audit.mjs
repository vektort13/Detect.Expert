// E22-25: independently re-read executed native fixture copies; never rewrite evidence.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const evidenceDirectory = join(root, 'test-results/production-1.1.0/proxy');
const releaseSha256 = sha(join(root, 'release/proxy-native/windows-amd64/detect-expert-proxy.exe'));
const helper = readFileSync(join(root, 'scripts/test/proxy-native-host-fixture.mjs'), 'utf8');
assert.ok(helper.includes("copyFileSync(join(root, 'release/proxy-native/windows-amd64/detect-expert-proxy.exe'), executable)"));
const runs = ['chrome-native-auth', 'firefox-native-auth'].map(browser => {
  const evidenceFile = join(evidenceDirectory, browser + '.json');
  const evidence = JSON.parse(readFileSync(evidenceFile, 'utf8'));
  assert.equal(evidence.result, 'PASS'); assert.equal(evidence.checks.length, 13);
  assert.equal(evidence.nativeRegistryRestored, true);
  assert.equal(evidence.ownedClipboardCleanup, true);
  assert.equal(evidence.analyzer.explicitUiControls, true);
  const executable = join(evidence.run, 'native-host/detect-expert-proxy.exe');
  const launcher = join(evidence.run, 'native-host/owned-native-launcher.exe');
  const launcherSource = readFileSync(join(evidence.run, 'native-host/launcher.go'), 'utf8');
  const manifest = JSON.parse(readFileSync(join(evidence.run, 'native-host/native-host.json'), 'utf8'));
  const copiedSha256 = sha(executable);
  assert.equal(copiedSha256, evidence.nativeHost.sha256);
  assert.equal(copiedSha256, releaseSha256);
  assert.equal(sha(launcher), evidence.nativeHost.isolatorSHA256);
  assert.ok(launcherSource.includes('exec.Command(' + JSON.stringify(executable) + ','));
  assert.equal(manifest.path, launcher);
  return {
    browser, started: evidence.at, finished: statSync(evidenceFile).mtime.toISOString(),
    run: evidence.run, result: evidence.result, checks: evidence.checks.length,
    registryRestored: evidence.nativeRegistryRestored, reportedSha256: evidence.nativeHost.sha256,
    ownedClipboardCleanup: evidence.ownedClipboardCleanup,
    copiedSha256, exeLastWrite: statSync(executable).mtime.toISOString(),
    launcherHardcodesCopiedExe: true, nativeManifestPointsToIsolator: true,
    explicitUiAnalyzer: evidence.analyzer,
    explicitUiManager: evidence.manager,
  };
});
const audit = { at: new Date().toISOString(), result: 'PASS', releaseSha256,
  hostBuiltByHarness: false, launcherOnlyBuiltByHarness: true, evidenceFilesEdited: false, runs };
writeFileSync(join(evidenceDirectory, 'native-host-hash-audit.json'), JSON.stringify(audit, null, 2) + '\n');
console.log('Proxy native final hash audit: ' + runs.length + ' executed copies PASS; host ' + releaseSha256);
