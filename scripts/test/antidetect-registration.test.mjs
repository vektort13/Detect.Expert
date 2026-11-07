// ADR-064: production profile partitions invoke closed guards rather than legacy page-stop hooks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createApiConfiguration, updateApiConfiguration } from '../../packages/contracts/src/api-configuration.mjs';
import { buildApiCustomScripts, apiCustomSiteScriptId } from '../../apps/production-extension/api-custom-registration.js';
import { customEntries } from '../../apps/production-extension/api-configuration-controller.js';
import { PROTECTION_FEATURES } from '../../packages/contracts/src/protection-features.mjs';

const ids = ['webrtc', 'websocket', 'webtransport'];
const profile = () => ({ addresses: { ipv4: { host: '192.0.2.19', stun: '198.51.100.29', turn: '203.0.113.39' }, ipv6: { host: null, stun: null, turn: null } }, iceTransportPolicy: 'preserve', randomizeDevices: false, freshCertificates: false, deviceLifetime: 'session' });
function change(config, id, patch, host = null) {
  const result = updateApiConfiguration(config, id, patch, host); assert.equal(result.ok, true, result.error?.message); return result.value;
}
function base() { return { ...createApiConfiguration(), enabled: true, antidetectEnabled: true, preset: 'custom' }; }
function fixture() {
  const realm = vm.createContext({ DOMException, TextEncoder });
  vm.runInContext(`
    globalThis.Navigator = function Navigator() {};
    globalThis.navigator = new Navigator();
    Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { configurable: true, get() { return 32; } });
    globalThis.document = { querySelectorAll() { return []; } };
    globalThis.listeners = [];
    globalThis.addEventListener = function(type, listener) { listeners.push({type, listener}); };
    globalThis.postMessage = function(data) { for (const row of listeners) if (row.type === 'message') row.listener({source:globalThis, data}); };
    globalThis.nativeCalls = 0;
    globalThis.RTCPeerConnection = function RTCPeerConnection() { nativeCalls++; };
    globalThis.webkitRTCPeerConnection = RTCPeerConnection;
    globalThis.mozRTCPeerConnection = RTCPeerConnection;
    globalThis.WebSocket = function WebSocket() { nativeCalls++; };
    globalThis.WebSocketStream = function WebSocketStream() { nativeCalls++; };
    globalThis.WebTransport = function WebTransport() { nativeCalls++; };
    globalThis.RTCIceCandidate = class RTCIceCandidate {
      constructor(init) { this.raw = init.candidate; }
      get candidate() { return this.raw; }
      get type() { return this.raw.split(' ')[7]; }
      get address() { return this.raw.split(' ')[4]; }
      get relatedAddress() { return null; }
      toJSON() { return {candidate:this.raw,sdpMid:'0',sdpMLineIndex:0}; }
    };
    globalThis.RTCSessionDescription = class RTCSessionDescription {
      get sdp() { return 'v=0\\r\\n'; }
      toJSON() { return {type:'offer',sdp:this.sdp}; }
    };
  `, realm);
  return realm;
}
const run = (script, realm = fixture()) => { vm.runInContext(script.js[0].code, realm); return realm; };

test('all three historical feature IDs receive immutable MAIN document-start ON profiles without embedding dormant Custom values', () => {
  let config = base();
  config = change(config, 'webrtc', { mode: 'on', selected: { kind: 'value', value: profile() }, userValues: [{ id: 'unused', label: 'Unused private test profile', value: { kind: 'value', value: profile() } }] });
  for (const id of ['websocket', 'webtransport']) config = change(config, id, { mode: 'on' });
  assert.ok(ids.every(id => PROTECTION_FEATURES.includes(id)), 'the regression concerns IDs previously excluded from userScripts as legacy');
  const entries = customEntries(config, null); assert.deepEqual(entries.map(row => [row.id, row.mode, row.selected.kind]), ids.map(id => [id, 'on', 'unset']));
  const scripts = buildApiCustomScripts(config, ['http://*/*', 'https://*/*']); assert.equal(scripts.length, 1);
  assert.equal(scripts[0].world, 'MAIN'); assert.equal(scripts[0].runAt, 'document_start'); assert.equal(scripts[0].allFrames, true);
  assert.equal(scripts[0].js[0].code.includes('Unused private test profile'), false); assert.equal(scripts[0].js[0].code.includes('198.51.100.29'), false);
  const realm = run(scripts[0]);
  for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'mozRTCPeerConnection', 'WebSocket', 'WebSocketStream', 'WebTransport']) assert.equal(vm.runInContext('typeof ' + name, realm), 'undefined');
  vm.runInContext("postMessage({channel:'detect.expert/protection/v1',type:'protection-stop'})", realm);
  assert.equal(vm.runInContext('typeof RTCPeerConnection + typeof WebSocket + typeof WebTransport', realm), 'undefinedundefinedundefined');
  assert.equal(vm.runInContext('nativeCalls', realm), 0);
});

test('Allow, global Bypass and master Off cannot activate a dormant selected WebRTC profile, even beside other Custom APIs', () => {
  for (const mode of ['off', 'bypass']) {
    let config = change(base(), 'webrtc', { mode, selected: { kind: 'value', value: profile() } });
    config = change(config, 'hardware-concurrency', { mode: 'custom', selected: { kind: 'value', value: 16 } });
    const scripts = buildApiCustomScripts(config, ['https://*/*']); assert.equal(scripts.length, 1);
    const realm = run(scripts[0]);
    assert.equal(vm.runInContext('navigator.hardwareConcurrency', realm), 16);
    assert.equal(vm.runInContext("new RTCIceCandidate({candidate:'candidate:1 1 UDP 1 198.18.0.88 5000 typ srflx'}).address", realm), '198.18.0.88');
    vm.runInContext('new RTCPeerConnection();new WebSocket();new WebTransport()', realm); assert.equal(vm.runInContext('nativeCalls', realm), 3);
    assert.equal(scripts[0].js[0].code.includes('198.51.100.29'), false);
    assert.deepEqual(buildApiCustomScripts({ ...config, enabled: false, antidetectEnabled: false }, ['https://*/*']), []);
  }
});

test('exact-host overrides partition ON profiles, Bypass inheritance and disabled sites without widening exceptions', () => {
  let config = base(); for (const id of ids) config = change(config, id, { mode: 'on' });
  config = change(config, 'webrtc', { mode: 'off' }, 'allow.example');
  config = change(config, 'websocket', { mode: 'off' }, 'allow.example');
  config = change(config, 'webrtc', { mode: 'bypass' }, 'inherit.example');
  config = change(config, 'webrtc', { mode: 'bypass' }, 'disabled.example'); config.sites.find(site => site.host === 'disabled.example').disabled = true;
  const scripts = buildApiCustomScripts(config, ['https://*/*', 'http://*/*']);
  const global = scripts.find(row => row.id.endsWith('-global'));
  assert.deepEqual(global.excludeMatches, ['http://allow.example/*', 'http://disabled.example/*', 'http://inherit.example/*', 'https://allow.example/*', 'https://disabled.example/*', 'https://inherit.example/*']);
  const allowed = scripts.find(row => row.id === apiCustomSiteScriptId('allow.example'));
  assert.deepEqual(allowed.matches, ['http://allow.example/*', 'https://allow.example/*']);
  const realm = run(allowed); assert.equal(vm.runInContext('typeof RTCPeerConnection', realm), 'function'); assert.equal(vm.runInContext('typeof WebSocket', realm), 'function'); assert.equal(vm.runInContext('typeof WebTransport', realm), 'undefined');
  const inherited = run(scripts.find(row => row.id === apiCustomSiteScriptId('inherit.example'))); assert.equal(vm.runInContext('typeof RTCPeerConnection', inherited), 'undefined');
  assert.equal(scripts.some(row => row.id === apiCustomSiteScriptId('disabled.example')), false);
  assert.deepEqual(customEntries(config, 'disabled.example'), []);
});

test('Custom WebRTC and blocked protocols coexist without interpreting the RTC profile as an ON value', () => {
  let config = change(base(), 'webrtc', { mode: 'custom', selected: { kind: 'value', value: profile() } });
  config = change(config, 'websocket', { mode: 'on' }); config = change(config, 'webtransport', { mode: 'on' });
  const realm = run(buildApiCustomScripts(config, ['https://*/*'])[0]);
  assert.equal(vm.runInContext('typeof RTCPeerConnection', realm), 'function');
  assert.equal(vm.runInContext('typeof WebSocket + typeof WebTransport', realm), 'undefinedundefined');
  assert.equal(vm.runInContext("new RTCIceCandidate({candidate:'candidate:1 1 UDP 1 198.18.0.88 5000 typ srflx'}).address", realm), '198.51.100.29');
});

test('each generated opaque ON bundle installs only its exact protocol guard and exposes no page restore entry', () => {
  for (const id of ids) {
    const realm = fixture(), file = new URL('../../apps/production-extension/antidetect-block-opaque.' + id + '.js', import.meta.url);
    vm.runInContext("globalThis.location={protocol:'about:'}", realm);
    vm.runInContext(readFileSync(file, 'utf8'), realm);
    const names = { webrtc: 'RTCPeerConnection', websocket: 'WebSocket', webtransport: 'WebTransport' };
    for (const other of ids) assert.equal(vm.runInContext('typeof ' + names[other], realm), other === id ? 'undefined' : 'function');
    vm.runInContext("postMessage({channel:'detect.expert/protection/v1',type:'protection-stop'})", realm);
    assert.equal(vm.runInContext('typeof ' + names[id], realm), 'undefined');
    for (const complete of [false, true]) {
      const skipped = fixture();
      vm.runInContext("globalThis.location={protocol:" + JSON.stringify(complete ? 'about:' : 'https:') + "};" + (complete ? "Object.defineProperty(globalThis,Symbol.for('detect.expert/api-custom/document/v2'),{value:true})" : ''), skipped);
      vm.runInContext(readFileSync(file, 'utf8'), skipped);
      for (const name of Object.values(names)) assert.equal(vm.runInContext('typeof ' + name, skipped), 'function', 'normal or already-complete documents must retain their selected policy');
    }
  }
});
