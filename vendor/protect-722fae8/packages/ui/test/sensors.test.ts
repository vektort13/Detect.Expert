// ADR-019 (S11): sensor family view model and coverage lines (spec V §7: «датчик отключён», «настройки организации»).
import { describe, expect, it } from 'vitest';
import { SENSOR_IDS, type ScopeState } from '@detect-expert/contracts';
import { coverageView } from '../src/view-models/coverage';
import type { CoverageInput } from '../src/view-models/coverage';
import {
  disabledSensorIds,
  organizationDisables,
  organizationPolicyOf,
  rejectedPolicyEntriesOf,
  sensorNotices,
  sensorReasonKey,
  sensorRows,
} from '../src/view-models/sensors';
import { report, scope } from './fixtures';

function input(overrides: Partial<CoverageInput> = {}): CoverageInput {
  return {
    loaded: true, report: report(), scopeMode: 'site', tabUrlClass: 'web', chromeSupported: true, chromeVersion: '153',
    swAvailable: true, managed: false, justGranted: false, ...overrides,
  };
}

describe('sensorRows', () => {
  it('one row per registry family, in registry order, with keys and states', () => {
    const rows = sensorRows(scope({}, {
      webgl: { enabled: false, disabledBy: ['user'] },
      audio: { enabled: false, disabledBy: ['organization'] },
      geometry: { enabled: false, disabledBy: ['user', 'organization'] },
    }));
    expect(rows.map((r) => r.sensorId)).toEqual([...SENSOR_IDS]);
    expect(rows.map((r) => [r.sensorId, r.enabled, r.locked, r.stateKey])).toEqual([
      ['canvas', true, false, 'options_sensor_state_on'],
      ['webgl', false, false, 'options_sensor_state_off_user'],
      ['audio', false, true, 'options_sensor_state_off_org'],
      ['permissions', true, false, 'options_sensor_state_on'],
      ['environment', true, false, 'options_sensor_state_on'],
      ['geometry', false, true, 'options_sensor_state_off_org'],
    ]);
    expect(rows[0]).toMatchObject({ nameKey: 'sensor_name_canvas', descKey: 'sensor_desc_canvas' });
  });

  it('reads defensively: missing settings, unknown ids, bad shapes and a contradictory enabled flag', () => {
    expect(sensorRows(null)).toEqual([]);
    const { sensorSettings: _s, ...noSettings } = scope();
    expect(sensorRows(noSettings as ScopeState)).toEqual([]);
    const odd = { ...scope(), sensorSettings: { sensors: [
      { sensorId: 'math', enabled: false, disabledBy: ['user'] },
      { sensorId: 'canvas', enabled: true, disabledBy: ['organization', 'admin'] },
      'webgl',
    ], organizationPolicy: 'weird', rejectedPolicyEntries: -3 } } as unknown as ScopeState;
    expect(sensorRows(odd)).toEqual([{ sensorId: 'canvas', nameKey: 'sensor_name_canvas', descKey: 'sensor_desc_canvas', enabled: false,
      disabledBy: ['organization'], locked: true, stateKey: 'options_sensor_state_off_org' }]);
    expect(organizationPolicyOf(odd)).toBe('absent');
    expect(rejectedPolicyEntriesOf(odd)).toBe(0);
  });

  it('organization helpers, notices and diagnostics ids', () => {
    const user = scope({}, { canvas: { enabled: false, disabledBy: ['user'] } });
    expect(organizationDisables(user)).toBe(false);
    expect(sensorNotices(user)).toEqual([]);
    expect(disabledSensorIds(user)).toEqual(['canvas']);
    const org = scope({ sensorSettings: { ...scope().sensorSettings, organizationPolicy: 'last-known-good', rejectedPolicyEntries: 4 } }, {});
    org.sensorSettings.sensors[1] = { sensorId: 'webgl', enabled: false, disabledBy: ['organization'] };
    expect(organizationDisables(org)).toBe(true);
    expect(sensorNotices(org)).toEqual([
      { key: 'options_sensors_org_policy' },
      { key: 'options_sensors_policy_rejected', subs: [4] },
      { key: 'options_sensors_policy_lkg' },
    ]);
    expect(disabledSensorIds(org)).toEqual(['webgl']);
  });

  it('reason keys', () => {
    expect(sensorReasonKey(['user'])).toBe('sensor_disabled_reason_user');
    expect(sensorReasonKey(['organization'])).toBe('sensor_disabled_reason_organization');
    expect(sensorReasonKey(['user', 'organization'])).toBe('sensor_disabled_reason_both');
  });
});

describe('coverage lines for disabled families', () => {
  it('disabled now: reason line per family, hooks line once, reload in site mode, attention tone', () => {
    const vm = coverageView(input({ report: report({ coverageState: 'partial', coverageFlags: ['sensor-disabled'], scopeMode: 'site', disabledSensors: [
      { sensorId: 'canvas', disabledBy: ['user'], hooksMayRemain: true },
      { sensorId: 'webgl', disabledBy: ['organization'], hooksMayRemain: true },
    ] }) }));
    expect(vm.state).toBe('partial');
    expect(vm.tone).toBe('attention');
    expect(vm.showReload).toBe(true);
    expect(vm.flags.map((f) => f.label.key)).toEqual(['coverage_flag_sensor_disabled']);
    expect(vm.lines.slice(1)).toEqual([
      { key: 'coverage_sensor_disabled_desc', subs: [{ key: 'sensor_name_canvas' }, { key: 'sensor_disabled_reason_user' }] },
      { key: 'coverage_sensor_disabled_desc', subs: [{ key: 'sensor_name_webgl' }, { key: 'sensor_disabled_reason_organization' }] },
      { key: 'coverage_sensor_disabled_reload' },
    ]);
  });

  it('enabled again after load: reload line, no hooks line without hooksMayRemain; active-tab offers no reload', () => {
    const vm = coverageView(input({ scopeMode: 'active-tab', report: report({ coverageState: 'partial', coverageFlags: ['sensor-disabled'], disabledSensors: [
      { sensorId: 'geometry', disabledBy: [], hooksMayRemain: false },
    ] }) }));
    expect(vm.lines.slice(1)).toEqual([{ key: 'coverage_sensor_reenabled_reload', subs: [{ key: 'sensor_name_geometry' }] }]);
    expect(vm.showReload).toBe(false);
  });

  it('without disabledSensors the lines are unchanged', () => {
    const vm = coverageView(input({ report: report({ coverageState: 'active' }) }));
    expect(vm.lines).toEqual([{ key: 'coverage_active_desc' }]);
    expect(vm.showReload).toBe(false);
  });
});

describe('coverageInputOf: organization settings count as managed («настройки организации»)', () => {
  it('managed when the organization disables a family, not for a user-only choice', async () => {
    const { coverageInputOf } = await import('../src/app/coverageInput');
    const session = (s: ScopeState) => ({ loaded: true, report: null, scope: s, tabUrlClass: 'web', chrome: { supported: true, version: '153', major: 153 }, swAvailable: true, justGranted: false }) as unknown as Parameters<typeof coverageInputOf>[0];
    expect(coverageInputOf(session(scope({}, { canvas: { enabled: false, disabledBy: ['user'] } }))).managed).toBe(false);
    expect(coverageInputOf(session(scope({}, { canvas: { enabled: false, disabledBy: ['organization'] } }))).managed).toBe(true);
  });
});
