// REQ-008/010, ADR-009: research evidence cannot promote itself to a production claim.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createResearchCatalog, exportCatalogCsv, validateResearchCatalog } from '../antifraud-catalog.mjs';
import { auditInputs, isDataPath } from '../code-checks.mjs';

const read = path => JSON.parse(readFileSync(new URL('../../' + path, import.meta.url), 'utf8'));
const inputs = ['a', 'b', 'c', 'd'].map(group => read('packages/catalog/research/antifraud-2026-10/vendors-' + group + '.json'));
const catalog = read('packages/catalog/data/antifraud.v1.json');
const clone = () => structuredClone(catalog);
const getVendor = (data, id) => data.vendors.find(v => v.id === id);
const getNetwork = data => data.vendors.flatMap(v => v.browserSignals).find(s => s.kind === 'script-resource');

test('canonical catalog and CSV are reproducible from primary-source inputs', () => {
  assert.deepEqual(validateResearchCatalog(catalog), []);
  assert.deepEqual(catalog, createResearchCatalog(inputs));
  assert.equal(catalog.vendors.length, new Set(catalog.vendors.map(v => v.id)).size);
  assert.ok(catalog.vendors.length >= 100);
  for (const [name, output] of Object.entries(exportCatalogCsv(catalog))) {
    assert.equal(readFileSync(new URL('../../packages/catalog/data/antifraud.' + name + '.csv', import.meta.url), 'utf8'), output);
  }
});

test('shared artifacts retain family scope, and specific Friendly Risk endpoint retains product scope', () => {
  for (const v of catalog.vendors.filter(v => /^(?:human|cloudflare|aws-waf)-/.test(v.id))) {
    for (const s of v.browserSignals.filter(s => s.kind === 'cookie-name')) assert.equal(s.scope, 'provider-family', s.id);
  }
  const risk = getVendor(catalog, 'friendly-captcha-risk-intelligence').browserSignals.find(s => s.path === '/api/v2/riskIntelligence');
  assert.equal(risk.scope, 'product');
  const captcha = getVendor(catalog, 'friendly-captcha');
  assert.ok(captcha.browserSignals.filter(s => s.kind === 'script-resource').every(s => s.scope === 'provider-family' && s.path));
  const human = getVendor(catalog, 'human-bot-defender').browserSignals.find(s => s.name === '_px3');
  assert.ok(human.relatedVendorIds.length > 1);
  assert.ok(catalog.vendors.every(v => v.webrtc.status === 'unknown' && !v.webrtc.sourceUrls.length));
});

test('build metadata is distinct from passively observable browser evidence', () => {
  for (const s of catalog.vendors.flatMap(v => v.browserSignals).filter(s => ['sdk-package', 'sdk-description', 'sdk-file'].includes(s.kind))) {
    assert.equal(s.passiveObservable, false, s.id);
  }
  assert.ok(catalog.statistics.productsWithPassiveCandidates < catalog.statistics.productsWithCandidates);
  assert.ok(getVendor(catalog, 'fingerprint-device-intelligence').browserSignals.every(s => s.kind !== 'global-name'));
});

test('protocol-relative, unspecified protocols and legacy resources are preserved without guessing', () => {
  assert.equal(getVendor(catalog, 'riskified').browserSignals.find(s => s.host === 'beacon.riskified.com').scheme, 'document-context');
  assert.equal(getVendor(catalog, 'darwinium').browserSignals.find(s => s.host === 'aps.wowscale.com').scheme, 'unknown');
  assert.ok(getVendor(catalog, 'arkose-bot-manager').browserSignals.filter(s => s.path).every(s => s.scheme === 'document-context'));
  assert.ok(getVendor(catalog, 'pingone-protect').browserSignals.find(s => s.host === 'apps.pingone.com').lifecycle === 'legacy');
  assert.ok(getVendor(catalog, 'tencent-captcha').browserSignals.filter(s => /^\/TCaptcha(?:-global)?\.js$/.test(s.path ?? '')).every(s => s.lifecycle === 'legacy'));
  assert.ok(getVendor(catalog, 'keycaptcha').browserSignals.every(s => s.lifecycle === 'legacy'));
});

for (const [label, mutate] of [
  ['top-level production activation', d => { d.productionEnabled = true; }],
  ['vendor activation', d => { d.vendors[0].productionEnabled = true; }],
  ['signal activation', d => { getNetwork(d).productionEnabled = true; }],
  ['missing production gate', d => { delete d.productionGate; }],
  ['self-certified fixture stage', d => { d.productionGate.stage = 'fixture-validated'; }],
  ['fake reviewers', d => { d.productionGate.reviewerIds = ['self']; }],
  ['missing gate requirements', d => { d.productionGate.requirements = []; }],
  ['WebRTC claim', d => { d.vendors[0].webrtc = { status: 'documented-candidate', sourceUrls: [d.vendors[0].sources[0].url] }; }],
  ['unlinked source', d => { getNetwork(d).sourceUrls = ['https://unlinked.example.com/']; }],
  ['credential-bearing source', d => { d.vendors[0].sources[0].url += '?api_key=test_only'; }],
  ['unexpected secret field', d => { d.apiKey = 'test_only'; }],
  ['raw parameter capture', d => { getNetwork(d).parameterPolicy = 'store-values'; }],
  ['numeric IP host', d => { getNetwork(d).host = '192.0.2.10'; }],
  ['URL in host', d => { getNetwork(d).host = 'https://cdn.example.com/sdk.js'; }],
  ['port in host', d => { getNetwork(d).host += ':443'; }],
  ['unsafe path', d => { getNetwork(d).path = '/sdk.js?session=test_only'; }],
  ['unreviewed template', d => { getNetwork(d).path = '/{session}/sdk.js'; getNetwork(d).pathMatch = 'template'; }],
  ['script type change', d => { getNetwork(d).resourceType = 'image'; }],
  ['global with network fields', d => { const s = d.vendors.flatMap(v => v.browserSignals).find(s => s.kind === 'global-name'); s.host = '192.0.2.10'; s.path = '/probe'; }],
  ['host-only with private path', d => { const s = d.vendors.flatMap(v => v.browserSignals).find(s => s.kind === 'request-host'); s.path = '/probe?session=test_only'; }],
  ['forged domain index', d => { d.domainIndex.push({ host: '192.0.2.10', roles: ['webrtc-endpoint'], vendorIds: [], sourceUrls: [] }); }],
  ['fake source count', d => { d.statistics.sources = 999; }],
  ['fake passive count', d => { d.statistics.passiveObservableCandidates = 999; }],
  ['missing artifact group', d => { delete getNetwork(d).artifactGroupId; }],
  ['forged artifact relation', d => { getNetwork(d).relatedVendorIds = ['absent']; }],
  ['SDK descriptor claimed observable', d => { const s = d.vendors.flatMap(v => v.browserSignals).find(s => s.kind === 'sdk-description'); s.passiveObservable = true; }],
]) {
  test('validator rejects ' + label, () => {
    const data = clone(); mutate(data);
    assert.ok(validateResearchCatalog(data).length, label);
  });
}

test('malformed JSON shapes produce validation errors without invoking record methods', () => {
  for (const value of [null, [], 'catalog', 42]) assert.ok(validateResearchCatalog(value).length);
  for (const mutate of [d => { d.vendors[0] = null; }, d => { d.vendors[0].sources[0] = null; },
    d => { d.vendors[0].browserSignals = {}; }, d => { getNetwork(d).path = {}; getNetwork(d).pathMatch = 'template'; }]) {
    const data = clone(); mutate(data);
    assert.ok(validateResearchCatalog(data).length);
  }
});

test('scope merge is conservative in either input order and does not invent protocol', () => {
  const v = structuredClone(getVendor(catalog, 'seon'));
  const s = { kind: 'script-resource', host: 'cdn.seonintelligence.com', path: '/js/v6/agent.umd.js', sourceUrl: v.sources[0].url, status: 'documented-candidate' };
  const a = { ...v, browserSignals: [{ ...s, scope: 'product' }] };
  const b = { ...v, browserSignals: [{ ...s, scope: 'generic-sdk' }] };
  for (const input of [[a, b], [b, a]]) {
    const data = createResearchCatalog([input]);
    assert.equal(data.vendors[0].browserSignals[0].scope, 'generic-sdk');
    assert.equal(data.vendors[0].browserSignals[0].scheme, 'unknown');
  }
});

test('CSV escaping prevents spreadsheet formula execution while canonical JSON retains names', () => {
  const data = clone(); data.vendors[0].name = '=HYPERLINK("test")';
  assert.ok(exportCatalogCsv(data).vendors.includes("\"'=HYPERLINK("));
  assert.equal(data.vendors[0].name, '=HYPERLINK("test")');
});

test('research JSON lint exemption cannot exempt executable code or enter a production bundle', () => {
  const data = 'packages/catalog/research/antifraud-2026-10/vendors-a.json';
  assert.equal(isDataPath(data), true);
  assert.equal(isDataPath(data.replace('.json', '.js')), false);
  assert.equal(isDataPath('packages/catalog/research/antifraud-2026-10/loader.json'), false);
  assert.ok(auditInputs({ [data]: {} }, 'sw').length);
});
