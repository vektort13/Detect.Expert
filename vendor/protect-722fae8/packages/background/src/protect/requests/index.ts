// ADR-020 §I (S14): data requests — the journal (IndexedDB `requests` + meta `requests-state`) and the draft context of
// a letter; the SW lane of the module «Защита» (runs whenever the module is active).

export {
  INACTIVE_REQUEST_TYPES,
  RequestJournalAccess,
  RequestsService,
  createRequestsService,
  emptyRequestsResponse,
  handleInactiveRequests,
  localDayOf,
  newRequestId,
} from './service';
export type { RequestsServiceOptions } from './service';
export { MAX_HYDRATED_RECORDS, RequestJournalStore } from './store';
export type { LoadedRequestJournal } from './store';
export { buildRequestDraft } from './draft';
export type { DraftSources } from './draft';
