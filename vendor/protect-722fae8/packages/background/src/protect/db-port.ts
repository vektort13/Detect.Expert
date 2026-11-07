// ADR-020 §8 (S04): storage port of the module «Защита». The only implementation over the browser is idb.ts (the only
// file that touches indexedDB); unit tests use test/protect/memory-db.ts. Records hold domains, days, enums and
// numbers only — never a value, hash, URL or query. Schema v1 creates every store at once; lanes never bump the version.

export const PROTECT_DB_NAME = 'detect-expert-protect';
export const PROTECT_DB_VERSION = 1;

export const PROTECT_STORES = ['meta', 'exclusions', 'decisions', 'sightings', 'receivers', 'sites', 'requests'] as const;
export type ProtectStoreName = (typeof PROTECT_STORES)[number];

export interface ProtectIndexSchema {
  name: string;
  keyPath: string | string[];
  unique?: boolean;
}

export interface ProtectStoreSchema {
  keyPath: string | string[];
  indexes: readonly ProtectIndexSchema[];
}

/**
 * Schema v1 (ADR-020 §8): meta (key), exclusions (site), decisions (decisionKey; bySiteReceiver unique, byReceiver,
 * bySlot), sightings ([receiver, site]; byReceiver, bySite, byLastDay), receivers (receiver; byLastDay), sites (site;
 * byLastDay), requests (requestId; byStatusDay).
 */
export const PROTECT_DB_SCHEMA: Readonly<Record<ProtectStoreName, ProtectStoreSchema>> = {
  meta: { keyPath: 'key', indexes: [] },
  exclusions: { keyPath: 'site', indexes: [] },
  decisions: {
    keyPath: 'decisionKey',
    indexes: [
      { name: 'bySiteReceiver', keyPath: ['site', 'receiver'], unique: true },
      { name: 'byReceiver', keyPath: 'receiver' },
      { name: 'bySlot', keyPath: 'slot' },
    ],
  },
  sightings: {
    keyPath: ['receiver', 'site'],
    indexes: [
      { name: 'byReceiver', keyPath: 'receiver' },
      { name: 'bySite', keyPath: 'site' },
      { name: 'byLastDay', keyPath: 'lastDay' },
    ],
  },
  receivers: { keyPath: 'receiver', indexes: [{ name: 'byLastDay', keyPath: 'lastDay' }] },
  sites: { keyPath: 'site', indexes: [{ name: 'byLastDay', keyPath: 'lastDay' }] },
  requests: { keyPath: 'requestId', indexes: [{ name: 'byStatusDay', keyPath: ['status', 'statusDay'] }] },
};

/** IndexedDB key subset the module uses: numbers, strings and arrays of them. */
export type ProtectKey = number | string | readonly ProtectKey[];

/** Key range (both bounds optional; `{lower: k, upper: k}` = only k). */
export interface ProtectKeyRange {
  lower?: ProtectKey;
  upper?: ProtectKey;
  lowerOpen?: boolean;
  upperOpen?: boolean;
}

export interface ProtectIterateOptions {
  index?: string;
  range?: ProtectKeyRange;
  /** Records per transaction (default 512, ADR-020 purgeChunk). */
  chunk?: number;
}

/** 'closed' = not open (module off, or destroyed); 'unavailable' = open or quota failure, cooldown running. */
export type ProtectDbStatus = 'closed' | 'open' | 'unavailable';

export class ProtectStorageError extends Error {
  constructor(reason: string) {
    super('protect-storage: ' + reason);
    this.name = 'ProtectStorageError';
  }
}

export interface ProtectDb {
  readonly status: ProtectDbStatus;
  /** Opens (creating schema v1) when needed. False when storage is unavailable (no throw). */
  open(): Promise<boolean>;
  /** Closes the connection; the next operation reopens it. */
  close(): void;
  get<T>(store: ProtectStoreName, key: ProtectKey): Promise<T | undefined>;
  getMany<T>(store: ProtectStoreName, keys: readonly ProtectKey[]): Promise<Array<T | undefined>>;
  put(store: ProtectStoreName, value: object): Promise<void>;
  putMany(store: ProtectStoreName, values: readonly object[]): Promise<void>;
  delete(store: ProtectStoreName, key: ProtectKey): Promise<void>;
  /** Deletes the records of `store` (or of its `index`) in `range`; returns how many were deleted. */
  deleteWhere(store: ProtectStoreName, index: string | null, range: ProtectKeyRange): Promise<number>;
  /**
   * Visits records in key (or index) order, `chunk` per transaction; `visit` returning false stops. Returns the
   * number of visited records.
   */
  iterate<T>(store: ProtectStoreName, options: ProtectIterateOptions, visit: (records: T[]) => boolean | void | Promise<boolean | void>): Promise<number>;
  count(store: ProtectStoreName, index?: string | null, range?: ProtectKeyRange | null): Promise<number>;
  clear(store: ProtectStoreName): Promise<void>;
  /** Closes and deletes the whole database (purge). */
  destroy(): Promise<void>;
  /** Whether the database exists without opening (creating) it; null when the browser cannot tell. */
  exists(): Promise<boolean | null>;
}

const TYPE_RANK = (k: ProtectKey): number => (typeof k === 'number' ? 0 : typeof k === 'string' ? 1 : 2);

/** IndexedDB key order for the subset above: number < string < array; arrays element-wise, then by length. */
export function compareProtectKeys(a: ProtectKey, b: ProtectKey): number {
  const ra = TYPE_RANK(a);
  const rb = TYPE_RANK(b);
  if (ra !== rb) return ra - rb;
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  const xa = a as readonly ProtectKey[];
  const xb = b as readonly ProtectKey[];
  for (let i = 0; i < Math.min(xa.length, xb.length); i++) {
    const c = compareProtectKeys(xa[i]!, xb[i]!);
    if (c !== 0) return c;
  }
  return xa.length - xb.length;
}

/** True when `key` lies in `range`. */
export function keyInRange(key: ProtectKey, range: ProtectKeyRange | null | undefined): boolean {
  if (range === null || range === undefined) return true;
  if (range.lower !== undefined) {
    const c = compareProtectKeys(key, range.lower);
    if (c < 0 || (c === 0 && range.lowerOpen === true)) return false;
  }
  if (range.upper !== undefined) {
    const c = compareProtectKeys(key, range.upper);
    if (c > 0 || (c === 0 && range.upperOpen === true)) return false;
  }
  return true;
}

/** Key range of every string key starting with `prefix` (meta keys of one lane, e.g. 'history-'). */
export function prefixRange(prefix: string): ProtectKeyRange {
  return { lower: prefix, upper: prefix + '￿' };
}

/** Value of `keyPath` in `record`, or undefined when a component is not a valid key (the record is not indexed). */
export function keyOf(record: unknown, keyPath: string | readonly string[]): ProtectKey | undefined {
  if (typeof record !== 'object' || record === null) return undefined;
  const r = record as Record<string, unknown>;
  const one = (path: string): ProtectKey | undefined => {
    const v = r[path];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') return v;
    return undefined;
  };
  if (typeof keyPath === 'string') return one(keyPath);
  const out: ProtectKey[] = [];
  for (const p of keyPath) {
    const v = one(p);
    if (v === undefined) return undefined;
    out.push(v);
  }
  return out;
}
