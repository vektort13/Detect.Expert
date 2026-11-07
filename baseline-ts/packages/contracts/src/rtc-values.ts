export const RTC_VALUE_LIMITS = Object.freeze({ fields: 96, index: 31, bytes: 12000, sourceChars: 32768, sourceLines: 512 });
export const RTC_VALUE_PROFILES = ['capabilities', 'description', 'configuration', 'certificate', 'stats', 'certificate-storage', 'media-settings'] as const;
export type RtcValueProfile = typeof RTC_VALUE_PROFILES[number];
export const RTC_CODEC_MIME_TYPES = ['audio/opus', 'audio/PCMU', 'audio/PCMA', 'audio/G722', 'audio/ISAC', 'audio/CN', 'audio/telephone-event',
  'audio/red', 'video/VP8', 'video/VP9', 'video/H264', 'video/H265', 'video/AV1', 'video/rtx', 'video/red', 'video/ulpfec', 'video/flexfec-03'] as const;
export const RTC_HEADER_EXTENSION_URIS = [
  'urn:ietf:params:rtp-hdrext:ssrc-audio-level', 'urn:ietf:params:rtp-hdrext:csrc-audio-level', 'urn:ietf:params:rtp-hdrext:sdes:mid',
  'urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id', 'urn:ietf:params:rtp-hdrext:sdes:repaired-rtp-stream-id',
  'urn:ietf:params:rtp-hdrext:toffset', 'urn:3gpp:video-orientation', 'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time',
  'http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01', 'http://www.webrtc.org/experiments/rtp-hdrext/playout-delay',
  'http://www.webrtc.org/experiments/rtp-hdrext/video-content-type', 'http://www.webrtc.org/experiments/rtp-hdrext/video-timing',
  'http://www.webrtc.org/experiments/rtp-hdrext/color-space', 'http://www.webrtc.org/experiments/rtp-hdrext/abs-capture-time',
  'http://www.webrtc.org/experiments/rtp-hdrext/video-layers-allocation00',
  'https://aomediacodec.github.io/av1-rtp-spec/#dependency-descriptor-rtp-header-extension',
] as const;
export const RTC_FMTP_PATTERN = '^(?:(?:apt|level-asymmetry-allowed|packetization-mode|profile-id|level-id|tier-flag|minptime|maxplaybackrate|sprop-maxcapturerate|stereo|sprop-stereo|useinbandfec|usedtx|maxaveragebitrate|max-fr|tx-mode|L|D|repair-window)=[0-9]{1,9}|profile-level-id=[A-Fa-f0-9]{6})(?:;(?:(?:apt|level-asymmetry-allowed|packetization-mode|profile-id|level-id|tier-flag|minptime|maxplaybackrate|sprop-maxcapturerate|stereo|sprop-stereo|useinbandfec|usedtx|maxaveragebitrate|max-fr|tx-mode|L|D|repair-window)=[0-9]{1,9}|profile-level-id=[A-Fa-f0-9]{6})){0,15}$';

type FieldSpec = { type: 'integer' | 'number'; maximum: number } | { type: 'boolean' } | { type: 'enum'; values: readonly string[] } |
  { type: 'pattern'; pattern: string; maximum: number };
export const RTC_VALUE_FIELDS = {
  'codec.mimeType': { type: 'enum', values: RTC_CODEC_MIME_TYPES },
  'codec.clockRate': { type: 'integer', maximum: 384000 },
  'codec.channels': { type: 'integer', maximum: 32 },
  'codec.payloadType': { type: 'integer', maximum: 127 },
  'codec.mediaSection': { type: 'integer', maximum: 31 },
  'codec.parameters': { type: 'pattern', pattern: RTC_FMTP_PATTERN, maximum: 256 },
  'headerExtension.uri': { type: 'enum', values: RTC_HEADER_EXTENSION_URIS },
  'headerExtension.id': { type: 'integer', maximum: 255 },
  'headerExtension.mediaSection': { type: 'integer', maximum: 31 },
  'description.type': { type: 'enum', values: ['offer', 'answer', 'pranswer', 'rollback'] },
  'media.kind': { type: 'enum', values: ['audio', 'video', 'application'] },
  'media.protocol': { type: 'enum', values: ['UDP/TLS/RTP/SAVPF', 'RTP/SAVPF', 'UDP/DTLS/SCTP', 'DTLS/SCTP'] },
  'media.payloadTypes': { type: 'pattern', pattern: '^(?:[0-9]|[1-9][0-9]|1[01][0-9]|12[0-7])(?: (?:[0-9]|[1-9][0-9]|1[01][0-9]|12[0-7])){0,31}$', maximum: 127 },
  'media.direction': { type: 'enum', values: ['sendrecv', 'sendonly', 'recvonly', 'inactive'] },
  'media.rtcpMux': { type: 'boolean' },
  'dtls.setup': { type: 'enum', values: ['active', 'passive', 'actpass', 'holdconn'] },
  'certificate.sha-256': { type: 'pattern', pattern: '^[A-Fa-f0-9]{2}(?::[A-Fa-f0-9]{2}){31}$', maximum: 95 },
  'certificate.sha-384': { type: 'pattern', pattern: '^[A-Fa-f0-9]{2}(?::[A-Fa-f0-9]{2}){47}$', maximum: 143 },
  'certificate.sha-512': { type: 'pattern', pattern: '^[A-Fa-f0-9]{2}(?::[A-Fa-f0-9]{2}){63}$', maximum: 191 },
  'certificate.expires': { type: 'integer', maximum: 8640000000000000 },
  'configuration.bundlePolicy': { type: 'enum', values: ['balanced', 'max-compat', 'max-bundle'] },
  'configuration.iceTransportPolicy': { type: 'enum', values: ['all', 'relay'] },
  'configuration.rtcpMuxPolicy': { type: 'enum', values: ['require', 'negotiate'] },
  'configuration.iceCandidatePoolSize': { type: 'integer', maximum: 255 },
  'configuration.certificates': { type: 'integer', maximum: 32 },
  'storage.operation': { type: 'enum', values: ['put', 'add', 'result'] },
  'storage.completion': { type: 'enum', values: ['request-returned', 'value-returned'] },
  'stats.type': { type: 'enum', values: ['codec', 'inbound-rtp', 'outbound-rtp', 'certificate', 'transport', 'peer-connection', 'data-channel'] },
  'stats.encoderImplementation': { type: 'enum', values: ['libvpx', 'OpenH264', 'ExternalEncoder', 'ExternalEncoder (Unknown)', 'VideoToolbox', 'MediaCodec'] },
  'stats.decoderImplementation': { type: 'enum', values: ['libvpx', 'OpenH264', 'ExternalDecoder', 'ExternalDecoder (Unknown)', 'VideoToolbox', 'MediaCodec', 'FFmpeg', 'libaom', 'dav1d'] },
  'stats.powerEfficientEncoder': { type: 'boolean' },
  'stats.powerEfficientDecoder': { type: 'boolean' },
  'stats.dtlsState': { type: 'enum', values: ['new', 'connecting', 'connected', 'closed', 'failed'] },
  'media.width': { type: 'integer', maximum: 65535 },
  'media.height': { type: 'integer', maximum: 65535 },
  'media.frameRate': { type: 'number', maximum: 10000 },
  'media.aspectRatio': { type: 'number', maximum: 65535 },
  'media.sampleRate': { type: 'integer', maximum: 384000 },
  'media.sampleSize': { type: 'integer', maximum: 128 },
  'media.channelCount': { type: 'integer', maximum: 32 },
  'media.echoCancellation': { type: 'boolean' },
  'media.noiseSuppression': { type: 'boolean' },
  'media.autoGainControl': { type: 'boolean' },
} as const satisfies Record<string, FieldSpec>;
export type RtcValueFieldName = keyof typeof RTC_VALUE_FIELDS;
export interface RtcValueField { name: RtcValueFieldName; index: number; value: string | number | boolean }
export interface RtcValue {
  kind: 'webrtc';
  profile: RtcValueProfile;
  source: 'returned' | 'native-snapshot';
  fields: RtcValueField[];
  truncated: boolean;
}
export const RTC_VALUE_OPERATIONS = [
  ['RTCPeerConnection.getConfiguration', 'configuration'], ['RTCPeerConnection.configurationSnapshot', 'configuration'],
  ['RTCCertificate.getFingerprints', 'certificate'], ['RTCRtpSender.getCapabilities', 'capabilities'], ['RTCRtpReceiver.getCapabilities', 'capabilities'],
  ['RTCRtpSender.getParameters', 'capabilities'], ['RTCRtpReceiver.getParameters', 'capabilities'],
  ['RTCSessionDescription.sdp', 'description'], ['RTCSessionDescription.toJSON', 'description'], ['RTCStatsReport.get', 'stats'],
  ['IDBObjectStore.put', 'certificate-storage'], ['IDBObjectStore.add', 'certificate-storage'], ['IDBRequest.result', 'certificate-storage'],
  ['MediaStreamTrack.getSettings', 'media-settings'],
] as const satisfies ReadonlyArray<readonly [string, RtcValueProfile]>;
const profiles = new Map<string, RtcValueProfile>(RTC_VALUE_OPERATIONS);
const mapGet = Map.prototype.get;
export function rtcValueProfile(operation: string): RtcValueProfile | null {
  return apply(mapGet, profiles, [operation]) as RtcValueProfile | undefined ?? null;
}
export function rtcValueSource(operation: string): RtcValue['source'] {
  return operation === 'RTCPeerConnection.configurationSnapshot' || operation === 'IDBObjectStore.put' || operation === 'IDBObjectStore.add' || operation === 'IDBRequest.result'
    ? 'native-snapshot' : 'returned';
}

const descriptor = Object.getOwnPropertyDescriptor;
const own = Object.hasOwn;
const keys = Reflect.ownKeys;
const array = Array.isArray;
const apply = Reflect.apply;
const includes = Array.prototype.includes;
const regexpExec = RegExp.prototype.exec;
const finite = Number.isFinite;
const integer = Number.isSafeInteger;
const objectIs = Object.is;
const create = Object.create;
const define = Object.defineProperty;
const startsWith = String.prototype.startsWith;
const patterns = Object.fromEntries(Object.entries(RTC_VALUE_FIELDS).flatMap(([name, spec]) => spec.type === 'pattern' ? [[name, new RegExp(spec.pattern)]] : [])) as Partial<Record<RtcValueFieldName, RegExp>>;

function field(value: object, key: string): unknown {
  const found = descriptor(value, key);
  return found && found.enumerable && own(found, 'value') ? found.value : undefined;
}
function exact(value: unknown, count: number): value is object {
  return value !== null && typeof value === 'object' && !array(value) && keys(value).length === count;
}
export function rtcValueFieldAllowed(profile: RtcValueProfile, name: string): boolean {
  const prefix = (value: string): boolean => apply(startsWith, name, [value]) as boolean;
  if (profile === 'certificate') return prefix('certificate.');
  if (profile === 'certificate-storage') return prefix('certificate.') || prefix('storage.');
  if (profile === 'configuration') return prefix('certificate.') || prefix('configuration.');
  if (profile === 'capabilities') return prefix('codec.') || prefix('headerExtension.');
  if (profile === 'stats') return prefix('stats.') || prefix('codec.') || prefix('certificate.');
  if (profile === 'media-settings') return prefix('media.') && !apply(includes, ['media.kind', 'media.protocol', 'media.payloadTypes', 'media.direction', 'media.rtcpMux'], [name]);
  return prefix('codec.') || prefix('headerExtension.') || prefix('description.') || prefix('dtls.') ||
    apply(includes, ['media.kind', 'media.protocol', 'media.payloadTypes', 'media.direction', 'media.rtcpMux', 'certificate.sha-256', 'certificate.sha-384', 'certificate.sha-512'], [name]) as boolean;
}
export function validRtcFieldValue(name: RtcValueFieldName, value: unknown): value is RtcValueField['value'] {
  if (!own(RTC_VALUE_FIELDS, name)) return false;
  const spec = RTC_VALUE_FIELDS[name] as FieldSpec | undefined;
  if (!spec) return false;
  if (spec.type === 'boolean') return typeof value === 'boolean';
  if (spec.type === 'enum') return typeof value === 'string' && apply(includes, spec.values, [value]) as boolean;
  if (spec.type === 'pattern') return typeof value === 'string' && value.length <= spec.maximum && apply(regexpExec, patterns[name]!, [value]) !== null;
  return typeof value === 'number' && finite(value) && !objectIs(value, -0) && value >= 0 && value <= spec.maximum && (spec.type !== 'integer' || integer(value));
}
export function rtcValueBytes(value: RtcValue): number {
  let bytes = 256;
  for (let index = 0; index < value.fields.length; index++) {
    const entry = value.fields[index]!;
    bytes += 80 + entry.name.length + (typeof entry.value === 'string' ? entry.value.length * 6 : 32);
  }
  return bytes;
}
export function readRtcValue(value: unknown): RtcValue | null {
  try {
    if (!exact(value, 5) || field(value, 'kind') !== 'webrtc') return null;
    const profile = field(value, 'profile'), source = field(value, 'source'), rows = field(value, 'fields'), truncated = field(value, 'truncated');
    if (typeof profile !== 'string' || !apply(includes, RTC_VALUE_PROFILES, [profile]) || source !== 'returned' && source !== 'native-snapshot' ||
      typeof truncated !== 'boolean' || !array(rows) || rows.length > RTC_VALUE_LIMITS.fields || keys(rows).length !== rows.length + 1) return null;
    const fields: RtcValueField[] = [];
    const seen = create(null) as Record<string, boolean>;
    for (let index = 0; index < rows.length; index++) {
      const row = field(rows, '' + index);
      if (!exact(row, 3)) return null;
      const name = field(row, 'name'), position = field(row, 'index'), content = field(row, 'value');
      if (typeof name !== 'string' || !own(RTC_VALUE_FIELDS, name) || !rtcValueFieldAllowed(profile as RtcValueProfile, name) ||
        typeof position !== 'number' || !integer(position) || position < 0 || position > RTC_VALUE_LIMITS.index || !validRtcFieldValue(name as RtcValueFieldName, content)) return null;
      if (profile === 'configuration' && source === 'returned' && apply(startsWith, name, ['certificate.'])) return null;
      const key = name + ':' + position;
      if (seen[key]) return null;
      seen[key] = true;
      define(fields, index, { __proto__: null, value: { name, index: position, value: content }, enumerable: true, configurable: true, writable: true } as PropertyDescriptor);
    }
    const result: RtcValue = { kind: 'webrtc', profile: profile as RtcValueProfile, source, fields, truncated };
    return rtcValueBytes(result) <= RTC_VALUE_LIMITS.bytes ? result : null;
  } catch { return null; }
}