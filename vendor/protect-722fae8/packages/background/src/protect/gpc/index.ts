// ADR-020 §H (S13): GPC lane of the module «Защита» — the Sec-GPC rule, the read-back check and the per-tab facts.

export { GPC_FLUSH_MS, GPC_PENDING_TTL_MS, GpcService, createGpcService } from './service';
export type { GpcDebug, GpcRuleStatus, GpcServiceOptions } from './service';
export { GPC_HEADER, GPC_HEADER_VALUE, GPC_RESOURCE_TYPES, GPC_RULE_ID, buildGpcRule, gpcExclusions, gpcResourceTypes, verifyGpcRule } from './rule';
export type { GpcRuleCheck } from './rule';
export { gpcHeaderOf } from './header';
export type { GpcHeaderState } from './header';
