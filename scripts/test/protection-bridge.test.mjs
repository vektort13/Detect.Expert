// ADR-045/046: the packaged ISOLATED protection bridge admits one reply per rule plus bounded page noise.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { PROTECTION_FEATURES } from '../../packages/contracts/src/protection-features.mjs';

const source = readFileSync(new URL('../../apps/production-extension/bridge.js', import.meta.url), 'utf8');
function slice(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, 'bridge.js: expected audited module boundaries for ' + start);
  return source.slice(from, to);
}
const contract = slice('  // packages/contracts/src/protection.ts', '  // packages/');
const collector = slice('  // packages/collector/src/protection.ts', '  function startBrowserProtectionBridge');
const CHANNEL = /var PROTECTION_CHANNEL = "([^"]+)"/.exec(source)?.[1];
assert.equal(CHANNEL, 'detect.expert/protection/v1');

function harness(features = null) {
  const posted = [], timers = [], listeners = {};
  let code = contract + collector;
  // Optional synthetic catalogue proves the bound scales with the rule count rather than a fixed constant.
  if (features) code = code.replace(/var PROTECTION_FEATURES = \[[\s\S]*?\]/, 'var PROTECTION_FEATURES = ' + JSON.stringify(features));
  const globals = code.includes('isSanitizedHost') ? { isSanitizedHost: () => false } : {};
  const context = vm.createContext(globals);
  vm.runInContext(code + '\n;globalThis.exported = { startProtectionBridge, PROTECTION_FEATURES, PROTECTION_CHANNEL };', context);
  assert.equal(context.exported.PROTECTION_CHANNEL, CHANNEL);
  assert.deepEqual(Array.from(context.exported.PROTECTION_FEATURES), features ?? [...PROTECTION_FEATURES]);
  context.exported.startProtectionBridge({
    onPage: (listener) => { listeners.page = listener; },
    onCommand: (listener) => { listeners.command = listener; },
    onRestore: (listener) => { listeners.restore = listener; },
    post: (message) => { posted.push(JSON.parse(JSON.stringify(message))); },
    later: (callback, delay) => { timers.push({ callback, delay }); },
  });
  const replies = [];
  return {
    posted, timers, replies,
    page: (data, sameWindow = true) => listeners.page(sameWindow, data),
    query: (trusted = true) => listeners.command(trusted, { schemaVersion: 1, type: 'protection-query' }, (rows) => { replies.push(JSON.parse(JSON.stringify(rows))); }),
    command: (trusted, data, respond) => listeners.command(trusted, data, respond),
    flush() { const timer = timers.shift(); assert.ok(timer, 'pending reply window'); timer.callback(); },
  };
}
const observation = (feature) => ({ channel: CHANNEL, type: 'protection-observation',
  observation: { feature, installed: 1, unavailable: 0, removed: 0, blocked: 0, stopped: false } });
// Page-controlled noise that passes channel/type routing and therefore consumes the admission budget.
const noise = (index) => ({ channel: CHANNEL, type: 'protection-observation',
  observation: index % 2 ? null : { feature: '__proto__', installed: 99, unavailable: 0, removed: 0, blocked: 0, stopped: 'no' } });

test('a trusted query returns exactly one row per rule despite page noise', () => {
  const bridge = harness();
  bridge.page(observation(PROTECTION_FEATURES[0]));
  assert.equal(bridge.query(), true);
  assert.deepEqual(bridge.posted, [{ channel: CHANNEL, type: 'protection-query' }]);
  assert.equal(bridge.timers.length, 1); assert.equal(bridge.timers[0].delay, 50);
  for (let index = 0; index < 5; index++) bridge.page(noise(index));
  for (const feature of PROTECTION_FEATURES) bridge.page(observation(feature));
  for (let index = 5; index < 10; index++) bridge.page(noise(index));
  bridge.page({ channel: 'other', type: 'protection-observation', observation: observation('x').observation });
  bridge.page(observation(PROTECTION_FEATURES[1]), false);
  bridge.flush();
  assert.equal(bridge.replies.length, 1);
  assert.equal(bridge.replies[0].length, PROTECTION_FEATURES.length);
  assert.deepEqual(bridge.replies[0].map(row => row.feature).sort(), [...PROTECTION_FEATURES].sort());
  assert.deepEqual(bridge.replies[0][0], observation(bridge.replies[0][0].feature).observation);
});

test('page messages beyond twice the rule count are not admitted', () => {
  const limit = 2 * PROTECTION_FEATURES.length, last = PROTECTION_FEATURES[PROTECTION_FEATURES.length - 1];
  const within = harness();
  within.query();
  for (let index = 0; index < limit - 1; index++) within.page(noise(index));
  within.page(observation(last));
  within.flush();
  assert.deepEqual(within.replies, [[observation(last).observation]]);
  const beyond = harness();
  beyond.query();
  for (let index = 0; index < limit; index++) beyond.page(noise(index));
  for (const feature of PROTECTION_FEATURES) beyond.page(observation(feature));
  beyond.flush();
  assert.deepEqual(beyond.replies, [[]]);
});

test('the admission bound follows the installed catalogue size', () => {
  const features = Array.from({ length: 89 }, (_, index) => 'synthetic-' + index);
  const bridge = harness(features);
  bridge.query();
  for (let index = 0; index < 60; index++) bridge.page(noise(index));
  for (const feature of features) bridge.page(observation(feature));
  for (let index = 0; index < 29; index++) bridge.page(noise(index));
  bridge.page(observation('synthetic-0'));
  bridge.flush();
  assert.equal(bridge.replies[0].length, 89);
  const capped = harness(features);
  capped.query();
  for (let index = 0; index < 2 * features.length; index++) capped.page(noise(index));
  capped.page(observation('synthetic-1'));
  capped.flush();
  assert.deepEqual(capped.replies, [[]]);
});

test('untrusted commands are refused without posting to the page', () => {
  const bridge = harness();
  let responses = 0;
  for (const type of ['protection-query', 'protection-stop']) {
    assert.equal(bridge.command(false, { schemaVersion: 1, type }, () => { responses++; }), false);
  }
  assert.equal(bridge.query(false), false);
  assert.equal(bridge.command(true, { schemaVersion: 2, type: 'protection-query' }, () => { responses++; }), false);
  assert.deepEqual(bridge.posted, []); assert.equal(bridge.timers.length, 0); assert.equal(responses, 0);
  bridge.page(observation(PROTECTION_FEATURES[0]));
  assert.deepEqual(bridge.replies, []);
});

test('a fifth waiting request is answered immediately with no rows', () => {
  const bridge = harness();
  for (let index = 0; index < 4; index++) assert.equal(bridge.query(), true);
  assert.equal(bridge.posted.length, 1); assert.equal(bridge.timers.length, 1);
  assert.equal(bridge.query(), true);
  assert.deepEqual(bridge.replies, [[]]);
  bridge.page(observation(PROTECTION_FEATURES[0]));
  bridge.flush();
  assert.equal(bridge.replies.length, 5);
  for (const reply of bridge.replies.slice(1)) assert.deepEqual(reply, [observation(PROTECTION_FEATURES[0]).observation]);
});
