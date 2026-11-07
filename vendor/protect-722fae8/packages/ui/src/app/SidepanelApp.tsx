// Side panel: the same component tree in a wider layout with tabs Обзор / Техники / Источники / Ограничения
// and an in-memory search box. Follows the active tab (tabs.onActivated + 1 s polling).
// S13 (E13-02, spec V §7): «Техники» has filters (category, interpretation, confidence, data source), grouping by
// category or interpretation and an approximate activity timeline (page-hook buckets only). Filters reset when the
// shown document changes; the search query is kept. Nothing of this is stored or sent.
// ADR-020 «Защита» (S06): only while the module is not off, the tabs «Защита» (evidence S07, session recording S11) and
// «Кто узнаёт» (history S12) follow the four tabs; otherwise TAB_IDS are the previous four.

import { useEffect, useMemo, useState } from 'preact/hooks';
import type { TechniqueId } from '@detect-expert/contracts';
import { PRODUCTION_CATALOG } from '@detect-expert/catalog';
import type { CatalogIndex } from '@detect-expert/catalog';
import { t, tm } from '../i18n';
import { announcementFor } from '../view-models/announce';
import { filterVendorCards, selectTopCards } from '../view-models/cards';
import { NO_FILTER, applyCardFilter, filterOptions, filterSummary, groupCards, isFilterActive } from '../view-models/filters';
import type { CardFilter, Grouping } from '../view-models/filters';
import { timelineRows } from '../view-models/timeline';
import { sourcesView } from '../view-models/sources';
import { offRevocableOf } from '../view-models/site-access';
import { protectSurfaceVisible } from '../view-models/protect';
import { ActivityTimeline } from '../components/ActivityTimeline';
import { CardList } from '../components/CardList';
import { Counts } from '../components/Counts';
import { CoverageBox } from '../components/CoverageBox';
import { ExportPreviewDialog } from '../components/ExportPreviewDialog';
import { FindingCard } from '../components/FindingCard';
import { Header } from '../components/Header';
import { LiveRegion, useThrottledAnnouncement } from '../components/LiveRegion';
import { Notice } from '../components/Notice';
import { ReportActions } from '../components/ReportActions';
import { ScopeLine } from '../components/ScopeLine';
import { ScopePicker } from '../components/ScopePicker';
import { SearchBox } from '../components/SearchBox';
import { SearchFeedback } from '../components/SearchFeedback';
import { SourcesSection, sourceRowCount } from '../components/SourcesSection';
import { Tabs, panelId, tabId } from '../components/Tabs';
import { TechniqueFilters } from '../components/TechniqueFilters';
import { VendorsSection } from '../components/VendorsSection';
import { HistoryPanel } from '../components/protect/history/HistoryPanel';
import { ProtectSidepanel } from '../components/protect/ProtectSidepanel';
import { POPUP_CARD_LIMIT } from './PopupApp';
import { useProtectReport } from './useProtectReport';
import { useProtectState } from './useProtectState';
import { useReportSession } from './useReportSession';
import { screenView } from './viewModels';

const TAB_IDS = ['overview', 'techniques', 'sources', 'limits'] as const;
/** ADR-020: tabs of the module, appended only while it is not off. */
const PROTECT_TAB_IDS = ['protect', 'history'] as const;
type TabId = (typeof TAB_IDS)[number] | (typeof PROTECT_TAB_IDS)[number];

const DROPPED_KEYS = ['observations', 'batches', 'findings', 'hosts', 'counters', 'transport', 'ring'] as const;

export interface SidepanelAppProps {
  /** S10: the build's vendor catalog (display names, rule texts, rule counts); the test entry passes the synthetic one. */
  catalog?: CatalogIndex;
}

export function SidepanelApp(props: SidepanelAppProps = {}) {
  const catalog = props.catalog ?? PRODUCTION_CATALOG;
  const session = useReportSession({ surface: 'sidepanel', pollMs: 1000, watchTabs: true });
  const protect = useProtectState({ watch: true });
  const protectOn = protectSurfaceVisible(protect.state);
  const protectReport = useProtectReport(session.tabId, protectOn, 1000);
  const vm = useMemo(() => screenView(session, catalog), [session, catalog]);
  const [active, setActive] = useState<TabId>('overview');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<CardFilter>(NO_FILTER);
  const [grouping, setGrouping] = useState<Grouping>('category');
  const announcement = announcementFor(session.report, vm.coverage.status);
  const liveText = useThrottledAnnouncement(announcement === null ? null : tm(announcement));
  const report = session.report;
  const documentKey = report?.documentKey ?? null;
  // Another document: its cards are not the ones the filters were chosen for. The query stays.
  useEffect(() => {
    setFilter(NO_FILTER);
  }, [documentKey]);
  // The module was turned off while one of its tabs was shown.
  useEffect(() => {
    if (!protectOn && (active === 'protect' || active === 'history')) setActive('overview');
  }, [protectOn, active]);
  const filterActive = isFilterActive(filter);
  const filteredCards = useMemo(() => applyCardFilter(vm.cards, query, filter), [vm.cards, query, filter]);
  const options = useMemo(() => filterOptions(vm.cards, filter), [vm.cards, filter]);
  const groups = useMemo(() => groupCards(filteredCards, grouping), [filteredCards, grouping]);
  const timeline = useMemo(() => {
    const include = new Set<TechniqueId>(filteredCards.map((card) => card.techniqueId));
    return timelineRows(report?.techniques ?? [], include);
  }, [report, filteredCards]);
  const lateStart = report !== null && (report.coverageState === 'late-start' || report.coverageFlags.includes('late-start'));
  const filteredVendors = useMemo(() => filterVendorCards(vm.vendors, query), [vm.vendors, query]);
  // S08: the hosts part of «Источники» (ADR-018); search counts its rows by the shown (localized) name.
  const sources = useMemo(() => sourcesView(report), [report]);
  const topCards = selectTopCards(vm.cards, POPUP_CARD_LIMIT);
  const tabIds: ReadonlyArray<TabId> = protectOn ? [...TAB_IDS, ...PROTECT_TAB_IDS] : TAB_IDS;
  const tabs = tabIds.map((id) => ({ id, label: t('tab_' + id) }));
  const prefix = 'panel';

  const panelProps = (id: TabId) => ({
    id: panelId(prefix, id),
    role: 'tabpanel' as const,
    'aria-labelledby': tabId(prefix, id),
    hidden: active !== id,
    class: 'tabpanel',
    tabIndex: 0,
  });

  return (
    <main class="app app--panel">
      <Header
        title={t('sidepanelTitle')}
        host={report?.host ?? null}
        status={vm.coverage.status}
        tone={vm.coverage.tone}
        observedSince={report?.observedSince ?? null}
      />
      <LiveRegion text={liveText} />
      <Notice notice={session.notice} onDismiss={session.dismissNotice} />
      <Tabs idPrefix={prefix} tabs={tabs} active={active} onChange={(id) => setActive(id as TabId)} />
      <SearchBox id="panel-search" describedBy="panel-search-feedback" value={query} onInput={setQuery} />
      {/* P08 / F052: persistent polite search region, latest result throttled to 2 s. */}
      <SearchFeedback
        id="panel-search-feedback"
        query={query}
        active={active === 'techniques' || active === 'sources'}
        count={active === 'techniques' ? filteredCards.length : filteredVendors.length + sourceRowCount(sources, query)}
        summary={active === 'techniques' ? tm(filterSummary(filteredCards.length, vm.cards.length)) : t('tab_sources') + ': ' + String(filteredVendors.length + sourceRowCount(sources, query))}
        filterActive={active === 'techniques' && filterActive}
        unavailable={active === 'sources' && !vm.catalogAvailable && !sources.known}
      />

      <div {...panelProps('overview')}>
        <CoverageBox id="panel-coverage" vm={vm.coverage} onReload={() => void session.reload()} busy={session.busy} />
        {report !== null ? (
          <>
            <Counts vm={vm.counts} />
            <CardList id="panel-findings" cards={topCards} hiddenCount={vm.cards.length - topCards.length} onMore={() => setActive('techniques')} />
            <VendorsSection catalogAvailable={vm.catalogAvailable} id="panel-vendors" vendors={vm.vendors} coverageLimited={vm.vendorsCoverageLimited} />
            <ReportActions session={session} idPrefix="panel" />
          </>
        ) : null}
        <ScopePicker
          surface="sidepanel"
          id="panel-scope"
          scope={session.scope}
          host={session.scopeHost}
          allowHostInput={false}
          busy={session.busy}
          offRevocable={offRevocableOf(session.access).length}
          onManageAccess={() => void session.openOptions()}
          protectOn={protect.state?.state === 'active' || protect.state?.state === 'degraded'}
          onApply={(mode, host, options) => void session.applyScope(mode, host, options)}
        />
        <ScopeLine scope={session.scope} loaded={session.loaded} />
      </div>

      <div {...panelProps('techniques')}>
        <CoverageBox id="panel-coverage-techniques" vm={vm.coverage} onReload={null} showFlags={false} />
        <section class="section" aria-labelledby="panel-techniques-title">
          <h2 id="panel-techniques-title" class="section__title">
            {t('techniques_title')}
          </h2>
          {vm.cards.length === 0 ? (
            <div class="empty">
              <p class="empty__title">{t('empty_no_findings')}</p>
              <p class="small muted">{t('empty_no_findings_hint')}</p>
            </div>
          ) : (
            <>
              <TechniqueFilters
                idPrefix="panel"
                options={options}
                filter={filter}
                onFilter={setFilter}
                grouping={grouping}
                onGrouping={setGrouping}
                shown={filteredCards.length}
                total={vm.cards.length}
              />
              {filteredCards.length === 0 ? (
                <p class="muted" data-filter-empty="true">{filterActive ? t('filter_empty') : t('search_empty')}</p>
              ) : (
                groups.map((group) => (
                  <section key={grouping + ':' + group.key} class="group" aria-labelledby={'group-' + grouping + '-' + group.key}>
                    <h3 id={'group-' + grouping + '-' + group.key} class="group__title">
                      {tm(group.label)} <span class="muted num">({group.cards.length})</span>
                    </h3>
                    <div class="cards">
                      {group.cards.map((card) => (
                        <FindingCard key={card.id} idPrefix="panel-techniques" card={card} />
                      ))}
                    </div>
                  </section>
                ))
              )}
              <ActivityTimeline idPrefix="panel" rows={timeline} lateStart={lateStart} />
            </>
          )}
        </section>
      </div>

      <div {...panelProps('sources')}>
        <CoverageBox id="panel-coverage-sources" vm={vm.coverage} onReload={null} showFlags={false} />
        <VendorsSection catalogAvailable={vm.catalogAvailable} id="panel-sources-vendors" vendors={filteredVendors} coverageLimited={vm.vendorsCoverageLimited} />
        <SourcesSection id="panel-hosts" vm={sources} query={query} />
      </div>

      <div {...panelProps('limits')}>
        <CoverageBox id="panel-coverage-limits" vm={vm.coverage} onReload={() => void session.reload()} busy={session.busy} />
        <section class="section state state--muted" aria-labelledby="panel-blind-title">
          <h2 id="panel-blind-title" class="state__title">
            {t('coverage_blind_spots_title')}
          </h2>
          <p>{t('coverage_blind_spots_desc')}</p>
          <p class="small muted">{t('onboarding_limits')}</p>
          {/* S10 / ADR-009 v1.1: rules that can match in this build vs unverified candidates that are not used. */}
          <p class="small muted" data-catalog-counts="true">{t('catalog_rule_counts', [String(vm.catalogCounts.active), String(vm.catalogCounts.candidates)])}</p>
        </section>
        {report !== null ? (
          <section class="section" aria-labelledby="panel-dropped-title">
            <h2 id="panel-dropped-title" class="section__title">
              {t('dropped_title')}
            </h2>
            <dl class="details">
              {DROPPED_KEYS.map((key) => (
                <div key={key} class="details__row">
                  <dt>{t('dropped_' + key)}</dt>
                  <dd class="num">{report.dropped[key] ?? 0}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}
        <p class="small muted">{t('disclaimerNoVerdict')}</p>
      </div>

      {protectOn && protect.state !== null ? (
        <>
          <div {...panelProps('protect')}>
            <ProtectSidepanel state={protect.state} report={protectReport.report} tabId={session.tabId}
              refreshState={protect.refresh} refreshReport={protectReport.refresh} />
          </div>
          <div {...panelProps('history')}>
            <HistoryPanel state={protect.state} report={protectReport.report} tabId={session.tabId}
              refreshState={protect.refresh} refreshReport={protectReport.refresh} />
          </div>
        </>
      ) : null}

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
