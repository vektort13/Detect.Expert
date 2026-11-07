import { isSanitizedHost } from './host';

export const PROTECTION_FEATURES = [
  'window-management', 'compute-pressure', 'idle-detection', 'local-fonts',
  'canvas-readback', 'webgl', 'webgpu', 'audio', 'webrtc', 'webassembly',
  'battery', 'network-information', 'keyboard', 'client-hints', 'clipboard-read',
] as const;
export type ProtectionFeature = (typeof PROTECTION_FEATURES)[number];
export type ProtectionPreset = 'limited' | 'strict' | 'custom';
export type ProtectionRuleState = 'allow' | 'block';
export const MAX_PROTECTION_SITES = 128;
export const PROTECTION_SETTINGS_KEY = 'protection:v1';
export const PROTECTION_PENDING_KEY = 'protection:pending:v1';
export const PROTECTION_CHANNEL = 'detect.expert/protection/v1';

export interface ProtectionObservation {
  feature: ProtectionFeature;
  installed: number;
  unavailable: number;
  removed: number;
  blocked: number;
  stopped: boolean;
}

export type ProtectionUiRequest =
  | { schemaVersion: 1; type: 'ui-protection-get'; tabId: number | null }
  | { schemaVersion: 1; type: 'ui-protection-set'; tabId: number | null; settings: ProtectionSettings }
  | { schemaVersion: 1; type: 'ui-protection-reload'; tabId: number; documentId: string };

export interface ProtectionState {
  schemaVersion: 1;
  type: 'protection-state';
  settings: ProtectionSettings;
  registration: 'ready' | 'inactive' | 'error';
  cleanupIncomplete: boolean;
  tabId: number | null;
  host: string | null;
  documentId: string | null;
  configured: ProtectionFeature[];
  observations: ProtectionObservation[];
  liveRead: 'received' | 'unavailable';
  integrity: 'page-controlled';
}

export type ProtectionErrorCode = 'invalid-request' | 'unauthorized-sender' | 'stale-revision' | 'stale-document' | 'storage-error' | 'no-access' | 'busy';
export type ProtectionResponse = ProtectionState | { schemaVersion: 1; type: 'protection-error'; code: ProtectionErrorCode };

export interface ProtectionRule {
  readonly feature: ProtectionFeature;
  readonly state: ProtectionRuleState;
}

export interface ProtectionSite {
  readonly host: string;
  readonly disabled: boolean;
  readonly rules: readonly ProtectionRule[];
}

export interface ProtectionSettings {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly enabled: boolean;
  readonly preset: ProtectionPreset;
  readonly global: readonly ProtectionRule[];
  readonly sites: readonly ProtectionSite[];
}

export const DEFAULT_PROTECTION_SETTINGS: ProtectionSettings = Object.freeze({
  schemaVersion: 1,
  revision: 0,
  enabled: false,
  preset: 'limited',
  global: Object.freeze([]),
  sites: Object.freeze([]),
});

const FEATURE_SET: ReadonlySet<string> = new Set(PROTECTION_FEATURES);
const LIMITED: readonly ProtectionFeature[] = ['window-management', 'compute-pressure', 'idle-detection', 'local-fonts'];
const STRICT: readonly ProtectionFeature[] = [
  ...LIMITED, 'canvas-readback', 'battery', 'network-information', 'keyboard', 'client-hints',
];

export function isProtectionHost(value: unknown): value is string {
  if (!isSanitizedHost(value)) return false;
  try {
    return new URL('https://' + value + '/').hostname === value;
  } catch {
    return false;
  }
}

function dataRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  if (Reflect.ownKeys(value).length !== keys.length) return null;
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
    result[key] = descriptor.value;
  }
  return result;
}

function readArray<Entry>(value: unknown, limit: number, read: (entry: unknown) => Entry | null): Entry[] | null {
  if (!Array.isArray(value)) return null;
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value as unknown;
  if (typeof length !== 'number' || !Number.isInteger(length) || length < 0 || length > limit) return null;
  const result: Entry[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
    const entry = read(descriptor.value);
    if (entry === null) return null;
    result.push(entry);
  }
  return result;
}

function readRules(value: unknown): ProtectionRule[] | null {
  const seen = new Set<string>();
  return readArray(value, PROTECTION_FEATURES.length, entry => {
    const record = dataRecord(entry, ['feature', 'state']);
    if (!record) return null;
    const feature = record['feature'];
    const state = record['state'];
    if (typeof feature !== 'string' || !FEATURE_SET.has(feature) || seen.has(feature)) return null;
    if (state !== 'allow' && state !== 'block') return null;
    seen.add(feature);
    return { feature: feature as ProtectionFeature, state };
  });
}

export function readProtectionSettings(value: unknown): ProtectionSettings | null {
  try {
    const record = dataRecord(value, ['schemaVersion', 'revision', 'enabled', 'preset', 'global', 'sites']);
    if (!record || record['schemaVersion'] !== 1) return null;
    const revision = record['revision'];
    const enabled = record['enabled'];
    const preset = record['preset'];
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) return null;
    if (typeof enabled !== 'boolean' || (preset !== 'limited' && preset !== 'strict' && preset !== 'custom')) return null;
    const global = readRules(record['global']);
    if (global === null) return null;
    const hosts = new Set<string>();
    const sites = readArray(record['sites'], MAX_PROTECTION_SITES, entry => {
      const site = dataRecord(entry, ['host', 'disabled', 'rules']);
      if (!site) return null;
      const host = site['host'];
      const disabled = site['disabled'];
      if (!isProtectionHost(host) || hosts.has(host) || typeof disabled !== 'boolean') return null;
      const rules = readRules(site['rules']);
      if (rules === null) return null;
      hosts.add(host);
      return { host, disabled, rules };
    });
    if (sites === null) return null;
    return { schemaVersion: 1, revision, enabled, preset, global, sites };
  } catch {
    return null;
  }
}

export function effectiveProtection(settings: ProtectionSettings, host: string | null): ProtectionFeature[] {
  if (!settings.enabled || !isProtectionHost(host)) return [];
  const site = settings.sites.find(entry => entry.host === host);
  if (site?.disabled) return [];
  const blocked = new Set<ProtectionFeature>(settings.preset === 'strict' ? STRICT : settings.preset === 'limited' ? LIMITED : []);
  for (const rule of [...settings.global, ...(site?.rules ?? [])]) {
    if (rule.state === 'block') blocked.add(rule.feature);
    else blocked.delete(rule.feature);
  }
  return PROTECTION_FEATURES.filter(feature => blocked.has(feature));
}

export function readProtectionObservations(value: unknown): ProtectionObservation[] | null {
  try {
    const seen = new Set<string>();
    return readArray(value, PROTECTION_FEATURES.length, entry => {
      const row = dataRecord(entry, ['feature', 'installed', 'unavailable', 'removed', 'blocked', 'stopped']);
      if (!row) return null;
      const feature = row['feature'];
      if (typeof feature !== 'string' || !FEATURE_SET.has(feature) || seen.has(feature) || typeof row['stopped'] !== 'boolean') return null;
      for (const key of ['installed', 'unavailable', 'removed', 'blocked']) {
        const count = row[key];
        if (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > (key === 'blocked' ? 65535 : 16)) return null;
      }
      if ((row['removed'] as number) > (row['installed'] as number)) return null;
      seen.add(feature);
      return { feature: feature as ProtectionFeature, installed: row['installed'] as number, unavailable: row['unavailable'] as number,
        removed: row['removed'] as number, blocked: row['blocked'] as number, stopped: row['stopped'] };
    });
  } catch { return null; }
}

export function readProtectionUiRequest(value: unknown): ProtectionUiRequest | null {
  try {
    if (typeof value !== 'object' || value === null) return null;
    const type = Object.getOwnPropertyDescriptor(value, 'type')?.value as unknown;
    const keys = type === 'ui-protection-set' ? ['schemaVersion', 'type', 'tabId', 'settings'] :
      type === 'ui-protection-reload' ? ['schemaVersion', 'type', 'tabId', 'documentId'] : ['schemaVersion', 'type', 'tabId'];
    const record = dataRecord(value, keys);
    if (!record || record['schemaVersion'] !== 1) return null;
    const tabId = record['tabId'];
    if (tabId !== null && (typeof tabId !== 'number' || !Number.isSafeInteger(tabId) || tabId < 0)) return null;
    if (type === 'ui-protection-get') return { schemaVersion: 1, type, tabId };
    if (type === 'ui-protection-set') {
      const settings = readProtectionSettings(record['settings']);
      return settings ? { schemaVersion: 1, type, tabId, settings } : null;
    }
    if (type === 'ui-protection-reload') {
      const documentId = record['documentId'];
      return tabId !== null && typeof documentId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(documentId)
        ? { schemaVersion: 1, type, tabId, documentId } : null;
    }
    return null;
  } catch { return null; }
}