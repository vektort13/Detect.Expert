// Actual production pipeline, fresh copied extension and fake media; all ICE traffic is loopback.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { updateApiConfiguration } from '../../packages/contracts/src/api-configuration.mjs';
import { enableChromeUserScripts } from './api-custom-early-native.mjs';
import { createIceFixture } from './webrtc-ice-fixture.mjs';
import { webRtcNativeProbe } from './webrtc-native-probe.mjs';

const root = resolve(import.meta.dirname, '../..'); mkdirSync(join(root, '.tmp'), { recursive: true });
const run = mkdtempSync(join(root, '.tmp/webrtc-native-')), extension = join(run, 'extension'), profile = join(run, 'profile');
cpSync(join(root, 'dist/chrome'), extension, { recursive: true });
// Required privacy is used ONLY in this owned fixture to exercise the real API headlessly.
// The separate UI runner tests that production privacy is optional and absence is rejected.
const manifest = JSON.parse(readFileSync(join(extension, 'manifest.json'), 'utf8'));
assert.ok(manifest.optional_permissions.includes('privacy')); manifest.optional_permissions = manifest.optional_permissions.filter(permission => permission !== 'privacy'); manifest.permissions.push('privacy');
writeFileSync(join(extension, 'manifest.json'), JSON.stringify(manifest, null, 2));
const artifact = join(root, 'test-results/production-1.1.0/webrtc'); mkdirSync(artifact, { recursive: true });
const addresses = { host: '192.0.2.51', stun: '198.51.100.51', turn: '203.0.113.51' };
const rtcProfile = { addresses: { ipv4: addresses, ipv6: { host: null, stun: null, turn: null } }, iceTransportPolicy: 'preserve', randomizeDevices: true, freshCertificates: true, deviceLifetime: 'session' };
// Loopback is a special address that the Custom rewrite deliberately leaves alone, so the fixture binds to this machine's own non-loopback IPv4 address.
const ownInterface = Object.values(networkInterfaces()).flat().find(item => item?.family === 'IPv4' && !item.internal)?.address;
const ice = await createIceFixture(ownInterface ? { bindAddress: ownInterface } : undefined);
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store'); response.setHeader('Content-Type', 'text/html');
  response.end('<!doctype html><meta charset="utf-8"><script>try{const c=new RTCIceCandidate({candidate:"candidate:1 1 UDP 2122260223 198.18.0.99 5000 typ srflx raddr 198.18.0.98 rport 5001",sdpMid:"0"});globalThis.__rtcFirstInline=c.candidate.includes("198.51.100.51")&&globalThis[Symbol.for("detect.expert/api-custom/document/v2")]===true}catch{globalThis.__rtcFirstInline=false}</script><title>Owned WebRTC fixture</title>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = 'http://127.0.0.1:' + server.address().port;
const evidence = { result: 'RUNNING', at: new Date().toISOString(), run, browser: null, fixtureRequiredPrivacy: true, checks: [], errors: [], externalRequests: [],
  hashes: Object.fromEntries(['api-custom-registration.js', 'api-custom-webrtc-runtime.js', 'api-configuration-controller.js', 'webrtc-network-controller.js'].map(name => [name, createHash('sha256').update(readFileSync(join(extension, name))).digest('hex')])) };
let context, ui, current, extensionId;
const check = name => { evidence.checks.push(name); console.log('  ok ' + name); };
const send = message => ui.evaluate(message => chrome.runtime.sendMessage({ schemaVersion: 1, ...message }), message);
const state = () => send({ type: 'ui-api-config-get', tabId: null });
async function launch() {
  context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, viewport: { width: 1100, height: 950 },
    args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension, '--no-proxy-server', '--allow-loopback-in-peer-connection', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  await context.route('**/*', route => { const url = new URL(route.request().url()); if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) { evidence.externalRequests.push(url.origin); return route.abort(); } return route.continue(); });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'); extensionId = new URL(worker.url()).host;
  evidence.browser = context.browser().version(); ui = await context.newPage(); ui.on('pageerror', error => evidence.errors.push(error.message));
  await ui.goto('chrome-extension://' + extensionId + '/options.html#api'); ui = await enableChromeUserScripts(context, ui, extensionId, evidence);
  await send({ type: 'ui-data-consent-set', version: 1, accepted: true }); current = await state(); assert.equal(current.type, 'api-config-state');
}
async function save(configuration) {
  const result = await send({ type: 'ui-api-config-set', tabId: null, expectedRevision: current.revision, configuration });
  assert.equal(result.type, 'api-config-state', result.message); current = result; return result;
}
function withMode(mode, value = rtcProfile) {
  const changed = updateApiConfiguration(current.configuration, 'webrtc', { mode, ...(mode === 'custom' ? { selected: { kind: 'value', value } } : {}) });
  assert.equal(changed.ok, true, changed.error?.message); return { ...changed.value, enabled: true, antidetectEnabled: true };
}
async function probe(options) {
  const page = await context.newPage(); page.on('pageerror', error => evidence.errors.push(error.message));
  try { await page.goto(origin + '/rtc?run=' + Date.now()); return await page.evaluate(webRtcNativeProbe, { port: ice.port, iceHost: ice.host, username: ice.username, credential: ice.credential, ...options }); }
  finally { await page.close(); }
}
try {
  await launch(); assert.equal(current.configuration.enabled, false);
  const baselinePage = await context.newPage(); await baselinePage.goto(origin + '/baseline');
  // Native identifiers stay in this process's RAM only; evidence records a boolean differential.
  const nativeDeviceIds = await baselinePage.evaluate(async () => { const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true }); try { return (await navigator.mediaDevices.enumerateDevices()).map(device => device.deviceId).filter(id => !['', 'default', 'communications'].includes(id)); } finally { for (const track of stream.getTracks()) track.stop(); } });
  await baselinePage.close(); assert.ok(nativeDeviceIds.length);
  await probe({}); check('baseline browser gathers actual STUN srflx and authenticated TURN relay candidates using the owned loopback fixture');
  await save(withMode('custom')); assert.equal(current.registration, 'ready');
  const first = await probe({ addresses: rtcProfile.addresses, randomized: true, freshCertificates: true }); assert.equal(first.firstInline, true); assert.ok(first.checks.length > 15);
  assert.ok(first.deviceAliases.filter(id => !['', 'default', 'communications'].includes(id)).every(id => !nativeDeviceIds.includes(id)));
  check('Custom is installed before the first page script; actual candidate/SDP/stats/prototype surfaces and DTLS/device aliases pass ' + first.checks.length + ' native assertions');
  evidence.nativeAssertions = first.checks; evidence.nativeDeviceIdsChanged = true;
  const second = await probe({ addresses: rtcProfile.addresses, randomized: true, freshCertificates: true }); assert.deepEqual(second.deviceAliases, first.deviceAliases);
  check('device identifiers differ from the same-origin native baseline and stay stable across new documents and PeerConnections in one browser session');
  await context.close(); context = null; await launch(); assert.equal(current.registration, 'ready');
  const restarted = await probe({ addresses: rtcProfile.addresses, randomized: true, freshCertificates: true }); assert.notDeepEqual(restarted.deviceAliases, first.deviceAliases);
  check('browser restart keeps Custom addresses and rotates the session device salt after startup reconciliation');
  await save(withMode('bypass')); await probe({}); check('switching Custom to Bypass restores native STUN/TURN on a fresh document without destroying the saved profile');
  await save(withMode('on')); const blockedPage = await context.newPage(); await blockedPage.goto(origin + '/blocked');
  assert.equal(await blockedPage.evaluate(() => typeof RTCPeerConnection), 'undefined'); await blockedPage.close();
  check('ON still blocks the native PeerConnection constructor');
  await save(withMode('off')); await probe({}); check('OFF permits native STUN/TURN and does not retain Custom values');
  await save({ ...current.configuration, enabled: false, antidetectEnabled: true, webrtcNetworkPolicy: 'disable_non_proxied_udp' }); assert.equal(current.webrtcNetwork.status, 'applied');
  const blockedNetwork = await context.newPage(); await blockedNetwork.goto(origin + '/network'); const before = ice.counts.binding;
  const network = await blockedNetwork.evaluate(async ({ host, port }) => { const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:' + host + ':' + port }] }); pc.createDataChannel('network-policy'); const types = []; pc.onicecandidate = event => { if (event.candidate) types.push(event.candidate.type); }; await pc.setLocalDescription(await pc.createOffer()); await new Promise(resolve => setTimeout(resolve, 1300)); pc.close(); return types; }, { host: ice.host, port: ice.port });
  await blockedNetwork.close(); assert.equal(ice.counts.binding, before); assert.ok(!network.includes('srflx'));
  check('real native disable_non_proxied_udp prevents UDP STUN packets with Antidetect ON independently of the API Guard master');
  await save({ ...current.configuration, webrtcNetworkPolicy: 'system' }); assert.equal(current.webrtcNetwork.status, 'inactive');
  await probe({}); check('System releases only the extension native policy layer and restores the actual STUN/TURN path');
  assert.ok(ice.counts.allocate > 0 && ice.counts.authenticated > 0); assert.equal(ice.counts.denied, 0); evidence.iceCounts = { ...ice.counts };
  assert.deepEqual(evidence.errors, []); assert.deepEqual(evidence.externalRequests, []); evidence.result = 'PASS'; console.log('PASS WebRTC production native: ' + evidence.checks.length + ' checks');
} catch (error) { evidence.result = 'FAIL'; evidence.failure = String(error.stack ?? error); console.error(evidence.failure); process.exitCode = 1; }
finally { await context?.close(); await ice.close(); await new Promise(resolve => server.close(resolve)); writeFileSync(join(artifact, 'webrtc-native.json'), JSON.stringify(evidence, null, 2) + '\n'); }
