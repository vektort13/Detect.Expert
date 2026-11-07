// ADR-020 §F (S10): registration hooks of the module «Защита» — EventTarget.prototype.addEventListener and
// MutationObserver.prototype.observe. Input for session recording (S11) and for the `password-field-listener` fact.
// addEventListener: the first operation of the observer is `typeof type === 'string' && LISTEN_SET has type`; any other
// event type costs only that check (micro gate of E21-10). The target kind comes from identity (window, document), the
// captured documentElement / body getters (root) and a brand check of HTMLInputElement through its captured native
// `type` getter (password -> field-password). THIS is the only file allowed to name HTMLInputElement
// (scripts/code-checks.mjs FIELD_ELEMENT_OWNER): only `type` is read, never `value` (the tripwire spec proves it).
// The listener and the options are never read; the listener is only a WeakMap key (listener -> sampled script).
// MutationObserver.observe: only targets document / documentElement / body; options are never read.
// Modes (PROTECT_HOOK_CONFIG.listen): 'prototype' wraps EventTarget.prototype.addEventListener; 'shadow' defines own
// wrappers on window and document only (element registrations untouched; each call looks the prototype method up at
// call time, so a later page patch of the prototype still runs exactly once); 'off' installs nothing.

import { LISTEN_EVENT_CODES } from '@detect-expert/contracts';
import type { ProtectLimitation } from '@detect-expert/contracts';
import { arrayPush } from '../intrinsics';
import { existingHandle, noteObserverError, wrapMethod } from '../wrap';
import type { HookContext, HookHandle, MethodObserver, WrapResult } from '../wrap';
import type { ListenHookMode, WrapHookMode } from './config';
import { HOOK_LISTEN, HOOK_OBSERVE, TARGET_INDEX } from './runtime';
import type { ProtectMainRuntime } from './runtime';
import type { StackSampler } from './stack';
import { REGISTRATION_TARGETS, resolveOwner } from './targets';
import { installedFunction } from './send-hooks';

const apply = Reflect.apply;
const reflectGet = Reflect.get;
const create = Object.create;
const rawDefineProperty = Object.defineProperty;
const deleteProperty = Reflect.deleteProperty;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf;
const hasOwn = Function.prototype.call.bind(Object.prototype.hasOwnProperty) as (o: object, k: PropertyKey) => boolean;
const weakMapGet = Function.prototype.call.bind(WeakMap.prototype.get) as (m: WeakMap<object, number>, k: object) => number | undefined;
const weakMapSet = Function.prototype.call.bind(WeakMap.prototype.set) as (m: WeakMap<object, number>, k: object, v: number) => unknown;
const NativeWeakMap = WeakMap;
const NO_ARGS: readonly unknown[] = Object.freeze([]);

const T_WINDOW = TARGET_INDEX.window;
const T_DOCUMENT = TARGET_INDEX.document;
const T_ROOT = TARGET_INDEX.root;
const T_FIELD = TARGET_INDEX.field;
const T_FIELD_PASSWORD = TARGET_INDEX['field-password'];
const T_OTHER = TARGET_INDEX.other;

export interface RegistrationHookDeps {
  realm: object;
  runtime: Pick<ProtectMainRuntime, 'noteRegistration' | 'internScript' | 'addLimitation'>;
  sampler: StackSampler;
  context: HookContext;
  config: { listen: ListenHookMode; observe: WrapHookMode };
}

/** Event type -> LISTEN_EVENT_CODES index; a null-prototype table (no inherited key is ever found). */
function listenIndex(): Record<string, number> {
  const table = create(null) as Record<string, number>;
  for (let i = 0; i < LISTEN_EVENT_CODES.length; i++) table[LISTEN_EVENT_CODES[i]!] = i;
  return table;
}

function ownDataValue(o: object, key: string): unknown {
  const d = getOwnPropertyDescriptor(o, key);
  return d !== undefined && hasOwn(d, 'value') ? d.value : undefined;
}

function ownGetter(o: object | null, key: string): Function | null {
  if (o === null) return null;
  const d = getOwnPropertyDescriptor(o, key);
  return d !== undefined && typeof d.get === 'function' ? d.get : null;
}

function interfaceProto(realm: object, name: string): object | null {
  const ctor = ownDataValue(realm, name);
  if (typeof ctor !== 'function') return null;
  const proto = ownDataValue(ctor, 'prototype');
  return typeof proto === 'object' && proto !== null ? proto : null;
}

/**
 * Own `addEventListener` wrapper on `target` (shadow mode): looks the inherited method up from target's prototype at
 * call time (as the page's own lookup would), calls it exactly once with the caller's `this` and arguments, returns its
 * result and rethrows its exception; the observer runs after a successful call. Restored only while still ours.
 */
function installShadow(target: object, key: string, observe: MethodObserver, ctx: HookContext): WrapResult {
  const prior = existingHandle(target, key, 'method');
  if (prior !== null) return prior;
  if (getOwnPropertyDescriptor(target, key) !== undefined) {
    return { status: 'unsupported', kind: 'method', target, key, label: key, reason: 'define-failed', coverageFlag: 'hook-failed' };
  }
  let observing = false;
  const { wrapper } = {
    wrapper(this: unknown): unknown {
      const proto = getPrototypeOf(target) as object | null;
      const fn: unknown = proto === null ? undefined : reflectGet(proto, key, this);
      let threw = false;
      let error: unknown;
      let result: unknown;
      try {
        result = apply(fn as Function, this, arguments);
      } catch (e) {
        threw = true;
        error = e;
      }
      if (ctx.enabled && !observing) {
        observing = true;
        try {
          observe(this, arguments, threw, error);
        } catch {
          noteObserverError(ctx);
        } finally {
          observing = false;
        }
      }
      if (threw) throw error;
      return result;
    },
  };
  try {
    rawDefineProperty(target, key, { __proto__: null, value: wrapper, writable: true, enumerable: false, configurable: true } as PropertyDescriptor);
  } catch {
    return { status: 'unsupported', kind: 'method', target, key, label: key, reason: 'define-failed', coverageFlag: 'hook-failed' };
  }
  const isOwned = (): boolean => {
    const d = getOwnPropertyDescriptor(target, key);
    return d !== undefined && hasOwn(d, 'value') && d.value === wrapper;
  };
  const handle: HookHandle = {
    status: 'installed',
    kind: 'method',
    target,
    key,
    label: key,
    isOwned,
    restore(): boolean {
      if (!isOwned()) return false;
      try {
        return deleteProperty(target, key);
      } catch {
        return false;
      }
    },
  };
  return handle;
}

export function installRegistrationHooks(deps: RegistrationHookDeps): WrapResult[] {
  const { realm, runtime, sampler, context, config } = deps;
  const results: WrapResult[] = [];
  const windowGetter = (() => {
    const d = getOwnPropertyDescriptor(realm, 'document');
    return d !== undefined && typeof d.get === 'function' ? d.get : null;
  })();
  const doc: unknown = windowGetter === null ? ownDataValue(realm, 'document') : apply(windowGetter, realm, NO_ARGS);
  const docProto = interfaceProto(realm, 'Document');
  const documentElementGetter = ownGetter(docProto, 'documentElement');
  const bodyGetter = ownGetter(docProto, 'body');
  const inputProto = interfaceProto(realm, 'HTMLInputElement');
  const inputTypeGetter = ownGetter(inputProto, 'type');
  const index = listenIndex();
  const listenerScripts = new NativeWeakMap<object, number>();
  const observerScripts = new NativeWeakMap<object, number>();

  function isRoot(t: object): boolean {
    if (typeof doc !== 'object' || doc === null) return false;
    try {
      if (documentElementGetter !== null && t === apply(documentElementGetter, doc, NO_ARGS)) return true;
      if (bodyGetter !== null && t === apply(bodyGetter, doc, NO_ARGS)) return true;
    } catch {
      // A broken document: not a root.
    }
    return false;
  }

  /** Target kind of a registration that succeeded (so `t` is a real EventTarget, never a Proxy). */
  function targetIndexOf(t: unknown): number {
    if (t === realm || t === undefined || t === null) return T_WINDOW;
    if (t === doc) return T_DOCUMENT;
    if (typeof t !== 'object') return T_OTHER;
    if (isRoot(t)) return T_ROOT;
    if (inputProto === null || inputTypeGetter === null) return T_OTHER;
    // One prototype step only (review W4): `t` is a platform object with an ordinary [[GetPrototypeOf]], but its
    // prototype is page-controlled and may be a Proxy whose trap would run page code. Then the brand-checked native
    // `type` getter. A customized built-in input (one more prototype level) counts as `other`.
    const p = getPrototypeOf(t) as object | null;
    if (p !== inputProto) return T_OTHER;
    try {
      return apply(inputTypeGetter, t, NO_ARGS) === 'password' ? T_FIELD_PASSWORD : T_FIELD;
    } catch {
      return T_OTHER; // not a real input element (prototype changed by the page)
    }
  }

  /** Script id of the registration: cached per key object, else sampled (budget permitting); -1 = unsampled. */
  function scriptOf(cache: WeakMap<object, number>, key: unknown, omit: Function | null): number {
    const cacheable = (typeof key === 'object' && key !== null) || typeof key === 'function';
    if (cacheable) {
      const cached = weakMapGet(cache, key as object);
      if (cached !== undefined) return cached;
    }
    if (omit === null) {
      runtime.addLimitation('stack-unavailable');
      return -1;
    }
    const r = sampler.sample('registration', omit);
    if (r.status !== 'sampled') {
      runtime.addLimitation(r.status === 'budget' ? 'stack-budget' : 'stack-unavailable');
      return -1;
    }
    const id = runtime.internScript(r.script);
    if (id < 0) {
      runtime.addLimitation('budget-exceeded');
      return -1;
    }
    if (cacheable) weakMapSet(cache, key as object, id);
    return id;
  }

  function attach(r: WrapResult, limitation: ProtectLimitation): void {
    arrayPush(results, r);
    if (r.status !== 'installed') runtime.addLimitation(limitation);
  }

  // addEventListener -------------------------------------------------------------------------------------------
  /** Observer of one installed wrapper; `omit()` is that wrapper (its frame and ours are left out of the trace). */
  const listenObserver = (omit: () => Function | null): MethodObserver => (thisArg, args, threw) => {
    // Review W4: nothing is read from a failed call, nor an absent args[0] (an inherited page getter would run).
    if (threw || args.length === 0) return;
    const type = args[0];
    if (typeof type !== 'string') return;
    const event = index[type];
    if (event === undefined) return;
    const target = targetIndexOf(thisArg);
    // Elements other than inputs and the root: counted, never sampled (the stack budget stays for the others).
    const id = target === T_OTHER ? -1 : scriptOf(listenerScripts, args.length > 1 ? args[1] : undefined, omit());
    runtime.noteRegistration(HOOK_LISTEN, event, target, id, id >= 0);
  };
  const listenSpec = REGISTRATION_TARGETS.listen;
  if (config.listen === 'off') runtime.addLimitation('listener-hook-off');
  else if (config.listen === 'prototype') {
    const owner = resolveOwner(realm, listenSpec);
    if (owner === null) runtime.addLimitation('listener-hook-off');
    else {
      let omit: Function | null = null;
      const r = wrapMethod(owner, listenSpec.key, listenObserver(() => omit), { context });
      if (r.status === 'installed') omit = installedFunction(owner, listenSpec.key, 'method');
      attach(r, 'listener-hook-off');
    }
  } else {
    // shadow: own wrappers on window and document only; element registrations are not observed.
    runtime.addLimitation('element-listeners-not-observed');
    const shadowTargets: readonly unknown[] = [realm, doc];
    for (let i = 0; i < shadowTargets.length; i++) {
      const target = shadowTargets[i];
      if (typeof target !== 'object' || target === null) continue;
      let omit: Function | null = null;
      const r = installShadow(target, listenSpec.key, listenObserver(() => omit), context);
      if (r.status === 'installed') omit = installedFunction(target, listenSpec.key, 'method');
      attach(r, 'listener-hook-off');
    }
  }

  // MutationObserver.observe -----------------------------------------------------------------------------------
  if (config.observe === 'off') runtime.addLimitation('mo-hook-off');
  else {
    let omitObserve: Function | null = null;
    const observeObserve: MethodObserver = (thisArg, args, threw) => {
      if (threw || args.length === 0) return;
      const t = args[0];
      let target: number;
      if (t === doc) target = T_DOCUMENT;
      else if (typeof t === 'object' && t !== null && isRoot(t)) target = T_ROOT;
      else return;
      const id = scriptOf(observerScripts, thisArg, omitObserve);
      runtime.noteRegistration(HOOK_OBSERVE, -1, target, id, id >= 0);
    };
    const spec = REGISTRATION_TARGETS.observe;
    const owner = resolveOwner(realm, spec);
    if (owner === null) runtime.addLimitation('mo-hook-off');
    else {
      const r = wrapMethod(owner, spec.key, observeObserve, { context });
      if (r.status === 'installed') omitObserve = installedFunction(owner, spec.key, 'method');
      attach(r, 'mo-hook-off');
    }
  }
  return results;
}
