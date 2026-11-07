// Custom geolocation installer: genuine native position objects report the selected coordinates.
// Every scenario runs the SERIALIZED installer inside a vm realm with a browser-shaped Geolocation mock (see the kit).
import test from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { createRealm, installInto, geoEntry, run, once, REAL_POSITION, SELECTED, installGeolocationCustom } from './api-custom-geolocation-kit.mjs';

const KEYS = ['latitude', 'longitude', 'altitude', 'accuracy', 'altitudeAccuracy', 'heading', 'speed'];
const SELECTED_VALUES = [SELECTED.latitude, SELECTED.longitude, null, SELECTED.accuracy, null, null, null];
const SELECTED_RECORD = Object.fromEntries(KEYS.map((key, index) => [key, SELECTED_VALUES[index]]));
const REAL_RECORD = Object.fromEntries(KEYS.map(key => [key, REAL_POSITION[key]]));
const plain = value => JSON.parse(JSON.stringify(value));
const INTERFACES = ['Geolocation', 'GeolocationPosition', 'GeolocationCoordinates', 'GeolocationPositionError', 'Navigator'];

// Own property descriptors of an interface prototype, with function identities kept for comparisons.
const shape = (realm, name) => run(realm, `(() => { const prototype = globalThis.${name}?.prototype; return prototype ? Reflect.ownKeys(prototype).map(key => ({ key, ...Object.getOwnPropertyDescriptor(prototype, key) })) : null; })()`);
function sameShape(before, after, replaced = new Set()) {
  assert.equal(after.length, before.length, 'same number of own properties');
  before.forEach((row, index) => {
    const next = after[index], label = String(row.key);
    assert.equal(next.key, row.key, 'same key order');
    for (const flag of ['enumerable', 'configurable', 'writable']) assert.equal(next[flag], row[flag], label + ':' + flag);
    if (replaced.has(row.key)) {
      if (row.get) { assert.equal(typeof next.get, 'function', label); assert.notEqual(next.get, row.get, label + ' replaced'); assert.equal(next.set, row.set, label + ' setter'); }
      else { assert.equal(typeof next.value, 'function', label); assert.notEqual(next.value, row.value, label + ' replaced'); }
    } else for (const part of ['get', 'set', 'value']) assert.equal(next[part], row[part], label + ':' + part);
  });
}
const shapes = realm => Object.fromEntries(INTERFACES.map(name => [name, shape(realm, name)]));
function assertUntouched(realm, before) { for (const name of INTERFACES) if (before[name]) sameShape(before[name], shape(realm, name)); }
// Outcome of a page expression: the value or the error identity by name and message.
const probe = (realm, source) => run(realm, `(() => { try { return JSON.stringify({ ok: true, value: (${source}) ?? null }); } catch (error) { return JSON.stringify({ ok: false, name: error?.name, message: String(error?.message) }); } })()`);

test('installs nine descriptors; request methods, errors, position and navigator surfaces stay the native objects', () => {
  const realm = createRealm(), before = shapes(realm);
  const installation = installInto(realm, [geoEntry()]);
  assert.deepEqual(plain(installation.snapshot()), { installed: 9, unavailable: 0, changed: 0, stopped: false });
  sameShape(before.GeolocationCoordinates, shape(realm, 'GeolocationCoordinates'), new Set([...KEYS, 'toJSON']));
  sameShape(before.GeolocationPosition, shape(realm, 'GeolocationPosition'), new Set(['toJSON']));
  for (const name of ['Geolocation', 'GeolocationPositionError', 'Navigator']) sameShape(before[name], shape(realm, name));
  assert.equal(run(realm, 'native.navigatorReads + native.calls.length + native.reads + native.jsonCalls + native.optionReads'), 0, 'installation touches no native state');
});

test('a successful request reaches the page as the genuine native position with the selected coordinates', () => {
  const realm = createRealm(); installInto(realm, [geoEntry()]);
  const position = once(realm);
  const facts = plain(run(realm, `(position => ({
    genuine: position instanceof GeolocationPosition && position.coords instanceof GeolocationCoordinates &&
      Object.prototype.toString.call(position) === '[object GeolocationPosition]' && Object.prototype.toString.call(position.coords) === '[object GeolocationCoordinates]',
    sameObject: position.coords === position.coords,
    values: ${JSON.stringify(KEYS)}.map(key => position.coords[key]),
    timestamp: position.timestamp, nativeTimestamp: native.clock,
    enumerated: (() => { const keys = []; for (const key in position.coords) keys.push(key); return keys; })()
  }))`)(position));
  assert.equal(facts.genuine, true);
  assert.equal(facts.sameObject, true);
  assert.deepEqual(facts.values, SELECTED_VALUES);
  assert.equal(facts.timestamp, facts.nativeTimestamp, 'timestamp stays native');
  assert.deepEqual(facts.enumerated, [...KEYS, 'toJSON'], 'enumeration follows the native attribute order');
});

test('every attribute read calls the native getter exactly once with the original receiver', () => {
  const realm = createRealm(); const installation = installInto(realm, [geoEntry()]);
  const coords = run(realm, '(position => position.coords)')(once(realm));
  const outcome = plain(run(realm, `(coords => {
    const rows = [];
    for (const key of ${JSON.stringify(KEYS)}) { native.reads = 0; native.lastReceiver = null; const value = coords[key]; rows.push([key, value, native.reads, native.lastReceiver === coords]); }
    return rows;
  })`)(coords));
  assert.deepEqual(outcome.map(row => row[0]), KEYS);
  assert.deepEqual(outcome.map(row => row[1]), SELECTED_VALUES);
  assert.ok(outcome.every(row => row[2] === 1 && row[3] === true), 'one native read per attribute read, original receiver');
  assert.equal(installation.snapshot().changed, 7);
});

test('callbacks, options, receiver and extra arguments reach the native request exactly as the page passed them', () => {
  const realm = createRealm(); installInto(realm, [geoEntry()]);
  const outcome = plain(run(realm, `(() => {
    const reads = [], success = () => {}, failure = () => {}, extra = {};
    const options = { get enableHighAccuracy() { reads.push('e'); return true; }, get maximumAge() { reads.push('m'); return 5; }, get timeout() { reads.push('t'); return 6; } };
    const returned = navigator.geolocation.getCurrentPosition(success, failure, options, extra);
    const call = native.calls[0];
    const first = { returned: returned ?? null, method: call.method, receiver: call.receiver === navigator.geolocation, length: call.length,
      args: call.args[0] === success && call.args[1] === failure && call.args[2] === options && call.args[3] === extra, reads: reads.join('') };
    reads.length = 0;
    const id = navigator.geolocation.watchPosition(success, failure, options);
    const watch = native.calls[1];
    return { first, second: { id, method: watch.method, args: watch.args[0] === success && watch.args[1] === failure && watch.args[2] === options, reads: reads.join('') } };
  })()`));
  assert.deepEqual(outcome.first, { returned: null, method: 'getCurrentPosition', receiver: true, length: 4, args: true, reads: 'emt' });
  assert.deepEqual(outcome.second, { id: 1, method: 'watchPosition', args: true, reads: 'emt' });
});

test('invalid arguments behave exactly like the native request: same errors, same messages, nothing wrapped', () => {
  const installed = createRealm(), control = createRealm();
  installInto(installed, [geoEntry()]);
  const calls = ['()', '(undefined)', '(null)', '("callback")', '({})', '(42)', '(true)', '(Symbol("s"))', '(() => {}, "failure")', '(() => {}, 7)', '(() => {}, null, 5)',
    '(() => {}, undefined, null)', '(() => {}, () => {}, {})', '(() => {}, () => {}, "options")', '(() => {}, () => {}, { get timeout() { throw new RangeError("options getter"); } })'];
  for (const method of ['getCurrentPosition', 'watchPosition']) for (const args of calls) {
    const source = `navigator.geolocation.${method}${args}`;
    assert.equal(probe(installed, source), probe(control, source), source);
  }
  assert.equal(run(installed, 'native.calls.length'), run(control, 'native.calls.length'), 'the native method ran the same number of times');
  // Foreign receivers: the native brand error, with the callback never touched.
  for (const receiver of ['{}', 'null', 'undefined', '7', 'navigator', 'Object.create(Geolocation.prototype)', 'new Proxy(navigator.geolocation, {})']) {
    const source = `Reflect.apply(Geolocation.prototype.getCurrentPosition, ${receiver}, [() => {}])`;
    assert.equal(probe(installed, source), probe(control, source), source);
  }
});

test('page callbacks run with an undefined this and their exceptions are reported by the browser, not swallowed or rewrapped', () => {
  const realm = createRealm(); installInto(realm, [geoEntry()]);
  const outcome = plain(run(realm, `(() => {
    const failure = new Error('page callback failure');
    let seenThis = 'unset', seenLength = -1;
    navigator.geolocation.getCurrentPosition(function (position) { 'use strict'; seenThis = this; seenLength = arguments.length; throw failure; });
    native.deliver();
    return { seenThis: seenThis === undefined ? 'undefined' : 'defined', seenLength, reported: native.reported.length === 1 && native.reported[0] === failure };
  })()`));
  assert.deepEqual(outcome, { seenThis: 'undefined', seenLength: 1, reported: true });
});

test('watchPosition keeps returning the native id and every update shows the selected position', () => {
  const realm = createRealm(); installInto(realm, [geoEntry()]);
  const outcome = plain(run(realm, `(() => {
    const seen = [];
    const id = navigator.geolocation.watchPosition(position => seen.push([position.coords.latitude, position.coords.longitude, position.coords.accuracy, position]));
    const second = navigator.geolocation.watchPosition(() => {});
    native.update({ latitude: 10, longitude: 20, accuracy: 7 });
    native.update({ latitude: -30, longitude: 40, accuracy: 9 });
    navigator.geolocation.clearWatch(id);
    native.update({ latitude: 1, longitude: 2, accuracy: 3 });
    return { id, second, seen: seen.map(row => row.slice(0, 3)), distinct: seen[0][3] !== seen[1][3], watchers: native.watchers.size, cleared: native.calls.filter(call => call.method === 'clearWatch').length };
  })()`));
  assert.equal(outcome.id, 1); assert.equal(outcome.second, 2);
  assert.deepEqual(outcome.seen, [[SELECTED.latitude, SELECTED.longitude, SELECTED.accuracy], [SELECTED.latitude, SELECTED.longitude, SELECTED.accuracy]]);
  assert.equal(outcome.distinct, true, 'each update is a new native position object');
  assert.equal(outcome.watchers, 1); assert.equal(outcome.cleared, 1);
});

test('denial, timeout and unavailable errors are delivered untouched and never create or read a position', () => {
  const installed = createRealm(), control = createRealm();
  const installation = installInto(installed, [geoEntry()]);
  const scenario = `(() => {
    const rows = [];
    const ask = (permission, code) => {
      native.permission = permission;
      let success = 0, error = null;
      navigator.geolocation.getCurrentPosition(() => { success++; }, e => { error = e; });
      if (code) native.fail(code); else native.deliver();
      rows.push([permission, code, success, error && [error instanceof GeolocationPositionError, error.code, error.message, error.code === GeolocationPositionError.PERMISSION_DENIED]]);
    };
    ask('denied', 0); ask('granted', 2); ask('granted', 3);
    return JSON.stringify(rows);
  })()`;
  const withCustom = run(installed, scenario), native = run(control, scenario);
  assert.equal(withCustom, native, 'the error path is identical with and without Custom');
  assert.equal(JSON.parse(withCustom).filter(row => row[2] > 0).length, 0, 'no success callback on any failure');
  assert.equal(run(installed, 'native.reads + native.jsonCalls'), 0, 'no coordinate was ever read');
  assert.equal(installation.snapshot().changed, 0);
});

test('foreign receivers keep the native brand errors and never expose or substitute a value', () => {
  const installed = createRealm(), control = createRealm();
  const installation = installInto(installed, [geoEntry()]);
  const receivers = ['{}', 'Object.create(GeolocationCoordinates.prototype)', 'Object.create(GeolocationPosition.prototype)', 'new Proxy(realCoords, {})', 'new Proxy(realPosition, {})', '5', '"text"', 'null', 'undefined', 'realPosition', 'navigator.geolocation', 'GeolocationCoordinates.prototype'];
  const prelude = 'const realPosition = native.engine(), realCoords = realPosition.coords; native.reads = 0; native.jsonCalls = 0;';
  for (const key of KEYS) for (const receiver of receivers) {
    const source = `(() => { ${prelude} return Reflect.apply(Object.getOwnPropertyDescriptor(GeolocationCoordinates.prototype, ${JSON.stringify(key)}).get, ${receiver}, []); })()`;
    assert.equal(probe(installed, source), probe(control, source), key + ' on ' + receiver);
  }
  // A genuine position is a valid toJSON receiver, so it is excluded there (it is covered by the genuine-path tests).
  const coordsJson = receivers, positionJson = [...receivers.filter(item => item !== 'realPosition'), 'realCoords'];
  for (const [owner, receiversOf] of [['GeolocationCoordinates', coordsJson], ['GeolocationPosition', positionJson]]) for (const receiver of receiversOf) {
    const source = `(() => { ${prelude} return Reflect.apply(${owner}.prototype.toJSON, ${receiver}, []); })()`;
    assert.equal(probe(installed, source), probe(control, source), owner + '.toJSON on ' + receiver);
  }
  assert.equal(installation.snapshot().changed, 0, 'no substitution happened for a foreign receiver');
  assert.equal(JSON.parse(probe(installed, 'Reflect.apply(Object.getOwnPropertyDescriptor(GeolocationCoordinates.prototype, "latitude").get, {}, [])')).name, 'TypeError');
});

test('every genuine coordinates object reports the selected position, whichever native path produced it', () => {
  const realm = createRealm(); installInto(realm, [geoEntry()]);
  // A position that never went through a page callback (another realm, a retained native handle, an engine-side path).
  const facts = plain(run(realm, `(() => {
    const position = native.engine({ latitude: -77.1, longitude: 12.5, accuracy: 3 });
    return { coords: ${JSON.stringify(KEYS)}.map(key => position.coords[key]), json: JSON.stringify(position.coords), position: JSON.stringify(position) };
  })()`));
  assert.deepEqual(facts.coords, SELECTED_VALUES);
  assert.deepEqual(JSON.parse(facts.json), SELECTED_RECORD);
  assert.deepEqual(JSON.parse(facts.position).coords, SELECTED_RECORD);
});

test('toJSON on coordinates and positions keeps the native record shape, key order and freshness with selected numbers', () => {
  const realm = createRealm(), control = createRealm();
  installInto(realm, [geoEntry()]);
  const read = context => plain(run(context, `(() => {
    const position = native.engine(), coords = position.coords;
    native.jsonCalls = 0;
    const first = coords.toJSON(1, 2, 3), again = coords.toJSON(), fromPosition = position.toJSON();
    return { first, jsonCalls: native.jsonCalls, fresh: first !== again, coordKeys: Object.keys(first), positionKeys: Object.keys(fromPosition), innerKeys: Object.keys(fromPosition.coords),
      timestamp: fromPosition.timestamp === position.timestamp, prototype: Object.getPrototypeOf(first) === Object.prototype && Object.getPrototypeOf(fromPosition) === Object.prototype && Object.getPrototypeOf(fromPosition.coords) === Object.prototype,
      stringified: JSON.stringify(position), fromPosition };
  })()`));
  const selected = read(realm), native = read(control);
  assert.deepEqual(selected.first, SELECTED_RECORD);
  assert.deepEqual(selected.fromPosition.coords, SELECTED_RECORD);
  assert.deepEqual(native.first, REAL_RECORD, 'control: the browser really reports the other position');
  assert.equal(selected.jsonCalls, 3, 'one native toJSON per call');
  assert.equal(selected.fresh, true); assert.equal(selected.timestamp, true); assert.equal(selected.prototype, true);
  for (const key of ['coordKeys', 'positionKeys', 'innerKeys']) assert.deepEqual(selected[key], native[key], key + ' keep the native order');
  assert.deepEqual(Object.keys(JSON.parse(selected.stringified)), ['coords', 'timestamp']);
  assert.deepEqual(JSON.parse(selected.stringified).coords, SELECTED_RECORD);
});

test('a frozen JSON record from a replaced native toJSON is rebuilt from the selected numbers, never returned', () => {
  const setup = `(() => {
    const coordsJSON = GeolocationCoordinates.prototype.toJSON, positionJSON = GeolocationPosition.prototype.toJSON;
    GeolocationCoordinates.prototype.toJSON = function toJSON() { return Object.freeze(coordsJSON.call(this)); };
    GeolocationPosition.prototype.toJSON = function toJSON() { const record = positionJSON.call(this); Object.freeze(record.coords); return Object.freeze(record); };
  })();`;
  const realm = createRealm({ setup }); const installation = installInto(realm, [geoEntry()]);
  assert.equal(installation.snapshot().installed, 9);
  const facts = plain(run(realm, `(() => {
    const position = native.engine();
    const coords = position.coords.toJSON(), whole = position.toJSON();
    return { coords, whole, text: JSON.stringify(position), frozen: Object.isFrozen(coords) || Object.isFrozen(whole) };
  })()`));
  assert.deepEqual(facts.coords, SELECTED_RECORD);
  assert.deepEqual(facts.whole.coords, SELECTED_RECORD);
  assert.deepEqual(Object.keys(facts.whole), ['coords', 'timestamp']);
  assert.equal(facts.frozen, false);
  assert.ok(!facts.text.includes(String(REAL_POSITION.latitude)) && !facts.text.includes(String(REAL_POSITION.accuracy)), 'the real numbers never appear');
});

test('descriptor shapes: flags, order, accessor form, lengths and (ADR-112) names are those of the native accessors', () => {
  const realm = createRealm(), before = shapes(realm);
  installInto(realm, [geoEntry()]);
  const after = shapes(realm);
  assert.deepEqual(after.GeolocationCoordinates.map(row => String(row.key)), before.GeolocationCoordinates.map(row => String(row.key)), 'own key order');
  for (const key of KEYS) {
    const row = after.GeolocationCoordinates.find(item => item.key === key);
    assert.equal(row.enumerable, true); assert.equal(row.configurable, true); assert.equal(row.set, undefined);
    assert.equal(run(realm, `Object.getOwnPropertyDescriptor(GeolocationCoordinates.prototype, ${JSON.stringify(key)}).get.length`), 0);
    assert.equal(run(realm, `Object.getOwnPropertyDescriptor(GeolocationCoordinates.prototype, ${JSON.stringify(key)}).get.name`), 'get ' + key, 'the wrapper reports the name of the native accessor (a copied descriptor, not a masked toString)');
  }
  for (const owner of ['GeolocationCoordinates', 'GeolocationPosition']) {
    const old = before[owner].find(item => item.key === 'toJSON'), row = after[owner].find(item => item.key === 'toJSON');
    assert.equal(row.writable, old.writable); assert.equal(row.enumerable, old.enumerable); assert.equal(row.configurable, old.configurable);
    assert.equal(run(realm, `${owner}.prototype.toJSON.length`), 0); assert.equal(run(realm, `${owner}.prototype.toJSON.name`), 'toJSON');
  }
  // No masking: Function.prototype.toString is the engine's own and shows the wrapper source (detectability is a documented limit); only name and length are copied.
  assert.equal(run(realm, `Function.prototype.toString.call(Function.prototype.toString).includes('[native code]')`), true);
  assert.equal(run(realm, `Function.prototype.toString.call(Object.getOwnPropertyDescriptor(GeolocationCoordinates.prototype, 'latitude').get).includes('customGeolocationCoordinate')`), true);
});

test('re-installing into the same realm is a no-op: no second layer, same function identities', () => {
  const realm = createRealm(); const first = installInto(realm, [geoEntry()]);
  const after = shapes(realm);
  const second = installInto(realm, [geoEntry({ latitude: 1, longitude: 2, accuracy: 3 })]);
  assert.equal(first.snapshot().installed, 9);
  assert.deepEqual(plain(second.snapshot()), { installed: 0, unavailable: 0, changed: 0, stopped: false });
  for (const name of INTERFACES) sameShape(after[name], shape(realm, name));
  assert.deepEqual(plain(run(realm, '(p => [p.coords.latitude, p.coords.longitude, p.coords.accuracy])')(once(realm))), [SELECTED.latitude, SELECTED.longitude, SELECTED.accuracy], 'the first selection stays');
});

test('Allow and Bypass never read the dormant profile; ON is reported unsupported; unrelated and duplicate rows are safe', () => {
  for (const mode of ['off', 'bypass']) {
    const realm = createRealm(), before = shapes(realm); let reads = 0;
    const entry = { id: 'geolocation', mode, get value() { reads++; throw new Error('dormant value read'); } };
    const installation = installInto(realm, [entry]);
    assert.equal(reads, 0, mode + ' never reads the value');
    assert.deepEqual(plain(installation.snapshot()), { installed: 0, unavailable: 0, changed: 0, stopped: false });
    assertUntouched(realm, before);
  }
  const blocked = createRealm(), blockedBefore = shapes(blocked);
  assert.deepEqual(plain(installInto(blocked, [geoEntry(SELECTED, 'on')]).snapshot()), { installed: 0, unavailable: 1, changed: 0, stopped: false });
  assertUntouched(blocked, blockedBefore);
  const other = createRealm(), otherBefore = shapes(other);
  assert.equal(installInto(other, [{ id: 'hardware-concurrency', mode: 'custom', value: 8 }, { id: 'canvas-readback', mode: 'custom', value: { algorithm: 'sparse-rgb-v1' } }]).snapshot().installed, 0);
  assertUntouched(other, otherBefore);
  const twice = createRealm(), twiceBefore = shapes(twice);
  assert.deepEqual(plain(installInto(twice, [geoEntry(), geoEntry({ latitude: 1, longitude: 2, accuracy: 3 })]).snapshot()), { installed: 0, unavailable: 1, changed: 0, stopped: false });
  assertUntouched(twice, twiceBefore);
  for (const entries of [null, undefined, {}, 'geolocation', 5, [null], [undefined], [5], [{}]]) {
    const realm = createRealm(), snapshotBefore = shapes(realm);
    assert.equal(installInto(realm, entries).snapshot().installed, 0);
    assertUntouched(realm, snapshotBefore);
  }
});

test('fail closed: every value outside the contract domain leaves the native results untouched', () => {
  const good = { latitude: 10, longitude: 20, accuracy: 30 };
  const bad = [
    { ...good, latitude: NaN }, { ...good, latitude: Infinity }, { ...good, latitude: -Infinity }, { ...good, latitude: 90.0001 }, { ...good, latitude: -91 }, { ...good, latitude: '10' }, { ...good, latitude: null }, { ...good, latitude: undefined },
    { ...good, longitude: NaN }, { ...good, longitude: 180.5 }, { ...good, longitude: -181 }, { ...good, longitude: Infinity }, { ...good, longitude: [20] }, { ...good, longitude: {} },
    { ...good, accuracy: 0 }, { ...good, accuracy: 0.99 }, { ...good, accuracy: 100001 }, { ...good, accuracy: NaN }, { ...good, accuracy: Infinity }, { ...good, accuracy: -5 }, { ...good, accuracy: true }, { ...good, accuracy: 10n },
    { latitude: 10, longitude: 20 }, { latitude: 10, accuracy: 30 }, { longitude: 20, accuracy: 30 }, {}, null, undefined, 'Paris', 5, [10, 20, 30],
    { get latitude() { throw new Error('accessor value read'); }, longitude: 20, accuracy: 30 }
  ];
  for (const value of bad) {
    const realm = createRealm(), before = shapes(realm);
    const installation = installInto(realm, [{ id: 'geolocation', mode: 'custom', value }]);
    assert.deepEqual(plain(installation.snapshot()), { installed: 0, unavailable: 1, changed: 0, stopped: false }, inspect(value));
    assertUntouched(realm, before);
    assert.deepEqual(plain(run(realm, '(p => [p.coords.latitude, p.coords.accuracy])')(once(realm))), [REAL_POSITION.latitude, REAL_POSITION.accuracy], 'native values stay visible');
  }
  // The documented boundaries are accepted, including negative zero.
  for (const value of [{ latitude: 90, longitude: 180, accuracy: 100000 }, { latitude: -90, longitude: -180, accuracy: 1 }, { latitude: -0, longitude: 0, accuracy: 1.5 }, { latitude: 0.0000001, longitude: -0.0000001, accuracy: 99999.9999 }]) {
    const realm = createRealm(); assert.equal(installInto(realm, [{ id: 'geolocation', mode: 'custom', value }]).snapshot().installed, 9);
    const read = run(realm, '(p => [p.coords.latitude, p.coords.longitude, p.coords.accuracy])')(once(realm));
    assert.ok(Object.is(read[0], value.latitude) && Object.is(read[1], value.longitude) && Object.is(read[2], value.accuracy), inspect(value));
  }
});

test('atomic install: one missing or non-configurable surface leaves the whole native interface untouched', () => {
  const scenarios = {
    'no GeolocationCoordinates': 'delete globalThis.GeolocationCoordinates;',
    'no GeolocationPosition': 'delete globalThis.GeolocationPosition;',
    'accessor-valued interface': 'Object.defineProperty(globalThis, "GeolocationCoordinates", { get() { return undefined; }, configurable: true });',
    'missing latitude': 'delete GeolocationCoordinates.prototype.latitude;',
    'missing longitude': 'delete GeolocationCoordinates.prototype.longitude;',
    'missing accuracy': 'delete GeolocationCoordinates.prototype.accuracy;',
    'non-configurable latitude': 'Object.defineProperty(GeolocationCoordinates.prototype, "latitude", { configurable: false });',
    'non-configurable optional speed': 'Object.defineProperty(GeolocationCoordinates.prototype, "speed", { configurable: false });',
    'data property instead of accessor': 'Object.defineProperty(GeolocationCoordinates.prototype, "heading", { value: 3, configurable: true });',
    'non-configurable coordinates toJSON': 'Object.defineProperty(GeolocationCoordinates.prototype, "toJSON", { configurable: false });',
    'non-configurable position toJSON': 'Object.defineProperty(GeolocationPosition.prototype, "toJSON", { configurable: false });',
    'toJSON that is not a function': 'Object.defineProperty(GeolocationPosition.prototype, "toJSON", { value: null, configurable: true });'
  };
  for (const [label, mutation] of Object.entries(scenarios)) {
    const realm = createRealm({ setup: mutation }), before = shapes(realm);
    const installation = installInto(realm, [geoEntry()]);
    assert.deepEqual(plain(installation.snapshot()), { installed: 0, unavailable: 1, changed: 0, stopped: false }, label);
    assertUntouched(realm, before);
  }
  // An engine without the optional attributes or toJSON still gets every surface it has.
  const lean = createRealm({ setup: 'delete GeolocationCoordinates.prototype.toJSON; delete GeolocationPosition.prototype.toJSON; delete GeolocationCoordinates.prototype.altitudeAccuracy;' });
  assert.equal(installInto(lean, [geoEntry()]).snapshot().installed, 6);
  assert.deepEqual(plain(run(lean, '(p => [p.coords.latitude, p.coords.altitude, p.coords.heading])')(once(lean))), [SELECTED.latitude, null, null]);
});

test('a define failure part-way through rolls every earlier replacement back', () => {
  const setup = `(() => {
    let defines = 0;
    const target = GeolocationCoordinates.prototype;
    const proxy = new Proxy(target, { defineProperty(object, key, descriptor) { if (++defines === 4) throw new Error('define failed'); return Reflect.defineProperty(object, key, descriptor); } });
    globalThis.GeolocationCoordinates = { prototype: proxy };
    globalThis.realCoordinatesPrototype = target;
  })();`;
  const realm = createRealm({ setup });
  const before = run(realm, `Reflect.ownKeys(realCoordinatesPrototype).map(key => ({ key, ...Object.getOwnPropertyDescriptor(realCoordinatesPrototype, key) }))`);
  const installation = installInto(realm, [geoEntry()]);
  assert.deepEqual(plain(installation.snapshot()), { installed: 0, unavailable: 1, changed: 0, stopped: false });
  sameShape(before, run(realm, `Reflect.ownKeys(realCoordinatesPrototype).map(key => ({ key, ...Object.getOwnPropertyDescriptor(realCoordinatesPrototype, key) }))`));
  assert.deepEqual(plain(run(realm, '(p => [p.coords.latitude, p.coords.accuracy])')(once(realm))), [REAL_POSITION.latitude, REAL_POSITION.accuracy]);
});

test('stop restores only descriptors it still owns; retained wrappers delegate to the native getter afterwards', () => {
  const realm = createRealm(), before = shapes(realm);
  const installation = installInto(realm, [geoEntry()]);
  const retained = run(realm, '({ getter: Object.getOwnPropertyDescriptor(GeolocationCoordinates.prototype, "latitude").get, json: GeolocationCoordinates.prototype.toJSON })');
  const position = once(realm);
  run(realm, `Object.defineProperty(GeolocationCoordinates.prototype, 'accuracy', { get() { return 'page getter'; }, configurable: true, enumerable: true });`);
  installation.stop();
  assert.equal(installation.snapshot().stopped, true);
  const after = shapes(realm);
  const replaced = after.GeolocationCoordinates.find(row => row.key === 'accuracy');
  assert.equal(typeof replaced.get, 'function');
  assert.equal(run(realm, '(p => p.coords.accuracy)')(position), 'page getter', 'a descriptor the page replaced is not overwritten');
  for (const key of KEYS.filter(key => key !== 'accuracy')) {
    const old = before.GeolocationCoordinates.find(row => row.key === key), row = after.GeolocationCoordinates.find(item => item.key === key);
    assert.equal(row.get, old.get, key + ' restored');
  }
  assert.equal(after.GeolocationCoordinates.find(row => row.key === 'toJSON').value, before.GeolocationCoordinates.find(row => row.key === 'toJSON').value);
  sameShape(before.GeolocationPosition, after.GeolocationPosition);
  assert.equal(run(realm, '(retained, coords) => retained.getter.call(coords)')(retained, run(realm, '(p) => p.coords')(position)), REAL_POSITION.latitude, 'a retained wrapper returns the native value after stop');
  assert.deepEqual(plain(run(realm, '(retained, coords) => retained.json.call(coords)')(retained, run(realm, '(p) => p.coords')(position))), REAL_RECORD);
  installation.stop();
  assert.equal(installation.snapshot().stopped, true);
});

// The vm global is an interceptor object: descriptor reads on it with a polluted Object.prototype crash the process, so both
// pollution scenarios keep every operation on ordinary objects and finish inside one script.
test('page tampering after installation cannot reach the installed behaviour or its cleanup', () => {
  const realm = createRealm(), installation = installInto(realm, [geoEntry()]);
  const position = once(realm);
  const facts = JSON.parse(run(realm, `(position => {
    const boom = () => { throw new Error('PAGE_CODE'); }, define = Object.defineProperty;
    for (const [owner, key] of [[Reflect, 'apply'], [Reflect, 'ownKeys'], [Object, 'defineProperty'], [Object, 'getOwnPropertyDescriptor'], [Object, 'freeze'], [Object, 'create'], [Array, 'isArray'], [Number, 'isFinite'],
      [WeakSet.prototype, 'has'], [WeakSet.prototype, 'add'], [Function.prototype, 'apply'], [Function.prototype, 'bind']]) define(owner, key, { __proto__: null, value: boom, configurable: true, writable: true });
    for (const key of ['get', 'set', 'value', 'writable', 'enumerable', 'configurable']) define(Object.prototype, key, { __proto__: null, get: boom, set: boom, configurable: true });
    return JSON.stringify({ values: ${JSON.stringify(KEYS)}.map(key => position.coords[key]), json: position.coords.toJSON(), whole: position.toJSON() });
  })`)(position));
  assert.deepEqual(facts.values, SELECTED_VALUES);
  assert.deepEqual(facts.json, SELECTED_RECORD);
  assert.deepEqual(facts.whole.coords, SELECTED_RECORD);
  installation.stop();
  assert.equal(installation.snapshot().stopped, true);
});

test('installation tolerates a polluted Object.prototype and invokes no page-observable code or native getter', () => {
  const realm = createRealm();
  realm.__entries = [geoEntry()];
  const outcome = JSON.parse(run(realm, `(() => {
    const installer = (${installGeolocationCustom.toString()}), entries = __entries, target = { GeolocationCoordinates, GeolocationPosition };
    let pageCalls = 0;
    const trap = () => { pageCalls++; throw new Error('PAGE_CODE'); };
    for (const key of ['get', 'set', 'value', 'writable', 'enumerable', 'configurable']) Object.defineProperty(Object.prototype, key, { __proto__: null, get: trap, set: trap, configurable: true });
    for (const index of [0, 1, 2]) Object.defineProperty(Array.prototype, index, { __proto__: null, get: trap, set: trap, configurable: true });
    const installation = installer(target, entries);
    return JSON.stringify({ snapshot: installation.snapshot(), pageCalls, touched: native.navigatorReads + native.calls.length + native.reads + native.jsonCalls });
  })()`));
  assert.deepEqual(outcome.snapshot, { installed: 9, unavailable: 0, changed: 0, stopped: false });
  assert.equal(outcome.pageCalls, 0, 'no inherited accessor ran during installation');
  assert.equal(outcome.touched, 0, 'no navigator.geolocation read, request or native getter');
});

test('installation adds nothing page-visible: no globals, markers, handles or extra prototype properties', () => {
  const realm = createRealm();
  const keys = () => run(realm, `JSON.stringify([Reflect.ownKeys(globalThis).map(String), ${INTERFACES.map(name => `Reflect.ownKeys(${name}.prototype).map(String)`).join(', ')}, ${INTERFACES.map(name => `Reflect.ownKeys(${name}).map(String)`).join(', ')}])`);
  const before = keys();
  installInto(realm, [geoEntry()]);
  const after = JSON.parse(keys()), previous = JSON.parse(before);
  // Only the harness's own installer binding is new on the realm.
  assert.deepEqual(after[0].filter(key => !previous[0].includes(key)), ['geolocationInstaller', '__entries']);
  assert.deepEqual(after.slice(1), previous.slice(1));
});

test('two independent installations (separate documents) mask each other\'s coordinates; an uncovered realm stays native (limit)', () => {
  const brands = new WeakMap();
  const first = createRealm({ brands }), second = createRealm({ brands }), uncovered = createRealm({ brands });
  installInto(first, [geoEntry()]);
  installInto(second, [geoEntry({ latitude: 35.6762, longitude: 139.6503, accuracy: 25 })]);
  const position = once(first);
  // A same-origin parent borrowing the other document's getters sees that document's selected position, never the native one.
  const borrowed = plain(run(second, `(position => {
    const getter = key => Object.getOwnPropertyDescriptor(GeolocationCoordinates.prototype, key).get;
    return { latitude: getter('latitude').call(position.coords), accuracy: getter('accuracy').call(position.coords), json: GeolocationCoordinates.prototype.toJSON.call(position.coords), whole: GeolocationPosition.prototype.toJSON.call(position).coords };
  })`)(position));
  assert.equal(borrowed.latitude, 35.6762); assert.equal(borrowed.accuracy, 25);
  assert.equal(borrowed.json.latitude, 35.6762); assert.equal(borrowed.whole.longitude, 139.6503);
  // Documented limit: a realm without an installation exposes the native value for a borrowed read.
  const leaked = run(uncovered, `(position => Object.getOwnPropertyDescriptor(GeolocationCoordinates.prototype, 'latitude').get.call(position.coords))`)(position);
  assert.equal(leaked, REAL_POSITION.latitude, 'a getter that was never replaced reads the native number');
});

test('hot path and bounds: saturating counters, a bounded handle count and a small self-contained source', () => {
  const realm = createRealm(); const installation = installInto(realm, [geoEntry()]);
  const coords = run(realm, '(p => p.coords)')(once(realm));
  const started = process.hrtime.bigint();
  run(realm, '(c => { for (let i = 0; i < 70000; i++) c.latitude; })')(coords);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.equal(installation.snapshot().changed, 65535, 'the change counter saturates');
  assert.ok(elapsedMs < 2000, 'seventy thousand reads took ' + elapsedMs + ' ms');
  assert.equal(installation.snapshot().installed, 9);
  const text = installGeolocationCustom.toString();
  assert.ok(text.length < 12000, 'installer source is ' + text.length + ' bytes');
  assert.ok(!/\bimport\b|\brequire\b|globalThis|\bwindow\b|\bdocument\b/.test(text.replace(/\/\/.*$/gm, '')), 'self-contained: no module or global references');
});

test('the same installer also works unserialized in the host realm with plain objects (no hidden realm dependency)', () => {
  const makeInterface = (keys, calls) => {
    const prototype = {};
    for (const key of keys) Object.defineProperty(prototype, key, { get() { calls.push(key); return 'native-' + key; }, configurable: true, enumerable: true });
    return prototype;
  };
  const calls = [];
  const coordinates = makeInterface(KEYS, calls), position = makeInterface([], calls);
  Object.defineProperty(coordinates, 'toJSON', { value() { return { latitude: 'native' }; }, configurable: true, writable: true, enumerable: true });
  const host = { GeolocationCoordinates: { prototype: coordinates }, GeolocationPosition: { prototype: position } };
  const installation = installGeolocationCustom(host, [geoEntry()]);
  assert.equal(installation.snapshot().installed, 8);
  assert.equal(host.GeolocationCoordinates.prototype.latitude, SELECTED.latitude);
  assert.equal(host.GeolocationCoordinates.prototype.altitude, null);
  assert.equal(calls.length, 2, 'the native getter ran once per read');
  assert.deepEqual(host.GeolocationCoordinates.prototype.toJSON(), { latitude: SELECTED.latitude });
  installation.stop();
  assert.equal(host.GeolocationCoordinates.prototype.latitude, 'native-latitude');
});
