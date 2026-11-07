import { describe, expect, it } from 'vitest';
import { MAX_COUNT } from '@detect-expert/contracts';
import type { SignalCode } from '@detect-expert/contracts';
import { summarizePermissionChecks } from '../src/permission-checks';
import { projectReport, verifyProjection } from '../src/index';
import { counter, report } from './fixtures';

const entry = (signals: SignalCode[], count = 1) => counter({ techniqueId: 'DET-039', count, signalCodes: signals });
const cameraGranted: SignalCode[] = ['api-use', 'permission-camera', 'permission-granted'];
const microphoneDenied: SignalCode[] = ['api-use', 'permission-microphone', 'permission-denied'];

describe('permission evidence pairing before technique-summary union', () => {
  it('projects camera/granted and microphone/denied without cross-product inference', () => {
    const projection = projectReport(report({ counters: [entry(cameraGranted, 2), entry(microphoneDenied, 3)] }), { scopeMode: 'all-sites' });
    expect(projection.techniques[0]!.signalCodes).toEqual(expect.arrayContaining(['permission-camera', 'permission-microphone', 'permission-granted', 'permission-denied']));
    expect(projection.permissionChecks).toEqual([
      { permission: 'camera', kind: 'permission', result: 'granted', count: 2, countQuality: 'exact' },
      { permission: 'microphone', kind: 'permission', result: 'denied', count: 3, countQuality: 'exact' },
    ]);
    expect(verifyProjection(projection)).toEqual([]);
    expect(projection.techniques[0]!.integrity).toBe('page-controlled');
  });

  it('retains historical states separately from policy availability instead of replacing them', () => {
    expect(summarizePermissionChecks([
      entry(cameraGranted, 4), entry(['api-use','permission-camera','permission-denied'], 2),
      entry(['api-use','permission-camera','policy-blocked'], 7), entry(['api-use','permission-camera','policy-allowed'], 3),
    ])).toEqual(expect.arrayContaining([
      { permission: 'camera', kind: 'permission', result: 'granted', count: 4, countQuality: 'exact' },
      { permission: 'camera', kind: 'permission', result: 'denied', count: 2, countQuality: 'exact' },
      { permission: 'camera', kind: 'policy', result: 'blocked', count: 7, countQuality: 'exact' },
      { permission: 'camera', kind: 'policy', result: 'allowed', count: 3, countQuality: 'exact' },
    ]));
  });

  it('ignores ambiguous, incomplete, failed and unrelated counters rather than inventing pairs', () => {
    const invalid: SignalCode[][] = [
      ['api-use','permission-camera','permission-microphone'], ['api-use','permission-granted','permission-denied'],
      ['api-use','permission-camera'], ['permission-camera','permission-granted'],
      ['api-use','permission-camera','permission-granted','permission-denied'], ['api-use','permission-camera','policy-enumeration'],
      ['api-use','permission-camera','permission-camera'],
    ];
    const counters = invalid.map(signals => entry(signals));
    counters.push({ ...entry(cameraGranted), phase: 'threw-sync' }, { ...entry(cameraGranted), phase: 'settlement-unobserved' },
      { ...entry(cameraGranted), techniqueId: 'DET-043' }, entry(cameraGranted, 0));
    expect(summarizePermissionChecks(counters)).toEqual([]);
  });

  it('saturates only the matching tuple and carries the worst count quality', () => {
    const rows = summarizePermissionChecks([entry(cameraGranted, MAX_COUNT), entry(cameraGranted, 1),
      entry(microphoneDenied, 4), { ...entry(microphoneDenied, 3), countQuality: 'sampled' }]);
    expect(rows).toEqual([
      { permission: 'camera', kind: 'permission', result: 'granted', count: MAX_COUNT, countQuality: 'lower-bound' },
      { permission: 'microphone', kind: 'permission', result: 'denied', count: 7, countQuality: 'sampled' },
    ]);
  });

  it('refuses a mutated impossible kind/result or duplicate paired DTO at the projection boundary', () => {
    const value = projectReport(report({ counters: [entry(cameraGranted)] }), { scopeMode: 'site' });
    value.permissionChecks![0]!.kind = 'policy'; expect(verifyProjection(value)).not.toEqual([]);
    value.permissionChecks![0]!.kind = 'permission'; value.permissionChecks!.push({ ...value.permissionChecks![0]!, count: 2 });
    expect(verifyProjection(value)).not.toEqual([]);
  });
});
