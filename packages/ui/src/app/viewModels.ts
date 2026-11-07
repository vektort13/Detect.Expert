// Derives every view model of a screen from the session (shared by popup and side panel).

import type { ReportSession } from './useReportSession';
import { CATALOG_AVAILABLE } from '../view-models/capabilities';
import { buildCards, buildVendorCards } from '../view-models/cards';
import type { CardVM, VendorCardVM } from '../view-models/cards';
import { countsView, coverageInputOf } from './coverageInput';
import type { CountsVM } from '../view-models/counts';
import { coverageView } from '../view-models/coverage';
import type { CoverageVM } from '../view-models/coverage';

export interface ScreenVM {
  catalogAvailable: boolean;
  coverage: CoverageVM;
  counts: CountsVM;
  cards: CardVM[];
  vendors: VendorCardVM[];
}

export function screenView(session: ReportSession): ScreenVM {
  const report = session.report;
  return {
    catalogAvailable: CATALOG_AVAILABLE,
    coverage: coverageView(coverageInputOf(session)),
    counts: countsView(report),
    cards: report === null ? [] : buildCards(report),
    vendors: report === null ? [] : buildVendorCards(report),
  };
}
