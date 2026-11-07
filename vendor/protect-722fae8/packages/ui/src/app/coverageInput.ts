// Maps the live session onto the pure coverage view-model input.

import type { ReportSession } from './useReportSession';
import type { CoverageInput } from '../view-models/coverage';
import { organizationDisables } from '../view-models/sensors';

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
    // ADR-019: an organization-disabled sensor family is a setting of the organization («настройки организации»).
    managed: session.scope?.managed === true || organizationDisables(session.scope),
    justGranted: session.justGranted,
  };
}
