// Toolbar badge per tab (S12 / E13-03, spec V §7, ADR-003 v3). The text and tooltip come from the pure engine rule
// (badgeView: categories with findings, empty instead of '0'); this controller only coalesces changes and applies
// them through chrome.action. Bounded: one timer, at most BADGE_MAX_TABS_PER_FLUSH tabs per pass, at most
// BADGE_MAX_TRACKED tabs remembered. A failed API call is not retried (the next change of that tab marks it again).
// Nothing here is awaited inside a repository queue.
// ADR-020 §D (S09): firewall prompts of the module «Защита» waiting in a tab (BadgeInput.protectPending) take the
// badge: '1'…'9' / '9+' on the per-tab BADGE_FIREWALL_COLOR. The extension window never opens by itself.

import { badgeView } from '@detect-expert/engine';
import type { BadgeSub, BadgeTitle } from '@detect-expert/engine';
import type { ReportProjection, ScopeMode } from '@detect-expert/contracts';
import type { ActionLike, I18nLike } from './chrome-api';

export const BADGE_FLUSH_MS = 250;
/** S09: a second mark after a module event, for lanes that settle asynchronously (strict preset: a rule write first). */
export const BADGE_SETTLE_MS = 1000;
export const BADGE_MAX_TABS_PER_FLUSH = 64;
export const BADGE_MAX_TRACKED = 1024;
/** Neutral grey (Chrome's own secondary text colour): the badge is a count, never a warning colour. */
export const BADGE_COLOR = '#5F6368';
export const BADGE_TEXT_COLOR = '#FFFFFF';
/**
 * ADR-020 §D (S09): per-tab background while firewall prompts wait (the extension accent, not a warning red; white
 * text on it has a contrast of 6.87:1). Set only on tabs with pending prompts and reset to BADGE_COLOR afterwards, so a
 * tab that never had a prompt gets exactly the previous calls.
 */
export const BADGE_FIREWALL_COLOR = '#2456B3';

export interface BadgeApi {
  action?: ActionLike | undefined;
  i18n?: I18nLike | undefined;
}

/** What the badge of one tab is computed from: the projection of its top document and the current scope mode. */
export interface BadgeInput {
  report: ReportProjection | null;
  scopeMode: ScopeMode;
  /**
   * ADR-020 (S04): firewall prompts of the module «Защита» waiting in this tab (0 while the module is off or snoozed;
   * controller.pendingCount). S09: > 0 shows '1'…'9' / '9+' on BADGE_FIREWALL_COLOR; absent means 0.
   */
  protectPending?: number;
}

type Timer = ReturnType<typeof setTimeout>;

function isTabId(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export class BadgeController {
  private readonly dirty = new Set<number>();
  /** Last applied `text + '\u0000' + title` per tab (insertion order = age; bounded). */
  private readonly applied = new Map<number, string>();
  /** S09: tabs whose per-tab background is BADGE_FIREWALL_COLOR (bounded like `applied`). */
  private readonly firewallTabs = new Set<number>();
  private timer: Timer | null = null;
  /** S09: tabs marked again after BADGE_SETTLE_MS (one timer, bounded like `dirty`). */
  private readonly settling = new Set<number>();
  private settleTimer: Timer | null = null;
  private flushing = false;
  private stopped = false;

  constructor(
    private readonly api: BadgeApi,
    private readonly read: (tabId: number) => BadgeInput,
    private readonly listTabs: () => Promise<number[]>,
  ) {}

  private get action(): ActionLike | undefined {
    return this.stopped ? undefined : this.api.action;
  }

  /** Global colours, then every open tab. No-op without chrome.action. */
  start(): void {
    const action = this.action;
    if (action === undefined) return;
    try {
      void action.setBadgeBackgroundColor({ color: BADGE_COLOR }).catch(() => undefined);
      if (typeof action.setBadgeTextColor === 'function') void action.setBadgeTextColor({ color: BADGE_TEXT_COLOR }).catch(() => undefined);
    } catch {
      // An action API that throws synchronously only costs the colours.
    }
    this.markAll();
  }

  markTab(tabId: number): void {
    if (this.action === undefined || !isTabId(tabId)) return;
    // Bounded: beyond BADGE_MAX_TRACKED pending tabs a mark is dropped (the next change of that tab marks it again).
    if (!this.dirty.has(tabId) && this.dirty.size >= BADGE_MAX_TRACKED) return;
    this.dirty.add(tabId);
    this.schedule();
  }

  /**
   * S09: marks the tab now and once more after BADGE_SETTLE_MS (a firewall prompt may be added after an asynchronous
   * step of its lane, e.g. the strict preset writes its rule first). Coalesced into one timer.
   */
  markTabSettled(tabId: number): void {
    this.markTab(tabId);
    if (this.action === undefined || !isTabId(tabId)) return;
    if (!this.settling.has(tabId) && this.settling.size >= BADGE_MAX_TRACKED) return;
    this.settling.add(tabId);
    if (this.settleTimer !== null) return;
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      const tabs = [...this.settling];
      this.settling.clear();
      for (const id of tabs) this.markTab(id);
    }, BADGE_SETTLE_MS);
  }

  /** Document key `tabId:frameId:documentId` -> its tab (trusted ids only; anything else is ignored). */
  markDocument(documentKey: string): void {
    const colon = documentKey.indexOf(':');
    if (colon <= 0) return;
    const tabId = Number(documentKey.slice(0, colon));
    if (isTabId(tabId)) this.markTab(tabId);
  }

  /** Every open tab (scope or permission change, session clear, start). */
  markAll(): void {
    if (this.action === undefined) return;
    let pending: Promise<number[]>;
    try {
      pending = this.listTabs();
    } catch {
      return;
    }
    void pending.then((ids) => {
      for (const id of ids.slice(0, BADGE_MAX_TRACKED)) this.markTab(id);
    }, () => undefined);
  }

  /** Closed or replaced tab: Chrome resets its per-tab badge itself. */
  forget(tabId: number): void {
    this.dirty.delete(tabId);
    this.applied.delete(tabId);
    this.firewallTabs.delete(tabId);
    this.settling.delete(tabId);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.settleTimer !== null) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
    this.dirty.clear();
    this.applied.clear();
    this.firewallTabs.clear();
    this.settling.clear();
  }

  private schedule(): void {
    if (this.timer !== null || this.flushing || this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, BADGE_FLUSH_MS);
  }

  /** One pass: at most BADGE_MAX_TABS_PER_FLUSH tabs; the rest waits for the next timer. */
  async flush(): Promise<void> {
    if (this.flushing) return;
    const action = this.action;
    if (action === undefined) return;
    this.flushing = true;
    try {
      const batch: number[] = [];
      for (const id of this.dirty) {
        if (batch.length >= BADGE_MAX_TABS_PER_FLUSH) break;
        batch.push(id);
      }
      for (const id of batch) this.dirty.delete(id);
      await Promise.all(batch.map((id) => this.applyTab(action, id)));
    } finally {
      this.flushing = false;
    }
    if (this.dirty.size > 0) this.schedule();
  }

  private async applyTab(action: ActionLike, tabId: number): Promise<void> {
    let text: string;
    let title: string;
    let firewall: boolean;
    try {
      const input = this.read(tabId);
      const pending = input.protectPending;
      // Absent or 0: exactly the observation badge (badgeView without the third argument).
      const view = pending !== undefined && pending > 0 ? badgeView(input.report, input.scopeMode, { pending }) : badgeView(input.report, input.scopeMode);
      text = view.text;
      title = this.resolveTitle(view.title);
      firewall = view.tone === 'firewall';
    } catch {
      return;
    }
    const signature = (firewall ? 'fw\u0000' : '') + text + '\u0000' + title;
    if (this.applied.get(tabId) === signature) return;
    this.remember(tabId, signature);
    // Per-tab colour only while prompts wait, and one reset after; other tabs keep the global neutral colour untouched.
    const colour = this.colourChange(tabId, firewall);
    try {
      const calls: Array<Promise<void>> = [action.setBadgeText({ tabId, text }), action.setTitle({ tabId, title })];
      if (colour !== null) calls.push(action.setBadgeBackgroundColor({ tabId, color: colour }));
      await Promise.all(calls);
    } catch {
      // Closed tab or API failure: forget the state, no retry (bounded).
      if (this.applied.get(tabId) === signature) this.applied.delete(tabId);
      if (firewall) this.firewallTabs.delete(tabId);
    }
  }

  /** The per-tab background to set now, or null when it does not change. */
  private colourChange(tabId: number, firewall: boolean): string | null {
    if (firewall) {
      if (this.firewallTabs.has(tabId)) return null;
      if (this.firewallTabs.size >= BADGE_MAX_TRACKED) {
        const oldest = this.firewallTabs.values().next();
        if (oldest.done !== true) this.firewallTabs.delete(oldest.value);
      }
      this.firewallTabs.add(tabId);
      return BADGE_FIREWALL_COLOR;
    }
    if (!this.firewallTabs.delete(tabId)) return null;
    return BADGE_COLOR;
  }

  private remember(tabId: number, signature: string): void {
    this.applied.delete(tabId);
    if (this.applied.size >= BADGE_MAX_TRACKED) {
      const oldest = this.applied.keys().next();
      if (oldest.done !== true) this.applied.delete(oldest.value);
    }
    this.applied.set(tabId, signature);
  }

  /** chrome.i18n with nested keys resolved first; an empty or missing message falls back to the key itself. */
  private resolveTitle(title: BadgeTitle): string {
    const subs = title.subs.map((sub: BadgeSub) => (typeof sub === 'string' ? sub : this.message(sub.key, [])));
    return this.message(title.key, subs);
  }

  private message(key: string, subs: string[]): string {
    const i18n = this.api.i18n;
    if (i18n === undefined) return key;
    let text = '';
    try {
      text = subs.length === 0 ? i18n.getMessage(key) : i18n.getMessage(key, subs);
    } catch {
      text = '';
    }
    return typeof text === 'string' && text !== '' ? text : key;
  }
}
