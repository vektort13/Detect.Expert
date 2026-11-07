// Rule contract: a pure function from a document's counters (+ coverage) to findings (spec Part I §4.3).
// Rules never see raw page data: counters carry only enums and saturating counts.

import type {
  CounterEntry,
  CoverageFlag,
  Finding,
  Interpretation,
  InterpretationConfidence,
  NetworkPatterns,
  TechniqueId,
} from '@detect-expert/contracts';
import { counterKey } from '@detect-expert/contracts';

/** S07 / ADR-018: browser-network input, written only by the SW (DocumentReport.networkCounters/networkPatterns). */
export interface NetworkRuleInput {
  counters: readonly CounterEntry[];
  patterns: Readonly<NetworkPatterns>;
}

export interface RuleInput {
  counters: readonly CounterEntry[];
  coverageFlags: readonly CoverageFlag[];
  /** Reference to the coverage snapshot (coverageRef()); copied into every finding when present. */
  coverageRef?: string;
  /** Browser-network data; read only by the 'network-observed' rule. Absent = no network findings. */
  network?: NetworkRuleInput;
}

export interface Rule {
  ruleId: string;
  ruleVersion: string;
  /** Techniques this rule owns (api-use findings for them are emitted by the rule, not the generic one). */
  techniqueIds: readonly TechniqueId[];
  evaluate(input: RuleInput): Finding[];
}

/** Deterministic finding id inside the contract id alphabet (^[A-Za-z0-9_-]{1,64}$). */
export function findingId(
  ruleId: string,
  ruleVersion: string,
  techniqueId: TechniqueId,
  interpretation: Interpretation,
): string {
  return ruleId + '-v' + ruleVersion + '-' + techniqueId + '-' + interpretation;
}

/** Evidence ids are counter keys (with the operation code when present): enum-only, safe to store and export. */
export function evidenceIdsOf(counters: readonly CounterEntry[], max = 64): string[] {
  const ids = counters.map((c) => counterKey(c.techniqueId, c.phase, c.signalCodes, c.operationCode));
  return [...new Set(ids)].sort().slice(0, max);
}

export interface FindingDraft {
  ruleId: string;
  ruleVersion: string;
  techniqueId: TechniqueId;
  interpretation: Interpretation;
  interpretationConfidence: InterpretationConfidence;
  evidenceIds: string[];
  counterEvidenceCodes: string[];
  limitationCodes: string[];
  coverageRef?: string;
}

export function makeFinding(d: FindingDraft): Finding {
  const f: Finding = {
    findingId: findingId(d.ruleId, d.ruleVersion, d.techniqueId, d.interpretation),
    ruleId: d.ruleId,
    ruleVersion: d.ruleVersion,
    techniqueId: d.techniqueId,
    interpretation: d.interpretation,
    interpretationConfidence: d.interpretationConfidence,
    evidenceIds: d.evidenceIds,
    counterEvidenceCodes: [...new Set(d.counterEvidenceCodes)],
    limitationCodes: [...new Set(d.limitationCodes)],
    vendorMatchIds: [],
  };
  if (d.coverageRef !== undefined) f.coverageRef = d.coverageRef;
  return f;
}
