// ADR-020 §F (S10): registration hooks (addEventListener with the early type filter, MutationObserver.observe on the
// document and its root elements). The listener and the options are never read; a password field is recognized by
// the brand-checked `type` getter only (its value is never read); shadow mode leaves element registrations alone.

import { describe, expect, it } from 'vitest';
import { LISTEN_EVENT_CODES, LISTEN_TARGET_KINDS } from '@detect-expert/contracts';
import type { ProtectLimitation, ScriptRef } from '@detect-expert/contracts';
import { createHookContext } from '../src/wrap';
import { installRegistrationHooks } from '../src/protect/registration-hooks';
import { HOOK_LISTEN, HOOK_OBSERVE, TARGET_INDEX } from '../src/protect/runtime';
import { captureStackIntrinsics, createStackSampler } from '../src/protect/stack';
import { PROTECT_HOOK_DECISION } from '../src/protect/config';
import type { ListenHookMode, WrapHookMode } from '../src/protect/config';
import { makeRealm, trapCounter, withoutPrepareStackTrace } from './protect-fakes';

const CDN = 'https://cdn.replay.example.net/rec/v3/recorder.js';

interface Reg {
  hook: string;
  event: string | null;
  target: string;
  script: ScriptRef | null;
  sampled: boolean;
}

function setup(config: { listen: ListenHookMode; observe: WrapHookMode } = { listen: 'prototype', observe: 'wrap' }) {
  const fr = makeRealm();
  const regs: Reg[] = [];
  const limitations: ProtectLimitation[] = [];
  const scripts: ScriptRef[] = [{ kind: 'unknown' }];
  let samples = 0;
  const runtime = {
    noteRegistration: (hook: number, eventIndex: number, targetIndex: number, scriptId: number, sampled: boolean) => {
      regs.push({
        hook: hook === HOOK_LISTEN ? 'listen' : hook === HOOK_OBSERVE ? 'observe-document' : '?',
        event: eventIndex >= 0 ? LISTEN_EVENT_CODES[eventIndex]! : null,
        target: LISTEN_TARGET_KINDS[targetIndex]!,
        script: scriptId >= 0 ? scripts[scriptId]! : null,
        sampled,
      });
    },
    internScript: (ref: ScriptRef) => {
      samples++;
      scripts.push(ref);
      return scripts.length - 1;
    },
    addLimitation: (code: ProtectLimitation) => {
      if (!limitations.includes(code)) limitations.push(code);
    },
  };
  const context = createHookContext();
  const sampler = createStackSampler(captureStackIntrinsics(fr.realm), { now: () => 0, docHost: 'shop.example.com', earlyCapture: true });
  const results = installRegistrationHooks({ realm: fr.realm, runtime, sampler, context, config });
  return { fr, regs, limitations, results, context, samples: () => samples };
}

const r = (o: object) => o as Record<string, (...a: unknown[]) => unknown>;

describe('target index layout', () => {
  it('TARGET_INDEX follows LISTEN_TARGET_KINDS', () => {
    for (const [kind, i] of Object.entries(TARGET_INDEX)) expect(LISTEN_TARGET_KINDS[i]).toBe(kind);
  });
});

describe('addEventListener (prototype mode)', () => {
  it('untracked or non-string types cost only the filter: original called once, nothing noted', () => {
    const { fr, regs } = setup();
    const el = fr.newElement();
    const typeProxy = trapCounter();
    r(el)['addEventListener']!('click', () => undefined);
    r(el)['addEventListener']!('mouseenter', () => undefined, { passive: true });
    r(el)['addEventListener']!(typeProxy.proxy, () => undefined);
    expect(fr.calls.addEventListener).toBe(3);
    expect(regs).toEqual([]);
    expect(typeProxy.traps()).toBe(0);
  });

  it('target kinds: window, document, root, field, field-password, other; value never read, listener/options never read', () => {
    const { fr, regs } = setup();
    const listener = trapCounter(() => undefined);
    const options = trapCounter({ capture: true });
    const password = fr.newInput('password');
    const email = fr.newInput('email');
    const div = fr.newElement();
    r(fr.realm)['addEventListener']!('keydown', listener.proxy, options.proxy);
    r(fr.document)['addEventListener']!('input', listener.proxy);
    r(fr.documentElement)['addEventListener']!('scroll', listener.proxy);
    r(fr.body)['addEventListener']!('mousemove', listener.proxy);
    r(email)['addEventListener']!('change', listener.proxy);
    r(password)['addEventListener']!('keyup', listener.proxy);
    r(div)['addEventListener']!('wheel', listener.proxy);
    expect(regs.map((x) => [x.event, x.target])).toEqual([
      ['keydown', 'window'],
      ['input', 'document'],
      ['scroll', 'root'],
      ['mousemove', 'root'],
      ['change', 'field'],
      ['keyup', 'field-password'],
      ['wheel', 'other'],
    ]);
    expect(fr.calls.valueReads).toBe(0);
    expect(fr.calls.typeReads).toBe(2);
    expect(listener.traps()).toBe(0);
    expect(options.traps()).toBe(0);
    // The page saw exactly its own arguments.
    expect(fr.registered[0]).toEqual({ type: 'keydown', listener: listener.proxy, options: options.proxy });
    // Other elements are counted without a stack sample.
    expect(regs[6]).toMatchObject({ sampled: false, script: null });
  });

  it('the listener caches its sampled script: the same listener is sampled once', () => {
    const { fr, regs, samples } = setup();
    const listener = (): void => undefined;
    withoutPrepareStackTrace(() => {
      fr.runAs(CDN, 'realm.addEventListener("keydown", l); realm.document.addEventListener("keyup", l); realm.addEventListener("input", l);', { realm: fr.realm, l: listener });
    });
    expect(samples()).toBe(1);
    expect(regs.map((x) => x.script)).toEqual(Array(3).fill({ kind: 'external', scheme: 'https', host: 'cdn.replay.example.net', pathTemplate: '/rec/v3/recorder.js' }));
    expect(regs.every((x) => x.sampled)).toBe(true);
  });

  it('a throwing original (illegal this) is rethrown as is and noted nowhere', () => {
    const { fr, regs } = setup();
    const proto = (fr.realm as unknown as { EventTarget: { prototype: object } }).EventTarget.prototype;
    const fakeThis = trapCounter();
    expect(() => r(proto)['addEventListener']!.call(fakeThis.proxy, 'input', () => undefined)).toThrow(TypeError);
    expect(fakeThis.traps()).toBe(0);
    expect(regs).toEqual([]);
  });

  it('review W4: no page code runs in the observer — an absent args[0] is never read; a Proxy prototype of the target is never walked', () => {
    const { fr, regs } = setup();
    const proto = (fr.realm as unknown as { EventTarget: { prototype: Record<string, unknown> } }).EventTarget.prototype;
    const add = proto['addEventListener'] as (...a: unknown[]) => unknown;
    // (a) An inherited index getter (the page's) is never reached through our arguments object.
    let getterRuns = 0;
    Object.defineProperty(Object.prototype, '0', {
      configurable: true,
      get: () => {
        getterRuns++;
        return 'input';
      },
      set(this: object, v: unknown) {
        Object.defineProperty(this, '0', { value: v, writable: true, enumerable: true, configurable: true });
      },
    });
    try {
      try {
        add.call(fr.document);
      } catch {
        // The original decides; the observer reads nothing either way.
      }
      add.call(fr.realm, 'keydown');
    } finally {
      delete (Object.prototype as Record<string, unknown>)['0'];
    }
    expect(getterRuns).toBe(0);
    // (b) A page Proxy as the prototype of an element: the observer takes one prototype step (the element's own,
    // ordinary [[GetPrototypeOf]]) and no trap of the Proxy runs.
    const el = fr.newElement();
    const proxyProto = trapCounter(Object.getPrototypeOf(el) as object);
    Object.setPrototypeOf(el, proxyProto.proxy);
    add.call(el, 'input', () => undefined);
    expect(proxyProto.traps()).toBe(0);
    expect(regs.map((x) => [x.event, x.target])).toEqual([['keydown', 'window'], ['input', 'other']]);
  });

  it('a later page patch of the prototype runs exactly once and still reaches the original once', () => {
    const { fr, regs } = setup();
    const proto = (fr.realm as unknown as { EventTarget: { prototype: Record<string, unknown> } }).EventTarget.prototype;
    const ours = proto['addEventListener'] as (...a: unknown[]) => unknown;
    let pageCalls = 0;
    proto['addEventListener'] = function (this: unknown, ...args: unknown[]) {
      pageCalls++;
      return ours.apply(this, args);
    };
    r(fr.document)['addEventListener']!('input', () => undefined);
    expect(pageCalls).toBe(1);
    expect(fr.calls.addEventListener).toBe(1);
    expect(regs).toHaveLength(1);
  });

  it('removeEventListener is not wrapped', () => {
    const { fr } = setup();
    const proto = (fr.realm as unknown as { EventTarget: { prototype: object } }).EventTarget.prototype;
    expect(Object.getOwnPropertyDescriptor(proto, 'removeEventListener')?.value.name).toBe('removeEventListener');
  });
});

describe('MutationObserver.observe', () => {
  it('only the document and its root elements; options are never read', () => {
    const { fr, regs } = setup();
    const mo = fr.newObserver();
    const options = trapCounter({ childList: true });
    r(mo)['observe']!(fr.document, options.proxy);
    r(mo)['observe']!(fr.body, options.proxy);
    r(mo)['observe']!(fr.newElement(), options.proxy);
    expect(fr.calls.observe).toBe(3);
    expect(regs.map((x) => [x.hook, x.event, x.target])).toEqual([['observe-document', null, 'document'], ['observe-document', null, 'root']]);
    expect(options.traps()).toBe(0);
  });
});

describe('modes', () => {
  it('off: nothing wrapped, listener-hook-off / mo-hook-off limitations', () => {
    const { results, limitations, fr } = setup({ listen: 'off', observe: 'off' });
    expect(results).toEqual([]);
    expect(limitations).toEqual(['listener-hook-off', 'mo-hook-off']);
    const proto = (fr.realm as unknown as { EventTarget: { prototype: object } }).EventTarget.prototype;
    expect(Object.getOwnPropertyDescriptor(proto, 'addEventListener')?.value.name).toBe('addEventListener');
  });

  it('shadow: own wrappers on window and document only; elements untouched; restore removes the own property', () => {
    const { fr, regs, results, limitations } = setup({ listen: 'shadow', observe: 'off' });
    expect(results.map((x) => x.status)).toEqual(['installed', 'installed']);
    expect(Object.getOwnPropertyDescriptor(fr.realm, 'addEventListener')).toBeDefined();
    expect(Object.getOwnPropertyDescriptor(fr.document, 'addEventListener')).toBeDefined();
    r(fr.realm)['addEventListener']!('keydown', () => undefined);
    r(fr.document)['addEventListener']!('input', () => undefined);
    r(fr.newInput('password'))['addEventListener']!('input', () => undefined);
    expect(fr.calls.addEventListener).toBe(3);
    expect(regs.map((x) => x.target)).toEqual(['window', 'document']);
    expect(limitations).toContain('element-listeners-not-observed');
    // A page patch of the prototype installed after the shadow still runs once per window call.
    const proto = (fr.realm as unknown as { EventTarget: { prototype: Record<string, unknown> } }).EventTarget.prototype;
    const original = proto['addEventListener'] as (...a: unknown[]) => unknown;
    let pageCalls = 0;
    proto['addEventListener'] = function (this: unknown, ...args: unknown[]) {
      pageCalls++;
      return original.apply(this, args);
    };
    r(fr.realm)['addEventListener']!('scroll', () => undefined);
    expect(pageCalls).toBe(1);
    expect(fr.calls.addEventListener).toBe(4);
    for (const h of results) if (h.status === 'installed') expect(h.restore()).toBe(true);
    expect(Object.getOwnPropertyDescriptor(fr.realm, 'addEventListener')).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(fr.document, 'addEventListener')).toBeUndefined();
  });

  it('release decision of the perf gate (2026-10-18: listen off, observe wrap): only MutationObserver.observe is wrapped', () => {
    const { fr, regs, results, limitations } = setup({ listen: PROTECT_HOOK_DECISION.listen, observe: PROTECT_HOOK_DECISION.observe });
    expect(results.map((x) => x.status)).toEqual(['installed']);
    const proto = (fr.realm as unknown as { EventTarget: { prototype: object } }).EventTarget.prototype;
    expect(Object.getOwnPropertyDescriptor(proto, 'addEventListener')?.value.name).toBe('addEventListener');
    expect(Object.getOwnPropertyDescriptor(fr.document, 'addEventListener')).toBeUndefined();
    r(fr.document)['addEventListener']!('keydown', () => undefined);
    r(fr.newObserver())['observe']!(fr.document, { childList: true });
    expect(fr.calls.addEventListener).toBe(1);
    expect(fr.calls.observe).toBe(1);
    expect(regs.map((x) => [x.hook, x.target])).toEqual([['observe-document', 'document']]);
    expect(limitations).toContain('listener-hook-off');
    expect(limitations).not.toContain('mo-hook-off');
  });
});
