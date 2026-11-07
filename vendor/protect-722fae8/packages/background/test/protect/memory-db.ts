// In-memory ProtectDb for unit tests (ADR-020 S04): the same schema, key order and index semantics as idb.ts, plus fault
// injection. Test-only; never bundled.

import {
  PROTECT_DB_SCHEMA,
  PROTECT_STORES,
  ProtectStorageError,
  compareProtectKeys,
  keyInRange,
  keyOf,
} from '../../src/protect/db-port';
import type { ProtectDb, ProtectDbStatus, ProtectIterateOptions, ProtectKey, ProtectKeyRange, ProtectStoreName } from '../../src/protect/db-port';

function clone<T>(v: T): T {
  return structuredClone(v);
}

export class MemoryProtectDb implements ProtectDb {
  readonly stores = new Map<ProtectStoreName, Map<string, { key: ProtectKey; value: object }>>();
  status: ProtectDbStatus = 'closed';
  opens = 0;
  destroyed = 0;
  ops = 0;
  /** The next N operations (open included) fail like an unavailable IndexedDB. */
  failNext = 0;
  /** Database exists on "disk" (survives close; destroy removes it). */
  created = false;

  private ensureOpen(): void {
    if (this.failNext > 0) {
      this.failNext--;
      this.status = 'unavailable';
      throw new ProtectStorageError('unavailable (fake)');
    }
    if (this.status !== 'open') {
      this.opens++;
      this.status = 'open';
      if (!this.created) {
        this.created = true;
        for (const name of PROTECT_STORES) this.stores.set(name, new Map());
      }
    }
    this.ops++;
  }

  private store(name: ProtectStoreName): Map<string, { key: ProtectKey; value: object }> {
    const s = this.stores.get(name);
    if (s === undefined) throw new ProtectStorageError('no store ' + name);
    return s;
  }

  private sorted(name: ProtectStoreName, index: string | undefined | null, range: ProtectKeyRange | null | undefined): Array<{ key: ProtectKey; primary: ProtectKey; value: object }> {
    const schema = PROTECT_DB_SCHEMA[name];
    const keyPath = index === undefined || index === null ? schema.keyPath : schema.indexes.find((i) => i.name === index)?.keyPath;
    if (keyPath === undefined) throw new ProtectStorageError('no index ' + String(index));
    const out: Array<{ key: ProtectKey; primary: ProtectKey; value: object }> = [];
    for (const e of this.store(name).values()) {
      const k = keyOf(e.value, keyPath);
      if (k === undefined || !keyInRange(k, range)) continue;
      out.push({ key: k, primary: e.key, value: e.value });
    }
    out.sort((a, b) => compareProtectKeys(a.key, b.key) || compareProtectKeys(a.primary, b.primary));
    return out;
  }

  async open(): Promise<boolean> {
    try {
      this.ensureOpen();
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    if (this.status === 'open') this.status = 'closed';
  }

  async get<T>(store: ProtectStoreName, key: ProtectKey): Promise<T | undefined> {
    this.ensureOpen();
    const e = this.store(store).get(JSON.stringify(key));
    return e === undefined ? undefined : (clone(e.value) as T);
  }

  async getMany<T>(store: ProtectStoreName, keys: readonly ProtectKey[]): Promise<Array<T | undefined>> {
    const out: Array<T | undefined> = [];
    for (const k of keys) out.push(await this.get<T>(store, k));
    return out;
  }

  async put(store: ProtectStoreName, value: object): Promise<void> {
    await this.putMany(store, [value]);
  }

  async putMany(store: ProtectStoreName, values: readonly object[]): Promise<void> {
    this.ensureOpen();
    const schema = PROTECT_DB_SCHEMA[store];
    const target = this.store(store);
    for (const v of values) {
      const key = keyOf(v, schema.keyPath);
      if (key === undefined) throw new ProtectStorageError('invalid key');
      for (const index of schema.indexes) {
        if (index.unique !== true) continue;
        const ik = keyOf(v, index.keyPath);
        if (ik === undefined) continue;
        for (const e of target.values()) {
          const other = keyOf(e.value, index.keyPath);
          if (other !== undefined && compareProtectKeys(other, ik) === 0 && compareProtectKeys(e.key, key) !== 0) throw new ProtectStorageError('ConstraintError');
        }
      }
      target.set(JSON.stringify(key), { key, value: clone(v) });
    }
  }

  async delete(store: ProtectStoreName, key: ProtectKey): Promise<void> {
    this.ensureOpen();
    this.store(store).delete(JSON.stringify(key));
  }

  async deleteWhere(store: ProtectStoreName, index: string | null, range: ProtectKeyRange): Promise<number> {
    this.ensureOpen();
    const hits = this.sorted(store, index, range);
    for (const h of hits) this.store(store).delete(JSON.stringify(h.primary));
    return hits.length;
  }

  async iterate<T>(store: ProtectStoreName, options: ProtectIterateOptions, visit: (records: T[]) => boolean | void | Promise<boolean | void>): Promise<number> {
    this.ensureOpen();
    const chunk = Math.max(1, options.chunk ?? 512);
    const all = this.sorted(store, options.index, options.range);
    let visited = 0;
    for (let i = 0; i < all.length; i += chunk) {
      const page = all.slice(i, i + chunk).map((e) => clone(e.value) as T);
      visited += page.length;
      if ((await visit(page)) === false) break;
    }
    return visited;
  }

  async count(store: ProtectStoreName, index?: string | null, range?: ProtectKeyRange | null): Promise<number> {
    this.ensureOpen();
    return this.sorted(store, index, range).length;
  }

  async clear(store: ProtectStoreName): Promise<void> {
    this.ensureOpen();
    this.store(store).clear();
  }

  async destroy(): Promise<void> {
    this.destroyed++;
    this.status = 'closed';
    this.created = false;
    this.stores.clear();
  }

  async exists(): Promise<boolean | null> {
    return this.created;
  }
}
