// Catalog 8 WebRTC host mode `mdns` (owner request 2026-11-05). A family host slot holding the literal "mdns" shows the shape Chrome produces
// without a camera/microphone grant: host candidates carry a random <uuid>.local name, one stable name per original local address and document,
// even when the browser would expose real addresses (grant present). Native shapes measured live in Chromium 153.0.8010.12 (this machine):
//   granted : candidate:<f> 1 udp 2122194687 <ip> 49339 typ host generation 0 network-id 2 network-cost 50   (IPv6 address getter: "[ip]")
//             srflx ... raddr <base ip> rport <base port>; relay ... raddr 0.0.0.0 rport 0; stats rows carry the real address
//   plain   : candidate:<f> 1 udp 2113937151 <uuid>.local 54738 typ host generation 0 network-cost 999; srflx raddr 0.0.0.0 rport 0;
//             stats host rows address "" / ip "" (TCP rows too), srflx rows without relatedAddress / relatedPort; c=IN IP4 0.0.0.0 before gathering
// The runtime under test comes from WEBRTC_MDNS_RUNTIME when the deliberate-breakage harness sets it.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';

const runtimeUrl = process.env.WEBRTC_MDNS_RUNTIME ? pathToFileURL(process.env.WEBRTC_MDNS_RUNTIME).href : new URL('../../apps/production-extension/api-custom-webrtc-runtime.js', import.meta.url).href;
const { installWebRtcCustom } = await import(runtimeUrl);

const prio = (typePreference, precedence, component = 1, networkPreference = 0) => ((typePreference << 24) | (networkPreference << 16) | (precedence << 8) | (256 - component)) >>> 0;
const NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.local$/;
// Independent UUIDv4 spelling for a random source that fills every byte with n.
const uuid = n => { const b = new Array(16).fill(n); b[6] = b[6] & 15 | 64; b[8] = b[8] & 63 | 128; const h = b.map(x => x.toString(16).padStart(2, '0')).join(''); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}.local`; };
const none = () => ({ host: null, stun: null, turn: null });
const V4 = { host: '192.0.2.10', stun: '198.51.100.20', turn: '203.0.113.30' }, V6 = { host: '2001:db8::10', stun: '2001:db8::20', turn: '2001:db8::30' };
const profile = (ipv4, ipv6, extra = {}) => ({ addresses: { ipv4: ipv4 ?? none(), ipv6: ipv6 ?? none() }, iceTransportPolicy: 'preserve', randomizeDevices: false, freshCertificates: false, deviceLifetime: 'session', ...extra });
const MD4 = { ...V4, host: 'mdns' }, MD6 = { ...V6, host: 'mdns' };
const BOTH = profile(MD4, MD6);

// Real-looking local addresses of the granted state. Documentation / benchmark ranges stand in for the machine's own addresses.
const A4 = '198.18.0.41', B4 = '192.168.56.1', L4 = '169.254.106.179', A6 = '2001:db8:aaaa:1::41', ULA6 = 'fd12:3456:789a::41', LL6 = 'fe80::6cc7:27bb:837b:47ab';
const REAL = [A4, B4, L4, A6, ULA6, LL6, '198.51.100.77', '2001:db8:ffff::77'];
const P = { a4: prio(126, 30, 1, 126), b4: prio(126, 30, 1, 125), l4: prio(126, 30, 1, 124), a6: prio(126, 40, 1, 127), t4: prio(90, 30, 1, 126), t6: prio(90, 40, 1, 127), s4: prio(100, 30, 1, 126), s6: prio(100, 40, 1, 127), relay: prio(2, 30, 1, 126) };
const tail = ' generation 0 network-id 2 network-cost 50';
const line = (foundation, priority, address, port, { type = 'host', protocol = 'udp', extra = tail } = {}) => `candidate:${foundation} 1 ${protocol} ${priority} ${address} ${port} typ ${type}${extra}`;
const N = {
  a4: line('2924424768', P.a4, A4, 49339), b4: line('2627196055', P.b4, B4, 49340), l4: line('1959664773', P.l4, L4, 49341), a6: line('2231237093', P.a6, A6, 49342),
  t4: line('3498101976', P.t4, A4, 9, { protocol: 'tcp', extra: ' tcptype active' + tail }), t6: line('4197587837', P.t6, A6, 9, { protocol: 'tcp', extra: ' tcptype active' + tail }),
  s4: line('2335629738', P.s4, '198.51.100.77', 49339, { type: 'srflx', extra: ` raddr ${A4} rport 49339` + tail }),
  s6: line('1111111111', P.s6, '2001:db8:ffff::77', 49400, { type: 'srflx', extra: ` raddr ${A6} rport 49342` + tail }),
  p4: line('3333333333', P.s4, '198.51.100.78', 49339, { type: 'prflx', extra: ` raddr ${A4} rport 49339` + tail }),
  relay: line('719142638', P.relay, '203.0.113.9', 49601, { type: 'relay', extra: ' raddr 0.0.0.0 rport 0' + tail }),
  relayReal: line('719142639', P.relay, '203.0.113.9', 49602, { type: 'relay', extra: ` raddr ${'198.51.100.77'} rport 49339` + tail })
};
const uuid4 = 'f5bf66ba-3161-4ee3-b05a-bf10b27f64c9.local', uuid6 = '83771fdc-ee57-49f1-8e00-84b791941256.local';
const plainTail = ' generation 0 ufrag Vpub network-cost 999';
const PLAIN = { h4: line('974469266', prio(126, 30), uuid4, 64613, { extra: plainTail }), h6: line('2625887522', prio(126, 40), uuid6, 64614, { extra: plainTail }),
  s4: line('80548759', prio(100, 30), '198.51.100.37', 64613, { type: 'srflx', extra: ' raddr 0.0.0.0 rport 0' + plainTail }) };

const sdpOf = ({ c = 'IN IP4 0.0.0.0', rows = [] } = {}) => ['v=0', 'o=- 2891203517481301726 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0', 'm=audio 54322 UDP/TLS/RTP/SAVPF 111', 'c=' + c,
  'a=rtcp:9 IN IP4 0.0.0.0', ...rows.map(row => 'a=' + row), 'a=ice-ufrag:Vpub', 'a=ice-pwd:0123456789abcdef0123456789', 'a=fingerprint:sha-256 AA:BB:CC:DD', 'a=setup:actpass', 'a=mid:0', ''].join('\r\n');
const GRANTED_SDP = sdpOf({ c: 'IN IP4 ' + A4, rows: [N.a4, N.b4, N.l4, N.a6, N.s4, N.t4, N.t6] });
const stat = (id, candidateType, protocol, address, port, priority, foundation, extra = {}) => ({ id, type: 'local-candidate', transportId: 'T01', isRemote: false, candidateType, protocol, address, ip: address, port, priority, foundation, networkType: 'ethernet', ...extra });
const grantedStats = () => [stat('L4', 'host', 'udp', A4, 49339, P.a4, '2924424768'), stat('L4b', 'host', 'udp', B4, 49340, P.b4, '2627196055'), stat('L6', 'host', 'udp', A6, 49342, P.a6, '2231237093'),
  stat('T4', 'host', 'tcp', A4, 9, P.t4, '3498101976', { tcpType: 'active' }), stat('T6', 'host', 'tcp', A6, 9, P.t6, '4197587837', { tcpType: 'active' }),
  stat('S4', 'srflx', 'udp', '198.51.100.77', 49339, P.s4, '2335629738', { relatedAddress: A4, relatedPort: 49339, url: 'stun:203.0.113.5:3478' }),
  { id: 'pair', type: 'candidate-pair', transportId: 'T01', localCandidateId: 'L4', remoteCandidateId: 'S4', state: 'succeeded', bytesSent: 9 }];

// Deterministic random source: the n-th request fills every byte with n. Brand check like the native Crypto.
function randomSource(first = 1) {
  const calls = []; let next = first;
  class Crypto { getRandomValues(array) { if (!(this instanceof Crypto)) throw new TypeError('Illegal invocation'); calls.push(array.length); array.fill(next++); return array; } }
  return { crypto: new Crypto(), calls };
}

function fixture(value = BOTH, { sdp = GRANTED_SDP, stats = grantedStats, random = randomSource(), installer = installWebRtcCustom, withCrypto = true, extraRealm = {} } = {}) {
  const raw = new WeakMap(), connections = new WeakMap(), calls = [], brand = new TypeError('NATIVE_BRAND');
  const checked = receiver => { const row = raw.get(receiver); if (!row) throw brand; return row; };
  const checkedPc = receiver => { const row = connections.get(receiver); if (!row) throw brand; return row; };
  // Chrome 153 reports an IPv6 candidate address in brackets through the address getter (measured), the candidate text without.
  const bracket = address => address !== null && address !== undefined && address.includes(':') ? '[' + address + ']' : address;
  class RTCIceCandidate {
    constructor(init = {}) {
      const text = init.candidate ?? '', parts = text.split(' '), related = parts.indexOf('raddr'), port = parts.indexOf('rport');
      raw.set(this, { candidate: text, type: parts[7] ?? null, address: bracket(parts[4] ?? null), port: Number(parts[5]), protocol: parts[2] ?? null, priority: parts[3] === undefined ? null : Number(parts[3]),
        relatedAddress: related < 0 ? null : bracket(parts[related + 1]), relatedPort: port < 0 ? null : Number(parts[port + 1]), foundation: parts[0]?.replace(/^(a=)?candidate:/, '') ?? null });
    }
    get candidate() { return checked(this).candidate; }
    get type() { return checked(this).type; }
    get address() { return checked(this).address; }
    get port() { return checked(this).port; }
    get protocol() { return checked(this).protocol; }
    get priority() { return checked(this).priority; }
    get relatedAddress() { return checked(this).relatedAddress; }
    get relatedPort() { return checked(this).relatedPort; }
    get foundation() { return checked(this).foundation; }
    toJSON() { return { candidate: checked(this).candidate, sdpMid: '0', sdpMLineIndex: 0, usernameFragment: 'Vpub' }; }
  }
  class RTCSessionDescription {
    constructor(init) { raw.set(this, { type: init.type, sdp: init.sdp }); }
    get type() { return checked(this).type; }
    get sdp() { return checked(this).sdp; }
    toJSON() { return { ...checked(this) }; }
  }
  class RTCIceTransport {
    getLocalCandidates() { return [new RTCIceCandidate({ candidate: N.a4 }), new RTCIceCandidate({ candidate: N.a6 })]; }
    getRemoteCandidates() { return [new RTCIceCandidate({ candidate: N.s4 })]; }
    getSelectedCandidatePair() { return { local: new RTCIceCandidate({ candidate: N.a4 }), remote: new RTCIceCandidate({ candidate: N.s4 }) }; }
  }
  class RTCPeerConnection {
    constructor() { connections.set(this, {}); }
    createOffer() { checkedPc(this); calls.push(['offer']); return Promise.resolve({ type: 'offer', sdp }); }
    createAnswer() { checkedPc(this); calls.push(['answer']); return Promise.resolve({ type: 'answer', sdp }); }
    setLocalDescription(init) { checkedPc(this).local = { type: init.type, sdp: init.sdp }; calls.push(['local', init.sdp]); return Promise.resolve(); }
    setRemoteDescription(init) { checkedPc(this).remote = { type: init.type, sdp: init.sdp }; calls.push(['remote', init.sdp]); return Promise.resolve(); }
    addIceCandidate(init) { checkedPc(this); calls.push(['candidate', init.candidate]); return Promise.resolve(); }
    get localDescription() { const row = checkedPc(this).local; return row ? new RTCSessionDescription(row) : null; }
    get currentLocalDescription() { return this.localDescription; }
    get pendingLocalDescription() { return this.localDescription; }
    get remoteDescription() { const row = checkedPc(this).remote; return row ? new RTCSessionDescription(row) : null; }
    get currentRemoteDescription() { return this.remoteDescription; }
    get pendingRemoteDescription() { return this.remoteDescription; }
    getStats() { checkedPc(this); calls.push(['stats']); return Promise.resolve(new Map(stats().map(row => [row.id, { ...row }]))); }
  }
  class RTCPeerConnectionIceErrorEvent {
    constructor(address) { raw.set(this, { address }); }
    get address() { return checked(this).address; }
  }
  const realm = { Object, Array, Promise, RTCPeerConnection, webkitRTCPeerConnection: RTCPeerConnection, mozRTCPeerConnection: RTCPeerConnection, RTCIceCandidate, RTCSessionDescription, RTCIceTransport,
    RTCPeerConnectionIceErrorEvent, DOMException, ...(withCrypto ? { crypto: random.crypto } : {}), ...extraRealm };
  const nativeRelatedPort = Object.getOwnPropertyDescriptor(RTCIceCandidate.prototype, 'relatedPort').get;
  const installation = installer(realm, [{ id: 'webrtc', mode: 'custom', value }]);
  return { realm, installation, calls, random, brand, nativeRelatedPort, candidate: text => new realm.RTCIceCandidate({ candidate: text }), pc: () => new realm.RTCPeerConnection(), error: address => new realm.RTCPeerConnectionIceErrorEvent(address) };
}
const received = (f, kind) => f.calls.filter(row => row[0] === kind).map(row => row[1]);
const lines = (text, prefix) => text.split(/\r?\n/).filter(row => row.startsWith(prefix));
const field = (text, index) => text.split(' ')[index];
const everything = value => JSON.stringify(value);
const noReal = (value, label = '') => { const text = typeof value === 'string' ? value : everything(value); for (const address of REAL) assert.equal(text.toLowerCase().includes(address.toLowerCase()), false, `${label} leaks ${address}`); };
// The minimal fake realm has no RTCRtpSender / RTCRtpReceiver: that many hooks are unavailable in every profile, mdns or not.
const BASELINE_UNAVAILABLE = fixture(profile(V4, V6)).installation.snapshot().unavailable;
async function statRows(f) { return [...(await f.pc().getStats()).values()]; }

test('names: lowercase UUIDv4 + .local from the captured random source, created lazily, one per original address, stable on every surface', () => {
  const f = fixture();
  assert.equal(f.random.calls.length, 0, 'installation draws nothing; names are made when the page first reads an address');
  const a = f.candidate(N.a4), b = f.candidate(N.b4), six = f.candidate(N.a6);
  assert.equal(a.address, uuid(1)); assert.equal(f.random.calls.length, 1); assert.deepEqual(f.random.calls, [16]);
  assert.equal(a.candidate.split(' ')[4], uuid(1), 'candidate text, address getter and toJSON share one name');
  assert.equal(f.realm.RTCIceCandidate.prototype.toJSON.call(a).candidate, a.candidate);
  assert.equal(a.address, uuid(1)); assert.equal(f.random.calls.length, 1, 'reading again never draws again');
  assert.equal(b.address, uuid(2)); assert.equal(six.address, uuid(3));
  assert.equal(f.candidate(N.t4).address, uuid(1), 'the TCP candidate of the same interface shows the same name');
  assert.equal(f.candidate(N.t6).address, uuid(3));
  assert.equal(f.candidate(N.a4).address, uuid(1), 'a second object for the same address shows the same name');
  assert.equal(f.random.calls.length, 3);
  for (const name of [a.address, b.address, six.address]) { assert.match(name, NAME); assert.equal(name, name.toLowerCase()); }
  assert.equal(new Set([a.address, b.address, six.address]).size, 3);
  assert.equal(six.address.includes(':'), false, 'the bracketed IPv6 spelling of the address getter never reaches the name');
});

test('names: bracket and case spellings of one IPv6 address share one name, the table key is the bare lowercase text', () => {
  const f = fixture();
  const upper = f.candidate(line('1', P.a6, A6.toUpperCase(), 1)), lower = f.candidate(line('2', P.a6, A6, 2));
  assert.equal(upper.address, lower.address); assert.equal(f.random.calls.length, 1);
  assert.equal(f.candidate(N.a6).address, lower.address, 'bracketed getter value of a native candidate maps to the same name as the text');
  assert.equal(f.candidate(N.a6).candidate.split(' ')[4], lower.address);
});

test('documents are independent: another installation draws other names; a real Web Crypto source yields valid random names', () => {
  const first = fixture(BOTH, { random: randomSource(1) }), second = fixture(BOTH, { random: randomSource(40) });
  assert.equal(first.candidate(N.a4).address, uuid(1)); assert.equal(second.candidate(N.a4).address, uuid(40));
  const live = fixture(BOTH, { withCrypto: false, extraRealm: { crypto: globalThis.crypto } }), other = fixture(BOTH, { withCrypto: false, extraRealm: { crypto: globalThis.crypto } });
  const x = live.candidate(N.a4).address, y = other.candidate(N.a4).address;
  assert.match(x, NAME); assert.match(y, NAME); assert.notEqual(x, y, 'two documents never share a name');
  assert.equal(live.candidate(N.a4).address, x);
});

test('the random source and helpers are captured at install: a page that patches crypto, typed arrays and strings afterwards changes nothing', () => {
  // The fake native objects are built before the page patches anything; only the lazy name drawing happens afterwards.
  const f = fixture(), c4 = f.candidate(N.a4), c6 = f.candidate(N.a6), cryptoPrototype = Object.getPrototypeOf(f.realm.crypto), saved = Object.getOwnPropertyDescriptor(cryptoPrototype, 'getRandomValues');
  const patched = [...['toLowerCase', 'charCodeAt', 'slice', 'indexOf', 'split'].map(key => [String.prototype, key]), [Array.prototype, 'join'], [Number.prototype, 'toString']].map(([target, key]) => [target, key, Object.getOwnPropertyDescriptor(target, key)]);
  const nativeUint8Array = globalThis.Uint8Array;
  let a, b, text, unavailable;
  try {
    Object.defineProperty(cryptoPrototype, 'getRandomValues', { ...saved, value() { throw new Error('PAGE_RANDOM'); } });
    f.realm.crypto.getRandomValues = () => { throw new Error('PAGE_RANDOM_OWN'); };
    for (const [target, key, descriptor] of patched) Object.defineProperty(target, key, { ...descriptor, value() { throw new Error('PAGE_' + String(key)); } });
    globalThis.Uint8Array = function PageArray() { throw new Error('PAGE_UINT8'); };
    a = c4.address; b = c6.address; text = c4.candidate; unavailable = f.installation.snapshot().unavailable;
  } finally {
    globalThis.Uint8Array = nativeUint8Array; Object.defineProperty(cryptoPrototype, 'getRandomValues', saved); delete f.realm.crypto.getRandomValues;
    for (const [target, key, descriptor] of patched) Object.defineProperty(target, key, descriptor);
  }
  assert.equal(a, uuid(1)); assert.equal(b, uuid(2)); assert.equal(text.split(' ')[4], uuid(1)); assert.equal(unavailable, BASELINE_UNAVAILABLE);
});

test('granted state, candidates: text, getters, toJSON and foundation show the name instead of the real address (UDP and TCP, IPv4 and IPv6)', () => {
  const f = fixture();
  for (const [key, address, name] of [['a4', A4, uuid(1)], ['b4', B4, uuid(2)], ['a6', A6, uuid(3)]]) {
    const c = f.candidate(N[key]), parts = c.candidate.split(' ');
    assert.equal(c.address, name, key); assert.equal(parts[4], name); assert.equal(c.toJSON().candidate, c.candidate);
    assert.equal(Object.getOwnPropertyDescriptor(f.realm.RTCIceCandidate.prototype, 'address').get.call(c), name, 'borrowed getter agrees');
    assert.equal(parts[3], String(Number(N[key].split(' ')[3])), 'priority stays native'); assert.equal(parts[2], 'udp'); assert.equal(parts[5], N[key].split(' ')[5]); assert.equal(parts[7], 'host');
    assert.equal(parts[0], 'candidate:' + c.foundation); assert.notEqual(c.foundation, N[key].split(' ')[0].replace('candidate:', ''), 'the foundation is re-derived from the shown name');
    assert.deepEqual(parts.slice(8), ['generation', '0', 'network-id', '2', 'network-cost', '50'].slice(0, parts.length - 8));
    assert.equal(c.candidate.includes(address), false, key);
  }
  assert.notEqual(f.candidate(N.a4).foundation, f.candidate(N.a6).foundation);
  assert.equal(f.candidate(N.t4).candidate.split(' ')[2], 'tcp'); assert.equal(f.candidate(N.t4).candidate.includes('tcptype active'), true);
  assert.equal(f.candidate('a=' + N.a4).candidate.startsWith('a=candidate:'), true, 'the SDP spelling keeps its a= prefix');
  assert.equal(f.candidate('a=' + N.a4).candidate.split(' ')[4], uuid(1));
});

test('granted state, SDP: candidate lines carry names; c= takes the placeholder, o= and a=rtcp keep Chrome spelling; the page never sees a real address', async () => {
  const f = fixture(), pc = f.pc(), offer = await pc.createOffer();
  noReal(offer.sdp, 'offer'); assert.equal(offer.sdp.includes('mdns'), false);
  const rows = lines(offer.sdp, 'a=candidate:'); assert.equal(rows.length, 7);
  // Lines are projected in order: A4, B4, link-local, A6 draw names 1-4; the srflx line follows the STUN role; the TCP lines reuse the names of their interfaces.
  assert.deepEqual(rows.map(row => field(row, 4)), [uuid(1), uuid(2), uuid(3), uuid(4), '198.51.100.20', uuid(1), uuid(4)]);
  assert.match(rows[0], new RegExp(' ' + uuid(1).replace('.', '\\.') + ' 49339 typ host'));
  assert.equal(offer.sdp.includes('\r\nc=IN IP4 0.0.0.0\r\n'), true, 'c= was the first host address and is now the placeholder'); assert.equal(offer.sdp.includes('c=IN IP4 ' + A4), false);
  assert.equal(offer.sdp.includes('o=- 2891203517481301726 2 IN IP4 127.0.0.1'), true); assert.equal(offer.sdp.includes('a=rtcp:9 IN IP4 0.0.0.0'), true);
  assert.equal(received(f, 'offer').length, 1);
  await pc.setLocalDescription(offer); assert.deepEqual(received(f, 'local'), [GRANTED_SDP], 'native receives the exact original SDP');
  for (const key of ['localDescription', 'currentLocalDescription', 'pendingLocalDescription']) assert.equal(pc[key].sdp, offer.sdp, key);
  assert.equal(pc.localDescription.toJSON().sdp, offer.sdp);
  await pc.setRemoteDescription({ type: 'answer', sdp: offer.sdp }); assert.equal(received(f, 'remote').at(-1), GRANTED_SDP);
  for (const key of ['remoteDescription', 'currentRemoteDescription', 'pendingRemoteDescription']) assert.equal(pc[key].sdp, offer.sdp, key);
  const six = fixture(BOTH, { sdp: sdpOf({ c: 'IN IP6 ' + A6, rows: [N.a6] }) }), answer = await six.pc().createAnswer();
  assert.equal(answer.sdp.includes('\r\nc=IN IP6 ::\r\n'), true); assert.equal(answer.sdp.includes(A6), false); noReal(answer.sdp, 'answer');
});

test('granted state, stats: host rows are empty like Chrome stats, the foundation agrees with the candidate, srflx rows lose the hidden base port', async () => {
  const f = fixture(), c4 = f.candidate(N.a4), c6 = f.candidate(N.a6), rows = await statRows(f);
  const host = rows.filter(row => row.type === 'local-candidate' && row.candidateType === 'host');
  assert.equal(host.length, 5);
  for (const row of host) { assert.equal(row.address, ''); assert.equal(row.ip, ''); }
  const udp4 = host.find(row => row.protocol === 'udp' && row.port === 49339), udp6 = host.find(row => row.protocol === 'udp' && row.port === 49342), tcp4 = host.find(row => row.protocol === 'tcp' && row.priority === P.t4);
  assert.equal(udp4.foundation, c4.foundation); assert.equal(tcp4.foundation, c4.foundation); assert.equal(udp6.foundation, c6.foundation);
  assert.equal(host.find(row => row.port === 49340).foundation, f.candidate(N.b4).foundation);
  const srflx = rows.find(row => row.candidateType === 'srflx');
  assert.equal(srflx.address, '198.51.100.20', 'the STUN role is independent of the host mode'); assert.equal(Object.hasOwn(srflx, 'relatedPort'), false); assert.equal(Object.hasOwn(srflx, 'relatedAddress'), false);
  assert.equal(srflx.port, 49339); assert.equal(srflx.networkType, 'ethernet');
  const pair = rows.find(row => row.type === 'candidate-pair'), local = rows.find(row => row.id === pair.localCandidateId);
  assert.equal(local.candidateType, 'host'); noReal(rows, 'stats');
});

test('granted state, ICE transport and error events: candidates read through the patched getters, the error address follows the host mode', () => {
  const f = fixture(), transport = new f.realm.RTCIceTransport();
  const local = transport.getLocalCandidates(), remote = transport.getRemoteCandidates(), pair = transport.getSelectedCandidatePair();
  assert.deepEqual(local.map(c => c.address), [uuid(1), uuid(2)]); assert.equal(local[0].candidate.includes(A4), false);
  assert.equal(remote[0].address, '198.51.100.20'); assert.equal(pair.local.address, uuid(1)); assert.equal(pair.remote.relatedAddress, '0.0.0.0'); assert.equal(pair.remote.relatedPort, 0);
  noReal([local.map(c => c.candidate), remote.map(c => c.candidate), pair.local.candidate, pair.remote.candidate], 'transport');
  assert.equal(f.error(A4).address, uuid(1), 'the error event shows the same name as the candidates of that interface');
  assert.equal(f.error(A6).address, uuid(2)); assert.equal(f.error(null).address, null); assert.equal(f.error('').address, '');
  assert.equal(f.error('127.0.0.1').address, '127.0.0.1');
});

test('related address: a srflx/prflx base becomes 0.0.0.0 / :: with port 0 in text, getters, toJSON, SDP and stats; relay and absent bases keep their form', async () => {
  const f = fixture(), s4 = f.candidate(N.s4), s6 = f.candidate(N.s6), p4 = f.candidate(N.p4);
  assert.equal(s4.candidate.includes(' raddr 0.0.0.0 rport 0 '), true); assert.equal(s4.relatedAddress, '0.0.0.0'); assert.equal(s4.relatedPort, 0);
  assert.equal(s4.address, '198.51.100.20'); assert.equal(s4.candidate.split(' ')[5], '49339', 'the srflx port itself stays native');
  assert.equal(s6.candidate.includes(' raddr :: rport 0 '), true); assert.equal(s6.relatedAddress, '[::]', 'the getter keeps the bracket spelling of Chrome, the text does not'); assert.equal(s6.relatedPort, 0); assert.equal(s6.address, '2001:db8::20');
  assert.equal(p4.relatedAddress, '0.0.0.0'); assert.equal(p4.relatedPort, 0); assert.equal(p4.candidate.includes(' raddr 0.0.0.0 rport 0 '), true);
  assert.equal(f.realm.RTCIceCandidate.prototype.toJSON.call(s4).candidate, s4.candidate);
  assert.equal(f.candidate(N.a4).relatedAddress, null); assert.equal(f.candidate(N.a4).relatedPort, null, 'a host candidate has no related port');
  const relay = f.candidate(N.relay); assert.equal(relay.relatedAddress, '0.0.0.0'); assert.equal(relay.relatedPort, 0); assert.equal(relay.candidate.includes(' raddr 0.0.0.0 rport 0 '), true);
  assert.equal(relay.address, '203.0.113.30');
  const real = f.candidate(N.relayReal); assert.equal(real.relatedAddress, '198.51.100.20', 'a relay related address follows the STUN role, not the host mode'); assert.equal(real.relatedPort, 49339);
  const offer = await f.pc().createOffer(), srflxLine = lines(offer.sdp, 'a=candidate:').find(row => row.includes(' typ srflx '));
  assert.equal(srflxLine.includes(' raddr 0.0.0.0 rport 0 '), true); noReal(offer.sdp, 'offer');
});

test('related address follows each family: a literal-host family keeps its base and port, an mdns family zeroes it', () => {
  const mixed = fixture(profile(MD4, V6)), v4 = mixed.candidate(N.s4), v6 = mixed.candidate(N.s6);
  assert.equal(v4.relatedAddress, '0.0.0.0'); assert.equal(v4.relatedPort, 0);
  assert.equal(v6.relatedAddress, V6.host); assert.equal(v6.relatedPort, 49342, 'a literal host family keeps the native base port');
  assert.equal(v6.candidate.includes(` raddr ${V6.host} rport 49342 `), true);
  const reverse = fixture(profile(V4, MD6)), r4 = reverse.candidate(N.s4), r6 = reverse.candidate(N.s6);
  assert.equal(r4.relatedAddress, V4.host); assert.equal(r4.relatedPort, 49339); assert.equal(r6.relatedAddress, '[::]'); assert.equal(r6.relatedPort, 0);
});

test('Chrome without a grant is left exactly as produced: its own names, "" in stats and the native foundation, and nothing is drawn', async () => {
  const sdp = sdpOf({ rows: [PLAIN.h4, PLAIN.h6, PLAIN.s4] }), f = fixture(BOTH, { sdp, stats: () => [stat('H4', 'host', 'udp', '', 64613, prio(126, 30), '974469266'), stat('H6', 'host', 'udp', '', 64614, prio(126, 40), '2625887522'), stat('S4', 'srflx', 'udp', '198.51.100.37', 64613, prio(100, 30), '80548759')] });
  const h4 = f.candidate(PLAIN.h4), h6 = f.candidate(PLAIN.h6), s4 = f.candidate(PLAIN.s4);
  assert.equal(h4.candidate, PLAIN.h4); assert.equal(h6.candidate, PLAIN.h6); assert.equal(h4.address, uuid4); assert.equal(h6.address, uuid6);
  assert.equal(h4.foundation, '974469266'); assert.equal(h6.foundation, '2625887522'); assert.equal(f.realm.RTCIceCandidate.prototype.toJSON.call(h4).candidate, PLAIN.h4);
  assert.equal(s4.relatedAddress, '0.0.0.0'); assert.equal(s4.relatedPort, 0); assert.equal(s4.address, '198.51.100.20');
  const offer = await f.pc().createOffer(); assert.deepEqual(lines(offer.sdp, 'a=candidate:').slice(0, 2), ['a=' + PLAIN.h4, 'a=' + PLAIN.h6]);
  const rows = await statRows(f), hosts = rows.filter(row => row.candidateType === 'host');
  assert.deepEqual(hosts.map(row => [row.address, row.ip, row.foundation]), [['', '', '974469266'], ['', '', '2625887522']]);
  assert.equal(f.random.calls.length, 0, 'a name the browser already made is never replaced, so no name is drawn');
});

test('a remote .local host candidate and unrelated names are never touched; a literal remote host is named like a local one', async () => {
  const f = fixture(), pc = f.pc(), foreign = line('9', P.a4, 'peer-7d1f.local', 5000, { extra: '' });
  const c = f.candidate(foreign); assert.equal(c.candidate, foreign); assert.equal(c.address, 'peer-7d1f.local'); assert.equal(c.foundation, '9');
  const remote = line('10', P.a4, '10.200.0.7', 5001, { extra: '' }), r = f.candidate(remote);
  assert.match(r.address, NAME); assert.equal(r.candidate.includes('10.200.0.7'), false);
  await pc.addIceCandidate({ candidate: foreign, sdpMid: '0' }); assert.equal(received(f, 'candidate').at(-1), foreign);
  await pc.setRemoteDescription({ type: 'offer', sdp: sdpOf({ rows: [foreign] }) }); assert.equal(received(f, 'remote').at(-1).includes('a=' + foreign), true);
  assert.equal(f.random.calls.length, 1, 'only the literal remote host drew a name');
});

test('round trip: projected SDP and candidates fed back to the same or another connection reach the native side with the original lines', async () => {
  const f = fixture(), first = f.pc(), second = f.pc(), offer = await first.createOffer();
  await first.setLocalDescription(offer); await second.setRemoteDescription(offer);
  assert.deepEqual(received(f, 'local'), [GRANTED_SDP]); assert.deepEqual(received(f, 'remote'), [GRANTED_SDP]);
  const candidates = ['a4', 'a6', 'b4', 's4'].map(key => f.candidate(N[key]));
  for (const c of candidates) { await second.addIceCandidate(c.toJSON()); await second.addIceCandidate({ candidate: c.candidate, sdpMid: '0' }); }
  assert.deepEqual(received(f, 'candidate'), ['a4', 'a4', 'a6', 'a6', 'b4', 'b4', 's4', 's4'].map(key => N[key]));
  const projected = offer.sdp.split('\r\n'), edited = projected.slice(0, 7).concat(['a=x-note:1'], projected.slice(7)).join('\r\n') + 'a=x-end:1\r\n';
  await second.setRemoteDescription({ type: 'answer', sdp: edited });
  const restored = received(f, 'remote').at(-1); noReal(lines(offer.sdp, 'a=candidate:'), 'edited projection');
  assert.deepEqual(lines(restored, 'a=candidate:'), lines(GRANTED_SDP, 'a=candidate:'), 'every projected candidate line of a page-edited SDP is restored one by one');
  assert.equal(restored.includes('a=x-note:1'), true);
  const copy = new f.realm.RTCSessionDescription({ type: 'offer', sdp: offer.sdp }); assert.equal(copy.sdp, offer.sdp, 're-reading a projected SDP is idempotent');
  await second.setRemoteDescription({ type: 'offer', sdp: copy.sdp }); assert.equal(received(f, 'remote').at(-1), GRANTED_SDP);
  const again = f.candidate(candidates[0].candidate); assert.equal(again.candidate, candidates[0].candidate, 'a projected candidate projects to itself');
  assert.equal(f.random.calls.length, 4, 'four local interfaces (A4, B4, link-local, A6) drew exactly four names across the whole exchange');
});

test('families are independent: each family shows a name, a literal or nothing; STUN and TURN roles never depend on the host mode', async () => {
  const cases = [
    ['both mdns', profile(MD4, MD6), { a4: uuid(1), a6: uuid(2) }],
    ['ipv4 mdns, ipv6 literal', profile(MD4, V6), { a4: uuid(1), a6: V6.host }],
    ['ipv4 literal, ipv6 mdns', profile(V4, MD6), { a4: V4.host, a6: uuid(1) }],
    ['ipv4 mdns, ipv6 withheld', profile(MD4, null), { a4: uuid(1), a6: null }],
    ['ipv4 withheld, ipv6 mdns', profile(null, MD6), { a4: null, a6: uuid(1) }]
  ];
  for (const [label, value, expected] of cases) {
    const f = fixture(value), a4 = f.candidate(N.a4), a6 = f.candidate(N.a6);
    assert.equal(a4.address, expected.a4, label + ' ipv4 host'); assert.equal(a6.address, expected.a6, label + ' ipv6 host');
    for (const [c, address] of [[a4, expected.a4], [a6, expected.a6]]) {
      if (address === null) { assert.equal(c.candidate, '', label); assert.equal(c.foundation, '', label); } else assert.equal(c.candidate.split(' ')[4], address, label);
    }
    // The three IPv4 UDP hosts (A4, B4, link-local) and the IPv6 one, in SDP order, each family on its own rule.
    const offer = await f.pc().createOffer(); noReal(offer.sdp, label);
    const hosts = lines(offer.sdp, 'a=candidate:').filter(row => row.includes(' typ host ') && field(row, 2) === 'udp').map(row => field(row, 4));
    const v4 = value.addresses.ipv4.host, v6 = value.addresses.ipv6.host, want = [...(v4 === null ? [] : [v4, v4, v4]), ...(v6 === null ? [] : [v6])];
    assert.equal(hosts.length, want.length, label + ' host line count');
    hosts.forEach((address, index) => want[index] === 'mdns' ? assert.match(address, NAME, label) : assert.equal(address, want[index], label));
    if (v4 === 'mdns') assert.equal(new Set(hosts.slice(0, 3)).size, 3, label + ' one name per IPv4 interface');
    assert.equal(f.candidate(N.s4).address, value.addresses.ipv4.stun, label + ' srflx follows the stun role'); assert.equal(f.candidate(N.relay).address, value.addresses.ipv4.turn, label + ' relay follows the turn role');
  }
});

test('special addresses stay untouched and draw no name; link-local interface addresses are named', async () => {
  const f = fixture();
  for (const address of ['0.0.0.0', '127.0.0.1', '127.9.9.9', '::', '::1']) {
    const c = f.candidate(line('5', P.a4, address, 4000, { extra: '' })); assert.equal(c.address, address.includes(':') ? '[' + address + ']' : address, address + ' (Chrome spells IPv6 in brackets here)'); assert.equal(c.candidate.split(' ')[4], address, address);
  }
  assert.equal(f.random.calls.length, 0);
  assert.match(f.candidate(line('6', P.l4, L4, 4001, { extra: '' })).address, NAME); assert.match(f.candidate(line('7', P.a6, LL6, 4002, { extra: '' })).address, NAME); assert.equal(f.random.calls.length, 2);
  const sdp = sdpOf({ c: 'IN IP4 0.0.0.0', rows: [line('8', P.a4, '127.0.0.1', 4003, { extra: '' })] }), loop = fixture(BOTH, { sdp }), offer = await loop.pc().createOffer();
  const mask = text => text.replace(/^(a=)?candidate:[^ ]+/gm, '$1candidate:F'); // foundations are always re-derived, even for placeholders
  assert.equal(mask(offer.sdp), mask(sdp), 'a loopback-only SDP is returned exactly as native'); assert.equal(loop.random.calls.length, 0);
});

test('fail closed: no random source, a throwing source or a full table hold the host and never show the real address or throw', async () => {
  const none = fixture(BOTH, { withCrypto: false }), c = none.candidate(N.a4);
  assert.equal(c.candidate, ''); assert.equal(c.address, null); assert.equal(c.foundation, ''); assert.equal(c.toJSON().candidate, ''); assert.ok(none.installation.snapshot().unavailable > BASELINE_UNAVAILABLE);
  const offer = await none.pc().createOffer(); noReal(offer.sdp, 'no crypto'); assert.equal(lines(offer.sdp, 'a=candidate:').some(row => row.includes(' typ host ')), false);
  const rows = await statRows(none); assert.equal(rows.filter(row => row.candidateType === 'host').every(row => row.address === '' && row.ip === ''), true); noReal(rows, 'no crypto stats');
  const throwing = { crypto: new (class { getRandomValues() { throw new Error('NATIVE_RANDOM'); } })() };
  const broken = fixture(BOTH, { random: throwing }); assert.doesNotThrow(() => broken.candidate(N.a4).candidate); assert.equal(broken.candidate(N.a4).candidate, ''); assert.equal(broken.candidate(N.a4).address, null);
  const full = fixture();
  for (let index = 0; index < 256; index++) assert.match(full.candidate(line('1', P.a4, `10.${index >> 8}.${index & 255}.9`, 1)).address, NAME);
  assert.equal(full.candidate(line('1', P.a4, '10.9.9.9', 1)).candidate, '', 'the 257th address is held'); assert.equal(full.candidate(line('1', P.a4, '10.9.9.9', 1)).address, null);
  assert.equal(full.candidate(line('1', P.a4, '10.0.0.9', 1)).address, uuid(1), 'earlier names stay stable when the table is full'); assert.equal(full.random.calls.length, 256);
  assert.ok(full.installation.snapshot().unavailable > BASELINE_UNAVAILABLE);
});

test('mdns is a host-slot mode only: a forged stun/turn value is never shown and the placeholder never reaches c=, o= or a=rtcp', async () => {
  const forged = fixture(profile({ host: 'mdns', stun: 'mdns', turn: 'mdns' }, null)), s4 = forged.candidate(N.s4), relay = forged.candidate(N.relay);
  assert.equal(s4.candidate, ''); assert.equal(s4.address, null); assert.equal(relay.candidate, ''); assert.equal(relay.address, null);
  const f = fixture(BOTH, { sdp: sdpOf({ c: 'IN IP4 ' + A4, rows: [N.a4] }).replace('IN IP4 127.0.0.1', 'IN IP4 ' + A4).replace('a=rtcp:9 IN IP4 0.0.0.0', 'a=rtcp:9 IN IP4 ' + B4) }), offer = await f.pc().createOffer();
  assert.equal(offer.sdp.includes('mdns'), false); assert.equal(offer.sdp.includes('.local\r\nc='), false);
  assert.equal(offer.sdp.includes('o=- 2891203517481301726 2 IN IP4 0.0.0.0'), true); assert.equal(offer.sdp.includes('a=rtcp:9 IN IP4 0.0.0.0'), true); assert.equal(offer.sdp.includes('c=IN IP4 0.0.0.0'), true);
  noReal(offer.sdp, 'placeholders');
});

test('the Custom IP mode and the native mode are unchanged: literal hosts stay literal, no name is drawn, relatedPort is not wrapped', async () => {
  const ip = fixture(profile(V4, V6)), none = fixture({ ...profile(V4, V6), addresses: null });
  assert.equal(ip.candidate(N.a4).address, V4.host); assert.equal(ip.candidate(N.a6).address, V6.host);
  assert.equal(ip.candidate(N.s4).relatedAddress, V4.host); assert.equal(ip.candidate(N.s4).relatedPort, 49339); assert.equal(ip.candidate(N.s4).candidate.includes(` raddr ${V4.host} rport 49339 `), true);
  const offer = await ip.pc().createOffer(); assert.equal(offer.sdp.includes('c=IN IP4 ' + V4.host), true); noReal(offer.sdp, 'ip mode');
  const rows = await statRows(ip); assert.equal(rows.find(row => row.port === 49339 && row.protocol === 'udp' && row.candidateType === 'host').address, V4.host);
  assert.equal(rows.find(row => row.candidateType === 'srflx').relatedPort, 49339, 'IP mode keeps the stats base port as before');
  assert.equal(ip.random.calls.length, 0); assert.equal(ip.installation.snapshot().unavailable, BASELINE_UNAVAILABLE);
  assert.equal(Object.getOwnPropertyDescriptor(ip.realm.RTCIceCandidate.prototype, 'relatedPort').get, ip.nativeRelatedPort, 'relatedPort is wrapped only for an mdns family; IP mode leaves the native getter alone');
  assert.equal(none.candidate(N.a4).candidate, N.a4); assert.equal(none.candidate(N.a4).address, A4);
  const withMdns = fixture(profile(MD4, null));
  assert.notEqual(Object.getOwnPropertyDescriptor(withMdns.realm.RTCIceCandidate.prototype, 'relatedPort').get, withMdns.nativeRelatedPort);
});

test('stop() restores every owned descriptor, including relatedPort, and the wrappers stop projecting', () => {
  const f = fixture(), c = f.candidate(N.s4), names = ['candidate', 'address', 'relatedAddress', 'relatedPort', 'foundation'];
  const prototype = f.realm.RTCIceCandidate.prototype, wrapped = names.map(key => Object.getOwnPropertyDescriptor(prototype, key).get);
  assert.equal(c.relatedPort, 0);
  f.installation.stop();
  assert.equal(c.relatedPort, 49339); assert.equal(c.relatedAddress, A4); assert.equal(c.candidate, N.s4);
  names.forEach((key, index) => assert.notEqual(Object.getOwnPropertyDescriptor(prototype, key).get, wrapped[index], key + ' was restored'));
});

test('the serialized installer (document-start source, no module scope) names hosts in a fresh realm', () => {
  const source = installWebRtcCustom.toString();
  const result = vm.runInNewContext(`(() => {
    const raw = new WeakMap();
    class RTCIceCandidate { constructor(init) { const parts = init.candidate.split(' '); raw.set(this, { candidate: init.candidate, type: parts[7], address: parts[4], relatedAddress: null, relatedPort: null, foundation: parts[0].replace('candidate:', '') }); }
      get candidate() { return raw.get(this).candidate; } get type() { return raw.get(this).type; } get address() { return raw.get(this).address; } get relatedAddress() { return raw.get(this).relatedAddress; } get relatedPort() { return raw.get(this).relatedPort; } get foundation() { return raw.get(this).foundation; } }
    class RTCPeerConnection {}
    let fill = 7; class Crypto { getRandomValues(array) { array.fill(fill++); return array; } }
    const realm = { Object, Array, Promise, RTCPeerConnection, RTCIceCandidate, crypto: new Crypto(), DOMException: class extends Error {} };
    const install = (${source});
    const installation = install(realm, [{ id: 'webrtc', mode: 'custom', value: { addresses: { ipv4: { host: 'mdns', stun: null, turn: null }, ipv6: { host: null, stun: null, turn: null } }, iceTransportPolicy: 'preserve', randomizeDevices: false, freshCertificates: false, deviceLifetime: 'session' } }]);
    const c = new realm.RTCIceCandidate({ candidate: 'candidate:1 1 udp 2122194687 198.18.0.41 5000 typ host generation 0' });
    return JSON.stringify({ address: c.address, text: c.candidate, snapshot: installation.snapshot() });
  })()`, { TextEncoder, DOMException });
  const out = JSON.parse(result); assert.equal(out.address, uuid(7)); assert.equal(out.text.split(' ')[4], uuid(7)); assert.ok(out.snapshot.installed >= 4, 'the candidate hooks were installed');
});

// ---- Registration level: contract value -> document-start script -> first page script of a document.
function registrationRealm() {
  const realm = vm.createContext({ DOMException, TextEncoder, crypto: globalThis.crypto });
  vm.runInContext(String.raw`
    globalThis.Navigator = function Navigator() {}; globalThis.navigator = new Navigator();
    globalThis.document = { querySelectorAll() { return []; } }; globalThis.listeners = [];
    globalThis.addEventListener = function(type, listener) { listeners.push({ type, listener }); };
    globalThis.postMessage = function(data) { for (const row of listeners) if (row.type === 'message') row.listener({ source: globalThis, data }); };
    globalThis.RTCPeerConnection = function RTCPeerConnection() {}; globalThis.webkitRTCPeerConnection = RTCPeerConnection; globalThis.mozRTCPeerConnection = RTCPeerConnection;
    globalThis.RTCIceCandidate = class RTCIceCandidate {
      constructor(init) { this.raw = init.candidate; }
      get candidate() { return this.raw; } get type() { return this.raw.split(' ')[7]; } get address() { return this.raw.split(' ')[4]; }
      get relatedAddress() { const parts = this.raw.split(' '), at = parts.indexOf('raddr'); return at < 0 ? null : parts[at + 1]; }
      get relatedPort() { const parts = this.raw.split(' '), at = parts.indexOf('rport'); return at < 0 ? null : Number(parts[at + 1]); }
      get foundation() { return this.raw.split(' ')[0].replace('candidate:', ''); }
      toJSON() { return { candidate: this.raw, sdpMid: '0', sdpMLineIndex: 0 }; }
    };
    globalThis.RTCSessionDescription = class RTCSessionDescription { get sdp() { return 'v=0'; } toJSON() { return { type: 'offer', sdp: this.sdp }; } };
  `, realm);
  return realm;
}
test('registration level: a saved mdns profile builds the document-start script and the page sees names at its first script', async () => {
  const { createApiConfiguration, updateApiConfiguration } = await import('../../packages/contracts/src/api-configuration.mjs');
  const { buildApiCustomScripts } = await import('../../apps/production-extension/api-custom-registration.js');
  const base = { ...createApiConfiguration(), enabled: true, antidetectEnabled: true, preset: 'custom' };
  const saved = updateApiConfiguration(base, 'webrtc', { mode: 'custom', selected: { kind: 'value', value: profile(MD4, MD6) } }); assert.equal(saved.ok, true, saved.error?.message);
  const scripts = buildApiCustomScripts(saved.value, ['https://*/*']), code = scripts[0].js[0].code;
  assert.equal(code.includes('mdns'), true, 'the selected host mode is packed into the closed script'); assert.equal(code.includes('"host":"mdns"') || code.includes("host:'mdns'") || code.includes('host: "mdns"') || code.includes('"mdns"'), true);
  const realm = registrationRealm(); vm.runInContext(code, realm);
  const probe = (text, member) => vm.runInContext('new RTCIceCandidate({candidate:' + JSON.stringify(text) + '}).' + member, realm);
  const host4 = 'candidate:1 1 udp 2122194687 198.18.0.88 5000 typ host generation 0', host6 = 'candidate:2 1 udp 2122262783 2001:db8:aaaa:1::88 5001 typ host generation 0';
  const srflx = 'candidate:3 1 udp 1685987071 198.51.100.9 5002 typ srflx raddr 198.18.0.88 rport 5000 generation 0';
  const name4 = probe(host4, 'address'), name6 = probe(host6, 'address');
  assert.match(name4, NAME); assert.match(name6, NAME); assert.notEqual(name4, name6); assert.equal(probe(host4, 'address'), name4, 'stable inside the document');
  assert.equal(probe(host4, 'candidate').split(' ')[4], name4); assert.equal(probe(host4, 'candidate').includes('198.18.0.88'), false);
  assert.equal(probe(srflx, 'relatedAddress'), '0.0.0.0'); assert.equal(probe(srflx, 'relatedPort'), 0); assert.equal(probe(srflx, 'address'), MD4.stun);
  const another = registrationRealm(); vm.runInContext(code, another);
  assert.notEqual(vm.runInContext('new RTCIceCandidate({candidate:' + JSON.stringify(host4) + '}).address', another), name4, 'another document gets another name');
});
