import { API_OPERATION_DEFINITIONS } from './api-operations';
import type { TechniqueId } from './enums';
import { readRtcValue, rtcValueBytes, rtcValueProfile, rtcValueSource } from './rtc-values';
import type { RtcValue } from './rtc-values';

export const API_RESULTS_CHANNEL = 'detect.expert/api-results/v1';
export const API_RESULTS_LIMITS = Object.freeze({ rows: 256, stringChars: 256, vectorItems: 16, bytes: 65536, batchRows: 32, queryMs: 200 });
export type ApiResultPhase = 'returned-sync' | 'threw-sync' | 'settlement-unobserved';
export type ApiNumericValue = number | 'NaN' | 'Infinity' | '-Infinity' | '-0';
export type ApiResultValue =
  | RtcValue
  | { kind: 'number'; value: number }
  | { kind: 'special-number'; value: 'NaN' | 'Infinity' | '-Infinity' | '-0' }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'string'; value: string }
  | { kind: 'number-array'; values: ApiNumericValue[] }
  | { kind: 'null' }
  | { kind: 'undefined' }
  | { kind: 'unobserved'; reason: 'object' | 'async' | 'exception' | 'sensitive' | 'limit' | 'unsupported' };

export interface ApiResultEntry {
  operation: string;
  techniqueId: TechniqueId;
  phase: ApiResultPhase;
  value: ApiResultValue;
}

export interface ApiResultsSnapshot {
  rows: ApiResultEntry[];
  truncated: boolean;
}

export interface ApiResultDefinition {
  operation: string;
  techniqueId: TechniqueId;
  sensitive: boolean;
  asynchronous: boolean;
  numericVector: boolean;
  typeOnly: boolean;
}

export const WEBGL_RESULT_PARAMETERS = [
  [0x1f00, 'VENDOR'], [0x1f01, 'RENDERER'], [0x1f02, 'VERSION'], [0x8b8c, 'SHADING_LANGUAGE_VERSION'],
  [0x9245, 'UNMASKED_VENDOR_WEBGL'], [0x9246, 'UNMASKED_RENDERER_WEBGL'],
  [0x0d33, 'MAX_TEXTURE_SIZE'], [0x851c, 'MAX_CUBE_MAP_TEXTURE_SIZE'], [0x84e8, 'MAX_RENDERBUFFER_SIZE'],
  [0x0d3a, 'MAX_VIEWPORT_DIMS'], [0x8869, 'MAX_VERTEX_ATTRIBS'], [0x8b4c, 'MAX_VERTEX_TEXTURE_IMAGE_UNITS'],
  [0x8872, 'MAX_TEXTURE_IMAGE_UNITS'], [0x8b4d, 'MAX_COMBINED_TEXTURE_IMAGE_UNITS'],
  [0x8dfb, 'MAX_VERTEX_UNIFORM_VECTORS'], [0x8dfd, 'MAX_FRAGMENT_UNIFORM_VECTORS'], [0x8dfc, 'MAX_VARYING_VECTORS'],
  [0x846d, 'ALIASED_POINT_SIZE_RANGE'], [0x846e, 'ALIASED_LINE_WIDTH_RANGE'],
  [0x0d52, 'RED_BITS'], [0x0d53, 'GREEN_BITS'], [0x0d54, 'BLUE_BITS'], [0x0d55, 'ALPHA_BITS'], [0x0d56, 'DEPTH_BITS'], [0x0d57, 'STENCIL_BITS'],
  [0x80a8, 'SAMPLE_BUFFERS'], [0x80a9, 'SAMPLES'], [0x84ff, 'MAX_TEXTURE_MAX_ANISOTROPY_EXT'], [0x86a3, 'COMPRESSED_TEXTURE_FORMATS'],
  [0x8073, 'MAX_3D_TEXTURE_SIZE'], [0x88ff, 'MAX_ARRAY_TEXTURE_LAYERS'], [0x8cdf, 'MAX_COLOR_ATTACHMENTS'], [0x8824, 'MAX_DRAW_BUFFERS'],
  [0x8d6b, 'MAX_ELEMENT_INDEX'], [0x80e9, 'MAX_ELEMENTS_INDICES'], [0x80e8, 'MAX_ELEMENTS_VERTICES'],
  [0x9125, 'MAX_FRAGMENT_INPUT_COMPONENTS'], [0x8b49, 'MAX_FRAGMENT_UNIFORM_COMPONENTS'],
  [0x9122, 'MAX_VERTEX_OUTPUT_COMPONENTS'], [0x8b4b, 'MAX_VARYING_COMPONENTS'], [0x8b4a, 'MAX_VERTEX_UNIFORM_COMPONENTS'],
  [0x8a2f, 'MAX_UNIFORM_BUFFER_BINDINGS'], [0x8a30, 'MAX_UNIFORM_BLOCK_SIZE'], [0x8a34, 'UNIFORM_BUFFER_OFFSET_ALIGNMENT'],
  [0x826e, 'MAX_UNIFORM_LOCATIONS'], [0x8a2e, 'MAX_COMBINED_UNIFORM_BLOCKS'], [0x8a2b, 'MAX_VERTEX_UNIFORM_BLOCKS'],
  [0x8a2d, 'MAX_FRAGMENT_UNIFORM_BLOCKS'], [0x8a31, 'MAX_COMBINED_VERTEX_UNIFORM_COMPONENTS'], [0x8a33, 'MAX_COMBINED_FRAGMENT_UNIFORM_COMPONENTS'],
] as const;
export const WEBGL_RESULT_EXTENSIONS = [
  'WEBGL_debug_renderer_info', 'WEBGL_debug_shaders', 'WEBGL_lose_context', 'WEBGL_draw_buffers',
  'WEBGL_compressed_texture_s3tc', 'WEBGL_compressed_texture_s3tc_srgb', 'WEBGL_compressed_texture_etc', 'WEBGL_compressed_texture_etc1',
  'WEBGL_compressed_texture_astc', 'WEBGL_compressed_texture_pvrtc', 'WEBGL_depth_texture',
  'EXT_texture_filter_anisotropic', 'EXT_disjoint_timer_query', 'EXT_disjoint_timer_query_webgl2',
  'EXT_color_buffer_float', 'EXT_color_buffer_half_float', 'EXT_float_blend', 'EXT_shader_texture_lod',
  'EXT_frag_depth', 'EXT_sRGB', 'OES_texture_float', 'OES_texture_float_linear', 'OES_texture_half_float',
  'OES_texture_half_float_linear', 'OES_standard_derivatives', 'OES_element_index_uint', 'OES_vertex_array_object', 'ANGLE_instanced_arrays',
] as const;

const additional: ReadonlyArray<readonly [string, TechniqueId, readonly string[]]> = [
  ['Navigator', 'DET-025', ['userAgent', 'platform', 'vendor', 'language', 'languages', 'appVersion', 'appName', 'appCodeName', 'product', 'productSub', 'vendorSub']],
  ['Navigator', 'DET-027', ['plugins', 'mimeTypes', 'pdfViewerEnabled']],
  ['Navigator', 'DET-028', ['webdriver']],
  ['Window', 'DET-030', ['innerWidth', 'innerHeight', 'devicePixelRatio', 'visualViewport']],
  ['VisualViewport', 'DET-030', ['offsetLeft', 'offsetTop', 'pageLeft', 'pageTop', 'width', 'height', 'scale']],
  ['Navigator', 'DET-032', ['hardwareConcurrency']],
  ['Navigator', 'DET-033', ['deviceMemory']],
  ['Navigator', 'DET-034', ['maxTouchPoints']],
  ['Date', 'DET-035', ['getTimezoneOffset']],
  ['Intl.Collator', 'DET-036', ['resolvedOptions']],
  ['Intl.DateTimeFormat', 'DET-036', ['resolvedOptions']],
  ['Intl.NumberFormat', 'DET-036', ['resolvedOptions']],
  ['Intl.PluralRules', 'DET-036', ['resolvedOptions']],
  ['Intl.RelativeTimeFormat', 'DET-036', ['resolvedOptions']],
  ['Intl.ListFormat', 'DET-036', ['resolvedOptions']],
  ['Intl.Segmenter', 'DET-036', ['resolvedOptions']],
  ['Intl.DisplayNames', 'DET-036', ['resolvedOptions']],
  ['Window', 'DET-037', ['matchMedia']],
  ['CSS', 'DET-038', ['supports']],
  ['Navigator', 'DET-040', ['getBattery']],
  ['BatteryManager', 'DET-040', ['charging', 'chargingTime', 'dischargingTime', 'level']],
  ['Navigator', 'DET-041', ['connection']],
  ['NetworkInformation', 'DET-041', ['type', 'effectiveType', 'rtt', 'downlink', 'downlinkMax', 'saveData']],
  ['Document', 'DET-049', ['cookie']],
  ['Clipboard', 'DET-069', ['read', 'readText', 'write', 'writeText']],
  ['WebGLShaderPrecisionFormat', 'DET-011', ['rangeMin', 'rangeMax', 'precision']],
  ['Element', 'DET-005', ['getClientRects', 'getBoundingClientRect']],
  ['HTMLElement', 'DET-005', ['offsetWidth', 'offsetHeight']],
  ['Range', 'DET-006', ['getClientRects', 'getBoundingClientRect']],
  ['SVGGraphicsElement', 'DET-007', ['getBBox']],
  ['SVGTextContentElement', 'DET-007', ['getComputedTextLength', 'getSubStringLength']],
  ['FontFaceSet', 'DET-008', ['check', 'load', 'values', 'keys', 'entries', 'forEach', 'iterator']],
  ['Window', 'DET-009', ['queryLocalFonts']],
  ['MediaQueryList', 'DET-037', ['matches']],
  ['Permissions', 'DET-039', ['query']],
  ['PermissionStatus', 'DET-039', ['state']],
  ['Notification', 'DET-039', ['permission']],
  ['Geolocation', 'DET-044', ['getCurrentPosition', 'watchPosition']],
  ['Bluetooth', 'DET-045', ['getAvailability', 'getDevices', 'requestDevice']],
  ['USB', 'DET-046', ['getDevices', 'requestDevice']],
  ['HID', 'DET-046', ['getDevices', 'requestDevice']],
  ['Serial', 'DET-046', ['getPorts', 'requestPort']],
  ['Navigator', 'DET-047', ['getGamepads']],
  ['XRSystem', 'DET-048', ['isSessionSupported', 'requestSession']],
  ['CookieStore', 'DET-049', ['get', 'getAll', 'set', 'delete']],
  ['Storage', 'DET-050', ['getItem', 'setItem', 'removeItem', 'clear', 'key']],
  ['IDBFactory', 'DET-051', ['open', 'deleteDatabase', 'databases']],
  ['CacheStorage', 'DET-052', ['open', 'match', 'has', 'delete', 'keys']],
  ['Cache', 'DET-052', ['match', 'matchAll', 'add', 'addAll', 'put', 'delete', 'keys']],
  ['StorageManager', 'DET-053', ['estimate', 'persist', 'persisted']],
  ['Document', 'DET-054', ['hasStorageAccess', 'requestStorageAccess', 'hasUnpartitionedCookieAccess', 'requestStorageAccessFor']],
  ['ServiceWorkerContainer', 'DET-063', ['register', 'getRegistration', 'getRegistrations']],
  ['PublicKeyCredential', 'DET-069', ['isUserVerifyingPlatformAuthenticatorAvailable', 'isConditionalMediationAvailable', 'getClientCapabilities']],
];
const SENSITIVE = new Set<string>(['Document.cookie', 'Clipboard.read', 'Clipboard.readText',
  'AudioBuffer.getChannelData', 'AudioBuffer.copyFromChannel', 'AnalyserNode.getFloatFrequencyData',
  'AnalyserNode.getByteFrequencyData', 'AnalyserNode.getFloatTimeDomainData', 'AnalyserNode.getByteTimeDomainData',
  'PressureRecord.time', 'ScreenDetailed.label', 'Storage.getItem', 'Storage.key', 'CookieStore.get', 'CookieStore.getAll',
  'MLContext.readTensor', 'MLContext.compute', 'MLTensor.shape', 'MLOperand.shape']);
for (const [operation, techniqueId] of API_OPERATION_DEFINITIONS) {
  if (techniqueId === 'DET-071' && !operation.endsWith('.availability') && !operation.endsWith('.params') && !operation.endsWith('.create') ||
      techniqueId === 'DET-072' && operation.endsWith('.detect')) SENSITIVE.add(operation);
}
const definitions = new Map<string, ApiResultDefinition>();
const ASYNC = new Set(['Navigator.getBattery', 'Clipboard.read', 'Clipboard.readText', 'Clipboard.write', 'Clipboard.writeText',
  'Window.fetch', 'Window.queryLocalFonts', 'FontFaceSet.load', 'Permissions.query',
  'Geolocation.getCurrentPosition', 'Geolocation.watchPosition', 'Bluetooth.getAvailability', 'Bluetooth.getDevices', 'Bluetooth.requestDevice',
  'USB.getDevices', 'USB.requestDevice', 'HID.getDevices', 'HID.requestDevice', 'Serial.getPorts', 'Serial.requestPort',
  'XRSystem.isSessionSupported', 'XRSystem.requestSession', 'CookieStore.get', 'CookieStore.getAll', 'CookieStore.set', 'CookieStore.delete',
  'IDBFactory.open', 'IDBFactory.deleteDatabase', 'IDBFactory.databases',
  'CacheStorage.open', 'CacheStorage.match', 'CacheStorage.has', 'CacheStorage.delete', 'CacheStorage.keys',
  'Cache.match', 'Cache.matchAll', 'Cache.add', 'Cache.addAll', 'Cache.put', 'Cache.delete', 'Cache.keys',
  'StorageManager.estimate', 'StorageManager.persist', 'StorageManager.persisted',
  'Document.hasStorageAccess', 'Document.requestStorageAccess', 'Document.hasUnpartitionedCookieAccess', 'Document.requestStorageAccessFor',
  'ServiceWorkerContainer.register', 'ServiceWorkerContainer.getRegistration', 'ServiceWorkerContainer.getRegistrations',
  'PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable', 'PublicKeyCredential.isConditionalMediationAvailable', 'PublicKeyCredential.getClientCapabilities']);
for (const [operation, techniqueId, , kind] of API_OPERATION_DEFINITIONS) definitions.set(operation, { operation, techniqueId,
  sensitive: SENSITIVE.has(operation), asynchronous: kind === 'async-call', numericVector: false, typeOnly: false });
for (const [prefix, techniqueId, keys] of additional) for (const key of keys) {
  const operation = prefix + '.' + key;
  definitions.set(operation, { operation, techniqueId, sensitive: SENSITIVE.has(operation), asynchronous: ASYNC.has(operation), numericVector: false, typeOnly: false });
}
for (const operation of ['Window.fetch', 'Navigator.sendBeacon']) definitions.set(operation, { operation, techniqueId: 'DET-059',
  sensitive: false, asynchronous: ASYNC.has(operation), numericVector: false, typeOnly: false });
const vectorParameters = new Set(['MAX_VIEWPORT_DIMS', 'ALIASED_POINT_SIZE_RANGE', 'ALIASED_LINE_WIDTH_RANGE', 'COMPRESSED_TEXTURE_FORMATS']);
const glParameters = new Map<number, string>(WEBGL_RESULT_PARAMETERS);
const glExtensions = new Map<string, string>(WEBGL_RESULT_EXTENSIONS.map(name => [name.toLowerCase(), name]));
for (const prefix of ['WebGLRenderingContext', 'WebGL2RenderingContext']) {
  for (const name of ['getParameter', 'getExtension', 'getSupportedExtensions', 'getShaderPrecisionFormat', 'readPixels']) {
    const operation = prefix + '.' + name;
    definitions.set(operation, { operation, techniqueId: name === 'readPixels' ? 'DET-012' : 'DET-011', asynchronous: false,
      sensitive: name === 'readPixels', typeOnly: name === 'getParameter', numericVector: false });
  }
  for (const [, name] of WEBGL_RESULT_PARAMETERS) {
    const operation = prefix + '.getParameter.' + name;
    definitions.set(operation, { operation, techniqueId: 'DET-011', asynchronous: false, sensitive: false, numericVector: vectorParameters.has(name), typeOnly: false });
  }
  for (const name of WEBGL_RESULT_EXTENSIONS) {
    const operation = prefix + '.getExtension.' + name;
    definitions.set(operation, { operation, techniqueId: 'DET-011', asynchronous: false, sensitive: false, numericVector: false, typeOnly: false });
  }
}
for (const permission of ['camera', 'microphone', 'geolocation', 'notifications', 'clipboard-read', 'clipboard-write', 'persistent-storage',
  'background-sync', 'midi', 'sensors', 'payment-handler', 'screen-wake-lock', 'window-management', 'local-fonts', 'display-capture', 'storage-access', 'unknown']) {
  const operation = 'PermissionStatus.state.' + permission;
  definitions.set(operation, { operation, techniqueId: 'DET-039', asynchronous: false, sensitive: false, numericVector: false, typeOnly: false });
}
for (const prefix of ['FeaturePolicy', 'PermissionsPolicy']) for (const method of ['allowsFeature', 'features', 'allowedFeatures', 'getAllowlistForFeature']) {
  const operation = prefix + '.' + method;
  definitions.set(operation, { operation, techniqueId: 'DET-039', asynchronous: false, sensitive: method === 'getAllowlistForFeature', numericVector: false, typeOnly: false });
}
definitions.set('RTCPeerConnection.configurationSnapshot', { operation: 'RTCPeerConnection.configurationSnapshot', techniqueId: 'DET-056',
  sensitive: false, asynchronous: false, numericVector: false, typeOnly: true });
for (const definition of definitions.values()) if (rtcValueProfile(definition.operation)) definition.typeOnly = true;
for (const member of ['localDescription', 'currentLocalDescription', 'pendingLocalDescription', 'remoteDescription', 'currentRemoteDescription', 'pendingRemoteDescription']) {
  const definition = definitions.get('RTCPeerConnection.' + member);
  if (definition) definition.typeOnly = true;
}
export const API_RESULT_DEFINITIONS: readonly ApiResultDefinition[] = Object.freeze([...definitions.values()]);
const apply = Reflect.apply;
const mapGet = Map.prototype.get;
const lowerCase = String.prototype.toLowerCase;

export function webglResultOperation(prefix: string, method: string, parameter: unknown): string {
  const base = prefix + '.' + method;
  if (method === 'getParameter' && typeof parameter === 'number') {
    const name = apply(mapGet, glParameters, [parameter]) as string | undefined;
    if (name) return base + '.' + name;
  }
  if (method === 'getExtension' && typeof parameter === 'string' && parameter.length <= 64) {
    const name = apply(mapGet, glExtensions, [apply(lowerCase, parameter, [])]) as string | undefined;
    if (name) return base + '.' + name;
  }
  return base;
}

export function apiResultDefinition(operation: unknown): ApiResultDefinition | null {
  if (typeof operation !== 'string' || operation.length > 128) return null;
  return apply(mapGet, definitions, [operation]) as ApiResultDefinition | undefined ?? null;
}

export interface ApiResultsControl {
  channel: typeof API_RESULTS_CHANNEL;
  type: 'api-results-read' | 'api-results-reset';
  requestId: string;
  epoch: number;
}

export interface ApiResultsBatch extends ApiResultsSnapshot {
  channel: typeof API_RESULTS_CHANNEL;
  type: 'api-results-batch';
  requestId: string;
  epoch: number;
  batchSeq: number;
  final: boolean;
  enabled: boolean;
}

export interface ApiResultsUiRequest {
  schemaVersion: 1;
  type: 'ui-api-results';
  tabId: number;
  frameId: number;
  documentKey: string;
}

export interface ApiResultsState extends ApiResultsSnapshot {
  schemaVersion: 1;
  type: 'api-results-state';
  documentKey: string;
  available: boolean;
  integrity: 'page-controlled';
}

export interface ApiResultsCache extends ApiResultsSnapshot {
  schemaVersion: 1;
  type: 'api-results-cache';
  available: boolean;
  epoch: number;
}

const own = Object.getOwnPropertyDescriptor;
const keysOf = Reflect.ownKeys;
const hasOwn = Object.hasOwn;
const isArray = Array.isArray;
const finite = Number.isFinite;
const integer = Number.isInteger;
const is = Object.is;
const create = Object.create;
const define = Object.defineProperty;
const test = RegExp.prototype.test;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const DOCUMENT = /^[A-Za-z0-9_:.-]{1,160}$/;

function fields(value: unknown, names: readonly string[]): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || isArray(value) || keysOf(value).length !== names.length) return null;
  const result = create(null) as Record<string, unknown>;
  for (let index = 0; index < names.length; index++) {
    const name = names[index]!;
    const descriptor = own(value, name);
    if (!descriptor || !hasOwn(descriptor, 'value') || descriptor.enumerable !== true) return null;
    result[name] = descriptor.value;
  }
  return result;
}

function nonNegative(value: unknown, maximum = 2147483647): value is number {
  return typeof value === 'number' && integer(value) && value >= 0 && value <= maximum;
}

function readValue(value: unknown): ApiResultValue | null {
  if (typeof value !== 'object' || value === null) return null;
  const kind = own(value, 'kind')?.value as unknown;
  if (kind === 'webrtc') return readRtcValue(value);
  if (kind === 'null' || kind === 'undefined') return fields(value, ['kind']) ? { kind } : null;
  if (kind === 'unobserved') {
    const record = fields(value, ['kind', 'reason']);
    const reason = record?.['reason'];
    if (reason !== 'object' && reason !== 'async' && reason !== 'exception' && reason !== 'sensitive' && reason !== 'limit' && reason !== 'unsupported') return null;
    return { kind, reason };
  }
  if (kind === 'number-array') {
    const record = fields(value, ['kind', 'values']);
    const raw = record?.['values'];
    if (!isArray(raw) || raw.length > API_RESULTS_LIMITS.vectorItems || keysOf(raw).length !== raw.length + 1) return null;
    const values: ApiNumericValue[] = [];
    for (let index = 0; index < raw.length; index++) {
      const descriptor = own(raw, index);
      if (!descriptor || !hasOwn(descriptor, 'value')) return null;
      const element = descriptor.value as unknown;
      if (!(typeof element === 'number' && finite(element) && !is(element, -0)) && element !== 'NaN' && element !== 'Infinity' && element !== '-Infinity' && element !== '-0') return null;
      define(values, index, { __proto__: null, value: element, enumerable: true, configurable: true, writable: true } as PropertyDescriptor);
    }
    return { kind, values };
  }
  const record = fields(value, ['kind', 'value']);
  if (!record) return null;
  const content = record['value'];
  if (kind === 'number' && typeof content === 'number' && finite(content) && !is(content, -0)) return { kind, value: content };
  if (kind === 'boolean' && typeof content === 'boolean') return { kind, value: content };
  if (kind === 'string' && typeof content === 'string' && content.length <= API_RESULTS_LIMITS.stringChars) return { kind, value: content };
  if (kind === 'special-number' && (content === 'NaN' || content === 'Infinity' || content === '-Infinity' || content === '-0')) return { kind, value: content };
  return null;
}

export function apiResultEntryBytes(entry: ApiResultEntry): number {
  return entry.operation.length + 192 + (entry.value.kind === 'string' ? entry.value.value.length * 6 :
    entry.value.kind === 'number-array' ? entry.value.values.length * 32 : entry.value.kind === 'webrtc' ? rtcValueBytes(entry.value) : 0);
}

export function readApiResultEntries(value: unknown, maximum: number = API_RESULTS_LIMITS.rows): ApiResultEntry[] | null {
  try {
    if (!isArray(value) || value.length > maximum || keysOf(value).length !== value.length + 1) return null;
    const result: ApiResultEntry[] = [];
    const seen = create(null) as Record<string, boolean>;
    let bytes = 512;
    for (let index = 0; index < value.length; index++) {
      const item = own(value, index);
      if (!item || !hasOwn(item, 'value')) return null;
      const row = fields(item.value, ['operation', 'techniqueId', 'phase', 'value']);
      if (!row) return null;
      const definition = apiResultDefinition(row['operation']);
      const phase = row['phase'];
      if (!definition || row['techniqueId'] !== definition.techniqueId || (phase !== 'returned-sync' && phase !== 'threw-sync' && phase !== 'settlement-unobserved')) return null;
      const preview = readValue(row['value']);
      if (!preview) return null;
      if (phase !== 'threw-sync' && definition.asynchronous !== (phase === 'settlement-unobserved')) return null;
      if (!definition.asynchronous && preview.kind === 'unobserved' && preview.reason === 'async') return null;
      if (phase === 'threw-sync' && (preview.kind !== 'unobserved' || preview.reason !== 'exception')) return null;
      if (phase !== 'threw-sync' && preview.kind === 'unobserved' && preview.reason === 'exception') return null;
      if (phase !== 'threw-sync' && definition.sensitive && (preview.kind !== 'unobserved' || preview.reason !== 'sensitive')) return null;
      if (preview.kind === 'webrtc' && (phase !== 'returned-sync' || preview.profile !== rtcValueProfile(definition.operation) ||
        preview.source !== rtcValueSource(definition.operation))) return null;
      if (phase !== 'threw-sync' && definition.typeOnly && preview.kind !== 'webrtc' && (preview.kind !== 'unobserved' || preview.reason !== 'unsupported')) return null;
      if (preview.kind === 'number-array' && !definition.numericVector) return null;
      if (phase === 'settlement-unobserved' && !definition.sensitive && (preview.kind !== 'unobserved' || preview.reason !== 'async')) return null;
      const key = definition.operation + ':' + phase;
      if (seen[key]) return null;
      seen[key] = true;
      const entry: ApiResultEntry = { operation: definition.operation, techniqueId: definition.techniqueId, phase, value: preview };
      bytes += apiResultEntryBytes(entry);
      if (bytes > API_RESULTS_LIMITS.bytes) return null;
      define(result, index, { __proto__: null, value: entry, enumerable: true, configurable: true, writable: true } as PropertyDescriptor);
    }
    return result;
  } catch { return null; }
}

export function readApiResultsSnapshot(value: unknown): ApiResultsSnapshot | null {
  try {
    const record = fields(value, ['rows', 'truncated']);
    if (!record || typeof record['truncated'] !== 'boolean') return null;
    const rows = readApiResultEntries(record['rows']);
    return rows ? { rows, truncated: record['truncated'] } : null;
  } catch { return null; }
}

export function readApiResultsControl(value: unknown): ApiResultsControl | null {
  try {
    const record = fields(value, ['channel', 'type', 'requestId', 'epoch']);
    if (!record || record['channel'] !== API_RESULTS_CHANNEL || (record['type'] !== 'api-results-read' && record['type'] !== 'api-results-reset') ||
      typeof record['requestId'] !== 'string' || !apply(test, ID, [record['requestId']]) || !nonNegative(record['epoch'])) return null;
    return { channel: API_RESULTS_CHANNEL, type: record['type'], requestId: record['requestId'], epoch: record['epoch'] };
  } catch { return null; }
}

export function readApiResultsBatch(value: unknown): ApiResultsBatch | null {
  try {
    const record = fields(value, ['channel', 'type', 'requestId', 'epoch', 'batchSeq', 'final', 'enabled', 'rows', 'truncated']);
    if (!record || record['channel'] !== API_RESULTS_CHANNEL || record['type'] !== 'api-results-batch' ||
      typeof record['requestId'] !== 'string' || !apply(test, ID, [record['requestId']]) || !nonNegative(record['epoch']) || !nonNegative(record['batchSeq'], 63) ||
      typeof record['final'] !== 'boolean' || typeof record['enabled'] !== 'boolean' || typeof record['truncated'] !== 'boolean') return null;
    const rows = readApiResultEntries(record['rows'], API_RESULTS_LIMITS.batchRows);
    if (!rows || (!record['enabled'] && rows.length > 0)) return null;
    let bytes = 512;
    for (let index = 0; index < rows.length; index++) bytes += apiResultEntryBytes(rows[index]!);
    if (bytes > 16384) return null;
    return { channel: API_RESULTS_CHANNEL, type: 'api-results-batch', requestId: record['requestId'], epoch: record['epoch'], batchSeq: record['batchSeq'],
      final: record['final'], enabled: record['enabled'], rows, truncated: record['truncated'] };
  } catch { return null; }
}

export function readApiResultsUiRequest(value: unknown): ApiResultsUiRequest | null {
  try {
    const record = fields(value, ['schemaVersion', 'type', 'tabId', 'frameId', 'documentKey']);
    if (!record || record['schemaVersion'] !== 1 || record['type'] !== 'ui-api-results' || !nonNegative(record['tabId']) || !nonNegative(record['frameId']) ||
      typeof record['documentKey'] !== 'string' || !apply(test, DOCUMENT, [record['documentKey']])) return null;
    return { schemaVersion: 1, type: 'ui-api-results', tabId: record['tabId'], frameId: record['frameId'], documentKey: record['documentKey'] };
  } catch { return null; }
}

export function readApiResultsCache(value: unknown): ApiResultsCache | null {
  try {
    const record = fields(value, ['schemaVersion', 'type', 'available', 'epoch', 'rows', 'truncated']);
    if (!record || record['schemaVersion'] !== 1 || record['type'] !== 'api-results-cache' || typeof record['available'] !== 'boolean' ||
      !nonNegative(record['epoch']) || typeof record['truncated'] !== 'boolean') return null;
    const rows = readApiResultEntries(record['rows']);
    if (!rows || (!record['available'] && rows.length > 0)) return null;
    return { schemaVersion: 1, type: 'api-results-cache', available: record['available'], epoch: record['epoch'], rows, truncated: record['truncated'] };
  } catch { return null; }
}

export function readApiResultsState(value: unknown): ApiResultsState | null {
  try {
    const record = fields(value, ['schemaVersion', 'type', 'documentKey', 'available', 'integrity', 'rows', 'truncated']);
    if (!record || record['schemaVersion'] !== 1 || record['type'] !== 'api-results-state' || typeof record['available'] !== 'boolean' ||
      record['integrity'] !== 'page-controlled' || typeof record['documentKey'] !== 'string' ||
      !apply(test, DOCUMENT, [record['documentKey']]) || typeof record['truncated'] !== 'boolean') return null;
    const rows = readApiResultEntries(record['rows']);
    if (!rows || (!record['available'] && rows.length > 0)) return null;
    return { schemaVersion: 1, type: 'api-results-state', documentKey: record['documentKey'], available: record['available'],
      integrity: 'page-controlled', rows, truncated: record['truncated'] };
  } catch { return null; }
}