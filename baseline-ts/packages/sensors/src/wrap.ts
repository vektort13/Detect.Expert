// Hook installation utilities for the MAIN world (REQ-001, REQ-002, REQ-003; ADR-006; spec II A11, III §3.4, V §3).
//
// Contract of every wrapper produced here:
//   - the original descriptor is captured once and installed back only through an ownership check;
//   - the original is called exactly once via Reflect.apply / Reflect.construct with the caller's `this`,
//     arguments and `new.target`; its result (NaN, -0, object and Promise identity) is returned untouched and
//     its exception propagates as the same instance;
//   - the observer runs after the original, inside try/catch and behind a reentrancy guard; an observer error
//     only bumps `HookContext.observerErrors`, never changes what the page sees;
//   - the wrapper never inspects arguments itself; observers may only do cheap checks (arguments.length,
//     typeof of values and captured WeakMap/WeakSet lookups) that cannot run
//     page code — no String()/Number()/JSON, no property reads on plain objects, no .then/.catch;
//   - no masking: Function.prototype.toString is never touched. Copying `name`/`length` descriptors is a
//     compatibility measure only (a wrapper stays detectable by identity, descriptors and timing, REQ-014).
//
// Builtins used by the wrapper are captured at module evaluation (document_start) so that later page patches
// of Reflect/Object do not turn our call path into a vector. Late installs cannot make that guarantee.

import { MAX_COUNT } from '@detect-expert/contracts';
import type { CoverageFlag } from '@detect-expert/contracts';

const apply = Reflect.apply;
const construct = Reflect.construct;
const NativeProxy = Proxy;
const rawDefineProperty = Object.defineProperty;
const hasOwn = Function.prototype.call.bind(Object.prototype.hasOwnProperty) as (o: object, k: string) => boolean;
const create = Object.create;
// F135: ToPropertyDescriptor must never see inherited get/set/value/writable pollution.
function defineProperty(target: object, key: PropertyKey, descriptor: PropertyDescriptor): void {
  const clean = create(null) as PropertyDescriptor;
  if (hasOwn(descriptor, 'value')) clean.value = descriptor.value;
  if (hasOwn(descriptor, 'writable')) clean.writable = descriptor.writable === true;
  if (hasOwn(descriptor, 'get')) clean.get = descriptor.get!;
  if (hasOwn(descriptor, 'set')) clean.set = descriptor.set!;
  if (hasOwn(descriptor, 'enumerable')) clean.enumerable = descriptor.enumerable === true;
  if (hasOwn(descriptor, 'configurable')) clean.configurable = descriptor.configurable === true;
  rawDefineProperty(target, key, clean);
}
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getOwnPropertyNames = Object.getOwnPropertyNames;
const getOwnPropertySymbols = Object.getOwnPropertySymbols;
const getPrototypeOf = Object.getPrototypeOf;
const setPrototypeOf = Object.setPrototypeOf;

/** Shared on/off switch and error counter for a group of hooks (one per SensorRuntime). */
export interface HookContext {
  /** false while paused/stopped: originals still run, observers are skipped (ADR-006 §7). */
  enabled: boolean;
  /** Saturating count of observer exceptions (sensor status only; never visible to the page). */
  observerErrors: number;
  /** Runtime-owned, coalesced status scheduling; failures remain isolated from the caller. */
  onObserverError?: () => void;
}

export function createHookContext(): HookContext {
  return { enabled: true, observerErrors: 0 };
}

/** Called once per call of the wrapped method, after the original returned or threw. Must be cheap. */
// Ordinary observations retain only weak identity. ADR-017/018 separately permits bounded native-branded
// readback copies in the ephemeral visual channel; arbitrary result getters and Promise handlers stay forbidden.
export type MethodObserver = (thisArg: unknown, args: IArguments, threw: boolean, error: unknown, result: unknown) => void;
/** Outcome-only hooks never expose the original receiver, arguments, result or exception to observers. */
export type OutcomeObserver = (threw: boolean) => void;
export type GetterObserver = (thisArg: unknown, threw: boolean, error: unknown, result: unknown) => void;
// ADR-020: the result is available only for weak identity and native-branded WebRTC configuration capture.
export type ConstructorObserver = (args: IArguments, newTarget: unknown, threw: boolean, error: unknown, result: unknown) => void;

export type HookKind = 'method' | 'getter' | 'setter' | 'constructor';

export type UnsupportedReason =
  | 'missing'
  | 'non-configurable'
  | 'not-a-method'
  | 'not-a-getter'
  | 'not-a-setter'
  | 'not-a-constructor'
  | 'define-failed';

export interface HookHandle {
  readonly status: 'installed';
  readonly kind: HookKind;
  readonly target: object;
  readonly key: PropertyKey;
  /** Human-readable label for status reports (our own key name, never page data). */
  readonly label: string;
  /** True while the current own descriptor still holds our wrapper. */
  isOwned(): boolean;
  /** Restores the captured original descriptor only if still owned; false = left as is (cleanup partial). */
  restore(): boolean;
}

export interface HookUnsupported {
  readonly status: 'unsupported';
  readonly kind: HookKind;
  readonly target: object;
  readonly key: PropertyKey;
  readonly label: string;
  readonly reason: UnsupportedReason;
  /** descriptor-nonconfigurable for a frozen/sealed descriptor, hook-failed for anything else. */
  readonly coverageFlag: CoverageFlag;
}

export type WrapResult = HookHandle | HookUnsupported;

export interface WrapOptions {
  context?: HookContext;
  /** Copy `name`/`length` data descriptors from the original (default true). Compatibility only, not masking. */
  copyNameAndLength?: boolean;
}

const defaultContext = createHookContext();

/** Module-wide reentrancy guard: a wrapped API called from inside an observer is not observed. */
let observing = false;

/** Wrapper ownership registry: target -> key -> handle. Not visible to the page (no marker property). */
const registry = new WeakMap<object, Map<PropertyKey, HookHandle>>();

function labelOf(key: PropertyKey): string {
  return typeof key === 'symbol' ? 'Symbol(' + (key.description ?? '') + ')' : String(key);
}

export function noteObserverError(ctx: HookContext): void {
  if (ctx.observerErrors < MAX_COUNT) ctx.observerErrors++;
  try { ctx.onObserverError?.(); } catch { /* Never replace the original result or exception. */ }
}

function unsupported(kind: HookKind, target: object, key: PropertyKey, reason: UnsupportedReason): HookUnsupported {
  return {
    status: 'unsupported',
    kind,
    target,
    key,
    label: labelOf(key),
    reason,
    coverageFlag: reason === 'non-configurable' ? 'descriptor-nonconfigurable' : 'hook-failed',
  };
}

/** Existing handle for (target, key) if we wrapped it before and did not restore it (ADR-006 §9). */
function existingHandle(target: object, key: PropertyKey): HookHandle | null {
  const perTarget = registry.get(target);
  if (perTarget === undefined) return null;
  return perTarget.get(key) ?? null;
}

function remember(target: object, key: PropertyKey, handle: HookHandle): void {
  let perTarget = registry.get(target);
  if (perTarget === undefined) {
    perTarget = new Map();
    registry.set(target, perTarget);
  }
  perTarget.set(key, handle);
}

function forget(target: object, key: PropertyKey): void {
  registry.get(target)?.delete(key);
}

/** Copies `name` and `length` when they are plain data descriptors; never reads through getters. */
function copyFunctionMeta(wrapper: Function, original: Function): void {
  const keys = ['length', 'name'] as const;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!;
    const d = getOwnPropertyDescriptor(original, k);
    if (d !== undefined && hasOwn(d, 'value')) {
      try {
        defineProperty(wrapper, k, { value: d.value, writable: false, enumerable: false, configurable: true });
      } catch {
        // compatibility only; a failure here changes nothing for the page
      }
    }
  }
}

function makeHandle(
  kind: HookKind,
  target: object,
  key: PropertyKey,
  originalDescriptor: PropertyDescriptor,
  isOwned: () => boolean,
): HookHandle {
  const handle: HookHandle = {
    status: 'installed',
    kind,
    target,
    key,
    label: labelOf(key),
    isOwned,
    restore(): boolean {
      if (!isOwned()) return false;
      try {
        defineProperty(target, key, originalDescriptor);
      } catch {
        return false;
      }
      forget(target, key);
      return true;
    },
  };
  remember(target, key, handle);
  return handle;
}

// ---------------------------------------------------------------------------
// Methods
// ---------------------------------------------------------------------------

function installMethodWrapper(
  target: object,
  key: PropertyKey,
  desc: PropertyDescriptor,
  wrapper: Function,
  options?: WrapOptions,
): WrapResult {
  if (options?.copyNameAndLength !== false) copyFunctionMeta(wrapper, desc.value as Function);
  try {
    defineProperty(target, key, {
      value: wrapper,
      writable: desc.writable === true,
      enumerable: desc.enumerable === true,
      configurable: true,
    });
  } catch {
    return unsupported('method', target, key, 'define-failed');
  }
  return makeHandle('method', target, key, desc, () => {
    const d = getOwnPropertyDescriptor(target, key);
    return d !== undefined && hasOwn(d, 'value') && d.value === wrapper;
  });
}

export function wrapPreparedMethod<State>(target: object, key: PropertyKey,
  prepare: (receiver: unknown, args: IArguments) => State,
  observe: (state: State, receiver: unknown, args: IArguments, threw: boolean) => void, options?: WrapOptions): WrapResult {
  const existing = existingHandle(target, key);
  if (existing !== null) return existing;
  const desc = getOwnPropertyDescriptor(target, key);
  if (desc === undefined) return unsupported('method', target, key, 'missing');
  if (desc.configurable !== true) return unsupported('method', target, key, 'non-configurable');
  if (!hasOwn(desc, 'value') || typeof desc.value !== 'function') return unsupported('method', target, key, 'not-a-method');
  const original: Function = desc.value;
  const ctx = options?.context ?? defaultContext;
  const { wrapper } = {
    wrapper(this: unknown): unknown {
      let prepared = false, state: State | undefined;
      if (ctx.enabled && !observing) {
        observing = true;
        try { state = prepare(this, arguments); prepared = true; }
        catch { noteObserverError(ctx); }
        finally { observing = false; }
      }
      let result: unknown, error: unknown, threw = false;
      try { result = apply(original, this, arguments); }
      catch (caught) { error = caught; threw = true; }
      if (prepared && ctx.enabled && !observing) {
        observing = true;
        try { observe(state as State, this, arguments, threw); }
        catch { noteObserverError(ctx); }
        finally { observing = false; }
      }
      if (threw) throw error;
      return result;
    },
  };
  return installMethodWrapper(target, key, desc, wrapper, options);
}

export function wrapMethod(target: object, key: PropertyKey, observe: MethodObserver, options?: WrapOptions): WrapResult {
  const existing = existingHandle(target, key);
  if (existing !== null) return existing;
  const desc = getOwnPropertyDescriptor(target, key);
  if (desc === undefined) return unsupported('method', target, key, 'missing');
  if (desc.configurable !== true) return unsupported('method', target, key, 'non-configurable');
  if (!(hasOwn(desc, 'value')) || typeof desc.value !== 'function') return unsupported('method', target, key, 'not-a-method');
  const original: Function = desc.value;
  const ctx = options?.context ?? defaultContext;

  // Method shorthand: like a native method the wrapper has no `prototype` and is not constructible.
  const { wrapper } = {
    wrapper(this: unknown): unknown {
      let threw = false;
      let error: unknown;
      let result: unknown;
      try {
        result = apply(original, this, arguments);
      } catch (e) {
        threw = true;
        error = e;
      }
      if (ctx.enabled && !observing) {
        observing = true;
        try {
          observe(this, arguments, threw, error, result);
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

  return installMethodWrapper(target, key, desc, wrapper, options);
}

/**
 * ADR-006: optional method wrapper for counters that only need successful return vs synchronous throw.
 * Keep arguments confined to the native apply; forwarding them to an observer can force allocation on
 * every hot call even when that observer ignores them. Installation and cleanup use the same registry.
 */
export function wrapOutcomeMethod(target: object, key: PropertyKey, observe: OutcomeObserver, options?: WrapOptions): WrapResult {
  const existing = existingHandle(target, key);
  if (existing !== null) return existing;
  const desc = getOwnPropertyDescriptor(target, key);
  if (desc === undefined) return unsupported('method', target, key, 'missing');
  if (desc.configurable !== true) return unsupported('method', target, key, 'non-configurable');
  if (!hasOwn(desc, 'value') || typeof desc.value !== 'function') return unsupported('method', target, key, 'not-a-method');
  const original: Function = desc.value;
  const ctx = options?.context ?? defaultContext;
  const { wrapper } = {
    wrapper(this: unknown): unknown {
      let threw = false;
      let error: unknown;
      let result: unknown;
      try {
        result = apply(original, this, arguments);
      } catch (e) {
        threw = true;
        error = e;
      }
      if (ctx.enabled && !observing) {
        observing = true;
        try {
          observe(threw);
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
  return installMethodWrapper(target, key, desc, wrapper, options);
}

export function wrapResultMethod(target: object, key: PropertyKey, observe: (threw: boolean, result: unknown) => void, options?: WrapOptions): WrapResult {
  const existing = existingHandle(target, key);
  if (existing !== null) return existing;
  const desc = getOwnPropertyDescriptor(target, key);
  if (desc === undefined) return unsupported('method', target, key, 'missing');
  if (desc.configurable !== true) return unsupported('method', target, key, 'non-configurable');
  if (!hasOwn(desc, 'value') || typeof desc.value !== 'function') return unsupported('method', target, key, 'not-a-method');
  const original: Function = desc.value;
  const ctx = options?.context ?? defaultContext;
  const { wrapper } = {
    wrapper(this: unknown): unknown {
      let threw = false, error: unknown, result: unknown;
      try { result = apply(original, this, arguments); }
      catch (caught) { threw = true; error = caught; }
      if (ctx.enabled && !observing) {
        observing = true;
        try { observe(threw, result); }
        catch { noteObserverError(ctx); }
        finally { observing = false; }
      }
      if (threw) throw error;
      return result;
    },
  };
  return installMethodWrapper(target, key, desc, wrapper, options);
}

// ---------------------------------------------------------------------------
// Getters (accessor descriptors); the setter, if any, is kept untouched.
// ---------------------------------------------------------------------------

export function wrapGetter(target: object, key: PropertyKey, observe: GetterObserver, options?: WrapOptions): WrapResult {
  const existing = existingHandle(target, key);
  if (existing !== null) return existing;
  const desc = getOwnPropertyDescriptor(target, key);
  if (desc === undefined) return unsupported('getter', target, key, 'missing');
  if (desc.configurable !== true) return unsupported('getter', target, key, 'non-configurable');
  if (!hasOwn(desc, 'get') || typeof desc.get !== 'function') return unsupported('getter', target, key, 'not-a-getter');
  const original: Function = desc.get;
  const ctx = options?.context ?? defaultContext;

  // Method shorthand: like a native getter the wrapper has no `prototype` and is not constructible.
  const { wrapper } = {
    wrapper(this: unknown): unknown {
      let threw = false;
      let error: unknown;
      let result: unknown;
      try {
        result = apply(original, this, arguments);
      } catch (e) {
        threw = true;
        error = e;
      }
      if (ctx.enabled && !observing) {
        observing = true;
        try {
          observe(this, threw, error, result);
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

  if (options?.copyNameAndLength !== false) copyFunctionMeta(wrapper, original);
  const next: PropertyDescriptor = { get: wrapper, enumerable: desc.enumerable === true, configurable: true };
  if (desc.set !== undefined) next.set = desc.set;
  try {
    defineProperty(target, key, next);
  } catch {
    return unsupported('getter', target, key, 'define-failed');
  }
  return makeHandle('getter', target, key, desc, () => {
    const d = getOwnPropertyDescriptor(target, key);
    return d !== undefined && hasOwn(d, 'get') && d.get === wrapper && d.set === desc.set;
  });
}

// P04 / ADR-006: setter calls preserve arguments, return/throw identity and the untouched getter.
export function wrapSetter(target: object, key: PropertyKey, observe: MethodObserver, options?: WrapOptions): WrapResult {
  const existing = existingHandle(target, key);
  if (existing !== null) return existing;
  const desc = getOwnPropertyDescriptor(target, key);
  if (desc === undefined) return unsupported('setter', target, key, 'missing');
  if (desc.configurable !== true) return unsupported('setter', target, key, 'non-configurable');
  if (!hasOwn(desc, 'set') || typeof desc.set !== 'function') return unsupported('setter', target, key, 'not-a-setter');
  const original: Function = desc.set;
  const ctx = options?.context ?? defaultContext;

  // Method shorthand: like a native setter the wrapper has no `prototype` and is not constructible.
  const { wrapper } = {
    wrapper(this: unknown): unknown {
      let threw = false;
      let error: unknown;
      let result: unknown;
      try {
        result = apply(original, this, arguments);
      } catch (e) {
        threw = true;
        error = e;
      }
      if (ctx.enabled && !observing) {
        observing = true;
        try {
          observe(this, arguments, threw, error, result);
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

  if (options?.copyNameAndLength !== false) copyFunctionMeta(wrapper, original);
  const next: PropertyDescriptor = { set: wrapper, enumerable: desc.enumerable === true, configurable: true };
  if (desc.get !== undefined) next.get = desc.get;
  try {
    defineProperty(target, key, next);
  } catch {
    return unsupported('setter', target, key, 'define-failed');
  }
  return makeHandle('setter', target, key, desc, () => {
    const d = getOwnPropertyDescriptor(target, key);
    return d !== undefined && hasOwn(d, 'set') && d.set === wrapper && d.get === desc.get;
  });
}

// ---------------------------------------------------------------------------
// Constructors. `new.target` is forwarded so subclasses get their own prototype; called without `new`
// the original is applied as a plain call so it raises its own TypeError. Static own properties are copied by
// descriptor (no getter invoked) and the wrapper inherits from the original's [[Prototype]] so static
// inheritance chains keep working. `prototype` is shared with the original: instances are real instances.
// ---------------------------------------------------------------------------

const SKIPPED_STATICS: ReadonlySet<PropertyKey> = new Set<PropertyKey>(['prototype', 'length', 'name', 'arguments', 'caller']);

export function wrapConstructor(
  target: object,
  key: PropertyKey,
  observe: ConstructorObserver,
  options?: WrapOptions,
): WrapResult {
  const existing = existingHandle(target, key);
  if (existing !== null) return existing;
  const desc = getOwnPropertyDescriptor(target, key);
  if (desc === undefined) return unsupported('constructor', target, key, 'missing');
  if (desc.configurable !== true) return unsupported('constructor', target, key, 'non-configurable');
  if (!(hasOwn(desc, 'value')) || typeof desc.value !== 'function') return unsupported('constructor', target, key, 'not-a-constructor');
  const original: Function = desc.value;
  const protoDesc = getOwnPropertyDescriptor(original, 'prototype');
  if (protoDesc === undefined || !(hasOwn(protoDesc, 'value'))) return unsupported('constructor', target, key, 'not-a-constructor');
  const ctx = options?.context ?? defaultContext;

  function invoke(thisArg: unknown, args: IArguments, newTarget: Function | undefined): unknown {
    let threw = false;
    let error: unknown;
    let result: unknown;
    try {
      result =
        newTarget === undefined
          ? apply(original, thisArg, args)
          : construct(original, args, newTarget === wrapper ? original : newTarget);
    } catch (e) {
      threw = true;
      error = e;
    }
    if (ctx.enabled && !observing) {
      observing = true;
      try {
        observe(args, newTarget, threw, error, result);
      } catch {
        noteObserverError(ctx);
      } finally {
        observing = false;
      }
    }
    if (threw) throw error;
    return result;
  }

  // P03 / F176 / ADR-006: a construct trap avoids the wrapper's own
  // OrdinaryCreateFromConstructor (and its extra newTarget.prototype read).
  // Applying this adapter keeps the observer's IArguments contract unchanged.
  function constructAdapter(this: Function): object {
    return invoke(undefined, arguments, this) as object;
  }
  const wrapper = new NativeProxy(function (this: unknown): unknown {
    return invoke(this, arguments, undefined);
  }, {
    __proto__: null,
    construct(_target: Function, args: unknown[], newTarget: Function): object {
      return apply(constructAdapter, newTarget, args) as object;
    },
  } as ProxyHandler<Function>);

  try {
    defineProperty(wrapper, 'prototype', {
      value: protoDesc.value,
      writable: protoDesc.writable === true,
      enumerable: false,
      configurable: false,
    });
    for (const k of [...getOwnPropertyNames(original), ...getOwnPropertySymbols(original)]) {
      if (SKIPPED_STATICS.has(k)) continue;
      const d = getOwnPropertyDescriptor(original, k);
      if (d !== undefined) defineProperty(wrapper, k, d);
    }
    setPrototypeOf(wrapper, getPrototypeOf(original));
    if (options?.copyNameAndLength !== false) {
      for (const k of ['length', 'name'] as const) {
        const d = getOwnPropertyDescriptor(original, k);
        if (d !== undefined && hasOwn(d, 'value')) defineProperty(wrapper, k, d);
      }
    }
  } catch {
    return unsupported('constructor', target, key, 'define-failed');
  }
  try {
    defineProperty(target, key, {
      value: wrapper,
      writable: desc.writable === true,
      enumerable: desc.enumerable === true,
      configurable: true,
    });
  } catch {
    return unsupported('constructor', target, key, 'define-failed');
  }
  return makeHandle('constructor', target, key, desc, () => {
    const d = getOwnPropertyDescriptor(target, key);
    return d !== undefined && hasOwn(d, 'value') && d.value === wrapper;
  });
}
