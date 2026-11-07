// validate.ts relies on structural bounds instead of serializing a batch: the worst valid PageBatch (32
// observations, longest enum members, longest allowlisted operationCode, every coverage flag, 64-char ids,
// maximal integers) must fit in BUDGETS.maxBatchBytes (REQ-011, ADR-017).

import { describe, expect, it } from 'vitest';
import {
  BUDGETS,
  COUNT_QUALITIES,
  COVERAGE_FLAGS,
  MAX_COUNT,
  PHASES,
  SIGNAL_CODES,
  TECHNIQUE_IDS,
  pageOperations,
  validatePageBatch,
  type OperationCode,
  type PageBatch,
  type TechniqueId,
} from '../src/index';
import { id64 } from './helpers';

function longest<T extends string>(values: readonly T[]): T {
  return values.reduce((a, b) => (b.length > a.length ? b : a));
}

/** Technique with the longest allowlisted operation code, and that code. */
function longestOperation(): { techniqueId: TechniqueId; op: OperationCode } {
  let best: { techniqueId: TechniqueId; op: OperationCode } | null = null;
  for (const techniqueId of TECHNIQUE_IDS) {
    for (const op of pageOperations(techniqueId)) {
      if (best === null || op.length > best.op.length) best = { techniqueId, op };
    }
  }
  if (best === null) throw new Error('no operation codes');
  return best;
}

function worstBatch(): PageBatch {
  const { techniqueId, op } = longestOperation();
  const signalCodes = [...SIGNAL_CODES].sort((a, b) => b.length - a.length).slice(0, BUDGETS.maxSignalCodesPerObservation);
  return {
    schemaVersion: 1,
    type: 'sensor-events',
    sensorBootId: id64,
    bridgeSessionId: id64,
    batchSeq: MAX_COUNT,
    observations: Array.from({ length: BUDGETS.maxBatchEvents }, () => ({
      techniqueId,
      count: MAX_COUNT,
      countQuality: longest(COUNT_QUALITIES),
      phase: longest(PHASES),
      signalCodes,
      intervalBucket: MAX_COUNT,
      operationCode: op,
    })),
    coverageDelta: [...COVERAGE_FLAGS],
  };
}

describe('worst-case PageBatch size', () => {
  it('is valid and fits in BUDGETS.maxBatchBytes', () => {
    const batch = worstBatch();
    const r = validatePageBatch(batch);
    expect(r.ok).toBe(true);
    const bytes = new TextEncoder().encode(JSON.stringify(batch)).length;
    // Headroom for a future code up to maxOperationCodeChars (registry changes go through ADR-017).
    const future = bytes + (BUDGETS.maxOperationCodeChars - longestOperation().op.length) * BUDGETS.maxBatchEvents;
    console.log(`contracts/batch-size: worst batch ${bytes} B (${future} B with 32-char codes) of ${BUDGETS.maxBatchBytes} B`);
    expect(bytes).toBeLessThanOrEqual(BUDGETS.maxBatchBytes);
    expect(future).toBeLessThanOrEqual(BUDGETS.maxBatchBytes);
  });

  it('uses the longest operation code of the registry (<= maxOperationCodeChars)', () => {
    const { op } = longestOperation();
    expect(op.length).toBeLessThanOrEqual(BUDGETS.maxOperationCodeChars);
    expect(worstBatch().observations[0]?.operationCode).toBe(op);
  });
});
