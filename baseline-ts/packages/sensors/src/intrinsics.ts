// REQ-002/011, F045/F046/F131: capture collection operations before page scripts can replace them.
// Never hand private queues or entries to live prototype methods or iterator protocols.
const defineProperty = Object.defineProperty;
export function arrayPush<T>(a: T[], value: T): number {
  // Even a captured native push invokes inherited numeric setters. Define an own slot instead (F046).
  defineProperty(a, a.length, { __proto__: null, value, writable: true, enumerable: true, configurable: true } as PropertyDescriptor);
  return a.length;
}
// Native slice/splice still consult page-controlled @@species; copy and compact by index instead.
export function arraySlice<T>(a: readonly T[], start = 0, end = a.length): T[] {
  const out: T[] = [];
  for (let i = start; i < end && i < a.length; i++) arrayPush(out, a[i]!);
  return out;
}
export function arraySplice<T>(a: T[], start: number, count: number): void {
  const end = start + count < a.length ? start + count : a.length;
  for (let i = end; i < a.length; i++) a[start + i - end] = a[i]!;
  a.length -= end - start;
}
export const arrayIncludes = Function.prototype.call.bind(Array.prototype.includes) as <T>(a: readonly T[], value: T) => boolean;
export const arraySort = Function.prototype.call.bind(Array.prototype.sort) as <T>(a: T[]) => T[];
export const setHas = Function.prototype.call.bind(Set.prototype.has) as <T>(s: Set<T>, value: T) => boolean;
export const setAdd = Function.prototype.call.bind(Set.prototype.add) as <T>(s: Set<T>, value: T) => unknown;
const setForEach = Function.prototype.call.bind(Set.prototype.forEach) as <T>(s: Set<T>, fn: (value: T) => void) => void;
export const mapSize = Function.prototype.call.bind(Object.getOwnPropertyDescriptor(Map.prototype, 'size')!.get!) as (m: Map<unknown, unknown>) => number;
export const mapForEach = Function.prototype.call.bind(Map.prototype.forEach) as <K, V>(m: Map<K, V>, fn: (value: V) => void) => void;
export const weakSetHas = Function.prototype.call.bind(WeakSet.prototype.has) as (s: WeakSet<object>, value: object) => boolean;
export const weakSetAdd = Function.prototype.call.bind(WeakSet.prototype.add) as (s: WeakSet<object>, value: object) => unknown;
export const weakSetDelete = Function.prototype.call.bind(WeakSet.prototype.delete) as (s: WeakSet<object>, value: object) => boolean;

export function setArray<T>(set: Set<T>): T[] {
  const out: T[] = [];
  setForEach(set, (value) => { arrayPush(out, value); });
  return out;
}
