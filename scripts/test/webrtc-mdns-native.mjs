// Catalog 8 WebRTC host mode `mdns` in a real Chromium: genuine ICE objects, a camera/microphone grant (so Chrome would expose real addresses),
// self-only STUN/TURN on this machine's own interface and the runtime installed as the first script of the page, exactly as the document-start
// registration serializes it. Scenarios: native references (plain / granted), mdns in both families, mdns IPv4 + literal IPv6, mdns over a plain
// context (Chrome already hid the hosts) and the unchanged Custom IP mode.
//   node scripts/test/webrtc-mdns-native.mjs [--installed-chrome]
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import dgram from 'node:dgram';
import { crc32 } from 'node:zlib';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { installWebRtcCustom } from '../../apps/production-extension/api-custom-webrtc-runtime.js';
import { createIceFixture } from './webrtc-ice-fixture.mjs';

export async function mdnsProof(installer, options) {
  const checks = [], sample = {};
  const verify = (condition, label) => { if (!condition) throw Error(label); checks.push(label); };
  // Native getters and prototypes are read before the installer runs: they give the real values the page must never see.
  const proto = RTCIceCandidate.prototype, nativeGet = key => Object.getOwnPropertyDescriptor(proto, key).get;
  const rawText = nativeGet('candidate'), rawAddress = nativeGet('address'), rawRelated = nativeGet('relatedAddress'), rawType = nativeGet('type');
  const installation = options.value ? installer(globalThis, [{ id: 'webrtc', mode: 'custom', value: options.value }]) : null;
  const stream = options.grant ? await navigator.mediaDevices.getUserMedia({ audio: true }) : null;
  const peers = [], NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.local$/;
  const isSpecial = value => ['0.0.0.0', '::', '::1', '[::]', '[::1]'].includes(value) || /^127\./.test(value);
  const bare = value => typeof value === 'string' && value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
  function scan(label, value) {
    const lower = (typeof value === 'string' ? value : JSON.stringify(value)).toLowerCase();
    for (const address of options.localAddresses) {
      const needle = address.toLowerCase(), boundary = char => char === undefined || !/[0-9a-f.:]/.test(char);
      for (let from = 0; ;) { const at = lower.indexOf(needle, from); if (at < 0) break; if (boundary(lower[at - 1]) && boundary(lower[at + needle.length])) throw Error(label + ' leaks ' + address); from = at + 1; }
    }
  }
  const family = address => bare(address).includes(':') ? 'ipv6' : 'ipv4';
  const names = new Map(); // real local address -> name shown to the page
  function noteHost(candidate, label) {
    const real = bare(Reflect.apply(rawAddress, candidate, [])), shown = candidate.address;
    if (options.kind !== 'mdns' || Reflect.apply(rawType, candidate, []) !== 'host' || isSpecial(real) || options.value.addresses[family(real)].host !== 'mdns') return;
    verify(NAME.test(shown), label + ': host shows a UUIDv4 .local name');
    const previous = names.get(real); if (previous !== undefined) verify(previous === shown, label + ': one stable name per local address');
    names.set(real, shown);
  }
  async function gather(config, audio = false) {
    const pc = new RTCPeerConnection(config); peers.push(pc); if (audio) pc.addTransceiver('audio'); const channel = pc.createDataChannel('probe'); void channel;
    const events = [], errors = []; let timer;
    const done = new Promise(resolve => { timer = setTimeout(resolve, 9000); pc.addEventListener('icecandidate', event => { if (!event.candidate) { clearTimeout(timer); resolve(); } else events.push(event.candidate); }); pc.addEventListener('icecandidateerror', event => errors.push(event)); });
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer); await done; clearTimeout(timer);
    return { pc, events: events.filter(candidate => Reflect.apply(rawText, candidate, []) !== ''), errors, offer };
  }
  const stunConfig = { iceServers: [{ urls: 'stun:' + options.iceHost + ':' + options.port }] };
  const turnConfig = { iceServers: [{ urls: 'turn:' + options.iceHost + ':' + options.port + '?transport=udp', username: options.username, credential: options.credential }], iceTransportPolicy: 'relay' };
  const addresses = options.value?.addresses;
  try {
    // ---- STUN: host candidates, server-reflexive related address, SDP, stats, getters
    const stun = await gather(stunConfig, true);
    const hosts = stun.events.filter(candidate => Reflect.apply(rawType, candidate, []) === 'host'), srflx = stun.events.filter(candidate => Reflect.apply(rawType, candidate, []) === 'srflx');
    verify(hosts.length > 0, 'the browser gathered host candidates'); verify(srflx.length > 0, 'the local STUN fixture produced a server-reflexive candidate');
    const nativeHostTexts = hosts.map(candidate => Reflect.apply(rawText, candidate, []));
    const realHosts = hosts.map(candidate => bare(Reflect.apply(rawAddress, candidate, []))).filter(address => !isSpecial(address));
    sample.firstHost = { candidate: hosts[0].candidate, address: hosts[0].address, native: nativeHostTexts[0] };
    sample.firstSrflx = { candidate: srflx[0].candidate, address: srflx[0].address, relatedAddress: srflx[0].relatedAddress, relatedPort: srflx[0].relatedPort, native: Reflect.apply(rawText, srflx[0], []) };
    if (options.kind === 'native-plain') {
      verify(realHosts.every(address => address.endsWith('.local')), 'native Chrome without a grant hides every host behind a .local name');
      verify(hosts.every(candidate => NAME.test(candidate.address)), 'the hidden names are lowercase UUIDv4 .local');
      verify(srflx.every(candidate => candidate.relatedAddress === '0.0.0.0' && candidate.relatedPort === 0 && candidate.candidate.includes(' raddr 0.0.0.0 rport 0 ')), 'native Chrome hides the srflx base as 0.0.0.0 port 0');
    } else if (options.kind === 'native-granted') {
      verify(realHosts.some(address => options.localAddresses.includes(address)), 'with a camera/microphone grant native Chrome exposes real local addresses (the scenarios below are meaningful)');
      verify(srflx.some(candidate => options.localAddresses.includes(bare(candidate.relatedAddress))), 'with a grant the srflx related address is the real base');
    } else if (options.kind === 'mdns') {
      verify(realHosts.some(address => options.localAddresses.includes(address)), 'the grant is effective: native hosts would be real addresses');
      for (const candidate of hosts) {
        const real = bare(Reflect.apply(rawAddress, candidate, [])); if (isSpecial(real)) continue;
        const fam = family(real), mode = addresses[fam].host;
        noteHost(candidate, 'event');
        if (mode === 'mdns') { verify(NAME.test(candidate.address) && candidate.candidate.split(' ')[4] === candidate.address, fam + ' host event: address getter and text carry the same name'); verify(candidate.toJSON().candidate === candidate.candidate, fam + ' host toJSON agrees'); verify(Object.getOwnPropertyDescriptor(proto, 'address').get.call(candidate) === candidate.address, fam + ' borrowed getter agrees'); }
        else verify(candidate.address === mode, fam + ' literal host mode is unchanged by the mdns family next to it');
      }
      for (const candidate of srflx) {
        const real = bare(Reflect.apply(rawRelated, candidate, [])), fam = family(real);
        if (addresses[fam].host === 'mdns') verify(candidate.relatedAddress === (fam === 'ipv6' ? '::' : '0.0.0.0') && candidate.relatedPort === 0 && candidate.candidate.includes(fam === 'ipv6' ? ' raddr :: rport 0 ' : ' raddr 0.0.0.0 rport 0 ') && candidate.toJSON().candidate === candidate.candidate, 'srflx related address becomes the hidden-base placeholder with port 0 everywhere');
        else verify(candidate.relatedAddress === addresses[fam].host, 'a literal-host family keeps its related address');
        verify(candidate.address === addresses[fam].stun || family(candidate.address) !== fam, 'the srflx address still follows the STUN role');
      }
    } else if (options.kind === 'mdns-plain') {
      verify(hosts.every(candidate => candidate.candidate === Reflect.apply(rawText, candidate, []) && candidate.address === Reflect.apply(rawAddress, candidate, []) && NAME.test(candidate.address)), 'a host Chrome already hid keeps its own name and its exact text (no second name)');
      verify(hosts.every(candidate => candidate.foundation === Reflect.apply(rawText, candidate, []).split(' ')[0].replace('candidate:', '')), 'and its native foundation');
      verify(srflx.every(candidate => candidate.relatedAddress === '0.0.0.0' && candidate.relatedPort === 0), 'the already hidden base stays as Chrome wrote it');
    } else if (options.kind === 'ip') {
      for (const candidate of hosts) { const real = bare(Reflect.apply(rawAddress, candidate, [])); if (isSpecial(real)) continue; verify(candidate.address === addresses[family(real)].host, 'the Custom IP mode shows the selected literal host'); }
      for (const candidate of srflx) { const fam = family(bare(Reflect.apply(rawRelated, candidate, []))); verify(candidate.relatedAddress === addresses[fam].host, 'the Custom IP mode shows the selected literal related address'); }
    }
    // Nothing the page can read may contain a real local address (all kinds with an installation).
    if (installation && options.kind !== 'mdns-plain') {
      const offerSdp = stun.offer.sdp, local = stun.pc.localDescription;
      for (const candidate of stun.events) scan('event ' + candidate.type, [candidate.candidate, candidate.address, candidate.relatedAddress, candidate.relatedPort, candidate.foundation, candidate.toJSON()]);
      scan('offer SDP', offerSdp); scan('localDescription', [local.sdp, local.toJSON(), stun.pc.currentLocalDescription?.sdp, stun.pc.pendingLocalDescription?.sdp]);
      verify(!offerSdp.includes('mdns'), 'the placeholder word never reaches the SDP');
      const rows = [], report = await stun.pc.getStats(); report.forEach(row => rows.push(row)); scan('stats', rows);
      const hostRows = rows.filter(row => row.type === 'local-candidate' && row.candidateType === 'host' && !isSpecial(row.address ?? ''));
      if (options.kind === 'mdns') {
        const mdnsRows = hostRows.filter(row => addresses[(row.priority >>> 8 & 255) === 30 ? 'ipv4' : 'ipv6'].host === 'mdns');
        verify(mdnsRows.length > 0 && mdnsRows.every(row => row.address === '' && row.ip === ''), 'stats host rows of an mdns family are empty like Chrome stats');
        verify(rows.filter(row => row.type === 'local-candidate' && row.candidateType === 'srflx' && addresses.ipv4.host === 'mdns').every(row => !Object.hasOwn(row, 'relatedPort') && !Object.hasOwn(row, 'relatedAddress')), 'stats srflx rows lose the hidden base like Chrome stats');
        const udp = hosts.filter(candidate => candidate.protocol === 'udp' && NAME.test(candidate.address));
        verify(udp.length > 0 && udp.every(candidate => hostRows.some(row => row.protocol === 'udp' && row.port === candidate.port && row.foundation === candidate.foundation)), 'the foundation of every named UDP host agrees between the candidate and its stats row');
      }
      sample.statsHost = hostRows.slice(0, 2).map(row => ({ address: row.address, ip: row.ip, foundation: row.foundation, protocol: row.protocol }));
      sample.statsSrflx = rows.filter(row => row.type === 'local-candidate' && row.candidateType === 'srflx').map(row => ({ address: row.address, relatedPort: row.relatedPort, hasRelatedAddress: Object.hasOwn(row, 'relatedAddress') }));
      sample.offerCLine = /^c=.*$/m.exec(offerSdp)?.[0]; sample.localCLines = local.sdp.split(/\r?\n/).filter(row => row.startsWith('c=') || row.startsWith('o=') || row.startsWith('a=rtcp:'));
      sample.sdpCandidates = local.sdp.split(/\r?\n/).filter(row => row.startsWith('a=candidate:')).slice(0, 6);
    }
    // ---- IPv6 STUN (only when this machine owns a global IPv6 address): the hidden base of an IPv6 srflx candidate is ":: port 0" (bracketed in the getter)
    if (options.stun6) {
      const six = await gather({ iceServers: [{ urls: 'stun:' + options.stun6 }] }), srflx6 = six.events.filter(candidate => Reflect.apply(rawType, candidate, []) === 'srflx' && family(Reflect.apply(rawAddress, candidate, [])) === 'ipv6');
      verify(srflx6.length > 0, 'the IPv6 STUN fixture produced an IPv6 server-reflexive candidate');
      sample.srflx6 = { candidate: srflx6[0].candidate, address: srflx6[0].address, relatedAddress: srflx6[0].relatedAddress, relatedPort: srflx6[0].relatedPort, native: Reflect.apply(rawText, srflx6[0], []) };
      for (const candidate of srflx6) {
        const nativeBase = Reflect.apply(rawRelated, candidate, []);
        if (options.kind === 'native-plain' || options.kind === 'mdns-plain') verify(candidate.relatedAddress === '[::]' && candidate.relatedPort === 0 && candidate.candidate.includes(' raddr :: rport 0 '), options.kind + ': a hidden IPv6 base is ":: port 0", bracketed in the getter');
        else if (options.kind === 'native-granted') verify(options.localAddresses.includes(bare(nativeBase)) && candidate.relatedPort > 0, 'with a grant the IPv6 srflx base is the real global address');
        else if (options.kind === 'mdns' && addresses.ipv6.host === 'mdns') verify(candidate.relatedAddress === '[::]' && candidate.relatedPort === 0 && candidate.candidate.includes(' raddr :: rport 0 ') && candidate.toJSON().candidate === candidate.candidate && candidate.address === addresses.ipv6.stun, 'IPv6 srflx base becomes ":: port 0" like Chrome (text, bracketed getter, port, toJSON); the address follows the STUN role');
        else if (addresses) verify(candidate.relatedAddress === addresses.ipv6.host && candidate.candidate.includes(' raddr ' + addresses.ipv6.host + ' rport '), 'a literal IPv6 host keeps its related address');
        if (installation && options.kind !== 'mdns-plain') scan('IPv6 srflx event', [candidate.candidate, candidate.address, candidate.relatedAddress, candidate.toJSON()]);
      }
      if (installation && options.kind !== 'mdns-plain') {
        scan('IPv6 offer', [six.offer.sdp, six.pc.localDescription.sdp]);
        const rows = [], report = await six.pc.getStats(); report.forEach(row => rows.push(row)); scan('IPv6 stats', rows);
        if (options.kind === 'mdns' && addresses.ipv6.host === 'mdns') verify(rows.filter(row => row.type === 'local-candidate' && row.candidateType === 'srflx' && family(row.address) === 'ipv6').every(row => !Object.hasOwn(row, 'relatedPort') && !Object.hasOwn(row, 'relatedAddress')), 'the IPv6 srflx stats row loses the hidden base like Chrome stats');
      }
    } else sample.srflx6 = 'skipped: no global IPv6 interface on this machine';
    // ---- TURN relay: the related address of a relay is Chrome's own 0.0.0.0 placeholder, the address follows the TURN role
    const turn = await gather(turnConfig);
    const relays = turn.events.filter(candidate => Reflect.apply(rawType, candidate, []) === 'relay');
    verify(relays.length > 0, 'the local TURN fixture produced a relay candidate');
    if (installation && options.kind !== 'mdns-plain') {
      for (const candidate of turn.events) scan('relay event', [candidate.candidate, candidate.address, candidate.relatedAddress, candidate.toJSON()]);
      for (const candidate of relays) { const fam = family(bare(Reflect.apply(rawAddress, candidate, []))); verify(candidate.address === addresses[fam].turn, 'relay address follows the TURN role whatever the host mode'); verify(candidate.relatedAddress === '0.0.0.0' && candidate.relatedPort === 0, 'a relay keeps Chrome placeholder related address'); }
    }
    sample.relay = relays[0] && { candidate: relays[0].candidate, address: relays[0].address, relatedAddress: relays[0].relatedAddress, relatedPort: relays[0].relatedPort };
    // ---- Loopback: two peers in this page exchange what the page sees (trickle candidates, then a complete projected SDP) and must still connect
    // trickle hands over the toJSON() object itself, json-signaling serializes and parses every value (new objects, as a signaling server does), full-sdp sends the complete projected SDP.
    for (const route of ['trickle', 'json-signaling', 'full-sdp']) {
      const first = new RTCPeerConnection(), second = new RTCPeerConnection(); peers.push(first, second);
      const channel = first.createDataChannel('loop'), pendingFirst = [], pendingSecond = [], candidateErrors = []; let receiver;
      const received = new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error(route + ': loopback timed out')), 20000); second.ondatachannel = event => { receiver = event.channel; receiver.onmessage = message => { clearTimeout(timer); resolve(message.data); }; }; }); received.catch(() => {});
      const complete = pc => new Promise(resolve => { if (pc.iceGatheringState === 'complete') return resolve(); const timer = setTimeout(resolve, 9000); pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(timer); resolve(); } }); });
      async function add(target, candidate, pending) { if (!candidate) return; const init = route === 'json-signaling' ? JSON.parse(JSON.stringify(candidate)) : candidate.toJSON(); if (!target.remoteDescription) pending.push(init); else try { await target.addIceCandidate(init); } catch (error) { candidateErrors.push(error.name); } }
      if (route !== 'full-sdp') { first.onicecandidate = event => { void add(second, event.candidate, pendingSecond); }; second.onicecandidate = event => { void add(first, event.candidate, pendingFirst); }; }
      let offer = await first.createOffer(); await first.setLocalDescription(offer);
      if (route === 'full-sdp') { await complete(first); offer = { type: 'offer', sdp: first.localDescription.sdp }; } else if (route === 'json-signaling') offer = JSON.parse(JSON.stringify(offer));
      await second.setRemoteDescription(offer); for (const init of pendingSecond.splice(0)) await second.addIceCandidate(init);
      let answer = await second.createAnswer(); await second.setLocalDescription(answer);
      if (route === 'full-sdp') { await complete(second); answer = { type: 'answer', sdp: second.localDescription.sdp }; } else if (route === 'json-signaling') answer = JSON.parse(JSON.stringify(answer));
      await first.setRemoteDescription(answer); for (const init of pendingFirst.splice(0)) await first.addIceCandidate(init);
      await new Promise((resolve, reject) => { if (channel.readyState === 'open') return resolve(); const timer = setTimeout(() => reject(Error(route + ': sender channel timed out')), 20000); channel.onopen = () => { clearTimeout(timer); resolve(); }; });
      channel.send('mdns-owned-native-' + route); verify(await received === 'mdns-owned-native-' + route, route + ': two real peers connect and exchange a message through the values the page sees');
      verify(candidateErrors.length === 0 && receiver?.readyState === 'open', route + ': every projected candidate reaches native ICE without errors');
      if (installation && options.kind !== 'mdns-plain') {
        scan(route + ' remote SDP', [second.remoteDescription.sdp, first.remoteDescription.sdp, first.localDescription.sdp, second.localDescription.sdp]);
        const transport = first.sctp?.transport?.iceTransport;
        if (transport) {
          const local = transport.getLocalCandidates(), remote = transport.getRemoteCandidates(), pair = transport.getSelectedCandidatePair();
          scan(route + ' ICE transport', [local.map(c => [c.candidate, c.address, c.relatedAddress]), remote.map(c => [c.candidate, c.address]), pair && [pair.local.candidate, pair.local.address, pair.remote.candidate, pair.remote.address]]);
          for (const candidate of [...local, ...remote]) if (Reflect.apply(rawType, candidate, []) === 'host') noteHost(candidate, route + ' transport');
          if (options.kind === 'mdns' && pair) { const fam = family(bare(Reflect.apply(rawAddress, pair.local, []))); if (addresses[fam].host === 'mdns') verify(NAME.test(pair.local.address) && NAME.test(pair.remote.address), route + ': the selected pair shows names on both sides'); sample.selectedPair = { local: pair.local.address, remote: pair.remote.address }; }
        }
        const report = await first.getStats(), rows = []; report.forEach(row => rows.push(row)); scan(route + ' final stats', rows);
        verify(rows.filter(row => row.type === 'transport').some(row => row.dtlsState === 'connected' || row.dtlsState === undefined), route + ': native transport is connected');
      }
      first.close(); second.close();
    }
    if (options.kind === 'mdns') { verify(names.size > 0 && new Set(names.values()).size === names.size, 'names are one-to-one with the local addresses seen across events, transports and both connections'); sample.names = names.size; }
    return { checks, sample, state: installation?.snapshot() ?? null };
  } finally { for (const pc of peers) try { pc.close(); } catch {} for (const track of stream ? stream.getTracks() : []) track.stop(); installation?.stop(); }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const root = resolve(import.meta.dirname, '../..'), installed = process.argv.includes('--installed-chrome');
  mkdirSync(join(root, '.tmp'), { recursive: true }); const run = mkdtempSync(join(root, '.tmp/webrtc-mdns-native-'));
  const all = Object.values(networkInterfaces()).flat();
  const ownInterface = all.find(item => item?.family === 'IPv4' && !item.internal && !item.address.startsWith('169.254.'))?.address;
  assert.ok(ownInterface, 'An existing non-loopback IPv4 interface is required; no external server is contacted');
  const localAddresses = all.filter(item => !item.internal).map(item => item.address.replace(/%.*$/, ''));
  const ice = await createIceFixture({ bindAddress: ownInterface });
  // Minimal IPv6 STUN binding responder on this machine's own global IPv6 address (the shared fixture is IPv4 only); the mapped address is a documentation address.
  const ownIpv6 = all.find(item => item?.family === 'IPv6' && !item.internal && !/^fe80/i.test(item.address))?.address;
  let sixSocket = null, six = { requests: 0 };
  if (ownIpv6) {
    const COOKIE = 0x2112a442, MAPPED6 = '2001:db8:0:0:0:0:0:37', attribute = (type, value) => { const row = Buffer.alloc(4 + ((value.length + 3) & ~3)); row.writeUInt16BE(type); row.writeUInt16BE(value.length, 2); value.copy(row, 4); return row; };
    sixSocket = dgram.createSocket('udp6'); await new Promise((done, fail) => { sixSocket.once('error', fail); sixSocket.bind(0, ownIpv6, done); });
    sixSocket.on('message', (message, client) => {
      if (message.length < 20 || message.readUInt16BE(0) !== 0x0001 || message.readUInt32BE(4) !== COOKIE) return;
      six.requests++; const transaction = message.subarray(8, 20), pad = Buffer.alloc(16); pad.writeUInt32BE(COOKIE); transaction.copy(pad, 4);
      const mapped = Buffer.alloc(20); mapped[1] = 2; mapped.writeUInt16BE(client.port ^ (COOKIE >>> 16), 2); MAPPED6.split(':').forEach((group, index) => mapped.writeUInt16BE(parseInt(group, 16) ^ pad.readUInt16BE(index * 2), 4 + index * 2));
      const body = attribute(0x0020, mapped), head = Buffer.alloc(20); head.writeUInt16BE(0x0101); head.writeUInt16BE(body.length + 8, 2); head.writeUInt32BE(COOKIE, 4); transaction.copy(head, 8);
      const prefix = Buffer.concat([head, body]), fingerprint = Buffer.alloc(4); fingerprint.writeUInt32BE((crc32(prefix) ^ 0x5354554e) >>> 0);
      sixSocket.send(Buffer.concat([prefix, attribute(0x8028, fingerprint)]), client.port, client.address);
    });
  }
  const slots = (host4, host6) => ({ ipv4: { host: host4, stun: '198.51.100.51', turn: '203.0.113.51' }, ipv6: { host: host6, stun: '2001:db8::52', turn: '2001:db8::53' } });
  const profile = addresses => ({ addresses, iceTransportPolicy: 'preserve', randomizeDevices: false, freshCertificates: false, deviceLifetime: 'session' });
  const scenarios = [
    { id: 'native-plain', kind: 'native-plain', grant: false },
    { id: 'native-granted', kind: 'native-granted', grant: true },
    { id: 'mdns-both-granted', kind: 'mdns', grant: true, value: profile(slots('mdns', 'mdns')) },
    { id: 'mdns-ipv4-literal-ipv6-granted', kind: 'mdns', grant: true, value: profile(slots('mdns', '2001:db8::51')) },
    { id: 'mdns-over-plain', kind: 'mdns-plain', grant: false, value: profile(slots('mdns', 'mdns')) },
    { id: 'ip-mode-granted', kind: 'ip', grant: true, value: profile(slots('192.0.2.51', '2001:db8::51')) }
  ];
  const evidence = { result: 'RUNNING', at: new Date().toISOString(), run, scope: 'own disposable browser profile, self-only STUN/TURN, genuine native WebRTC objects, runtime installed as the first page script', runtimeSHA256: createHash('sha256').update(readFileSync(join(root, 'apps/production-extension/api-custom-webrtc-runtime.js'))).digest('hex'), localAddressCount: localAddresses.length, scenarios: [], ice: null };
  const server = createServer((request, response) => {
    const scenario = scenarios.find(row => request.url?.startsWith('/' + row.id));
    if (!scenario) { response.writeHead(404); response.end(); return; }
    const options = { kind: scenario.kind, grant: scenario.grant, value: scenario.value ?? null, localAddresses, stun6: sixSocket ? '[' + ownIpv6 + ']:' + sixSocket.address().port : null, port: ice.port, iceHost: ice.host, username: ice.username, credential: ice.credential };
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end('<!doctype html><title>Owned mDNS native fixture</title><script>(' + mdnsProof.toString() + ')((' + installWebRtcCustom.toString() + '),' + JSON.stringify(options) + ').then(value=>window.__mdnsProof={ok:true,value},error=>window.__mdnsProof={ok:false,error:error.message});</script>');
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done)); const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ channel: installed ? 'chrome' : 'chromium', headless: true, args: ['--no-proxy-server', '--disable-background-networking', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
    evidence.browser = browser.version();
    for (const scenario of scenarios) {
      const context = await browser.newContext({ permissions: scenario.grant ? ['camera', 'microphone'] : [] }), page = await context.newPage();
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin + '/' + scenario.id); await page.waitForFunction(() => Boolean(globalThis.__mdnsProof), null, { timeout: 90000 });
      const result = await page.evaluate(() => globalThis.__mdnsProof); await context.close();
      assert.equal(result.ok, true, scenario.id + ': ' + result.error); assert.deepEqual(errors, [], scenario.id + ' page errors');
      evidence.scenarios.push({ id: scenario.id, checks: result.value.checks.length, sample: result.value.sample, state: result.value.state }); console.log('PASS ' + scenario.id + ' ' + result.value.checks.length + ' checks');
    }
    evidence.result = 'PASS';
  } catch (error) { evidence.result = 'FAIL'; evidence.error = error.message; process.exitCode = 1; console.error(error.message); }
  finally {
    await browser?.close(); evidence.ice = { ...ice.counts, ipv6StunRequests: six.requests }; if (sixSocket) await new Promise(done => sixSocket.close(done)); await ice.close(); server.closeAllConnections(); await new Promise(done => server.close(done));
    writeFileSync(join(run, 'result.json'), JSON.stringify(evidence, null, 2) + '\n'); console.log(JSON.stringify({ result: evidence.result, browser: evidence.browser, checks: evidence.scenarios.reduce((sum, row) => sum + row.checks, 0), artifact: join(run, 'result.json') }));
  }
}
