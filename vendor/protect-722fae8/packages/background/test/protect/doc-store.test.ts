import { PROTECT_BUDGETS } from '@detect-expert/contracts';
import type { ProtectTransferEvidence } from '@detect-expert/contracts';
import { describe, expect, it } from 'vitest';
import { PROTECT_DOC_PREFIX, PROTECT_DOC_TTL_MS, PROTECT_RUNTIME_KEY, PROTECT_TABS_KEY, ProtectDocStore } from '../../src/protect/doc-store';
import { createFakeChrome } from '../fake-chrome';
import { makeClock, settleProtect } from './support';

const KEY = '7:0:DOC1';

function ev(param: string, over: Partial<ProtectTransferEvidence> = {}): ProtectTransferEvidence {
  return {
    evidenceId: 'pe-1', frameContext: 'top', attributionConfidence: 'unknown', count: 1, countQuality: 'exact', firstSecond: 0, lastSecond: 0,
    evidenceSource: 'derived', integrity: 'derived', ruleVersion: '1', limitationCodes: [], protectKind: 'value-match', ruleId: 'form-leak',
    transferClass: 'third-party-before-submit', fieldKind: 'email', encodings: ['sha256-hex'], location: 'body-json', paramName: param,
    receiver: 'example.net', relation: 'cross-site', method: 'POST', requestKind: 'xhr', endpointHost: 'collect.example.net',
    endpointPathTemplate: '/v1/collect', submitTiming: 'before-submit', deliveryState: 'unknown', interpretationConfidence: 'high', ...over,
  };
}

function setup(active: (key: string) => boolean = () => false, options = {}) {
  const fake = createFakeChrome();
  const clock = makeClock();
  const store = new ProtectDocStore(fake.session, clock, active, { flushMs: 1, ...options });
  return { fake, clock, store };
}

describe('ProtectDocStore (storage.session, ADR-020 §8)', () => {
  it('debounced write of the document, the index and the runtime record; nothing before the first change', async () => {
    const { fake, store } = setup();
    await store.hydrate();
    expect(fake.session.setCalls).toEqual([]);
    store.addEvidence(KEY, 7, ev('em'));
    store.updateRuntime((cur) => ({ ...cur, dnr: { gpc: 'abc:1' } }));
    await settleProtect(10);
    expect(fake.session.data.get(PROTECT_DOC_PREFIX + KEY)).toMatchObject({ v: 1, tabId: 7, protectRevision: 1, evidence: [{ paramName: 'em' }] });
    expect(fake.session.data.get(PROTECT_TABS_KEY)).toMatchObject({ v: 1, docs: [KEY] });
    expect(fake.session.data.get(PROTECT_RUNTIME_KEY)).toMatchObject({ v: 1, dnr: { gpc: 'abc:1' } });
    // A new store (SW restart) hydrates the same state.
    const again = new ProtectDocStore(fake.session, makeClock(), () => false);
    await again.hydrate();
    expect(again.doc(KEY)?.evidence).toHaveLength(1);
    expect(again.runtime().dnr).toEqual({ gpc: 'abc:1' });
  });

  it('each lane writes its own section; revision increases', () => {
    const { store } = setup();
    store.update(KEY, 7, 'gpc', () => ({ site: 'shop-site.com', siteState: 'on', navigationHeader: 'observed', requestsWithHeader: 1, requestsWithoutHeader: 0, countQuality: 'lower-bound', propertyAtLoad: true, reloadNeeded: false, evidenceSource: 'browser-network', integrity: 'browser-observed' }));
    store.addLimitations(KEY, 7, ['late-start', 'body-truncated', 'late-start']);
    const doc = store.doc(KEY);
    expect(doc?.gpc?.siteState).toBe('on');
    expect(doc?.limitations).toEqual(['body-truncated', 'late-start']);
    expect(doc?.protectRevision).toBe(2);
    expect(store.update('not a key', 7, 'evidence', (e) => e)).toBeNull();
  });

  it('≤ maxProtectDocBytes by a counted estimate: oldest evidence is shed with budget-exceeded', () => {
    const { store } = setup(() => false, { maxDocBytes: 4000 });
    for (let i = 0; i < 20; i++) store.addEvidence(KEY, 7, ev('p' + String(i)));
    const doc = store.doc(KEY)!;
    expect(JSON.stringify(doc).length).toBeLessThanOrEqual(4000);
    expect(doc.evidence.length).toBeLessThan(20);
    expect(doc.dropped.evidence).toBe(20 - doc.evidence.length);
    expect(doc.limitations).toContain('budget-exceeded');
    expect((doc.evidence.at(-1) as ProtectTransferEvidence).paramName).toBe('p19');
  });

  it('module total: the oldest inactive documents are evicted, never a current top-level document', () => {
    const active = new Set(['1:0:A']);
    const { store, clock } = setup((k) => active.has(k), { maxSessionBytes: 3000 });
    store.addEvidence('1:0:A', 1, ev('a'));
    for (let i = 0; i < 6; i++) {
      clock.t += 1;
      store.addEvidence(String(10 + i) + ':0:D', 10 + i, ev('x'));
    }
    expect(store.doc('1:0:A')).toBeDefined();
    expect(store.doc('10:0:D')).toBeUndefined();
    expect(store.debug().bytes).toBeLessThanOrEqual(3000);
  });

  it('cleanup: tab close, TTL of inactive documents, clearDocs (ui-clear-session), clearAll (disable/purge)', async () => {
    const active = new Set<string>(['8:0:B']);
    const { fake, store, clock } = setup((k) => active.has(k));
    store.addEvidence('7:0:A', 7, ev('a'));
    store.addEvidence('7:2:F', 7, ev('f'));
    store.addEvidence('8:0:B', 8, ev('b'));
    store.addEvidence('9:0:C', 9, ev('c'));
    store.forgetTab(7);
    expect(store.size).toBe(2);
    clock.t += PROTECT_DOC_TTL_MS;
    expect(store.sweep(true)).toBe(1);
    expect(store.doc('8:0:B')).toBeDefined();
    await store.flush();
    expect([...fake.session.data.keys()].sort()).toEqual([PROTECT_DOC_PREFIX + '8:0:B', PROTECT_TABS_KEY]);
    store.setTabs([{ tabId: 8 }]);
    await store.clearDocs();
    expect([...fake.session.data.keys()]).toEqual([PROTECT_TABS_KEY]);
    store.updateRuntime((cur) => cur);
    await store.flush();
    fake.session.data.set('doc:7:0:X', { observation: true });
    await store.clearAll();
    expect([...fake.session.data.keys()]).toEqual(['doc:7:0:X']);
  });

  it('a storage failure is retried once after evicting inactive documents; never an endless retry', async () => {
    const { fake, store } = setup();
    store.addEvidence('1:0:A', 1, ev('a'));
    store.addEvidence('2:0:B', 2, ev('b'));
    store.addEvidence('3:0:C', 3, ev('c'));
    fake.session.failNextSets = 5;
    await store.flush();
    expect(fake.session.failNextSets).toBe(3);
    expect(store.debug().failures).toBe(2);
    expect(PROTECT_BUDGETS.maxProtectSessionBytes).toBe(1048576);
  });
});
