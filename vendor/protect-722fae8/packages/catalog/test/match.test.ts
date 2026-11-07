import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCatalogIndex, EMPTY_CATALOG } from '../src/build-index';
import { compileRule } from '../src/compile';
import { EMPTY_MATCH, matchNetworkRequest, matchParsedRequest } from '../src/match';
import { PRODUCTION_CATALOG } from '../src/production';
import { candidateIndex, SOURCE_DATE_MS } from './helpers';

const index = candidateIndex();
const now = SOURCE_DATE_MS;
const script = (url: unknown, statusCode: unknown = 200, resourceType: unknown = 'script') => matchNetworkRequest(index, { url, resourceType, statusCode }, now);

describe('empty catalogs', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('return the shared frozen EMPTY without parsing the URL', () => {
    let constructed = 0;
    class SpyURL {
      constructor() {
        constructed++;
        throw new Error('URL must not be parsed for an empty catalog');
      }
    }
    vi.stubGlobal('URL', SpyURL);
    for (const catalog of [EMPTY_CATALOG, PRODUCTION_CATALOG]) {
      const result = matchNetworkRequest(catalog, { url: 'https://js.hcaptcha.com/1/api.js', resourceType: 'script', statusCode: 200 }, now);
      expect(result).toBe(EMPTY_MATCH);
    }
    expect(constructed).toBe(0);
    expect(Object.isFrozen(EMPTY_MATCH)).toBe(true);
  });
});

describe('matchNetworkRequest', () => {
  it('matches an exact documented resource and ignores query, fragment and userinfo', () => {
    expect(script('https://js.hcaptcha.com/1/api.js')).toEqual(['hcaptcha-loader']);
    expect(script('https://js.hcaptcha.com/1/api.js?render=explicit&k=SECRET#frag')).toEqual(['hcaptcha-loader']);
    expect(script('https://user:pass@js.hcaptcha.com/1/api.js')).toEqual(['hcaptcha-loader']);
    expect(script('https://js.hcaptcha.com@evil.example/1/api.js')).toBe(EMPTY_MATCH);
    expect(script('https://evil.example/js.hcaptcha.com/1/api.js')).toBe(EMPTY_MATCH);
  });

  it('compares the port: default port only', () => {
    expect(script('https://js.hcaptcha.com:443/1/api.js')).toEqual(['hcaptcha-loader']);
    expect(script('https://js.hcaptcha.com:8443/1/api.js')).toBe(EMPTY_MATCH);
    expect(script('http://js.hcaptcha.com/1/api.js')).toBe(EMPTY_MATCH);
  });

  it('normalizes host case and one trailing dot (WHATWG), never the path', () => {
    expect(script('https://JS.HCAPTCHA.COM./1/api.js', 304)).toEqual(['hcaptcha-loader']);
    expect(script('https://js.hcaptcha.com/1/API.js')).toBe(EMPTY_MATCH);
    expect(script('https://js.hcaptcha.com/1/%61pi.js')).toBe(EMPTY_MATCH);
    expect(script('https://js.hcaptcha.com../1/api.js')).toBe(EMPTY_MATCH);
  });

  it('applies the Arkose suffix rule to exactly one leftmost label', () => {
    expect(script('https://example-api.arkoselabs.com/v2/key/api.js')).toEqual(['arkose-api-loader']);
    expect(script('https://a.example-api.arkoselabs.com/v2/key/api.js')).toBe(EMPTY_MATCH);
    expect(script('https://example.arkoselabs.com/v2/key/api.js')).toBe(EMPTY_MATCH);
    expect(script('https://arkoselabs.com/v2/key/api.js')).toBe(EMPTY_MATCH);
    expect(script('https://evilarkoselabs.com/v2/key/api.js')).toBe(EMPTY_MATCH);
    expect(script('https://' + 'a'.repeat(60) + '-api.arkoselabs.com/v2/key/api.js')).toBe(EMPTY_MATCH);
    expect(script('https://example-api.arkoselabs.com/v2/a/b/api.js')).toBe(EMPTY_MATCH);
  });

  it('matches exact paths and documented path templates only', () => {
    expect(script('https://www.recaptcha.net/recaptcha/enterprise.js')).toEqual(['recaptcha-loaders']);
    expect(script('https://www.google.com/recaptcha/api2/anchor')).toBe(EMPTY_MATCH);
    expect(script('https://js.datadome.co/tags.js')).toEqual(['datadome-tag']);
    expect(script('https://js.datadome.co/v4.1.2/tags.js')).toEqual(['datadome-tag']);
    expect(script('https://js.datadome.co/v4/tags.js')).toBe(EMPTY_MATCH);
    expect(script('https://cdn.jsdelivr.net/npm/@friendlycaptcha/sdk@0.1.2/site.min.js')).toEqual(['friendlycaptcha-v2-cdn-loader']);
    expect(script('https://cdn.jsdelivr.net/npm/%40friendlycaptcha/sdk@0.1.2/site.min.js')).toBe(EMPTY_MATCH);
  });

  it('never runs paths longer than 512 characters', () => {
    const stripe = (path: string) => matchNetworkRequest(index, { url: 'https://m.stripe.com' + path, resourceType: 'xmlhttprequest', statusCode: 200 }, now);
    expect(stripe('/' + 'a'.repeat(511))).toEqual(['stripe-risk-endpoint']);
    expect(stripe('/' + 'a'.repeat(512))).toBe(EMPTY_MATCH);
    expect(script('https://fpjscdn.net/v4/' + 'k'.repeat(600))).toBe(EMPTY_MATCH);
  });

  it('requires a received status: 2xx or 304', () => {
    for (const status of [200, 204, 299, 304]) expect(script('https://js.hcaptcha.com/1/api.js', status)).toEqual(['hcaptcha-loader']);
    for (const status of [199, 300, 301, 404, 500, 0, -1, 200.5, '200', null, undefined, NaN]) {
      expect(matchNetworkRequest(index, { url: 'https://js.hcaptcha.com/1/api.js', resourceType: 'script', statusCode: status }, now)).toBe(EMPTY_MATCH);
    }
  });

  it('checks the resource type', () => {
    expect(script('https://js.hcaptcha.com/1/api.js', 200, 'xmlhttprequest')).toBe(EMPTY_MATCH);
    expect(script('https://js.hcaptcha.com/1/api.js', 200, 'main_frame')).toBe(EMPTY_MATCH);
    expect(script('https://m.stripe.com/', 200, 'image')).toEqual(['stripe-risk-endpoint']);
    expect(script('https://m.stripe.com/', 200, 'main_frame')).toBe(EMPTY_MATCH);
  });

  it('stops matching at expiresAtMs', () => {
    const rule = index.rulesById.get('hcaptcha-loader');
    const at = (ms: number) => matchNetworkRequest(index, { url: 'https://js.hcaptcha.com/1/api.js', resourceType: 'script', statusCode: 200 }, ms);
    expect(rule).toBeDefined();
    expect(at((rule?.expiresAtMs ?? 0) - 1)).toEqual(['hcaptcha-loader']);
    expect(at(rule?.expiresAtMs ?? 0)).toBe(EMPTY_MATCH);
    expect(at(NaN)).toBe(EMPTY_MATCH);
  });

  it('returns EMPTY for garbage input and never throws', () => {
    const hostile = {
      get url(): string {
        throw new Error('getter');
      },
      resourceType: 'script',
      statusCode: 200,
    };
    const inputs: unknown[] = [null, undefined, 42, {}, hostile, { url: 42, resourceType: 'script', statusCode: 200 }];
    for (const input of inputs) expect(matchNetworkRequest(index, input as never, now)).toBe(EMPTY_MATCH);
    for (const url of ['not a url', 'ftp://js.hcaptcha.com/1/api.js', 'javascript:alert(1)', 'data:text/plain,x', 'https://' + 'a'.repeat(8200), '']) {
      expect(script(url)).toBe(EMPTY_MATCH);
    }
  });

  it('returns sorted unique frozen ids, at most 8', () => {
    const extra = Array.from({ length: 10 }, (_, i) =>
      compileRule({
        id: 'test-many-' + String(9 - i),
        vendorId: 'test-synthetic',
        testOnly: true,
        evidenceOrigin: 'network_request',
        conditions: { scheme: 'http', hostExact: 'many.test', pathExact: '/x.js' },
        expiresAt: '2099-12-31',
        meaningRu: 'Только тестовая сборка.',
        limitationsRu: 'Только тестовая сборка.',
      }),
    );
    const many = candidateIndex(extra);
    const result = matchNetworkRequest(many, { url: 'http://many.test/x.js', resourceType: 'script', statusCode: 200 }, now);
    expect(result).toHaveLength(8);
    expect([...result]).toEqual([...result].sort());
    expect(new Set(result).size).toBe(8);
    expect(result[0]).toBe('test-many-0');
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('keeps synthetic rules on their loopback port', () => {
    const synthetic = (url: string) => matchNetworkRequest(index, { url, resourceType: 'script', statusCode: 200 }, now);
    expect(synthetic('http://127.0.0.1:4174/vendors/synthetic/loader.js?session=CANARY')).toEqual(['test-synthetic-loader']);
    expect(synthetic('http://127.0.0.1:4173/vendors/synthetic/loader.js')).toBe(EMPTY_MATCH);
    expect(synthetic('http://localhost:4174/vendors/synthetic/loader.js')).toEqual(['test-synthetic-localhost-loader']);
  });
});

describe('matchParsedRequest', () => {
  const parsed = (over: Record<string, unknown>) =>
    matchParsedRequest(index, { scheme: 'https', hostname: 'js.hcaptcha.com', port: null, pathname: '/1/api.js', resourceType: 'script', statusCode: 200, ...over }, now);

  it('applies the same rules to WHATWG components', () => {
    expect(parsed({})).toEqual(['hcaptcha-loader']);
    expect(parsed({ port: 443 })).toEqual(['hcaptcha-loader']);
    expect(parsed({ hostname: 'JS.hcaptcha.com.' })).toEqual(['hcaptcha-loader']);
    expect(parsed({ port: 8443 })).toBe(EMPTY_MATCH);
    expect(parsed({ scheme: 'https:' })).toBe(EMPTY_MATCH);
    expect(parsed({ pathname: '/1/api.jsé' })).toBe(EMPTY_MATCH);
    expect(parsed({ pathname: '/1/api js' })).toBe(EMPTY_MATCH);
    expect(parsed({ port: '443' })).toBe(EMPTY_MATCH);
    expect(parsed({ statusCode: 404 })).toBe(EMPTY_MATCH);
    expect(matchParsedRequest(index, null as never, now)).toBe(EMPTY_MATCH);
  });

  it('does not touch an empty index', () => {
    expect(matchParsedRequest(buildCatalogIndex({ kind: 'production', catalogVersion: 'x', vendors: [], rules: [], candidateRuleCount: 0 }), null as never, now)).toBe(EMPTY_MATCH);
  });
});
