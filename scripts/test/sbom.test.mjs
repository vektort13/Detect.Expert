import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { assertBundledDependencies, generateArtifacts, parseLockedPackages, verifySbom } from '../sbom.mjs';

const lock = "lockfileVersion: '9.0'\npackages:\n  preact@1.0.0:\n    resolution: {integrity: sha512-YQ==}\n  '@scope/dev@2.0.0':\n    resolution: {integrity: sha512-Yg==}\nsnapshots:\n";
function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'detect-p10-sbom-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const put = (path, data) => { mkdirSync(dirname(join(base, path)), { recursive: true }); writeFileSync(join(base, path), data); };
  put('pnpm-lock.yaml', lock);
  const manifest = JSON.stringify({ name: 'preact', version: '1.0.0', license: 'MIT' });
  put('node_modules/.pnpm/preact@1.0.0/node_modules/preact/package.json', manifest);
  put('node_modules/preact/package.json', manifest);
  put('node_modules/preact/LICENSE', 'MIT fixture copyright and permission');
  put('packages/attribution/data/public_suffix_list.dat', '// VERSION: test\ncom\n');
  put('packages/attribution/data/PSL-LICENSE.txt', 'MPL fixture');
  put('logo.svg', '<svg/>');
  const save = () => { for (const [path, data] of Object.entries(generateArtifacts(base))) put(path, data); };
  save();
  return { base, put, save };
}

test('lock parser includes scoped and unscoped packages with resolved integrity', () => {
  assert.deepEqual(parseLockedPackages(lock), [
    { name: '@scope/dev', version: '2.0.0', integrity: 'sha512-Yg==' },
    { name: 'preact', version: '1.0.0', integrity: 'sha512-YQ==' },
  ]);
  assert.deepEqual(parseLockedPackages(lock.replaceAll('\n', '\r\n')), parseLockedPackages(lock));
});
test('unsupported, incomplete and duplicate lock records fail closed', () => {
  for (const bad of [lock.replace("'9.0'", "'10.0'"), lock.replace('snapshots:', 'other:'),
    lock.replace('    resolution: {integrity: sha512-YQ==}\n', ''),
    lock.replace('integrity: sha512-YQ==', 'tarball: file:local.tgz'),
    lock.replace("'@scope/dev@2.0.0'", 'preact@1.0.0')]) assert.throws(() => parseLockedPackages(bad));
});
test('inventory separates runtime, dev and assets without guessing missing licenses', (t) => {
  const { base } = fixture(t);
  const artifacts = generateArtifacts(base);
  const { components } = JSON.parse(artifacts['docs/release/sbom.json']);
  assert.deepEqual(components.filter((p) => p.scope === 'bundled').map((p) => p.name), ['preact', 'Public Suffix List', 'detect.expert logo']);
  assert.equal(components[0].license, 'NOASSERTION');
  assert.equal(components[0].licenseEvidence, 'not-installed-on-this-platform');
  assert.match(artifacts.NOTICE, /MIT fixture copyright and permission/);
  assert.doesNotMatch(artifacts.NOTICE, /@scope\/dev/);
  assert.deepEqual(generateArtifacts(base), artifacts);
  assert.doesNotThrow(() => verifySbom(base));
});
test('release verification rejects stale lock hash even when package records did not change', (t) => {
  const { base, put } = fixture(t);
  put('pnpm-lock.yaml', lock + '\n');
  assert.throws(() => verifySbom(base), /lockfile hash mismatch/);
});
test('release verification detects tampered components, licenses, notice and changed assets', (t) => {
  const { base, put, save } = fixture(t);
  for (const path of ['docs/release/sbom.json', 'docs/release/licenses.md', 'NOTICE', 'logo.svg', 'packages/attribution/data/public_suffix_list.dat', 'packages/attribution/data/PSL-LICENSE.txt']) {
    put(path, readFileSync(join(base, path), 'utf8') + ' ');
    assert.throws(() => verifySbom(base), /Stale release inventory/);
    save();
  }
});
test('missing or mismatched bundled Preact metadata fails generation', (t) => {
  const { base, put } = fixture(t);
  put('node_modules/preact/package.json', JSON.stringify({ version: '9.0.0' }));
  assert.throws(() => generateArtifacts(base), /differs from lockfile/);
  put('node_modules/.pnpm/preact@1.0.0/node_modules/preact/package.json', JSON.stringify({ name: 'preact', version: '1.0.0' }));
  assert.throws(() => generateArtifacts(base), /installed MIT Preact/);
});
test('bundle audit rejects newly imported runtime dependencies on Windows and POSIX', () => {
  assert.doesNotThrow(() => assertBundledDependencies({ 'node_modules/.pnpm/preact@1/node_modules/preact/hooks/dist/hooks.module.js': {} }));
  for (const path of ['node_modules/ajv/index.js', 'node_modules\\.pnpm\\dev@1\\node_modules\\dev\\index.js']) {
    assert.throws(() => assertBundledDependencies({ [path]: {} }), /missing from release inventory/);
  }
});
