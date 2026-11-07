import { describe, expect, it, vi } from 'vitest';
import { ScopeController } from '../src/scope';
import { createBackground, route } from '../src/index';
import { createFakeChrome } from './fake-chrome';
import { compileSchema } from '../../contracts/test/helpers';
import { DATA_CONSENT_KEY, DATA_CONSENT_PENDING_KEY, DATA_CONSENT_VERSION, readDataConsentRequest, readDataConsentState } from '../../contracts/src/data-consent';

const origins = ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'];
const request = { schemaVersion: 1, type: 'ui-data-consent-set', version: DATA_CONSENT_VERSION, accepted: true };
const setup = () => {
  const api = createFakeChrome({ dataConsent: false, grantedOrigins: origins, hostPermissions: origins });
  const scope = new ScopeController(api, { now: () => Date.now() });
  return { api, scope };
};

describe('ADR-041 affirmative local data consent', () => {
  it('accepts only privileged current-version consent and rejects page/Pro/scope bypasses', async () => {
    const { api } = setup();
    const background = createBackground(api, { ttlIntervalMs: 0, persistDebounceMs: 0 });
    api.session.data.set('old-preview', { value: 'LEGACY_PRIVATE_CANARY' });
    await background.start();
    const sender = { id: api.runtime.id, origin: 'chrome-extension://' + api.runtime.id, url: 'chrome-extension://' + api.runtime.id + '/popup.html' };
    try {
      expect(api.session.data.has('old-preview')).toBe(false);
      background.navigation.onCommitted({ tabId: 1, frameId: 0, documentId: 'document', url: 'https://private.example/', timeStamp: Date.now() });
      expect(background.runtime.state.reports.size).toBe(0);
      const page = { id: api.runtime.id, tab: { id: 1 }, origin: 'https://example.com', frameId: 0, documentId: 'document' };
      expect(await route(background.runtime, request, page)).toMatchObject({ type: 'error', code: 'unauthorized-sender' });
      expect(await route(background.runtime, { ...request, version: 0 }, sender)).toMatchObject({ type: 'error', code: 'invalid-request' });
      expect(await route(background.runtime, { schemaVersion: 1, type: 'ui-pro-start', tabId: 1 }, sender)).toMatchObject({ type: 'error', code: 'no-access' });
      expect(await route(background.runtime, { schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'all-sites' }, sender)).toMatchObject({ type: 'error', code: 'no-access' });
      expect(readDataConsentState(await route(background.runtime, request, sender))?.accepted).toBe(true);
      expect(background.runtime.scope.getScopeMode()).toBe('all-sites');
      expect(readDataConsentState(await route(background.runtime, { ...request, accepted: false }, sender))?.accepted).toBe(false);
      expect(api.registered.size).toBe(0);
    } finally { background.runtime.stop(); }
  });

  it('keeps a new fully permitted install off with no registered sensors', async () => {
    const { api, scope } = setup(); await scope.startup();
    expect(scope.hasDataConsent).toBe(false); expect(scope.getScopeMode()).toBe('off');
    expect(scope.accessReady).toBe(false); expect(scope.hasAnyHostAccess()).toBe(false); expect(api.registered.size).toBe(0);
    expect(await scope.setScope({ schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'all-sites' })).toEqual({ ok: false, code: 'no-access' });
    expect(await scope.injectNow(1, 'example.com', 'document')).toBe(false); expect(api.executeScriptCalls).toEqual([]);
  });

  it('does not treat legacy all-sites prefs or registered scripts as consent', async () => {
    const { api, scope } = setup();
    api.local.data.set('scope', { v: 1, scopeMode: 'all-sites', hosts: [] });
    api.local.data.set('scope:full-access-default-v1', true);
    api.registered.set('detector-main-v1', { id: 'detector-main-v1', matches: ['https://*/*'], js: ['hook.early.js'] });
    await scope.startup();
    expect(scope.inScope('example.com', 1, 'document')).toBe(false); expect(api.registered.size).toBe(0);
    await scope.onPermissionsChanged(); expect(api.registered.size).toBe(0);
  });

  it('registers only after persisted consent and remembers it across SW restart', async () => {
    const { api, scope } = setup(); await scope.startup();
    expect(await scope.setDataConsent(true)).toBe(true);
    expect(api.local.data.get(DATA_CONSENT_KEY)).toEqual({ version: DATA_CONSENT_VERSION, accepted: true });
    expect(scope.getScopeMode()).toBe('all-sites'); expect(api.registered.size).toBe(2);
    const next = new ScopeController(api, { now: () => Date.now() }); await next.startup();
    expect(next.hasDataConsent).toBe(true); expect(next.desiredMatches()).toEqual(['http://*/*', 'https://*/*']);
  });

  it('fails closed when consent cannot be saved', async () => {
    const { api, scope } = setup(); await scope.startup();
    const original = api.local.set.bind(api.local);
    vi.spyOn(api.local, 'set').mockImplementation(async value => { if (DATA_CONSENT_KEY in value) throw new Error('storage refused'); await original(value); });
    expect(await scope.setDataConsent(true)).toBe(false); expect(scope.hasDataConsent).toBe(false); expect(api.registered.size).toBe(0);
  });

  it('does not turn consent into absent Chrome permissions', async () => {
    const api = createFakeChrome({ dataConsent: false });
    const scope = new ScopeController(api, { now: () => Date.now() }); await scope.startup();
    expect(await scope.setDataConsent(true)).toBe(true);
    expect(scope.getScopeMode()).toBe('off'); expect(scope.hasAnyHostAccess()).toBe(false); expect(api.registered.size).toBe(0);
  });

  it('retains a previously selected narrow scope after consent', async () => {
    const { api, scope } = setup();
    api.local.data.set('scope', { v: 1, scopeMode: 'site', hosts: ['example.com'] });
    api.local.data.set('scope:full-access-default-v1', true);
    await scope.startup(); await scope.setDataConsent(true);
    expect(scope.getState()).toMatchObject({ scopeMode: 'site', hosts: ['example.com'] });
  });

  it('decline disables observation and invalidates remembered consent', async () => {
    const { api, scope } = setup(); await scope.startup(); await scope.setDataConsent(true);
    expect(await scope.setDataConsent(false)).toBe(true);
    expect(api.registered.size).toBe(0); expect(scope.hasAnyHostAccess()).toBe(false);
    expect(api.local.data.get(DATA_CONSENT_KEY)).toEqual({ version: DATA_CONSENT_VERSION, accepted: false });
  });

  it('retains an explicit off choice after acceptance', async () => {
    const { api, scope } = setup();
    api.local.data.set('scope', { v: 1, scopeMode: 'off', hosts: [] });
    api.local.data.set('scope:full-access-default-v1', true);
    await scope.startup(); await scope.setDataConsent(true);
    expect(scope.hasDataConsent).toBe(true); expect(scope.getScopeMode()).toBe('off'); expect(api.registered.size).toBe(0);
  });

  it('stops existing collectors and returns terminal ACKs after withdrawal', async () => {
    const { api } = setup(); api.tabList = [{ id: 1 }];
    const background = createBackground(api, { ttlIntervalMs: 0 }); await background.start();
    const sender = { id: api.runtime.id, origin: 'chrome-extension://' + api.runtime.id, url: 'chrome-extension://' + api.runtime.id + '/options.html' };
    try {
      await route(background.runtime, request, sender);
      api.sentToTabs.length = 0;
      await route(background.runtime, { ...request, accepted: false }, sender);
      expect(api.sentToTabs).toContainEqual({ tabId: 1, message: { schemaVersion: 1, type: 'bridge-control', command: 'pause' }, options: undefined });
      const page = { id: api.runtime.id, tab: { id: 1 }, origin: 'https://example.com', frameId: 0, documentId: 'document' };
      expect(await route(background.runtime, { schemaVersion: 1, type: 'sensor-events' }, page)).toMatchObject({ type: 'ack', paused: true, protocolOk: true, stopReason: 'revoked' });
    } finally { background.runtime.stop(); }
  });

  it('serializes withdrawal and acceptance through session cleanup', async () => {
    const { api } = setup();
    const background = createBackground(api, { ttlIntervalMs: 0 }); await background.start();
    const runtime = background.runtime;
    try {
      await runtime.changeDataConsent(true);
      const original = api.session.remove.bind(api.session);
      let release!: () => void;
      vi.spyOn(api.session, 'remove').mockImplementationOnce(keys => new Promise(resolve => { release = () => { void original(keys).then(resolve); }; }));
      const declined = runtime.changeDataConsent(false);
      await vi.waitFor(() => expect(release).toBeTypeOf('function'));
      const accepted = runtime.changeDataConsent(true);
      expect(runtime.scope.hasDataConsent).toBe(false);
      release(); expect(await declined).toBe(true); expect(await accepted).toBe(true);
      expect(runtime.scope.hasDataConsent).toBe(true); expect(api.registered.size).toBe(2);
    } finally { runtime.stop(); }
  });

  it('reports failed session deletion without leaving readable or running data', async () => {
    const { api } = setup();
    const background = createBackground(api, { ttlIntervalMs: 0 }); await background.start();
    try {
      await background.runtime.changeDataConsent(true);
      background.navigation.onCommitted({ tabId: 1, frameId: 0, documentId: 'document', url: 'https://example.com/', timeStamp: Date.now() });
      vi.spyOn(api.session, 'remove').mockRejectedValue(new Error('session unavailable'));
      expect(await background.runtime.changeDataConsent(false)).toBe(false);
      expect(background.runtime.scope.hasDataConsent).toBe(false);
      expect(background.runtime.getProjection(1)).toBeNull(); expect(background.runtime.state.reports.size).toBe(0);
      expect(background.runtime.pro.hasSession()).toBe(false); expect(api.registered.size).toBe(0);
    } finally { background.runtime.stop(); }
  });

  it('never replays response headers received before consent into a later accepted document', async () => {
    const { api } = setup();
    const background = createBackground(api, { ttlIntervalMs: 0 });
    const details = { tabId: 1, frameId: 0, url: 'https://example.com/', timeStamp: Date.now() };
    const browserRequest = { ...details, type: 'main_frame', requestId: 'before-consent' };
    const read = vi.fn(() => [{ name: 'Accept-CH', value: 'Sec-CH-UA-Arch' }]);
    background.navigation.onBeforeNavigate(details);
    background.runtime.responseHeaders.onBeforeRequest(browserRequest);
    background.network.onResponseCompleted({ ...browserRequest, get responseHeaders() { return read(); } });
    await background.start();
    try {
      expect(read).toHaveBeenCalled();
      await background.runtime.changeDataConsent(true);
      background.navigation.onCommitted({ ...details, documentId: 'document', frameType: 'outermost_frame', documentLifecycle: 'active' });
      expect(background.runtime.getProjection(1)?.responseHeaders).toBeUndefined();
      background.network.onResponseCompleted({ ...browserRequest, documentId: 'document', responseHeaders: [{ name: 'Accept-CH', value: 'Sec-CH-UA-Arch' }] });
      expect(background.runtime.getProjection(1)?.responseHeaders?.entries[0]?.clientHints).toEqual(['sec-ch-ua-arch']);
    } finally { background.runtime.stop(); }
  });

  it('does not read network payloads before checking saved consent and exposes an authorized startup gap', async () => {
    const api = createFakeChrome({ grantedOrigins: origins, hostPermissions: origins });
    api.local.data.set('scope', { v: 1, scopeMode: 'all-sites', hosts: [] });
    api.tabList = [{ id: 1 }];
    api.framesByTab.set(1, [{ frameId: 0, documentId: 'document', url: 'https://example.com/', documentLifecycle: 'active' }]);
    const background = createBackground(api, { ttlIntervalMs: 0 });
    const read = vi.fn(() => 'https://private.example/');
    const details = { tabId: 1, frameId: 0, documentId: 'document', type: 'script', timeStamp: Date.now(), get url() { return read(); } };
    background.network.onBeforeRequest(details);
    expect(read).not.toHaveBeenCalled();
    await background.start();
    try { expect(background.runtime.getProjection(1)?.coverageFlags).toContain('network-limited'); }
    finally { background.runtime.stop(); }
  });

  it.each(['local-write', 'session-write'] as const)('an interrupted %s consent transition stays off after restart', async failure => {
    const { api } = setup();
    const background = createBackground(api, { ttlIntervalMs: 0 }); await background.start();
    try {
      await background.runtime.changeDataConsent(true);
      if (failure === 'local-write') vi.spyOn(api.local, 'set').mockRejectedValue(new Error('local unavailable'));
      else vi.spyOn(api.session, 'set').mockImplementation(async value => {
        if ('active-tabs' in value) throw new Error('session unavailable');
        for (const [key, record] of Object.entries(value)) api.session.data.set(key, record);
      });
      expect(await background.runtime.changeDataConsent(failure !== 'local-write')).toBe(false);
      expect(background.runtime.scope.hasDataConsent).toBe(false);
      expect(api.session.data.get(DATA_CONSENT_PENDING_KEY)).toBe(true);
      vi.restoreAllMocks();
      const restarted = new ScopeController(api, { now: () => Date.now() }); await restarted.startup();
      expect(restarted.hasDataConsent).toBe(false); expect(api.registered.size).toBe(0);
    } finally { background.runtime.stop(); }
  });

  it('retains no page payload while saved consent is unknown', async () => {
    const { api } = setup(); const background = createBackground(api, { ttlIntervalMs: 0 });
    const read = vi.fn(() => []);
    const page = { id: api.runtime.id, tab: { id: 1 }, frameId: 0, documentId: 'document', origin: 'https://example.com' };
    expect(await route(background.runtime, { schemaVersion: 1, type: 'sensor-events', get observations() { return read(); } }, page))
      .toMatchObject({ type: 'error', code: 'no-access' });
    expect(read).not.toHaveBeenCalled(); expect(background.runtime.diagnostics().pendingPageBatches).toBe(0);
    await background.start(); background.runtime.stop();
  });

  it.each(['visual-frame', 'rtc-snapshot'])('does not inspect or retain %s before saved consent is known', async type => {
    const { api } = setup(); const background = createBackground(api, { ttlIntervalMs: 0 });
    const read = vi.fn(() => { throw new Error('private payload read'); });
    const page = { id: api.runtime.id, tab: { id: 1 }, frameId: 0, documentId: 'document', origin: 'https://example.com' };
    expect(await route(background.runtime, { schemaVersion: 1, type, get image() { return read(); }, get snapshot() { return read(); } }, page))
      .toMatchObject({ type: 'error', code: 'no-access' });
    expect(read).not.toHaveBeenCalled(); expect(background.runtime.diagnostics().pendingPageBatches).toBe(0);
    await background.start(); background.runtime.stop();
  });

  it('removes persisted registrations when startup preference reads fail', async () => {
    const { api, scope } = setup();
    api.registered.set('detector-main-v1', { id: 'detector-main-v1', matches: ['https://*/*'], js: ['hook.early.js'] });
    vi.spyOn(api.local, 'get').mockRejectedValue(new Error('unavailable'));
    await expect(scope.startup()).rejects.toThrow('unavailable');
    expect(scope.hasDataConsent).toBe(false); expect(api.registered.size).toBe(0);
  });

  it('rejects an old permission result after consent is suspended', async () => {
    const { api, scope } = setup(); await scope.startup(); await scope.setDataConsent(true);
    let finish!: (granted: boolean) => void;
    vi.spyOn(api.permissions, 'contains').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = scope.isGranted('https://example.com/*', 1, 'document');
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    scope.suspendDataConsent(); finish(true);
    expect(await pending).toBe(false);
  });

  it('refuses stale versions, extra fields and hostile getters without coercion', () => {
    expect(readDataConsentRequest(request)).toEqual(request);
    for (const value of [{ ...request, version: 0 }, { ...request, accepted: 'true' }, { ...request, tabId: 1 },
      { ...request, get accepted() { throw new Error('getter invoked'); } }]) expect(readDataConsentRequest(value)).toBeNull();
    expect(readDataConsentState({ ...request, type: 'data-consent-state' })?.accepted).toBe(true);
    expect(readDataConsentState({ ...request, type: 'data-consent-state', version: 0 })).toBeNull();
  });

  it('matches the separate schema for consent messages without extending PageBatch', () => {
    const schema = compileSchema('data-consent.v1.schema.json');
    for (const value of [request, { ...request, accepted: false }, { ...request, type: 'data-consent-state' },
      { schemaVersion: 1, type: 'ui-data-consent-get' }, { ...request, version: 0 }, { ...request, accepted: 1 }, { ...request, tabId: 1 }]) {
      expect(schema(value)).toBe(readDataConsentRequest(value) !== null || readDataConsentState(value) !== null);
    }
  });

  it.each([true, false])('redacted cold-start resource quarantine requires previously saved consent: %s', async accepted => {
    const api = createFakeChrome({ dataConsent: accepted, grantedOrigins: origins, hostPermissions: origins });
    api.local.data.set('scope', { v: 1, scopeMode: 'all-sites', hosts: [] });
    api.tabList = [{ id: 1 }];
    api.framesByTab.set(1, [{ frameId: 0, documentId: 'document', url: 'https://example.com/', documentLifecycle: 'active' }]);
    const background = createBackground(api, { ttlIntervalMs: 0, clock: { now: () => Date.parse('2026-09-16T00:00:00Z') } });
    const dispatch = vi.spyOn(background.runtime, 'dispatch');
    background.network.onCompleted({ tabId: 1, frameId: 0, documentId: 'document', url: 'https://challenges.cloudflare.com/turnstile/v0/api.js?CANARY_STARTUP_SECRET',
      type: 'script', initiator: 'https://example.com/', statusCode: 200, timeStamp: Date.now() });
    expect(JSON.stringify(dispatch.mock.calls)).not.toContain('CANARY_STARTUP_SECRET');
    expect(background.runtime.state.reports.size).toBe(0);
    await background.start();
    try {
      if (accepted) expect(background.runtime.getProjection(1)?.vendors.map(row => row.vendorId)).toContain('cloudflare-turnstile');
      else {
        expect(background.runtime.getProjection(1)).toBeNull();
        await background.runtime.changeDataConsent(true);
        expect(background.runtime.getProjection(1)?.vendors ?? []).toEqual([]);
      }
    } finally { background.runtime.stop(); }
  });
});