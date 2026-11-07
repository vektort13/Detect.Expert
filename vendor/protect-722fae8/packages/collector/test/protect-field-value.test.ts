// ADR-020 §4, §12 (S05): field-value.ts is the only reader of a field value. For every never-read class the fake's
// `value` getter throws and must never be called; an e-mail field is read exactly once; a payment control in the
// document suspends every read (null, no getter call).

import { describe, expect, it } from 'vitest';
import type { FieldKind } from '@detect-expert/contracts';
import { EverPasswordTracker } from '../src/protect/classify';
import { readTrackedValue } from '../src/protect/field-value';
import type { ReadContext } from '../src/protect/field-value';
import { FakeField, FakeProtectEnv, input } from './protect-fakes';

function context(options: { payment?: boolean; tracker?: EverPasswordTracker } = {}): ReadContext {
  return { tracker: options.tracker ?? new EverPasswordTracker(null), documentHasPaymentField: () => options.payment === true };
}

function read(el: FakeField, ctx: ReadContext = context()): { outcome: ReturnType<typeof readTrackedValue<string>>; uses: Array<[FieldKind, string]> } {
  const uses: Array<[FieldKind, string]> = [];
  const outcome = readTrackedValue(el, ctx, (kind, typed) => {
    uses.push([kind, typed]);
    return 'used';
  });
  return { outcome, uses };
}

const NEVER: Array<[string, Record<string, string>]> = [
  ['type=password', { type: 'password', name: 'email' }],
  ['type=PASSWORD (case)', { type: 'PASSWORD' }],
  ['type=" password " (spaces)', { type: ' password ' }],
  ['autocomplete current-password', { type: 'text', autocomplete: 'current-password' }],
  ['autocomplete new-password', { type: 'email', autocomplete: 'username new-password' }],
  ['one-time-code', { type: 'text', autocomplete: 'one-time-code' }],
  ['cc-number', { type: 'text', autocomplete: 'cc-number' }],
  ['cc-csc', { type: 'tel', autocomplete: 'cc-csc' }],
  ['name hint: card', { type: 'text', name: 'cardnumber' }],
  ['name hint: cvv', { type: 'tel', id: 'cvv' }],
  ['name hint: pin', { type: 'tel', name: 'pin' }],
  ['name hint: otp', { type: 'text', placeholder: 'OTP' }],
  ['name hint: token', { type: 'text', 'aria-label': 'API token' }],
  ['name hint: парол', { type: 'text', placeholder: 'Пароль' }],
  ['name hint: code', { type: 'text', name: 'sms_code' }],
];

describe('readTrackedValue: never-read classes are never read', () => {
  for (const [label, attrs] of NEVER) {
    it(label + ' -> never, the throwing getter is not called', () => {
      const el = input(attrs, true);
      const { outcome, uses } = read(el);
      expect(outcome.status).toBe('never');
      expect(el.reads).toBe(0);
      expect(uses).toEqual([]);
    });
  }

  it('a field that was a password (show-password toggled it to text) -> was-password, never read', () => {
    const env = new FakeProtectEnv();
    const tracker = new EverPasswordTracker((cb) => env.observeTypeAttributes(cb));
    const el = input({ type: 'password', name: 'email', autocomplete: 'email' }, true);
    env.watch(el);
    el.setAttribute('type', 'text'); // the record is still pending (same task): has() drains it first
    const { outcome } = read(el, context({ tracker }));
    expect(outcome).toEqual({ status: 'never', never: 'was-password' });
    expect(el.reads).toBe(0);
  });

  it('a password seen at focus and later turned into type=email stays never-read', () => {
    const tracker = new EverPasswordTracker(null);
    const el = input({ type: 'password' }, true);
    tracker.note(el);
    el.setAttribute('type', 'email');
    expect(read(el, context({ tracker })).outcome).toEqual({ status: 'never', never: 'was-password' });
    expect(el.reads).toBe(0);
  });
});

describe('readTrackedValue: untracked controls are never read', () => {
  const cases: Array<[string, FakeField]> = [
    ['textarea', new FakeField('textarea', { name: 'email' }, true)],
    ['select', new FakeField('select', { name: 'email' }, true)],
    ['checkbox', input({ type: 'checkbox', name: 'email' }, true)],
    ['hidden', input({ type: 'hidden', name: 'email' }, true)],
    ['number', input({ type: 'number', name: 'phone' }, true)],
    ['search without hints', input({ type: 'search' }, true)],
    ['text without hints', input({ type: 'text', name: 'comment' }, true)],
    ['readonly e-mail', input({ type: 'email', readonly: '' }, true)],
    ['disabled e-mail', input({ type: 'email', disabled: '' }, true)],
    ['username', input({ type: 'text', name: 'username', autocomplete: 'username' }, true)],
  ];
  for (const [label, el] of cases) {
    it(label + ' -> not-tracked, no read', () => {
      expect(read(el).outcome.status).toBe('not-tracked');
      expect(el.reads).toBe(0);
    });
  }
});

describe('readTrackedValue: tracked fields', () => {
  it('e-mail: exactly one getter call; the value goes to `use` only', () => {
    const el = input({ type: 'email', name: 'email' });
    el.type('person@example.test');
    const { outcome, uses } = read(el);
    expect(el.reads).toBe(1);
    expect(uses).toEqual([['email', 'person@example.test']]);
    expect(outcome).toEqual({ status: 'read', fieldKind: 'email', result: 'used' });
  });

  it('phone and name are read once each', () => {
    const phone = input({ type: 'tel', autocomplete: 'tel' });
    phone.type('+7 900 555-73-91');
    const name = input({ type: 'text', autocomplete: 'name' });
    name.type('Canaryname Testova');
    expect(read(phone).outcome).toMatchObject({ status: 'read', fieldKind: 'phone' });
    expect(read(name).outcome).toMatchObject({ status: 'read', fieldKind: 'name' });
    expect([phone.reads, name.reads]).toEqual([1, 1]);
  });

  it('a payment control in the document -> payment-suspended without a read', () => {
    const el = input({ type: 'email', name: 'email' }, true);
    const { outcome, uses } = read(el, context({ payment: true }));
    expect(outcome).toEqual({ status: 'payment-suspended' });
    expect(el.reads).toBe(0);
    expect(uses).toEqual([]);
  });

  it('a value outside the shape (too short, not an e-mail, too long) is read once and rejected: `use` is not called', () => {
    for (const text of ['ab', 'not-an-email', 'x'.repeat(260) + '@example.test']) {
      const el = input({ type: 'email' });
      el.type(text);
      const { outcome, uses } = read(el);
      expect(outcome).toEqual({ status: 'rejected-shape' });
      expect(el.reads).toBe(1);
      expect(uses).toEqual([]);
    }
    const phone = input({ type: 'tel' });
    phone.type('12');
    expect(read(phone).outcome.status).toBe('rejected-shape');
    const name = input({ type: 'text', autocomplete: 'name' });
    name.type('R2D2 droid');
    expect(read(name).outcome.status).toBe('rejected-shape');
  });
});
