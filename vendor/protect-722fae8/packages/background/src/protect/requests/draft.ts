// ADR-020 §I (S14): context of a new data-request letter (RequestDraftContext). Facts are copied by allowlist from an
// evidence record of the module (storage.session doc-store, through the controller's doc-store and tab model) or from
// the history sightings of one receiver (IndexedDB `sightings`, read-only here: the history lane owns the store) — only
// sightings with a send Chrome reported (value-match / replay days); request attempts and blocks are never quoted.
// Missing source (TTL, purge, tab closed) → `sourceMissing`, no facts. The letter text, the user's identifier and name
// never pass through the SW: they exist only on requests.html.

import { PROTECT_BUDGETS, PROTECT_WIRE_LIMITS, isDomainName } from '@detect-expert/contracts';
import type { LocalDay, ProtectEvidence, RequestDraftContext, RequestEvidenceFact, RequestPrefs, RequestSourceKind, RequestSubject } from '@detect-expert/contracts';
import { parseHistorySightingRecord, rankRequestFacts, recipientCandidatesFor, requestFactFromEvidence, requestFactFromSighting } from '@detect-expert/engine';
import type { PrivacyContactRow } from '@detect-expert/engine';
import type { ProtectDb } from '../db-port';
import type { ProtectDocState, ProtectDocStore } from '../doc-store';
import type { ProtectTabModel } from '../tab-model';

/** Facts of sightings of one receiver kept at most for a draft before ranking (the newest facts are kept). */
const MAX_DRAFT_SIGHTINGS = 512;
/** Sighting records of one receiver scanned at most for a draft. */
const MAX_DRAFT_SCAN = 4096;

export interface DraftSources {
  docStore: ProtectDocStore;
  tabModel: ProtectTabModel;
  db: ProtectDb | null;
  contacts: readonly PrivacyContactRow[];
  /** Local day of an epoch ms (browser time zone). */
  localDay: (epochMs: number) => LocalDay | null;
  prefs: RequestPrefs;
  gpcAvailable: boolean;
}

interface FoundEvidence {
  tabId: number;
  documentKey: string;
  doc: Readonly<ProtectDocState>;
  evidence: Readonly<ProtectEvidence>;
}

/** The evidence record with this id in the documents of known tabs (newest document first). */
function findEvidence(sources: DraftSources, evidenceId: string): FoundEvidence | null {
  for (const entry of sources.tabModel.entries()) {
    const docs = sources.docStore.docsOfTab(entry.tabId);
    for (let i = docs.length - 1; i >= 0; i--) {
      const [documentKey, doc] = docs[i]!;
      const evidence = doc.evidence.find((e) => e.evidenceId === evidenceId);
      if (evidence !== undefined) return { tabId: entry.tabId, documentKey, doc, evidence };
    }
  }
  return null;
}

function subject(role: 'receiver' | 'site', domain: string): RequestSubject {
  return { role, vendorId: null, domain, entityName: domain };
}

function emptyDraft(sourceKind: RequestSourceKind, sourceMissing: boolean, sources: DraftSources): RequestDraftContext {
  return { sourceKind, sourceMissing, subjects: [], facts: [], recipients: { receiver: [], site: [] }, prefs: { ...sources.prefs }, gpcAvailable: sources.gpcAvailable };
}

function withSubjects(base: RequestDraftContext, receiver: string | null, site: string | null, facts: RequestEvidenceFact[], sources: DraftSources): RequestDraftContext {
  const subjects: RequestSubject[] = [];
  if (receiver !== null && isDomainName(receiver)) subjects.push(subject('receiver', receiver));
  if (site !== null && isDomainName(site) && site !== receiver) subjects.push(subject('site', site));
  return {
    ...base,
    subjects: subjects.slice(0, PROTECT_WIRE_LIMITS.maxSubjects),
    facts: rankRequestFacts(facts),
    recipients: {
      receiver: recipientCandidatesFor(sources.contacts, receiver),
      site: recipientCandidatesFor(sources.contacts, site !== receiver ? site : null),
    },
  };
}

function evidenceDraft(sources: DraftSources, evidenceId: string): RequestDraftContext {
  const found = findEvidence(sources, evidenceId);
  if (found === null) return emptyDraft('evidence', true, sources);
  const tab = sources.tabModel.get(found.tabId);
  const isTop = sources.tabModel.topDocumentKey(found.tabId) === found.documentKey;
  const e = found.evidence;
  // The top-level site: the tab's current site for its current document; otherwise the browser-reported initiator of
  // a top-frame transfer. Without it the evidence cannot be quoted (a fact names its site).
  const initiator = 'initiatorSite' in e && e.frameContext === 'top' ? (e.initiatorSite ?? null) : null;
  const site = isTop ? (tab?.site ?? null) : initiator;
  const scheme = isTop && tab?.scheme === 'https' ? 'https' : null;
  const receiver = e.protectKind === 'password-field-listener' ? null : (e.receiver ?? null);
  const facts: RequestEvidenceFact[] = [];
  if (site !== null) {
    const factOf = (x: Readonly<ProtectEvidence>): RequestEvidenceFact | null => {
      const day = sources.localDay(found.doc.createdAt + x.firstSecond * 1000);
      return day === null ? null : requestFactFromEvidence(x, { day, site, endpointScheme: scheme });
    };
    const first = factOf(e);
    if (first !== null) facts.push(first);
    // Other observations of the same receiver in the same document (sent transfers, recording, listener facts).
    for (const other of found.doc.evidence) {
      if (other === e || facts.length >= PROTECT_BUDGETS.maxFactsPerRequest * 2) continue;
      const otherReceiver = other.protectKind === 'password-field-listener' ? null : (other.receiver ?? null);
      if (receiver === null || otherReceiver !== receiver) continue;
      const f = factOf(other);
      if (f !== null) facts.push(f);
    }
  }
  return withSubjects(emptyDraft('evidence', false, sources), receiver, site, facts, sources);
}

async function historyDraft(sources: DraftSources, rowKey: string): Promise<RequestDraftContext> {
  // Vendor rows exist only with enabled catalog rules (none in production): no receiver to look up.
  if (!rowKey.startsWith('d:') || sources.db === null) return emptyDraft('history', true, sources);
  const receiver = rowKey.slice(2);
  if (!isDomainName(receiver)) return emptyDraft('history', true, sources);
  // Only a send Chrome reported is quoted (ADR-020 §11, review round 2): requestFactFromSighting takes the sighting's
  // value-match / replay day and returns null without one. Attempts (`request`, onBeforeRequest — a DNR-stopped
  // request is one too, SP-2) and our blocks are never «sent».
  const facts: RequestEvidenceFact[] = [];
  let found = 0;
  let scanned = 0;
  await sources.db.iterate<unknown>('sightings', { index: 'byReceiver', range: { lower: receiver, upper: receiver }, chunk: 128 }, (records) => {
    for (const raw of records) {
      scanned++;
      const s = parseHistorySightingRecord(raw);
      if (s === null || s.receiver !== receiver) continue;
      found++;
      const f = requestFactFromSighting(s);
      if (f !== null) facts.push(f);
    }
    return facts.length < MAX_DRAFT_SIGHTINGS && scanned < MAX_DRAFT_SCAN;
  });
  // The receiver is in the history but nothing was reported sent: a draft without observations (not a missing source).
  if (found === 0) return emptyDraft('history', true, sources);
  return withSubjects(emptyDraft('history', false, sources), receiver, null, facts, sources);
}

/** Draft context of a source; storage errors throw (the service answers storage-unavailable). */
export async function buildRequestDraft(sources: DraftSources, sourceKind: RequestSourceKind, recordId: string | undefined): Promise<RequestDraftContext> {
  if (sourceKind === 'manual' || recordId === undefined) return emptyDraft(sourceKind, sourceKind !== 'manual', sources);
  if (sourceKind === 'evidence') return evidenceDraft(sources, recordId);
  return historyDraft(sources, recordId);
}
