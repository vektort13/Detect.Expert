// ADR-020 §I (S14): reducer of the data-request journal (IndexedDB `requests` + meta `requests-state`; the SW is the
// only writer). Statuses are set by the user; transitions follow REQUEST_STATUS_TRANSITIONS. Retention runs at the next
// event: `prepared` 30 days after creation, `closed` 365 days after the status day, any entry 730 days after creation.
// Limits: PROTECT_BUDGETS.maxRequests records and maxJournalChars together, each counted from the validated shape
// without serializing (estimateRecordChars). The journal holds kinds, domains, days, enums and the company contact —
// never the user's identifier, name or the letter text (the contract has no field for them).

import { PROTECT_BUDGETS, canTransitionRequest, estimateRecordChars, isLocalDay } from '@detect-expert/contracts';
import type {
  DeletionRequestRecord,
  LocalDay,
  NewRequestInput,
  RequestJournalSummary,
  RequestPrefs,
  RequestStatus,
  StoredRequestJournal,
} from '@detect-expert/contracts';
import { computeRequestDeadline, requestDueView } from './deadline';
import { requestDaysBetween } from './days';
import { copyRequestFact } from './facts';

export const REQUESTS_STATE_KEY = 'requests-state';

/** Meta record of the journal (IndexedDB `meta`, key `requests-state`). */
export interface RequestsStateRecord {
  key: typeof REQUESTS_STATE_KEY;
  v: 1;
  revision: number;
  prefs: RequestPrefs;
}

export const EMPTY_REQUEST_PREFS: Readonly<RequestPrefs> = Object.freeze({ jurisdiction: null, letterLang: null });

export function emptyRequestJournal(): StoredRequestJournal {
  return { v: 1, revision: 0, prefs: { ...EMPTY_REQUEST_PREFS }, requests: [] };
}

export type RequestJournalErrorCode = 'limit-reached' | 'not-found' | 'invalid-request';

export type RequestJournalResult = { ok: true; journal: StoredRequestJournal; record: DeletionRequestRecord | null } | { ok: false; code: RequestJournalErrorCode };

function copyRecipient(r: NewRequestInput['recipient']): NewRequestInput['recipient'] {
  switch (r.source) {
    case 'table':
      return { source: 'table', contactId: r.contactId, contactsVersion: r.contactsVersion, channel: r.channel, address: r.address };
    case 'manual':
      return { source: 'manual', channel: 'email', address: r.address };
    case 'none':
      return { source: 'none' };
  }
}

function bump(journal: StoredRequestJournal): number {
  return Math.min(Number.MAX_SAFE_INTEGER, journal.revision + 1);
}

/** Why a record expires on `today` (null: it stays). */
export function requestRetentionReason(record: Readonly<DeletionRequestRecord>, today: LocalDay): 'prepared' | 'closed' | 'max-age' | null {
  if (requestDaysBetween(record.createdDay, today) >= PROTECT_BUDGETS.maxAgeDays) return 'max-age';
  if (record.status === 'prepared' && requestDaysBetween(record.createdDay, today) >= PROTECT_BUDGETS.preparedTtlDays) return 'prepared';
  if (record.status === 'closed' && requestDaysBetween(record.statusDay, today) >= PROTECT_BUDGETS.closedTtlDays) return 'closed';
  return null;
}

/** Drops expired records; the revision changes only when something was removed. */
export function applyRequestRetention(journal: StoredRequestJournal, today: LocalDay): { journal: StoredRequestJournal; removed: string[] } {
  const removed: string[] = [];
  const kept: DeletionRequestRecord[] = [];
  for (const r of journal.requests) {
    if (requestRetentionReason(r, today) === null) kept.push(r);
    else removed.push(r.requestId);
  }
  if (removed.length === 0) return { journal, removed };
  return { journal: { ...journal, revision: bump(journal), requests: kept }, removed };
}

/** JSON characters of the journal records (budget maxJournalChars), counted without serializing. */
export function requestJournalChars(requests: readonly DeletionRequestRecord[]): number {
  let total = 0;
  for (const r of requests) total += estimateRecordChars(r) + 1;
  return total;
}

/** Adds a `prepared` record; the prefs remember the law and the letter language. */
export function addRequestRecord(journal: StoredRequestJournal, input: NewRequestInput, requestId: string, today: LocalDay): RequestJournalResult {
  if (!isLocalDay(today)) return { ok: false, code: 'invalid-request' };
  if (journal.requests.some((r) => r.requestId === requestId)) return { ok: false, code: 'invalid-request' };
  if (journal.requests.length >= PROTECT_BUDGETS.maxRequests) return { ok: false, code: 'limit-reached' };
  const record: DeletionRequestRecord = {
    sourceKind: input.sourceKind,
    jurisdiction: input.jurisdiction,
    kinds: [...input.kinds],
    letterLang: input.letterLang,
    templateId: input.templateId,
    templateVersion: input.templateVersion,
    subject: { role: input.subject.role, vendorId: input.subject.vendorId, domain: input.subject.domain, entityName: input.subject.entityName },
    recipient: copyRecipient(input.recipient),
    facts: input.facts.map(copyRequestFact),
    identityKinds: [...input.identityKinds],
    delivery: input.delivery,
    mentionGpc: input.mentionGpc,
    requestId,
    createdDay: today,
    status: 'prepared',
    statusDay: today,
    sentDay: null,
    deadlineDay: null,
    extendedDeadlineDay: null,
    history: [{ status: 'prepared', day: today }],
  };
  const size = estimateRecordChars(record);
  if (size > PROTECT_BUDGETS.maxRecordChars) return { ok: false, code: 'invalid-request' };
  if (requestJournalChars(journal.requests) + size + 1 > PROTECT_BUDGETS.maxJournalChars) return { ok: false, code: 'limit-reached' };
  return {
    ok: true,
    record,
    journal: { v: 1, revision: bump(journal), prefs: { jurisdiction: input.jurisdiction, letterLang: input.letterLang }, requests: [...journal.requests, record] },
  };
}

/**
 * Status change set by the user on `day` (not before the record was created, not after today). `sent` fixes the sending
 * day and the approximate deadlines; the other statuses keep them.
 */
export function setRequestStatus(journal: StoredRequestJournal, requestId: string, status: Exclude<RequestStatus, 'prepared'>, day: LocalDay, today: LocalDay): RequestJournalResult {
  const index = journal.requests.findIndex((r) => r.requestId === requestId);
  if (index < 0) return { ok: false, code: 'not-found' };
  const current = journal.requests[index]!;
  if (!isLocalDay(day) || !isLocalDay(today) || day > today || day < current.createdDay) return { ok: false, code: 'invalid-request' };
  if (!canTransitionRequest(current.status, status)) return { ok: false, code: 'invalid-request' };
  if (current.history.length >= PROTECT_BUDGETS.maxHistoryPerRequest) return { ok: false, code: 'limit-reached' };
  let next: DeletionRequestRecord = { ...current, status, statusDay: day < current.statusDay ? current.statusDay : day, history: [...current.history, { status, day }] };
  if (status === 'sent') {
    const deadline = computeRequestDeadline(current.jurisdiction, current.kinds, day);
    next = { ...next, statusDay: day, sentDay: day, deadlineDay: deadline?.deadlineDay ?? null, extendedDeadlineDay: deadline?.extendedDeadlineDay ?? null };
  }
  if (estimateRecordChars(next) > PROTECT_BUDGETS.maxRecordChars) return { ok: false, code: 'limit-reached' };
  const requests = [...journal.requests];
  requests[index] = next;
  return { ok: true, record: next, journal: { ...journal, revision: bump(journal), requests } };
}

export function deleteRequestRecord(journal: StoredRequestJournal, requestId: string): RequestJournalResult {
  const index = journal.requests.findIndex((r) => r.requestId === requestId);
  if (index < 0) return { ok: false, code: 'not-found' };
  const requests = journal.requests.filter((r) => r.requestId !== requestId);
  return { ok: true, record: null, journal: { ...journal, revision: bump(journal), requests } };
}

/** open = not closed; dueSoon / overdue only for requests waiting for an answer. */
export function requestJournalSummary(journal: Readonly<StoredRequestJournal>, today: LocalDay): RequestJournalSummary {
  let open = 0;
  let dueSoon = 0;
  let overdue = 0;
  for (const r of journal.requests) {
    if (r.status !== 'closed') open++;
    const due = requestDueView(r, today);
    if (due?.state === 'due-soon') dueSoon++;
    else if (due?.state === 'overdue') overdue++;
  }
  return { total: journal.requests.length, open, dueSoon, overdue };
}

/** Records newest first (created day, then id) — the order of the journal view and the export. */
export function sortedRequestRecords(requests: readonly DeletionRequestRecord[]): DeletionRequestRecord[] {
  return [...requests].sort((a, b) => (a.createdDay === b.createdDay ? (a.requestId < b.requestId ? -1 : a.requestId > b.requestId ? 1 : 0) : a.createdDay > b.createdDay ? -1 : 1));
}
