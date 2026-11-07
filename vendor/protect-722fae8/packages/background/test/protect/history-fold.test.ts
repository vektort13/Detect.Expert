// ADR-020 §G (S12): folding persisted observation reports and module events into history deltas — top site through the
// parentDocumentId chain, frame-only families of third-party frames, skips (lifecycle, pause, host, exclusion,
// unresolved), the fold memo, and the accumulator bound.

import { describe, expect, it } from 'vitest';
import type { DocumentReport, HostEntry, ProtectEvidence, ProtectTransferEvidence } from '@detect-expert/contracts';
import { HISTORY_SIGNAL_BITS, applyHistorySightingDelta, historyMechanisms, requestSightingSentDay } from '@detect-expert/engine';
import type { FrameBinding } from '../../src/documents';
import type { ProtectEvent } from '../../src/protect/event-bus';
import { HistoryAccumulator } from '../../src/protect/history/accumulator';
import { HistoryAwaitingSends, MAX_PARKED_PER_REQUEST } from '../../src/protect/history/awaiting';
import { HISTORY_TOP_SITE_STEPS, HistoryFoldMemo, asSent, awaitedRequestId, documentFamilies, foldEvent, foldReport } from '../../src/protect/history/fold';
import type { PersistedReportInfo } from '../../src/protect/services';

const DAY = 20_000;
const never = (): boolean => false;

function report(over: Partial<DocumentReport> = {}): DocumentReport {
  return {
    schemaVersion: 1,
    documentKey: '7:0:TOP',
    tabId: 7,
    frameId: 0,
    documentId: 'TOP',
    host: 'www.shop.com',
    lifecycle: 'committed',
    createdAt: 1,
    updatedAt: 2,
    revision: 1,
    coverageState: 'active',
    coverageFlags: [],
    counters: [],
    findings: [],
    hosts: [],
    networkCounters: [],
    networkPatterns: { localPortsMax: 0, localTargetsMax: 0, randomSubdomainsMax: 0 },
    watermark: null,
    dropped: { observations: 0, batches: 0, findings: 0, hosts: 0, counters: 0, transport: 0 },
    ...over,
  };
}

function host(registrableDomain: string, over: Partial<HostEntry> = {}): HostEntry {
  return { registrableDomain, relation: 'cross-site', evidenceSource: 'browser-network', integrity: 'browser-observed', requestCount: 2, firstSeenBucket: 0, lastSeenBucket: 1, ruleIds: [], ...over };
}

function binding(documentId: string, frameId: number, parentDocumentId: string | null, hostName: string | null): FrameBinding {
  return { tabId: 7, frameId, documentId, documentKey: '7:' + String(frameId) + ':' + documentId, parentDocumentId, frameType: frameId === 0 ? 'outermost_frame' : 'sub_frame', documentLifecycle: 'active', host: hostName, boundAt: 1 };
}

function info(bindings: FrameBinding[], paused = false): PersistedReportInfo {
  return { paused, bindingOf: (_tab, id) => bindings.find((b) => b.documentId === id) ?? null };
}

describe('history fold of persisted reports', () => {
  it('third-party hosts of the top document become request sightings of the top site (+ rule ids)', () => {
    const memo = new HistoryFoldMemo();
    const r = report({ hosts: [host('tracker.net', { ruleIds: ['rule-1', 'bad id'] }), host('shop.com'), { category: 'loopback', relation: 'cross-site', evidenceSource: 'browser-network', integrity: 'browser-observed', requestCount: 1, firstSeenBucket: 0, lastSeenBucket: 0, ruleIds: [] }] });
    const out = foldReport(r, binding('TOP', 0, null, 'www.shop.com'), info([]), DAY, memo, never);
    expect(out.skipped).toBeNull();
    expect(out.sightings).toEqual([{ receiver: 'tracker.net', site: 'shop.com', day: DAY, signals: HISTORY_SIGNAL_BITS.request, ruleIds: ['rule-1'] }]);
    expect(out.sites).toEqual([{ site: 'shop.com', day: DAY, limited: false }]);
  });

  it('attempts-only receiver: report hosts (onBeforeRequest attempts) + our blocks give requests-only, no send (review round 2)', () => {
    // The reviewer's case: two committed reports list tracker.example (attempts; a DNR-stopped request is one too, SP-2)
    // and our firewall stopped requests to it. Nothing here is a send Chrome reported.
    const memo = new HistoryFoldMemo();
    const a = foldReport(report({ host: 'www.shop-a.com', hosts: [host('tracker.example', { requestCount: 3 })] }), null, info([]), DAY, memo, never);
    const b = foldReport(report({ documentKey: '8:0:TOP2', host: 'www.shop-b.org', hosts: [host('tracker.example', { requestCount: 3 })] }), null, info([]), DAY, memo, never);
    const blocked = foldEvent({ kind: 'blocked', tabId: 7, site: 'shop-a.com', receiver: 'tracker.example', ruleKey: 'r' }, DAY, never);
    if (!('delta' in blocked)) throw new Error('blocked event folded nothing');
    expect(blocked.delta.signals).toBe(HISTORY_SIGNAL_BITS['request-blocked']);
    const recA = applyHistorySightingDelta(applyHistorySightingDelta(undefined, a.sightings[0]!), blocked.delta);
    const recB = applyHistorySightingDelta(undefined, b.sightings[0]!);
    for (const rec of [recA, recB]) {
      expect(rec.valueMatch.some((w) => w !== 0)).toBe(false);
      expect(rec.replay.some((w) => w !== 0)).toBe(false);
      // The data-request lane quotes no fact from such a sighting.
      expect(requestSightingSentDay(rec)).toBeNull();
    }
    expect(historyMechanisms([recA, recB], { from: DAY - 29, to: DAY }).map((m) => [m.mechanism, m.sites, m.interpretationConfidence])).toEqual([['requests-only', 2, 'unassessed']]);
    // A blocked-only sighting: neither a request nor a send.
    const blockedOnly = applyHistorySightingDelta(undefined, blocked.delta);
    expect(blockedOnly.request.some((w) => w !== 0)).toBe(false);
    expect(requestSightingSentDay(blockedOnly)).toBeNull();
  });

  it('a third-party sub-frame: frame sighting with its families (frame-only); top site through parentDocumentId', () => {
    const memo = new HistoryFoldMemo();
    const frame = report({
      documentKey: '7:5:FR', frameId: 5, documentId: 'FR', host: 'widget.cdn.net',
      counters: [
        { techniqueId: 'DET-001', phase: 'returned-sync', signalCodes: ['api-use'], count: 3, countQuality: 'exact', firstBucket: 0, lastBucket: 1 },
        { techniqueId: 'DET-011', phase: 'returned-sync', signalCodes: ['api-use'], count: 0, countQuality: 'exact', firstBucket: 0, lastBucket: 0 },
      ],
      findings: [{ findingId: 'f1', ruleId: 'canvas-readback', ruleVersion: '1', techniqueId: 'DET-001', interpretation: 'possible-fingerprinting', interpretationConfidence: 'low', evidenceIds: [], counterEvidenceCodes: [], limitationCodes: [], vendorMatchIds: [] }],
      coverageFlags: ['network-limited'],
    });
    const chain = [binding('TOP', 0, null, 'www.shop.com'), binding('MID', 3, 'TOP', 'mid.net'), binding('FR', 5, 'MID', 'widget.cdn.net')];
    const out = foldReport(frame, chain[2]!, info(chain), DAY, memo, never);
    expect(out.sightings).toEqual([{ receiver: 'cdn.net', site: 'shop.com', day: DAY, signals: HISTORY_SIGNAL_BITS.frame, families: { canvas: 'possible-fingerprinting' } }]);
    // Families of a third-party frame are attributed to it, not to the site; network-limited marks the site.
    expect(out.sites).toEqual([{ site: 'shop.com', day: DAY, limited: true }]);
  });

  it('families of the top and same-site documents go to site.families (no determined source)', () => {
    const memo = new HistoryFoldMemo();
    const top = report({ counters: [{ techniqueId: 'DET-011', phase: 'returned-sync', signalCodes: ['api-use'], count: 1, countQuality: 'exact', firstBucket: 0, lastBucket: 0 }] });
    expect(foldReport(top, binding('TOP', 0, null, 'www.shop.com'), info([]), DAY, memo, never).sites).toEqual([{ site: 'shop.com', day: DAY, limited: false, families: ['webgl'] }]);
    const same = report({ documentKey: '7:2:SAME', frameId: 2, documentId: 'SAME', host: 'cdn.shop.com', counters: top.counters });
    const chain = [binding('TOP', 0, null, 'www.shop.com'), binding('SAME', 2, 'TOP', 'cdn.shop.com')];
    const out = foldReport(same, chain[1]!, info(chain), DAY, memo, never);
    expect(out.sightings).toEqual([]);
    expect(out.sites[0]?.families).toEqual(['webgl']);
  });

  it('network-patterns only through a DET-060/061 finding (with its interpretation)', () => {
    const r = report({
      networkCounters: [{ techniqueId: 'DET-061', phase: 'attempted', signalCodes: ['api-use'], count: 1, countQuality: 'exact', firstBucket: 0, lastBucket: 0 }],
    });
    expect(documentFamilies(r)).toEqual({});
    const withFinding = report({ findings: [{ findingId: 'n', ruleId: 'dns', ruleVersion: '1', techniqueId: 'DET-061', interpretation: 'dns-test-pattern', interpretationConfidence: 'low', evidenceIds: [], counterEvidenceCodes: [], limitationCodes: [], vendorMatchIds: [] }] });
    expect(documentFamilies(withFinding)).toEqual({ 'network-patterns': 'dns-test-pattern' });
  });

  it('skips: pending/prerender/closed, paused, no host, excluded site, unresolved chain (> 8 steps or missing parent)', () => {
    const memo = new HistoryFoldMemo();
    const top = binding('TOP', 0, null, 'www.shop.com');
    for (const lifecycle of ['pending', 'prerender', 'closed'] as const) {
      expect(foldReport(report({ lifecycle }), top, info([]), DAY, memo, never).skipped).toBe('lifecycle');
    }
    expect(foldReport(report({ lifecycle: 'bfcache' }), top, info([]), DAY, memo, never).skipped).toBeNull();
    expect(foldReport(report({ documentKey: 'p', revision: 9 }), top, info([], true), DAY, memo, never).skipped).toBe('paused');
    expect(foldReport(report({ documentKey: 'h', host: null }), top, info([]), DAY, memo, never).skipped).toBe('no-host');
    expect(foldReport(report({ documentKey: 'x', revision: 3 }), top, info([]), DAY, memo, (s) => s === 'shop.com').skipped).toBe('excluded');
    const orphan = report({ documentKey: '7:4:O', frameId: 4, documentId: 'O', host: 'w.net' });
    expect(foldReport(orphan, binding('O', 4, 'GONE', 'w.net'), info([]), DAY, memo, never).skipped).toBe('unresolved-site');
    // A chain longer than HISTORY_TOP_SITE_STEPS never resolves.
    const chain: FrameBinding[] = [binding('D0', 0, null, 'www.shop.com')];
    for (let i = 1; i <= HISTORY_TOP_SITE_STEPS + 1; i++) chain.push(binding('D' + String(i), i, 'D' + String(i - 1), 'f' + String(i) + '.net'));
    const deep = report({ documentKey: 'deep', frameId: HISTORY_TOP_SITE_STEPS + 1, documentId: 'D' + String(HISTORY_TOP_SITE_STEPS + 1), host: 'deep.net' });
    expect(foldReport(deep, chain[chain.length - 1]!, info(chain), DAY, memo, never).skipped).toBe('unresolved-site');
  });

  it('the memo skips an unchanged revision and deltas already folded today; a new day folds again', () => {
    const memo = new HistoryFoldMemo(2);
    const top = binding('TOP', 0, null, 'www.shop.com');
    const r1 = report({ hosts: [host('tracker.net')] });
    expect(foldReport(r1, top, info([]), DAY, memo, never).sightings).toHaveLength(1);
    expect(foldReport(r1, top, info([]), DAY, memo, never).skipped).toBe('unchanged');
    const r2 = report({ revision: 2, hosts: [host('tracker.net'), host('ads.net')] });
    expect(foldReport(r2, top, info([]), DAY, memo, never).sightings.map((d) => d.receiver)).toEqual(['ads.net']);
    expect(foldReport(r2, top, info([]), DAY + 1, memo, never).sightings.map((d) => d.receiver)).toEqual(['tracker.net', 'ads.net']);
    foldReport(report({ documentKey: 'a' }), top, info([]), DAY, memo, never);
    foldReport(report({ documentKey: 'b' }), top, info([]), DAY, memo, never);
    expect(memo.size).toBe(2);
  });
});

function evidence(over: Partial<ProtectTransferEvidence> = {}): ProtectEvidence {
  return {
    evidenceId: 'pe-1', frameContext: 'top', attributionConfidence: 'unknown', count: 1, countQuality: 'exact', firstSecond: 0, lastSecond: 0,
    evidenceSource: 'derived', integrity: 'derived', ruleVersion: '1', limitationCodes: [], protectKind: 'value-match', ruleId: 'form-leak',
    transferClass: 'third-party-before-submit', fieldKind: 'email', encodings: ['sha256-hex'], receiver: 'collector.net', relation: 'cross-site',
    method: 'POST', requestKind: 'xhr', endpointHost: 'collector.net', endpointPathTemplate: '/c', submitTiming: 'before-submit',
    deliveryState: 'sent', interpretationConfidence: 'high', ...over,
  } as ProtectEvidence;
}

describe('history fold of module events', () => {
  const ev = (e: ProtectEvidence, site: string | null = 'shop.com'): ProtectEvent => ({ kind: 'evidence', documentKey: '7:0:TOP', tabId: 7, site, evidence: e });

  it('value-match: hash of an e-mail / phone = hash; name or plain = plain; stopped sends are ignored', () => {
    expect(foldEvent(ev(evidence()), DAY, never)).toEqual({ delta: { receiver: 'collector.net', site: 'shop.com', day: DAY, signals: HISTORY_SIGNAL_BITS['value-match'], valueStrength: 'hash' } });
    expect(foldEvent(ev(evidence({ encodings: ['plain'] })), DAY, never)).toMatchObject({ delta: { valueStrength: 'plain' } });
    expect(foldEvent(ev(evidence({ fieldKind: 'name', encodings: ['md5-hex'] })), DAY, never)).toMatchObject({ delta: { valueStrength: 'plain' } });
    expect(foldEvent(ev(evidence({ deliveryState: 'stopped' })), DAY, never)).toEqual({ skipped: 'ignored' });
    expect(foldEvent(ev(evidence({ deliveryState: 'stopped-other' })), DAY, never)).toEqual({ skipped: 'ignored' });
    // Review round 1: `unknown` (published at onBeforeRequest time) is not «received» either.
    expect(foldEvent(ev(evidence({ deliveryState: 'unknown' })), DAY, never)).toEqual({ skipped: 'ignored' });
  });

  it('an unknown value-match with a request id is awaited; asSent relabels only after the outcome said sent', () => {
    const unknown: Extract<ProtectEvent, { kind: 'evidence' }> = { kind: 'evidence', documentKey: '7:0:TOP', tabId: 7, site: 'shop.com', evidence: evidence({ deliveryState: 'unknown' }), requestId: '1234' };
    expect(awaitedRequestId(unknown)).toBe('1234');
    expect(awaitedRequestId({ ...unknown, requestId: undefined } as unknown as ProtectEvent)).toBeNull();
    expect(awaitedRequestId({ ...unknown, requestId: 'x'.repeat(65) })).toBeNull();
    expect(awaitedRequestId({ ...unknown, evidence: evidence({ deliveryState: 'sent' }) })).toBeNull();
    expect(awaitedRequestId({ ...unknown, evidence: evidence({ deliveryState: 'stopped' }) })).toBeNull();
    const replay = { ...evidence(), protectKind: 'replay-pattern', ruleId: 'session-replay-behavior', receiver: 'rec.net', interpretationConfidence: 'low' } as unknown as ProtectEvidence;
    expect(awaitedRequestId({ ...unknown, evidence: replay })).toBeNull();
    expect(awaitedRequestId({ kind: 'outcome', requestId: '1234', tabId: 7, state: 'sent' })).toBeNull();
    const sent = asSent(unknown);
    expect(sent).not.toHaveProperty('requestId');
    expect((sent.evidence as ProtectTransferEvidence).deliveryState).toBe('sent');
    expect((unknown.evidence as ProtectTransferEvidence).deliveryState).toBe('unknown');
    expect(foldEvent(sent, DAY, never)).toMatchObject({ delta: { receiver: 'collector.net', signals: HISTORY_SIGNAL_BITS['value-match'], valueStrength: 'hash' } });
  });

  it('replay-pattern and blocked; receiverless, first-party, unresolved and excluded are skipped', () => {
    const replay = { ...evidence(), protectKind: 'replay-pattern', ruleId: 'session-replay-behavior', receiver: 'rec.net', interpretationConfidence: 'low' } as unknown as ProtectEvidence;
    expect(foldEvent(ev(replay), DAY, never)).toMatchObject({ delta: { receiver: 'rec.net', signals: HISTORY_SIGNAL_BITS['replay-pattern'] } });
    expect(foldEvent({ kind: 'blocked', tabId: 7, site: 'shop.com', receiver: 'ads.net', ruleKey: 'k' }, DAY, never)).toMatchObject({ delta: { signals: HISTORY_SIGNAL_BITS['request-blocked'] } });
    const { receiver: _r, ...noReceiver } = evidence() as ProtectTransferEvidence;
    expect(foldEvent(ev({ ...noReceiver, receiverCategory: 'loopback' } as ProtectEvidence), DAY, never)).toEqual({ skipped: 'ignored' });
    expect(foldEvent(ev(evidence({ receiver: 'shop.com' })), DAY, never)).toEqual({ skipped: 'ignored' });
    expect(foldEvent(ev(evidence(), null), DAY, never)).toEqual({ skipped: 'unresolved-site' });
    expect(foldEvent(ev(evidence()), DAY, () => true)).toEqual({ skipped: 'excluded' });
    expect(foldEvent({ kind: 'outcome', requestId: '1', tabId: 7, state: 'sent' }, DAY, never)).toEqual({ skipped: 'ignored' });
  });
});

describe('history awaiting sends (value-match records waiting for their outcome)', () => {
  const parkedEvent = (tabId = 7): Extract<ProtectEvent, { kind: 'evidence' }> => ({ kind: 'evidence', documentKey: String(tabId) + ':0:TOP', tabId, site: 'shop.com', evidence: evidence({ deliveryState: 'unknown' }) });

  it('take returns and removes the records of a request; bounded per request and in total; TTL and closed tabs drop', () => {
    const a = new HistoryAwaitingSends(2, 1000);
    for (let i = 0; i < MAX_PARKED_PER_REQUEST + 2; i++) a.park('r1', parkedEvent(), 0);
    expect(a.size).toBe(1);
    expect(a.droppedCount).toBe(2);
    expect(a.take('r1', 10)).toHaveLength(MAX_PARKED_PER_REQUEST);
    expect(a.take('r1', 10)).toEqual([]);
    a.park('r1', parkedEvent(), 0);
    a.park('r2', parkedEvent(), 1);
    a.park('r3', parkedEvent(), 2);
    expect(a.size).toBe(2);
    expect(a.take('r1', 3)).toEqual([]);
    expect(a.droppedCount).toBe(3);
    expect(a.take('r2', 2000)).toEqual([]);
    expect(a.size).toBe(0);
    expect(a.droppedCount).toBe(5);
    a.park('r4', parkedEvent(8), 3000);
    a.park('r5', parkedEvent(9), 3000);
    a.forgetTab(8);
    expect(a.take('r4', 3001)).toEqual([]);
    expect(a.take('r5', 3001)).toHaveLength(1);
    a.park('r6', parkedEvent(), 3002);
    a.clear();
    expect(a.size).toBe(0);
  });
});

describe('history accumulator', () => {
  it('merges the same key in place and refuses a new key beyond the bound', () => {
    const acc = new HistoryAccumulator(3);
    expect(acc.addSighting({ receiver: 'a.net', site: 's.net', day: DAY, signals: 1 })).toBe(true);
    expect(acc.addSighting({ receiver: 'a.net', site: 's.net', day: DAY, signals: 2 })).toBe(true);
    expect(acc.addSite({ site: 's.net', day: DAY, limited: false })).toBe(true);
    expect(acc.addSighting({ receiver: 'b.net', site: 's.net', day: DAY, signals: 1 })).toBe(true);
    expect(acc.full).toBe(true);
    expect(acc.addSighting({ receiver: 'c.net', site: 's.net', day: DAY, signals: 1 })).toBe(false);
    expect(acc.addSite({ site: 's.net', day: DAY, limited: true })).toBe(true);
    const drained = acc.drain();
    expect(drained.sightings.find((d) => d.receiver === 'a.net')?.signals).toBe(3);
    expect(drained.sites).toEqual([{ site: 's.net', day: DAY, limited: true }]);
    expect(acc.size).toBe(0);
  });
});
