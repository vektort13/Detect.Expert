// Test-profile catalog: production rules plus the testOnly synthetic vendor (loopback hosts only). Imported
// as '@detect-expert/catalog/synthetic' and never re-exported from the package index, so the local build
// cannot reach it unless an entry point imports it explicitly in a test-only branch.

import { buildCatalogIndex } from './build-index';
import { CANDIDATE_RULE_COUNT, PRODUCTION_RULES, PRODUCTION_VENDORS } from './generated/production-catalog';
import { SYNTHETIC_CATALOG_VERSION, SYNTHETIC_RULES, SYNTHETIC_VENDORS } from './generated/synthetic-catalog';
import type { CatalogIndex } from './types';

export const SYNTHETIC_TEST_CATALOG: CatalogIndex = /* @__PURE__ */ buildCatalogIndex({
  kind: 'test',
  catalogVersion: SYNTHETIC_CATALOG_VERSION,
  vendors: [...PRODUCTION_VENDORS, ...SYNTHETIC_VENDORS],
  rules: [...PRODUCTION_RULES, ...SYNTHETIC_RULES],
  candidateRuleCount: CANDIDATE_RULE_COUNT,
});
