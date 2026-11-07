// ADR-020 §B (S07): variants of a typed value against a node:crypto oracle. The golden part pins the variant list of
// fixed inputs (order = priority, cut at maxVariantsPerField); the oracle recomputes every hash variant from the
// canonical forms (email trim+lower; phone digits and +digits, 8XXXXXXXXXX → 7XXXXXXXXXX; name lower and lower
// without spaces). Plain forms and their encodings need ≥ plaintextMinChars, hashes ≥ hashMinChars.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PROTECT_BUDGETS } from '@detect-expert/contracts';
import { buildVariants, isMultiWord, isTokenChar } from '../src/protect/match/index';
import type { ValueVariant } from '../src/protect/match/index';

function oracleHashes(forms: string[]): Array<{ enc: string; text: string }> {
  const out: Array<{ enc: string; text: string }> = [];
  const digests: Array<{ algo: string; d: Buffer }> = [];
  for (const f of [...new Set(forms)]) for (const algo of ['sha256', 'md5', 'sha1', 'sha512']) digests.push({ algo, d: createHash(algo).update(f, 'utf8').digest() });
  for (const { algo, d } of digests) out.push({ enc: algo + '-hex', text: d.toString('hex') });
  for (const { algo, d } of digests) out.push({ enc: algo + '-base64', text: d.toString('base64') });
  for (const { algo, d } of digests) out.push({ enc: algo + '-base64', text: d.toString('base64').replace(/=+$/, '') });
  return out;
}

function pick(list: ValueVariant[], encs: (e: string) => boolean): Array<{ enc: string; text: string }> {
  return list.filter((v) => encs(v.enc)).map((v) => ({ enc: v.enc, text: v.text }));
}

const isHash = (e: string): boolean => /^(md5|sha1|sha256|sha512)-/.test(e);

describe('buildVariants: golden lists', () => {
  it('e-mail with spaces and capitals', () => {
    const v = buildVariants('email', ' User@Example.com ');
    expect(pick(v, (e) => e === 'plain' || e === 'plain-normalized')).toEqual([
      { enc: 'plain', text: 'User@Example.com' },
      { enc: 'plain', text: ' User@Example.com ' },
      { enc: 'plain-normalized', text: 'user@example.com' },
    ]);
    expect(pick(v, isHash)).toEqual(oracleHashes(['user@example.com']).filter((x, i, a) => a.findIndex((y) => y.text === x.text) === i));
    expect(pick(v, (e) => e === 'url-encoded')).toEqual([
      { enc: 'url-encoded', text: 'User%40Example.com' },
      { enc: 'url-encoded', text: '%20User%40Example.com%20' },
      { enc: 'url-encoded', text: '+User%40Example.com+' },
      { enc: 'url-encoded', text: 'user%40example.com' },
    ]);
    const b64 = pick(v, (e) => e === 'base64').map((x) => x.text);
    for (const s of ['User@Example.com', ' User@Example.com ', 'user@example.com']) {
      expect(b64).toContain(Buffer.from(s, 'utf8').toString('base64'));
      expect(b64).toContain(Buffer.from(s, 'utf8').toString('base64url'));
    }
  });

  it('Russian phone in national form: digits, +digits, 8 → 7 forms; hashes of the international digits', () => {
    const v = buildVariants('phone', '8 (999) 123-45-67');
    expect(pick(v, (e) => e === 'plain' || e === 'plain-normalized').map((x) => x.text)).toEqual([
      '8 (999) 123-45-67',
      '89991234567',
      '+89991234567',
      '79991234567',
      '+79991234567',
    ]);
    expect(pick(v, isHash)).toEqual(oracleHashes(['79991234567', '+79991234567']));
  });

  it('10-digit phone: country forms 7 and 1 as plain; hashes of the typed digits', () => {
    const v = buildVariants('phone', '9991234567');
    expect(pick(v, (e) => e === 'plain-normalized').map((x) => x.text)).toEqual(['+9991234567', '79991234567', '+79991234567', '19991234567', '+19991234567']);
    expect(pick(v, isHash)).toEqual(oracleHashes(['9991234567', '+9991234567']));
  });

  it('name: lower, without punctuation and spaces, with single spaces; hashes of lower and lower without spaces', () => {
    const v = buildVariants('name', 'Анна-Мария  Иванова');
    expect(pick(v, (e) => e === 'plain' || e === 'plain-normalized').map((x) => x.text)).toEqual([
      'Анна-Мария  Иванова',
      'анна-мария  иванова',
      'аннамарияиванова',
      'аннамария иванова',
    ]);
    expect(pick(v, isHash)).toEqual(oracleHashes(['анна-мария  иванова', 'аннамарияиванова']));
  });

  it('a short name (< plaintextMinChars) has no plain form or encoding, only hashes', () => {
    const v = buildVariants('name', 'Анна');
    expect(v.every((x) => isHash(x.enc))).toBe(true);
    expect(pick(v, isHash)).toEqual(oracleHashes(['анна']));
    expect(buildVariants('name', 'Ян')).toEqual([]);
  });
});

describe('buildVariants: bounds and flags', () => {
  it('≤ maxVariantsPerField, unique texts, every length in [3, 1024]', () => {
    for (const [kind, value] of [['email', 'a.very.long.address+tag@sub.example-domain.com'], ['phone', '+7 (999) 123-45-67'], ['name', 'Jean-Pierre O’Connor de la Fontaine']] as const) {
      const v = buildVariants(kind, value);
      expect(v.length).toBeLessThanOrEqual(PROTECT_BUDGETS.maxVariantsPerField);
      expect(new Set(v.map((x) => x.text)).size).toBe(v.length);
      for (const x of v) {
        expect(x.text.length).toBeGreaterThanOrEqual(3);
        expect(x.text.length).toBeLessThanOrEqual(1024);
      }
    }
  });

  it('multi-word variants are flagged (a separator inside: found by a rolling window, never as one token)', () => {
    const v = buildVariants('name', 'Anna Ivanova');
    expect(v.find((x) => x.text === 'Anna Ivanova')?.multiword).toBe(true);
    expect(v.find((x) => x.text === 'annaivanova')?.multiword).toBe(false);
    expect(isMultiWord('user@example.com')).toBe(false);
    expect(isMultiWord('+7 999')).toBe(true);
    for (const c of '@.+-_%aZ9Ж') expect(isTokenChar(c.charCodeAt(0))).toBe(true);
    for (const c of ' ,;:/=?&"\'«»  ') expect(isTokenChar(c.charCodeAt(0))).toBe(false);
  });
});
