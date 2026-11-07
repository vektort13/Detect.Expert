import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createDetectorPointerUi, detectorPointerPresence} from '../../apps/production-extension/detector-pointer-ui.js';
import {DETECTOR_POINTER_LABELS, detectorPointerLabels} from '../../apps/production-extension/detector-pointer-labels.js';
import {PRODUCTION_LANGUAGES} from '../production-languages.mjs';

const technique = (signals, overrides = {}) => ({techniqueId: 'DET-043', count: 7, countQuality: 'exact', phases: ['returned-sync'], signalCodes: ['api-use', ...signals], evidenceSource: 'page-hook', integrity: 'page-controlled', ...overrides});
const report = (rows = []) => ({coverageState: 'active', scopeMode: 'active-tab', techniques: rows});
const available = {available: true};
const h = (type, props) => ({type, props});
function render(value, props = {}, locale = 'en') {
  return createDetectorPointerUi({h, useLocale: () => locale}).PointerActivity({report: value, available: true, ...props});
}
function nodes(value, predicate) {
  const result = [];function visit(node) {if (Array.isArray(node)) {node.forEach(visit);return;}if (!node?.props) return;if (predicate(node)) result.push(node);visit(node.props.children);}visit(value);return result;
}
function text(node) {return Array.isArray(node) ? node.map(text).join(' ') : node?.props ? text(node.props.children) : typeof node === 'string' ? node : '';}

test('pointer presence uses each exact DET-043 signal independently and does not invent counts from the shared technique total', () => {
  for (const [signals, expected] of [[[], {listeners: false, coordinates: false}], [['movement-listener'], {listeners: true, coordinates: false}], [['pointer-coordinate-read'], {listeners: false, coordinates: true}], [['movement-listener', 'pointer-coordinate-read'], {listeners: true, coordinates: true}]]) {
    const value = report([technique(signals, {count: 987654})]);
    assert.deepEqual(detectorPointerPresence(value, available), expected);
    const tree = render(value);
    assert.equal(nodes(tree, node => node.props['data-pointer-kind']).length, 3);
    assert.equal(nodes(tree, node => node.props['data-pointer-observed'] === true).length, Object.values(expected).filter(Boolean).length);
    assert.doesNotMatch(text(tree), /987654|\b0\b/u);
  }
});

test('actual production summarizer loses the two signal counts; UI preserves facts when different raw distributions yield the same projection', () => {
  const source = readFileSync(new URL('../../apps/production-extension/background.js', import.meta.url), 'utf8');
  const start = source.indexOf('function summarizeTechniques('), end = source.indexOf('function projectFinding(', start);assert.ok(start >= 0 && end > start);
  const context = vm.createContext({TECHNIQUE_IDS: ['DET-043'], SIGNAL_CODES: ['api-use', 'movement-listener', 'pointer-coordinate-read'], PHASES: ['returned-sync', 'threw-sync'],
    satAdd: (a, b) => Math.min(2147483647, a + b), worstQuality: (a, b) => a === 'lower-bound' || b === 'lower-bound' ? 'lower-bound' : 'exact',
    sortByEnumOrder: (values, order) => order.filter(value => values.includes(value)), strongestFinding: () => undefined, attributionConfidence: () => 'frame-only'});
  vm.runInContext(source.slice(start, end) + '\nglobalThis.summarize=summarizeTechniques;', context);
  const counter = (signal, count) => ({techniqueId: 'DET-043', count, countQuality: 'exact', phase: 'returned-sync', signalCodes: ['api-use', ...(signal ? [signal] : [])], firstBucket: 0, lastBucket: 2});
  const summarize = (listeners, coordinates) => context.summarize({counters: [counter('movement-listener', listeners), counter('pointer-coordinate-read', coordinates), {...counter(null, 100), apiOperation: 'IdleDetector.start'}], dropped: {counters: 0}, findings: []});
  const a = JSON.parse(JSON.stringify(summarize(3, 7))), b = JSON.parse(JSON.stringify(summarize(7, 3)));
  assert.deepEqual(a, b);assert.equal(a[0].count, 110);
  assert.deepEqual(detectorPointerPresence(report(a), available), {listeners: true, coordinates: true});
  assert.doesNotMatch(text(render(report(a))), /110/u);
});

test('IdleDetector, different techniques, similar names and raw counter properties cannot create pointer facts', () => {
  const value = report([technique([], {count: 400}), technique(['movement-listener'], {techniqueId: 'DET-042'}), technique(['pointer-coordinate-read'], {techniqueId: 'DET-034'})]);
  value.apiOperations = [{apiOperation: 'IdleDetector.start', count: 400, phase: 'returned-sync', countQuality: 'exact'}];
  value.counters = [{techniqueId: 'DET-043', signalCodes: ['movement-listener'], count: 9}];
  assert.deepEqual(detectorPointerPresence(value, available), {listeners: false, coordinates: false});
  assert.deepEqual(detectorPointerPresence(report([technique(['mousemove', 'pointermove', 'movement-listener-extra', 'Pointer-coordinate-read'])]), available), {listeners: false, coordinates: false});
});

test('a thrown-only observation is an observed attempt; merged phases are not falsely assigned to either signal', () => {
  const value = report([technique(['movement-listener'], {phases: ['threw-sync'], count: 1})]);
  const tree = render(value);assert.equal(nodes(tree, node => node.props['data-pointer-observed'] === true).length, 1);
  assert.match(text(tree), /Site handler registration.*Observed/u);assert.doesNotMatch(text(tree), /Succeeded|Errors|active|physical|human/iu);
  assert.deepEqual(detectorPointerPresence(report([technique(['pointer-coordinate-read'], {phases: ['returned-sync', 'threw-sync']})]), available), {listeners: false, coordinates: true});
});

test('loading, inaccessible, absent and empty reports display dashes without stale facts or invented zeros', () => {
  const previous = report([technique(['movement-listener', 'pointer-coordinate-read'])]);
  for (const [value, props] of [[previous, {loading: true}], [previous, {available: false}], [{...previous, coverageState: 'no-access'}, {}], [{...previous, scopeMode: 'off'}, {}], [null, {}], [report(), {}]]) {
    const tree = render(value, props);
    assert.equal(nodes(tree, node => node.props['data-pointer-observed'] === true).length, 0);
    assert.equal(nodes(tree, node => node.props.class === 'detector-pointer__status' && node.props.children === '—').length, 2);
    assert.doesNotMatch(text(tree), /Observed|\b0\b/u);
  }
});

test('reader does not invoke report/event/accessor canaries or retain arbitrary coordinates, identity or callback values', () => {
  let reads = 0;const value = report([technique(['movement-listener'])]);
  for (const key of ['x', 'y', 'type', 'isTrusted', 'target', 'callback', 'coordinates', 'counters']) Object.defineProperty(value, key, {get() {reads++;throw Error('PRIVATE_CANARY');}});
  Object.defineProperty(value.techniques[0], 'phases', {get() {reads++;throw Error('PRIVATE_PHASE');}});
  assert.deepEqual(detectorPointerPresence(value, available), {listeners: true, coordinates: false});assert.equal(reads, 0);
  const inaccessible = {};Object.defineProperty(inaccessible, 'techniques', {get() {reads++;throw Error('PRIVATE_CANARY');}});
  assert.deepEqual(detectorPointerPresence(inaccessible, available), {listeners: false, coordinates: false});assert.equal(reads, 0);
  const raw = JSON.stringify(render(value));assert.doesNotMatch(raw, /PRIVATE_CANARY|PRIVATE_PHASE|callback|isTrusted/u);
});

test('malformed, oversized, duplicate, zero and non-page observations fail closed without scanning an oversized list', () => {
  const empty = {listeners: false, coordinates: false};
  for (const count of [0, -1, 1.5, NaN, Infinity, 2147483648, '7']) assert.deepEqual(detectorPointerPresence(report([technique(['movement-listener'], {count})]), available), empty);
  for (const changes of [{evidenceSource: 'browser-network'}, {integrity: 'browser-observed'}, {signalCodes: new Array(65).fill('movement-listener')}, {signalCodes: [null]}]) assert.deepEqual(detectorPointerPresence(report([technique(['movement-listener'], changes)]), available), empty);
  assert.deepEqual(detectorPointerPresence(report([technique(['movement-listener']), technique(['pointer-coordinate-read'])]), available), empty);
  let reads = 0;const rows = new Array(129);Object.defineProperty(rows, 0, {get() {reads++;throw Error('oversized scanned');}});
  assert.deepEqual(detectorPointerPresence(report(rows), available), empty);assert.equal(reads, 0);
});

test('all21 locales have complete frozen local labels, alias resolution and content without extra controls or wire calls', () => {
  assert.deepEqual(Object.keys(DETECTOR_POINTER_LABELS).sort(), PRODUCTION_LANGUAGES.map(row => row.id).sort());
  for (const language of PRODUCTION_LANGUAGES) {
    const labels = detectorPointerLabels(language.id);assert.ok(Object.isFrozen(labels));assert.ok(Object.values(labels).every(value => typeof value === 'string' && value.trim()));
    const tree = render(report([technique(['movement-listener'])]), {}, language.id);
    assert.ok(text(tree).includes(labels.title));assert.ok(text(tree).includes(labels.listeners));assert.ok(text(tree).includes(labels.coordinates));assert.ok(text(tree).includes(labels.observed));
    assert.equal(nodes(tree, node => ['button', 'input', 'select', 'a', 'iframe'].includes(node.type)).length, 0);
  }
  assert.equal(detectorPointerLabels('zh-Hans'), DETECTOR_POINTER_LABELS.zh_CN);assert.equal(detectorPointerLabels('pt-BR'), DETECTOR_POINTER_LABELS.pt_BR);assert.equal(detectorPointerLabels('yue-Hans'), DETECTOR_POINTER_LABELS.yue);assert.equal(detectorPointerLabels('unknown'), DETECTOR_POINTER_LABELS.en);
});

test('the independently leased movement counter can show confirmed zero without attributing those movements to site tracking', () => {
  for (const count of [0, 5, 2147483647]) {
    const tree = render(report(), {movement: {state: 'ready', count, frameCount: 1, partial: false}});
    const value = nodes(tree, node => node.props.class === 'detector-pointer__movement')[0];
    assert.equal(value.props.children, String(count));assert.equal(value.props.dir, 'ltr');assert.equal(value.props['data-movement-state'], 'ready');
    assert.match(text(tree), /Cursor movements.*While Detector is open/u);
    assert.equal(nodes(tree, node => node.props['data-pointer-observed'] === true).length, 0,'movement delivery does not imply a site listener or coordinate access');
  }
});

test('partial frame observations use an explicit lower bound and unavailable or malformed movement snapshots remain a dash', () => {
  const tree = render(report(), {movement: {state: 'partial', count: 5, frameCount: 2, partial: true}});
  assert.equal(nodes(tree, node => node.props.class === 'detector-pointer__movement')[0].props.children, '≥5');assert.match(text(tree), /Partial observation/u);
  for (const movement of [null, {state: 'idle', count: 0, frameCount: 0, partial: false}, {state: 'unavailable', count: null, frameCount: 0, partial: false}, {state: 'stopped', count: 99, frameCount: 1, partial: false}, {state: 'ready', count: -1, frameCount: 1, partial: false}, {state: 'ready', count: '5', frameCount: 1, partial: false}, {state: 'ready', count: 5, frameCount: 65, partial: false}]) {
    assert.equal(nodes(render(report(), {movement}), node => node.props.class === 'detector-pointer__movement')[0].props.children, '—');
  }
});

test('stale movement cannot survive a loading, paused, inaccessible or unavailable current report', () => {
  const movement = {state: 'ready', count: 99, frameCount: 1, partial: false};
  for (const [value, props] of [[report(), {loading: true}], [report(), {available: false}], [{...report(), coverageState: 'no-access'}, {}], [{...report(), coverageState: 'paused'}, {}], [{...report(), coverageState: 'unsupported'}, {}], [{...report(), scopeMode: 'off'}, {}], [null, {}]]) {
    assert.equal(nodes(render(value, {...props, movement}), node => node.props.class === 'detector-pointer__movement')[0].props.children, '—');
  }
});
