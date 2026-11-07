// DET-043 differential audit. All listeners/events belong to this controlled page; no extension build.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '../../..');
const output = path.join(root, 'test-results/prod/reports/interaction');
mkdirSync(output, { recursive: true });
const bundled = await build({ stdin: { contents: "export { SensorRuntime, browserEnv } from './packages/sensors/src/runtime'; export { installInteractionSensor } from './packages/sensors/src/interaction';", resolveDir: root, sourcefile: 'interaction-audit.ts', loader: 'ts' }, bundle: true, write: false, format: 'iife', globalName: 'InteractionAudit', platform: 'browser', target: 'es2022', logLevel: 'silent' });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const evidence = { at: new Date().toISOString(), browser: browser.version(), extensionLoaded: false, controlledPageOnly: true,
  savedData: 'Fixed API labels, counts, support/identity booleans only. No callback source, event objects, coordinates, keys, text or timing series.', completed: false, cases: [] };
async function check(name, run) {
  const page = await browser.newPage();
  try {
    await page.setContent('<!doctype html><button id="button">Fixture</button><div id="target" style="width:200px;height:150px"></div>');
    await page.addScriptTag({ content: bundled.outputFiles[0].text });
    const result = await run(page);
    evidence.cases.push({ name, result });
    console.log('PASS ' + name);
  } finally { await page.close(); }
}

try {
  await check('native registration original once, options conversion and opaque callback identity', async page => {
    const result = await page.evaluate(() => {
      const original = Object.getOwnPropertyDescriptor(EventTarget.prototype, 'addEventListener');
      let calls = 0, receiver, forwarded, callbackReads = 0;
      Object.defineProperty(EventTarget.prototype, 'addEventListener', { ...original, value: new Proxy(original.value, { apply(fn, self, args) {
        calls++; receiver = self; forwarded = args; return Reflect.apply(fn, self, args);
      } }) });
      const callback = new Proxy({}, { get() { callbackReads++; throw new Error('callback property read during registration'); } });
      const optionsReads = [];
      const options = new Proxy({}, { get(_target, key) { optionsReads.push(key); return undefined; } });
      Reflect.apply(original.value, new EventTarget(), ['mousemove', callback, options]);
      const baselineOptions = optionsReads.slice(); optionsReads.length = 0;
      const runtime = new InteractionAudit.SensorRuntime(InteractionAudit.browserEnv(window));
      InteractionAudit.installInteractionSensor(runtime, window);
      const installCalls = calls, target = new EventTarget();
      const extra = new Proxy({}, { get() { throw new Error('extra argument inspected'); } });
      const returned = Reflect.apply(EventTarget.prototype.addEventListener, target, ['mousemove', callback, options, extra]);
      return { installCalls, originalOnce: calls === 1, receiverSame: receiver === target,
        argumentsSame: forwarded.length === 4 && forwarded[1] === callback && forwarded[2] === options && forwarded[3] === extra,
        returnUndefined: returned === undefined, callbackReads, sameOptionsConversion: JSON.stringify(optionsReads) === JSON.stringify(baselineOptions),
        counters: runtime.snapshot().counters.map(c => ({ id: c.techniqueId, count: c.count, phase: c.phase, signals: c.signalCodes })) };
    });
    assert.equal(result.installCalls, 0); assert.equal(result.callbackReads, 0);
    for (const key of ['originalOnce', 'receiverSame', 'argumentsSame', 'returnUndefined', 'sameOptionsConversion']) assert.equal(result[key], true);
    assert.deepEqual(result.counters, [{ id: 'DET-043', count: 1, phase: 'returned-sync', signals: ['api-use', 'movement-listener'] }]);
    return result;
  });

  await check('primitive filtering, native type coercion, duplicate/once/remove/abort semantics', async page => {
    const result = await page.evaluate(() => {
      const remove = EventTarget.prototype.removeEventListener;
      const runtime = new InteractionAudit.SensorRuntime(InteractionAudit.browserEnv(window));
      InteractionAudit.installInteractionSensor(runtime, window);
      const target = new EventTarget(); let invoked = 0, correctThis = true, correctEvent = true;
      const event = new MouseEvent('mousemove');
      function listener(received) { invoked++; correctThis &&= this === target; correctEvent &&= received === event; }
      target.addEventListener('mousemove', listener); target.addEventListener('mousemove', listener);
      target.dispatchEvent(event); const duplicateInvocations = invoked;
      target.removeEventListener('mousemove', listener); target.dispatchEvent(event); const afterRemove = invoked;
      target.addEventListener('mousemove', listener, { once: true });
      target.dispatchEvent(event); target.dispatchEvent(event); const afterOnce = invoked;
      const controller = new AbortController();
      target.addEventListener('mousemove', listener, { signal: controller.signal }); controller.abort(); target.dispatchEvent(event);
      const beforeAborted = new AbortController(); beforeAborted.abort();
      target.addEventListener('mousemove', listener, { signal: beforeAborted.signal }); target.dispatchEvent(event);
      let conversions = 0;
      const type = { [Symbol.toPrimitive]() { conversions++; return 'mousemove'; } };
      target.addEventListener(type, listener); target.dispatchEvent(event); target.removeEventListener('mousemove', listener);
      for (const kind of ['click', 'drag', 'keydown', 'pointerdown', 'wheel', 'message', 'MouseMove']) target.addEventListener(kind, listener);
      target.addEventListener('mousemove', null);
      return { duplicateInvocations, afterRemove, afterOnce, finalInvocations: invoked, correctThis, correctEvent, conversions,
        removeUnchanged: EventTarget.prototype.removeEventListener === remove,
        counters: runtime.snapshot().counters.map(c => ({ id: c.techniqueId, count: c.count, phase: c.phase, signals: c.signalCodes })) };
    });
    assert.equal(result.duplicateInvocations, 1); assert.equal(result.afterRemove, 1); assert.equal(result.afterOnce, 2);
    assert.equal(result.finalInvocations, 3); assert.equal(result.conversions, 1);
    for (const key of ['correctThis', 'correctEvent', 'removeUnchanged']) assert.equal(result[key], true);
    assert.deepEqual(result.counters, [{ id: 'DET-043', count: 5, phase: 'returned-sync', signals: ['api-use', 'movement-listener'] }]);
    return result;
  });

  await check('all EventTarget instances and native movement handler setters preserve assignment/clearing', async page => {
    const result = await page.evaluate(() => {
      const entries = [['Window', window, window], ['Document', Document.prototype, document], ['HTMLElement', HTMLElement.prototype, document.createElement('div')],
        ['SVGElement', SVGElement.prototype, document.createElementNS('http://www.w3.org/2000/svg', 'svg')],
        ...(typeof MathMLElement === 'function' ? [['MathMLElement', MathMLElement.prototype, document.createElementNS('http://www.w3.org/1998/Math/MathML', 'math')]] : [])];
      const slots = [];
      for (const [label, target, receiver] of entries) for (const key of ['onmousemove', 'onpointermove', 'onpointerrawupdate']) {
        const original = Object.getOwnPropertyDescriptor(target, key);
        if (!original?.configurable || typeof original.set !== 'function') continue;
        const state = { label: label + '.' + key, target, receiver, key, original, calls: 0, self: null, argument: null };
        Object.defineProperty(target, key, { ...original, set: new Proxy(original.set, { apply(fn, self, args) {
          state.calls++; state.self = self; state.argument = args[0]; return Reflect.apply(fn, self, args);
        } }) }); slots.push(state);
      }
      const runtime = new InteractionAudit.SensorRuntime(InteractionAudit.browserEnv(window));
      InteractionAudit.installInteractionSensor(runtime, window);
      const installationCalls = slots.reduce((count, slot) => count + slot.calls, 0), checks = [];
      for (const slot of slots) {
        const callback = () => {};
        slot.receiver[slot.key] = callback;
        const equal = slot.calls === 1 && slot.self === slot.receiver && slot.argument === callback && slot.receiver[slot.key] === callback;
        slot.receiver[slot.key] = null;
        checks.push({ label: slot.label, originalOnceAndIdentity: equal, clearWorks: slot.calls === 2 && slot.receiver[slot.key] === null,
          getterUnchanged: Object.getOwnPropertyDescriptor(slot.target, slot.key).get === slot.original.get });
      }
      const targets = entries.map(entry => entry[2]); targets.push(new EventTarget());
      for (const target of targets) target.addEventListener('pointermove', () => {});
      return { installationCalls, checks, targetCount: targets.length,
        counters: runtime.snapshot().counters.map(c => ({ id: c.techniqueId, count: c.count, signals: c.signalCodes })) };
    });
    assert.equal(result.installationCalls, 0); assert.ok(result.checks.length >= 8);
    assert.ok(result.checks.every(check => check.originalOnceAndIdentity && check.clearWorks && check.getterUnchanged));
    assert.deepEqual(result.counters, [{ id: 'DET-043', count: result.checks.length + result.targetCount, signals: ['api-use', 'movement-listener'] }]);
    return result;
  });

  await check('native coordinate getter once, result/error identity and no extra event reads', async page => {
    const result = await page.evaluate(() => {
      const event = new PointerEvent('click', { clientX: 173.25, clientY: -29.5, screenX: 102.5, screenY: 201.25 });
      let extraReads = 0;
      for (const name of ['type', 'isTrusted', 'target', 'timeStamp']) {
        try { Object.defineProperty(event, name, { get() { extraReads++; throw new Error('extra event read'); } }); } catch { /* native non-configurable slot */ }
      }
      const states = [];
      for (const key of ['clientX','clientY','screenX','screenY','pageX','pageY','offsetX','offsetY','movementX','movementY','x','y']) {
        const original = Object.getOwnPropertyDescriptor(MouseEvent.prototype, key);
        if (!original?.get || !original.configurable) continue;
        const state = { key, calls: 0, result: undefined, error: undefined, self: null, args: null };
        Object.defineProperty(MouseEvent.prototype, key, { ...original, get: new Proxy(original.get, { apply(fn, self, args) {
          state.calls++; state.self = self; state.args = args;
          try { return state.result = Reflect.apply(fn, self, args); } catch (error) { state.error = error; throw error; }
        } }) }); states.push(state);
      }
      const runtime = new InteractionAudit.SensorRuntime(InteractionAudit.browserEnv(window));
      InteractionAudit.installInteractionSensor(runtime, window);
      const installReads = states.reduce((count, state) => count + state.calls, 0), checks = [];
      const extra = new Proxy({}, { get() { throw new Error('getter argument inspected'); } });
      for (const state of states) {
        const getter = Object.getOwnPropertyDescriptor(MouseEvent.prototype, state.key).get;
        const value = Reflect.apply(getter, event, [extra]);
        const valid = state.calls === 1 && state.self === event && state.args.length === 1 && state.args[0] === extra && Object.is(value, state.result);
        let caught; try { Reflect.apply(getter, {}, []); } catch (error) { caught = error; }
        checks.push({ key: state.key, valid, exceptionSame: caught === state.error && state.calls === 2 });
      }
      return { installReads, extraReads, checks,
        counters: runtime.snapshot().counters.map(c => ({ id: c.techniqueId, count: c.count, phase: c.phase, signals: c.signalCodes })) };
    });
    assert.equal(result.installReads, 0); assert.equal(result.extraReads, 0); assert.equal(result.checks.length, 12);
    assert.ok(result.checks.every(check => check.valid && check.exceptionSame));
    assert.deepEqual(result.counters.map(counter => counter.phase).sort(), ['returned-sync', 'threw-sync']);
    assert.ok(result.counters.every(counter => counter.id === 'DET-043' && counter.count === 12 && JSON.stringify(counter.signals) === JSON.stringify(['api-use','pointer-coordinate-read'])));
    return result;
  });

  await check('actual pointer movement keeps page behavior and records only explicit getter reads', async page => {
    await page.evaluate(() => {
      const runtime = new InteractionAudit.SensorRuntime(InteractionAudit.browserEnv(window)); InteractionAudit.installInteractionSensor(runtime, window);
      const audit = window.interactionFixture = { runtime, moves: 0, clicks: 0, down: 0, coordinateReads: 0, valuesRemainLocal: true };
      const target = document.getElementById('target');
      target.addEventListener('pointermove', event => { audit.moves++; const coordinate = event.clientX; audit.valuesRemainLocal &&= Number.isFinite(coordinate); audit.coordinateReads++; });
      target.addEventListener('pointerdown', () => { audit.down++; });
      document.getElementById('button').addEventListener('click', () => { audit.clicks++; });
    });
    await page.mouse.move(30, 60); await page.mouse.down(); await page.mouse.move(45, 70); await page.mouse.up();
    await page.mouse.click(30, 15);
    const result = await page.evaluate(() => {
      const audit = window.interactionFixture;
      return { moves: audit.moves, clicks: audit.clicks, down: audit.down, coordinateReads: audit.coordinateReads, valuesRemainLocal: audit.valuesRemainLocal,
        counters: audit.runtime.snapshot().counters.map(c => ({ id: c.techniqueId, count: c.count, signals: c.signalCodes })) };
    });
    assert.ok(result.moves >= 2); assert.equal(result.clicks, 1); assert.equal(result.down, 1); assert.equal(result.valuesRemainLocal, true);
    assert.deepEqual(result.counters.find(counter => counter.signals.includes('movement-listener')), { id: 'DET-043', count: 1, signals: ['api-use','movement-listener'] });
    assert.equal(result.counters.find(counter => counter.signals.includes('pointer-coordinate-read')).count, result.coordinateReads);
    return result;
  });

  await check('dispatch alone adds no observations; pause and ownership-safe cleanup preserve behavior', async page => {
    const result = await page.evaluate(() => {
      const target = new EventTarget(); let calls = 0;
      target.addEventListener('mousemove', () => { calls++; });
      const original = Object.getOwnPropertyDescriptor(EventTarget.prototype, 'addEventListener');
      const runtime = new InteractionAudit.SensorRuntime(InteractionAudit.browserEnv(window));
      InteractionAudit.installInteractionSensor(runtime, window); InteractionAudit.installInteractionSensor(runtime, window);
      for (let index = 0; index < 5; index++) target.dispatchEvent(new MouseEvent('mousemove'));
      const emptyAfterDispatch = runtime.snapshot().counters.length === 0;
      target.addEventListener('mousemove', () => {});
      runtime.pause(); target.addEventListener('mousemove', () => {}); void new MouseEvent('click').clientX;
      const countWhilePaused = runtime.snapshot().counters.reduce((count, counter) => count + counter.count, 0);
      runtime.resume(); void new MouseEvent('click').clientX;
      const snapshot = runtime.snapshot().counters.map(c => ({ id: c.techniqueId, count: c.count, signals: c.signalCodes }));
      runtime.stop('local');
      const restored = Object.getOwnPropertyDescriptor(EventTarget.prototype, 'addEventListener').value === original.value;
      return { calls, emptyAfterDispatch, countWhilePaused, restored, snapshot };
    });
    assert.equal(result.calls, 5); assert.equal(result.emptyAfterDispatch, true); assert.equal(result.countWhilePaused, 1); assert.equal(result.restored, true);
    assert.equal(result.snapshot.length, 2); assert.ok(result.snapshot.every(counter => counter.count === 1));
    return result;
  });
  evidence.completed = true;
} finally {
  await browser.close();
  writeFileSync(path.join(output, 'sensor-native.json'), JSON.stringify(evidence, null, 2) + '\n');
}
