// Popup (360–400 px): host + status, coverage first, three numbers, up to five cards, recognized services,
// actions, scope picker, export preview dialog. Polls the SW every second while visible.

import { useMemo } from 'preact/hooks';
import { t, tm } from '../i18n';
import { announcementFor } from '../view-models/announce';
import { selectTopCards } from '../view-models/cards';
import { popupLayout } from '../view-models/popup';
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
import { useReportSession } from './useReportSession';
import { screenView } from './viewModels';

export const POPUP_CARD_LIMIT = 5;

export function PopupApp() {
  const session = useReportSession({ surface: 'popup', pollMs: 1000, watchTabs: false });
  const vm = useMemo(() => screenView(session), [session]);
  const announcement = announcementFor(session.report, vm.coverage.status);
  const liveText = useThrottledAnnouncement(announcement === null ? null : tm(announcement));
  const topCards = selectTopCards(vm.cards, POPUP_CARD_LIMIT);
  const hiddenCount = vm.cards.length - topCards.length;
  const report = session.report;
  // P11 / ADR-003: activation is the main action until this document has access.
  const layout = popupLayout(session.scope?.scopeMode ?? null, report?.coverageState ?? null, report !== null);
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
      onApply={(mode, host) => void session.applyScope(mode, host)}
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
          case 'coverage': return <CoverageBox key={section} id="coverage" vm={vm.coverage} onReload={() => void session.reload()} busy={session.busy} />;
          case 'scope': return activationNeeded
            ? <section key={section} class="section" data-scope-activation="true">{scopePicker}</section>
            : <details key={section} class="section" open={layout.scope.open}>
              <summary class="section__title">{t('scopeLabel')}</summary>
              {scopePicker}
            </details>;
          case 'counts': return <Counts key={section} vm={vm.counts} />;
          case 'findings': return <CardList key={section} id="findings" cards={topCards} hiddenCount={hiddenCount} onMore={() => void session.openSidePanel()} />;
          case 'vendors': return <VendorsSection key={section} catalogAvailable={vm.catalogAvailable} id="vendors" vendors={vm.vendors} />;
          case 'actions': return <ReportActions key={section} session={session} />;
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
