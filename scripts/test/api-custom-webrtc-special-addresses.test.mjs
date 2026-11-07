// Owner request (Camoufox / CloakBrowser comparison, task E3): WebRTC Custom must keep placeholder and loopback addresses. SDP o=
// (IN IP4 127.0.0.1), c= (IN IP4 0.0.0.0), a=rtcp (IN IP4 0.0.0.0) and candidate raddr (0.0.0.0 / ::) are placeholders, not addresses of the
// user: they were replaced by the selected host address (or dropped). Only 0.0.0.0, ::, 127.0.0.0/8 and ::1 are special and are never
// rewritten or dropped. Link-local addresses (169.254.0.0/16, fe80::/10) are NOT special: stock Chromium gathers link-local host candidates
// (live measurement, e.g. 169.254.106.179), so they identify an interface and follow the normal role/family logic, exactly like 10.x or
// fd00::1: rewritten to the selected address, or dropped when that role is hidden. Real addresses keep that logic and a hidden role never
// falls back to the native address.
//
// UNVERIFIED (written from memory of Chrome output, to be live-checked by the main thread): `o=- <id> 2 IN IP4 127.0.0.1`, the pre-gather
// `c=IN IP4 0.0.0.0`, `a=rtcp:9 IN IP4 0.0.0.0` and the srflx `raddr 0.0.0.0 rport 0`. The tests only depend on those spellings as inputs.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installWebRtcCustom } from '../../apps/production-extension/api-custom-webrtc-runtime.js';

const none = () => ({ host: null, stun: null, turn: null });
const V4 = { host: '192.0.2.10', stun: '198.51.100.20', turn: '203.0.113.30' }, V6 = { host: '2001:db8::10', stun: '2001:db8::20', turn: '2001:db8::30' };
const profile = (ipv4, ipv6) => ({ addresses: { ipv4: ipv4 ?? none(), ipv6: ipv6 ?? none() }, iceTransportPolicy: 'preserve', randomizeDevices: false, freshCertificates: false, deviceLifetime: 'session' });
const PROFILES = { both: profile(V4, V6), v4only: profile(V4, null), v6only: profile(null, V6), none: profile(null, null) };
const NAMES = Object.keys(PROFILES);

function fixture(value, { sdp = '', stats = [], installer = installWebRtcCustom } = {}) {
  const raw = new WeakMap(), connections = new WeakMap(), calls = [], brand = new TypeError('NATIVE_BRAND');
  const checked = receiver => { const row = raw.get(receiver); if (!row) throw brand; return row; };
  const checkedPc = receiver => { const row = connections.get(receiver); if (!row) throw brand; return row; };
  class RTCIceCandidate {
    constructor(init = {}) {
      const text = init.candidate ?? '', parts = text.split(' '), related = parts.indexOf('raddr');
      raw.set(this, { candidate: text, type: parts[7] ?? null, address: parts[4] ?? null, relatedAddress: related < 0 ? null : parts[related + 1], foundation: parts[0]?.replace(/^(a=)?candidate:/, '') ?? null });
    }
    get candidate() { return checked(this).candidate; }
    get type() { return checked(this).type; }
    get address() { return checked(this).address; }
    get relatedAddress() { return checked(this).relatedAddress; }
    get foundation() { return checked(this).foundation; }
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
    setLocalDescription(init) { checkedPc(this).local = { type: init.type, sdp: init.sdp }; calls.push(['local', init.sdp]); return Promise.resolve(); }
    setRemoteDescription(init) { checkedPc(this).remote = { type: init.type, sdp: init.sdp }; calls.push(['remote', init.sdp]); return Promise.resolve(); }
    addIceCandidate(init) { checkedPc(this); calls.push(['candidate', init.candidate]); return Promise.resolve(); }
    get localDescription() { const row = checkedPc(this).local; return row ? new RTCSessionDescription(row) : null; }
    get remoteDescription() { const row = checkedPc(this).remote; return row ? new RTCSessionDescription(row) : null; }
    getStats() { checkedPc(this); calls.push(['stats']); return Promise.resolve(new Map(stats.map(row => [row.id, { ...row }]))); }
  }
  class RTCPeerConnectionIceErrorEvent {
    constructor(address) { raw.set(this, { address }); }
    get address() { return checked(this).address; }
  }
  const realm = { Object, Array, Promise, RTCPeerConnection, webkitRTCPeerConnection: RTCPeerConnection, mozRTCPeerConnection: RTCPeerConnection, RTCIceCandidate, RTCSessionDescription, RTCPeerConnectionIceErrorEvent, DOMException };
  const installation = installer(realm, [{ id: 'webrtc', mode: 'custom', value }]);
  return { realm, installation, calls, brand, candidate: text => new realm.RTCIceCandidate({ candidate: text }) };
}
const received = (f, kind) => f.calls.filter(row => row[0] === kind).map(row => row[1]);
// Foundations are always re-derived from the projected address, so they are masked when a line is compared with its native spelling.
const mask = text => text.replace(/^(a=)?candidate:[^ ]+/gm, '$1candidate:F');
const lineList = text => text.split('\r\n').filter(row => row !== '');
const join = rows => rows.join('\r\n') + '\r\n';

// ---- Chrome-like descriptions. Each row: [native line, expectation per profile]. An expectation is SAME (the line survives, a candidate
// line apart from its foundation), null (the line is dropped) or the projected line (foundation written F).
const SAME = Symbol('same');
const mdns4 = 'f5bf66ba-3161-4ee3-b05a-bf10b27f64c9.local', mdns6 = '83771fdc-ee57-49f1-8e00-84b791941256.local';
const tail = ' generation 0 ufrag Vpub network-cost 999';
const always = native => [native, { both: SAME, v4only: SAME, v6only: SAME, none: SAME }];
const v4 = (native, visible, hidden) => [native, { both: visible, v4only: visible, v6only: hidden, none: hidden }];
const v6 = (native, visible, hidden) => [native, { both: visible, v4only: hidden, v6only: visible, none: hidden }];

// Offer before gathering (data channel only): no real address at all.
const PRE_GATHER = [
  always('v=0'), always('o=- 4611731400430051336 2 IN IP4 127.0.0.1'), always('s=-'), always('t=0 0'), always('a=group:BUNDLE 0'), always('a=extmap-allow-mixed'),
  always('a=msid-semantic: WMS'), always('m=application 9 UDP/DTLS/SCTP webrtc-datachannel'), always('c=IN IP4 0.0.0.0'), always('a=ice-ufrag:Vpub'),
  always('a=ice-pwd:0123456789abcdef0123456789'), always('a=ice-options:trickle'), always('a=fingerprint:sha-256 AA:BB:CC:DD'), always('a=setup:actpass'),
  always('a=mid:0'), always('a=sctp-port:5000'), always('a=max-message-size:262144'),
];
// After gathering: real srflx / mDNS-masked host candidates of both families next to the placeholders.
const GATHERED = [
  always('v=0'), always('o=- 2891203517481301726 2 IN IP4 127.0.0.1'), always('s=-'), always('t=0 0'), always('a=group:BUNDLE 0'),
  always('m=audio 54322 UDP/TLS/RTP/SAVPF 111'),
  v4('c=IN IP4 203.0.113.77', 'c=IN IP4 192.0.2.10', 'c=IN IP4 0.0.0.0'),
  always('a=rtcp:9 IN IP4 0.0.0.0'),
  v4('a=candidate:842163049 1 udp 1677729535 203.0.113.77 54322 typ srflx raddr 0.0.0.0 rport 0' + tail, 'a=candidate:F 1 udp 1677729535 198.51.100.20 54322 typ srflx raddr 0.0.0.0 rport 0' + tail, null),
  v4('a=candidate:2625887522 1 udp 2113937151 ' + mdns4 + ' 54322 typ host' + tail, 'a=candidate:F 1 udp 2113937151 192.0.2.10 54322 typ host' + tail, null),
  v6('a=candidate:3 1 udp 1677729535 2001:db8:aaaa::77 54323 typ srflx raddr :: rport 0' + tail, 'a=candidate:F 1 udp 1677729535 2001:db8::20 54323 typ srflx raddr :: rport 0' + tail, null),
  v6('a=candidate:4 1 udp 2113939711 ' + mdns6 + ' 54323 typ host' + tail, 'a=candidate:F 1 udp 2113939711 2001:db8::10 54323 typ host' + tail, null),
  always('a=ice-ufrag:Vpub'), always('a=ice-pwd:0123456789abcdef0123456789'), always('a=fingerprint:sha-256 AA:BB:CC:DD'), always('a=setup:actpass'),
  always('a=mid:0'), always('a=rtcp-mux'),
];
// IPv6-first description with an IPv6 c= line.
const GATHERED_V6 = [
  always('v=0'), always('o=- 1 2 IN IP6 ::1'), always('s=-'), always('t=0 0'), always('m=audio 54323 UDP/TLS/RTP/SAVPF 111'),
  v6('c=IN IP6 2001:db8:aaaa::77', 'c=IN IP6 2001:db8::10', 'c=IN IP6 ::'),
  always('a=rtcp:9 IN IP6 ::'),
  v6('a=candidate:3 1 udp 1677729535 2001:db8:aaaa::77 54323 typ srflx raddr :: rport 0' + tail, 'a=candidate:F 1 udp 1677729535 2001:db8::20 54323 typ srflx raddr :: rport 0' + tail, null),
  v6('a=candidate:5 1 udp 2113939711 fd00::1234 54323 typ host' + tail, 'a=candidate:F 1 udp 2113939711 2001:db8::10 54323 typ host' + tail, null),
  v6('a=candidate:6 1 udp 2113939711 fe80::1234:5678:9abc:def0 54324 typ host' + tail, 'a=candidate:F 1 udp 2113939711 2001:db8::10 54324 typ host' + tail, null),
];
// Loopback and unspecified addresses as candidates (a remote description written by the page, a test peer, the loopback test flag) stay.
// Link-local candidates and a real IPv4 between them are real addresses and follow the role/family logic.
const LOOPBACK_MIX = [
  always('v=0'), always('o=- 1 2 IN IP6 ::1'), always('s=-'), always('t=0 0'), always('m=application 9 UDP/DTLS/SCTP webrtc-datachannel'),
  always('c=IN IP6 ::'), always('a=rtcp:9 IN IP6 ::'),
  always('a=candidate:1 1 udp 2113937151 127.0.0.1 5000 typ host' + tail),
  v4('a=candidate:2 1 udp 2113937151 169.254.12.34 5001 typ host' + tail, 'a=candidate:F 1 udp 2113937151 192.0.2.10 5001 typ host' + tail, null),
  v6('a=candidate:3 1 udp 2113939711 fe80::1234:5678:9abc:def0 5002 typ host' + tail, 'a=candidate:F 1 udp 2113939711 2001:db8::10 5002 typ host' + tail, null),
  always('a=candidate:4 1 udp 2113939711 ::1 5003 typ host' + tail),
  always('a=candidate:5 1 udp 1677729535 0.0.0.0 5004 typ srflx raddr 127.0.0.1 rport 5000' + tail),
  v4('a=candidate:6 1 udp 2113937151 10.1.2.3 5005 typ host' + tail, 'a=candidate:F 1 udp 2113937151 192.0.2.10 5005 typ host' + tail, null),
  always('a=remote-candidates:1 127.0.0.1 5000 2 ::1 5001'),
  always('a=fingerprint:sha-256 AA:BB:CC:DD'),
];
// Link-local addresses are real interface addresses (stock Chromium gathers 169.254.x host candidates): everywhere they follow the same
// role/family logic as 10.x or fd00::1 - rewritten to the selected address, hidden when that role is hidden, restored by the inverse map.
const LL4 = '169.254.106.179', LL6 = 'fe80::1c2b:3a4d:5e6f:7a8b';
const LINK_LOCAL = [
  always('v=0'), v4('o=- 1 2 IN IP4 ' + LL4, 'o=- 1 2 IN IP4 192.0.2.10', 'o=- 1 2 IN IP4 0.0.0.0'), always('s=-'), always('t=0 0'),
  always('m=audio 54322 UDP/TLS/RTP/SAVPF 111'),
  v4('c=IN IP4 ' + LL4, 'c=IN IP4 192.0.2.10', 'c=IN IP4 0.0.0.0'),
  v6('a=rtcp:9 IN IP6 ' + LL6, 'a=rtcp:9 IN IP6 2001:db8::10', 'a=rtcp:9 IN IP6 ::'),
  v4('a=candidate:1 1 udp 2113937151 ' + LL4 + ' 54322 typ host' + tail, 'a=candidate:F 1 udp 2113937151 192.0.2.10 54322 typ host' + tail, null),
  v6('a=candidate:2 1 udp 2113939711 ' + LL6 + ' 54323 typ host' + tail, 'a=candidate:F 1 udp 2113939711 2001:db8::10 54323 typ host' + tail, null),
  // Link-local related addresses take the host role of their own family.
  v4('a=candidate:3 1 udp 1677729535 203.0.113.77 54324 typ srflx raddr ' + LL4 + ' rport 54324' + tail, 'a=candidate:F 1 udp 1677729535 198.51.100.20 54324 typ srflx raddr 192.0.2.10 rport 54324' + tail, null),
  v6('a=candidate:4 1 udp 1677729535 2001:db8:aaaa::77 54325 typ srflx raddr ' + LL6 + ' rport 54325' + tail, 'a=candidate:F 1 udp 1677729535 2001:db8::20 54325 typ srflx raddr 2001:db8::10 rport 54325' + tail, null),
  // An IPv6 candidate with an IPv4 link-local raddr: the candidate needs IPv6, the related address IPv4 (removed with its port when IPv4 is hidden).
  ['a=candidate:5 1 udp 1677729535 2001:db8:aaaa::77 54326 typ srflx raddr ' + LL4 + ' rport 54326' + tail, { both: 'a=candidate:F 1 udp 1677729535 2001:db8::20 54326 typ srflx raddr 192.0.2.10 rport 54326' + tail, v4only: null, v6only: 'a=candidate:F 1 udp 1677729535 2001:db8::20 54326 typ srflx' + tail, none: null }],
  ['a=remote-candidates:1 ' + LL4 + ' 5001 2 ' + LL6 + ' 5002', { both: 'a=remote-candidates:1 198.51.100.20 5001 2 2001:db8::20 5002', v4only: 'a=remote-candidates:1 198.51.100.20 5001', v6only: 'a=remote-candidates:2 2001:db8::20 5002', none: null }],
  always('a=fingerprint:sha-256 AA:BB:CC:DD'),
];
const nativeText = rows => join(rows.map(row => row[0]));
function expectedText(rows, name) {
  const output = [];
  for (const [native, expectations] of rows) {
    const expected = expectations[name];
    if (expected === null) continue;
    output.push(expected === SAME ? mask(native) : expected);
  }
  return join(output);
}
async function project(name, rows) {
  const f = fixture(PROFILES[name], { sdp: nativeText(rows) }), pc = new f.realm.RTCPeerConnection(), offer = await pc.createOffer();
  return { f, pc, offer };
}

test('E3: an offer before gathering (placeholders only) is byte-for-byte unchanged in every profile and reaches the native setter unchanged', async () => {
  for (const name of NAMES) {
    const { f, pc, offer } = await project(name, PRE_GATHER);
    assert.equal(offer.sdp, nativeText(PRE_GATHER), name);
    await pc.setLocalDescription(offer);
    assert.deepEqual(received(f, 'local'), [nativeText(PRE_GATHER)], name);
    assert.equal(pc.localDescription.sdp, nativeText(PRE_GATHER), name);
  }
});

test('E3: a gathered description changes only real-address occurrences (Host/STUN set, one family null, both null)', async () => {
  for (const name of NAMES) {
    const { offer } = await project(name, GATHERED);
    assert.equal(mask(offer.sdp), expectedText(GATHERED, name), name);
    const lines = lineList(offer.sdp);
    assert.ok(lines.includes('o=- 2891203517481301726 2 IN IP4 127.0.0.1'), name + ': o= placeholder');
    assert.ok(lines.includes('a=rtcp:9 IN IP4 0.0.0.0'), name + ': a=rtcp placeholder');
    // A hidden role never falls back to the native address, whatever else is kept.
    for (const secret of ['203.0.113.77', mdns4, mdns6, '2001:db8:aaaa::77']) assert.equal(offer.sdp.includes(secret), false, name + ' leaks ' + secret);
  }
});

test('E3: srflx raddr 0.0.0.0 / :: with rport 0 is kept next to a rewritten candidate address', async () => {
  const { offer } = await project('both', GATHERED), lines = lineList(offer.sdp).filter(row => row.startsWith('a=candidate:'));
  assert.equal(lines.length, 4);
  const srflx4 = lines.find(row => row.includes('198.51.100.20')), srflx6 = lines.find(row => row.includes('2001:db8::20'));
  assert.ok(srflx4.includes(' typ srflx raddr 0.0.0.0 rport 0 ')); assert.ok(srflx6.includes(' typ srflx raddr :: rport 0 '));
  assert.notEqual(srflx4.split(' ')[0], 'a=candidate:842163049', 'the foundation is still derived from the projected address');
});

test('E3: an IPv6 description keeps the o=/a=rtcp placeholders; real and link-local IPv6 follow the family roles', async () => {
  for (const name of NAMES) {
    const { offer } = await project(name, GATHERED_V6);
    assert.equal(mask(offer.sdp), expectedText(GATHERED_V6, name), name);
    for (const secret of ['2001:db8:aaaa::77', 'fd00::1234', 'fe80::1234:5678:9abc:def0']) assert.equal(offer.sdp.includes(secret), false, name + ' leaks ' + secret);
    assert.ok(lineList(offer.sdp).includes('o=- 1 2 IN IP6 ::1'), name + ': o= loopback placeholder');
    assert.ok(lineList(offer.sdp).includes('a=rtcp:9 IN IP6 ::'), name + ': a=rtcp placeholder');
  }
});

test('E3: loopback and unspecified candidates and remote-candidates survive in every profile; link-local and real IPv4 beside them are rewritten', async () => {
  for (const name of NAMES) {
    const { f, pc, offer } = await project(name, LOOPBACK_MIX);
    assert.equal(mask(offer.sdp), expectedText(LOOPBACK_MIX, name), name);
    const candidates = lineList(offer.sdp).filter(row => row.startsWith('a=candidate:'));
    for (const token of [' 127.0.0.1 5000 ', ' ::1 5003 ', ' 0.0.0.0 5004 ']) assert.ok(candidates.some(row => row.includes(token)), name + ': ' + token);
    for (const secret of ['169.254.12.34', 'fe80::1234:5678:9abc:def0', '10.1.2.3']) assert.equal(offer.sdp.includes(secret), false, name + ' leaks ' + secret);
    assert.ok(lineList(offer.sdp).includes('a=remote-candidates:1 127.0.0.1 5000 2 ::1 5001'), name + ': remote-candidates');
    await pc.setRemoteDescription({ type: 'answer', sdp: offer.sdp });
    assert.equal(received(f, 'remote').at(-1), nativeText(LOOPBACK_MIX), name + ': the native setter gets the native description back');
  }
});

// Native description a page-edited projected description must turn into: candidate lines are restored one by one, other lines stay as the page
// wrote them (a rewritten c= line is not restored: unchanged limitation), placeholders were never rewritten.
const restoredAfterEdit = (rows, name) => join([...rows.flatMap(([native, expectations]) => {
  const expected = expectations[name];
  return expected === null ? [] : [native.startsWith('a=candidate:') || expected === SAME ? native : expected];
}), 'a=x-note:1']);

test('E3: the inverse map still round-trips whole descriptions and page-edited ones (placeholders reach the native side untouched)', async () => {
  for (const name of NAMES) for (const rows of [GATHERED, GATHERED_V6, LOOPBACK_MIX]) {
    const { f, pc, offer } = await project(name, rows);
    await pc.setLocalDescription(offer); await pc.setRemoteDescription({ type: 'answer', sdp: offer.sdp });
    assert.deepEqual(received(f, 'local'), [nativeText(rows)], name + ': whole-string lookup');
    assert.deepEqual(received(f, 'remote'), [nativeText(rows)], name + ': whole-string lookup (remote)');
    assert.equal(pc.localDescription.sdp, offer.sdp, name + ': reading it back is stable');
    await pc.setLocalDescription({ type: 'offer', sdp: offer.sdp + 'a=x-note:1\r\n' });
    assert.equal(received(f, 'local').at(-1), restoredAfterEdit(rows, name), name + ': per-line restore after a page edit');
  }
});

test('E3: projecting an already projected description changes nothing (idempotent), placeholders included', async () => {
  for (const name of NAMES) {
    const { f, offer } = await project(name, GATHERED);
    assert.equal(new f.realm.RTCSessionDescription({ type: 'offer', sdp: offer.sdp }).sdp, offer.sdp, name);
  }
});

test('E3: addIceCandidate restores the native text of loopback, placeholder-raddr and link-local candidates in every profile', async () => {
  const texts = [
    'candidate:1 1 udp 2113937151 127.0.0.1 5000 typ host' + tail,
    'candidate:2 1 udp 2113939711 fe80::1234:5678:9abc:def0 5002 typ host' + tail,
    'candidate:3 1 udp 1677729535 203.0.113.77 54322 typ srflx raddr 0.0.0.0 rport 0' + tail,
    'candidate:4 1 udp 1677729535 2001:db8:aaaa::77 54323 typ srflx raddr :: rport 0' + tail,
    'candidate:5 1 udp 2113937151 169.254.12.34 5001 typ host' + tail,
    'candidate:6 1 udp 1677729535 203.0.113.77 54324 typ srflx raddr 169.254.106.179 rport 54324' + tail,
  ];
  for (const name of NAMES) {
    const f = fixture(PROFILES[name]), pc = new f.realm.RTCPeerConnection();
    for (const text of texts) {
      const candidate = f.candidate(text), init = candidate.toJSON();
      await pc.addIceCandidate(init); await pc.addIceCandidate({ candidate: init.candidate, sdpMid: '0' });
      const [viaObject, viaText] = received(f, 'candidate').slice(-2);
      assert.equal(viaObject, text, name + ': ' + text);
      assert.equal(viaText, init.candidate === '' ? '' : text, name + ': ' + text + ' (projected string)');
    }
  }
});

// ---- Candidate objects: which spellings are special (loopback and unspecified: kept), which are real (link-local included: role/family logic)
// and which only look special (treated as real).
const SPECIAL = ['0.0.0.0', '127.0.0.1', '127.0.0.0', '127.1.2.3', '127.255.255.254', '::', '::1', '0:0:0:0:0:0:0:1', '0000:0000:0000:0000:0000:0000:0000:0001',
  '0::0', '::0'];
// Link-local is NOT special: stock Chromium gathers these as host candidates, so they are rewritten like any real interface address.
const LINK_LOCAL_ADDRESSES = ['169.254.0.1', '169.254.106.179', '169.254.255.254', 'fe80::1', 'FE80::ABCD', 'fe80::1234:5678:9abc:def0', 'febf::1', 'fe80:0:0:0:1:2:3:4'];
const REAL = ['10.0.0.1', '192.168.99.7', '172.16.5.4', '126.255.255.255', '128.0.0.1', '169.253.1.1', '169.255.0.1', '0.0.0.1', '1.0.0.0', '203.0.113.77', '255.255.255.255',
  'fec0::1', 'fc00::1', 'fd12:3456:789a::42', '2001:db8:aaaa::1', 'fe7f::1', '::2', '1::', '2001:db8::', '::ffff:127.0.0.1', '::ffff:0.0.0.0', ...LINK_LOCAL_ADDRESSES];
const LOOKALIKE = ['127.0.0.1.5', '0127.0.0.1', '256.0.0.1', '127.0.0', 'fe80::1%eth0', 'fe80::1::2', ':::', 'fe80:', '1:2:3:4:5:6:7:8:9', '12345::1', 'g::1'];
const family = address => address.includes(':') ? V6 : V4;
const candidateAt = (address, type = 'host', extra = '') => 'candidate:1 1 udp 2113937151 ' + address + ' 5000 typ ' + type + extra + tail;
const ROLE = { host: 'host', srflx: 'stun', prflx: 'stun', relay: 'turn' };

test('E3: loopback and unspecified addresses are kept in candidate text, address, toJSON and foundation in every profile, even when their family is hidden', () => {
  for (const name of NAMES) {
    const f = fixture(PROFILES[name]);
    for (const address of SPECIAL) for (const type of ['host', 'srflx', 'relay']) {
      const candidate = f.candidate(candidateAt(address, type)), parts = candidate.candidate.split(' ');
      assert.equal(parts[4], address, name + ' ' + type + ' ' + address); assert.equal(candidate.address, address, name + ' ' + address);
      assert.equal(candidate.toJSON().candidate, candidate.candidate); assert.equal(parts[0], 'candidate:' + candidate.foundation);
      assert.notEqual(candidate.foundation, '1', 'the native foundation is never exposed');
      assert.equal(parts.slice(5).join(' '), '5000 typ ' + type + tail, 'everything but foundation and address is untouched');
    }
  }
});

test('E3: real and link-local addresses keep the role/family logic: replaced by the selected address, dropped when that role is hidden', () => {
  for (const name of NAMES) {
    const f = fixture(PROFILES[name]), selected = PROFILES[name].addresses;
    for (const address of REAL) for (const type of ['host', 'srflx', 'prflx', 'relay']) {
      const families = address.includes(':') ? 'ipv6' : 'ipv4', expected = selected[families][ROLE[type]], candidate = f.candidate(candidateAt(address, type));
      assert.equal(candidate.address, expected, name + ' ' + type + ' ' + address);
      assert.equal(candidate.candidate === '', expected === null, name + ' ' + type + ' ' + address);
      if (expected !== null) assert.equal(candidate.candidate.split(' ')[4], expected);
      assert.equal(candidate.candidate.split(' ').includes(address) || candidate.address === address, false, 'the native address never shows: ' + address);
    }
  }
});

test('E3: spellings that merely look special (zone ids, IPv4-mapped IPv6, leading zeros, malformed groups) are real addresses', () => {
  for (const name of ['both', 'none']) {
    const f = fixture(PROFILES[name]), selected = PROFILES[name].addresses;
    for (const address of LOOKALIKE) {
      const candidate = f.candidate(candidateAt(address)), expected = name === 'none' ? null : family(address).host;
      assert.equal(candidate.address, expected, name + ' ' + address); assert.equal(candidate.candidate === '', expected === null, name + ' ' + address);
    }
    assert.ok(selected);
  }
});

test('E3: raddr / relatedAddress / rport: placeholders and loopback stay; real and link-local ones are replaced or removed together with their port', () => {
  const f = fixture(PROFILES.both), hiddenV4 = fixture(PROFILES.v6only), none = fixture(PROFILES.none);
  const cases = [
    [candidateAt('203.0.113.77', 'srflx', ' raddr 0.0.0.0 rport 0'), ' raddr 0.0.0.0 rport 0', '0.0.0.0'],
    [candidateAt('2001:db8:aaaa::77', 'srflx', ' raddr :: rport 0'), ' raddr :: rport 0', '::'],
    [candidateAt('203.0.113.77', 'relay', ' raddr 127.0.0.1 rport 5000'), ' raddr 127.0.0.1 rport 5000', '127.0.0.1'],
    [candidateAt('203.0.113.77', 'srflx', ' raddr 169.254.9.9 rport 1'), ' raddr ' + V4.host + ' rport 1', V4.host],
    [candidateAt('203.0.113.77', 'srflx', ' raddr fe80::5 rport 2'), ' raddr ' + V6.host + ' rport 2', V6.host],
    [candidateAt('203.0.113.77', 'relay', ' raddr 169.254.9.9 rport 3'), ' raddr ' + V4.stun + ' rport 3', V4.stun],
    [candidateAt('203.0.113.77', 'srflx', ' raddr 10.0.0.5 rport 1234'), ' raddr ' + V4.host + ' rport 1234', V4.host],
    [candidateAt('203.0.113.77', 'relay', ' raddr 198.18.0.5 rport 4321'), ' raddr ' + V4.stun + ' rport 4321', V4.stun],
  ];
  for (const [text, fragment, related] of cases) {
    const candidate = f.candidate(text);
    assert.ok(candidate.candidate.includes(fragment), text); assert.equal(candidate.relatedAddress, related, text);
    assert.equal(candidate.toJSON().candidate, candidate.candidate);
  }
  // IPv4 host hidden: a visible IPv6 candidate keeps a placeholder raddr but loses a real IPv4 raddr and its port.
  const keeps = hiddenV4.candidate(candidateAt('2001:db8:aaaa::77', 'srflx', ' raddr 0.0.0.0 rport 0')), loses = hiddenV4.candidate(candidateAt('2001:db8:aaaa::77', 'srflx', ' raddr 10.0.0.5 rport 1234'));
  assert.ok(keeps.candidate.includes(' raddr 0.0.0.0 rport 0')); assert.equal(keeps.relatedAddress, '0.0.0.0');
  assert.equal(loses.candidate.includes('raddr'), false); assert.equal(loses.candidate.includes('rport'), false); assert.equal(loses.relatedAddress, null);
  const losesLinkLocal = hiddenV4.candidate(candidateAt('2001:db8:aaaa::77', 'srflx', ' raddr 169.254.9.9 rport 1234'));
  assert.equal(losesLinkLocal.candidate.includes('raddr'), false); assert.equal(losesLinkLocal.candidate.includes('rport'), false); assert.equal(losesLinkLocal.relatedAddress, null);
  assert.ok(losesLinkLocal.candidate.includes(' ' + V6.stun + ' 5000 typ srflx '));
  // Nothing selected at all: the real candidate is gone, a loopback candidate with a placeholder raddr is not.
  assert.equal(none.candidate(candidateAt('203.0.113.77', 'srflx', ' raddr 0.0.0.0 rport 0')).candidate, '');
  assert.ok(none.candidate(candidateAt('127.0.0.1', 'host', ' raddr 0.0.0.0 rport 0')).candidate.includes(' 127.0.0.1 5000 typ host raddr 0.0.0.0 rport 0'));
  assert.equal(none.candidate(candidateAt('169.254.9.9')).candidate, '', 'a link-local candidate is dropped when its role is hidden');
  const loopbackOverLinkLocal = none.candidate(candidateAt('127.0.0.1', 'host', ' raddr 169.254.9.9 rport 1')).candidate;
  assert.ok(loopbackOverLinkLocal.includes(' 127.0.0.1 5000 typ host ')); assert.equal(loopbackOverLinkLocal.includes('raddr'), false);
});

const REAL_IN_SDP = [
  always('v=0'),
  v4('o=- 1 2 IN IP4 10.1.2.3', 'o=- 1 2 IN IP4 192.0.2.10', 'o=- 1 2 IN IP4 0.0.0.0'),
  v6('o=- 1 2 IN IP6 fd00::1', 'o=- 1 2 IN IP6 2001:db8::10', 'o=- 1 2 IN IP6 ::'),
  v4('c=IN IP4 10.1.2.3', 'c=IN IP4 192.0.2.10', 'c=IN IP4 0.0.0.0'),
  v6('c=IN IP6 fd00::1', 'c=IN IP6 2001:db8::10', 'c=IN IP6 ::'),
  v4('a=rtcp:9 IN IP4 10.1.2.3', 'a=rtcp:9 IN IP4 192.0.2.10', 'a=rtcp:9 IN IP4 0.0.0.0'),
  v6('a=rtcp:9 IN IP6 fd00::1', 'a=rtcp:9 IN IP6 2001:db8::10', 'a=rtcp:9 IN IP6 ::'),
  always('o=- 1 2 IN IP4 127.0.0.1'), always('c=IN IP4 0.0.0.0'), always('a=rtcp:9 IN IP4 0.0.0.0'), always('c=IN IP6 ::'), always('o=- 1 2 IN IP6 ::1'),
  // Link-local addresses are real interface addresses (stock Chromium gathers them): the same logic as 10.1.2.3 / fd00::1.
  v4('o=- 1 2 IN IP4 169.254.1.2', 'o=- 1 2 IN IP4 192.0.2.10', 'o=- 1 2 IN IP4 0.0.0.0'), v4('c=IN IP4 169.254.1.1', 'c=IN IP4 192.0.2.10', 'c=IN IP4 0.0.0.0'),
  v4('a=rtcp:9 IN IP4 169.254.1.3', 'a=rtcp:9 IN IP4 192.0.2.10', 'a=rtcp:9 IN IP4 0.0.0.0'),
  v6('o=- 1 2 IN IP6 fe80::2', 'o=- 1 2 IN IP6 2001:db8::10', 'o=- 1 2 IN IP6 ::'), v6('c=IN IP6 fe80::3', 'c=IN IP6 2001:db8::10', 'c=IN IP6 ::'),
  v6('a=rtcp:9 IN IP6 fe80::1', 'a=rtcp:9 IN IP6 2001:db8::10', 'a=rtcp:9 IN IP6 ::'),
];

test('E3: real and link-local addresses in o= / c= / a=rtcp keep today role and family logic (hidden: the neutral address, never the native one)', async () => {
  for (const name of NAMES) {
    const { f, pc, offer } = await project(name, REAL_IN_SDP);
    assert.equal(offer.sdp, expectedText(REAL_IN_SDP, name), name);
    for (const secret of ['10.1.2.3', 'fd00::1', '169.254.1.1', '169.254.1.2', '169.254.1.3', 'fe80::1', 'fe80::2', 'fe80::3']) assert.equal(offer.sdp.includes(secret), false, name + ' leaks ' + secret);
    await pc.setLocalDescription(offer);
    assert.deepEqual(received(f, 'local'), [nativeText(REAL_IN_SDP)], name);
  }
});

test('E3: stats rows keep loopback and unspecified addresses and rewrite real and link-local ones; candidate ids and pair references stay consistent', async () => {
  const row = (id, candidateType, address, port, priority, foundation) => ({ id, type: 'local-candidate', candidateType, address, ip: address, port, protocol: 'udp', priority, foundation });
  const rows = [
    row('L-zero', 'srflx', '0.0.0.0', 10, 1677729535, '11'), row('L-loop', 'host', '127.0.0.1', 11, 2113937151, '12'), row('L-loop6', 'host', '::1', 16, 2113939711, '17'),
    row('L-ll6', 'host', 'fe80::1', 12, 2113939711, '13'), row('L-real4', 'srflx', '203.0.113.77', 13, 1677729535, '14'), row('L-real6', 'host', 'fd00::1', 14, 2113939711, '15'),
    row('L-ll4', 'host', '169.254.106.179', 15, 2113937151, '18'),
    { id: 'pair', type: 'candidate-pair', localCandidateId: 'L-real4', remoteCandidateId: 'L-zero', state: 'succeeded', bytesSent: 9 },
  ];
  // [IPv4 srflx (STUN role), IPv4 host, IPv6 host] per profile; null when that role is hidden.
  const expected = { both: [V4.stun, V4.host, V6.host], v4only: [V4.stun, V4.host, null], v6only: [null, null, V6.host], none: [null, null, null] };
  for (const name of NAMES) {
    const f = fixture(PROFILES[name], { stats: rows }), report = await new f.realm.RTCPeerConnection().getStats(), values = [...report.values()];
    const at = port => values.find(item => item.port === port), pair = values.find(item => item.type === 'candidate-pair'), [stun4, host4, host6] = expected[name];
    for (const port of [10, 11, 16]) {
      const native = rows.find(item => item.port === port);
      assert.equal(at(port).address, native.address, name + ' special ' + port); assert.equal(at(port).ip, native.address, name + ' ip follows address');
      assert.notEqual(at(port).foundation, native.foundation, 'foundation re-derived'); assert.notEqual(at(port).foundation, '');
    }
    for (const [port, want] of [[13, stun4], [15, host4], [12, host6], [14, host6]]) {
      assert.equal(at(port).address, want, name + ' real ' + port); assert.equal(at(port).ip, want, name + ' ip follows address ' + port);
      assert.equal(at(port).foundation === '', want === null, name + ' foundation ' + port);
    }
    const serialized = JSON.stringify(values);
    for (const secret of ['169.254.106.179', 'fe80::1', 'fd00::1', '203.0.113.77']) assert.equal(serialized.includes(secret), false, name + ' leaks ' + secret);
    assert.equal(pair.localCandidateId, at(13).id); assert.equal(pair.remoteCandidateId, at(10).id);
    assert.equal(report.get(at(10).id), at(10));
  }
});

test('E3: ICE error event addresses: placeholders and loopback stay, real and link-local ones follow the host role (null when hidden)', () => {
  const expected = { both: [V4.host, V6.host], v4only: [V4.host, null], v6only: [null, V6.host], none: [null, null] };
  for (const name of NAMES) {
    const f = fixture(PROFILES[name]), at = address => new f.realm.RTCPeerConnectionIceErrorEvent(address).address;
    for (const address of ['0.0.0.0', '::', '127.0.0.1', '::1']) assert.equal(at(address), address, name + ' ' + address);
    for (const address of ['192.168.1.5', '169.254.3.4']) assert.equal(at(address), expected[name][0], name + ' ' + address);
    for (const address of ['fd00::5', 'fe80::2']) assert.equal(at(address), expected[name][1], name + ' ' + address);
    assert.equal(at(null), null);
  }
});

test('E3: link-local IPv4 and IPv6 are real interface addresses: rewritten or hidden in every profile (host set, one family hidden, both hidden) and restored by the inverse map', async () => {
  for (const name of NAMES) {
    const selected = PROFILES[name].addresses, label = name + ': ';
    // Description with o= / c= / a=rtcp / candidates / raddr / remote-candidates, then the inverse map for the whole text and for a page-edited one.
    const { f, pc, offer } = await project(name, LINK_LOCAL);
    assert.equal(mask(offer.sdp), expectedText(LINK_LOCAL, name), label + 'description');
    for (const secret of [LL4, LL6]) assert.equal(offer.sdp.includes(secret), false, label + 'leaks ' + secret);
    await pc.setLocalDescription(offer); await pc.setRemoteDescription({ type: 'answer', sdp: offer.sdp });
    assert.deepEqual(received(f, 'local'), [nativeText(LINK_LOCAL)], label + 'whole-string inverse');
    assert.deepEqual(received(f, 'remote'), [nativeText(LINK_LOCAL)], label + 'whole-string inverse (remote)');
    await pc.setLocalDescription({ type: 'offer', sdp: join([...lineList(offer.sdp), 'a=x-note:1']) });
    assert.equal(received(f, 'local').at(-1), restoredAfterEdit(LINK_LOCAL, name), label + 'per-line inverse after a page edit');
    // Candidate objects of every type: getters, toJSON and the inverse through addIceCandidate.
    const g = fixture(PROFILES[name]), peer = new g.realm.RTCPeerConnection();
    for (const address of [LL4, LL6]) for (const type of ['host', 'srflx', 'prflx', 'relay']) {
      const expected = selected[address === LL4 ? 'ipv4' : 'ipv6'][ROLE[type]], text = candidateAt(address, type), candidate = g.candidate(text);
      assert.equal(candidate.address, expected, label + type + ' ' + address); assert.equal(candidate.candidate === '', expected === null, label + type + ' ' + address);
      assert.equal(candidate.candidate.split(' ').includes(address), false); assert.equal(candidate.toJSON().candidate, candidate.candidate);
      await peer.addIceCandidate(candidate.toJSON());
      assert.equal(received(g, 'candidate').at(-1), text, label + 'addIceCandidate restores the native text');
    }
    // Related addresses take the host role (srflx candidate) or the STUN role (relay candidate) of their own family.
    for (const [type, role] of [['srflx', 'host'], ['relay', 'stun']]) for (const address of [LL4, LL6]) {
      const want = selected[address === LL4 ? 'ipv4' : 'ipv6'][role], own = selected.ipv4[type === 'relay' ? 'turn' : 'stun'];
      const candidate = g.candidate(candidateAt('203.0.113.77', type, ' raddr ' + address + ' rport 7'));
      assert.equal(candidate.relatedAddress, want, label + type + ' raddr ' + address); assert.equal(candidate.candidate === '', own === null, label + type + ' candidate');
      if (own !== null) { assert.equal(candidate.candidate.includes(' raddr '), want !== null); if (want !== null) assert.ok(candidate.candidate.includes(' raddr ' + want + ' rport 7 ')); }
    }
    // Stats rows and ICE error events.
    const rows = [LL4, LL6].map((address, index) => ({ id: 'link-local-' + index, type: 'local-candidate', candidateType: 'host', address, ip: address, port: 40 + index, protocol: 'udp', priority: index ? 2113939711 : 2113937151, foundation: '9' + index }));
    const s = fixture(PROFILES[name], { stats: rows }), values = [...(await new s.realm.RTCPeerConnection().getStats()).values()], wanted = [selected.ipv4.host, selected.ipv6.host];
    assert.deepEqual(values.map(row => row.address), wanted, label + 'stats address'); assert.deepEqual(values.map(row => row.ip), wanted, label + 'stats ip');
    values.forEach((row, index) => assert.equal(row.foundation === '', wanted[index] === null, label + 'stats foundation'));
    const error = address => new s.realm.RTCPeerConnectionIceErrorEvent(address).address;
    assert.equal(error(LL4), wanted[0], label + 'ICE error IPv4'); assert.equal(error(LL6), wanted[1], label + 'ICE error IPv6');
  }
});

test('E3: the classification uses captured intrinsics: page-modified String, RegExp and Array methods change nothing and break nothing', () => {
  const f = fixture(PROFILES.both);
  const special = f.candidate(candidateAt('::1')), loopback = f.candidate(candidateAt('127.0.0.1', 'srflx', ' raddr 0.0.0.0 rport 0'));
  const real = f.candidate(candidateAt('10.9.8.7')), lookalike = f.candidate(candidateAt('fe80::1%eth0'));
  const linkLocal4 = f.candidate(candidateAt('169.254.106.179')), linkLocal6 = f.candidate(candidateAt('fe80::1234:5678:9abc:def0'));
  const targets = [[RegExp.prototype, 'exec'], [String.prototype, 'indexOf'], [String.prototype, 'slice'], [Array.prototype, 'push'], [String.prototype, 'charCodeAt'], [Array.prototype, 'join']];
  const saved = targets.map(([object, key]) => [object, key, Object.getOwnPropertyDescriptor(object, key)]);
  let outcome;
  try {
    for (const [object, key] of targets) Object.defineProperty(object, key, { configurable: true, writable: true, value() { throw new Error('PAGE_' + key); } });
    outcome = [special.address, special.candidate, loopback.address, loopback.relatedAddress, real.address, lookalike.address, linkLocal4.address, linkLocal6.address, linkLocal6.candidate];
  } finally { for (const [object, key, descriptor] of saved) Object.defineProperty(object, key, descriptor); }
  assert.equal(outcome[0], '::1'); assert.equal(outcome[1].split(' ')[4], '::1');
  assert.equal(outcome[2], '127.0.0.1'); assert.equal(outcome[3], '0.0.0.0'); assert.equal(outcome[4], V4.host); assert.equal(outcome[5], V6.host);
  assert.equal(outcome[6], V4.host, 'link-local IPv4 is rewritten'); assert.equal(outcome[7], V6.host, 'link-local IPv6 is rewritten'); assert.equal(outcome[8].split(' ')[4], V6.host);
});

test('E3: the serialized installer (document-start source, no module scope) keeps loopback and unspecified addresses and rewrites link-local ones as well', async () => {
  const serialized = vm.runInNewContext('(' + installWebRtcCustom.toString() + ')', { TextEncoder, DOMException });
  for (const name of NAMES) for (const rows of [GATHERED, GATHERED_V6, LOOPBACK_MIX, LINK_LOCAL]) {
    const f = fixture(PROFILES[name], { sdp: nativeText(rows), installer: serialized }), pc = new f.realm.RTCPeerConnection(), offer = await pc.createOffer(), selected = PROFILES[name].addresses;
    assert.equal(mask(offer.sdp), expectedText(rows, name), name);
    await pc.setLocalDescription(offer); assert.equal(received(f, 'local').at(-1), nativeText(rows), name);
    assert.equal(f.candidate(candidateAt('127.0.0.1')).address, '127.0.0.1'); assert.equal(f.candidate(candidateAt('::1')).address, '::1');
    assert.equal(f.candidate(candidateAt(LL4)).address, selected.ipv4.host, name + ': link-local IPv4 is rewritten');
    assert.equal(f.candidate(candidateAt(LL6)).address, selected.ipv6.host, name + ': link-local IPv6 is rewritten');
  }
});

test('E3: a profile without addresses (native) is untouched; every address profile installs all required hooks', async () => {
  const f = fixture({ ...PROFILES.both, addresses: null }, { sdp: nativeText(GATHERED) }), offer = await new f.realm.RTCPeerConnection().createOffer();
  assert.equal(offer.sdp, nativeText(GATHERED));
  // A missing required hook would make every later RTCPeerConnection construction fail.
  for (const name of NAMES) assert.doesNotThrow(() => new (fixture(PROFILES[name]).realm.RTCPeerConnection)(), name);
});
