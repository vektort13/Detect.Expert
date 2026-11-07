// ADR-047 (S4b, owner requirement 2026-10-18): the module area of the MAIN popup without the firewall decision card.
// The firewall is its own popup (firewall.html, firewall-page.tsx) that the service worker opens when a prompt waits
// (surface.ts); here, among the findings, only one line says that the firewall waits (or has notices, or is snoozed)
// and opens the firewall page in this popup. GPC (S13) and the data-request reminder (S14) stay here; transfer and
// session-recording findings have a separate surface per the owner's 2026-10-20 request. The compact Firewall
// launcher owns the module state and settings navigation.

import type { JSX } from 'preact';
import type { ProtectProjection, ProtectState } from '@detect-expert/contracts';
import type { ProtectPopupSlotProps } from '../../../../vendor/protect-722fae8/packages/ui/src/components/protect/ProtectPopupArea';
import { GpcSiteLine } from '../../../../vendor/protect-722fae8/packages/ui/src/components/protect/gpc/GpcSiteLine';
import { RequestsReminder } from '../../../../vendor/protect-722fae8/packages/ui/src/components/protect/requests/RequestsReminder';
import { firewallCardView, firewallLiveText, firewallNotices, firewallSnoozedUntil } from '../../../../vendor/protect-722fae8/packages/ui/src/view-models/protect-firewall';
import { t, tm, uiLocale } from './i18n-shim';

/** firewall.html for a tab (the page reads ?tab=; the service worker sets the same path as the per-tab popup). */
export function firewallPageHref(tabId: number): string {
  return 'firewall.html?tab=' + String(tabId);
}

function formatTime(epochMs: number): string {
  try {
    return new Intl.DateTimeFormat(uiLocale(), { hour: '2-digit', minute: '2-digit' }).format(new Date(epochMs));
  } catch {
    return new Date(epochMs).toISOString().slice(11, 16);
  }
}

export interface FirewallLineProps {
  state: ProtectState;
  report: ProtectProjection | null;
  tabId: number | null;
}

/** What the firewall line says, or null (nothing waits, no notice, not snoozed, firewall feature off). */
export function firewallLineView(props: FirewallLineProps, now: number): { kind: 'pending' | 'notices' | 'snoozed'; text: string } | null {
  if (props.tabId === null || !props.state.features.includes('firewall')) return null;
  const card = firewallCardView(props.state, props.report);
  const live = firewallLiveText(card);
  if (live !== null) return { kind: 'pending', text: tm(live) };
  const notices = card === null ? firewallNotices(props.report) : [];
  if (notices.length > 0) return { kind: 'notices', text: t('fwp_line_notices', [String(notices.length)]) };
  const snoozed = firewallSnoozedUntil(props.state, now);
  if (snoozed !== null) return { kind: 'snoozed', text: t('protect_snooze_until', [formatTime(snoozed)]) };
  return null;
}

function openFirewallPage(tabId: number): void {
  try {
    location.href = firewallPageHref(tabId);
  } catch {
    // Static preview without location: nothing to open.
  }
}

/** One status line of the firewall in the main popup (never the decision card). */
export function FirewallLine(props: FirewallLineProps): JSX.Element | null {
  const view = firewallLineView(props, Date.now());
  const tabId = props.tabId;
  if (view === null || tabId === null) return null;
  return (
    <div class={'state protect-fw-line' + (view.kind === 'pending' ? ' state--attention' : '')} data-fw-line={view.kind}>
      <p class="state__line">{view.text}</p>
      <p class="actions">
        <button type="button" class="button button--text" data-fw-line-open="true" onClick={() => openFirewallPage(tabId)}>
          {t('fwp_line_open')}
        </button>
      </p>
    </div>
  );
}

/** Main popup keeps firewall notices, GPC and request reminders; findings use their separate surface. */
export function PopupProtectArea(props: ProtectPopupSlotProps): JSX.Element {
  return (
    <section class="section" aria-labelledby="popup-protect-title" data-protect-area="true">
      <h2 id="popup-protect-title" class="sr-only">
        {t('protect_title')}
      </h2>
      <FirewallLine state={props.state} report={props.report} tabId={props.tabId} />
      <GpcSiteLine {...props} />
      <RequestsReminder {...props} />
    </section>
  );
}
