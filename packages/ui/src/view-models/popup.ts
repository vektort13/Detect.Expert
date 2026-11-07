// P11 / ADR-003 / REQ-006: coverage precedes activation and every finding.
import type { CoverageState, ScopeMode } from '@detect-expert/contracts';

export type PopupSection = 'coverage' | 'scope' | 'counts' | 'findings' | 'vendors' | 'actions';

export function popupLayout(scopeMode: ScopeMode | null, coverageState: CoverageState | null, hasReport: boolean) {
  const open = scopeMode === 'off' || coverageState === 'no-access';
  const reportSections: PopupSection[] = hasReport ? ['counts', 'findings', 'vendors', 'actions'] : [];
  const sections: PopupSection[] = open
    ? ['coverage', 'scope', ...reportSections]
    : ['coverage', ...reportSections, 'scope'];
  return { sections, scope: { open } };
}
