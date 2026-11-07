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
  /**
   * Distinct counter keys per document. In v1 this is the effective per-document limit shared by all sensor
   * families (MAIN, SW and engine enforce it; the bridge ring has its own record budget; the name predates the
   * single group). MAIN keeps 8 of
   * them as a fold reserve (ADR-017, S02): a new key beyond 120 folds into its technique's (attempted, api-use)
   * aggregate as a lower bound with `budget-exceeded`; when the reserve is used up the observation is dropped and
   * reported through droppedSinceLast.
   */
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
  /** Operation codes allowlisted per technique (6-bit local index in the MAIN key, 0 = none; ADR-017). */
  maxOperationCodesPerTechnique: 63,
  /** Longest operation code (lowercase kebab-case, ADR-017). */
  maxOperationCodeChars: 32,
  /** ADR-018: tumbling window of the SW network pattern tracker (memory only, never stored). */
  networkWindowMs: 10000,
  /** ADR-018: distinct ephemeral tokens per tracked set in one window; also the ceiling of NetworkPatterns fields. */
  maxNetworkWindowDistinct: 32,
  /** ADR-018: DocumentReport.networkCounters entries (DET-058…061, phase attempted, [api-use]). */
  maxNetworkCountersPerDocument: 8,
  /** Saturation ceiling for counts and sequence numbers. */
  maxCount: MAX_COUNT,
} as const;

export type Budgets = typeof BUDGETS;

/**
 * Width of a sensor interval bucket (S13, E13-02): `bucket = floor((now − sensorBoot) / INTERVAL_BUCKET_MS)`, carried in
 * `PageObservation.intervalBucket` and `firstBucket` / `lastBucket` of page-hook counters. Only a name for the existing
 * width (the wire does not change). Local ordering only: the clock is the page realm's (page-controlled), and buckets of
 * different sensor boots or documents are not comparable. Browser-network counters use seconds from `createdAt` instead.
 */
export const INTERVAL_BUCKET_MS = BUDGETS.flushMinMs;
