import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createDefaultProxyConfiguration, PROXY_STORAGE_KEY } from '../../apps/production-extension/proxy-shared.js';
import { installProxyService } from '../../apps/production-extension/proxy-service.js';
import { createProxyClient } from '../../apps/production-extension/proxy-client.js';

function event() { const list = new Set(); return { addListener(fn) { list.add(fn); }, removeListener(fn) { list.delete(fn); }, emit(value) { return [...list].map(fn => fn(value)); } }; }
function ports(name, sender) {
  const a = { name, sender, onMessage: event(), onDisconnect: event() }, b = { name, sender, onMessage: event(), onDisconnect: event() };
  let closed = false;
  a.postMessage = value => { if (!closed) queueMicrotask(() => b.onMessage.emit(structuredClone(value))); };
  b.postMessage = value => { if (!closed) queueMicrotask(() => a.onMessage.emit(structuredClone(value))); };
  a.disconnect = b.disconnect = () => { if (!closed) { closed = true; a.onDisconnect.emit(); b.onDisconnect.emit(); } };
  return [a, b];
}
async function reviewFixture({ firefox = false, failOverlay = false } = {}) {
  const config = createDefaultProxyConfiguration();
  config.profiles = [{ id: 'plain', name: 'Plain', type: 'socks5', host: '192.0.2.5', port: 1080, native: false }, { id: 'vault', name: 'Vault', type: 'socks5', host: '192.0.2.6', port: 1080, native: true }];
  config.selectedId = 'plain';
  let setting = { mode: 'direct' }, control = 'controllable_by_this_extension';
  const nativeOps = [], operations = [];
  const data = { [PROXY_STORAGE_KEY]: config };
  const api = {
    runtime: { id: 'review', getURL: path => (firefox ? 'moz-extension://' : 'chrome-extension://') + 'review/' + path, onConnect: event(), onStartup: event(),
      connect({ name }) { const [a, b] = ports(name, { id: 'review', url: this.getURL('options.html') }); this.onConnect.emit(b); return a; },
      connectNative() { const [a, b] = ports('native'); b.onMessage.addListener(request => { nativeOps.push(request.op); const result = request.op === 'hello' ? { version: 1, capabilities: { socks5: true, vless: true, openvpn: true, vault: true } } : request.op === 'connect' ? { profileId: request.profileId, host: '127.0.0.1', port: 32225 } : { disconnected: true }; b.postMessage({ v: 1, id: request.id, ok: true, result }); }); return a; },
    },
    permissions: { async contains() { return true; } },
    storage: { local: { async get(key) { return { [key]: data[key] }; }, async set(value) { Object.assign(data, structuredClone(value)); } } },
    proxy: { onRequest: event(), onProxyError: event(), onError: event(), settings: { onChange: event(), async get() { return { value: structuredClone(setting), levelOfControl: control }; }, async set(value) { setting = structuredClone(value.value); control = 'controlled_by_this_extension'; operations.push(setting); }, async clear() { setting = { mode: 'direct' }; control = 'controllable_by_this_extension'; } } },
  };
  if (firefox) api.runtime.getBrowserInfo = async () => ({ version: '138' });
  const env = { crypto: webcrypto, location: { href: api.runtime.getURL('options.html') } }; env.top = env;
  const service = installProxyService(api, { env, privacyOverlay: { async setActive(active) { if (active && failOverlay) { const error = new Error('privacy-conflict'); error.code = 'privacy-conflict'; throw error; } return { status: active ? 'applied' : 'inactive' }; } } });
  const client = createProxyClient(api, { env }); await service.ready;
  return { api, service, client, nativeOps, operations, get setting() { return setting; }, close() { client.dispose(); service.dispose(); } };
}

test('review: first activation privacy failure retains mandatory closed Chrome route', async () => {
  const fixture = await reviewFixture({ failOverlay: true });
  try {
    await assert.rejects(fixture.client.connect('plain'));
    assert.equal(fixture.service.snapshot().configuration.enabled, true);
    assert.equal(fixture.setting.mode, 'pac_script');
    assert.equal(fixture.setting.pacScript.mandatory, true);
    assert.match(fixture.setting.pacScript.data, /SOCKS5 127\.0\.0\.1:9/);
    assert.doesNotMatch(fixture.setting.pacScript.data, /SOCKS5 192\.0\.2\.5/);
  } finally { fixture.close(); }
});

test('review: native to direct profile transition retires the previous relay', async () => {
  const fixture = await reviewFixture();
  try {
    await fixture.client.connect('vault');
    const before = fixture.nativeOps.length;
    await fixture.client.connect('plain');
    assert.deepEqual(fixture.nativeOps.slice(before), ['disconnect']);
    assert.match(fixture.setting.pacScript.data, /SOCKS5 192\.0\.2\.5:1080/);
    assert.equal(fixture.service.snapshot().status.state, 'connected');
  } finally { fixture.close(); }
});

test('review: Firefox native proxy error marks the route blocked and preserves terminal null', async () => {
  const fixture = await reviewFixture({ firefox: true });
  try {
    await fixture.client.connect('plain');
    fixture.api.proxy.onError.emit({ message: 'PRIVATE-URL-CANARY' });
    const snapshot = fixture.service.snapshot();
    assert.equal(snapshot.status.state, 'blocked');
    assert.equal(snapshot.status.code, 'proxy-error');
    assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE-URL-CANARY/);
    const [pending] = fixture.api.proxy.onRequest.emit({ url: 'https://owned.invalid/' });
    const decision = await pending;
    assert.equal(decision[0].proxyDNS, true);
    assert.equal(decision[1], null);
  } finally { fixture.close(); }
});
