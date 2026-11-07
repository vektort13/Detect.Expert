// D-network-webrtc-1: Chrome hides host IPs behind uuid.local, one candidate per address family. The Custom projection must
// take the family from the native ICE priority (libwebrtc local preference low byte = address precedence), never from a
// blind IPv4-first fallback. D-network-webrtc-4: a page-edited projected SDP must still reach the native side with the
// native candidate lines.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installWebRtcCustom } from '../../apps/production-extension/api-custom-webrtc-runtime.js';

// priority = typePreference << 24 | (networkPreference << 8 | addressPrecedence) << 8 | (256 - component)
const prio = (typePreference, precedence, component = 1, networkPreference = 0) => ((typePreference << 24) | (networkPreference << 16) | (precedence << 8) | (256 - component)) >>> 0;
const P4 = prio(126, 30), P6 = prio(126, 40), TCP4 = prio(90, 30), TCP6 = prio(90, 40), SRFLX4 = prio(100, 30);
const mdns4 = 'f5bf66ba-3161-4ee3-b05a-bf10b27f64c9.local', mdns6 = '83771fdc-ee57-49f1-8e00-84b791941256.local';
const tail = ' generation 0 ufrag Vpub network-cost 999';
const line = (foundation, priority, address, port, { type = 'host', protocol = 'udp', extra = tail } = {}) => `candidate:${foundation} 1 ${protocol} ${priority} ${address} ${port} typ ${type}${extra}`;
const native4 = line('974469266', P4, mdns4, 64613), native6 = line('2625887522', P6, mdns6, 64614);
const nativeSdp = ['v=0', 'o=- 6956508506318954306 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0', 'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
  'a=' + native4, 'a=' + native6, 'a=ice-ufrag:Vpub', 'a=ice-pwd:0123456789abcdef0123456789', 'a=fingerprint:sha-256 AA:BB:CC:DD', 'a=setup:actpass', 'a=mid:0', 'a=sctp-port:5000', ''].join('\r\n');
const none = () => ({ host: null, stun: null, turn: null });
const profile = ({ v4 = '192.0.2.10', v6 = '2001:db8::10' } = {}) => ({
  addresses: { ipv4: v4 ? { host: v4, stun: '198.51.100.20', turn: '203.0.113.30' } : none(), ipv6: v6 ? { host: v6, stun: '2001:db8::20', turn: '2001:db8::30' } : none() },
  iceTransportPolicy: 'preserve', randomizeDevices: false, freshCertificates: false, deviceLifetime: 'session'
});
const nativeStat = (id, candidateType, protocol, address, port, priority, foundation) => ({ id, type: 'local-candidate', transportId: 'T', isRemote: false, candidateType, protocol, address, ip: address, port, priority, foundation, networkType: 'unknown' });
const nativeStats = () => [
  nativeStat('L4', 'host', 'udp', '', 64613, P4, '974469266'), nativeStat('L6', 'host', 'udp', '', 64614, P6, '2625887522'),
  nativeStat('T4', 'host', 'tcp', '', 9, TCP4, '11'), nativeStat('T6', 'host', 'tcp', '', 9, TCP6, '12'),
  nativeStat('S4', 'srflx', 'udp', '203.0.113.77', 64613, SRFLX4, '13'),
  { id: 'pair', type: 'candidate-pair', transportId: 'T', localCandidateId: 'L4', remoteCandidateId: 'S4', state: 'succeeded', bytesSent: 9 }
];

function fixture(value = profile(), { sdp = nativeSdp } = {}) {
  const raw = new WeakMap(), connections = new WeakMap(), calls = [], brand = new TypeError('NATIVE_BRAND');
  const checked = receiver => { const row = raw.get(receiver); if (!row) throw brand; return row; };
  const checkedPc = receiver => { const row = connections.get(receiver); if (!row) throw brand; return row; };
  class RTCIceCandidate {
    constructor(init = {}) {
      const text = init.candidate ?? '', parts = text.split(' ');
      raw.set(this, { candidate: text, type: parts[7] ?? null, address: parts[4] ?? null, priority: parts[3] === undefined ? null : Number(parts[3]), foundation: parts[0]?.replace('candidate:', '') ?? null });
    }
    get candidate() { return checked(this).candidate; }
    get type() { return checked(this).type; }
    get address() { return checked(this).address; }
    get relatedAddress() { checked(this); return null; }
    get foundation() { return checked(this).foundation; }
    get priority() { return checked(this).priority; }
    toJSON() { return { candidate: checked(this).candidate, sdpMid: '0', sdpMLineIndex: 0, usernameFragment: 'Vpub' }; }
  }
  class RTCSessionDescription {
    constructor(init) { raw.set(this, { type: init.type, sdp: init.sdp }); }
    get type() { return checked(this).type; }
    get sdp() { return checked(this).sdp; }
    toJSON() { return { ...checked(this) }; }
  }
  class RTCPeerConnection {
    constructor() { connections.set(this, {}); }
    createOffer() { checkedPc(this); calls.push(['offer']); return Promise.resolve({ type: 'offer', sdp }); }
    createAnswer() { checkedPc(this); calls.push(['answer']); return Promise.resolve({ type: 'answer', sdp }); }
    setLocalDescription(init) { const type = init.type, text = init.sdp; checkedPc(this).local = { type, sdp: text }; calls.push(['local', text]); return Promise.resolve(); }
    setRemoteDescription(init) { const type = init.type, text = init.sdp; checkedPc(this).remote = { type, sdp: text }; calls.push(['remote', text]); return Promise.resolve(); }
    addIceCandidate(init) { checkedPc(this); calls.push(['candidate', init.candidate]); return Promise.resolve(); }
    get localDescription() { const row = checkedPc(this).local; return row ? new RTCSessionDescription(row) : null; }
    getStats() { checkedPc(this); calls.push(['stats']); return Promise.resolve(new Map(nativeStats().map(row => [row.id, row]))); }
  }
  const realm = { Object, Array, Promise, RTCPeerConnection, webkitRTCPeerConnection: RTCPeerConnection, mozRTCPeerConnection: RTCPeerConnection, RTCIceCandidate, RTCSessionDescription, DOMException };
  const installation = installWebRtcCustom(realm, [{ id: 'webrtc', mode: 'custom', value }]);
  return { realm, installation, calls, candidate: text => new realm.RTCIceCandidate({ candidate: text }) };
}
const candidateLines = text => text.split(/\r?\n/).filter(row => row.startsWith('a=candidate:'));
const received = (f, kind) => f.calls.filter(row => row[0] === kind).map(row => row[1]);
const hostStats = async f => [...(await new f.realm.RTCPeerConnection().getStats()).values()].filter(row => row.type === 'local-candidate' && row.candidateType === 'host');

test('live priorities: Chromium 153 reports IPv4 host 2113937151 and IPv6 host 2113939711 (precedence 30 and 40)', () => {
  assert.equal(P4, 2113937151); assert.equal(P6, 2113939711);
  assert.equal(prio(126, 30, 1, 127), 2122260223, 'older Chrome keeps the precedence in the same byte under another NIC preference');
  assert.equal(prio(126, 40, 1, 127), 2122262783);
});

test('D-1: mDNS host candidates take ipv4.host / ipv6.host from the ICE priority (text, getters, toJSON, foundation)', () => {
  const f = fixture(), c4 = f.candidate(native4), c6 = f.candidate(native6);
  assert.equal(c4.address, '192.0.2.10'); assert.equal(c6.address, '2001:db8::10');
  assert.equal(c4.candidate, line(c4.foundation, P4, '192.0.2.10', 64613)); assert.equal(c6.candidate, line(c6.foundation, P6, '2001:db8::10', 64614));
  assert.notEqual(c4.foundation, c6.foundation, 'two different addresses cannot share a foundation');
  assert.equal(c4.foundation, f.candidate(line('x', P4, '10.9.8.7', 1)).foundation, 'same foundation as a literal IPv4 host candidate');
  assert.equal(c6.foundation, f.candidate(line('x', P6, 'fd00::7', 1)).foundation, 'same foundation as a literal IPv6 host candidate');
  assert.equal(f.realm.RTCIceCandidate.prototype.toJSON.call(c4).candidate, c4.candidate); assert.equal(f.realm.RTCIceCandidate.prototype.toJSON.call(c6).candidate, c6.candidate);
  assert.equal(c4.priority, P4); assert.equal(c6.priority, P6);
  assert.equal(JSON.stringify([c4.candidate, c6.candidate, c4.address, c6.address]).includes('.local'), false);
});

test('D-1: createOffer SDP projects each mDNS family to its own host and the native setter still receives the original', async () => {
  const f = fixture(), pc = new f.realm.RTCPeerConnection(), offer = await pc.createOffer();
  const [x4, x6] = candidateLines(offer.sdp).map(row => row.split(' '));
  assert.equal(candidateLines(offer.sdp).length, 2);
  assert.equal(x4[4], '192.0.2.10'); assert.equal(x4[5], '64613'); assert.equal(x6[4], '2001:db8::10'); assert.equal(x6[5], '64614');
  assert.notEqual(x4[0], x6[0]); assert.equal(x4[3], String(P4)); assert.equal(x6[3], String(P6));
  assert.equal(offer.sdp.includes('.local'), false);
  await pc.setLocalDescription(offer); assert.deepEqual(received(f, 'local'), [nativeSdp]);
  assert.equal(pc.localDescription.sdp, offer.sdp);
});

test('D-1: an unconfigured family hides the mDNS candidate of that family instead of borrowing the other family', async () => {
  const v4only = fixture(profile({ v6: null })), v6only = fixture(profile({ v4: null }));
  const a = v4only.candidate(native4), b = v4only.candidate(native6);
  assert.equal(a.address, '192.0.2.10'); assert.notEqual(a.candidate, '');
  assert.equal(b.candidate, ''); assert.equal(b.address, null); assert.equal(b.foundation, ''); assert.equal(b.toJSON().candidate, '');
  const c = v6only.candidate(native4), d = v6only.candidate(native6);
  assert.equal(c.candidate, ''); assert.equal(c.address, null); assert.equal(c.foundation, ''); assert.equal(c.toJSON().candidate, '');
  assert.equal(d.address, '2001:db8::10'); assert.notEqual(d.candidate, '');
  const sdp4 = candidateLines((await new v4only.realm.RTCPeerConnection().createOffer()).sdp), sdp6 = candidateLines((await new v6only.realm.RTCPeerConnection().createOffer()).sdp);
  assert.equal(sdp4.length, 1); assert.equal(sdp4[0].split(' ')[4], '192.0.2.10'); assert.equal(sdp4[0].split(' ')[5], '64613');
  assert.equal(sdp6.length, 1); assert.equal(sdp6[0].split(' ')[4], '2001:db8::10'); assert.equal(sdp6[0].split(' ')[5], '64614');
});

test('D-1: stats rows with hidden addresses agree with the candidate projection (address, ip, foundation, TCP rows)', async () => {
  const f = fixture(), c4 = f.candidate(native4), c6 = f.candidate(native6), pc = new f.realm.RTCPeerConnection();
  const rows = [...(await pc.getStats()).values()].filter(row => row.type === 'local-candidate'), byPriority = (rows2, priority) => rows2.find(row => row.priority === priority);
  for (const [priority, address, foundation] of [[P4, '192.0.2.10', c4.foundation], [TCP4, '192.0.2.10', c4.foundation], [P6, '2001:db8::10', c6.foundation], [TCP6, '2001:db8::10', c6.foundation]]) {
    const row = byPriority(rows, priority);
    assert.equal(row.address, address, 'address ' + priority); assert.equal(row.ip, address, 'ip ' + priority); assert.equal(row.foundation, foundation, 'foundation ' + priority);
  }
  assert.equal(byPriority(rows, SRFLX4).address, '198.51.100.20', 'srflx literal rows keep their literal family');
  const v4only = await hostStats(fixture(profile({ v6: null })));
  assert.deepEqual([P4, P6, TCP4, TCP6].map(priority => byPriority(v4only, priority).address), ['192.0.2.10', null, '192.0.2.10', null]);
  assert.deepEqual([P6, TCP6].map(priority => byPriority(v4only, priority).foundation), ['', '']);
  const v6only = await hostStats(fixture(profile({ v4: null })));
  assert.deepEqual([P4, P6, TCP4, TCP6].map(priority => byPriority(v6only, priority).address), [null, '2001:db8::10', null, '2001:db8::10']);
  assert.deepEqual([P4, TCP4].map(priority => byPriority(v6only, priority).ip), [null, null]);
});

test('D-1: address precedence decides the family (IPv4 30; every other libwebrtc IPv6 class 1..60) whatever the NIC preference', () => {
  const f = fixture();
  for (const [precedence, expected] of [[30, '192.0.2.10'], [40, '2001:db8::10'], [50, '2001:db8::10'], [60, '2001:db8::10'], [20, '2001:db8::10'], [10, '2001:db8::10'], [1, '2001:db8::10']]) {
    for (const nic of [0, 127, 255]) {
      const candidate = f.candidate(line('7', prio(126, precedence, 1, nic), mdns4, 1));
      assert.equal(candidate.address, expected, `precedence ${precedence}, NIC ${nic}`);
      assert.equal(candidate.candidate.split(' ')[4], expected);
    }
  }
  assert.equal(f.candidate(line('7', prio(126, 40, 2), mdns4, 1)).address, '2001:db8::10', 'component 2 only changes the lowest byte');
  assert.equal(f.candidate(line('7', prio(90, 30), mdns4, 9, { protocol: 'tcp', extra: ' tcptype active' })).address, '192.0.2.10', 'TCP host type preference does not matter');
});

test('D-1: non-mDNS and unknown encodings keep the legacy behaviour (literal family wins, otherwise IPv4-first)', () => {
  const both = fixture(), v6only = fixture(profile({ v4: null }));
  assert.equal(both.candidate(line('1', P4, 'fd00::7', 5)).address, '2001:db8::10', 'literal IPv6 stays IPv6 even with an IPv4-looking priority');
  assert.equal(both.candidate(line('1', P6, '10.1.2.3', 5)).address, '192.0.2.10', 'literal IPv4 stays IPv4 even with an IPv6-looking priority');
  const firefox = line('0', 2122252543, mdns6, 62456, { extra: '' });
  assert.equal(both.candidate(firefox).address, '192.0.2.10', 'unknown precedence 0 (Firefox) keeps IPv4-first');
  assert.equal(v6only.candidate(firefox).address, '2001:db8::10', 'and falls back to the configured family');
  assert.equal(both.candidate(line('1', P6, 'peer.example', 5)).address, '192.0.2.10', 'a non-mDNS host name is not an mDNS candidate');
  assert.equal(both.candidate(line('1', P6, mdns6, 5, { type: 'srflx', extra: '' })).address, '198.51.100.20', 'only host candidates are mDNS-masked');
  for (const priority of ['abc', '99999999999', '-1']) assert.equal(both.candidate(line('1', priority, mdns6, 5)).address, '192.0.2.10', `malformed priority ${priority}`);
});

test('D-4: a page-edited projected SDP reaches the native side with the native candidate lines (append, reorder, LF, inserted line)', async () => {
  const f = fixture(), pc = new f.realm.RTCPeerConnection(), offer = await pc.createOffer();
  const projected = offer.sdp.split('\r\n'), [i4, i6] = projected.map((row, index) => row.startsWith('a=candidate:') ? index : -1).filter(index => index >= 0);
  const restoreMap = new Map([[projected[i4], 'a=' + native4], [projected[i6], 'a=' + native6]]);
  const expectLines = (edited, nativeText) => assert.deepEqual(nativeText.split(/\r?\n/), edited.split(/\r?\n/).map(row => restoreMap.get(row) ?? row));
  const appended = offer.sdp.replace(/\r\n$/, '') + '\r\na=x-note:1\r\n';
  const swapped = projected.slice(); [swapped[i4], swapped[i6]] = [projected[i6], projected[i4]];
  const [fingerprint] = swapped.splice(swapped.indexOf('a=fingerprint:sha-256 AA:BB:CC:DD'), 1); swapped.splice(1, 0, fingerprint);
  const reordered = swapped.join('\r\n') + 'a=x-end:1\r\n';
  const withLf = offer.sdp.replaceAll('\r\n', '\n') + 'a=x-lf:1\n';
  const inserted = offer.sdp.replace('a=setup:actpass', 'a=setup:actpass\r\nb=AS:64\r\na=fmtp:111 minptime=10;useinbandfec=1');
  for (const edited of [appended, reordered, withLf, inserted]) {
    await pc.setLocalDescription({ type: 'offer', sdp: edited }); await pc.setRemoteDescription({ type: 'answer', sdp: edited });
    const local = received(f, 'local').at(-1), remote = received(f, 'remote').at(-1);
    expectLines(edited, local); expectLines(edited, remote);
    assert.ok(local.includes('a=' + native4) && local.includes('a=' + native6));
    assert.equal(candidateLines(local).some(row => row.includes('192.0.2.10') || row.includes('2001:db8::10')), false);
  }
  assert.equal(received(f, 'local').length, 4); assert.equal(received(f, 'remote').length, 4);
  assert.ok(received(f, 'local')[0].includes('a=x-note:1')); assert.ok(received(f, 'local')[1].includes('a=x-end:1'));
  assert.ok(received(f, 'local')[2].includes('a=x-lf:1')); assert.ok(received(f, 'local')[3].includes('b=AS:64'));
});

test('D-4: re-reading an already projected description or candidate never erases its native inverse', async () => {
  const f = fixture(), pc = new f.realm.RTCPeerConnection(), offer = await pc.createOffer();
  const copy = new f.realm.RTCSessionDescription({ type: 'offer', sdp: offer.sdp }), reread = copy.sdp;
  assert.equal(reread, offer.sdp, 'projection of a projected SDP is idempotent');
  await pc.setRemoteDescription({ type: 'offer', sdp: reread }); assert.equal(received(f, 'remote').at(-1), nativeSdp, 'whole-string inverse survives the re-read');
  const munged = reread.replace('a=setup:actpass', 'a=setup:actpass\r\nb=AS:64');
  await pc.setRemoteDescription({ type: 'offer', sdp: munged });
  assert.deepEqual(candidateLines(received(f, 'remote').at(-1)), ['a=' + native4, 'a=' + native6], 'per-line inverse survives the re-read');
  const projectedCandidate = f.candidate(native4).candidate; assert.notEqual(projectedCandidate, native4);
  assert.equal(f.candidate(projectedCandidate).candidate, projectedCandidate, 'idempotent candidate projection');
  await pc.addIceCandidate({ candidate: projectedCandidate }); assert.equal(received(f, 'candidate').at(-1), native4);
});

test('D-4: nothing to restore, oversized or over-long SDP stays exactly as the page wrote it; other values are never coerced', async () => {
  const f = fixture(), pc = new f.realm.RTCPeerConnection(), offer = await pc.createOffer();
  const authored = ['v=0', 'o=- 1 1 IN IP4 203.0.113.9', 's=-', 't=0 0', 'a=candidate:5 1 udp 2113937151 203.0.113.9 4000 typ host', 'a=fingerprint:sha-256 AA:BB', ''].join('\r\n');
  await pc.setRemoteDescription({ type: 'offer', sdp: authored }); assert.equal(received(f, 'remote').at(-1), authored);
  const huge = offer.sdp + 'a=x-pad:' + 'x'.repeat(70000) + '\r\n', many = offer.sdp + Array.from({ length: 1100 }, () => 'a=x-line:1').join('\r\n') + '\r\n';
  await pc.setLocalDescription({ type: 'offer', sdp: huge }); assert.equal(received(f, 'local').at(-1), huge);
  await pc.setLocalDescription({ type: 'offer', sdp: many }); assert.equal(received(f, 'local').at(-1), many);
  await pc.setLocalDescription({ type: 'offer', sdp: 'noise\r\n' + offer.sdp });
  assert.deepEqual(candidateLines(received(f, 'local').at(-1)), ['a=' + native4, 'a=' + native6], 'a candidate line is restored wherever it sits');
  const object = { toString() { throw new Error('coerced'); }, valueOf() { throw new Error('coerced'); } };
  await pc.setLocalDescription({ type: 'offer', sdp: object }); assert.equal(received(f, 'local').at(-1), object);
});

test('D-4: a page-poisoned RegExp split cannot make the restore path throw into the native call', async () => {
  const f = fixture(), pc = new f.realm.RTCPeerConnection(), offer = await pc.createOffer(), edited = offer.sdp + 'a=x-note:1\r\n';
  const previous = Object.getOwnPropertyDescriptor(RegExp.prototype, Symbol.split);
  try {
    Object.defineProperty(RegExp.prototype, Symbol.split, { ...previous, value() { throw new Error('PAGE_SPLIT'); } });
    await pc.setLocalDescription({ type: 'offer', sdp: edited });
  } finally { Object.defineProperty(RegExp.prototype, Symbol.split, previous); }
  assert.equal(received(f, 'local').at(-1), edited, 'unrestorable value is forwarded as the page wrote it, not turned into an exception');
});
