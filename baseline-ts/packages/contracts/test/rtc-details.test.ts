import { describe, expect, it } from 'vitest';
import { RTC_DETAILS_CHANNEL, parseRtcServerUrl, validateRtcControl, validateRtcPageRequest, validateRtcSensorMessage, validateRtcSnapshot, validateRtcStateResponse, validateRtcUiRequest } from '../src/rtc-details';
import type { RtcSnapshot } from '../src/rtc-details';
const snapshot = (): RtcSnapshot => ({ revision: 2, total: 1, omitted: 0, captureLimited: false, connections: [{ id: 1, created: true, closed: true, connected: false, state: 'closed', duration: 'under-1s', configurationChanges: 0, truncated: false,
  servers: [{ scheme: 'turn', host: 'relay.example', port: 3478, transport: 'tcp', configured: true, candidate: false, error: false }] }] });
describe('ADR-020 bounded server metadata', () => {
  it('parses only endpoint fields and permits server literal IP without peer candidate data', () => {
    expect(parseRtcServerUrl('STUN:stun.example:19302')).toEqual({ scheme: 'stun', host: 'stun.example', port: 19302, transport: null });
    expect(parseRtcServerUrl('turns:relay.example:5349?transport=tcp')).toEqual({ scheme: 'turns', host: 'relay.example', port: 5349, transport: 'tcp' });
    expect(parseRtcServerUrl('stun:127.0.0.1:9999')?.host).toBe('127.0.0.1');
    expect(parseRtcServerUrl('turn:[::1]:3478?transport=udp')?.host).toBe('[::1]');
  });
  it('rejects credentials, query secrets, paths, malformed hosts and nonprimitive inputs without getters', () => {
    for (const value of ['turn:user:password@relay.example', 'turn:relay.example?token=CANARY', 'stun:relay.example/path', 'stun:relay.example#CANARY', 'https://relay.example', 'stun:a..b', 'stun:a.-b', 'stun:a:0', 'stun:a:65536', 'stun:' + 'a'.repeat(254)]) expect(parseRtcServerUrl(value)).toBeNull();
    let reads = 0;
    expect(parseRtcServerUrl({ toString() { reads++; return 'turn:example'; } })).toBeNull();
    expect(reads).toBe(0);
  });
  it('copies valid bounded records and rejects any sensitive extra field at each boundary', () => {
    const value = snapshot(); const checked = validateRtcSnapshot(value);
    expect(checked).toEqual({ ok: true, value });
    if (checked.ok) { expect(checked.value).not.toBe(value); expect(checked.value.connections[0]).not.toBe(value.connections[0]); }
    expect(validateRtcSnapshot({ ...value, sdp: 'CANARY' }).ok).toBe(false);
    value.connections[0]!.servers[0] = { ...value.connections[0]!.servers[0]!, credential: 'CANARY' } as never;
    expect(validateRtcSnapshot(value).ok).toBe(false);
    const accessor = snapshot(); Object.defineProperty(accessor.connections[0]!.servers[0], 'host', { get() { throw new Error('must not execute'); }, enumerable: true });
    expect(validateRtcSnapshot(accessor).ok).toBe(false);
  });
  it('rejects overlong arrays, duplicate ids/endpoints and invalid states', () => {
    const value = snapshot();
    expect(validateRtcSnapshot({ ...value, connections: Array(33).fill(value.connections[0]), total: 33 }).ok).toBe(false);
    expect(validateRtcSnapshot({ ...value, connections: [value.connections[0], value.connections[0]], total: 2 }).ok).toBe(false);
    const row = value.connections[0]!;
    for (const patch of [{ servers: Array(9).fill(row.servers[0]) }, { servers: [row.servers[0], row.servers[0]] }, { state: 'secure' }, { duration: 0.2 }, { id: 2 }]) expect(validateRtcSnapshot({ ...value, connections: [{ ...row, ...patch }] }).ok).toBe(false);
  });
  it('separates MAIN epoch routing from the private background authorization token', () => {
    const message = { channel: RTC_DETAILS_CHANNEL, type: 'rtc-snapshot', sensorBootId: 'boot-' + 'a'.repeat(24), epoch: 0, snapshot: snapshot() };
    expect(validateRtcSensorMessage(message).ok).toBe(true);
    expect(validateRtcSensorMessage({ ...message, token: 'b'.repeat(32) }).ok).toBe(false);
    expect(validateRtcSensorMessage({ ...message, epoch: -1 }).ok).toBe(false);
    expect(validateRtcPageRequest({ schemaVersion: 1, type: 'rtc-snapshot', token: 'b'.repeat(32), snapshot: snapshot() }).ok).toBe(true);
    expect(validateRtcPageRequest({ ...message, schemaVersion: 1 }).ok).toBe(false);
  });
  it('validates UI/state/control with exact shapes', () => {
    expect(validateRtcUiRequest({ schemaVersion: 1, type: 'ui-rtc-get', tabId: 1, documentKey: '1:0:a' }).ok).toBe(true);
    expect(validateRtcUiRequest({ schemaVersion: 1, type: 'ui-rtc-get', tabId: -1, documentKey: 'a' }).ok).toBe(false);
    expect(validateRtcStateResponse({ schemaVersion: 1, type: 'rtc-state', documentKey: '1:0:a', snapshot: snapshot() }).ok).toBe(true);
    expect(validateRtcStateResponse({ schemaVersion: 1, type: 'rtc-state', documentKey: '1:0:a', snapshot: null }).ok).toBe(true);
    expect(validateRtcControl({ schemaVersion: 1, type: 'rtc-control', enabled: true, token: 'a'.repeat(32), reset: false }).ok).toBe(true);
    expect(validateRtcControl({ schemaVersion: 1, type: 'rtc-control', enabled: false, token: 'a'.repeat(32), reset: false }).ok).toBe(false);
  });
});
