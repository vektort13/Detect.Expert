// Environment sensor: DET-025 (navigator identity), DET-026 (User-Agent Client Hints), DET-029 (screen),
// DET-032 (hardwareConcurrency), DET-033 (deviceMemory). Task E08-02, S06; spec III §2.3; REQ-001, REQ-002, REQ-003,
// REQ-005, REQ-011; ADR-006 §3, ADR-017 §2/§5.
//
// Observed: which member the page read (operation code) and the phase. Never read or recorded: the user agent, the
// platform, the vendor, the languages, screen sizes and colour depth, the parallelism estimate, the memory category,
// the brands, the requested hint names and the hint values.
//   - Navigator.prototype getters userAgent / platform / vendor / language / languages -> DET-025 (`user-agent`,
//     `platform`, `vendor`, `language`, `languages`); hardwareConcurrency -> DET-032 and deviceMemory -> DET-033
//     (no operation); userAgentData -> DET-026 `user-agent-data`.
//   - NavigatorUAData.prototype getters brands / mobile / platform -> `ua-brands` / `ua-mobile` / `ua-platform`;
//     toJSON -> `ua-to-json`; getHighEntropyValues -> `get-high-entropy-values`, phase settlement-unobserved (the
//     Promise is returned as is, no .then/.catch). The hints array is never read: its names stay unknown
//     (limitation hint-names-not-observed).
//   - Screen.prototype getters width / height / availWidth / availHeight / colorDepth / pixelDepth / orientation ->
//     DET-029 with the matching operation.
// Navigator and NavigatorUAData members follow FAMILY_CONFIG.navigatorGetters, Screen members screenGetters
// (S03 perf-gate, docs/coverage/perf/getters-spike.md): 'wrap' = permanent hot hook, 'retire' = hot hook that retires
// after retireAfter observed calls, 'off' = not wrapped. Every key is computed at install time (hot.ts); observers
// ignore `this` and the arguments. deviceMemory, userAgentData and NavigatorUAData are [SecureContext]: an absent
// interface or member is skipped without a coverage flag; a present non-configurable member is reported by wrap.ts.
// Workers (WorkerNavigator) are not observed (coverage gap L, docs/coverage/matrix.md §10).

import type { OperationCode, TechniqueId } from '@detect-expert/contracts';
import { API_USE, compositeKey, operationIndex, PHASE_INDEX, signalBit, TECHNIQUE_INDEX } from './codes';
import { FAMILY_CONFIG, hotLimit } from './families';
import type { FamilyConfig, HotMode } from './families';
import { wrapHotGetter, wrapHotMethod } from './hot';
import type { HotSpec } from './hot';
import { arrayPush } from './intrinsics';
import { prototypeOf } from './realm';
import type { SensorRuntime } from './runtime';
import { wrapMethod } from './wrap';
import type { HookHandle, MethodObserver, WrapResult } from './wrap';

const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;

/** How a member is hooked: a hot getter, a hot method, or the Promise-returning getHighEntropyValues. */
type MemberKind = 'getter' | 'method' | 'settlement';

interface Member {
  readonly key: string;
  readonly kind: MemberKind;
  readonly technique: TechniqueId;
  readonly op: OperationCode | null;
}

function member(key: string, kind: MemberKind, technique: TechniqueId, op: OperationCode | null): Member {
  return Object.freeze({ key, kind, technique, op });
}

const NAVIGATOR = 'Navigator';
const UA_DATA = 'NavigatorUAData';
const SCREEN = 'Screen';

const NAVIGATOR_MEMBERS: readonly Member[] = Object.freeze([
  member('userAgent', 'getter', 'DET-025', 'user-agent'),
  member('platform', 'getter', 'DET-025', 'platform'),
  member('vendor', 'getter', 'DET-025', 'vendor'),
  member('language', 'getter', 'DET-025', 'language'),
  member('languages', 'getter', 'DET-025', 'languages'),
  member('hardwareConcurrency', 'getter', 'DET-032', null),
  member('deviceMemory', 'getter', 'DET-033', null),
  member('userAgentData', 'getter', 'DET-026', 'user-agent-data'),
]);

const UA_DATA_MEMBERS: readonly Member[] = Object.freeze([
  member('brands', 'getter', 'DET-026', 'ua-brands'),
  member('mobile', 'getter', 'DET-026', 'ua-mobile'),
  member('platform', 'getter', 'DET-026', 'ua-platform'),
  member('toJSON', 'method', 'DET-026', 'ua-to-json'),
  member('getHighEntropyValues', 'settlement', 'DET-026', 'get-high-entropy-values'),
]);

const SCREEN_MEMBERS: readonly Member[] = Object.freeze([
  member('width', 'getter', 'DET-029', 'width'),
  member('height', 'getter', 'DET-029', 'height'),
  member('availWidth', 'getter', 'DET-029', 'avail-width'),
  member('availHeight', 'getter', 'DET-029', 'avail-height'),
  member('colorDepth', 'getter', 'DET-029', 'color-depth'),
  member('pixelDepth', 'getter', 'DET-029', 'pixel-depth'),
  member('orientation', 'getter', 'DET-029', 'orientation'),
]);

export interface EnvironmentSensor {
  /** One entry per attempted hook (installed or unsupported), in install order. */
  results: WrapResult[];
  /** Interfaces absent from the realm, or `Interface.member` that is not an own property (not a failure). */
  skipped: string[];
  /** `Interface.member` left unwrapped because its FAMILY_CONFIG group is 'off'. */
  off: string[];
}

/**
 * Promise-returning member (getHighEntropyValues): phase settlement-unobserved, threw-sync on a synchronous throw.
 * The arguments (the hints sequence) are never touched. With a finite limit the hook retires like hot.ts.
 */
function wrapSettlementMethod(runtime: SensorRuntime, target: object, m: Member, limit: number | null): WrapResult {
  const t = TECHNIQUE_INDEX[m.technique];
  const op = m.op === null ? 0 : operationIndex(m.technique, m.op);
  const settledKey = compositeKey(t, PHASE_INDEX['settlement-unobserved'], API_USE, op);
  const threwKey = compositeKey(t, PHASE_INDEX['threw-sync'], API_USE, op);
  const markerKey =
    limit === null ? -1 : compositeKey(t, PHASE_INDEX['settlement-unobserved'], API_USE | signalBit(m.technique, 'sample-budget-exceeded'), op);
  // I1: a pure integer check (no call into the live Math object).
  if (limit !== null && !(typeof limit === 'number' && limit >= 1 && limit % 1 === 0)) throw new Error('environment: limit must be a positive integer or null');
  // I1: both aggregates of the hook turn lower-bound on retirement (allocated once, at install).
  const retireKeys: readonly number[] = [settledKey, threwKey];
  let calls = 0;
  let retired = false;
  let handle: HookHandle | null = null;
  const observe: MethodObserver = (_thisArg, _args, threw) => {
    if (retired) return;
    runtime.recordKey(threw ? threwKey : settledKey);
    if (limit === null) return;
    calls++;
    if (calls < limit) return;
    retired = true;
    if (handle !== null) runtime.retire(handle, retireKeys, markerKey);
  };
  const result = wrapMethod(target, m.key, observe, { context: runtime.hooks });
  if (result.status === 'installed') handle = result;
  return result;
}

/**
 * Installs the environment hooks on `realm` (the window) and registers them with the runtime. `config` defaults to
 * the perf-gate decisions (families.ts); tests pass another mode. Repeated calls in the same module instance return
 * the same handles (wrap.ts registry) and add no observer.
 */
export function installEnvironmentSensor(
  runtime: SensorRuntime,
  realm: object = globalThis,
  config: FamilyConfig = FAMILY_CONFIG,
): EnvironmentSensor {
  const results: WrapResult[] = [];
  const skipped: string[] = [];
  const off: string[] = [];

  const installGroup = (name: string, members: readonly Member[], mode: HotMode): void => {
    const proto = prototypeOf(realm, name);
    if (proto === null) {
      arrayPush(skipped, name);
      return;
    }
    const limit = mode === 'off' ? null : hotLimit(mode, config);
    for (let i = 0; i < members.length; i++) {
      const m = members[i]!;
      if (getOwnPropertyDescriptor(proto, m.key) === undefined) {
        arrayPush(skipped, name + '.' + m.key);
        continue;
      }
      if (mode === 'off') {
        arrayPush(off, name + '.' + m.key);
        continue;
      }
      if (m.kind === 'settlement') {
        arrayPush(results, wrapSettlementMethod(runtime, proto, m, limit));
        continue;
      }
      const spec: HotSpec = m.op === null ? { technique: m.technique, limit } : { technique: m.technique, op: m.op, limit };
      arrayPush(results, m.kind === 'getter' ? wrapHotGetter(runtime, proto, m.key, spec) : wrapHotMethod(runtime, proto, m.key, spec));
    }
  };

  try {
    installGroup(NAVIGATOR, NAVIGATOR_MEMBERS, config.navigatorGetters);
    installGroup(UA_DATA, UA_DATA_MEMBERS, config.navigatorGetters);
    installGroup(SCREEN, SCREEN_MEMBERS, config.screenGetters);
  } finally {
    // A throwing realm lookup must not strand installed hooks outside ownership-checked cleanup (ADR-006 §8).
    runtime.attach(results);
  }
  return { results, skipped, off };
}
