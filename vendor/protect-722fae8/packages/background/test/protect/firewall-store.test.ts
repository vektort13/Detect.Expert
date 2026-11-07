// ADR-020 §C, §8 (S08): the firewall lane's storage pieces — decisions and statistics in IndexedDB (validation,
// slots, the 5 s write throttle, ≤ 7 days), once rules in the tab model's lane data (limit, cross-site commit,
// replacement, dismissals) and the prompt book (≤ 8 named receivers, hidden, decided receivers give way, notices,
// hydration from the doc-store section).

import { MAX_COUNT, PROTECT_BUDGETS } from '@detect-expert/contracts';
import type { ProtectTransferEvidence } from '@detect-expert/contracts';
import { decisionKeyOf } from '@detect-expert/engine';
import type { FirewallDecision } from '@detect-expert/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProtectDocStore } from '../../src/protect/doc-store';
import { FIREWALL_STATS_KEY, FirewallDecisionStore, FirewallOnceRules, FirewallPromptBook, localDayOf, readDecision } from '../../src/protect/firewall/index';
import { ProtectTabModel } from '../../src/protect/tab-model';
import { committed, createFakeChrome } from '../fake-chrome';
import { MemoryProtectDb } from './memory-db';
import { makeClock } from './support';

const DAY0 = Date.UTC(2026, 9, 18, 9, 0, 0);

function d(receiver: string, slot: number, over: Partial<FirewallDecision> = {}): FirewallDecision {
  const scope = over.scope ?? 'site';
  const site = scope === 'site' ? (over.site ?? 'shop.com') : null;
  return { decisionKey: decisionKeyOf(scope, site, receiver), receiver, site, scope, action: 'block', origin: 'user', slot, createdDay: '2026-10-18', stopped: 0, bypass: 0, ...over };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('FirewallDecisionStore', () => {
  it('readDecision accepts only well-formed records whose key matches their fields', () => {
    expect(readDecision(d('tracker.net', 0))).toEqual(d('tracker.net', 0));
    expect(readDecision({ ...d('tracker.net', 0), decisionKey: 'site:other.com>tracker.net' })).toBeNull();
    expect(readDecision({ ...d('tracker.net', 0), slot: PROTECT_BUDGETS.maxDecisions })).toBeNull();
    expect(readDecision({ ...d('tracker.net', 0), action: 'redirect' })).toBeNull();
    expect(readDecision({ ...d('tracker.net', 0), createdDay: '1970-01-01' })).toBeNull();
    expect(readDecision({ ...d('Tracker.net', 0) })).toBeNull();
    expect(readDecision({ ...d('tracker.net', 0, { scope: 'everywhere' }), site: 'shop.com' })).toBeNull();
    expect(readDecision({ ...d('tracker.net', 0), stopped: -5, bypass: 1e20 })).toMatchObject({ stopped: 0, bypass: 0 });
    expect(readDecision({ ...d('tracker.net', 0), stopped: MAX_COUNT + 1 })?.stopped, 'saturating').toBe(MAX_COUNT);
  });

  it('load skips broken and duplicate-slot records; slots are reused lowest first', async () => {
    const db = new MemoryProtectDb();
    await db.open();
    await db.putMany('decisions', [d('a.net', 0), d('b.net', 0), d('c.net', 2), { decisionKey: 'x', receiver: 'y' }]);
    const store = new FirewallDecisionStore(makeClock(DAY0));
    expect(await store.load(db)).toBe(true);
    expect(store.size).toBe(2);
    expect(store.debugCounts.dropped).toBe(2);
    expect(store.freeSlots(3)).toEqual([1, 3, 4]);
    await store.apply([d('e.net', 1)], ['site:shop.com>a.net']);
    expect(store.freeSlots(1)).toEqual([0]);
    expect(store.get('site:shop.com>e.net')?.slot).toBe(1);
  });

  it('a failing database: load false (memory only), apply throws (storage-unavailable for the UI)', async () => {
    const db = new MemoryProtectDb();
    db.failNext = 1;
    const store = new FirewallDecisionStore(makeClock(DAY0));
    expect(await store.load(db)).toBe(false);
    expect(store.size).toBe(0);
    expect(await store.load(null)).toBe(false);
    await expect(store.apply([d('a.net', 0)], [])).rejects.toThrow();
  });

  it('counters and statistics are written at most once per statsFlushMs; ≤ maxStatDays days, newest first', async () => {
    vi.useFakeTimers();
    const clock = makeClock(DAY0);
    const db = new MemoryProtectDb();
    await db.open();
    await db.put('decisions', d('a.net', 0));
    const store = new FirewallDecisionStore(clock);
    await store.load(db);
    const writes = (): number => db.ops;
    store.noteStopped('site:shop.com>a.net', '2026-10-18');
    await vi.advanceTimersByTimeAsync(1);
    const after1 = writes();
    store.noteStopped('site:shop.com>a.net', '2026-10-18');
    store.noteBypass('site:shop.com>a.net');
    await vi.advanceTimersByTimeAsync(1000);
    expect(writes(), 'no second write inside 5 s').toBe(after1);
    clock.t += PROTECT_BUDGETS.statsFlushMs;
    await vi.advanceTimersByTimeAsync(PROTECT_BUDGETS.statsFlushMs);
    expect(writes()).toBeGreaterThan(after1);
    const stored = await db.get<FirewallDecision>('decisions', 'site:shop.com>a.net');
    expect([stored?.stopped, stored?.bypass]).toEqual([2, 1]);
    for (let i = 0; i < 10; i++) store.noteStopped(null, '2026-10-' + String(10 + i));
    expect(store.stoppedDays()).toHaveLength(PROTECT_BUDGETS.maxStatDays);
    expect(store.stoppedDays()[0]!.day).toBe('2026-10-19');
    await store.flush();
    const stats = await db.get<{ key: string; days: unknown[] }>('meta', FIREWALL_STATS_KEY);
    expect(stats?.days).toHaveLength(PROTECT_BUDGETS.maxStatDays);
    expect(JSON.stringify(stats)).toMatch(/^[{}\[\]":,a-z0-9.\-]+$/i); // domains, days, numbers only
  });

  it('strict usage is per local day and per site', async () => {
    const store = new FirewallDecisionStore(makeClock(DAY0));
    await store.load(null);
    store.noteStrictAuto('2026-10-18', 'a.com');
    store.noteStrictAuto('2026-10-18', 'a.com');
    store.noteStrictAuto('2026-10-18', 'b.com');
    expect(store.strictUsage('2026-10-18', 'a.com')).toEqual({ total: 3, site: 2 });
    expect(store.strictUsage('2026-10-19', 'a.com')).toEqual({ total: 0, site: 0 });
    store.noteStrictAuto('2026-10-19', 'a.com');
    expect(store.strictUsage('2026-10-19', 'a.com')).toEqual({ total: 1, site: 1 });
    expect(localDayOf(DAY0)).toMatch(/^2026-10-1[789]$/);
  });
});

describe('FirewallOnceRules', () => {
  function model(): ProtectTabModel {
    const m = new ProtectTabModel(makeClock(DAY0));
    m.noteCommitted(committed({ tabId: 7, url: 'https://www.shop.com/', documentId: 'DOCA' }));
    m.noteCommitted(committed({ tabId: 8, url: 'https://news.org/', documentId: 'DOCB' }));
    return m;
  }

  it('sets, replaces and removes once decisions; metadata in the lane data survives a reload', () => {
    const m = model();
    const once = new FirewallOnceRules(m);
    expect(once.set(7, 'shop.com', ['a.net', 'b.net'], 'block')).toEqual([
      { receiver: 'a.net', before: null, after: 'block' },
      { receiver: 'b.net', before: null, after: 'block' },
    ]);
    expect(once.set(7, 'shop.com', ['a.net'], 'allow')).toEqual([{ receiver: 'a.net', before: 'block', after: 'allow' }]);
    expect(once.forTab(7).map((o) => [o.slot, o.receiver, o.action])).toEqual([[0, 'a.net', 'allow'], [1, 'b.net', 'block']]);
    const reloaded = new FirewallOnceRules(m);
    reloaded.load();
    expect(reloaded.all()).toEqual(once.all());
    expect(once.set(7, 'shop.com', ['b.net'], null)).toEqual([{ receiver: 'b.net', before: 'block', after: null }]);
    expect(once.size).toBe(1);
  });

  it('at most maxSessionRules: the request that does not fit changes nothing', () => {
    const m = model();
    const once = new FirewallOnceRules(m);
    for (let i = 0; i < PROTECT_BUDGETS.maxSessionRules; i++) expect(once.set(7, 'shop.com', ['r' + String(i) + '.net'], 'block')).not.toBeNull();
    expect(once.set(8, 'news.org', ['x.net'], 'block')).toBeNull();
    expect(once.size).toBe(PROTECT_BUDGETS.maxSessionRules);
    expect(once.forTab(8)).toEqual([]);
  });

  it('cross-site commit removes; same site keeps; tab replacement moves with the same site; dismissals per tab', () => {
    const m = model();
    const once = new FirewallOnceRules(m);
    once.set(7, 'shop.com', ['a.net'], 'block');
    once.dismiss(7, 'shop.com');
    expect(once.onCommitted(7, 'shop.com')).toBe(false);
    m.noteReplaced(12, 7);
    expect(once.onTabGone(7)).toBe(true);
    expect(once.forTab(12).map((o) => o.receiver)).toEqual(['a.net']);
    expect(once.isDismissed(12, 'shop.com')).toBe(true);
    expect(once.onCommitted(12, 'other.org')).toBe(true);
    expect(once.size).toBe(0);
    once.set(8, 'news.org', ['b.net'], 'block');
    m.noteRemoved(8);
    expect(once.onTabGone(8)).toBe(true);
    expect(once.size).toBe(0);
  });
});

describe('FirewallPromptBook', () => {
  function ev(receiver: string, over: Partial<ProtectTransferEvidence> = {}): ProtectTransferEvidence {
    return {
      evidenceId: 'pe-1', protectKind: 'value-match', ruleId: 'form-leak', frameContext: 'cross-site-frame', frameSite: 'frame.org', attributionConfidence: 'sampled-stack',
      script: { kind: 'external', scheme: 'https', host: 'cdn.example.org', pathTemplate: '/fw.js' }, count: 1, countQuality: 'exact', firstSecond: 0, lastSecond: 0,
      evidenceSource: 'derived', integrity: 'derived', ruleVersion: '1', limitationCodes: [], transferClass: 'third-party-before-submit', fieldKind: 'email',
      encodings: ['sha256-hex', 'md5-hex', 'plain', 'base64', 'sha1-hex'], receiver, relation: 'cross-site', method: 'POST', requestKind: 'beacon', endpointHost: receiver,
      endpointPathTemplate: '/c', initiatorSite: 'frame.org', submitTiming: 'before-submit', sinceInput: 'lt-1s', deliveryState: 'unknown', interpretationConfidence: 'high', ...over,
    };
  }

  function setupBook(): { book: FirewallPromptBook; docs: ProtectDocStore } {
    const fake = createFakeChrome();
    const docs = new ProtectDocStore(fake.session, makeClock(DAY0), () => true, { flushMs: 1 });
    return { book: new FirewallPromptBook(docs, 1), docs };
  }

  it('receiver view from evidence: canonical field kinds and ≤ 4 encodings, sender with a sampled script only', () => {
    const { book } = setupBook();
    const s = book.state(7, '7:0:DOCA', 'shop.com');
    book.noteEvidence(s, ev('tracker.net'));
    book.noteEvidence(s, ev('tracker.net', { fieldKind: 'phone', attributionConfidence: 'frame-only' }));
    const view = s.receivers.get('tracker.net')!;
    expect(view.fieldKinds).toEqual(['email', 'phone']);
    expect(view.encodings).toEqual(['plain', 'base64', 'md5-hex', 'sha1-hex']);
    expect(view.sender).toEqual({ frame: 'subframe', initiatorSite: 'frame.org', attributionConfidence: 'frame-only' });
    expect(view.countQuality).toBe('lower-bound');
    expect(JSON.stringify(view)).not.toMatch(/https?:|\?|=/);
  });

  it('≤ 8 named receivers, the rest hidden; a decided receiver gives way; a new id on every change', () => {
    const { book } = setupBook();
    const s = book.state(7, '7:0:DOCA', 'shop.com');
    for (let i = 0; i < 8; i++) book.addToPrompt(s, ['r' + String(i) + '.net']);
    const id = s.prompt!.promptId;
    expect(book.addToPrompt(s, ['r0.net'])).toBe(false);
    expect(s.prompt!.promptId).toBe(id);
    book.addToPrompt(s, ['r8.net']);
    expect(s.prompt!.hidden).toBe(1);
    expect(s.prompt!.promptId).not.toBe(id);
    book.addToPrompt(s, ['r9.net'], (r) => r === 'r3.net');
    expect(s.prompt!.receivers).not.toContain('r3.net');
    expect(s.prompt!.receivers).toContain('r9.net');
    expect(s.prompt!.hidden).toBe(1);
    book.removeFromPrompt(s, s.prompt!.receivers);
    expect(s.prompt).toBeNull();
  });

  it('notices bounded and replaced per kind and receiver; delivery counters by label suffix', () => {
    const { book } = setupBook();
    const s = book.state(7, '7:0:DOCA', 'shop.com');
    for (let i = 0; i < 12; i++) book.addNotice(s, { kind: 'bypass', receiver: 'r' + String(i) + '.net', count: 1 });
    book.addNotice(s, { kind: 'bypass', receiver: 'r11.net', count: 5 });
    expect(s.notices).toHaveLength(PROTECT_BUDGETS.maxNoticesPerTab);
    expect(s.notices.at(-1)).toEqual({ kind: 'bypass', receiver: 'r11.net', count: 5 });
    book.noteEvidence(s, ev('tracker.net'));
    expect(book.receiverOfHost(7, 'a.b.tracker.net')).toBe('tracker.net');
    expect(book.receiverOfHost(7, 'nottracker.net')).toBeNull();
    expect(book.countDelivery(7, 'tracker.net', 'sent')).toBe(true);
    expect(book.countDelivery(7, 'tracker.net', 'stopped')).toBe(true);
    expect(book.countDelivery(7, 'unknown.net', 'sent')).toBe(false);
    expect(s.receivers.get('tracker.net')).toMatchObject({ delivery: { sent: 1, stopped: 0 + 1, stoppedOther: 0, unknown: 0 }, lastDelivery: 'stopped' });
  });

  it('persists into the document section and hydrates after a restart; another site resets the tab state', () => {
    const { book, docs } = setupBook();
    const s = book.state(7, '7:0:DOCA', 'shop.com');
    book.noteEvidence(s, ev('tracker.net'));
    book.addToPrompt(s, ['tracker.net']);
    book.flush();
    expect(docs.doc('7:0:DOCA')?.firewall.prompt?.receivers).toEqual(['tracker.net']);
    const again = new FirewallPromptBook(docs, 1).state(7, '7:0:DOCA', 'shop.com');
    expect(again.prompt?.promptId).toBe(s.prompt!.promptId);
    expect(again.receivers.get('tracker.net')?.effectiveRule).toBeNull();
    expect(book.state(7, '7:0:DOCB', 'other.org').prompt).toBeNull();
  });
});
