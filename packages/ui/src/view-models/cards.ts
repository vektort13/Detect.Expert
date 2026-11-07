// Card view models: three separate levels per technique (observation / interpretation / purpose in general,
// spec V §7, AUD-02) and vendor cards for «Распознанные сервисы защиты и идентификации» (REQ-007). Pure.

import { MAX_COUNT } from '@detect-expert/contracts';
import type {
  AttributionConfidence,
  CountQuality,
  EvidenceSource,
  Finding,
  Integrity,
  Interpretation,
  InterpretationConfidence,
  Phase,
  ReportProjection,
  TechniqueId,
  TechniqueSummary,
  VendorMatch,
  VendorSummary,
} from '@detect-expert/contracts';
import { msg } from './message';
import type { Message } from './message';
import { TECHNIQUE_INFO } from './techniques';
import type { TechniqueCategory, TechniqueFamily } from './techniques';

export type CardKind = 'api-use' | 'possible-fingerprinting' | 'unknown';

export interface CardVM {
  id: string;
  kind: CardKind;
  /** Text label of the kind (never colour-only). */
  label: Message;
  techniqueId: TechniqueId;
  category: TechniqueCategory;
  api: string;
  observation: Message;
  attemptOnly: boolean;
  completionUnobserved: boolean;
  interpretation: Message;
  interpretationNote: Message | null;
  confidence: Message;
  purpose: Message;
  evidenceSource: EvidenceSource;
  integrity: Integrity;
  attribution: AttributionConfidence;
  count: number;
  countQuality: CountQuality;
  countLabel: Message | string;
  phases: Phase[];
  ruleId: string | null;
  ruleVersion: string | null;
  findingId: string | null;
  evidenceIds: string[];
  limitationCodes: string[];
  counterEvidenceCodes: string[];
  vendorMatchIds: string[];
  rank: number;
  searchText: string;
}

export interface VendorCardVM {
  vendorId: string;
  name: string;
  match: VendorMatch;
  matchLabel: Message;
  found: Message;
  purpose: Message;
  ruleIds: string[];
  evidenceSource: EvidenceSource;
  integrity: Integrity;
  searchText: string;
}

const KIND_BY_INTERPRETATION: Readonly<Record<Interpretation, CardKind>> = {
  'api-use': 'api-use',
  'possible-fingerprinting': 'possible-fingerprinting',
  'fingerprinting-pattern': 'possible-fingerprinting',
  'local-probe-pattern': 'possible-fingerprinting',
  'dns-test-pattern': 'possible-fingerprinting',
  unknown: 'unknown',
};

const KIND_LABEL_KEY: Readonly<Record<CardKind, string>> = {
  'api-use': 'card_api_use_label',
  'possible-fingerprinting': 'card_fp_label',
  unknown: 'card_fp_insufficient',
};

const INTERPRETATION_WEIGHT: Readonly<Record<Interpretation, number>> = {
  'fingerprinting-pattern': 5,
  'possible-fingerprinting': 4,
  'local-probe-pattern': 4,
  'dns-test-pattern': 4,
  unknown: 1,
  'api-use': 0,
};

const CONFIDENCE_WEIGHT: Readonly<Record<InterpretationConfidence, number>> = {
  high: 3,
  medium: 2,
  low: 1,
  unassessed: 0,
};

const FP_INTERPRETATION_KEY: Readonly<Record<TechniqueFamily, string>> = {
  canvas: 'card_fp_canvas_sequence',
  math: 'card_fp_math_sequence',
  webrtc: 'card_fp_generic',
  'local-probe': 'card_fp_local_probe',
  dns: 'card_fp_dns_pattern',
  generic: 'card_fp_generic',
};

export function countLabel(count: number, quality: CountQuality): Message | string {
  const n = count >= MAX_COUNT ? MAX_COUNT : count;
  if (count >= MAX_COUNT || quality === 'lower-bound') return msg('count_value_lower_bound', n);
  if (quality === 'sampled') return msg('count_value_sampled', n);
  return String(n);
}

export function confidenceKey(confidence: InterpretationConfidence): string {
  return 'confidence_' + confidence;
}

function observationMessage(techniqueId: TechniqueId, api: string, count: Message | string): Message {
  const family = TECHNIQUE_INFO[techniqueId].family;
  switch (techniqueId) {
    case 'DET-001':
      return msg('card_api_use_canvas_export', api, count);
    case 'DET-002':
      return msg('card_api_use_canvas_readback', api, count);
    case 'DET-003':
      // DET-003 / F142 aggregates measurement and drawing; only assert API calls.
      return msg('card_api_use_generic', api, count);
    case 'DET-004':
      return msg('card_api_use_offscreen', count);
    default:
      break;
  }
  switch (family) {
    case 'math':
      return msg('card_api_use_math', count);
    case 'webrtc':
      return msg('card_api_use_webrtc', api, count);
    case 'local-probe':
      return msg('card_api_use_local_probe', count);
    case 'dns':
      return msg('card_api_use_dns', count);
    default:
      return msg('card_api_use_generic', api, count);
  }
}

function interpretationMessage(kind: CardKind, interpretation: Interpretation, family: TechniqueFamily): Message {
  if (kind === 'api-use') return msg('card_api_use_generic_note');
  if (kind === 'unknown') return msg('card_fp_insufficient');
  if (interpretation === 'local-probe-pattern') return msg('card_fp_local_probe');
  if (interpretation === 'dns-test-pattern') return msg('card_fp_dns_pattern');
  // F061: the possible tier can be produced by a single canvas readout.
  if (family === 'canvas' && interpretation !== 'fingerprinting-pattern') return msg('card_fp_insufficient');
  return msg(FP_INTERPRETATION_KEY[family]);
}

function purposeMessage(family: TechniqueFamily): Message {
  switch (family) {
    case 'webrtc':
      return msg('card_fp_webrtc');
    case 'local-probe':
      return msg('card_purpose_local_probe');
    case 'dns':
      return msg('card_purpose_dns');
    default:
      return msg('card_api_use_purpose');
  }
}

function isAttemptOnly(phases: ReadonlyArray<Phase>): boolean {
  return phases.length > 0 && phases.every((phase) => phase === 'threw-sync');
}

function rankOf(interpretation: Interpretation, confidence: InterpretationConfidence, count: number): number {
  return INTERPRETATION_WEIGHT[interpretation] * 100 + CONFIDENCE_WEIGHT[confidence] * 10 + Math.min(count, 9);
}

interface CardSource {
  id: string;
  techniqueId: TechniqueId;
  interpretation: Interpretation;
  confidence: InterpretationConfidence;
  summary: TechniqueSummary | undefined;
  finding: Finding | null;
}

function makeCard(source: CardSource): CardVM {
  const techniqueInfo = TECHNIQUE_INFO[source.techniqueId];
  const kind = KIND_BY_INTERPRETATION[source.interpretation];
  const summary = source.summary;
  const count = summary?.count ?? 0;
  const countQuality: CountQuality = summary?.countQuality ?? 'lower-bound';
  const phases = summary === undefined ? [] : [...summary.phases];
  const label = countLabel(count, countQuality);
  const finding = source.finding;
  const evidenceSource: EvidenceSource = summary?.evidenceSource ?? 'derived';
  const integrity: Integrity = summary?.integrity ?? 'derived';
  const searchParts = [
    source.techniqueId,
    techniqueInfo.api,
    techniqueInfo.category,
    source.interpretation,
    finding?.ruleId ?? '',
    finding?.findingId ?? '',
    ...(finding?.vendorMatchIds ?? []),
  ];
  return {
    id: source.id,
    kind,
    label: msg(KIND_LABEL_KEY[kind]),
    techniqueId: source.techniqueId,
    category: techniqueInfo.category,
    api: techniqueInfo.api,
    observation: observationMessage(source.techniqueId, techniqueInfo.api, label),
    attemptOnly: isAttemptOnly(phases),
    completionUnobserved: phases.some((phase) => phase === 'attempted' || phase === 'settlement-unobserved' || phase === 'async-returned'),
    interpretation: interpretationMessage(kind, source.interpretation, techniqueInfo.family),
    interpretationNote: kind === 'possible-fingerprinting' ? msg('card_fp_not_proven') : null,
    confidence: msg(confidenceKey(source.confidence)),
    purpose: purposeMessage(techniqueInfo.family),
    evidenceSource,
    integrity,
    attribution: summary?.attributionConfidence ?? 'unknown',
    count,
    countQuality,
    countLabel: label,
    phases,
    ruleId: finding?.ruleId ?? null,
    ruleVersion: finding?.ruleVersion ?? null,
    findingId: finding?.findingId ?? null,
    evidenceIds: finding === null ? [] : [...finding.evidenceIds],
    limitationCodes: finding === null ? [] : [...finding.limitationCodes],
    counterEvidenceCodes: finding === null ? [] : [...finding.counterEvidenceCodes],
    vendorMatchIds: finding === null ? [] : [...finding.vendorMatchIds],
    rank: rankOf(source.interpretation, source.confidence, count),
    searchText: searchParts.join(' ').toLowerCase(),
  };
}

/** One card per finding, plus one api-use card per observed technique that no finding explains. Sorted by rank. */
export function buildCards(report: ReportProjection): CardVM[] {
  const summaries = new Map<TechniqueId, TechniqueSummary>();
  for (const summary of report.techniques) {
    const existing = summaries.get(summary.techniqueId);
    if (existing === undefined || existing.count < summary.count) summaries.set(summary.techniqueId, summary);
  }
  const explained = new Set<TechniqueId>();
  const cards: CardVM[] = [];
  for (const finding of report.findings) {
    explained.add(finding.techniqueId);
    cards.push(
      makeCard({
        id: 'f:' + finding.findingId,
        techniqueId: finding.techniqueId,
        interpretation: finding.interpretation,
        confidence: finding.interpretationConfidence,
        summary: summaries.get(finding.techniqueId),
        finding,
      }),
    );
  }
  for (const summary of summaries.values()) {
    if (explained.has(summary.techniqueId)) continue;
    cards.push(
      makeCard({
        id: 't:' + summary.techniqueId,
        techniqueId: summary.techniqueId,
        interpretation: summary.interpretation,
        confidence: summary.interpretationConfidence,
        summary,
        finding: null,
      }),
    );
  }
  cards.sort((a, b) => b.rank - a.rank || (a.techniqueId < b.techniqueId ? -1 : a.techniqueId > b.techniqueId ? 1 : 0) || (a.id < b.id ? -1 : 1));
  return cards;
}

export function selectTopCards(cards: ReadonlyArray<CardVM>, limit = 5): CardVM[] {
  return cards.slice(0, Math.max(0, limit));
}

export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

export function filterCards(cards: ReadonlyArray<CardVM>, query: string): CardVM[] {
  const q = normalizeQuery(query);
  if (q === '') return [...cards];
  return cards.filter((card) => card.searchText.includes(q));
}

export function filterVendorCards(cards: ReadonlyArray<VendorCardVM>, query: string): VendorCardVM[] {
  const q = normalizeQuery(query);
  if (q === '') return [...cards];
  return cards.filter((card) => card.searchText.includes(q));
}

/** Display names only for vendors whose wording the spec fixes (V §7); other ids are shown verbatim. */
const VENDOR_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  threatmetrix: 'LexisNexis ThreatMetrix',
};

const VENDOR_PURPOSE_KEYS: Readonly<Record<string, string>> = {
  threatmetrix: 'card_vendor_threatmetrix_purpose',
};

export function vendorMatchKey(match: VendorMatch): string {
  return 'card_vendor_match_' + match.replace(/-/g, '_');
}

export function buildVendorCards(report: ReportProjection): VendorCardVM[] {
  const out: VendorCardVM[] = [];
  for (const vendor of report.vendors as ReadonlyArray<VendorSummary>) {
    if (vendor.vendorConfidence === 'none') continue;
    const key = vendor.vendorId.toLowerCase();
    const name = VENDOR_DISPLAY_NAMES[key] ?? vendor.vendorId;
    out.push({
      vendorId: vendor.vendorId,
      name,
      match: vendor.vendorConfidence,
      matchLabel: msg(vendorMatchKey(vendor.vendorConfidence)),
      found: msg('card_vendor_found', name),
      purpose: msg('card_vendor_purpose', msg(VENDOR_PURPOSE_KEYS[key] ?? 'card_vendor_purpose_generic')),
      ruleIds: [...vendor.ruleIds],
      evidenceSource: vendor.evidenceSource,
      integrity: vendor.integrity,
      searchText: [vendor.vendorId, name, ...vendor.ruleIds, vendor.vendorConfidence].join(' ').toLowerCase(),
    });
  }
  return out;
}
