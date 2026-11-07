// Options page: onboarding text, scope picker (with host input for the `site` mode), site access (S12 / E13-03:
// remove a site, revoke all sites, Chrome settings link), sensor families (ADR-019),
// «Очистить данные сессии» and the bundled data-inventory summary. No polling: one scope fetch plus refresh after
// actions. S13 (E13-02): clearing the session asks for confirmation first (ConfirmDialog).
// ADR-020 «Защита» (S06): while the module is off and keeps no data, the page is the previous one plus one section at
// the end (enable only). Otherwise the same sections move into the tab «Наблюдение» and the module gets the tab
// «Защита» (ProtectOptionsPanel). The first tab comes from location.hash (#protect, #firewall, #history, #requests);
// switching tabs rewrites the hash with history.replaceState. The module is enabled only here (isOptionsSender).

import { t } from '../i18n';
import { useEffect, useRef, useState } from 'preact/hooks';
import { diagnosticPreview } from '../../../export/src/index';
import { triggerDownload } from '../download';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Notice } from '../components/Notice';
import { ScopeLine } from '../components/ScopeLine';
import { ScopePicker } from '../components/ScopePicker';
import { SensorSettings } from '../components/SensorSettings';
import { SITE_ACCESS_TITLE_ID, SiteAccessSection } from '../components/SiteAccessSection';
import { Tabs, panelId, tabId } from '../components/Tabs';
import { ProtectOptionsPanel } from '../components/protect/ProtectOptionsPanel';
import { PROTECT_SECTION_TITLE_ID, ProtectSection } from '../components/protect/ProtectSection';
import { offRevocableOf, siteAccessView } from '../view-models/site-access';
import { disabledSensorIds, organizationPolicyOf, rejectedPolicyEntriesOf } from '../view-models/sensors';
import { OPTIONS_TAB_IDS, optionsHasProtectTabs, optionsHashForTab, optionsTabFromHash } from '../view-models/protect';
import type { OptionsTabId } from '../view-models/protect';
import { useProtectState } from './useProtectState';
import { useReportSession } from './useReportSession';

const INVENTORY_KEYS = ['inventory_session', 'inventory_local', 'inventory_never', 'inventory_export', 'inventory_sync', 'inventory_link'] as const;
const OPTIONS_TAB_KEYS: Readonly<Record<OptionsTabId, string>> = { observation: 'options_tab_observation', protect: 'options_tab_protect' };

function currentHash(): string {
  try {
    return typeof location === 'undefined' ? '' : location.hash;
  } catch {
    return '';
  }
}

export function OptionsApp() {
  const session = useReportSession({ surface: 'options', pollMs: 0, watchTabs: false });
  const protect = useProtectState({ watch: true });
  const [diagnostics, setDiagnostics] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [tab, setTab] = useState<OptionsTabId>(() => optionsTabFromHash(currentHash()));
  const clearInvoker = useRef<HTMLButtonElement | null>(null);
  /** After enable / disable the layout may switch; focus goes to the module heading once it is rendered. */
  const focusProtectTitle = useRef(false);
  const closeConfirm = (): void => {
    setConfirmClear(false);
    if (clearInvoker.current?.isConnected === true) clearInvoker.current.focus();
  };
  const hasTabs = optionsHasProtectTabs(protect.state);
  /** ADR-003 v4 п. 3 (S15): revoking all-sites access suspends a running module; the picker and site access say so. */
  const protectRunning = protect.state?.state === 'active' || protect.state?.state === 'degraded';

  const selectTab = (next: OptionsTabId): void => {
    setTab(next);
    try {
      history.replaceState(null, '', location.pathname + location.search + optionsHashForTab(next, location.hash));
    } catch {
      // no history API (static preview): the tab still switches
    }
  };

  const onLayoutAction = (action: 'enabled' | 'stopped'): void => {
    if (action === 'enabled') selectTab('protect');
    focusProtectTitle.current = true;
  };

  useEffect(() => {
    if (!focusProtectTitle.current) return;
    const title = document.getElementById(PROTECT_SECTION_TITLE_ID);
    // Wait for the render that shows the «Защита» panel (a hidden heading cannot take focus).
    if (title === null || title.closest('[hidden]') !== null) return;
    focusProtectTitle.current = false;
    title.focus();
  });

  const observation = (
    <>
      <section class="section state state--muted" aria-labelledby="options-onboarding-title">
        <h2 id="options-onboarding-title" class="state__title">
          {t('options_onboarding_title')}
        </h2>
        <p>{t('onboarding_limits')}</p>
        <p>{t('onboarding_no_server')}</p>
        <p class="small muted">{t('disclaimerNoVerdict')}</p>
      </section>

      <section class="section">
        <ScopePicker
          surface="options"
          id="options-scope"
          scope={session.scope}
          host={null}
          allowHostInput={true}
          busy={session.busy}
          offRevocable={offRevocableOf(session.access).length}
          onManageAccess={() => document.getElementById(SITE_ACCESS_TITLE_ID)?.focus()}
          protectOn={protectRunning}
          onApply={(mode, host, options) => void session.applyScope(mode, host, options)}
        />
        <ScopeLine scope={session.scope} loaded={session.loaded} />
      </section>

      <SiteAccessSection
        vm={siteAccessView(session.scope, session.access)}
        busy={session.busy}
        onRemove={session.removeSite}
        onRevokeAll={() => void session.revokeAllSites()}
        onOpenChrome={() => void session.openChromeSiteAccess()}
        protectOn={protectRunning}
      />

      <SensorSettings id="options-sensors" scope={session.scope} busy={session.busy} onChange={(id, enabled) => void session.applySensor(id, enabled)} />

      <section class="section" aria-labelledby="options-clear-title">
        <h2 id="options-clear-title" class="section__title">
          {t('options_clear_session')}
        </h2>
        <p class="small muted">{t('options_clear_session_desc')}</p>
        <p class="actions">
          <button
            type="button"
            class="button"
            aria-disabled={session.busy}
            aria-busy={session.busy}
            onClick={(event) => {
              if (session.busy) return;
              clearInvoker.current = event.currentTarget;
              setConfirmClear(true);
            }}
          >
            {t('options_clear_session')}
          </button>
        </p>
        {confirmClear ? (
          <ConfirmDialog
            id="options-confirm-clear-session"
            title={t('confirm_clear_session_title')}
            description={t('confirm_clear_session_desc')}
            confirmLabel={t('confirm_clear_session_action')}
            onCancel={closeConfirm}
            onConfirm={() => {
              closeConfirm();
              void session.clearSession();
            }}
          />
        ) : null}
      </section>

      <section class="section" aria-labelledby="options-inventory-title">
        <h2 id="options-inventory-title" class="section__title">
          {t('options_inventory_title')}
        </h2>
        <ul class="inventory">
          {INVENTORY_KEYS.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
      </section>
      <section class="section" aria-labelledby="options-diagnostics-title">
        <h2 id="options-diagnostics-title" class="section__title">{t('options_diagnostics_title')}</h2>
        <p>{t('options_diagnostics_desc')}</p>
        <button type="button" class="button" onClick={() => {
          let version = 'unknown';
          try { version = chrome.runtime.getManifest().version; } catch { /* unavailable */ }
          setDiagnostics(JSON.stringify(diagnosticPreview(version, session.chrome.major, session.swAvailable, {
            off: disabledSensorIds(session.scope),
            organizationPolicy: organizationPolicyOf(session.scope),
            rejectedPolicyEntries: rejectedPolicyEntriesOf(session.scope),
          }), null, 2) + '\n');
        }}>{t('options_diagnostics_preview')}</button>
        {diagnostics !== null && <>
          <pre tabIndex={0}>{diagnostics}</pre>
          <button type="button" class="button" onClick={() => triggerDownload({ fileName: 'detect-expert-diagnostics.json', mime: 'application/json', text: diagnostics })}>{t('export_save')}</button>
        </>}
      </section>
    </>
  );

  const panelProps = (id: OptionsTabId) => ({
    id: panelId('options', id),
    role: 'tabpanel' as const,
    'aria-labelledby': tabId('options', id),
    hidden: tab !== id,
    class: 'tabpanel',
  });

  return (
    <main class="app app--options">
      <header class="header">
        <h1 class="app__title">{t('optionsTitle')}</h1>
      </header>
      <Notice notice={session.notice} onDismiss={session.dismissNotice} />

      {hasTabs && protect.state !== null ? (
        <>
          <Tabs
            idPrefix="options"
            tabs={OPTIONS_TAB_IDS.map((id) => ({ id, label: t(OPTIONS_TAB_KEYS[id]) }))}
            active={tab}
            onChange={(id) => selectTab(id === 'protect' ? 'protect' : 'observation')}
          />
          <div {...panelProps('observation')}>{observation}</div>
          <div {...panelProps('protect')}>
            <ProtectOptionsPanel session={protect} state={protect.state} onLayoutAction={onLayoutAction} />
          </div>
        </>
      ) : (
        <>
          {observation}
          {protect.state !== null ? <ProtectSection session={protect} state={protect.state} mode="enable-only" onLayoutAction={onLayoutAction} /> : null}
        </>
      )}
    </main>
  );
}
