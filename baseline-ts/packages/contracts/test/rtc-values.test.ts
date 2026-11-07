import { describe, expect, it, vi } from 'vitest';
import { readRtcValue, RTC_VALUE_LIMITS, rtcValueBytes } from '../src/rtc-values';
import type { RtcValue } from '../src/rtc-values';
import { readApiResultsSnapshot } from '../src/api-results';
import { compileSchema } from './helpers';

const certificate = (): RtcValue => ({ kind: 'webrtc', profile: 'certificate', source: 'returned', truncated: false,
  fields: [{ name: 'certificate.sha-256', index: 0, value: Array(32).fill('A7').join(':') }] });

describe('ADR-039 bounded WebRTC values', () => {
  it('cross-checks structured results and source restrictions with JSON Schema', () => {
    const schema = compileSchema('api-results.v1.schema.json');
    const row = { operation: 'RTCCertificate.getFingerprints', techniqueId: 'DET-057', phase: 'returned-sync', value: certificate() };
    const message = { schemaVersion: 1, type: 'api-results-state', documentKey: '7:0:document', available: true, integrity: 'page-controlled', rows: [row], truncated: false };
    expect(schema(message)).toBe(true);
    for (const value of [{ ...certificate(), source: 'native-snapshot' }, { ...certificate(), fields: [{ name: 'certificate.sha-256', index: 0, value: 'PRIVATE' }] },
      { ...certificate(), fields: [{ name: 'ice.pwd', index: 0, value: 'PRIVATE' }] }]) expect(schema({ ...message, rows: [{ ...row, value }] })).toBe(false);
    expect(schema({ ...message, rows: [{ ...row, operation: 'RTCSessionDescription.sdp', value: { kind: 'string', value: 'v=0\na=ice-pwd:SECRET' } }] })).toBe(false);
    for (const member of ['localDescription', 'currentLocalDescription', 'pendingLocalDescription', 'remoteDescription', 'currentRemoteDescription', 'pendingRemoteDescription']) {
      const invalid = { ...row, operation: 'RTCPeerConnection.' + member, value: { kind: 'string', value: 'a=ice-pwd:PRIVATE' } };
      expect(readApiResultsSnapshot({ rows: [invalid], truncated: false })).toBeNull();
      expect(schema({ ...message, rows: [invalid] })).toBe(false);
    }
  });
  it('allows structured data only on the matching result operation and never raw SDP', () => {
    const value = certificate();
    const row = { operation: 'RTCCertificate.getFingerprints', techniqueId: 'DET-057', phase: 'returned-sync', value };
    expect(readApiResultsSnapshot({ rows: [row], truncated: false })?.rows[0]?.value).toEqual(value);
    expect(readApiResultsSnapshot({ rows: [{ ...row, operation: 'RTCPeerConnection.generateCertificate', phase: 'settlement-unobserved' }], truncated: false })).toBeNull();
    expect(readApiResultsSnapshot({ rows: [{ ...row, operation: 'RTCSessionDescription.sdp', value: { kind: 'string', value: 'v=0\na=ice-pwd:SECRET' } }], truncated: false })).toBeNull();
    expect(readApiResultsSnapshot({ rows: [{ ...row, operation: 'Navigator.hardwareConcurrency', techniqueId: 'DET-032' }], truncated: false })).toBeNull();
  });
  it('admits full fingerprint without a private key or persistent identity field', () => {
    const value = certificate();
    expect(readRtcValue(value)).toEqual(value);
    expect(readRtcValue(value)).not.toBe(value);
    expect(readRtcValue({ ...value, privateKey: 'PRIVATE_KEY' })).toBeNull();
    expect(readRtcValue({ ...value, fields: [{ name: 'certificate.sha-256', index: 0, value: 'CERTIFICATE_SECRET' }] })).toBeNull();
  });
  it('keeps returned and extra native snapshots distinct', () => {
    expect(readRtcValue({ ...certificate(), source: 'native-snapshot' })?.source).toBe('native-snapshot');
    expect(readRtcValue({ ...certificate(), source: 'browser-observed' })).toBeNull();
    expect(readRtcValue({ ...certificate(), profile: 'configuration' })).toBeNull();
    expect(readRtcValue({ ...certificate(), profile: 'configuration', source: 'native-snapshot' })?.fields).toEqual(certificate().fields);
  });
  it('rejects raw SDP, ICE credentials, device identifiers and unknown fields', () => {
    for (const name of ['sdp', 'ice.pwd', 'ice.ufrag', 'candidate.address', 'deviceId', 'stats.id', 'storage.name']) {
      expect(readRtcValue({ ...certificate(), fields: [{ name, index: 0, value: 'PRIVATE_DATA' }] })).toBeNull();
    }
    expect(readRtcValue({ ...certificate(), fields: [{ name: 'codec.mimeType', index: 0, value: 'video/VP8' }] })).toBeNull();
  });
  it('allows known codec parameters, not arbitrary fmtp or extension URLs', () => {
    const value: RtcValue = { kind: 'webrtc', profile: 'capabilities', source: 'returned', truncated: false,
      fields: [{ name: 'codec.mimeType', index: 0, value: 'video/H264' }, { name: 'codec.parameters', index: 0, value: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f' }] };
    expect(readRtcValue(value)).toEqual(value);
    for (const content of ['sprop-parameter-sets=SECRET', 'profile-level-id=SECRET', 'https://private.invalid/', 'apt=1;token=SECRET']) {
      expect(readRtcValue({ ...value, fields: [{ name: 'codec.parameters', index: 0, value: content }] })).toBeNull();
    }
    expect(readRtcValue({ ...value, fields: [{ name: 'headerExtension.uri', index: 0, value: 'https://private.invalid/' }] })).toBeNull();
  });
  it('enforces unique fields, numeric bounds, total bytes and array limits', () => {
    const value = certificate();
    expect(readRtcValue({ ...value, fields: [...value.fields, ...value.fields] })).toBeNull();
    expect(readRtcValue({ ...value, fields: [{ name: 'certificate.expires', index: 0, value: Infinity }] })).toBeNull();
    expect(readRtcValue({ ...value, fields: [{ ...value.fields[0], index: 32 }] })).toBeNull();
    expect(readRtcValue({ ...value, fields: Array(RTC_VALUE_LIMITS.fields + 1).fill(value.fields[0]) })).toBeNull();
    const large: RtcValue = { ...value, fields: Array.from({ length: 32 }, (_, index) => ({ name: 'certificate.sha-512', index, value: Array(64).fill('AB').join(':') })) };
    expect(rtcValueBytes(large)).toBeGreaterThan(RTC_VALUE_LIMITS.bytes);
    expect(readRtcValue(large)).toBeNull();
  });
  it('never invokes accessors and rejects extra array properties', () => {
    const read = vi.fn(() => 'SECRET');
    const value = certificate();
    Object.defineProperty(value.fields[0], 'value', { get: read, enumerable: true });
    expect(readRtcValue(value)).toBeNull(); expect(read).not.toHaveBeenCalled();
    const array = certificate(); Object.assign(array.fields, { extra: true });
    expect(readRtcValue(array)).toBeNull();
  });
});