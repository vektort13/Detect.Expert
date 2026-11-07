// Side panel: the same component tree in a wider layout with tabs Обзор / Техники / Источники / Ограничения
// and an in-memory search box. Follows the active tab (tabs.onActivated + 1 s polling).

import { useMemo, useState } from 'preact/hooks';
import { t, tm } from '../i18n';
import { announcementFor } from '../view-models/announce';
import { filterCards, filterVendorCards, selectTopCards } from '../view-models/cards';
import type { CardVM } from '../view-models/cards';
import { hostsPresent, thirdPartyHosts } from '../view-models/counts';
import { categoryKey } from '../view-models/techniques';
import type { TechniqueCategory } from '../view-models/techniques';
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
import { Tabs, panelId, tabId } from '../components/Tabs';
import { VendorsSection } from '../components/VendorsSection';
import { POPUP_CARD_LIMIT } from './PopupApp';
import { useReportSession } from './useReportSession';
import { screenView } from './viewModels';

const TAB_IDS = ['overview', 'techniques', 'sources', 'limits'] as const;
type TabId = (typeof TAB_IDS)[number];

const CATEGORY_ORDER: ReadonlyArray<TechniqueCategory> = ['graphics', 'audio', 'environment', 'permissions', 'storage', 'network'];

function groupByCategory(cards: ReadonlyArray<CardVM>): Array<{ category: TechniqueCategory; cards: CardVM[] }> {
  const groups = new Map<TechniqueCategory, CardVM[]>();
  for (const card of cards) {
    const list = groups.get(card.category);
    if (list === undefined) groups.set(card.category, [card]);
    else list.push(card);
  }
  return CATEGORY_ORDER.filter((category) => groups.has(category)).map((category) => ({ category, cards: groups.get(category) ?? [] }));
}

const DROPPED_KEYS = ['observations', 'batches', 'findings', 'hosts', 'counters', 'transport', 'ring'] as const;

export function SidepanelApp() {
  const session = useReportSession({ surface: 'sidepanel', pollMs: 1000, watchTabs: true });
  const vm = useMemo(() => screenView(session), [session]);
  const [active, setActive] = useState<TabId>('overview');
  const [query, setQuery] = useState('');
  const announcement = announcementFor(session.report, vm.coverage.status);
  const liveText = useThrottledAnnouncement(announcement === null ? null : tm(announcement));
  const report = session.report;
  const filteredCards = useMemo(() => filterCards(vm.cards, query), [vm.cards, query]);
  const filteredVendors = useMemo(() => filterVendorCards(vm.vendors, query), [vm.vendors, query]);
  const hosts = useMemo(() => (report === null ? [] : thirdPartyHosts(report)), [report]);
  const hostsKnown = report !== null && hostsPresent(report);
  const topCards = selectTopCards(vm.cards, POPUP_CARD_LIMIT);
  const tabs = TAB_IDS.map((id) => ({ id, label: t('tab_' + id) }));
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
        count={active === 'techniques' ? new Set(filteredCards.map((card) => card.techniqueId)).size : filteredVendors.length + hosts.filter((entry) => (entry.registrableDomain ?? entry.category ?? 'unknown').includes(query.trim().toLowerCase())).length}
        label={t(active === 'techniques' ? 'group_techniques' : 'tab_sources')}
        unavailable={active === 'sources' && !vm.catalogAvailable && !hostsKnown}
      />

      <div {...panelProps('overview')}>
        <CoverageBox id="panel-coverage" vm={vm.coverage} onReload={() => void session.reload()} busy={session.busy} />
        {report !== null ? (
          <>
            <Counts vm={vm.counts} />
            <CardList id="panel-findings" cards={topCards} hiddenCount={vm.cards.length - topCards.length} onMore={() => setActive('techniques')} />
            <VendorsSection catalogAvailable={vm.catalogAvailable} id="panel-vendors" vendors={vm.vendors} />
            <ReportActions session={session} />
          </>
        ) : null}
        <ScopePicker
          surface="sidepanel"
          id="panel-scope"
          scope={session.scope}
          host={session.scopeHost}
          allowHostInput={false}
          busy={session.busy}
          onApply={(mode, host) => void session.applyScope(mode, host)}
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
          ) : filteredCards.length === 0 ? (
            <p class="muted">{t('search_empty')}</p>
          ) : (
            groupByCategory(filteredCards).map((group) => (
              <section key={group.category} class="group" aria-labelledby={'group-' + group.category}>
                <h3 id={'group-' + group.category} class="group__title">
                  {t(categoryKey(group.category))} <span class="muted num">({group.cards.length})</span>
                </h3>
                <div class="cards">
                  {group.cards.map((card) => (
                    <FindingCard key={card.id} idPrefix="panel-techniques" card={card} />
                  ))}
                </div>
              </section>
            ))
          )}
        </section>
      </div>

      <div {...panelProps('sources')}>
        <CoverageBox id="panel-coverage-sources" vm={vm.coverage} onReload={null} showFlags={false} />
        <VendorsSection catalogAvailable={vm.catalogAvailable} id="panel-sources-vendors" vendors={filteredVendors} />
        <section class="section" aria-labelledby="panel-hosts-title">
          <h2 id="panel-hosts-title" class="section__title">
            {t('sources_hosts_title')}
          </h2>
          {!hostsKnown ? (
            <p class="muted">{t('sources_none')}</p>
          ) : hosts.length === 0 ? (
            <p class="muted">{t('detail_none')}</p>
          ) : (
            <ul class="hosts">
              {hosts
                .filter((entry) => query.trim() === '' || (entry.registrableDomain ?? entry.category ?? 'unknown').includes(query.trim().toLowerCase()))
                .map((entry) => (
                  <li key={(entry.registrableDomain ?? entry.category ?? 'unknown')}>
                    <span class="mono" dir="auto">
                      {(entry.registrableDomain ?? entry.category ?? 'unknown')}
                    </span>{' '}
                    <span class="muted small">
                      {t('sources_requests', [String(entry.requestCount)])} · {t('integrity_browser_observed')}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </section>
      </div>

      <div {...panelProps('limits')}>
        <CoverageBox id="panel-coverage-limits" vm={vm.coverage} onReload={() => void session.reload()} busy={session.busy} />
        <section class="section state state--muted" aria-labelledby="panel-blind-title">
          <h2 id="panel-blind-title" class="state__title">
            {t('coverage_blind_spots_title')}
          </h2>
          <p>{t('coverage_blind_spots_desc')}</p>
          <p class="small muted">{t('onboarding_limits')}</p>
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
