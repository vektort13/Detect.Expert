// REQ-005/008/011, ADR-024: catalogue hints remain separate from attribution.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createCookieClassifier } from '../../packages/catalog/src/cookie-classifier.mjs';
import { readCookieSnapshot } from '../../packages/contracts/src/inspection.mjs';

const fixtures = JSON.parse(readFileSync(new URL('../../packages/catalog/research/cookies-2026-10/candidate-explanation-review-fixtures.json', import.meta.url), 'utf8'));

for (const fixture of fixtures.cases) {
  test('candidate semantics: ' + fixture.id, () => {
    const entries = fixtures.rules.filter(rule => fixture.rules.includes(rule.id));
    const classifier = createCookieClassifier({ entries });
    const input = { ...fixtures.nativeCore, ...fixture.cookie };
    let valueReads = 0;
    Object.defineProperty(input, 'value', { get() { valueReads++; throw new Error('forbidden value'); } });
    const projected = classifier.projectCookieMetadata(input);
    assert.ok(projected);
    for (const [key, value] of Object.entries(fixture.expect)) {
      if (key === 'purposeIncludes') for (const text of value) assert.ok(projected.purpose.includes(text), text);
      else if (key === 'purposeNonempty') assert.equal(projected.purpose.length > 0, value);
      else if (key === 'mustNotContain') for (const text of value) assert.ok(!JSON.stringify(projected).includes(text), text);
      else assert.deepEqual(projected[key], value, key);
    }
    assert.deepEqual(createCookieClassifier({ entries: entries.slice().reverse() }).projectCookieMetadata(input), projected);
    assert.equal(valueReads, 0);
    assert.ok(readCookieSnapshot({ schemaVersion: 1, type: 'cookies-state', documentKey: '1:0:candidate', permission: 'granted', coverageState: 'active', trackingCount: Number(projected.tracking), entries: [projected], truncated: false, observedAt: 1000, sessionBinding: { status: 'not-observed', headers: [] } }));
  });
}

test('candidate references and published display names remain bounded on large or contradictory records', () => {
  const base = fixtures.rules[0];
  const entries = Array.from({ length: 20 }, (_, i) => ({ ...base, id: 'bounded:' + String(i).padStart(2, '0'), owner: 'Vendor ' + i, purpose: 'P'.repeat(512), sourceUrls: ['https://example.com/source-' + i] }));
  const classifier = createCookieClassifier({ entries });
  const input = { ...fixtures.nativeCore, name: base.name, domain: 'example.com' };
  const result = classifier.projectCookieMetadata(input);
  assert.equal(result.category, 'unknown'); assert.equal(result.owner, ''); assert.equal(result.tracking, false);
  assert.equal(result.purpose.length, 512); assert.equal(result.ruleIds.length, 8); assert.equal(result.sourceUrls.length, 8);
  assert.deepEqual(createCookieClassifier({ entries: entries.slice().reverse() }).projectCookieMetadata(input), result);
  for (const match of ['exact', 'prefix']) {
    const name = 'published_'.repeat(15);
    const own = createCookieClassifier({ entries: [{ ...base, id: 'long:' + match, name, match }] });
    const cookie = { ...fixtures.nativeCore, name: name + (match === 'prefix' ? 'PRIVATE_CANARY' : ''), domain: 'example.com' };
    const row = own.projectCookieMetadata(cookie);
    assert.ok(row.name.length <= 80);
    assert.ok(!JSON.stringify(row).includes('PRIVATE_CANARY'));
  }
});

test('browser security prefixes and generic identifiers cannot create company explanations', () => {
  const base = fixtures.rules[0];
  for (const name of ['__Secure-', '__Host-', 'uid', 'session', 'token', 'auth']) {
    const own = createCookieClassifier({ entries: [{ ...base, id: 'namespace:' + name, name, match: 'prefix' }] });
    const row = own.projectCookieMetadata({ ...fixtures.nativeCore, name: name + 'PRIVATE_CANARY', domain: 'example.com' });
    assert.equal(row.purpose, ''); assert.equal(row.owner, ''); assert.equal(row.tracking, false);
    assert.ok(!JSON.stringify(row).includes('PRIVATE_CANARY'));
  }
});
