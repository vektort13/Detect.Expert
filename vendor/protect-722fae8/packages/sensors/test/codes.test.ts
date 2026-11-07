// Key layout v2 (ADR-017 §4, task E06-03): round-trip of every declared (technique, phase, operation, signal subset),
// Smi bound, canvas compatibility with the v1 decoding, install-time errors and load-time layout invariants.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { PHASES, TECHNIQUE_IDS, pageOperations, techniqueSignals } from '@detect-expert/contracts';
import { API_USE, PHASE_INDEX, TECHNIQUE_INDEX, compositeKey, decodeKey, operationIndex, signalBit } from '../src/codes';

describe('key layout v2', () => {
  it('round-trips every operation x phase x signal subset of every technique without collisions', () => {
    const keys = new Set<number>();
    let max = 0;
    for (let t = 0; t < TECHNIQUE_IDS.length; t++) {
      const id = TECHNIQUE_IDS[t]!;
      const signals = techniqueSignals(id);
      const ops = pageOperations(id);
      for (let p = 0; p < PHASES.length; p++) {
        for (let op = 0; op <= ops.length; op++) {
          for (let mask = 0; mask < 1 << signals.length; mask++) {
            const key = compositeKey(t, p, mask, op);
            expect(keys.has(key)).toBe(false);
            keys.add(key);
            if (key > max) max = key;
            const expected = {
              techniqueId: id,
              phase: PHASES[p],
              signalCodes: signals.filter((_s, i) => (mask & (1 << i)) !== 0).sort(),
              ...(op === 0 ? {} : { operationCode: ops[op - 1] }),
            };
            expect(decodeKey(key)).toEqual(expected);
          }
        }
      }
    }
    expect(max).toBeLessThan(2 ** 24);
    // Every key is a non-negative Smi-range integer (no float, no sign bit).
    expect(max | 0).toBe(max);
  });

  it('the largest representable key stays below 2^24', () => {
    expect(compositeKey(127, 7, 0xff, 63)).toBe(2 ** 24 - 1);
    expect(compositeKey(TECHNIQUE_IDS.length - 1, PHASES.length - 1, 0xff, 63)).toBeLessThan(2 ** 24);
  });

  it('canvas keys decode exactly as in v1 (no operation, same signal codes)', () => {
    const P = PHASE_INDEX;
    const cases: Array<[number, number, number, string[]]> = [
      [TECHNIQUE_INDEX['DET-001'], P['returned-sync'], API_USE, ['api-use']],
      [TECHNIQUE_INDEX['DET-001'], P['attempted'], API_USE | signalBit('DET-001', 'readback-after-text'), ['api-use', 'readback-after-text']],
      [TECHNIQUE_INDEX['DET-002'], P['returned-sync'], API_USE | signalBit('DET-002', 'readback-after-text'), ['api-use', 'readback-after-text']],
      [TECHNIQUE_INDEX['DET-002'], P['threw-sync'], API_USE | signalBit('DET-002', 'tainted-canvas-attempt'), ['api-use', 'tainted-canvas-attempt']],
      [TECHNIQUE_INDEX['DET-003'], P['returned-sync'], API_USE | signalBit('DET-003', 'text-drawn'), ['api-use', 'text-drawn']],
      [TECHNIQUE_INDEX['DET-003'], P['threw-sync'], API_USE | signalBit('DET-003', 'text-measured'), ['api-use', 'text-measured']],
      [TECHNIQUE_INDEX['DET-004'], P['settlement-unobserved'], API_USE | signalBit('DET-004', 'readback-after-text'), ['api-use', 'readback-after-text']],
    ];
    for (const [t, p, mask, codes] of cases) {
      const decoded = decodeKey(compositeKey(t, p, mask));
      expect(decoded).toEqual({ techniqueId: TECHNIQUE_IDS[t], phase: PHASES[p], signalCodes: codes });
      expect(Object.keys(decoded!)).not.toContain('operationCode');
    }
    // DET-001/002/004 share one local order (ADR-017 §3), so canvas.ts uses one constant for all three.
    for (const id of ['DET-001', 'DET-002', 'DET-004'] as const) {
      expect([signalBit(id, 'readback-after-text'), signalBit(id, 'tainted-canvas-attempt')]).toEqual([2, 4]);
    }
    expect([signalBit('DET-003', 'text-drawn'), signalBit('DET-003', 'text-measured')]).toEqual([2, 4]);
  });

  it('install-time helpers throw for pairs the technique does not declare', () => {
    expect(() => signalBit('DET-001', 'text-drawn')).toThrow();
    expect(() => signalBit('DET-025', 'readback-after-text')).toThrow();
    expect(() => signalBit('DET-039', 'sample-budget-exceeded')).toThrow();
    expect(() => operationIndex('DET-001', 'user-agent')).toThrow();
    expect(() => operationIndex('DET-025', 'param-renderer')).toThrow();
    expect(() => signalBit('DET-999' as never, 'api-use')).toThrow();
    expect(signalBit('DET-039', 'api-use')).toBe(API_USE);
    expect(operationIndex('DET-011', 'param-vendor')).toBe(1);
    expect(operationIndex('DET-011', 'shader-precision-format')).toBe(14);
    expect(signalBit('DET-025', 'sample-budget-exceeded')).toBe(2);
  });

  it('decodeKey rejects keys outside the layout or with undeclared bits / operation indices', () => {
    const t39 = TECHNIQUE_INDEX['DET-039'];
    expect(decodeKey(compositeKey(t39, 1, API_USE | 2))).toBeNull(); // DET-039 declares one signal only
    expect(decodeKey(compositeKey(TECHNIQUE_INDEX['DET-001'], 1, API_USE, 1))).toBeNull(); // DET-001 has no operations
    expect(decodeKey(compositeKey(t39, 1, API_USE, pageOperations('DET-039').length + 1))).toBeNull();
    expect(decodeKey(compositeKey(TECHNIQUE_IDS.length, 1, API_USE))).toBeNull();
    expect(decodeKey(compositeKey(0, PHASES.length, API_USE))).toBeNull();
    expect(decodeKey(-1)).toBeNull();
    expect(decodeKey(2 ** 24)).toBeNull();
    expect(decodeKey(1.5)).toBeNull();
  });

  it('decoding never reads inherited (page-planted) array elements', () => {
    const t39 = TECHNIQUE_INDEX['DET-039'];
    const keys = [compositeKey(t39, 1, API_USE | 2), compositeKey(TECHNIQUE_INDEX['DET-001'], 1, API_USE, 2)] as const;
    let results: unknown[] = [];
    Object.defineProperty(Array.prototype, '1', { configurable: true, get: () => 'readback-after-text' });
    try {
      results = [decodeKey(keys[0]), decodeKey(keys[1])];
    } finally {
      Reflect.deleteProperty(Array.prototype, '1');
    }
    expect(results).toEqual([null, null]);
  });

  it('static layout invariants hold for the contract tables', () => {
    expect(TECHNIQUE_IDS.length).toBeLessThanOrEqual(128);
    expect(PHASES.length).toBeLessThanOrEqual(8);
    for (const id of TECHNIQUE_IDS) {
      expect(pageOperations(id).length).toBeLessThanOrEqual(63);
      const signals = techniqueSignals(id);
      expect(signals.length).toBeGreaterThanOrEqual(1);
      expect(signals.length).toBeLessThanOrEqual(8);
      expect(signals[0]).toBe('api-use');
    }
  });
});

describe('load-time invariants (a contract change that breaks the layout fails the module load)', () => {
  afterEach(() => {
    vi.doUnmock('@detect-expert/contracts');
    vi.resetModules();
  });

  async function loadWith(patch: (orig: Record<string, unknown>) => Record<string, unknown>): Promise<unknown> {
    vi.resetModules();
    vi.doMock('@detect-expert/contracts', async (importOriginal) => {
      const orig = await importOriginal<Record<string, unknown>>();
      return { ...orig, ...patch(orig) };
    });
    return import('../src/codes');
  }

  it('loads with the real tables', async () => {
    await expect(loadWith(() => ({}))).resolves.toBeDefined();
  });

  it.each([
    ['more than 128 techniques', (o: Record<string, unknown>) => ({ TECHNIQUE_IDS: [...(o['TECHNIQUE_IDS'] as string[]), ...Array.from({ length: 60 }, (_v, i) => 'DET-' + (200 + i))] })],
    ['more than 8 phases', (o: Record<string, unknown>) => ({ PHASES: [...(o['PHASES'] as string[]), 'p6', 'p7', 'p8', 'p9'] })],
    ['signal [0] not api-use', (o: Record<string, unknown>) => ({ TECHNIQUE_SIGNALS: { ...(o['TECHNIQUE_SIGNALS'] as object), 'DET-001': ['readback-after-text', 'api-use'] } })],
    ['more than 8 signals', (o: Record<string, unknown>) => ({ TECHNIQUE_SIGNALS: { ...(o['TECHNIQUE_SIGNALS'] as object), 'DET-001': ['api-use', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'] } })],
    ['duplicate signals', (o: Record<string, unknown>) => ({ TECHNIQUE_SIGNALS: { ...(o['TECHNIQUE_SIGNALS'] as object), 'DET-001': ['api-use', 'api-use'] } })],
    ['more than 63 operations', (o: Record<string, unknown>) => ({ PAGE_OPERATIONS: { ...(o['PAGE_OPERATIONS'] as object), 'DET-001': Array.from({ length: 64 }, (_v, i) => 'op-' + i) } })],
  ])('throws for %s', async (_name, patch) => {
    await expect(loadWith(patch)).rejects.toThrow(/key layout/);
  });
});
