// ADR-020 §I (S14): view model of the data-request page (requests.html), its popup reminder and Options section.
// Defensive readers of the SW answers (journal records go through validateStoredRequestJournal, draft facts through the
// request-save validator), the composer state and its NewRequestInput (kinds only: the identifier and the name typed on
// the page never enter it), journal rows (status, approximate deadline with its basis, allowed transitions) and the
// .ics / export texts. Pure: no chrome.*, no storage; the identifier and name are passed in as arguments and returned
// only inside the rendered letter.

import {
  CONTACT_ID_PATTERN,
  JURISDICTION_LETTER_LANGS,
  JURISDICTION_REQUEST_KINDS,
  MAX_COUNT,
  PROTECT_WIRE_LIMITS,
  RECIPIENT_CHANNELS,
  REQUEST_JURISDICTIONS,
  REQUEST_KINDS,
  REQUEST_SOURCE_KINDS,
  REQUEST_STATUS_TRANSITIONS,
  WIRE_CATALOG_VERSION_PATTERN,
  isDomainName,
  isEntityName,
  isLocalDay,
  isPortalUrl,
  isRequestEmail,
  validateProtectUiRequest,
  validateStoredRequestJournal,
} from '@detect-expert/contracts';
import type {
  DeletionRequestRecord,
  LocalDay,
  NewRequestInput,
  ProtectState,
  RecipientCandidate,
  RecipientRef,
  RequestDelivery,
  RequestDraftContext,
  RequestEvidenceFact,
  RequestJournalSummary,
  RequestJurisdiction,
  RequestKind,
  RequestLetterLang,
  RequestPrefs,
  RequestStatus,
  RequestSubject,
} from '@detect-expert/contracts';
import {
  REQUEST_MAILTO_SHORT_BODY,
  REQUEST_TEMPLATES,
  buildRequestIcs,
  canonicalRequestKinds,
  cleanTypedValue,
  renderRequestLetter,
  requestDueView,
  requestFactCheckedByDefault,
  requestIcsFileName,
  requestLocalDay,
  requestMailtoLink,
} from '@detect-expert/engine';
import type { RenderedRequestLetter, RequestDeadlineRuleId, RequestDueView, RequestIdentityChoice, RequestMailtoLink } from '@detect-expert/engine';
import { createRequestJournalExport, requestJournalExportFileName, serializeRequestJournalExport } from '../../../export/src/protect-requests';
import type { RequestJournalExport } from '../../../export/src/protect-requests';
import { msg } from './message';
import type { Message } from './message';

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

export interface RequestsJournalView {
  revision: number;
  summary: RequestJournalSummary;
  prefs: RequestPrefs;
  droppedRecords: number;
  /** null for a summary answer. */
  requests: DeletionRequestRecord[] | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function count(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_COUNT ? v : null;
}

/** A `protect-requests` answer, or null when anything is malformed. */
export function parseRequestsJournal(raw: unknown): RequestsJournalView | null {
  if (!isRecord(raw) || raw['type'] !== 'protect-requests') return null;
  const revision = count(raw['revision']);
  const dropped = count(raw['droppedRecords']);
  const s = raw['summary'];
  if (revision === null || dropped === null || !isRecord(s)) return null;
  const summary = { total: count(s['total']), open: count(s['open']), dueSoon: count(s['dueSoon']), overdue: count(s['overdue']) };
  if (summary.total === null || summary.open === null || summary.dueSoon === null || summary.overdue === null) return null;
  const items = raw['requests'];
  const checked = validateStoredRequestJournal({ v: 1, revision, prefs: raw['prefs'], requests: Array.isArray(items) ? items : [] });
  if (!checked.ok) return null;
  if (items !== undefined && (!Array.isArray(items) || checked.value.droppedRecords > 0)) return null;
  return {
    revision,
    summary: { total: summary.total, open: summary.open, dueSoon: summary.dueSoon, overdue: summary.overdue },
    prefs: checked.value.journal.prefs,
    droppedRecords: dropped,
    requests: items === undefined ? null : checked.value.journal.requests,
  };
}

const PROBE_INPUT: Omit<NewRequestInput, 'facts'> = {
  sourceKind: 'evidence',
  jurisdiction: 'gdpr-eu-eea',
  kinds: ['access'],
  letterLang: 'en',
  templateId: 'probe',
  templateVersion: '1',
  subject: { role: 'receiver', vendorId: null, domain: null, entityName: 'probe' },
  recipient: { source: 'none' },
  identityKinds: ['sender-address'],
  delivery: 'copy',
  mentionGpc: false,
};

/** A fact the contract accepts (checked by the request-save validator itself; a normalized copy). */
export function readRequestFact(raw: unknown): RequestEvidenceFact | null {
  const r = validateProtectUiRequest({ schemaVersion: 1, type: 'ui-protect-request-save', expectedRevision: 0, request: { ...PROBE_INPUT, facts: [raw] } });
  return r.ok && r.value.type === 'ui-protect-request-save' ? (r.value.request.facts[0] ?? null) : null;
}

function readSubject(raw: unknown): RequestSubject | null {
  if (!isRecord(raw)) return null;
  const role = raw['role'];
  const domain = raw['domain'];
  const entityName = raw['entityName'];
  if ((role !== 'receiver' && role !== 'site') || !(domain === null || isDomainName(domain)) || !isEntityName(entityName) || raw['vendorId'] !== null) return null;
  return { role, vendorId: null, domain, entityName };
}

function readCandidate(raw: unknown): RecipientCandidate | null {
  if (!isRecord(raw)) return null;
  const { contactId, contactsVersion, entityName, channel, address, accessedAt, reviewedAt, jurisdictions } = raw;
  if (typeof contactId !== 'string' || !CONTACT_ID_PATTERN.test(contactId) || typeof contactsVersion !== 'string' || !WIRE_CATALOG_VERSION_PATTERN.test(contactsVersion)) return null;
  if (!isEntityName(entityName) || typeof channel !== 'string' || !(RECIPIENT_CHANNELS as readonly string[]).includes(channel)) return null;
  if (channel === 'email' ? !isRequestEmail(address) : !isPortalUrl(address)) return null;
  if (!isLocalDay(accessedAt) || !isLocalDay(reviewedAt) || !Array.isArray(jurisdictions)) return null;
  const list = REQUEST_JURISDICTIONS.filter((j) => jurisdictions.includes(j));
  if (list.length === 0 || list.length !== jurisdictions.length) return null;
  return { contactId, contactsVersion, entityName, channel: channel as RecipientCandidate['channel'], address: address as string, jurisdictions: list, accessedAt, reviewedAt };
}

function readList<T>(raw: unknown, max: number, read: (x: unknown) => T | null): T[] | null {
  if (!Array.isArray(raw) || raw.length > max) return null;
  const out: T[] = [];
  for (const item of raw) {
    const v = read(item);
    if (v === null) return null;
    out.push(v);
  }
  return out;
}

/** A `protect-request-draft` answer, or null when anything is malformed. */
export function parseRequestDraft(raw: unknown): RequestDraftContext | null {
  if (!isRecord(raw) || raw['type'] !== 'protect-request-draft' || !isRecord(raw['draft'])) return null;
  const d = raw['draft'];
  const sourceKind = d['sourceKind'];
  if (typeof sourceKind !== 'string' || !(REQUEST_SOURCE_KINDS as readonly string[]).includes(sourceKind) || typeof d['sourceMissing'] !== 'boolean' || typeof d['gpcAvailable'] !== 'boolean') return null;
  const subjects = readList(d['subjects'], PROTECT_WIRE_LIMITS.maxSubjects, readSubject);
  const facts = readList(d['facts'], 8, readRequestFact);
  const recipients = d['recipients'];
  if (subjects === null || facts === null || !isRecord(recipients)) return null;
  const receiver = readList(recipients['receiver'], PROTECT_WIRE_LIMITS.maxRecipientCandidates, readCandidate);
  const site = readList(recipients['site'], PROTECT_WIRE_LIMITS.maxRecipientCandidates, readCandidate);
  const prefsCheck = validateStoredRequestJournal({ v: 1, revision: 0, prefs: d['prefs'], requests: [] });
  if (receiver === null || site === null || !prefsCheck.ok) return null;
  return {
    sourceKind: sourceKind as RequestDraftContext['sourceKind'],
    sourceMissing: d['sourceMissing'],
    subjects,
    facts,
    recipients: { receiver, site },
    prefs: prefsCheck.value.journal.prefs,
    gpcAvailable: d['gpcAvailable'],
  };
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

/** The composer and status changes need the active module; the journal is viewable whenever the module was used. */
export function requestsComposerAvailable(state: ProtectState | null): boolean {
  return state !== null && state.state === 'active';
}

/** Popup reminder: only while the module is active and something is due soon or overdue. */
export function reminderCounts(summary: RequestJournalSummary | null): { soon: number; overdue: number } | null {
  if (summary === null || summary.dueSoon + summary.overdue === 0) return null;
  return { soon: summary.dueSoon, overdue: summary.overdue };
}

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

/** Today in the page's local calendar. */
export function localToday(now: number = Date.now()): LocalDay | null {
  const d = new Date(now);
  return requestLocalDay(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export function formatRequestDay(day: LocalDay, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(day + 'T00:00:00Z'));
  } catch {
    return day;
  }
}

// ---------------------------------------------------------------------------
// Locale keys
// ---------------------------------------------------------------------------

export const REQUEST_LAW_KEYS: Readonly<Record<RequestJurisdiction, string>> = {
  'gdpr-eu-eea': 'protect_req_law_gdpr_eu_eea',
  'gdpr-uk': 'protect_req_law_gdpr_uk',
  'ccpa-ca': 'protect_req_law_ccpa_ca',
  'pdl-ru-152': 'protect_req_law_pdl_ru_152',
};

export const REQUEST_KIND_KEYS: Readonly<Record<RequestKind, string>> = {
  access: 'protect_req_kind_access',
  erasure: 'protect_req_kind_erasure',
  objection: 'protect_req_kind_objection',
  'opt-out-sale-sharing': 'protect_req_kind_opt_out',
};

export const REQUEST_LANG_KEYS: Readonly<Record<RequestLetterLang, string>> = { ru: 'protect_req_lang_ru', en: 'protect_req_lang_en' };

export const REQUEST_STATUS_KEYS: Readonly<Record<RequestStatus, string>> = {
  prepared: 'protect_req_status_prepared',
  sent: 'protect_req_status_sent',
  extended: 'protect_req_status_extended',
  answered: 'protect_req_status_answered',
  'complaint-filed': 'protect_req_status_complaint_filed',
  closed: 'protect_req_status_closed',
};

/** Action labels that move a record to a status. */
export const REQUEST_MARK_KEYS: Readonly<Record<Exclude<RequestStatus, 'prepared'>, string>> = {
  sent: 'protect_req_mark_sent',
  extended: 'protect_req_mark_extended',
  answered: 'protect_req_mark_answered',
  'complaint-filed': 'protect_req_mark_complaint_filed',
  closed: 'protect_req_mark_closed',
};

export const REQUEST_BASIS_KEYS: Readonly<Record<RequestDeadlineRuleId, string>> = {
  'gdpr-art-12-3': 'protect_req_basis_gdpr_art_12_3',
  'ccpa-1798-130': 'protect_req_basis_ccpa_1798_130',
  'ccpa-opt-out-15-business-days': 'protect_req_basis_ccpa_opt_out',
  'pdl-152-art-20': 'protect_req_basis_pdl_152_art_20',
};

export const REQUEST_DELIVERY_KEYS: Readonly<Record<RequestDelivery, string>> = {
  mailto: 'protect_req_delivery_mailto',
  copy: 'protect_req_delivery_copy',
  portal: 'protect_req_delivery_portal',
};

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

/** What the composer starts from: a draft of the SW, or a journal record («Повторить письмо»). */
export interface ComposerSource {
  sourceKind: RequestDraftContext['sourceKind'];
  sourceMissing: boolean;
  subjects: RequestSubject[];
  facts: RequestEvidenceFact[];
  recipients: { receiver: RecipientCandidate[]; site: RecipientCandidate[] };
  prefs: RequestPrefs;
  gpcAvailable: boolean;
  /** «Повторить письмо»: the recipient of the record. */
  previousRecipient: RecipientRef | null;
  /** «Повторить письмо»: the kinds of the record. */
  previousKinds: RequestKind[] | null;
}

export function composerSourceFromDraft(d: RequestDraftContext): ComposerSource {
  return { ...d, subjects: [...d.subjects], facts: [...d.facts], recipients: { receiver: [...d.recipients.receiver], site: [...d.recipients.site] }, previousRecipient: null, previousKinds: null };
}

/** «Повторить письмо»: the record's law, language, company, observations and recipient (the identity is typed again). */
export function composerSourceFromRecord(r: DeletionRequestRecord, gpcAvailable: boolean): ComposerSource {
  return {
    sourceKind: r.sourceKind,
    sourceMissing: false,
    subjects: [r.subject],
    facts: [...r.facts],
    recipients: { receiver: [], site: [] },
    prefs: { jurisdiction: r.jurisdiction, letterLang: r.letterLang },
    gpcAvailable,
    previousRecipient: r.recipient,
    previousKinds: [...r.kinds],
  };
}

export type RecipientChoice = { kind: 'table'; contactId: string } | { kind: 'previous' } | { kind: 'manual' } | { kind: 'none' };

export interface ComposerState {
  /** Index into source.subjects, or -1 for another company typed by the user. */
  subjectIndex: number;
  entityName: string;
  jurisdiction: RequestJurisdiction | null;
  kinds: RequestKind[];
  letterLang: RequestLetterLang;
  checked: boolean[];
  identity: RequestIdentityChoice;
  includeName: boolean;
  recipient: RecipientChoice;
  manualAddress: string;
  mentionGpc: boolean;
}

function defaultLang(jurisdiction: RequestJurisdiction | null, preferred: RequestLetterLang | null, uiLang: RequestLetterLang): RequestLetterLang {
  if (jurisdiction === null) return preferred ?? uiLang;
  const langs = JURISDICTION_LETTER_LANGS[jurisdiction];
  if (preferred !== null && langs.includes(preferred)) return preferred;
  return langs.includes(uiLang) ? uiLang : langs[0]!;
}

/** Kinds that make sense by default: erasure (and opt-out under CCPA). */
function defaultKinds(jurisdiction: RequestJurisdiction | null): RequestKind[] {
  if (jurisdiction === null) return ['erasure'];
  return jurisdiction === 'ccpa-ca' ? ['erasure', 'opt-out-sale-sharing'] : ['erasure'];
}

/** Candidates of the chosen subject usable under the law. */
export function recipientCandidates(source: ComposerSource, state: Pick<ComposerState, 'subjectIndex' | 'jurisdiction'>): RecipientCandidate[] {
  const subject = source.subjects[state.subjectIndex];
  if (subject === undefined || state.jurisdiction === null) return [];
  const list = subject.role === 'receiver' ? source.recipients.receiver : source.recipients.site;
  return list.filter((c) => c.jurisdictions.includes(state.jurisdiction!));
}

function defaultRecipient(source: ComposerSource, state: Pick<ComposerState, 'subjectIndex' | 'jurisdiction'>): RecipientChoice {
  if (source.previousRecipient !== null && source.previousRecipient.source !== 'none') return { kind: 'previous' };
  const first = recipientCandidates(source, state)[0];
  return first === undefined ? { kind: 'manual' } : { kind: 'table', contactId: first.contactId };
}

export function initialComposerState(source: ComposerSource, uiLang: RequestLetterLang): ComposerState {
  const jurisdiction = source.prefs.jurisdiction;
  const subjectIndex = source.subjects.length > 0 ? 0 : -1;
  const base = { subjectIndex, jurisdiction };
  return {
    subjectIndex,
    entityName: source.subjects[0]?.entityName ?? '',
    jurisdiction,
    kinds: source.previousKinds ?? defaultKinds(jurisdiction),
    letterLang: defaultLang(jurisdiction, source.prefs.letterLang, uiLang),
    checked: source.facts.map((f) => (source.previousRecipient !== null ? true : requestFactCheckedByDefault(f))),
    identity: 'sender-address',
    includeName: false,
    recipient: defaultRecipient(source, base),
    manualAddress: source.previousRecipient?.source === 'manual' ? source.previousRecipient.address : '',
    mentionGpc: false,
  };
}

/** The law changed: kinds and language follow it, the recipient is chosen again. */
export function withJurisdiction(source: ComposerSource, state: ComposerState, jurisdiction: RequestJurisdiction, uiLang: RequestLetterLang): ComposerState {
  const allowed = JURISDICTION_REQUEST_KINDS[jurisdiction];
  const kept = state.kinds.filter((k) => allowed.includes(k));
  const next = { ...state, jurisdiction, kinds: kept.length > 0 ? kept : defaultKinds(jurisdiction), letterLang: defaultLang(jurisdiction, state.letterLang, uiLang) };
  return { ...next, recipient: state.recipient.kind === 'manual' && state.manualAddress !== '' ? state.recipient : defaultRecipient(source, next), mentionGpc: jurisdiction === 'ccpa-ca' ? state.mentionGpc : false };
}

export function withSubject(source: ComposerSource, state: ComposerState, subjectIndex: number): ComposerState {
  const subject = source.subjects[subjectIndex];
  const next = { ...state, subjectIndex: subject === undefined ? -1 : subjectIndex, entityName: subject?.entityName ?? '' };
  return { ...next, recipient: defaultRecipient(source, next) };
}

/** The subject the letter is addressed to (a typed company has no domain). */
export function composerSubject(source: ComposerSource, state: ComposerState): RequestSubject | null {
  const entityName = cleanTypedValue(state.entityName, PROTECT_WIRE_LIMITS.maxEntityNameChars);
  if (entityName === null || !isEntityName(entityName)) return null;
  const subject = source.subjects[state.subjectIndex];
  if (subject === undefined) return { role: 'receiver', vendorId: null, domain: null, entityName };
  return { role: subject.role, vendorId: subject.vendorId, domain: subject.domain, entityName };
}

export function composerFacts(source: ComposerSource, state: ComposerState): RequestEvidenceFact[] {
  return source.facts.filter((_, i) => state.checked[i] === true);
}

/** The recipient reference of the current choice, or null when it is incomplete or invalid. */
export function composerRecipient(source: ComposerSource, state: ComposerState): RecipientRef | null {
  switch (state.recipient.kind) {
    case 'none':
      return { source: 'none' };
    case 'manual': {
      const address = state.manualAddress.trim();
      return isRequestEmail(address) ? { source: 'manual', channel: 'email', address } : null;
    }
    case 'previous':
      return source.previousRecipient;
    case 'table': {
      const id = state.recipient.contactId;
      const c = recipientCandidates(source, state).find((x) => x.contactId === id);
      return c === undefined ? null : { source: 'table', contactId: c.contactId, contactsVersion: c.contactsVersion, channel: c.channel, address: c.address };
    }
  }
}

export type ComposerProblem = 'law' | 'kinds' | 'entity' | 'identity' | 'recipient';

/** Why the letter cannot be sent yet (the first problem), or null. `identifier` only for the identity check. */
export function composerProblem(source: ComposerSource, state: ComposerState, identifier: string): ComposerProblem | null {
  if (state.jurisdiction === null) return 'law';
  if (canonicalRequestKinds(state.jurisdiction, state.kinds).length === 0) return 'kinds';
  if (composerSubject(source, state) === null) return 'entity';
  if (state.identity === 'typed-identifier' && cleanTypedValue(identifier, PROTECT_WIRE_LIMITS.maxEmailChars) === null) return 'identity';
  if (composerRecipient(source, state) === null) return 'recipient';
  return null;
}

/** The letter shown in the preview (identifier and name only as arguments), or null while the choice is incomplete. */
export function composerLetter(source: ComposerSource, state: ComposerState, identifier: string, name: string, today: LocalDay): RenderedRequestLetter | null {
  if (composerProblem(source, state, identifier) !== null || state.jurisdiction === null) return null;
  const subject = composerSubject(source, state)!;
  return renderRequestLetter(
    {
      jurisdiction: state.jurisdiction,
      letterLang: state.letterLang,
      kinds: state.kinds,
      entityName: subject.entityName,
      facts: composerFacts(source, state),
      identity: state.identity,
      mentionGpc: state.mentionGpc && state.jurisdiction === 'ccpa-ca',
      today,
    },
    state.identity === 'typed-identifier' ? identifier : null,
    state.includeName ? name : null,
  );
}

/** mailto: link of the letter for an e-mail recipient (short body above the limit), else null. */
export function composerMailto(recipient: RecipientRef | null, letter: RenderedRequestLetter | null, lang: RequestLetterLang): RequestMailtoLink | null {
  if (recipient === null || letter === null || recipient.source === 'none' || recipient.channel !== 'email') return null;
  return requestMailtoLink(recipient.address, letter.subject, letter.body, REQUEST_MAILTO_SHORT_BODY[lang]);
}

/**
 * The journal entry of the letter: kinds only for the identity (`typed-identifier` / `typed-name`), never the values.
 * Null while the choice is incomplete or the delivery does not fit the recipient.
 */
export function composerRequestInput(source: ComposerSource, state: ComposerState, identifier: string, name: string, delivery: RequestDelivery): NewRequestInput | null {
  if (composerProblem(source, state, identifier) !== null || state.jurisdiction === null) return null;
  const recipient = composerRecipient(source, state)!;
  if (delivery === 'mailto' && (recipient.source === 'none' || recipient.channel !== 'email')) return null;
  if (delivery === 'portal' && (recipient.source !== 'table' || recipient.channel !== 'portal')) return null;
  const typedName = state.includeName && cleanTypedValue(name, PROTECT_WIRE_LIMITS.maxEntityNameChars) !== null;
  const template = REQUEST_TEMPLATES[state.jurisdiction];
  return {
    sourceKind: source.sourceKind,
    jurisdiction: state.jurisdiction,
    kinds: canonicalRequestKinds(state.jurisdiction, state.kinds),
    letterLang: state.letterLang,
    templateId: template.templateId,
    templateVersion: template.version,
    subject: composerSubject(source, state)!,
    recipient,
    facts: source.sourceKind === 'manual' ? [] : composerFacts(source, state),
    identityKinds: [state.identity === 'typed-identifier' ? 'typed-identifier' : 'sender-address', ...(typedName ? (['typed-name'] as const) : [])],
    delivery,
    mentionGpc: state.mentionGpc && state.jurisdiction === 'ccpa-ca',
  };
}

/**
 * Same letter = one journal entry: «Открыть в почте» and «Скопировать текст» of the same letter do not add a second
 * entry (the delivery of the first action is kept). The key holds kinds only, never the identifier or the name.
 */
export function requestInputKey(input: NewRequestInput): string {
  return JSON.stringify({ ...input, delivery: null });
}

// ---------------------------------------------------------------------------
// Journal rows
// ---------------------------------------------------------------------------

export interface RequestRowView {
  requestId: string;
  entityName: string;
  law: Message;
  kinds: Message[];
  status: Message;
  created: Message;
  recipient: Message | null;
  delivery: Message;
  factCount: number;
  due: (RequestDueView & { message: Message; basis: Message }) | null;
  /** Statuses the user can set next (REQUEST_STATUS_TRANSITIONS). */
  next: Array<Exclude<RequestStatus, 'prepared'>>;
}

function statusMessage(r: DeletionRequestRecord, locale: string): Message {
  if (r.status === 'prepared') return msg(REQUEST_STATUS_KEYS.prepared);
  return msg(REQUEST_STATUS_KEYS[r.status], formatRequestDay(r.status === 'sent' && r.sentDay !== null ? r.sentDay : r.statusDay, locale));
}

export function requestRowView(r: DeletionRequestRecord, today: LocalDay, locale: string): RequestRowView {
  const due = requestDueView(r, today);
  const day = due === null ? '' : formatRequestDay(due.dueDay, locale);
  const dueKey = due === null ? '' : due.state === 'overdue' ? 'protect_req_state_overdue' : due.state === 'due-soon' ? 'protect_req_state_due_soon' : 'protect_req_state_pending';
  return {
    requestId: r.requestId,
    entityName: r.subject.entityName,
    law: msg(REQUEST_LAW_KEYS[r.jurisdiction]),
    kinds: REQUEST_KINDS.filter((k) => r.kinds.includes(k)).map((k) => msg(REQUEST_KIND_KEYS[k])),
    status: statusMessage(r, locale),
    created: msg('protect_req_created', formatRequestDay(r.createdDay, locale)),
    recipient: r.recipient.source === 'none' ? null : msg('protect_req_recipient_line', r.recipient.address),
    delivery: msg(REQUEST_DELIVERY_KEYS[r.delivery]),
    factCount: r.facts.length,
    due: due === null ? null : { ...due, message: msg(dueKey, day), basis: msg('protect_req_deadline_basis', msg(REQUEST_BASIS_KEYS[due.ruleId])) },
    next: REQUEST_STATUS_TRANSITIONS[r.status].filter((s): s is Exclude<RequestStatus, 'prepared'> => s !== 'prepared'),
  };
}

// ---------------------------------------------------------------------------
// Files: .ics and the journal export (the saved file is exactly the previewed text)
// ---------------------------------------------------------------------------

export interface RequestFileDownload {
  fileName: string;
  mime: string;
  text: string;
}

export interface IcsTexts {
  summary: string;
  description: string;
  alarm: string;
}

/** Calendar file of the deadline of a record (no site, receiver, observation or letter); null without a deadline. */
export function requestIcsDownload(r: DeletionRequestRecord, today: LocalDay, texts: IcsTexts, stampMs: number): RequestFileDownload | null {
  const due = requestDueView(r, today);
  if (due === null) return null;
  return { fileName: requestIcsFileName(r.requestId), mime: 'text/calendar', text: buildRequestIcs({ requestId: r.requestId, day: due.dueDay, stampMs, ...texts }) };
}

export function requestExportDownload(records: readonly DeletionRequestRecord[], includeFacts: boolean, exportedOn: LocalDay): { preview: RequestJournalExport; download: RequestFileDownload } {
  const preview = createRequestJournalExport(records, { includeFacts, exportedOn });
  return { preview, download: { fileName: requestJournalExportFileName(preview), mime: 'application/json', text: serializeRequestJournalExport(preview) } };
}
