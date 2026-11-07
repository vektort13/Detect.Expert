// ADR-020 §B, §D (S07): view model of the «Передача введённых данных» evidence (value-match / opaque-after-input).
// Pure; returns message keys. The data carries no value, hash, mask, value length, URL or query, so neither does the
// view (docs/ui-copy.md §6.14.B). Wording: «передача», never «утечка»; delivery strictly per ADR-020 §11 (a record
// says «остановлено» only when the SW says `stopped`); confidence and coverage always next to the list. The title of a
// record (class + recipient) is neutral about delivery: «Найдено в запросе к …», never «Отправлено» or «получил»
// (review round 2) — only the delivery line says what happened to the request.

import {
  COVERAGE_STATES,
  DELIVERY_STATES,
  FIELD_KINDS,
  HOST_CATEGORIES,
  PROTECT_LIMITATIONS,
  SINCE_INPUT,
  TRANSFER_CLASSES,
  VALUE_ENCODINGS,
  VALUE_LOCATIONS,
} from '@detect-expert/contracts';
import type {
  CoverageState,
  DeliveryState,
  FieldKind,
  HostCategory,
  ProtectLimitation,
  ProtectProjection,
  ProtectTransferEvidence,
  SinceInput,
  TransferClass,
  ValueEncoding,
} from '@detect-expert/contracts';
import { severityOf } from '@detect-expert/engine';
import type { TransferSeverity } from '@detect-expert/engine';
import { msg } from './message';
import type { Message } from './message';
import { protectCoverageMessage } from './protect';

/** Popup: at most this many records (the side panel shows all of them). */
export const POPUP_EVIDENCE_LIMIT = 5;

export const TRANSFER_CLASS_KEYS: Readonly<Record<TransferClass, string>> = {
  'third-party-before-submit': 'protect_leak_class_third_party_before_submit',
  'third-party-at-submit': 'protect_leak_class_third_party_at_submit',
  'third-party-moment-unknown': 'protect_leak_class_third_party_moment_unknown',
  'first-party-before-submit': 'protect_leak_class_first_party_before_submit',
  'receiver-unknown': 'protect_leak_class_receiver_unknown',
  'opaque-after-input': 'protect_leak_class_opaque_after_input',
};

export const FIELD_KIND_KEYS: Readonly<Record<FieldKind, string>> = {
  email: 'protect_field_email',
  phone: 'protect_field_phone',
  name: 'protect_field_name',
};

export const SINCE_INPUT_KEYS: Readonly<Record<SinceInput, string>> = {
  'before-value': 'protect_since_before_value',
  'lt-1s': 'protect_since_lt_1s',
  '1-5s': 'protect_since_1_5s',
  '5-30s': 'protect_since_5_30s',
  'gt-30s': 'protect_since_gt_30s',
};

export const DELIVERY_KEYS: Readonly<Record<DeliveryState, string>> = {
  sent: 'protect_delivery_sent',
  stopped: 'protect_delivery_stopped',
  'stopped-other': 'protect_delivery_stopped_other',
  unknown: 'protect_delivery_unknown',
};

/** Limitation codes of transfer evidence with their own text (others are not shown on a record). */
export const EVIDENCE_LIMITATION_KEYS: Readonly<Partial<Record<ProtectLimitation, string>>> = {
  'body-truncated': 'protect_limit_body_truncated',
  'body-opaque': 'protect_limit_body_opaque',
  'body-unavailable': 'protect_limit_body_unavailable',
  'body-had-credential-fields': 'protect_limit_credential_fields',
  'name-plaintext-ambiguous': 'protect_limit_name_plaintext',
  'value-from-previous-document': 'protect_limit_previous_document',
  'matched-in-recent-request': 'protect_limit_recent_request',
  'submit-moment-unknown': 'protect_limit_submit_unknown',
  'receiver-hosts-form-frame': 'protect_limit_receiver_hosts_form',
  'party-by-registrable-domain': 'protect_limit_entity',
};

/** Document-level limitations of the projection shown next to the list. */
export const LIST_LIMITATION_KEYS: Readonly<Partial<Record<ProtectLimitation, string>>> = {
  'values-suspended-payment': 'protect_limit_payment_suspended',
  'never-read-fields': 'protect_limit_never_read',
  'values-reset': 'protect_limit_values_reset',
  // Review COV-02: the module's memory budget overflowed (records, fingerprints or bodies dropped).
  'budget-exceeded': 'protect_limit_budget_exceeded',
};

const HASH_LABELS: Readonly<Record<string, string>> = { md5: 'MD5', sha1: 'SHA-1', sha256: 'SHA-256', sha512: 'SHA-512' };

export function encodingMessage(enc: ValueEncoding): Message {
  switch (enc) {
    case 'plain':
      return msg('protect_enc_plain');
    case 'plain-normalized':
      return msg('protect_enc_plain_normalized');
    case 'url-encoded':
      return msg('protect_enc_url_encoded');
    case 'base64':
      return msg('protect_enc_base64');
    case 'in-base64-container':
      return msg('protect_enc_in_base64_container');
    default: {
      const dash = enc.indexOf('-');
      const algo = HASH_LABELS[enc.slice(0, dash)] ?? enc.slice(0, dash);
      return msg(enc.endsWith('-hex') ? 'protect_enc_hash_hex' : 'protect_enc_hash_base64', algo);
    }
  }
}

export function isHashEncodingCode(enc: ValueEncoding): boolean {
  return enc.endsWith('-hex') || (enc.endsWith('-base64') && enc !== 'base64' && enc !== 'in-base64-container');
}

export function hostCategoryMessage(category: HostCategory): Message {
  return msg('host_category_' + category.toLowerCase().replace(/-/g, '_'));
}

/** Who received it: the registrable domain, or the category of an address without one. */
function receiverPart(e: ProtectTransferEvidence): string | Message {
  if (typeof e.receiver === 'string') return e.receiver;
  return hostCategoryMessage(e.receiverCategory ?? 'unknown');
}

/** Title of a record: the transfer class and the recipient; says nothing about delivery (see the delivery line). */
export function classMessage(e: ProtectTransferEvidence): Message {
  const key = TRANSFER_CLASS_KEYS[e.transferClass];
  switch (e.transferClass) {
    case 'first-party-before-submit':
      return msg(key);
    case 'receiver-unknown':
      return msg(key, hostCategoryMessage(e.receiverCategory ?? 'unknown'));
    default:
      return msg(key, receiverPart(e));
  }
}

export function whereMessage(e: ProtectTransferEvidence): Message | null {
  switch (e.location) {
    case 'query':
      return e.paramName !== undefined ? msg('protect_where_param', e.paramName) : msg('protect_where_query');
    case 'path':
      return e.pathSegment !== undefined ? msg('protect_where_path', e.pathSegment + 1) : msg('protect_where_path_any');
    case 'body-form':
      return e.paramName !== undefined ? msg('protect_where_body_form', e.paramName) : msg('protect_where_body_text');
    case 'body-json':
      return e.paramName !== undefined ? msg('protect_where_body_json', e.paramName) : msg('protect_where_body_text');
    case 'body-text':
      return msg('protect_where_body_text');
    case 'body-opaque':
      return msg('protect_where_opaque');
  }
  return null;
}

export function endpointMessage(e: ProtectTransferEvidence): Message {
  const host: string | Message = e.endpointHost ?? receiverPart(e);
  return msg('protect_endpoint', host, e.endpointPathTemplate, e.method);
}

export interface EvidenceRowVM {
  id: string;
  severity: TransferSeverity;
  title: Message;
  field: Message;
  encodings: Message[];
  /** A hash was involved: «a hash does not hide the value» note. */
  hashNote: boolean;
  where: Message | null;
  endpoint: Message;
  since: Message | null;
  delivery: Message;
  deliveryState: DeliveryState;
  confidence: Message;
  /** Requests counted for this record (lower bound) when more than one. */
  count: Message | null;
  limitations: Message[];
}

const SEVERITY_ORDER: Readonly<Record<TransferSeverity, number>> = { high: 0, medium: 1, low: 2, info: 3 };
const CLASS_SET: ReadonlySet<string> = new Set(TRANSFER_CLASSES);
const FIELD_SET: ReadonlySet<string> = new Set(FIELD_KINDS);
const ENC_SET: ReadonlySet<string> = new Set(VALUE_ENCODINGS);
const LOC_SET: ReadonlySet<string> = new Set(VALUE_LOCATIONS);
const DELIVERY_SET: ReadonlySet<string> = new Set(DELIVERY_STATES);
const SINCE_SET: ReadonlySet<string> = new Set(SINCE_INPUT);
const CATEGORY_SET: ReadonlySet<string> = new Set(HOST_CATEGORIES);
const LIMITATION_SET: ReadonlySet<string> = new Set(PROTECT_LIMITATIONS);

/** A transfer record the view can show (the SW is trusted; anything malformed is skipped, never rendered raw). */
export function isShowableTransfer(e: unknown): e is ProtectTransferEvidence {
  if (typeof e !== 'object' || e === null) return false;
  const r = e as Record<string, unknown>;
  if (r['protectKind'] !== 'value-match' && r['protectKind'] !== 'opaque-after-input') return false;
  if (typeof r['evidenceId'] !== 'string' || !CLASS_SET.has(String(r['transferClass'])) || !FIELD_SET.has(String(r['fieldKind']))) return false;
  if (!Array.isArray(r['encodings']) || !r['encodings'].every((x) => typeof x === 'string' && ENC_SET.has(x))) return false;
  if (r['location'] !== undefined && !LOC_SET.has(String(r['location']))) return false;
  if (!DELIVERY_SET.has(String(r['deliveryState']))) return false;
  if (r['sinceInput'] !== undefined && !SINCE_SET.has(String(r['sinceInput']))) return false;
  if (r['receiver'] === undefined && !CATEGORY_SET.has(String(r['receiverCategory']))) return false;
  if (!['low', 'medium', 'high'].includes(String(r['interpretationConfidence']))) return false;
  if (typeof r['endpointPathTemplate'] !== 'string' || typeof r['method'] !== 'string') return false;
  return Array.isArray(r['limitationCodes']) && r['limitationCodes'].every((x) => typeof x === 'string' && LIMITATION_SET.has(x));
}

export function evidenceRow(e: ProtectTransferEvidence): EvidenceRowVM {
  const limitations: Message[] = [];
  for (const code of e.limitationCodes) {
    const key = EVIDENCE_LIMITATION_KEYS[code];
    if (key !== undefined) limitations.push(msg(key));
  }
  return {
    id: e.evidenceId,
    severity: severityOf(e.transferClass),
    title: classMessage(e),
    field: msg(FIELD_KIND_KEYS[e.fieldKind]),
    encodings: e.encodings.map(encodingMessage),
    hashNote: e.encodings.some(isHashEncodingCode),
    where: whereMessage(e),
    endpoint: endpointMessage(e),
    since: e.sinceInput !== undefined ? msg(SINCE_INPUT_KEYS[e.sinceInput]) : null,
    delivery: msg(DELIVERY_KEYS[e.deliveryState]),
    deliveryState: e.deliveryState,
    confidence: msg('confidence_' + e.interpretationConfidence),
    count: e.count > 1 ? msg('protect_leak_count', e.count) : null,
    limitations,
  };
}

export interface EvidenceListVM {
  rows: EvidenceRowVM[];
  /** Transfer records in the projection (all of them, before the popup limit). */
  total: number;
  /** Records not shown here (popup: see the side panel). */
  hidden: number;
  /** «Не наблюдалось в доступной области…» when there is nothing to show. */
  empty: Message | null;
  /** Coverage of the module for this page, next to the list. */
  coverage: Message | null;
  /** Document-level limitations and the fixed notes (unobserved channels, passwords). */
  notes: Message[];
  /** Document-level limitations only: the popup shows them next to the list (review COV-01, REQ-006). */
  docNotes: Message[];
  /** Records of earlier documents of this tab (count only). */
  previous: Message | null;
}

const COVERAGE_SET: ReadonlySet<string> = new Set(COVERAGE_STATES);

/**
 * Transfer evidence of the shown tab, most severe first, then the latest. `limit` (popup) cuts the list; `null` shows
 * everything (side panel). Null projection → null (nothing loaded yet).
 */
export function evidenceListView(report: ProtectProjection | null, limit: number | null): EvidenceListVM | null {
  if (report === null) return null;
  const transfers = report.evidence.filter(isShowableTransfer);
  const sorted = transfers
    .map((e, i) => ({ e, i }))
    .sort((a, b) => SEVERITY_ORDER[severityOf(a.e.transferClass)] - SEVERITY_ORDER[severityOf(b.e.transferClass)] || b.e.lastSecond - a.e.lastSecond || a.i - b.i)
    .map((x) => x.e);
  const shown = limit === null ? sorted : sorted.slice(0, limit);
  const coverageState: CoverageState | null = COVERAGE_SET.has(report.coverageState) ? report.coverageState : null;
  const docNotes: Message[] = [];
  for (const code of report.limitations) {
    const key = LIST_LIMITATION_KEYS[code];
    if (key !== undefined) docNotes.push(msg(key));
  }
  // Review COV-02: dropped counts without the limitation code (fingerprints evicted, bodies cut, messages throttled).
  const d = report.dropped;
  if (!report.limitations.includes('budget-exceeded') && (d.evidence > 0 || d.fingerprints > 0 || d.bodies > 0 || d.events > 0)) docNotes.push(msg('protect_limit_budget_exceeded'));
  const notes: Message[] = [...docNotes, msg('protect_limit_unobserved_channels'), msg('protect_password_note')];
  return {
    rows: shown.map(evidenceRow),
    total: sorted.length,
    hidden: sorted.length - shown.length,
    empty: sorted.length === 0 ? msg('protect_leak_empty') : null,
    // S09 follow-up: the same coverage text as the module status line (paused / late-start by their limitations).
    coverage: coverageState === null ? null : msg('protect_coverage_line', protectCoverageMessage(report)),
    notes,
    docNotes,
    previous: report.previousDocumentEvidence > 0 ? msg('protect_leak_previous', report.previousDocumentEvidence) : null,
  };
}
