// ADR-113: the Inspector (popup, side panel, the Options Detector embed) says WHY a page it could not observe reads "paused" when the observation
// sensors were kept out of that page next to Antidetect. The patch is narrow and idempotent; the delivered view-model is executed, not read.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import { QUIET_UI_BUNDLES, HELPERS, HELPERS_ANCHOR, HELPERS_BEGIN, HELPERS_END, REPLACEMENTS, patchSensorQuietUi, syncSensorQuietUi } from '../production/sync-sensor-quiet-ui.mjs';
import { ANTIDETECT_QUIET_LABELS } from '../../apps/production-extension/antidetect-quiet-labels.js';

const directory = new URL('../../apps/production-extension/', import.meta.url);
const read = name => readFileSync(new URL(name, directory), 'utf8');
const count = (text, needle) => text.split(needle).length - 1;
const pristine = source => {
  let text = source;
  const begin = text.indexOf(HELPERS_BEGIN), end = text.indexOf(HELPERS_END, begin);
  text = text.slice(0, begin) + text.slice(end + HELPERS_END.length);
  for (const [from, to] of REPLACEMENTS) text = text.replace(to, () => from);
  return text;
};

for (const name of QUIET_UI_BUNDLES) {
  test(name + ': delivered patched, idempotent, and exactly the output of the patch over the unpatched bundle', () => {
    const source = read(name);
    assert.equal(patchSensorQuietUi(source, name), source, 'already synchronized');
    for (const [, to] of REPLACEMENTS) assert.equal(count(source, to), 1, 'one copy of each replacement');
    assert.equal(count(source, HELPERS_BEGIN), 1); assert.equal(count(source, HELPERS_END), 1);
    assert.ok(source.indexOf(HELPERS_ANCHOR) < source.indexOf(HELPERS_BEGIN), 'the block follows the ADR-103 helpers');
    const before = pristine(source);
    assert.notEqual(before, source); assert.equal(count(before, 'quietPausedLines'), 0); assert.equal(count(before, 'sensorsQuiet'), 0);
    assert.equal(patchSensorQuietUi(before, name), source, 'unpatched bundle + patch = delivered bundle');
    assert.equal(patchSensorQuietUi(patchSensorQuietUi(before, name), name), source, 'twice is the same');
  });

  test(name + ': a moved or duplicated anchor and damaged markers stop the patch instead of guessing; a hand-edited block is rewritten', () => {
    const source = read(name), before = pristine(source);
    for (const [from] of REPLACEMENTS) {
      assert.throws(() => patchSensorQuietUi(before.replace(from, () => 'x'), name), /anchor requires review/);
      assert.throws(() => patchSensorQuietUi(before + from, name), /anchor requires review/);
    }
    assert.throws(() => patchSensorQuietUi(before.replace(HELPERS_ANCHOR, () => ''), name), /helpers end marker requires review/);
    assert.throws(() => patchSensorQuietUi(source.replace(HELPERS_END, () => ''), name), /markers are damaged/);
    assert.equal(patchSensorQuietUi(source.replace('"paused_calls"', () => '"hacked"'), name), source, 'text inside the markers is rewritten from the script');
  });
}

test('syncing the real folder in check mode passes; the same check refuses a folder whose bundle is behind and a plain run repairs it', () => {
  assert.equal(syncSensorQuietUi({ check: true }), 2);
  const folder = mkdtempSync(join(tmpdir(), 'sensor-quiet-sync-'));
  try {
    writeFileSync(join(folder, 'antidetect-quiet-labels.js'), '// labels stand-in');
    for (const name of QUIET_UI_BUNDLES) writeFileSync(join(folder, name), pristine(read(name)));
    assert.throws(() => syncSensorQuietUi({ check: true, directory: folder }), /synchronization required/);
    assert.equal(syncSensorQuietUi({ directory: folder }), 2);
    for (const name of QUIET_UI_BUNDLES) assert.equal(readFileSync(join(folder, name), 'utf8'), read(name), name + ' repaired to the delivered bytes');
    assert.equal(syncSensorQuietUi({ check: true, directory: folder }), 2);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

// ---- execute the delivered view-model ---------------------------------------------------------------------------------------------------

function viewModel(name, locale = 'en') {
  const source = read(name);
  const from = source.indexOf('// packages/ui/src/view-models/coverage.ts'), to = source.indexOf('// packages/ui/src/view-models/techniques.ts', from);
  assert.ok(from > 0 && to > from, name + ': coverage view-model boundaries');
  const helpers = HELPERS.split('\n').filter(line => !line.startsWith('import ')).join('\n');
  const context = vm.createContext({ msg: (key, ...subs) => key + (subs.length ? '(' + subs.join('|') + ')' : ''), joinMessages: items => items.join(', '), uiLocale: () => locale,
    antidetectQuietLabels: value => ANTIDETECT_QUIET_LABELS[value] ?? ANTIDETECT_QUIET_LABELS.en });
  vm.runInContext(helpers + '\n' + source.slice(from, to) + '\nglobalThis.coverageView = coverageView;', context);
  const inputFrom = source.indexOf('function coverageInputOf(session) {'), inputTo = source.indexOf('\n}\n', inputFrom) + 3;
  vm.runInContext(source.slice(inputFrom, inputTo) + '\nglobalThis.coverageInputOf = coverageInputOf;', context);
  return context;
}
const report = (state, flags = []) => ({ coverageState: state, coverageFlags: flags, host: 'example.test', dropped: { observations: 0, batches: 0, findings: 0, hosts: 0, counters: 0, transport: 0 } });
const input = (over = {}) => ({ loaded: true, report: report('paused'), scopeMode: 'all-sites', tabUrlClass: 'web', chromeSupported: true, chromeVersion: '156', swAvailable: true, managed: false, justGranted: false, ...over });

for (const name of QUIET_UI_BUNDLES) {
  test(name + ': a pause the user did not make shows the reason; the user\'s own pause keeps its text', () => {
    const { coverageView } = viewModel(name), EN = ANTIDETECT_QUIET_LABELS.en;
    const now = coverageView(input({ sensorsQuiet: true }));
    assert.equal(now.state, 'paused'); assert.equal(now.tone, 'muted'); assert.equal(now.title, 'coverage_paused_title'); assert.equal(now.status, 'status_paused');
    assert.deepEqual([...now.lines], [EN.paused_now, EN.paused_calls, EN.paused_setting]);
    const ended = coverageView(input({ sensorsQuiet: false }));
    assert.deepEqual([...ended.lines], [EN.paused_ended, EN.paused_calls, EN.paused_setting]);
    assert.deepEqual([...coverageView(input()).lines], [EN.paused_ended, EN.paused_calls, EN.paused_setting], 'a missing flag from an older worker means "not quiet now"');
    const own = coverageView(input({ report: report('paused', ['paused']), sensorsQuiet: true }));
    assert.deepEqual([...own.lines], ['coverage_paused_desc', 'coverage_paused_reload'], 'the flag marks the user\'s own pause');
    assert.equal(now.showReload, false);
  });

  test(name + ': no other state changes; the reason follows the interface language and never shows a raw key', () => {
    const { coverageView } = viewModel(name);
    assert.deepEqual([...coverageView(input({ report: report('active'), sensorsQuiet: true })).lines], ['coverage_active_desc']);
    assert.deepEqual([...coverageView(input({ report: report('no-access'), sensorsQuiet: true })).lines], ['coverage_no_access_desc(example.test)']);
    assert.equal(coverageView(input({ report: null, sensorsQuiet: true })).state, 'no-report');
    for (const [locale, labels] of Object.entries(ANTIDETECT_QUIET_LABELS)) {
      const lines = [...viewModel(name, locale).coverageView(input({ sensorsQuiet: true })).lines];
      assert.deepEqual(lines, [labels.paused_now, labels.paused_calls, labels.paused_setting], locale);
    }
  });

  test(name + ': the scope reply feeds the view only through a strict boolean', () => {
    const { coverageInputOf } = viewModel(name), session = scope => ({ loaded: true, report: null, scope, tabUrlClass: 'web', chrome: { supported: true, version: '156' }, swAvailable: true, justGranted: false });
    assert.equal(coverageInputOf(session({ scopeMode: 'all-sites', sensorsQuiet: true })).sensorsQuiet, true);
    for (const value of [false, undefined, 'true', 1, null, {}]) assert.equal(coverageInputOf(session({ scopeMode: 'all-sites', sensorsQuiet: value })).sensorsQuiet, false);
    assert.equal(coverageInputOf(session(null)).sensorsQuiet, false); assert.equal(coverageInputOf(session({ scopeMode: 'off' })).managed, false);
  });
}
