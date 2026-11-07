import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUDGETS } from '@detect-expert/contracts';
import { matchVendorResource } from '../../catalog/src/index';
import { createExportPreview } from '../../export/src/index';
import { createBackground, readStoredDocument, route, type Background, type RequestDetailsLike } from '../src/index';
import { committed, createFakeChrome, pageSender, settle } from './fake-chrome';

const D1 = 'DOC000000000000000000000000000001';
const D2 = 'DOC000000000000000000000000000002';
const D3 = 'DOC000000000000000000000000000003';
const KEY = `7:0:${D1}`;
const NOW = Date.parse('2026-09-13T12:00:00Z');
const URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=CANARY_SITEKEY#CANARY_FRAGMENT';
const running: Background[] = [];
afterEach(() => { for (const bg of running.splice(0)) bg.runtime.stop(); });

function coldSetup(origins = ['http://*/*', 'https://*/*'], maxPendingEvents?: number) {
  const fake = createFakeChrome({ grantedOrigins: origins });
  fake.local.data.set('scope', { v: 1, scopeMode: 'all-sites', hosts: [] });
  fake.tabList = [{ id: 7 }];
  fake.framesByTab.set(7, [committed()]);
  const clock = { t: NOW, now() { return this.t; } };
  const bg = createBackground(fake, { clock, ttlIntervalMs: 0, persistDebounceMs: 1,
    ...(maxPendingEvents === undefined ? {} : { maxPendingEvents }) });
  running.push(bg);
  return { bg, fake, clock };
}

async function setup(origins = ['http://*/*', 'https://*/*']) {
  const result = coldSetup(origins);
  await result.bg.start();
  return result;
}

function request(over: Partial<RequestDetailsLike> = {}): RequestDetailsLike {
  return { tabId: 7, frameId: 0, documentId: D1, parentFrameId: -1, type: 'script',
    url: URL, initiator: 'https://example.com', statusCode: 200, timeStamp: NOW, ...over };
}

describe('ADR-009 browser-resource vendor integration', () => {
  it('vendor-worker-wakeup: buffers only redacted metadata before hydration and verifies broad grants before replay', async () => {
    const { bg, fake } = coldSetup();
    await bg.runtime.scope.load();
    const dispatched = vi.spyOn(bg.runtime, 'dispatch');
    bg.network.onCompleted(request());
    expect(bg.runtime.state.reports.size).toBe(0);
    expect(dispatched).toHaveBeenCalledWith(expect.objectContaining({ type: 'network:host',
      host: 'cloudflare.com', requiresAllSitesAccess: true, ruleIds: ['turnstile-loader-v1'] }));
    expect(JSON.stringify(dispatched.mock.calls)).not.toMatch(/CANARY_|challenges\.cloudflare|api\.js|https:\/\//);
    await bg.start();
    expect(bg.runtime.getProjection(7)?.vendors).toHaveLength(1);
    await settle(10);
    expect(JSON.stringify([...fake.session.data])).not.toMatch(/CANARY_|requiresAllSitesAccess|challenges\.cloudflare|api\.js/);
  });

  it.each([
    { origins: [], scopeMode: 'all-sites' },
    { origins: ['https://example.com/*', 'https://challenges.cloudflare.com/*'], scopeMode: 'all-sites' },
    { origins: ['http://*/*', 'https://*/*'], scopeMode: 'site' },
    { origins: ['http://*/*', 'https://*/*'], scopeMode: 'off' },
  ])('vendor-worker-wakeup: narrowed or denied startup cannot replay resources (%j)', async ({ origins, scopeMode }) => {
    const { bg, fake } = coldSetup(origins);
    fake.local.data.set('scope', { v: 1, scopeMode, hosts: ['example.com'] });
    await bg.runtime.scope.load();
    bg.network.onCompleted(request());
    await bg.start();
    expect(bg.runtime.getProjection(7)?.vendors ?? []).toEqual([]);
    expect(bg.runtime.state.reports.get(KEY)?.hosts ?? []).toEqual([]);
  });

  it('vendor-worker-wakeup: permission loss before hydration discards the pending resource', async () => {
    const { bg, fake } = coldSetup();
    await bg.runtime.scope.load();
    bg.network.onCompleted(request());
    fake.revoke(['http://*/*', 'https://*/*']);
    await bg.start();
    expect(bg.runtime.getProjection(7)?.vendors ?? []).toEqual([]);
  });

  it('vendor-worker-wakeup: reconciled child identity is exact and stale document events are discarded', async () => {
    const { bg, fake } = coldSetup();
    fake.framesByTab.set(7, [committed(), committed({ frameId: 3, documentId: D2, parentFrameId: 0,
      parentDocumentId: D1, frameType: 'sub_frame', url: 'https://other.example/child' })]);
    await bg.runtime.scope.load();
    bg.network.onCompleted(request({ frameId: 3, documentId: D2, initiator: 'https://other.example' }));
    bg.network.onCompleted(request({ documentId: D3 }));
    await bg.start();
    expect(bg.runtime.getProjection(7)?.vendors).toEqual([]);
    expect(bg.runtime.getProjection(7, 3)?.vendors).toHaveLength(1);
    expect(bg.runtime.state.reports.has(`7:0:${D3}`)).toBe(false);
  });

  it('vendor-worker-wakeup: bounded overflow marks retained reports degraded with a visible gap', async () => {
    const { bg } = coldSetup(undefined, 2);
    await bg.runtime.scope.load();
    for (let i = 0; i < 4; i++) bg.network.onCompleted(request());
    await bg.start();
    expect(bg.runtime.diagnostics().pendingDropped).toBe(2);
    expect(bg.runtime.state.reports.get(KEY)?.hosts[0]?.requestCount).toBe(2);
    expect(bg.runtime.getProjection(7)?.coverageFlags).toContain('network-limited');
    expect(bg.runtime.getProjection(7)?.coverageState).toBe('degraded');
  });

  it('vendor-completed-status: loaded-but-unused is a resource match without API or execution claims', async () => {
    const { bg } = await setup();
    bg.network.onCompleted(request());
    bg.network.onCompleted(request({ statusCode: 304 }));
    const matches = matchVendorResource(URL, 'script', NOW);
    expect(matches).toHaveLength(1);
    const projection = bg.runtime.getProjection(7)!;
    expect(projection.vendors).toEqual([{ vendorId: 'cloudflare-turnstile',
      vendorConfidence: 'documented-resource', ruleIds: [matches[0]!.ruleId],
      evidenceSource: 'browser-network', integrity: 'browser-observed' }]);
    expect(projection.techniques).toEqual([]);
    expect(projection.findings).toEqual([]);
    expect(projection.observedSince).toBe(NOW);
    expect(projection.coverageState).toBe('partial');
    expect(bg.runtime.state.reports.get(KEY)?.hosts[0]).toMatchObject({ requestCount: 2,
      ruleIds: [matches[0]!.ruleId], registrableDomain: 'cloudflare.com' });
  });

  it.each([undefined, 0, 199, 300, 301, 400, 404, 500, 200.5])(
    'vendor-completed-status: status %s cannot establish a loaded resource', async statusCode => {
      const { bg } = await setup();
      bg.network.onCompleted(request({ statusCode }));
      expect(bg.runtime.getProjection(7)?.vendors).toEqual([]);
      expect(bg.runtime.getProjection(7)?.observedSince).toBeNull();
    });

  it('vendor-no-load: navigation/DOM-like page claims and an aborted request create no resource evidence', async () => {
    const { bg } = await setup();
    // No onCompleted event exists for abort/DOM-only/docs text. A page cannot manufacture that channel.
    const forged = { schemaVersion: 1, type: 'sensor-events', sensorBootId: 'boot', bridgeSessionId: 'bridge',
      batchSeq: 1, coverageDelta: [], observations: [], ruleIds: ['turnstile-resource'], url: URL };
    await route(bg.runtime, forged, pageSender());
    await route(bg.runtime, { ...request(), type: 'network:host', ruleIds: ['turnstile-resource'] }, pageSender());
    expect(bg.runtime.getProjection(7)?.vendors).toEqual([]);
    expect(bg.runtime.state.reports.get(KEY)?.hosts).toEqual([]);
  });

  it.each([
    { type: 'xmlhttprequest' }, { type: 'image' }, { url: 'https://cdn.cloudflare.com/turnstile/v0/api.js' },
    { url: 'https://challenges.cloudflare.com/turnstile/v0/documentation.html' },
    { url: 'https://challenges.cloudflare.com.evil.test/turnstile/v0/api.js' },
    { url: 'https://example.com/self-hosted-api.js' },
  ])('vendor-no-generic-match: resource %j stays unknown', async over => {
    const { bg } = await setup();
    bg.network.onCompleted(request(over));
    expect(bg.runtime.getProjection(7)?.vendors).toEqual([]);
  });

  it.each([
    { origins: ['https://example.com/*'] }, { origins: ['https://challenges.cloudflare.com/*'] }, { origins: [] },
  ])('vendor-no-permission: requires both real destination and initiator grants %j', async ({ origins }) => {
    const { bg } = await setup(origins);
    bg.network.onCompleted(request());
    expect(bg.runtime.getProjection(7)?.vendors).toEqual([]);
    expect(bg.runtime.state.reports.get(KEY)?.hosts).toEqual([]);
  });

  it('vendor-frame-binding: cross-origin script belongs only to its current browser child document', async () => {
    const { bg, fake } = await setup();
    const child = committed({ frameId: 3, documentId: D2, parentDocumentId: D1, parentFrameId: 0,
      frameType: 'sub_frame', url: 'https://other.example/child' });
    fake.framesByTab.set(7, [committed(), child]);
    bg.navigation.onCommitted(child);
    bg.network.onCompleted(request({ frameId: 3, documentId: D2, initiator: 'https://other.example' }));
    expect(bg.runtime.getProjection(7)?.vendors).toEqual([]);
    expect(bg.runtime.getProjection(7, 3)?.vendors).toHaveLength(1);
    const replacement = { ...child, documentId: D3 };
    fake.framesByTab.set(7, [committed(), replacement]);
    bg.navigation.onCommitted(replacement);
    bg.network.onCompleted(request({ frameId: 3, documentId: D2, initiator: 'https://other.example' }));
    bg.network.onCompleted(request({ frameId: 3, documentId: undefined, initiator: 'https://other.example' }));
    bg.network.onCompleted(request({ tabId: -1, documentId: undefined }));
    expect(bg.runtime.getProjection(7, 3)?.vendors).toEqual([]);
    expect(bg.runtime.state.reports.get(`7:3:${D2}`)?.hosts[0]?.requestCount).toBe(1);
  });

  it('vendor-persistence-redaction: late/SPA matches survive restart with only bounded rule IDs and registrable hosts', async () => {
    const { bg, fake, clock } = await setup();
    clock.t += 30_000;
    bg.navigation.onHistoryStateUpdated(committed({ url: 'https://example.com/account/CANARY_ACCOUNT' }));
    bg.network.onCompleted(request());
    await settle(20);
    await bg.runtime.flushIndex();
    const stored = readStoredDocument('doc:' + KEY, fake.session.data.get('doc:' + KEY));
    expect(stored?.report.hosts[0]?.ruleIds).toHaveLength(1);
    const persisted = JSON.stringify([...fake.session.data]);
    expect(persisted).not.toMatch(/CANARY_|challenges\.cloudflare|api\.js|https:\/\//);
    bg.runtime.stop();
    const next = createBackground(fake, { clock, ttlIntervalMs: 0, persistDebounceMs: 1 });
    running.push(next);
    await next.start();
    const projection = next.runtime.getProjection(7)!;
    expect(projection.vendors).toHaveLength(1);
    expect(projection.observedSince).toBe(clock.t);
    const preview = createExportPreview(projection, clock.t);
    expect(preview.report.vendors).toEqual(projection.vendors);
    expect(preview.report.host).toBeNull();
    expect(JSON.stringify(preview)).not.toMatch(/cloudflare\.com|example\.com|CANARY_|documentId|api\.js/);
  });

  it('vendor-scope-lifecycle: pause stops new resources; resume works; revoke purges stored recognition', async () => {
    const { bg } = await setup();
    const revision = () => bg.runtime.getProjection(7)!.reportRevision;
    await bg.runtime.pause(7, KEY, revision());
    bg.network.onCompleted(request());
    expect(bg.runtime.getProjection(7)?.vendors).toEqual([]);
    await bg.runtime.resume(7, KEY, revision());
    bg.network.onCompleted(request());
    expect(bg.runtime.getProjection(7)?.vendors).toHaveLength(1);
    bg.runtime.dispatch({ type: 'scope:revoked', documentKeys: [KEY], at: NOW });
    bg.network.onCompleted(request());
    expect(bg.runtime.getProjection(7)?.vendors).toEqual([]);
    expect(bg.runtime.state.reports.get(KEY)?.hosts).toEqual([]);
  });

  it('vendor-threatmetrix: groups both vetted loader rules by product and never retains organization/session values', async () => {
    const { bg } = await setup();
    for (const host of ['h.online-metrix.net', 'h-api.online-metrix.net', 'h.online-metrix.net']) {
      bg.network.onCompleted(request({ url: `https://${host}/fp/tags.js?org_id=CANARY_ORG&session_id=CANARY_SESSION` }));
    }
    expect(bg.runtime.getProjection(7)?.vendors).toEqual([{ vendorId: 'threatmetrix',
      vendorConfidence: 'documented-resource', ruleIds: ['threatmetrix-h-api-loader-v1', 'threatmetrix-h-loader-v1'],
      evidenceSource: 'browser-network', integrity: 'browser-observed' }]);
    const report = bg.runtime.state.reports.get(KEY)!;
    expect(report.hosts).toHaveLength(1);
    expect(report.hosts[0]?.requestCount).toBe(3);
    expect(JSON.stringify(report)).not.toMatch(/CANARY_|org_id|session_id|tags\.js|h-api\./);
  });

  it('vendor-budget: full host capacity reports the lost resource and never grows state or fabricates a match', async () => {
    const { bg } = await setup();
    for (let i = 0; i < BUDGETS.maxHostsPerDocument; i++) {
      bg.network.onCompleted(request({ url: `https://site${i}.com/script.js` }));
    }
    bg.network.onCompleted(request());
    const report = bg.runtime.state.reports.get(KEY)!;
    expect(report.hosts).toHaveLength(BUDGETS.maxHostsPerDocument);
    expect(report.dropped.hosts).toBe(1);
    expect(report.coverageFlags).toContain('budget-exceeded');
    expect(bg.runtime.getProjection(7)?.vendors).toEqual([]);
    expect(bg.runtime.getProjection(7)?.observedSince).toBeNull();
  });

  it('vendor-clear: removes resource IDs from storage together with the document report', async () => {
    const { bg, fake } = await setup();
    bg.network.onCompleted(request());
    await settle(15);
    const projection = bg.runtime.getProjection(7)!;
    expect(projection.vendors).toHaveLength(1);
    await bg.runtime.clear(7, KEY, projection.reportRevision);
    expect(fake.session.data.has('doc:' + KEY)).toBe(false);
    expect(bg.runtime.getProjection(7)).toBeNull();
  });

  it('vendor-rule-expiry: unknown IDs never persist and expired resources are not projected after reload', async () => {
    const { bg, clock } = await setup();
    bg.runtime.dispatch({ type: 'network:host', tabId: 7, frameId: 0, documentId: D1,
      parentDocumentId: null, parentFrameId: -1, resourceType: 'script', host: 'cloudflare.com',
      ruleIds: ['arbitrary-candidate', 'https://CANARY.invalid/token'], at: NOW });
    expect(bg.runtime.state.reports.get(KEY)?.hosts[0]?.ruleIds).toEqual([]);
    bg.network.onCompleted(request());
    expect(bg.runtime.getProjection(7)?.vendors).toHaveLength(1);
    clock.t = Date.parse('2030-01-01T00:00:00Z');
    expect(bg.runtime.getProjection(7)?.vendors).toEqual([]);
  });

  it('vendor-real-revoke: browser permission removal purges resource-only reports before any sensor hello', async () => {
    const { bg, fake, clock } = await setup();
    bg.network.onCompleted(request());
    expect(bg.runtime.state.metas.get(KEY)?.sensorSeen).toBe(false);
    expect(bg.runtime.getProjection(7)?.vendors).toHaveLength(1);
    fake.revoke(['http://*/*', 'https://*/*']);
    await bg.runtime.onPermissionsChanged();
    expect(bg.runtime.getProjection(7)?.vendors).toEqual([]);
    expect(bg.runtime.state.reports.get(KEY)?.hosts).toEqual([]);
    expect(bg.runtime.state.metas.get(KEY)?.revoked).toBe(true);
    expect(bg.runtime.state.metas.get(KEY)?.firstObservationAt).toBeNull();
    expect(readStoredDocument('doc:' + KEY, fake.session.data.get('doc:' + KEY))?.report.hosts).toEqual([]);
    expect(JSON.stringify([...fake.session.data])).not.toContain('cloudflare');
    fake.grant(['http://*/*', 'https://*/*']);
    await bg.runtime.scope.setScope({ schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'all-sites' });
    await bg.runtime.onPermissionsChanged();
    // A subsequent trusted access transition cannot resurrect the purged observation window.
    clock.t += 60_000;
    bg.runtime.dispatch({ type: 'scope:access', documentKey: KEY, host: 'example.com', accessGranted: true, at: clock.t });
    expect(bg.runtime.getProjection(7)?.observedSince).toBeNull();
    bg.network.onCompleted(request());
    expect(bg.runtime.getProjection(7)?.observedSince).toBe(clock.t);
    expect(bg.runtime.getProjection(7)?.vendors).toHaveLength(1);
  });

  it('vendor-watermark: an earlier resource does not fabricate missing sensor batch counts after an unknown restart', async () => {
    const { bg } = await setup();
    bg.network.onCompleted(request());
    expect(bg.runtime.getProjection(7)?.observedSince).toBe(NOW);
    await route(bg.runtime, { schemaVersion: 1, type: 'sensor-events', sensorBootId: 'boot-1',
      bridgeSessionId: 'bridge-1', batchSeq: 7, coverageDelta: [], observations: [{
        techniqueId: 'DET-001', count: 1, countQuality: 'exact', phase: 'attempted',
        signalCodes: ['api-use'], intervalBucket: 0,
      }] }, pageSender());
    const report = bg.runtime.state.reports.get(KEY)!;
    expect(report.watermark?.lastCommittedBatchSeq).toBe(7);
    expect(report.coverageFlags).toContain('truncated');
    expect(report.dropped.batches).toBe(0);
    expect(report.counters[0]?.count).toBe(1);
    expect(bg.runtime.getProjection(7)?.vendors).toHaveLength(1);
  });
});
