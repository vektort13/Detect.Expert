// REQ-005/008/011, ADR-024: independent registry admission and privacy cases.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCookieCatalog } from '../cookie-catalog.mjs';
import { createCookieClassifier } from '../../packages/catalog/src/cookie-classifier.mjs';
import { readCookieSnapshot } from '../../packages/contracts/src/inspection.mjs';

const { catalog, stats } = await buildCookieCatalog({ write: false });
const classifier = createCookieClassifier(catalog);
const native = { hostOnly: true, secure: true, httpOnly: false, session: true, sameSite: 'lax' };
const sampleName = row => row.match === 'exact' ? row.name : row.name + (row.nameSuffix === 'digits' ? '12345' : row.nameLength ? 'a'.repeat(row.nameLength - row.name.length) : row.nameSuffix === 'hex' ? 'a1b2c3' : 'FIXTURE');

test('source expansion retains complete pinned metadata with primary priority and truthful registry attribution', () => {
  assert.equal(stats.primaryRules, 443);
  assert.equal(stats.records, 2266 + 443 + Object.values(stats.publicDatasets).reduce((sum, dataset) => sum + dataset.records, 0));
  assert.ok(stats.compiledRules > 6000 && stats.records <= 8192);
  const declarations = catalog.entries.filter(row => row.id.startsWith('iab:'));
  assert.ok(declarations.length > 3400);
  assert.ok(declarations.every(row => row.confidence === 'community' && row.owner.startsWith('Vendor declaration: ')));
  for (const [name, domain, category] of [['HSID', 'google.com', 'security'], ['SID', 'google.com', 'security'], ['_ga', 'analytics.google.com', 'analytics'], ['datadome', 'shop.example.com', 'security']]) {
    const result = classifier.classifyCookie({ name, domain });
    assert.equal(result.category, category); assert.equal(result.confidence, 'documented');
    assert.equal(result.tracking, category === 'analytics');
  }
  for (const row of declarations.filter(row => row.provenance.declaredPurposes?.length === 1 && row.provenance.declaredPurposes[0] === 10 && !row.provenance.specialPurposes?.length && !row.provenance.optOut)) assert.equal(row.category, 'unknown');
});

test('every retained source row has a canonical projection; every compiled domain rule excludes lookalikes', () => {
  let valueReads = 0, compiled = 0, domainNegatives = 0;
  for (const row of catalog.entries) {
    const input = { ...native, name: sampleName(row), domain: row.domains[0] || 'fixture.example.com' };
    Object.defineProperty(input, 'value', { get() { valueReads++; throw new Error('forbidden value'); } });
    const own = createCookieClassifier({ entries: [row] });
    const entry = own.projectCookieMetadata(input);
    assert.ok(entry, row.id);
    assert.ok(readCookieSnapshot({ schemaVersion: 1, type: 'cookies-state', documentKey: '1:0:source', permission: 'granted', coverageState: 'active', trackingCount: Number(entry.tracking), entries: [entry], truncated: false, observedAt: 1000, sessionBinding: { status: 'not-observed', headers: [] } }), row.id);
    if (!own.ruleCount) continue;
    compiled++;
    if (row.domainContext === 'unassessed') {
      assert.equal(entry.category, 'unknown', row.id); assert.equal(entry.owner, '', row.id); assert.equal(entry.tracking, false, row.id);
    }
    if (row.domainContext === 'domain') {
      for (const domain of row.domains) {
        const positive = own.classifyCookie({ ...input, domain });
        assert.ok(positive.ruleIds.includes(row.id), row.id + ':' + domain);
        const negative = own.classifyCookie({ ...input, domain: domain + '.unrelated.test' });
        assert.equal(negative.tracking, false, row.id); assert.equal(negative.owner, '', row.id);
        assert.equal(negative.purpose, '', row.id); assert.deepEqual(negative.sourceUrls, [], row.id);
        domainNegatives++;
      }
    }
  }
  assert.equal(compiled, stats.compiledRules);
  assert.ok(domainNegatives > 3900);
  assert.equal(valueReads, 0);
});

test('documented SDK and numeric account shapes exclude broad-prefix false positives', () => {
  for (const [name, owner] of [['amp_a1b2c3', 'Amplitude'], ['AMP_a1b2c3d4e5', 'Amplitude'], ['AMP_MKTG_a1b2c3d4e5', 'Amplitude'], ['AMP_TEST_1791540000000', 'Amplitude'], ['AMP_TLDTEST_1791540000000', 'Amplitude'], ['pi_opt_in12345', 'Salesforce Account Engagement']]) {
    const result = classifier.classifyCookie({ name, domain: 'shop.example.com' });
    assert.equal(result.owner, owner, name); assert.equal(result.confidence, 'documented', name);
  }
  for (const name of ['AMP_TEST_1791540000000', 'AMP_TLDTEST_1791540000000']) assert.equal(classifier.classifyCookie({ name, domain: 'shop.example.com' }).tracking, false);
  for (const name of ['amp_customSession', 'AMP_PRIVATE_SESSION', 'amp_locale', 'AMP__________', 'amp_abc', 'AMP_abc', 'AMP_MKTG_customSession', 'AMP_TEST_private', 'AMP_TLDTEST_private', 'pi_opt_intent', 'pi_opt_in_foo']) {
    const result = classifier.classifyCookie({ name, domain: 'shop.example.com' });
    assert.equal(result.tracking, false, name); assert.equal(result.owner, '', name);
    assert.notEqual(result.confidence, 'documented', name);
  }
});

test('unsafe public metadata cannot invalidate the canonical response or invoke optional-shape getters', () => {
  const base = { id: 'fixture:unsafe', name: 'fixture_', match: 'prefix', domainContext: 'any', domains: [], category: 'analytics', owner: 'Fixture', purpose: 'Public fixture description', confidence: 'documented', sourceUrls: ['https://example.com/cookies'] };
  for (const changes of [{ id: 'a'.repeat(97) }, { id: 'id with space' }, { owner: 'spoof\u202Etext' }, { purpose: 'description\nvalue' }, { sourceUrls: ['https://example.com/\u2066cookies'] }, { nameLength: 6 }, { nameLength: 257 }, { nameSuffix: 'arbitrary-regex' }]) assert.equal(createCookieClassifier({ entries: [{ ...base, ...changes }] }).ruleCount, 0);
  let reads = 0;
  for (const key of ['nameLength', 'nameSuffix']) {
    const row = { ...base };
    Object.defineProperty(row, key, { get() { reads++; throw new Error('getter'); } });
    assert.equal(createCookieClassifier({ entries: [row] }).ruleCount, 0);
  }
  assert.equal(reads, 0);
});
