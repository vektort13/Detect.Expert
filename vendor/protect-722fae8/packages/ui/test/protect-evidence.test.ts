// ADR-020 §B, §D (S07): view model of «Передача введённых данных». Every key exists in ru and en with the right
// placeholders; rows carry class, field, encodings, where, endpoint, moment, delivery (ADR-020 §11), confidence and
// limitations; the popup shows ≤ 5 records (most severe first) with coverage next to the list; the empty state never
// says «передачи не было»; malformed records are skipped; no value / hash / URL can appear (none is in the data).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProtectProjection, ProtectTransferEvidence } from '@detect-expert/contracts';
import { resolveMessage } from '../src/view-models/message';
import type { Message } from '../src/view-models/message';
import {
  DELIVERY_KEYS,
  EVIDENCE_LIMITATION_KEYS,
  FIELD_KIND_KEYS,
  LIST_LIMITATION_KEYS,
  POPUP_EVIDENCE_LIMIT,
  SINCE_INPUT_KEYS,
  TRANSFER_CLASS_KEYS,
  encodingMessage,
  evidenceListView,
  evidenceRow,
  isShowableTransfer,
} from '../src/view-models/protect-evidence';

type Table = Record<string, { message: string; placeholders?: Record<string, { content: string }> }>;
const ru = JSON.parse(readFileSync(resolve('apps/extension/_locales/ru/messages.json'), 'utf8')) as Table;
const en = JSON.parse(readFileSync(resolve('apps/extension/_locales/en/messages.json'), 'utf8')) as Table;

function render(table: Table, m: Message): string {
  return resolveMessage((key, subs = []) => {
    const entry = table[key];
    if (entry === undefined) throw new Error('missing locale key ' + key);
    return entry.message.replace(/\$([A-Z_]+)\$/g, (_, name: string) => {
      const ph = entry.placeholders?.[name.toLowerCase()];
      if (ph === undefined) throw new Error(key + ': no placeholder ' + name);
      return subs[Number(ph.content.slice(1)) - 1] ?? '';
    });
  }, m);
}

function ev(over: Partial<ProtectTransferEvidence> = {}): ProtectTransferEvidence {
  return {
    evidenceId: 'pe-a1',
    frameContext: 'top',
    attributionConfidence: 'frame-only',
    count: 1,
    countQuality: 'lower-bound',
    firstSecond: 3,
    lastSecond: 3,
    evidenceSource: 'derived',
    integrity: 'derived',
    ruleVersion: '1',
    limitationCodes: ['party-by-registrable-domain'],
    protectKind: 'value-match',
    ruleId: 'form-leak',
    transferClass: 'third-party-before-submit',
    fieldKind: 'email',
    fieldRef: 1,
    encodings: ['sha256-hex'],
    location: 'query',
    paramName: 'ud[em]',
    receiver: 'example.net',
    relation: 'cross-site',
    method: 'GET',
    requestKind: 'image',
    endpointHost: 'px.tracker.example.net',
    endpointPathTemplate: '/tr',
    submitTiming: 'before-submit',
    sinceInput: 'lt-1s',
    deliveryState: 'sent',
    interpretationConfidence: 'high',
    ...over,
  };
}

function projection(evidence: unknown[], over: Partial<ProtectProjection> = {}): ProtectProjection {
  return {
    protectRevision: 1,
    documentKey: '7:0:D',
    site: 'shop.example.com',
    moduleState: 'active',
    features: ['value-match'],
    coverageState: 'active',
    limitations: [],
    evidence: evidence as ProtectProjection['evidence'],
    previousDocumentEvidence: 0,
    firewall: { enforcement: 'off', preset: 'normal', topDomainsSupported: true, stoppedToday: { count: 0, countQuality: 'lower-bound' }, snoozedUntil: null, prompt: null, receivers: [], notices: [], onceRules: [] },
    replay: null,
    gpc: null,
    dropped: { evidence: 0, fingerprints: 0, bodies: 0, events: 0 },
    ...over,
  } as ProtectProjection;
}

describe('locale keys of the evidence view', () => {
  it('every key exists in ru and en with the same placeholders', () => {
    const keys = [
      ...Object.values(TRANSFER_CLASS_KEYS),
      ...Object.values(FIELD_KIND_KEYS),
      ...Object.values(SINCE_INPUT_KEYS),
      ...Object.values(DELIVERY_KEYS),
      ...Object.values(EVIDENCE_LIMITATION_KEYS),
      ...Object.values(LIST_LIMITATION_KEYS),
      'protect_leak_section_title', 'protect_leak_empty', 'protect_leak_more', 'protect_leak_count', 'protect_leak_previous',
      'protect_hash_note', 'protect_limit_unobserved_channels', 'protect_password_note', 'protect_endpoint',
      'protect_where_param', 'protect_where_query', 'protect_where_path', 'protect_where_path_any', 'protect_where_body_form',
      'protect_where_body_json', 'protect_where_body_text', 'protect_where_opaque',
      'protect_enc_plain', 'protect_enc_plain_normalized', 'protect_enc_url_encoded', 'protect_enc_base64', 'protect_enc_in_base64_container',
      'protect_enc_hash_hex', 'protect_enc_hash_base64',
    ];
    for (const key of keys) {
      expect(ru[key]?.message, 'ru ' + key).toBeTruthy();
      expect(en[key]?.message, 'en ' + key).toBeTruthy();
      expect(Object.keys(en[key]?.placeholders ?? {}).sort(), key).toEqual(Object.keys(ru[key]?.placeholders ?? {}).sort());
    }
  });

  it('exact texts of the brief', () => {
    expect(ru['protect_leak_empty']?.message).toBe('Совпадений в доступной области за этот период не наблюдалось. Это не значит, что передачи не было.');
    expect(render(ru, { key: 'protect_leak_class_third_party_before_submit', subs: ['example.net'] })).toBe('Найдено в запросе к стороннему домену example.net до отправки формы');
    expect(render(en, { key: 'protect_endpoint', subs: ['px.tracker.example.net', '/tr', 'GET'] })).toBe('To: px.tracker.example.net/tr, method GET');
    expect(ru['protect_delivery_stopped']?.message).toBe('Остановлено: правило блокировки действовало до запроса, браузер его не отправил');
    expect(render(ru, encodingMessage('sha256-hex'))).toBe('хэш SHA-256 (hex)');
    expect(render(en, encodingMessage('md5-base64'))).toBe('MD5 hash (Base64)');
  });
});

describe('evidenceRow', () => {
  it('pixel record: class with recipient, chips, where, endpoint, moment, delivery, confidence, hash note', () => {
    const row = evidenceRow(ev());
    expect(row.severity).toBe('high');
    expect(render(ru, row.title)).toBe('Найдено в запросе к стороннему домену example.net до отправки формы');
    expect(render(ru, row.field)).toBe('e-mail');
    expect(row.encodings.map((m) => render(ru, m))).toEqual(['хэш SHA-256 (hex)']);
    expect(render(ru, row.where!)).toBe('Где: параметр адреса ud[em]');
    expect(render(ru, row.endpoint)).toBe('Куда: px.tracker.example.net/tr, метод GET');
    expect(render(ru, row.since!)).toBe('меньше 1 с после ввода');
    expect(render(ru, row.delivery)).toContain('Отправлено');
    expect(render(ru, row.confidence)).toBe('Высокая уверенность интерпретации');
    expect(row.hashNote).toBe(true);
    expect(row.limitations.map((m) => render(ru, m))).toEqual([ru['protect_limit_entity']!.message]);
  });

  it('receiver without a registrable domain, opaque body, path segment (1-based), merged count', () => {
    const { receiver: _r, ...withoutReceiver } = ev({ transferClass: 'receiver-unknown', receiverCategory: 'loopback', endpointHost: null, relation: 'unknown' });
    const unknown = evidenceRow(withoutReceiver);
    expect(render(ru, unknown.title)).toBe('Найдено в запросе к адресу без регистрируемого домена: ' + ru['host_category_loopback']!.message);
    expect(render(en, unknown.endpoint)).toContain('To: ' + en['host_category_loopback']!.message);
    const opaque = evidenceRow(ev({ protectKind: 'opaque-after-input', transferClass: 'opaque-after-input', encodings: [], location: 'body-opaque', interpretationConfidence: 'low' }));
    expect(opaque.severity).toBe('info');
    expect(render(en, opaque.where!)).toBe('The request body cannot be read');
    expect(opaque.encodings).toEqual([]);
    const { paramName: _p, ...withoutName } = ev({ location: 'path', pathSegment: 1, count: 3 });
    const path = evidenceRow(withoutName);
    expect(render(ru, path.where!)).toBe('Где: путь адреса, сегмент 2');
    expect(render(ru, path.count!)).toBe('Запросов с этим значением: не меньше 3');
  });

  it('delivery texts follow ADR-020 §11 for every state', () => {
    for (const state of ['sent', 'stopped', 'stopped-other', 'unknown'] as const) {
      const text = render(ru, evidenceRow(ev({ deliveryState: state })).delivery);
      expect(text).toBe(ru[DELIVERY_KEYS[state]]!.message);
    }
  });

  it('review round 2: the title never says «Отправлено» unless the request was sent, and never that anyone «получил» it', () => {
    // The collapsed popup row shows only the title: a request stopped by our rule, by another extension or without an
    // observed outcome must not read as sent, and nobody is said to have received anything (ADR-020 §11).
    let checked = 0;
    for (const transferClass of Object.keys(TRANSFER_CLASS_KEYS) as Array<keyof typeof TRANSFER_CLASS_KEYS>) {
      for (const deliveryState of ['sent', 'stopped', 'stopped-other', 'unknown'] as const) {
        const opaque = transferClass === 'opaque-after-input';
        const row = evidenceRow(ev({ transferClass, deliveryState, ...(opaque ? { protectKind: 'opaque-after-input', encodings: [], location: 'body-opaque', interpretationConfidence: 'low' } : {}) }));
        const ruTitle = render(ru, row.title);
        const enTitle = render(en, row.title);
        if (deliveryState !== 'sent') {
          expect(ruTitle, transferClass + ' ' + deliveryState).not.toMatch(/отправлен/i);
          expect(enTitle, transferClass + ' ' + deliveryState).not.toMatch(/\bsent\b/i);
        }
        expect(ruTitle, transferClass).not.toMatch(/получил|получал/i);
        expect(enTitle, transferClass).not.toMatch(/receive[ds]?\b/i);
        checked++;
      }
    }
    expect(checked).toBe(24);
    // The delivery line is the only text of a record that says what happened to the request.
    expect(render(ru, evidenceRow(ev({ deliveryState: 'stopped' })).title)).toBe('Найдено в запросе к стороннему домену example.net до отправки формы');
  });
});

describe('evidenceListView', () => {
  it('null projection → null; empty → the «не наблюдалось» text with coverage and notes', () => {
    expect(evidenceListView(null, 5)).toBeNull();
    const vm = evidenceListView(projection([], { coverageState: 'late-start', limitations: ['values-suspended-payment'] }), POPUP_EVIDENCE_LIMIT)!;
    expect(render(ru, vm.empty!)).toContain('не наблюдалось');
    expect(render(ru, vm.coverage!)).toBe('На этой странице: ' + ru['protect_coverage_late_start']!.message);
    expect(vm.notes.map((m) => m.key)).toEqual(['protect_limit_payment_suspended', 'protect_limit_unobserved_channels', 'protect_password_note']);
  });

  it('review COV-01 / COV-02: document-level limitations are separate (popup shows them next to the list); dropped counts add the budget note', () => {
    const partial = evidenceListView(projection([], { coverageState: 'partial', limitations: ['values-suspended-payment', 'values-reset'] }), POPUP_EVIDENCE_LIMIT)!;
    expect(partial.docNotes.map((m) => m.key)).toEqual(['protect_limit_payment_suspended', 'protect_limit_values_reset']);
    expect(render(ru, partial.coverage!)).toBe('На этой странице: ' + ru['protect_coverage_partial']!.message);
    const over = evidenceListView(projection([], { limitations: ['budget-exceeded'] }), POPUP_EVIDENCE_LIMIT)!;
    expect(over.docNotes.map((m) => m.key)).toEqual(['protect_limit_budget_exceeded']);
    const dropped = evidenceListView(projection([], { dropped: { evidence: 0, fingerprints: 3, bodies: 0, events: 0 } }), POPUP_EVIDENCE_LIMIT)!;
    expect(dropped.docNotes.map((m) => m.key)).toEqual(['protect_limit_budget_exceeded']);
    expect(dropped.notes.map((m) => m.key)).toEqual(['protect_limit_budget_exceeded', 'protect_limit_unobserved_channels', 'protect_password_note']);
    expect(evidenceListView(projection([]), POPUP_EVIDENCE_LIMIT)!.docNotes).toEqual([]);
    for (const table of [ru, en]) expect(table['protect_limit_budget_exceeded']?.message).toBeTruthy();
  });

  it('review round 2: the payment note fits a payment field in an embedded frame (the page e-mail is still read)', () => {
    // The SW records the frame's suspension on the page (packages/background/test/protect/value-match-service.test.ts):
    // the note must not say the page's fields are not read, and must say that fields outside that document are.
    const vm = evidenceListView(projection([ev()], { limitations: ['values-suspended-payment'] }), POPUP_EVIDENCE_LIMIT)!;
    expect(vm.rows).toHaveLength(1);
    const ruNote = render(ru, vm.notes[0]!);
    const enNote = render(en, vm.notes[0]!);
    expect(ruNote).toBe('Есть платёжное поле: в документе, где оно находится (на странице или во встроенном кадре), чтение остальных полей приостановлено; поля вне этого документа читаются.');
    expect(enNote).toBe('There is a payment field: in the document that contains it (the page or an embedded frame), reading other fields is suspended; fields outside that document are read.');
    expect(ruNote).not.toMatch(/^На странице есть платёжные поля/);
    expect(enNote).not.toMatch(/^The page has payment fields/);
  });

  it('most severe first, then the latest; popup ≤ 5 with the rest hidden; malformed and other kinds skipped', () => {
    const list = [
      ev({ evidenceId: 'pe-1', transferClass: 'first-party-before-submit', relation: 'same-site', lastSecond: 50 }),
      ev({ evidenceId: 'pe-2', transferClass: 'third-party-at-submit', lastSecond: 10 }),
      ev({ evidenceId: 'pe-3', lastSecond: 5 }),
      ev({ evidenceId: 'pe-4', lastSecond: 9 }),
      ev({ evidenceId: 'pe-5', protectKind: 'opaque-after-input', transferClass: 'opaque-after-input', encodings: [], interpretationConfidence: 'low' }),
      ev({ evidenceId: 'pe-6', transferClass: 'third-party-moment-unknown' }),
      { protectKind: 'password-field-listener', evidenceId: 'pe-7' },
      { ...ev({ evidenceId: 'pe-8' }), transferClass: 'leak' },
    ];
    const popup = evidenceListView(projection(list), POPUP_EVIDENCE_LIMIT)!;
    expect(popup.total).toBe(6);
    expect(popup.rows.map((r) => r.id)).toEqual(['pe-4', 'pe-3', 'pe-2', 'pe-6', 'pe-1']);
    expect(popup.hidden).toBe(1);
    const panel = evidenceListView(projection(list, { previousDocumentEvidence: 2 }), null)!;
    expect(panel.rows).toHaveLength(6);
    expect(panel.hidden).toBe(0);
    expect(render(ru, panel.previous!)).toBe('Записей о предыдущих страницах этой вкладки: 2');
    expect(isShowableTransfer({ ...ev(), encodings: ['raw-value'] })).toBe(false);
  });

  it('never renders a value, a hash or a URL with a query (the data holds none, the texts add none)', () => {
    const vm = evidenceListView(projection([ev(), ev({ evidenceId: 'pe-2', location: 'body-json', paramName: 'draft.email' })]), null)!;
    const text = vm.rows.flatMap((r) => [r.title, r.field, ...r.encodings, r.where, r.endpoint, r.since, r.delivery, r.confidence, ...r.limitations]).filter((m): m is Message => m !== null).map((m) => render(ru, m)).join('\n');
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(/[0-9a-f]{32}/);
    expect(text).not.toMatch(/утечк|опасн|придерж|пытается отправить|не получит/i);
  });
});
