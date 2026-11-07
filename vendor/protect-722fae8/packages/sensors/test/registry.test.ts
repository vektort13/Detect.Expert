// Sensor family registry (task E06-03; disable registry of ADR-019/S11): stable ids, off mask, isolated installers.

import { describe, expect, it } from 'vitest';
import { SENSOR_IDS } from '@detect-expert/contracts';
import { SENSOR_FAMILIES, SensorRuntime, installSensors } from '../src/index';
import { makeEnv } from './helpers';

/** Minimal canvas realm: own data properties like `window`, fresh classes per call. */
function canvasRealm(): { realm: Record<string, unknown>; protos: object[] } {
  class FakeCanvas {
    get width(): number { return 300; }
    set width(_v: number) { /* native-like */ }
    get height(): number { return 150; }
    set height(_v: number) { /* native-like */ }
    toDataURL(): string { return 'data:'; }
    toBlob(_cb: unknown): void { /* native-like */ }
  }
  class FakeContext2D {
    getImageData(): object { return {}; }
    measureText(): object { return {}; }
    fillText(): void { /* native-like */ }
    strokeText(): void { /* native-like */ }
    clearRect(): void { /* native-like */ }
  }
  return { realm: { HTMLCanvasElement: FakeCanvas, CanvasRenderingContext2D: FakeContext2D }, protos: [FakeCanvas.prototype, FakeContext2D.prototype] };
}

function snapshotDescriptors(protos: object[]): Array<Record<PropertyKey, PropertyDescriptor>> {
  return protos.map((p) => Object.getOwnPropertyDescriptors(p));
}

describe('sensor family registry', () => {
  it('ids are stable and unique; canvas is the first family (S11 maps them to SENSOR_IDS)', () => {
    expect(SENSOR_FAMILIES.map((f) => f.id)).toEqual(['canvas', 'webgl', 'audio', 'permissions', 'environment', 'geometry']);
    // ADR-019: the registry is exactly the contract SENSOR_IDS, index by index (the index is the off-mask bit).
    expect(SENSOR_FAMILIES.map((f) => f.id)).toEqual([...SENSOR_IDS]);
    expect(Object.isFrozen(SENSOR_FAMILIES)).toBe(true);
    for (const f of SENSOR_FAMILIES) expect(Object.isFrozen(f)).toBe(true);
  });

  it('ADR-019: off === null (no valid policy record) installs nothing and reports hook-failed', () => {
    const runtime = new SensorRuntime(makeEnv().env);
    const { realm, protos } = canvasRealm();
    const before = snapshotDescriptors(protos);
    expect(installSensors(runtime, realm, null)).toEqual([]);
    expect(snapshotDescriptors(protos)).toEqual(before);
    expect(runtime.snapshot().flags).toContain('hook-failed');
    expect(runtime.stop('local').cleanup).toBe('none');
  });

  it('ADR-019: every off bit skips exactly its family; a full mask installs nothing without hook-failed', () => {
    for (let i = 0; i < SENSOR_IDS.length; i++) {
      const runtime = new SensorRuntime(makeEnv().env);
      const { realm } = canvasRealm();
      expect(installSensors(runtime, realm, 1 << i)).toEqual(SENSOR_IDS.filter((_, j) => j !== i));
    }
    const runtime = new SensorRuntime(makeEnv().env);
    const { realm, protos } = canvasRealm();
    const before = snapshotDescriptors(protos);
    expect(installSensors(runtime, realm, 2 ** SENSOR_IDS.length - 1)).toEqual([]);
    expect(snapshotDescriptors(protos)).toEqual(before);
    expect(runtime.snapshot().flags).toEqual([]);
  });

  it('installs every family by default and returns the installed ids', () => {
    const runtime = new SensorRuntime(makeEnv().env);
    const { realm, protos } = canvasRealm();
    const before = snapshotDescriptors(protos);
    // The canvas-only realm has no WebGL, Web Audio, Permissions, Navigator/Screen or Element interfaces: those
    // families install nothing and that is not a failure (S04, S05, S06).
    expect(installSensors(runtime, realm)).toEqual(['canvas', 'webgl', 'audio', 'permissions', 'environment', 'geometry']);
    const after = snapshotDescriptors(protos);
    expect(after[0]!['toDataURL']!.value).not.toBe(before[0]!['toDataURL']!.value);
    expect(after[1]!['getImageData']!.value).not.toBe(before[1]!['getImageData']!.value);
    expect(runtime.stop('local').cleanup).toBe('complete');
    expect(snapshotDescriptors(protos)).toEqual(before);
  });

  it('a set off bit leaves the family descriptors untouched', () => {
    const runtime = new SensorRuntime(makeEnv().env);
    const { realm, protos } = canvasRealm();
    const before = snapshotDescriptors(protos);
    expect(installSensors(runtime, realm, 1 << 0)).toEqual(['webgl', 'audio', 'permissions', 'environment', 'geometry']);
    expect(snapshotDescriptors(protos)).toEqual(before);
    expect(runtime.snapshot().flags).toEqual([]);
    expect(runtime.stop('local').cleanup).toBe('none');
  });

  it('a throwing installer is isolated: hook-failed, no escape, nothing stranded outside cleanup', () => {
    const runtime = new SensorRuntime(makeEnv().env);
    let lookups = 0;
    const hostileRealm = new Proxy({}, {
      getOwnPropertyDescriptor: () => {
        lookups++;
        throw new Error('realm lookup failed');
      },
    });
    let result: string[] | undefined;
    expect(() => { result = installSensors(runtime, hostileRealm); }).not.toThrow();
    expect(result).toEqual([]);
    expect(lookups).toBeGreaterThan(0);
    expect(runtime.snapshot().flags).toContain('hook-failed');
  });

  it('hooks installed before an installer failure stay registered for ownership-checked cleanup', () => {
    const runtime = new SensorRuntime(makeEnv().env);
    const { realm, protos } = canvasRealm();
    const before = snapshotDescriptors(protos);
    let calls = 0;
    // HTMLCanvasElement and CanvasRenderingContext2D resolve; the OffscreenCanvas lookup throws midway.
    const flaky = new Proxy(realm, {
      getOwnPropertyDescriptor: (target, key) => {
        if (key === 'OffscreenCanvas' && ++calls === 1) throw new Error('late lookup failure');
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    expect(installSensors(runtime, flaky)).toEqual(['webgl', 'audio', 'permissions', 'environment', 'geometry']);
    expect(runtime.snapshot().flags).toContain('hook-failed');
    expect(snapshotDescriptors(protos)).not.toEqual(before);
    expect(runtime.stop('local').cleanup).toBe('complete');
    expect(snapshotDescriptors(protos)).toEqual(before);
  });
});
