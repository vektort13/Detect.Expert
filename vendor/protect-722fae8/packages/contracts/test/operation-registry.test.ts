// ADR-017 registry invariants: operation codes are enum-only, bounded, unique and allowlisted per technique;
// TECHNIQUE_SIGNALS satisfies the MAIN key layout constraints; every (technique, op) pair has an API name.

import { describe, expect, it } from 'vitest';
import {
  BUDGETS,
  OPERATION_API_NAMES,
  OPERATION_CODES,
  PAGE_OPERATIONS,
  SIGNAL_CODES,
  TECHNIQUE_IDS,
  TECHNIQUE_SIGNALS,
  isPageOperation,
  operationApiName,
  pageOperations,
  techniqueSignals,
  type TechniqueId,
} from '../src/index';

const CODE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const entries = Object.entries(PAGE_OPERATIONS) as Array<[TechniqueId, readonly string[]]>;

describe('PAGE_OPERATIONS', () => {
  it('every technique id is a registry id and every list is non-empty', () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const [techniqueId, list] of entries) {
      expect(TECHNIQUE_IDS).toContain(techniqueId);
      expect(list.length, techniqueId).toBeGreaterThan(0);
    }
  });

  it('codes are unique, kebab-case, at most 32 chars and at most 63 per technique', () => {
    const seen = new Set<string>();
    for (const [techniqueId, list] of entries) {
      expect(list.length, techniqueId).toBeLessThanOrEqual(BUDGETS.maxOperationCodesPerTechnique);
      for (const op of list) {
        expect(op, techniqueId).toMatch(CODE_RE);
        expect(op.length, op).toBeLessThanOrEqual(BUDGETS.maxOperationCodeChars);
        expect(seen.has(op), 'duplicate ' + op).toBe(false);
        seen.add(op);
      }
    }
    expect(BUDGETS.maxOperationCodesPerTechnique).toBe(63);
    expect(BUDGETS.maxOperationCodeChars).toBe(32);
  });

  it('OPERATION_CODES is exactly the union of the lists in TECHNIQUE_IDS order (57 codes)', () => {
    const union: string[] = [];
    for (const techniqueId of TECHNIQUE_IDS) union.push(...pageOperations(techniqueId));
    expect([...OPERATION_CODES]).toEqual(union);
    expect(OPERATION_CODES).toHaveLength(57);
    expect(new Set(OPERATION_CODES).size).toBe(OPERATION_CODES.length);
  });

  it('pageOperations defaults to an empty list and the tables are frozen', () => {
    expect(pageOperations('DET-001')).toEqual([]);
    expect(pageOperations('DET-011')[0]).toBe('param-vendor');
    expect(Object.isFrozen(PAGE_OPERATIONS)).toBe(true);
    for (const [, list] of entries) expect(Object.isFrozen(list)).toBe(true);
    expect(Object.isFrozen(TECHNIQUE_SIGNALS)).toBe(true);
    expect(Object.isFrozen(OPERATION_API_NAMES)).toBe(true);
  });

  it('isPageOperation accepts only allowlisted pairs and never coerces', () => {
    expect(isPageOperation('DET-011', 'param-renderer')).toBe(true);
    expect(isPageOperation('DET-025', 'user-agent')).toBe(true);
    expect(isPageOperation('DET-001', 'user-agent')).toBe(false);
    expect(isPageOperation('DET-025', 'param-renderer')).toBe(false);
    expect(isPageOperation('DET-999', 'user-agent')).toBe(false);
    for (const bad of [1, '', null, undefined, {}, ['user-agent'], 'USER-AGENT', 'https://x']) {
      expect(isPageOperation('DET-025', bad)).toBe(false);
    }
    let coerced = false;
    const hostile = { toString(): string { coerced = true; return 'user-agent'; } };
    expect(isPageOperation('DET-025', hostile)).toBe(false);
    expect(coerced).toBe(false);
  });

  it('isPageOperation survives Map/Set prototype poisoning after load (F168)', () => {
    const setHas = Set.prototype.has;
    const mapGet = Map.prototype.get;
    const results: boolean[] = [];
    try {
      Set.prototype.has = () => true;
      Map.prototype.get = () => undefined;
      results.push(isPageOperation('DET-001', 'anything'), isPageOperation('DET-011', 'param-renderer'));
    } finally {
      Set.prototype.has = setHas;
      Map.prototype.get = mapGet;
    }
    expect(results).toEqual([false, true]);
  });
});

describe('TECHNIQUE_SIGNALS', () => {
  it('every list: technique id known, <= 8 codes, [0] = api-use, unique, registry members, no bfcache-restore', () => {
    for (const techniqueId of TECHNIQUE_IDS) {
      const list = techniqueSignals(techniqueId);
      expect(list.length, techniqueId).toBeGreaterThanOrEqual(1);
      expect(list.length, techniqueId).toBeLessThanOrEqual(BUDGETS.maxSignalCodesPerObservation);
      expect(list[0], techniqueId).toBe('api-use');
      expect(new Set(list).size, techniqueId).toBe(list.length);
      for (const code of list) expect(SIGNAL_CODES).toContain(code);
      expect(list, techniqueId).not.toContain('bfcache-restore');
    }
    for (const techniqueId of Object.keys(TECHNIQUE_SIGNALS)) expect(TECHNIQUE_IDS).toContain(techniqueId);
  });

  it('canvas techniques DET-001/002/004 share one order; defaults are [api-use]', () => {
    expect(techniqueSignals('DET-001')).toEqual(['api-use', 'readback-after-text', 'tainted-canvas-attempt']);
    expect(techniqueSignals('DET-002')).toEqual(techniqueSignals('DET-001'));
    expect(techniqueSignals('DET-004')).toEqual(techniqueSignals('DET-001'));
    expect(techniqueSignals('DET-003')).toEqual(['api-use', 'text-drawn', 'text-measured']);
    expect(techniqueSignals('DET-015')).toEqual(['api-use', 'offline-render']);
    expect(techniqueSignals('DET-022')).toEqual(['api-use', 'numeric-diversity', 'sample-budget-exceeded']);
    for (const t of ['DET-005', 'DET-011', 'DET-012', 'DET-025', 'DET-026', 'DET-029', 'DET-032', 'DET-033'] as const) {
      expect(techniqueSignals(t), t).toEqual(['api-use', 'sample-budget-exceeded']);
    }
    expect(techniqueSignals('DET-039')).toEqual(['api-use']);
  });
});

describe('OPERATION_API_NAMES', () => {
  it('every (technique, op) pair has a non-empty printable ASCII API name', () => {
    for (const [techniqueId, list] of entries) {
      for (const op of list) {
        const name = operationApiName(op as (typeof OPERATION_CODES)[number]);
        expect(typeof name, techniqueId + ' ' + op).toBe('string');
        expect(name.length, op).toBeGreaterThan(0);
        expect(name, op).toMatch(/^[\x20-\x7e]+$/);
      }
    }
    expect(Object.keys(OPERATION_API_NAMES).sort()).toEqual([...OPERATION_CODES].sort());
  });

  it('names follow the documented examples', () => {
    expect(OPERATION_API_NAMES['get-client-rects']).toBe('Element.getClientRects');
    expect(OPERATION_API_NAMES['offset-width']).toBe('HTMLElement.offsetWidth');
    expect(OPERATION_API_NAMES['param-unmasked-renderer']).toBe('WebGL getParameter(UNMASKED_RENDERER_WEBGL)');
    expect(OPERATION_API_NAMES['param-unclassified']).toBe('WebGL getParameter(?)');
    expect(OPERATION_API_NAMES['connect-osc-compressor']).toBe('AudioNode.connect(Oscillator->DynamicsCompressor)');
    expect(OPERATION_API_NAMES['get-high-entropy-values']).toBe('NavigatorUAData.getHighEntropyValues');
    expect(OPERATION_API_NAMES['query']).toBe('Permissions.query');
    expect(OPERATION_API_NAMES['state-location']).toBe('PermissionStatus.state');
  });
});
