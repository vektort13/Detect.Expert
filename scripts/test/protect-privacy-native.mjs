// ADR-020 §15 / ADR-047, audit F5: native production privacy gate. Instrumentation
// is prepended only to an isolated copy of delivered files, never to shipped code.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { extensionEgress, boundedConsoleValue, deferredExtensionEvents } from '../privacy-observers.mjs';

const root = resolve(import.meta.dirname, '../..');
const argument = name => { const index = process.argv.indexOf(name); if (index < 0) return null; if (!process.argv[index + 1] || process.argv[index + 1].startsWith('--')) throw Error(name + ' requires a path'); return resolve(process.argv[index + 1]); };
const input = argument('--dist') ?? join(root, 'dist/chrome'), output = argument('--output') ?? join(root, 'test-results/production-1.1.0/protect/privacy-native.json');
if (process.argv.includes('--build') && argument('--dist')) throw Error('--build cannot be combined with --dist');
if (process.argv.includes('--build')) {
  const built = spawnSync(process.execPath, [join(root, 'scripts/build-production.mjs'), '--browser', 'chrome'], { cwd: root, stdio: 'inherit', windowsHide: true });
  if (built.status !== 0) process.exit(built.status ?? 1);
}
const temporary = join(root, '.tmp'), artifact = resolve(output, '..');
mkdirSync(temporary, { recursive: true }); mkdirSync(artifact, { recursive: true });
const run = mkdtempSync(join(temporary, 'protect-privacy-native-')), extension = join(run, 'extension');
cpSync(input, extension, { recursive: true });
const canaries = { email: 'privacy-native-7e9b@example.invalid', phone: '+15551239876', name: 'Canary Native Seventynine', password: 'PrivacyPasswordCanary7e9b38', otp: '794621', notes: 'PrivacyFreeTextCanary4b2f18' };
const longSection = 'section-' + 'a'.repeat(100) + ' ';
const attributeSafetyCases = [
  { mode: 'long-current-password', type: 'email', autocomplete: longSection + 'current-password', kind: 'long-password', canary: 'email' },
  { mode: 'long-whitespace-password', type: 'email', autocomplete: ' '.repeat(65) + 'current-password', kind: 'long-password', canary: 'email' },
  { mode: 'long-new-password', type: 'email', autocomplete: longSection + 'new-password', kind: 'long-password', canary: 'email' },
  { mode: 'long-one-time-code', type: 'tel', autocomplete: longSection + 'one-time-code', kind: 'long-otp', canary: 'phone' },
  { mode: 'long-over-limit', type: 'email', autocomplete: 'a'.repeat(4097), kind: 'uninspected-field', canary: 'email' },
  { mode: 'long-payment', type: 'email', autocomplete: 'email', kind: 'payment-email', canary: 'email', payment: longSection + 'cc-number' },
  { mode: 'long-payment-after-password', type: 'email', autocomplete: 'email', kind: 'payment-email', canary: 'email', payment: 'current-password ' + longSection + 'cc-exp' },
  { mode: 'long-ordinary-email', type: 'email', autocomplete: longSection + 'email', kind: 'normal-email', canary: 'email', allowed: true },
];
const evidence = { at: new Date().toISOString(), run, checks: [], cases: {}, errors: [], console: [], unexpectedRequests: [], extensionEgress: [], hashes: {}, positiveControls: {} };
const check = text => { evidence.checks.push(text); console.log('  ok ' + text); };
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

// Deliberately independent of the collector's type-history observer: fixture
// attributes label forbidden controls before any mutation, including Shadow DOM.
// Counters retain API names and labels, never values, lengths, hashes or excerpts.
function independentTripwire(world) {
  const apply = Reflect.apply, define = Object.defineProperty, descriptor = Object.getOwnPropertyDescriptor;
  const attribute = Element.prototype.getAttribute, setAttribute = Element.prototype.setAttribute;
  const add = EventTarget.prototype.addEventListener, composedPath = Event.prototype.composedPath;
  const stringify = JSON.stringify, parse = JSON.parse;
  const counts = { world, ready: true, controls: {}, reads: {}, wire: [], channel: [], bytes: 0, overflow: false };
  let checking = false;
  const targetOf = event => { try { return apply(composedPath, event, [])[0] ?? event.target; } catch { return null; } };
  function mark(target) { try { return apply(attribute, target, ['data-privacy-kind']); } catch { return null; } }
  function note(target, api) {
    const kind = mark(target); if (!kind && !checking) return;
    const bucket = checking ? counts.controls : (counts.reads[kind] ??= {});
    bucket[api] = (bucket[api] ?? 0) + 1;
    publish();
  }
  function publish() {
    if (!document.documentElement) return;
    const value = { world, ready: true, controls: counts.controls, reads: counts.reads, wireCount: counts.wire.length, channelCount: counts.channel.length, overflow: counts.overflow };
    apply(setAttribute, document.documentElement, ['data-privacy-' + world, stringify(value)]);
  }
  function capture(bucket, value) {
    if (counts.overflow) return;
    let text; try { text = stringify(value); } catch { counts.overflow = true; return; }
    if (text.length > 65536 || bucket.length >= 2048 || counts.bytes + text.length * 2 > 1048576) { counts.overflow = true; publish(); return; }
    counts.bytes += text.length * 2; bucket.push(parse(text)); publish();
  }
  function getter(owner, key, target = value => value, api = key) {
    while (owner && !descriptor(owner, key)) owner = Object.getPrototypeOf(owner);
    const original = owner && descriptor(owner, key); if (typeof original?.get !== 'function') return;
    define(owner, key, { ...original, get() { note(target(this), api); return apply(original.get, this, []); } });
  }
  for (const key of ['value', 'valueAsNumber', 'valueAsDate']) getter(HTMLInputElement.prototype, key);
  getter(HTMLTextAreaElement.prototype, 'value', value => value, 'textareaValue');
  getter(InputEvent.prototype, 'data', targetOf, 'inputData'); getter(InputEvent.prototype, 'dataTransfer', targetOf, 'inputTransfer');
  for (const key of ['key', 'code', 'keyCode', 'charCode', 'which']) getter(KeyboardEvent.prototype, key, targetOf, 'keyboard:' + key);
  const originalAttribute = descriptor(Element.prototype, 'getAttribute');
  define(Element.prototype, 'getAttribute', { ...originalAttribute, value: function(key) { if (typeof key === 'string' && key.toLowerCase() === 'value') note(this, 'valueAttribute'); return apply(originalAttribute.value, this, [key]); } });
  const originalData = descriptor(DataTransfer.prototype, 'getData');
  define(DataTransfer.prototype, 'getData', { ...originalData, value: function(...args) { note(document.activeElement, 'dataTransferGetData'); return apply(originalData.value, this, args); } });
  const originalFormData = descriptor(globalThis, 'FormData');
  if (typeof originalFormData?.value === 'function') {
    const NativeFormData = originalFormData.value;
    const wrapped = function(...args) {
      if (new.target === undefined) return apply(NativeFormData, this, args);
      const result = Reflect.construct(NativeFormData, args, new.target);
      if (args[0] instanceof HTMLFormElement) for (const input of args[0].elements) note(input, 'formData');
      return result;
    };
    wrapped.prototype = NativeFormData.prototype; define(globalThis, 'FormData', { ...originalFormData, value: wrapped });
  }
  if (world === 'isolated') {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (...args) => { if (typeof args[0]?.type === 'string' && args[0].type.startsWith('protect-')) capture(counts.wire, args[0]); return send(...args); };
  }
  apply(add, globalThis, ['message', event => { if (event.source === globalThis && event.data?.channel === 'detect.expert/protect/v1') capture(counts.channel, event.data); }]);
  define(globalThis, '__productionPrivacyProbe', { value: { snapshot: () => parse(stringify(counts)) }, configurable: false });
  // Every instrumented reader is exercised on a detached synthetic control in
  // both worlds. A zero forbidden count is accepted only after these controls.
  checking = true;
  try {
    const input = document.createElement('input'), text = document.createElement('textarea'), form = document.createElement('form');
    apply(setAttribute, input, ['data-privacy-kind', 'control']); apply(setAttribute, input, ['type', 'password']); apply(setAttribute, input, ['type', 'text']);
    void input.value; void input.valueAsNumber; void input.valueAsDate; void text.value; input.getAttribute('value');
    apply(add, input, ['input', event => { void event.data; void event.dataTransfer; }]); input.dispatchEvent(new InputEvent('input'));
    apply(add, input, ['keydown', event => { for (const key of ['key', 'code', 'keyCode', 'charCode', 'which']) void event[key]; }]); input.dispatchEvent(new KeyboardEvent('keydown'));
    new DataTransfer().getData('text/plain'); form.appendChild(input); new FormData(form);
  } finally { checking = false; }
  publish(); apply(add, document, ['DOMContentLoaded', publish, { once: true }]);
}

for (const [file, world] of [['protect.js', 'isolated'], ['protect.main.js', 'main']]) {
  const path = join(extension, file), bytes = readFileSync(path);
  evidence.hashes[file] = createHash('sha256').update(bytes).digest('hex');
  writeFileSync(path, '(' + independentTripwire.toString() + ')(' + JSON.stringify(world) + ');\n' + bytes.toString('utf8'));
}
for (const file of ['manifest.json', 'protect-sw.js', 'background.js']) evidence.hashes[file] = createHash('sha256').update(readFileSync(join(extension, file))).digest('hex');

function pageFacts() {
  return { descriptors: [[window, 'fetch'], [EventTarget.prototype, 'addEventListener'], [MutationObserver.prototype, 'observe'], [HTMLInputElement.prototype, 'value']].map(([owner, key]) => { const value = Object.getOwnPropertyDescriptor(owner, key); return { key, get: typeof value?.get === 'function' ? Function.prototype.toString.call(value.get) : null, value: typeof value?.value === 'function' ? Function.prototype.toString.call(value.value) : null, set: typeof value?.set === 'function' ? Function.prototype.toString.call(value.set) : null, configurable: value?.configurable, enumerable: value?.enumerable }; }), gpc: typeof navigator.globalPrivacyControl, markers: Object.getOwnPropertySymbols(window).map(symbol => symbol.description ?? '').filter(name => name.startsWith('detect.expert/protect')), probe: typeof window.__productionPrivacyProbe };
}
function fixtureHtml(mode) {
  const field = (id, attributes, kind = id) => '<input id="' + id + '" data-privacy-kind="' + kind + '" ' + attributes + '>';
  let fields = field('email', 'type="email" autocomplete="email" name="email"', 'normal-email') + field('phone', 'type="tel" autocomplete="tel" name="phone"', 'normal-phone') + field('name', 'autocomplete="name" name="full_name"', 'normal-name') + field('password', 'type="password" autocomplete="current-password" name="password"', 'password') + field('otp', 'autocomplete="one-time-code" name="otp"', 'otp') + '<textarea id="notes" data-privacy-kind="notes"></textarea>';
  if (mode === 'payment-light') fields = field('email', 'type="email" autocomplete="email"', 'payment-email') + field('card', 'autocomplete="cc-number"', 'card');
  const safety = attributeSafetyCases.find(row => row.mode === mode);
  if (safety) {
    fields = field('email', 'type="' + safety.type + '" autocomplete="' + safety.autocomplete + '" name="email"', safety.kind);
    if (safety.payment) fields += field('card', 'autocomplete="' + safety.payment + '"', 'card');
  }
  if (mode === 'former-light' || mode === 'detached-known') fields = field('field', 'type="password" name="email" value="' + canaries.password + '"', 'former-password');
  if (mode === 'toggle-task') fields = field('field', 'type="text" name="email"', 'former-password');
  let action = '';
  if (['former-light', 'toggle-task'].includes(mode)) action = "const field=document.querySelector('#field');field.type='password';field.type='text';";
  if (mode === 'detached-known') action = "const field=document.querySelector('#field');field.remove();field.type='text';document.querySelector('#slot').appendChild(field);";
  let shadow = '';
  if (mode === 'shadow-former') shadow = "const r=document.querySelector('#shadow').attachShadow({mode:'open'});r.innerHTML=" + JSON.stringify(field('field', 'type="password" name="email" value="' + canaries.password + '"', 'former-password')) + ";document.querySelector('#action').onclick=()=>{r.querySelector('input').type='text';};";
  if (mode === 'shadow-payment') shadow = "const r=document.querySelector('#shadow').attachShadow({mode:'open'});r.innerHTML=" + JSON.stringify(field('field', 'type="email" name="email" autocomplete="email"', 'shadow-payment-email') + field('card', 'autocomplete="cc-number"', 'card')) + ';';
  if (mode === 'closed-shadow') shadow = "const r=document.querySelector('#shadow').attachShadow({mode:'closed'});r.innerHTML=" + JSON.stringify(field('field', 'type="password" name="email" value="' + canaries.password + '"', 'former-password')) + ";document.querySelector('#action').onclick=()=>{const field=r.querySelector('input');field.type='text';field.focus();};";
  return '<!doctype html><html><head><title>Owned production privacy fixture</title></head><body><h1 id="title" tabindex="0">Privacy fixture</h1><form id="fields">' + fields + '</form><button id="action" type="button">Prepare field</button><button id="positive" type="button">Read password control</button><div id="shadow" data-privacy-kind="shadow-host"></div><div id="slot"></div><script>' + shadow + "document.querySelector('#positive').onclick=()=>{void document.querySelector('#password').value;};" + (action ? "document.querySelector('#action').onclick=()=>{" + action + '};' : '') + "const c=document.createElement('canvas'),ctx=c.getContext('2d');ctx.fillText('fixture',1,10);ctx.getImageData(0,0,1,1);c.toDataURL();window.fixtureReady=true;" + '</script></body></html>';
}
let origin, context, plain, extensionId = '';
const received = [];
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://fixture.invalid'); response.setHeader('Cache-Control', 'no-store'); response.setHeader('Access-Control-Allow-Origin', '*'); response.setHeader('Access-Control-Allow-Headers', '*');
  if (url.pathname === '/collect') { received.push({ host: request.headers.host?.split(':')[0], method: request.method }); request.resume(); response.writeHead(204); response.end(); return; }
  if (url.pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(fixtureHtml(url.searchParams.get('mode') ?? 'normal'));
});
const requiredControls = ['value', 'valueAsNumber', 'valueAsDate', 'textareaValue', 'valueAttribute', 'inputData', 'inputTransfer', 'keyboard:key', 'keyboard:code', 'keyboard:keyCode', 'keyboard:charCode', 'keyboard:which', 'dataTransferGetData', 'formData'];
const variants = new Map();
for (const [name, value] of Object.entries(canaries)) {
  const forms = new Set([value, value.trim(), value.toLowerCase(), value.toUpperCase()]);
  if (name === 'phone') forms.add(value.replace(/\D/g, ''));
  let index = 0;
  for (const form of forms) {
    const label = name + ':' + index++;
    for (const [kind, text] of [['plain', form], ['url', encodeURIComponent(form)], ['base64', Buffer.from(form).toString('base64')], ['base64url', Buffer.from(form).toString('base64url')]]) variants.set(label + ':' + kind, text);
    for (const algorithm of ['md5', 'sha1', 'sha256', 'sha512']) for (const encoding of ['hex', 'base64', 'base64url']) {
      const hash = createHash(algorithm).update(form).digest(encoding);
      variants.set(label + ':' + algorithm + ':' + encoding, hash);
      if (encoding === 'hex') variants.set(label + ':' + algorithm + ':upper', hash.toUpperCase());
    }
  }
}
function scan(label, value) {
  const text = JSON.stringify(value);
  for (const [name, variant] of variants) assert.equal(text.includes(variant), false, label + ': forbidden canary variant ' + name);
}
for (const variant of variants.values()) assert.throws(() => scan('scanner-positive-control', { planted: variant }), /forbidden canary variant/);
evidence.positiveControls.canaryScannerVariants = variants.size;
async function poll(read, accepts, message, attempts = 70) { for (let index = 0; index < attempts; index++) { const value = await read(); if (accepts(value)) return value; await sleep(100); } throw Error(message); }
function countersClean(snapshot, label) {
  assert.equal(snapshot?.ready, true, label + ': independent probe must run'); assert.equal(snapshot.overflow, false, label + ': bounded capture must not overflow');
  for (const api of requiredControls) assert.ok(snapshot.controls[api] >= 1, label + ': positive reader control ' + api);
  for (const [kind, reads] of Object.entries(snapshot.reads)) if (!['normal-email', 'normal-phone', 'normal-name'].includes(kind)) assert.equal(Object.values(reads).reduce((sum, count) => sum + count, 0), 0, label + ': forbidden read of ' + kind);
}
try {
  await new Promise(done => server.listen(0, '127.0.0.1', done)); origin = 'http://www.example.com:' + server.address().port;
  const resolver = 'MAP *.example.com 127.0.0.1,MAP *.example.net 127.0.0.1,MAP *.example.org 127.0.0.1,MAP *.example.edu 127.0.0.1';
  const launchOptions = { channel: 'chromium', headless: true, args: ['--no-proxy-server', '--host-resolver-rules=' + resolver] };
  plain = await chromium.launchPersistentContext(join(run, 'plain-profile'), launchOptions);
  const baseline = await plain.newPage(); await baseline.goto(origin + '/'); const nativeFacts = await baseline.evaluate(pageFacts); await plain.close(); plain = null;
  context = await chromium.launchPersistentContext(join(run, 'profile'), { ...launchOptions, ignoreDefaultArgs: ['--disable-extensions'], args: [...launchOptions.args, '--enable-unsafe-extension-debugging'] });
  let egressControl = false;
  const controlUrl = origin + '/privacy-observer-control';
  const startupRequests = deferredExtensionEvents(({ owner, url }) => {
    const request = { url: () => url, serviceWorker: () => null, frame: () => ({ url: () => owner }) };
    if (extensionEgress(request, extensionId)) { if (url === controlUrl) egressControl = true; else evidence.extensionEgress.push(url); }
  }, () => { evidence.networkOverflow = true; });
  context.on('request', request => { let owner = request.serviceWorker()?.url() ?? ''; try { owner ||= request.frame()?.url() ?? ''; } catch {} startupRequests.push(owner, { owner, url: request.url() }); });
  const consoleTasks = new Set();
  context.on('console', message => {
    const owner = message.worker()?.url() ?? message.page()?.url() ?? ''; if (!owner.startsWith('chrome-extension://')) return;
    if (evidence.console.length >= 2048 || message.text().length > 16384 || message.args().length > 32 || consoleTasks.size >= 128) { evidence.consoleOverflow = true; return; }
    const task = Promise.all(message.args().map(argument => argument.evaluate(boundedConsoleValue))).then(values => {
      if (values.some(value => value.overflow)) evidence.consoleOverflow = true;
      else evidence.console.push({ owner, text: message.text(), values: values.map(value => value.value) });
    }).catch(() => { evidence.consoleOverflow = true; });
    consoleTasks.add(task); void task.finally(() => consoleTasks.delete(task));
  });
  await context.route('**/*', async route => { const url = new URL(route.request().url()); if (route.request().url() === controlUrl) { await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' }); return; } if (!['http:', 'https:'].includes(url.protocol) || /\.example\.(?:com|net|org|edu)$/.test(url.hostname)) await route.continue(); else { evidence.unexpectedRequests.push(url.origin); await route.abort(); } });
  const cdp = await context.browser().newBrowserCDPSession(); ({ id: extensionId } = await cdp.send('Extensions.loadUnpacked', { path: extension })); startupRequests.setId(extensionId); await cdp.detach(); evidence.browser = context.browser().version();
  const worker = context.serviceWorkers().find(worker => new URL(worker.url()).host === extensionId) ?? await context.waitForEvent('serviceworker');
  const options = await context.newPage(); options.on('pageerror', error => evidence.errors.push(error.message)); await options.goto('chrome-extension://' + extensionId + '/options.html');
  const send = message => options.evaluate(message => chrome.runtime.sendMessage(message), { schemaVersion: 1, ...message });
  await worker.evaluate(() => console.log('production-privacy-observer-ready'));
  await options.evaluate(url => { const image = document.createElement('img'); image.src = url; document.body.append(image); }, controlUrl);
  await poll(() => egressControl, Boolean, 'Attribution observer must see the extension-origin control request');
  evidence.positiveControls.egressObserver = true;
  await send({ type: 'ui-data-consent-set', version: 1, accepted: true }); await send({ type: 'ui-set-scope', scopeMode: 'all-sites' });
  const registered = () => options.evaluate(() => chrome.scripting.getRegisteredContentScripts().then(rows => rows.map(row => row.id)));
  const storageFacts = () => options.evaluate(async () => ({ local: Object.keys(await chrome.storage.local.get(null)).filter(key => /^protect(?:$|[-:])/.test(key)), session: Object.keys(await chrome.storage.session.get(null)).filter(key => /^protect(?:$|[-:])/.test(key)), databases: (await indexedDB.databases()).map(db => db.name).filter(name => /protect/.test(name)), dynamic: (await chrome.declarativeNetRequest.getDynamicRules()).length, rules: (await chrome.declarativeNetRequest.getSessionRules()).length }));
  const tabIdOf = page => options.evaluate(url => chrome.tabs.query({}).then(tabs => tabs.find(tab => tab.url === url)?.id), page.url());
  const moduleWire = async page => options.evaluate(tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => globalThis.__productionPrivacyProbe.snapshot() }).then(rows => rows[0].result), await tabIdOf(page));
  const wireDumps = [];
  const page = await context.newPage(); page.on('pageerror', error => evidence.errors.push(error.message));
  let offFacts;
  async function moduleOff(label) {
    assert.equal((await send({ type: 'ui-protect-get-state' })).state.state, 'off');
    assert.equal((await registered()).some(id => id.startsWith('detector-protect-')), false);
    assert.deepEqual(await storageFacts(), { local: [], session: [], databases: [], dynamic: 0, rules: 0 });
    await page.goto(origin + '/?mode=normal'); await page.waitForFunction(() => window.fixtureReady === true);
    const facts = await page.evaluate(pageFacts);
    assert.equal(facts.gpc, nativeFacts.gpc); assert.deepEqual(facts.markers, []); assert.equal(facts.probe, 'undefined');
    assert.deepEqual(facts.descriptors.find(item => item.key === 'value'), nativeFacts.descriptors.find(item => item.key === 'value'), 'The input getter remains native while the module is off');
    // Production observation already wraps fetch/addEventListener. Preserve that
    // baseline exactly across enable/purge instead of mistaking it for this module.
    if (offFacts) assert.deepEqual(facts, offFacts); else offFacts = facts;
    const tabId = await tabIdOf(page);
    const observed = await poll(() => send({ type: 'ui-get-report', tabId }), response => response.report?.techniques?.some(row => row.techniqueId === 'DET-002' && row.count > 0), label + ': observation must record native canvas readback');
    assert.ok(observed.report.techniques.some(row => row.techniqueId === 'DET-001' && row.count > 0));
    check(label + ': no module registrations/storage/IDB/DNR/markers or altered MAIN input descriptors; observation still records canvas');
  }
  await moduleOff('Module never enabled');
  const enabled = await send({ type: 'ui-protect-enable', consentVersion: 1, features: ['value-match', 'session-replay', 'history'], preset: 'normal' }); assert.equal(enabled.state?.state, 'active');
  await poll(registered, rows => rows.includes('detector-protect-isolated-v1') && rows.includes('detector-protect-main-v1'), 'Both production module worlds must register');
  const snapshots = async target => {
    await target.waitForFunction(() => document.documentElement.hasAttribute('data-privacy-isolated') && document.documentElement.hasAttribute('data-privacy-main'));
    return target.evaluate(() => Object.fromEntries(['isolated', 'main'].map(world => [world, JSON.parse(document.documentElement.getAttribute('data-privacy-' + world))])));
  };
  const typeInto = async (target, locator, value) => { await locator.click(); await (typeof target.page === 'function' ? target.page().keyboard : target.keyboard).type(value, { delay: 1 }); await target.locator('#title').click(); await sleep(750); };
  await page.goto(origin + '/?mode=normal'); await snapshots(page);
  await typeInto(page, page.locator('#email'), canaries.email);
  await typeInto(page, page.locator('#phone'), canaries.phone); await typeInto(page, page.locator('#name'), canaries.name);
  let positive = await snapshots(page); assert.ok((positive.isolated.reads['normal-email']?.value ?? 0) > 0, 'Real trusted e-mail input must exercise the production collector');
  assert.ok(positive.isolated.reads['normal-phone']?.value > 0); assert.ok(positive.isolated.reads['normal-name']?.value > 0);
  evidence.positiveControls.collectorEmail = positive.isolated.reads['normal-email'].value;
  await typeInto(page, page.locator('#password'), canaries.password); await typeInto(page, page.locator('#otp'), canaries.otp); await typeInto(page, page.locator('#notes'), canaries.notes);
  const initial = await snapshots(page); for (const world of ['isolated', 'main']) countersClean(initial[world], 'normal:' + world); evidence.cases.normal = initial;
  const tabId = await tabIdOf(page), port = server.address().port;
  await page.evaluate(async ({ port, email }) => { await fetch('http://normal.example.net:' + port + '/collect', { method: 'POST', body: JSON.stringify({ email }), headers: { 'Content-Type': 'application/json' } }); }, { port, email: canaries.email });
  const report = await poll(() => send({ type: 'ui-protect-get-report', tabId }), response => response.report?.evidence?.some(row => row.protectKind === 'value-match' && row.receiver === 'example.net'), 'Normal body must produce value-match evidence');
  evidence.positiveControls.requestMatch = true;
  await page.evaluate(async ({ port, email }) => {
    await fetch('http://credential.example.org:' + port + '/collect', { method: 'POST', body: JSON.stringify({ password: email, padding: 'x'.repeat(70000) }), headers: { 'Content-Type': 'application/json' } });
    await fetch('http://budget.example.edu:' + port + '/collect', { method: 'POST', body: new URLSearchParams({ note: 'x'.repeat(70000) + ' ' + email }) });
  }, { port, email: canaries.email }); await sleep(800);
  const negative = await send({ type: 'ui-protect-get-report', tabId });
  evidence.negativeBodyCheck = { matchedReceivers: negative.report.evidence.filter(row => row.protectKind === 'value-match').map(row => row.receiver), receivedHosts: received.filter(row => row.method === 'POST').map(row => row.host) };
  assert.equal(negative.report.evidence.some(row => row.protectKind === 'value-match' && ['example.org', 'example.edu'].includes(row.receiver)), false, 'Truncated credential JSON and formData beyond the byte budget must never match');
  assert.ok(received.some(row => row.host === 'credential.example.org')); assert.ok(received.some(row => row.host === 'budget.example.edu'));
  check('Trusted collector and normal request match positive controls; truncated credential JSON and oversized formData suffix produce no value-match');
  await page.evaluate(() => { window.postMessage({ channel: 'detect.expert/protect/v1', type: 'ui-protect-enable', schemaVersion: 1, features: ['value-match'] }, '*'); const field = document.querySelector('#email'); field.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: 'synthetic' })); });
  await sleep(450); assert.equal((await send({ type: 'ui-protect-get-state' })).state.state, 'active');
  const afterAdversarial = await snapshots(page); assert.deepEqual(afterAdversarial.isolated.reads, initial.isolated.reads, 'Synthetic input must not trigger a collector read');
  evidence.cases.adversarial = afterAdversarial;
  // One deliberate page read, after the zero-read assertions, verifies that the
  // MAIN counter attributes a real attached password to its fixture label.
  await page.locator('#positive').click(); const mainControl = await snapshots(page);
  assert.equal(mainControl.main.reads.password?.value, 1); assert.equal(mainControl.isolated.reads.password?.value ?? 0, 0);
  evidence.positiveControls.mainPasswordGetter = 1;
  const normalWire = await moduleWire(page); assert.ok(normalWire.wire.some(message => message.type === 'protect-input' && message.fields.length > 0), 'Wire capture must include actual trusted field fingerprints'); wireDumps.push(normalWire);
  const paymentUrl = 'http://payment.example.org:' + port + '/?mode=payment-light';
  await page.evaluate(url => { const frame = document.createElement('iframe'); frame.id = 'privacy-payment-frame'; frame.src = url; document.body.appendChild(frame); }, paymentUrl);
  const paymentFrame = await poll(() => page.frames().find(frame => frame.url() === paymentUrl), Boolean, 'Cross-site payment frame must load');
  await snapshots(paymentFrame); await typeInto(paymentFrame, paymentFrame.locator('#email'), canaries.email);
  const crossPayment = await snapshots(paymentFrame); for (const world of ['isolated', 'main']) countersClean(crossPayment[world], 'cross-site payment:' + world);
  assert.deepEqual(crossPayment.isolated.reads, {}, 'Cross-site payment document must suspend all collector reads');
  const frameWire = await options.evaluate(({ tabId, url }) => chrome.scripting.executeScript({ target: { tabId, allFrames: true }, world: 'ISOLATED', func: () => ({ url: location.href, snapshot: globalThis.__productionPrivacyProbe?.snapshot() }) }).then(rows => rows.find(row => row.result?.url === url)?.result.snapshot), { tabId, url: paymentUrl });
  assert.ok(frameWire); wireDumps.push(frameWire); evidence.cases.crossSitePayment = crossPayment;
  check('Cross-site payment iframe: independently controlled probes run in both worlds and trusted e-mail input triggers no reader');
  const historyExport = await send({ type: 'ui-protect-history-export', includeSites: true }); assert.equal(historyExport.type, 'protect-history-export');
  const observation = await send({ type: 'ui-get-report', tabId }); assert.equal(observation.type, 'report');
  const observationExport = await send({ type: 'ui-export-preview', tabId, documentKey: observation.report.documentKey, reportRevision: observation.report.reportRevision }); assert.equal(observationExport.type, 'export-preview');
  for (const mode of ['former-light', 'detached-known', 'toggle-task', 'shadow-former', 'closed-shadow', 'payment-light', 'shadow-payment']) {
    await page.goto(origin + '/?mode=' + mode); await snapshots(page); await sleep(100);
    if (['former-light', 'detached-known', 'toggle-task', 'shadow-former', 'closed-shadow'].includes(mode)) await page.locator('#action').click();
    if (mode === 'closed-shadow') { await page.keyboard.type('-typed', { delay: 1 }); await page.locator('#title').click(); await sleep(750); }
    else await typeInto(page, page.locator(['shadow-former', 'shadow-payment'].includes(mode) ? '#shadow #field' : ['former-light', 'detached-known', 'toggle-task'].includes(mode) ? '#field' : '#email'), mode.includes('payment') ? canaries.email : '-typed');
    const current = await snapshots(page); for (const world of ['isolated', 'main']) countersClean(current[world], mode + ':' + world);
    if (mode === 'shadow-payment') { await typeInto(page, page.locator('#email'), canaries.email); const payment = await snapshots(page); assert.deepEqual(payment.isolated.reads, {}, 'Shadow payment control must suspend ordinary light-DOM e-mail too'); }
    evidence.cases[mode] = current;
    wireDumps.push(await moduleWire(page));
  }
  check('Password, OTP, textarea, former password, detached known password, same-task type changes, open/closed shadow and shadow/payment suspension: independent positive controls pass and forbidden reads stay zero in both worlds');
  // PP-01: real trusted input, with independent fixture labels rather than the production classifier's decision.
  for (const row of attributeSafetyCases) {
    await page.goto(origin + '/?mode=' + row.mode); await snapshots(page);
    await typeInto(page, page.locator('#email'), canaries[row.canary]);
    const result = await snapshots(page);
    for (const world of ['isolated', 'main']) countersClean(result[world], row.mode + ':' + world);
    if (row.allowed) {
      assert.ok(result.isolated.reads['normal-email']?.value > 0, 'Harmless long section must keep the real trusted collector positive control');
      evidence.positiveControls.longSectionEmail = result.isolated.reads['normal-email'].value;
    } else assert.deepEqual(result.isolated.reads, {}, row.mode + ': no collector value read may precede marker/limit/payment rejection');
    evidence.cases[row.mode] = result;
    wireDumps.push(await moduleWire(page));
  }
  check('Long password/OTP markers, whitespace prefixes, over-limit attributes and payment markers remain unread under real trusted input in both worlds; harmless long sections still exercise the collector');
  // Scan live production storage, database, UI projection and both bounded wires.
  assert.ok(wireDumps.every(wire => wire.wire.some(message => message.type === 'protect-hello') && !wire.overflow));
  const dumps = await options.evaluate(async () => {
    const out = { local: await chrome.storage.local.get(null), session: await chrome.storage.session.get(null), databases: {} };
    for (const info of await indexedDB.databases()) {
      if (info.name !== 'detect-expert-protect') continue;
      const db = await new Promise((resolve, reject) => { const request = indexedDB.open(info.name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); request.onupgradeneeded = () => request.transaction.abort(); });
      try { for (const name of db.objectStoreNames) out.databases[name] = await new Promise((resolve, reject) => { const request = db.transaction(name).objectStore(name).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); } finally { db.close(); }
    }
    return out;
  });
  await Promise.allSettled([...consoleTasks]);
  for (const [label, value] of Object.entries({ ...dumps, wire: wireDumps.map(wire => wire.wire), channel: wireDumps.map(wire => wire.channel), normalProjection: report.report, negativeProjection: negative.report, historyExport, observationExport, console: evidence.console })) scan(label, value);
  assert.ok(Object.keys(dumps.databases).length > 0, 'Production module database must be inspected');
  evidence.positiveControls.wireMessages = wireDumps.reduce((sum, wire) => sum + wire.wire.length, 0); evidence.positiveControls.databaseStores = Object.keys(dumps.databases).length;
  check('Production storage.local/session, every module IDB store, projections, console and active wire contain no plain/URL/Base64/hash canary variants');
  const excluded = await send({ type: 'ui-protect-set-site', host: 'www.example.com', excluded: true }); assert.ok(excluded.state.excludedSites.includes('example.com'));
  await page.goto(origin + '/?mode=excluded'); await page.waitForFunction(() => window.fixtureReady === true); assert.equal(await page.evaluate(() => typeof window.__productionPrivacyProbe), 'undefined');
  const included = await send({ type: 'ui-protect-set-site', host: 'example.com', excluded: false }); assert.deepEqual(included.state.excludedSites, []);
  const workerCdp = await context.newCDPSession(options); await workerCdp.send('ServiceWorker.enable'); await workerCdp.send('ServiceWorker.stopAllWorkers'); await workerCdp.detach();
  assert.equal((await send({ type: 'ui-protect-get-state' })).state.state, 'active');
  await page.goto(origin + '/?mode=after-worker-restart'); await snapshots(page); await typeInto(page, page.locator('#email'), canaries.email);
  const restarted = await snapshots(page); for (const world of ['isolated', 'main']) countersClean(restarted[world], 'worker-restart:' + world); assert.ok(restarted.isolated.reads['normal-email'].value > 0);
  check('Exact site exclusion stops new page readers, removal restores them, and a real stopped/restarted service worker re-arms trusted collection');
  const off = await send({ type: 'ui-protect-disable', purge: true }); assert.equal(off.state.state, 'off');
  await poll(storageFacts, state => state.local.length === 0 && state.session.length === 0 && state.databases.length === 0, 'Purge must delete all module stores'); await moduleOff('After enable and purge');
  await Promise.allSettled([...consoleTasks]); scan('final console', evidence.console);
  assert.deepEqual(evidence.errors, []); assert.deepEqual(evidence.unexpectedRequests, []); assert.deepEqual(evidence.extensionEgress, []); assert.notEqual(evidence.networkOverflow, true); assert.notEqual(evidence.consoleOverflow, true);
  assert.ok(evidence.console.some(row => row.text === 'production-privacy-observer-ready'), 'Console capture positive control');
  evidence.passed = true; console.log('protect-privacy-native: PASS (' + evidence.checks.length + ' scenarios, ' + evidence.browser + ')');
} catch (error) { evidence.passed = false; evidence.failure = error.stack ?? String(error); process.exitCode = 1; console.error('protect-privacy-native: FAIL ' + error.message); }
finally {
  await plain?.close(); await context?.close(); server.closeAllConnections(); if (server.listening) await new Promise(done => server.close(done));
  writeFileSync(join(run, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n'); writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n'); console.log('Production privacy evidence: ' + output);
}
