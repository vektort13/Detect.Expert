// ADR-020 §I: personal data requests (access, erasure, objection, opt-out) drafted locally; the user sends them. The
// journal lives in the module's IndexedDB (`requests`, SW is the only writer). The contract has no field for the user's
// identifier, name or the letter text: only kinds, domains, days, enums and the recipient contact (company address from
// the reviewed table or typed by the user). A value typed on a site is never put into a letter.

import type { EvidenceSource, Integrity, InterpretationConfidence, TechniqueId } from './enums';
import { isDomainName } from './protect';
import type { FieldKind, ScriptRef, SubmitTiming, ValueEncoding, ValueLocation } from './protect';

/** A calendar day `YYYY-MM-DD` (local calendar for the journal, UTC for the history), year 2000–2999. */
export type LocalDay = string;

const LOCAL_DAY_RE = /^(2[0-9]{3})-([0-9]{2})-([0-9]{2})$/;

/** True for a real calendar day `YYYY-MM-DD` with a year 2000–2999. */
export function isLocalDay(value: unknown): value is LocalDay {
  if (typeof value !== 'string' || value.length !== 10) return false;
  const m = LOCAL_DAY_RE.exec(value);
  if (m === null) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = month === 2 ? (leap ? 29 : 28) : month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
  return day <= days;
}

export const REQUEST_JURISDICTIONS = ['gdpr-eu-eea', 'gdpr-uk', 'ccpa-ca', 'pdl-ru-152'] as const;
export type RequestJurisdiction = (typeof REQUEST_JURISDICTIONS)[number];

export const REQUEST_KINDS = ['access', 'erasure', 'objection', 'opt-out-sale-sharing'] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

/** Requests each law provides for (template articles; legal review pending). */
export const JURISDICTION_REQUEST_KINDS: Readonly<Record<RequestJurisdiction, readonly RequestKind[]>> = {
  'gdpr-eu-eea': ['access', 'erasure', 'objection'],
  'gdpr-uk': ['access', 'erasure', 'objection'],
  'ccpa-ca': ['access', 'erasure', 'opt-out-sale-sharing'],
  'pdl-ru-152': ['access', 'erasure'],
};

export const REQUEST_LETTER_LANGS = ['ru', 'en'] as const;
export type RequestLetterLang = (typeof REQUEST_LETTER_LANGS)[number];

/** Letter languages of the templates per law. */
export const JURISDICTION_LETTER_LANGS: Readonly<Record<RequestJurisdiction, readonly RequestLetterLang[]>> = {
  'gdpr-eu-eea': ['en', 'ru'],
  'gdpr-uk': ['en', 'ru'],
  'ccpa-ca': ['en'],
  'pdl-ru-152': ['ru'],
};

export const REQUEST_STATUSES = ['prepared', 'sent', 'extended', 'answered', 'complaint-filed', 'closed'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** Statuses are set by the user (the extension does not observe sending, delivery or answers). `closed` is terminal. */
export const REQUEST_STATUS_TRANSITIONS: Readonly<Record<RequestStatus, readonly RequestStatus[]>> = {
  prepared: ['sent', 'closed'],
  sent: ['extended', 'answered', 'complaint-filed', 'closed'],
  extended: ['answered', 'complaint-filed', 'closed'],
  answered: ['complaint-filed', 'closed'],
  'complaint-filed': ['closed'],
  closed: [],
};

export function canTransitionRequest(from: RequestStatus, to: RequestStatus): boolean {
  return REQUEST_STATUS_TRANSITIONS[from].includes(to);
}

export const REQUEST_FACT_KINDS = ['value-match', 'opaque-after-input', 'password-field-listener', 'session-replay', 'cross-site-sighting'] as const;
export type RequestFactKind = (typeof REQUEST_FACT_KINDS)[number];

/** Where a draft starts: an evidence record, a history row, or nothing (manual). */
export const REQUEST_SOURCE_KINDS = ['evidence', 'history', 'manual'] as const;
export type RequestSourceKind = (typeof REQUEST_SOURCE_KINDS)[number];

/** How the user identifies themself in the letter: kinds only, the values are never stored or sent to the SW. */
export const REQUEST_IDENTITY_KINDS = ['sender-address', 'typed-identifier', 'typed-name'] as const;
export type RequestIdentityKind = (typeof REQUEST_IDENTITY_KINDS)[number];

export const RECIPIENT_SOURCES = ['table', 'manual', 'none'] as const;
export type RecipientSource = (typeof RECIPIENT_SOURCES)[number];

export const RECIPIENT_CHANNELS = ['email', 'portal'] as const;
export type RecipientChannel = (typeof RECIPIENT_CHANNELS)[number];

/** How the user sends the letter: their mail program (mailto:), the clipboard, or the company's form. */
export const REQUEST_DELIVERIES = ['mailto', 'copy', 'portal'] as const;
export type RequestDelivery = (typeof REQUEST_DELIVERIES)[number];

export const REQUEST_SUBJECT_ROLES = ['receiver', 'site'] as const;
export type RequestSubjectRole = (typeof REQUEST_SUBJECT_ROLES)[number];

export const REQUEST_ENDPOINT_SCHEMES = ['https', 'http', 'wss', 'ws'] as const;
export type RequestEndpointScheme = (typeof REQUEST_ENDPOINT_SCHEMES)[number];

export const REQUEST_VIEWS = ['summary', 'full'] as const;
export type RequestView = (typeof REQUEST_VIEWS)[number];

/** `rq_` + 20 base32 characters from crypto.getRandomValues in the SW. */
export const REQUEST_ID_PATTERN = /^rq_[a-z2-7]{20}$/;
export const CONTACT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const TEMPLATE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const TEMPLATE_VERSION_PATTERN = /^[A-Za-z0-9.-]{1,32}$/;

const EMAIL_LOCAL_RE = /^[A-Za-z0-9._+-]{1,64}$/;

/**
 * Recipient e-mail for a mailto: link: local part [A-Za-z0-9._+-]{1,64} (no leading/trailing or double dot), one `@`,
 * a lowercase punycode domain; at most 254 characters. No spaces, CR/LF, `?`, `&`, `#`, `%` or commas by construction.
 */
export function isRequestEmail(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 6 || value.length > 254) return false;
  const at = value.indexOf('@');
  if (at < 1 || at !== value.lastIndexOf('@')) return false;
  const local = value.slice(0, at);
  if (!EMAIL_LOCAL_RE.test(local) || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  return isDomainName(value.slice(at + 1));
}

const PORTAL_CHARS_RE = /^https:\/\/[A-Za-z0-9._~:/!$'()*+,;=@-]+$/;

/** Company request form: canonical https URL without userinfo, port, query or fragment; at most 512 characters. */
export function isPortalUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 12 || value.length > 512 || !PORTAL_CHARS_RE.test(value)) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    url.username === '' &&
    url.password === '' &&
    url.port === '' &&
    url.search === '' &&
    url.hash === '' &&
    url.href === value &&
    isDomainName(url.hostname)
  );
}

const NOT_BLANK_RE = /\S/;

/** Company name: 1..128 characters, not blank, no control, line-separator, bidi-override or lone surrogate characters. */
export function isEntityName(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128 || !NOT_BLANK_RE.test(value)) return false;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029 || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069)) return false;
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < value.length ? value.charCodeAt(i + 1) : 0;
      if (next < 0xdc00 || next > 0xdfff) return false;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/** Request address without query or fragment: scheme, host (DNS name), endpoint path template. */
export interface RequestEndpoint {
  scheme: RequestEndpointScheme;
  host: string;
  pathTemplate: string;
}

/** One observation quoted in a letter; copied by allowlist from ProtectEvidence or a history row (no value). */
export interface RequestEvidenceFact {
  factKind: RequestFactKind;
  day: LocalDay;
  /** Registrable domain of the site. */
  site: string;
  receiverDomain: string | null;
  endpoint: RequestEndpoint | null;
  script: ScriptRef | null;
  dataKind: FieldKind | null;
  encoding: ValueEncoding | null;
  location: ValueLocation | null;
  parameterName: string | null;
  submitTiming: SubmitTiming | null;
  /** At most PROTECT_WIRE_LIMITS.maxTechniquesPerFact. */
  techniqueIds: TechniqueId[];
  vendorId: string | null;
  evidenceSource: EvidenceSource;
  integrity: Integrity;
  interpretationConfidence: InterpretationConfidence;
}

/** Who the letter is addressed to: the receiver or the site (a company name the user confirms or types). */
export interface RequestSubject {
  role: RequestSubjectRole;
  vendorId: string | null;
  /** Registrable domain, or null when typed by the user without a domain. */
  domain: string | null;
  entityName: string;
}

/** Recipient contact of the company: from the reviewed table, typed by the user (e-mail only), or none (copy only). */
export type RecipientRef =
  | { source: 'table'; contactId: string; contactsVersion: string; channel: RecipientChannel; address: string }
  | { source: 'manual'; channel: 'email'; address: string }
  | { source: 'none' };

export interface NewRequestInput {
  sourceKind: RequestSourceKind;
  jurisdiction: RequestJurisdiction;
  /** 1..3, a subset of JURISDICTION_REQUEST_KINDS[jurisdiction]. */
  kinds: RequestKind[];
  /** One of JURISDICTION_LETTER_LANGS[jurisdiction]. */
  letterLang: RequestLetterLang;
  templateId: string;
  templateVersion: string;
  subject: RequestSubject;
  recipient: RecipientRef;
  /** 0..PROTECT_BUDGETS.maxFactsPerRequest; empty for a manual request. */
  facts: RequestEvidenceFact[];
  /** Exactly one of sender-address / typed-identifier, plus optionally typed-name. Kinds only. */
  identityKinds: RequestIdentityKind[];
  delivery: RequestDelivery;
  mentionGpc: boolean;
}

export interface RequestHistoryEntry {
  status: RequestStatus;
  day: LocalDay;
}

export interface DeletionRequestRecord extends NewRequestInput {
  requestId: string;
  createdDay: LocalDay;
  status: RequestStatus;
  statusDay: LocalDay;
  sentDay: LocalDay | null;
  deadlineDay: LocalDay | null;
  extendedDeadlineDay: LocalDay | null;
  /** At most PROTECT_BUDGETS.maxHistoryPerRequest. */
  history: RequestHistoryEntry[];
}

export interface RequestPrefs {
  jurisdiction: RequestJurisdiction | null;
  letterLang: RequestLetterLang | null;
}

/** Hydrated journal (IDB `requests` + meta `requests-state`); validated by validateStoredRequestJournal. */
export interface StoredRequestJournal {
  v: 1;
  revision: number;
  prefs: RequestPrefs;
  /** At most PROTECT_BUDGETS.maxRequests, ≤ maxRecordChars each, ≤ maxJournalChars together. */
  requests: DeletionRequestRecord[];
}

export interface RequestJournalSummary {
  total: number;
  open: number;
  dueSoon: number;
  overdue: number;
}

/** A reviewed contact of the privacy-contacts table (empty in production until reviewed). */
export interface RecipientCandidate {
  contactId: string;
  contactsVersion: string;
  entityName: string;
  channel: RecipientChannel;
  /** E-mail (isRequestEmail) or form address (isPortalUrl). */
  address: string;
  jurisdictions: RequestJurisdiction[];
  /** When the reviewer read the public source of the contact (the source itself stays in the table, by contactId). */
  accessedAt: LocalDay;
  reviewedAt: LocalDay;
}

export interface RequestDraftContext {
  sourceKind: RequestSourceKind;
  /** The evidence or history row is gone (TTL, purge): the draft has no facts. */
  sourceMissing: boolean;
  /** Receiver and, when known, site; at most PROTECT_WIRE_LIMITS.maxSubjects. */
  subjects: RequestSubject[];
  /** At most PROTECT_BUDGETS.maxFactsPerRequest, by confidence and day. */
  facts: RequestEvidenceFact[];
  recipients: { receiver: RecipientCandidate[]; site: RecipientCandidate[] };
  prefs: RequestPrefs;
  gpcAvailable: boolean;
}

/**
 * Upper bound of the JSON characters a DeletionRequestRecord adds to its NewRequestInput (id, days, status, history ≤ 12).
 * A saved request must fit maxRecordChars minus this bound.
 */
export const REQUEST_RECORD_EXTRA_CHARS = 1024;
