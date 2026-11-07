// ADR-035: a bounded image exception cannot disable other egress checks or survive source drift.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { auditInputs, isDataPath, isTestPath, reviewedCodeReferences, scanCode } from '../code-checks.mjs';
const file = 'apps/production-extension/site-favicon.js', source = 'const image = new Image(); image.src = nativeSource;';
const review = { [file]: { sha256: createHash('sha256').update(source).digest('hex'), references: ['network-reference: Image', 'dom-network-assignment: src'] } };
test('favicon capability exception requires the exact reviewed file and exact source bytes', () => {
  const hits = scanCode(source, file); assert.equal(hits.length, 2);
  assert.deepEqual(reviewedCodeReferences(source, file, hits, review), []);
  assert.deepEqual(reviewedCodeReferences(source, 'apps/production-extension/other.js', hits, review), hits);
  assert.ok(reviewedCodeReferences(source + ' fetch(target);', file, scanCode(source + ' fetch(target);', file), review).includes('network-reference: fetch'));
});
test('an attempted additional favicon exception cannot authorize fetch or another module', () => {
  const forged = { [file]: { ...review[file], references: ['network-reference: fetch'] } };
  assert.ok(reviewedCodeReferences(source, file, scanCode(source, file), forged).includes('invalid reviewed code-reference exception'));
  assert.ok(reviewedCodeReferences(source, 'apps/production-extension/other.js', scanCode(source, file), { 'apps/production-extension/other.js': review[file] }).includes('invalid reviewed code-reference exception'));
});
test('company source ledgers and owned native fixtures remain forbidden production imports', () => {
  for (const path of ['apps/production-extension/icons/brands/COMPANY-PROVENANCE.json', 'packages/catalog/research/company-logos-2026-10/registry.json']) {
    assert.equal(isDataPath(path), true); assert.ok(auditInputs({ [path]: {} }, 'sw').length);
  }
  for (const path of ['scripts/test-company-native.mjs', 'scripts/test-company-firefox-native.mjs', 'scripts/test-company-layout.mjs']) {
    assert.equal(isTestPath(path), true); assert.ok(auditInputs({ [path]: {} }, 'sw').length);
  }
  assert.equal(isDataPath('apps/production-extension/company-branding.js'), false);
  assert.equal(isTestPath('apps/production-extension/test-company-native.mjs'), false);
});
