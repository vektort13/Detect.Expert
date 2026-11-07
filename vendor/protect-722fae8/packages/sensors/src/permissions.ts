// Permissions sensor: DET-039 (permission state checks). Task E08-03, S05; spec III §2.4 row DET-039; REQ-001,
// REQ-002, REQ-003, REQ-005; ADR-006 §3, ADR-017.
//
// Observed: that the page queried permissions (`query`) and, when it read PermissionStatus.state, the CATEGORY of the
// permission it had asked about (`state-<category>`). Never read or recorded: the query dictionary (ADR-006 §3: a
// page object; its `name` may be a getter or a Proxy trap), the state value (granted / denied / prompt) and the
// permission name itself.
//   - Permissions.prototype.query -> `query`, phase settlement-unobserved (threw-sync if the call throws
//     synchronously). The argument is not touched; the original Promise is returned as is (no .then/.catch).
//   - PermissionStatus.prototype.state (getter; the S03 browser differential passed, docs/coverage/perf/
//     getters-spike.md) -> `state-<category>`, phase returned-sync. The category comes from the captured native
//     PermissionStatus.prototype.name getter (Chromium 153 fact, S03; still a candidate elsewhere) applied to the
//     receiver: a primitive string goes through a fixed switch of literal names (no coercion, no String.prototype
//     method), any other string -> `state-other`. The switch lists the spec names and the internal names Chromium 153
//     actually returns (e.g. `video_capture` for camera, `sensors` for the motion sensors; S05 browser fact). No getter, a late install, a throwing getter or a non-string ->
//     `state-unclassified`. A throwing state read -> threw-sync, api-use, no operation.
// The name getter is captured only with earlyCaptureGuaranteed (ADR-017 §2); a late install records every state read
// as `state-unclassified` and adds the idempotent `hook-failed` flag. No family wraps PermissionStatus.name
// (install-disjoint.test.ts). Keys are computed at install.

import type { OperationCode, Phase } from '@detect-expert/contracts';
import { API_USE, compositeKey, operationIndex, PHASE_INDEX, TECHNIQUE_INDEX } from './codes';
import { arrayPush } from './intrinsics';
import { getterOf, prototypeOf } from './realm';
import type { SensorRuntime } from './runtime';
import { wrapGetter, wrapMethod } from './wrap';
import type { GetterObserver, MethodObserver, WrapResult } from './wrap';

const apply = Reflect.apply;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const EMPTY_ARGS: readonly unknown[] = Object.freeze([]);

const T_PERMISSIONS = 'DET-039';
const PERMISSIONS = 'Permissions';
const STATUS = 'PermissionStatus';

export interface PermissionsSensor {
  /** One entry per attempted hook (installed or unsupported), in install order. */
  results: WrapResult[];
  /** Interfaces absent from the realm, or `Interface.member` that is not an own property (not a failure). */
  skipped: string[];
  /** True when the native PermissionStatus.prototype.name getter was captured (state reads get a category). */
  categories: boolean;
}

/**
 * Installs the Permissions hooks on `realm` (the window) and registers them with the runtime. Repeated calls in the
 * same module instance return the same handles (wrap.ts registry) and add no observer.
 */
export function installPermissionsSensor(runtime: SensorRuntime, realm: object = globalThis): PermissionsSensor {
  const results: WrapResult[] = [];
  const skipped: string[] = [];
  const options = { context: runtime.hooks };

  // Keys (install time; an undeclared pair throws here and the registry isolates it as hook-failed).
  const t = TECHNIQUE_INDEX[T_PERMISSIONS];
  const key = (phase: Phase, op: OperationCode | null): number =>
    compositeKey(t, PHASE_INDEX[phase], API_USE, op === null ? 0 : operationIndex(T_PERMISSIONS, op));
  const K = {
    query: key('settlement-unobserved', 'query'),
    queryThrew: key('threw-sync', 'query'),
    location: key('returned-sync', 'state-location'),
    notifications: key('returned-sync', 'state-notifications'),
    media: key('returned-sync', 'state-media'),
    sensors: key('returned-sync', 'state-sensors'),
    midi: key('returned-sync', 'state-midi'),
    clipboard: key('returned-sync', 'state-clipboard'),
    storage: key('returned-sync', 'state-storage'),
    other: key('returned-sync', 'state-other'),
    unclassified: key('returned-sync', 'state-unclassified'),
    stateThrew: key('threw-sync', null),
  };

  const statusProto = prototypeOf(realm, STATUS);
  const early = runtime.earlyCaptureGuaranteed;
  const nameGetter = early ? getterOf(statusProto, 'name') : null;
  if (!early && statusProto !== null) runtime.addFlag('hook-failed');

  /** Category key of a successful state read. Only the captured native getter is called; its value is dropped. */
  const categoryKey = (thisArg: unknown): number => {
    if (nameGetter === null) return K.unclassified;
    let name: unknown;
    try {
      name = apply(nameGetter, thisArg, EMPTY_ARGS);
    } catch {
      return K.unclassified;
    }
    if (typeof name !== 'string') return K.unclassified;
    // Spec names plus the internal names Chromium 153 returns from PermissionStatus.name (measured 2026-10-17, S05:
    // camera -> video_capture, microphone -> audio_capture, accelerometer/gyroscope/magnetometer -> sensors,
    // clipboard-read -> clipboard_read, persistent-storage -> durable_storage, background-sync -> background_sync, ...).
    switch (name) {
      case 'geolocation':
        return K.location;
      case 'notifications':
      case 'push':
        return K.notifications;
      case 'camera':
      case 'microphone':
      case 'display-capture':
      case 'speaker-selection':
      case 'captured-surface-control':
      case 'video_capture':
      case 'audio_capture':
      case 'display_capture':
        return K.media;
      case 'accelerometer':
      case 'gyroscope':
      case 'magnetometer':
      case 'ambient-light-sensor':
      case 'sensors':
        return K.sensors;
      case 'midi':
        return K.midi;
      case 'clipboard-read':
      case 'clipboard-write':
      case 'clipboard_read':
      case 'clipboard_write':
        return K.clipboard;
      case 'persistent-storage':
      case 'storage-access':
      case 'top-level-storage-access':
      case 'background-sync':
      case 'periodic-background-sync':
      case 'background-fetch':
      case 'durable_storage':
      case 'background_sync':
      case 'periodic_background_sync':
      case 'background_fetch':
        return K.storage;
      default:
        return K.other;
    }
  };

  const query: MethodObserver = (_thisArg, _args, threw) => {
    runtime.recordKey(threw ? K.queryThrew : K.query);
  };
  const state: GetterObserver = (thisArg, threw) => {
    runtime.recordKey(threw ? K.stateThrew : categoryKey(thisArg));
  };

  try {
    const permissionsProto = prototypeOf(realm, PERMISSIONS);
    if (permissionsProto === null) arrayPush(skipped, PERMISSIONS);
    else if (getOwnPropertyDescriptor(permissionsProto, 'query') === undefined) arrayPush(skipped, PERMISSIONS + '.query');
    else arrayPush(results, wrapMethod(permissionsProto, 'query', query, options));

    if (statusProto === null) arrayPush(skipped, STATUS);
    else if (getOwnPropertyDescriptor(statusProto, 'state') === undefined) arrayPush(skipped, STATUS + '.state');
    else arrayPush(results, wrapGetter(statusProto, 'state', state, options));
  } finally {
    // A throwing realm lookup must not strand installed hooks outside ownership-checked cleanup (ADR-006 §8).
    runtime.attach(results);
  }
  return { results, skipped, categories: nameGetter !== null };
}
