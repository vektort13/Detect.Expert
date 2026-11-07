import { describe, expect, it } from 'vitest';
import { MatcherFixtureError, negativeClassCounts, parseMatcherFixture, runMatcherFixture } from '../src/harness';
import { SYNTHETIC_MATCHER_NOTE } from '../src/lifecycle';
import { candidateIndex, matcherFixtureFiles, seed, SOURCE_DATE_MS } from './helpers';

const index = candidateIndex();
const files = matcherFixtureFiles();

describe('synthetic matcher fixtures (fixtures/vendors/<vendorId>/<ruleId>.matcher.json)', () => {
  it('exist exactly once for each of the 16 network rules of the seed', () => {
    const networkRules = seed.rules.filter((r) => r.evidenceOrigin === 'network_request');
    expect(networkRules).toHaveLength(16);
    expect(files.map((f) => f.fileId).sort()).toEqual(networkRules.map((r) => r.id).sort());
    for (const f of files) expect(f.vendorDir).toBe(networkRules.find((r) => r.id === f.fileId)?.vendorId);
  });

  for (const file of files) {
    it(file.path + ' passes without collisions', () => {
      const fixture = parseMatcherFixture(file.json);
      expect(fixture.ruleId).toBe(file.fileId);
      expect(fixture.note).toBe(SYNTHETIC_MATCHER_NOTE);
      const result = runMatcherFixture(index, fixture, SOURCE_DATE_MS);
      expect(result.failures).toEqual([]);
      expect(result.collisions).toEqual([]);
      expect(result.passed).toBe(true);
      const counts = negativeClassCounts(fixture);
      expect(counts['similar-hostname'] ?? 0).toBeGreaterThanOrEqual(3);
      expect(counts['not-received'] ?? 0).toBeGreaterThanOrEqual(2);
      expect(counts['shared-cdn'] ?? 0).toBeGreaterThanOrEqual(2);
      for (const cls of ['scheme', 'port', 'url-substring']) expect(counts[cls] ?? 0).toBeGreaterThanOrEqual(1);
    });
  }

  it('documents the percent-encoded Friendly Captcha path as a known false negative', () => {
    const file = files.find((f) => f.fileId === 'friendlycaptcha-v2-cdn-loader');
    const fixture = parseMatcherFixture(file?.json);
    const encoded = fixture.negatives.filter((n) => n.class === 'encoded-path');
    expect(encoded).toHaveLength(1);
    expect(encoded[0]?.documentedFalseNegative).toBe(true);
    expect(encoded[0]?.url).toContain('%40friendlycaptcha');
  });

  it('a broken fixture fails with a precise record id', () => {
    const file = files.find((f) => f.fileId === 'hcaptcha-loader');
    const fixture = parseMatcherFixture(file?.json);
    const broken = { ...fixture, positives: [{ id: 'wrong', url: 'https://js.hcaptcha.com/2/api.js', resourceType: 'script', statusCode: 200 }] };
    const result = runMatcherFixture(index, broken, SOURCE_DATE_MS);
    expect(result.passed).toBe(false);
    expect(result.failures).toEqual([{ recordId: 'wrong', expected: 'match', got: [] }]);
  });

  it('reports collisions with other rules', () => {
    const file = files.find((f) => f.fileId === 'hcaptcha-loader');
    const fixture = parseMatcherFixture(file?.json);
    const colliding = { ...fixture, negatives: [{ id: 'other', class: 'shared-cdn' as const, url: 'https://cdn.sift.com/s.js', resourceType: 'script', statusCode: 200 }] };
    const result = runMatcherFixture(index, colliding, SOURCE_DATE_MS);
    expect(result.passed).toBe(false);
    expect(result.collisions).toEqual([{ recordId: 'other', ruleIds: ['sift-js-loader'] }]);
  });
});

describe('parseMatcherFixture closed schema', () => {
  const base = parseMatcherFixture(matcherFixtureFiles().find((f) => f.fileId === 'hcaptcha-loader')?.json);
  const plain = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
  const record = { id: 'r', url: 'https://js.hcaptcha.com/1/api.js', resourceType: 'script', statusCode: 200 };
  const cases: Array<[string, unknown]> = [
    ['unknown top-level key', { ...plain, extra: true }],
    ['wrong kind', { ...plain, kind: 'authorized-integration' }],
    ['missing disclaimer note', { ...plain, note: 'proves the SDK' }],
    ['no positives', { ...plain, positives: [] }],
    ['33 positives', { ...plain, positives: Array.from({ length: 33 }, (_, i) => ({ ...record, id: 'p' + i })) }],
    ['65 negatives', { ...plain, negatives: Array.from({ length: 65 }, (_, i) => ({ ...record, id: 'n' + i, class: 'scheme' })) }],
    ['url longer than 2048', { ...plain, positives: [{ ...record, url: 'https://js.hcaptcha.com/' + 'a'.repeat(2048) }] }],
    ['unknown record key', { ...plain, positives: [{ ...record, body: 'x' }] }],
    ['unknown negative class', { ...plain, negatives: [{ ...record, class: 'vibes' }] }],
    ['duplicate record ids', { ...plain, negatives: [{ ...record, class: 'scheme' }, { ...record, class: 'port' }] }],
    ['non-integer status', { ...plain, positives: [{ ...record, statusCode: '200' }] }],
    ['false negative without a note', { ...plain, negatives: [{ ...record, class: 'encoded-path', documentedFalseNegative: true }] }],
    ['not an object', 'fixture'],
  ];
  for (const [name, raw] of cases) {
    it('rejects ' + name, () => expect(() => parseMatcherFixture(raw)).toThrow(MatcherFixtureError));
  }
});
