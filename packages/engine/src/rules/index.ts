// Rule registry: declarative list shipped with the code (REQ-010: no remote rules). Findings are bounded to
// BUDGETS.maxFindingsPerDocument; overflow is counted, never silently lost.

import { BUDGETS, type Finding, type TechniqueId } from '@detect-expert/contracts';
import { createGenericApiUseRule } from './api-use';
import { canvasRule } from './canvas';
import type { Rule, RuleInput } from './types';

const claimed: ReadonlySet<TechniqueId> = new Set<TechniqueId>(canvasRule.techniqueIds);

export const RULES: readonly Rule[] = Object.freeze([canvasRule, createGenericApiUseRule(claimed)]);

export interface RulesResult {
  findings: Finding[];
  /** Findings beyond the per-document cap (or duplicate ids) that were not kept. */
  dropped: number;
}

export function runRules(input: RuleInput, rules: readonly Rule[] = RULES): RulesResult {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const rule of rules) {
    for (const f of rule.evaluate(input)) {
      if (seen.has(f.findingId)) {
        dropped++;
        continue;
      }
      if (findings.length >= BUDGETS.maxFindingsPerDocument) {
        dropped++;
        continue;
      }
      seen.add(f.findingId);
      findings.push(f);
    }
  }
  return { findings, dropped };
}

export { canvasRule, evaluateCanvas, canvasStats, CANVAS_RULE_ID, CANVAS_RULE_VERSION, RULE_PARAMS } from './canvas';
export type { CanvasStats } from './canvas';
export { createGenericApiUseRule, API_USE_RULE_ID, API_USE_RULE_VERSION } from './api-use';
export { findingId, evidenceIdsOf, makeFinding } from './types';
export type { Rule, RuleInput, FindingDraft } from './types';
