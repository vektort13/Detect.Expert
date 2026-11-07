// P05 / ADR-003: optional test grants must never become release permissions.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { validateManifest } from '../release-checks.mjs';

const result = await build({ entryPoints: ['apps/extension/manifest.ts'], bundle: true, write: false, format: 'esm' });
const { buildManifest } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
const allow = JSON.parse(readFileSync('apps/extension/permissions.allowlist.json', 'utf8'));
for (const profile of ['local', 'test', 'test-optional']) {
  test('P05 manifest and release gate: ' + profile, () => {
    const manifest = buildManifest(profile, '0.1.0');
    assert.equal(validateManifest(manifest, allow).length === 0, profile === 'local');
    assert.deepEqual(manifest.host_permissions, profile === 'test' ? ['http://127.0.0.1/*'] : undefined);
    assert.equal(manifest.content_scripts, undefined);
    assert.deepEqual(manifest.optional_host_permissions, allow.optional_host_permissions);
  });
  test('P05 compiled background fallback boundary: ' + profile, async () => {
    const output = await build({ entryPoints: ['apps/extension/entrypoints/background.ts'], bundle: true,
      write: false, format: 'esm', minifySyntax: true, define: { __BUILD_PROFILE__: JSON.stringify(profile) } });
    assert.equal(output.outputFiles[0].text.includes('__p05'), profile !== 'local');
    assert.equal(output.outputFiles[0].text.includes('reconcilePermissions'), profile !== 'local');
  });
}
