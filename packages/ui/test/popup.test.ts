import { describe, expect, it } from 'vitest';
import { COVERAGE_STATES } from '@detect-expert/contracts';
import { popupLayout } from '../src/view-models/popup';

describe('P11 / ADR-003 popup activation layout', () => {
  it('off opens scope immediately after coverage, including an existing report', () => {
    expect(popupLayout('off', 'active', true)).toEqual({
      sections: ['coverage', 'scope', 'counts', 'findings', 'vendors', 'actions'], scope: { open: true },
    });
    expect(popupLayout('off', null, false)).toEqual({ sections: ['coverage', 'scope'], scope: { open: true } });
  });
  it('no-access opens scope even when observation is enabled elsewhere', () => {
    for (const mode of ['active-tab', 'site', 'all-sites'] as const) {
      expect(popupLayout(mode, 'no-access', true)).toEqual({
        sections: ['coverage', 'scope', 'counts', 'findings', 'vendors', 'actions'], scope: { open: true },
      });
    }
  });
  it('active and other accessible states keep scope collapsed below report actions', () => {
    for (const state of COVERAGE_STATES.filter((state) => state !== 'no-access')) {
      expect(popupLayout('site', state, true)).toEqual({
        sections: ['coverage', 'counts', 'findings', 'vendors', 'actions', 'scope'], scope: { open: false },
      });
    }
  });
  it('missing scope/report does not imply that permission should be requested', () => {
    expect(popupLayout(null, null, false).scope.open).toBe(false);
    expect(popupLayout('site', null, false).scope.open).toBe(false);
  });
});
