// Shared synthetic Geolocation realm for the geolocation Custom tests. Not a test file (no .test.mjs suffix).
// The mock follows the browser: WebIDL-shaped descriptors, brand-checked natives that throw TypeError for foreign receivers,
// callbacks invoked with an undefined `this` and exceptions reported (not rethrown), and requests resolved only when a test says so.
import vm from 'node:vm';
// GEOLOCATION_RUNTIME_URL lets a mutation harness run the whole suite against a deliberately broken copy of the installer.
export const { installGeolocationCustom } = await import(process.env.GEOLOCATION_RUNTIME_URL ?? new URL('../../apps/production-extension/api-custom-geolocation-runtime.js', import.meta.url).href);

export const REAL_POSITION = Object.freeze({ latitude: 51.5, longitude: -0.12, accuracy: 4321, altitude: 35.5, altitudeAccuracy: 7.5, heading: 90, speed: 3.25 });
export const SELECTED = Object.freeze({ latitude: 48.8566, longitude: 2.3522, accuracy: 25 });

export const MOCKS = `(() => {
  'use strict';
  const brands = globalThis.__brands || new WeakMap();
  const native = globalThis.native = { calls: [], reads: 0, jsonCalls: 0, reported: [], pending: [], watchers: new Map(), nextWatch: 1,
    navigatorReads: 0, optionReads: 0, permission: 'granted', clock: 1700000000000, position: ${JSON.stringify(REAL_POSITION)} };
  const illegal = () => new TypeError('Illegal invocation');
  function check(receiver, kind) { const data = brands.get(receiver); if (!data || data.kind !== kind) throw illegal(); return data; }
  function operation(target, name, fn, length) {
    Object.defineProperty(fn, 'name', { value: name, configurable: true });
    Object.defineProperty(fn, 'length', { value: length, configurable: true });
    Object.defineProperty(target, name, { value: fn, writable: true, enumerable: true, configurable: true });
  }
  function attribute(target, name, fn) {
    Object.defineProperty(fn, 'name', { value: 'get ' + name, configurable: true });
    Object.defineProperty(target, name, { get: fn, set: undefined, enumerable: true, configurable: true });
  }
  function iface(name) {
    const constructor = { [name]: class { constructor() { throw new TypeError('Illegal constructor'); } } }[name];
    Object.defineProperty(constructor.prototype, Symbol.toStringTag, { value: name, configurable: true });
    Object.defineProperty(globalThis, name, { value: constructor, writable: true, enumerable: false, configurable: true });
    return constructor;
  }
  const Geolocation = iface('Geolocation'), GeolocationPosition = iface('GeolocationPosition');
  const GeolocationCoordinates = iface('GeolocationCoordinates'), GeolocationPositionError = iface('GeolocationPositionError');
  const Navigator = iface('Navigator');
  const KEYS = ['latitude', 'longitude', 'altitude', 'accuracy', 'altitudeAccuracy', 'heading', 'speed'];
  for (const key of KEYS) attribute(GeolocationCoordinates.prototype, key, function () { const data = check(this, 'coords'); native.reads++; native.lastReceiver = this; return data[key]; });
  const record = data => { const output = {}; for (const key of KEYS) output[key] = data[key]; return output; };
  operation(GeolocationCoordinates.prototype, 'toJSON', function () { const data = check(this, 'coords'); native.jsonCalls++; return record(data); }, 0);
  attribute(GeolocationPosition.prototype, 'coords', function () { return check(this, 'position').coords; });
  attribute(GeolocationPosition.prototype, 'timestamp', function () { return check(this, 'position').timestamp; });
  operation(GeolocationPosition.prototype, 'toJSON', function () { const data = check(this, 'position'); native.jsonCalls++; return { coords: record(brands.get(data.coords)), timestamp: data.timestamp }; }, 0);
  for (const [name, code] of [['PERMISSION_DENIED', 1], ['POSITION_UNAVAILABLE', 2], ['TIMEOUT', 3]]) {
    Object.defineProperty(GeolocationPositionError, name, { value: code, enumerable: true });
    Object.defineProperty(GeolocationPositionError.prototype, name, { value: code, enumerable: true });
  }
  attribute(GeolocationPositionError.prototype, 'code', function () { return check(this, 'error').code; });
  attribute(GeolocationPositionError.prototype, 'message', function () { return check(this, 'error').message; });
  const makeCoords = data => { const coords = Object.create(GeolocationCoordinates.prototype); brands.set(coords, { kind: 'coords', ...data }); return coords; };
  const makePosition = data => {
    const position = Object.create(GeolocationPosition.prototype);
    brands.set(position, { kind: 'position', coords: makeCoords(data), timestamp: ++native.clock });
    return position;
  };
  const makeError = code => {
    const error = Object.create(GeolocationPositionError.prototype);
    brands.set(error, { kind: 'error', code, message: ['', 'User denied Geolocation', 'Position unavailable', 'Timeout expired'][code] });
    return error;
  };
  const instance = Object.create(Geolocation.prototype);
  brands.set(instance, { kind: 'geolocation' });
  const isObject = value => value !== null && (typeof value === 'object' || typeof value === 'function');
  function request(kind) {
    return function () {
      check(this, 'geolocation');
      const args = Array.prototype.slice.call(arguments), [success, error, options] = args;
      native.calls.push({ method: kind, receiver: this, args, length: args.length });
      if (args.length < 1) throw new TypeError("Failed to execute '" + kind + "' on 'Geolocation': 1 argument required, but only 0 present.");
      if (typeof success !== 'function') throw new TypeError("Failed to execute '" + kind + "' on 'Geolocation': The callback provided as parameter 1 is not a function.");
      if (error !== undefined && error !== null && typeof error !== 'function') throw new TypeError("Failed to execute '" + kind + "' on 'Geolocation': The callback provided as parameter 2 is not a function.");
      if (options !== undefined && options !== null && !isObject(options)) throw new TypeError("Failed to execute '" + kind + "' on 'Geolocation': The provided value is not of type 'PositionOptions'.");
      if (isObject(options)) for (const key of ['enableHighAccuracy', 'maximumAge', 'timeout']) { native.optionReads++; void options[key]; }
      const item = { kind, success, error, options };
      if (kind === 'watchPosition') { const id = native.nextWatch++; native.watchers.set(id, item); return id; }
      native.pending.push(item);
      return undefined;
    };
  }
  operation(Geolocation.prototype, 'getCurrentPosition', request('getCurrentPosition'), 1);
  operation(Geolocation.prototype, 'watchPosition', request('watchPosition'), 1);
  operation(Geolocation.prototype, 'clearWatch', function (id) { check(this, 'geolocation'); native.calls.push({ method: 'clearWatch', receiver: this, args: [id] }); native.watchers.delete(id); }, 1);
  Object.defineProperty(Navigator.prototype, 'geolocation', { get() { native.navigatorReads++; return instance; }, enumerable: true, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: Object.create(Navigator.prototype), writable: true, enumerable: true, configurable: true });
  // Browser behaviour: callbacks run with an undefined this; a thrown error is reported, never rethrown to the engine.
  function invoke(callback, argument) {
    if (typeof callback !== 'function') return;
    try { Reflect.apply(callback, undefined, [argument]); } catch (error) { native.reported.push(error); }
  }
  function serve(item, overrides) {
    if (native.permission !== 'granted') invoke(item.error, makeError(1));
    else invoke(item.success, makePosition({ ...native.position, ...overrides }));
  }
  native.deliver = overrides => { for (const item of native.pending.splice(0)) serve(item, overrides); };
  native.update = overrides => { for (const item of [...native.watchers.values()]) serve(item, overrides); };
  native.fail = code => { for (const item of [...native.pending.splice(0), ...native.watchers.values()]) invoke(item.error, makeError(code)); };
  native.engine = overrides => makePosition({ ...native.position, ...overrides });
  native.engineError = makeError;
  native.brands = brands;
  native.geolocation = instance;
})();
`;

// A browser-like realm. Share one `brands` registry between realms so that natives accept each other's objects, as same-origin realms do.
export function createRealm({ mocks = MOCKS, setup = '', brands = new WeakMap() } = {}) {
  const context = vm.createContext({ DOMException, __brands: brands });
  vm.runInContext(mocks + '\n' + setup, context);
  return context;
}

// Serialize the production installer into the realm exactly as api-custom-registration.js does, then run it.
export function installInto(context, entries, { installer = installGeolocationCustom, name = 'geolocation' } = {}) {
  if (!context[name + 'Installer']) vm.runInContext('globalThis.' + name + 'Installer = (' + installer.toString() + ');', context);
  context.__entries = entries;
  return vm.runInContext('globalThis.' + name + 'Installer(globalThis, __entries)', context);
}

export const geoEntry = (value = SELECTED, mode = 'custom') => ({ id: 'geolocation', mode, value: { ...value } });
export const run = (context, source) => vm.runInContext(source, context);

// Page-style helper: request once, resolve the mock, return what the callback received.
export function once(context, { overrides, extra = '' } = {}) {
  return run(context, `(() => {
    let received = null;
    navigator.geolocation.getCurrentPosition(position => { received = position; }, () => {}${extra});
    native.deliver(${JSON.stringify(overrides ?? {})});
    return received;
  })()`);
}
