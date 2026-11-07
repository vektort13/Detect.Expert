import { TECHNIQUE_IDS } from '@detect-expert/contracts';
import type { TechniqueId } from '@detect-expert/contracts';
import type { BackgroundChromeApi } from './chrome-api';
import type { DocumentEvent, DocumentsState, FrameBinding } from './documents';
import { MAX_BINDINGS_PER_TAB, MAX_DOCUMENTS_GLOBAL } from './documents';
import { BADGE_LANGUAGE_KEY, badgeLabel, badgeLanguage, badgeBrowserLanguage } from './badge-label';

// ADR-021: a count of observed technique families, never a fingerprinting/risk score.
const COUNTED_IDS = new Set<TechniqueId>(TECHNIQUE_IDS.filter((id) => id !== 'DET-067' && id !== 'DET-068'));
export const BADGE_UPDATE_MS = 250;
export const BADGE_BACKGROUND_COLOR = '#DC2626';
export const BADGE_TEXT_COLOR = '#FFFFFF';
const MAX_ACTION_OPERATIONS = 4;

function active(binding: FrameBinding): boolean {
  return binding.documentLifecycle === null || binding.documentLifecycle === 'active';
}

/** Count only browser-bound current documents; neither historical reports nor vendor findings count. */
export function countTabTechniques(state: DocumentsState, tabId: number, hasAccess: (key: string) => boolean): number {
  const topKey = state.tabs.get(tabId)?.activeTopDocumentKey;
  if (!topKey || !hasAccess(topKey)) return 0;
  const bindings = new Map<string, FrameBinding>();
  for (const b of state.bindings.values()) {
    if (b.tabId === tabId && active(b)) bindings.set(b.documentId, b);
  }
  const top = [...bindings.values()].find((b) => b.documentKey === topKey && b.frameId === 0);
  if (!top || top.accessGranted === false) return 0;
  const techniques = new Set<TechniqueId>();
  for (const binding of bindings.values()) {
    let cursor: FrameBinding | undefined = binding;
    const seen = new Set<string>();
    while (cursor.documentKey !== topKey && seen.size < MAX_BINDINGS_PER_TAB) {
      if (seen.has(cursor.documentId) || cursor.parentDocumentId === null) { cursor = undefined; break; }
      seen.add(cursor.documentId);
      cursor = bindings.get(cursor.parentDocumentId);
      if (!cursor) break;
    }
    if (!cursor || cursor.documentKey !== topKey) continue;
    const meta = state.metas.get(binding.documentKey);
    if (!meta?.bound || meta.revoked || meta.accessGranted === false || binding.accessGranted === false || !hasAccess(binding.documentKey)) continue;
    const report = state.reports.get(binding.documentKey);
    if (!report || report.tabId !== tabId) continue;
    for (const counter of report.counters) {
      if (counter.count > 0 && COUNTED_IDS.has(counter.techniqueId)) techniques.add(counter.techniqueId);
    }
    for (const counter of meta.networkCounters ?? []) {
      if (counter.count > 0 && COUNTED_IDS.has(counter.techniqueId)) techniques.add(counter.techniqueId);
    }
  }
  return techniques.size;
}

interface Work {
  version: number;
  dirty: boolean;
  inFlight: boolean;
  removed: boolean;
}

/** Event-driven, bounded presentation work. A hung Chrome call keeps its physical concurrency slot. */
export class BadgeManager {
  private readonly work = new Map<number, Work>();
  private readonly displayed = new Map<number, number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = 0;
  private started = false;
  private stopped = false;
  private language: string | null = null;
  private languageRevision = 0;
  private readonly onLanguageChanged = (changes: Record<string, { newValue?: unknown }>, area: string): void => {
    if (this.stopped || area !== 'local' || !(BADGE_LANGUAGE_KEY in changes)) return;
    const value = changes[BADGE_LANGUAGE_KEY]?.newValue;
    this.languageRevision++;
    this.updateLanguage(badgeLanguage(value));
  };

  constructor(private readonly api: BackgroundChromeApi, private readonly state: () => DocumentsState,
    private readonly hasAccess: (key: string) => boolean) {}

  start(): void {
    if (this.started || this.stopped || !this.api.action) return;
    this.started = true;
    this.api.storage.onChanged?.addListener(this.onLanguageChanged);
    const languageRevision = this.languageRevision;
    void this.api.storage.local.get(BADGE_LANGUAGE_KEY).then(data => {
      if (!this.stopped && this.languageRevision === languageRevision) this.updateLanguage(badgeLanguage(data[BADGE_LANGUAGE_KEY]));
    }).catch(() => undefined);
    this.markAll();
    // Chrome retains tab badges across normal worker suspension. Also clear tabs without restored reports.
    void this.api.tabs.query({}).then((tabs) => {
      if (this.stopped) return;
      for (const tab of tabs.slice(0, MAX_DOCUMENTS_GLOBAL)) if (typeof tab.id === 'number') this.mark(tab.id);
    }).catch(() => undefined);
  }

  stop(): void {
    this.stopped = true;
    this.api.storage.onChanged?.removeListener?.(this.onLanguageChanged);
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.work.clear();
    this.displayed.clear();
  }

  private updateLanguage(language: string | null): void {
    if (this.language === language) return;
    this.language = language;
    for (const tabId of this.work.keys()) this.mark(tabId);
    this.markAll();
    this.displayed.clear();
  }

  mark(tabId: number): void {
    if (this.stopped || !this.api.action || !Number.isInteger(tabId) || tabId < 0) return;
    let item = this.work.get(tabId);
    if (!item) {
      if (this.work.size >= MAX_DOCUMENTS_GLOBAL) return;
      item = { version: 0, dirty: false, inFlight: false, removed: false };
      this.work.set(tabId, item);
    }
    item.version++;
    item.dirty = true;
    item.removed = false;
    this.schedule();
  }

  markAll(): void {
    for (const tabId of this.displayed.keys()) this.mark(tabId);
    for (const tabId of this.state().tabs.keys()) this.mark(tabId);
  }

  afterEvent(event: DocumentEvent, before: DocumentsState): void {
    if (!this.api.action) return;
    if (event.type === 'tab:removed' || event.type === 'tab:replaced') {
      const removed = event.type === 'tab:removed' ? event.tabId : event.removedTabId;
      this.displayed.delete(removed);
      const item = this.work.get(removed);
      if (item?.inFlight) { item.version++; item.removed = true; item.dirty = false; }
      else this.work.delete(removed);
      if (event.type === 'tab:replaced') this.mark(event.addedTabId);
    } else if ('tabId' in event) this.mark(event.tabId);
    else if (event.type === 'batch') this.mark(event.sender.tabId);
    else if ('documentKey' in event) this.markDocument(event.documentKey, before);
    else if ('documentKeys' in event) for (const key of event.documentKeys) this.markDocument(key, before);
    else if (event.type === 'ttl-tick') this.markAll();
  }

  private markDocument(key: string, before: DocumentsState): void {
    const report = before.reports.get(key) ?? this.state().reports.get(key);
    if (report) { this.mark(report.tabId); return; }
    for (const binding of before.bindings.values()) if (binding.documentKey === key) { this.mark(binding.tabId); return; }
  }

  private schedule(): void {
    if (!this.started || this.stopped || this.timer !== null || this.running >= MAX_ACTION_OPERATIONS) return;
    if (![...this.work.values()].some((item) => item.dirty && !item.inFlight)) return;
    this.timer = setTimeout(() => { this.timer = null; this.drain(); }, BADGE_UPDATE_MS);
  }

  private drain(): void {
    if (this.stopped) return;
    for (const [tabId, item] of this.work) {
      if (this.running >= MAX_ACTION_OPERATIONS) break;
      if (!item.dirty || item.inFlight || item.removed) continue;
      item.dirty = false;
      item.inFlight = true;
      this.running++;
      void this.update(tabId, item).finally(() => {
        this.running--;
        item.inFlight = false;
        if (!item.dirty && this.work.get(tabId) === item) this.work.delete(tabId);
        this.schedule();
      });
    }
    this.schedule();
  }

  private async update(tabId: number, item: Work): Promise<void> {
    const action = this.api.action;
    if (!action) return;
    const version = item.version;
    const current = (): boolean => !this.stopped && !item.removed && item.version === version && this.work.get(tabId) === item;
    let count = countTabTechniques(this.state(), tabId, this.hasAccess);
    if (count > 0) {
      // DOM removal may emit no navigation event. This bounded read runs only for dirty tabs,
      // shares the four physical async slots, and never creates a periodic page poll.
      let frames: Awaited<ReturnType<BackgroundChromeApi['webNavigation']['getAllFrames']>>;
      try { frames = await this.api.webNavigation.getAllFrames({ tabId }); } catch { return; }
      if (!current()) return;
      if (!Array.isArray(frames) || frames.length > MAX_DOCUMENTS_GLOBAL || frames.some((f) => typeof f.documentId !== 'string' || !Number.isInteger(f.frameId))) return;
      const live = new Map(frames.map((frame) => [frame.frameId, frame]));
      const state = this.state();
      const bindings = new Map(state.bindings);
      for (const [id, binding] of bindings) {
        if (binding.tabId !== tabId) continue;
        const frame = live.get(binding.frameId);
        // Non-enumerable opaque children cannot be proven removed by this API alone. Their
        // existing trusted ancestor chain still has to lead to the enumerated current root.
        const unknownOpaque = !frame && binding.frameId !== 0 && binding.scheme === undefined;
        if (!unknownOpaque && (!frame || frame.documentId !== binding.documentId ||
            (frame.documentLifecycle !== undefined && frame.documentLifecycle !== 'active'))) bindings.delete(id);
      }
      count = countTabTechniques({ ...state, bindings }, tabId, this.hasAccess);
    }
    if (this.displayed.get(tabId) === count) return;
    // An already-issued native write cannot be cancelled. Never mistake the old cached value
    // for the value Chrome will eventually display if state changes while the write awaits.
    this.displayed.delete(tabId);
    let label = 'Observed techniques in this tab and its frames: ' + count;
    try { label = this.api.i18n?.getMessage('badge_tooltip', String(count)) || label; } catch { /* presentation fallback */ }
    let language = this.language;
    try {
      const browserLanguage = this.api.i18n?.getUILanguage?.();
      if (language === null && browserLanguage !== undefined) language = badgeBrowserLanguage(browserLanguage);
    } catch { /* Older test adapters may omit the browser language. */ }
    label = badgeLabel(language, count) ?? label;
    const operations = [
      () => action.setBadgeBackgroundColor({ tabId, color: BADGE_BACKGROUND_COLOR }),
      () => action.setBadgeTextColor({ tabId, color: BADGE_TEXT_COLOR }),
      () => action.setTitle({ tabId, title: 'Detect Expert — ' + label }),
      () => action.setBadgeText({ tabId, text: count === 0 ? '' : String(count) }),
    ];
    let ok = true;
    for (const operation of operations) {
      if (!current()) return;
      try { await operation(); } catch { ok = false; }
    }
    if (ok && current()) {
      // Cache at most the report admission bound; eviction only causes a later harmless repaint.
      if (this.displayed.size >= MAX_DOCUMENTS_GLOBAL && !this.displayed.has(tabId)) this.displayed.delete(this.displayed.keys().next().value!);
      this.displayed.set(tabId, count);
    }
  }
}
