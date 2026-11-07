// ADR-020 §I, §8 (S14): IndexedDB part of the data-request journal — store `requests` (one DeletionRequestRecord per
// requestId) and meta `requests-state` {revision, prefs}. The SW is the only writer (through the ProtectDb port).
// Hydration validates the whole journal (validateStoredRequestJournal: invalid, duplicate and over-budget records are
// dropped one by one and counted) and deletes the dropped records from the store, so the journal stays bounded.

import { PROTECT_BUDGETS, validateStoredRequestJournal } from '@detect-expert/contracts';
import type { DeletionRequestRecord, RequestPrefs, StoredRequestJournal } from '@detect-expert/contracts';
import { EMPTY_REQUEST_PREFS, REQUESTS_STATE_KEY } from '@detect-expert/engine';
import type { RequestsStateRecord } from '@detect-expert/engine';
import type { ProtectDb } from '../db-port';

/** Records read at most on hydration (the writer keeps maxRequests; the rest is dropped as over budget). */
export const MAX_HYDRATED_RECORDS = PROTECT_BUDGETS.maxRequests * 4;

export interface LoadedRequestJournal {
  journal: StoredRequestJournal;
  /** Records dropped (and deleted) on this hydration. */
  dropped: number;
}

function readState(raw: unknown): { revision: number; prefs: RequestPrefs } {
  if (typeof raw !== 'object' || raw === null) return { revision: 0, prefs: { ...EMPTY_REQUEST_PREFS } };
  const r = raw as Record<string, unknown>;
  return { revision: r['revision'] as number, prefs: r['prefs'] as RequestPrefs };
}

function storedKey(record: unknown): string | number | null {
  if (typeof record !== 'object' || record === null) return null;
  const key = (record as Record<string, unknown>)['requestId'];
  return typeof key === 'string' || (typeof key === 'number' && Number.isFinite(key)) ? key : null;
}

export class RequestJournalStore {
  constructor(private readonly db: ProtectDb) {}

  /** Reads and validates the journal; a broken envelope (state record) starts a fresh one. Throws on storage errors. */
  async load(): Promise<LoadedRequestJournal> {
    const stateRaw = await this.db.get<unknown>('meta', REQUESTS_STATE_KEY);
    const raw: unknown[] = [];
    let overflow = 0;
    await this.db.iterate<unknown>('requests', { chunk: 128 }, (records) => {
      for (const r of records) {
        if (raw.length < MAX_HYDRATED_RECORDS) raw.push(r);
        else overflow++;
      }
    });
    const state = readState(stateRaw);
    let result = validateStoredRequestJournal({ v: 1, revision: state.revision, prefs: state.prefs, requests: raw });
    let brokenState = false;
    if (!result.ok) {
      // The state record is broken: keep the records that validate on their own, start a new revision.
      brokenState = stateRaw !== undefined;
      result = validateStoredRequestJournal({ v: 1, revision: 0, prefs: { ...EMPTY_REQUEST_PREFS }, requests: raw });
    }
    if (!result.ok) return { journal: { v: 1, revision: 0, prefs: { ...EMPTY_REQUEST_PREFS }, requests: [] }, dropped: raw.length + overflow };
    const journal = result.value.journal;
    const dropped = result.value.droppedRecords + overflow;
    if (dropped > 0) {
      const kept = new Set(journal.requests.map((r) => r.requestId));
      const stale: Array<string | number> = [];
      for (const r of raw) {
        const key = storedKey(r);
        if (key !== null && !(typeof key === 'string' && kept.has(key))) stale.push(key);
      }
      for (const key of stale) await this.db.delete('requests', key);
      if (overflow > 0) {
        // Records beyond the hydration bound were not read: rewrite the store from the kept journal.
        await this.db.clear('requests');
        await this.db.putMany('requests', journal.requests);
      }
    }
    if (brokenState || dropped > 0) await this.writeState(journal);
    return { journal, dropped };
  }

  async writeState(journal: Readonly<StoredRequestJournal>): Promise<void> {
    const record: RequestsStateRecord = { key: REQUESTS_STATE_KEY, v: 1, revision: journal.revision, prefs: { jurisdiction: journal.prefs.jurisdiction, letterLang: journal.prefs.letterLang } };
    await this.db.put('meta', record);
  }

  async putRecord(record: Readonly<DeletionRequestRecord>): Promise<void> {
    await this.db.put('requests', record);
  }

  async deleteRecords(ids: readonly string[]): Promise<void> {
    for (const id of ids) await this.db.delete('requests', id);
  }
}
