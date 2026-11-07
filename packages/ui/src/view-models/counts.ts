// Three numeric groups of the main screen: Техники / Сервисы / Сторонние источники (spec V §7).

import { BUDGETS, isSanitizedHost } from '@detect-expert/contracts';
import type { HostEntry, ReportProjection, VendorSummary } from '@detect-expert/contracts';
import { TECHNIQUE_INFO } from './techniques';
import { CATALOG_AVAILABLE } from './capabilities';

export interface CountsVM {
  techniques: number;
  services: number | null;
  /** null when the projection carries no host list at all (v1 ReportProjection has none). */
  thirdParty: number | null;
}

function isHostEntryLike(value: unknown): value is HostEntry {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as { registrableDomain?: unknown; requestCount?: unknown };
  return isSanitizedHost(record.registrableDomain) && typeof record.requestCount === 'number' && Number.isFinite(record.requestCount);
}

/**
 * Forward-compatible read of a `hosts` list. ReportProjection v1 has no such field; DocumentReport does
 * (HostEntry[], browser-observed). When the projection owner adds it (same HostEntry shape), the
 * "third-party sources" count and the Sources tab light up without UI changes.
 */
export function hostsOf(report: ReportProjection): HostEntry[] {
  const candidate = (report as { hosts?: unknown }).hosts;
  if (!Array.isArray(candidate)) return [];
  return candidate.filter(isHostEntryLike).slice(0, BUDGETS.maxHostsPerDocument);
}

export function hostsPresent(report: ReportProjection): boolean {
  return Array.isArray((report as { hosts?: unknown }).hosts);
}

export function thirdPartyHosts(report: ReportProjection): HostEntry[] {
  return hostsOf(report).filter((entry) => (entry.registrableDomain ?? entry.category ?? 'unknown') !== report.host);
}

/** Vendors with any match; `none` entries are catalog noise and never counted. */
export function activeVendors(report: ReportProjection): VendorSummary[] {
  return report.vendors.filter((vendor) => vendor.vendorConfidence !== 'none');
}

export function countsView(report: ReportProjection | null, catalogAvailable: boolean = CATALOG_AVAILABLE): CountsVM {
  if (report === null) return { techniques: 0, services: null, thirdParty: null };
  const techniques = new Set(report.techniques.map((entry) => entry.techniqueId)).size;
  const services = catalogAvailable ? activeVendors(report).length : null;
  const thirdParty = hostsPresent(report) ? thirdPartyHosts(report).length : null;
  return { techniques, services, thirdParty };
}

/** Badge number: categories with findings, never a "danger" score (spec V §7). */
export function categoriesWithFindings(report: ReportProjection | null): number {
  if (report === null) return 0;
  const categories = new Set<string>();
  for (const finding of report.findings) {
    if (finding.interpretation === 'api-use') continue;
    categories.add(TECHNIQUE_INFO[finding.techniqueId].category);
  }
  return categories.size;
}
