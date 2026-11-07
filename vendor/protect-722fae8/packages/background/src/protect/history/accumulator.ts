// ADR-020 §G (S12): in-memory accumulator of history deltas (≤ PROTECT_BUDGETS.maxPendingDeltas distinct keys). Deltas of
// the same (receiver, site, day) / (site, day) merge in place; a new key beyond the bound is refused (the service
// flushes or counts `dropped.pending`). Lost when the service worker stops: a gap of at most historyFlushMs.

import { PROTECT_BUDGETS } from '@detect-expert/contracts';
import { historySightingDeltaKey, historySiteDeltaKey, mergeHistorySightingDeltas, mergeHistorySiteDeltas } from '@detect-expert/engine';
import type { HistorySightingDelta, HistorySiteDelta } from '@detect-expert/engine';

export interface HistoryDrained {
  sightings: HistorySightingDelta[];
  sites: HistorySiteDelta[];
}

export class HistoryAccumulator {
  private sightings = new Map<string, HistorySightingDelta>();
  private sites = new Map<string, HistorySiteDelta>();

  constructor(private readonly max: number = PROTECT_BUDGETS.maxPendingDeltas) {}

  get size(): number {
    return this.sightings.size + this.sites.size;
  }

  get full(): boolean {
    return this.size >= this.max;
  }

  /** Merges into an existing key, or adds a new one while below the bound. False = refused (full). */
  addSighting(delta: HistorySightingDelta): boolean {
    const key = historySightingDeltaKey(delta);
    const cur = this.sightings.get(key);
    if (cur !== undefined) {
      this.sightings.set(key, mergeHistorySightingDeltas(cur, delta));
      return true;
    }
    if (this.full) return false;
    this.sightings.set(key, delta);
    return true;
  }

  addSite(delta: HistorySiteDelta): boolean {
    const key = historySiteDeltaKey(delta);
    const cur = this.sites.get(key);
    if (cur !== undefined) {
      this.sites.set(key, mergeHistorySiteDeltas(cur, delta));
      return true;
    }
    if (this.full) return false;
    this.sites.set(key, delta);
    return true;
  }

  /** Takes everything out (the accumulator is empty afterwards). */
  drain(): HistoryDrained {
    const out = { sightings: [...this.sightings.values()], sites: [...this.sites.values()] };
    this.sightings = new Map();
    this.sites = new Map();
    return out;
  }

  clear(): void {
    this.sightings.clear();
    this.sites.clear();
  }
}
