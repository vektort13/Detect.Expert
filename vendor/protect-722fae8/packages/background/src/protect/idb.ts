// ADR-020 §8 (S04): the ONLY file of the extension that touches indexedDB (scripts/code-checks.mjs API ownership).
// Database `detect-expert-protect` v1, written by the service worker only. Operations run one at a time through a
// promise queue. An open or quota failure is retried once; a second failure makes storage `unavailable` with a 60 s
// cooldown (no endless retry). The database is opened only while the module is enabled; destroy() = deleteDatabase.

import type { Clock } from '../chrome-api';
import { PROTECT_DB_NAME, PROTECT_DB_SCHEMA, PROTECT_DB_VERSION, PROTECT_STORES, ProtectStorageError } from './db-port';
import type { ProtectDb, ProtectDbStatus, ProtectIterateOptions, ProtectKey, ProtectKeyRange, ProtectStoreName } from './db-port';

export const PROTECT_DB_COOLDOWN_MS = 60_000;
const DEFAULT_CHUNK = 512;
const MAX_CHUNK = 4096;

/** The browser's IndexedDB factory of this global (service worker), or null where none exists. Never throws. */
export function browserIdbFactory(): IDBFactory | null {
  try {
    const factory: unknown = (globalThis as { indexedDB?: unknown }).indexedDB;
    return typeof factory === 'object' && factory !== null ? (factory as IDBFactory) : null;
  } catch {
    return null;
  }
}

function requestDone<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new ProtectStorageError('request failed'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new ProtectStorageError('transaction aborted'));
    tx.onerror = () => reject(tx.error ?? new ProtectStorageError('transaction failed'));
  });
}

function isQuota(error: unknown): boolean {
  const name = typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined;
  return name === 'QuotaExceededError';
}

/** Creates every store and index of schema v1 (called from onupgradeneeded with oldVersion 0). */
export function createProtectSchema(db: Pick<IDBDatabase, 'createObjectStore' | 'objectStoreNames'>): void {
  for (const name of PROTECT_STORES) {
    if (db.objectStoreNames.contains(name)) continue;
    const schema = PROTECT_DB_SCHEMA[name];
    const store = db.createObjectStore(name, { keyPath: schema.keyPath });
    for (const index of schema.indexes) store.createIndex(index.name, index.keyPath, { unique: index.unique === true });
  }
}

export interface IdbProtectDbOptions {
  name?: string;
  cooldownMs?: number;
}

export class IdbProtectDb implements ProtectDb {
  private db: IDBDatabase | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private currentStatus: ProtectDbStatus = 'closed';
  private cooldownUntil = 0;
  private readonly name: string;
  private readonly cooldownMs: number;

  constructor(
    private readonly factory: () => IDBFactory | null,
    private readonly clock: Clock,
    options: IdbProtectDbOptions = {},
  ) {
    this.name = options.name ?? PROTECT_DB_NAME;
    this.cooldownMs = options.cooldownMs ?? PROTECT_DB_COOLDOWN_MS;
  }

  get status(): ProtectDbStatus {
    if (this.currentStatus === 'unavailable' && this.clock.now() >= this.cooldownUntil) return this.db === null ? 'closed' : 'open';
    return this.currentStatus;
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private openNow(): Promise<IDBDatabase> {
    const factory = this.factory();
    if (factory === null) return Promise.reject(new ProtectStorageError('indexeddb unavailable'));
    return new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try {
        request = factory.open(this.name, PROTECT_DB_VERSION);
      } catch (e) {
        reject(e);
        return;
      }
      request.onupgradeneeded = () => {
        try {
          createProtectSchema(request.result);
        } catch (e) {
          try { request.transaction?.abort(); } catch { /* the open request fails on its own */ }
          reject(e);
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        // Another context (a purge from an update, DevTools) may delete the database: let it, reopen lazily.
        db.onversionchange = () => {
          db.close();
          if (this.db === db) this.db = null;
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error ?? new ProtectStorageError('open failed'));
      request.onblocked = () => reject(new ProtectStorageError('open blocked'));
    });
  }

  /** Runs `task` on an open connection; one retry after an open/quota failure, then the cooldown. */
  private run<T>(task: (db: IDBDatabase) => Promise<T>): Promise<T> {
    return this.serialize(async () => {
      if (this.currentStatus === 'unavailable' && this.clock.now() < this.cooldownUntil) throw new ProtectStorageError('unavailable (cooldown)');
      for (let attempt = 0; ; attempt++) {
        try {
          if (this.db === null) this.db = await this.openNow();
          this.currentStatus = 'open';
          return await task(this.db);
        } catch (e) {
          const openFailed = this.db === null;
          if (!openFailed && !isQuota(e)) throw e;
          if (!openFailed) this.closeQuietly();
          if (attempt >= 1) {
            this.currentStatus = 'unavailable';
            this.cooldownUntil = this.clock.now() + this.cooldownMs;
            throw new ProtectStorageError(openFailed ? 'open failed' : 'quota');
          }
        }
      }
    });
  }

  private closeQuietly(): void {
    try { this.db?.close(); } catch { /* already closed */ }
    this.db = null;
  }

  async open(): Promise<boolean> {
    try {
      await this.run(async () => undefined);
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    this.closeQuietly();
    if (this.currentStatus === 'open') this.currentStatus = 'closed';
  }

  private range(range: ProtectKeyRange | null | undefined): IDBKeyRange | undefined {
    if (range === null || range === undefined) return undefined;
    const lower = range.lower as IDBValidKey | undefined;
    const upper = range.upper as IDBValidKey | undefined;
    if (lower !== undefined && upper !== undefined) return IDBKeyRange.bound(lower, upper, range.lowerOpen === true, range.upperOpen === true);
    if (lower !== undefined) return IDBKeyRange.lowerBound(lower, range.lowerOpen === true);
    if (upper !== undefined) return IDBKeyRange.upperBound(upper, range.upperOpen === true);
    return undefined;
  }

  get<T>(store: ProtectStoreName, key: ProtectKey): Promise<T | undefined> {
    return this.run(async (db) => {
      const tx = db.transaction(store, 'readonly');
      return (await requestDone(tx.objectStore(store).get(key as IDBValidKey))) as T | undefined;
    });
  }

  getMany<T>(store: ProtectStoreName, keys: readonly ProtectKey[]): Promise<Array<T | undefined>> {
    return this.run(async (db) => {
      const tx = db.transaction(store, 'readonly');
      const os = tx.objectStore(store);
      return (await Promise.all(keys.map((k) => requestDone(os.get(k as IDBValidKey))))) as Array<T | undefined>;
    });
  }

  put(store: ProtectStoreName, value: object): Promise<void> {
    return this.putMany(store, [value]);
  }

  putMany(store: ProtectStoreName, values: readonly object[]): Promise<void> {
    return this.run(async (db) => {
      const tx = db.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      for (const v of values) os.put(v);
      await transactionDone(tx);
    });
  }

  delete(store: ProtectStoreName, key: ProtectKey): Promise<void> {
    return this.run(async (db) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key as IDBValidKey);
      await transactionDone(tx);
    });
  }

  deleteWhere(store: ProtectStoreName, index: string | null, range: ProtectKeyRange): Promise<number> {
    return this.run(async (db) => {
      const tx = db.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      const source: IDBObjectStore | IDBIndex = index === null ? os : os.index(index);
      let deleted = 0;
      const cursorRequest = source.openKeyCursor(this.range(range));
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor === null) return;
        os.delete(cursor.primaryKey);
        deleted++;
        cursor.continue();
      };
      await transactionDone(tx);
      return deleted;
    });
  }

  async iterate<T>(store: ProtectStoreName, options: ProtectIterateOptions, visit: (records: T[]) => boolean | void | Promise<boolean | void>): Promise<number> {
    const chunk = Math.max(1, Math.min(MAX_CHUNK, options.chunk ?? DEFAULT_CHUNK));
    let after: { key: IDBValidKey; primaryKey: IDBValidKey } | null = null;
    let visited = 0;
    const cmp = (a: IDBValidKey, b: IDBValidKey): number => {
      const factory = this.factory();
      if (factory === null) throw new ProtectStorageError('indexeddb unavailable');
      return factory.cmp(a, b);
    };
    for (;;) {
      const resume = after;
      // Resume strictly after the last visited record: store keys are unique (open lower bound); index keys may repeat,
      // so the bound stays inclusive and records up to the last primary key of that index key are skipped.
      const base = options.range ?? {};
      const range: ProtectKeyRange = resume === null ? base : { ...base, lower: resume.key as ProtectKey, lowerOpen: options.index === undefined };
      const page = await this.run(async (db) => {
        const tx = db.transaction(store, 'readonly');
        const os = tx.objectStore(store);
        const source: IDBObjectStore | IDBIndex = options.index === undefined ? os : os.index(options.index);
        const records: T[] = [];
        // Assigned inside the cursor callback (control-flow analysis does not see that).
        let last = null as { key: IDBValidKey; primaryKey: IDBValidKey } | null;
        let more = false as boolean;
        const cursorRequest = source.openCursor(this.range(range));
        await new Promise<void>((resolve, reject) => {
          cursorRequest.onerror = () => reject(cursorRequest.error ?? new ProtectStorageError('cursor failed'));
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (cursor === null) { resolve(); return; }
            if (resume !== null && options.index !== undefined && cmp(cursor.key, resume.key) === 0 && cmp(cursor.primaryKey, resume.primaryKey) <= 0) { cursor.continue(); return; }
            if (records.length >= chunk) { more = true; resolve(); return; }
            records.push(cursor.value as T);
            last = { key: cursor.key, primaryKey: cursor.primaryKey };
            cursor.continue();
          };
        });
        return { records, last, more };
      });
      visited += page.records.length;
      if (page.records.length > 0 && (await visit(page.records)) === false) return visited;
      if (!page.more || page.last === null) return visited;
      after = page.last;
    }
  }

  count(store: ProtectStoreName, index?: string | null, range?: ProtectKeyRange | null): Promise<number> {
    return this.run(async (db) => {
      const tx = db.transaction(store, 'readonly');
      const os = tx.objectStore(store);
      const source: IDBObjectStore | IDBIndex = index === null || index === undefined ? os : os.index(index);
      return requestDone(source.count(this.range(range)));
    });
  }

  clear(store: ProtectStoreName): Promise<void> {
    return this.run(async (db) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).clear();
      await transactionDone(tx);
    });
  }

  destroy(): Promise<void> {
    return this.serialize(async () => {
      this.closeQuietly();
      const factory = this.factory();
      this.currentStatus = 'closed';
      this.cooldownUntil = 0;
      if (factory === null) return;
      await new Promise<void>((resolve, reject) => {
        const request = factory.deleteDatabase(this.name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error ?? new ProtectStorageError('delete failed'));
        // Blocked by another open connection: Chrome deletes it once that closes (onversionchange closes ours).
        request.onblocked = () => resolve();
      });
    });
  }

  async exists(): Promise<boolean | null> {
    const factory = this.factory();
    if (factory === null || typeof factory.databases !== 'function') return null;
    try {
      const list = await factory.databases();
      return list.some((d) => d.name === this.name);
    } catch {
      return null;
    }
  }
}
