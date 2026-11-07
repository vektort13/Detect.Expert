// ADR-020 §B, REQ-005 revision (S07, review round 3): a typed value planted in the page-controlled strings of a request
// that also carries a matched value — as a JSON key, as a URL-encoded key (query, urlencoded body, formData), as a
// Base64url hash digest key, and in the endpoint host — never reaches storage.session, storage.local, the module
// database, the projection, diagnostics, lane debug numbers or the console. Also when the value reaches the SW only
// after its request (token ring) or after the ring window (stored records are rewritten). Parameter names are
// omitted, hosts fold into their registrable domain.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PARAM_NAME_PATTERN, PROTECT_BUDGETS, isDomainName } from '@detect-expert/contracts';
import {
  commitTop,
  emitRequest,
  emitSent,
  findCanaries,
  hello,
  input,
  report,
  request,
  settleProtect,
  setupValueMatch,
  sha256Hex,
  transfers,
} from '../../packages/background/test/protect/value-match-support';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const registry = JSON.parse(readFileSync(path.join(root, 'fixtures/privacy/canaries.json'), 'utf8')) as { protect: Array<{ id: string; value: string }> };
const canary = (id: string): string => registry.protect.find((c) => c.id === id)!.value;
const EMAIL = canary('protect-email');
const PHONE = canary('protect-phone');
const NAME = canary('protect-name');
/** The name without spaces, lower case: one of its matched variants, and a valid key or host label. */
const NAME_JOINED = NAME.toLowerCase().replace(/\s+/g, '');
const PHONE_DIGITS = '79005557391';
const WORD = 'Kanareikova'; // a single-word name, typed before its requests
const LATE = 'Ptichkina'; // a single-word name that reaches the SW after its requests
const EM = sha256Hex(EMAIL.toLowerCase());
const digestB64url = (algo: string, v: string): string => createHash(algo).update(v, 'utf8').digest('base64url');

let logged: string[] = [];
beforeEach(() => {
  logged = [];
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    });
  }
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('typed values in parameter names and hosts (review round 3, REQ-005 revision)', () => {
  it('a value as a JSON key, a URL-encoded key, a hash key or a host label is kept nowhere', async () => {
    const s = await setupValueMatch();
    commitTop(s);
    const ack = await hello(s);
    await input(s, ack, [
      { kind: 'email', value: EMAIL },
      { kind: 'phone', value: PHONE, fieldRef: 2 },
      { kind: 'name', value: NAME, fieldRef: 3 },
      { kind: 'name', value: WORD, fieldRef: 4 },
    ]);
    const md5Key = digestB64url('md5', EMAIL.toLowerCase());
    const shaKey = digestB64url('sha256', EMAIL.toLowerCase());
    const planted = [
      // JSON keys.
      request({ url: 'https://j1.example.org/j', body: JSON.stringify({ contacts: { [WORD]: { em: EM } } }) }),
      request({ url: 'https://j2.example.org/j', body: JSON.stringify({ [NAME_JOINED]: EM }) }),
      request({ url: 'https://j3.example.org/j', body: JSON.stringify({ d: { [md5Key]: EM } }) }),
      // URL-encoded keys: query, urlencoded body, formData.
      request({ url: 'https://q1.example.org/p?' + WORD + '=' + EM, type: 'image' }),
      request({ url: 'https://q2.example.org/p?' + shaKey + '=' + EM, type: 'image' }),
      request({ url: 'https://f1.example.org/f', body: 'ud[' + NAME_JOINED + ']=' + EM + '&ev=Lead' }),
      request({ url: 'https://f2.example.org/f', form: { [WORD.toUpperCase() + '_em']: [EM] } }),
      // Endpoint hosts.
      request({ url: 'https://' + WORD.toLowerCase() + '.tracker.example.net/tr?h=' + EM, type: 'image' }),
      request({ url: 'https://' + NAME_JOINED + '.px.example.com/tr?h=' + EM, type: 'image' }),
      request({ url: 'https://p' + PHONE_DIGITS + '.px.example.info/tr?h=' + EM, type: 'image' }),
    ];
    for (const d of planted) {
      emitRequest(s, d);
      emitSent(s, d);
    }
    // A value typed after its requests: one older than the token ring (stored record only), one inside it (reverse).
    const late = (sub: string): string => 'https://' + LATE.toLowerCase() + '.' + sub;
    const old = emitRequest(s, request({ url: late('old.example.org') + '/l?' + LATE + '=' + EM, type: 'image' }));
    emitSent(s, old);
    s.clock.t += PROTECT_BUDGETS.ringWindowMs + 1;
    const recent = emitRequest(s, request({ url: late('px.example.org') + '/l', body: JSON.stringify({ [LATE]: { em: EM }, fn: LATE }) }));
    emitSent(s, recent);
    s.clock.t += 300;
    await input(s, ack, [{ kind: 'name', value: LATE, fieldRef: 5 }]);
    await settleProtect(20);
    await s.controller.docStore.flush();

    const ev = transfers(s);
    const hosts = ev.map((e) => e.endpointHost);
    expect(hosts).toEqual(expect.arrayContaining(['j1.example.org', 'j2.example.org', 'j3.example.org', 'q1.example.org', 'q2.example.org', 'f1.example.org', 'f2.example.org']));
    expect(hosts).toEqual(expect.arrayContaining(['example.net', 'example.com', 'example.info', 'example.org']));
    const keyed = ev.filter((e) => e.fieldKind === 'email' && /^[jqf][0-9]\.example\.org$/.test(e.endpointHost ?? ''));
    expect(keyed.length).toBe(7);
    for (const e of keyed) expect(e.paramName, e.endpointHost ?? '').toBeUndefined();
    expect(ev.find((e) => e.fieldKind === 'name' && e.paramName === 'fn')).toMatchObject({ endpointHost: 'example.org', sinceInput: 'before-value' });
    for (const e of ev) {
      expect(e.endpointHost === null || isDomainName(e.endpointHost)).toBe(true);
      if (e.paramName !== undefined) expect(PARAM_NAME_PATTERN.test(e.paramName), e.paramName).toBe(true);
    }

    const values = [EMAIL, PHONE, NAME, NAME_JOINED, PHONE_DIGITS, '+' + PHONE_DIGITS, WORD, LATE];
    const dumps: Record<string, unknown> = {
      session: Object.fromEntries(s.fake.session.data),
      local: Object.fromEntries(s.fake.local.data),
      db: [...s.db.stores].map(([name, rows]) => [name, [...rows.values()]]),
      projection: report(s),
      diagnostics: s.controller.diagnostics(),
      laneDebug: s.vm.debug!(),
      console: logged,
    };
    for (const [name, dump] of Object.entries(dumps)) {
      const text = JSON.stringify(dump) ?? '';
      expect(findCanaries(text, values), name).toEqual([]);
      const lower = text.toLowerCase();
      for (const v of values) expect(lower.includes(v.toLowerCase()), name + ' holds ' + v.slice(0, 4)).toBe(false);
      for (const k of [md5Key, shaKey]) expect(text.includes(k), name + ' holds a digest key').toBe(false);
    }
  });
});
