// ADR-065 / ADR-087 / ADR-104: actual packaged extension, trusted Options, and first inline owned fixtures.
// Covers every Math function of the contract (the 20 of math-transcendentals-fixtures.mjs plus ADR-087's sqrt/cbrt/hypot,
// whose vectors live below), the Antidetect device level with its save bar (shown only while a draft is dirty) and the
// header master switch, which persists on its own since ADR-104.
// node scripts/test/math-transcendentals-native.mjs [--firefox] [--from-source]
//   --from-source  assemble the package from apps/production-extension instead of copying dist/<browser>
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { archiveProduction, FIREFOX_ID } from '../build-production.mjs';
import { enableChromeUserScripts } from './api-custom-early-native.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';
import { MATH_TRANSCENDENTAL_NAMES, createMathSemanticFixtures, MATH_SPEC_CASES } from './math-transcendentals-fixtures.mjs';
import { sourceMismatches, stageExtension, writeEvidence } from './native-evidence.mjs';
import { API_MATH_FUNCTIONS } from '../../apps/production-extension/math-functions.js';
const root = resolve(import.meta.dirname, '../..'), browser = process.argv.includes('--firefox') ? 'firefox' : 'chrome', fromSource = process.argv.includes('--from-source');
mkdirSync(join(root, '.tmp'), { recursive: true });
const run = mkdtempSync(join(root, '.tmp/math-transcendentals-')), extension = join(run, 'extension');
const staged = await stageExtension({ browser, target: extension, from: fromSource ? 'source' : 'dist' });
// ADR-087 functions: one inexact probe each (shifted by exactly one ULP) and exact/special cases that stay native.
// The runtime keeps results that look exact natively: sqrt(2) is Math.SQRT2, cbrt(2)**3 and hypot(0.3, 0.7)**2 round back to the
// input. These probes have no such reconstruction (checked with Node's Math before choosing them).
const ADR087_ELIGIBLE = [{ name: 'sqrt', args: [3] }, { name: 'cbrt', args: [5] }, { name: 'hypot', args: [2, 3] }];
const ADR087_PRESERVE = [['sqrt', [4]], ['sqrt', [0]], ['sqrt', [-0]], ['sqrt', [Infinity]], ['sqrt', [NaN]], ['sqrt', [-1]], ['sqrt', []], ['cbrt', [27]], ['cbrt', [-8]], ['cbrt', [0]], ['cbrt', [-0]], ['cbrt', [-Infinity]], ['cbrt', [NaN]],
  ['hypot', [3, 4]], ['hypot', []], ['hypot', [-0]], ['hypot', [0, -0]], ['hypot', [Infinity, NaN]], ['hypot', [NaN, 1]], ['hypot', [5]]].map(([name, args]) => ({ name, args }));
const names = [...MATH_TRANSCENDENTAL_NAMES, ...ADR087_ELIGIBLE.map(row => row.name)];
assert.deepEqual([...names].sort(), [...API_MATH_FUNCTIONS].sort(), 'the native covers exactly the Math functions of the contract');
const files = ['api-configuration.js','math-functions.js','api-custom-math-runtime.js','api-custom-math-opaque.entry.js','api-custom-opaque.math-transcendentals.js','api-custom-inherit.main.js','api-custom-document-runtime.js','api-custom-registration.js','api-configuration-controller.js','math-profile-seed.js','antidetect-controller.js','antidetect-ui.js','antidetect-math-ui.js','antidetect-math-ui.css','options.html','options.js'];
const evidence = { browser, run, at:new Date().toISOString(), result:'RUNNING', packaging:staged.packaging, functions:names.length, checks:[], layouts:[], hashes:Object.fromEntries(files.map(file=>[file,createHash('sha256').update(readFileSync(join(extension,file))).digest('hex')])) };
evidence.sourceHashes=Object.fromEntries(files.map(file=>[file,createHash('sha256').update(readFileSync(join(root,'apps/production-extension',file))).digest('hex')]));
evidence.localeHashes=Object.fromEntries(PRODUCTION_LANGUAGES.map(language=>{const locale=typeof language==='string'?language:language.id;return[locale,createHash('sha256').update(readFileSync(join(extension,language.uiOnly?'ui-locales':'_locales',locale,'messages.json'))).digest('hex')];}));
// Firefox UI bundles carry the adapter in front of the exact source; everything else must equal the source byte for byte.
assert.deepEqual(sourceMismatches(extension,files,browser),[],'stale packaged Math assets (rebuild dist, or run with --from-source)');
evidence.sourceDistMatch=true;
const semantic = createMathSemanticFixtures(), fixtures = { eligible: [...semantic.eligible, ...ADR087_ELIGIBLE], preserve: [...semantic.preserve, ...ADR087_PRESERVE] };
function literal(value) {
  if (value === undefined) return 'undefined'; if (Object.is(value,-0)) return '-0';
  if (typeof value === 'number' && !Number.isFinite(value)) return value !== value ? 'NaN' : value < 0 ? '-Infinity' : 'Infinity';
  if (Array.isArray(value)) return '['+value.map(literal).join(',')+']'; return JSON.stringify(value);
}
const vectors = fixtures.preserve.map(row=>({name:row.name,args:row.args}));
const vectorSource = '['+vectors.map(row=>'{name:'+literal(row.name)+',args:'+literal(row.args)+'}').join(',')+']';
const probeSource = '['+fixtures.eligible.map(row=>'{name:'+literal(row.name)+',args:'+literal(row.args)+'}').join(',')+']';
const specSource = '['+MATH_SPEC_CASES.map(row=>'{name:'+literal(row.name)+',args:'+literal(row.args)+',expected:'+literal(row.expected)+'}').join(',')+']';
const shared = `
 const probes=${probeSource}, vectors=${vectorSource}, specs=${specSource}, names=${JSON.stringify(names)};
 function bits(value){if(value!==value)return 'NaN';const d=new DataView(new ArrayBuffer(8));d.setFloat64(0,value,false);return d.getBigUint64(0,false).toString(16).padStart(16,'0');}
 function capture(realm,list=probes){return list.map(row=>{try{return bits(Reflect.apply(realm.Math[row.name],realm.Math,row.args));}catch(error){return 'error:'+error.name;}});}
`;
function script(source) { return '<script>'+source.replaceAll('</script','<\\/script')+'</script>'; }
function html() {
  const opaque = '<!doctype html>'+script(`const names=${JSON.stringify(names)};const results=names.map(name=>{try{Math[name](.3,.7);return 'allowed';}catch(error){return error.name;}});parent.postMessage({channel:'math-owned-fixture',opaque:results,control:Math.abs(-9)},'*');`);
  const child = '<!doctype html>'+script(shared+`parent.postMessage({channel:'math-owned-fixture',srcdoc:capture(globalThis)},'*');`);
  return '<!doctype html><html><head>'+script(shared+`
    try{Object.defineProperty(globalThis,Symbol.for('detect.expert/api-custom/document/v2'),{value:true});}catch{}
    const first={preserve:capture(globalThis,vectors),eligible:capture(globalThis),specs:specs.every(row=>Object.is(Reflect.apply(Math[row.name],Math,row.args),row.expected)),toString:Function.prototype.toString.toString(),names:names.every(name=>Math[name].name===name),lengths:names.every(name=>Math[name].length===(name==='atan2'||name==='pow'||name==='hypot'?2:1)),nonconstructible:names.every(name=>{try{new Math[name](.3,.7);return false;}catch(e){return e.name==='TypeError'&&!Object.hasOwn(Math[name],'prototype');}})};
    first.coercion=names.every(name=>{let reads=0;const arg={[Symbol.toPrimitive](){reads++;return .3;}};Math[name](arg,.7);return reads===1;});
    first.exception=names.every(name=>{const marker={};try{Math[name]({[Symbol.toPrimitive](){throw marker;}},.7);}catch(error){return error===marker;}return false;});
    globalThis.__mathResult=first;
    addEventListener('message',event=>{if(event.data?.channel==='math-owned-fixture'){if(event.data.srcdoc)first.srcdoc=event.data.srcdoc;if(event.data.opaque){first.opaque=event.data.opaque;first.opaqueControl=event.data.control;}}});
    addEventListener('DOMContentLoaded',()=>{
      const blank=document.createElement('iframe');document.body.append(blank);first.blank=capture(blank.contentWindow);
      const srcdoc=document.createElement('iframe');srcdoc.srcdoc=${JSON.stringify(child)};document.body.append(srcdoc);
      const opaque=document.createElement('iframe');opaque.sandbox='allow-scripts';opaque.srcdoc=${JSON.stringify(opaque)};document.body.append(opaque);
      try{const url=URL.createObjectURL(new Blob([${JSON.stringify(shared+"postMessage(capture(globalThis));")}],{type:'text/javascript'}));const worker=new Worker(url);worker.onmessage=event=>{first.worker=event.data;worker.terminate();URL.revokeObjectURL(url);};worker.onerror=()=>{first.workerError=true;};}catch(error){first.workerError=error.name;}
    },{once:true});
  `)+'</head><body><h1>Owned Math fixture</h1></body></html>';
}
const servers = [];
async function makeServer(){const server=createServer((request,response)=>{request.resume();response.setHeader('Content-Type','text/html; charset=utf-8');response.end(html());});await new Promise(done=>server.listen(0,'127.0.0.1',done));servers.push(server);return 'http://127.0.0.1:'+server.address().port;}
const origin=await makeServer(),otherOrigin=await makeServer();
const pause=ms=>new Promise(done=>setTimeout(done,ms));
async function until(probe,label,timeout=20000){const deadline=Date.now()+timeout;while(Date.now()<deadline){const value=await probe();if(value)return value;await pause(50);}throw Error('timeout: '+label);}
const check=text=>{evidence.checks.push(text);console.log('  ok '+text);};
let opened,phase='startup';
async function launch(extension, label) {
  const profile = join(run, label + '-profile'); mkdirSync(profile, { recursive: true });
  if (browser === 'chrome') {
    // Native system.display.getInfo crashes Chromium 153's headless process in a bare MV3 fixture.
    // A normal off-screen window exercises the real supported desktop API, without a foreground lab window.
    const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: false, viewport: { width: 1180, height: 900 }, args: ['--window-position=-10000,-10000', '--disable-extensions-except=' + extension, '--load-extension=' + extension, '--no-first-run'] });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const base = worker.url().slice(0, worker.url().indexOf('/', 'chrome-extension://'.length) + 1);
    let page = await context.newPage(); await page.goto(base + 'options.html#settings'); page = await enableChromeUserScripts(context, page, new URL(base).host, evidence);
    return { context, version: context.browser().version(), base, evaluate: (fn, value) => page.evaluate(fn, value), goto: url => page.goto(url), click: selector => page.locator(selector).click(), fill: (selector, value) => page.locator(selector).fill(value),
      screenshot: path => page.screenshot({ path, fullPage: true }), viewport: (width, height) => page.setViewportSize({ width, height }), media: options => page.emulateMedia(options), close: () => context.close() };
  }
  const driverPath = process.env.GECKODRIVER_BINARY ?? join(root, '.tmp/firefox/tools/geckodriver.exe'); assert.ok(existsSync(driverPath));
  let binary = process.env.FIREFOX_BINARY;
  if (!binary && process.platform === 'win32') binary = spawnSync('powershell.exe', ['-NoProfile', '-Command', "(Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\firefox.exe').'(default)'"], { encoding: 'utf8', windowsHide: true }).stdout.trim();
  assert.ok(binary, 'Installed Firefox binary is required');
  const uuid = randomUUID(), prefs = { 'extensions.webextensions.uuids': JSON.stringify({ [FIREFOX_ID]: uuid }), 'browser.shell.checkDefaultBrowser': false, 'browser.startup.homepage_override.mstone': 'ignore', 'browser.startup.page': 0, 'browser.newtabpage.enabled': false, 'datareporting.policy.dataSubmissionEnabled': false, 'toolkit.telemetry.enabled': false, 'app.update.auto': false, 'extensions.webextOptionalPermissionPrompts': false, 'network.proxy.type': 0, 'ui.systemUsesDarkTheme': 1, 'layout.css.prefers-color-scheme.content-override': 0 };
  writeFileSync(join(profile, 'user.js'), Object.entries(prefs).map(([key, value]) => 'user_pref(' + JSON.stringify(key) + ',' + JSON.stringify(value) + ');').join('\n'));
  const portServer = createServer(); await new Promise(done => portServer.listen(0, '127.0.0.1', done)); const port = portServer.address().port; await new Promise(done => portServer.close(done));
  const endpoint = 'http://127.0.0.1:' + port, log = createWriteStream(join(run, label + '-geckodriver.log'));
  const child = spawn(driverPath, ['--host', '127.0.0.1', '--port', String(port), '--profile-root', run, '--log', 'error'], { cwd: root, windowsHide: true }); child.stdout.pipe(log); child.stderr.pipe(log);
  async function command(path, body, method = 'POST') { const response = await fetch(endpoint + path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }), signal: AbortSignal.timeout(30000) }); const value = (await response.json()).value; if (!response.ok || value?.error) throw Error(value?.error ?? 'WebDriver error'); return value; }
  await until(async () => { try { await command('/status', undefined, 'GET'); return true; } catch { return false; } }, 'geckodriver');
  let session;
  try {
    const result = await command('/session', { capabilities: { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': { binary, args: ['-headless', '-no-remote', '-profile', profile] } } } }); session = result.sessionId;
    const wd = (path, body, method) => command('/session/' + session + path, body, method);
    const xpi = join(run, label + '.xpi'); writeFileSync(xpi, archiveProduction(extension)); assert.equal(await wd('/moz/addon/install', { path: xpi, temporary: true }), FIREFOX_ID);
    const element = async selector => (await wd('/element', { using: 'css selector', value: selector }))['element-6066-11e4-a52e-4f735466cecf'];
    return { version: result.capabilities.browserVersion, base: 'moz-extension://' + uuid + '/',
      evaluate: async (fn, value) => { const result = await wd('/execute/async', { script: 'const done=arguments[arguments.length-1];Promise.resolve((' + fn.toString() + ')(arguments[0])).then(value=>done({ok:true,value}),error=>done({ok:false,error:error?.code??error?.message??"error"}));', args: [value ?? null] }); if (!result.ok) throw Error(result.error); return result.value; },
      goto: url => wd('/url', { url }), click: async selector => { await until(async()=>{try{return await wd('/execute/sync',{script:'const e=document.querySelector(arguments[0]);return Boolean(e&&!e.disabled&&e.getClientRects().length);',args:[selector]});}catch{return false;}},'clickable '+selector);for (let attempt = 0; ; attempt++) { try { await wd('/execute/sync', {script:'document.querySelector(arguments[0]).scrollIntoView({block:"center"});',args:[selector]}); return await wd('/element/' + await element(selector) + '/click', {}); } catch (error) { /* A Preact re-render can replace the node between the lookup and the click. */ if (attempt >= 9 || !/javascript error|stale element|no such element/.test(String(error.message))) throw error; await pause(100); } } }, fill: async (selector, text) => { const id = await element(selector); await wd('/element/' + id + '/clear', {}); await wd('/element/' + id + '/value', { text, value: [...text] }); },
      screenshot: async path => writeFileSync(path, Buffer.from(await wd('/screenshot', undefined, 'GET'), 'base64')), viewport: (width, height) => wd('/window/rect', { width, height }), media: async () => {},
      close: async () => { try { await command('/session/' + session, undefined, 'DELETE'); } finally { child.kill(); log.end(); } } };
  } catch (error) { if (session) try { await command('/session/' + session, undefined, 'DELETE'); } catch {} child.kill(); log.end(); throw error; }
}

const evaluate=(fn,value)=>opened.evaluate(fn,value);
const send=message=>evaluate(message=>(globalThis.browser??globalThis.chrome).runtime.sendMessage({schemaVersion:1,...message}),message);
const state=()=>send({type:'ui-api-config-get',tabId:null});
const ready=()=>until(()=>evaluate(()=>document.querySelector('[data-antidetect-app]')?.getAttribute('aria-busy')==='false'&&Boolean(document.querySelector('[data-antidetect-master]'))),'Antidetect ready');
const row=s=>s.configuration.apis.find(item=>item.id==='math-transcendentals');
// ADR-104: the save bar exists only while a draft is dirty; a save is done when the stored revision moved on.
async function save(){const before=(await state()).revision;await opened.click('[data-antidetect-save]');await until(async()=>(await state()).revision>before,'saved revision');await ready();const error=await evaluate(()=>document.querySelector('[data-antidetect-error]')?.textContent);assert.ok(!error,error);return state();}
// The header master switch persists by itself (a pending draft stays a draft).
async function toggleMaster(){const before=await state();await opened.click('[data-antidetect-master]');await until(async()=>{const now=await state();return now.revision>before.revision&&now.configuration.antidetectEnabled!==before.configuration.antidetectEnabled;},'master persisted');await ready();return state();}
async function probe(where=origin){return evaluate(async where=>{const api=globalThis.browser??globalThis.chrome,url=where+'/math?'+Date.now(),tab=await api.tabs.create({url,active:false});try{for(let index=0;index<250;index++){const current=await api.tabs.get(tab.id);if(current.status==='complete'&&current.url===url){const result=await api.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:()=>globalThis.__mathResult??null});const record=result[0]?.result;if(record?.blank&&record?.srcdoc&&record?.opaque&&(record?.worker||record?.workerError))return record;}await new Promise(done=>setTimeout(done,40));}throw Error('Math first-inline fixture timeout');}finally{await api.tabs.remove(tab.id);}},where);}
const distance=(first,second)=>{const ordered=text=>{const bits=BigInt('0x'+text);return bits&(1n<<63n)?~bits&((1n<<64n)-1n):bits|(1n<<63n);};const result=ordered(first)-ordered(second);return result<0n?-result:result;};
let navigation=0;
async function refresh(){await opened.goto(opened.base+'options.html?math-native='+(++navigation)+'#antidetect');await ready();await opened.click('[data-antidetect-category="device"]');await until(()=>evaluate(()=>Boolean(document.querySelector('[data-math-transcendentals]'))),'Math panel');}
function semantics(result){assert.equal(result.specs,true);assert.equal(result.names,true);assert.equal(result.lengths,true);assert.equal(result.nonconstructible,true);assert.equal(result.coercion,true);assert.equal(result.exception,true);}
try {
  opened=await launch(extension,'native');evidence.version=opened.version;
  await opened.goto(opened.base+'options.html#settings');await until(()=>evaluate(()=>Boolean(document.querySelector('[data-management-shell]'))),'management mount');
  await send({type:'ui-data-consent-set',version:1,accepted:true});await send({type:'ui-set-scope',scopeMode:'all-sites'});await refresh();
  if(browser==='firefox'){await opened.click('[data-antidetect-grant-early]');await ready();assert.equal((await state()).earlyAccess,'ready');}
  const before=await state();assert.equal(before.configuration.enabled,false);assert.equal(before.configuration.antidetectEnabled,false);
  const baseline=await probe();semantics(baseline);evidence.preserveCases=vectors.length;evidence.literalSpecCases=MATH_SPEC_CASES.length;evidence.functions=names.length;
  assert.deepEqual(baseline.blank,baseline.eligible);assert.deepEqual(baseline.srcdoc,baseline.eligible);assert.deepEqual(baseline.worker,baseline.eligible);
  check('actual first inline OFF baseline covers '+names.length+' functions, '+vectors.length+' compatibility vectors, '+MATH_SPEC_CASES.length+' literal ECMA cases and native child/worker Math');
  phase='controlled Math UI';
  assert.equal(await evaluate(()=>document.querySelectorAll('[data-math-function]').length),names.length);
  await opened.click('[data-math-mode="spoof"]');await opened.click('[data-math-function="cos"]');
  await opened.click('[data-antidetect-category="network"]');await opened.click('[data-management-tab="contacts"]');await opened.click('[data-management-tab="antidetect"]');await opened.click('[data-antidetect-category="device"]');
  assert.equal(await evaluate(()=>document.querySelector('[data-math-function="cos"]').checked),false);assert.equal((await state()).revision,before.revision);
  await opened.click('[data-antidetect-cancel]');assert.equal(await evaluate(()=>document.querySelector('[data-math-function="cos"]').checked),true);
  await opened.click('[data-math-mode="spoof"]');const dormant=await save();assert.equal(dormant.configuration.enabled,false);assert.equal(dormant.configuration.antidetectEnabled,false);assert.equal(row(dormant).mode,'custom');assert.deepEqual((await probe()).eligible,baseline.eligible);
  assert.deepEqual(dormant.configuration.apis.filter(item=>item.id!=='math-transcendentals'),before.configuration.apis.filter(item=>item.id!=='math-transcendentals'));
  check(names.length+' controlled toggles retain drafts through navigation, Cancel restores them, Save keeps master OFF and does not alter other APIs');
  phase='first inline Spoof';
  // A custom preset isolates Math from the existing optional API Guard preset.
  const custom=await send({type:'ui-api-config-set',tabId:null,expectedRevision:dormant.revision,configuration:{...dormant.configuration,preset:'custom'}});assert.equal(custom.type,'api-config-state');await refresh();
  const active=await toggleMaster();assert.equal(active.registration,'ready');assert.equal(active.configuration.antidetectEnabled,true);assert.equal(active.configuration.enabled,before.configuration.enabled,'Antidetect preserves the independent API Guard master');
  const spoof=await probe();semantics(spoof);assert.deepEqual(spoof.preserve,baseline.preserve);assert.equal(spoof.toString,baseline.toString);
  for(let index=0;index<names.length;index++)assert.equal(distance(spoof.eligible[index],baseline.eligible[index]),1n,names[index]);
  assert.deepEqual(spoof.blank,spoof.eligible);assert.deepEqual(spoof.srcdoc,spoof.eligible);assert.deepEqual((await probe()).eligible,spoof.eligible);
  assert.notDeepEqual((await probe(otherOrigin)).eligible,spoof.eligible);assert.deepEqual(spoof.worker,baseline.eligible);
  assert.deepEqual(spoof.opaque,Array(names.length).fill('SecurityError'));assert.equal(spoof.opaqueControl,9);
  check('document_start Spoof changes every selected probe by exactly 1 ULP, retains exact/special/native semantics and survives forged public marker');
  check('same-origin fresh tabs/about:blank/srcdoc agree; distinct origins differ; workers stay native and opaque sandbox Math is withheld with SecurityError');
  phase='session seed and SW lifetime';
  const secret=await evaluate(async()=>{const api=globalThis.browser??globalThis.chrome;return(await api.storage.local.get('profile-noise-root:v1'))['profile-noise-root:v1'];});assert.match(secret,/^[a-f0-9]{64}$/);
  const local=await evaluate(async()=>{const all=await (globalThis.browser??globalThis.chrome).storage.local.get(null);delete all['profile-noise-root:v1'];return all;});assert.equal(JSON.stringify(local).includes(secret),false,'only the root key holds the root');assert.equal(JSON.stringify(await state()).includes(secret),false,'the configuration state never carries the root');
  evidence.sessionSeedLocalExportExcluded=true;
  if(browser==='chrome'&&opened.context){
    const cdp=await opened.context.browser().newBrowserCDPSession();
    const targets=await cdp.send('Target.getTargets'),target=targets.targetInfos.find(item=>item.type==='service_worker'&&item.url.startsWith(opened.base));assert.ok(target);
    assert.equal((await cdp.send('Target.closeTarget',{targetId:target.targetId})).success,true);await pause(100);await state();
    const persisted=await evaluate(async()=>{const api=globalThis.browser??globalThis.chrome;return(await api.storage.local.get('profile-noise-root:v1'))['profile-noise-root:v1'];});assert.equal(persisted,secret);assert.deepEqual((await probe()).eligible,spoof.eligible);await cdp.detach();evidence.swRestart=true;
    check('Chrome service worker restart preserves the profile noise root (storage.local) and identical new-document results; the portable configuration contains no secret');
  }else check('the profile noise root stays in storage.local outside the portable configuration; Firefox background worker restart is not applicable');
  phase='individual selection and modes';
  await opened.click('[data-math-clear]');const empty=await save();assert.deepEqual(row(empty).selected.value.functions,[]);
  const emptyProbe=await probe();assert.deepEqual(emptyProbe.eligible,baseline.eligible);assert.deepEqual(emptyProbe.opaque,Array(names.length).fill('allowed'));assert.equal(emptyProbe.opaqueControl,9);
  await opened.click('[data-math-function="sin"]');const one=await save();assert.deepEqual(row(one).selected.value.functions,['sin']);
  const single=await probe();for(let index=0;index<names.length;index++)assert.equal(distance(single.eligible[index],baseline.eligible[index]),names[index]==='sin'?1n:0n,names[index]);
  await opened.click('[data-math-mode="allow"]');const allowed=await save();assert.deepEqual(row(allowed).selected,row(one).selected);assert.deepEqual((await probe()).eligible,baseline.eligible);
  const bypass=await send({type:'ui-api-config-set',tabId:null,expectedRevision:allowed.revision,configuration:{...allowed.configuration,apis:allowed.configuration.apis.map(item=>item.id==='math-transcendentals'?{...item,mode:'bypass'}:item)}});assert.equal(bypass.type,'api-config-state');assert.deepEqual((await probe()).eligible,baseline.eligible);await refresh();
  assert.ok(await evaluate(()=>document.querySelector('[data-math-inherited]')));await opened.click('[data-math-mode="spoof"]');await toggleMaster();const disabled=await save();assert.equal(disabled.configuration.antidetectEnabled,false);assert.equal(disabled.configuration.enabled,before.configuration.enabled);assert.deepEqual(row(disabled).userValues,row(bypass).userValues);assert.deepEqual((await probe()).eligible,baseline.eligible);
  check('empty selection keeps normal and opaque Math native; individual selection changes only sin; Allow, Bypass and master OFF retain libraries while using native results');
  phase='localized responsive Math UI';
  for(const language of PRODUCTION_LANGUAGES){const locale=typeof language==='string'?language:language.id;await evaluate(locale=>(globalThis.browser??globalThis.chrome).storage.local.set({'ui-language-v1':locale}),locale);await until(()=>evaluate(locale=>document.querySelector('[data-management-shell]').lang===locale.replaceAll('_','-'),locale),'locale '+locale);const text=await evaluate(()=>document.querySelector('[data-math-transcendentals]').textContent);assert.ok(!/antidetect_math_|undefined|null/.test(text),locale);}
  await evaluate(()=>(globalThis.browser??globalThis.chrome).storage.local.set({'ui-language-v1':'ar'}));await until(()=>evaluate(()=>document.querySelector('[data-management-shell]').lang==='ar'),'Arabic');
  await opened.media({colorScheme:'dark',reducedMotion:'reduce'});
  for(const width of [1180,520,340]){await opened.viewport(width,900);const geometry=await evaluate(()=>({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,dark:matchMedia('(prefers-color-scheme:dark)').matches,dir:getComputedStyle(document.querySelector('[data-math-transcendentals]')).direction,bounds:[...document.querySelectorAll('[data-math-transcendentals],.antidetect-math-group,.antidetect-math-function')].filter(e=>e.getClientRects().length).map(e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right}))}));assert.equal(geometry.overflow,false,JSON.stringify(geometry));assert.equal(geometry.dir,'rtl');assert.equal(geometry.dark,true,'actual native dark media query');for(const bounds of geometry.bounds)assert.ok(bounds.left>=-1&&bounds.right<=geometry.width+1,JSON.stringify(bounds));evidence.layouts.push(geometry);}
  if(browser==='chrome'){await opened.media({forcedColors:'active'});const colors=await evaluate(()=>[...document.querySelectorAll('[data-math-mode][aria-checked="true"]')].map(e=>({fg:getComputedStyle(e).color,bg:getComputedStyle(e).backgroundColor})));assert.ok(colors.length);for(const pair of colors)assert.notEqual(pair.fg,pair.bg);evidence.forcedColors=colors;await opened.media({forcedColors:'none'});}
  await opened.screenshot(join(run,'math-ar-dark-narrow.png'));await opened.viewport(1180,900);await opened.media({colorScheme:'light'});await evaluate(()=>(globalThis.browser??globalThis.chrome).storage.local.set({'ui-language-v1':'ru'}));await until(()=>evaluate(()=>document.querySelector('[data-management-shell]').lang==='ru'),'Russian');await opened.screenshot(join(run,'math-ru-wide.png'));
  check('all 21 locales render Math without raw keys; dark Arabic RTL fits 340px and selected modes remain legible in forced colors where browser emulation supports them');
  evidence.result='PASS';console.log('Math transcendental '+browser+': '+evidence.checks.length+' checks PASS');
}catch(error){evidence.result='FAIL';evidence.phase=phase;evidence.error=error.stack;throw error;}
finally{writeFileSync(join(run,'result.json'),JSON.stringify(evidence,null,2));writeEvidence('math-transcendentals/'+browser+(fromSource?'-from-source':'')+'.json',evidence);await opened?.close();for(const server of servers)await new Promise(done=>server.close(done));}
