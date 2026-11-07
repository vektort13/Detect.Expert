// ADR-039: project only returns of captured native browser APIs during explicit Pro.
// The caller supplies the original result; this module never calls the observed API.
export function createProTechnicalSupport() {
  const apply = Reflect.apply, descriptor = Object.getOwnPropertyDescriptor, has = Object.hasOwn;
  const keys = Object.keys, isArray = Array.isArray, finite = Number.isFinite, integer = Number.isSafeInteger, same = Object.is;
  const fnSource = Function.prototype.toString, exec = RegExp.prototype.exec, define = Object.defineProperty, indexOf = String.prototype.indexOf, lastIndexOf = String.prototype.lastIndexOf, slice = String.prototype.slice;
  const NativeMap = Map, get = Map.prototype.get, set = Map.prototype.set;
  const matches = (re, value) => apply(exec, re, [value]) !== null;
  const appendOwn = (array, value) => define(array, array.length, { __proto__: null, value, writable: true, configurable: true, enumerable: true });
  const native = fn => typeof fn === 'function' && matches(/\[native code\]/, apply(fnSource, fn, []));
  const data = (object, name) => { const d = object && (typeof object === 'object' || typeof object === 'function') ? descriptor(object, name) : null; return d && has(d, 'value') ? d.value : undefined; };
  return function createProTechnicalProjector(realm, early, registry, schemas) {
  const proto = name => data(data(realm, name), 'prototype');
  const getter = (name, key) => { const d = descriptor(proto(name) ?? {}, key), fn = d && has(d, 'get') ? d.get : null; return native(fn) ? fn : null; };
  const method = (name, key) => { const fn = data(proto(name), key); return native(fn) ? fn : null; };
  const trusted = new NativeMap(), branded = new NativeMap();
  const put = (map, key, value) => apply(set, map, [key, value]);
  const lookup = (map, key) => apply(get, map, [key]);
  if (!early) return () => null;
  // Captured before any of our wrappers are installed; no late-runtime native claims.
  const operationNames = keys(registry);
  for (let i = 0; i < operationNames.length; i++) {
    const operation = operationNames[i], firstDot = apply(indexOf, operation, ['.']), lastDot = apply(lastIndexOf, operation, ['.']);
    const owner = apply(slice, operation, [0, firstDot]), last = apply(slice, operation, [lastDot + 1]);
    let target;
    if (owner === 'Window') target = realm;
    else if (owner === 'Intl') target = data(data(data(realm, 'Intl'), apply(slice, operation, [firstDot + 1, lastDot])), 'prototype');
    else target = proto(owner);
    const d = target && descriptor(target, last), fn = d && (has(d, 'value') ? d.value : has(d, 'get') ? d.get : null);
    if (native(fn)) put(trusted, operation, true);
  }
  const brands = [['DOMRectReadOnly', keys(schemas.geometry)], ['SVGRect', ['x', 'y', 'width', 'height']], ['TextMetrics', keys(schemas['text-metrics'])], ['MediaQueryList', ['media', 'matches']], ['Plugin', ['name', 'description', 'filename', 'length']], ['MimeType', ['type', 'description', 'suffixes']]];
  for (let i = 0; i < brands.length; i++) {
    const name = brands[i][0], fields = brands[i][1];
    const readers = [];
    for (let j = 0; j < fields.length; j++) { const field = fields[j], read = getter(name, field); if (read) appendOwn(readers, [field, read]); }
    put(branded, name, readers);
  }
  const rectLength = getter('DOMRectList', 'length'), rectItem = method('DOMRectList', 'item');
  const pluginLength = getter('PluginArray', 'length'), pluginItem = method('PluginArray', 'item');
  const mimeLength = getter('MimeTypeArray', 'length'), mimeItem = method('MimeTypeArray', 'item');
  return function project(operation, phase, result) {
    if (phase !== 'returned-sync' || !lookup(trusted, operation) || !result || typeof result !== 'object') return null;
    const profile = registry[operation][0], fields = [];
    let truncated = false, bytes = 256, stopped = false, validCollection = false;
    function append(name, index, value) {
      const type = typeof value;
      let kind = type;
      if (type === 'number' && (!finite(value) || same(value, -0))) { kind = 'special-number'; value = same(value, -0) ? '-0' : value !== value ? 'NaN' : value > 0 ? 'Infinity' : '-Infinity'; }
      else if (type !== 'string' && type !== 'number' && type !== 'boolean') return false;
      if (type === 'string' && (value.length > 256 || matches(/[\u0000-\u001f\u007f]/, value))) { truncated = true; return false; }
      const cost = 64 + name.length * 2 + (typeof value === 'string' ? value.length * 2 : 16);
      if (fields.length >= 128 || bytes + cost > 8192) { truncated = true; stopped = true; return false; }
      bytes += cost; appendOwn(fields, { name, index, kind, value }); return true;
    }
    function ownField(object, name, output = name, index = 0) {
      const d = descriptor(object, name);
      if (d && has(d, 'value')) append(output, index, d.value);
    }
    function strings(array, field) {
      if (!isArray(array)) return;
      const length = data(array, 'length');
      if (!integer(length) || length < 0) return;
      validCollection = true;
      if (length > 128) truncated = true;
      for (let i = 0; i < length && i < 128 && !stopped; i++) {
        const d = descriptor(array, i);
        if (d && has(d, 'value') && typeof d.value === 'string') append(field, i, d.value);
      }
    }
    function brandedFields(object, name, index = 0) {
      const readers = lookup(branded, name);
      let observed = false;
      for (let i = 0; i < readers.length && !stopped; i++) {
        const field = readers[i][0], read = readers[i][1];
        // Native brand checks reject Proxy/forged objects without reading page getters.
        try { if (append(field, index, apply(read, object, []))) observed = true; } catch {}
      }
      return observed;
    }
    function list(object, lengthGetter, itemMethod, brand, max) {
      if (!lengthGetter || !itemMethod) return;
      const length = apply(lengthGetter, object, []);
      if (!integer(length) || length < 0) return;
      validCollection = true;
      if (length > max) truncated = true;
      for (let i = 0; i < length && i < max && !stopped; i++) brandedFields(apply(itemMethod, object, [i]), brand, i);
    }
    function brands(array) {
      if (!isArray(array)) return;
      const length = data(array, 'length');
      if (!integer(length) || length < 0) return;
      validCollection = true;
      if (length > 32) truncated = true;
      for (let i = 0; i < length && i < 32 && !stopped; i++) {
        const brand = data(array, i);
        if (brand && typeof brand === 'object') { ownField(brand, 'brand', 'brand', i); ownField(brand, 'version', 'version', i); }
      }
    }
    try {
      if (profile === 'languages') strings(result, 'language');
      else if (profile === 'webgl-extensions') strings(result, 'extension');
      else if (profile === 'intl') {
        const names = keys(schemas.intl);
        for (let i = 0; i < names.length && !stopped; i++) if (names[i] !== 'pluralCategory') ownField(result, names[i]);
        const plural = data(result, 'pluralCategories'); if (plural) strings(plural, 'pluralCategory');
      } else if (profile === 'geometry') {
        if (operation === 'Element.getClientRects' || operation === 'Range.getClientRects') list(result, rectLength, rectItem, 'DOMRectReadOnly', 16);
        else if (!brandedFields(result, 'DOMRectReadOnly') && operation === 'SVGGraphicsElement.getBBox') brandedFields(result, 'SVGRect');
      } else if (profile === 'text-metrics') brandedFields(result, 'TextMetrics');
      else if (profile === 'media-query') brandedFields(result, 'MediaQueryList');
      else if (profile === 'plugins') list(result, pluginLength, pluginItem, 'Plugin', 32);
      else if (profile === 'mime-types') list(result, mimeLength, mimeItem, 'MimeType', 42);
      else if (profile === 'ua-data') {
        if (operation === 'NavigatorUAData.brands') brands(result);
        else { ownField(result, 'mobile'); ownField(result, 'platform'); const array = data(result, 'brands'); if (array) brands(array); }
      }
      // An empty valid native collection is represented; missing brand support is not.
      return fields.length || validCollection ? { kind: 'technical', profile, fields, truncated } : null;
    } catch { return null; }
  };
  };
}
export const createProTechnicalProjector = createProTechnicalSupport();
export const proTechnicalRuntimeSource = 'var createProTechnicalProjector = (' + createProTechnicalSupport.toString() + ')();\n';
