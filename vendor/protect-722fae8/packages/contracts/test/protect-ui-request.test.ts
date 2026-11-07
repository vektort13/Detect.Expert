// ADR-020 «Защита» (S02): every one of the 22 ui-protect-* requests, valid and invalid, hand validator vs JSON Schema.
import { describe, expect, it } from 'vitest';
import { MAX_COUNT, PROTECT_UI_REQUEST_TYPES, validateProtectUiRequest, validateUiRequest } from '../src/index';
import { ascii513, compileSchema, throwingProxy, withOwnProtoKey } from './helpers';
import { FACT, REQUEST } from './protect-fixtures';

type Json = Record<string, unknown>;

interface Case {
  name: string;
  input: unknown;
  expect: 'ok' | 'fail';
  /** The JSON Schema cannot express this check (budgets, calendar days, cross-field uniqueness). */
  handOnly?: boolean;
}

const v = (type: string, fields: Json = {}): Json => ({ schemaVersion: 1, type, ...fields });

const save = (request: Json): Json => v('ui-protect-request-save', { expectedRevision: 3, request });
const DECIDE: Json = {
  tabId: 4,
  documentKey: '4:0:DOC',
  protectRevision: 2,
  promptId: '0123456789abcdef',
  receivers: ['collect.example', 'tracker.example'],
  action: 'block',
  scope: 'site',
};

const valid: Case[] = [
  { name: 'get-state', input: v('ui-protect-get-state'), expect: 'ok' },
  { name: 'enable', input: v('ui-protect-enable', { consentVersion: 1, features: ['value-match', 'firewall', 'session-replay'], preset: 'normal' }), expect: 'ok' },
  { name: 'enable all features strict', input: v('ui-protect-enable', { consentVersion: 1, features: ['value-match', 'firewall', 'session-replay', 'history', 'gpc'], preset: 'strict' }), expect: 'ok' },
  { name: 'disable', input: v('ui-protect-disable', { purge: true }), expect: 'ok' },
  { name: 'set-settings preset', input: v('ui-protect-set-settings', { preset: 'warn-only' }), expect: 'ok' },
  { name: 'set-settings all', input: v('ui-protect-set-settings', { features: ['history'], preset: 'normal', historyRetentionDays: 90 }), expect: 'ok' },
  { name: 'snooze 60', input: v('ui-protect-snooze', { minutes: 60 }), expect: 'ok' },
  { name: 'snooze 0', input: v('ui-protect-snooze', { minutes: 0 }), expect: 'ok' },
  { name: 'set-site exclude', input: v('ui-protect-set-site', { host: 'shop.example.com', excluded: true }), expect: 'ok' },
  { name: 'set-site include ip', input: v('ui-protect-set-site', { host: '127.0.0.1', excluded: false }), expect: 'ok' },
  { name: 'purge all', input: v('ui-protect-purge', { what: 'all' }), expect: 'ok' },
  { name: 'get-report', input: v('ui-protect-get-report', { tabId: 9 }), expect: 'ok' },
  { name: 'get-report frame', input: v('ui-protect-get-report', { tabId: 9, frameId: 3 }), expect: 'ok' },
  { name: 'decide', input: v('ui-protect-decide', DECIDE), expect: 'ok' },
  { name: 'decide once allow', input: v('ui-protect-decide', { ...DECIDE, action: 'allow', scope: 'once', receivers: ['collect.example'] }), expect: 'ok' },
  { name: 'undo', input: v('ui-protect-undo', { tabId: 4, undoId: 'fedcba9876543210' }), expect: 'ok' },
  { name: 'dismiss', input: v('ui-protect-dismiss', { tabId: 4, documentKey: '4:0:DOC', protectRevision: 0, promptId: '0123456789abcdef' }), expect: 'ok' },
  { name: 'list-rules', input: v('ui-protect-list-rules', { offset: 0, limit: 200 }), expect: 'ok' },
  { name: 'list-rules filtered', input: v('ui-protect-list-rules', { offset: 1000, limit: 1, domainFilter: 'collect.ex', action: 'allow' }), expect: 'ok' },
  { name: 'remove-rules', input: v('ui-protect-remove-rules', { ruleKeys: ['site:shop.example>collect.example', 'everywhere:*>tracker.example'] }), expect: 'ok' },
  { name: 'history-query', input: v('ui-protect-history-query', { windowDays: 30, offset: 0, limit: 50 }), expect: 'ok' },
  {
    name: 'history-query all options',
    input: v('ui-protect-history-query', { windowDays: 7, offset: 16384, limit: 1, minSites: 1, mechanismsOnly: true, site: 'shop.example', domainFilter: 'track' }),
    expect: 'ok',
  },
  { name: 'history-receiver domain', input: v('ui-protect-history-receiver', { rowKey: 'd:collect.example', windowDays: 90 }), expect: 'ok' },
  { name: 'history-receiver vendor', input: v('ui-protect-history-receiver', { rowKey: 'v:vendor_1', windowDays: 7 }), expect: 'ok' },
  { name: 'history-delete row', input: v('ui-protect-history-delete', { target: 'row', key: 'd:collect.example' }), expect: 'ok' },
  { name: 'history-delete site', input: v('ui-protect-history-delete', { target: 'site', key: 'shop.example' }), expect: 'ok' },
  { name: 'history-export', input: v('ui-protect-history-export', { includeSites: false }), expect: 'ok' },
  { name: 'requests-get', input: v('ui-protect-requests-get', { view: 'summary' }), expect: 'ok' },
  { name: 'request-draft manual', input: v('ui-protect-request-draft', { sourceKind: 'manual' }), expect: 'ok' },
  { name: 'request-draft evidence', input: v('ui-protect-request-draft', { sourceKind: 'evidence', recordId: 'pe-1a2b' }), expect: 'ok' },
  { name: 'request-draft history', input: v('ui-protect-request-draft', { sourceKind: 'history', recordId: 'd:collect.example' }), expect: 'ok' },
  { name: 'request-save', input: save(REQUEST), expect: 'ok' },
  {
    name: 'request-save manual copy, typed identifier and name',
    input: save({ ...REQUEST, sourceKind: 'manual', facts: [], recipient: { source: 'none' }, delivery: 'copy', identityKinds: ['typed-identifier', 'typed-name'] }),
    expect: 'ok',
  },
  {
    name: 'request-save table portal ccpa',
    input: save({
      ...REQUEST,
      jurisdiction: 'ccpa-ca',
      kinds: ['opt-out-sale-sharing'],
      recipient: { source: 'table', contactId: 'collect-example', contactsVersion: '2026-10-17.1', channel: 'portal', address: 'https://collect.example/privacy/request' },
      delivery: 'portal',
      mentionGpc: true,
    }),
    expect: 'ok',
  },
  { name: 'request-save pdl ru', input: save({ ...REQUEST, jurisdiction: 'pdl-ru-152', kinds: ['access'], letterLang: 'ru' }), expect: 'ok' },
  { name: 'request-status', input: v('ui-protect-request-status', { expectedRevision: 0, requestId: 'rq_abcdefghijklmnopqrst', status: 'sent', day: '2026-10-17' }), expect: 'ok' },
  { name: 'request-delete', input: v('ui-protect-request-delete', { expectedRevision: MAX_COUNT, requestId: 'rq_abcdefghijklmnop2345' }), expect: 'ok' },
];

const invalid: Case[] = [
  { name: 'get-state with tabId', input: v('ui-protect-get-state', { tabId: 1 }), expect: 'fail' },
  { name: 'enable without features', input: v('ui-protect-enable', { consentVersion: 1, features: [], preset: 'normal' }), expect: 'fail' },
  { name: 'enable duplicate feature', input: v('ui-protect-enable', { consentVersion: 1, features: ['gpc', 'gpc'], preset: 'normal' }), expect: 'fail' },
  { name: 'enable unknown feature', input: v('ui-protect-enable', { consentVersion: 1, features: ['canary'], preset: 'normal' }), expect: 'fail' },
  { name: 'enable unknown preset', input: v('ui-protect-enable', { consentVersion: 1, features: ['gpc'], preset: 'standard' }), expect: 'fail' },
  { name: 'enable consentVersion -1', input: v('ui-protect-enable', { consentVersion: -1, features: ['gpc'], preset: 'normal' }), expect: 'fail' },
  { name: 'disable purge string', input: v('ui-protect-disable', { purge: 'yes' }), expect: 'fail' },
  { name: 'set-settings empty', input: v('ui-protect-set-settings'), expect: 'fail' },
  { name: 'set-settings retention 14', input: v('ui-protect-set-settings', { historyRetentionDays: 14 }), expect: 'fail' },
  { name: 'set-settings enabled flag', input: v('ui-protect-set-settings', { enabled: true }), expect: 'fail' },
  { name: 'snooze 30', input: v('ui-protect-snooze', { minutes: 30 }), expect: 'fail' },
  { name: 'set-site pattern', input: v('ui-protect-set-site', { host: '*.example.com', excluded: true }), expect: 'fail' },
  { name: 'set-site url', input: v('ui-protect-set-site', { host: 'https://example.com/', excluded: true }), expect: 'fail' },
  { name: 'set-site missing excluded', input: v('ui-protect-set-site', { host: 'example.com' }), expect: 'fail' },
  { name: 'purge unknown target', input: v('ui-protect-purge', { what: 'reports' }), expect: 'fail' },
  { name: 'get-report tabId -1', input: v('ui-protect-get-report', { tabId: -1 }), expect: 'fail' },
  { name: 'get-report documentId', input: v('ui-protect-get-report', { tabId: 1, documentId: 'X' }), expect: 'fail' },
  { name: 'decide 9 receivers', input: v('ui-protect-decide', { ...DECIDE, receivers: Array.from({ length: 9 }, (_, i) => 'r' + String(i) + '.example') }), expect: 'fail' },
  { name: 'decide no receivers', input: v('ui-protect-decide', { ...DECIDE, receivers: [] }), expect: 'fail' },
  { name: 'decide duplicate receivers', input: v('ui-protect-decide', { ...DECIDE, receivers: ['collect.example', 'collect.example'] }), expect: 'fail' },
  { name: 'decide receiver ip', input: v('ui-protect-decide', { ...DECIDE, receivers: ['10.0.0.1'] }), expect: 'fail' },
  { name: 'decide scope receiver', input: v('ui-protect-decide', { ...DECIDE, scope: 'receiver' }), expect: 'fail' },
  { name: 'decide action redirect', input: v('ui-protect-decide', { ...DECIDE, action: 'redirect' }), expect: 'fail' },
  { name: 'decide promptId upper', input: v('ui-protect-decide', { ...DECIDE, promptId: '0123456789ABCDEF' }), expect: 'fail' },
  { name: 'decide missing protectRevision', input: v('ui-protect-decide', { ...DECIDE, protectRevision: undefined }), expect: 'fail' },
  { name: 'undo short id', input: v('ui-protect-undo', { tabId: 4, undoId: 'abc' }), expect: 'fail' },
  { name: 'dismiss with receivers', input: v('ui-protect-dismiss', { tabId: 4, documentKey: '4:0:DOC', protectRevision: 0, promptId: '0123456789abcdef', receivers: ['a.example'] }), expect: 'fail' },
  { name: 'list-rules limit 201', input: v('ui-protect-list-rules', { offset: 0, limit: 201 }), expect: 'fail' },
  { name: 'list-rules offset 1001', input: v('ui-protect-list-rules', { offset: 1001, limit: 1 }), expect: 'fail' },
  { name: 'list-rules url in the filter', input: v('ui-protect-list-rules', { offset: 0, limit: 1, domainFilter: 'a.example/?x=1' }), expect: 'fail' },
  { name: 'list-rules query field', input: v('ui-protect-list-rules', { offset: 0, limit: 1, query: 'a.example' }), expect: 'fail' },
  { name: 'list-rules filter 65', input: v('ui-protect-list-rules', { offset: 0, limit: 1, domainFilter: 'a'.repeat(65) }), expect: 'fail' },
  { name: 'remove-rules empty', input: v('ui-protect-remove-rules', { ruleKeys: [] }), expect: 'fail' },
  { name: 'remove-rules bad key', input: v('ui-protect-remove-rules', { ruleKeys: ['once:shop.example>collect.example'] }), expect: 'fail' },
  { name: 'remove-rules 201', input: v('ui-protect-remove-rules', { ruleKeys: Array.from({ length: 201 }, (_, i) => 'site:s' + String(i) + '.example>r.example') }), expect: 'fail' },
  { name: 'history-query window 14', input: v('ui-protect-history-query', { windowDays: 14, offset: 0, limit: 1 }), expect: 'fail' },
  { name: 'history-query limit 51', input: v('ui-protect-history-query', { windowDays: 7, offset: 0, limit: 51 }), expect: 'fail' },
  { name: 'history-query minSites 3', input: v('ui-protect-history-query', { windowDays: 7, offset: 0, limit: 1, minSites: 3 }), expect: 'fail' },
  { name: 'history-query site url', input: v('ui-protect-history-query', { windowDays: 7, offset: 0, limit: 1, site: 'https://shop.example' }), expect: 'fail' },
  { name: 'history-receiver bad key', input: v('ui-protect-history-receiver', { rowKey: 'x:collect.example', windowDays: 7 }), expect: 'fail' },
  { name: 'history-delete row with site key', input: v('ui-protect-history-delete', { target: 'row', key: 'shop.example' }), expect: 'fail' },
  { name: 'history-delete site with row key', input: v('ui-protect-history-delete', { target: 'site', key: 'd:shop.example' }), expect: 'fail' },
  { name: 'history-delete all', input: v('ui-protect-history-delete', { target: 'all', key: 'x' }), expect: 'fail' },
  { name: 'history-export missing flag', input: v('ui-protect-history-export'), expect: 'fail' },
  { name: 'requests-get view list', input: v('ui-protect-requests-get', { view: 'list' }), expect: 'fail' },
  { name: 'request-draft manual with record', input: v('ui-protect-request-draft', { sourceKind: 'manual', recordId: 'pe-1' }), expect: 'fail' },
  { name: 'request-draft evidence without record', input: v('ui-protect-request-draft', { sourceKind: 'evidence' }), expect: 'fail' },
  { name: 'request-draft evidence with row key', input: v('ui-protect-request-draft', { sourceKind: 'evidence', recordId: 'd:collect.example' }), expect: 'fail' },
  { name: 'request-draft history with evidence id', input: v('ui-protect-request-draft', { sourceKind: 'history', recordId: 'pe-1' }), expect: 'fail' },
  ...['identity', 'identifier', 'name', 'body', 'text', 'value', 'email'].map(
    (key): Case => ({ name: 'request-save top-level ' + key, input: save({ ...REQUEST, [key]: 'CANARY-EMAIL-7c1d@example.test' }), expect: 'fail' }),
  ),
  { name: 'request-save kind not for law', input: save({ ...REQUEST, jurisdiction: 'pdl-ru-152', kinds: ['objection'], letterLang: 'ru' }), expect: 'fail' },
  { name: 'request-save language not for law', input: save({ ...REQUEST, jurisdiction: 'ccpa-ca', kinds: ['access'], letterLang: 'ru' }), expect: 'fail' },
  { name: 'request-save 4 kinds', input: save({ ...REQUEST, kinds: ['access', 'erasure', 'objection', 'access'] }), expect: 'fail' },
  { name: 'request-save manual with facts', input: save({ ...REQUEST, sourceKind: 'manual' }), expect: 'fail' },
  { name: 'request-save two primary identities', input: save({ ...REQUEST, identityKinds: ['sender-address', 'typed-identifier'] }), expect: 'fail' },
  { name: 'request-save only typed name', input: save({ ...REQUEST, identityKinds: ['typed-name'] }), expect: 'fail' },
  { name: 'request-save mailto without address', input: save({ ...REQUEST, recipient: { source: 'none' } }), expect: 'fail' },
  {
    name: 'request-save portal with manual email',
    input: save({ ...REQUEST, delivery: 'portal' }),
    expect: 'fail',
  },
  { name: 'request-save manual portal', input: save({ ...REQUEST, recipient: { source: 'manual', channel: 'portal', address: 'https://collect.example/form' } }), expect: 'fail' },
  { name: 'request-save email injection', input: save({ ...REQUEST, recipient: { source: 'manual', channel: 'email', address: 'a@b.example?cc=x@y.example' } }), expect: 'fail' },
  { name: 'request-save email with comma', input: save({ ...REQUEST, recipient: { source: 'manual', channel: 'email', address: 'a@b.example,c@d.example' } }), expect: 'fail' },
  { name: 'request-save email double dot', input: save({ ...REQUEST, recipient: { source: 'manual', channel: 'email', address: 'a..b@collect.example' } }), expect: 'fail', handOnly: true },
  { name: 'request-save 9 facts', input: save({ ...REQUEST, facts: Array.from({ length: 9 }, () => FACT) }), expect: 'fail' },
  { name: 'request-save fact with value', input: save({ ...REQUEST, facts: [{ ...FACT, value: 'x' }] }), expect: 'fail' },
  { name: 'request-save fact with url', input: save({ ...REQUEST, facts: [{ ...FACT, url: 'https://collect.example/tr?em=x' }] }), expect: 'fail' },
  { name: 'request-save fact endpoint with query', input: save({ ...REQUEST, facts: [{ ...FACT, endpoint: { scheme: 'https', host: 'collect.example', pathTemplate: '/tr?em=1' } }] }), expect: 'fail' },
  { name: 'request-save value-match without encoding', input: save({ ...REQUEST, facts: [{ ...FACT, encoding: null }] }), expect: 'fail' },
  {
    name: 'request-save listener fact with data kind',
    input: save({ ...REQUEST, facts: [{ ...FACT, factKind: 'password-field-listener', encoding: null, location: null, parameterName: null }] }),
    expect: 'fail',
  },
  { name: 'request-save entity name with newline', input: save({ ...REQUEST, subject: { role: 'receiver', vendorId: null, domain: null, entityName: 'A\r\nBcc: x' } }), expect: 'fail' },
  { name: 'request-save entity name blank', input: save({ ...REQUEST, subject: { role: 'receiver', vendorId: null, domain: null, entityName: '   ' } }), expect: 'fail' },
  { name: 'request-save entity name lone surrogate', input: save({ ...REQUEST, subject: { role: 'receiver', vendorId: null, domain: null, entityName: 'A\ud800' } }), expect: 'fail', handOnly: true },
  { name: 'request-save calendar day 02-30', input: save({ ...REQUEST, facts: [{ ...FACT, day: '2026-02-30' }] }), expect: 'fail', handOnly: true },
  {
    name: 'request-save over the record budget',
    input: save({
      ...REQUEST,
      facts: Array.from({ length: 8 }, () => ({
        ...FACT,
        site: 'a'.repeat(60) + '.' + 'b'.repeat(60) + '.' + 'c'.repeat(60) + '.example',
        receiverDomain: 'd'.repeat(60) + '.' + 'e'.repeat(60) + '.' + 'f'.repeat(60) + '.example',
        endpoint: { scheme: 'https', host: 'g'.repeat(60) + '.' + 'h'.repeat(60) + '.example', pathTemplate: '/' + 'p'.repeat(40) + '/' + 'q'.repeat(40) + '/' + 'r'.repeat(40) },
      })),
    }),
    expect: 'fail',
    handOnly: true,
  },
  { name: 'request-status prepared', input: v('ui-protect-request-status', { expectedRevision: 0, requestId: 'rq_abcdefghijklmnopqrst', status: 'prepared', day: '2026-10-17' }), expect: 'fail' },
  { name: 'request-status bad id', input: v('ui-protect-request-status', { expectedRevision: 0, requestId: 'rq_ABCDEFGHIJKLMNOPQRST', status: 'sent', day: '2026-10-17' }), expect: 'fail' },
  { name: 'request-status bad day', input: v('ui-protect-request-status', { expectedRevision: 0, requestId: 'rq_abcdefghijklmnopqrst', status: 'sent', day: '17.10.2026' }), expect: 'fail' },
  { name: 'request-delete revision -1', input: v('ui-protect-request-delete', { expectedRevision: -1, requestId: 'rq_abcdefghijklmnopqrst' }), expect: 'fail' },
  // Generic
  { name: 'unknown ui-protect type', input: v('ui-protect-export-everything'), expect: 'fail' },
  { name: 'schemaVersion 2', input: { ...v('ui-protect-get-state'), schemaVersion: 2 }, expect: 'fail' },
  { name: 'own __proto__ key', input: withOwnProtoKey(v('ui-protect-get-state'), '__proto__'), expect: 'fail' },
  { name: 'type 513 chars', input: v(ascii513), expect: 'fail' },
  { name: 'hostile proxy', input: throwingProxy(), expect: 'fail', handOnly: true },
];

describe('validateProtectUiRequest vs JSON Schema (ui-request.v1)', () => {
  const ajvValidate = compileSchema('ui-request.v1.schema.json');
  for (const c of [...valid, ...invalid]) {
    it(c.name, () => {
      const hand = validateProtectUiRequest(c.input);
      expect(hand.ok).toBe(c.expect === 'ok');
      // validate.ts delegates every ui-protect-* type to the module validator.
      expect(validateUiRequest(c.input).ok).toBe(hand.ok);
      if (c.handOnly) return;
      expect(ajvValidate(c.input)).toBe(hand.ok);
      if (hand.ok) {
        expect(ajvValidate(hand.value)).toBe(true);
        expect(hand.value).toEqual(c.input as Json);
        expect(hand.value).not.toBe(c.input);
      }
    });
  }

  it('covers each of the 22 types with a valid and an invalid case', () => {
    const typeOf = (c: Case): string => (c.input as Json)['type'] as string;
    const okTypes = new Set(valid.map(typeOf));
    const failTypes = new Set(invalid.filter((c) => c.name !== 'hostile proxy').map(typeOf));
    for (const type of PROTECT_UI_REQUEST_TYPES) {
      expect(okTypes.has(type), type).toBe(true);
      expect(failTypes.has(type), type).toBe(true);
    }
  });

  it('rejects an extra key on every type', () => {
    for (const c of valid) {
      const input = { ...(c.input as Json), extra: 1 };
      expect(validateProtectUiRequest(input).ok, c.name).toBe(false);
      expect(ajvValidate(input), c.name).toBe(false);
    }
  });

  it('failure reasons never echo input values', () => {
    const canary = 'CANARY-EMAIL-7c1d@example.test';
    const inputs: unknown[] = [
      save({ ...REQUEST, email: canary }),
      save({ ...REQUEST, recipient: { source: 'manual', channel: 'email', address: canary + '?x' } }),
      v('ui-protect-set-site', { host: canary, excluded: true }),
      v('ui-protect-list-rules', { offset: 0, limit: 1, domainFilter: canary }),
      v('ui-protect-history-delete', { target: 'site', key: canary }),
      v('ui-protect-' + canary),
      { schemaVersion: 1, type: 'ui-protect-get-state', [canary]: 1 },
    ];
    for (const input of inputs) {
      const r = validateProtectUiRequest(input);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).not.toContain('CANARY');
    }
  });
});
