// ADR-020 §C, §11 (S08): the firewall lane through the real controller on the fake DNR — prompts from evidence,
// decisions -> rules, truthful outcomes (a first request is never stopped; stopped only by our rule active ≥ 50 ms
// before), bypass, rebuild after a "restart", foreign rules in our ranges, the GPC range untouched, write rejection,
// a vanished namespace, limits, the strict preset, warn-only, undo, dismiss, rules list and purge. Responses and the
// projection are checked against the JSON Schemas.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { DNR_PRIORITIES, DNR_RULE_IDS, PROTECT_BUDGETS } from '@detect-expert/contracts';
import type { ProtectProjection, ProtectTransferEvidence, UiResponse } from '@detect-expert/contracts';
import { describe, expect, it } from 'vitest';
import type { BackgroundChromeApi, RequestDetailsLike } from '../../src/chrome-api';
import { ProtectController } from '../../src/protect/controller';
import { FirewallService } from '../../src/protect/firewall/index';
import { EMPTY_PROTECT_TABLES } from '../../src/protect/services';
import type { ProtectTables } from '../../src/protect/services';
import { committed, createFakeChrome } from '../fake-chrome';
import type { FakeChrome } from '../fake-chrome';
import { MemoryProtectDb } from './memory-db';
import { ALL_SITES, DNR_PERMISSION, ENABLED_SETTINGS, makeClock, optionsSender, popupSender } from './support';

const schemasDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'contracts', 'schemas');
const ajv = new Ajv2020({ strict: true, allErrors: true });
ajv.addSchema(JSON.parse(readFileSync(join(schemasDir, 'common.v1.schema.json'), 'utf8')) as Record<string, unknown>);
const validateResponse = ajv.compile(JSON.parse(readFileSync(join(schemasDir, 'ui-response.v1.schema.json'), 'utf8')) as Record<string, unknown>);

function schemaOk(response: unknown): void {
  const ok = validateResponse(response);
  expect(ok, JSON.stringify(validateResponse.errors)).toBe(true);
}

const DAY0 = Date.UTC(2026, 9, 18, 9, 0, 0);
const DOC1 = 'DOC00000000000000000000000000000A';
const DOC2 = 'DOC00000000000000000000000000000B';
const BLOCKED = 'net::ERR_BLOCKED_BY_CLIENT';
const SYNTHETIC_TABLES: ProtectTables = { ...EMPTY_PROTECT_TABLES, FIREWALL_PRESET_ENTRIES: [{ entryId: 'synthetic-collect', host: 'collect.example.net', synthetic: true }] };

interface Setup {
  fake: FakeChrome;
  clock: { t: number; now(): number };
  db: MemoryProtectDb;
  controller: ProtectController;
  service: FirewallService;
}

interface SetupOptions {
  features?: string[];
  preset?: string;
  tables?: ProtectTables;
  fake?: FakeChrome;
  db?: MemoryProtectDb;
  clock?: { t: number; now(): number };
  api?: BackgroundChromeApi;
  testProfile?: boolean;
}

async function setup(o: SetupOptions = {}): Promise<Setup> {
  const fake = o.fake ?? createFakeChrome({ grantedOrigins: ALL_SITES, permissions: [DNR_PERMISSION] });
  if (o.fake === undefined) fake.local.data.set('protect', { ...ENABLED_SETTINGS, features: o.features ?? ['value-match', 'firewall'], preset: o.preset ?? 'normal' });
  const clock = o.clock ?? makeClock(DAY0);
  const db = o.db ?? new MemoryProtectDb();
  const service = new FirewallService({ statsFlushMs: 1 });
  const controller = new ProtectController(o.api ?? fake, { clock, dbFactory: () => db, services: [service], dnrTimeoutMs: 50, docStore: { flushMs: 1 }, testProfile: o.testProfile ?? true, tables: o.tables ?? EMPTY_PROTECT_TABLES });
  await controller.load();
  return { fake, clock, db, controller, service };
}

function commit(s: Setup, tabId = 7, url = 'https://www.shop.com/checkout', documentId = DOC1): string {
  s.controller.onCommitted(committed({ tabId, url, documentId }));
  return tabId + ':0:' + documentId;
}

function evidence(receiver: string, over: Partial<ProtectTransferEvidence> = {}): ProtectTransferEvidence {
  return {
    evidenceId: 'pe-1',
    protectKind: 'value-match',
    ruleId: 'form-leak',
    frameContext: 'top',
    attributionConfidence: 'unknown',
    count: 1,
    countQuality: 'exact',
    firstSecond: 1,
    lastSecond: 1,
    evidenceSource: 'derived',
    integrity: 'derived',
    ruleVersion: '1',
    limitationCodes: [],
    transferClass: 'third-party-before-submit',
    fieldKind: 'email',
    encodings: ['sha256-hex'],
    location: 'query',
    paramName: 'h',
    receiver,
    relation: 'cross-site',
    method: 'GET',
    requestKind: 'xhr',
    endpointHost: receiver,
    endpointPathTemplate: '/c',
    submitTiming: 'before-submit',
    deliveryState: 'unknown',
    interpretationConfidence: 'high',
    ...over,
  };
}

function publishRaw(s: Setup, ev: ProtectTransferEvidence, tabId = 7): void {
  const key = s.controller.tabModel.topDocumentKey(tabId)!;
  s.controller.eventBus.publish({ kind: 'evidence', documentKey: key, tabId, site: s.controller.tabModel.get(tabId)?.site ?? null, evidence: ev });
}

function publish(s: Setup, receiver: string, over: Partial<ProtectTransferEvidence> = {}, tabId = 7): void {
  publishRaw(s, evidence(receiver, over), tabId);
}

function report(s: Setup, tabId = 7): ProtectProjection {
  const r = s.controller.getReport(tabId);
  if (r === null) throw new Error('no report');
  return r;
}

async function idle(s: Setup): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await s.controller.idle();
    await new Promise((r) => setTimeout(r, 2));
  }
}

async function decide(s: Setup, receivers: string[], action: 'block' | 'allow', scope: 'once' | 'site' | 'everywhere', tabId = 7): Promise<UiResponse & Record<string, unknown>> {
  await idle(s);
  const r = report(s, tabId);
  const prompt = r.firewall.prompt;
  if (prompt === null) throw new Error('no prompt');
  return (await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-decide', tabId, documentKey: r.documentKey, protectRevision: r.protectRevision, promptId: prompt.promptId, receivers, action, scope }, popupSender())) as UiResponse & Record<string, unknown>;
}

let seq = 0;
function request(s: Setup, over: Partial<RequestDetailsLike> = {}): RequestDetailsLike {
  seq++;
  return { tabId: 7, frameId: 0, url: 'https://collect.tracker.net/c?h=0', type: 'xmlhttprequest', timeStamp: s.clock.now(), requestId: 'q' + String(seq), initiator: 'https://www.shop.com', method: 'GET', ...over };
}

/** A request the browser sent (onSendHeaders, then completed). */
function sent(s: Setup, over: Partial<RequestDetailsLike> = {}): RequestDetailsLike {
  const d = request(s, over);
  s.fake.webRequestEvents.beforeRequest.emit(d);
  s.fake.webRequestEvents.sendHeaders.emit(d);
  s.fake.webRequestEvents.completed.emit({ ...d, statusCode: 204 });
  return d;
}

/**
 * A request DNR stopped (SP-2: onBeforeRequest, then onErrorOccurred ERR_BLOCKED_BY_CLIENT, no onSendHeaders).
 * `trackedByMatch`: tracked the way value-match tracks a request whose body matched (S07).
 */
function stopped(s: Setup, over: Partial<RequestDetailsLike> = {}, trackedByMatch = false): RequestDetailsLike {
  const d = request(s, over);
  if (trackedByMatch) s.controller.outcomes.track(d.requestId!, d.tabId, d.timeStamp);
  s.fake.webRequestEvents.beforeRequest.emit(d);
  s.fake.webRequestEvents.errorOccurred.emit({ ...d, error: BLOCKED });
  return d;
}

describe('firewall lane: prompts and decisions', () => {
  it('prompts only from third-party-before-submit evidence with confidence ≥ medium; ≤ 8 receivers, the rest hidden', async () => {
    const s = await setup();
    commit(s);
    publish(s, 'low.net', { interpretationConfidence: 'low' });
    publish(s, 'atsubmit.net', { transferClass: 'third-party-at-submit' });
    publish(s, 'firstparty.net', { transferClass: 'first-party-before-submit' });
    const categoryOnly = evidence('category-only.net', { receiverCategory: 'loopback' });
    delete (categoryOnly as { receiver?: string }).receiver;
    publishRaw(s, categoryOnly);
    await idle(s);
    expect(report(s).firewall.prompt).toBeNull();
    expect(report(s).firewall.receivers.map((r) => r.receiver).sort()).toEqual(['atsubmit.net', 'low.net']);
    for (let i = 0; i < 10; i++) publish(s, 'r' + String(i) + '.net', { interpretationConfidence: i % 2 === 0 ? 'medium' : 'high' });
    publish(s, 'r0.net');
    await idle(s);
    const fw = report(s).firewall;
    expect(fw.prompt?.receivers).toHaveLength(PROTECT_BUDGETS.maxPromptReceivers);
    expect(fw.prompt?.hidden).toBe(2);
    expect(fw.prompt?.site).toBe('shop.com');
    expect(fw.receivers.length).toBeLessThanOrEqual(16);
    expect(s.controller.pendingCount(7)).toBe(PROTECT_BUDGETS.maxPromptReceivers);
    schemaOk({ schemaVersion: 1, type: 'protect-report', report: report(s) });
  });

  it('never a rule from a receiver that is not a registrable domain, the site itself or a shared platform', async () => {
    const s = await setup();
    commit(s);
    for (const r of ['shop.com', 'amazonaws.com']) publish(s, r);
    await idle(s);
    expect(report(s).firewall.prompt).toBeNull();
    publish(s, 'tracker.net');
    await idle(s);
    // A decision may name only receivers of the prompt (never page-controlled or arbitrary data).
    const forged = await decide(s, ['evil.net'], 'block', 'everywhere');
    expect(forged).toMatchObject({ type: 'error', code: 'stale-revision' });
    expect(s.fake.dnr.dynamic.size).toBe(0);
  });

  it('site block: the decision is stored, the rule written (p30, topDomains), the prompt resolved; schema-valid answer', async () => {
    const s = await setup();
    commit(s);
    publish(s, 'tracker.net');
    const res = await decide(s, ['tracker.net'], 'block', 'site');
    schemaOk(res);
    expect(res).toMatchObject({ type: 'protect-decision', applied: [{ receiver: 'tracker.net', ruleApplied: true }], report: null });
    expect(typeof res['undoId']).toBe('string');
    const rule = s.fake.dnr.dynamic.get(DNR_RULE_IDS.decisions[0]);
    expect(rule).toEqual({ id: DNR_RULE_IDS.decisions[0], priority: DNR_PRIORITIES.siteBlock, action: { type: 'block' }, condition: { requestDomains: ['tracker.net'], topDomains: ['shop.com'] } });
    const fw = report(s).firewall;
    expect(fw.prompt).toBeNull();
    expect(fw.enforcement).toBe('active');
    expect(fw.receivers[0]?.effectiveRule).toEqual({ action: 'block', scope: 'site', origin: 'user' });
    expect(s.controller.pendingCount(7)).toBe(0);
    const stored = [...s.db.stores.get('decisions')!.values()].map((e) => e.value);
    expect(stored).toEqual([{ decisionKey: 'site:shop.com>tracker.net', receiver: 'tracker.net', site: 'shop.com', scope: 'site', action: 'block', origin: 'user', slot: 0, createdDay: '2026-10-18', stopped: 0, bypass: 0 }]);
    // A new prompt for a decided receiver is not raised again.
    publish(s, 'tracker.net');
    await idle(s);
    expect(report(s).firewall.prompt).toBeNull();
  });

  it('everywhere block (p10, excludedTopDomains) and a site allow that overrides it (p40)', async () => {
    const s = await setup();
    commit(s);
    publish(s, 'tracker.net');
    expect(await decide(s, ['tracker.net'], 'block', 'everywhere')).toMatchObject({ applied: [{ ruleApplied: true }] });
    expect(s.fake.dnr.dynamic.get(DNR_RULE_IDS.decisions[0])?.condition).toEqual({ requestDomains: ['tracker.net'], excludedTopDomains: ['tracker.net'] });
    commit(s, 9, 'https://news.org/a', DOC2);
    publish(s, 'other.net', {}, 9);
    expect(await decide(s, ['other.net'], 'allow', 'site', 9)).toMatchObject({ applied: [{ ruleApplied: true }] });
    expect(s.fake.dnr.dynamic.size, 'an allow nothing overlaps needs no rule').toBe(1);
  });

  it('stale prompt id or document, unknown receiver, unsafe receivers are refused', async () => {
    const s = await setup();
    commit(s);
    publish(s, 'tracker.net');
    await idle(s);
    const r = report(s);
    const base = { schemaVersion: 1 as const, type: 'ui-protect-decide' as const, tabId: 7, documentKey: r.documentKey, protectRevision: r.protectRevision, promptId: r.firewall.prompt!.promptId, receivers: ['tracker.net'], action: 'block' as const, scope: 'site' as const };
    expect(await s.controller.routeUi({ ...base, promptId: '0000000000000000' }, popupSender())).toMatchObject({ code: 'stale-revision' });
    expect(await s.controller.routeUi({ ...base, protectRevision: r.protectRevision + 100 }, popupSender())).toMatchObject({ code: 'stale-revision' });
    expect(await s.controller.routeUi({ ...base, documentKey: '7:0:OTHERDOC' }, popupSender())).toMatchObject({ code: 'document-mismatch' });
    commit(s, 7, 'https://elsewhere.org/', DOC2);
    expect(await s.controller.routeUi({ ...base, documentKey: '7:0:' + DOC2 }, popupSender())).toMatchObject({ code: 'stale-revision' });
    expect(s.fake.dnr.dynamic.size).toBe(0);
  });

  it('once: a session rule for the tab (p50, tabIds), removed on a cross-site commit and when the tab closes', async () => {
    const s = await setup();
    commit(s);
    publish(s, 'tracker.net');
    expect(await decide(s, ['tracker.net'], 'block', 'once')).toMatchObject({ applied: [{ ruleApplied: true }] });
    expect(s.fake.dnr.session.get(DNR_RULE_IDS.session[0])).toEqual({ id: DNR_RULE_IDS.session[0], priority: DNR_PRIORITIES.once, action: { type: 'block' }, condition: { requestDomains: ['tracker.net'], topDomains: ['shop.com'], tabIds: [7] } });
    expect(report(s).firewall.onceRules).toEqual([{ receiver: 'tracker.net', action: 'block' }]);
    expect(s.controller.tabModel.get(7)?.lanes?.['firewall']).toMatchObject({ v: 1, tabId: 7, once: [{ slot: 0, site: 'shop.com', receiver: 'tracker.net', action: 'block' }] });
    commit(s, 7, 'https://www.shop.com/next', DOC2); // same site: stays
    await idle(s);
    expect(s.fake.dnr.session.size).toBe(1);
    commit(s, 7, 'https://other.org/', DOC1); // another site: goes
    await idle(s);
    expect(s.fake.dnr.session.size).toBe(0);
    commit(s, 8, 'https://www.shop.com/', DOC2);
    publish(s, 'tracker.net', {}, 8);
    await decide(s, ['tracker.net'], 'block', 'once', 8);
    expect(s.fake.dnr.session.size).toBe(1);
    s.controller.onTabRemoved(8);
    await idle(s);
    expect(s.fake.dnr.session.size).toBe(0);
  });

  it('once follows tabs.onReplaced to the new tab id when the site is the same', async () => {
    const s = await setup();
    commit(s);
    publish(s, 'tracker.net');
    await decide(s, ['tracker.net'], 'block', 'once');
    s.controller.onTabReplaced(12, 7);
    await idle(s);
    expect([...s.fake.dnr.session.values()].map((r) => r.condition)).toEqual([{ requestDomains: ['tracker.net'], topDomains: ['shop.com'], tabIds: [12] }]);
  });

  it('limits: 1001st decision and 129th once decision → limit-reached (nothing written)', async () => {
    const s = await setup();
    commit(s);
    await s.controller.inject('firewall', { op: 'bulk', count: PROTECT_BUDGETS.maxDecisions });
    expect(s.fake.dnr.dynamic.size).toBe(PROTECT_BUDGETS.maxDecisions);
    publish(s, 'tracker.net');
    expect(await decide(s, ['tracker.net'], 'block', 'site')).toMatchObject({ type: 'error', code: 'limit-reached' });
    // 128 once decisions over several tabs, then the 129th.
    for (let t = 0; t < 16; t++) {
      commit(s, 100 + t, 'https://site' + String(t) + '.com/', 'DOCONCE' + String(t).padStart(25, '0'));
      for (let i = 0; i < 8; i++) publish(s, 'once' + String(t) + '-' + String(i) + '.net', {}, 100 + t);
      const res = await decide(s, Array.from({ length: 8 }, (_, i) => 'once' + String(t) + '-' + String(i) + '.net'), 'block', 'once', 100 + t);
      expect(res['type'], JSON.stringify(res)).toBe('protect-decision');
    }
    expect(s.fake.dnr.session.size).toBe(PROTECT_BUDGETS.maxSessionRules);
    publish(s, 'extra.net');
    expect(await decide(s, ['extra.net'], 'block', 'once')).toMatchObject({ type: 'error', code: 'limit-reached' });
    expect(s.fake.dnr.session.size).toBe(PROTECT_BUDGETS.maxSessionRules);
  });
});

describe('firewall lane: truthful outcomes (ADR-020 §11)', () => {
  it('the first request is sent; after the decision N stopped requests → stopped, stoppedToday == N; never claims the first', async () => {
    const s = await setup();
    commit(s);
    s.controller.netHub.arm(7);
    publish(s, 'tracker.net');
    await idle(s);
    sent(s); // the first request: no rule existed
    expect(report(s).firewall.receivers[0]).toMatchObject({ receiver: 'tracker.net', lastDelivery: 'sent', delivery: { sent: 1, stopped: 0 } });
    await decide(s, ['tracker.net'], 'block', 'site');
    // Inside the activation slack: a blocked request is not ours by §11.
    stopped(s);
    expect(report(s).firewall.stoppedToday.count).toBe(0);
    expect(report(s).firewall.receivers[0]?.delivery.stoppedOther).toBe(1);
    s.clock.t += PROTECT_BUDGETS.ruleActivationSlackMs + 10;
    const N = 4;
    for (const type of ['xmlhttprequest', 'ping', 'image', 'xmlhttprequest']) stopped(s, { type });
    const fw = report(s).firewall;
    expect(fw.stoppedToday).toEqual({ count: N, countQuality: 'lower-bound' });
    expect(fw.receivers[0]).toMatchObject({ lastDelivery: 'stopped', delivery: { sent: 1, stopped: N, stoppedOther: 1 } });
    await s.service.stop('suspended').catch(() => undefined);
    const record = [...s.db.stores.get('decisions')!.values()][0]!.value as Record<string, unknown>;
    expect(record['stopped']).toBe(N);
  });

  it('a tab that is not armed: stops are not observed (lower bound, never invented)', async () => {
    const s = await setup();
    commit(s);
    publish(s, 'tracker.net');
    await decide(s, ['tracker.net'], 'block', 'site');
    s.clock.t += 1000;
    stopped(s);
    expect(report(s).firewall.stoppedToday.count).toBe(0);
  });

  it('a sent request our rule (active ≥ 50 ms) should have stopped → bypass counter and notice', async () => {
    const s = await setup();
    commit(s);
    publish(s, 'tracker.net');
    await decide(s, ['tracker.net'], 'block', 'site');
    sent(s); // within the slack: not a bypass
    expect(report(s).firewall.notices).toEqual([]);
    s.clock.t += 100;
    sent(s);
    sent(s);
    expect(report(s).firewall.notices).toEqual([{ kind: 'bypass', receiver: 'tracker.net', count: 2 }]);
    expect(s.service.debug()['bypasses']).toBe(2);
  });

  it('rebuild after a "restart": the same rules, verdicts attribute stops to rules that were already active', async () => {
    const fake = createFakeChrome({ grantedOrigins: ALL_SITES, permissions: [DNR_PERMISSION] });
    fake.local.data.set('protect', { ...ENABLED_SETTINGS, features: ['value-match', 'firewall'] });
    const db = new MemoryProtectDb();
    const clock = makeClock(DAY0);
    const a = await setup({ fake, db, clock });
    commit(a);
    publish(a, 'tracker.net');
    await decide(a, ['tracker.net'], 'block', 'site');
    await a.service.stop('suspended');
    await a.controller.docStore.flush();
    a.controller.stop();
    const rulesBefore = JSON.stringify([...fake.dnr.dynamic.values()]);
    const writes = fake.dnr.calls.filter((c) => c.method.startsWith('update')).length;
    // New SW: the same storage.session, IndexedDB and Chrome rules.
    const b = await setup({ fake, db, clock });
    expect(JSON.stringify([...fake.dnr.dynamic.values()])).toBe(rulesBefore);
    expect(fake.dnr.calls.filter((c) => c.method.startsWith('update')).length, 'unchanged rules are not rewritten').toBe(writes);
    expect(b.service.debug()).toMatchObject({ decisions: 1, activeRules: 1 });
    commit(b);
    b.controller.netHub.arm(7);
    stopped(b); // right after the restart: the rule was in Chrome before
    expect(report(b).firewall.stoppedToday.count).toBe(1);
  });

  it('foreign rules in our ranges are replaced; the GPC range is never touched by the firewall', async () => {
    const fake = createFakeChrome({ grantedOrigins: ALL_SITES, permissions: [DNR_PERMISSION] });
    fake.local.data.set('protect', { ...ENABLED_SETTINGS, features: ['firewall', 'gpc'] });
    const gpcRule = { id: DNR_RULE_IDS.gpc[0], priority: DNR_PRIORITIES.gpc, action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Sec-GPC', operation: 'set', value: '1' }] }, condition: { resourceTypes: ['main_frame'] } };
    fake.dnr.dynamic.set(gpcRule.id, gpcRule);
    fake.dnr.dynamic.set(100500, { id: 100500, priority: 10, action: { type: 'block' }, condition: { requestDomains: ['orphan.net'] } });
    fake.dnr.dynamic.set(101003, { id: 101003, priority: 10, action: { type: 'block' }, condition: { requestDomains: ['orphan-preset.net'] } });
    fake.dnr.session.set(200007, { id: 200007, priority: 50, action: { type: 'block' }, condition: { requestDomains: ['orphan-session.net'], tabIds: [1] } });
    fake.dnr.dynamic.set(5000, { id: 5000, priority: 1, action: { type: 'block' }, condition: { requestDomains: ['not-ours.net'] } });
    const s = await setup({ fake });
    expect([...fake.dnr.dynamic.keys()].sort((x, y) => x - y)).toEqual([DNR_RULE_IDS.gpc[0], 5000]);
    expect(fake.dnr.session.size).toBe(0);
    expect(fake.dnr.dynamic.get(DNR_RULE_IDS.gpc[0])).toEqual(gpcRule);
    commit(s);
    publish(s, 'tracker.net');
    await decide(s, ['tracker.net'], 'block', 'everywhere');
    expect(fake.dnr.dynamic.get(DNR_RULE_IDS.gpc[0]), 'GPC range untouched').toEqual(gpcRule);
    expect(fake.dnr.dynamic.get(5000), 'ids outside our ranges untouched').toBeDefined();
  });

  it('updateDynamicRules rejected → degraded (update-rejected), ruleApplied false, stoppedToday does not grow', async () => {
    const s = await setup();
    commit(s);
    s.controller.netHub.arm(7);
    publish(s, 'tracker.net');
    await idle(s);
    s.fake.dnr.failNextWrite = new Error('Internal error.');
    const res = await decide(s, ['tracker.net'], 'block', 'site');
    expect(res).toMatchObject({ type: 'protect-decision', applied: [{ receiver: 'tracker.net', ruleApplied: false }] });
    const fw = report(s).firewall;
    expect(fw.enforcement).toBe('degraded');
    expect(fw.degradedCode).toBe('update-rejected');
    s.clock.t += 1000;
    const outcomes: string[] = [];
    s.controller.eventBus.subscribe('outcome', (e) => {
      if (e.kind === 'outcome') outcomes.push(e.state);
    });
    stopped(s, {}, true); // blocked by something else: not our confirmed rule
    expect(outcomes).toEqual(['stopped-other']);
    expect(report(s).firewall.stoppedToday.count).toBe(0);
    schemaOk({ schemaVersion: 1, type: 'protect-report', report: report(s) });
  });

  it('SP-1: a hung write → degraded api-unavailable within the timeout; nothing claimed', async () => {
    const s = await setup();
    commit(s);
    publish(s, 'tracker.net');
    await idle(s);
    s.fake.dnr.hangWrites = true;
    const res = await decide(s, ['tracker.net'], 'block', 'site');
    expect(res).toMatchObject({ applied: [{ ruleApplied: false }] });
    expect(report(s).firewall).toMatchObject({ enforcement: 'degraded', degradedCode: 'api-unavailable' });
  });

  it('the namespace disappears → no-permission; the permission removed → needs-permission and cleanup-pending', async () => {
    const fake = createFakeChrome({ grantedOrigins: ALL_SITES, permissions: [DNR_PERMISSION] });
    fake.local.data.set('protect', { ...ENABLED_SETTINGS, features: ['value-match', 'firewall'] });
    let hidden = false;
    const api = new Proxy(fake, { get: (target, prop, receiver) => (prop === 'declarativeNetRequest' && hidden ? undefined : Reflect.get(target, prop, receiver)) });
    const s = await setup({ fake, api });
    commit(s);
    publish(s, 'tracker.net');
    await decide(s, ['tracker.net'], 'block', 'site');
    hidden = true;
    expect(report(s).firewall.enforcement).toBe('no-permission');
    const rows = (await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-list-rules', offset: 0, limit: 50 }, optionsSender())) as UiResponse & { rows: Array<{ active: boolean; inactiveReason?: string }> };
    expect(rows.rows[0]).toMatchObject({ active: false, inactiveReason: 'no-permission' });
    hidden = false;
    fake.revokePermission(DNR_PERMISSION);
    await s.controller.onPermissionsRemoved({ permissions: [DNR_PERMISSION], origins: [] });
    expect(s.controller.getState().state).toBe('needs-permission');
    expect(s.controller.dnrPort.degraded).toBe('cleanup-pending');
    expect(fake.dnr.dynamic.size, 'SP-5: rules outlive the removed permission until the next grant').toBe(1);
  });
});

describe('firewall lane: disabling (foundation follow-up: the notice depends on the rule removal)', () => {
  it('rules removed → no blocking-unavailable after disable; removal not completed → blocking-unavailable even after purge', async () => {
    const ok = await setup();
    commit(ok);
    publish(ok, 'tracker.net');
    await decide(ok, ['tracker.net'], 'block', 'site');
    const off = await ok.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-disable', purge: true }, optionsSender());
    expect(off).toMatchObject({ type: 'protect-state', state: { state: 'off', degradedReasons: [] } });
    expect(ok.fake.dnr.dynamic.size).toBe(0);

    const hung = await setup();
    commit(hung);
    publish(hung, 'tracker.net');
    await decide(hung, ['tracker.net'], 'block', 'site');
    hung.fake.dnr.hangWrites = true; // SP-1: the removal write never completes
    const pending = await hung.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-disable', purge: true }, optionsSender());
    expect(pending).toMatchObject({ type: 'protect-state', state: { state: 'off', features: [], degradedReasons: ['blocking-unavailable'] } });
    expect(hung.controller.dnrPort.degraded).toBe('cleanup-pending');
    expect(hung.fake.dnr.dynamic.size, 'the rule may still act: the UI must not claim it was removed').toBe(1);
  });

  it('review W2: disabling while a decision rebuild is writing leaves no rule of ours (stop waits for the lane; removal after its last write)', async () => {
    for (const gap of [0, 1, 2, 3, 4, 6]) {
      const s = await setup();
      // Chrome answers a read with the state at the call, after a short IPC delay (the window of the race).
      const dnr = s.fake.dnr;
      const getDynamic = dnr.getDynamicRules.bind(dnr);
      const getSession = dnr.getSessionRules.bind(dnr);
      dnr.getDynamicRules = async () => {
        const snap = await getDynamic();
        await new Promise((r) => setTimeout(r, 5));
        return snap;
      };
      dnr.getSessionRules = async () => {
        const snap = await getSession();
        await new Promise((r) => setTimeout(r, 5));
        return snap;
      };
      commit(s);
      publish(s, 'tracker.net');
      await idle(s);
      const r = report(s);
      const decision = s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-decide', tabId: 7, documentKey: r.documentKey, protectRevision: r.protectRevision, promptId: r.firewall.prompt!.promptId, receivers: ['tracker.net'], action: 'block', scope: 'site' }, popupSender());
      if (gap > 0) await new Promise((res) => setTimeout(res, gap));
      const off = (await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-disable', purge: false }, optionsSender())) as UiResponse & { state: { degradedReasons: string[] } };
      await decision;
      await new Promise((res) => setTimeout(res, 30));
      expect([...dnr.dynamic.keys()], 'gap ' + String(gap) + ' ms: a rule of ours outlived the disable').toEqual([]);
      expect(dnr.session.size).toBe(0);
      expect(off.state.degradedReasons, 'gap ' + String(gap)).not.toContain('blocking-unavailable');
      expect(s.controller.isActive).toBe(false);
    }
  });
});

describe('firewall lane: site exclusions (review TRUTH-01)', () => {
  it('excluding a site rewrites «везде» and preset rules so they do not act there; including it again restores them', async () => {
    const s = await setup({ preset: 'strict', tables: SYNTHETIC_TABLES });
    commit(s);
    publish(s, 'tracker.net');
    await decide(s, ['tracker.net'], 'block', 'everywhere');
    const everywhere = (): unknown => [...s.fake.dnr.dynamic.values()].find((r) => r.id >= DNR_RULE_IDS.decisions[0] && r.id <= DNR_RULE_IDS.decisions[1] && (r.condition as { topDomains?: unknown }).topDomains === undefined)?.condition;
    const condition = (id: number): unknown => s.fake.dnr.dynamic.get(id)?.condition;
    expect(everywhere()).toEqual({ requestDomains: ['tracker.net'], excludedTopDomains: ['tracker.net'] });
    const on = await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-set-site', host: 'www.bank-site.com', excluded: true }, optionsSender());
    expect(on).toMatchObject({ type: 'protect-state', state: { excludedSites: ['bank-site.com'] } });
    await idle(s);
    expect(everywhere()).toEqual({ requestDomains: ['tracker.net'], excludedTopDomains: ['tracker.net', 'bank-site.com'] });
    expect(condition(DNR_RULE_IDS.preset[0])).toEqual({ requestDomains: ['collect.example.net'], excludedTopDomains: ['example.net', 'bank-site.com'] });
    // A request from the excluded site is not attributed to our rule (it is not stopped by it).
    commit(s, 9, 'https://www.bank-site.com/login', DOC2);
    s.controller.netHub.arm(9);
    s.clock.t += 100;
    sent(s, { tabId: 9, url: 'https://collect.tracker.net/c?h=1', initiator: 'https://www.bank-site.com' });
    expect(report(s, 9).firewall.stoppedToday.count).toBe(0);
    await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-set-site', host: 'bank-site.com', excluded: false }, optionsSender());
    await idle(s);
    expect(everywhere()).toEqual({ requestDomains: ['tracker.net'], excludedTopDomains: ['tracker.net'] });
  });
});

describe('firewall lane: presets', () => {
  it('strict + synthetic preset: the preset rule exists before any request (the first request to it is stopped)', async () => {
    const s = await setup({ preset: 'strict', tables: SYNTHETIC_TABLES });
    expect(s.fake.dnr.dynamic.get(DNR_RULE_IDS.preset[0])).toEqual({ id: DNR_RULE_IDS.preset[0], priority: DNR_PRIORITIES.presetBlock, action: { type: 'block' }, condition: { requestDomains: ['collect.example.net'], excludedTopDomains: ['example.net'] } });
    commit(s);
    s.controller.netHub.arm(7);
    s.clock.t += 100; // the rule was written at enable, before the page's first request
    stopped(s, { url: 'https://collect.example.net/fw/collect?h=1' });
    expect(report(s).firewall.stoppedToday.count).toBe(1);
    expect(s.controller.pendingCount(7)).toBe(0);
  });

  it('production tables (empty) or a synthetic entry outside the test profile: no preset rule', async () => {
    const s = await setup({ preset: 'strict' });
    expect([...s.fake.dnr.dynamic.keys()].filter((id) => id >= DNR_RULE_IDS.preset[0])).toEqual([]);
    const t = await setup({ preset: 'strict', tables: SYNTHETIC_TABLES, testProfile: false });
    expect([...t.fake.dnr.dynamic.keys()].filter((id) => id >= DNR_RULE_IDS.preset[0])).toEqual([]);
  });

  it('strict-auto: a site-level block after the first event, with undo; «везде» only by a click; limits 8/site/day', async () => {
    const s = await setup({ preset: 'strict' });
    commit(s);
    publish(s, 'tracker.net');
    await idle(s);
    const fw = report(s).firewall;
    expect(fw.notices).toEqual([{ kind: 'strict-auto', receiver: 'tracker.net', site: 'shop.com', undoId: expect.stringMatching(/^[0-9a-f]{16}$/) as unknown as string }]);
    expect(s.fake.dnr.dynamic.get(DNR_RULE_IDS.decisions[0])?.condition).toEqual({ requestDomains: ['tracker.net'], topDomains: ['shop.com'] });
    expect([...s.db.stores.get('decisions')!.values()].map((e) => (e.value as { origin: string; scope: string }).origin + ':' + (e.value as { scope: string }).scope)).toEqual(['preset:site']);
    expect(s.controller.pendingCount(7), 'an automatic decision is not pending').toBe(0);
    // Second site with the same receiver → escalation notice, still only a site rule.
    commit(s, 9, 'https://news.org/', DOC2);
    publish(s, 'tracker.net', {}, 9);
    await idle(s);
    expect(report(s, 9).firewall.notices.map((n) => n.kind)).toEqual(['strict-auto', 'strict-escalate']);
    expect(report(s, 9).firewall.notices[1]).toMatchObject({ receiver: 'tracker.net', count: 2 });
    expect([...s.db.stores.get('decisions')!.values()].every((e) => (e.value as { scope: string }).scope === 'site')).toBe(true);
    // «Везде» by a click.
    expect(await decide(s, ['tracker.net'], 'block', 'everywhere', 9)).toMatchObject({ applied: [{ ruleApplied: true }] });
    // Undo of the first automatic block.
    const undoId = fw.notices[0]!.undoId!;
    expect(await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-undo', tabId: 7, undoId }, popupSender())).toMatchObject({ type: 'protect-decision', undoId: null });
    expect(await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-undo', tabId: 7, undoId }, popupSender())).toMatchObject({ type: 'error', code: 'not-found' });
    // Daily limit per site: 8 automatic decisions, then a limit notice and a prompt instead.
    commit(s, 20, 'https://limit.com/', 'DOCLIMIT0000000000000000000000');
    for (let i = 0; i < 9; i++) publish(s, 'l' + String(i) + '.net', {}, 20);
    await idle(s);
    const decided = [...s.db.stores.get('decisions')!.values()].filter((e) => (e.value as { site: string | null }).site === 'limit.com');
    expect(decided).toHaveLength(PROTECT_BUDGETS.maxStrictAutoPerSitePerDay);
    expect(report(s, 20).firewall.notices.some((n) => n.kind === 'limit-reached' && n.receiver === 'l8.net')).toBe(true);
    expect(s.controller.pendingCount(20)).toBe(1);
  });

  it('strict-auto with a rejected or hung write (SP-1): the decision is kept, no «теперь останавливаются» notice (review round 1)', async () => {
    const settle = async (s: Setup): Promise<void> => {
      for (let i = 0; i < 20; i++) {
        await s.controller.idle();
        await new Promise((r) => setTimeout(r, 10));
      }
    };
    for (const mode of ['reject', 'hang'] as const) {
      const s = await setup({ preset: 'strict' });
      commit(s);
      if (mode === 'reject') s.fake.dnr.failNextWrite = new Error('Internal error.');
      else s.fake.dnr.hangWrites = true;
      publish(s, 'tracker.net');
      await settle(s);
      let fw = report(s).firewall;
      expect(fw.enforcement, mode).toBe('degraded');
      expect(fw.degradedCode, mode).toBe(mode === 'reject' ? 'update-rejected' : 'api-unavailable');
      expect(s.fake.dnr.dynamic.size, mode + ': no rule in Chrome').toBe(0);
      expect(fw.notices, mode + ': nothing claims a stop').toEqual([]);
      expect(fw.prompt?.receivers, mode + ': the receiver stays in the card (degraded / restart notice there)').toEqual(['tracker.net']);
      expect(fw.receivers.find((r) => r.receiver === 'tracker.net')?.effectiveRule, mode + ': the stored decision is shown').toEqual({ action: 'block', scope: 'site', origin: 'preset' });
      expect([...s.db.stores.get('decisions')!.values()].map((e) => (e.value as { origin: string }).origin), mode).toEqual(['preset']);
      expect(s.service.debug(), mode).toMatchObject({ strictAuto: 1, strictAutoUnapplied: 1 });
      expect(s.controller.docStore.runtime().undo, mode + ': no undo entry without a notice').toEqual([]);
      schemaOk({ schemaVersion: 1, type: 'protect-report', report: report(s) });
      // The next strict-auto decision: SP-1 writes keep hanging (still no claim); after a single rejection the next
      // write is confirmed and only then the notice appears.
      publish(s, 'pixel.org');
      await settle(s);
      fw = report(s).firewall;
      if (mode === 'hang') {
        expect(fw.notices, 'SP-1 window: still nothing claimed').toEqual([]);
        expect(fw.enforcement).toBe('degraded');
      } else {
        expect(fw.enforcement).toBe('active');
        expect(fw.notices.map((n) => [n.kind, n.receiver])).toEqual([['strict-auto', 'pixel.org']]);
        expect(s.fake.dnr.dynamic.size, 'both stored decisions are in Chrome now').toBe(2);
      }
    }
  });

  it('warn-only: no rule is written; a decision is stored but never claimed as applied', async () => {
    const s = await setup({ preset: 'warn-only' });
    commit(s);
    publish(s, 'tracker.net');
    const res = await decide(s, ['tracker.net'], 'block', 'site');
    expect(res).toMatchObject({ applied: [{ ruleApplied: false }] });
    expect(s.fake.dnr.dynamic.size).toBe(0);
    expect(report(s).firewall.enforcement).toBe('warn-only');
    expect(report(s).firewall.receivers[0]?.effectiveRule, 'the decision is shown, not enforced').toEqual({ action: 'block', scope: 'site', origin: 'user' });
  });

  it('switching the preset (set-settings) rebuilds the rules at the next event', async () => {
    const s = await setup();
    commit(s);
    publish(s, 'tracker.net');
    await decide(s, ['tracker.net'], 'block', 'site');
    expect(s.fake.dnr.dynamic.size).toBe(1);
    expect(await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-set-settings', preset: 'warn-only' }, optionsSender())).toMatchObject({ type: 'protect-state' });
    sent(s, { url: 'https://cdn.other.org/x.js', type: 'script' });
    await idle(s);
    expect(s.fake.dnr.dynamic.size).toBe(0);
  });
});

describe('firewall lane: undo, dismiss, snooze, rules list, purge', () => {
  it('undo only when nothing changed since the decision; otherwise stale-revision', async () => {
    const s = await setup();
    commit(s);
    publish(s, 'tracker.net');
    const res = await decide(s, ['tracker.net'], 'block', 'site');
    const removed = await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-remove-rules', ruleKeys: ['site:shop.com>tracker.net'] }, optionsSender());
    schemaOk(removed);
    expect(await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-undo', tabId: 7, undoId: res['undoId'] as string }, popupSender())).toMatchObject({ code: 'stale-revision' });
    publish(s, 'pixel.org');
    const res2 = await decide(s, ['pixel.org'], 'allow', 'site');
    const undone = await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-undo', tabId: 7, undoId: res2['undoId'] as string }, popupSender());
    schemaOk(undone);
    expect(s.db.stores.get('decisions')!.size).toBe(0);
    expect(report(s).firewall.prompt?.receivers, 'undecided again: back in the prompt').toContain('pixel.org');
  });

  it('dismiss: no prompt for the site in this tab until it closes; snooze hides the prompt', async () => {
    const s = await setup();
    commit(s);
    publish(s, 'tracker.net');
    await idle(s);
    expect(await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-snooze', minutes: 60 }, popupSender())).toMatchObject({ type: 'protect-state' });
    expect(report(s).firewall.prompt).toBeNull();
    expect(s.controller.pendingCount(7)).toBe(0);
    await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-snooze', minutes: 0 }, popupSender());
    const r = report(s);
    expect(r.firewall.prompt).not.toBeNull();
    const dismissed = await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-dismiss', tabId: 7, documentKey: r.documentKey, protectRevision: r.protectRevision, promptId: r.firewall.prompt!.promptId }, popupSender());
    schemaOk(dismissed);
    publish(s, 'other.net');
    await idle(s);
    expect(report(s).firewall.prompt).toBeNull();
    expect(s.fake.dnr.dynamic.size).toBe(0);
  });

  it('list-rules: search, action filter, paging, lower-bound days; remove-rules; purge decisions', async () => {
    const s = await setup();
    commit(s);
    for (const r of ['alpha.net', 'beta.net', 'gamma.org']) publish(s, r);
    await decide(s, ['alpha.net', 'beta.net'], 'block', 'site');
    await decide(s, ['gamma.org'], 'allow', 'everywhere');
    const all = (await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-list-rules', offset: 0, limit: 50 }, optionsSender())) as UiResponse & { total: number; rows: Array<{ receiver: string; active: boolean }> };
    schemaOk(all);
    expect(all.total).toBe(3);
    const filtered = (await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-list-rules', offset: 0, limit: 50, domainFilter: 'net', action: 'block' }, optionsSender())) as UiResponse & { rows: Array<{ receiver: string }> };
    expect(filtered.rows.map((r) => r.receiver).sort()).toEqual(['alpha.net', 'beta.net']);
    const page = (await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-list-rules', offset: 2, limit: 1 }, optionsSender())) as UiResponse & { total: number; rows: unknown[] };
    expect([page.total, page.rows.length]).toEqual([3, 1]);
    expect(s.fake.dnr.dynamic.size).toBe(2);
    await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-purge', what: 'decisions' }, optionsSender());
    expect(s.db.stores.get('decisions')!.size).toBe(0);
    expect(s.fake.dnr.dynamic.size).toBe(0);
    expect(s.service.debug()).toMatchObject({ decisions: 0, activeRules: 0 });
  });
});
