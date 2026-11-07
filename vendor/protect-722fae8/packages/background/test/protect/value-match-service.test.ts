// ADR-020 §B, §8 (S07): the value-match service — ack with the lane's salt (only while value-match runs), a stale salt
// answered with the new one (the document re-keys), rekey control to documents that held state after a restart,
// limits (≤ 32 documents LRU, ≤ 8 fields per document through the validator), memory cleared on stop / tab close /
// ui-clear-session, never-read / payment notes on the document, numbers-only debug.

import { describe, expect, it } from 'vitest';
import { PROTECT_BUDGETS, SALT_ID_PATTERN, SALT_PATTERN, validateProtectAck } from '@detect-expert/contracts';
import { ProtectController } from '../../src/protect/controller';
import { createValueMatchService } from '../../src/protect/value-match/index';
import { committed, createFakeChrome } from '../fake-chrome';
import { MemoryProtectDb } from './memory-db';
import { ALL_SITES, ENABLED_SETTINGS, makeClock, optionsSender, settleProtect } from './support';
import type { RecordingService } from './support';
import {
  CANARY_EMAIL,
  TOP_DOC,
  commitTop,
  emitRequest,
  hello,
  input,
  pageCtx,
  report,
  request,
  seededRandom,
  setupValueMatch,
  sha256Hex,
  transfers,
} from './value-match-support';

describe('ack and salt', () => {
  it('every page message is answered with the lane salt; the ack validates', async () => {
    const s = await setupValueMatch();
    commitTop(s);
    const ack = await hello(s);
    expect(validateProtectAck(ack).ok).toBe(true);
    expect(SALT_PATTERN.test(ack.salt!)).toBe(true);
    expect(SALT_ID_PATTERN.test(ack.saltId!)).toBe(true);
    const arm = (await s.controller.onPageMessage(pageCtx(), { schemaVersion: 1, type: 'protect-arm', fieldKind: 'email' })) as typeof ack;
    expect([arm.saltId, arm.salt]).toEqual([ack.saltId, ack.salt]);
    const inp = await input(s, ack, [{ kind: 'email', value: CANARY_EMAIL }]);
    expect(inp.salt).toBe(ack.salt);
    expect(s.vm.debug!()).toMatchObject({ fields: 1, documents: 1, tabs: 1, arms: 1, inputs: 1 });
  });

  it('no salt while value-match is off (the document then reads nothing)', async () => {
    const s = await setupValueMatch(['session-replay']);
    commitTop(s);
    const ack = await hello(s);
    expect(ack.active).toBe(true);
    expect(ack.salt).toBeUndefined();
    expect(ack.saltId).toBeUndefined();
  });

  it('a stale saltId: fingerprints ignored, the answer carries the current salt', async () => {
    const s = await setupValueMatch();
    commitTop(s);
    const ack = await hello(s);
    const answer = await input(s, ack, [{ kind: 'email', value: CANARY_EMAIL }], { saltId: 'stale-salt-01' });
    expect(answer.saltId).toBe(ack.saltId);
    expect(s.vm.debug!()).toMatchObject({ fields: 0, staleSalt: 1 });
  });

  it('a new lane (restart) has a new salt and sends rekey to documents that held module state', async () => {
    const fake = createFakeChrome({ grantedOrigins: ALL_SITES });
    fake.local.data.set('protect', { ...ENABLED_SETTINGS, features: ['value-match'] });
    const clock = makeClock();
    const db = new MemoryProtectDb();
    const make = (seed: number) => new ProtectController(fake, { clock, dbFactory: () => db, services: [createValueMatchService({ random: seededRandom(seed) }) as unknown as RecordingService], dnrTimeoutMs: 50, docStore: { flushMs: 1 } });
    const a = make(11);
    await a.load();
    a.onCommitted({ tabId: 7, frameId: 0, url: 'https://www.shop-site.com/', timeStamp: 1, documentId: TOP_DOC, frameType: 'outermost_frame', documentLifecycle: 'active', parentFrameId: -1 });
    const first = (await a.onPageMessage(pageCtx(), { schemaVersion: 1, type: 'protect-hello', startedLate: false })) as { saltId?: string; salt?: string };
    await input({ controller: a } as never, first as never, [{ kind: 'email', value: CANARY_EMAIL }]);
    a.netHub.arm(7);
    fake.webRequestEvents.beforeRequest.emit(request({ url: 'https://px.tracker.example.net/tr?ud[em]=' + sha256Hex(CANARY_EMAIL), type: 'image' }));
    expect(a.getReport(7)?.evidence).toHaveLength(1);
    await settleProtect(10);
    await a.docStore.flush();
    a.stop();
    a.netHub.stopAll();
    fake.sentToTabs.length = 0;
    // "SW restart": a new controller over the same storage.session.
    const b = make(29);
    await b.load();
    const second = (await b.onPageMessage(pageCtx(), { schemaVersion: 1, type: 'protect-hello', startedLate: false })) as { saltId?: string; salt?: string };
    expect(second.salt).not.toBe(first.salt);
    expect(fake.sentToTabs.map((m) => [m.tabId, (m.message as { command?: string }).command, m.options?.documentId])).toContainEqual([7, 'rekey', TOP_DOC]);
    const r = b.getReport(7)!;
    expect(r.evidence).toHaveLength(1);
    expect(r.limitations).toContain('values-reset');
    await input({ controller: b } as never, second as never, [{ kind: 'email', value: CANARY_EMAIL }]);
    expect(b.getReport(7)!.limitations).not.toContain('values-reset');
  });
});

describe('limits and memory', () => {
  it('≤ maxFingerprintDocuments documents (LRU); the evicted tab counts dropped fingerprints', async () => {
    const s = await setupValueMatch();
    commitTop(s);
    const ack = await hello(s);
    for (let i = 0; i <= PROTECT_BUDGETS.maxFingerprintDocuments; i++) {
      s.clock.t += 1000;
      const id = 'DOCX' + String(1000 + i).padStart(29, '0');
      await input(s, ack, [{ kind: 'email', value: 'user' + String(i) + '@example.com' }], { ctx: pageCtx({ frameId: 1 + i, documentId: id, documentKey: '7:' + String(1 + i) + ':' + id }) });
    }
    expect(s.vm.debug!()).toMatchObject({ documents: PROTECT_BUDGETS.maxFingerprintDocuments, evictions: 1 });
    expect(report(s).dropped.fingerprints).toBe(1);
  });

  it('more than maxTrackedFieldsPerDocument fields is refused by the validator (inactive ack, nothing stored)', async () => {
    const s = await setupValueMatch();
    commitTop(s);
    const ack = await hello(s);
    const r = await input(s, ack, [{ kind: 'email', value: CANARY_EMAIL, fieldRef: PROTECT_BUDGETS.maxTrackedFieldsPerDocument + 1 }]);
    expect(r.active).toBe(false);
    expect(s.vm.debug!()['fields']).toBe(0);
  });

  it('tab close, ui-clear-session and turning value-match off clear the lane memory', async () => {
    const s = await setupValueMatch(['value-match', 'session-replay']);
    commitTop(s);
    const ack = await hello(s);
    await input(s, ack, [{ kind: 'email', value: CANARY_EMAIL }]);
    s.controller.onTabRemoved(7);
    expect(s.vm.debug!()['fields']).toBe(0);
    commitTop(s);
    await input(s, ack, [{ kind: 'email', value: CANARY_EMAIL }]);
    await s.controller.clearSession();
    expect(s.vm.debug!()['fields']).toBe(0);
    await input(s, ack, [{ kind: 'email', value: CANARY_EMAIL }]);
    const off = await s.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-set-settings', features: ['session-replay'] }, optionsSender());
    expect(off.type).toBe('protect-state');
    expect(s.controller.serviceDebug('value-match')).toEqual({ running: false, generation: 1 });
    // Documents that held the salt are told to re-key: their next hello has no salt, so they stop reading.
    expect(s.fake.sentToTabs.map((m) => (m.message as { command?: string }).command)).toContain('rekey');
    const again = await hello(s);
    expect(again.salt).toBeUndefined();
  });

  it('never-read fields and a payment suspension become document limitations once', async () => {
    const s = await setupValueMatch();
    commitTop(s);
    const ack = await hello(s);
    await input(s, ack, [], { neverReadFields: 2, paymentSuspended: true });
    await input(s, ack, [], { neverReadFields: 3, paymentSuspended: true });
    expect(report(s).limitations).toEqual(expect.arrayContaining(['values-suspended-payment', 'never-read-fields']));
  });

  it('review COV-01: a payment suspension (fields not read) or dropped fingerprints make an active page partial, never «работает»', async () => {
    const s = await setupValueMatch();
    commitTop(s);
    const ack = await hello(s);
    expect(report(s).coverageState).toBe('active');
    await input(s, ack, [], { paymentSuspended: true });
    expect(report(s)).toMatchObject({ coverageState: 'partial', limitations: expect.arrayContaining(['values-suspended-payment']) });
    // never-read fields alone (passwords, card fields) are expected and do not make the page partial.
    const t = await setupValueMatch();
    commitTop(t);
    const tack = await hello(t);
    await input(t, tack, [], { neverReadFields: 2 });
    expect(report(t).coverageState).toBe('active');
  });

  it('review round 2: a payment field in an embedded cross-site frame suspends that frame only; the page e-mail is still matched', async () => {
    // The page's note (protect_limit_payment_suspended) says exactly this: reading stops in the document that has the
    // payment field (the page or an embedded frame); fields outside that document are read (packages/ui/test/
    // protect-evidence.test.ts checks the wording).
    const s = await setupValueMatch();
    commitTop(s);
    const ack = await hello(s);
    const FRAME_DOC = 'DOC0000000000000000000000000000F9';
    s.controller.onCommitted(committed({ tabId: 7, frameId: 3, parentFrameId: 0, frameType: 'sub_frame', url: 'https://js.pay-frame.org/elements', documentId: FRAME_DOC }));
    const fctx = pageCtx({ frameId: 3, documentId: FRAME_DOC, documentKey: '7:3:' + FRAME_DOC, host: 'js.pay-frame.org', originPattern: 'https://js.pay-frame.org/*' });
    const fack = await hello(s, fctx);
    await input(s, fack, [], { ctx: fctx, paymentSuspended: true, neverReadFields: 1 });
    await input(s, ack, [{ kind: 'email', value: CANARY_EMAIL }]);
    emitRequest(s, request({ url: 'https://px.tracker.example.net/tr?h=' + sha256Hex(CANARY_EMAIL) }));
    expect(report(s).limitations).toEqual(expect.arrayContaining(['values-suspended-payment', 'never-read-fields']));
    expect(transfers(s).map((e) => [e.fieldKind, e.frameContext, e.transferClass])).toEqual([['email', 'top', 'third-party-before-submit']]);
  });

  it('debug is numbers only', async () => {
    const s = await setupValueMatch();
    commitTop(s);
    const ack = await hello(s);
    await input(s, ack, [{ kind: 'email', value: CANARY_EMAIL }]);
    emitRequest(s, request({ url: 'https://k.example.org/k', body: JSON.stringify({ v: CANARY_EMAIL }) }));
    expect(transfers(s)).toHaveLength(1);
    for (const [k, v] of Object.entries(s.vm.debug!())) expect(typeof v === 'number' || typeof v === 'boolean', k).toBe(true);
  });
});
