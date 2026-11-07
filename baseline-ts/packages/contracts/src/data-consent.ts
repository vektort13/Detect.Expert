export const DATA_CONSENT_KEY = 'data-consent:v1';
export const DATA_CONSENT_PENDING_KEY = 'data-consent:pending-v1';
export const DATA_CONSENT_VERSION = 1;

export interface DataConsentState {
  schemaVersion: 1;
  type: 'data-consent-state';
  version: typeof DATA_CONSENT_VERSION;
  accepted: boolean;
}

export type DataConsentRequest = { schemaVersion: 1; type: 'ui-data-consent-get' } |
  { schemaVersion: 1; type: 'ui-data-consent-set'; version: typeof DATA_CONSENT_VERSION; accepted: boolean };

function fields(value: unknown, names: readonly string[]): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Reflect.ownKeys(value).length !== names.length) return null;
  const result = Object.create(null) as Record<string, unknown>;
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) return null;
    result[name] = descriptor.value;
  }
  return result;
}

export function readDataConsentRequest(value: unknown): DataConsentRequest | null {
  try {
    const short = fields(value, ['schemaVersion', 'type']);
    if (short?.['schemaVersion'] === 1 && short['type'] === 'ui-data-consent-get') return { schemaVersion: 1, type: 'ui-data-consent-get' };
    const record = fields(value, ['schemaVersion', 'type', 'version', 'accepted']);
    if (!record || record['schemaVersion'] !== 1 || record['type'] !== 'ui-data-consent-set' || record['version'] !== DATA_CONSENT_VERSION ||
      typeof record['accepted'] !== 'boolean') return null;
    return { schemaVersion: 1, type: 'ui-data-consent-set', version: DATA_CONSENT_VERSION, accepted: record['accepted'] };
  } catch { return null; }
}

export function readDataConsentState(value: unknown): DataConsentState | null {
  try {
    const record = fields(value, ['schemaVersion', 'type', 'version', 'accepted']);
    if (!record || record['schemaVersion'] !== 1 || record['type'] !== 'data-consent-state' || record['version'] !== DATA_CONSENT_VERSION ||
      typeof record['accepted'] !== 'boolean') return null;
    return { schemaVersion: 1, type: 'data-consent-state', version: DATA_CONSENT_VERSION, accepted: record['accepted'] };
  } catch { return null; }
}

export function storedDataConsent(value: unknown): boolean {
  try {
    const record = fields(value, ['version', 'accepted']);
    return record?.['version'] === DATA_CONSENT_VERSION && record['accepted'] === true;
  } catch { return false; }
}