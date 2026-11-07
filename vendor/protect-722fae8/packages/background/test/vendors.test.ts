// S10 / ADR-009 v1.1: catalog matcher on webRequest.onCompleted. The same scope/document checks as the S07 observer,
// rule ids merged into the existing host entry (sorted, unique, <= 32), nothing beyond ids and enums reaches the
// reducer or storage, and projections carry vendors / catalogVersion only with an active catalog.
import { describe, expect, it } from 'vitest';
import { EMPTY_CATALOG, PRODUCTION_CATALOG, buildCatalogIndex } from '@detect-expert/catalog';
import type { CatalogIndex, CompiledRule } from '@detect-expert/catalog';
import { SYNTHETIC_TEST_CATALOG } from '@detect-expert/catalog/synthetic';
import { BUDGETS } from '@detect-expert/contracts';
import { VENDOR_MATCH_FILTER, VENDOR_MATCH_TYPES, createBackground, mergeRuleIds } from '../src/index';
import type { Background, DocumentEvent, RequestDetailsLike } from '../src/index';
import { committed, createFakeChrome, settle, uiSender } from './fake-chrome';
import type { FakeChrome } from './fake-chrome';

const D1 = 'DOC000000000000000000000000000001';
const KEY1 = '7:0:' + D1;
const SALT = 'ffeeddccbbaa99887766554433221100';
const LOADER = 'https://cdn.vendor.net/v2/loader.js';
const SECRET = '?session=SECRET-TOKEN-1#frag';

function rule(ruleId: string, path: string, extra: Partial<CompiledRule> = {}): CompiledRule {
  return {
    ruleId,
    ruleVersion: '1',
    vendorId: 'vendor-x',
    evidenceOrigin: 'network_request',
    strength: 'documented-resource',
    network: { scheme: 'https', port: null, hosts: ['cdn.vendor.net'], suffix: null, paths: [path], pathPattern: null, resourceType: 'script' },
    expiresAtMs: 4_102_444_800_000,
    testOnly: false,
    meaning: { ru: 'Браузер получил ресурс.', en: 'The browser received a resource.' },
    limitations: { ru: 'Исполнение не наблюдалось.', en: 'Execution was not observed.' },
    ...extra,
  };
}

function catalog(rules: CompiledRule[], catalogVersion = '2026-10-17.unit0001'): CatalogIndex {
  return buildCatalogIndex({
    kind: 'production',
    catalogVersion,
    vendors: [{ vendorId: 'vendor-x', displayName: 'Vendor X', category: 'bot', purposeKey: 'card_vendor_category_bot' }],
    rules,
    candidateRuleCount: 0,
  });
}

const ONE = catalog([rule('vendor-x-loader', '/v2/loader.js')]);

function details(over: Partial<RequestDetailsLike> = {}): RequestDetailsLike {
  return {
    tabId: 7, frameId: 0, documentId: D1, parentFrameId: -1, type: 'script', timeStamp: 1, initiator: 'https://example.com',
    url: LOADER + SECRET, statusCode: 200, ...over,
  };
}

interface Setup { fake: FakeChrome; bg: Background; events: DocumentEvent[] }

async function setup(opts: { catalog?: CatalogIndex; grants?: string[]; scope?: 'site' | 'all-sites' | 'off'; fake?: FakeChrome } = {}): Promise<Setup> {
  const fake = opts.fake ?? createFakeChrome({ grantedOrigins: opts.grants ?? ['http://*/*', 'https://*/*'] });
  if (opts.fake === undefined) fake.local.data.set('scope', { v: 1, scopeMode: opts.scope ?? 'all-sites', hosts: ['example.com'] });
  const bg = createBackground(fake, { ttlIntervalMs: 0, persistDebounceMs: 1, networkSalt: SALT, ...(opts.catalog === undefined ? {} : { catalog: opts.catalog }) });
  await bg.start();
  if (opts.fake === undefined) bg.navigation.onCommitted(committed());
  const events: DocumentEvent[] = [];
  const dispatch = bg.runtime.dispatch.bind(bg.runtime);
  bg.runtime.dispatch = (event: DocumentEvent): void => {
    events.push(event);
    dispatch(event);
  };
  return { fake, bg, events };
}

/** One request as the browser reports it: onBeforeRequest (no status) then onCompleted. */
function request(bg: Background, d: RequestDetailsLike): void {
  const { statusCode: _s, ...before } = d;
  bg.network.onBeforeRequest(before);
  bg.vendorMatch.onCompleted(d);
}

function hostRules(bg: Background): Array<[string | undefined, string, string[]]> {
  return (bg.runtime.state.reports.get(KEY1)?.hosts ?? []).map((h) => [h.registrableDomain ?? h.category, h.relation, h.ruleIds]);
}

describe('filter and defaults', () => {
  it('onCompleted filter: http(s) only and the nine catalog resource types (no websocket, no main_frame)', () => {
    expect(VENDOR_MATCH_FILTER).toEqual({ urls: ['http://*/*', 'https://*/*'], types: [...VENDOR_MATCH_TYPES] });
    expect(VENDOR_MATCH_TYPES).toEqual(['script', 'xmlhttprequest', 'sub_frame', 'ping', 'image', 'media', 'font', 'stylesheet', 'other']);
  });

  it('default EMPTY_CATALOG: no rule ids, vendors [] and catalogVersion null; diagnostics say so', async () => {
    const { bg, events } = await setup();
    request(bg, details());
    expect(events.filter((e) => e.type === 'network:vendor-match')).toEqual([]);
    expect(hostRules(bg)).toEqual([['vendor.net', 'cross-site', []]]);
    const p = bg.runtime.getProjection(7);
    expect(p?.vendors).toEqual([]);
    expect(p?.catalogVersion).toBeNull();
    expect(bg.runtime.catalog).toBe(EMPTY_CATALOG);
    expect(bg.runtime.diagnostics()).toMatchObject({ catalogVersion: null, catalogRules: 0 });
    bg.runtime.stop();
  });

  it('PRODUCTION_CATALOG (0 rules under the closed gate) behaves like no catalog', async () => {
    const { bg, events } = await setup({ catalog: PRODUCTION_CATALOG });
    request(bg, details());
    expect(events.some((e) => e.type === 'network:vendor-match')).toBe(false);
    expect(bg.runtime.getProjection(7)?.catalogVersion).toBeNull();
    bg.runtime.stop();
  });
});

describe('matching and merge', () => {
  it('a received documented resource: rule id on the host entry, vendor documented-resource; path, query and SECRET never stored', async () => {
    const { bg, events, fake } = await setup({ catalog: ONE });
    request(bg, details());
    expect(hostRules(bg)).toEqual([['vendor.net', 'cross-site', ['vendor-x-loader']]]);
    const match = events.find((e) => e.type === 'network:vendor-match');
    expect(match).toEqual({ type: 'network:vendor-match', tabId: 7, frameId: 0, documentId: D1, registrableDomain: 'vendor.net', relation: 'cross-site', ruleIds: ['vendor-x-loader'], at: expect.any(Number) });
    const p = bg.runtime.getProjection(7)!;
    expect(p.catalogVersion).toBe('2026-10-17.unit0001');
    expect(p.vendors).toEqual([{ vendorId: 'vendor-x', vendorConfidence: 'documented-resource', ruleIds: ['vendor-x-loader'], evidenceSource: 'browser-network', integrity: 'browser-observed' }]);
    await settle(20);
    const text = JSON.stringify(events) + JSON.stringify([...bg.runtime.state.reports.values()]) + JSON.stringify([...fake.session.data.entries()]);
    expect(fake.session.data.size).toBeGreaterThan(0);
    expect(text).not.toMatch(/SECRET|session=|frag|loader\.js|\/v2|cdn\.vendor/);
    bg.runtime.stop();
  });

  it('a repeated match does not duplicate rule ids and does not bump the revision', async () => {
    const { bg } = await setup({ catalog: ONE });
    request(bg, details());
    const revision = bg.runtime.state.reports.get(KEY1)!.revision;
    bg.vendorMatch.onCompleted(details());
    bg.vendorMatch.onCompleted(details({ url: LOADER + '?other=1' }));
    expect(hostRules(bg)).toEqual([['vendor.net', 'cross-site', ['vendor-x-loader']]]);
    expect(bg.runtime.state.reports.get(KEY1)!.revision).toBe(revision);
    bg.runtime.stop();
  });

  it('404 or no status: the host is counted, no rule id', async () => {
    const { bg, events } = await setup({ catalog: ONE });
    request(bg, details({ statusCode: 404 }));
    request(bg, details({ statusCode: undefined }));
    expect(events.some((e) => e.type === 'network:vendor-match')).toBe(false);
    expect(bg.runtime.state.reports.get(KEY1)?.hosts).toMatchObject([{ registrableDomain: 'vendor.net', requestCount: 2, ruleIds: [] }]);
    bg.runtime.stop();
  });

  it('a match without a stored host entry creates nothing', async () => {
    const { bg } = await setup({ catalog: ONE });
    bg.vendorMatch.onCompleted(details());
    expect(bg.runtime.state.reports.get(KEY1)?.hosts ?? []).toEqual([]);
    bg.runtime.stop();
  });

  it('no grant for the target or the initiator (site scope): nothing', async () => {
    const { bg, events } = await setup({ catalog: ONE, scope: 'site', grants: ['https://example.com/*'] });
    request(bg, details());
    expect(events).toEqual([]);
    expect(bg.runtime.state.reports.get(KEY1)?.hosts ?? []).toEqual([]);
    bg.runtime.stop();
  });

  it('paused or revoked documents: nothing', async () => {
    const { bg, events } = await setup({ catalog: ONE });
    request(bg, details({ url: 'https://cdn.vendor.net/other.js' }));
    const report = bg.runtime.state.reports.get(KEY1)!;
    await new Promise<unknown>((resolve) => { bg.onMessage({ schemaVersion: 1, type: 'ui-pause', tabId: 7, documentKey: KEY1, reportRevision: report.revision }, uiSender(), resolve); });
    events.length = 0;
    request(bg, details());
    expect(events).toEqual([]);
    expect(hostRules(bg)).toEqual([['vendor.net', 'cross-site', []]]);
    bg.runtime.stop();

    const second = await setup({ catalog: ONE });
    second.fake.revoke(['http://*/*', 'https://*/*']);
    await second.bg.runtime.onPermissionsChanged();
    second.events.length = 0;
    request(second.bg, details());
    expect(second.events.filter((e) => e.type === 'network:vendor-match')).toEqual([]);
    expect(JSON.stringify(second.bg.runtime.state.reports.get(KEY1)?.hosts ?? [])).not.toContain('vendor-x-loader');
    second.bg.runtime.stop();
  });

  it('tabId -1 (worker / browser): unattributed, no rule id anywhere', async () => {
    const { bg, events } = await setup({ catalog: ONE });
    request(bg, details({ tabId: -1, documentId: undefined }));
    expect(bg.runtime.state.unattributed.requests).toBe(1);
    expect(events.filter((e) => e.type === 'network:vendor-match')).toEqual([]);
    bg.runtime.stop();
  });

  it('a sub_frame request is matched into the parent document', async () => {
    const frameRule = rule('vendor-x-frame', '/challenge', { network: { scheme: 'https', port: null, hosts: ['cdn.vendor.net'], suffix: null, paths: ['/challenge'], pathPattern: null, resourceType: 'sub_frame' } });
    const { bg } = await setup({ catalog: catalog([frameRule]) });
    request(bg, details({ type: 'sub_frame', url: 'https://cdn.vendor.net/challenge', frameId: 5, documentId: 'CHILD', parentFrameId: 0, parentDocumentId: D1 }));
    expect(hostRules(bg)).toEqual([['vendor.net', 'cross-site', ['vendor-x-frame']]]);
    bg.runtime.stop();
  });

  it('host cap 128: a match for an evicted host entry is dropped (dropped.hosts counts the host)', async () => {
    const { bg, events } = await setup({ catalog: ONE });
    for (let i = 0; i < BUDGETS.maxHostsPerDocument; i++) bg.network.onBeforeRequest(details({ url: 'https://cdn.h' + String(i) + '-site.net/x.js' }));
    request(bg, details());
    const report = bg.runtime.state.reports.get(KEY1)!;
    expect(report.hosts).toHaveLength(BUDGETS.maxHostsPerDocument);
    expect(report.dropped.hosts).toBe(1);
    expect(events.filter((e) => e.type === 'network:vendor-match')).toHaveLength(1);
    expect(JSON.stringify(report.hosts)).not.toContain('vendor-x-loader');
    expect(bg.runtime.getProjection(7)?.vendors).toEqual([]);
    bg.runtime.stop();
  });

  it('33 rule ids on one host: 32 kept (sorted) and budget-exceeded', async () => {
    const rules = Array.from({ length: 33 }, (_, i) => rule('vendor-x-p' + String(i).padStart(2, '0'), '/p' + String(i) + '.js'));
    const { bg } = await setup({ catalog: catalog(rules) });
    for (let i = 0; i < 33; i++) request(bg, details({ url: 'https://cdn.vendor.net/p' + String(i) + '.js' }));
    const report = bg.runtime.state.reports.get(KEY1)!;
    const ids = report.hosts[0]!.ruleIds;
    expect(ids).toHaveLength(32);
    expect(ids).toEqual([...ids].sort());
    expect(ids).not.toContain('vendor-x-p32');
    expect(report.coverageFlags).toContain('budget-exceeded');
    const p = bg.runtime.getProjection(7)!;
    expect(p.vendors[0]?.ruleIds).toHaveLength(32);
    bg.runtime.stop();
  });

  it('mergeRuleIds: sorted unique union, invalid ids dropped, overflow and change reported', () => {
    expect(mergeRuleIds(['b'], ['a', 'b', 'a/x', ''])).toEqual({ ruleIds: ['a', 'b'], changed: true, overflow: false });
    expect(mergeRuleIds(['a', 'b'], ['b'])).toEqual({ ruleIds: ['a', 'b'], changed: false, overflow: false });
    const many = Array.from({ length: 40 }, (_, i) => 'r' + String(i).padStart(2, '0'));
    const merged = mergeRuleIds(many.slice(0, 32), many.slice(32));
    expect(merged).toEqual({ ruleIds: many.slice(0, 32), changed: false, overflow: true });
  });
});

describe('catalog switching and restore', () => {
  it('setCatalog: synthetic test catalog on, then the empty one; kind is checked', async () => {
    const fake = createFakeChrome({ grantedOrigins: ['http://*/*', 'https://*/*'] });
    fake.local.data.set('scope', { v: 1, scopeMode: 'all-sites', hosts: [] });
    const bg = createBackground(fake, { ttlIntervalMs: 0, persistDebounceMs: 1, networkSalt: SALT });
    await bg.start();
    bg.navigation.onCommitted(committed({ url: 'http://127.0.0.1:4173/vendors/synthetic/positive.html' }));
    bg.runtime.setCatalog(SYNTHETIC_TEST_CATALOG);
    expect(bg.runtime.diagnostics()).toMatchObject({ catalogVersion: 'synthetic-test-1', catalogRules: SYNTHETIC_TEST_CATALOG.rules.length });
    request(bg, details({ initiator: 'http://127.0.0.1:4173', url: 'http://127.0.0.1:4174/vendors/synthetic/loader.js?session=CANARY-E12-QUERY' }));
    expect(hostRules(bg)).toEqual([['loopback', 'same-site', ['test-synthetic-loader']]]);
    const on = bg.runtime.getProjection(7)!;
    expect(on.catalogVersion).toBe('synthetic-test-1');
    expect(on.vendors).toMatchObject([{ vendorId: 'test-synthetic', vendorConfidence: 'documented-resource', evidenceSource: 'browser-network', integrity: 'browser-observed' }]);
    expect(JSON.stringify(on)).not.toMatch(/4174|127\.0\.0\.1|CANARY|loader\.js|\/vendors/);
    bg.runtime.setCatalog(EMPTY_CATALOG);
    const off = bg.runtime.getProjection(7)!;
    expect(off.catalogVersion).toBeNull();
    expect(off.vendors).toEqual([]);
    expect(off.hosts.every((h) => h.ruleIds.length === 0)).toBe(true);
    expect(() => bg.runtime.setCatalog({ ...SYNTHETIC_TEST_CATALOG, kind: 'remote' } as unknown as CatalogIndex)).toThrow('invalid-catalog');
    expect(() => bg.runtime.setCatalog(null as unknown as CatalogIndex)).toThrow('invalid-catalog');
    expect(bg.runtime.catalog).toBe(EMPTY_CATALOG);
    bg.runtime.stop();
  });

  it('restore: matched rule ids survive a service-worker restart', async () => {
    const { bg, fake } = await setup({ catalog: ONE });
    request(bg, details());
    await settle(30);
    bg.runtime.stop();
    fake.tabList = [{ id: 7 }];
    fake.framesByTab.set(7, [committed()]);
    const restarted = createBackground(fake, { ttlIntervalMs: 0, persistDebounceMs: 1, networkSalt: SALT, catalog: ONE });
    await restarted.start();
    expect(restarted.runtime.state.reports.get(KEY1)?.hosts.map((h) => h.ruleIds)).toEqual([['vendor-x-loader']]);
    expect(restarted.runtime.getProjection(7)?.vendors.map((v) => v.vendorId)).toEqual(['vendor-x']);
    restarted.runtime.stop();
  });
});

describe('I1: the request document after its binding moved on (ADR-018 / docs/PROJECT_RULES.md #9)', () => {
  const D2 = 'DOC000000000000000000000000000002';

  it('onCompleted after the next commit still merges into the host entry of the request document; an unknown one adds nothing', async () => {
    const { bg } = await setup({ catalog: ONE });
    const { statusCode: _s, ...before } = details();
    bg.network.onBeforeRequest(before); // host entry while D1 is current
    bg.navigation.onCommitted(committed({ documentId: D2, url: 'https://example.com/next' }));
    bg.vendorMatch.onCompleted(details()); // the response arrives after D2 committed
    expect(hostRules(bg)).toEqual([['vendor.net', 'cross-site', ['vendor-x-loader']]]);
    expect(bg.runtime.state.reports.get('7:0:' + D2)?.hosts ?? []).toEqual([]);
    // A document with neither binding nor report: no rule id anywhere and no second unattributed count.
    const unknown = 'DOC0000000000000000000000000000FF';
    const { statusCode: _u, ...unknownBefore } = details({ documentId: unknown });
    bg.network.onBeforeRequest(unknownBefore);
    bg.vendorMatch.onCompleted(details({ documentId: unknown }));
    expect(bg.runtime.state.unattributed.requests).toBe(1);
    expect([...bg.runtime.state.reports.keys()].some((k) => k.endsWith(unknown))).toBe(false);
    bg.runtime.stop();
  });
});
