// ADR-019 (S11): sensor family registry on the contract side.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COVERAGE_FLAGS,
  MAX_POLICY_SENSOR_ENTRIES,
  MAX_POLICY_SENSOR_ID_CHARS,
  ORGANIZATION_POLICY_STATES,
  SENSOR_DISABLE_SOURCES,
  SENSOR_IDS,
  SENSOR_TECHNIQUES,
  TECHNIQUE_IDS,
  sensorBit,
  sensorOfTechnique,
  sensorOffMask,
  type SensorId,
} from '../src/index';
import { repoRoot } from './helpers';

describe('SENSOR_IDS and SENSOR_TECHNIQUES', () => {
  it('ids are exactly the MAIN registry families, in registry order', () => {
    expect([...SENSOR_IDS]).toEqual(['canvas', 'webgl', 'audio', 'permissions', 'environment', 'geometry']);
    // The registry source names the same ids (packages/sensors/src/registry.ts: Record<SensorId, Installer>).
    const registry = readFileSync(join(repoRoot, 'packages', 'sensors', 'src', 'registry.ts'), 'utf8');
    for (const id of SENSOR_IDS) expect(registry).toMatch(new RegExp('\\n  ' + id + ': '));
    expect(SENSOR_IDS.length).toBeLessThanOrEqual(30);
    for (const id of SENSOR_IDS) {
      expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(id.length).toBeLessThanOrEqual(MAX_POLICY_SENSOR_ID_CHARS);
    }
  });

  it('techniques per family follow the brief and never overlap', () => {
    expect(SENSOR_TECHNIQUES).toEqual({
      canvas: ['DET-001', 'DET-002', 'DET-003', 'DET-004'],
      webgl: ['DET-011', 'DET-012'],
      audio: ['DET-015', 'DET-016'],
      permissions: ['DET-039'],
      environment: ['DET-025', 'DET-026', 'DET-029', 'DET-032', 'DET-033'],
      geometry: ['DET-005'],
    });
    expect(Object.keys(SENSOR_TECHNIQUES)).toEqual([...SENSOR_IDS]);
    const all = SENSOR_IDS.flatMap((id) => [...SENSOR_TECHNIQUES[id]]);
    expect(new Set(all).size).toBe(all.length);
    for (const t of all) expect(TECHNIQUE_IDS).toContain(t);
    expect(Object.isFrozen(SENSOR_TECHNIQUES)).toBe(true);
    expect(Object.isFrozen(SENSOR_TECHNIQUES.canvas)).toBe(true);
  });

  it('sensorOfTechnique maps every family technique and nothing else', () => {
    for (const id of SENSOR_IDS) for (const t of SENSOR_TECHNIQUES[id]) expect(sensorOfTechnique(t)).toBe(id);
    // Network (browser-observed), Math and unimplemented techniques have no page-hook family.
    for (const t of ['DET-022', 'DET-058', 'DET-059', 'DET-060', 'DET-061', 'DET-069'] as const) expect(sensorOfTechnique(t)).toBeNull();
  });

  it('off-mask bits follow the registry index', () => {
    expect(SENSOR_IDS.map(sensorBit)).toEqual([1, 2, 4, 8, 16, 32]);
    expect(sensorOffMask([])).toBe(0);
    expect(sensorOffMask(['canvas', 'geometry'])).toBe(1 | 32);
    expect(sensorOffMask(['webgl', 'webgl'])).toBe(2);
    expect(sensorOffMask(['nope' as SensorId])).toBe(0);
    expect(sensorOffMask([...SENSOR_IDS])).toBe(2 ** SENSOR_IDS.length - 1);
  });

  it('enums and policy bounds', () => {
    expect([...SENSOR_DISABLE_SOURCES]).toEqual(['user', 'organization']);
    expect([...ORGANIZATION_POLICY_STATES]).toEqual(['absent', 'applied', 'last-known-good']);
    expect(MAX_POLICY_SENSOR_ENTRIES).toBe(32);
    expect(MAX_POLICY_SENSOR_ID_CHARS).toBe(64);
    // sensor-disabled is appended at the end: older coverageRef bits stay where they were.
    expect(COVERAGE_FLAGS[COVERAGE_FLAGS.length - 1]).toBe('sensor-disabled');
    expect(COVERAGE_FLAGS.indexOf('frames-inaccessible')).toBe(16);
  });
});
