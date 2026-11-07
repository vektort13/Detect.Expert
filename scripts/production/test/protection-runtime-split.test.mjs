// ADR-046: per-rule protection bundles carry the shared runtime and exactly one own switch case.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { PROTECTION_FEATURES } from '../../../packages/contracts/src/protection-features.mjs';
import { splitProtectionRuntime, switchBounds } from '../protection-runtime-split.mjs';

const runtime = readFileSync(new URL('../../../apps/production-extension/protection-runtime.js', import.meta.url), 'utf8')
  .replace('export function installProtection(', 'function installProtection(');

test('the real runtime splits into one part per contract feature with exactly its own case', () => {
  const parts = splitProtectionRuntime(runtime, PROTECTION_FEATURES);
  const { head, tail } = switchBounds(runtime);
  assert.equal(parts.size, PROTECTION_FEATURES.length);
  assert.deepEqual([...parts.keys()], [...PROTECTION_FEATURES]);
  for (const [feature, part] of parts) {
    assert.equal(part.split('case "').length, 2, feature);
    assert.ok(part.startsWith(head) && part.endsWith(tail), feature);
    assert.match(switchBounds(part).body, new RegExp('^ {4}case "' + feature + '":'), feature);
  }
});

const synthetic = (cases) => 'function installProtection(realm, feature) {\n  let navigator = null;\n  switch (feature) {\n' +
  cases.join('') + '  }\n  return {\n    stop() {}\n  };\n}\n';
const plain = (id) => '    case "' + id + '":\n      hide(realm, "' + id + '");\n      break;\n';
const block = (id) => '    case "' + id + '": {\n      const names = ["' + id + '"];\n      hide(realm, names[0]);\n      break;\n    }\n';

test('synthetic runtime: braced and plain cases split without leaking other rules', () => {
  const parts = splitProtectionRuntime(synthetic([plain('alpha'), block('beta')]), ['alpha', 'beta']);
  assert.equal(parts.get('alpha').includes('beta'), false);
  assert.equal(parts.get('beta').includes('alpha'), false);
  assert.ok(parts.get('beta').includes('    }\n  }\n  return {'));
});

for (const [name, source, features, id] of [
  ['missing case', synthetic([plain('alpha')]), ['alpha', 'missing-rule'], 'missing-rule'],
  ['extra case', synthetic([plain('alpha'), plain('extra-rule')]), ['alpha'], 'extra-rule'],
  ['duplicate case', synthetic([plain('alpha'), plain('twice-rule'), plain('twice-rule')]), ['alpha', 'twice-rule'], 'twice-rule'],
  ['code before the first case', synthetic(['    hide(realm, "x");\n', plain('first-rule')]), ['first-rule'], 'first-rule'],
  ['case without break', synthetic([plain('alpha'), '    case "open-rule":\n      hide(realm, "x");\n', plain('omega')]), ['alpha', 'open-rule', 'omega'], 'open-rule'],
  ['fallthrough case', synthetic(['    case "shared-rule":\n', plain('alpha')]), ['shared-rule', 'alpha'], 'shared-rule'],
]) test('synthetic runtime rejects ' + name + ' and names the rule', () => {
  assert.throws(() => splitProtectionRuntime(source, features), (error) => error instanceof Error && error.message.includes(id));
});

test('a runtime without the switch boundary is rejected', () => {
  assert.throws(() => switchBounds('function installProtection() {}\n'), /switch boundary missing/);
  assert.throws(() => switchBounds(runtime.replace('\n  }\n  return {', '\n  }\n  return  {')), /switch boundary missing/);
});
