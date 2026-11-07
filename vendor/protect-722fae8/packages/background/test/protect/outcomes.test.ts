import { PROTECT_BUDGETS } from '@detect-expert/contracts';
import { describe, expect, it } from 'vitest';
import type { RequestDetailsLike } from '../../src/chrome-api';
import { BLOCKED_BY_CLIENT, OutcomeTracker } from '../../src/protect/outcomes';
import type { FirewallVerdict, OutcomeEvent } from '../../src/protect/outcomes';
import { makeClock } from './support';

function setup(verdict: FirewallVerdict | null = null) {
  const clock = makeClock();
  const events: OutcomeEvent[] = [];
  const tracker = new OutcomeTracker(clock, (e) => events.push(e), () => () => verdict);
  return { clock, events, tracker };
}

function d(over: Partial<RequestDetailsLike> = {}): RequestDetailsLike {
  return { tabId: 7, frameId: 0, url: 'https://collect.example.net/x', type: 'ping', timeStamp: 1, requestId: 'r1', ...over };
}

describe('OutcomeTracker (ADR-020 §11)', () => {
  it('onSendHeaders → sent; a later error does not undo the send', () => {
    const { tracker, events } = setup();
    tracker.track('r1', 7, 1000);
    tracker.onSendHeaders(d());
    tracker.onErrorOccurred(d({ error: 'net::ERR_FAILED' }));
    expect(events).toEqual([{ kind: 'outcome', requestId: 'r1', tabId: 7, state: 'sent' }]);
  });

  it('ERR_BLOCKED_BY_CLIENT + our block rule active ≥ 50 ms before the request → stopped with the rule key', () => {
    const { tracker, events } = setup({ ruleKey: 'site:shop-site.com>example.net', action: 'block', activatedAt: 1000 - PROTECT_BUDGETS.ruleActivationSlackMs });
    tracker.track('r1', 7, 1000);
    tracker.onErrorOccurred(d({ error: BLOCKED_BY_CLIENT }));
    expect(events).toEqual([{ kind: 'outcome', requestId: 'r1', tabId: 7, state: 'stopped', ruleKey: 'site:shop-site.com>example.net' }]);
  });

  it('rule activated later than the slack, an allow verdict or no verdict → stopped-other (never stopped)', () => {
    for (const verdict of [
      { ruleKey: 'k', action: 'block' as const, activatedAt: 1000 - PROTECT_BUDGETS.ruleActivationSlackMs + 1 },
      { ruleKey: 'k', action: 'allow' as const, activatedAt: 0 },
      null,
    ]) {
      const { tracker, events } = setup(verdict);
      tracker.track('r1', 7, 1000);
      tracker.onErrorOccurred(d({ error: BLOCKED_BY_CLIENT }));
      expect(events.map((e) => e.state)).toEqual(['stopped-other']);
    }
  });

  it('other errors, completion without a send and TTL expiry → unknown; untracked requests are ignored', () => {
    const { tracker, events, clock } = setup();
    tracker.onSendHeaders(d({ requestId: 'untracked' }));
    tracker.track('a', 7, 1);
    tracker.onErrorOccurred(d({ requestId: 'a', error: 'net::ERR_ABORTED' }));
    tracker.track('b', 7, 1);
    tracker.onCompleted(d({ requestId: 'b' }));
    tracker.track('c', 7, 1);
    clock.t += PROTECT_BUDGETS.outcomeTtlMs;
    tracker.sweep(true);
    expect(events.map((e) => [e.requestId, e.state])).toEqual([['a', 'unknown'], ['b', 'unknown'], ['c', 'unknown']]);
    expect(tracker.size).toBe(0);
  });

  it('bounded: beyond maxPendingOutcomes the oldest becomes unknown', () => {
    const { tracker, events } = setup();
    for (let i = 0; i <= PROTECT_BUDGETS.maxPendingOutcomes; i++) tracker.track('r' + String(i), 7, 1);
    expect(tracker.size).toBe(PROTECT_BUDGETS.maxPendingOutcomes);
    expect(events).toEqual([{ kind: 'outcome', requestId: 'r0', tabId: 7, state: 'unknown' }]);
    expect(tracker.track('', 7, 1)).toBe(false);
  });
});
