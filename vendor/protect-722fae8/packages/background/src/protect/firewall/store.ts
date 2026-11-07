// ADR-020 §C, §8 (S08): firewall decisions in IndexedDB `decisions` (source of truth; DNR rules are their projection)
// and the daily statistics in `meta` key `firewall-stats` (≤ maxStatDays days). Records hold domains, enums, local days
// and counters only. Decisions are written through at once; the counters (stopped / bypass) and the statistics are
// written at most once per statsFlushMs. The whole set (≤ maxDecisions) is kept in memory for compilation.

import { FIREWALL_RULE_KEY_PATTERN, MAX_COUNT, PROTECT_BUDGETS, isDomainName, isLocalDay, isSiteName } from '@detect-expert/contracts';
import type { FirewallStoppedDay, LocalDay } from '@detect-expert/contracts';
import { decisionKeyOf } from '@detect-expert/engine';
import type { FirewallDecision } from '@detect-expert/engine';
import type { Clock } from '../../chrome-api';
import type { ProtectDb } from '../db-port';

export const FIREWALL_STATS_KEY = 'firewall-stats';

/** Local calendar day (YYYY-MM-DD) of an epoch time, in the browser's time zone. */
export function localDayOf(epochMs: number): LocalDay {
  const d = new Date(epochMs);
  const pad = (n: number): string => (n < 10 ? '0' : '') + String(n);
  return String(d.getFullYear()) + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function count(v: unknown): number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? Math.min(v, MAX_COUNT) : 0;
}

/** Shape check of a stored decision (our own record; a broken one is skipped, never thrown on). */
export function readDecision(v: unknown): FirewallDecision | null {
  if (!isRecord(v)) return null;
  const { decisionKey, receiver, site, scope, action, origin, slot, createdDay } = v;
  if (typeof receiver !== 'string' || !isDomainName(receiver)) return null;
  if (scope !== 'site' && scope !== 'everywhere') return null;
  if (scope === 'site' ? typeof site !== 'string' || !isSiteName(site) : site !== null) return null;
  if (action !== 'block' && action !== 'allow') return null;
  if (origin !== 'user' && origin !== 'preset') return null;
  if (typeof slot !== 'number' || !Number.isSafeInteger(slot) || slot < 0 || slot >= PROTECT_BUDGETS.maxDecisions) return null;
  if (!isLocalDay(createdDay)) return null;
  const key = decisionKeyOf(scope, site as string | null, receiver);
  if (decisionKey !== key || !FIREWALL_RULE_KEY_PATTERN.test(key)) return null;
  return { decisionKey: key, receiver, site: site as string | null, scope, action, origin, slot, createdDay, stopped: count(v['stopped']), bypass: count(v['bypass']) };
}

interface StrictUsage {
  day: LocalDay;
  total: number;
  sites: Map<string, number>;
}

export class FirewallDecisionStore {
  private readonly decisions = new Map<string, FirewallDecision>();
  private readonly slots = new Map<number, string>();
  private readonly days = new Map<LocalDay, number>();
  private strict: StrictUsage = { day: '', total: 0, sites: new Map() };
  private readonly dirtyCounters = new Set<string>();
  private statsDirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastFlush = 0;
  private db: ProtectDb | null = null;
  private failures = 0;
  private dropped = 0;

  constructor(
    private readonly clock: Clock,
    private readonly flushMs: number = PROTECT_BUDGETS.statsFlushMs,
  ) {}

  /** Database the store writes to (null: memory only, writes fail with storage-unavailable). */
  get available(): boolean {
    return this.db !== null && this.db.status === 'open';
  }

  get size(): number {
    return this.decisions.size;
  }

  get debugCounts(): { failures: number; dropped: number } {
    return { failures: this.failures, dropped: this.dropped };
  }

  /** Reads every decision and the statistics. False when storage failed (the store stays empty and memory-only). */
  async load(db: ProtectDb | null): Promise<boolean> {
    this.db = db;
    this.clearMemory();
    if (db === null) return false;
    try {
      await db.iterate<unknown>('decisions', { chunk: 256 }, (records) => {
        for (const r of records) {
          const d = readDecision(r);
          if (d === null || this.slots.has(d.slot) || this.decisions.size >= PROTECT_BUDGETS.maxDecisions) {
            this.dropped++;
            continue;
          }
          this.decisions.set(d.decisionKey, d);
          this.slots.set(d.slot, d.decisionKey);
        }
        return true;
      });
      this.readStats(await db.get<unknown>('meta', FIREWALL_STATS_KEY));
      return true;
    } catch {
      this.failures++;
      this.clearMemory();
      return false;
    }
  }

  private readStats(v: unknown): void {
    if (!isRecord(v) || v['v'] !== 1) return;
    const days = v['days'];
    if (Array.isArray(days)) {
      for (const d of days.slice(0, PROTECT_BUDGETS.maxStatDays)) {
        if (isRecord(d) && isLocalDay(d['day'])) this.days.set(d['day'], count(d['count']));
      }
    }
    const strict = v['strict'];
    if (isRecord(strict) && isLocalDay(strict['day']) && Array.isArray(strict['sites'])) {
      const sites = new Map<string, number>();
      for (const s of strict['sites'].slice(0, PROTECT_BUDGETS.maxStrictAutoPerDay)) {
        if (Array.isArray(s) && typeof s[0] === 'string' && isSiteName(s[0])) sites.set(s[0], count(s[1]));
      }
      this.strict = { day: strict['day'], total: count(strict['total']), sites };
    }
  }

  clearMemory(): void {
    this.decisions.clear();
    this.slots.clear();
    this.days.clear();
    this.strict = { day: '', total: 0, sites: new Map() };
    this.dirtyCounters.clear();
    this.statsDirty = false;
  }

  get(key: string): FirewallDecision | undefined {
    return this.decisions.get(key);
  }

  all(): FirewallDecision[] {
    return [...this.decisions.values()];
  }

  /** `n` free slots (lowest first) or null when the store is full (limit-reached). */
  freeSlots(n: number, reserved: ReadonlySet<number> = new Set()): number[] | null {
    const out: number[] = [];
    for (let s = 0; s < PROTECT_BUDGETS.maxDecisions && out.length < n; s++) if (!this.slots.has(s) && !reserved.has(s)) out.push(s);
    return out.length === n ? out : null;
  }

  /** Writes decisions (put) and removals (delete) through, then updates memory. Throws when storage fails. */
  async apply(puts: readonly FirewallDecision[], deletes: readonly string[]): Promise<void> {
    const db = this.db;
    if (db === null || db.status !== 'open') throw new Error('storage-unavailable');
    for (const key of deletes) await db.delete('decisions', key);
    if (puts.length > 0) await db.putMany('decisions', puts.map((d) => ({ ...d })));
    for (const key of deletes) {
      const d = this.decisions.get(key);
      if (d === undefined) continue;
      this.decisions.delete(key);
      if (this.slots.get(d.slot) === key) this.slots.delete(d.slot);
      this.dirtyCounters.delete(key);
    }
    for (const d of puts) {
      const prev = this.decisions.get(d.decisionKey);
      if (prev !== undefined && this.slots.get(prev.slot) === d.decisionKey) this.slots.delete(prev.slot);
      this.decisions.set(d.decisionKey, { ...d });
      this.slots.set(d.slot, d.decisionKey);
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // Counters and statistics (lower bounds; written at most once per flushMs)
  // -------------------------------------------------------------------------------------------------------------

  noteStopped(decisionKey: string | null, day: LocalDay): void {
    this.days.set(day, Math.min(MAX_COUNT, (this.days.get(day) ?? 0) + 1));
    while (this.days.size > PROTECT_BUDGETS.maxStatDays) {
      const oldest = [...this.days.keys()].sort()[0];
      if (oldest === undefined) break;
      this.days.delete(oldest);
    }
    this.statsDirty = true;
    if (decisionKey !== null) {
      const d = this.decisions.get(decisionKey);
      if (d !== undefined) {
        d.stopped = Math.min(MAX_COUNT, d.stopped + 1);
        this.dirtyCounters.add(decisionKey);
      }
    }
    this.schedule();
  }

  noteBypass(decisionKey: string | null): void {
    if (decisionKey === null) return;
    const d = this.decisions.get(decisionKey);
    if (d === undefined) return;
    d.bypass = Math.min(MAX_COUNT, d.bypass + 1);
    this.dirtyCounters.add(decisionKey);
    this.schedule();
  }

  stoppedOn(day: LocalDay): number {
    return this.days.get(day) ?? 0;
  }

  /** Days with counts, newest first, at most maxStatDays. */
  stoppedDays(): FirewallStoppedDay[] {
    return [...this.days.entries()].sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0)).slice(0, PROTECT_BUDGETS.maxStatDays).map(([day, c]) => ({ day, count: c }));
  }

  /** Strict-preset automatic decisions made today: in total and on `site`. */
  strictUsage(day: LocalDay, site: string): { total: number; site: number } {
    if (this.strict.day !== day) return { total: 0, site: 0 };
    return { total: this.strict.total, site: this.strict.sites.get(site) ?? 0 };
  }

  noteStrictAuto(day: LocalDay, site: string): void {
    if (this.strict.day !== day) this.strict = { day, total: 0, sites: new Map() };
    this.strict.total = Math.min(MAX_COUNT, this.strict.total + 1);
    if (this.strict.sites.has(site) || this.strict.sites.size < PROTECT_BUDGETS.maxStrictAutoPerDay) this.strict.sites.set(site, (this.strict.sites.get(site) ?? 0) + 1);
    this.statsDirty = true;
    this.schedule();
  }

  private schedule(): void {
    if (this.timer !== null) return;
    const wait = Math.max(0, this.lastFlush + this.flushMs - this.clock.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, Math.max(wait, 0));
  }

  /** Writes dirty counters and the statistics (best effort; a failure keeps them dirty for the next attempt). */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const db = this.db;
    if (db === null || db.status !== 'open' || (this.dirtyCounters.size === 0 && !this.statsDirty)) return;
    this.lastFlush = this.clock.now();
    const keys = [...this.dirtyCounters];
    const records = keys.map((k) => this.decisions.get(k)).filter((d): d is FirewallDecision => d !== undefined).map((d) => ({ ...d }));
    const stats = this.statsDirty
      ? { key: FIREWALL_STATS_KEY, v: 1, days: this.stoppedDays(), strict: { day: this.strict.day || null, total: this.strict.total, sites: [...this.strict.sites.entries()] } }
      : null;
    this.dirtyCounters.clear();
    this.statsDirty = false;
    try {
      if (records.length > 0) await db.putMany('decisions', records);
      if (stats !== null) await db.put('meta', stats);
    } catch {
      this.failures++;
      for (const k of keys) this.dirtyCounters.add(k);
      if (stats !== null) this.statsDirty = true;
    }
  }

  /** Timers off (lane stop); pending counters are flushed best effort by the caller first. */
  stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
