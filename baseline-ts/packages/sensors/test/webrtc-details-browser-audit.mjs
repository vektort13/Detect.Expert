// ADR-020 native-only sensor regression. No full build or delivered release modifications.
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { startFixtureServer } from '../../../tests/fixture-server.mjs';

const built = await build({ stdin: { contents: "export { SensorRuntime, browserEnv } from './packages/sensors/src/runtime'; export { installWebRTCSensor } from './packages/sensors/src/webrtc'; export { installRtcCapture } from './packages/sensors/src/rtc-details';", resolveDir: process.cwd(), sourcefile: 'rtc-details-native.ts', loader: 'ts' }, bundle: true, write: false, format: 'iife', globalName: 'RTCDetailsAudit', platform: 'browser', target: 'es2022', logLevel: 'silent' });
const fixture = await startFixtureServer([6573]);
const udp = dgram.createSocket('udp4'); let udpPackets = 0; let respond = false;
udp.on('message', (request, sender) => {
  if (sender.address !== '127.0.0.1' || request.length < 20 || request.readUInt32BE(4) !== 0x2112a442 || request.readUInt16BE(0) !== 1) return;
  udpPackets++;
  if (!respond) return;
  const response = Buffer.alloc(32); response.writeUInt16BE(0x0101); response.writeUInt16BE(12, 2);
  request.copy(response, 4, 4, 20); response.writeUInt16BE(0x0020, 20); response.writeUInt16BE(8, 22);
  response[25] = 1; response.writeUInt16BE(40000 ^ 0x2112, 26); response.writeUInt32BE((0xcb007171 ^ 0x2112a442) >>> 0, 28);
  udp.send(response, sender.port, sender.address);
});
await new Promise((resolve, reject) => { udp.once('error', reject); udp.bind(0, '127.0.0.1', resolve); });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const evidence = { measuredAt: new Date().toISOString(), browser: browser.version(), extensionLoaded: false, complete: false, cases: [] };
async function check(name, verify, argument) {
  const page = await browser.newPage();
  try {
    const preparation = name === 'firstUnseenConfiguration' ? `
      globalThis.__rtcNativeGetConfigCalls = 0;
      { const d = Object.getOwnPropertyDescriptor(RTCPeerConnection.prototype, 'getConfiguration');
        Object.defineProperty(RTCPeerConnection.prototype, 'getConfiguration', { ...d, value: new Proxy(d.value, {
          apply(target, receiver, args) { globalThis.__rtcNativeGetConfigCalls++; return Reflect.apply(target, receiver, args); }
        }) }); }
    ` : '';
    await page.addInitScript({ content: preparation + built.outputFiles[0].text + '\n;globalThis.RTCDetailsAudit=RTCDetailsAudit;' });
    await page.goto(fixture.origins[0] + '/webrtc-details-native.html');
    let result;
    if (name === 'latePrototypePoison') {
      // Avoid Playwright's own InjectedScript.previewNode Array.push while the page prototype is poisoned.
      const session = await page.context().newCDPSession(page);
      try {
        const evaluated = await session.send('Runtime.evaluate', { expression: 'RTC_DETAILS_NATIVE.latePrototypePoison()', awaitPromise: true, returnByValue: true });
        assert.equal(evaluated.exceptionDetails, undefined);
        result = evaluated.result.value;
      } finally { await session.detach(); }
    } else result = await page.evaluate(({ name, argument }) => window.RTC_DETAILS_NATIVE[name](argument), { name, argument });
    verify(result);
    evidence.cases.push({ name, result });
    console.log('PASS ' + name);
  } finally { await page.evaluate(() => window.RTC_DETAILS_NATIVE?.finish()).catch(() => {}); await page.close(); }
}
try {
  await check('constructorAndSnapshot', result => {
    assert.deepEqual(result.afterConstructor, { iceServers: 1, urls: 1, username: 1, credential: 1 });
    assert.deepEqual(result.afterClose, result.afterConstructor);
    assert.equal(result.pageGetConfigReads, 0);
    assert.equal(result.total, 2); assert.equal(result.connectionCount, 2);
    for (const key of ['subclass', 'invalidReceiverSameError', 'firstCreated', 'firstClosed', 'configuredEndpoint', 'noFalseCandidate', 'sameClockCloseCaptured', 'clean']) assert.equal(result[key], true, key);
    assert.equal(result.observerErrors, 0);
  });
  await check('syntheticEvents', result => {
    for (const key of ['eventUntrusted', 'unchanged', 'noServers', 'clean']) assert.equal(result[key], true, key);
    assert.equal(result.candidateReads, 0);
  });
  await check('configurationChanges', result => {
    assert.equal(result.urlsReads, 1); assert.equal(result.usernameReads, 1); assert.equal(result.credentialReads, 1);
    assert.equal(result.changes, 1);
    for (const key of ['nativeSnapshotCorrect', 'capturedConfigured', 'clean']) assert.equal(result[key], true, key);
    assert.equal(result.observerErrors, 0);
  });
  await check('firstUnseenConfiguration', result => {
    assert.equal(result.snapshotCalls, 1); assert.equal(result.afterCloseCalls, 1); assert.equal(result.changes, 1);
    assert.equal(result.created, false); assert.equal(result.closed, true); assert.equal(result.duration, 'unknown'); assert.equal(result.clean, true);
  });
  await check('boundConnections', result => {
    assert.equal(result.total, 40); assert.equal(result.retained, 32); assert.equal(result.omitted, 8); assert.equal(result.uniqueIds, 32);
    assert.equal(result.allClosed, true); assert.equal(result.clean, true);
  });
  await check('pauseStop', result => {
    assert.equal(result.beforeTotal, 1); assert.equal(result.pausedTotal, 1); assert.equal(result.resumedTotal, 1); assert.equal(result.postStopMessages, 0);
    assert.equal(result.resumedNewRevision, true); assert.equal(result.oldServersPurged, true);
    assert.equal(result.constructorRestored, true); assert.equal(result.closeRestored, true); assert.equal(result.clean, true);
  });
  await check('boundedServers', result => {
    assert.equal(result.retainedServers, 8); assert.equal(result.truncated, true); assert.equal(result.limited, true);
    assert.equal(result.configuredOnly, true); assert.equal(result.clean, true);
  });
  await check('fakeBrand', result => {
    assert.equal(result.fakeReads, 0); assert.equal(result.noFakeSnapshot, true); assert.equal(result.total, 1);
    assert.equal(result.created, false); assert.equal(result.duration, 'unknown'); assert.equal(result.closed, true); assert.equal(result.clean, true);
  });
  await check('latePrototypePoison', result => {
    assert.equal(result.extraCalls, 0); assert.equal(result.errors, 0); assert.equal(result.total, 1);
    assert.equal(result.configuredServers, 2); assert.equal(result.closed, true); assert.equal(result.clean, true);
  });
  await check('sameOriginChild', result => {
    assert.equal(result.childTotal, 1); assert.equal(result.observerErrors, 0);
    for (const key of ['parentSnapshotEmpty', 'childCreated', 'childClosed', 'configuredOnly', 'clean']) assert.equal(result[key], true, key);
  });
  await check('lazyHelloAndCancellation', result => {
    assert.equal(result.idleRtcMessages, 0); assert.equal(result.invalidRtcMessages, 0);
    assert.equal(result.immediateHelloCount, 1); assert.equal(result.finalHelloCount, 1);
    assert.equal(result.firstClosed, true); assert.equal(result.duration, 'under-1s'); assert.equal(result.clean, true);
  });
  await check('firstPeerAfterPauseReset', result => {
    assert.equal(result.beforePeer, 0); assert.equal(result.helloEpoch, 1); assert.equal(result.snapshotEpoch, 1);
    assert.equal(result.total, 1); assert.equal(result.firstCreated, true); assert.equal(result.firstClosed, true);
    assert.equal(result.duration, 'under-1s'); assert.equal(result.clean, true);
  });
  for (const answer of [true, false]) {
    respond = answer; udpPackets = 0;
    await check('nativeNetwork', result => {
      assert.ok(udpPackets > 0, 'No actual fixture UDP packet');
      assert.equal(result.serverCandidate, answer); assert.equal(result.srflxEvents > 0, answer);
      assert.equal(result.privateCandidateReads, 0); assert.equal(result.observerErrors, 0);
      for (const key of ['closedUnderOneSecond', 'recordedUnderOneSecond', 'created', 'configured', 'clean']) assert.equal(result[key], true, key);
      assert.equal(result.connected, false); assert.equal(result.serverCount, 1);
      result.fixtureUdpPackets = udpPackets; result.fixtureReplyEnabled = answer;
    }, { port: udp.address().port });
  }
  evidence.complete = true;
  writeFileSync('test-results/prod/reports/2026-09-13-webrtc-details-native.json', JSON.stringify(evidence, null, 2) + '\n');
} finally { await browser.close(); await fixture.close(); await new Promise(resolve => udp.close(resolve)); }
