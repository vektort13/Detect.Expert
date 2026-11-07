// Three numeric groups of the main screen: Техники / Сервисы / Сторонние источники (spec V §7).
// S08 / ADR-018: «Сторонние источники» = browser-observed hosts whose relation to the request initiator is neither
// same-origin nor same-site. In site / active-tab scope (network-limited) requests to other hosts are not visible, so
// the number is either unknown ("—") or only a lower bound; it is never shown as an exact zero there.

import { BUDGETS, HOST_CATEGORIES, SITE_RELATIONS, isSanitizedHost } from '@detect-expert/contracts';
import type { HostEntry, ReportProjection, SiteRelation, VendorSummary } from '@detect-expert/contracts';
import { badgeCategoryCount } from '@detect-expert/engine';
import { catalogAvailable } from './capabilities';

export type ThirdPartyQuality = 'exact' | 'lower-bound';
/** Why the third-party number is unknown: no host list at all, or the current permissions hide other hosts. */
export type ThirdPartyNote = 'limited' | 'unavailable';

export interface CountsVM {
  techniques: number;
  services: number | null;
  /** null when unknown: no host list, or network-limited without any visible third-party entry. */
  thirdParty: number | null;
  /** Meaningful only when thirdParty is a number: 'lower-bound' under network-limited or dropped hosts. */
  thirdPartyQuality: ThirdPartyQuality;
  /** Reason for a null thirdParty ('limited' | 'unavailable'); null when the number is shown. */
  thirdPartyNote: ThirdPartyNote | null;
}

const HOST_CATEGORY_SET: ReadonlySet<string> = new Set<string>(HOST_CATEGORIES);
const SITE_RELATION_SET: ReadonlySet<string> = new Set<string>(SITE_RELATIONS);
/** Relations that keep a destination on the document's own site (ADR-008 schemeful site). */
const SAME_SITE_RELATIONS: ReadonlySet<SiteRelation> = new Set<SiteRelation>(['same-origin', 'same-site']);

/**
 * Shape check of one projected host (FOLLOWUPS item 4): exactly one of registrableDomain (sanitized host) / category
 * (HOST_CATEGORIES), a known relation and a finite request count. Anything else is skipped, never repaired.
 */
export function isHostEntryLike(value: unknown): value is HostEntry {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as { registrableDomain?: unknown; category?: unknown; relation?: unknown; requestCount?: unknown };
  const hasDomain = record.registrableDomain !== undefined;
  const hasCategory = record.category !== undefined;
  if (hasDomain === hasCategory) return false;
  if (hasDomain && !isSanitizedHost(record.registrableDomain)) return false;
  if (hasCategory && (typeof record.category !== 'string' || !HOST_CATEGORY_SET.has(record.category))) return false;
  if (typeof record.relation !== 'string' || !SITE_RELATION_SET.has(record.relation)) return false;
  return typeof record.requestCount === 'number' && Number.isFinite(record.requestCount);
}

/** Valid host entries of the projection, bounded by BUDGETS.maxHostsPerDocument; [] when the field is missing. */
export function hostsOf(report: ReportProjection): HostEntry[] {
  const candidate = (report as { hosts?: unknown }).hosts;
  if (!Array.isArray(candidate)) return [];
  return candidate.filter(isHostEntryLike).slice(0, BUDGETS.maxHostsPerDocument);
}

/** The projection carries a host list (required since ADR-018; a legacy projection without it means "no data"). */
export function hostsPresent(report: ReportProjection): boolean {
  return Array.isArray((report as { hosts?: unknown }).hosts);
}

/** Third party = relation outside {same-origin, same-site}: cross-site, opaque and unknown destinations. */
export function isThirdPartyRelation(relation: SiteRelation): boolean {
  return !SAME_SITE_RELATIONS.has(relation);
}

export function thirdPartyHosts(report: ReportProjection): HostEntry[] {
  return hostsOf(report).filter((entry) => isThirdPartyRelation(entry.relation));
}

/** Requests to hosts outside the granted scope are invisible (ADR-018, coverage flag network-limited). */
export function networkLimited(report: ReportProjection): boolean {
  return report.coverageFlags.includes('network-limited');
}

/** Vendors with any match; `none` entries are catalog noise and never counted. */
export function activeVendors(report: ReportProjection): VendorSummary[] {
  return report.vendors.filter((vendor) => vendor.vendorConfidence !== 'none');
}

interface ThirdPartyCount {
  thirdParty: number | null;
  thirdPartyQuality: ThirdPartyQuality;
  thirdPartyNote: ThirdPartyNote | null;
}

function thirdPartyCount(report: ReportProjection): ThirdPartyCount {
  if (!hostsPresent(report)) return { thirdParty: null, thirdPartyQuality: 'exact', thirdPartyNote: 'unavailable' };
  const n = thirdPartyHosts(report).length;
  if (networkLimited(report)) {
    return n === 0
      ? { thirdParty: null, thirdPartyQuality: 'lower-bound', thirdPartyNote: 'limited' }
      : { thirdParty: n, thirdPartyQuality: 'lower-bound', thirdPartyNote: null };
  }
  if (report.dropped.hosts > 0) return { thirdParty: n, thirdPartyQuality: 'lower-bound', thirdPartyNote: null };
  return { thirdParty: n, thirdPartyQuality: 'exact', thirdPartyNote: null };
}

/**
 * S10: «Сервисы» is a number only when the SW evaluated the projection against an active catalog (catalogVersion not
 * null); otherwise it is unknown ("—"), never a false zero. `catalogOverride` exists for view-model tests only.
 */
export function countsView(report: ReportProjection | null, catalogOverride?: boolean): CountsVM {
  if (report === null) return { techniques: 0, services: null, thirdParty: null, thirdPartyQuality: 'exact', thirdPartyNote: 'unavailable' };
  const techniques = new Set(report.techniques.map((entry) => entry.techniqueId)).size;
  const services = (catalogOverride ?? catalogAvailable(report)) ? activeVendors(report).length : null;
  return { techniques, services, ...thirdPartyCount(report) };
}

/**
 * Badge number: categories with findings, never a "danger" score (spec V §7). S12 / E13-03: the same function as the
 * toolbar badge (engine badgeCategoryCount): only interpretive findings count, api-use / unknown and vendors never do.
 */
export function categoriesWithFindings(report: ReportProjection | null): number {
  if (report === null) return 0;
  return badgeCategoryCount(report.findings);
}
