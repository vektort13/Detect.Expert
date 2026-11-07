// Runs inside an owned fixture page, using only a self-host STUN/TURN service and fake media devices.
export async function webRtcNativeProbe({ port, username, credential, iceHost = '127.0.0.1', addresses = null, randomized = false, freshCertificates = false }) {
  const checks = [], pcs = [], streams = [];
  const verify = (condition, name) => { if (!condition) throw Error(name); checks.push(name); };
  const prototypeGet = (object, key) => {
    for (let proto = Object.getPrototypeOf(object); proto; proto = Object.getPrototypeOf(proto)) {
      const getter = Object.getOwnPropertyDescriptor(proto, key)?.get;
      if (getter) return getter.call(object);
    }
    return object[key];
  };
  // Legacy flat expectations remain supported for historical fixture runners;
  // current production configurations supply independent nullable IP families.
  const dual = addresses && Object.hasOwn(addresses, 'ipv4') && Object.hasOwn(addresses, 'ipv6');
  const valuesForRole = type => dual ? [addresses.ipv4[type], addresses.ipv6[type]] : [addresses[type]];
  const allowed = addresses ? new Set([...(dual ? [...Object.values(addresses.ipv4), ...Object.values(addresses.ipv6)] : Object.values(addresses)).filter(value => typeof value === 'string'), '0.0.0.0', '::', '127.0.0.1', '::1']) : null; // special addresses are never rewritten (Chrome writes 127.0.0.1 in o=)
  // Special addresses (loopback and unspecified) are never rewritten by the Custom projection; link-local addresses are real interface addresses and ARE rewritten.
  // Chrome spells IPv6 placeholders in brackets in the candidate getters ("[::1]", "[::]").
  const special = value => { if (typeof value !== 'string') return false; const bare = value.replace(/^\[(.*)\]$/, '$1'); return bare === '0.0.0.0' || bare === '::' || bare === '::1' || /^127\./.test(bare); };
  const candidateType = candidate => candidate.type === 'relay' ? 'turn' : ['srflx', 'prflx'].includes(candidate.type) ? 'stun' : 'host';
  function inspectCandidate(candidate) {
    if (!addresses) return;
    // Firefox also emits a non-null, empty end-of-candidates object. It has no
    // address to replace and must keep its native terminal representation.
    if (candidate.candidate === '') {
      verify(candidate.address === null || candidate.address === undefined || candidate.address === '', 'terminal ICE candidate contains no address');
      verify(candidate.toJSON().candidate === '', 'terminal ICE candidate toJSON remains empty');
      return;
    }
    const type = candidateType(candidate), wanted = valuesForRole(type);
    verify(wanted.includes(candidate.address) || special(candidate.address), type + ' native candidate address matches Custom');
    verify(prototypeGet(candidate, 'address') === candidate.address, type + ' borrowed candidate address getter matches Custom');
    const strings = [candidate.candidate, candidate.toJSON().candidate, prototypeGet(candidate, 'candidate')];
    verify(strings.every(text => (text.match(/(?:\d{1,3}\.){3}\d{1,3}/g) ?? []).every(value => allowed.has(value))), type + ' candidate strings and toJSON contain only configured addresses');
    if (candidate.relatedAddress) verify(allowed.has(candidate.relatedAddress), type + ' related address is sanitized');
  }
  function inspectSdp(description, name) {
    if (!addresses || !description) return;
    verify((description.sdp.match(/(?:\d{1,3}\.){3}\d{1,3}/g) ?? []).every(value => allowed.has(value)), name + ' SDP addresses are sanitized');
    if (typeof description.toJSON === 'function') verify(description.toJSON().sdp === description.sdp, name + ' SDP toJSON agrees');
    const getter = Object.getOwnPropertyDescriptor(globalThis.RTCSessionDescription?.prototype ?? {}, 'sdp')?.get;
    if (getter && description instanceof RTCSessionDescription) verify(getter.call(description) === description.sdp, name + ' borrowed SDP getter agrees');
  }
  try {
    for (const transport of ['stun', 'turn']) {
      const iceServers = transport === 'stun' ? [{ urls: 'stun:' + iceHost + ':' + port }] : [{ urls: 'turn:' + iceHost + ':' + port + '?transport=udp', username, credential }];
      const pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: transport === 'turn' ? 'relay' : 'all' }); pcs.push(pc); pc.createDataChannel('owned-fixture');
      const candidates = [], errors = []; let timer;
      const gathered = new Promise(resolve => {
        timer = setTimeout(resolve, 7000);
        pc.addEventListener('icecandidate', event => { if (event.candidate) candidates.push(event.candidate); else { clearTimeout(timer); resolve(); } });
        pc.addEventListener('icecandidateerror', event => errors.push(event.errorCode));
      });
      const offer = await pc.createOffer(); inspectSdp(offer, transport + ' offer'); await pc.setLocalDescription(offer); await gathered; clearTimeout(timer);
      verify(candidates.some(candidate => candidate.type === (transport === 'stun' ? 'srflx' : 'relay')), transport + ' real browser gathered the expected candidate type');
      for (const candidate of candidates) inspectCandidate(candidate);
      for (const field of ['localDescription', 'currentLocalDescription', 'pendingLocalDescription']) inspectSdp(pc[field], transport + ' ' + field);
      if (addresses) {
        const report = await pc.getStats(), records = [...report.values()];
        const candidateRecords = records.filter(record => record.type === 'local-candidate');
        verify(candidateRecords.length > 0, transport + ' actual getStats contains candidates');
        for (const record of candidateRecords) {
          const type = record.candidateType === 'relay' ? 'turn' : ['srflx', 'prflx'].includes(record.candidateType) ? 'stun' : 'host';
          const fields = ['address', 'ip'].filter(field => Object.hasOwn(record, field)), wanted = valuesForRole(type);
          verify(fields.length > 0 && fields.every(field => wanted.includes(record[field]) || special(record[field])), transport + ' stats candidate agrees with Custom');
          verify(report.get(record.id).address === record.address, transport + ' getStats get agrees with values');
        }
        const traversed = []; report.forEach(record => traversed.push(record.id)); verify(traversed.length === records.length, transport + ' stats forEach is complete');
        verify([...report].every(([id, value]) => value.id === id), transport + ' stats iterator preserves IDs');
      }
    }
    if (freshCertificates) {
      const shared = await RTCPeerConnection.generateCertificate({ name: 'ECDSA', namedCurve: 'P-256' });
      const fingerprints = [];
      for (let index = 0; index < 2; index++) {
        const pc = new RTCPeerConnection({ certificates: [shared], iceServers: [] }); pcs.push(pc); pc.createDataChannel('certificate-test');
        const offer = await pc.createOffer(); fingerprints.push(/^a=fingerprint:.*$/m.exec(offer.sdp)?.[0]);
      }
      verify(Boolean(fingerprints[0]) && fingerprints[0] !== fingerprints[1], 'native DTLS certificate changes even when the page reuses a certificate');
    }
    let deviceAliases = [];
    if (randomized) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true }); streams.push(stream);
      const devices = await navigator.mediaDevices.enumerateDevices();
      const actual = devices.filter(device => !['', 'default', 'communications'].includes(device.deviceId));
      verify(actual.length > 0 && actual.every(device => /^[a-f0-9]{64}$/.test(device.deviceId)), 'actual fake media devices expose random identifiers');
      verify(actual.every(device => prototypeGet(device, 'deviceId') === device.deviceId), 'borrowed MediaDeviceInfo getter agrees');
      const again = await navigator.mediaDevices.enumerateDevices(); verify(JSON.stringify(devices.map(device => device.deviceId)) === JSON.stringify(again.map(device => device.deviceId)), 'device identifiers are stable across repeated enumeration');
      const camera = devices.find(device => device.kind === 'videoinput'); verify(Boolean(camera), 'permission-filtered enumeration retains a camera');
      const selected = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: camera.deviceId } } }); streams.push(selected);
      verify(selected.getVideoTracks()[0].getSettings().deviceId === camera.deviceId, 'aliased exact device selection reaches the same real device');
      const frame = document.createElement('iframe'); document.body.append(frame);
      try {
        const getter = Object.getOwnPropertyDescriptor(frame.contentWindow.MediaDeviceInfo.prototype, 'deviceId')?.get;
        verify(!getter || getter.call(camera) === camera.deviceId, 'same-origin child borrowed getter keeps the selected device alias');
      } finally { frame.remove(); }
      deviceAliases = devices.map(device => device.deviceId);
    }
    return { checks, deviceAliases, firstInline: globalThis.__rtcFirstInline === true };
  } finally { for (const stream of streams) for (const track of stream.getTracks()) track.stop(); for (const pc of pcs) pc.close(); }
}
