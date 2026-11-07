// ADR-020 §B, §11 (S07): value matching in the SW through the real controller, net-hub and doc-store (fake chrome).
// Direct and reverse matching (token ring, 10 s), opaque-after-input once per change, same-site after submit not
// written, previous documents, Base64 containers, multi-word names (rolling), merging, delivery from the outcome
// tracker, TTL, exclusions, tabId < 0 / extension initiators ignored. Canaries and their hashes never appear in the
// evidence JSON or in storage.session; a path segment that carried a value is `:id` in every endpoint template.

import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROTECT_BUDGETS, templateScriptPath } from '@detect-expert/contracts';
import type { ScriptRef } from '@detect-expert/contracts';
import { pathTemplate } from '../../../attribution/src/index';
import { FirewallService } from '../../src/protect/firewall/index';
import { createValueMatchService } from '../../src/protect/value-match/index';
import { committed } from '../fake-chrome';
import { ALL_SITES, DNR_PERMISSION, ENABLED_SETTINGS, setupController } from './support';
import type { RecordingService } from './support';
import {
  CANARY_EMAIL,
  CANARY_NAME,
  CANARY_PHONE,
  SITE_HOST,
  TOP_DOC,
  commitTop,
  emitRequest,
  emitSent,
  findCanaries,
  hello,
  input,
  pageCtx,
  report,
  request,
  seededRandom,
  settleProtect,
  setupValueMatch,
  sha256Hex,
  transfers,
} from './value-match-support';

const PIXEL = (hex: string): string => 'https://px.tracker.example.net/tr?ev=Lead&ud[em]=' + hex;

describe('direct matching', () => {
  it('pixel with sha256(e-mail) → third-party-before-submit, sha256-hex, ud[em], high; sent after onSendHeaders', async () => {
    const s = await setupValueMatch();
    commitTop(s);
    const ack = await hello(s);
    expect(ack.saltId).toBeDefined();
    await input(s, ack, [{ kind: 'email', value: CANARY_EMAIL }]);
    expect(s.controller.listeners().beforeRequestTabs).toEqual([7]);
    s.clock.t += 400;
    const d = emitRequest(s, request({ url: PIXEL(sha256Hex(CANARY_EMAIL.toLowerCase())), type: 'image' }));
    let ev = transfers(s);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      protectKind: 'value-match',
      ruleId: 'form-leak',
      transferClass: 'third-party-before-submit',
      fieldKind: 'email',
      fieldRef: 1,
      encodings: ['sha256-hex'],
      location: 'query',
      paramName: 'ud[em]',
      receiver: 'example.net',
      relation: 'cross-site',
      method: 'GET',
      requestKind: 'image',
      endpointHost: 'px.tracker.example.net',
      endpointPathTemplate: '/tr',
      initiatorSite: 'shop-site.com',
      submitTiming: 'before-submit',
      sinceInput: 'lt-1s',
      deliveryState: 'unknown',
      interpretationConfidence: 'high',
      evidenceSource: 'derived',
      integrity: 'derived',
      frameContext: 'top',
      attributionConfidence: 'frame-only',
      countQuality: 'lower-bound',
    });
    expect(ev[0]!.limitationCodes).toContain('party-by-registrable-domain');
    emitSent(s, d);
    ev = transfers(s);
    expect(ev.map((e) => e.deliveryState)).toEqual(['sent']);
    expect(ev[0]!.count).toBe(1);
  });

  it('JSON body plain e-mail; the same request twice merges (count 2); a different receiver is a new record', async () => {
    const s = await setupValueMatch();
    commitTop(s);
    const ack = await hello(s);
    await input(s, ack, [{ kind: 'email', value: CANARY_EMAIL }]);
    const body = JSON.stringify({ v: CANARY_EMAIL });
    emitRequest(s, request({ url: 'https://k.collect.example.org/fsink/k', type: 'ping', body }));
    emitRequest(s, request({ url: 'https://k.collect.example.org/fsink/k', type: 'ping', body }));
    emitRequest(s, request({ url: 'https://other.example.com/x', body }));
    const ev = transfers(s);
    expect(ev).toHaveLength(2);
    expect(ev[0]).toMatchObject({ location: 'body-json', paramName: 'v', encodings: ['plain'], requestKind: 'beacon', count: 2, interpretationConfidence: 'high' });
    expect(ev[1]).toMatchObject({ receiver: 'example.com', count: 1 });
  });

  it('URL-encoded query, Base64 container and a multi-word name (rolling window, whole words only)', async () => {
    const s = await setupValueMatch();
    commitTop(s);
    const ack = await hello(s);
    await input(s, ack, [{ kind: 'email', value: CANARY_EMAIL }, { kind: 'name', value: CANARY_NAME, fieldRef: 2 }]);
    emitRequest(s, request({ url: 'https://a.example.org/q?e=' + encodeURIComponent(CANARY_EMAIL) }));
    const container = Buffer.from(JSON.stringify({ user: { email: CANARY_EMAIL } })).toString('base64');
    emitRequest(s, request({ url: 'https://b.example.org/c?d=' + encodeURIComponent(container) }));
    emitRequest(s, request({ url: 'https://c.example.org/n', body: 'note: the customer ' + CANARY_NAME + ' called' }));
    emitRequest(s, request({ url: 'https://d.example.org/n', body: 'x' + CANARY_NAME + 'y' }));
    const ev = transfers(s);
    const encs = ev.map((e) => [e.endpointHost, e.fieldKind, e.encodings, e.location, e.paramName ?? null]);
    expect(encs).toContainEqual(['a.example.org', 'email', ['url-encoded'], 'query', 'e']);
    expect(encs).toContainEqual(['b.example.org', 'email', ['in-base64-container'], 'query', 'd']);
    expect(encs).toContainEqual(['c.example.org', 'name', ['plain'], 'body-text', null]);
    expect(ev.find((e) => e.endpointHost === 'd.example.org'), 'a name glued to other letters is not a whole-word match').toBeUndefined();
    const name = ev.find((e) => e.fieldKind === 'name')!;
    expect(name.interpretationConfidence).toBe('low');
    expect(name.limitationCodes).toContain('name-plaintext-ambiguous');
  });

  it('phone: digits form in a form body, medium with ≥ 10 digits', async () => {
    const s = await setupValueMatch();
    commitTop(s);
    const ack = await hello(s);
    await input(s, ack, [{ kind: 'phone', value: CANARY_PHONE }]);
    emitRequest(s, request({ url: 'https://crm.example.org/lead', form: { tel: ['79125550137'] } }));
    expect(transfers(s)[0]).toMatchObject({ fieldKind: 'phone', location: 'body-form', paramName: 'tel', encodings: ['plain-normalized'], interpretationConfidence: 'low' });
    emitRequest(s, request({ url: 'https://crm2.example.org/lead', form: { tel: [CANARY_PHONE] } }));
    expect(transfers(s).find((e) => e.endpointHost === 'crm2.example.org')).toMatchObject({ encodings: ['plain'], interpretationConfidence: 'medium' });
  });
});

describe('reverse matching through the token ring', () => {
  it('a request before the value: matched-in-recent-request, before-value, its delivery kept; > 10 s ago: nothing', async () => {
    const s = await setupValueMatch();
    commitTop(s);
    const ack = await hello(s);
    await s.controller.onPageMessage(pageCtx(), { schemaVersion: 1, type: 'protect-arm', fieldKind: 'email' });
    const old = emitRequest(s, request({ url: 'https://old.example.org/k', body: JSON.stringify({ v: CANARY_EMAIL }) }));
    emitSent(s, old);
    s.clock.t += PROTECT_BUDGETS.ringWindowMs + 1;
    const recent = emitRequest(s, request({ url: 'https://k.collect.example.org/k', type: 'ping', body: JSON.stringify({ v: CANARY_EMAIL }) }));
    emitSent(s, recent);
    expect(transfers(s)).toEqual([]);
    s.clock.t += 300;
    await input(s, ack, [{ kind: 'email', value: CANARY_EMAIL }]);
    const ev = transfers(s);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ endpointHost: 'k.collect.example.org', sinceInput: 'before-value', deliveryState: 'sent', paramName: 'v', location: 'body-json' });
    expect(ev[0]!.limitationCodes).toContain('matched-in-recent-request');
    // The same value again (rekey re-read): the request is not counted twice.
    await input(s, ack, [{ kind: 'email', value: CANARY_EMAIL, trigger: 'rekey' }]);
    expect(transfers(s)[0]!.count).toBe(1);
  });

  it('requests with credential-named keys and navigations never enter the ring', async () => {
    const s = await setupValueMatch();
    commitTop(s);
    const ack = await hello(s);
    await s.controller.onPageMessage(pageCtx(), { schemaVersion: 1, type: 'protect-arm', fieldKind: 'email' });
    emitRequest(s, request({ url: 'https://k.example.org/login', body: JSON.stringify({ email: CANARY_EMAIL, password: 'x' }) }));
    emitRequest(s, request({ url: 'https://nav.example.org/p?e=' + encodeURIComponent(CANARY_EMAIL), type: 'main_frame', method: 'GET' }));
    expect(s.vm.debug!()['ringEntries']).toBe(0);
    await input(s, ack, [{ kind: 'email', value: CANARY_EMAIL }]);
    expect(transfers(s)).toEqual([]);
  });
});

describe('submit boundaries and documents', () => {
  it('same-site: before submit → first-party-before-submit; after a submit boundary the body is not decoded', async () => {
    const s = await setupValueMatch();
    commitTop(s);
    const ack = await hello(s);
    await input(s, ack, [{ kind: 'email', value: CANARY_EMAIL }]);
    emitRequest(s, request({ url: 'https://' + SITE_HOST + '/api/draft', body: JSON.stringify({ draft: { email: CANARY_EMAIL } }) }));
    expect(transfers(s).map((e) => [e.transferClass, e.paramName, e.relation])).toEqual([['first-party-before-submit', 'draft.email', 'same-site']]);
    s.clock.t += 500;
    await input(s, ack, [], { submit: 'submit-event' });
    const decodedBefore = s.vm.debug!()['decoded'];
    emitRequest(s, request({ url: 'https://' + SITE_HOST + '/api/order', body: JSON.stringify({ email: CANARY_EMAIL }) }));
    expect(s.vm.debug!()['decoded']).toBe(decodedBefore);
    expect(s.vm.debug!()['skippedFirstParty']).toBeGreaterThan(0);
    expect(transfers(s)).toHaveLength(1);
    // A third party after the boundary: at submit.
    emitRequest(s, request({ url: 'https://esp.example.org/subscribe', form: { email: [CANARY_EMAIL] } }));
    expect(transfers(s).find((e) => e.receiver === 'example.org')).toMatchObject({ transferClass: 'third-party-at-submit', submitTiming: 'after-submit', location: 'body-form' });
  });

  it('a cross-site form POST navigation is itself the submit (third-party-at-submit)', async () => {
    const s = await setupValueMatch();
    commitTop(s);
    const ack = await hello(s);
    await input(s, ack, [{ kind: 'email', value: CANARY_EMAIL }]);
    emitRequest(s, request({ url: 'https://esp.example.org/fsink/subscribe', type: 'main_frame', form: { email: [CANARY_EMAIL], list: ['news'] } }));
    expect(transfers(s)[0]).toMatchObject({ transferClass: 'third-party-at-submit', requestKind: 'navigation', paramName: 'email' });
  });

  it('value from the previous document: at-submit after a form POST, ≤ medium, no fieldRef; without a boundary: moment unknown', async () => {
    const s = await setupValueMatch();
    commitTop(s);
    const ack = await hello(s);
    await input(s, ack, [{ kind: 'email', value: CANARY_EMAIL }]);
    emitRequest(s, request({ url: 'https://' + SITE_HOST + '/thank-you', type: 'main_frame', method: 'POST', form: { email: [CANARY_EMAIL] } }));
    commitTop(s, 'https://' + SITE_HOST + '/thank-you', 'DOC000000000000000000000000000002');
    emitRequest(s, request({ url: PIXEL(sha256Hex(CANARY_EMAIL)), type: 'image', documentId: 'DOC000000000000000000000000000002' }));
    const ev = transfers(s);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ transferClass: 'third-party-at-submit', interpretationConfidence: 'medium' });
    expect(ev[0]!.fieldRef).toBeUndefined();
    expect(ev[0]!.limitationCodes).toContain('value-from-previous-document');
    expect(report(s).documentKey).toBe('7:0:DOC000000000000000000000000000002');

    const t = await setupValueMatch();
    commitTop(t);
    const a2 = await hello(t);
    await input(t, a2, [{ kind: 'email', value: CANARY_EMAIL }]);
    commitTop(t, 'https://' + SITE_HOST + '/next', 'DOC000000000000000000000000000003');
    emitRequest(t, request({ url: PIXEL(sha256Hex(CANARY_EMAIL)), type: 'image', documentId: 'DOC000000000000000000000000000003' }));
    expect(transfers(t)[0]).toMatchObject({ transferClass: 'third-party-moment-unknown', submitTiming: 'unknown' });
    expect(transfers(t)[0]!.limitationCodes).toContain('submit-moment-unknown');
  });

  it('a new top-level site keeps the fingerprints only for crossSiteGraceMs', async () => {
    const s = await setupValueMatch();
    commitTop(s);
    const ack = await hello(s);
    await input(s, ack, [{ kind: 'email', value: CANARY_EMAIL }]);
    expect(s.vm.debug!()['fields']).toBe(1);
    s.controller.onCommitted(committed({ tabId: 7, url: 'https://www.other-shop.org/', documentId: 'DOC000000000000000000000000000009' }));
    s.clock.t += PROTECT_BUDGETS.crossSiteGraceMs + 1;
    emitRequest(s, request({ url: PIXEL(sha256Hex(CANARY_EMAIL)), type: 'image', documentId: 'DOC000000000000000000000000000009', initiator: 'https://www.other-shop.org' }));
    expect(s.vm.debug!()['fields']).toBe(0);
    expect(transfers(s)).toEqual([]);
  });

  it('idle TTL: fingerprints go after fingerprintIdleTtlMs', async () => {
    const s = await setupValueMatch();
    commitTop(s);
    const ack = await hello(s);
    await input(s, ack, [{ kind: 'email', value: CANARY_EMAIL }]);
    s.clock.t += PROTECT_BUDGETS.fingerprintIdleTtlMs;
    emitRequest(s, request({ url: PIXEL(sha256Hex(CANARY_EMAIL)), type: 'image' }));
    expect(s.vm.debug!()['fields']).toBe(0);
    expect(transfers(s)).toEqual([]);
  });

  describe('review PT-1: expiry without a further value-match event (lane timer)', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('fingerprints go 15 min after they were written and ring entries 10 s after their request, with no input or request after that', async () => {
      const s = await setupValueMatch();
      commitTop(s);
      const ack = await hello(s);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      await input(s, ack, [{ kind: 'email', value: CANARY_EMAIL }]);
      // A body request of the armed tab: its tokens enter the ring.
      emitRequest(s, request({ url: 'https://k.example.org/k', body: JSON.stringify({ note: 'hello world' }) }));
      expect(s.vm.debug!()['ringEntries']).toBe(1);
      expect(s.vm.debug!()['expiryTimer']).toBe(true);
      // Only time passes: no input, no request, no arm (the tab went quiet; net-hub disarms it).
      const tick = async (ms: number): Promise<void> => {
        s.clock.t += ms;
        await vi.advanceTimersByTimeAsync(ms);
      };
      await tick(PROTECT_BUDGETS.ringWindowMs + 1);
      expect(s.vm.debug!()['ringEntries']).toBe(0);
      expect(s.vm.debug!()['fields']).toBe(1);
      await tick(PROTECT_BUDGETS.fingerprintIdleTtlMs - PROTECT_BUDGETS.ringWindowMs - 1);
      expect(s.vm.debug!()['fields']).toBe(0);
      expect(s.vm.debug!()['documents']).toBe(0);
      expect(s.vm.debug!()['expiryTimer']).toBe(false);
    });

    it('the cross-site grace ends on time without a further event; turning the lane off clears its timer', async () => {
      const s = await setupValueMatch();
      commitTop(s);
      const ack = await hello(s);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      await input(s, ack, [{ kind: 'email', value: CANARY_EMAIL }]);
      s.controller.onCommitted(committed({ tabId: 7, url: 'https://www.other-shop.org/', documentId: 'DOC000000000000000000000000000009' }));
      s.clock.t += PROTECT_BUDGETS.crossSiteGraceMs;
      await vi.advanceTimersByTimeAsync(PROTECT_BUDGETS.crossSiteGraceMs);
      expect(s.vm.debug!()['fields']).toBe(0);
      expect(s.vm.debug!()['expiryTimer']).toBe(false);

      await input(s, ack, [{ kind: 'email', value: CANARY_EMAIL }], { ctx: pageCtx({ documentId: 'DOC000000000000000000000000000009', documentKey: '7:0:DOC000000000000000000000000000009', host: 'www.other-shop.org', originPattern: 'https://www.other-shop.org/*' }) });
      expect(s.vm.debug!()['expiryTimer']).toBe(true);
      const timers = vi.getTimerCount();
      await s.vm.stop('module-off');
      expect(vi.getTimerCount()).toBe(timers - 1);
      expect(s.vm.debug!()['fields']).toBeUndefined();
    });
  });

  it('review round 2: a value typed once goes 15 min after it was written, while other fields of the page keep changing', async () => {
    const s = await setupValueMatch();
    commitTop(s);
    const ack = await hello(s);
    await input(s, ack, [{ kind: 'email', value: CANARY_EMAIL, fieldRef: 1 }]);
    // The user edits another tracked field of the same page every 10 minutes (an SPA document lives for hours).
    for (const name of ['Ivan Petrov', 'Pyotr Ivanov', 'Anna Sidorova', 'Olga Smirnova']) {
      s.clock.t += 10 * 60_000;
      await input(s, ack, [{ kind: 'name', value: name, fieldRef: 2 }]);
    }
    // 40 minutes after the e-mail was typed (never typed again): only the name typed last is in memory.
    expect(s.vm.debug!()['fields']).toBe(1);
    emitRequest(s, request({ url: PIXEL(sha256Hex(CANARY_EMAIL)), type: 'image' }));
    expect(transfers(s)).toEqual([]);
    emitRequest(s, request({ url: PIXEL(sha256Hex('olga smirnova')), type: 'image' }));
    expect(transfers(s).map((e) => e.fieldKind)).toEqual(['name']);
    // The name, too, goes 15 min after it was written.
    s.clock.t += PROTECT_BUDGETS.fingerprintIdleTtlMs;
    emitRequest(s, request({ url: PIXEL(sha256Hex('olga smirnova')), type: 'image' }));
    expect(s.vm.debug!()['fields']).toBe(0);
  });
});

describe('opaque bodies', () => {
  it('gzip to a third party ≤ 2 s after the change: one opaque-after-input (low) per change; later or same-site: none', async () => {
    const s = await setupValueMatch();
    commitTop(s);
    const ack = await hello(s);
    await input(s, ack, [{ kind: 'email', value: CANARY_EMAIL }]);
    const gz = new Uint8Array(gzipSync(Buffer.from(JSON.stringify({ email: CANARY_EMAIL }))));
    s.clock.t += 500;
    emitRequest(s, request({ url: 'https://rec.collect.example.org/fsink/batch', body: gz }));
    emitRequest(s, request({ url: 'https://rec.collect.example.org/fsink/batch', body: gz }));
    emitRequest(s, request({ url: 'https://' + SITE_HOST + '/batch', body: gz }));
    let ev = transfers(s);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ protectKind: 'opaque-after-input', transferClass: 'opaque-after-input', encodings: [], location: 'body-opaque', interpretationConfidence: 'low', sinceInput: 'lt-1s' });
    s.clock.t += PROTECT_BUDGETS.opaqueWindowMs + 1;
    await input(s, ack, [{ kind: 'email', value: CANARY_EMAIL + 'x' }]);
    s.clock.t += PROTECT_BUDGETS.opaqueWindowMs + 1;
    emitRequest(s, request({ url: 'https://rec.collect.example.org/fsink/batch', body: gz }));
    ev = transfers(s);
    expect(ev.reduce((n, e) => n + e.count, 0)).toBe(1);
  });
});

describe('guards and exclusions', () => {
  it('tabId < 0 and extension initiators are ignored by the service itself', async () => {
    const s = await setupValueMatch();
    commitTop(s);
    const ack = await hello(s);
    await input(s, ack, [{ kind: 'email', value: CANARY_EMAIL }]);
    const before = s.vm.debug!()['decoded'];
    const resolved = s.controller.tabModel.resolveRequest(request({ url: PIXEL(sha256Hex(CANARY_EMAIL)) }));
    s.vm.onRequest!(request({ tabId: -1, url: PIXEL(sha256Hex(CANARY_EMAIL)) }), { resolved });
    s.vm.onRequest!(request({ initiator: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop', url: PIXEL(sha256Hex(CANARY_EMAIL)) }), { resolved });
    expect(s.vm.debug!()['decoded']).toBe(before);
    expect(transfers(s)).toEqual([]);
  });

  it('an excluded site: no fingerprints kept, no matching', async () => {
    const s = await setupValueMatch();
    commitTop(s);
    const ack = await hello(s);
    await input(s, ack, [{ kind: 'email', value: CANARY_EMAIL }]);
    const r = await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-set-site', host: SITE_HOST, excluded: true }, { id: 'x', url: 'chrome-extension://x/popup.html' });
    expect(r.type).toBe('protect-state');
    emitRequest(s, request({ url: PIXEL(sha256Hex(CANARY_EMAIL)), type: 'image' }));
    expect(s.vm.debug!()['fields']).toBe(0);
    expect(transfers(s)).toEqual([]);
  });
});

describe('endpoint templates never keep a typed value (review round 1, REQ-005)', () => {
  const NAME1 = 'Vasilchikova';
  const SHORT_EMAIL = 'ivan.petrov@example.com';
  const b64url = (v: string): string => Buffer.from(v, 'utf8').toString('base64url');
  const hashB64 = (algo: string, v: string): string => createHash(algo).update(v, 'utf8').digest('base64').replace(/=+$/, '');

  async function dumps(s: Awaited<ReturnType<typeof setupValueMatch>>): Promise<string[]> {
    await settleProtect(20);
    await s.controller.docStore.flush();
    return [JSON.stringify(transfers(s)), JSON.stringify(report(s)), JSON.stringify([...s.fake.session.data.entries()])];
  }

  it('a single-word name, base64url(e-mail) and unpadded hash Base64 in the path → `:id`', async () => {
    // Literal-looking forms: without the mask each of them would stay in the template.
    for (const literal of [NAME1, b64url(SHORT_EMAIL), hashB64('md5', CANARY_EMAIL.toLowerCase()), hashB64('sha1', CANARY_EMAIL.toLowerCase())]) {
      expect(pathTemplate('https://px.tracker.example.net/u/' + literal), literal).toBe('/u/' + literal);
    }
    const s = await setupValueMatch();
    commitTop(s);
    const ack = await hello(s);
    await input(s, ack, [{ kind: 'name', value: NAME1 }, { kind: 'email', value: SHORT_EMAIL, fieldRef: 2 }, { kind: 'email', value: CANARY_EMAIL, fieldRef: 3 }]);
    emitRequest(s, request({ url: 'https://px.tracker.example.net/u/' + NAME1 }));
    emitRequest(s, request({ url: 'https://px.tracker.example.net/c/' + b64url(SHORT_EMAIL) + '/v1' }));
    emitRequest(s, request({ url: 'https://h1.example.org/h/' + hashB64('md5', CANARY_EMAIL.toLowerCase()) }));
    emitRequest(s, request({ url: 'https://h2.example.org/h/' + hashB64('sha1', CANARY_EMAIL.toLowerCase()) }));
    const ev = transfers(s);
    expect(ev.map((e) => [e.endpointHost, e.fieldKind, e.location, e.pathSegment ?? null, e.endpointPathTemplate])).toEqual([
      ['px.tracker.example.net', 'name', 'path', 1, '/u/:id'],
      ['px.tracker.example.net', 'email', 'path', 1, '/c/:id/v1'],
      ['h1.example.org', 'email', 'path', 1, '/h/:id'],
      ['h2.example.org', 'email', 'path', 1, '/h/:id'],
    ]);
    expect(ev[2]!.encodings).toEqual(['md5-base64']);
    for (const d of await dumps(s)) expect(findCanaries(d, [NAME1, SHORT_EMAIL, CANARY_EMAIL])).toEqual([]);
  });

  it('the segment of another field is masked in every record of the request', async () => {
    const s = await setupValueMatch();
    commitTop(s);
    const ack = await hello(s);
    await input(s, ack, [{ kind: 'name', value: NAME1 }, { kind: 'email', value: CANARY_EMAIL, fieldRef: 2 }]);
    emitRequest(s, request({ url: 'https://px.tracker.example.net/u/' + NAME1 + '/ev?em=' + sha256Hex(CANARY_EMAIL.toLowerCase()), type: 'image' }));
    expect(transfers(s).map((e) => [e.fieldKind, e.location, e.endpointPathTemplate])).toEqual([
      ['name', 'path', '/u/:id/ev'],
      ['email', 'query', '/u/:id/ev'],
    ]);
  });

  it('a value known only after its request: the reverse record and the earlier records of the tab are scrubbed', async () => {
    const s = await setupValueMatch();
    commitTop(s);
    const ack = await hello(s);
    await input(s, ack, [{ kind: 'email', value: CANARY_EMAIL, fieldRef: 2 }]);
    // Older than the ring: only the stored template can still hold the name.
    emitRequest(s, request({ url: 'https://old.example.org/p/' + NAME1 + '?em=' + sha256Hex(CANARY_EMAIL.toLowerCase()), type: 'image' }));
    s.clock.t += PROTECT_BUDGETS.ringWindowMs + 1;
    const recent = emitRequest(s, request({ url: 'https://px.tracker.example.net/u/' + NAME1 + '/x?em=' + sha256Hex(CANARY_EMAIL.toLowerCase()), type: 'image' }));
    expect(transfers(s).map((e) => e.endpointPathTemplate), 'the name is not known yet').toEqual(['/p/' + NAME1, '/u/' + NAME1 + '/x']);
    s.clock.t += 300;
    await input(s, ack, [{ kind: 'name', value: NAME1, fieldRef: 1 }]);
    const rows = (): string[] => transfers(s).map((e) => [e.endpointHost, e.fieldKind, e.location, e.endpointPathTemplate, e.deliveryState].join(' ')).sort();
    expect(rows()).toEqual([
      'old.example.org email query /p/:id unknown',
      'px.tracker.example.net email query /u/:id/x unknown',
      'px.tracker.example.net name path /u/:id/x unknown',
    ]);
    expect(transfers(s).find((e) => e.fieldKind === 'name')).toMatchObject({ pathSegment: 1, sinceInput: 'before-value' });
    expect(s.vm.debug!()['templatesScrubbed']).toBe(2);
    // The outcome still reaches the renamed records of the request.
    emitSent(s, recent);
    expect(rows()).toEqual([
      'old.example.org email query /p/:id unknown',
      'px.tracker.example.net email query /u/:id/x sent',
      'px.tracker.example.net name path /u/:id/x sent',
    ]);
    for (const d of await dumps(s)) {
      expect(findCanaries(d, [NAME1, CANARY_EMAIL])).toEqual([]);
      expect(d).not.toContain(NAME1);
    }
  });
});

describe('parameter names and hosts never keep a typed value (review round 3, REQ-005)', () => {
  const NAME1 = 'Vasilchikova';
  const PHONE_DIGITS = '79125550137';
  const EM = sha256Hex(CANARY_EMAIL.toLowerCase());
  const b64url = (v: string): string => Buffer.from(v, 'utf8').toString('base64url');
  const digestB64url = (algo: string, v: string): string => createHash(algo).update(v, 'utf8').digest('base64url');
  const rows = (s: Awaited<ReturnType<typeof setupValueMatch>>): string[] =>
    transfers(s).map((e) => [e.endpointHost, e.fieldKind, e.location, e.paramName ?? '-', e.endpointPathTemplate].join(' ')).sort();

  async function stored(s: Awaited<ReturnType<typeof setupValueMatch>>): Promise<string[]> {
    await settleProtect(20);
    await s.controller.docStore.flush();
    return [JSON.stringify(transfers(s)), JSON.stringify(report(s)), JSON.stringify([...s.fake.session.data.entries()])];
  }

  /** No variant (findCanaries) and no plain form in any letter case in any stored or projected text. */
  function expectValueFree(texts: readonly string[], values: readonly string[]): void {
    for (const d of texts) {
      expect(findCanaries(d, values)).toEqual([]);
      for (const v of values) expect(d.toLowerCase().includes(v.toLowerCase()), 'holds ' + v.slice(0, 4)).toBe(false);
    }
  }

  async function armed(fields: Parameters<typeof input>[2]): Promise<Awaited<ReturnType<typeof setupValueMatch>>> {
    const s = await setupValueMatch();
    commitTop(s);
    await input(s, await hello(s), fields);
    return s;
  }

  it('a value as a JSON key (probe G): the parameter name is omitted, also upper-cased and glued to a key', async () => {
    const s = await armed([{ kind: 'name', value: NAME1 }, { kind: 'email', value: CANARY_EMAIL, fieldRef: 2 }]);
    emitRequest(s, request({ url: 'https://k1.collect.example.org/k', body: JSON.stringify({ contacts: { [NAME1]: { em: EM } } }) }));
    emitRequest(s, request({ url: 'https://k2.collect.example.org/k', body: JSON.stringify({ [NAME1.toUpperCase()]: EM }) }));
    emitRequest(s, request({ url: 'https://k3.collect.example.org/k', body: JSON.stringify({ ['user_' + NAME1.toLowerCase()]: { em: EM } }) }));
    // Control: an ordinary key path stays.
    emitRequest(s, request({ url: 'https://k4.collect.example.org/k', body: JSON.stringify({ contacts: { user: { em: EM } } }) }));
    expect(rows(s)).toEqual([
      'k1.collect.example.org email body-json - /k',
      'k2.collect.example.org email body-json - /k',
      'k3.collect.example.org email body-json - /k',
      'k4.collect.example.org email body-json user.em /k',
    ]);
    expectValueFree(await stored(s), [NAME1, CANARY_EMAIL]);
  });

  it('a value as a URL-encoded key (query, urlencoded body, formData, Base64 of the value): the parameter name is omitted', async () => {
    const s = await armed([{ kind: 'name', value: NAME1 }, { kind: 'email', value: CANARY_EMAIL, fieldRef: 2 }]);
    emitRequest(s, request({ url: 'https://q.example.org/p?' + NAME1 + '=' + EM, type: 'image' }));
    emitRequest(s, request({ url: 'https://b.example.org/f', body: 'ud[' + NAME1 + ']=' + EM + '&x=1' }));
    emitRequest(s, request({ url: 'https://c.example.org/f', form: { [NAME1 + '_em']: [EM] } }));
    emitRequest(s, request({ url: 'https://d.example.org/f', form: { [b64url(NAME1)]: [EM] } }));
    expect(rows(s)).toEqual([
      'b.example.org email body-form - /f',
      'c.example.org email body-form - /f',
      'd.example.org email body-form - /f',
      'q.example.org email query - /p',
    ]);
    expectValueFree(await stored(s), [NAME1, CANARY_EMAIL]);
  });

  it('a Base64url hash digest as a key (not a matched variant): refused by shape', async () => {
    const s = await armed([{ kind: 'email', value: CANARY_EMAIL }]);
    const md5Key = digestB64url('md5', CANARY_EMAIL.toLowerCase());
    const shaKey = digestB64url('sha256', CANARY_EMAIL.toLowerCase());
    expect([md5Key.length, shaKey.length]).toEqual([22, 43]);
    emitRequest(s, request({ url: 'https://h1.example.org/j', body: JSON.stringify({ [md5Key]: EM }) }));
    emitRequest(s, request({ url: 'https://h2.example.org/j?' + shaKey + '=' + EM, type: 'image' }));
    emitRequest(s, request({ url: 'https://h3.example.org/j', form: { ['d.' + md5Key]: [EM] } }));
    expect(rows(s)).toEqual(['h1.example.org email body-json - /j', 'h2.example.org email query - /j', 'h3.example.org email body-form - /j']);
    const texts = await stored(s);
    expectValueFree(texts, [CANARY_EMAIL]);
    for (const d of texts) for (const k of [md5Key, shaKey]) expect(d.includes(k)).toBe(false);
  });

  it('a value in the endpoint host: the host folds into its registrable domain', async () => {
    const s = await armed([{ kind: 'name', value: NAME1 }, { kind: 'email', value: CANARY_EMAIL, fieldRef: 2 }, { kind: 'phone', value: CANARY_PHONE, fieldRef: 3 }]);
    emitRequest(s, request({ url: 'https://' + NAME1.toLowerCase() + '.tracker.example.org/tr?h=' + EM, type: 'image' }));
    emitRequest(s, request({ url: 'https://u-' + NAME1.toLowerCase() + '-1.px.example.net/tr?h=' + EM, type: 'image' }));
    emitRequest(s, request({ url: 'https://p' + PHONE_DIGITS + '.px.example.com/tr?h=' + EM, type: 'image' }));
    // Control: a host without a value keeps its labels.
    emitRequest(s, request({ url: 'https://px.tracker.example.info/tr?h=' + EM, type: 'image' }));
    expect(rows(s)).toEqual([
      'example.com email query h /tr',
      'example.net email query h /tr',
      'example.org email query h /tr',
      'px.tracker.example.info email query h /tr',
    ]);
    expect(transfers(s).map((e) => e.receiver).sort()).toEqual(['example.com', 'example.info', 'example.net', 'example.org']);
    expectValueFree(await stored(s), [NAME1, CANARY_EMAIL, CANARY_PHONE, PHONE_DIGITS]);
  });

  it('a value known only after its request: reverse records and stored records lose the name and the host label', async () => {
    const s = await setupValueMatch();
    commitTop(s);
    const ack = await hello(s);
    await input(s, ack, [{ kind: 'email', value: CANARY_EMAIL, fieldRef: 2 }]);
    const host = (sub: string): string => NAME1.toLowerCase() + '.' + sub;
    // Older than the ring: only the stored record can still hold the name.
    emitRequest(s, request({ url: 'https://' + host('old.example.org') + '/p?' + NAME1 + '=' + EM, type: 'image' }));
    s.clock.t += PROTECT_BUDGETS.ringWindowMs + 1;
    const recent = emitRequest(s, request({ url: 'https://' + host('px.example.net') + '/u', body: JSON.stringify({ [NAME1]: { em: EM }, fn: NAME1 }) }));
    expect(rows(s), 'the name is not known yet').toEqual([
      host('old.example.org') + ' email query ' + NAME1 + ' /p',
      host('px.example.net') + ' email body-json ' + NAME1 + '.em /u',
    ]);
    s.clock.t += 300;
    await input(s, ack, [{ kind: 'name', value: NAME1, fieldRef: 1 }]);
    expect(rows(s)).toEqual(['example.net email body-json - /u', 'example.net name body-json fn /u', 'example.org email query - /p']);
    expect(transfers(s).find((e) => e.fieldKind === 'name')).toMatchObject({ sinceInput: 'before-value', deliveryState: 'unknown' });
    expect(s.vm.debug!()['templatesScrubbed']).toBe(2);
    // The outcome still reaches the rewritten records of the request.
    emitSent(s, recent);
    expect(transfers(s).filter((e) => e.endpointHost === 'example.net').map((e) => e.deliveryState)).toEqual(['sent', 'sent']);
    expectValueFree(await stored(s), [NAME1, CANARY_EMAIL]);
  });

  it('a value in the sending script reference (S10 port): the record names no script, also when the value arrives later', async () => {
    const s = await setupValueMatch();
    commitTop(s);
    const ack = await hello(s);
    await input(s, ack, [{ kind: 'email', value: CANARY_EMAIL, fieldRef: 2 }]);
    const word = NAME1.toLowerCase();
    const scripts: Record<string, ScriptRef> = {
      path: { kind: 'external', scheme: 'https', host: 'cdn.example.net', pathTemplate: templateScriptPath('/u/' + word + '/t.js') },
      host: { kind: 'external', scheme: 'https', host: word + '.cdn.example.net', pathTemplate: '/t.js' },
      clean: { kind: 'external', scheme: 'https', host: 'cdn.example.net', pathTemplate: '/t.js' },
    };
    expect(scripts['path']!.pathTemplate).toContain(word);
    let current = 'clean';
    (s.controller as unknown as { ports: { attribution: unknown } }).ports.attribution = {
      attributionFor: () => ({ attributionConfidence: 'sampled-stack', script: scripts[current] }),
    };
    const send = (name: string): void => {
      current = name;
      emitRequest(s, request({ url: 'https://' + name + '.example.org/tr?h=' + EM, type: 'image' }));
    };
    const attribution = (): string[] =>
      transfers(s).map((e) => [e.endpointHost, e.attributionConfidence, e.script?.host ?? '-', e.script?.pathTemplate ?? '-'].join(' ')).sort();
    send('path');
    send('clean');
    expect(attribution(), 'the name is not known yet').toEqual([
      'clean.example.org sampled-stack cdn.example.net /t.js',
      'path.example.org sampled-stack cdn.example.net ' + scripts['path']!.pathTemplate,
    ]);
    await input(s, ack, [{ kind: 'name', value: NAME1, fieldRef: 1 }]);
    send('host');
    expect(attribution()).toEqual(['clean.example.org sampled-stack cdn.example.net /t.js', 'host.example.org frame-only - -', 'path.example.org frame-only - -']);
    expectValueFree(await stored(s), [NAME1, CANARY_EMAIL]);
  });
});

describe('privacy', () => {
  it('no canary, hash or encoding variant in the evidence JSON, the projection or storage.session', async () => {
    const s = await setupValueMatch();
    commitTop(s);
    const ack = await hello(s);
    await input(s, ack, [{ kind: 'email', value: CANARY_EMAIL }, { kind: 'phone', value: CANARY_PHONE, fieldRef: 2 }, { kind: 'name', value: CANARY_NAME, fieldRef: 3 }]);
    emitRequest(s, request({ url: PIXEL(sha256Hex(CANARY_EMAIL)) + '&ph=' + sha256Hex('79125550137'), type: 'image' }));
    emitRequest(s, request({ url: 'https://k.collect.example.org/k', body: JSON.stringify({ v: CANARY_EMAIL, n: CANARY_NAME, p: CANARY_PHONE }) }));
    await settleProtect(20);
    await s.controller.docStore.flush();
    expect(transfers(s).length).toBeGreaterThanOrEqual(3);
    const dumps = [JSON.stringify(report(s)), JSON.stringify([...s.fake.session.data.entries()]), JSON.stringify(s.vm.debug!())];
    for (const d of dumps) expect(findCanaries(d, [CANARY_EMAIL, CANARY_PHONE, CANARY_NAME, '79125550137'])).toEqual([]);
    for (const d of dumps) expect(d).not.toMatch(/https?:\/\/[^"]*\?/);
    expect(TOP_DOC.length).toBeGreaterThan(0);
  });
});

describe('review PT-4: a script scrubbed later also leaves the firewall receiver view', () => {
  it('the view copied the sampled script before the name was known; after the name arrives it is frame-only everywhere', async () => {
    const vm = createValueMatchService({ random: seededRandom() });
    const fw = new FirewallService({ statsFlushMs: 1 });
    const base = await setupController({
      chrome: { grantedOrigins: ALL_SITES, permissions: [DNR_PERMISSION] },
      settings: { ...ENABLED_SETTINGS, features: ['value-match', 'firewall'] },
      services: () => [vm as unknown as RecordingService, fw as unknown as RecordingService],
    });
    const s = { ...base, vm };
    commitTop(s);
    const ack = await hello(s);
    await input(s, ack, [{ kind: 'email', value: CANARY_EMAIL, fieldRef: 2 }]);
    const word = 'vasilchikova';
    const script: ScriptRef = { kind: 'external', scheme: 'https', host: 'cdn.example.net', pathTemplate: templateScriptPath('/u/' + word + '/t.js') };
    (s.controller as unknown as { ports: { attribution: unknown } }).ports.attribution = { attributionFor: () => ({ attributionConfidence: 'sampled-stack', script }) };
    emitRequest(s, request({ url: 'https://path.example.org/tr?h=' + sha256Hex(CANARY_EMAIL.toLowerCase()), type: 'image' }));
    await settleProtect(10);
    const view = (): { script?: ScriptRef; attributionConfidence: string } | undefined => report(s).firewall.receivers.find((r) => r.receiver === 'example.org')?.sender;
    expect(view()?.script?.pathTemplate, 'the copy holds the not-yet-known name').toContain(word);
    await input(s, ack, [{ kind: 'name', value: 'Vasilchikova', fieldRef: 1 }]);
    await settleProtect(10);
    expect(view()).toEqual({ frame: 'top', initiatorSite: expect.anything(), attributionConfidence: 'frame-only' });
    await s.controller.docStore.flush();
    for (const d of [JSON.stringify(report(s)), JSON.stringify([...s.fake.session.data.entries()])]) expect(d.toLowerCase()).not.toContain(word);
  });
});
