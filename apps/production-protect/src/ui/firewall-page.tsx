// ADR-047 (S4b, owner requirement 2026-10-18 «фаерволл должен быть попапом при обнаружении слежки и утечки, а не частью
// меню находок»): firewall.html, the firewall of the module «Защита» as its own action popup. The service worker sets it
// as the tab's popup (firewall.html?tab=<id>) while a prompt waits and opens it (surface.ts); the main popup links to
// it from its firewall line. The page is the vendored FirewallCard of 722fae8 unchanged (prototype structure: shield,
// title, site; the alert sentence; data chips; Кто отправил / Компания / Куда / Что ушло / Момент; the evidence;
// several receivers grouped; the scope Эта вкладка / Этот сайт / Везде; «Блокировать следующие» / «Разрешить»; the
// resolved state with «Отменить решение»; «Остановлено правилами сегодня» and «Настройки фаервола»), framed by a brand
// bar «Detect.Expert · Фаервол» with a way back to the main window. Truthful wording stays the vendored one (ADR-020
// §11: «отправлен» / «остановлен правилом, которое действовало до запроса» / «исход не наблюдался», only by fact).
// The tab comes from ?tab= (an extension URL only the extension opens); without it, the active tab of this window.

import { render } from 'preact';
import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import { useProtectReport } from '../../../../vendor/protect-722fae8/packages/ui/src/app/useProtectReport';
import { useProtectState } from '../../../../vendor/protect-722fae8/packages/ui/src/app/useProtectState';
import { FirewallCard } from '../../../../vendor/protect-722fae8/packages/ui/src/components/protect/firewall/FirewallCard';
import { openProtectOptions } from '../../../../vendor/protect-722fae8/packages/ui/src/messaging';
import { protectSurfaceVisible } from '../../../../vendor/protect-722fae8/packages/ui/src/view-models/protect';
import { moduleLocaleOf, setProductionLocale, t } from './i18n-shim';
import { IslandBoundary } from './islands';

/** Tab id of `?tab=<n>` (digits only, a safe non-negative integer), else null. */
export function readFirewallTab(search: string): number | null {
  const match = /(?:^\?|&)tab=(\d{1,10})(?:&|$)/.exec(typeof search === 'string' ? search : '');
  if (match === null || match[1] === undefined) return null;
  const tabId = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(tabId) && tabId >= 0 ? tabId : null;
}

function openMainWindow(): void {
  try {
    location.href = 'popup.html';
  } catch {
    // Static preview: nothing to open.
  }
}

function closeWindow(): void {
  try {
    window.close();
  } catch {
    // Not a popup window.
  }
}

export interface FirewallPageProps {
  tabId: number | null;
  locale: string | null;
}

function FirewallBody(props: FirewallPageProps): JSX.Element | null {
  const protect = useProtectState();
  const on = protectSurfaceVisible(protect.state);
  const report = useProtectReport(props.tabId, on, 1000);
  const state = protect.state;
  if (!protect.loaded) return null;
  const working = state !== null && on && props.tabId !== null && state.features.includes('firewall') && (state.state === 'active' || state.state === 'degraded');
  if (!working || state === null) {
    return (
      <div class="state protect-firewall__note" data-fw-page="unavailable">
        <p class="state__line">{t('fwp_unavailable')}</p>
        <p class="actions">
          <button type="button" class="button button--text" onClick={() => void openProtectOptions('protect')}>
            {t('protect_settings_link')}
          </button>
        </p>
      </div>
    );
  }
  return (
    <>
      <FirewallCard
        state={state}
        report={report.report}
        tabId={props.tabId}
        refreshState={protect.refresh}
        refreshReport={report.refresh}
        openSidePanel={() => undefined}
      />
      {report.loaded ? (
        // Shown by CSS only while the card shows nothing (no prompt, no outcome, no notice, not snoozed).
        <div class="protect-firewall__empty" data-fw-page="empty">
          <p class="protect-firewall__empty-line">{t('fwp_empty')}</p>
          <p class="actions">
            <button type="button" class="button button--text" onClick={() => void openProtectOptions('firewall')}>
              {t('fw_action_settings')}
            </button>
            <button type="button" class="button button--text" onClick={closeWindow}>
              {t('fwp_close')}
            </button>
          </p>
        </div>
      ) : null}
    </>
  );
}

export function FirewallPage(props: FirewallPageProps): JSX.Element {
  setProductionLocale(props.locale);
  useEffect(() => {
    try {
      document.title = t('fwp_page_title');
    } catch {
      // No document title (static preview).
    }
  });
  return (
    <main class="protect-firewall" data-protect-firewall="true" lang={moduleLocaleOf(props.locale)} dir="ltr">
      <header class="protect-firewall__bar">
        <p class="protect-firewall__brand">
          <span class="protect-firewall__product">Detect.Expert</span>
          <span class="protect-firewall__section">{t('fw_brand')}</span>
        </p>
        <button type="button" class="button button--text protect-firewall__main" data-fw-open-main="true" aria-label={t('fwp_open_main_label')} onClick={openMainWindow}>
          {t('fwp_open_main')}
          <span aria-hidden="true"> ›</span>
        </button>
      </header>
      {/* The island class gives the card the production look of the popup (surfaces.css). */}
      <div class="protect-island protect-firewall__island" data-protect-island="firewall">
        <IslandBoundary>
          <FirewallBody {...props} />
        </IslandBoundary>
      </div>
    </main>
  );
}

/** Renders firewall.html into `element`. */
export function mountFirewallApp(element: HTMLElement, tabId: number | null, locale: string | null): void {
  setProductionLocale(locale);
  render(<FirewallPage tabId={tabId} locale={locale} />, element);
}
