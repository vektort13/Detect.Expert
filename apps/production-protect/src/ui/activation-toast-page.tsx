// ADR-054: a short acknowledgement of an explicit activation, separate from detector findings.
import { Component, render } from 'preact';
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ProtectState } from '@detect-expert/contracts';
import { useProtectState } from '../../../../vendor/protect-722fae8/packages/ui/src/app/useProtectState';
import { PROTECT_STATE_KEYS } from '../../../../vendor/protect-722fae8/packages/ui/src/view-models/protect';
import { launcherDirectionOf, launcherLocaleOf, moduleLocaleOf, setProductionLocale, t } from './i18n-shim';
import { FirewallBrand } from './FirewallBrand';

export const ACTIVATION_TOAST_INITIAL_TIMEOUT_MS = 5000;
export const ACTIVATION_TOAST_LIFETIME_MS = 5000;

export function readActivationId(search: string): number | null {
  if (search.length > 512) return null;
  const entries = [...new URLSearchParams(search).entries()];
  if (entries.length !== 1 || entries[0]?.[0] !== 'activation') return null;
  const value = entries[0][1];
  if (!/^[1-9][0-9]{0,15}$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function activationToastActive(state: ProtectState | null): boolean {
  return state !== null && state.state === 'active' && state.consentVersion !== null && state.consentVersion === state.requiredConsentVersion && !state.organizationDisabled && !state.organizationPolicyInvalid && (state.snoozedUntil === null || state.snoozedUntil <= Date.now()) && state.features.length > 0 && state.permissions.broadHosts && (!state.features.some(feature => feature === 'firewall' || feature === 'gpc') || state.permissions.dnr);
}

export interface ActivationToastWorkArea { left: number; top: number; width: number; height: number }
export interface ActivationToastBounds { left: number; top: number; width: number; height: number }

export function activationToastBounds(area: ActivationToastWorkArea, requestedHeight = 210): ActivationToastBounds | null {
  if (![area.left, area.top, area.width, area.height].every(Number.isFinite) || area.width < 1 || area.height < 1) return null;
  const left = Math.ceil(area.left), top = Math.ceil(area.top);
  const availableWidth = Math.floor(area.width), availableHeight = Math.floor(area.height);
  const margin = Math.min(16, Math.floor(availableWidth / 4), Math.floor(availableHeight / 4));
  const width = Math.min(360, availableWidth - margin * 2);
  const height = Math.min(260, Number.isFinite(requestedHeight) ? Math.max(120, Math.ceil(requestedHeight)) : 210, availableHeight - margin * 2);
  return { left: left + availableWidth - margin - width, top: top + availableHeight - margin - height, width, height };
}

export async function positionActivationToastWindow(): Promise<'ready' | 'fallback' | 'invalid'> {
  let current: chrome.windows.Window;
  try {
    current = await chrome.windows.getCurrent({ populate: true });
  } catch { return 'fallback'; }
  if (current.id === undefined || current.type !== 'popup' || current.tabs?.length !== 1) return 'invalid';
  try {
    const content = document.querySelector('[data-protect-activation-toast]');
    if (content === null) return 'invalid';
    const workScreen = screen as Screen & { availLeft?: number; availTop?: number };
    const bodyStyle = getComputedStyle(document.body);
    const padding = (Number.parseFloat(bodyStyle.paddingTop) || 0) + (Number.parseFloat(bodyStyle.paddingBottom) || 0);
    const frameHeight = Math.max(0, window.outerHeight - window.innerHeight);
    const bounds = activationToastBounds({ left: workScreen.availLeft ?? 0, top: workScreen.availTop ?? 0, width: workScreen.availWidth, height: workScreen.availHeight }, content.getBoundingClientRect().height + padding + frameHeight);
    if (bounds === null) return 'fallback';
    // getCurrent identifies this page's popup. Bounds changes preserve the user's focus.
    await chrome.windows.update(current.id, bounds);
    return 'ready';
  } catch { return 'fallback'; }
}

interface ActivationToastProps { activationId: number; locale: string; close(): void; ready(): void }

class ActivationToastBoundary extends Component<{ children?: ComponentChildren; close(): void }, { failed: boolean }> {
  override state = { failed: false };
  static override getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  override componentDidCatch(): void { this.props.close(); }
  override render(): ComponentChildren { return this.state.failed ? null : this.props.children; }
}

function ActivationToastBody(props: ActivationToastProps): JSX.Element | null {
  const protect = useProtectState({ watch: true });
  const active = activationToastActive(protect.state);
  const activeRef = useRef(active);
  activeRef.current = active;
  const [position, setPosition] = useState<'pending' | 'ready' | 'fallback'>('pending');

  // Start the visible lifetime when the verified result reaches the DOM, independently of window APIs.
  useLayoutEffect(() => { if (active) props.ready(); }, [active, props.ready]);

  useEffect(() => {
    const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') props.close(); };
    const refresh = (): void => { void protect.refresh(); };
    const managed = (changes: Record<string, chrome.storage.StorageChange>): void => {
      if (!Object.hasOwn(changes, 'ProtectModuleDisabled')) return;
      const value: unknown = changes['ProtectModuleDisabled']?.newValue;
      if (value !== undefined && value !== false) props.close();
      else refresh();
    };
    window.addEventListener('keydown', key);
    window.addEventListener('focus', refresh);
    try { chrome.storage.managed.onChanged.addListener(managed); } catch { /* Managed storage may be unavailable. */ }
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('focus', refresh);
      try { chrome.storage.managed.onChanged.removeListener(managed); } catch { /* Already closed. */ }
    };
  }, [protect.refresh, props.close]);

  useEffect(() => {
    if (protect.loaded && (!protect.available || !active)) props.close();
  }, [protect.loaded, protect.available, active, props.close]);

  useEffect(() => {
    if (!active) return;
    const element = document.querySelector('[data-protect-activation-toast]');
    if (element === null) { props.close(); return; }
    let cancelled = false, running = false, queued = false, frame = 0;
    const positionWindow = async (): Promise<void> => {
      if (running) { queued = true; return; }
      running = true;
      do {
        queued = false;
        const placement = await positionActivationToastWindow();
        if (cancelled || !activeRef.current) return;
        if (placement === 'invalid') { props.close(); return; }
        // A failed cosmetic resize must not discard the verified activation acknowledgement.
        setPosition(placement);
      } while (queued && !cancelled);
      running = false;
    };
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { void positionWindow(); });
    });
    observer.observe(element);
    void positionWindow();
    return () => { cancelled = true; observer.disconnect(); cancelAnimationFrame(frame); };
  }, [active, props.close]);

  const status = active && protect.state !== null ? t('firewall_launcher_status', [t(PROTECT_STATE_KEYS[protect.state.state])]) : t('firewall_launcher_loading');
  return (
    <main class="protect-activation" data-protect-activation-toast="true" data-activation-id={String(props.activationId)} data-activation-position={position} data-activation-state={active ? 'active' : 'loading'} aria-busy={!active} lang={launcherLocaleOf(props.locale).replace('_', '-')} dir={launcherDirectionOf(props.locale)}>
      <header class="protect-activation__header"><FirewallBrand /><button type="button" class="button protect-activation__close" data-activation-close="true" aria-label={t('findings_popup_close')} title={t('findings_popup_close')} onClick={props.close}><svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg></button></header>
      <span class="protect-activation__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M12 2.8 20 6v6.1c0 4.2-3.2 7.5-8 9.1-4.8-1.6-8-4.9-8-9.1V6l8-3.2Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />{active ? <path d="m8.6 12 2.2 2.2 4.6-4.7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /> : null}</svg></span>
      <div class="protect-activation__content"><h1>{t('firewall_launcher_title')}</h1><p class="protect-activation__status" role="status" aria-live="polite">{status}</p></div>
      {active ? <p class="protect-activation__note" lang={moduleLocaleOf(props.locale)} dir="ltr">{t('protect_reload_note')}</p> : null}
    </main>
  );
}

async function activationToastLanguage(): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const stored = await Promise.race([
      chrome.storage.local.get('ui-language-v1'),
      new Promise<Record<string, unknown>>(resolve => { timer = setTimeout(() => resolve({}), 500); }),
    ]);
    const value = stored['ui-language-v1'];
    if (typeof value === 'string' && /^[a-zA-Z_-]{2,16}$/.test(value)) return value;
  } catch { /* Browser language is sufficient for this acknowledgement. */ }
  finally { if (timer !== undefined) clearTimeout(timer); }
  try { return chrome.i18n.getUILanguage(); } catch { return 'en'; }
}

/** The initial deadline also bounds language/state reads and an unavailable native positioning API. */
export async function mountActivationToastPage(element: HTMLElement | null): Promise<void> {
  const activationId = readActivationId(typeof location === 'undefined' ? '' : location.search);
  let hash = '';
  try { hash = location.hash; } catch { /* An absent location is an invalid target. */ }
  if (element === null || activationId === null || hash !== '') { try { window.close(); } catch { /* Already closed. */ } return; }
  let closed = false;
  let initial: ReturnType<typeof setTimeout> | undefined;
  let lifetime: ReturnType<typeof setTimeout> | undefined;
  const close = (): void => {
    if (closed) return;
    closed = true;
    if (initial !== undefined) clearTimeout(initial);
    if (lifetime !== undefined) clearTimeout(lifetime);
    try { window.close(); } catch { /* The owned popup may already have closed. */ }
  };
  const ready = (): void => {
    if (closed || lifetime !== undefined) return;
    if (initial !== undefined) clearTimeout(initial);
    lifetime = setTimeout(close, ACTIVATION_TOAST_LIFETIME_MS);
  };
  initial = setTimeout(close, ACTIVATION_TOAST_INITIAL_TIMEOUT_MS);
  const locale = await activationToastLanguage();
  if (closed) return;
  setProductionLocale(locale);
  document.documentElement.lang = launcherLocaleOf(locale).replace('_', '-');
  document.documentElement.dir = launcherDirectionOf(locale);
  document.title = t('firewall_launcher_title') + ' — Detect.Expert';
  render(<ActivationToastBoundary close={close}><ActivationToastBody activationId={activationId} locale={locale} close={close} ready={ready} /></ActivationToastBoundary>, element);
}
