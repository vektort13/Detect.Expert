import { describe, expect, it, vi } from 'vitest';
import { createResponseHeadersListener, normalizeResponseHeaders } from '../src/response-headers';
import { mergeResponseHeaders, readResponseHeaders } from '../../contracts/src/response-headers';
import { EMPTY_DROPPED } from '@detect-expert/contracts';
import type { ReportProjection } from '@detect-expert/contracts';
import { attachResponseHeaders, verifyProjection } from '../../engine/src/projection';
import { createExportPreview } from '../../export/src/index';
import { createBackground } from '../src/index';
import { createFakeChrome } from './fake-chrome';
import { compileSchema } from '../../contracts/test/helpers';

describe('ADR-038 response-header redaction', () => {
  it('binds two queued startup navigations to their own response before replay', async () => {
    const api = createFakeChrome({ grantedOrigins: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] });
    api.local.data.set('scope', { v: 1, scopeMode: 'all-sites', hosts: [] });
    api.tabList = [{ id: 7 }];
    api.framesByTab.set(7, [{ frameId: 0, documentId: 'old', url: 'https://example.com/', documentLifecycle: 'active' }]);
    const background = createBackground(api, { ttlIntervalMs: 0, persistDebounceMs: 0 });
    let reached!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { reached = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const originalStart = background.runtime.pro.start.bind(background.runtime.pro);
    vi.spyOn(background.runtime.pro, 'start').mockImplementation(async () => { await originalStart(); reached(); await blocked; });
    const start = background.start(); await entered;
    try {
      for (const [documentId, name] of [['first', 'NEL'], ['second', 'Report-To']] as const) {
        const details = { tabId: 7, frameId: 0, url: 'https://example.com/', timeStamp: Date.now() };
        const request = { ...details, type: 'main_frame', requestId: documentId };
        background.navigation.onBeforeNavigate(details);
        background.runtime.responseHeaders.onBeforeRequest(request);
        background.network.onResponseCompleted({ ...request, responseHeaders: [{ name }] });
        background.navigation.onCommitted({ ...details, documentId, frameType: 'outermost_frame', documentLifecycle: 'active' });
      }
      release(); await start;
      expect(background.runtime.state.metas.get('7:0:first')?.responseHeaders?.entries).toEqual([{ name: 'nel', count: 1, clientHints: [] }]);
      expect(background.runtime.getProjection(7)?.responseHeaders?.entries).toEqual([{ name: 'report-to', count: 1, clientHints: [] }]);
    } finally { release(); await start; background.runtime.stop(); }
  });

  it.each(['capacity', 'ttl', 'response-deadline'])('marks a %s navigation loss instead of silently dropping selected headers', async reason => {
    const clock = { value: 100000, now() { return this.value; } };
    const api = createFakeChrome({ grantedOrigins: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] });
    api.local.data.set('scope', { v: 1, scopeMode: 'all-sites', hosts: [] });
    api.tabList = [{ id: 7 }];
    api.framesByTab.set(7, [{ frameId: 0, documentId: 'old', url: 'https://example.com/', documentLifecycle: 'active' }]);
    const background = createBackground(api, { clock, ttlIntervalMs: 0, persistDebounceMs: 0 }); await background.start();
    try {
      const details = { tabId: 7, frameId: 0, url: 'https://example.com/', timeStamp: clock.value };
      const request = { ...details, requestId: 'pending', type: 'main_frame' };
      background.navigation.onBeforeNavigate(details); background.runtime.responseHeaders.onBeforeRequest(request);
      background.network.onResponseCompleted({ ...request, responseHeaders: [{ name: 'NEL' }] });
      if (reason === 'capacity') for (let index = 0; index < 128; index++) background.navigation.onBeforeNavigate({ ...details, tabId: 100 + index });
      else clock.value += reason === 'ttl' ? 60001 : 2001;
      background.navigation.onCommitted({ ...details, timeStamp: clock.value, documentId: 'new', frameType: 'outermost_frame', documentLifecycle: 'active' });
      expect(background.runtime.getProjection(7)?.responseHeaders).toEqual({ entries: [], truncated: true });
      expect(background.runtime.getProjection(7)?.coverageFlags).toContain('network-limited');
      expect(background.runtime.getProjection(7)?.techniques.some(row => row.techniqueId === 'DET-074')).toBe(false);
    } finally { background.runtime.stop(); }
  });

  it.each([{ ambiguous: false, early: false }, { ambiguous: false, early: true }, { ambiguous: true, early: false }, { ambiguous: true, early: true }])(
    'correlates a navigation response without documentId only when browser events are unambiguous ($ambiguous / early=$early)', async ({ ambiguous, early }) => {
    const api = createFakeChrome({ grantedOrigins: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] });
    api.local.data.set('scope', { v: 1, scopeMode: 'all-sites', hosts: [] });
    api.tabList = [{ id: 7 }];
    api.framesByTab.set(7, [{ frameId: 0, documentId: 'old', url: 'https://example.com/', documentLifecycle: 'active' }]);
    const background = createBackground(api, { ttlIntervalMs: 0, persistDebounceMs: 0 }); await background.start();
    const before = { tabId: 7, frameId: 0, url: 'https://example.com/new', timeStamp: Date.now() };
    const request = { ...before, type: 'main_frame', requestId: 'browser-request' };
    try {
      background.navigation.onBeforeNavigate(before);
      background.runtime.responseHeaders.onBeforeRequest(request);
      if (ambiguous) background.runtime.responseHeaders.onBeforeRequest({ ...request, requestId: 'overlapping-request' });
      const complete = () => background.network.onResponseCompleted({ ...request, responseHeaders: [{ name: 'Accept-CH', value: 'Sec-CH-UA' }] });
      if (early) complete();
      background.navigation.onCommitted({ ...before, documentId: 'new', frameType: 'outermost_frame', documentLifecycle: 'active' });
      if (!early) complete();
      expect(background.runtime.getProjection(7)?.documentKey).toBe('7:0:new');
      expect(background.runtime.getProjection(7)?.responseHeaders).toEqual(ambiguous ? { entries: [], truncated: true }
        : { entries: [{ name: 'accept-ch', count: 1, clientHints: ['sec-ch-ua'] }], truncated: false });
      expect(background.runtime.state.metas.get('7:0:old')?.responseHeaders).toBeUndefined();
    } finally { background.runtime.stop(); }
  });

  it.each(['all-sites', 'site'] as const)('handles %s headers arriving during hydration with the required startup grants', async scopeMode => {
    const api = createFakeChrome({ grantedOrigins: scopeMode === 'all-sites'
      ? ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] : ['https://example.com/*'] });
    api.local.data.set('scope', { v: 1, scopeMode, hosts: scopeMode === 'site' ? ['example.com'] : [] });
    api.tabList = [{ id: 7 }];
    api.framesByTab.set(7, [{ frameId: 0, documentId: 'document', url: 'https://example.com/', documentLifecycle: 'active' }]);
    const background = createBackground(api, { ttlIntervalMs: 0, persistDebounceMs: 0 });
    const start = background.start();
    await background.runtime.scope.load();
    expect(background.runtime.hydrationComplete).toBe(false);
    background.network.onResponseCompleted({ tabId: 7, frameId: 0, documentId: 'document', url: 'https://example.com/', type: 'main_frame',
      timeStamp: Date.now(), responseHeaders: [{ name: 'NEL', value: 'STARTUP_HEADER_SECRET' }] });
    await start;
    try {
      const headers = background.runtime.getProjection(7)?.responseHeaders;
      if (scopeMode === 'all-sites') expect(headers).toEqual({ entries: [{ name: 'nel', count: 1, clientHints: [] }], truncated: false });
      else expect(headers).toBeUndefined();
      expect(JSON.stringify(background.runtime.buildIndex())).not.toContain('STARTUP_HEADER_SECRET');
    } finally { background.runtime.stop(); }
  });

  it('binds headers to the current browser document and survives broad-access restart without raw values', async () => {
    const api = createFakeChrome({ grantedOrigins: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] });
    api.local.data.set('scope', { v: 1, scopeMode: 'all-sites', hosts: [] });
    api.tabList = [{ id: 7 }];
    api.framesByTab.set(7, [{ frameId: 0, documentId: 'document', url: 'https://example.com/', documentLifecycle: 'active' }]);
    const background = createBackground(api, { ttlIntervalMs: 0, persistDebounceMs: 0 });
    await background.start();
    const listener = createResponseHeadersListener(background.runtime);
    const event = { tabId: 7, frameId: 0, documentId: 'document', url: 'https://example.com/', type: 'main_frame', timeStamp: Date.now(),
      responseHeaders: [{ name: 'Accept-CH', value: 'Sec-CH-UA-Model' }, { name: 'NEL', value: 'HEADER_ENDPOINT_SECRET' }] };
    listener(event);
    expect(background.runtime.getProjection(7)?.responseHeaders?.entries).toHaveLength(2);
    listener({ ...event, documentId: 'replaced' });
    expect(background.runtime.getProjection(7)?.responseHeaders?.entries[0]?.count).toBe(1);
    await background.runtime.repository.run('7:0:document', () => background.runtime.persistNow('7:0:document'));
    expect(JSON.stringify([...api.session.data.values()])).not.toContain('HEADER_ENDPOINT_SECRET');
    background.runtime.stop();
    const restarted = createBackground(api, { ttlIntervalMs: 0, persistDebounceMs: 0 });
    await restarted.start();
    try {
      expect(restarted.runtime.getProjection(7)?.responseHeaders?.entries[0]?.count).toBe(1);
      const current = restarted.runtime.getProjection(7)!;
      expect((await restarted.runtime.clear(7, current.documentKey, current.reportRevision)).type).toBe('ok');
      createResponseHeadersListener(restarted.runtime)({ ...event, responseHeaders: [{ name: 'Critical-CH', value: 'Sec-CH-UA-Platform' }] });
      expect(restarted.runtime.getProjection(7)?.responseHeaders?.entries).toEqual([{ name: 'critical-ch', count: 1, clientHints: ['sec-ch-ua-platform'] }]);
      const beforePause = restarted.runtime.getProjection(7)!;
      await restarted.runtime.pause(7, beforePause.documentKey, beforePause.reportRevision);
      createResponseHeadersListener(restarted.runtime)(event);
      expect(restarted.runtime.getProjection(7)?.responseHeaders?.entries).toHaveLength(1);
    } finally { restarted.runtime.stop(); }
  });

  it('does not restore redacted destination history under narrow grants', async () => {
    const api = createFakeChrome({ grantedOrigins: ['https://example.com/*'] });
    api.local.data.set('scope', { v: 1, scopeMode: 'site', hosts: ['example.com'] });
    api.tabList = [{ id: 7 }];
    api.framesByTab.set(7, [{ frameId: 0, documentId: 'document', url: 'https://example.com/', documentLifecycle: 'active' }]);
    const background = createBackground(api, { ttlIntervalMs: 0, persistDebounceMs: 0 });
    await background.start();
    createResponseHeadersListener(background.runtime)({ tabId: 7, frameId: 0, documentId: 'document', url: 'https://example.com/',
      type: 'main_frame', timeStamp: Date.now(), responseHeaders: [{ name: 'NEL', value: 'PRIVATE_DESTINATION' }] });
    expect(background.runtime.getProjection(7)?.responseHeaders?.entries).toHaveLength(1);
    await background.runtime.repository.run('7:0:document', () => background.runtime.persistNow('7:0:document'));
    background.runtime.stop();
    const restarted = createBackground(api, { ttlIntervalMs: 0, persistDebounceMs: 0 });
    await restarted.start();
    try {
      expect(restarted.runtime.getProjection(7)?.responseHeaders).toBeUndefined();
      expect(restarted.runtime.getProjection(7)?.coverageFlags).toContain('network-limited');
    } finally { restarted.runtime.stop(); }
  });

  it('projects browser header facts without inventing an API phase or allowing page provenance', () => {
    const original: ReportProjection = { reportRevision: 1, documentKey: '7:0:document', host: 'example.com', coverageState: 'active', coverageFlags: [],
      techniques: [], findings: [], vendors: [], dropped: { ...EMPTY_DROPPED }, observedSince: 1000, scopeMode: 'all-sites' };
    const headers = normalizeResponseHeaders([{ name: 'Accept-CH', value: 'Sec-CH-UA-Model' }]);
    const projected = attachResponseHeaders(original, headers);
    expect(verifyProjection(projected)).toEqual([]);
    expect(projected.techniques[0]).toMatchObject({ techniqueId: 'DET-074', phases: [], signalCodes: [], count: 1,
      evidenceSource: 'browser-network', integrity: 'browser-observed', interpretation: 'unknown' });
    expect(original.techniques).toEqual([]);
    expect(createExportPreview(projected, 2000).report.responseHeaders).toEqual(headers);
    expect(verifyProjection({ ...projected, techniques: [{ ...projected.techniques[0], integrity: 'page-controlled' }] })).not.toEqual([]);
    const schema = compileSchema('report-projection.v1.schema.json');
    expect(schema(projected)).toBe(true);
    expect(schema({ ...projected, techniques: [{ ...projected.techniques[0], integrity: 'page-controlled' }] })).toBe(false);
    expect(verifyProjection({ ...projected, techniques: [...projected.techniques, ...projected.techniques] })).not.toEqual([]);
    for (const delta of [{ attributionConfidence: 'exact-resource' }, { firstBucket: 17, lastBucket: 19 }]) {
      const invalid = { ...projected, techniques: [{ ...projected.techniques[0], ...delta }] };
      expect(verifyProjection(invalid)).not.toEqual([]);
      expect(schema(invalid)).toBe(false);
    }
  });

  it('retains only fixed header and client-hint names, never endpoint credentials or session values', () => {
    const input = [{ name: 'Accept-CH', value: 'Sec-CH-UA, Sec-CH-UA-Model, PRIVATE_HINT_CANARY' },
      { name: 'NEL', value: 'PRIVATE_NEL_CANARY' }, { name: 'Report-To', value: 'https://private.invalid/REPORT_CANARY' },
      { name: 'Sec-Session-Registration', value: 'SESSION_CANARY' }, { name: 'Set-Cookie', value: 'COOKIE_CANARY' }];
    const normalized = normalizeResponseHeaders(input);
    expect(normalized).toEqual({ entries: [
      { name: 'accept-ch', count: 1, clientHints: ['sec-ch-ua', 'sec-ch-ua-model'] },
      { name: 'nel', count: 1, clientHints: [] }, { name: 'report-to', count: 1, clientHints: [] },
      { name: 'sec-session-registration', count: 1, clientHints: [] },
    ], truncated: true });
    expect(JSON.stringify(normalized)).not.toMatch(/CANARY|private\.invalid/);
    expect(readResponseHeaders(normalized)).toEqual(normalized);
  });

  it('does not read any non-client-hint header values, including accessors', () => {
    const read = vi.fn(() => { throw new Error('header value read'); });
    const row = Object.defineProperty({ name: 'Reporting-Endpoints' }, 'value', { get: read });
    expect(normalizeResponseHeaders([row])).toEqual({ entries: [{ name: 'reporting-endpoints', count: 1, clientHints: [] }], truncated: false });
    expect(read).not.toHaveBeenCalled();
  });

  it('counts a duplicated header once per completed response and merges bounded counts across responses', () => {
    const once = normalizeResponseHeaders([{ name: 'Accept-CH', value: 'Sec-CH-UA' }, { name: 'accept-ch', value: 'Sec-CH-UA-Platform' }]);
    expect(once.entries).toEqual([{ name: 'accept-ch', count: 1, clientHints: ['sec-ch-ua', 'sec-ch-ua-platform'] }]);
    expect(mergeResponseHeaders(once, once).entries[0]?.count).toBe(2);
    expect(once.entries[0]?.count).toBe(1);
    expect(mergeResponseHeaders(undefined, { entries: [], truncated: true })).toEqual({ entries: [], truncated: true });
  });

  it('rejects forged summary fields, duplicate names, arbitrary hints and accessor values', () => {
    const summary = normalizeResponseHeaders([{ name: 'NEL' }]);
    for (const value of [{ ...summary, url: 'SECRET' }, { entries: [...summary.entries, ...summary.entries], truncated: false },
      { entries: [{ name: 'nel', count: 1, clientHints: ['sec-ch-ua'] }], truncated: false },
      { entries: [{ name: 'accept-ch', count: 1, clientHints: ['private-hint'] }], truncated: false }]) expect(readResponseHeaders(value)).toBeNull();
    const read = vi.fn(() => 1);
    const row = Object.defineProperty({ name: 'nel', clientHints: [] }, 'count', { enumerable: true, get: read });
    expect(readResponseHeaders({ entries: [row], truncated: false })).toBeNull(); expect(read).not.toHaveBeenCalled();
  });

  it('bounds wide header input and oversized hint values with an explicit incomplete marker', () => {
    expect(normalizeResponseHeaders(Array.from({ length: 1000 }, () => ({ name: 'Ignored' })))).toEqual({ entries: [], truncated: true });
    expect(normalizeResponseHeaders([{ name: 'Accept-CH', value: 'x'.repeat(4097) }])).toEqual({ entries: [{ name: 'accept-ch', count: 1, clientHints: [] }], truncated: true });
  });
});