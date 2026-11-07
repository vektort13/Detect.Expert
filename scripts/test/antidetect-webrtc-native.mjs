// ADR-064: disposable browser MAIN realms, genuine ICE objects, self-only STUN/TURN and native DTLS.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, createWriteStream } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { installWebRtcCustom } from '../../apps/production-extension/api-custom-webrtc-runtime.js';
import { createIceFixture } from './webrtc-ice-fixture.mjs';

export async function antidetectRtcProof(installer, options) {
  const checks = [], limitations = [], peers = [], nativeCandidates = [], projectedCandidates = [], statsCoverage = [];
  const verify = (condition, label) => { if (!condition) throw Error(label); checks.push(label); };
  const Candidate = RTCIceCandidate, Peer = RTCPeerConnection;
  const rawText = Object.getOwnPropertyDescriptor(Candidate.prototype, 'candidate').get;
  const rawAddress = Object.getOwnPropertyDescriptor(Candidate.prototype, 'address').get;
  const rawDescription = Object.getOwnPropertyDescriptor(RTCSessionDescription.prototype, 'sdp')?.get;
  const rawStats = Peer.prototype.getStats;
  const baseline = new Peer(); peers.push(baseline);
  const baselineReport = await baseline.getStats(), rawForEach = Object.getPrototypeOf(baselineReport).forEach;
  baseline.close();
  const supplied = await Peer.generateCertificate({ name: 'ECDSA', namedCurve: 'P-256' });
  const suppliedPrint = supplied.getFingerprints()[0].value;
  const profile = options.profile, addresses = profile.addresses;
  const expected = (role, original) => {
    if (!addresses) return original;
    const family = original?.includes(':') ? 'ipv6' : /^(?:[0-9]+\.){3}[0-9]+$/.test(original ?? '') ? 'ipv4' : null;
    return family ? addresses[family][role] : addresses.ipv4[role] || addresses.ipv6[role];
  };
  // A name without an address family (mDNS `<uuid>.local`) is mapped by the runtime to the family of its candidate: both configured addresses are valid answers.
  const acceptable = (role, original) => {
    if (!addresses) return [original];
    const family = original?.includes(':') ? 'ipv6' : /^(?:[0-9]+\.){3}[0-9]+$/.test(original ?? '') ? 'ipv4' : null;
    return family ? [addresses[family][role]] : [addresses.ipv4[role], addresses.ipv6[role]];
  };
  const role = type => type === 'relay' ? 'turn' : type === 'srflx' || type === 'prflx' ? 'stun' : 'host';
  const installation = installer(globalThis, [{ id: 'webrtc', mode: 'custom', value: profile }]);
  try {
    for (const original of ['198.18.0.41', 'fd12:3456:789a::41']) for (const type of ['host', 'srflx', 'relay']) {
      const candidate = new Candidate({ candidate: `candidate:1 1 UDP 2122260223 ${original} 5000 typ ${type} raddr ${original} rport 5001`, sdpMid: '0' });
      const wanted = expected(role(type), original), text = candidate.candidate;
      verify(candidate.address === wanted, type + ' genuine ' + (original.includes(':') ? 'IPv6' : 'IPv4') + ' candidate getter respects selected family');
      verify(Candidate.prototype.toJSON.call(candidate).candidate === text, type + ' genuine toJSON and prototype getters agree');
      verify(wanted === null ? text === '' : text.includes(wanted) && !text.includes(original), type + ' candidate text does not expose the original address');
      verify(Object.getOwnPropertyDescriptor(Candidate.prototype, 'address').get.call(candidate) === wanted, type + ' borrowed getter respects selected family');
      projectedCandidates.push({ type, family: original.includes(':') ? 'ipv6' : 'ipv4', suppressed: wanted === null });
    }
    const syntheticSdp = 'v=0\r\no=- 1 1 IN IP6 fd12:3456:789a::41\r\ns=-\r\nc=IN IP4 198.18.0.41\r\na=rtcp:9 IN IP6 fd12:3456:789a::41\r\na=remote-candidates:1 198.18.0.41 5000 2 fd12:3456:789a::41 5001\r\na=fingerprint:sha-256 AA:BB:CC\r\n';
    const description = new RTCSessionDescription({ type: 'offer', sdp: syntheticSdp });
    if (addresses) {
      verify(!description.sdp.includes('198.18.0.41') && !description.sdp.includes('fd12:3456:789a::41'), 'genuine SDP getters suppress both native families');
      verify(description.toJSON().sdp === description.sdp && description.sdp.includes('AA:BB:CC'), 'native description toJSON preserves actual fingerprint metadata');
    }
    for (const kind of ['stun', 'turn']) {
      const iceServers = kind === 'stun' ? [{ urls: `stun:${options.iceHost}:${options.port}` }] : [{ urls: `turn:${options.iceHost}:${options.port}?transport=udp`, username: options.username, credential: options.credential }];
      let ignored = 0;
      const pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: kind === 'turn' ? 'relay' : 'all', get certificates() { ignored++; return [supplied]; } }); peers.push(pc);
      verify(profile.freshCertificates ? ignored === 0 : ignored === 1, kind + ' native constructor applies the requested certificate policy');
      pc.createDataChannel('owned-gather'); const candidates = []; let timer;
      const gathered = new Promise(done => {
        timer = setTimeout(done, 9000);
        pc.addEventListener('icecandidate', event => {
          if (event.candidate && Reflect.apply(rawText, event.candidate, []) !== '') candidates.push(event.candidate);
          if (!event.candidate) { clearTimeout(timer); done(); }
        });
      });
      await pc.setLocalDescription(await pc.createOffer()); await gathered; clearTimeout(timer);
      verify(candidates.some(candidate => candidate.type === (kind === 'stun' ? 'srflx' : 'relay')), kind + ' self-only native ICE server produces the expected candidate type');
      for (const candidate of candidates) {
        const original = Reflect.apply(rawAddress, candidate, []), wanted = expected(role(candidate.type), original);
        verify(acceptable(role(candidate.type), original).includes(candidate.address), kind + ' actual candidate uses the matching family and role');
        verify(!addresses || !original || candidate.candidate === '' || !candidate.candidate.includes(original), kind + ' actual candidate never leaks its original address');
        nativeCandidates.push({ kind, type: candidate.type, family: original?.includes(':') ? 'ipv6' : 'ipv4-or-mdns', suppressed: wanted === null });
      }
      if (addresses) {
        const report = await pc.getStats(), projected = [...report.values()].filter(row => row.type === 'local-candidate');
        const nativeReport = await Reflect.apply(rawStats, pc, []), originals = [];
        Reflect.apply(rawForEach, nativeReport, [row => { if (row.type === 'local-candidate') originals.push(row); }]);
        verify(projected.length > 0, kind + ' native stats provide candidate records');
        verify(projected.every(row => originals.some(original => row.candidateType === original.candidateType && acceptable(role(original.candidateType), original.address ?? original.ip).includes(row.address ?? row.ip ?? null))), kind + ' stats match native candidates with the same address-family projection');
        verify(projected.every(row => report.get(row.id) === row) && [...report].every(([id, row]) => id === row.id), kind + ' stats maplike getters and iterators retain their relationships');
      }
      pc.close();
    }
    // Both peers are real browser objects. The projection is reversed only for
    // their own signaling arguments; no transport address or certificate is forged.
    for (const route of ['direct', 'turn-relay']) {
    const connectionConfig = route === 'direct' ? { iceServers: [] } : { iceServers: [{ urls: `turn:${options.iceHost}:${options.port}?transport=udp`, username: options.username, credential: options.credential }], iceTransportPolicy: 'relay' };
    const first = new RTCPeerConnection({ ...connectionConfig, certificates: [supplied] }), second = new RTCPeerConnection({ ...connectionConfig, certificates: [supplied] }); peers.push(first, second);
    const firstPending = [], secondPending = [], candidateErrors = [];
    async function add(target, candidate, pending) {
      if (!candidate) return;
      const init = candidate.toJSON();
      if (!target.remoteDescription) pending.push(init);
      else try { await target.addIceCandidate(init); } catch (error) { candidateErrors.push(error.name); }
    }
    first.onicecandidate = event => { void add(second, event.candidate, secondPending); };
    second.onicecandidate = event => { void add(first, event.candidate, firstPending); };
    const channel = first.createDataChannel('owned-loopback'); let receiver;
    const received = new Promise((done, reject) => {
      const timer = setTimeout(() => reject(Error('self-only native data channel timed out')), 15000);
      second.ondatachannel = event => { receiver = event.channel; receiver.onmessage = message => { clearTimeout(timer); done(message.data); }; };
    });
    // Attach rejection immediately while signaling proceeds.
    void received.catch(() => {});
    const offer = await first.createOffer(); await first.setLocalDescription(offer); await second.setRemoteDescription(offer);
    for (const init of secondPending.splice(0)) await second.addIceCandidate(init);
    const answer = await second.createAnswer(); await second.setLocalDescription(answer); await first.setRemoteDescription(answer);
    for (const init of firstPending.splice(0)) await first.addIceCandidate(init);
    await new Promise((done, reject) => {
      if (channel.readyState === 'open') return done();
      const timer = setTimeout(() => reject(Error('self-only sender timed out')), 15000);
      channel.onopen = () => { clearTimeout(timer); done(); };
    });
    channel.send('antidetect-owned-native-dtls'); verify(await received === 'antidetect-owned-native-dtls', route + ': two actual native peers exchange a message over ICE and DTLS');
    verify(candidateErrors.length === 0 && receiver?.readyState === 'open', route + ': own projected candidate objects round-trip to valid native ICE without errors');
    const firstNativeSdp = rawDescription ? Reflect.apply(rawDescription, first.localDescription, []) : first.localDescription.sdp;
    const secondNativeSdp = rawDescription ? Reflect.apply(rawDescription, second.localDescription, []) : second.localDescription.sdp;
    const fingerprint = sdp => /^a=fingerprint:([^\r\n]+)$/m.exec(sdp)?.[1];
    verify(Boolean(fingerprint(firstNativeSdp)) && first.localDescription.sdp.includes(fingerprint(firstNativeSdp)), route + ': projected SDP keeps the genuine native DTLS fingerprint');
    if (profile.freshCertificates) verify(fingerprint(firstNativeSdp) !== fingerprint(secondNativeSdp) && !firstNativeSdp.includes(suppliedPrint) && !secondNativeSdp.includes(suppliedPrint), route + ': fresh native DTLS identities differ even when both callers supply the same certificate');
    const finalReport = await first.getStats(), transports = [...finalReport.values()].filter(row => row.type === 'transport');
    const hasDtlsState = transports.some(row => typeof row.dtlsState === 'string');
    if (hasDtlsState) verify(transports.some(row => row.dtlsState === 'connected'), route + ': native getStats confirms a connected DTLS transport');
    else if (!limitations.some(value => value.startsWith('This browser does not expose'))) limitations.push('This browser does not expose transport.dtlsState in getStats; actual ICE/DTLS connectivity is confirmed by native peer data-channel exchange and matching native SDP fingerprints.');
    statsCoverage.push({ route, nativeTransportRows: transports.length, hasDtlsState });
    first.close(); second.close();
    }
    if (nativeCandidates.every(row => row.family !== 'ipv6')) limitations.push('No routable IPv6 ICE interface was present; IPv6 projection was verified on genuine native RTCIceCandidate/RTCSessionDescription objects, not an IPv6 network route.');
    limitations.push('Source runtime is installed directly in an owned MAIN fixture; production userScripts registration is exercised by separate extension tests.');
    limitations.push('Configured IPs change metadata. Actual self-only STUN/TURN packets retain their native source/relay addresses.');
    return { checks, limitations, state: installation.snapshot(), nativeCandidates, projectedCandidates, statsCoverage };
  } finally { for (const pc of peers) try { pc.close(); } catch {} installation.stop(); }
}

const root = resolve(import.meta.dirname, '../..'), selectedBrowser = process.argv.includes('--firefox') ? 'firefox' : 'chrome';
const base = join(root, '.tmp/antidetect-rtc-native'); mkdirSync(base, { recursive: true });
const run = mkdtempSync(join(base, selectedBrowser + '-'));
const ownInterface = Object.values(networkInterfaces()).flat().find(item => item?.family === 'IPv4' && !item.internal)?.address;
assert.ok(ownInterface, 'An existing self IPv4 interface is required; no external server is contacted');
const ice = await createIceFixture({ bindAddress: ownInterface });
const both = { ipv4: { host: '192.0.2.51', stun: '198.51.100.51', turn: '203.0.113.51' }, ipv6: { host: '2001:db8::51', stun: '2001:db8::52', turn: '2001:db8::53' } };
const scenarios = [
  { id: 'dual-family', addresses: both },
  { id: 'ipv6-suppressed', addresses: { ...both, ipv6: { host: null, stun: null, turn: null } } },
  { id: 'ipv4-suppressed', addresses: { ...both, ipv4: { host: null, stun: null, turn: null } } }
];
const evidence = { result: 'RUNNING', browser: selectedBrowser, run, scope: 'own disposable browser profile, own HTTP/STUN/TURN endpoints, genuine native JS WebRTC objects', runtimeSHA256: createHash('sha256').update(readFileSync(join(root, 'apps/production-extension/api-custom-webrtc-runtime.js'))).digest('hex'), scenarios: [], ice: null };
const server = createServer((request, response) => {
  const scenario = scenarios.find(row => request.url?.startsWith('/' + row.id));
  if (!scenario) { response.writeHead(404); response.end(); return; }
  const options = { port: ice.port, iceHost: ice.host, username: ice.username, credential: ice.credential, profile: { addresses: scenario.addresses, iceTransportPolicy: 'preserve', randomizeDevices: false, freshCertificates: true, deviceLifetime: 'session' } };
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end('<!doctype html><title>Owned Antidetect RTC native fixture</title><script>(' + antidetectRtcProof.toString() + ')((' + installWebRtcCustom.toString() + '),' + JSON.stringify(options) + ').then(value=>window.__antidetectRtc={ok:true,value},error=>window.__antidetectRtc={ok:false,error:error.message});</script>');
});
await new Promise(done => server.listen(0, '127.0.0.1', done)); const origin = 'http://127.0.0.1:' + server.address().port;
let browser, driver, session, endpoint, driverLog;
async function command(path, body, method = 'POST') {
  const response = await fetch(endpoint + path, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
  const data = await response.json(); if (!response.ok || typeof data.value?.error === 'string' && typeof data.value?.message === 'string') throw Error(data.value?.message ?? JSON.stringify(data.value)); return data.value;
}
const webdriver = (path, body, method) => command('/session/' + session + path, body, method);
try {
  if (selectedBrowser === 'chrome') {
    browser = await chromium.launch({ channel: process.argv.includes('--chromium') ? 'chromium' : 'chrome', headless: true, args: ['--no-proxy-server', '--disable-background-networking'] });
    evidence.version = browser.version(); const context = await browser.newContext(), page = await context.newPage();
    for (const scenario of scenarios) {
      await page.goto(origin + '/' + scenario.id); await page.waitForFunction(() => Boolean(globalThis.__antidetectRtc), null, { timeout: 50000 });
      const result = await page.evaluate(() => globalThis.__antidetectRtc); assert.equal(result.ok, true, scenario.id + ': ' + result.error);
      evidence.scenarios.push({ id: scenario.id, ...result.value }); console.log('PASS ' + selectedBrowser + ' ' + scenario.id + ' ' + result.value.checks.length);
    }
  } else {
    const driverPath = process.env.GECKODRIVER_BINARY ?? join(root, '.tmp/firefox/tools/geckodriver.exe');
    const binary = process.env.FIREFOX_BINARY ?? 'C:\\Program Files\\Mozilla Firefox\\firefox.exe'; assert.ok(existsSync(driverPath)); assert.ok(existsSync(binary));
    const profile = join(run, 'profile'); mkdirSync(profile, { recursive: true });
    const prefs = { 'browser.shell.checkDefaultBrowser': false, 'browser.startup.page': 0, 'browser.newtabpage.enabled': false, 'datareporting.policy.dataSubmissionEnabled': false, 'toolkit.telemetry.enabled': false, 'app.update.auto': false, 'network.proxy.type': 0, 'media.peerconnection.ice.loopback': true };
    writeFileSync(join(profile, 'user.js'), Object.entries(prefs).map(([key, value]) => 'user_pref(' + JSON.stringify(key) + ', ' + JSON.stringify(value) + ');').join('\n'));
    const reservation = createServer(); await new Promise(done => reservation.listen(0, '127.0.0.1', done)); const port = reservation.address().port; await new Promise(done => reservation.close(done)); endpoint = 'http://127.0.0.1:' + port;
    driverLog = createWriteStream(join(run, 'geckodriver.log')); driver = spawn(driverPath, ['--host', '127.0.0.1', '--port', String(port), '--profile-root', run, '--log', 'error'], { windowsHide: true }); driver.stdout.pipe(driverLog); driver.stderr.pipe(driverLog);
    for (let attempt = 0; attempt < 100; attempt++) { try { await command('/status', undefined, 'GET'); break; } catch { await new Promise(done => setTimeout(done, 100)); } }
    const opened = await command('/session', { capabilities: { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': { binary, args: ['-headless', '-no-remote', '-profile', profile] } } } }); session = opened.sessionId; evidence.version = opened.capabilities.browserVersion;
    for (const scenario of scenarios) {
      await webdriver('/url', { url: origin + '/' + scenario.id }); let result;
      for (let attempt = 0; attempt < 500; attempt++) {
        result = await webdriver('/execute/sync', { script: 'return window.__antidetectRtc || null;', args: [] });
        if (result) break; await new Promise(done => setTimeout(done, 100));
      }
      assert.ok(result, scenario.id + ': fixture timed out'); assert.equal(result.ok, true, scenario.id + ': ' + result.error);
      evidence.scenarios.push({ id: scenario.id, ...result.value }); console.log('PASS ' + selectedBrowser + ' ' + scenario.id + ' ' + result.value.checks.length);
    }
  }
  evidence.result = 'PASS';
} catch (error) { evidence.result = 'FAIL'; evidence.error = error.message; process.exitCode = 1; console.error(error.message); }
finally {
  if (session) await webdriver('', undefined, 'DELETE').catch(() => {}); driver?.kill(); driverLog?.end(); await browser?.close();
  evidence.ice = { ...ice.counts }; await ice.close(); server.closeAllConnections(); await new Promise(done => server.close(done));
  writeFileSync(join(run, 'result.json'), JSON.stringify(evidence, null, 2) + '\n'); console.log(JSON.stringify({ result: evidence.result, browser: evidence.version, checks: evidence.scenarios.reduce((sum, row) => sum + row.checks.length, 0), artifact: join(run, 'result.json') }));
}
