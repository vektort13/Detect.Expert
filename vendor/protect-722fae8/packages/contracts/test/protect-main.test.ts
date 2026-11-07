// ADR-020 «Защита» (S02): MAIN <-> ISOLATED messages on detect.expert/protect/v1, ScriptRef invariants by kind,
// idempotence of templateScriptPath, and relay parsing with captured intrinsics (the page can poison prototypes).
import { describe, expect, it } from 'vitest';
import {
  BUDGETS,
  CHANNEL,
  PROTECT_BUDGETS,
  PROTECT_CHANNEL,
  SCRIPT_REF_KINDS,
  UNBOUND_SENSOR_BOOT_ID,
  isScriptHost,
  isScriptPathTemplate,
  jsonLengthUpTo,
  templateScriptPath,
  validateProtectMainMessage,
  validateProtectRelayMessage,
  type ProtectMainBatchMessage,
} from '../src/index';
import { compileSchema, throwingProxy, withOwnProtoKey } from './helpers';

type Json = Record<string, unknown>;

interface Case {
  name: string;
  input: unknown;
  expect: 'main' | 'relay' | 'fail';
  handOnly?: boolean;
}

const header: Json = { channel: PROTECT_CHANNEL, sensorBootId: 'boot-1' };
const external: Json = { kind: 'external', scheme: 'https', host: 'cdn.tracker.example', pathTemplate: '/js/rec.:id.js' };
const send: Json = { hookPoint: 'send-fetch', sensorSeq: 4, tMs: 12340, script: external, sampled: true, target: { kind: 'absolute', host: '*.collect.example' } };
const registration: Json = { hookPoint: 'listen', eventCode: 'mousemove', targetKind: 'window', script: { kind: 'eval' }, sampled: false, count: 120, tMs: 0 };
const batch = (extra: Json = {}): Json => ({
  ...header,
  type: 'protect-main-batch',
  sensorSeq: 1,
  sends: [send],
  registrations: [registration],
  dropped: { sends: 0, registrations: 0, unsampled: 0 },
  limitations: [],
  ...extra,
});

const cases: Case[] = [
  { name: 'main hello', input: { ...header, type: 'protect-main-hello', protocolVersion: 1, startedLate: false, groups: 3 }, expect: 'main' },
  { name: 'main batch', input: batch(), expect: 'main' },
  { name: 'main batch dropped only', input: batch({ sends: [], registrations: [], dropped: { sends: 2, registrations: 0, unsampled: 9 } }), expect: 'main' },
  { name: 'relay hello', input: { ...header, type: 'protect-relay-hello', protocolVersion: 1, relaySessionId: 'relay-1', paused: false }, expect: 'relay' },
  { name: 'relay hello unbound', input: { ...header, sensorBootId: UNBOUND_SENSOR_BOOT_ID, type: 'protect-relay-hello', protocolVersion: 1, relaySessionId: 'relay-1', paused: true }, expect: 'relay' },
  { name: 'relay pause', input: { ...header, type: 'protect-relay-pause' }, expect: 'relay' },
  { name: 'relay resume', input: { ...header, type: 'protect-relay-resume' }, expect: 'relay' },
  { name: 'relay stop', input: { ...header, type: 'protect-relay-stop', reason: 'revoked' }, expect: 'relay' },

  { name: 'observation channel', input: { ...header, channel: CHANNEL, type: 'protect-relay-pause' }, expect: 'fail' },
  { name: 'missing channel', input: { sensorBootId: 'boot-1', type: 'protect-relay-pause' }, expect: 'fail' },
  { name: 'sensor-hello on protect channel', input: { ...header, type: 'sensor-hello', protocolVersion: 1, startedLate: false, coverageFlags: [] }, expect: 'fail' },
  { name: 'ISOLATED -> SW type on window', input: { ...header, type: 'protect-events' }, expect: 'fail' },
  { name: 'extra key', input: { ...header, type: 'protect-relay-pause', extra: 1 }, expect: 'fail' },
  { name: 'own __proto__ key', input: withOwnProtoKey({ ...header, type: 'protect-relay-pause' }, '__proto__'), expect: 'fail' },
  { name: 'main hello groups 4', input: { ...header, type: 'protect-main-hello', protocolVersion: 1, startedLate: false, groups: 4 }, expect: 'fail' },
  { name: 'main batch tMs not a multiple of 10', input: batch({ sends: [{ ...send, tMs: 12345 }] }), expect: 'fail' },
  { name: 'main batch ageMs on the MAIN wire', input: batch({ sends: [{ ...send, tMs: undefined, ageMs: 0 }].map(strip) }), expect: 'fail' },
  { name: 'main batch sensorSeq 0', input: batch({ sensorSeq: 0 }), expect: 'fail' },
  { name: 'main batch 33 sends', input: batch({ sends: Array.from({ length: 33 }, () => send), registrations: [] }), expect: 'fail' },
  { name: 'main batch 32 + 1 samples', input: batch({ sends: Array.from({ length: 32 }, () => send) }), expect: 'fail', handOnly: true },
  { name: 'main batch empty', input: batch({ sends: [], registrations: [] }), expect: 'fail', handOnly: true },
  { name: 'main batch raw stack', input: batch({ sends: [{ ...send, stack: 'Error\n    at x (https://cdn.tracker.example/a.js:1:2)' }] }), expect: 'fail' },
  { name: 'main batch function name', input: batch({ sends: [{ ...send, script: { ...external, functionName: 'sendEmail' } }] }), expect: 'fail' },
  { name: 'main batch value length', input: batch({ registrations: [{ ...registration, valueLength: 12 }] }), expect: 'fail' },
  { name: 'main batch read-field hook', input: batch({ registrations: [{ ...registration, hookPoint: 'read-field' }] }), expect: 'fail' },
  { name: 'relay hello paused string', input: { ...header, type: 'protect-relay-hello', protocolVersion: 1, relaySessionId: 'relay-1', paused: 'no' }, expect: 'fail' },
  { name: 'relay stop unknown reason', input: { ...header, type: 'protect-relay-stop', reason: 'export' }, expect: 'fail' },
  { name: 'relay with tabId', input: { ...header, type: 'protect-relay-pause', tabId: 1 }, expect: 'fail' },
  { name: 'hostile proxy', input: throwingProxy(), expect: 'fail', handOnly: true },
];

function strip(o: Json): Json {
  return Object.fromEntries(Object.entries(o).filter(([, value]) => value !== undefined));
}

describe('protect MAIN <-> ISOLATED messages vs JSON Schema (protect-main.v1)', () => {
  const ajvValidate = compileSchema('protect-main.v1.schema.json');
  for (const c of cases) {
    it(c.name, () => {
      const main = validateProtectMainMessage(c.input);
      const relay = validateProtectRelayMessage(c.input);
      expect(main.ok).toBe(c.expect === 'main');
      expect(relay.ok).toBe(c.expect === 'relay');
      if (c.handOnly) return;
      expect(ajvValidate(c.input)).toBe(c.expect !== 'fail');
      const ok = main.ok ? main : relay.ok ? relay : null;
      if (ok !== null) {
        expect(ajvValidate(ok.value)).toBe(true);
        expect(ok.value).toEqual(c.input as Json);
        expect(ok.value).not.toBe(c.input);
      }
    });
  }

  it('worst-case main batch over 16 KiB is rejected after the structural checks; a full batch of typical samples fits', () => {
    const typical = batch({ sends: Array.from({ length: 16 }, (_, i) => ({ ...send, sensorSeq: i + 1 })), registrations: Array.from({ length: 16 }, () => registration) });
    expect(validateProtectMainMessage(typical).ok).toBe(true);
    expect(jsonLengthUpTo(typical, Number.MAX_SAFE_INTEGER)).toBe(JSON.stringify(typical).length);
    const host = ('*.' + 'a'.repeat(60) + '.').repeat(2) + 'b'.repeat(60) + '.example';
    expect(isScriptHost(host)).toBe(true);
    const heavyScript = { kind: 'external', scheme: 'https', host, pathTemplate: '/' + ['x'.repeat(20) + '.' + 'y'.repeat(19), 'z'.repeat(20) + '-' + 'w'.repeat(19)].join('/') };
    const heavy = batch({ sends: Array.from({ length: 32 }, (_, i) => ({ ...send, sensorSeq: i + 1, script: heavyScript, target: { kind: 'absolute', host } })), registrations: [] });
    expect(jsonLengthUpTo(heavy, Number.MAX_SAFE_INTEGER)).toBeGreaterThan(BUDGETS.maxBatchBytes);
    expect(validateProtectMainMessage(heavy)).toEqual({ ok: false, reason: 'protect-main-batch: over the byte budget' });
  });

  it('relay messages parse with captured intrinsics after Set/Array/RegExp/String poisoning (zero poisoned calls)', () => {
    const define = Object.defineProperty;
    const has = Object.getOwnPropertyDescriptor(Set.prototype, 'has')!;
    const iterator = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator)!;
    const includes = Object.getOwnPropertyDescriptor(Array.prototype, 'includes')!;
    const exec = Object.getOwnPropertyDescriptor(RegExp.prototype, 'exec')!;
    const slice = Object.getOwnPropertyDescriptor(String.prototype, 'slice')!;
    const message = { ...header, type: 'protect-relay-hello', protocolVersion: 1, relaySessionId: 'relay-1', paused: false };
    const stop = { ...header, type: 'protect-relay-stop', reason: 'scope-changed' };
    let calls = 0;
    const trap = (): never => {
      calls++;
      throw new Error('poisoned');
    };
    let results: unknown[] = [];
    try {
      define(Set.prototype, 'has', { ...has, value: trap });
      define(Array.prototype, Symbol.iterator, { ...iterator, value: trap });
      define(Array.prototype, 'includes', { ...includes, value: trap });
      define(RegExp.prototype, 'exec', { ...exec, value: trap });
      define(String.prototype, 'slice', { ...slice, value: trap });
      results = [validateProtectRelayMessage(message), validateProtectRelayMessage(stop)];
    } finally {
      define(Set.prototype, 'has', has);
      define(Array.prototype, Symbol.iterator, iterator);
      define(Array.prototype, 'includes', includes);
      define(RegExp.prototype, 'exec', exec);
      define(String.prototype, 'slice', slice);
    }
    expect(results).toEqual([
      { ok: true, value: message },
      { ok: true, value: stop },
    ]);
    expect(calls).toBe(0);
  });
});

describe('ScriptRef invariants by kind', () => {
  const validate = compileSchema('protect-main.v1.schema.json');
  const withScript = (script: unknown): Json => batch({ sends: [{ ...send, script }], registrations: [] });

  it('external carries exactly scheme, host and pathTemplate', () => {
    expect(validateProtectMainMessage(withScript(external)).ok).toBe(true);
    for (const missing of ['scheme', 'host', 'pathTemplate']) {
      const script = strip({ ...external, [missing]: undefined });
      expect(validateProtectMainMessage(withScript(script)).ok, missing).toBe(false);
      expect(validate(withScript(script)), missing).toBe(false);
    }
    for (const scheme of ['ftp', 'blob', 'chrome-extension', 'HTTPS']) {
      expect(validateProtectMainMessage(withScript({ ...external, scheme })).ok).toBe(false);
    }
  });

  it('every other kind carries no address at all', () => {
    for (const kind of SCRIPT_REF_KINDS.filter((k) => k !== 'external')) {
      expect(validateProtectMainMessage(withScript({ kind })).ok, kind).toBe(true);
      for (const extra of [{ host: 'cdn.tracker.example' }, { pathTemplate: '/a.js' }, { scheme: 'https' }]) {
        expect(validateProtectMainMessage(withScript({ kind, ...extra })).ok, kind).toBe(false);
        expect(validate(withScript({ kind, ...extra })), kind).toBe(false);
      }
    }
    expect(validateProtectMainMessage(withScript({ kind: 'url' })).ok).toBe(false);
  });

  it('host is masked, lowercase, >= 2 labels, never an IP or a URL', () => {
    for (const ok of ['cdn.tracker.example', '*.tracker.example', '*.*.cdn.example', 'xn--80ak6aa92e.example']) expect(isScriptHost(ok), ok).toBe(true);
    for (const bad of ['example', '*.example.*', 'cdn.tracker.*', '10.0.0.1', '[::1]', 'CDN.tracker.example', 'cdn.tracker.example:443', 'user@cdn.example', 'https://cdn.example', '', 'a..b.example', '**.example.com']) {
      expect(isScriptHost(bad), bad).toBe(false);
    }
  });
});

describe('templateScriptPath', () => {
  const golden: Array<[string, string]> = [
    ['/', '/'],
    ['', '/'],
    ['/static/js/main.3f9a8b7c.js', '/static/js/main.:id.js'],
    ['/a/b/c/d/e/rec.js', '/:skip/d/e/rec.js'],
    ['/a/b/c/rec.js', '/a/b/c/rec.js'],
    ['/u/12345/rec.js', '/u/:id/rec.js'],
    ['/s/AbCd1234EfGh5678/x.js', '/s/:id/x.js'],
    ['/p/%E2%9C%93/x.js', '/p/:x/x.js'],
    ['/p/a@b/x.js', '/p/:x/x.js'],
    ['//double//slash/', '/double/slash'],
    ['/x/' + 'a'.repeat(33) + '.js', '/x/:id.js'],
    ['/x/' + 'ab-'.repeat(20) + '.js', '/x/:x'],
    ['/:skip', '/:x'],
    ['/a/:skip/b', '/a/:x/b'],
    ['/jquery-3.6.0.min.js', '/jquery-3.6.0.min.js'],
  ];
  for (const [path, template] of golden) {
    it(JSON.stringify(path) + ' -> ' + template, () => {
      expect(templateScriptPath(path)).toBe(template);
      expect(isScriptPathTemplate(template)).toBe(true);
      expect(templateScriptPath(template)).toBe(template);
    });
  }

  it('is idempotent and always yields a valid template (fuzz 10^4, seeded)', () => {
    let seed = 0x2f6b9d3;
    const rand = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const alphabet = 'abcXYZ0123456789._~-/:%@?#!*é✓ ';
    for (let i = 0; i < 10000; i++) {
      let path = '/';
      const len = rand(200);
      for (let j = 0; j < len; j++) path += alphabet[rand(alphabet.length)];
      const t = templateScriptPath(path);
      expect(t.length).toBeLessThanOrEqual(PROTECT_BUDGETS.maxScriptPathTemplateChars);
      expect(t.split('/').filter(Boolean).length).toBeLessThanOrEqual(PROTECT_BUDGETS.maxScriptPathSegments);
      expect(isScriptPathTemplate(t)).toBe(true);
      expect(templateScriptPath(t)).toBe(t);
    }
  });

  it('rejects templates that are not fixed points', () => {
    for (const bad of ['/a/', '//a', '/u/12345/x.js', '/a/b/c/d/e', '/x?y', '/a:b', '/:skip', 'a/b', '/' + 'a'.repeat(97)]) {
      expect(isScriptPathTemplate(bad), bad).toBe(false);
    }
  });
});
