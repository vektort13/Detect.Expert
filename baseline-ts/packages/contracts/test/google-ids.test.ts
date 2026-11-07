import { describe, expect, it } from 'vitest';
import { BinaryWriter, WireType } from '@bufbuild/protobuf/wire';
import { decodeClientData, GOOGLE_IDS_LIMITS, isClientDataHeader, isGoogleIdsHost, readGoogleIdsRequest, readGoogleIdsState } from '../src/google-ids';
import type { GoogleIdsState } from '../src/google-ids';
import { compileSchema } from './helpers';

const encoded = (writer: BinaryWriter): string => Buffer.from(writer.finish()).toString('base64');
const header = encoded(new BinaryWriter().tag(1, WireType.Varint).int32(1234567).tag(3, WireType.Varint).int32(444));
const request = { schemaVersion: 1, type: 'ui-google-ids', tabId: 1, frameId: 0, documentKey: '1:0:document-a' };
const state = (): GoogleIdsState => ({ schemaVersion: 1, type: 'google-ids-state', documentKey: '1:0:document-a',
  evidenceSource: 'browser-network', integrity: 'browser-observed', coverageState: 'partial', truncated: false,
  entries: [{ host: 'www.google.com', status: 'observed', header }] });

describe('ADR-040 Google / Chrome IDs contract', () => {
  it('cross-checks the dedicated JSON Schema without adding exact headers to ordinary messages', () => {
    const schema = compileSchema('google-ids.v1.schema.json');
    expect(schema(request)).toBe(true);
    expect(schema(state())).toBe(true);
    for (const status of ['not-present', 'unavailable', 'too-large', 'invalid'] as const) {
      const candidate = { ...state(), entries: [{ host: 'www.google.com', status, header: null }] };
      expect(schema(candidate)).toBe(true);
      expect(readGoogleIdsState(candidate)).not.toBeNull();
    }
    for (const candidate of [{ ...state(), integrity: 'page-controlled' }, { ...state(), coverageState: 'paused' },
      { ...state(), entries: [{ host: 'google.com.evil.test', status: 'observed', header }] },
      { ...state(), entries: [{ host: 'google.com', status: 'observed', header: 'CB==' }] },
      { ...state(), entries: [{ host: 'google.com', status: 'observed', header: 'A'.repeat(4100) }] },
      { ...state(), cookies: 'PRIVATE_CANARY' }]) {
      expect(schema(candidate)).toBe(false);
      expect(readGoogleIdsState(candidate)).toBeNull();
    }
    expect(compileSchema('ui-request.v1.schema.json')(request)).toBe(false);
    expect(compileSchema('report-projection.v1.schema.json')(state())).toBe(false);
  });

  it('decodes ordinary and packed fields in original order, retaining duplicate and signed int32 values', () => {
    const raw = encoded(new BinaryWriter().tag(1, WireType.Varint).int32(111).tag(3, WireType.Varint).int32(444)
      .tag(1, WireType.LengthDelimited).fork().int32(222).int32(111).int32(-1).join()
      .tag(3, WireType.LengthDelimited).fork().int32(555).join());
    expect(decodeClientData(raw)).toEqual({ variationIds: [111, 222, 111, -1], triggerVariationIds: [444, 555], truncated: false, unknownFields: false });
  });

  it('marks unknown fields without decoding their payload or inventing experiment names', () => {
    const raw = encoded(new BinaryWriter().tag(2, WireType.LengthDelimited).string('unknown').tag(1, WireType.Varint).int32(111));
    expect(decodeClientData(raw)).toEqual({ variationIds: [111], triggerVariationIds: [], truncated: false, unknownFields: true });
  });

  it('bounds the combined number of decoded IDs', () => {
    const writer = new BinaryWriter().tag(1, WireType.LengthDelimited).fork();
    for (let index = 0; index <= GOOGLE_IDS_LIMITS.ids; index++) writer.int32(index);
    const value = decodeClientData(encoded(writer.join()));
    expect(value?.variationIds).toHaveLength(GOOGLE_IDS_LIMITS.ids);
    expect(value?.truncated).toBe(true);
  });

  it.each(['', 'not base64', 'CA==\n', 'CA', 'CB==', 'CA===', 'A'.repeat(4100), null, {}, 1])('refuses noncanonical or oversized base64: %j', raw => {
    expect(isClientDataHeader(raw)).toBe(false);
    expect(decodeClientData(raw)).toBeNull();
  });

  it.each([[0], [8, 128], [10, 2, 128], [13, 0, 0, 0, 0], [19, 20], [12], [255, 255, 255, 255, 31]])('refuses malformed protobuf and groups: %j', (...bytes) => {
    expect(decodeClientData(Buffer.from(bytes).toString('base64'))).toBeNull();
  });

  it('checks exact destination boundaries rather than google substrings', () => {
    for (const host of ['google.com', 'www.google.com', 'clients4.google.com', 'ad.doubleclick.net', 'google.co.uk']) expect(isGoogleIdsHost(host)).toBe(true);
    for (const host of ['google.com.evil.test', 'notgoogle.com', 'evilgoogle.com', 'google.example', 'google.com@evil.test', 'www.google.com/', 'GOOGLE.COM']) expect(isGoogleIdsHost(host)).toBe(false);
  });

  it('accepts only a matching browser document tuple and exact UI request fields', () => {
    expect(readGoogleIdsRequest(request)).toEqual(request);
    for (const patch of [{ tabId: 2 }, { frameId: -0 }, { documentKey: '1:0:doc?secret' }, { value: header }, { schemaVersion: 2 }]) {
      expect(readGoogleIdsRequest({ ...request, ...patch })).toBeNull();
    }
    let reads = 0;
    expect(readGoogleIdsRequest({ ...request, get tabId() { reads++; return 1; } })).toBeNull();
    expect(reads).toBe(0);
  });

  it('clones observed browser state and accepts explicit absence without a fabricated header', () => {
    const raw = state();
    const parsed = readGoogleIdsState(raw);
    expect(parsed).toEqual(raw);
    expect(parsed?.entries).not.toBe(raw.entries);
    raw.entries = [{ host: 'www.google.com', status: 'not-present', header: null }];
    expect(readGoogleIdsState(raw)).toEqual(raw);
  });

  it('rejects source escalation, URLs, unexpected data, duplicates and oversized arrays', () => {
    for (const patch of [{ integrity: 'page-controlled' }, { evidenceSource: 'page-hook' }, { coverageState: 'unknown' }, { cookies: 'secret' }, { entries: new Array(9) }]) {
      expect(readGoogleIdsState({ ...state(), ...patch })).toBeNull();
    }
    for (const patch of [{ host: 'https://www.google.com/?secret' }, { status: 'unique-user' }, { header: 'token' }, { cookie: 'secret' }, { status: 'not-present' }]) {
      expect(readGoogleIdsState({ ...state(), entries: [{ ...state().entries[0], ...patch }] })).toBeNull();
    }
    expect(readGoogleIdsState({ ...state(), entries: [state().entries[0], state().entries[0]] })).toBeNull();
  });

  it.each(['paused', 'no-access', 'unsupported'])('does not return retained values in %s coverage', coverageState => {
    expect(readGoogleIdsState({ ...state(), coverageState })).toBeNull();
    expect(readGoogleIdsState({ ...state(), coverageState, entries: [] })).not.toBeNull();
  });

  it('does not invoke hostile record or array accessors', () => {
    let reads = 0;
    const raw = state();
    Object.defineProperty(raw.entries, 0, { enumerable: true, get() { reads++; return raw; } });
    expect(readGoogleIdsState(raw)).toBeNull();
    const row = { host: 'www.google.com', status: 'observed', get header() { reads++; return header; } };
    expect(readGoogleIdsState({ ...state(), entries: [row] })).toBeNull();
    expect(reads).toBe(0);
  });
});