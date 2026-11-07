// ADR-047 (S1, port plan §2.5): «islands» of the module «Защита» inside the production UI. The vendored TSX of
// 722fae8 is rendered unchanged by the module's own Preact (protect-ui.js) into a container element that the
// production page renders empty (host.ts). One island per surface, composed like the vendored PopupApp, SidepanelApp
// and OptionsApp parts of the module:
//   popup            module area (firewall line, GPC, reminder) while not off; transfers/replay use ADR-052 findings;
//                    firewall decision card is its own popup firewall.html since S4b (firewall-page.tsx, surface.ts);
//   sidepanel        tabs «Защита» / «Кто узнаёт» while not off;
//   launcher         compact Firewall toggle + actual state controls, also while off; the Options shell may add one control
//                    between the title and the switch (toolSlot, ADR-111) — without it the row has exactly two buttons;
//   options-launcher compatibility alias of launcher;
//   options-page     full settings with disabled OFF previews (ADR-062).
// ADR-098: activation runs directly from the user's toggle, retaining the canonical enable command. Each
// island has an error boundary: an exception of the module never reaches the production page.

import { Component, render } from 'preact';
import type { ComponentChildren, ComponentType, JSX } from 'preact';
import type { ProtectState } from '@detect-expert/contracts';
import type { ProtectStateSession } from '../../../../vendor/protect-722fae8/packages/ui/src/app/useProtectState';
import { jsx } from 'preact/jsx-runtime';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useProtectReport } from '../../../../vendor/protect-722fae8/packages/ui/src/app/useProtectReport';
import { useProtectState } from '../../../../vendor/protect-722fae8/packages/ui/src/app/useProtectState';
import { Tabs, panelId, tabId } from '../../../../vendor/protect-722fae8/packages/ui/src/components/Tabs';
import { ProtectOptionsPanel } from '../../../../vendor/protect-722fae8/packages/ui/src/components/protect/ProtectOptionsPanel';
import { inlineConsentDraft } from './inline-consent';
import { PROTECT_SECTION_TITLE_ID, ProtectSection } from './protect-section';
import { ProtectSidepanel } from '../../../../vendor/protect-722fae8/packages/ui/src/components/protect/ProtectSidepanel';
import { HistoryPanel } from '../../../../vendor/protect-722fae8/packages/ui/src/components/protect/history/HistoryPanel';
import { RequestsApp } from '../../../../vendor/protect-722fae8/packages/ui/src/components/protect/requests/RequestsApp';
import { PROTECT_STATE_KEYS, protectEnabledByUser, protectSurfaceVisible, optionsHasProtectTabs } from '../../../../vendor/protect-722fae8/packages/ui/src/view-models/protect';
import { currentProductionLocale, isFallbackLocale, launcherDirectionOf, launcherLocaleOf, moduleLocaleOf, setProductionLocale, t, tm } from './i18n-shim';
import { PopupProtectArea } from './popup-area';
import { openManagement } from './management-navigation';

export const PROTECT_SURFACES = Object.freeze(['popup', 'sidepanel', 'launcher', 'options-launcher', 'options-page'] as const);
export type ProtectSurface = (typeof PROTECT_SURFACES)[number];

/**
 * ADR-111: the Options shell draws its Tour button between the title and the switch of the Firewall launcher, so that the order in the DOM (and for
 * the Tab key) is the order on the screen. The button belongs to the production page's Preact, whose hooks cannot run inside the copy this module
 * carries, so the shell hands the launcher a maker instead of a ready vnode: the island calls it once with h and the hooks of THIS Preact (and the
 * language of the page) and draws the component it returns. The component is the shell's code, not the module's: a failure in it draws nothing and
 * never reaches the launcher. The module reads, sends and stores nothing for it.
 */
export interface LauncherToolKit {
  h: (type: unknown, props: Record<string, unknown>, key?: string) => ComponentChildren;
  useState: typeof useState;
  useEffect: typeof useEffect;
  /** The production language id of this render (what the host's own useLocale returns). */
  useLocale: () => string;
}
export type LauncherToolMaker = (kit: LauncherToolKit) => ComponentType;

export interface IslandProps {
  surface: ProtectSurface;
  /** Tab of the popup / side panel (production session.tabId); null in Options. */
  tabId: number | null;
  /** Production session.openSidePanel (popup only). */
  openSidePanel: (() => void) | null;
  /** Production uiLocale() of this render. */
  locale: string | null;
  /** Launcher only (ADR-111): the Options shell's extra control between the title and the switch; null leaves the two-button row. */
  toolSlot: LauncherToolMaker | null;
}

export interface IslandHandle {
  update(props: Partial<Omit<IslandProps, 'surface'>>): void;
  unmount(): void;
}

/** Hash route of the module page in Options (vendored optionsTabFromHash: #protect, #firewall, #history, #requests). */
export const PROTECT_OPTIONS_HASH = '#protect';

interface BoundaryState {
  failed: boolean;
}

/** Error boundary of an island: the module's failure shows one line and never breaks the production page. */
export class IslandBoundary extends Component<{ children?: ComponentChildren }, BoundaryState> {
  override state: BoundaryState = { failed: false };

  static override getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  override componentDidCatch(): void {
    if (!this.state.failed) this.setState({ failed: true });
  }

  override render(): ComponentChildren {
    if (this.state.failed) {
      return (
        <p class="small muted protect-island__error" role="status" data-protect-island-error="true">
          {t('protect_island_error')}
        </p>
      );
    }
    return this.props.children;
  }
}

/** The shell's control in the launcher row (ADR-111) is not the module's code: if it fails, its place stays empty and the launcher goes on. */
class ToolBoundary extends Component<{ children?: ComponentChildren }, BoundaryState> {
  override state: BoundaryState = { failed: false };

  static override getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  override componentDidCatch(): void {
    if (!this.state.failed) this.setState({ failed: true });
  }

  override render(): ComponentChildren {
    return this.state.failed ? null : this.props.children;
  }
}

const LAUNCHER_TOOL_KIT: LauncherToolKit = Object.freeze({
  h: jsx as unknown as LauncherToolKit['h'],
  useState,
  useEffect,
  useLocale: () => currentProductionLocale() ?? 'en',
});

/** The component of the shell's maker, or null when there is none or the maker fails (the row then keeps its two buttons). */
function launcherToolOf(maker: LauncherToolMaker | null): ComponentType | null {
  if (typeof maker !== 'function') return null;
  try {
    const tool = maker(LAUNCHER_TOOL_KIT);
    return typeof tool === 'function' ? tool : null;
  } catch {
    return null;
  }
}

function PopupIsland(props: IslandProps): JSX.Element | null {
  const protect = useProtectState();
  const on = protectSurfaceVisible(protect.state);
  const report = useProtectReport(props.tabId, on, 1000);
  if (!on || protect.state === null) return null;
  const openSidePanel = props.openSidePanel;
  return (
    <PopupProtectArea
      state={protect.state}
      report={report.report}
      tabId={props.tabId}
      refreshState={protect.refresh}
      refreshReport={report.refresh}
      openSidePanel={() => {
        if (openSidePanel !== null) openSidePanel();
      }}
    />
  );
}

const SIDEPANEL_TABS = ['protect', 'history'] as const;
type SidepanelTab = (typeof SIDEPANEL_TABS)[number];
const SIDEPANEL_TAB_KEYS: Readonly<Record<SidepanelTab, string>> = { protect: 'tab_protect', history: 'tab_history' };

function SidepanelIsland(props: IslandProps): JSX.Element | null {
  const protect = useProtectState({ watch: true });
  const on = protectSurfaceVisible(protect.state);
  const report = useProtectReport(props.tabId, on, 1000);
  const [active, setActive] = useState<SidepanelTab>('protect');
  if (!on || protect.state === null) return null;
  const prefix = 'protect-panel';
  const panel = (id: SidepanelTab) => ({
    id: panelId(prefix, id),
    role: 'tabpanel' as const,
    'aria-labelledby': tabId(prefix, id),
    hidden: active !== id,
    class: 'tabpanel',
    tabIndex: 0,
  });
  const slot = { state: protect.state, report: report.report, tabId: props.tabId, refreshState: protect.refresh, refreshReport: report.refresh };
  return (
    <section class="section protect-island__panel" data-protect-sidepanel="true">
      <Tabs
        idPrefix={prefix}
        tabs={SIDEPANEL_TABS.map((id) => ({ id, label: t(SIDEPANEL_TAB_KEYS[id]) }))}
        active={active}
        onChange={(id) => setActive(id === 'history' ? 'history' : 'protect')}
      />
      <div {...panel('protect')}>
        <ProtectSidepanel {...slot} />
      </div>
      <div {...panel('history')}>
        <HistoryPanel {...slot} />
      </div>
    </section>
  );
}

/** Settings navigation never changes module state. */
export async function openFirewallSettings(): Promise<boolean> {
  return openManagement('firewall');
}

export function firewallLauncherState(state: ProtectState | null, loaded: boolean, available: boolean): { code: string; text: string; compact: string; tone: 'on' | 'off' | 'attention' } {
  if (!loaded) return { code: 'loading', text: t('firewall_launcher_loading'), compact: '…', tone: 'off' };
  if (!available || state === null) return { code: 'unavailable', text: t('firewall_launcher_unavailable'), compact: '!', tone: 'attention' };
  const code = state.state;
  return {
    code,
    text: t(PROTECT_STATE_KEYS[code]),
    compact: code === 'active' ? 'ON' : code === 'off' ? 'OFF' : '!',
    tone: code === 'active' ? 'on' : code === 'off' ? 'off' : 'attention',
  };
}

/** Success information belongs to the temporary activation window; errors remain in the invoking surface. */
export function inlineProtectSession(session: ProtectStateSession, launcher = false): ProtectStateSession {
  const notice = session.notice;
  if (notice?.tone === 'neutral' && (notice.message.key === 'protect_disabled_notice' || (launcher && notice.message.key === 'protect_reload_note'))) return { ...session, notice: null };
  return session;
}

function FirewallLauncherIsland(props: IslandProps): JSX.Element {
  const protect = inlineProtectSession(useProtectState({ watch: true }), true);
  const [changing, setChanging] = useState(false), [toggleError, setToggleError] = useState(false);
  const [opening, setOpening] = useState(false), [openError, setOpenError] = useState(false);
  const navigating = useRef(false);
  const invoker = useRef<HTMLButtonElement | null>(null);
  const group = useRef<HTMLElement | null>(null), focusPending = useRef(false);
  const active = useRef(false), mounted = useRef(false);
  // ADR-111: built once per maker, so the shell's component keeps its identity (and its state) across the launcher's own re-renders.
  const Tool = useMemo(() => launcherToolOf(props.toolSlot), [props.toolSlot]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const focus = (): void => { void protect.refresh(); };
    const managed = (changes: Record<string, unknown>): void => { if (Object.prototype.hasOwnProperty.call(changes, 'ProtectModuleDisabled')) void protect.refresh(); };
    window.addEventListener('focus', focus);
    try { chrome.storage.managed.onChanged.addListener(managed); } catch { /* No managed storage in static previews. */ }
    return () => {
      window.removeEventListener('focus', focus);
      try { chrome.storage.managed.onChanged.removeListener(managed); } catch { /* Static preview. */ }
    };
  }, [protect.refresh]);
  const state = firewallLauncherState(protect.state, protect.loaded, protect.available);
  const enabled = protectEnabledByUser(protect.state);
  const busy = protect.busy || changing;
  const blocked = !protect.loaded || !protect.available || protect.state === null || protect.state.organizationDisabled || protect.state.organizationPolicyInvalid;
  const disabled = blocked || busy;
  const statusLabel = t('firewall_launcher_status', [state.text]);
  const actionLabel = busy ? t('firewall_launcher_updating') : t(enabled ? 'firewall_launcher_disable' : 'firewall_launcher_enable');
  const toggleLabel = blocked ? statusLabel : actionLabel + '. ' + statusLabel;
  const restoreInvoker = (): void => { focusPending.current = true; };
  async function settings(): Promise<void> {
    if (navigating.current || active.current || busy) return;
    navigating.current = true; setOpening(true); setOpenError(false);
    try {
      if (!await openFirewallSettings() && mounted.current) setOpenError(true);
    } catch { if (mounted.current) setOpenError(true); }
    finally { navigating.current = false; if (mounted.current) setOpening(false); }
  }
  async function change(work: () => Promise<boolean>): Promise<void> {
    if (active.current) return;
    active.current = true; setChanging(true); setToggleError(false); protect.dismissNotice();
    try {
      // Call work before any await: enable requests browser permissions in this trusted click.
      const ok = await work();
      if (mounted.current) {
        setToggleError(!ok);
        if (ok) restoreInvoker();
      }
      // Read the actual state even after a rejected save; never optimistically display ON/OFF.
      await protect.refresh();
    } catch {
      if (mounted.current) setToggleError(true);
    } finally {
      active.current = false;
      if (mounted.current) setChanging(false);
    }
  }
  function toggle(button: HTMLButtonElement): void {
    if (disabled || navigating.current || active.current || protect.state === null) return;
    invoker.current = button; setToggleError(false); protect.dismissNotice();
    if (enabled) { void change(() => protect.disable(false)); return; }
    const draft = inlineConsentDraft(protect.state);
    void change(() => protect.enable(draft.features, draft.preset));
  }
  useEffect(() => {
    if (!busy && focusPending.current) {
      focusPending.current = false;
      try { if (invoker.current?.disabled === false) invoker.current.focus(); else group.current?.focus(); } catch { /* Surface closed. */ }
    }
  }, [busy]);
  return (
    <section ref={group} tabIndex={-1} class="blocking-launcher protect-launcher" data-protect-launcher="true" lang={launcherLocaleOf(props.locale).replace('_', '-')} dir={launcherDirectionOf(props.locale)} aria-busy={busy || opening || !protect.loaded}>
      <div class="blocking-launcher__controls">
        <button type="button" class="blocking-launcher__open" data-protect-open="true" onClick={() => void settings()} disabled={opening || busy} title={t('firewall_launcher_open')} aria-label={t('firewall_launcher_open')}>
          <span>{t('firewall_launcher_title')}</span>
          <span class="blocking-launcher__chevron" aria-hidden="true">›</span>
        </button>
        {Tool === null ? null : (
          <ToolBoundary>
            <Tool />
          </ToolBoundary>
        )}
        <button type="button" class={'blocking-master protect-launcher__status blocking-master--' + state.tone} data-protect-settings="true" data-protect-toggle="status" data-protect-state={state.code} role="switch" aria-checked={enabled} onClick={(event) => toggle(event.currentTarget)} disabled={disabled || opening} title={toggleLabel} aria-label={toggleLabel}>
          <span class="blocking-master__dot" aria-hidden="true" />
          <span class="protect-launcher__state" aria-hidden="true">{state.compact}</span>
          <span class="sr-only" role="status" aria-live="polite">{statusLabel}</span>
        </button>
      </div>
      {openError ? <p class="blocking-message blocking-message--error" role="alert">{t('firewall_launcher_open_error')}</p> : null}
      {toggleError || protect.notice !== null ? (
        <p class={'blocking-message' + (toggleError || protect.notice?.tone === 'error' || protect.notice?.tone === 'attention' ? ' blocking-message--error' : '')} role={toggleError || protect.notice?.tone === 'error' || protect.notice?.tone === 'attention' ? 'alert' : 'status'}>
          {toggleError ? <span>{blocked ? statusLabel : t('firewall_launcher_toggle_error')}</span> : null}
          {!blocked && protect.notice !== null ? <span lang={moduleLocaleOf(props.locale)} dir="ltr">{toggleError ? ' ' : ''}{tm(protect.notice.message)}</span> : null}
        </p>
      ) : null}
    </section>
  );
}

function OptionsPageIsland(props: IslandProps): JSX.Element {
  const protect = inlineProtectSession(useProtectState({ watch: true }));
  const focusTitle = useRef(false);
  const hasTabs = optionsHasProtectTabs(protect.state);
  const onLayoutAction = (): void => {
    focusTitle.current = true;
  };
  useEffect(() => {
    if (!focusTitle.current) return;
    const title = document.getElementById(PROTECT_SECTION_TITLE_ID);
    if (title === null || title.closest('[hidden]') !== null) return;
    focusTitle.current = false;
    title.focus();
  });
  const state = protect.state;
  return (
    <div class="protect-page__body" data-protect-page="true">
      {isFallbackLocale(props.locale) ? (
        <p class="small muted protect-page__locale-note" data-protect-locale-note="true">
          {t('protect_locale_fallback_note')}
        </p>
      ) : null}
      {state === null ? null : hasTabs ? (
        <ProtectOptionsPanel session={protect} state={state} onLayoutAction={onLayoutAction} />
      ) : (
        <ProtectSection session={protect} state={state} mode="full" onLayoutAction={onLayoutAction} />
      )}
    </div>
  );
}

function IslandRoot(props: IslandProps): JSX.Element | null {
  setProductionLocale(props.locale);
  switch (props.surface) {
    case 'popup':
      return <PopupIsland {...props} />;
    case 'sidepanel':
      return <SidepanelIsland {...props} />;
    case 'launcher':
    case 'options-launcher':
      return <FirewallLauncherIsland {...props} />;
    case 'options-page':
      return <OptionsPageIsland {...props} />;
    default:
      return null;
  }
}

/** Launcher and its boundary use the production language; deep module pages keep their fallback. */
function applyIslandLanguage(element: HTMLElement, locale: string | null, surface: ProtectSurface): void {
  try {
    const launcher = surface === 'launcher' || surface === 'options-launcher';
    element.lang = launcher ? launcherLocaleOf(locale).replace('_', '-') : moduleLocaleOf(locale);
    element.dir = launcher ? launcherDirectionOf(locale) : 'ltr';
  } catch {
    // Detached element: nothing to set.
  }
}

/** Renders the island of `surface` into `element` (owned by the production host, which keeps it empty). */
export function mountIsland(element: HTMLElement, surface: ProtectSurface, initial: Partial<Omit<IslandProps, 'surface'>> = {}): IslandHandle {
  let props: IslandProps = { surface, tabId: initial.tabId ?? null, openSidePanel: initial.openSidePanel ?? null, locale: initial.locale ?? null, toolSlot: initial.toolSlot ?? null };
  let mounted = true;
  const draw = (): void => {
    if (!mounted) return;
    applyIslandLanguage(element, props.locale, props.surface);
    render(
      <IslandBoundary>
        <IslandRoot {...props} />
      </IslandBoundary>,
      element,
    );
  };
  draw();
  return {
    update(next) {
      const merged: IslandProps = {
        surface,
        tabId: next.tabId === undefined ? props.tabId : next.tabId,
        openSidePanel: next.openSidePanel === undefined ? props.openSidePanel : next.openSidePanel,
        locale: next.locale === undefined ? props.locale : next.locale,
        toolSlot: next.toolSlot === undefined ? props.toolSlot : next.toolSlot,
      };
      if (merged.tabId === props.tabId && merged.openSidePanel === props.openSidePanel && merged.locale === props.locale && merged.toolSlot === props.toolSlot) return;
      props = merged;
      draw();
    },
    unmount() {
      if (!mounted) return;
      mounted = false;
      render(null, element);
    },
  };
}

/** requests.html: the data-requests page (vendored RequestsApp) with the module catalog and the production language. */
export function mountRequestsApp(element: HTMLElement, locale: string | null): void {
  setProductionLocale(locale);
  render(
    <IslandBoundary>
      <RequestsApp />
    </IslandBoundary>,
    element,
  );
}
