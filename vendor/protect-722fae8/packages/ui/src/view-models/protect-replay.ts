// ADR-020 §E (S11): view model of «Запись сессии» (popup row and side-panel details). Pure; returns message keys.
// Wording (docs/ui-copy.md §6.14.E): the level is a conclusion about page behaviour, never about the content that was
// sent, never «маскирование отсутствует», never «<вендор> записывает», never «сайт следит за вами». Tone: attention for
// replay-like / replay-recording, muted otherwise — never green or red (no safety verdict, REQ-007). Coverage and the
// limitations always next to the level (REQ-006).

import { COVERAGE_STATES, PROTECT_LIMITATIONS, REPLAY_BODY_SIZES, REPLAY_LEVELS, REPLAY_SIGNAL_CODES } from '@detect-expert/contracts';
import type {
  EvidenceSource,
  Integrity,
  ProtectLimitation,
  ProtectProjection,
  ReplayBodySize,
  ReplayLevel,
  ReplayPeriodicHost,
  ReplaySignalCode,
  ReplaySummary,
} from '@detect-expert/contracts';
import { joinMessages, msg } from './message';
import type { Message } from './message';
import { protectCoverageMessage } from './protect';

/** Receivers shown in the popup row (the side panel shows all of them). */
export const REPLAY_POPUP_RECEIVERS = 2;

export type ReplayTone = 'attention' | 'muted';

export const REPLAY_LEVEL_KEYS: Readonly<Record<ReplayLevel, string>> = {
  none: 'replay_level_none',
  'signals-only': 'replay_level_signals_only',
  'replay-like': 'replay_level_like',
  'replay-recording': 'replay_level_recording',
};

export const REPLAY_TONES: Readonly<Record<ReplayLevel, ReplayTone>> = {
  none: 'muted',
  'signals-only': 'muted',
  'replay-like': 'attention',
  'replay-recording': 'attention',
};

export const REPLAY_CONFIDENCE_KEYS: Readonly<Record<ReplaySummary['interpretationConfidence'], string>> = {
  unassessed: 'confidence_unassessed',
  low: 'confidence_low',
  medium: 'confidence_medium',
};

export const REPLAY_SIGNAL_KEYS: Readonly<Record<ReplaySignalCode, string>> = {
  'root-input-listeners': 'replay_signal_root_input_listeners',
  'root-mutation-observe': 'replay_signal_root_mutation_observe',
  'periodic-third-party-send': 'replay_signal_periodic',
  'replay-vendor-resource': 'replay_signal_vendor_resource',
};

export const REPLAY_BODY_KEYS: Readonly<Record<ReplayBodySize, string>> = {
  'not-observed': 'replay_body_not_observed',
  empty: 'replay_body_empty',
  'under-1k': 'replay_body_under_1k',
  '1k-16k': 'replay_body_1k_16k',
  'over-16k': 'replay_body_over_16k',
};

/** Limitations of a summary with their own text. `masking-not-verifiable` is the masking line itself. */
export const REPLAY_LIMITATION_KEYS: Readonly<Partial<Record<ProtectLimitation, string>>> = {
  'no-script-attribution': 'replay_limit_no_script_attribution',
  'element-listeners-not-observed': 'replay_limit_element_listeners',
  'loaded-before-enable': 'replay_limit_loaded_before_enable',
  'websocket-not-observed': 'replay_limit_websocket',
  'uncalibrated-threshold': 'replay_limit_uncalibrated',
  'vendor-rules-disabled': 'replay_vendor_rules_disabled',
  'listener-hook-off': 'replay_limit_listener_hook_off',
  'mo-hook-off': 'replay_limit_mo_hook_off',
  'mo-options-not-read': 'replay_limit_mo_options',
  'body-size-not-observed': 'replay_limit_body_size',
  'cadence-reset': 'replay_limit_cadence_reset',
  'periodic-hosts-truncated': 'replay_limit_hosts_truncated',
  'worker-requests-may-be-missed': 'replay_limit_workers',
  'first-party-endpoints-not-assessed': 'replay_limit_first_party',
};

export interface ReplayReceiverVM {
  site: string;
  text: Message;
  body: Message;
}

export interface ReplayRowVM {
  level: ReplayLevel;
  tone: ReplayTone;
  title: Message;
  confidence: Message;
  /** «Вывод сделан по поведению страницы…» (any level above none). */
  basis: Message | null;
  /** replay-like: autocapture tools behave similarly. */
  likeNote: Message | null;
  receivers: ReplayReceiverVM[];
  /** Receivers not shown here (popup: see the side panel). */
  hiddenReceivers: number;
  masking: Message;
  /** The service table has no enabled rule (production): services are not recognized. */
  vendorRulesDisabled: Message | null;
  disclaimer: Message;
  /** Coverage of the module on this page, next to the level. */
  coverage: Message | null;
}

export interface ReplaySignalVM {
  code: ReplaySignalCode;
  text: Message;
  /** Registrable domain of the sampled scripts (page-controlled), when one site is linked. */
  script: Message | null;
  integrity: Integrity;
  evidenceSource: EvidenceSource;
}

export interface ReplayDetailsVM {
  row: ReplayRowVM;
  signals: ReplaySignalVM[];
  limitations: Message[];
  /** Help: what each level means. */
  levels: Message[];
}

const LEVELS: ReadonlySet<string> = new Set(REPLAY_LEVELS);
const SIGNALS: ReadonlySet<string> = new Set(REPLAY_SIGNAL_CODES);
const BODIES: ReadonlySet<string> = new Set(REPLAY_BODY_SIZES);
const COVERAGE: ReadonlySet<string> = new Set(COVERAGE_STATES);
const LIMITATION_ORDER: ReadonlyMap<ProtectLimitation, number> = new Map(PROTECT_LIMITATIONS.map((l, i) => [l, i]));

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Shape check of the projection's replay part (a malformed summary is not shown). */
export function isShowableReplay(v: unknown): v is ReplaySummary {
  if (!isRecord(v) || v['ruleId'] !== 'session-replay-behavior' || typeof v['level'] !== 'string' || !LEVELS.has(v['level'])) return false;
  if (!Array.isArray(v['signals']) || !Array.isArray(v['periodicHosts']) || !Array.isArray(v['vendors']) || !Array.isArray(v['limitationCodes'])) return false;
  return v['inputMasking'] === 'unconfirmed' || v['inputMasking'] === 'value-seen-in-traffic';
}

function receiverVM(h: ReplayPeriodicHost): ReplayReceiverVM {
  const run = Number.isSafeInteger(h.runMax) ? h.runMax : 0;
  return {
    site: h.registrableDomain,
    text: msg('replay_signal_periodic', h.registrableDomain, String(run)),
    body: msg(BODIES.has(h.bodySize) ? REPLAY_BODY_KEYS[h.bodySize] : 'replay_body_not_observed'),
  };
}

/** The receiver whose request carried a typed value (value-match evidence of the same document). */
function valueSeenSite(report: ProtectProjection, replay: ReplaySummary): string | null {
  const periodic = new Set(replay.periodicHosts.map((h) => h.registrableDomain));
  for (const e of report.evidence) {
    if (e.protectKind === 'value-match' && typeof e.receiver === 'string' && periodic.has(e.receiver)) return e.receiver;
  }
  return null;
}

function rowOf(report: ProtectProjection, replay: ReplaySummary, limit: number | null): ReplayRowVM {
  const level = replay.level;
  const hosts = replay.periodicHosts.filter((h) => isRecord(h) && typeof h.registrableDomain === 'string');
  const shown = limit === null ? hosts : hosts.slice(0, limit);
  const seen = replay.inputMasking === 'value-seen-in-traffic' ? valueSeenSite(report, replay) : null;
  return {
    level,
    tone: REPLAY_TONES[level],
    title: msg(REPLAY_LEVEL_KEYS[level]),
    confidence: msg(REPLAY_CONFIDENCE_KEYS[replay.interpretationConfidence] ?? 'confidence_unassessed'),
    basis: level === 'none' ? null : msg('replay_basis_behavior'),
    likeNote: level === 'replay-like' ? msg('replay_like_note') : null,
    receivers: shown.map(receiverVM),
    hiddenReceivers: hosts.length - shown.length,
    masking: seen !== null ? msg('replay_masking_value_seen', seen) : msg('replay_masking_unconfirmed'),
    vendorRulesDisabled: replay.limitationCodes.includes('vendor-rules-disabled') ? msg('replay_vendor_rules_disabled') : null,
    disclaimer: msg('replay_disclaimer'),
    coverage: COVERAGE.has(report.coverageState) ? msg('protect_coverage_line', protectCoverageMessage(report)) : null,
  };
}

/** Popup row: null while nothing is loaded, the feature is off or the summary is malformed. */
export function replayRowView(report: ProtectProjection | null, limit: number | null = REPLAY_POPUP_RECEIVERS): ReplayRowVM | null {
  if (report === null || !isShowableReplay(report.replay)) return null;
  return rowOf(report, report.replay, limit);
}

function signalVM(replay: ReplaySummary, code: ReplaySignalCode, linkedSite: string | undefined, integrity: Integrity, evidenceSource: EvidenceSource): ReplaySignalVM {
  let text: Message;
  if (code === 'periodic-third-party-send') {
    const top = replay.periodicHosts.find((h) => h.registrableDomain === linkedSite) ?? replay.periodicHosts[0];
    text = top === undefined ? msg('replay_signal_periodic_none') : msg('replay_signal_periodic', top.registrableDomain, String(top.runMax));
  } else if (code === 'replay-vendor-resource') {
    text = msg('replay_signal_vendor_resource', joinMessages(replay.vendors.map((v) => v.vendorId)));
  } else text = msg(REPLAY_SIGNAL_KEYS[code]);
  const scripted = (code === 'root-input-listeners' || code === 'root-mutation-observe') && typeof linkedSite === 'string';
  return { code, text, script: scripted ? msg('replay_signal_script_site', linkedSite) : null, integrity, evidenceSource };
}

/** Side panel: every signal with its trust badge, every receiver, the limitations and the level help. */
export function replayDetailsView(report: ProtectProjection | null): ReplayDetailsVM | null {
  if (report === null || !isShowableReplay(report.replay)) return null;
  const replay = report.replay;
  const signals: ReplaySignalVM[] = [];
  for (const s of replay.signals) {
    if (!isRecord(s) || typeof s.code !== 'string' || !SIGNALS.has(s.code)) continue;
    signals.push(signalVM(replay, s.code, s.linkedSite, s.integrity, s.evidenceSource));
  }
  const limitations: Message[] = [];
  const codes = [...replay.limitationCodes].sort((a, b) => (LIMITATION_ORDER.get(a) ?? 0) - (LIMITATION_ORDER.get(b) ?? 0));
  for (const code of codes) {
    const key = REPLAY_LIMITATION_KEYS[code];
    if (key !== undefined && code !== 'vendor-rules-disabled') limitations.push(msg(key));
  }
  return {
    row: rowOf(report, replay, null),
    signals,
    limitations,
    levels: REPLAY_LEVELS.map((l) => msg('replay_level_help_item', msg(REPLAY_LEVEL_KEYS[l]), msg('replay_level_help_' + l.replace(/-/g, '_')))),
  };
}
