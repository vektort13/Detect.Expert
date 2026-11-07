import { describe, expect, it } from 'vitest';
import { installInteractionSensor } from '../src/interaction';
import { installEnvironmentSensor } from '../src/environment';
import { rememberScreenTarget, screenEventOperation } from '../src/screen-events';
import { SensorRuntime } from '../src/runtime';
import { makeEnv } from './helpers';

function setup() {
  const fake = makeEnv(), runtime = new SensorRuntime(fake.env);
  const calls: Array<{ kind: string; receiver: unknown; args: unknown[] }> = [];
  const result = new Proxy({}, { get() { throw new Error('result inspected'); } });
  const failure = new Proxy({}, { get() { throw new Error('exception inspected'); } });
  let fail = false, handler: unknown;
  class EventTarget {
    addEventListener(...args: unknown[]) {
      calls.push({ kind: 'add', receiver: this, args });
      if (fail) throw failure;
      return result;
    }
    removeEventListener(...args: unknown[]) { calls.push({ kind: 'remove', receiver: this, args }); }
  }
  class HTMLElement extends EventTarget {
    get onmousemove() { return handler; }
    set onmousemove(value: unknown) {
      calls.push({ kind: 'set', receiver: this, args: [value] });
      if (fail) throw failure;
      handler = value;
    }
  }
  class MouseEvent {
    get type(): string { throw new Error('observer inspected event type'); }
    get clientX() {
      calls.push({ kind: 'get', receiver: this, args: [] });
      if (fail) throw failure;
      return result;
    }
  }
  class PointerEvent extends MouseEvent {}
  const realm = { EventTarget, HTMLElement, MouseEvent, PointerEvent };
  return { fake, runtime, calls, result, failure, realm, fail: () => { fail = true; } };
}

describe('movement listener API observation without tracking interactions', () => {
  it('installation invokes no page APIs and missing optional slots remain untouched', () => {
    const s = setup(), installation = installInteractionSensor(s.runtime, s.realm);
    expect(s.calls).toEqual([]);
    expect(s.runtime.snapshot().counters).toEqual([]);
    expect(installation.skipped).toContain('Window.onmousemove');
    expect(installation.skipped).toContain('Document');
    expect(Object.hasOwn(s.realm, 'onmousemove')).toBe(false);
  });

  it('matches only primitive movement event types on any inherited EventTarget', () => {
    const s = setup(); installInteractionSensor(s.runtime, s.realm);
    const target = new s.realm.HTMLElement();
    const callback = () => {};
    for (const type of ['mousemove', 'pointermove', 'pointerrawupdate']) target.addEventListener(type, callback);
    for (const type of ['click', 'mousedown', 'pointerdown', 'pointerup', 'wheel', 'drag', 'message', 'pagehide', 'MouseMove', '', 'mousemove ']) target.addEventListener(type, callback);
    expect(s.runtime.snapshot().counters).toEqual([expect.objectContaining({ techniqueId: 'DET-043', count: 3, phase: 'returned-sync', signalCodes: ['api-use', 'movement-listener'] })]);
    expect(s.calls).toHaveLength(14);
  });

  it('forwards callback/options/extra arguments and result identity without any inspection', () => {
    const s = setup(); installInteractionSensor(s.runtime, s.realm);
    const target = new s.realm.EventTarget(), opaque = new Proxy({}, { get() { throw new Error('callback/options inspected'); } });
    expect(target.addEventListener('mousemove', opaque, opaque, opaque)).toBe(s.result);
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]!.receiver === target && s.calls[0]!.args[1] === opaque && s.calls[0]!.args[2] === opaque && s.calls[0]!.args[3] === opaque).toBe(true);
    expect(s.runtime.snapshot().counters[0]?.count).toBe(1);
  });

  it('does not coerce a boxed, proxy or non-string event type to classify it', () => {
    const s = setup(); installInteractionSensor(s.runtime, s.realm);
    const target = new s.realm.EventTarget(), opaque = new Proxy({}, { get() { throw new Error('event type inspected'); } });
    for (const type of [opaque, new String('mousemove'), Symbol('mousemove'), null, undefined, 43]) target.addEventListener(type, null);
    expect(s.calls).toHaveLength(6);
    expect(s.runtime.snapshot().counters).toEqual([]);
  });

  it('counts API calls rather than installed listeners and leaves remove alone without screen interfaces', () => {
    const s = setup(), remove = s.realm.EventTarget.prototype.removeEventListener;
    installInteractionSensor(s.runtime, s.realm);
    const target = new s.realm.EventTarget(), callback = () => {};
    target.addEventListener('mousemove', callback); target.addEventListener('mousemove', callback); target.addEventListener('mousemove', null);
    target.removeEventListener('mousemove', callback);
    expect(s.realm.EventTarget.prototype.removeEventListener).toBe(remove);
    expect(s.calls.map(call => call.kind)).toEqual(['add', 'add', 'add', 'remove']);
    expect(s.runtime.snapshot().counters[0]?.count).toBe(2);
  });

  it('ignores null, undefined and other primitive callbacks or handler assignments', () => {
    const s = setup(); installInteractionSensor(s.runtime, s.realm);
    const target = new s.realm.HTMLElement();
    for (const value of [null, undefined, false, 1, 'CALLBACK_TEXT_CANARY', Symbol('callback')]) {
      target.addEventListener('mousemove', value);
      target.onmousemove = value;
    }
    expect(s.calls).toHaveLength(12);
    expect(s.runtime.snapshot().counters).toEqual([]);
  });

  it('counts inherited coordinate getter outcomes without reading values, event type or provenance', () => {
    const s = setup(); installInteractionSensor(s.runtime, s.realm);
    const event = new s.realm.PointerEvent();
    expect(event.clientX).toBe(s.result);
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]!.receiver).toBe(event);
    expect(s.runtime.snapshot().counters).toEqual([expect.objectContaining({ techniqueId: 'DET-043', count: 1, phase: 'returned-sync', signalCodes: ['api-use', 'pointer-coordinate-read'] })]);
  });

  it('keeps registration and coordinate counters separate and preserves getter exceptions/cleanup', () => {
    const s = setup(), original = Object.getOwnPropertyDescriptor(s.realm.MouseEvent.prototype, 'clientX')!;
    installInteractionSensor(s.runtime, s.realm);
    new s.realm.EventTarget().addEventListener('mousemove', () => {});
    s.fail(); let caught: unknown;
    try { void new s.realm.MouseEvent().clientX; } catch (error) { caught = error; }
    expect(caught === s.failure).toBe(true);
    expect(s.runtime.snapshot().counters).toEqual(expect.arrayContaining([
      expect.objectContaining({ count: 1, phase: 'returned-sync', signalCodes: ['api-use', 'movement-listener'] }),
      expect.objectContaining({ count: 1, phase: 'threw-sync', signalCodes: ['api-use', 'pointer-coordinate-read'] }),
    ]));
    s.runtime.stop('local');
    expect(Object.getOwnPropertyDescriptor(s.realm.MouseEvent.prototype, 'clientX')).toEqual(original);
  });

  it('handler assignment preserves original getter and callback identity, including explicit clearing', () => {
    const s = setup(), original = Object.getOwnPropertyDescriptor(s.realm.HTMLElement.prototype, 'onmousemove')!;
    installInteractionSensor(s.runtime, s.realm);
    const target = new s.realm.HTMLElement(), callback = new Proxy({}, { get() { throw new Error('callback inspected'); } });
    target.onmousemove = callback; expect(target.onmousemove).toBe(callback);
    target.onmousemove = null; expect(target.onmousemove).toBeNull();
    expect(Object.getOwnPropertyDescriptor(s.realm.HTMLElement.prototype, 'onmousemove')!.get).toBe(original.get);
    expect(s.runtime.snapshot().counters[0]?.count).toBe(1);
    s.runtime.stop('local');
    expect(Object.getOwnPropertyDescriptor(s.realm.HTMLElement.prototype, 'onmousemove')).toEqual(original);
  });

  it('preserves original synchronous exceptions and isolates observer failure', () => {
    const s = setup(); installInteractionSensor(s.runtime, s.realm); s.fail();
    const target = new s.realm.HTMLElement();
    let caught: unknown;
    try { target.addEventListener('mousemove', () => {}); } catch (error) { caught = error; }
    expect(caught === s.failure).toBe(true);
    expect(s.runtime.snapshot().counters[0]?.phase).toBe('threw-sync');
    s.runtime.record = () => { throw new Error('observer failed'); };
    try { target.onmousemove = () => {}; } catch (error) { caught = error; }
    expect(caught === s.failure).toBe(true);
    expect(s.runtime.hooks.observerErrors).toBe(1);
    expect(s.calls).toHaveLength(2);
  });

  it('guards observer-internal registrations and skips observations while paused', () => {
    const s = setup(); installInteractionSensor(s.runtime, s.realm);
    const target = new s.realm.EventTarget(), record = s.runtime.record.bind(s.runtime);
    s.runtime.record = (...args) => { target.addEventListener('mousemove', () => {}); record(...args); };
    target.addEventListener('mousemove', () => {});
    expect(s.calls).toHaveLength(2); expect(s.runtime.snapshot().counters[0]?.count).toBe(1);
    s.runtime.pause(); target.addEventListener('mousemove', () => {});
    expect(s.calls).toHaveLength(3); expect(s.runtime.snapshot().counters[0]?.count).toBe(1);
  });

  it('does not execute constructor accessors and keeps prior hooks attached after unsupported slots', () => {
    const s = setup();
    Object.defineProperty(s.realm, 'Document', { get() { throw new Error('constructor getter invoked'); } });
    Object.defineProperty(s.realm.HTMLElement.prototype, 'onmousemove', { configurable: false });
    installInteractionSensor(s.runtime, s.realm);
    expect(s.runtime.snapshot().flags).toEqual(expect.arrayContaining(['hook-failed', 'descriptor-nonconfigurable']));
    new s.realm.EventTarget().addEventListener('mousemove', () => {});
    expect(s.runtime.snapshot().counters[0]?.count).toBe(1);
  });

  it('reinjection never double counts and cleanup does not erase a page replacement', () => {
    const s = setup(); installInteractionSensor(s.runtime, s.realm); installInteractionSensor(s.runtime, s.realm);
    new s.realm.EventTarget().addEventListener('mousemove', () => {});
    expect(s.runtime.snapshot().counters[0]?.count).toBe(1);
    const foreign = () => s.result; s.realm.EventTarget.prototype.addEventListener = foreign;
    s.runtime.stop('revoked');
    expect(s.realm.EventTarget.prototype.addEventListener).toBe(foreign);
    expect(installInteractionSensor(s.runtime, s.realm).results).toEqual([]);
  });

  it('classifies only known screen receivers and preserves callbacks, options, duplicates and removal', () => {
    const s = setup();
    class Screen extends s.realm.EventTarget { get width() { return -1927; } }
    class ScreenDetails extends s.realm.EventTarget { get currentScreen() { return screen; } }
    const screen = new Screen(), details = new ScreenDetails();
    const realm = { ...s.realm, Screen, ScreenDetails, get screen() { return screen; } };
    const originalAdd = s.realm.EventTarget.prototype.addEventListener;
    const originalRemove = s.realm.EventTarget.prototype.removeEventListener;
    installEnvironmentSensor(s.runtime, realm); installInteractionSensor(s.runtime, realm);
    expect(s.calls).toHaveLength(0);
    const callback = new Proxy({}, { get() { throw new Error('callback/options inspected'); } });
    const unrelated = new s.realm.EventTarget();
    unrelated.addEventListener('change', callback);
    unrelated.addEventListener('screenschange', callback);
    details.addEventListener('screenschange', callback);
    expect(s.runtime.snapshot().counters).toEqual([]);
    expect(realm.screen === screen).toBe(true);
    screen.addEventListener('change', callback, callback);
    screen.addEventListener('change', callback, callback);
    screen.addEventListener('change', null);
    screen.addEventListener('screenschange', callback);
    screen.removeEventListener('change', callback, callback);
    void details.currentScreen;
    details.addEventListener('screenschange', callback, callback);
    details.addEventListener('currentscreenchange', callback, callback);
    details.addEventListener('change', callback);
    details.removeEventListener('screenschange', callback, callback);
    const facts = s.runtime.snapshot().counters.filter(counter => counter.apiOperation?.endsWith('EventListener'));
    expect(facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ apiOperation: 'Screen.addEventListener', count: 2 }),
      expect.objectContaining({ apiOperation: 'Screen.removeEventListener', count: 1 }),
      expect.objectContaining({ apiOperation: 'ScreenDetails.addEventListener', count: 2 }),
      expect.objectContaining({ apiOperation: 'ScreenDetails.removeEventListener', count: 1 }),
    ]));
    expect(facts).toHaveLength(4);
    expect(s.calls[3]!.args[1] === callback && s.calls[3]!.args[2] === callback).toBe(true);
    expect(JSON.stringify(s.runtime.snapshot())).not.toContain('-1927');
    s.runtime.pause(); screen.addEventListener('change', callback);
    expect(s.runtime.snapshot().counters.filter(counter => counter.apiOperation?.endsWith('EventListener'))).toEqual(facts);
    s.runtime.stop('revoked');
    expect(s.realm.EventTarget.prototype.addEventListener).toBe(originalAdd);
    expect(s.realm.EventTarget.prototype.removeEventListener).toBe(originalRemove);
    expect(screenEventOperation(s.runtime, screen, 'change', true)).toBeNull();
  });

  it('bounds screen identities, never inspects unknown proxies and keeps synchronous failures', () => {
    const s = setup();
    class Screen extends s.realm.EventTarget {}
    installInteractionSensor(s.runtime, { ...s.realm, Screen });
    const hostile = new Proxy({}, { get() { throw new Error('receiver read'); }, getPrototypeOf() { throw new Error('receiver prototype read'); } });
    expect(screenEventOperation(s.runtime, hostile, 'change', true)).toBeNull();
    const admitted = new Screen(); rememberScreenTarget(s.runtime, admitted, 'Screen');
    for (let index = 1; index < 128; index++) rememberScreenTarget(s.runtime, new Screen(), 'Screen');
    const overflow = new Screen(); rememberScreenTarget(s.runtime, overflow, 'Screen');
    expect(screenEventOperation(s.runtime, overflow, 'change', true)).toBeNull();
    expect(s.runtime.snapshot().flags).toContain('budget-exceeded');
    s.fail(); let caught: unknown;
    try { admitted.addEventListener('change', () => {}); } catch (error) { caught = error; }
    expect(caught === s.failure).toBe(true);
    expect(s.runtime.snapshot().counters).toEqual([expect.objectContaining({ apiOperation: 'Screen.addEventListener', phase: 'threw-sync', count: 1 })]);
  });

  it.each(['addEventListener', 'removeEventListener'] as const)('%s never reads inherited missing arguments', method => {
    const runtime = new SensorRuntime(makeEnv().env);
    const failure = new TypeError('missing required arguments');
    let calls = 0, reads = 0, preserved = true;
    class EventTarget {
      addEventListener() { calls++; throw failure; }
      removeEventListener() { calls++; throw failure; }
    }
    class Screen extends EventTarget {}
    const receiver = new Screen();
    installInteractionSensor(runtime, { EventTarget, Screen });
    rememberScreenTarget(runtime, receiver, 'Screen');
    const empty: unknown[] = [], single = ['change'];
    Object.defineProperty(Object.prototype, '0', { configurable: true, get() { reads++; return 'change'; } });
    Object.defineProperty(Object.prototype, '1', { configurable: true, get() { reads++; return null; } });
    try {
      try { Reflect.apply(receiver[method], receiver, empty); } catch (error) { preserved = preserved && error === failure; }
      try { Reflect.apply(receiver[method], receiver, single); } catch (error) { preserved = preserved && error === failure; }
    } finally {
      delete (Object.prototype as Record<string, unknown>)['0'];
      delete (Object.prototype as Record<string, unknown>)['1'];
    }
    expect(calls).toBe(2);
    expect(reads).toBe(0);
    expect(preserved).toBe(true);
    expect(runtime.snapshot().counters).toEqual([]);
    runtime.stop('local');
  });
});
