// REQ-002/004/005/011/014, ADR-006/017: regressions against actual production module source.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
function section(file, start, end) {
  const source = readFileSync(new URL('apps/production-extension/' + file, root), 'utf8');
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, file + ': expected audited module boundaries');
  return source.slice(from, to);
}
const phases = ['attempted', 'returned-sync', 'threw-sync', 'settlement-unobserved'];
function geometryFixture(file) {
  const context = vm.createContext({
    URL,
    API_OPERATION_DEFINITIONS: [], API_OPERATION_INDEX: {}, rtcValueProfile: () => null,
    arrayPush: (array, value) => array.push(value), arrayIncludes: (array, value) => array.includes(value), arraySlice: array => array.slice(),
    PHASES: phases, PHASE_INDEX: Object.fromEntries(phases.map((phase, index) => [phase, index])),
    TECHNIQUE_INDEX: Object.fromEntries(['DET-005', 'DET-006', 'DET-007', 'DET-008', 'DET-009'].map(id => [id, id])),
    SIGNAL_BIT: { 'api-use': 1 },
  });
  vm.runInContext(
    section(file, '// packages/contracts/src/api-results.ts', '// packages/sensors/src/wrap.ts') +
    section(file, '// packages/sensors/src/wrap.ts', '// packages/sensors/src/intrinsics.ts') +
    section(file, 'var proValueIntrinsics =', '// packages/sensors/src/api-results.ts') +
    section(file, '// packages/sensors/src/api-results.ts', '// packages/sensors/src/runtime.ts') +
    section(file, '// packages/sensors/src/geometry.ts', '// packages/sensors/src/webgl.ts') + `
    globalThis.capture = new ApiResultRecorder(false);
    capture.proSession = 'coverage-fixture';
    globalThis.runtime = {
      hooks: createHookContext(), handles: [], flags: new Set(), events: [],
      record(...args) { this.events.push(args); },
      recordResult(operation, phase, result, args) { capture.recordPro(operation, PHASES[phase], result, args); },
      addFlag(flag) { this.flags.add(flag); },
      attach(results) { for (const item of results) { if (item.status === 'installed') this.handles.push(item); else this.addFlag(item.coverageFlag); } },
    };
    globalThis.install = realm => installGeometrySensor(runtime, realm);
    `, context);
  return context;
}

for (const file of ['hook.early.js', 'hook.main.js']) {
  test(file + ': actual font/geometry observers preserve original values once and keep Pro arguments private', () => {
    const fixture = geometryFixture(file);
    const realm = vm.runInContext(`(() => {
      const calls = { font: 0, width: 0, svg: 0, bounds: 0 }, rectangle = {}, marker = {};
      function FontFaceSet() {}
      FontFaceSet.prototype.check = function(font, text) {
        calls.font++; if (this !== marker || font !== '12px FONT_PRIVATE_CANARY' || text !== 'FORM_TEXT_CANARY') throw Error('Original arguments changed');
        return true;
      };
      function HTMLElement() {}
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { calls.width++; return 321; } });
      function SVGTextContentElement() {}
      SVGTextContentElement.prototype.getComputedTextLength = function() { calls.svg++; return 12.5; };
      function Element() {}
      Element.prototype.getBoundingClientRect = function() { calls.bounds++; return rectangle; };
      return { FontFaceSet, HTMLElement, SVGTextContentElement, Element, calls, rectangle, marker };
    })()`, fixture);
    fixture.install(realm);
    assert.equal(Reflect.apply(realm.FontFaceSet.prototype.check, realm.marker, ['12px FONT_PRIVATE_CANARY', 'FORM_TEXT_CANARY']), true);
    assert.equal(new realm.HTMLElement().offsetWidth, 321);
    assert.equal(new realm.SVGTextContentElement().getComputedTextLength(), 12.5);
    assert.equal(new realm.Element().getBoundingClientRect(), realm.rectangle);
    assert.deepEqual({ ...realm.calls }, { font: 1, width: 1, svg: 1, bounds: 1 });
    assert.equal(fixture.runtime.hooks.observerErrors, 0);
    assert.equal(fixture.runtime.flags.size, 0);
    const rows = JSON.parse(JSON.stringify([...fixture.capture.proRows.values()]));
    assert.deepEqual(rows.find(row => row.operation === 'FontFaceSet.check').value, { kind: 'boolean', value: true });
    assert.deepEqual(rows.find(row => row.operation === 'HTMLElement.offsetWidth').value, { kind: 'number', value: 321 });
    assert.deepEqual(rows.find(row => row.operation === 'SVGTextContentElement.getComputedTextLength').value, { kind: 'number', value: 12.5 });
    assert.deepEqual(rows.find(row => row.operation === 'Element.getBoundingClientRect').value, { kind: 'unobserved', reason: 'object' });
    // ADR-039 now retains the font specification, while the measured sample is private.
    assert.deepEqual(rows.find(row => row.operation === 'FontFaceSet.check').parameters, [{ name: 'arg0', kind: 'string', value: '12px FONT_PRIVATE_CANARY' }]);
    assert(rows.filter(row => row.operation !== 'FontFaceSet.check').every(row => row.parameters.length === 0));
    assert.equal(JSON.stringify(rows).includes('FORM_TEXT_CANARY'), false);
    for (const handle of fixture.runtime.handles) assert.equal(handle.restore(), true);
  });

  test(file + ': original geometry exceptions pass through once without observer failure', () => {
    const fixture = geometryFixture(file);
    const realm = vm.runInContext(`(() => {
      const failure = new Error('original exception'), calls = { method: 0, getter: 0 };
      function FontFaceSet() {}
      FontFaceSet.prototype.check = function() { calls.method++; throw failure; };
      function HTMLElement() {}
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { calls.getter++; throw failure; } });
      return { FontFaceSet, HTMLElement, calls, failure };
    })()`, fixture);
    fixture.install(realm);
    assert.throws(() => new realm.FontFaceSet().check('ignored'), error => error === realm.failure);
    assert.throws(() => new realm.HTMLElement().offsetWidth, error => error === realm.failure);
    assert.deepEqual({ ...realm.calls }, { method: 1, getter: 1 });
    assert.equal(fixture.runtime.hooks.observerErrors, 0);
    assert.equal(fixture.runtime.flags.size, 0);
    const rows = [...fixture.capture.proRows.values()];
    assert.equal(rows.length, 2);
    assert(rows.every(row => row.phase === 'threw-sync' && row.value.reason === 'exception'));
  });

  test(file + ': unavailable optional geometry APIs remain skipped and real nonconfigurable failures remain visible', () => {
    const empty = geometryFixture(file);
    const result = empty.install({});
    assert(result.skipped.includes('FontFaceSet'));
    assert.equal(empty.runtime.flags.size, 0);
    const fixture = geometryFixture(file);
    const realm = vm.runInContext(`(() => {
      function FontFaceSet() {}
      Object.defineProperty(FontFaceSet.prototype, 'check', { value() { return true; }, writable: false, configurable: false });
      return { FontFaceSet };
    })()`, fixture);
    fixture.install(realm);
    assert.equal(fixture.runtime.flags.has('descriptor-nonconfigurable'), true);
    assert.equal(new realm.FontFaceSet().check(), true);
  });

  test(file + ': actual environment getters preserve scalar results and exceptions without free-argument errors', () => {
    const fixture = geometryFixture(file);
    vm.runInContext(section(file, '// packages/sensors/src/environment.ts', '// packages/sensors/src/extension-resource.ts') +
      ';globalThis.installEnvironment = realm => installEnvironmentSensor(runtime, realm);', fixture);
    const realm = vm.runInContext(`(() => {
      const calls = { width: 0, cpu: 0, failure: 0 }, originalFailure = new Error('original environment exception');
      function Navigator() {}
      Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { configurable: true, get() { calls.cpu++; return 16; } });
      const realm = { Navigator, calls, originalFailure };
      Object.defineProperty(realm, 'innerWidth', { configurable: true, get() { calls.width++; return 1366; } });
      Object.defineProperty(realm, 'innerHeight', { configurable: true, get() { calls.failure++; throw originalFailure; } });
      return realm;
    })()`, fixture);
    fixture.installEnvironment(realm);
    assert.equal(realm.innerWidth, 1366);
    assert.equal(new realm.Navigator().hardwareConcurrency, 16);
    assert.throws(() => realm.innerHeight, error => error === realm.originalFailure);
    assert.deepEqual({ ...realm.calls }, { width: 1, cpu: 1, failure: 1 });
    assert.equal(fixture.runtime.hooks.observerErrors, 0);
    assert.equal(fixture.runtime.flags.size, 0);
    const rows = JSON.parse(JSON.stringify([...fixture.capture.proRows.values()]));
    assert.deepEqual(rows.find(row => row.operation === 'Window.innerWidth').value, { kind: 'number', value: 1366 });
    assert.deepEqual(rows.find(row => row.operation === 'Navigator.hardwareConcurrency').value, { kind: 'number', value: 16 });
    assert.deepEqual(rows.find(row => row.operation === 'Window.innerHeight').value, { kind: 'unobserved', reason: 'exception' });
    assert(rows.every(row => row.parameters.length === 0));
  });
}

// The child manager and wrappers are actual source; DOM transport/runtime are explicit synthetic stand-ins.
function childFixture(file, installForRealm) {
  const context = vm.createContext({
    arrayPush: (array, item) => array.push(item), arrayIncludes: (array, item) => array.includes(item),
    mapSize: map => map.size, mapForEach: (map, callback) => map.forEach(callback),
    BUDGETS: { maxOutOfOrderEntriesGlobal: 128 }, CHANNEL: 'detect.expert/v1',
  });
  vm.runInContext(section(file, '// packages/sensors/src/wrap.ts', '// packages/sensors/src/intrinsics.ts') + `
    globalThis.childRuntimes = [];
    var SensorRuntime = class {
      constructor(env) { this.env = env; this.flags = new Set(); this.hooks = createHookContext(); this.stopCalls = 0; childRuntimes.push(this); if (env.startedLate) this.addFlag('late-start'); }
      addFlag(flag) { this.flags.add(flag); }
      start() { this.started = true; }
      stop() { this.stopCalls++; }
    };
    function nativeStandIn(callback) { return callback.bind(null); }
    globalThis.parentWindow = { 0: {},
      addEventListener: nativeStandIn(() => {}), removeEventListener: nativeStandIn(() => {}),
      dispatchEvent: nativeStandIn(() => {}), structuredClone: nativeStandIn(value => value),
      MessageEvent: nativeStandIn(function() {}), PageTransitionEvent: nativeStandIn(function() {}),
      HTMLIFrameElement: function HTMLIFrameElement() {},
    };
    Object.defineProperty(parentWindow.PageTransitionEvent, 'prototype', { value: {} });
    Object.defineProperty(parentWindow.PageTransitionEvent.prototype, 'persisted', { get: Object.prototype.valueOf });
    Object.defineProperty(parentWindow, 'document', { get: Object.prototype.valueOf, configurable: false });
    Object.defineProperty(parentWindow.HTMLIFrameElement.prototype, 'contentWindow', { get: nativeStandIn(() => parentWindow[0]), configurable: true });
    globalThis.parentRuntime = {
      visualEnv: { self: parentWindow, addEventListener() {}, removeEventListener() {}, now: () => 1 },
      flags: new Set(), hooks: createHookContext(), handles: [],
      addFlag(flag) { this.flags.add(flag); }, onStop(callback) { this.cleanup = callback; },
      attach(results) { this.handles.push(...results); },
    };
    ` + section(file, '// packages/sensors/src/child-realms.ts', '// packages/sensors/src/geometry.ts') +
    ';globalThis.childManager = startChildRealmManager;', context);
  const manager = context.childManager(context.parentRuntime, context.parentWindow, installForRealm);
  const frame = new context.parentWindow.HTMLIFrameElement();
  return { context, manager, frame };
}

for (const file of ['hook.early.js', 'hook.main.js']) {
  test(file + ': successful child fallback reports late capture without artificial hook failure', () => {
    let installs = 0;
    const { context, manager, frame } = childFixture(file, (_runtime, realm) => { installs++; assert.ok(realm); });
    assert.equal(frame.contentWindow, context.parentWindow[0]);
    assert.equal(frame.contentWindow, context.parentWindow[0]);
    assert.equal(installs, 1, 'repeat lookup must not install another child runtime');
    assert.equal(context.childRuntimes.length, 1);
    const runtime = context.childRuntimes[0];
    assert.equal(runtime.started, true);
    assert.equal(runtime.env.startedLate, true);
    assert.equal(runtime.env.earlyCaptureGuaranteed, false);
    assert.deepEqual([...runtime.flags], ['late-start']);
    assert.equal(context.parentRuntime.flags.size, 0);
    manager.stop();
    assert(runtime.stopCalls > 0);
  });

  test(file + ': failed child installer still reports parent hook failure and retires the child', () => {
    const { context, manager, frame } = childFixture(file, () => { throw new Error('installer unavailable'); });
    assert.equal(frame.contentWindow, context.parentWindow[0], 'observer failure must preserve original getter result');
    assert.equal(context.parentRuntime.flags.has('hook-failed'), true);
    assert.equal(context.childRuntimes[0].started, undefined);
    assert(context.childRuntimes[0].stopCalls > 0);
    assert.equal(manager.size, 0);
  });

  test(file + ': supported child transport does not hide a real sensor failure', () => {
    const { context, frame } = childFixture(file, runtime => runtime.addFlag('descriptor-nonconfigurable'));
    assert.equal(frame.contentWindow, context.parentWindow[0]);
    assert.deepEqual([...context.childRuntimes[0].flags].sort(), ['descriptor-nonconfigurable', 'late-start']);
  });
}
