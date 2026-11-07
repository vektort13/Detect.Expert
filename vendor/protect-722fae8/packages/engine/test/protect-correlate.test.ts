// ADR-020 §F (S10): pure correlation of MAIN send samples with requests (classes, address, time window, FIFO,
// unique / ambiguous / none / gap / saturated, settle and wait delays).

import { describe, expect, it } from 'vitest';
import { PROTECT_BUDGETS } from '@detect-expert/contracts';
import { addressMatches, correlateSends, requestClassOf, sendClassOf } from '../src/protect/correlate';
import type { CorrelationParams, CorrelationRequest, CorrelationSend } from '../src/protect/correlate';

const T0 = 1_700_000_000_000;

function params(now: number, over: Partial<CorrelationParams> = {}): CorrelationParams {
  return {
    now,
    leadMs: PROTECT_BUDGETS.correlationLeadMs,
    lagMs: PROTECT_BUDGETS.correlationLagMs,
    imageLagMs: PROTECT_BUDGETS.correlationImageLagMs,
    ambiguityMs: PROTECT_BUDGETS.correlationAmbiguityMs,
    waitMs: PROTECT_BUDGETS.attributionWaitMs,
    settleMs: 650,
    gaps: [],
    saturated: [],
    ...over,
  };
}

function send(id: number, t: number, over: Partial<CorrelationSend> = {}): CorrelationSend {
  return { id, cls: 'xmlhttprequest', t, scriptKey: 'x|https|cdn.example.org|/a.js', target: { kind: 'absolute', host: 'collect.example.net' }, matched: false, ...over };
}

function req(id: string, t: number, over: Partial<CorrelationRequest> = {}): CorrelationRequest {
  return { id, cls: 'xmlhttprequest', t, hostToken: 'collect.example.net', sameHostAsInitiator: false, ...over };
}

describe('classes (SP-14)', () => {
  it('fetch / XHR -> xmlhttprequest, sendBeacon -> ping, image -> image; other request types have no class', () => {
    expect(sendClassOf('send-fetch')).toBe('xmlhttprequest');
    expect(sendClassOf('send-xhr')).toBe('xmlhttprequest');
    expect(sendClassOf('send-beacon')).toBe('ping');
    expect(sendClassOf('send-image')).toBe('image');
    expect(['xmlhttprequest', 'ping', 'image', 'script', 'main_frame', 'other', 7].map(requestClassOf)).toEqual(['xmlhttprequest', 'ping', 'image', null, null, null, null]);
  });

  it('address: absolute by masked host token, relative by the initiator host, unread matches any', () => {
    expect(addressMatches({ kind: 'absolute', host: 'collect.example.net' }, req('r', 0))).toBe(true);
    expect(addressMatches({ kind: 'absolute', host: 'other.example.net' }, req('r', 0))).toBe(false);
    expect(addressMatches({ kind: 'absolute', host: 'collect.example.net' }, req('r', 0, { hostToken: null }))).toBe(false);
    expect(addressMatches({ kind: 'relative' }, req('r', 0, { sameHostAsInitiator: true }))).toBe(true);
    expect(addressMatches({ kind: 'relative' }, req('r', 0))).toBe(false);
    expect(addressMatches({ kind: 'unread' }, req('r', 0, { hostToken: null }))).toBe(true);
  });
});

describe('correlateSends', () => {
  it('unique: one candidate in the window, decided after the settle delay', () => {
    const sends = [send(1, T0)];
    const requests = [req('r1', T0 + 20)];
    expect(correlateSends(requests, sends, params(T0 + 100)).decisions).toEqual([]);
    const out = correlateSends(requests, sends, params(T0 + 700));
    expect(out.decisions).toEqual([{ requestId: 'r1', correlation: 'unique', sendId: 1, viaUnreadTarget: false }]);
    expect(out.matchedSendIds).toEqual([1]);
  });

  it('window [-250, +1000] ms (image +2000): outside it there is no pair', () => {
    expect(correlateSends([req('r', T0 - 251)], [send(1, T0)], params(T0 + 5000)).decisions[0]?.correlation).toBe('none');
    expect(correlateSends([req('r', T0 - 250)], [send(1, T0)], params(T0 + 5000)).decisions[0]?.correlation).toBe('unique');
    expect(correlateSends([req('r', T0 + 1000)], [send(1, T0)], params(T0 + 5000)).decisions[0]?.correlation).toBe('unique');
    expect(correlateSends([req('r', T0 + 1001)], [send(1, T0)], params(T0 + 5000)).decisions[0]?.correlation).toBe('none');
    const img = (t: number): CorrelationRequest => req('i', t, { cls: 'image' });
    expect(correlateSends([img(T0 + 2000)], [send(1, T0, { cls: 'image' })], params(T0 + 9000)).decisions[0]?.correlation).toBe('unique');
    expect(correlateSends([img(T0 + 2001)], [send(1, T0, { cls: 'image' })], params(T0 + 9000)).decisions[0]?.correlation).toBe('none');
  });

  it('class and address must match', () => {
    expect(correlateSends([req('r', T0, { cls: 'ping' })], [send(1, T0)], params(T0 + 5000)).decisions[0]?.correlation).toBe('none');
    expect(correlateSends([req('r', T0, { hostToken: 'x.example.org' })], [send(1, T0)], params(T0 + 5000)).decisions[0]?.correlation).toBe('none');
    const unread = correlateSends([req('r', T0, { hostToken: 'x.example.org' })], [send(1, T0, { target: { kind: 'unread' } })], params(T0 + 5000));
    expect(unread.decisions[0]).toMatchObject({ correlation: 'unique', viaUnreadTarget: true });
  });

  it('greedy FIFO: requests in time order take the earliest unmatched candidate', () => {
    const sends = [send(1, T0, { scriptKey: 'A' }), send(2, T0 + 400, { scriptKey: 'A' })];
    const requests = [req('late', T0 + 450), req('early', T0 + 10)];
    const out = correlateSends(requests, sends, params(T0 + 5000));
    expect(out.decisions).toEqual([
      { requestId: 'early', correlation: 'unique', sendId: 1, viaUnreadTarget: false },
      { requestId: 'late', correlation: 'unique', sendId: 2, viaUnreadTarget: false },
    ]);
  });

  it('ambiguous: another script candidate within 150 ms (matched or not); same script stays unique', () => {
    const two = [send(1, T0, { scriptKey: 'A' }), send(2, T0 + 100, { scriptKey: 'B' })];
    const out = correlateSends([req('r1', T0 + 120), req('r2', T0 + 130)], two, params(T0 + 5000));
    expect(out.decisions.map((d) => [d.requestId, d.correlation, d.sendId])).toEqual([['r1', 'ambiguous', 1], ['r2', 'ambiguous', 2]]);
    const same = [send(1, T0, { scriptKey: 'A' }), send(2, T0 + 100, { scriptKey: 'A' })];
    expect(correlateSends([req('r1', T0 + 120)], same, params(T0 + 5000)).decisions[0]?.correlation).toBe('unique');
    const far = [send(1, T0, { scriptKey: 'A' }), send(2, T0 + 151, { scriptKey: 'B' })];
    expect(correlateSends([req('r1', T0 + 160)], far, params(T0 + 5000)).decisions[0]?.correlation).toBe('unique');
  });

  it('none / gap / saturated after the wait; still pending before it', () => {
    const r = [req('r', T0)];
    expect(correlateSends(r, [], params(T0 + 1999)).decisions).toEqual([]);
    expect(correlateSends(r, [], params(T0 + 2000)).decisions[0]?.correlation).toBe('none');
    expect(correlateSends(r, [], params(T0 + 2000, { gaps: [{ from: T0 - 500, to: T0 - 400 }] })).decisions[0]?.correlation).toBe('gap');
    expect(correlateSends(r, [], params(T0 + 2000, { gaps: [{ from: T0 + 300, to: T0 + 400 }] })).decisions[0]?.correlation).toBe('none');
    expect(correlateSends(r, [], params(T0 + 2000, { gaps: [{ from: T0 - 1, to: T0 }], saturated: [{ from: T0 - 1, to: T0 }] })).decisions[0]?.correlation).toBe('saturated');
  });

  it('matched sends are never chosen again and inputs are not mutated', () => {
    const sends = [send(1, T0, { matched: true })];
    const before = JSON.stringify(sends);
    expect(correlateSends([req('r', T0 + 5)], sends, params(T0 + 5000)).decisions[0]?.correlation).toBe('none');
    expect(JSON.stringify(sends)).toBe(before);
  });
});
