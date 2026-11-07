// ADR-026: bounded local evidence, not the current settings or proof of hardware availability.
import { COUNT_QUALITIES, PERMISSION_NAMES, type CountQuality, type PermissionName } from './enums';
import { MAX_COUNT } from './budgets';

export interface PermissionCheck {
  permission: PermissionName;
  kind: 'permission' | 'policy';
  result: 'granted' | 'denied' | 'prompt' | 'allowed' | 'blocked';
  count: number;
  countQuality: CountQuality;
}
export const MAX_PERMISSION_CHECKS = PERMISSION_NAMES.length * 5;
const names = new Set<string>(PERMISSION_NAMES);
const qualities = new Set<string>(COUNT_QUALITIES);
const keys = ['permission', 'kind', 'result', 'count', 'countQuality'];

/** Strict shape, paired kind/result, uniqueness and limits; never accepts a raw permission descriptor. */
export function readPermissionChecks(value: unknown): PermissionCheck[] | null {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
        value.length > MAX_PERMISSION_CHECKS || Reflect.ownKeys(value).length !== value.length + 1) return null;
    const out: PermissionCheck[] = [], seen = new Set<string>();
    for (let i = 0; i < value.length; i++) {
      const item = Object.getOwnPropertyDescriptor(value, String(i));
      if (!item || !Object.hasOwn(item, 'value')) return null;
      const row: unknown = item.value;
      if (typeof row !== 'object' || row === null || Array.isArray(row) ||
          Reflect.ownKeys(row).length !== keys.length) return null;
      const prototype: unknown = Object.getPrototypeOf(row);
      if (prototype !== Object.prototype && prototype !== null) return null;
      const values: unknown[] = [];
      for (const key of keys) {
        const field = Object.getOwnPropertyDescriptor(row, key);
        if (!field || !field.enumerable || !Object.hasOwn(field, 'value')) return null;
        values.push(field.value);
      }
      const [permission, kind, result, count, countQuality] = values;
      if (typeof permission !== 'string' || !names.has(permission) ||
          typeof countQuality !== 'string' || !qualities.has(countQuality) ||
          typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_COUNT) return null;
      if (!(kind === 'permission' && (result === 'granted' || result === 'denied' || result === 'prompt')) &&
          !(kind === 'policy' && (result === 'allowed' || result === 'blocked'))) return null;
      const key = permission + '|' + kind + '|' + result;
      if (seen.has(key)) return null;
      seen.add(key);
      out.push({ permission: permission as PermissionName, kind: kind as PermissionCheck['kind'],
        result: result as PermissionCheck['result'], count, countQuality: countQuality as CountQuality });
    }
    return out;
  } catch { return null; }
}
