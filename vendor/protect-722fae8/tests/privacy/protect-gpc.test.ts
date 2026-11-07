// ADR-020 §H, §4, REQ-005 (S13): of the request headers the GPC lane reads only Sec-GPC. Requests whose Cookie,
// Authorization and Referer headers and URLs carry canaries go through the real controller and lane: no canary, URL,
// query or header value reaches the DNR rule, storage.session, the projection or the diagnostics; through Proxy
// headers, `value` is read only for Sec-GPC; the lane's sources name no other header.

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { GPC_HEADER_EVIDENCE, GPC_SITE_STATES, isSiteName } from '@detect-expert/contracts';
import { describe, expect, it } from 'vitest';
import type { RequestDetailsLike } from '../../packages/background/src/chrome-api';
import { ProtectController } from '../../packages/background/src/protect/controller';
import { GpcService } from '../../packages/background/src/protect/gpc/index';
import { committed, createFakeChrome } from '../../packages/background/test/fake-chrome';
import { MemoryProtectDb } from '../../packages/background/test/protect/memory-db';
import { ALL_SITES, DNR_PERMISSION, ENABLED_SETTINGS, makeClock, popupSender } from '../../packages/background/test/protect/support';

const CANARIES = ['CANARY-COOKIE-6f2a91', 'CANARY-AUTH-b81c40', 'CANARY-REFERER-3d7e55', 'CANARY-QUERY-9a0c12', 'gpc-canary-41@example.com'];
const ENUMS = new Set<string>([...GPC_SITE_STATES, ...GPC_HEADER_EVIDENCE, 'exact', 'lower-bound', 'browser-network', 'browser-observed', 'modifyHeaders', 'set', 'Sec-GPC', '1',
  'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'other']);
const OPAQUE = /^(?:\d+:\d+:[A-Za-z0-9_-]{1,64}|protect-doc:\d+:\d+:[A-Za-z0-9_-]{1,64}|protect-tabs|protect-runtime|[0-9a-f]{8}:\d+|DOC[0-9A-Z]+)$/;

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

function headers(gpc: boolean): Array<{ name: string; value: string }> {
  const list = [
    { name: 'Cookie', value: 'sid=' + CANARIES[0]! },
    { name: 'Authorization', value: 'Bearer ' + CANARIES[1]! },
    { name: 'Referer', value: 'https://www.shop.com/checkout?ref=' + CANARIES[2]! + '&email=' + encodeURIComponent(CANARIES[4]!) },
    { name: 'User-Agent', value: 'Mozilla/5.0' },
  ];
  if (gpc) list.push({ name: 'Sec-GPC', value: '1' });
  return list;
}

describe('GPC lane keeps no header value, URL or query (REQ-005, ADR-020 §4)', () => {
  it('DNR rule, storage.session, projection and diagnostics after canary requests', async () => {
    const fake = createFakeChrome({ grantedOrigins: ALL_SITES, permissions: [DNR_PERMISSION] });
    fake.local.data.set('protect', { ...ENABLED_SETTINGS, features: ['gpc'] });
    const clock = makeClock();
    const service = new GpcService({ flushMs: 1 });
    const controller = new ProtectController(fake, { clock, dbFactory: () => new MemoryProtectDb(), services: [service], dnrTimeoutMs: 50, docStore: { flushMs: 1 } });
    await controller.load();
    await controller.routeUi({ schemaVersion: 1, type: 'ui-protect-set-site', host: 'excluded.org', excluded: true }, popupSender());
    let n = 0;
    const req = (over: Partial<RequestDetailsLike>): RequestDetailsLike => ({
      tabId: 7, frameId: 0, url: 'https://www.shop.com/checkout?q=' + CANARIES[3]! + '&email=' + encodeURIComponent(CANARIES[4]!), type: 'xmlhttprequest',
      timeStamp: 1, requestId: 'pg' + String(++n), method: 'GET', initiator: 'https://www.shop.com', requestHeaders: headers(true), ...over,
    });
    fake.webRequestEvents.sendHeaders.emit(req({ type: 'main_frame', initiator: undefined }));
    controller.onCommitted(committed({ tabId: 7, url: 'https://www.shop.com/checkout?q=' + CANARIES[3]!, documentId: 'DOCPRIVGPC00000000000000000001' }));
    for (const type of ['sub_frame', 'xmlhttprequest', 'ping', 'image']) fake.webRequestEvents.sendHeaders.emit(req({ type }));
    fake.webRequestEvents.sendHeaders.emit(req({ requestHeaders: headers(false) }));
    fake.webRequestEvents.sendHeaders.emit(req({ url: 'https://cdn.excluded.org/p?x=' + CANARIES[3]!, requestHeaders: headers(false) }));
    await new Promise((r) => setTimeout(r, 20));
    service.flush();
    await controller.docStore.flush();
    const surfaces = {
      dnr: [...fake.dnr.dynamic.values()],
      session: Object.fromEntries([...fake.session.data].filter(([k]) => k.startsWith('protect'))),
      projection: controller.getReport(7),
      diagnostics: { service: service.debug(), controller: controller.diagnostics() },
    };
    // The scenario really ran: a fact with counts exists and was stored.
    expect(surfaces.projection?.gpc).toMatchObject({ navigationHeader: 'observed', requestsWithHeader: 3, requestsWithoutHeader: 1 });
    expect(JSON.stringify(surfaces.session)).toContain('"requestsWithHeader":3');
    const text = JSON.stringify(surfaces);
    for (const c of CANARIES) {
      expect(text.includes(c), c).toBe(false);
      expect(text.includes(encodeURIComponent(c)), c).toBe(false);
    }
    expect(text).not.toMatch(/https?:\/\/|\?|checkout|Bearer|Cookie|Authorization|Referer|Mozilla/i);
    const offending = [...new Set(strings(surfaces))].filter((s) => !ENUMS.has(s) && !isSiteName(s) && !OPAQUE.test(s) && !/^[A-Za-z][A-Za-z]*$/.test(s));
    expect(offending, 'strings that are not enums, site names, ids or field names').toEqual([]);
    controller.stop();
  });

  it('through Proxy headers in the lane, `value` is read only for Sec-GPC', async () => {
    const fake = createFakeChrome({ grantedOrigins: ALL_SITES, permissions: [DNR_PERMISSION] });
    fake.local.data.set('protect', { ...ENABLED_SETTINGS, features: ['gpc'] });
    const service = new GpcService({ flushMs: 1 });
    const controller = new ProtectController(fake, { clock: makeClock(), dbFactory: () => new MemoryProtectDb(), services: [service], dnrTimeoutMs: 50, docStore: { flushMs: 1 } });
    await controller.load();
    controller.onCommitted(committed({ tabId: 7, url: 'https://www.shop.com/', documentId: 'DOCPRIVGPC00000000000000000002' }));
    const reads: string[] = [];
    const proxied = (gpc: boolean) => headers(gpc).map((h) => new Proxy(h, {
      get(target, key, receiver) {
        reads.push(h.name + '.' + String(key));
        return Reflect.get(target, key, receiver) as unknown;
      },
    }));
    for (const gpc of [true, false]) {
      for (const type of ['main_frame', 'xmlhttprequest', 'ping', 'sub_frame']) {
        fake.webRequestEvents.sendHeaders.emit({ tabId: 7, frameId: 0, url: 'https://api.shop.com/x', type, timeStamp: 1, initiator: 'https://www.shop.com', requestHeaders: proxied(gpc) });
      }
    }
    expect(reads.length).toBeGreaterThan(0);
    const values = reads.filter((r) => r.endsWith('.value'));
    expect(new Set(values)).toEqual(new Set(['Sec-GPC.value']));
    expect(reads.filter((r) => !r.endsWith('.name') && !r.endsWith('.value'))).toEqual([]);
    controller.stop();
  });

  it('the lane names no header but Sec-GPC (sources of packages/background/src/protect/gpc)', () => {
    const dir = resolve('packages/background/src/protect/gpc');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const code = readFileSync(join(dir, file), 'utf8').replace(/\/\/.*$/gm, '');
      for (const name of ['cookie', 'authorization', 'referer', 'user-agent', 'set-cookie', 'extraHeaders']) {
        expect(code.toLowerCase().includes("'" + name + "'"), file + ' names ' + name).toBe(false);
      }
    }
  });
});
