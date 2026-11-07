// Generic 'api-use' rule: one observation-level finding per technique that no specialized rule owns, so the UI
// can list usage for every observed technique (spec III §1: "API used" is a card type of its own).

import { TECHNIQUE_IDS, type CounterEntry, type Finding, type TechniqueId } from '@detect-expert/contracts';
import { LIMITATION_CODES } from '../codes';
import { evidenceIdsOf, makeFinding, type Rule, type RuleInput } from './types';

export const API_USE_RULE_ID = 'api-use-generic';
export const API_USE_RULE_VERSION = '1';

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
        findings.push(
          makeFinding({
            ruleId: API_USE_RULE_ID,
            ruleVersion: API_USE_RULE_VERSION,
            techniqueId: id,
            interpretation: 'api-use',
            interpretationConfidence: 'unassessed',
            evidenceIds: evidenceIdsOf(list),
            counterEvidenceCodes: [],
            limitationCodes: [LIMITATION_CODES.pageControlledEvidence, LIMITATION_CODES.purposeUnknown],
            ...(input.coverageRef !== undefined ? { coverageRef: input.coverageRef } : {}),
          }),
        );
      }
      return findings;
    },
  });
}
