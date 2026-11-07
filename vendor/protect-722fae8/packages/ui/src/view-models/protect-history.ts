// ADR-020 §G (S12): view model of the history «Кто вас узнаёт» (side panel tab, Options settings, export dialog). Pure:
// defensive readers of the SW answers (lane answers are not shape-checked by messaging.ts), message descriptors and
// the export download. Wording: mechanisms are possibilities with a confidence, never a verdict; "requests only"
// says explicitly that requests do not show linking.

import {
  HISTORY_EXPORT_SITE_REF_PATTERN,
  HISTORY_FAMILIES,
  HISTORY_ROW_KEY_PATTERN,
  HISTORY_STORAGE_STATES,
  HISTORY_WINDOW_DAYS,
  INTERPRETATIONS,
  INTERPRETATION_CONFIDENCES,
  LINK_MECHANISMS,
  PROTECT_BUDGETS,
  PROTECT_LIMITATIONS,
  isDomainName,
  isSiteName,
} from '@detect-expert/contracts';
import type {
  HistoryExport,
  HistoryFamily,
  HistoryFamilyLine,
  HistoryMechanismSummary,
  HistoryProjection,
  HistoryReceiverCard,
  HistoryRow,
  HistorySiteLine,
  HistoryWindowDays,
  LocalDay,
  ProtectLimitation,
  ProtectState,
  ScopeMode,
} from '@detect-expert/contracts';
import { historyExportFileName, serializeHistoryExport } from '../../../export/src/protect-history';
import { joinMessages, msg } from './message';
import type { Message, MessagePart } from './message';

export const HISTORY_PAGE_SIZE: number = PROTECT_BUDGETS.maxRowsPerPage;
export const HISTORY_DEFAULT_WINDOW: HistoryWindowDays = 30;
export const HISTORY_EXPORT_MIME = 'application/json';

const LOCAL_DAY_RE = /^2[0-9]{3}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])$/;
const FAMILY_SET: ReadonlySet<string> = new Set(HISTORY_FAMILIES);
const MECHANISM_SET: ReadonlySet<string> = new Set(LINK_MECHANISMS);
const CONFIDENCE_SET: ReadonlySet<string> = new Set(INTERPRETATION_CONFIDENCES);
const INTERPRETATION_SET: ReadonlySet<string> = new Set(INTERPRETATIONS);
const LIMITATION_SET: ReadonlySet<string> = new Set(PROTECT_LIMITATIONS);
const STORAGE_SET: ReadonlySet<string> = new Set(HISTORY_STORAGE_STATES);
const INTEGRITY_SET: ReadonlySet<string> = new Set(['browser-observed', 'page-controlled', 'derived']);
const SOURCE_SET: ReadonlySet<string> = new Set(['browser-network', 'browser-navigation', 'page-hook', 'page-dom', 'derived']);
const ATTRIBUTION_SET: ReadonlySet<string> = new Set(['exact-resource', 'sampled-stack', 'frame-only', 'unknown']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isLocalDay(value: unknown): value is LocalDay {
  return typeof value === 'string' && LOCAL_DAY_RE.test(value);
}

function isFamilyList(value: unknown): value is HistoryFamily[] {
  return Array.isArray(value) && value.length <= HISTORY_FAMILIES.length && value.every((f) => typeof f === 'string' && FAMILY_SET.has(f));
}

function isMechanism(value: unknown): value is HistoryMechanismSummary {
  if (!isRecord(value)) return false;
  if (typeof value['mechanism'] !== 'string' || !MECHANISM_SET.has(value['mechanism']) || !isCount(value['sites'])) return false;
  if (typeof value['evidenceSource'] !== 'string' || !SOURCE_SET.has(value['evidenceSource'])) return false;
  if (typeof value['integrity'] !== 'string' || !INTEGRITY_SET.has(value['integrity'])) return false;
  if (typeof value['attributionConfidence'] !== 'string' || !ATTRIBUTION_SET.has(value['attributionConfidence'])) return false;
  if (typeof value['interpretationConfidence'] !== 'string' || !CONFIDENCE_SET.has(value['interpretationConfidence'])) return false;
  if (value['families'] !== undefined && !isFamilyList(value['families'])) return false;
  if (value['interpretation'] !== undefined && (typeof value['interpretation'] !== 'string' || !INTERPRETATION_SET.has(value['interpretation']))) return false;
  return true;
}

function isMechanismList(value: unknown): value is HistoryMechanismSummary[] {
  return Array.isArray(value) && value.length <= LINK_MECHANISMS.length && value.every(isMechanism);
}

function isDomainList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= 32 && value.every(isDomainName);
}

function isRow(value: unknown): value is HistoryRow {
  return isRecord(value) && typeof value['rowKey'] === 'string' && HISTORY_ROW_KEY_PATTERN.test(value['rowKey']) && isDomainList(value['domains'])
    && isCount(value['sites']) && isCount(value['days']) && isLocalDay(value['lastSeen']) && isMechanismList(value['mechanisms']);
}

function isSiteLine(value: unknown): value is HistorySiteLine {
  return isRecord(value) && isSiteName(value['site']) && isCount(value['days']) && isLocalDay(value['first']) && isLocalDay(value['last']);
}

function isFamilyLine(value: unknown): value is HistoryFamilyLine {
  return isRecord(value) && typeof value['family'] === 'string' && FAMILY_SET.has(value['family']) && isCount(value['days']) && isCount(value['sites'])
    && typeof value['interpretation'] === 'string' && INTERPRETATION_SET.has(value['interpretation']);
}

function limitationsOf(value: unknown): ProtectLimitation[] | null {
  if (!Array.isArray(value) || value.length > 16) return null;
  return value.every((l) => typeof l === 'string' && LIMITATION_SET.has(l)) ? (value as ProtectLimitation[]) : null;
}

/** HistoryProjection of a `protect-history` answer, or null when the shape is wrong. */
export function parseHistoryProjection(raw: unknown): HistoryProjection | null {
  const h = isRecord(raw) ? raw['history'] : undefined;
  if (!isRecord(h)) return null;
  if (!isCount(h['historyRevision']) || !HISTORY_WINDOW_DAYS.includes(h['retentionDays'] as HistoryWindowDays) || !HISTORY_WINDOW_DAYS.includes(h['windowDays'] as HistoryWindowDays)) return null;
  if (typeof h['storage'] !== 'string' || !STORAGE_SET.has(h['storage']) || !isLocalDay(h['today']) || !(h['since'] === null || isLocalDay(h['since']))) return null;
  if (!Array.isArray(h['rows']) || h['rows'].length > HISTORY_PAGE_SIZE || !h['rows'].every(isRow)) return null;
  for (const k of ['totalRows', 'singleSiteReceivers', 'sitesInWindow', 'limitedSitesInWindow'] as const) if (!isCount(h[k])) return null;
  if (limitationsOf(h['limitations']) === null || !isRecord(h['dropped'])) return null;
  const site = h['site'];
  if (site !== undefined) {
    if (!isRecord(site) || !isSiteName(site['site']) || !isFamilyList(site['unattributedFamilies']) || !Array.isArray(site['receivers'])) return null;
    if (!site['receivers'].every((r) => isRecord(r) && typeof r['rowKey'] === 'string' && HISTORY_ROW_KEY_PATTERN.test(r['rowKey']) && isCount(r['sites']))) return null;
  }
  return h as unknown as HistoryProjection;
}

/** HistoryReceiverCard of a `protect-history-receiver` answer; null for «no such row» or a wrong shape. */
export function parseHistoryCard(raw: unknown): HistoryReceiverCard | null {
  const c = isRecord(raw) ? raw['card'] : undefined;
  if (!isRecord(c)) return null;
  if (typeof c['rowKey'] !== 'string' || !HISTORY_ROW_KEY_PATTERN.test(c['rowKey']) || !isDomainList(c['domains'])) return null;
  if (!Array.isArray(c['sites']) || c['sites'].length > PROTECT_BUDGETS.maxCardSites || !c['sites'].every(isSiteLine) || !isCount(c['moreSites'])) return null;
  if (!Array.isArray(c['families']) || !c['families'].every(isFamilyLine) || !isMechanismList(c['mechanisms'])) return null;
  return c as unknown as HistoryReceiverCard;
}

/** HistoryExport of a `protect-history-export` answer (checked enough to show and save it), or null. */
export function parseHistoryExport(raw: unknown): HistoryExport | null {
  const p = isRecord(raw) ? raw['preview'] : undefined;
  if (!isRecord(p) || p['schemaVersion'] !== 1 || p['kind'] !== 'detect-expert-history' || p['redacted'] !== true || typeof p['sitesIncluded'] !== 'boolean') return null;
  if (!isLocalDay(p['exportedOn']) || !Array.isArray(p['receivers']) || !Array.isArray(p['sites']) || typeof p['truncated'] !== 'boolean') return null;
  // Without site names every site reference must be a number reference (never a name).
  if (p['sitesIncluded'] === false) {
    const refs = [...(p['sites'] as unknown[]).map((s) => (isRecord(s) ? s['site'] : null)), ...(p['receivers'] as unknown[]).flatMap((r) => (isRecord(r) && Array.isArray(r['sites']) ? r['sites'].map((s: unknown) => (isRecord(s) ? s['site'] : null)) : [null]))];
    if (!refs.every((s) => typeof s === 'string' && HISTORY_EXPORT_SITE_REF_PATTERN.test(s))) return null;
  }
  return p as unknown as HistoryExport;
}

/** The history tab / settings have something to show: the module is on and the history feature is enabled. */
export function historyEnabled(state: ProtectState | null): boolean {
  return state !== null && state.features.includes('history') && state.state !== 'off';
}

export function familyNameKey(family: HistoryFamily): string {
  return family === 'network-patterns' ? 'history_family_network_patterns' : 'sensor_name_' + family;
}

export function familiesMessage(families: readonly HistoryFamily[]): MessagePart {
  return families.length === 0 ? '—' : joinMessages(families.map((f) => msg(familyNameKey(f))));
}

/** One mechanism line: what was seen and on how many sites (never "recognized you"). */
export function mechanismMessage(m: HistoryMechanismSummary): Message {
  switch (m.mechanism) {
    case 'value-match':
      return msg('history_mech_value_match', m.sites);
    case 'replay-pattern':
      return msg('history_mech_replay', m.sites);
    case 'frame-techniques':
      return msg('history_mech_frame', familiesMessage(m.families ?? []), m.sites);
    default:
      return msg('history_mech_requests');
  }
}

export function confidenceKey(m: HistoryMechanismSummary): string {
  return 'confidence_' + m.interpretationConfidence;
}

/** Display domain of a row (`d:` rows: the domain; vendor rows: the first domain). */
export function rowDomain(row: Pick<HistoryRow, 'rowKey' | 'domains'>): string {
  return row.rowKey.startsWith('d:') ? row.rowKey.slice(2) : (row.domains[0] ?? row.rowKey);
}

/** Day text in the UI locale; days are UTC days (no time of day exists). */
export function formatHistoryDay(day: LocalDay, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(day + 'T00:00:00Z'));
  } catch {
    return day;
  }
}

/** Coverage lines of the history (always next to the list, REQ-006). `scopeMode` comes from ui-get-scope. */
export function historyCoverageLines(h: HistoryProjection, scopeMode: ScopeMode | null, locale: string): Array<{ id: string; message: Message; tone: 'neutral' | 'attention' }> {
  const out: Array<{ id: string; message: Message; tone: 'neutral' | 'attention' }> = [];
  if (h.since !== null) out.push({ id: 'since', message: msg('history_since', formatHistoryDay(h.since, locale), h.retentionDays), tone: 'neutral' });
  if (scopeMode !== 'all-sites') out.push({ id: 'scope', message: msg('history_coverage_scope'), tone: 'attention' });
  if (h.limitedSitesInWindow > 0) out.push({ id: 'limited', message: msg('history_coverage_limited', h.limitedSitesInWindow), tone: 'attention' });
  if (h.limitations.includes('history-truncated')) out.push({ id: 'truncated', message: msg('history_coverage_truncated'), tone: 'attention' });
  if (h.storage === 'unavailable' || h.storage === 'degraded') out.push({ id: 'storage', message: msg('history_coverage_storage'), tone: 'attention' });
  if (h.storage === 'reset' || h.limitations.includes('storage-reset')) out.push({ id: 'reset', message: msg('history_coverage_reset'), tone: 'attention' });
  return out;
}

export interface HistoryRowView {
  rowKey: string;
  domain: string;
  sites: Message;
  lastSeen: Message;
  mechanisms: Array<{ mechanism: HistoryMechanismSummary['mechanism']; text: Message; confidenceKey: string; integrity: HistoryMechanismSummary['integrity']; evidenceSource: HistoryMechanismSummary['evidenceSource'] }>;
  domainOnly: boolean;
}

export function historyRowView(row: HistoryRow, locale: string): HistoryRowView {
  return {
    rowKey: row.rowKey,
    domain: rowDomain(row),
    sites: msg('history_row_sites', row.sites),
    lastSeen: msg('history_row_last_seen', formatHistoryDay(row.lastSeen, locale)),
    mechanisms: row.mechanisms.map((m) => ({ mechanism: m.mechanism, text: mechanismMessage(m), confidenceKey: confidenceKey(m), integrity: m.integrity, evidenceSource: m.evidenceSource })),
    domainOnly: row.vendorId === undefined,
  };
}

/** Rows of a page appended to the shown ones (no duplicate row keys; a newer page replaces a stale duplicate). */
export function appendHistoryRows(shown: readonly HistoryRow[], page: readonly HistoryRow[]): HistoryRow[] {
  const keys = new Set(page.map((r) => r.rowKey));
  return [...shown.filter((r) => !keys.has(r.rowKey)), ...page];
}

export interface HistoryExportDownload {
  fileName: string;
  mime: typeof HISTORY_EXPORT_MIME;
  text: string;
}

/** The file is byte-for-byte the serialization of the preview the user saw (REQ-013). */
export function historyExportDownload(preview: HistoryExport): HistoryExportDownload {
  return { fileName: historyExportFileName(preview), mime: HISTORY_EXPORT_MIME, text: serializeHistoryExport(preview) };
}

/** Window choices; windows longer than the retention show the same days (the SW caps the window). */
export function historyWindowChoices(): readonly HistoryWindowDays[] {
  return HISTORY_WINDOW_DAYS;
}
