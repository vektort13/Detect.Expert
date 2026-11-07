// ADR-020 §I (S14): the data-request lane through the real controller (fake chrome + MemoryProtectDb): journal in
// IndexedDB with revisions (stale-revision), retention at the next request, limits, drafts from an evidence record
// (allowlist, endpoint scheme only for https documents) and from history sightings, recipients from the privacy-contacts
// table, purge, hydration of a broken store, and the inactive path (view and delete only; never creates the database).

import { describe, expect, it } from 'vitest';
import { PROTECT_BUDGETS, validateProtectUiRequest } from '@detect-expert/contracts';
import type { DeletionRequestRecord, NewRequestInput, ProtectTransferEvidence, ProtectUiRequest, RequestDraftContext, UiResponse } from '@detect-expert/contracts';
import { applyHistorySightingDelta, HISTORY_SIGNAL_BITS, historyDayIndex } from '@detect-expert/engine';
import { RequestsService } from '../../src/protect/requests/service';
import type { ProtectTables } from '../../src/protect/services';
import { committed } from '../fake-chrome';
import { MemoryProtectDb } from './memory-db';
import { ALL_SITES, DNR_PERMISSION, ENABLED_SETTINGS, optionsSender, popupSender, setupController } from './support';
import type { ControllerSetup, RecordingService } from './support';

const GRANTED = { grantedOrigins: ALL_SITES, permissions: [DNR_PERMISSION] };
const NOW = Date.UTC(2026, 9, 17, 12, 0, 0);
const DAY_MS = 86_400_000;
const CANARY = 'canary-ident-5c2e91@canary.test';
const DOC = 'DOC000000000000000000000000000001';
const KEY = '7:0:' + DOC;

const TABLES: ProtectTables = {
  FIREWALL_PRESET_ENTRIES: [],
  REPLAY_ENTRIES: [],
  PRIVACY_CONTACTS_ENTRIES: [
    { contactId: 'vendor-sim', contactsVersion: 'synthetic-1', entityName: 'Vendor Sim', domains: ['vendor-sim.test'], channel: 'email', address: 'privacy@vendor-sim.test', jurisdictions: ['gdpr-eu-eea', 'ccpa-ca'], accessedAt: '2026-10-16', reviewedAt: '2026-10-17' },
    { contactId: 'shop', contactsVersion: 'synthetic-1', entityName: 'Shop Site', domains: ['shop-site.com'], channel: 'portal', portalHost: 'privacy.shop-site.com', portalPath: '/request', jurisdictions: ['gdpr-eu-eea'], accessedAt: '2026-10-16', reviewedAt: '2026-10-17' },
  ],
};

interface Setup extends ControllerSetup {
  requests: RequestsService;
}

let counter = 0;
/** Unique ids: the counter in base 32, one digit per byte (only the low 5 bits of a byte are used). */
function deterministic(bytes: Uint8Array): void {
  counter++;
  let x = counter;
  for (let i = bytes.length - 1; i >= 0; i--) {
    bytes[i] = x % 32;
    x = Math.floor(x / 32);
  }
}

async function setup(options: { features?: string[]; db?: MemoryProtectDb; enabled?: boolean } = {}): Promise<Setup> {
  const requests = new RequestsService({ random: deterministic });
  const s = await setupController({
    chrome: GRANTED,
    settings: { ...ENABLED_SETTINGS, features: options.features ?? ['value-match'], enabled: options.enabled ?? true },
    services: () => [requests as unknown as RecordingService],
    load: false,
    controller: { tables: TABLES, ...(options.db === undefined ? {} : { dbFactory: () => options.db! }) },
  });
  s.clock.t = NOW;
  await s.controller.load();
  return { ...s, ...(options.db === undefined ? {} : { db: options.db }), requests };
}

function route(s: Setup, request: Record<string, unknown>, sender = optionsSender()): Promise<UiResponse> {
  const checked = validateProtectUiRequest({ schemaVersion: 1, ...request });
  if (!checked.ok) throw new Error('invalid request in test: ' + checked.reason);
  return s.controller.routeUi(checked.value, sender);
}

interface Journal {
  revision: number;
  summary: { total: number; open: number; dueSoon: number; overdue: number };
  prefs: { jurisdiction: string | null; letterLang: string | null };
  droppedRecords: number;
  requests?: DeletionRequestRecord[];
}

function journal(r: UiResponse): Journal {
  if (r.type !== 'protect-requests') throw new Error('not a journal: ' + JSON.stringify(r));
  return r as unknown as Journal;
}

function draft(r: UiResponse): RequestDraftContext {
  if (r.type !== 'protect-request-draft') throw new Error('not a draft: ' + JSON.stringify(r));
  return r.draft;
}

function input(over: Partial<NewRequestInput> = {}): NewRequestInput {
  return {
    sourceKind: 'manual',
    jurisdiction: 'gdpr-eu-eea',
    kinds: ['erasure'],
    letterLang: 'en',
    templateId: 'gdpr-eu-eea',
    templateVersion: '2026-10-17',
    subject: { role: 'receiver', vendorId: null, domain: 'tracker.example', entityName: 'Tracker' },
    recipient: { source: 'manual', channel: 'email', address: 'privacy@tracker.example' },
    facts: [],
    identityKinds: ['typed-identifier', 'typed-name'],
    delivery: 'mailto',
    mentionGpc: false,
    ...over,
  };
}

async function save(s: Setup, revision: number, over: Partial<NewRequestInput> = {}): Promise<Journal> {
  return journal(await route(s, { type: 'ui-protect-request-save', expectedRevision: revision, request: input(over) }));
}

function transfer(over: Partial<ProtectTransferEvidence> = {}): ProtectTransferEvidence {
  return {
    evidenceId: 'pe-7', frameContext: 'top', attributionConfidence: 'unknown', count: 1, countQuality: 'exact', firstSecond: 5, lastSecond: 5,
    evidenceSource: 'derived', integrity: 'derived', ruleVersion: '1', limitationCodes: [], protectKind: 'value-match', ruleId: 'form-leak',
    transferClass: 'third-party-before-submit', fieldKind: 'email', encodings: ['sha256-hex'], location: 'body-json', paramName: 'ud[em]',
    receiver: 'vendor-sim.test', relation: 'cross-site', method: 'POST', requestKind: 'beacon', endpointHost: 'px.vendor-sim.test',
    endpointPathTemplate: '/collect', submitTiming: 'before-submit', deliveryState: 'sent', interpretationConfidence: 'high', ...over,
  };
}

describe('requests lane: journal', () => {
  it('get, save (prefs remembered), stale revision, status → deadline, delete; every answer carries the full journal', async () => {
    const s = await setup();
    const empty = journal(await route(s, { type: 'ui-protect-requests-get', view: 'summary' }, popupSender()));
    expect(empty).toMatchObject({ revision: 0, summary: { total: 0, open: 0, dueSoon: 0, overdue: 0 }, prefs: { jurisdiction: null, letterLang: null }, droppedRecords: 0 });
    expect(empty.requests).toBeUndefined();
    const saved = await save(s, 0);
    expect(saved.revision).toBe(1);
    expect(saved.prefs).toEqual({ jurisdiction: 'gdpr-eu-eea', letterLang: 'en' });
    const rec = saved.requests![0]!;
    expect(rec.requestId).toMatch(/^rq_[a-z2-7]{20}$/);
    expect(rec).toMatchObject({ status: 'prepared', createdDay: '2026-10-17', identityKinds: ['typed-identifier', 'typed-name'] });
    expect(await route(s, { type: 'ui-protect-request-save', expectedRevision: 0, request: input() })).toEqual({ schemaVersion: 1, type: 'error', code: 'stale-revision' });
    const sent = journal(await route(s, { type: 'ui-protect-request-status', expectedRevision: 1, requestId: rec.requestId, status: 'sent', day: '2026-10-17' }));
    expect(sent.requests![0]).toMatchObject({ status: 'sent', sentDay: '2026-10-17', deadlineDay: '2026-11-17', extendedDeadlineDay: '2027-01-17' });
    expect(await route(s, { type: 'ui-protect-request-status', expectedRevision: 2, requestId: rec.requestId, status: 'answered', day: '2026-10-18' })).toEqual({ schemaVersion: 1, type: 'error', code: 'invalid-request' });
    s.clock.t = NOW + 29 * DAY_MS;
    expect(journal(await route(s, { type: 'ui-protect-requests-get', view: 'summary' })).summary).toEqual({ total: 1, open: 1, dueSoon: 1, overdue: 0 });
    s.clock.t = NOW + 32 * DAY_MS;
    expect(journal(await route(s, { type: 'ui-protect-requests-get', view: 'summary' })).summary).toEqual({ total: 1, open: 1, dueSoon: 0, overdue: 1 });
    // Stored as the record, plus the state meta — no letter, identifier or name anywhere.
    expect(await s.db.count('requests')).toBe(1);
    expect(await s.db.get('meta', 'requests-state')).toEqual({ key: 'requests-state', v: 1, revision: 2, prefs: { jurisdiction: 'gdpr-eu-eea', letterLang: 'en' } });
    const deleted = journal(await route(s, { type: 'ui-protect-request-delete', expectedRevision: 2, requestId: rec.requestId }));
    expect(deleted).toMatchObject({ revision: 3, requests: [] });
    expect(await s.db.count('requests')).toBe(0);
    expect(await route(s, { type: 'ui-protect-request-delete', expectedRevision: 3, requestId: rec.requestId })).toEqual({ schemaVersion: 1, type: 'error', code: 'not-found' });
  });

  it('the contract refuses any identifier, name or letter field before the SW sees it', () => {
    for (const extra of [{ identifier: CANARY }, { name: CANARY }, { body: CANARY }, { text: CANARY }, { email: CANARY }, { identity: CANARY }]) {
      expect(validateProtectUiRequest({ schemaVersion: 1, type: 'ui-protect-request-save', expectedRevision: 0, request: { ...input(), ...extra } }).ok).toBe(false);
    }
  });

  it('retention at the next request: prepared after 30 days; limit of 100 records', async () => {
    const s = await setup();
    let j = await save(s, 0);
    s.clock.t = NOW + 30 * DAY_MS;
    j = journal(await route(s, { type: 'ui-protect-requests-get', view: 'full' }));
    expect(j.requests).toEqual([]);
    expect(await s.db.count('requests')).toBe(0);
    for (let i = 0; i < PROTECT_BUDGETS.maxRequests; i++) j = await save(s, j.revision);
    expect(j.summary.total).toBe(PROTECT_BUDGETS.maxRequests);
    expect(await route(s, { type: 'ui-protect-request-save', expectedRevision: j.revision, request: input() })).toEqual({ schemaVersion: 1, type: 'error', code: 'limit-reached' });
  });

  it('hydration drops invalid and duplicate records and deletes them from the store', async () => {
    const db = new MemoryProtectDb();
    const s = await setup({ db });
    const j = await save(s, 0);
    const good = j.requests![0]!;
    await db.put('requests', { ...good, requestId: 'rq_zzzzzzzzzzzzzzzzzzzz', status: 'nonsense' });
    await db.put('requests', { requestId: 'rq_yyyyyyyyyyyyyyyyyyyy', identifier: CANARY });
    // A new lane instance (SW restart) re-reads the store.
    const s2 = await setup({ db });
    const again = journal(await route(s2, { type: 'ui-protect-requests-get', view: 'full' }));
    expect(again.droppedRecords).toBe(2);
    expect(again.requests!.map((r) => r.requestId)).toEqual([good.requestId]);
    expect(await db.count('requests')).toBe(1);
    expect(JSON.stringify([...db.stores.get('requests')!.values()])).not.toContain(CANARY);
  });

  it('storage failure answers storage-unavailable (no throw); purge requests drops the cache and the store', async () => {
    const s = await setup();
    await save(s, 0);
    s.db.failNext = 1;
    // The cached journal answers without storage; a write fails.
    const failed = await route(s, { type: 'ui-protect-request-save', expectedRevision: 1, request: input() });
    expect(failed).toEqual({ schemaVersion: 1, type: 'error', code: 'storage-unavailable' });
    await route(s, { type: 'ui-protect-purge', what: 'requests' });
    expect(await s.db.count('requests')).toBe(0);
    expect(await s.db.get('meta', 'requests-state')).toBeUndefined();
    expect(journal(await route(s, { type: 'ui-protect-requests-get', view: 'full' }))).toMatchObject({ revision: 0, requests: [] });
  });
});

describe('requests lane: drafts', () => {
  it('evidence: facts by allowlist, the https scheme of the document, other transfers to the same receiver, recipients from the table', async () => {
    const s = await setup();
    s.controller.onCommitted(committed({ url: 'https://www.shop-site.com/checkout', documentId: DOC }));
    s.controller.docStore.addEvidence(KEY, 7, { ...transfer(), value: CANARY } as unknown as ProtectTransferEvidence);
    s.controller.docStore.addEvidence(KEY, 7, transfer({ evidenceId: 'pe-8', encodings: ['plain'], location: 'query', paramName: 'em', requestKind: 'image', endpointPathTemplate: '/p', firstSecond: 9, interpretationConfidence: 'medium' }));
    s.controller.docStore.addEvidence(KEY, 7, transfer({ evidenceId: 'pe-9', receiver: 'other.example', endpointHost: 'other.example' }));
    s.controller.docStore.addEvidence(KEY, 7, transfer({ evidenceId: 'pe-10', deliveryState: 'stopped', endpointPathTemplate: '/stopped' }));
    const d = draft(await route(s, { type: 'ui-protect-request-draft', sourceKind: 'evidence', recordId: 'pe-7' }));
    expect(d.sourceMissing).toBe(false);
    expect(d.subjects).toEqual([
      { role: 'receiver', vendorId: null, domain: 'vendor-sim.test', entityName: 'vendor-sim.test' },
      { role: 'site', vendorId: null, domain: 'shop-site.com', entityName: 'shop-site.com' },
    ]);
    expect(d.facts).toHaveLength(2);
    expect(d.facts[0]).toMatchObject({ factKind: 'value-match', site: 'shop-site.com', receiverDomain: 'vendor-sim.test', endpoint: { scheme: 'https', host: 'px.vendor-sim.test', pathTemplate: '/collect' }, encoding: 'sha256-hex', interpretationConfidence: 'high', day: '2026-10-17' });
    expect(d.facts[1]).toMatchObject({ encoding: 'plain', location: 'query', parameterName: 'em' });
    expect(JSON.stringify(d)).not.toContain(CANARY);
    expect(d.recipients.receiver.map((r) => r.contactId)).toEqual(['vendor-sim']);
    expect(d.recipients.site.map((r) => [r.contactId, r.channel, r.address])).toEqual([['shop', 'portal', 'https://privacy.shop-site.com/request']]);
    expect(d.prefs).toEqual({ jurisdiction: null, letterLang: null });
    expect(d.gpcAvailable).toBe(false);
    // An http document: no endpoint scheme is known, so no endpoint is quoted.
    s.controller.onCommitted(committed({ tabId: 8, url: 'http://plain-site.com/', documentId: 'DOC000000000000000000000000000002' }));
    s.controller.docStore.addEvidence('8:0:DOC000000000000000000000000000002', 8, transfer({ evidenceId: 'pe-20' }));
    const plain = draft(await route(s, { type: 'ui-protect-request-draft', sourceKind: 'evidence', recordId: 'pe-20' }));
    expect(plain.facts[0]?.endpoint).toBeNull();
    // Unknown evidence (TTL, purge, closed tab): sourceMissing, nothing else.
    expect(draft(await route(s, { type: 'ui-protect-request-draft', sourceKind: 'evidence', recordId: 'pe-404' }))).toMatchObject({ sourceMissing: true, facts: [], subjects: [] });
    expect(draft(await route(s, { type: 'ui-protect-request-draft', sourceKind: 'manual' }))).toMatchObject({ sourceKind: 'manual', sourceMissing: false, facts: [] });
  });

  it('history: sightings of the receiver with a reported send, unassessed, newest first; a vendor row or an unknown receiver is missing', async () => {
    const s = await setup({ features: ['value-match', 'history', 'gpc'] });
    const today = historyDayIndex(NOW);
    const VM = HISTORY_SIGNAL_BITS['value-match'];
    const REPLAY = HISTORY_SIGNAL_BITS['replay-pattern'];
    for (const [site, ago, signals] of [['news.example', 3, REPLAY], ['shop.example', 1, VM | HISTORY_SIGNAL_BITS.request]] as const) {
      await s.db.put('sightings', applyHistorySightingDelta(undefined, { receiver: 'vendor-sim.test', site, day: today - ago, signals }));
    }
    // Attempts after the last send do not move the fact's day (only a send Chrome reported is quoted).
    const blog = applyHistorySightingDelta(undefined, { receiver: 'vendor-sim.test', site: 'blog.example', day: today - 10, signals: VM });
    await s.db.put('sightings', applyHistorySightingDelta(blog, { receiver: 'vendor-sim.test', site: 'blog.example', day: today, signals: HISTORY_SIGNAL_BITS.request }));
    // Attempts only (onBeforeRequest; a DNR-stopped request is one too, SP-2) and blocked only: no fact.
    await s.db.put('sightings', applyHistorySightingDelta(undefined, { receiver: 'vendor-sim.test', site: 'attempts.example', day: today, signals: HISTORY_SIGNAL_BITS.request }));
    await s.db.put('sightings', applyHistorySightingDelta(undefined, { receiver: 'vendor-sim.test', site: 'blocked.example', day: today, signals: HISTORY_SIGNAL_BITS['request-blocked'] }));
    await s.db.put('sightings', applyHistorySightingDelta(undefined, { receiver: 'other.example', site: 'news.example', day: today, signals: VM }));
    const d = draft(await route(s, { type: 'ui-protect-request-draft', sourceKind: 'history', recordId: 'd:vendor-sim.test' }));
    expect(d.subjects).toEqual([{ role: 'receiver', vendorId: null, domain: 'vendor-sim.test', entityName: 'vendor-sim.test' }]);
    expect(d.facts.map((f) => [f.site, f.day, f.factKind, f.interpretationConfidence])).toEqual([
      ['shop.example', '2026-10-16', 'cross-site-sighting', 'unassessed'],
      ['news.example', '2026-10-14', 'cross-site-sighting', 'unassessed'],
      ['blog.example', '2026-10-07', 'cross-site-sighting', 'unassessed'],
    ]);
    // Review round 2: a receiver the firewall blocked (blocked-only + attempts) is in the history but has no send:
    // the draft names it and quotes no observation (not a missing source).
    for (const [site, signals] of [['shop-a.com', HISTORY_SIGNAL_BITS['request-blocked']], ['shop-b.org', HISTORY_SIGNAL_BITS.request | HISTORY_SIGNAL_BITS['request-blocked']]] as const) {
      await s.db.put('sightings', applyHistorySightingDelta(undefined, { receiver: 'tracker.example', site, day: today, signals }));
    }
    const blocked = draft(await route(s, { type: 'ui-protect-request-draft', sourceKind: 'history', recordId: 'd:tracker.example' }));
    expect(blocked).toMatchObject({ sourceKind: 'history', sourceMissing: false, facts: [] });
    expect(blocked.subjects.map((x) => x.domain)).toEqual(['tracker.example']);
    expect(d.recipients.receiver[0]?.address).toBe('privacy@vendor-sim.test');
    expect(d.gpcAvailable).toBe(true);
    expect(draft(await route(s, { type: 'ui-protect-request-draft', sourceKind: 'history', recordId: 'v:some_vendor' }))).toMatchObject({ sourceMissing: true });
    expect(draft(await route(s, { type: 'ui-protect-request-draft', sourceKind: 'history', recordId: 'd:nobody.example' }))).toMatchObject({ sourceMissing: true });
  });
});

describe('requests lane: module not active', () => {
  it('view and delete stay possible after a disable without purge; drafts and saves need the active module', async () => {
    const s = await setup();
    const j = await save(s, 0);
    await route(s, { type: 'ui-protect-disable', purge: false });
    expect(s.controller.isActive).toBe(false);
    const view = journal(await route(s, { type: 'ui-protect-requests-get', view: 'full' }));
    expect(view.requests).toHaveLength(1);
    expect(s.db.status).toBe('closed');
    const req: ProtectUiRequest = { schemaVersion: 1, type: 'ui-protect-request-save', expectedRevision: 1, request: input() };
    expect(await s.controller.routeUi(req, optionsSender())).toEqual({ schemaVersion: 1, type: 'error', code: 'module-disabled' });
    expect(await route(s, { type: 'ui-protect-request-draft', sourceKind: 'manual' })).toEqual({ schemaVersion: 1, type: 'error', code: 'module-disabled' });
    expect(await route(s, { type: 'ui-protect-request-status', expectedRevision: 1, requestId: j.requests![0]!.requestId, status: 'sent', day: '2026-10-17' })).toEqual({ schemaVersion: 1, type: 'error', code: 'module-disabled' });
    const del = journal(await route(s, { type: 'ui-protect-request-delete', expectedRevision: 1, requestId: j.requests![0]!.requestId }));
    expect(del.requests).toEqual([]);
    expect(s.db.status).toBe('closed');
    expect(await s.db.count('requests')).toBe(0);
  });

  it('never enabled: module-disabled without touching IndexedDB; enabled once but the database is gone: an empty journal', async () => {
    const fresh = await setupController({ chrome: GRANTED });
    expect(await fresh.controller.routeUi({ schemaVersion: 1, type: 'ui-protect-requests-get', view: 'summary' }, popupSender())).toEqual({ schemaVersion: 1, type: 'error', code: 'module-disabled' });
    expect(fresh.dbCreated()).toBe(0);
    const db = new MemoryProtectDb();
    const off = await setup({ db, enabled: false });
    expect(journal(await route(off, { type: 'ui-protect-requests-get', view: 'full' }))).toMatchObject({ revision: 0, requests: [] });
    expect(db.created).toBe(false);
    expect(await route(off, { type: 'ui-protect-request-delete', expectedRevision: 0, requestId: 'rq_aaaaaaaaaaaaaaaaaaaa' })).toEqual({ schemaVersion: 1, type: 'error', code: 'not-found' });
    expect(db.created).toBe(false);
  });
});
