// ADR-070/107 round 5: HTTP and HTTPS profiles, the user's country tag and the companion capability gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { createDefaultProxyConfiguration, validateProxyConfiguration, exportProxyConfiguration, validateProxyProfileInput, validateProxyBundle, validateProxyConnection, buildProxyPac, buildProxyInfo, proxyCountry, proxyNeedsNative, PROXY_SAFE_CODES, PROXY_TYPES, PROXY_DIRECT_TYPES, PROXY_STORAGE_KEY } from '../../apps/production-extension/proxy-shared.js';
import { installProxyService } from '../../apps/production-extension/proxy-service.js';
import { createProxyClient } from '../../apps/production-extension/proxy-client.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const NL = String.fromCharCode(10);
function event() { const listeners = new Set(); return { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn), emit: (...args) => [...listeners].map(fn => fn(...args)), get size() { return listeners.size; } }; }
function pair(name, sender) { const a = { name, sender, onMessage: event(), onDisconnect: event() }, b = { name, sender, onMessage: event(), onDisconnect: event() }; let closed = false; a.postMessage = value => { if (closed) throw new Error('closed'); queueMicrotask(() => b.onMessage.emit(structuredClone(value))); }; b.postMessage = value => { if (closed) throw new Error('closed'); queueMicrotask(() => a.onMessage.emit(structuredClone(value))); }; a.disconnect = b.disconnect = () => { if (!closed) { closed = true; a.onDisconnect.emit(); b.onDisconnect.emit(); } }; return [a, b]; }
// capabilities: what the fake companion answers to hello. The default is a current companion; `legacy` is the one before round 5.
const CURRENT = { socks5: true, http: true, https: true, vless: true, openvpn: true, vault: true };
const LEGACY = { socks5: true, vless: true, openvpn: true, vault: true };
function fixture({ firefox = false, initial = undefined, capabilities = CURRENT, nativeHandler = null, vaultState = undefined } = {}) {
  const data = { ...(initial === undefined ? {} : { [PROXY_STORAGE_KEY]: structuredClone(initial) }), ...(vaultState === undefined ? {} : { 'proxy-vault-state:v1': structuredClone(vaultState) }) }, writes = [], nativeMessages = [], operations = [], vault = new Map();
  let activeNative = null;
  let setting = { mode: 'direct' }, level = 'controllable_by_this_extension';
  const api = { runtime: { id: 'owned', getURL: path => (firefox ? 'moz-extension://owned/' : 'chrome-extension://owned/') + path, onConnect: event(), onStartup: event(),
    connect({ name }) { const [client, server] = pair(name, { id: 'owned', url: this.getURL('options.html'), origin: (firefox ? 'moz-extension://owned' : 'chrome-extension://owned') }); api.runtime.onConnect.emit(server); return client; },
    connectNative() { const [client, server] = pair('native'); server.onMessage.addListener(message => { nativeMessages.push(message); const respond = result => server.postMessage({ v: 1, id: message.id, ok: true, result }); if (nativeHandler) { const handled = nativeHandler(message, respond, server); if (handled !== false) return; }
      if (message.op === 'hello') respond({ version: 1, capabilities }); else if (message.op === 'save') { vault.set(message.profileId, structuredClone(message.profile)); respond({ profileId: message.profileId, summary: { type: message.profile.type, host: message.profile.host ?? 'relay.example', port: message.profile.port ?? 443 } }); } else if (message.op === 'connect') { activeNative = message.profileId; respond({ profileId: message.profileId, host: '127.0.0.1', port: 32123 }); } else if (message.op === 'disconnect') { activeNative = null; respond({}); } else if (message.op === 'status') respond({ state: activeNative ? 'connected' : 'off', profileId: activeNative, diagnostic: null }); else if (message.op === 'delete') { vault.delete(message.profileId); respond({ deleted: true }); } else if (message.op === 'check' && !vault.has(message.profileId)) server.postMessage({ v: 1, id: message.id, ok: false, error: { code: 'profile-not-found', phase: 'vault', retryable: false } }); else if (message.op === 'diagnose' || message.op === 'check') respond({ reachable: true, remoteDns: true, tlsVerified: true, httpStatus: 200, ip: '198.51.100.17', elapsedMs: 21 }); else respond({}); }); return client; } },
    permissions: { async contains() { return true; }, async request() { return true; } },
    storage: { local: { async get(key) { return { [key]: structuredClone(data[key]) }; }, async set(value) { writes.push(structuredClone(value)); Object.assign(data, structuredClone(value)); } } },
    proxy: { settings: { async get() { return { value: structuredClone(setting), levelOfControl: level }; }, async set(details) { operations.push(['set', structuredClone(details)]); setting = structuredClone(details.value); level = 'controlled_by_this_extension'; }, async clear() { operations.push(['clear']); setting = { mode: 'direct' }; level = 'controllable_by_this_extension'; } }, onProxyError: event(), onRequest: event() } };
  if (firefox) api.runtime.getBrowserInfo = async () => ({ version: '138' });
  const env = { location: { href: api.runtime.getURL('options.html') }, crypto: webcrypto }; env.top = env;
  const service = installProxyService(api, { env, privacyOverlay: { async setActive(active) { return { status: active ? 'applied' : 'inactive' }; } } });
  const changes = [], client = createProxyClient(api, { env, onChange: snapshot => changes.push(snapshot) });
  return { api, service, client, data, writes, nativeMessages, operations, changes, vault, get setting() { return setting; }, cleanup() { client.dispose(); service.dispose(); } };
}
const configWith = (profiles, extra = {}) => ({ ...createDefaultProxyConfiguration(), profiles, selectedId: profiles[0]?.id ?? null, protectWebRTC: false, disablePrediction: false, ...extra });
const direct = (type, extra = {}) => ({ id: type + '-direct', name: type.toUpperCase() + ' fixture', type, host: '192.0.2.10', port: type === 'https' ? 443 : type === 'http' ? 8080 : 1080, native: false, ...extra });
const code = value => error => error.code === value;
function pacRoute(config, scheme) { const context = vm.createContext({}); vm.runInContext(buildProxyPac(config, { host: '192.0.2.10', port: 8080, scheme }), context); return vm.runInContext('FindProxyForURL("https://remote.example/", "remote.example")', context); }

test('the fixed codes of the HTTP and HTTPS release are part of the safe set and the kinds are exactly five', () => {
  for (const value of ['proxy-denied', 'network-unreachable', 'host-unreachable']) assert.ok(PROXY_SAFE_CODES.includes(value), value);
  assert.equal(new Set(PROXY_SAFE_CODES).size, PROXY_SAFE_CODES.length);
  assert.deepEqual([...PROXY_TYPES], ['socks5', 'http', 'https', 'vless', 'openvpn']); assert.deepEqual([...PROXY_DIRECT_TYPES], ['socks5', 'http', 'https']);
});

test('HTTP and HTTPS inputs follow the SOCKS5 shape: host, port, a login only as a pair, no colon in the user name, no stray keys', () => {
  for (const type of ['http', 'https']) {
    assert.deepEqual(validateProxyProfileInput({ name: ' P ', type, host: 'Proxy.Example', port: 8080 }), { name: 'P', type, host: 'proxy.example', port: 8080, username: '', password: '' });
    assert.deepEqual(validateProxyProfileInput({ name: 'P', type, host: '[2001:db8::1]', port: 443, username: 'user', password: 'pa:ss@word' }), { name: 'P', type, host: '2001:db8::1', port: 443, username: 'user', password: 'pa:ss@word' });
    for (const bad of [{ username: 'user' }, { password: 'only' }, { username: 'a:b', password: 'c' }, { username: 'u'.repeat(256), password: 'p' }, { username: 'u', password: 'p'.repeat(256) }, { username: 'u\r', password: 'p' }, { uri: 'vless://x' }, { config: 'client' }, { port: 0 }, { port: 65536 }, { host: 'a b' }, { country: 'ZZ' }, { country: 'de' }, { country: 'DEU' }, { extra: 1 }]) assert.throws(() => validateProxyProfileInput({ name: 'P', type, host: 'proxy.example', port: 8080, ...bad }), code('invalid-input'), type + ' ' + JSON.stringify(bad));
  }
  // SOCKS5 keeps RFC 1929: a colon in the user name is legal there.
  assert.equal(validateProxyProfileInput({ name: 'P', type: 'socks5', host: 'proxy.example', port: 1080, username: 'a:b', password: 'c' }).username, 'a:b');
  assert.throws(() => validateProxyProfileInput({ name: 'P', type: 'ftp', host: 'proxy.example', port: 21 }), code('invalid-input'));
  assert.deepEqual([proxyNeedsNative({ type: 'http', username: '', password: '' }), proxyNeedsNative({ type: 'https', username: 'u', password: 'p' }), proxyNeedsNative({ type: 'socks5', username: '', password: '' }), proxyNeedsNative({ type: 'vless' }), proxyNeedsNative({ type: 'openvpn', username: '', password: '' })], [false, true, false, true, true]);
});

test('the country tag accepts only an uppercase code of the offline region table, as input; null and absent mean none', () => {
  assert.equal(proxyCountry('DE'), 'DE'); assert.equal(proxyCountry(null), null); assert.equal(proxyCountry(undefined), null);
  for (const bad of ['', 'de', 'D', 'DEU', 'ZZ', 'XX', '1A', ' DE', 'DE ', 5, {}, true, ['DE']]) assert.throws(() => proxyCountry(bad), code('invalid-input'), String(bad));
  for (const type of PROXY_TYPES) {
    const input = type === 'vless' ? { uri: 'vless://01234567-89ab-cdef-0123-456789abcdef@relay.example:443?security=tls' } : type === 'openvpn' ? { config: 'client' + NL + 'remote vpn.example 1194' + NL } : { host: 'proxy.example', port: 1080 };
    assert.equal(validateProxyProfileInput({ name: 'P', type, country: 'JP', ...input }).country, 'JP', type);
    assert.equal(Object.hasOwn(validateProxyProfileInput({ name: 'P', type, country: null, ...input }), 'country'), false, type);
  }
});

test('stored metadata keeps an optional country: old files load unchanged, a shape error rejects, an unknown well-formed code is dropped', () => {
  const old = configWith([direct('socks5')]);
  assert.equal(JSON.stringify(validateProxyConfiguration(old)), JSON.stringify(old)); assert.equal(exportProxyConfiguration(old).includes('country'), false);
  const tagged = configWith([direct('http', { country: 'US' }), direct('https', { country: null })]);
  const checked = validateProxyConfiguration(tagged);
  assert.equal(checked.profiles.find(profile => profile.type === 'http').country, 'US'); assert.equal(Object.hasOwn(checked.profiles.find(profile => profile.type === 'https'), 'country'), false);
  assert.match(exportProxyConfiguration(tagged), /"country": "US"/);
  assert.deepEqual(Object.keys(checked.profiles.find(profile => profile.type === 'http')), ['id', 'name', 'type', 'host', 'port', 'native', 'country']);
  // A later region table that no longer knows a code must not invalidate (and so block) a saved configuration: the tag is dropped.
  assert.equal(Object.hasOwn(validateProxyConfiguration(configWith([direct('http', { country: 'ZZ' })])).profiles[0], 'country'), false);
  for (const bad of ['de', 'D', 'DEU', 7, {}, false]) assert.throws(() => validateProxyConfiguration(configWith([direct('http', { country: bad })])), code('invalid-config'), String(bad));
  assert.throws(() => validateProxyConfiguration(configWith([direct('http', { extra: 1 })])), code('invalid-config'));
});

test('a profile that the browser cannot reach alone must be native; HTTP and HTTPS may be either', () => {
  assert.equal(validateProxyConfiguration(configWith([direct('http'), direct('https')])).profiles.length, 2);
  assert.equal(validateProxyConfiguration(configWith([direct('http', { native: true })])).profiles[0].native, true);
  assert.throws(() => validateProxyConfiguration(configWith([{ ...direct('vless'), native: false }])), code('invalid-config'));
  assert.throws(() => validateProxyConfiguration(configWith([direct('http', { host: null })])), code('invalid-config'));
  assert.throws(() => validateProxyConfiguration(configWith([direct('https', { native: true, port: null })])), code('invalid-config'));
});

test('the PAC names the right directive per kind, carries no DIRECT after it and keeps IPv6 hosts bracketed', () => {
  const config = validateProxyConfiguration(configWith([direct('http')]));
  assert.equal(pacRoute(config, 'socks5'), 'SOCKS5 192.0.2.10:8080'); assert.equal(pacRoute(config, 'http'), 'PROXY 192.0.2.10:8080'); assert.equal(pacRoute(config, 'https'), 'HTTPS 192.0.2.10:8080');
  assert.match(buildProxyPac(config, { host: '2001:db8::1', port: 443, scheme: 'https' }), /"HTTPS \[2001:db8::1\]:443"/);
  assert.match(buildProxyPac(config, { host: '192.0.2.10', port: 1080 }), /"SOCKS5 192\.0\.2\.10:1080"/, 'an endpoint without a kind is the loopback SOCKS5 relay');
  for (const scheme of ['http', 'https', 'socks5']) assert.doesNotMatch(buildProxyPac(config, { host: '192.0.2.10', port: 8080, scheme }), /dnsResolve|isResolvable|; ?DIRECT/);
  for (const scheme of ['ftp', 'toString', 'constructor', 5, '']) assert.throws(() => buildProxyPac(config, { host: '192.0.2.10', port: 8080, scheme }), code('invalid-input'), String(scheme));
});

test('Firefox ProxyInfo: http and https carry no proxyDNS, socks stays remote-DNS, every shape has a short failover', () => {
  assert.deepEqual(buildProxyInfo({ host: '192.0.2.10', port: 8080, scheme: 'http' }), { type: 'http', host: '192.0.2.10', port: 8080, failoverTimeout: 1 });
  assert.deepEqual(buildProxyInfo({ host: '192.0.2.10', port: 443, scheme: 'https' }), { type: 'https', host: '192.0.2.10', port: 443, failoverTimeout: 1 });
  assert.deepEqual(buildProxyInfo({ host: '192.0.2.10', port: 1080 }), { type: 'socks', host: '192.0.2.10', port: 1080, proxyDNS: true, failoverTimeout: 1 });
  assert.throws(() => buildProxyInfo({ host: '192.0.2.10', port: 1080, scheme: 'direct' }), code('invalid-input'));
});

test('a direct HTTP or HTTPS profile is metadata only, never touches the companion and routes through its own PAC directive', async () => {
  for (const [type, directive] of [['http', 'PROXY'], ['https', 'HTTPS']]) {
    const f = fixture();
    try {
      const saved = await f.client.saveProfile({ name: 'Direct ' + type, type, host: '192.0.2.10', port: 8080, country: 'NL' });
      const profile = saved.configuration.profiles[0]; assert.equal(profile.native, false); assert.equal(profile.type, type); assert.equal(profile.country, 'NL');
      assert.equal(f.nativeMessages.length, 0, 'no companion for a login-free profile');
      const active = await f.client.connect(profile.id); assert.equal(active.status.state, 'connected'); assert.deepEqual(active.status.endpoint, { host: '192.0.2.10', port: 8080 });
      assert.equal(f.setting.pacScript.mandatory, true); assert.match(f.setting.pacScript.data, new RegExp('"' + directive + ' 192\\.0\\.2\\.10:8080"')); assert.doesNotMatch(f.setting.pacScript.data, /; ?DIRECT/);
      assert.equal(f.nativeMessages.length, 0);
      await f.client.disconnect(); assert.equal(f.operations.at(-1)[0], 'clear');
    } finally { f.cleanup(); }
  }
});

test('Firefox answers a direct HTTP or HTTPS profile with its own ProxyInfo and a terminal null, never DIRECT', async () => {
  for (const type of ['http', 'https']) {
    const f = fixture({ firefox: true, initial: configWith([direct(type)], { enabled: true }) });
    try {
      await f.service.ready;
      const [answer] = f.api.proxy.onRequest.emit({ url: 'https://remote.example/' });
      assert.deepEqual(await answer, [{ type, host: '192.0.2.10', port: type === 'https' ? 443 : 8080, failoverTimeout: 1 }, null]);
      assert.equal(f.operations.length, 0, 'Firefox does not use proxy.settings');
    } finally { f.cleanup(); }
  }
});

test('an HTTP profile with a login goes to the vault with exactly the wire profile, stays out of storage and connects through the loopback SOCKS5 relay', async () => {
  const f = fixture();
  try {
    const saved = await f.client.saveProfile({ name: 'Authenticated', type: 'http', host: '192.0.2.10', port: 8080, username: 'USER-CANARY', password: 'PASS:CANARY@1', country: 'FR' });
    const profile = saved.configuration.profiles[0]; assert.equal(profile.native, true); assert.equal(profile.country, 'FR'); assert.equal(profile.host, '192.0.2.10');
    const sent = f.nativeMessages.find(message => message.op === 'save');
    assert.deepEqual(sent.profile, { type: 'http', host: '192.0.2.10', port: 8080, username: 'USER-CANARY', password: 'PASS:CANARY@1' }, 'no name, id or country on the wire');
    for (const value of [f.data, f.changes, saved]) assert.doesNotMatch(JSON.stringify(value), /USER-CANARY|PASS:CANARY/);
    const active = await f.client.connect(profile.id); assert.equal(active.status.state, 'connected');
    assert.match(f.setting.pacScript.data, /"SOCKS5 127\.0\.0\.1:32123"/); assert.doesNotMatch(f.setting.pacScript.data, /"PROXY /);
    assert.equal(f.nativeMessages.some(message => message.op === 'connect' && message.profileId !== undefined && !('profile' in message)), true);
  } finally { f.cleanup(); }
});

test('an HTTPS profile with a login uses the same relay path and an unauthenticated replacement leaves the vault', async () => {
  const f = fixture();
  try {
    const saved = await f.client.saveProfile({ name: 'TLS', type: 'https', host: '192.0.2.11', port: 443, username: 'u', password: 'p' });
    const id = saved.configuration.profiles[0].id; assert.equal(f.nativeMessages.find(message => message.op === 'save').profile.type, 'https');
    await assert.rejects(f.client.saveProfile({ id, name: 'TLS', type: 'https', host: '192.0.2.99', port: 443 }), code('invalid-input'), 'dropping credentials silently is refused');
    const plain = await f.client.saveProfile({ id, name: 'TLS', type: 'https', host: '192.0.2.99', port: 443, username: '', password: '' });
    assert.equal(plain.configuration.profiles[0].native, false); assert.equal(plain.configuration.profiles[0].host, '192.0.2.99');
    assert.equal(f.nativeMessages.some(message => message.op === 'delete'), true, 'the superseded vault record is deleted');
  } finally { f.cleanup(); }
});

test('an older companion is recognised: no http/https capability refuses the save before anything is sent, and a check says so', async () => {
  const f = fixture({ capabilities: LEGACY });
  try {
    await assert.rejects(f.client.saveProfile({ name: 'Authenticated', type: 'http', host: '192.0.2.10', port: 8080, username: 'u', password: 'p' }), code('native-unsupported'));
    assert.equal(f.nativeMessages.some(message => message.op === 'save'), false);
    const direct1 = await f.client.saveProfile({ name: 'Direct', type: 'https', host: '192.0.2.10', port: 443 });
    const checked = await f.client.checkProfile({ id: direct1.configuration.profiles[0].id, url: 'https://example.test/' });
    assert.deepEqual(checked.diagnostic, { state: 'fail', code: 'native-unsupported' });
    assert.equal(f.nativeMessages.some(message => message.op === 'diagnose'), false);
    assert.equal((await f.client.hostStatus()).host.capabilities.http, false);
    // SOCKS5 against the same old companion is unchanged.
    const socks = await f.client.saveProfile({ name: 'Socks', type: 'socks5', host: '192.0.2.12', port: 1080 });
    assert.equal((await f.client.checkProfile({ id: socks.configuration.profiles.find(profile => profile.type === 'socks5').id, url: 'https://example.test/' })).diagnostic.state, 'pass');
  } finally { f.cleanup(); }
});

test('an unsupported-profile answer from a companion that advertised support still surfaces as that fixed code', async () => {
  const f = fixture({ nativeHandler(message, respond, server) { if (message.op === 'save') { server.postMessage({ v: 1, id: message.id, ok: false, error: { code: 'unsupported-profile', phase: 'parse', retryable: false, message: 'LEAK-CANARY' } }); return true; } return false; } });
  try {
    await assert.rejects(f.client.saveProfile({ name: 'A', type: 'http', host: '192.0.2.10', port: 8080, username: 'u', password: 'p' }), error => error.code === 'unsupported-profile' && error.phase === 'parse');
    assert.doesNotMatch(JSON.stringify(f.changes), /LEAK-CANARY/); assert.equal(f.service.snapshot().configuration.profiles.length, 0);
  } finally { f.cleanup(); }
});

test('hello capabilities pass through as booleans, the legacy four keys stay mandatory and a non-boolean http is a protocol error', async () => {
  for (const [capabilities, expected] of [[CURRENT, { http: true, https: true }], [LEGACY, { http: false, https: false }], [{ ...LEGACY, http: true }, { http: true, https: false }]]) {
    const f = fixture({ capabilities });
    try { const host = (await f.client.hostStatus()).host; assert.equal(host.available, true); assert.deepEqual([host.capabilities.http, host.capabilities.https], [expected.http, expected.https]); assert.equal(host.capabilities.socks5, true); } finally { f.cleanup(); }
  }
  for (const capabilities of [{ ...CURRENT, http: 'yes' }, { ...CURRENT, https: 1 }, { socks5: true, http: true, https: true, vless: true, openvpn: true }]) {
    const f = fixture({ capabilities });
    try { await assert.rejects(f.client.hostStatus(), code('native-protocol')); } finally { f.cleanup(); }
  }
});

test('a direct SOCKS5 profile keeps its two-field diagnose endpoint; a direct HTTP or HTTPS profile is named by type, host and port: nothing is saved, staged or journaled', async () => {
  const f = fixture();
  try {
    const profiles = [];
    for (const [type, port] of [['socks5', 1080], ['http', 8080], ['https', 443]]) profiles.push((await f.client.saveProfile({ name: type, type, host: '192.0.2.20', port })).configuration.profiles.find(profile => profile.type === type));
    const revision = f.service.snapshot().configuration.revision, writesBefore = f.writes.length;
    for (const profile of profiles) {
      const first = f.nativeMessages.length;
      assert.equal((await f.client.checkProfile({ id: profile.id, url: 'https://example.test/?token=PRIVATE-CANARY' })).diagnostic.state, 'pass', profile.type);
      const sent = f.nativeMessages.slice(first).filter(message => message.op !== 'hello');
      assert.deepEqual(sent.map(message => message.op), ['diagnose'], profile.type);
      assert.deepEqual(Object.keys(sent[0]).sort(), ['endpoint', 'id', 'op', 'url', 'v'], profile.type);
      assert.deepEqual(sent[0].endpoint, profile.type === 'socks5' ? { host: '192.0.2.20', port: 1080 } : { type: profile.type, host: '192.0.2.20', port: profile.port }, profile.type + ': only the keys type, host and port, and no type for SOCKS5');
      assert.equal(sent[0].url, 'https://example.test/?token=PRIVATE-CANARY');
    }
    assert.equal(f.vault.size, 0); assert.equal(f.nativeMessages.some(message => ['save', 'check', 'delete'].includes(message.op)), false, 'no vault operation of any kind');
    assert.equal(f.writes.length, writesBefore, 'a check writes nothing: no configuration, no journal'); assert.equal(f.service.snapshot().configuration.revision, revision);
    assert.doesNotMatch(JSON.stringify(f.data), /PRIVATE-CANARY|c-[0-9a-f]{8}-/);
  } finally { f.cleanup(); }
});

test('a failed typed check keeps its fixed code and phase and never shows companion text', async () => {
  const f = fixture({ nativeHandler(message, respond, server) {
    if (message.op === 'diagnose' && message.endpoint?.type) { server.postMessage({ v: 1, id: message.id, ok: false, error: { code: 'auth-required', phase: 'auth', retryable: false, message: 'LEAK-CANARY' } }); return true; }
    return false;
  } });
  try {
    const profile = (await f.client.saveProfile({ name: 'P', type: 'http', host: '192.0.2.20', port: 8080 })).configuration.profiles[0];
    const failed = await f.client.checkProfile({ id: profile.id, url: 'https://example.test/' });
    assert.deepEqual(failed.diagnostic, { state: 'fail', code: 'auth-required', phase: 'auth', retryable: false }); assert.doesNotMatch(JSON.stringify([failed, f.changes]), /LEAK-CANARY/);
    await f.client.connect(profile.id); await assert.rejects(f.client.diagnose('https://example.test/'), error => error.code === 'auth-required' && error.phase === 'auth');
    assert.equal(f.nativeMessages.some(message => ['save', 'check', 'delete'].includes(message.op)), false);
  } finally { f.cleanup(); }
});

test('a companion built before the typed endpoint rejects the type key: that reads as "update the companion", for HTTP and HTTPS only, and only for that answer', async () => {
  let answer = { code: 'invalid-input', phase: 'parse' };
  // Such a companion decodes every request strictly and answers any unknown key with invalid-input at the parse phase.
  const f = fixture({ initial: configWith([direct('http'), direct('https'), direct('socks5')]), nativeHandler(message, respond, server) {
    if (message.op === 'diagnose' && message.endpoint && Object.hasOwn(message.endpoint, 'type')) { server.postMessage({ v: 1, id: message.id, ok: false, error: { ...answer, retryable: false } }); return true; }
    return false;
  } });
  try {
    for (const type of ['http', 'https']) assert.deepEqual((await f.client.checkProfile({ id: type + '-direct', url: 'https://example.test/' })).diagnostic, { state: 'fail', code: 'native-unsupported' }, type);
    assert.equal((await f.client.checkProfile({ id: 'socks5-direct', url: 'https://example.test/' })).diagnostic.state, 'pass', 'a SOCKS5 profile never sends a type');
    await f.client.connect('http-direct'); await assert.rejects(f.client.diagnose('https://example.test/'), code('native-unsupported'));
    answer = { code: 'invalid-input', phase: 'endpoint' };
    assert.deepEqual((await f.client.checkProfile({ id: 'http-direct', url: 'https://example.test/' })).diagnostic, { state: 'fail', code: 'invalid-input', phase: 'endpoint', retryable: false }, 'another input error is not read as outdated');
    answer = { code: 'timeout', phase: 'parse' };
    assert.equal((await f.client.checkProfile({ id: 'https-direct', url: 'https://example.test/' })).diagnostic.code, 'timeout');
    assert.equal(f.nativeMessages.some(message => ['save', 'check', 'delete'].includes(message.op)), false);
  } finally { f.cleanup(); }
});

test('the active route is analysed according to its kind: direct SOCKS5 by its address, direct HTTP by type, host and port, a login profile through the running relay', async () => {
  const f = fixture({ initial: configWith([direct('http'), direct('socks5')]) });
  try {
    await f.client.connect('http-direct');
    assert.equal((await f.client.diagnose('https://example.test/')).diagnostic.state, 'pass');
    const typed = f.nativeMessages.filter(message => message.op === 'diagnose'); assert.equal(typed.length, 1); assert.deepEqual(typed[0].endpoint, { type: 'http', host: '192.0.2.10', port: 8080 });
    assert.equal(f.nativeMessages.some(message => ['save', 'check', 'delete'].includes(message.op)), false); assert.equal(f.vault.size, 0);
    await f.client.disconnect(); f.nativeMessages.length = 0; await f.client.connect('socks5-direct');
    assert.equal((await f.client.diagnose('https://example.test/')).diagnostic.state, 'pass'); assert.deepEqual(f.nativeMessages.find(message => message.op === 'diagnose').endpoint, { host: '192.0.2.10', port: 1080 });
  } finally { f.cleanup(); }
  const relay = fixture();
  try {
    const saved = await relay.client.saveProfile({ name: 'R', type: 'https', host: '192.0.2.60', port: 443, username: 'u', password: 'p' });
    await relay.client.connect(saved.configuration.profiles[0].id); relay.nativeMessages.length = 0;
    assert.equal((await relay.client.diagnose('https://example.test/')).diagnostic.state, 'pass');
    const sent = relay.nativeMessages.filter(message => message.op === 'diagnose'); assert.equal(sent.length, 1); assert.deepEqual(Object.keys(sent[0]).sort(), ['id', 'op', 'url', 'v'], 'no endpoint: the running relay is probed'); assert.equal(relay.nativeMessages.some(message => message.op === 'save'), false);
  } finally { relay.cleanup(); }
});

test('an older companion cannot check a direct HTTP profile and nothing is sent', async () => {
  const f = fixture({ capabilities: LEGACY, initial: configWith([direct('http')]) });
  try {
    assert.deepEqual((await f.client.checkProfile({ id: 'http-direct', url: 'https://example.test/' })).diagnostic, { state: 'fail', code: 'native-unsupported' });
    await f.client.connect('http-direct'); await assert.rejects(f.client.diagnose('https://example.test/'), code('native-unsupported'));
    assert.equal(f.nativeMessages.some(message => ['save', 'check', 'delete', 'diagnose'].includes(message.op)), false); assert.equal(f.vault.size, 0);
  } finally { f.cleanup(); }
});

test('country edits ride the metadata-only path: no companion, no reconnect, the connection untouched; null clears it; bad codes change nothing', async () => {
  const f = fixture();
  try {
    const saved = await f.client.saveProfile({ name: 'Authenticated', type: 'socks5', host: '192.0.2.30', port: 1080, username: 'u', password: 'p' });
    const profile = saved.configuration.profiles[0], before = f.nativeMessages.length, writes = f.writes.length;
    const tagged = await f.client.saveProfile({ id: profile.id, name: 'Authenticated', type: 'socks5', host: profile.host, port: profile.port, country: 'CA' });
    assert.equal(tagged.configuration.profiles[0].country, 'CA'); assert.equal(f.nativeMessages.length, before); assert.equal(f.writes.length, writes + 1);
    const kept = await f.client.saveProfile({ id: profile.id, name: 'Renamed', type: 'socks5', host: profile.host, port: profile.port });
    assert.equal(kept.configuration.profiles[0].country, 'CA', 'a rename without a country key keeps the saved tag');
    await assert.rejects(f.client.saveProfile({ id: profile.id, name: 'Renamed', type: 'socks5', host: profile.host, port: profile.port, country: 'ZZ' }), code('invalid-input'));
    assert.equal(f.service.snapshot().configuration.profiles[0].country, 'CA');
    const cleared = await f.client.saveProfile({ id: profile.id, name: 'Renamed', type: 'socks5', host: profile.host, port: profile.port, country: null });
    assert.equal(Object.hasOwn(cleared.configuration.profiles[0], 'country'), false);
    assert.equal(f.nativeMessages.length, before, 'the vault was never contacted by a tag edit');
  } finally { f.cleanup(); }
});

test('load() returns the tag of every profile for other tools, and a stored configuration without tags still loads byte-identical', async () => {
  const f = fixture({ initial: configWith([direct('socks5'), direct('http', { country: 'US' }), direct('https', { country: 'DE' })]) });
  try {
    const snapshot = await f.client.load();
    assert.deepEqual(snapshot.configuration.profiles.map(profile => [profile.type, profile.country ?? null]), [['http', 'US'], ['https', 'DE'], ['socks5', null]]);
    assert.equal(Object.hasOwn(snapshot.configuration.profiles.find(profile => profile.type === 'socks5'), 'country'), false);
  } finally { f.cleanup(); }
  const plain = fixture({ initial: configWith([direct('socks5')]) });
  try { assert.equal(JSON.stringify((await plain.client.load()).configuration), JSON.stringify(validateProxyConfiguration(configWith([direct('socks5')])))); } finally { plain.cleanup(); }
});

test('full exports carry the typed connection and the tag, validate as a bundle, and the companion record must match the saved endpoint', async () => {
  const records = new Map();
  const f = fixture({ nativeHandler(message, respond) { if (message.op === 'save') { records.set(message.profileId, structuredClone(message.profile)); respond({ profileId: message.profileId, summary: { type: message.profile.type, host: message.profile.host, port: message.profile.port } }); return true; } if (message.op === 'export') { respond({ profiles: message.profileIds.map(profileId => ({ profileId, profile: structuredClone(records.get(profileId)) })) }); return true; } return false; } });
  try {
    await f.client.saveProfile({ name: 'Plain', type: 'http', host: '192.0.2.40', port: 8080, country: 'JP' });
    const auth = (await f.client.saveProfile({ name: 'Auth', type: 'https', host: '192.0.2.41', port: 443, username: 'EXPORT-USER', password: 'EXPORT-PASS', country: 'KR' })).configuration.profiles.find(profile => profile.native);
    const all = await f.client.exportProfiles();
    assert.deepEqual(all.profiles.map(profile => [profile.type, profile.native, profile.country, profile.connection.username]).sort(), [['http', false, 'JP', ''], ['https', true, 'KR', 'EXPORT-USER']]);
    assert.deepEqual(validateProxyBundle(all), all);
    assert.deepEqual((await f.client.exportProfiles(auth.id)).profiles[0].connection, { type: 'https', host: '192.0.2.41', port: 443, username: 'EXPORT-USER', password: 'EXPORT-PASS' });
    assert.doesNotMatch(JSON.stringify(f.data), /EXPORT-USER|EXPORT-PASS/);
    assert.throws(() => validateProxyConnection({ id: 'x', name: 'x', type: 'http', host: '192.0.2.40', port: 8080, native: false }, { type: 'http', host: '192.0.2.99', port: 8080, username: '', password: '' }), code('native-protocol'));
    assert.throws(() => validateProxyConnection({ id: 'x', name: 'x', type: 'http', host: '192.0.2.40', port: 8080, native: false }, { type: 'http', host: '192.0.2.40', port: 8080, username: 'u', password: 'p' }), code('native-protocol'));
  } finally { f.cleanup(); }
});

test('switching the active selection between kinds re-points the browser: direct HTTP, then a relay, then direct HTTPS', async () => {
  const f = fixture();
  try {
    const http = (await f.client.saveProfile({ name: 'H', type: 'http', host: '192.0.2.50', port: 8080 })).configuration.profiles.find(profile => profile.type === 'http');
    const relay = (await f.client.saveProfile({ name: 'R', type: 'http', host: '192.0.2.51', port: 8080, username: 'u', password: 'p' })).configuration.profiles.find(profile => profile.native);
    const tls = (await f.client.saveProfile({ name: 'T', type: 'https', host: '192.0.2.52', port: 443 })).configuration.profiles.find(profile => profile.type === 'https');
    const config = (await f.client.load()).configuration; config.protectWebRTC = false; config.disablePrediction = false; await f.client.saveSettings(config);
    await f.client.connect(http.id); assert.match(f.setting.pacScript.data, /"PROXY 192\.0\.2\.50:8080"/);
    await f.client.connect(relay.id); assert.match(f.setting.pacScript.data, /"SOCKS5 127\.0\.0\.1:32123"/);
    await f.client.connect(tls.id); assert.match(f.setting.pacScript.data, /"HTTPS 192\.0\.2\.52:443"/); assert.equal(f.nativeMessages.filter(message => message.op === 'disconnect').length >= 1, true, 'the relay was closed before the direct endpoint was opened');
  } finally { f.cleanup(); }
});

test('checking a login-free HTTP or HTTPS profile needs no vault: a companion without one answers all the same', async () => {
  const f = fixture({ capabilities: { ...CURRENT, vault: false }, initial: configWith([direct('http'), direct('https')]) });
  try {
    for (const type of ['http', 'https']) assert.equal((await f.client.checkProfile({ id: type + '-direct', url: 'https://example.test/' })).diagnostic.state, 'pass', type);
    await f.client.connect('http-direct'); assert.equal((await f.client.diagnose('https://example.test/')).diagnostic.state, 'pass');
    assert.equal(f.nativeMessages.filter(message => message.op === 'diagnose').length, 3); assert.equal(f.nativeMessages.some(message => ['save', 'check', 'delete'].includes(message.op)), false);
  } finally { f.cleanup(); }
});

test('a leftover c- id in the cleanup journal of an earlier build is an ordinary entry: it validates, the generic cleanup deletes it and nothing treats it specially', async () => {
  const stale = 'c-0f1e2d3c-4b5a-4968-8776-655443322110', initial = configWith([direct('http')]);
  const f = fixture({ initial, vaultState: { version: 1, configuration: initial, nativeIds: {}, cleanup: [stale] } });
  try {
    f.vault.set(stale, { type: 'http', host: '192.0.2.99', port: 8080 });
    const loaded = await f.client.load(); assert.equal(loaded.configuration.profiles.length, 1);
    assert.equal(f.nativeMessages.filter(message => message.op === 'delete').map(message => message.profileId).join(), stale, 'deleted by the generic journal cleanup');
    assert.equal(f.vault.has(stale), false); assert.deepEqual(f.data['proxy-vault-state:v1'].cleanup, []);
    assert.equal((await f.client.checkProfile({ id: 'http-direct', url: 'https://example.test/' })).diagnostic.state, 'pass');
  } finally { f.cleanup(); }
});

test('the client reads companion capabilities strictly: http and https are booleans or absent, anything else makes the host unavailable', async () => {
  const f = fixture(); const ports = []; f.api.runtime.onConnect.addListener(port => ports.push(port));
  try {
    const base = await f.client.load(); assert.equal(ports.length, 1);
    const push = async host => { f.changes.length = 0; ports[0].postMessage({ v: 1, type: 'change', snapshot: { ...base, host } }); await tick(); return f.changes.at(-1); };
    assert.deepEqual((await push({ available: true, version: 1, capabilities: CURRENT })).host, { available: true, version: 1, capabilities: { socks5: true, http: true, https: true, openvpn: true, vless: true, vault: true } });
    assert.deepEqual((await push({ available: true, version: 1, capabilities: LEGACY })).host.capabilities, { socks5: true, http: false, https: false, openvpn: true, vless: true, vault: true }, 'an older companion lacks the keys and reads as unable');
    assert.deepEqual((await push({ available: true, version: 1, capabilities: { ...CURRENT, http: false } })).host.capabilities.http, false);
    for (const bad of ['yes', 1, null, {}, []]) for (const key of ['http', 'https']) assert.deepEqual((await push({ available: true, version: 1, capabilities: { ...CURRENT, [key]: bad } })).host, { available: false }, key + ' ' + JSON.stringify(bad));
    assert.deepEqual((await push({ available: true, version: 1, capabilities: { ...CURRENT, vault: 'yes' } })).host, { available: false }, 'the four original keys stay mandatory booleans');
  } finally { f.cleanup(); }
});
