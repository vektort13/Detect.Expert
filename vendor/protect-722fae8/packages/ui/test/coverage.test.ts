import { describe, expect, it } from 'vitest';
import { COVERAGE_FLAGS, COVERAGE_STATES } from '@detect-expert/contracts';
import type { CoverageState } from '@detect-expert/contracts';
import { COVERAGE_TITLE_KEYS, STATUS_KEYS, coverageFlagKey, coverageView, droppedTotal } from '../src/view-models/coverage';
import type { CoverageInput } from '../src/view-models/coverage';
import { fallbackMessage } from '../src/i18n';
import { resolveMessage } from '../src/view-models/message';
import { report } from './fixtures';

it('P07: ring lower bound contributes to drop diagnostics while old reports remain supported', () => {
  const source = report();
  const before = droppedTotal(source);
  source.dropped.ring = 1;
  expect(droppedTotal(source)).toBe(before + 1);
});

function input(overrides: Partial<CoverageInput> = {}): CoverageInput {
  return {
    loaded: true,
    report: report(),
    scopeMode: 'site',
    tabUrlClass: 'web',
    chromeSupported: true,
    chromeVersion: '153',
    swAvailable: true,
    managed: false,
    justGranted: false,
    ...overrides,
  };
}

const EXPECTED: Record<CoverageState, { title: string; desc: string }> = {
  active: { title: 'coverage_active_title', desc: 'coverage_active_desc' },
  partial: { title: 'coverage_partial_title', desc: 'coverage_partial_desc' },
  'late-start': { title: 'coverage_late_start_title', desc: 'coverage_late_start_desc' },
  paused: { title: 'coverage_paused_title', desc: 'coverage_paused_desc' },
  unsupported: { title: 'coverage_unsupported_title', desc: 'coverage_unsupported_desc' },
  'no-access': { title: 'coverage_no_access_title', desc: 'coverage_no_access_desc' },
  degraded: { title: 'coverage_degraded_title', desc: 'coverage_degraded_desc' },
};

describe('coverageView: every coverage state maps to its docs/ui-copy.md §2 keys', () => {
  for (const state of COVERAGE_STATES) {
    it(state, () => {
      const vm = coverageView(input({ report: report({ coverageState: state }) }));
      expect(vm.state).toBe(state);
      expect(vm.title.key).toBe(EXPECTED[state].title);
      expect(vm.lines[0]?.key).toBe(EXPECTED[state].desc);
      expect(vm.status.key).toBe(STATUS_KEYS[state]);
      expect(COVERAGE_TITLE_KEYS[state]).toBe(EXPECTED[state].title);
    });
  }

  it('never uses an error tone for a plain coverage state (red = product error only)', () => {
    for (const state of COVERAGE_STATES) {
      const vm = coverageView(input({ report: report({ coverageState: state }) }));
      expect(vm.tone).not.toBe('error');
    }
  });

  it('collection failures (hook-failed, protocol-mismatch, ...) turn the tone red and keep the state', () => {
    const vm = coverageView(input({ report: report({ coverageState: 'partial', coverageFlags: ['hook-failed'] }) }));
    expect(vm.tone).toBe('error');
    expect(vm.state).toBe('partial');
    expect(vm.flags.map((f) => f.flag)).toEqual(['hook-failed']);
  });

  it('late-start shows the reload action; active does not', () => {
    expect(coverageView(input({ report: report({ coverageState: 'late-start' }) })).showReload).toBe(true);
    expect(coverageView(input({ report: report({ coverageState: 'active' }) })).showReload).toBe(false);
    expect(coverageView(input({ report: report({ coverageState: 'active', coverageFlags: ['late-start'] }) })).showReload).toBe(true);
  });

  it('ADR-003 active-tab never offers reload as a way to observe the next document', () => {
    for (const coverageState of ['late-start', 'partial'] as const) {
      const vm = coverageView(input({ scopeMode: 'active-tab', report: report({ coverageState, coverageFlags: ['late-start'] }) }));
      expect(vm.showReload).toBe(false);
      expect(vm.lines.map((line) => line.key)).toContain('coverage_late_start_active_tab_desc');
      expect(vm.lines.map((line) => line.key)).not.toContain('coverage_late_start_desc');
    }
  });

  it('access just granted shows the reload explanation and the button', () => {
    const vm = coverageView(input({ report: report({ coverageState: 'no-access' }), justGranted: true }));
    expect(vm.showReload).toBe(true);
    expect(vm.lines.map((l) => l.key)).toContain('scope_permission_granted_reload');
  });

  it('paused carries the mandatory wording and the reload hint', () => {
    const vm = coverageView(input({ report: report({ coverageState: 'paused' }) }));
    expect(vm.lines.map((l) => l.key)).toEqual(['coverage_paused_desc', 'coverage_paused_reload']);
    expect(vm.tone).toBe('muted');
  });

  it('no-access with the revoked flag uses the revoked text with the host', () => {
    const vm = coverageView(input({ report: report({ coverageState: 'no-access', coverageFlags: ['revoked'], host: 'bank.example' }) }));
    expect(vm.lines[0]).toEqual({ key: 'coverage_revoked_desc', subs: ['bank.example'] });
    const unknownHost = coverageView(input({ report: report({ coverageState: 'no-access', host: null }) }));
    expect(resolveMessage(fallbackMessage, unknownHost.lines[0]!)).toBe('coverage_no_access_desc[host_unknown]');
  });

  it('degraded includes the dropped total; any state with drops adds the degraded line', () => {
    const dropped = { observations: 5, batches: 1, findings: 0, hosts: 0, counters: 2, transport: 0 };
    const degraded = coverageView(input({ report: report({ coverageState: 'degraded', dropped }) }));
    expect(degraded.lines[0]).toEqual({ key: 'coverage_degraded_desc', subs: [8] });
    expect(degraded.droppedTotal).toBe(8);
    const active = coverageView(input({ report: report({ coverageState: 'active', dropped }) }));
    expect(active.lines.map((l) => l.key)).toEqual(['coverage_active_desc', 'coverage_degraded_desc']);
    expect(droppedTotal(null)).toBe(0);
  });

  it('partial joins the flag labels into the detail placeholder', () => {
    const vm = coverageView(input({ report: report({ coverageState: 'partial', coverageFlags: ['no-host-permission', 'worker-not-observed'] }) }));
    expect(resolveMessage(fallbackMessage, vm.lines[0]!)).toBe(
      'coverage_partial_desc[coverage_flag_no_host_permission, coverage_flag_worker_not_observed]',
    );
    const bare = coverageView(input({ report: report({ coverageState: 'partial' }) }));
    expect(resolveMessage(fallbackMessage, bare.lines[0]!)).toBe('coverage_partial_desc[coverage_partial_detail_unknown]');
  });

  it('managed policy adds the organisation line to every state', () => {
    const vm = coverageView(input({ managed: true }));
    expect(vm.lines.map((l) => l.key)).toContain('coverage_managed_desc');
    const off = coverageView(input({ report: null, scopeMode: 'off', managed: true }));
    expect(off.lines.map((l) => l.key)).toContain('coverage_managed_desc');
  });
});

describe('coverageView: non-report states', () => {
  it('scope off', () => {
    const vm = coverageView(input({ report: null, scopeMode: 'off' }));
    expect(vm.state).toBe('off');
    expect(vm.title.key).toBe('state_scope_off_title');
    expect(vm.lines[0]?.key).toBe('coverageOff');
    expect(vm.lines.map((line) => line.key)).toContain('scope_start_hint');
    expect(vm.status.key).toBe('status_off');
    expect(vm.showReload).toBe(false);
  });
  it('F011 scope off remains explicit with a host-free retained status report', () => {
    const vm = coverageView(input({ report: report({ host: null, coverageState: 'no-access' }), scopeMode: 'off' }));
    expect(vm.state).toBe('off');
    expect(vm.status.key).toBe('status_off');
    expect(vm.lines.map((line) => line.key)).toContain('coverage_no_access_title');
  });

  it('P05 revoked scope off retains no-access and the reload explanation', () => {
    const vm = coverageView(input({ report: report({ host: null, coverageState: 'no-access', coverageFlags: ['revoked'] }), scopeMode: 'off' }));
    expect(vm.state).toBe('no-access');
    expect(vm.status.key).toBe('status_no_access');
    expect(vm.lines[0]?.key).toBe('coverage_revoked_desc');
  });

  it('no report yet with an active scope (page opened before activation)', () => {
    const vm = coverageView(input({ report: null, scopeMode: 'site' }));
    expect(vm.state).toBe('no-report');
    expect(vm.title.key).toBe('state_no_report_title');
    expect(vm.showReload).toBe(true);
    expect(coverageView(input({ report: null, scopeMode: 'active-tab' })).showReload).toBe(false);
  });

  it('restricted page wins over the report', () => {
    const vm = coverageView(input({ tabUrlClass: 'restricted' }));
    expect(vm.state).toBe('restricted');
    expect(vm.title.key).toBe('coverage_unsupported_title');
    expect(vm.lines[0]?.key).toBe('coverage_unsupported_desc');
  });

  it('unsupported chrome names the version', () => {
    const vm = coverageView(input({ chromeSupported: false, chromeVersion: '110' }));
    expect(vm.state).toBe('unsupported-chrome');
    expect(vm.lines[0]).toEqual({ key: 'coverage_unsupported_chrome_desc', subs: ['110'] });
  });

  it('unreachable background process is a product error (red)', () => {
    const vm = coverageView(input({ swAvailable: false }));
    expect(vm.state).toBe('unavailable');
    expect(vm.tone).toBe('error');
    expect(vm.title.key).toBe('state_sw_unavailable_title');
  });
});

describe('coverage flags', () => {
  it('every contract flag has a stable key', () => {
    for (const flag of COVERAGE_FLAGS) expect(coverageFlagKey(flag)).toMatch(/^coverage_flag_[a-z_]+$/);
    expect(coverageFlagKey('no-host-permission')).toBe('coverage_flag_no_host_permission');
  });

  it('duplicate flags are collapsed', () => {
    const vm = coverageView(input({ report: report({ coverageFlags: ['throttled', 'throttled', 'truncated'] }) }));
    expect(vm.flags.map((f) => f.flag)).toEqual(['throttled', 'truncated']);
  });
});

// F063 / REQ-006: neither an unanswered nor an unresolved scope is an off response.
it('distinguishes loading, unresolved scope, and explicit off', () => {
  const loading = coverageView(input({ loaded: false, report: null, scopeMode: null }));
  expect(loading.state).toBe('loading');
  expect(loading.title.key).toBe('statusLoading');
  expect(loading.status.key).toBe('statusLoading');
  expect(loading.showReload).toBe(false);
  expect(coverageView(input({ report: null, scopeMode: null })).state).toBe('unavailable');
  expect(coverageView(input({ report: null, scopeMode: 'off' })).state).toBe('off');
});
