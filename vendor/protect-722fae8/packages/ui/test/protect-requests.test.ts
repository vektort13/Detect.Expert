// ADR-020 §I (S14): view model of requests.html — defensive readers, the composer (the identifier and the name only
// inside the letter, never in the journal entry), journal rows (status, deadline with its basis, transitions), the
// .ics (no site, receiver or company) and the export (observations only when ticked), and the locale keys of the
// generator (both locales, wording rules of the brief).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DeletionRequestRecord, RequestDraftContext, RequestEvidenceFact } from '@detect-expert/contracts';
import {
  composerLetter,
  composerMailto,
  composerProblem,
  composerRecipient,
  composerRequestInput,
  composerSourceFromDraft,
  composerSourceFromRecord,
  initialComposerState,
  parseRequestDraft,
  parseRequestsJournal,
  reminderCounts,
  requestExportDownload,
  requestIcsDownload,
  requestInputKey,
  requestRowView,
  withJurisdiction,
  withSubject,
} from '../src/view-models/protect-requests';

const IDENTITY = 'canary-ident-5c2e91@canary.test';
const NAME = 'Kanareika-7f3b';

type Table = Record<string, { message: string; placeholders?: Record<string, { content: string }> }>;
const ru = JSON.parse(readFileSync(resolve('apps/extension/_locales/ru/messages.json'), 'utf8')) as Table;
const en = JSON.parse(readFileSync(resolve('apps/extension/_locales/en/messages.json'), 'utf8')) as Table;

const FACT_HIGH: RequestEvidenceFact = {
  factKind: 'value-match', day: '2026-10-17', site: 'shop.example', receiverDomain: 'tracker.example',
  endpoint: { scheme: 'https', host: 'px.tracker.example', pathTemplate: '/collect' }, script: null, dataKind: 'email', encoding: 'sha256-hex',
  location: 'body-json', parameterName: 'em', submitTiming: 'before-submit', techniqueIds: [], vendorId: null,
  evidenceSource: 'derived', integrity: 'derived', interpretationConfidence: 'high',
};
const FACT_LOW: RequestEvidenceFact = { ...FACT_HIGH, day: '2026-10-16', parameterName: 'x', interpretationConfidence: 'low' };

function draft(over: Partial<RequestDraftContext> = {}): RequestDraftContext {
  return {
    sourceKind: 'evidence',
    sourceMissing: false,
    subjects: [
      { role: 'receiver', vendorId: null, domain: 'tracker.example', entityName: 'tracker.example' },
      { role: 'site', vendorId: null, domain: 'shop.example', entityName: 'shop.example' },
    ],
    facts: [FACT_HIGH, FACT_LOW],
    recipients: {
      receiver: [{ contactId: 'tracker', contactsVersion: 's1', entityName: 'Tracker', channel: 'email', address: 'privacy@tracker.example', jurisdictions: ['gdpr-eu-eea'], accessedAt: '2026-10-01', reviewedAt: '2026-10-02' }],
      site: [{ contactId: 'shop', contactsVersion: 's1', entityName: 'Shop', channel: 'portal', address: 'https://privacy.shop.example/form', jurisdictions: ['gdpr-eu-eea', 'ccpa-ca'], accessedAt: '2026-10-01', reviewedAt: '2026-10-02' }],
    },
    prefs: { jurisdiction: null, letterLang: null },
    gpcAvailable: true,
    ...over,
  };
}

function record(over: Partial<DeletionRequestRecord> = {}): DeletionRequestRecord {
  return {
    sourceKind: 'evidence', jurisdiction: 'gdpr-eu-eea', kinds: ['erasure', 'access'], letterLang: 'en', templateId: 'gdpr-eu-eea', templateVersion: '2026-10-17',
    subject: { role: 'receiver', vendorId: null, domain: 'tracker.example', entityName: 'Tracker Ltd' },
    recipient: { source: 'manual', channel: 'email', address: 'privacy@tracker.example' }, facts: [FACT_HIGH],
    identityKinds: ['typed-identifier', 'typed-name'], delivery: 'mailto', mentionGpc: false,
    requestId: 'rq_abcdefghijklmnopqrst', createdDay: '2026-10-01', status: 'sent', statusDay: '2026-10-02', sentDay: '2026-10-02',
    deadlineDay: '2026-11-02', extendedDeadlineDay: '2027-01-02', history: [{ status: 'prepared', day: '2026-10-01' }, { status: 'sent', day: '2026-10-02' }],
    ...over,
  };
}

describe('readers', () => {
  it('journal answers: full and summary; malformed records or counts reject the whole answer', () => {
    const full = { type: 'protect-requests', revision: 3, summary: { total: 1, open: 1, dueSoon: 0, overdue: 0 }, prefs: { jurisdiction: 'gdpr-eu-eea', letterLang: 'en' }, droppedRecords: 0, requests: [record()] };
    expect(parseRequestsJournal(full)?.requests).toEqual([record()]);
    expect(parseRequestsJournal({ ...full, requests: undefined })?.requests).toBeNull();
    expect(parseRequestsJournal({ ...full, requests: [{ ...record(), identifier: IDENTITY }] })).toBeNull();
    expect(parseRequestsJournal({ ...full, revision: -1 })).toBeNull();
    expect(parseRequestsJournal({ ...full, summary: { total: 1 } })).toBeNull();
    expect(parseRequestsJournal({ ...full, prefs: { jurisdiction: 'mars' } })).toBeNull();
    expect(parseRequestsJournal({ ...full, type: 'protect-state' })).toBeNull();
  });

  it('draft answers: facts through the contract validator, candidates with a valid address', () => {
    expect(parseRequestDraft({ type: 'protect-request-draft', draft: draft() })).toEqual(draft());
    expect(parseRequestDraft({ type: 'protect-request-draft', draft: draft({ facts: [{ ...FACT_HIGH, value: IDENTITY } as unknown as RequestEvidenceFact] }) })).toBeNull();
    expect(parseRequestDraft({ type: 'protect-request-draft', draft: draft({ facts: [{ ...FACT_HIGH, encoding: null }] }) })).toBeNull();
    const bad = draft();
    bad.recipients.receiver[0] = { ...bad.recipients.receiver[0]!, address: 'privacy@tracker.example?cc=x@y.test' };
    expect(parseRequestDraft({ type: 'protect-request-draft', draft: bad })).toBeNull();
    expect(parseRequestDraft({ type: 'protect-request-draft', draft: { ...draft(), subjects: [{ role: 'receiver', vendorId: null, domain: 'https://x', entityName: 'x' }] } })).toBeNull();
  });

  it('reminder only when something is due soon or overdue', () => {
    expect(reminderCounts({ total: 3, open: 3, dueSoon: 0, overdue: 0 })).toBeNull();
    expect(reminderCounts({ total: 3, open: 3, dueSoon: 1, overdue: 2 })).toEqual({ soon: 1, overdue: 2 });
    expect(reminderCounts(null)).toBeNull();
  });
});

describe('composer', () => {
  it('starts without a law (the extension does not infer it); low facts unticked; the table recipient of the subject', () => {
    const source = composerSourceFromDraft(draft());
    const s = initialComposerState(source, 'ru');
    expect(s).toMatchObject({ jurisdiction: null, kinds: ['erasure'], letterLang: 'ru', checked: [true, false], identity: 'sender-address', recipient: { kind: 'manual' } });
    expect(composerProblem(source, s, '')).toBe('law');
    const law = withJurisdiction(source, s, 'gdpr-eu-eea', 'ru');
    expect(law).toMatchObject({ jurisdiction: 'gdpr-eu-eea', letterLang: 'ru', recipient: { kind: 'table', contactId: 'tracker' } });
    expect(composerRecipient(source, law)).toEqual({ source: 'table', contactId: 'tracker', contactsVersion: 's1', channel: 'email', address: 'privacy@tracker.example' });
    // CCPA: English only, opt-out by default; the site's form is the only CCPA contact.
    const ccpa = withSubject(source, withJurisdiction(source, law, 'ccpa-ca', 'ru'), 1);
    expect(ccpa).toMatchObject({ letterLang: 'en', kinds: ['erasure'], recipient: { kind: 'table', contactId: 'shop' } });
    expect(composerRequestInput(source, ccpa, '', '', 'mailto')).toBeNull();
    expect(composerRequestInput(source, ccpa, '', '', 'portal')?.recipient).toEqual({ source: 'table', contactId: 'shop', contactsVersion: 's1', channel: 'portal', address: 'https://privacy.shop.example/form' });
    // Prefs remembered by the SW preselect the law and language.
    expect(initialComposerState(composerSourceFromDraft(draft({ prefs: { jurisdiction: 'pdl-ru-152', letterLang: 'en' } })), 'en')).toMatchObject({ jurisdiction: 'pdl-ru-152', letterLang: 'ru' });
  });

  it('the identifier and the name reach only the letter; the journal entry carries their kinds', () => {
    const source = composerSourceFromDraft(draft());
    let s = withJurisdiction(source, initialComposerState(source, 'en'), 'gdpr-eu-eea', 'en');
    s = { ...s, identity: 'typed-identifier', includeName: true, kinds: ['access', 'erasure'] };
    expect(composerProblem(source, s, '   ')).toBe('identity');
    const letter = composerLetter(source, s, IDENTITY, NAME, '2026-10-18')!;
    expect(letter.body.split(IDENTITY)).toHaveLength(2);
    expect(letter.body).toContain(NAME);
    expect(letter.body).toContain('2026-10-17: on the site shop.example');
    expect(letter.body).not.toContain('"x"');
    const input = composerRequestInput(source, s, IDENTITY, NAME, 'mailto')!;
    expect(input.identityKinds).toEqual(['typed-identifier', 'typed-name']);
    expect(input.facts).toEqual([FACT_HIGH]);
    expect(JSON.stringify(input)).not.toContain(IDENTITY);
    expect(JSON.stringify(input)).not.toContain(NAME);
    expect(requestInputKey(input)).not.toContain(IDENTITY);
    // The mailto link carries the letter (the user sends it; the extension does not).
    const mailto = composerMailto(composerRecipient(source, s), letter, 'en')!;
    expect(mailto.href.startsWith('mailto:privacy@tracker.example?subject=')).toBe(true);
    expect(composerMailto({ source: 'none' }, letter, 'en')).toBeNull();
    // Another company typed by the user: no domain; an empty name is a problem.
    const other = withSubject(source, s, -1);
    expect(composerProblem(source, other, IDENTITY)).toBe('entity');
    expect(composerRequestInput(source, { ...other, entityName: 'ООО «Пример»', recipient: { kind: 'none' } }, IDENTITY, NAME, 'copy')?.subject).toEqual({ role: 'receiver', vendorId: null, domain: null, entityName: 'ООО «Пример»' });
    expect(composerProblem(source, { ...s, recipient: { kind: 'manual' }, manualAddress: 'not an address' }, IDENTITY)).toBe('recipient');
  });

  it('«Повторить письмо» keeps the law, kinds, company, observations and recipient; a manual draft has no facts', () => {
    const source = composerSourceFromRecord(record(), false);
    const s = initialComposerState(source, 'ru');
    expect(s).toMatchObject({ jurisdiction: 'gdpr-eu-eea', letterLang: 'en', kinds: ['erasure', 'access'], checked: [true], recipient: { kind: 'previous' }, entityName: 'Tracker Ltd' });
    expect(composerRequestInput(source, s, '', '', 'mailto')?.recipient).toEqual({ source: 'manual', channel: 'email', address: 'privacy@tracker.example' });
    const manual = composerSourceFromDraft(draft({ sourceKind: 'manual', subjects: [], facts: [], recipients: { receiver: [], site: [] } }));
    const m = { ...withJurisdiction(manual, initialComposerState(manual, 'ru'), 'pdl-ru-152', 'ru'), entityName: 'ООО «Пример»', recipient: { kind: 'none' as const } };
    expect(composerRequestInput(manual, m, '', '', 'copy')).toMatchObject({ sourceKind: 'manual', facts: [], jurisdiction: 'pdl-ru-152', letterLang: 'ru' });
  });
});

describe('journal rows and files', () => {
  it('status, approximate deadline with its basis, transitions', () => {
    const v = requestRowView(record(), '2026-10-31', 'en');
    expect(v.status).toEqual({ key: 'protect_req_status_sent', subs: [expect.stringContaining('2026')] });
    expect(v.due).toMatchObject({ state: 'due-soon', dueDay: '2026-11-02', message: { key: 'protect_req_state_due_soon' }, basis: { key: 'protect_req_deadline_basis', subs: [{ key: 'protect_req_basis_gdpr_art_12_3' }] } });
    expect(v.next).toEqual(['extended', 'answered', 'complaint-filed', 'closed']);
    expect(requestRowView(record(), '2026-11-03', 'en').due?.state).toBe('overdue');
    const prepared = requestRowView(record({ status: 'prepared', statusDay: '2026-10-01', sentDay: null, deadlineDay: null, extendedDeadlineDay: null, history: [] }), '2026-10-31', 'ru');
    expect(prepared.status).toEqual({ key: 'protect_req_status_prepared' });
    expect(prepared.due).toBeNull();
    expect(prepared.next).toEqual(['sent', 'closed']);
  });

  it('.ics: the due day and the reminder only — no company, site, receiver or identifier', () => {
    const d = requestIcsDownload(record(), '2026-10-20', { summary: 'Срок ответа', description: 'GDPR: удаление', alarm: 'Через 3 дня' }, Date.UTC(2026, 9, 20))!;
    expect(d.fileName).toBe('detect-expert-request-rq_abcdefghijklmnopqrst.ics');
    expect(d.mime).toBe('text/calendar');
    expect(d.text).toContain('DTSTART;VALUE=DATE:20261102');
    expect(d.text).toContain('TRIGGER:-P3D');
    for (const forbidden of ['Tracker', 'tracker.example', 'shop.example', IDENTITY]) expect(d.text).not.toContain(forbidden);
    expect(requestIcsDownload(record({ status: 'answered' }), '2026-10-20', { summary: 's', description: 'd', alarm: 'a' }, 0)).toBeNull();
  });

  it('export = preview text; observations only when ticked; never an identifier', () => {
    const plain = requestExportDownload([record()], false, '2026-10-20');
    expect(plain.download.fileName).toBe('detect-expert-requests-2026-10-20.json');
    expect(plain.download.text).toBe(JSON.stringify(plain.preview, null, 2) + '\n');
    expect(plain.preview).toMatchObject({ redacted: true, factsIncluded: false, requests: [{ factCount: 1 }] });
    expect(plain.download.text).not.toContain('shop.example');
    expect(plain.download.text).not.toContain('"facts"');
    const withFacts = requestExportDownload([record()], true, '2026-10-20');
    expect(withFacts.preview.requests[0]?.facts).toEqual([FACT_HIGH]);
    expect(withFacts.download.text).toContain('shop.example');
    const tainted = { ...record(), identifier: IDENTITY, letter: 'Dear ' + NAME } as unknown as DeletionRequestRecord;
    expect(requestExportDownload([tainted], true, '2026-10-20').download.text).not.toMatch(new RegExp(IDENTITY + '|' + NAME));
  });
});

describe('locales of the generator', () => {
  const keys = Object.keys(ru).filter((k) => k.startsWith('protect_req_'));

  it('ru and en carry the same keys and placeholders; the brief texts are exact', () => {
    expect(Object.keys(en).filter((k) => k.startsWith('protect_req_')).sort()).toEqual([...keys].sort());
    expect(keys.length).toBeGreaterThanOrEqual(100);
    for (const k of keys) expect(Object.keys(en[k]?.placeholders ?? {}).sort(), k).toEqual(Object.keys(ru[k]?.placeholders ?? {}).sort());
    const exact: Record<string, [string, string]> = {
      protect_req_page_title: ['Запросы о персональных данных', 'Personal data requests'],
      protect_req_draft_badge: ['Черновик: тексты шаблонов не проверены юристом', 'Draft: the template texts have not been reviewed by a lawyer'],
      protect_req_identity_warning: ['Компания получит этот идентификатор. Расширение не сохраняет введённое значение и никогда не подставляет его само.', 'The company will receive this identifier. The extension does not save what you type and never fills it in itself.'],
      protect_req_status_sent: ['отправлен $DATE$', 'sent on $DATE$'],
      protect_req_state_overdue: ['Срок ответа истёк $DATE$', 'Response deadline passed on $DATE$'],
      protect_req_reminder: ['Запросы о данных: скоро срок — $SOON$, срок истёк — $OVERDUE$.', 'Data requests: due soon — $SOON$, overdue — $OVERDUE$.'],
      protect_req_entry: ['Подготовить запрос о данных', 'Prepare a data request'],
    };
    for (const [k, [r, e]] of Object.entries(exact)) {
      expect(ru[k]?.message, k).toBe(r);
      expect(en[k]?.message, k).toBe(e);
    }
  });

  it('no claim that a company broke the law, no guarantees, no encryption claims (the disclaimer key excepted)', () => {
    const forbidden = [/нарушил/i, /незаконн/i, /гарантир/i, /violat/i, /unlawful/i, /guarantee/i, /зашифрован/i, /\bencrypted\b/i, /пытается отправить/i, /придерж/i];
    for (const table of [ru, en]) {
      for (const k of keys) {
        if (k === 'protect_req_not_legal_advice') continue;
        for (const re of forbidden) expect(re.test(table[k]!.message), k + ' ' + String(re)).toBe(false);
      }
    }
    expect(ru['protect_req_not_legal_advice']?.message).toContain('не утверждает');
  });
});
