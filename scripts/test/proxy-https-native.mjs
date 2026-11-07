// ADR-070 round 5: a direct HTTPS-scheme proxy profile in the real browsers. The proxy is an owned loopback TLS server with an ephemeral
// certificate (Chromium trusts it by SPKI hash, Firefox through the owned session capability acceptInsecureCerts). The test proves
// that traffic really reaches the proxy over TLS with the destination name unresolved locally, and that stopping the proxy never
// turns into a direct connection. node scripts/test/proxy-https-native.mjs [--firefox] [--from-source]
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer as httpServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { launchOwnedManagement, until } from './management-browser-fixture.mjs';
import { ephemeralCertificate, startOwnedHttpProxy } from './proxy-http-fixture.mjs';
import { evidenceDirectory, stageExtension, writeEvidence, sha256 } from './native-evidence.mjs';

const root = resolve(import.meta.dirname, '../..'), browser = process.argv.includes('--firefox') ? 'firefox' : 'chrome', fromSource = process.argv.includes('--from-source');
mkdirSync(join(root, '.tmp'), { recursive: true });
const run = mkdtempSync(join(root, '.tmp/proxy-https-' + browser + '-')), extension = join(run, 'extension');
const staged = await stageExtension({ browser, target: extension, from: fromSource ? 'source' : 'dist' });
evidenceDirectory('proxy');
const evidence = { at: new Date().toISOString(), browser, run, packaging: staged.packaging, result: 'RUNNING', disposableProfile: true, ownedLoopbackOnly: true, externalServersContacted: false, checks: [] };
const mappedHost = 'ownedroute.example.com', proxyOnlyHost = 'onlyproxy.proxy.invalid';
const hits = [];
const origin = httpServer((request, response) => { request.resume(); hits.push({ host: request.headers.host, path: request.url }); response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.setHeader('Cache-Control', 'no-store'); response.setHeader('Connection', 'close'); response.end('<!doctype html><title>Owned HTTPS proxy fixture</title><link rel="icon" href="data:,"><h1 data-owned-proxy-proof="yes">Owned HTTPS proxy fixture</h1>'); });
await new Promise(done => origin.listen(0, '127.0.0.1', done)); const originPort = origin.address().port;
const certificate = ephemeralCertificate('127.0.0.1');
const proxy = await startOwnedHttpProxy({ originPort, allowedHosts: new Set([mappedHost, proxyOnlyHost, '127.0.0.1']), tls: { pfx: certificate.pfx, passphrase: certificate.passphrase } });
const bridgeSource = `import {createProxyClient} from './proxy-client.js';
const api=globalThis.browser??globalThis.chrome;const client=createProxyClient(api,{env:globalThis});
export async function command(text){const {op,input}=JSON.parse(text);try{return {ok:true,value:await client[op](input)}}catch(e){return {ok:false,code:e.code??'operation-failed'}}}
export async function storage(){const data=await api.storage.local.get('proxy-configuration:v1');return data['proxy-configuration:v1']??null;}
export async function proxySetting(){try{return await api.proxy.settings.get({incognito:false})}catch{return null;}}
export async function probe(text){const url=JSON.parse(text),tab=await api.tabs.create({url,active:false});try{for(let i=0;i<160;i++){try{const current=await api.tabs.get(tab.id);if(current.status==='complete'&&current.url===url){const result=await api.scripting.executeScript({target:{tabId:tab.id},world:'ISOLATED',func:()=>Boolean(document.querySelector('[data-owned-proxy-proof="yes"]'))});if(result[0]?.result)return {success:true};if(i>20)return {success:false};}}catch{if(i>20)return {success:false};}await new Promise(r=>setTimeout(r,50));}return {success:false};}finally{await api.tabs.remove(tab.id);}}
globalThis.__proxyNativeBridge={command,storage,proxySetting,probe};
`;
writeFileSync(join(extension, 'proxy-owned-native-bridge.js'), bridgeSource);
const check = message => { evidence.checks.push(message); console.log('  ok ' + message); };
let opened, context, page, phase = 'startup';
async function launch() {
  if (browser === 'firefox') return launchOwnedManagement({ root, run, extension, browser, evidence, loopbackHosts: [mappedHost], acceptInsecureCerts: true });
  context = await chromium.launchPersistentContext(join(run, 'chrome-profile'), { channel: 'chromium', headless: false, viewport: { width: 1180, height: 900 }, args: ['--window-position=-10000,-10000', '--disable-extensions-except=' + extension, '--load-extension=' + extension, '--no-first-run', '--no-proxy-server', '--host-resolver-rules=MAP ' + mappedHost + ' 127.0.0.1', '--ignore-certificate-errors-spki-list=' + certificate.spki] });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'), base = new URL('.', worker.url()).href;
  page = await context.newPage(); await page.goto(base + 'options.html#proxy');
  return { base, version: context.browser().version(), evaluate: (fn, value) => page.evaluate(fn, value), goto: url => page.goto(url), close: () => context.close() };
}
const bootBridge = () => opened.evaluate(() => new Promise((resolve, reject) => { const api = globalThis.browser ?? globalThis.chrome, script = document.createElement('script'); script.type = 'module'; script.src = api.runtime.getURL('proxy-owned-native-bridge.js'); script.onload = () => resolve(true); script.onerror = () => reject(Error('owned-bridge-load')); document.head.append(script); }));
const call = (name, value) => opened.evaluate(({ name, value }) => window.__proxyNativeBridge[name](value), { name, value });
const command = (op, input) => call('command', JSON.stringify({ op, input }));
async function success(op, input) { const result = await command(op, input); assert.equal(result.ok, true, result.code ?? op); return result.value; }
const probe = path => call('probe', JSON.stringify(path));
try {
  opened = await launch(); evidence.version = opened.version;
  await opened.goto(opened.base + 'options.html#proxy');
  await until(() => opened.evaluate(() => Boolean(document.querySelector('[data-management-shell]'))), 'management shell');
  await bootBridge();
  const initial = await success('load'); assert.equal(initial.configuration.enabled, false);
  assert.equal((await probe('http://' + mappedHost + ':' + originPort + '/off-' + randomUUID())).success, true);
  check('baseline: Proxy OFF, the owned origin is reachable directly');

  phase = 'HTTPS profile';
  let saved = await success('saveProfile', { name: 'Owned HTTPS proxy', type: 'https', host: '127.0.0.1', port: proxy.port, country: 'US' });
  const id = saved.configuration.selectedId, profile = saved.configuration.profiles.find(item => item.id === id);
  assert.deepEqual(profile, { id, name: 'Owned HTTPS proxy', type: 'https', host: '127.0.0.1', port: proxy.port, native: false, country: 'US' });
  const config = (await success('load')).configuration; config.protectWebRTC = false; config.disablePrediction = false; config.routing.bypassLocal = false; await success('saveSettings', config);
  const active = await command('connect', id);
  evidence.connect = { ok: active.ok, code: active.code ?? null, state: active.value?.status?.state ?? null };
  assert.equal(active.ok, true, 'connect ' + (active.code ?? ''));
  assert.equal(active.value.status.state, 'connected');
  if (browser === 'chrome') { const setting = await call('proxySetting'); assert.equal(setting.levelOfControl, 'controlled_by_this_extension'); assert.match(setting.value.pacScript.data, new RegExp('"HTTPS 127\\.0\\.0\\.1:' + proxy.port + '"')); assert.doesNotMatch(setting.value.pacScript.data, /dnsResolve|; DIRECT/); assert.equal(setting.value.pacScript.mandatory, true); }
  check('an HTTPS profile saves as metadata only and connects' + (browser === 'chrome' ? ' with a mandatory PAC naming the HTTPS directive' : ''));

  phase = 'traffic through the HTTPS proxy';
  const viaProxy = await probe('http://' + proxyOnlyHost + ':' + originPort + '/via-https-proxy-' + randomUUID());
  evidence.viaProxy = viaProxy;
  assert.equal(viaProxy.success, true, 'a name no resolver knows loads only through the proxy');
  assert.ok(proxy.hits(proxyOnlyHost, 'GET').length >= 1, 'the proxy received an absolute-URI request for the unresolved name');
  assert.ok(proxy.log.every(entry => entry.authorized));
  await probe('https://' + proxyOnlyHost + ':' + originPort + '/connect-tunnel-' + randomUUID());
  assert.ok(proxy.hits(proxyOnlyHost, 'CONNECT').length >= 1, 'an https:// destination is tunnelled with CONNECT to the unresolved name');
  check('traffic reaches the proxy over TLS: absolute-URI GET and CONNECT carry the destination name, which no local resolver knows');

  phase = 'fail closed';
  await proxy.stop();
  const closedPath = '/closed-' + randomUUID(), before = hits.filter(hit => hit.path === closedPath).length;
  assert.equal((await probe('http://' + mappedHost + ':' + originPort + closedPath)).success, false);
  assert.equal(hits.filter(hit => hit.path === closedPath).length, before, 'no direct connection reached the origin');
  assert.equal((await success('load')).configuration.enabled, true);
  check('after the proxy stops, a directly reachable destination fails without one origin hit');

  phase = 'disconnect';
  const off = await success('disconnect'); assert.equal(off.status.state, 'off');
  assert.equal((await probe('http://' + mappedHost + ':' + originPort + '/after-off-' + randomUUID())).success, true);
  assert.doesNotMatch(JSON.stringify(await call('storage')), /password|username/);
  check('explicit Disconnect releases the layer and the owned origin is reachable again');
  evidence.result = 'PASS';
} catch (error) { evidence.result = 'FAIL'; evidence.phase = phase; evidence.error = String(error.message).slice(0, 400); throw error; }
finally {
  try { if (opened) await opened.close(); } catch { /* The browser may already be gone. */ }
  await proxy.stop(); origin.closeAllConnections(); await new Promise(done => origin.close(done));
  evidence.proxyLog = proxy.log.slice(0, 40); evidence.hashes = { 'proxy-shared.js': sha256(readFileSync(join(extension, 'proxy-shared.js'))), 'proxy-service.js': sha256(readFileSync(join(extension, 'proxy-service.js'))) };
  writeEvidence('proxy/https-' + browser + '.json', evidence);
}
console.log('Proxy HTTPS native ' + browser + ': ' + evidence.checks.length + ' checks ' + evidence.result);
