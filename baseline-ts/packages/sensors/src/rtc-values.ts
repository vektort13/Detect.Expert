import { RTC_CODEC_MIME_TYPES, RTC_VALUE_LIMITS, rtcValueProfile, validRtcFieldValue } from '../../contracts/src/rtc-values';
import type { RtcValue, RtcValueFieldName, RtcValueProfile } from '../../contracts/src/rtc-values';
import type { SensorRuntime } from './runtime';
import { arrayPush } from './intrinsics';

const descriptor = Object.getOwnPropertyDescriptor;
const own = Object.hasOwn;
const array = Array.isArray;
const apply = Reflect.apply;
const functionSource = Function.prototype.toString;
const includes = String.prototype.includes;
const lower = String.prototype.toLowerCase;
const indexOf = String.prototype.indexOf;
const slice = String.prototype.slice;
const trim = String.prototype.trim;
const regexpExec = RegExp.prototype.exec;
const NativeNumber = Number;
const integer = Number.isSafeInteger;
const min = Math.min;
const NativeMap = Map;
const NativeWeakMap = WeakMap;
const mapGet = Map.prototype.get;
const mapSet = Map.prototype.set;
const weakGet = WeakMap.prototype.get;
const weakSet = WeakMap.prototype.set;
const mapClear = Map.prototype.clear;
const NO_ARGS: readonly unknown[] = Object.freeze([]);
const MIME_TYPES = new NativeMap<string, string>(RTC_CODEC_MIME_TYPES.map(value => [value.toLowerCase(), value]));

export function nativeRtcFunction(value: unknown): value is Function {
  return typeof value === 'function' && apply(includes, apply(functionSource, value, NO_ARGS), ['[native code]']) as boolean;
}
function data(value: unknown, name: string): unknown {
  if (value === null || typeof value !== 'object' && typeof value !== 'function') return undefined;
  const field = descriptor(value, name);
  return field && own(field, 'value') ? field.value : undefined;
}
function nativeGetter(owner: string, name: string): Function | null {
  const prototype = data(data(globalThis, owner), 'prototype');
  const value: unknown = prototype && descriptor(prototype as object, name)?.get;
  return nativeRtcFunction(value) ? value : null;
}
function nativeMethod(owner: string, name: string): Function | null {
  const value = data(data(data(globalThis, owner), 'prototype'), name);
  return nativeRtcFunction(value) ? value : null;
}
function splitFixed(value: string, separator: string, maximum: number): string[] {
  const result: string[] = [];
  let offset = 0;
  for (let index = 0; index < maximum; index++) {
    const position = apply(indexOf, value, [separator, offset]) as number;
    arrayPush(result, apply(slice, value, [offset, position < 0 ? value.length : position]) as string);
    if (position < 0) break;
    offset = position + separator.length;
  }
  return result;
}

class Preview {
  readonly value: RtcValue;
  private bytes = 256;
  private readonly seen = new NativeMap<string, boolean>();
  constructor(profile: RtcValueProfile, source: RtcValue['source'] = 'returned') {
    this.value = { kind: 'webrtc', profile, source, fields: [], truncated: false };
  }
  add(name: RtcValueFieldName, index: number, value: unknown): void {
    if (value === undefined) return;
    if (!validRtcFieldValue(name, value) || !integer(index) || index < 0 || index > RTC_VALUE_LIMITS.index) { this.value.truncated = true; return; }
    const key = name + ':' + index;
    if (apply(mapGet, this.seen, [key])) return;
    const cost = 80 + name.length + (typeof value === 'string' ? value.length * 6 : 32);
    if (this.value.fields.length >= RTC_VALUE_LIMITS.fields || this.bytes + cost > RTC_VALUE_LIMITS.bytes) { this.value.truncated = true; return; }
    this.bytes += cost;
    apply(mapSet, this.seen, [key, true]);
    arrayPush(this.value.fields, { name, index, value });
  }
  list(value: unknown, visit: (row: unknown, index: number) => void): void {
    if (!array(value)) { if (value !== undefined) this.value.truncated = true; return; }
    const length = data(value, 'length');
    if (typeof length !== 'number' || !integer(length) || length < 0) { this.value.truncated = true; return; }
    if (length > RTC_VALUE_LIMITS.index + 1) this.value.truncated = true;
    for (let index = 0; index < min(length, RTC_VALUE_LIMITS.index + 1); index++) visit(data(value, '' + index), index);
  }
}

function mime(value: unknown): unknown {
  return typeof value === 'string' && value.length <= 64 ? apply(mapGet, MIME_TYPES, [apply(lower, value, NO_ARGS)]) ?? value : value;
}
function parameters(preview: Preview, value: unknown, index: number): void {
  if (value === undefined || value === '') return;
  if (typeof value !== 'string' || value.length > 512) { preview.value.truncated = true; return; }
  const tokens = splitFixed(value, ';', 17);
  if (tokens.length > 16) preview.value.truncated = true;
  let output = '';
  for (let position = 0; position < min(tokens.length, 16); position++) {
    const token = apply(trim, tokens[position], NO_ARGS) as string;
    if (!validRtcFieldValue('codec.parameters', token)) { preview.value.truncated = true; continue; }
    output += (output ? ';' : '') + token;
  }
  if (output) preview.add('codec.parameters', index, output);
}
function codec(preview: Preview, row: unknown, index: number): void {
  preview.add('codec.mimeType', index, mime(data(row, 'mimeType')));
  preview.add('codec.clockRate', index, data(row, 'clockRate'));
  preview.add('codec.channels', index, data(row, 'channels'));
  preview.add('codec.payloadType', index, data(row, 'payloadType'));
  parameters(preview, data(row, 'sdpFmtpLine'), index);
}
function fingerprints(preview: Preview, rows: unknown, certificateIndex?: number): void {
  preview.list(rows, (row, index) => {
    const algorithm = data(row, 'algorithm');
    if (algorithm !== 'sha-256' && algorithm !== 'sha-384' && algorithm !== 'sha-512') { preview.value.truncated = true; return; }
    preview.add('certificate.' + algorithm as RtcValueFieldName, certificateIndex ?? index, data(row, 'value'));
  });
}

export function previewRtcCapabilities(value: unknown): RtcValue {
  const preview = new Preview('capabilities');
  preview.list(data(value, 'codecs'), (row, index) => codec(preview, row, index));
  preview.list(data(value, 'headerExtensions'), (row, index) => {
    preview.add('headerExtension.uri', index, data(row, 'uri'));
    preview.add('headerExtension.id', index, data(row, 'id'));
  });
  return preview.value;
}

export function previewRtcDescription(value: unknown, type?: unknown): RtcValue {
  const preview = new Preview('description');
  preview.add('description.type', 0, type);
  if (typeof value !== 'string' || value.length > RTC_VALUE_LIMITS.sourceChars) { preview.value.truncated = true; return preview.value; }
  const lines = splitFixed(value, '\n', RTC_VALUE_LIMITS.sourceLines + 1);
  if (lines.length > RTC_VALUE_LIMITS.sourceLines) preview.value.truncated = true;
  let media = -1, kind = '', codecIndex = 0, extensionIndex = 0, certificateIndex = 0;
  const codecs = new NativeMap<string, number>();
  const match = (pattern: RegExp, line: string): RegExpExecArray | null => apply(regexpExec, pattern, [line]) as RegExpExecArray | null;
  for (let index = 0; index < min(lines.length, RTC_VALUE_LIMITS.sourceLines); index++) {
    const line = apply(trim, lines[index], NO_ARGS) as string;
    if (line.length > 1024) { preview.value.truncated = true; continue; }
    const section = match(/^m=(audio|video|application) [0-9]{1,5} ([A-Z0-9/]+) (.{1,127})$/, line);
    if (section) {
      media++; kind = section[1]!;
      preview.add('media.kind', media, kind); preview.add('media.protocol', media, section[2]);
      if (kind !== 'application') preview.add('media.payloadTypes', media, section[3]);
      continue;
    }
    const fingerprint = match(/^a=fingerprint:(sha-256|sha-384|sha-512) ([A-Fa-f0-9:]{95,191})$/, line);
    if (fingerprint) { preview.add('certificate.' + fingerprint[1] as RtcValueFieldName, certificateIndex++, fingerprint[2]); continue; }
    const setup = match(/^a=setup:(active|passive|actpass|holdconn)$/, line);
    if (setup) { preview.add('dtls.setup', min(31, media < 0 ? 0 : media), setup[1]); continue; }
    if (media < 0 || media > RTC_VALUE_LIMITS.index) continue;
    const mapping = match(/^a=rtpmap:([0-9]{1,3}) ([A-Za-z0-9.+-]{1,40})\/([0-9]{1,6})(?:\/([0-9]{1,2}))?$/, line);
    if (mapping) {
      const slot = codecIndex++;
      apply(mapSet, codecs, [media + ':' + mapping[1], slot]);
      preview.add('codec.mediaSection', slot, media);
      preview.add('codec.mimeType', slot, mime(kind + '/' + mapping[2]));
      preview.add('codec.payloadType', slot, NativeNumber(mapping[1])); preview.add('codec.clockRate', slot, NativeNumber(mapping[3]));
      if (mapping[4]) preview.add('codec.channels', slot, NativeNumber(mapping[4]));
      continue;
    }
    const fmtp = match(/^a=fmtp:([0-9]{1,3}) (.{1,512})$/, line);
    if (fmtp) {
      const slot = apply(mapGet, codecs, [media + ':' + fmtp[1]]) as number | undefined;
      if (slot === undefined) preview.value.truncated = true; else parameters(preview, fmtp[2], slot);
      continue;
    }
    const extension = match(/^a=extmap:([0-9]{1,3})(?:\/(?:sendrecv|sendonly|recvonly|inactive))? ([^ ]{1,256})(?: .*)?$/, line);
    if (extension) {
      const slot = extensionIndex++;
      preview.add('headerExtension.mediaSection', slot, media); preview.add('headerExtension.id', slot, NativeNumber(extension[1]));
      preview.add('headerExtension.uri', slot, extension[2]); continue;
    }
    const direction = match(/^a=(sendrecv|sendonly|recvonly|inactive)$/, line);
    if (direction) preview.add('media.direction', media, direction[1]);
    if (line === 'a=rtcp-mux') preview.add('media.rtcpMux', media, true);
  }
  return preview.value;
}

export function previewRtcStats(value: unknown): RtcValue {
  const preview = new Preview('stats');
  const type = data(value, 'type');
  preview.add('stats.type', 0, type);
  if (type === 'codec') codec(preview, value, 0);
  if (type === 'certificate') fingerprints(preview, [{ algorithm: data(value, 'fingerprintAlgorithm'), value: data(value, 'fingerprint') }]);
  if (type === 'inbound-rtp' || type === 'outbound-rtp') {
    const properties = ['encoderImplementation', 'decoderImplementation', 'powerEfficientEncoder', 'powerEfficientDecoder'] as const;
    for (let index = 0; index < properties.length; index++) {
      const property = properties[index]!;
      preview.add('stats.' + property as RtcValueFieldName, 0, data(value, property));
    }
  }
  if (type === 'transport') preview.add('stats.dtlsState', 0, data(value, 'dtlsState'));
  return preview.value;
}
export function previewRtcMediaSettings(value: unknown): RtcValue {
  const preview = new Preview('media-settings');
  const properties = ['width', 'height', 'frameRate', 'aspectRatio', 'sampleRate', 'sampleSize', 'channelCount', 'echoCancellation', 'noiseSuppression', 'autoGainControl'] as const;
  for (let index = 0; index < properties.length; index++) {
    const property = properties[index]!;
    preview.add('media.' + property as RtcValueFieldName, 0, data(value, property));
  }
  return preview.value;
}

export interface RtcValueCapture {
  returned(operation: string, value: unknown): boolean;
  configuration(value: unknown): void;
  stored(operation: 'IDBObjectStore.put' | 'IDBObjectStore.add' | 'IDBRequest.result', value: unknown, threw: boolean): boolean;
}
const captures = new NativeWeakMap<object, RtcValueCapture>();
let certificateMethods: { expires: Function | null; fingerprints: Function | null } | undefined;
export function installRtcValueCapture(runtime: SensorRuntime): RtcValueCapture | undefined {
  const existing = apply(weakGet, captures, [runtime]) as RtcValueCapture | undefined;
  if (existing) return existing;
  if (runtime.visualEnv.earlyCaptureGuaranteed !== true || runtime.visualEnv.startedLate) return undefined;
  let certificateExpires: Function | null = null, certificateFingerprints: Function | null = null;
  try {
    if (!certificateMethods) certificateMethods = { expires: nativeGetter('RTCCertificate', 'expires'), fingerprints: nativeMethod('RTCCertificate', 'getFingerprints') };
    certificateExpires = certificateMethods.expires;
    certificateFingerprints = certificateMethods.fingerprints;
  } catch { runtime.limitRtcValues(); }
  let generation = runtime.resultGeneration, windowAt = -Infinity, count = 0;
  const limited = new NativeMap<string, boolean>();
  const admit = (operation: string, profile: RtcValueProfile, source: RtcValue['source']): boolean => {
    if (!runtime.hooks.enabled) return false;
    const now = runtime.visualEnv.now();
    if (generation !== runtime.resultGeneration || now - windowAt >= 1000 || now < windowAt) {
      generation = runtime.resultGeneration; windowAt = now; count = 0; apply(mapClear, limited, NO_ARGS);
    }
    if (count++ < 32) return true;
    runtime.limitRtcValues();
    if (profile === 'certificate-storage') return false;
    if (!apply(mapGet, limited, [operation])) {
      apply(mapSet, limited, [operation, true]);
      runtime.recordRtcValue(operation, { kind: 'webrtc', profile, source, fields: [], truncated: true });
    }
    return false;
  };
  const certificate = (preview: Preview, value: unknown, index: number): boolean => {
    if (!certificateExpires || !certificateFingerprints) return false;
    let expires: unknown;
    try { expires = apply(certificateExpires, value, NO_ARGS); } catch { return false; }
    preview.add('certificate.expires', index, expires);
    try { fingerprints(preview, apply(certificateFingerprints, value, NO_ARGS), index); }
    catch { preview.value.truncated = true; }
    return true;
  };
  const configuration = (raw: unknown, source: RtcValue['source']): void => {
    const operation = source === 'returned' ? 'RTCPeerConnection.getConfiguration' : 'RTCPeerConnection.configurationSnapshot';
    if (!admit(operation, 'configuration', source)) return;
    const preview = new Preview('configuration', source);
    const properties = ['bundlePolicy', 'iceTransportPolicy', 'rtcpMuxPolicy', 'iceCandidatePoolSize'] as const;
    for (let position = 0; position < properties.length; position++) {
      const property = properties[position]!;
      preview.add('configuration.' + property as RtcValueFieldName, 0, data(raw, property));
    }
    const certificates = data(raw, 'certificates');
    if (array(certificates)) {
      const length = data(certificates, 'length');
      preview.add('configuration.certificates', 0, length);
      if (source === 'native-snapshot') {
        if (typeof length === 'number' && length > 4) preview.value.truncated = true;
        for (let index = 0; typeof length === 'number' && index < min(length, 4); index++) {
          if (!certificate(preview, data(certificates, '' + index), index)) preview.value.truncated = true;
        }
      }
    }
    runtime.recordRtcValue(operation, preview.value);
  };
  const capture: RtcValueCapture = {
    returned(operation, value) {
      const profile = rtcValueProfile(operation);
      if (!profile || profile === 'certificate-storage') return false;
      if (profile === 'configuration') { configuration(value, 'returned'); return true; }
      if (!admit(operation, profile, 'returned')) return true;
      let preview: RtcValue;
      if (profile === 'capabilities') preview = previewRtcCapabilities(value);
      else if (profile === 'certificate') { const result = new Preview('certificate'); fingerprints(result, value); preview = result.value; }
      else if (profile === 'description') preview = operation === 'RTCSessionDescription.sdp' ? previewRtcDescription(value) : previewRtcDescription(data(value, 'sdp'), data(value, 'type'));
      else if (profile === 'stats') preview = previewRtcStats(value);
      else preview = previewRtcMediaSettings(value);
      runtime.recordRtcValue(operation, preview); return true;
    },
    configuration(value) { configuration(value, 'native-snapshot'); },
    stored(operation, value, threw) {
      if (threw || value === null || typeof value !== 'object' || !admit(operation, 'certificate-storage', 'native-snapshot')) return false;
      const preview = new Preview('certificate-storage', 'native-snapshot');
      if (!certificate(preview, value, 0)) return false;
      if (!threw) {
        preview.add('storage.operation', 0, operation === 'IDBRequest.result' ? 'result' : operation === 'IDBObjectStore.put' ? 'put' : 'add');
        preview.add('storage.completion', 0, operation === 'IDBRequest.result' ? 'value-returned' : 'request-returned');
        runtime.recordRtcValue(operation, preview.value);
      }
      return true;
    },
  };
  apply(weakSet, captures, [runtime, capture]);
  return capture;
}