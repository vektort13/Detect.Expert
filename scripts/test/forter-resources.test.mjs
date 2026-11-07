// ADR-043 / E12-02: real shipped matcher and browser-network ingestion boundaries.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { FORTER_RESOURCE_POLICY as policy, FORTER_RESOURCE_RULES as additions, patchForterMatcher } from '../production/forter-resource-plan.mjs';
import { companyBrand } from '../../apps/production-extension/company-branding.js';
import { createVendorRedirectTracker } from '../../apps/production-extension/vendor-redirects.js';
const source = readFileSync(new URL('../../apps/production-extension/background.js', import.meta.url), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const module = section('// packages/catalog/src/vendors.runtime.json', '// packages/catalog/src/vendors.rtc.runtime.json');
const context = vm.createContext({ URL, Date }); vm.runInContext(module, context);
const factory = rules => context.createVendorResourceMatcher(rules ?? context.vendors_runtime_default.rules);
const matcher = factory(), now = Date.parse('2026-10-10T18:00:00Z');
const clone = value => JSON.parse(JSON.stringify(value));
const match = (url, type = 'script', at = now) => clone(matcher.matchVendorResource(url, type, at));
const isForter = rows => rows.some(row => row.vendorId === 'forter');
const expected = id => [{ vendorId: 'forter', ruleId: id, vendorConfidence: 'documented-resource', evidenceSource: 'browser-network', integrity: 'browser-observed' }];

test('shipped approved registry, generator, UI names and packaged Forter mark agree', () => {
  const rules = clone(context.vendors_runtime_default.rules);
  assert.equal(rules.length, 61); assert.equal(new Set(rules.map(rule => rule.id)).size, 61);
  assert.deepEqual(rules.filter(rule => additions.some(added => added.id === rule.id)), additions);
  assert.equal(patchForterMatcher(patchForterMatcher(source)), patchForterMatcher(source));
  for (const file of ['popup.js', 'sidepanel.js', 'report.js']) {
    const ui = readFileSync(new URL('../../apps/production-extension/' + file, import.meta.url), 'utf8');
    assert.ok(ui.includes('forter: "Forter"')); assert.ok(ui.includes('VENDOR_CATALOG_RULE_COUNT = 61'));
  }
  const brand = companyBrand('forter'); assert.ok(brand && readFileSync(new URL(brand.src)).length > 0);
});
for (const host of ['cdn.forter.com', 'cdn0.forter.com', 'cdn4.forter.com', 'cdn123.forter.com', '123456abcdef.cdn.forter.com', '123456abcdef.cdn4.forter.com', 'a'.repeat(32) + '-123456abcdef.cdn.forter.com']) {
  for (const type of ['script', 'xmlhttprequest', 'image', 'ping']) test('Forter CDN ' + host + ' / ' + type, () => {
    assert.deepEqual(match('https://' + host + '/sn/123456abcdef/script.js?token=PRIVATE_QUERY_CANARY', type), expected('forter-cdn-resource-v1'));
  });
}
for (const host of policy.connectHosts) test('documented CloudFront connect endpoint: ' + host, () => {
  for (const type of ['xmlhttprequest', 'image', 'ping']) assert.deepEqual(match('https://' + host + '/logo_small.gif?token=PRIVATE_TOKEN', type), expected('forter-cloudfront-connect-v1'));
  assert.deepEqual(match('https://' + host + '/unrelated.js', 'script'), []);
});
for (const host of policy.scriptHosts) test('documented CloudFront script endpoint: ' + host, () => {
  assert.deepEqual(match('https://' + host + '/script.js'), expected('forter-cloudfront-script-v1'));
  assert.deepEqual(match('https://' + host + '/status', 'xmlhttprequest'), []);
});
for (const [url, type = 'script'] of [
  ['https://forter.com/script.js'], ['https://www.forter.com/script.js'], ['https://docs.forter.com/script.js'], ['https://api.forter.com/decision'],
  ['https://unrelated.cloudfront.net/script.js'], ['https://cloudfront.net/script.js'],
  ['https://cdn4.forter.com.attacker.example/script.js'], ['https://notforter.com/script.js'],
  ['https://extra.tenant.cdn4.forter.com/script.js'], ['https://cdn1234.forter.com/script.js'],
  ['https://x.d3nocrch4qti4v.cloudfront.net/logo_small.gif', 'image'],
  ['https://d3nocrch4qti4v.cloudfront.net.attacker.example/logo_small.gif', 'image'],
  ['https://attacker.example/?url=https://cdn4.forter.com/script.js'],
  ['https://cdn4.forter.com@attacker.example/script.js'], ['https://user@cdn4.forter.com/script.js'],
  ['http://cdn4.forter.com/script.js'], ['https://cdn4.forter.com:444/script.js'],
  ['https://cdn4.forter.com/script.js', 'main_frame'], ['https://cdn4.forter.com/script.js', 'sub_frame'],
  ['https://cdn4.forter.com/style.css', 'stylesheet'], ['https://cdn4.forter.com/font.woff', 'font'],
  ['https://cdn4.forter.com./script.js'], ['https://cdn4.forter.com/\nscript.js'], ['https://cdn4.forter.com\\evil/script.js'],
  ['https://1.1.1.1/dns-query', 'xmlhttprequest'], ['https://siteperformancetest.net/status', 'xmlhttprequest'],
]) test('negative: ' + JSON.stringify([url, type]), () => assert.equal(isForter(match(url, type)), false));

test('review window and explicit rule removal disable matches and persisted-rule lookup', () => {
  for (const at of [Date.parse(policy.sourceAccessedAt) - 1, Date.parse(policy.reviewDueAt), NaN, Infinity]) {
    assert.deepEqual(match('https://cdn4.forter.com/script.js', 'script', at), []);
    assert.equal(matcher.lookupVendorResourceRule('forter-cdn-resource-v1', at), null);
  }
  assert.deepEqual(match('https://cdn4.forter.com/script.js', 'script', Date.parse(policy.sourceAccessedAt)), expected('forter-cdn-resource-v1'));
  const removed = factory(clone(context.vendors_runtime_default.rules).filter(rule => !additions.some(added => added.id === rule.id)));
  assert.equal(removed.lookupVendorResourceRule('forter-cdn-resource-v1', now), null);
  assert.deepEqual(clone(removed.matchVendorResource('https://cdn4.forter.com/script.js', 'script', now)), []);
  for (const field of ['reviewDueAt', 'vendorId']) {
    const rules = clone(additions); rules[0][field] = 'modified';
    assert.equal(factory(rules).lookupVendorResourceRule(rules[0].id, now), null);
  }
});

test('all 58 existing rules retain their exact host/path and type semantics', () => {
  const rules = clone(context.vendors_runtime_default.rules).filter(rule => !rule.matcher.hostGroup);
  assert.equal(rules.length, 58);
  for (const rule of rules.filter(rule => rule.matcher.pathExact && !rule.matcher.publicOrgId)) {
    const url = 'https://' + rule.matcher.hostExact + rule.matcher.pathExact;
    assert.ok(match(url).some(row => row.ruleId === rule.id), rule.id);
    assert.equal(match(url, 'image').some(row => row.ruleId === rule.id), false, rule.id + ': type guard');
  }
  assert.ok(match('https://sdk.checkouttools.com/v1.2/managedOrders.js').some(row => row.ruleId === 'forter-3ds-loader-v1'));
});

function listenerFixture({ ready = true, access = true, buffer = true } = {}) {
  const events = [], scope = { hasDataConsent: true, accessReady: true, accessGeneration: 1,
    hasAnyHostAccess: () => access, isHostGrantedSync: () => access, inScope: () => access,
    getScopeMode: () => access ? 'all-sites' : 'off' };
  const fixture = vm.createContext({ URL, Set, matchVendorResource: matcher.matchVendorResource,
    createVendorRedirectTracker, lookupVendorResourceRule: matcher.lookupVendorResourceRule,
    makeDocumentKey: (tabId, frameId, documentId) => `${tabId}:${frameId}:${documentId}`,
    sanitizeHost: url => { try { return new URL(url).hostname; } catch { return null; } },
    redactHost: host => ({ kind: 'registrable', value: host.endsWith('.forter.com') ? 'forter.com' : host }), siteRelation: () => 'cross-site' });
  vm.runInContext(section('// packages/background/src/network.ts', '// packages/background/src/observers.ts'), fixture);
  const runtime = { canBufferRedactedBrowserData: () => buffer, hydrationComplete: ready, scope,
    state: { metas: new Map() }, canObserveNetworkDocument: () => ready && access,
    now: () => now, dispatch: event => events.push(clone(event)) };
  runtime.vendorRedirects = fixture.createRuntimeVendorRedirects(runtime);
  const listener = fixture.createNetworkListener(runtime);
  return { listener, events, filter: clone(fixture.NETWORK_FILTER) };
}
const details = { tabId: 1, frameId: 3, documentId: 'owned-child-document', parentFrameId: 0, parentDocumentId: 'owned-main-document',
  url: 'https://d3nocrch4qti4v.cloudfront.net/logo_small.gif?session=PRIVATE_QUERY_CANARY', type: 'image', statusCode: 200, initiator: 'https://fixture.example.com' };
test('browser listener admits image/ping, exact child identity, successful completion and reduced data only', () => {
  const fixture = listenerFixture();
  assert.ok(fixture.filter.types.includes('image') && fixture.filter.types.includes('ping'));
  fixture.listener(details);
  assert.deepEqual(fixture.events[0].ruleIds, ['forter-cloudfront-connect-v1']);
  assert.equal(fixture.events[0].documentId, 'owned-child-document'); assert.equal(fixture.events[0].frameId, 3);
  assert.equal(JSON.stringify(fixture.events).includes('PRIVATE_QUERY_CANARY'), false);
  assert.equal(JSON.stringify(fixture.events).includes('logo_small'), false);
  for (const statusCode of [0, 302, 403, 404, 500, undefined]) {
    fixture.listener({ ...details, statusCode }); assert.deepEqual(fixture.events.at(-1).ruleIds, []);
  }
  fixture.listener({ ...details, statusCode: 304, type: 'ping' }); assert.deepEqual(fixture.events.at(-1).ruleIds, ['forter-cloudfront-connect-v1']);
});
test('browser listener respects OFF, host grants, initiator and startup ownership gate', () => {
  for (const settings of [{ access: false }, { buffer: false }]) { const fixture = listenerFixture(settings); fixture.listener(details); assert.deepEqual(fixture.events, []); }
  const fixture = listenerFixture(); fixture.listener({ ...details, initiator: '' }); assert.deepEqual(fixture.events, []);
  const startup = listenerFixture({ ready: false }); startup.listener(details); assert.equal(startup.events[0].requiresAllSitesAccess, true);
});
test('bounded matcher hot path measurement (10000 calls)', t => {
  const start = performance.now();
  for (let index = 0; index < 10000; index++) match('https://d3nocrch4qti4v.cloudfront.net/logo_small.gif?x=PRIVATE', 'image');
  t.diagnostic('10000 calls: ' + (performance.now() - start).toFixed(1) + ' ms; fixed 3 additional rules / 15 exact CloudFront hosts.');
});
