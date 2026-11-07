// Round 5, ADR-111: the guided tours of the Options UI (apps/production-extension/ui-tour.js): the registry of one tour per section, strict stored
// state (v2, with the v1 progress of round 5 moved into it), the state machine and its step skipping, target lookup, placement, key decisions,
// the popover markup, the header button and the checklist block, the palette commands and the copy in all 21 languages.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  TOURS, TOUR_IDS, DEFAULT_TOUR, TOUR_STORAGE_KEY, TOUR_LEGACY_STORAGE_KEY, TOUR_STATE_MAX_CHARS, TOUR_LEGACY_MAX_CHARS, TOUR_TARGETS, TOUR_MARGIN, TOUR_COMPACT_WIDTH, TOUR_RING_PAD, TOUR_PALETTE_KEYWORDS,
  parseTourState, serializeTourState, parseTourLegacyState, loadTourState, readTourState, writeTourState, clearTourState, tourProgress, fillTourText, tourStepKey, sameTourView,
  computeTourPlacement, tourRingFor, tourKeyAction, createTourController, createTourEntry, tourToolSlot, createTourPopover, createTourUi, isTourTargetVisible, findTourTarget, findPresentableStep,
  TOUR_TARGET_WAIT_MS, TOUR_TARGET_QUIET_MS, TOUR_TARGET_HARD_MS, TOUR_SETTLE_MS, TOUR_POLL_MS, TOUR_TICK_MS,
} from '../../apps/production-extension/ui-tour.js';
import { collectPaletteCommands, PALETTE_COMMAND_KINDS } from '../../apps/production-extension/ui-shortcuts.js';
import { buildPaletteEntries, MANAGEMENT_SECTIONS } from '../../apps/production-extension/management-ui.js';
import { ANTIDETECT_CATEGORIES } from '../../apps/production-extension/antidetect-ui.js';
import { redesignLabels } from '../../apps/production-extension/redesign-labels.js';
import { TOUR_LABELS, TOUR_LABEL_KEYS, TOUR_STEP_IDS, tourLabels } from '../../apps/production-extension/ui-tour-labels.js';
import { MANAGEMENT_SECTION_ENGLISH } from '../../apps/production-extension/management-navigation-labels.js';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';

const source = new URL('../../apps/production-extension/', import.meta.url);
const read = name => readFileSync(new URL(name, source), 'utf8');
const stripComments = text => text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|[^:'"`\\])\/\/.*$/gmu, '$1');
const ALL_STEPS = Object.values(TOURS).flat();
const COMMON_KEYS = ['eyebrow', 'back', 'next', 'skip', 'done', 'start', 'resume', 'restart', 'tour_label', 'tour_tip', 'tour_tip_resume', 'step_label', 'resume_hint', 'entry_hint', 'skipped', 'closed', 'finished'];

// A storage that behaves like localStorage; `fail` makes every call throw (a blocked or full storage).
function memory({ fail = false, initial = {} } = {}) {
  const data = new Map(Object.entries(initial)), calls = [];
  const guard = () => { if (fail) throw Error('storage blocked'); };
  return { data, calls, getItem: key => { calls.push(['get', key]); guard(); return data.has(key) ? data.get(key) : null; }, setItem: (key, value) => { calls.push(['set', key, value]); guard(); data.set(key, String(value)); }, removeItem: key => { calls.push(['remove', key]); guard(); data.delete(key); } };
}
const state = tours => JSON.stringify({ version: 2, tours });
const one = (tour, completed, lastStep) => state({ [tour]: { completed, lastStep } });
const legacy = (completed, lastStep) => JSON.stringify({ version: 1, completed, lastStep });

// ---- steps and registry -------------------------------------------------------------------------------------------------------------
test('tour registry: one tour per Options section, 3 to 7 steps, unique step ids, real sections and levels, every target key registered and used, ids match the copy', () => {
  assert.deepEqual([...TOUR_IDS].sort(), [...MANAGEMENT_SECTIONS].sort(), 'a tour for every section of the Options UI, and no other');
  assert.equal(DEFAULT_TOUR, 'antidetect'); assert.ok(Object.isFrozen(TOURS) && Object.isFrozen(TOUR_IDS));
  assert.equal(ALL_STEPS.length, 49); assert.equal(new Set(ALL_STEPS.map(step => step.id)).size, ALL_STEPS.length, 'a step id is unique across all tours (the copy keys are flat)');
  assert.deepEqual(ALL_STEPS.map(step => step.id), [...TOUR_STEP_IDS], 'the copy module lists the same steps in the same order');
  for (const [tour, steps] of Object.entries(TOURS)) {
    assert.ok(steps.length >= 3 && steps.length <= 7, tour + ': ' + steps.length + ' steps'); assert.ok(Object.isFrozen(steps));
    for (const step of steps) {
      assert.equal(step.view.section, tour, step.id + ': the step lives in the section of its tour');
      if (tour === 'antidetect') assert.ok(ANTIDETECT_CATEGORIES.includes(step.view.level), step.id + ': a real Antidetect level'); else assert.equal(step.view.level, undefined, step.id);
      assert.ok(Object.hasOwn(TOUR_TARGETS, step.target), step.id + ': target key ' + step.target + ' has a registry entry');
      assert.ok(Object.isFrozen(step) && Object.isFrozen(step.view)); assert.match(step.id, /^[a-z][a-z-]{0,31}$/u);
      for (const part of ['title', 'body']) assert.ok(TOUR_LABEL_KEYS.includes(tourStepKey(step.id, part)), step.id + ': copy field ' + part);
    }
  }
  for (const [key, selectors] of Object.entries(TOUR_TARGETS)) { assert.match(key, /^[a-z][a-z0-9-]{0,31}$/u); assert.ok(Object.isFrozen(selectors) && selectors.length >= 1, key); }
  const used = new Set(ALL_STEPS.map(step => step.target)); assert.deepEqual(Object.keys(TOUR_TARGETS).filter(key => !used.has(key)), [], 'no registry entry that no step uses');
  // The Antidetect tour is the one of round 5 without its Proxy step, which moved into the Proxy tour.
  assert.deepEqual(TOURS.antidetect.map(step => step.id), ['levels', 'generator', 'region', 'hints', 'library', 'apply', 'finish']); assert.equal(TOURS.antidetect.at(-1).id, 'finish');
  assert.ok(TOURS.proxy.some(step => step.id === 'proxy-list' && step.target === 'proxy'), 'the Proxy tour keeps the list-header anchor of round 5');
});

test('tour registry: the selectors of every section other than Antidetect are scoped to the panel of their own section, so a part of another section can never be taken', () => {
  const legacyKeys = new Set(['levels', 'generator', 'region', 'hints', 'library', 'apply', 'master', 'proxy']);
  for (const [tour, steps] of Object.entries(TOURS)) for (const step of steps) {
    if (legacyKeys.has(step.target)) continue;
    for (const selector of TOUR_TARGETS[step.target]) assert.ok(selector.startsWith('[data-management-panel="' + tour + '"] '), step.id + ': ' + selector);
  }
  assert.deepEqual(TOUR_TARGETS.levels, ['[data-antidetect-navigation]'], 'the round-5 hooks are unchanged');
});

test('sameTourView compares the section, and the level only inside Antidetect', () => {
  assert.equal(sameTourView({ section: 'antidetect', level: 'os' }, { section: 'antidetect', level: 'os' }), true);
  assert.equal(sameTourView({ section: 'antidetect', level: 'os' }, { section: 'antidetect', level: 'quick' }), false);
  assert.equal(sameTourView({ section: 'proxy' }, { section: 'proxy', level: 'quick' }), true);
  assert.equal(sameTourView({ section: 'proxy' }, { section: 'antidetect', level: 'quick' }), false);
  assert.equal(sameTourView(null, { section: 'proxy' }), false); assert.equal(sameTourView({ section: 'proxy' }, undefined), false);
});

// ---- stored state ---------------------------------------------------------------------------------------------------------------------
test('stored state v2: exactly { version: 2, tours: { <known tour>: { completed: boolean, lastStep: 0..steps-1 } } }; everything else reads as absent', () => {
  assert.equal(TOUR_STORAGE_KEY, 'ui-tour:v2'); assert.equal(TOUR_LEGACY_STORAGE_KEY, 'ui-tour:v1');
  assert.deepEqual(JSON.parse(JSON.stringify(parseTourState(one('antidetect', false, 3)))), { version: 2, tours: { antidetect: { completed: false, lastStep: 3 } } });
  const many = parseTourState(state({ proxy: { completed: true, lastStep: 0 }, cookies: { completed: false, lastStep: TOURS.cookies.length - 1 } }));
  assert.deepEqual(Object.keys(many.tours), ['proxy', 'cookies']); assert.deepEqual({ ...many.tours.cookies }, { completed: false, lastStep: TOURS.cookies.length - 1 });
  assert.ok(Object.isFrozen(many) && Object.isFrozen(many.tours) && Object.isFrozen(many.tours.proxy)); assert.deepEqual({ ...parseTourState(state({})).tours }, {});
  const bad = [
    null, undefined, 7, {}, [], '', 'null', 'true', '[]', '"x"', '{', '{}', 'not json', legacy(false, 1),
    one('antidetect', false, TOURS.antidetect.length), one('cookies', false, TOURS.cookies.length), one('antidetect', false, -1), one('antidetect', false, 1.5), one('antidetect', false, '2'), one('antidetect', 'no', 1), one('antidetect', 0, 1), one('antidetect', null, 1),
    one('nope', false, 0), one('constructor', false, 0), one('toString', false, 0), one('', false, 0), state([]), state(null), state('x'), state(7),
    '{"version":3,"tours":{}}', '{"version":"2","tours":{}}', '{"tours":{}}', '{"version":2}', '{"version":2,"tours":{},"extra":true}', '{"version":2,"tours":{"antidetect":{"completed":false}}}', '{"version":2,"tours":{"antidetect":{"lastStep":1}}}',
    '{"version":2,"tours":{"antidetect":{"completed":false,"lastStep":1,"note":"x"}}}', '{"version":2,"tours":{"__proto__":{"completed":false,"lastStep":0}}}', '{"version":2,"tours":{"antidetect":[false,1]}}', '{"version":2,"tours":{"antidetect":null}}',
    JSON.stringify({ version: 2, tours: Object.fromEntries([...TOUR_IDS, 'extra'].map(id => [id, { completed: false, lastStep: 0 }])) }),
    ' '.repeat(TOUR_STATE_MAX_CHARS + 1), JSON.stringify({ version: 2, tours: { antidetect: { completed: false, lastStep: 1 } }, note: 'x'.repeat(2000) }),
  ];
  for (const value of bad) assert.equal(parseTourState(value), null, JSON.stringify(value)?.slice(0, 100));
  // The raw text is capped before parsing: a huge value is never parsed.
  assert.equal(parseTourState('{"version":2,"tours":{},"x":"' + 'a'.repeat(100000) + '"}'), null);
  // Injected registries are honoured, so the check can be run against any set of tours.
  assert.notEqual(parseTourState(one('solo', false, 1), { solo: [{}, {}] }), null); assert.equal(parseTourState(one('solo', false, 2), { solo: [{}, {}] }), null); assert.equal(parseTourState(one('antidetect', false, 1), { solo: [{}, {}] }), null);
});

test('stored state v2: serialized in registry order, compact, and always within the cap even with every tour stored', () => {
  assert.equal(serializeTourState(parseTourState(state({ proxy: { completed: true, lastStep: 0 }, hub: { completed: false, lastStep: 2 } }))), '{"version":2,"tours":{"hub":{"completed":false,"lastStep":2},"proxy":{"completed":true,"lastStep":0}}}', 'registry order, not insertion order');
  assert.equal(serializeTourState(null), '{"version":2,"tours":{}}'); assert.equal(serializeTourState({ tours: { antidetect: { completed: 'yes', lastStep: 1 }, nope: { completed: true, lastStep: 0 } } }), '{"version":2,"tours":{"antidetect":{"completed":false,"lastStep":1}}}', 'unknown tours are never written; completed is a real boolean');
  const full = state(Object.fromEntries(TOUR_IDS.map(id => [id, { completed: true, lastStep: TOURS[id].length - 1 }])));
  assert.ok(full.length <= TOUR_STATE_MAX_CHARS, 'every tour at its last step: ' + full.length + ' characters'); assert.equal(serializeTourState(parseTourState(full)), full); assert.ok(TOUR_STATE_MAX_CHARS >= full.length * 1.5, 'room to grow');
});

test('stored state v1 (round 5): read once as the Antidetect tour, the step moved up past the removed Proxy step, strictly validated', () => {
  assert.equal(TOUR_LEGACY_MAX_CHARS, 64);
  for (const [stored, expected] of [[0, 0], [1, 1], [4, 4], [5, 5], [6, 5], [7, 6]]) assert.deepEqual(JSON.parse(JSON.stringify(parseTourLegacyState(legacy(false, stored)))), { version: 2, tours: { antidetect: { completed: false, lastStep: expected } } }, 'v1 step ' + stored);
  assert.equal(parseTourLegacyState(legacy(true, 0)).tours.antidetect.completed, true); assert.ok(Object.isFrozen(parseTourLegacyState(legacy(true, 3))));
  for (const value of [null, undefined, 7, '', '{}', '[]', 'x', legacy(false, 8), legacy(false, -1), legacy(false, 1.5), legacy(false, '2'), legacy('no', 1), '{"version":2,"completed":false,"lastStep":1}', '{"version":1,"completed":false}', '{"version":1,"completed":false,"lastStep":1,"extra":true}',
    '{"version":1,"completed":false,"lastStep":1,"__proto__":{"x":1}}', ' '.repeat(TOUR_LEGACY_MAX_CHARS + 1), JSON.stringify({ version: 1, completed: false, lastStep: 1, note: 'x'.repeat(100) })]) assert.equal(parseTourLegacyState(value), null, JSON.stringify(value));
});

test('stored state: v2 is used, v1 is migrated only while v2 is absent, an invalid value is reported, a blocked storage reads as empty and never throws', () => {
  assert.deepEqual({ ...readTourState(memory({ initial: { [TOUR_STORAGE_KEY]: one('proxy', false, 2) } })).tours.proxy }, { completed: false, lastStep: 2 });
  assert.deepEqual(loadTourState(memory()), { state: null, invalid: false, legacy: false });
  const both = memory({ initial: { [TOUR_STORAGE_KEY]: one('proxy', false, 2), [TOUR_LEGACY_STORAGE_KEY]: legacy(false, 3) } });
  assert.deepEqual(Object.keys(loadTourState(both).state.tours), ['proxy'], 'a stored v2 wins; v1 is not even read'); assert.deepEqual(both.calls.map(call => call[1]), [TOUR_STORAGE_KEY]);
  const migrated = loadTourState(memory({ initial: { [TOUR_LEGACY_STORAGE_KEY]: legacy(true, 6) } }));
  assert.equal(migrated.legacy, true); assert.equal(migrated.invalid, false); assert.deepEqual({ ...migrated.state.tours.antidetect }, { completed: true, lastStep: 5 });
  assert.deepEqual(loadTourState(memory({ initial: { [TOUR_STORAGE_KEY]: '{"version":9}' } })), { state: null, invalid: true, legacy: false });
  assert.deepEqual(loadTourState(memory({ initial: { [TOUR_LEGACY_STORAGE_KEY]: '{"version":1}' } })), { state: null, invalid: true, legacy: false });
  const blocked = memory({ fail: true });
  assert.deepEqual(loadTourState(blocked), { state: null, invalid: false, legacy: false }); assert.equal(writeTourState(blocked, parseTourState(one('proxy', false, 1))), false); assert.equal(clearTourState(blocked), false);
  assert.deepEqual(loadTourState(null), { state: null, invalid: false, legacy: false }); assert.equal(clearTourState(null), true);
  const ok = memory({ initial: { [TOUR_LEGACY_STORAGE_KEY]: legacy(false, 2) } });
  assert.equal(writeTourState(ok, parseTourState(one('proxy', true, 0))), true); assert.equal(ok.data.get(TOUR_STORAGE_KEY), '{"version":2,"tours":{"proxy":{"completed":true,"lastStep":0}}}'); assert.equal(ok.data.has(TOUR_LEGACY_STORAGE_KEY), false, 'writing v2 retires v1');
  assert.equal(clearTourState(ok), true); assert.equal(ok.data.size, 0);
  assert.deepEqual([...new Set(ok.calls.map(call => call[1]))].sort(), [TOUR_LEGACY_STORAGE_KEY, TOUR_STORAGE_KEY].sort(), 'only the two tour keys are ever touched');
  const halfBlocked = memory(); const original = halfBlocked.removeItem; halfBlocked.removeItem = () => { throw Error('cannot remove'); };
  assert.equal(writeTourState(halfBlocked, parseTourState(one('proxy', false, 1))), true, 'a v1 key that cannot be removed does not fail the write'); halfBlocked.removeItem = original;
});

test('tourProgress reads one tour of a snapshot: completed, last step, resumable', () => {
  const snapshot = { progress: { proxy: { completed: false, lastStep: 3 }, cookies: { completed: true, lastStep: 0 } } };
  assert.deepEqual({ ...tourProgress(snapshot, 'proxy') }, { completed: false, lastStep: 3, resumable: true });
  assert.deepEqual({ ...tourProgress(snapshot, 'cookies') }, { completed: true, lastStep: 0, resumable: false });
  for (const value of [{ progress: {} }, {}, null, undefined, { progress: null }]) assert.deepEqual({ ...tourProgress(value, 'hub') }, { completed: false, lastStep: 0, resumable: false });
  assert.deepEqual({ ...tourProgress({ progress: {} }, 'constructor') }, { completed: false, lastStep: 0, resumable: false }, 'an inherited name is never a tour');
});

// ---- the state machine ------------------------------------------------------------------------------------------------------------------
test('controller: an invalid stored value is cleared on first read; reading never writes; v1 progress is migrated in memory and replaced on the first write', () => {
  const garbage = memory({ initial: { [TOUR_STORAGE_KEY]: 'garbage', [TOUR_LEGACY_STORAGE_KEY]: legacy(false, 2) } });
  const controller = createTourController({ storage: garbage });
  assert.deepEqual({ ...controller.getSnapshot() }, { available: false, running: false, tour: null, requestId: 0, index: 0, direction: 1, total: 0, invoker: null, progress: {} });
  assert.equal(garbage.data.size, 0, 'the invalid value was removed, with the key it would have been migrated from');
  const quietStore = memory({ initial: { [TOUR_STORAGE_KEY]: one('proxy', false, 2) } });
  createTourController({ storage: quietStore }).getSnapshot(); assert.deepEqual(quietStore.calls.map(call => call[0]), ['get'], 'a valid value is only read');
  const lazy = memory(); createTourController({ storage: lazy }); assert.deepEqual(lazy.calls, [], 'nothing is read before the first use');
  const old = memory({ initial: { [TOUR_LEGACY_STORAGE_KEY]: legacy(false, 4) } }), migrating = createTourController({ storage: old });
  assert.deepEqual({ ...tourProgress(migrating.getSnapshot(), 'antidetect') }, { completed: false, lastStep: 4, resumable: true }); assert.deepEqual(old.calls.map(call => call[0]), ['get', 'get'], 'migration reads and writes nothing');
  migrating.start({ tour: 'antidetect', resume: true }); assert.equal(migrating.getSnapshot().index, 4, 'Resume continues at the migrated step'); migrating.presented(4);
  assert.equal(old.data.get(TOUR_STORAGE_KEY), one('antidetect', false, 4)); assert.equal(old.data.has(TOUR_LEGACY_STORAGE_KEY), false);
});

test('controller: start, next, back, presented, close per tour; progress is stored for every shown step and Resume continues it', () => {
  const store = memory(), controller = createTourController({ storage: store }), seen = [];
  controller.subscribe(snapshot => seen.push(snapshot));
  const invoker = { id: 'button' };
  assert.equal(controller.start({ tour: 'proxy', invoker }), true);
  let snap = controller.getSnapshot();
  assert.deepEqual([snap.running, snap.tour, snap.index, snap.direction, snap.total, snap.invoker], [true, 'proxy', 0, 1, TOURS.proxy.length, invoker]);
  const first = snap.requestId;
  assert.equal(store.data.has(TOUR_STORAGE_KEY), false, 'starting stores nothing until a step is shown');
  assert.equal(controller.presented(0), true);
  assert.equal(store.data.get(TOUR_STORAGE_KEY), one('proxy', false, 0));
  assert.equal(controller.getSnapshot().requestId, first, 'presenting the asked-for step is not a new request');
  assert.equal(controller.next(), true); snap = controller.getSnapshot();
  assert.deepEqual([snap.index, snap.direction], [1, 1]); assert.ok(snap.requestId > first);
  controller.presented(3);                                  // steps 1 and 2 were missing: the layer reports step 3
  assert.equal(controller.getSnapshot().index, 3); assert.equal(store.data.get(TOUR_STORAGE_KEY), one('proxy', false, 3));
  assert.equal(controller.next(), true); assert.equal(controller.getSnapshot().index, 4);
  assert.equal(controller.back(), true); snap = controller.getSnapshot(); assert.deepEqual([snap.index, snap.direction], [3, -1]);
  controller.presented(3);
  const closed = controller.close('skip');
  assert.deepEqual({ ...closed }, { reason: 'skip', tour: 'proxy', completed: false, invoker });
  assert.equal(store.data.get(TOUR_STORAGE_KEY), one('proxy', false, 3));
  snap = controller.getSnapshot(); assert.deepEqual([snap.running, snap.tour, snap.total, snap.invoker, { ...tourProgress(snap, 'proxy') }], [false, null, 0, null, { completed: false, lastStep: 3, resumable: true }]);
  assert.equal(controller.close('skip'), null, 'closing twice is a no-op');
  controller.start({ tour: 'proxy', invoker: null, resume: true }); assert.equal(controller.getSnapshot().index, 3, 'Resume starts at the stored step');
  controller.close('esc');
  assert.equal(store.data.get(TOUR_STORAGE_KEY), one('proxy', false, 3), 'closing before a step was shown keeps the stored step');
  controller.start({ tour: 'proxy', resume: false }); assert.equal(controller.getSnapshot().index, 0, 'Start over begins at the first step');
  assert.equal(store.data.get(TOUR_STORAGE_KEY), one('proxy', false, 0), 'and forgets the old step at once');
  assert.equal(tourProgress(controller.getSnapshot(), 'proxy').resumable, false);
  assert.ok(seen.length >= 8 && seen.every(snapshot => Object.isFrozen(snapshot)));
  controller.close('esc'); controller.start(); assert.equal(controller.getSnapshot().tour, DEFAULT_TOUR, 'a start without a tour runs the default one');
});

test('controller: tours keep separate progress; finishing completes one run and clears its resume step; replays keep "completed"', () => {
  const store = memory(), controller = createTourController({ storage: store }), last = TOURS.cookies.length - 1;
  controller.start({ tour: 'cookies' }); controller.presented(1); controller.presented(last);
  assert.deepEqual({ ...controller.close('done') }, { reason: 'done', tour: 'cookies', completed: true, invoker: null });
  assert.equal(store.data.get(TOUR_STORAGE_KEY), one('cookies', true, 0));
  controller.start({ tour: 'proxy' }); controller.presented(0); controller.presented(2); controller.close('skip');
  assert.equal(store.data.get(TOUR_STORAGE_KEY), state({ cookies: { completed: true, lastStep: 0 }, proxy: { completed: false, lastStep: 2 } }), 'another tour is stored beside it, in registry order');
  assert.deepEqual([tourProgress(controller.getSnapshot(), 'cookies').resumable, tourProgress(controller.getSnapshot(), 'proxy').resumable, tourProgress(controller.getSnapshot(), 'hub').resumable], [false, true, false]);
  controller.start({ tour: 'cookies' }); controller.presented(0); controller.presented(2);
  assert.equal(JSON.parse(store.data.get(TOUR_STORAGE_KEY)).tours.cookies.lastStep, 2, 'a replay that stops early keeps completed: true and offers Resume'); assert.equal(JSON.parse(store.data.get(TOUR_STORAGE_KEY)).tours.cookies.completed, true);
  controller.close('esc');
  controller.start({ tour: 'cookies', resume: true }); controller.presented(last);
  assert.equal(controller.close('esc').completed, true, 'Esc on the last step counts as finished');
  assert.deepEqual({ ...JSON.parse(store.data.get(TOUR_STORAGE_KEY)).tours.cookies }, { completed: true, lastStep: 0 });
  // Closed before any step was shown: nothing is stored and nothing counts as completed.
  const other = memory(), early = createTourController({ storage: other }); early.start({ tour: 'hub' });
  assert.deepEqual({ ...early.close('esc') }, { reason: 'esc', tour: 'hub', completed: false, invoker: null }); assert.equal(other.data.size, 0);
});

test('controller: bounds, unknown tours, restart while running, goto, forget (one tour or all), a blocked storage and a throwing subscriber', () => {
  const store = memory(), controller = createTourController({ storage: store });
  assert.equal(controller.next(), false); assert.equal(controller.back(), false); assert.equal(controller.presented(0), false); assert.equal(controller.goto(1), false);
  for (const tour of ['nope', '', 'constructor', null, 7, {}]) assert.equal(controller.start({ tour }), false, String(tour));
  assert.equal(controller.getSnapshot().running, false, 'an unknown tour never starts');
  controller.start({ tour: 'antidetect' });
  assert.equal(controller.back(), false, 'there is nothing before the first step');
  assert.equal(controller.goto(-1), false); assert.equal(controller.goto(TOURS.antidetect.length), false); assert.equal(controller.goto(1.5), false); assert.equal(controller.goto('2'), false);
  assert.equal(controller.presented(TOURS.antidetect.length), false); assert.equal(controller.presented(-1), false); assert.equal(controller.presented(0.5), false);
  assert.equal(controller.goto(4, -1), true); assert.deepEqual([controller.getSnapshot().index, controller.getSnapshot().direction], [4, -1]);
  controller.presented(TOURS.antidetect.length - 1); assert.equal(controller.next(), false, 'there is nothing after the last step (Done closes)');
  const before = controller.getSnapshot().requestId; controller.start({ tour: 'antidetect' }); assert.ok(controller.getSnapshot().requestId > before); assert.equal(controller.getSnapshot().index, 0, 'starting while running restarts');
  controller.start({ tour: 'hub' }); assert.deepEqual([controller.getSnapshot().tour, controller.getSnapshot().total], ['hub', TOURS.hub.length], 'another tour replaces the running one');
  assert.equal(controller.goto(TOURS.hub.length), false, 'the bound is the one of the running tour'); assert.equal(controller.goto(TOURS.hub.length - 1), true);
  controller.presented(2); controller.close('skip'); controller.start({ tour: 'proxy' }); controller.presented(1); controller.close('skip');
  assert.equal(controller.forget('hub'), true); assert.equal(store.data.get(TOUR_STORAGE_KEY), state({ antidetect: { completed: false, lastStep: 0 }, proxy: { completed: false, lastStep: 1 } }), 'one tour forgotten, the others kept');
  assert.equal(controller.forget('nope'), false); assert.equal(controller.forget('cookies'), true, 'forgetting a tour that has no progress is fine');
  assert.equal(controller.forget('antidetect'), true); assert.equal(store.data.get(TOUR_STORAGE_KEY), one('proxy', false, 1));
  assert.equal(controller.forget('proxy'), true); assert.equal(store.data.has(TOUR_STORAGE_KEY), false, 'the last one removes the key');
  controller.start({ tour: 'cookies' }); controller.presented(1); controller.close('skip');
  assert.equal(controller.forget(), true); assert.equal(store.data.size, 0); assert.deepEqual(Object.keys(controller.getSnapshot().progress), []);
  const unsubscribe = controller.subscribe(() => { throw Error('one bad view'); }); let notified = 0; controller.subscribe(() => { notified++; });
  assert.doesNotThrow(() => controller.start({ tour: 'hub' })); assert.ok(notified >= 1, 'a throwing subscriber does not stop the others');
  unsubscribe(); assert.equal(controller.subscribe('nope')(), undefined);
  const blocked = createTourController({ storage: memory({ fail: true }) });
  assert.doesNotThrow(() => { blocked.start({ tour: 'hub' }); blocked.presented(2); blocked.close('skip'); });
  assert.equal(tourProgress(blocked.getSnapshot(), 'hub').lastStep, 2, 'the page keeps the progress in memory even when it cannot be stored');
  const none = createTourController({ storage: () => null }); assert.doesNotThrow(() => { none.start({ tour: 'hub' }); none.presented(1); none.close('skip'); });
});

test('controller: provide() marks a page that has a tour layer; follows progress changed elsewhere (storage event, either key) only while someone is subscribed', () => {
  const plain = createTourController({ storage: memory() }), heard = []; plain.subscribe(snapshot => heard.push(snapshot.available));
  assert.equal(plain.getSnapshot().available, false); assert.equal(plain.provide(), true); assert.equal(plain.getSnapshot().available, true); assert.deepEqual(heard, [true], 'subscribers learn about it'); plain.provide(); assert.deepEqual(heard, [true], 'once');
  const store = memory(), controller = createTourController({ storage: store }), handlers = new Map();
  const had = ['addEventListener', 'removeEventListener'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  globalThis.addEventListener = (type, handler) => handlers.set(type, handler);
  globalThis.removeEventListener = (type, handler) => { if (handlers.get(type) === handler) handlers.delete(type); };
  try {
    assert.equal(tourProgress(controller.getSnapshot(), 'proxy').resumable, false); assert.equal(handlers.has('storage'), false, 'nothing is listened to before someone subscribes');
    const seen = [], stop = controller.subscribe(snapshot => seen.push(tourProgress(snapshot, 'proxy').lastStep)), second = controller.subscribe(() => {});
    assert.equal(handlers.size, 1, 'one listener however many subscribers');
    store.data.set(TOUR_STORAGE_KEY, one('proxy', false, 3)); handlers.get('storage')({ key: TOUR_STORAGE_KEY });
    assert.deepEqual(seen, [3]); assert.equal(tourProgress(controller.getSnapshot(), 'proxy').resumable, true);
    handlers.get('storage')({ key: 'another-key' }); assert.deepEqual(seen, [3], 'other keys are ignored');
    store.data.delete(TOUR_STORAGE_KEY); store.data.set(TOUR_LEGACY_STORAGE_KEY, legacy(false, 2)); handlers.get('storage')({ key: TOUR_LEGACY_STORAGE_KEY });
    assert.equal(tourProgress(controller.getSnapshot(), 'antidetect').lastStep, 2, 'a v1 value written by an older window is picked up');
    store.data.set(TOUR_STORAGE_KEY, 'garbage'); handlers.get('storage')({ key: null });
    assert.deepEqual(Object.keys(controller.getSnapshot().progress), []); assert.equal(store.data.has(TOUR_STORAGE_KEY), false, 'a cleared storage (key null) or an invalid value is read as empty and removed');
    stop(); assert.equal(handlers.has('storage'), true, 'the listener stays for the remaining subscriber'); second(); assert.equal(handlers.has('storage'), false, 'and goes with the last one');
    store.data.set(TOUR_STORAGE_KEY, one('proxy', false, 2)); controller.start({ tour: 'proxy', resume: true });
    assert.equal(controller.getSnapshot().index, 2, 'a start reads the stored progress again');
    controller.presented(2); controller.close('esc');
    store.data.delete(TOUR_STORAGE_KEY); controller.start({ tour: 'proxy', resume: true }); assert.equal(controller.getSnapshot().index, 0, 'progress removed elsewhere: a Resume request starts at the beginning');
  } finally { for (const [name, descriptor] of had) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } }
});

// ---- the walk to the next step that can be shown (step skipping) -------------------------------------------------------------------
// A fake page and a fake clock: pause() moves the clock, so the waits are measured without waiting.
function walkKit({ present = {}, view = { section: 'antidetect', level: 'quick' }, busyUntil = 0, appearAfter = {} } = {}) {
  let clock = 0, shown = view; const log = [], pauses = [];
  const api = {
    currentView: () => shown,
    navigate: next => { log.push('view ' + next.section + (next.level ? '/' + next.level : '')); shown = next; },
    locate: key => { log.push('locate ' + key); const at = appearAfter[key]; return (present[key] ?? true) && (at === undefined || clock >= at) ? { key } : null; },
    pause: async ms => { pauses.push(ms); clock += ms; }, now: () => clock, busy: () => clock < busyUntil,
  };
  return { api, log, pauses, get clock() { return clock; } };
}
test('step walk: the asked-for step when its part is there; the page is asked for its view only when that view is not on screen', async () => {
  const same = walkKit(), first = await findPresentableStep({ index: 0, direction: 1, ...same.api });
  assert.deepEqual([first.index, first.element.key, first.skipped], [0, 'levels', []]); assert.deepEqual(same.log, ['locate levels'], 'already on screen: no navigation, no settle pause'); assert.deepEqual(same.pauses, []);
  const away = walkKit({ view: { section: 'proxy' } }), second = await findPresentableStep({ index: 1, direction: 1, ...away.api });
  assert.deepEqual([second.index, second.element.key], [1, 'generator']); assert.deepEqual(away.log, ['view antidetect/quick', 'locate generator']); assert.deepEqual(away.pauses, [TOUR_SETTLE_MS], 'a view change is followed by one settle pause');
  const level = walkKit({ view: { section: 'antidetect', level: 'quick' } }), third = await findPresentableStep({ index: 2, direction: 1, ...level.api });
  assert.deepEqual([third.index, level.log[0]], [2, 'view antidetect/os'], 'a level change inside Antidetect counts as a view change');
  // Another tour walks its own section: its steps carry no level.
  const proxy = walkKit({ view: { section: 'hub' } }), found = await findPresentableStep({ steps: TOURS.proxy, index: 0, direction: 1, ...proxy.api });
  assert.deepEqual([found.index, found.element.key, proxy.log[0]], [0, 'proxy-switch', 'view proxy'], 'a step of the Proxy tour is shown in the Proxy section');
});
test('step walk: a part that is not there is skipped and named, forward and backward; the counter can jump over several steps', async () => {
  const missing = { region: false, hints: false };
  const forward = await findPresentableStep({ index: 2, direction: 1, ...walkKit({ present: missing }).api });
  assert.deepEqual([forward.index, forward.element.key, forward.skipped], [4, 'library', ['region', 'hints']]);
  const backward = await findPresentableStep({ index: 3, direction: -1, ...walkKit({ present: missing }).api });
  assert.deepEqual([backward.index, backward.element.key, backward.skipped], [1, 'generator', ['hints', 'region']]);
  const none = await findPresentableStep({ index: 0, direction: 1, ...walkKit({ present: { levels: false } }).api });
  assert.deepEqual([none.index, none.skipped], [1, ['levels']], 'a missing first part is skipped too');
});
test('step walk: waits for a part that is still loading, long after a view change and briefly otherwise, longer while the view reports loading, never forever', async () => {
  const late = walkKit({ appearAfter: { levels: 400 }, view: { section: 'proxy' } }), found = await findPresentableStep({ index: 0, direction: 1, ...late.api });
  assert.equal(found.element.key, 'levels'); assert.ok(late.clock >= 400 && late.clock <= 400 + TOUR_SETTLE_MS + TOUR_POLL_MS * 2, 'found as soon as it appeared: ' + late.clock);
  const single = [TOURS.antidetect[0]];
  const changed = walkKit({ present: { levels: false }, view: { section: 'proxy' } }); await findPresentableStep({ index: 0, direction: 1, steps: single, ...changed.api });
  assert.ok(changed.clock >= TOUR_TARGET_WAIT_MS && changed.clock < TOUR_TARGET_WAIT_MS + TOUR_SETTLE_MS + 2 * TOUR_POLL_MS, 'long wait after a view change: ' + changed.clock);
  const unchanged = walkKit({ present: { levels: false } }); await findPresentableStep({ index: 0, direction: 1, steps: single, ...unchanged.api });
  assert.ok(unchanged.clock >= TOUR_TARGET_QUIET_MS && unchanged.clock < TOUR_TARGET_QUIET_MS + 2 * TOUR_POLL_MS, 'short wait on the same view: ' + unchanged.clock);
  const forever = walkKit({ present: { levels: false }, busyUntil: Infinity }); await findPresentableStep({ index: 0, direction: 1, steps: single, ...forever.api });
  assert.ok(forever.clock >= TOUR_TARGET_HARD_MS && forever.clock < TOUR_TARGET_HARD_MS + 2 * TOUR_POLL_MS, 'a view that never stops loading is given up at the hard cap: ' + forever.clock);
  const slow = walkKit({ appearAfter: { levels: 4000 }, busyUntil: 4500 }), arrived = await findPresentableStep({ index: 0, direction: 1, ...slow.api });
  assert.equal(arrived.element.key, 'levels', 'a part of a view that is still loading is waited for beyond the short wait');
});
test('step walk: running off either end, cancellation, a failing navigation, a step without a target', async () => {
  const end = await findPresentableStep({ index: 5, direction: 1, ...walkKit({ present: { apply: false, master: false } }).api });
  assert.deepEqual(end, { ranOff: true, index: TOURS.antidetect.length, skipped: ['apply', 'finish'] }, 'the last two steps were missing: the run is over');
  const start = await findPresentableStep({ index: 0, direction: -1, ...walkKit({ present: { levels: false } }).api });
  assert.deepEqual(start, { ranOff: true, index: -1, skipped: ['levels'] });
  assert.deepEqual(await findPresentableStep({ index: 0, direction: 1, steps: [], ...walkKit().api }), { ranOff: true, index: 0, skipped: [] });
  let asked = 0; assert.equal(await findPresentableStep({ index: 0, direction: 1, ...walkKit({ present: { levels: false } }).api, cancelled: () => ++asked > 3 }), null, 'cancelled while waiting: no result');
  assert.equal(await findPresentableStep({ index: 0, direction: 1, ...walkKit({ view: { section: 'proxy' } }).api, cancelled: () => true }), null, 'cancelled before the first check');
  const broken = walkKit(); broken.api.navigate = () => { throw Error('no such view'); };
  const through = await findPresentableStep({ index: 1, direction: 1, ...broken.api, currentView: () => ({ section: 'proxy' }) }); assert.equal(through.index, 1, 'a view that cannot be shown does not stop the walk');
  const centred = await findPresentableStep({ index: 0, direction: 1, steps: [{ id: 'note', view: { section: 'proxy' }, target: null }], ...walkKit().api });
  assert.deepEqual(centred, { index: 0, element: null, skipped: [] }, 'a step without a target is always presentable (centred)');
});

// ---- target lookup --------------------------------------------------------------------------------------------------------------------
function fakeElement({ connected = true, hiddenByAncestor = false, display = 'block', visibility = 'visible', width = 10, height = 10 } = {}) {
  return { isConnected: connected, closest: () => hiddenByAncestor ? {} : null, getBoundingClientRect: () => ({ width, height, left: 0, top: 0 }), __style: { display, visibility } };
}
function withFakeStyles(action) {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'getComputedStyle');
  globalThis.getComputedStyle = element => element.__style ?? { display: 'block', visibility: 'visible' };
  try { return action(); } finally { if (had) Object.defineProperty(globalThis, 'getComputedStyle', had); else delete globalThis.getComputedStyle; }
}
test('target lookup: dedicated data-tour anchor first, registry selectors next, only visible elements, never throws', () => {
  withFakeStyles(() => {
    assert.equal(isTourTargetVisible(fakeElement()), true);
    for (const options of [{ connected: false }, { hiddenByAncestor: true }, { display: 'none' }, { visibility: 'hidden' }, { width: 0 }, { height: 0 }]) assert.equal(isTourTargetVisible(fakeElement(options)), false, JSON.stringify(options));
    assert.equal(isTourTargetVisible(null), false); assert.equal(isTourTargetVisible({ isConnected: true, closest() { throw Error('x'); } }), false);
    const anchor = fakeElement(), legacyElement = fakeElement(), hidden = fakeElement({ hiddenByAncestor: true }), asked = [];
    const root = { querySelectorAll: selector => { asked.push(selector); return selector === '[data-tour~="levels"]' ? [hidden, anchor] : selector === TOUR_TARGETS.levels[0] ? [legacyElement] : []; } };
    assert.equal(findTourTarget('levels', root), anchor, 'the dedicated anchor wins over the older hook, hidden matches are skipped');
    assert.deepEqual(asked, ['[data-tour~="levels"]'], 'the registry selectors are not even asked');
    const onlyLegacy = { querySelectorAll: selector => selector === TOUR_TARGETS.levels[0] ? [legacyElement] : [] };
    assert.equal(findTourTarget('levels', onlyLegacy), legacyElement, 'a missing anchor falls back to the registry');
    // A key with several selectors tries them in order (the Proxy switch: the connect switch, then the disconnect switch that replaces it).
    const second = fakeElement(), ordered = { querySelectorAll: selector => selector === TOUR_TARGETS['proxy-switch'][1] ? [second] : selector === TOUR_TARGETS['proxy-switch'][0] ? [fakeElement({ hiddenByAncestor: true })] : [] };
    assert.equal(findTourTarget('proxy-switch', ordered), second, 'the first selector has only a hidden match: the next selector is used');
    assert.equal(findTourTarget('levels', { querySelectorAll: () => [hidden] }), null, 'nothing visible: the step is skipped');
    assert.equal(findTourTarget('unknown-key', { querySelectorAll: () => [anchor] }), anchor, 'an unregistered key still works through its own anchor');
    assert.equal(findTourTarget('unknown-key', { querySelectorAll: () => [] }), null);
    for (const key of ['', 'A', '1x', 'a b', 'a"]', 'x'.repeat(40), null, 7, {}]) assert.equal(findTourTarget(key, { querySelectorAll: () => [anchor] }), null, 'bad key ' + String(key));
    assert.equal(findTourTarget('levels', { querySelectorAll() { throw SyntaxError('bad selector'); } }), null);
    assert.equal(findTourTarget('levels', null), null); assert.equal(findTourTarget('levels', {}), null);
  });
});

// ---- placement, ring, keys ------------------------------------------------------------------------------------------------------------
test('placement: bottom first, then top, right, left; docked when the window is narrow or nothing fits; centred without a target; always inside the window', () => {
  const viewport = { width: 1280, height: 900 }, popover = { width: 416, height: 230 };
  const ring = (left, top, width, height) => ({ left, top, width, height });
  assert.deepEqual(computeTourPlacement({ ring: ring(268, 170, 969, 44), popover, viewport }), { mode: 'float', side: 'bottom', left: 545, top: 226 });
  assert.equal(computeTourPlacement({ ring: ring(100, 700, 300, 150), popover, viewport }).side, 'top', 'no room below');
  assert.deepEqual(computeTourPlacement({ ring: ring(100, 100, 300, 790), popover, viewport }), { mode: 'float', side: 'right', left: 412, top: 380 }, 'no room above or below: beside the ring, centred on it');
  assert.equal(computeTourPlacement({ ring: ring(700, 100, 560, 780), popover, viewport }).side, 'left');
  assert.deepEqual(computeTourPlacement({ ring: ring(2, 2, 1276, 896), popover, viewport }), { mode: 'dock', side: 'bottom' }, 'a target that fills the window');
  assert.deepEqual(computeTourPlacement({ ring: ring(10, 10, 100, 40), popover, viewport: { width: TOUR_COMPACT_WIDTH - 1, height: 900 } }), { mode: 'dock', side: 'bottom' });
  assert.equal(computeTourPlacement({ ring: ring(10, 10, 100, 40), popover, viewport: { width: TOUR_COMPACT_WIDTH, height: 900 } }).mode, 'float');
  assert.deepEqual(computeTourPlacement({ ring: ring(10, 10, 100, 40), popover, viewport, forceDock: true }), { mode: 'dock', side: 'bottom' });
  // A docked sheet takes the edge the target is NOT near: a target in the lower half gets the sheet along the top edge.
  const narrow = { width: 400, height: 800 };
  assert.deepEqual(computeTourPlacement({ ring: ring(10, 100, 300, 40), popover, viewport: narrow }), { mode: 'dock', side: 'bottom' }, 'target in the upper half');
  assert.deepEqual(computeTourPlacement({ ring: ring(10, 600, 300, 40), popover, viewport: narrow }), { mode: 'dock', side: 'top' }, 'target in the lower half');
  assert.deepEqual(computeTourPlacement({ ring: ring(10, 600, 300, 40), popover, viewport: narrow, dockSide: 'bottom' }), { mode: 'dock', side: 'bottom' }, 'an earlier choice is kept while the page moves');
  assert.deepEqual(computeTourPlacement({ ring: ring(10, 100, 300, 40), popover, viewport: narrow, dockSide: 'sideways' }), { mode: 'dock', side: 'bottom' }, 'an unknown side is ignored');
  assert.deepEqual(computeTourPlacement({ ring: ring(2, 100, 1276, 700), popover, viewport }), { mode: 'dock', side: 'bottom' }, 'nothing fits and the target is centred: bottom');
  assert.deepEqual(computeTourPlacement({ ring: ring(2, 200, 1276, 650), popover, viewport }), { mode: 'dock', side: 'top' }, 'nothing fits and the target sits low: the sheet goes to the top');
  assert.deepEqual(computeTourPlacement({ ring: null, popover, viewport }), { mode: 'center', side: 'center', left: 432, top: 335 });
  for (let step = 0; step < 400; step++) {
    const box = ring((step * 37) % 1200, (step * 53) % 800, 20 + (step * 11) % 600, 20 + (step * 7) % 500), placed = computeTourPlacement({ ring: box, popover, viewport });
    if (placed.mode !== 'float') continue;
    assert.ok(placed.left >= TOUR_MARGIN - 1 && placed.left + popover.width <= viewport.width - TOUR_MARGIN + 1, 'inside horizontally ' + JSON.stringify([box, placed]));
    assert.ok(placed.top >= 0 && placed.top + popover.height <= viewport.height + 1, 'inside vertically ' + JSON.stringify([box, placed]));
    const overlaps = placed.left < box.left + box.width && placed.left + popover.width > box.left && placed.top < box.top + box.height && placed.top + popover.height > box.top;
    assert.equal(overlaps, false, 'the popover never covers the ring ' + JSON.stringify([box, placed]));
  }
  assert.deepEqual(computeTourPlacement({ ring: ring(0, 0, 10, 10), popover: undefined, viewport: undefined }), { mode: 'dock', side: 'bottom' }, 'missing sizes never throw');
});

test('ring: padded around the target and kept inside the window', () => {
  const viewport = { width: 1280, height: 900 };
  assert.deepEqual(tourRingFor({ left: 100, top: 200, width: 300, height: 40 }, viewport), { left: 100 - TOUR_RING_PAD, top: 200 - TOUR_RING_PAD, width: 300 + 2 * TOUR_RING_PAD, height: 40 + 2 * TOUR_RING_PAD });
  assert.deepEqual(tourRingFor({ left: -50, top: -20, width: 300, height: 40 }, viewport), { left: 2, top: 2, width: 254, height: 24 }, 'a target above or left of the window starts at its edge');
  const tall = tourRingFor({ left: 268, top: 12, width: 969, height: 2400 }, viewport);
  assert.deepEqual([tall.top, tall.top + tall.height], [6, 898], 'a target taller than the window is cut at the window edge');
  const wide = tourRingFor({ left: 10, top: 10, width: 5000, height: 20 }, viewport); assert.equal(wide.left + wide.width, 1278);
});

test('keys: Esc closes; arrows and Enter move (mirrored in right-to-left text); Tab cycles; modifiers, IME and other layers are never taken', () => {
  const act = (key, extra = {}) => tourKeyAction({ key, ...extra });
  assert.equal(act('Escape'), 'close'); assert.equal(act('Escape', { where: 'button' }), 'close'); assert.equal(act('Escape', { where: 'editable' }), 'close');
  assert.equal(act('ArrowRight'), 'next'); assert.equal(act('ArrowLeft'), 'back'); assert.equal(act('ArrowRight', { rtl: true }), 'back'); assert.equal(act('ArrowLeft', { rtl: true }), 'next');
  assert.equal(act('ArrowRight', { where: 'editable' }), null, 'a caret keeps its arrows'); assert.equal(act('ArrowLeft', { where: 'editable' }), null);
  assert.equal(act('ArrowRight', { where: 'button' }), 'next'); assert.equal(act('ArrowRight', { where: 'popover' }), 'next');
  assert.equal(act('Enter', { where: 'popover' }), 'next'); assert.equal(act('Enter', { where: 'page' }), 'next');
  assert.equal(act('Enter', { where: 'button' }), null, 'Enter on a button is that button'); assert.equal(act('Enter', { where: 'editable' }), null);
  assert.equal(act('Tab'), 'tab-forward'); assert.equal(act('Tab', { shiftKey: true }), 'tab-backward');
  for (const key of ['Escape', 'ArrowRight', 'ArrowLeft', 'Enter', 'Tab']) {
    for (const modifier of ['ctrlKey', 'altKey', 'metaKey', 'isComposing']) assert.equal(act(key, { [modifier]: true }), null, key + ' + ' + modifier);
    assert.equal(act(key, { where: 'layer' }), null, key + ' inside another dialog, menu or list');
  }
  assert.equal(act('ArrowRight', { shiftKey: true }), null); assert.equal(act('Enter', { shiftKey: true }), null);
  for (const key of ['a', ' ', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'F1', 'k', undefined]) assert.equal(act(key), null, 'untouched: ' + String(key));
});

test('fillTourText replaces only {n}, {total} and {title}, once, and never reads a value as a pattern', () => {
  assert.equal(fillTourText('Step {n} of {total}', { n: 2, total: 8 }), 'Step 2 of 8');
  assert.equal(fillTourText('“{title}”: {title}', { title: '$& {n} $1' }), '“$& {n} $1”: $& {n} $1');
  assert.equal(fillTourText('{unknown} {n}', { n: 1 }), '{unknown} 1'); assert.equal(fillTourText('{n}', {}), '{n}'); assert.equal(fillTourText('{n}', undefined), '{n}');
  assert.equal(fillTourText(null, { n: 1 }), ''); assert.equal(fillTourText(7, {}), '');
});

// ---- markup ---------------------------------------------------------------------------------------------------------------------------
const h = (type, props, ...rest) => ({ type, props: { ...(props ?? {}), ...(rest.length ? { children: rest } : {}) } });
function nodes(tree, predicate = () => true, found = []) {
  if (Array.isArray(tree)) { for (const child of tree) nodes(child, predicate, found); return found; }
  if (!tree || typeof tree !== 'object' || !tree.props) return found;
  if (predicate(tree)) found.push(tree);
  nodes(tree.props.children, predicate, found); return found;
}
const textOf = node => node == null ? '' : Array.isArray(node) ? node.map(textOf).join('') : typeof node === 'object' ? textOf(node.props?.children) : String(node);
const has = key => node => node.props[key] !== undefined;

test('popover markup: a non-modal dialog named by its title and described by its step and text; Skip, Back and Done where they belong', () => {
  const TourPopover = createTourPopover({ h });
  const labels = { back: 'Back', next: 'Next', skip: 'Skip tour', done: 'Done' };
  const render = (extra = {}) => TourPopover({ popoverRef: { current: null }, nextRef: { current: null }, id: 'region', index: 2, total: 8, title: 'Region', body: 'Body text', stepLabel: 'Step 3 of 8', eyebrow: 'Guided tour', labels, onBack() {}, onNext() {}, onSkip() {}, ...extra });
  const tree = render(), by = key => nodes(tree, has(key));
  assert.equal(tree.type, 'section'); assert.equal(tree.props.role, 'dialog'); assert.equal(tree.props['aria-modal'], 'false', 'the page behind stays reachable for assistive technology');
  assert.equal(tree.props.tabIndex, -1);
  const ids = nodes(tree, node => node.props.id).map(node => node.props.id);
  for (const token of [tree.props['aria-labelledby'], ...tree.props['aria-describedby'].split(' ')]) assert.ok(ids.includes(token), 'referenced id exists: ' + token);
  assert.equal(textOf(nodes(tree, node => node.props.id === tree.props['aria-labelledby'])[0]), 'Region');
  assert.deepEqual(tree.props['aria-describedby'].split(' ').map(token => textOf(nodes(tree, node => node.props.id === token)[0])), ['Step 3 of 8', 'Body text']);
  assert.equal(textOf(by('data-ui-tour-counter')[0]), '3 / 8'); assert.equal(by('data-ui-tour-counter')[0].props['aria-hidden'], 'true', 'the counter is spoken through the step label');
  assert.equal(by('data-ui-tour-counter')[0].props.dir, 'ltr');
  assert.deepEqual(['data-ui-tour-skip', 'data-ui-tour-back', 'data-ui-tour-next'].map(key => by(key).length), [1, 1, 1]);
  assert.equal(textOf(by('data-ui-tour-next')[0]), 'Next'); assert.equal(by('data-ui-tour-next')[0].props.type, 'button');
  assert.equal(nodes(render({ index: 0 }), has('data-ui-tour-back')).length, 0, 'no Back on the first step');
  const last = render({ index: 7 });
  assert.equal(nodes(last, has('data-ui-tour-skip')).length, 0, 'Skip gives way to Done on the last step');
  assert.equal(textOf(nodes(last, has('data-ui-tour-next'))[0]), 'Done');
  assert.equal(by('data-ui-tour-skipped').length, 0); assert.equal(tree.props['data-ui-tour-ready'], 'false'); assert.equal(tree.props['aria-busy'], undefined);
  const skipped = render({ notes: [{ id: 'region', text: 'Skipped “Region”: not available here.' }] });
  assert.deepEqual(nodes(skipped, has('data-ui-tour-skipped-step')).map(textOf), ['Skipped “Region”: not available here.']);
  // While the next step is being prepared the buttons keep their place but do nothing; Skip always works.
  const calls = [], busy = render({ busy: true, ready: true, onBack: () => calls.push('back'), onNext: () => calls.push('next'), onSkip: () => calls.push('skip') });
  assert.equal(busy.props['aria-busy'], 'true'); assert.equal(busy.props['data-ui-tour-ready'], 'true');
  const press = key => nodes(busy, has(key))[0].props.onClick({ preventDefault() { calls.push('prevented'); } });
  press('data-ui-tour-next'); press('data-ui-tour-back'); press('data-ui-tour-skip');
  assert.deepEqual(calls, ['prevented', 'prevented', 'skip']);
  assert.equal(nodes(busy, has('data-ui-tour-next'))[0].props['aria-disabled'], 'true');
  const live = [], idle = render({ onNext: () => live.push('next'), onBack: () => live.push('back') });
  nodes(idle, has('data-ui-tour-next'))[0].props.onClick({}); nodes(idle, has('data-ui-tour-back'))[0].props.onClick({}); assert.deepEqual(live, ['next', 'back']);
});

// A minimal hooks harness: state and refs persist per call position, effects run after a render and clean up before they re-run.
function harness(build) {
  const slots = []; let cursor = 0; const pending = [];
  const hooks = {
    useState(initial) { const slot = slots[cursor++] ??= { value: typeof initial === 'function' ? initial() : initial }; return [slot.value, next => { slot.value = typeof next === 'function' ? next(slot.value) : next; }]; },
    useRef(initial) { return (slots[cursor++] ??= { ref: { current: initial } }).ref; },
    useEffect(callback, dependencies) { const slot = slots[cursor++] ??= {}; if (!slot.dependencies || !dependencies || dependencies.some((value, index) => !Object.is(value, slot.dependencies[index]))) { slot.dependencies = dependencies; pending.push(() => { slot.cleanup?.(); slot.cleanup = callback(); }); } },
  };
  const component = build(hooks);
  return { render(props) { cursor = 0; const tree = component(props); while (pending.length) pending.shift()(); return tree; }, unmount() { for (const slot of slots) slot?.cleanup?.(); } };
}
const labelsEn = tourLabels('en');
const entryHarness = (controller, name, locale = 'en') => harness(hooks => createTourEntry({ h, ...hooks, useLocale: () => locale, controller })[name]);

test('checklist block: starts the Antidetect tour with the clicked button as invoker; Resume and Start over appear when interrupted', () => {
  const controller = createTourController({ storage: memory({ initial: { [TOUR_STORAGE_KEY]: one('antidetect', false, 3) } }) });
  const view = entryHarness(controller, 'TourStart'), invoker = { id: 'clicked' };
  const checklist = view.render({ variant: 'checklist' });
  assert.equal(checklist.props['data-ui-tour-entry'], 'checklist');
  const buttons = nodes(checklist, node => node.type === 'button');
  assert.deepEqual(buttons.map(textOf), [labelsEn.resume, labelsEn.restart], 'interrupted: Resume, then Start over');
  assert.equal(textOf(nodes(checklist, node => node.props.class === 'ui-tour-entry__hint')[0]), fillTourText(labelsEn.resume_hint, { n: 4, total: TOURS.antidetect.length }));
  assert.equal(buttons[0].props['data-ui-tour-start'], 'checklist'); assert.equal(buttons[0].props['data-tour-for'], 'antidetect'); assert.equal(buttons[0].props['aria-haspopup'], 'dialog'); assert.equal(buttons[0].props.type, 'button');
  buttons[0].props.onClick({ currentTarget: invoker });
  assert.deepEqual([controller.getSnapshot().running, controller.getSnapshot().tour, controller.getSnapshot().index, controller.getSnapshot().invoker], [true, 'antidetect', 3, invoker], 'Resume continues at the stored step and remembers the invoker');
  controller.close('esc');
  const again = nodes(view.render({ variant: 'checklist' }), node => node.type === 'button');
  again[1].props.onClick({ currentTarget: invoker });
  assert.deepEqual([controller.getSnapshot().running, controller.getSnapshot().index], [true, 0], 'Start over begins at step 1');
  controller.close('esc');
  const afterwards = view.render({ variant: 'checklist' });
  assert.deepEqual(nodes(afterwards, node => node.type === 'button').map(textOf), [labelsEn.start], 'starting over forgot the old step: one button again');
  assert.equal(textOf(nodes(afterwards, node => node.props.class === 'ui-tour-entry__hint')[0]), labelsEn.entry_hint);
  assert.equal(view.render({ tour: 'nope' }), null, 'an unknown tour draws nothing');
  assert.doesNotThrow(() => nodes(afterwards, node => node.type === 'button')[0].props.onClick(undefined), 'a click without an event never throws');
  view.unmount();
});

test('header button: drawn only on a page with a tour layer, one compact button per section, starts or resumes that section tour with the clicked button as invoker', () => {
  const controller = createTourController({ storage: memory({ initial: { [TOUR_STORAGE_KEY]: state({ proxy: { completed: false, lastStep: 2 }, cookies: { completed: true, lastStep: 0 } }) } }) });
  const view = entryHarness(controller, 'TourButton'), invoker = { id: 'header-button' };
  assert.equal(view.render({ tour: 'hub' }), null, 'no tour layer on this page (the standalone API page): no button');
  controller.provide();
  const hub = view.render({ tour: 'hub' });
  assert.equal(hub.type, 'button'); assert.equal(hub.props.type, 'button'); assert.match(hub.props.class, /(?:^|\s)button(?:\s|$)/u); assert.match(hub.props.class, /workspace-tool workspace-tool--tour/u);
  assert.equal(hub.props['data-ui-tour-start'], 'header'); assert.equal(hub.props['data-tour-for'], 'hub'); assert.equal(hub.props['aria-haspopup'], 'dialog'); assert.equal(hub.props['data-ui-tour-resumable'], undefined);
  assert.equal(hub.props.title, labelsEn.tour_tip, 'the tooltip says what the button does');
  assert.deepEqual(nodes(hub, node => node.type === 'span').map(textOf), [labelsEn.tour_label], 'icon and one short label; the name of the button is its label');
  assert.equal(nodes(hub, node => node.type === 'svg').length, 1); assert.equal(nodes(hub, node => node.type === 'svg')[0].props['aria-hidden'], 'true');
  assert.equal(hub.props['aria-label'], undefined, 'the visible label names the button (and stays in the accessibility tree when it is hidden for lack of room)');
  assert.ok(labelsEn.tour_label.length <= 12);
  hub.props.onClick({ currentTarget: invoker });
  assert.deepEqual([controller.getSnapshot().running, controller.getSnapshot().tour, controller.getSnapshot().index, controller.getSnapshot().invoker], [true, 'hub', 0, invoker]); controller.close('esc');
  const proxy = view.render({ tour: 'proxy' });
  assert.equal(proxy.props['data-ui-tour-resumable'], 'true'); assert.equal(proxy.props.title, fillTourText(labelsEn.tour_tip_resume, { n: 3, total: TOURS.proxy.length }), 'an interrupted tour says where it stopped');
  proxy.props.onClick({ currentTarget: invoker }); assert.deepEqual([controller.getSnapshot().tour, controller.getSnapshot().index], ['proxy', 2], 'it resumes at the stored step'); controller.close('esc');
  const cookies = view.render({ tour: 'cookies' }); assert.equal(cookies.props['data-ui-tour-resumable'], undefined, 'a finished tour starts again from the first step'); cookies.props.onClick({ currentTarget: invoker }); assert.equal(controller.getSnapshot().index, 0); controller.close('esc');
  assert.equal(view.render({ tour: 'nope' }), null); assert.equal(view.render({ tour: 'constructor' }), null);
  assert.equal(view.render({ tour: 'hub', className: 'workspace-tool--float' }).props.class.endsWith(' workspace-tool--float'), true);
  assert.equal(entryHarness(controller, 'TourButton', 'ru').render({ tour: 'hub' }).props.title, tourLabels('ru').tour_tip, 'the language of the page');
  assert.doesNotThrow(() => view.render({ tour: 'hub' }).props.onClick(undefined), 'a click without an event never throws');
  const running = view.render({ tour: 'hub' }); controller.start({ tour: 'proxy' }); controller.presented(1);
  assert.equal(view.render({ tour: 'proxy' }).props['data-ui-tour-resumable'], undefined, 'while a run is open the button offers a plain start');
  view.unmount(); assert.ok(running);
});

test('Firewall launcher slot (ADR-111): the shell hands a maker, not a vnode; the module builds the Tour button of the section with ITS h and hooks and the language of the page', () => {
  // The Firewall header is drawn by another copy of Preact, where this page's hooks cannot run. `kit` stands for that copy: its own h (every vnode is tagged), its own hooks (counted), its own language.
  const controller = createTourController({ storage: memory({ initial: { [TOUR_STORAGE_KEY]: state({ firewall: { completed: false, lastStep: 1 } }) } }) });
  controller.provide();
  const made = [], used = { state: 0, effect: 0 }, invoker = { id: 'launcher-button' };
  const kitH = (type, props, ...rest) => { const vnode = h(type, props, ...rest); made.push(vnode); return vnode; };
  const mount = (tour, locale = 'en') => harness(hooks => {
    const kit = { h: kitH, useState: (...args) => { used.state++; return hooks.useState(...args); }, useEffect: (...args) => { used.effect++; return hooks.useEffect(...args); }, useLocale: () => locale };
    const Tool = tourToolSlot(tour, controller)(kit);
    // What the module's Preact does with the component it was handed: render it, then render the vnode it returned.
    return () => { const vnode = Tool(); return { vnode, button: typeof vnode.type === 'function' ? vnode.type(vnode.props) : null }; };
  });
  const view = mount('firewall'), { vnode, button } = view.render();
  assert.equal(typeof tourToolSlot('firewall'), 'function', 'a maker...'); assert.equal(tourToolSlot('firewall').length, 1, '...of one argument: the kit');
  assert.deepEqual(vnode.props, { tour: 'firewall' }, 'the component draws the Tour button of the Firewall section and nothing else');
  assert.equal(button.type, 'button'); assert.equal(button.props['data-ui-tour-start'], 'header'); assert.equal(button.props['data-tour-for'], 'firewall'); assert.equal(button.props['aria-haspopup'], 'dialog'); assert.equal(button.props.type, 'button');
  assert.match(button.props.class, /(?:^|\s)button workspace-tool workspace-tool--tour$/u, 'the markup of every other header');
  assert.equal(button.props['data-ui-tour-resumable'], 'true'); assert.equal(button.props.title, fillTourText(labelsEn.tour_tip_resume, { n: 2, total: TOURS.firewall.length }), 'it says where the Firewall tour stopped');
  assert.deepEqual(nodes(button, node => node.type === 'span').map(textOf), [labelsEn.tour_label]); assert.equal(button.props['aria-label'], undefined, 'the visible label names it');
  const drawn = nodes(button); assert.ok(drawn.length >= 3 && drawn.every(node => made.includes(node)), 'every node (button, glyph, label) was built by the kit\'s h, none by the page\'s Preact');
  assert.ok(used.state >= 1 && used.effect >= 1, 'and the button keeps its state with the kit\'s hooks (' + JSON.stringify(used) + ')');
  button.props.onClick({ currentTarget: invoker });
  assert.deepEqual([controller.getSnapshot().running, controller.getSnapshot().tour, controller.getSnapshot().index, controller.getSnapshot().invoker], [true, 'firewall', 1, invoker], 'a click resumes that tour at the stored step with the clicked button as invoker'); controller.close('esc');
  assert.equal(mount('firewall', 'ru').render().button.props.title, fillTourText(tourLabels('ru').tour_tip_resume, { n: 2, total: TOURS.firewall.length }), 'the language is the one the module passes in');
  assert.equal(mount('nope').render().button, null, 'an unknown tour draws nothing');
  const first = tourToolSlot('firewall', controller)({ h, useState: () => [null, () => {}], useEffect() {}, useLocale: () => 'en' }), second = tourToolSlot('firewall', controller)({ h, useState: () => [null, () => {}], useEffect() {}, useLocale: () => 'en' });
  assert.notEqual(first, second, 'each call of the maker builds its own component (the launcher builds it once per maker)');
  view.unmount();
});

test('palette commands: one per tour, registered while the layer is mounted, start or resume by state, silent while a run is open, gone after unmount', () => {
  assert.ok(PALETTE_COMMAND_KINDS.includes('start-tour') && PALETTE_COMMAND_KINDS.includes('resume-tour'));
  const controller = createTourController({ storage: memory() }), mine = () => collectPaletteCommands().filter(command => command.source === 'ui-tour');
  const rendered = harness(hooks => createTourUi({ h, ...hooks, useLocale: () => 'en', controller }).TourLayer);
  assert.equal(controller.getSnapshot().available, true, 'creating the layer marks the page as one that can run a tour');
  assert.equal(rendered.render({}), null, 'nothing is drawn while no run is open');
  let listed = mine();
  assert.deepEqual(listed.map(command => command.id), TOUR_IDS.map(tour => 'ui-tour:start-tour:' + tour)); assert.deepEqual(listed.map(command => command.section), [...TOUR_IDS], 'each command knows its section');
  assert.ok(listed.every(command => command.kind === 'start-tour' && Object.isFrozen(command)));
  listed.find(command => command.section === 'detector').run(); assert.deepEqual([controller.getSnapshot().running, controller.getSnapshot().tour], [true, 'detector'], 'running the command starts that tour');
  assert.deepEqual(mine(), [], 'while a run is open the commands are not offered');
  controller.presented(2); controller.close('skip');
  listed = mine(); assert.deepEqual(listed.filter(command => command.kind === 'resume-tour').map(command => command.section), ['detector'], 'only the interrupted tour offers a resume');
  assert.equal(listed.filter(command => command.kind === 'start-tour').length, TOUR_IDS.length - 1);
  listed.find(command => command.kind === 'resume-tour').run(); assert.equal(controller.getSnapshot().index, 2, 'the resume command continues at the stored step');
  controller.close('esc');
  rendered.unmount();
  assert.deepEqual(mine(), [], 'unmounting removes the commands');
});

test('layer cleanup: closing the page while a run is open removes every listener it added and ends the run', () => {
  const added = [], removed = [], had = ['addEventListener', 'removeEventListener'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  globalThis.addEventListener = (type, handler, options) => added.push([type, handler, options]); globalThis.removeEventListener = (type, handler, options) => removed.push([type, handler, options]);
  const controller = createTourController({ storage: memory() });
  try {
    controller.start({ tour: 'proxy' });
    const rendered = harness(hooks => createTourUi({ h, ...hooks, useLocale: () => 'en', controller }).TourLayer);
    rendered.render({});
    assert.deepEqual([...new Set(added.map(entry => entry[0]))].sort(), ['keydown', 'storage'], 'a running layer listens to keys, and the controller to other windows');
    assert.equal(added.find(entry => entry[0] === 'keydown')[2], true, 'keys are taken in the capture phase, before the page');
    rendered.unmount();
    const byType = list => list.map(entry => entry[0]).sort(); assert.deepEqual(byType(removed), byType(added), 'every listener added is removed');
    for (const [type, handler] of added) assert.ok(removed.some(entry => entry[0] === type && entry[1] === handler), 'the same handler is removed: ' + type);
    assert.equal(controller.getSnapshot().running, false, 'unmounting ends the run');
  } finally { for (const [name, descriptor] of had) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } }
});

test('palette entries: a tour command per section with a localized label, the group of its section, English search words; the tour of the section on screen comes first', () => {
  const calls = [], commands = [
    { id: 'ui-tour:start-tour:hub', source: 'ui-tour', kind: 'start-tour', name: null, section: 'hub', run: () => calls.push('hub') },
    { id: 'ui-tour:resume-tour:proxy', source: 'ui-tour', kind: 'resume-tour', name: null, section: 'proxy', run: () => { throw Error('gone'); } },
    { id: 'ui-tour:start-tour:browser-debug', source: 'ui-tour', kind: 'start-tour', name: null, section: 'browser-debug', run: () => calls.push('debug') },
    { id: 'ui-tour:start-tour:odd', source: 'ui-tour', kind: 'start-tour', name: null, section: 'no-such-section', run: () => calls.push('odd') },
    { id: 'ui-tour:start-tour:none', source: 'ui-tour', kind: 'start-tour', name: null, section: null, run: () => calls.push('none') }];
  const build = currentSection => buildPaletteEntries({ h: (type, props) => ({ type, props }), icon: section => ({ section }), locale: 'ru', labels: redesignLabels('ru'), sectionLabel: section => 'section:' + section, translate: key => 'tr:' + key,
    groupLabel: section => 'group:' + section, choose: section => calls.push(['choose', section]), openAntidetect: level => calls.push(['antidetect', level]), openPrecursor: () => {}, commands, currentSection });
  const tours = entries => entries.filter(entry => entry.id.startsWith('ui-tour:'));
  const [hub, proxy, debug, odd, none] = tours(build(null));
  assert.deepEqual([hub.label, proxy.label, debug.label], [tourLabels('ru').start, tourLabels('ru').resume, tourLabels('ru').start], 'the labels come from the tour module, in the language of the page, not from the shared catalogue');
  assert.deepEqual([hub.group, proxy.group, debug.group], ['section:hub', 'section:proxy', 'section:browser-debug'], 'each command sits in the group of its own section');
  assert.deepEqual([hub.icon, proxy.icon, debug.icon], [{ section: 'hub' }, { section: 'proxy' }, { section: 'browser-debug' }]);
  for (const [entry, section] of [[hub, 'hub'], [proxy, 'proxy'], [debug, 'browser-debug']]) { assert.match(entry.keywords, /\btour\b/u); assert.ok(entry.keywords.includes(MANAGEMENT_SECTION_ENGLISH[section]), section + ': the English name of the section helps search'); }
  assert.deepEqual([odd.group, none.group], ['section:antidetect', 'section:antidetect'], 'a command without a known section keeps the round-5 home, Antidetect');
  assert.equal(TOUR_PALETTE_KEYWORDS, 'tour guide tutorial walkthrough help onboarding');
  assert.deepEqual(tours(build('proxy')).map(entry => entry.id).slice(0, 2), ['ui-tour:resume-tour:proxy', 'ui-tour:start-tour:hub'], 'the tour of the section on screen is listed first, the others keep their order');
  assert.deepEqual(tours(build('browser-debug')).map(entry => entry.id)[0], 'ui-tour:start-tour:browser-debug');
  hub.run(); assert.doesNotThrow(() => proxy.run());
  assert.deepEqual(calls, ['hub'], 'the tour navigates by itself: no level is opened first');
});

// ---- copy: all 21 languages -----------------------------------------------------------------------------------------------------------
const HONEST_COPY = [/\binvisib/iu, /\bundetectab/iu, /\banonym/iu, /\bbypass/iu, /\bstealth/iu, /(?<![\d.,])100\s?%/u, /\bguarant/iu, /\blegitimat/iu,
  /(?<!\p{L})невидим/iu, /(?<!\p{L})необнаружим/iu, /(?<!\p{L})анонимн/iu, /(?<!\p{L})обход/iu, /(?<!\p{L})гарантир/iu, /(?<!\p{L})легитимн/iu];
const ENGLISH_WORDS = /\b(?:the|and|your|with|this|that|you|are|not|can|for|from|until|when|each|every)\b/iu;
const SCRIPTS = { ru: /\p{Script=Cyrillic}/u, uk: /\p{Script=Cyrillic}/u, zh_CN: /\p{Script=Han}/u, yue: /\p{Script=Han}/u, wuu: /\p{Script=Han}/u, ar: /\p{Script=Arabic}/u, ur: /\p{Script=Arabic}/u, hi: /\p{Script=Devanagari}/u, mr: /\p{Script=Devanagari}/u,
  te: /\p{Script=Telugu}/u, ta: /\p{Script=Tamil}/u, ja: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u, ko: /\p{Script=Hangul}/u };
const INDIC_OR_PERSIAN = ['te', 'ta', 'hi', 'mr', 'ur', 'ar'];
// Titles that are product names and so stay in Latin letters in every language.
const NAME_TITLES = new Set(['step_integrations-precursor_title', 'step_integrations-geo_title', 'step_settings-debug_title']);
const PRODUCT_WORDS = /\b(?:Antidetect|API Guard|API|Autosurfer|Firewall|Detector|Proxy|Browser Debug|Cloudflare Precursor|Geolocation API|JSON|CSV|PRO|HTTPS?|SOCKS5|VLESS|OpenVPN|Chrome|Firefox|GitHub|TLS|IP|Workers|cookies?|click|companion)\b/gu;

// The completeness check the shared pipeline used to run at build time lives with the tests; the module itself ships data only.
const labelProblems = (labels = TOUR_LABELS, locales = null) => {
  const problems = [];
  for (const locale of locales ?? Object.keys(labels)) {
    const row = labels[locale];
    if (!row || typeof row !== 'object') { problems.push(locale + ': missing'); continue; }
    for (const key of TOUR_LABEL_KEYS) if (typeof row[key] !== 'string' || row[key] === '' || row[key] !== row[key].trim()) problems.push(locale + '.' + key + ': missing or not trimmed');
    for (const key of Object.keys(row)) if (!TOUR_LABEL_KEYS.includes(key)) problems.push(locale + '.' + key + ': unknown key');
  }
  return problems;
};

test('tour copy: all 21 languages carry every key, trimmed, one frozen table per production language in the production order', () => {
  const ids = PRODUCTION_LANGUAGES.map(language => language.id);
  assert.equal(ids.length, 21); assert.deepEqual(Object.keys(TOUR_LABELS), ids);
  assert.deepEqual(labelProblems(), []);
  assert.equal(TOUR_LABEL_KEYS.length, COMMON_KEYS.length + 2 * TOUR_STEP_IDS.length); assert.equal(TOUR_LABEL_KEYS.length, 115); assert.equal(new Set(TOUR_LABEL_KEYS).size, TOUR_LABEL_KEYS.length); assert.deepEqual(TOUR_LABEL_KEYS.slice(0, COMMON_KEYS.length), COMMON_KEYS);
  assert.ok(Object.isFrozen(TOUR_LABELS) && Object.isFrozen(TOUR_LABELS.en) && Object.isFrozen(TOUR_LABEL_KEYS) && Object.isFrozen(TOUR_STEP_IDS));
  for (const locale of ids) assert.deepEqual(Object.keys(TOUR_LABELS[locale]), [...TOUR_LABEL_KEYS], locale);
  // The accessor takes an id, a variant or { id }, falls back to English, and never resolves an inherited name.
  assert.equal(tourLabels('pt-BR'), TOUR_LABELS.pt_BR); assert.equal(tourLabels({ id: 'de' }), TOUR_LABELS.de); assert.equal(tourLabels('de-AT'), TOUR_LABELS.de);
  assert.equal(tourLabels('xx'), TOUR_LABELS.en); assert.equal(tourLabels(undefined), TOUR_LABELS.en); assert.equal(tourLabels(5), TOUR_LABELS.en); assert.equal(tourLabels('constructor'), TOUR_LABELS.en);
  const broken = structuredClone(TOUR_LABELS); delete broken.de.back; broken.fr.next = ' x'; broken.es.extra = 'x';
  assert.deepEqual(labelProblems(broken, ['de', 'fr', 'es', 'xx']), ['de.back: missing or not trimmed', 'fr.next: missing or not trimmed', 'es.extra: unknown key', 'xx: missing']);
});

test('tour copy: placeholders only where they belong, no "$" substitution, no hidden direction or zero-width characters (ZWNJ/ZWJ only in Indic or Arabic-script words), no straight quotes', () => {
  const holders = { step_label: ['{n}', '{total}'], resume_hint: ['{n}', '{total}'], tour_tip_resume: ['{n}', '{total}'], skipped: ['{title}'] };
  const hidden = /[؜​‎‏‪-‮⁦-⁩﻿­]/u;
  for (const [locale, row] of Object.entries(TOUR_LABELS)) {
    for (const field of TOUR_LABEL_KEYS) {
      const text = row[field], found = [...text.matchAll(/\{[^}]*\}/gu)].map(match => match[0]).sort();
      assert.deepEqual(found, (holders[field] ?? []).slice().sort(), locale + '.' + field + ': placeholders');
      assert.doesNotMatch(text, /[$\\'"]/u, locale + '.' + field + ': no $, backslash or straight quote (the module is single-quoted data)'); assert.doesNotMatch(text, hidden, locale + '.' + field + ': no hidden characters');
      if (/[‌‍]/u.test(text)) assert.ok(INDIC_OR_PERSIAN.includes(locale), locale + '.' + field + ': ZWNJ/ZWJ outside Indic or Arabic script');
      assert.doesNotMatch(text, /[\u0000-\u001F\u007F-\u009F]/u, locale + '.' + field + ': no control characters'); assert.ok(text.length <= 420, locale + '.' + field + ' is ' + text.length + ' characters');
    }
    assert.ok(row.tour_label.length <= 12, locale + ': the header label is short (' + row.tour_label.length + ')');
    // A whole announcement (step label, title, text) fits the live-region limit, with room for one skip note.
    for (const id of TOUR_STEP_IDS) assert.ok([row.step_label, row['step_' + id + '_title'], row['step_' + id + '_body']].join('. ').length + 70 <= 512, locale + ':' + id + ' fits one announcement');
  }
});

test('tour copy honesty: no promise of invisibility, anonymity, bypassing, stealth or 100 %, no "legitimate", in any language; the limits are named', () => {
  const hits = [];
  for (const [locale, row] of Object.entries(TOUR_LABELS)) for (const field of TOUR_LABEL_KEYS) for (const pattern of HONEST_COPY) if (pattern.test(row[field])) hits.push(locale + '.' + field + ' ' + pattern);
  assert.deepEqual(hits, []);
  // The finish step says what is NOT covered, the Region step says the IP address does not change, in every language.
  for (const [locale, row] of Object.entries(TOUR_LABELS)) {
    assert.match(row.step_finish_body, /TLS/u, locale + ': the limits are named'); assert.match(row.step_finish_body, /Workers/u, locale); assert.match(row.step_finish_body, /IP/u, locale); assert.match(row.step_region_body, /IP/u, locale + ': the IP statement');
  }
});

test('tour copy is really translated: no English left in other languages, each in its own script, product names kept, no two languages share a text', () => {
  const english = TOUR_LABELS.en;
  for (const [locale, row] of Object.entries(TOUR_LABELS)) {
    if (locale === 'en') continue;
    for (const field of TOUR_LABEL_KEYS) {
      if (NAME_TITLES.has(field)) { assert.equal(row[field], english[field], locale + ': ' + field + ' is a product name and keeps it'); continue; }
      // The only words spelled like the English ones in their language: "Region" in German and Polish.
      if (!(field === 'step_region_title' && ['de', 'pl'].includes(locale))) assert.notEqual(row[field], english[field], locale + '.' + field + ' is English');
      const words = row[field].replace(PRODUCT_WORDS, '');
      assert.doesNotMatch(words, ENGLISH_WORDS, locale + '.' + field + ' contains English words');
      if (SCRIPTS[locale]) assert.match(row[field], SCRIPTS[locale], locale + '.' + field + ' is not in the language script');
    }
  }
  for (const field of TOUR_LABEL_KEYS.filter(name => name.endsWith('_body') || name === 'entry_hint')) {
    const seen = new Map();
    for (const [locale, row] of Object.entries(TOUR_LABELS)) { assert.ok(!seen.has(row[field]), field + ': ' + locale + ' repeats ' + seen.get(row[field])); seen.set(row[field], locale); }
  }
});

test('copy keys: the module uses exactly the keys of the labels module, no more and no fewer, and no visible English is typed in it', () => {
  const code = stripComments(read('ui-tour.js'));
  const direct = [...code.matchAll(/\btext\('([a-z_]+)'\)/gu)].map(match => match[1]), viaLabels = [...code.matchAll(/\blabels\.([a-z_]+)/gu)].map(match => match[1]).filter(key => TOUR_LABEL_KEYS.includes(key));
  const viaSteps = TOUR_STEP_IDS.flatMap(id => ['title', 'body'].map(part => tourStepKey(id, part)));
  assert.match(code, /tourStepKey\(id, 'title'\)/u); assert.match(code, /tourStepKey\(id, 'body'\)/u);
  const used = new Set([...direct, ...viaLabels, ...viaSteps]);
  for (const key of used) assert.ok(TOUR_LABEL_KEYS.includes(key), 'used but not authored: ' + key);
  for (const field of TOUR_LABEL_KEYS) assert.ok(used.has(field), 'authored but never used: ' + field);
  for (const key of ['tour_label', 'tour_tip', 'tour_tip_resume']) assert.ok(code.includes('labels.' + key), key + ' in the header button');
  const management = stripComments(read('management-ui.js')), antidetect = stripComments(read('antidetect-ui.js'));
  for (const key of ['start', 'resume']) { assert.ok(TOUR_LABEL_KEYS.includes(key)); assert.ok(management.includes("'" + key + "'"), key + ' in the palette'); }
  assert.ok(management.includes('tourLabels(locale)[PALETTE_TOUR_LABEL[command.kind]]'), 'the palette label comes from the tour labels'); assert.ok(!management.includes("'tour_"), 'no tour key of the shared catalogue');
  assert.ok(!code.includes('translate'), 'the tour never asks the shared catalogue');
  assert.ok(antidetect.includes('createTourEntry({ h, useState, useEffect, useLocale })'), 'the checklist entry reads its labels from the tour module');
  // No sentence typed into the module: a literal that starts like English prose, or runs to many words, would be a hard-coded label.
  const literals = [...code.matchAll(/'((?:[^'\\\n]|\\.)*)'/gu)].map(match => match[1]).filter(value => /^[A-Z][a-z]+(?: [A-Za-z]+)+/u.test(value) || /^[A-Za-z]+(?: [A-Za-z]+){7,}$/u.test(value));
  assert.deepEqual(literals, []);
  assert.equal(code.split(TOUR_PALETTE_KEYWORDS).length - 1, 1, 'the palette search words appear once, as a constant, and are never rendered');
});

// ---- boundaries ---------------------------------------------------------------------------------------------------------------------
test('layer timers are bounded: one slow re-measure tick per shown step, cleared together with its listeners', () => {
  const code = stripComments(read('ui-tour.js'));
  assert.ok(TOUR_TICK_MS >= 250 && TOUR_TICK_MS <= 1000, 'a slow tick, not a busy loop');
  assert.equal(code.split('setInterval(').length - 1, 1); assert.equal(code.split('clearInterval(').length - 1, 1);
  assert.match(code, /clearInterval\(slowTick\); for \(const stop of listeners\) stop\(\)/u);
});

test('the tour module changes no setting: no extension API, message, network, markup injection or second storage; it stores only its own progress', () => {
  const code = stripComments(read('ui-tour.js'));
  for (const banned of ['chrome.', 'browser.', 'sendMessage', 'fetch(', 'XMLHttpRequest', 'WebSocket', 'innerHTML', 'outerHTML', 'insertAdjacentHTML', 'eval(', 'new Function', 'sessionStorage', 'indexedDB', 'storage.local', 'storage.session', 'permissions', 'declarativeNetRequest', 'tabs.', 'runtime.', 'console.']) assert.ok(!code.includes(banned), banned);
  assert.equal(code.split('localStorage').length - 1, 1, 'localStorage is reached in exactly one place (defaultStorage)');
  assert.ok(code.includes("'ui-tour:v2'") && code.includes("'ui-tour:v1'"));
  const imports = [...code.matchAll(/^import .* from '([^']+)';$/gmu)].map(match => match[1]); assert.deepEqual(imports, ['./ui-announcer.js', './ui-shortcuts.js', './ui-tour-labels.js', './ui-tour-steps.js', './workspace-tool-icons.js']);
  // The registry and the glyphs are data: no import, no extension API, no network, no storage.
  for (const name of ['ui-tour-steps.js', 'workspace-tool-icons.js']) {
    const data = stripComments(read(name)); assert.deepEqual([...data.matchAll(/^import /gmu)], [], name + ': no imports');
    for (const banned of ['chrome.', 'browser.', 'fetch(', 'localStorage', 'sessionStorage', 'indexedDB', 'document', 'window', 'innerHTML', 'eval(']) assert.ok(!data.includes(banned), name + ': ' + banned);
  }
  // Entry points: the checklist block, the header button of every section, the Antidetect level request that can leave focus alone; the layer is mounted once.
  const antidetect = read('antidetect-ui.js'), management = read('management-ui.js');
  assert.match(antidetect, /h\(TourStart, \{ variant: 'checklist' \}\)/u); assert.doesNotMatch(antidetect, /variant: 'link'/u, 'the link beside Refresh is gone');
  assert.match(antidetect, /if \(request\.focus === false\) return;/u); assert.match(antidetect, /'data-tour': 'levels'/u); assert.match(antidetect, /'data-tour': 'master'/u);
  assert.equal(management.split('h(TourLayer,').length - 1, 1); assert.match(management, /setAntidetectRequest\(\{ level: view\.level, focus: false \}\)/u);
  const html = read('options.html'), links = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)" \/>/gu)].map(match => match[1]);
  assert.equal(links.filter(link => link === 'ui-tour.css').length, 1);
  assert.ok(links.indexOf('ui-tour.css') > links.indexOf('proxy-ui.css') && links.indexOf('ui-tour.css') < links.indexOf('button-surfaces.css'), 'module styles stay before button-surfaces.css and protect.css');
});

test('every section header carries the shared Tour button; the strips under the headers are gone', () => {
  const wiring = {
    hub: ['management-hub.js', /h\(TourButton, \{ tour: 'hub' \}\)/u], detector: ['detector-ui.js', /h\(TourButton,\{tour:'detector'\}\)/u], firewall: ['management-ui.js', /const firewallTourSlot = tourToolSlot\('firewall'\);/u],
    integrations: ['management-ui.js', /titleRow\('integrations'/u], settings: ['management-ui.js', /titleRow\('settings'/u], contacts: ['contacts-ui.js', /h\(TourButton, \{ tour: 'contacts' \}\)/u], 'browser-debug': ['browser-debug-ui.js', /h\(TourButton, \{ tour: 'browser-debug' \}\)/u],
  };
  const MASTER_HEADERS = { api: 'api-configuration-ui.js', antidetect: 'antidetect-ui.js', autosurf: 'autosurf-ui.js', proxy: 'proxy-ui.js' };
  for (const [tour, [file, pattern]] of Object.entries(wiring)) assert.match(read(file), pattern, tour + ' in ' + file);
  const controls = read('workspace-controls-ui.js'), management = read('management-ui.js');
  assert.match(controls, /const TourButton = tour \? own \?\? readTourButton\(\) : null;/u, 'a master header takes the button the shell registered (or its caller\'s own) when it is drawn');
  assert.match(controls, /\[tools, TourButton \? h\(TourButton, \{ tour: id \}\) : null, control, /u, 'the cluster order: tools, then the Tour button, then the module switch, and a master header draws the button of its own section by itself');
  assert.deepEqual([...stripComments(controls).matchAll(/^import .* from '([^']+)';$/gmu)].map(match => match[1]), ['./ui-tour-slot.js', './workspace-tool-icons.js'], 'the master header does not import the tour');
  for (const [tour, file] of Object.entries(MASTER_HEADERS)) {
    const code = read(file); assert.match(code, new RegExp("WorkspaceMaster\\(\\{ id: '" + tour + "'", 'u'), tour + ' draws its header with WorkspaceMaster');
    assert.match(code, /createWorkspaceControlsUi\(\{ h \}\)/u, file + ': the master header needs nothing from the tour, the shell\'s button is read from the slot');
  }
  assert.deepEqual([...Object.keys(wiring), ...Object.keys(MASTER_HEADERS), 'cookies'].sort(), [...TOUR_IDS].sort(), 'every tour is accounted for');
  // Cookies: the shell hands the header the shared button as `tourButton`; cookies-ui.js draws it last in the header actions (the right end of a header without a switch).
  assert.match(management, /const \{ TourButton \} = createTourEntry\(\{ h, useState, useEffect, useLocale \}\);\n[^\n]*\n  provideTourButton\(TourButton\);/u, 'the shell registers its button for the headers built for other pages too (the master header, the Detector)');
  assert.match(read('detector-ui.js'), /const TourButton = readTourButton\(\);/u, 'the Detector header reads the shell\'s button'); assert.doesNotMatch(read('detector-ui.js'), /ui-tour\.js/u, 'and does not import the tour');
  assert.match(management, /h\(CookiesApp, \{ active: selected === 'cookies', tourButton: h\(TourButton, \{ tour: 'cookies' \}\) \}\)/u, 'the shell passes the Cookies tour button');
  // Firewall: the module draws the header, so the shell hands its launcher a maker (`toolSlot`) and draws no neighbouring button; the launcher puts the button between the title and the switch.
  assert.match(management, /children:hasFirewall\?h\(ProtectIsland,\{surface:'launcher',toolSlot:firewallTourSlot\}\):h\(UnavailableFirewallLauncher,\{\}\)\}\)/u, 'the Firewall header gives the launcher its Tour button (and, where the module does not exist, draws none)');
  assert.doesNotMatch(management, /h\(TourButton,\s*\{\s*tour:\s*'firewall'\s*\}\)/u, 'no Firewall button beside the launcher: it would come after the switch in the Tab order');
  assert.equal(management.split('toolSlot:').length - 1, 1, 'only the Firewall header hands the module a slot');
  assert.match(management, /import \{ createTourUi, createTourEntry, tourToolSlot, TOUR_PALETTE_KEYWORDS \} from '\.\/ui-tour\.js';/u, 'the maker comes from the Options-only tour module');
  // Firefox has no Firewall module: neither a header button nor a palette command offers its tour there.
  assert.match(management, /collectPaletteCommands\(\)\.filter\(command => hasFirewall \|\| command\.section !== 'firewall' \|\| !Object\.hasOwn\(PALETTE_TOUR_LABEL, command\.kind\)\)/u, 'no Firewall tour command in the palette without the module');
  const cookies = read('cookies-ui.js'); assert.match(cookies, /function CookiesApp\(\{ active = true, tourButton = null \}\)/u, 'the Cookies workspace accepts the shell\'s button'); assert.match(cookies, /class: 'cookies-workspace-header', children: \[[^\n]*class: 'cookies-workspace-actions', children: \[[^\n]*tourButton\] \}\)\] \}\)/u, 'the Cookies header draws the button inside its actions, last');
  // The strip is gone everywhere: Refresh (Antidetect, Autosurfer) and Export (Proxy) are icon-only tools of the header cluster, with their old hooks.
  for (const file of ['antidetect-ui.js', 'autosurf-ui.js', 'proxy-ui.js', 'workspace-controls-ui.js', 'workspace-controls-ui.css', 'redesign.css']) assert.doesNotMatch(read(file), /workspace-secondary-actions/u, file);
  for (const [file, hook, icon] of [['antidetect-ui.js', 'data-antidetect-refresh', 'refresh'], ['autosurf-ui.js', 'data-autosurf-refresh', 'refresh'], ['proxy-ui.js', 'data-proxy-export', 'export']]) {
    const code = read(file); assert.ok(code.includes("ToolButton({ icon: '" + icon + "'"), file + ': an icon-only tool'); assert.ok(code.includes("'" + hook + "': true"), file + ': the hook ' + hook + ' is kept');
  }
});

test('the labels module is data only and Options-only: no import, no extension API, no network, and the shared locale pipeline and tables do not know the tour', () => {
  const code = stripComments(read('ui-tour-labels.js')).replace(/'[^']*'/gu, "''"); // the structure only: the texts are prose and may say "browser."
  assert.deepEqual([...code.matchAll(/^import /gmu)], [], 'no imports');
  for (const banned of ['chrome', 'browser', 'fetch', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'sessionStorage', 'indexedDB', 'eval', 'Function', 'document', 'window', 'globalThis']) assert.ok(!code.includes(banned), banned);
  assert.deepEqual([...code.matchAll(/^export (?:const|function) ([A-Za-z_]+)/gmu)].map(match => match[1]), ['TOUR_STEP_IDS', 'TOUR_LABEL_KEYS', 'TOUR_LABELS', 'tourLabels'], 'the accessor honest-copy.test.mjs looks for is tourLabels(locale)');
  assert.equal(tourLabels.length, 1);
  // Nothing in the shared catalogue: the service worker, popup, side panel and report keep their size.
  const pipeline = readFileSync(new URL('../production-locales.mjs', import.meta.url), 'utf8');
  assert.ok(!/tour/iu.test(pipeline), 'the locale pipeline has no tour wiring'); assert.equal(existsSync(new URL('../production-locales-tour.mjs', import.meta.url)), false, 'the old pipeline module is gone');
  assert.deepEqual(Object.keys(JSON.parse(read('_locales/en/messages.json'))).filter(key => key.startsWith('tour_')), [], 'no tour key in the shared English table');
});

// ---- who loads what -----------------------------------------------------------------------------------------------------------------
// The texts are 379 KB: only the Options page may load the tour engine, its registry and its texts. Every other page, worker and content script of the
// extension (popup, side panel, report, background, the settings pages) reaches at most the import-free slot module. A static import chain is
// followed the way the browser follows it; a dynamic import() is not a chain here (lint allows none beyond the reviewed Detector popup chunk).
const staticImports = name => [...read(name).matchAll(/^\s*(?:import|export)\s+(?:[\w*{},$\s]+?\s+from\s+)?["']\.\/([^"']+)["']/gmu)].map(match => match[1]);
const reachableFrom = entry => { const seen = new Map([[entry, null]]), queue = [entry]; while (queue.length) { const name = queue.shift(); if (!name.endsWith('.js')) continue; for (const next of staticImports(name)) if (!seen.has(next)) { seen.set(next, name); queue.push(next); } } return seen; };
const chainTo = (seen, name) => { const out = []; for (let at = name; at; at = seen.get(at)) out.push(at); return out.reverse().join(' > '); };
const TOUR_ENGINE_FILES = ['ui-tour.js', 'ui-tour-steps.js', 'ui-tour-labels.js'];

test('only the Options page loads the tour engine and its texts: popup, side panel, report, background and the other pages reach at most the import-free slot', () => {
  const directory = new URL('.', source);
  const pages = readdirSync(directory).filter(name => name.endsWith('.html')).flatMap(name => [...read(name).matchAll(/<script[^>]*\ssrc="([^"]+)"/gu)].map(match => match[1]));
  const entries = [...new Set([...pages, 'background.js', 'protect-sw.js', 'bridge.js'])].sort();
  for (const wanted of ['options.js', 'popup.js', 'sidepanel.js', 'report.js', 'background.js']) assert.ok(entries.includes(wanted), wanted + ' is an entry point that is checked');
  const problems = [];
  for (const entry of entries) {
    const seen = reachableFrom(entry);
    for (const name of TOUR_ENGINE_FILES) if (seen.has(name) !== (entry === 'options.js')) problems.push(entry + (entry === 'options.js' ? ' must reach ' + name : ' reaches ' + chainTo(seen, name)));
  }
  assert.deepEqual(problems, []);
  // The popup and the side panel do reach the headers that show the button, so the slot is what they see; nothing registers a button there.
  for (const entry of ['popup.js', 'sidepanel.js']) assert.ok(reachableFrom(entry).has('ui-tour-slot.js'), entry + ' reaches the slot');
  assert.ok(reachableFrom('options.js').has('ui-tour-slot.js'), 'the Options page reaches it too');
  assert.equal(reachableFrom('popup.js').has('management-ui.js'), false, 'the popup has no Options shell, so nothing there registers a button');
});

test('the slot module imports nothing and holds one component: no tour code, no extension API, no storage, no network', () => {
  const code = stripComments(read('ui-tour-slot.js'));
  assert.deepEqual([...code.matchAll(/^\s*import\b/gmu)], [], 'no imports');
  assert.deepEqual([...code.matchAll(/^export (?:const|function) ([A-Za-z_]+)/gmu)].map(match => match[1]), ['provideTourButton', 'readTourButton']);
  for (const banned of ['chrome', 'browser', 'fetch', 'localStorage', 'sessionStorage', 'indexedDB', 'document', 'window', 'globalThis', 'eval', 'Function(']) assert.ok(!code.includes(banned), banned);
  assert.equal(code.split('let ').length - 1, 1, 'one mutable cell');
});
