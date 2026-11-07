// Card view models: three separate levels per technique (observation / interpretation / purpose in general,
// spec V §7, AUD-02) and vendor cards for «Распознанные сервисы защиты и идентификации» (REQ-007). Pure.

import { ruleDisplay, vendorDisplay } from '@detect-expert/catalog';
import type { CatalogIndex } from '@detect-expert/catalog';
import { MAX_COUNT, OPERATION_API_NAMES } from '@detect-expert/contracts';
import type {
  AttributionConfidence,
  CountQuality,
  EvidenceSource,
  Finding,
  Integrity,
  Interpretation,
  InterpretationConfidence,
  OperationCode,
  Phase,
  ReportProjection,
  SignalCode,
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
  /**
   * S04: ordinary explanation shown for the whole technique family next to `card_api_use_generic_note`
   * (`card_note_<family>`); null for families without a note.
   */
  familyNote: Message | null;
  confidence: Message;
  purpose: Message;
  evidenceSource: EvidenceSource;
  integrity: Integrity;
  attribution: AttributionConfidence;
  count: number;
  countQuality: CountQuality;
  countLabel: Message | string;
  phases: Phase[];
  /**
   * ADR-017: what the page asked for, from the built-in list (API names, or a localized phrase for `*-other` /
   * `*-unclassified`); unique, in registry order. Never a value. Empty when the summary has no operation codes.
   */
  operations: Array<string | Message>;
  /**
   * S13 (E13-02): raw axes of the card for the side-panel filters and details — the interpretation enum of the finding
   * (or the summary) and its confidence level. `kind` stays the three-way display class used by the kind filter.
   */
  interpretationKind: Interpretation;
  confidenceLevel: InterpretationConfidence;
  /** Signal codes of the technique summary, unique and sorted (as counterKey sorts them); [] without a summary. */
  signalCodes: SignalCode[];
  /**
   * Interval buckets of the technique (INTERVAL_BUCKET_MS each, from sensor boot; page-controlled). null without a
   * summary and for any evidence source other than page-hook: browser-network buckets are seconds from the report's
   * createdAt, a different, incomparable scale.
   */
  firstBucket: number | null;
  lastBucket: number | null;
  /** documentKey of the report the card belongs to (UI memory only; never shown verbatim). */
  documentKey: string;
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

/** S10: one matched catalog rule as shown in a vendor card (texts from the compiled catalog, never from the page). */
export interface VendorRuleVM {
  ruleId: string;
  /** null when the rule is unknown to this UI's catalog (the id is still shown). */
  ruleVersion: string | null;
  meaning: string | null;
  limitations: string | null;
}

export interface VendorCardVM {
  vendorId: string;
  name: string;
  match: VendorMatch;
  matchLabel: Message;
  found: Message;
  purpose: Message;
  ruleIds: string[];
  /** S10: rule lines and details, in projection order. */
  rules: VendorRuleVM[];
  /** S10: a browser-network match (the browser received the resource; execution was not observed). */
  requestOnly: boolean;
  /** S10: catalog version the SW matched against (projection catalogVersion). */
  catalogVersion: string | null;
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

/** Locale key of the text label of a card kind (chip text; also the S13 kind filter option). */
export function kindLabelKey(kind: CardKind): string {
  return KIND_LABEL_KEY[kind];
}

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
  webgl: 'card_fp_webgl_probe',
  audio: 'card_fp_audio_sequence',
  permissions: 'card_fp_permissions_breadth',
  // S06: environment and geometry have no specialized rule (generic api-use only); fallback wording.
  environment: 'card_fp_generic',
  geometry: 'card_fp_generic',
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

/**
 * S08 / ADR-018: browser-network summaries (DET-058…061) state what Chrome registered (request attempts), never what
 * the page did with them; their count is parameter $1.
 */
function networkObservationMessage(techniqueId: TechniqueId, count: Message | string): Message | null {
  switch (techniqueId) {
    case 'DET-058':
      return msg('card_network_socket', count);
    case 'DET-059':
      return msg('card_network_requests', count);
    case 'DET-060':
      return msg('card_network_local', count);
    case 'DET-061':
      return msg('card_network_dns', count);
    default:
      return null;
  }
}

function observationMessage(techniqueId: TechniqueId, api: string, count: Message | string, evidenceSource: EvidenceSource): Message {
  const family = TECHNIQUE_INFO[techniqueId].family;
  if (evidenceSource === 'browser-network') {
    const network = networkObservationMessage(techniqueId, count);
    if (network !== null) return network;
  }
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
    case 'DET-011':
      return msg('card_api_use_webgl_params', api, count);
    case 'DET-012':
      return msg('card_api_use_webgl_readback', count);
    // S05: Web Audio and Permissions name the operation family only, never values.
    case 'DET-015':
      return msg('card_api_use_audio_graph', count);
    case 'DET-016':
      return msg('card_api_use_audio_readout', count);
    case 'DET-039':
      return msg('card_api_use_permissions', count);
    // S06: environment and geometry say which kind of property was read, never a value.
    case 'DET-005':
      return msg('card_api_use_geometry', api, count);
    case 'DET-025':
      return msg('card_api_use_navigator', count);
    case 'DET-026':
      return msg('card_api_use_ua_hints', count);
    case 'DET-029':
      return msg('card_api_use_screen', count);
    case 'DET-032':
      return msg('card_api_use_hardware_concurrency', count);
    case 'DET-033':
      return msg('card_api_use_device_memory', count);
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

/**
 * Families with an ordinary-explanation note (`card_note_<family>`): webgl (S04), audio and permissions (S05),
 * environment and geometry (S06).
 */
const FAMILIES_WITH_NOTE: ReadonlySet<TechniqueFamily> = new Set<TechniqueFamily>(['webgl', 'audio', 'permissions', 'environment', 'geometry']);

/** Message key of the family note, or null when the family has none. */
export function familyNoteKey(family: TechniqueFamily): string | null {
  return FAMILIES_WITH_NOTE.has(family) ? 'card_note_' + family.replace(/-/g, '_') : null;
}

function familyNoteMessage(family: TechniqueFamily): Message | null {
  const key = familyNoteKey(family);
  return key === null ? null : msg(key);
}

const OTHER_SUFFIX = '-other';
const UNCLASSIFIED_SUFFIX = '-unclassified';

/**
 * S05 / DET-039: a `state-<category>` code is shown as the localized permission category (never a permission name
 * or a state); `state-unclassified` falls through to `operation_unclassified`. Null for every other code.
 */
export function permissionCategoryMessage(code: OperationCode): Message | null {
  switch (code) {
    case 'state-location':
      return msg('permission_category_location');
    case 'state-notifications':
      return msg('permission_category_notifications');
    case 'state-media':
      return msg('permission_category_media');
    case 'state-sensors':
      return msg('permission_category_sensors');
    case 'state-midi':
      return msg('permission_category_midi');
    case 'state-clipboard':
      return msg('permission_category_clipboard');
    case 'state-storage':
      return msg('permission_category_storage');
    case 'state-other':
      return msg('permission_category_other');
    default:
      return null;
  }
}

/**
 * Display items for operation codes: API names from the contract list, permission categories (S05), localized
 * phrases for other/unclassified.
 */
export function operationItems(codes: ReadonlyArray<OperationCode>): Array<string | Message> {
  const out: Array<string | Message> = [];
  const seen = new Set<string>();
  for (const code of codes) {
    const item: string | Message =
      permissionCategoryMessage(code) ??
      (code.endsWith(OTHER_SUFFIX)
        ? msg('operation_other')
        : code.endsWith(UNCLASSIFIED_SUFFIX)
          ? msg('operation_unclassified')
          : OPERATION_API_NAMES[code]);
    const identity = typeof item === 'string' ? 'api:' + item : 'key:' + item.key;
    if (seen.has(identity)) continue;
    seen.add(identity);
    out.push(item);
  }
  return out;
}

function isAttemptOnly(phases: ReadonlyArray<Phase>): boolean {
  return phases.length > 0 && phases.every((phase) => phase === 'threw-sync');
}

/**
 * Sort rank: interpretation tier (x100), confidence (x10), count (up to 9). S06: +10 for techniques that are not
 * common surfaces (TechniqueInfo.common), so layout/navigator/screen reads never push canvas or WebGL out of the
 * popup's top cards within a tier. The bonus stays below one tier (max 30 + 9 + 10 < 100). The badge is not affected.
 */
function rankOf(interpretation: Interpretation, confidence: InterpretationConfidence, count: number, common: boolean): number {
  return INTERPRETATION_WEIGHT[interpretation] * 100 + CONFIDENCE_WEIGHT[confidence] * 10 + Math.min(count, 9) + (common ? 0 : 10);
}

interface CardSource {
  id: string;
  documentKey: string;
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
  const operationCodes = summary?.operationCodes ?? [];
  const pageHook = summary !== undefined && summary.evidenceSource === 'page-hook';
  const searchParts = [
    source.techniqueId,
    techniqueInfo.api,
    techniqueInfo.category,
    source.interpretation,
    finding?.ruleId ?? '',
    finding?.findingId ?? '',
    ...(finding?.vendorMatchIds ?? []),
    ...operationCodes.map((code) => OPERATION_API_NAMES[code]),
  ];
  return {
    id: source.id,
    kind,
    label: msg(KIND_LABEL_KEY[kind]),
    techniqueId: source.techniqueId,
    category: techniqueInfo.category,
    api: techniqueInfo.api,
    observation: observationMessage(source.techniqueId, techniqueInfo.api, label, evidenceSource),
    attemptOnly: isAttemptOnly(phases),
    completionUnobserved: phases.some((phase) => phase === 'attempted' || phase === 'settlement-unobserved' || phase === 'async-returned'),
    interpretation: interpretationMessage(kind, source.interpretation, techniqueInfo.family),
    interpretationNote: kind === 'possible-fingerprinting' ? msg('card_fp_not_proven') : null,
    familyNote: familyNoteMessage(techniqueInfo.family),
    confidence: msg(confidenceKey(source.confidence)),
    purpose: purposeMessage(techniqueInfo.family),
    evidenceSource,
    integrity,
    attribution: summary?.attributionConfidence ?? 'unknown',
    count,
    countQuality,
    countLabel: label,
    phases,
    operations: operationItems(operationCodes),
    interpretationKind: source.interpretation,
    confidenceLevel: source.confidence,
    signalCodes: summary === undefined ? [] : [...new Set(summary.signalCodes)].sort(),
    firstBucket: pageHook ? summary.firstBucket : null,
    lastBucket: pageHook ? summary.lastBucket : null,
    documentKey: source.documentKey,
    ruleId: finding?.ruleId ?? null,
    ruleVersion: finding?.ruleVersion ?? null,
    findingId: finding?.findingId ?? null,
    evidenceIds: finding === null ? [] : [...finding.evidenceIds],
    limitationCodes: finding === null ? [] : [...finding.limitationCodes],
    counterEvidenceCodes: finding === null ? [] : [...finding.counterEvidenceCodes],
    vendorMatchIds: finding === null ? [] : [...finding.vendorMatchIds],
    rank: rankOf(source.interpretation, source.confidence, count, techniqueInfo.common === true),
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
        documentKey: report.documentKey,
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
        documentKey: report.documentKey,
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

export function vendorMatchKey(match: VendorMatch): string {
  return 'card_vendor_match_' + match.replace(/-/g, '_');
}

/**
 * S10: level wording of a vendor card. A weak signal that the browser observed on the network is a request to a
 * documented service address without an exact resource; a page-controlled weak signal keeps the "may be spoofed" text.
 */
export function vendorMatchMessageKey(vendor: Pick<VendorSummary, 'vendorConfidence' | 'integrity'>): string {
  if (vendor.vendorConfidence === 'weak-signal' && vendor.integrity === 'browser-observed') return 'card_vendor_match_weak_signal_network';
  return vendorMatchKey(vendor.vendorConfidence);
}

/**
 * S10 / ADR-009 v1.1: vendor cards from the projection and the build's catalog. Names, purpose keys and rule texts
 * come from the compiled catalog only (no hard-coded vendor table); an unknown vendor keeps its id and the generic
 * purpose, an unknown rule keeps its id without texts. `requestOnly`: a browser-network match says only that the
 * browser received a resource. Recognition is never trust (REQ-007): no positive wording is produced here.
 */
export function buildVendorCards(report: ReportProjection, catalog: CatalogIndex, locale: string): VendorCardVM[] {
  const out: VendorCardVM[] = [];
  const catalogVersion = typeof report.catalogVersion === 'string' ? report.catalogVersion : null;
  for (const vendor of report.vendors as ReadonlyArray<VendorSummary>) {
    if (vendor.vendorConfidence === 'none') continue;
    const display = vendorDisplay(catalog, vendor.vendorId);
    const name = display.displayName;
    const rules: VendorRuleVM[] = vendor.ruleIds.map((ruleId) => {
      const rule = ruleDisplay(catalog, ruleId, locale);
      return rule === null ? { ruleId, ruleVersion: null, meaning: null, limitations: null } : { ruleId, ruleVersion: rule.ruleVersion, meaning: rule.meaning, limitations: rule.limitations };
    });
    out.push({
      vendorId: vendor.vendorId,
      name,
      match: vendor.vendorConfidence,
      matchLabel: msg(vendorMatchMessageKey(vendor)),
      found: msg('card_vendor_found', name),
      purpose: msg('card_vendor_purpose', msg(display.purposeKey)),
      ruleIds: [...vendor.ruleIds],
      rules,
      requestOnly: vendor.evidenceSource === 'browser-network',
      catalogVersion,
      evidenceSource: vendor.evidenceSource,
      integrity: vendor.integrity,
      searchText: [vendor.vendorId, name, ...vendor.ruleIds, vendor.vendorConfidence].join(' ').toLowerCase(),
    });
  }
  return out;
}
