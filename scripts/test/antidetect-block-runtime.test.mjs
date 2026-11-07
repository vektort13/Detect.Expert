import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { installAntidetectBlocks } from '../../apps/production-extension/antidetect-block-runtime.js';
import { installProtection } from '../../apps/production-extension/protection-runtime.js';

const rows = (...ids) => ids.map(id => ({ id, mode: 'on' }));
const denial = operation => assert.throws(operation, error => error instanceof DOMException && error.name === 'SecurityError');
function fixture() {
  const calls = [];
  function RTCPeerConnection() { calls.push(['rtc', this, ...arguments]); }
  function WebSocket() { calls.push(['ws', this, ...arguments]); }
  function WebSocketStream() { calls.push(['stream', this, ...arguments]); }
  function WebTransport() { calls.push(['transport', this, ...arguments]); }
  const realm = { DOMException, RTCPeerConnection, webkitRTCPeerConnection: RTCPeerConnection,
    mozRTCPeerConnection: RTCPeerConnection, WebSocket, WebSocketStream, WebTransport };
  return { calls, realm, constructors: { RTCPeerConnection, WebSocket, WebSocketStream, WebTransport } };
}

test('only explicit ON entries deny the selected transport and preserve unrelated APIs', () => {
  for (const id of ['webrtc', 'websocket', 'webtransport']) {
    const { realm, constructors, calls } = fixture(), before = Object.getOwnPropertyDescriptors(realm);
    const installation = installAntidetectBlocks(realm, rows(id));
    const selected = id === 'webrtc' ? ['RTCPeerConnection', 'webkitRTCPeerConnection', 'mozRTCPeerConnection'] : id === 'websocket' ? ['WebSocket', 'WebSocketStream'] : ['WebTransport'];
    for (const name of selected) assert.equal(realm[name], undefined, name);
    for (const [name, constructor] of Object.entries(constructors)) if (!selected.includes(name)) {
      assert.deepEqual(Object.getOwnPropertyDescriptor(realm, name), before[name]);
      assert.equal(constructor.prototype.constructor, constructor);
      new realm[name]('owned-argument');
    }
    assert.equal(calls.length, Object.keys(constructors).filter(name => !selected.includes(name)).length);
    const snapshot = installation.snapshot();
    assert.equal(snapshot.features.length, 1); assert.equal(snapshot.features[0].id, id);
    assert.equal(snapshot.removed, selected.length); assert.equal(snapshot.unavailable, 0);
    assert.deepEqual(Object.keys(installation), ['snapshot']);
  }
});

test('saved prototypes and existing instances expose only denying constructors, including prefixed aliases', () => {
  const { realm, constructors, calls } = fixture();
  const prototypes = Object.values(constructors).map(value => value.prototype), instance = new constructors.RTCPeerConnection();
  const installation = installAntidetectBlocks(realm, rows('webrtc', 'websocket', 'webtransport'));
  const argumentsWithCode = new Proxy({}, { get() { throw Error('caller argument must not be read'); } });
  for (const prototype of prototypes) {
    denial(() => new prototype.constructor(argumentsWithCode));
    denial(() => prototype.constructor.call(instance, argumentsWithCode));
    denial(() => Reflect.construct(prototype.constructor, [argumentsWithCode]));
  }
  denial(() => new instance.constructor());
  assert.equal(calls.length, 1, 'only the pre-installation native constructor ran');
  assert.equal(installation.snapshot().blocked, prototypes.length * 3 + 1);
});

test('legacy denial capture and public stop cannot restore a native creator', () => {
  for (const id of ['webrtc', 'websocket', 'webtransport']) {
    const { realm, constructors, calls } = fixture();
    installAntidetectBlocks(realm, rows(id));
    const legacy = installProtection(realm, id); legacy.stop();
    const selected = id === 'webrtc' ? ['RTCPeerConnection', 'webkitRTCPeerConnection', 'mozRTCPeerConnection'] : id === 'websocket' ? ['WebSocket', 'WebSocketStream'] : ['WebTransport'];
    for (const name of selected) assert.equal(realm[name], undefined, name);
    for (const [name, constructor] of Object.entries(constructors)) if (selected.includes(name)) denial(() => new constructor.prototype.constructor());
    assert.equal(calls.length, 0);
  }
});

test('BYPASS, OFF, Custom, unknown IDs and accessor entries never install a denial', () => {
  const { realm, constructors } = fixture(), before = Object.getOwnPropertyDescriptors(realm);
  let reads = 0;
  const entries = [{ id: 'webrtc', mode: 'custom' }, { id: 'websocket', mode: 'off' }, { id: 'webtransport', mode: 'bypass' }, { id: 'udp', mode: 'on' },
    { get id() { reads++; return 'webrtc'; }, mode: 'on' }, { id: 'webrtc', get mode() { reads++; return 'on'; } }];
  const snapshot = installAntidetectBlocks(realm, entries).snapshot();
  assert.equal(reads, 0); assert.deepEqual(Object.getOwnPropertyDescriptors(realm), before);
  for (const constructor of Object.values(constructors)) assert.equal(constructor.prototype.constructor, constructor);
  assert.deepEqual(snapshot, { installed: 0, removed: 0, unavailable: 0, blocked: 0, features: [] });
});

test('duplicate requests are bounded and multiple selected modes cannot downgrade an ON entry', () => {
  const { realm } = fixture();
  const installation = installAntidetectBlocks(realm, [...rows('webrtc', 'webrtc'), { id: 'webrtc', mode: 'off' }]);
  assert.equal(installation.snapshot().features.length, 1);
  assert.equal(installation.snapshot().removed, 3);
  assert.equal(realm.RTCPeerConnection, undefined);
  installAntidetectBlocks(realm, []);
  assert.equal(realm.RTCPeerConnection, undefined, 'there is no page-visible mode transition or restore path');
});

test('configurable constructor accessors are withheld without evaluating their getters', () => {
  let reads = 0;
  const realm = { DOMException };
  Object.defineProperty(realm, 'WebTransport', { get() { reads++; throw Error('native creator getter'); }, configurable: true });
  const installation = installAntidetectBlocks(realm, rows('webtransport'));
  assert.equal(reads, 0); assert.equal(realm.WebTransport, undefined);
  assert.equal(installation.snapshot().removed, 1); assert.equal(installation.snapshot().unavailable, 0);
});

test('inherited global constructor and configurable prototype accessor cannot reveal a creator', () => {
  const { realm, constructors, calls } = fixture(), inherited = { WebTransport: constructors.WebTransport };
  delete realm.WebTransport; Object.setPrototypeOf(realm, inherited);
  let reads = 0;
  Object.defineProperty(constructors.WebTransport.prototype, 'constructor', { configurable: true, get() { reads++; return constructors.WebTransport; } });
  const installation = installAntidetectBlocks(realm, rows('webtransport'));
  assert.equal(realm.WebTransport, undefined); assert.equal(inherited.WebTransport, undefined);
  denial(() => new constructors.WebTransport.prototype.constructor());
  assert.equal(reads, 0); assert.equal(calls.length, 0); assert.equal(installation.snapshot().unavailable, 0);
});

test('unsupported immutable global or constructor reports partial coverage without invoking native code', () => {
  const { realm, constructors, calls } = fixture();
  Object.defineProperty(realm, 'WebTransport', { value: constructors.WebTransport, configurable: false, writable: false });
  Object.defineProperty(constructors.WebTransport.prototype, 'constructor', { value: constructors.WebTransport, configurable: false, writable: false });
  const installation = installAntidetectBlocks(realm, rows('webtransport'));
  assert.equal(realm.WebTransport, constructors.WebTransport);
  assert.equal(installation.snapshot().unavailable, 2); assert.equal(installation.snapshot().installed, 0);
  assert.equal(calls.length, 0);
  assert.equal(installAntidetectBlocks({ DOMException }, rows('webrtc')).snapshot().unavailable, 1);
});

test('non-configurable writable native slots are denied without changing their descriptor flags', () => {
  const { realm, constructors } = fixture();
  Object.defineProperty(realm, 'WebTransport', { value: constructors.WebTransport, configurable: false, writable: true, enumerable: false });
  Object.defineProperty(constructors.WebTransport.prototype, 'constructor', { value: constructors.WebTransport, configurable: false, writable: true, enumerable: false });
  const installation = installAntidetectBlocks(realm, rows('webtransport'));
  assert.deepEqual(Object.getOwnPropertyDescriptor(realm, 'WebTransport'), { value: undefined, writable: true, enumerable: false, configurable: false });
  denial(() => new constructors.WebTransport.prototype.constructor());
  assert.equal(installation.snapshot().unavailable, 0);
});

test('snapshot is detached and exposes no original, command, restore or configuration handles', () => {
  const { realm, constructors } = fixture(), installation = installAntidetectBlocks(realm, rows('webrtc'));
  const one = installation.snapshot(); one.features[0].id = 'changed'; one.features[0].installed = -1; one.installed = -1;
  const two = installation.snapshot();
  assert.equal(two.features[0].id, 'webrtc'); assert.ok(two.installed > 0);
  assert.deepEqual(Object.keys(two), ['installed', 'removed', 'unavailable', 'blocked', 'features']);
  assert.equal(JSON.stringify(two).includes('RTCPeerConnection'), false);
  denial(() => new constructors.RTCPeerConnection.prototype.constructor());
});

test('serialized function installs independently without module dependencies or page communication', () => {
  const calls = [], context = vm.createContext({ DOMException, notify: value => calls.push(value) });
  const result = vm.runInContext(`(() => {
    const install = (${installAntidetectBlocks.toString()});
    function WebSocket() { notify('native'); }
    const realm = { DOMException, WebSocket, fetch() { return 'http-ok'; } };
    const prototype = WebSocket.prototype;
    const installation = install(realm, [{ id: 'websocket', mode: 'on' }]);
    let denied = false; try { new prototype.constructor('ws://owned.invalid'); } catch (error) { denied = error.name === 'SecurityError'; }
    return { hidden: realm.WebSocket === undefined, denied, http: realm.fetch(), methods: Object.keys(installation) };
  })()`, context);
  assert.equal(result.hidden, true); assert.equal(result.denied, true); assert.equal(result.http, 'http-ok');
  assert.deepEqual([...result.methods], ['snapshot']); assert.deepEqual(calls, []);
});

test('pre-installation saved native constructors cannot be revoked and are outside the early boundary', () => {
  const { realm, constructors, calls } = fixture();
  installAntidetectBlocks(realm, rows('webrtc'));
  new constructors.RTCPeerConnection();
  assert.equal(calls.length, 1, 'the installer promises a new-document boundary, not revocation of previously escaped references');
  denial(() => new constructors.RTCPeerConnection.prototype.constructor());
});

test('later inherited-realm installation ignores a page-poisoned array iterator', () => {
  const context = vm.createContext({ DOMException });
  const result = vm.runInContext(`(() => {
    const install = (${installAntidetectBlocks.toString()});
    function RTCPeerConnection() {}
    install({ DOMException, RTCPeerConnection }, []);
    Array.prototype[Symbol.iterator] = function () { throw Error('page iterator executed'); };
    function WebTransport() {}
    const realm = { DOMException, WebTransport }, prototype = WebTransport.prototype;
    install(realm, [{ id: 'webtransport', mode: 'on' }]);
    let denied = false; try { new prototype.constructor(); } catch (error) { denied = error.name === 'SecurityError'; }
    return { hidden: realm.WebTransport === undefined, denied };
  })()`, context);
  assert.equal(result.hidden, true); assert.equal(result.denied, true);
});
