import { describe, expect, it } from 'vitest';
import { DNS_PROBE_LIMITS, DNS_PROBE_MIN_NAMES, DnsProbeWindow, isDnsProbeHostname } from '../src/dns-probe-window';

describe('DET-061 bounded unique-subdomain candidate', () => {
  it('requires eight distinct tokens in one registrable domain and never counts a token twice within its window', () => {
    const window = new DnsProbeWindow();
    for (let index = 0; index < DNS_PROBE_MIN_NAMES; index++) {
      expect(window.record('doc', 'r' + index, 'example.com', 'hash-' + index, index * 100).count).toBe(index === 7 ? 8 : 0);
    }
    expect(window.record('doc', 'retry', 'example.com', 'hash-7', 800).count).toBe(0);
    expect(window.record('doc', 'new', 'example.com', 'hash-8', 900).count).toBe(1);
    expect(window.record('doc', 'new', 'example.com', 'hash-9', 1000).count).toBe(0);
  });

  it('separates domains and documents, excluding repeated anti-cache requests to the same host', () => {
    const window = new DnsProbeWindow();
    for (let index = 0; index < 20; index++) {
      expect(window.record('doc', 'r' + index, 'example.com', 'same-host-hash', index).count).toBe(0);
      expect(window.record('separate-' + index, 'r', 'example.com', 'hash-' + index, index).count).toBe(0);
      expect(window.record('domains', 'r' + index, 'domain-' + index + '.com', 'hash-' + index, index).count).toBe(0);
    }
  });

  it('uses original event times on delayed replay without erasing newer documents', () => {
    const window = new DnsProbeWindow();
    for (let index = 0; index < 7; index++) window.record('parent', 'r' + index, 'example.com', 'hash-' + index, 100 + index);
    window.record('child', 'old', 'example.com', 'other', 0, 200);
    expect(window.record('parent', 'eighth', 'example.com', 'hash-7', 201).count).toBe(8);
    expect(window.record('old', 'expired', 'example.com', 'hash', 0, 10000)).toMatchObject({ count: 0, limited: true });
  });

  it('expires tokens at ten seconds and clears on explicit reset or retirement', () => {
    const window = new DnsProbeWindow();
    for (let index = 0; index < 7; index++) window.record('doc', 'r' + index, 'example.com', 'hash-' + index, index * 1000);
    expect(window.nextExpiry).toBe(10000);
    expect(window.record('doc', 'eighth', 'example.com', 'hash-7', 10000).count).toBe(0);
    window.clear('doc'); expect(window.size).toBe(0);
    window.record('doc', 'r', 'example.com', 'hash', 10000);
    window.retain(new Set()); expect(window.size).toBe(0);
  });

  it('bounds memory for documents, domains, tokens and request identities with explicit loss', () => {
    const window = new DnsProbeWindow();
    for (let index = 0; index < DNS_PROBE_LIMITS.documents; index++) window.record('doc-' + index, 'r', 'example.com', 'hash', index);
    expect(window.record('extra', 'r', 'example.com', 'hash', 100)).toMatchObject({ limited: true, evictedDocumentKey: 'doc-0' });
    expect(window.size).toBe(DNS_PROBE_LIMITS.documents);
    for (let index = 0; index < DNS_PROBE_LIMITS.names; index++) window.record('tokens', 'r' + index, 'example.com', 'hash-' + index, 100);
    expect(window.record('tokens', 'overflow', 'example.com', 'other', 100)).toMatchObject({ count: 0, limited: true });
    for (let index = 0; index < DNS_PROBE_LIMITS.requests; index++) window.record('requests', 'r' + index, 'example.com', 'same', 100);
    expect(window.record('requests', 'overflow', 'example.com', 'same', 100)).toMatchObject({ count: 0, limited: true });
  });

  it('keeps common shard, CDN, base-domain and malformed labels outside the lexical candidate', () => {
    for (const host of ['example.com', 'www.example.com', 'cdn1.example.com',
      '123456789.example.com', 'abcdefghijk.example.com', 'aaaa1111.example.com', 'a123.example.com',
      'a12-b34c.example.com', 'r1a2b3c4.example.com.other']) {
      expect(isDnsProbeHostname(host, 'example.com'), host).toBe(false);
    }
    expect(isDnsProbeHostname('a1b2c3d4.dns4.example.com', 'example.com')).toBe(true);
  });
  it('does not claim randomness or intent for an ordinary qualifying label', () => {
    expect(isDnsProbeHostname('images12.example.com', 'example.com')).toBe(true);
    const window = new DnsProbeWindow();
    for (let index = 0; index < 20; index++) expect(window.record('doc', 'r' + index, 'example.com', 'same-images12-hash', index).count).toBe(0);
  });
});