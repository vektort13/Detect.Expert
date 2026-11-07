import type { ProtectProjection, ProtectState, UiResponse } from '@detect-expert/contracts';
import { describe, expect, it } from 'vitest';
import type { PageSenderContext } from '../../src/sender';
import { RUNTIME_ID, committed } from '../fake-chrome';
import { ALL_SITES, DNR_PERMISSION, ENABLED_SETTINGS, optionsSender, popupSender, recordingService, settleProtect, setupController } from './support';
import type { ControllerSetup } from './support';

const DOC = 'DOC000000000000000000000000000001';

function pageCtx(over: Partial<PageSenderContext> = {}): PageSenderContext {
  return { tabId: 7, frameId: 0, documentId: DOC, documentKey: '7:0:' + DOC, host: 'www.shop-site.com', originPattern: 'https://www.shop-site.com/*', documentLifecycle: 'active', frameType: null, ...over };
}

const INACTIVE = { schemaVersion: 1, type: 'protect-ack', active: false, groups: 0 };

/** Distinct document per (tab, frame) of the throttle tests. */
function frameDoc(tabId: number, frameId: number): string {
  return DOC.slice(0, -4) + String(1000 + tabId * 100 + frameId);
}

function frameCtx(tabId: number, frameId: number, host: string): PageSenderContext {
  const documentId = frameDoc(tabId, frameId);
  return pageCtx({ tabId, frameId, documentId, documentKey: String(tabId) + ':' + String(frameId) + ':' + documentId, host, originPattern: 'https://' + host + '/*' });
}

function state(r: UiResponse): ProtectState {
  if (r.type !== 'protect-state') throw new Error('not a state: ' + JSON.stringify(r));
  return r.state;
}

async function enable(s: ControllerSetup, features: string[] = ['value-match', 'firewall', 'session-replay'], sender = optionsSender()): Promise<UiResponse> {
  return s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-enable', consentVersion: 1, features: features as never, preset: 'normal' }, sender);
}

function idx(log: string[], prefix: string): number {
  const i = log.findIndex((l) => l.startsWith(prefix));
  if (i < 0) throw new Error('missing ' + prefix + ' in ' + log.join(' | '));
  return i;
}

const GRANTED = { grantedOrigins: ALL_SITES, permissions: [DNR_PERMISSION] };

describe('module off (ADR-020 §10 invariant, unit)', () => {
  it('never enabled: no body/header/error listeners, no IndexedDB, no registrations, no DNR access, no protect keys', async () => {
    const s = await setupController({ chrome: GRANTED });
    s.controller.onCommitted(committed({ url: 'https://www.shop-site.com/' }));
    s.controller.onTabRemoved(7);
    expect(await s.controller.onPageMessage(pageCtx(), { schemaVersion: 1, type: 'protect-hello', startedLate: false })).toEqual({ schemaVersion: 1, type: 'protect-ack', active: false, groups: 0 });
    expect(s.controller.getReport(7)).toBeNull();
    expect(s.controller.pendingCount(7)).toBe(0);
    await s.controller.clearSession();
    const st = state(await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-get-state' }, optionsSender()));
    expect(st.state).toBe('off');
    await settleProtect(10);
    expect(s.dbCreated()).toBe(0);
    expect(s.db.opens).toBe(0);
    for (const ev of Object.values(s.fake.webRequestEvents)) expect(ev.added).toHaveLength(0);
    expect([...s.fake.registered.keys()].filter((id) => id.startsWith('detector-protect'))).toEqual([]);
    expect(s.fake.dnrAccesses).toBe(0);
    expect(s.fake.dnr.calls).toEqual([]);
    expect(s.fake.local.data.has('protect')).toBe(false);
    expect(s.fake.local.setCalls).toEqual([]);
    expect([...s.fake.session.data.keys()].filter((k) => k.startsWith('protect'))).toEqual([]);
    expect(s.fake.session.setCalls).toEqual([]);
    expect(s.fake.sentToTabs).toEqual([]);
    expect(s.log).toEqual([]);
    expect(s.controller.listeners()).toEqual({ beforeRequestTabs: [], sendHeaders: false, requestHeaders: false, errorOccurred: false, completed: false });
  });

  it('stored but disabled: only an orphan check of our registrations (observation ids untouched)', async () => {
    const s = await setupController({ chrome: GRANTED, settings: { ...ENABLED_SETTINGS, enabled: false }, load: false });
    s.fake.registered.set('detector-isolated-v1', { id: 'detector-isolated-v1', js: ['bridge.js'] });
    s.fake.registered.set('detector-protect-isolated-v1', { id: 'detector-protect-isolated-v1', js: ['protect.js'] });
    await s.controller.load();
    expect([...s.fake.registered.keys()]).toEqual(['detector-isolated-v1']);
    expect(s.dbCreated()).toBe(0);
    expect(s.fake.dnrAccesses).toBe(0);
    for (const ev of Object.values(s.fake.webRequestEvents)) expect(ev.added).toHaveLength(0);
    expect(s.fake.local.setCalls).toEqual([]);
  });

  it('review W5: no settings record (after a purge) — orphan registrations of ours still go at the next start', async () => {
    const s = await setupController({ chrome: GRANTED, load: false });
    s.fake.registered.set('detector-isolated-v1', { id: 'detector-isolated-v1', js: ['bridge.js'] });
    s.fake.registered.set('detector-protect-main-v1', { id: 'detector-protect-main-v1', js: ['protect.main.js'] });
    await s.controller.load();
    expect([...s.fake.registered.keys()]).toEqual(['detector-isolated-v1']);
    expect(s.dbCreated()).toBe(0);
    expect(s.fake.dnrAccesses).toBe(0);
    expect(s.fake.local.setCalls).toEqual([]);
  });

  it('a broken settings record is fail-closed (off, nothing started)', async () => {
    const s = await setupController({ chrome: GRANTED, settings: { ...ENABLED_SETTINGS, features: ['keylogger'] } });
    expect(s.controller.getState().state).toBe('off');
    expect(s.dbCreated()).toBe(0);
    for (const ev of Object.values(s.fake.webRequestEvents)) expect(ev.added).toHaveLength(0);
  });
});

describe('enable (Options only) — order of steps', () => {
  it('persist → IndexedDB → registrations → listeners → lanes → DNR reconcile → protect-state', async () => {
    const s = await setupController({ chrome: GRANTED });
    // An orphan rule in the gpc range (gpc is off) is removed by the reconcile step.
    s.fake.dnr.dynamic.set(5, { id: 5, priority: 100, action: { type: 'modifyHeaders' }, condition: {} });
    const r = await enable(s);
    const st = state(r);
    expect(st.state).toBe('active');
    expect(st.features).toEqual(['value-match', 'firewall', 'session-replay']);
    const order = ['local.set:protect', 'db.create', 'scripting.register', 'webRequest.add:sendHeaders', 'service.start:value-match', 'service.start:requests', 'dnr.updateDynamic'].map((p) => idx(s.log, p));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(s.fake.dnr.dynamic.has(5)).toBe(false);
    expect(s.fake.local.data.get('protect')).toEqual({ ...ENABLED_SETTINGS });
    expect(s.db.opens).toBe(1);
    expect([...s.fake.registered.keys()].sort()).toEqual(['detector-protect-isolated-v1', 'detector-protect-main-v1']);
    expect(s.fake.registered.get('detector-protect-main-v1')?.js).toEqual(['protect-policy.js', 'protect-on.send.js', 'protect-on.listen.js', 'protect.main.js']);
    // Shared listeners: no body listener without an armed tab; headers only with gpc.
    expect(s.fake.webRequestEvents.beforeRequest.added).toHaveLength(0);
    expect(s.fake.webRequestEvents.sendHeaders.added[0]?.extra).toEqual([]);
    expect(s.services.filter((x) => x.starts === 1).map((x) => x.name)).toEqual(['value-match', 'firewall', 'attribution', 'replay', 'requests']);
  });

  it('refuses from the popup, without consent, without permissions, under the organization policy', async () => {
    const s = await setupController({ chrome: { grantedOrigins: [] } });
    expect(await enable(s, ['value-match'], popupSender())).toEqual({ schemaVersion: 1, type: 'error', code: 'unauthorized-sender' });
    expect(await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-enable', consentVersion: 2, features: ['value-match'], preset: 'normal' }, optionsSender())).toMatchObject({ code: 'consent-required' });
    expect(await enable(s, ['value-match'])).toMatchObject({ code: 'permission-required' });
    s.fake.grantedOrigins.add('http://*/*');
    s.fake.grantedOrigins.add('https://*/*');
    expect(await enable(s, ['firewall'])).toMatchObject({ code: 'permission-required' });
    s.fake.managed.data.set('ProtectModuleDisabled', true);
    expect(await enable(s, ['value-match'])).toMatchObject({ code: 'disabled-by-organization' });
    expect(s.fake.local.data.has('protect')).toBe(false);
    expect(s.dbCreated()).toBe(0);
    s.fake.managed.data.delete('ProtectModuleDisabled');
    expect(state(await enable(s, ['value-match'])).state).toBe('active');
  });

  it('set-settings and set-site(excluded:false) are Options-only; excluding from the popup is allowed', async () => {
    const s = await setupController({ chrome: GRANTED });
    await enable(s);
    expect(await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-set-settings', preset: 'strict' }, popupSender())).toMatchObject({ code: 'unauthorized-sender' });
    expect(await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-set-site', host: 'www.bank-site.com', excluded: false }, popupSender())).toMatchObject({ code: 'unauthorized-sender' });
    const excluded = state(await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-set-site', host: 'www.bank-site.com', excluded: true }, popupSender()));
    expect(excluded.excludedSites).toEqual(['bank-site.com']);
    expect(s.fake.registered.get('detector-protect-isolated-v1')?.excludeMatches).toEqual(['*://bank-site.com/*', '*://*.bank-site.com/*']);
    const back = state(await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-set-site', host: 'bank-site.com', excluded: false }, optionsSender()));
    expect(back.excludedSites).toEqual([]);
    expect(s.fake.registered.get('detector-protect-isolated-v1')?.excludeMatches).toEqual([]);
    expect(state(await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-set-settings', preset: 'warn-only' }, optionsSender())).preset).toBe('warn-only');
  });

  it('rollback on a failing step 7–9: degraded, nothing left running, one attempt per trigger', async () => {
    const s = await setupController({
      chrome: GRANTED,
      services: (log) => [recordingService('value-match', ['value-match'], log, { failStart: true }), recordingService('requests', 'module', log)],
    });
    const st = state(await enable(s, ['value-match']));
    expect(st.state).toBe('degraded');
    expect(st.degradedReasons).toEqual(['outcome-not-observed']);
    expect(s.controller.isActive).toBe(false);
    expect([...s.fake.registered.keys()].filter((id) => id.startsWith('detector-protect'))).toEqual([]);
    expect(s.fake.webRequestEvents.sendHeaders.listeners).toHaveLength(0);
    const startsBefore = s.log.filter((l) => l === 'service.start:value-match').length;
    await s.controller.onPermissionsAdded({ origins: ALL_SITES });
    expect(s.log.filter((l) => l === 'service.start:value-match').length).toBe(startsBefore + 1);
    expect(await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-list-rules', offset: 0, limit: 10 }, optionsSender())).toMatchObject({ code: 'module-disabled' });
  });
});

describe('disable and suspension', () => {
  async function active(): Promise<ControllerSetup> {
    const s = await setupController({ chrome: GRANTED });
    await enable(s);
    s.controller.onCommitted(committed({ url: 'https://www.shop-site.com/' }));
    expect((await s.controller.onPageMessage(pageCtx(), { schemaVersion: 1, type: 'protect-hello', startedLate: true })).active).toBe(true);
    s.fake.dnr.dynamic.set(100003, { id: 100003, priority: 10, action: { type: 'block' }, condition: { requestDomains: ['collect.example'] } });
    s.fake.dnr.session.set(200001, { id: 200001, priority: 50, action: { type: 'block' }, condition: { requestDomains: ['collect.example'], tabIds: [7] } });
    s.fake.dnr.dynamic.set(50000, { id: 50000, priority: 1, action: { type: 'block' }, condition: {} }); // not ours: kept
    s.log.length = 0;
    return s;
  }

  it('disable: lanes → listeners → our DNR rules → our registrations → protect-control stop → persist enabled:false', async () => {
    const s = await active();
    const st = state(await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-disable', purge: false }, popupSender()));
    expect(st.state).toBe('off');
    const order = ['service.stop:value-match:module-off', 'webRequest.remove:sendHeaders', 'dnr.updateDynamic', 'scripting.unregister', 'tabs.send:protect-control:stop', 'local.set:protect'].map((p) => idx(s.log, p));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect([...s.fake.dnr.dynamic.keys()]).toEqual([50000]);
    expect(s.fake.dnr.session.size).toBe(0);
    expect([...s.fake.registered.keys()]).toEqual([]);
    expect(s.fake.local.data.get('protect')).toMatchObject({ enabled: false, features: ['value-match', 'firewall', 'session-replay'] });
    expect([...s.fake.session.data.keys()].filter((k) => k.startsWith('protect'))).toEqual([]);
    expect(s.db.created).toBe(true); // data kept until purge
    for (const ev of Object.values(s.fake.webRequestEvents)) expect(ev.listeners).toHaveLength(0);
  });

  it('disable with purge: IndexedDB deleted, protect-* session keys and the settings key removed', async () => {
    const s = await active();
    await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-disable', purge: true }, popupSender());
    expect(s.db.destroyed).toBe(1);
    expect(s.fake.local.data.has('protect')).toBe(false);
    expect([...s.fake.session.data.keys()].filter((k) => k.startsWith('protect'))).toEqual([]);
    expect(s.controller.getState()).toMatchObject({ state: 'off', features: [], excludedSites: [], decisions: 0 });
  });

  it('broad hosts revoked → needs-permission (settings kept); granted again → resumes and re-adds listeners (SP-11)', async () => {
    const s = await active();
    s.fake.grantedOrigins.clear();
    await s.controller.onPermissionsRemoved({ origins: ALL_SITES });
    expect(s.controller.getState().state).toBe('needs-permission');
    expect(s.controller.isActive).toBe(false);
    expect(s.fake.local.data.get('protect')).toMatchObject({ enabled: true });
    expect([...s.fake.registered.keys()]).toEqual([]);
    expect(await s.controller.onPageMessage(pageCtx(), { schemaVersion: 1, type: 'protect-hello', startedLate: false })).toMatchObject({ active: false });
    for (const o of ALL_SITES) s.fake.grantedOrigins.add(o);
    const addsBefore = s.fake.webRequestEvents.sendHeaders.added.length;
    await s.controller.onPermissionsAdded({ origins: ALL_SITES });
    expect(s.controller.getState().state).toBe('active');
    expect(s.fake.webRequestEvents.sendHeaders.added.length).toBeGreaterThan(addsBefore + 1); // refresh + reregister
    expect(s.fake.webRequestEvents.sendHeaders.listeners).toHaveLength(1);
  });

  it('DNR removed while firewall is on → needs-permission; our rules cannot be read (SP-5) → cleanup-pending kept', async () => {
    const s = await active();
    s.fake.revokePermission(DNR_PERMISSION);
    await s.controller.onPermissionsRemoved({ permissions: [DNR_PERMISSION] });
    expect(s.controller.getState().state).toBe('needs-permission');
    expect(s.fake.dnr.dynamic.has(100003)).toBe(true);
  });

  it('organization policy on the fly: organization-disabled, stopped, data kept; invalid value is fail-closed', async () => {
    const s = await active();
    s.fake.managed.data.set('ProtectModuleDisabled', 'yes');
    await s.controller.onManagedChanged();
    expect(s.controller.getState()).toMatchObject({ state: 'organization-disabled', organizationDisabled: true, organizationPolicyInvalid: true });
    expect(s.controller.isActive).toBe(false);
    expect(s.db.destroyed).toBe(0);
    s.fake.managed.data.set('ProtectModuleDisabled', false);
    await s.controller.onManagedChanged();
    expect(s.controller.getState().state).toBe('active');
  });

  it('a new consent version → needs-consent at load; nothing runs', async () => {
    const s = await setupController({ chrome: GRANTED, settings: { ...ENABLED_SETTINGS, consentVersion: 0 } });
    expect(s.controller.getState().state).toBe('needs-consent');
    expect(s.controller.isActive).toBe(false);
    expect(s.services.every((x) => x.starts === 0)).toBe(true);
  });

  it('a hanging DNR write (SP-1) times out: enforcement degraded, the mutation chain is not blocked', async () => {
    const s = await setupController({ chrome: GRANTED });
    s.fake.dnr.dynamic.set(7, { id: 7, priority: 100, action: { type: 'modifyHeaders' }, condition: {} });
    s.fake.dnr.hangWrites = true;
    const st = state(await enable(s));
    expect(st.state).toBe('degraded');
    expect(st.degradedReasons).toEqual(['blocking-unavailable']);
    expect(s.controller.getReport(7)).toBeNull(); // unknown tab
    s.controller.onCommitted(committed({ url: 'https://www.shop-site.com/' }));
    expect(s.controller.getReport(7)?.firewall).toMatchObject({ enforcement: 'degraded', degradedCode: 'api-unavailable' });
    expect(state(await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-get-state' }, optionsSender())).features).toHaveLength(3);
  });
});

describe('page channel and projection', () => {
  async function active(features = ['value-match', 'session-replay']): Promise<ControllerSetup> {
    const s = await setupController({ chrome: { grantedOrigins: ALL_SITES } });
    await enable(s, features);
    return s;
  }

  it('active ack carries the group mask; invalid messages and excluded sites get active:false', async () => {
    const s = await active();
    expect(await s.controller.onPageMessage(pageCtx(), { schemaVersion: 1, type: 'protect-hello', startedLate: false })).toEqual({ schemaVersion: 1, type: 'protect-ack', active: true, groups: 3 });
    expect(await s.controller.onPageMessage(pageCtx(), { schemaVersion: 1, type: 'protect-hello', startedLate: false, tabId: 9 })).toMatchObject({ active: false });
    await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-set-site', host: 'shop-site.com', excluded: true }, optionsSender());
    expect(await s.controller.onPageMessage(pageCtx(), { schemaVersion: 1, type: 'protect-arm', fieldKind: 'email' })).toMatchObject({ active: false });
    expect(s.fake.sentToTabs.some((m) => (m.message as { command?: string }).command === 'stop')).toBe(true);
  });

  it('page messages are rate limited per document (8/s): excess is dropped and counted', async () => {
    const s = await active();
    s.controller.onCommitted(committed({ url: 'https://www.shop-site.com/' }));
    for (let i = 0; i < 12; i++) await s.controller.onPageMessage(pageCtx(), { schemaVersion: 1, type: 'protect-arm', fieldKind: 'email' });
    expect(s.controller.diagnostics()['throttled']).toBe(4);
    expect(s.controller.getReport(7)?.dropped.events).toBe(4);
  });

  it('throttle never bypasses exclusions: every hello on an excluded tab site gets active:false beyond the budgets', async () => {
    const s = await active();
    for (const tabId of [7, 8, 9, 10]) s.controller.onCommitted(committed({ tabId, url: 'https://www.shop-site.com/', documentId: frameDoc(tabId, 0) }));
    await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-set-site', host: 'shop-site.com', excluded: true }, optionsSender());
    const hello = { schemaVersion: 1, type: 'protect-hello', startedLate: false };
    // One tab, more hellos than the per-tab budget (32/s): frames of the site and third-party frames on it.
    const tab: unknown[] = [];
    for (let i = 0; i < 40; i++) tab.push(await s.controller.onPageMessage(frameCtx(7, i, i % 2 === 0 ? 'www.shop-site.com' : 'cdn.widget-host.net'), hello));
    expect(tab).toEqual(Array.from({ length: 40 }, () => INACTIVE));
    // Several tabs, more hellos than the global budget (100/s).
    const global: unknown[] = [];
    for (const tabId of [8, 9, 10]) for (let i = 0; i < 30; i++) global.push(await s.controller.onPageMessage(frameCtx(tabId, i, 'cdn.widget-host.net'), hello));
    expect(global).toEqual(Array.from({ length: 90 }, () => INACTIVE));
    expect(s.controller.diagnostics()).toMatchObject({ helloDocs: 0, throttled: 0 });
  });

  it('throttle on a granted, non-excluded site: no first activation beyond the budget; active documents keep running', async () => {
    const s = await active();
    s.controller.onCommitted(committed({ url: 'https://www.shop-site.com/' }));
    const hello = { schemaVersion: 1, type: 'protect-hello', startedLate: false };
    const acks: boolean[] = [];
    for (let i = 0; i < 40; i++) acks.push((await s.controller.onPageMessage(frameCtx(7, i, 'www.shop-site.com'), hello)).active);
    expect(acks.slice(0, 32).every((a) => a)).toBe(true);
    expect(acks.slice(32)).toEqual(Array.from({ length: 8 }, () => false));
    expect(s.controller.diagnostics()).toMatchObject({ helloDocs: 32, throttled: 8 });
    expect(s.controller.getReport(7)?.dropped.events).toBe(8);
    // Documents already active stay active while throttled (no salt in a throttled answer).
    const throttledActive = { schemaVersion: 1, type: 'protect-ack', active: true, groups: 3 };
    expect(await s.controller.onPageMessage(frameCtx(7, 0, 'www.shop-site.com'), hello)).toEqual(throttledActive);
    expect(await s.controller.onPageMessage(frameCtx(7, 1, 'www.shop-site.com'), { schemaVersion: 1, type: 'protect-arm', fieldKind: 'email' })).toEqual(throttledActive);
    expect(s.controller.diagnostics()).toMatchObject({ helloDocs: 32, throttled: 10 });
    // The budget refills: a new document of the tab starts again.
    s.clock.t += 1000;
    expect((await s.controller.onPageMessage(frameCtx(7, 40, 'www.shop-site.com'), hello)).active).toBe(true);
  });

  it('projection: late-start for documents committed before the module, active after; snooze hides prompts only', async () => {
    const s = await active();
    s.controller.onCommitted(committed({ url: 'https://www.shop-site.com/' }));
    const first = s.controller.getReport(7) as ProtectProjection;
    expect(first).toMatchObject({ site: 'shop-site.com', moduleState: 'active', coverageState: 'active', evidence: [], firewall: { enforcement: 'off' } });
    expect(first.firewall.stoppedToday).toEqual({ count: 0, countQuality: 'lower-bound' });
    s.clock.t += 10;
    await s.controller.onPageMessage(pageCtx(), { schemaVersion: 1, type: 'protect-hello', startedLate: true });
    expect(s.controller.getReport(7)).toMatchObject({ coverageState: 'late-start', limitations: ['late-start'] });
    // A tab whose document the module never saw commit: loaded before enable.
    const s2 = await setupController({ chrome: { grantedOrigins: ALL_SITES } });
    s2.controller.onCommitted(committed({ url: 'https://www.shop-site.com/' })); // ignored: module off
    await enable(s2, ['value-match']);
    expect(s2.controller.getReport(7)).toBeNull();
  });

  it('lane routes: feature off → feature-disabled; stub lane → not-implemented', async () => {
    const s = await active(['value-match']);
    expect(await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-list-rules', offset: 0, limit: 10 }, optionsSender())).toMatchObject({ code: 'feature-disabled' });
    expect(await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-requests-get', view: 'summary' }, optionsSender())).toMatchObject({ code: 'not-implemented' });
  });

  it('snooze ≤ now + 1 h; purge history clears only history stores', async () => {
    const s = await active(['value-match', 'history']);
    const st = state(await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-snooze', minutes: 60 }, popupSender()));
    expect(st.snoozedUntil).toBe(s.clock.t + 3_600_000);
    await s.db.put('sightings', { receiver: 'collect.example', site: 'shop-site.com', lastDay: 1 });
    await s.db.put('decisions', { decisionKey: 'site:shop-site.com>collect.example', site: 'shop-site.com', receiver: 'collect.example', slot: 0 });
    await s.db.put('meta', { key: 'history-state', revision: 1 });
    await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-purge', what: 'history' }, popupSender());
    expect(await s.db.count('sightings')).toBe(0);
    expect(await s.db.count('meta')).toBe(0);
    expect(await s.db.count('decisions')).toBe(1);
  });

  it('S15: purge of a stopped module when indexedDB.databases() is missing never creates the database', async () => {
    const s = await setupController({ chrome: GRANTED, settings: { ...ENABLED_SETTINGS, enabled: false } });
    s.db.exists = async () => null; // the browser cannot tell whether the database exists
    for (const what of ['history', 'decisions', 'requests'] as const) {
      expect(state(await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-purge', what }, optionsSender())).state).toBe('off');
    }
    expect(s.db.opens).toBe(0);
    expect(s.db.created).toBe(false);
  });

  it('the test harness hooks are refused outside the test profile', async () => {
    const s = await active();
    await expect(s.controller.setManagedOverrideForTest({ ProtectModuleDisabled: true })).rejects.toThrow('protect-managed-override-disabled');
    await expect(s.controller.inject('value-match', {})).rejects.toThrow('protect-inject-disabled');
    expect(RUNTIME_ID.length).toBe(32);
  });
});

describe('site exclusion: the tab top-level site from browser-trusted sources (review r2)', () => {
  const hello = { schemaVersion: 1, type: 'protect-hello', startedLate: false };
  const BANK_TOP = { host: 'www.bank-site.com', scheme: 'https' as const };
  const SHOP_TOP = { host: 'www.shop-site.com', scheme: 'https' as const };
  const WIDGET = 'chat.widget-host.net';

  async function activeSetup(excludeBank: boolean): Promise<ControllerSetup> {
    const s = await setupController({ chrome: { grantedOrigins: ALL_SITES } });
    await enable(s, ['value-match', 'session-replay']);
    if (excludeBank) await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-set-site', host: 'bank-site.com', excluded: true }, optionsSender());
    return s;
  }

  function commitOthers(s: ControllerSetup, count: number): void {
    for (let t = 100; t < 100 + count; t++) s.controller.onCommitted(committed({ tabId: t, url: 'https://www.other' + String(t) + '-site.com/', documentId: frameDoc(t, 0) }));
  }

  it('a cross-site frame in a tab loaded before enable: the tab URL decides; no top site at all → fail closed', async () => {
    const s = await activeSetup(true);
    // Tab 7: top document of the excluded site committed before enable (the tab model does not know the tab).
    expect(await s.controller.onPageMessage(frameCtx(7, 3, WIDGET), hello, BANK_TOP)).toEqual(INACTIVE);
    expect(s.controller.tabModel.get(7)).toMatchObject({ site: 'bank-site.com', topDocumentId: null, committedAt: 0 });
    // Tab 8: unknown to the model and no tab URL from the browser.
    expect(await s.controller.onPageMessage(frameCtx(8, 3, WIDGET), hello)).toEqual(INACTIVE);
    expect(s.controller.tabModel.get(8)).toBeUndefined();
    // Tab 9: loaded before enable on a site that is not excluded: its frames still start.
    expect((await s.controller.onPageMessage(frameCtx(9, 3, WIDGET), hello, SHOP_TOP)).active).toBe(true);
    expect(s.controller.tabModel.get(9)).toMatchObject({ site: 'shop-site.com', topDocumentId: null, committedAt: 0 });
    expect(s.controller.getReport(9)).toBeNull();
    // Top frames of tabs loaded before enable: their own site (and the tab URL) decide.
    expect(await s.controller.onPageMessage(frameCtx(10, 0, 'www.bank-site.com'), hello, BANK_TOP)).toEqual(INACTIVE);
    expect((await s.controller.onPageMessage(frameCtx(11, 0, 'www.shop-site.com'), hello, SHOP_TOP)).active).toBe(true);
    expect(s.controller.diagnostics()['helloDocs']).toBe(2);
  });

  it('a stale tab model never admits a frame of an excluded tab URL; a prerendered document is fail closed', async () => {
    const s = await activeSetup(true);
    s.controller.onCommitted(committed({ tabId: 7, url: 'https://www.shop-site.com/', documentId: frameDoc(7, 0) }));
    // The tab already shows the excluded site (onCommitted not processed yet): the tab URL wins.
    expect(await s.controller.onPageMessage(frameCtx(7, 3, WIDGET), hello, BANK_TOP)).toEqual(INACTIVE);
    // Prerendered documents: the tab URL belongs to the page the tab shows; frameId ≠ 0 (top or not) → inactive.
    const pre = (frameId: number, host: string): PageSenderContext => ({ ...frameCtx(12, frameId, host), documentLifecycle: 'prerender' });
    expect(await s.controller.onPageMessage(pre(5, WIDGET), hello, SHOP_TOP)).toEqual(INACTIVE);
    expect(await s.controller.onPageMessage(pre(6, 'www.shop-site.com'), hello, SHOP_TOP)).toEqual(INACTIVE);
    expect(s.controller.tabModel.get(12)).toBeUndefined();
  });

  it('LRU: a tab of an excluded site stays in the tab model; its frames stay inactive without a tab URL', async () => {
    const s = await activeSetup(true);
    s.controller.onCommitted(committed({ tabId: 8, url: 'https://www.bank-site.com/login', documentId: frameDoc(8, 0) }));
    commitOthers(s, 70);
    expect(s.controller.tabModel.size).toBe(64);
    expect(s.controller.tabModel.get(8)?.site).toBe('bank-site.com');
    expect(s.controller.tabModel.get(100)).toBeUndefined();
    s.clock.t += 5000;
    expect(await s.controller.onPageMessage(frameCtx(8, 4, WIDGET), hello)).toEqual(INACTIVE);
    expect(await s.controller.onPageMessage(frameCtx(8, 4, WIDGET), hello, BANK_TOP)).toEqual(INACTIVE);
    // An evicted tab of a site that is not excluded: unknown again → fail closed without a tab URL, active with it.
    expect(await s.controller.onPageMessage(frameCtx(100, 4, WIDGET), hello)).toEqual(INACTIVE);
    expect((await s.controller.onPageMessage(frameCtx(100, 4, WIDGET), hello, { host: 'www.other100-site.com', scheme: 'https' })).active).toBe(true);
  });

  it('excluding a site stops frames that started in its tabs, also when the tab model no longer knows the tab', async () => {
    const s = await activeSetup(false);
    // Tab 7 loaded before enable: its cross-site frame starts (bank-site.com is not excluded yet).
    expect((await s.controller.onPageMessage(frameCtx(7, 3, WIDGET), hello, BANK_TOP)).active).toBe(true);
    commitOthers(s, 70); // evicts tab 7 (not kept: not excluded yet)
    expect(s.controller.tabModel.get(7)).toBeUndefined();
    s.fake.sentToTabs.length = 0;
    await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-set-site', host: 'bank-site.com', excluded: true }, optionsSender());
    expect(s.fake.sentToTabs.map((m) => ({ tabId: m.tabId, command: (m.message as { command?: string }).command, options: m.options }))).toEqual([
      { tabId: 7, command: 'stop', options: { frameId: 3, documentId: frameDoc(7, 3) } },
    ]);
    expect(s.controller.diagnostics()['helloDocs']).toBe(0);
    expect(await s.controller.onPageMessage(frameCtx(7, 3, WIDGET), hello, BANK_TOP)).toEqual(INACTIVE);
  });

  it('lanes: isTabExcluded is true for an excluded or unknown tab site, false for a known allowed one', async () => {
    const s = await activeSetup(true);
    const ctx = s.services.find((x) => x.name === 'value-match')?.ctx;
    if (ctx === null || ctx === undefined) throw new Error('value-match did not start');
    s.controller.onCommitted(committed({ tabId: 7, url: 'https://www.shop-site.com/', documentId: frameDoc(7, 0) }));
    s.controller.onCommitted(committed({ tabId: 8, url: 'https://www.bank-site.com/', documentId: frameDoc(8, 0) }));
    expect(ctx.isTabExcluded(7)).toBe(false);
    expect(ctx.isTabExcluded(8)).toBe(true);
    expect(ctx.isTabExcluded(50)).toBe(true);
    await s.controller.onPageMessage(frameCtx(50, 2, WIDGET), hello, SHOP_TOP);
    expect(ctx.isTabExcluded(50)).toBe(false);
    await s.controller.onPageMessage(frameCtx(51, 2, WIDGET), hello, BANK_TOP);
    expect(ctx.isTabExcluded(51)).toBe(true);
  });
});
