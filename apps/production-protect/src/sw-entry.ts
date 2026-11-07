// ADR-047 (S1, port plan §2.1): service-worker part of the opt-in module «Защита» for the production extension,
// built into protect-sw.js (ESM, imported by background.js from S2 on). ProtectController (722fae8) uses the narrow
// ADR-053 production adapter for launcher enable and OFF persistence; this file supplies events and routing:
//   - every listener is registered synchronously at the top level of the module, before the body of background.js
//     runs (imported modules evaluate first), so the module's runtime.onMessage listener precedes the production one;
//   - the listener answers only the exact message types of the module (4 page types, 22 ui-protect-* types) and
//     returns false for everything else without calling sendResponse; the production listener returns false for the
//     module's types (B2), so every message has exactly one responder;
//   - tabId / frameId / documentId of page messages come only from MessageSender (readPageSender, REQ-004);
//   - observation state reaches the module only through protectHost (host-api.ts), assigned by background.js (B8);
//   - S4b: a firewall prompt waiting for the user surfaces as the module's own action popup firewall.html (surface.ts:
//     per-tab setPopup, openPopup under limits, the default popup back afterwards), not as a card among the findings.
// While the module is off (default) the controller reads its settings and the managed policy and does nothing else:
// no IndexedDB, no webRequest listener, no registration, no DNR call (ADR-020 §A).

import { PROTECT_UI_REQUEST_TYPES, validateUiRequest } from '@detect-expert/contracts';
import type { ProtectAck, ProtectUiRequest, UiResponse } from '@detect-expert/contracts';
import * as PRODUCTION_PROTECT_TABLES from '@detect-expert/catalog/protect-tables';
import type { BackgroundChromeApi, MessageSenderLike, NavigationDetailsLike } from '../../../vendor/protect-722fae8/packages/background/src/chrome-api';
import { ProtectController } from '../../../vendor/protect-722fae8/packages/background/src/protect/controller';
import { PROTECT_DOC_PREFIX, PROTECT_RUNTIME_KEY, PROTECT_TABS_KEY } from '../../../vendor/protect-722fae8/packages/background/src/protect/doc-store';
import { browserIdbFactory } from '../../../vendor/protect-722fae8/packages/background/src/protect/idb';
import { readPageSender, readSenderTabTop, verifyUiSender } from '../../../vendor/protect-722fae8/packages/background/src/sender';
import { protectBadgeLabel } from './badge-label';
import { protectGroupHasHooks } from './hook-config';
import { PROTECT_PAGE_TYPES } from './host-api';
import type { ProductionBindingOf, ProtectBadge, ProtectHost, ProtectHostBindings } from './host-api';
import { asProtectReport, bindingLookup, bindingOfDocument, pausedOf } from './report-adapter';
import { FirewallSurfacer, MAX_SURFACE_RECEIVERS, MAX_SURFACE_TABS, resumeFocusedFirewall } from './surface';
import type { SurfacePending } from './surface';
import { positiveFindingSnapshot } from './findings';
import { forgetFindingsWindow, openFindingsWindows, removeFindingsWindow } from './findings-window';
import { ProtectOverlayController } from './overlay-controller';
import type { OverlayTarget, OverlaySnapshot } from './overlay-controller';
import type { OverlayKind, OverlayActionMessage } from './overlay-protocol';
import { authorizeOverlayAction } from './overlay-actions';
import { openManagement } from './ui/management-navigation';
import { siteOfUrl } from '../../../vendor/protect-722fae8/packages/background/src/protect/tab-model';
import { waitForActivationFocus } from './activation-focus';

/** build-protect.mjs: false in apps/production-extension; true only in the --overlay test build (tripwires). */
declare const __PROTECT_OVERLAY__: boolean;

/** Second badge mark after a module event (lanes that settle asynchronously), as the vendored BADGE_SETTLE_MS. */
export const PROTECT_BADGE_SETTLE_MS = 1000;
/** Bound of the tabs waiting for the second mark. */
const MAX_SETTLING_TABS = 1024;

const PAGE_TYPES: ReadonlySet<string> = new Set<string>(PROTECT_PAGE_TYPES);
const UI_TYPES: ReadonlySet<string> = new Set<string>(PROTECT_UI_REQUEST_TYPES);
const INACTIVE_ACK: Readonly<ProtectAck> = Object.freeze({ schemaVersion: 1, type: 'protect-ack', active: false, groups: 0 });

function uiError(code: 'invalid-request' | 'unauthorized-sender'): UiResponse {
  return { schemaVersion: 1, type: 'error', code };
}

/** Own data property of a message (structured-clone data; never a getter call). */
function ownField(message: unknown, field: 'type' | 'schemaVersion'): unknown {
  if (typeof message !== 'object' || message === null) return undefined;
  const d = Object.getOwnPropertyDescriptor(message, field);
  return d !== undefined && 'value' in d ? d.value : undefined;
}

/** True for exactly the module's message types (protect-hello|arm|input|events, the 22 ui-protect-* types). */
export function ownsProtectMessage(message: unknown): boolean {
  const type = ownField(message, 'type');
  return typeof type === 'string' && (PAGE_TYPES.has(type) || UI_TYPES.has(type) || type === 'protect-overlay-action');
}

let bindings: ProtectHostBindings | null = null;

const controller = new ProtectController(chrome as unknown as BackgroundChromeApi, {
  idbFactory: browserIdbFactory,
  // REQ-008: the production protect-tables (empty until a catalog promotion); never the synthetic test tables.
  tables: PRODUCTION_PROTECT_TABLES,
  testProfile: false,
  groupGate: (group) => protectGroupHasHooks(group),
  hostGranted: (host, scheme) => {
    if (bindings === null) return false;
    try {
      return bindings.hostGranted(host, scheme) === true;
    } catch {
      return false;
    }
  },
  ...(__PROTECT_OVERLAY__ ? { tripwireFiles: { isolated: 'protect-tripwire.isolated.js', main: 'protect-tripwire.main.js' } } : {}),
});

// ADR-058: explicit activation is a short inline notice, separate from positive-only findings.
let activationEpoch = 0, lastShownActivation = 0, activationRequested = false;
function activationCount(): number { return controller.diagnostics()['activations'] ?? 0; }
function cancelActivationToast(): void {
  activationEpoch++;
  if (activationRequested) { activationRequested = false; findingsSurfacer.cancelActivation(); }
}

// ---------------------------------------------------------------------------
// Badge marks (the production BadgeManager asks protectHost.badgeFor when it recomputes a tab)
// ---------------------------------------------------------------------------

const settling = new Set<number>();
let settleTimer: ReturnType<typeof setTimeout> | null = null;

function isTabId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function markBadge(tabId: number): void {
  if (bindings === null || !isTabId(tabId)) return;
  try {
    bindings.markBadge(tabId);
  } catch {
    // The production badge never depends on the module.
  }
}

function markAllBadges(): void {
  if (bindings === null) return;
  try {
    bindings.markAllBadges();
  } catch {
    // As above.
  }
}

function markSettled(tabId: number): void {
  markBadge(tabId);
  if (!isTabId(tabId)) return;
  if (!settling.has(tabId) && settling.size >= MAX_SETTLING_TABS) return;
  settling.add(tabId);
  if (settleTimer !== null) return;
  settleTimer = setTimeout(() => {
    settleTimer = null;
    const tabs = [...settling];
    settling.clear();
    for (const id of tabs) {
      markBadge(id);
      findingsSurfacer.schedule(id, 0);
    }
  }, PROTECT_BADGE_SETTLE_MS);
}

// ---------------------------------------------------------------------------
// Firewall popup (S4b, owner requirement: the firewall is its own popup when a leak needs a decision, not a card
// among the findings). surface.ts decides; these bindings are the only browser calls it makes. While the module is
// off nothing reaches it (no evidence, badge count 0, no followed tab), so it calls nothing.
// ---------------------------------------------------------------------------

/** The manifest's default popup: a tab gets it back (Chromium 153 treats setPopup '' as «no popup», S4b probe). */
function defaultPopup(): string {
  try {
    const popup = chrome.runtime.getManifest().action?.default_popup;
    return typeof popup === 'string' && popup.length > 0 ? popup : 'popup.html';
  } catch {
    return 'popup.html';
  }
}

/** Receivers of the tab's firewall prompt that wait for the user (the badge count's receivers). */
function surfacePending(tabId: number): SurfacePending {
  const none = (site: string | null, muted: boolean): SurfacePending => ({ site, receivers: [], muted });
  if (!controller.isActive) return none(null, true);
  const state = controller.getState();
  if (state.snoozedUntil !== null || !state.features.includes('firewall')) return none(null, true);
  if (controller.isTabExcluded(tabId)) return none(null, false);
  // getReport first: after a service-worker restart it hydrates the tab's firewall state that pendingCount reads.
  const report = controller.getReport(tabId);
  const site = report?.site ?? null;
  const prompt = report?.firewall.prompt ?? null;
  if (report === null || site === null || prompt === null || prompt.site !== site || controller.pendingCount(tabId) <= 0) return none(site, false);
  // Receivers with an effective rule were decided (strict preset, «эта вкладка»): they do not wait.
  const ruled = new Set(report.firewall.receivers.filter((v) => v.effectiveRule !== null).map((v) => v.receiver));
  const open = prompt.receivers.filter((r) => !ruled.has(r));
  return { site, receivers: (open.length > 0 ? open : prompt.receivers).slice(0, MAX_SURFACE_RECEIVERS), muted: false };
}

const surfacer = new FirewallSurfacer({
  autoOpen: false,
  now: () => Date.now(),
  pending: surfacePending,
  // Looked up at call time (chrome.action may be absent in a stripped environment; tests wrap these).
  setPopup: (tabId, popup) => chrome.action.setPopup({ tabId, popup }),
  getPopup: (tabId) => chrome.action.getPopup({ tabId }),
  openPopup: (windowId) => chrome.action.openPopup({ windowId }),
  tab: async (tabId) => {
    const tab = await chrome.tabs.get(tabId);
    return typeof tab.windowId === 'number' ? { windowId: tab.windowId, active: tab.active === true } : null;
  },
  windowFocused: async (windowId) => (await chrome.windows.get(windowId)).focused === true,
  popupOpen: async () => (await chrome.runtime.getContexts({ contextTypes: ['POPUP' as chrome.runtime.ContextType] })).length > 0,
  defaultPopup,
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
});

// ADR-052: only current positive detector output opens the separate bottom-right window.
// No MAIN/content message has a command to open it; identity and projection come from the controller.
function findingSnapshot(tabId: number) {
  if (!controller.isActive || controller.isTabExcluded(tabId) || controller.getState().snoozedUntil !== null) return null;
  return positiveFindingSnapshot(controller.getReport(tabId));
}

// ADR-058: only this exact top-level ISOLATED document receives the value-free card.
const activationTargets = new Map<number, OverlayTarget & { site: string }>();
const overlayUndo = new Map<string, { ids: Set<string>; expires: number }>();
let overlayLocale = (() => { try { return chrome.i18n.getUILanguage(); } catch { return 'en'; } })();
async function readOverlayLocale(): Promise<void> {
  try {
    const value: unknown = (await chrome.storage.local.get('ui-language-v1'))['ui-language-v1'];
    if (typeof value === 'string' && /^[A-Za-z_-]{2,16}$/.test(value)) overlayLocale = value;
  } catch { /* The browser locale is sufficient. */ }
}
function overlaySnapshot(tabId: number, kind: OverlayKind): OverlaySnapshot | null {
  if (!controller.isActive || controller.getState().snoozedUntil !== null) return null;
  if (kind === 'findings' && controller.isTabExcluded(tabId)) return null;
  const activation = activationTargets.get(tabId);
  if (kind === 'activation' && (!activation || controller.isExcluded(activation.site))) return null;
  const report = controller.getReport(tabId);
  const match = report?.documentKey.match(/^(\d+):0:([A-Za-z0-9_-]{1,64})$/);
  const target = kind === 'activation' ? activation : match && Number(match[1]) === tabId ? { tabId, documentId: match[2]!, documentKey: report!.documentKey } : undefined;
  if (!target || kind === 'findings' && findingSnapshot(tabId) === null) return null;
  return { target, state: controller.getState(), report: kind === 'findings' ? report : null, locale: /^[A-Za-z_-]{2,16}$/.test(overlayLocale) ? overlayLocale : 'en' };
}
const findingsSurfacer = new ProtectOverlayController({ snapshot: overlaySnapshot });
async function showActivationOverlay(activation: number, eligible: () => boolean): Promise<void> {
  await readOverlayLocale();
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = tabs.find(tab => isTabId(tab.id) && typeof tab.url === 'string' && /^https?:\/\//.test(tab.url));
  if (!tab || !isTabId(tab.id) || !isTabId(tab.windowId) || !eligible()) return;
  const frame = await chrome.webNavigation.getFrame({ tabId: tab.id, frameId: 0 });
  if (!frame || typeof frame.documentId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(frame.documentId) || !eligible()) return;
  const site = siteOfUrl(frame.url);
  if (site === null || controller.isExcluded(site)) return;
  const target = { tabId: tab.id, windowId: tab.windowId, documentId: frame.documentId, documentKey: `${tab.id}:0:${frame.documentId}` };
  // A headed Chrome action popup temporarily reports its source window unfocused.
  // Consume the one-shot activation only after that exact source is focused again.
  if (!await waitForActivationFocus(target, eligible)) return;
  activationTargets.set(tab.id, { tabId: tab.id, documentId: frame.documentId, documentKey: `${tab.id}:0:${frame.documentId}`, site });
  while (activationTargets.size > 64) activationTargets.delete(activationTargets.keys().next().value!);
  await findingsSurfacer.showActivation(tab.id, activation, eligible);
}

async function adoptFindingsWindows(): Promise<void> {
  if (!controller.enabled) return;
  const current = controller.tabModel.entries().map(entry => ({ tabId: entry.tabId, snapshot: findingSnapshot(entry.tabId) }));
  findingsSurfacer.seed(current);
  try {
    for (const window of await openFindingsWindows()) {
      // Clean up a legacy owned window after upgrade; new alerts never create one.
      await removeFindingsWindow(window.windowId);
    }
  } catch { /* A surviving page rechecks its own projection; no retry loop. */ }
}

/** After a service-worker restart: tabs that still show our popup are followed again (module enabled only). */
async function adoptFirewallPopups(): Promise<void> {
  if (!controller.enabled) return;
  try {
    const tabs = await chrome.tabs.query({});
    await surfacer.adopt(tabs.map((t) => t.id).filter(isTabId).slice(0, MAX_SURFACE_TABS));
  } catch {
    // No tabs API: the popups follow the next badge recomputation instead.
  }
}

/** As the vendored runtime.markProtectBadge: decisions mark their tab; module-wide actions mark every tab. */
function markAfterUi(type: ProtectUiRequest['type'], tabId: number | null): void {
  switch (type) {
    case 'ui-protect-decide':
    case 'ui-protect-undo':
    case 'ui-protect-dismiss':
      if (tabId !== null) {
        markBadge(tabId);
        surfacer.schedule(tabId, 0);
        findingsSurfacer.schedule(tabId, 0);
      }
      return;
    case 'ui-protect-snooze':
    case 'ui-protect-enable':
    case 'ui-protect-disable':
    case 'ui-protect-set-settings':
    case 'ui-protect-set-site':
    case 'ui-protect-purge':
    case 'ui-protect-remove-rules':
      markAllBadges();
      surfacer.scheduleAll(0);
      findingsSurfacer.scheduleAll(0);
      return;
    default:
  }
}

// A transfer record may open a firewall prompt in its tab: that tab's badge now and once the lane settled, and the
// firewall popup after the burst (FIREWALL_GROUP_MS). A prompt that appears later (strict preset, async) reaches the
// surfacer through the settled badge mark (protectHost.badgeFor -> observe).
controller.eventBus.subscribe('evidence', (event) => {
  markSettled(event.tabId);
  if (isTabId(event.tabId)) surfacer.schedule(event.tabId);
});
controller.eventBus.subscribe(null, (event) => {
  if (isTabId(event.tabId)) findingsSurfacer.schedule(event.tabId);
});

// ---------------------------------------------------------------------------
// Message route (as handlers.ts of 722fae8, module types only)
// ---------------------------------------------------------------------------

async function routeProtect(message: unknown, sender: MessageSenderLike): Promise<ProtectAck | UiResponse> {
  const runtimeId = chrome.runtime.id;
  if (verifyUiSender(sender, runtimeId)) {
    const request = validateUiRequest(message);
    if (!request.ok || !UI_TYPES.has(request.value.type)) return uiError('invalid-request');
    const r = request.value as ProtectUiRequest;
    if (r.type === 'ui-protect-disable' || (r.type === 'ui-protect-purge' && r.what === 'all')) { cancelActivationToast(); findingsSurfacer.closeAll(); overlayUndo.clear(); }
    const beforeActivation = r.type === 'ui-protect-enable' ? activationCount() : 0, epoch = activationEpoch;
    const response = await controller.routeUi(r, sender);
    markAfterUi(r.type, 'tabId' in r && typeof r.tabId === 'number' ? r.tabId : null);
    if (!controller.isActive) { if (activationRequested) cancelActivationToast(); findingsSurfacer.closeAll(); overlayUndo.clear(); }
    if (r.type === 'ui-protect-enable' && response.type === 'protect-state' && response.state.state === 'active' && controller.isActive && epoch === activationEpoch) {
      const activation = activationCount();
      if (activation > beforeActivation && activation > lastShownActivation) {
        lastShownActivation = activation;
        activationRequested = true;
        void showActivationOverlay(activation, () => epoch === activationEpoch && controller.isActive && activationCount() === activation).catch(() => undefined);
      }
    }
    return response;
  }
  // Content channel: only protect.js message types; ui-protect-* from a page sender is refused.
  if (!PAGE_TYPES.has(ownField(message, 'type') as string)) return uiError('unauthorized-sender');
  const read = readPageSender(sender, runtimeId);
  if (!read.ok) {
    // An opaque frame (no site) never runs the module.
    if (read.reason === 'opaque-origin') return INACTIVE_ACK;
    return uiError('unauthorized-sender');
  }
  if (ownField(message, 'schemaVersion') !== 1) return INACTIVE_ACK;
  return controller.onPageMessage(read.context, message, readSenderTabTop(sender));
}

// Portable contract: synchronous listener, literal `return true` only for the module's messages, then sendResponse.
async function routeOverlay(message: unknown, sender: chrome.runtime.MessageSender): Promise<unknown> {
  const action = await findingsSurfacer.handleAction(message, sender);
  if (action === null) return { ok: false, code: 'unauthorized-sender' };
  const { tabId, documentKey } = action.target;
  if (action.action === 'close') {
    await findingsSurfacer.close(tabId, action.kind, action.generation);
    return { ok: true, value: null };
  }
  if (action.action === 'refresh') {
    const updated = await findingsSurfacer.refresh(tabId, action.kind, action.generation);
    return updated ? { ok: true, value: null } : { ok: false, code: 'document-mismatch' };
  }
  const review = async (): Promise<void> => {
    await chrome.tabs.create({ url: chrome.runtime.getURL('firewall.html') + '?tab=' + String(tabId), active: true });
  };
  if (action.action === 'settings') {
    return await openManagement('firewall', null, chrome) ? { ok: true, value: null } : { ok: false, code: 'unavailable' };
  }
  const now = Date.now();
  for (const [key, value] of overlayUndo) if (value.expires <= now) overlayUndo.delete(key);
  const checked = authorizeOverlayAction(message as OverlayActionMessage, { tabId, documentKey, report: controller.getReport(tabId), undoIds: overlayUndo.get(documentKey)?.ids ?? new Set<string>() });
  if (checked.type === 'reject') return { ok: false, code: checked.code };
  if (checked.type === 'review') { await review(); return { ok: false, code: 'review-required' }; }
  const response = await controller.routeUi(checked.request, sender as MessageSenderLike);
  if (checked.request.type === 'ui-protect-decide' && response.type === 'protect-decision' && typeof response.undoId === 'string') {
    let ledger = overlayUndo.get(documentKey);
    if (ledger === undefined) {
      if (overlayUndo.size >= 64) overlayUndo.delete(overlayUndo.keys().next().value!);
      ledger = { ids: new Set(), expires: now + 15 * 60_000 }; overlayUndo.set(documentKey, ledger);
    }
    if (ledger.ids.size < 32) ledger.ids.add(response.undoId);
  }
  if (checked.request.type === 'ui-protect-undo' && response.type !== 'error') overlayUndo.get(documentKey)?.ids.delete(checked.request.undoId);
  markAfterUi(checked.request.type, tabId);
  await findingsSurfacer.refresh(tabId, action.kind, action.generation);
  return response.type === 'error' ? { ok: false, code: response.code } : { ok: true, value: null, response };
}

chrome.runtime.onMessage.addListener((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => {
  if (!ownsProtectMessage(message)) return false;
  if (ownField(message, 'type') === 'protect-overlay-action') {
    void routeOverlay(message, sender).then(sendResponse, () => sendResponse({ ok: false, code: 'invalid-request' }));
    return true;
  }
  void routeProtect(message, sender as MessageSenderLike).then(sendResponse, () => {
    sendResponse(uiError('invalid-request'));
  });
  return true;
});

// ---------------------------------------------------------------------------
// Browser events the module needs (production observers are not touched). Each call is a no-op while the module is
// not active; the vendored controller validates the ids it uses.
// ---------------------------------------------------------------------------

chrome.webNavigation.onCommitted.addListener((details) => {
  if (!isTabId(details.tabId) || !isTabId(details.frameId) || typeof details.url !== 'string') return;
  try {
    controller.onCommitted(details as unknown as NavigationDetailsLike);
  } catch {
    // Never breaks other listeners of the event.
  }
  // Chromium resets the tab's per-tab popup on a committed top-level navigation (S4b probe): ours goes back on while a
  // prompt still waits (same-site navigations carry it); a followed tab only.
  if (details.frameId === 0) {
    surfacer.navigated(details.tabId);
    findingsSurfacer.forget(details.tabId);
    activationTargets.delete(details.tabId);
    for (const key of overlayUndo.keys()) if (key.startsWith(`${details.tabId}:0:`)) overlayUndo.delete(key);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (!isTabId(tabId)) return;
  try {
    controller.onTabRemoved(tabId);
  } catch {
    // As above.
  }
  surfacer.forget(tabId);
  findingsSurfacer.forget(tabId);
  activationTargets.delete(tabId);
  for (const key of overlayUndo.keys()) if (key.startsWith(`${tabId}:0:`)) overlayUndo.delete(key);
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  if (!isTabId(addedTabId) || !isTabId(removedTabId)) return;
  try {
    controller.onTabReplaced(addedTabId, removedTabId);
  } catch {
    // As above.
  }
  surfacer.forget(removedTabId);
  findingsSurfacer.forget(removedTabId);
});

// A receiver that surfaced while its tab was in the background opens the firewall popup when the tab is activated
// (followed tabs with a waiting receiver only).
chrome.tabs.onActivated.addListener((info) => {
  if (isTabId(info.tabId)) surfacer.activated(info.tabId);
  if (isTabId(info.tabId)) findingsSurfacer.activated(info.tabId);
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (!controller.isActive) return;
  void resumeFocusedFirewall(windowId, (id) => chrome.tabs.query({ active: true, windowId: id }), (tabId) => {
    surfacer.activated(tabId);
    findingsSurfacer.activated(tabId);
  });
});
chrome.windows.onRemoved.addListener((windowId) => {
  forgetFindingsWindow(windowId);
});

// SP-11: the module re-adds its own webRequest listeners after a grant; broad hosts or DNR removed -> it stops.
chrome.permissions.onAdded.addListener((permissions) => {
  void controller.onPermissionsAdded(permissions).catch(() => undefined);
});
chrome.permissions.onRemoved.addListener((permissions) => {
  cancelActivationToast();
  findingsSurfacer.closeAll(); overlayUndo.clear();
  void controller.onPermissionsRemoved(permissions).then(() => findingsSurfacer.scheduleAll(0)).catch(() => undefined);
});

// ADR-047: the Chrome managed schema declares the disable-only organization policy.
chrome.storage.managed?.onChanged?.addListener(() => {
  cancelActivationToast();
  findingsSurfacer.closeAll(); overlayUndo.clear();
  void controller.onManagedChanged().then(() => findingsSurfacer.scheduleAll(0)).catch(() => undefined);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const value: unknown = changes['ui-language-v1']?.newValue;
  if (typeof value === 'string' && /^[A-Za-z_-]{2,16}$/.test(value)) { overlayLocale = value; if (controller.isActive) findingsSurfacer.scheduleAll(0); }
});

// ---------------------------------------------------------------------------
// protectHost: what background.js calls (B1–B8)
// ---------------------------------------------------------------------------

export const protectHost: ProtectHost = Object.freeze({
  owns: ownsProtectMessage,

  attach(next: ProtectHostBindings): void {
    if (bindings !== null) return;
    bindings = next;
    void controller.load().then(async () => {
      // Restoring saved ON is silent; only a later explicit enable can produce a new activation token.
      lastShownActivation = activationCount();
      if (controller.enabled) await readOverlayLocale();
      await adoptFindingsWindows();
      await adoptFirewallPopups();
    }).catch(() => undefined);
  },

  badgeFor(tabId: number, language: string): ProtectBadge | null {
    if (!isTabId(tabId)) return null;
    let pending = 0;
    try {
      pending = controller.pendingCount(tabId);
    } catch {
      return null;
    }
    // The firewall popup follows the badge (B3): set while prompts wait, the default popup back afterwards.
    surfacer.observe(tabId, pending);
    try {
      return protectBadgeLabel(pending, language);
    } catch {
      return null;
    }
  },

  reportPersisted(documentKey: string, report: unknown, meta: unknown, bindingOf: ProductionBindingOf): void {
    try {
      if (!controller.wantsReports) return;
      const shaped = asProtectReport(documentKey, report);
      if (shaped === null) return;
      const lookup = bindingLookup(bindingOf);
      controller.onReportPersisted(shaped, bindingOfDocument(documentKey, lookup), { paused: pausedOf(meta), bindingOf: lookup });
    } catch {
      // The module isolates its lanes; observation never depends on it.
    }
  },

  clearSession(): void {
    void controller.clearSession().then(() => {
      surfacer.scheduleAll(0);
      findingsSurfacer.scheduleAll(0);
    }).catch(() => undefined);
  },

  observationMainRegistered(): void {
    void controller.onObservationMainRegistered().catch(() => undefined);
  },

  sessionKeys(): string[] {
    const keys = [PROTECT_TABS_KEY, PROTECT_RUNTIME_KEY];
    try {
      for (const entry of controller.tabModel.entries()) for (const [key] of controller.docStore.docsOfTab(entry.tabId)) keys.push(PROTECT_DOC_PREFIX + key);
    } catch {
      // Fixed keys only.
    }
    return keys;
  },
});

/** storage.session keys of the module (exact prefix rule; sessionKeys lists only the documents it knows in memory). */
export function isProtectSessionKey(key: string): boolean {
  return key === PROTECT_TABS_KEY || key === PROTECT_RUNTIME_KEY || key.startsWith(PROTECT_DOC_PREFIX);
}
