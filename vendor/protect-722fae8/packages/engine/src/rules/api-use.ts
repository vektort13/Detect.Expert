// Generic 'api-use' rule: one observation-level finding per technique that no specialized rule owns, so the UI
// can list usage for every observed technique (spec III §1: "API used" is a card type of its own).

import { TECHNIQUE_IDS, type CounterEntry, type Finding, type SignalCode, type TechniqueId } from '@detect-expert/contracts';
import { LIMITATION_CODES, type LimitationCode } from '../codes';
import { evidenceIdsOf, makeFinding, type Rule, type RuleInput } from './types';

export const API_USE_RULE_ID = 'api-use-generic';
export const API_USE_RULE_VERSION = '1';
const UNCLASSIFIED_SUFFIX = '-unclassified';
const RETIRED_SIGNAL: SignalCode = 'sample-budget-exceeded';

/**
 * Fixed limitations of a technique, added to every api-use finding of it (S06). DET-026: the requested hint names are
 * never read (hint-names-not-observed).
 */
export const EXTRA_LIMITATIONS: Readonly<Partial<Record<TechniqueId, readonly LimitationCode[]>>> = Object.freeze({
  'DET-026': Object.freeze([LIMITATION_CODES.hintNamesNotObserved]),
});

export function createGenericApiUseRule(claimed: ReadonlySet<TechniqueId>): Rule {
  const techniqueIds = TECHNIQUE_IDS.filter((id) => !claimed.has(id));
  return Object.freeze({
    ruleId: API_USE_RULE_ID,
    ruleVersion: API_USE_RULE_VERSION,
    techniqueIds,
    evaluate(input: RuleInput): Finding[] {
      const byTechnique = new Map<TechniqueId, CounterEntry[]>();
      for (const c of input.counters) {
        if (claimed.has(c.techniqueId)) continue;
        const list = byTechnique.get(c.techniqueId);
        if (list === undefined) byTechnique.set(c.techniqueId, [c]);
        else list.push(c);
      }
      const findings: Finding[] = [];
      for (const id of TECHNIQUE_IDS) {
        const list = byTechnique.get(id);
        if (list === undefined) continue;
        const limitationCodes: string[] = [LIMITATION_CODES.pageControlledEvidence, LIMITATION_CODES.purposeUnknown];
        for (const code of EXTRA_LIMITATIONS[id] ?? []) limitationCodes.push(code);
        // ADR-017: '*-unclassified' = the argument was deliberately not inspected (reading it could run page code).
        if (list.some((c) => c.operationCode !== undefined && c.operationCode.endsWith(UNCLASSIFIED_SUFFIX))) {
          limitationCodes.push(LIMITATION_CODES.argumentNotClassified);
        }
        // ADR-017 §5: a retirement marker (sample-budget-exceeded) = observation stopped after the call budget.
        if (list.some((c) => c.signalCodes.includes(RETIRED_SIGNAL))) {
          limitationCodes.push(LIMITATION_CODES.hookRetired, LIMITATION_CODES.coverageIncomplete);
        }
        findings.push(
          makeFinding({
            ruleId: API_USE_RULE_ID,
            ruleVersion: API_USE_RULE_VERSION,
            techniqueId: id,
            interpretation: 'api-use',
            interpretationConfidence: 'unassessed',
            evidenceIds: evidenceIdsOf(list),
            counterEvidenceCodes: [],
            limitationCodes,
            ...(input.coverageRef !== undefined ? { coverageRef: input.coverageRef } : {}),
          }),
        );
      }
      return findings;
    },
  });
}
