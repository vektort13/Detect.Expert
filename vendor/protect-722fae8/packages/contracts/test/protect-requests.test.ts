// ADR-020 «Защита» (S02): request journal formats, status transitions, record budget and hydration.
import { describe, expect, it } from 'vitest';
import {
  JURISDICTION_LETTER_LANGS,
  JURISDICTION_REQUEST_KINDS,
  PROTECT_BUDGETS,
  REQUEST_JURISDICTIONS,
  REQUEST_RECORD_EXTRA_CHARS,
  REQUEST_STATUSES,
  REQUEST_STATUS_TRANSITIONS,
  canTransitionRequest,
  estimateRecordChars,
  isEntityName,
  isLocalDay,
  isPortalUrl,
  isRequestEmail,
  validateStoredRequestJournal,
  type DeletionRequestRecord,
  type RequestEvidenceFact,
} from '../src/index';
import { compileSchema } from './helpers';
import { FACT, REQUEST } from './protect-fixtures';

const record = (i: number, extra: Partial<DeletionRequestRecord> = {}): DeletionRequestRecord =>
  ({
    ...(REQUEST as unknown as DeletionRequestRecord),
    requestId: 'rq_' + 'abcdefghijklmnopqrs' + 'abcdefghijklmnopqrstuvwxyz234567'[i % 32],
    createdDay: '2026-10-17',
    status: 'prepared',
    statusDay: '2026-10-17',
    sentDay: null,
    deadlineDay: null,
    extendedDeadlineDay: null,
    history: [{ status: 'prepared', day: '2026-10-17' }],
    ...extra,
  }) as DeletionRequestRecord;

describe('isLocalDay', () => {
  it('accepts real calendar days 2000–2999 only', () => {
    for (const ok of ['2026-10-17', '2000-01-01', '2999-12-31', '2024-02-29', '2000-02-29']) expect(isLocalDay(ok), ok).toBe(true);
    for (const bad of ['2026-02-29', '2100-02-29', '2026-02-30', '2026-04-31', '2026-13-01', '2026-00-10', '2026-10-00', '1999-12-31', '3000-01-01', '2026-1-17', '17.10.2026', '2026-10-17T00:00', '', 20261017, null]) {
      expect(isLocalDay(bad), String(bad)).toBe(false);
    }
  });
});

describe('isRequestEmail', () => {
  it('accepts a plain address with a punycode domain', () => {
    for (const ok of ['privacy@collect.example', 'dpo+eu@xn--e1afmkfd.xn--p1ai', 'a.b_c-d@sub.example.org']) expect(isRequestEmail(ok), ok).toBe(true);
  });
  it('rejects header and mailto injection, spaces, IP domains and malformed local parts', () => {
    for (const bad of [
      'a@b.example?cc=x@y.example',
      'a@b.example&body=x',
      'a@b.example#x',
      'a%40b@c.example',
      'a@b.example,c@d.example',
      'a b@c.example',
      'a@b.example\r\nBcc: x@y.example',
      'a@@b.example',
      '.a@b.example',
      'a.@b.example',
      'a..b@c.example',
      'a@127.0.0.1',
      'a@localhost',
      'a@B.example',
      'x'.repeat(65) + '@b.example',
      'a@' + 'b'.repeat(250) + '.example',
      '',
    ]) {
      expect(isRequestEmail(bad), bad).toBe(false);
    }
  });
});

describe('isPortalUrl', () => {
  it('accepts canonical https form addresses', () => {
    for (const ok of ['https://collect.example/privacy', 'https://collect.example/', 'https://www.collect.example/a/b-c_d.html']) expect(isPortalUrl(ok), ok).toBe(true);
  });
  it('rejects other schemes, userinfo, ports, queries, fragments, IPs and non-canonical forms', () => {
    for (const bad of [
      'http://collect.example/privacy',
      'https://user:pw@collect.example/',
      'https://collect.example:8443/',
      'https://collect.example/form?email=a@b.example',
      'https://collect.example/form?',
      'https://collect.example/form#x',
      'https://10.0.0.1/form',
      'https://collect.example',
      'https://COLLECT.example/',
      'https://collect.example/a/../b',
      'https://collect.example/a b',
      'javascript:alert(1)',
      'https://collect.example/' + 'a'.repeat(500),
    ]) {
      expect(isPortalUrl(bad), bad).toBe(false);
    }
  });
});

describe('isEntityName', () => {
  it('accepts company names and rejects control, line-separator, bidi and blank values', () => {
    for (const ok of ['Collect Example Ltd', 'ООО «Пример»', 'A', 'Ü'.repeat(128), 'Emoji 😀 Inc']) expect(isEntityName(ok), ok).toBe(true);
    for (const bad of ['', ' ', ' ', 'A\nB', 'A B', 'A‮B', 'A\u0000', 'A\ud800', 'A\udc00B', 'x'.repeat(129)]) expect(isEntityName(bad), JSON.stringify(bad)).toBe(false);
  });
});

describe('request statuses', () => {
  it('transitions follow REQUEST_STATUS_TRANSITIONS; closed is terminal; prepared is never re-entered', () => {
    expect(REQUEST_STATUS_TRANSITIONS.closed).toEqual([]);
    for (const from of REQUEST_STATUSES) {
      for (const to of REQUEST_STATUSES) {
        expect(canTransitionRequest(from, to)).toBe(REQUEST_STATUS_TRANSITIONS[from].includes(to));
        if (to === 'prepared') expect(canTransitionRequest(from, to)).toBe(false);
      }
    }
    expect(canTransitionRequest('prepared', 'sent')).toBe(true);
    expect(canTransitionRequest('sent', 'prepared')).toBe(false);
    expect(canTransitionRequest('answered', 'sent')).toBe(false);
  });

  it('every law has a template language and its request kinds', () => {
    for (const j of REQUEST_JURISDICTIONS) {
      expect(JURISDICTION_LETTER_LANGS[j].length).toBeGreaterThan(0);
      expect(JURISDICTION_REQUEST_KINDS[j]).toContain('access');
      expect(JURISDICTION_REQUEST_KINDS[j]).toContain('erasure');
    }
    expect(JURISDICTION_REQUEST_KINDS['ccpa-ca']).toContain('opt-out-sale-sharing');
    expect(JURISDICTION_REQUEST_KINDS['pdl-ru-152']).not.toContain('objection');
  });
});

describe('record budget', () => {
  const maximal = (): DeletionRequestRecord => {
    const domain = (c: string): string => [c.repeat(63), c.repeat(63), c.repeat(63), c.repeat(53) + '.example'].join('.');
    const fact: RequestEvidenceFact = {
      ...(FACT as unknown as RequestEvidenceFact),
      site: domain('s'),
      receiverDomain: domain('r'),
      endpoint: { scheme: 'https', host: domain('e'), pathTemplate: '/' + ['p'.repeat(40), 'q'.repeat(40), 'r'.repeat(40)].join('/') + '/…' },
      script: { kind: 'external', scheme: 'https', host: domain('h'), pathTemplate: '/' + ['a'.repeat(20) + '.' + 'b'.repeat(19), 'c'.repeat(20) + '-' + 'd'.repeat(19)].join('/') },
      parameterName: 'x'.repeat(48),
      techniqueIds: ['DET-001', 'DET-002', 'DET-003', 'DET-004', 'DET-005', 'DET-011', 'DET-012', 'DET-015'],
      vendorId: 'v'.repeat(64),
    };
    return record(0, {
      facts: Array.from({ length: PROTECT_BUDGETS.maxFactsPerRequest }, () => fact),
      status: 'complaint-filed',
      sentDay: '2026-10-18',
      deadlineDay: '2026-11-18',
      extendedDeadlineDay: '2027-01-18',
      history: Array.from({ length: PROTECT_BUDGETS.maxHistoryPerRequest }, () => ({ status: 'complaint-filed' as const, day: '2026-10-18' })),
    });
  };

  it('counts JSON characters exactly, without serializing', () => {
    for (const r of [record(1), maximal(), record(2, { subject: { role: 'site', vendorId: null, domain: null, entityName: 'Quote " and \\ backslash, 😀' } })]) {
      expect(estimateRecordChars(r)).toBe(JSON.stringify(r).length);
    }
  });

  it('the structurally maximal record exceeds maxRecordChars and is dropped on hydration; a typical record fits', () => {
    const big = maximal();
    expect(estimateRecordChars(big)).toBeGreaterThan(PROTECT_BUDGETS.maxRecordChars);
    const r = validateStoredRequestJournal({ v: 1, revision: 1, prefs: { jurisdiction: null, letterLang: null }, requests: [big, record(3)] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.droppedRecords).toBe(1);
      expect(r.value.journal.requests).toHaveLength(1);
      for (const kept of r.value.journal.requests) expect(estimateRecordChars(kept)).toBeLessThanOrEqual(PROTECT_BUDGETS.maxRecordChars);
    }
    expect(estimateRecordChars(record(4))).toBeLessThan(PROTECT_BUDGETS.maxRecordChars / 2);
  });

  it('REQUEST_RECORD_EXTRA_CHARS bounds the fields a record adds to its input', () => {
    const r = maximal();
    const input = { ...r } as Partial<DeletionRequestRecord>;
    for (const key of ['requestId', 'createdDay', 'status', 'statusDay', 'sentDay', 'deadlineDay', 'extendedDeadlineDay', 'history'] as const) delete input[key];
    expect(estimateRecordChars(r) - JSON.stringify(input).length).toBeLessThanOrEqual(REQUEST_RECORD_EXTRA_CHARS);
  });
});

describe('validateStoredRequestJournal (hydration) vs request-journal.v1', () => {
  const ajvValidate = compileSchema('request-journal.v1.schema.json');
  const journal = (requests: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    v: 1,
    revision: 7,
    prefs: { jurisdiction: 'gdpr-eu-eea', letterLang: 'en' },
    requests,
    ...extra,
  });

  it('accepts a valid journal unchanged', () => {
    const j = journal([record(1), record(2, { status: 'sent', statusDay: '2026-10-18', sentDay: '2026-10-18', deadlineDay: '2026-11-18', history: [{ status: 'prepared', day: '2026-10-17' }, { status: 'sent', day: '2026-10-18' }] })]);
    const r = validateStoredRequestJournal(j);
    expect(r).toEqual({ ok: true, value: { journal: j, droppedRecords: 0 } });
    expect(ajvValidate(j)).toBe(true);
  });

  it('drops invalid, duplicate and excess records one by one and counts them', () => {
    const bad = [
      { ...record(5), requestId: 'rq_bad' },
      { ...record(6), email: 'CANARY-EMAIL-7c1d@example.test' },
      { ...record(7), status: 'prepared', sentDay: '2026-10-18' },
      { ...record(8), statusDay: '2026-10-16' },
      { ...record(9), history: Array.from({ length: 13 }, () => ({ status: 'sent', day: '2026-10-18' })) },
      record(1),
      'not a record',
    ];
    const r = validateStoredRequestJournal(journal([record(1), ...bad]));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.droppedRecords).toBe(bad.length);
      expect(r.value.journal.requests.map((x) => x.requestId)).toEqual([record(1).requestId]);
    }
    const many = Array.from({ length: PROTECT_BUDGETS.maxRequests + 5 }, (_, i) => record(0, { requestId: 'rq_' + i.toString(2).padStart(20, '2').replace(/0/g, 'a').replace(/1/g, 'b') }));
    const capped = validateStoredRequestJournal(journal(many));
    expect(capped.ok).toBe(true);
    if (capped.ok) {
      expect(capped.value.journal.requests).toHaveLength(PROTECT_BUDGETS.maxRequests);
      expect(capped.value.droppedRecords).toBe(5);
    }
  });

  it('fails only on a broken envelope; never throws', () => {
    for (const bad of [null, [], 'x', journal([], { v: 2 }), journal([], { revision: -1 }), journal([], { extra: 1 }), { ...journal([]), requests: {} }, journal([], { prefs: { jurisdiction: 'eu' } })]) {
      expect(validateStoredRequestJournal(bad).ok).toBe(false);
    }
    const hostile = new Proxy({}, { ownKeys: () => { throw new Error('hostile'); } });
    expect(validateStoredRequestJournal(hostile)).toEqual({ ok: false, reason: 'journal: exception' });
  });
});
