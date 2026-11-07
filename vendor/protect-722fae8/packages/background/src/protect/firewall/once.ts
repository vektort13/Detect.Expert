// ADR-020 §C (S08): `once` decisions — session DNR rules for one tab on one site (tabIds [T] + the site condition).
// Their metadata and the dismissed sites of a tab live in the tab model's lane data (`protect-tabs` in
// storage.session), so they survive a service-worker restart and go with the tab. A rule is removed when the tab
// closes or commits a document of another site (prerender commits are ignored by the tab model); on tabs.onReplaced
// it moves to the new tab id when the site is the same. At most maxSessionRules rules in total.

import { PROTECT_BUDGETS, isDomainName, isSiteName } from '@detect-expert/contracts';
import type { FirewallAction } from '@detect-expert/contracts';
import type { OnceRuleSpec } from '@detect-expert/engine';
import type { ProtectTabModel } from '../tab-model';

export const FIREWALL_LANE = 'firewall';
/** Dismissed sites remembered per tab (until the tab closes). */
export const MAX_DISMISSED_SITES = 8;

interface LaneData {
  v: 1;
  tabId: number;
  once: Array<{ slot: number; site: string; receiver: string; action: FirewallAction }>;
  dismissed: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function readLane(v: unknown): LaneData | null {
  if (!isRecord(v) || v['v'] !== 1 || !Number.isSafeInteger(v['tabId'])) return null;
  const once: LaneData['once'] = [];
  if (Array.isArray(v['once'])) {
    for (const o of v['once'].slice(0, PROTECT_BUDGETS.maxSessionRules)) {
      if (!isRecord(o)) continue;
      const { slot, site, receiver, action } = o;
      if (typeof slot !== 'number' || !Number.isSafeInteger(slot) || slot < 0 || slot >= PROTECT_BUDGETS.maxSessionRules) continue;
      if (typeof site !== 'string' || !isSiteName(site) || typeof receiver !== 'string' || !isDomainName(receiver)) continue;
      if (action !== 'block' && action !== 'allow') continue;
      once.push({ slot, site, receiver, action });
    }
  }
  const dismissed: string[] = [];
  if (Array.isArray(v['dismissed'])) for (const s of v['dismissed'].slice(0, MAX_DISMISSED_SITES)) if (typeof s === 'string' && isSiteName(s)) dismissed.push(s);
  return { v: 1, tabId: v['tabId'] as number, once, dismissed };
}

export interface OnceChange {
  receiver: string;
  before: FirewallAction | null;
  after: FirewallAction | null;
}

export class FirewallOnceRules {
  private readonly bySlot = new Map<number, OnceRuleSpec>();
  private readonly dismissedByTab = new Map<number, string[]>();

  constructor(private readonly tabModel: ProtectTabModel) {}

  /** Rebuilds memory from the lane data of the tab model (SW start). */
  load(): void {
    this.bySlot.clear();
    this.dismissedByTab.clear();
    for (const entry of this.tabModel.entries()) {
      const lane = readLane(entry.lanes?.[FIREWALL_LANE]);
      if (lane === null) continue;
      for (const o of lane.once) {
        if (this.bySlot.has(o.slot)) continue;
        this.bySlot.set(o.slot, { slot: o.slot, tabId: entry.tabId, site: o.site, receiver: o.receiver, action: o.action });
      }
      if (lane.dismissed.length > 0) this.dismissedByTab.set(entry.tabId, lane.dismissed);
    }
  }

  get size(): number {
    return this.bySlot.size;
  }

  all(): OnceRuleSpec[] {
    return [...this.bySlot.values()].sort((a, b) => a.slot - b.slot);
  }

  forTab(tabId: number): OnceRuleSpec[] {
    return this.all().filter((o) => o.tabId === tabId);
  }

  find(tabId: number, receiver: string): OnceRuleSpec | undefined {
    for (const o of this.bySlot.values()) if (o.tabId === tabId && o.receiver === receiver) return o;
    return undefined;
  }

  private persist(tabId: number): void {
    const once = this.forTab(tabId).map((o) => ({ slot: o.slot, site: o.site, receiver: o.receiver, action: o.action }));
    const dismissed = this.dismissedByTab.get(tabId) ?? [];
    this.tabModel.setLaneData(tabId, FIREWALL_LANE, once.length === 0 && dismissed.length === 0 ? undefined : { v: 1, tabId, once, dismissed });
  }

  /**
   * Sets `action` for each receiver in the tab on `site` (replacing an existing once decision of the tab). Returns
   * the changes, or null when there are not enough free slots (limit-reached: nothing changed).
   */
  set(tabId: number, site: string, receivers: readonly string[], action: FirewallAction | null): OnceChange[] | null {
    const missing = receivers.filter((r) => this.find(tabId, r) === undefined).length;
    if (action !== null && missing > 0) {
      const free: number[] = [];
      for (let s = 0; s < PROTECT_BUDGETS.maxSessionRules && free.length < missing; s++) if (!this.bySlot.has(s)) free.push(s);
      if (free.length < missing) return null;
    }
    const changes: OnceChange[] = [];
    for (const receiver of receivers) {
      const existing = this.find(tabId, receiver);
      const before = existing?.action ?? null;
      if (action === null) {
        if (existing !== undefined) this.bySlot.delete(existing.slot);
      } else if (existing !== undefined) {
        this.bySlot.set(existing.slot, { ...existing, site, action });
      } else {
        let slot = 0;
        while (this.bySlot.has(slot)) slot++;
        this.bySlot.set(slot, { slot, tabId, site, receiver, action });
      }
      changes.push({ receiver, before, after: action });
    }
    this.persist(tabId);
    return changes;
  }

  /** The tab committed a top-level document of `site`: once rules of another site go. True when any went. */
  onCommitted(tabId: number, site: string | null): boolean {
    let removed = false;
    for (const o of [...this.bySlot.values()]) {
      if (o.tabId === tabId && o.site !== site) {
        this.bySlot.delete(o.slot);
        removed = true;
      }
    }
    if (removed) this.persist(tabId);
    return removed;
  }

  /**
   * The tab is gone (tabs.onRemoved, or the old id of tabs.onReplaced). When the tab model moved the tab's entry to a
   * new id (replacement), rules of the same site follow it. True when the rules changed.
   */
  onTabGone(tabId: number): boolean {
    let target: number | null = null;
    let targetSite: string | null = null;
    for (const entry of this.tabModel.entries()) {
      const lane = readLane(entry.lanes?.[FIREWALL_LANE]);
      if (lane !== null && lane.tabId === tabId && entry.tabId !== tabId) {
        target = entry.tabId;
        targetSite = entry.site;
        break;
      }
    }
    let changed = false;
    for (const o of [...this.bySlot.values()]) {
      if (o.tabId !== tabId) continue;
      changed = true;
      if (target !== null && o.site === targetSite) this.bySlot.set(o.slot, { ...o, tabId: target });
      else this.bySlot.delete(o.slot);
    }
    const dismissed = this.dismissedByTab.get(tabId);
    this.dismissedByTab.delete(tabId);
    if (target !== null) {
      if (dismissed !== undefined) this.dismissedByTab.set(target, dismissed);
      this.persist(target);
    }
    return changed;
  }

  isDismissed(tabId: number, site: string): boolean {
    return this.dismissedByTab.get(tabId)?.includes(site) === true;
  }

  dismiss(tabId: number, site: string): void {
    const list = (this.dismissedByTab.get(tabId) ?? []).filter((s) => s !== site);
    list.push(site);
    this.dismissedByTab.set(tabId, list.slice(-MAX_DISMISSED_SITES));
    this.persist(tabId);
  }

  /** Purge of decisions: every once rule goes (dismissals stay with their tabs). */
  clearRules(): void {
    const tabs = new Set([...this.bySlot.values()].map((o) => o.tabId));
    this.bySlot.clear();
    for (const t of tabs) this.persist(t);
  }

  /** Lane stop: memory only (the tab model keeps the lane data for the next start). */
  reset(): void {
    this.bySlot.clear();
    this.dismissedByTab.clear();
  }
}
