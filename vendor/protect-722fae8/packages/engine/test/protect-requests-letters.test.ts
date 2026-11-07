// ADR-020 §I (S14): letters of data requests — a full snapshot per law, the DRAFT marker while a template is not
// reviewed, the identity canary exactly once and only when typed, the name canary, no wording that claims a breach or
// a guarantee, CRLF; mailto: (RFC 6068: `?` / `&` injection, length limit with a short body); .ics (RFC 5545: CRLF,
// folding at 75 octets, escaping, VALARM −P3D, no site or observation).

import { describe, expect, it } from 'vitest';
import { JURISDICTION_LETTER_LANGS, JURISDICTION_REQUEST_KINDS, REQUEST_JURISDICTIONS } from '@detect-expert/contracts';
import type { RequestEvidenceFact } from '@detect-expert/contracts';
import { historyDayIndex } from '../src/protect/history/day-mask';
import { applySightingDelta } from '../src/protect/history/merge';
import { HISTORY_SIGNAL_BITS } from '../src/protect/history/records';
import { requestFactFromSighting } from '../src/protect/requests/facts';
import { buildRequestIcs, escapeIcsText, foldIcsLine } from '../src/protect/requests/ics';
import { REQUEST_MAILTO_MAX_CHARS, buildRequestMailto, requestMailtoLink } from '../src/protect/requests/mailto';
import { cleanTypedValue, renderRequestLetter, requestFactSentence } from '../src/protect/requests/render';
import type { RenderRequestLetterInput } from '../src/protect/requests/render';
import { REQUEST_DRAFT_MARKER, REQUEST_FACT_WORDS, REQUEST_MAILTO_SHORT_BODY, REQUEST_TEMPLATES, REQUEST_TEMPLATE_TEXTS } from '../src/protect/requests/templates';

const IDENTITY = 'canary-ident-5c2e91@canary.test';
const NAME = 'Kanareika-7f3b';
const FORBIDDEN = [/нарушил/i, /незаконн/i, /гарантир/i, /violat/i, /unlawful/i, /guarantee/i, /зашифрован/i, /encrypted/i, /пытается отправить/i, /придерж/i];

const VALUE_FACT: RequestEvidenceFact = {
  factKind: 'value-match',
  day: '2026-10-17',
  site: 'shop.example',
  receiverDomain: 'tracker.example',
  endpoint: { scheme: 'https', host: 'px.tracker.example', pathTemplate: '/collect/:id' },
  script: { kind: 'external', scheme: 'https', host: 'cdn.tracker.example', pathTemplate: '/t.js' },
  dataKind: 'email',
  encoding: 'sha256-hex',
  location: 'body-json',
  parameterName: 'ud[em]',
  submitTiming: 'before-submit',
  techniqueIds: [],
  vendorId: null,
  evidenceSource: 'derived',
  integrity: 'derived',
  interpretationConfidence: 'high',
};
// A history sighting with a send Chrome reported (value-match day 2026-10-12): only such a sighting is a fact.
const SIGHTING = requestFactFromSighting(applySightingDelta(undefined, { receiver: 'tracker.example', site: 'news.example', day: historyDayIndex(Date.UTC(2026, 9, 12)), signals: HISTORY_SIGNAL_BITS['value-match'] }))!;

function letter(over: Partial<RenderRequestLetterInput> = {}, identifier: string | null = null, name: string | null = null) {
  return renderRequestLetter(
    { jurisdiction: 'gdpr-eu-eea', letterLang: 'en', kinds: ['access', 'erasure'], entityName: 'Tracker Example Ltd', facts: [VALUE_FACT, SIGHTING], identity: 'sender-address', mentionGpc: false, today: '2026-10-18', ...over },
    identifier,
    name,
  );
}

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe('render: snapshots', () => {
  it('GDPR (EU) in English, typed identifier and name', () => {
    const l = letter({ identity: 'typed-identifier' }, IDENTITY, NAME);
    expect(l.subject).toBe('Data subject request under the GDPR (Articles 15, 17)');
    expect(l.templateId).toBe('gdpr-eu-eea');
    expect(l.templateVersion).toBe('2026-10-17');
    expect(l.draft).toBe(true);
    expect(l.body).toBe(
      [
        REQUEST_DRAFT_MARKER.en,
        '',
        'To: Tracker Example Ltd',
        '',
        'Dear Sir or Madam,',
        '',
        'I am writing to make a request under the General Data Protection Regulation (EU) 2016/679 (GDPR) about personal data relating to me that you process.',
        '',
        'Access (Article 15). Please confirm whether you process personal data concerning me and, if you do, provide a copy of the data and the information listed in Article 15(1): the purposes of the processing, the categories of data, the recipients or categories of recipients, the storage period, and the source of the data where it was not collected from me.',
        '',
        'Erasure (Article 17). Please erase the personal data concerning me. Under Article 19, please also communicate the erasure to each recipient to whom the data have been disclosed, and tell me who those recipients are.',
        '',
        'Please identify me by this identifier: ' + IDENTITY,
        'My name: ' + NAME,
        '',
        'To help you find the data, here are observations recorded by a browser extension on my device:',
        '- 2026-10-17: on the site shop.example, a request was sent to tracker.example that contained the e-mail address I had entered in a form (as a SHA-256 hash, in the JSON body, parameter "ud[em]", address https://px.tracker.example/collect/:id, before the form was submitted); sent by a script from https://cdn.tracker.example/t.js (sampled from the call stack; the page can alter this). Confidence of the extension: high.',
        '- 2026-10-12: while I was on the site news.example, my browser sent requests to tracker.example. Confidence of the extension: not assessed.',
        '',
        'These observations are technical records of what my browser sent; they are not a legal assessment.',
        '',
        'Under Article 12(3), please reply without undue delay and in any event within one month of receiving this request.',
        '',
        'Kind regards,',
        '',
      ].join('\r\n'),
    );
  });

  it('152-FZ in Russian: document details and signature blanks, the name in the header, no facts', () => {
    const l = letter({ jurisdiction: 'pdl-ru-152', letterLang: 'ru', kinds: ['erasure', 'access'], facts: [], entityName: 'ООО «Пример»' }, null, NAME);
    expect(l.subject).toBe('Запрос субъекта персональных данных (152-ФЗ, статьи 14, 21)');
    expect(l.body).toBe(
      [
        REQUEST_DRAFT_MARKER.ru,
        '',
        'Кому: ООО «Пример»',
        'От: ' + NAME,
        'Документ, удостоверяющий личность: ______________________ (вид, номер, дата выдачи, кем выдан)',
        '',
        'В соответствии с Федеральным законом от 27.07.2006 № 152-ФЗ «О персональных данных» направляю запрос в отношении моих персональных данных, которые обрабатывает ваша организация.',
        '',
        'Доступ к сведениям (статья 14). Прошу подтвердить факт обработки моих персональных данных и сообщить: правовые основания и цели обработки; применяемые способы обработки; перечень обрабатываемых персональных данных и источник их получения; сроки обработки и хранения; сведения о лицах, которым персональные данные раскрыты или могут быть раскрыты, а также о лицах, которые обрабатывают их по вашему поручению.',
        '',
        'Прекращение обработки и уничтожение (статья 21). Прошу прекратить обработку моих персональных данных и уничтожить их, а также уведомить меня о результатах.',
        '',
        'Сведения, подтверждающие моё участие в отношениях с оператором: мои данные связаны с адресом электронной почты, с которого отправлено это письмо.',
        '',
        'Прошу направить ответ в срок, установленный статьёй 20 Федерального закона № 152-ФЗ.',
        '',
        'С уважением,',
        '',
        'Дата: 18.10.2026',
        'Подпись: ______________________',
        '',
      ].join('\r\n'),
    );
    expect(letter({ jurisdiction: 'pdl-ru-152', letterLang: 'ru', kinds: ['access'], facts: [] }).body).toContain('От: ______________________ (фамилия, имя, отчество)');
  });

  it('CCPA: opt-out with the GPC sentence only when ticked; opt-out alone has no 45-day sentence', () => {
    const withGpc = letter({ jurisdiction: 'ccpa-ca', kinds: ['opt-out-sale-sharing'], mentionGpc: true, facts: [] });
    expect(withGpc.subject).toBe('Consumer request under the California Consumer Privacy Act (§1798.120)');
    expect(withGpc.body).toContain('Global Privacy Control signal (Sec-GPC: 1)');
    expect(withGpc.body).toContain('as soon as feasibly possible');
    expect(withGpc.body).not.toContain('45 days');
    const both = letter({ jurisdiction: 'ccpa-ca', kinds: ['erasure', 'access', 'opt-out-sale-sharing'], mentionGpc: false, facts: [] });
    expect(both.subject).toBe('Consumer request under the California Consumer Privacy Act (§1798.110, §1798.105, §1798.120)');
    expect(both.body).toContain('45 days');
    expect(both.body).not.toContain('Global Privacy Control');
    // GPC is a CCPA sentence only.
    expect(letter({ mentionGpc: true }).body).not.toContain('Global Privacy Control');
  });

  it('every law and language renders; kinds outside the law are dropped; a language without a template throws', () => {
    for (const j of REQUEST_JURISDICTIONS) {
      for (const lang of JURISDICTION_LETTER_LANGS[j]) {
        const l = letter({ jurisdiction: j, letterLang: lang, kinds: [...JURISDICTION_REQUEST_KINDS[j], 'objection', 'opt-out-sale-sharing'] });
        expect(l.body.startsWith(REQUEST_DRAFT_MARKER[lang] + '\r\n')).toBe(true);
        expect(l.body).not.toMatch(/\r(?!\n)|(?<!\r)\n/);
        expect(l.body.endsWith('\r\n')).toBe(true);
        expect(l.body).not.toMatch(/\{[a-z]+\}/);
        expect(l.subject).not.toMatch(/[\r\n{}]/);
      }
    }
    expect(letter({ jurisdiction: 'gdpr-uk', kinds: ['opt-out-sale-sharing', 'access'] }).subject).toBe('Data subject request under the UK GDPR (Articles 15)');
    expect(() => letter({ jurisdiction: 'ccpa-ca', letterLang: 'ru' })).toThrow();
    expect(() => letter({ jurisdiction: 'pdl-ru-152', letterLang: 'en' })).toThrow();
    expect(() => letter({ jurisdiction: 'gdpr-eu-eea', kinds: ['opt-out-sale-sharing'] })).toThrow();
  });
});

describe('render: draft marker, identity and wording', () => {
  it('the DRAFT marker stays while legalReviewStatus ≠ reviewed', () => {
    for (const j of REQUEST_JURISDICTIONS) expect(REQUEST_TEMPLATES[j].legalReviewStatus).toBe('unreviewed');
    expect(letter().body.split('\r\n')[0]).toBe('[DRAFT: this template has not been reviewed by a lawyer. Read it and delete this line before sending.]');
    expect(letter({ letterLang: 'ru' }).body.split('\r\n')[0]).toBe('[ЧЕРНОВИК: текст шаблона не проверен юристом. Прочитайте его и удалите эту строку перед отправкой.]');
    const template = REQUEST_TEMPLATES['gdpr-eu-eea'] as { legalReviewStatus: string };
    template.legalReviewStatus = 'reviewed';
    try {
      const reviewed = letter();
      expect(reviewed.draft).toBe(false);
      expect(reviewed.body).not.toContain('DRAFT');
      expect(reviewed.body.startsWith('To: ')).toBe(true);
    } finally {
      template.legalReviewStatus = 'unreviewed';
    }
  });

  it('the identifier appears exactly once and only when typed; the name only when given; both cleaned to one line', () => {
    for (const j of REQUEST_JURISDICTIONS) {
      for (const lang of JURISDICTION_LETTER_LANGS[j]) {
        const base = { jurisdiction: j, letterLang: lang, kinds: [...JURISDICTION_REQUEST_KINDS[j]] };
        const typed = letter({ ...base, identity: 'typed-identifier' }, IDENTITY, NAME);
        expect(occurrences(typed.body, IDENTITY), j + lang).toBe(1);
        expect(occurrences(typed.body, NAME), j + lang).toBe(1);
        expect(typed.subject).not.toContain(IDENTITY);
        const sender = letter({ ...base, identity: 'sender-address' }, IDENTITY, null);
        expect(occurrences(sender.body + sender.subject, IDENTITY), j + lang).toBe(0);
        expect(occurrences(sender.body, NAME)).toBe(0);
      }
    }
    const injected = letter({ identity: 'typed-identifier' }, ' a\r\nBcc: x@y.test‮ ', 'N\u0000ame\nTwo');
    expect(injected.body).toContain('Please identify me by this identifier: a Bcc: x@y.test');
    expect(injected.body).toContain('My name: Name Two');
    expect(letter({ identity: 'typed-identifier' }, '   ', null).body).toContain('Please identify me by the e-mail address this message is sent from.');
    expect(cleanTypedValue('x'.repeat(300), 254)).toHaveLength(254);
    expect(cleanTypedValue('\u0001', 10)).toBeNull();
  });

  it('no wording that claims a breach, a guarantee or encryption, in any template or fact phrase', () => {
    const texts: string[] = [JSON.stringify(REQUEST_TEMPLATE_TEXTS), JSON.stringify(REQUEST_FACT_WORDS), JSON.stringify(REQUEST_DRAFT_MARKER), JSON.stringify(REQUEST_MAILTO_SHORT_BODY)];
    for (const text of texts) for (const re of FORBIDDEN) expect(re.test(text), String(re)).toBe(false);
    for (const kind of ['value-match', 'opaque-after-input', 'password-field-listener', 'session-replay', 'cross-site-sighting'] as const) {
      for (const lang of ['ru', 'en'] as const) {
        const s = requestFactSentence({ ...VALUE_FACT, factKind: kind, encoding: kind === 'value-match' ? 'plain' : null }, lang);
        for (const re of FORBIDDEN) expect(re.test(s), kind + ' ' + String(re)).toBe(false);
        expect(s).not.toMatch(/\{[a-z]+\}/);
      }
    }
    expect(requestFactSentence({ ...VALUE_FACT, receiverDomain: null, endpoint: null, script: null }, 'ru')).toContain('получателю без доменного имени');
    // Review TRUTH-07: the replay fact states observed behaviour only, never what the requests carried.
    const replayRu = requestFactSentence({ ...VALUE_FACT, factKind: 'session-replay', encoding: null }, 'ru');
    const replayEn = requestFactSentence({ ...VALUE_FACT, factKind: 'session-replay', encoding: null }, 'en');
    expect(replayRu).toContain('содержимое запросов не проверялось');
    expect(replayEn).toContain('the content of the requests was not checked');
    expect(replayRu).not.toMatch(/данные о моих действиях/);
    expect(replayEn).not.toMatch(/data about my activity/);
  });
});

describe('mailto: RFC 6068', () => {
  it('percent-encodes subject and body: a `?`, `&` or `#` inside them cannot add a header', () => {
    const href = buildRequestMailto('privacy@tracker.example', 'A?cc=evil@x.test&bcc=y', 'line1\r\nx&body=injected#frag\n€')!;
    expect(href).toBe('mailto:privacy@tracker.example?subject=A%3Fcc%3Devil%40x.test%26bcc%3Dy&body=line1%0D%0Ax%26body%3Dinjected%23frag%0D%0A%E2%82%AC');
    const url = new URL(href);
    expect([...url.searchParams.keys()]).toEqual(['subject', 'body']);
    expect(url.searchParams.get('body')).toBe('line1\r\nx&body=injected#frag\r\n€');
    for (const bad of ['privacy@tracker.example?cc=x@y.test', 'a&b@tracker.example', 'privacy@tracker.example#x', 'Privacy <p@tracker.example>', 'p@tracker.example,q@x.test', '']) {
      expect(buildRequestMailto(bad, 's', 'b'), bad).toBeNull();
    }
  });

  it('above the limit the link carries the short body (the full text is copied by the same click)', () => {
    const l = letter({ letterLang: 'ru', facts: [VALUE_FACT, SIGHTING, SIGHTING, SIGHTING] }, IDENTITY, NAME);
    const link = requestMailtoLink('privacy@tracker.example', l.subject, l.body, REQUEST_MAILTO_SHORT_BODY.ru)!;
    expect(link.shortened).toBe(true);
    expect(link.href.length).toBeLessThanOrEqual(REQUEST_MAILTO_MAX_CHARS);
    expect(decodeURIComponent(link.href.split('&body=')[1]!)).toBe(REQUEST_MAILTO_SHORT_BODY.ru);
    expect(link.href).not.toContain(encodeURIComponent(IDENTITY));
    const short = requestMailtoLink('privacy@tracker.example', 'S', 'short body', REQUEST_MAILTO_SHORT_BODY.en)!;
    expect(short).toEqual({ href: 'mailto:privacy@tracker.example?subject=S&body=short%20body', shortened: false });
  });
});

describe('ics: RFC 5545', () => {
  const ics = buildRequestIcs({
    requestId: 'rq_abcdefghijklmnopqrst',
    day: '2026-11-18',
    stampMs: Date.UTC(2026, 9, 18, 10, 30, 5),
    summary: 'Срок ответа на запрос о персональных данных; ориентировочно, по закону — от получения',
    description: 'GDPR (ЕС/ЕЭЗ): доступ, удаление. Срок считается от указанной вами даты отправки, а закон считает его от получения, праздники не учитываются.\nВторая строка с \\ обратной чертой',
    alarm: 'Через 3 дня — срок ответа на запрос о данных',
  });

  it('one all-day event with an alarm 3 days before; CRLF; escaped; folded at 75 octets', () => {
    const lines = ics.split('\r\n');
    expect(lines.at(-1)).toBe('');
    expect(ics).not.toMatch(/(?<!\r)\n/);
    for (const line of lines) expect(new TextEncoder().encode(line).length, line).toBeLessThanOrEqual(75);
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain('\r\nUID:rq_abcdefghijklmnopqrst@requests.detect-expert.invalid\r\n');
    expect(unfolded).toContain('\r\nDTSTAMP:20261018T103005Z\r\n');
    expect(unfolded).toContain('\r\nDTSTART;VALUE=DATE:20261118\r\nDTEND;VALUE=DATE:20261119\r\n');
    expect(unfolded).toContain('\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-P3D\r\n');
    expect(unfolded).toContain('SUMMARY:Срок ответа на запрос о персональных данных\\; ориентировочно\\, по закону — от получения\r\n');
    expect(unfolded).toContain('\\nВторая строка с \\\\ обратной чертой');
    expect(unfolded.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(unfolded.endsWith('END:VEVENT\r\nEND:VCALENDAR\r\n')).toBe(true);
    expect(ics).not.toMatch(/https?:/);
  });

  it('folding never splits a UTF-8 sequence; escaping drops controls; invalid input throws', () => {
    const folded = foldIcsLine('SUMMARY:' + 'ж'.repeat(80));
    for (const part of folded.split('\r\n')) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, '')).toBe('SUMMARY:' + 'ж'.repeat(80));
    expect(escapeIcsText('a\u0007b;c,d\\e\r\nf')).toBe('ab\\;c\\,d\\\\e\\nf');
    expect(() => buildRequestIcs({ requestId: 'x', day: '2026-11-18', stampMs: 0, summary: '', description: '', alarm: '' })).toThrow();
    expect(() => buildRequestIcs({ requestId: 'rq_abcdefghijklmnopqrst', day: '2026-02-30', stampMs: 0, summary: '', description: '', alarm: '' })).toThrow();
  });
});
