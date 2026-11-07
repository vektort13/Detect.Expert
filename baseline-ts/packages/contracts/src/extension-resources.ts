import { EXTENSION_TARGET_IDS } from './extension-targets.generated';
import { BUDGETS, MAX_COUNT } from './budgets';
import { COUNT_QUALITIES } from './enums';
import type { CountQuality, Phase, TechniqueId } from './enums';

export { EXTENSION_TARGET_IDS } from './extension-targets.generated';
export const EXTENSION_TARGET_KEYS = ['unknown', ...EXTENSION_TARGET_IDS] as const;
export const EXTENSION_RESOURCE_METHODS = ['fetch', 'xhr-send', 'image-src', 'script-src'] as const;
export type ExtensionTarget = typeof EXTENSION_TARGET_KEYS[number];
export type ExtensionResourceMethod = typeof EXTENSION_RESOURCE_METHODS[number];
export interface ExtensionResource { target: ExtensionTarget; method: ExtensionResourceMethod }
export interface ExtensionResourceSummary extends ExtensionResource { phase: Phase; count: number; countQuality: CountQuality }

const apply = Reflect.apply;
const mapGet = Map.prototype.get;
const targets = new Map<string, number>(EXTENSION_TARGET_KEYS.map((target, index) => [target, index]));
export function extensionTargetIndex(target: unknown): number | null {
  if (typeof target !== 'string' || target.length > 32) return null;
  return apply(mapGet, targets, [target]) as number | undefined ?? null;
}

export function extensionResourceAllows(resource: ExtensionResource, techniqueId: TechniqueId, phase: Phase): boolean {
  return techniqueId === 'DET-059' && (phase === 'threw-sync' || phase ===
    (resource.method === 'fetch' || resource.method === 'xhr-send' ? 'settlement-unobserved' : 'returned-sync'));
}

export function readExtensionResource(value: unknown): ExtensionResource | null {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value) || Reflect.ownKeys(value).length !== 2) return null;
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const target = Object.getOwnPropertyDescriptor(value, 'target'), method = Object.getOwnPropertyDescriptor(value, 'method');
    if (!target?.enumerable || !method?.enumerable || !Object.hasOwn(target, 'value') || !Object.hasOwn(method, 'value') ||
        extensionTargetIndex(target.value) === null || !EXTENSION_RESOURCE_METHODS.includes(method.value as ExtensionResourceMethod)) return null;
    return { target: target.value as ExtensionTarget, method: method.value as ExtensionResourceMethod };
  } catch { return null; }
}

export function readExtensionResources(value: unknown): ExtensionResourceSummary[] | null {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > BUDGETS.maxCountersPerDocumentGroup ||
        Reflect.ownKeys(value).length !== value.length + 1) return null;
    const result: ExtensionResourceSummary[] = [], seen = new Set<string>();
    for (let index = 0; index < value.length; index++) {
      const item = Object.getOwnPropertyDescriptor(value, String(index));
      if (!item?.enumerable || !Object.hasOwn(item, 'value')) return null;
      const row: unknown = item.value;
      if (typeof row !== 'object' || row === null || Reflect.ownKeys(row).length !== 5) return null;
      const prototype: unknown = Object.getPrototypeOf(row);
      if (prototype !== Object.prototype && prototype !== null) return null;
      const fields: unknown[] = [];
      for (const key of ['target', 'method', 'phase', 'count', 'countQuality']) {
        const field = Object.getOwnPropertyDescriptor(row, key);
        if (!field?.enumerable || !Object.hasOwn(field, 'value')) return null;
        fields.push(field.value);
      }
      const [target, method, phase, count, countQuality] = fields;
      const resource = readExtensionResource({ target, method });
      if (!resource || !extensionResourceAllows(resource, 'DET-059', phase as Phase) ||
          typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_COUNT ||
          !COUNT_QUALITIES.includes(countQuality as CountQuality)) return null;
      const key = resource.target + '|' + resource.method + '|' + String(phase);
      if (seen.has(key)) return null;
      seen.add(key); result.push({ ...resource, phase: phase as Phase, count, countQuality: countQuality as CountQuality });
    }
    return result;
  } catch { return null; }
}