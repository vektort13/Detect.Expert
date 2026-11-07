// ADR-020 §F (S10): send hooks (fetch, XHR open/send, sendBeacon, image src). REQ-002: the original is called exactly
// once with the same this and arguments, its result / Promise identity / exception are returned as is; the observer
// runs only after a call that did not throw; no argument is coerced and no page object (Proxy, init, body, data) is
// read. Stack samples come from real V8 (vm scripts carry an https:// filename like a page script).

import { describe, expect, it } from 'vitest';
import type { ProtectLimitation, ProtectSendHookPoint, ScriptRef, SendTarget } from '@detect-expert/contracts';
import { createHookContext } from '../src/wrap';
import { installSendHooks } from '../src/protect/send-hooks';
import { captureStackIntrinsics, createStackSampler } from '../src/protect/stack';
import type { WrapHookMode } from '../src/protect/config';
import { coercionSpy, makeRealm, trapCounter, withoutPrepareStackTrace } from './protect-fakes';

const DOC = 'shop.example.com';
const CDN = 'https://cdn.tracker-a.example.org/lib/v2/collect.js';

interface Sample {
  hookPoint: ProtectSendHookPoint;
  script: ScriptRef;
  sampled: boolean;
  target: SendTarget;
}

function setup(config: { send: WrapHookMode; imgSrc: WrapHookMode } = { send: 'wrap', imgSrc: 'off' }, budgets?: { send: number; registration: number }) {
  const fr = makeRealm();
  let time = 1000;
  const samples: Sample[] = [];
  const limitations: ProtectLimitation[] = [];
  const runtime = {
    noteSend: (hookPoint: ProtectSendHookPoint, script: ScriptRef, sampled: boolean, target: SendTarget) => {
      samples.push({ hookPoint, script, sampled, target });
    },
    addLimitation: (code: ProtectLimitation) => {
      if (!limitations.includes(code)) limitations.push(code);
    },
  };
  const context = createHookContext();
  const sampler = createStackSampler(captureStackIntrinsics(fr.realm), { now: () => time, docHost: DOC, earlyCapture: true, ...(budgets ? { budgets } : {}) });
  const results = installSendHooks({ realm: fr.realm, runtime, sampler, context, docHost: DOC, config });
  return { fr, samples, limitations, context, results, advance: (ms: number) => (time += ms) };
}

const r = (o: object) => o as Record<string, (...a: unknown[]) => unknown>;

describe('install', () => {
  it('wraps fetch, XHR open/send and sendBeacon; the image setter only with imgSrc wrap; nothing with send off', () => {
    const on = setup();
    expect(on.results.map((x) => [x.label, x.status])).toEqual([['fetch', 'installed'], ['open', 'installed'], ['send', 'installed'], ['sendBeacon', 'installed']]);
    expect(setup({ send: 'wrap', imgSrc: 'wrap' }).results.map((x) => x.label)).toEqual(['fetch', 'open', 'send', 'sendBeacon', 'src']);
    const off = setup({ send: 'off', imgSrc: 'off' });
    expect(off.results).toEqual([]);
    expect(Object.getOwnPropertyDescriptor(off.fr.realm, 'fetch')?.value.name).toBe('fetchImpl');
  });

  it('never masks: the wrapper is a different function and Function.prototype.toString is untouched', () => {
    const toString = Function.prototype.toString;
    const { fr } = setup();
    expect(Function.prototype.toString).toBe(toString);
    expect(toString.call(r(fr.realm)['fetch'])).not.toContain('[native code]');
  });
});

describe('fetch', () => {
  it('calls the original exactly once with the same this and arguments and returns the same Promise', () => {
    const fr = makeRealm();
    const seen: Array<{ self: unknown; args: unknown[] }> = [];
    const promise = Promise.resolve('x');
    Object.defineProperty(fr.realm, 'fetch', {
      value: function (this: unknown, ...args: unknown[]) {
        seen.push({ self: this, args });
        return promise;
      },
      writable: true,
      configurable: true,
    });
    const samples: unknown[] = [];
    installSendHooks({ realm: fr.realm, runtime: { noteSend: (...a: unknown[]) => samples.push(a), addLimitation: () => undefined }, sampler: createStackSampler(null, { now: () => 0, docHost: DOC, earlyCapture: false }), context: createHookContext(), docHost: DOC, config: { send: 'wrap', imgSrc: 'off' } });
    const input = 'https://collect.example.net/e';
    const init = { method: 'POST' };
    const result = r(fr.realm)['fetch']!.call(fr.realm, input, init);
    expect(result).toBe(promise);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.self).toBe(fr.realm);
    expect(seen[0]!.args[0]).toBe(input);
    expect(seen[0]!.args[1]).toBe(init);
    expect(samples).toHaveLength(1);
  });

  it('rethrows the same exception and samples nothing when the original throws', () => {
    const fr = makeRealm();
    const error = new TypeError('boom');
    Object.defineProperty(fr.realm, 'fetch', { value: () => { throw error; }, writable: true, configurable: true });
    const samples: unknown[] = [];
    installSendHooks({ realm: fr.realm, runtime: { noteSend: (...a: unknown[]) => samples.push(a), addLimitation: () => undefined }, sampler: createStackSampler(null, { now: () => 0, docHost: DOC, earlyCapture: false }), context: createHookContext(), docHost: DOC, config: { send: 'wrap', imgSrc: 'off' } });
    let caught: unknown;
    try {
      r(fr.realm)['fetch']!('https://collect.example.net/e');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(error);
    expect(samples).toEqual([]);
  });

  it('address: string, Request and URL through native getters; a Proxy, a toString object or init are never read', async () => {
    const { fr, samples, limitations } = setup();
    const fetch = r(fr.realm)['fetch']!;
    await fetch('https://Collect.Example.NET/v1?email=a@b.c');
    const realm = fr.realm as unknown as { Request: new (u: string) => object; URL: new (u: string) => object };
    await fetch(new realm.Request('https://api.example.org/x?token=t'));
    await fetch(new realm.URL('https://img.example.com/p.gif?id=1'));
    await fetch('/relative/path');
    const proxy = trapCounter();
    const init = trapCounter();
    await fetch(proxy.proxy, init.proxy);
    const spy = coercionSpy();
    await fetch(spy.value);
    await fetch('data:text/plain,abc');
    expect(samples.map((s) => s.target)).toEqual([
      { kind: 'absolute', host: 'collect.example.net' },
      { kind: 'absolute', host: 'api.example.org' },
      { kind: 'absolute', host: 'img.example.com' },
      { kind: 'relative' },
      { kind: 'unread' },
      { kind: 'unread' },
    ]);
    expect(proxy.traps()).toBe(0);
    expect(init.traps()).toBe(0);
    expect(spy.coercions()).toBe(0);
    expect(fr.calls.fetch).toBe(7);
    expect(limitations).toContain('target-unread');
    expect(JSON.stringify(samples)).not.toMatch(/email|token|id=1|abc|relative\/path/);
  });

  it('a call from a page script gets its ScriptRef (real V8 stack, wrapper frames omitted)', async () => {
    const { fr, samples } = setup();
    await withoutPrepareStackTrace(() => fr.runAs<Promise<unknown>>(CDN, 'return realm.fetch("https://collect.example.net/e");', { realm: fr.realm }));
    expect(samples[0]).toEqual({ hookPoint: 'send-fetch', sampled: true, script: { kind: 'external', scheme: 'https', host: 'cdn.tracker-a.example.org', pathTemplate: '/lib/v2/collect.js' }, target: { kind: 'absolute', host: 'collect.example.net' } });
    await withoutPrepareStackTrace(() => fr.runAs<Promise<unknown>>('https://shop.example.com/checkout', 'return realm.fetch("/api");', { realm: fr.realm }));
    expect(samples[1]?.script).toEqual({ kind: 'document' });
  });

  it('stack budget: 16 sampled sends per 1 s window, then unsampled with stack-budget; a new window samples again', () => {
    const { fr, samples, limitations, advance } = setup();
    withoutPrepareStackTrace(() => {
      for (let i = 0; i < 17; i++) fr.runAs(CDN, 'realm.fetch("https://collect.example.net/e");', { realm: fr.realm });
    });
    expect(samples.filter((s) => s.sampled)).toHaveLength(16);
    expect(samples[16]).toMatchObject({ sampled: false, script: { kind: 'unknown' } });
    expect(limitations).toContain('stack-budget');
    advance(1000);
    withoutPrepareStackTrace(() => fr.runAs(CDN, 'realm.fetch("https://collect.example.net/e");', { realm: fr.realm }));
    expect(samples[17]?.sampled).toBe(true);
  });

  it('paused (context disabled): the original still runs, nothing is observed', async () => {
    const { fr, samples, context } = setup();
    context.enabled = false;
    await r(fr.realm)['fetch']!('https://collect.example.net/e');
    expect(fr.calls.fetch).toBe(1);
    expect(samples).toEqual([]);
  });
});

describe('XMLHttpRequest', () => {
  it('open keeps only the masked address; send samples it; the body is never read', () => {
    const { fr, samples } = setup();
    const xhr = fr.newXhr();
    const body = trapCounter();
    expect(r(xhr)['open']!('POST', 'https://collect.example.net/v1?user=SECRET', true)).toBeUndefined();
    expect(r(xhr)['send']!(body.proxy)).toBeUndefined();
    expect(fr.calls.xhrOpen).toBe(1);
    expect(fr.calls.xhrSend).toBe(1);
    expect(body.traps()).toBe(0);
    expect(samples).toMatchObject([{ hookPoint: 'send-xhr', target: { kind: 'absolute', host: 'collect.example.net' } }]);
  });

  it('send without open -> unread; open to a non-network scheme -> no sample; a failing send -> no sample', () => {
    const { fr, samples } = setup();
    const a = fr.newXhr();
    r(a)['send']!();
    const b = fr.newXhr();
    r(b)['open']!('GET', 'data:text/plain,x');
    r(b)['send']!();
    expect(samples.map((s) => s.target)).toEqual([{ kind: 'unread' }]);
    const proto = (fr.realm as unknown as { XMLHttpRequest: { prototype: object } }).XMLHttpRequest.prototype;
    expect(() => r(proto)['send']!.call({})).toThrow(TypeError);
    expect(samples).toHaveLength(1);
  });
});

describe('sendBeacon and image src', () => {
  it('sendBeacon: original result returned, data never read', () => {
    const { fr, samples } = setup();
    const nav = (fr.realm as unknown as { navigator: object }).navigator;
    const data = trapCounter();
    expect(r(nav)['sendBeacon']!('https://collect.example.net/b', data.proxy)).toBe(true);
    expect(data.traps()).toBe(0);
    expect(samples).toMatchObject([{ hookPoint: 'send-beacon', target: { kind: 'absolute', host: 'collect.example.net' } }]);
  });

  it('image src setter (imgSrc wrap): the getter is untouched, the original setter runs once', () => {
    const { fr, samples } = setup({ send: 'off', imgSrc: 'wrap' });
    const proto = (fr.realm as unknown as { HTMLImageElement: { prototype: object } }).HTMLImageElement.prototype;
    const img = fr.newImage() as { src: string };
    img.src = 'https://pixel.example.net/p.gif?u=1';
    expect(img.src).toBe('https://pixel.example.net/p.gif?u=1');
    expect(fr.calls.imgSrc).toBe(1);
    expect(typeof Object.getOwnPropertyDescriptor(proto, 'src')?.get).toBe('function');
    expect(samples).toMatchObject([{ hookPoint: 'send-image', target: { kind: 'absolute', host: 'pixel.example.net' } }]);
  });
});
