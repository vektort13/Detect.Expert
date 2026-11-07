// Rule 'network-observed' v1 (E10-01/02/03; DET-058…061, N-part only; ADR-018; REQ-001, REQ-006, REQ-007, REQ-014).
//
// Input: ONLY `input.network` — the SW-written browser-network counters (webRequest onBeforeRequest, integrity
// browser-observed) and the window maxima of the ephemeral SW tracker. Page counters are never read here: a page can
// forge MAIN observations of DET-058…061, and the SW drops them anyway.
//
// What it says and what it does not:
// - DET-058/059/060 with a count > 0 -> 'api-use' / 'unassessed': requests of that kind were attempted. Not a verdict.
// - DET-058: only the handshake request is visible (messages and closing are not). DET-059: timing overlap with other
//   observations is not a causal link (no "the fingerprint was sent"). DET-060: outcomes are not observed — an error
//   does not mean a closed port, and the browser (Local Network Access) may have blocked the request.
// - DET-060 'local-probe-pattern' and DET-061 'dns-test-pattern' only from window maxima with PROPOSED thresholds,
//   capped at 'low' (ADR-001 §7). The extension never probes, never resolves names, never repeats requests.
// - 'network-limited' adds 'network-scope-limited'; late-start/truncated/budget-exceeded/paused add 'coverage-incomplete'
//   (CW-05: requests during a pause are not counted; the 'paused' flag stays after resume).
//
// THRESHOLDS ARE PROPOSED (calibrated === false): not fitted to fixtures, not to be tuned to pass a test. Known false
// positives: dev servers and IDE companions (local), ad-tech/CDN random subdomains (DNS). Calibration: ADR-010.

import {
  BUDGETS,
  counterKey,
  type CounterEntry,
  type CoverageFlag,
  type Finding,
  type InterpretationConfidence,
  type NetworkPatterns,
  type TechniqueId,
} from '@detect-expert/contracts';
import { LIMITATION_CODES } from '../codes';
import { isNetworkTechnique, NETWORK_TECHNIQUE_IDS, type NetworkTechniqueId } from '../techniques';
import parameters from './thresholds/network-observed.v1.json';
import { makeFinding, type Rule, type RuleInput } from './types';

export const NETWORK_RULE_ID = 'network-observed';
export const NETWORK_RULE_VERSION = parameters.ruleVersion;

/** PROPOSED parameters — not calibrated. Changing a number = new ruleVersion + reviewer sign-off. */
export const NETWORK_RULE_PARAMS = Object.freeze({
  ...parameters,
  patternConfidence: parameters.patternConfidence as InterpretationConfidence,
  maxConfidence: parameters.maxConfidence as InterpretationConfidence,
});

/** The tracker window is the contract budget; the documented rule window must equal it (network-rule.test.ts). */
export const NETWORK_WINDOW_MATCHES_BUDGET: boolean = NETWORK_RULE_PARAMS.windowMs === BUDGETS.networkWindowMs;

const CONFIDENCE_RANK: Readonly<Record<InterpretationConfidence, number>> = { unassessed: 0, low: 1, medium: 2, high: 3 };

function capped(c: InterpretationConfidence): InterpretationConfidence {
  const max = NETWORK_RULE_PARAMS.maxConfidence;
  return CONFIDENCE_RANK[c] > CONFIDENCE_RANK[max] ? max : c;
}

/** Flags meaning the observed window or the counts may be incomplete. */
const INCOMPLETE_FLAGS: ReadonlySet<CoverageFlag> = new Set<CoverageFlag>(['late-start', 'truncated', 'budget-exceeded', 'paused']);

/**
 * Random-looking DNS label (DET-061): without '-', at least minRandomLabelChars characters with at least
 * minRandomLabelDigits ASCII digits and minRandomLabelLetters ASCII letters. Used transiently by the SW callback;
 * the label itself is never stored. 'p3k9x2q8w1z7m4n6b5v0' -> true; 'img1', 'eu-west-1', 'my-bucket' -> false.
 */
export function looksRandomLabel(label: string): boolean {
  if (typeof label !== 'string' || label.length === 0 || label.length > 63) return false;
  let chars = 0;
  let digits = 0;
  let letters = 0;
  for (let i = 0; i < label.length; i++) {
    const c = label.charCodeAt(i);
    if (c === 45) continue; // '-'
    chars++;
    if (c >= 48 && c <= 57) digits++;
    else if ((c >= 97 && c <= 122) || (c >= 65 && c <= 90)) letters++;
  }
  return (
    chars >= NETWORK_RULE_PARAMS.minRandomLabelChars &&
    digits >= NETWORK_RULE_PARAMS.minRandomLabelDigits &&
    letters >= NETWORK_RULE_PARAMS.minRandomLabelLetters
  );
}

/** Whether the window maxima meet the (uncalibrated) pattern threshold of a network technique. */
export function networkPatternMet(techniqueId: TechniqueId, patterns: Readonly<NetworkPatterns>): boolean {
  if (techniqueId === 'DET-060') {
    return (
      patterns.localPortsMax >= NETWORK_RULE_PARAMS.minLocalPortsPerTarget ||
      patterns.localTargetsMax >= NETWORK_RULE_PARAMS.minLocalTargets
    );
  }
  if (techniqueId === 'DET-061') return patterns.randomSubdomainsMax >= NETWORK_RULE_PARAMS.minRandomSubdomains;
  return false;
}

/** The single canonical network counter shape: (DET-058…061, attempted, ['api-use']), no operation, count > 0. */
function canonicalCounters(counters: readonly CounterEntry[]): Map<NetworkTechniqueId, CounterEntry> {
  const out = new Map<NetworkTechniqueId, CounterEntry>();
  for (const c of counters) {
    if (!isNetworkTechnique(c.techniqueId) || c.phase !== 'attempted' || c.operationCode !== undefined) continue;
    if (c.signalCodes.length !== 1 || c.signalCodes[0] !== 'api-use' || !(c.count > 0)) continue;
    if (!out.has(c.techniqueId)) out.set(c.techniqueId, c);
  }
  return out;
}

const API_USE_LIMITATIONS: Readonly<Record<NetworkTechniqueId, readonly string[]>> = Object.freeze({
  'DET-058': [LIMITATION_CODES.handshakeOnly, LIMITATION_CODES.purposeUnknown],
  'DET-059': [LIMITATION_CODES.noCausalLink, LIMITATION_CODES.purposeUnknown],
  'DET-060': [LIMITATION_CODES.outcomeNotObserved, LIMITATION_CODES.purposeUnknown],
  // DET-061 has no api-use finding: a single subdomain request is ordinary; only the pattern is reported.
  'DET-061': [],
});

export function evaluateNetwork(input: RuleInput): Finding[] {
  const network = input.network;
  if (network === undefined) return [];
  const counters = canonicalCounters(network.counters);
  if (counters.size === 0) return [];
  const coverage: string[] = [];
  if (input.coverageFlags.includes('network-limited')) coverage.push(LIMITATION_CODES.networkScopeLimited);
  if (input.coverageFlags.some((f) => INCOMPLETE_FLAGS.has(f))) coverage.push(LIMITATION_CODES.coverageIncomplete);
  const ref = input.coverageRef !== undefined ? { coverageRef: input.coverageRef } : {};
  const findings: Finding[] = [];
  for (const id of NETWORK_TECHNIQUE_IDS) {
    const c = counters.get(id);
    if (c === undefined) continue;
    const evidenceIds = [counterKey(id, 'attempted', ['api-use'])];
    const base = API_USE_LIMITATIONS[id];
    if (base.length > 0) {
      findings.push(makeFinding({
        ruleId: NETWORK_RULE_ID, ruleVersion: NETWORK_RULE_VERSION, techniqueId: id,
        interpretation: 'api-use', interpretationConfidence: 'unassessed',
        evidenceIds, counterEvidenceCodes: [], limitationCodes: [...base, ...coverage], ...ref,
      }));
    }
    if (!networkPatternMet(id, network.patterns)) continue;
    const first = id === 'DET-060' ? LIMITATION_CODES.outcomeNotObserved : LIMITATION_CODES.resolverUnknown;
    findings.push(makeFinding({
      ruleId: NETWORK_RULE_ID, ruleVersion: NETWORK_RULE_VERSION, techniqueId: id,
      interpretation: id === 'DET-060' ? 'local-probe-pattern' : 'dns-test-pattern',
      interpretationConfidence: capped(NETWORK_RULE_PARAMS.patternConfidence),
      evidenceIds, counterEvidenceCodes: [],
      limitationCodes: [first, LIMITATION_CODES.uncalibratedThreshold, LIMITATION_CODES.purposeUnknown, ...coverage],
      ...ref,
    }));
  }
  return findings;
}

export const networkRule: Rule = Object.freeze({
  ruleId: NETWORK_RULE_ID,
  ruleVersion: NETWORK_RULE_VERSION,
  techniqueIds: NETWORK_TECHNIQUE_IDS,
  evaluate: evaluateNetwork,
});
