// ADR-020 §G, §8 (S12): history stores of IndexedDB `detect-expert-protect` (sightings, receivers, sites,
// meta['history-state']) through the module's storage port (idb.ts is the only owner of indexedDB). Every record is
// validated when read; a malformed one is dropped and counted. Limits: ≤ maxSightings / maxHistoryReceivers /
// maxHistorySites; beyond them the oldest records by `byLastDay` go until 95 % of the limit (`truncated`). Retention
// 7/30/90 days runs once per UTC day (at the next event), rewriting in chunks of PROTECT_BUDGETS.purgeChunk.

import { PROTECT_BUDGETS } from '@detect-expert/contracts';
import {
  HISTORY_STATE_KEY,
  addHistoryDropped,
  applyHistoryReceiverDay,
  applyHistorySightingDelta,
  applyHistorySiteDelta,
  historyEmptyMask,
  historyFirstDay,
  historyAlignMask,
  historyLastDay,
  historyNeedsRetention,
  parseHistoryReceiverRecord,
  parseHistorySightingRecord,
  parseHistorySiteRecord,
  parseHistoryState,
  retainHistoryReceiver,
  retainHistorySighting,
  retainHistorySite,
} from '@detect-expert/engine';
import type {
  HistoryDayMask,
  HistoryReceiverRecord,
  HistorySightingDelta,
  HistorySightingRecord,
  HistorySiteDelta,
  HistorySiteRecord,
  HistoryStateRecord,
} from '@detect-expert/engine';
import { prefixRange } from '../db-port';
import type { ProtectDb, ProtectKey } from '../db-port';
import type { HistoryDrained } from './accumulator';

export interface HistoryLimits {
  sightings: number;
  receivers: number;
  sites: number;
}

export const HISTORY_LIMITS: Readonly<HistoryLimits> = Object.freeze({
  sightings: PROTECT_BUDGETS.maxSightings,
  receivers: PROTECT_BUDGETS.maxHistoryReceivers,
  sites: PROTECT_BUDGETS.maxHistorySites,
});

/** Eviction brings a store down to this share of its limit. */
export const HISTORY_EVICT_TARGET = 0.95;
const LOAD_CHUNK = 4096;

type BoundedStore = 'sightings' | 'receivers' | 'sites';

export interface HistoryLoaded {
  sightings: HistorySightingRecord[];
  sites: HistorySiteRecord[];
}

function sightingKey(r: { receiver: string; site: string }): ProtectKey {
  return [r.receiver, r.site];
}

export class HistoryStore {
  constructor(
    private readonly db: ProtectDb,
    private readonly limits: Readonly<HistoryLimits> = HISTORY_LIMITS,
  ) {}

  /** The stored state; null when absent; 'malformed' when present but invalid. */
  async readState(): Promise<HistoryStateRecord | null | 'malformed'> {
    const raw = await this.db.get<unknown>('meta', HISTORY_STATE_KEY);
    if (raw === undefined) return null;
    return parseHistoryState(raw) ?? 'malformed';
  }

  async writeState(state: Readonly<HistoryStateRecord>): Promise<void> {
    await this.db.put('meta', { ...state, counts: { ...state.counts }, dropped: { ...state.dropped } });
  }

  async counts(): Promise<HistoryStateRecord['counts']> {
    return {
      sightings: await this.db.count('sightings'),
      receivers: await this.db.count('receivers'),
      sites: await this.db.count('sites'),
    };
  }

  /** Writes drained deltas (merging into stored records); updates counts and evicts beyond the limits. */
  async flush(drained: HistoryDrained, state: HistoryStateRecord): Promise<void> {
    // Sightings: all deltas of one (receiver, site) applied to its record in one pass.
    const bySighting = new Map<string, HistorySightingDelta[]>();
    const siteDeltas: HistorySiteDelta[] = [...drained.sites];
    const receiverDays = new Map<string, Set<number>>();
    for (const d of drained.sightings) {
      const key = d.receiver + '|' + d.site;
      const list = bySighting.get(key);
      if (list === undefined) bySighting.set(key, [d]);
      else list.push(d);
      let days = receiverDays.get(d.receiver);
      if (days === undefined) receiverDays.set(d.receiver, (days = new Set()));
      days.add(d.day);
      // Every site of a sighting is a visited site (module events come without an observation report).
      siteDeltas.push({ site: d.site, day: d.day, limited: false });
    }
    if (bySighting.size > 0) {
      const groups = [...bySighting.values()];
      const existing = await this.db.getMany<unknown>('sightings', groups.map((g) => sightingKey(g[0]!)));
      const out: HistorySightingRecord[] = [];
      groups.forEach((group, i) => {
        const raw = existing[i];
        let rec: HistorySightingRecord | undefined;
        if (raw !== undefined) {
          rec = parseHistorySightingRecord(raw) ?? undefined;
          if (rec === undefined) addHistoryDropped(state.dropped, 'malformed');
        }
        for (const d of group) rec = applyHistorySightingDelta(rec, d);
        if (rec !== undefined) out.push(rec);
      });
      await this.db.putMany('sightings', out);
    }
    if (receiverDays.size > 0) {
      const receivers = [...receiverDays.keys()];
      const existing = await this.db.getMany<unknown>('receivers', receivers);
      const out: HistoryReceiverRecord[] = receivers.map((receiver, i) => {
        let rec = existing[i] === undefined ? undefined : (parseHistoryReceiverRecord(existing[i]) ?? undefined);
        for (const day of receiverDays.get(receiver)!) rec = applyHistoryReceiverDay(rec, receiver, day);
        return rec!;
      });
      await this.db.putMany('receivers', out);
    }
    if (siteDeltas.length > 0) {
      const bySite = new Map<string, HistorySiteDelta[]>();
      for (const d of siteDeltas) {
        const list = bySite.get(d.site);
        if (list === undefined) bySite.set(d.site, [d]);
        else list.push(d);
      }
      const sites = [...bySite.keys()];
      const existing = await this.db.getMany<unknown>('sites', sites);
      const out: HistorySiteRecord[] = sites.map((site, i) => {
        let rec = existing[i] === undefined ? undefined : (parseHistorySiteRecord(existing[i]) ?? undefined);
        for (const d of bySite.get(site)!) rec = applyHistorySiteDelta(rec, d);
        return rec!;
      });
      await this.db.putMany('sites', out);
    }
    state.counts = await this.counts();
    await this.enforceLimits(state);
  }

  /** Oldest records of `store` by byLastDay until `n` are gone (whole older days first, then single keys). */
  private async evictOldest(store: BoundedStore, n: number): Promise<string[]> {
    if (n <= 0) return [];
    const perDay: Array<{ day: number; keys: ProtectKey[]; names: string[] }> = [];
    let collected = 0;
    await this.db.iterate<Record<string, unknown>>(store, { index: 'byLastDay', chunk: PROTECT_BUDGETS.purgeChunk }, (records) => {
      for (const r of records) {
        if (collected >= n) return false;
        const day = typeof r['lastDay'] === 'number' ? r['lastDay'] : -1;
        let bucket = perDay[perDay.length - 1];
        if (bucket === undefined || bucket.day !== day) {
          bucket = { day, keys: [], names: [] };
          perDay.push(bucket);
        }
        const name = store === 'sightings' ? '' : String(store === 'receivers' ? r['receiver'] : r['site']);
        bucket.keys.push(store === 'sightings' ? [String(r['receiver']), String(r['site'])] : name);
        bucket.names.push(name);
        collected++;
      }
      return collected < n;
    });
    const names: string[] = [];
    const last = perDay[perDay.length - 1];
    if (last === undefined) return names;
    // Whole days before the boundary day go in one range delete; the boundary day key by key.
    if (perDay.length > 1) await this.db.deleteWhere(store, 'byLastDay', { upper: last.day, upperOpen: true });
    for (const b of perDay.slice(0, -1)) names.push(...b.names);
    for (let i = 0; i < last.keys.length; i++) {
      await this.db.delete(store, last.keys[i]!);
      names.push(last.names[i]!);
    }
    return names.filter((x) => x !== '');
  }

  /** Eviction beyond the limits (receivers and sites take their sightings along). Sets `truncated` when it evicts. */
  async enforceLimits(state: HistoryStateRecord): Promise<boolean> {
    const over = (count: number, limit: number): number => (count > limit ? count - Math.floor(limit * HISTORY_EVICT_TARGET) : 0);
    const sightingsBefore = state.counts.sightings;
    let evicted = false;
    const r = over(state.counts.receivers, this.limits.receivers);
    if (r > 0) {
      const gone = await this.evictOldest('receivers', r);
      for (const receiver of gone) await this.db.deleteWhere('sightings', 'byReceiver', { lower: receiver, upper: receiver });
      addHistoryDropped(state.dropped, 'evictedReceivers', gone.length);
      evicted = true;
    }
    const s = over(state.counts.sites, this.limits.sites);
    if (s > 0) {
      const gone = await this.evictOldest('sites', s);
      for (const site of gone) await this.db.deleteWhere('sightings', 'bySite', { lower: site, upper: site });
      addHistoryDropped(state.dropped, 'evictedSites', gone.length);
      evicted = true;
    }
    if (evicted) state.counts = await this.counts();
    const g = over(state.counts.sightings, this.limits.sightings);
    if (g > 0) {
      await this.evictOldest('sightings', g);
      evicted = true;
    }
    if (!evicted) return false;
    state.counts = await this.counts();
    addHistoryDropped(state.dropped, 'evictedSightings', Math.max(0, sightingsBefore - state.counts.sightings));
    state.truncated = true;
    return true;
  }

  /**
   * Retention: records whose newest day is older than the window go in one range delete per store; the others are
   * re-anchored to today in chunks (older days and days after today dropped). Returns the number of removed records.
   */
  async purge(state: HistoryStateRecord, today: number, keepDays: number): Promise<number> {
    const cutoff = today - keepDays + 1;
    let removed = 0;
    removed += await this.db.deleteWhere('sightings', 'byLastDay', { upper: cutoff, upperOpen: true });
    removed += await this.db.deleteWhere('receivers', 'byLastDay', { upper: cutoff, upperOpen: true });
    removed += await this.db.deleteWhere('sites', 'byLastDay', { upper: cutoff, upperOpen: true });
    removed += await this.rewrite('sightings', cutoff, state, (raw) => {
      const rec = parseHistorySightingRecord(raw);
      if (rec === null) return { key: keyFromRaw('sightings', raw), malformed: true };
      if (!historyNeedsRetention(rec.endDay, historyFirstDay(rec.seen, rec.endDay), today, keepDays)) return null;
      return { key: sightingKey(rec), next: retainHistorySighting(rec, today, keepDays) };
    });
    removed += await this.rewrite('receivers', cutoff, state, (raw) => {
      const rec = parseHistoryReceiverRecord(raw);
      if (rec === null) return { key: keyFromRaw('receivers', raw), malformed: true };
      if (!historyNeedsRetention(rec.endDay, historyFirstDay(rec.seen, rec.endDay), today, keepDays)) return null;
      return { key: rec.receiver, next: retainHistoryReceiver(rec, today, keepDays) };
    });
    removed += await this.rewrite('sites', cutoff, state, (raw) => {
      const rec = parseHistorySiteRecord(raw);
      if (rec === null) return { key: keyFromRaw('sites', raw), malformed: true };
      if (!historyNeedsRetention(rec.endDay, historyFirstDay(rec.seen, rec.endDay), today, keepDays)) return null;
      return { key: rec.site, next: retainHistorySite(rec, today, keepDays) };
    });
    state.counts = await this.counts();
    state.lastPurgeDay = today;
    return removed;
  }

  /**
   * One retention pass over the records newer than the cutoff. `step` returns null (keep as is), a replacement
   * (`next`; null = nothing left, delete) or `malformed` (delete and count).
   */
  private async rewrite(
    store: BoundedStore,
    cutoff: number,
    state: HistoryStateRecord,
    step: (raw: unknown) => { key: ProtectKey | null; next?: object | null; malformed?: true } | null,
  ): Promise<number> {
    const doomed: ProtectKey[] = [];
    await this.db.iterate<unknown>(store, { index: 'byLastDay', range: { lower: cutoff }, chunk: PROTECT_BUDGETS.purgeChunk }, async (records) => {
      const changed: object[] = [];
      for (const raw of records) {
        const result = step(raw);
        if (result === null) continue;
        if (result.malformed === true) addHistoryDropped(state.dropped, 'malformed');
        if (result.malformed === true || result.next === null || result.next === undefined) {
          if (result.key !== null) doomed.push(result.key);
        } else changed.push(result.next);
      }
      if (changed.length > 0) await this.db.putMany(store, changed);
    });
    for (const key of doomed) await this.db.delete(store, key);
    return doomed.length;
  }

  /** Every valid sighting and site record. Malformed records are deleted (when their key is usable) and counted. */
  async loadAll(state: HistoryStateRecord | null): Promise<HistoryLoaded> {
    const sightings: HistorySightingRecord[] = [];
    const sites: HistorySiteRecord[] = [];
    const doomed: Array<{ store: BoundedStore; key: ProtectKey | null }> = [];
    await this.db.iterate<unknown>('sightings', { chunk: LOAD_CHUNK }, (records) => {
      for (const raw of records) {
        const rec = parseHistorySightingRecord(raw);
        if (rec === null) doomed.push({ store: 'sightings', key: keyFromRaw('sightings', raw) });
        else sightings.push(rec);
      }
    });
    await this.db.iterate<unknown>('sites', { chunk: LOAD_CHUNK }, (records) => {
      for (const raw of records) {
        const rec = parseHistorySiteRecord(raw);
        if (rec === null) doomed.push({ store: 'sites', key: keyFromRaw('sites', raw) });
        else sites.push(rec);
      }
    });
    for (const d of doomed) {
      if (d.key === null) continue;
      await this.db.delete(d.store, d.key);
      if (state !== null) addHistoryDropped(state.dropped, 'malformed');
    }
    return { sightings, sites };
  }

  /** Removes the receivers' sightings and records (a history row). */
  async deleteReceivers(receivers: readonly string[], state: HistoryStateRecord): Promise<void> {
    for (const receiver of receivers) {
      await this.db.deleteWhere('sightings', 'byReceiver', { lower: receiver, upper: receiver });
      await this.db.delete('receivers', receiver);
    }
    state.counts = await this.counts();
  }

  /** Removes a site: its sightings and record; the receivers seen there are rebuilt from what remains. */
  async deleteSite(site: string, state: HistoryStateRecord): Promise<void> {
    const receivers = new Set<string>();
    await this.db.iterate<Record<string, unknown>>('sightings', { index: 'bySite', range: { lower: site, upper: site }, chunk: PROTECT_BUDGETS.purgeChunk }, (records) => {
      for (const r of records) if (typeof r['receiver'] === 'string') receivers.add(r['receiver']);
    });
    await this.db.deleteWhere('sightings', 'bySite', { lower: site, upper: site });
    await this.db.delete('sites', site);
    for (const receiver of receivers) await this.rebuildReceiver(receiver);
    state.counts = await this.counts();
  }

  private async rebuildReceiver(receiver: string): Promise<void> {
    let seen: HistoryDayMask = historyEmptyMask();
    let endDay = -1;
    await this.db.iterate<unknown>('sightings', { index: 'byReceiver', range: { lower: receiver, upper: receiver }, chunk: PROTECT_BUDGETS.purgeChunk }, (records) => {
      for (const raw of records) {
        const rec = parseHistorySightingRecord(raw);
        if (rec === null) continue;
        if (endDay < 0) {
          seen = [...rec.seen];
          endDay = rec.endDay;
        } else {
          const end = Math.max(endDay, rec.endDay);
          const a = historyAlignMask(seen, endDay, end);
          const b = historyAlignMask(rec.seen, rec.endDay, end);
          seen = [(a[0] | b[0]) >>> 0, (a[1] | b[1]) >>> 0, (a[2] | b[2]) >>> 0];
          endDay = end;
        }
      }
    });
    const lastDay = endDay < 0 ? null : historyLastDay(seen, endDay);
    if (endDay < 0 || lastDay === null) await this.db.delete('receivers', receiver);
    else await this.db.put('receivers', { v: 1, receiver, endDay, lastDay, seen } satisfies HistoryReceiverRecord);
  }

  /** Every history store and meta['history*'] (feature off, «Удалить всю историю»). */
  async clearAll(): Promise<void> {
    await this.db.clear('sightings');
    await this.db.clear('receivers');
    await this.db.clear('sites');
    await this.db.deleteWhere('meta', null, prefixRange('history'));
  }
}

/** Primary key of a malformed record when its key fields are still usable (otherwise it stays, counted once). */
function keyFromRaw(store: BoundedStore, raw: unknown): ProtectKey | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (store === 'sightings') return typeof r['receiver'] === 'string' && typeof r['site'] === 'string' ? [r['receiver'], r['site']] : null;
  const k = store === 'receivers' ? r['receiver'] : r['site'];
  return typeof k === 'string' ? k : null;
}
