// ADR-020 §I (S14): pure logic of the data-request generator and journal — templates, deadlines, letter rendering,
// mailto: and .ics, the journal reducer, fact adapters, the requests.html hash and the privacy-contacts table. No
// chrome.*, no clock, no storage, no network. Names are request-prefixed (the engine root re-exports every lane).

export {
  addRequestBusinessDays,
  addRequestDays,
  addRequestMonths,
  requestDayFromNumber,
  requestDayNumber,
  requestDaysBetween,
  requestLocalDay,
  requestWeekday,
} from './days';
export {
  REQUEST_DEADLINE_RULES,
  REQUEST_DEADLINE_RULE_IDS,
  REQUEST_DEADLINE_STATES,
  addRequestSpan,
  computeRequestDeadline,
  requestDeadlineRuleOf,
  requestDueView,
} from './deadline';
export type { RequestDeadline, RequestDeadlineRule, RequestDeadlineRuleId, RequestDeadlineSpan, RequestDeadlineState, RequestDeadlineUnit, RequestDueView } from './deadline';
export {
  EMPTY_REQUEST_PREFS,
  REQUESTS_STATE_KEY,
  addRequestRecord,
  applyRequestRetention,
  deleteRequestRecord,
  emptyRequestJournal,
  requestJournalChars,
  requestJournalSummary,
  requestRetentionReason,
  setRequestStatus,
  sortedRequestRecords,
} from './journal';
export type { RequestJournalErrorCode, RequestJournalResult, RequestsStateRecord } from './journal';
export {
  copyRequestFact,
  primaryRequestEncoding,
  rankRequestFacts,
  requestFactCheckedByDefault,
  requestFactFromEvidence,
  requestFactFromSighting,
  requestFactKey,
  requestSightingSentDay,
} from './facts';
export type { EvidenceFactContext, RequestSightingInput } from './facts';
export {
  REQUEST_DRAFT_MARKER,
  REQUEST_FACT_WORDS,
  REQUEST_KIND_ARTICLES,
  REQUEST_MAILTO_SHORT_BODY,
  REQUEST_TEMPLATES,
  REQUEST_TEMPLATE_TEXTS,
  REQUEST_TEMPLATE_VERSION,
} from './templates';
export type { RequestFactWords, RequestLegalReviewStatus, RequestTemplate, RequestTemplateText } from './templates';
export {
  CRLF as REQUEST_LETTER_CRLF,
  MAX_TYPED_IDENTIFIER_CHARS,
  MAX_TYPED_NAME_CHARS,
  canonicalRequestKinds,
  cleanTypedValue,
  letterDay,
  renderRequestLetter,
  requestFactSentence,
  requestTemplateText,
} from './render';
export type { RenderRequestLetterInput, RenderedRequestLetter, RequestIdentityChoice } from './render';
export { REQUEST_MAILTO_MAX_CHARS, buildRequestMailto, encodeMailtoValue, requestMailtoLink } from './mailto';
export type { RequestMailtoLink } from './mailto';
export { REQUEST_ICS_MIME, buildRequestIcs, escapeIcsText, foldIcsLine, requestIcsFileName } from './ics';
export type { RequestIcsInput } from './ics';
export { parseRequestPageHash, requestPageHash } from './page-hash';
export type { RequestPageSource } from './page-hash';
export {
  MAX_CONTACT_DOMAINS,
  MAX_PRIVACY_CONTACTS,
  contactAddressHost,
  hostWithinDomain,
  lintPrivacyContacts,
  parsePrivacyContactRow,
  parsePrivacyContactRows,
  privacyContactAgeDays,
  recipientCandidatesFor,
} from './contacts';
export type { PrivacyContactRow, PrivacyContactsLintOptions, PrivacyContactsLintResult, PrivacyContactsPolicy } from './contacts';
