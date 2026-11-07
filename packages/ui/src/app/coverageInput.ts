// Maps the live session onto the pure coverage view-model input.

import type { ReportSession } from './useReportSession';
import type { CoverageInput } from '../view-models/coverage';

export { countsView } from '../view-models/counts';

export function coverageInputOf(session: ReportSession): CoverageInput {
  return {
    loaded: session.loaded,
    report: session.report,
    scopeMode: session.scope === null ? null : session.scope.scopeMode,
    tabUrlClass: session.tabUrlClass,
    chromeSupported: session.chrome.supported,
    chromeVersion: session.chrome.version,
    swAvailable: session.swAvailable,
    managed: session.scope?.managed === true,
    justGranted: session.justGranted,
  };
}
