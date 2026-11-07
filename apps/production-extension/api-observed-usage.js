// E22-21 / ADR-067: projection of existing redacted observations, never a detector.
// The table is an audited subset of the canonical registry, checked by a drift test.
import { WASM_SURFACES } from './webassembly-apis.js';

const operationRules = new Map();
function operations(techniqueId, kind, ids, names) {
  for (const operation of names.split('|')) operationRules.set(operation,
    Object.freeze({ operation, techniqueId, kind, ids: Object.freeze(ids.split(',')) }));
}

operations('DET-013', 'async-call', 'webgpu',
  'GPU.requestAdapter|GPUAdapter.requestDevice|GPUDevice.createComputePipelineAsync|GPUDevice.createRenderPipelineAsync|GPUShaderModule.getCompilationInfo');
operations('DET-013', 'get', 'webgpu',
  'GPUAdapter.info|GPUAdapter.features|GPUAdapter.limits|GPUDevice.adapterInfo|GPUDevice.features|GPUDevice.limits|GPUAdapterInfo.vendor|GPUAdapterInfo.architecture|GPUAdapterInfo.device|GPUAdapterInfo.description|GPUAdapterInfo.powerPreference|GPUAdapterInfo.isFallbackAdapter|GPUAdapterInfo.subgroupMinSize|GPUAdapterInfo.subgroupMaxSize|GPUAdapterInfo.type|GPUAdapterInfo.backend|GPUSupportedLimits.maxTextureDimension1D|GPUSupportedLimits.maxTextureDimension2D|GPUSupportedLimits.maxTextureDimension3D|GPUSupportedLimits.maxTextureArrayLayers|GPUSupportedLimits.maxBindGroups|GPUSupportedLimits.maxBindGroupsPlusVertexBuffers|GPUSupportedLimits.maxBindingsPerBindGroup|GPUSupportedLimits.maxDynamicUniformBuffersPerPipelineLayout|GPUSupportedLimits.maxDynamicStorageBuffersPerPipelineLayout|GPUSupportedLimits.maxSampledTexturesPerShaderStage|GPUSupportedLimits.maxSamplersPerShaderStage|GPUSupportedLimits.maxStorageBuffersPerShaderStage|GPUSupportedLimits.maxStorageTexturesPerShaderStage|GPUSupportedLimits.maxUniformBuffersPerShaderStage|GPUSupportedLimits.maxUniformBufferBindingSize|GPUSupportedLimits.maxStorageBufferBindingSize|GPUSupportedLimits.minUniformBufferOffsetAlignment|GPUSupportedLimits.minStorageBufferOffsetAlignment|GPUSupportedLimits.maxVertexBuffers|GPUSupportedLimits.maxBufferSize|GPUSupportedLimits.maxVertexAttributes|GPUSupportedLimits.maxVertexBufferArrayStride|GPUSupportedLimits.maxInterStageShaderComponents|GPUSupportedLimits.maxInterStageShaderVariables|GPUSupportedLimits.maxColorAttachments|GPUSupportedLimits.maxColorAttachmentBytesPerSample|GPUSupportedLimits.maxComputeWorkgroupStorageSize|GPUSupportedLimits.maxComputeInvocationsPerWorkgroup|GPUSupportedLimits.maxComputeWorkgroupSizeX|GPUSupportedLimits.maxComputeWorkgroupSizeY|GPUSupportedLimits.maxComputeWorkgroupSizeZ|GPUSupportedLimits.maxComputeWorkgroupsPerDimension');
operations('DET-013', 'call', 'webgpu',
  'GPUDevice.createShaderModule|GPUDevice.createComputePipeline|GPUDevice.createRenderPipeline');
operations('DET-026', 'get', 'client-hints',
  'Navigator.userAgentData|NavigatorUAData.brands|NavigatorUAData.mobile|NavigatorUAData.platform');
operations('DET-026', 'async-call', 'client-hints',
  'NavigatorUAData.getHighEntropyValues');
operations('DET-031', 'get', 'screen-extended',
  'Screen.isExtended');
operations('DET-031', 'async-call', 'window-management',
  'Window.getScreenDetails');
operations('DET-031', 'get', 'window-management',
  'ScreenDetails.screens|ScreenDetails.currentScreen|ScreenDetailed.left|ScreenDetailed.top|Screen.availLeft|Screen.availTop|ScreenDetailed.devicePixelRatio|ScreenDetailed.label|ScreenDetailed.isPrimary|ScreenDetailed.isInternal');
operations('DET-042', 'construct', 'compute-pressure',
  'PressureObserver');
operations('DET-042', 'get', 'compute-pressure',
  'PressureObserver.knownSources|PressureRecord.source|PressureRecord.state|PressureRecord.time');
operations('DET-042', 'async-call', 'compute-pressure',
  'PressureObserver.observe');
operations('DET-042', 'call', 'compute-pressure',
  'PressureObserver.unobserve|PressureObserver.disconnect|PressureObserver.takeRecords|PressureRecord.toJSON');
operations('DET-043', 'construct', 'idle-detection',
  'IdleDetector');
operations('DET-043', 'async-call', 'idle-detection',
  'IdleDetector.requestPermission|IdleDetector.start');
operations('DET-043', 'get', 'idle-detection',
  'IdleDetector.userState|IdleDetector.screenState');
operations('DET-017', 'construct', 'audio',
  'AudioContext');
operations('DET-015', 'construct', 'audio',
  'OfflineAudioContext|OscillatorNode|DynamicsCompressorNode|AnalyserNode|GainNode');
operations('DET-015', 'async-call', 'audio',
  'OfflineAudioContext.startRendering');
operations('DET-015', 'call', 'audio',
  'BaseAudioContext.createOscillator|BaseAudioContext.createDynamicsCompressor|BaseAudioContext.createAnalyser|BaseAudioContext.createGain|BaseAudioContext.createBiquadFilter|BaseAudioContext.createBufferSource|AudioNode.connect|AudioScheduledSourceNode.start');
operations('DET-016', 'call', 'audio',
  'AudioBuffer.getChannelData|AudioBuffer.copyFromChannel|AnalyserNode.getFloatFrequencyData|AnalyserNode.getByteFrequencyData|AnalyserNode.getFloatTimeDomainData|AnalyserNode.getByteTimeDomainData');
operations('DET-017', 'get', 'audio',
  'BaseAudioContext.sampleRate|BaseAudioContext.destination|AudioContext.baseLatency|AudioContext.outputLatency|AudioDestinationNode.maxChannelCount');
operations('DET-029', 'get', 'screen-width',
  'Screen.width');
operations('DET-029', 'get', 'screen-height',
  'Screen.height');
operations('DET-029', 'get', 'screen-avail-width',
  'Screen.availWidth');
operations('DET-029', 'get', 'screen-avail-height',
  'Screen.availHeight');
operations('DET-029', 'get', 'screen-color-depth',
  'Screen.colorDepth');
operations('DET-029', 'get', 'screen-pixel-depth',
  'Screen.pixelDepth');
operations('DET-029', 'get', 'screen-orientation',
  'Screen.orientation|ScreenOrientation.angle|ScreenOrientation.type');
operations('DET-031', 'async-call', 'fullscreen',
  'Element.requestFullscreen|Document.exitFullscreen');
operations('DET-031', 'set', 'window-management',
  'Screen.onchange|ScreenDetails.onscreenschange|ScreenDetails.oncurrentscreenchange');
operations('DET-031', 'call', 'window-management',
  'Screen.addEventListener|Screen.removeEventListener|ScreenDetails.addEventListener|ScreenDetails.removeEventListener');
operations('DET-070', 'get', 'webnn',
  'Navigator.ml|MLContext.lost|MLTensor.dataType|MLTensor.shape|MLTensor.readable|MLTensor.writable|MLTensor.constant|MLOperand.dataType|MLOperand.shape');
operations('DET-070', 'async-call', 'webnn',
  'ML.createContext|MLGraphBuilder.build|MLContext.createTensor|MLContext.readTensor|MLContext.compute');
operations('DET-070', 'call', 'webnn',
  'MLContext.opSupportLimits|MLGraphBuilder.input|MLGraphBuilder.constant|MLContext.writeTensor|MLContext.dispatch|MLContext.destroy|MLGraph.destroy|MLTensor.destroy|MLGraphBuilder.add|MLGraphBuilder.sub|MLGraphBuilder.mul|MLGraphBuilder.div|MLGraphBuilder.matmul|MLGraphBuilder.gemm|MLGraphBuilder.conv2d|MLGraphBuilder.convTranspose2d|MLGraphBuilder.relu|MLGraphBuilder.sigmoid|MLGraphBuilder.softmax|MLGraphBuilder.reshape|MLGraphBuilder.transpose|MLGraphBuilder.concat|MLGraphBuilder.split|MLGraphBuilder.cast|MLGraphBuilder.reduceSum|MLGraphBuilder.reduceMean|MLGraphBuilder.gather|MLGraphBuilder.quantizeLinear|MLGraphBuilder.dequantizeLinear');
operations('DET-070', 'construct', 'webnn',
  'MLGraphBuilder');
operations('DET-020', 'call', 'webrtc-codecs',
  'RTCRtpSender.getCapabilities|RTCRtpReceiver.getCapabilities|RTCRtpSender.getParameters|RTCRtpReceiver.getParameters');
operations('DET-020', 'call', 'media-capabilities',
  'HTMLMediaElement.canPlayType|MediaSource.isTypeSupported');
operations('DET-020', 'async-call', 'media-capabilities',
  'MediaCapabilities.decodingInfo|MediaCapabilities.encodingInfo');
operations('DET-020', 'async-call', 'webcodecs-capabilities',
  'AudioDecoder.isConfigSupported|AudioEncoder.isConfigSupported|VideoDecoder.isConfigSupported|VideoEncoder.isConfigSupported|ImageDecoder.isTypeSupported');
operations('DET-018', 'call', 'speech-voices',
  'SpeechSynthesis.getVoices');
operations('DET-018', 'async-call', 'speech-recognition',
  'SpeechRecognition.available|SpeechRecognition.install');
operations('DET-019', 'async-call', 'media-enumeration',
  'MediaDevices.enumerateDevices');
operations('DET-019', 'call', 'media-capture',
  'MediaDevices.getSupportedConstraints|MediaStreamTrack.getCapabilities|MediaStreamTrack.getSettings');
operations('DET-019', 'async-call', 'media-capture',
  'MediaDevices.getUserMedia|MediaDevices.getDisplayMedia');
operations('DET-021', 'async-call', 'encrypted-media',
  'Navigator.requestMediaKeySystemAccess|MediaKeySystemAccess.createMediaKeys');
operations('DET-021', 'call', 'encrypted-media',
  'MediaKeySystemAccess.getConfiguration');
operations('DET-021', 'async-call', 'hdcp-policy',
  'MediaKeys.getStatusForPolicy');
operations('DET-045', 'async-call', 'bluetooth',
  'Bluetooth.getAvailability|Bluetooth.getDevices|Bluetooth.requestDevice');
operations('DET-046', 'async-call', 'usb',
  'USB.getDevices|USB.requestDevice');
operations('DET-046', 'async-call', 'hid',
  'HID.getDevices|HID.requestDevice');
operations('DET-046', 'async-call', 'serial',
  'Serial.getPorts|Serial.requestPort');
operations('DET-032', 'get', 'cpu-performance',
  'Navigator.cpuPerformance');
operations('DET-039', 'get', 'notifications',
  'Notification.maxActions');
operations('DET-071', 'async-call', 'builtin-ai-models',
  'LanguageModel.availability|LanguageModel.params|LanguageModel.create|Summarizer.availability|Summarizer.params|Summarizer.create|Writer.availability|Writer.params|Writer.create|Rewriter.availability|Rewriter.params|Rewriter.create|Proofreader.availability|Proofreader.params|Proofreader.create|LanguageModel.prompt|Summarizer.summarize|Writer.write|Rewriter.rewrite|Proofreader.proofread');
operations('DET-071', 'async-call', 'translation-ai',
  'Translator.availability|Translator.params|Translator.create|LanguageDetector.availability|LanguageDetector.params|LanguageDetector.create|Translator.translate|LanguageDetector.detect');
operations('DET-071', 'call', 'builtin-ai-models',
  'LanguageModel.promptStreaming|Summarizer.summarizeStreaming|Writer.writeStreaming|Rewriter.rewriteStreaming');
operations('DET-071', 'call', 'translation-ai',
  'Translator.translateStreaming');
operations('DET-072', 'async-call', 'handwriting-recognition',
  'Navigator.queryHandwritingRecognizer|Navigator.createHandwritingRecognizer');
operations('DET-072', 'construct', 'shape-detection',
  'BarcodeDetector|FaceDetector|TextDetector');
operations('DET-072', 'async-call', 'shape-detection',
  'BarcodeDetector.getSupportedFormats|BarcodeDetector.detect|FaceDetector.detect|TextDetector.detect');
operations('DET-073', 'async-call', 'installed-related-apps',
  'Navigator.getInstalledRelatedApps');
operations('DET-073', 'call', 'protocol-handlers',
  'Navigator.registerProtocolHandler|Navigator.unregisterProtocolHandler');
operations('DET-073', 'call', 'web-share',
  'Navigator.canShare');
operations('DET-073', 'async-call', 'web-share',
  'Navigator.share');
operations('DET-073', 'async-call', 'file-system-pickers',
  'Window.showOpenFilePicker|Window.showSaveFilePicker|Window.showDirectoryPicker');
operations('DET-073', 'async-call', 'opfs',
  'StorageManager.getDirectory');
operations('DET-073', 'async-call', 'push',
  'PushManager.permissionState|PushManager.getSubscription|PushManager.subscribe');
operations('DET-073', 'async-call', 'background-sync',
  'SyncManager.register|SyncManager.getTags');
operations('DET-073', 'async-call', 'periodic-sync',
  'PeriodicSyncManager.register|PeriodicSyncManager.getTags|PeriodicSyncManager.unregister');
operations('DET-073', 'async-call', 'background-fetch',
  'BackgroundFetchManager.fetch|BackgroundFetchManager.get|BackgroundFetchManager.getIds');
operations('DET-039', 'async-call', 'permission-probes',
  'Permissions.query');
operations('DET-056', 'construct', 'webrtc',
  'RTCPeerConnection');
operations('DET-056', 'async-call', 'webrtc,webrtc-certificates',
  'RTCPeerConnection.generateCertificate');
operations('DET-056', 'async-call', 'webrtc',
  'RTCPeerConnection.createOffer|RTCPeerConnection.createAnswer|RTCPeerConnection.setLocalDescription|RTCPeerConnection.setRemoteDescription|RTCPeerConnection.addIceCandidate');
operations('DET-056', 'call', 'webrtc',
  'RTCPeerConnection.createDataChannel|RTCPeerConnection.addTrack|RTCPeerConnection.removeTrack|RTCPeerConnection.addTransceiver|RTCPeerConnection.getConfiguration|RTCPeerConnection.setConfiguration|RTCPeerConnection.restartIce|RTCPeerConnection.close|RTCPeerConnection.getSenders|RTCPeerConnection.getReceivers|RTCPeerConnection.getTransceivers');
operations('DET-056', 'get', 'webrtc',
  'RTCPeerConnection.connectionState|RTCPeerConnection.iceConnectionState|RTCPeerConnection.iceGatheringState|RTCPeerConnection.signalingState|RTCPeerConnection.canTrickleIceCandidates');
operations('DET-057', 'get', 'webrtc',
  'RTCPeerConnection.localDescription|RTCPeerConnection.currentLocalDescription|RTCPeerConnection.pendingLocalDescription|RTCPeerConnection.remoteDescription|RTCPeerConnection.currentRemoteDescription|RTCPeerConnection.pendingRemoteDescription|RTCSessionDescription.sdp|RTCSessionDescription.type');
operations('DET-057', 'async-call', 'webrtc',
  'RTCPeerConnection.getStats|RTCRtpSender.getStats|RTCRtpReceiver.getStats');
operations('DET-057', 'call', 'webrtc',
  'RTCSessionDescription.toJSON|RTCStatsReport.get|RTCStatsReport.values|RTCStatsReport.entries|RTCStatsReport.forEach');
operations('DET-057', 'call', 'webrtc,webrtc-certificates',
  'RTCCertificate.getFingerprints');
operations('DET-057', 'get', 'webrtc,webrtc-certificates',
  'RTCCertificate.expires');
operations('DET-042', 'construct', 'generic-sensors',
  'Accelerometer|Gyroscope|LinearAccelerationSensor|GravitySensor|Magnetometer|AbsoluteOrientationSensor|RelativeOrientationSensor');
operations('DET-058', 'construct', 'webtransport',
  'WebTransport');
operations('DET-069', 'async-call', 'credential-management',
  'CredentialsContainer.create');
operations('DET-069', 'async-call', 'clipboard-read',
  'Clipboard.read|Clipboard.readText');
operations('DET-069', 'async-call', 'clipboard-write',
  'Clipboard.write|Clipboard.writeText');
operations('DET-014', 'async-call', 'webgpu',
  'GPUBuffer.mapAsync');
operations('DET-014', 'call', 'webgpu',
  'GPUBuffer.getMappedRange|GPUBuffer.unmap');
operations('DET-042', 'call', 'device-motion',
  'Window.addEventListener.deviceorientation|Window.addEventListener.devicemotion|Window.addEventListener.deviceorientationabsolute');
operations('DET-042', 'set', 'device-motion',
  'Window.ondeviceorientation|Window.ondevicemotion|Window.ondeviceorientationabsolute');
operations('DET-064', 'construct', 'dedicated-worker',
  'Worker');
operations('DET-064', 'construct', 'shared-worker',
  'SharedWorker');
operations('DET-049', 'get', 'document-cookie',
  'Document.cookie.get');
operations('DET-049', 'set', 'document-cookie',
  'Document.cookie.set');

for (const surface of WASM_SURFACES) operations('DET-065', surface.kind, 'webassembly,' + surface.feature, surface.operation);

// Only families whose existing counter unambiguously identifies this catalogue row.
// DET-025/029/030/032/036/042/049/053/058/064/069 are deliberately not expanded.
const techniqueRules = new Map([
  ['DET-001', 'canvas-readback'], ['DET-002', 'canvas-readback'], ['DET-004', 'canvas-readback'],
  ['DET-009', 'local-fonts'], ['DET-011', 'webgl'], ['DET-012', 'webgl'],
  ['DET-013', 'webgpu'], ['DET-014', 'webgpu'],
  ['DET-015', 'audio'], ['DET-016', 'audio'], ['DET-017', 'audio'],
  ['DET-022', 'math-transcendentals'], ['DET-023', 'math-transcendentals'],
  ['DET-026', 'client-hints'], ['DET-033', 'device-memory'], ['DET-034', 'touch-points'],
  ['DET-040', 'battery'], ['DET-041', 'network-information'], ['DET-044', 'geolocation'],
  ['DET-047', 'gamepads'], ['DET-048', 'webxr'], ['DET-052', 'cache-storage'],
  ['DET-054', 'storage-access'], ['DET-056', 'webrtc'], ['DET-057', 'webrtc'],
  ['DET-063', 'service-worker'], ['DET-065', 'webassembly'],
]);

export const API_OBSERVED_USAGE_LIMITS = Object.freeze({ documents: 32, operations: 128, techniques: 128, count: 2147483647 });
export const API_OBSERVED_USAGE_OPERATION_MAP = Object.freeze([...operationRules.values()]);
export const API_OBSERVED_USAGE_TECHNIQUE_MAP = Object.freeze([...techniqueRules].map(([techniqueId, id]) => Object.freeze({ techniqueId, id })));
const STATUSES = new Set(['ready', 'loading', 'no-site', 'no-access', 'unsupported', 'paused', 'error']);
const RELATIONS = new Set(['same-origin', 'same-site', 'cross-site', 'opaque', 'unknown']);
const QUALITIES = new Set(['exact', 'sampled', 'lower-bound']);
const PHASES = new Set(['attempted', 'returned-sync', 'threw-sync', 'async-returned', 'settlement-unobserved']);
const DOCUMENT = /^[A-Za-z0-9_:.-]{1,160}$/;
const HOST = /^(?:[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?|\[[0-9a-f:]{2,45}\])$/;

// A projection is defensive even though the privileged UI transport already validates reports.
// Accessors are never evaluated; proxy descriptor traps can only make a row unavailable.
function field(value, key) {
  try {
    if (!value || typeof value !== 'object') return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  } catch { return undefined; }
}
function list(value, maximum, limited) {
  try {
    if (!Array.isArray(value)) return [];
    const length = field(value, 'length');
    if (!Number.isSafeInteger(length) || length < 0) return [];
    if (length > maximum) limited.value = true;
    const out = [];
    for (let index = 0; index < Math.min(maximum, length); index++) {
      const entry = field(value, String(index));
      if (entry !== undefined) out.push(entry);
    }
    return out;
  } catch { return []; }
}
const positiveCount = value => Number.isInteger(value) && value > 0 && value <= API_OBSERVED_USAGE_LIMITS.count;
const quality = value => QUALITIES.has(value) ? value : null;
function mergeQuality(left, right) {
  return left === 'lower-bound' || right === 'lower-bound' ? 'lower-bound' : left === 'sampled' || right === 'sampled' ? 'sampled' : 'exact';
}
function increase(target, count, countQuality) {
  const sum = target.count + count;
  target.count = Math.min(API_OBSERVED_USAGE_LIMITS.count, sum);
  target.countQuality = sum > API_OBSERVED_USAGE_LIMITS.count ? 'lower-bound' : mergeQuality(target.countQuality, countQuality);
}
function bucket(map, id) {
  if (!map.has(id)) map.set(id, { id, count: 0, countQuality: 'exact', attempted: false, operations: new Set(), techniques: new Set() });
  return map.get(id);
}
function readTechniques(report, limited) {
  const rows = new Map();
  for (const raw of list(field(report, 'techniques'), API_OBSERVED_USAGE_LIMITS.techniques, limited)) {
    const techniqueId = field(raw, 'techniqueId'), count = field(raw, 'count'), countQuality = quality(field(raw, 'countQuality'));
    if (typeof techniqueId !== 'string' || !/^DET-0[0-7][0-9]$/.test(techniqueId) || !positiveCount(count) || !countQuality || rows.has(techniqueId)) continue;
    const phases = list(field(raw, 'phases'), 5, limited).filter(phase => PHASES.has(phase));
    rows.set(techniqueId, { count, countQuality, attempted: phases.includes('attempted') || phases.includes('threw-sync'),
      fingerprintPattern: field(raw, 'interpretation') === 'fingerprinting-pattern' });
  }
  return rows;
}
function projectDocument(report, limited) {
  const techniques = readTechniques(report, limited), exact = new Map(), seen = new Set();
  for (const raw of list(field(report, 'apiOperations'), API_OBSERVED_USAGE_LIMITS.operations, limited)) {
    const operation = field(raw, 'apiOperation'), phase = field(raw, 'phase');
    const definition = typeof operation === 'string' ? operationRules.get(operation) : null;
    const count = field(raw, 'count'), countQuality = quality(field(raw, 'countQuality'));
    if (!definition || !positiveCount(count) || !countQuality ||
      phase !== 'threw-sync' && phase !== (definition.kind === 'async-call' ? 'settlement-unobserved' : 'returned-sync')) continue;
    const key = operation + '|' + phase;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const id of definition.ids) {
      const row = bucket(exact, id);
      increase(row, count, countQuality);
      row.attempted ||= phase === 'threw-sync';
      row.operations.add(operation); row.techniques.add(definition.techniqueId);
    }
  }
  const coarse = new Map();
  for (const [techniqueId, id] of techniqueRules) {
    const observation = techniques.get(techniqueId);
    if (!observation || exact.has(id)) continue;
    const row = bucket(coarse, id);
    increase(row, observation.count, observation.countQuality);
    row.attempted ||= observation.attempted; row.techniques.add(techniqueId);
  }
  const out = [];
  for (const [map, basis] of [[exact, 'operation'], [coarse, 'technique']]) for (const row of map.values()) {
    row.fingerprintPattern = [...row.techniques].some(id => techniques.get(id)?.fingerprintPattern === true);
    out.push({ ...row, basis });
  }
  return out;
}

export function emptyObservedUsage(status = 'loading') {
  return { status: STATUSES.has(status) ? status : 'error', byApi: Object.create(null), documentCount: 0, truncated: false };
}

/**
 * documents = [{ report: ReportProjection, relation: canonical document/frame relation }].
 * Counts describe recorded observations, including attempts; they are not distinct script calls.
 * first/third party refers only to the execution document. Script caller is always unknown.
 */
export function projectObservedUsage(documents, options = {}) {
  const requestedStatus = field(options, 'status'), status = requestedStatus === undefined ? 'ready' : requestedStatus;
  const result = emptyObservedUsage(status);
  if (result.status !== 'ready') return result;
  const limited = { value: field(options, 'truncated') === true }, admitted = new Map();
  for (const raw of list(documents, API_OBSERVED_USAGE_LIMITS.documents, limited)) {
    const report = field(raw, 'report'), documentKey = field(report, 'documentKey'), revision = field(report, 'reportRevision');
    if (typeof documentKey !== 'string' || !DOCUMENT.test(documentKey) || !Number.isSafeInteger(revision) || revision < 0) continue;
    // Paused/inaccessible reports must not resurrect stale highlights.
    if (['paused', 'no-access', 'unsupported'].includes(field(report, 'coverageState')) || field(report, 'scopeMode') === 'off') continue;
    const relationValue = field(raw, 'relation'), relation = RELATIONS.has(relationValue) ? relationValue : 'unknown';
    const hostValue = field(report, 'host'), host = typeof hostValue === 'string' && HOST.test(hostValue) ? hostValue : null;
    const previous = admitted.get(documentKey);
    if (previous && previous.revision >= revision) continue;
    admitted.set(documentKey, { report, documentKey, revision, relation, host });
  }
  const rows = new Map();
  for (const document of admitted.values()) for (const local of projectDocument(document.report, limited)) {
    const row = bucket(rows, local.id);
    increase(row, local.count, local.countQuality);
    row.attempted ||= local.attempted; row.fingerprintPattern ||= local.fingerprintPattern;
    for (const operation of local.operations) row.operations.add(operation);
    for (const technique of local.techniques) row.techniques.add(technique);
    row.basis = row.basis === 'operation' || local.basis === 'operation' ? 'operation' : 'technique';
    row.sources ??= [];
    row.sources.push({ documentKey: document.documentKey, host: document.host, relation: document.relation, callerRelation: 'unknown',
      count: local.count, countQuality: local.countQuality, basis: local.basis });
    const party = document.relation === 'same-origin' || document.relation === 'same-site' ? 'firstPartyCount' : document.relation === 'cross-site' ? 'thirdPartyCount' : 'unknownCount';
    row[party] = Math.min(API_OBSERVED_USAGE_LIMITS.count, (row[party] ?? 0) + local.count);
  }
  for (const id of [...rows.keys()].sort()) {
    const row = rows.get(id);
    result.byApi[id] = { ...row, fingerprintPattern: row.fingerprintPattern === true,
      operations: [...row.operations].sort(), techniques: [...row.techniques].sort(),
      sources: row.sources.sort((a, b) => a.documentKey.localeCompare(b.documentKey)),
      firstPartyCount: row.firstPartyCount ?? 0, thirdPartyCount: row.thirdPartyCount ?? 0, unknownCount: row.unknownCount ?? 0 };
  }
  result.documentCount = admitted.size; result.truncated = limited.value;
  return result;
}
