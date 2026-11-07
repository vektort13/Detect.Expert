// ADR-020 §C, §8, REQ-005 (S08): what the firewall lane keeps. After prompts, decisions (site / everywhere / once /
// strict), outcomes and a bypass driven by requests whose URLs carry a canary e-mail's hash in the query, every
// string in the DNR rules, IndexedDB, storage.session, the projection, the rules list and the diagnostics is a domain,
// an enum value, a local day, a rule key or an opaque id — never a URL, a query, a path, the value or its hashes.

import { createHash } from 'node:crypto';
import { DECISION_ORIGINS, DECISION_SCOPES, DELIVERY_STATES, ENFORCEMENT_DEGRADED, ENFORCEMENT_STATES, FIELD_KINDS, FIREWALL_ACTIONS, FIREWALL_NOTICE_KINDS, FIREWALL_RULE_KEY_PATTERN, PROTECT_LIMITATIONS, PROTECT_PRESETS, SUBMIT_TIMINGS, VALUE_ENCODINGS, isDomainName, isLocalDay, isSiteName } from '@detect-expert/contracts';
import type { ProtectTransferEvidence, UiResponse } from '@detect-expert/contracts';
import { describe, expect, it } from 'vitest';
import type { RequestDetailsLike } from '../../packages/background/src/chrome-api';
import { ProtectController } from '../../packages/background/src/protect/controller';
import { FirewallService } from '../../packages/background/src/protect/firewall/index';
import { EMPTY_PROTECT_TABLES } from '../../packages/background/src/protect/services';
import { committed, createFakeChrome } from '../../packages/background/test/fake-chrome';
import { MemoryProtectDb } from '../../packages/background/test/protect/memory-db';
import { ALL_SITES, DNR_PERMISSION, ENABLED_SETTINGS, makeClock, optionsSender, popupSender } from '../../packages/background/test/protect/support';

const CANARY = 'fw-canary-7c1e@example.com';
const HASHES = ['md5', 'sha1', 'sha256', 'sha512'].flatMap((a) => [createHash(a).update(CANARY).digest('hex'), createHash(a).update(CANARY).digest('base64')]);
const ENUMS = new Set<string>([
  ...DECISION_ORIGINS, ...DECISION_SCOPES, ...DELIVERY_STATES, ...ENFORCEMENT_DEGRADED, ...ENFORCEMENT_STATES, ...FIELD_KINDS, ...FIREWALL_ACTIONS,
  ...FIREWALL_NOTICE_KINDS, ...PROTECT_LIMITATIONS, ...PROTECT_PRESETS, ...SUBMIT_TIMINGS, ...VALUE_ENCODINGS,
  'block', 'allow', 'site', 'everywhere', 'lower-bound', 'cross-site', 'same-site', 'top', 'subframe', 'unknown', 'none', 'lt-1s', 'firewall', 'firewall-stats', 'xmlhttprequest',
]);
const OPAQUE_ID = /^(?:[0-9a-f]{16}|[0-9a-f]{8}:\d+|pe-[0-9a-z]{1,12}|\d+:\d+:[A-Za-z0-9_-]{1,64}|DOC[0-9A-Z]+)$/;
const OTHER_KEYS = /^(?:once:\d+:[a-z0-9.-]+>[a-z0-9.-]+|preset:[a-z0-9-]+|protect-doc:\d+:\d+:[A-Za-z0-9_-]{1,64})$/;

function allowedString(s: string): boolean {
  return ENUMS.has(s) || isDomainName(s) || isSiteName(s) || isLocalDay(s) || FIREWALL_RULE_KEY_PATTERN.test(s) || OPAQUE_ID.test(s) || OTHER_KEYS.test(s);
}

function strings(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 32) return out;
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out, depth + 1);
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out.push(k);
      strings(v, out, depth + 1);
    }
  }
  return out;
}

function evidence(receiver: string): ProtectTransferEvidence {
  return {
    evidenceId: 'pe-1', protectKind: 'value-match', ruleId: 'form-leak', frameContext: 'top', attributionConfidence: 'unknown', count: 1, countQuality: 'exact',
    firstSecond: 1, lastSecond: 1, evidenceSource: 'derived', integrity: 'derived', ruleVersion: '1', limitationCodes: [], transferClass: 'third-party-before-submit',
    fieldKind: 'email', encodings: ['sha256-hex'], location: 'query', paramName: 'h', receiver, relation: 'cross-site', method: 'GET', requestKind: 'xhr',
    endpointHost: receiver, endpointPathTemplate: '/fw/collect', submitTiming: 'before-submit', sinceInput: 'lt-1s', deliveryState: 'unknown', interpretationConfidence: 'high',
  };
}

describe('firewall lane keeps domains, enums, numbers and days only (REQ-005, ADR-020 §8)', () => {
  it('DNR rules, IndexedDB, storage.session, projection, rules list and diagnostics', async () => {
    const fake = createFakeChrome({ grantedOrigins: ALL_SITES, permissions: [DNR_PERMISSION] });
    fake.local.data.set('protect', { ...ENABLED_SETTINGS, features: ['value-match', 'firewall'], preset: 'normal' });
    const clock = makeClock(Date.UTC(2026, 9, 18, 9, 0, 0));
    const db = new MemoryProtectDb();
    const service = new FirewallService({ statsFlushMs: 1 });
    const controller = new ProtectController(fake, { clock, dbFactory: () => db, services: [service], dnrTimeoutMs: 50, docStore: { flushMs: 1 }, testProfile: true, tables: EMPTY_PROTECT_TABLES });
    await controller.load();
    controller.onCommitted(committed({ tabId: 7, url: 'https://www.shop.com/checkout?email=' + encodeURIComponent(CANARY), documentId: 'DOCPRIVACY000000000000000000001' }));
    controller.netHub.arm(7);
    const hash = createHash('sha256').update(CANARY).digest('hex');
    let n = 0;
    const req = (host: string, over: Partial<RequestDetailsLike> = {}): RequestDetailsLike => ({
      tabId: 7, frameId: 0, url: 'https://' + host + '/fw/collect?h=' + hash + '&e=' + encodeURIComponent(CANARY), type: 'xmlhttprequest', timeStamp: clock.now(),
      requestId: 'p' + String(++n), initiator: 'https://www.shop.com', method: 'GET', ...over,
    });
    const key = controller.tabModel.topDocumentKey(7)!;
    for (const r of ['tracker.net', 'pixel.org', 'cdn.net', 'auto.net']) controller.eventBus.publish({ kind: 'evidence', documentKey: key, tabId: 7, site: 'shop.com', evidence: evidence(r) });
    await controller.idle();
    // The first request is sent (counted), then decisions of every scope.
    const first = req('collect.tracker.net');
    fake.webRequestEvents.beforeRequest.emit(first);
    fake.webRequestEvents.sendHeaders.emit(first);
    const decide = async (receivers: string[], action: 'block' | 'allow', scope: 'once' | 'site' | 'everywhere'): Promise<UiResponse> => {
      const r = controller.getReport(7)!;
      return controller.routeUi({ schemaVersion: 1, type: 'ui-protect-decide', tabId: 7, documentKey: r.documentKey, protectRevision: r.protectRevision, promptId: r.firewall.prompt!.promptId, receivers, action, scope }, popupSender());
    };
    expect((await decide(['tracker.net'], 'block', 'site')).type).toBe('protect-decision');
    expect((await decide(['pixel.org'], 'block', 'everywhere')).type).toBe('protect-decision');
    expect((await decide(['cdn.net'], 'block', 'once')).type).toBe('protect-decision');
    await controller.routeUi({ schemaVersion: 1, type: 'ui-protect-set-settings', preset: 'strict' }, optionsSender());
    controller.eventBus.publish({ kind: 'evidence', documentKey: key, tabId: 7, site: 'shop.com', evidence: evidence('strict-auto.net') });
    await controller.idle();
    await new Promise((r) => setTimeout(r, 10));
    clock.t += 1000;
    for (const host of ['collect.tracker.net', 'a.pixel.org', 'cdn.net']) {
      const d = req(host);
      fake.webRequestEvents.beforeRequest.emit(d);
      fake.webRequestEvents.errorOccurred.emit({ ...d, error: 'net::ERR_BLOCKED_BY_CLIENT' });
    }
    const bypass = req('collect.tracker.net');
    fake.webRequestEvents.sendHeaders.emit(bypass);
    await service.stop('suspended');
    await controller.docStore.flush();

    const rules = (await controller.routeUi({ schemaVersion: 1, type: 'ui-protect-list-rules', offset: 0, limit: 200 }, optionsSender())) as UiResponse;
    const surfaces: Record<string, unknown> = {
      dnr: { dynamic: [...fake.dnr.dynamic.values()], session: [...fake.dnr.session.values()] },
      idb: Object.fromEntries([...db.stores].map(([name, store]) => [name, [...store.values()].map((e) => e.value)])),
      session: Object.fromEntries([...fake.session.data].filter(([k]) => k.startsWith('protect'))),
      projection: controller.getReport(7),
      rules,
      diagnostics: { service: service.debug(), controller: controller.diagnostics() },
    };
    const text = JSON.stringify(surfaces);
    expect(text).not.toContain(CANARY);
    expect(text).not.toContain(encodeURIComponent(CANARY));
    for (const h of HASHES) expect(text.includes(h), 'hash variant ' + h.slice(0, 8)).toBe(false);
    expect(text).not.toMatch(/https?:|\/\/|\?|fw\/collect|checkout/);
    const decisions = (surfaces['idb'] as Record<string, unknown[]>)['decisions']!;
    expect(decisions.length).toBeGreaterThanOrEqual(3);
    // The scenario really ran: stops were counted, a bypass noticed, a strict decision made.
    expect(service.debug()).toMatchObject({ stopped: 3, bypasses: 1, strictAuto: 1 });
    expect((surfaces['dnr'] as { dynamic: unknown[] }).dynamic.length).toBeGreaterThanOrEqual(2);
    const offending = [...new Set(strings(surfaces))].filter((s) => !allowedString(s) && !/^[A-Za-z][A-Za-z]*$/.test(s));
    expect(offending, 'strings that are not domains, enums, days, rule keys, ids or field names').toEqual([]);
  });
});
