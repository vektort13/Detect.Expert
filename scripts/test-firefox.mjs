// ADR-018: native installed Firefox + official geckodriver. Profiles/artifacts stay in this project.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { archiveProduction, buildProduction, FIREFOX_ID } from './build-production.mjs';
import { BROWSER_DEBUG_FIREFOX_OPTIONAL } from '../apps/production-extension/browser-debug-shared.js';
import { readSocialSnapshot } from '../packages/contracts/src/inspection.mjs';
import { socialNativeFixtures, socialNativeExpected, socialNativeMain, socialNativePixel, socialNativeStub } from './test/social-native-fixtures.mjs';
import { socialLayoutMetrics } from './test/social-layout-metrics.mjs';
import { thirdPartyLayoutMetrics } from './test/third-party-layout-metrics.mjs';
import { readThirdPartySnapshot } from '../packages/contracts/src/third-party.mjs';
import { readBeaconSnapshot } from '../packages/contracts/src/beacons.mjs';
import { readBackgroundSnapshot } from '../packages/contracts/src/background-activity.mjs';
import { readCookieProbeSnapshot } from '../packages/contracts/src/cookie-probe.mjs';
import { advancedBeaconFixtures, advancedBeaconHosts, advancedCanaries, serveAdvancedNative, serveAdvancedBeacon } from './test/advanced-native-fixtures.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tools = join(root, '.tmp', 'firefox', 'tools');
const run = join(root, '.tmp', 'firefox', 'runs', Date.now().toString());
mkdirSync(run, { recursive: true });
mkdirSync(tools, { recursive: true });
const log = createWriteStream(join(run, 'geckodriver.log'));
const DRIVER_VERSION = '0.37.1';
let binary = process.env.FIREFOX_BINARY;
if (!binary && process.platform === 'win32') {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command',
    "(Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\firefox.exe').'\x28default\x29'"], { encoding: 'utf8' });
  binary = result.stdout.trim();
}
if (!binary) throw new Error('Set FIREFOX_BINARY to the installed Firefox executable');
let driverPath = process.env.GECKODRIVER_BINARY ?? join(tools, 'geckodriver.exe');
if (!existsSync(driverPath)) {
  if (process.platform !== 'win32') throw new Error('Set GECKODRIVER_BINARY; automatic download currently targets Windows x64');
  const zipPath = join(tools, 'geckodriver.zip');
  const response = await fetch('https://github.com/mozilla/geckodriver/releases/download/v' + DRIVER_VERSION + '/geckodriver-v' + DRIVER_VERSION + '-win64.zip');
  if (!response.ok) throw new Error('Official geckodriver download failed: ' + response.status);
  writeFileSync(zipPath, Buffer.from(await response.arrayBuffer()));
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command',
    'Expand-Archive -LiteralPath $env:DETECT_GECKO_ZIP -DestinationPath $env:DETECT_GECKO_TOOLS -Force'],
  { env: { ...process.env, DETECT_GECKO_ZIP: zipPath, DETECT_GECKO_TOOLS: tools }, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
}

const profile = join(run, 'profile');
mkdirSync(profile);
const uuid = randomUUID();
const fixtureHost = 'site.cookies.example.com';
// Canonical vendor URLs resolve only to this test server in the isolated profile.
// The served JavaScript consists of local fixtures, never vendor SDK code.
const loaderFixtures = new Map([
  ['https://www.googletagmanager.com/gtag/js?id=G-TEST', 'google-analytics'],
  ['https://www.googletagmanager.com/gtag/js?id=AW-123456', 'google-ads'],
  ['https://connect.facebook.net/en_US/fbevents.js', 'facebook-pixel'],
  ['https://static.hotjar.com/c/hotjar-123.js?sv=6', 'hotjar'],
  ['https://dynamic.criteo.com/js/ld/ld.js?a=1', 'criteo'],
  ['https://www.clarity.ms/tag/project123', 'microsoft-clarity'],
  ['https://analytics.tiktok.com/i18n/pixel/events.js', 'tiktok-pixel'],
  ['https://snap.licdn.com/li.lms-analytics/insight.min.js', 'linkedin-insight'],
  ['https://bat.bing.com/bat.js', 'bing-uet'],
]);
const fixtureHosts = [...new Set([...loaderFixtures.keys(), ...socialNativeFixtures.map(fixture => fixture.url)].map(url => new URL(url).hostname).concat(advancedBeaconHosts))];
const prefs = {
  'extensions.webextensions.uuids': JSON.stringify({ [FIREFOX_ID]: uuid }),
  'browser.shell.checkDefaultBrowser': false,
  'browser.startup.homepage_override.mstone': 'ignore',
  'browser.startup.page': 0,
  'browser.newtabpage.enabled': false,
  'datareporting.policy.dataSubmissionEnabled': false,
  'toolkit.telemetry.enabled': false,
  'app.update.auto': false,
  'network.proxy.type': 0,
  'network.dns.localDomains': [fixtureHost, ...fixtureHosts].join(','),
  // Only this profile's owned loopback hostname is allowlisted as a secure test context.
  'dom.securecontext.allowlist': fixtureHost,
  // CacheStorage performs its own HTTP trust check, separate from that allowlist.
  // Mozilla's native-test preference enables only this isolated laboratory profile.
  // https://github.com/mozilla/gecko-dev/blob/master/dom/cache/CacheStorage.cpp
  'dom.caches.testing.enabled': true,
  // The allowlisted HTTP laboratory page would otherwise trigger Firefox's
  // secure-to-insecure confirmation for its own local form. Test profile only.
  // https://firefox-admin-docs.mozilla.org/reference/policies/preferences/
  'security.warn_submit_secure_to_insecure': false,
  'network.dns.disablePrefetch': true,
  'network.stricttransportsecurity.preloadlist': false,
  // Firefox's own permission tests use this profile preference. The real
  // optional API and trusted UI click are tested; visual prompt acceptance is not.
  'extensions.webextOptionalPermissionPrompts': false,
};
writeFileSync(join(profile, 'user.js'), Object.entries(prefs).map(([key, value]) => 'user_pref(' + JSON.stringify(key) + ', ' + JSON.stringify(value) + ');').join('\n'));

const server = createServer((request, response) => {
  if (serveAdvancedNative(request, response)) return;
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Set-Cookie', ['_ga=COOKIE_VALUE_CANARY; Max-Age=3600; Path=/; SameSite=Lax', '_ga_ALPHA=FIRST_DYNAMIC_CANARY; Max-Age=3600; Path=/; SameSite=Lax', '_ga_BETA=SECOND_DYNAMIC_CANARY; Max-Age=3600; Path=/; SameSite=Lax', 'PHPSESSID=AUTH_VALUE_CANARY; HttpOnly; Path=/; SameSite=Lax']);
  if (new URL(request.url, 'http://local.test').pathname.endsWith('/main.js')) {
    response.setHeader('Content-Type', 'application/javascript');
    response.end(socialNativeMain);
    return;
  }
  if (request.url?.startsWith('/api/data')) {
    response.setHeader('Secure-Session-Registration', '(ES256);path="/bound";challenge="DBSC_HEADER_CANARY"');
    response.setHeader('Content-Type', 'application/json');
    response.end('{}');
    return;
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  const loggedIn = request.url?.startsWith('/signed-in');
  response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Firefox extension login fixture</title>
    <body><h1>${loggedIn ? 'Signed in successfully' : 'Login fixture'}</h1>
    <form action="/signed-in"><input name="testUser" value="laboratory"><button type="submit" id="login">Sign in</button></form>
    <button id="sample" type="button">Read technical values</button>
    <button id="load-gtm" type="button">Load local GTM fixture</button>
    <button id="load-independent" type="button">Load local independent SDK fixture</button>
    <button id="load-social" type="button">Load local social SDK and pixel fixtures</button>
    <script>const c=document.createElement('canvas');const ctx=c.getContext('2d');ctx.fillText('fixture',1,10);for(let i=0;i<4;i++)c.toDataURL();
    document.querySelector('#sample').addEventListener('click',()=>{const button=document.querySelector('#sample');button.dataset.width=String(window.innerWidth);const memory=new WebAssembly.Memory({initial:1});button.dataset.grow=String(memory.grow(1));ctx.getImageData(0,0,1,1);fetch('/api/data?secret=FIREFOX_GRAPH_QUERY_CANARY');});
    document.querySelector('#load-gtm').addEventListener('click',()=>{const s=document.createElement('script');s.src='https://www.googletagmanager.com/gtm.js?id=GTM-TEST&secret=GTM_URL_CANARY';document.head.appendChild(s);});
    document.querySelector('#load-independent').addEventListener('click',()=>{const s=document.createElement('script');s.onload=()=>{window.independentLoaded=true;};s.src='https://static.hotjar.com/c/hotjar-456.js?sv=6';document.head.appendChild(s);});
    document.querySelector('#load-social').addEventListener('click',()=>{const s=document.createElement('script');s.src='/private/SOCIAL_PATH_CANARY/main.js?secret=SOCIAL_SCRIPT_QUERY_CANARY';document.head.appendChild(s);});
    window.fixtureFunctionRealm=(window.Function===document.createElement('iframe').contentWindow?.Function);</script></body></html>`);
});
const fixtureRequests = [], advancedFixtureRequests = [], unexpectedFixtureRequests = [];
let session, endpoint, tlsServer, driver, portServer, driverError;
const evidence = { browser: null, binary, driverVersion: DRIVER_VERSION, profile, assertions: [], fixtureRequests, advancedFixtureRequests, unexpectedFixtureRequests, permissionTest: 'Production optional cookies requested by a trusted WebDriver UI click. Isolated Firefox test profile suppresses the visual permission prompt; native visual prompt acceptance remains unverified.', tlsFixture: 'Canonical HTTPS hosts resolve to loopback only in this profile; all SDK responses are local fixtures. No OS DNS/trust-store changes.', secureContextFixture: 'Only this owned loopback HTTP hostname is allowlisted in the isolated profile; Mozilla CacheStorage testing preference bypasses its separate HTTP trust check. Native insecure-form confirmation is disabled for this local laboratory form. No host or user profile changes.', at: new Date().toISOString() };
async function command(path, body, method = 'POST') {
  const response = await fetch(endpoint + path, { method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}), signal: AbortSignal.timeout(30000) });
  const value = (await response.json()).value;
  if (!response.ok || value?.error) throw new Error(JSON.stringify(value));
  return value;
}
const wd = (path, body, method) => command('/session/' + session + path, body, method);
const script = (code, args = []) => wd('/execute/sync', { script: code, args });
const asyncScript = (code, args = []) => wd('/execute/async', { script: code, args });
const send = (message) => asyncScript('const done=arguments[arguments.length-1];browser.runtime.sendMessage(arguments[0]).then(done,e=>done({error:String(e)}));', [message]);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const elementKey = 'element-6066-11e4-a52e-4f735466cecf';
async function click(selector) {
  await waitFor('const node=document.querySelector(arguments[0]);return Boolean(node&&!node.disabled&&node.getClientRects().length&&getComputedStyle(node).visibility!=="hidden");', [selector]);
  await script('document.querySelector(arguments[0]).scrollIntoView({block:"center"});', [selector]);
  const element = await wd('/element', { using: 'css selector', value: selector });
  await wd('/element/' + element[elementKey] + '/click', {});
}
async function waitFor(code, args = []) {
  for (let attempt = 0; attempt < 40; attempt++) { if (await script(code, args)) return; await sleep(150); }
  throw new Error('Firefox condition timed out: ' + code);
}
async function screenshot(name) { writeFileSync(join(run, name + '.png'), Buffer.from(await wd('/screenshot', undefined, 'GET'), 'base64')); }
try {
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const fixtureUrl = 'http://' + fixtureHost + ':' + server.address().port + '/';
  const certificatePath = join(run, 'fixture.crt'), keyPath = join(run, 'fixture.key');
  const opensslConfig = join(run, 'openssl.cnf');
  writeFileSync(opensslConfig, '[req]\ndistinguished_name=dn\n[dn]\n');
  const certificate = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certificatePath, '-days', '1', '-subj', '/CN=www.googletagmanager.com', '-addext', 'subjectAltName=' + fixtureHosts.map(host => 'DNS:' + host).join(',')], { cwd: root, env: { ...process.env, OPENSSL_CONF: opensslConfig }, windowsHide: true, encoding: 'utf8' });
  if (certificate.status !== 0) throw new Error('Local TLS fixture certificate generation failed: ' + (certificate.error?.message ?? certificate.stderr));
  tlsServer = createSecureServer({ key: readFileSync(keyPath), cert: readFileSync(certificatePath) }, (request, response) => {
    const url = new URL(request.url, 'https://' + request.headers.host);
    const entry = [...loaderFixtures.entries()].find(([resource]) => new URL(resource).href === url.href);
    const socialFixture = socialNativeFixtures.find(fixture => fixture.url === url.href);
    if (socialFixture) {
      fixtureRequests.push({ host: url.hostname, path: url.pathname });
      response.writeHead(200, { 'Content-Type': socialFixture.transport === 'script' ? 'application/javascript' : 'image/gif',
        'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      response.end(socialFixture.transport === 'script' ? socialNativeStub : socialNativePixel); return;
    }
    if (serveAdvancedBeacon(request, response)) { advancedFixtureRequests.push({ host: url.hostname, path: url.pathname, method: request.method }); return; }
    let source;
    if (url.hostname === 'www.googletagmanager.com' && url.pathname === '/gtm.js' && url.searchParams.get('id') === 'GTM-TEST') {
      source = 'window.loadedServiceIds=Object.create(null);for(const url of ' + JSON.stringify([...loaderFixtures.keys()]) + '){const script=document.createElement("script");script.src=url;document.head.appendChild(script);}';
    } else if (entry) source = 'window.loadedServiceIds[' + JSON.stringify(entry[1]) + ']=true;';
    else if (url.href === 'https://static.hotjar.com/c/hotjar-456.js?sv=6') source = 'window.independentSdkExecuted=true;';
    else { unexpectedFixtureRequests.push({ host: url.hostname, path: url.pathname }); response.writeHead(404); response.end(); return; }
    fixtureRequests.push({ host: url.hostname, path: url.pathname });
    response.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' }); response.end(source);
  });
  await new Promise((done, reject) => { tlsServer.once('error', reject); tlsServer.listen(443, '127.0.0.1', done); });
  portServer = createServer();
  await new Promise((done, reject) => { portServer.once('error', reject); portServer.listen(0, '127.0.0.1', done); });
  const driverPort = portServer.address().port;
  await new Promise((done) => portServer.close(done));
  driver = spawn(driverPath, ['--host', '127.0.0.1', '--port', String(driverPort), '--profile-root', run, '--log', 'error'], { cwd: root, windowsHide: true });
  driver.once('error', error => { driverError = error; });
  driver.stdout.pipe(log); driver.stderr.pipe(log);
  endpoint = 'http://127.0.0.1:' + driverPort;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (driverError) throw driverError;
    try { await command('/status', undefined, 'GET'); break; } catch { await sleep(100); }
  }
  const result = await command('/session', { capabilities: { alwaysMatch: { browserName: 'firefox', acceptInsecureCerts: true, 'moz:firefoxOptions': {
    binary, args: ['-headless', '-no-remote', '-profile', profile],
  } } } });
  session = result.sessionId;
  evidence.browser = result.capabilities.browserVersion;
  console.log('Firefox native runtime: ' + evidence.browser);
  const { output, manifest } = buildProduction('firefox');
  assert.deepEqual(manifest.optional_permissions, [...BROWSER_DEBUG_FIREFOX_OPTIONAL, 'userScripts', 'nativeMessaging', 'clipboardWrite']); assert.equal(manifest.permissions.includes('cookies'), false);
  evidence.assertions.push('packaged cookies permission remains optional and unmodified');
  const xpi = join(run, 'detect-expert-test.xpi');
  writeFileSync(xpi, archiveProduction(output));
  evidence.xpiSha256 = createHash('sha256').update(readFileSync(xpi)).digest('hex');
  evidence.packagedHashes = Object.fromEntries(['hook.early.js', 'hook.main.js', 'cookie-inspector.js', 'cookie-values.js', 'identification-ui.js', 'identification-ui.css', 'inspection-contracts.js', 'social-network-detector.js', 'social-network-observer.js', 'pro-cookie-capture.js', 'third-party-observer.js', 'third-party-contracts.js', 'beacon-decoder.js', 'beacon-observer.js', 'beacon-contracts.js', 'background-activity-observer.js', 'background-activity-contracts.js', 'cookie-probe.js', 'cookie-storage-probe.js', 'cookie-probe-contracts.js', 'advanced-ui.js', 'advanced-ui.css', 'bridge.js', 'background.js', 'report.js', 'manifest.json'].map(file => [file, createHash('sha256').update(readFileSync(join(output, file))).digest('hex')]));
  const addon = await wd('/moz/addon/install', { path: xpi, temporary: true });
  assert.equal(addon, FIREFOX_ID); evidence.assertions.push('temporary MV3 addon installed');
  await wd('/url', { url: 'moz-extension://' + uuid + '/popup.html' });
  const runtime = await script('return {id:browser.runtime.id,name:browser.runtime.getManifest().name,body:document.body.innerText};');
  assert.equal(runtime.id, FIREFOX_ID); evidence.assertions.push('popup and Promise browser API loaded');
  const consent = await send({ schemaVersion: 1, type: 'ui-data-consent-set', version: 1, accepted: true });
  assert.equal(consent.type, 'data-consent-state'); assert.equal(consent.accepted, true);
  await script('return browser.storage.local.set({"ui-language-v1":"ru"});');
  evidence.reportLanguage = 'ru';
  evidence.assertions.push('privileged moz-extension UI consent channel accepted');
  const scope = await send({ schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'all-sites' });
  assert.equal(scope.type, 'scope'); assert.equal(scope.scope.scopeMode, 'all-sites'); evidence.assertions.push('all-sites scope registration accepted');
  const registered = await script('return browser.scripting.getRegisteredContentScripts();');
  assert.ok(registered.some((value) => value.world === 'MAIN'));
  assert.ok(registered.some((value) => value.world === 'ISOLATED'));
  evidence.assertions.push('MAIN and ISOLATED document_start scripts registered');
  await wd('/url', { url: fixtureUrl }); await sleep(1500);
  if (process.env.DETECT_FIREFOX_DESCRIPTOR_DEBUG === '1') {
    const diagnosticWindow = await wd('/window/new', { type: 'tab' });
    await wd('/window', { handle: diagnosticWindow.handle });
    await wd('/url', { url: 'moz-extension://' + uuid + '/popup.html' });
    evidence.nativeIsolatedDescriptors = await script(`return browser.tabs.query({}).then(tabs => browser.scripting.executeScript({target:{tabId:tabs.find(tab=>tab.url.startsWith(arguments[0])).id,frameIds:[0]},world:"ISOLATED",func:()=>{
      const describe=(object,key)=>{for(let depth=0;object&&depth<8;depth++,object=Object.getPrototypeOf(object)){const d=Object.getOwnPropertyDescriptor(object,key);if(d)return{depth,valueType:typeof d.value,getterType:typeof d.get,getterNative:typeof d.get==='function'&&/\\[native code\\]/.test(Function.prototype.toString.call(d.get))};}return null;};
      const names=['Navigator','ServiceWorkerContainer','ServiceWorkerRegistration','ServiceWorker','PushManager','Permissions','PermissionStatus','URL','Notification','navigator','document','isSecureContext'];
      return{globals:Object.fromEntries(names.map(name=>[name,describe(globalThis,name)])),navigatorServiceWorker:describe(globalThis.Navigator?.prototype,'serviceWorker'),getRegistrations:describe(globalThis.ServiceWorkerContainer?.prototype,'getRegistrations'),secureContext:globalThis.isSecureContext};
    }}));`, [fixtureUrl]);
    throw new Error('Intentional descriptor-only diagnostic stop; this run is not native acceptance evidence');
  }
  await click('#login'); await sleep(1500);
  assert.equal(await script('return document.querySelector("h1").innerText;'), 'Signed in successfully');
  evidence.assertions.push('login form navigated without blank screen');
  const fixtureTab = await wd('/window', undefined, 'GET');
  const uiWindow = await wd('/window/new', { type: 'tab' });
  await wd('/window', { handle: uiWindow.handle });
  await wd('/url', { url: 'moz-extension://' + uuid + '/popup.html' });
  const tabs = await script('return browser.tabs.query({});');
  const tabId = tabs.find((tab) => tab.url?.startsWith(fixtureUrl)).id;
  let report;
  for (let attempt = 0; attempt < 30; attempt++) {
    report = await send({ schemaVersion: 1, type: 'ui-get-report', tabId });
    if (report.report?.techniques?.some((item) => item.count > 0)) break;
    await sleep(150);
  }
  evidence.report = report;
  assert.equal(report.type, 'report');
  assert.ok(report.report.techniques.some((item) => item.count > 0));
  assert.ok(report.report.coverageFlags.includes('network-limited'));
  assert.equal(report.report.coverageState, 'partial');
  evidence.assertions.push('private ISOLATED document identity delivered sensor counters');
  const oldKey = report.report.documentKey;
  await wd('/window', { handle: fixtureTab });
  await wd('/url', { url: fixtureUrl + '?second-document=1' }); await sleep(1200);
  await wd('/window', { handle: uiWindow.handle });
  const nextReport = await send({ schemaVersion: 1, type: 'ui-get-report', tabId });
  assert.notEqual(nextReport.report.documentKey, oldKey);
  evidence.assertions.push('navigation creates a separate report identity');
  const cookieRequest = { schemaVersion: 1, type: 'ui-get-cookies', tabId, frameId: 0, documentKey: nextReport.report.documentKey };
  const missingCookies = await send(cookieRequest);
  assert.equal(missingCookies.permission, 'required'); assert.deepEqual(missingCookies.entries, []);
  assert.equal(await script('return browser.permissions.contains({permissions:["cookies"]});'), false);
  await script('return browser.tabs.update(arguments[0],{active:true});', [tabId]);
  await wd('/refresh', {});
  await waitFor('return Boolean(document.querySelector("[data-identification-tab=cookie]"));');
  await click('[data-identification-tab="cookie"]');
  await waitFor('return Boolean(document.querySelector("[data-cookie-action=grant]:not(:disabled)"));');
  await click('[data-cookie-action="grant"]');
  await waitFor('return browser.permissions.contains({permissions:["cookies"]});');
  evidence.assertions.push('ungranted optional Cookie API granted by trusted Firefox UI click (test profile suppresses visual prompt)');
  const cookieState = await send(cookieRequest);
  assert.equal(cookieState.type, 'cookies-state', JSON.stringify(cookieState));
  assert.equal(cookieState.permission, 'granted'); assert.equal(cookieState.trackingCount, 3); assert.equal(cookieState.entries.length, 4);
  assert.equal(cookieState.totalCount, 4); assert.equal(cookieState.siteCount, 4);
  assert.equal(cookieState.entries.filter(entry => entry.name === '_ga_*').length, 2);
  assert.equal(cookieState.entries.find(entry => entry.name === 'PHPSESSID').tracking, false);
  assert.equal(cookieState.entries.find(entry => entry.name === 'PHPSESSID').httpOnly, true);
  assert.ok(cookieState.entries.every(entry => entry.domain === 'example.com'), 'stored domains use the existing registrable-domain redaction');
  const nativeStore = await script('return browser.cookies.getAllCookieStores().then(stores=>{const store=stores.find(store=>store.tabIds.includes(arguments[0]));return store?browser.cookies.getAll({url:arguments[1],storeId:store.id}).then(rows=>({selected:true,storeId:store.id,cookieCount:rows.length,names:rows.map(row=>row.name)})):{selected:false};});', [tabId, fixtureUrl]);
  assert.equal(nativeStore.selected, true); assert.equal(nativeStore.cookieCount, 4);
  assert.deepEqual(nativeStore.names.sort(), ['PHPSESSID', '_ga', '_ga_ALPHA', '_ga_BETA'].sort());
  assert.equal(Object.hasOwn(cookieState, 'sessionBinding'), false);
  evidence.cookies = cookieState;
  evidence.assertions.push('native selected-store cookie metadata masks two distinct _ga suffixes and excludes HttpOnly authentication cookie from tracking badge');
  evidence.assertions.push('removed DBSC state stays absent; no hardware binding claim');
  await waitFor('return document.querySelector("[data-identification-count=cookie]")?.textContent==="3";');
  assert.equal(await script('return document.querySelectorAll("[data-identification-tab]").length;'), 7);
  assert.equal(await script('return document.querySelectorAll("[data-cookie-tracking=true]").length;'), 3);
  assert.equal(await script('return document.querySelectorAll("[data-cookie-tracking=false]").length;'), 1);
  assert.match(await script('return document.querySelector("[data-cookie-total]").textContent;'), /4/);
  assert.match(await script('return document.querySelector("[data-identification-tab=cookie] .identification-tab__label").textContent;'), /4/);
  await waitFor('return [...document.querySelectorAll(".cookie-entry__company [data-company-brand] img")].length===3&&[...document.querySelectorAll(".cookie-entry__company [data-company-brand] img")].every(img=>img.complete&&img.src.startsWith("moz-extension://"));');
  // Firefox reports naturalWidth=0 for these viewBox-only SVGs. Native decode
  // and the rendered CSS dimensions verify a drawable local image instead.
  evidence.brandImages = await script('return Promise.all([...document.querySelectorAll(".cookie-entry__company [data-company-brand] img")].map(img=>img.decode().then(()=>{const rect=img.getBoundingClientRect();return {decoded:true,currentSrc:img.currentSrc,complete:img.complete,naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,width:rect.width,height:rect.height};})));');
  assert.ok(evidence.brandImages.every(img => img.decoded && img.complete && img.currentSrc.startsWith('moz-extension://') && img.width === 20 && img.height === 20));
  assert.equal(await script('return document.querySelectorAll("[data-cookie-analysis]").length;'), 4);
  evidence.assertions.push('Cookie total label is four while red tracking badge is three; native local brand images and per-cookie analysis render');
  await screenshot('cookie-tabs-firefox');
  // Trusted keyboard events exercise roving tab focus in the actual UI.
  const cookieTabElement = await wd('/element', { using: 'css selector', value: '[data-identification-tab="cookie"]' });
  await wd('/element/' + cookieTabElement[elementKey] + '/value', { text: '\uE011', value: ['\uE011'] });
  assert.equal(await script('return document.querySelector("[data-identification-tab=active]").getAttribute("aria-selected");'), 'true');
  await click('[data-identification-tab="cookie"]');
  await wd('/element/' + cookieTabElement[elementKey] + '/value', { text: '\uE010', value: ['\uE010'] });
  assert.equal(await script('return document.querySelector("[data-identification-tab=background]").getAttribute("aria-selected");'), 'true');
  await click('[data-identification-tab="cookie"]');
  evidence.assertions.push('seven native identification tabs, tracking badge and keyboard Home/End navigation');
  const pro = await send({ schemaVersion: 1, type: 'ui-pro-start', tabId });
  assert.equal(pro.type, 'pro-state'); assert.equal(pro.session.status, 'recording');
  await wd('/url', { url: 'about:blank' });
  await wd('/window', { handle: fixtureTab });
  await script('document.cookie="CLOSED_UI_FIXTURE=CLOSED_UI_VALUE_CANARY; Path=/; SameSite=Lax";');
  await sleep(6500);
  await wd('/window', { handle: uiWindow.handle });
  // Options has no Cookie panel: reading native session storage here cannot
  // trigger the Cookie inventory query which this test is meant to exclude.
  await wd('/url', { url: 'moz-extension://' + uuid + '/options.html' });
  let closedCapture = await script('return browser.storage.session.get("pro-recording-v1").then(value=>value["pro-recording-v1"]?.session);');
  assert.ok(closedCapture?.pages.some(page => page.cookies?.totalCount === 5), 'Pro captures the newly added cookie while its popup is closed');
  assert.equal(JSON.stringify(closedCapture).includes('CLOSED_UI_VALUE_CANARY'), false);
  await wd('/url', { url: 'about:blank' });
  await wd('/window', { handle: fixtureTab });
  await script('document.cookie="CLOSED_UI_FIXTURE=; Max-Age=0; Path=/; SameSite=Lax";');
  await sleep(6500);
  await wd('/window', { handle: uiWindow.handle });
  await wd('/url', { url: 'moz-extension://' + uuid + '/options.html' });
  closedCapture = await script('return browser.storage.session.get("pro-recording-v1").then(value=>value["pro-recording-v1"]?.session);');
  assert.ok(closedCapture?.pages.some(page => page.cookies?.totalCount === 4), 'closed UI inventory refreshes after cookie removal');
  evidence.assertions.push('native Pro automatically captures and refreshes Cookie metadata while its popup is closed, without a manual cookie query');
  await wd('/url', { url: 'moz-extension://' + uuid + '/popup.html' });
  await script('return browser.tabs.update(arguments[0],{active:true});', [tabId]);
  await wd('/refresh', {});
  await waitFor('return Boolean(document.querySelector("[data-identification-tab=cookie]"));');
  await click('[data-identification-tab="cookie"]');
  // Only controlled fixture values are revealed; real profile cookies are never
  // consulted. A refresh issues the live handles aligned to the displayed rows.
  await click('[data-cookie-action="refresh"]');
  await waitFor('return document.querySelectorAll("[data-cookie-value-action=show]:not(:disabled)").length===4;');
  assert.equal(await script('return document.querySelectorAll("[data-cookie-value-text]").length;'), 0, 'values are absent before a trusted reveal click');
  const valueCards = await script('return [...document.querySelectorAll(".cookie-entry")].map(card=>({name:card.querySelector(".cookie-entry__name").textContent,index:Number(card.querySelector("[data-cookie-value]").dataset.cookieValue)}));');
  assert.equal(valueCards.length, 4);
  const revealedDynamic = [];
  for (const card of valueCards) {
    const section = '[data-cookie-value="' + card.index + '"]';
    await click(section + ' [data-cookie-value-action="show"]');
    await waitFor('return Boolean(document.querySelector(arguments[0]+" [data-cookie-value-text]"));', [section]);
    assert.equal(await script('return document.querySelectorAll("[data-cookie-value-text]").length;'), 1, 'only one cookie value is retained in the live view');
    const shown = await script('return document.querySelector(arguments[0]+" [data-cookie-value-text]").textContent;', [section]);
    if (card.name === '_ga_*') revealedDynamic.push(shown);
    else assert.equal(shown, card.name === '_ga' ? 'COOKIE_VALUE_CANARY' : 'AUTH_VALUE_CANARY');
    await click(section + ' [data-cookie-value-action="hide"]');
    await waitFor('return document.querySelectorAll("[data-cookie-value-text]").length===0;');
  }
  assert.deepEqual(revealedDynamic.sort(), ['FIRST_DYNAMIC_CANARY', 'SECOND_DYNAMIC_CANARY'].sort(), 'two masked names reveal their own distinct native identities');
  evidence.cookieValueFixture = { explicitClickOnly: true, shownRows: 4, maskedDynamicRowsDistinct: true, httpOnlyRowShown: true, retainedValuesAtMostOne: true };
  evidence.assertions.push('trusted Firefox show/hide clicks reveal four exact fixture values, including HttpOnly and two separately masked dynamic cookie names');
  const tpmFacts = await script('return [...document.querySelectorAll("[data-cookie-tpm]")].map(node=>({state:node.dataset.cookieTpm,text:node.textContent}));');
  assert.equal(tpmFacts.length, 0, 'ADR-044 removed all TPM/DBSC UI states');
  assert.equal(await script('return Boolean(document.querySelector("[data-cookie-tpm=protected],[data-cookie-tpm=confirmed],[data-cookie-tpm=true],[data-cookie-tpm-lock]"));'), false, 'no invented TPM protection lock');
  evidence.cookieTpm = { rows: 0, removed: true, confirmedLock: false };
  evidence.assertions.push('removed TPM/DBSC controls and fabricated protection locks remain absent');
  const gaCard = valueCards.find(card => card.name === '_ga');
  const gaSection = '[data-cookie-value="' + gaCard.index + '"]';
  await click(gaSection + ' [data-cookie-value-action="show"]');
  await waitFor('return Boolean(document.querySelector("[data-cookie-value-text]"));');
  await click('[data-identification-tab="passive"]');
  await waitFor('return document.querySelectorAll("[data-cookie-value-text]").length===0;');
  await click('[data-identification-tab="cookie"]');
  await waitFor('return document.querySelectorAll("[data-cookie-value-action=show]:not(:disabled)").length===4;');
  // Some browsers reject directional Unicode in native cookie values. Both
  // accepted Unicode and ASCII markup take the production live-value path.
  let unsafeValue = '<img/src=x/onerror=window.__cookieValueXss=true>\u202e';
  const directionalAccepted = await script('return browser.cookies.set({url:arguments[0],storeId:arguments[1],name:"_ga",value:arguments[2],path:"/",sameSite:"lax"}).then(cookie=>cookie?.value===arguments[2],()=>false);', [fixtureUrl, nativeStore.storeId, unsafeValue]);
  if (!directionalAccepted) {
    unsafeValue = '<img/src=x/onerror=window.__cookieValueXss=true>';
    assert.equal(await script('return browser.cookies.set({url:arguments[0],storeId:arguments[1],name:"_ga",value:arguments[2],path:"/",sameSite:"lax"}).then(cookie=>cookie?.value===arguments[2]);', [fixtureUrl, nativeStore.storeId, unsafeValue]), true);
  }
  await click('[data-cookie-action="refresh"]');
  await waitFor('return document.querySelectorAll("[data-cookie-value-action=show]:not(:disabled)").length===4;');
  await click(gaSection + ' [data-cookie-value-action="show"]');
  await waitFor('return Boolean(document.querySelector("[data-cookie-value-text]"));');
  assert.equal(await script('return document.querySelector("[data-cookie-value-text]").textContent;'), unsafeValue.replace(/\u202e/g, '\\u202e'));
  assert.equal(await script('return Boolean(document.querySelector("[data-cookie-value-text]")?.children.length)||window.__cookieValueXss===true;'), false, 'native value renders as inert text');
  await script('window.dispatchEvent(new Event("beforeprint"));');
  await waitFor('return document.querySelectorAll("[data-cookie-value-text]").length===0;');
  evidence.cookieValueText = { unsafeMarkupInert: true, directionalUnicodeNativeAccepted: directionalAccepted, beforePrintEventClearsValue: true, panelHideClearsValue: true };
  evidence.assertions.push('native live value renders markup as text, escapes accepted directional controls and clears on panel hide and beforeprint event');
  assert.equal(await script('return browser.cookies.set({url:arguments[0],storeId:arguments[1],name:"_ga",value:"COOKIE_VALUE_CANARY",path:"/",sameSite:"lax"}).then(cookie=>Boolean(cookie));', [fixtureUrl, nativeStore.storeId]), true);
  const valueStorage = await script('return browser.storage.local.get(null).then(state=>({leaked:arguments[0].some(value=>JSON.stringify(state).includes(value)),liveReply:JSON.stringify(state).includes("cookie-value-state")||JSON.stringify(state).includes("cookies-view-state")}));', [['COOKIE_VALUE_CANARY', 'AUTH_VALUE_CANARY', 'FIRST_DYNAMIC_CANARY', 'SECOND_DYNAMIC_CANARY', unsafeValue]]);
  assert.deepEqual(valueStorage, { leaked: false, liveReply: false });
  evidence.assertions.push('revealed native Cookie values and private live reply envelopes remain absent from extension persistent storage');
  await click('[data-cookie-action="refresh"]');
  await waitFor('return document.querySelectorAll("[data-cookie-value-action=show]:not(:disabled)").length===4;');
  await screenshot('cookie-values-tpm-firefox');
  await wd('/window', { handle: fixtureTab });
  await click('#load-gtm');
  await waitFor('return Object.values(window.loadedServiceIds??{}).filter(Boolean).length===9;');
  await sleep(1100);
  await wd('/window', { handle: uiWindow.handle });
  const rowsFrom = state => state.session.pages.flatMap(page => page.tagManager ?? []).flatMap(document => document.rows);
  const loaded = await send({ schemaVersion: 1, type: 'ui-pro-get', tabId });
  const loaderRows = rowsFrom(loaded);
  assert.deepEqual(loaderRows.map(row => row.target).sort(), [...loaderFixtures.values()].sort(), JSON.stringify(loaderRows));
  assert.ok(loaderRows.every(row => row.count === 1 && row.attributionConfidence === 'exact-resource' && row.evidenceSource === 'page-hook' && row.integrity === 'page-controlled'), JSON.stringify(loaderRows));
  const secondPoll = await send({ schemaVersion: 1, type: 'ui-pro-get', tabId });
  assert.deepEqual(rowsFrom(secondPoll), loaderRows, 'polling must not recount loader edges');
  await wd('/window', { handle: fixtureTab });
  await click('#load-independent');
  await waitFor('return window.independentLoaded===true && window.independentSdkExecuted===true;');
  await sleep(900);
  await wd('/window', { handle: uiWindow.handle });
  assert.deepEqual(rowsFrom(await send({ schemaVersion: 1, type: 'ui-pro-get', tabId })), loaderRows, 'independent later script must not inherit a temporal GTM parent');
  evidence.loaderRows = loaderRows;
  evidence.assertions.push('actual Firefox currentScript GTM chains to all nine locally served named SDKs with exact-resource page-controlled evidence');
  evidence.assertions.push('repeated polling does not recount chains and temporal cooccurrence creates no loader edge');
  await wd('/window', { handle: fixtureTab });
  await click('#load-social');
  await waitFor('return window.fixtureSocialReady===true&&!window.fixtureSocialError;');
  await wd('/window', { handle: uiWindow.handle });
  const socialRequest = { ...cookieRequest, type: 'ui-get-social-networks' };
  const thirdParty = readThirdPartySnapshot(await send({ ...cookieRequest, type: 'ui-get-third-party' }));
  assert.ok(thirdParty?.rows.length, 'Firefox root inventory includes third-party main-document requests without any child');
  assert.ok(thirdParty.rows.some(row => row.domain === 'hotjar.com' && row.type === 'script'));
  assert.ok(thirdParty.rows.every(row => row.evidenceSource === 'page-dom' && row.integrity === 'page-controlled' && row.script === null));
  for (const sentinel of ['GTM_URL_CANARY', 'SOCIAL_SCRIPT_QUERY_CANARY', 'SOCIAL_REQUEST_QUERY_CANARY', 'SOCIAL_PATH_CANARY', 'SOCIAL_REQUEST_BODY_CANARY']) assert.equal(JSON.stringify(thirdParty).includes(sentinel), false);
  evidence.thirdParty = thirdParty;
  await script('return browser.tabs.update(arguments[0],{active:true});', [tabId]);
  await wd('/refresh', {});
  await waitFor('return document.querySelectorAll("[data-identification-tab]").length===7;');
  await script('document.querySelector("[data-identification-tab=third-party]").click();'); // ADR-103: the per-resource table is collapsed under request kinds.
  await waitFor('return Boolean(document.querySelector("[data-third-party-details] > summary"));'); await script('document.querySelector("[data-third-party-details]").open = true;');
  await waitFor('return Boolean(document.querySelector("[data-third-party-row]"));');
  const thirdPartyLayout = await script('return (' + thirdPartyLayoutMetrics.toString() + ')();');
  assert.equal(thirdPartyLayout.display, 'block'); assert.equal(thirdPartyLayout.overflow, false);
  assert.ok(thirdPartyLayout.rows.every(row => row.cells === 4 && !row.overflow && row.labels && row.values));
  assert.equal(await script('return document.querySelector("[data-identification-count=third-party]").textContent;'), await script('return document.querySelector("[data-third-party-requests]").getAttribute("data-third-party-requests");'));
  assert.ok(Number(await script('return document.querySelector("[data-identification-count=third-party]").textContent;')) > 0);
  evidence.thirdPartyLayout = thirdPartyLayout;
  evidence.assertions.push('Firefox resource timing inventory includes main-document third-party requests; root request badge and complete narrow cards render without overflow or invented script attribution');
  await script('document.querySelector("[data-identification-tab=social]").click();');
  let social;
  for (let attempt = 0; attempt < 20; attempt++) {
    social = readSocialSnapshot(await send(socialRequest));
    if (social?.rows.filter(row => row.script?.pathTemplate === '/main.js').length === socialNativeFixtures.length) break;
    await sleep(150);
  }
  assert.ok(social, 'native social reply matches the canonical snapshot');
  const socialRows = social.rows.filter(row => row.script?.pathTemplate === '/main.js');
  assert.deepEqual(socialRows.map(row => row.service + ':' + row.kind).sort(), socialNativeExpected);
  assert.equal(socialRows.find(row => row.service === 'facebook').method, 'POST');
  assert.equal(socialRows.find(row => row.service === 'facebook').requestType, 'ping');
  assert.ok(socialRows.every(row => row.script.host === 'example.com' && row.attributionConfidence === 'exact-resource' && row.evidenceSource === 'page-hook' && row.integrity === 'page-controlled'), JSON.stringify(socialRows));
  assert.ok(social.rows.filter(row => row.evidenceSource === 'browser-network').every(row => row.script === null && row.integrity === 'browser-observed'));
  for (const sentinel of ['SOCIAL_SCRIPT_QUERY_CANARY', 'SOCIAL_REQUEST_QUERY_CANARY', 'SOCIAL_PATH_CANARY', 'SOCIAL_REQUEST_BODY_CANARY']) assert.equal(JSON.stringify(social).includes(sentinel), false);
  evidence.social = social;
  await script('return browser.tabs.update(arguments[0],{active:true});', [tabId]);
  await wd('/refresh', {});
  await waitFor('return Boolean(document.querySelector("[data-identification-tab=social]"));');
  await click('[data-identification-tab="social"]');
  await waitFor('return [...document.querySelectorAll("[data-social-script]")].some(node=>node.textContent==="example.com/main.js");');
  assert.equal(await script('return document.querySelector("[data-identification-count=social]").textContent;'), String(new Set(social.rows.map(row => row.service)).size));
  const socialLayout = await script('return (' + socialLayoutMetrics.toString() + ')();');
  assert.equal(socialLayout.tableDisplay, 'block'); assert.equal(socialLayout.headerPosition, 'absolute'); assert.equal(socialLayout.overflow, false);
  assert.deepEqual(socialLayout.roles, ['table', 'rowgroup', 'rowgroup']);
  assert.ok(socialLayout.rows.every(row => row.role === 'row' && row.cells.length === 4 && row.cells.every(cell => cell.role === 'cell' && !cell.overflow && cell.labelDisplay === 'block' && cell.labelHiddenFromAT === 'true' && cell.value)));
  evidence.socialLayout = socialLayout;
  await screenshot('social-cards-popup-firefox');
  evidence.assertions.push('narrow Social popup retains every cell as a localized labeled card, accessible table roles and no horizontal overflow');
  evidence.assertions.push('13 passive Social rows across 11 providers distinguish tracking SDKs, ordinary SDKs and pixels from native setAttribute/sendBeacon with exact initiating script');
  // ADR-030/031/032: all additional destinations resolve to the owned TLS server above.
  await wd('/window', { handle: fixtureTab });
  await script('const s=document.createElement("script");s.src="/advanced/SCRIPT_PRIVATE_PATH_CANARY/main.js";document.head.appendChild(s);');
  await waitFor('return Boolean(window.advancedFixture?.ready);');
  assert.equal(await script('return isSecureContext;'), true, 'owned loopback hostname is secure only in this test profile');
  await click('#advanced-beacons'); await waitFor('return Boolean(window.advancedFixture.beacons||window.advancedFixture.errors.length);');
  assert.deepEqual(await script('return window.advancedFixture.errors;'), []);
  const fetchSemantics = await script('return window.advancedFixture.fetchSemantics;');
  assert.deepEqual(fetchSemantics, { thenReads: 0, nativePromise: true, methodReads: 1, bodyReads: 1 });
  await click('#advanced-background'); await waitFor('return Boolean(window.advancedFixture.background||window.advancedFixture.errors.length);');
  assert.deepEqual(await script('return window.advancedFixture.errors;'), []);
  const workerSemantics = await script('return window.advancedFixture.workerSemantics;');
  assert.deepEqual(workerSemantics, { thenReads: 0, nativePromise: true, scopeReads: 1 });
  const nativeAttempts = await script('return{sync:window.advancedFixture.sync,periodic:window.advancedFixture.periodic};');
  evidence.advanced = { fetchSemantics, workerSemantics, nativeAttempts };
  await click('#advanced-storage'); await waitFor('return Boolean(window.advancedFixture.storage||window.advancedFixture.errors.length);');
  assert.deepEqual(await script('return window.advancedFixture.errors;'), []);
  await click('#advanced-restore-on');
  await wd('/window', { handle: uiWindow.handle });
  const isolatedCapabilities = (await script('return browser.scripting.executeScript({target:{tabId:arguments[0],frameIds:[0]},world:"ISOLATED",func:()=>({secureContext:isSecureContext,serviceWorkerContainer:typeof ServiceWorkerContainer!=="undefined",serviceWorkerRegistration:typeof ServiceWorkerRegistration!=="undefined"})});', [tabId]))[0].result;
  evidence.advanced.isolatedCapabilities = isolatedCapabilities;
  let advancedBeacons;
  for (let attempt = 0; attempt < 40; attempt++) {
    advancedBeacons = readBeaconSnapshot(await send({ ...cookieRequest, type: 'ui-get-beacons' }));
    if (advancedBeacons?.rows.some(row => row.service === 'meta' && row.events.includes('Purchase')) &&
        advancedBeacons.scriptCalls.some(row => row.script?.host === 'example.com' && row.script.pathTemplate === '/main.js')) break;
    await sleep(200);
  }
  evidence.advanced.beacons = advancedBeacons;
  assert.ok(advancedBeacons?.rows.length);
  for (const service of ['google-analytics', 'meta', 'linkedin', 'tiktok', 'yandex']) assert.ok(advancedBeacons.rows.some(row => row.service === service), service);
  const nativeMeta = advancedBeacons.rows.find(row => row.service === 'meta' && row.events.includes('Purchase'));
  assert.equal(nativeMeta.money[0].value, '49.99'); assert.equal(nativeMeta.identifiers.hashedEmail, 'present');
  assert.ok(advancedBeacons.rows.every(row => row.evidenceSource === 'page-dom' && row.integrity === 'page-controlled'), 'Firefox fallback must not fabricate browser document identity');
  assert.ok(advancedBeacons.scriptCalls.some(row => row.script?.host === 'example.com' && row.script.pathTemplate === '/main.js'));
  let advancedBackground;
  for (let attempt = 0; attempt < 30; attempt++) { advancedBackground = readBackgroundSnapshot(await send({ ...cookieRequest, type: 'ui-refresh-background-activity' })); if (advancedBackground?.rows.some(row => row.operation === 'ServiceWorkerContainer.register') && (advancedBackground.inventory.registrationCount >= 1 || !isolatedCapabilities.serviceWorkerContainer && advancedBackground.inventory.status === 'unsupported')) break; await sleep(200); }
  evidence.advanced.background = advancedBackground;
  assert.ok(advancedBackground); assert.equal(isolatedCapabilities.secureContext, true); assert.equal(advancedBackground.inventory.secureContext, true);
  if (isolatedCapabilities.serviceWorkerContainer) {
    assert.equal(advancedBackground.inventory.status, 'available'); assert.ok(advancedBackground.inventory.registrationCount >= 1); assert.equal(advancedBackground.inventory.pushSubscriptionCount, 0);
  } else {
    // Mozilla ServiceWorkersEnabled excludes expanded-addon principals by default.
    // Real MAIN calls remain visible; missing isolated bindings are not invented.
    // https://github.com/mozilla/gecko-dev/blob/master/dom/serviceworkers/ServiceWorkerUtils.cpp
    assert.equal(isolatedCapabilities.serviceWorkerRegistration, false); assert.equal(advancedBackground.inventory.status, 'unsupported'); assert.equal(advancedBackground.inventory.supported.serviceWorker, false); assert.equal(advancedBackground.inventory.registrationCount, null); assert.equal(advancedBackground.inventory.pushSubscriptionCount, null); assert.deepEqual(advancedBackground.inventory.registrations, []);
  }
  assert.ok(advancedBackground.rows.some(row => row.operation === 'ServiceWorkerContainer.register' && row.phase === 'async-returned'));
  if (nativeAttempts.sync === 'unsupported') assert.equal(advancedBackground.inventory.supported.sync, false);
  if (nativeAttempts.periodic === 'unsupported') assert.equal(advancedBackground.inventory.supported.periodicSync, false);
  const advancedPrivacy = object => { const text = JSON.stringify(object); for (const canary of advancedCanaries) assert.equal(text.includes(canary), false, canary); };
  advancedPrivacy(advancedBeacons); advancedPrivacy(advancedBackground);
  // Switching WebDriver to the extension tab changes Firefox's active tab.
  // Retarget its popup to the fixture exactly as the Cookie/Social flows above.
  await script('return browser.tabs.update(arguments[0],{active:true});', [tabId]);
  await wd('/refresh', {});
  await waitFor('return document.querySelectorAll("[data-identification-tab]").length===7;');
  await click('[data-identification-tab="beacons"]'); await waitFor('return document.querySelectorAll("[data-beacon-row]").length>0;');
  assert.match(await script('return document.querySelector("[data-beacon-panel]").innerText;'), /49\.99/);
  await screenshot('advanced-beacons-firefox');
  await click('[data-identification-tab="background"]'); await click('[data-background-refresh]'); await waitFor('return document.querySelectorAll("[data-background-row]").length>0;');
  assert.ok((await script('return document.querySelector("[data-background-panel]").innerText;')).includes('ServiceWorkerContainer.register'));
  if (!isolatedCapabilities.serviceWorkerContainer) {
    assert.equal(await script('const row=document.querySelector("[data-background-inventory-unavailable]");return Boolean(row&&row.offsetParent!==null);'), true);
    assert.equal(await script('return document.querySelectorAll("[data-background-capability]").length;'), 0);
  }
  await screenshot('advanced-background-firefox');
  await click('[data-identification-tab="cookie"]'); await click('[data-cookie-action="refresh"]');
  await waitFor('return [...document.querySelectorAll("[data-cookie-probe-panel] select option")].some(row=>row.textContent.startsWith("_ga · ")&&row.value);');
  const chooseProbeCookie = async () => { await waitFor('const select=document.querySelector("[data-cookie-probe-panel] select"),option=select&&[...select.options].find(row=>row.textContent.startsWith("_ga · ")&&row.value);if(!option)return false;select.value=option.value;select.dispatchEvent(new Event("change",{bubbles:true}));return true;'); await waitFor('return Boolean(document.querySelector("[data-cookie-probe-start]:not(:disabled)"));'); };
  await chooseProbeCookie(); await click('[data-cookie-probe-start]'); await waitFor('return Boolean(document.querySelector("[data-cookie-probe-result=restored-same]"));');
  const advancedPositive = readCookieProbeSnapshot(await send({ ...cookieRequest, type: 'ui-get-cookie-probe' }));
  evidence.advanced.cookiePositive = advancedPositive;
  assert.equal(advancedPositive?.result, 'restored-same'); assert.equal(advancedPositive.removalConfirmed, true); assert.equal(advancedPositive.source, 'unknown');
  for (const storage of ['localStorage', 'indexedDB', 'cacheStorage']) assert.ok(advancedPositive.matchedStores.some(row => row.storage === storage && row.count > 0), storage);
  advancedPrivacy(advancedPositive); await screenshot('advanced-cookie-restored-firefox');
  const positiveRecording = await send({ schemaVersion: 1, type: 'ui-pro-get', tabId }); assert.ok(positiveRecording.session.pages.some(page => page.cookieProbes?.some(state => state.result === 'restored-same'))); advancedPrivacy(positiveRecording);
  await wd('/window', { handle: fixtureTab }); await click('#advanced-restore-off');
  await wd('/window', { handle: uiWindow.handle });
  await script('return browser.tabs.update(arguments[0],{active:true});', [tabId]); await wd('/refresh', {});
  await waitFor('return document.querySelectorAll("[data-identification-tab]").length===7;'); await click('[data-identification-tab="cookie"]');
  await waitFor('return Boolean(document.querySelector("[data-cookie-action=refresh]"));'); await click('[data-cookie-action="refresh"]'); await chooseProbeCookie(); await click('[data-cookie-probe-start]');
  let negativeDone = false;
  for (let attempt = 0; attempt < 90; attempt++) { if (await script('return Boolean(document.querySelector("[data-cookie-probe-result=not-restored]"));')) { negativeDone = true; break; } await sleep(200); }
  assert.equal(negativeDone, true, 'negative native ten-second cookie observation completed');
  const advancedNegative = readCookieProbeSnapshot(await send({ ...cookieRequest, type: 'ui-get-cookie-probe' }));
  evidence.advanced.cookieNegative = advancedNegative;
  assert.equal(advancedNegative?.result, 'not-restored'); assert.equal(advancedNegative.cleanup, 'restored'); assert.equal(advancedNegative.observedRestorations, 0); advancedPrivacy(advancedNegative);
  await wd('/window', { handle: fixtureTab }); assert.equal(await script('return document.cookie.includes("_ga=COOKIE_VALUE_CANARY");'), true);
  await wd('/window', { handle: uiWindow.handle });
  evidence.advanced = { beacons: advancedBeacons, background: advancedBackground, cookiePositive: advancedPositive, cookieNegative: advancedNegative, fetchSemantics, workerSemantics, nativeAttempts, isolatedCapabilities };
  evidence.assertions.push('five named beacon services use native Firefox resource timing fallback; Meta Purchase/value/email-field presence and initiating script are retained without fabricating browser-network integrity');
  evidence.assertions.push('native fetch and worker registration preserve Promise semantics, add no then getter reads and call options getters once');
  evidence.assertions.push('real owned Firefox service worker registration is observed in MAIN; native isolated inventory matches actual browser bindings and does not invent registrations when expanded-addon principals lack the API');
  evidence.assertions.push('trusted selected-cookie test detects real fixture-script recreation; three storage copy kinds are counts only with unknown restoration source');
  evidence.assertions.push('negative native ten-second test restores the exact original tracking cookie and exports no values or opaque handles');
  evidence.assertions.push('Russian Beacon, Background and Cookie test panels render actual localized native results and positive outcomes enter Pro');
  const widths = [];
  for (const width of [1100, 850, 1100]) {
    await wd('/window', { handle: fixtureTab });
    await wd('/window/rect', { width, height: 750 });
    // Native page handler executes in the instrumented MAIN realm. WebDriver's
    // sandbox can own separate global constructors even when Window getters are shared.
    widths.push(await script('const button=document.querySelector("#sample");button.click();return Number(button.dataset.width);'));
    await sleep(1400);
  }
  await wd('/url', { url: fixtureUrl + 'next' });
  await sleep(1200);
  await script('document.querySelector("#sample").click();');
  await sleep(1400);
  await wd('/window', { handle: uiWindow.handle });
  const lastReport = await send({ schemaVersion: 1, type: 'ui-get-report', tabId });
  const lastCookieRequest = { ...cookieRequest, documentKey: lastReport.report.documentKey };
  const lastCookies = await send(lastCookieRequest);
  assert.equal(lastCookies.trackingCount, 3); assert.equal(Object.hasOwn(lastCookies, 'sessionBinding'), false);
  const stopped = await send({ schemaVersion: 1, type: 'ui-pro-stop', sessionId: pro.session.id });
  assert.equal(stopped.type, 'pro-state'); assert.equal(stopped.session.status, 'stopped');
  evidence.pro = stopped.session;
  assert.ok(stopped.session.pages.some(page => page.beacons?.some(state => state.rows.length)));
  assert.ok(stopped.session.pages.some(page => page.backgroundActivity?.some(state => state.rows.some(row => row.operation === 'ServiceWorkerContainer.register') && (isolatedCapabilities.serviceWorkerContainer ? state.inventory.registrationCount >= 1 : state.inventory.status === 'unsupported' && state.inventory.registrationCount === null))));
  assert.ok(stopped.session.pages.some(page => page.cookieProbes?.some(state => state.result === 'not-restored')));
  for (const canary of advancedCanaries) assert.equal(JSON.stringify(stopped.session).includes(canary), false, canary);
  const samples = stopped.session.pages.flatMap(page => page.apiValues ?? []).flatMap(document => document.rows);
  const observedWidths = samples.filter(row => row.operation === 'Window.innerWidth');
  assert.notEqual(widths[0], widths[1]);
  assert.ok(widths.every(width => observedWidths.some(row => row.value.value === width)));
  assert.ok(observedWidths.find(row => row.value.value === widths[0]).count >= 2);
  assert.equal(samples.find(row => row.operation === 'WebAssembly.Memory.grow')?.parameters[0]?.value, 1);
  assert.equal(JSON.stringify(stopped.session).includes('FIREFOX_GRAPH_QUERY_CANARY'), false);
  assert.ok(stopped.session.pages.some(page => page.cookies?.entries.length === 4));
  assert.ok(stopped.session.pages.flatMap(page => page.socialNetworks ?? []).flatMap(document => document.rows).some(row => row.script?.pathTemplate === '/main.js'));
  const recordedSocial = stopped.session.pages.flatMap(page => page.socialNetworks ?? []).flatMap(document => document.rows).filter(row => row.script?.pathTemplate === '/main.js').map(row => row.service + ':' + row.kind).sort();
  // The six known advanced hits intentionally add Social observations to the
  // same recording; retain exact equality for both independent fixture sets.
  const advancedSocialExpected = ['facebook:tracking-pixel', 'google:service-request', 'google:tracking-pixel', 'linkedin:tracking-pixel', 'tiktok:service-request', 'yandex:tracking-pixel'];
  assert.deepEqual(recordedSocial, socialNativeExpected.concat(advancedSocialExpected).sort());
  assert.equal(JSON.stringify(stopped.session).includes('SOCIAL_REQUEST_BODY_CANARY'), false);
  for (const sentinel of ['COOKIE_VALUE_CANARY', 'AUTH_VALUE_CANARY', 'FIRST_DYNAMIC_CANARY', 'SECOND_DYNAMIC_CANARY', 'DBSC_HEADER_CANARY', 'GTM_URL_CANARY', '_ga_ALPHA', '_ga_BETA', 'CLOSED_UI_VALUE_CANARY', 'SOCIAL_SCRIPT_QUERY_CANARY', 'SOCIAL_REQUEST_QUERY_CANARY', 'SOCIAL_PATH_CANARY']) {
    assert.equal(JSON.stringify(stopped.session).includes(sentinel), false, sentinel + ' absent from recording');
    assert.equal(JSON.stringify(lastCookies).includes(sentinel), false, sentinel + ' absent from cookie projection');
  }
  assert.equal(JSON.stringify(stopped.session).includes('cookie-value-state') || JSON.stringify(stopped.session).includes('cookies-view-state') || JSON.stringify(stopped.session).includes(unsafeValue), false, 'live Cookie envelopes and shown values never enter the Pro session');
  evidence.assertions.push('Pro retains distinct values, repeated counts and technical arguments');
  evidence.assertions.push('Pro stores current-document Cookie/GTM metadata and excludes cookie values, suffix identifiers, DBSC payload, GTM query and network query canaries');
  await wd('/url', { url: 'moz-extension://' + uuid + '/report.html?id=' + pro.session.id });
  await waitFor('return Boolean(document.querySelector("[data-pro-beacons]"))&&Boolean(document.querySelector("[data-pro-background]"))&&Boolean(document.querySelector("[data-pro-cookie-probes]"));');
  const advancedReportText = await script('return document.body.innerText;');
  for (const canary of advancedCanaries) assert.equal(advancedReportText.includes(canary), false, canary);
  assert.match(advancedReportText, /49\.99/); assert.match(advancedReportText, /ServiceWorkerContainer\.register/);
  evidence.assertions.push('standalone localized Pro report retains native Beacon/Background/Cookie results and excludes raw IDs, values, payloads, private paths and tags');
  await sleep(800);
  await waitFor('return Boolean(document.querySelector("[data-pro-cookies]"))&&Boolean(document.querySelector("[data-pro-tag-manager]"))&&Boolean(document.querySelector("[data-pro-social-networks]"));');
  const expectedThirdParty = stopped.session.pages.reduce((sum, page) => sum + page.resources.filter(resource => resource.relation === 'cross-site' && resource.requestCount > 0).length, 0);
  assert.equal(await script('return document.querySelectorAll("[data-pro-third-party] [data-third-party-row]").length;'), expectedThirdParty);
  evidence.assertions.push('localized standalone Pro report includes every retained third-party resource group');
  const socialInventories = stopped.session.pages.filter(page => page.socialNetworks?.some(document => document.rows.length || document.truncated)).map(page => page.socialNetworks);
  const renderedSocial = await script('return [...document.querySelectorAll("[data-pro-social-networks]")].map(section=>({rows:[...section.querySelectorAll("tr[data-social-kind]")].map(node=>[node.dataset.socialService,node.dataset.socialKind,node.dataset.socialEvidence].join(":")),documentIndices:[...section.querySelectorAll("[data-social-pro-document]")].map(node=>Number(node.dataset.socialProDocument)),counters:section.querySelectorAll("[data-social-count-source]").length,text:section.textContent}));');
  assert.equal(renderedSocial.length, socialInventories.length);
  for (const [index, documents] of socialInventories.entries()) {
    const rendered = renderedSocial[index], rows = documents.flatMap(document => document.rows);
    assert.deepEqual(rendered.rows, rows.map(row => [row.service, row.kind, row.evidenceSource].join(':')), 'every admitted Social row renders in the standalone Pro report');
    assert.deepEqual(rendered.documentIndices, documents.flatMap((document, documentIndex) => document.rows.map(() => documentIndex)), 'every report row retains the correct source document'); assert.equal(rendered.counters, rows.length);
    assert.doesNotMatch(rendered.text, /social_kind_|social_endpoint_|social_resource_|\$COUNT\$|undefined|\[object Object\]/);
  }
  evidence.assertions.push('standalone localized Pro report renders every admitted Social row, separate source counters and exact document/row totals');
  assert.equal(await script('return document.querySelectorAll("[data-pro-cookies] [data-cookie-value],[data-pro-cookies] [data-cookie-value-action],[data-pro-cookies] [data-cookie-value-text]").length;'), 0, 'standalone Cookie snapshots contain no live-value controls or text');
  const savedInventories = stopped.session.pages.filter(page => page.cookies?.permission === 'granted').map(page => page.cookies);
  const renderedInventories = await script('return [...document.querySelectorAll("[data-cookie-report-table]")].map(table=>({headers:[...table.querySelectorAll("thead th")].map(cell=>cell.textContent),collapsed:table.querySelectorAll("details").length,rows:[...table.querySelectorAll("[data-cookie-report-row]")].map(row=>({text:row.textContent,links:[...row.querySelectorAll("a")].map(link=>link.getAttribute("href")),analysis:row.querySelectorAll(".cookie-report-analysis li").length}))}));');
  assert.equal(renderedInventories.length, savedInventories.length);
  for (const [index, inventory] of savedInventories.entries()) {
    const table = renderedInventories[index];
    assert.equal(table.headers.length, 6, 'six current columns without retired DBSC/TPM'); assert.match(table.headers.join(' '), /Категория \/ отслеживание \/ подтверждение/); assert.equal(table.collapsed, 0);
    assert.equal(table.rows.length, inventory.entries.length, 'every saved cookie has a printable table row');
    for (const [rowIndex, entry] of inventory.entries.entries()) {
      const row = table.rows[rowIndex];
      for (const detail of [entry.name, entry.domain, 'Secure=', 'HttpOnly=', 'SameSite=', ...entry.ruleIds]) assert.ok(row.text.includes(detail), detail + ' appears in cookie row');
      assert.deepEqual(row.links, entry.sourceUrls, 'all documented cookie sources retained');
      assert.equal(row.analysis, 0, 'report attributes remain compact facts without duplicate analysis'); assert.doesNotMatch(row.text, /\$[A-Z_]+\$|cookie_analysis_|cookie_category_|undefined|\[object Object\]/);
    }
  }
  assert.ok(await script('return [...document.querySelectorAll("[data-pro-social-networks] [data-social-script]")].some(node=>node.textContent==="example.com/main.js");'));
  const reportSocialLayout = await script('return (' + socialLayoutMetrics.toString() + ')();');
  assert.equal(reportSocialLayout.tableDisplay, 'table'); assert.equal(reportSocialLayout.overflow, false);
  assert.equal(reportSocialLayout.headers.length, 6); assert.ok(reportSocialLayout.headers.every(header => header.text.trim().length > 0));
  assert.ok(reportSocialLayout.rows.every(row => row.cells.length === 6 && row.cells.every(cell => !cell.overflow)), 'all six current report columns fit their cells');
  evidence.reportSocialLayout = reportSocialLayout;
  evidence.assertions.push('complete localized Cookie report table renders every saved row, expanded analysis, attributes and all source URLs; Social Networks report retains the initiating script');
  const tagManagerText = await script('return document.querySelector("[data-pro-tag-manager]").innerText;');
  const serviceLabels = ['Google Analytics', 'Google Ads', 'Facebook Pixel', 'Hotjar', 'Criteo', 'Microsoft Clarity', 'TikTok Pixel', 'LinkedIn Insight', 'Microsoft Advertising UET'];
  for (const name of ['Google Tag Manager', ...serviceLabels]) assert.ok(tagManagerText.includes(name), name + ' rendered');
  const summaries = await script('return [...document.querySelectorAll("[data-pro-tag-manager] [data-tag-manager-summary]")].map(node=>node.textContent);');
  assert.equal(summaries.length, 1, 'only the visit with observed GTM chains has a summary');
  const summary = summaries[0];
  assert.ok(summary.startsWith('Google Tag Manager инициировал загрузку:'), 'Russian summary describes who initiated loading');
  for (const name of ['Google Tag Manager', ...serviceLabels]) assert.equal(summary.split(name).length - 1, 1, name + ' occurs exactly once in plaintext summary');
  assert.doesNotMatch(summary, /\$|tag_manager_loading_summary|undefined|\[object Object\]/, 'localized substitutions are resolved');
  evidence.tagManagerSummary = summary;
  await screenshot('cookie-gtm-report-firefox');
  evidence.assertions.push('Russian Pro report renders Cookie inventory, nine named GTM chains and one plaintext summary with every service exactly once and resolved substitutions');
  assert.ok((await script('return [...document.querySelectorAll(".pro-api-values")].map(node=>node.innerText).join(" ");')).includes('Window.innerWidth'));
  evidence.assertions.push('standalone Pro report renders the shared value projection');
  assert.equal(await script('return Boolean(document.querySelector(".pro-request-graph"));'), true);
  await script('const select=document.querySelector("select[data-pro-graph-filter=party]");select.value="all";select.dispatchEvent(new Event("change",{bubbles:true}));');
  assert.ok((await script('return document.querySelectorAll("button[data-pro-graph-domain]").length;')) > 0);
  await script('document.querySelector("button[data-pro-graph-domain]").click();');
  assert.equal(await script('return Boolean(document.querySelector("button[data-pro-graph-domain][aria-pressed=true]"));'), true);
  assert.ok((await script('return document.querySelector(".pro-request-graph__details").innerText;')).length > 10);
  assert.equal((await script('return document.querySelector(".pro-request-graph").innerText;')).includes('FIREFOX_GRAPH_QUERY_CANARY'), false);
  await script('document.querySelector("button[data-pro-graph-clear]").click();');
  assert.equal(await script('return document.querySelectorAll("button[data-pro-graph-domain][aria-pressed=true]").length;'), 0);
  evidence.assertions.push('shared request graph filters, domain details and clear selection render in installed Firefox');
  await wd('/url', { url: 'moz-extension://' + uuid + '/sidepanel.html' });
  assert.ok((await script('return document.body.innerText;')).length > 10);
  await waitFor('return document.querySelectorAll("[data-identification-tab]").length===7;');
  evidence.assertions.push('shared sidepanel UI loaded in Firefox');
  await script('return browser.tabs.update(arguments[0],{active:true});', [tabId]);
  await wd('/refresh', {});
  await waitFor('return document.querySelector("[data-identification-count=cookie]")?.textContent==="3";');
  await click('[data-identification-tab="cookie"]');
  // Native cookie identities below stay in the test harness, never the product
  // metadata. Set calls return booleans only; values are not read back.
  const seedClear = await script('const storeId=arguments[0],host=arguments[1];const rows=[{url:"https://"+host+"/account",name:"AMP_TEST_1791540000000",path:"/account",secure:true,httpOnly:true},{url:"http://"+host+"/",name:"same_name",path:"/"},{url:"http://"+host+"/account",name:"same_name",path:"/account"},{url:"http://api.cookies.example.com/",name:"_fw_crm_v",path:"/"},{url:"http://"+host+"/",name:"current_partition",path:"/",partitionKey:{topLevelSite:"http://example.com"}},{url:"http://"+host+"/",name:"other_partition",path:"/",partitionKey:{topLevelSite:"https://other.test"}},{url:"http://other.test/",name:"foreign_cookie",path:"/"}];return Promise.all(rows.map(row=>browser.cookies.set({...row,storeId,value:"CLEAR_COOKIE_VALUE_CANARY",sameSite:"lax"}).then(cookie=>({set:Boolean(cookie),partition:row.partitionKey?cookie?.partitionKey?.topLevelSite===row.partitionKey.topLevelSite:true}))));', [nativeStore.storeId, fixtureHost]);
  assert.ok(seedClear.every(result => result.set && result.partition), 'native Firefox cookie API accepts both exact top-site partition fixtures');
  const beforeClear = await send(lastCookieRequest);
  assert.equal(beforeClear.totalCount, 9); assert.equal(beforeClear.siteCount, 9); assert.equal(beforeClear.trackingCount, 3);
  assert.equal(beforeClear.entries.filter(entry => entry.partitioned).length, 1);
  assert.equal(JSON.stringify(beforeClear).includes('CLEAR_COOKIE_VALUE_CANARY'), false);
  const probeCookie = beforeClear.entries.find(entry => entry.name === 'AMP_TEST_*');
  assert.equal(probeCookie.owner, 'Amplitude'); assert.equal(probeCookie.category, 'functional'); assert.equal(probeCookie.tracking, false);
  const referenceCookie = beforeClear.entries.find(entry => entry.name === '_fw_crm_v');
  assert.equal(referenceCookie.owner, ''); assert.equal(referenceCookie.category, 'unknown'); assert.equal(referenceCookie.tracking, false);
  assert.match(referenceCookie.purpose, /^Catalogue name match: Freshworks/);
  evidence.cookieClearBefore = beforeClear;
  await click('[data-cookie-action="refresh"]');
  await waitFor('return document.querySelector("[data-cookie-total]")?.textContent.includes("9")&&document.querySelector("[data-identification-count=cookie]")?.textContent==="3";');
  assert.match(await script('return document.querySelector("[data-identification-tab=cookie] .identification-tab__label").textContent;'), /9/);
  assert.equal(await script('return document.querySelectorAll("[data-cookie-analysis]").length;'), 9);
  assert.match(await script('return document.querySelector("[data-cookie-name-reference]").textContent;'), /Freshworks/);
  assert.ok(await script('return document.body.textContent.includes("Совпадение имени в справочнике");'));
  evidence.assertions.push('expanded catalogue renders documented Amplitude probe and neutral Freshworks name reference without increasing tracking badge');
  assert.equal(await script('return document.querySelectorAll("[data-cookie-tpm]").length;'), 0, 'Secure/HttpOnly and CHIPS fixtures do not reintroduce removed TPM UI');
  assert.ok(await script('return [...document.querySelectorAll("[data-cookie-analysis]")].some(node=>node.open);'), 'unknown cookies expose their native UI analysis');
  await waitFor('return Boolean(document.querySelector("[data-cookie-action=clear]:not(:disabled)"));');
  await click('[data-cookie-action="clear"]');
  await waitFor('return Boolean(document.querySelector(".cookie-clear-result"))&&document.querySelector("[data-cookie-total]")?.textContent.includes("0");');
  const clearText = await script('return document.querySelector(".cookie-clear-result").textContent;');
  assert.match(clearText, /9/); assert.match(clearText, /0/); assert.doesNotMatch(clearText, /\$|undefined|\[object Object\]/);
  const afterClear = await send(lastCookieRequest);
  assert.equal(afterClear.totalCount, 0); assert.equal(afterClear.siteCount, 0); assert.equal(afterClear.trackingCount, 0); assert.deepEqual(afterClear.entries, []);
  const preserved = await script('return Promise.all([browser.cookies.getAll({domain:"example.com",storeId:arguments[0]}),browser.cookies.getAll({domain:"example.com",storeId:arguments[0],partitionKey:{topLevelSite:"http://example.com"}}),browser.cookies.getAll({domain:"example.com",storeId:arguments[0],partitionKey:{topLevelSite:"https://other.test"}}),browser.cookies.getAll({domain:"other.test",storeId:arguments[0]})]).then(groups=>groups.map(rows=>rows.map(row=>row.name)));', [nativeStore.storeId]);
  assert.deepEqual(preserved, [[], [], ['other_partition'], ['foreign_cookie']]);
  const afterClearPro = await send({ schemaVersion: 1, type: 'ui-pro-get', tabId });
  assert.equal(afterClearPro.session.pages.some(page => page.cookies?.entries.length > 0), false, 'site clear invalidates historical same-site snapshots');
  evidence.cookieClearAfter = afterClear; evidence.cookieClearText = clearText;
  evidence.cookieClearIsolation = { preservedForeignDomain: true, preservedOtherTopSitePartition: true, selectedStore: true, otherContainersNative: 'not tested; unit isolation coverage only' };
  await screenshot('cookie-cleared-firefox');
  evidence.assertions.push('trusted Firefox Clear click removes nine current-site cookies across subdomains, paths, Secure/HttpOnly and current top-site partition, then shows total zero');
  evidence.assertions.push('native clear preserves foreign-domain and other top-site partition cookies and invalidates same-site Pro inventory');
  // Restore one known tracking identity without a page request so revocation
  // still proves a nonzero native badge/snapshot is actively removed.
  assert.equal(await script('return browser.cookies.set({url:arguments[1],storeId:arguments[0],name:"_ga",value:"REVOKE_VALUE_CANARY",path:"/",sameSite:"lax"}).then(cookie=>Boolean(cookie));', [nativeStore.storeId, fixtureUrl]), true);
  await send(lastCookieRequest);
  await click('[data-cookie-action="refresh"]');
  await waitFor('return document.querySelector("[data-identification-count=cookie]")?.textContent==="1";');
  assert.equal(await script('return browser.permissions.remove({permissions:["cookies"]});'), true);
  await waitFor('return document.querySelector("[data-identification-count=cookie]")?.textContent==="0";');
  await waitFor('return Boolean(document.querySelector("[data-cookie-action=grant]"));');
  const denied = await send(lastCookieRequest); assert.equal(denied.permission, 'required'); assert.deepEqual(denied.entries, []);
  assert.equal((await send({ schemaVersion: 1, type: 'ui-pro-get', tabId })).session.pages.some(page => page.cookies), false);
  evidence.assertions.push('native permission revocation clears Cookie badges/view and retained Pro snapshots');
  assert.deepEqual(unexpectedFixtureRequests, []);
  assert.equal(fixtureRequests.length, 1 + loaderFixtures.size + 1 + socialNativeFixtures.length, 'GTM, nine SDKs, one independent SDK and all thirteen Social resources served only from local TLS');
  for (const fixture of advancedBeaconFixtures) { const url = new URL(fixture.url); assert.ok(advancedFixtureRequests.some(row => row.host === url.hostname && row.path === url.pathname && row.method === fixture.method), fixture.service + ' advanced hit served by owned TLS'); }
  console.log('Firefox smoke: PASS (' + evidence.assertions.length + ' assertions)');
  for (const item of evidence.assertions) console.log('  PASS ' + item);
} catch (error) {
  evidence.error = error?.stack ?? String(error);
  if (session) {
    try { evidence.failureUi = await script('return {body:document.body.innerText.slice(0,20000),url:location.pathname,selected:document.querySelector("[data-identification-tab][aria-selected=true]")?.dataset.identificationTab,brandImages:[...document.querySelectorAll("[data-cookie-brand] img")].map(img=>({src:img.src,complete:img.complete,width:img.naturalWidth,height:img.naturalHeight}))};'); await screenshot('failure'); } catch {}
  }
  console.error('Firefox smoke: FAIL ' + evidence.error);
  process.exitCode = 1;
} finally {
  if (session) {
    try { await command('/session/' + session, undefined, 'DELETE'); } catch {}
  }
  driver?.kill();
  for (const fixture of [server, tlsServer, portServer]) if (fixture?.listening) {
    fixture.closeAllConnections(); await new Promise((done) => fixture.close(done));
  }
  log.end();
  writeFileSync(join(run, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log('Firefox evidence: ' + join(run, 'evidence.json'));
}
