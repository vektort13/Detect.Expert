// ADR-020 §I (S14): the SW lane of data requests. Runs whenever the module is active (no feature of its own). The
// journal lives in IndexedDB (`requests` + meta `requests-state`; the SW is the only writer), cached in memory while the
// lane runs. Every mutation carries expectedRevision (else `stale-revision`). Retention (prepared 30, closed 365, any
// 730 days) runs at the next request of the UI — alarms are not used. The SW never sees the letter text, the user's
// identifier or name: NewRequestInput has no field for them, and requests.html renders letters itself.
// While the module is not active the controller routes only `requests-get` and `request-delete` here, through
// handleInactiveRequests (the user's own journal stays viewable, deletable and exportable).

import { MAX_COUNT } from '@detect-expert/contracts';
import type {
  LocalDay,
  ProtectUiRequest,
  RequestDraftContext,
  RequestView,
  StoredRequestJournal,
  UiErrorCode,
  UiResponse,
} from '@detect-expert/contracts';
import {
  addRequestRecord,
  applyRequestRetention,
  deleteRequestRecord,
  emptyRequestJournal,
  parsePrivacyContactRows,
  requestJournalSummary,
  requestLocalDay,
  setRequestStatus,
  sortedRequestRecords,
} from '@detect-expert/engine';
import type { PrivacyContactRow, RequestJournalResult } from '@detect-expert/engine';
import type { Clock } from '../../chrome-api';
import type { ProtectDb } from '../db-port';
import type { ProtectFeatureService, ProtectServiceContext, ProtectStopReason } from '../services';
import { buildRequestDraft } from './draft';
import { RequestJournalStore } from './store';

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/** `rq_` + 20 base32 characters from crypto.getRandomValues (100 bits). */
export function newRequestId(random: (bytes: Uint8Array<ArrayBuffer>) => void = (b) => globalThis.crypto.getRandomValues(b)): string {
  const bytes = new Uint8Array(20);
  random(bytes);
  let out = 'rq_';
  for (const b of bytes) out += BASE32[b & 31];
  return out;
}

/** Local calendar day of an epoch ms in the browser's time zone. */
export function localDayOf(epochMs: number): LocalDay | null {
  const d = new Date(epochMs);
  return requestLocalDay(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function error(code: UiErrorCode): UiResponse {
  return { schemaVersion: 1, type: 'error', code };
}

interface JournalState {
  journal: StoredRequestJournal;
  dropped: number;
}

/** Shared by the running lane and the inactive path: load + retention, mutations, answers. */
export class RequestJournalAccess {
  private state: JournalState | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly store: RequestJournalStore;

  constructor(
    db: ProtectDb,
    private readonly clock: Clock,
    private readonly random?: (bytes: Uint8Array<ArrayBuffer>) => void,
  ) {
    this.store = new RequestJournalStore(db);
  }

  serial<T>(task: () => Promise<T>): Promise<T> {
    const next = this.chain.then(task, task);
    this.chain = next.catch(() => undefined);
    return next;
  }

  today(): LocalDay | null {
    return localDayOf(this.clock.now());
  }

  forget(): void {
    this.state = null;
  }

  /** Hydrated journal after today's retention (written through). Throws on storage errors. */
  async current(): Promise<JournalState> {
    if (this.state === null) {
      const loaded = await this.store.load();
      this.state = { journal: loaded.journal, dropped: Math.min(MAX_COUNT, loaded.dropped) };
    }
    const today = this.today();
    if (today !== null) {
      const retained = applyRequestRetention(this.state.journal, today);
      if (retained.removed.length > 0) {
        await this.store.deleteRecords(retained.removed);
        await this.store.writeState(retained.journal);
        this.state = { ...this.state, journal: retained.journal };
      }
    }
    return this.state;
  }

  response(state: JournalState, view: RequestView): UiResponse {
    const today = this.today();
    const summary = today === null ? { total: state.journal.requests.length, open: 0, dueSoon: 0, overdue: 0 } : requestJournalSummary(state.journal, today);
    return {
      schemaVersion: 1,
      type: 'protect-requests',
      revision: state.journal.revision,
      summary,
      prefs: { ...state.journal.prefs },
      droppedRecords: state.dropped,
      ...(view === 'full' ? { requests: sortedRequestRecords(state.journal.requests) } : {}),
    };
  }

  private async commit(state: JournalState, result: RequestJournalResult, removed: readonly string[]): Promise<UiResponse> {
    if (!result.ok) return error(result.code);
    if (result.record !== null) await this.store.putRecord(result.record);
    if (removed.length > 0) await this.store.deleteRecords(removed);
    await this.store.writeState(result.journal);
    const next = { ...state, journal: result.journal };
    this.state = next;
    return this.response(next, 'full');
  }

  get(view: RequestView): Promise<UiResponse> {
    return this.serial(async () => this.response(await this.current(), view));
  }

  save(expectedRevision: number, request: Extract<ProtectUiRequest, { type: 'ui-protect-request-save' }>['request']): Promise<UiResponse> {
    return this.serial(async () => {
      const state = await this.current();
      if (state.journal.revision !== expectedRevision) return error('stale-revision');
      const today = this.today();
      if (today === null) return error('invalid-request');
      // 100 random bits: a collision is not expected; a bounded retry keeps a broken generator from looping.
      let id = newRequestId(this.random);
      for (let attempt = 0; attempt < 4 && state.journal.requests.some((r) => r.requestId === id); attempt++) id = newRequestId(this.random);
      return this.commit(state, addRequestRecord(state.journal, request, id, today), []);
    });
  }

  status(request: Extract<ProtectUiRequest, { type: 'ui-protect-request-status' }>): Promise<UiResponse> {
    return this.serial(async () => {
      const state = await this.current();
      if (state.journal.revision !== request.expectedRevision) return error('stale-revision');
      const today = this.today();
      if (today === null) return error('invalid-request');
      return this.commit(state, setRequestStatus(state.journal, request.requestId, request.status, request.day, today), []);
    });
  }

  remove(expectedRevision: number, requestId: string): Promise<UiResponse> {
    return this.serial(async () => {
      const state = await this.current();
      if (state.journal.revision !== expectedRevision) return error('stale-revision');
      return this.commit(state, deleteRequestRecord(state.journal, requestId), [requestId]);
    });
  }
}

export interface RequestsServiceOptions {
  /** Test: deterministic ids. */
  random?: (bytes: Uint8Array<ArrayBuffer>) => void;
}

export class RequestsService implements ProtectFeatureService {
  readonly name = 'requests' as const;
  readonly features = 'module' as const;

  private ctx: ProtectServiceContext | null = null;
  private access: RequestJournalAccess | null = null;
  private contacts: PrivacyContactRow[] = [];
  private stats = { gets: 0, drafts: 0, saves: 0, statusChanges: 0, deletes: 0, storageFailures: 0 };

  constructor(private readonly options: RequestsServiceOptions = {}) {}

  start(ctx: ProtectServiceContext): void {
    this.ctx = ctx;
    this.access = ctx.db === null ? null : new RequestJournalAccess(ctx.db, ctx.clock, this.options.random);
    this.contacts = parsePrivacyContactRows(ctx.tables.PRIVACY_CONTACTS_ENTRIES);
  }

  stop(_reason: ProtectStopReason): void {
    this.access?.forget();
    this.access = null;
    this.ctx = null;
    this.contacts = [];
  }

  private async guarded(task: () => Promise<UiResponse>): Promise<UiResponse> {
    try {
      return await task();
    } catch {
      this.stats.storageFailures++;
      this.access?.forget();
      return error('storage-unavailable');
    }
  }

  private async draft(sourceKind: RequestDraftContext['sourceKind'], recordId: string | undefined): Promise<UiResponse> {
    const ctx = this.ctx;
    const access = this.access;
    if (ctx === null) return error('module-disabled');
    const prefs = access === null ? emptyRequestJournal().prefs : (await access.serial(() => access.current())).journal.prefs;
    const draft = await buildRequestDraft(
      {
        docStore: ctx.docStore,
        tabModel: ctx.tabModel,
        db: ctx.db,
        contacts: this.contacts,
        localDay: localDayOf,
        prefs,
        gpcAvailable: ctx.settings().features.includes('gpc'),
      },
      sourceKind,
      recordId,
    );
    return { schemaVersion: 1, type: 'protect-request-draft', draft };
  }

  handleUi(type: ProtectUiRequest['type'], request: ProtectUiRequest): Promise<UiResponse | undefined> | UiResponse | undefined {
    const access = this.access;
    switch (request.type) {
      case 'ui-protect-requests-get':
        this.stats.gets++;
        return access === null ? error('storage-unavailable') : this.guarded(() => access.get(request.view));
      case 'ui-protect-request-draft':
        this.stats.drafts++;
        return this.guarded(() => this.draft(request.sourceKind, request.recordId));
      case 'ui-protect-request-save':
        this.stats.saves++;
        return access === null ? error('storage-unavailable') : this.guarded(() => access.save(request.expectedRevision, request.request));
      case 'ui-protect-request-status':
        this.stats.statusChanges++;
        return access === null ? error('storage-unavailable') : this.guarded(() => access.status(request));
      case 'ui-protect-request-delete':
        this.stats.deletes++;
        return access === null ? error('storage-unavailable') : this.guarded(() => access.remove(request.expectedRevision, request.requestId));
      case 'ui-protect-purge':
        // The controller clears the store and the meta key right after this call; the cache goes now.
        if (request.what === 'requests' || request.what === 'all') access?.forget();
        return undefined;
      default:
        void type;
        return undefined;
    }
  }

  debug(): Record<string, number | boolean> {
    return { storageOk: this.access !== null, contacts: this.contacts.length, ...this.stats };
  }

  /** Test profile only (the controller refuses otherwise): `{reload: true}` drops the cache, the next request re-reads IDB. */
  debugInject(payload: unknown): unknown {
    if (typeof payload === 'object' && payload !== null && (payload as Record<string, unknown>)['reload'] === true) {
      this.access?.forget();
      return this.debug();
    }
    throw new Error('requests-inject: unknown payload');
  }
}

/**
 * The module is not active (off with data kept, suspended, organization policy): the user's journal stays viewable
 * and deletable. Only `ui-protect-requests-get` and `ui-protect-request-delete`; drafts, saves and status changes need
 * the active module. The controller opens the existing database (never creates it) and closes it afterwards.
 */
export const INACTIVE_REQUEST_TYPES: ReadonlySet<ProtectUiRequest['type']> = new Set(['ui-protect-requests-get', 'ui-protect-request-delete']);

export async function handleInactiveRequests(db: ProtectDb, clock: Clock, request: ProtectUiRequest): Promise<UiResponse> {
  const access = new RequestJournalAccess(db, clock);
  try {
    if (request.type === 'ui-protect-requests-get') return await access.get(request.view);
    if (request.type === 'ui-protect-request-delete') return await access.remove(request.expectedRevision, request.requestId);
    return error('module-disabled');
  } catch {
    return error('storage-unavailable');
  }
}

/** Empty journal answer (the module was never enabled here, or its database does not exist). */
export function emptyRequestsResponse(view: RequestView): UiResponse {
  return {
    schemaVersion: 1,
    type: 'protect-requests',
    revision: 0,
    summary: { total: 0, open: 0, dueSoon: 0, overdue: 0 },
    prefs: { jurisdiction: null, letterLang: null },
    droppedRecords: 0,
    ...(view === 'full' ? { requests: [] } : {}),
  };
}

export function createRequestsService(options: RequestsServiceOptions = {}): ProtectFeatureService {
  return new RequestsService(options);
}
