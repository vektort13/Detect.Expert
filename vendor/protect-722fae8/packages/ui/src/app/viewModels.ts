// Derives every view model of a screen from the session (shared by popup and side panel).
// S10: `catalog` is the build's compiled vendor catalog (PRODUCTION_CATALOG; the synthetic test catalog only in the
// test profile). It supplies display names and rule texts; whether recognition ran comes from the projection's
// catalogVersion (catalogAvailable), never from this UI-side catalog.

import type { CatalogIndex } from '@detect-expert/catalog';
import type { ReportSession } from './useReportSession';
import { catalogAvailable } from '../view-models/capabilities';
import { buildCards, buildVendorCards } from '../view-models/cards';
import type { CardVM, VendorCardVM } from '../view-models/cards';
import { countsView, coverageInputOf } from './coverageInput';
import type { CountsVM } from '../view-models/counts';
import { coverageView } from '../view-models/coverage';
import type { CoverageVM } from '../view-models/coverage';
import { uiLocale } from '../i18n';

export interface CatalogCountsVM {
  /** Rules of the build's catalog that can match (0 while the ADR-009 gate is closed). */
  active: number;
  /** Unverified research candidates that exist in the registry but are not used. */
  candidates: number;
}

export interface ScreenVM {
  catalogAvailable: boolean;
  catalogCounts: CatalogCountsVM;
  /** S10: requests to hosts outside the current access are not recognized (scope other than all-sites, network-limited). */
  vendorsCoverageLimited: boolean;
  coverage: CoverageVM;
  counts: CountsVM;
  cards: CardVM[];
  vendors: VendorCardVM[];
}

export function catalogCounts(catalog: CatalogIndex): CatalogCountsVM {
  return { active: catalog.rules.length, candidates: catalog.candidateRuleCount };
}

export function screenView(session: ReportSession, catalog: CatalogIndex): ScreenVM {
  const report = session.report;
  return {
    catalogAvailable: catalogAvailable(report),
    catalogCounts: catalogCounts(catalog),
    vendorsCoverageLimited: report !== null && (report.scopeMode !== 'all-sites' || report.coverageFlags.includes('network-limited')),
    coverage: coverageView(coverageInputOf(session)),
    counts: countsView(report),
    cards: report === null ? [] : buildCards(report),
    vendors: report === null ? [] : buildVendorCards(report, catalog, uiLocale()),
  };
}
