// DET-074: exercise planned allowlists against the actual production reader/observer.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';
import {
  REVIEW_HEADER_ADDITIONS, REVIEW_RESPONSE_HEADER_NAMES, REVIEW_HEADER_KEYS,
  applyReviewHeaderCopy, responseHeaderExplanation,
  patchResponseHeaderAllowlist, patchResponseHeaderExplanations,
} from '../production/review-header-plan.mjs';

const source = name => readFileSync(new URL('../../apps/production-extension/' + name, import.meta.url), 'utf8');
const block = (input, from, to) => {
  const start = input.indexOf(from), end = input.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, from);
  return input.slice(start, end);
};
const plain = value => JSON.parse(JSON.stringify(value));
function fixture(name = 'background.js') {
  const patched = patchResponseHeaderAllowlist(source(name), { expectedCount: name === 'report.js' ? 2 : 1 });
  const contract = block(patched.slice(patched.lastIndexOf('// packages/contracts/src/response-headers.ts')), '// packages/contracts/src/response-headers.ts', '// packages/contracts/src/pro-recording.ts');
  const observer = name === 'background.js' ? block(patched, '// packages/background/src/response-headers.ts', '// packages/contracts/src/google-ids.ts') : '';
  const context = vm.createContext({
    RateLimiter: class { tryConsume() { return true; } },
    bindingKey: (tab, frame) => tab + ':' + frame,
    makeDocumentKey: (tab, frame, document) => [tab, frame, document].join(':'),
    sanitizeHost: address => { try { return new URL(address).hostname; } catch { return null; } },
  });
  return vm.runInContext(contract + '\n' + observer + '\n({ readResponseHeaders, RESPONSE_HEADER_NAMES, ' +
    (observer ? 'normalizeResponseHeaders, ResponseHeadersObserver, mergeResponseHeaders' : '') + '})', context);
}

for (const name of ['background.js', 'popup.js', 'sidepanel.js', 'report.js']) {
  test(name + ': exact reviewed names survive the strict canonical reader; patch is idempotent', () => {
    const original = source(name), options = { expectedCount: name === 'report.js' ? 2 : 1 }, patched = patchResponseHeaderAllowlist(original, options);
    assert.equal(patchResponseHeaderAllowlist(patched, options), patched);
    for (const match of patched.matchAll(/var RESPONSE_HEADER_NAMES = (\[[\s\S]*?\])(?=, CLIENT_HINT_NAMES =)/g)) assert.deepEqual(JSON.parse(match[1]), REVIEW_RESPONSE_HEADER_NAMES);
    const api = fixture(name);
    assert.deepEqual(plain(api.RESPONSE_HEADER_NAMES), REVIEW_RESPONSE_HEADER_NAMES);
    const value = { entries: REVIEW_HEADER_ADDITIONS.map(name => ({ name, count: 1, clientHints: [] })), truncated: false };
    assert.deepEqual(plain(api.readResponseHeaders(value)), value);
    for (const invalid of [
      { ...value, entries: [{ name: 'authorization', count: 1, clientHints: [] }] },
      { ...value, entries: [{ name: 'set-login', count: 1, clientHints: ['sec-ch-ua'] }] },
      { ...value, entries: [{ name: 'set-login', count: 1, clientHints: [], value: 'secret' }] },
      { ...value, entries: [value.entries[0], value.entries[0]] },
    ]) assert.equal(api.readResponseHeaders(invalid), null);
  });
}

test('normalizer reads none of the new header values, binary values or unknown values', () => {
  const api = fixture(); let reads = 0;
  const raw = [...REVIEW_HEADER_ADDITIONS, 'set-cookie', 'authorization'].map(name => {
    const row = { name: name.toUpperCase() };
    for (const field of ['value', 'binaryValue']) Object.defineProperty(row, field, { enumerable: true, get() { ++reads; throw Error('SENTINEL'); } });
    return row;
  });
  const normalized = api.normalizeResponseHeaders(raw);
  assert.equal(reads, 0);
  assert.deepEqual(plain(normalized), { entries: REVIEW_HEADER_ADDITIONS.map(name => ({ name, count: 1, clientHints: [] })), truncated: false });
  assert.doesNotMatch(JSON.stringify(normalized), /SENTINEL|value|binaryValue|set-cookie|authorization/);
});

test('normalizer keeps one presence per response, bounded input and known Client Hint tokens', () => {
  const api = fixture();
  assert.equal(api.normalizeResponseHeaders([{ name: 'set-login' }, { name: 'Set-Login' }]).entries[0].count, 1);
  assert.equal(api.normalizeResponseHeaders(Array.from({ length: 65 }, () => ({ name: 'set-login' }))).truncated, true);
  const hints = api.normalizeResponseHeaders([{ name: 'Accept-CH', value: 'Sec-CH-UA-Model, SECRET-SENTINEL' }]);
  assert.deepEqual(plain(hints), { entries: [{ name: 'accept-ch', count: 1, clientHints: ['sec-ch-ua-model'] }], truncated: true });
  const record = { entries: [{ name: 'set-login', count: 1, clientHints: [] }], truncated: false };
  assert.equal(api.mergeResponseHeaders(record, record).entries[0].count, 2);
});

test('native observer preserves document/access attribution and never needs request headers', () => {
  const { ResponseHeadersObserver } = fixture();
  const events = []; let reads = 0, allowed = true;
  const runtime = {
    canBufferRedactedBrowserData: () => allowed, now: () => 1000, hydrationComplete: true,
    scope: { accessReady: true, accessGeneration: 4, hasAnyHostAccess: () => true, isHostGrantedSync: () => true },
    canObserveNetworkDocument: key => key === '7:2:frame', state: { bindings: new Map(), metas: new Map() },
    pro: { headerPeriod: () => null }, dispatch: event => events.push(event),
  };
  const details = { tabId: 7, frameId: 2, documentId: 'frame', requestId: 'r1', type: 'script',
    url: 'https://resource.test/app.js', initiator: 'https://page.test' };
  Object.defineProperty(details, 'responseHeaders', { get() { ++reads; return REVIEW_HEADER_ADDITIONS.map(name => ({ name, value: 'SECRET-SENTINEL' })); } });
  Object.defineProperty(details, 'requestHeaders', { get() { throw Error('Must not read request headers'); } });
  const observer = new ResponseHeadersObserver(runtime);
  observer.onCompleted(details);
  assert.equal(events.length, 1); assert.equal(events[0].documentKey, '7:2:frame');
  assert.equal(events[0].headers.entries.length, 6); assert.doesNotMatch(JSON.stringify(events), /SECRET-SENTINEL/);
  const before = reads; allowed = false; observer.onCompleted(details); assert.equal(reads, before);
});

for (const name of ['popup.js', 'sidepanel.js', 'report.js', 'pro-report-tables.js']) {
  test(name + ': factual per-header explanation replaces the DBSC fallback', () => {
    const patched = patchResponseHeaderExplanations(source(name));
    assert.equal(patchResponseHeaderExplanations(patched), patched);
    const match = patched.match(/^function (explanation|explainHeader)\(name\) \{[\s\S]*?^\}/m);
    const explain = vm.runInNewContext(match[0] + ';' + match[1]);
    for (const [index, name] of REVIEW_HEADER_ADDITIONS.entries()) assert.equal(explain(name), REVIEW_HEADER_KEYS[index]);
    assert.equal(explain('secure-session-registration'), 'headers_session_note');
    assert.equal(explain('unrecognized-header'), 'headers_presence_note');
  });
}

test('all 21 locales resolve every new note without overwriting existing UI or DBSC wording', () => {
  for (const language of PRODUCTION_LANGUAGES) {
    const catalog = { headers_session_note: { message: 'existing DBSC copy' }, unrelated: { message: 'existing' } };
    const applied = applyReviewHeaderCopy(catalog, language.id);
    assert.equal(applied, catalog);
    for (const key of REVIEW_HEADER_KEYS) assert.ok(catalog[key]?.message.length > 5, language.id + ': ' + key);
    const first = JSON.stringify(catalog);
    applyReviewHeaderCopy(catalog, language.id); assert.equal(JSON.stringify(catalog), first);
    assert.equal(catalog.headers_session_note.message, 'existing DBSC copy'); assert.equal(catalog.unrelated.message, 'existing');
  }
  assert.throws(() => applyReviewHeaderCopy({}, 'missing'), /Unknown/);
  assert.equal(responseHeaderExplanation('Set-Login'), 'headers_presence_note');
});

test('patch helpers fail closed on missing or ambiguous source boundaries', () => {
  assert.throws(() => patchResponseHeaderAllowlist(''), /Expected 1/);
  assert.throws(() => patchResponseHeaderAllowlist(source('background.js') + source('background.js')), /Expected 1/);
  assert.throws(() => patchResponseHeaderExplanations(''), /Expected one/);
  assert.throws(() => patchResponseHeaderExplanations('function explanation(name) {\n  return name;\n}'), /Unexpected/);
});
