// Vendor aggregation for «Распознанные сервисы защиты и идентификации» (S10, ADR-009 v1.1). Pure: no chrome.*, no
// clock (nowMs is an argument), no network, no catalog import — callers pass a structural view of the compiled
// catalog. Recognition is never trust or a site verdict (REQ-007); candidates never reach this view (REQ-008).
//
// Levels (VendorMatch), per vendor over its valid matched rules:
// - documented-resource: a browser-observed network signal of a rule with strength documented-resource;
// - multi-signal: at least two distinct rules and at least one browser-observed signal (two page-controlled signals
//   alone never make multi-signal);
// - weak-signal: anything else.
// Provenance: a browser-observed network signal -> browser-network / browser-observed; multi-signal -> derived /
// derived; page-only weak signals keep their page-controlled provenance.

import { BUDGETS, WIRE_RULE_ID_PATTERN } from '@detect-expert/contracts';
import type { EvidenceSource, HostEntry, Integrity, VendorMatch, VendorSummary } from '@detect-expert/contracts';

/** Structural subset of a compiled catalog rule (CompiledRule of @detect-expert/catalog fits it). */
export interface VendorRuleView {
  readonly ruleId: string;
  readonly vendorId: string;
  readonly strength: 'documented-resource' | 'weak-signal';
  readonly evidenceOrigin: string;
  /** Exclusive end of validity; the rule is ignored at or after it. */
  readonly expiresAtMs: number;
}

/** Structural subset of a compiled catalog index (CatalogIndex of @detect-expert/catalog fits it). */
export interface VendorCatalogView {
  readonly catalogVersion: string;
  readonly rulesById: ReadonlyMap<string, VendorRuleView>;
}

/** One matched rule with the provenance of the observation that matched it. */
export interface VendorSignal {
  readonly ruleId: string;
  readonly evidenceSource: EvidenceSource;
  readonly integrity: Integrity;
}

export const MAX_RULE_IDS_PER_VENDOR = 32;
export const MAX_VENDORS = BUDGETS.maxHostsPerDocument;

const VENDOR_ID = /^[A-Za-z0-9_-]{1,64}$/;
const RANK: Readonly<Record<VendorMatch, number>> = { 'documented-resource': 0, 'multi-signal': 1, 'weak-signal': 2, none: 3 };

/** A rule usable at nowMs: present in the view, well-formed ids, not expired. */
export function activeRule(view: VendorCatalogView, ruleId: unknown, nowMs: number): VendorRuleView | null {
  if (typeof ruleId !== 'string' || !WIRE_RULE_ID_PATTERN.test(ruleId)) return null;
  const rule = view.rulesById.get(ruleId);
  if (rule === undefined || rule.ruleId !== ruleId || !VENDOR_ID.test(rule.vendorId)) return null;
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs) || !(nowMs < rule.expiresAtMs)) return null;
  return rule;
}

function browserObserved(s: VendorSignal): boolean {
  return s.integrity === 'browser-observed' && s.evidenceSource === 'browser-network';
}

interface VendorAccumulator {
  rules: Map<string, VendorRuleView>;
  observed: Set<string>;
  pageSources: EvidenceSource[];
}

/** Aggregates matched rule signals into bounded, sorted vendor summaries. */
export function deriveVendorsFromSignals(signals: readonly VendorSignal[], view: VendorCatalogView, nowMs: number): VendorSummary[] {
  const byVendor = new Map<string, VendorAccumulator>();
  for (const s of signals) {
    const rule = activeRule(view, s.ruleId, nowMs);
    if (rule === null) continue;
    let acc = byVendor.get(rule.vendorId);
    if (acc === undefined) {
      acc = { rules: new Map(), observed: new Set(), pageSources: [] };
      byVendor.set(rule.vendorId, acc);
    }
    acc.rules.set(rule.ruleId, rule);
    if (browserObserved(s)) acc.observed.add(rule.ruleId);
    else if (s.integrity === 'page-controlled') acc.pageSources.push(s.evidenceSource);
  }
  const out: VendorSummary[] = [];
  for (const [vendorId, acc] of byVendor) {
    const documented = [...acc.observed].some((id) => {
      const rule = acc.rules.get(id);
      return rule !== undefined && rule.evidenceOrigin === 'network_request' && rule.strength === 'documented-resource';
    });
    const hasObserved = acc.observed.size > 0;
    const vendorConfidence: VendorMatch = documented ? 'documented-resource' : acc.rules.size >= 2 && hasObserved ? 'multi-signal' : 'weak-signal';
    let evidenceSource: EvidenceSource;
    let integrity: Integrity;
    if (vendorConfidence === 'multi-signal') {
      evidenceSource = 'derived';
      integrity = 'derived';
    } else if (hasObserved) {
      evidenceSource = 'browser-network';
      integrity = 'browser-observed';
    } else {
      evidenceSource = [...acc.pageSources].sort()[0] ?? 'page-dom';
      integrity = 'page-controlled';
    }
    out.push({ vendorId, vendorConfidence, ruleIds: [...acc.rules.keys()].sort().slice(0, MAX_RULE_IDS_PER_VENDOR), evidenceSource, integrity });
  }
  out.sort((a, b) => RANK[a.vendorConfidence] - RANK[b.vendorConfidence] || (a.vendorId < b.vendorId ? -1 : a.vendorId > b.vendorId ? 1 : 0));
  return out.slice(0, MAX_VENDORS);
}

/** Browser-observed host entries -> vendors: every rule id on a host is a browser-network / browser-observed signal. */
export function deriveVendors(hosts: readonly HostEntry[], view: VendorCatalogView, nowMs: number): VendorSummary[] {
  const signals: VendorSignal[] = [];
  for (const h of hosts) {
    if (h.evidenceSource !== 'browser-network' || h.integrity !== 'browser-observed' || !Array.isArray(h.ruleIds)) continue;
    for (const ruleId of h.ruleIds.slice(0, MAX_RULE_IDS_PER_VENDOR)) signals.push({ ruleId, evidenceSource: 'browser-network', integrity: 'browser-observed' });
  }
  return deriveVendorsFromSignals(signals, view, nowMs);
}

/** A view with at least one rule: recognition is attempted only then (otherwise catalogVersion is null). */
export function catalogViewActive(view: VendorCatalogView | null | undefined): view is VendorCatalogView {
  return view !== null && view !== undefined && view.rulesById.size > 0;
}
