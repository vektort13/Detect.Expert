// ADR-020 §B (S07): the form-leak rule — transfer classes, severities and interpretation confidence (form-leak.v1,
// calibrated:false). Tables from the S07 brief.

import { describe, expect, it } from 'vitest';
import type { SiteRelation, SubmitTiming, TransferClass, ValueEncoding } from '@detect-expert/contracts';
import { FORM_LEAK_THRESHOLDS, assessConfidence, classifyTransfer, isPiiNameKey, severityOf } from '../src/protect/form-leak';
import thresholds from '../src/protect/thresholds/form-leak.v1.json';

describe('form-leak.v1 thresholds', () => {
  it('match the brief and stay uncalibrated', () => {
    expect(thresholds).toMatchObject({ calibrated: false, plaintextMinChars: 6, hashMinChars: 3, ringWindowMs: 10000, opaqueWindowMs: 2000, submitCarryMs: 60000, crossSiteGraceMs: 60000 });
    expect(FORM_LEAK_THRESHOLDS.calibrated).toBe(false);
  });
});

describe('classifyTransfer', () => {
  const cases: Array<[SiteRelation, SubmitTiming, boolean, TransferClass | null]> = [
    ['cross-site', 'before-submit', false, 'third-party-before-submit'],
    ['cross-site', 'after-submit', false, 'third-party-at-submit'],
    ['cross-site', 'unknown', false, 'third-party-moment-unknown'],
    ['same-site', 'before-submit', false, 'first-party-before-submit'],
    ['same-origin', 'before-submit', false, 'first-party-before-submit'],
    ['same-site', 'after-submit', false, null],
    ['same-site', 'unknown', false, null],
    ['unknown', 'before-submit', false, 'receiver-unknown'],
    ['opaque', 'after-submit', false, 'receiver-unknown'],
    ['cross-site', 'before-submit', true, 'opaque-after-input'],
    ['cross-site', 'after-submit', true, 'opaque-after-input'],
    ['same-site', 'before-submit', true, null],
    ['unknown', 'before-submit', true, null],
  ];
  it.each(cases)('%s / %s / opaque=%s → %s', (relation, submitTiming, opaque, expected) => {
    expect(classifyTransfer({ relation, submitTiming, opaque })).toBe(expected);
  });
});

describe('severityOf', () => {
  it('maps classes to a color weight, never a word', () => {
    expect(severityOf('third-party-before-submit')).toBe('high');
    expect(severityOf('third-party-at-submit')).toBe('medium');
    expect(severityOf('third-party-moment-unknown')).toBe('medium');
    expect(severityOf('first-party-before-submit')).toBe('low');
    expect(severityOf('receiver-unknown')).toBe('info');
    expect(severityOf('opaque-after-input')).toBe('info');
  });
});

describe('assessConfidence', () => {
  interface Extra { baseLength: number; paramName: string | null; normalizedOnly: boolean; fromPreviousDocument: boolean; opaque: boolean }
  const base: Extra = { baseLength: 0, paramName: null, normalizedOnly: false, fromPreviousDocument: false, opaque: false };
  const run = (fieldKind: 'email' | 'phone' | 'name', encodings: ValueEncoding[], extra: Partial<Extra> = {}) => assessConfidence({ ...base, fieldKind, encodings, ...extra });

  it('hashes: e-mail and phone high, name medium', () => {
    expect(run('email', ['sha256-hex']).level).toBe('high');
    expect(run('phone', ['md5-base64']).level).toBe('high');
    expect(run('name', ['sha256-hex']).level).toBe('medium');
  });

  it('plain e-mail high; plain phone medium with ≥ 10 digits, else low', () => {
    expect(run('email', ['plain']).level).toBe('high');
    expect(run('email', ['url-encoded']).level).toBe('high');
    expect(run('phone', ['plain'], { baseLength: 11 }).level).toBe('medium');
    expect(run('phone', ['plain'], { baseLength: 9 }).level).toBe('low');
  });

  it('plain name: medium only under a personal-name key, else low with name-plaintext-ambiguous', () => {
    for (const key of ['fn', 'ln', 'name', 'first_name', 'user.last_name', 'ud[fn]', 'fio', 'surname']) expect(run('name', ['plain'], { paramName: key }).level, key).toBe('medium');
    const r = run('name', ['plain'], { paramName: 'q' });
    expect(r.level).toBe('low');
    expect(r.limitationCodes).toEqual(['name-plaintext-ambiguous']);
    expect(isPiiNameKey(null)).toBe(false);
    expect(isPiiNameKey('username')).toBe(false);
  });

  it('only after normalization: one level lower for phone and name, not for e-mail or hashes', () => {
    expect(run('phone', ['plain-normalized'], { baseLength: 11, normalizedOnly: true }).level).toBe('low');
    expect(run('name', ['plain-normalized'], { paramName: 'fn', normalizedOnly: true }).level).toBe('low');
    expect(run('email', ['plain-normalized'], { normalizedOnly: true }).level).toBe('high');
    expect(run('phone', ['sha256-hex'], { normalizedOnly: true }).level).toBe('high');
  });

  it('a value from a previous document is at most medium; an opaque body is low', () => {
    const prev = run('email', ['sha256-hex'], { fromPreviousDocument: true });
    expect(prev.level).toBe('medium');
    expect(prev.limitationCodes).toContain('value-from-previous-document');
    expect(run('email', [], { opaque: true }).level).toBe('low');
  });
});
