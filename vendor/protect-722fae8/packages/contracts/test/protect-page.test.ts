// ADR-020 «Защита» (S02): ISOLATED (protect.js) <-> SW messages. Browser ids never come from a payload; protect-input
// carries only keyed fingerprints {enc, len, h}; failure reasons never echo input (canaries).
import { describe, expect, it } from 'vitest';
import {
  BUDGETS,
  FINGERPRINT_ENCODINGS,
  MAX_COUNT,
  PROTECT_BUDGETS,
  PROTECT_LIMITATIONS,
  jsonLengthUpTo,
  validateProtectAck,
  validateProtectControl,
  validateProtectPageMessage,
  type ProtectInputMessage,
} from '../src/index';
import { compileSchema, id64, throwingProxy, withOwnProtoKey } from './helpers';

type Json = Record<string, unknown>;

interface Case {
  name: string;
  input: unknown;
  expect: 'ok' | 'fail';
  handOnly?: boolean;
}

const CANARIES = ['CANARY-EMAIL-7c1d@example.test', '+7 900 555-73-91', 'Canaryname Testova', 'CANARY-PASSWORD-7e2b'];
const entry = (i = 0): Json => ({ enc: 'sha256-hex', len: 32 + (i % 8), h: (0x1000000000000 + i).toString(16).slice(-13) });
const field = (fieldRef = 1, entries = 2): Json => ({ fieldRef, fieldKind: 'email', trigger: 'input', entries: Array.from({ length: entries }, (_, i) => entry(i)) });
const input = (fields: Json[] = [field()], extra: Json = {}): Json => ({
  schemaVersion: 1,
  type: 'protect-input',
  saltId: 'salt-0001',
  seq: 7,
  fields,
  submit: 'none',
  neverReadFields: 2,
  paymentSuspended: false,
  ...extra,
});
const script: Json = { kind: 'external', scheme: 'https', host: '*.cdn.tracker.example', pathTemplate: '/js/:id/rec.js' };
const send: Json = { hookPoint: 'send-beacon', sensorSeq: 1, ageMs: 120, script, sampled: true, target: { kind: 'absolute', host: 'collect.example' } };
const registration: Json = { hookPoint: 'listen', eventCode: 'keydown', targetKind: 'document', script: { kind: 'document' }, sampled: true, count: 3, ageMs: 0 };
const events = (extra: Json = {}): Json => ({
  schemaVersion: 1,
  type: 'protect-events',
  sensorBootId: 'boot-1',
  relaySessionId: 'relay-1',
  batchSeq: 1,
  sends: [send],
  registrations: [registration],
  dropped: { sends: 0, registrations: 0, unsampled: 0 },
  limitations: [],
  ...extra,
});

const cases: Case[] = [
  { name: 'hello', input: { schemaVersion: 1, type: 'protect-hello', startedLate: true }, expect: 'ok' },
  { name: 'arm', input: { schemaVersion: 1, type: 'protect-arm', fieldKind: 'phone' }, expect: 'ok' },
  { name: 'input', input: input(), expect: 'ok' },
  { name: 'input without fields (never-read and submit only)', input: input([], { submit: 'submit-event' }), expect: 'ok' },
  { name: 'input 4 fields x 64 entries', input: input([1, 2, 3, 4].map((r) => field(r, 64))), expect: 'ok' },
  { name: 'events', input: events(), expect: 'ok' },
  { name: 'events observe-document', input: events({ sends: [], registrations: [{ ...registration, hookPoint: 'observe-document', eventCode: undefined, targetKind: 'root' }].map(stripUndefined) }), expect: 'ok' },
  { name: 'events limitations only', input: events({ sends: [], registrations: [], limitations: ['stack-unavailable', 'late-start'] }), expect: 'ok' },
  { name: 'events relative and unread targets', input: events({ sends: [{ ...send, target: { kind: 'relative' } }, { ...send, sensorSeq: 2, target: { kind: 'unread' } }] }), expect: 'ok' },

  // Browser ids are taken from MessageSender only.
  ...['tabId', 'frameId', 'documentId'].flatMap((key): Case[] => [
    { name: 'hello with ' + key, input: { schemaVersion: 1, type: 'protect-hello', startedLate: false, [key]: 1 }, expect: 'fail' },
    { name: 'input with ' + key, input: input([field()], { [key]: key === 'documentId' ? 'DOC' : 0 }), expect: 'fail' },
    { name: 'events with ' + key, input: events({ [key]: 3 }), expect: 'fail' },
  ]),
  { name: 'unknown type', input: { schemaVersion: 1, type: 'protect-export' }, expect: 'fail' },
  { name: 'schemaVersion 2', input: { schemaVersion: 2, type: 'protect-hello', startedLate: false }, expect: 'fail' },
  { name: 'own __proto__ key', input: withOwnProtoKey({ schemaVersion: 1, type: 'protect-hello', startedLate: false }, '__proto__'), expect: 'fail' },
  { name: 'arm password kind', input: { schemaVersion: 1, type: 'protect-arm', fieldKind: 'password' }, expect: 'fail' },
  { name: 'input plaintext instead of an entry', input: input([{ ...field(), entries: [CANARIES[0]] }]), expect: 'fail' },
  { name: 'input plaintext value key', input: input([{ ...field(), value: CANARIES[0] }]), expect: 'fail' },
  { name: 'input entry with value', input: input([{ ...field(), entries: [{ ...entry(), value: CANARIES[0] }] }]), expect: 'fail' },
  { name: 'input 5 fields', input: input([1, 2, 3, 4, 5].map((r) => field(r))), expect: 'fail' },
  { name: 'input 65 entries', input: input([field(1, 65)]), expect: 'fail' },
  { name: 'input empty entries', input: input([field(1, 0)]), expect: 'fail' },
  { name: 'input len 2', input: input([{ ...field(), entries: [{ ...entry(), len: 2 }] }]), expect: 'fail' },
  { name: 'input len 1025', input: input([{ ...field(), entries: [{ ...entry(), len: 1025 }] }]), expect: 'fail' },
  { name: 'input h uppercase', input: input([{ ...field(), entries: [{ ...entry(), h: '0123456789ABC' }] }]), expect: 'fail' },
  { name: 'input h 12 chars', input: input([{ ...field(), entries: [{ ...entry(), h: '0123456789ab' }] }]), expect: 'fail' },
  { name: 'input h sha256', input: input([{ ...field(), entries: [{ ...entry(), h: 'a'.repeat(64) }] }]), expect: 'fail' },
  { name: 'input container encoding', input: input([{ ...field(), entries: [{ ...entry(), enc: 'in-base64-container' }] }]), expect: 'fail' },
  { name: 'input password field kind', input: input([{ ...field(), fieldKind: 'password' }]), expect: 'fail' },
  { name: 'input fieldRef 9', input: input([field(9)]), expect: 'fail' },
  { name: 'input duplicate fieldRef', input: input([field(2), field(2)]), expect: 'fail', handOnly: true },
  { name: 'input saltId short', input: input([field()], { saltId: 'abc' }), expect: 'fail' },
  { name: 'input neverReadFields 65', input: input([field()], { neverReadFields: 65 }), expect: 'fail' },
  { name: 'input submit unknown', input: input([field()], { submit: 'click' }), expect: 'fail' },
  { name: 'events 33 samples', input: events({ sends: Array.from({ length: 17 }, () => send), registrations: Array.from({ length: 16 }, () => registration) }), expect: 'fail', handOnly: true },
  { name: 'events empty', input: events({ sends: [], registrations: [] }), expect: 'fail', handOnly: true },
  { name: 'events ageMs 5001', input: events({ sends: [{ ...send, ageMs: 5001 }] }), expect: 'fail' },
  { name: 'events tMs instead of ageMs', input: events({ sends: [{ ...stripUndefined({ ...send, ageMs: undefined }), tMs: 10 }] }), expect: 'fail' },
  { name: 'events listen without eventCode', input: events({ registrations: [stripUndefined({ ...registration, eventCode: undefined })] }), expect: 'fail' },
  { name: 'events observe with eventCode', input: events({ registrations: [{ ...registration, hookPoint: 'observe-document', targetKind: 'document' }] }), expect: 'fail' },
  { name: 'events observe on a field', input: events({ registrations: [stripUndefined({ ...registration, hookPoint: 'observe-document', eventCode: undefined, targetKind: 'field' })] }), expect: 'fail' },
  { name: 'events unknown event code', input: events({ registrations: [{ ...registration, eventCode: 'click' }] }), expect: 'fail' },
  { name: 'events limitation unknown', input: events({ limitations: ['canary'] }), expect: 'fail' },
  { name: 'events 9 limitations', input: events({ limitations: PROTECT_LIMITATIONS.slice(0, 9) }), expect: 'fail' },
  { name: 'events batchSeq 0', input: events({ batchSeq: 0 }), expect: 'fail' },
  { name: 'events relaySessionId 65', input: events({ relaySessionId: 'a'.repeat(65) }), expect: 'fail' },
  { name: 'events script url host', input: events({ sends: [{ ...send, script: { ...script, host: 'https://cdn.tracker.example/js' } }] }), expect: 'fail' },
  { name: 'events script path with query', input: events({ sends: [{ ...send, script: { ...script, pathTemplate: '/js/rec.js?id=1' } }] }), expect: 'fail' },
  { name: 'events script document with host', input: events({ sends: [{ ...send, script: { kind: 'document', host: 'shop.example' } }] }), expect: 'fail' },
  { name: 'events target with url', input: events({ sends: [{ ...send, target: { kind: 'absolute', host: 'collect.example', url: 'https://collect.example/c?em=1' } }] }), expect: 'fail' },
  { name: 'events target ip', input: events({ sends: [{ ...send, target: { kind: 'absolute', host: '10.0.0.1' } }] }), expect: 'fail' },
  { name: 'hostile proxy', input: throwingProxy(), expect: 'fail', handOnly: true },
];

function stripUndefined(o: Json): Json {
  return Object.fromEntries(Object.entries(o).filter(([, value]) => value !== undefined));
}

describe('validateProtectPageMessage vs JSON Schema (protect-page.v1)', () => {
  const ajvValidate = compileSchema('protect-page.v1.schema.json');
  for (const c of cases) {
    it(c.name, () => {
      const hand = validateProtectPageMessage(c.input);
      expect(hand.ok).toBe(c.expect === 'ok');
      if (c.handOnly) return;
      expect(ajvValidate(c.input)).toBe(hand.ok);
      if (hand.ok) {
        expect(ajvValidate(hand.value)).toBe(true);
        expect(hand.value).toEqual(c.input as Json);
        expect(hand.value).not.toBe(c.input);
      }
    });
  }

  it('rejects tabId / frameId / documentId with a fixed reason', () => {
    for (const key of ['tabId', 'frameId', 'documentId']) {
      const r = validateProtectPageMessage({ schemaVersion: 1, type: 'protect-arm', fieldKind: 'email', [key]: 5 });
      expect(r).toEqual({ ok: false, reason: 'protect-page: browser ids come from MessageSender only' });
    }
  });

  it('failure reasons never contain canaries', () => {
    const inputs: unknown[] = [];
    for (const canary of CANARIES) {
      inputs.push(
        input([{ ...field(), entries: [canary] }]),
        input([{ ...field(), entries: [{ ...entry(), h: canary }] }]),
        input([{ ...field(), [canary]: 1 }]),
        input([field()], { saltId: canary }),
        { schemaVersion: 1, type: canary },
        events({ batchSeq: canary }),
        events({ sends: [{ ...send, script: { ...script, pathTemplate: '/' + canary + '?q' } }] }),
      );
    }
    for (const value of inputs) {
      const r = validateProtectPageMessage(value);
      expect(r.ok).toBe(false);
      if (!r.ok) for (const canary of CANARIES) expect(r.reason).not.toContain(canary);
    }
  });

  it('worst-case protect-input fits maxInputMessageBytes and the counted length equals JSON.stringify', () => {
    const longestEnc = [...FINGERPRINT_ENCODINGS].sort((a, b) => b.length - a.length)[0]!;
    const worst: ProtectInputMessage = {
      schemaVersion: 1,
      type: 'protect-input',
      saltId: 'A'.repeat(16),
      seq: MAX_COUNT,
      fields: [1, 2, 3, 4].map((fieldRef) => ({
        fieldRef,
        fieldKind: 'email',
        trigger: 'submit',
        entries: Array.from({ length: PROTECT_BUDGETS.maxVariantsPerField }, () => ({ enc: longestEnc, len: 1024, h: 'f'.repeat(13) })),
      })),
      submit: 'submit-control',
      neverReadFields: 64,
      paymentSuspended: true,
    };
    const r = validateProtectPageMessage(worst);
    expect(r.ok).toBe(true);
    const bytes = new TextEncoder().encode(JSON.stringify(worst)).length;
    expect(jsonLengthUpTo(worst, Number.MAX_SAFE_INTEGER)).toBe(bytes);
    expect(bytes).toBeLessThanOrEqual(PROTECT_BUDGETS.maxInputMessageBytes);
  });

  it('protect-events over the byte budget is rejected after the structural checks', () => {
    const big: Json = { kind: 'external', scheme: 'https', host: ('a'.repeat(63) + '.').repeat(3) + 'example', pathTemplate: '/' + ['a'.repeat(20) + '-' + 'c'.repeat(19), 'b'.repeat(20) + '.' + 'd'.repeat(19)].join('/') };
    const heavy = events({ sends: Array.from({ length: 32 }, (_, i) => ({ ...send, sensorSeq: i + 1, script: big, target: { kind: 'absolute', host: big['host'] } })), registrations: [] });
    expect(jsonLengthUpTo(heavy, Number.MAX_SAFE_INTEGER)).toBeGreaterThan(BUDGETS.maxBatchBytes);
    const r = validateProtectPageMessage(heavy);
    expect(r).toEqual({ ok: false, reason: 'protect-events: over the byte budget' });
  });

  it('id64 ids are accepted, longer are not', () => {
    expect(validateProtectPageMessage(events({ sensorBootId: id64, relaySessionId: id64 })).ok).toBe(true);
  });
});

describe('SW -> ISOLATED: protect-ack and protect-control', () => {
  const ajvValidate = compileSchema('protect-page.v1.schema.json');
  const ackCases: Case[] = [
    { name: 'ack inactive', input: { schemaVersion: 1, type: 'protect-ack', active: false, groups: 0 }, expect: 'ok' },
    { name: 'ack active with salt', input: { schemaVersion: 1, type: 'protect-ack', active: true, saltId: 'salt-0001', salt: 'AbCdEfGhIjKlMnOpQrSt_-', groups: 3 }, expect: 'ok' },
    { name: 'ack active without salt', input: { schemaVersion: 1, type: 'protect-ack', active: true, groups: 1 }, expect: 'ok' },
    { name: 'ack salt without saltId', input: { schemaVersion: 1, type: 'protect-ack', active: true, salt: 'AbCdEfGhIjKlMnOpQrSt_-', groups: 1 }, expect: 'fail' },
    { name: 'ack salt while inactive', input: { schemaVersion: 1, type: 'protect-ack', active: false, saltId: 'salt-0001', salt: 'AbCdEfGhIjKlMnOpQrSt_-', groups: 0 }, expect: 'fail' },
    { name: 'ack salt 21 chars', input: { schemaVersion: 1, type: 'protect-ack', active: true, saltId: 'salt-0001', salt: 'AbCdEfGhIjKlMnOpQrSt_', groups: 1 }, expect: 'fail' },
    { name: 'ack groups 4', input: { schemaVersion: 1, type: 'protect-ack', active: true, groups: 4 }, expect: 'fail' },
    { name: 'ack with tabId', input: { schemaVersion: 1, type: 'protect-ack', active: true, groups: 0, tabId: 1 }, expect: 'fail' },
  ];
  for (const c of ackCases) {
    it(c.name, () => {
      const hand = validateProtectAck(c.input);
      expect(hand.ok).toBe(c.expect === 'ok');
      expect(ajvValidate(c.input)).toBe(hand.ok);
      if (hand.ok) expect(hand.value).toEqual(c.input);
    });
  }

  for (const command of ['stop', 'rekey', 'pause', 'resume']) {
    it('control ' + command, () => {
      const message = { schemaVersion: 1, type: 'protect-control', command };
      expect(validateProtectControl(message)).toEqual({ ok: true, value: message });
      expect(ajvValidate(message)).toBe(true);
    });
  }

  it('control rejects unknown commands, extra keys and page messages', () => {
    for (const bad of [
      { schemaVersion: 1, type: 'protect-control', command: 'export' },
      { schemaVersion: 1, type: 'protect-control', command: 'stop', documentId: 'X' },
      { schemaVersion: 1, type: 'protect-hello', startedLate: false },
      { schemaVersion: 2, type: 'protect-control', command: 'stop' },
      null,
    ]) {
      expect(validateProtectControl(bad).ok).toBe(false);
    }
  });
});
