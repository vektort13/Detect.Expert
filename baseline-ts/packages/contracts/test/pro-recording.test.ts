import { describe, expect, it } from 'vitest';
import { EMPTY_DROPPED, PRO_LIMITS, validateProRequest, validateProSession, validateProStateResponse } from '../src/index';
import type { ProSession, ReportProjection } from '../src/index';

const report: ReportProjection = { reportRevision: 2, documentKey: '1:0:doc', host: 'example.com', coverageState: 'partial', coverageFlags: ['worker-not-observed'], techniques: [{ techniqueId: 'DET-032', count: 1, countQuality: 'exact', phases: ['returned-sync'], signalCodes: ['api-use'], evidenceSource: 'page-hook', integrity: 'page-controlled', interpretation: 'api-use', interpretationConfidence: 'high', attributionConfidence: 'frame-only', firstBucket: 0, lastBucket: 0 }], findings: [], vendors: [], dropped: { ...EMPTY_DROPPED }, observedSince: 1000, scopeMode: 'all-sites' };
function sample(): ProSession {
  return { schemaVersion: 1, id: 'session-1', domain: 'example.com', siteKey: 'example.com', startTabId: 1, status: 'stopped', startedAt: 1000, deadlineAt: 601000, stoppedAt: 2000, stopReason: 'manual', limitations: ['redacted-urls'], dropped: { pages: 0, resources: 0, documents: 0, events: 0 }, pages: [{ id: 'page-1', tabId: 1, documentKey: '1:0:doc', url: 'https://example.com/registration', title: 'Registration · 注册 · التسجيل', startedAt: 1000, endedAt: 2000, reports: [structuredClone(report)], resources: [{ id: 'resource-1', url: 'https://cdn.example.net/:resource.js', domain: 'example.net', relation: 'cross-site', type: 'script', requestCount: 2, completedCount: 1, failedCount: 1, redirectCount: 0, firstSeenAt: 1000, lastSeenAt: 1900, durationTotalMs: 3, statusCodes: [200] }] }] };
}
describe('ADR-023 Pro privileged contract', () => {
  it('rejects fabricated attribution and timing on browser-only response headers', () => {
    const session = sample();
    const headerReport = session.pages[0]!.reports[0]!;
    headerReport.responseHeaders = { entries: [{ name: 'nel', count: 1, clientHints: [] }], truncated: false };
    headerReport.techniques = [{ techniqueId: 'DET-074', count: 1, countQuality: 'exact', phases: [], signalCodes: [],
      evidenceSource: 'browser-network', integrity: 'browser-observed', interpretation: 'unknown', interpretationConfidence: 'unassessed',
      attributionConfidence: 'frame-only', firstBucket: 0, lastBucket: 0 }];
    expect(validateProSession(session).ok).toBe(true);
    for (const delta of [{ attributionConfidence: 'exact-resource' }, { firstBucket: 17, lastBucket: 19 }]) {
      const invalid = structuredClone(session);
      Object.assign(invalid.pages[0]!.reports[0]!.techniques[0]!, delta);
      expect(validateProSession(invalid).ok).toBe(false);
    }
  });
  it('admits only defined commands with explicit stale-session identity', () => {
    for (const request of [{ type: 'ui-pro-get' }, { type: 'ui-pro-get', tabId: 1 }, { type: 'ui-pro-start', tabId: 1 }, { type: 'ui-pro-stop', sessionId: 'session-1' }, { type: 'ui-pro-clear', sessionId: 'session-1' }]) expect(validateProRequest({ schemaVersion: 1, ...request }).ok).toBe(true);
    for (const request of [{ type: 'ui-pro-start' }, { type: 'ui-pro-start', tabId: -1 }, { type: 'ui-pro-stop' }, { type: 'ui-pro-stop', sessionId: 'session-1', tabId: 1 }, { type: 'ui-pro-get', documentKey: 'forged' }, { type: 'ui-pro-upload' }, { type: 'ui-pro-start', tabId: 1, url: 'https://evil.example' }]) expect(validateProRequest({ schemaVersion: 1, ...request }).ok).toBe(false);
  });
  it('accepts Unicode titles, canonical report fields and redacted resource templates', () => {
    const session = sample();
    expect(validateProSession(session).ok).toBe(true);
    expect(validateProStateResponse({ schemaVersion: 1, type: 'pro-state', session, currentDomain: 'example.com', canStart: true }).ok).toBe(true);
    expect(validateProStateResponse({ schemaVersion: 1, type: 'pro-state', session: null, currentDomain: null, canStart: false }).ok).toBe(true);
  });
  it('enforces a fixed ten-minute window and coherent recording/stop fields', () => {
    for (const change of [{ deadlineAt: 601001 }, { stoppedAt: 999 }, { stoppedAt: 601001 }, { status: 'recording' }, { stopReason: null }, { stoppedAt: null }, { stopReason: 'invented' }]) expect(validateProSession({ ...sample(), ...change }).ok).toBe(false);
    expect(validateProSession({ ...sample(), status: 'recording', stoppedAt: null, stopReason: null }).ok).toBe(true);
    expect(validateProSession({ ...sample(), stoppedAt: 601000, stopReason: 'timeout' }).ok).toBe(true);
  });
  it('refuses unredacted URL secrets and unexpected data channels', () => {
    for (const url of ['https://example.com/?token=SECRET', 'https://user:password@example.com/', 'https://example.com/#session', 'data:text/html,hello', 'javascript:alert(1)']) {
      const session = sample(); session.pages[0]!.resources[0]!.url = url;
      expect(validateProSession(session).ok).toBe(false);
    }
    for (const payload of [{ pixels: 'payload' }, { rtc: {} }, { cookie: 'session' }]) expect(validateProSession({ ...sample(), ...payload }).ok).toBe(false);
    const session = sample(); Object.assign(session.pages[0]!.reports[0]!, { rawStack: 'payload' });
    expect(validateProSession(session).ok).toBe(false);
  });
  it('rejects nested accessors and serialization hooks without evaluating them', () => {
    let calls = 0;
    const session = sample();
    Object.defineProperty(session.pages[0]!.resources[0], 'url', { get() { calls++; return 'https://example.com/'; }, enumerable: true });
    expect(validateProSession(session).ok).toBe(false);
    const arrays = sample(); Object.assign(arrays.pages, { toJSON() { calls++; return []; } });
    expect(validateProSession(arrays).ok).toBe(false);
    const request = { schemaVersion: 1, type: 'ui-pro-start', get tabId() { calls++; return 1; } };
    expect(validateProRequest(request).ok).toBe(false);
    expect(calls).toBe(0);
  });
  it('bounds page/document/resource arrays and rejects duplicate visit IDs', () => {
    const session = sample();
    expect(validateProSession({ ...session, pages: [session.pages[0], session.pages[0]] }).ok).toBe(false);
    expect(validateProSession({ ...session, pages: Array.from({ length: PRO_LIMITS.maxPages + 1 }, (_, i) => ({ ...session.pages[0], id: 'page-' + i })) }).ok).toBe(false);
    session.pages[0]!.reports = Array.from({ length: PRO_LIMITS.maxDocumentsPerPage + 1 }, () => structuredClone(report));
    expect(validateProSession(session).ok).toBe(false);
    const resources = sample(); resources.pages[0]!.resources = Array.from({ length: PRO_LIMITS.maxResourcesPerPage + 1 }, (_, i) => ({ ...resources.pages[0]!.resources[0]!, id: 'resource-' + i }));
    expect(validateProSession(resources).ok).toBe(false);
  });
  it('rejects duplicate report/resource identities and activity outside the recording window', () => {
    const docs = sample(); docs.pages[0]!.reports.push(structuredClone(report));
    expect(validateProSession(docs).ok).toBe(false);
    const resources = sample(); resources.pages[0]!.resources.push(structuredClone(resources.pages[0]!.resources[0]!));
    expect(validateProSession(resources).ok).toBe(false);
    const future = sample(); future.pages[0]!.resources[0]!.lastSeenAt = future.deadlineAt + 1;
    expect(validateProSession(future).ok).toBe(false);
    const unclosed = sample(); unclosed.pages[0]!.endedAt = null;
    expect(validateProSession(unclosed).ok).toBe(false);
  });
  it('rejects malformed canonical detector/HTTP data instead of rendering it as evidence', () => {
    const session = sample(); session.pages[0]!.reports[0]!.techniques[0]!.count = -1;
    expect(validateProSession(session).ok).toBe(false);
    const statuses = sample(); statuses.pages[0]!.resources[0]!.statusCodes = [200, 200];
    expect(validateProSession(statuses).ok).toBe(false);
    statuses.pages[0]!.resources[0]!.statusCodes = [999];
    expect(validateProSession(statuses).ok).toBe(false);
    const backwards = sample(); backwards.pages[0]!.resources[0]!.lastSeenAt = 1;
    expect(validateProSession(backwards).ok).toBe(false);
  });
});
