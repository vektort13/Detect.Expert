import { describe, expect, it, vi } from 'vitest';
import { previewRtcCapabilities, previewRtcDescription, previewRtcMediaSettings, previewRtcStats, installRtcValueCapture } from '../src/rtc-values';
import { readRtcValue } from '../../contracts/src/rtc-values';
import { SensorRuntime } from '../src/runtime';
import { makeEnv } from './helpers';

describe('ADR-039 selected WebRTC fields', () => {
  it('does not invent a certificate or successful IDB result when ordinary records exhaust the budget', () => {
    const runtime = new SensorRuntime(makeEnv().env);
    const capture = installRtcValueCapture(runtime)!;
    for (let index = 0; index < 40; index++) expect(capture.stored('IDBObjectStore.put', {}, true)).toBe(false);
    expect(runtime.apiResults.snapshot()).toEqual({ rows: [], truncated: false });
    for (let index = 0; index < 40; index++) expect(capture.stored('IDBObjectStore.put', {}, false)).toBe(false);
    expect(runtime.apiResults.snapshot()).toEqual({ rows: [], truncated: true });
    expect(runtime.snapshot().counters).toEqual([]);
  });
  it('does not dispatch through late split/regexp hooks or coercion helpers', () => {
    const read = vi.fn(() => { throw new Error('page intrinsic invoked'); });
    const split = Object.getOwnPropertyDescriptor(String.prototype, Symbol.split);
    const exec = RegExp.prototype.exec, create = Object.create, stringify = globalThis.String;
    let capabilities, description, settings;
    try {
      Object.defineProperty(String.prototype, Symbol.split, { configurable: true, value: read });
      RegExp.prototype.exec = read;
      Object.create = read;
      globalThis.String = read as unknown as StringConstructor;
      capabilities = previewRtcCapabilities({ codecs: [{ mimeType: 'video/H264', sdpFmtpLine: 'apt=1;token=PRIVATE' }] });
      description = previewRtcDescription('v=0\na=ice-pwd:PRIVATE\nm=audio 9 UDP/TLS/RTP/SAVPF 111\na=rtpmap:111 opus/48000/2');
      settings = previewRtcMediaSettings({ width: 640 });
    } finally {
      globalThis.String = stringify; Object.create = create; RegExp.prototype.exec = exec;
      if (split) Object.defineProperty(String.prototype, Symbol.split, split); else Reflect.deleteProperty(String.prototype, Symbol.split);
    }
    expect(read).not.toHaveBeenCalled();
    expect(JSON.stringify([capabilities, description, settings])).not.toContain('PRIVATE');
    expect(readRtcValue(description)).toEqual(description);
  });
  it('rejects late provenance before inspecting a hostile certificate constructor', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'RTCCertificate');
    const trap = vi.fn(() => { throw new Error('constructor trap'); });
    try {
      Object.defineProperty(globalThis, 'RTCCertificate', { configurable: true, value: new Proxy(function Certificate() {}, { getOwnPropertyDescriptor: trap }) });
      expect(installRtcValueCapture(new SensorRuntime({ ...makeEnv().env, earlyCaptureGuaranteed: false }))).toBeUndefined();
      expect(trap).not.toHaveBeenCalled();
    } finally { if (original) Object.defineProperty(globalThis, 'RTCCertificate', original); else Reflect.deleteProperty(globalThis, 'RTCCertificate'); }
  });
  it('retains an explicit configuration result separately from an automatic snapshot', () => {
    const runtime = new SensorRuntime(makeEnv().env);
    const capture = installRtcValueCapture(runtime)!;
    capture.returned('RTCPeerConnection.getConfiguration', { bundlePolicy: 'balanced', certificates: [] });
    capture.configuration({ bundlePolicy: 'max-bundle', certificates: [] });
    const rows = runtime.apiResults.snapshot().rows;
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: 'RTCPeerConnection.getConfiguration', value: expect.objectContaining({ source: 'returned' }) }),
      expect.objectContaining({ operation: 'RTCPeerConnection.configurationSnapshot', value: expect.objectContaining({ source: 'native-snapshot' }) }),
    ]));
  });
  it('retains codec order and known parameters without arbitrary data fields', () => {
    const secret = vi.fn(() => { throw new Error('private field read'); });
    const row = { mimeType: 'video/H264', clockRate: 90000, sdpFmtpLine: 'packetization-mode=1; profile-level-id=42e01f;token=PRIVATE_TOKEN' };
    Object.defineProperty(row, 'private', { get: secret });
    const value = previewRtcCapabilities({ codecs: [row, { mimeType: 'video/VP8', clockRate: 90000 }], headerExtensions: [{ uri: 'urn:ietf:params:rtp-hdrext:sdes:mid' }] });
    expect(value.fields.filter(field => field.name === 'codec.mimeType').map(field => field.value)).toEqual(['video/H264', 'video/VP8']);
    expect(value.fields.find(field => field.name === 'codec.parameters')?.value).toBe('packetization-mode=1;profile-level-id=42e01f');
    expect(value.truncated).toBe(true); expect(JSON.stringify(value)).not.toContain('PRIVATE'); expect(secret).not.toHaveBeenCalled();
    expect(readRtcValue(value)).toEqual(value);
  });
  it('extracts only safe SDP fields and full fingerprint while dropping identifiers and ICE secrets', () => {
    const fingerprint = Array(32).fill('A1').join(':');
    const source = ['v=0', 'o=- PRIVATE_ORIGIN 1 IN IP4 192.0.2.17', 'a=ice-ufrag:PRIVATE_UFRAG', 'a=ice-pwd:PRIVATE_PASSWORD',
      'm=audio 9 UDP/TLS/RTP/SAVPF 111 0', 'a=rtpmap:111 opus/48000/2', 'a=fmtp:111 minptime=10;useinbandfec=1',
      'a=rtpmap:0 PCMU/8000', 'a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level', 'a=fingerprint:sha-256 ' + fingerprint,
      'a=setup:actpass', 'a=sendrecv', 'a=rtcp-mux', 'a=ssrc:PRIVATE_SSRC', 'a=candidate:PRIVATE_CANDIDATE'].join('\r\n');
    const value = previewRtcDescription(source, 'offer');
    expect(readRtcValue(value)).toEqual(value);
    expect(value.fields.find(field => field.name === 'certificate.sha-256')?.value).toBe(fingerprint);
    expect(value.fields.find(field => field.name === 'media.payloadTypes')?.value).toBe('111 0');
    expect(value.fields.find(field => field.name === 'codec.clockRate')?.value).toBe(48000);
    expect(JSON.stringify(value)).not.toMatch(/PRIVATE|192\.0\.2|ice-pwd|ice-ufrag/);
  });
  it('does not read device IDs, private certificate bytes or stats identifiers', () => {
    const read = vi.fn(() => { throw new Error('private read'); });
    const stats = { type: 'certificate', fingerprintAlgorithm: 'sha-256', fingerprint: Array(32).fill('22').join(':') };
    for (const name of ['id', 'base64Certificate', 'issuerCertificateId']) Object.defineProperty(stats, name, { get: read });
    expect(previewRtcStats(stats).fields.some(field => field.name === 'certificate.sha-256')).toBe(true);
    const settings = { width: 640, height: 480, frameRate: 30, echoCancellation: true };
    for (const name of ['deviceId', 'groupId', 'label']) Object.defineProperty(settings, name, { get: read });
    expect(previewRtcMediaSettings(settings).fields).toHaveLength(4); expect(read).not.toHaveBeenCalled();
  });
  it('bounds SDP input, row counts and unknown encoder labels without guessing hardware', () => {
    expect(previewRtcDescription('x'.repeat(32769))).toMatchObject({ truncated: true, fields: [] });
    expect(previewRtcCapabilities({ codecs: Array(1000).fill({ mimeType: 'video/VP8', clockRate: 90000 }) }).truncated).toBe(true);
    const value = previewRtcStats({ type: 'outbound-rtp', encoderImplementation: 'CUSTOM_PRIVATE_ENCODER', powerEfficientEncoder: true });
    expect(value.truncated).toBe(true); expect(JSON.stringify(value)).not.toContain('CUSTOM_PRIVATE_ENCODER');
    expect(value.fields.find(field => field.name === 'stats.powerEfficientEncoder')?.value).toBe(true);
  });
  it('never enables native data reads on a late or unproven realm', () => {
    const early = makeEnv();
    expect(installRtcValueCapture(new SensorRuntime({ ...early.env, earlyCaptureGuaranteed: false }))).toBeUndefined();
    expect(installRtcValueCapture(new SensorRuntime({ ...early.env, earlyCaptureGuaranteed: true, startedLate: true }))).toBeUndefined();
  });
});