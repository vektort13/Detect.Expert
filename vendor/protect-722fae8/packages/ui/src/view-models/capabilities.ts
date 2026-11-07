// REQ-008 / F059 / F062 / S10: recognition was attempted for a projection only when the SW matched it against a
// catalog with active rules; the SW says so with a non-null catalogVersion. This is never inferred from findings or
// from the number of vendors (an evaluated empty result and an unavailable catalog are different states).

import type { ReportProjection } from '@detect-expert/contracts';

export function catalogAvailable(report: ReportProjection | null): boolean {
  return report !== null && typeof (report as { catalogVersion?: unknown }).catalogVersion === 'string';
}
