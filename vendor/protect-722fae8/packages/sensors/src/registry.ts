// Sensor family registry (ADR-017, S02; disable registry of ADR-019/S11). The MAIN bootstrap installs families
// through installSensors() instead of naming each installer. Family ids are the contract SENSOR_IDS (same order;
// the index is the off-mask bit and the sensor-off.<id>.js prelude file), so an id is never renamed or reused.
// S04 appended 'webgl', S05 'audio' and 'permissions', S06 'environment' and 'geometry' (the hottest families last).
// A new family = SENSOR_IDS entry at the end + SENSOR_TECHNIQUES + an installer here (the Record type below makes
// a missing installer a compile error) + sensor_name_/sensor_desc_ locale keys + a row of docs/admin/managed-policy.md.

import { SENSOR_IDS } from '@detect-expert/contracts';
import type { SensorId } from '@detect-expert/contracts';
import { installAudioSensor } from './audio';
import { installCanvasSensor } from './canvas';
import { installEnvironmentSensor } from './environment';
import { installGeometrySensor } from './geometry';
import { arrayPush } from './intrinsics';
import { installPermissionsSensor } from './permissions';
import type { SensorRuntime } from './runtime';
import { installWebglSensor } from './webgl';

export interface SensorFamily {
  /** Stable family id = contract SENSOR_IDS[index] (ADR-019). */
  readonly id: SensorId;
  /** Installs the family's hooks on `realm` and registers them with runtime.attach(). */
  install(runtime: SensorRuntime, realm: object): unknown;
}

type Installer = (runtime: SensorRuntime, realm: object) => unknown;

/** Exhaustive by type: a SENSOR_IDS member without an installer does not compile. */
const INSTALLERS: { readonly [K in SensorId]: Installer } = {
  canvas: installCanvasSensor,
  // E07-03 (S04): DET-011/012; getParameter per FAMILY_CONFIG (families.ts).
  webgl: (runtime, realm) => installWebglSensor(runtime, realm),
  // E08-01 (S05): DET-015/016; offline-render and connect linkage only with early capture.
  audio: installAudioSensor,
  // E08-03 (S05): DET-039; the permission category only through the captured PermissionStatus.name getter.
  permissions: installPermissionsSensor,
  // E08-02 (S06): DET-025/026/029/032/033; navigator and screen groups per FAMILY_CONFIG (families.ts).
  environment: (runtime, realm) => installEnvironmentSensor(runtime, realm),
  // E07-02 (S06): DET-005; offset getters and rect methods per FAMILY_CONFIG. Hottest family: last.
  geometry: (runtime, realm) => installGeometrySensor(runtime, realm),
};

/** Families in SENSOR_IDS order (indexed loop at load: no iterator protocol, F045). */
export const SENSOR_FAMILIES: readonly SensorFamily[] = (() => {
  const families: SensorFamily[] = [];
  for (let i = 0; i < SENSOR_IDS.length; i++) {
    const id = SENSOR_IDS[i]!;
    arrayPush(families, Object.freeze<SensorFamily>({ id, install: INSTALLERS[id] }));
  }
  return Object.freeze(families);
})();

if (SENSOR_FAMILIES.length > 30) throw new Error('registry: the off mask holds at most 30 families');

/**
 * Installs every family whose bit `1 << i` (i = registry index) is clear in `off`, in registry order. `off === null`
 * means the policy prelude was missing or invalid (ADR-019): nothing is installed and the runtime reports
 * `hook-failed` (fail closed: a disabled family must never be installed by accident). A throwing installer is
 * isolated: the runtime gets `hook-failed` and the remaining families still install. Returns the ids of the families
 * whose installer completed. Indexed loop only (no iterator protocol, F045).
 */
export function installSensors(runtime: SensorRuntime, realm: object, off: number | null = 0): string[] {
  const installed: string[] = [];
  if (off === null) {
    runtime.addFlag('hook-failed');
    return installed;
  }
  for (let i = 0; i < SENSOR_FAMILIES.length; i++) {
    const family = SENSOR_FAMILIES[i]!;
    if ((off & (1 << i)) !== 0) continue;
    try {
      family.install(runtime, realm);
      arrayPush(installed, family.id);
    } catch {
      runtime.addFlag('hook-failed');
    }
  }
  return installed;
}
