// ADR-064: dual-family projection must not reveal a hidden family's native IP.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installWebRtcCustom } from '../../apps/production-extension/api-custom-webrtc-runtime.js';

const emptyFamily = () => ({ host: null, stun: null, turn: null });
const addresses = () => ({ ipv4: { host: '192.0.2.10', stun: '198.51.100.20', turn: '203.0.113.30' }, ipv6: { host: '2001:db8::10', stun: '2001:db8::20', turn: '2001:db8::30' } });
const profile = (patch = {}) => ({ addresses: addresses(), iceTransportPolicy: 'preserve', randomizeDevices: false, freshCertificates: false, deviceLifetime: 'session', ...patch });
const native4 = '10.11.12.13', native6 = 'fd12:3456:789a::42';
const candidateText = (address, type = 'srflx', related = address.includes(':') ? 'fd12::1' : '10.0.0.1') => `candidate:original 1 UDP 2122260223 ${address} 5000 typ ${type} raddr ${related} rport 5001 generation 0`;
const nativeSdp = [
  'v=0', `o=- 1 1 IN IP6 ${native6}`, 's=-', `c=IN IP4 ${native4}`, `a=rtcp:9 IN IP6 ${native6}`,
  'a=' + candidateText(native4), 'a=' + candidateText(native6, 'relay'),
  `a=remote-candidates:1 ${native4} 5000 2 ${native6} 5001`,
  'a=fingerprint:sha-256 AA:BB:CC:DD', ''
].join('\r\n');

function fixture(value = profile(), installer = installWebRtcCustom) {
  const raw = new WeakMap(), connections = new WeakMap(), calls = [], brand = new TypeError('NATIVE_BRAND');
  const checked = receiver => { const value = raw.get(receiver); if (!value) throw brand; return value; };
  class RTCIceCandidate {
    constructor(init = {}) {
      const text = init.candidate ?? '', parts = text.split(' '), related = parts.indexOf('raddr');
      raw.set(this, { candidate: text, type: parts[7] ?? null, address: parts[4] ?? null, relatedAddress: related < 0 ? null : parts[related + 1], foundation: parts[0]?.replace('candidate:', '') ?? null });
    }
    get candidate() { return checked(this).candidate; }
    get type() { return checked(this).type; }
    get address() { return checked(this).address; }
    get relatedAddress() { return checked(this).relatedAddress; }
    get foundation() { return checked(this).foundation; }
    toJSON() { return { candidate: checked(this).candidate, sdpMid: '0', sdpMLineIndex: 0, usernameFragment: 'native-ufrag' }; }
  }
  class RTCSessionDescription {
    constructor(init) { raw.set(this, { type: init.type, sdp: init.sdp }); }
    get type() { return checked(this).type; }
    get sdp() { return checked(this).sdp; }
    toJSON() { return { ...checked(this) }; }
  }
  const checkedPc = receiver => { const value = connections.get(receiver); if (!value) throw brand; return value; };
  class RTCPeerConnection {
    constructor(config = {}) {
      const certificates = config.certificates ?? [{ native: true, number: calls.filter(row => row[0] === 'construct').length }];
      connections.set(this, { config: { iceTransportPolicy: config.iceTransportPolicy ?? 'all', certificates } }); calls.push(['construct']);
    }
    getConfiguration() { return checkedPc(this).config; }
    setConfiguration(config) { checkedPc(this).config = { iceTransportPolicy: config.iceTransportPolicy, certificates: config.certificates }; calls.push(['setConfiguration']); }
    createOffer(callback) {
      checkedPc(this); calls.push(['offer']); const result = { type: 'offer', sdp: nativeSdp };
      if (typeof callback === 'function') { callback(result); return Promise.resolve(); }
      return Promise.resolve(result);
    }
    createAnswer() { checkedPc(this); calls.push(['answer']); return Promise.resolve({ type: 'answer', sdp: nativeSdp }); }
    setLocalDescription(init) { checkedPc(this).local = { type: init.type, sdp: init.sdp }; calls.push(['local']); return Promise.resolve(); }
    setRemoteDescription(init) { checkedPc(this).remote = { type: init.type, sdp: init.sdp }; calls.push(['remote']); return Promise.resolve(); }
    addIceCandidate(init) { checkedPc(this); calls.push(['candidate', init.candidate]); return Promise.resolve(); }
    get localDescription() { const row = checkedPc(this).local; return row ? new RTCSessionDescription(row) : null; }
    get remoteDescription() { const row = checkedPc(this).remote; return row ? new RTCSessionDescription(row) : null; }
    getStats() {
      checkedPc(this); calls.push(['stats']);
      return Promise.resolve(new Map([
        ['v4-' + native4, { id: 'v4-' + native4, type: 'local-candidate', candidateType: 'srflx', address: native4, foundation: 'private4', protocol: 'udp', url: 'stun:' + native4, relatedAddress: native4 }],
        ['v6-' + native6, { id: 'v6-' + native6, type: 'local-candidate', candidateType: 'relay', address: native6, ip: native6, foundation: 'private6', protocol: 'udp' }],
        ['pair', { id: 'pair', type: 'candidate-pair', localCandidateId: 'v4-' + native4, remoteCandidateId: 'v6-' + native6, state: 'succeeded', bytesSent: 9 }],
        ['certificate', { id: 'certificate', type: 'certificate', fingerprint: 'AA:BB:CC:DD', fingerprintAlgorithm: 'sha-256' }]
      ]));
    }
  }
  class RTCPeerConnectionIceErrorEvent {
    constructor(address) { raw.set(this, { address }); }
    get address() { return checked(this).address; }
    get url() { checked(this); return 'stun:' + native4; }
    get errorText() { checked(this); return native6; }
  }
  class RTCIceTransport {
    getLocalCandidates() { return [new RTCIceCandidate({ candidate: candidateText(native4) }), new RTCIceCandidate({ candidate: candidateText(native6) })]; }
    getRemoteCandidates() { return this.getLocalCandidates(); }
    getSelectedCandidatePair() { return { local: this.getLocalCandidates()[0], remote: this.getLocalCandidates()[1] }; }
  }
  const realm = { Object, Array, Promise, RTCPeerConnection, webkitRTCPeerConnection: RTCPeerConnection, mozRTCPeerConnection: RTCPeerConnection, RTCIceCandidate, RTCSessionDescription, RTCPeerConnectionIceErrorEvent, RTCIceTransport, DOMException };
  const installation = installer(realm, [{ id: 'webrtc', mode: 'custom', value }]);
  return { realm, installation, raw, connections, calls, brand };
}

test('host, STUN and TURN candidates keep their native address family and use independently chosen overrides', () => {
  const f = fixture();
  for (const [native, family] of [[native4, 'ipv4'], [native6, 'ipv6']]) for (const [type, role] of [['host', 'host'], ['srflx', 'stun'], ['prflx', 'stun'], ['relay', 'turn']]) {
    const candidate = new f.realm.RTCIceCandidate({ candidate: candidateText(native, type) });
    const expected = addresses()[family][role], related = addresses()[family][type === 'relay' ? 'stun' : 'host'];
    assert.equal(candidate.address, expected); assert.equal(candidate.relatedAddress, related);
    assert.ok(candidate.candidate.includes(' ' + expected + ' ')); assert.ok(candidate.candidate.includes('raddr ' + related));
    assert.equal(candidate.toJSON().candidate, candidate.candidate); assert.equal(candidate.candidate.split(' ')[0], 'candidate:' + candidate.foundation);
    assert.equal(JSON.stringify({ candidate: candidate.toJSON(), address: candidate.address, relatedAddress: candidate.relatedAddress }).includes(native), false);
  }
});

test('disabled IPv6 suppresses all covered metadata without exposing native addresses or breaking own local round trips', async () => {
  const selected = addresses(); selected.ipv6 = emptyFamily(); const f = fixture(profile({ addresses: selected }));
  const candidate = new f.realm.RTCIceCandidate({ candidate: candidateText(native6) });
  assert.equal(candidate.candidate, ''); assert.equal(candidate.address, null); assert.equal(candidate.relatedAddress, null); assert.equal(candidate.foundation, '');
  const init = candidate.toJSON(); assert.equal(init.candidate, '');
  const pc = new f.realm.RTCPeerConnection(); await pc.addIceCandidate(init);
  assert.equal(f.calls.find(row => row[0] === 'candidate')[1], candidateText(native6), 'private object identity restores only the native setter argument');
  const offer = await pc.createOffer();
  assert.ok(offer.sdp.includes('o=- 1 1 IN IP6 ::')); assert.ok(offer.sdp.includes('a=rtcp:9 IN IP6 ::'));
  assert.equal(offer.sdp.includes(native6), false); assert.equal(offer.sdp.includes('2001:db8:'), false);
  assert.equal(offer.sdp.includes('a=remote-candidates:1 198.51.100.20 5000'), true);
  await pc.setLocalDescription(offer); assert.equal(f.connections.get(pc).local.sdp, nativeSdp);
  assert.equal(pc.localDescription.sdp, offer.sdp); assert.equal(pc.localDescription.toJSON().sdp, offer.sdp);
});

test('null is applied per role rather than silently borrowing another family or preserving the native value', () => {
  const selected = addresses(); selected.ipv4.stun = null; selected.ipv4.host = null;
  const f = fixture(profile({ addresses: selected }));
  const hidden = new f.realm.RTCIceCandidate({ candidate: candidateText(native4) }); assert.equal(hidden.candidate, ''); assert.equal(hidden.address, null);
  const retained = new f.realm.RTCIceCandidate({ candidate: candidateText(native6) }); assert.equal(retained.address, '2001:db8::20');
  const relay = new f.realm.RTCIceCandidate({ candidate: candidateText(native4, 'relay') });
  assert.equal(relay.address, '203.0.113.30'); assert.equal(relay.relatedAddress, null);
  assert.equal(relay.candidate.includes('raddr'), false); assert.equal(relay.candidate.includes('rport'), false);
});

test('SDP projects both families, preserves native fingerprints, and restores only known own descriptions', async () => {
  const f = fixture(), pc = new f.realm.RTCPeerConnection(), offer = await pc.createOffer();
  assert.ok(offer.sdp.includes('o=- 1 1 IN IP6 2001:db8::10')); assert.ok(offer.sdp.includes('c=IN IP4 192.0.2.10'));
  assert.ok(offer.sdp.includes('a=rtcp:9 IN IP6 2001:db8::10'));
  assert.ok(offer.sdp.includes('a=remote-candidates:1 198.51.100.20 5000 2 2001:db8::20 5001'));
  assert.ok(offer.sdp.includes('a=fingerprint:sha-256 AA:BB:CC:DD'));
  assert.equal(offer.sdp.includes(native4), false); assert.equal(offer.sdp.includes(native6), false);
  const external = { type: 'offer', sdp: 'v=0\r\no=- 2 2 IN IP4 198.18.0.1\r\ns=-\r\n' };
  await pc.setRemoteDescription(external); assert.deepEqual(f.connections.get(pc).remote, external, 'incoming remote offer is passed to the actual native setter');
  assert.equal(f.calls.filter(row => row[0] === 'offer').length, 1);
});

test('stats Map iteration, direct Map getters and candidate IDs expose only matching-family metadata', async () => {
  const f = fixture(), report = await new f.realm.RTCPeerConnection().getStats();
  const rows = [...report.values()], v4 = rows.find(row => row.address === '198.51.100.20'), v6 = rows.find(row => row.address === '2001:db8::30');
  assert.ok(v4); assert.ok(v6); assert.equal(v6.ip, v6.address);
  const pair = rows.find(row => row.type === 'candidate-pair'); assert.equal(pair.localCandidateId, v4.id); assert.equal(pair.remoteCandidateId, v6.id);
  assert.equal(Map.prototype.get.call(report, v4.id), v4); assert.equal(Map.prototype.get.call(report, v6.id), v6);
  assert.equal(rows.find(row => row.type === 'certificate').fingerprint, 'AA:BB:CC:DD');
  let serialized = JSON.stringify([...report]); report.forEach((row, id) => { serialized += JSON.stringify([row, id]); });
  assert.equal(serialized.includes(native4), false); assert.equal(serialized.includes(native6), false); assert.equal(serialized.includes('stun:'), false);
  const selected = addresses(); selected.ipv6 = emptyFamily();
  const hidden = await new (fixture(profile({ addresses: selected })).realm.RTCPeerConnection)().getStats();
  const hiddenRow = [...hidden.values()].find(row => row.type === 'local-candidate' && row.candidateType === 'relay');
  assert.equal(hiddenRow.address, null); assert.equal(hiddenRow.ip, null); assert.equal(hiddenRow.foundation, '');
});

test('ICE transports, error event getters and native prototype access use the same suppression', () => {
  const selected = addresses(); selected.ipv6 = emptyFamily(); const f = fixture(profile({ addresses: selected }));
  const transport = new f.realm.RTCIceTransport();
  for (const method of ['getLocalCandidates', 'getRemoteCandidates']) {
    const rows = transport[method](); assert.equal(rows[0].address, '198.51.100.20'); assert.equal(rows[1].address, null);
    assert.equal(f.realm.RTCIceCandidate.prototype.toJSON.call(rows[1]).candidate, '');
  }
  const pair = transport.getSelectedCandidatePair(); assert.equal(pair.local.address, '198.51.100.20'); assert.equal(pair.remote.address, null);
  const error = new f.realm.RTCPeerConnectionIceErrorEvent(native6); assert.equal(error.address, null); assert.equal(error.url, ''); assert.equal(error.errorText, '');
  assert.throws(() => Object.getOwnPropertyDescriptor(f.realm.RTCIceCandidate.prototype, 'address').get.call({}), value => value === f.brand);
});

test('addresses null preserves native addresses while DTLS freshness and relay use actual native configuration', () => {
  const f = fixture(profile({ addresses: null, freshCertificates: true, iceTransportPolicy: 'relay' })); let reads = 0;
  const pc = new f.realm.RTCPeerConnection({ get certificates() { reads++; throw Error('unused'); }, get iceTransportPolicy() { reads++; throw Error('unused'); } });
  assert.equal(reads, 0); assert.equal(pc.getConfiguration().iceTransportPolicy, 'relay'); assert.equal(pc.getConfiguration().certificates[0].native, true);
  const second = new f.realm.RTCPeerConnection(); assert.notEqual(second.getConfiguration().certificates[0].number, pc.getConfiguration().certificates[0].number);
  assert.equal(new f.realm.RTCIceCandidate({ candidate: candidateText(native4) }).address, native4);
});

test('document-start serialized installer keeps its complete dual-family behavior without module globals', async () => {
  const serializedInstaller = vm.runInNewContext('(' + installWebRtcCustom.toString() + ')', { TextEncoder, DOMException });
  const f = fixture(profile(), serializedInstaller), pc = new f.realm.RTCPeerConnection(), offer = await pc.createOffer();
  assert.equal(offer.sdp.includes(native4), false); assert.equal(offer.sdp.includes(native6), false);
  assert.ok(offer.sdp.includes('2001:db8::30'));
  await pc.setLocalDescription(offer); assert.equal(f.connections.get(pc).local.sdp, nativeSdp);
});
