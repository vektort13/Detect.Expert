// The catalog shipped in every build profile. It contains only rules that passed the ADR-009 promotion gate
// with rules/policy.json allowProductionRules=true; with the gate closed it has no rules (REQ-008).

import { buildCatalogIndex } from './build-index';
import {
  CANDIDATE_RULE_COUNT,
  PRODUCTION_CATALOG_VERSION,
  PRODUCTION_RULES,
  PRODUCTION_VENDORS,
} from './generated/production-catalog';
import type { CatalogIndex } from './types';

export const PRODUCTION_CATALOG: CatalogIndex = /* @__PURE__ */ buildCatalogIndex({
  kind: 'production',
  catalogVersion: PRODUCTION_CATALOG_VERSION,
  vendors: PRODUCTION_VENDORS,
  rules: PRODUCTION_RULES,
  candidateRuleCount: CANDIDATE_RULE_COUNT,
});
