// Popup (360–400 px): host + status, coverage first, three numbers, up to five cards, recognized services,
// actions, scope picker, export preview dialog. Polls the SW every second while visible.
// ADR-020 «Защита» (S06): one ui-protect-get-state at open; only while the module is not off, its area comes first and
// its projection follows the same one-second poll. Module off: the popup is exactly the previous one.

import { useMemo } from 'preact/hooks';
import { PRODUCTION_CATALOG } from '@detect-expert/catalog';
import type { CatalogIndex } from '@detect-expert/catalog';
import { t, tm } from '../i18n';
import { announcementFor } from '../view-models/announce';
import { selectTopCards } from '../view-models/cards';
import { popupLayout } from '../view-models/popup';
import { protectSurfaceVisible } from '../view-models/protect';
import { offRevocableOf } from '../view-models/site-access';
import { CardList } from '../components/CardList';
import { Counts } from '../components/Counts';
import { CoverageBox } from '../components/CoverageBox';
import { ExportPreviewDialog } from '../components/ExportPreviewDialog';
import { Header } from '../components/Header';
import { LiveRegion, useThrottledAnnouncement } from '../components/LiveRegion';
import { Notice } from '../components/Notice';
import { ReportActions } from '../components/ReportActions';
import { ScopeLine } from '../components/ScopeLine';
import { ScopePicker } from '../components/ScopePicker';
import { VendorsSection } from '../components/VendorsSection';
import { ProtectPopupArea } from '../components/protect/ProtectPopupArea';
import { useProtectReport } from './useProtectReport';
import { useProtectState } from './useProtectState';
import { useReportSession } from './useReportSession';
import { screenView } from './viewModels';

export const POPUP_CARD_LIMIT = 5;

export interface PopupAppProps {
  /** S10: the build's vendor catalog (display names and rule texts); the test entry passes the synthetic one. */
  catalog?: CatalogIndex;
}

export function PopupApp(props: PopupAppProps = {}) {
  const catalog = props.catalog ?? PRODUCTION_CATALOG;
  const session = useReportSession({ surface: 'popup', pollMs: 1000, watchTabs: false });
  const protect = useProtectState();
  const protectOn = protectSurfaceVisible(protect.state);
  const protectReport = useProtectReport(session.tabId, protectOn, 1000);
  const vm = useMemo(() => screenView(session, catalog), [session, catalog]);
  const announcement = announcementFor(session.report, vm.coverage.status);
  const liveText = useThrottledAnnouncement(announcement === null ? null : tm(announcement));
  const topCards = selectTopCards(vm.cards, POPUP_CARD_LIMIT);
  const hiddenCount = vm.cards.length - topCards.length;
  const report = session.report;
  // P11 / ADR-003: activation is the main action until this document has access.
  const layout = popupLayout(session.scope?.scopeMode ?? null, report?.coverageState ?? null, report !== null, protectOn ? 'area' : null);
  const activationNeeded = layout.scope.open;
  const scopePicker = (
    <ScopePicker
      surface="popup"
      id="popup-scope"
      scope={session.scope}
      host={session.scopeHost}
      allowHostInput={false}
      busy={session.busy}
      activation={activationNeeded}
      offRevocable={offRevocableOf(session.access).length}
      onManageAccess={() => void session.openOptions()}
      protectOn={protect.state?.state === 'active' || protect.state?.state === 'degraded'}
      onApply={(mode, host, options) => void session.applyScope(mode, host, options)}
    />
  );

  return (
    <main class="app app--popup">
      <Header
        title={t('popupTitle')}
        host={report?.host ?? (activationNeeded ? session.scopeHost : null)}
        unknownHostKey={activationNeeded ? 'host_access_needed' : 'host_unknown'}
        status={vm.coverage.status}
        tone={vm.coverage.tone}
        observedSince={report?.observedSince ?? null}
      />
      <LiveRegion text={liveText} />
      <Notice notice={session.notice} onDismiss={session.dismissNotice}
        onReload={session.justGranted && (session.notice?.message.key === 'scope_permission_granted_reload' || session.notice?.message.key === 'scope_applied_reload')
          ? () => { session.dismissNotice(); void session.reload(); } : undefined}
        busy={session.busy} />
      {layout.sections.map((section) => {
        switch (section) {
          case 'protect': return protect.state === null ? null : (
            <ProtectPopupArea key={section} state={protect.state} report={protectReport.report} tabId={session.tabId}
              refreshState={protect.refresh} refreshReport={protectReport.refresh} openSidePanel={() => void session.openSidePanel()} />
          );
          case 'coverage': return <CoverageBox key={section} id="coverage" vm={vm.coverage} onReload={() => void session.reload()} busy={session.busy} />;
          case 'scope': return activationNeeded
            ? <section key={section} class="section" data-scope-activation="true">{scopePicker}</section>
            : <details key={section} class="section" open={layout.scope.open}>
              <summary class="section__title">{t('scopeLabel')}</summary>
              {scopePicker}
            </details>;
          case 'counts': return <Counts key={section} vm={vm.counts} />;
          case 'findings': return <CardList key={section} id="findings" cards={topCards} hiddenCount={hiddenCount} onMore={() => void session.openSidePanel()} />;
          case 'vendors': return <VendorsSection key={section} catalogAvailable={vm.catalogAvailable} id="vendors" vendors={vm.vendors} coverageLimited={vm.vendorsCoverageLimited} />;
          case 'actions': return <ReportActions key={section} session={session} idPrefix="popup" />;
        }
      })}
      <ScopeLine scope={session.scope} loaded={session.loaded} />
      <footer class="footer">
        <p class="small muted">{t('disclaimerNoVerdict')}</p>
        <p class="actions actions--wrap">
          <button type="button" class="button button--text" onClick={() => void session.openSidePanel()}>
            {t('open_sidepanel')}
          </button>
          <button type="button" class="button button--text" onClick={() => void session.openOptions()}>
            {t('open_options')}
          </button>
        </p>
      </footer>
      <ExportPreviewDialog
        preview={session.preview}
        host={session.exportHost}
        onIncludeHost={session.setExportHost}
        status={session.exportStatus}
        onConfirm={() => void session.confirmExport()}
        onCancel={session.cancelExport}
      />
    </main>
  );
}
