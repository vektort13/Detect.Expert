// Popup view model (E13-01, spec V §7, VI I5). The engine returns message KEYS and parameters — the UI resolves
// them through its i18n layer (docs/ui-copy.md). No Russian/English prose lives here. `locale` is used only for
// number formatting. Every string value in params is either a formatted number, an API surface name or a host.
//
// Card levels (ADR-001 §2): observation ("canvas pixel read called") -> interpretation ("looks like fingerprint
// construction") -> purpose in general ("can be used to recognise a browser"). Colour is never the only carrier
// of meaning, so every card has a text label for its type.

import type {
  CountQuality,
  CoverageFlag,
  CoverageState,
  Finding,
  InterpretationConfidence,
  ReportProjection,
  TechniqueId,
  TechniqueSummary,
  VendorSummary,
} from '@detect-expert/contracts';
import { COUNTER_EVIDENCE_CODES, LIMITATION_CODES } from './codes';
import type { SourceSummary } from './projection';
import { techniqueCategory, TECHNIQUE_API_NAMES, TECHNIQUE_LABEL_KEYS } from './techniques';

export type MessageParam = string | MessageRef | MessageRef[];

export interface MessageRef {
  /** Key in _locales/<locale>/messages.json (docs/ui-copy.md). */
  key: string;
  /** Placeholder values; nested refs are resolved by the UI and arrays joined with a locale separator. */
  params?: Record<string, MessageParam>;
}

export type CardType = 'api-use' | 'possible-fingerprinting' | 'vendor';

export interface CardViewModel {
  id: string;
  type: CardType;
  /** Text label of the card type (never colour-only). */
  label: MessageRef;
  headline: MessageRef;
  techniqueId: TechniqueId | null;
  /** Observation line, e.g. formatted count with quality. */
  count: CountViewModel | null;
  /** Interpretation confidence (interpretive cards only). */
  confidence: MessageRef | null;
  integrity: MessageRef;
  purpose: MessageRef | null;
  /** Ordinary explanations, "not proven", attempt-only, etc. */
  notes: MessageRef[];
  limitations: MessageRef[];
  rule: { ruleId: string; ruleVersion: string } | null;
}

export interface CountViewModel {
  value: number | null;
  /** Locale-formatted; lower-bound gets a "≥" prefix, sampled "≈". 'n/a' when unknown. */
  formatted: string;
  quality: MessageRef | null;
}

export interface CoverageViewModel {
  state: CoverageState;
  title: MessageRef;
  description: MessageRef;
  flags: MessageRef[];
  reloadSuggested: boolean;
}

export interface PopupViewModel {
  documentKey: string;
  reportRevision: number;
  host: string | null;
  coverage: CoverageViewModel;
  counts: { techniques: CountViewModel; services: CountViewModel; thirdParty: CountViewModel };
  cards: CardViewModel[];
  /** Cards not shown because of the popup limit. */
  hiddenCards: number;
  /** Present when there is nothing to show; always next to coverage (REQ-006). */
  empty: { title: MessageRef; hint: MessageRef } | null;
  dropped: { total: number; message: MessageRef | null };
  sections: { vendorsTitle: MessageRef; vendorsDisclaimer: MessageRef };
  actions: { pause: boolean; resume: boolean; reload: boolean; clear: boolean; export: boolean };
  badge: { count: number; tooltip: MessageRef };
  ariaLive: MessageRef;
}

export const POPUP_MAX_CARDS = 5;

export const COVERAGE_TITLE_KEYS: Readonly<Record<CoverageState, string>> = Object.freeze({
  active: 'coverage_active_title',
  partial: 'coverage_partial_title',
  'late-start': 'coverage_late_start_title',
  paused: 'coverage_paused_title',
  unsupported: 'coverage_unsupported_title',
  'no-access': 'coverage_no_access_title',
  degraded: 'coverage_degraded_title',
});

/** Flag -> message key. Keys not yet in docs/ui-copy.md are marked NEW in the task result. */
export const COVERAGE_FLAG_KEYS: Readonly<Record<CoverageFlag, string>> = Object.freeze({
  'late-start': 'coverage_flag_late_start',
  'hook-failed': 'coverage_flag_hook_failed',
  throttled: 'coverage_flag_throttled',
  'unsupported-realm': 'coverage_flag_unsupported_realm',
  'channel-gap': 'coverage_flag_channel_gap',
  truncated: 'coverage_flag_truncated',
  paused: 'coverage_paused_title',
  revoked: 'coverage_flag_revoked',
  'protocol-mismatch': 'coverage_flag_protocol_mismatch',
  'descriptor-nonconfigurable': 'coverage_flag_hook_failed',
  'bridge-ring-overflow': 'coverage_flag_channel_gap',
  'budget-exceeded': 'coverage_flag_budget_exceeded',
  'no-host-permission': 'coverage_flag_no_host_permission',
  'restricted-page': 'coverage_unsupported_title',
  'worker-not-observed': 'coverage_flag_worker_not_observed',
  'network-limited': 'coverage_flag_network_limited',
  'frames-inaccessible': 'coverage_flag_frames_inaccessible',
});

export const CONFIDENCE_KEYS: Readonly<Record<InterpretationConfidence, string>> = Object.freeze({
  low: 'confidence_low',
  medium: 'confidence_medium',
  high: 'confidence_high',
  unassessed: 'confidence_unassessed',
});

export const COUNT_QUALITY_KEYS: Readonly<Record<CountQuality, string>> = Object.freeze({
  exact: 'count_exact',
  sampled: 'count_sampled',
  'lower-bound': 'count_lower_bound',
});

export const LIMITATION_KEYS: Readonly<Record<string, string>> = Object.freeze({
  [LIMITATION_CODES.pageControlledEvidence]: 'limitation_page_controlled_evidence',
  [LIMITATION_CODES.purposeUnknown]: 'limitation_purpose_unknown',
  [LIMITATION_CODES.uniquenessNotEstablished]: 'limitation_uniqueness_not_established',
  [LIMITATION_CODES.readbackAttemptedFailed]: 'limitation_readback_attempted_failed',
  [LIMITATION_CODES.uncalibratedThreshold]: 'limitation_uncalibrated_threshold',
  [LIMITATION_CODES.coverageIncomplete]: 'limitation_coverage_incomplete',
  [LIMITATION_CODES.catalogDisabled]: 'limitation_catalog_disabled',
  [LIMITATION_CODES.textOpsUndifferentiated]: 'limitation_text_ops_undifferentiated',
  [LIMITATION_CODES.noTimeWindow]: 'limitation_no_time_window',
});

export const COUNTER_EVIDENCE_KEYS: Readonly<Record<string, string>> = Object.freeze({
  [COUNTER_EVIDENCE_CODES.highVolumeRendering]: 'alternative_high_volume_rendering',
});

const CODE_RE = /^[a-z0-9-]+$/;
/** Label keys whose text carries an $API$ placeholder (docs/ui-copy.md §4.1). */
const LABELS_WITH_API: ReadonlySet<string> = new Set(['card_api_use_canvas_export', 'card_api_use_canvas_readback']);

/** Unknown codes still get a deterministic key so the UI can show a fallback; never echoes free text. */
function codeKey(table: Readonly<Record<string, string>>, prefix: string, code: string): string {
  const known = table[code];
  if (known !== undefined) return known;
  return CODE_RE.test(code) ? prefix + code.split('-').join('_') : prefix + 'unknown';
}

function ref(key: string, params?: Record<string, MessageParam>): MessageRef {
  return params === undefined ? { key } : { key, params };
}

/** Formatter cache: constructing Intl.NumberFormat costs ~100 µs, formatting costs ~1 µs. Bounded by locales seen. */
const formatters = new Map<string, Intl.NumberFormat | null>();
const MAX_CACHED_LOCALES = 16;

export function formatNumber(n: number, locale: string): string {
  let nf = formatters.get(locale);
  if (nf === undefined) {
    try {
      nf = new Intl.NumberFormat(locale);
    } catch {
      nf = null;
    }
    if (formatters.size >= MAX_CACHED_LOCALES) formatters.clear();
    formatters.set(locale, nf);
  }
  return nf === null ? String(n) : nf.format(n);
}

export function countViewModel(value: number | null, quality: CountQuality | null, locale: string): CountViewModel {
  if (value === null) return { value: null, formatted: 'n/a', quality: null };
  const prefix = quality === 'lower-bound' ? '≥ ' : quality === 'sampled' ? '≈ ' : '';
  return {
    value,
    formatted: prefix + formatNumber(value, locale),
    quality: quality === null ? null : ref(COUNT_QUALITY_KEYS[quality]),
  };
}

function droppedTotal(p: ReportProjection): number {
  const d = p.dropped;
  return d.observations + d.batches + d.findings + d.hosts + d.counters + d.transport;
}

function hostParam(host: string | null): MessageParam {
  return host === null ? ref('host_unknown') : host;
}

export function coverageViewModel(p: ReportProjection, locale: string): CoverageViewModel {
  const flags = p.coverageFlags.map((f) => ref(COVERAGE_FLAG_KEYS[f]));
  const title = ref(COVERAGE_TITLE_KEYS[p.coverageState]);
  let description: MessageRef;
  switch (p.coverageState) {
    case 'active':
      description = ref('coverage_active_desc');
      break;
    case 'partial':
      description = ref('coverage_partial_desc', { DETAIL: flags.length > 0 ? flags : [ref('coverage_blind_spots_title')] });
      break;
    case 'late-start':
      description = ref('coverage_late_start_desc');
      break;
    case 'paused':
      description = ref('coverage_paused_desc');
      break;
    case 'unsupported':
      description = ref('coverage_unsupported_desc');
      break;
    case 'no-access':
      description = p.coverageFlags.includes('revoked')
        ? ref('coverage_revoked_desc', { HOST: hostParam(p.host) })
        : ref('coverage_no_access_desc', { HOST: hostParam(p.host) });
      break;
    case 'degraded':
      description = ref('coverage_degraded_desc', { DROPPED: formatNumber(droppedTotal(p), locale) });
      break;
  }
  return {
    state: p.coverageState,
    title,
    description,
    flags,
    reloadSuggested: p.coverageState === 'late-start' || p.coverageFlags.includes('protocol-mismatch'),
  };
}

const CONFIDENCE_RANK: Readonly<Record<InterpretationConfidence, number>> = { high: 0, medium: 1, low: 2, unassessed: 3 };

function interpretiveHeadline(f: Finding): MessageRef {
  switch (f.interpretation) {
    case 'fingerprinting-pattern':
      return techniqueCategory(f.techniqueId) === 'graphics' ? ref('card_fp_canvas_sequence') : ref('card_fp_insufficient');
    case 'possible-fingerprinting':
      return ref('card_fp_insufficient');
    case 'local-probe-pattern':
      return ref('card_fp_local_probe');
    case 'dns-test-pattern':
      return ref('card_fp_dns_pattern');
    default:
      return ref('card_fp_insufficient');
  }
}

function limitationRefs(f: Finding): MessageRef[] {
  return f.limitationCodes.map((c) => ref(codeKey(LIMITATION_KEYS, 'limitation_', c)));
}

function interpretiveCard(f: Finding, technique: TechniqueSummary | undefined, locale: string): CardViewModel {
  const notes: MessageRef[] = [ref('card_fp_not_proven')];
  if (f.counterEvidenceCodes.length > 0) {
    notes.push(
      ref('card_fp_alternatives', {
        ALTERNATIVES: f.counterEvidenceCodes.map((c) => ref(codeKey(COUNTER_EVIDENCE_KEYS, 'alt_', c))),
      }),
    );
  }
  if (f.limitationCodes.includes(LIMITATION_CODES.readbackAttemptedFailed)) notes.push(ref('card_api_use_attempt_only'));
  return {
    id: f.findingId,
    type: 'possible-fingerprinting',
    label: ref('card_fp_label'),
    headline: interpretiveHeadline(f),
    techniqueId: f.techniqueId,
    count: technique === undefined ? null : countViewModel(technique.count, technique.countQuality, locale),
    confidence: ref(CONFIDENCE_KEYS[f.interpretationConfidence]),
    integrity: ref('integrity_page_controlled'),
    purpose: ref('card_api_use_purpose'),
    notes,
    limitations: limitationRefs(f),
    rule: { ruleId: f.ruleId, ruleVersion: f.ruleVersion },
  };
}

function apiUseCard(f: Finding, technique: TechniqueSummary | undefined, locale: string): CardViewModel {
  const count = technique === undefined ? null : countViewModel(technique.count, technique.countQuality, locale);
  const labelKey = TECHNIQUE_LABEL_KEYS[f.techniqueId];
  const params: Record<string, MessageParam> = { COUNT: count === null ? 'n/a' : count.formatted };
  const api = TECHNIQUE_API_NAMES[f.techniqueId];
  if (api !== undefined && labelKey !== undefined && LABELS_WITH_API.has(labelKey)) params['API'] = api;
  const headline =
    labelKey !== undefined ? ref(labelKey, params) : ref('card_api_use_generic', { ...params, TECHNIQUE: f.techniqueId });
  const notes: MessageRef[] = [];
  if (f.limitationCodes.includes(LIMITATION_CODES.readbackAttemptedFailed)) notes.push(ref('card_api_use_attempt_only'));
  notes.push(ref('card_api_use_generic_note'));
  return {
    id: f.findingId,
    type: 'api-use',
    label: ref('card_api_use_label'),
    headline,
    techniqueId: f.techniqueId,
    count,
    confidence: null,
    integrity: ref('integrity_page_controlled'),
    purpose: ref('card_api_use_purpose'),
    notes,
    limitations: limitationRefs(f),
    rule: { ruleId: f.ruleId, ruleVersion: f.ruleVersion },
  };
}

function vendorCard(v: VendorSummary): CardViewModel {
  return {
    id: 'vendor-' + v.vendorId,
    type: 'vendor',
    label: ref('section_vendors_title'),
    headline: ref('card_vendor_found', { VENDOR: v.vendorId }),
    techniqueId: null,
    count: null,
    confidence: null,
    integrity: ref(v.integrity === 'browser-observed' ? 'integrity_browser_observed' : v.integrity === 'derived' ? 'integrity_derived' : 'integrity_page_controlled'),
    purpose: null,
    notes: [ref('card_vendor_match_' + v.vendorConfidence.split('-').join('_')), ref('card_vendor_not_linked'), ref('card_vendor_no_trust')],
    limitations: [],
    rule: null,
  };
}

export interface PopupViewModelOptions {
  /** Source counts from summarizeSources(); when absent the third number is 'n/a' (never a false zero). */
  sources?: SourceSummary;
}

export function toPopupViewModel(p: ReportProjection, locale: string, opts: PopupViewModelOptions = {}): PopupViewModel {
  const techniqueById = new Map<TechniqueId, TechniqueSummary>();
  for (const t of p.techniques) techniqueById.set(t.techniqueId, t);

  const interpretive = p.findings
    .filter((f) => f.interpretation !== 'api-use')
    .sort((a, b) => CONFIDENCE_RANK[a.interpretationConfidence] - CONFIDENCE_RANK[b.interpretationConfidence] || a.findingId.localeCompare(b.findingId));
  const apiUse = p.findings
    .filter((f) => f.interpretation === 'api-use')
    .sort((a, b) => (techniqueById.get(b.techniqueId)?.count ?? 0) - (techniqueById.get(a.techniqueId)?.count ?? 0) || a.techniqueId.localeCompare(b.techniqueId));

  const allCards: CardViewModel[] = [
    ...interpretive.map((f) => interpretiveCard(f, techniqueById.get(f.techniqueId), locale)),
    ...p.vendors.map(vendorCard),
    ...apiUse.map((f) => apiUseCard(f, techniqueById.get(f.techniqueId), locale)),
  ];
  const cards = allCards.slice(0, POPUP_MAX_CARDS);

  const categories = new Set<string>();
  for (const f of interpretive) categories.add(techniqueCategory(f.techniqueId));
  if (p.vendors.length > 0) categories.add('vendor');

  const coverage = coverageViewModel(p, locale);
  const dropped = droppedTotal(p);
  const sources = opts.sources;
  const collecting = p.coverageState !== 'no-access' && p.coverageState !== 'unsupported';

  return {
    documentKey: p.documentKey,
    reportRevision: p.reportRevision,
    host: p.host,
    coverage,
    counts: {
      techniques: countViewModel(p.techniques.length, null, locale),
      services: countViewModel(p.vendors.length, null, locale),
      thirdParty: countViewModel(sources === undefined ? null : sources.byRelation['cross-site'], sources !== undefined && sources.dropped > 0 ? 'lower-bound' : null, locale),
    },
    cards,
    hiddenCards: allCards.length - cards.length,
    empty: allCards.length === 0 ? { title: ref('empty_no_findings'), hint: ref('empty_no_findings_hint') } : null,
    dropped: {
      total: dropped,
      message: dropped > 0 ? ref('coverage_degraded_desc', { DROPPED: formatNumber(dropped, locale) }) : null,
    },
    sections: { vendorsTitle: ref('section_vendors_title'), vendorsDisclaimer: ref('card_vendor_no_trust') },
    actions: {
      pause: collecting && p.coverageState !== 'paused',
      resume: p.coverageState === 'paused',
      reload: coverage.reloadSuggested,
      clear: true,
      export: true,
    },
    badge: { count: categories.size, tooltip: ref('badge_tooltip', { N: formatNumber(categories.size, locale) }) },
    ariaLive: ref('aria_live_update', { N: formatNumber(allCards.length, locale), STATE: coverage.title }),
  };
}
