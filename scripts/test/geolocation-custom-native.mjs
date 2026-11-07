// Native Chromium proof for Custom geolocation. Owned loopback fixture; the browser's own geolocation emulation supplies the
// "real" position (including altitude, heading and speed), so a leak of any native number is visible.
// The page receives the production init sources exactly as the extension registers them: the generated MAIN profile, the
// inherit script and the opaque guard. node scripts/test/geolocation-custom-native.mjs [--installed-chrome | --firefox] [--output file.json]
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createApiConfiguration, updateApiConfiguration } from '../../packages/contracts/src/api-configuration.mjs';
import { buildApiCustomScripts } from '../../apps/production-extension/api-custom-registration.js';

const root = resolve(import.meta.dirname, '../..'), extension = join(root, 'apps/production-extension');
const installed = process.argv.includes('--installed-chrome'), firefox = process.argv.includes('--firefox');
const outputIndex = process.argv.indexOf('--output'), output = outputIndex < 0 ? null : resolve(process.argv[outputIndex + 1]);
const REAL = { latitude: 51.5074, longitude: -0.1278, accuracy: 4321, altitude: 35.5, altitudeAccuracy: 7.5, heading: 90, speed: 3.25 };
const MOVED = { latitude: -33.8688, longitude: 151.2093, accuracy: 1234, altitude: 12, altitudeAccuracy: 3, heading: 180, speed: 1.5 };
const SELECTED = { latitude: 48.8566, longitude: 2.3522, accuracy: 25 };
const SELECTED_RECORD = { latitude: 48.8566, longitude: 2.3522, altitude: null, accuracy: 25, altitudeAccuracy: null, heading: null, speed: null };
const KEYS = Object.keys(SELECTED_RECORD);

function profile(mutate) {
  let config = { ...createApiConfiguration(), enabled: true, antidetectEnabled: true };
  for (const [id, patch] of mutate) { const result = updateApiConfiguration(config, id, patch, null); assert.equal(result.ok, true, result.error?.message); config = result.value; }
  const [script] = buildApiCustomScripts(config, ['http://*/*']);
  return script?.js[0].code ?? null;
}
const geolocationProfile = profile([['geolocation', { mode: 'custom', selected: { kind: 'value', value: SELECTED } }]]);
const unrelatedProfile = profile([['hardware-concurrency', { mode: 'custom', selected: { kind: 'value', value: 16 } }]]);
// The extension injects the profile through userScripts only into real URLs; blank/srcdoc/data/blob documents get the fallback scripts.
const mainInit = code => `if (!['about:', 'data:', 'blob:'].includes(location.protocol)) (0, eval)(${JSON.stringify(code)});`;
const inheritInit = readFileSync(join(extension, 'api-custom-inherit.main.js'), 'utf8');
const guardInit = readFileSync(join(extension, 'api-custom-opaque.geolocation.js'), 'utf8');
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');

const checks = [], failures = [];
function check(label, condition, detail) {
  if (condition) checks.push(label);
  else { failures.push(label + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail))); console.log('  FAIL ' + label, detail === undefined ? '' : JSON.stringify(detail)); }
}
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

// ---------- page side ----------
// One snapshot of everything the page can read from a successful position.
async function pageProbe(options = { opaque: true }) {
  const KEYS = ['latitude', 'longitude', 'altitude', 'accuracy', 'altitudeAccuracy', 'heading', 'speed'];
  const snapshot = (position, scope = window) => ({
    // Chromium builds a callback argument in the callback's realm, Firefox in the receiver's: accept either owner.
    genuine: (position instanceof window.GeolocationPosition || position instanceof scope.GeolocationPosition) && (position.coords instanceof window.GeolocationCoordinates || position.coords instanceof scope.GeolocationCoordinates) && Object.prototype.toString.call(position) === '[object GeolocationPosition]' && Object.prototype.toString.call(position.coords) === '[object GeolocationCoordinates]',
    sameObject: position.coords === position.coords,
    coords: Object.fromEntries(KEYS.map(key => [key, position.coords[key]])),
    coordsJson: position.coords.toJSON(), positionJson: JSON.parse(JSON.stringify(position)),
    jsonOrder: Object.keys(position.coords.toJSON()), positionJsonKeys: Object.keys(JSON.parse(JSON.stringify(position))),
    timestampFresh: typeof position.timestamp === 'number' && Math.abs(position.timestamp - Date.now()) < 300000
  });
  const request = (geolocation, options) => new Promise(resolve => {
    const timer = setTimeout(() => resolve({ hang: true }), 8000);
    geolocation.getCurrentPosition(position => { clearTimeout(timer); resolve({ ok: true, position }); },
      error => { clearTimeout(timer); resolve({ ok: false, code: error.code, message: error.message, name: error.constructor.name, native: error instanceof GeolocationPositionError }); }, options);
  });
  const age = options.maximumAge ?? 0, first = await request(navigator.geolocation, { maximumAge: age, timeout: 5000 });
  if (!first.ok) return { error: first };
  const facts = { once: snapshot(first.position) };
  window.__first = first.position;
  const frames = {};
  for (const kind of ['blank', 'srcdoc', 'url', 'blob']) {
    const frame = await new Promise(resolve => {
      const element = document.createElement('iframe');
      element.addEventListener('load', () => resolve(element), { once: true });
      if (kind === 'srcdoc') element.srcdoc = '<!doctype html><title>child</title>'; else if (kind === 'url') element.src = location.pathname.replace(/[^/]*$/, '') + 'frame';
      else if (kind === 'blob') element.src = URL.createObjectURL(new Blob(['<!doctype html><title>blob child</title>'], { type: 'text/html' }));
      document.body.append(element);
    });
    const child = frame.contentWindow, own = await request(child.navigator.geolocation, { maximumAge: age, timeout: 5000 });
    const getter = key => child.Object.getOwnPropertyDescriptor(child.GeolocationCoordinates.prototype, key).get;
    frames[kind] = {
      protocol: child.location.protocol,
      own: own.ok ? snapshot(own.position, child) : own,
      // The parent's native position read through the child document's own accessors (a same-origin borrow).
      borrowedLatitude: getter('latitude').call(first.position.coords), borrowedAccuracy: getter('accuracy').call(first.position.coords), borrowedHeading: getter('heading').call(first.position.coords),
      borrowedJson: JSON.parse(JSON.stringify(child.GeolocationCoordinates.prototype.toJSON.call(first.position.coords))),
      // Firefox returns { coords: <live GeolocationCoordinates>, timestamp }: serialize inside the page, never through the driver's privileged cloning.
      borrowedPosition: JSON.parse(JSON.stringify(child.GeolocationPosition.prototype.toJSON.call(first.position))).coords
    };
  }
  facts.frames = frames;
  // Opaque-origin children: the page cannot read the parent's profile there, so the guard must refuse. (Sandboxed srcdoc frames are
  // skipped: Playwright does not inject init scripts into them, while the extension reaches them with matchOriginAsFallback.)
  const childScript = '<!doctype html><script>const send = value => parent.postMessage(value, "*"); const info = { protocol: location.protocol, origin: String(origin), secure: isSecureContext }; try { navigator.geolocation.getCurrentPosition(' +
    'p => send({ ...info, kind: "success", latitude: p.coords.latitude, accuracy: p.coords.accuracy }), e => send({ ...info, kind: "error", code: e.code, message: e.message }), { timeout: 3000, maximumAge: 0 }); } ' +
    'catch (error) { send({ ...info, kind: "throw", name: error.name, message: error.message }); }<\/script>';
  facts.opaque = {};
  for (const kind of options.opaque ? ['data', 'sandbox-blob'] : []) {
    facts.opaque[kind] = await new Promise(resolve => {
      const timer = setTimeout(() => resolve({ kind: 'hang' }), 8000);
      addEventListener('message', event => { clearTimeout(timer); resolve(event.data); }, { once: true });
      const frame = document.createElement('iframe');
      if (kind === 'sandbox-blob') frame.setAttribute('sandbox', 'allow-scripts');
      frame.src = kind === 'data' ? 'data:text/html;charset=utf-8,' + encodeURIComponent(childScript) : URL.createObjectURL(new Blob([childScript], { type: 'text/html' }));
      document.body.append(frame);
    });
  }
  facts.worker = await new Promise(resolve => {
    const worker = new Worker(URL.createObjectURL(new Blob(['postMessage({ geolocation: "geolocation" in navigator, coordinates: typeof GeolocationCoordinates })'])));
    worker.onmessage = event => resolve(event.data);
    setTimeout(() => resolve({ hang: true }), 4000);
  });
  facts.surface = {
    permission: (await navigator.permissions.query({ name: 'geolocation' })).state,
    requestIsNative: Function.prototype.toString.call(Geolocation.prototype.getCurrentPosition).includes('[native code]') && Function.prototype.toString.call(Geolocation.prototype.watchPosition).includes('[native code]') && Function.prototype.toString.call(Geolocation.prototype.clearWatch).includes('[native code]'),
    geolocationIdentity: navigator.geolocation === navigator.geolocation,
    coordinatesKeys: Object.getOwnPropertyNames(GeolocationCoordinates.prototype), positionKeys: Object.getOwnPropertyNames(GeolocationPosition.prototype),
    latitudeGetterIsNative: Function.prototype.toString.call(Object.getOwnPropertyDescriptor(GeolocationCoordinates.prototype, 'latitude').get).includes('[native code]'),
    flags: ['latitude', 'toJSON'].map(key => { const d = Object.getOwnPropertyDescriptor(GeolocationCoordinates.prototype, key); return [key, !!d.get, !!d.set, d.enumerable, d.configurable, d.writable ?? null]; }),
    invalidCallback: (() => { try { navigator.geolocation.getCurrentPosition('not a function'); return 'no error'; } catch (error) { return error.name + ':' + error.message; } })(),
    missingArguments: (() => { try { navigator.geolocation.getCurrentPosition(); return 'no error'; } catch (error) { return error.name + ':' + error.message; } })(),
    foreign: (() => { try { return Object.getOwnPropertyDescriptor(GeolocationCoordinates.prototype, 'latitude').get.call({}); } catch (error) { return error.name + ':' + error.message; } })()
  };
  return facts;
}
function startWatch() {
  window.__updates = [];
  window.__watchId = navigator.geolocation.watchPosition(position => window.__updates.push({ timestamp: position.timestamp, latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy, heading: position.coords.heading, json: position.coords.toJSON(), position: JSON.parse(JSON.stringify(position)).coords }),
    error => window.__updates.push({ error: error.code }), { maximumAge: 0 });
  return window.__watchId;
}
const readUpdates = () => ({ updates: window.__updates, id: window.__watchId });
const stopWatch = () => { navigator.geolocation.clearWatch(window.__watchId); return window.__updates.length; };
const errorOnce = options => new Promise(resolve => {
  const timer = setTimeout(() => resolve({ hang: true }), 8000);
  navigator.geolocation.getCurrentPosition(() => { clearTimeout(timer); resolve({ unexpectedSuccess: true }); },
    error => { clearTimeout(timer); resolve({ code: error.code, message: error.message, name: error.constructor.name, native: error instanceof GeolocationPositionError, constants: [error.PERMISSION_DENIED, error.POSITION_UNAVAILABLE, error.TIMEOUT] }); }, options);
});

// ---------- node side ----------
const pause = ms => new Promise(done => setTimeout(done, ms));
async function until(probe, label, timeout = 10000) { const end = Date.now() + timeout; while (Date.now() < end) { const value = await probe(); if (value) return value; await pause(50); } throw Error('timeout: ' + label); }

async function mainChromium() {
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(request.url.startsWith('/frame') ? '<!doctype html><title>same-origin child</title><body>child' : '<!doctype html><title>geolocation fixture</title><body>fixture');
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch({ channel: installed ? 'chrome' : 'chromium', headless: true });
  const evidence = { at: new Date().toISOString(), browser: browser.version(), channel: installed ? 'chrome' : 'chromium', scope: 'owned loopback page; native geolocation emulation; production init sources',
    hashes: Object.fromEntries(['api-custom-geolocation-runtime.js', 'api-custom-registration.js', 'api-custom-opaque.geolocation.js', 'api-custom-inherit.main.js'].map(file => [file, sha(join(extension, file))])), result: 'RUNNING' };
  const contexts = [];
  async function open({ custom = null, permission = true, position = REAL } = {}) {
    const context = await browser.newContext({ permissions: permission ? ['geolocation'] : [] });
    contexts.push(context);
    if (custom) for (const content of [mainInit(custom), inheritInit, guardInit]) await context.addInitScript({ content });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setGeolocationOverride', position);
    await page.goto(origin);
    return { context, page, cdp };
  }
  try {
    // 1. Successful positions: control (native), selected profile, and an unrelated Custom row that must leave geolocation native.
    const control = await open(), selected = await open({ custom: geolocationProfile }), unrelated = await open({ custom: unrelatedProfile });
    const nativeFacts = await control.page.evaluate(pageProbe), customFacts = await selected.page.evaluate(pageProbe), unrelatedFacts = await unrelated.page.evaluate(pageProbe);
    check('control: the browser reports the real emulated position, including altitude, heading and speed', same(nativeFacts.once.coords, { latitude: REAL.latitude, longitude: REAL.longitude, altitude: REAL.altitude, accuracy: REAL.accuracy, altitudeAccuracy: REAL.altitudeAccuracy, heading: REAL.heading, speed: REAL.speed }), nativeFacts.once.coords);
    check('unrelated Custom row leaves geolocation native', same(unrelatedFacts.once.coords, nativeFacts.once.coords), unrelatedFacts.once.coords);
    check('Custom: getCurrentPosition shows exactly the selected coordinates and null optional fields', same(customFacts.once.coords, SELECTED_RECORD), customFacts.once.coords);
    check('Custom: the object is the genuine GeolocationPosition / GeolocationCoordinates with a stable coords identity', customFacts.once.genuine && customFacts.once.sameObject && customFacts.once.timestampFresh, customFacts.once);
    check('Custom: toJSON and JSON.stringify carry the selected numbers in the native key order', same(customFacts.once.coordsJson, { accuracy: 25, latitude: 48.8566, longitude: 2.3522, altitude: null, altitudeAccuracy: null, heading: null, speed: null }) &&
      same(customFacts.once.jsonOrder, nativeFacts.once.jsonOrder) && same(customFacts.once.positionJsonKeys, nativeFacts.once.positionJsonKeys) && same(customFacts.once.positionJson.coords, customFacts.once.coordsJson), { custom: customFacts.once.coordsJson, order: [customFacts.once.jsonOrder, nativeFacts.once.jsonOrder] });
    check('Custom: no native number appears anywhere in the serialized position', !JSON.stringify(customFacts.once).match(/4321|51\.5074|-0\.1278|35\.5|7\.5|\b90\b|3\.25/), customFacts.once);
    check('Custom: request methods stay native code; permission, secure-context surface and error messages are native', customFacts.surface.requestIsNative && customFacts.surface.geolocationIdentity && customFacts.surface.permission === nativeFacts.surface.permission &&
      customFacts.surface.invalidCallback === nativeFacts.surface.invalidCallback && customFacts.surface.missingArguments === nativeFacts.surface.missingArguments && customFacts.surface.foreign === nativeFacts.surface.foreign, { custom: customFacts.surface, native: nativeFacts.surface });
    check('the engine exposes exactly the attributes the installer knows (a new attribute would escape Custom)', same([...customFacts.surface.coordinatesKeys].sort(), [...nativeFacts.surface.coordinatesKeys].sort()) &&
      customFacts.surface.coordinatesKeys.every(key => [...KEYS, 'toJSON', 'constructor'].includes(key)) && customFacts.surface.positionKeys.every(key => ['coords', 'timestamp', 'toJSON', 'constructor'].includes(key)), customFacts.surface);
    check('descriptor shape: accessors stay enumerable and configurable without a setter; toJSON keeps its native flags', same(customFacts.surface.flags, nativeFacts.surface.flags), { custom: customFacts.surface.flags, native: nativeFacts.surface.flags });
    check('the replaced getter is not disguised as native code (documented detectability)', nativeFacts.surface.latitudeGetterIsNative === true && customFacts.surface.latitudeGetterIsNative === false);
    check('workers have no navigator.geolocation, with or without Custom', same(customFacts.worker, nativeFacts.worker) && customFacts.worker.geolocation === false, customFacts.worker);

    // 2. Child documents: about:blank, srcdoc and a real same-origin URL all report the selected position, also through borrowed getters.
    for (const kind of ['blank', 'srcdoc', 'url', 'blob']) {
      const custom = customFacts.frames[kind], native = nativeFacts.frames[kind];
      check(`${kind} iframe: its own request shows the selected position`, same(custom.own.coords, SELECTED_RECORD) && custom.own.genuine, custom.own);
      check(`${kind} iframe: the parent's native position read through the child getters stays selected (no registry leak)`, custom.borrowedLatitude === SELECTED.latitude && custom.borrowedAccuracy === SELECTED.accuracy && custom.borrowedHeading === null &&
        same(custom.borrowedJson, customFacts.once.coordsJson) && same(custom.borrowedPosition, customFacts.once.coordsJson), custom);
      check(`${kind} iframe: control shows native values through the same paths`, native.borrowedLatitude === REAL.latitude && native.borrowedHeading === REAL.heading && same(native.own.coords, nativeFacts.once.coords), native);
    }
    // 3. Opaque (sandboxed) child: refused before the native request; the control proves the request would otherwise succeed or fail natively.
    for (const kind of ['data', 'sandbox-blob']) {
      const custom = customFacts.opaque[kind], native = nativeFacts.opaque[kind];
      check(`opaque ${kind} child (origin ${custom.origin}): the guard refuses the request with a SecurityError before the native method runs`, custom.kind === 'throw' && custom.name === 'SecurityError' && custom.message === 'Geolocation profile unavailable in this frame' && custom.origin === 'null', custom);
      check(`opaque ${kind} child: the control child reaches the native request (success or a native error callback, never a throw)`, ['success', 'error'].includes(native.kind), native);
    }
    evidence.opaque = { custom: customFacts.opaque, control: nativeFacts.opaque };

    // 4. watchPosition: the initial fix and a later real move both show the selected position; the native watch id and clearWatch are untouched.
    //    A native POSITION_UNAVAILABLE entry between two fixes (Chromium reports one while the emulated position is replaced) must pass through.
    const fixes = updates => updates.filter(update => update.latitude !== undefined), errorEntries = updates => updates.filter(update => update.error !== undefined);
    for (const [label, handle] of [['control', control], ['custom', selected]]) {
      const id = await handle.page.evaluate(startWatch);
      await until(async () => fixes((await handle.page.evaluate(readUpdates)).updates).length >= 1, label + ' first watch fix');
      await handle.cdp.send('Emulation.setGeolocationOverride', MOVED);
      await until(async () => fixes((await handle.page.evaluate(readUpdates)).updates).length >= 2, label + ' watch fix after the move');
      const { updates } = await handle.page.evaluate(readUpdates), list = fixes(updates);
      if (label === 'control') check('control watch: the real position moved natively', list.some(update => update.latitude === MOVED.latitude && update.heading === MOVED.heading) && typeof id === 'number', updates);
      else check('Custom watch: every fix, before and after the real move, shows the selected position; the id is the native integer', typeof id === 'number' && list.length >= 2 && list.at(-1).timestamp > list[0].timestamp &&
        list.every(update => update.latitude === SELECTED.latitude && update.longitude === SELECTED.longitude && update.accuracy === SELECTED.accuracy && update.heading === null && same(update.json, update.position) && update.json.latitude === SELECTED.latitude), updates);
      check(label + ' watch: any error entry is a native code (1-3), delivered untouched', errorEntries(updates).every(update => [1, 2, 3].includes(update.error)), updates);
      evidence['watch' + label] = { fixes: list.length, errors: errorEntries(updates).map(update => update.error) };
      const count = await handle.page.evaluate(stopWatch);
      await handle.cdp.send('Emulation.setGeolocationOverride', REAL);
      await pause(400);
      check(label + ' watch: clearWatch stops further updates', (await handle.page.evaluate(readUpdates)).updates.length === count);
    }

    // 5. Errors stay native: denial, timeout and position-unavailable are identical with and without Custom.
    const errors = {};
    for (const [name, options] of [['denied', { permission: false }], ['timeout', { position: null }], ['unavailable', { position: {} }]]) {
      const pair = [];
      for (const custom of [null, geolocationProfile]) {
        const handle = await open({ custom, permission: options.permission ?? true, position: options.position === undefined ? REAL : options.position ?? {} });
        if (name === 'timeout') await handle.cdp.send('Emulation.clearGeolocationOverride');
        pair.push(await handle.page.evaluate(errorOnce, name === 'timeout' ? { timeout: 600, maximumAge: 0 } : { timeout: 3000, maximumAge: 0 }));
      }
      errors[name] = pair;
      check(`${name}: the error is the native GeolocationPositionError with the same code and message under Custom`, same(pair[0], pair[1]) && pair[1].native === true && !pair[1].unexpectedSuccess && !pair[1].hang, pair);
    }
    check('denied is PERMISSION_DENIED (1), timeout TIMEOUT (3)', errors.denied[1].code === 1 && errors.timeout[1].code === 3, errors);
    evidence.errors = errors;

    evidence.frames = Object.fromEntries(Object.entries(customFacts.frames).map(([kind, value]) => [kind, value.protocol]));
    evidence.checks = checks.length;
    evidence.failures = failures;
    evidence.result = failures.length ? 'FAIL' : 'PASS';
    assert.equal(failures.length, 0, failures.join('\n'));
  } catch (error) {
    evidence.result = 'FAIL'; evidence.error = error.message; throw error;
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
    await browser.close();
    server.closeAllConnections?.(); await new Promise(done => server.close(done));
    if (output) { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n'); }
    console.log(JSON.stringify({ result: evidence.result, browser: evidence.browser, checks: checks.length, failures: failures.length, output }));
  }
}

// ---------- Firefox (geckodriver) ----------
// Firefox has no addInitScript, so the production sources are the first inline script of each fixture page, exactly where a
// document_start MAIN script would run. Child documents get the profile through the document runtime's own inheritance.
// Geolocation comes from Firefox's own testing provider (a data: URL answer) and its prompt-testing prefs, with the real network off.
const FIREFOX_REAL = { latitude: 40.7128, longitude: -74.006, accuracy: 4321 };
const canon = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left < right ? -1 : 1)) : item);
const sameLoose = (left, right) => canon(left) === canon(right);

async function mainFirefox() {
  const { spawn, spawnSync } = await import('node:child_process');
  const { createWriteStream, mkdtempSync, rmSync } = await import('node:fs');
  const driverPath = process.env.GECKODRIVER_BINARY ?? join(root, '.tmp/firefox/tools/geckodriver.exe');
  let binary = process.env.FIREFOX_BINARY;
  if (!binary && process.platform === 'win32') binary = spawnSync('powershell.exe', ['-NoProfile', '-Command', "(Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\firefox.exe').'(default)'"], { encoding: 'utf8', windowsHide: true }).stdout.trim();
  assert.ok(binary, 'Installed Firefox binary is required (FIREFOX_BINARY)');
  const held = new Set();
  const server = createServer((request, response) => {
    if (request.url.startsWith('/never')) { held.add(response); request.on('close', () => held.delete(response)); return; }
    const custom = request.url.startsWith('/custom/'), frame = request.url.endsWith('/frame');
    const inline = custom ? `<script>(0, eval)(${JSON.stringify(geolocationProfile)});</script>` : '';
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<!doctype html><html><head>${inline}<title>${frame ? 'child' : 'fixture'}</title></head><body>${frame ? 'child' : 'fixture'}</body></html>`);
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const base = 'http://127.0.0.1:' + server.address().port;
  const work = mkdtempSync(join(root, '.tmp/geolocation-firefox-'));
  const evidence = { at: new Date().toISOString(), channel: 'installed-firefox', scope: 'owned loopback page; Firefox testing geolocation provider; production sources inlined first in the page',
    hashes: Object.fromEntries(['api-custom-geolocation-runtime.js', 'api-custom-registration.js'].map(file => [file, sha(join(extension, file))])), result: 'RUNNING' };
  const sessions = [];
  async function session(label, { allow = true, url = 'data:application/json,{"location": {"lat": ' + FIREFOX_REAL.latitude + ', "lng": ' + FIREFOX_REAL.longitude + '}, "accuracy": ' + FIREFOX_REAL.accuracy + '.0}' } = {}) {
    const profile = join(work, label + '-profile'); mkdirSync(profile, { recursive: true });
    const prefs = { 'browser.shell.checkDefaultBrowser': false, 'browser.startup.page': 0, 'browser.startup.homepage_override.mstone': 'ignore', 'datareporting.policy.dataSubmissionEnabled': false,
      'geo.enabled': true, 'geo.provider.testing': true, 'geo.prompt.testing': true, 'geo.prompt.testing.allow': allow, 'geo.provider.network.url': url,
      'geo.provider.use_corelocation': false, 'geo.provider.use_geoclue': false, 'geo.provider.use_gpsd': false, 'geo.provider.ms-windows-location': false };
    writeFileSync(join(profile, 'user.js'), Object.entries(prefs).map(([key, value]) => 'user_pref(' + JSON.stringify(key) + ',' + JSON.stringify(value) + ');').join('\n'));
    const portServer = createServer(); await new Promise(done => portServer.listen(0, '127.0.0.1', done)); const port = portServer.address().port; await new Promise(done => portServer.close(done));
    const endpoint = 'http://127.0.0.1:' + port, log = createWriteStream(join(work, label + '-geckodriver.log'));
    const child = spawn(driverPath, ['--host', '127.0.0.1', '--port', String(port), '--profile-root', work, '--log', 'error'], { cwd: root, windowsHide: true }); child.stdout.pipe(log); child.stderr.pipe(log);
    async function command(path, body, method = 'POST') {
      const response = await fetch(endpoint + path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }), signal: AbortSignal.timeout(90000) });
      const value = (await response.json()).value;
      if (!response.ok) throw Error(JSON.stringify(value));
      return value;
    }
    await until(async () => { try { await command('/status', undefined, 'GET'); return true; } catch { return false; } }, 'geckodriver');
    const created = await command('/session', { capabilities: { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': { binary, args: ['-headless', '-no-remote', '-profile', profile] } } } });
    const id = created.sessionId, wd = (path, body, method) => command('/session/' + id + path, body, method);
    await wd('/timeouts', { script: 90000 });
    const handle = { version: created.capabilities.browserVersion, goto: path => wd('/url', { url: base + path }),
      evaluate: async (fn, argument) => {
        const result = await wd('/execute/async', { script: 'const done=arguments[arguments.length-1];Promise.resolve((' + fn.toString() + ')(arguments[0])).then(value=>done({ok:true,value:value===undefined?null:value}),error=>done({ok:false,error:String(error&&error.message||error)}));', args: [argument ?? null] });
        if (!result.ok) throw Error('page script failed: ' + result.error);
        return result.value;
      },
      close: async () => { try { await command('/session/' + id, undefined, 'DELETE'); } finally { child.kill(); log.end(); } } };
    sessions.push(handle);
    return handle;
  }
  try {
    // 1. Successful positions: native control page and the selected profile page in the same browser.
    const granted = await session('granted');
    evidence.browser = granted.version;
    await granted.goto('/control/'); const nativeFacts = await granted.evaluate(pageProbe, { opaque: false, maximumAge: 600000 });
    await granted.goto('/custom/'); const customFacts = await granted.evaluate(pageProbe, { opaque: false, maximumAge: 600000 });
    check('control: Firefox reports the testing-provider position', sameLoose({ latitude: nativeFacts.once.coords.latitude, longitude: nativeFacts.once.coords.longitude, accuracy: nativeFacts.once.coords.accuracy }, FIREFOX_REAL), nativeFacts.once.coords);
    check('Custom: getCurrentPosition shows exactly the selected coordinates and null optional fields', sameLoose(customFacts.once.coords, SELECTED_RECORD), customFacts.once.coords);
    check('Custom: genuine GeolocationPosition / GeolocationCoordinates with a stable coords identity', customFacts.once.genuine && customFacts.once.sameObject && customFacts.once.timestampFresh, customFacts.once);
    check('Custom: toJSON and JSON.stringify carry the selected numbers in the native key order', sameLoose(customFacts.once.coordsJson, SELECTED_RECORD) && sameLoose(customFacts.once.positionJson.coords, SELECTED_RECORD) &&
      same(customFacts.once.jsonOrder, nativeFacts.once.jsonOrder) && same(customFacts.once.positionJsonKeys, nativeFacts.once.positionJsonKeys), { custom: customFacts.once.jsonOrder, native: nativeFacts.once.jsonOrder });
    check('Custom: no native number appears anywhere in the serialized position', !JSON.stringify(customFacts.once).match(/4321|40\.7128|-74\.006/), customFacts.once);
    check('Custom: request methods stay native code; permission, error messages and the interface key set are native', customFacts.surface.requestIsNative && customFacts.surface.geolocationIdentity && customFacts.surface.permission === nativeFacts.surface.permission &&
      customFacts.surface.invalidCallback === nativeFacts.surface.invalidCallback && customFacts.surface.missingArguments === nativeFacts.surface.missingArguments && customFacts.surface.foreign === nativeFacts.surface.foreign &&
      same(customFacts.surface.coordinatesKeys, nativeFacts.surface.coordinatesKeys) && same(customFacts.surface.positionKeys, nativeFacts.surface.positionKeys), { custom: customFacts.surface, native: nativeFacts.surface });
    check('the engine exposes exactly the attributes the installer knows (a new attribute would escape Custom)', customFacts.surface.coordinatesKeys.every(key => [...KEYS, 'toJSON', 'constructor'].includes(key)) && customFacts.surface.positionKeys.every(key => ['coords', 'timestamp', 'toJSON', 'constructor'].includes(key)), customFacts.surface);
    check('descriptor shape: accessors stay enumerable and configurable without a setter; toJSON keeps its native flags', same(customFacts.surface.flags, nativeFacts.surface.flags), { custom: customFacts.surface.flags, native: nativeFacts.surface.flags });
    check('the replaced getter is not disguised as native code (documented detectability)', nativeFacts.surface.latitudeGetterIsNative === true && customFacts.surface.latitudeGetterIsNative === false);
    check('workers have no navigator.geolocation, with or without Custom', same(customFacts.worker, nativeFacts.worker) && customFacts.worker.geolocation === false, customFacts.worker);
    for (const kind of ['blank', 'srcdoc', 'url', 'blob']) {
      const custom = customFacts.frames[kind], native = nativeFacts.frames[kind];
      check(`${kind} iframe: its own request shows the selected position`, sameLoose(custom.own.coords, SELECTED_RECORD) && custom.own.genuine, custom.own);
      check(`${kind} iframe: the parent's native position read through the child getters stays selected`, custom.borrowedLatitude === SELECTED.latitude && custom.borrowedAccuracy === SELECTED.accuracy && custom.borrowedHeading === null &&
        sameLoose(custom.borrowedJson, customFacts.once.coordsJson) && sameLoose(custom.borrowedPosition, customFacts.once.coordsJson), custom);
      check(`${kind} iframe: control shows native values through the same paths`, native.borrowedLatitude === FIREFOX_REAL.latitude && sameLoose(native.own.coords, nativeFacts.once.coords), native);
    }
    // 2. watchPosition: the first fix is selected, the id is the native integer, clearWatch works.
    for (const [label, path] of [['control', '/control/'], ['custom', '/custom/']]) {
      await granted.goto(path);
      const id = await granted.evaluate(startWatch);
      await until(async () => (await granted.evaluate(readUpdates)).updates.some(update => update.latitude !== undefined), label + ' firefox watch fix');
      const { updates } = await granted.evaluate(readUpdates), fix = updates.find(update => update.latitude !== undefined);
      check(label === 'control' ? 'control watch: the testing provider fix is native' : 'Custom watch: the fix shows the selected position and the id is the native integer',
        label === 'control' ? fix.latitude === FIREFOX_REAL.latitude && typeof id === 'number' : typeof id === 'number' && fix.latitude === SELECTED.latitude && fix.longitude === SELECTED.longitude && fix.accuracy === SELECTED.accuracy && fix.heading === null && sameLoose(fix.json, fix.position), updates);
      const count = await granted.evaluate(stopWatch); await pause(500);
      check(label + ' watch: clearWatch stops further updates', (await granted.evaluate(readUpdates)).updates.length === count);
    }
    // 3. Errors stay native: denial and timeout are identical with and without Custom.
    const errors = {};
    const denied = await session('denied', { allow: false }), stalled = await session('stalled', { url: base + '/never' });
    for (const [name, handle, options] of [['denied', denied, { timeout: 4000, maximumAge: 0 }], ['timeout', stalled, { timeout: 700, maximumAge: 0 }]]) {
      const pair = [];
      for (const path of ['/control/', '/custom/']) { await handle.goto(path); pair.push(await handle.evaluate(errorOnce, options)); }
      errors[name] = pair;
      check(`${name}: the error is the native GeolocationPositionError with the same code and message under Custom`, same(pair[0], pair[1]) && pair[1].native === true && !pair[1].unexpectedSuccess && !pair[1].hang, pair);
    }
    check('denied is PERMISSION_DENIED (1), timeout TIMEOUT (3)', errors.denied[1].code === 1 && errors.timeout[1].code === 3, errors);
    evidence.errors = errors;
    evidence.checks = checks.length; evidence.failures = failures; evidence.result = failures.length ? 'FAIL' : 'PASS';
    assert.equal(failures.length, 0, failures.join('\n'));
  } catch (error) {
    evidence.result = 'FAIL'; evidence.error = error.message; throw error;
  } finally {
    for (const handle of sessions) await handle.close().catch(() => {});
    for (const response of held) response.destroy();
    server.closeAllConnections?.(); await new Promise(done => server.close(done));
    rmSync(work, { recursive: true, force: true });
    if (output) { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n'); }
    console.log(JSON.stringify({ result: evidence.result, browser: evidence.browser, checks: checks.length, failures: failures.length, output }));
  }
}

await (firefox ? mainFirefox() : mainChromium());
