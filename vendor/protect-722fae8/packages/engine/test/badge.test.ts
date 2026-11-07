import { describe, expect, it } from 'vitest';
import { COVERAGE_STATES, SCOPE_MODES } from '@detect-expert/contracts';
import type { CoverageFlag, CoverageState, Finding, Interpretation, ReportProjection, ScopeMode, TechniqueId } from '@detect-expert/contracts';
import { BADGE_INTERPRETATIONS, BADGE_STATUS_KEYS, badgeCategoryCount, badgeView, interpretReport, projectReport, toPopupViewModel } from '../src/index';
import { BADGE_FIREWALL_MAX, firewallBadgeText } from '../src/badge';
import { FP_POSITIVE, EDITOR, report } from './fixtures';

function finding(techniqueId: TechniqueId, interpretation: Interpretation, id = techniqueId + interpretation): Finding {
  return {
    findingId: id, ruleId: 'rule', ruleVersion: '1', techniqueId, interpretation, interpretationConfidence: 'low',
    evidenceIds: ['ev'], counterEvidenceCodes: [], limitationCodes: [], vendorMatchIds: [],
  };
}

function projection(state: CoverageState, findings: Finding[], flags: CoverageFlag[] = [], over: Partial<ReportProjection> = {}): ReportProjection {
  const base = projectReport(interpretReport(report({ counters: [] }), { scopeMode: 'site', accessGranted: true, restricted: false, paused: false, inaccessibleFrames: 0 }).report, { scopeMode: 'site' });
  return { ...base, coverageState: state, coverageFlags: flags, findings, ...over };
}

const FP = [finding('DET-002', 'possible-fingerprinting')];

describe('badgeCategoryCount (E13-03)', () => {
  it('counts distinct categories of interpretive findings only', () => {
    expect([...BADGE_INTERPRETATIONS].sort()).toEqual(['dns-test-pattern', 'fingerprinting-pattern', 'local-probe-pattern', 'possible-fingerprinting']);
    expect(badgeCategoryCount([])).toBe(0);
    // Two graphics findings are one category; media-compute and network add one each.
    expect(badgeCategoryCount([
      finding('DET-001', 'possible-fingerprinting'), finding('DET-002', 'fingerprinting-pattern'),
      finding('DET-015', 'possible-fingerprinting'), finding('DET-060', 'local-probe-pattern'), finding('DET-061', 'dns-test-pattern'),
    ])).toBe(3);
    // api-use and unknown never count.
    expect(badgeCategoryCount([finding('DET-002', 'api-use'), finding('DET-039', 'unknown')])).toBe(0);
  });
});

describe('badgeView: rules in order, first match wins (E13-03)', () => {
  it('1: no report -> empty; off tooltip in off mode, otherwise the action title', () => {
    expect(badgeView(null, 'off')).toEqual({ text: '', title: { key: 'badge_tooltip_off', subs: [] } });
    for (const mode of ['active-tab', 'site', 'all-sites'] as const) expect(badgeView(null, mode)).toEqual({ text: '', title: { key: 'actionTitle', subs: [] } });
  });

  it('2: revoked wins over everything else (even with findings and scope off)', () => {
    for (const mode of SCOPE_MODES) {
      expect(badgeView(projection('no-access', FP, ['revoked']), mode)).toEqual({ text: '', title: { key: 'badge_tooltip_revoked', subs: [] } });
    }
    expect(badgeView(projection('active', FP, ['revoked']), 'site').text).toBe('');
  });

  it('3: scope off -> empty with the off tooltip, even with stored findings', () => {
    expect(badgeView(projection('active', FP), 'off')).toEqual({ text: '', title: { key: 'badge_tooltip_off', subs: [] } });
  });

  it('4/5: no-access and unsupported are empty with their own tooltip', () => {
    expect(badgeView(projection('no-access', FP), 'site')).toEqual({ text: '', title: { key: 'badge_tooltip_no_access', subs: [] } });
    expect(badgeView(projection('unsupported', FP), 'all-sites')).toEqual({ text: '', title: { key: 'coverage_unsupported_title', subs: [] } });
  });

  it('6: nothing to count -> empty, never "0"; the tooltip names the observation state', () => {
    for (const state of ['active', 'partial', 'late-start', 'paused', 'degraded'] as const) {
      expect(badgeView(projection(state, [finding('DET-002', 'api-use')]), 'site')).toEqual({
        text: '', title: { key: 'badge_tooltip_none', subs: [{ key: BADGE_STATUS_KEYS[state] }] },
      });
    }
  });

  it('7/8/9: paused, active and the limited states show the count', () => {
    const two = [finding('DET-002', 'possible-fingerprinting'), finding('DET-016', 'possible-fingerprinting')];
    expect(badgeView(projection('paused', two), 'site')).toEqual({ text: '2', title: { key: 'badge_tooltip_paused', subs: ['2'] } });
    expect(badgeView(projection('active', two), 'all-sites')).toEqual({ text: '2', title: { key: 'badge_tooltip', subs: ['2'] } });
    for (const state of ['partial', 'late-start', 'degraded'] as const) {
      expect(badgeView(projection(state, two), 'active-tab')).toEqual({ text: '2', title: { key: 'badge_tooltip_limited', subs: ['2', { key: BADGE_STATUS_KEYS[state] }] } });
    }
  });

  it('never yields "0", "?" or "!" for any state, mode and finding set; every status key exists in the table', () => {
    const sets: Finding[][] = [[], FP, [finding('DET-039', 'unknown')], [finding('DET-060', 'local-probe-pattern'), finding('DET-002', 'api-use')]];
    for (const state of COVERAGE_STATES) {
      expect(BADGE_STATUS_KEYS[state]).toMatch(/^status_[a-z_]+$/);
      for (const mode of SCOPE_MODES) for (const set of sets) for (const flags of [[], ['revoked']] as CoverageFlag[][]) {
        const view = badgeView(projection(state, set, flags), mode as ScopeMode);
        expect(['0', '?', '!']).not.toContain(view.text);
        expect(view.text === '' || /^[1-9]\d*$/.test(view.text)).toBe(true);
      }
    }
  });

  it('vendors are not counted; the popup view model uses the same number', () => {
    const vendors: ReportProjection['vendors'] = [{ vendorId: 'test-vendor', vendorConfidence: 'documented-resource', ruleIds: [], evidenceSource: 'browser-network', integrity: 'browser-observed' }];
    const withVendor = projection('active', [], [], { vendors });
    expect(badgeView(withVendor, 'site').text).toBe('');
    expect(toPopupViewModel(withVendor, 'en').badge.count).toBe(0);
    const fp = projectReport(interpretReport(report({ counters: FP_POSITIVE }), { scopeMode: 'site', accessGranted: true, restricted: false, paused: false, inaccessibleFrames: 0 }).report, { scopeMode: 'site' });
    expect(badgeView(fp, 'site').text).toBe(String(toPopupViewModel(fp, 'en').badge.count));
    expect(badgeView(fp, 'site').text).toBe('1');
    const editor = projectReport(interpretReport(report({ counters: EDITOR }), { scopeMode: 'site', accessGranted: true, restricted: false, paused: false, inaccessibleFrames: 0 }).report, { scopeMode: 'site' });
    expect(badgeView(editor, 'site')).toEqual({ text: '', title: { key: 'badge_tooltip_none', subs: [{ key: 'status_active' }] } });
  });
});

// ADR-020 §D (S09): firewall prompts of the module «Защита» take the badge; without the module nothing changes.
describe('badgeView with firewall prompts (S09)', () => {
  const sets: Finding[][] = [[], FP, [finding('DET-039', 'unknown')]];

  it('no third argument, null or pending 0 -> exactly the observation badge (no tone field)', () => {
    for (const state of COVERAGE_STATES) for (const mode of SCOPE_MODES) for (const set of sets) for (const flags of [[], ['revoked']] as CoverageFlag[][]) {
      const rep = projection(state, set, flags);
      const before = badgeView(rep, mode as ScopeMode);
      expect(before).not.toHaveProperty('tone');
      expect(badgeView(rep, mode as ScopeMode, null)).toEqual(before);
      expect(badgeView(rep, mode as ScopeMode, { pending: 0 })).toEqual(before);
      expect(badgeView(rep, mode as ScopeMode, { pending: -3 })).toEqual(before);
      expect(badgeView(rep, mode as ScopeMode, { pending: Number.NaN })).toEqual(before);
    }
    expect(badgeView(null, 'off', { pending: 0 })).toEqual({ text: '', title: { key: 'badge_tooltip_off', subs: [] } });
  });

  it('pending > 0 -> 1…9, then 9+, tone firewall and the firewall tooltip with the exact number', () => {
    expect(firewallBadgeText(1)).toBe('1');
    expect(firewallBadgeText(9)).toBe('9');
    expect(firewallBadgeText(10)).toBe('9+');
    expect(firewallBadgeText(2 ** 31)).toBe('9+');
    expect(firewallBadgeText(0)).toBe('');
    expect(firewallBadgeText(0.5)).toBe('');
    expect(BADGE_FIREWALL_MAX).toBe(9);
    expect(badgeView(projection('active', FP), 'site', { pending: 2 })).toEqual({ text: '2', title: { key: 'badge_tooltip_firewall', subs: ['2'] }, tone: 'firewall' });
    expect(badgeView(projection('active', FP), 'site', { pending: 12 })).toEqual({ text: '9+', title: { key: 'badge_tooltip_firewall', subs: ['12'] }, tone: 'firewall' });
  });

  it('the module does not depend on the observation scope: off, no report, revoked or no-access still show the prompts', () => {
    expect(badgeView(null, 'off', { pending: 1 }).text).toBe('1');
    expect(badgeView(null, 'site', { pending: 3 }).tone).toBe('firewall');
    expect(badgeView(projection('no-access', FP, ['revoked']), 'site', { pending: 1 }).text).toBe('1');
  });

  it('never yields "0", "?" or "!" with any pending value', () => {
    for (const pending of [0, 1, 2, 9, 10, 99, -1, 0.2, Number.POSITIVE_INFINITY, Number.NaN]) {
      for (const state of COVERAGE_STATES) {
        const view = badgeView(projection(state, FP), 'site', { pending });
        expect(['0', '?', '!']).not.toContain(view.text);
        expect(view.text === '' || /^(?:[1-9]\d*|9\+)$/.test(view.text)).toBe(true);
      }
    }
  });
});
