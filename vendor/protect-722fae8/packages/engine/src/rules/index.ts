// Rule registry: declarative list shipped with the code (REQ-010: no remote rules). Findings are bounded to
// BUDGETS.maxFindingsPerDocument; overflow is counted, never silently lost.

import { BUDGETS, type Finding, type TechniqueId } from '@detect-expert/contracts';
import { createGenericApiUseRule } from './api-use';
import { audioRule } from './audio';
import { canvasRule } from './canvas';
import { networkRule } from './network';
import { permissionsRule } from './permissions';
import type { Rule, RuleInput } from './types';
import { webglRule } from './webgl';

// S07: the network rule claims DET-058…061, so page-hook counters of them never get a generic api-use finding.
// S04: the WebGL rule claims DET-011/012 (webgl-capability-probe v1).
// S05: audio-offline-graph v1 claims DET-015/016, permissions-breadth v1 claims DET-039.
const claimed: ReadonlySet<TechniqueId> = new Set<TechniqueId>([
  ...canvasRule.techniqueIds,
  ...webglRule.techniqueIds,
  ...audioRule.techniqueIds,
  ...permissionsRule.techniqueIds,
  ...networkRule.techniqueIds,
]);

export const RULES: readonly Rule[] = Object.freeze([
  canvasRule,
  webglRule,
  audioRule,
  permissionsRule,
  networkRule,
  createGenericApiUseRule(claimed),
]);

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
export { webglRule, evaluateWebgl, webglStats, webglProbeMet, WEBGL_RULE_ID, WEBGL_RULE_VERSION, WEBGL_RULE_PARAMS } from './webgl';
export type { WebglStats } from './webgl';
export { audioRule, evaluateAudio, audioStats, audioSequenceMet, AUDIO_RULE_ID, AUDIO_RULE_VERSION, AUDIO_RULE_PARAMS } from './audio';
export type { AudioStats } from './audio';
export {
  permissionsRule,
  evaluatePermissions,
  permissionStats,
  permissionsBreadthMet,
  PERMISSION_CATEGORY_OPERATIONS,
  PERMISSIONS_RULE_ID,
  PERMISSIONS_RULE_VERSION,
  PERMISSIONS_RULE_PARAMS,
} from './permissions';
export type { PermissionStats } from './permissions';
export { DEGRADING_FLAGS, DEGRADING_SIGNALS, isDegraded, capLow, sumCount, hasOp } from './shared';
export {
  networkRule,
  evaluateNetwork,
  looksRandomLabel,
  networkPatternMet,
  NETWORK_RULE_ID,
  NETWORK_RULE_VERSION,
  NETWORK_RULE_PARAMS,
  NETWORK_WINDOW_MATCHES_BUDGET,
} from './network';
export { findingId, evidenceIdsOf, makeFinding } from './types';
export type { Rule, RuleInput, FindingDraft, NetworkRuleInput } from './types';
