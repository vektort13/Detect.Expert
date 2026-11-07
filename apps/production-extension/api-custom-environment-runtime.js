// ADR-087: selected environment metadata; no native-source masking or real devices.
// Serialized by the document bootstrap. Keep all dependencies inside this function.
export function installApiCustomEnvironment(realm, entries) {
  const cached = installApiCustomEnvironment.__environmentIntrinsics;
  const I = cached || {
    apply: Reflect.apply, get: Object.getOwnPropertyDescriptor, proto: Object.getPrototypeOf,
    define: Object.defineProperty, create: Object.create, remove: Reflect.deleteProperty,
    keys: Reflect.ownKeys, freeze: Object.freeze, WeakMap, weakGet: WeakMap.prototype.get,
    weakSet: WeakMap.prototype.set, TypeError, String, trunc: Math.trunc,
    trim: String.prototype.trim, lower: String.prototype.toLowerCase, split: String.prototype.split,
    slice: String.prototype.slice, indexOf: String.prototype.indexOf, exec: RegExp.prototype.exec, values: Array.prototype.values, iterator: Symbol.iterator,
    objectPrototype: Object.prototype
  };
  if (!cached) I.define(installApiCustomEnvironment, '__environmentIntrinsics', { __proto__: null, value: I.freeze(I) });
  const { apply, get, proto, define, create } = I;
  const handles = [], rows = [], state = { installed: 0, unavailable: 0, changed: 0, stopped: false };
  let row;
  function own(object, key) {
    if (object === null || typeof object !== 'object' && typeof object !== 'function') return undefined;
    const descriptor = get(object, key); return descriptor && get(descriptor, 'value') ? descriptor.value : undefined;
  }
  function owner(object, key) {
    for (let depth = 0; object && depth < 16; depth++, object = proto(object)) {
      const descriptor = get(object, key);
      if (descriptor) {
        const safe = create(null), keys = I.keys(descriptor);
        for (let index = 0; index < keys.length; index++) define(safe, keys[index], { __proto__: null, value: own(descriptor, keys[index]), enumerable: true });
        return { object, descriptor: safe };
      }
    }
    return null;
  }
  function prototype(name) { return own(own(realm, name), 'prototype'); }
  function push(array, value) { define(array, array.length, { __proto__: null, value, enumerable: true, configurable: true, writable: true }); }
  function copy(value, depth = 0) {
    if (value === null || typeof value !== 'object') return value;
    if (depth > 16) throw new I.TypeError('Selected metadata is too deep.');
    const output = create(null), keys = I.keys(value);
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index], descriptor = get(value, key);
      if (typeof key !== 'string' || !descriptor || !get(descriptor, 'value')) throw new I.TypeError('Expected selected data.');
      define(output, key, { __proto__: null, value: copy(descriptor.value, depth + 1), enumerable: true });
    }
    return output;
  }
  function unavailable(counter = row) { if (state.unavailable < 65535) state.unavailable++; if (counter && counter.unavailable < 65535) counter.unavailable++; }
  function changed() { if (state.changed < 65535) state.changed++; }
  // ADR-112: a replacement function reports the name and length of the function it replaces. Two descriptors are copied (the compatibility
  // measure docs/PROJECT_RULES.md allows); Function.prototype.toString is not touched.
  function matchMeta(replacement, source) {
    if (typeof replacement !== 'function' || typeof source !== 'function' || replacement === source) return;
    for (const metaKey of ['length', 'name']) { const field = get(source, metaKey), data = field && get(field, 'value') ? field.value : undefined; if (data !== undefined) { try { define(replacement, metaKey, { __proto__: null, value: data, writable: false, enumerable: false, configurable: true }); } catch { /* keep the default */ } } }
  }
  function record(found, descriptor) {
    if (!found || !found.descriptor.configurable || handles.length >= 4096) { unavailable(); return false; }
    matchMeta(own(descriptor, 'value'), own(found.descriptor, 'value')); matchMeta(own(descriptor, 'get'), own(found.descriptor, 'get')); matchMeta(own(descriptor, 'set'), own(found.descriptor, 'set'));
    define(found.object, found.key, descriptor); push(handles, { ...found, installed: descriptor });
    state.installed++; row.installed++; return true;
  }
  function find(target, key) { const found = owner(target, key); return found && { ...found, key }; }
  function hide(target, key) {
    const found = find(target, key);
    if (!found || !found.descriptor.configurable || handles.length >= 4096 || !I.remove(found.object, key)) { unavailable(); return; }
    push(handles, { ...found, installed: undefined }); state.installed++; row.installed++;
  }
  function scalar(target, key, value, mode) {
    try {
      if (mode === 'on') { hide(target, key); return; }
      const found = find(target, key);
      if (!found || !found.descriptor.configurable) { unavailable(); return; }
      const original = found.descriptor;
      if (typeof original.get !== 'function' && !get(original, 'value')) { unavailable(); return; }
      const selectedEnvironmentGetter = { selectedEnvironmentGetter() {
        'use strict';
        const native = typeof original.get === 'function' ? apply(original.get, this, arguments) : original.value;
        if (state.stopped) return native;
        changed(); return value;
      } }.selectedEnvironmentGetter;
      record(found, { __proto__: null, get: selectedEnvironmentGetter, set: original.set, enumerable: original.enumerable === true, configurable: true });
    } catch { unavailable(); }
  }
  function method(target, key, transform) {
    const found = find(target, key);
    if (!found || !found.descriptor.configurable || typeof own(found.descriptor, 'value') !== 'function') { unavailable(); return; }
    const original = found.descriptor.value;
    const selectedEnvironmentMethod = { selectedEnvironmentMethod() {
      'use strict';
      const native = apply(original, this, arguments);
      return state.stopped ? native : transform(native, this, arguments);
    } }.selectedEnvironmentMethod;
    record(found, { __proto__: null, ...found.descriptor, value: selectedEnvironmentMethod });
  }
  const navFields = ['appCodeName', 'appName', 'vendorSub', 'product', 'productSub', 'buildID', 'cookieEnabled', 'doNotTrack', 'globalPrivacyControl', 'pdfViewerEnabled', 'webdriver'];
  const screenFields = ['availLeft', 'availTop'];
  // The inner size is this realm's own viewport; the other fields describe the whole window.
  const viewportFields = ['innerWidth', 'innerHeight'];
  const windowFields = ['outerWidth', 'outerHeight', 'screenX', 'screenY'];
  let viewportOwner;
  function currentValue(found) { return typeof found.descriptor.get === 'function' ? apply(found.descriptor.get, realm, []) : found.descriptor.value; }
  // Only a top-level window without an opener lays out in the viewport the selected size describes.
  // A frame or a popup has its own, so it keeps its native inner size and width/height media features.
  // A noopener popup has no opener and cannot be told apart from a tab; that case is accepted.
  // Decided once at installation, so the page cannot flip it later (for example through window.opener).
  function ownsViewport() {
    if (viewportOwner !== undefined) return viewportOwner;
    viewportOwner = false;
    try {
      const topField = find(realm, 'top'), openerField = find(realm, 'opener');
      // No Window.top means no browsing context: there is nothing to compare, so the selection applies.
      if (!topField) viewportOwner = true;
      else if (currentValue(topField) === realm) {
        const opener = openerField ? currentValue(openerField) : null;
        viewportOwner = opener === null || opener === undefined;
      }
    } catch { /* An unreadable window keeps its native size. */ }
    return viewportOwner;
  }
  function scalars(target, keys, value, mode) {
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index];
      if (mode === 'on' || get(value, key)) scalar(target, key, own(value, key), mode);
    }
  }
  function geometry(value, mode) {
    scalars(prototype('Screen'), screenFields, value, mode); scalars(realm, windowFields, value, mode);
    if (mode === 'on' || (get(value, 'innerWidth') || get(value, 'innerHeight')) && ownsViewport()) scalars(realm, viewportFields, value, mode);
    // CSSOM View aliases share the selected coordinate, while retaining each
    // existing native accessor's receiver validation and exception behavior.
    const aliases = [['screenX', 'screenLeft'], ['screenY', 'screenTop']];
    for (let index = 0; index < aliases.length; index++) {
      const pair = aliases[index];
      if (mode === 'on' || get(value, pair[0])) scalar(realm, pair[1], own(value, pair[0]), mode);
    }
    const bar = prototype('BarProp');
    const found = find(bar, 'visible');
    if (!found || !found.descriptor.configurable || typeof found.descriptor.get !== 'function') {
      if (mode === 'on' || get(value, 'scrollbarsVisible') || get(value, 'toolbarVisible')) unavailable();
      return;
    }
    if (mode === 'on') { hide(bar, 'visible'); return; }
    const scroll = find(realm, 'scrollbars'), toolbar = find(realm, 'toolbar');
    const original = found.descriptor;
    // Identify only page-requested BarProp handles using captured genuine accessors.
    const map = new I.WeakMap();
    function remember(field, selected) {
      if (selected === undefined || !field || typeof field.descriptor.get !== 'function') return;
      const getBar = field.descriptor.get;
      const selectedBar = { selectedBar() {
        'use strict';
        const native = apply(getBar, this, arguments);
        if (!state.stopped && native && typeof native === 'object') apply(I.weakSet, map, [native, selected]);
        return native;
      } }.selectedBar;
      record(field, { __proto__: null, ...field.descriptor, get: selectedBar });
    }
    remember(scroll, own(value, 'scrollbarsVisible')); remember(toolbar, own(value, 'toolbarVisible'));
    const selectedVisible = { selectedVisible() {
      'use strict';
      const native = apply(original.get, this, arguments);
      const selected = apply(I.weakGet, map, [this]);
      return state.stopped || selected === undefined ? native : selected;
    } }.selectedVisible;
    record(found, { __proto__: null, ...original, get: selectedVisible });
  }
  function plugins(value, mode) {
    const nav = prototype('Navigator');
    if (mode === 'on') { hide(nav, 'plugins'); hide(nav, 'mimeTypes'); return; }
    const kinds = ['PluginArray', 'Plugin', 'MimeTypeArray', 'MimeType'];
    const prototypes = {}, registry = new I.WeakMap(), operations = {};
    for (let index = 0; index < kinds.length; index++) {
      const kind = kinds[index], target = prototype(kind);
      if (!target) { unavailable(); return; } define(prototypes, kind, { __proto__: null, value: target });
    }
    const pluginGetter = find(nav, 'plugins'), mimeGetter = find(nav, 'mimeTypes');
    if (!pluginGetter || !mimeGetter || typeof pluginGetter.descriptor.get !== 'function' || typeof mimeGetter.descriptor.get !== 'function' || !pluginGetter.descriptor.configurable || !mimeGetter.descriptor.configurable) { unavailable(); return; }
    function entry(receiver, kind) { const found = apply(I.weakGet, registry, [receiver]); return found && found.kind === kind ? found : undefined; }
    function required(args) { if (args.length === 0) throw new I.TypeError('One argument is required.'); }
    function indexValue(value) { const number = +value; return number !== number || number === Infinity || number === -Infinity || number === 0 ? 0 : (I.trunc(number) % 4294967296 + 4294967296) % 4294967296; }
    function nameValue(value) { if (typeof value === 'symbol') throw new I.TypeError('Cannot convert a Symbol value to a string'); return I.String(value); }
    function interfaceField(kind, key) {
      const found = find(prototypes[kind], key);
      if (!found || typeof found.descriptor.get !== 'function' || !found.descriptor.configurable) { unavailable(); return null; }
      const original = found.descriptor.get;
      const selectedPluginField = { selectedPluginField() {
        'use strict';
        const virtual = entry(this, kind);
        return virtual ? own(virtual, key) : apply(original, this, arguments);
      } }.selectedPluginField;
      record(found, { __proto__: null, ...found.descriptor, get: selectedPluginField }); return selectedPluginField;
    }
    function interfaceMethod(kind, key) {
      const found = find(prototypes[kind], key);
      if (!found || typeof found.descriptor.value !== 'function' || !found.descriptor.configurable) { unavailable(); return null; }
      const original = found.descriptor.value;
      const selectedPluginMethod = { selectedPluginMethod() {
        'use strict';
        const virtual = entry(this, kind);
        if (!virtual) return apply(original, this, arguments);
        if (key === I.iterator) return apply(I.values, virtual.items, []);
        if (key === 'refresh') return undefined;
        required(arguments);
        if (key === 'item') return virtual.items[indexValue(arguments[0])] ?? null;
        const name = nameValue(arguments[0]);
        for (let index = 0; index < virtual.names.length; index++) if (virtual.names[index] === name) return virtual.items[index];
        return null;
      } }.selectedPluginMethod;
      record(found, { __proto__: null, ...found.descriptor, value: selectedPluginMethod }); return selectedPluginMethod;
    }
    const fields = { PluginArray: ['length'], MimeTypeArray: ['length'], Plugin: ['name', 'filename', 'description', 'length'], MimeType: ['type', 'suffixes', 'description', 'enabledPlugin'] };
    // A partial interface must not produce a broken virtual collection.
    for (let index = 0; index < kinds.length; index++) {
      const kind = kinds[index], keys = fields[kind];
      for (let item = 0; item < keys.length; item++) {
        const found = find(prototypes[kind], keys[item]);
        if (!found || !found.descriptor.configurable || typeof found.descriptor.get !== 'function') { unavailable(); return; }
      }
      if (kind !== 'MimeType') for (let item = 0; item < 2; item++) {
        const found = find(prototypes[kind], item === 0 ? 'item' : 'namedItem');
        if (!found || !found.descriptor.configurable || typeof found.descriptor.value !== 'function') { unavailable(); return; }
      }
    }
    for (let index = 0; index < kinds.length; index++) {
      const kind = kinds[index], fieldKeys = fields[kind], methods = kind === 'PluginArray' ? ['item', 'namedItem', 'refresh', I.iterator] : kind === 'Plugin' || kind === 'MimeTypeArray' ? ['item', 'namedItem', I.iterator] : [];
      const getters = {}, calls = {};
      for (let item = 0; item < fieldKeys.length; item++) define(getters, fieldKeys[item], { __proto__: null, value: interfaceField(kind, fieldKeys[item]), enumerable: true });
      for (let item = 0; item < methods.length; item++) {
        // Do not fabricate absent interface operations.
        if (find(prototypes[kind], methods[item])) define(calls, methods[item], { __proto__: null, value: interfaceMethod(kind, methods[item]), enumerable: true });
      }
      define(operations, kind, { __proto__: null, value: { getters, calls } });
    }
    function virtual(kind, data) {
      const output = create(prototypes[kind]); define(data, 'kind', { __proto__: null, value: kind });
      apply(I.weakSet, registry, [output, data]);
      const getters = operations[kind].getters, calls = operations[kind].calls, keys = I.keys(getters), methods = I.keys(calls);
      for (let index = 0; index < keys.length; index++) if (getters[keys[index]]) define(output, keys[index], { __proto__: null, get: getters[keys[index]], configurable: true, enumerable: false });
      for (let index = 0; index < methods.length; index++) if (calls[methods[index]]) define(output, methods[index], { __proto__: null, value: calls[methods[index]], configurable: true, writable: true });
      return output;
    }
    function indexed(output, items, names) {
      for (let index = 0; index < items.length; index++) {
        define(output, index, { __proto__: null, value: items[index], enumerable: true, configurable: true });
        const name = names[index];
        if (name && !owner(output, name)) define(output, name, { __proto__: null, value: items[index], configurable: true });
      }
    }
    const selectedPlugins = own(value, 'plugins'), pluginItems = [], pluginNames = [], mimeItems = [], mimeNames = [];
    for (let index = 0; index < selectedPlugins.length; index++) {
      const selected = own(selectedPlugins, index), items = [], names = [];
      const object = virtual('Plugin', { name: own(selected, 'name'), filename: own(selected, 'filename'), description: own(selected, 'description'), length: own(selected, 'mimeTypes').length, items, names });
      push(pluginItems, object); push(pluginNames, own(selected, 'name'));
      const mimeTypes = own(selected, 'mimeTypes');
      for (let item = 0; item < mimeTypes.length; item++) {
        const mime = own(mimeTypes, item), type = own(mime, 'type'); let handle;
        for (let prior = 0; prior < mimeNames.length; prior++) if (mimeNames[prior] === type) handle = mimeItems[prior];
        if (!handle) { handle = virtual('MimeType', { type, suffixes: own(mime, 'suffixes'), description: own(mime, 'description'), enabledPlugin: object }); push(mimeItems, handle); push(mimeNames, type); }
        push(items, handle); push(names, type);
      }
      indexed(object, items, names);
    }
    const pluginArray = virtual('PluginArray', { length: pluginItems.length, items: pluginItems, names: pluginNames });
    const mimeArray = virtual('MimeTypeArray', { length: mimeItems.length, items: mimeItems, names: mimeNames });
    indexed(pluginArray, pluginItems, pluginNames); indexed(mimeArray, mimeItems, mimeNames);
    function navigatorCollection(found, selected) {
      const original = found.descriptor.get;
      const selectedPluginCollection = { selectedPluginCollection() {
        'use strict';
        const native = apply(original, this, arguments);
        if (state.stopped) return native;
        changed(); return selected;
      } }.selectedPluginCollection;
      record(found, { __proto__: null, ...found.descriptor, get: selectedPluginCollection });
    }
    navigatorCollection(pluginGetter, pluginArray); navigatorCollection(mimeGetter, mimeArray);
  }
  function trim(value) { return apply(I.trim, value, []); }
  function lower(value) { return apply(I.lower, value, []); }
  function split(value, separator) { return apply(I.split, value, [separator]); }
  function slice(value, start, end) { return apply(I.slice, value, [start, end]); }
  function indexOf(value, search, from) { return apply(I.indexOf, value, [search, from]); }
  function exec(pattern, value) { return apply(I.exec, pattern, [value]); }
  // Index of the ")" that closes a leading "(", or -1.
  function closing(text) {
    let depth = 0;
    for (let index = 0; index < text.length; index++) {
      const char = text[index];
      if (char === '(') depth++; else if (char === ')' && --depth === 0) return index;
    }
    return -1;
  }
  function media(value, mode) {
    if (mode === 'on') { hide(realm, 'matchMedia'); return; }
    const target = prototype('MediaQueryList'), matches = find(target, 'matches'), query = find(target, 'media');
    if (!matches || !query || typeof matches.descriptor.get !== 'function' || typeof query.descriptor.get !== 'function' || !matches.descriptor.configurable) { unavailable(); return; }
    const mapped = new I.WeakMap(), nativeMatches = matches.descriptor.get, nativeMedia = query.descriptor.get;
    const names = { 'prefers-color-scheme': 'colorScheme', 'prefers-reduced-motion': 'reducedMotion', 'prefers-contrast': 'contrast', 'forced-colors': 'forcedColors', hover: 'hover', pointer: 'pointer', 'display-mode': 'displayMode', update: 'update', 'overflow-block': 'overflowBlock' };
    // ADR-100: evaluate only a bounded subset of the query already parsed by
    // the native engine. Unsupported syntax/units retain the native result.
    // Width, height and orientation describe the viewport, which only a top-level window owns; device-width/height
    // follow the selected Screen rows; resolution is device-wide. A value that is not selected stays unknown.
    const viewport = get(value, 'viewportWidth') || get(value, 'viewportHeight') ? ownsViewport() : false;
    const measured = { width: true, height: true, resolution: true, 'device-width': true, 'device-height': true };
    function screenSize(id) {
      for (let index = 0; index < entries.length; index++) {
        const item = own(entries, index);
        if (own(item, 'id') !== id) continue;
        const size = own(item, 'value');
        return (own(item, 'mode') || 'custom') === 'custom' && typeof size === 'number' && size > 0 ? size : undefined;
      }
      return undefined;
    }
    const deviceWidth = screenSize('screen-width'), deviceHeight = screenSize('screen-height');
    function dimension(feature) {
      if (feature === 'device-width') return deviceWidth;
      if (feature === 'device-height') return deviceHeight;
      if (feature === 'resolution') return own(value, 'resolutionDppx');
      return viewport ? own(value, feature === 'width' ? 'viewportWidth' : 'viewportHeight') : undefined;
    }
    function orientation() {
      const width = dimension('width'), height = dimension('height');
      return width === undefined || height === undefined ? undefined : height >= width ? 'portrait' : 'landscape';
    }
    function amount(text, feature) {
      const parsed = exec(/^([+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:e[+-]?[0-9]+)?)(px|dppx|dpi|dpcm|x)?$/, trim(text));
      if (!parsed) return undefined;
      const number = +parsed[1], unit = parsed[2];
      if (number !== number || number === Infinity || number === -Infinity) return undefined;
      if (feature === 'resolution') {
        if (unit !== 'dppx' && unit !== 'dpi' && unit !== 'dpcm' && unit !== 'x') return undefined;
      } else if (feature === 'ratio') {
        if (unit !== undefined) return undefined;
      } else if (unit !== 'px' && !(unit === undefined && number === 0)) return undefined;
      return number * (unit === 'dpi' ? 1 / 96 : unit === 'dpcm' ? 2.54 / 96 : 1);
    }
    function compare(left, operator, right) {
      return operator === '=' ? left === right : operator === '<' ? left < right : operator === '<=' ? left <= right : operator === '>' ? left > right : left >= right;
    }
    function and3(left, right) { return left === false || right === false ? false : left === undefined || right === undefined ? undefined : true; }
    function or3(left, right) { return left === true || right === true ? true : left === undefined || right === undefined ? undefined : false; }
    function not3(operand) { return operand === undefined ? undefined : !operand; }
    // any-pointer / any-hover describe every available device, so the primary pointer / hover value belongs to the same set
    // (Media Queries 4): a value matches when it is in the set, "none" only when the set is exactly {none}, the boolean form
    // when some value is not "none". Neither row selected: unknown (native). Heuristic reading of the specification, unverified in Chrome.
    function anyDevice(feature, expected) {
      const primary = own(value, feature === 'any-pointer' ? 'pointer' : 'hover'), every = own(value, feature === 'any-pointer' ? 'anyPointer' : 'anyHover');
      if (primary === undefined && every === undefined) return undefined;
      const present = primary === undefined ? [every] : every === undefined || every === primary ? [primary] : [primary, every];
      let some = false, only = true;
      for (let index = 0; index < present.length; index++) {
        if (present[index] !== 'none') only = false;
        if (expected === undefined ? present[index] !== 'none' : present[index] === expected) some = true;
      }
      return expected === 'none' ? only : some;
    }
    // One feature in parentheses, for example (min-width: 800px); true, false or undefined when it is not selected.
    function condition(text) {
      text = trim(text);
      const boolean = exec(/^\(\s*([a-z-]+)\s*\)$/, text);
      if (boolean) {
        const feature = boolean[1], key = own(names, feature);
        if (feature === 'any-pointer' || feature === 'any-hover') return anyDevice(feature, undefined);
        const selected = key ? own(value, key) : own(measured, feature) ? dimension(feature) : feature === 'orientation' ? orientation() : feature === '-webkit-device-pixel-ratio' ? dimension('resolution') : feature === 'grid' ? own(value, 'grid') : feature === 'color-gamut' ? own(value, 'colorGamut') : feature === 'dynamic-range' ? own(value, 'dynamicRange') : undefined;
        return selected === undefined ? undefined : selected !== false && selected !== 0 && selected !== 'none' && selected !== 'no-preference';
      }
      const comparison = exec(/^\(\s*([^<>=()]+?)\s*(<=|>=|<|>|=)\s*([^<>=()]+?)\s*(?:(<=|>=|<|>|=)\s*([^<>=()]+?))?\s*\)$/, text);
      if (comparison) {
        const first = trim(comparison[1]), middle = trim(comparison[3]);
        const firstFeature = own(measured, first) === true, middleFeature = own(measured, middle) === true;
        if (firstFeature === middleFeature || comparison[4] && firstFeature) return undefined;
        const feature = firstFeature ? first : middle, selected = dimension(feature);
        if (selected === undefined) return undefined;
        const bound = amount(firstFeature ? middle : first, feature);
        if (bound === undefined) return undefined;
        const matched = firstFeature ? compare(selected, comparison[2], bound) : compare(bound, comparison[2], selected);
        if (!comparison[4]) return matched;
        const lowerDirection = comparison[2] === '<' || comparison[2] === '<=';
        const upperDirection = comparison[2] === '>' || comparison[2] === '>=';
        if (!(lowerDirection && (comparison[4] === '<' || comparison[4] === '<=') || upperDirection && (comparison[4] === '>' || comparison[4] === '>='))) return undefined;
        const end = amount(comparison[5], feature);
        return end === undefined ? undefined : matched && compare(selected, comparison[4], end);
      }
      const part = exec(/^\(\s*([a-z-]+)\s*:\s*([a-z0-9.+-]+)\s*\)$/, text);
      if (!part) return undefined;
      const feature = part[1], expected = part[2], key = own(names, feature);
      if (feature === 'any-pointer' || feature === 'any-hover') return anyDevice(feature, expected);
      if (key) { const selected = own(value, key); return selected === undefined ? undefined : selected === expected; }
      if (feature === 'color-gamut') {
        const gamut = own(value, 'colorGamut'), levels = { srgb: 1, p3: 2, rec2020: 3 };
        return gamut === undefined || own(levels, expected) === undefined ? undefined : levels[gamut] >= levels[expected];
      }
      if (feature === 'dynamic-range') { const selected = own(value, 'dynamicRange'); return selected === undefined ? undefined : expected === 'standard' || expected === 'high' && selected === 'high'; }
      if (feature === 'grid') { const selected = own(value, 'grid'); return selected === undefined ? undefined : expected === (selected ? '1' : '0'); }
      if (feature === 'orientation') { const selected = orientation(); return selected === undefined ? undefined : selected === expected; }
      const ratio = exec(/^-webkit-(min-|max-)?device-pixel-ratio$/, feature);
      const range = ratio || exec(/^(min-|max-)?(width|height|resolution|device-width|device-height)$/, feature);
      if (!range) return undefined;
      const selected = dimension(ratio ? 'resolution' : range[2]), number = amount(expected, ratio ? 'ratio' : range[2]);
      if (selected === undefined || number === undefined) return undefined;
      return range[1] === 'min-' ? selected >= number : range[1] === 'max-' ? selected <= number : selected === number;
    }
    // Top-level terms of a media query: balanced "( ... )" groups and bare words, split on single spaces. Bounded.
    function terms(text) {
      const output = []; let depth = 0, start = 0;
      for (let index = 0; index < text.length; index++) {
        const char = text[index];
        if (char === '(') depth++;
        else if (char === ')') { if (--depth < 0) return undefined; }
        else if (char === ' ' && depth === 0) { if (index > start) push(output, slice(text, start, index)); start = index + 1; }
        if (output.length > 64) return undefined;
      }
      if (depth !== 0) return undefined;
      if (text.length > start) push(output, slice(text, start));
      return output;
    }
    let used = false;
    // A parenthesised term: a group of conditions recurses, a single feature is evaluated by condition().
    function group(term, depth) {
      if (term[0] !== '(' || closing(term) !== term.length - 1) return undefined;
      const inner = trim(slice(term, 1, term.length - 1));
      if (inner[0] === '(' || exec(/^not\s/, inner)) {
        const list = depth < 8 ? terms(inner) : undefined;
        return list ? compound(list, 0, depth + 1, false) : undefined;
      }
      const selected = condition(term);
      if (selected !== undefined) used = true;
      return selected;
    }
    // Media condition from list[from]: "not G", "G (and G)*" or, unless onlyAnd, "G (or G)*". Any other shape is unresolved.
    function compound(list, from, depth, onlyAnd) {
      const count = list.length - from;
      if (count < 1) return undefined;
      if (count === 2 && list[from] === 'not') return not3(group(list[from + 1], depth));
      let result = group(list[from], depth);
      if (count === 1) return result;
      const joiner = list[from + 1];
      if (count % 2 === 0 || joiner !== 'and' && (joiner !== 'or' || onlyAnd)) return undefined;
      for (let index = from + 2; index < list.length; index += 2) {
        if (list[index - 1] !== joiner) return undefined;
        const next = group(list[index], depth);
        result = joiner === 'and' ? and3(result, next) : or3(result, next);
      }
      return result;
    }
    // Media types describe the screen device of this profile: all/screen match, the rest never do.
    const types = { all: true, screen: true, print: false, speech: false, tty: false, tv: false, projection: false, handheld: false, braille: false, embossed: false, aural: false };
    function evaluate(text) {
      if (typeof text !== 'string' || text.length > 4096) return undefined;
      const alternatives = split(lower(text), ','); if (alternatives.length > 32) return undefined;
      // Three-valued logic (ADR-100): a selected false decides AND and a selected true decides OR. A query that
      // the selection cannot decide, or in which no selected feature took part (a bare media type), keeps the
      // native answer as a whole; a profile-evaluated part is never combined with a natively evaluated one.
      let any = false, unresolved = false;
      used = false;
      for (let index = 0; index < alternatives.length; index++) {
        const list = terms(trim(alternatives[index]));
        if (!list || !list.length) { unresolved = true; continue; }
        const head = list[0];
        let matched;
        if (head[0] === '(' || head === 'not' && list.length === 2 && list[1][0] === '(') matched = compound(list, 0, 0, false);
        else {
          // [not|only] <media type> [and <condition>]: `not` negates the whole alternative, `only` is ignored.
          const prefix = list.length > 1 && (head === 'not' || head === 'only') ? head : undefined, at = prefix ? 1 : 0;
          const type = own(types, list[at]);
          if (type === undefined) { unresolved = true; continue; }
          matched = at + 1 === list.length ? type : list[at + 1] === 'and' ? and3(type, compound(list, at + 2, 0, true)) : undefined;
          if (prefix === 'not') matched = not3(matched);
        }
        if (matched === undefined) unresolved = true;
        else if (matched) any = true;
      }
      return !used ? undefined : any ? true : unresolved ? undefined : false;
    }
    method(realm, 'matchMedia', native => {
      const selected = evaluate(apply(nativeMedia, native, []));
      if (selected !== undefined) apply(I.weakSet, mapped, [native, selected]);
      return native;
    });
    const selectedMediaMatches = { selectedMediaMatches() {
      'use strict';
      const native = apply(nativeMatches, this, arguments);
      if (state.stopped) return native;
      let selected = apply(I.weakGet, mapped, [this]);
      if (selected === undefined) {
        // A genuine MQL may predate installation or come from another Window.
        // Native matches already validated its brand. Read the query through
        // the captured native accessor, never the page's this.media property.
        selected = evaluate(apply(nativeMedia, this, []));
        if (selected !== undefined) apply(I.weakSet, mapped, [this, selected]);
      }
      return selected === undefined ? native : selected;
    } }.selectedMediaMatches;
    record(matches, { __proto__: null, ...matches.descriptor, get: selectedMediaMatches });
  }
  function supports(value, mode) {
    const css = own(realm, 'CSS');
    if (mode === 'on') { hide(css, 'supports'); return; }
    const queries = own(value, 'queries'), keys = [];
    // String comparison only: ASCII case, one outer "( )" pair and spaces around the declaration colon do not matter.
    function canonical(text) {
      text = trim(lower(text));
      for (let wrap = 0; wrap < 4 && text[0] === '(' && closing(text) === text.length - 1; wrap++) text = trim(slice(text, 1, text.length - 1));
      const colon = indexOf(text, ':'), open = indexOf(text, '(');
      return colon > 0 && (open < 0 || colon < open) ? trim(slice(text, 0, colon)) + ':' + trim(slice(text, colon + 1)) : text;
    }
    function lookup(key) {
      for (let index = 0; index < keys.length; index++) if (keys[index] === key) return own(queries[index], 'supported');
      return undefined;
    }
    // Split on " and " without String.prototype.split: no Symbol.split lookup on a page-modifiable prototype.
    function conjuncts(text) {
      const parts = []; let from = 0;
      for (let guard = 0; guard < 16; guard++) {
        const at = indexOf(text, ' and ', from);
        if (at < 0) break;
        push(parts, slice(text, from, at)); from = at + 5;
      }
      push(parts, slice(text, from));
      return parts;
    }
    // A conjunction is decided by the selection alone: any selected false, or every part selected true.
    function conjunction(text) {
      const whole = lookup(canonical(text));
      if (whole !== undefined) return whole;
      const parts = conjuncts(lower(text));
      if (parts.length < 2) return undefined;
      let result = true;
      for (let index = 0; index < parts.length; index++) {
        const part = lookup(canonical(parts[index]));
        if (part === false) return false;
        if (part === undefined) result = undefined;
      }
      return result;
    }
    for (let index = 0; index < queries.length; index++) push(keys, canonical(own(queries[index], 'query')));
    method(css, 'supports', (native, receiver, args) => {
      const one = args.length === 1 && typeof args[0] === 'string';
      const two = args.length >= 2 && typeof args[0] === 'string' && typeof args[1] === 'string';
      if (!one && !two || args[0].length > 4096 || two && args[1].length > 4096) return native;
      const selected = two ? lookup(trim(lower(args[0])) + ':' + trim(lower(args[1]))) : conjunction(args[0]);
      return selected === undefined ? native : selected;
    });
  }
  for (let index = 0; index < entries.length; index++) {
    const entry = own(entries, index), id = own(entry, 'id'), mode = own(entry, 'mode') || 'custom';
    if (id !== 'navigator-metadata' && id !== 'navigator-plugins' && id !== 'screen-geometry' && id !== 'css-media' && id !== 'css-supports') continue;
    row = { id, installed: 0, unavailable: 0 }; push(rows, row);
    if (mode !== 'custom' && mode !== 'on') continue;
    try {
      const value = mode === 'on' ? create(null) : copy(own(entry, 'value'));
      if (id === 'navigator-metadata') scalars(prototype('Navigator'), navFields, value, mode);
      else if (id === 'navigator-plugins') plugins(value, mode);
      else if (id === 'screen-geometry') geometry(value, mode);
      else if (id === 'css-media') media(value, mode);
      else supports(value, mode);
    } catch { unavailable(); }
  }
  return {
    snapshot() { const summary = []; for (let index = 0; index < rows.length; index++) push(summary, { ...rows[index] }); return { ...state, entries: summary }; },
    stop() {
      if (state.stopped) return; state.stopped = true;
      for (let index = handles.length - 1; index >= 0; index--) {
        const handle = handles[index];
        try {
          const current = get(handle.object, handle.key), installed = handle.installed;
          const owned = installed === undefined ? current === undefined : current && (installed.get ? own(current, 'get') === installed.get && own(current, 'set') === installed.set : get(current, 'value') && own(current, 'value') === installed.value);
          if (owned) define(handle.object, handle.key, handle.descriptor);
        } catch { /* A later owner or frozen descriptor controls cleanup. */ }
      }
    }
  };
}
