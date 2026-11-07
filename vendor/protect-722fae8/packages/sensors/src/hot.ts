// Hot hooks with retirement (ADR-017 §5, ADR-006 refinement E06-03; REQ-002/011/014). For members a page may read
// thousands of times (offsetWidth, navigator.*, getParameter), the observer must stay allocation-free and the total
// cost bounded:
//   - every key is computed once at install time: no clock, no strings, no allocation per call;
//   - after `limit` observed calls the hook retires through runtime.retire(): the original descriptor is restored
//     only if we still own it, both aggregates of the hook (returned-sync and threw-sync) become lower-bound (I1) and
//     a count-0 marker carries
//     sample-budget-exceeded; there is no reinstall and no document-level coverage flag;
//   - references to the wrapper a page saved before retirement still call the original exactly once (wrap.ts
//     contract); the observer is off for them, so they create no records.
// `limit: null` keeps the hook permanently (perf-gate decision "go"); the wrapper contract is wrap.ts's in all cases.

import type { OperationCode, TechniqueId } from '@detect-expert/contracts';
import { API_USE, compositeKey, operationIndex, PHASE_INDEX, signalBit, TECHNIQUE_INDEX } from './codes';
import type { SensorRuntime } from './runtime';
import { wrapGetter, wrapMethod } from './wrap';
import type { GetterObserver, HookContext, HookHandle, MethodObserver, WrapResult } from './wrap';

const P_RETURNED = PHASE_INDEX['returned-sync'];
const P_THREW = PHASE_INDEX['threw-sync'];

export interface HotSpec {
  technique: TechniqueId;
  /** Operation of this member (ADR-017); must be declared in PAGE_OPERATIONS for the technique. */
  op?: OperationCode;
  /**
   * Observed calls before retirement; null = never retire. A finite limit requires the technique to declare
   * `sample-budget-exceeded` in TECHNIQUE_SIGNALS (install throws otherwise: a contract error, not a page condition).
   */
  limit: number | null;
  /** Pause switch and error counter; defaults to the runtime's hook context. */
  context?: HookContext;
}

/** Keys and the retirement state shared by the getter and method variants. */
interface HotState {
  readonly okKey: number;
  readonly threwKey: number;
  readonly markerKey: number;
  /** I1: every key this hook records; all turn lower-bound on retirement (allocated once, at install). */
  readonly retireKeys: readonly number[];
  readonly limit: number;
  calls: number;
  retired: boolean;
  handle: HookHandle | null;
}

function hotState(spec: HotSpec): HotState {
  const t = TECHNIQUE_INDEX[spec.technique];
  if (t === undefined) throw new Error('hot: unknown technique');
  const op = spec.op === undefined ? 0 : operationIndex(spec.technique, spec.op);
  const limit = spec.limit;
  // I1: a pure integer check (no call into the live Math object, which the page may have replaced before a late start).
  if (limit !== null && !(typeof limit === 'number' && limit >= 1 && limit % 1 === 0)) throw new Error('hot: limit must be a positive integer or null');
  const okKey = compositeKey(t, P_RETURNED, API_USE, op);
  const threwKey = compositeKey(t, P_THREW, API_USE, op);
  return {
    okKey,
    threwKey,
    retireKeys: [okKey, threwKey],
    // Computed only for a retiring hook, so a technique without sample-budget-exceeded may still use limit null.
    markerKey: limit === null ? -1 : compositeKey(t, P_RETURNED, API_USE | signalBit(spec.technique, 'sample-budget-exceeded'), op),
    limit: limit === null ? 0 : limit,
    calls: 0,
    retired: false,
    handle: null,
  };
}

/** Observer body: record the call; at the limit, retire once. Integer work only. */
function observeHot(runtime: SensorRuntime, state: HotState, threw: boolean): void {
  if (state.retired) return;
  runtime.recordKey(threw ? state.threwKey : state.okKey);
  if (state.limit === 0) return;
  state.calls++;
  if (state.calls < state.limit) return;
  state.retired = true;
  if (state.handle !== null) runtime.retire(state.handle, state.retireKeys, state.markerKey);
}

function bind(state: HotState, result: WrapResult): WrapResult {
  if (result.status === 'installed') state.handle = result;
  return result;
}

/**
 * Wraps the accessor getter `target[key]` as a hot hook: phase returned-sync / threw-sync, local mask api-use and the
 * spec's operation. The caller registers the result with runtime.attach() like any other hook result.
 */
export function wrapHotGetter(runtime: SensorRuntime, target: object, key: PropertyKey, spec: HotSpec): WrapResult {
  const state = hotState(spec);
  const observe: GetterObserver = (_thisArg, threw) => {
    observeHot(runtime, state, threw);
  };
  return bind(state, wrapGetter(target, key, observe, { context: spec.context ?? runtime.hooks }));
}

/** Method variant of wrapHotGetter; arguments are never read (classification needs a regular wrapMethod observer). */
export function wrapHotMethod(runtime: SensorRuntime, target: object, key: PropertyKey, spec: HotSpec): WrapResult {
  const state = hotState(spec);
  const observe: MethodObserver = (_thisArg, _args, threw) => {
    observeHot(runtime, state, threw);
  };
  return bind(state, wrapMethod(target, key, observe, { context: spec.context ?? runtime.hooks }));
}
