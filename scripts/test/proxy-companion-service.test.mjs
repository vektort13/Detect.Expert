// ADR-070 round 5: the extension's proxy service and client driven against the BUILT companion over its real native-messaging frames.
// Owned loopback fakes only (an origin, forward proxies), an isolated vault (APPDATA of a temporary directory), no browser. It proves
// the wire the extension speaks is the wire the companion accepts (strict field sets, hello capabilities, save/check/delete of a
// temporary record) and that the failure codes arrive as the UI expects them. Set DETECT_PROXY_COMPANION_EXE to test another build.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import http from 'node:http';
import { webcrypto } from 'node:crypto';
import { installProxyService } from '../../apps/production-extension/proxy-service.js';
import { createProxyClient } from '../../apps/production-extension/proxy-client.js';
import { startOwnedHttpProxy, ephemeralCertificate } from './proxy-http-fixture.mjs';

const root = resolve(import.meta.dirname, '../..');
const exe = process.env.DETECT_PROXY_COMPANION_EXE ?? join(root, 'release/proxy-native/windows-amd64/detect-expert-proxy.exe');
const skip = process.platform !== 'win32' ? 'the companion is built for Windows' : !existsSync(exe) ? 'build the companion first: node scripts/build-proxy-companion.mjs' : false;
const caller = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/';
function event() { const listeners = new Set(); return { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn), emit: (...args) => [...listeners].map(fn => fn(...args)) }; }
function pair(name, sender) { const a = { name, sender, onMessage: event(), onDisconnect: event() }, b = { name, sender, onMessage: event(), onDisconnect: event() }; let closed = false; a.postMessage = value => { if (closed) throw new Error('closed'); queueMicrotask(() => b.onMessage.emit(structuredClone(value))); }; b.postMessage = value => { if (closed) throw new Error('closed'); queueMicrotask(() => a.onMessage.emit(structuredClone(value))); }; a.disconnect = b.disconnect = () => { if (!closed) { closed = true; a.onDisconnect.emit(); b.onDisconnect.emit(); } }; return [a, b]; }

// The real companion process behind the port shape runtime.connectNative returns. Messages are 4-byte little-endian length frames.
function companionPort(run, data, log) {
  const base = join(run, 'host'); mkdirSync(base, { recursive: true });
  copyFileSync(exe, join(base, 'detect-expert-proxy.exe')); writeFileSync(join(base, 'allowed-callers.json'), JSON.stringify([caller]));
  const child = spawn(join(base, 'detect-expert-proxy.exe'), [caller], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, APPDATA: data } });
  const onMessage = event(), onDisconnect = event();
  let pending = Buffer.alloc(0), closed = false;
  child.stderr.resume();
  child.stdout.on('data', data => {
    pending = Buffer.concat([pending, data]);
    while (pending.length >= 4) {
      const size = pending.readUInt32LE();
      if (pending.length < 4 + size) return;
      const message = JSON.parse(pending.subarray(4, 4 + size)); pending = pending.subarray(4 + size);
      log.push({ in: message.ok === true ? 'ok' : 'error', code: message.error?.code }); onMessage.emit(message);
    }
  });
  child.on('exit', () => { if (!closed) { closed = true; onDisconnect.emit(); } });
  return {
    onMessage, onDisconnect,
    postMessage(value) { log.push({ out: value.op, keys: Object.keys(value).sort(), ...(value.endpoint ? { endpointKeys: Object.keys(value.endpoint).sort(), endpointType: value.endpoint.type } : {}) }); const body = Buffer.from(JSON.stringify(value)), header = Buffer.alloc(4); header.writeUInt32LE(body.length); child.stdin.write(Buffer.concat([header, body])); },
    disconnect() { closed = true; child.stdin.end(); },
    async stop() { closed = true; child.stdin.end(); let timer; await Promise.race([once(child, 'exit'), new Promise(done => { timer = setTimeout(done, 3000); })]); clearTimeout(timer); if (child.exitCode === null) child.kill(); },
  };
}

async function harness() {
  const run = mkdtempSync(join(tmpdir(), 'detect-proxy-service-')), log = [], data = {}, ports = [];
  let setting = { mode: 'direct' }, level = 'controllable_by_this_extension';
  const api = { runtime: { id: 'owned', getURL: path => 'chrome-extension://owned/' + path, onConnect: event(), onStartup: event(),
    connect({ name }) { const [client, server] = pair(name, { id: 'owned', url: this.getURL('options.html'), origin: 'chrome-extension://owned' }); api.runtime.onConnect.emit(server); return client; },
    connectNative() { const port = companionPort(join(run, 'p' + ports.length), join(run, 'data'), log); ports.push(port); return port; } },
    permissions: { async contains() { return true; }, async request() { return true; } },
    storage: { local: { async get(key) { return { [key]: structuredClone(data[key]) }; }, async set(value) { Object.assign(data, structuredClone(value)); } } },
    proxy: { settings: { async get() { return { value: structuredClone(setting), levelOfControl: level }; }, async set(details) { setting = structuredClone(details.value); level = 'controlled_by_this_extension'; }, async clear() { setting = { mode: 'direct' }; level = 'controllable_by_this_extension'; } }, onProxyError: event(), onRequest: event() } };
  const env = { location: { href: api.runtime.getURL('options.html') }, crypto: webcrypto }; env.top = env;
  const service = installProxyService(api, { env, nativeTimeout: 30000, privacyOverlay: { async setActive(active) { return { status: active ? 'applied' : 'inactive' }; } } });
  const client = createProxyClient(api, { env });
  return { api, service, client, log, data, appData: join(run, 'data'), get setting() { return setting; }, async cleanup() { client.dispose(); service.dispose(); for (const port of ports) await port.stop(); rmSync(run, { recursive: true, force: true }); } };
}
// The companion's DPAPI vault files (a record is written only by a save).
function vaultFiles(dir) { const found = []; const walk = folder => { for (const name of existsSync(folder) ? readdirSync(folder) : []) { const path = join(folder, name); if (statSync(path).isDirectory()) walk(path); else if (name.endsWith('.dpapi')) found.push(path); } }; walk(dir); return found; }
// The real companion without the extension's service in between: one request, one answer.
async function rawCompanion() {
  const run = mkdtempSync(join(tmpdir(), 'detect-proxy-raw-')), log = [], port = companionPort(join(run, 'p0'), join(run, 'data'), log), waiting = new Map();
  let sequence = 0;
  port.onMessage.addListener(message => { const done = waiting.get(message.id); if (done) { waiting.delete(message.id); done(message); } });
  return { call: body => new Promise(resolve => { const id = 'raw-' + (++sequence); waiting.set(id, resolve); port.postMessage({ v: 1, id, ...body }); }), async stop() { await port.stop(); rmSync(run, { recursive: true, force: true }); } };
}
// The checked destination: an owned origin that answers with an exit IP, reachable only under names no resolver knows.
async function origin() {
  const server = http.createServer((request, response) => { request.resume(); response.setHeader('Content-Type', 'application/json'); response.setHeader('Connection', 'close'); response.end('{"ip":"198.51.100.17"}'); });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  return { port: server.address().port, close: () => new Promise(done => { server.closeAllConnections(); server.close(done); }) };
}
const NAMES = new Set(['onlyproxy.proxy.invalid']);
const target = port => 'http://onlyproxy.proxy.invalid:' + port + '/ip';

test('hello advertises http and https, and the extension reads them as supported', { skip }, async () => {
  const h = await harness();
  try {
    const host = (await h.client.hostStatus()).host;
    assert.equal(host.available, true); assert.equal(host.capabilities.http, true); assert.equal(host.capabilities.https, true); assert.equal(host.capabilities.socks5, true);
  } finally { await h.cleanup(); }
});

test('a login-free HTTP profile is checked through a typed diagnose endpoint: the exit IP arrives, exact codes stay exact and no vault write happens', { skip }, async () => {
  const h = await harness(), site = await origin();
  const open = await startOwnedHttpProxy({ originPort: site.port, allowedHosts: NAMES });
  try {
    const saved = await h.client.saveProfile({ name: 'Open HTTP', type: 'http', host: '127.0.0.1', port: open.port });
    const id = saved.configuration.profiles[0].id; assert.equal(saved.configuration.profiles[0].native, false);
    const passed = await h.client.checkProfile({ id, url: target(site.port) });
    assert.deepEqual(passed.diagnostic, { state: 'pass', reachable: true, remoteDns: true, tlsVerified: false, httpStatus: 200, ip: '198.51.100.17', elapsedMs: passed.diagnostic.elapsedMs });
    assert.ok(open.hits('onlyproxy.proxy.invalid', 'CONNECT').length >= 1, 'the proxy was dialled by the companion with the destination name');
    const denied = await h.client.checkProfile({ id, url: 'http://forbidden.proxy.invalid:' + site.port + '/ip' });
    assert.equal(denied.diagnostic.state, 'fail'); assert.equal(denied.diagnostic.code, 'proxy-denied'); assert.equal(denied.diagnostic.phase, 'proxy');
    // Over the real frames: two diagnose requests whose endpoint has exactly the keys host, port and type, and no vault operation at all.
    const sent = h.log.filter(item => item.out && item.out !== 'hello');
    assert.deepEqual(sent.map(item => item.out), ['diagnose', 'diagnose']); for (const item of sent) { assert.deepEqual(item.keys, ['endpoint', 'id', 'op', 'url', 'v']); assert.deepEqual(item.endpointKeys, ['host', 'port', 'type']); assert.equal(item.endpointType, 'http'); }
    assert.equal(h.log.some(item => item.in === 'error' && item.code === 'invalid-input'), false, 'the companion rejected nothing for a shape reason');
    assert.deepEqual(vaultFiles(h.appData), [], 'the companion wrote no vault record');
    if (h.data['proxy-vault-state:v1']) assert.deepEqual(h.data['proxy-vault-state:v1'].cleanup, [], 'and the extension journaled nothing');
    assert.doesNotMatch(JSON.stringify(h.data), /198\.51\.100\.17|onlyproxy|c-[0-9a-f]{8}-/);
    // The detector can fail: a profile with a login does write a record.
    await h.client.saveProfile({ name: 'Login', type: 'http', host: '127.0.0.1', port: open.port, username: 'alice', password: 'secret-pass' });
    assert.equal(vaultFiles(h.appData).length, 1, 'a saved login is what the vault is for');
  } finally { await open.stop(); await site.close(); await h.cleanup(); }
});

test('the decoder takes exactly host, port and type: another key is invalid-input at the parse phase, which is also what a companion without the type key says; an unknown type is refused at the endpoint phase', { skip }, async () => {
  const raw = await rawCompanion(), site = await origin();
  try {
    const url = target(site.port), base = { host: '127.0.0.1', port: 8080 };
    for (const [what, endpoint, phase] of [
      ['credentials', { type: 'http', ...base, username: 'u', password: 'p' }, 'parse'], ['uri', { type: 'https', ...base, uri: 'x' }, 'parse'], ['config', { type: 'http', ...base, config: 'client' }, 'parse'],
      ['another key', { type: 'http', ...base, scheme: 'http' }, 'parse'], ['an empty type', { type: '', ...base }, 'parse'], ['vless', { type: 'vless', ...base }, 'endpoint'], ['socks4', { type: 'socks4', ...base }, 'endpoint'], ['an upper-case type', { type: 'HTTP', ...base }, 'endpoint'],
    ]) {
      const answer = await raw.call({ op: 'diagnose', url, endpoint });
      assert.equal(answer.ok, false, what); assert.deepEqual([answer.error.code, answer.error.phase], ['invalid-input', phase], what);
    }
    // A well-formed typed endpoint with nothing listening is a fixed connection answer, not a shape error.
    const refused = await raw.call({ op: 'diagnose', url, endpoint: { type: 'http', host: '127.0.0.1', port: 9 } });
    assert.equal(refused.ok, false); assert.notEqual(refused.error.code, 'invalid-input');
  } finally { await site.close(); await raw.stop(); }
});

test('a proxy that wants a login: none configured is auth-required, a wrong one auth-failed, the right one passes; Connect verifies none of it', { skip }, async () => {
  const h = await harness(), site = await origin();
  const walled = await startOwnedHttpProxy({ originPort: site.port, allowedHosts: NAMES, credentials: { username: 'GOOD-USER', password: 'GOOD:PASS' } });
  try {
    const anonymous = (await h.client.saveProfile({ name: 'No login', type: 'http', host: '127.0.0.1', port: walled.port })).configuration.profiles[0];
    assert.equal((await h.client.checkProfile({ id: anonymous.id, url: target(site.port) })).diagnostic.code, 'auth-required');
    const wrong = (await h.client.saveProfile({ name: 'Wrong', type: 'http', host: '127.0.0.1', port: walled.port, username: 'GOOD-USER', password: 'WRONG' })).configuration.profiles.find(profile => profile.native);
    const failed = (await h.client.checkProfile({ id: wrong.id, url: target(site.port) })).diagnostic; assert.equal(failed.code, 'auth-failed'); assert.equal(failed.phase, 'auth');
    const right = (await h.client.saveProfile({ name: 'Right', type: 'http', host: '127.0.0.1', port: walled.port, username: 'GOOD-USER', password: 'GOOD:PASS' })).configuration.profiles.find(profile => profile.name === 'Right');
    assert.equal(right.native, true); assert.equal((await h.client.checkProfile({ id: right.id, url: target(site.port) })).diagnostic.state, 'pass');
    assert.doesNotMatch(JSON.stringify(h.data), /GOOD-USER|GOOD:PASS|WRONG/);
    // Connect only probes the proxy: wrong credentials still connect, and the login is found out by the first request through the relay.
    const connected = await h.client.connect(wrong.id); assert.equal(connected.status.state, 'connected'); assert.match(h.setting.pacScript.data, /"SOCKS5 127\.0\.0\.1:\d+"/);
    const analysed = await h.client.diagnose(target(site.port)).then(() => null, error => error);
    assert.ok(analysed, 'the analyzer fails'); assert.equal(analysed.code, 'proxy-denied', 'through the relay a refused login reaches the browser side as the SOCKS5 "denied" reply');
    await h.client.disconnect(); await h.client.connect(right.id);
    assert.equal((await h.client.diagnose(target(site.port))).diagnostic.state, 'pass');
  } finally { await walled.stop(); await site.close(); await h.cleanup(); }
});

test('an HTTPS proxy is verified against the system roots: an owned certificate is a TLS failure, never silently accepted', { skip }, async () => {
  const h = await harness(), site = await origin(), certificate = ephemeralCertificate('127.0.0.1');
  const secure = await startOwnedHttpProxy({ originPort: site.port, allowedHosts: NAMES, tls: { pfx: certificate.pfx, passphrase: certificate.passphrase } });
  try {
    const saved = (await h.client.saveProfile({ name: 'TLS box', type: 'https', host: '127.0.0.1', port: secure.port })).configuration.profiles[0];
    const result = (await h.client.checkProfile({ id: saved.id, url: target(site.port) })).diagnostic;
    assert.deepEqual([result.state, result.code, result.phase], ['fail', 'tls-failed', 'tls']);
    assert.equal(secure.log.length, 0, 'no request was sent over a connection whose certificate failed');
  } finally { await secure.stop(); await site.close(); await h.cleanup(); }
});

test('a proxy that is not there gives a fixed connection code and nothing is stored', { skip }, async () => {
  const h = await harness(), site = await origin();
  const gone = await startOwnedHttpProxy({ originPort: site.port, allowedHosts: NAMES }); const port = gone.port; await gone.stop();
  try {
    const saved = (await h.client.saveProfile({ name: 'Gone', type: 'http', host: '127.0.0.1', port })).configuration.profiles[0];
    const result = (await h.client.checkProfile({ id: saved.id, url: target(site.port) })).diagnostic;
    assert.equal(result.state, 'fail'); assert.ok(['connection-refused', 'connection-failed', 'timeout'].includes(result.code), result.code);
    assert.deepEqual(vaultFiles(h.appData), []); if (h.data['proxy-vault-state:v1']) assert.deepEqual(h.data['proxy-vault-state:v1'].cleanup, []);
  } finally { await site.close(); await h.cleanup(); }
});
