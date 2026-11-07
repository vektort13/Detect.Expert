// Bounded, memory-only delivery of positive findings. Browser calls stay in the SW adapter.
import { FINDING_DOCUMENT_KEY, MAX_FINDING_KEYS } from './findings';
import type { FindingSnapshot } from './findings';

export const FINDINGS_GROUP_MS = 300;
export const FINDINGS_OPEN_INTERVAL_MS = 10_000;
export const MAX_FINDINGS_TABS = 64;
export const MAX_FINDINGS_SEEN_PER_DOCUMENT = 128;
export const MAX_FINDINGS_SEEN = 1024;
export const MAX_FINDINGS_SCHEDULED = 1024;
export interface FindingsTab { windowId: number; active: boolean; focused: boolean }
export interface FindingsWindow { windowId: number; tabId: number; documentKey: string }
export interface FindingsSurfaceDeps {
  now(): number;
  /** Current top-level report only, already gated by controller active/exclusion/snooze. */
  snapshot(tabId: number): FindingSnapshot | null;
  tab(tabId: number): Promise<FindingsTab | null>;
  /** Creates only this extension's findings page. It must not steal focus. */
  show(tabId: number, documentKey: string, sourceWindowId: number): Promise<number | null>;
  existing(windowId: number): Promise<boolean>;
  /** Removes only an exact owned findings page/window. */
  remove(windowId: number): Promise<void>;
  setTimer(callback: () => void, milliseconds: number): unknown;
  clearTimer(handle: unknown): void;
}
interface Followed { documentKey: string; site: string; seen: Set<string>; pending: boolean; saturated: boolean }
const id = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
function snapshot(value: FindingSnapshot | null): FindingSnapshot | null {
  if (typeof value !== 'object' || value === null || typeof value.documentKey !== 'string' || !FINDING_DOCUMENT_KEY.test(value.documentKey) || typeof value.site !== 'string' || value.site.length < 1 || value.site.length > 253 || !Array.isArray(value.keys) || value.keys.length < 1 || value.keys.length > MAX_FINDING_KEYS) return null;
  if (!value.keys.every(key => typeof key === 'string' && key.length > 0 && key.length <= 1024)) return null;
  return { documentKey: value.documentKey, site: value.site, keys: [...new Set(value.keys)].sort() };
}

export class FindingsSurfacer {
  private readonly tabs = new Map<number, Followed>();
  private readonly due = new Map<number, number>();
  private current: FindingsWindow | null = null;
  private timer: unknown = null;
  private timerAt = Infinity;
  private chain: Promise<void> = Promise.resolve();
  private lastAttempt: number | null = null;
  private seen = 0;
  private stopped = false;
  private readonly stats = { evaluations: 0, opened: 0, rejected: 0, stale: 0, removed: 0, removeFailed: 0, budget: 0 };
  constructor(private readonly deps: FindingsSurfaceDeps) {}

  schedule(tabId: number, delayMs = FINDINGS_GROUP_MS): void {
    if (this.stopped || !id(tabId)) return;
    if (!this.due.has(tabId) && this.due.size >= MAX_FINDINGS_SCHEDULED) { this.stats.budget++; return; }
    const at = this.deps.now() + (Number.isFinite(delayMs) ? Math.max(0, delayMs) : FINDINGS_GROUP_MS);
    if (at < (this.due.get(tabId) ?? Infinity)) this.due.set(tabId, at);
    this.arm();
  }
  scheduleAll(delayMs = 0): void { for (const tabId of this.tabs.keys()) this.schedule(tabId, delayMs); }
  activated(tabId: number): void { this.schedule(tabId, 0); }

  /** Baseline restored evidence is already historical, never a startup alert. */
  seed(entries: readonly { tabId: number; snapshot: FindingSnapshot | null }[]): void {
    if (this.stopped) return;
    for (const entry of entries.slice(-MAX_FINDINGS_TABS)) {
      const value = snapshot(entry.snapshot); if (!id(entry.tabId) || value === null) continue;
      const state = this.follow(entry.tabId, value); this.mark(state, value.keys); state.pending = false;
    }
  }
  /** Root verifies the exact extension page before adopting after SW restart. */
  adopt(value: FindingsWindow): boolean {
    if (this.stopped || this.current !== null || !id(value.windowId) || !id(value.tabId)) return false;
    const found = this.read(value.tabId);
    if (found === null || found.documentKey !== value.documentKey) return false;
    this.current = { ...value }; const state = this.follow(value.tabId, found); this.mark(state, found.keys); state.pending = false;
    return true;
  }
  closed(windowId: number): void {
    if (this.current?.windowId !== windowId) return;
    this.current = null; this.rescheduleWaiting();
  }
  forget(tabId: number): void {
    this.seen -= this.tabs.get(tabId)?.seen.size ?? 0;
    this.tabs.delete(tabId); this.due.delete(tabId);
    if (this.current?.tabId === tabId) void this.remove(this.current);
    this.arm();
  }
  stop(): void {
    this.stopped = true; this.tabs.clear(); this.due.clear(); this.seen = 0;
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null; this.timerAt = Infinity;
    if (this.current !== null) void this.remove(this.current);
  }
  snapshot(): { tabs: number; scheduled: number; waiting: number; seen: number; window: FindingsWindow | null; evaluations: number; opened: number; rejected: number; stale: number; removed: number; removeFailed: number; budget: number } {
    return { tabs: this.tabs.size, scheduled: this.due.size, waiting: [...this.tabs.values()].filter(state => state.pending).length,
      seen: this.seen, window: this.current && { ...this.current }, ...this.stats };
  }
  /** Useful to await settled browser operations in tests; does not advance timers. */
  async settled(): Promise<void> { await this.chain; }
  private read(tabId: number): FindingSnapshot | null { try { return snapshot(this.deps.snapshot(tabId)); } catch { return null; } }
  private follow(tabId: number, value: FindingSnapshot): Followed {
    let state = this.tabs.get(tabId);
    if (state?.documentKey === value.documentKey && state.site === value.site) return state;
    if (state !== undefined) this.forget(tabId);
    if (this.tabs.size >= MAX_FINDINGS_TABS) { const oldest = this.tabs.keys().next().value as number | undefined; if (oldest !== undefined) this.forget(oldest); this.stats.budget++; }
    state = { documentKey: value.documentKey, site: value.site, seen: new Set(), pending: false, saturated: false };
    this.tabs.set(tabId, state); return state;
  }
  private canMark(state: Followed, keys: readonly string[]): boolean {
    const fresh = keys.reduce((sum, key) => sum + (state.seen.has(key) ? 0 : 1), 0);
    if (state.seen.size + fresh <= MAX_FINDINGS_SEEN_PER_DOCUMENT && this.seen + fresh <= MAX_FINDINGS_SEEN) return true;
    // Keep existing keys instead of evicting them and reopening old findings.
    // Suppress this document until navigation/eviction once dedup storage is full.
    state.saturated = true; state.pending = false; this.stats.budget++; return false;
  }
  private mark(state: Followed, keys: readonly string[]): void {
    if (!this.canMark(state, keys)) return;
    for (const key of keys) {
      if (state.seen.has(key)) continue;
      state.seen.add(key); this.seen++;
    }
  }
  private valid(tabId: number, state: Followed): FindingSnapshot | null {
    if (this.stopped || this.tabs.get(tabId) !== state) return null;
    const value = this.read(tabId);
    return value?.documentKey === state.documentKey && value.site === state.site ? value : null;
  }
  private rescheduleWaiting(): void { if (!this.stopped) for (const [tabId, state] of this.tabs) if (state.pending) this.schedule(tabId, 0); }
  private arm(): void {
    if (this.stopped) return;
    const next = Math.min(...this.due.values());
    if (this.timer !== null && this.timerAt <= next) return;
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null; this.timerAt = next;
    if (next === Infinity) return;
    this.timer = this.deps.setTimer(() => {
      this.timer = null; this.timerAt = Infinity;
      const now = this.deps.now(), tabs = [...this.due].filter(([, at]) => at <= now).map(([tabId]) => tabId);
      for (const tabId of tabs) this.due.delete(tabId);
      this.chain = this.chain.then(async () => { for (const tabId of tabs) await this.evaluate(tabId); }).catch(() => { this.stats.rejected++; }).finally(() => this.arm());
    }, Math.max(0, next - this.deps.now()));
  }
  private async remove(value: FindingsWindow): Promise<void> {
    try {
      await this.deps.remove(value.windowId); this.stats.removed++;
      if (this.current?.windowId === value.windowId) this.current = null;
      this.rescheduleWaiting();
    } catch {
      this.stats.removeFailed++;
      // Keep a slot reserved when removal failed; never create a second window.
      if (this.current === null) this.current = value;
    }
  }
  private async tab(tabId: number): Promise<FindingsTab | null> { try { return await this.deps.tab(tabId); } catch { return null; } }
  private async evaluate(tabId: number): Promise<void> {
    if (this.stopped) return;
    this.stats.evaluations++;
    const first = this.read(tabId);
    if (first === null) { this.forget(tabId); return; }
    const state = this.follow(tabId, first);
    if (state.saturated) return;
    const fresh = first.keys.filter(key => !state.seen.has(key));
    if (!fresh.length) { state.pending = false; return; }
    if (!this.canMark(state, first.keys)) return;
    state.pending = true;
    if (this.current !== null) {
      const current = this.current;
      let exists = true; try { exists = await this.deps.existing(current.windowId); } catch { /* Reserve the slot on uncertainty. */ }
      if (!this.valid(tabId, state)) return;
      if (this.current !== current) { this.schedule(tabId, 0); return; }
      if (!exists) { this.current = null; this.schedule(tabId, 0); return; }
      if (current.tabId === tabId && current.documentKey === first.documentKey) { this.mark(state, first.keys); state.pending = false; }
      return;
    }
    const source = await this.tab(tabId);
    if (!this.valid(tabId, state) || source === null || !id(source.windowId) || !source.active || !source.focused) return;
    const now = this.deps.now();
    if (this.lastAttempt !== null && now - this.lastAttempt < FINDINGS_OPEN_INTERVAL_MS) { this.schedule(tabId, FINDINGS_OPEN_INTERVAL_MS - (now - this.lastAttempt)); return; }
    const finalSource = await this.tab(tabId), final = this.valid(tabId, state);
    if (final === null || this.current !== null || finalSource === null || !finalSource.active || !finalSource.focused || finalSource.windowId !== source.windowId) return;
    this.lastAttempt = this.deps.now();
    let windowId: number | null;
    try { windowId = await this.deps.show(tabId, first.documentKey, source.windowId); } catch { this.stats.rejected++; return; }
    if (!id(windowId)) { this.stats.rejected++; return; }
    const created = { windowId, tabId, documentKey: first.documentKey };
    const afterSource = await this.tab(tabId), after = this.valid(tabId, state);
    if (after === null || this.current !== null || afterSource === null || !afterSource.active || !afterSource.focused || afterSource.windowId !== source.windowId || !this.canMark(state, after.keys)) {
      this.stats.stale++; await this.remove(created); return;
    }
    this.current = created; this.stats.opened++; this.mark(state, after.keys); state.pending = false;
  }
}
