import { describe, expect, it } from 'vitest';
import { CompileError, compileRule, compileVendor, emitCatalogModule, endOfUtcDayMs, purposeKeyFor } from '../src/compile';
import type { SourceRule } from '../src/types';
import { seed, seedRule } from './helpers';

const withConditions = (id: string, conditions: Record<string, unknown>, extra: Partial<SourceRule> = {}): SourceRule => ({
  ...seedRule(id),
  conditions,
  ...extra,
});

describe('compileRule over the seed', () => {
  const compiled = seed.rules.map((r) => compileRule(r));

  it('compiles all 20 candidate rules: 16 network matchers and 4 without a network matcher', () => {
    expect(compiled).toHaveLength(20);
    expect(compiled.filter((r) => r.network !== null)).toHaveLength(16);
    const pageRules = compiled.filter((r) => r.network === null);
    expect(pageRules.map((r) => r.ruleId).sort()).toEqual(['aws-waf-sdk-globals', 'cloudflare-bot-cookie', 'human-cookie-names', 'paypal-fraudnet-parameter-marker']);
    for (const r of pageRules) expect(r.strength).toBe('weak-signal');
    for (const r of compiled) {
      expect(r.testOnly).toBe(false);
      expect(r.ruleVersion).toBe('0');
      expect(r.expiresAtMs).toBe(Date.UTC(2026, 11, 12));
    }
  });

  it('host and path rules are documented-resource; the host-only Stripe rule is weak-signal', () => {
    const byId = new Map(compiled.map((r) => [r.ruleId, r]));
    expect(byId.get('hcaptcha-loader')?.strength).toBe('documented-resource');
    expect(byId.get('datadome-tag')?.strength).toBe('documented-resource');
    const stripe = byId.get('stripe-risk-endpoint');
    expect(stripe?.strength).toBe('weak-signal');
    expect(stripe?.network?.paths).toEqual([]);
    expect(stripe?.network?.pathPattern).toBeNull();
    expect(stripe?.network?.resourceType).toBeNull();
  });

  it('Arkose compiles to a suffix matcher with a leftmost-label pattern and a path pattern', () => {
    const arkose = compiled.find((r) => r.ruleId === 'arkose-api-loader');
    expect(arkose?.network?.hosts).toEqual([]);
    expect(arkose?.network?.suffix?.labels).toBe('arkoselabs.com');
    expect(arkose?.network?.suffix?.leftmost?.test('example-api')).toBe(true);
    expect(arkose?.network?.suffix?.leftmost?.test('example')).toBe(false);
    expect(arkose?.network?.pathPattern?.test('/v2/key/api.js')).toBe(true);
  });

  it('candidates without English texts fall back to Russian', () => {
    const r = compiled.find((x) => x.ruleId === 'hcaptcha-loader');
    expect(r?.meaning.en).toBe(r?.meaning.ru);
    expect(r?.limitations.en).toBe(r?.limitations.ru);
  });

  it('expiresAtMs is the exclusive end of the UTC day', () => {
    expect(endOfUtcDayMs('2026-12-11')).toBe(Date.UTC(2026, 11, 12));
    expect(endOfUtcDayMs('2099-12-31')).toBe(Date.UTC(2100, 0, 1));
    expect(() => endOfUtcDayMs('2026-02-30')).toThrow(CompileError);
    expect(() => endOfUtcDayMs('2026-1-1')).toThrow(CompileError);
  });
});

describe('compileRule rejects shapes outside ADR-009 v1.1', () => {
  const hc = seedRule('hcaptcha-loader').conditions;
  const cases: Array<[string, SourceRule]> = [
    ['unknown network key', withConditions('hcaptcha-loader', { ...hc, hostRegex: '^x$' })],
    ['combined URL key', withConditions('hcaptcha-loader', { ...hc, urlRegex: '^/x$' })],
    ['combined host/path key', withConditions('hcaptcha-loader', { scheme: 'https', hostPath: 'js.hcaptcha.com/1/api.js' })],
    ['empty hostOneOf', withConditions('hcaptcha-loader', { scheme: 'https', hostOneOf: [], pathExact: '/1/api.js' })],
    ['empty pathOneOf', withConditions('hcaptcha-loader', { scheme: 'https', hostExact: 'js.hcaptcha.com', pathOneOf: [] })],
    ['two host keys', withConditions('hcaptcha-loader', { ...hc, hostSuffixLabels: 'hcaptcha.com' })],
    ['two path keys', withConditions('hcaptcha-loader', { ...hc, pathRegex: '^/1/api\\.js$' })],
    ['missing scheme', withConditions('hcaptcha-loader', { hostExact: 'js.hcaptcha.com', pathExact: '/1/api.js' })],
    ['portExact without testOnly', withConditions('hcaptcha-loader', { ...hc, portExact: 8443 })],
    ['unknown resourceType', withConditions('hcaptcha-loader', { ...hc, resourceType: 'main_frame' })],
    ['uppercase host', withConditions('hcaptcha-loader', { ...hc, hostExact: 'JS.hcaptcha.com' })],
    ['path with query', withConditions('hcaptcha-loader', { ...hc, pathExact: '/1/api.js?x=1' })],
    ['unanchored regex', withConditions('datadome-tag', { scheme: 'https', hostExact: 'js.datadome.co', pathRegex: '/tags\\.js' })],
    ['cookie rule with a network key', withConditions('cloudflare-bot-cookie', { nameExact: '__cf_bm', hostExact: 'example.com' })],
    ['empty cookie alternatives', withConditions('human-cookie-names', { nameOneOf: [] })],
    ['cookie rule with both name keys', withConditions('cloudflare-bot-cookie', { nameExact: '__cf_bm', nameOneOf: ['_x'] })],
    ['global rule that may read values', withConditions('aws-waf-sdk-globals', { ownDataPropertyOneOf: ['AwsWafIntegration'] })],
    ['DOM rule that may read content', withConditions('paypal-fraudnet-parameter-marker', { tagExact: 'SCRIPT', attributeExact: 'fncls' })],
    ['empty conditions', withConditions('hcaptcha-loader', {})],
    ['invalid expiry date', { ...seedRule('hcaptcha-loader'), expiresAt: '2026-13-01' }],
    ['testOnly page rule', { ...seedRule('cloudflare-bot-cookie'), testOnly: true }],
    ['ruleVersion and version disagree', { ...seedRule('hcaptcha-loader'), ruleVersion: '1', version: '2' }],
  ];
  for (const [name, rule] of cases) {
    it(name, () => expect(() => compileRule(rule)).toThrow(CompileError));
  }

  it('allows portExact and loopback hosts for testOnly rules', () => {
    const rule = compileRule({ ...seedRule('hcaptcha-loader'), id: 'test-x', vendorId: 'test-v', testOnly: true, conditions: { scheme: 'http', hostExact: '127.0.0.1', portExact: 4174, pathExact: '/x.js' } });
    expect(rule.network?.port).toBe(4174);
    expect(rule.testOnly).toBe(true);
  });
});

describe('compileVendor', () => {
  it('maps the category to a purpose key with the spec override for ThreatMetrix', () => {
    const tm = seed.vendors.find((v) => v.id === 'threatmetrix');
    const dd = seed.vendors.find((v) => v.id === 'datadome');
    expect(tm && compileVendor(tm).purposeKey).toBe('card_vendor_threatmetrix_purpose');
    expect(dd && compileVendor(dd).purposeKey).toBe('card_vendor_category_bot');
    expect(purposeKeyFor('x', 'unknown-category')).toBe('card_vendor_purpose_generic');
    expect(() => compileVendor({ id: 'x', name: 'X', category: 'unknown' })).toThrow(CompileError);
  });
});

describe('emitCatalogModule', () => {
  const rules = seed.rules.map((r) => compileRule(r));
  const vendors = seed.vendors.filter((v) => rules.some((r) => r.vendorId === v.id)).map((v) => compileVendor(v));
  const spec = { sources: ['packages/catalog/data/vendors.seed.json'], note: 'test module', versionName: 'TEST_VERSION', version: 'test-1', vendorsName: 'TEST_VENDORS', rulesName: 'TEST_RULES', vendors, rules };

  it('is deterministic and independent of input order', () => {
    const a = emitCatalogModule(spec);
    const b = emitCatalogModule({ ...spec, rules: [...rules].reverse(), vendors: [...vendors].reverse() });
    expect(a).toBe(b);
  });

  it('contains no scheme-qualified URLs and no dates, and emits regex literals', () => {
    const out = emitCatalogModule(spec);
    expect(out).not.toMatch(/https?:\/\//i);
    expect(out).not.toMatch(/\b20\d\d-\d\d-\d\d\b/);
    // V8's RegExp#source escapes '/' outside classes only; both forms are valid regex literals.
    expect(out).toContain('pathPattern: /^\\/v4\\/[^/]{1,256}(?:\\/iife\\.min\\.js)?$/,');
    expect(out).toContain('leftmost: /^[a-z0-9-]{1,57}-api$/');
    expect(out).toContain('network: null,');
  });

  it('refuses URLs in the header and invalid export names', () => {
    expect(() => emitCatalogModule({ ...spec, note: 'see https:' + '//example.invalid' })).toThrow(CompileError);
    expect(() => emitCatalogModule({ ...spec, versionName: 'lowercase' })).toThrow(CompileError);
  });
});
