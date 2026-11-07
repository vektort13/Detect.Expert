// «Источники» tab view model (S08, E10-01, ADR-018). Pure: browser-observed destination hosts of one document,
// grouped by relation to the request initiator. A row names a PSL registrable domain or a localized category
// (never an address, port, path or label) plus the relation and the request count Chrome registered. A destination
// host says nothing about the resource owner or the processing purpose and is never linked to API calls (CLM-06).

import type { HostCategory, HostEntry, ReportProjection, SiteRelation } from '@detect-expert/contracts';
import { hostsOf, hostsPresent, isThirdPartyRelation, networkLimited } from './counts';
import { normalizeQuery } from './cards';
import type { Translate } from './message';

export interface SourceRowVM {
  /** Stable render key: domain or category plus relation. */
  id: string;
  /** PSL registrable domain (identifier text, not localized); null for a category row. */
  name: string | null;
  /** `host_category_<code>` for a row without a domain; null for a domain row. */
  categoryKey: string | null;
  relation: SiteRelation;
  /** `relation_<code>`. */
  relationKey: string;
  /** Requests Chrome registered for this destination (saturating count from the SW). */
  requests: number;
  /** Lowercase non-localized search text: the domain or the category code. */
  searchText: string;
}

/**
 * CW-02: why this document's own requests are not observed, so an empty list must not read as "Chrome registered
 * none". 'active-tab': webRequest events are not delivered under the toolbar grant (ADR-018, FOLLOWUPS 26);
 * 'no-access': mode off or access revoked (the network of the document is not observed, earlier data was purged).
 */
export type SourcesUnobserved = 'active-tab' | 'no-access';

export interface SourcesVM {
  /** The projection carries a host list (false = no network events were received for this document). */
  known: boolean;
  /** network-limited: requests to hosts outside the granted scope were not observed. */
  limited: boolean;
  /** Not null: the network of this document is not observed (or only partly in active-tab); see SourcesUnobserved. */
  unobserved: SourcesUnobserved | null;
  /** CW-05: observation was paused (now or earlier): requests during the pause were not counted (lower bound). */
  pausedGap: boolean;
  /** Relation outside {same-origin, same-site}. */
  thirdParty: SourceRowVM[];
  sameSite: SourceRowVM[];
  /** Destinations not kept because of BUDGETS.maxHostsPerDocument (report.dropped.hosts). */
  dropped: number;
}

/** `host_category_<code>`: '-' becomes '_', 'ULA' becomes 'ula'. */
export function hostCategoryKey(category: HostCategory): string {
  return 'host_category_' + category.toLowerCase().replace(/-/g, '_');
}

/** `relation_<code>` with '-' replaced by '_'. */
export function relationKey(relation: SiteRelation): string {
  return 'relation_' + relation.replace(/-/g, '_');
}

function rowOf(entry: HostEntry): SourceRowVM {
  const name = entry.registrableDomain ?? null;
  const category = entry.category ?? null;
  const label = name ?? (category === null ? 'unknown' : category);
  return {
    id: (name === null ? 'c:' : 'd:') + label + '|' + entry.relation,
    name,
    categoryKey: name === null && category !== null ? hostCategoryKey(category) : null,
    relation: entry.relation,
    relationKey: relationKey(entry.relation),
    requests: entry.requestCount,
    searchText: label.toLowerCase(),
  };
}

/** CW-02: the scope mode and the revoked flag of the projection say when the document's network is not observed. */
export function networkUnobserved(report: ReportProjection): SourcesUnobserved | null {
  if (report.scopeMode === 'active-tab') return 'active-tab';
  if (report.scopeMode === 'off' || report.coverageFlags.includes('revoked')) return 'no-access';
  return null;
}

/** Rows keep the projection order (cross-site first, then request count, then name; engine projectHosts). */
export function sourcesView(report: ReportProjection | null): SourcesVM {
  if (report === null) return { known: false, limited: false, unobserved: null, pausedGap: false, thirdParty: [], sameSite: [], dropped: 0 };
  const thirdParty: SourceRowVM[] = [];
  const sameSite: SourceRowVM[] = [];
  for (const entry of hostsOf(report)) (isThirdPartyRelation(entry.relation) ? thirdParty : sameSite).push(rowOf(entry));
  return {
    known: hostsPresent(report), limited: networkLimited(report), unobserved: networkUnobserved(report),
    pausedGap: report.coverageFlags.includes('paused'), thirdParty, sameSite, dropped: report.dropped.hosts,
  };
}

/** CW-02: locale key of the coverage note above the list (what is not observed for this document). */
export function sourcesNoteKey(vm: SourcesVM): string {
  if (vm.unobserved === 'active-tab') return 'sources_active_tab_unobserved';
  if (vm.unobserved === 'no-access') return 'sources_no_access';
  return vm.limited ? 'sources_network_limited' : 'sources_network_scope';
}

/**
 * CW-02: locale key of the empty state, null when there are rows. `sources_empty` ("Chrome registered none in the
 * accessible scope") only when the document's network is observed; otherwise `sources_none` (no events received).
 */
export function sourcesEmptyKey(vm: SourcesVM): 'sources_none' | 'sources_empty' | null {
  if (!vm.known) return 'sources_none';
  if (vm.thirdParty.length + vm.sameSite.length > 0) return null;
  // CW-05: during or after a pause an empty list is not "Chrome registered none" either.
  return vm.unobserved === null && !vm.pausedGap ? 'sources_empty' : 'sources_none';
}

/** CW-05: extra note when a pause left requests uncounted (only where the document's network is observed). */
export function sourcesPausedKey(vm: SourcesVM): 'sources_paused_gap' | null {
  return vm.pausedGap && vm.unobserved === null ? 'sources_paused_gap' : null;
}

/** Text shown for the destination: the domain itself or the localized category. */
export function sourceLabel(row: SourceRowVM, translate: Translate): string {
  return row.name ?? translate(row.categoryKey ?? hostCategoryKey('unknown'));
}

/** Search over the shown (localized) name and the non-localized search text; case-insensitive. */
export function filterSourceRows(rows: ReadonlyArray<SourceRowVM>, query: string, translate: Translate): SourceRowVM[] {
  const q = normalizeQuery(query);
  if (q === '') return [...rows];
  return rows.filter((row) => sourceLabel(row, translate).toLowerCase().includes(q) || row.searchText.includes(q));
}
