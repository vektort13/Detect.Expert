// ADR-058: an extension-owned closed shadow popup in the exact top-level ISOLATED document.
import { Component, render } from 'preact';
import type { ComponentChildren, JSX } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { ProtectProjection, ProtectState } from '@detect-expert/contracts';
import { msg } from '../../../vendor/protect-722fae8/packages/ui/src/view-models/message';
import { FirewallCard } from '../../../vendor/protect-722fae8/packages/ui/src/components/protect/firewall/FirewallCard';
import { ReplayDetails } from '../../../vendor/protect-722fae8/packages/ui/src/components/protect/replay/ReplayDetails';
import { bestEvidenceFor, firewallCardView } from '../../../vendor/protect-722fae8/packages/ui/src/view-models/protect-firewall';
import { evidenceListView } from '../../../vendor/protect-722fae8/packages/ui/src/view-models/protect-evidence';
import { isProtectProjectionShape, parseProtectState, PROTECT_STATE_KEYS } from '../../../vendor/protect-722fae8/packages/ui/src/view-models/protect';
import { positiveFindings, positiveFindingSnapshot } from './findings';
import { allowOverlayGesture, overlayAction, setOverlayElementLookup, setOverlayTarget } from './overlay-client';
import type { OverlayAck, OverlayHideMessage, OverlayShowMessage } from './overlay-protocol';
import styles from './overlay-styles';
import { FirewallBrand } from './ui/FirewallBrand';
import { TransferFindingCard } from './ui/TransferFindingCard';
import { launcherDirectionOf, launcherLocaleOf, moduleLocaleOf, setProductionLocale, t, tm } from './ui/i18n-shim';

const SLOT = Symbol.for('detect.expert/protect-overlay/isolated/v1');
const LIFETIME_MS = 5000;
const documentKeyPattern = /^(\d+):0:[A-Za-z0-9_-]{1,64}$/;
const isId = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

function eligibleState(state: ProtectState): boolean {
  return (state.state === 'active' || state.state === 'degraded') && state.consentVersion !== null && state.consentVersion === state.requiredConsentVersion && !state.organizationDisabled && !state.organizationPolicyInvalid && (state.snoozedUntil === null || state.snoozedUntil <= Date.now());
}

/** Messages arrive only from this extension, but stale documents and unavailable states still fail closed. */
function readShow(raw: unknown): OverlayShowMessage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Partial<OverlayShowMessage>;
  if (value.schemaVersion !== 1 || value.type !== 'protect-overlay-show' || (value.kind !== 'activation' && value.kind !== 'findings') || !isId(value.generation) || value.generation === 0 || !isId(value.tabId) || value.tabId > 2147483647 || typeof value.documentKey !== 'string' || value.documentKey.length > 96 || !documentKeyPattern.test(value.documentKey) || !value.documentKey.startsWith(String(value.tabId) + ':0:') || typeof value.locale !== 'string' || !/^[a-zA-Z_-]{2,16}$/.test(value.locale)) return null;
  const state = parseProtectState(value.state);
  if (state === null || !eligibleState(state)) return null;
  if (value.kind === 'activation') {
    if (state.state !== 'active' || !state.permissions.broadHosts || (state.features.some(feature => feature === 'firewall' || feature === 'gpc') && !state.permissions.dnr) || !isId(value.activation) || value.activation === 0) return null;
    return { ...value, state, report: null } as OverlayShowMessage;
  }
  if (!isProtectProjectionShape(value.report) || value.report === null || value.report.documentKey !== value.documentKey || value.report.coverageState === 'paused' || value.report.limitations.includes('site-excluded') || (value.report.site !== null && state.excludedSites.includes(value.report.site))) return null;
  const report: ProtectProjection = { ...value.report, features: value.report.features.filter(feature => state.features.includes(feature)) };
  return positiveFindingSnapshot(report) === null ? null : { ...value, state, report } as OverlayShowMessage;
}

function readHide(raw: unknown): OverlayHideMessage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Partial<OverlayHideMessage>;
  return value.schemaVersion === 1 && value.type === 'protect-overlay-hide' && (value.kind === 'activation' || value.kind === 'findings') && isId(value.generation) && value.generation > 0 ? value as OverlayHideMessage : null;
}

class OverlayBoundary extends Component<{ children?: ComponentChildren; close(): void }, { failed: boolean }> {
  override state = { failed: false };
  static override getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  override componentDidCatch(): void { queueMicrotask(this.props.close); }
  override render(): ComponentChildren { return this.state.failed ? null : this.props.children; }
}

interface OverlayProps { show: OverlayShowMessage; close(): void; committed(): void; refresh(): Promise<void> }

function CloseButton({ close, kind }: { close(): void; kind: OverlayShowMessage['kind'] }): JSX.Element {
  return <button type="button" class="button protect-overlay__close" data-overlay-close="true" data-activation-close={kind === 'activation' ? 'true' : undefined} data-findings-close={kind === 'findings' ? 'true' : undefined} aria-label={t('findings_popup_close')} title={t('findings_popup_close')} onClick={close}><svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg></button>;
}

function ActivationContent(props: OverlayProps): JSX.Element {
  useLayoutEffect(props.committed, [props.show.generation]);
  return <section class="protect-activation" data-protect-overlay="activation" data-protect-activation-toast="true" data-activation-state="active" lang={launcherLocaleOf(props.show.locale).replace('_', '-')} dir={launcherDirectionOf(props.show.locale)}>
    <header class="protect-activation__header"><FirewallBrand /><CloseButton close={props.close} kind="activation" /></header>
    <span class="protect-activation__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M12 2.8 20 6v6.1c0 4.2-3.2 7.5-8 9.1-4.8-1.6-8-4.9-8-9.1V6l8-3.2Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" /><path d="m8.6 12 2.2 2.2 4.6-4.7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg></span>
    <div class="protect-activation__content"><h1>{t('firewall_launcher_title')}</h1><p class="protect-activation__status" role="status" aria-live="polite">{tm(msg('firewall_launcher_status', msg(PROTECT_STATE_KEYS.active)))}</p></div>
    <p class="protect-activation__note" lang={moduleLocaleOf(props.show.locale)} dir="ltr">{t('protect_reload_note')}</p>
  </section>;
}

function FindingsContent(props: OverlayProps): JSX.Element | null {
  const report = props.show.report, state = props.show.state, hadPrompt = useRef(false);
  if (report === null) return null;
  const findings = positiveFindings(report);
  const prompt = state.features.includes('firewall') ? firewallCardView(state, report) : null;
  const transferMeta = prompt === null ? null : evidenceListView({ ...report, evidence: findings.transfers }, null);
  if (prompt !== null) hadPrompt.current = true;
  const presented = prompt === null ? null : bestEvidenceFor(report, prompt.primary);
  const transfers = findings.transfers.filter(item => item.evidenceId !== presented?.evidenceId);
  const detailLanguage = moduleLocaleOf(props.show.locale);
  const slot = { state, report, tabId: props.show.tabId, refreshState: props.refresh, refreshReport: props.refresh, openSidePanel: () => undefined };
  return <section class="protect-findings" data-protect-overlay="findings" data-protect-findings="true" lang={launcherLocaleOf(props.show.locale).replace('_', '-')} dir={launcherDirectionOf(props.show.locale)}>
    <header class="protect-findings__bar"><div class="protect-findings__heading"><FirewallBrand /><span class="protect-findings__brand">{t('firewall_launcher_title')}</span></div><CloseButton close={props.close} kind="findings" /></header>
    {transferMeta !== null && (transferMeta.coverage !== null || transferMeta.docNotes.length > 0) ? <div class="protect-island protect-findings__coverage" lang={detailLanguage} dir="ltr">
      {transferMeta.coverage !== null ? <p class="small muted">{tm(transferMeta.coverage)}</p> : null}
      {transferMeta.docNotes.length > 0 ? <ul class="small muted" data-protect-doc-notes="true">{transferMeta.docNotes.map((note, index) => <li key={String(index)}>{tm(note)}</li>)}</ul> : null}
    </div> : null}
    {hadPrompt.current ? <div class="protect-island" lang={detailLanguage} dir="ltr"><FirewallCard {...slot} /></div> : null}
    {transfers.length > 0 ? <section class="protect-findings__transfers" data-findings-transfers={String(findings.transfers.length)}>
      {findings.transfers.length > 1 ? <h2>{t('findings_popup_transfer_count', [String(findings.transfers.length)])}</h2> : null}
      <div class="protect-island protect-findings__evidence" lang={detailLanguage} dir="ltr">{transfers.map(item => <TransferFindingCard key={item.evidenceId} evidence={item} report={report} />)}</div>
    </section> : null}
    {findings.replay !== null ? <section class="protect-findings__section" data-findings-replay={findings.replay.level}><h2>{t(findings.replay.level === 'replay-recording' ? 'findings_popup_replay_recording' : 'findings_popup_replay_like')}</h2><details class="protect-findings__details"><summary>{t('findings_popup_details')}</summary><div class="protect-island" lang={detailLanguage} dir="ltr"><ReplayDetails {...slot} report={{ ...report, replay: findings.replay }} /></div></details></section> : null}
    {prompt === null ? <footer class="protect-findings__footer"><button type="button" class="button" onClick={props.close}>{t('findings_popup_close')}</button><button type="button" class="button button--text" onClick={() => void overlayAction('settings')}>{t('findings_popup_settings')}</button></footer> : null}
  </section>;
}

interface OverlayInstance { receive(raw: unknown, sender: chrome.runtime.MessageSender, respond: (value: OverlayAck) => void): boolean }

function createOverlay(): OverlayInstance {
  const host = document.createElement('div');
  host.setAttribute('popover', 'manual');
  const shadow = host.attachShadow({ mode: 'closed' });
  const sheet = new CSSStyleSheet(); sheet.replaceSync(styles);
  shadow.adoptedStyleSheets = [sheet];
  setOverlayElementLookup((id: string) => shadow.getElementById(id) as HTMLElement | null);
  const surface = document.createElement('div'); surface.className = 'protect-overlay-page protect-findings-page';
  const scroll = document.createElement('div'); scroll.className = 'protect-overlay-scroll';
  surface.append(scroll); shadow.append(surface);
  let current: OverlayShowMessage | null = null, timer: ReturnType<typeof setTimeout> | undefined;
  let polling: ReturnType<typeof setInterval> | undefined, refreshing = false;
  let activationGeneration = -1;
  const latest = { activation: -1, findings: -1 }, closed = { activation: -1, findings: -1 };
  const revoked = new Set<number>();
  const revoke = (kind: OverlayShowMessage['kind'], generation: number): void => {
    closed[kind] = Math.max(closed[kind], generation);
    revoked.add(generation); if (revoked.size > 128) revoked.delete(revoked.values().next().value!);
  };

  function hide(notify: boolean): void {
    if (current === null) return;
    revoke(current.kind, current.generation);
    if (notify) void overlayAction('close');
    current = null; setOverlayTarget(null);
    if (timer !== undefined) clearTimeout(timer); timer = undefined;
    if (polling !== undefined) clearInterval(polling); polling = undefined;
    render(null, scroll);
    try { host.hidePopover(); } catch { /* Already removed by the page. */ }
    host.remove();
  }
  function startLifetime(show: OverlayShowMessage): void {
    if (current?.generation !== show.generation || current.kind !== 'activation' || activationGeneration === show.generation) return;
    activationGeneration = show.generation;
    timer = setTimeout(() => {
      if (current?.generation === show.generation && current.kind === 'activation') hide(true);
    }, LIFETIME_MS);
  }
  async function refresh(): Promise<void> {
    const before = current;
    if (before === null || refreshing) return;
    refreshing = true;
    try {
      const result = await overlayAction('refresh');
      if (current?.generation !== before.generation || current.kind !== before.kind) return;
      if (!result.ok) { hide(false); return; }
      // The SW normally pushes its fresh SHOW before returning this acknowledgement.
      if (result.value === null) return;
      const next = readShow(result.value);
      if (next === null) hide(false); else show(next);
    } finally { refreshing = false; }
  }
  function show(value: OverlayShowMessage): boolean {
    if (revoked.has(value.generation) || value.generation <= closed[value.kind] || value.generation < latest[value.kind] || current !== null && value.kind !== current.kind && value.generation < current.generation) return false;
    latest[value.kind] = value.generation;
    if (current?.generation !== value.generation || current.kind !== value.kind) { if (timer !== undefined) clearTimeout(timer); timer = undefined; }
    current = value; setOverlayTarget(value); setProductionLocale(value.locale);
    host.setAttribute('data-protect-overlay-kind', value.kind);
    if (!host.isConnected) document.documentElement.append(host);
    try { if (!host.matches(':popover-open')) host.showPopover(); }
    catch { hide(false); return false; }
    render(<OverlayBoundary key={value.kind + ':' + value.documentKey} close={() => hide(false)}>{value.kind === 'activation' ? <ActivationContent show={value} close={() => hide(true)} committed={() => startLifetime(value)} refresh={refresh} /> : <FindingsContent show={value} close={() => hide(true)} committed={() => undefined} refresh={refresh} />}</OverlayBoundary>, scroll);
    if (polling === undefined && current !== null) polling = setInterval(() => {
      if (!host.isConnected) { hide(false); return; }
      if (document.visibilityState === 'visible') void refresh();
    }, 1000);
    const content = scroll.querySelector('[data-protect-overlay]');
    const rect = content?.getBoundingClientRect();
    return current !== null && host.isConnected && content !== null && content.textContent.trim().length > 0 && rect !== undefined && rect.width > 0 && rect.height > 0;
  }

  const trustedCapture = (event: Event): void => {
    const path = event.composedPath(), origin = path.find(node => node instanceof Element && shadow.contains(node)) as Element | undefined;
    const reject = (): void => { event.preventDefault(); event.stopImmediatePropagation(); };
    if (!event.isTrusted || origin === undefined || !host.isConnected || !host.matches(':popover-open') || document.visibilityState !== 'visible') { reject(); return; }
    const appearance = getComputedStyle(host);
    if (appearance.visibility !== 'visible' || Number(appearance.opacity) < .99 || appearance.transform !== 'none' || appearance.filter !== 'none') { reject(); return; }
    if (event.type === 'click' && (event as MouseEvent).detail > 0) {
      const pointer = event as MouseEvent;
      const hit = shadow.elementFromPoint(pointer.clientX, pointer.clientY);
      // The UA forwards a native label click to its associated, visually hidden radio/checkbox.
      const label = hit?.closest('label');
      const ownLabelControl = origin.matches('input[type="radio"],input[type="checkbox"]') && label !== undefined && label !== null && shadow.contains(label) && (label as HTMLLabelElement).control === origin;
      if (document.elementFromPoint(pointer.clientX, pointer.clientY) !== host || hit === null || !(hit === origin || hit.contains(origin) || origin.contains(hit) || ownLabelControl)) { reject(); return; }
    }
    if (event.type === 'keydown' && (event as KeyboardEvent).key === 'Escape') { event.preventDefault(); event.stopPropagation(); hide(true); return; }
    allowOverlayGesture(event);
  };
  for (const type of ['click', 'change', 'keydown']) shadow.addEventListener(type, trustedCapture, true);
  window.addEventListener('pagehide', () => hide(false));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && current?.kind === 'activation') hide(false); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (current === null) return;
    if (area === 'local' && Object.hasOwn(changes, 'protect')) {
      const record: unknown = changes['protect']?.newValue;
      if (record === undefined || typeof record === 'object' && record !== null && 'enabled' in record && record.enabled === false) hide(false);
    }
    if (area === 'managed' && Object.hasOwn(changes, 'ProtectModuleDisabled')) {
      const disabled: unknown = changes['ProtectModuleDisabled']?.newValue;
      if (disabled !== undefined && disabled !== false) hide(false);
      else void refresh();
    }
  });
  try { chrome.permissions.onRemoved.addListener(() => hide(false)); } catch { /* Permission events may be unavailable in an ISOLATED content script. */ }

  return { receive(raw, sender, respond) {
    if (sender.id !== chrome.runtime.id) return false;
    const hiding = readHide(raw);
    if (hiding !== null) {
      revoke(hiding.kind, hiding.generation);
      if (current?.kind === hiding.kind && current.generation === hiding.generation) hide(false);
      respond({ schemaVersion: 1, type: 'protect-overlay-ack', kind: hiding.kind, generation: hiding.generation, accepted: true }); return false;
    }
    const showing = readShow(raw);
    if (showing !== null) {
      const accepted = show(showing);
      queueMicrotask(() => { try { respond({ schemaVersion: 1, type: 'protect-overlay-ack', kind: showing.kind, generation: showing.generation, accepted: accepted && current?.generation === showing.generation && current.kind === showing.kind && host.isConnected }); } catch { /* The exact target may have navigated before its acknowledgement. */ } });
      return true;
    }
    return false;
  } };
}

const isolated = globalThis as unknown as Record<symbol, OverlayInstance | undefined>;
if (isolated[SLOT] === undefined && window.top === window) {
  const overlay = createOverlay();
  Object.defineProperty(globalThis, SLOT, { value: overlay });
  chrome.runtime.onMessage.addListener(overlay.receive);
}
