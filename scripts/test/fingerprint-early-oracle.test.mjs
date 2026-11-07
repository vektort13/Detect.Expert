import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { EARLY_EXPECTED, EARLY_RECONFIGURED, EARLY_REQUIRED_PHASE_LABELS, earlyNativeRunOptions, earlyChromeLaunchOptions, earlyProbe, earlyLeaks } from './api-custom-early-native.mjs';
const sample = (value = EARLY_EXPECTED, phase = 'initial', label = 'owned-document') => ({ label, phase, direct: { ...value }, prototype: { ...value }, saved: { ...value } });
const complete = () => Object.entries(EARLY_REQUIRED_PHASE_LABELS).flatMap(([phase, labels]) => labels.map(label => sample(EARLY_EXPECTED, phase, label)));
test('immutable document oracle retains one exact profile after reconfiguration', () => {
  assert.deepEqual(earlyLeaks([sample(), sample(EARLY_EXPECTED, 'reconfigured')]), []);
  const replaced = earlyLeaks([sample(EARLY_RECONFIGURED, 'reconfigured')]);
  assert.equal(replaced.length, 9);
  for (const leak of replaced) assert.equal(leak.expected, EARLY_EXPECTED[leak.path.split('.')[1]]);
});
test('oracle rejects mixed generations across all direct, prototype and saved paths', () => {
  for (const path of ['direct', 'prototype', 'saved']) for (const key of Object.keys(EARLY_EXPECTED)) {
    const input = sample(EARLY_EXPECTED, 'reconfigured'); input[path][key] = EARLY_RECONFIGURED[key];
    const leaks = earlyLeaks([input]); assert.equal(leaks.length, 1); assert.equal(leaks[0].path, path + '.' + key);
  }
});
test('a fresh or restored document explicitly validates the new generation only', () => {
  assert.deepEqual(earlyLeaks([sample(EARLY_RECONFIGURED)], EARLY_RECONFIGURED), []);
  assert.equal(earlyLeaks([sample(EARLY_EXPECTED)], EARLY_RECONFIGURED).length, 9);
  assert.equal(earlyLeaks([sample(EARLY_RECONFIGURED, 'reconfigured')], EARLY_EXPECTED).length, 9);
});
test('oracle never silently accepts missing samples or missing saved fields', () => {
  assert.equal(earlyLeaks([]).length, 1);
  assert.equal(earlyLeaks(undefined).length, 1);
  assert.equal(earlyLeaks([null]).length, 1);
  assert.equal(earlyLeaks([{ label: 'missing' }]).length, 1);
  const input = sample(); delete input.saved; assert.equal(earlyLeaks([input]).length, 3);
});

test('phase coverage rejects every omitted required realm, including top/same/cross/popups after reconfiguration', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(EARLY_REQUIRED_PHASE_LABELS).map(([phase, labels]) => [phase, labels.length])), { initial: 29, reconfigured: 16 });
  for (const labels of Object.values(EARLY_REQUIRED_PHASE_LABELS)) assert.equal(new Set(labels).size, labels.length, 'Required phase labels are unique');
  assert.deepEqual(earlyLeaks(complete(), EARLY_EXPECTED, EARLY_REQUIRED_PHASE_LABELS), []);
  for (const [phase, labels] of Object.entries(EARLY_REQUIRED_PHASE_LABELS)) for (const label of labels) {
    const missing = complete().filter(value => value.phase !== phase || value.label !== label);
    const leaks = earlyLeaks(missing, EARLY_EXPECTED, EARLY_REQUIRED_PHASE_LABELS);
    assert.equal(leaks.length, 1, phase + ':' + label);
    assert.deepEqual(leaks[0], { label, phase, problem: 'Missing required API sample' });
  }
});

test('a same-label sample from the wrong phase cannot satisfy required reconfigured coverage', () => {
  for (const label of EARLY_REQUIRED_PHASE_LABELS.reconfigured) {
    const samples = complete(); samples.find(value => value.label === label && value.phase === 'reconfigured').phase = 'initial';
    const leaks = earlyLeaks(samples, EARLY_EXPECTED, EARLY_REQUIRED_PHASE_LABELS);
    assert.equal(leaks.length, 1); assert.equal(leaks[0].label, label); assert.equal(leaks[0].phase, 'reconfigured');
  }
});

test('complete phase labels never relax the exact old-document generation oracle', () => {
  const samples = complete().map(value => value.phase === 'reconfigured' ? sample(EARLY_RECONFIGURED, value.phase, value.label) : value);
  const leaks = earlyLeaks(samples, EARLY_EXPECTED, EARLY_REQUIRED_PHASE_LABELS);
  assert.equal(leaks.length, EARLY_REQUIRED_PHASE_LABELS.reconfigured.length * 9);
  for (const leak of leaks) assert.equal(leak.expected, EARLY_EXPECTED[leak.path.split('.')[1]]);
});

test('scripted same-path about:blank realms retain distinct initial and reconfigured labels', () => {
  for (const label of ['aboutblank-written', 'popup-aboutblank-written', 'srcdoc', 'top', '/frame-same', '/frame-cross', '/popup-same', '/popup-cross']) {
    const context = vm.createContext({});
    vm.runInContext(`
      globalThis.window=globalThis; globalThis.parent=window; globalThis.opener=null;
      globalThis.location={pathname:'blank',origin:'null'};
      globalThis.document={currentScript:{dataset:{label:${JSON.stringify(label + ':first-inline')}}}};
      globalThis.addEventListener=()=>{}; globalThis.queueMicrotask=()=>{};
      globalThis.Navigator=function(){}; globalThis.Screen=function(){};
      Object.defineProperty(Navigator.prototype,'hardwareConcurrency',{get(){return ${EARLY_EXPECTED.cpu}}});
      Object.defineProperty(Navigator.prototype,'platform',{get(){return ${JSON.stringify(EARLY_EXPECTED.platform)}}});
      Object.defineProperty(Screen.prototype,'width',{get(){return ${EARLY_EXPECTED.width}}});
      globalThis.navigator=new Navigator();globalThis.screen=new Screen();
      (${earlyProbe.toString()})(); __captureReconfiguredEarly();
    `, context);
    const samples = JSON.parse(vm.runInContext('JSON.stringify(__earlySamples)', context));
    assert.deepEqual(samples.map(value => [value.phase, value.label]), [['initial', label + ':first-inline'], ['reconfigured', label + ':after-reconfiguration']]);
    assert.deepEqual(earlyLeaks(samples), []);
  }
});

test('native CLI preserves defaults and resolves explicit artifact directories without launching a browser', () => {
  const defaults = earlyNativeRunOptions([]);
  assert.deepEqual(defaults, { label: 'current', artifactDirectory: resolve(import.meta.dirname, '../../test-results/prod/reports/2026-10-20-api-custom'), headed: false });
  const directory = resolve('test-results/fingerprint-fixes-2026-10-31/early proof');
  assert.deepEqual(earlyNativeRunOptions(['--label', 'fixed-tree', '--artifact-dir', directory, '--headed']), { label: 'fixed-tree', artifactDirectory: directory, headed: true });
  assert.equal(earlyNativeRunOptions(['--artifact-dir', 'test-results/fingerprint-fixes-2026-10-31']).artifactDirectory, resolve('test-results/fingerprint-fixes-2026-10-31'));
  for (const args of [['--artifact-dir'], ['--artifact-dir', ''], ['--artifact-dir', '--headed'], ['--artifact-dir', 'one', '--artifact-dir', 'two'], ['--label'], ['--label', '../escape']]) assert.throws(() => earlyNativeRunOptions(args));
});

test('Chrome headed option places the native window offscreen while retaining all default fixture/network flags', () => {
  const initial = earlyChromeLaunchOptions('http://early-api.example.com:1234', 'http://cross-early-api.example.com:1234');
  const headed = earlyChromeLaunchOptions('http://early-api.example.com:1234', 'http://cross-early-api.example.com:1234', { headed: true });
  assert.equal(initial.headless, true); assert.equal(headed.headless, false);
  assert.equal(headed.channel, initial.channel); assert.deepEqual(headed.viewport, initial.viewport); assert.deepEqual(headed.ignoreDefaultArgs, initial.ignoreDefaultArgs);
  assert.ok(headed.args.includes('--window-position=-32000,-32000')); assert.ok(headed.args.includes('--window-size=1100,900'));
  assert.deepEqual(headed.args.filter(value => !value.startsWith('--window-position=') && !value.startsWith('--window-size=')), initial.args);
});
