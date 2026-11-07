import { classifyField, isPaymentField, isValueShapeOk } from '@detect-expert/engine';
import type { FieldClass, FieldView } from '@detect-expert/engine';
import { describe, expect, it } from 'vitest';

function view(over: Partial<FieldView> = {}): FieldView {
  return { tag: 'input', type: 'text', autocomplete: '', name: '', id: '', placeholder: '', ariaLabel: '', readOnly: false, disabled: false, everPassword: false, ...over };
}

const MATRIX: Array<[string, Partial<FieldView>, FieldClass | null]> = [
  // 1. tag / type filter
  ['textarea', { tag: 'textarea', name: 'email' }, null],
  ['select', { tag: 'select', name: 'email' }, null],
  ['div', { tag: 'div' }, null],
  ['type=search', { type: 'search', name: 'email' }, null],
  ['type=number', { type: 'number', name: 'phone' }, null],
  ['type=hidden', { type: 'hidden', name: 'email' }, null],
  ['type=url', { type: 'url' }, null],
  // 2. password now or ever (before the type filter)
  ['type=password', { type: 'password' }, { never: 'password' }],
  ['type=password with email name', { type: 'password', name: 'email' }, { never: 'password' }],
  ['everPassword shown as text', { type: 'text', everPassword: true, name: 'email' }, { never: 'was-password' }],
  ['everPassword with type=email', { type: 'email', everPassword: true }, { never: 'was-password' }],
  // 3. autocomplete
  ['autocomplete current-password', { autocomplete: 'current-password' }, { never: 'password' }],
  ['autocomplete new-password', { autocomplete: 'section-a new-password' }, { never: 'password' }],
  ['autocomplete one-time-code', { autocomplete: 'one-time-code', name: 'email' }, { never: 'one-time-code' }],
  ['autocomplete cc-number', { autocomplete: 'cc-number', type: 'tel' }, { never: 'payment' }],
  ['autocomplete cc-csc', { autocomplete: 'billing cc-csc' }, { never: 'payment' }],
  ['autocomplete cc-name', { autocomplete: 'cc-name', name: 'name' }, { never: 'payment' }],
  // 4. credential hints
  ['name passwd', { name: 'passwd' }, { never: 'credential-hint' }],
  ['id user_pwd', { id: 'user_pwd' }, { never: 'credential-hint' }],
  ['placeholder пароль', { placeholder: 'введите пароль' }, { never: 'credential-hint' }],
  ['name otp', { name: 'otp' }, { never: 'credential-hint' }],
  ['aria pin', { ariaLabel: 'pin' }, { never: 'credential-hint' }],
  ['name token', { name: 'api_token' }, { never: 'credential-hint' }],
  ['name sms code', { name: 'sms_code' }, { never: 'credential-hint' }],
  ['placeholder код', { placeholder: 'код из смс' }, { never: 'credential-hint' }],
  ['name snils', { name: 'snils' }, { never: 'credential-hint' }],
  ['name passport', { name: 'passport_no' }, { never: 'credential-hint' }],
  ['name account email', { type: 'email', name: 'account_email' }, { never: 'credential-hint' }],
  ['name card → payment', { name: 'card_number' }, { never: 'payment' }],
  ['name cvv → payment', { name: 'cvv' }, { never: 'payment' }],
  ['aria cvc → payment', { ariaLabel: 'cvc' }, { never: 'payment' }],
  ['name iban → payment', { name: 'iban' }, { never: 'payment' }],
  ['placeholder номер карты (credential-hint)', { placeholder: 'номер карты' }, { never: 'credential-hint' }],
  // 5. read-only / disabled
  ['readOnly email', { type: 'email', readOnly: true }, null],
  ['disabled phone', { type: 'tel', disabled: true }, null],
  // 6. e-mail
  ['type=email', { type: 'email' }, { kind: 'email' }],
  ['autocomplete email', { autocomplete: 'email' }, { kind: 'email' }],
  ['name e-mail', { name: 'e-mail' }, { kind: 'email' }],
  ['placeholder почта', { placeholder: 'ваша почта' }, { kind: 'email' }],
  ['type="" name email', { type: '', name: 'email' }, { kind: 'email' }],
  // 7. phone
  ['type=tel', { type: 'tel' }, { kind: 'phone' }],
  ['autocomplete tel-national', { autocomplete: 'tel-national' }, { kind: 'phone' }],
  ['name phone', { name: 'phone' }, { kind: 'phone' }],
  ['placeholder телефон', { placeholder: 'телефон' }, { kind: 'phone' }],
  ['name mobile', { name: 'mobile' }, { kind: 'phone' }],
  ['telegram is not a phone', { name: 'telegram' }, null],
  ['type=tel named telegram', { type: 'tel', name: 'telegram' }, null],
  // 8. person name
  ['autocomplete given-name', { autocomplete: 'given-name' }, { kind: 'name' }],
  ['autocomplete family-name', { autocomplete: 'family-name' }, { kind: 'name' }],
  ['name first_name', { name: 'first_name' }, { kind: 'name' }],
  ['id lastname', { id: 'lastname' }, { kind: 'name' }],
  ['name fullName lowercased', { name: 'fullname' }, { kind: 'name' }],
  ['placeholder имя', { placeholder: 'имя' }, { kind: 'name' }],
  ['placeholder фамилия', { placeholder: 'фамилия' }, { kind: 'name' }],
  ['name fio', { name: 'fio' }, { kind: 'name' }],
  ['username is not a name', { name: 'username' }, null],
  ['autocomplete username', { autocomplete: 'username', name: 'name' }, null],
  ['nickname is not a name', { name: 'nickname' }, null],
  ['company name is not a name', { name: 'company_name' }, null],
  ['login is not a name', { name: 'login' }, null],
  ['имя пользователя is not a name', { placeholder: 'имя пользователя' }, null],
  // 9. anything else
  ['plain search box', { name: 'q' }, null],
  ['city', { name: 'city' }, null],
];

describe('classifyField matrix (ADR-020 §3; never-read classes before kinds)', () => {
  it('has at least 40 cases', () => {
    expect(MATRIX.length).toBeGreaterThanOrEqual(40);
  });

  it.each(MATRIX)('%s', (_name, over, expected) => {
    expect(classifyField(view(over))).toEqual(expected);
  });

  it('attributes are normalized defensively (case, 64-char bound)', () => {
    expect(classifyField(view({ tag: 'INPUT', type: 'PASSWORD' }))).toEqual({ never: 'password' });
    expect(classifyField(view({ name: 'x'.repeat(80) + 'password' }))).toBeNull();
  });

  it('no classification ever yields a password kind', () => {
    for (const [, over] of MATRIX) {
      const c = classifyField(view(over));
      if (c !== null && 'kind' in c) expect(['email', 'phone', 'name']).toContain(c.kind);
    }
  });
});

describe('isPaymentField', () => {
  it.each([
    [{ autocomplete: 'cc-number' }, true],
    [{ autocomplete: 'cc-exp', type: 'number' }, true],
    [{ name: 'card' }, true],
    [{ id: 'cvv2' }, true],
    [{ tag: 'select', autocomplete: 'cc-exp-month' }, true],
    [{ type: 'hidden', autocomplete: 'cc-number' }, false],
    [{ name: 'email' }, false],
    [{ tag: 'textarea', name: 'card' }, false],
  ] as Array<[Partial<FieldView>, boolean]>)('%j → %s', (over, expected) => {
    expect(isPaymentField(view(over))).toBe(expected);
  });
});

describe('isValueShapeOk', () => {
  it.each([
    ['email', 'a@b.cc', true],
    ['email', 'user.name+tag@example.test', true],
    ['email', 'no-at-sign', false],
    ['email', 'a b@c.de', false],
    ['email', 'x@y.z', false],
    ['phone', '+7 900 555-73-91', true],
    ['phone', '(495) 123-45-67', true],
    ['phone', '123456', false],
    ['phone', '1234567890123456', false],
    ['phone', '+7 900 abc', false],
    ['name', 'Canaryname Testova', true],
    ['name', 'Jo2', false],
    ['name', 'ab', false],
    ['name', 'x'.repeat(129), false],
  ] as Array<['email' | 'phone' | 'name', string, boolean]>)('%s %j → %s', (kind, value, expected) => {
    expect(isValueShapeOk(kind, value)).toBe(expected);
  });
});
