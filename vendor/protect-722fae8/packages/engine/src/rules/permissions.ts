// Rule 'permissions-breadth' v1 (E08-03, S05; DET-039; spec III §2.4 row DET-039, §3.3 rule style, I §4.1; REQ-001,
// REQ-007). Traceability: CLM-26 (api-use) and CLM-27 (possible-fingerprinting) in PRD §6.1.
//
// What it says and what it does not:
// - 'api-use' / unassessed for observed DET-039: the page checked permission states. Every DET-039 finding carries
//   permission-name-from-status: the category is known only from PermissionStatus reads (the query argument is never
//   read, ADR-006 §3) and the state itself is never stored, so nothing is said about granted / denied.
// - 'possible-fingerprinting' / low when the number of distinct permission categories among successful state reads
//   (location, notifications, media, sensors, midi, clipboard, storage; every other name counts once as 'other';
//   'state-unclassified' does not count) reaches minDistinctCategories. Purpose, uniqueness and transmission are not
//   established: a settings page may legitimately check many permissions.
// - Late start or a missing name getter -> state-unclassified: the possible tier cannot be reached on such documents.
// - Counts cover the document lifetime; no time window is established (no-time-window).
// - ADR-001 §7: low/unassessed before calibration; the parameter file cannot raise the ceiling (capLow).
//
// THRESHOLDS ARE PROPOSED (calibrated === false). They were not fitted to fixtures and must not be tuned to make a
// test pass. Calibration corpus: ADR-010 / E15-01 (not available, E09-01 BLOCKED).

import type { CounterEntry, Finding, InterpretationConfidence, OperationCode } from '@detect-expert/contracts';
import { LIMITATION_CODES } from '../codes';
import { PERMISSION_TECHNIQUE_IDS, isPermissionTechnique } from '../techniques';
import { capLow, isDegraded } from './shared';
import parameters from './thresholds/permissions-breadth.v1.json';
import { evidenceIdsOf, makeFinding, type Rule, type RuleInput } from './types';

export const PERMISSIONS_RULE_ID = 'permissions-breadth';
export const PERMISSIONS_RULE_VERSION = parameters.ruleVersion;

/** PROPOSED parameters — not calibrated. Changing a number = new ruleVersion + reviewer sign-off. */
export const PERMISSIONS_RULE_PARAMS = Object.freeze({
  ...parameters,
  possibleConfidence: parameters.possibleConfidence as InterpretationConfidence,
  maxConfidence: parameters.maxConfidence as InterpretationConfidence,
});

/** The 7 named categories plus 'other' (8 at most); 'state-unclassified' is not a category. */
export const PERMISSION_CATEGORY_OPERATIONS: readonly OperationCode[] = Object.freeze([
  'state-location',
  'state-notifications',
  'state-media',
  'state-sensors',
  'state-midi',
  'state-clipboard',
  'state-storage',
  'state-other',
] as const);

const CATEGORY_SET: ReadonlySet<OperationCode> = new Set<OperationCode>(PERMISSION_CATEGORY_OPERATIONS);

function isCategoryRead(c: CounterEntry): boolean {
  return c.phase === 'returned-sync' && c.count > 0 && c.operationCode !== undefined && CATEGORY_SET.has(c.operationCode);
}

export interface PermissionStats {
  /** Distinct categories among successful state reads, in PERMISSION_CATEGORY_OPERATIONS order. */
  categories: OperationCode[];
  /** DET-039 counters or document coverage were degraded. */
  degraded: boolean;
  /** Successful categorized state reads (evidence of the possible-fingerprinting finding). */
  categoryCounters: CounterEntry[];
}

export function permissionStats(counters: readonly CounterEntry[], coverageFlags: RuleInput['coverageFlags']): PermissionStats {
  const own = counters.filter((c) => isPermissionTechnique(c.techniqueId));
  const seen = new Set<OperationCode>();
  for (const c of own) if (isCategoryRead(c)) seen.add(c.operationCode!);
  return {
    categories: PERMISSION_CATEGORY_OPERATIONS.filter((op) => seen.has(op)),
    degraded: isDegraded(own, coverageFlags),
    categoryCounters: own.filter(isCategoryRead),
  };
}

/** The v1 condition: at least minDistinctCategories distinct categories. */
export function permissionsBreadthMet(stats: PermissionStats): boolean {
  return stats.categories.length >= PERMISSIONS_RULE_PARAMS.minDistinctCategories;
}

export function evaluatePermissions(input: RuleInput): Finding[] {
  const own = input.counters.filter((c) => isPermissionTechnique(c.techniqueId));
  if (own.length === 0) return [];

  const stats = permissionStats(input.counters, input.coverageFlags);
  const base = {
    ruleId: PERMISSIONS_RULE_ID,
    ruleVersion: PERMISSIONS_RULE_VERSION,
    techniqueId: 'DET-039' as const,
    ...(input.coverageRef !== undefined ? { coverageRef: input.coverageRef } : {}),
  };
  const degraded = stats.degraded ? [LIMITATION_CODES.coverageIncomplete] : [];

  // Observation level (CLM-26).
  const findings: Finding[] = [
    makeFinding({
      ...base,
      interpretation: 'api-use',
      interpretationConfidence: 'unassessed',
      evidenceIds: evidenceIdsOf(own),
      counterEvidenceCodes: [],
      limitationCodes: [
        LIMITATION_CODES.pageControlledEvidence,
        LIMITATION_CODES.purposeUnknown,
        LIMITATION_CODES.permissionNameFromStatus,
        ...degraded,
      ],
    }),
  ];

  // Interpretation level (CLM-27).
  if (!permissionsBreadthMet(stats)) return findings;
  findings.push(
    makeFinding({
      ...base,
      interpretation: 'possible-fingerprinting',
      interpretationConfidence: capLow(stats.degraded ? 'low' : PERMISSIONS_RULE_PARAMS.possibleConfidence, PERMISSIONS_RULE_PARAMS.maxConfidence),
      evidenceIds: evidenceIdsOf(stats.categoryCounters),
      counterEvidenceCodes: [],
      limitationCodes: [
        LIMITATION_CODES.pageControlledEvidence,
        LIMITATION_CODES.purposeUnknown,
        LIMITATION_CODES.uniquenessNotEstablished,
        LIMITATION_CODES.uncalibratedThreshold,
        LIMITATION_CODES.noTimeWindow,
        LIMITATION_CODES.permissionNameFromStatus,
        ...degraded,
      ],
    }),
  );
  return findings;
}

export const permissionsRule: Rule = Object.freeze({
  ruleId: PERMISSIONS_RULE_ID,
  ruleVersion: PERMISSIONS_RULE_VERSION,
  techniqueIds: PERMISSION_TECHNIQUE_IDS,
  evaluate: evaluatePermissions,
});
