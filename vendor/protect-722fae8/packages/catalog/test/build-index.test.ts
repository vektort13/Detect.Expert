import { describe, expect, it } from 'vitest';
import { buildCatalogIndex, CatalogInvariantError, EMPTY_CATALOG } from '../src/build-index';
import { compileRule, compileVendor } from '../src/compile';
import { PRODUCTION_CATALOG } from '../src/production';
import { SYNTHETIC_TEST_CATALOG } from '../src/synthetic';
import type { CatalogInput, CompiledRule, CompiledVendor } from '../src/types';
import { seed, seedRule } from './helpers';

const vendor = (id: string): CompiledVendor => {
  const v = seed.vendors.find((x) => x.id === id);
  if (!v) throw new Error(id);
  return compileVendor(v);
};
const hcaptcha = compileRule(seedRule('hcaptcha-loader'));
const arkose = compileRule(seedRule('arkose-api-loader'));
const testVendor: CompiledVendor = { vendorId: 'test-v', displayName: 'Test vendor', category: 'bot', purposeKey: 'card_vendor_category_bot' };
const testRule = compileRule({ ...seedRule('hcaptcha-loader'), id: 'test-r', vendorId: 'test-v', testOnly: true, conditions: { scheme: 'http', hostExact: '127.0.0.1', portExact: 4174, pathExact: '/x.js' } });

function input(over: Partial<CatalogInput> = {}): CatalogInput {
  return { kind: 'test', catalogVersion: 'v1', vendors: [vendor('hcaptcha'), vendor('arkose'), testVendor], rules: [hcaptcha, arkose, testRule], candidateRuleCount: 0, ...over };
}
const withNetwork = (rule: CompiledRule, network: Record<string, unknown>): CompiledRule => ({ ...rule, network: { ...(rule.network as object), ...network } as unknown as CompiledRule['network'] });

describe('shipped catalogs', () => {
  it('PRODUCTION_CATALOG has no rules while the gate is closed, and counts 20 candidates', () => {
    expect(PRODUCTION_CATALOG.kind).toBe('production');
    expect(PRODUCTION_CATALOG.rules.length).toBe(0);
    expect(PRODUCTION_CATALOG.networkByHost.size).toBe(0);
    expect(PRODUCTION_CATALOG.networkBySuffix.size).toBe(0);
    expect(PRODUCTION_CATALOG.candidateRuleCount).toBe(20);
    expect(PRODUCTION_CATALOG.catalogVersion).toMatch(new RegExp('^' + seed.catalogVersion.replaceAll('.', '\\.') + '\\.[0-9a-f]{8}$'));
  });

  it('SYNTHETIC_TEST_CATALOG adds only the testOnly loopback vendor', () => {
    expect(SYNTHETIC_TEST_CATALOG.kind).toBe('test');
    expect(SYNTHETIC_TEST_CATALOG.catalogVersion).toBe('synthetic-test-1');
    expect(SYNTHETIC_TEST_CATALOG.rules.map((r) => r.ruleId)).toEqual(['test-synthetic-loader', 'test-synthetic-localhost-loader']);
    expect(SYNTHETIC_TEST_CATALOG.rules.every((r) => r.testOnly)).toBe(true);
    expect([...SYNTHETIC_TEST_CATALOG.vendorsById.keys()]).toEqual(['test-synthetic']);
    expect([...SYNTHETIC_TEST_CATALOG.networkByHost.keys()].sort()).toEqual(['127.0.0.1', 'localhost']);
  });

  it('EMPTY_CATALOG is empty and frozen', () => {
    expect(EMPTY_CATALOG.rules).toEqual([]);
    expect(Object.isFrozen(EMPTY_CATALOG)).toBe(true);
    expect(Object.isFrozen(EMPTY_CATALOG.rules)).toBe(true);
  });
});

describe('buildCatalogIndex', () => {
  it('builds frozen host and suffix maps', () => {
    const index = buildCatalogIndex(input());
    expect(index.rules.map((r) => r.ruleId)).toEqual(['arkose-api-loader', 'hcaptcha-loader', 'test-r']);
    expect(index.networkByHost.get('js.hcaptcha.com')?.map((r) => r.ruleId)).toEqual(['hcaptcha-loader']);
    expect(index.networkBySuffix.get('arkoselabs.com')?.map((r) => r.ruleId)).toEqual(['arkose-api-loader']);
    const rule = index.rulesById.get('hcaptcha-loader');
    expect(Object.isFrozen(rule)).toBe(true);
    expect(Object.isFrozen(rule?.network)).toBe(true);
    expect(Object.isFrozen(rule?.network?.paths)).toBe(true);
  });

  const violations: Array<[string, () => CatalogInput]> = [
    ['unknown kind', () => input({ kind: 'staging' as never })],
    ['invalid catalogVersion', () => input({ catalogVersion: 'a/b' })],
    ['negative candidate count', () => input({ candidateRuleCount: -1 })],
    ['duplicate ruleId', () => input({ rules: [hcaptcha, hcaptcha] })],
    ['duplicate vendorId', () => input({ vendors: [vendor('hcaptcha'), vendor('hcaptcha')] })],
    ['rule without a catalog vendor', () => input({ vendors: [vendor('hcaptcha'), testVendor] })],
    ['invalid ruleId', () => input({ rules: [{ ...hcaptcha, ruleId: 'Bad Id' }] })],
    ['uppercase host', () => input({ rules: [withNetwork(hcaptcha, { hosts: ['JS.hcaptcha.com'] })] })],
    ['host with a trailing dot', () => input({ rules: [withNetwork(hcaptcha, { hosts: ['js.hcaptcha.com.'] })] })],
    ['path without a leading slash', () => input({ rules: [withNetwork(hcaptcha, { paths: ['1/api.js'] })] })],
    ['path longer than 512', () => input({ rules: [withNetwork(hcaptcha, { paths: ['/' + 'a'.repeat(512)] })] })],
    ['17 hosts', () => input({ rules: [withNetwork(hcaptcha, { hosts: Array.from({ length: 17 }, (_, i) => 'h' + i + '.example') })] })],
    ['17 paths', () => input({ rules: [withNetwork(hcaptcha, { paths: Array.from({ length: 17 }, (_, i) => '/p' + i) })] })],
    ['257 rules', () => input({ rules: Array.from({ length: 257 }, (_, i) => ({ ...hcaptcha, ruleId: 'r-' + i })) })],
    ['testOnly in a production catalog', () => input({ kind: 'production' })],
    ['port without testOnly', () => input({ rules: [withNetwork(hcaptcha, { port: 8443 })] })],
    ['IP host without testOnly', () => input({ rules: [withNetwork(hcaptcha, { hosts: ['10.0.0.1'] })] })],
    ['localhost without testOnly', () => input({ rules: [withNetwork(hcaptcha, { hosts: ['localhost'] })] })],
    ['public host on a testOnly rule', () => input({ rules: [withNetwork(testRule, { hosts: ['example.com'] })] })],
    ['testOnly rule on a non-test vendor', () => input({ rules: [{ ...testRule, vendorId: 'hcaptcha' }] })],
    ['strength mismatch', () => input({ rules: [{ ...hcaptcha, strength: 'weak-signal' }] })],
    ['network matcher on a cookie rule', () => input({ rules: [{ ...hcaptcha, evidenceOrigin: 'cookie_name' }] })],
    ['pattern with flags', () => input({ rules: [withNetwork(arkose, { pathPattern: /^\/v2\/x$/i })] })],
    ['unanchored pattern', () => input({ rules: [withNetwork(arkose, { pathPattern: /v2/ })] })],
    ['paths and pattern together', () => input({ rules: [withNetwork(arkose, { paths: ['/x'] })] })],
    ['hosts and suffix together', () => input({ rules: [withNetwork(arkose, { hosts: ['x.arkoselabs.com'] })] })],
    ['unknown resource type', () => input({ rules: [withNetwork(hcaptcha, { resourceType: 'main_frame' })] })],
    ['empty meaning', () => input({ rules: [{ ...hcaptcha, meaning: { ru: '', en: 'x' } }] })],
    ['non-integer expiry', () => input({ rules: [{ ...hcaptcha, expiresAtMs: 1.5 }] })],
    ['unknown vendor category', () => input({ vendors: [{ ...testVendor, category: 'other' }], rules: [testRule] })],
  ];
  for (const [name, make] of violations) {
    it('rejects ' + name, () => expect(() => buildCatalogIndex(make())).toThrow(CatalogInvariantError));
  }
});
