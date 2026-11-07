import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalCatalogJson, compileRule, compileVendor, emitCatalogModule, productionModuleSpec, syntheticModuleSpec } from '../src/compile';
import { CANDIDATE_RULE_COUNT, PRODUCTION_CATALOG_VERSION, PRODUCTION_RULES, PRODUCTION_VENDORS } from '../src/generated/production-catalog';
import { SYNTHETIC_CATALOG_VERSION, SYNTHETIC_RULES, SYNTHETIC_VENDORS } from '../src/generated/synthetic-catalog';
import { readRepoText, seed, synthetic } from './helpers';

// gen-catalog.mjs --check is the authoritative staleness check (it also runs the registry lint); these
// tests pin the emitter contract: the committed modules are byte-for-byte what emitCatalogModule produces.
describe('generated catalog modules', () => {
  it('production-catalog.ts is empty while the gate is closed and matches the emitter byte for byte', () => {
    expect(PRODUCTION_RULES).toEqual([]);
    expect(PRODUCTION_VENDORS).toEqual([]);
    expect(CANDIDATE_RULE_COUNT).toBe(seed.rules.length);
    const digest = createHash('sha256').update(canonicalCatalogJson([], [])).digest('hex').slice(0, 8);
    expect(PRODUCTION_CATALOG_VERSION).toBe(seed.catalogVersion + '.' + digest);
    const emitted = emitCatalogModule(productionModuleSpec(PRODUCTION_CATALOG_VERSION, CANDIDATE_RULE_COUNT, [], []));
    expect(readRepoText('packages/catalog/src/generated/production-catalog.ts')).toBe(emitted);
  });

  it('synthetic-catalog.ts is the compiled fixtures/vendors/synthetic/catalog.json byte for byte', () => {
    const rules = synthetic.rules.map((r) => compileRule(r));
    const vendors = synthetic.vendors.map((v) => compileVendor(v));
    expect(SYNTHETIC_CATALOG_VERSION).toBe(synthetic.catalogVersion);
    expect(SYNTHETIC_RULES).toEqual(rules);
    expect(SYNTHETIC_VENDORS).toEqual(vendors);
    const emitted = emitCatalogModule(syntheticModuleSpec(synthetic.catalogVersion, vendors, rules));
    expect(readRepoText('packages/catalog/src/generated/synthetic-catalog.ts')).toBe(emitted);
  });

  it('generated modules contain no scheme-qualified URLs', () => {
    for (const file of ['production-catalog.ts', 'synthetic-catalog.ts']) {
      expect(readRepoText('packages/catalog/src/generated/' + file)).not.toMatch(/https?:\/\//i);
    }
  });
});
