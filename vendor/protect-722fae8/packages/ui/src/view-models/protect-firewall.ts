// ADR-020 §D, §11 (S09): view model of the firewall card in the popup. Pure; returns message keys (components resolve
// them). Truthful wording (docs/ui-copy.md §6.14.D):
// - a request is «уже отправлен» (sent: Chrome reported onSendHeaders), «остановлен правилом, которое действовало до
//   запроса» (stopped: the SW said `stopped` AND an effective block rule exists now — otherwise the guard below
//   downgrades it to unknown) or «исход не наблюдался» (everything else, including stopped-other);
// - the state is that of the request in which the typed value was found (the receiver's transfer record), never the
//   receiver's `lastDelivery`, which follows any request to the receiver's domain (review round 2);
// - a sent request cannot be recalled: the decision concerns future requests (fw_sent_note);
// - no value, hash, mask, value length, URL or query exists in the data, so none is shown (no value hint in v1);
// - «Компания» only through an active catalog rule (none in production, REQ-008);
// - the script is named only from a sampled stack and is marked as page-controlled.
// The SW is trusted, but the projection is read defensively: a malformed firewall section renders nothing.

import {
  DECISION_SCOPES,
  DELIVERY_STATES,
  ENFORCEMENT_DEGRADED,
  ENFORCEMENT_STATES,
  FIELD_KINDS,
  FIREWALL_ACTIONS,
  FIREWALL_NOTICE_KINDS,
  FIREWALL_SENDER_FRAMES,
  PROMPT_ID_PATTERN,
  PROTECT_BUDGETS,
  PROTECT_PRESETS,
  PROTECT_REQUEST_KINDS,
  PROTECT_WIRE_LIMITS,
  SINCE_INPUT,
  SUBMIT_TIMINGS,
  UNDO_ID_PATTERN,
  VALUE_ENCODINGS,
  isDomainName,
  isSiteName,
} from '@detect-expert/contracts';
import type {
  DecisionScope,
  DeliveryState,
  EnforcementDegraded,
  EnforcementState,
  FieldKind,
  FirewallAction,
  FirewallNotice,
  FirewallNoticeKind,
  FirewallPromptView,
  FirewallReceiverView,
  FirewallRuleRef,
  FirewallSender,
  FirewallTabView,
  ProtectProjection,
  ProtectRequestKind,
  ProtectState,
  ProtectTransferEvidence,
  ScriptRef,
  SinceInput,
  SubmitTiming,
  ValueEncoding,
} from '@detect-expert/contracts';
import { joinMessages, msg } from './message';
import type { Message, MessageJoin } from './message';
import { FIELD_KIND_KEYS, SINCE_INPUT_KEYS, encodingMessage, isHashEncodingCode, isShowableTransfer, whereMessage } from './protect-evidence';

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

export type FirewallAlertState = 'sent' | 'stopped' | 'unknown';

/** decide: block / allow; ack: warn-only («Понятно» only); unavailable: no request rules permission («Понятно»). */
export type FirewallCardMode = 'decide' | 'ack' | 'unavailable';

/** The default scope of a decision (prototype: «Всегда на этом сайте»). */
export const FIREWALL_DEFAULT_SCOPE: DecisionScope = 'site';

export const FIREWALL_STATE_KEYS: Readonly<Record<FirewallAlertState, string>> = {
  sent: 'fw_state_sent',
  stopped: 'fw_state_stopped',
  unknown: 'fw_state_unknown',
};

export const FIREWALL_SCOPE_KEYS: Readonly<Record<DecisionScope, { label: string; desc: string }>> = {
  once: { label: 'fw_scope_once', desc: 'fw_scope_once_desc' },
  site: { label: 'fw_scope_site', desc: 'fw_scope_site_desc' },
  everywhere: { label: 'fw_scope_everywhere', desc: 'fw_scope_everywhere_desc' },
};

export const SUBMIT_TIMING_KEYS: Readonly<Record<SubmitTiming, string>> = {
  'before-submit': 'fw_moment_before_submit',
  'after-submit': 'fw_moment_after_submit',
  unknown: 'fw_moment_unknown',
};

export const REQUEST_KIND_KEYS: Readonly<Record<ProtectRequestKind, string>> = {
  navigation: 'fw_req_kind_navigation',
  frame: 'fw_req_kind_frame',
  xhr: 'fw_req_kind_xhr',
  beacon: 'fw_req_kind_beacon',
  image: 'fw_req_kind_image',
  script: 'fw_req_kind_script',
  other: 'fw_req_kind_other',
};

export const FIREWALL_NOTICE_KEYS: Readonly<Record<FirewallNoticeKind, string>> = {
  'strict-auto': 'fw_strict_auto_notice',
  'strict-escalate': 'fw_strict_escalate',
  bypass: 'fw_bypass',
  'limit-reached': 'fw_limit_reached',
};

// ---------------------------------------------------------------------------
// Defensive reading of ProtectProjection.firewall
// ---------------------------------------------------------------------------

const MAX_COUNT_VALUE = 2 ** 31 - 1;
const ENFORCEMENT_SET: ReadonlySet<string> = new Set(ENFORCEMENT_STATES);
const DEGRADED_SET: ReadonlySet<string> = new Set(ENFORCEMENT_DEGRADED);
const PRESET_SET: ReadonlySet<string> = new Set(PROTECT_PRESETS);
const DELIVERY_SET: ReadonlySet<string> = new Set(DELIVERY_STATES);
const FIELD_SET: ReadonlySet<string> = new Set(FIELD_KINDS);
const ENC_SET: ReadonlySet<string> = new Set(VALUE_ENCODINGS);
const TIMING_SET: ReadonlySet<string> = new Set(SUBMIT_TIMINGS);
const SINCE_SET: ReadonlySet<string> = new Set(SINCE_INPUT);
const FRAME_SET: ReadonlySet<string> = new Set(FIREWALL_SENDER_FRAMES);
const ACTION_SET: ReadonlySet<string> = new Set(FIREWALL_ACTIONS);
const SCOPE_SET: ReadonlySet<string> = new Set(DECISION_SCOPES);
const NOTICE_SET: ReadonlySet<string> = new Set(FIREWALL_NOTICE_KINDS);
const KIND_SET: ReadonlySet<string> = new Set(PROTECT_REQUEST_KINDS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_COUNT_VALUE;
}

function enumArray<T extends string>(value: unknown, set: ReadonlySet<string>, max: number): T[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const out: T[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !set.has(item)) return null;
    if (!out.includes(item as T)) out.push(item as T);
  }
  return out;
}

function readRuleRef(value: unknown): FirewallRuleRef | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const { action, scope, origin } = value;
  if (typeof action !== 'string' || !ACTION_SET.has(action) || typeof scope !== 'string' || !SCOPE_SET.has(scope)) return undefined;
  if (origin !== 'user' && origin !== 'preset') return undefined;
  return { action: action as FirewallAction, scope: scope as DecisionScope, origin };
}

function readScript(value: unknown): ScriptRef | undefined {
  if (!isRecord(value) || typeof value['kind'] !== 'string') return undefined;
  const kind = value['kind'];
  if (kind === 'external') {
    const host = value['host'];
    return typeof host === 'string' && host.length <= 253 ? { kind: 'external', host } : { kind: 'unknown' };
  }
  return ['document', 'eval', 'opaque', 'extension', 'unknown'].includes(kind) ? { kind: kind as ScriptRef['kind'] } : undefined;
}

function readSender(value: unknown): FirewallSender | null {
  if (!isRecord(value) || typeof value['frame'] !== 'string' || !FRAME_SET.has(value['frame'])) return null;
  const site = value['initiatorSite'];
  const confidence = value['attributionConfidence'];
  if (!(site === null || isSiteName(site))) return null;
  if (confidence !== 'exact-resource' && confidence !== 'sampled-stack' && confidence !== 'frame-only' && confidence !== 'unknown') return null;
  const script = confidence === 'sampled-stack' ? readScript(value['script']) : undefined;
  return { frame: value['frame'] as FirewallSender['frame'], initiatorSite: site, attributionConfidence: confidence, ...(script === undefined ? {} : { script }) };
}

function readReceiver(value: unknown): FirewallReceiverView | null {
  if (!isRecord(value) || !isDomainName(value['receiver'])) return null;
  const relation = value['relation'];
  if (typeof relation !== 'string') return null;
  const rule = readRuleRef(value['effectiveRule']);
  if (rule === undefined) return null;
  const d = value['delivery'];
  if (!isRecord(d) || !isCount(d['sent']) || !isCount(d['stopped']) || !isCount(d['stoppedOther']) || !isCount(d['unknown'])) return null;
  const last = value['lastDelivery'];
  if (typeof last !== 'string' || !DELIVERY_SET.has(last)) return null;
  const fields = enumArray<FieldKind>(value['fieldKinds'], FIELD_SET, FIELD_KINDS.length);
  const encodings = enumArray<ValueEncoding>(value['encodings'], ENC_SET, PROTECT_WIRE_LIMITS.maxEvidenceEncodings);
  const timing = value['submitTiming'];
  const since = value['sinceInput'];
  if (fields === null || encodings === null || typeof timing !== 'string' || !TIMING_SET.has(timing)) return null;
  if (since !== undefined && (typeof since !== 'string' || !SINCE_SET.has(since))) return null;
  const sender = readSender(value['sender']);
  if (sender === null) return null;
  const vendorId = value['vendorId'];
  const vendorConfidence = value['vendorConfidence'];
  const vendorOk = vendorConfidence === 'documented-resource' || vendorConfidence === 'multi-signal' || vendorConfidence === 'weak-signal';
  return {
    receiver: value['receiver'],
    relation: relation as FirewallReceiverView['relation'],
    effectiveRule: rule,
    delivery: { sent: d['sent'], stopped: d['stopped'], stoppedOther: d['stoppedOther'], unknown: d['unknown'] },
    countQuality: 'lower-bound',
    lastDelivery: last as DeliveryState,
    fieldKinds: FIELD_KINDS.filter((f) => fields.includes(f)),
    encodings: VALUE_ENCODINGS.filter((e) => encodings.includes(e)),
    submitTiming: timing as SubmitTiming,
    ...(since === undefined ? {} : { sinceInput: since as SinceInput }),
    sender,
    ...(vendorOk && typeof vendorId === 'string' && vendorId.length > 0 && vendorId.length <= 64 ? { vendorId } : {}),
    vendorConfidence: vendorOk ? vendorConfidence : 'none',
  };
}

function readPrompt(value: unknown): FirewallPromptView | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || typeof value['promptId'] !== 'string' || !PROMPT_ID_PATTERN.test(value['promptId'])) return undefined;
  const site = value['site'];
  const receivers = value['receivers'];
  if (!isSiteName(site) || !Array.isArray(receivers) || receivers.length === 0 || receivers.length > PROTECT_BUDGETS.maxPromptReceivers) return undefined;
  const list: string[] = [];
  for (const r of receivers) {
    if (!isDomainName(r)) return undefined;
    if (!list.includes(r)) list.push(r);
  }
  const hidden = value['hidden'];
  if (!isCount(hidden)) return undefined;
  return { promptId: value['promptId'], site, receivers: list, hidden };
}

function readNotice(value: unknown): FirewallNotice | null {
  if (!isRecord(value) || typeof value['kind'] !== 'string' || !NOTICE_SET.has(value['kind']) || !isDomainName(value['receiver'])) return null;
  const site = value['site'];
  const count = value['count'];
  const undoId = value['undoId'];
  if (site !== undefined && !isSiteName(site)) return null;
  if (count !== undefined && !isCount(count)) return null;
  if (undoId !== undefined && (typeof undoId !== 'string' || !UNDO_ID_PATTERN.test(undoId))) return null;
  return {
    kind: value['kind'] as FirewallNoticeKind,
    receiver: value['receiver'],
    ...(site === undefined ? {} : { site }),
    ...(count === undefined ? {} : { count }),
    ...(undoId === undefined ? {} : { undoId }),
  };
}

/**
 * Strict reading of ProtectProjection.firewall: enums and bounds of the contract. Malformed receivers and notices are
 * skipped (never rendered raw); a malformed core (enforcement, preset, counters, prompt) gives null.
 */
export function readFirewallView(value: unknown): FirewallTabView | null {
  if (!isRecord(value)) return null;
  const enforcement = value['enforcement'];
  const preset = value['preset'];
  if (typeof enforcement !== 'string' || !ENFORCEMENT_SET.has(enforcement) || typeof preset !== 'string' || !PRESET_SET.has(preset)) return null;
  const code = value['degradedCode'];
  if (code !== undefined && (typeof code !== 'string' || !DEGRADED_SET.has(code))) return null;
  const stopped = value['stoppedToday'];
  if (!isRecord(stopped) || !isCount(stopped['count'])) return null;
  const snoozed = value['snoozedUntil'];
  if (snoozed !== null && !(typeof snoozed === 'number' && Number.isSafeInteger(snoozed) && snoozed > 0)) return null;
  const prompt = readPrompt(value['prompt']);
  if (prompt === undefined) return null;
  const receiversRaw = value['receivers'];
  const noticesRaw = value['notices'];
  const onceRaw = value['onceRules'];
  if (!Array.isArray(receiversRaw) || !Array.isArray(noticesRaw) || !Array.isArray(onceRaw)) return null;
  const receivers: FirewallReceiverView[] = [];
  for (const raw of receiversRaw.slice(0, PROTECT_WIRE_LIMITS.maxFirewallReceivers)) {
    const view = readReceiver(raw);
    if (view !== null && !receivers.some((r) => r.receiver === view.receiver)) receivers.push(view);
  }
  const notices: FirewallNotice[] = [];
  for (const raw of noticesRaw.slice(-PROTECT_BUDGETS.maxNoticesPerTab)) {
    const notice = readNotice(raw);
    if (notice !== null) notices.push(notice);
  }
  const onceRules: FirewallTabView['onceRules'] = [];
  for (const raw of onceRaw.slice(0, PROTECT_WIRE_LIMITS.maxOnceRules)) {
    if (isRecord(raw) && isDomainName(raw['receiver']) && typeof raw['action'] === 'string' && ACTION_SET.has(raw['action'])) {
      onceRules.push({ receiver: raw['receiver'], action: raw['action'] as FirewallAction });
    }
  }
  return {
    enforcement: enforcement as EnforcementState,
    ...(code === undefined ? {} : { degradedCode: code as EnforcementDegraded }),
    preset: preset as FirewallTabView['preset'],
    topDomainsSupported: value['topDomainsSupported'] === true,
    stoppedToday: { count: stopped['count'], countQuality: 'lower-bound' },
    snoozedUntil: snoozed as number | null,
    prompt,
    receivers,
    notices,
    onceRules,
  };
}

// ---------------------------------------------------------------------------
// The truthful state of a receiver (ADR-020 §11)
// ---------------------------------------------------------------------------

/**
 * Alert state of a receiver. `matched` is the delivery of the request in which the typed value was found: the
 * `deliveryState` of the receiver's transfer record shown in the card (`bestEvidenceFor`), or null when this page's
 * report holds none. The receiver view's `lastDelivery` is not used: it follows every request to the receiver's domain
 * (an unrelated script or a pixel without data) and serves the counters only (review round 2, ADR-020 §11).
 * `stopped` needs a basis: the SW reported `stopped` (our rule, active before the request), a stopped request was
 * counted, an effective block rule exists for the receiver now and the mode is not warn-only (no rules exist then).
 * Without that basis the guard downgrades to `unknown`; `stopped-other`, `unknown` and no record stay `unknown`;
 * nothing ever becomes `sent` unless Chrome reported onSendHeaders for the request that carried the value.
 */
export function receiverAlertState(view: FirewallReceiverView | undefined, enforcement: EnforcementState, matched: DeliveryState | null): FirewallAlertState {
  switch (matched) {
    case 'sent':
      return 'sent';
    case 'stopped':
      return view !== undefined && view.delivery.stopped > 0 && view.effectiveRule !== null && view.effectiveRule.action === 'block' && enforcement !== 'warn-only' ? 'stopped' : 'unknown';
    default:
      return 'unknown';
  }
}

/** Field kinds of the receiver's transfer records with this delivery (canonical order). */
function matchedKinds(report: ProtectProjection, receiver: string, delivery: DeliveryState): FieldKind[] {
  const found = new Set<string>();
  for (const e of report.evidence) if (isShowableTransfer(e) && e.receiver === receiver && e.deliveryState === delivery) found.add(e.fieldKind);
  return FIELD_KINDS.filter((k) => found.has(k));
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export interface FirewallDraft {
  scope: DecisionScope;
  /** Unchecked receivers of the prompt (all receivers are checked by default). */
  unchecked: ReadonlyArray<string>;
}

export const EMPTY_FIREWALL_DRAFT: FirewallDraft = Object.freeze({ scope: FIREWALL_DEFAULT_SCOPE, unchecked: Object.freeze([]) as ReadonlyArray<string> });

export interface FirewallRowVM {
  id: 'sender' | 'company' | 'receiver' | 'data' | 'moment';
  label: Message;
  value: FirewallText;
  /** A second line (script attribution, «not an assessment»). */
  extra: Message | null;
}

/** A shown value: a message, a list of messages or a technical token (a domain name). */
export type FirewallText = Message | MessageJoin | string;

export interface FirewallEvidenceVM {
  /** `METHOD host/path` (technical tokens, monospace; a template, never a URL with a query). */
  request: string;
  lines: Message[];
}

export interface FirewallReceiverVM {
  receiver: string;
  state: FirewallAlertState;
  stateLabel: Message;
  checked: boolean;
  /** An effective block rule exists (strict preset or an earlier decision). */
  blocked: boolean;
}

export interface FirewallScopeVM {
  scope: DecisionScope;
  label: Message;
  desc: Message;
}

export interface FirewallNoticeVM {
  kind: FirewallNoticeKind;
  message: Message;
  /** strict-auto: «Отменить решение» (ui-protect-undo). */
  undoId: string | null;
}

export interface FirewallCardVM {
  promptId: string;
  documentKey: string;
  protectRevision: number;
  site: string;
  title: Message;
  siteLine: Message;
  /** The receiver the alert, rows and evidence describe (first checked, else the first of the prompt). */
  primary: string;
  alert: { state: FirewallAlertState; tone: 'attention' | 'neutral'; message: Message };
  /** «Отправленный запрос вернуть нельзя…» (sent / unknown). */
  note: Message | null;
  chips: Message[];
  rows: FirewallRowVM[];
  /** null: no transfer record of the primary receiver in this page's report (fw_ev_none). */
  evidence: FirewallEvidenceVM | null;
  /** «какой скрипт отправил запрос, не определено» (inside the evidence) when no sampled script is named. */
  scriptNote: Message | null;
  receivers: FirewallReceiverVM[];
  /** Further receivers of the prompt that are not named (fw_receivers_hidden). */
  hidden: Message | null;
  scope: DecisionScope;
  scopes: FirewallScopeVM[];
  scopeNote: Message;
  ruleEffect: Message;
  mode: FirewallCardMode;
  /** «Блокировать следующие», or «Оставить блокировку» when every selected receiver is already blocked. */
  blockLabel: Message;
  allowDesc: Message;
  /** Receivers the decision is sent for (checked, prompt order). */
  selected: string[];
  /** The decision buttons work (at least one receiver selected). */
  canDecide: boolean;
  blockingNotice: { message: Message; tone: 'attention' | 'neutral' } | null;
  /** warn-only: «Только предупреждать: ничего не блокировать» next to «Понятно». */
  modeNote: Message | null;
  counter: Message | null;
  counterNote: Message | null;
  notices: FirewallNoticeVM[];
  /** Receivers of the prompt still without a decision (live region; the badge counts the same in the SW). */
  pending: number;
}

function fieldsMessage(kinds: ReadonlyArray<FieldKind>): Message | MessageJoin {
  return kinds.length === 0 ? msg('fw_data_typed') : joinMessages(kinds.map((k) => msg(FIELD_KIND_KEYS[k])));
}

const CONFIDENCE_ORDER: Readonly<Record<string, number>> = { high: 0, medium: 1, low: 2 };

/** The most telling transfer record of `receiver` in the projection: before submit first, then confidence, then latest. */
export function bestEvidenceFor(report: ProtectProjection, receiver: string): ProtectTransferEvidence | null {
  let best: ProtectTransferEvidence | null = null;
  for (const e of report.evidence) {
    if (!isShowableTransfer(e) || e.receiver !== receiver) continue;
    if (best === null) {
      best = e;
      continue;
    }
    const a = e.transferClass === 'third-party-before-submit' ? 0 : 1;
    const b = best.transferClass === 'third-party-before-submit' ? 0 : 1;
    if (a !== b) {
      if (a < b) best = e;
      continue;
    }
    const ca = CONFIDENCE_ORDER[e.interpretationConfidence] ?? 3;
    const cb = CONFIDENCE_ORDER[best.interpretationConfidence] ?? 3;
    if (ca !== cb) {
      if (ca < cb) best = e;
      continue;
    }
    if (e.lastSecond > best.lastSecond) best = e;
  }
  return best;
}

function senderRow(sender: FirewallSender | undefined, site: string): FirewallRowVM {
  let value: Message;
  if (sender === undefined || sender.frame === 'top') value = msg('fw_sender_top', sender?.initiatorSite ?? site);
  else value = sender.initiatorSite !== null ? msg('fw_sender_frame', sender.initiatorSite) : msg('fw_sender_frame_unknown');
  const script = sender?.attributionConfidence === 'sampled-stack' && sender.script?.kind === 'external' && typeof sender.script.host === 'string' ? sender.script.host : null;
  // The script is named only from a sampled stack (page-controlled, said so); otherwise the evidence says it is unknown.
  return { id: 'sender', label: msg('fw_row_sender'), value, extra: script === null ? null : msg('fw_sender_script_sampled', script) };
}

function dataValue(kinds: ReadonlyArray<FieldKind>, e: ProtectTransferEvidence | null): FirewallText {
  const data = fieldsMessage(kinds);
  if (e !== null) {
    switch (e.location) {
      case 'query':
      case 'body-form':
      case 'body-json':
        if (e.paramName !== undefined) return msg('fw_data_param', data, e.paramName);
        break;
      case 'path':
        return msg('fw_data_path', data);
      case 'body-text':
        return msg('fw_data_body', data);
      default:
        break;
    }
  }
  return data;
}

/** «Момент» of the shown transfer record (the receiver view's latest one when this report holds no record). */
function momentValue(source: { submitTiming: SubmitTiming; sinceInput?: SinceInput } | undefined): Message | MessageJoin {
  const parts: Message[] = [msg(SUBMIT_TIMING_KEYS[source?.submitTiming ?? 'unknown'])];
  if (source?.sinceInput !== undefined) parts.push(msg(SINCE_INPUT_KEYS[source.sinceInput]));
  return parts.length === 1 ? parts[0]! : joinMessages(parts, ' · ');
}

function evidenceView(e: ProtectTransferEvidence | null): FirewallEvidenceVM | null {
  if (e === null) return null;
  const lines: Message[] = [];
  lines.push(msg('fw_ev_kind', msg(KIND_SET.has(e.requestKind) ? REQUEST_KIND_KEYS[e.requestKind] : 'fw_req_kind_other')));
  const where = whereMessage(e);
  if (where !== null) lines.push(where);
  if (e.encodings.length > 0) lines.push(msg('fw_ev_encoding', joinMessages(e.encodings.map(encodingMessage))));
  lines.push(msg('fw_ev_match', msg(FIELD_KIND_KEYS[e.fieldKind])));
  if (e.encodings.some(isHashEncodingCode)) lines.push(msg('protect_hash_note'));
  lines.push(msg('confidence_' + e.interpretationConfidence));
  lines.push(msg('integrity_derived'));
  const host = e.endpointHost ?? e.receiver ?? '';
  return { request: e.method + ' ' + host + e.endpointPathTemplate, lines };
}

function noticeView(notice: FirewallNotice, site: string): FirewallNoticeVM {
  const key = FIREWALL_NOTICE_KEYS[notice.kind];
  const count = notice.count ?? 1;
  let message: Message;
  switch (notice.kind) {
    case 'strict-auto':
      message = msg(key, notice.receiver, notice.site ?? site);
      break;
    case 'strict-escalate':
    case 'bypass':
      message = msg(key, notice.receiver, count);
      break;
    default:
      message = msg(key, notice.receiver);
  }
  return { kind: notice.kind, message, undoId: notice.kind === 'strict-auto' ? (notice.undoId ?? null) : null };
}

/**
 * ADR-020 §11 guard: a strict-auto notice says «теперь останавливаются», so it is shown only while enforcement is
 * active and the receiver's effective rule (when the projection names the receiver) blocks. Otherwise nothing claims a
 * stop: the card's blocking notice (degraded / restart / unavailable) explains why blocking does not act.
 */
export function firewallNoticeShown(notice: FirewallNotice, fw: FirewallTabView): boolean {
  if (notice.kind !== 'strict-auto') return true;
  if (fw.enforcement !== 'active') return false;
  const view = fw.receivers.find((r) => r.receiver === notice.receiver);
  return view === undefined || view.effectiveRule?.action === 'block';
}

/** Notices of the tab (shown with the card, or alone when there is no prompt). */
export function firewallNotices(report: ProtectProjection | null): FirewallNoticeVM[] {
  if (report === null) return [];
  const fw = readFirewallView(report.firewall);
  if (fw === null) return [];
  return fw.notices.filter((n) => firewallNoticeShown(n, fw)).map((n) => noticeView(n, report.site ?? n.site ?? ''));
}

function modeOf(fw: FirewallTabView): FirewallCardMode {
  if (fw.enforcement === 'warn-only') return 'ack';
  if (fw.enforcement === 'no-permission' || fw.enforcement === 'off') return 'unavailable';
  return 'decide';
}

function blockingNotice(fw: FirewallTabView, mode: FirewallCardMode): FirewallCardVM['blockingNotice'] {
  if (mode === 'unavailable') return { message: msg('fw_blocking_unavailable'), tone: 'attention' };
  if (fw.enforcement !== 'degraded') return null;
  // SP-1: rule writes complete only after the browser restarts with the grant.
  if (fw.degradedCode === 'api-unavailable') return { message: msg('fw_blocking_restart'), tone: 'attention' };
  return { message: msg('fw_blocking_degraded'), tone: 'attention' };
}

/**
 * The card of the shown tab's firewall prompt, or null (no prompt, firewall feature off, module not running, snoozed,
 * malformed data). `draft` holds the user's scope and unchecked receivers.
 */
export function firewallCardView(state: ProtectState | null, report: ProtectProjection | null, draft: FirewallDraft = EMPTY_FIREWALL_DRAFT): FirewallCardVM | null {
  if (state === null || report === null || !state.features.includes('firewall')) return null;
  if (state.state !== 'active' && state.state !== 'degraded') return null;
  const fw = readFirewallView(report.firewall);
  if (fw === null || fw.prompt === null || fw.snoozedUntil !== null) return null;
  const prompt = fw.prompt;
  const site = prompt.site;
  const views = new Map(fw.receivers.map((v) => [v.receiver, v]));
  const receivers: FirewallReceiverVM[] = prompt.receivers.map((receiver) => {
    const view = views.get(receiver);
    const alert = receiverAlertState(view, fw.enforcement, bestEvidenceFor(report, receiver)?.deliveryState ?? null);
    return {
      receiver,
      state: alert,
      stateLabel: msg(FIREWALL_STATE_KEYS[alert]),
      checked: !draft.unchecked.includes(receiver),
      blocked: view?.effectiveRule?.action === 'block',
    };
  });
  const selected = receivers.filter((r) => r.checked).map((r) => r.receiver);
  const primary = selected[0] ?? prompt.receivers[0]!;
  const view = views.get(primary);
  // The alert, «Что ушло / Что найдено», «Момент» and the evidence describe one transfer record: the request in which
  // the value was found. Its field kinds are those found in requests with the same delivery (a kind found only in a
  // request that was not sent is never said to be sent); without a record in this report, the receiver's kinds under
  // the unknown alert («найдено»).
  const evidence = bestEvidenceFor(report, primary);
  const alertState = receiverAlertState(view, fw.enforcement, evidence?.deliveryState ?? null);
  const kinds = evidence === null ? (view?.fieldKinds ?? []) : matchedKinds(report, primary, evidence.deliveryState);
  const data = fieldsMessage(kinds);
  let alertMessage: Message;
  if (alertState === 'stopped') alertMessage = msg('fw_alert_stopped', primary);
  else if (alertState === 'sent') alertMessage = msg(evidence?.submitTiming === 'before-submit' ? 'fw_alert_sent_before_submit' : 'fw_alert_sent', primary, data);
  else alertMessage = msg('fw_alert_unknown', primary, data);
  const chips: Message[] = [...(view?.fieldKinds ?? []).map((k) => msg(FIELD_KIND_KEYS[k])), ...(view?.encodings ?? []).map(encodingMessage)];
  const vendor = view?.vendorId !== undefined && view.vendorConfidence !== 'none' ? view.vendorId : null;
  const rows: FirewallRowVM[] = [
    senderRow(view?.sender, site),
    vendor === null
      ? { id: 'company', label: msg('fw_row_company'), value: msg('fw_company_not_checked'), extra: null }
      : { id: 'company', label: msg('fw_row_company'), value: vendor, extra: msg('fw_company_no_trust') },
    { id: 'receiver', label: msg('fw_row_receiver'), value: primary, extra: null },
    { id: 'data', label: msg(alertState === 'sent' ? 'fw_row_data' : 'fw_row_data_found'), value: dataValue(kinds, evidence), extra: null },
    { id: 'moment', label: msg('fw_row_moment'), value: momentValue(evidence ?? view), extra: null },
  ];
  const scope = SCOPE_SET.has(draft.scope) ? draft.scope : FIREWALL_DEFAULT_SCOPE;
  const scopeReceiver: string | MessageJoin = selected.length > 1 ? joinMessages(selected) : primary;
  const scopes: FirewallScopeVM[] = DECISION_SCOPES.map((s) => ({
    scope: s,
    label: msg(FIREWALL_SCOPE_KEYS[s].label),
    desc: s === 'site' ? msg(FIREWALL_SCOPE_KEYS[s].desc, site) : s === 'everywhere' ? msg(FIREWALL_SCOPE_KEYS[s].desc, scopeReceiver) : msg(FIREWALL_SCOPE_KEYS[s].desc),
  }));
  const mode = modeOf(fw);
  const allBlocked = selected.length > 0 && selected.every((r) => views.get(r)?.effectiveRule?.action === 'block');
  const count = fw.stoppedToday.count;
  return {
    promptId: prompt.promptId,
    documentKey: report.documentKey,
    protectRevision: report.protectRevision,
    site,
    title: prompt.receivers.length > 1 ? msg('fw_card_title_multi', prompt.receivers.length + prompt.hidden) : msg('fw_card_title'),
    siteLine: msg('fw_card_site', site),
    primary,
    alert: { state: alertState, tone: alertState === 'sent' ? 'attention' : 'neutral', message: alertMessage },
    note: alertState === 'stopped' ? null : msg('fw_sent_note'),
    chips,
    rows,
    evidence: evidenceView(evidence),
    scriptNote: rows[0]!.extra === null ? msg('fw_sender_script_unknown') : null,
    receivers,
    hidden: prompt.hidden > 0 ? msg('fw_receivers_hidden', prompt.hidden) : null,
    scope,
    scopes,
    scopeNote: msg('fw_scope_no_vendor'),
    ruleEffect: msg('fw_rule_effect'),
    mode,
    blockLabel: msg(allBlocked ? 'fw_action_keep_blocked' : 'fw_action_block_next'),
    allowDesc: msg('fw_action_allow_desc'),
    selected,
    canDecide: selected.length > 0,
    blockingNotice: blockingNotice(fw, mode),
    modeNote: mode === 'ack' ? msg('protect_preset_warn_only') : null,
    counter: count > 0 ? msg('fw_counter_today', count) : null,
    counterNote: count > 0 ? msg('fw_counter_note') : null,
    notices: fw.notices.filter((n) => firewallNoticeShown(n, fw)).map((n) => noticeView(n, site)),
    pending: receivers.filter((r) => views.get(r.receiver)?.effectiveRule == null).length,
  };
}

/** Live-region text of the card (throttled by the component, ANNOUNCE_MIN_INTERVAL_MS). */
export function firewallLiveText(card: FirewallCardVM | null): Message | null {
  return card === null || card.pending === 0 ? null : msg('fw_live_pending', card.pending);
}

// ---------------------------------------------------------------------------
// Snooze line (prompts hidden; rules keep applying)
// ---------------------------------------------------------------------------

/** Epoch ms until which prompts are hidden, or null (only while the firewall feature is on). */
export function firewallSnoozedUntil(state: ProtectState | null, now: number): number | null {
  if (state === null || !state.features.includes('firewall')) return null;
  if (state.state !== 'active' && state.state !== 'degraded') return null;
  return state.snoozedUntil !== null && state.snoozedUntil > now ? state.snoozedUntil : null;
}

// ---------------------------------------------------------------------------
// Decision outcome
// ---------------------------------------------------------------------------

export interface FirewallResolution {
  kind: 'decided' | 'dismissed';
  action: FirewallAction | null;
  scope: DecisionScope | null;
  receivers: string[];
  /** Per receiver: a DNR rule is in effect (false: stored but not in effect — never claim blocking then). */
  applied: Array<{ receiver: string; ruleApplied: boolean }>;
  undoId: string | null;
  /** SP-1: enforcement was degraded with api-unavailable when the decision was taken. */
  restart: boolean;
}

export interface FirewallResolvedVM {
  title: Message;
  lines: Message[];
  tone: 'neutral' | 'error';
  undo: boolean;
}

/** Reads `protect-decision.applied` (SW answer): domain names and booleans only, bounded. */
export function readDecisionAnswer(value: unknown): { applied: Array<{ receiver: string; ruleApplied: boolean }>; undoId: string | null } | null {
  if (!isRecord(value) || value['type'] !== 'protect-decision' || !Array.isArray(value['applied'])) return null;
  const applied: Array<{ receiver: string; ruleApplied: boolean }> = [];
  for (const a of value['applied'].slice(0, PROTECT_BUDGETS.maxPromptReceivers)) {
    if (!isRecord(a) || !isDomainName(a['receiver']) || typeof a['ruleApplied'] !== 'boolean') return null;
    applied.push({ receiver: a['receiver'], ruleApplied: a['ruleApplied'] });
  }
  const undoId = value['undoId'];
  if (undoId !== null && (typeof undoId !== 'string' || !UNDO_ID_PATTERN.test(undoId))) return null;
  return { applied, undoId };
}

export function firewallResolvedView(r: FirewallResolution): FirewallResolvedVM {
  if (r.kind === 'dismissed') return { title: msg('fw_resolved_dismissed'), lines: [], tone: 'neutral', undo: false };
  const failed = r.applied.filter((a) => !a.ruleApplied).map((a) => a.receiver);
  const ok = r.receivers.filter((x) => !failed.includes(x));
  const lines: Message[] = [];
  const undo = r.undoId !== null;
  if (r.action === 'block') {
    if (ok.length === 0) {
      const title = msg('fw_resolved_error', joinMessages(failed.length > 0 ? failed : r.receivers));
      if (r.restart) lines.push(msg('fw_blocking_restart'));
      return { title, lines, tone: 'error', undo };
    }
    lines.push(msg('fw_resolved_blocked_desc', joinMessages(ok)));
    if (failed.length > 0) lines.push(msg('fw_resolved_error', joinMessages(failed)));
    if (failed.length > 0 && r.restart) lines.push(msg('fw_blocking_restart'));
    return { title: msg('fw_resolved_blocked_title'), lines, tone: failed.length > 0 ? 'error' : 'neutral', undo };
  }
  lines.push(msg('fw_action_allow_desc'));
  if (failed.length > 0) lines.push(msg(r.restart ? 'fw_blocking_restart' : 'fw_blocking_degraded'));
  return { title: msg('fw_resolved_allowed_title'), lines, tone: failed.length > 0 ? 'error' : 'neutral', undo };
}

/** Whether the shown projection is in the SP-1 state (a decision is stored, its rule waits for a browser restart). */
export function firewallNeedsRestart(report: ProtectProjection | null): boolean {
  if (report === null) return false;
  const fw = readFirewallView(report.firewall);
  return fw !== null && fw.enforcement === 'degraded' && fw.degradedCode === 'api-unavailable';
}
