// «Источники» tab, hosts part (S08, E10-01, ADR-018, CLM-06): destinations of this document's requests as Chrome
// registered them, grouped into other sites/addresses and the same site. Coverage note first (what is not
// observed), the owner/purpose disclaimer last. Rows name a domain or a localized category only.

import { t } from '../i18n';
import { filterSourceRows, sourceLabel, sourcesEmptyKey, sourcesNoteKey, sourcesPausedKey } from '../view-models/sources';
import type { SourceRowVM, SourcesVM } from '../view-models/sources';

function SourceRow(props: { row: SourceRowVM }) {
  const row = props.row;
  return (
    <li class="source">
      <span class="source__name" dir="auto">
        {t('sources_registered', [sourceLabel(row, t), String(row.requests)])}
      </span>
      <span class="source__meta small muted">
        {t(row.relationKey)} · {t('integrity_browser_observed')}
      </span>
    </li>
  );
}

function SourceGroup(props: { id: string; title: string; rows: ReadonlyArray<SourceRowVM> }) {
  if (props.rows.length === 0) return null;
  const headingId = props.id + '-title';
  return (
    <section class="group sources__group" aria-labelledby={headingId}>
      <h3 id={headingId} class="group__title">
        {props.title} <span class="muted num">({props.rows.length})</span>
      </h3>
      <ul class="hosts">
        {props.rows.map((row, index) => (
          <SourceRow key={row.id + ':' + String(index)} row={row} />
        ))}
      </ul>
    </section>
  );
}

export interface SourcesSectionProps {
  id: string;
  vm: SourcesVM;
  query: string;
}

/** Number of host rows matching the query (for SearchFeedback). */
export function sourceRowCount(vm: SourcesVM, query: string): number {
  return filterSourceRows(vm.thirdParty, query, t).length + filterSourceRows(vm.sameSite, query, t).length;
}

export function SourcesSection(props: SourcesSectionProps) {
  const vm = props.vm;
  const headingId = props.id + '-title';
  const thirdParty = filterSourceRows(vm.thirdParty, props.query, t);
  const sameSite = filterSourceRows(vm.sameSite, props.query, t);
  // CW-02: in active-tab mode / without access the note says the network is not observed, and an empty list is
  // "no events received", never "Chrome registered no requests".
  const emptyKey = sourcesEmptyKey(vm);
  const pausedKey = sourcesPausedKey(vm);
  return (
    <section class="section sources" aria-labelledby={headingId}>
      <h2 id={headingId} class="section__title">
        {t('sources_hosts_title')}
      </h2>
      <p class="small muted" data-sources-note={vm.unobserved ?? (vm.limited ? 'limited' : 'scope')}>{t(sourcesNoteKey(vm))}</p>
      {pausedKey !== null ? <p class="small muted" data-sources-paused="true">{t(pausedKey)}</p> : null}
      {emptyKey !== null ? (
        <p class="muted" data-sources-empty={emptyKey}>{t(emptyKey)}</p>
      ) : thirdParty.length + sameSite.length === 0 ? (
        <p class="muted">{t('search_empty')}</p>
      ) : (
        <>
          <SourceGroup id={props.id + '-third-party'} title={t('sources_group_third_party')} rows={thirdParty} />
          <SourceGroup id={props.id + '-same-site'} title={t('sources_group_same_site')} rows={sameSite} />
        </>
      )}
      {vm.dropped > 0 ? <p class="small muted">{t('sources_dropped', [String(vm.dropped)])}</p> : null}
      <p class="small muted">{t('sources_not_owner')}</p>
    </section>
  );
}
