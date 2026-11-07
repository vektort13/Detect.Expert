// v1 budgets (spec Part VI, I1; docs/PROJECT_RULES.md REQ-011). Changing a number = new contract version / ADR + re-test.
// Exceeding a budget degrades with explicit coverageFlags; never hang, never retry forever.

/** 2^31 - 1: saturation ceiling for counters and sequence numbers. */
export const MAX_COUNT = 2147483647;

export const BUDGETS = {
  /** Wire batch: observations per PageBatch. */
  maxBatchEvents: 32,
  /** Wire batch: serialized bytes, checked after bounded structural validation. */
  maxBatchBytes: 16384,
  /** Any incoming string (specialized fields may be shorter). */
  maxStringChars: 512,
  /** sensorBootId / bridgeSessionId and similar local identifiers. */
  maxIdChars: 64,
  /** documentKey (assigned by the SW from MessageSender / webNavigation). */
  maxDocumentKeyChars: 128,
  /** Rate after aggregation (token bucket); not a recommended normal rate. */
  maxBatchesPerSecondPerDocument: 20,
  maxBatchesPerSecondPerTab: 100,
  maxBatchesPerSecondGlobal: 200,
  /** ISOLATED bridge ring: normalized aggregates per document; oldest unacknowledged dropped with a gap marker. */
  maxBridgeRecordsPerDocument: 512,
  /** Normal flush window when data is present. */
  flushMinMs: 250,
  flushMaxMs: 500,
  /** Hot Math: at most one aggregate per this window. */
  hotMathFlushMs: 500,
  /** Sensor counters per document per sensor group; rare keys fold into `other`. */
  maxCountersPerDocumentGroup: 128,
  maxFindingsPerDocument: 256,
  maxHostsPerDocument: 128,
  /** Serialized document aggregate target. */
  maxReportSerializedBytes: 102400,
  /** Session storage estimate for reports + indexes + diagnostics together. */
  maxSessionTotalBytes: 4194304,
  inactiveDocumentTtlMs: 600000,
  /** Diagnostics ring: inside the session budget; session only; no domains/paths/page content. */
  maxDiagnosticsBytes: 1048576,
  diagnosticsTtlMs: 86400000,
  /** Out-of-order quarantine (per extension). */
  maxOutOfOrderEntriesGlobal: 128,
  outOfOrderTtlMs: 2000,
  /** Math stack sampling per realm. */
  maxMathStackSamplesPerWindow: 8,
  mathSampleWindowMs: 2000,
  mathAttributionSlots: 32,
  /** Per-observation signal codes. */
  maxSignalCodesPerObservation: 8,
  /** Saturation ceiling for counts and sequence numbers. */
  maxCount: MAX_COUNT,
} as const;

export type Budgets = typeof BUDGETS;
