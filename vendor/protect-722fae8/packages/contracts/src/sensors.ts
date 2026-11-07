// Sensor family registry on the contract side (ADR-019, S11): which techniques each family of
// packages/sensors/src/registry.ts observes, and the bounds of the managed DisabledSensorIds policy.
// The SW uses it to drop page observations of a disabled family and to describe the gap in coverage.

import { SENSOR_IDS } from './enums';
import type { SensorId, TechniqueId } from './enums';

/** Page-hook techniques of each sensor family (registry order). A technique belongs to at most one family. */
export const SENSOR_TECHNIQUES: Readonly<Record<SensorId, readonly TechniqueId[]>> = Object.freeze({
  canvas: Object.freeze(['DET-001', 'DET-002', 'DET-003', 'DET-004'] as const),
  webgl: Object.freeze(['DET-011', 'DET-012'] as const),
  audio: Object.freeze(['DET-015', 'DET-016'] as const),
  permissions: Object.freeze(['DET-039'] as const),
  environment: Object.freeze(['DET-025', 'DET-026', 'DET-029', 'DET-032', 'DET-033'] as const),
  geometry: Object.freeze(['DET-005'] as const),
});

/** Managed policy bound: more entries make the whole value invalid (last-known-good stays in effect). */
export const MAX_POLICY_SENSOR_ENTRIES = 32;
/** Managed policy bound: a longer entry is rejected (counted, never echoed). */
export const MAX_POLICY_SENSOR_ID_CHARS = 64;

// The off mask is a small integer (one bit per family); 30 bits keep it a Smi with room for checks.
if (SENSOR_IDS.length > 30) throw new Error('sensors: at most 30 families fit the off mask');

const TECHNIQUE_SENSOR: ReadonlyMap<TechniqueId, SensorId> = (() => {
  const map = new Map<TechniqueId, SensorId>();
  for (const id of SENSOR_IDS) {
    for (const techniqueId of SENSOR_TECHNIQUES[id]) {
      if (map.has(techniqueId)) throw new Error('sensors: technique ' + techniqueId + ' belongs to two families');
      map.set(techniqueId, id);
    }
  }
  return Object.freeze(map);
})();

/** The family that observes `techniqueId` through page hooks, or null (network, unobserved or future techniques). */
export function sensorOfTechnique(techniqueId: TechniqueId): SensorId | null {
  return TECHNIQUE_SENSOR.get(techniqueId) ?? null;
}

/** Bit of `id` in the off mask (registry index), or -1 for an unknown id. */
export function sensorBit(id: SensorId): number {
  const i = SENSOR_IDS.indexOf(id);
  return i < 0 ? -1 : 1 << i;
}

/** Off mask of a list of family ids (unknown ids are ignored). */
export function sensorOffMask(ids: readonly SensorId[]): number {
  let mask = 0;
  for (const id of ids) {
    const bit = sensorBit(id);
    if (bit > 0) mask |= bit;
  }
  return mask;
}
