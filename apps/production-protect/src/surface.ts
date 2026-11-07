// ADR-047 (S4b, owner requirement 2026-10-18 «фаерволл должен быть попапом при обнаружении слежки и утечки, а не частью
// меню находок»): the firewall of the module «Защита» surfaces as its own action popup (firewall.html) when a prompt
// that needs the user's decision appears in a tab. State machine only; every browser call goes through SurfaceDeps
// (sw-entry.ts binds chrome.action / tabs / windows / runtime.getContexts), so it is unit-tested without a browser.
//   - Trigger: the tab has receivers waiting for a decision (the vendored firewall prompt: value-match evidence
//     `third-party-before-submit`, confidence >= medium, no decision yet; the strict preset decides by itself and its
//     receivers do not wait; warn-only prompts wait for «Понятно»). Muted while the module is not active, while prompts
//     are snoozed («Не беспокоить 1 час») or the firewall feature is off; an excluded site never waits.
//   - The tab gets the per-tab popup firewall.html?tab=<id> (setPopup) for as long as something waits; then the
//     manifest's default popup comes back (setPopup with the default path: Chromium 153 treats '' as «no popup»).
//     Chromium resets per-tab popups on every committed navigation, so a commit makes the tab's popup «unknown» again.
//   - openPopup only for a (site, receiver) not surfaced before (until decided, dismissed or snoozed), only when its
//     tab is the active tab of a focused window, never while a popup is already open (the open firewall popup polls
//     and shows every waiting receiver of the tab together), at most once per window per 10 s. A rejected openPopup is
//     not retried: the per-tab popup and the module badge (B3) stay, so the next click on the icon opens the firewall.
//   - Bounded: tabs, (site, receiver) keys, windows and scheduled evaluations are capped; the oldest entry goes first.
// No URL, value or path is kept: tab ids, window ids, site names and receiver domains only.

export const FIREWALL_POPUP_PAGE = 'firewall.html';
/** At most one openPopup per window in this interval. */
export const FIREWALL_OPEN_INTERVAL_MS = 10_000;
/** Evidence of a burst is evaluated together: one popup shows every receiver of the burst. */
export const FIREWALL_GROUP_MS = 300;
/** A navigation is evaluated once more after this delay (the module's tab model and prompt settle). */
export const FIREWALL_SETTLE_MS = 1000;
export const MAX_SURFACE_TABS = 256;
export const MAX_SURFACED_KEYS = 512;
export const MAX_SURFACE_WINDOWS = 64;
/** The vendored PROTECT_BUDGETS.maxPromptReceivers. */
export const MAX_SURFACE_RECEIVERS = 8;
const MAX_SCHEDULED = 1024;
const MAX_ERROR_CHARS = 120;

/** What the module says about a tab right now. */
export interface SurfacePending {
  /** Top-level site of the tab, or null (no document known to the module). */
  site: string | null;
  /** Receivers (registrable domains) waiting for the user's decision in the tab's prompt. */
  receivers: readonly string[];
  /** Prompts are muted module-wide: not active, snoozed, or the firewall feature is off. */
  muted: boolean;
}

export interface SurfaceTabInfo {
  windowId: number;
  active: boolean;
}

export interface SurfaceDeps {
  /** ADR-052: production uses the dedicated bottom-right findings window for automatic alerts. */
  autoOpen?: boolean;
  now(): number;
  pending(tabId: number): SurfacePending;
  setPopup(tabId: number, popup: string): Promise<void>;
  getPopup(tabId: number): Promise<string>;
  openPopup(windowId: number): Promise<void>;
  tab(tabId: number): Promise<SurfaceTabInfo | null>;
  windowFocused(windowId: number): Promise<boolean>;
  /** An action popup of the extension is open (runtime.getContexts reports no window for popups). */
  popupOpen(): Promise<boolean>;
  /** The manifest's default popup (action.default_popup). */
  defaultPopup(): string;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export type SurfaceOpenResult = 'opened' | 'rejected';

export interface SurfaceStats {
  evaluations: number;
  popupsSet: number;
  popupsRestored: number;
  setFailures: number;
  openAttempts: number;
  opened: number;
  openRejected: number;
  rateLimited: number;
  notActive: number;
  notFocused: number;
  popupAlreadyOpen: number;
  adopted: number;
  lastOpen: SurfaceOpenResult | null;
  /** Message of the last rejected openPopup (at most 120 chars; a browser message, never page data). */
  lastOpenError: string | null;
}

export type SurfacePopupState = 'firewall' | 'default' | 'unknown';

interface TabSurface {
  /** What this tab's action popup is: ours, the default, or unknown (after a commit or a service-worker restart). */
  popup: SurfacePopupState;
  site: string | null;
  receivers: string[];
  /** Fresh receivers wait for the tab to become active in a focused window (or for the rate limit). */
  waiting: boolean;
  /** Found with our popup after a service-worker restart: what waits now was surfaced before the restart. */
  adopted: boolean;
}

function isTabId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** A returned focus does not activate a different tab. Re-evaluate its waiting prompt through the usual limits. */
export async function resumeFocusedFirewall(
  windowId: number,
  queryTabs: (windowId: number) => Promise<readonly { id?: number | undefined; windowId: number; active: boolean }[]>,
  activate: (tabId: number) => void,
): Promise<void> {
  // WINDOW_ID_NONE and closed windows must not become a query for the last active window.
  if (!isTabId(windowId)) return;
  try {
    const tab = (await queryTabs(windowId))[0];
    if (tab !== undefined && isTabId(tab.id) && tab.windowId === windowId && tab.active) activate(tab.id);
  } catch {
    // The window can close before tabs.query resolves. Another browser event will re-evaluate surviving tabs.
  }
}

function isName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 253;
}

/** firewall.html?tab=<id> (relative to the extension root, as setPopup expects). */
export function firewallPopupPath(tabId: number): string {
  return FIREWALL_POPUP_PAGE + '?tab=' + String(tabId);
}

/** True for a getPopup answer that is our firewall page (absolute or relative). */
export function isFirewallPopup(popup: unknown): boolean {
  if (typeof popup !== 'string') return false;
  const path = popup.replace(/^chrome-extension:\/\/[^/]+\//, '');
  return path === FIREWALL_POPUP_PAGE || path.startsWith(FIREWALL_POPUP_PAGE + '?');
}

function keyOf(site: string, receiver: string): string {
  return site + '\n' + receiver;
}

function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : 'unknown error';
  return text.slice(0, MAX_ERROR_CHARS);
}

export class FirewallSurfacer {
  private readonly tabs = new Map<number, TabSurface>();
  private readonly surfaced = new Set<string>();
  private readonly lastOpen = new Map<number, number>();
  private readonly due = new Map<number, number>();
  private readonly again = new Set<number>();
  private timer: unknown = null;
  private timerAt = 0;
  private chain: Promise<void> = Promise.resolve();
  private stopped = false;
  readonly stats: SurfaceStats = {
    evaluations: 0,
    popupsSet: 0,
    popupsRestored: 0,
    setFailures: 0,
    openAttempts: 0,
    opened: 0,
    openRejected: 0,
    rateLimited: 0,
    notActive: 0,
    notFocused: 0,
    popupAlreadyOpen: 0,
    adopted: 0,
    lastOpen: null,
    lastOpenError: null,
  };

  constructor(private readonly deps: SurfaceDeps) {}

  /** Tabs the surfacer follows (tests, diagnostics). */
  get size(): number {
    return this.tabs.size;
  }

  /** (site, receiver) pairs that already opened a popup (tests, diagnostics). */
  get surfacedKeys(): number {
    return this.surfaced.size;
  }

  /** The tab's popup as the surfacer believes it is, or null for an untracked tab. */
  popupOf(tabId: number): SurfacePopupState | null {
    return this.tabs.get(tabId)?.popup ?? null;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Triggers
  // ---------------------------------------------------------------------------------------------------------------

  /** Evaluates the tab after `delayMs` (the earliest request wins). */
  schedule(tabId: number, delayMs: number = FIREWALL_GROUP_MS): void {
    if (this.stopped || !isTabId(tabId)) return;
    if (!this.due.has(tabId) && this.due.size >= MAX_SCHEDULED) return;
    const at = this.deps.now() + Math.max(0, delayMs);
    const prev = this.due.get(tabId);
    if (prev === undefined || at < prev) this.due.set(tabId, at);
    this.arm();
  }

  /** Every followed tab (module-wide changes: snooze, settings, disable, exclusions, rule removal). */
  scheduleAll(delayMs = 0): void {
    for (const tabId of this.tabs.keys()) this.schedule(tabId, delayMs);
  }

  /**
   * The production badge recomputed the tab (B3 asks protectHost.badgeFor): `count` firewall prompts wait there.
   * Synchronous and cheap; an evaluation is scheduled only when the popup may have to change.
   */
  observe(tabId: number, count: number): void {
    if (this.stopped || !isTabId(tabId)) return;
    const s = this.tabs.get(tabId);
    if (count > 0) {
      if (s === undefined || s.popup !== 'firewall' || s.receivers.length !== count) this.schedule(tabId);
    } else if (s !== undefined) this.schedule(tabId);
  }

  /** A committed top-level navigation: Chromium has reset the tab's popup; evaluate now and once more later. */
  navigated(tabId: number): void {
    const s = this.tabs.get(tabId);
    if (s === undefined) return;
    s.popup = 'unknown';
    this.again.add(tabId);
    this.schedule(tabId);
  }

  /** The tab became active: a receiver that waited for it may surface now. */
  activated(tabId: number): void {
    if (this.tabs.get(tabId)?.waiting === true) this.schedule(tabId, 0);
  }

  /** The tab is gone (its per-tab popup with it). */
  forget(tabId: number): void {
    this.tabs.delete(tabId);
    this.due.delete(tabId);
    this.again.delete(tabId);
  }

  /**
   * After a service-worker restart: tabs that still carry our popup are followed again (their waiting receivers were
   * surfaced before the restart and do not open a popup again); the others are left alone.
   */
  async adopt(tabIds: readonly number[]): Promise<void> {
    for (const tabId of tabIds.slice(0, MAX_SURFACE_TABS)) {
      if (this.stopped || !isTabId(tabId) || this.tabs.has(tabId)) continue;
      let popup: string;
      try {
        popup = await this.deps.getPopup(tabId);
      } catch {
        continue;
      }
      if (!isFirewallPopup(popup)) continue;
      const s = this.track(tabId);
      if (s === null) return;
      s.popup = 'firewall';
      s.adopted = true;
      this.stats.adopted++;
      this.schedule(tabId, 0);
    }
  }

  /** Resolves when the evaluations already started have finished (tests with their own clock). */
  async settled(): Promise<void> {
    let current: Promise<void>;
    do {
      current = this.chain;
      await current;
    } while (current !== this.chain);
  }

  /** Resolves when every scheduled evaluation ran, ignoring the delays (tests). */
  async idle(): Promise<void> {
    for (let i = 0; i < 64; i++) {
      await this.chain;
      if (this.due.size === 0) return;
      this.flush(true);
    }
    await this.chain;
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
    this.due.clear();
    this.again.clear();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Evaluation
  // ---------------------------------------------------------------------------------------------------------------

  private arm(): void {
    let earliest = Infinity;
    for (const at of this.due.values()) if (at < earliest) earliest = at;
    if (earliest === Infinity) return;
    if (this.timer !== null) {
      if (this.timerAt <= earliest) return;
      this.deps.clearTimer(this.timer);
    }
    this.timerAt = earliest;
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      this.flush(false);
    }, Math.max(0, earliest - this.deps.now()));
  }

  /** Runs the evaluations that are due (`all`: every scheduled one). One at a time, in order. */
  private flush(all: boolean): void {
    const now = this.deps.now();
    const ready: number[] = [];
    for (const [tabId, at] of this.due) if (all || at <= now) ready.push(tabId);
    for (const tabId of ready) {
      this.due.delete(tabId);
      this.chain = this.chain
        .then(() => this.evaluate(tabId))
        .catch(() => undefined)
        .then(() => {
          if (this.again.delete(tabId)) this.schedule(tabId, FIREWALL_SETTLE_MS);
        });
    }
    this.arm();
  }

  private track(tabId: number): TabSurface | null {
    let s = this.tabs.get(tabId);
    if (s !== undefined) return s;
    if (this.tabs.size >= MAX_SURFACE_TABS) {
      // Bounded: the oldest tab without our popup goes first; none -> the new tab is not followed.
      let victim: number | null = null;
      for (const [id, entry] of this.tabs) {
        if (entry.popup !== 'firewall') {
          victim = id;
          break;
        }
      }
      if (victim === null) return null;
      this.forget(victim);
    }
    s = { popup: 'unknown', site: null, receivers: [], waiting: false, adopted: false };
    this.tabs.set(tabId, s);
    return s;
  }

  private markSurfaced(site: string, receivers: readonly string[]): void {
    for (const r of receivers) {
      const k = keyOf(site, r);
      this.surfaced.delete(k);
      this.surfaced.add(k);
    }
    while (this.surfaced.size > MAX_SURFACED_KEYS) {
      const oldest = this.surfaced.values().next();
      if (oldest.done === true) break;
      this.surfaced.delete(oldest.value);
    }
  }

  private noteOpen(windowId: number, now: number): void {
    this.lastOpen.delete(windowId);
    this.lastOpen.set(windowId, now);
    while (this.lastOpen.size > MAX_SURFACE_WINDOWS) {
      const oldest = this.lastOpen.keys().next();
      if (oldest.done === true) break;
      this.lastOpen.delete(oldest.value);
    }
  }

  private async restore(tabId: number, s: TabSurface): Promise<void> {
    try {
      await this.deps.setPopup(tabId, this.deps.defaultPopup());
      this.stats.popupsRestored++;
    } catch {
      // The tab is gone or Chrome refused: nothing of ours is left to restore there.
      this.stats.setFailures++;
    }
    s.popup = 'default';
  }

  private readPending(tabId: number): SurfacePending {
    try {
      const p = this.deps.pending(tabId);
      const receivers = Array.isArray(p.receivers) ? p.receivers.filter(isName).slice(0, MAX_SURFACE_RECEIVERS) : [];
      return { site: isName(p.site) ? p.site : null, receivers, muted: p.muted === true };
    } catch {
      return { site: null, receivers: [], muted: false };
    }
  }

  private async evaluate(tabId: number): Promise<void> {
    if (this.stopped) return;
    this.stats.evaluations++;
    const p = this.readPending(tabId);
    // «Не беспокоить», module off, firewall feature off: the one-popup-per-(site, receiver) memory ends.
    if (p.muted) this.surfaced.clear();
    const receivers = p.muted || p.site === null ? [] : [...new Set(p.receivers)];
    const s = this.tabs.get(tabId);
    // Receivers that left the prompt on the same site were decided or dismissed: a later prompt may surface again.
    if (s !== undefined && s.site !== null && s.site === p.site) {
      for (const r of s.receivers) if (!receivers.includes(r)) this.surfaced.delete(keyOf(s.site, r));
    }
    if (receivers.length === 0 || p.site === null) {
      if (s !== undefined) {
        if (s.popup !== 'default') await this.restore(tabId, s);
        this.forget(tabId);
      }
      return;
    }
    const site = p.site;
    const t = this.track(tabId);
    if (t === null) return;
    t.site = site;
    t.receivers = receivers;
    if (t.adopted) {
      t.adopted = false;
      this.markSurfaced(site, receivers);
    }
    if (t.popup !== 'firewall') {
      try {
        await this.deps.setPopup(tabId, firewallPopupPath(tabId));
        t.popup = 'firewall';
        this.stats.popupsSet++;
      } catch {
        t.popup = 'unknown';
        this.stats.setFailures++;
        return;
      }
    }
    if (this.deps.autoOpen === false) {
      t.waiting = false;
      return;
    }
    const fresh = receivers.filter((r) => !this.surfaced.has(keyOf(site, r)));
    t.waiting = fresh.length > 0;
    if (fresh.length === 0) return;
    let info: SurfaceTabInfo | null = null;
    try {
      info = await this.deps.tab(tabId);
    } catch {
      info = null;
    }
    if (info === null || info.active !== true || !isTabId(info.windowId)) {
      this.stats.notActive++;
      return;
    }
    let focused = false;
    try {
      focused = (await this.deps.windowFocused(info.windowId)) === true;
    } catch {
      focused = false;
    }
    if (!focused) {
      this.stats.notFocused++;
      return;
    }
    let open = false;
    try {
      open = (await this.deps.popupOpen()) === true;
    } catch {
      open = false;
    }
    // Browser calls above can outlive a disable, decision, navigation or focus change.
    // Recheck the tab/window and the synchronous prompt before consuming its one-shot notification.
    try {
      const current = await this.deps.tab(tabId);
      if (current === null || !current.active || current.windowId !== info.windowId) { this.stats.notActive++; return; }
      if (!(await this.deps.windowFocused(info.windowId))) { this.stats.notFocused++; return; }
    } catch { return; }
    if (this.stopped || this.tabs.get(tabId) !== t) return;
    const currentPending = this.readPending(tabId);
    const currentReceivers = [...new Set(currentPending.receivers)];
    if (currentPending.muted || currentPending.site !== site || currentReceivers.length !== receivers.length || receivers.some(r => !currentReceivers.includes(r))) {
      this.schedule(tabId, 0);
      return;
    }
    if (open) {
      // The open popup (ours, or the main one with its firewall line) shows these receivers within its poll.
      this.markSurfaced(site, fresh);
      t.waiting = false;
      this.stats.popupAlreadyOpen++;
      return;
    }
    const now = this.deps.now();
    const last = this.lastOpen.get(info.windowId);
    if (last !== undefined && now - last < FIREWALL_OPEN_INTERVAL_MS) {
      this.stats.rateLimited++;
      this.schedule(tabId, last + FIREWALL_OPEN_INTERVAL_MS - now);
      return;
    }
    this.noteOpen(info.windowId, now);
    this.markSurfaced(site, fresh);
    t.waiting = false;
    this.stats.openAttempts++;
    try {
      await this.deps.openPopup(info.windowId);
      this.stats.opened++;
      this.stats.lastOpen = 'opened';
    } catch (error) {
      // Not retried: the per-tab popup and the badge stay; the next click on the icon opens the firewall.
      this.stats.openRejected++;
      this.stats.lastOpen = 'rejected';
      this.stats.lastOpenError = errorText(error);
    }
  }
}
