import { describe, expect, it } from 'vitest';
import type { HostEntry } from '@detect-expert/contracts';
import {
  MAX_RULE_IDS_PER_VENDOR,
  MAX_VENDORS,
  activeRule,
  catalogViewActive,
  deriveVendors,
  deriveVendorsFromSignals,
  type VendorCatalogView,
  type VendorRuleView,
  type VendorSignal,
} from '../src/index';

const NOW = 1_000_000;

function rule(ruleId: string, vendorId: string, strength: VendorRuleView['strength'] = 'documented-resource', extra: Partial<VendorRuleView> = {}): VendorRuleView {
  return { ruleId, vendorId, strength, evidenceOrigin: 'network_request', expiresAtMs: NOW + 1, ...extra };
}

function view(rules: VendorRuleView[], catalogVersion = 'test-1'): VendorCatalogView {
  return { catalogVersion, rulesById: new Map(rules.map((r) => [r.ruleId, r])) };
}

function host(ruleIds: string[], name = 'vendor.example'): HostEntry {
  return { registrableDomain: name, relation: 'cross-site', evidenceSource: 'browser-network', integrity: 'browser-observed', requestCount: 1, firstSeenBucket: 0, lastSeenBucket: 0, ruleIds };
}

const observed = (ruleId: string): VendorSignal => ({ ruleId, evidenceSource: 'browser-network', integrity: 'browser-observed' });
const page = (ruleId: string, evidenceSource: VendorSignal['evidenceSource'] = 'page-dom'): VendorSignal => ({ ruleId, evidenceSource, integrity: 'page-controlled' });

describe('deriveVendors (S10, ADR-009 v1.1)', () => {
  it('a documented-resource network rule on a browser-observed host -> documented-resource, browser-network/browser-observed', () => {
    const v = view([rule('a-loader', 'a')]);
    expect(deriveVendors([host(['a-loader'])], v, NOW)).toEqual([
      { vendorId: 'a', vendorConfidence: 'documented-resource', ruleIds: ['a-loader'], evidenceSource: 'browser-network', integrity: 'browser-observed' },
    ]);
  });

  it('drops unknown rule ids and rules at or after expiresAtMs', () => {
    const v = view([rule('a-loader', 'a', 'documented-resource', { expiresAtMs: NOW }), rule('b-loader', 'b', 'documented-resource', { expiresAtMs: NOW + 1 })]);
    expect(deriveVendors([host(['a-loader', 'missing', 'b-loader'])], v, NOW).map((x) => x.vendorId)).toEqual(['b']);
    expect(deriveVendors([host(['a-loader', 'b-loader'])], v, NOW + 1)).toEqual([]);
    expect(deriveVendors([host(['a-loader'])], v, Number.NaN)).toEqual([]);
  });

  it('groups by vendorId with sorted unique rule ids across hosts', () => {
    const v = view([rule('a-2', 'a', 'weak-signal'), rule('a-1', 'a'), rule('b-1', 'b', 'weak-signal')]);
    const out = deriveVendors([host(['a-2', 'b-1']), host(['a-1', 'a-2'], 'cdn.example')], v, NOW);
    expect(out.map((x) => [x.vendorId, x.vendorConfidence, x.ruleIds])).toEqual([
      ['a', 'documented-resource', ['a-1', 'a-2']],
      ['b', 'weak-signal', ['b-1']],
    ]);
  });

  it('two or more rules with a browser-observed signal and no documented resource -> multi-signal, derived/derived', () => {
    const v = view([rule('a-host-1', 'a', 'weak-signal'), rule('a-host-2', 'a', 'weak-signal')]);
    expect(deriveVendors([host(['a-host-1', 'a-host-2'])], v, NOW)).toEqual([
      { vendorId: 'a', vendorConfidence: 'multi-signal', ruleIds: ['a-host-1', 'a-host-2'], evidenceSource: 'derived', integrity: 'derived' },
    ]);
  });

  it('a single host-only network rule -> weak-signal, browser-network/browser-observed', () => {
    const v = view([rule('a-host', 'a', 'weak-signal')]);
    expect(deriveVendors([host(['a-host'])], v, NOW)).toEqual([
      { vendorId: 'a', vendorConfidence: 'weak-signal', ruleIds: ['a-host'], evidenceSource: 'browser-network', integrity: 'browser-observed' },
    ]);
  });

  it('a documented-resource strength on a non-network rule never gives documented-resource', () => {
    const v = view([rule('a-cookie', 'a', 'documented-resource', { evidenceOrigin: 'cookie_name' })]);
    expect(deriveVendors([host(['a-cookie'])], v, NOW)[0]?.vendorConfidence).toBe('weak-signal');
  });

  it('sorts by level rank, then vendorId', () => {
    const v = view([
      rule('z-doc', 'z'),
      rule('m-1', 'm', 'weak-signal'),
      rule('m-2', 'm', 'weak-signal'),
      rule('b-weak', 'b', 'weak-signal'),
      rule('a-doc', 'a'),
    ]);
    const out = deriveVendors([host(['b-weak', 'm-1', 'm-2', 'z-doc', 'a-doc'])], v, NOW);
    expect(out.map((x) => [x.vendorId, x.vendorConfidence])).toEqual([
      ['a', 'documented-resource'],
      ['z', 'documented-resource'],
      ['m', 'multi-signal'],
      ['b', 'weak-signal'],
    ]);
  });

  it('bounds: at most 32 rule ids per vendor and 128 vendors', () => {
    const many = Array.from({ length: 40 }, (_, i) => rule('a-' + String(i).padStart(2, '0'), 'a', 'weak-signal'));
    const hosts = [host(many.slice(0, 20).map((r) => r.ruleId)), host(many.slice(20).map((r) => r.ruleId), 'two.example')];
    const out = deriveVendors(hosts, view(many), NOW);
    expect(out[0]?.ruleIds).toHaveLength(MAX_RULE_IDS_PER_VENDOR);
    expect(out[0]?.ruleIds[0]).toBe('a-00');
    const vendors = Array.from({ length: 140 }, (_, i) => rule('r-' + String(i).padStart(3, '0'), 'v' + String(i).padStart(3, '0'), 'weak-signal'));
    const spread = Array.from({ length: 5 }, (_, h) => host(vendors.slice(h * 28, h * 28 + 28).map((r) => r.ruleId), 'h' + String(h) + '.example'));
    const all = deriveVendors(spread, view(vendors), NOW);
    expect(all).toHaveLength(MAX_VENDORS);
    expect(all[0]?.vendorId).toBe('v000');
  });

  it('ignores host entries that are not browser-observed network entries and ill-formed ids', () => {
    const v = view([rule('a-loader', 'a'), rule('bad/id', 'a'), rule('ok-rule', 'bad vendor')]);
    const forged = { ...host(['a-loader']), integrity: 'page-controlled' } as unknown as HostEntry;
    expect(deriveVendors([forged], v, NOW)).toEqual([]);
    expect(deriveVendors([host(['bad/id', 'ok-rule'])], v, NOW)).toEqual([]);
    expect(activeRule(v, 'a-loader', NOW)?.vendorId).toBe('a');
    expect(activeRule(v, 42, NOW)).toBeNull();
  });

  it('catalogViewActive needs a view with at least one rule', () => {
    expect(catalogViewActive(null)).toBe(false);
    expect(catalogViewActive(undefined)).toBe(false);
    expect(catalogViewActive(view([]))).toBe(false);
    expect(catalogViewActive(view([rule('a', 'a')]))).toBe(true);
  });
});

describe('deriveVendorsFromSignals', () => {
  it('two page-controlled signals never give multi-signal; provenance stays page-controlled', () => {
    const v = view([rule('a-global', 'a', 'weak-signal', { evidenceOrigin: 'global_name' }), rule('a-dom', 'a', 'weak-signal', { evidenceOrigin: 'dom_attribute' })]);
    expect(deriveVendorsFromSignals([page('a-global', 'page-hook'), page('a-dom')], v, NOW)).toEqual([
      { vendorId: 'a', vendorConfidence: 'weak-signal', ruleIds: ['a-dom', 'a-global'], evidenceSource: 'page-dom', integrity: 'page-controlled' },
    ]);
  });

  it('a page-controlled documented-resource signal is not documented-resource', () => {
    const v = view([rule('a-loader', 'a')]);
    expect(deriveVendorsFromSignals([page('a-loader')], v, NOW)[0]?.vendorConfidence).toBe('weak-signal');
  });

  it('one page-controlled and one browser-observed rule -> multi-signal (derived)', () => {
    const v = view([rule('a-host', 'a', 'weak-signal'), rule('a-dom', 'a', 'weak-signal', { evidenceOrigin: 'dom_attribute' })]);
    expect(deriveVendorsFromSignals([observed('a-host'), page('a-dom')], v, NOW)[0]).toMatchObject({ vendorConfidence: 'multi-signal', evidenceSource: 'derived', integrity: 'derived' });
  });

  it('the same rule observed twice is still one rule (no multi-signal from repetition)', () => {
    const v = view([rule('a-host', 'a', 'weak-signal')]);
    expect(deriveVendorsFromSignals([observed('a-host'), observed('a-host'), page('a-host')], v, NOW)[0]).toMatchObject({ vendorConfidence: 'weak-signal', ruleIds: ['a-host'] });
  });

  it('is deterministic for any signal order', () => {
    const v = view([rule('a-1', 'a'), rule('b-1', 'b', 'weak-signal'), rule('b-2', 'b', 'weak-signal')]);
    const signals = [observed('b-2'), observed('a-1'), observed('b-1')];
    const first = deriveVendorsFromSignals(signals, v, NOW);
    expect(deriveVendorsFromSignals([...signals].reverse(), v, NOW)).toEqual(first);
  });
});
