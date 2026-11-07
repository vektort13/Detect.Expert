// Custom geolocation: genuine native GeolocationCoordinates / GeolocationPosition objects report the selected position.
// Only a SUCCESSFUL native result is affected, and only through its attributes. getCurrentPosition, watchPosition, clearWatch,
// the permission prompt, denial, timeout and unavailable errors, the Permissions API, `timestamp`, the `coords` identity and
// navigator.geolocation stay native and are not wrapped. No position is created without a native success: the browser still
// resolves the real position internally, the page only sees the selected one.
// Serialized by api-custom-registration.js: keep this function self-contained (no imports, no outer references).
export function installGeolocationCustom(realm, entries) {
  'use strict';
  const cached = installGeolocationCustom.__detectExpertGeolocationIntrinsicsV1;
  const I = cached || {
    apply: Reflect.apply, own: Object.getOwnPropertyDescriptor, define: Object.defineProperty, create: Object.create,
    ownKeys: Reflect.ownKeys, freeze: Object.freeze, isArray: Array.isArray, isFinite: Number.isFinite,
    objectPrototype: Object.prototype, setHas: WeakSet.prototype.has, setAdd: WeakSet.prototype.add,
    installed: new WeakSet()
  };
  if (!cached) I.define(installGeolocationCustom, '__detectExpertGeolocationIntrinsicsV1', { __proto__: null, value: I.freeze(I) });
  // Position attributes in WebIDL order; the first three always carry the selected numbers, the others are null.
  const KEYS = ['latitude', 'longitude', 'accuracy', 'altitude', 'altitudeAccuracy', 'heading', 'speed'];
  const LIMIT = 65535, HANDLES = 16;
  const handles = [], state = { installed: 0, unavailable: 0, changed: 0, stopped: false };
  // Own data value only: descriptors and selected data are never read through inherited (pollutable) properties.
  function own(target, key) {
    if (target === null || typeof target !== 'object' && typeof target !== 'function') return undefined;
    const field = I.own(target, key);
    return field && I.own(field, 'value') ? field.value : undefined;
  }
  function push(array, item) { I.define(array, array.length, { __proto__: null, value: item, enumerable: true, configurable: true, writable: true }); }
  function unavailable() { if (state.unavailable < LIMIT) state.unavailable++; }
  function changed() { if (state.changed < LIMIT) state.changed++; }
  function prototypeOf(name) { return own(own(realm, name), 'prototype'); }
  function snapshot() { return { installed: state.installed, unavailable: state.unavailable, changed: state.changed, stopped: state.stopped }; }
  // Restore only descriptors this installer still owns; a page may have replaced or frozen its own.
  function restore() {
    for (let index = handles.length - 1; index >= 0; index--) {
      const handle = handles[index];
      try {
        const current = I.own(handle.target, handle.key), installed = handle.descriptor;
        const owned = current && (installed.get ? own(current, 'get') === installed.get && own(current, 'set') === installed.set : own(current, 'value') === installed.value);
        if (owned) I.define(handle.target, handle.key, { __proto__: null, ...handle.original });
      } catch { /* The page may have replaced or frozen its descriptor. */ }
    }
  }
  function stop() {
    if (state.stopped) return;
    state.stopped = true;
    restore();
  }
  const result = { snapshot, stop };
  let entry, duplicate = false;
  if (I.isArray(entries)) for (let index = 0; index < entries.length && index < 1024; index++) {
    const candidate = own(entries, index);
    if (own(candidate, 'id') === 'geolocation') { if (entry) duplicate = true; else entry = candidate; }
  }
  if (!entry) return result;
  const mode = own(entry, 'mode');
  // ON (block) belongs to the protection module, never to this installer.
  if (duplicate || mode !== 'custom') { if (duplicate || mode === 'on') unavailable(); return result; }
  const value = own(entry, 'value'), latitude = own(value, 'latitude'), longitude = own(value, 'longitude'), accuracy = own(value, 'accuracy');
  // Fail closed: anything outside the contract domain leaves the native results untouched.
  if (typeof latitude !== 'number' || !I.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      typeof longitude !== 'number' || !I.isFinite(longitude) || longitude < -180 || longitude > 180 ||
      typeof accuracy !== 'number' || !I.isFinite(accuracy) || accuracy < 1 || accuracy > 100000) { unavailable(); return result; }
  const selected = I.freeze({ __proto__: null, latitude, longitude, accuracy, altitude: null, altitudeAccuracy: null, heading: null, speed: null });
  const coordinates = prototypeOf('GeolocationCoordinates'), position = prototypeOf('GeolocationPosition');
  if (coordinates === null || typeof coordinates !== 'object' || position === null || typeof position !== 'object') { unavailable(); return result; }
  if (I.apply(I.setHas, I.installed, [coordinates])) return result;
  // Copy own string-keyed data of a record that cannot be rewritten in place, replacing the given members.
  function rebuild(record, replacements) {
    const output = I.create(I.objectPrototype), keys = I.ownKeys(record);
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index], field = typeof key === 'string' ? I.own(record, key) : undefined;
      if (!field || !I.own(field, 'value')) continue;
      I.define(output, key, { __proto__: null, value: key in replacements ? replacements[key] : field.value, writable: true, enumerable: own(field, 'enumerable') === true, configurable: true });
    }
    return output;
  }
  // Rewrite a fresh native JSON record in place (key order and prototype stay native). A record that cannot be rewritten
  // is rebuilt with the selected numbers only: the native position never reaches the page through this path.
  function project(record) {
    if (record === null || typeof record !== 'object') return record;
    try {
      for (let index = 0; index < KEYS.length; index++) {
        const key = KEYS[index], field = I.own(record, key);
        if (field) I.define(record, key, { __proto__: null, value: selected[key], writable: true, enumerable: own(field, 'enumerable') === true, configurable: true });
      }
      changed();
      return record;
    } catch { /* Frozen or exotic record: rebuild below. */ }
    const output = I.create(I.objectPrototype), keys = I.ownKeys(record);
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index];
      if (typeof key === 'string' && key in selected && I.own(record, key)) I.define(output, key, { __proto__: null, value: selected[key], writable: true, enumerable: true, configurable: true });
    }
    changed();
    return output;
  }
  // ADR-112: a replacement function reports the name and length of the function it replaces. Two descriptors are copied (the compatibility
  // measure docs/PROJECT_RULES.md allows); Function.prototype.toString is not touched.
  function matchMeta(replacement, source) {
    if (typeof replacement !== 'function' || typeof source !== 'function') return replacement;
    for (const metaKey of ['length', 'name']) { const value = own(source, metaKey); if (value !== undefined) { try { I.define(replacement, metaKey, { __proto__: null, value, writable: false, enumerable: false, configurable: true }); } catch { /* keep the default */ } } }
    return replacement;
  }
  // The key is bound per accessor; page code never sees or supplies it.
  function accessor(key, original) {
    return matchMeta({ customGeolocationCoordinate() {
      'use strict';
      const native = I.apply(original, this, []);
      if (state.stopped) return native;
      changed();
      return selected[key];
    } }.customGeolocationCoordinate, original);
  }
  function coordinatesToJSON(original) {
    return matchMeta({ customGeolocationCoordinatesToJSON() {
      'use strict';
      const native = I.apply(original, this, arguments);
      if (state.stopped) return native;
      return project(native);
    } }.customGeolocationCoordinatesToJSON, original);
  }
  function positionToJSON(original) {
    return matchMeta({ customGeolocationPositionToJSON() {
      'use strict';
      const native = I.apply(original, this, arguments);
      if (state.stopped) return native;
      // Native JSON of a position is { coords: {...}, timestamp }; only the coords record carries location data.
      const coords = own(native, 'coords');
      if (coords === null || typeof coords !== 'object') return native;
      const projected = project(coords);
      if (projected === coords) return native;
      try { I.define(native, 'coords', { __proto__: null, value: projected, writable: true, enumerable: true, configurable: true }); return native; }
      catch { return rebuild(native, { __proto__: null, coords: projected }); }
    } }.customGeolocationPositionToJSON, original);
  }
  // Plan everything first: one missing or non-configurable surface leaves the whole native interface untouched.
  const plan = [];
  for (let index = 0; index < KEYS.length; index++) {
    const key = KEYS[index], field = I.own(coordinates, key), get = own(field, 'get');
    if (!field) { if (index < 3) { unavailable(); return result; } continue; }
    if (own(field, 'configurable') !== true || typeof get !== 'function') { unavailable(); return result; }
    push(plan, { target: coordinates, key, original: field, descriptor: { __proto__: null, get: accessor(key, get), set: own(field, 'set'), configurable: true, enumerable: own(field, 'enumerable') === true } });
  }
  const jsons = [[coordinates, coordinatesToJSON], [position, positionToJSON]];
  for (let index = 0; index < jsons.length; index++) {
    const target = jsons[index][0], field = I.own(target, 'toJSON'), method = own(field, 'value');
    if (!field) continue;
    if (own(field, 'configurable') !== true || typeof method !== 'function') { unavailable(); return result; }
    push(plan, { target, key: 'toJSON', original: field, descriptor: { __proto__: null, value: jsons[index][1](method), configurable: true, writable: own(field, 'writable') === true, enumerable: own(field, 'enumerable') === true } });
  }
  if (plan.length > HANDLES) { unavailable(); return result; }
  try {
    for (let index = 0; index < plan.length; index++) {
      const item = plan[index];
      I.define(item.target, item.key, item.descriptor);
      push(handles, item); state.installed++;
    }
  } catch {
    restore(); state.installed = 0; unavailable();
    return result;
  }
  I.apply(I.setAdd, I.installed, [coordinates]);
  return result;
}
