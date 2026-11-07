// Test-only builders for DocumentReport / PageBatch / CounterEntry. Counter fixtures name the scenarios from the
// task (fp-positive, single readback, editor, chart, tainted) so that thresholds are readable in the tests.

import {
  EMPTY_DROPPED,
  makeDocumentKey,
  type CounterEntry,
  type CountQuality,
  type DocumentReport,
  type HostEntry,
  type PageBatch,
  type PageObservation,
  type Phase,
  type SignalCode,
  type TechniqueId,
} from '@detect-expert/contracts';

export interface CounterSpec {
  techniqueId: TechniqueId;
  count: number;
  phase?: Phase;
  signalCodes?: SignalCode[];
  countQuality?: CountQuality;
  firstBucket?: number;
  lastBucket?: number;
}

export function counter(spec: CounterSpec): CounterEntry {
  return {
    techniqueId: spec.techniqueId,
    phase: spec.phase ?? 'returned-sync',
    signalCodes: [...(spec.signalCodes ?? ['api-use'])].sort(),
    count: spec.count,
    countQuality: spec.countQuality ?? 'exact',
    firstBucket: spec.firstBucket ?? 1,
    lastBucket: spec.lastBucket ?? spec.firstBucket ?? 1,
  };
}

export function report(over: Partial<DocumentReport> = {}): DocumentReport {
  return {
    schemaVersion: 1,
    documentKey: makeDocumentKey(7, 0, 'DOC1'),
    tabId: 7,
    frameId: 0,
    documentId: 'DOC1',
    host: 'example.com',
    lifecycle: 'committed',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    revision: 0,
    coverageState: 'active',
    coverageFlags: [],
    counters: [],
    findings: [],
    hosts: [],
    watermark: null,
    dropped: { ...EMPTY_DROPPED },
    ...over,
  };
}

export function obs(over: Partial<PageObservation> = {}): PageObservation {
  return {
    techniqueId: 'DET-002',
    count: 1,
    countQuality: 'exact',
    phase: 'returned-sync',
    signalCodes: ['api-use'],
    intervalBucket: 1,
    ...over,
  };
}

export function batch(over: Partial<PageBatch> = {}): PageBatch {
  return {
    schemaVersion: 1,
    type: 'sensor-events',
    sensorBootId: 'boot-1',
    bridgeSessionId: 'bridge-1',
    batchSeq: 1,
    observations: [obs()],
    coverageDelta: [],
    ...over,
  };
}

export function hostEntry(host: string, requestCount = 1): HostEntry {
  return {
    registrableDomain: host,
    relation: host === 'example.com' ? 'same-origin' : 'cross-site',
    evidenceSource: 'browser-network',
    integrity: 'browser-observed',
    requestCount,
    firstSeenBucket: 0,
    lastSeenBucket: 1,
    ruleIds: [],
  };
}

// --- Canvas scenarios ------------------------------------------------------------------------------------------

/** Two getImageData reads after text, few text draws. */
export const FP_POSITIVE: CounterEntry[] = [
  counter({ techniqueId: 'DET-003', signalCodes: ['api-use', 'text-drawn'], count: 6 }),
  counter({ techniqueId: 'DET-002', count: 2, signalCodes: ['api-use', 'readback-after-text'] }),
];

/** One readback after text. */
export const SINGLE_READBACK: CounterEntry[] = [
  counter({ techniqueId: 'DET-003', signalCodes: ['api-use', 'text-drawn'], count: 3 }),
  counter({ techniqueId: 'DET-002', count: 1, signalCodes: ['api-use', 'readback-after-text'] }),
];

/** Editor: 300 text draws, then one toBlob export after text. */
export const EDITOR: CounterEntry[] = [
  counter({ techniqueId: 'DET-003', signalCodes: ['api-use', 'text-drawn'], count: 300 }),
  counter({ techniqueId: 'DET-001', count: 1, phase: 'attempted', signalCodes: ['api-use', 'export-after-text'] }),
];

/** Chart: measureText only, no readout. */
export const CHART: CounterEntry[] = [counter({ techniqueId: 'DET-003', signalCodes: ['api-use', 'text-measured'], count: 40 })];

/** Tainted canvas: getImageData threw (SecurityError); nothing was read. */
export const TAINTED_ONLY: CounterEntry[] = [
  counter({ techniqueId: 'DET-002', count: 3, phase: 'threw-sync', signalCodes: ['api-use', 'tainted-canvas-attempt'] }),
];

/** Canvas used without any text: reads of pixels are not "after text". */
export const PIXELS_NO_TEXT: CounterEntry[] = [
  counter({ techniqueId: 'DET-002', count: 5 }),
  counter({ techniqueId: 'DET-001', count: 1, phase: 'attempted' }),
];
