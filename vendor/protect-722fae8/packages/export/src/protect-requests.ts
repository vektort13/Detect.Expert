// ADR-020 §I, REQ-013 (S14): export of the data-request journal. The file is byte-for-byte the serialization of the
// preview the user saw (serializeRequestJournalExport). Explicit allowlist: every field is copied by name, nothing is
// spread. Redacted by default: observations (sites, receivers, endpoints) are left out and only counted; «Включить
// наблюдения» adds them. The journal has no letter text, identifier or name, so the export cannot carry them either.
// The recipient is a company contact (from the reviewed table or typed by the user).

import { REQUEST_KINDS } from '@detect-expert/contracts';
import type {
  DeletionRequestRecord,
  LocalDay,
  RecipientRef,
  RequestDelivery,
  RequestEvidenceFact,
  RequestHistoryEntry,
  RequestIdentityKind,
  RequestJurisdiction,
  RequestKind,
  RequestLetterLang,
  RequestSourceKind,
  RequestStatus,
  RequestSubject,
  ScriptRef,
} from '@detect-expert/contracts';

export const REQUEST_EXPORT_MIME = 'application/json';

export interface RequestJournalExportRecord {
  requestId: string;
  sourceKind: RequestSourceKind;
  jurisdiction: RequestJurisdiction;
  kinds: RequestKind[];
  letterLang: RequestLetterLang;
  templateId: string;
  templateVersion: string;
  subject: RequestSubject;
  recipient: RecipientRef;
  identityKinds: RequestIdentityKind[];
  delivery: RequestDelivery;
  mentionGpc: boolean;
  createdDay: LocalDay;
  status: RequestStatus;
  statusDay: LocalDay;
  sentDay: LocalDay | null;
  deadlineDay: LocalDay | null;
  extendedDeadlineDay: LocalDay | null;
  history: RequestHistoryEntry[];
  factCount: number;
  /** Present only when the user included the observations. */
  facts?: RequestEvidenceFact[];
}

export interface RequestJournalExport {
  schemaVersion: 1;
  kind: 'detect-expert-requests';
  /** True while the observations are left out. */
  redacted: boolean;
  factsIncluded: boolean;
  exportedOn: LocalDay;
  /** The deadlines are approximate: counted from the sending day the user entered, without public holidays. */
  deadlinesApproximate: true;
  requests: RequestJournalExportRecord[];
}

export interface RequestJournalExportOptions {
  includeFacts: boolean;
  exportedOn: LocalDay;
}

function scriptCopy(s: ScriptRef): ScriptRef {
  if (s.kind === 'external' && s.scheme !== undefined && s.host !== undefined && s.pathTemplate !== undefined) {
    return { kind: 'external', scheme: s.scheme, host: s.host, pathTemplate: s.pathTemplate };
  }
  return { kind: s.kind };
}

function factCopy(f: Readonly<RequestEvidenceFact>): RequestEvidenceFact {
  return {
    factKind: f.factKind,
    day: f.day,
    site: f.site,
    receiverDomain: f.receiverDomain,
    endpoint: f.endpoint === null ? null : { scheme: f.endpoint.scheme, host: f.endpoint.host, pathTemplate: f.endpoint.pathTemplate },
    script: f.script === null ? null : scriptCopy(f.script),
    dataKind: f.dataKind,
    encoding: f.encoding,
    location: f.location,
    parameterName: f.parameterName,
    submitTiming: f.submitTiming,
    techniqueIds: [...f.techniqueIds],
    vendorId: f.vendorId,
    evidenceSource: f.evidenceSource,
    integrity: f.integrity,
    interpretationConfidence: f.interpretationConfidence,
  };
}

function recipientCopy(r: RecipientRef): RecipientRef {
  switch (r.source) {
    case 'table':
      return { source: 'table', contactId: r.contactId, contactsVersion: r.contactsVersion, channel: r.channel, address: r.address };
    case 'manual':
      return { source: 'manual', channel: 'email', address: r.address };
    case 'none':
      return { source: 'none' };
  }
}

function recordCopy(r: Readonly<DeletionRequestRecord>, includeFacts: boolean): RequestJournalExportRecord {
  const out: RequestJournalExportRecord = {
    requestId: r.requestId,
    sourceKind: r.sourceKind,
    jurisdiction: r.jurisdiction,
    kinds: REQUEST_KINDS.filter((k) => r.kinds.includes(k)),
    letterLang: r.letterLang,
    templateId: r.templateId,
    templateVersion: r.templateVersion,
    subject: { role: r.subject.role, vendorId: r.subject.vendorId, domain: r.subject.domain, entityName: r.subject.entityName },
    recipient: recipientCopy(r.recipient),
    identityKinds: [...r.identityKinds],
    delivery: r.delivery,
    mentionGpc: r.mentionGpc,
    createdDay: r.createdDay,
    status: r.status,
    statusDay: r.statusDay,
    sentDay: r.sentDay,
    deadlineDay: r.deadlineDay,
    extendedDeadlineDay: r.extendedDeadlineDay,
    history: r.history.map((h) => ({ status: h.status, day: h.day })),
    factCount: r.facts.length,
  };
  if (includeFacts) out.facts = r.facts.map(factCopy);
  return out;
}

/** The export preview of the journal records (in the order given: the journal view order). */
export function createRequestJournalExport(records: readonly DeletionRequestRecord[], options: RequestJournalExportOptions): RequestJournalExport {
  return {
    schemaVersion: 1,
    kind: 'detect-expert-requests',
    redacted: !options.includeFacts,
    factsIncluded: options.includeFacts,
    exportedOn: options.exportedOn,
    deadlinesApproximate: true,
    requests: records.map((r) => recordCopy(r, options.includeFacts)),
  };
}

/** The exact file text (pretty JSON + newline): what the preview shows is what is saved. */
export function serializeRequestJournalExport(preview: Readonly<RequestJournalExport>): string {
  return JSON.stringify(preview, null, 2) + '\n';
}

export function requestJournalExportFileName(preview: Readonly<RequestJournalExport>): string {
  return 'detect-expert-requests-' + preview.exportedOn + '.json';
}
