// S07 / ADR-018: ephemeral network windows — memory only, salted tokens, tumbling 10 s, bounded everything.
import { BUDGETS } from '@detect-expert/contracts';
import { describe, expect, it } from 'vitest';
import { MAX_LOCAL_TARGETS, MAX_NETWORK_WINDOW_DOCUMENTS, MAX_SUBDOMAIN_DOMAINS, NetworkWindowTracker } from '../src/index';

const SALT = '00112233445566778899aabbccddeeff';

describe('NetworkWindowTracker', () => {
  it('counts distinct ports of one local target and distinct local targets inside one window', () => {
    const t = new NetworkWindowTracker({ salt: SALT });
    expect(t.observeLocal('doc', '192.168.77.213', '192.168.77.213:45123', 0)).toEqual({ ports: 1, targets: 1 });
    expect(t.observeLocal('doc', '192.168.77.213', '192.168.77.213:45123', 10)).toEqual({ ports: 1, targets: 1 });
    expect(t.observeLocal('doc', '192.168.77.213', '192.168.77.213:45124', 20)).toEqual({ ports: 2, targets: 1 });
    expect(t.observeLocal('doc', '[fd12::1]', '[fd12::1]:45127', 30)).toEqual({ ports: 1, targets: 2 });
    expect(t.observeLocal('other', '127.0.0.1', '127.0.0.1:80', 30)).toEqual({ ports: 1, targets: 1 });
  });

  it('is a tumbling window of BUDGETS.networkWindowMs', () => {
    const t = new NetworkWindowTracker({ salt: SALT });
    for (let p = 0; p < 4; p++) t.observeLocal('doc', '127.0.0.1', '127.0.0.1:' + String(9000 + p), p);
    expect(t.observeLocal('doc', '127.0.0.1', '127.0.0.1:9004', BUDGETS.networkWindowMs - 1).ports).toBe(5);
    expect(t.observeLocal('doc', '127.0.0.1', '127.0.0.1:9005', BUDGETS.networkWindowMs)).toEqual({ ports: 1, targets: 1 });
    expect(t.observeSubdomain('doc', 'example.com', 'a1b2c3d4e5f6.example.com', BUDGETS.networkWindowMs + 1)).toBe(1);
    // A clock going backwards starts a fresh window instead of counting into a stale one.
    expect(t.observeSubdomain('doc', 'example.com', 'b1b2c3d4e5f6.example.com', 5)).toBe(1);
  });

  it('bounds tokens per set (32), local targets with port sets (16) and domains (8) per document', () => {
    const t = new NetworkWindowTracker({ salt: SALT });
    let last = { ports: 0, targets: 0 };
    for (let p = 0; p < 100; p++) last = t.observeLocal('doc', '10.0.0.1', '10.0.0.1:' + String(p), 1);
    expect(last.ports).toBe(BUDGETS.maxNetworkWindowDistinct);
    for (let i = 0; i < 100; i++) last = t.observeLocal('doc', '10.0.1.' + String(i), '10.0.1.' + String(i) + ':80', 2);
    expect(last.targets).toBe(BUDGETS.maxNetworkWindowDistinct);
    // Targets beyond the 16 port sets still count as targets; their own port count is not tracked (reported as 1).
    expect(last.ports).toBe(1);
    let n = 0;
    for (let i = 0; i < 100; i++) n = t.observeSubdomain('doc', 'example.com', 'x' + String(i) + 'a1b2c3d4e5.example.com', 3);
    expect(n).toBe(BUDGETS.maxNetworkWindowDistinct);
    for (let d = 0; d < 20; d++) n = t.observeSubdomain('doc', 'd' + String(d) + '.net', 'a1b2c3d4e5f6.d' + String(d) + '.net', 4);
    expect(n).toBe(1);
    const perDocumentMax = BUDGETS.maxNetworkWindowDistinct * (1 + MAX_LOCAL_TARGETS + MAX_SUBDOMAIN_DOMAINS);
    expect(t.retainedTokens()).toBeLessThanOrEqual(perDocumentMax);
  });

  it('keeps at most 32 documents (LRU) and forgets/clears on request', () => {
    const t = new NetworkWindowTracker({ salt: SALT });
    for (let d = 0; d < 40; d++) t.observeLocal('doc-' + String(d), '127.0.0.1', '127.0.0.1:1', d);
    expect(t.size).toBe(MAX_NETWORK_WINDOW_DOCUMENTS);
    // doc-0..7 were evicted: a new observation starts from scratch.
    expect(t.observeLocal('doc-0', '127.0.0.1', '127.0.0.1:2', 50)).toEqual({ ports: 1, targets: 1 });
    expect(t.observeLocal('doc-39', '127.0.0.1', '127.0.0.1:2', 51)).toEqual({ ports: 2, targets: 1 });
    t.forget('doc-39');
    expect(t.observeLocal('doc-39', '127.0.0.1', '127.0.0.1:3', 52)).toEqual({ ports: 1, targets: 1 });
    t.clear();
    expect(t.size).toBe(0);
    expect(t.retainedTokens()).toBe(0);
  });

  it('exposes counts only: results carry no token, host or port; different salts give the same counts', () => {
    const a = new NetworkWindowTracker({ salt: SALT });
    const b = new NetworkWindowTracker();
    const results: unknown[] = [];
    for (const tracker of [a, b]) {
      results.push(tracker.observeLocal('doc', '192.168.77.213', '192.168.77.213:45123', 0));
      results.push(tracker.observeLocal('doc', '192.168.77.213', '192.168.77.213:45124', 1));
      results.push(tracker.observeSubdomain('doc', 'example.com', 'p3k9x2q8w1z7m4n6b5v0.dns.example.com', 2));
    }
    expect(results.slice(0, 3)).toEqual(results.slice(3));
    expect(JSON.stringify(results)).not.toMatch(/192|45123|p3k9|example/);
    for (const r of results) expect(typeof r === 'number' || Object.keys(r as object).sort().join(',') === 'ports,targets').toBe(true);
  });
});
