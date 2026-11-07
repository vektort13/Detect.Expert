// ADR-087: selected native Intl formatters. Keep this installer self-contained.
export function installIntlCustom(realm, entries) {
  'use strict';
  const previous = installIntlCustom.__detectExpertIntlIntrinsicsV1;
  const I = previous || {
    apply: Reflect.apply, construct: Reflect.construct, get: Reflect.get,
    own: Object.getOwnPropertyDescriptor, define: Object.defineProperty,
    create: Object.create, getPrototype: Object.getPrototypeOf,
    setPrototype: Object.setPrototypeOf, reflectSetPrototype: Reflect.setPrototypeOf, freeze: Object.freeze, trunc: Math.trunc,
    Proxy, WeakSet, setHas: WeakSet.prototype.has, setAdd: WeakSet.prototype.add, setDelete: WeakSet.prototype.delete,
    installed: new WeakSet(), temporalInstalled: new WeakSet(), constructors: Object.create(null), resolved: Object.create(null)
  };
  function own(target, key) {
    if (target === null || typeof target !== 'object' && typeof target !== 'function') return;
    const field = I.own(target, key);
    return field && I.own(field, 'value') ? field.value : undefined;
  }
  function push(array, value) { I.define(array, array.length, { __proto__: null, value, writable: true, configurable: true, enumerable: true }); }
  // ADR-112: a Proxy wrapper of a native function refuses to close a prototype cycle through itself (Object.setPrototypeOf(fn, fn)) with the
  // engine's own TypeError, as the native function does; accepted, the cycle would make every later property read of the function overflow the
  // stack. Everything else is forwarded to the target. `handler` is a fresh null-prototype literal of the caller.
  function guarded(original, handler) {
    let self;
    handler.setPrototypeOf = function(target, value) { if (value === self) { I.setPrototype(target, target); return false; } return I.reflectSetPrototype(target, value); };
    return self = new I.Proxy(original, handler);
  }
  // [constructor, selectable profile keys, option keys mirrored into the selected formatter, newer optional API]
  const definitions = [
    ['DateTimeFormat', ['locale', 'timeZone', 'calendar', 'numberingSystem'], ['calendar', 'numberingSystem', 'timeZone', 'hourCycle', 'hour12', 'weekday', 'era', 'year', 'month', 'day', 'dayPeriod', 'hour', 'minute', 'second', 'fractionalSecondDigits', 'timeZoneName', 'dateStyle', 'timeStyle']],
    ['NumberFormat', ['locale', 'numberingSystem'], ['numberingSystem', 'style', 'currency', 'currencyDisplay', 'currencySign', 'unit', 'unitDisplay', 'minimumIntegerDigits', 'minimumFractionDigits', 'maximumFractionDigits', 'minimumSignificantDigits', 'maximumSignificantDigits', 'useGrouping', 'notation', 'compactDisplay', 'signDisplay', 'roundingIncrement', 'roundingMode', 'roundingPriority', 'trailingZeroDisplay']],
    ['Collator', ['locale'], ['usage', 'sensitivity', 'ignorePunctuation', 'collation', 'numeric', 'caseFirst']],
    ['RelativeTimeFormat', ['locale', 'numberingSystem'], ['numberingSystem', 'style', 'numeric']],
    ['PluralRules', ['locale'], ['type', 'minimumIntegerDigits', 'minimumFractionDigits', 'maximumFractionDigits', 'minimumSignificantDigits', 'maximumSignificantDigits', 'roundingIncrement', 'roundingMode', 'roundingPriority', 'trailingZeroDisplay']],
    ['ListFormat', ['locale'], ['type', 'style']],
    ['DisplayNames', ['locale'], ['style', 'type', 'fallback', 'languageDisplay']],
    ['Segmenter', ['locale'], ['granularity']],
    ['DurationFormat', ['locale', 'numberingSystem'], ['numberingSystem', 'style', 'years', 'yearsDisplay', 'months', 'monthsDisplay', 'weeks', 'weeksDisplay', 'days', 'daysDisplay', 'hours', 'hoursDisplay', 'minutes', 'minutesDisplay', 'seconds', 'secondsDisplay', 'milliseconds', 'millisecondsDisplay', 'microseconds', 'microsecondsDisplay', 'nanoseconds', 'nanosecondsDisplay', 'fractionalDigits'], true]
  ];
  if (!previous) {
    const intl = own(realm, 'Intl');
    for (let index = 0; index < definitions.length; index++) {
      const name = definitions[index][0], constructor = own(intl, name);
      const resolved = own(own(constructor, 'prototype'), 'resolvedOptions');
      if (typeof constructor === 'function' && typeof resolved === 'function') {
        I.define(I.constructors, name, { __proto__: null, value: constructor });
        I.define(I.resolved, name, { __proto__: null, value: resolved });
      }
    }
    I.freeze(I.constructors); I.freeze(I.resolved);
    // ADR-101: private rule lookup for the caller's already-existing Date value.
    // No clock operation and no late target-realm constructor/property lookup.
    try {
      const date = own(realm, 'Date'), temporal = own(realm, 'Temporal');
      const instant = own(temporal, 'Instant'), zoned = own(temporal, 'ZonedDateTime');
      I.dateGetTime = own(own(date, 'prototype'), 'getTime');
      I.instantConstructor = instant;
      I.instantFromMilliseconds = own(instant, 'fromEpochMilliseconds');
      I.instantToZone = own(own(instant, 'prototype'), 'toZonedDateTimeISO');
      const offset = own(zoned, 'prototype');
      I.zonedOffset = offset ? own(I.own(offset, 'offsetNanoseconds'), 'get') : undefined;
    } catch { /* Missing/opaque native rule lookup is unavailable. */ }
    I.define(installIntlCustom, '__detectExpertIntlIntrinsicsV1', { __proto__: null, value: I.freeze(I) });
  }
  const state = { installed: 0, unavailable: 0, changed: 0, stopped: false }, rows = [], temporalRows = [], localeRows = [], handles = [];
  let temporalTarget = null, offsetZone;
  function count(row, key) { if (state[key] < 65535) state[key]++; if (row && row[key] < 65535) row[key]++; }
  function copyRows(source) {
    const copy = [];
    for (let index = 0; index < source.length; index++) push(copy, { ...source[index] });
    return copy;
  }
  function snapshot() {
    const result = { ...state, constructors: copyRows(rows) };
    if (temporalRows.length !== 0) result.temporal = copyRows(temporalRows);
    if (localeRows.length !== 0) result.localeMethods = copyRows(localeRows);
    return result;
  }
  function stop() {
    if (state.stopped) return;
    state.stopped = true;
    for (let index = handles.length - 1; index >= 0; index--) {
      const handle = handles[index];
      try { if (own(handle.target, handle.key) === handle.wrapper) I.define(handle.target, handle.key, handle.original); }
      catch { /* A newer owner/frozen descriptor is retained. */ }
    }
    if (temporalTarget) I.apply(I.setDelete, I.temporalInstalled, [temporalTarget]);
  }
  function selectedOffsetForDate(date, nativeOffset) {
    if (state.stopped || typeof offsetZone !== 'string' || typeof I.dateGetTime !== 'function' || typeof I.instantFromMilliseconds !== 'function' || typeof I.instantToZone !== 'function' || typeof I.zonedOffset !== 'function') return;
    try {
      const time = I.apply(I.dateGetTime, date, []);
      if (typeof time !== 'number' || time !== time) return;
      const instant = I.apply(I.instantFromMilliseconds, I.instantConstructor, [time]);
      const zoned = I.apply(I.instantToZone, instant, [offsetZone]);
      const nanoseconds = I.apply(I.zonedOffset, zoned, []);
      if (typeof nanoseconds !== 'number' || nanoseconds !== nanoseconds || nanoseconds < -86400000000000 || nanoseconds > 86400000000000) return;
      // V8 getTimezoneOffset() reports whole minutes truncated toward zero, also
      // for sub-minute historical rules; never answer a fraction or negative zero.
      const minutes = -nanoseconds / 60000000000;
      if (nativeOffset === I.trunc(minutes)) return nativeOffset;
      return I.trunc(minutes) || 0;
    } catch { return; }
  }
  const guard = { snapshot, stop, nativeContext: I.freeze(selectedOffsetForDate) };
  function temporal(zone) {
    if (typeof zone !== 'string' || zone.length === 0 || zone.length > 256) return;
    let namespace, now;
    try { namespace = own(realm, 'Temporal'); now = own(namespace, 'Now'); }
    catch {
      const row = { name: 'Now', installed: 0, unavailable: 0, changed: 0 }; push(temporalRows, row); count(row, 'unavailable'); return;
    }
    if (!namespace || typeof namespace !== 'object') return;
    if (!now || typeof now !== 'object') {
      const row = { name: 'Now', installed: 0, unavailable: 0, changed: 0 }; push(temporalRows, row); count(row, 'unavailable'); return;
    }
    if (I.apply(I.setHas, I.temporalInstalled, [now])) return;
    let selectedZone;
    try {
      const constructor = own(I.constructors, 'DateTimeFormat'), resolved = own(I.resolved, 'DateTimeFormat');
      if (typeof constructor !== 'function' || typeof resolved !== 'function') throw null;
      const options = I.create(null);
      I.define(options, 'timeZone', { __proto__: null, value: zone, enumerable: true });
      // ADR-100: validate only the selected primitive zone; no clock read or caller option access.
      selectedZone = own(I.apply(resolved, I.construct(constructor, [undefined, options]), []), 'timeZone');
      if (typeof selectedZone !== 'string' || selectedZone.length === 0 || selectedZone.length > 256) throw null;
    } catch {
      const row = { name: 'Now', installed: 0, unavailable: 0, changed: 0 }; push(temporalRows, row); count(row, 'unavailable'); return;
    }
    offsetZone = selectedZone;
    I.apply(I.setAdd, I.temporalInstalled, [now]); temporalTarget = now;
    const methods = ['timeZoneId', 'zonedDateTimeISO', 'plainDateTimeISO', 'plainDateISO', 'plainTimeISO'];
    for (let index = 0; index < methods.length; index++) {
      const name = methods[index], row = { name, installed: 0, unavailable: 0, changed: 0 }; push(temporalRows, row);
      try {
        const field = I.own(now, name), original = own(field, 'value');
        if (typeof original !== 'function' || !field.configurable && !field.writable) { count(row, 'unavailable'); continue; }
        const wrapper = guarded(original, { __proto__: null,
          apply(target, receiver, args) {
            if (state.stopped) return I.apply(target, receiver, args);
            if (name === 'timeZoneId') {
              const native = I.apply(target, receiver, args);
              if (state.stopped) return native;
              count(row, 'changed'); return selectedZone;
            }
            // Explicit page zones, including their coercion and errors, stay native.
            if (args.length !== 0 && args[0] !== undefined) return I.apply(target, receiver, args);
            if (args.length > 1024) { count(row, 'unavailable'); return I.apply(target, receiver, args); }
            const forwarded = [];
            push(forwarded, selectedZone);
            for (let item = 1; item < args.length; item++) push(forwarded, args[item]);
            // One native call/clock sample creates the genuine selected-zone result.
            const native = I.apply(target, receiver, forwarded);
            if (!state.stopped) count(row, 'changed');
            return native;
          }
        });
        I.define(now, name, { __proto__: null, ...field, value: wrapper });
        push(handles, { target: now, key: name, original: field, wrapper }); count(row, 'installed');
      } catch { count(row, 'unavailable'); }
    }
  }
  // Locale-sensitive built-ins resolve their default locale (and, for dates, zone/calendar/numbering)
  // inside the one native call. Like the Temporal.Now default above, only what the page omitted is
  // replaced: an undefined locales argument by the selected locale, and an option the page did not
  // provide by the selected value. Any other argument and every error stays the original operation.
  const localeSpecs = [
    // [global, method, position of the locales argument, Intl constructor owning the selectable keys]
    ['Date', 'toLocaleString', 0, 'DateTimeFormat'], ['Date', 'toLocaleDateString', 0, 'DateTimeFormat'], ['Date', 'toLocaleTimeString', 0, 'DateTimeFormat'],
    ['Number', 'toLocaleString', 0, 'NumberFormat'], ['BigInt', 'toLocaleString', 0, 'NumberFormat'],
    ['String', 'localeCompare', 1, 'Collator'], ['String', 'toLocaleUpperCase', 0, 'Collator'], ['String', 'toLocaleLowerCase', 0, 'Collator']
  ];
  // Does the -u- extension of a BCP 47 tag carry this two-letter key ('ca', 'nu')? Plain character reads only.
  function keyword(tag, key) {
    if (typeof tag !== 'string' || tag.length > 256) return false;
    const upper = key === 'ca' ? 'CA' : 'NU';
    let unicode = false, start = 0;
    for (let index = 0; index <= tag.length; index++) {
      if (index < tag.length && tag[index] !== '-') continue;
      const size = index - start;
      if (size === 1) unicode = tag[start] === 'u' || tag[start] === 'U';
      else if (unicode && size === 2 && (tag[start] === key[0] || tag[start] === upper[0]) && (tag[start + 1] === key[1] || tag[start + 1] === upper[1])) return true;
      start = index + 1;
    }
    return false;
  }
  // A calendar or numbering keyword inside the page's own locale tag is an explicit page request as well.
  function fromTag(tag, name) { return name === 'calendar' ? keyword(tag, 'ca') : name === 'numberingSystem' && keyword(tag, 'nu'); }
  // Fresh argument list with at least `size` slots. Array literals neither run inherited index setters nor
  // pay for defineProperty; a slot is only read when the caller really passed it. Later writes hit own slots.
  function copy(args, length, size) {
    const total = length > size ? length : size;
    if (total === 1) return [length > 0 ? args[0] : undefined];
    if (total === 2) return [length > 0 ? args[0] : undefined, length > 1 ? args[1] : undefined];
    if (total === 3) return [length > 0 ? args[0] : undefined, length > 1 ? args[1] : undefined, length > 2 ? args[2] : undefined];
    const list = [];
    for (let item = 0; item < total; item++) push(list, item < length ? args[item] : undefined);
    return list;
  }
  function fresh(defaults, keys, tag) {
    const options = I.create(null);
    for (let item = 0; item < keys.length; item++) if (!fromTag(tag, keys[item])) I.define(options, keys[item], { __proto__: null, value: own(defaults, keys[item]), enumerable: true, configurable: true, writable: true });
    return options;
  }
  // Proxy invariant: a non-configurable read-only data property or getter-less accessor must report its own value.
  function locked(object, key) {
    const field = I.own(object, key);
    if (!field || field.configurable) return false;
    const writable = I.own(field, 'writable');
    if (writable) return writable.value === false;
    const getter = I.own(field, 'get');
    return !getter || getter.value === undefined;
  }
  function localeMethod(owner, name, localeIndex, formatter) {
    const row = { name: owner + '.' + name, installed: 0, unavailable: 0, changed: 0 }; push(localeRows, row);
    try {
      const prototype = own(own(realm, owner), 'prototype');
      const field = prototype && I.own(prototype, name), original = own(field, 'value');
      if (typeof original !== 'function' || !field.configurable && !field.writable) { count(row, 'unavailable'); return; }
      const locale = own(values, 'locale'), defaults = I.create(null), keys = [];
      for (let index = 0; index < definitions.length; index++) {
        if (definitions[index][0] !== formatter) continue;
        const applicable = definitions[index][1];
        for (let item = 0; item < applicable.length; item++) {
          const key = applicable[item], value = own(values, key);
          if (key !== 'locale' && value !== undefined) { I.define(defaults, key, { __proto__: null, value }); push(keys, key); }
        }
      }
      // The wrapper cannot retry a failing original call, so prove once that the engine accepts the selection.
      const constructor = own(I.constructors, formatter);
      if (typeof constructor !== 'function') { count(row, 'unavailable'); return; }
      I.construct(constructor, [locale, fresh(defaults, keys, undefined)]);
      const wrapper = guarded(original, { __proto__: null,
        apply(target, receiver, args) {
          if (state.stopped) return I.apply(target, receiver, args);
          const length = args.length;
          if (length > 1024) { count(row, 'unavailable'); return I.apply(target, receiver, args); }
          // Only undefined (or absent) counts as omitted; null, '' and [] are the page's own request.
          const omitted = length <= localeIndex || args[localeIndex] === undefined;
          if (!omitted && keys.length === 0) return I.apply(target, receiver, args);
          // A fresh list (the caller's arguments are never mutated) that already holds every slot written below.
          const position = localeIndex + 1, forwarded = copy(args, length, keys.length === 0 ? position : position + 1);
          if (omitted) forwarded[localeIndex] = locale;
          let applied = 0;
          if (keys.length !== 0) {
            const options = forwarded[position], tag = omitted ? undefined : forwarded[localeIndex];
            if (options === undefined) { forwarded[position] = fresh(defaults, keys, tag); applied++; }
            else if (options !== null && (typeof options === 'object' || typeof options === 'function')) {
              // Boxing a caller primitive would create a different observable receiver; those stay native.
              let view;
              view = new I.Proxy(options, { __proto__: null,
                get(object, key, holder) {
                  const value = I.get(object, key, holder === view ? object : holder);
                  if (value !== undefined || typeof key !== 'string') return value;
                  const fallback = own(defaults, key);
                  if (fallback === undefined || fromTag(tag, key) || locked(object, key)) return value;
                  applied++; return fallback;
                }
              });
              forwarded[position] = view;
            }
          }
          const result = I.apply(target, receiver, forwarded);
          if (!state.stopped && (omitted || applied !== 0)) count(row, 'changed');
          return result;
        }
      });
      I.define(prototype, name, { __proto__: null, ...field, value: wrapper });
      push(handles, { target: prototype, key: name, original: field, wrapper });
      count(row, 'installed');
    } catch { count(row, 'unavailable'); }
  }
  let selected, legacy;
  if (entries && typeof entries === 'object') for (let index = 0; index < entries.length && index < 1024; index++) {
    const entry = own(entries, index);
    if (own(entry, 'id') === 'intl-formatting') {
      if (selected) { count(null, 'unavailable'); return guard; }
      selected = entry;
    }
    if (own(entry, 'id') === 'timezone' && own(entry, 'mode') === 'custom') {
      if (legacy) { count(null, 'unavailable'); return guard; }
      legacy = entry;
    }
  }
  if (!selected || own(selected, 'mode') !== 'custom') { temporal(own(own(legacy, 'value'), 'timeZone')); return guard; }
  const profile = own(selected, 'value'), values = I.create(null);
  let fields = 0;
  const profileKeys = ['locale', 'timeZone', 'calendar', 'numberingSystem'];
  for (let index = 0; index < profileKeys.length; index++) {
    const key = profileKeys[index];
    const value = own(profile, key);
    if (value !== undefined) {
      if (typeof value !== 'string' || value.length === 0 || value.length > 256) { count(null, 'unavailable'); return guard; }
      I.define(values, key, { __proto__: null, value }); fields++;
    }
  }
  if (fields === 0) { count(null, 'unavailable'); return guard; }
  temporal(own(values, 'timeZone') ?? own(own(legacy, 'value'), 'timeZone'));
  const intl = own(realm, 'Intl');
  if (!intl || typeof intl !== 'object') { count(null, 'unavailable'); return guard; }
  if (I.apply(I.setHas, I.installed, [intl])) return guard;
  I.apply(I.setAdd, I.installed, [intl]);
  for (let index = 0; index < definitions.length; index++) {
    const definition = definitions[index], name = definition[0], applicable = definition[1], keys = definition[2];
    let active = false;
    for (let item = 0; item < applicable.length; item++) if (own(values, applicable[item]) !== undefined) active = true;
    if (!active) continue;
    const field = I.own(intl, name), original = own(field, 'value');
    // A newer optional API that this browser does not have is neither covered nor reported.
    if (!field && definition[3] === true) continue;
    const row = { name, installed: 0, unavailable: 0, changed: 0 }; push(rows, row);
    const nativeConstructor = own(I.constructors, name), resolved = own(I.resolved, name);
    if (typeof original !== 'function' || typeof nativeConstructor !== 'function' || typeof resolved !== 'function' || !field.configurable && !field.writable) {
      count(row, 'unavailable'); continue;
    }
    function captureOptions(args) {
      if (state.stopped) return { args, reads: null, complete: true };
      const options = args.length > 1 ? args[1] : undefined, reads = I.create(null);
      if (options === undefined) return { args, reads, complete: true };
      // Boxing a caller primitive here would create a different observable
      // receiver for inherited getters. Keep the original operation instead.
      if (options === null || typeof options !== 'object' && typeof options !== 'function') return { args, reads, complete: false };
      let proxy;
      proxy = new I.Proxy(options, { __proto__: null,
        get(target, key, receiver) {
          const value = I.get(target, key, receiver === proxy ? target : receiver);
          if (typeof key === 'string') {
            let requested = key === 'localeMatcher' || name === 'DateTimeFormat' && key === 'formatMatcher';
            for (let item = 0; item < keys.length && !requested; item++) requested = keys[item] === key;
            if (requested) I.define(reads, key, { __proto__: null, value: {
              provided: value !== undefined,
              primitive: value === null || typeof value !== 'object' && typeof value !== 'function',
              value: value === null || typeof value !== 'object' && typeof value !== 'function' ? value : undefined
            }, configurable: true });
          }
          return value;
        }
      });
      const forwarded = [];
      for (let item = 0; item < args.length; item++) push(forwarded, item === 1 ? proxy : args[item]);
      return { args: forwarded, reads, complete: true };
    }
    function project(result, receiver, called, captured) {
      if (state.stopped) return result;
      // Legacy ChainDateTimeFormat/ChainNumberFormat returns the caller's same
      // object. Its nonconfigurable hidden formatter cannot safely be replaced.
      if (called && result === receiver) { count(row, 'unavailable'); return result; }
      if (!captured.complete) { count(row, 'unavailable'); return result; }
      // The selected values fill only what the page did not request: an explicit
      // locale argument and explicit options stay exactly as the page passed them.
      const pageLocale = captured.args.length > 0 && captured.args[0] !== undefined;
      let tag;
      function requested(key) {
        const observed = captured.reads && own(captured.reads, key);
        if (observed && observed.provided) return true;
        if (!pageLocale || key !== 'calendar' && key !== 'numberingSystem') return false;
        // The resolved tag of the first native formatter shows which keywords the page's own locale carries.
        if (tag === undefined) { try { tag = own(I.apply(resolved, result, []), 'locale'); } catch { tag = null; } }
        return fromTag(tag, key);
      }
      let missing = false;
      for (let item = 0; item < applicable.length; item++) {
        const key = applicable[item];
        if (own(values, key) !== undefined && !(key === 'locale' ? pageLocale : requested(key))) missing = true;
      }
      // Nothing selected is missing from the request: the first native formatter is the answer.
      if (!missing) return result;
      try {
        const source = I.apply(resolved, result, []), options = I.create(null);
        const localeDefaults = ['calendar', 'numberingSystem', 'hourCycle', 'hour12', 'collation', 'caseFirst', 'numeric', 'sensitivity', 'ignorePunctuation'];
        for (let item = 0; item < keys.length; item++) {
          const key = keys[item], observed = captured.reads && own(captured.reads, key);
          let implicitLocaleDefault = false;
          if (captured.reads && (!observed || !observed.provided)) {
            for (let field = 0; field < localeDefaults.length; field++) if (localeDefaults[field] === key) implicitLocaleDefault = true;
          }
          if (implicitLocaleDefault) continue;
          const value = observed && observed.provided && observed.primitive ? observed.value : own(source, key);
          if (value !== undefined) I.define(options, key, { __proto__: null, value, enumerable: true, configurable: true, writable: true });
        }
        for (let item = 0; item < 2; item++) {
          const key = item === 0 ? 'localeMatcher' : 'formatMatcher';
          if (item === 1 && name !== 'DateTimeFormat') continue;
          const observed = captured.reads && own(captured.reads, key);
          if (!observed || !observed.provided) continue;
          if (!observed.primitive) { count(row, 'unavailable'); return result; }
          I.define(options, key, { __proto__: null, value: observed.value, enumerable: true });
        }
        for (let item = 0; item < applicable.length; item++) {
          const key = applicable[item], value = own(values, key);
          if (key !== 'locale' && value !== undefined && !requested(key)) I.define(options, key, { __proto__: null, value, enumerable: true, configurable: true, writable: true });
        }
        // An explicit page locale list was resolved by the first native call; only a missing one is selected.
        const locale = pageLocale ? own(source, 'locale') : own(values, 'locale') ?? own(source, 'locale');
        // This second construction is deliberate ADR-087 work on trusted
        // primitive metadata and observed primitive options, never another
        // invocation of caller option getters or object coercion.
        const formatter = I.construct(nativeConstructor, [locale, options]);
        const prototype = I.getPrototype(result);
        if (I.getPrototype(formatter) !== prototype) I.setPrototype(formatter, prototype);
        count(row, 'changed'); return formatter;
      } catch { count(row, 'unavailable'); return result; }
    }
    try {
      const wrapper = guarded(original, { __proto__: null,
        apply(target, receiver, args) {
          const captured = captureOptions(args);
          const result = I.apply(target, receiver, captured.args);
          return project(result, receiver, true, captured);
        },
        construct(target, args, newTarget) {
          const captured = captureOptions(args);
          const result = I.construct(target, captured.args, newTarget);
          return project(result, undefined, false, captured);
        }
      });
      I.define(intl, name, { __proto__: null, ...field, value: wrapper });
      push(handles, { target: intl, key: name, original: field, wrapper });
      const prototype = own(original, 'prototype'), constructorField = prototype && I.own(prototype, 'constructor');
      if (own(constructorField, 'value') === original && (constructorField.configurable || constructorField.writable)) {
        I.define(prototype, 'constructor', { __proto__: null, ...constructorField, value: wrapper });
        push(handles, { target: prototype, key: 'constructor', original: constructorField, wrapper });
      }
      count(row, 'installed');
    } catch { count(row, 'unavailable'); }
  }
  // Without a selected locale there is nothing to replace in the locale-sensitive built-ins.
  if (own(values, 'locale') !== undefined) {
    for (let index = 0; index < localeSpecs.length; index++) localeMethod(localeSpecs[index][0], localeSpecs[index][1], localeSpecs[index][2], localeSpecs[index][3]);
  }
  return guard;
}
