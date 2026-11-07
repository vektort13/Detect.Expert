// ADR-070 / E22-25: two WebRTC owners, prediction restoration and native ownership failures.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProxyPrivacyOverlay } from '../../apps/production-extension/proxy-privacy.js';
import { WebRtcNetworkController } from '../../apps/production-extension/webrtc-network-controller.js';

const KEY = 'proxy-privacy-owner:v1';
const turn = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const calls = [], saved = {}, controls = { permission: true, storageFailure: '', startFailure: false }, predictionListeners = new Set();
  const prediction = { base: true, ours: null, other: null, policy: false, fail: '', ignore: '', hold: null };
  const rtc = { base: 'default_public_and_private_interfaces', ours: null, other: null, policy: false, fail: '', ignore: '', hold: null };
  const values = { prediction, rtc };
  const setting = name => ({
    async get() { calls.push({ name, operation: 'get' }); const target = values[name]; if (target.fail === 'get') throw Error('NATIVE_ERROR_CANARY'); return { value: target.other ?? target.ours ?? target.base, levelOfControl: target.policy ? 'not_controllable' : target.other !== null ? 'controlled_by_other_extensions' : target.ours !== null ? 'controlled_by_this_extension' : 'controllable_by_this_extension' }; },
    async set(options) { calls.push({ name, operation: 'set', options: { ...options } }); const target = values[name]; if (target.hold) await target.hold; if (target.fail === 'set') throw Error('NATIVE_ERROR_CANARY'); if (target.ignore === 'set') return false; target.ours = options.value; return true; },
    async clear(options) { calls.push({ name, operation: 'clear', options: { ...options } }); const target = values[name]; if (target.hold) await target.hold; if (target.fail === 'clear') throw Error('NATIVE_ERROR_CANARY'); if (target.ignore === 'clear') return false; target.ours = null; return true; },
  });
  const api = { runtime: { id: 'proxy-privacy-review-unit' }, permissions: { async contains(options) { calls.push({ name: 'permission', operation: 'contains', options }); return controls.permission; } }, privacy: { network: { networkPredictionEnabled: { ...setting('prediction'), onChange: { addListener(fn) { predictionListeners.add(fn); } } }, webRTCIPHandlingPolicy: setting('rtc') } }, storage: { local: {
    async get(key) { calls.push({ name: 'storage', operation: 'get', key }); if (controls.storageFailure === 'get') throw Error('STORAGE_ERROR_CANARY'); return { [key]: saved[key] }; },
    async set(items) { calls.push({ name: 'storage', operation: 'set' }); if (controls.storageFailure === 'set') throw Error('STORAGE_ERROR_CANARY'); Object.assign(saved, structuredClone(items)); },
    async remove(key) { calls.push({ name: 'storage', operation: 'remove', key }); if (controls.storageFailure === 'remove') throw Error('STORAGE_ERROR_CANARY'); delete saved[key]; },
  } } };
  const controller = { webrtcNetwork: new WebRtcNetworkController(api), async start() { calls.push({ name: 'controller', operation: 'start' }); if (controls.startFailure) throw Error('START_ERROR_CANARY'); } };
  const overlay = createProxyPrivacyOverlay(api, controller);
  return { api, controller, overlay, calls, saved, controls, rtc, prediction, changed() { for (const callback of predictionListeners) callback(); }, modifications(name) { return calls.filter(call => call.name === name && ['set', 'clear'].includes(call.operation)); } };
}

test('WebRTC owners preserve each Antidetect policy across Proxy enable, Antidetect changes and Proxy disable', async () => {
  for (const original of ['system', 'default_public_interface_only', 'disable_non_proxied_udp']) {
    const f = fixture(), rtc = f.controller.webrtcNetwork;
    await rtc.reconcile(original); await f.overlay.setActive(true, { disablePrediction: false });
    assert.equal(f.rtc.ours, 'disable_non_proxied_udp'); assert.equal(rtc.desired, original); assert.equal((await rtc.inspect()).status, 'applied');
    const next = original === 'system' ? 'default_public_interface_only' : 'system';
    await rtc.reconcile(next); assert.equal(f.rtc.ours, 'disable_non_proxied_udp'); assert.equal(rtc.desired, next);
    await f.overlay.setActive(false); assert.equal(rtc.desired, next); assert.equal(f.rtc.ours, next === 'system' ? null : next);
    assert.equal((await rtc.inspect()).status, next === 'system' ? 'inactive' : 'applied');
  }
});
test('Antidetect off never removes active Proxy WebRTC ownership; Proxy flags can leave Antidetect untouched', async () => {
  const f = fixture(), rtc = f.controller.webrtcNetwork;
  await rtc.reconcile('default_public_interface_only'); await f.overlay.setActive(true, { protectWebRTC: false, disablePrediction: false }); assert.equal(f.rtc.ours, 'default_public_interface_only');
  await f.overlay.setActive(true, { protectWebRTC: true, disablePrediction: false }); await rtc.reconcile('system'); assert.equal(f.rtc.ours, 'disable_non_proxied_udp');
  await f.overlay.setActive(false); assert.equal(f.rtc.ours, null); assert.equal(rtc.proxyActive, false);
});
test('prediction owner releases only its own layer and reveals browser state rather than guessing a replacement', async () => {
  for (const base of [true, false]) {
    const f = fixture(); f.prediction.base = base;
    await f.overlay.setActive(true); assert.equal(f.prediction.ours, false); assert.deepEqual(f.saved[KEY], { version: 1, previous: null });
    const result = await f.overlay.setActive(false); assert.equal(result.status, 'inactive'); assert.equal(f.prediction.ours, null); assert.equal((await f.api.privacy.network.networkPredictionEnabled.get()).value, base); assert.equal(f.saved[KEY], undefined);
    assert.equal(f.modifications('prediction').filter(call => call.operation === 'set').length, 1);
  }
});
test('prediction restores an existing same-extension setting, including false, after disconnect and worker recreation', async () => {
  for (const previous of [true, false]) for (const restart of [false, true]) {
    const f = fixture(); f.prediction.ours = previous;
    await f.overlay.setActive(true); assert.deepEqual(f.saved[KEY], { version: 1, previous });
    const active = restart ? createProxyPrivacyOverlay(f.api, { start: async () => {}, webrtcNetwork: new WebRtcNetworkController(f.api) }) : f.overlay;
    await active.setActive(false); assert.equal(f.prediction.ours, previous); assert.equal(f.saved[KEY], undefined);
  }
});
test('repeated active reconcile preserves the original prediction owner marker rather than saving the proxy value', async () => {
  const f = fixture(); f.prediction.ours = true;
  await f.overlay.setActive(true); await f.overlay.setActive(true); await createProxyPrivacyOverlay(f.api, f.controller).setActive(true);
  assert.deepEqual(f.saved[KEY], { version: 1, previous: true });
  await f.overlay.setActive(false); assert.equal(f.prediction.ours, true);
});
test('Proxy privacy changes serialize; disconnect waits for an in-flight prediction set and restores afterward', async () => {
  const f = fixture(); let release;
  f.prediction.hold = new Promise(resolve => { release = resolve; });
  const enabling = f.overlay.setActive(true), disabling = f.overlay.setActive(false);
  await turn(); assert.equal(f.modifications('prediction').length, 1); assert.equal(f.modifications('prediction')[0].operation, 'set'); assert.equal(f.calls.filter(call => call.name === 'controller').length, 1);
  release(); await enabling; await disabling;
  assert.equal(f.prediction.ours, null); assert.equal(f.rtc.ours, null); assert.deepEqual(f.modifications('prediction').map(call => call.operation), ['set', 'clear']);
});
test('failed activation does not poison the serialized queue; later explicit disconnect cleans the ownership marker', async () => {
  const f = fixture(); f.prediction.fail = 'set'; await assert.rejects(f.overlay.setActive(true));
  assert.equal(f.rtc.ours, 'disable_non_proxied_udp'); assert.equal(f.saved[KEY]?.version, 1);
  f.prediction.fail = ''; await f.overlay.setActive(false); assert.equal(f.rtc.ours, null); assert.equal(f.saved[KEY], undefined);
});
test('missing privacy permission never accesses privacy APIs; revoked browser layers and their restore marker are abandoned', async () => {
  const f = fixture(); f.controls.permission = false;
  await assert.rejects(f.overlay.setActive(true), error => error.code === 'privacy-permission-required');
  assert.equal(f.calls.filter(call => ['rtc', 'prediction'].includes(call.name)).length, 0);
  assert.equal((await f.overlay.setActive(true, { protectWebRTC: false, disablePrediction: false })).status, 'inactive');
  f.controls.permission = true; f.prediction.ours = true; await f.overlay.setActive(true);
  f.controls.permission = false; f.prediction.ours = null; f.rtc.ours = null; // Native permission revocation removes this extension's layers.
  const before = f.calls.filter(call => ['rtc', 'prediction'].includes(call.name)).length;
  await f.overlay.setActive(false); assert.equal(f.saved[KEY], undefined);
  assert.equal(f.calls.filter(call => ['rtc', 'prediction'].includes(call.name)).length, before);
  f.controls.permission = true; await f.overlay.setActive(false); assert.equal(f.saved[KEY], undefined); assert.equal(f.prediction.ours, null, 'regrant cannot resurrect the abandoned prior preference');
});
test('other extensions and enterprise policy reject active protection without overwriting them', async () => {
  for (const owner of ['other', 'policy']) {
    const f = fixture(); if (owner === 'other') f.rtc.other = 'default'; else f.rtc.policy = true;
    await assert.rejects(f.overlay.setActive(true), error => error.code === 'privacy-conflict'); assert.equal(f.modifications('rtc').length, 0); assert.equal(f.modifications('prediction').length, 0);
    const g = fixture(); if (owner === 'other') g.prediction.other = true; else g.prediction.policy = true;
    await assert.rejects(g.overlay.setActive(true, { protectWebRTC: false }), error => error.code === 'privacy-conflict'); assert.equal(g.modifications('prediction').length, 0); assert.equal(g.saved[KEY], undefined);
  }
});
test('unsupported APIs and silently ignored activation cannot produce applied status', async () => {
  const f = fixture(); delete f.api.privacy.network.networkPredictionEnabled; await assert.rejects(f.overlay.setActive(true), error => error.code === 'privacy-unavailable');
  const g = fixture(); g.prediction.ignore = 'set'; await assert.rejects(g.overlay.setActive(true), error => ['privacy-conflict', 'privacy-unavailable'].includes(error.code));
  const h = fixture(); h.rtc.ignore = 'set'; await assert.rejects(h.overlay.setActive(true), error => ['privacy-conflict', 'privacy-unavailable'].includes(error.code)); assert.equal(h.modifications('prediction').length, 0);
});
test('storage write failure before prediction mutation leaves the native prediction setting untouched', async () => {
  const f = fixture(); f.controls.storageFailure = 'set'; await assert.rejects(f.overlay.setActive(true)); assert.equal(f.modifications('prediction').length, 0); assert.equal(f.prediction.ours, null);
});
test('prediction changed independently after activation is not overwritten during cleanup', async () => {
  const f = fixture(); await f.overlay.setActive(true); f.prediction.ours = true;
  const before = f.modifications('prediction').length; await f.overlay.setActive(false);
  assert.equal(f.prediction.ours, true); assert.equal(f.modifications('prediction').length, before); assert.equal(f.saved[KEY], undefined);
});
test('a hidden Proxy prediction layer is cleared under a newer extension for both original ownership states', async () => {
  for (const previous of [null, true, false]) for (const restart of [false, true]) {
    const f = fixture(); f.prediction.ours = previous; await f.overlay.setActive(true); f.prediction.other = true;
    const active = restart ? createProxyPrivacyOverlay(f.api, f.controller) : f.overlay;
    const before = f.modifications('prediction').length; await active.setActive(false);
    assert.equal((await f.api.privacy.network.networkPredictionEnabled.get()).levelOfControl, 'controlled_by_other_extensions');
    assert.equal(f.modifications('prediction').slice(before).some(call => call.operation === 'set'), false, 'cleanup must never set over the newer owner');
    assert.equal(f.prediction.ours, null, 'the hidden Proxy layer is released before the other owner leaves');
    assert.deepEqual(f.saved[KEY], previous === null ? undefined : { version: 1, previous, released: true });
    f.prediction.other = null; await active.setActive(false); assert.equal(f.prediction.ours, previous); assert.equal(f.saved[KEY], undefined);
  }
});
test('ignored prediction cleanup retains its ownership marker and never reports successful restoration', async () => {
  for (const previous of [null, true]) {
    const f = fixture(); f.prediction.ours = previous; await f.overlay.setActive(true); f.prediction.ignore = previous === null ? 'clear' : 'set';
    await assert.rejects(f.overlay.setActive(false)); assert.equal(f.saved[KEY]?.version, 1, 'failed restoration remains recoverable after worker restart');
    f.prediction.ignore = ''; await createProxyPrivacyOverlay(f.api, f.controller).setActive(false); assert.equal(f.prediction.ours, previous); assert.equal(f.saved[KEY], undefined);
  }
});
test('prediction onChange restores a deferred preexisting preference only after the newer owner releases control', async () => {
  const f = fixture(); f.prediction.ours = true; await f.overlay.setActive(true); f.prediction.other = false;
  await f.overlay.setActive(false); assert.equal(f.prediction.ours, null); assert.equal(f.saved[KEY]?.released, true);
  const before = f.modifications('prediction').length; f.prediction.other = null; f.changed(); await turn(); await turn();
  assert.equal(f.prediction.ours, true); assert.equal(f.saved[KEY], undefined); assert.deepEqual(f.modifications('prediction').slice(before).map(call => [call.operation, call.options.value]), [['set', true]]);
});
test('unknown Proxy owner values are rejected without disturbing the effective Antidetect policy', async () => {
  const f = fixture(), rtc = f.controller.webrtcNetwork; await rtc.reconcile('default_public_interface_only');
  for (const value of ['true', 1, null, undefined, {}]) await assert.rejects(rtc.setProxyActive(value), TypeError);
  assert.equal(rtc.proxyActive, false); assert.equal(rtc.desired, 'default_public_interface_only'); assert.equal(f.rtc.ours, 'default_public_interface_only');
});
test('persisted Proxy ownership is installed before Antidetect startup can reconcile its OFF/system policy', async () => {
  const f = fixture(); f.rtc.ours = 'disable_non_proxied_udp';
  f.controller.start = async () => {
    assert.equal(f.controller.webrtcNetwork.proxyActive, true, 'startup sees the persisted Proxy requirement before its first policy reconcile');
    await f.controller.webrtcNetwork.reconcile('system');
    assert.equal(f.rtc.ours, 'disable_non_proxied_udp');
  };
  await f.overlay.setActive(true, { disablePrediction: false });
  assert.equal(f.rtc.ours, 'disable_non_proxied_udp'); assert.equal(f.modifications('rtc').some(call => call.operation === 'clear'), false);
  await f.overlay.setActive(false); assert.equal(f.rtc.ours, null);
});
