// P11 / ADR-003 / REQ-006: coverage precedes activation and every finding.
// ADR-020 «Защита» (S06): with the module not off, its area ('protect') comes first after Header / Notice; without the
// argument (module off) the layout is exactly the previous one.
import type { CoverageState, ScopeMode } from '@detect-expert/contracts';

export type PopupSection = 'protect' | 'coverage' | 'scope' | 'counts' | 'findings' | 'vendors' | 'actions';

export function popupLayout(scopeMode: ScopeMode | null, coverageState: CoverageState | null, hasReport: boolean, protect: 'area' | null = null) {
  const open = scopeMode === 'off' || coverageState === 'no-access';
  const reportSections: PopupSection[] = hasReport ? ['counts', 'findings', 'vendors', 'actions'] : [];
  const observation: PopupSection[] = open
    ? ['coverage', 'scope', ...reportSections]
    : ['coverage', ...reportSections, 'scope'];
  const sections: PopupSection[] = protect === 'area' ? ['protect', ...observation] : observation;
  return { sections, scope: { open } };
}
