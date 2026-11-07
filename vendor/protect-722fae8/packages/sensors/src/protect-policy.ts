// MAIN prelude of the module «Защита» (ADR-020 §10, S05): the ADR-019 slot scheme (packages/sensors/src/policy.ts)
// under its own key. The SW cannot hand MAIN a value synchronously at document_start, so detector-protect-main-v1
// carries static files in front of protect.main.js:
//   protect-policy.js          beginProtectPolicy(window)          -> a fresh slot: the integer mask 0
//   protect-on.<group>.js      markProtectGroupOn(window, 1 << i)  -> mask |= bit (one file per ENABLED group)
//   protect.main.js            takeProtectPolicy(window, n)        -> enabled-group mask, slot removed
// Unlike the sensor policy (an OFF mask), this is an ON mask and fails closed: no valid record -> 0 -> no hooks.
// No imports: the prelude bundles stay tiny (< 2 KiB) and never pull the module runtime. Intrinsics are captured when
// the module is evaluated. The slot holds a primitive (the mask), never an object, and is read through its own
// property descriptor only, so no page code runs: neither a planted accessor nor Proxy traps (REQ-002). Nothing here
// throws into the page. The slot is page-visible (Symbol.for) for the instant between the files; the page can plant
// or alter it. That is not a security boundary: everything MAIN sends is page-controlled (REQ-004) and the SW knows
// which groups it enabled for the document.

const KEY: symbol = Symbol.for('detect.expert/protect-policy/v1');
const defineProperty = Object.defineProperty;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const deleteProperty = Reflect.deleteProperty;
const apply = Reflect.apply;
const hasOwnProperty = Object.prototype.hasOwnProperty;
const isInteger = Number.isInteger;
/** Upper bound of the group count (bits of a small integer mask). */
const MAX_GROUPS = 30;

function own(o: object, key: string): boolean {
  return apply(hasOwnProperty, o, [key]) as boolean;
}

/** Defines the slot with the prelude's own shape: configurable, non-writable, non-enumerable data property. */
function writeSlot(realm: object, mask: number): void {
  defineProperty(realm, KEY, { __proto__: null, value: mask, writable: false, enumerable: false, configurable: true } as PropertyDescriptor);
}

/**
 * The slot's mask when the property has exactly the prelude's shape (configurable, non-writable, non-enumerable own
 * data property) and holds a non-negative integer below 2^30; otherwise null. Reads only the descriptor's own fields
 * and a primitive value: never an accessor, never an object.
 */
function slotMask(d: PropertyDescriptor | undefined): number | null {
  if (d === undefined || !own(d, 'value')) return null;
  if (d.configurable !== true || d.writable !== false || d.enumerable !== false) return null;
  const mask: unknown = d.value;
  if (typeof mask !== 'number' || !isInteger(mask) || mask < 0 || mask >= 2 ** MAX_GROUPS) return null;
  return mask;
}

/** Starts a group record for this document: a fresh slot holding 0 (no group enabled yet). */
export function beginProtectPolicy(realm: object): void {
  try {
    // A configurable property planted by the page (even an accessor) is replaced without calling it.
    writeSlot(realm, 0);
  } catch {
    // Non-configurable plant or sealed global: no slot, so protect.main.js installs nothing (fail closed).
  }
}

/** Sets `bit` of an enabled group in the current slot. Only a slot with the prelude's shape is changed. */
export function markProtectGroupOn(realm: object, bit: number): void {
  try {
    if (!isInteger(bit) || bit <= 0 || bit >= 2 ** MAX_GROUPS) return;
    const mask = slotMask(getOwnPropertyDescriptor(realm, KEY));
    if (mask === null) return;
    writeSlot(realm, mask | bit);
  } catch {
    // Nothing to mark: protect.main.js then finds no enabled group and installs nothing.
  }
}

/**
 * Reads the slot and removes it at once. Returns the enabled-group mask; 0 when there is no usable record (fail
 * closed): missing, non-configurable (cannot be removed), an accessor, writable or enumerable (not the prelude's
 * shape), a non-number value (an object is never inspected), or a mask that is not an integer in
 * [0, 2^groupCount - 1]. A valid record without any group is 0 as well. Never throws.
 */
export function takeProtectPolicy(realm: object, groupCount: number): number {
  try {
    if (!isInteger(groupCount) || groupCount < 1 || groupCount > MAX_GROUPS) return 0;
    const d = getOwnPropertyDescriptor(realm, KEY);
    if (d === undefined || d.configurable !== true) return 0;
    deleteProperty(realm, KEY);
    const mask = slotMask(d);
    if (mask === null) return 0;
    const max = 2 ** groupCount - 1;
    return mask > max ? 0 : mask;
  } catch {
    return 0;
  }
}
