import { describe, expect, it } from 'vitest';
import { LocalProbeWindow, LOCAL_PROBE_LIMITS } from '../src/local-probe-window';

describe('ADR-025 local multi-port candidate window', () => {
  it('delayed replay and pre-visit events do not erase newer windows in other documents', () => {
    const window = new LocalProbeWindow();
    window.record('parent', 'first', '127.0.0.1', 5001, 100);
    window.record('parent', 'second', '127.0.0.1', 5002, 200);
    window.record('parent', 'third', '127.0.0.1', 5003, 300);
    window.record('child', 'pre-visit', null, 5001, 0, 400);
    expect(window.record('parent', 'fourth', '127.0.0.1', 5004, 500)).toMatchObject({ multiPort: true, limited: false });
  });
  it('delayed requests retain event times and cannot move a recently refreshed port backwards', () => {
    const window = new LocalProbeWindow();
    window.record('doc', 'recent', '127.0.0.1', 5001, 1000);
    window.record('doc', 'delayed', '127.0.0.1', 5001, 0, 1100);
    window.record('doc', 'second', '127.0.0.1', 5002, 2000);
    window.record('doc', 'third', '127.0.0.1', 5003, 3000);
    expect(window.record('doc', 'fourth', '127.0.0.1', 5004, 10500).multiPort).toBe(true);
    expect(window.record('other', 'expired', '127.0.0.1', 5005, 0, 10500)).toMatchObject({ multiPort: false, limited: true });
  });

  it('four distinct ports on one target within ten seconds are required', () => {
    const window = new LocalProbeWindow();
    for (let i = 0; i < 4; i++) expect(window.record('doc', 'r' + i, '127.0.0.1', 5000 + i, i * 3000)).toMatchObject({ multiPort: i === 3, duplicate: false, limited: false });
  });
  it('one companion service with repeated retries, and public targets, never become a scan pattern', () => {
    for (const target of ['127.0.0.1', null]) {
      const window = new LocalProbeWindow();
      for (let i = 0; i < 20; i++) expect(window.record('doc', 'r' + i, target, target === null ? 8000 + i : 9222, i * 100)).toMatchObject({ multiPort: false });
    }
  });
  it('different local devices and different documents cannot combine their ports', () => {
    const window = new LocalProbeWindow();
    for (let i = 0; i < 8; i++) {
      expect(window.record('devices', 'r' + i, '192.168.1.' + (i + 1), 8080 + i, i)).toMatchObject({ multiPort: false });
      expect(window.record('doc' + i, 'r' + i, '127.0.0.1', 8080 + i, i)).toMatchObject({ multiPort: false });
    }
  });
  it('a port at the exact ten-second boundary expires; repeated recent ports refresh only themselves', () => {
    const window = new LocalProbeWindow();
    window.record('doc', 'r1', '127.0.0.1', 1, 0);
    window.record('doc', 'r2', '127.0.0.1', 2, 1000);
    window.record('doc', 'r3', '127.0.0.1', 3, 2000);
    expect(window.record('doc', 'r4', '127.0.0.1', 4, 10_000).multiPort).toBe(false);
    expect(window.record('doc', 'r5', '127.0.0.1', 2, 10_001).multiPort).toBe(false);
    expect(window.record('doc', 'r6', '127.0.0.1', 5, 10_002).multiPort).toBe(true);
  });
  it('deduplicates browser request identity and drops classification windows on clear, retirement and clock reversal', () => {
    const window = new LocalProbeWindow();
    expect(window.record('doc', 'same', '127.0.0.1', 1, 10).duplicate).toBe(false);
    expect(window.record('doc', 'same', '127.0.0.1', 2, 11).duplicate).toBe(true);
    window.clear('doc'); expect(window.size).toBe(0);
    window.record('doc', 'r', '127.0.0.1', 1, 100);
    expect(window.record('doc', 'r', '127.0.0.1', 1, 50).duplicate).toBe(false);
    window.retain(new Set()); expect(window.size).toBe(0);
  });
  it('scheduled expiration drops old entries while a newer document entry survives', () => {
    const window = new LocalProbeWindow();
    window.record('doc', 'old', '127.0.0.1', 80, 0);
    window.record('doc', 'new', '192.168.1.1', 81, 5000);
    expect(window.nextExpiry).toBe(10000);
    window.expire(10000);
    expect(window.size).toBe(1);
    expect(window.nextExpiry).toBe(15000);
  });
  it('admission bounds signal loss instead of growing unbounded target, port, request or document maps', () => {
    const window = new LocalProbeWindow();
    for (let i = 0; i < LOCAL_PROBE_LIMITS.documents; i++) window.record('doc' + i, 'r', null, 0, i);
    expect(window.record('overflow', 'r', null, 0, 100).limited).toBe(true);
    expect(window.size).toBe(LOCAL_PROBE_LIMITS.documents);
    for (let i = 0; i < LOCAL_PROBE_LIMITS.targets; i++) window.record('targets', 'r' + i, '10.0.0.' + i, 80, 100);
    expect(window.record('targets', 'more', '10.0.1.1', 80, 101).limited).toBe(true);
    for (let i = 0; i < LOCAL_PROBE_LIMITS.ports; i++) window.record('ports', 'r' + i, '127.0.0.1', i + 1, 100);
    expect(window.record('ports', 'more', '127.0.0.1', 100, 101)).toMatchObject({ limited: true, multiPort: true });
    for (let i = 0; i < LOCAL_PROBE_LIMITS.requests; i++) window.record('requests', 'r' + i, null, 0, 100);
    expect(window.record('requests', 'more', null, 0, 101).limited).toBe(true);
  });
});
