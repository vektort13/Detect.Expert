// ADR-048: explicit, local test values. No hook is installed for an absent API.
// Keep the installer self-contained: the controller injects it with executeScript.
export function installApiCustom(realm, entries, nativeContext) {
  // The document bootstrap keeps this function private and invokes it before
  // page code. Descendant realms must reuse those same captured intrinsics even
  // if the parent page replaces globals before creating a frame or popup.
  const previous = installApiCustom.__detectExpertCustomIntrinsicsV1;
  const intrinsics = previous || {
    apply: Reflect.apply, getOwn: Object.getOwnPropertyDescriptor, getPrototype: Object.getPrototypeOf,
    define: Object.defineProperty, create: Object.create, setPrototype: Object.setPrototypeOf,
    remove: Reflect.deleteProperty, ownKeys: Reflect.ownKeys,
    arrayPrototype: Object.getPrototypeOf([]), objectPrototype: Object.getPrototypeOf({}),
    isArray: Array.isArray, freeze: Object.freeze, NativeWeakMap: WeakMap,
    weakGet: WeakMap.prototype.get, weakSet: WeakMap.prototype.set, promiseThen: Promise.prototype.then,
    NativePromise: Promise, promisePrototype: Promise.prototype, speciesSymbol: Symbol.species, NativeTypeError: TypeError,
    NativeString: String, charCode: String.prototype.charCodeAt, iteratorSymbol: Symbol.iterator, primitiveSymbol: Symbol.toPrimitive,
    asyncBoundaries: new WeakMap(),
    storageManagers: new WeakMap(), storageState: { count: 0 },
    quotaObjects: new WeakMap(), quotaState: { count: 0 },
    storageWindows: [], storageKnownWindows: new WeakMap(), storageAccess: { value: null },
    NativeWeakRef: typeof WeakRef === 'function' ? WeakRef : null,
    weakDeref: typeof WeakRef === 'function' ? WeakRef.prototype.deref : null,
    invalidStorageReceiver: Object.freeze(Object.create(null)), invalidUaReceiver: Object.freeze(Object.create(null))
  };
  if (!previous) {
    intrinsics.privatePromiseConstructor = intrinsics.freeze(intrinsics.define(intrinsics.create(null), intrinsics.speciesSymbol, { __proto__: null, value: intrinsics.NativePromise }));
    // A native task source for deprecated callback APIs, captured before page code: a microtask is not a task.
    try {
      const channel = MessageChannel.prototype, port = MessagePort.prototype, part = (target, key, name) => intrinsics.getOwn(target, key)[name];
      intrinsics.task = { Channel: MessageChannel, first: part(channel, 'port1', 'get'), second: part(channel, 'port2', 'get'),
        post: part(port, 'postMessage', 'value'), listen: part(port, 'onmessage', 'set'), close: part(port, 'close', 'value') };
      const keys = ['Channel', 'first', 'second', 'post', 'listen', 'close'];
      for (let index = 0; index < keys.length; index++) if (typeof intrinsics.task[keys[index]] !== 'function') throw 0;
    } catch { intrinsics.task = null; }
    intrinsics.define(installApiCustom, '__detectExpertCustomIntrinsicsV1', { __proto__: null, value: intrinsics.freeze(intrinsics) });
  }
  const { apply, getOwn, getPrototype, define, create, setPrototype, remove, ownKeys, isArray, freeze, NativeWeakMap, weakGet, weakSet, promiseThen } = intrinsics;
  const LIMIT = 65535, HANDLE_LIMIT = 4096;
  const handles = [], results = [];
  // A transform that returns this marker leaves the native result and the change counter untouched (see media-enumeration).
  const UNCHANGED = freeze(create(null));
  const state = { installed: 0, unavailable: 0, changed: 0, stopped: false };
  // ADR-084: inherited installations use target-realm public values without
  // invoking its constructors or consulting later page replacements.
  const targetArrayPrototype = realmPrototype('Array', intrinsics.arrayPrototype);
  const targetObjectPrototype = realmPrototype('Object', intrinsics.objectPrototype);
  let current;
  function push(array, value) {
    define(array, array.length, { __proto__: null, value, configurable: true, enumerable: true, writable: true });
  }
  function own(target, key) {
    if ((typeof target !== 'object' || target === null) && typeof target !== 'function') return;
    const descriptor = getOwn(target, key);
    return descriptor && getOwn(descriptor, 'value') ? descriptor.value : undefined;
  }
  function prototype(name) { return own(own(realm, name) || (name === 'Navigator' ? own(realm, 'WorkerNavigator') : undefined), 'prototype') || null; }
  function realmPrototype(name, fallback) {
    const value = prototype(name);
    return value !== null && (typeof value === 'object' || typeof value === 'function') ? value : fallback;
  }
  function asyncBoundary(target) {
    const previous = apply(weakGet, intrinsics.asyncBoundaries, [target]);
    if (previous) return previous;
    let result = { safe: false };
    try {
      const fields = [], chains = [];
      const data = (object, key) => {
        const field = getOwn(object, key);
        if (!field || !getOwn(field, 'value')) throw 0;
        push(fields, { object, key, value: field.value, absent: false });
        return field.value;
      };
      const chain = (start, key) => {
        let value = start;
        for (let depth = 0; value !== null; depth++) {
          if (depth >= 16) throw 0;
          const field = getOwn(value, key), parent = getPrototype(value);
          if (field && (!getOwn(field, 'value') || typeof field.value === 'function')) throw 0;
          push(chains, { object: value, parent, key, entry: field ? { value: field.value } : null });
          if (field) break;
          value = parent;
        }
      };
      const P = data(target, 'Promise'), O = data(target, 'Object'), A = data(target, 'Array');
      if (typeof P !== 'function' || typeof O !== 'function' || typeof A !== 'function') throw 0;
      const promise = data(P, 'prototype'), object = data(O, 'prototype'), array = data(A, 'prototype');
      if (!promise || !object || !array || typeof promise !== 'object' || typeof object !== 'object' || typeof array !== 'object' || data(promise, 'constructor') !== P) throw 0;
      const methods = [[promise, 'then'], [promise, 'catch'], [promise, 'finally']];
      for (let index = 0; index < methods.length; index++) if (typeof data(methods[index][0], methods[index][1]) !== 'function') throw 0;
      const statics = ['resolve', 'reject', 'all', 'allSettled', 'any', 'race', 'withResolvers', 'try'];
      for (let index = 0; index < statics.length; index++) {
        const key = statics[index], field = getOwn(P, key);
        if (!field && key !== 'resolve') { push(fields, { object: P, key, absent: true }); chain(P, key); }
        else if (typeof data(P, key) !== 'function') throw 0;
      }
      const species = getOwn(P, intrinsics.speciesSymbol);
      if (!species || getOwn(species, 'value') || typeof own(species, 'get') !== 'function' || own(species, 'set') !== undefined) throw 0;
      const prototypes = [object, array];
      // Native result and optional-static lookups must not run inherited page code.
      for (let index = 0; index < prototypes.length; index++) chain(prototypes[index], 'then');
      result = { safe: true, fields, chains, P, speciesGet: own(species, 'get') };
    } catch { /* Unsafe first captures are neither evaluated nor repaired. */ }
    apply(weakSet, intrinsics.asyncBoundaries, [target, result]);
    return result;
  }
  const targetAsyncBoundary = asyncBoundary(realm);
  function asyncPreflight(counter) {
    let safe = targetAsyncBoundary.safe;
    try {
      const fields = safe ? targetAsyncBoundary.fields : [];
      for (let index = 0; safe && index < fields.length; index++) {
        const expected = fields[index], actual = getOwn(expected.object, expected.key);
        safe = expected.absent ? !actual : !!actual && !!getOwn(actual, 'value') && actual.value === expected.value;
      }
      const chains = safe ? targetAsyncBoundary.chains : [];
      for (let index = 0; safe && index < chains.length; index++) {
        const expected = chains[index], actual = getOwn(expected.object, expected.key);
        safe = getPrototype(expected.object) === expected.parent && (expected.entry ?
          !!actual && !!getOwn(actual, 'value') && actual.value === expected.entry.value : !actual);
      }
      if (safe) {
        const species = getOwn(targetAsyncBoundary.P, intrinsics.speciesSymbol);
        safe = !!species && !getOwn(species, 'value') && own(species, 'get') === targetAsyncBoundary.speciesGet && own(species, 'set') === undefined;
      }
    } catch { safe = false; }
    if (!safe) { unavailable(counter); throw new intrinsics.NativeTypeError('Custom asynchronous state is unavailable'); }
  }
  function outputArray() {
    const output = [];
    if (targetArrayPrototype !== intrinsics.arrayPrototype) setPrototype(output, targetArrayPrototype);
    return output;
  }
  function outputRecord() { return create(targetObjectPrototype); }
  function argumentAt(args, index) { return index < args.length ? args[index] : undefined; }
  function owner(target, key) {
    for (let depth = 0; target !== null && target !== undefined && depth < 16; depth++) {
      const descriptor = getOwn(target, key);
      if (descriptor) return { target, descriptor };
      target = getPrototype(target);
    }
    return null;
  }
  // Only called on the selected, background-validated JSON value, never page input.
  function clone(value) {
    if (typeof value !== 'object' || value === null) return value;
    const output = isArray(value) ? outputArray() : outputRecord();
    const keys = ownKeys(value);
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index];
      if (key === 'length' || typeof key !== 'string') continue;
      define(output, key, { __proto__: null, value: clone(own(value, key)), enumerable: true, configurable: true, writable: true });
    }
    return output;
  }
  function immutable(value) {
    if (typeof value !== 'object' || value === null) return value;
    const keys = ownKeys(value);
    for (let index = 0; index < keys.length; index++) immutable(own(value, keys[index]));
    return freeze(value);
  }
  function unavailable(counter = current) {
    if (state.unavailable < LIMIT) state.unavailable++;
    if (counter.unavailable < LIMIT) counter.unavailable++;
  }
  function changed() { if (state.changed < LIMIT) state.changed++; }
  // ADR-112: a replacement function reports the name and length of the function it replaces. Two descriptors are copied (the compatibility
  // measure docs/PROJECT_RULES.md allows); Function.prototype.toString is not touched.
  function matchMeta(replacement, source) {
    if (typeof replacement !== 'function' || typeof source !== 'function' || replacement === source) return;
    for (const metaKey of ['length', 'name']) { const field = getOwn(source, metaKey), data = field && getOwn(field, 'value'); if (data) { try { define(replacement, metaKey, { __proto__: null, value: data.value, writable: false, enumerable: false, configurable: true }); } catch { /* keep the default */ } } }
  }
  function record(target, key, original, descriptor, counter = current) {
    if (handles.length >= HANDLE_LIMIT) { unavailable(counter); return false; }
    if (descriptor) { matchMeta(own(descriptor, 'value'), own(original, 'value')); matchMeta(own(descriptor, 'get'), own(original, 'get')); matchMeta(own(descriptor, 'set'), own(original, 'set')); }
    define(target, key, descriptor);
    push(handles, { target, key, original, descriptor });
    state.installed++; counter.installed++;
    return true;
  }
  function hide(target, key) {
    try {
      const found = owner(target, key);
      if (!found || !found.descriptor.configurable || handles.length >= HANDLE_LIMIT || !remove(found.target, key)) { unavailable(); return; }
      push(handles, { target: found.target, key, original: found.descriptor, descriptor: undefined });
      state.installed++; current.installed++;
    } catch { unavailable(); }
  }
  function getter(target, key, value, mode, counter = current, freshArray = false) {
    if (mode === 'on') { hide(target, key); return; }
    try {
      const found = owner(target, key);
      if (!found || !found.descriptor.configurable) { unavailable(counter); return false; }
      const original = found.descriptor;
      if (typeof original.get !== 'function') {
        // Window.devicePixelRatio may be implemented as an own data property.
        if (!getOwn(original, 'value')) { unavailable(counter); return false; }
      }
      const custom = immutable(clone(value));
      const customGetter = { customGetter() {
        'use strict';
        const native = typeof original.get === 'function' ? apply(original.get, this, []) : original.value;
        if (state.stopped) return native;
        changed();
        // UAData brands returns a new shallow-frozen array on every read;
        // mutable dictionaries must never modify the private selected template.
        return freshArray ? freeze(clone(custom)) : custom;
      } }.customGetter;
      return record(found.target, key, original, { __proto__: null, get: customGetter, set: original.set, configurable: true, enumerable: original.enumerable === true }, counter);
    } catch { unavailable(counter); return false; }
  }
  function resultGetter(target, key, transform, counter) {
    try {
      const found = owner(target, key);
      if (!found || !found.descriptor.configurable || typeof found.descriptor.get !== 'function') { unavailable(counter); return; }
      const original = found.descriptor;
      const customResultGetter = { customResultGetter() {
        'use strict';
        const native = apply(original.get, this, []);
        return state.stopped ? native : transform(native, this);
      } }.customResultGetter;
      record(found.target, key, original, { __proto__: null, get: customResultGetter, set: original.set, configurable: true, enumerable: original.enumerable === true }, counter);
    } catch { unavailable(counter); }
  }
  // An accessor whose result carries the real API on a prototype that has no global constructor (MemoryInfo,
  // DeprecatedStorageQuota): the original getter runs once and the page always receives its native result; `adopt`
  // may hook that prototype. Absence is not counted here; an unhookable accessor is.
  function observeAccessor(target, key, counter, adopt) {
    const field = owner(target, key), get = field && own(field.descriptor, 'get');
    if (!field) return false;
    if (!field.descriptor.configurable || typeof get !== 'function') { unavailable(counter); return false; }
    const observedGetter = { observedGetter() {
      'use strict';
      const object = apply(get, this, arguments);
      if (!state.stopped) try { adopt(object, this, get); } catch { unavailable(counter); }
      return object;
    } }.observedGetter;
    return record(field.target, key, field.descriptor, { __proto__: null, get: observedGetter, set: field.descriptor.set, configurable: true, enumerable: field.descriptor.enumerable === true }, counter);
  }
  function gpuMetadata(value, counter) {
    const keys = ['vendor', 'architecture', 'device', 'description'], patched = [];
    const metadata = immutable(clone(value));
    function patch(target) {
      let complete = true;
      for (let index = 0; index < keys.length; index++) {
        const key = keys[index];
        try {
          const found = owner(target, key);
          if (!found) { unavailable(counter); complete = false; continue; }
          let seen = false;
          for (let marker = 0; marker < patched.length; marker++) if (patched[marker].target === found.target && patched[marker].key === key) seen = true;
          if (!seen) {
            if (getter(found.target, key, own(metadata, key), 'custom', counter)) push(patched, { target: found.target, key });
            else complete = false;
          }
        } catch { unavailable(counter); complete = false; }
      }
      return complete;
    }
    patch(prototype('GPUAdapterInfo'));
    return native => {
      if (typeof native !== 'object' || native === null) return native;
      // Older implementations may return a plain record or expose no global
      // GPUAdapterInfo constructor. Patch the actual native result before it
      // reaches the caller, including its prototype-call entry points.
      return patch(native) ? native : metadata;
    };
  }
  function method(target, key, transform, asynchronous = false, mode = 'custom') {
    if (mode === 'on') { hide(target, key); return; }
    try {
      const found = owner(target, key);
      if (!found || !found.descriptor.configurable || typeof own(found.descriptor, 'value') !== 'function') { unavailable(); return; }
      const original = found.descriptor.value, counter = current;
      // WebIDL operations are callable, not constructors. The explicit strict
      // body also preserves receivers when this installer is serialized alone.
      const customMethod = { customMethod() {
        'use strict';
        // ADR-100: unsafe public async state is refused before native conversion/backend work.
        if (!state.stopped && asynchronous) { try { asyncPreflight(counter); } catch (refusal) { return new intrinsics.NativePromise((_, reject) => reject(refusal)); } }
        const native = apply(original, this, arguments);
        if (state.stopped) return native;
        const receiver = this, args = arguments;
        if (asynchronous) {
          // ADR-095: the source Promise stays private. SpeciesConstructor must
          // not consult a page getter before the selected result is projected.
          try { define(native, 'constructor', { __proto__: null, value: intrinsics.privatePromiseConstructor, writable: false, configurable: false, enumerable: false }); }
          catch { unavailable(counter); throw new intrinsics.NativeTypeError('Custom asynchronous result could not be protected'); }
          // Promise identity changes only in explicit Custom mode. Native rejection
          // and synchronous exception are retained; no page .then is inspected.
          return apply(promiseThen, native, [function customFulfilled(value) {
            if (state.stopped) return value;
            let output;
            try { output = transform(value, receiver, args); }
            catch { unavailable(counter); return value; }
            if (output === UNCHANGED) return value;
            changed();
            return output;
          }]);
        }
        let output;
        try { output = transform(native, receiver, args); }
        catch { unavailable(counter); return native; }
        if (output === UNCHANGED) return native;
        changed();
        return output;
      } }.customMethod;
      record(found.target, key, found.descriptor, { __proto__: null, value: customMethod, configurable: true, writable: found.descriptor.writable === true, enumerable: found.descriptor.enumerable === true });
    } catch { unavailable(); }
  }
  // ADR-085/086: the selected snapshot answers every surface with the same quota numbers: StorageManager.estimate,
  // StorageBucket.estimate and the deprecated webkit*Storage queryUsageAndQuota/requestQuota.
  function storageEstimate(value, mode) {
    if (mode === 'on') { hide(prototype('StorageManager'), 'estimate'); return; }
    try {
      const counter = current;
      const found = owner(prototype('StorageManager'), 'estimate');
      const managerReady = !!found && found.descriptor.configurable && typeof own(found.descriptor, 'value') === 'function';
      // No early return: insecure contexts lack StorageManager but keep the deprecated quota API.
      if (!managerReady) unavailable();
      const original = managerReady ? found.descriptor.value : null;
      const selected = immutable(clone(value));
      const targetPromisePrototype = realmPrototype('Promise', intrinsics.promisePrototype);
      const nativeOf = (target, key, part) => {
        const field = owner(target, key), item = field && own(field.descriptor, part);
        return typeof item === 'function' ? item : null;
      };
      const navigatorPrototype = prototype('Navigator');
      const storage = owner(navigatorPrototype, 'storage');
      const nativeGetter = nativeOf(navigatorPrototype, 'storage', 'get');
      const navigatorField = getOwn(realm, 'navigator'), navigatorGetter = own(navigatorField, 'get');
      const nativeNavigatorGetter = typeof navigatorGetter === 'function' ? navigatorGetter : null;
      const ownNavigator = own(navigatorField, 'value');
      const bucketPrototype = prototype('StorageBucket');
      const bucket = owner(bucketPrototype, 'estimate'), bucketBrand = nativeOf(bucketPrototype, 'name', 'get');
      const quotaKeys = ['webkitTemporaryStorage', 'webkitPersistentStorage'];
      const quotaGetters = [nativeOf(navigatorPrototype, quotaKeys[0], 'get'), nativeOf(navigatorPrototype, quotaKeys[1], 'get')];
      const chromium = bucketPrototype !== null || quotaGetters[0] !== null || quotaGetters[1] !== null;
      let anyHooked = false;
      // ADR-086: retain only passive, captured accessors and weak Window hints.
      // Foreign pages contribute identities, never replacement getters/code.
      if (intrinsics.storageAccess.value === null && (nativeGetter || bucketBrand || quotaGetters[0] || quotaGetters[1])) {
        const pick = key => nativeOf(realm, key, 'get');
        intrinsics.storageAccess.value = {
          storage: nativeGetter, navigator: nativeNavigatorGetter, document: pick('document'),
          self: pick('self'), parent: pick('parent'), top: pick('top'), opener: pick('opener'), length: pick('length'),
          bucket: bucketBrand, temporary: quotaGetters[0], persistent: quotaGetters[1]
        };
      }
      function windowHint(hint) {
        return intrinsics.NativeWeakRef ? apply(intrinsics.weakDeref, hint, []) : hint;
      }
      function rememberWindow(window, trusted = false) {
        if (window === null || typeof window !== 'object' && typeof window !== 'function') return;
        if (!trusted) {
          const access = intrinsics.storageAccess.value;
          if (!access || !access.self) return;
          try { if (apply(access.self, window, []) !== window) return; } catch { return; }
        }
        if (apply(weakGet, intrinsics.storageKnownWindows, [window]) === true) return;
        const windows = intrinsics.storageWindows;
        let slot = windows.length;
        if (slot >= 1024) {
          for (let index = 0; index < windows.length; index++) if (windowHint(windows[index]) === undefined) { slot = index; break; }
          if (slot >= 1024) { unavailable(counter); return; }
        }
        const hint = intrinsics.NativeWeakRef ? new intrinsics.NativeWeakRef(window) : window;
        define(windows, slot, { __proto__: null, value: hint, configurable: true, enumerable: true, writable: true });
        apply(weakSet, intrinsics.storageKnownWindows, [window, true]);
      }
      rememberWindow(realm, true);
      // One identity registry per native object family; `matches` re-reads the family's pristine accessor.
      const managerKind = { map: intrinsics.storageManagers, count: intrinsics.storageState, hooked: false,
        matches: (access, navigator, receiver) => access.storage !== null && apply(access.storage, navigator, []) === receiver };
      const quotaKind = { map: intrinsics.quotaObjects, count: intrinsics.quotaState, hooked: false,
        matches: (access, navigator, receiver) => access.temporary !== null && apply(access.temporary, navigator, []) === receiver ||
          access.persistent !== null && apply(access.persistent, navigator, []) === receiver };
      function register(kind, object) {
        if (object === null || typeof object !== 'object' && typeof object !== 'function') { unavailable(counter); return false; }
        if (apply(weakGet, kind.map, [object]) === true) return true;
        if (kind.count.count >= 1024) { unavailable(counter); return false; }
        apply(weakSet, kind.map, [object, true]); kind.count.count++;
        return true;
      }
      function authenticated(receiver, kind) {
        if (receiver === null || typeof receiver !== 'object' && typeof receiver !== 'function') return false;
        if (apply(weakGet, kind.map, [receiver]) === true) return true;
        if (kind.hooked && kind.count.count >= 1024) return false;
        // A cached handle may predate an installed getter or belong to another
        // Window. Never send this unknown object into a quota/backend operation.
        const access = intrinsics.storageAccess.value;
        if (access && access.navigator) {
          try {
            const navigator = apply(access.navigator, realm, []);
            if (kind.matches(access, navigator, receiver)) return register(kind, receiver);
          } catch { unavailable(counter); }
        } else if (access && ownNavigator !== undefined) {
          try {
            // Data-only Window.navigator has no transferable native accessor.
            // Its captured value still needs the first pristine brand getter;
            // a later foreign page getter is never an authentication oracle.
            if (kind.matches(access, ownNavigator, receiver)) return register(kind, receiver);
          } catch { unavailable(counter); }
        }
        if (!access || !access.navigator || !access.document) return false;
        const pending = [], seen = new NativeWeakMap(); let childEdges = 0;
        function enqueue(window) {
          if (window === null || typeof window !== 'object' && typeof window !== 'function' || pending.length >= 1024) return;
          if (apply(weakGet, seen, [window]) === true) return;
          apply(weakSet, seen, [window, true]); push(pending, window);
        }
        enqueue(realm);
        for (let index = 0; index < intrinsics.storageWindows.length; index++) enqueue(windowHint(intrinsics.storageWindows[index]));
        for (let index = 0; index < pending.length; index++) {
          const window = pending[index];
          try {
            // Native Window brand + SOP gate precedes any child descriptor read.
            // It rejects JS Proxies without invoking their traps.
            const document = apply(access.document, window, []);
            if (document === null || typeof document !== 'object') continue;
            if (window !== realm) {
              const navigator = apply(access.navigator, window, []);
              if (kind.matches(access, navigator, receiver)) { rememberWindow(window, true); return register(kind, receiver); }
            }
            const relations = [access.parent, access.top, access.opener];
            for (let item = 0; item < relations.length; item++) if (relations[item]) enqueue(apply(relations[item], window, []));
            if (access.length) {
              const length = apply(access.length, window, []);
              if (typeof length === 'number') for (let child = 0; child < length && child < 1024 && pending.length < 1024 && childEdges < 4096; child++) {
                childEdges++;
                // Ignore page accessors/named properties; only indexed data
                // Windows from an already authenticated native Window are hints.
                const field = getOwn(window, child);
                if (field && getOwn(field, 'value')) enqueue(field.value);
              }
            }
          } catch { /* Cross-origin/inactive windows are not authentication oracles. */ }
        }
        return false;
      }
      // ADR-085: do not request quota in Custom. Awaiting a primitive schedules
      // resolution without public then/species or a page queue function.
      async function settleSelected(resolve, snapshot) { await undefined; resolve(snapshot); }
      function virtualEstimate() {
        const snapshot = selectedRecord(selected, selected, ['quota', 'usage']);
        // Chromium adds a fresh usageDetails dictionary whose values sum to usage ({} at 0, measured); Firefox has none.
        if (chromium) {
          const details = outputRecord(), usage = own(selected, 'usage');
          if (usage > 0) define(details, 'indexedDB', { __proto__: null, value: usage, writable: true, enumerable: true, configurable: true });
          define(snapshot, 'usageDetails', { __proto__: null, value: details, writable: true, enumerable: true, configurable: true });
        }
        const promise = new intrinsics.NativePromise(resolve => { settleSelected(resolve, snapshot); });
        if (targetPromisePrototype !== intrinsics.promisePrototype) setPrototype(promise, targetPromisePrototype);
        changed();
        return promise;
      }
      if (managerReady) {
        const customStorageEstimate = { customStorageEstimate() {
          'use strict';
          if (state.stopped) return apply(original, this, arguments);
          if (!authenticated(this, managerKind)) {
            // Only the private sentinel reaches the native brand check. An unknown
            // genuine receiver must not become a quota probe before authentication.
            return apply(original, intrinsics.invalidStorageReceiver, arguments);
          }
          return virtualEstimate();
        } }.customStorageEstimate;
        if (record(found.target, 'estimate', found.descriptor, { __proto__: null, value: customStorageEstimate, configurable: true, writable: found.descriptor.writable === true, enumerable: found.descriptor.enumerable === true }, counter)) {
          anyHooked = true;
          const customStorageGetter = { customStorageGetter() {
            'use strict';
            const manager = apply(nativeGetter, this, arguments);
            if (state.stopped) return manager;
            const access = intrinsics.storageAccess.value;
            // A late inherited installation may encounter a page replacement.
            // Only the pristine captured getter may authenticate that result.
            if (!access || nativeGetter === access.storage) register(managerKind, manager);
            else try { if (apply(access.storage, this, []) === manager) register(managerKind, manager); } catch { unavailable(counter); }
            return manager;
          } }.customStorageGetter;
          if (!nativeGetter || !storage.descriptor.configurable) unavailable(counter);
          else try {
            managerKind.hooked = record(storage.target, 'storage', storage.descriptor, { __proto__: null, get: customStorageGetter, set: storage.descriptor.set, configurable: true, enumerable: storage.descriptor.enumerable === true }, counter);
          } catch { unavailable(counter); }
        }
      }
      // StorageBucket.name is a pure native brand getter (any realm): only a receiver it accepts is answered virtually;
      // every other receiver reaches the original once, as the private invalid receiver.
      if (bucket) {
        if (!bucket.descriptor.configurable || typeof own(bucket.descriptor, 'value') !== 'function') unavailable(counter);
        else {
          const bucketOriginal = bucket.descriptor.value;
          if (bucketBrand === null) unavailable(counter);
          const customBucketEstimate = { customBucketEstimate() {
            'use strict';
            if (state.stopped) return apply(bucketOriginal, this, arguments);
            const access = intrinsics.storageAccess.value, brand = access ? access.bucket : null;
            let genuine = false;
            if (brand !== null) try { apply(brand, this, []); genuine = true; } catch { /* Not a StorageBucket. */ }
            return genuine ? virtualEstimate() : apply(bucketOriginal, intrinsics.invalidStorageReceiver, arguments);
          } }.customBucketEstimate;
          record(bucket.target, 'estimate', bucket.descriptor, { __proto__: null, value: customBucketEstimate, configurable: true, writable: bucket.descriptor.writable === true, enumerable: bucket.descriptor.enumerable === true }, counter);
        }
      }
      // Deprecated webkitTemporaryStorage/webkitPersistentStorage (Chromium windows): no constructor, brand getter or instance
      // exists before the page reads the accessor, so the prototype methods are hooked from it. Chromium 153/156 returns one
      // object for both accessors and the estimate() numbers for either.
      const quotaHooked = new NativeWeakMap(), quotaSeen = new NativeWeakMap();
      const callable = item => typeof item === 'function' || typeof item === 'undefined' && item !== undefined;
      const optional = item => item === undefined || item === null || callable(item);
      async function afterMicrotask(task) { await undefined; task(); }
      // Native callbacks return from the browser process, after timers and messages queued in the same turn. Two private
      // message hops reproduce that order (measured on Chromium 153/156); a microtask or timer would not.
      function later(task) {
        const queue = intrinsics.task;
        if (queue !== null) try {
          const channel = new queue.Channel(), receiver = apply(queue.first, channel, []), sender = apply(queue.second, channel, []);
          let hops = 0;
          apply(queue.listen, receiver, [function () {
            if (hops++ === 0) { apply(queue.post, sender, [undefined]); return; }
            apply(queue.close, receiver, []); apply(queue.close, sender, []); task();
          }]);
          apply(queue.post, sender, [undefined]);
          return;
        } catch { /* An unusable task source delivers after a microtask rather than never. */ }
        afterMicrotask(task);
      }
      // WebIDL unsigned long long, then the native rule: granted = request limited by the quota.
      function grant(requested) {
        let bytes = requested;
        if (bytes !== bytes || bytes === Infinity || bytes === -Infinity) bytes = 0;
        else { bytes -= bytes % 1; bytes %= 18446744073709551616; if (bytes < 0) bytes += 18446744073709551616; }
        const quota = own(selected, 'quota');
        // `+ 0`: a negative multiple of 2^64 would otherwise give -0.
        return (bytes <= quota ? bytes : quota) + 0;
      }
      function quotaMethod(field, request) {
        if (!field) return;
        if (!field.descriptor.configurable || typeof own(field.descriptor, 'value') !== 'function') { unavailable(counter); return; }
        const method = field.descriptor.value;
        const custom = request ? { customRequestQuota() {
          'use strict';
          if (state.stopped) return apply(method, this, arguments);
          if (!authenticated(this, quotaKind)) return apply(method, intrinsics.invalidStorageReceiver, arguments);
          const size = argumentAt(arguments, 0), success = argumentAt(arguments, 1);
          // The original throws these (missing/BigInt/Symbol size, bad callbacks) before any quota work.
          if (arguments.length < 1 || typeof size === 'bigint' || typeof size === 'symbol' || !optional(success) || !optional(argumentAt(arguments, 2))) return apply(method, this, arguments);
          // The original is not called, so the size conversion (page valueOf included) runs once, here.
          const granted = grant(+size);
          if (callable(success)) later(() => apply(success, undefined, [granted]));
          changed();
        } }.customRequestQuota : { customQueryUsageAndQuota() {
          'use strict';
          if (state.stopped) return apply(method, this, arguments);
          if (!authenticated(this, quotaKind)) return apply(method, intrinsics.invalidStorageReceiver, arguments);
          const success = argumentAt(arguments, 0);
          // Argument errors: the original throws them before any quota work.
          if (!callable(success) || !optional(argumentAt(arguments, 1))) return apply(method, this, arguments);
          later(() => apply(success, undefined, [own(selected, 'usage'), own(selected, 'quota')]));
          changed();
        } }.customQueryUsageAndQuota;
        record(field.target, request ? 'requestQuota' : 'queryUsageAndQuota', field.descriptor, { __proto__: null, value: custom, configurable: true, writable: field.descriptor.writable === true, enumerable: field.descriptor.enumerable === true }, counter);
      }
      function hookQuota(proto) {
        if (proto === null || typeof proto !== 'object' || apply(weakGet, quotaHooked, [proto]) === true) return;
        apply(weakSet, quotaHooked, [proto, true]);
        quotaMethod(owner(proto, 'queryUsageAndQuota'), false);
        quotaMethod(owner(proto, 'requestQuota'), true);
      }
      if ((quotaGetters[0] || quotaGetters[1]) && intrinsics.task === null) unavailable(counter);
      for (let index = 0; index < 2; index++) {
        if (observeAccessor(navigatorPrototype, quotaKeys[index], counter, (object, receiver, nativeGet) => {
          const access = intrinsics.storageAccess.value, pristine = access ? (index === 0 ? access.temporary : access.persistent) : null;
          // Only the pristine getter may authenticate a late page replacement's result. Each object hooks its prototype once
          // per installation: a prototype the page swaps in later is never wrapped, and an overlay installation still wraps.
          if (pristine === null || pristine === nativeGet || apply(pristine, receiver, []) === object) {
            const fresh = apply(weakGet, quotaSeen, [object]) !== true;
            if (register(quotaKind, object) && fresh) { apply(weakSet, quotaSeen, [object, true]); hookQuota(getPrototype(object)); }
          }
        })) { quotaKind.hooked = true; anyHooked = true; }
      }
      // Keep a passive hint for popups that are no longer in the frame tree,
      // including noopener windows. Do not install/change a foreign profile.
      const open = anyHooked ? owner(realm, 'open') : null;
      if (open && open.descriptor.configurable && typeof own(open.descriptor, 'value') === 'function') {
        const originalOpen = open.descriptor.value;
        const storageWindowOpen = { storageWindowOpen() {
          'use strict';
          const window = apply(originalOpen, this, arguments);
          if (!state.stopped) rememberWindow(window);
          return window;
        } }.storageWindowOpen;
        record(open.target, 'open', open.descriptor, { __proto__: null, ...open.descriptor, value: storageWindowOpen }, counter);
      }
    } catch { unavailable(); }
  }
  function fields(name, value, keys, mode, infinity = false) {
    const target = prototype(name);
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index], item = own(value, key);
      if (item !== undefined || mode === 'on') getter(target, key, infinity && item === null ? Infinity : item, mode);
    }
  }
  function replaceFields(native, value, keys) {
    // Native result records are fresh dictionaries. Do not inspect caller input.
    if (typeof native !== 'object' || native === null) return native;
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index], item = own(value, key), descriptor = getOwn(native, key);
      if (item !== undefined && descriptor && getOwn(descriptor, 'value') && descriptor.configurable) {
        define(native, key, { __proto__: null, ...descriptor, value: clone(item) });
      }
    }
    return native;
  }
  function selectedRecord(native, value, keys, defaults, existingOnly = false) {
    if (typeof native !== 'object' || native === null) return native;
    const output = outputRecord();
    const ordered = existingOnly ? ownKeys(native) : keys;
    for (let index = 0; index < ordered.length; index++) {
      const key = ordered[index];
      if (existingOnly) { let allowed = false; for (let item = 0; item < keys.length; item++) if (keys[item] === key) allowed = true; if (!allowed) continue; }
      if (existingOnly && !getOwn(native, key)) continue;
      const selected = own(value, key), item = selected === undefined ? own(defaults, key) : selected;
      if (item !== undefined) define(output, key, { __proto__: null, value: clone(item), writable: true, configurable: true, enumerable: true });
    }
    return output;
  }
  function clientHints(value, mode) {
    const target = prototype('NavigatorUAData'), mobile = owner(target, 'mobile');
    const nativeMobile = mobile && own(mobile.descriptor, 'get');
    const found = owner(target, 'getHighEntropyValues');
    if (mode === 'on') { hide(target, 'getHighEntropyValues'); return; }
    if (!found || !found.descriptor.configurable || typeof own(found.descriptor, 'value') !== 'function' || typeof nativeMobile !== 'function') { unavailable(); return; }
    const original = found.descriptor.value, counter = current, selected = immutable(clone(value));
    const targetPromisePrototype = realmPrototype('Promise', intrinsics.promisePrototype);
    const NativeTypeError = intrinsics.NativeTypeError;
    const keys = ['architecture', 'bitness', 'brands', 'formFactors', 'fullVersionList', 'mobile', 'model', 'platform', 'platformVersion', 'uaFullVersion', 'wow64'];
    const defaults = { __proto__: null, architecture: '', bitness: '', model: '', platformVersion: '', uaFullVersion: '', wow64: false, fullVersionList: [], formFactors: [] };
    const known = create(null);
    for (let index = 0; index < keys.length; index++) define(known, keys[index], { __proto__: null, value: true });
    function invalid() { throw new NativeTypeError('Custom client hints arguments could not be converted'); }
    function primitive(value) { return value === null || typeof value !== 'object' && typeof value !== 'function'; }
    function hintString(value) {
      if (!primitive(value)) {
        const exotic = value[intrinsics.primitiveSymbol];
        if (exotic !== undefined && exotic !== null) {
          if (typeof exotic !== 'function') return invalid();
          value = apply(exotic, value, ['string']);
          if (!primitive(value)) return invalid();
        } else {
          const object = value, names = ['toString', 'valueOf']; let converted = false;
          for (let index = 0; index < names.length; index++) {
            const method = object[names[index]];
            if (typeof method !== 'function') continue;
            const result = apply(method, object, []);
            if (primitive(result)) { value = result; converted = true; break; }
          }
          if (!converted) return invalid();
        }
      }
      if (typeof value === 'symbol') return invalid();
      return apply(intrinsics.NativeString, undefined, [value]);
    }
    function requested(args) {
      if (args.length === 0) return invalid();
      const input = argumentAt(args, 0);
      if (primitive(input)) return invalid();
      const method = input[intrinsics.iteratorSymbol];
      if (method === undefined || method === null) return invalid();
      if (typeof method !== 'function') return invalid();
      const iterator = apply(method, input, []);
      if (primitive(iterator)) return invalid();
      const next = iterator.next;
      if (typeof next !== 'function') return invalid();
      const output = create(null);
      for (let count = 0; count <= HANDLE_LIMIT; count++) {
        const result = apply(next, iterator, []);
        if (primitive(result)) return invalid();
        // ADR-101: Chromium's sequence binding reads value before done and does
        // not call iterator.return on a conversion failure. Do not use for-of.
        const item = result.value;
        if (result.done) return output;
        if (count === HANDLE_LIMIT) { unavailable(counter); return invalid(); }
        const key = hintString(item);
        if (own(known, key)) define(output, key, { __proto__: null, value: true, configurable: true });
      }
    }
    async function settle(resolve, snapshot) { await undefined; resolve(snapshot); }
    const customHighEntropyValues = { customHighEntropyValues() {
      'use strict';
      if (state.stopped) return apply(original, this, arguments);
      try { apply(nativeMobile, this, []); }
      catch { return apply(original, intrinsics.invalidUaReceiver, arguments); }
      const args = arguments;
      const promise = new intrinsics.NativePromise((resolve, reject) => {
        try {
          const hints = requested(args), output = outputRecord();
          for (let index = 0; index < keys.length; index++) {
            const key = keys[index];
            if (key !== 'brands' && key !== 'mobile' && key !== 'platform' && !own(hints, key)) continue;
            const item = own(selected, key), value = item === undefined ? own(defaults, key) : item;
            if (value !== undefined) define(output, key, { __proto__: null, value: clone(value), writable: true, configurable: true, enumerable: true });
          }
          changed(); settle(resolve, output);
        } catch (error) { reject(error); }
      });
      if (targetPromisePrototype !== intrinsics.promisePrototype) setPrototype(promise, targetPromisePrototype);
      return promise;
    } }.customHighEntropyValues;
    if (!record(found.target, 'getHighEntropyValues', found.descriptor, { __proto__: null, value: customHighEntropyValues, configurable: true, writable: found.descriptor.writable === true, enumerable: found.descriptor.enumerable === true }, counter)) return;
  }
  function mediaRecord(native, value, keys) {
    if (typeof native !== 'object' || native === null) return native;
    const output = outputRecord(), ordered = ownKeys(native);
    for (let index = 0; index < ordered.length; index++) {
      const key = ordered[index];
      if (key === '__proto__') continue;
      const descriptor = getOwn(native, key);
      // Native capabilities dictionaries contain own data. Do not invoke a
      // replacement accessor, traverse opaque handles or project unrelated fields.
      if (!descriptor || !getOwn(descriptor, 'value')) continue;
      let selected;
      for (let item = 0; item < keys.length; item++) if (keys[item] === key) selected = own(value, key);
      // Round 5: a selected boolean only LOWERS the native one (native AND selected); the contract keeps smooth and efficiency false when supported is.
      define(output, key, { __proto__: null, value: selected === undefined ? descriptor.value : typeof selected === 'boolean' ? selected && descriptor.value === true : clone(selected), writable: true, configurable: true, enumerable: descriptor.enumerable === true });
    }
    return output;
  }
  function mediaHooks(metadataMap, counter, fallback) {
    const patched = [];
    function patch(target) {
      let complete = true;
      const keys = ['deviceId', 'kind', 'label', 'groupId', 'toJSON'];
      for (let index = 0; index < keys.length; index++) {
        const key = keys[index];
        try {
          const found = owner(target, key);
          if (!found) { unavailable(counter); complete = false; continue; }
          let existing = false;
          for (let marker = 0; marker < patched.length; marker++) if (patched[marker].target === found.target && patched[marker].key === key) existing = true;
          if (existing) continue;
          const original = found.descriptor;
          if (!original.configurable || key === 'toJSON' && typeof own(original, 'value') !== 'function' || key !== 'toJSON' && typeof original.get !== 'function' && !getOwn(original, 'value')) {
            unavailable(counter); complete = false; continue;
          }
          let descriptor;
          if (key === 'toJSON') {
            const mediaToJSON = { mediaToJSON() {
              'use strict';
              const native = apply(original.value, this, arguments);
              if (state.stopped) return native;
              const metadata = apply(weakGet, metadataMap, [this]) || fallback;
              if (!metadata) return native;
              changed();
              return clone(metadata);
            } }.mediaToJSON;
            descriptor = { __proto__: null, value: mediaToJSON, configurable: true, enumerable: original.enumerable === true, writable: original.writable === true };
          } else {
            const mediaGetter = { mediaGetter() {
              'use strict';
              const native = typeof original.get === 'function' ? apply(original.get, this, []) : original.value;
              if (state.stopped) return native;
              const metadata = apply(weakGet, metadataMap, [this]) || fallback;
              if (!metadata) return native;
              changed();
              return own(metadata, key);
            } }.mediaGetter;
            descriptor = { __proto__: null, get: mediaGetter, set: original.set, configurable: true, enumerable: original.enumerable === true };
          }
          if (record(found.target, key, original, descriptor, counter)) push(patched, { target: found.target, key });
          else complete = false;
        } catch { unavailable(counter); complete = false; }
      }
      // InputDeviceInfo can expose the same IDs through getCapabilities even
      // when MediaDeviceInfo attributes and toJSON have been replaced.
      try {
        const found = owner(target, 'getCapabilities');
        if (found && typeof own(found.descriptor, 'value') === 'function') {
          let existing = false;
          for (let marker = 0; marker < patched.length; marker++) if (patched[marker].target === found.target && patched[marker].key === 'getCapabilities') existing = true;
          if (!existing) {
            const original = found.descriptor;
            if (!original.configurable) { unavailable(counter); complete = false; }
            else {
              const mediaCapabilities = { mediaCapabilities() {
                'use strict';
                const native = apply(original.value, this, arguments);
                if (state.stopped) return native;
                const metadata = apply(weakGet, metadataMap, [this]) || fallback;
                if (!metadata) return native;
                changed();
                return mediaRecord(native, metadata, ['deviceId', 'groupId']);
              } }.mediaCapabilities;
              if (record(found.target, 'getCapabilities', original, { __proto__: null, value: mediaCapabilities, configurable: true, enumerable: original.enumerable === true, writable: original.writable === true }, counter)) push(patched, { target: found.target, key: 'getCapabilities' });
              else complete = false;
            }
          }
        }
      } catch { unavailable(counter); complete = false; }
      return complete;
    }
    patch(prototype('MediaDeviceInfo'));
    return patch;
  }
  // ADR-107: selected rows sit on native devices of the SAME kind, in native order: never on another kind, never more rows
  // than real devices of a kind and never a created record. Native devices without a row of their kind are left out.
  function mediaRecords(native, value, metadataMap, patchDevice, kindOf) {
    const output = outputArray(), next = create(null), length = isArray(native) ? own(native, 'length') : 0;
    for (let index = 0; index < length && index < 1024; index++) {
      const device = own(native, index);
      let kind, row;
      try { kind = kindOf(device); } catch { continue; }
      for (row = next[kind] || 0; row < value.length && own(own(value, row), 'kind') !== kind; row++);
      next[kind] = row + 1;
      if (row >= value.length) continue;
      // Ordinary reads, borrowed prototype getters and toJSON all consult the same metadata.
      apply(weakSet, metadataMap, [device, clone(own(value, row))]);
      if (patchDevice(device)) push(output, device);
    }
    return output;
  }
  // ADR-107: MemoryInfo has no global constructor and every read returns a new object, so its prototype getters are
  // hooked from Performance.memory. The native getter stays the brand check; the limit is the selected value and the
  // live used/total numbers are only clamped to it.
  function memoryInfo(value, mode) {
    const target = prototype('Performance'), counter = current, limit = own(value, 'jsHeapSizeLimit'), hooked = new NativeWeakMap();
    if (mode === 'on') { hide(target, 'memory'); return; }
    if (!owner(target, 'memory')) { unavailable(counter); return; }
    observeAccessor(target, 'memory', counter, object => {
      const proto = getPrototype(object);
      if (proto === null || typeof proto !== 'object' || apply(weakGet, hooked, [proto]) === true) return;
      apply(weakSet, hooked, [proto, true]);
      const keys = ['jsHeapSizeLimit', 'totalJSHeapSize', 'usedJSHeapSize'];
      for (let index = 0; index < 3; index++) resultGetter(proto, keys[index], native => { changed(); return index === 0 || !(native <= limit) ? limit : native; }, counter);
    });
  }
  // SipHash-2-4 over int32 lane pairs (no BigInt); returns the low 32 bits.
  function sipHash(key, bytes) {
    const v = [key[0] ^ 0x70736575, key[1] ^ 0x736f6d65, key[2] ^ 0x6e646f6d, key[3] ^ 0x646f7261, key[0] ^ 0x6e657261, key[1] ^ 0x6c796765, key[2] ^ 0x79746573, key[3] ^ 0x74656462];
    const add = (i, j) => { const low = (v[i] >>> 0) + (v[j] >>> 0); v[i + 1] = v[i + 1] + v[j + 1] + (low > 0xffffffff ? 1 : 0) | 0; v[i] = low | 0; };
    const rotate = (i, n) => { const low = v[i], high = v[i + 1]; v[i] = n === 32 ? high : low << n | high >>> 32 - n; v[i + 1] = n === 32 ? low : high << n | low >>> 32 - n; };
    const mix = (i, j) => { v[i] ^= v[j]; v[i + 1] ^= v[j + 1]; };
    const round = () => { add(0, 2); rotate(2, 13); mix(2, 0); rotate(0, 32); add(4, 6); rotate(6, 16); mix(6, 4); add(0, 6); rotate(6, 21); mix(6, 0); add(4, 2); rotate(2, 17); mix(2, 4); rotate(4, 32); };
    const length = bytes.length;
    for (let offset = 0; offset <= length; offset += 8) {
      const word = [0, 0];
      for (let index = 0; index < 8; index++) word[index >>> 2] |= (offset + index < length ? bytes[offset + index] : index === 7 ? length & 255 : 0) << 8 * (index & 3);
      v[6] ^= word[0]; v[7] ^= word[1]; round(); round(); v[0] ^= word[0]; v[1] ^= word[1];
    }
    v[4] ^= 0xff; round(); round(); round(); round();
    return (v[0] ^ v[2] ^ v[4] ^ v[6]) >>> 0;
  }
  // Chrome's per-host multiplier 0.90 + slot * 0.01 (slot 0..20). The slot is a SipHash of the realm host keyed by the profile's
  // private network key; an empty host (about:blank, srcdoc) or no key gives 1, like Chrome for an empty host (measured).
  function hostFactor(key) {
    let host = '';
    try {
      const field = owner(realm, 'location'), place = field && (typeof field.descriptor.get === 'function' ? apply(field.descriptor.get, realm, []) : own(field.descriptor, 'value'));
      const name = owner(place, 'hostname'), value = name && (typeof name.descriptor.get === 'function' ? apply(name.descriptor.get, place, []) : own(name.descriptor, 'value'));
      if (typeof value === 'string') host = value;
    } catch { /* An unreadable location counts as an empty host. */ }
    if (host === '' || typeof key !== 'string' || key.length !== 64) return 1;
    const words = [0, 0, 0, 0, 0, 0, 0, 0], bytes = [], domain = 'netinfo/v1';
    for (let index = 0; index < 64; index++) {
      const code = apply(intrinsics.charCode, key, [index]), digit = code >= 48 && code <= 57 ? code - 48 : code >= 97 && code <= 102 ? code - 87 : -1;
      if (digit < 0) return 1;
      words[index >>> 3] = (words[index >>> 3] << 4 | digit) >>> 0;
    }
    for (let index = 0; index < domain.length; index++) push(bytes, apply(intrinsics.charCode, domain, [index]));
    push(bytes, 0);
    for (let index = 0; index < host.length && index < 256; index++) { const code = apply(intrinsics.charCode, host, [index]); push(bytes, code & 255); push(bytes, code >>> 8); }
    return 0.9 + sipHash([words[0] ^ words[4], words[1] ^ words[5], words[2] ^ words[6], words[3] ^ words[7]], bytes) % 21 * 0.01;
  }
  // ADR-107: the selected values are the raw network quality; the page sees Chrome's own projection of it (measured on 156):
  // multiplier per host, rtt capped at 3000 ms and rounded to 50 ms, downlink capped at 10 Mbps and rounded to 50 kbps,
  // effectiveType from the raw rtt with the NQE thresholds 272/1420/2010 ms. Desktop Chrome has no type/downlinkMax.
  function networkInformation(value, mode, key) {
    const keys = ['downlink', 'effectiveType', 'rtt', 'saveData'], target = prototype('NetworkInformation');
    if (mode === 'on') { fields('NetworkInformation', value, ['downlink', 'effectiveType', 'rtt', 'saveData', 'type', 'downlinkMax'], mode); return; }
    const rtt = own(value, 'rtt'), downlink = own(value, 'downlink'), factor = hostFactor(key);
    const bucket = (amount, cap, step) => { const steps = (amount < cap ? amount : cap) / step + 0.5; return (steps - steps % 1) * step; };
    fields('NetworkInformation', {
      rtt: typeof rtt === 'number' ? bucket(rtt * factor, 3000, 50) : undefined,
      downlink: typeof downlink === 'number' ? bucket(downlink * 1000 * factor, 10000, 50) / 1000 : undefined,
      effectiveType: typeof rtt === 'number' ? rtt >= 2010 ? 'slow-2g' : rtt >= 1420 ? '2g' : rtt >= 272 ? '3g' : '4g' : own(value, 'effectiveType'),
      saveData: own(value, 'saveData')
    }, keys, mode);
    if (owner(target, 'type')) getter(target, 'type', own(value, 'type') ?? '', mode);
    if (owner(target, 'downlinkMax')) getter(target, 'downlinkMax', 0, mode);
  }
  // ADR-107: the native voice list filtered to the selected languages (base language), the native default voice kept first;
  // the same objects in native order, nothing created. An empty native list (before voiceschanged) stays native.
  function voices(value, mode) {
    const target = prototype('SpeechSynthesis');
    if (isArray(value) || mode === 'on') { method(target, 'getVoices', () => outputArray(), false, mode); return; }
    const voice = prototype('SpeechSynthesisVoice'), languages = immutable(clone(own(value, 'languages')));
    const accessor = key => { const field = owner(voice, key); return field && own(field.descriptor, 'get'); };
    const langGet = accessor('lang'), defaultGet = accessor('default'), code = (text, index) => apply(intrinsics.charCode, text, [index]);
    if (typeof langGet !== 'function' || typeof defaultGet !== 'function') unavailable();
    const ended = unit => !(unit === unit) || unit === 45 || unit === 95;
    const sameBase = (left, right) => {
      for (let index = 0; ; index++) {
        const a = code(left, index), b = code(right, index);
        if (ended(a) || ended(b)) return ended(a) && ended(b);
        if ((a | 32) !== (b | 32)) return false;
      }
    };
    method(target, 'getVoices', native => {
      const length = isArray(native) ? own(native, 'length') : 0;
      if (!length) return UNCHANGED;
      const output = outputArray();
      let first = null;
      for (let index = 0; index < length && first === null; index++) try { if (apply(defaultGet, own(native, index), []) === true) first = own(native, index); } catch { /* Not a voice. */ }
      if (first !== null) push(output, first);
      for (let index = 0; index < length; index++) {
        const item = own(native, index);
        let lang;
        try { lang = apply(langGet, item, []); } catch { continue; }
        if (item === first || typeof lang !== 'string') continue;
        for (let tag = 0; tag < languages.length; tag++) if (sameBase(lang, own(languages, tag))) { push(output, item); break; }
      }
      return output;
    }, false, mode);
  }
  const navigator = prototype('Navigator'), screen = prototype('Screen');
  const scalar = {
    __proto__: null,
    'hardware-concurrency': [navigator, 'hardwareConcurrency'],
    'device-memory': [navigator, 'deviceMemory'], 'touch-points': [navigator, 'maxTouchPoints'],
    'navigator-platform': [navigator, 'platform'], 'navigator-user-agent': [navigator, 'userAgent'],
    'navigator-app-version': [navigator, 'appVersion'], 'navigator-vendor': [navigator, 'vendor'],
    'navigator-oscpu': [navigator, 'oscpu'],
    'navigator-language': [navigator, 'language'], 'navigator-languages': [navigator, 'languages'],
    'screen-width': [screen, 'width'], 'screen-height': [screen, 'height'],
    'screen-avail-width': [screen, 'availWidth'], 'screen-avail-height': [screen, 'availHeight'],
    'screen-color-depth': [screen, 'colorDepth'], 'screen-pixel-depth': [screen, 'pixelDepth'],
    'window-device-pixel-ratio': [realm, 'devicePixelRatio'], 'screen-extended': [screen, 'isExtended']
  };
  for (let index = 0; index < entries.length; index++) {
    const entry = own(entries, index), id = own(entry, 'id'), mode = own(entry, 'mode') || 'custom', value = own(entry, 'value');
    current = { id, installed: 0, unavailable: 0 };
    push(results, current);
    if (mode === 'off' || mode === 'bypass') continue;
    const target = own(scalar, id);
    if (target) { getter(target[0], target[1], value, mode); continue; }
    switch (id) {
      case 'screen-orientation': fields('ScreenOrientation', value, ['type', 'angle'], mode); break;
      case 'battery': fields('BatteryManager', value, ['charging', 'chargingTime', 'dischargingTime', 'level'], mode, true); break;
      case 'network-information': networkInformation(value, mode, own(entry, 'networkKey')); break;
      case 'performance-memory': memoryInfo(value, mode); break;
      case 'webgpu': {
        if (value === null) method(prototype('GPU'), 'requestAdapter', () => null, true, mode);
        else if (mode === 'on') fields('GPUAdapterInfo', value, ['vendor', 'architecture', 'device', 'description'], mode);
        else {
          const counter = current, decorate = gpuMetadata(value, counter);
          resultGetter(prototype('GPUAdapter'), 'info', decorate, counter);
          resultGetter(prototype('GPUDevice'), 'adapterInfo', decorate, counter);
          method(prototype('GPUAdapter'), 'requestAdapterInfo', decorate, true, mode);
        }
        break;
      }
      case 'client-hints': {
        const low = ['brands', 'mobile', 'platform'];
        const brands = own(value, 'brands');
        clientHints(value, mode);
        if (brands !== undefined || mode === 'on') getter(prototype('NavigatorUAData'), 'brands', brands, mode, current, true);
        fields('NavigatorUAData', value, ['mobile', 'platform'], mode);
        method(prototype('NavigatorUAData'), 'toJSON', native => selectedRecord(native, value, low), false, mode);
        break;
      }
      case 'timezone': {
        if (mode === 'on') { unavailable(); break; }
        method(prototype('Date'), 'getTimezoneOffset', (native, receiver) => {
          if (native !== native) return native;
          // ADR-101: a private Intl helper recognizes the genuinely selected
          // engine offset, including DST/historical engine conventions. A page
          // marker or a public resolvedOptions replacement is never an oracle.
          if (typeof nativeContext === 'function') {
            try { const selected = apply(nativeContext, undefined, [receiver, native]); if (typeof selected === 'number') return selected; }
            catch { /* Unavailable private conversion retains the legacy choice. */ }
          }
          return own(value, 'offsetMinutes');
        }, false, mode);
        if (own(entry, 'dateOffsetOnly') === true) break;
        const intl = own(realm, 'Intl'), constructor = own(intl, 'DateTimeFormat');
        method(own(constructor, 'prototype'), 'resolvedOptions', native => replaceFields(native, value, ['timeZone']), false, mode);
        break;
      }
      case 'webgl': {
        const names = ['WebGLRenderingContext', 'WebGL2RenderingContext'];
        const parameters = { __proto__: null, 7936: 'vendor', 7937: 'renderer', 37445: 'unmaskedVendor', 37446: 'unmaskedRenderer' };
        const patched = [];
        for (let name = 0; name < names.length; name++) {
          const candidate = prototype(names[name]), found = owner(candidate, 'getParameter');
          let duplicate = false;
          for (let previous = 0; previous < patched.length; previous++) if (patched[previous] === (found && found.target)) duplicate = true;
          if (duplicate) continue;
          if (found) push(patched, found.target);
          method(candidate, 'getParameter', (native, receiver, args) => {
            let parameter = argumentAt(args, 0);
            // WebIDL GLenum conversion permits strings, fractions and uint32
            // wrapping. Primitive conversion invokes no additional page code.
            // An unenabled/unsupported debug extension keeps its native null.
            if (typeof native !== 'string') return native;
            if (typeof parameter === 'object' && parameter !== null || typeof parameter === 'function') {
              // Native has already coerced an opaque object exactly once. Its
              // result cannot identify the requested enum without coercing it
              // again, so withhold string metadata rather than expose native.
              return undefined;
            }
            parameter = parameter >>> 0;
            const key = own(parameters, parameter);
            return key === undefined ? native : own(value, key);
          }, false, mode);
        }
        break;
      }
      case 'notifications': {
        getter(own(realm, 'Notification'), 'permission', value, mode);
        if (mode === 'on') break;
        // ADR-107: Permissions and Push report the state matching the selected Notification.permission (measured mapping
        // default/denied/granted -> prompt/denied/granted; a push query with userVisibleOnly is named "notifications").
        // Nothing is requested or granted.
        const counter = current, answer = value === 'default' ? 'prompt' : value, status = prototype('PermissionStatus');
        const field = owner(status, 'name'), nameGet = field && own(field.descriptor, 'get');
        if (typeof nameGet !== 'function') unavailable(counter);
        else resultGetter(status, 'state', (native, receiver) => {
          let name;
          try { name = apply(nameGet, receiver, []); } catch { return native; }
          if (name !== 'notifications' && name !== 'push') return native;
          changed();
          return answer;
        }, counter);
        method(prototype('PushManager'), 'permissionState', () => answer, true, mode);
        break;
      }
      case 'storage-estimate': storageEstimate(value, mode); break;
      case 'autoplay-policy': method(navigator, 'getAutoplayPolicy', () => value, false, mode); break;
      case 'media-capabilities': {
        const keys = ['decodingInfo', 'encodingInfo'];
        for (let key = 0; key < keys.length; key++) method(prototype('MediaCapabilities'), keys[key], native => mediaRecord(native, value, ['supported', 'smooth', 'powerEfficient']), true, mode);
        break;
      }
      case 'media-enumeration': {
        const counter = current;
        const metadataMap = new NativeWeakMap(), rows = immutable(clone(value));
        const fallback = own(entry, 'shield') === true ? { deviceId: '', groupId: '', kind: '', label: '' } : undefined;
        // Chrome 156 lists one blank entry per present kind (label, deviceId and groupId all empty) until a media permission is
        // granted. Capture the native accessors before mediaHooks patches them: such a list is returned untouched, so no labelled
        // Custom device is visible without a grant. Any labelled/identified entry, or an accessor that cannot be captured, applies
        // the Custom list as before. The page then sees the kinds present on the real machine, like in an unmodified Chrome.
        // Unverified outside Chrome 156.
        const blankGetters = [];
        if (mode !== 'on') {
          const keys = ['label', 'deviceId', 'groupId'], info = prototype('MediaDeviceInfo');
          for (let index = 0; index < keys.length; index++) {
            const field = owner(info, keys[index]), get = field && own(field.descriptor, 'get');
            push(blankGetters, typeof get === 'function' ? get : null);
          }
        }
        const blankList = native => {
          if (blankGetters.length !== 3 || !isArray(native)) return false;
          const length = own(native, 'length');
          if (typeof length !== 'number' || length < 1 || length > 1024) return false;
          for (let index = 0; index < length; index++) {
            const device = own(native, index);
            if (typeof device !== 'object' || device === null) return false;
            for (let key = 0; key < 3; key++) {
              if (blankGetters[key] === null) return false;
              try { if (apply(blankGetters[key], device, []) !== '') return false; } catch { return false; }
            }
          }
          return true;
        };
        // The native kind getter, captured before mediaHooks replaces it, decides which rows may sit on which device.
        const kindField = owner(prototype('MediaDeviceInfo'), 'kind'), kindGetter = kindField && own(kindField.descriptor, 'get');
        const kindOf = device => apply(kindGetter, device, []);
        const patchDevice = mode === 'on' ? null : mediaHooks(metadataMap, counter, fallback);
        method(prototype('MediaDevices'), 'enumerateDevices', native => blankList(native) ? UNCHANGED : mediaRecords(native, rows, metadataMap, patchDevice, kindOf), true, mode);
        break;
      }
      case 'gamepads': method(navigator, 'getGamepads', native => { const output = outputArray(), length = typeof native === 'object' && native !== null && typeof native.length === 'number' ? native.length : 0; for (let index = 0; index < length && index < 16; index++) push(output, null); return output; }, false, mode); break;
      case 'speech-voices': voices(value, mode); break;
      case 'bluetooth':
        method(prototype('Bluetooth'), 'getAvailability', () => own(value, 'available'), true, mode);
        method(prototype('Bluetooth'), 'getDevices', () => outputArray(), true, mode);
        break;
      case 'usb': method(prototype('USB'), 'getDevices', () => outputArray(), true, mode); break;
      case 'hid': method(prototype('HID'), 'getDevices', () => outputArray(), true, mode); break;
      case 'serial': method(prototype('Serial'), 'getPorts', () => outputArray(), true, mode); break;
      default: unavailable();
    }
  }
  return {
    snapshot() { return { ...state, entries: clone(results) }; },
    stop() {
      if (state.stopped) return;
      state.stopped = true;
      for (let index = handles.length - 1; index >= 0; index--) {
        const handle = handles[index];
        try {
          const descriptor = getOwn(handle.target, handle.key), installed = handle.descriptor;
          const owned = installed === undefined ? descriptor === undefined : descriptor &&
            (installed.get ? descriptor.get === installed.get && descriptor.set === installed.set : getOwn(descriptor, 'value') && descriptor.value === installed.value);
          if (!owned) continue;
          if (handle.original === undefined) remove(handle.target, handle.key);
          else define(handle.target, handle.key, { __proto__: null, ...handle.original });
        } catch { /* The page may have replaced or frozen its descriptor. */ }
      }
    }
  };
}
