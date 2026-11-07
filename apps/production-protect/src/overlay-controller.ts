// ADR-058: document-bound ISOLATED delivery. No page bridge, browser window, rule mutation or storage.
import type { ProtectProjection, ProtectState } from '@detect-expert/contracts';
import { positiveFindingSnapshot } from './findings';
import type { FindingSnapshot } from './findings';
import type { OverlayActionMessage, OverlayKind } from './overlay-protocol';
export type { OverlayKind, OverlayShowMessage } from './overlay-protocol';

export type OverlayActionName = OverlayActionMessage['action'];
export interface OverlayTarget { tabId: number; documentId: string; documentKey: string }
export interface OverlaySnapshot { target: OverlayTarget; state: ProtectState; report: ProtectProjection | null; locale: string }
export interface OverlayAction {
  target: OverlayTarget; kind: OverlayKind; generation: number; action: OverlayActionName; request?: unknown;
}
interface NativeTab { id?: number; windowId?: number; active?: boolean; url?: string; pendingUrl?: string }
export interface OverlayBrowserApi {
  runtime: { id: string };
  tabs: {
    get(tabId: number): Promise<NativeTab>;
    sendMessage(tabId: number, message: unknown, options: { documentId: string; frameId: 0 }): Promise<unknown>;
  };
  windows: { get(windowId: number): Promise<{ focused?: boolean; type?: string }> };
  webNavigation: { getFrame(details: { tabId: number; frameId: 0 }): Promise<{ documentId?: string; url?: string; errorOccurred?: boolean; documentLifecycle?: string } | null> };
  scripting: { executeScript(details: { target: { tabId: number; documentIds: string[] }; world: 'ISOLATED'; files: string[] }): Promise<unknown> };
}
export interface OverlayControllerDeps {
  /** Current controller-gated top-level state/report, never data supplied by a web page. */
  snapshot(tabId: number, kind: OverlayKind): OverlaySnapshot | null;
  api?: OverlayBrowserApi;
  now?(): number;
  setTimer?(callback: () => void, milliseconds: number): unknown;
  clearTimer?(handle: unknown): void;
  generation?(): number;
}
export const OVERLAY_MAX_TABS = 64;
export const OVERLAY_MAX_SEEN = 1024;
export const OVERLAY_MAX_SEEN_PER_DOCUMENT = 128;
export const OVERLAY_GROUP_MS = 300;
export const OVERLAY_OPEN_INTERVAL_MS = 10_000;
export const OVERLAY_NATIVE_TIMEOUT_MS = 3000;
const MAX_SCHEDULED = 1024;
const DOCUMENT = /^[A-Za-z0-9_-]{1,64}$/;
const ACTIONS: readonly string[] = ['refresh', 'close', 'decide', 'undo', 'dismiss', 'snooze', 'settings'];
const own = (object: unknown, key: string): unknown => object !== null && typeof object === 'object' ? Object.getOwnPropertyDescriptor(object, key)?.value : undefined;
const id = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const kindOf = (value: unknown): value is OverlayKind => value === 'activation' || value === 'findings';
function targetOf(value: unknown): value is OverlayTarget {
  const tabId = own(value, 'tabId'), documentId = own(value, 'documentId');
  return id(tabId) && typeof documentId === 'string' && DOCUMENT.test(documentId) && own(value, 'documentKey') === `${tabId}:0:${documentId}`;
}
function sameTarget(a: OverlayTarget, b: OverlayTarget): boolean { return a.tabId === b.tabId && a.documentId === b.documentId && a.documentKey === b.documentKey; }
function http(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > 16_384) return false;
  try { const url = new URL(value); return (url.protocol === 'http:' || url.protocol === 'https:') && url.username === '' && url.password === ''; } catch { return false; }
}
let generationCounter = Date.now() * 1000;
function freshGeneration(): number { return ++generationCounter; }
/** Bounded data-only clone: do not invoke a getter while preparing an isolated UI message. */
function cloneData(value: unknown, maxNodes = 30_000): unknown {
  let nodes = 0, characters = 0;
  const visit = (item: unknown, depth: number): unknown => {
    if (++nodes > maxNodes || depth > 20) throw new Error('overlay-data-limit');
    if (item === null || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (typeof item === 'string') { characters += item.length; if (item.length > 4096 || characters > 131_072) throw new Error('overlay-text-limit'); return item; }
    if (typeof item !== 'object' || item === null) throw new Error('overlay-data-type');
    if (Array.isArray(item)) {
      if (item.length > 4096) throw new Error('overlay-array-limit');
      const result: unknown[] = [];
      for (let index = 0; index < item.length; index++) {
        const field = Object.getOwnPropertyDescriptor(item, String(index));
        if (!field || !Object.hasOwn(field, 'value')) throw new Error('overlay-accessor');
        result.push(visit(field.value, depth + 1));
      }
      return result;
    }
    if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw new Error('overlay-data-prototype');
    const keys = Reflect.ownKeys(item);
    if (keys.length > 128) throw new Error('overlay-object-limit');
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      if (typeof key !== 'string' || key.length > 128 || key === '__proto__') throw new Error('overlay-data-key');
      const field = Object.getOwnPropertyDescriptor(item, key);
      if (!field || !Object.hasOwn(field, 'value')) throw new Error('overlay-accessor');
      if (field.value !== undefined) result[key] = visit(field.value, depth + 1);
    }
    return result;
  };
  return visit(value, 0);
}
interface Handle { target: OverlayTarget; kind: OverlayKind; generation: number; activation?: number }
interface Followed { target: OverlayTarget; seen: Set<string>; saturated: boolean; handle: Handle | null }

export class ProtectOverlayController {
  private readonly api: OverlayBrowserApi;
  private readonly now: () => number;
  private readonly timerSet: (callback: () => void, milliseconds: number) => unknown;
  private readonly timerClear: (handle: unknown) => void;
  private readonly followed = new Map<number, Followed>();
  private readonly due = new Map<number, number>();
  private activation: Handle | null = null;
  private activationEpoch = 0;
  private lastActivation = 0;
  private lastOpen: number | null = null;
  private seen = 0;
  private timer: unknown = null;
  private timerAt = Infinity;
  private processing = false;
  private lifecycle = 0;
  private chain: Promise<void> = Promise.resolve();
  private readonly stats = { delivered: 0, rejected: 0, stale: 0, budget: 0, unauthorized: 0 };
  constructor(private readonly deps: OverlayControllerDeps) {
    this.api = deps.api ?? chrome as unknown as OverlayBrowserApi;
    this.now = deps.now ?? Date.now;
    this.timerSet = deps.setTimer ?? ((callback, milliseconds) => setTimeout(callback, milliseconds));
    this.timerClear = deps.clearTimer ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }
  schedule(tabId: number, delay = OVERLAY_GROUP_MS): void {
    if (!id(tabId)) return;
    if (!this.due.has(tabId) && this.due.size >= MAX_SCHEDULED) { this.stats.budget++; return; }
    const at = this.now() + (Number.isFinite(delay) ? Math.max(0, delay) : OVERLAY_GROUP_MS);
    if (at < (this.due.get(tabId) ?? Infinity)) this.due.set(tabId, at);
    this.arm();
  }
  scheduleAll(delay = 0): void { for (const tabId of this.followed.keys()) this.schedule(tabId, delay); }
  activated(tabId: number): void { this.schedule(tabId, 0); }
  seed(entries: readonly { tabId: number; snapshot: FindingSnapshot | null }[]): void {
    for (const entry of entries.slice(-OVERLAY_MAX_TABS)) {
      const snapshot = this.read(entry.tabId, 'findings');
      const found = snapshot && positiveFindingSnapshot(snapshot.report);
      if (!found || found.documentKey !== entry.snapshot?.documentKey) continue;
      const state = this.follow(snapshot.target); this.mark(state, found.keys);
    }
  }
  showActivation(tabId: number, activation: number, eligible: () => boolean): Promise<boolean> {
    if (!id(tabId) || !id(activation) || activation === 0 || activation <= this.lastActivation) return Promise.resolve(false);
    this.lastActivation = activation;
    const epoch = ++this.activationEpoch;
    return this.enqueue(async () => {
      const current = this.activation; this.activation = null;
      if (current !== null) await this.hide(current);
      const snapshot = this.read(tabId, 'activation');
      if (snapshot === null || !this.eligible(eligible) || epoch !== this.activationEpoch) return false;
      const handle = this.makeHandle(snapshot.target, 'activation', activation);
      if (handle === null) return false;
      this.activation = handle;
      const okay = await this.deliver(handle, () => this.activation === handle && epoch === this.activationEpoch && this.eligible(eligible));
      if (!okay && this.activation === handle) this.activation = null;
      return okay;
    });
  }
  cancelActivation(): void {
    this.activationEpoch++;
    const handle = this.activation; this.activation = null;
    if (handle !== null) void this.enqueue(() => this.hide(handle));
  }
  forget(tabId: number): void {
    this.due.delete(tabId);
    const state = this.followed.get(tabId);
    if (state) { this.seen -= state.seen.size; this.followed.delete(tabId); if (state.handle) void this.enqueue(() => this.hide(state.handle!)); }
    if (this.activation?.target.tabId === tabId) this.cancelActivation();
    this.arm();
  }
  closeAll(): void {
    this.lifecycle++;
    this.cancelActivation();
    for (const tabId of [...this.followed.keys()]) this.forget(tabId);
    this.due.clear(); this.arm();
  }
  /** Root separately validates the allowed request type, current prompt/receiver/revision and actual user action. */
  async handleAction(message: unknown, sender: unknown): Promise<OverlayAction | null> {
    const kind = own(message, 'kind'), generation = own(message, 'generation'), action = own(message, 'action');
    const senderTab = own(sender, 'tab'), tabId = own(senderTab, 'id');
    if (own(message, 'schemaVersion') !== 1 || own(message, 'type') !== 'protect-overlay-action' || !kindOf(kind) || !id(generation) || generation === 0 || typeof action !== 'string' || !ACTIONS.includes(action) || own(sender, 'id') !== this.api.runtime.id || own(sender, 'frameId') !== 0 || !id(tabId)) return this.rejectAction();
    const handle = kind === 'activation' ? this.activation : this.followed.get(tabId)?.handle;
    if (!handle || handle.target.tabId !== tabId || generation !== handle.generation || own(message, 'documentKey') !== handle.target.documentKey || own(sender, 'documentId') !== handle.target.documentId || !http(own(sender, 'url')) || own(sender, 'documentLifecycle') !== undefined && own(sender, 'documentLifecycle') !== 'active') return this.rejectAction();
    const request = own(message, 'request');
    if (kind === 'activation' && action !== 'close' && action !== 'settings' && action !== 'refresh') return this.rejectAction();
    let safeRequest: unknown;
    try { if (request !== undefined) safeRequest = cloneData(request, 256); } catch { return this.rejectAction(); }
    if (!await this.nativeCurrent(handle.target, true) || !this.isCurrent(handle)) return this.rejectAction();
    const snapshot = this.read(tabId, kind);
    if (snapshot === null || !sameTarget(snapshot.target, handle.target)) return this.rejectAction();
    return { target: { ...handle.target }, kind, generation, action: action as OverlayActionName, ...(safeRequest === undefined ? {} : { request: safeRequest }) };
  }
  close(tabId: number, kind: OverlayKind, generation?: number): Promise<void> {
    const handle = kind === 'activation' ? this.activation : this.followed.get(tabId)?.handle;
    if (!handle || handle.target.tabId !== tabId || generation !== undefined && handle.generation !== generation) return Promise.resolve();
    if (kind === 'activation') { this.activationEpoch++; this.activation = null; }
    else { const state = this.followed.get(tabId); if (state?.handle === handle) { const found = positiveFindingSnapshot(this.read(tabId, kind)?.report); if (found) this.mark(state, found.keys); state.handle = null; } }
    return this.enqueue(() => this.hide(handle));
  }
  refresh(tabId: number, kind: OverlayKind, generation?: number): Promise<boolean> {
    return this.enqueue(async () => {
      const handle = kind === 'activation' ? this.activation : this.followed.get(tabId)?.handle;
      if (!handle || handle.target.tabId !== tabId || generation !== undefined && handle.generation !== generation) return false;
      return this.deliver(handle, () => this.isCurrent(handle), false);
    });
  }
  diagnostics() { return { tabs: this.followed.size, scheduled: this.due.size, seen: this.seen, activation: this.activation !== null, ...this.stats }; }
  async settled(): Promise<void> { await this.chain; }
  private rejectAction(): null { this.stats.unauthorized++; return null; }
  private eligible(test: () => boolean): boolean { try { return test() === true; } catch { return false; } }
  private enqueue<T>(task: () => Promise<T>): Promise<T> { const next = this.chain.then(task, task); this.chain = next.then(() => undefined, () => undefined); return next; }
  private read(tabId: number, kind: OverlayKind): OverlaySnapshot | null {
    try {
      const source = this.deps.snapshot(tabId, kind);
      if (!source || !targetOf(source.target) || source.target.tabId !== tabId || typeof source.locale !== 'string' || !/^[A-Za-z_-]{2,16}$/.test(source.locale)) return null;
      const state = source.state;
      if (!state || state.organizationDisabled || state.organizationPolicyInvalid || state.consentVersion === null || state.consentVersion !== state.requiredConsentVersion || !state.permissions.broadHosts || !Array.isArray(state.features) || state.features.length < 1 || state.snoozedUntil !== null && state.snoozedUntil > this.now()) return null;
      if (kind === 'activation') return state.state === 'active' && (!state.features.some(feature => feature === 'firewall' || feature === 'gpc') || state.permissions.dnr) ? source : null;
      if (state.state !== 'active' && state.state !== 'degraded' || source.report === null || source.report.documentKey !== source.target.documentKey || source.report.limitations.includes('site-excluded') || source.report.site !== null && state.excludedSites.includes(source.report.site)) return null;
      const report = { ...source.report, features: source.report.features.filter(feature => state.features.includes(feature)) };
      return positiveFindingSnapshot(report) === null ? null : { ...source, report };
    } catch { return null; }
  }
  private async nativeCurrent(target: OverlayTarget, focused: boolean): Promise<boolean> {
    try {
      const tab = await this.bounded(() => this.api.tabs.get(target.tabId));
      if (tab.id !== target.tabId || !id(tab.windowId) || !http(tab.url) || tab.pendingUrl !== undefined || focused && !tab.active) return false;
      if (focused) { const window = await this.bounded(() => this.api.windows.get(tab.windowId!)); if (!window.focused || window.type !== 'normal') return false; }
      const frame = await this.bounded(() => this.api.webNavigation.getFrame({ tabId: target.tabId, frameId: 0 }));
      return frame !== null && frame.documentId === target.documentId && http(frame.url) && !frame.errorOccurred && (frame.documentLifecycle === undefined || frame.documentLifecycle === 'active');
    } catch { return false; }
  }
  private makeHandle(target: OverlayTarget, kind: OverlayKind, activation?: number): Handle | null {
    try { const generation = (this.deps.generation ?? freshGeneration)(); return id(generation) && generation > 0 ? { target: { ...target }, kind, generation, ...(activation === undefined ? {} : { activation }) } : null; } catch { return null; }
  }
  private isCurrent(handle: Handle): boolean { return handle.kind === 'activation' ? this.activation === handle : this.followed.get(handle.target.tabId)?.handle === handle; }
  private async deliver(handle: Handle, eligible: () => boolean, inject = true): Promise<boolean> {
    const current = (): OverlaySnapshot | null => {
      if (!this.eligible(eligible)) return null;
      const snapshot = this.read(handle.target.tabId, handle.kind);
      return snapshot && sameTarget(snapshot.target, handle.target) ? snapshot : null;
    };
    try {
      if (!current() || !await this.nativeCurrent(handle.target, true) || !current()) return false;
      if (inject) await this.bounded(() => this.api.scripting.executeScript({ target: { tabId: handle.target.tabId, documentIds: [handle.target.documentId] }, world: 'ISOLATED', files: ['firewall-overlay.js'] }));
      if (!current() || !await this.nativeCurrent(handle.target, true)) return false;
      const source = current(); if (source === null) return false;
      const payload = cloneData({ schemaVersion: 1, type: 'protect-overlay-show', kind: handle.kind, generation: handle.generation, tabId: handle.target.tabId, documentKey: handle.target.documentKey, locale: source.locale, state: source.state, report: handle.kind === 'activation' ? null : source.report, ...(handle.activation === undefined ? {} : { activation: handle.activation }) });
      const ack = await this.bounded(() => this.api.tabs.sendMessage(handle.target.tabId, payload, { documentId: handle.target.documentId, frameId: 0 }));
      if (own(ack, 'schemaVersion') !== 1 || own(ack, 'type') !== 'protect-overlay-ack' || own(ack, 'kind') !== handle.kind || own(ack, 'generation') !== handle.generation || own(ack, 'accepted') !== true) { this.stats.rejected++; await this.hide(handle); return false; }
      if (!current() || !await this.nativeCurrent(handle.target, true) || !current()) { this.stats.stale++; await this.hide(handle); return false; }
      this.stats.delivered++; return true;
    } catch { this.stats.rejected++; await this.hide(handle); return false; }
  }
  private async hide(handle: Handle): Promise<void> {
    try { await this.bounded(() => this.api.tabs.sendMessage(handle.target.tabId, { schemaVersion: 1, type: 'protect-overlay-hide', kind: handle.kind, generation: handle.generation }, { documentId: handle.target.documentId, frameId: 0 })); } catch { /* A departed document has no overlay to remove. */ }
  }
  private bounded<T>(operation: () => Promise<T>): Promise<T> {
    let timer: unknown = null;
    return new Promise<T>((resolve, reject) => {
      timer = this.timerSet(() => reject(new Error('overlay-native-timeout')), OVERLAY_NATIVE_TIMEOUT_MS);
      try { Promise.resolve(operation()).then(resolve, reject); } catch (error) { reject(error); }
    }).finally(() => { if (timer !== null) this.timerClear(timer); });
  }
  private follow(target: OverlayTarget): Followed {
    let state = this.followed.get(target.tabId);
    if (state && sameTarget(state.target, target)) return state;
    if (state) this.forget(target.tabId);
    if (this.followed.size >= OVERLAY_MAX_TABS) { const oldest = this.followed.keys().next().value as number | undefined; if (oldest !== undefined) this.forget(oldest); this.stats.budget++; }
    state = { target: { ...target }, seen: new Set(), saturated: false, handle: null }; this.followed.set(target.tabId, state); return state;
  }
  private mark(state: Followed, keys: readonly string[]): boolean {
    const fresh = keys.filter(key => !state.seen.has(key));
    if (state.saturated || fresh.some(key => key.length > 1024) || state.seen.size + fresh.length > OVERLAY_MAX_SEEN_PER_DOCUMENT || this.seen + fresh.length > OVERLAY_MAX_SEEN) { state.saturated = true; this.stats.budget++; return false; }
    for (const key of fresh) { state.seen.add(key); this.seen++; } return true;
  }
  private async evaluate(tabId: number): Promise<void> {
    const snapshot = this.read(tabId, 'findings');
    if (!snapshot) { this.forget(tabId); return; }
    const found = positiveFindingSnapshot(snapshot.report); if (!found) return;
    const state = this.follow(snapshot.target);
    if (state.saturated) return;
    if (state.handle) {
      const handle = state.handle;
      if (await this.deliver(handle, () => this.followed.get(tabId) === state && state.handle === handle, false)) this.mark(state, found.keys);
      else if (state.handle === handle) state.handle = null;
      return;
    }
    if (found.keys.every(key => state.seen.has(key))) return;
    if (state.seen.size + found.keys.filter(key => !state.seen.has(key)).length > OVERLAY_MAX_SEEN_PER_DOCUMENT || this.seen + found.keys.filter(key => !state.seen.has(key)).length > OVERLAY_MAX_SEEN) { state.saturated = true; this.stats.budget++; return; }
    if (this.lastOpen !== null && this.now() - this.lastOpen < OVERLAY_OPEN_INTERVAL_MS) { this.schedule(tabId, OVERLAY_OPEN_INTERVAL_MS - (this.now() - this.lastOpen)); return; }
    const handle = this.makeHandle(snapshot.target, 'findings'); if (!handle) return;
    state.handle = handle;
    const accepted = await this.deliver(handle, () => this.followed.get(tabId) === state && state.handle === handle);
    if (accepted) { this.lastOpen = this.now(); this.mark(state, found.keys); }
    else if (state.handle === handle) state.handle = null;
  }
  private arm(): void {
    if (this.processing) return;
    const next = Math.min(...this.due.values());
    if (this.timer !== null && this.timerAt <= next) return;
    if (this.timer !== null) this.timerClear(this.timer);
    this.timer = null; this.timerAt = next;
    if (next === Infinity) return;
    this.timer = this.timerSet(() => {
      this.timer = null; this.timerAt = Infinity;
      this.processing = true;
      const lifecycle = this.lifecycle;
      const due = [...this.due].filter(([, at]) => at <= this.now()).map(([tabId]) => tabId);
      for (const tabId of due) this.due.delete(tabId);
      void this.enqueue(async () => { for (const tabId of due) { if (lifecycle !== this.lifecycle) break; await this.evaluate(tabId); } }).finally(() => { this.processing = false; this.arm(); });
    }, Math.max(0, next - this.now()));
  }
}
