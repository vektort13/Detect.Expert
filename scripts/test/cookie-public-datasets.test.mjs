import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIabSnapshot, parseCookieAuditMetadata, isPublicSuffix } from '../cookie-public-datasets.mjs';

function snapshot(disclosures, owner = 'Example Ad Company', extra = {}) {
  return {
    accessedAt: '2026-10-09', vendorListVersion: 180,
    gvlArchive: 'https://vendor-list.consensu.org/v3/archives/vendor-list-v180.json',
    gvlSha256: 'a'.repeat(64), specification: 'https://github.com/InteractiveAdvertisingBureau/GDPR-Transparency-and-Consent-Framework',
    licenseNote: 'Factual vendor declarations',
    results: [{ vendorId: 12, owner, sourceUrl: 'https://metadata.cookies-fixture.org/deviceStorage.json', finalUrl: 'https://metadata.cookies-fixture.org/deviceStorage.json',
      status: 'ok', sha256: 'b'.repeat(64), disclosures, ...extra }]
  };
}
function row(identifier, fields = {}) {
  return { identifier, type: 'cookie', domain: 'ads.vendor.example.org', domains: [], purposes: [1, 3, 4], specialPurposes: [], optOut: false, maxAgeSeconds: 3600, cookieRefresh: false, ...fields };
}

test('duplicate dotted/wildcard domain forms retain their finite declared scope', () => {
  const output = normalizeIabSnapshot(snapshot([row('ad_cookie', { domains: ['vendor.example.org', '*.vendor.example.org', '.vendor.example.org'] })]));
  assert.equal(output.entries[0].domainContext, 'domain');
  assert.deepEqual(output.entries[0].domains, ['vendor.example.org']);
  assert.equal(output.entries[0].category, 'advertising');
  assert.equal(output.entries[0].confidence, 'community');
});

test('publisher wildcard, missing or malformed domains stay unadmitted', () => {
  const output = normalizeIabSnapshot(snapshot([row('_producer_id', { domain: '*' }), row('id', { domain: '' }), row('bad', { domains: ['valid.example.org', 'https://bad.example.org'] })]));
  assert.equal(output.entries.length, 3);
  assert.ok(output.entries.every(entry => entry.domainContext === 'unassessed' && entry.confidence === 'community'));
  assert.equal(output.quality.newScopedRules, 0);
});

test('ICANN/private public suffixes and PSL wildcards cannot create blanket scopes', () => {
  assert.ok(isPublicSuffix('co.uk'));
  assert.ok(isPublicSuffix('github.io'));
  assert.ok(isPublicSuffix('a.ck'));
  assert.ok(!isPublicSuffix('www.ck'));
  const output = normalizeIabSnapshot(snapshot([row('co_cookie', { domain: 'co.uk' }), row('github_cookie', { domain: '*.github.io' }), row('id', { domain: 'valid.example.org' })]));
  assert.equal(output.quality.publicSuffixScopesRejected, 2);
  assert.deepEqual(output.entries.map(entry => entry.domainContext), ['unassessed', 'unassessed', 'domain']);
});

test('only terminal literal wildcards become prefixes; other patterns are counted', () => {
  const output = normalizeIabSnapshot(snapshot([row('provider_*'), row('*uid'), row('a*b'), row('*'), row('cookie_[id]')]));
  assert.equal(output.entries.length, 1);
  assert.equal(output.entries[0].name, 'provider_');
  assert.equal(output.entries[0].match, 'prefix');
  assert.equal(output.quality.unsupportedPatterns, 4);
});

test('opt-out is consent, security is separate, limited content selection is functional', () => {
  const output = normalizeIabSnapshot(snapshot([row('opt_out', { optOut: true }), row('security', { purposes: [1], specialPurposes: [1] }), row('content', { purposes: [1, 11] }), row('ambiguous', { purposes: [1] }), row('development', { purposes: [1, 10] })]));
  assert.deepEqual(output.entries.map(entry => entry.category), ['consent', 'security', 'functional', 'unknown', 'unknown']);
});

test('serialized metadata contains no cookie values, proprietary descriptions or non-cookie rows', () => {
  const output = normalizeIabSnapshot(snapshot([row('ad_cookie', { value: 'secret-token-sentinel', description: 'proprietary-description-sentinel' }), row('localstorage-key', { type: 'web' })]));
  const encoded = JSON.stringify(output);
  assert.ok(!encoded.includes('secret-token-sentinel'));
  assert.ok(!encoded.includes('proprietary-description-sentinel'));
  assert.ok(!encoded.includes('localstorage-key'));
  assert.equal(output.quality.nonCookieDisclosures, 1);
});

test('identical rules are deduplicated without erasing owner conflicts', () => {
  const source = snapshot([row('id'), row('id')]);
  source.results.push({ ...source.results[0], vendorId: 13, owner: 'Other Ad Company' });
  const output = normalizeIabSnapshot(source);
  assert.equal(output.quality.rawRules, 4);
  assert.equal(output.entries.length, 2);
  assert.equal(new Set(output.entries.map(entry => entry.owner)).size, 2);
});

test('large declared finite scopes split into bounded groups without scope broadening', () => {
  const domains = Array.from({ length: 35 }, (_, index) => `d${index}.example.org`);
  const output = normalizeIabSnapshot(snapshot([row('ad_cookie', { domains })]));
  assert.equal(output.entries.length, 3);
  assert.ok(output.entries.every(entry => entry.domains.length <= 16));
  assert.deepEqual(output.entries.flatMap(entry => entry.domains).sort(), domains.sort());
});

test('literal source reader handles comments and rejects calls/accessors/spread', () => {
  const literal = 'export const EXACT = {"cookie": {category: "analytics", provider: "Company", description: "Purpose", maxDays: 1},}; export const PREFIXES = [{prefix:"prefix_",category:"analytics",provider:"Company",description:"Prefix"}]; export const DOMAINS = {};';
  assert.equal(parseCookieAuditMetadata(literal).EXACT.cookie.provider, 'Company');
  for (const replacement of ['run()', '{get category(){return "analytics";}}', '{...remoteData}']) {
    assert.throws(() => parseCookieAuditMetadata(literal.replace('{category: "analytics", provider: "Company", description: "Purpose", maxDays: 1}', replacement)));
  }
});

test('failed source documents remain explicit in quality metrics', () => {
  const output = normalizeIabSnapshot(snapshot([], 'Unavailable', { status: 'http-error', httpStatus: 403 }));
  assert.equal(output.quality.vendorsAttempted, 1);
  assert.equal(output.quality.failedDocuments, 1);
  assert.equal(output.entries.length, 0);
});
