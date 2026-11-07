// ADR-050 / audit F1: production adapter; the 722fae8 vendor snapshot remains unchanged.
// Test-profile password tripwire of the module «Защита» (ADR-020 §12, §15; S05). Built only by `--profile test`
// (protect-tripwire.isolated.js / protect-tripwire.main.js) and registered FIRST in each world of the module's
// registrations by the test branch of the SW entry; dist/local never contains it (scripts/release-verify.mjs).
// It wraps every page-input reader that could reveal a password and counts reads whose target is a password field now
// or at any time before (own WeakSet + MutationObserver on `type`):
//   HTMLInputElement.prototype.value / valueAsNumber / valueAsDate, HTMLTextAreaElement.prototype.value (getters);
//   InputEvent.prototype.data / dataTransfer, KeyboardEvent key / code / keyCode / charCode / which (getters; target =
//   the event's innermost target); DataTransfer.prototype.getData (target = the focused element);
//   Element.prototype.getAttribute('value'); the FormData constructor (target = a password control of the form).
// Counters go to document.documentElement.dataset.pwTripwireIsolated / pwTripwireMain as JSON
// {hits, selfCheck, nonPasswordReads}. Self-check at install: reading `value` of a detached password input sets
// selfCheck = 1 and is not a hit. Wrappers call the original exactly once with the same `this` and arguments and
// return its result (exceptions propagate); `toString`, `name` and `length` are not masked (REQ-002/003). The tripwire
// itself reads no value: it only classifies the target through captured originals.

type TripwireWorld = 'isolated' | 'main';

interface TypeRecord {
  readonly target: unknown;
  readonly oldValue: string | null;
}

/** Marker of "this read is not about a page element" (the method wrapper counts nothing). */
const SKIP: unique symbol = Symbol('skip');

export function installPasswordTripwire(world: TripwireWorld): void {
  const g = globalThis as unknown as Record<PropertyKey, unknown>;
  const gopd = Object.getOwnPropertyDescriptor;
  const define = Object.defineProperty;
  const getPrototypeOf = Object.getPrototypeOf;
  const apply = Reflect.apply;
  const construct = Reflect.construct;
  const stringify = JSON.stringify;
  const toLower = String.prototype.toLowerCase;
  const trim = String.prototype.trim;
  const weakHas = WeakSet.prototype.has;
  const weakAdd = WeakSet.prototype.add;

  // One tripwire per world (a second registration of the same file must not double-count).
  const mark = Symbol.for('detect.expert/protect-tripwire/' + world);
  if (gopd(g, mark) !== undefined) return;
  define(g, mark, { value: true, writable: false, enumerable: false, configurable: false });

  const datasetKey = world === 'isolated' ? 'pwTripwireIsolated' : 'pwTripwireMain';
  const getAttribute = Element.prototype.getAttribute;
  const setAttribute = Element.prototype.setAttribute;
  const localNameGet = gopd(Element.prototype, 'localName')?.get;
  const composedPath = Event.prototype.composedPath;
  const eventTargetGet = gopd(Event.prototype, 'target')?.get;
  const activeElementGet = gopd(Document.prototype, 'activeElement')?.get;
  const formElementsGet = gopd(HTMLFormElement.prototype, 'elements')?.get;
  const documentElementGet = gopd(Document.prototype, 'documentElement')?.get;
  const getRootNode = Node.prototype.getRootNode;
  const connectedGet = gopd(Node.prototype, 'isConnected')?.get;
  const queryControls = Document.prototype.querySelectorAll;
  const addEventListener = EventTarget.prototype.addEventListener;
  const takeRecords = MutationObserver.prototype.takeRecords;
  const observe = MutationObserver.prototype.observe;
  const doc = document;

  const counters = { hits: 0, selfCheck: 0, nonPasswordReads: 0 };
  const seen = new WeakSet<object>();
  const tracked = new WeakSet<object>();
  let trackedCount = 0;
  let observationHealthy = true;
  let selfChecking = false;
  let publishDeferred = false;
  let observer: MutationObserver | null = null;

  function lower(s: string): string {
    return apply(trim, apply(toLower, s, []), []) as string;
  }

  function isElement(x: unknown): x is Element {
    if (typeof x !== 'object' || x === null || localNameGet === undefined) return false;
    try {
      return typeof apply(localNameGet, x, []) === 'string';
    } catch {
      return false;
    }
  }

  function typeOf(el: Element): string {
    try {
      const t: unknown = apply(getAttribute, el, ['type']);
      return typeof t === 'string' ? lower(t) : '';
    } catch {
      return '';
    }
  }

  function ingest(records: readonly TypeRecord[]): void {
    for (const r of records) {
      const t = r.target;
      if (!isElement(t)) continue;
      const old = r.oldValue;
      if ((typeof old === 'string' && lower(old) === 'password') || typeOf(t) === 'password') apply(weakAdd, seen, [t]);
    }
  }

  // Independent of the production classifier: retain type observation on each
  // discovered light-DOM field, including while detached. Other roots are
  // conservatively treated as sensitive by the tripwire, never as a clean read.
  function discoverControls(): void {
    if (observer === null) return;
    try {
      const controls = apply(queryControls, doc, ['input,select,textarea']) as NodeListOf<Element>;
      if (controls.length > 512) { observationHealthy = false; return; }
      for (let index = 0; index < controls.length; index++) {
        const control = controls[index];
        if (control === undefined || apply(weakHas, tracked, [control])) continue;
        if (trackedCount >= 512) { observationHealthy = false; return; }
        apply(observe, observer, [control, { attributes: true, attributeFilter: ['type'], attributeOldValue: true }]);
        apply(weakAdd, tracked, [control]); trackedCount++;
        if (typeOf(control) === 'password') apply(weakAdd, seen, [control]);
      }
    } catch { observationHealthy = false; }
  }

  /** A password field now, or one that was a password at any time while observed. */
  function isPasswordish(x: unknown): boolean {
    if (!isElement(x)) return false;
    if (observer !== null) {
      try {
        ingest(apply(takeRecords, observer, []) as MutationRecord[]);
      } catch {
        observationHealthy = false;
      }
    }
    discoverControls();
    if (apply(weakHas, seen, [x]) as boolean) return true;
    if (typeOf(x) === 'password') {
      apply(weakAdd, seen, [x]);
      return true;
    }
    // A missing observer or an unobserved/detached/shadow target cannot be
    // counted as a known non-password positive control.
    try {
      const name = localNameGet === undefined ? '' : apply(localNameGet, x, []);
      if ((name === 'input' || name === 'select' || name === 'textarea') &&
        (!observationHealthy || observer === null || connectedGet === undefined ||
        apply(connectedGet, x, []) !== true || apply(getRootNode, x, []) !== doc || !apply(weakHas, tracked, [x]))) return true;
    } catch { return true; }
    return false;
  }

  function publish(): void {
    try {
      const root = documentElementGet === undefined ? null : (apply(documentElementGet, doc, []) as Element | null);
      if (root === null || !(root instanceof HTMLElement)) {
        if (!publishDeferred) {
          publishDeferred = true;
          apply(addEventListener, doc, ['DOMContentLoaded', publish, { once: true }]);
        }
        return;
      }
      root.dataset[datasetKey] = stringify({ hits: counters.hits, selfCheck: counters.selfCheck, nonPasswordReads: counters.nonPasswordReads });
    } catch {
      // The counters stay in memory; the next read publishes again.
    }
  }

  function note(target: unknown): void {
    if (isPasswordish(target)) {
      if (selfChecking) counters.selfCheck = 1;
      else counters.hits++;
    } else if (isElement(target)) {
      counters.nonPasswordReads++;
    } else {
      return;
    }
    publish();
  }

  function eventTargetOf(event: unknown): unknown {
    try {
      const path = apply(composedPath, event, []) as unknown[];
      if (path.length > 0) return path[0];
    } catch {
      // Not an event: fall through.
    }
    try {
      return eventTargetGet === undefined ? null : apply(eventTargetGet, event, []);
    } catch {
      return null;
    }
  }

  function activeElement(): unknown {
    try {
      return activeElementGet === undefined ? null : apply(activeElementGet, doc, []);
    } catch {
      return null;
    }
  }

  /** A password control of the form when there is one (the hit), else the form itself (a non-password read). */
  function formTarget(form: unknown): unknown {
    if (formElementsGet === undefined || !(form instanceof HTMLFormElement)) return form;
    try {
      const controls = apply(formElementsGet, form, []) as ArrayLike<unknown>;
      const n = Math.min(controls.length, 512);
      for (let i = 0; i < n; i++) if (isPasswordish(controls[i])) return controls[i];
    } catch {
      // Count the form itself.
    }
    return form;
  }

  /** Finds the owner of `key` on the prototype chain starting at `proto`. */
  function ownerOf(proto: object | undefined, key: string): object | undefined {
    for (let p: object | null | undefined = proto; p !== null && p !== undefined; p = getPrototypeOf(p) as object | null) {
      if (gopd(p, key) !== undefined) return p;
    }
    return undefined;
  }

  function wrapGetter(proto: object | undefined, key: string, targetOf: (self: unknown) => unknown): void {
    const owner = ownerOf(proto, key);
    if (owner === undefined) return;
    const d = gopd(owner, key);
    if (d === undefined || typeof d.get !== 'function' || d.configurable !== true) return;
    const original = d.get;
    const tripwireGet = function (this: unknown): unknown {
      const result: unknown = apply(original, this, []);
      try {
        note(targetOf(this));
      } catch {
        // Counting never changes the read.
      }
      return result;
    };
    define(owner, key, { get: tripwireGet, ...(d.set === undefined ? {} : { set: d.set }), enumerable: d.enumerable === true, configurable: true });
  }

  function wrapMethod(proto: object | undefined, key: string, targetOf: (self: unknown, args: readonly unknown[]) => unknown): void {
    if (proto === undefined) return;
    const d = gopd(proto, key);
    if (d === undefined || typeof d.value !== 'function' || d.configurable !== true) return;
    const original = d.value as (...args: unknown[]) => unknown;
    const tripwireMethod = function (this: unknown, ...args: unknown[]): unknown {
      const result: unknown = apply(original, this, args);
      try {
        const target = targetOf(this, args);
        if (target !== SKIP) note(target);
      } catch {
        // Counting never changes the call.
      }
      return result;
    };
    define(proto, key, { value: tripwireMethod, writable: d.writable === true, enumerable: d.enumerable === true, configurable: true });
  }

  function wrapFormData(): void {
    const d = gopd(g, 'FormData');
    const original = d?.value as (new (...args: unknown[]) => object) | undefined;
    if (d === undefined || typeof original !== 'function' || d.configurable !== true) return;
    const tripwireFormData = function (this: unknown, ...args: unknown[]): unknown {
      if (new.target === undefined) return apply(original, this, args); // the native constructor throws the TypeError
      const result = construct(original, args, new.target) as object;
      try {
        if (args.length > 0 && args[0] !== undefined && args[0] !== null) note(formTarget(args[0]));
      } catch {
        // Counting never changes the construction.
      }
      return result;
    };
    tripwireFormData.prototype = original.prototype;
    define(g, 'FormData', { value: tripwireFormData, writable: d.writable === true, enumerable: d.enumerable === true, configurable: true });
  }

  try {
    observer = new MutationObserver((records) => { ingest(records); discoverControls(); });
    apply(observe, observer, [doc, { subtree: true, childList: true, attributes: true, attributeFilter: ['type'], attributeOldValue: true }]);
    discoverControls();
  } catch {
    observer = null;
  }

  const self = (x: unknown): unknown => x;
  wrapGetter(HTMLInputElement.prototype, 'value', self);
  wrapGetter(HTMLInputElement.prototype, 'valueAsNumber', self);
  wrapGetter(HTMLInputElement.prototype, 'valueAsDate', self);
  wrapGetter(HTMLTextAreaElement.prototype, 'value', self);
  wrapGetter(InputEvent.prototype, 'data', eventTargetOf);
  wrapGetter(InputEvent.prototype, 'dataTransfer', eventTargetOf);
  for (const key of ['key', 'code', 'keyCode', 'charCode', 'which']) wrapGetter(KeyboardEvent.prototype, key, eventTargetOf);
  wrapMethod(DataTransfer.prototype, 'getData', () => activeElement());
  wrapMethod(Element.prototype, 'getAttribute', (el, args) => (typeof args[0] === 'string' && lower(args[0]) === 'value' ? el : SKIP));
  wrapFormData();

  // Self-check (positive control of the wrapper itself): a detached password input read through the wrapped getter.
  try {
    const probe = doc.createElement('input');
    apply(setAttribute, probe, ['type', 'password']);
    selfChecking = true;
    void probe.value;
  } catch {
    // selfCheck stays 0: the spec fails on it.
  } finally {
    selfChecking = false;
  }
  publish();
}
