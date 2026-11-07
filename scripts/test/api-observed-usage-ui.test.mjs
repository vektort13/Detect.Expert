// E22-21: evidence labels are independent of editable API configuration.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApiObservedUsageUi, observedApiUsage, observedApiClass, observedApiAttributes } from '../../apps/production-extension/api-observed-usage-ui.js';
import { API_OBSERVED_UI_KEYS, API_OBSERVED_UI_MESSAGES, applyApiObservedCopy } from '../production-locales-api-observed.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';

const row = patch => ({ id: 'canvas-readback', count: 250013, countQuality: 'exact', attempted: false, fingerprintPattern: false, firstPartyCount: 1, thirdPartyCount: 0, unknownCount: 0, ...patch });
const usage = patch => ({ status: 'ready', host: 'owned.example', documentKey: '7:0:owned', coverageState: 'partial', byApi: { 'canvas-readback': row() }, ...patch });
function harness(locale = 'en') {
  const table = applyApiObservedCopy({}, locale), h = (type, props) => ({ type, props });
  return { ...createApiObservedUsageUi({ h, useLocale: () => locale, translate: key => table[key]?.message ?? ({ status_partial: 'PARTIAL' })[key] ?? key }), table };
}
function nodes(tree, predicate) { const found = []; function visit(value) { if (Array.isArray(value)) { value.forEach(visit); return; } if (!value?.props) return; if (predicate(value)) found.push(value); visit(value.props.children); } visit(tree); return found; }
function content(tree) { if (Array.isArray(tree)) return tree.map(content).join(' '); return tree?.props ? content(tree.props.children) : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : ''; }

test('only ready positive observations can decorate an API; retained Custom settings are not evidence', () => {
  const ready = usage(); assert.ok(observedApiUsage(ready, 'canvas-readback')); assert.match(observedApiClass(ready, 'canvas-readback'), /--observed/);
  for (const status of ['loading', 'no-site', 'no-access', 'paused', 'unsupported', 'error', 'stale']) { const state = { ...ready, status }; assert.equal(observedApiUsage(state, 'canvas-readback'), null); assert.equal(observedApiClass(state, 'canvas-readback'), ''); assert.deepEqual(observedApiAttributes(state, 'canvas-readback'), {}); }
  assert.equal(observedApiUsage(usage({ byApi: { 'canvas-readback': row({ count: 0, mode: 'custom' }) } }), 'canvas-readback'), null);
  assert.equal(observedApiUsage(usage({ byApi: Object.create({ 'canvas-readback': row() }) }), 'canvas-readback'), null);
  assert.equal(observedApiUsage(ready, 'webgl'), null);
});

test('ordinary calls, attempts and confirmed fingerprint patterns remain distinct; labels identify frames, not script callers', () => {
  const ui = harness('ru'), ordinary = ui.UsageBadge({ usage: usage(), apiId: 'canvas-readback' });
  assert.equal(nodes(ordinary, node => node.props['data-api-observed-fingerprint']).length, 0); assert.ok(content(ordinary).includes('Наблюдалось'));
  const state = usage({ byApi: { 'canvas-readback': row({ attempted: true, fingerprintPattern: true, thirdPartyCount: 8, unknownCount: 2 }) } });
  const badge = ui.UsageBadge({ usage: state, apiId: 'canvas-readback' });
  assert.deepEqual(nodes(badge, node => node.props['data-api-observed-party']).map(node => node.props['data-api-observed-party']), ['first_party', 'third_party', 'unknown_party']);
  assert.equal(nodes(badge, node => node.props['data-api-observed-fingerprint'] === 'canvas-readback').length, 1);
  assert.match(content(badge), /Попытка вызова/); assert.match(content(badge), /В стороннем фрейме/); assert.doesNotMatch(content(badge), /скрипт|250013|заблокирован/i);
  assert.match(observedApiClass(state, 'canvas-readback'), /--fingerprint/);
});

test('context status and filter keep unavailable or paused observations neutral and retain the view preference', () => {
  const ui = harness(), changed = [], state = usage(), ready = ui.UsageContext({ usage: state, filtered: true, onFilterChange: value => changed.push(value) });
  const checkbox = tree => nodes(tree, node => node.props['data-api-observed-filter'])[0];
  assert.equal(checkbox(ready).props.checked, true); assert.equal(checkbox(ready).props.disabled, false);
  checkbox(ready).props.onChange({ currentTarget: { checked: false } }); assert.deepEqual(changed, [false]);
  for (const status of ['loading', 'no-site', 'no-access', 'paused', 'unsupported', 'error', 'stale']) {
    const tree = ui.UsageContext({ usage: { ...state, status }, filtered: true, onFilterChange() {} });
    assert.equal(checkbox(tree).props.checked, true); assert.equal(checkbox(tree).props.disabled, true); assert.doesNotMatch(content(tree), /api_observed_/);
    assert.equal(ui.UsageBadge({ usage: { ...state, status }, apiId: 'canvas-readback' }), null);
  }
  const empty = ui.UsageContext({ usage: usage({ byApi: {} }) }); assert.equal(nodes(empty, node => node.props['data-api-observed-none']).length, 1);
  assert.equal(ui.UsageContext({ usage: null }), null);
});

test('all 21 language catalogs provide every observation status, fact and frame-context label without English fallback', () => {
  assert.deepEqual(Object.keys(API_OBSERVED_UI_MESSAGES).sort(), PRODUCTION_LANGUAGES.map(language => language.id).sort());
  for (const language of PRODUCTION_LANGUAGES) {
    const ui = harness(language.id); assert.deepEqual(Object.keys(ui.table).sort(), [...API_OBSERVED_UI_KEYS].sort());
    for (const key of API_OBSERVED_UI_KEYS) assert.ok(ui.table[key].message.trim(), language.id + '/' + key);
    const badge = ui.UsageBadge({ usage: usage({ byApi: { 'canvas-readback': row({ attempted: true, fingerprintPattern: true, thirdPartyCount: 1, unknownCount: 1 }) } }), apiId: 'canvas-readback' });
    assert.doesNotMatch(content(badge), /api_observed_/); assert.equal(nodes(badge, node => node.props['data-api-observed-party']).length, 3);
    if (language.id !== 'en') assert.notEqual(ui.table.api_observed_title.message, API_OBSERVED_UI_MESSAGES.en.api_observed_title);
  }
});
