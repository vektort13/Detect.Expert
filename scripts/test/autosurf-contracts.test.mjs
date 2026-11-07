import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { AUTOSURF_DEFAULT_CONFIGURATION, validateAutosurfConfiguration, validateAutosurfCommand, validateAutosurfUrl, createAutosurfPlan, createAutosurfVisitRandom, isAutosurfUiSender, isOwnAutosurfOptions, autosurfSafeCode } from '../../apps/production-extension/autosurf-shared.js';
const config = patch => ({ ...AUTOSURF_DEFAULT_CONFIGURATION, urls: ['https://example.com/a'], ...patch });
const invalid = action => assert.throws(action, error => error.code === 'invalid-input');

test('Autosurfer canonical contracts equal the delivered copy', () => assert.equal(readFileSync(new URL('../../packages/contracts/src/autosurf.mjs', import.meta.url), 'utf8'), readFileSync(new URL('../../apps/production-extension/autosurf-shared.js', import.meta.url), 'utf8')));
test('explicit user query and fragment survive the local configuration without acquiring command meaning', () => assert.equal(validateAutosurfConfiguration(config({ urls: ['https://example.com/a?token=USER_INPUT#section'] })).urls[0], 'https://example.com/a?token=USER_INPUT#section'));
test('unsupported schemes, userinfo, controls, escapes and excess URL length fail before navigation', () => {
  for (const url of ['javascript:alert(1)', 'file:///tmp/a', 'chrome://settings', 'https://user:pass@example.com/', 'https://example.com/\n', ' https://example.com/', 'https://example.com/\\x', 'https://example.com/\u202etest', 'https://example.com/' + 'x'.repeat(2048)]) invalid(() => validateAutosurfUrl(url));
});
test('discovered links must be same-origin, contain no query/fragment and avoid action paths', () => {
  for (const url of ['https://other.example/read', 'https://example.com/read?q=1', 'https://example.com/read#x', 'https://example.com/logout', 'https://example.com/%64elete/all', 'https://example.com/api/data', 'https://example.com/account/profile', 'https://example.com/checkout']) invalid(() => validateAutosurfUrl(url, { discovered: true, origin: 'https://example.com' }));
  assert.equal(validateAutosurfUrl('https://example.com/articles/read', { discovered: true, origin: 'https://example.com' }), 'https://example.com/articles/read');
});
test('configuration validates integer ranges, booleans, order, unknown fields and interval order', () => {
  for (const patch of [{ cycles: 0 }, { cycles: 6 }, { depth: 4 }, { dwellMinSec: 4 }, { dwellMaxSec: 601 }, { gapMinSec: 0 }, { gapMaxSec: 301 }, { maxRunMinutes: 481 }, { seed: -1 }, { seed: 2 ** 32 }, { seed: 0.1 }, { scroll: 1 }, { hover: 'yes' }, { metrics: null }, { order: 'random-command' }, { dwellMinSec: 50, dwellMaxSec: 20 }, { gapMinSec: 30, gapMaxSec: 2 }, { arbitraryCommand: 'Runtime.evaluate' }]) invalid(() => validateAutosurfConfiguration(config(patch)));
});
test('configuration rejects duplicate, sparse, getter, oversized and inherited records', () => {
  invalid(() => validateAutosurfConfiguration(config({ urls: ['https://example.com', 'https://example.com/'] })));
  invalid(() => validateAutosurfConfiguration(config({ urls: Array(2) })));
  const getter = ['https://example.com']; Object.defineProperty(getter, '0', { get() { throw Error('getter was called'); } }); invalid(() => validateAutosurfConfiguration(config({ urls: getter })));
  invalid(() => validateAutosurfConfiguration(config({ urls: Array.from({ length: 201 }, (_, index) => 'https://example.com/' + index) })));
  invalid(() => validateAutosurfConfiguration(Object.create(config())));
});
test('sampling and shuffle are reproducible, bounded and preserve sequential sampled ordering', () => {
  const input = config({ urls: Array.from({ length: 10 }, (_, index) => 'https://example.com/' + index), seed: 42, sampleCount: 4, cycles: 2, order: 'sequential' });
  const first = createAutosurfPlan(input); assert.deepEqual(first, createAutosurfPlan(input)); assert.equal(first.length, 8); assert.deepEqual(first.slice(0, 4), [...first.slice(0, 4)].sort((a, b) => a - b)); assert.deepEqual(first.slice(0, 4), first.slice(4));
  assert.equal(createAutosurfPlan({ ...input, sampleCount: 0, cycles: 1 }).length, 10);
});
test('wire exposes only fixed actions with CAS and no caller-selected tab, script or URL', () => {
  assert.deepEqual(validateAutosurfCommand({ v: 1, id: 'a', op: 'stop', payload: { revision: 2 } }), { v: 1, id: 'a', op: 'stop', payload: { revision: 2 } });
  for (const value of [{ v: 1, id: 'a', op: 'click', payload: { revision: 0 } }, { v: 1, id: 'a', op: 'load', payload: {} }, { v: 1, id: 'a', op: 'start', payload: { revision: 0, tabId: 42 } }, { v: 1, id: 'a', op: 'start', payload: { revision: -1 } }, { v: 1, id: 'a', op: 'stop', payload: { revision: 0 }, url: 'https://example.com/' }]) invalid(() => validateAutosurfCommand(value));
});
test('only native exact own top-level Options identity passes the privileged sender boundary', () => {
  const api = { runtime: { id: 'own', getURL: path => 'chrome-extension://own/' + path } };
  const sender = { id: 'own', url: 'chrome-extension://own/options.html#autosurf', origin: 'chrome-extension://own', frameId: 0, tab: { id: 7, url: 'chrome-extension://own/options.html' } };
  assert.equal(isAutosurfUiSender(api, sender), true);
  for (const patch of [{ id: 'other' }, { url: 'https://example.com/options.html' }, { url: 'chrome-extension://own/popup.html' }, { frameId: 1 }, { origin: 'null' }, { origin: 'https://example.com' }, { tab: { url: 'https://example.com/' } }]) assert.equal(isAutosurfUiSender(api, { ...sender, ...patch }), false);
  const win = {}; win.top = win; assert.equal(isOwnAutosurfOptions(api, { window: win, location: { href: sender.url } }), true); win.top = {}; assert.equal(isOwnAutosurfOptions(api, { window: win, location: { href: sender.url } }), false);
});
test('raw native exception text never enters public error codes', () => { assert.equal(autosurfSafeCode(Error('SECRET token')), 'native-error'); assert.equal(autosurfSafeCode({ code: 'autosurf-hidden' }), 'window-blurred'); assert.equal(autosurfSafeCode({ code: 'autosurf-challenge' }), 'challenge'); });
test('visit schedule and link streams do not depend on behavior consumption', () => {
  const first = createAutosurfVisitRandom(42, 19, 2), second = createAutosurfVisitRandom(42, 19, 2);
  for (let index = 0; index < 700; index++) first.behavior();
  assert.deepEqual([first.schedule(), first.schedule(), first.links()], [second.schedule(), second.schedule(), second.links()]);
  assert.notEqual(createAutosurfVisitRandom(42, 19, 2).schedule(), createAutosurfVisitRandom(42, 19, 1).schedule());
  invalid(() => createAutosurfVisitRandom(42, 1000, 0)); invalid(() => createAutosurfVisitRandom(42, 0, 4));
});
