import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WebRtcNetworkController, WebRtcProfileSeeds, WEBRTC_FIREFOX_ONLY_POLICIES, WEBRTC_POLICIES, WEBRTC_POLICY_UNSUPPORTED_CODE } from '../../apps/production-extension/webrtc-network-controller.js';
import { API_WEBRTC_NETWORK_POLICIES } from '../../apps/production-extension/api-configuration.js';

function fixture({ firefox = false } = {}) {
  const calls = [], base = { value: 'default_public_and_private_interfaces', levelOfControl: 'controllable_by_this_extension' };
  let permitted = true, current = { ...base }, fail = '', ignoreSet = false, ignoreClear = false, hold;
  const setting = {
    async get() { calls.push(['get']); if (fail === 'get') throw Error('native failure'); return { ...current }; },
    async set(value) { calls.push(['set', value]); if (fail === 'set') throw Error('native failure'); if (hold) await hold; if (!ignoreSet) current = { value: value.value, levelOfControl: 'controlled_by_this_extension' }; },
    async clear(value) { calls.push(['clear', value]); if (fail === 'clear') throw Error('native failure'); if (!ignoreClear && current.levelOfControl === 'controlled_by_this_extension') current = { ...base }; },
  };
  const stored = { local: {}, session: {} }, writes = [], reads = [];
  const api = { runtime: { id: 'rtc-network-unit', getURL: path => (firefox ? 'moz-extension://owned/' : 'chrome-extension://owned/') + path }, permissions: { async contains() { return permitted; } }, privacy: { network: { webRTCIPHandlingPolicy: setting } }, storage: {} };
  for (const area of ['local', 'session']) api.storage[area] = {
    async get(key) { reads.push([area, key]); return { [key]: stored[area][key] }; },
    async set(items) { if (fail === 'storage') throw Error('disk full'); writes.push([area, structuredClone(items)]); Object.assign(stored[area], items); },
  };
  return { api, calls, stored, writes, reads, setting, setPermission: value => { permitted = value; }, setCurrent: value => { current = value; },
    setFail: value => { fail = value; }, ignoreSet: () => { ignoreSet = true; }, ignoreClear: () => { ignoreClear = true; }, hold: promise => { hold = promise; } };
}
const modifications = f => f.calls.filter(([method]) => method !== 'get');

test('native WebRTC policy defaults to system, releases only its own possibly stale layer once and never sets a value', async () => {
  const f = fixture(), c = new WebRtcNetworkController(f.api);
  const result = await c.reconcile('system');
  assert.equal(result.status, 'inactive'); assert.equal(result.value, 'default_public_and_private_interfaces'); assert.deepEqual(modifications(f), [['clear', { scope: 'regular' }]]);
  await c.reconcile('system'); assert.equal(modifications(f).length, 1);
});
test('optional privacy permission is required before accessing the native setting', async () => {
  const f = fixture(), c = new WebRtcNetworkController(f.api); f.setPermission(false);
  assert.equal((await c.reconcile('disable_non_proxied_udp')).status, 'permission-required'); assert.deepEqual(f.calls, []);
  assert.equal((await c.reconcile('system')).status, 'inactive'); assert.deepEqual(f.calls, []);
});
test('revoke after applying a policy never reports a confirmed release until permission and readback return', async () => {
  const f = fixture(), c = new WebRtcNetworkController(f.api);
  assert.equal((await c.reconcile('disable_non_proxied_udp')).status, 'applied');
  f.setPermission(false); const before = f.calls.length;
  assert.equal((await c.inspect()).status, 'permission-required');
  const unavailable = await c.reconcile('system');
  assert.equal(unavailable.status, 'permission-required'); assert.equal(unavailable.value, null); assert.equal(f.calls.length, before);
  f.setPermission(true); assert.equal((await c.reconcile('system')).status, 'inactive');
  assert.equal((await c.inspect()).value, 'default_public_and_private_interfaces');
  f.setPermission(false); assert.equal((await c.inspect()).status, 'inactive');
});

test('permission loss while native set is pending does not hide an unverified written layer', async () => {
  const f = fixture(), c = new WebRtcNetworkController(f.api); let release;
  f.hold(new Promise(done => { release = done; }));
  const work = c.reconcile('disable_non_proxied_udp'); await new Promise(done => setImmediate(done));
  f.setPermission(false); release(); assert.equal((await work).status, 'permission-required');
  assert.equal((await c.reconcile('system')).status, 'permission-required');
  f.setPermission(true); assert.equal((await c.reconcile('system')).status, 'inactive');
});

test('policy applies only after native readback confirms our ownership and exact requested value', async () => {
  const f = fixture(), c = new WebRtcNetworkController(f.api);
  assert.deepEqual(await c.reconcile('disable_non_proxied_udp'), { desired: 'disable_non_proxied_udp', status: 'applied', value: 'disable_non_proxied_udp', levelOfControl: 'controlled_by_this_extension' });
  assert.deepEqual(modifications(f), [['set', { value: 'disable_non_proxied_udp', scope: 'regular' }]]);
  await c.reconcile('disable_non_proxied_udp'); assert.equal(modifications(f).length, 1, 'already owned setting is not repeatedly written');
});
test('system clears only our layer and reveals the prior native value without guessing a default', async () => {
  const f = fixture(), c = new WebRtcNetworkController(f.api);
  await c.reconcile('default_public_interface_only'); const result = await c.reconcile('system');
  assert.equal(result.status, 'inactive'); assert.equal(result.value, 'default_public_and_private_interfaces');
  assert.deepEqual(modifications(f), [['set', { value: 'default_public_interface_only', scope: 'regular' }], ['clear', { scope: 'regular' }]]);
});
test('enterprise or another extension ownership is never overwritten; clear releases only our hidden layer', async () => {
  for (const levelOfControl of ['not_controllable', 'controlled_by_other_extensions']) {
    const f = fixture(), c = new WebRtcNetworkController(f.api); f.setCurrent({ value: 'default', levelOfControl });
    assert.equal((await c.reconcile('disable_non_proxied_udp')).status, 'not-controllable');
    assert.equal((await c.reconcile('system')).status, 'inactive'); assert.deepEqual(modifications(f), [['clear', { scope: 'regular' }]]);
    assert.equal((await c.inspect()).value, 'default'); assert.equal((await c.inspect()).levelOfControl, levelOfControl);
  }
});

test('a hidden owned layer is released under a newer extension and after service-worker restart', async () => {
  for (const restart of [false, true]) {
    const f = fixture(); let ours = null, other = null, failClear = false;
    f.setting.get = async () => ({ value: other ?? ours ?? 'default', levelOfControl: other ? 'controlled_by_other_extensions' : ours ? 'controlled_by_this_extension' : 'controllable_by_this_extension' });
    f.setting.set = async ({ value }) => { ours = value; };
    f.setting.clear = async () => { if (failClear) return false; ours = null; return true; };
    let c = new WebRtcNetworkController(f.api);
    await c.reconcile('disable_non_proxied_udp');
    other = 'default_public_interface_only';
    if (restart) c = new WebRtcNetworkController(f.api);
    failClear = true;
    assert.equal((await c.reconcile('system')).status, 'error'); assert.equal(c.releaseNeeded, true);
    assert.equal((await c.inspect()).status, 'error', 'reading state under the newer owner must retain the failed release');
    other = null; assert.equal((await c.inspect()).status, 'error', 'our revived layer cannot masquerade as system');
    other = 'default_public_interface_only'; failClear = false;
    const state = await c.reconcile('system');
    assert.equal(state.value, 'default_public_interface_only'); assert.equal(state.levelOfControl, 'controlled_by_other_extensions');
    other = null; assert.equal((await c.inspect()).value, 'default', 'removing the newer owner never revives our released layer');
  }
});
test('a silently ignored set or ownership change is not reported as applied', async () => {
  const f = fixture(), c = new WebRtcNetworkController(f.api); f.ignoreSet();
  assert.equal((await c.reconcile('disable_non_proxied_udp')).status, 'not-controllable');
  f.setCurrent({ value: 'disable_non_proxied_udp', levelOfControl: 'controlled_by_other_extensions' });
  assert.equal((await c.inspect()).status, 'not-controllable');
});
test('clear must be confirmed, and native failures stay errors without exposing exception contents', async () => {
  const f = fixture(), c = new WebRtcNetworkController(f.api); await c.reconcile('disable_non_proxied_udp'); f.ignoreClear();
  assert.equal((await c.reconcile('system')).status, 'error');
  for (const failure of ['get', 'set', 'clear']) {
    const g = fixture(), d = new WebRtcNetworkController(g.api);
    if (failure === 'clear') await d.reconcile('disable_non_proxied_udp'); g.setFail(failure);
    const result = await d.reconcile(failure === 'clear' ? 'system' : 'disable_non_proxied_udp');
    assert.equal(result.status, 'error'); assert.equal(JSON.stringify(result).includes('native failure'), false);
  }
});
test('native policy mutations serialize so an in-flight enable cannot overtake a later system request', async () => {
  const f = fixture(), c = new WebRtcNetworkController(f.api); let release;
  f.hold(new Promise(resolve => { release = resolve; }));
  const first = c.reconcile('disable_non_proxied_udp'), second = c.reconcile('system');
  await new Promise(resolve => setImmediate(resolve)); assert.equal(modifications(f).length, 1); release();
  assert.equal((await first).status, 'applied'); assert.equal((await second).status, 'inactive'); assert.equal(modifications(f).at(-1)[0], 'clear');
});
test('unavailable API, malformed control states and invalid desired policies fail closed', async () => {
  const f = fixture(), c = new WebRtcNetworkController(f.api); delete f.api.privacy;
  assert.equal((await c.reconcile('disable_non_proxied_udp')).status, 'unsupported');
  for (const invalid of ['proxy-only', 'default', 'Proxy_Only', '', null, undefined, 7]) await assert.rejects(c.reconcile(invalid), TypeError, String(invalid));
  const g = fixture(), d = new WebRtcNetworkController(g.api); g.setCurrent({ value: 'default', levelOfControl: 'unknown' });
  assert.equal((await d.reconcile('disable_non_proxied_udp')).status, 'error'); assert.deepEqual(modifications(g), []);
});

const randomized = deviceLifetime => ({ id: 'webrtc', mode: 'custom', selected: { kind: 'value', value: { randomizeDevices: true, deviceLifetime } } });
test('device seeds are 256-bit, retained across SW restarts, and separated into session/local storage', async () => {
  const f = fixture(), seeds = new WebRtcProfileSeeds(f.api);
  const [a, b] = await Promise.all([seeds.prepare([randomized('session'), randomized('site')]), seeds.prepare([randomized('session'), randomized('site')])]);
  assert.deepEqual(a, b); assert.match(a.session, /^[a-f0-9]{64}$/); assert.match(a.site, /^[a-f0-9]{64}$/); assert.notEqual(a.site, a.session);
  assert.equal(f.writes.length, 2); assert.equal(f.writes[0][0], 'session'); assert.equal(f.writes[1][0], 'local');
  assert.deepEqual(await new WebRtcProfileSeeds(f.api).prepare([randomized('session'), randomized('site')]), a);
  f.stored.session = {}; const next = await new WebRtcProfileSeeds(f.api).prepare([randomized('session'), randomized('site')]);
  assert.notEqual(next.session, a.session); assert.equal(next.site, a.site);
});
test('inactive or nonrandom profiles never touch device seed storage', async () => {
  const f = fixture(), seeds = new WebRtcProfileSeeds(f.api);
  assert.deepEqual(await seeds.prepare([{ id: 'webrtc', mode: 'off', selected: randomized('session').selected }, { id: 'hardware-concurrency', mode: 'custom', selected: { kind: 'value', value: 16 } }]), {});
  assert.deepEqual(f.reads, []); assert.deepEqual(f.writes, []);
});
test('seed persistence failures retry instead of installing a falsely stable or native device identifier', async () => {
  const f = fixture(), seeds = new WebRtcProfileSeeds(f.api); f.setFail('storage');
  await assert.rejects(seeds.prepare([randomized('session')])); assert.deepEqual(f.stored.session, {});
  f.setFail(''); assert.match((await seeds.prepare([randomized('session')])).session, /^[a-f0-9]{64}$/);
  const g = fixture(); delete g.api.storage.session;
  await assert.rejects(new WebRtcProfileSeeds(g.api).prepare([randomized('session')]));
});

// ---- Firefox-only proxy_only (round 5) ---------------------------------------------------------------------------------------
test('the controller policy list is the contract list, weakest to strictest, and only proxy_only is Firefox-only', () => {
  assert.deepEqual([...WEBRTC_POLICIES], [...API_WEBRTC_NETWORK_POLICIES]);
  assert.deepEqual([...WEBRTC_FIREFOX_ONLY_POLICIES], ['proxy_only']); assert.equal(WEBRTC_POLICY_UNSUPPORTED_CODE, 'webrtc-policy-unsupported');
  for (const value of [WEBRTC_POLICIES, WEBRTC_FIREFOX_ONLY_POLICIES]) assert.equal(Object.isFrozen(value), true);
});

test('Firefox: proxy_only is written once with the regular scope, applies only after the native readback shows our ownership and the exact value, and System releases it', async () => {
  const f = fixture({ firefox: true }), c = new WebRtcNetworkController(f.api);
  assert.equal(c.supports('proxy_only'), true); assert.equal(c.refusal('proxy_only'), null);
  assert.deepEqual(await c.reconcile('proxy_only'), { desired: 'proxy_only', status: 'applied', value: 'proxy_only', levelOfControl: 'controlled_by_this_extension' });
  assert.deepEqual(modifications(f), [['set', { value: 'proxy_only', scope: 'regular' }]]);
  await c.reconcile('proxy_only'); assert.equal(modifications(f).length, 1, 'an owned setting is not written again');
  assert.equal((await c.inspect()).status, 'applied');
  const released = await c.reconcile('system');
  assert.deepEqual(released, { desired: 'system', status: 'inactive', value: 'default_public_and_private_interfaces', levelOfControl: 'controllable_by_this_extension' });
  assert.deepEqual(modifications(f).at(-1), ['clear', { scope: 'regular' }]);
  // Moving between a shared policy and proxy_only rewrites only the value and never leaves two layers.
  await c.reconcile('disable_non_proxied_udp'); assert.equal((await c.reconcile('proxy_only')).value, 'proxy_only'); assert.equal((await c.reconcile('disable_non_proxied_udp')).value, 'disable_non_proxied_udp');
});

test('Firefox: a browser that ignores the write, reports another value or rejects the enum is never reported as applied and leaks no text', async () => {
  const ignored = fixture({ firefox: true }), a = new WebRtcNetworkController(ignored.api); ignored.ignoreSet();
  assert.equal((await a.reconcile('proxy_only')).status, 'not-controllable');
  const other = fixture({ firefox: true }), b = new WebRtcNetworkController(other.api); other.setting.set = async () => { other.setCurrent({ value: 'disable_non_proxied_udp', levelOfControl: 'controlled_by_this_extension' }); };
  assert.equal((await b.reconcile('proxy_only')).status, 'not-controllable', 'the readback value must equal the request');
  const rejecting = fixture({ firefox: true }), r = new WebRtcNetworkController(rejecting.api);
  rejecting.setting.set = async () => { throw Error('Invalid enumeration value "proxy_only" with https://do-not-expose.invalid'); };
  const result = await r.reconcile('proxy_only'); assert.equal(result.status, 'error'); assert.equal(JSON.stringify(result).includes('do-not-expose'), false);
  const owned = fixture({ firefox: true }), o = new WebRtcNetworkController(owned.api); owned.setCurrent({ value: 'default', levelOfControl: 'controlled_by_other_extensions' });
  assert.equal((await o.reconcile('proxy_only')).status, 'not-controllable'); assert.deepEqual(modifications(owned), [], 'another owner is never overwritten');
});

test('Chrome: proxy_only is refused with the fixed code, shows the unsupported state, and no value is ever written', async () => {
  const f = fixture(), c = new WebRtcNetworkController(f.api);
  assert.equal(c.supports('proxy_only'), false); assert.equal(c.refusal('proxy_only'), 'webrtc-policy-unsupported');
  for (const policy of ['system', 'default_public_interface_only', 'disable_non_proxied_udp']) { assert.equal(c.supports(policy), true, policy); assert.equal(c.refusal(policy), null, policy); }
  for (const other of ['proxy-only', '', null, 7, undefined]) { assert.equal(c.supports(other), false); assert.equal(c.refusal(other), null, 'only a known policy has a refusal'); }
  const state = await c.reconcile('proxy_only');
  assert.deepEqual(state, { desired: 'proxy_only', status: 'unsupported', value: 'default_public_and_private_interfaces', levelOfControl: 'controllable_by_this_extension' }, 'the browser value is shown read-only');
  assert.deepEqual(modifications(f), [], 'nothing is set, nothing is cleared, nothing is written');
  assert.equal((await c.inspect()).status, 'unsupported'); assert.deepEqual(modifications(f), []);
  for (let index = 0; index < 3; index++) await c.reconcile('proxy_only'); assert.deepEqual(modifications(f), [], 'repeated reconciles stay read-only');
  // A choice another extension controls is not touched either; the state is still unsupported, not not-controllable.
  const owned = fixture(), d = new WebRtcNetworkController(owned.api); owned.setCurrent({ value: 'default', levelOfControl: 'controlled_by_other_extensions' });
  assert.equal((await d.reconcile('proxy_only')).status, 'unsupported'); assert.deepEqual(modifications(owned), []);
});

test('Chrome: a stored proxy_only releases the layer this extension still holds from an earlier choice instead of replacing it', async () => {
  const f = fixture(), c = new WebRtcNetworkController(f.api);
  assert.equal((await c.reconcile('disable_non_proxied_udp')).status, 'applied');
  const state = await c.reconcile('proxy_only');
  assert.equal(state.status, 'unsupported'); assert.equal(state.value, 'default_public_and_private_interfaces'); assert.notEqual(state.levelOfControl, 'controlled_by_this_extension');
  assert.deepEqual(modifications(f), [['set', { value: 'disable_non_proxied_udp', scope: 'regular' }], ['clear', { scope: 'regular' }]], 'the earlier layer is released; proxy_only is never written');
  // The permission gate still reports its own state for a refused choice that once had a layer.
  const g = fixture(), h = new WebRtcNetworkController(g.api); await h.reconcile('disable_non_proxied_udp'); g.setPermission(false);
  assert.equal((await h.reconcile('proxy_only')).status, 'permission-required');
  g.setPermission(true); assert.equal((await h.reconcile('proxy_only')).status, 'unsupported');
});

test('the Proxy requirement is independent of a refused choice and of the stricter Firefox choice', async () => {
  // Chrome, proxy_only stored: the Proxy module still gets disable_non_proxied_udp, and it is released when the Proxy module stops.
  const f = fixture(), c = new WebRtcNetworkController(f.api);
  await c.reconcile('proxy_only'); assert.deepEqual(modifications(f), []);
  const on = await c.setProxyActive(true);
  assert.equal(on.status, 'applied'); assert.equal(on.value, 'disable_non_proxied_udp'); assert.deepEqual(modifications(f), [['set', { value: 'disable_non_proxied_udp', scope: 'regular' }]]);
  const off = await c.setProxyActive(false);
  assert.equal(off.status, 'unsupported'); assert.equal(off.levelOfControl, 'controllable_by_this_extension'); assert.deepEqual(modifications(f).at(-1), ['clear', { scope: 'regular' }]);
  // Firefox: the stricter of the choice and the Proxy requirement wins, in both orders, and the requirement outlives turning the choice off.
  const g = fixture({ firefox: true }), d = new WebRtcNetworkController(g.api);
  await d.reconcile('proxy_only'); assert.equal((await d.setProxyActive(true)).value, 'proxy_only', 'the Proxy requirement never weakens a stricter choice');
  assert.equal((await d.reconcile('system')).value, 'disable_non_proxied_udp', 'turning the choice off leaves the Proxy requirement');
  assert.equal((await d.reconcile('proxy_only')).value, 'proxy_only');
  assert.equal((await d.setProxyActive(false)).value, 'proxy_only', 'the choice outlives the Proxy module');
  assert.equal((await d.reconcile('system')).status, 'inactive');
  const h = fixture({ firefox: true }), e = new WebRtcNetworkController(h.api);
  await e.setProxyActive(true); assert.equal((await e.reconcile('proxy_only')).value, 'proxy_only'); assert.equal((await e.reconcile('default_public_interface_only')).value, 'disable_non_proxied_udp');
});

test('a refused choice does not consume the one-time release of a later System choice', async () => {
  const f = fixture(), c = new WebRtcNetworkController(f.api);
  await c.reconcile('proxy_only'); assert.deepEqual(modifications(f), []);
  const system = await c.reconcile('system');
  assert.equal(system.status, 'inactive'); assert.deepEqual(modifications(f), [['clear', { scope: 'regular' }]], 'System still releases a possibly stale layer once, as on a fresh start');
});
