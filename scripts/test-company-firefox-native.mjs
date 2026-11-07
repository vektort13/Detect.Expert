// ADR-034/035: installed Firefox, unchanged production XPI and owned network stubs.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { archiveProduction, FIREFOX_ID } from './build-production.mjs';
import { advancedBeaconFixtures } from './test/advanced-native-fixtures.mjs';
import { readOwnedTechnicalValues, assertTechnicalValues } from './test/pro-values-native-fixtures.mjs';
const root = resolve(import.meta.dirname, '..'), output = join(root, 'dist/firefox');
const coreCompanies = JSON.parse(readFileSync(join(root, 'docs/coverage/company-logos.json'), 'utf8')).groups.antifraud.map(({ id, name }) => ({ id, name }));
assert.equal(coreCompanies.length, 32);
assert.ok(existsSync(join(output, 'site-favicon-ui.js')), 'Build final Firefox with favicon modules first');
const run = mkdtempSync(join(root, '.tmp/company-firefox-')), profile = join(run, 'profile'), artifact = join(root, 'test-results/production-1.1.0/company-logos');
mkdirSync(profile); mkdirSync(artifact, { recursive: true });
const uuid = randomUUID(), host = 'site.company.example.com', childHost = 'frame.company.example.net', prefs = {
  'extensions.webextensions.uuids': JSON.stringify({ [FIREFOX_ID]: uuid }), 'network.proxy.type': 0,
  'network.dns.localDomains': host + ',' + childHost, 'extensions.webextOptionalPermissionPrompts': false,
  'privacy.trackingprotection.enabled': false, 'privacy.trackingprotection.pbmode.enabled': false,
  'privacy.trackingprotection.fingerprinting.enabled': false, 'privacy.trackingprotection.cryptomining.enabled': false,
  'privacy.trackingprotection.socialtracking.enabled': false,
  'browser.shell.checkDefaultBrowser': false, 'browser.startup.page': 0, 'browser.newtabpage.enabled': false,
  'datareporting.policy.dataSubmissionEnabled': false, 'toolkit.telemetry.enabled': false, 'app.update.auto': false
};
writeFileSync(join(profile, 'user.js'), Object.entries(prefs).map(([key, value]) => 'user_pref(' + JSON.stringify(key) + ', ' + JSON.stringify(value) + ');').join('\n'));
const binary = spawnSync('powershell.exe', ['-NoProfile', '-Command', "(Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\firefox.exe').'(default)'"], { encoding: 'utf8', windowsHide: true }).stdout.trim(); assert.ok(binary);
const urls = ['https://www.google.com/recaptcha/api.js', 'https://js.datadome.co/tags.js', 'https://h.online-metrix.net/fp/tags.js', 'https://www.googletagmanager.com/gtm.js?id=GTM-TEST'];
const children = ['https://connect.facebook.net/en_US/fbevents.js', 'https://static.hotjar.com/c/hotjar-123.js?sv=6', 'https://dynamic.criteo.com/js/ld/ld.js?a=1'];
const evidence = { errors: [], unexpectedRequests: [], intercepted: [], supplied: [], checks: [], packagedHashes: Object.fromEntries(['company-branding.js', 'company-ui.js', 'company-ui.css', 'site-favicon.js', 'site-favicon-ui.js', 'site-favicon.css', 'identification-ui.js', 'advanced-ui.js', 'pro-report-tables.js', 'report.css', 'background.js', 'popup.js', 'sidepanel.js', 'report.js', 'manifest.json', 'icons/brands/COMPANY-PROVENANCE.json'].map(file => [file, createHash('sha256').update(readFileSync(join(output, file))).digest('hex')])) };
const technicalSamples = [];
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.url?.startsWith('/favicon')) { response.setHeader('Content-Type', 'image/svg+xml'); const color = request.url.includes('second') ? '#b21d44' : '#167a83'; response.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="' + color + '"/><path d="M8 25L16 7l8 18z" fill="#fff"/></svg>'); return; }
  response.setHeader('Set-Cookie', ['_ga=COMPANY_COOKIE_CANARY; Max-Age=3600; Path=/; SameSite=Lax', '_fbp=COMPANY_META_CANARY; Max-Age=3600; Path=/; SameSite=Lax', 'PHPSESSID=COMPANY_AUTH_CANARY; HttpOnly; Path=/; SameSite=Lax']);
  response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end('<!doctype html><html><head><title>Owned company logo fixture</title><link rel="icon" href="/favicon.svg"></head><body><h1>Owned company logo fixture</h1><script>window.readOwnedTechnicalValues = ' + readOwnedTechnicalValues.toString() + ';</script></body></html>');
});
await new Promise(done => server.listen(0, '127.0.0.1', done)); const origin = 'http://' + host + ':' + server.address().port;
const ports = createServer(); await new Promise(done => ports.listen(0, '127.0.0.1', done)); const port = ports.address().port; await new Promise(done => ports.close(done));
const endpoint = 'http://127.0.0.1:' + port, driver = spawn(join(root, '.tmp/firefox/tools/geckodriver.exe'), ['--host', '127.0.0.1', '--port', String(port), '--profile-root', run, '--log', 'error'], { cwd: root, windowsHide: true });
let session, websocket, uiWindow, siteWindow, reportWindow, nativeTabId;
async function command(path, body, method = 'POST') { const response = await fetch(endpoint + path, { method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}), signal: AbortSignal.timeout(30000) }); const value = (await response.json()).value; if (!response.ok || value?.error) throw Error(JSON.stringify(value)); return value; }
const wd = (path, body, method) => command('/session/' + session + path, body, method), script = (code, args = []) => wd('/execute/sync', { script: code, args }), asyncScript = (code, args = []) => wd('/execute/async', { script: code, args });
const send = message => asyncScript('const done=arguments[arguments.length-1];browser.runtime.sendMessage(arguments[0]).then(done,error=>done({error:String(error)}));', [message]);
const sleep = ms => new Promise(done => setTimeout(done, ms));
async function waitFor(code, args = [], attempts = 90) { for (let i = 0; i < attempts; i++) { if (await script(code, args)) return; await sleep(100); } throw Error('Native Firefox timeout: ' + code); }
async function click(selector) { await waitFor('return Boolean(document.querySelector(arguments[0]));', [selector]); const element = await wd('/element', { using: 'css selector', value: selector }); await wd('/element/' + element['element-6066-11e4-a52e-4f735466cecf'] + '/click', {}); }
async function selectPanel(name) {
  const selector = '[data-identification-tab="' + name + '"]'; await waitFor('return Boolean(document.querySelector(arguments[0]));', [selector]);
  // A native WebDriver element click focuses the extension tab in Firefox. Keep
  // the owned target active while invoking the real panel handler in its UI.
  await script('document.querySelector(arguments[0]).click();return browser.tabs.update(arguments[1],{active:true});', [selector, nativeTabId]);
  await waitFor('return document.querySelector(arguments[0])?.getAttribute("aria-selected")==="true";', [selector]);
}
async function screenshot(name) { writeFileSync(join(artifact, name + '.png'), Buffer.from(await wd('/screenshot', undefined, 'GET'), 'base64')); }
async function elementScreenshot(selector, name) {
  const element = await wd('/element', { using: 'css selector', value: selector });
  writeFileSync(join(artifact, name + '.png'), Buffer.from(await wd('/element/' + element['element-6066-11e4-a52e-4f735466cecf'] + '/screenshot', undefined, 'GET'), 'base64'));
}
async function requireLogos(selector, minimum = 1) {
  await waitFor('return [...document.querySelectorAll(arguments[0]+" [data-company-logo]")].filter(image=>{const box=image.getBoundingClientRect();return image.isConnected&&box.width>0&&box.height>0;}).length>=arguments[1];', [selector, minimum]);
  const result = await asyncScript(`const done=arguments[arguments.length-1],selector=arguments[0];(async()=>{
    const registryUrl=new URL('company-branding.js',location.href).href,{COMPANY_BRANDS}=await import(registryUrl);
    const vectors=new Set(COMPANY_BRANDS.filter(brand=>brand.file.endsWith('.svg')).map(brand=>new URL('./icons/brands/'+brand.file,registryUrl).href));
    return Promise.all([...document.querySelectorAll(selector+' [data-company-logo]')].filter(image=>{const box=image.getBoundingClientRect();return image.isConnected&&box.width>0&&box.height>0;}).map(async image=>{
      await image.decode();await new Promise(finish=>setTimeout(finish,0));
      const box=image.getBoundingClientRect(),source=image.currentSrc||image.src,intrinsic=image.naturalWidth>0&&image.naturalHeight>0;
      const packagedSvg=vectors.has(source)&&box.width>0&&box.height>0;
      return{brand:image.dataset.companyLogo,decoded:image.isConnected&&image.complete&&(intrinsic||packagedSvg),packagedSvg,connected:image.isConnected,complete:image.complete,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,width:box.width,height:box.height,source:new URL(source).protocol,path:new URL(source).pathname};
    }));
  })().then(done,error=>done({error:String(error)}));`, [selector]);
  assert.ok(Array.isArray(result) && result.length >= minimum, selector + ': actual images'); assert.ok(result.every(row => row.decoded && row.width === row.height && [18,20,28].includes(row.width) && row.source === 'moz-extension:'), selector + ': native decoded fixed local marks ' + JSON.stringify(result)); return result;
}
async function requirePrintGates(selector = null) {
  const gates = await asyncScript(`const done=arguments[arguments.length-1],selector=arguments[0];(async()=>{
    const [{waitForCompanyImages},{waitForSiteIcons}]=await Promise.all([import(new URL('company-ui.js',location.href).href),import(new URL('site-favicon-ui.js',location.href).href)]);
    const container=selector?document.querySelector(selector):document;
    const [company,site]=await Promise.all([waitForCompanyImages(container),waitForSiteIcons(container)]);return{company,site};
  })().then(done,error=>done({error:String(error)}));`, [selector]);
  assert.deepEqual(gates, { company: true, site: true }); return gates;
}
async function requireOwnedCompanyComponents() {
  await asyncScript(`const done=arguments[arguments.length-1],companies=arguments[0];(async()=>{
    const {createCompanyUi}=await import(new URL('company-ui.js',location.href).href);
    const append=(node,child)=>{if(Array.isArray(child))for(const value of child)append(node,value);else if(child!==undefined&&child!==null)node.append(child instanceof Node?child:document.createTextNode(String(child)));};
    const h=(type,props={})=>{if(typeof type==='function')return type(props);const node=document.createElement(type);for(const [name,value]of Object.entries(props))if(name!=='children')node.setAttribute(name,String(value));append(node,props.children);return node;};
    const {CompanyLabel}=createCompanyUi({h}),container=document.createElement('section');container.id='native-owned-company-components';container.dir='rtl';container.style.cssText='width:292px;padding:10px;background:white';
    for(const company of companies)for(const [heading,size]of [['h3','large'],['h5','compact']])container.append(h(heading,{children:h(CompanyLabel,{name:company.name,identity:company.id,size})}));
    document.body.append(container);return true;
  })().then(done,error=>done({error:String(error)}));`, [coreCompanies]);
  try {
    const images = await requireLogos('#native-owned-company-components', 64);
    assert.equal(images.length, 64); assert.equal(images.filter(image => image.width === 28).length, 32); assert.equal(images.filter(image => image.width === 20).length, 32);
    const result = await script('const node=document.querySelector("#native-owned-company-components");return{fixtureOnly:true,antifraudIdentities:arguments[0],headings:{h3:node.querySelectorAll("h3 [data-company-logo]").length,h5:node.querySelectorAll("h5 [data-company-logo]").length},overflow:[...node.querySelectorAll(".company-label,.company-label__name")].filter(label=>label.clientWidth&&label.scrollWidth>label.clientWidth+1).map(label=>label.textContent)};', [coreCompanies.length]);
    assert.deepEqual(result.headings, { h3: 32, h5: 32 }); assert.deepEqual(result.overflow, []); result.images = images; result.printGates = await requirePrintGates('#native-owned-company-components');
    await elementScreenshot('#native-owned-company-components', 'native-firefox-components-fixture-rtl'); return result;
  } finally { await script('document.querySelector("#native-owned-company-components")?.remove();'); }
}
async function cache() { return script('return browser.storage.local.get("site-icons:v1").then(values=>values["site-icons:v1"]);'); }
const pending = new Map(); let next = 0;
function bidi(method, params) { return new Promise((resolve, reject) => { const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(Error(method + ': BiDi timeout')); }, 10000); pending.set(id, { resolve, reject, timer }); websocket.send(JSON.stringify({ id, method, params })); }); }
try {
  for (let i = 0; i < 80; i++) { try { await command('/status', undefined, 'GET'); break; } catch { await sleep(100); } }
  const opened = await command('/session', { capabilities: { alwaysMatch: { browserName: 'firefox', webSocketUrl: true, 'moz:firefoxOptions': { binary, args: ['-headless', '-no-remote', '-profile', profile] } } } }); session = opened.sessionId; evidence.browser = opened.capabilities.browserVersion;
  websocket = new WebSocket(opened.capabilities.webSocketUrl); await new Promise((done, reject) => { websocket.addEventListener('open', done, { once: true }); websocket.addEventListener('error', reject, { once: true }); });
  websocket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) { const operation = pending.get(message.id); if (operation) { pending.delete(message.id); clearTimeout(operation.timer); if (message.type === 'error') operation.reject(Error(JSON.stringify(message))); else operation.resolve(message.result); } return; }
    if (message.method !== 'network.beforeRequestSent' || !message.params.isBlocked) return;
    const request = message.params.request, url = request.url;
    evidence.intercepted.push(url);
    if (!urls.includes(url) && !children.includes(url) && !advancedBeaconFixtures.some(row => row.url === url)) evidence.unexpectedRequests.push(new URL(url).origin);
    const source = url.startsWith('https://www.googletagmanager.com/') ? 'for(const url of ' + JSON.stringify(children) + '){const node=document.createElement("script");node.src=url;document.head.appendChild(node);}' : 'window.companyFixtureLoaded=(window.companyFixtureLoaded||0)+1;';
    bidi('network.provideResponse', { request: request.request, statusCode: 200, headers: [{ name: 'Content-Type', value: { type: 'string', value: urls.includes(url) || children.includes(url) ? 'application/javascript' : 'text/plain' } }, { name: 'Access-Control-Allow-Origin', value: { type: 'string', value: '*' } }, { name: 'Access-Control-Allow-Methods', value: { type: 'string', value: 'GET, POST, OPTIONS' } }, { name: 'Access-Control-Allow-Headers', value: { type: 'string', value: 'Content-Type' } }], body: { type: 'string', value: source } }).then(() => evidence.supplied.push(url), error => { evidence.errors.push(error.message); void bidi('network.failRequest', { request: request.request }).catch(() => {}); });
  });
  await bidi('session.subscribe', { events: ['network.beforeRequestSent'] }); await bidi('network.addIntercept', { phases: ['beforeRequestSent'], urlPatterns: [{ type: 'pattern', protocol: 'https' }] });
  const xpi = join(run, 'detect-expert-company-test.xpi'); writeFileSync(xpi, archiveProduction(output)); evidence.xpiSha256 = createHash('sha256').update(readFileSync(xpi)).digest('hex'); assert.equal(await wd('/moz/addon/install', { path: xpi, temporary: true }), FIREFOX_ID);
  const base = 'moz-extension://' + uuid; await wd('/url', { url: base + '/popup.html' }); uiWindow = await wd('/window', undefined, 'GET');
  assert.equal((await send({ schemaVersion: 1, type: 'ui-data-consent-set', version: 1, accepted: true })).accepted, true); await send({ schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'all-sites' }); await script('return browser.storage.local.set({"ui-language-v1":"ru"});');
  siteWindow = (await wd('/window/new', { type: 'tab' })).handle; await wd('/window', { handle: siteWindow }); await wd('/url', { url: origin }); await sleep(500);
  await wd('/window', { handle: uiWindow }); const tab = await script('return browser.tabs.query({}).then(tabs=>tabs.find(tab=>tab.url===arguments[0]));', [origin + '/']); assert.ok(tab?.id); nativeTabId = tab.id;
  await script('return browser.tabs.update(arguments[0],{active:true});', [tab.id]); await wd('/refresh', {}); await waitFor('return Boolean(document.querySelector("[data-identification-tab=cookie]"));');
  await click('[data-identification-tab="cookie"]'); await waitFor('return Boolean(document.querySelector("[data-cookie-action=grant]:not(:disabled)"));'); await click('[data-cookie-action="grant"]'); await waitFor('return browser.permissions.contains({permissions:["cookies"]});'); evidence.cookies = await requireLogos('.cookie-entry', 2); console.log(JSON.stringify({ stage: 'cookies', logos: evidence.cookies.length }));
  const started = await send({ schemaVersion: 1, type: 'ui-pro-start', tabId: tab.id }); assert.equal(started.type, 'pro-state');
  await wd('/window', { handle: siteWindow }); await sleep(1100);
  technicalSamples.push(await script('return window.readOwnedTechnicalValues(arguments[0]);', [137]));
  const childOrigin = 'http://' + childHost + ':' + server.address().port;
  const frameResult = await asyncScript('const done=arguments[arguments.length-1],frame=document.createElement("iframe");frame.id="owned-technical-frame";frame.src=arguments[0];frame.onload=()=>done(true);frame.onerror=()=>done(false);document.body.append(frame);', [childOrigin + '/frame']);
  assert.equal(frameResult, true); await sleep(1000);
  await wd('/window', { handle: uiWindow });
  const nativeChild = await script('return browser.webNavigation.getAllFrames({tabId:arguments[0]}).then(frames=>frames.find(frame=>frame.url===arguments[1]));', [tab.id, childOrigin + '/frame']);
  assert.ok(nativeChild?.frameId > 0);
  const childIdentity = await script('return browser.scripting.executeScript({target:{tabId:arguments[0],frameIds:[arguments[1]]},world:"ISOLATED",func:()=>globalThis.__detectExpertIsolatedDocumentV1??null}).then(results=>results.find(result=>result.frameId===arguments[1])?.result);', [tab.id, nativeChild.frameId]);
  assert.ok(typeof childIdentity === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(childIdentity));
  evidence.technicalChildDocument = tab.id + ':' + nativeChild.frameId + ':' + childIdentity;
  await wd('/window', { handle: siteWindow });
  const childElement = await wd('/element', { using: 'css selector', value: '#owned-technical-frame' });
  try {
    await wd('/frame', { id: childElement });
    technicalSamples.push(await script('return window.readOwnedTechnicalValues(arguments[0]);', [271]));
    await asyncScript('const done=arguments[arguments.length-1];fetch("/frame-observation").then(()=>done(true),error=>done({error:String(error)}));');
  } finally { await wd('/frame', { id: null }); }
  await wd('/window', { handle: siteWindow }); await asyncScript('const done=arguments[arguments.length-1];(async()=>{await Promise.all(arguments[0].map(url=>new Promise(finish=>{const node=document.createElement("script");node.src=url;node.onload=node.onerror=finish;document.head.appendChild(node);})));await Promise.all(arguments[1].map(row=>fetch(row.url,{method:row.method,...(row.body?{body:row.body}:{})}).catch(()=>null)));await fetch("/cookie-observation",{credentials:"same-origin"});void window.innerWidth;void window.innerHeight;})().then(()=>done(true),error=>done({error:String(error)}));', [urls, advancedBeaconFixtures]); await sleep(1200);
  await wd('/window', { handle: uiWindow }); await script('return browser.tabs.update(arguments[0],{active:true});', [tab.id]); await wd('/refresh', {});
  if (Number.parseInt(evidence.browser, 10) < 153) {
    const nativeReport = await send({ schemaVersion: 1, type: 'ui-get-report', tabId: tab.id }); assert.deepEqual(nativeReport.report.vendors, []);
    evidence.nativeAntifraudAttribution = 'unsupported-on-Firefox' + Number.parseInt(evidence.browser, 10); evidence.antifraud = [];
  } else evidence.antifraud = await requireLogos('.recognized-vendors', 3);
  await selectPanel('social'); evidence.social = await requireLogos('[data-social-table]', 1); console.log(JSON.stringify({ stage: 'social', logos: evidence.social.length }));
  await selectPanel('beacons'); evidence.beacons = await requireLogos('[data-beacon-row]', 5); console.log(JSON.stringify({ stage: 'beacons', logos: evidence.beacons.length }));
  await waitFor('return Boolean(document.querySelector(".inspector-site [data-site-icon-state=ready] img"));'); const before = await cache(); assert.ok(before.entries.length && before.entries.every(row => Object.keys(row).sort().join(',') === 'at,host,png' && row.png.startsWith('data:image/png;base64,')));
  evidence.siteIcon = await script('const image=document.querySelector(".inspector-site [data-site-icon] img");return{decoded:image.complete&&image.naturalWidth===32&&image.naturalHeight===32,width:image.getBoundingClientRect().width,source:image.src.slice(0,22)};'); assert.equal(evidence.siteIcon.decoded, true); assert.equal(evidence.siteIcon.width, 24); await screenshot('native-firefox-popup');
  await wd('/window', { handle: siteWindow }); await script('document.querySelector("link[rel=icon]").href="/favicon-second.svg";'); await sleep(600); await wd('/window', { handle: uiWindow }); await waitFor('return browser.storage.local.get("site-icons:v1").then(value=>value["site-icons:v1"]?.entries[0]?.png!==arguments[0]);', [before.entries[0].png]); evidence.checks.push('native same-document favicon update refreshes local PNG');
  await wd('/window', { handle: siteWindow }); await wd('/url', { url: origin + '/second-visit' }); await sleep(1100);
  technicalSamples.push(await script('return window.readOwnedTechnicalValues(arguments[0]);', [389]));
  const secondLoaded = await asyncScript('const done=arguments[arguments.length-1];(async()=>{await Promise.all(arguments[0].map(url=>new Promise(finish=>{const node=document.createElement("script");node.src=url;node.onload=node.onerror=finish;document.head.appendChild(node);})));await Promise.all(arguments[1].map(row=>fetch(row.url,{method:row.method,...(row.body?{body:row.body}:{})}).catch(()=>null)));await fetch("/second-observation",{credentials:"same-origin"});})().then(()=>done(true),error=>done({error:String(error)}));', [urls, advancedBeaconFixtures]);
  assert.equal(secondLoaded, true); await sleep(1200); await wd('/window', { handle: uiWindow });
  const stopped = await send({ schemaVersion: 1, type: 'ui-pro-stop', sessionId: started.session.id }); assert.equal(stopped.session.status, 'stopped');
  evidence.savedTechnicalValues = stopped.session.pages.map(page => ({ documentKey: page.documentKey, host: new URL(page.url).hostname, apiValues: page.apiValues, requestValues: page.requestValues }));
  if (evidence.nativeAntifraudAttribution) assert.ok(stopped.session.pages.every(page => page.requestValues?.supported === false && page.requestValues.rows.length === 0), 'Firefox without native network document IDs never guesses outgoing technical headers');
  reportWindow = (await wd('/window/new', { type: 'tab' })).handle; await wd('/window', { handle: reportWindow }); await wd('/url', { url: base + '/report.html?id=' + started.session.id }); evidence.report = {};
  await waitFor('return Boolean(document.querySelector(".pro-report"));');
  if (evidence.nativeAntifraudAttribution) { assert.equal(await script('return document.querySelectorAll("tr[data-vendor-id] [data-company-logo]").length;'), 0); evidence.report.antifraud = []; }
  else evidence.report.antifraud = await requireLogos('tr[data-vendor-id]', 3);
  for (const [name, selector, minimum] of [['social','[data-pro-social-networks]',1],['cookie','[data-pro-cookies]',2],['gtm','[data-pro-tag-manager]',4],['beacons','[data-pro-beacons]',5]]) { evidence.report[name] = await requireLogos(selector, minimum); console.log(JSON.stringify({ stage: 'report-' + name, logos: evidence.report[name].length })); }
  const expectedVendorIds = [...new Set(stopped.session.pages.flatMap(page => page.reports.flatMap(document => document.vendors.map(vendor => vendor.vendorId))))].sort();
  assert.deepEqual(await script('return [...document.querySelectorAll("[data-pro-vendors] tr[data-vendor-id]")].map(row=>row.dataset.vendorId).sort();'), expectedVendorIds);
  assert.ok(evidence.report.antifraud.every(row => row.width === 28), 'recognized companies keep their large local logo in the vendor table');
  const expected = {
    cookies: stopped.session.pages.reduce((sum, page) => sum + (page.cookies?.entries.length ?? 0), 0),
    social: stopped.session.pages.flatMap(page => page.socialNetworks ?? []).reduce((sum, document) => sum + document.rows.length, 0),
    beacons: stopped.session.pages.flatMap(page => page.beacons ?? []).reduce((sum, document) => sum + document.rows.length + document.scriptCalls.length, 0),
    values: stopped.session.pages.flatMap(page => page.apiValues ?? []).reduce((sum, document) => sum + document.rows.length, 0),
    gtm: stopped.session.pages.flatMap(page => page.tagManager ?? []).reduce((sum, document) => sum + document.rows.length, 0),
  };
  evidence.reportTables = await script(`const count=selector=>document.querySelectorAll('.pro-report '+selector).length;
    const sections=[...document.querySelectorAll('.pro-report [data-pro-cookies], .pro-report [data-pro-social-networks], .pro-report [data-pro-beacons], .pro-report [data-pro-background], .pro-report [data-pro-third-party], .pro-report [data-pro-tag-manager]')];
    return{counts:{cookies:count('tr[data-cookie-report-row]'),social:count('tr[data-social-row]'),beacons:count('tr[data-beacon-row]'),values:count('tr[data-pro-value-row]'),gtm:count('.tag-manager-table tbody tr')},
      tables:count('table.pro-data-table'),emptyTables:[...document.querySelectorAll('.pro-report table')].filter(table=>!table.querySelector('tbody tr')).length,
      emptySections:sections.filter(section=>!section.querySelector('tbody tr')).length,emptyCards:count('.inspector-empty'),
      outsideReport:[...document.querySelectorAll('[data-pro-tag-manager]')].filter(section=>!section.closest('.pro-report')).length};`);
  assert.deepEqual(evidence.reportTables.counts, expected, 'every saved company-related row and technical value is present in the report');
  assert.ok(evidence.reportTables.tables >= 4);
  for (const name of ['emptyTables', 'emptySections', 'emptyCards', 'outsideReport']) assert.equal(evidence.reportTables[name], 0, name);
  evidence.summaries = await script(`return [...document.querySelectorAll('[data-pro-summary]')].map(section=>({
    kind:section.dataset.proSummary,columns:section.querySelectorAll('thead th').length,
    rows:[...section.querySelectorAll('tbody tr')].map(row=>[...row.children].map(cell=>cell.textContent)),
    fontSizes:[...new Set([...section.querySelectorAll('th,td,code')].map(node=>getComputedStyle(node).fontSize))]}));`);
  assert.deepEqual(evidence.summaries.map(summary => summary.kind).sort(), evidence.nativeAntifraudAttribution ? ['browser'] : ['browser', 'cookies']);
  const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'variant' });
  for (const summary of evidence.summaries) {
    assert.equal(summary.columns, 3); assert.ok(summary.rows.length > 0); assert.deepEqual(summary.fontSizes, ['16px']);
    assert.ok(summary.rows.every((row, index) => row.length === 3 && row[0] === String(index + 1)));
    assert.deepEqual(summary.rows.map(row => row.slice(1)), summary.rows.map(row => row.slice(1)).sort((left, right) => collator.compare(left[0], right[0]) || collator.compare(left[1], right[1])), 'summary is alphabetical by name and retains distinct values');
  }
  evidence.technicalValues = assertTechnicalValues(stopped.session, technicalSamples, evidence.summaries.find(summary => summary.kind === 'browser').rows);
  assert.ok(evidence.technicalValues.visits >= 2 && evidence.technicalValues.documents >= 3, 'all visits and the cross-site native document are saved');
  const childValueRetained = stopped.session.pages.some(page => page.apiValues.some(document => document.documentKey === evidence.technicalChildDocument &&
    document.documentKey !== page.documentKey && document.rows.some(row => row.value.kind === 'technical' && row.value.fields.some(field => field.name === 'width' && field.value === 271))));
  assert.ok(childValueRetained, 'third-party actual browser value retains the child document identity');
  evidence.checks.push('actual technical values from main document, cross-site iframe and second visit are retained and printed');
  assert.equal(await script('return document.body.textContent.includes("COMPANY_COOKIE_CANARY");'), !evidence.nativeAntifraudAttribution, 'raw cookie values require supported native request document identity');
  await waitFor('return document.querySelectorAll("[data-site-icon-state=ready] img").length>=2;');
  evidence.reportSiteIcons = await asyncScript('const done=arguments[arguments.length-1];Promise.all([...document.querySelectorAll("[data-site-icon-state=ready] img")].map(async image=>{await image.decode();return{decoded:image.complete&&image.naturalWidth===32&&image.naturalHeight===32,width:image.getBoundingClientRect().width,height:image.getBoundingClientRect().height,source:image.src.slice(0,22)};})).then(done,error=>done({error:String(error)}));');
  assert.ok(evidence.reportSiteIcons.length >= 2 && evidence.reportSiteIcons.every(image => image.decoded && image.width === image.height && [20,24].includes(image.width) && image.source === 'data:image/png;base64,'));
  evidence.printGates = await requirePrintGates(); await screenshot('native-firefox-report');
  evidence.reportLayout = await script(`const report=document.querySelector('.pro-report'),box=report.getBoundingClientRect();
    return{overflow:[...report.querySelectorAll('table')].filter(table=>{const rect=table.getBoundingClientRect();return rect.left<box.left-1||rect.right>box.right+1||table.scrollWidth>table.clientWidth+1;}).map(table=>table.className)};`);
  assert.deepEqual(evidence.reportLayout.overflow, [], 'tables fit the report width without horizontal clipping');
  // The separate viewport screenshot above preserves the live sticky toolbar.
  // Content-only images keep it from obscuring the element being captured.
  const toolbarVisibility = await script('const toolbar=document.querySelector(".pro-report-toolbar"),previous=toolbar.style.visibility;toolbar.style.visibility="hidden";return previous;');
  try {
    for (const [selector, name] of [['.pro-report', 'native-firefox-report-full'], ['[data-pro-values-table]', 'native-firefox-report-values'], ['[data-pro-cookies]', 'native-firefox-report-cookies'], ['[data-pro-social-networks]', 'native-firefox-report-social'], ['[data-pro-beacons]', 'native-firefox-report-beacons'], ['[data-pro-summary="browser"]', 'native-firefox-summary-browser']]) {
      if (await script('return Boolean(document.querySelector(arguments[0]));', [selector])) await elementScreenshot(selector, name);
    }
  } finally { await script('document.querySelector(".pro-report-toolbar").style.visibility=arguments[0];', [toolbarVisibility]); }
  const originalWindowRect = await wd('/window/rect', undefined, 'GET');
  await wd('/window/rect', { width: 560, height: 900 });
  for (let attempt = 0; attempt < 3; ++attempt) {
    const viewport = await script('return innerWidth;'); if (viewport === 560) break;
    const actualRect = await wd('/window/rect', undefined, 'GET');
    await wd('/window/rect', { width: actualRect.width + 560 - viewport, height: 900 });
  }
  evidence.reportLayout560 = await script(`return{viewport:innerWidth,width:document.documentElement.scrollWidth,
    summaryFonts:[...new Set([...document.querySelectorAll('.pro-summary-table th,.pro-summary-table td,.pro-summary-table code')].map(node=>getComputedStyle(node).fontSize))],
    tables:[...document.querySelectorAll('.pro-report table')].map(table=>({className:table.className,width:table.getBoundingClientRect().width,scrollWidth:table.scrollWidth,clientWidth:table.clientWidth})),
    overflow:[...document.querySelectorAll('.pro-report *')].filter(node=>{const box=node.getBoundingClientRect();return box.width>0&&(box.left<-1||box.right>innerWidth+1);}).slice(0,20).map(node=>({tag:node.tagName,className:node.className,width:node.getBoundingClientRect().width,left:node.getBoundingClientRect().left,right:node.getBoundingClientRect().right}))};`);
  await script('scrollTo(0,0);'); await screenshot('native-firefox-report-560');
  await elementScreenshot('[data-pro-summary="browser"]', 'native-firefox-summary-browser-560');
  await wd('/window/rect', { width: originalWindowRect.width, height: originalWindowRect.height });
  assert.equal(evidence.reportLayout560.viewport, 560, 'measure the actual content viewport, excluding Firefox chrome and sidebars');
  assert.deepEqual(evidence.reportLayout560.summaryFonts, ['16px']);
  assert.ok(evidence.reportLayout560.width <= evidence.reportLayout560.viewport, 'report stays within the 560px viewport: ' + JSON.stringify(evidence.reportLayout560));
  const pdf = Buffer.from(await wd('/print', { orientation: 'portrait', background: true, shrinkToFit: true, page: { width: 21, height: 29.7 } }), 'base64');
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-'); assert.ok(pdf.length > 1000); writeFileSync(join(artifact, 'native-firefox-report.pdf'), pdf); evidence.print = { bytes: pdf.length, sha256: createHash('sha256').update(pdf).digest('hex') }; console.log(JSON.stringify({ stage: 'native-pdf', bytes: pdf.length, gates: evidence.printGates }));
  await script('return browser.storage.local.set({"ui-language-v1":"ar"});'); await waitFor('return document.documentElement.dir==="rtl";'); evidence.rtl = await requireLogos('body', 20); await screenshot('native-firefox-report-rtl');
  await wd('/window', { handle: uiWindow }); await wd('/url', { url: base + '/sidepanel.html' }); await script('return browser.tabs.update(arguments[0],{active:true});', [tab.id]); await wd('/refresh', {}); await waitFor('return Boolean(document.querySelector(".inspector-site"));'); await script('document.documentElement.style.width="292px";document.body.style.width="292px";');
  await selectPanel('social'); const narrowMarks = await requireLogos('[data-social-table]', 1);
  evidence.narrow = await script('return {dir:document.documentElement.dir,width:document.querySelector("main.app").getBoundingClientRect().width,overflow:[...document.querySelectorAll(".company-label,.company-label__name,.inspector-site")].filter(node=>node.clientWidth&&node.scrollWidth>node.clientWidth+1).map(node=>node.className)};'); evidence.narrow.marks = narrowMarks;
  assert.equal(evidence.narrow.dir, 'rtl'); assert.deepEqual(evidence.narrow.overflow, []); assert.ok(evidence.narrow.marks.every(row => row.decoded && row.width === 20 && row.height === 20)); evidence.narrow.selectedContainerPrintGates = await requirePrintGates('[data-social-panel]'); await screenshot('native-firefox-sidepanel-narrow-rtl');
  evidence.ownedCompanyComponents = await requireOwnedCompanyComponents();
  assert.equal((await send({ schemaVersion: 1, type: 'ui-data-consent-set', version: 1, accepted: false })).accepted, false);
  evidence.cacheCleared = await script('return browser.storage.local.get("site-icons:v1").then(values=>!Object.hasOwn(values,"site-icons:v1"));'); assert.equal(evidence.cacheCleared, true); evidence.checks.push('consent revocation clears favicon cache');
  assert.deepEqual(evidence.errors, []); assert.deepEqual(evidence.unexpectedRequests, []); evidence.passed = true; console.log(JSON.stringify({ browser: evidence.browser, report: Object.fromEntries(Object.entries(evidence.report).map(([name, rows]) => [name, rows.length])), checks: evidence.checks, passed: true }));
} catch (error) {
  evidence.failure = { message: error.message, ui: await script('return{url:location.href,text:document.body.innerText.slice(0,16000)};').catch(() => null) };
  if (nativeTabId !== undefined) evidence.failure.report = await send({ schemaVersion: 1, type: 'ui-get-report', tabId: nativeTabId }).catch(() => null);
  throw error;
} finally {
  writeFileSync(join(artifact, 'native-firefox.json'), JSON.stringify(evidence, null, 2) + '\n'); websocket?.close(); if (session) await command('/session/' + session, undefined, 'DELETE').catch(() => {}); driver.kill(); await new Promise(done => server.close(done));
}
