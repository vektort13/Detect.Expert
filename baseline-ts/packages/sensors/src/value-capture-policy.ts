// ADR-066: public presence is a one-way veto, never authority to capture values.
// All decisions, aliases and cleanup callbacks remain in module-private state.
const marker = Symbol.for('detect.expert/api-custom/value-capture-deny/v1');
const descriptor = Object.getOwnPropertyDescriptor;
const extensible = Object.isExtensible;
const define = Object.defineProperty;
const apply = Reflect.apply;
const NativeWeakMap = WeakMap, NativeWeakSet = WeakSet;
const get = WeakMap.prototype.get, set = WeakMap.prototype.set;
const has = WeakSet.prototype.has, add = WeakSet.prototype.add;
interface Policy { realms: object[]; known: WeakSet<object>; denied: boolean; callbacks: Array<() => void> }
const policies = new NativeWeakMap<object, Policy>();
function policy(owner: object): Policy {
  let value = apply(get, policies, [owner]) as Policy | undefined;
  if (!value) { value = { realms: [], known: new NativeWeakSet<object>(), denied: false, callbacks: [] }; apply(set, policies, [owner, value]); }
  return value;
}
function deny(value: Policy): void {
  if (value.denied) return;
  value.denied = true;
  value.realms.length = 0;
  const callbacks = value.callbacks; value.callbacks = [];
  for (let index = 0; index < callbacks.length; index++) try { callbacks[index]!(); } catch { /* A veto cannot affect page execution. */ }
}
export function bindValueCapturePolicy(alias: object, owner: object): void { apply(set, policies, [alias, policy(owner)]); }
export function registerValueCaptureRealm(owner: object, realm: object): void {
  const value = policy(owner);
  if (value.denied) return;
  try {
    if (!realm || typeof realm !== 'object' && typeof realm !== 'function' || !extensible(realm)) { deny(value); return; }
    if (!apply(has, value.known, [realm])) {
      if (value.realms.length >= 1024) { deny(value); return; }
      apply(add, value.known, [realm]); define(value.realms, value.realms.length, { __proto__: null, value: realm, writable: true, configurable: true, enumerable: true } as PropertyDescriptor);
    }
    if (descriptor(realm, marker) !== undefined) deny(value);
  } catch { deny(value); }
}
export function valueCaptureDenied(owner: object): boolean {
  const value = policy(owner);
  if (value.denied) return true;
  try {
    for (let index = 0; index < value.realms.length; index++) {
      const realm = value.realms[index]!;
      if (!extensible(realm) || descriptor(realm, marker) !== undefined) { deny(value); return true; }
    }
  } catch { deny(value); return true; }
  return false;
}
export function onValueCaptureDenied(owner: object, cleanup: () => void): void {
  const value = policy(owner);
  if (valueCaptureDenied(owner)) { try { cleanup(); } catch {} return; }
  if (value.callbacks.length >= 8) { deny(value); try { cleanup(); } catch {} return; }
  define(value.callbacks, value.callbacks.length, { __proto__: null, value: cleanup, writable: true, configurable: true, enumerable: true } as PropertyDescriptor);
}
