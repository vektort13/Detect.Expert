// ADR-020 §H (S13): the GPC lane — exact JSON of the Sec-GPC rule, priority above every allow rule, the read-back check
// (installed | absent | error), one write per trigger (SP-1 hang → error, no retry loop), exclusions following
// ui-protect-set-site, removal when the feature or the module goes off, the header reader (only Sec-GPC's value is
// ever read), and the per-tab facts (navigation observed / not-observed / not-applicable / unknown, counts with and
// without the header, lower bounds after a restart, reloadNeeded, LRU of 64 tabs).

import { DNR_PRIORITIES, DNR_RULE_IDS, PROTECT_BUDGETS } from '@detect-expert/contracts';
import type { GpcTabFact } from '@detect-expert/contracts';
import { assertAllowedRule, isAllowedRule } from '@detect-expert/engine';
import { describe, expect, it } from 'vitest';
import type { DnrRuleLike, RequestDetailsLike } from '../../src/chrome-api';
import { ProtectController } from '../../src/protect/controller';
import { GPC_RESOURCE_TYPES, GpcService, buildGpcRule, gpcExclusions, gpcHeaderOf, gpcResourceTypes, verifyGpcRule } from '../../src/protect/gpc/index';
import { committed } from '../fake-chrome';
import { ALL_SITES, DNR_PERMISSION, ENABLED_SETTINGS, optionsSender, popupSender, settleProtect, setupController } from './support';
import type { ControllerSetup } from './support';

const ALL_TYPES = ['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'other'];

describe('Sec-GPC rule (rule.ts)', () => {
  it('exact JSON without exclusions: id 1, priority 100, set Sec-GPC: 1 on 13 resource types', () => {
    const rule = buildGpcRule([]);
    expect(JSON.stringify(rule)).toBe(JSON.stringify({
      id: 1,
      priority: 100,
      action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Sec-GPC', operation: 'set', value: '1' }] },
      condition: { resourceTypes: ALL_TYPES },
    }));
    expect(isAllowedRule(rule)).toBe(true);
    expect([...GPC_RESOURCE_TYPES]).toEqual(ALL_TYPES);
  });

  it('exact JSON with exclusions: sorted, unique, invalid names dropped, the same list as initiator and target', () => {
    const excluded = gpcExclusions(['shop.com', 'bank.example', 'shop.com', '127.0.0.1', 'localhost', 'Bad Site', 'https://x.com']);
    expect(excluded).toEqual(['127.0.0.1', 'bank.example', 'localhost', 'shop.com']);
    const rule = buildGpcRule(excluded);
    expect(JSON.stringify(rule)).toBe(JSON.stringify({
      id: 1,
      priority: 100,
      action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Sec-GPC', operation: 'set', value: '1' }] },
      condition: { resourceTypes: ALL_TYPES, excludedInitiatorDomains: excluded, excludedRequestDomains: excluded },
    }));
    expect(() => assertAllowedRule(rule)).not.toThrow();
    expect(gpcExclusions(Array.from({ length: 400 }, (_, i) => 's' + String(i) + '.com'))).toHaveLength(PROTECT_BUDGETS.maxExcludedSites);
  });

  it('resource types narrow to what the browser knows; the full list when unknown', () => {
    expect(gpcResourceTypes(null)).toEqual(ALL_TYPES);
    expect(gpcResourceTypes(['main_frame', 'webtransport', 'xmlhttprequest'])).toEqual(['main_frame', 'xmlhttprequest']);
  });

  it('GPC (100) outranks every allow rule of the firewall; the id is the first of the GPC range', () => {
    const allows = [DNR_PRIORITIES.receiverAllow, DNR_PRIORITIES.siteAllow, DNR_PRIORITIES.once];
    for (const p of allows) expect(buildGpcRule([]).priority).toBeGreaterThan(p);
    expect(buildGpcRule([]).id).toBe(DNR_RULE_IDS.gpc[0]);
    // dnr-guard keeps it that way: the GPC range accepts only priority 100 and only this header.
    expect(isAllowedRule({ ...buildGpcRule([]), priority: DNR_PRIORITIES.siteAllow })).toBe(false);
    expect(isAllowedRule({ ...buildGpcRule([]), action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Sec-GPC', operation: 'set', value: '0' }] } })).toBe(false);
    expect(isAllowedRule({ ...buildGpcRule([]), action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Referer', operation: 'remove' }] } })).toBe(false);
  });

  it('read-back: absent, installed (order and header case free), error on any other difference', () => {
    const desired = buildGpcRule(['b.com', 'a.com']);
    const echo = JSON.parse(JSON.stringify(desired)) as DnrRuleLike & { condition: Record<string, unknown>; action: Record<string, unknown> };
    expect(verifyGpcRule([], desired)).toBe('absent');
    expect(verifyGpcRule(null, desired)).toBe('error');
    expect(verifyGpcRule([echo], desired)).toBe('installed');
    const reordered = { ...echo, condition: { ...echo.condition, resourceTypes: [...ALL_TYPES].reverse(), excludedRequestDomains: ['a.com', 'b.com'], isUrlFilterCaseSensitive: false } };
    expect(verifyGpcRule([reordered], desired)).toBe('installed');
    const lowerHeader = { ...echo, action: { type: 'modifyHeaders', requestHeaders: [{ header: 'sec-gpc', operation: 'set', value: '1' }] } };
    expect(verifyGpcRule([lowerHeader], desired)).toBe('installed');
    expect(verifyGpcRule([{ ...echo, priority: 1 }], desired)).toBe('error');
    expect(verifyGpcRule([{ ...echo, condition: { ...echo.condition, excludedRequestDomains: ['a.com'] } }], desired)).toBe('error');
    expect(verifyGpcRule([{ ...echo, condition: { ...echo.condition, requestDomains: ['x.com'] } }], desired)).toBe('error');
    expect(verifyGpcRule([{ ...echo, action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Sec-GPC', operation: 'set', value: '0' }] } }], desired)).toBe('error');
    expect(verifyGpcRule([echo, { ...echo, id: 2 }], desired)).toBe('error');
  });
});

describe('gpcHeaderOf (header.ts): only the Sec-GPC value is ever read', () => {
  it('present / other-value / absent, case-insensitive name', () => {
    expect(gpcHeaderOf([{ name: 'Accept', value: '*/*' }, { name: 'Sec-GPC', value: '1' }])).toBe('present');
    expect(gpcHeaderOf([{ name: 'sec-gpc', value: '1' }])).toBe('present');
    expect(gpcHeaderOf([{ name: 'SEC-GPC', value: '0' }])).toBe('other-value');
    expect(gpcHeaderOf([{ name: 'Sec-GPC' }])).toBe('other-value');
    expect(gpcHeaderOf([{ name: 'Accept', value: '1' }])).toBe('absent');
    expect(gpcHeaderOf(undefined)).toBe('absent');
    expect(gpcHeaderOf(null)).toBe('absent');
  });

  it('a Proxy array: names are read, no value of another header is touched; at most 128 entries', () => {
    const reads: string[] = [];
    const entry = (name: string, value: string) => new Proxy({ name, value }, {
      get(target, key, receiver) {
        reads.push(name + '.' + String(key));
        return Reflect.get(target, key, receiver) as unknown;
      },
      getOwnPropertyDescriptor(target, key) {
        reads.push(name + '#' + String(key));
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    const list = [entry('Cookie', 'CANARY-COOKIE'), entry('Authorization', 'CANARY-AUTH'), entry('Referer', 'https://canary.example/path?q=1'), entry('Sec-GPC', '1'), entry('X-After', 'never')];
    const headers = new Proxy(list, {});
    expect(gpcHeaderOf(headers as unknown as Array<{ name: string; value?: string }>)).toBe('present');
    expect(reads.filter((r) => r.endsWith('.value'))).toEqual(['Sec-GPC.value']);
    expect(reads.some((r) => r.startsWith('X-After'))).toBe(false);
    const many = Array.from({ length: 200 }, (_, i) => ({ name: 'H' + String(i), value: 'v' }));
    many[150] = { name: 'Sec-GPC', value: '1' };
    expect(gpcHeaderOf(many)).toBe('absent');
  });
});

// ---------------------------------------------------------------------------
// The lane over the controller (fake chrome, MemoryProtectDb)
// ---------------------------------------------------------------------------

const GPC_SETTINGS = { ...ENABLED_SETTINGS, features: ['gpc'] };

async function setupGpc(over: { features?: string[]; hang?: boolean } = {}): Promise<ControllerSetup & { service: GpcService }> {
  const service = new GpcService({ flushMs: 1 });
  const setup = await setupController({
    chrome: { grantedOrigins: ALL_SITES, permissions: [DNR_PERMISSION] },
    settings: { ...GPC_SETTINGS, features: over.features ?? ['gpc'] },
    services: () => [service as never],
    load: false,
  });
  if (over.hang === true) setup.fake.dnr.hangWrites = true;
  await setup.controller.load();
  return { ...setup, service };
}

let seq = 0;
function req(over: Partial<RequestDetailsLike> & { gpc?: string | null } = {}): RequestDetailsLike {
  const { gpc, ...rest } = over;
  const headers = [{ name: 'Accept', value: '*/*' }, { name: 'Cookie', value: 'CANARY-COOKIE=1' }];
  if (gpc !== null && gpc !== undefined) headers.push({ name: 'Sec-GPC', value: gpc });
  return {
    tabId: 7, frameId: 0, url: 'https://www.shop.com/', type: 'xmlhttprequest', timeStamp: 1, requestId: 'g' + String(++seq), method: 'GET',
    initiator: 'https://www.shop.com', requestHeaders: headers, ...rest,
  };
}

function gpcOf(s: ControllerSetup, tabId = 7): GpcTabFact | null {
  return s.controller.getReport(tabId)?.gpc ?? null;
}

describe('GPC lane in the controller', () => {
  it('enable → one rule in the GPC range, read back as installed; the header listener asks for requestHeaders', async () => {
    const s = await setupGpc();
    expect(s.service.ruleStatus).toBe('installed');
    expect([...s.fake.dnr.dynamic.keys()]).toEqual([1]);
    expect(JSON.parse(JSON.stringify(s.fake.dnr.dynamic.get(1)))).toEqual(JSON.parse(JSON.stringify(buildGpcRule([]))));
    expect(s.fake.webRequestEvents.sendHeaders.listeners.map((l) => l.extra)).toEqual([['requestHeaders']]);
    expect(s.controller.getState().state).toBe('active');
    expect(s.service.debug()).toMatchObject({ ruleInstalled: true, ruleStatus: 1, applies: 1, applyFailures: 0 });
  });

  it('SP-1: a hanging write → error after the timeout, one attempt, no loop; the site line says the signal is off', async () => {
    const s = await setupGpc({ hang: true });
    expect(s.service.ruleStatus).toBe('error');
    const writes = () => s.fake.dnr.calls.filter((c) => c.method === 'updateDynamicRules').length;
    const before = writes();
    expect(before).toBe(1);
    await settleProtect(120);
    expect(writes()).toBe(before);
    expect(s.controller.getState().degradedReasons).toContain('blocking-unavailable');
    s.controller.onCommitted(committed({ tabId: 7, url: 'https://www.shop.com/', documentId: 'DOCGPC000000000000000000000001' }));
    expect(gpcOf(s)?.siteState).toBe('off');
  });

  it('a site excluded from the popup is excluded from the rule at once (initiator and target); Options brings it back', async () => {
    const s = await setupGpc();
    const r1 = await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-set-site', host: 'www.shop.com', excluded: true }, popupSender());
    expect(r1.type).toBe('protect-state');
    expect(JSON.parse(JSON.stringify(s.fake.dnr.dynamic.get(1)))).toEqual(JSON.parse(JSON.stringify(buildGpcRule(['shop.com']))));
    expect(s.service.ruleStatus).toBe('installed');
    // Removing the exclusion is an Options-only action.
    expect((await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-set-site', host: 'shop.com', excluded: false }, popupSender())).type).toBe('error');
    await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-set-site', host: 'shop.com', excluded: false }, optionsSender());
    expect(JSON.parse(JSON.stringify(s.fake.dnr.dynamic.get(1)))).toEqual(JSON.parse(JSON.stringify(buildGpcRule([]))));
  });

  it('feature off → the rule goes and the facts say a reload is needed; module off → no rule of ours', async () => {
    const s = await setupGpc({ features: ['value-match', 'gpc'] });
    s.fake.webRequestEvents.sendHeaders.emit(req({ type: 'main_frame', gpc: '1', initiator: undefined }));
    s.controller.onCommitted(committed({ tabId: 7, url: 'https://www.shop.com/', documentId: 'DOCGPC000000000000000000000002' }));
    expect(gpcOf(s)).toMatchObject({ siteState: 'on', navigationHeader: 'observed', propertyAtLoad: true, reloadNeeded: false });
    const off = await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-set-settings', features: ['value-match'] }, optionsSender());
    expect(off.type).toBe('protect-state');
    expect(s.fake.dnr.dynamic.has(1)).toBe(false);
    expect(s.fake.webRequestEvents.sendHeaders.listeners.map((l) => l.extra)).toEqual([[]]);
    // The stored fact of the open document stays (feature off: the lane does not run) and says a reload is needed.
    expect(gpcOf(s)).toMatchObject({ siteState: 'off', propertyAtLoad: true, reloadNeeded: true });
    await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-set-settings', features: ['value-match', 'gpc'] }, optionsSender());
    expect(s.fake.dnr.dynamic.has(1)).toBe(true);
    await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-disable', purge: false }, optionsSender());
    expect([...s.fake.dnr.dynamic.keys()]).toEqual([]);
  });

  it('navigation facts: observed, not-observed, not-applicable (excluded), unknown (no or stale request)', async () => {
    const s = await setupGpc();
    const nav = async (tabId: number, url: string, doc: string, header: string | null, initiator?: string, delayMs = 0) => {
      if (header !== 'none') s.fake.webRequestEvents.sendHeaders.emit(req({ tabId, url, type: 'main_frame', gpc: header, initiator }));
      s.clock.t += delayMs;
      s.controller.onCommitted(committed({ tabId, url, documentId: doc }));
    };
    await nav(1, 'https://a.com/', 'DOCGPCNAV0000000000000000000001', '1');
    await nav(2, 'https://b.com/', 'DOCGPCNAV0000000000000000000002', null);
    await nav(3, 'https://c.com/', 'DOCGPCNAV0000000000000000000003', 'none');
    await nav(4, 'https://d.com/', 'DOCGPCNAV0000000000000000000004', '1', undefined, 61_000);
    await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-set-site', host: 'e.com', excluded: true }, popupSender());
    await nav(5, 'https://www.e.com/', 'DOCGPCNAV0000000000000000000005', null);
    await nav(6, 'https://f.com/', 'DOCGPCNAV0000000000000000000006', null, 'https://e.com');
    expect(gpcOf(s, 1)).toMatchObject({ navigationHeader: 'observed', siteState: 'on', countQuality: 'exact', propertyAtLoad: true });
    expect(gpcOf(s, 2)).toMatchObject({ navigationHeader: 'not-observed' });
    expect(gpcOf(s, 3)).toMatchObject({ navigationHeader: 'unknown' });
    expect(gpcOf(s, 4)).toMatchObject({ navigationHeader: 'unknown' });
    expect(gpcOf(s, 5)).toMatchObject({ navigationHeader: 'not-applicable', siteState: 'excluded', propertyAtLoad: false, reloadNeeded: false });
    expect(gpcOf(s, 6)).toMatchObject({ navigationHeader: 'not-applicable', siteState: 'on' });
    for (const tab of [1, 2, 3, 4, 5, 6]) expect(gpcOf(s, tab)).toMatchObject({ evidenceSource: 'browser-network', integrity: 'browser-observed' });
  });

  it('counts sub_frame / xhr / ping with and without the header; without only when target and initiator are not excluded', async () => {
    const s = await setupGpc();
    await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-set-site', host: 'skip.net', excluded: true }, popupSender());
    s.controller.onCommitted(committed({ tabId: 7, url: 'https://www.shop.com/', documentId: 'DOCGPCCNT0000000000000000000001' }));
    const ev = s.fake.webRequestEvents.sendHeaders;
    for (const type of ['sub_frame', 'xmlhttprequest', 'ping']) ev.emit(req({ type, url: 'https://api.other.org/x', gpc: '1', frameId: type === 'sub_frame' ? 3 : 0 }));
    ev.emit(req({ type: 'xmlhttprequest', url: 'https://api.other.org/y', gpc: null }));
    ev.emit(req({ type: 'ping', url: 'https://api.other.org/z', gpc: '0' }));
    // Excluded target or initiator: the rule does not apply there, a missing header is not counted.
    ev.emit(req({ type: 'xmlhttprequest', url: 'https://cdn.skip.net/x', gpc: null }));
    ev.emit(req({ type: 'xmlhttprequest', url: 'https://api.other.org/w', initiator: 'https://skip.net', gpc: null }));
    // Not counted types.
    for (const type of ['image', 'script', 'other']) ev.emit(req({ type, url: 'https://api.other.org/i', gpc: null }));
    expect(gpcOf(s)).toMatchObject({ requestsWithHeader: 3, requestsWithoutHeader: 2, countQuality: 'exact' });
  });

  it('a restart reads the stored fact back with lower-bound counts; reloadNeeded follows exclusion changes', async () => {
    const s = await setupGpc();
    s.fake.webRequestEvents.sendHeaders.emit(req({ type: 'main_frame', gpc: '1', initiator: undefined }));
    s.controller.onCommitted(committed({ tabId: 7, url: 'https://www.shop.com/', documentId: 'DOCGPCRST0000000000000000000001' }));
    s.fake.webRequestEvents.sendHeaders.emit(req({ type: 'xmlhttprequest', gpc: '1' }));
    await settleProtect(20);
    s.service.flush();
    await s.controller.docStore.flush();
    const stored = Object.entries(Object.fromEntries(s.fake.session.data)).find(([k]) => k.startsWith('protect-doc:'));
    expect((stored?.[1] as { gpc?: GpcTabFact } | undefined)?.gpc).toMatchObject({ navigationHeader: 'observed', requestsWithHeader: 1 });

    // A new SW over the same storage.session.
    const service2 = new GpcService({ flushMs: 1 });
    const controller2 = new ProtectController(s.fake, { clock: s.clock, dbFactory: () => s.db, services: [service2], dnrTimeoutMs: 50, docStore: { flushMs: 1 } });
    await controller2.load();
    expect(controller2.getReport(7)?.gpc).toMatchObject({ navigationHeader: 'observed', requestsWithHeader: 1, countQuality: 'lower-bound', propertyAtLoad: true, reloadNeeded: false });
    await controller2.routeUi({ schemaVersion: 1, type: 'ui-protect-set-site', host: 'shop.com', excluded: true }, popupSender());
    expect(controller2.getReport(7)?.gpc).toMatchObject({ siteState: 'excluded', propertyAtLoad: true, reloadNeeded: true });
    controller2.stop();
  });

  it('a document the lane never saw commit: unknown navigation, lower bound, no reload claim', async () => {
    const s = await setupGpc();
    s.controller.onCommitted(committed({ tabId: 8, url: 'https://late.com/', documentId: 'DOCGPCLATE000000000000000000001' }));
    // As for a document committed before the lane ran: the lane holds no fact for it.
    s.service.onTabRemoved(8);
    expect(gpcOf(s, 8)).toMatchObject({ navigationHeader: 'unknown', countQuality: 'lower-bound', propertyAtLoad: false, reloadNeeded: false, siteState: 'on' });
    s.fake.webRequestEvents.sendHeaders.emit(req({ tabId: 8, type: 'xmlhttprequest', url: 'https://late.com/x', initiator: 'https://late.com', gpc: '1' }));
    expect(gpcOf(s, 8)).toMatchObject({ requestsWithHeader: 1, countQuality: 'lower-bound' });
  });

  it('at most 64 tabs are remembered (LRU); a closed tab is forgotten', async () => {
    const s = await setupGpc();
    for (let t = 1; t <= 70; t++) {
      s.controller.onCommitted(committed({ tabId: t, url: 'https://s' + String(t) + '.com/', documentId: 'DOCGPCLRU' + String(t).padStart(22, '0') }));
    }
    expect(s.service.debug().tabs).toBe(PROTECT_BUDGETS.maxGpcTabs);
    s.controller.onTabRemoved(70);
    expect(s.service.debug().tabs).toBe(PROTECT_BUDGETS.maxGpcTabs - 1);
    const d = s.service.debug();
    for (const v of Object.values(d)) expect(['number', 'boolean']).toContain(typeof v);
  });
});
