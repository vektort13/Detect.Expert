// Sensor policy prelude (ADR-019, S11). The SW cannot hand MAIN a value synchronously at document_start, so it
// registers static files in front of the sensor bundle:
//   sensor-policy.js          beginSensorPolicy(window)       -> a fresh slot: the integer mask 0
//   sensor-off.<id>.js        markSensorOff(window, 1 << i)   -> mask |= bit  (one file per disabled family)
//   hook.early.js/hook.main.js takeSensorPolicy(window, n)    -> off mask, slot removed
// No imports: each prelude bundle stays tiny and never pulls the sensor runtime. Intrinsics are captured when the
// module is evaluated. W1: the slot holds a primitive (the mask), never an object, and is read through its own
// property descriptor only, so no page code runs: neither a planted accessor nor Proxy traps of a planted object
// (REQ-002, ADR-017 §2). Nothing here throws into the page.
// The slot is page-visible (Symbol.for) for the instant between the files; the page can plant or alter it. That
// is not a security boundary: the SW drops observations of disabled families itself (packages/background).

const KEY: symbol = Symbol.for('detect.expert/sensor-policy/v1');
const defineProperty = Object.defineProperty;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const deleteProperty = Reflect.deleteProperty;
const apply = Reflect.apply;
const hasOwnProperty = Object.prototype.hasOwnProperty;
const isInteger = Number.isInteger;

function own(o: object, key: string): boolean {
  return apply(hasOwnProperty, o, [key]) as boolean;
}

/** Defines the slot with the prelude's own shape: configurable, non-writable, non-enumerable data property. */
function writeSlot(realm: object, mask: number): void {
  defineProperty(realm, KEY, { __proto__: null, value: mask, writable: false, enumerable: false, configurable: true } as PropertyDescriptor);
}

/**
 * The slot's mask when the window property has exactly the prelude's shape (configurable, non-writable,
 * non-enumerable own data property) and holds a non-negative integer below 2^30; otherwise null. Reads only the
 * descriptor's own fields and a primitive value: never an accessor, never an object (W1).
 */
function slotMask(d: PropertyDescriptor | undefined): number | null {
  if (d === undefined || !own(d, 'value')) return null;
  if (d.configurable !== true || d.writable !== false || d.enumerable !== false) return null;
  const mask: unknown = d.value;
  if (typeof mask !== 'number' || !isInteger(mask) || mask < 0 || mask >= 2 ** 30) return null;
  return mask;
}

/** Starts a policy for this document: a fresh slot holding 0. */
export function beginSensorPolicy(realm: object): void {
  try {
    // A configurable property planted by the page (even an accessor) is replaced without calling it.
    writeSlot(realm, 0);
  } catch {
    // Non-configurable plant or sealed global: no slot, so the sensor installs nothing (fail closed).
  }
}

/** Sets `bit` in the current slot. Only a slot with the prelude's shape is changed; anything else is left alone. */
export function markSensorOff(realm: object, bit: number): void {
  try {
    if (!isInteger(bit) || bit <= 0) return;
    const mask = slotMask(getOwnPropertyDescriptor(realm, KEY));
    if (mask === null) return;
    writeSlot(realm, mask | bit);
  } catch {
    // Nothing to mark: the sensor bootstrap then finds no valid slot and installs nothing.
  }
}

/**
 * Reads the slot and removes it at once. Returns the off mask, or null when there is no usable slot: missing,
 * non-configurable (cannot be removed), an accessor, writable or enumerable (not the prelude's shape), a non-number
 * value (an object is never inspected), or a mask that is not an integer in [0, 2^count - 1]. Throws only if an
 * intrinsic was replaced before capture (the caller catches).
 */
export function takeSensorPolicy(realm: object, count: number): number | null {
  if (!isInteger(count) || count < 1 || count > 30) return null;
  const d = getOwnPropertyDescriptor(realm, KEY);
  if (d === undefined) return null;
  if (d.configurable !== true) return null;
  deleteProperty(realm, KEY);
  const mask = slotMask(d);
  if (mask === null) return null;
  const max = (1 << count) - 1;
  if (mask > max) return null;
  return mask;
}
