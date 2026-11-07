// Enumerated limitation and counter-evidence codes carried by findings (spec Part I §4.3: short enumerated
// features, never free text). The UI maps them to message keys; the export carries them as-is.

export const LIMITATION_CODES = Object.freeze({
  /** Evidence came from MAIN-world hooks and can be forged by the page (REQ-004). */
  pageControlledEvidence: 'page-controlled-evidence',
  /** The purpose of the call (fingerprinting or not) is not observable. */
  purposeUnknown: 'purpose-unknown',
  /** Whether the result is unique or stable was never measured (REQ-001: no fingerprint is computed). */
  uniquenessNotEstablished: 'uniqueness-not-established',
  /** At least one readout threw synchronously (e.g. tainted canvas): an attempt, not a successful read. */
  readbackAttemptedFailed: 'readback-attempted-failed',
  /** Thresholds are proposed, not calibrated on a corpus (ADR-010 pending). */
  uncalibratedThreshold: 'uncalibrated-threshold',
  /** Counters or coverage were degraded (late start, hook failure, sampling, losses); confidence was capped. */
  coverageIncomplete: 'coverage-incomplete',
  /** Vendor catalog is disabled in this build; no vendor linkage was attempted. */
  catalogDisabled: 'catalog-disabled',
  /** DET-003 aggregates measureText/fillText/strokeText; the v1 contract has no per-API split. */
  textOpsUndifferentiated: 'text-ops-undifferentiated',
  /** Counts cover the document lifetime; no bounded activity window can be inferred. */
  noTimeWindow: 'no-time-window',
});
export type LimitationCode = (typeof LIMITATION_CODES)[keyof typeof LIMITATION_CODES];

export const COUNTER_EVIDENCE_CODES = Object.freeze({
  /** Text volume typical for an editor/chart/text renderer rather than a probe. */
  highVolumeRendering: 'high-volume-rendering',
});
export type CounterEvidenceCode = (typeof COUNTER_EVIDENCE_CODES)[keyof typeof COUNTER_EVIDENCE_CODES];

export const ALL_LIMITATION_CODES: readonly LimitationCode[] = Object.freeze(Object.values(LIMITATION_CODES));
export const ALL_COUNTER_EVIDENCE_CODES: readonly CounterEvidenceCode[] = Object.freeze(
  Object.values(COUNTER_EVIDENCE_CODES),
);
