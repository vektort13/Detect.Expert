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
  /**
   * Some calls carried a `*-unclassified` operation: classifying the argument would have required reading a page
   * object (coercion or property access could run page code, ADR-017 §2), so it was not classified.
   */
  argumentNotClassified: 'argument-not-classified',
  /**
   * A hot hook of the technique retired after its call budget (marker signal `sample-budget-exceeded`, ADR-017 §5):
   * later calls were not observed and the count shown is a minimum.
   */
  hookRetired: 'hook-retired',
  // --- S05: Web Audio and Permissions ---
  /**
   * DET-016: it is not established that the audio buffer the page read was produced by the observed offline
   * rendering (buffers and samples are never inspected).
   */
  bufferOriginUnknown: 'buffer-origin-unknown',
  /**
   * DET-039: the permission category is known only when the page read PermissionStatus.state (the query argument is
   * never read); the state value itself is never stored.
   */
  permissionNameFromStatus: 'permission-name-from-status',
  // --- S06: environment ---
  /**
   * DET-026: which high-entropy hints the page requested is not determined (the getHighEntropyValues argument is a
   * page object and is never read, ADR-006 §3).
   */
  hintNamesNotObserved: 'hint-names-not-observed',
  // --- S07 / ADR-018: browser-network (webRequest onBeforeRequest) limitations ---
  /** DET-058: only the connection handshake request is visible; messages and closing are not observed. */
  handshakeOnly: 'handshake-only',
  /** Request outcomes are not tracked: an error does not mean a closed port; the browser may have blocked it. */
  outcomeNotObserved: 'outcome-not-observed',
  /** Timing overlap with other observations does not mean their results were sent in these requests. */
  noCausalLink: 'no-causal-link',
  /** DET-061: whether a DNS lookup happened and which resolver was used are unknown to the extension. */
  resolverUnknown: 'resolver-unknown',
  /** Network events are visible only for permitted target and initiator hosts ('network-limited'). */
  networkScopeLimited: 'network-scope-limited',
});
export type LimitationCode = (typeof LIMITATION_CODES)[keyof typeof LIMITATION_CODES];

export const COUNTER_EVIDENCE_CODES = Object.freeze({
  /** Text volume typical for an editor/chart/text renderer rather than a probe. */
  highVolumeRendering: 'high-volume-rendering',
  /** E07-03/S04: repeated WebGL readPixels, typical for games and object picking rather than a one-off probe. */
  repeatedWebglReadback: 'repeated-webgl-readback',
});
export type CounterEvidenceCode = (typeof COUNTER_EVIDENCE_CODES)[keyof typeof COUNTER_EVIDENCE_CODES];

export const ALL_LIMITATION_CODES: readonly LimitationCode[] = Object.freeze(Object.values(LIMITATION_CODES));
export const ALL_COUNTER_EVIDENCE_CODES: readonly CounterEvidenceCode[] = Object.freeze(
  Object.values(COUNTER_EVIDENCE_CODES),
);
