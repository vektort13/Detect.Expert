// E22-08: real installed Firefox privacy get/set/clear and typed WebRTC UI in an isolated addon/profile.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { cpSync, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { networkInterfaces } from 'node:os';
import { archiveProduction, FIREFOX_ID } from '../build-production.mjs';
import { createIceFixture } from './webrtc-ice-fixture.mjs';
import { webRtcNativeProbe } from './webrtc-native-probe.mjs';
import { importApiConfiguration } from '../../packages/contracts/src/api-configuration.mjs';

const root = resolve(import.meta.dirname, '../..'), run = join(root, '.tmp/firefox/runs', Date.now() + '-webrtc-ui'), profile = join(run, 'profile'), extension = join(run, 'extension');
mkdirSync(profile, { recursive: true }); cpSync(join(root, 'dist/firefox'), extension, { recursive: true });
const artifact = join(root, 'test-results/production-1.1.0/webrtc-ui'); mkdirSync(artifact, { recursive: true });
const driverPath = process.env.GECKODRIVER_BINARY ?? join(root, '.tmp/firefox/tools/geckodriver.exe'); assert.ok(existsSync(driverPath));
let binary = process.env.FIREFOX_BINARY;
if (!binary && process.platform === 'win32') binary = spawnSync('powershell.exe', ['-NoProfile', '-Command', "(Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\firefox.exe').'(default)'"], { encoding: 'utf8', windowsHide: true }).stdout.trim();
assert.ok(binary, 'Existing installed Firefox is required; this test downloads no tools');
const uuid = randomUUID(), manifestPath = join(extension, 'manifest.json'), manifest = JSON.parse(readFileSync(manifestPath)); assert.ok(manifest.optional_permissions.includes('privacy')); assert.ok(!manifest.permissions.includes('privacy'));
manifest.optional_permissions = manifest.optional_permissions.filter(permission => permission !== 'privacy'); manifest.permissions.push('privacy'); writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
const prefs = { 'extensions.webextensions.uuids': JSON.stringify({ [FIREFOX_ID]: uuid }), 'browser.shell.checkDefaultBrowser': false, 'browser.startup.homepage_override.mstone': 'ignore', 'browser.startup.page': 0, 'browser.newtabpage.enabled': false, 'datareporting.policy.dataSubmissionEnabled': false, 'toolkit.telemetry.enabled': false, 'app.update.auto': false, 'network.proxy.type': 0, 'extensions.webextOptionalPermissionPrompts': false,
  'media.navigator.streams.fake': true, 'media.navigator.permission.disabled': true, 'media.peerconnection.ice.loopback': true };
writeFileSync(join(profile, 'user.js'), Object.entries(prefs).map(([key, value]) => 'user_pref(' + JSON.stringify(key) + ', ' + JSON.stringify(value) + ');').join('\n'));
const evidence = { at: new Date().toISOString(), run, result: 'RUNNING', checks: [], policies: [], fixturePermissions: { productionPrivacy: 'optional', testCopyPrivacy: 'required', userScripts: 'still optional-only' }, hashes: Object.fromEntries(['api-configuration-ui.js', 'webrtc-configuration-ui.js', 'webrtc-configuration-ui.css', 'api-configuration-controller.js', 'webrtc-network-controller.js', 'api-custom-runtime.js', 'api-custom-webrtc-runtime.js', 'api-custom.main.js'].map(file => [file, createHash('sha256').update(readFileSync(join(extension, file))).digest('hex')])) };
const log = createWriteStream(join(run, 'geckodriver.log')), pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let endpoint, session, driver, driverError, ice, http, origin, phase = 'startup';
async function command(path, body, method = 'POST') { const response = await fetch(endpoint + path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }), signal: AbortSignal.timeout(30000) }); const value = (await response.json()).value; if (!response.ok || value?.error) throw Error(JSON.stringify(value)); return value; }
const wd = (path, body, method) => command('/session/' + session + path, body, method), script = (script, args = []) => wd('/execute/sync', { script, args }), asyncScript = (script, args = []) => wd('/execute/async', { script, args });
const send = message => asyncScript('const done=arguments[arguments.length-1];browser.runtime.sendMessage(arguments[0]).then(done,e=>done({error:String(e)}));', [{ schemaVersion: 1, ...message }]);
const state = () => send({ type: 'ui-api-config-get', tabId: null });
async function until(source, args = [], attempts = 100) { for (let n = 0; n < attempts; n++) { if (await script(source, args)) return; await pause(60); } throw Error('Firefox condition timed out: ' + source); }
const ready = () => until('return document.querySelector("[data-api-configuration-editor]")?.getAttribute("aria-busy")==="false"&&Boolean(document.querySelector("[data-webrtc-row-configure]"))&&Boolean(document.querySelector("[data-protection-feature=webrtc]"));');
// ADR-064/104: the browser-wide policy lives in the Antidetect network section; its master is an immediate write of its own.
const antidetectReady = () => until('return document.querySelector("[data-antidetect-app]")?.getAttribute("aria-busy")==="false"&&Boolean(document.querySelector("[data-antidetect-master]"))&&Boolean(document.querySelector("[data-antidetect-network-policy]"))&&document.querySelector("[data-antidetect-dirty]")?.dataset.antidetectDirty!=="true";');
async function revisionAfter(before) { let after; for (let n = 0; n < 100; n++) { after = await state(); if (after.revision > before.revision) return after; await pause(60); } return after; }
async function antidetectMaster(enabled) {
  const before = await state(); await click('[data-antidetect-master]'); const after = await revisionAfter(before);
  assert.ok(after.revision > before.revision); assert.equal(after.configuration.antidetectEnabled, enabled); assert.equal(after.configuration.enabled, false);
  await antidetectReady(); assert.equal(await script('return document.querySelector("[data-antidetect-master]").getAttribute("aria-checked");'), String(enabled)); return after;
}
const element = selector => wd('/element', { using: 'css selector', value: selector });
async function click(selector) { await script('const e=document.querySelector(arguments[0]);if(e&&e.tagName!=="OPTION")e.scrollIntoView({block:"center",inline:"nearest"});', [selector]); const result = await element(selector); await wd('/element/' + result['element-6066-11e4-a52e-4f735466cecf'] + '/click', {}); }
async function type(selector, value) { const result = await element(selector), id = result['element-6066-11e4-a52e-4f735466cecf']; await wd('/element/' + id + '/clear', {}); await wd('/element/' + id + '/value', { text: value }); }
const nativePolicy = () => asyncScript('const done=arguments[arguments.length-1];browser.privacy.network.webRTCIPHandlingPolicy.get({}).then(done,e=>done({error:String(e)}));');
const check = text => { evidence.checks.push(text); console.log('  ok ' + text); };
// This function is serialized into the owned HTML and runs in actual page MAIN, never WebDriver's sandbox.
async function rtcPageBaseline({ port, devices, iceHost = '127.0.0.1', addresses = null }) {
  const brief = (target, keys) => Object.fromEntries(keys.map(key => { const d = Object.getOwnPropertyDescriptor(target, key); return [key, d ? { slot: Object.hasOwn(d, 'value') ? 'value' : 'get', configurable: d.configurable, writable: d.writable ?? null } : null]; }));
  const candidate = new RTCIceCandidate({ candidate: 'candidate:1 1 UDP 2122260223 198.18.0.99 5000 typ srflx', sdpMid: '0' }), description = new RTCSessionDescription({ type: 'offer', sdp: 'v=0\r\n' });
  let deviceIds = [];
  if (devices) { const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true }); try { deviceIds = (await navigator.mediaDevices.enumerateDevices()).map(device => device.deviceId); } finally { for (const track of stream.getTracks()) track.stop(); } }
  const descriptors = { candidatePrototype: brief(RTCIceCandidate.prototype, ['candidate', 'address', 'relatedAddress', 'type', 'toJSON']), candidateOwn: brief(candidate, Object.keys(candidate)), descriptionPrototype: brief(RTCSessionDescription.prototype, ['sdp', 'toJSON']), descriptionOwn: brief(description, Object.keys(description)), webkitAlias: globalThis.webkitRTCPeerConnection === RTCPeerConnection, mozAlias: globalThis.mozRTCPeerConnection === RTCPeerConnection };
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:' + iceHost + ':' + port }], iceTransportPolicy: 'all' }), types = [], errors = []; pc.createDataChannel('owned-diagnostic'); let timer;
  try {
    const ready = new Promise(resolve => { timer = setTimeout(resolve, 7500); pc.addEventListener('icecandidate', event => { if (event.candidate) { const candidate = event.candidate, type = candidate.type === 'relay' ? 'turn' : ['srflx', 'prflx'].includes(candidate.type) ? 'stun' : 'host'; types.push({ type: candidate.type ?? null, emptyCandidate: candidate.candidate === '', nullAddress: candidate.address === null, matchesConfigured: addresses ? candidate.address === addresses[type] : null, srflxText: / typ srflx(?: |$)/.test(candidate.candidate), hostText: / typ host(?: |$)/.test(candidate.candidate) }); } else { clearTimeout(timer); resolve(); } }); pc.addEventListener('icecandidateerror', event => errors.push(event.errorCode)); });
    await pc.setLocalDescription(await pc.createOffer()); await ready;
    return { descriptors, deviceIds, types, errors, gathering: pc.iceGatheringState, policy: pc.getConfiguration().iceTransportPolicy, configuredStunServer: pc.getConfiguration().iceServers?.some(server => server.urls === 'stun:' + iceHost + ':' + port || server.urls?.includes('stun:' + iceHost + ':' + port)) };
  } finally { clearTimeout(timer); pc.close(); }
}
async function rtcNativeModeProbe({ port, username, credential, iceHost, customAddresses }) {
  const checks = [], stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
  try {
    const deviceIds = (await navigator.mediaDevices.enumerateDevices()).map(device => device.deviceId);
    for (const kind of ['stun', 'turn']) {
      const servers = kind === 'stun' ? [{ urls: 'stun:' + iceHost + ':' + port }] : [{ urls: 'turn:' + iceHost + ':' + port + '?transport=udp', username, credential }];
      const pc = new RTCPeerConnection({ iceServers: servers, iceTransportPolicy: kind === 'turn' ? 'relay' : 'all' }), candidates = []; let timer;
      try {
        pc.createDataChannel('owned-native-mode'); const ready = new Promise(resolve => { timer = setTimeout(resolve, 7000); pc.addEventListener('icecandidate', event => { if (event.candidate && event.candidate.candidate) candidates.push(event.candidate); else if (!event.candidate) { clearTimeout(timer); resolve(); } }); });
        await pc.setLocalDescription(await pc.createOffer()); await ready;
        const expectedType = kind === 'stun' ? 'srflx' : 'relay', expectedAddress = kind === 'stun' ? '198.51.100.37' : iceHost;
        if (!candidates.some(candidate => candidate.type === expectedType && candidate.address === expectedAddress)) throw Error(kind + ' native fixture address was not restored');
        if (candidates.some(candidate => Object.values(customAddresses).includes(candidate.address))) throw Error('a dormant Custom address remains in a fresh native document');
        checks.push(kind + ' actual native candidate restored');
      } finally { clearTimeout(timer); pc.close(); }
    }
    return { checks, deviceIds };
  } finally { for (const track of stream.getTracks()) track.stop(); }
}
async function readRtcResult() { await until('return Boolean(window.__rtcResult||window.__rtcFailure);', [], 500); return script('return window.__rtcFailure?{probeFailure:window.__rtcFailure}:window.__rtcResult;'); }
async function startRtcFixture() {
  const selfInterface = process.argv.includes('--rtc-lan') ? Object.values(networkInterfaces()).flat().find(item => item?.family === 'IPv4' && !item.internal)?.address : '127.0.0.1';
  assert.ok(selfInterface, 'A local IPv4 interface is required for this self-only ICE fixture');
  ice = await createIceFixture({ bindAddress: selfInterface }); evidence.selfInterfaceFixture = selfInterface !== '127.0.0.1'; const addresses = { host: '192.0.2.51', stun: '198.51.100.51', turn: '203.0.113.51' };
  http = createServer((request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname, custom = path.startsWith('/rtc-'), native = ['/mode-bypass', '/mode-off'].includes(path), on = path === '/mode-on', fn = custom ? webRtcNativeProbe : native ? rtcNativeModeProbe : on ? async () => ({ pcAbsent: typeof globalThis.RTCPeerConnection === 'undefined' }) : rtcPageBaseline;
    const options = custom ? { port: ice.port, username: ice.username, credential: ice.credential, iceHost: ice.host, addresses, randomized: true, freshCertificates: true } : native ? { port: ice.port, username: ice.username, credential: ice.credential, iceHost: ice.host, customAddresses: addresses } : { port: ice.port, iceHost: ice.host, devices: path === '/baseline', addresses: path === '/diagnostic' ? addresses : null };
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end("<!doctype html><html><head><script>try{const c=new RTCIceCandidate({candidate:'candidate:1 1 UDP 2122260223 198.18.0.99 5000 typ srflx raddr 198.18.0.98 rport 5001',sdpMid:'0'});globalThis.__rtcFirstInline=c.candidate.includes('198.51.100.51')&&globalThis[Symbol.for('detect.expert/api-custom/document/v2')]===true;}catch{globalThis.__rtcFirstInline=false;}\n(" + fn.toString() + ')(' + JSON.stringify(options) + ').then(result=>window.__rtcResult=result,error=>window.__rtcFailure=String(error));</script><title>Owned local RTC fixture</title></head><body>Local RTC fixture</body></html>');
  }); await new Promise(done => http.listen(0, '127.0.0.1', done)); origin = 'http://127.0.0.1:' + http.address().port;
}
try {
  const reservation = createServer(); await new Promise(done => reservation.listen(0, '127.0.0.1', done)); const port = reservation.address().port; await new Promise(done => reservation.close(done)); endpoint = 'http://127.0.0.1:' + port;
  const bidiReservation = createServer(); await new Promise(done => bidiReservation.listen(0, '127.0.0.1', done)); const bidiPort = bidiReservation.address().port; await new Promise(done => bidiReservation.close(done));
  driver = spawn(driverPath, ['--host', '127.0.0.1', '--port', String(port), '--websocket-port', String(bidiPort), '--profile-root', run, '--log', 'error'], { cwd: root, windowsHide: true }); driver.once('error', error => { driverError = error; }); driver.stdout.pipe(log); driver.stderr.pipe(log);
  for (let n = 0; n < 80; n++) { if (driverError) throw driverError; try { await command('/status', undefined, 'GET'); break; } catch { await pause(100); } }
  const opened = await command('/session', { capabilities: { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': { binary, args: ['-headless', '-no-remote', '-profile', profile] } } } }); session = opened.sessionId; evidence.browser = opened.capabilities.browserVersion;
  if (process.argv.includes('--rtc')) { await startRtcFixture(); await wd('/url', { url: origin + '/pre-install' }); const result = await readRtcResult(); assert.equal(result.probeFailure, undefined); const { deviceIds, ...safeResult } = result; assert.deepEqual(deviceIds, []); evidence.preInstallBaseline = safeResult; evidence.preInstallCounts = { ...ice.counts }; }
  const archive = join(run, 'webrtc-ui.xpi'); writeFileSync(archive, archiveProduction(extension)); assert.equal(await wd('/moz/addon/install', { path: archive, temporary: true }), FIREFOX_ID);
  await wd('/url', { url: 'moz-extension://' + uuid + '/options.html#api' }); await send({ type: 'ui-data-consent-set', version: 1, accepted: true }); await asyncScript('const done=arguments[arguments.length-1];browser.storage.local.set({"ui-language-v1":"en"}).then(()=>done(true));'); const beforeRefresh = await script('return performance.timeOrigin;'); await wd('/refresh', {});
  await until('return performance.timeOrigin!==arguments[0]&&document.readyState==="complete";', [beforeRefresh]); await ready(); const initial = await state(); assert.equal(initial.configuration.enabled, false);
  phase = 'direct WebRTC entry without Custom'; assert.equal(initial.configuration.apis.find(row => row.id === 'webrtc').mode, 'bypass');
  // The former overview tiles are gone; the row's own Configure button opens the editor that offers every feature.
  const overview = await script('const b=document.querySelector("[data-webrtc-row-configure]");return {row:Boolean(b)&&b.getClientRects().length>0&&!b.disabled,popup:b?b.getAttribute("aria-haspopup"):null};');
  assert.deepEqual(overview, { row: true, popup: 'dialog' });
  await script('window.__rtcUiWrites=[];browser.storage.onChanged.addListener((changes,area)=>{if(area==="local")window.__rtcUiWrites.push(Object.keys(changes));});');
  await click('[data-webrtc-row-configure]'); await until('return Boolean(document.querySelector("[data-webrtc-profile-fields]"));');
  const offered = await script('return [...document.querySelectorAll("[data-webrtc-profile-fields] [data-webrtc-field]")].map(e=>e.dataset.webrtcField);');
  for (const key of ['addresses', 'ipv4:host', 'ipv4:stun', 'ipv4:turn', 'ipv6:host', 'ipv6:stun', 'ipv6:turn', 'iceTransportPolicy', 'devices', 'certificates']) assert.ok(offered.includes(key), 'the direct editor offers ' + key);
  await type('[data-api-value-name]', 'Discarded Firefox RTC draft'); await click('[data-webrtc-field="devices"]'); await click('[data-webrtc-field="certificates"]');
  await click('.api-config-modal .api-config-actions button:not([data-api-value-save])'); await until('return !document.querySelector("[data-webrtc-profile-fields]");');
  const cancelled = await state(); assert.equal(cancelled.revision, initial.revision); assert.deepEqual(cancelled.configuration, initial.configuration); assert.deepEqual(await script('return window.__rtcUiWrites;'), []);
  check('OFF master and Bypass expose the direct row Configure whose editor offers IPv4/IPv6 Host/STUN/TURN, device and DTLS controls; cancelling a changed native form writes nothing');
  phase = 'native policy'; const baseline = await nativePolicy(); assert.equal(baseline.error, undefined);
  // ADR-064/104: the policy is chosen in the Antidetect network section and applies only while the Antidetect master is ON; the API master stays OFF.
  await wd('/url', { url: 'moz-extension://' + uuid + '/options.html#antidetect' }); await antidetectReady(); await antidetectMaster(true);
  for (const desired of ['default_public_interface_only', 'disable_non_proxied_udp', 'system']) {
    const before = await state(); await script('document.querySelector("[data-antidetect-network-policy]").scrollIntoView({block:"center",inline:"nearest"});'); await click('[data-antidetect-network-policy] option[value="' + desired + '"]'); await click('[data-antidetect-save]');
    const saved = await revisionAfter(before); await antidetectReady();
    assert.ok(saved.revision > before.revision); assert.equal(saved.configuration.enabled, false); assert.equal(saved.configuration.antidetectEnabled, true); assert.equal(saved.configuration.webrtcNetworkPolicy, desired);
    const actual = await nativePolicy(); assert.equal(actual.error, undefined);
    if (desired === 'system') { assert.equal(actual.value, baseline.value); assert.notEqual(actual.levelOfControl, 'controlled_by_this_extension'); }
    else { assert.equal(actual.value, desired); assert.equal(actual.levelOfControl, 'controlled_by_this_extension'); assert.equal(saved.webrtcNetwork.status, 'applied'); }
    evidence.policies.push({ desired, actual, state: saved.webrtcNetwork, apiMaster: saved.configuration.enabled, antidetectMaster: saved.configuration.antidetectEnabled });
  }
  const stopped = await antidetectMaster(false); assert.equal(stopped.configuration.webrtcNetworkPolicy, 'system');
  const restored = await nativePolicy(); assert.equal(restored.value, baseline.value); assert.notEqual(restored.levelOfControl, 'controlled_by_this_extension');
  check('actual Firefox privacy policy get/set/clear from the Antidetect network section restores its baseline while the API master stays OFF; only the disposable copy requires privacy');
  await wd('/url', { url: 'moz-extension://' + uuid + '/options.html#api' }); await ready();
  phase = 'typed UI'; await click('[data-api-early-grant]'); await until('return !document.querySelector("[data-api-early-grant]");');
  await ready(); assert.equal((await state()).configuration.apis.find(row => row.id === 'webrtc').mode, 'bypass'); await type('[data-protection-search]', 'webrtc'); await click('[data-webrtc-row-configure]');
  await until('return Boolean(document.querySelector("[data-webrtc-profile-fields]"));'); await type('[data-api-value-name]', 'Firefox RTC profile'); await click('[data-webrtc-field="addresses"]');
  // ADR-064: independent IPv4/IPv6 families; every typed slot belongs to its own family.
  const addresses = { ipv4: { host: '192.0.2.11', stun: '198.51.100.22', turn: null }, ipv6: { host: null, stun: null, turn: '2001:db8::33' } };
  const typed = Object.entries(addresses).flatMap(([family, slots]) => Object.entries(slots).filter(([, value]) => value !== null).map(([key, value]) => [family + ':' + key, value]));
  for (const [key, value] of typed) await type('[data-webrtc-field="' + key + '"]', value);
  await click('[data-webrtc-field="iceTransportPolicy"] option[value="relay"]'); await click('[data-webrtc-field="devices"]'); await click('[data-webrtc-field="certificates"]');
  const beforeCreate = await state(); await click('[data-api-value-save]'); let created; for (let n = 0; n < 100; n++) { created = await state(); if (created.revision > beforeCreate.revision) break; await pause(60); }
  assert.equal(created.revision, beforeCreate.revision + 1); const rtc = created.configuration.apis.find(row => row.id === 'webrtc'); assert.deepEqual(rtc.selected.value, { addresses, iceTransportPolicy: 'relay', randomizeDevices: true, freshCertificates: true, deviceLifetime: 'session' }); assert.equal(rtc.mode, 'custom'); assert.equal(rtc.userValues[0].label, 'Firefox RTC profile'); assert.deepEqual(rtc.userValues[0].value, rtc.selected); assert.equal(created.configuration.enabled, false);
  await until('return !document.querySelector("[data-webrtc-profile-fields]");'); await ready();
  evidence.profile = rtc.selected.value; check('direct Configure from Bypass saves the real typed IPv4/IPv6, relay, device-session and per-connection DTLS profile in one revision without enabling the master');
  phase = 'saved profile reuse and JSON'; const priorUiOrigin = await script('return performance.timeOrigin;'); await wd('/refresh', {}); await until('return performance.timeOrigin!==arguments[0]&&document.readyState==="complete";', [priorUiOrigin]); await ready();
  await type('[data-protection-search]', 'webrtc'); assert.deepEqual((await state()).configuration, created.configuration);
  await click('[data-webrtc-row-configure]'); await until('return Boolean(document.querySelector("[data-webrtc-profile-fields]"));');
  assert.equal(await script('return document.querySelector("[data-api-value-name]").value;'), 'Firefox RTC profile');
  for (const [key, value] of typed) {
    const field = await script('const e=[...document.querySelectorAll("[data-webrtc-field]")].find(x=>x.dataset.webrtcField===arguments[0]);return {value:e.value,label:e.labels.length===1?e.labels[0].innerText.trim():"",family:e.closest("[data-webrtc-family]").querySelector("legend").innerText.trim()};', [key]);
    assert.equal(field.value, value); assert.ok(field.label.length > 0, key + ' keeps its own label'); assert.equal(field.family, key.startsWith('ipv4:') ? 'IPv4' : 'IPv6');
  }
  await click('.api-config-modal .api-config-actions button:not([data-api-value-save])'); await until('return !document.querySelector("[data-webrtc-profile-fields]");');
  await click('[data-protection-feature="webrtc"] .api-value-picker'); await click('[data-api-value-list="webrtc"] option[value="p:' + rtc.presets[0].id + '"]');
  await click('[data-protection-feature="webrtc"] .api-value-picker'); await click('[data-api-value-list="webrtc"] option[value="u:' + rtc.userValues[0].id + '"]');
  await until('return document.querySelector("[data-protection-save]")?.disabled===true;'); assert.equal((await state()).revision, created.revision); assert.deepEqual((await state()).configuration, created.configuration);
  await click('[data-api-config-export]'); await until('return Boolean(document.querySelector(".api-config-json"));');
  const exported = importApiConfiguration(await script('return document.querySelector(".api-config-json").textContent;')); assert.equal(exported.ok, true); assert.deepEqual(exported.value, created.configuration);
  await click('.api-config-modal .api-config-actions button:not([data-api-config-apply])');
  evidence.export = { formatVersion: exported.value.formatVersion, catalogVersion: exported.value.catalogVersion, rows: exported.value.apis.length, profile: rtc.selected.value };
  check('saved fields reopen through the direct row button after reload, the library reselects the same record, and actual export preview round-trips the exact JSON configuration');
  if (process.argv.includes('--rtc')) {
    phase = 'native WebRTC'; const addresses = { host: '192.0.2.51', stun: '198.51.100.51', turn: '203.0.113.51' }, uiHandle = await wd('/window', undefined, 'GET');
    const fixtureHandle = (await wd('/window/new', { type: 'tab' })).handle; await wd('/window', { handle: fixtureHandle }); await wd('/url', { url: origin + '/baseline' });
    // Actual page MAIN owns all RTC/media calls. WebDriver only reads the completed result.
    // Physical fake-device IDs stay solely in process RAM and never enter evidence.
    const baselineResult = await readRtcResult(); assert.equal(baselineResult.probeFailure, undefined);
    const { deviceIds: originalIds, ...safeBaseline } = baselineResult; assert.ok(Array.isArray(originalIds));
    const nativeIds = new Set(originalIds.filter(id => !['', 'default', 'communications'].includes(id))); assert.ok(nativeIds.size > 0);
    evidence.nativeBaselineGather = safeBaseline; evidence.nativeBaselineIceCounts = { ...ice.counts };
    await wd('/window', { handle: uiHandle }); const current = await state(), profile = { addresses, iceTransportPolicy: 'preserve', randomizeDevices: true, freshCertificates: true, deviceLifetime: 'session' };
    const configured = await send({ type: 'ui-api-config-set', tabId: null, expectedRevision: current.revision, configuration: { ...current.configuration, enabled: true, apis: current.configuration.apis.map(row => row.id === 'webrtc' ? { ...row, mode: 'custom', selected: { kind: 'value', value: profile } } : row) } });
    assert.equal(configured.type, 'api-config-state'); assert.equal(configured.registration, 'ready'); evidence.rtcRuns = []; let priorAliases;
    for (let index = 0; index < 2; index++) {
      await wd('/window', { handle: fixtureHandle }); await wd('/url', { url: origin + '/rtc-' + index }); assert.equal(await script('return globalThis.__rtcFirstInline;'), true, 'Custom RTC is installed before the first inline script');
      const result = await readRtcResult();
      if (result.probeFailure) { evidence.customGatherFailure = result.probeFailure; await wd('/url', { url: origin + '/diagnostic' }); const diagnostic = await readRtcResult(), { deviceIds, ...safeDiagnostic } = diagnostic; assert.equal(deviceIds?.length, 0); evidence.customGatherDiagnostic = safeDiagnostic; await wd('/window', { handle: uiHandle }); evidence.nativePolicyAtFailure = await nativePolicy(); await wd('/window', { handle: fixtureHandle }); }
      assert.equal(result.probeFailure, undefined); assert.ok(result.checks.length > 0); assert.equal(result.firstInline, true);
      const { deviceAliases, ...safeResult } = result, actual = deviceAliases.filter(id => !['', 'default', 'communications'].includes(id));
      const changed = actual.length > 0 && actual.every(id => !nativeIds.has(id)); assert.equal(changed, true, 'every fake-device identity differs from the master-OFF baseline');
      if (priorAliases) assert.deepEqual(deviceAliases, priorAliases, 'device aliases remain stable across two fresh pages in one browser session');
      priorAliases = deviceAliases; evidence.rtcRuns.push({ ...safeResult, deviceCount: actual.length, nativeDeviceIdsChanged: changed, sessionStable: index === 1 });
    }
    evidence.iceCounts = { ...ice.counts }; assert.ok(ice.counts.binding > 0 && ice.counts.allocate > 0 && ice.counts.authenticated > 0);
    evidence.modeTransitions = [];
    for (const mode of ['bypass', 'off', 'on']) {
      await wd('/window', { handle: uiHandle }); const beforeMode = await state(), original = beforeMode.configuration.apis.find(row => row.id === 'webrtc');
      const savedMode = await send({ type: 'ui-api-config-set', tabId: null, expectedRevision: beforeMode.revision, configuration: { ...beforeMode.configuration, apis: beforeMode.configuration.apis.map(row => row.id === 'webrtc' ? { ...row, mode } : row) } });
      assert.equal(savedMode.type, 'api-config-state'); const retained = savedMode.configuration.apis.find(row => row.id === 'webrtc'); assert.deepEqual(retained.userValues, original.userValues); assert.deepEqual(retained.selected, original.selected);
      await wd('/window', { handle: fixtureHandle }); await wd('/url', { url: origin + '/mode-' + mode }); const result = await readRtcResult(); assert.equal(result.probeFailure, undefined);
      if (mode === 'on') { assert.equal(result.pcAbsent, true); evidence.modeTransitions.push({ mode, pcAbsent: true, libraryRetained: true }); }
      else { const { deviceIds, ...safeResult } = result; assert.deepEqual(deviceIds, originalIds, 'native fake-device identifiers must be restored outside Custom'); evidence.modeTransitions.push({ mode, ...safeResult, nativeDevicesRestored: true, libraryRetained: true }); }
    }
    check('fresh page MAIN documents restore actual STUN/relay addresses and native device identifiers in Bypass/OFF; ON removes RTCPeerConnection and every mode retains the saved library');
    await wd('/window', { handle: uiHandle }); const enabled = await state(); const stopped = await send({ type: 'ui-api-config-set', tabId: null, expectedRevision: enabled.revision, configuration: { ...enabled.configuration, enabled: false } }); assert.equal(stopped.configuration.enabled, false);
    check((evidence.selfInterfaceFixture ? 'Firefox owned self-host STUN/authenticated TURN' : 'Firefox real loopback STUN/authenticated TURN') + ', first-inline candidate, SDP/getStats/getters, fresh DTLS and changed session-stable fake-device IDs pass on two fresh pages');
  }
  evidence.result = 'PASS'; console.log('PASS WebRTC Firefox UI: ' + evidence.checks.length + ' checks');
} catch (error) { evidence.failure = { phase, error: String(error.stack ?? error) }; evidence.result = 'FAIL'; process.exitCode = 1; console.error(evidence.failure); }
finally { if (session) try { await command('/session/' + session, undefined, 'DELETE'); } catch {} driver?.kill(); log.end(); if (ice) evidence.iceCounts = { ...ice.counts }; await ice?.close(); http?.closeAllConnections(); if (http?.listening) await new Promise(done => http.close(done)); writeFileSync(join(artifact, 'webrtc-ui-firefox.json'), JSON.stringify(evidence, null, 2) + '\n'); }
