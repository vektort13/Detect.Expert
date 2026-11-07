// E22-25 / ADR-070: real browser proxy routing, owned loopback servers and disposable profiles.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer as httpServer } from 'node:http';
import { createServer as tcpServer, connect as tcpConnect } from 'node:net';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launchOwnedManagement, until, pause } from './management-browser-fixture.mjs';
import { registerOwnedProxyHost, createOwnedNativeHostName, isolateOwnedNativeBinding } from './proxy-native-host-fixture.mjs';
import { startOwnedHttpProxy } from './proxy-http-fixture.mjs';
import { stageExtension } from './native-evidence.mjs';
const root = resolve(import.meta.dirname, '../..'), browser = process.argv.includes('--firefox') ? 'firefox' : 'chrome';
const nativeAuth = process.argv.includes('--native-auth');
const nativeHostName = nativeAuth ? createOwnedNativeHostName() : null;
mkdirSync(join(root, '.tmp'), { recursive: true });
// Default: the packaged dist/<browser> the lead builds. `--from-source` assembles the same package from apps/production-extension.
const run = mkdtempSync(join(root, '.tmp/proxy-browser-' + browser + '-')), extension = join(run, 'extension');
const staged = await stageExtension({ browser, target: extension, from: process.argv.includes('--from-source') ? 'source' : 'dist' });
const files = ['proxy-shared.js', 'proxy-service.js', 'proxy-client.js'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const evidence = { at: new Date().toISOString(), browser, run, packaging: staged.packaging, result: 'RUNNING', disposableProfile: true, ownedLoopbackOnly: true, userCredentialsRead: false, externalServersContacted: false, checks: [], hashes: {}, socks: [] };
for (const file of files) { const source = readFileSync(join(root, 'apps/production-extension', file)), delivery = readFileSync(join(extension, file)); assert.ok(source.equals(delivery), 'stale delivered ' + file); evidence.hashes[file] = sha(source); }
evidence.backgroundSHA256 = sha(readFileSync(join(extension, 'background.js')));
if (nativeAuth) evidence.nativeHostBinding = isolateOwnedNativeBinding({ directory: extension, hostName: nativeHostName });
if (nativeAuth) { const manifestFile = join(extension, 'manifest.json'), manifest = JSON.parse(readFileSync(manifestFile)); const promoted = ['nativeMessaging', 'clipboardWrite']; assert.ok(promoted.every(permission => manifest.optional_permissions.includes(permission))); manifest.optional_permissions = manifest.optional_permissions.filter(permission => !promoted.includes(permission)); manifest.permissions.push(...promoted); writeFileSync(manifestFile, JSON.stringify(manifest, null, 2)); evidence.fixtureManifestSHA256 = sha(readFileSync(manifestFile)); evidence.promotedFixturePermissions = promoted; }
const mappedHost = 'ownedroute.example.com', proxyOnlyHost = 'onlyproxy.proxy.invalid', allowedHosts = new Set([mappedHost, proxyOnlyHost, '127.0.0.1']);
const ownedUsername = 'OWNED-USER-CANARY', ownedPassword = 'OWNED-PASSWORD-CANARY';
let authAccepted = 0, authRejected = 0;
const hits = [], sockets = new Set();
const origin = httpServer((request, response) => { request.resume(); hits.push({ host: request.headers.host, path: request.url }); response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.setHeader('Cache-Control', 'no-store'); response.setHeader('Connection', 'close'); if (request.url.startsWith('/diagnose-ip')) { response.setHeader('Content-Type', 'application/json'); response.end('{"ip":"198.51.100.17"}'); return; } if (request.url.startsWith('/diagnose-forbidden')) response.statusCode = 403; response.end('<!doctype html><title>Owned proxy fixture</title><link rel="icon" href="data:,"><h1 data-owned-proxy-proof="yes">Owned proxy fixture</h1>'); });
await new Promise(done => origin.listen(0, '127.0.0.1', done)); const originPort = origin.address().port;
let serverStopped = false;
const socks = tcpServer(socket => {
  sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {}); socket.setTimeout(10000, () => socket.destroy());
  let state = 'greeting', buffer = Buffer.alloc(0), upstream = null;
  const data = bytes => {
    buffer = Buffer.concat([buffer, bytes]);
    if (state === 'greeting') { if (buffer.length < 2 || buffer.length < 2 + buffer[1]) return; const methods = buffer.subarray(2, 2 + buffer[1]), method = methods.includes(2) ? 2 : methods.includes(0) ? 0 : 255; if (buffer[0] !== 5 || method === 255) return socket.destroy(); buffer = buffer.subarray(2 + buffer[1]); socket.write(Buffer.from([5, method])); state = method === 2 ? 'auth' : 'request'; }
    if (state === 'auth') { if (buffer.length < 2 || buffer.length < 3 + buffer[1]) return; const ulen = buffer[1], plen = buffer[2 + ulen], size = 3 + ulen + plen; if (buffer.length < size) return; const valid = buffer[0] === 1 && buffer.subarray(2, 2 + ulen).toString() === ownedUsername && buffer.subarray(3 + ulen, size).toString() === ownedPassword; buffer = buffer.subarray(size); socket.write(Buffer.from([1, valid ? 0 : 1])); if (!valid) { authRejected++; return socket.end(); } authAccepted++; state = 'request'; }
    if (state !== 'request' || buffer.length < 5) return;
    let size = 0, host;
    if (buffer[3] === 3) { size = 7 + buffer[4]; if (buffer.length < size) return; host = buffer.subarray(5, 5 + buffer[4]).toString('ascii'); }
    else if (buffer[3] === 1) { size = 10; if (buffer.length < size) return; host = [...buffer.subarray(4, 8)].join('.'); }
    else { socket.write(Buffer.from([5, 8, 0, 1, 0, 0, 0, 0, 0, 0])); return socket.destroy(); }
    const port = buffer.readUInt16BE(size - 2), kind = buffer[3];
    if (buffer[0] !== 5 || buffer[1] !== 1 || !allowedHosts.has(host) || port !== originPort) { socket.write(Buffer.from([5, 2, 0, 1, 0, 0, 0, 0, 0, 0])); return socket.end(); }
    evidence.socks.push({ host, port, atyp: kind }); const extra = buffer.subarray(size); buffer = Buffer.alloc(0); state = 'stream'; socket.off('data', data);
    upstream = tcpConnect(originPort, '127.0.0.1', () => { socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0])); if (extra.length) upstream.write(extra); socket.pipe(upstream); upstream.pipe(socket); }); upstream.on('error', () => socket.destroy()); upstream.on('close', () => socket.destroy()); socket.on('close', () => upstream.destroy());
  };
  socket.on('data', data);
});
await new Promise(done => socks.listen(0, '127.0.0.1', done)); const socksPort = socks.address().port;
const bridgeSource = `import {createProxyClient} from './proxy-client.js';
const api=globalThis.browser??globalThis.chrome;const client=createProxyClient(api,{env:globalThis});
export async function command(text){const {op,input}=JSON.parse(text);try{return {ok:true,value:await client[op](input)}}catch(e){return {ok:false,code:e.code??'operation-failed'}}}
export async function storage(){const data=await api.storage.local.get('proxy-configuration:v1');return data['proxy-configuration:v1']??null;}
export async function proxySetting(){try{return await api.proxy.settings.get({incognito:false})}catch{return null;}}
export async function probe(text){const url=JSON.parse(text),tab=await api.tabs.create({url,active:false});try{for(let i=0;i<160;i++){try{const current=await api.tabs.get(tab.id);if(current.status==='complete'&&current.url===url){const result=await api.scripting.executeScript({target:{tabId:tab.id},world:'ISOLATED',func:()=>Boolean(document.querySelector('[data-owned-proxy-proof="yes"]'))});if(result[0]?.result)return {success:true};if(i>20)return {success:false};}}catch{if(i>20)return {success:false};}await new Promise(r=>setTimeout(r,50));}return {success:false};}finally{await api.tabs.remove(tab.id);}}
export async function forged(text){const url=JSON.parse(text),tab=await api.tabs.create({url,active:false});try{for(let i=0;i<100;i++){const current=await api.tabs.get(tab.id);if(current.status==='complete'&&current.url===url)break;await new Promise(r=>setTimeout(r,30));}const result=await api.scripting.executeScript({target:{tabId:tab.id},world:'ISOLATED',func:()=>new Promise(resolve=>{const p=(globalThis.browser??globalThis.chrome).runtime.connect({name:'detect.expert.proxy/v1'});p.onDisconnect.addListener(()=>{void(globalThis.browser??globalThis.chrome).runtime.lastError;resolve(true)});setTimeout(()=>resolve(false),1000);})});return result[0]?.result===true;}finally{await api.tabs.remove(tab.id);}}
globalThis.__proxyNativeBridge={command,storage,proxySetting,probe,forged};
`;
writeFileSync(join(extension, 'proxy-owned-native-bridge.js'), bridgeSource); evidence.fixtureBridgeSHA256 = sha(Buffer.from(bridgeSource));
let opened, nativeFixture, phase = 'startup';
const check = message => { evidence.checks.push(message); console.log('  ok ' + message); };
const bootBridge = () => opened.evaluate(() => new Promise((resolve, reject) => { const api = globalThis.browser ?? globalThis.chrome, script = document.createElement('script'); script.type = 'module'; script.src = api.runtime.getURL('proxy-owned-native-bridge.js'); script.onload = () => resolve(true); script.onerror = () => reject(Error('owned-bridge-load')); document.head.append(script); }));
const call = (name, value) => opened.evaluate(({ name, value }) => window.__proxyNativeBridge[name](value), { name, value });
const command = (op, input) => call('command', JSON.stringify({ op, input }));
async function success(op, input) { const result = await command(op, input); assert.equal(result.ok, true, result.code ?? op); return result.value; }
const probe = path => call('probe', JSON.stringify(path));
let ownedClipboardText = null;
// Read only after this fixture explicitly clicked Copy JSON. Never inspect the
// pre-existing OS clipboard, and never print the returned secret-bearing text.
const copiedJson = () => {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from("[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false);[Console]::Write((Get-Clipboard -Raw))", 'utf16le').toString('base64')], { windowsHide: true, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, 'owned fixture clipboard read'); ownedClipboardText = result.stdout; return JSON.parse(result.stdout);
};
const clearOwnedClipboard = () => {
  if (ownedClipboardText === null) return;
  const expected = Buffer.from(ownedClipboardText, 'utf8').toString('base64');
  const script = "try{$ErrorActionPreference='Stop';$expected=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + expected + "'));for($attempt=0;$attempt-lt10;$attempt++){$actual=Get-Clipboard -Raw;if(-not[string]::Equals($actual,$expected,[StringComparison]::Ordinal)){break};try{Set-Clipboard -Value $null;break}catch{if($attempt-eq9){throw};Start-Sleep -Milliseconds 50}}}catch{[Console]::Error.Write($_.FullyQualifiedErrorId);exit 1}";
  const result = spawnSync('powershell.exe', ['-STA', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, encoding: 'utf8', timeout: 10000 });
  ownedClipboardText = null; const safeCode = result.stderr.replace(/[^A-Za-z0-9_.,-]/g, '').slice(0, 160); assert.equal(result.status, 0, 'owned fixture clipboard cleanup: ' + safeCode); evidence.ownedClipboardCleanup = true;
};
try {
  opened = await launchOwnedManagement({ root, run, extension, browser, evidence, loopbackHosts: [mappedHost], headless: !nativeAuth }); evidence.version = opened.version;
  if (nativeAuth && browser === 'firefox') evidence.interactiveClipboardFixture = true;
  await opened.goto(opened.base + 'options.html#proxy');
  await until(() => opened.evaluate(() => Boolean(document.querySelector('[data-management-shell]'))), 'management shell');
  await bootBridge();
  const initial = await success('load'); assert.equal(initial.configuration.enabled, false); assert.equal(initial.status.state, 'off');
  assert.equal((await call('storage')), null);
  assert.equal((await probe('http://' + mappedHost + ':' + originPort + '/off-' + randomUUID())).success, true);
  const before = await call('proxySetting'); if (browser === 'chrome') assert.notEqual(before.levelOfControl, 'controlled_by_this_extension');
  check('Proxy starts OFF without a storage write or claimed proxy layer; the owned baseline page remains reachable');

  phase = 'profile persistence and permission preflight';
  let saved = await success('saveProfile', { name: 'Owned native fixture', type: 'socks5', host: '127.0.0.1', port: socksPort }); const id = saved.configuration.selectedId;
  const denied = await command('connect', id);
  assert.equal(denied.ok, false); assert.ok(['permission-required', 'privacy-permission-required'].includes(denied.code)); assert.equal((await success('load')).configuration.enabled, false);
  const config = (await success('load')).configuration; config.protectWebRTC = false; config.disablePrediction = false;
  await success('saveSettings', config);
  await opened.goto(opened.base + 'options.html#proxy'); await bootBridge(); saved = await success('load'); assert.equal(saved.configuration.profiles[0].id, id); assert.equal(saved.configuration.profiles[0].native, false);
  if (!nativeAuth) { const auth = await command('saveProfile', { name: 'No credential persistence', type: 'socks5', host: '127.0.0.1', port: socksPort, username: ownedUsername, password: ownedPassword }); assert.equal(auth.ok, false); assert.equal(auth.code, 'permission-required'); }
  assert.doesNotMatch(JSON.stringify(await call('storage')), /OWNED-(USER|PASSWORD)-CANARY/);
  check(nativeAuth ? 'metadata survives a new Options document; missing optional privacy rejects application, and the promoted native/clipboard fixture permissions are explicit' : 'metadata survives a new Options document; missing optional privacy/native grants reject application and credential save without persisting secrets');

  phase = 'actual SOCKS remote DNS routing';
  const active = await success('connect', id); assert.equal(active.status.state, 'connected');
  const proxied = await probe('http://' + proxyOnlyHost + ':' + originPort + '/proxy-only-' + randomUUID()); assert.equal(proxied.success, true);
  assert.ok(evidence.socks.some(row => row.host === proxyOnlyHost && row.atyp === 3));
  if (browser === 'chrome') { const actual = await call('proxySetting'); assert.equal(actual.levelOfControl, 'controlled_by_this_extension'); assert.equal(actual.value.mode, 'pac_script'); assert.equal(actual.value.pacScript.mandatory, true); assert.doesNotMatch(actual.value.pacScript.data, /dnsResolve|; DIRECT/); }
  check('a domain absent from local DNS loads through the real SOCKS listener as ATYP=3; ' + (browser === 'chrome' ? 'Chrome owns a mandatory generated PAC' : 'Firefox uses remote SOCKS DNS'));

  phase = 'route include and direct rules';
  let changed = (await success('load')).configuration; changed.routing = { mode: 'include', proxyDomains: [proxyOnlyHost], directDomains: [], bypassLocal: false }; await success('saveSettings', changed);
  const directBefore = evidence.socks.length; assert.equal((await probe('http://' + mappedHost + ':' + originPort + '/direct-' + randomUUID())).success, true); assert.equal(evidence.socks.length, directBefore);
  assert.equal((await probe('http://' + proxyOnlyHost + ':' + originPort + '/included-' + randomUUID())).success, true); assert.ok(evidence.socks.length > directBefore);
  changed = (await success('load')).configuration; changed.routing = { mode: 'all', proxyDomains: [], directDomains: [mappedHost], bypassLocal: false }; await success('saveSettings', changed);
  const exceptionBefore = evidence.socks.length; assert.equal((await probe('http://' + mappedHost + ':' + originPort + '/exception-' + randomUUID())).success, true); assert.equal(evidence.socks.length, exceptionBefore);
  check('selected-domain mode proxies only included hosts, and an explicit exact-domain exception reaches the owned origin without entering SOCKS');

  phase = 'native content sender rejection';
  const beforeForgery = (await success('load')).configuration.revision;
  assert.equal(await call('forged', JSON.stringify('http://' + mappedHost + ':' + originPort + '/forgery-' + randomUUID())), true);
  assert.equal((await success('load')).configuration.revision, beforeForgery);
  check('a real tab ISOLATED sender cannot open the privileged proxy Options port or mutate profile revision');

  phase = 'fail closed with directly reachable destination';
  changed = (await success('load')).configuration; changed.routing = { mode: 'all', proxyDomains: [], directDomains: [], bypassLocal: false }; await success('saveSettings', changed);
  const failPath = '/killed-' + randomUUID();
  for (const socket of sockets) socket.destroy();
  await new Promise(done => socks.close(done)); serverStopped = true;
  const reachedBefore = hits.filter(hit => hit.path === failPath).length;
  assert.equal((await probe('http://' + mappedHost + ':' + originPort + failPath)).success, false);
  assert.equal(hits.filter(hit => hit.path === failPath).length, reachedBefore);
  const remains = await success('load'); assert.equal(remains.configuration.enabled, true);
  check('after the SOCKS listener is terminated, a destination known reachable directly fails without a single origin hit or DIRECT fallback');

  phase = 'explicit disconnect and source proof';
  const off = await success('disconnect'); assert.equal(off.configuration.enabled, false); assert.equal(off.status.state, 'off');
  if (browser === 'chrome') assert.notEqual((await call('proxySetting')).levelOfControl, 'controlled_by_this_extension');
  assert.equal((await probe('http://' + mappedHost + ':' + originPort + '/after-off-' + randomUUID())).success, true);
  assert.doesNotMatch(JSON.stringify(await call('storage')), /password|username|vless:\/\/|<key>/);
  check('explicit Disconnect releases this extension layer, restores the owned direct baseline and retains only validated profile metadata');

  // Round 5: a direct HTTP proxy profile. No companion, no credential, no native host: the browser itself talks to the owned proxy.
  phase = 'actual HTTP proxy routing';
  const httpProxy = await startOwnedHttpProxy({ originPort, allowedHosts });
  try {
    const httpSaved = await success('saveProfile', { name: 'Owned HTTP proxy', type: 'http', host: '127.0.0.1', port: httpProxy.port, country: 'DE' });
    const httpId = httpSaved.configuration.profiles.find(profile => profile.type === 'http').id;
    assert.deepEqual(httpSaved.configuration.profiles.find(profile => profile.id === httpId), { id: httpId, name: 'Owned HTTP proxy', type: 'http', host: '127.0.0.1', port: httpProxy.port, native: false, country: 'DE' });
    const httpRouting = (await success('load')).configuration; httpRouting.routing = { mode: 'all', proxyDomains: [], directDomains: [], bypassLocal: false }; await success('saveSettings', httpRouting);
    const httpActive = await success('connect', httpId); assert.equal(httpActive.status.state, 'connected');
    if (browser === 'chrome') { const actual = await call('proxySetting'); assert.equal(actual.levelOfControl, 'controlled_by_this_extension'); assert.equal(actual.value.pacScript.mandatory, true); assert.match(actual.value.pacScript.data, new RegExp('"PROXY 127\\.0\\.0\\.1:' + httpProxy.port + '"')); assert.doesNotMatch(actual.value.pacScript.data, /dnsResolve|; DIRECT/); }
    assert.equal((await probe('http://' + proxyOnlyHost + ':' + originPort + '/http-proxy-only-' + randomUUID())).success, true, 'a name no resolver knows loads only through the proxy');
    assert.ok(httpProxy.hits(proxyOnlyHost, 'GET').length >= 1, 'absolute-URI request names the unresolved host');
    await probe('https://' + proxyOnlyHost + ':' + originPort + '/http-connect-' + randomUUID());
    assert.ok(httpProxy.hits(proxyOnlyHost, 'CONNECT').length >= 1, 'an https:// destination is tunnelled with CONNECT to the unresolved name');
    assert.ok(httpProxy.log.every(entry => entry.authorized) && httpProxy.log.every(entry => entry.method === 'GET' || entry.method === 'CONNECT'));
    assert.equal(hits.some(hit => hit.host?.startsWith(proxyOnlyHost) && hit.path.startsWith('/http-connect-')), false, 'the CONNECT target is not a TLS server, so no plain request reached the origin');
    evidence.http = { getViaProxy: httpProxy.count('GET'), connectViaProxy: httpProxy.count('CONNECT'), pac: browser === 'chrome' };
    check('a direct HTTP profile is metadata only and routes real browser traffic through the owned HTTP proxy: absolute-URI GET and CONNECT carry a name no local resolver knows' + (browser === 'chrome' ? ' under a mandatory PROXY PAC' : ''));
    const httpClosedPath = '/http-killed-' + randomUUID(), httpReached = hits.filter(hit => hit.path === httpClosedPath).length;
    await httpProxy.stop();
    assert.equal((await probe('http://' + mappedHost + ':' + originPort + httpClosedPath)).success, false);
    assert.equal(hits.filter(hit => hit.path === httpClosedPath).length, httpReached, 'no direct fallback after the proxy stopped');
    assert.equal((await success('load')).configuration.enabled, true);
    check('after the HTTP proxy is terminated, a destination known reachable directly fails without a single origin hit or DIRECT fallback');
    const httpOff = await success('disconnect'); assert.equal(httpOff.status.state, 'off');
    assert.equal((await probe('http://' + mappedHost + ':' + originPort + '/after-http-off-' + randomUUID())).success, true);
    await success('deleteProfile', httpId);
    assert.doesNotMatch(JSON.stringify(await call('storage')), /password|username|vless:\/\//);
  } finally { await httpProxy.stop(); }
  if (nativeAuth) {
    phase = 'actual native messaging vault and authenticated relay';
    nativeFixture = await registerOwnedProxyHost({ root, run, opened, browser, hostName: nativeHostName });
    evidence.nativeHost = { sha256: nativeFixture.hash, isolatorSHA256: nativeFixture.launcherHash, temporaryRegistryKeys: nativeFixture.registryKeys, vaultIsolatedFromUser: true, registryNamespaceIsolated: true };
    await new Promise(done => socks.listen(socksPort, '127.0.0.1', done)); serverStopped = false;
    await success('connect', id);
    const directDiagnostic = await success('diagnose', 'http://' + proxyOnlyHost + ':' + originPort + '/diagnose-ip?token=PRIVATE_DIAG_URL_CANARY');
    assert.equal(directDiagnostic.diagnostic.state, 'pass'); assert.equal(directDiagnostic.diagnostic.ip, '198.51.100.17'); assert.equal(directDiagnostic.diagnostic.remoteDns, true);
    await success('disconnect');
    const defaultPrivacy = (await success('load')).configuration; defaultPrivacy.protectWebRTC = true; defaultPrivacy.disablePrediction = true; await success('saveSettings', defaultPrivacy);
    const vaultSaveSetting = await call('proxySetting');
    const savedAuth = await success('saveProfile', { name: 'Owned authenticated relay', type: 'socks5', host: '127.0.0.1', port: socksPort, username: ownedUsername, password: ownedPassword });
    const authId = savedAuth.configuration.profiles.find(profile => profile.native).id;
    assert.equal(savedAuth.configuration.protectWebRTC, true); assert.equal(savedAuth.configuration.disablePrediction, true); assert.equal(savedAuth.configuration.enabled, false); assert.deepEqual(await call('proxySetting'), vaultSaveSetting);
    assert.equal((await success('hostStatus')).host.available, true);
    const stillRequiresPrivacy = await command('connect', authId); assert.equal(stillRequiresPrivacy.ok, false); assert.equal(stillRequiresPrivacy.code, 'permission-required'); assert.equal((await success('load')).configuration.enabled, false);
    assert.equal(savedAuth.host.capabilities.vault, true); assert.doesNotMatch(JSON.stringify(await call('storage')), /OWNED-(USER|PASSWORD)-CANARY/);
    const vaultDirectory = join(nativeFixture.dataDirectory, 'Detect.Expert/Proxy'), vaultFiles = readdirSync(vaultDirectory).filter(file => file.endsWith('.dpapi')); assert.equal(vaultFiles.length, 1);
    const ciphertext = readFileSync(join(vaultDirectory, vaultFiles[0])); assert.equal(ciphertext.includes(Buffer.from(ownedPassword)), false); assert.equal(ciphertext.includes(Buffer.from(ownedUsername)), false);
    phase = 'saved profile check while OFF';
    // Round 5 markup: sections under the route card are disclosures, row actions are menu items, Copy all is in the list menu.
    const openSection = async name => { if (!(await opened.evaluate(name => document.querySelector('[data-proxy-panel="' + name + '"]')?.getAttribute('aria-expanded') === 'true', name))) await opened.click('[data-proxy-panel="' + name + '"]'); await until(() => opened.evaluate(name => Boolean(document.querySelector('[data-proxy-panel-body="' + name + '"]')), name), 'section ' + name); };
    const rowAction = async (id, action) => { await opened.click('[data-proxy-more="' + id + '"]'); await opened.click('[data-proxy-' + action + '="' + id + '"]'); };
    const offCheckBefore = await success('load'), offSetting = await call('proxySetting');
    await until(() => opened.evaluate(id => Boolean(document.querySelector('[data-proxy-check-profile="' + id + '"]')), authId), 'saved profile manager row');
    await openSection('analyzer'); await opened.fill('[data-proxy-check-target]', 'http://' + proxyOnlyHost + ':' + originPort + '/diagnose-ip');
    await opened.click('[data-proxy-check-profile="' + authId + '"]');
    await until(() => opened.evaluate(id => document.querySelector('[data-proxy-health="' + id + '"]')?.dataset.state === 'pass', authId), 'saved profile check without activating route');
    assert.equal(await opened.evaluate(id => document.querySelector('[data-proxy-profile-ip="' + id + '"]')?.textContent, authId), '198.51.100.17');
    const offCheckAfter = await success('load'); assert.deepEqual(offCheckAfter.configuration, offCheckBefore.configuration); assert.deepEqual(offCheckAfter.status, offCheckBefore.status); assert.deepEqual(await call('proxySetting'), offSetting);
    check('a saved authenticated profile is explicitly checked from its manager row while Proxy is OFF without activating browser routing or changing configuration');
    const withoutPrivacy = offCheckAfter.configuration; withoutPrivacy.protectWebRTC = false; withoutPrivacy.disablePrediction = false; await success('saveSettings', withoutPrivacy);
    const authConnected = await success('connect', authId); assert.equal(authConnected.status.state, 'connected'); assert.equal(authConnected.status.endpoint.host, '127.0.0.1'); assert.ok(authAccepted >= 1);
    assert.equal((await probe('http://' + proxyOnlyHost + ':' + originPort + '/native-auth-' + randomUUID())).success, true); assert.ok(authAccepted >= 2); assert.ok(evidence.socks.some(row => row.host === proxyOnlyHost && row.atyp === 3));
    check('the real connectNative host saves credentials only to an isolated DPAPI vault and authenticates the upstream SOCKS relay for a genuine browser ATYP=3 request');

    phase = 'actual explicit analyzer controls';
    await openSection('analyzer'); await until(() => opened.evaluate(() => document.querySelector('[data-proxy-check]')?.disabled === false), 'explicit analyzer button');
    await opened.fill('[data-proxy-check-target]', 'http://' + proxyOnlyHost + ':' + originPort + '/diagnose-ip?token=PRIVATE_DIAG_URL_CANARY');
    await opened.click('[data-proxy-check]');
    await until(() => opened.evaluate(() => document.querySelector('[data-proxy-check-state]')?.dataset.proxyCheckState === 'pass' && document.querySelector('[data-proxy-check-http]')?.textContent === '200'), 'actual native analyzer HTTP success');
    assert.equal(await opened.evaluate(() => document.querySelector('[data-proxy-check-ip]')?.textContent), '198.51.100.17');
    const screenshots = join(root, 'test-results/prod/reports/2026-10-21-proxy'); mkdirSync(screenshots, { recursive: true });
    await opened.screenshot(join(screenshots, browser + '-analyzer-pass.png'));
    await opened.fill('[data-proxy-check-target]', 'http://' + proxyOnlyHost + ':' + originPort + '/diagnose-forbidden'); await opened.click('[data-proxy-check]');
    await until(() => opened.evaluate(() => document.querySelector('[data-proxy-check-state]')?.dataset.proxyCheckState === 'pass' && document.querySelector('[data-proxy-check-http]')?.textContent === '403'), 'actual target 403 remains reachable');
    assert.equal(await opened.evaluate(() => document.querySelector('[data-proxy-check-ip]')?.textContent), '—');
    await opened.fill('[data-proxy-check-target]', 'https://' + proxyOnlyHost + ':' + originPort + '/diagnose-tls'); await opened.click('[data-proxy-check]');
    await until(() => opened.evaluate(() => document.querySelector('[data-proxy-check-state]')?.dataset.proxyCheckState === 'fail' && document.querySelector('[data-proxy-check-failure]')?.textContent.includes('tls-failed')), 'actual TLS diagnostic failure');
    await opened.screenshot(join(screenshots, browser + '-analyzer-fail.png'));
    const afterDiagnostic = await success('load'); assert.equal(afterDiagnostic.status.state, 'connected'); assert.equal(afterDiagnostic.diagnostic.state, 'fail');
    assert.doesNotMatch(JSON.stringify(await call('storage')), /PRIVATE_DIAG_URL_CANARY|198\.51\.100\.17|diagnose-forbidden|diagnose-tls/);
    evidence.analyzer = { explicitUiControls: true, directProfileSelectedEndpoint: true, domainRequest: true, ip: '198.51.100.17', http403IsReachable: true, tlsFailureClassified: true, targetNotPersisted: true, resultNotPersisted: true };
    check('explicit analyzer controls use the selected direct/native proxy, display HTTP/IP/DNS results, preserve a target HTTP 403 as reachable and classify a real TLS failure without persisting the target or result');

    phase = 'real saved profile manager and clipboard';
    const another = await success('saveProfile', { name: 'Owned inactive relay', type: 'socks5', host: '127.0.0.1', port: socksPort, username: ownedUsername, password: ownedPassword });
    const inactiveId = another.configuration.profiles.find(profile => profile.name === 'Owned inactive relay').id;
    const renameBefore = await success('load'), renameSetting = await call('proxySetting');
    await rowAction(authId, 'edit');
    await until(() => opened.evaluate(() => document.querySelector('[data-proxy-field="password"]')?.value === 'OWNED-PASSWORD-CANARY'), 'active profile full Edit');
    await opened.fill('[data-proxy-field="name"]', 'Owned active renamed'); await opened.click('[data-proxy-save-profile]');
    await until(() => opened.evaluate(id => document.querySelector('[data-proxy-profile="' + id + '"]')?.textContent.includes('Owned active renamed'), authId), 'active rename saved without reconnect');
    const renamed = await success('load'); assert.equal(renamed.configuration.revision, renameBefore.configuration.revision + 1); assert.deepEqual(renamed.status, renameBefore.status); assert.deepEqual(await call('proxySetting'), renameSetting);
    await opened.fill('[data-proxy-check-target]', 'http://' + proxyOnlyHost + ':' + originPort + '/diagnose-ip');
    const connectedBefore = await success('load'), connectedSetting = await call('proxySetting');
    await opened.click('[data-proxy-check-profile="' + inactiveId + '"]');
    await until(() => opened.evaluate(id => document.querySelector('[data-proxy-health="' + id + '"]')?.dataset.state === 'pass', inactiveId), 'inactive saved relay check while another remains active');
    const connectedAfter = await success('load'); assert.deepEqual(connectedAfter.configuration, connectedBefore.configuration); assert.deepEqual(connectedAfter.status, connectedBefore.status); assert.deepEqual(await call('proxySetting'), connectedSetting);
    await rowAction(authId, 'copy-profile');
    await until(() => opened.evaluate(id => Boolean(document.querySelector('[data-proxy-copied="' + id + '"]')), authId), 'actual single profile Copy JSON');
    let copied = copiedJson(); assert.equal(copied.format, 'detect.expert.proxy.bundle'); assert.equal(copied.profiles.length, 1); assert.equal(copied.profiles[0].id, authId); assert.equal(copied.profiles[0].connection.username, ownedUsername); assert.equal(copied.profiles[0].connection.password, ownedPassword); assert.deepEqual(copied.routing, connectedBefore.configuration.routing); copied = null;
    await opened.click('[data-proxy-menu="list"]'); await opened.click('[data-proxy-copy-all]');
    await until(() => opened.evaluate(() => Boolean(document.querySelector('[data-proxy-copied="all"]'))), 'actual all profile Copy JSON');
    copied = copiedJson(); assert.equal(copied.profiles.length, 3); assert.equal(copied.profiles.filter(profile => profile.native).every(profile => profile.connection.password === ownedPassword), true); assert.equal(copied.profiles.find(profile => !profile.native).connection.password, ''); assert.equal(copied.selectedId, authId); assert.equal(copied.enabled, true); copied = null;
    await rowAction(inactiveId, 'edit');
    await until(() => opened.evaluate(() => document.querySelector('[data-proxy-field="password"]')?.value === 'OWNED-PASSWORD-CANARY'), 'explicit Edit retrieves saved native configuration');
    assert.equal(await opened.evaluate(() => document.querySelector('[data-proxy-field="username"]')?.value), ownedUsername);
    await opened.goto(opened.base + 'options.html#settings'); await opened.goto(opened.base + 'options.html#proxy'); await bootBridge();
    assert.equal(await opened.evaluate(() => Boolean(document.querySelector('[data-proxy-field="password"]')?.value)), false);
    assert.doesNotMatch(JSON.stringify(await call('storage')), /OWNED-(USER|PASSWORD)-CANARY/);
    const managerState = await success('load'); assert.deepEqual(managerState.configuration, connectedBefore.configuration); assert.deepEqual(managerState.status, connectedBefore.status);
    evidence.manager = { defaultPrivacyGrantNotNeededForVault: true, savedCheckWhileOff: true, inactiveCheckKeepsActiveRoute: true, activeRenameKeepsRoute: true, actualClipboardSingle: true, actualClipboardAll: true, fullCredentials: true, explicitEditLoadsVault: true, editorClearedOnNavigation: true, secretsNotPersisted: true };
    check('manager checks and active renaming keep the existing relay unchanged; explicit single/all Copy JSON writes full credentials to the real OS clipboard and Edit loads the vault only until navigation');

    phase = 'native authentication diagnostics and closed failure';
    const badSaved = await success('saveProfile', { name: 'Owned refused authentication', type: 'socks5', host: '127.0.0.1', port: socksPort, username: ownedUsername, password: 'WRONG-OWNED-PASSWORD' }); const badId = badSaved.configuration.profiles.find(profile => profile.name === 'Owned refused authentication').id;
    const refused = await command('connect', badId); assert.equal(refused.ok, false); assert.equal(refused.code, 'auth-failed'); assert.ok(authRejected >= 1);
    const badState = await success('load'); assert.equal(badState.status.state, 'blocked'); assert.equal(badState.status.code, 'auth-failed'); assert.equal(badState.status.phase, 'auth');
    const refusedPath = '/refused-auth-' + randomUUID(); assert.equal((await probe('http://' + mappedHost + ':' + originPort + refusedPath)).success, false); assert.equal(hits.some(hit => hit.path === refusedPath), false);
    check('wrong upstream credentials produce the fixed auth-failed/auth diagnostic and keep the browser route closed without reaching a directly reachable origin');
    await success('disconnect'); await success('deleteProfile', badId); await success('connect', authId);

    phase = 'native process death and encrypted profile recovery';
    nativeFixture.killOwnedHost(); await until(async () => (await success('load')).status.state === 'blocked', 'actual native host loss');
    const crashedPath = '/crashed-native-' + randomUUID(); assert.equal((await probe('http://' + mappedHost + ':' + originPort + crashedPath)).success, false); assert.equal(hits.some(hit => hit.path === crashedPath), false);
    await success('disconnect'); const recovered = await success('connect', authId); assert.equal(recovered.status.state, 'connected'); assert.equal((await probe('http://' + proxyOnlyHost + ':' + originPort + '/recovered-native-' + randomUUID())).success, true);
    assert.doesNotMatch(JSON.stringify(await call('storage')), /OWNED-(USER|PASSWORD)-CANARY|WRONG-OWNED/);
    await success('disconnect'); await success('deleteProfile', authId);
    await success('deleteProfile', inactiveId);
    evidence.auth = { accepted: authAccepted, rejected: authRejected, encryptedVault: true, nativeProfileRecoveredAfterHostDeath: true };
    check('killing the actual owned native process keeps the route closed; explicit reconnection restores its encrypted saved profile without re-entering credentials');
  }
  evidence.result = 'PASS';
} catch (error) { evidence.result = 'FAIL'; evidence.phase = phase; evidence.error = String(error.message).slice(0, 300); if (opened) try { await opened.screenshot(join(run, 'failure.png')); } catch {} throw error;
} finally {
  let cleanupError = null;
  try { if (opened) await opened.close(); } catch (error) { cleanupError = error; }
  try { if (nativeFixture) { nativeFixture.restore(); evidence.nativeRegistryRestored = true; } } catch (error) { cleanupError ??= error; evidence.nativeRegistryRestored = false; }
  try { clearOwnedClipboard(); } catch (error) { cleanupError ??= error; evidence.ownedClipboardCleanup = false; }
  for (const socket of sockets) socket.destroy();
  if (!serverStopped) await new Promise(done => socks.close(done));
  origin.closeAllConnections(); await new Promise(done => origin.close(done));
  if (cleanupError) { evidence.result = 'FAIL'; evidence.cleanupFailed = true; }
  const target = join(root, 'test-results/production-1.1.0/proxy', browser + (nativeAuth ? '-native-auth' : '') + '.json');
  mkdirSync(resolve(target, '..'), { recursive: true }); writeFileSync(target, JSON.stringify(evidence, null, 2) + '\n');
  if (cleanupError) throw cleanupError;
}
console.log('Proxy native ' + browser + ': ' + evidence.checks.length + ' checks PASS');


