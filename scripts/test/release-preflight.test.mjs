import assert from 'node:assert/strict';
import { test } from 'node:test';
import { releasePreflight, supportedNode } from '../release-preflight.mjs';
import { validateBrowserSupport } from '../release-checks.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

for (const major of [22, 24, 25, 26, 27]) {
  test('F091 Node ' + major + ' admission before installation/build', () => {
    const version = 'v' + major + '.0.0';
    const accepted = major === 24 || major === 25;
    assert.equal(supportedNode(version), accepted);
    let runs = 0;
    const preflight = () => releasePreflight(process.cwd(), { version, log() {}, run() { runs++; return { status: 0 }; } });
    if (accepted) assert.match(preflight(), /^[a-f0-9]{64}$/);
    else assert.throws(preflight, /before build/);
    assert.equal(runs, accepted ? 1 : 0);
  });
}

test('F147 frozen offline failure stops release before build', () => {
  assert.throws(() => releasePreflight(process.cwd(), { log() {}, run(_exe, args) {
    assert.deepEqual(args.slice(1, 5), ['install', '--offline', '--frozen-lockfile', '--ignore-scripts']);
    return { status: 1 };
  } }), /preflight failed/);
});

test('F087/F165 compares the output independently with browser-support metadata', () => {
  assert.deepEqual(validateBrowserSupport({ minimum_chrome_version: '119' }, { minimumChromeVersion: '119' }), []);
  assert.equal(validateBrowserSupport({ minimum_chrome_version: '119' }, { minimumChromeVersion: '120' }).length, 1);
});

test('F147 actual pnpm rejects manifest/lockfile mismatch before installation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'detect-release-mismatch-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'release-preflight-fixture', private: true, dependencies: { preact: '10.29.7' } }));
    // A project-local TEMP must not discover the parent workspace and test its lock instead.
    writeFileSync(join(dir, 'pnpm-workspace.yaml'), "packages:\n  - '.'\n");
    writeFileSync(join(dir, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\nimporters:\n  .:\n    dependencies:\n      preact:\n        specifier: 10.29.8\n        version: 10.29.8\n");
    assert.throws(() => releasePreflight(dir, { log() {}, run(exe, args, options) {
      const result = spawnSync(exe, args, { ...options, stdio: 'pipe', encoding: 'utf8' });
      assert.match(result.stdout + result.stderr, /ERR_PNPM_OUTDATED_LOCKFILE/);
      return result;
    } }), /preflight failed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
