// ADR-020 §G (S12): side-panel tab «Кто узнаёт». Order: title and intro, coverage block (since, scope, limits, storage),
// «На этом сайте» (receivers of the shown tab's site and its families without a source), period 7/30/90 (radio
// group), «Только с механизмами связи», the list (pages of ≤ 50, «Показать ещё»), domains seen on one site only (count),
// details «Чего история не видит». No verdict: a mechanism is a possibility with a confidence and its integrity.
// Nothing is stored by this page; every answer is read defensively (view-models/protect-history.ts).

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { HistoryProjection, HistoryRow, HistoryWindowDays, ScopeMode } from '@detect-expert/contracts';
import { isSiteName } from '@detect-expert/contracts';
import { t, tm, uiLocale } from '../../../i18n';
import { errorMessageKey, protectUi, sendUiRequest } from '../../../messaging';
import { msg } from '../../../view-models/message';
import {
  HISTORY_DEFAULT_WINDOW,
  HISTORY_PAGE_SIZE,
  appendHistoryRows,
  familiesMessage,
  historyCoverageLines,
  historyEnabled,
  historyRowView,
  historyWindowChoices,
  parseHistoryProjection,
  rowDomain,
} from '../../../view-models/protect-history';
import { IntegrityBadge } from '../../IntegrityBadge';
import type { ProtectPanelSlotProps } from '../ProtectSidepanel';
import { HistoryReceiverCard } from './HistoryReceiverCard';

const LIST_TITLE_ID = 'history-list-title';

async function readScopeMode(): Promise<ScopeMode | null> {
  const result = await sendUiRequest({ schemaVersion: 1, type: 'ui-get-scope' });
  return result.ok && result.response.type === 'scope' ? result.response.scope.scopeMode : null;
}

export function HistoryPanel(props: ProtectPanelSlotProps): JSX.Element | null {
  const enabled = historyEnabled(props.state);
  const [windowDays, setWindowDays] = useState<HistoryWindowDays>(HISTORY_DEFAULT_WINDOW);
  const [mechanismsOnly, setMechanismsOnly] = useState(false);
  const [projection, setProjection] = useState<HistoryProjection | null>(null);
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [siteProjection, setSiteProjection] = useState<HistoryProjection | null>(null);
  const [scopeMode, setScopeMode] = useState<ScopeMode | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [status, setStatus] = useState('');
  const seq = useRef(0);
  const listTitle = useRef<HTMLHeadingElement>(null);
  const openRef = useRef<string | null>(null);
  openRef.current = open;
  /** After a deletion: when the open row is gone from the reloaded list, the focus moves to the list heading. */
  const focusAfterReload = useRef(false);
  const locale = uiLocale();
  const site = props.report?.site ?? null;
  const siteName = site !== null && isSiteName(site) ? site : null;

  useEffect(() => {
    if (!enabled) return;
    void readScopeMode().then(setScopeMode);
  }, [enabled]);

  // First page (window, filter or a deletion changed).
  useEffect(() => {
    if (!enabled) return;
    const mine = ++seq.current;
    setLoading(true);
    void protectUi.historyQuery({ windowDays, offset: 0, limit: HISTORY_PAGE_SIZE, mechanismsOnly }).then((result) => {
      if (mine !== seq.current) return;
      setLoading(false);
      if (!result.ok) {
        setError(errorMessageKey(result.code));
        return;
      }
      const h = parseHistoryProjection(result.response);
      if (h === null) {
        setError(errorMessageKey('unavailable'));
        return;
      }
      setError(null);
      setProjection(h);
      setRows(h.rows);
      const shown = openRef.current;
      if (shown !== null && !h.rows.some((r) => r.rowKey === shown)) {
        setOpen(null);
        if (focusAfterReload.current) listTitle.current?.focus();
      }
      focusAfterReload.current = false;
    });
  }, [enabled, windowDays, mechanismsOnly, reload]);

  // «На этом сайте»: receivers of the shown tab's site.
  useEffect(() => {
    if (!enabled || siteName === null) {
      setSiteProjection(null);
      return;
    }
    let live = true;
    void protectUi.historyQuery({ windowDays, offset: 0, limit: 1, minSites: 1, site: siteName }).then((result) => {
      if (!live) return;
      setSiteProjection(result.ok ? parseHistoryProjection(result.response) : null);
    });
    return () => {
      live = false;
    };
  }, [enabled, windowDays, siteName, reload]);

  if (!enabled) {
    return (
      <section class="section history" aria-labelledby="history-title" data-history-panel="off">
        <h2 id="history-title" class="section__title">{t('history_title')}</h2>
        <p>{t('history_off_desc')}</p>
      </section>
    );
  }

  const showMore = async (): Promise<void> => {
    const mine = ++seq.current;
    setLoading(true);
    const result = await protectUi.historyQuery({ windowDays, offset: Math.min(rows.length, 16384), limit: HISTORY_PAGE_SIZE, mechanismsOnly });
    if (mine !== seq.current) return;
    setLoading(false);
    const h = result.ok ? parseHistoryProjection(result.response) : null;
    if (h === null) {
      setError(errorMessageKey(result.ok ? 'unavailable' : result.code));
      return;
    }
    setProjection(h);
    setRows((shown) => appendHistoryRows(shown, h.rows));
    setStatus(tm(msg('history_row_sites', h.totalRows)));
  };

  const onDeleted = (target: 'row' | 'site'): void => {
    setStatus(t('history_deleted'));
    if (target === 'row') {
      setOpen(null);
      listTitle.current?.focus();
    } else focusAfterReload.current = true;
    setReload((n) => n + 1);
  };

  const coverage = projection === null ? [] : historyCoverageLines(projection, scopeMode, locale);
  const summary = siteProjection?.site;
  return (
    <section class="section history" aria-labelledby="history-title" aria-busy={loading} data-history-panel="on">
      <h2 id="history-title" class="section__title">{t('history_title')}</h2>
      <p>{t('history_intro')}</p>
      <p class="sr-only" aria-live="polite" aria-atomic="true">{status}</p>
      {coverage.length > 0 ? (
        <div class="state history-coverage" data-history-coverage="true">
          {coverage.map((line) => (
            <p key={line.id} class={'state__line' + (line.tone === 'attention' ? ' history-coverage__attention' : '')} data-history-coverage-line={line.id}>
              {tm(line.message)}
            </p>
          ))}
          <p class="state__line small muted">{t('history_domain_only')}</p>
        </div>
      ) : null}
      {error !== null ? <p class="state state--attention" role="status">{t(error)}</p> : null}

      {siteName !== null ? (
        <section class="history-site-summary" aria-labelledby="history-site-title" data-history-this-site={siteName}>
          <h3 id="history-site-title" class="history__subtitle">
            {t('history_this_site_title')} <span class="mono small" dir="ltr">{siteName}</span>
          </h3>
          {summary === undefined || summary.receivers.length === 0 ? (
            <p class="small muted">{t('history_this_site_empty')}</p>
          ) : (
            <ul class="history-card__list small">
              {summary.receivers.slice(0, 20).map((r) => (
                <li key={r.rowKey}>{tm(msg('history_this_site_row', rowDomain({ rowKey: r.rowKey, domains: [] }), r.sites))}</li>
              ))}
            </ul>
          )}
          {summary !== undefined && summary.unattributedFamilies.length > 0 ? (
            <p class="small muted">{tm(msg('history_this_site_unattributed', familiesMessage(summary.unattributedFamilies)))}</p>
          ) : null}
        </section>
      ) : null}

      <div class="history-controls">
        <div class="history-window" role="radiogroup" aria-labelledby="history-window-label" data-history-window="true">
          <span id="history-window-label" class="history-window__label">{t('history_window_label')}</span>
          {historyWindowChoices().map((days) => (
            <label key={days} class="history-window__option">
              <input type="radio" name="history-window" value={String(days)} checked={windowDays === days} onChange={() => setWindowDays(days)} />
              {' '}{tm(msg('history_window_days', days))}
            </label>
          ))}
        </div>
        <label class="history-filter">
          <input type="checkbox" checked={mechanismsOnly} data-history-mechanisms-only="true" onChange={(event) => setMechanismsOnly(event.currentTarget.checked)} />
          {' '}{t('history_filter_mechanisms')}
        </label>
      </div>

      <h3 id={LIST_TITLE_ID} ref={listTitle} class="history__subtitle" tabIndex={-1}>{t('history_list_label')}</h3>
      {projection !== null && rows.length === 0 && !loading ? <p class="empty" data-history-empty="true">{t('history_empty')}</p> : null}
      {projection === null && loading ? <p class="small muted">{t('history_loading')}</p> : null}
      <ul class="history-list" aria-labelledby={LIST_TITLE_ID}>
        {rows.map((row) => {
          const vm = historyRowView(row, locale);
          const cardId = 'history-card-' + row.rowKey.replace(/[^a-z0-9-]/gi, '-');
          const expanded = open === row.rowKey;
          return (
            <li key={row.rowKey} class="history-row" data-history-row={row.rowKey} data-history-sites={String(row.sites)}>
              <div class="history-row__head">
                <span class="history-row__domain mono" dir="ltr">{vm.domain}</span>
                <span class="pill">{tm(vm.sites)}</span>
                <span class="small muted">{tm(vm.lastSeen)}</span>
              </div>
              <ul class="history-mechanisms">
                {vm.mechanisms.map((m) => (
                  <li key={m.mechanism} class="history-mechanism" data-history-mechanism={m.mechanism}>
                    <span>{tm(m.text)}</span>
                    <span class="history-mechanism__meta">
                      <span class="pill pill--muted">{t(m.confidenceKey)}</span>
                      <IntegrityBadge integrity={m.integrity} evidenceSource={m.evidenceSource} />
                    </span>
                  </li>
                ))}
              </ul>
              <p class="actions">
                <button
                  type="button"
                  class="button button--text"
                  aria-expanded={expanded}
                  aria-controls={cardId}
                  data-history-details={row.rowKey}
                  onClick={() => setOpen(expanded ? null : row.rowKey)}
                >
                  {tm(msg('history_details', vm.domain))}
                </button>
              </p>
              {expanded ? <HistoryReceiverCard id={cardId} rowKey={row.rowKey} windowDays={windowDays} onDeleted={onDeleted} /> : null}
            </li>
          );
        })}
      </ul>
      {projection !== null && rows.length < projection.totalRows ? (
        <p class="actions">
          <button type="button" class="button" aria-busy={loading} data-history-more="true" onClick={() => void showMore()}>
            {t('history_show_more')}
          </button>
        </p>
      ) : null}
      {projection !== null && projection.singleSiteReceivers > 0 ? (
        <p class="small muted" data-history-single-site={String(projection.singleSiteReceivers)}>{tm(msg('history_single_site', projection.singleSiteReceivers))}</p>
      ) : null}
      <details class="card__details history-gaps">
        <summary>{t('history_gaps_title')}</summary>
        <p class="small">{t('history_gaps')}</p>
      </details>
    </section>
  );
}
