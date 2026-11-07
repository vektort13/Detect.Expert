import { describe, expect, it } from 'vitest';
import {
  BUDGETS,
  COVERAGE_FLAGS,
  MAX_COUNT,
  SIGNAL_CODES,
  TECHNIQUE_IDS,
  validatePageBatch,
  type PageBatch,
} from '../src/index';
import {
  ascii513,
  compileSchema,
  id64,
  id65,
  throwingGetterObject,
  throwingProxy,
  unicode513,
  withOwnProtoKey,
} from './helpers';

type Json = Record<string, unknown>;

interface Case {
  name: string;
  input: unknown;
  expect: 'ok' | 'fail';
  /** Hand validator saturates a count: hand ok, Ajv rejects the raw input but accepts the normalized value. */
  saturates?: boolean;
  /** Hostile inputs where Ajv itself would throw; only the hand verdict is asserted. */
  handOnly?: boolean;
}

function obs(over: Json = {}): Json {
  return {
    techniqueId: 'DET-001',
    count: 3,
    countQuality: 'exact',
    phase: 'attempted',
    signalCodes: ['api-use'],
    intervalBucket: 12,
    ...over,
  };
}

function batch(over: Json = {}, obsOver?: Json): Json {
  return {
    schemaVersion: 1,
    type: 'sensor-events',
    sensorBootId: 'boot-1',
    bridgeSessionId: 'bridge-1',
    batchSeq: 1,
    observations: [obs(obsOver)],
    coverageDelta: [],
    ...over,
  };
}

function without(o: Json, key: string): Json {
  const copy = { ...o };
  delete copy[key];
  return copy;
}

const maxBatch: Json = batch({
  sensorBootId: id64,
  bridgeSessionId: id64,
  batchSeq: MAX_COUNT,
  coverageDelta: [...COVERAGE_FLAGS],
  observations: Array.from({ length: BUDGETS.maxBatchEvents }, (_, i) =>
    obs({
      techniqueId: TECHNIQUE_IDS[i % TECHNIQUE_IDS.length],
      count: MAX_COUNT,
      signalCodes: SIGNAL_CODES.slice(0, BUDGETS.maxSignalCodesPerObservation),
      intervalBucket: MAX_COUNT,
    }),
  ),
});

const cases: Case[] = [
  { name: 'minimal valid batch', input: batch(), expect: 'ok' },
  { name: 'maximal valid batch (32 obs, 8 codes, all flags, max ints, 64-char ids)', input: maxBatch, expect: 'ok' },
  { name: 'count 0', input: batch({}, { count: 0 }), expect: 'ok' },
  { name: 'count -0 normalizes to 0', input: batch({}, { count: -0 }), expect: 'ok' },
  { name: 'empty signalCodes', input: batch({}, { signalCodes: [] }), expect: 'ok' },
  { name: 'null-prototype object with valid fields', input: Object.assign(Object.create(null), batch()), expect: 'ok' },
  ...TECHNIQUE_IDS.map((techniqueId) => ({ name: 'technique ' + techniqueId, input: batch({}, { techniqueId }), expect: 'ok' as const })),

  { name: 'null', input: null, expect: 'fail' },
  { name: 'undefined', input: undefined, expect: 'fail' },
  { name: 'number', input: 1, expect: 'fail' },
  { name: 'string', input: 'sensor-events', expect: 'fail' },
  { name: 'boolean', input: true, expect: 'fail' },
  { name: 'empty array', input: [], expect: 'fail' },
  { name: 'array wrapping a batch', input: [batch()], expect: 'fail' },
  { name: 'empty object', input: {}, expect: 'fail' },
  ...['schemaVersion', 'type', 'sensorBootId', 'bridgeSessionId', 'batchSeq', 'observations', 'coverageDelta'].map(
    (key) => ({ name: 'missing ' + key, input: without(batch(), key), expect: 'fail' as const }),
  ),
  { name: 'unknown key', input: batch({ extra: 1 }), expect: 'fail' },
  { name: 'unknown key documentKey (page must not set it)', input: batch({ documentKey: 'x' }), expect: 'fail' },
  { name: 'unknown key tabId (page must not set it)', input: batch({ tabId: 1 }), expect: 'fail' },
  { name: 'own __proto__ key', input: withOwnProtoKey(batch(), '__proto__'), expect: 'fail' },
  { name: 'constructor key', input: batch({ constructor: {} }), expect: 'fail' },
  { name: 'prototype key', input: batch({ prototype: {} }), expect: 'fail' },
  { name: 'schemaVersion 2', input: batch({ schemaVersion: 2 }), expect: 'fail' },
  { name: 'schemaVersion "1"', input: batch({ schemaVersion: '1' }), expect: 'fail' },
  { name: 'schemaVersion null', input: batch({ schemaVersion: null }), expect: 'fail' },
  { name: 'type ack', input: batch({ type: 'ack' }), expect: 'fail' },
  { name: 'type sensor-event', input: batch({ type: 'sensor-event' }), expect: 'fail' },
  { name: 'sensorBootId empty', input: batch({ sensorBootId: '' }), expect: 'fail' },
  { name: 'sensorBootId 65 chars', input: batch({ sensorBootId: id65 }), expect: 'fail' },
  { name: 'sensorBootId 513 unicode chars', input: batch({ sensorBootId: unicode513 }), expect: 'fail' },
  { name: 'sensorBootId 513 ascii chars', input: batch({ sensorBootId: ascii513 }), expect: 'fail' },
  { name: 'sensorBootId with space', input: batch({ sensorBootId: 'a b' }), expect: 'fail' },
  { name: 'sensorBootId with slash', input: batch({ sensorBootId: 'a/b' }), expect: 'fail' },
  { name: 'sensorBootId number', input: batch({ sensorBootId: 42 }), expect: 'fail' },
  { name: 'bridgeSessionId null', input: batch({ bridgeSessionId: null }), expect: 'fail' },
  { name: 'bridgeSessionId object', input: batch({ bridgeSessionId: { a: 1 } }), expect: 'fail' },
  { name: 'batchSeq 0', input: batch({ batchSeq: 0 }), expect: 'fail' },
  { name: 'batchSeq -1', input: batch({ batchSeq: -1 }), expect: 'fail' },
  { name: 'batchSeq 1.5', input: batch({ batchSeq: 1.5 }), expect: 'fail' },
  { name: 'batchSeq NaN', input: batch({ batchSeq: NaN }), expect: 'fail' },
  { name: 'batchSeq Infinity', input: batch({ batchSeq: Infinity }), expect: 'fail' },
  { name: 'batchSeq "1"', input: batch({ batchSeq: '1' }), expect: 'fail' },
  { name: 'batchSeq 2^31', input: batch({ batchSeq: MAX_COUNT + 1 }), expect: 'fail' },
  { name: 'batchSeq 1e300', input: batch({ batchSeq: 1e300 }), expect: 'fail' },
  { name: 'observations empty and coverageDelta empty (nothing to report)', input: batch({ observations: [] }), expect: 'fail' },
  { name: 'coverage-only batch: observations empty, coverageDelta non-empty', input: batch({ observations: [], coverageDelta: ['protocol-mismatch'] }), expect: 'ok' },
  { name: 'coverage-only batch with every flag', input: batch({ observations: [], coverageDelta: [...COVERAGE_FLAGS] }), expect: 'ok' },
  { name: 'coverage-only batch with an unknown flag', input: batch({ observations: [], coverageDelta: ['bogus'] }), expect: 'fail' },
  { name: 'coverage-only batch: observations null', input: batch({ observations: null, coverageDelta: ['hook-failed'] }), expect: 'fail' },
  { name: 'observations 33', input: batch({ observations: Array.from({ length: 33 }, () => obs()) }), expect: 'fail' },
  { name: 'observations 10000 (flood)', input: batch({ observations: Array.from({ length: 10000 }, () => obs()) }), expect: 'fail' },
  { name: 'observations object', input: batch({ observations: { 0: obs() } }), expect: 'fail' },
  { name: 'observations string', input: batch({ observations: 'x' }), expect: 'fail' },
  { name: 'observation string', input: batch({ observations: ['x'] }), expect: 'fail' },
  { name: 'observation null', input: batch({ observations: [null] }), expect: 'fail' },
  { name: 'observation nested array', input: batch({ observations: [[obs()]] }), expect: 'fail' },
  ...['techniqueId', 'count', 'countQuality', 'phase', 'signalCodes', 'intervalBucket'].map((key) => ({
    name: 'observation missing ' + key,
    input: batch({ observations: [without(obs(), key)] }),
    expect: 'fail' as const,
  })),
  { name: 'observation unknown key', input: batch({}, { resourceRef: 'x' }), expect: 'fail' },
  { name: 'observation own __proto__ key', input: batch({ observations: [withOwnProtoKey(obs(), '__proto__')] }), expect: 'fail' },
  { name: 'techniqueId DET-070', input: batch({}, { techniqueId: 'DET-070' }), expect: 'fail' },
  { name: 'techniqueId DET-000', input: batch({}, { techniqueId: 'DET-000' }), expect: 'fail' },
  { name: 'techniqueId det-001', input: batch({}, { techniqueId: 'det-001' }), expect: 'fail' },
  { name: 'techniqueId DET-1', input: batch({}, { techniqueId: 'DET-1' }), expect: 'fail' },
  { name: 'techniqueId 513 chars', input: batch({}, { techniqueId: unicode513 }), expect: 'fail' },
  { name: 'techniqueId nested object', input: batch({}, { techniqueId: { a: { b: { c: {} } } } }), expect: 'fail' },
  { name: 'count -1', input: batch({}, { count: -1 }), expect: 'fail' },
  { name: 'count 1.5', input: batch({}, { count: 1.5 }), expect: 'fail' },
  { name: 'count NaN', input: batch({}, { count: NaN }), expect: 'fail' },
  { name: 'count Infinity', input: batch({}, { count: Infinity }), expect: 'fail' },
  { name: 'count -Infinity', input: batch({}, { count: -Infinity }), expect: 'fail' },
  { name: 'count "3"', input: batch({}, { count: '3' }), expect: 'fail' },
  { name: 'count null', input: batch({}, { count: null }), expect: 'fail' },
  { name: 'count object', input: batch({}, { count: {} }), expect: 'fail' },
  { name: 'count array', input: batch({}, { count: [3] }), expect: 'fail' },
  { name: 'count 2^31 saturates', input: batch({}, { count: MAX_COUNT + 1 }), expect: 'ok', saturates: true },
  { name: 'count 2^53 saturates', input: batch({}, { count: 2 ** 53 }), expect: 'ok', saturates: true },
  { name: 'count 1e300 saturates', input: batch({}, { count: 1e300 }), expect: 'ok', saturates: true },
  { name: 'countQuality Exact', input: batch({}, { countQuality: 'Exact' }), expect: 'fail' },
  { name: 'countQuality lower_bound', input: batch({}, { countQuality: 'lower_bound' }), expect: 'fail' },
  { name: 'phase returned', input: batch({}, { phase: 'returned' }), expect: 'fail' },
  { name: 'signalCodes string', input: batch({}, { signalCodes: 'api-use' }), expect: 'fail' },
  { name: 'signalCodes 9 entries', input: batch({}, { signalCodes: SIGNAL_CODES.slice(0, 9) }), expect: 'fail' },
  { name: 'signalCodes duplicate', input: batch({}, { signalCodes: ['api-use', 'api-use'] }), expect: 'fail' },
  { name: 'signalCodes unknown', input: batch({}, { signalCodes: ['pixels'] }), expect: 'fail' },
  { name: 'signalCodes number entry', input: batch({}, { signalCodes: [1] }), expect: 'fail' },
  { name: 'signalCodes null', input: batch({}, { signalCodes: null }), expect: 'fail' },
  { name: 'intervalBucket -1', input: batch({}, { intervalBucket: -1 }), expect: 'fail' },
  { name: 'intervalBucket 1.5', input: batch({}, { intervalBucket: 1.5 }), expect: 'fail' },
  { name: 'intervalBucket 2^31', input: batch({}, { intervalBucket: MAX_COUNT + 1 }), expect: 'fail' },
  { name: 'intervalBucket "1"', input: batch({}, { intervalBucket: '1' }), expect: 'fail' },
  { name: 'coverageDelta duplicate', input: batch({ coverageDelta: ['late-start', 'late-start'] }), expect: 'fail' },
  { name: 'coverageDelta unknown', input: batch({ coverageDelta: ['bogus'] }), expect: 'fail' },
  { name: 'coverageDelta string', input: batch({ coverageDelta: 'late-start' }), expect: 'fail' },
  { name: 'coverageDelta null', input: batch({ coverageDelta: null }), expect: 'fail' },
  { name: 'coverageDelta 16 entries', input: batch({ coverageDelta: [...COVERAGE_FLAGS, 'late-start'] }), expect: 'fail' },
  { name: 'hostile proxy', input: throwingProxy(), expect: 'fail', handOnly: true },
  { name: 'hostile getter', input: throwingGetterObject(), expect: 'fail', handOnly: true },
];

describe('validatePageBatch vs JSON Schema (page-batch.v1)', () => {
  const ajvValidate = compileSchema('page-batch.v1.schema.json');

  for (const c of cases) {
    it(c.name, () => {
      const hand = validatePageBatch(c.input);
      expect(hand.ok).toBe(c.expect === 'ok');
      if (c.handOnly) return;
      const ajvRaw = ajvValidate(c.input);
      if (c.saturates) {
        expect(hand.ok).toBe(true);
        expect(ajvRaw).toBe(false);
        if (hand.ok) expect(ajvValidate(hand.value)).toBe(true);
        return;
      }
      expect(ajvRaw).toBe(hand.ok);
      if (hand.ok) expect(ajvValidate(hand.value)).toBe(true);
    });
  }
});

describe('validatePageBatch normalization', () => {
  it('returns a fresh, structurally equal copy for a valid batch', () => {
    const input = batch();
    const r = validatePageBatch(input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual(input);
    expect(r.value).not.toBe(input);
    expect(r.value.observations).not.toBe(input['observations']);
    expect(Object.getPrototypeOf(r.value)).toBe(Object.prototype);
  });

  it('saturates counts at 2^31-1 and normalizes -0', () => {
    const r = validatePageBatch(batch({}, { count: 1e300 }));
    expect(r.ok && r.value.observations[0]?.count).toBe(MAX_COUNT);
    const z = validatePageBatch(batch({}, { count: -0 }));
    expect(z.ok && Object.is(z.value.observations[0]?.count, 0)).toBe(true);
  });

  it('never throws on exotic inputs', () => {
    const exotic: unknown[] = [
      Symbol('s'),
      () => 1,
      10n,
      new Date(),
      new Map(),
      Object.freeze(batch()),
      (() => {
        const a: Json = batch();
        a['self'] = a;
        return a;
      })(),
      new Proxy(batch(), {}),
      throwingProxy(),
    ];
    for (const input of exotic) {
      const r = validatePageBatch(input);
      expect(typeof r.ok).toBe('boolean');
      if (!r.ok) expect(typeof r.reason).toBe('string');
    }
  });

  it('typed PageBatch round-trips', () => {
    const typed: PageBatch = {
      schemaVersion: 1,
      type: 'sensor-events',
      sensorBootId: 'boot',
      bridgeSessionId: 'bridge',
      batchSeq: 7,
      observations: [
        { techniqueId: 'DET-069', count: 1, countQuality: 'lower-bound', phase: 'threw-sync', signalCodes: ['tainted-canvas-attempt'], intervalBucket: 0 },
      ],
      coverageDelta: ['channel-gap'],
    };
    const r = validatePageBatch(typed);
    expect(r.ok && r.value).toEqual(typed);
  });

  it('reasons never echo page-controlled strings', () => {
    const r = validatePageBatch(batch({ 'SECRET-KEY-NAME': 1 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).not.toContain('SECRET');
    const t = validatePageBatch(batch({}, { techniqueId: 'SECRET-VALUE' }));
    if (!t.ok) expect(t.reason).not.toContain('SECRET');
  });
});
