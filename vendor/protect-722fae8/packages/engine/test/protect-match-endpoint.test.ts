// ADR-020 §B (S07): value-free endpoint descriptions (packages/attribution/src/endpoint.ts): host with random or long
// labels folded into the registrable domain, a safe path template (≤ 4 segments, ID-like → :id, no query or
// fragment) and safe parameter names. The random-label rule equals engine looksRandomLabel (network-observed.v1).

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ENDPOINT_PATH_TEMPLATE_PATTERN } from '@detect-expert/contracts';
import { endpointHost, joinPathTemplate, looksEncodedNameComponent, looksRandomEndpointLabel, pathSegments, pathTemplate, pathTemplateParts, safeParamName } from '../../attribution/src/index';
import { looksRandomLabel } from '../src/index';

describe('endpointHost', () => {
  it.each([
    ['http://px.tracker.example.net:4174/tr?ud[em]=x', 'px.tracker.example.net'],
    ['https://www.facebook.com/tr/', 'www.facebook.com'],
    ['https://a1b2c3d4e5f6g7h8.collect.example.org/x', 'example.org'],
    ['https://' + 'l'.repeat(33) + '.example.com/', 'example.com'],
    ['https://user:pw@shop.example.co.uk:8443/a', 'shop.example.co.uk'],
    // Review round 3: a label with more than 5 digits (a phone number, an ID) folds.
    ['https://p79125550137.px.example.net/tr', 'example.net'],
    ['https://u-912-555-01-37.px.example.net/tr', 'example.net'],
    ['https://cdn12345.example.net/x', 'cdn12345.example.net'],
    ['http://127.0.0.1:4173/x', null],
    ['http://localhost/x', null],
    ['http://intranet/x', null],
    ['not a url', null],
  ])('%s → %s', (url, expected) => expect(endpointHost(url)).toBe(expected));

  it('agrees with engine looksRandomLabel on a corpus', () => {
    for (const label of ['p3k9x2q8w1z7m4n6b5v0', 'img1', 'eu-west-1', 'my-bucket', 'abcdef123456', 'abcdefghijkl', 'a1-b2-c3-d4-e5-f6', '123456789012']) {
      expect(looksRandomEndpointLabel(label), label).toBe(looksRandomLabel(label));
    }
  });
});

describe('pathTemplate', () => {
  it.each([
    ['http://px.tracker.example.net:4174/tr?ud[em]=abc', '/tr'],
    ['https://example.com/', '/'],
    ['https://example.com', '/'],
    ['https://example.com/api/v1/users/12345/profile', '/api/v1/users/:id/…'],
    ['https://example.com/u/user@example.com/x', '/u/:id/x'],
    ['https://example.com/s/deadbeef42/x', '/s/:id/x'],
    ['https://example.com/%D0%B0%D0%BD%D0%BD%D0%B0', '/:id'],
    ['https://example.com/fsink/k#frag', '/fsink/k'],
    ['https://example.com//a///b?x=1', '/a/b'],
    ['https://example.com/2024/report', '/:id/report'],
  ])('%s → %s', (url, expected) => {
    const t = pathTemplate(url);
    expect(t).toBe(expected);
    expect(ENDPOINT_PATH_TEMPLATE_PATTERN.test(t)).toBe(true);
  });

  it('pathSegments keeps raw non-empty segments for the decoder only', () => {
    expect(pathSegments('https://example.com//a/b%40c/?q=1')).toEqual(['a', 'b%40c']);
  });

  it('joinPathTemplate masks the segments that carried a value (indices of pathSegments; review round 1)', () => {
    const url = 'https://px.example.net//u/Vasilchikova/aXZhbi5wZXRyb3ZAZXhhbXBsZS5jb20/ev/more?x=1';
    const parts = pathTemplateParts(url);
    expect(parts).toEqual({ segments: ['u', 'Vasilchikova', 'aXZhbi5wZXRyb3ZAZXhhbXBsZS5jb20', 'ev'], more: true });
    expect(pathSegments(url).slice(0, 4)).toEqual(['u', 'Vasilchikova', 'aXZhbi5wZXRyb3ZAZXhhbXBsZS5jb20', 'ev']);
    expect(joinPathTemplate(parts)).toBe(pathTemplate(url));
    expect(joinPathTemplate(parts, new Set([1, 2]))).toBe('/u/:id/:id/ev/…');
    expect(joinPathTemplate(parts, new Set([9]))).toBe('/u/Vasilchikova/aXZhbi5wZXRyb3ZAZXhhbXBsZS5jb20/ev/…');
    for (const t of [joinPathTemplate(parts, new Set([0, 1, 2, 3])), joinPathTemplate(pathTemplateParts('https://e.com/'), new Set([0]))]) {
      expect(ENDPOINT_PATH_TEMPLATE_PATTERN.test(t), t).toBe(true);
    }
  });
});

describe('safeParamName', () => {
  it.each([
    ['email', 'email'],
    ['ud[em]', 'ud[em]'],
    ['draft.email', 'draft.email'],
    ['user_123456', null],
    ['k0123456789abcdef', null],
    ['has space', null],
    ['x'.repeat(49), null],
    ['', null],
    // Review round 3: phone fragments, random-looking and Base64-looking components are refused by shape.
    ['912-555-01-37', null],
    ['ph[912_55]', 'ph[912_55]'],
    ['ph[912_555_01]', null],
    ['contacts.qwkx2zr8tbmn', null],
    ['shippingAddressLine', 'shippingAddressLine'],
    ['customer_first_name.em', 'customer_first_name.em'],
  ])('%s → %s', (name, expected) => expect(safeParamName(name)).toBe(expected));

  it('refuses Base64url hash digests as a name or a name component (they are not matched variants; review round 3)', () => {
    for (const value of ['canary.vm-7d1e@mail-example.com', 'ivan.petrov@example.com', '+79125550137', 'vasilchikova']) {
      for (const algo of ['md5', 'sha1', 'sha256']) {
        const digest = createHash(algo).update(value, 'utf8').digest('base64url');
        expect(looksEncodedNameComponent(digest) || looksRandomEndpointLabel(digest), algo + ' ' + digest).toBe(true);
        expect(safeParamName(digest), digest).toBeNull();
        if (digest.length <= 46) expect(safeParamName('d.' + digest), digest).toBeNull();
        if (digest.length <= 44) expect(safeParamName('ud[' + digest + ']'), digest).toBeNull();
      }
    }
  });
});
