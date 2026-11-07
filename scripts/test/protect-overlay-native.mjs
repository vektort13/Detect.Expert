// ADR-058: actual browser detections and trusted pointer actions in a closed ISOLATED page overlay.
// Only the disposable extension copy receives a test-only closed-root observer. No product build or user profile changes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '../..');
const argument = name => { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; };
const input = resolve(argument('--dist') ?? join(root, 'dist/chrome'));
const artifact = resolve(argument('--output') ?? join(root, 'test-results/production-1.1.0/protect/overlay'));
mkdirSync(artifact, { recursive: true }); mkdirSync(join(root, '.tmp'), { recursive: true });
const run = mkdtempSync(join(root, '.tmp/protect-overlay-')), extension = join(run, 'extension');
cpSync(input, extension, { recursive: true });
assert.ok(existsSync(join(extension, 'firewall-overlay.js')), 'build the final inline overlay first');
const digest = text => createHash('sha256').update(text).digest('hex');
const evidence = { at: new Date().toISOString(), run, browser: null, checks: [], facts: {}, screenshots: [], errors: [], unexpectedRequests: [], result: 'RUNNING',
  packagedHashes: Object.fromEntries(['manifest.json', 'protect-sw.js', 'protect-ui.js', 'protect.css', 'firewall-overlay.js'].map(file => [file, digest(readFileSync(join(extension, file)))])) };
const originalOverlay = readFileSync(join(extension, 'firewall-overlay.js')), testPrefix = `;(()=>{
if(globalThis.__protectOverlayNative)return;
const audit={roots:[],events:[],actions:[]};
const attach=Element.prototype.attachShadow;
Element.prototype.attachShadow=function(init){const root=Reflect.apply(attach,this,[init]);if(init?.mode==='closed'){
audit.roots.push(root);for(const type of ['click','change'])root.addEventListener(type,event=>{if(audit.events.length>=100)return;const element=event.composedPath().find(node=>node instanceof Element&&root.contains(node));const hit=type==='click'?root.elementFromPoint(event.clientX,event.clientY):null;const label=element?.closest('label');audit.events.push({type,trusted:event.isTrusted,detail:event.detail??null,tag:element?.tagName??null,hitTag:hit?.tagName??null,sameLabel:Boolean(label&&hit&&label.contains(hit)),action:element?.closest('[data-fw-action]')?.getAttribute('data-fw-action')??null,scope:label?.querySelector('input')?.getAttribute('value')??null});},true);
}return root};
const send=chrome.runtime.sendMessage.bind(chrome.runtime);chrome.runtime.sendMessage=(message,...args)=>{
const row=message?.type==='protect-overlay-action'&&audit.actions.length<100?{action:message.action,scope:message.request?.scope??null,requestKeys:Object.keys(message.request??{})}:null;if(row)audit.actions.push(row);
const answer=send(message,...args);if(row&&answer?.then)answer.then(reply=>{row.ok=reply?.ok;row.code=reply?.code??null;row.response=reply?.response?.type??null;},()=>{row.code='native-rejection';});return answer;
};Object.defineProperty(globalThis,'__protectOverlayNative',{value:audit,configurable:false});})();\n`;
writeFileSync(join(extension, 'firewall-overlay.js'), testPrefix + originalOverlay);
evidence.facts.instrumentation = { world: 'ISOLATED', purpose: 'observe only owned overlay geometry; use real pointer clicks, never expose closed roots to MAIN', prefixSha256: digest(testPrefix), frozenOverlaySha256: digest(readFileSync(join(extension, 'firewall-overlay.js'))) };
const EMAIL = 'overlay-native-fixture@example.com', PASSWORD = 'Synthetic-overlay-password-765432';
const pause = ms => new Promise(done => setTimeout(done, ms));
async function until(probe, label, timeout = 15000) { const deadline = Date.now() + timeout; while (Date.now() < deadline) { const value = await probe(); if (value) return value; await pause(50); } throw Error('timeout: ' + label); }
const check = label => { evidence.checks.push(label); console.log('  ok ' + label); };
let phase = 'startup';
const delivered = [], fixtureRoot = join(root, 'vendor/protect-722fae8/fixtures');
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  const url = new URL(request.url, 'http://fixture'), host = String(request.headers.host ?? '').split(':')[0];
  if (['/fw/collect', '/fsink/pw', '/fsink/batch', '/tr'].includes(url.pathname)) { delivered.push({ host, path: url.pathname }); request.resume(); response.writeHead(204); response.end(); return; }
  if (url.pathname === '/plain' || url.pathname === '/plain-csp') { response.setHeader('Content-Type', 'text/html'); if (url.pathname === '/plain-csp') response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'none'; object-src 'none'"); response.end('<!doctype html><title>Owned overlay fixture</title><h1 id="title">Owned overlay fixture</h1>'); return; }
  const file = url.pathname === '/fixture-lib.js' ? join(root, 'fixtures/fixture-lib.js') : resolve(fixtureRoot, '.' + url.pathname);
  if ((file.startsWith(fixtureRoot + sep) || file === join(root, 'fixtures/fixture-lib.js')) && existsSync(file) && ['.js', '.html'].includes(extname(file))) { response.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : 'text/html; charset=utf-8'); response.end(readFileSync(file)); return; }
  request.resume(); response.writeHead(url.pathname === '/favicon.ico' ? 204 : 404); response.end();
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const port = server.address().port, origin = 'http://www.example.com:' + port;
const leakUrl = label => origin + '/protect/firewall/leak-form.html?rport=' + port + '&to=collect.example.net&onblur=0&phase=' + label;
let context, worker, ui, base, currentSource;
const send = message => ui.evaluate(message => chrome.runtime.sendMessage({ schemaVersion: 1, ...message }), message);
const state = async () => (await send({ type: 'ui-protect-get-state' })).state;
const report = async tabId => (await send({ type: 'ui-protect-get-report', tabId })).report;
const rules = () => worker.evaluate(async () => ({ dynamic: await chrome.declarativeNetRequest.getDynamicRules(), session: await chrome.declarativeNetRequest.getSessionRules() }));
const log = () => worker.evaluate(() => globalThis.__overlayBackendNative);
const receiverDeliveries = () => delivered.filter(row => row.host === 'collect.example.net' && row.path === '/fw/collect').length;
async function tabOf(page) { const tab = await worker.evaluate(url => chrome.tabs.query({}).then(rows => rows.find(row => row.url === url)), page.url()); assert.ok(Number.isSafeInteger(tab?.id)); return tab; }
async function sourcePage(url) { const page = await context.newPage(); await page.goto(url); if (url.includes('leak-form')) await page.waitForFunction(() => window.__fixtureResult?.ready === true); const tab = await tabOf(page); await page.bringToFront(); await worker.evaluate(id => chrome.windows.update(id, { focused: true }), tab.windowId); currentSource = { page, tab }; return currentSource; }
async function isolated(source, operation, selector = '', args = {}) {
  const frame = await worker.evaluate(id => chrome.webNavigation.getFrame({ tabId: id, frameId: 0 }), source.tab.id);
  assert.ok(frame?.documentId, 'native document identity required');
  const result = await worker.evaluate(async ({ tabId, documentId, operation, selector, args }) => (await chrome.scripting.executeScript({ target: { tabId, documentIds: [documentId] }, world: 'ISOLATED', func: ({ operation, selector, args }) => {
    const roots = globalThis.__protectOverlayNative?.roots?.filter(root => root.host.isConnected) ?? [];
    const elements = roots.flatMap(root => [...root.querySelectorAll(selector || '[data-protect-findings],[data-protect-activation-toast]')]);
    if (operation === 'count') return elements.length;
    if (operation === 'click') { elements[0]?.click(); return Boolean(elements[0]); }
    if (operation === 'scroll') { elements[0]?.scrollIntoView({ block: 'center', inline: 'nearest' }); return Boolean(elements[0]); }
    if (operation === 'facts') return elements.map(element => {
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      return { text: element.textContent ?? '', rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, visible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none', attributes: Object.fromEntries([...element.attributes].map(attribute => [attribute.name, attribute.value])), checked: element instanceof HTMLInputElement ? element.checked : null, clipped: element.scrollWidth > element.clientWidth + 1 };
    });
    if (operation === 'meta') {
      const font = element => { if (!element) return null; const style = getComputedStyle(element); return { family: style.fontFamily, font: style.font, token: style.getPropertyValue('--font') }; };
      return { roots: roots.length, publicRoots: roots.filter(root => root.host.shadowRoot !== null).length, events: globalThis.__protectOverlayNative?.events ?? [], actions: globalThis.__protectOverlayNative?.actions ?? [], hosts: roots.map(root => { const rect = root.host.getBoundingClientRect(), style = getComputedStyle(root.host); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, position: style.position, right: style.right, bottom: style.bottom }; }), fonts: { brand: font(roots[0]?.querySelector('.protect-firewall-brand strong')), surface: font(roots[0]?.querySelector('.protect-overlay-page')), fixtureBody: font(document.body) }, viewport: { width: innerWidth, height: innerHeight }, lang: roots[0]?.querySelector('[lang]')?.getAttribute('lang'), dir: roots[0]?.querySelector('[dir]')?.getAttribute('dir') };
    }
    return null;
  }, args: [{ operation, selector, args }] }))[0]?.result, { tabId: source.tab.id, documentId: frame.documentId, operation, selector, args });
  return result;
}
async function visible(source, selector) { return until(async () => (await isolated(source, 'facts', selector)).find(row => row.visible), 'visible isolated ' + selector); }
async function pointer(source, selector) { await isolated(source, 'scroll', selector); await pause(40); const row = await visible(source, selector); const { x, y, width, height } = row.rect; assert.ok(x >= 0 && y >= 0 && x + width <= (await source.page.evaluate(() => innerWidth)) + 1 && y + height <= (await source.page.evaluate(() => innerHeight)) + 1, 'trusted control is inside viewport'); await source.page.mouse.click(x + width / 2, y + height / 2); }
async function noOverlay(source, label, ms = 700) { await pause(ms); assert.equal(await isolated(source, 'count', '[data-protect-findings],[data-protect-activation-toast]'), 0, label); }
async function typeEmail(source) { await source.page.locator('#email').click(); await source.page.keyboard.type(EMAIL, { delay: 4 }); await source.page.locator('#title').click(); }
const fire = source => source.page.evaluate(() => window.__fwSend('fetch'));
async function capture(source, label) {
  const meta = await isolated(source, 'meta'); assert.equal(meta.publicRoots, 0, 'the actual renderer root is closed');
  const locale = label.includes('-ar') ? 'ar' : label.includes('-en') ? 'en' : 'ru';
  assert.equal(meta.lang, locale); assert.equal(meta.dir, locale === 'ar' ? 'rtl' : 'ltr');
  for (const theme of ['light', 'dark']) {
    await source.page.emulateMedia({ colorScheme: theme }); await pause(80);
    const facts = await isolated(source, 'facts', '[data-fw-card],.protect-activation');
    assert.ok(facts.every(row => !row.text.includes(EMAIL) && !row.text.includes(digest(EMAIL))));
    assert.ok(facts.every(row => row.rect.width <= meta.viewport.width && !row.clipped), 'owned UI text fits');
    const host = meta.hosts.find(row => row.width > 0 && row.height > 0); assert.ok(host);
    const clip = { x: Math.max(0, host.x), y: Math.max(0, host.y), width: Math.min(host.width, meta.viewport.width - Math.max(0, host.x)), height: Math.min(host.height, meta.viewport.height - Math.max(0, host.y)) };
    assert.ok(clip.width > 0 && clip.height > 0);
    const file = label + '-' + theme + '.png', bytes = await source.page.screenshot({ path: join(artifact, file), clip }); evidence.screenshots.push({ file, sha256: digest(bytes) });
  }
  evidence.facts.geometry ??= []; evidence.facts.geometry.push({ phase, label, ...meta });
}
async function nativeLauncherOn(source) {
  await source.page.bringToFront();
  await worker.evaluate(async tab => { await chrome.action.setPopup({ tabId: tab.id, popup: 'popup.html' }); await chrome.action.openPopup({ windowId: tab.windowId }); }, source.tab);
  const cdp = await context.newCDPSession(source.page), target = await until(async () => (await cdp.send('Target.getTargets')).targetInfos.find(row => row.type === 'page' && row.url === base + 'popup.html'), 'native launcher target');
  const attached = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false }), jobs = new Map(); let sequence = 0;
  const listener = event => { if (event.sessionId !== attached.sessionId) return; const message = JSON.parse(event.message), job = jobs.get(message.id); if (!job) return; jobs.delete(message.id); clearTimeout(job.timer); message.error ? job.reject(Error(JSON.stringify(message.error))) : job.resolve(message.result); };
  cdp.on('Target.receivedMessageFromTarget', listener);
  const rpc = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence, timer = setTimeout(() => { jobs.delete(id); reject(Error('CDP timeout ' + method)); }, 10000); jobs.set(id, { resolve, reject, timer }); cdp.send('Target.sendMessageToTarget', { sessionId: attached.sessionId, message: JSON.stringify({ id, method, params }) }).catch(reject); });
  const evaluate = async expression => { const response = await rpc('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (response.exceptionDetails) throw Error(JSON.stringify(response.exceptionDetails)); return response.result?.value; };
  try {
    const rect = await until(() => evaluate('(()=>{const b=document.querySelector("[data-protect-settings]");return b&&!b.disabled&&b.getAttribute("aria-checked")==="false"?b.getBoundingClientRect().toJSON():null})()'), 'native ON control');
    for (const type of ['mousePressed', 'mouseReleased']) await rpc('Input.dispatchMouseEvent', { type, button: 'left', clickCount: 1, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
    await until(() => evaluate('chrome.runtime.sendMessage({schemaVersion:1,type:"ui-protect-get-state"}).then(r=>r.state.state==="active")'), 'native enable completed');
    await evaluate('setTimeout(()=>window.close(),0);true');
  } finally { cdp.off('Target.receivedMessageFromTarget', listener); await cdp.detach(); }
}

try {
  context = await chromium.launchPersistentContext(join(run, 'profile'), { channel: 'chromium', headless: true, viewport: null, args: ['--window-size=1100,850', '--disable-extensions-except=' + extension, '--load-extension=' + extension, '--no-proxy-server', '--host-resolver-rules=MAP *.example.com 127.0.0.1, MAP *.example.net 127.0.0.1, MAP *.example.org 127.0.0.1'] });
  evidence.browser = context.browser()?.version() ?? null;
  context.on('page', page => page.on('pageerror', error => evidence.errors.push({ phase, error: error.message })));
  await context.route('**/*', async route => { const url = new URL(route.request().url()); if (!['http:', 'https:'].includes(url.protocol) || (/\.example\.(?:com|net|org)$/.test(url.hostname) && url.port === String(port))) await route.continue(); else { evidence.unexpectedRequests.push(url.origin); await route.abort(); } });
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'); base = new URL('.', worker.url()).href;
  await worker.evaluate(() => {
    const log = { windowCreates: 0, injections: [], shows: [], networkErrors: [], native: [] }; globalThis.__overlayBackendNative = log;
    const record = value => { if (log.native.length < 300) log.native.push(value); };
    const audited = (promise, observe) => promise?.then ? promise.then(value => { try { observe(value); } catch { /* Diagnostics do not affect native responses. */ } return value; }) : promise;
    const query = chrome.tabs.query.bind(chrome.tabs); chrome.tabs.query = (options, ...args) => audited(query(options, ...args), result => { if (options?.active) record({ kind: 'tabs.query', at: Date.now(), lastFocusedWindow: options.lastFocusedWindow, tabs: result.map(tab => ({ id: tab.id, windowId: tab.windowId, active: tab.active, http: /^https?:/.test(tab.url ?? '') })) }); });
    const getTab = chrome.tabs.get.bind(chrome.tabs); chrome.tabs.get = (id, ...args) => audited(getTab(id, ...args), tab => record({ kind: 'tabs.get', at: Date.now(), id, nativeId: tab.id, windowId: tab.windowId, active: tab.active, http: /^https?:/.test(tab.url ?? ''), pending: tab.pendingUrl !== undefined }));
    const getWindow = chrome.windows.get.bind(chrome.windows); chrome.windows.get = (id, ...args) => audited(getWindow(id, ...args), result => record({ kind: 'windows.get', at: Date.now(), id, focused: result.focused, type: result.type }));
    const getFrame = chrome.webNavigation.getFrame.bind(chrome.webNavigation); chrome.webNavigation.getFrame = (details, ...args) => audited(getFrame(details, ...args), result => record({ kind: 'getFrame', at: Date.now(), tabId: details.tabId, frameId: details.frameId, documentId: result?.documentId, lifecycle: result?.documentLifecycle, http: /^https?:/.test(result?.url ?? ''), errorOccurred: result?.errorOccurred }));
    const create = chrome.windows.create.bind(chrome.windows); chrome.windows.create = (...args) => { log.windowCreates++; return create(...args); };
    const inject = chrome.scripting.executeScript.bind(chrome.scripting); chrome.scripting.executeScript = (options, ...args) => { if (options.files?.includes('firewall-overlay.js')) log.injections.push({ target: options.target, world: options.world, files: options.files }); return inject(options, ...args); };
    const send = chrome.tabs.sendMessage.bind(chrome.tabs); chrome.tabs.sendMessage = (tabId, message, options, ...args) => { if (message?.type === 'protect-overlay-show') log.shows.push({ tabId, kind: message.kind, generation: message.generation, documentKey: message.documentKey, options }); return send(tabId, message, options, ...args); };
    chrome.webRequest.onErrorOccurred.addListener(details => { if (new URL(details.url).hostname === 'collect.example.net') log.networkErrors.push({ tabId: details.tabId, error: details.error }); }, { urls: ['http://collect.example.net/*'] });
  });
  ui = await context.newPage(); await ui.goto(base + 'options.html#firewall');
  await ui.evaluate(() => chrome.storage.local.set({ 'ui-language-v1': 'ru' })); await ui.reload();
  phase = 'OFF and consent'; const off = await sourcePage(leakUrl('off')); await typeEmail(off); await fire(off); await until(() => receiverDeliveries() > 0, 'OFF transfer reached owned receiver'); await noOverlay(off, 'OFF shows no overlay');
  // ADR-090/098: the workspace header switch owns power; one explicit click enables without a dialog.
  await ui.bringToFront(); const master = ui.locator('[data-workspace-master="firewall"] [data-protect-toggle="status"]'); await master.waitFor();
  assert.equal(await master.getAttribute('aria-checked'), 'false'); await master.click(); await until(async () => (await state()).state === 'active', 'direct header activation');
  assert.equal(await ui.locator('dialog[open], [aria-modal="true"], [data-protect-inline-consent]').count(), 0, 'ADR-098: no activation dialog or inline consent');
  await send({ type: 'ui-protect-disable', purge: false }); await until(async () => (await state()).state === 'off', 'durable OFF before launcher'); await off.page.close();
  check('OFF does not show an overlay; the first enable is one explicit header click without a dialog (ADR-098)');

  phase = 'real launcher activation'; const active = await sourcePage(origin + '/plain'); await nativeLauncherOn(active); const activated = await visible(active, '[data-protect-activation-toast][data-activation-state="active"]'), activationAt = Date.now();
  await capture(active, 'activation-ru'); assert.equal((await log()).windowCreates, 0); await until(async () => await isolated(active, 'count', '[data-protect-activation-toast]') === 0, 'activation expires', 6500);
  const lifetime = Date.now() - activationAt; assert.ok(lifetime >= 4000 && lifetime <= 6500); evidence.facts.activation = { lifetimeMs: lifetime, nonblank: activated.text.trim().length > 10 };
  assert.equal((await log()).injections.at(-1).world, 'ISOLATED'); assert.deepEqual((await log()).injections.at(-1).target.documentIds.length, 1);
  await active.page.close(); check('real launcher ON renders a nonblank inline acknowledgement for five seconds without creating a browser window');

  phase = 'strict CSP'; await send({ type: 'ui-protect-disable', purge: false });
  const csp = await sourcePage(origin + '/plain-csp'); await nativeLauncherOn(csp); await visible(csp, '[data-protect-activation-toast]');
  const cspGeometry = await isolated(csp, 'meta'); assert.equal(cspGeometry.hosts[0].position, 'fixed'); assert.equal(cspGeometry.hosts[0].right, '16px'); assert.equal(cspGeometry.hosts[0].bottom, '16px'); await capture(csp, 'activation-csp-ru');
  await pointer(csp, '[data-activation-close]'); await csp.page.close();
  check('strict script-src self/style-src none does not prevent the closed-root local stylesheet and fixed bottom-right geometry');

  phase = 'negative traffic'; const quiet = await sourcePage(leakUrl('quiet')); await typeEmail(quiet); await noOverlay(quiet, 'typing alone is not a finding');
  const beforeNoMatch = receiverDeliveries(); await quiet.page.evaluate(url => fetch(url, { method: 'POST', body: 'owned-fixture-without-the-typed-value', mode: 'no-cors' }), 'http://collect.example.net:' + port + '/fw/collect'); await until(() => receiverDeliveries() > beforeNoMatch, 'unmatched request reached owned receiver'); await noOverlay(quiet, 'an unmatched request cannot create findings'); await quiet.page.close();
  const password = await sourcePage(origin + '/protect/forms/password-negative.html?rp=' + port); await password.page.locator('#password').click(); await password.page.keyboard.type(PASSWORD, { delay: 3 }); await password.page.locator('#title').click(); await until(() => delivered.some(row => row.path === '/fsink/pw'), 'owned password fixture request'); await noOverlay(password, 'password-only traffic is not a finding'); assert.equal((await report(password.tab.id)).evidence.filter(row => row.protectKind === 'value-match').length, 0); await password.page.close();
  check('typing without traffic and actual password-only traffic do not create empty findings');

  phase = 'actual transfer'; let source = await sourcePage(leakUrl('positive')); await typeEmail(source); await fire(source);
  const detected = await until(async () => { const value = await report(source.tab.id); return value?.firewall?.prompt && value.evidence.some(row => row.protectKind === 'value-match' && row.deliveryState === 'sent') ? value : null; }, 'actual matched sent transfer and pending prompt');
  await visible(source, '[data-fw-card]'); for (const row of ['sender', 'company', 'receiver', 'data', 'moment']) assert.ok((await visible(source, '[data-fw-row="' + row + '"]')).text.trim().length > 0);
  assert.ok((await isolated(source, 'count', '.fw-chip')) > 0); await capture(source, 'finding-ru');
  const nativeFrame = await worker.evaluate(id => chrome.webNavigation.getFrame({ tabId: id, frameId: 0 }), source.tab.id); assert.equal(detected.documentKey, source.tab.id + ':0:' + nativeFrame.documentId);
  const show = (await log()).shows.filter(row => row.kind === 'findings' && row.tabId === source.tab.id).at(-1); assert.deepEqual(show.options, { documentId: nativeFrame.documentId, frameId: 0 });
  assert.equal(await source.page.evaluate(() => [...document.querySelectorAll('*')].some(node => node.shadowRoot?.querySelector('[data-fw-card]'))), false, 'MAIN cannot inspect closed-root facts');
  check('actual trusted e-mail plus page fetch produces a document-bound closed-root card with five factual rows and chips');

  phase = 'synthetic actions'; const beforeSynthetic = await rules();
  await isolated(source, 'click', '[data-fw-action="block"]');
  const currentForForgery = await report(source.tab.id); assert.ok(currentForForgery.firewall.prompt);
  await source.page.evaluate(({ show, prompt, revision }) => window.postMessage({ schemaVersion: 1, type: 'protect-overlay-action', kind: 'findings', generation: show.generation, documentKey: show.documentKey, action: 'decide', request: { documentKey: show.documentKey, protectRevision: revision, promptId: prompt.promptId, receivers: prompt.receivers, action: 'block', scope: 'once' } }, '*'), { show, prompt: currentForForgery.firewall.prompt, revision: currentForForgery.protectRevision });
  await pause(400); assert.deepEqual(await rules(), beforeSynthetic); assert.ok((await report(source.tab.id)).firewall.prompt);
  check('scripted closed-root clicks and forged MAIN messages cannot mutate rules');

  phase = 'persistent decision review'; const beforeReview = await rules();
  await pointer(source, 'label:has(input[name="fw-scope"][value="site"])'); assert.equal((await isolated(source, 'facts', 'input[name="fw-scope"][value="site"]'))[0].checked, true); await pointer(source, '[data-fw-action="block"]');
  const reviewPage = await until(() => context.pages().find(page => page.url() === base + 'firewall.html?tab=' + source.tab.id), 'exact owned review page for a persistent decision');
  assert.deepEqual(await rules(), beforeReview, 'a page-hosted persistent decision never writes a rule before extension-owned review');
  await reviewPage.close(); await source.page.close();
  check('persistent scope from the page opens only the owned review tab and cannot directly write persistent rules');

  // Review deliberately takes the source out of focus. Once is a separate real detection on a fresh native document.
  phase = 'real once block and undo'; source = await sourcePage(leakUrl('once')); await typeEmail(source); await fire(source);
  await until(async () => (await report(source.tab.id))?.firewall.prompt, 'fresh genuine prompt for a once decision'); await visible(source, '[data-fw-card]');
  // Let the vendored prompt initialization effect finish before exercising its controlled radio state.
  await pause(250); await pointer(source, 'label:has(input[name="fw-scope"][value="once"])');
  await until(async () => (await isolated(source, 'facts', 'input[name="fw-scope"][value="once"]'))[0]?.checked === true && (await isolated(source, 'facts', '[data-fw-scope]'))[0]?.attributes['data-fw-scope'] === 'once', 'a trusted scope click commits once in the native radio and card view-model', 1500);
  await pointer(source, '[data-fw-action="block"]');
  const onceRule = await until(async () => (await rules()).session.find(rule => rule.action.type === 'block' && rule.condition.requestDomains?.includes('example.net')), 'trusted once block creates a native session rule');
  assert.ok(onceRule.condition.tabIds?.includes(source.tab.id)); await visible(source, '[data-fw-undo]'); const beforeBlocked = receiverDeliveries(), failedBefore = await source.page.evaluate(() => window.__fwSettled.failed); await fire(source);
  await until(() => source.page.evaluate(previous => window.__fwSettled.failed > previous, failedBefore), 'future request was blocked'); assert.equal(receiverDeliveries(), beforeBlocked); assert.ok((await log()).networkErrors.some(row => row.tabId === source.tab.id && row.error === 'net::ERR_BLOCKED_BY_CLIENT'));
  await pointer(source, '[data-fw-undo]'); await until(async () => !(await rules()).session.some(row => row.id === onceRule.id), 'trusted Undo removes only its once rule'); const afterUndo = receiverDeliveries(); await fire(source); await until(() => receiverDeliveries() > afterUndo, 'delivery resumes after Undo');
  check('trusted pointer once-block changes the real future DNR outcome and its owned Undo restores delivery');

  phase = 'close suppression'; await pointer(source, '[data-findings-close]'); await noOverlay(source, 'explicit close removes owned inline UI', 100); await fire(source); await noOverlay(source, 'same semantic finding stays dismissed', 11000);
  await source.page.goto(origin + '/plain'); await noOverlay(source, 'navigation removes previous document UI', 200); await source.page.close();
  check('closing suppresses count-only repeats beyond the rate interval and navigation removes the old document overlay');

  for (const locale of ['en', 'ar']) {
    phase = 'locale ' + locale; await ui.evaluate(locale => chrome.storage.local.set({ 'ui-language-v1': locale }), locale);
    const localized = await sourcePage(leakUrl(locale)); await typeEmail(localized); await fire(localized); await visible(localized, '[data-fw-card]'); await capture(localized, 'finding-' + locale);
    if (locale === 'ar') { await localized.page.setViewportSize({ width: 390, height: 844 }); await pause(200); await capture(localized, 'finding-ar-mobile'); }
    await pointer(localized, '[data-findings-close]'); await localized.page.close();
  }
  check('RU/EN/AR light and dark inline cards, including a narrow viewport, remain inside their host page');

  phase = 'OFF cleanup after SW restart'; await ui.evaluate(() => chrome.storage.local.set({ 'ui-language-v1': 'ru' })); const cancel = await sourcePage(leakUrl('off-cancel')); await typeEmail(cancel); await fire(cancel); await visible(cancel, '[data-fw-card]');
  evidence.facts.backend = await log(); assert.equal(evidence.facts.backend.windowCreates, 0, 'inline delivery never calls windows.create');
  await ui.bringToFront();
  evidence.facts.overlayPresentBeforeRestart = await cancel.page.evaluate(() => document.querySelector('[data-protect-overlay-kind]') !== null);
  const restartCdp = await context.newCDPSession(ui); try { await restartCdp.send('ServiceWorker.enable'); await restartCdp.send('ServiceWorker.stopAllWorkers'); } finally { await restartCdp.detach(); }
  assert.equal((await state()).state, 'active', 'a real worker restart restores saved ON without replacing the current document');
  evidence.facts.overlayPresentAfterRestartBeforeOff = await cancel.page.evaluate(() => document.querySelector('[data-protect-overlay-kind]') !== null);
  await send({ type: 'ui-protect-disable', purge: false }); await until(async () => (await state()).state === 'off', 'OFF applied');
  await cancel.page.waitForFunction(() => document.querySelector('[data-protect-overlay-kind]') === null, undefined, { timeout: 4000 });
  assert.equal(await ui.evaluate(async () => (await chrome.windows.getAll()).filter(row => row.type === 'popup').length), 0);
  assert.deepEqual(evidence.unexpectedRequests, []); assert.deepEqual(evidence.errors, []);
  evidence.facts.finalState = (await state()).state; evidence.facts.realServiceWorkerRestart = true; evidence.result = 'PASS'; check('a real worker restart followed by OFF leaves no old inline overlay; deliveries created zero browser windows');
  console.log('PASS protect overlay native: ' + evidence.checks.length + ' checks');
} catch (error) {
  try { if (currentSource && !currentSource.page.isClosed()) { evidence.facts.failureOverlay = await isolated(currentSource, 'meta'); evidence.facts.failureCard = await isolated(currentSource, 'facts', '[data-fw-scope],input[name="fw-scope"],.fw-message,[role="alert"]'); } evidence.facts.failureRules = await rules(); } catch { /* Preserve the original native failure if its document is already gone. */ }
  evidence.result = 'FAIL'; evidence.failure = { phase, error: String(error.stack ?? error) }; console.error(JSON.stringify(evidence.failure, null, 2)); process.exitCode = 1;
} finally {
  try { if (worker) evidence.facts.finalBackend = await log(); } catch { /* Owned worker may be gone. */ }
  writeFileSync(join(artifact, 'overlay-native.json'), JSON.stringify(evidence, null, 2) + '\n');
  await context?.close(); await new Promise(done => server.close(done));
}
