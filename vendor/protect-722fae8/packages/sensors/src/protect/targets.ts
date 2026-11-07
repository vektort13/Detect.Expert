// ADR-020 §F (S10): the hook table of the module's MAIN bundle. THE ONLY source file that names the network APIs it
// observes as string literals, exactly once each (scripts/code-checks.mjs HOOK_TARGET_SOURCE; protect.main.js mirrors
// the table, ADR-020 §A). Everything else reads the names from these frozen tables, never from an identifier: the
// module calls no network API itself (REQ-010) and only observes the page's own calls (REQ-001 revision, ADR-020 §4).
// Owners are resolved from the realm at install time (document_start): `realm` property for a global function,
// `interface` -> realm[interface].prototype for a prototype member.

import type { ProtectRegistrationHookPoint, ProtectSendHookPoint } from '@detect-expert/contracts';

export interface HookTarget {
  /** Global interface whose prototype owns the member, or null for an own property of the realm (window). */
  readonly iface: string | null;
  readonly key: string;
  readonly kind: 'method' | 'setter';
}

export interface SendHookTarget extends HookTarget {
  /** Hook point of the sample; null for XHR open (it only records the address of the instance). */
  readonly hookPoint: ProtectSendHookPoint | null;
}

export interface RegistrationHookTarget extends HookTarget {
  readonly hookPoint: ProtectRegistrationHookPoint;
}

const freeze = Object.freeze;

/** Interface names used more than once: a frozen table, so the bundler never duplicates the literal. */
const NAMES = freeze({ xhr: 'XMLHttpRequest' });

export const SEND_TARGETS = freeze({
  /** window.fetch: an own data property of the global (Window). */
  globalFetch: freeze<SendHookTarget>({ iface: null, key: 'fetch', kind: 'method', hookPoint: 'send-fetch' }),
  /** XMLHttpRequest.prototype.open: only the masked address, kept per instance in a WeakMap. */
  xhrOpen: freeze<SendHookTarget>({ iface: NAMES.xhr, key: 'open', kind: 'method', hookPoint: null }),
  /** XMLHttpRequest.prototype.send: the sample (stack + the address recorded by open). */
  xhrSend: freeze<SendHookTarget>({ iface: NAMES.xhr, key: 'send', kind: 'method', hookPoint: 'send-xhr' }),
  /** Navigator.prototype.sendBeacon. */
  beacon: freeze<SendHookTarget>({ iface: 'Navigator', key: 'sendBeacon', kind: 'method', hookPoint: 'send-beacon' }),
  /** HTMLImageElement.prototype src setter (PROTECT_HOOK_CONFIG.imgSrc; off by default). */
  imageSrc: freeze<SendHookTarget>({ iface: 'HTMLImageElement', key: 'src', kind: 'setter', hookPoint: 'send-image' }),
});

export const REGISTRATION_TARGETS = freeze({
  /** EventTarget.prototype.addEventListener: the event type is the first, cheapest check. */
  listen: freeze<RegistrationHookTarget>({ iface: 'EventTarget', key: 'addEventListener', kind: 'method', hookPoint: 'listen' }),
  /** MutationObserver.prototype.observe: only the document and its root elements; options are never read. */
  observe: freeze<RegistrationHookTarget>({ iface: 'MutationObserver', key: 'observe', kind: 'method', hookPoint: 'observe-document' }),
});

const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const hasOwn = Function.prototype.call.bind(Object.prototype.hasOwnProperty) as (o: object, k: PropertyKey) => boolean;

/**
 * The object owning `target` in `realm`: the realm itself, or realm[iface].prototype read through own data
 * descriptors (a page accessor is never invoked). Null when absent or not a plain data chain.
 */
export function resolveOwner(realm: object, target: HookTarget): object | null {
  if (target.iface === null) return realm;
  const ctor = getOwnPropertyDescriptor(realm, target.iface);
  if (ctor === undefined || !hasOwn(ctor, 'value') || typeof ctor.value !== 'function') return null;
  const proto = getOwnPropertyDescriptor(ctor.value as object, 'prototype');
  if (proto === undefined || !hasOwn(proto, 'value') || typeof proto.value !== 'object' || proto.value === null) return null;
  return proto.value as object;
}
