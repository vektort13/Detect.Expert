// Realm lookups for sensor installers (REQ-002, ADR-006 §3, ADR-017 §2). Install-time helpers read interface
// objects only through OWN data descriptors: no page getter, Proxy `get` trap or inherited descriptor field is ever
// consulted. The two call helpers apply a native getter captured at install time to a receiver; a failed brand check
// (TypeError for a wrong receiver) is swallowed and means "not that platform object".

const apply = Reflect.apply;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const hasOwn = Function.prototype.call.bind(Object.prototype.hasOwnProperty) as (o: object, k: PropertyKey) => boolean;
const EMPTY_ARGS: readonly unknown[] = Object.freeze([]);

export type Getter = (this: unknown) => unknown;
export type Method = (this: unknown, ...args: unknown[]) => unknown;

/** Value of an own data property, or undefined (accessors and inherited fields are never read). */
function ownData(object: object, key: PropertyKey): unknown {
  const d = getOwnPropertyDescriptor(object, key);
  return d !== undefined && hasOwn(d, 'value') ? d.value : undefined;
}

/** `realm[name].prototype` read through data descriptors only; null when absent or not an interface object. */
export function prototypeOf(realm: object, name: string): object | null {
  const ctor = ownData(realm, name);
  if (typeof ctor !== 'function') return null;
  const proto = ownData(ctor, 'prototype');
  return typeof proto === 'object' && proto !== null ? proto : null;
}

/** Own accessor getter of `proto[key]`; null when absent or a data property. */
export function getterOf(proto: object | null, key: PropertyKey): Getter | null {
  if (proto === null) return null;
  const d = getOwnPropertyDescriptor(proto, key);
  return d !== undefined && hasOwn(d, 'get') && typeof d.get === 'function' ? (d.get as Getter) : null;
}

/** Own data-property method `proto[key]`; null when absent, an accessor or not a function. */
export function methodOf(proto: object | null, key: PropertyKey): Method | null {
  if (proto === null) return null;
  const value = ownData(proto, key);
  return typeof value === 'function' ? (value as Method) : null;
}

/** Calls a getter captured at install time; a brand-check TypeError (wrong receiver) means "no object". */
export function readObject(getter: Getter | null, receiver: unknown): object | null {
  if (getter === null) return null;
  try {
    const v: unknown = apply(getter, receiver, EMPTY_ARGS);
    return typeof v === 'object' && v !== null ? v : null;
  } catch {
    return null;
  }
}

/**
 * True when the captured native getter accepts `receiver` (the receiver is that platform interface). The value is
 * discarded. Only for getters captured at install time with `earlyCaptureGuaranteed` (ADR-017 §2, source 4).
 */
export function brandCheck(getter: Getter | null, receiver: unknown): boolean {
  if (getter === null || typeof receiver !== 'object' || receiver === null) return false;
  try {
    apply(getter, receiver, EMPTY_ARGS);
    return true;
  } catch {
    return false;
  }
}
