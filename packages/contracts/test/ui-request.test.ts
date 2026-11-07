import { describe, expect, it } from 'vitest';
import { MAX_COUNT, validateUiRequest } from '../src/index';
import { ascii513, compileSchema, throwingProxy, unicode513, withOwnProtoKey } from './helpers';

type Json = Record<string, unknown>;

interface Case {
  name: string;
  input: unknown;
  expect: 'ok' | 'fail';
  handOnly?: boolean;
}

const cases: Case[] = [
  { name: 'ui-get-report', input: { schemaVersion: 1, type: 'ui-get-report', tabId: 5 }, expect: 'ok' },
  { name: 'ui-get-report with frameId', input: { schemaVersion: 1, type: 'ui-get-report', tabId: 5, frameId: 0 }, expect: 'ok' },
  { name: 'ui-pause', input: { schemaVersion: 1, type: 'ui-pause', tabId: 5, documentKey: '5:0:ABC', reportRevision: 3 }, expect: 'ok' },
  { name: 'ui-resume', input: { schemaVersion: 1, type: 'ui-resume', tabId: 5, documentKey: '5:0:ABC', reportRevision: 3 }, expect: 'ok' },
  { name: 'ui-clear', input: { schemaVersion: 1, type: 'ui-clear', tabId: 5, documentKey: '5:0:ABC', reportRevision: 0 }, expect: 'ok' },
  { name: 'ui-export-preview', input: { schemaVersion: 1, type: 'ui-export-preview', tabId: 5, documentKey: '5:0:ABC', reportRevision: MAX_COUNT }, expect: 'ok' },
  { name: 'ui-set-scope off', input: { schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'off' }, expect: 'ok' },
  { name: 'ui-set-scope active-tab', input: { schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'active-tab' }, expect: 'ok' },
  { name: 'ui-set-scope all-sites', input: { schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'all-sites' }, expect: 'ok' },
  { name: 'ui-set-scope site with host', input: { schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'site', host: 'example.com' }, expect: 'ok' },
  { name: 'ui-set-scope site with punycode host', input: { schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'site', host: 'xn--e1afmkfd.xn--p1ai' }, expect: 'ok' },
  { name: 'ui-set-scope site with ipv6 host', input: { schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'site', host: '[::1]' }, expect: 'ok' },
  { name: 'ui-get-scope', input: { schemaVersion: 1, type: 'ui-get-scope' }, expect: 'ok' },
  { name: 'ui-inject-now', input: { schemaVersion: 1, type: 'ui-inject-now', tabId: 7 }, expect: 'ok' },
  { name: 'ui-clear-session', input: { schemaVersion: 1, type: 'ui-clear-session' }, expect: 'ok' },
  { name: 'ui-inject-now without tabId', input: { schemaVersion: 1, type: 'ui-inject-now' }, expect: 'fail' },
  { name: 'ui-inject-now negative tabId', input: { schemaVersion: 1, type: 'ui-inject-now', tabId: -1 }, expect: 'fail' },
  { name: 'ui-inject-now with frameId', input: { schemaVersion: 1, type: 'ui-inject-now', tabId: 7, frameId: 0 }, expect: 'fail' },
  { name: 'ui-clear-session with tabId', input: { schemaVersion: 1, type: 'ui-clear-session', tabId: 7 }, expect: 'fail' },
  { name: 'ui-clear-session with documentKey', input: { schemaVersion: 1, type: 'ui-clear-session', documentKey: '5:0:ABC' }, expect: 'fail' },

  { name: 'null', input: null, expect: 'fail' },
  { name: 'string', input: 'ui-get-scope', expect: 'fail' },
  { name: 'array', input: [{ schemaVersion: 1, type: 'ui-get-scope' }], expect: 'fail' },
  { name: 'missing type', input: { schemaVersion: 1 }, expect: 'fail' },
  { name: 'missing schemaVersion', input: { type: 'ui-get-scope' }, expect: 'fail' },
  { name: 'schemaVersion 2', input: { schemaVersion: 2, type: 'ui-get-scope' }, expect: 'fail' },
  { name: 'unknown type', input: { schemaVersion: 1, type: 'ui-export-all' }, expect: 'fail' },
  { name: 'page batch type on ui channel', input: { schemaVersion: 1, type: 'sensor-events' }, expect: 'fail' },
  { name: 'type 513 chars', input: { schemaVersion: 1, type: unicode513 }, expect: 'fail' },
  { name: 'extra key', input: { schemaVersion: 1, type: 'ui-get-scope', extra: true }, expect: 'fail' },
  { name: 'own __proto__ key', input: withOwnProtoKey({ schemaVersion: 1, type: 'ui-get-scope' }, '__proto__'), expect: 'fail' },
  { name: 'ui-get-report missing tabId', input: { schemaVersion: 1, type: 'ui-get-report' }, expect: 'fail' },
  { name: 'ui-get-report tabId -1', input: { schemaVersion: 1, type: 'ui-get-report', tabId: -1 }, expect: 'fail' },
  { name: 'ui-get-report tabId 1.5', input: { schemaVersion: 1, type: 'ui-get-report', tabId: 1.5 }, expect: 'fail' },
  { name: 'ui-get-report tabId string', input: { schemaVersion: 1, type: 'ui-get-report', tabId: '5' }, expect: 'fail' },
  { name: 'ui-get-report tabId 1e300', input: { schemaVersion: 1, type: 'ui-get-report', tabId: 1e300 }, expect: 'fail' },
  { name: 'ui-get-report frameId -1', input: { schemaVersion: 1, type: 'ui-get-report', tabId: 1, frameId: -1 }, expect: 'fail' },
  { name: 'ui-get-report frameId null', input: { schemaVersion: 1, type: 'ui-get-report', tabId: 1, frameId: null }, expect: 'fail' },
  { name: 'ui-pause missing reportRevision', input: { schemaVersion: 1, type: 'ui-pause', tabId: 5, documentKey: '5:0:ABC' }, expect: 'fail' },
  { name: 'ui-pause reportRevision -1', input: { schemaVersion: 1, type: 'ui-pause', tabId: 5, documentKey: '5:0:ABC', reportRevision: -1 }, expect: 'fail' },
  { name: 'ui-pause reportRevision 1e300', input: { schemaVersion: 1, type: 'ui-pause', tabId: 5, documentKey: '5:0:ABC', reportRevision: 1e300 }, expect: 'fail' },
  { name: 'ui-pause documentKey with slash', input: { schemaVersion: 1, type: 'ui-pause', tabId: 5, documentKey: '5/0/ABC', reportRevision: 1 }, expect: 'fail' },
  { name: 'ui-pause documentKey empty', input: { schemaVersion: 1, type: 'ui-pause', tabId: 5, documentKey: '', reportRevision: 1 }, expect: 'fail' },
  { name: 'ui-pause documentKey 513 chars', input: { schemaVersion: 1, type: 'ui-pause', tabId: 5, documentKey: ascii513, reportRevision: 1 }, expect: 'fail' },
  { name: 'F039 ui-resume missing reportRevision', input: { schemaVersion: 1, type: 'ui-resume', tabId: 5, documentKey: '5:0:ABC' }, expect: 'fail' },
  ...[0, 1, MAX_COUNT].map((reportRevision): Case => ({
    name: `F039 ui-resume revision ${reportRevision}`,
    input: { schemaVersion: 1, type: 'ui-resume', tabId: 5, documentKey: '5:0:ABC', reportRevision },
    expect: 'ok',
  })),
  ...[-1, 1.5, MAX_COUNT + 1, NaN, Infinity, '1', null, undefined].map((reportRevision): Case => ({
    name: `F039 ui-resume invalid revision ${reportRevision}`,
    input: { schemaVersion: 1, type: 'ui-resume', tabId: 5, documentKey: '5:0:ABC', reportRevision },
    expect: 'fail',
  })),
  { name: 'ui-set-scope site without host', input: { schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'site' }, expect: 'fail' },
  { name: 'ui-set-scope off with host', input: { schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'off', host: 'example.com' }, expect: 'fail' },
  { name: 'ui-set-scope unknown mode', input: { schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'everything' }, expect: 'fail' },
  { name: 'ui-set-scope host uppercase', input: { schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'site', host: 'Example.com' }, expect: 'fail' },
  { name: 'ui-set-scope host with scheme', input: { schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'site', host: 'https://example.com' }, expect: 'fail' },
  { name: 'ui-set-scope host with path', input: { schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'site', host: 'example.com/a' }, expect: 'fail' },
  { name: 'ui-set-scope host with port', input: { schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'site', host: 'example.com:443' }, expect: 'fail' },
  { name: 'ui-set-scope host unicode', input: { schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'site', host: 'пример.рф' }, expect: 'fail' },
  { name: 'ui-set-scope host empty', input: { schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'site', host: '' }, expect: 'fail' },
  { name: 'ui-set-scope host 513 chars', input: { schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'site', host: ascii513 }, expect: 'fail' },
  { name: 'ui-set-scope host number', input: { schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'site', host: 1 }, expect: 'fail' },
  { name: 'ui-get-scope with tabId', input: { schemaVersion: 1, type: 'ui-get-scope', tabId: 1 }, expect: 'fail' },
  { name: 'hostile proxy', input: throwingProxy(), expect: 'fail', handOnly: true },
];

describe('validateUiRequest vs JSON Schema (ui-request.v1)', () => {
  const ajvValidate = compileSchema('ui-request.v1.schema.json');

  for (const c of cases) {
    it(c.name, () => {
      const hand = validateUiRequest(c.input);
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
});
