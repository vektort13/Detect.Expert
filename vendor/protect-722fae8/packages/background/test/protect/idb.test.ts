// idb.ts is the only owner of indexedDB; Node has none, so these tests drive it with minimal fake factories (schema
// creation, open failure → one retry → cooldown, deleteDatabase). Data operations run against MemoryProtectDb in the
// controller tests and against Chrome in the e2e of the lanes.

import { describe, expect, it } from 'vitest';
import { PROTECT_DB_NAME, PROTECT_DB_SCHEMA, PROTECT_STORES, compareProtectKeys, keyInRange, keyOf, prefixRange } from '../../src/protect/db-port';
import { IdbProtectDb, browserIdbFactory, createProtectSchema } from '../../src/protect/idb';
import { makeClock } from './support';

interface FakeRequest {
  result?: unknown;
  error?: unknown;
  onsuccess: null | (() => void);
  onerror: null | (() => void);
  onupgradeneeded?: null | (() => void);
  onblocked?: null | (() => void);
}

function factory(behaviour: { openFails: boolean }) {
  const calls = { open: 0, deleted: [] as string[] };
  const f = {
    open(name: string, version: number) {
      calls.open++;
      const req: FakeRequest = { onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
      setTimeout(() => {
        if (behaviour.openFails) {
          req.error = new Error('UnknownError');
          req.onerror?.();
        } else {
          req.result = { close() {}, onversionchange: null, name, version };
          req.onsuccess?.();
        }
      }, 0);
      return req;
    },
    deleteDatabase(name: string) {
      calls.deleted.push(name);
      const req: FakeRequest = { onsuccess: null, onerror: null };
      setTimeout(() => req.onsuccess?.(), 0);
      return req;
    },
    async databases() {
      return [{ name: PROTECT_DB_NAME, version: 1 }];
    },
    cmp(a: unknown, b: unknown) {
      return compareProtectKeys(a as string, b as string);
    },
  };
  return { factory: f as unknown as IDBFactory, calls };
}

describe('IndexedDB schema v1 (ADR-020 §8)', () => {
  it('creates every store and index at once', () => {
    const created: Array<{ store: string; keyPath: unknown; indexes: Array<[string, unknown, boolean]> }> = [];
    const db = {
      objectStoreNames: { contains: () => false },
      createObjectStore(name: string, options: { keyPath: unknown }) {
        const entry = { store: name, keyPath: options.keyPath, indexes: [] as Array<[string, unknown, boolean]> };
        created.push(entry);
        return { createIndex: (n: string, kp: unknown, o: { unique: boolean }) => entry.indexes.push([n, kp, o.unique]) };
      },
    };
    createProtectSchema(db as never);
    expect(created.map((c) => c.store)).toEqual([...PROTECT_STORES]);
    expect(created.find((c) => c.store === 'decisions')).toEqual({ store: 'decisions', keyPath: 'decisionKey', indexes: [['bySiteReceiver', ['site', 'receiver'], true], ['byReceiver', 'receiver', false], ['bySlot', 'slot', false]] });
    expect(created.find((c) => c.store === 'sightings')?.keyPath).toEqual(['receiver', 'site']);
    expect(created.find((c) => c.store === 'requests')?.indexes).toEqual([['byStatusDay', ['status', 'statusDay'], false]]);
    expect(Object.keys(PROTECT_DB_SCHEMA)).toEqual([...PROTECT_STORES]);
  });
});

describe('IdbProtectDb availability', () => {
  it('open failure: one retry, then unavailable with a 60 s cooldown (no endless retry)', async () => {
    const clock = makeClock();
    const { factory: f, calls } = factory({ openFails: true });
    const db = new IdbProtectDb(() => f, clock);
    expect(await db.open()).toBe(false);
    expect(calls.open).toBe(2);
    expect(db.status).toBe('unavailable');
    await expect(db.get('meta', 'x')).rejects.toThrow('cooldown');
    expect(calls.open).toBe(2);
    clock.t += 60_000;
    expect(db.status).toBe('closed');
    expect(await db.open()).toBe(false);
    expect(calls.open).toBe(4);
  });

  it('opens once and stays open; destroy closes and deletes the database', async () => {
    const { factory: f, calls } = factory({ openFails: false });
    const db = new IdbProtectDb(() => f, makeClock());
    expect(await db.open()).toBe(true);
    expect(await db.open()).toBe(true);
    expect(calls.open).toBe(1);
    expect(db.status).toBe('open');
    expect(await db.exists()).toBe(true);
    await db.destroy();
    expect(calls.deleted).toEqual([PROTECT_DB_NAME]);
    expect(db.status).toBe('closed');
  });

  it('no factory (Node, or a browser without IndexedDB): unavailable, never throws on open', async () => {
    expect(browserIdbFactory()).toBeNull();
    const db = new IdbProtectDb(() => null, makeClock());
    expect(await db.open()).toBe(false);
    expect(await db.exists()).toBeNull();
  });
});

describe('key helpers (IndexedDB order)', () => {
  it('number < string < array; arrays element-wise; ranges and prefixes', () => {
    expect(compareProtectKeys(5, 'a')).toBeLessThan(0);
    expect(compareProtectKeys('b', ['a'])).toBeLessThan(0);
    expect(compareProtectKeys(['a', 'b'], ['a', 'c'])).toBeLessThan(0);
    expect(compareProtectKeys(['a'], ['a', 'b'])).toBeLessThan(0);
    expect(keyInRange('history-state', prefixRange('history'))).toBe(true);
    expect(keyInRange('firewall-stats', prefixRange('history'))).toBe(false);
    expect(keyInRange(5, { lower: 5, lowerOpen: true })).toBe(false);
    expect(keyOf({ receiver: 'a.com', site: 'b.com' }, ['receiver', 'site'])).toEqual(['a.com', 'b.com']);
    expect(keyOf({ receiver: 'a.com', site: null }, ['receiver', 'site'])).toBeUndefined();
  });
});
