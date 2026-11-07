// ADR-052: actual findings only; a separate window never renders an empty or unrelated document's report.
import { Component, render } from 'preact';
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ProtectProjection, ProtectState } from '@detect-expert/contracts';
import { useProtectState } from '../../../../vendor/protect-722fae8/packages/ui/src/app/useProtectState';
import { ReplayDetails } from '../../../../vendor/protect-722fae8/packages/ui/src/components/protect/replay/ReplayDetails';
import { FirewallCard } from '../../../../vendor/protect-722fae8/packages/ui/src/components/protect/firewall/FirewallCard';
import { evidenceListView } from '../../../../vendor/protect-722fae8/packages/ui/src/view-models/protect-evidence';
import { bestEvidenceFor, firewallCardView } from '../../../../vendor/protect-722fae8/packages/ui/src/view-models/protect-firewall';
import { openProtectOptions } from '../../../../vendor/protect-722fae8/packages/ui/src/messaging';
import { positiveFindings, positiveFindingSnapshot } from '../findings';
import { readFindingsTarget } from '../findings-target';
import type { FindingsTarget } from '../findings-target';
import { launcherDirectionOf, launcherLocaleOf, moduleLocaleOf, setProductionLocale, t, tm } from './i18n-shim';
import { TransferFindingCard } from './TransferFindingCard';
import { positionFindingsWindow } from './findings-position';
import { useFindingsReport } from './findings-report';
import { FirewallBrand } from './FirewallBrand';

export const FINDINGS_INITIAL_TIMEOUT_MS = 5000;

export function closeFindingsWindow(): void {
  try { window.close(); } catch { /* The owned popup may already have closed. */ }
}

class FindingsBoundary extends Component<{ children?: ComponentChildren }, { failed: boolean }> {
  override state = { failed: false };
  static override getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  override componentDidCatch(): void { closeFindingsWindow(); }
  override render(): ComponentChildren { return this.state.failed ? null : this.props.children; }
}

export interface FindingsPageProps extends FindingsTarget { locale: string | null }

function eligibleState(state: ProtectState | null): boolean {
  return state !== null && (state.state === 'active' || state.state === 'degraded') && !state.organizationDisabled && !state.organizationPolicyInvalid && state.consentVersion === state.requiredConsentVersion && (state.snoozedUntil === null || state.snoozedUntil <= Date.now());
}

function currentPositiveReport(state: ProtectState | null, report: ProtectProjection | null, target: FindingsTarget): ProtectProjection | null {
  if (!eligibleState(state) || state === null || report === null || report.documentKey !== target.documentKey || report.coverageState === 'paused' || report.limitations.includes('site-excluded') || (report.site !== null && state.excludedSites.includes(report.site))) return null;
  // Both the current settings and the document projection must still have the feature enabled.
  const filtered: ProtectProjection = { ...report, features: report.features.filter(feature => state.features.includes(feature)) };
  return positiveFindingSnapshot(filtered) === null ? null : filtered;
}

function FindingsBody(props: FindingsPageProps): JSX.Element | null {
  const protect = useProtectState({ watch: true });
  const enabled = eligibleState(protect.state);
  const report = useFindingsReport(props.tabId, enabled);
  const positive = currentPositiveReport(protect.state, report.report, props);
  const [position, setPosition] = useState<'pending' | 'ready' | 'unavailable'>('pending');
  const live = useRef(true);
  const hadPrompt = useRef(false);
  const loadedRef = useRef({ state: false, report: false });
  loadedRef.current = { state: protect.loaded, report: report.loaded };

  useEffect(() => {
    live.current = true;
    const deadline = window.setTimeout(() => {
      if (!loadedRef.current.state || !loadedRef.current.report) closeFindingsWindow();
    }, FINDINGS_INITIAL_TIMEOUT_MS);
    const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') closeFindingsWindow(); };
    const refresh = (): void => { void protect.refresh(); };
    const managed = (changes: Record<string, chrome.storage.StorageChange>): void => { if (Object.hasOwn(changes, 'ProtectModuleDisabled')) refresh(); };
    window.addEventListener('keydown', key);
    window.addEventListener('focus', refresh);
    try { chrome.storage.managed.onChanged.addListener(managed); } catch { /* Managed storage can be unavailable. */ }
    return () => {
      live.current = false;
      clearTimeout(deadline);
      window.removeEventListener('keydown', key);
      window.removeEventListener('focus', refresh);
      try { chrome.storage.managed.onChanged.removeListener(managed); } catch { /* Already closed. */ }
    };
  }, [protect.refresh]);

  useEffect(() => {
    if (protect.loaded && (!protect.available || !enabled)) closeFindingsWindow();
    else if (report.loaded && positive === null) closeFindingsWindow();
  }, [protect.loaded, protect.available, enabled, report.loaded, positive]);

  // Details expand the existing window in place, without focusing it or resizing a normal browser window.
  const hasPositive = positive !== null;
  useEffect(() => {
    if (!hasPositive) return;
    const element = document.querySelector('[data-protect-findings]');
    if (element === null) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setPosition('pending');
        void positionFindingsWindow().then(ok => {
          if (!live.current) return;
          if (!ok) { closeFindingsWindow(); return; }
          setPosition('ready');
        });
      });
    });
    observer.observe(element);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [hasPositive]);

  if (positive === null || protect.state === null) return null;
  const findings = positiveFindings(positive);
  const card = protect.state.features.includes('firewall') ? firewallCardView(protect.state, positive) : null;
  const prompt = card !== null;
  const transferMeta = prompt ? evidenceListView({ ...positive, evidence: findings.transfers }, null) : null;
  if (prompt) hadPrompt.current = true;
  // Only the primary record is already expanded by the real prompt. Other endpoints/records remain accessible.
  const presentedEvidence = card === null ? null : bestEvidenceFor(positive, card.primary);
  const remainingTransfers = findings.transfers.filter(item => item.evidenceId !== presentedEvidence?.evidenceId);
  const detailLanguage = moduleLocaleOf(props.locale);
  const slot = { state: protect.state, report: positive, tabId: props.tabId, refreshState: protect.refresh, refreshReport: report.refresh };
  return (
    <main class="protect-findings" data-protect-findings="true" data-findings-document={props.documentKey} data-findings-position={position} data-findings-transfers={findings.transfers.length > 0 ? String(findings.transfers.length) : undefined} lang={launcherLocaleOf(props.locale).replace('_', '-')} dir={launcherDirectionOf(props.locale)}>
      <header class="protect-findings__bar">
        <div class="protect-findings__heading"><FirewallBrand />{findings.transfers.length === 0 ? <h1>{t('findings_popup_title')}</h1> : <span class="protect-findings__brand">{t('firewall_launcher_title')}</span>}</div>
        <button type="button" class="button protect-findings__close" data-findings-close="true" aria-label={t('findings_popup_close')} title={t('findings_popup_close')} onClick={closeFindingsWindow}><svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg></button>
      </header>
      {findings.transfers.length === 0 ? <p class="protect-findings__site">{positive.site}</p> : null}
      {transferMeta !== null && (transferMeta.coverage !== null || transferMeta.docNotes.length > 0) ? <div class="protect-island protect-findings__coverage" lang={detailLanguage} dir="ltr">
        {transferMeta.coverage !== null ? <p class="small muted">{tm(transferMeta.coverage)}</p> : null}
        {transferMeta.docNotes.length > 0 ? <ul class="small muted" data-protect-doc-notes="true">{transferMeta.docNotes.map((note, index) => <li key={String(index)}>{tm(note)}</li>)}</ul> : null}
      </div> : null}
      {hadPrompt.current ? <div class="protect-island" lang={detailLanguage} dir="ltr"><FirewallCard {...slot} openSidePanel={() => undefined} /></div> : null}
      {remainingTransfers.length > 0 ? (
        <section class="protect-findings__transfers">
          {findings.transfers.length > 1 && remainingTransfers.length > 0 ? <h2>{t('findings_popup_transfer_count', [String(findings.transfers.length)])}</h2> : null}
          <div class="protect-island protect-findings__evidence" lang={detailLanguage} dir="ltr">
            {remainingTransfers.map(item => <TransferFindingCard key={item.evidenceId} evidence={item} report={positive} />)}
          </div>
        </section>
      ) : null}
      {findings.replay !== null ? (
        <section class="protect-findings__section" data-findings-replay={findings.replay.level}>
          <h2>{t(findings.replay.level === 'replay-recording' ? 'findings_popup_replay_recording' : 'findings_popup_replay_like')}</h2>
          <details class="protect-findings__details" data-findings-details="replay">
            <summary>{t('findings_popup_details')}</summary>
            <div class="protect-island" lang={detailLanguage} dir="ltr"><ReplayDetails {...slot} report={{ ...positive, replay: findings.replay }} /></div>
          </details>
        </section>
      ) : null}
      {!prompt ? <footer class="protect-findings__footer"><button type="button" class="button" data-findings-ack="true" onClick={closeFindingsWindow}>{t('findings_popup_close')}</button><button type="button" class="button button--text" data-findings-settings="true" onClick={() => void openProtectOptions('firewall')}>{t('findings_popup_settings')}</button></footer> : null}
    </main>
  );
}

export function FindingsPage(props: FindingsPageProps): JSX.Element {
  setProductionLocale(props.locale);
  useEffect(() => {
    document.title = t('findings_popup_title') + ' — Detect.Expert';
    document.documentElement.lang = launcherLocaleOf(props.locale).replace('_', '-');
    document.documentElement.dir = launcherDirectionOf(props.locale);
  }, [props.locale]);
  return <FindingsBoundary><FindingsBody {...props} /></FindingsBoundary>;
}

export function mountFindingsApp(element: HTMLElement, props: FindingsPageProps): void {
  setProductionLocale(props.locale);
  render(<FindingsPage {...props} />, element);
}

/** Strict target plus a bounded read of the existing production language preference. */
export async function mountFindingsPage(element: HTMLElement | null): Promise<void> {
  const target = readFindingsTarget(typeof location === 'undefined' ? '' : location.search);
  if (element === null || target === null) { closeFindingsWindow(); return; }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let locale: string | null = null;
  try {
    const stored = await Promise.race([
      chrome.storage.local.get('ui-language-v1'),
      new Promise<Record<string, unknown>>(resolve => { timer = setTimeout(() => resolve({}), 500); }),
    ]);
    const value = stored['ui-language-v1'];
    if (typeof value === 'string' && /^[a-zA-Z_-]{2,16}$/.test(value)) locale = value;
  } catch { /* Language fallback does not change the module or its permissions. */ }
  finally { if (timer !== undefined) clearTimeout(timer); }
  if (locale === null) {
    try { locale = chrome.i18n.getUILanguage(); } catch { locale = 'en'; }
  }
  mountFindingsApp(element, { ...target, locale });
}
