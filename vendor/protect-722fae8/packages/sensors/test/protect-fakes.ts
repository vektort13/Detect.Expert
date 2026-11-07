// Test-only fake MAIN realm for the module's hooks (ADR-020 §F, S10): Node has no DOM, so EventTarget, Document,
// HTMLInputElement, MutationObserver, XMLHttpRequest, Navigator, HTMLImageElement and a global fetch are plain classes
// whose methods brand-check `this` (like WebIDL) and count their calls. The realm's Error / Function / Object are the
// real V8 intrinsics (stack sampling is real); Request and URL use private-field brand checks (no Proxy trap).
// Never bundled.

import vm from 'node:vm';

export interface PageCalls {
  fetch: number;
  xhrOpen: number;
  xhrSend: number;
  beacon: number;
  imgSrc: number;
  addEventListener: number;
  removeEventListener: number;
  observe: number;
  /** Reads of HTMLInputElement.prototype.value (must stay 0: the module never reads a value). */
  valueReads: number;
  /** Reads of HTMLInputElement.prototype.type (the brand check of the registration hook). */
  typeReads: number;
}

export interface FakeRealm {
  realm: Window & typeof globalThis;
  calls: PageCalls;
  /** Registrations the fake EventTarget recorded (what the page would see). */
  registered: Array<{ type: unknown; listener: unknown; options: unknown }>;
  document: object;
  documentElement: object;
  body: object;
  newInput(type: string): object;
  newElement(): object;
  newXhr(): object;
  newImage(): object;
  newObserver(): object;
  /** Runs `code` as a script whose stack frames carry `filename` (V8 sourceURL of a real script). */
  runAs<T>(filename: string, code: string, bindings?: Record<string, unknown>): T;
}

export function makeRealm(): FakeRealm {
  const calls: PageCalls = { fetch: 0, xhrOpen: 0, xhrSend: 0, beacon: 0, imgSrc: 0, addEventListener: 0, removeEventListener: 0, observe: 0, valueReads: 0, typeReads: 0 };
  const registered: FakeRealm['registered'] = [];
  const targets = new WeakSet<object>();
  const inputs = new WeakMap<object, string>();
  const xhrs = new WeakSet<object>();
  const observers = new WeakSet<object>();
  const images = new WeakSet<object>();

  function illegal(): never {
    throw new TypeError('Illegal invocation');
  }

  class EventTarget {
    constructor() {
      targets.add(this);
    }
    addEventListener(type: unknown, listener: unknown, options?: unknown): void {
      if (!targets.has(this as object)) illegal();
      calls.addEventListener++;
      registered.push({ type, listener, options });
    }
    removeEventListener(): void {
      if (!targets.has(this as object)) illegal();
      calls.removeEventListener++;
    }
  }
  class Node extends EventTarget {}
  class Element extends Node {}
  class HTMLElement extends Element {}
  class HTMLInputElement extends HTMLElement {
    get type(): string {
      const t = inputs.get(this);
      if (t === undefined) illegal();
      calls.typeReads++;
      return t;
    }
    get value(): string {
      if (!inputs.has(this)) illegal();
      calls.valueReads++;
      return 'secret-value';
    }
  }
  class HTMLImageElement extends HTMLElement {
    #src = '';
    get src(): string {
      if (!images.has(this)) illegal();
      return this.#src;
    }
    set src(v: string) {
      if (!images.has(this)) illegal();
      calls.imgSrc++;
      this.#src = String(v);
    }
  }
  const documentElement = new HTMLElement();
  const body = new HTMLElement();
  class Document extends Node {
    get documentElement(): object {
      if (this !== doc) illegal();
      return documentElement;
    }
    get body(): object {
      if (this !== doc) illegal();
      return body;
    }
  }
  const doc = new Document();
  class MutationObserver {
    constructor() {
      observers.add(this);
    }
    observe(_target: unknown, _options?: unknown): void {
      if (!observers.has(this)) illegal();
      calls.observe++;
    }
  }
  class XMLHttpRequest extends EventTarget {
    constructor() {
      super();
      xhrs.add(this);
    }
    open(_method: unknown, _url: unknown): void {
      if (!xhrs.has(this)) illegal();
      calls.xhrOpen++;
    }
    send(_body?: unknown): void {
      if (!xhrs.has(this)) illegal();
      calls.xhrSend++;
    }
  }
  class Navigator {
    sendBeacon(_url: unknown, _data?: unknown): boolean {
      if (this !== nav) illegal();
      calls.beacon++;
      return true;
    }
  }
  const nav = new Navigator();
  // Request / URL with private-field brand checks, like the browser's native getters: a Proxy or a plain object fails
  // them with a TypeError and no trap (Node's own Request getter is JS and would walk the prototype chain).
  class Request {
    readonly #url: string;
    constructor(url: string) {
      this.#url = url;
    }
    get url(): string {
      return this.#url;
    }
  }
  class URL {
    readonly #href: string;
    constructor(href: string) {
      this.#href = href;
    }
    get href(): string {
      return this.#href;
    }
  }

  const realm = new EventTarget() as unknown as Record<string, unknown>;
  const define = (key: string, value: unknown): void => {
    Object.defineProperty(realm, key, { value, writable: true, enumerable: false, configurable: true });
  };
  for (const [k, v] of Object.entries({ EventTarget, Node, Element, HTMLElement, HTMLInputElement, HTMLImageElement, Document, MutationObserver, XMLHttpRequest, Navigator })) define(k, v);
  define('Error', Error);
  define('Function', Function);
  define('Object', Object);
  define('Request', Request);
  define('URL', URL);
  // window.fetch: an own data property of the global; returns a fresh Promise (identity checked by the tests).
  define('fetch', function fetchImpl(_input: unknown, _init?: unknown): Promise<string> {
    calls.fetch++;
    return Promise.resolve('response');
  });
  Object.defineProperty(realm, 'document', { get: () => doc, enumerable: true, configurable: false });
  Object.defineProperty(realm, 'navigator', { get: () => nav, enumerable: true, configurable: true });

  return {
    realm: realm as unknown as Window & typeof globalThis,
    calls,
    registered,
    document: doc,
    documentElement,
    body,
    newInput(type) {
      const el = new HTMLInputElement();
      inputs.set(el, type);
      return el;
    },
    newElement: () => new HTMLElement(),
    newXhr: () => new XMLHttpRequest(),
    newImage() {
      const img = new HTMLImageElement();
      images.add(img);
      return img;
    },
    newObserver: () => new MutationObserver(),
    runAs<T>(filename: string, code: string, bindings: Record<string, unknown> = {}): T {
      const names = Object.keys(bindings);
      const fn = vm.runInThisContext('(function (' + names.join(', ') + ') {\n' + code + '\n})', { filename }) as (...args: unknown[]) => T;
      return fn(...names.map((n) => bindings[n]));
    },
  };
}

/** Removes a test-runner `prepareStackTrace` (source maps) for the duration of `fn`: the sampler refuses one. */
export function withoutPrepareStackTrace<T>(fn: () => T): T {
  const d = Object.getOwnPropertyDescriptor(Error, 'prepareStackTrace');
  if (d !== undefined) delete (Error as unknown as Record<string, unknown>)['prepareStackTrace'];
  try {
    return fn();
  } finally {
    if (d !== undefined) Object.defineProperty(Error, 'prepareStackTrace', d);
  }
}

/** A Proxy that counts every trap (0 expected: the module never reads a page object it does not own). */
export function trapCounter(target: object = {}): { proxy: object; traps: () => number } {
  let traps = 0;
  const handler: ProxyHandler<object> = {};
  for (const trap of ['get', 'set', 'has', 'ownKeys', 'getOwnPropertyDescriptor', 'defineProperty', 'deleteProperty', 'getPrototypeOf', 'setPrototypeOf', 'isExtensible', 'preventExtensions', 'apply', 'construct'] as const) {
    (handler as Record<string, unknown>)[trap] = (...args: unknown[]) => {
      traps++;
      return (Reflect as unknown as Record<string, (...a: unknown[]) => unknown>)[trap]!(...args);
    };
  }
  return { proxy: new Proxy(target, handler), traps: () => traps };
}

/** An object whose coercion hooks count calls (toString, valueOf, Symbol.toPrimitive). */
export function coercionSpy(): { value: object; coercions: () => number } {
  let n = 0;
  const value = {
    toString() {
      n++;
      return 'https://cdn.example.net/coerced';
    },
    valueOf() {
      n++;
      return 1;
    },
    [Symbol.toPrimitive]() {
      n++;
      return 'https://cdn.example.net/coerced';
    },
  };
  return { value, coercions: () => n };
}
