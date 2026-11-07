// Sensor family settings view model (ADR-019, S11; spec V §7 states «датчик отключён» and «настройки организации»).
// Pure: reads ScopeState.sensorSettings defensively (an older SW or a test stub may omit it) and returns message keys.

import { ORGANIZATION_POLICY_STATES, SENSOR_DISABLE_SOURCES, SENSOR_IDS } from '@detect-expert/contracts';
import type { OrganizationPolicyState, ScopeState, SensorDisableSource, SensorId } from '@detect-expert/contracts';
import { msg } from './message';
import type { Message } from './message';

export interface SensorRow {
  sensorId: SensorId;
  nameKey: string;
  descKey: string;
  enabled: boolean;
  disabledBy: SensorDisableSource[];
  /** Disabled by the organization: the user cannot change it here. */
  locked: boolean;
  stateKey: 'options_sensor_state_on' | 'options_sensor_state_off_user' | 'options_sensor_state_off_org';
}

export function sensorNameKey(id: SensorId): string {
  return 'sensor_name_' + id;
}

export function sensorDescKey(id: SensorId): string {
  return 'sensor_desc_' + id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sources(value: unknown): SensorDisableSource[] {
  if (!Array.isArray(value)) return [];
  return SENSOR_DISABLE_SOURCES.filter((source) => value.includes(source));
}

/** Reason message key for a non-empty reason list (user, organization, or both). */
export function sensorReasonKey(disabledBy: readonly SensorDisableSource[]): string {
  const user = disabledBy.includes('user');
  const org = disabledBy.includes('organization');
  if (user && org) return 'sensor_disabled_reason_both';
  return org ? 'sensor_disabled_reason_organization' : 'sensor_disabled_reason_user';
}

/** One row per registry family, in registry order; unknown or malformed entries are ignored. */
export function sensorRows(scope: ScopeState | null | undefined): SensorRow[] {
  const settings: unknown = scope?.sensorSettings;
  const list = isRecord(settings) && Array.isArray(settings['sensors']) ? settings['sensors'] : [];
  const byId = new Map<SensorId, Record<string, unknown>>();
  for (const entry of list) {
    if (isRecord(entry) && typeof entry['sensorId'] === 'string' && (SENSOR_IDS as readonly string[]).includes(entry['sensorId'])) {
      byId.set(entry['sensorId'] as SensorId, entry);
    }
  }
  const rows: SensorRow[] = [];
  for (const sensorId of SENSOR_IDS) {
    const entry = byId.get(sensorId);
    if (entry === undefined) continue;
    const disabledBy = sources(entry['disabledBy']);
    const enabled = entry['enabled'] === true && disabledBy.length === 0;
    const locked = disabledBy.includes('organization');
    rows.push({
      sensorId,
      nameKey: sensorNameKey(sensorId),
      descKey: sensorDescKey(sensorId),
      enabled,
      disabledBy,
      locked,
      stateKey: enabled ? 'options_sensor_state_on' : locked ? 'options_sensor_state_off_org' : 'options_sensor_state_off_user',
    });
  }
  return rows;
}

/** The organization disables at least one family («настройки организации», coverage `managed` line). */
export function organizationDisables(scope: ScopeState | null | undefined): boolean {
  return sensorRows(scope).some((row) => row.locked);
}

export function organizationPolicyOf(scope: ScopeState | null | undefined): OrganizationPolicyState {
  const settings: unknown = scope?.sensorSettings;
  const state = isRecord(settings) ? settings['organizationPolicy'] : undefined;
  return (ORGANIZATION_POLICY_STATES as readonly unknown[]).includes(state) ? (state as OrganizationPolicyState) : 'absent';
}

export function rejectedPolicyEntriesOf(scope: ScopeState | null | undefined): number {
  const settings: unknown = scope?.sensorSettings;
  const n = isRecord(settings) ? settings['rejectedPolicyEntries'] : undefined;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : 0;
}

/** Notices of the sensor section: organization policy in effect, rejected entries, last-known-good. */
export function sensorNotices(scope: ScopeState | null | undefined): Message[] {
  const out: Message[] = [];
  if (organizationDisables(scope)) out.push(msg('options_sensors_org_policy'));
  const rejected = rejectedPolicyEntriesOf(scope);
  if (rejected > 0) out.push(msg('options_sensors_policy_rejected', rejected));
  if (organizationPolicyOf(scope) === 'last-known-good') out.push(msg('options_sensors_policy_lkg'));
  return out;
}

/** Off ids for the diagnostics preview (registry order). */
export function disabledSensorIds(scope: ScopeState | null | undefined): SensorId[] {
  return sensorRows(scope).filter((row) => !row.enabled).map((row) => row.sensorId);
}
