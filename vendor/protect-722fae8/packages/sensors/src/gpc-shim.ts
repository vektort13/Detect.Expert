// ADR-020 §H (S13): navigator.globalPrivacyControl for the module feature `gpc`. gpc.main.js (MAIN world, first file
// of detector-protect-main-v1, registered only while the feature is on) calls installGpcProperty(window) once.
// - No imports: the bundle stays under 2 KiB. Intrinsics are captured when the module is evaluated (document_start).
// - Only own descriptors are read: realm.Navigator (data property holding a function) -> its own `prototype` (data).
//   No page getter, inherited field or accessor of the page is ever called.
// - A property that already exists on the prototype (native or set by someone else) is left untouched: 'present'.
// - Otherwise a plain accessor is defined: a named getter returning true, no setter, enumerable and configurable.
//   Nothing is masked (REQ-003): Function.prototype.toString, `name` and `length` of the getter stay as they are, so a
//   page can tell that the extension set it (said in the UI, REQ-014).
// - Never throws into the page: any failure (frozen prototype, missing interface) is 'failed'.

const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const defineProperty = Object.defineProperty;
const apply = Reflect.apply;
const hasOwnProperty = Object.prototype.hasOwnProperty;

export const GPC_PROPERTY = 'globalPrivacyControl';

export type GpcPropertyResult = 'present' | 'defined' | 'failed';

/** Value of an own data property of `object`, or undefined (accessors and inherited fields are never read). */
function ownData(object: object, key: string): unknown {
  const d = getOwnPropertyDescriptor(object, key);
  return d !== undefined && apply(hasOwnProperty, d, ['value']) === true ? d.value : undefined;
}

/**
 * The getter: a declaration (not a named function expression) so that the bundler's syntax minification keeps its
 * name. Its `name` and source stay visible to the page (no masking).
 */
function detectExpertGpcGetter(): boolean {
  return true;
}

/** Defines navigator.globalPrivacyControl (getter → true) on `realm.Navigator.prototype` unless it already exists. */
export function installGpcProperty(realm: object): GpcPropertyResult {
  try {
    const ctor = ownData(realm, 'Navigator');
    if (typeof ctor !== 'function') return 'failed';
    const proto = ownData(ctor, 'prototype');
    if (typeof proto !== 'object' || proto === null) return 'failed';
    if (getOwnPropertyDescriptor(proto, GPC_PROPERTY) !== undefined) return 'present';
    defineProperty(proto, GPC_PROPERTY, {
      __proto__: null,
      get: detectExpertGpcGetter,
      set: undefined,
      enumerable: true,
      configurable: true,
    } as unknown as PropertyDescriptor);
    return 'defined';
  } catch {
    return 'failed';
  }
}
