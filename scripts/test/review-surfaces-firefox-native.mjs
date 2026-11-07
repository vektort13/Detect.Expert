// ADR-038: installed Firefox, unchanged final XPI, owned HTTP fixtures only.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { archiveProduction, FIREFOX_ID } from '../build-production.mjs';

const root = resolve(import.meta.dirname, '../..'), output = join(root, 'dist/firefox');
const strictCoop = process.env.REVIEW_FIXTURE_COOP === '1';
const artifactName = strictCoop ? 'native-firefox-coop' : 'native-firefox';
const artifact = join(root, 'test-results/review-surfaces-2026-10-10'); mkdirSync(artifact, { recursive: true });
const run = mkdtempSync(join(root, '.tmp/review-firefox-')), profile = join(run, 'profile'); mkdirSync(profile);
const uuid = randomUUID(), host = 'review.example.com';
const prefs = { 'extensions.webextensions.uuids': JSON.stringify({ [FIREFOX_ID]: uuid }), 'network.proxy.type': 0, 'network.dns.localDomains': host,
  'extensions.webextOptionalPermissionPrompts': false, 'browser.shell.checkDefaultBrowser': false, 'browser.startup.page': 0, 'browser.newtabpage.enabled': false,
  'datareporting.policy.dataSubmissionEnabled': false, 'toolkit.telemetry.enabled': false, 'app.update.auto': false };
writeFileSync(join(profile, 'user.js'), Object.entries(prefs).map(([key, value]) => 'user_pref(' + JSON.stringify(key) + ', ' + JSON.stringify(value) + ');').join('\n'));
const binary = spawnSync('powershell.exe', ['-NoProfile', '-Command', "(Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\firefox.exe').'(default)'"], { encoding: 'utf8', windowsHide: true }).stdout.trim(); assert.ok(binary);
const evidence = { checks: [], requests: [], packagedHashes: Object.fromEntries(['manifest.json', 'hook.early.js', 'hook.main.js', 'bridge.js', 'background.js', 'identification-ui.js', 'report.js', 'cookie-writer-observer.js', 'cookie-writers-contracts.js'].map(file => [file, createHash('sha256').update(readFileSync(join(output, file))).digest('hex')])) };
const server = createServer((request, response) => {
  evidence.requests.push(request.url.split('?')[0]); response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/worker.js' || request.url === '/module.mjs') { response.setHeader('Content-Type', 'text/javascript'); response.end('self.onmessage=e=>self.postMessage(e.data+1)'); return; }
  if (request.url === '/shared.js') { response.setHeader('Content-Type', 'text/javascript'); response.end('onconnect=e=>{const p=e.ports[0];p.onmessage=e=>p.postMessage(e.data+1);p.start();}'); return; }
  if (request.url?.startsWith('/main.js')) { response.setHeader('Content-Type', 'text/javascript'); response.end('document.cookie="review_cookie=COOKIE_VALUE_PRIVATE; SameSite=Lax; path=/";if(!Object.hasOwn(window,"mathBefore"))window.mathBefore=Math.sin;window.reviewMath=()=>[Math.sin(-1e300),Math.cos(10.000000000123),Math.pow(Math.PI,-100)];'); return; }
  response.setHeader('Content-Type', 'text/html'); response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; worker-src 'self' blob:");
  response.setHeader('X-Frame-Options', 'SAMEORIGIN');
  if (strictCoop) response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.end('<!doctype html><title>Owned Firefox review fixture</title><script src="/main.js?private=QUERY_CANARY"></script><form action="/success"><input name="user"><button>Log in</button></form>');
});
await new Promise(done => server.listen(0, '127.0.0.1', done)); const origin = 'http://' + host + ':' + server.address().port;
const ports = createServer(); await new Promise(done => ports.listen(0, '127.0.0.1', done)); const port = ports.address().port; await new Promise(done => ports.close(done));
const endpoint = 'http://127.0.0.1:' + port;
const driver = spawn(join(root, '.tmp/firefox/tools/geckodriver.exe'), ['--host', '127.0.0.1', '--port', String(port), '--profile-root', run, '--log', 'error'], { cwd: root, windowsHide: true });
let session, uiWindow, siteWindow, tabId;
async function command(path, body, method = 'POST') { const response = await fetch(endpoint + path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }), signal: AbortSignal.timeout(30000) }); const value = (await response.json()).value; if (!response.ok || value?.error) throw Error(JSON.stringify(value)); return value; }
const wd = (path, body, method) => command('/session/' + session + path, body, method);
const script = (code, args = []) => wd('/execute/sync', { script: code, args });
const asyncScript = (code, args = []) => wd('/execute/async', { script: code, args });
const send = message => asyncScript('const done=arguments[arguments.length-1];browser.runtime.sendMessage(arguments[0]).then(done,error=>done({error:String(error)}));', [message]);
const sleep = ms => new Promise(done => setTimeout(done, ms));
async function waitFor(code, args = [], attempts = 100) { for (let index = 0; index < attempts; ++index) { if (await script(code, args)) return; await sleep(100); } throw Error('Native Firefox timeout: ' + code); }
try {
  for (let index = 0; index < 80; ++index) { try { await command('/status', undefined, 'GET'); break; } catch { await sleep(100); } }
  const opened = await command('/session', { capabilities: { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': { binary, args: ['-headless', '-no-remote', '-profile', profile] } } } }); session = opened.sessionId; evidence.browser = opened.capabilities.browserVersion;
  const xpi = join(run, 'review-surfaces.xpi'); writeFileSync(xpi, archiveProduction(output)); evidence.xpiSha256 = createHash('sha256').update(readFileSync(xpi)).digest('hex'); assert.equal(await wd('/moz/addon/install', { path: xpi, temporary: true }), FIREFOX_ID);
  const base = 'moz-extension://' + uuid; await wd('/url', { url: base + '/popup.html' }); uiWindow = await wd('/window', undefined, 'GET');
  assert.equal((await send({ schemaVersion: 1, type: 'ui-data-consent-set', version: 1, accepted: true })).accepted, true);
  await send({ schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'all-sites' }); await script('return browser.storage.local.set({"ui-language-v1":"ru"});'); await sleep(500);
  await script('window.fixtureCommits=[];browser.webNavigation.onCommitted.addListener(e=>window.fixtureCommits.push(e));');
  evidence.permissions = await script('return browser.permissions.getAll();');
  siteWindow = (await wd('/window/new', { type: 'tab' })).handle; await wd('/window', { handle: siteWindow }); await wd('/url', { url: origin }); await sleep(600);
  evidence.mathBefore = await script('return {sandbox:Math.sin===window.mathBefore,page:window.Math.sin===window.mathBefore,reference:typeof window.mathBefore};');
  assert.equal(evidence.mathBefore.page, true);
  await wd('/window', { handle: uiWindow }); const tab = await script('return browser.tabs.query({}).then(tabs=>tabs.find(tab=>tab.url===arguments[0]));', [origin + '/']); assert.ok(tab?.id); tabId = tab.id;
  await script('return browser.tabs.update(arguments[0],{active:true});', [tabId]);
  evidence.nativeBinding = await script('return Promise.all([browser.webNavigation.getAllFrames({tabId:arguments[0]}),browser.permissions.contains({origins:[arguments[1]]}),browser.scripting.getRegisteredContentScripts(),browser.storage.session.get(null)]).then(([frames,access,scripts,state])=>({frames,access,scripts,commits:window.fixtureCommits,state}));', [tabId, 'http://' + host + '/*']);
  evidence.nativeInjection = await script('return browser.scripting.executeScript({target:{tabId:arguments[0],frameIds:[0]},world:"ISOLATED",func:()=>({url:location.href,identity:globalThis.__detectExpertIsolatedDocumentV1??null})}).then(results=>({results}),error=>({error:String(error)}));', [tabId]);
  evidence.beforeReport = await send({ schemaVersion: 1, type: 'ui-get-report', tabId });
  const start = await send({ schemaVersion: 1, type: 'ui-pro-start', tabId }); assert.equal(start.type, 'pro-state'); await sleep(1100);
  await wd('/window', { handle: siteWindow });
  evidence.native = await asyncScript(`const done=arguments[arguments.length-1];(async()=>{
    await new Promise((resolve,reject)=>{const node=document.createElement('script');node.src='/main.js?private=PRO_QUERY_CANARY';node.onload=resolve;node.onerror=reject;document.head.appendChild(node);});
    const workers=[];
    for(const[url,options]of[['/worker.js',undefined],['/module.mjs',{type:'module'}],[URL.createObjectURL(new Blob(['self.onmessage=e=>postMessage(e.data+1)'],{type:'text/javascript'})),undefined]]){
      const worker=new Worker(url,options);workers.push(await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Worker timeout')),3000);worker.onmessage=e=>{clearTimeout(timer);resolve(e.data);};worker.onerror=reject;worker.postMessage(7);}));worker.terminate();if(url.startsWith('blob:'))URL.revokeObjectURL(url);
    }
    const shared=new SharedWorker('/shared.js');shared.port.start();const sharedValue=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('SharedWorker timeout')),3000);shared.port.onmessage=e=>{clearTimeout(timer);resolve(e.data);};shared.port.postMessage(9);});shared.port.close();
    window.addEventListener('deviceorientation',()=>{});window.ondevicemotion=()=>{};document.cookie='review_second=COOKIE_VALUE_PRIVATE; SameSite=Lax; path=/';
    const math=window.reviewMath(),active=window.Math.sin!==window.mathBefore,child=document.createElement('iframe');document.body.appendChild(child);const width=child.contentWindow.innerWidth,cookie=document.cookie;
    return{workers,sharedValue,math,active,width,cookiesWork:cookie.includes('review_cookie=COOKIE_VALUE_PRIVATE')&&cookie.includes('review_second=COOKIE_VALUE_PRIVATE')};
  })().then(done,error=>done({error:String(error)}));`);
  assert.deepEqual(evidence.native.workers, [8, 8, 8]); assert.equal(evidence.native.sharedValue, 10); assert.equal(evidence.native.active, true); assert.equal(evidence.native.cookiesWork, true);
  await sleep(1500); await wd('/window', { handle: uiWindow });
  const report = await send({ schemaVersion: 1, type: 'ui-get-report', tabId }); assert.equal(report.type, 'report'); evidence.report = report.report;
  for (const id of ['DET-064', 'DET-042', 'DET-022', 'DET-023', 'DET-049']) assert.ok(report.report.techniques.some(row => row.techniqueId === id && row.count > 0), id);
  const writers = await send({ schemaVersion: 1, type: 'ui-get-cookie-writers', tabId, frameId: 0, documentKey: report.report.documentKey }); evidence.writers = writers;
  assert.equal(writers.type, 'cookie-writers-state'); assert.ok(writers.rows.some(row => row.name === 'review_cookie' && row.script?.pathTemplate === '/main.js' && row.attributionConfidence === 'exact-resource'));
  assert.equal(JSON.stringify(writers).includes('COOKIE_VALUE_PRIVATE'), false); assert.equal(JSON.stringify(writers).includes('QUERY_CANARY'), false);
  await script('return browser.tabs.update(arguments[0],{active:true});', [tabId]); await wd('/refresh', {});
  await waitFor('return Boolean(document.querySelector("[data-identification-tab=cookie]"));');
  await script('document.querySelector("[data-identification-tab=cookie]").click();return browser.tabs.update(arguments[0],{active:true});', [tabId]);
  await waitFor('return Boolean(document.querySelector("[data-cookie-writers-table] tbody tr"));');
  evidence.writerUi = await script('const t=document.querySelector("[data-cookie-writers-table]");return{columns:t.querySelectorAll("thead th").length,rows:t.querySelectorAll("tbody tr").length,text:t.textContent};'); assert.equal(evidence.writerUi.columns, 4);
  await sleep(1100); const stopped = await send({ schemaVersion: 1, type: 'ui-pro-stop', sessionId: start.session.id }); assert.equal(stopped.type, 'pro-state');
  evidence.proWriterDocuments = stopped.session.pages.flatMap(page => page.cookieWriters ?? []); assert.ok(evidence.proWriterDocuments.some(doc => doc.rows.some(row => row.name === 'review_cookie')));
  await wd('/window', { handle: siteWindow }); await waitFor('return window.Math.sin===window.mathBefore;');
  const input = await wd('/element', { using: 'css selector', value: 'input' }); await wd('/element/' + input['element-6066-11e4-a52e-4f735466cecf'] + '/value', { text: 'local-fixture' });
  const button = await wd('/element', { using: 'css selector', value: 'button' }); await wd('/element/' + button['element-6066-11e4-a52e-4f735466cecf'] + '/click', {}); await waitFor('return location.pathname==="/success"&&location.search==="?user=local-fixture";');
  const reportWindow = (await wd('/window/new', { type: 'tab' })).handle; await wd('/window', { handle: reportWindow }); await wd('/url', { url: base + '/report.html?id=' + start.session.id });
  await waitFor('return Boolean(document.querySelector(".pro-report [data-cookie-writers-table] tbody tr"));');
  evidence.proWriterUi = await script('const tables=[...document.querySelectorAll(".pro-report [data-cookie-writers-table]")];return{columns:tables.map(t=>t.querySelectorAll("thead th").length),rows:tables.reduce((n,t)=>n+t.querySelectorAll("tbody tr").length,0),text:tables.map(t=>t.textContent).join(" ")};');
  assert.ok(evidence.proWriterUi.columns.every(count => count === 4)); assert.equal(evidence.proWriterUi.rows, evidence.proWriterDocuments.reduce((sum, doc) => sum + doc.rows.length, 0)); assert.equal(evidence.proWriterUi.text.includes('COOKIE_VALUE_PRIVATE'), false);
  const pdf = Buffer.from(await wd('/print', { orientation: 'portrait', background: true, shrinkToFit: true, page: { width: 21, height: 29.7 } }), 'base64'); assert.equal(pdf.subarray(0, 5).toString(), '%PDF-'); writeFileSync(join(artifact, artifactName + '.pdf'), pdf);
  evidence.print = { bytes: pdf.length, sha256: createHash('sha256').update(pdf).digest('hex') }; writeFileSync(join(artifact, artifactName + '.png'), Buffer.from(await wd('/screenshot', undefined, 'GET'), 'base64'));
  evidence.checks.push('classic/module/blob/SharedWorker messages unchanged', 'cookie setter and exact currentScript metadata without values/query', 'motion registration', 'Math Pro installation and restoration', 'same-origin child window access', 'native form navigation', 'Cookie UI and all saved Pro writer rows', 'native Firefox PDF'); evidence.passed = true;
  console.log(JSON.stringify({ browser: evidence.browser, checks: evidence.checks, passed: true }));
} catch (error) {
  evidence.failure = { message: error.message, ui: await script('return{url:location.href,text:document.body.innerText.slice(0,16000)};').catch(() => null) };
  if (tabId !== undefined && uiWindow) { await wd('/window', { handle: uiWindow }).catch(() => {}); evidence.failure.report = await send({ schemaVersion: 1, type: 'ui-get-report', tabId }).catch(() => null); }
  throw error;
} finally {
  writeFileSync(join(artifact, artifactName + '.json'), JSON.stringify(evidence, null, 2) + '\n'); if (session) await command('/session/' + session, undefined, 'DELETE').catch(() => {}); driver.kill(); await new Promise(done => server.close(done));
}
