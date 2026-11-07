import { BinaryReader, WireType } from '@bufbuild/protobuf/wire';
import type { CoverageState } from './enums';

export const GOOGLE_IDS_LIMITS = Object.freeze({ headerChars: 4096, rows: 8, ids: 256, documents: 8, pending: 32,
  documentBytes: 65536, ttlMs: 600000, navigationMs: 2000 });
export const GOOGLE_IDS_DOMAINS = Object.freeze([
  'google.com', 'google.co.uk', 'google.de', 'google.fr', 'google.es', 'google.it', 'google.ru', 'google.com.br',
  'google.co.jp', 'google.co.in', 'google.ca', 'google.com.au', 'youtube.com', 'doubleclick.net', 'doubleclick.com',
  'googlesyndication.com', 'googleadservices.com', 'googleapis.com', 'gstatic.com', 'googleusercontent.com',
  'googlevideo.com', 'ytimg.com', 'recaptcha.net',
]);

export interface GoogleIdsEntry {
  host: string;
  status: 'observed' | 'not-present' | 'unavailable' | 'too-large' | 'invalid';
  header: string | null;
}

export interface GoogleIdsRequest {
  schemaVersion: 1;
  type: 'ui-google-ids';
  tabId: number;
  frameId: number;
  documentKey: string;
}

export interface GoogleIdsState {
  schemaVersion: 1;
  type: 'google-ids-state';
  documentKey: string;
  evidenceSource: 'browser-network';
  integrity: 'browser-observed';
  coverageState: CoverageState;
  entries: GoogleIdsEntry[];
  truncated: boolean;
}

export interface ClientVariations {
  variationIds: number[];
  triggerVariationIds: number[];
  truncated: boolean;
  unknownFields: boolean;
}

export function isGoogleIdsHost(host: unknown): host is string {
  return typeof host === 'string' && host.length <= 253 && /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(host) &&
    GOOGLE_IDS_DOMAINS.some(domain => host === domain || host.endsWith('.' + domain));
}

export function isClientDataHeader(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > GOOGLE_IDS_LIMITS.headerChars || value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;
  try { return btoa(atob(value)) === value; } catch { return false; }
}

export function decodeClientData(value: unknown): ClientVariations | null {
  if (!isClientDataHeader(value)) return null;
  const result: ClientVariations = { variationIds: [], triggerVariationIds: [], truncated: false, unknownFields: false };
  try {
    const reader = new BinaryReader(Uint8Array.from(atob(value), character => character.charCodeAt(0)));
    let fields = 0;
    const append = (source: BinaryReader, target: number[]): boolean => {
      if (result.variationIds.length + result.triggerVariationIds.length >= GOOGLE_IDS_LIMITS.ids) {
        result.truncated = true;
        return false;
      }
      target.push(source.int32());
      return true;
    };
    while (reader.pos < reader.len) {
      if (++fields > 512) { result.truncated = true; return result; }
      const [field, wire] = reader.tag();
      if (field !== 1 && field !== 3) {
        if (wire === WireType.StartGroup || wire === WireType.EndGroup) return null;
        reader.skip(wire, field, 0);
        result.unknownFields = true;
        continue;
      }
      const target = field === 1 ? result.variationIds : result.triggerVariationIds;
      if (wire === WireType.Varint) { if (!append(reader, target)) return result; }
      else if (wire === WireType.LengthDelimited) {
        const packed = new BinaryReader(reader.bytes());
        while (packed.pos < packed.len) if (!append(packed, target)) return result;
      } else return null;
    }
    return result;
  } catch { return null; }
}

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

const nonNegative = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) &&
  !Object.is(value, -0) && value >= 0 && value <= 2147483647;
const documentKey = (value: unknown): value is string => typeof value === 'string' && /^\d{1,10}:\d{1,10}:[A-Za-z0-9_-]{1,64}$/.test(value);

export function readGoogleIdsRequest(value: unknown): GoogleIdsRequest | null {
  try {
    const record = fields(value, ['schemaVersion', 'type', 'tabId', 'frameId', 'documentKey']);
    if (!record || record['schemaVersion'] !== 1 || record['type'] !== 'ui-google-ids' || !nonNegative(record['tabId']) ||
      !nonNegative(record['frameId']) || !documentKey(record['documentKey']) ||
      !record['documentKey'].startsWith(record['tabId'] + ':' + record['frameId'] + ':')) return null;
    return { schemaVersion: 1, type: 'ui-google-ids', tabId: record['tabId'], frameId: record['frameId'], documentKey: record['documentKey'] };
  } catch { return null; }
}

export function googleIdsEntryBytes(entry: GoogleIdsEntry): number {
  return 256 + entry.host.length + (entry.header?.length ?? 0);
}

export function readGoogleIdsState(value: unknown): GoogleIdsState | null {
  try {
    const record = fields(value, ['schemaVersion', 'type', 'documentKey', 'evidenceSource', 'integrity', 'coverageState', 'entries', 'truncated']);
    if (!record || record['schemaVersion'] !== 1 || record['type'] !== 'google-ids-state' || !documentKey(record['documentKey']) ||
      record['evidenceSource'] !== 'browser-network' || record['integrity'] !== 'browser-observed' || typeof record['truncated'] !== 'boolean') return null;
    const coverage = record['coverageState'];
    if (coverage !== 'active' && coverage !== 'partial' && coverage !== 'late-start' && coverage !== 'paused' && coverage !== 'unsupported' &&
      coverage !== 'no-access' && coverage !== 'degraded') return null;
    const raw = record['entries'];
    if (!Array.isArray(raw) || raw.length > GOOGLE_IDS_LIMITS.rows || Reflect.ownKeys(raw).length !== raw.length + 1 ||
      (coverage === 'paused' || coverage === 'no-access' || coverage === 'unsupported') && raw.length > 0) return null;
    const entries: GoogleIdsEntry[] = [];
    let bytes = 512;
    for (let index = 0; index < raw.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(raw, index);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
      const row = fields(descriptor.value, ['host', 'status', 'header']);
      if (!row || !isGoogleIdsHost(row['host']) || entries.some(entry => entry.host === row['host'])) return null;
      const status = row['status'];
      if (status !== 'observed' && status !== 'not-present' && status !== 'unavailable' && status !== 'too-large' && status !== 'invalid') return null;
      if (status === 'observed' ? !isClientDataHeader(row['header']) : row['header'] !== null) return null;
      const entry: GoogleIdsEntry = { host: row['host'], status, header: status === 'observed' ? row['header'] as string : null };
      bytes += googleIdsEntryBytes(entry);
      if (bytes > GOOGLE_IDS_LIMITS.documentBytes) return null;
      entries.push(entry);
    }
    return { schemaVersion: 1, type: 'google-ids-state', documentKey: record['documentKey'], evidenceSource: 'browser-network',
      integrity: 'browser-observed', coverageState: coverage, entries, truncated: record['truncated'] };
  } catch { return null; }
}