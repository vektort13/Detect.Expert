// ADR-020 §I (S14): pure logic of the data-request journal — calendar arithmetic (golden vectors), deadlines and their
// states, the journal reducer (transitions, TTL 30/365/730, limits 100 records / 512 KiB), fact adapters (allowlist copy
// against a canary in an extra field; only sent transfers), the requests.html hash and the privacy-contacts lint.

import { describe, expect, it } from 'vitest';
import { PROTECT_BUDGETS, validateStoredRequestJournal } from '@detect-expert/contracts';
import type { DeletionRequestRecord, NewRequestInput, ProtectTransferEvidence, RequestEvidenceFact } from '@detect-expert/contracts';
import {
  addRequestBusinessDays,
  addRequestDays,
  addRequestMonths,
  requestDayFromNumber,
  requestDayNumber,
  requestLocalDay,
  requestWeekday,
} from '../src/protect/requests/days';
import { computeRequestDeadline, requestDueView } from '../src/protect/requests/deadline';
import {
  addRequestRecord,
  applyRequestRetention,
  deleteRequestRecord,
  emptyRequestJournal,
  requestJournalSummary,
  setRequestStatus,
  sortedRequestRecords,
} from '../src/protect/requests/journal';
import { rankRequestFacts, requestFactCheckedByDefault, requestFactFromEvidence, requestFactFromSighting, requestSightingSentDay } from '../src/protect/requests/facts';
import { historyDayIndex, historyDayString } from '../src/protect/history/day-mask';
import { applySightingDelta } from '../src/protect/history/merge';
import { HISTORY_SIGNAL_BITS } from '../src/protect/history/records';

/** A history sighting record with one value-match day (a send Chrome reported) on `day` (YYYY-MM-DD, UTC). */
function sentSighting(receiver: string, site: string, day: string) {
  return applySightingDelta(undefined, { receiver, site, day: historyDayIndex(Date.parse(day + 'T00:00:00Z')), signals: HISTORY_SIGNAL_BITS['value-match'] });
}
import { parseRequestPageHash, requestPageHash } from '../src/protect/requests/page-hash';
import { lintPrivacyContacts, parsePrivacyContactRows, recipientCandidatesFor } from '../src/protect/requests/contacts';

const CANARY = 'CANARY-EXTRA-FIELD-91c3';

function input(over: Partial<NewRequestInput> = {}): NewRequestInput {
  return {
    sourceKind: 'manual',
    jurisdiction: 'gdpr-eu-eea',
    kinds: ['access', 'erasure'],
    letterLang: 'en',
    templateId: 'gdpr-eu-eea',
    templateVersion: '2026-10-17',
    subject: { role: 'receiver', vendorId: null, domain: 'tracker.example', entityName: 'Tracker Example Ltd' },
    recipient: { source: 'manual', channel: 'email', address: 'privacy@tracker.example' },
    facts: [],
    identityKinds: ['sender-address'],
    delivery: 'mailto',
    mentionGpc: false,
    ...over,
  };
}

/** Distinct journal ids rq_aaa…<base-26 letters of n>. */
function id(n: number): string {
  let s = '';
  let x = n;
  do {
    s = String.fromCharCode(97 + (x % 26)) + s;
    x = Math.floor(x / 26);
  } while (x > 0);
  return 'rq_' + ('a'.repeat(20) + s).slice(-20);
}

describe('days: calendar arithmetic (golden vectors)', () => {
  it('months clamp to the month end; business days skip weekends; weekdays', () => {
    expect(addRequestMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addRequestMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addRequestMonths('2026-11-30', 3)).toBe('2027-02-28');
    expect(addRequestMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addRequestDays('2026-10-17', 45)).toBe('2026-12-01');
    expect(requestWeekday('2026-10-16')).toBe(5);
    expect(addRequestBusinessDays('2026-10-16', 10)).toBe('2026-10-30');
    expect(addRequestBusinessDays('2026-10-17', 1)).toBe('2026-10-19');
    expect(requestDayFromNumber(requestDayNumber('2026-03-29'))).toBe('2026-03-29');
    expect(requestLocalDay(2026, 2, 30)).toBeNull();
    expect(requestLocalDay(2026, 10, 7)).toBe('2026-10-07');
    expect(addRequestDays('2999-12-31', 1)).toBeNull();
  });
});

describe('deadline: approximate, unreviewed, from the sending day', () => {
  it('GDPR one month (+ extension to three), CCPA 45 days (+45), opt-out 15 business days, 152-FZ 10 (+5) working days', () => {
    expect(computeRequestDeadline('gdpr-eu-eea', ['access'], '2026-01-31')).toEqual({ deadlineDay: '2026-02-28', extendedDeadlineDay: '2026-04-30', ruleId: 'gdpr-art-12-3', extendedRuleId: 'gdpr-art-12-3' });
    expect(computeRequestDeadline('gdpr-uk', ['erasure', 'objection'], '2026-10-17')?.deadlineDay).toBe('2026-11-17');
    expect(computeRequestDeadline('ccpa-ca', ['access', 'erasure'], '2026-10-17')).toEqual({ deadlineDay: '2026-12-01', extendedDeadlineDay: '2027-01-15', ruleId: 'ccpa-1798-130', extendedRuleId: 'ccpa-1798-130' });
    // Mixed CCPA kinds: the earliest base deadline (opt-out, candidate), the latest extension (access).
    expect(computeRequestDeadline('ccpa-ca', ['access', 'opt-out-sale-sharing'], '2026-10-16')).toEqual({
      deadlineDay: '2026-11-06',
      extendedDeadlineDay: '2027-01-14',
      ruleId: 'ccpa-opt-out-15-business-days',
      extendedRuleId: 'ccpa-1798-130',
    });
    expect(computeRequestDeadline('ccpa-ca', ['opt-out-sale-sharing'], '2026-10-16')?.extendedDeadlineDay).toBeNull();
    expect(computeRequestDeadline('pdl-ru-152', ['access'], '2026-10-16')).toEqual({ deadlineDay: '2026-10-30', extendedDeadlineDay: '2026-11-06', ruleId: 'pdl-152-art-20', extendedRuleId: 'pdl-152-art-20' });
  });

  it('states: pending, due-soon (≤ 3 days), overdue; only while waiting for an answer', () => {
    const r: Pick<DeletionRequestRecord, 'status' | 'sentDay' | 'deadlineDay' | 'extendedDeadlineDay' | 'jurisdiction' | 'kinds'> = {
      status: 'sent', sentDay: '2026-10-01', deadlineDay: '2026-11-01', extendedDeadlineDay: '2027-01-01', jurisdiction: 'gdpr-eu-eea', kinds: ['access'],
    };
    expect(requestDueView(r, '2026-10-28')).toMatchObject({ state: 'pending', dueDay: '2026-11-01', daysLeft: 4, ruleId: 'gdpr-art-12-3' });
    expect(requestDueView(r, '2026-10-29')?.state).toBe('due-soon');
    expect(requestDueView(r, '2026-11-01')?.state).toBe('due-soon');
    expect(requestDueView(r, '2026-11-02')).toMatchObject({ state: 'overdue', daysLeft: -1 });
    expect(requestDueView({ ...r, status: 'extended' }, '2026-11-02')).toMatchObject({ state: 'pending', dueDay: '2027-01-01' });
    for (const status of ['prepared', 'answered', 'complaint-filed', 'closed'] as const) expect(requestDueView({ ...r, status }, '2026-11-02')).toBeNull();
  });
});

describe('journal reducer', () => {
  it('adds a prepared record (prefs remembered), marks it sent with deadlines, closes, deletes; the result validates', () => {
    let j = emptyRequestJournal();
    const added = addRequestRecord(j, input(), id(1), '2026-10-17');
    if (!added.ok) throw new Error(added.code);
    j = added.journal;
    expect(j.revision).toBe(1);
    expect(j.prefs).toEqual({ jurisdiction: 'gdpr-eu-eea', letterLang: 'en' });
    expect(added.record).toMatchObject({ status: 'prepared', createdDay: '2026-10-17', statusDay: '2026-10-17', sentDay: null, deadlineDay: null, history: [{ status: 'prepared', day: '2026-10-17' }] });
    const sent = setRequestStatus(j, id(1), 'sent', '2026-10-18', '2026-10-18');
    if (!sent.ok) throw new Error(sent.code);
    expect(sent.record).toMatchObject({ status: 'sent', sentDay: '2026-10-18', deadlineDay: '2026-11-18', extendedDeadlineDay: '2027-01-18' });
    j = sent.journal;
    expect(requestJournalSummary(j, '2026-11-16')).toEqual({ total: 1, open: 1, dueSoon: 1, overdue: 0 });
    expect(requestJournalSummary(j, '2026-11-19')).toEqual({ total: 1, open: 1, dueSoon: 0, overdue: 1 });
    expect(validateStoredRequestJournal(j)).toMatchObject({ ok: true, value: { droppedRecords: 0 } });
    // Transitions follow REQUEST_STATUS_TRANSITIONS; days not before creation and not in the future.
    expect(setRequestStatus(j, id(1), 'sent', '2026-10-19', '2026-10-19')).toEqual({ ok: false, code: 'invalid-request' });
    expect(setRequestStatus(j, id(1), 'answered', '2026-10-20', '2026-10-19')).toEqual({ ok: false, code: 'invalid-request' });
    expect(setRequestStatus(j, id(1), 'answered', '2026-10-16', '2026-10-19')).toEqual({ ok: false, code: 'invalid-request' });
    expect(setRequestStatus(j, id(9), 'answered', '2026-10-19', '2026-10-19')).toEqual({ ok: false, code: 'not-found' });
    const closed = setRequestStatus(j, id(1), 'closed', '2026-10-20', '2026-10-20');
    if (!closed.ok) throw new Error(closed.code);
    expect(closed.record?.history.map((h) => h.status)).toEqual(['prepared', 'sent', 'closed']);
    expect(setRequestStatus(closed.journal, id(1), 'answered', '2026-10-20', '2026-10-20')).toEqual({ ok: false, code: 'invalid-request' });
    const del = deleteRequestRecord(closed.journal, id(1));
    expect(del.ok && del.journal.requests.length).toBe(0);
    expect(deleteRequestRecord(closed.journal, id(2))).toEqual({ ok: false, code: 'not-found' });
  });

  it('TTL: prepared 30 days, closed 365 days after the status day, any record 730 days', () => {
    let j = emptyRequestJournal();
    for (const [n, day] of [[1, '2026-01-01'], [2, '2026-01-01'], [3, '2026-01-01'], [4, '2026-01-20']] as const) {
      const r = addRequestRecord(j, input(), id(n), day);
      if (!r.ok) throw new Error(r.code);
      j = r.journal;
    }
    const sent = setRequestStatus(j, id(2), 'sent', '2026-01-02', '2026-01-02');
    if (!sent.ok) throw new Error(sent.code);
    const closed = setRequestStatus(sent.journal, id(3), 'closed', '2026-01-05', '2026-01-05');
    if (!closed.ok) throw new Error(closed.code);
    j = closed.journal;
    expect(applyRequestRetention(j, '2026-01-30').removed).toEqual([]);
    expect(applyRequestRetention(j, '2026-01-31').removed).toEqual([id(1)]);
    const after = applyRequestRetention(j, '2027-01-05');
    expect(after.removed).toEqual([id(1), id(3), id(4)]);
    expect(after.journal.revision).toBe(j.revision + 1);
    expect(applyRequestRetention(after.journal, '2027-12-31').removed).toEqual([]);
    expect(applyRequestRetention(after.journal, '2028-01-01').removed).toEqual([id(2)]);
  });

  it('limits: 100 records, the record budget and the 512 KiB journal budget (counted without serializing)', () => {
    let j = emptyRequestJournal();
    for (let n = 1; n <= PROTECT_BUDGETS.maxRequests; n++) {
      const r = addRequestRecord(j, input(), id(n), '2026-10-17');
      if (!r.ok) throw new Error(r.code);
      j = r.journal;
    }
    expect(addRequestRecord(j, input(), id(500), '2026-10-17')).toEqual({ ok: false, code: 'limit-reached' });
    expect(addRequestRecord(emptyRequestJournal(), input(), id(1), 'not-a-day')).toEqual({ ok: false, code: 'invalid-request' });
    const big = { ...input(), subject: { role: 'receiver' as const, vendorId: null, domain: 'tracker.example', entityName: 'x'.repeat(128) } };
    const facts: RequestEvidenceFact[] = Array.from({ length: 8 }, (_, i) => ({
      ...requestFactFromSighting(sentSighting('r' + 'q'.repeat(60) + String(i) + '.example', 's' + 'w'.repeat(60) + '.example', '2026-10-1' + String(i)))!,
      endpoint: { scheme: 'https', host: 'e' + 'n'.repeat(60) + '.example', pathTemplate: '/' + ['p'.repeat(40), 'q'.repeat(40), 'r'.repeat(40), 's'.repeat(30)].join('/') },
      parameterName: 'p'.repeat(48),
    }));
    const r = addRequestRecord(emptyRequestJournal(), { ...big, sourceKind: 'history', facts }, id(1), '2026-10-17');
    expect(r.ok).toBe(true);
  });

  it('sorts newest first', () => {
    let j = emptyRequestJournal();
    for (const [n, day] of [[1, '2026-10-01'], [2, '2026-10-03'], [3, '2026-10-02']] as const) {
      const r = addRequestRecord(j, input(), id(n), day);
      if (r.ok) j = r.journal;
    }
    expect(sortedRequestRecords(j.requests).map((r: DeletionRequestRecord) => r.requestId)).toEqual([id(2), id(3), id(1)]);
  });
});

function transfer(over: Partial<ProtectTransferEvidence> = {}): ProtectTransferEvidence {
  return {
    evidenceId: 'pe-1',
    frameContext: 'top',
    attributionConfidence: 'unknown',
    count: 1,
    countQuality: 'exact',
    firstSecond: 3,
    lastSecond: 3,
    evidenceSource: 'derived',
    integrity: 'derived',
    ruleVersion: '1',
    limitationCodes: [],
    protectKind: 'value-match',
    ruleId: 'form-leak',
    transferClass: 'third-party-before-submit',
    fieldKind: 'email',
    encodings: ['sha256-hex', 'plain'],
    location: 'body-json',
    paramName: 'ud[em]',
    receiver: 'tracker.example',
    relation: 'cross-site',
    method: 'POST',
    requestKind: 'beacon',
    endpointHost: 'px.tracker.example',
    endpointPathTemplate: '/collect/:id',
    submitTiming: 'before-submit',
    deliveryState: 'sent',
    interpretationConfidence: 'high',
    ...over,
  };
}

describe('facts: allowlist copy from evidence and history', () => {
  it('copies by name only: a canary in an extra field never reaches the fact', () => {
    const e = { ...transfer(), value: CANARY, hash: CANARY, url: 'https://px.tracker.example/collect/9?em=' + CANARY } as unknown as ProtectTransferEvidence;
    const f = requestFactFromEvidence(e, { day: '2026-10-17', site: 'shop.example', endpointScheme: 'https' });
    expect(f).toEqual({
      factKind: 'value-match', day: '2026-10-17', site: 'shop.example', receiverDomain: 'tracker.example',
      endpoint: { scheme: 'https', host: 'px.tracker.example', pathTemplate: '/collect/:id' }, script: null, dataKind: 'email', encoding: 'plain',
      location: 'body-json', parameterName: 'ud[em]', submitTiming: 'before-submit', techniqueIds: [], vendorId: null,
      evidenceSource: 'derived', integrity: 'derived', interpretationConfidence: 'high',
    });
    expect(JSON.stringify(f)).not.toContain(CANARY);
  });

  it('only sent transfers; no endpoint without a known scheme or for a navigation; scripts only from a stack sample', () => {
    expect(requestFactFromEvidence(transfer({ deliveryState: 'stopped' }), { day: '2026-10-17', site: 'shop.example', endpointScheme: 'https' })).toBeNull();
    expect(requestFactFromEvidence(transfer({ deliveryState: 'unknown' }), { day: '2026-10-17', site: 'shop.example', endpointScheme: 'https' })).toBeNull();
    expect(requestFactFromEvidence(transfer(), { day: '2026-10-17', site: 'shop.example', endpointScheme: null })?.endpoint).toBeNull();
    expect(requestFactFromEvidence(transfer({ requestKind: 'navigation' }), { day: '2026-10-17', site: 'shop.example', endpointScheme: 'https' })?.endpoint).toBeNull();
    const script = { kind: 'external' as const, scheme: 'https' as const, host: 'cdn.tracker.example', pathTemplate: '/t.js' };
    expect(requestFactFromEvidence(transfer({ script }), { day: '2026-10-17', site: 'shop.example', endpointScheme: 'https' })?.script).toBeNull();
    expect(requestFactFromEvidence(transfer({ script, attributionConfidence: 'sampled-stack' }), { day: '2026-10-17', site: 'shop.example', endpointScheme: 'https' })?.script).toEqual(script);
    expect(requestFactFromEvidence(transfer(), { day: 'yesterday', site: 'shop.example', endpointScheme: 'https' })).toBeNull();
    expect(requestFactFromEvidence(transfer({ receiver: undefined as never, receiverCategory: 'loopback' } as never), { day: '2026-10-17', site: 'shop.example', endpointScheme: null })?.receiverDomain).toBeNull();
  });

  it('history sightings are unassessed; ranking: confidence, then newest; ≤ 8; low and unassessed unticked', () => {
    const s = requestFactFromSighting(sentSighting('tracker.example', 'news.example', '2026-10-10'))!;
    expect(s).toMatchObject({ factKind: 'cross-site-sighting', day: '2026-10-10', interpretationConfidence: 'unassessed', evidenceSource: 'browser-network', integrity: 'browser-observed' });
    expect(requestFactFromSighting(sentSighting('https://x', 'news.example', '2026-10-10'))).toBeNull();
    const high = requestFactFromEvidence(transfer(), { day: '2026-10-01', site: 'shop.example', endpointScheme: null })!;
    const low = requestFactFromEvidence(transfer({ interpretationConfidence: 'low', paramName: 'x' }), { day: '2026-10-17', site: 'shop.example', endpointScheme: null })!;
    const many = Array.from({ length: 12 }, (_, i) => requestFactFromSighting(sentSighting('tracker.example', 's' + String(i) + '.example', '2026-10-' + String(10 + i)))!);
    const ranked = rankRequestFacts([s, low, ...many, high, high]);
    expect(ranked).toHaveLength(PROTECT_BUDGETS.maxFactsPerRequest);
    expect(ranked[0]).toBe(high);
    expect(ranked[1]).toBe(low);
    expect(ranked[2]?.day).toBe('2026-10-21');
    expect([high, low, s].map(requestFactCheckedByDefault)).toEqual([true, false, false]);
  });

  it('a history sighting is quotable only with a send Chrome reported (value-match / replay day); attempts and blocks are not (review round 2)', () => {
    const D = 20_000;
    const sighting = (parts: Array<{ day: number; signals: number }>) => {
      let rec: ReturnType<typeof applySightingDelta> | undefined;
      for (const p of parts) rec = applySightingDelta(rec, { receiver: 'tracker.example', site: 'shop-a.com', day: p.day, signals: p.signals });
      return rec!;
    };
    // The reviewer's case: only the firewall's `blocked` event → seen + blocked bits, empty request mask, no send.
    const blockedOnly = sighting([{ day: D, signals: HISTORY_SIGNAL_BITS['request-blocked'] }]);
    expect(blockedOnly.request).toEqual([0, 0, 0]);
    expect(requestSightingSentDay(blockedOnly)).toBeNull();
    expect(requestFactFromSighting(blockedOnly)).toBeNull();
    // onBeforeRequest attempts (a DNR-stopped request is one too, SP-2), with or without our blocks: no send.
    const attempts = sighting([{ day: D, signals: HISTORY_SIGNAL_BITS.request | HISTORY_SIGNAL_BITS['request-blocked'] }]);
    expect(requestSightingSentDay(attempts)).toBeNull();
    expect(requestFactFromSighting(attempts)).toBeNull();
    expect(requestSightingSentDay(sighting([{ day: D, signals: HISTORY_SIGNAL_BITS.request | HISTORY_SIGNAL_BITS.frame }]))).toBeNull();
    // Sent signals: the newest value-match / replay day, not the newest attempt.
    const sentThenAttempts = sighting([{ day: D - 5, signals: HISTORY_SIGNAL_BITS['value-match'] }, { day: D, signals: HISTORY_SIGNAL_BITS.request }]);
    expect(requestSightingSentDay(sentThenAttempts)).toBe(D - 5);
    expect(requestFactFromSighting(sentThenAttempts)?.day).toBe(historyDayString(D - 5));
    expect(requestSightingSentDay(sighting([{ day: D - 5, signals: HISTORY_SIGNAL_BITS['value-match'] }, { day: D - 2, signals: HISTORY_SIGNAL_BITS['replay-pattern'] }]))).toBe(D - 2);
    expect(requestSightingSentDay(sighting([{ day: D - 1, signals: HISTORY_SIGNAL_BITS['replay-pattern'] }]))).toBe(D - 1);
  });
});

describe('requests.html hash', () => {
  it('parses #new=(evidence|history|manual)(.<id>)? strictly', () => {
    expect(parseRequestPageHash('#new=manual')).toEqual({ sourceKind: 'manual' });
    expect(parseRequestPageHash('#new=evidence.pe-1a')).toEqual({ sourceKind: 'evidence', recordId: 'pe-1a' });
    expect(parseRequestPageHash('#new=history.d:tracker.example')).toEqual({ sourceKind: 'history', recordId: 'd:tracker.example' });
    for (const bad of ['', '#', '#new=', '#new=manual.x', '#new=evidence', '#new=evidence.', '#new=evidence.PE-1', '#new=history.d:Tracker.example', '#new=history.x:y',
      '#new=evidence.pe-1&x=1', '#new=evidence.pe-1%20', '#old=manual', '#new=history.d:' + 'a'.repeat(300), '#new=other.pe-1']) {
      expect(parseRequestPageHash(bad), bad).toBeNull();
    }
    for (const src of [{ sourceKind: 'manual' }, { sourceKind: 'evidence', recordId: 'pe-z' }, { sourceKind: 'history', recordId: 'v:vendor_1' }] as const) {
      expect(parseRequestPageHash(requestPageHash(src))).toEqual(src);
    }
  });
});

describe('privacy-contacts table', () => {
  const policy = { allowPrivacyContacts: false, minReviewers: 1, maxReviewIntervalDays: 180 };
  const contact = {
    contactId: 'vendor-sim',
    entityName: 'Vendor Sim (synthetic)',
    domains: ['vendor-sim.test'],
    channel: 'email',
    address: 'privacy@vendor-sim.test',
    jurisdictions: ['gdpr-eu-eea', 'ccpa-ca'],
    source: 'https://vendor-sim.test/privacy',
    accessedAt: '2026-10-01',
    reviewedAt: '2026-10-02',
    reviewers: ['synthetic-reviewer'],
    productionEnabled: false,
  };
  const data = (contacts: unknown[]) => ({ schemaVersion: 1, contactsVersion: '2026-10-17.0', contacts });

  it('lint: https source on the domain, accessedAt ≤ reviewedAt, reviewers, address domain, duplicates', () => {
    expect(lintPrivacyContacts(data([contact]), { today: '2026-10-17', policy, synthetic: true })).toMatchObject({ errors: [], rows: [{ contactId: 'vendor-sim', contactsVersion: '2026-10-17.0', address: 'privacy@vendor-sim.test' }] });
    // A form is generated as host + path (no URL literal in shipped tables).
    const portal = { ...contact, contactId: 'portal-only', domains: ['portal-only.test'], channel: 'portal', address: 'https://privacy.portal-only.test/request', source: 'https://www.portal-only.test/privacy' };
    const generated = lintPrivacyContacts(data([portal]), { today: '2026-10-17', policy, synthetic: true });
    expect(generated.errors).toEqual([]);
    expect(generated.rows[0]).toEqual({
      contactId: 'portal-only', contactsVersion: '2026-10-17.0', entityName: 'Vendor Sim (synthetic)', domains: ['portal-only.test'], channel: 'portal',
      portalHost: 'privacy.portal-only.test', portalPath: '/request', jurisdictions: ['gdpr-eu-eea', 'ccpa-ca'], accessedAt: '2026-10-01', reviewedAt: '2026-10-02',
    });
    expect(JSON.stringify(generated.rows)).not.toContain('https:');
    expect(parsePrivacyContactRows(generated.rows)[0]?.address).toBe('https://privacy.portal-only.test/request');
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ source: 'http://vendor-sim.test/privacy' }, /https/],
      [{ source: 'https://elsewhere.test/privacy' }, /one of the domains/],
      [{ accessedAt: '2026-10-03' }, /accessedAt/],
      [{ reviewers: [] }, /reviewer/],
      [{ address: 'privacy@other.test' }, /address must lie/],
      [{ address: 'privacy?cc=x@vendor-sim.test' }, /address must lie/],
      [{ domains: ['vendor-sim.com'] }, /reserved \.test|one of the domains/],
      [{ reviewedAt: '2026-10-18', accessedAt: '2026-10-18' }, /future/],
      [{ productionEnabled: true }, /never production/],
      [{ extra: 1 }, /unknown field/],
    ];
    for (const [over, re] of cases) {
      const r = lintPrivacyContacts(data([{ ...contact, ...over }]), { today: '2026-10-17', policy, synthetic: true });
      expect(r.errors.join('\n'), JSON.stringify(over)).toMatch(re);
      expect(r.rows).toEqual([]);
    }
    expect(lintPrivacyContacts(data([contact, contact]), { today: '2026-10-17', policy, synthetic: true }).errors.join('\n')).toMatch(/duplicate contactId[\s\S]*duplicate address/);
  });

  it('production: empty unless the policy allows it, the entry is enabled and the review is fresh', () => {
    const real = { ...contact, contactId: 'real-co', domains: ['real-co.com'], address: 'dpo@real-co.com', source: 'https://www.real-co.com/privacy' };
    expect(lintPrivacyContacts(data([real]), { today: '2026-10-17', policy, synthetic: false })).toMatchObject({ errors: [], rows: [] });
    expect(lintPrivacyContacts(data([{ ...real, productionEnabled: true }]), { today: '2026-10-17', policy, synthetic: false }).errors.join()).toMatch(/does not allow/);
    const open = { ...policy, allowPrivacyContacts: true };
    expect(lintPrivacyContacts(data([{ ...real, productionEnabled: true }]), { today: '2026-10-17', policy: open, synthetic: false }).rows).toHaveLength(1);
    expect(lintPrivacyContacts(data([{ ...real, productionEnabled: true }]), { today: '2027-10-17', policy: open, synthetic: false }).errors.join()).toMatch(/older than 180/);
    expect(lintPrivacyContacts(data([real]), { today: '2027-10-17', policy, synthetic: false }).warnings.join()).toMatch(/older than 180/);
  });

  it('runtime rows: invalid ones dropped; candidates by exact registrable domain', () => {
    const rows = parsePrivacyContactRows([
      { contactId: 'vendor-sim', contactsVersion: 's1', entityName: 'Vendor Sim', domains: ['vendor-sim.test'], channel: 'email', address: 'privacy@vendor-sim.test', jurisdictions: ['ccpa-ca', 'gdpr-eu-eea'], accessedAt: '2026-10-01', reviewedAt: '2026-10-02' },
      { contactId: 'portal-only', contactsVersion: 's1', entityName: 'Portal Only', domains: ['portal-only.test'], channel: 'portal', portalHost: 'privacy.portal-only.test', portalPath: '/request', jurisdictions: ['gdpr-eu-eea'], accessedAt: '2026-10-01', reviewedAt: '2026-10-02' },
      // A form row must not carry a literal link, an e-mail row no host/path.
      { contactId: 'portal-literal', contactsVersion: 's1', entityName: 'Portal Literal', domains: ['portal-only.test'], channel: 'portal', address: 'https://privacy.portal-only.test/request', jurisdictions: ['gdpr-eu-eea'], accessedAt: '2026-10-01', reviewedAt: '2026-10-02' },
      { contactId: 'mixed', contactsVersion: 's1', entityName: 'Mixed', domains: ['vendor-sim.test'], channel: 'email', address: 'dpo@vendor-sim.test', portalHost: 'vendor-sim.test', jurisdictions: ['gdpr-eu-eea'], accessedAt: '2026-10-01', reviewedAt: '2026-10-02' },
      { contactId: 'portal-query', contactsVersion: 's1', entityName: 'Portal Query', domains: ['portal-only.test'], channel: 'portal', portalHost: 'privacy.portal-only.test', portalPath: '/request?x=1', jurisdictions: ['gdpr-eu-eea'], accessedAt: '2026-10-01', reviewedAt: '2026-10-02' },
      { contactId: 'bad', contactsVersion: 's1', entityName: 'Bad', domains: ['bad.test'], channel: 'email', address: 'privacy@elsewhere.test', jurisdictions: ['gdpr-eu-eea'], accessedAt: '2026-10-01', reviewedAt: '2026-10-02' },
      null,
    ]);
    expect(rows.map((r) => r.contactId)).toEqual(['vendor-sim', 'portal-only']);
    expect(rows[0]?.jurisdictions).toEqual(['gdpr-eu-eea', 'ccpa-ca']);
    expect(recipientCandidatesFor(rows, 'portal-only.test')).toEqual([
      { contactId: 'portal-only', contactsVersion: 's1', entityName: 'Portal Only', channel: 'portal', address: 'https://privacy.portal-only.test/request', jurisdictions: ['gdpr-eu-eea'], accessedAt: '2026-10-01', reviewedAt: '2026-10-02' },
    ]);
    expect(recipientCandidatesFor(rows, 'sub.vendor-sim.test')).toEqual([]);
    expect(recipientCandidatesFor(rows, null)).toEqual([]);
  });
});
