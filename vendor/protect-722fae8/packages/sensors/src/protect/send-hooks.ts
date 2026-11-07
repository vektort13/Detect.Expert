// ADR-020 §F (S10): send hooks of the module «Защита» — window.fetch, XMLHttpRequest.prototype.open (address only, in
// a WeakMap per instance) and send, Navigator.prototype.sendBeacon, and (PROTECT_HOOK_CONFIG.imgSrc, off by default)
// the HTMLImageElement.prototype src setter. Installed through wrapMethod / wrapSetter (packages/sensors/src/wrap.ts):
// the original is called exactly once with the caller's `this` and arguments; its result, Promise identity and
// exception are returned untouched; nothing is attached to the page's Promise; toString is never masked (REQ-002/003).
// The observer runs after the call and only when the original did not throw. It reads `arguments.length`, `typeof` of
// primitives and the address through brand checks of captured native getters (Request.prototype.url,
// URL.prototype.href): a Proxy or an object with its own toString fails them without running any page code and gives
// `target: 'unread'`. `init`, the body, the beacon `data` and headers are never read; nothing is coerced (REQ-002).
// This module calls no network API: it only observes the page's calls (REQ-010).

import type { ProtectSendHookPoint, ScriptRef, SendTarget } from '@detect-expert/contracts';
import { reduceTargetUrl } from '../../../attribution/src/script-ref';
import { arrayPush } from '../intrinsics';
import { wrapMethod, wrapSetter } from '../wrap';
import type { HookContext, MethodObserver, WrapResult } from '../wrap';
import type { WrapHookMode } from './config';
import type { ProtectMainRuntime } from './runtime';
import type { StackSampler } from './stack';
import { SEND_TARGETS, resolveOwner } from './targets';
import type { SendHookTarget } from './targets';

const apply = Reflect.apply;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const hasOwn = Function.prototype.call.bind(Object.prototype.hasOwnProperty) as (o: object, k: PropertyKey) => boolean;
const weakMapGet = Function.prototype.call.bind(WeakMap.prototype.get) as (m: WeakMap<object, SendTarget | null>, k: object) => SendTarget | null | undefined;
const weakMapSet = Function.prototype.call.bind(WeakMap.prototype.set) as (m: WeakMap<object, SendTarget | null>, k: object, v: SendTarget | null) => unknown;
const NativeWeakMap = WeakMap;
const NO_ARGS: readonly unknown[] = Object.freeze([]);
const UNREAD: SendTarget = Object.freeze({ kind: 'unread' }) as SendTarget;
const UNKNOWN_REF: ScriptRef = Object.freeze({ kind: 'unknown' }) as ScriptRef;

export interface SendHookDeps {
  realm: object;
  runtime: Pick<ProtectMainRuntime, 'noteSend' | 'addLimitation'>;
  sampler: StackSampler;
  context: HookContext;
  /** Host of the document (an address of the document's own host is `relative`). */
  docHost: string;
  config: { send: WrapHookMode; imgSrc: WrapHookMode };
}

/** A native accessor getter of `iface.prototype[key]` captured now (own descriptors only), or null. */
export function capturedGetter(realm: object, iface: string, key: string): Function | null {
  try {
    const ctor = getOwnPropertyDescriptor(realm, iface);
    if (ctor === undefined || !hasOwn(ctor, 'value') || typeof ctor.value !== 'function') return null;
    const proto = getOwnPropertyDescriptor(ctor.value as object, 'prototype');
    if (proto === undefined || !hasOwn(proto, 'value') || typeof proto.value !== 'object' || proto.value === null) return null;
    const d = getOwnPropertyDescriptor(proto.value as object, key);
    return d !== undefined && typeof d.get === 'function' ? d.get : null;
  } catch {
    return null;
  }
}

/** The function now installed at owner[key] (our wrapper right after wrapMethod / wrapSetter), or null. */
export function installedFunction(owner: object, key: string, kind: 'method' | 'setter'): Function | null {
  const d = getOwnPropertyDescriptor(owner, key);
  if (d === undefined) return null;
  if (kind === 'method') return hasOwn(d, 'value') && typeof d.value === 'function' ? (d.value as Function) : null;
  return typeof d.set === 'function' ? d.set : null;
}

export function installSendHooks(deps: SendHookDeps): WrapResult[] {
  const { realm, runtime, sampler, context, docHost, config } = deps;
  const requestUrl = capturedGetter(realm, 'Request', 'url');
  const urlHref = capturedGetter(realm, 'URL', 'href');
  const xhrTargets = new NativeWeakMap<object, SendTarget | null>();
  const results: WrapResult[] = [];

  /** Address of a send argument: a primitive string, or a brand-checked Request / URL; never coerced. */
  function targetOf(arg: unknown): SendTarget | null {
    if (typeof arg === 'string') return reduceTargetUrl(arg, docHost);
    if ((typeof arg === 'object' && arg !== null) || typeof arg === 'function') {
      if (requestUrl !== null) {
        try {
          const s: unknown = apply(requestUrl, arg, NO_ARGS);
          if (typeof s === 'string') return reduceTargetUrl(s, docHost);
        } catch {
          // Not a Request (a Proxy or a plain object fails the brand check without running page code).
        }
      }
      if (urlHref !== null) {
        try {
          const s: unknown = apply(urlHref, arg, NO_ARGS);
          if (typeof s === 'string') return reduceTargetUrl(s, docHost);
        } catch {
          // Not a URL either.
        }
      }
    }
    return UNREAD;
  }

  function emit(hookPoint: ProtectSendHookPoint, target: SendTarget, omit: Function | null): void {
    let script = UNKNOWN_REF;
    let sampled = false;
    if (omit !== null) {
      const r = sampler.sample('send', omit);
      if (r.status === 'sampled') {
        script = r.script;
        sampled = true;
      } else runtime.addLimitation(r.status === 'budget' ? 'stack-budget' : 'stack-unavailable');
    } else runtime.addLimitation('stack-unavailable');
    if (target.kind === 'unread') runtime.addLimitation('target-unread');
    runtime.noteSend(hookPoint, script, sampled, target);
  }

  function install(target: SendHookTarget, observe: (omit: () => Function | null) => MethodObserver): void {
    const owner = resolveOwner(realm, target);
    if (owner === null) return;
    let omit: Function | null = null;
    const observer = observe(() => omit);
    const r = target.kind === 'method' ? wrapMethod(owner, target.key, observer, { context }) : wrapSetter(owner, target.key, observer, { context });
    if (r.status === 'installed') omit = installedFunction(owner, target.key, target.kind);
    arrayPush(results, r);
  }

  if (config.send === 'wrap') {
    // window.fetch with (input, init): only `input` (string / Request / URL); `init` is never touched.
    install(SEND_TARGETS.globalFetch, (omit) => (_this, args, threw) => {
      if (threw || args.length === 0) return;
      const target = targetOf(args[0]);
      if (target !== null) emit('send-fetch', target, omit());
    });
    // XMLHttpRequest.prototype.open with (method, url, ...): the masked address of this instance (method and credentials
    // are not read). A later open() replaces it.
    install(SEND_TARGETS.xhrOpen, () => (thisArg, args, threw) => {
      if (threw || args.length < 2 || typeof thisArg !== 'object' || thisArg === null) return;
      weakMapSet(xhrTargets, thisArg, targetOf(args[1]));
    });
    // XMLHttpRequest.prototype.send with (body): the sample; the body is never read.
    install(SEND_TARGETS.xhrSend, (omit) => (thisArg, _args, threw) => {
      if (threw || typeof thisArg !== 'object' || thisArg === null) return;
      const target = weakMapGet(xhrTargets, thisArg);
      if (target === null) return; // open() pointed to a non-network scheme
      emit('send-xhr', target === undefined ? UNREAD : target, omit());
    });
    // Navigator.prototype.sendBeacon with (url, data): `data` is never read.
    install(SEND_TARGETS.beacon, (omit) => (_this, args, threw) => {
      if (threw || args.length === 0) return;
      const target = targetOf(args[0]);
      if (target !== null) emit('send-beacon', target, omit());
    });
  }
  if (config.imgSrc === 'wrap') {
    // HTMLImageElement.prototype.src = value: the address; the load itself may start later (lazy loading).
    install(SEND_TARGETS.imageSrc, (omit) => (_this, args, threw) => {
      if (threw || args.length === 0) return;
      const target = targetOf(args[0]);
      if (target !== null) emit('send-image', target, omit());
    });
  }
  return results;
}
