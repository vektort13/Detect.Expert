// Sensor family settings (ADR-019, S11): the user's choice (options page, storage.local 'sensors') and the
// organization's managed DisabledSensorIds policy (storage.managed, apps/extension/managed_schema.json) with a
// last-known-good copy (storage.local 'policy-lkg'). The effective "off" set is their union: the user cannot enable
// a family the organization disabled. The SW alone states "sensor disabled" (REQ-004): it registers the matching
// MAIN prelude files (scope.ts mainFiles) and drops page observations of disabled families (documents.ts).
// Nothing here reads page data. Managed values are bounded and never echoed (only counted when rejected).

import {
  MAX_COUNT,
  MAX_POLICY_SENSOR_ENTRIES,
  MAX_POLICY_SENSOR_ID_CHARS,
  SENSOR_DISABLE_SOURCES,
  SENSOR_IDS,
} from '@detect-expert/contracts';
import type { OrganizationPolicyState, SensorDisableSource, SensorId, SensorSettings } from '@detect-expert/contracts';
import type { BackgroundChromeApi } from './chrome-api';

/** storage.local key of the user's choice: { v: 1, disabled: SensorId[] }. */
export const SENSOR_PREFS_KEY = 'sensors';
/** storage.local key of the last valid organization value: { v: 1, disabledSensorIds: SensorId[] }. */
export const POLICY_LKG_KEY = 'policy-lkg';
/** The sensor managed policy name (manifest storage.managed_schema). */
export const MANAGED_POLICY_NAME = 'DisabledSensorIds';
/**
 * Approved managed policies read elsewhere (managed_schema.json, permissions.allowlist managed_policies): not this
 * parser's value and not a rejected entry. ProtectModuleDisabled belongs to the module «Защита» (ADR-020).
 */
export const OTHER_MANAGED_POLICY_NAMES: readonly string[] = Object.freeze(['ProtectModuleDisabled']);
const OTHER_MANAGED_POLICY_SET: ReadonlySet<string> = new Set(OTHER_MANAGED_POLICY_NAMES);

const SENSOR_ID_SET: ReadonlySet<string> = new Set<string>(SENSOR_IDS);

export function isSensorId(value: unknown): value is SensorId {
  return typeof value === 'string' && value.length <= MAX_POLICY_SENSOR_ID_CHARS && SENSOR_ID_SET.has(value);
}

/** Unique known ids in registry order (anything else is dropped). */
export function inRegistryOrder(ids: Iterable<unknown>): SensorId[] {
  const seen = new Set<string>();
  for (const id of ids) if (isSensorId(id)) seen.add(id);
  return SENSOR_IDS.filter((id) => seen.has(id));
}

/** Bounded reader of a stored id list (at most SENSOR_IDS.length known ids). */
export function readSensorIdList(value: unknown): SensorId[] {
  if (!Array.isArray(value) || value.length > MAX_POLICY_SENSOR_ENTRIES) return [];
  return inRegistryOrder(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function satInc(n: number): number {
  return n >= MAX_COUNT ? MAX_COUNT : n + 1;
}

export type ManagedPolicyStatus = 'valid' | 'absent' | 'invalid';

export interface ManagedPolicyResult {
  status: ManagedPolicyStatus;
  /** Valid registry ids (registry order); empty unless status is 'valid'. */
  disabled: SensorId[];
  /** Entries that were not applied: foreign keys, wrong types, unknown or too long ids (saturating). */
  rejected: number;
}

/**
 * Parses the managed storage items (chrome.storage.managed.get(null)):
 * - not an object -> invalid;
 * - a key other than DisabledSensorIds and OTHER_MANAGED_POLICY_NAMES -> rejected + 1 (ignored); the approved
 *   policies of other parts are skipped (their values are checked by their own readers);
 * - no DisabledSensorIds -> absent;
 * - DisabledSensorIds not an array, or more than MAX_POLICY_SENSOR_ENTRIES entries -> invalid (whole value);
 * - each entry: a registry id string of 1..MAX_POLICY_SENSOR_ID_CHARS chars, otherwise rejected + 1.
 * Duplicates collapse. Never throws on plain data; values are never echoed.
 */
export function parseManagedPolicy(items: unknown): ManagedPolicyResult {
  if (!isRecord(items)) return { status: 'invalid', disabled: [], rejected: 0 };
  let rejected = 0;
  let present = false;
  for (const key of Object.keys(items)) {
    if (key === MANAGED_POLICY_NAME) present = true;
    else if (!OTHER_MANAGED_POLICY_SET.has(key)) rejected = satInc(rejected);
  }
  if (!present) return { status: 'absent', disabled: [], rejected };
  const value = items[MANAGED_POLICY_NAME];
  if (!Array.isArray(value) || value.length > MAX_POLICY_SENSOR_ENTRIES) return { status: 'invalid', disabled: [], rejected };
  const accepted: SensorId[] = [];
  for (const entry of value) {
    if (typeof entry === 'string' && entry.length >= 1 && entry.length <= MAX_POLICY_SENSOR_ID_CHARS && SENSOR_ID_SET.has(entry)) accepted.push(entry as SensorId);
    else rejected = satInc(rejected);
  }
  return { status: 'valid', disabled: inRegistryOrder(accepted), rejected };
}

/** Effective off lists before and after one settings change (registry order). */
export interface SensorChange {
  before: readonly SensorId[];
  after: readonly SensorId[];
}

/**
 * Runs between the in-memory change and its persistence (ADR-019): the runtime applies the reducer event, then
 * reconciles the content-script registration; the controller persists afterwards.
 */
export type SensorChangeHook = (change: SensorChange) => Promise<void> | void;

export interface SensorPolicyOptions {
  /** Test profile only: setManagedOverrideForTest() may replace the managed area (DevTools harness). */
  testOverride?: boolean;
}

function sameIds(a: readonly SensorId[], b: readonly SensorId[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

export class SensorPolicyController {
  private user: SensorId[] = [];
  private org: SensorId[] = [];
  private lkg: SensorId[] = [];
  /** storage.local holds a last-known-good record (valid or not); removed when the policy becomes absent. */
  private lkgStored = false;
  private orgState: OrganizationPolicyState = 'absent';
  private rejected = 0;
  private chain: Promise<unknown> = Promise.resolve();
  /** Test override of the managed items; null = read storage.managed. */
  private override: { items: unknown } | null = null;

  constructor(
    private readonly api: BackgroundChromeApi,
    private readonly options: SensorPolicyOptions = {},
  ) {}

  /** Mutations (load, user change, managed change) run one at a time, in arrival order. */
  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const next = this.chain.then(task, task);
    this.chain = next.catch(() => undefined);
    return next;
  }

  /** Startup: user prefs and the last-known-good copy from storage.local, then the managed policy. */
  load(): Promise<void> {
    return this.serialize(async () => {
      let stored: Record<string, unknown> = {};
      try {
        stored = await this.api.storage.local.get([SENSOR_PREFS_KEY, POLICY_LKG_KEY]);
      } catch {
        stored = {};
      }
      const prefs = stored[SENSOR_PREFS_KEY];
      this.user = isRecord(prefs) && prefs['v'] === 1 ? readSensorIdList(prefs['disabled']) : [];
      const lkg = stored[POLICY_LKG_KEY];
      this.lkgStored = lkg !== undefined;
      this.lkg = isRecord(lkg) && lkg['v'] === 1 ? readSensorIdList(lkg['disabledSensorIds']) : [];
      const persist = await this.readManaged();
      await persist();
    });
  }

  /** Re-reads the managed policy (storage.managed.onChanged). */
  refreshManaged(hook: SensorChangeHook): Promise<void> {
    return this.serialize(async () => {
      const before = this.effectiveOff();
      const persist = await this.readManaged();
      try {
        await hook({ before, after: this.effectiveOff() });
      } finally {
        await persist();
      }
    });
  }

  /** The user's choice for one family. An organization-disabled family stays off (effective state). */
  setUser(sensorId: SensorId, enabled: boolean, hook: SensorChangeHook): Promise<void> {
    return this.serialize(async () => {
      if (!isSensorId(sensorId)) return;
      const before = this.effectiveOff();
      const next = new Set(this.user);
      if (enabled) next.delete(sensorId);
      else next.add(sensorId);
      this.user = inRegistryOrder(next);
      try {
        await hook({ before, after: this.effectiveOff() });
      } finally {
        try {
          await this.api.storage.local.set({ [SENSOR_PREFS_KEY]: { v: 1, disabled: [...this.user] } });
        } catch {
          // Preferences are a convenience; the in-memory choice still applies for this SW lifetime.
        }
      }
    });
  }

  /**
   * Test profile only (DevTools harness, never a message API): replaces the managed items; undefined restores
   * the real storage.managed. Throws without the testOverride option.
   */
  setManagedOverrideForTest(items: unknown): void {
    if (this.options.testOverride !== true) throw new Error('sensor-policy-override-disabled');
    this.override = items === undefined ? null : { items };
  }

  /** Reads and applies the managed value; returns the persistence step of its last-known-good copy. */
  private async readManaged(): Promise<() => Promise<void>> {
    let result: ManagedPolicyResult;
    if (this.override !== null) result = parseManagedPolicy(this.override.items);
    else if (this.api.storage.managed === undefined) result = { status: 'absent', disabled: [], rejected: 0 };
    else {
      try {
        result = parseManagedPolicy(await this.api.storage.managed.get(null));
      } catch {
        result = { status: 'invalid', disabled: [], rejected: 0 };
      }
    }
    this.rejected = result.rejected;
    switch (result.status) {
      case 'valid': {
        this.org = result.disabled;
        this.orgState = 'applied';
        const changed = !this.lkgStored || !sameIds(this.lkg, result.disabled);
        this.lkg = [...result.disabled];
        this.lkgStored = true;
        const value = { v: 1, disabledSensorIds: [...result.disabled] };
        return async () => {
          if (!changed) return;
          try { await this.api.storage.local.set({ [POLICY_LKG_KEY]: value }); } catch { /* in memory only */ }
        };
      }
      case 'absent': {
        // ADR-019: the organization withdrew the policy: its last-known-good copy goes too.
        this.org = [];
        this.orgState = 'absent';
        this.lkg = [];
        const stored = this.lkgStored;
        this.lkgStored = false;
        return async () => {
          if (!stored) return;
          try { await this.api.storage.local.remove(POLICY_LKG_KEY); } catch { /* in memory only */ }
        };
      }
      case 'invalid':
        // ADR-019: an invalid or unreadable value never widens observation: the last valid value stays in effect.
        this.org = [...this.lkg];
        this.orgState = 'last-known-good';
        return async () => undefined;
    }
  }

  /** Families disabled by the user (registry order). */
  userDisabled(): SensorId[] {
    return [...this.user];
  }

  /** Families disabled by the organization (registry order). */
  organizationDisabled(): SensorId[] {
    return [...this.org];
  }

  /** Effective off set = user ∪ organization, registry order. */
  effectiveOff(): SensorId[] {
    return inRegistryOrder([...this.user, ...this.org]);
  }

  /** Current reasons for `id` in SENSOR_DISABLE_SOURCES order; empty when the family is enabled. */
  sourcesOf(id: SensorId): SensorDisableSource[] {
    const out: SensorDisableSource[] = [];
    for (const source of SENSOR_DISABLE_SOURCES) {
      if (source === 'user' && this.user.includes(id)) out.push(source);
      if (source === 'organization' && this.org.includes(id)) out.push(source);
    }
    return out;
  }

  get organizationPolicy(): OrganizationPolicyState {
    return this.orgState;
  }

  get rejectedPolicyEntries(): number {
    return this.rejected;
  }

  settings(): SensorSettings {
    return {
      sensors: SENSOR_IDS.map((sensorId) => {
        const disabledBy = this.sourcesOf(sensorId);
        return { sensorId, enabled: disabledBy.length === 0, disabledBy };
      }),
      organizationPolicy: this.orgState,
      rejectedPolicyEntries: this.rejected,
    };
  }
}
