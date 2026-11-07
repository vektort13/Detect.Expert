import { protectHost, isProtectSessionKey } from "./protect-sw.js";
import { ApiConfigurationController } from "./api-configuration-controller.js";
import { createVendorRedirectTracker } from "./vendor-redirects.js";
import { installProxyService } from "./proxy-service.js";
import { createProxyPrivacyOverlay } from "./proxy-privacy.js";
import { installAutosurfService } from "./autosurf-service.js";
import { customEntries } from "./api-configuration-controller.js";
import { installFingerprintEngineService } from "./fingerprint-engine-service.js";
import { prepareFingerprintWorkerSource } from "./fingerprint-engine-worker.js";
import { installPrecursorModesService } from "./precursor-modes-service.js";
import { readPrecursorZone } from "./precursor-zone-route.js";
import { readCookieSnapshot, readLoaderRows, readTagManagerDocuments, readSocialRows, readSocialDocuments, normalizeProCookieMetadata } from "./inspection-contracts.js";
import { CookieWriterObserver } from "./cookie-writer-observer.js";
import { readCookieWriterRequest } from "./cookie-writers-contracts.js";
import { ProRequestValuesObserver } from "./pro-request-values.js";
import { ProCookieValuesObserver } from "./pro-cookie-values.js";
import { SiteFaviconCache } from "./site-favicon.js";
import { BeaconObserver } from "./beacon-observer.js";
import { readBeaconRequest } from "./beacon-contracts.js";
import { BackgroundActivityObserver } from "./background-activity-observer.js";
import { readBackgroundRequest } from "./background-activity-contracts.js";
import { CookieProbe } from "./cookie-probe.js";
import { readCookieProbeRequest } from "./cookie-probe-contracts.js";
import { retainCookieProbe } from "./pro-advanced-capture.js";
import { readAdvancedPageFields } from "./advanced-contracts.js";
import { BEACON_REQUEST_FILTER } from "./beacon-decoder.js";
import { ThirdPartyObserver } from "./third-party-observer.js";
import { PrecursorObserver } from "./precursor-observer.js";
import { readPrecursorRequest } from "./precursor-contracts.js";
import { readThirdPartyRequest } from "./third-party-contracts.js";
import { mergeLoaderRows } from "./inspection-contracts.js";
import { readCookieRequest, readClearCookiesRequest, readClearCookiesResult, readCookieViewRequest, readCookieView, readCookieValueRequest, readCookieValueResult } from "./inspection-contracts.js";
import { CookieInspector } from "./cookie-inspector.js";
import { ProCookieCapture } from "./pro-cookie-capture.js";
import { SocialNetworkObserver } from "./social-network-observer.js";
import { readSocialRequest, readSocialSnapshot } from "./inspection-contracts.js";
import { SensorQuietGate, presentQuietCoverage } from "./sensor-quiet.js";
import { withProReportHistoryPurge } from "./pro-report-history.js";
// packages/contracts/src/technique-ids.ts
var TECHNIQUE_IDS = [
  "DET-001",
  "DET-002",
  "DET-003",
  "DET-004",
  "DET-005",
  "DET-006",
  "DET-007",
  "DET-008",
  "DET-009",
  "DET-010",
  "DET-011",
  "DET-012",
  "DET-013",
  "DET-014",
  "DET-015",
  "DET-016",
  "DET-017",
  "DET-018",
  "DET-019",
  "DET-020",
  "DET-021",
  "DET-022",
  "DET-023",
  "DET-024",
  "DET-025",
  "DET-026",
  "DET-027",
  "DET-028",
  "DET-029",
  "DET-030",
  "DET-031",
  "DET-032",
  "DET-033",
  "DET-034",
  "DET-035",
  "DET-036",
  "DET-037",
  "DET-038",
  "DET-039",
  "DET-040",
  "DET-041",
  "DET-042",
  "DET-043",
  "DET-044",
  "DET-045",
  "DET-046",
  "DET-047",
  "DET-048",
  "DET-049",
  "DET-050",
  "DET-051",
  "DET-052",
  "DET-053",
  "DET-054",
  "DET-055",
  "DET-056",
  "DET-057",
  "DET-058",
  "DET-059",
  "DET-060",
  "DET-061",
  "DET-062",
  "DET-063",
  "DET-064",
  "DET-065",
  "DET-066",
  "DET-067",
  "DET-068",
  "DET-069",
  "DET-070",
  "DET-071",
  "DET-072",
  "DET-073",
  "DET-074"
];

// packages/contracts/src/enums.ts
var SIGNAL_CODES = [
  "api-use",
  "readback-after-text",
  "offline-render",
  "numeric-diversity",
  "known-numeric-pattern",
  "local-multi-port",
  "unique-subdomains",
  "early-observation",
  "late-start",
  "hook-failed",
  "sample-budget-exceeded",
  "tainted-canvas-attempt",
  "export-after-text",
  "hook-replaced",
  "bfcache-restore",
  "text-measured",
  "text-drawn",
  // ADR-026: bounded facts about site API use; never pointer coordinates or arbitrary API names.
  "movement-listener",
  "pointer-coordinate-read",
  "permission-camera",
  "permission-microphone",
  "permission-geolocation",
  "permission-notifications",
  "permission-clipboard-read",
  "permission-clipboard-write",
  "permission-persistent-storage",
  "permission-background-sync",
  "permission-midi",
  "permission-sensors",
  "permission-payment-handler",
  "permission-screen-wake-lock",
  "permission-window-management",
  "permission-local-fonts",
  "permission-display-capture",
  "permission-storage-access",
  "permission-unknown",
  "permission-granted",
  "permission-denied",
  "permission-prompt",
  "policy-allowed",
  "policy-blocked",
  "policy-enumeration"
], PERMISSION_NAMES = [
  "camera",
  "microphone",
  "geolocation",
  "notifications",
  "clipboard-read",
  "clipboard-write",
  "persistent-storage",
  "background-sync",
  "midi",
  "sensors",
  "payment-handler",
  "screen-wake-lock",
  "window-management",
  "local-fonts",
  "display-capture",
  "storage-access",
  "unknown"
], PERMISSION_CHECK_KINDS = ["permission", "policy"], PERMISSION_CHECK_RESULTS = ["granted", "denied", "prompt", "allowed", "blocked"], COVERAGE_FLAGS = [
  "late-start",
  "hook-failed",
  "throttled",
  "unsupported-realm",
  "channel-gap",
  "truncated",
  "paused",
  "revoked",
  "protocol-mismatch",
  "descriptor-nonconfigurable",
  "bridge-ring-overflow",
  "budget-exceeded",
  "no-host-permission",
  "restricted-page",
  "worker-not-observed",
  // Permission-limited network and inaccessible child frames (REQ-006, ADR-003, F175).
  "network-limited",
  "frames-inaccessible"
], EVIDENCE_SOURCES = [
  "browser-network",
  "browser-navigation",
  "page-hook",
  "page-dom",
  "derived"
], INTEGRITIES = ["browser-observed", "page-controlled", "derived"], INTERPRETATIONS = [
  "api-use",
  "possible-fingerprinting",
  "fingerprinting-pattern",
  "local-probe-pattern",
  "dns-test-pattern",
  "unknown"
], INTERPRETATION_CONFIDENCES = ["low", "medium", "high", "unassessed"], ATTRIBUTION_CONFIDENCES = ["exact-resource", "sampled-stack", "frame-only", "unknown"], VENDOR_MATCHES = ["documented-resource", "multi-signal", "weak-signal", "none"], COVERAGE_STATES = [
  "active",
  "partial",
  "late-start",
  "paused",
  "unsupported",
  "no-access",
  "degraded"
], COUNT_QUALITIES = ["exact", "sampled", "lower-bound"], PHASES = [
  "attempted",
  "returned-sync",
  "threw-sync",
  "async-returned",
  "settlement-unobserved"
], SCOPE_MODES = ["off", "active-tab", "site", "all-sites"], SENSOR_STATES = ["active", "paused", "degraded", "stopped"], BRIDGE_STOP_REASONS = ["protocol-mismatch", "revoked", "scope-changed", "unload"], BRIDGE_CONTROL_COMMANDS = ["pause", "resume"];

// packages/contracts/src/budgets.ts
var BUDGETS = {
  /** Wire batch: observations per PageBatch. */
  maxBatchEvents: 32,
  /** Wire batch: serialized bytes, checked after bounded structural validation. */
  maxBatchBytes: 16384,
  /** Any incoming string (specialized fields may be shorter). */
  maxStringChars: 512,
  /** sensorBootId / bridgeSessionId and similar local identifiers. */
  maxIdChars: 64,
  /** documentKey (assigned by the SW from MessageSender / webNavigation). */
  maxDocumentKeyChars: 128,
  /** Rate after aggregation (token bucket); not a recommended normal rate. */
  maxBatchesPerSecondPerDocument: 20,
  maxBatchesPerSecondPerTab: 100,
  maxBatchesPerSecondGlobal: 200,
  /** ISOLATED bridge ring: normalized aggregates per document; oldest unacknowledged dropped with a gap marker. */
  maxBridgeRecordsPerDocument: 512,
  /** Normal flush window when data is present. */
  flushMinMs: 250,
  flushMaxMs: 500,
  /** Hot Math: at most one aggregate per this window. */
  hotMathFlushMs: 500,
  /** Sensor counters per document per sensor group; rare keys fold into `other`. */
  maxCountersPerDocumentGroup: 128,
  maxFindingsPerDocument: 256,
  maxHostsPerDocument: 128,
  /** Serialized document aggregate target. */
  maxReportSerializedBytes: 102400,
  /** Session storage estimate for reports + indexes + diagnostics together. */
  maxSessionTotalBytes: 4194304,
  inactiveDocumentTtlMs: 6e5,
  /** Diagnostics ring: inside the session budget; session only; no domains/paths/page content. */
  maxDiagnosticsBytes: 1048576,
  diagnosticsTtlMs: 864e5,
  /** Out-of-order quarantine (per extension). */
  maxOutOfOrderEntriesGlobal: 128,
  outOfOrderTtlMs: 2e3,
  /** Math stack sampling per realm. */
  maxMathStackSamplesPerWindow: 8,
  mathSampleWindowMs: 2e3,
  mathAttributionSlots: 32,
  /** Per-observation signal codes. */
  maxSignalCodesPerObservation: 8,
  /** Saturation ceiling for counts and sequence numbers. */
  maxCount: 2147483647
};

// packages/contracts/src/messages.ts
var EMPTY_DROPPED = Object.freeze({
  observations: 0,
  batches: 0,
  findings: 0,
  hosts: 0,
  counters: 0,
  transport: 0
});
function counterKey(techniqueId, phase, signalCodes, apiOperation, extensionResource) {
  let legacy = techniqueId + "|" + phase + "|" + [...signalCodes].sort().join(",");
  return extensionResource !== void 0 ? legacy + "|extension|" + extensionResource.target + "|" + extensionResource.method : apiOperation === void 0 ? legacy : legacy + "|" + apiOperation;
}
function makeDocumentKey(tabId, frameId, documentId2) {
  return String(tabId) + ":" + String(frameId) + ":" + documentId2;
}

// packages/contracts/src/host.ts
var HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/, IPV6_RE = /^\[[0-9a-f:.]{2,45}\]$/, ALLOWED_PROTOCOLS = /* @__PURE__ */ new Set(["http:", "https:", "ws:", "wss:"]), MAX_HOST_CHARS = 253, MAX_URL_CHARS = 65536;
function isSanitizedHost(value) {
  return typeof value == "string" && value.length > 0 && value.length <= MAX_HOST_CHARS && (HOST_RE.test(value) || IPV6_RE.test(value));
}
function sanitizeHost(url) {
  if (typeof url != "string" || url.length === 0 || url.length > MAX_URL_CHARS) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return null;
  let host2 = parsed.hostname;
  return host2.endsWith(".") && (host2 = host2.slice(0, -1)), host2.length === 0 || host2.length > MAX_HOST_CHARS ? null : IPV6_RE.test(host2) || HOST_RE.test(host2) ? host2 : null;
}

// packages/contracts/src/api-operations.ts
var API_OPERATION_DEFINITIONS = [
  ["GPU.requestAdapter","DET-013","webgpu","async-call"],
  ["GPUAdapter.requestDevice","DET-013","webgpu","async-call"],
  ["GPUAdapter.info","DET-013","webgpu","get"],
  ["GPUAdapter.features","DET-013","webgpu","get"],
  ["GPUAdapter.limits","DET-013","webgpu","get"],
  ["GPUDevice.adapterInfo","DET-013","webgpu","get"],
  ["GPUDevice.features","DET-013","webgpu","get"],
  ["GPUDevice.limits","DET-013","webgpu","get"],
  ["GPUDevice.createShaderModule","DET-013","webgpu","call"],
  ["GPUDevice.createComputePipeline","DET-013","webgpu","call"],
  ["GPUDevice.createComputePipelineAsync","DET-013","webgpu","async-call"],
  ["GPUDevice.createRenderPipeline","DET-013","webgpu","call"],
  ["GPUDevice.createRenderPipelineAsync","DET-013","webgpu","async-call"],
  ["GPUShaderModule.getCompilationInfo","DET-013","webgpu","async-call"],
  ["GPUAdapterInfo.vendor","DET-013","webgpu","get"],
  ["GPUAdapterInfo.architecture","DET-013","webgpu","get"],
  ["GPUAdapterInfo.device","DET-013","webgpu","get"],
  ["GPUAdapterInfo.description","DET-013","webgpu","get"],
  ["GPUAdapterInfo.powerPreference","DET-013","webgpu","get"],
  ["GPUAdapterInfo.isFallbackAdapter","DET-013","webgpu","get"],
  ["GPUAdapterInfo.subgroupMinSize","DET-013","webgpu","get"],
  ["GPUAdapterInfo.subgroupMaxSize","DET-013","webgpu","get"],
  ["GPUAdapterInfo.type","DET-013","webgpu","get"],
  ["GPUAdapterInfo.backend","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxTextureDimension1D","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxTextureDimension2D","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxTextureDimension3D","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxTextureArrayLayers","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxBindGroups","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxBindGroupsPlusVertexBuffers","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxBindingsPerBindGroup","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxDynamicUniformBuffersPerPipelineLayout","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxDynamicStorageBuffersPerPipelineLayout","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxSampledTexturesPerShaderStage","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxSamplersPerShaderStage","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxStorageBuffersPerShaderStage","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxStorageTexturesPerShaderStage","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxUniformBuffersPerShaderStage","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxUniformBufferBindingSize","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxStorageBufferBindingSize","DET-013","webgpu","get"],
  ["GPUSupportedLimits.minUniformBufferOffsetAlignment","DET-013","webgpu","get"],
  ["GPUSupportedLimits.minStorageBufferOffsetAlignment","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxVertexBuffers","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxBufferSize","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxVertexAttributes","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxVertexBufferArrayStride","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxInterStageShaderComponents","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxInterStageShaderVariables","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxColorAttachments","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxColorAttachmentBytesPerSample","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxComputeWorkgroupStorageSize","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxComputeInvocationsPerWorkgroup","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxComputeWorkgroupSizeX","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxComputeWorkgroupSizeY","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxComputeWorkgroupSizeZ","DET-013","webgpu","get"],
  ["GPUSupportedLimits.maxComputeWorkgroupsPerDimension","DET-013","webgpu","get"],
  ["WebAssembly.compile","DET-065","wasm","async-call"],
  ["WebAssembly.instantiate","DET-065","wasm","async-call"],
  ["WebAssembly.compileStreaming","DET-065","wasm","async-call"],
  ["WebAssembly.instantiateStreaming","DET-065","wasm","async-call"],
  ["WebAssembly.validate","DET-065","wasm","call"],
  ["WebAssembly.Module","DET-065","wasm","construct"],
  ["WebAssembly.Instance","DET-065","wasm","construct"],
  ["WebAssembly.Memory","DET-065","wasm","construct"],
  ["WebAssembly.Memory.grow","DET-065","wasm","call"],
  ["WebAssembly.Memory.buffer","DET-065","wasm","get"],
  ["Navigator.userAgentData","DET-026","client-hints","get"],
  ["NavigatorUAData.brands","DET-026","client-hints","get"],
  ["NavigatorUAData.mobile","DET-026","client-hints","get"],
  ["NavigatorUAData.platform","DET-026","client-hints","get"],
  ["NavigatorUAData.getHighEntropyValues","DET-026","client-hints","async-call"],
  ["Screen.isExtended","DET-031","window-management","get"],
  ["Window.getScreenDetails","DET-031","window-management","async-call"],
  ["ScreenDetails.screens","DET-031","window-management","get"],
  ["ScreenDetails.currentScreen","DET-031","window-management","get"],
  ["ScreenDetailed.left","DET-031","window-management","get"],
  ["ScreenDetailed.top","DET-031","window-management","get"],
  ["Screen.availLeft","DET-031","window-management","get"],
  ["Screen.availTop","DET-031","window-management","get"],
  ["ScreenDetailed.devicePixelRatio","DET-031","window-management","get"],
  ["ScreenDetailed.label","DET-031","window-management","get"],
  ["ScreenDetailed.isPrimary","DET-031","window-management","get"],
  ["ScreenDetailed.isInternal","DET-031","window-management","get"],
  ["PressureObserver","DET-042","compute-pressure","construct"],
  ["PressureObserver.knownSources","DET-042","compute-pressure","get"],
  ["PressureObserver.observe","DET-042","compute-pressure","async-call"],
  ["PressureObserver.unobserve","DET-042","compute-pressure","call"],
  ["PressureObserver.disconnect","DET-042","compute-pressure","call"],
  ["PressureObserver.takeRecords","DET-042","compute-pressure","call"],
  ["PressureRecord.source","DET-042","compute-pressure","get"],
  ["PressureRecord.state","DET-042","compute-pressure","get"],
  ["PressureRecord.time","DET-042","compute-pressure","get"],
  ["IdleDetector","DET-043","idle-detection","construct"],
  ["IdleDetector.requestPermission","DET-043","idle-detection","async-call"],
  ["IdleDetector.start","DET-043","idle-detection","async-call"],
  ["IdleDetector.userState","DET-043","idle-detection","get"],
  ["IdleDetector.screenState","DET-043","idle-detection","get"],
  ["AudioContext","DET-017","audio","construct"],
  ["OfflineAudioContext","DET-015","audio","construct"],
  ["OfflineAudioContext.startRendering","DET-015","audio","async-call"],
  ["BaseAudioContext.createOscillator","DET-015","audio","call"],
  ["BaseAudioContext.createDynamicsCompressor","DET-015","audio","call"],
  ["BaseAudioContext.createAnalyser","DET-015","audio","call"],
  ["BaseAudioContext.createGain","DET-015","audio","call"],
  ["BaseAudioContext.createBiquadFilter","DET-015","audio","call"],
  ["BaseAudioContext.createBufferSource","DET-015","audio","call"],
  ["AudioNode.connect","DET-015","audio","call"],
  ["AudioScheduledSourceNode.start","DET-015","audio","call"],
  ["OscillatorNode","DET-015","audio","construct"],
  ["DynamicsCompressorNode","DET-015","audio","construct"],
  ["AnalyserNode","DET-015","audio","construct"],
  ["GainNode","DET-015","audio","construct"],
  ["AudioBuffer.getChannelData","DET-016","audio","call"],
  ["AudioBuffer.copyFromChannel","DET-016","audio","call"],
  ["AnalyserNode.getFloatFrequencyData","DET-016","audio","call"],
  ["AnalyserNode.getByteFrequencyData","DET-016","audio","call"],
  ["AnalyserNode.getFloatTimeDomainData","DET-016","audio","call"],
  ["AnalyserNode.getByteTimeDomainData","DET-016","audio","call"],
  ["BaseAudioContext.sampleRate","DET-017","audio","get"],
  ["BaseAudioContext.destination","DET-017","audio","get"],
  ["AudioContext.baseLatency","DET-017","audio","get"],
  ["AudioContext.outputLatency","DET-017","audio","get"],
  ["AudioDestinationNode.maxChannelCount","DET-017","audio","get"],
  ["Screen.width","DET-029","window-management","get"],
  ["Screen.height","DET-029","window-management","get"],
  ["Screen.availWidth","DET-029","window-management","get"],
  ["Screen.availHeight","DET-029","window-management","get"],
  ["Screen.colorDepth","DET-029","window-management","get"],
  ["Screen.pixelDepth","DET-029","window-management","get"],
  ["Screen.orientation","DET-029","window-management","get"],
  ["ScreenOrientation.angle","DET-029","window-management","get"],
  ["ScreenOrientation.type","DET-029","window-management","get"],
  ["Window.screenX","DET-030","window-management","get"],
  ["Window.screenY","DET-030","window-management","get"],
  ["Window.screenLeft","DET-030","window-management","get"],
  ["Window.screenTop","DET-030","window-management","get"],
  ["Window.outerWidth","DET-030","window-management","get"],
  ["Window.outerHeight","DET-030","window-management","get"],
  ["Element.requestFullscreen","DET-031","window-management","async-call"],
  ["Document.exitFullscreen","DET-031","window-management","async-call"],
  ["Window.open","DET-031","window-management","call"],
  ["Window.moveTo","DET-031","window-management","call"],
  ["Window.moveBy","DET-031","window-management","call"],
  ["Window.resizeTo","DET-031","window-management","call"],
  ["Window.resizeBy","DET-031","window-management","call"],
  ["Screen.onchange","DET-031","window-management","set"],
  ["ScreenDetails.onscreenschange","DET-031","window-management","set"],
  ["ScreenDetails.oncurrentscreenchange","DET-031","window-management","set"],
  ["Screen.addEventListener","DET-031","window-management","call"],
  ["Screen.removeEventListener","DET-031","window-management","call"],
  ["ScreenDetails.addEventListener","DET-031","window-management","call"],
  ["ScreenDetails.removeEventListener","DET-031","window-management","call"],
  ["PressureRecord.toJSON","DET-042","compute-pressure","call"],
  ["Navigator.ml","DET-070","webnn","get"],
  ["ML.createContext","DET-070","webnn","async-call"],
  ["MLContext.opSupportLimits","DET-070","webnn","call"],
  ["MLGraphBuilder","DET-070","webnn","construct"],
  ["MLGraphBuilder.input","DET-070","webnn","call"],
  ["MLGraphBuilder.constant","DET-070","webnn","call"],
  ["MLGraphBuilder.build","DET-070","webnn","async-call"],
  ["MLContext.createTensor","DET-070","webnn","async-call"],
  ["MLContext.readTensor","DET-070","webnn","async-call"],
  ["MLContext.writeTensor","DET-070","webnn","call"],
  ["MLContext.dispatch","DET-070","webnn","call"],
  ["MLContext.compute","DET-070","webnn","async-call"],
  ["MLContext.destroy","DET-070","webnn","call"],
  ["MLContext.lost","DET-070","webnn","get"],
  ["MLGraph.destroy","DET-070","webnn","call"],
  ["MLTensor.dataType","DET-070","webnn","get"],
  ["MLTensor.shape","DET-070","webnn","get"],
  ["MLTensor.readable","DET-070","webnn","get"],
  ["MLTensor.writable","DET-070","webnn","get"],
  ["MLTensor.constant","DET-070","webnn","get"],
  ["MLTensor.destroy","DET-070","webnn","call"],
  ["MLOperand.dataType","DET-070","webnn","get"],
  ["MLOperand.shape","DET-070","webnn","get"],
  ["MLGraphBuilder.add","DET-070","webnn","call"],
  ["MLGraphBuilder.sub","DET-070","webnn","call"],
  ["MLGraphBuilder.mul","DET-070","webnn","call"],
  ["MLGraphBuilder.div","DET-070","webnn","call"],
  ["MLGraphBuilder.matmul","DET-070","webnn","call"],
  ["MLGraphBuilder.gemm","DET-070","webnn","call"],
  ["MLGraphBuilder.conv2d","DET-070","webnn","call"],
  ["MLGraphBuilder.convTranspose2d","DET-070","webnn","call"],
  ["MLGraphBuilder.relu","DET-070","webnn","call"],
  ["MLGraphBuilder.sigmoid","DET-070","webnn","call"],
  ["MLGraphBuilder.softmax","DET-070","webnn","call"],
  ["MLGraphBuilder.reshape","DET-070","webnn","call"],
  ["MLGraphBuilder.transpose","DET-070","webnn","call"],
  ["MLGraphBuilder.concat","DET-070","webnn","call"],
  ["MLGraphBuilder.split","DET-070","webnn","call"],
  ["MLGraphBuilder.cast","DET-070","webnn","call"],
  ["MLGraphBuilder.reduceSum","DET-070","webnn","call"],
  ["MLGraphBuilder.reduceMean","DET-070","webnn","call"],
  ["MLGraphBuilder.gather","DET-070","webnn","call"],
  ["MLGraphBuilder.quantizeLinear","DET-070","webnn","call"],
  ["MLGraphBuilder.dequantizeLinear","DET-070","webnn","call"],
  ["RTCRtpSender.getCapabilities","DET-020","media-capabilities","call"],
  ["RTCRtpReceiver.getCapabilities","DET-020","media-capabilities","call"],
  ["HTMLMediaElement.canPlayType","DET-020","media-capabilities","call"],
  ["MediaSource.isTypeSupported","DET-020","media-capabilities","call"],
  ["MediaCapabilities.decodingInfo","DET-020","media-capabilities","async-call"],
  ["MediaCapabilities.encodingInfo","DET-020","media-capabilities","async-call"],
  ["AudioDecoder.isConfigSupported","DET-020","media-capabilities","async-call"],
  ["AudioEncoder.isConfigSupported","DET-020","media-capabilities","async-call"],
  ["VideoDecoder.isConfigSupported","DET-020","media-capabilities","async-call"],
  ["VideoEncoder.isConfigSupported","DET-020","media-capabilities","async-call"],
  ["ImageDecoder.isTypeSupported","DET-020","media-capabilities","async-call"],
  ["SpeechSynthesis.getVoices","DET-018","speech","call"],
  ["SpeechRecognition.available","DET-018","speech","async-call"],
  ["SpeechRecognition.install","DET-018","speech","async-call"],
  ["MediaDevices.enumerateDevices","DET-019","media-devices","async-call"],
  ["MediaDevices.getSupportedConstraints","DET-019","media-devices","call"],
  ["MediaDevices.getUserMedia","DET-019","media-devices","async-call"],
  ["MediaDevices.getDisplayMedia","DET-019","media-devices","async-call"],
  ["MediaStreamTrack.getCapabilities","DET-019","media-devices","call"],
  ["MediaStreamTrack.getSettings","DET-019","media-devices","call"],
  ["Navigator.requestMediaKeySystemAccess","DET-021","drm","async-call"],
  ["MediaKeySystemAccess.getConfiguration","DET-021","drm","call"],
  ["MediaKeySystemAccess.createMediaKeys","DET-021","drm","async-call"],
  ["MediaKeys.getStatusForPolicy","DET-021","drm","async-call"],
  ["Bluetooth.getAvailability","DET-045","device-access","async-call"],
  ["Bluetooth.getDevices","DET-045","device-access","async-call"],
  ["Bluetooth.requestDevice","DET-045","device-access","async-call"],
  ["USB.getDevices","DET-046","device-access","async-call"],
  ["USB.requestDevice","DET-046","device-access","async-call"],
  ["HID.getDevices","DET-046","device-access","async-call"],
  ["HID.requestDevice","DET-046","device-access","async-call"],
  ["Serial.getPorts","DET-046","device-access","async-call"],
  ["Serial.requestPort","DET-046","device-access","async-call"],
  ["Navigator.cpuPerformance","DET-032","browser-capabilities","get"],
  ["Intl.supportedValuesOf","DET-036","browser-capabilities","call"],
  ["PerformanceObserver.supportedEntryTypes","DET-066","browser-capabilities","get"],
  ["Notification.maxActions","DET-039","browser-capabilities","get"],
  ["LanguageModel.availability","DET-071","builtin-ai","async-call"],
  ["LanguageModel.params","DET-071","builtin-ai","async-call"],
  ["LanguageModel.create","DET-071","builtin-ai","async-call"],
  ["Translator.availability","DET-071","builtin-ai","async-call"],
  ["Translator.params","DET-071","builtin-ai","async-call"],
  ["Translator.create","DET-071","builtin-ai","async-call"],
  ["Summarizer.availability","DET-071","builtin-ai","async-call"],
  ["Summarizer.params","DET-071","builtin-ai","async-call"],
  ["Summarizer.create","DET-071","builtin-ai","async-call"],
  ["Writer.availability","DET-071","builtin-ai","async-call"],
  ["Writer.params","DET-071","builtin-ai","async-call"],
  ["Writer.create","DET-071","builtin-ai","async-call"],
  ["Rewriter.availability","DET-071","builtin-ai","async-call"],
  ["Rewriter.params","DET-071","builtin-ai","async-call"],
  ["Rewriter.create","DET-071","builtin-ai","async-call"],
  ["LanguageDetector.availability","DET-071","builtin-ai","async-call"],
  ["LanguageDetector.params","DET-071","builtin-ai","async-call"],
  ["LanguageDetector.create","DET-071","builtin-ai","async-call"],
  ["Proofreader.availability","DET-071","builtin-ai","async-call"],
  ["Proofreader.params","DET-071","builtin-ai","async-call"],
  ["Proofreader.create","DET-071","builtin-ai","async-call"],
  ["LanguageModel.prompt","DET-071","builtin-ai","async-call"],
  ["LanguageModel.promptStreaming","DET-071","builtin-ai","call"],
  ["Translator.translate","DET-071","builtin-ai","async-call"],
  ["Translator.translateStreaming","DET-071","builtin-ai","call"],
  ["Summarizer.summarize","DET-071","builtin-ai","async-call"],
  ["Summarizer.summarizeStreaming","DET-071","builtin-ai","call"],
  ["Writer.write","DET-071","builtin-ai","async-call"],
  ["Writer.writeStreaming","DET-071","builtin-ai","call"],
  ["Rewriter.rewrite","DET-071","builtin-ai","async-call"],
  ["Rewriter.rewriteStreaming","DET-071","builtin-ai","call"],
  ["LanguageDetector.detect","DET-071","builtin-ai","async-call"],
  ["Proofreader.proofread","DET-071","builtin-ai","async-call"],
  ["Navigator.queryHandwritingRecognizer","DET-072","recognition","async-call"],
  ["Navigator.createHandwritingRecognizer","DET-072","recognition","async-call"],
  ["BarcodeDetector","DET-072","recognition","construct"],
  ["BarcodeDetector.getSupportedFormats","DET-072","recognition","async-call"],
  ["BarcodeDetector.detect","DET-072","recognition","async-call"],
  ["FaceDetector","DET-072","recognition","construct"],
  ["FaceDetector.detect","DET-072","recognition","async-call"],
  ["TextDetector","DET-072","recognition","construct"],
  ["TextDetector.detect","DET-072","recognition","async-call"],
  ["Navigator.getInstalledRelatedApps","DET-073","app-integration","async-call"],
  ["Navigator.registerProtocolHandler","DET-073","app-integration","call"],
  ["Navigator.unregisterProtocolHandler","DET-073","app-integration","call"],
  ["Window.getDigitalGoodsService","DET-073","app-integration","async-call"],
  ["Navigator.locks","DET-073","app-integration","get"],
  ["LockManager.query","DET-073","app-integration","async-call"],
  ["LockManager.request","DET-073","app-integration","async-call"],
  ["Navigator.setAppBadge","DET-073","app-integration","async-call"],
  ["Navigator.clearAppBadge","DET-073","app-integration","async-call"],
  ["Navigator.canShare","DET-073","app-integration","call"],
  ["Navigator.share","DET-073","app-integration","async-call"],
  ["Window.showOpenFilePicker","DET-073","app-integration","async-call"],
  ["Window.showSaveFilePicker","DET-073","app-integration","async-call"],
  ["Window.showDirectoryPicker","DET-073","app-integration","async-call"],
  ["StorageManager.getDirectory","DET-073","app-integration","async-call"],
  ["FileSystemHandle.queryPermission","DET-073","app-integration","async-call"],
  ["FileSystemHandle.requestPermission","DET-073","app-integration","async-call"],
  ["PushManager.permissionState","DET-073","app-integration","async-call"],
  ["PushManager.getSubscription","DET-073","app-integration","async-call"],
  ["PushManager.subscribe","DET-073","app-integration","async-call"],
  ["SyncManager.register","DET-073","app-integration","async-call"],
  ["SyncManager.getTags","DET-073","app-integration","async-call"],
  ["PeriodicSyncManager.register","DET-073","app-integration","async-call"],
  ["PeriodicSyncManager.getTags","DET-073","app-integration","async-call"],
  ["PeriodicSyncManager.unregister","DET-073","app-integration","async-call"],
  ["BackgroundFetchManager.fetch","DET-073","app-integration","async-call"],
  ["BackgroundFetchManager.get","DET-073","app-integration","async-call"],
  ["BackgroundFetchManager.getIds","DET-073","app-integration","async-call"],
  ["Navigation.navigate","DET-073","app-integration","call"],
  ["Navigation.reload","DET-073","app-integration","call"],
  ["Navigation.back","DET-073","app-integration","call"],
  ["Navigation.forward","DET-073","app-integration","call"],
  ["Navigation.traverseTo","DET-073","app-integration","call"],
  ["CloseWatcher","DET-073","app-integration","construct"],
  ["CloseWatcher.requestClose","DET-073","app-integration","call"],
  ["CloseWatcher.close","DET-073","app-integration","call"],
  ["CloseWatcher.destroy","DET-073","app-integration","call"],
  ["HTMLElement.showPopover","DET-073","app-integration","call"],
  ["HTMLElement.hidePopover","DET-073","app-integration","call"],
  ["HTMLElement.togglePopover","DET-073","app-integration","call"],
  ["Navigator.ink","DET-073","app-integration","get"],
  ["Ink.requestPresenter","DET-073","app-integration","async-call"],
  ["TrustedTypePolicyFactory.createPolicy","DET-073","app-integration","call"],
  ["TrustedTypePolicyFactory.isHTML","DET-073","app-integration","call"],
  ["TrustedTypePolicyFactory.isScript","DET-073","app-integration","call"],
  ["TrustedTypePolicyFactory.isScriptURL","DET-073","app-integration","call"],
  ["TrustedTypePolicyFactory.getAttributeType","DET-073","app-integration","call"],
  ["TrustedTypePolicyFactory.getPropertyType","DET-073","app-integration","call"],
  ["Permissions.query","DET-039","browser-capabilities","async-call"],
  ["RTCPeerConnection","DET-056","webrtc","construct"],
  ["RTCPeerConnection.generateCertificate","DET-056","webrtc","async-call"],
  ["RTCPeerConnection.createOffer","DET-056","webrtc","async-call"],
  ["RTCPeerConnection.createAnswer","DET-056","webrtc","async-call"],
  ["RTCPeerConnection.setLocalDescription","DET-056","webrtc","async-call"],
  ["RTCPeerConnection.setRemoteDescription","DET-056","webrtc","async-call"],
  ["RTCPeerConnection.addIceCandidate","DET-056","webrtc","async-call"],
  ["RTCPeerConnection.createDataChannel","DET-056","webrtc","call"],
  ["RTCPeerConnection.addTrack","DET-056","webrtc","call"],
  ["RTCPeerConnection.removeTrack","DET-056","webrtc","call"],
  ["RTCPeerConnection.addTransceiver","DET-056","webrtc","call"],
  ["RTCPeerConnection.getConfiguration","DET-056","webrtc","call"],
  ["RTCPeerConnection.setConfiguration","DET-056","webrtc","call"],
  ["RTCPeerConnection.restartIce","DET-056","webrtc","call"],
  ["RTCPeerConnection.close","DET-056","webrtc","call"],
  ["RTCPeerConnection.getSenders","DET-056","webrtc","call"],
  ["RTCPeerConnection.getReceivers","DET-056","webrtc","call"],
  ["RTCPeerConnection.getTransceivers","DET-056","webrtc","call"],
  ["RTCPeerConnection.connectionState","DET-056","webrtc","get"],
  ["RTCPeerConnection.iceConnectionState","DET-056","webrtc","get"],
  ["RTCPeerConnection.iceGatheringState","DET-056","webrtc","get"],
  ["RTCPeerConnection.signalingState","DET-056","webrtc","get"],
  ["RTCPeerConnection.canTrickleIceCandidates","DET-056","webrtc","get"],
  ["RTCPeerConnection.localDescription","DET-057","webrtc","get"],
  ["RTCPeerConnection.currentLocalDescription","DET-057","webrtc","get"],
  ["RTCPeerConnection.pendingLocalDescription","DET-057","webrtc","get"],
  ["RTCPeerConnection.remoteDescription","DET-057","webrtc","get"],
  ["RTCPeerConnection.currentRemoteDescription","DET-057","webrtc","get"],
  ["RTCPeerConnection.pendingRemoteDescription","DET-057","webrtc","get"],
  ["RTCPeerConnection.getStats","DET-057","webrtc","async-call"],
  ["RTCSessionDescription.sdp","DET-057","webrtc","get"],
  ["RTCSessionDescription.type","DET-057","webrtc","get"],
  ["RTCSessionDescription.toJSON","DET-057","webrtc","call"],
  ["RTCCertificate.getFingerprints","DET-057","webrtc","call"],
  ["RTCCertificate.expires","DET-057","webrtc","get"],
  ["RTCRtpSender.getParameters","DET-020","webrtc","call"],
  ["RTCRtpReceiver.getParameters","DET-020","webrtc","call"],
  ["RTCRtpSender.getStats","DET-057","webrtc","async-call"],
  ["RTCRtpReceiver.getStats","DET-057","webrtc","async-call"],
  ["RTCStatsReport.get","DET-057","webrtc","call"],
  ["RTCStatsReport.values","DET-057","webrtc","call"],
  ["RTCStatsReport.entries","DET-057","webrtc","call"],
  ["RTCStatsReport.forEach","DET-057","webrtc","call"],
  ["IDBObjectStore.put","DET-051","webrtc","call"],
  ["IDBObjectStore.add","DET-051","webrtc","call"],
  ["IDBRequest.result","DET-051","webrtc","get"],
  ["Accelerometer","DET-042","device-sensor","construct"],
  ["Gyroscope","DET-042","device-sensor","construct"],
  ["LinearAccelerationSensor","DET-042","device-sensor","construct"],
  ["GravitySensor","DET-042","device-sensor","construct"],
  ["Magnetometer","DET-042","device-sensor","construct"],
  ["AbsoluteOrientationSensor","DET-042","device-sensor","construct"],
  ["RelativeOrientationSensor","DET-042","device-sensor","construct"],
  ["WebTransport","DET-058","webtransport","construct"],
  ["CredentialsContainer.create","DET-069","webauthn","async-call"],
  ["Clipboard.read","DET-069","clipboard","async-call"],
  ["Clipboard.readText","DET-069","clipboard","async-call"],
  ["Clipboard.write","DET-069","clipboard","async-call"],
  ["Clipboard.writeText","DET-069","clipboard","async-call"],
  ["GPUBuffer.mapAsync","DET-014","webgpu","async-call"],
  ["GPUBuffer.getMappedRange","DET-014","webgpu","call"],
  ["GPUBuffer.unmap","DET-014","webgpu","call"],
  ["Window.addEventListener.deviceorientation","DET-042","device-sensor","call"],
  ["Window.ondeviceorientation","DET-042","device-sensor","set"],
  ["Window.addEventListener.devicemotion","DET-042","device-sensor","call"],
  ["Window.ondevicemotion","DET-042","device-sensor","set"],
  ["Window.addEventListener.deviceorientationabsolute","DET-042","device-sensor","call"],
  ["Window.ondeviceorientationabsolute","DET-042","device-sensor","set"],
  ["Worker","DET-064","worker","construct"],
  ["SharedWorker","DET-064","worker","construct"],
  ["Worklet.addModule","DET-064","worker","async-call"],
  ["Document.cookie.get","DET-049","storage","get"],
  ["Document.cookie.set","DET-049","storage","set"],
  ["WebAssembly.Module.imports","DET-065","wasm","call"],
  ["WebAssembly.Module.exports","DET-065","wasm","call"],
  ["WebAssembly.Module.customSections","DET-065","wasm","call"],
  ["WebAssembly.Instance.exports","DET-065","wasm","get"],
  ["WebAssembly.Table","DET-065","wasm","construct"],
  ["WebAssembly.Table.length","DET-065","wasm","get"],
  ["WebAssembly.Table.grow","DET-065","wasm","call"],
  ["WebAssembly.Table.get","DET-065","wasm","call"],
  ["WebAssembly.Table.set","DET-065","wasm","call"],
  ["WebAssembly.Global","DET-065","wasm","construct"],
  ["WebAssembly.Global.valueOf","DET-065","wasm","call"],
  ["WebAssembly.Global.value","DET-065","wasm","get"],
  ["WebAssembly.Global.value.set","DET-065","wasm","set"],
  ["WebAssembly.Tag","DET-065","wasm","construct"],
  ["WebAssembly.Exception","DET-065","wasm","construct"],
  ["WebAssembly.Exception.is","DET-065","wasm","call"],
  ["WebAssembly.Exception.getArg","DET-065","wasm","call"],
  ["WebAssembly.Exception.stack","DET-065","wasm","get"],
  ["WebAssembly.CompileError","DET-065","wasm","construct"],
  ["WebAssembly.LinkError","DET-065","wasm","construct"],
  ["WebAssembly.RuntimeError","DET-065","wasm","construct"],
  ["WebAssembly.Suspending","DET-065","wasm","construct"],
  ["WebAssembly.promising","DET-065","wasm","call"],
  ["WebAssembly.SuspendError","DET-065","wasm","construct"],
  ["WebAssembly.Memory.toFixedLengthBuffer","DET-065","wasm","call"],
  ["WebAssembly.Memory.toResizableBuffer","DET-065","wasm","call"],
  ["WebAssembly.Tag.type","DET-065","wasm","call"]
], API_OPERATIONS = Object.freeze(API_OPERATION_DEFINITIONS.map((definition) => definition[0]));
var apply = Reflect.apply, mapGet = Map.prototype.get, definitions = new Map(API_OPERATION_DEFINITIONS.map(([operation, techniqueId, mechanism, kind]) => [operation, Object.freeze({ techniqueId, mechanism, kind })]));
function apiOperationDefinition(operation) {
  return typeof operation != "string" || operation.length > 64 ? null : apply(mapGet, definitions, [operation]) ?? null;
}
function isApiOperation(operation) {
  return apiOperationDefinition(operation) !== null;
}
function apiOperationAllows(operation, techniqueId, phase) {
  let definition = apiOperationDefinition(operation);
  return definition !== null && definition.techniqueId === techniqueId && (phase === "threw-sync" || phase === (definition.kind === "async-call" ? "settlement-unobserved" : "returned-sync"));
}
function readApiOperations(value) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > BUDGETS.maxCountersPerDocumentGroup || Reflect.ownKeys(value).length !== value.length + 1) return null;
    let out = [], seen = /* @__PURE__ */ new Set(), keys4 = ["apiOperation", "phase", "count", "countQuality"];
    for (let index = 0; index < value.length; index++) {
      let item = Object.getOwnPropertyDescriptor(value, String(index));
      if (!item || !Object.hasOwn(item, "value")) return null;
      let row = item.value;
      if (typeof row != "object" || row === null || Array.isArray(row) || Reflect.ownKeys(row).length !== keys4.length) return null;
      let prototype = Object.getPrototypeOf(row);
      if (prototype !== Object.prototype && prototype !== null) return null;
      let fields4 = [];
      for (let key3 of keys4) {
        let field3 = Object.getOwnPropertyDescriptor(row, key3);
        if (!field3 || !field3.enumerable || !Object.hasOwn(field3, "value")) return null;
        fields4.push(field3.value);
      }
      let [apiOperation, phase, count3, countQuality] = fields4, definition = apiOperationDefinition(apiOperation);
      if (definition === null || !PHASES.includes(phase) || !COUNT_QUALITIES.includes(countQuality) || !apiOperationAllows(apiOperation, definition.techniqueId, phase) || typeof count3 != "number" || !Number.isInteger(count3) || count3 < 1 || count3 > 2147483647) return null;
      let key2 = String(apiOperation) + "|" + String(phase);
      if (seen.has(key2)) return null;
      seen.add(key2), out.push({ apiOperation, phase, count: count3, countQuality });
    }
    return out;
  } catch {
    return null;
  }
}

// packages/contracts/src/extension-targets.generated.ts
var EXTENSION_TARGET_IDS = [
  "aapbdbdomjkkjkaonfhkkikfgjllcleb",
  "adlpodnneegcnbophopdmhedicjbcgco",
  "admmjipmmciaobhojoghlmleefbicajg",
  "ahmpjcflkgiildlgicmcieglgoilbfdp",
  "akcocjjpkmlniicdeemdceeajlmoabhg",
  "alncdjedloppbablonallfbkeiknmkdi",
  "ammoloihpcbognfddfjcljgembpibcmb",
  "bfbameneiokkgbdmiekhjnmfkcnldhhm",
  "bfogiafebfohielmmehodmfbbebbbpei",
  "bgnkhhnnamicmpeenaelnjfhikgbkllg",
  "bhchdcejhohfmigjafbampogmaanbfkg",
  "bhmmomiinigofkjcapegjjndpbikblnp",
  "bkdgflcldnnnapblkhphbgpggdiikppg",
  "bmnlcjabgnpnenekpadlanbbkooimhnj",
  "bpoadfkcbjbfhfodiogcnhhhpibjhbnh",
  "caljgklbbfbcjjanaijlacgncafpegll",
  "cfhdojbkjhnklbpkdaibdccddilifddb",
  "chhjbpecpncaggjpdakmflnfcopglcmi",
  "cmedhionkhpnakcndndgjdbohmhepckk",
  "cofdbpoegempjloogbagkncekinflcnj",
  "cpcifbdmkopohnnofedkjghjiclmhdah",
  "dahenjhkoodjbpjheillcadbppiidmhp",
  "ddkjiahejlhfcafbddmgiahcphecmpfh",
  "dgjbaljgolmlcmmklmmeafecikidmjpi",
  "dhdgffkkebhmkfjojejmpbldmpobfkfo",
  "dhopldobnfjeckokfjimfcdagmlhjdce",
  "djflhoibgkdhkhhcedjiklpkjnoahfmg",
  "dmghijelimhndkbmpgbldicpogfkceaj",
  "doojmbjmlfjjnbmnoijecmcbfeoakpjm",
  "eclbecdgdoahkliaijlpkigldlkojjdn",
  "ecnphlgnajanjnkcmbpancdjoidceilk",
  "edacconmaakjimmfgnblocblbcdcpbko",
  "edlifbnjlicfpckhgjhflgkeeibhhcii",
  "eenflijjbchafephdplkdmeenekabdfb",
  "efaidnbmnnnibpcajpcglclefindmkaj",
  "egjidjbpglichdcondbcbdnbeeppgdph",
  "eiadekoaikejlgdbkbdfeijglgfdalml",
  "eimadpbcbfnmbkopoojfekhnkhdbieeh",
  "einpaelgookohagofgnnkcfjbkkgepnp",
  "ejjladinnckdgjemekebdpeokbikhfci",
  "elicpjhcidhpjomhibiffojpinpmmpil",
  "emalgedpdlghbkikiaeocoblajamonoh",
  "eppiocemhmnlbhjplcgkofciiegomcon",
  "facgnnelgcipeopfbjcajpaibhhdjgcp",
  "fcalilbnpkfikdppppppchmkdipibalb",
  "fcoeoabgfenejglbffodgkkbkcdhcgfn",
  "fhkphphbadjkepgfljndicmgdlndmoke",
  "fjkmabmdepjfammlpliljpnbhleegehm",
  "fjoaledfpmneenckfbpdfhkmimnjocfa",
  "fllaojicojecljbmefodhfapmkghcbnh",
  "fmkadmapgofadopljbjfkapdkoienihi",
  "gcalenpjmijncebpfijmoaglllgpjagf",
  "gcoekeoenehjmndhkdnoomdjeaclkhbe",
  "gdbofhhdmcladcmmfjolgndfkpobecpg",
  "gebbhagfogifgggkldgodflihgfeippi",
  "gekdekpbfehejjiecgonmgmepbdnaggp",
  "gighmmpiobklfepjocnamgkkbiglidom",
  "gjjbmfigjpgnehjioicaalopaikcnheo",
  "gjoijpfmdhbjkkgnmahganhoinjjpohk",
  "gkojfkhlekighikafcpjkiklfbnlmeio",
  "glcimepnljoholdmjchkloafkggfoijh",
  "gomekmidlodglbbmalcneegieacbdmki",
  "hdokiejnpimakedhajhdlcegeplioahd",
  "hhnhplojcganfmfimkeboiipphklcbih",
  "hipncndjamdcmphkgngojegjblibadbe",
  "hkdmdpdhfaamhgaojpelccmeehpfljgf",
  "hmlcjjclebjnfohgmgikjfnbmfkigocc",
  "hnfanknocfeofbddgcijnmhnfnkdnaad",
  "hniebljpgcogalllopnjokppmgbhaden",
  "iidnankcocecmgpcafggbgbmkbcldmno",
  "inoeonmfapjbbkmdafoankkfajkcphgd",
  "inomeogfingihgjfjlpeplalcfajhgai",
  "jaoafpkngncfpfggjefnekilbkcpjdgp",
  "jchobbjgibcahbheicfocecmhocglkco",
  "jdopnakmnlnccgpfpmjmdjjohmcdgabp",
  "jgfbgkjjlonelmpenhpfeeljjlcgnkpe",
  "jinjaccalgkegednnccohejagnlnfdag",
  "jlhmfgmfgeifomenelglieieghnjghma",
  "jofioghmpdcgiiobkhmdojhjbjiejfbd",
  "jpkfgepcmmchgfbjblnodjhldacghenp",
  "kadocklfjjaaekpjhmpbkbjkhloacing",
  "kbfnbcaeplbcioakkpcpgfkobkghlhen",
  "kceglpglilklghkgofolieongaolnaob",
  "kdfieneakcjfaiglcfcgkidlkmlijjnh",
  "kdmnjgijlmjgmimahnillepgcgeemffb",
  "kobncfkmjelbefaoohoblamnbackjggk",
  "kpdjmbiefanbdgnkcikhllpmjnnllbbc",
  "kpiecbcckbofpmkkkdibbllpinceiihk",
  "lanfdkkpgfjfdikkncbnojekcppdebfp",
  "ldipcbpaocekfooobnbcddclnhejkcpn",
  "ldpochfccmkkmhdbclfhpagapcfdljkj",
  "lejoknkbcogjceoniealiipllomkpioe",
  "lfdconleibeikjpklmlahaihpnkpmlch",
  "lfidjngibpklhhijphdmbmedchiiolgk",
  "lgblnfidahcdcjddiepkckcfdhpknnjh",
  "lgjhepbpjcmfmjlpkkdjlbgomamkgonb",
  "llbcnfanfmjhpedaedhbcnpgeepdnnok",
  "lmjnegcaeklhafolokijcfjliaokphfk",
  "lneaocagcijjdpkcabeanfpdbmapcjjg",
  "majdfhpaihoncoakbjgbdhglocklcgno",
  "mbniclmhobmnbdlbpiphghaielnnpgdp",
  "mciiogijehkdemklbdcbfkefimifhecn",
  "mclkkofklkfljcocdinagocijmpgbhab",
  "mcohilncbfahbmgdjkbpemcciiolgcge",
  "meojnmfhjkahlfcecpdcdgjclcilmaij",
  "mfpiaehgjbbfednooihadalhehabhcjo",
  "mhkgegcmcapcgmnnloigolapjkajgfmd",
  "mlomiejdfkolichcflejclcbmpeaniij",
  "mmeijimgabbpbgpdklnllpncmdofkcpn",
  "mpnlkmlkncncpgnnkmkgoobfpnjmblnk",
  "ncennffkjdiamlpmcbajkmaiiiddgioo",
  "nfadicbbecgbdbgbibgflooojfbolpgk",
  "njgehaondchbmjmajphnhlojfnbfokng",
  "nkbihfbeogaeaoehlefnkodbefgpgknn",
  "nlipoenfbbikpbjkfpfillcgkoblgpmj",
  "nngceckbapebfimnlniiiahkandclblb",
  "nomnklagbgmgghhjidfhnoelnjfndfpd",
  "npeicpdbkakmehahjeeohfdhnlpdklia",
  "oaobmlmjmhedmlphfdmdjpppjmcljnkp",
  "oejgccbfbmkkpaidnkphaiaecficdnfn",
  "oemmndcbldboiebfnladdacbdfmadadm",
  "oldceeleldhonbafppcapldpdifcinji",
  "olnbjpaejebpnokblkepbphhembdicik",
  "omghfjlpggmjjaagoclmmobgdodcjboh",
  "pcbjiidheaempljdefbdplebgdgpjcbe",
  "pkehgijcmpdhfbdbbnkijodmdjhbjlgp",
  "ponfpcnoihfmfllpaingbgckeeldkhle",
  "ppnbnpeolgkicgegkbkbjmhlideopiji"
];

// packages/contracts/src/extension-resources.ts
var EXTENSION_TARGET_KEYS = ["unknown", ...EXTENSION_TARGET_IDS], EXTENSION_RESOURCE_METHODS = ["fetch", "xhr-send", "image-src", "script-src"], apply2 = Reflect.apply, mapGet2 = Map.prototype.get, targets = new Map(EXTENSION_TARGET_KEYS.map((target, index) => [target, index]));
function extensionTargetIndex(target) {
  return typeof target != "string" || target.length > 32 ? null : apply2(mapGet2, targets, [target]) ?? null;
}
function extensionResourceAllows(resource2, techniqueId, phase) {
  return techniqueId === "DET-059" && (phase === "threw-sync" || phase === (resource2.method === "fetch" || resource2.method === "xhr-send" ? "settlement-unobserved" : "returned-sync"));
}
function readExtensionResource(value) {
  try {
    if (typeof value != "object" || value === null || Array.isArray(value) || Reflect.ownKeys(value).length !== 2) return null;
    let prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    let target = Object.getOwnPropertyDescriptor(value, "target"), method = Object.getOwnPropertyDescriptor(value, "method");
    return !target?.enumerable || !method?.enumerable || !Object.hasOwn(target, "value") || !Object.hasOwn(method, "value") || extensionTargetIndex(target.value) === null || !EXTENSION_RESOURCE_METHODS.includes(method.value) ? null : { target: target.value, method: method.value };
  } catch {
    return null;
  }
}
function readExtensionResources(value) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > BUDGETS.maxCountersPerDocumentGroup || Reflect.ownKeys(value).length !== value.length + 1) return null;
    let result = [], seen = /* @__PURE__ */ new Set();
    for (let index = 0; index < value.length; index++) {
      let item = Object.getOwnPropertyDescriptor(value, String(index));
      if (!item?.enumerable || !Object.hasOwn(item, "value")) return null;
      let row = item.value;
      if (typeof row != "object" || row === null || Reflect.ownKeys(row).length !== 5) return null;
      let prototype = Object.getPrototypeOf(row);
      if (prototype !== Object.prototype && prototype !== null) return null;
      let fields4 = [];
      for (let key3 of ["target", "method", "phase", "count", "countQuality"]) {
        let field3 = Object.getOwnPropertyDescriptor(row, key3);
        if (!field3?.enumerable || !Object.hasOwn(field3, "value")) return null;
        fields4.push(field3.value);
      }
      let [target, method, phase, count3, countQuality] = fields4, resource2 = readExtensionResource({ target, method });
      if (!resource2 || !extensionResourceAllows(resource2, "DET-059", phase) || typeof count3 != "number" || !Number.isInteger(count3) || count3 < 1 || count3 > 2147483647 || !COUNT_QUALITIES.includes(countQuality)) return null;
      let key2 = resource2.target + "|" + resource2.method + "|" + String(phase);
      if (seen.has(key2)) return null;
      seen.add(key2), result.push({ ...resource2, phase, count: count3, countQuality });
    }
    return result;
  } catch {
    return null;
  }
}

/* clear-reset:native-reset-ack:start */
var capturedOwnKeys = Reflect.ownKeys, capturedDescriptor = Object.getOwnPropertyDescriptor, capturedCreate = Object.create;
function readDataFields(input, allowed, required) {
  if (!isObjectLike(input)) return null;
  const keys = capturedOwnKeys(input);
  if (keys.length > capturedApply(capturedSetSize, allowed, [])) return null;
  const fields = capturedCreate(null);
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index];
    if (typeof key !== "string" || !setContains(allowed, key)) return null;
    const descriptor = capturedDescriptor(input, key);
    if (descriptor === void 0 || !hasOwn(descriptor, "value") || !descriptor.enumerable) return null;
    fields[key] = descriptor.value;
  }
  for (let index = 0; index < required.length; index++) if (!hasOwn(fields, required[index])) return null;
  return fields;
}
function validateBridgeResetAck(input) {
  try {
    const required = ["schemaVersion", "type", "resetId", "bridgeSessionId", "sensorBootIds"];
    const fields = readDataFields(input, new Set(required), required);
    if (fields === null) return fail("reset-ack.fields");
    input = fields;
    if (!isObjectLike(input)) return fail("reset-ack.object");
    const resetId = readId(input["resetId"]);
    const bridgeSessionId = readId(input["bridgeSessionId"]);
    const boots = input["sensorBootIds"];
    if (input["schemaVersion"] !== 1 || input["type"] !== "bridge-reset-ack" || resetId === null || bridgeSessionId === null || !capturedIsArray(boots)) return fail("reset-ack.shape");
    const lengthDescriptor = capturedDescriptor(boots, "length");
    const length = lengthDescriptor !== void 0 && hasOwn(lengthDescriptor, "value") ? readInt(lengthDescriptor.value, 1, 4) : null;
    if (length === null || capturedOwnKeys(boots).length !== length + 1) return fail("reset-ack.boots");
    const sensorBootIds = [];
    for (let index = 0; index < length; index++) {
      const descriptor = capturedDescriptor(boots, String(index));
      const id = descriptor !== void 0 && hasOwn(descriptor, "value") && descriptor.enumerable ? readId(descriptor.value) : null;
      if (id === null || sensorBootIds.includes(id)) return fail("reset-ack.boots");
      sensorBootIds.push(id);
    }
    return { ok: true, value: { schemaVersion: 1, type: "bridge-reset-ack", resetId, bridgeSessionId, sensorBootIds } };
  } catch {
    return fail("reset-ack.exception");
  }
}
/* clear-reset:native-reset-ack:end */
// packages/contracts/src/validate.ts
var capturedApply = Reflect.apply, capturedKeys = Object.keys, capturedIsArray = Array.isArray, capturedHasOwn = Object.prototype.hasOwnProperty, capturedSetHas = Set.prototype.has, capturedSetSize = Object.getOwnPropertyDescriptor(Set.prototype, "size").get, capturedInteger = Number.isInteger, capturedRegexExec = RegExp.prototype.exec;
function setContains(set, value) {
  return capturedApply(capturedSetHas, set, [value]);
}
var TECHNIQUE_SET = new Set(TECHNIQUE_IDS), SIGNAL_SET = new Set(SIGNAL_CODES), COVERAGE_SET = new Set(COVERAGE_FLAGS), COUNT_QUALITY_SET = new Set(COUNT_QUALITIES), PHASE_SET = new Set(PHASES), SCOPE_SET = new Set(SCOPE_MODES), SENSOR_STATE_SET = new Set(SENSOR_STATES), STOP_REASON_SET = new Set(BRIDGE_STOP_REASONS), CONTROL_COMMAND_SET = new Set(BRIDGE_CONTROL_COMMANDS), ID_RE = /^[A-Za-z0-9_-]+$/, DOCUMENT_KEY_RE = /^[A-Za-z0-9_:.-]+$/, FORBIDDEN_KEYS = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]), MAX_ENUM_CHARS = 64, MAX_TYPE_CHARS = 32;
function fail(reason) {
  return { ok: !1, reason };
}
function isObjectLike(v) {
  return typeof v == "object" && v !== null && !capturedIsArray(v);
}
function hasOwn(o, k) {
  return capturedApply(capturedHasOwn, o, [k]);
}
function checkKeys(obj, allowed, required, path) {
  let keys4 = capturedKeys(obj);
  if (keys4.length > capturedApply(capturedSetSize, allowed, [])) return path + ": too many keys";
  for (let i = 0; i < keys4.length; i++) {
    let k = keys4[i];
    if (setContains(FORBIDDEN_KEYS, k)) return path + ": forbidden key";
    if (!setContains(allowed, k)) return path + ": unknown key";
  }
  for (let i = 0; i < required.length; i++) {
    let r = required[i];
    if (!hasOwn(obj, r)) return path + ": missing " + r;
  }
  return null;
}
function readString(v, max) {
  return typeof v == "string" && v.length >= 1 && v.length <= max ? v : null;
}
function readId(v) {
  let s = readString(v, BUDGETS.maxIdChars);
  return s !== null && capturedApply(capturedRegexExec, ID_RE, [s]) !== null ? s : null;
}
function readDocumentKey(v) {
  let s = readString(v, BUDGETS.maxDocumentKeyChars);
  return s !== null && capturedApply(capturedRegexExec, DOCUMENT_KEY_RE, [s]) !== null ? s : null;
}
function readBool(v) {
  return typeof v == "boolean" ? v : null;
}
function readInt(v, min, max) {
  return typeof v != "number" || !capturedInteger(v) || v < min || v > max ? null : v === 0 ? 0 : v;
}
function readCount(v) {
  return typeof v != "number" || !capturedInteger(v) || v < 0 ? null : v > 2147483647 ? 2147483647 : v === 0 ? 0 : v;
}
function readEnum(v, set) {
  return typeof v == "string" && v.length <= MAX_ENUM_CHARS && setContains(set, v) ? v : null;
}
function readEnumArray(v, set, max) {
  if (!capturedIsArray(v) || v.length > max) return null;
  let out = [], seen = /* @__PURE__ */ new Set();
  for (let item of v) {
    let e = readEnum(item, set);
    if (e === null || seen.has(e)) return null;
    seen.add(e), out.push(e);
  }
  return out;
}
function readCoverageFlags(v) {
  return readEnumArray(v, COVERAGE_SET, COVERAGE_FLAGS.length);
}
var OBS_KEYS = ["techniqueId", "count", "countQuality", "phase", "signalCodes", "intervalBucket"], OBS_KEY_SET = /* @__PURE__ */ new Set([...OBS_KEYS, "apiOperation", "extensionResource"]);
function validateObservation(v, path) {
  if (!isObjectLike(v)) return fail(path + ": not an object");
  let keyError = checkKeys(v, OBS_KEY_SET, OBS_KEYS, path);
  if (keyError !== null) return fail(keyError);
  let techniqueId = readEnum(v.techniqueId, TECHNIQUE_SET);
  if (techniqueId === null || techniqueId === "DET-074") return fail(path + ".techniqueId");
  let count3 = readCount(v.count);
  if (count3 === null) return fail(path + ".count");
  let countQuality = readEnum(v.countQuality, COUNT_QUALITY_SET);
  if (countQuality === null) return fail(path + ".countQuality");
  let phase = readEnum(v.phase, PHASE_SET);
  if (phase === null) return fail(path + ".phase");
  let signalCodes = readEnumArray(v.signalCodes, SIGNAL_SET, BUDGETS.maxSignalCodesPerObservation);
  if (signalCodes === null) return fail(path + ".signalCodes");
  let intervalBucket = readInt(v.intervalBucket, 0, 2147483647);
  if (intervalBucket === null) return fail(path + ".intervalBucket");
  if (hasOwn(v, "extensionResource")) {
    let field3 = Object.getOwnPropertyDescriptor(v, "extensionResource"), resource2 = field3 && hasOwn(field3, "value") && field3.enumerable ? readExtensionResource(field3.value) : null;
    return !resource2 || hasOwn(v, "apiOperation") || !extensionResourceAllows(resource2, techniqueId, phase) || signalCodes.length !== 1 || signalCodes[0] !== "api-use" ? fail(path + ".extensionResource") : { ok: !0, value: { techniqueId, count: count3, countQuality, phase, signalCodes, intervalBucket, extensionResource: resource2 } };
  }
  if (hasOwn(v, "apiOperation")) {
    let field3 = Object.getOwnPropertyDescriptor(v, "apiOperation");
    return !field3 || !hasOwn(field3, "value") || !field3.enumerable || !isApiOperation(field3.value) || !apiOperationAllows(field3.value, techniqueId, phase) || signalCodes.length !== 1 || signalCodes[0] !== "api-use" ? fail(path + ".apiOperation") : { ok: !0, value: { techniqueId, count: count3, countQuality, phase, signalCodes, intervalBucket, apiOperation: field3.value } };
  }
  return { ok: !0, value: { techniqueId, count: count3, countQuality, phase, signalCodes, intervalBucket } };
}
function validateObservations(v, path, minItems = 1) {
  if (!capturedIsArray(v)) return fail(path + ": not an array");
  if (v.length < minItems || v.length > BUDGETS.maxBatchEvents) return fail(path + ": length out of range");
  let out = [];
  for (let i = 0; i < v.length; i++) {
    let r = validateObservation(v[i], path + "[" + String(i) + "]");
    if (!r.ok) return r;
    out.push(r.value);
  }
  return { ok: !0, value: out };
}
var BATCH_KEYS = [
  "schemaVersion",
  "type",
  "sensorBootId",
  "bridgeSessionId",
  "batchSeq",
  "observations",
  "coverageDelta"
], BATCH_KEY_SET = new Set(BATCH_KEYS);
function pageBatch(input) {
  if (!isObjectLike(input)) return fail("batch: not an object");
  let keyError = checkKeys(input, BATCH_KEY_SET, BATCH_KEYS, "batch");
  if (keyError !== null) return fail(keyError);
  if (input.schemaVersion !== 1) return fail("batch.schemaVersion");
  if (input.type !== "sensor-events") return fail("batch.type");
  let sensorBootId = readId(input.sensorBootId);
  if (sensorBootId === null) return fail("batch.sensorBootId");
  let bridgeSessionId = readId(input.bridgeSessionId);
  if (bridgeSessionId === null) return fail("batch.bridgeSessionId");
  let batchSeq = readInt(input.batchSeq, 1, 2147483647);
  if (batchSeq === null) return fail("batch.batchSeq");
  let observations = validateObservations(input.observations, "batch.observations", 0);
  if (!observations.ok) return observations;
  let coverageDelta = readCoverageFlags(input.coverageDelta);
  return coverageDelta === null ? fail("batch.coverageDelta") : observations.value.length === 0 && coverageDelta.length === 0 ? fail("batch: empty (no observations, no coverageDelta)") : {
    ok: !0,
    value: {
      schemaVersion: 1,
      type: "sensor-events",
      sensorBootId,
      bridgeSessionId,
      batchSeq,
      observations: observations.value,
      coverageDelta
    }
  };
}
function validatePageBatch(input) {
  try {
    return pageBatch(input);
  } catch {
    return fail("batch: exception");
  }
}
var SENSOR_HELLO_KEYS = ["channel", "sensorBootId", "type", "protocolVersion", "startedLate", "coverageFlags"], SENSOR_BATCH_KEYS = ["channel", "sensorBootId", "type", "sensorSeq", "observations", "coverageDelta"], SENSOR_STATUS_KEYS = ["channel", "sensorBootId", "type", "state", "coverageFlags", "droppedSinceLast"], SENSOR_HELLO_SET = new Set(SENSOR_HELLO_KEYS), SENSOR_BATCH_SET = new Set(SENSOR_BATCH_KEYS), SENSOR_STATUS_SET = new Set(SENSOR_STATUS_KEYS);
function readMessageType(input) {
  let t = input.type;
  return typeof t == "string" && t.length >= 1 && t.length <= MAX_TYPE_CHARS ? t : null;
}
var BRIDGE_HELLO_KEYS = ["channel", "sensorBootId", "type", "protocolVersion", "bridgeSessionId", "paused"], BRIDGE_SIMPLE_KEYS = ["channel", "sensorBootId", "type"], BRIDGE_STOP_KEYS = ["channel", "sensorBootId", "type", "reason"], BRIDGE_HELLO_SET = new Set(BRIDGE_HELLO_KEYS), BRIDGE_SIMPLE_SET = new Set(BRIDGE_SIMPLE_KEYS), BRIDGE_STOP_SET = new Set(BRIDGE_STOP_KEYS);
var BRIDGE_CONTROL_KEYS = ["schemaVersion", "type", "command"], BRIDGE_CONTROL_SET = new Set(BRIDGE_CONTROL_KEYS);
var UI_GET_REPORT_REQUIRED = ["schemaVersion", "type", "tabId"], UI_GET_REPORT_SET = /* @__PURE__ */ new Set([...UI_GET_REPORT_REQUIRED, "frameId"]), UI_REVISION_KEYS = ["schemaVersion", "type", "tabId", "documentKey", "reportRevision"], UI_REVISION_SET = new Set(UI_REVISION_KEYS), UI_EXPORT_SET = /* @__PURE__ */ new Set([...UI_REVISION_KEYS, "includeHost"]), UI_SET_SCOPE_REQUIRED = ["schemaVersion", "type", "scopeMode"], UI_SET_SCOPE_SET = /* @__PURE__ */ new Set([...UI_SET_SCOPE_REQUIRED, "host"]), UI_GET_SCOPE_KEYS = ["schemaVersion", "type"], UI_GET_SCOPE_SET = new Set(UI_GET_SCOPE_KEYS), UI_INJECT_NOW_KEYS = ["schemaVersion", "type", "tabId"], UI_INJECT_NOW_SET = new Set(UI_INJECT_NOW_KEYS);
function readTabId(v) {
  return readInt(v, 0, 2147483647);
}
function uiRequest(input) {
  if (!isObjectLike(input)) return fail("ui: not an object");
  let type = readMessageType(input);
  if (type === null) return fail("ui.type");
  if (input.schemaVersion !== 1) return fail("ui.schemaVersion");
  switch (type) {
    case "ui-get-report": {
      let keyError = checkKeys(input, UI_GET_REPORT_SET, UI_GET_REPORT_REQUIRED, type);
      if (keyError !== null) return fail(keyError);
      let tabId = readTabId(input.tabId);
      if (tabId === null) return fail(type + ".tabId");
      if (hasOwn(input, "frameId")) {
        let frameId = readInt(input.frameId, 0, Number.MAX_SAFE_INTEGER);
        return frameId === null ? fail(type + ".frameId") : { ok: !0, value: { schemaVersion: 1, type, tabId, frameId } };
      }
      return { ok: !0, value: { schemaVersion: 1, type, tabId } };
    }
    case "ui-pause":
    case "ui-resume":
    case "ui-clear":
    case "ui-export-preview": {
      let keyError = checkKeys(input, type === "ui-export-preview" ? UI_EXPORT_SET : UI_REVISION_SET, UI_REVISION_KEYS, type);
      if (keyError !== null) return fail(keyError);
      let tabId = readTabId(input.tabId);
      if (tabId === null) return fail(type + ".tabId");
      let documentKey3 = readDocumentKey(input.documentKey);
      if (documentKey3 === null) return fail(type + ".documentKey");
      let reportRevision = readInt(input.reportRevision, 0, 2147483647);
      if (reportRevision === null) return fail(type + ".reportRevision");
      if (type === "ui-export-preview" && hasOwn(input, "includeHost")) {
        let includeHost = readBool(input.includeHost);
        return includeHost === null ? fail(type + ".includeHost") : { ok: !0, value: { schemaVersion: 1, type, tabId, documentKey: documentKey3, reportRevision, includeHost } };
      }
      return { ok: !0, value: { schemaVersion: 1, type, tabId, documentKey: documentKey3, reportRevision } };
    }
    case "ui-set-scope": {
      let keyError = checkKeys(input, UI_SET_SCOPE_SET, UI_SET_SCOPE_REQUIRED, type);
      if (keyError !== null) return fail(keyError);
      let scopeMode = readEnum(input.scopeMode, SCOPE_SET);
      if (scopeMode === null) return fail(type + ".scopeMode");
      let hasHost = hasOwn(input, "host");
      if (scopeMode === "site") {
        if (!hasHost) return fail(type + ".host: required for site scope");
        let host2 = input.host;
        return isSanitizedHost(host2) ? { ok: !0, value: { schemaVersion: 1, type, scopeMode, host: host2 } } : fail(type + ".host");
      }
      return hasHost ? fail(type + ".host: only allowed for site scope") : { ok: !0, value: { schemaVersion: 1, type, scopeMode } };
    }
    case "ui-get-scope":
    case "ui-clear-session": {
      let keyError = checkKeys(input, UI_GET_SCOPE_SET, UI_GET_SCOPE_KEYS, type);
      return keyError !== null ? fail(keyError) : { ok: !0, value: { schemaVersion: 1, type } };
    }
    case "ui-inject-now": {
      let keyError = checkKeys(input, UI_INJECT_NOW_SET, UI_INJECT_NOW_KEYS, type);
      if (keyError !== null) return fail(keyError);
      let tabId = readTabId(input.tabId);
      return tabId === null ? fail(type + ".tabId") : { ok: !0, value: { schemaVersion: 1, type, tabId } };
    }
    default:
      return fail("ui.type");
  }
}
function validateUiRequest(input) {
  try {
    return uiRequest(input);
  } catch {
    return fail("ui: exception");
  }
}

// packages/contracts/src/visual-preview.ts
var VISUAL_LIMITS = Object.freeze({
  leaseMs: 6e4,
  maxPixels: 65536,
  maxDimension: 1024,
  maxBase64Chars: 524288,
  maxImages: 256,
  maxCanvases: 512,
  maxTotalBase64Chars: 12582912,
  maxFrames: 512,
  maxReadbacks: 65535,
  maxDocuments: 4,
  maxPending: 4
}), VISUAL_RENDERERS = ["unknown", "2d", "webgl", "webgl2", "webgpu", "bitmaprenderer"], VISUAL_OPERATIONS = [
  "text",
  "image-copy",
  "cropped-copy",
  "recombined-copy",
  "flip-back-copy",
  "canvas-reset",
  "pixel-write",
  "fill",
  "gradient",
  "pattern",
  "path",
  "transform",
  "flip-x",
  "flip-y",
  "fractional",
  "alpha",
  "composite",
  "repeat-readback",
  "multiple-readback-formats",
  "texture-upload",
  "2d-to-webgl",
  "webgl-to-2d",
  "webgl-to-webgl",
  "shader",
  "gpu-draw",
  "gpu-sync",
  "gl-parameters",
  "timer-extension",
  "timer-query",
  "query-read",
  "occlusion-query",
  "bitmap-transfer",
  "offscreen-transfer",
  "bitmap-create",
  "svg-source"
], VISUAL_CACHE_IDLE_MS = 10 * 6e4, descriptor = Object.getOwnPropertyDescriptor, names = Object.getOwnPropertyNames, integer = Number.isSafeInteger, test = Function.prototype.call.bind(RegExp.prototype.test), BASE64 = /^[A-Za-z0-9+/]*={0,2}$/, decode = atob;
var CACHE_TOKEN = /^[a-f0-9]{32}$/, CANVAS_ID = /^boot-[a-f0-9]{24}:[1-9][0-9]{0,2}$/;
function read(value, key2) {
  return descriptor(value, key2)?.value;
}
function shape(value, keys4) {
  if (typeof value != "object" || value === null || names(value).length !== keys4.length) return !1;
  for (let i = 0; i < keys4.length; i++) {
    let d = descriptor(value, keys4[i]);
    if (!d || !descriptor(d, "value")) return !1;
  }
  return !0;
}
function whole(value, min, max) {
  return typeof value == "number" && integer(value) && value >= min && value <= max;
}
function key(value) {
  return typeof value == "string" && value.length > 0 && value.length <= 512;
}
function optionalShape(value, required, optional) {
  return typeof value != "object" || value === null ? !1 : shape(value, [...required, ...optional.filter((key2) => descriptor(value, key2) !== void 0)]);
}
function visualCanvas(input) {
  if (!shape(input, ["id", "renderer", "operations", "readbacks"])) return null;
  let id4 = read(input, "id"), renderer = read(input, "renderer"), raw = read(input, "operations"), readbacks = read(input, "readbacks");
  if (typeof id4 != "string" || !test(CANVAS_ID, id4) || !whole(Number(id4.slice(30)), 1, VISUAL_LIMITS.maxCanvases) || !VISUAL_RENDERERS.some((value) => value === renderer) || !whole(readbacks, 1, VISUAL_LIMITS.maxReadbacks) || !Array.isArray(raw) || raw.length > VISUAL_OPERATIONS.length) return null;
  let operations = [];
  for (let index = 0; index < raw.length; index++) {
    let item = descriptor(raw, String(index));
    if (!item || !descriptor(item, "value") || !VISUAL_OPERATIONS.some((value) => value === item.value) || operations.includes(item.value)) return null;
    operations.push(item.value);
  }
  return { id: id4, renderer, operations, readbacks };
}
function visualImageKey(image) {
  return image.canvas?.id ?? image.kind;
}
function mergeVisualImage(previous, image) {
  if (!previous) return image;
  if (!previous.canvas || !image.canvas) return previous;
  let operations = VISUAL_OPERATIONS.filter((operation) => previous.canvas.operations.includes(operation) || image.canvas.operations.includes(operation)), readbacks = Math.max(previous.canvas.readbacks, image.canvas.readbacks), renderer = previous.canvas.renderer === "unknown" ? image.canvas.renderer : previous.canvas.renderer;
  if (operations.length === previous.canvas.operations.length && readbacks === previous.canvas.readbacks && renderer === previous.canvas.renderer) return previous;
  let kind = previous.format === "png" && (renderer === "webgl" || renderer === "webgl2") ? "webgl" : previous.kind;
  return { ...previous, kind, canvas: { id: previous.canvas.id, renderer, operations, readbacks } };
}
function retainVisualImage(images, image) {
  let key2 = visualImageKey(image), previous = images.get(key2);
  if (image = mergeVisualImage(previous, image), previous === image) return !0;
  if (!previous && images.size >= VISUAL_LIMITS.maxImages) return !1;
  let total = image.data.length - (previous?.data.length ?? 0);
  for (let retained of images.values()) total += retained.data.length;
  return total > VISUAL_LIMITS.maxTotalBase64Chars ? !1 : (images.set(key2, image), !0);
}
function validateVisualImages(input) {
  try {
    if (!Array.isArray(input) || input.length > VISUAL_LIMITS.maxImages) return { ok: !1 };
    let images = [], keys4 = /* @__PURE__ */ new Set(), total = 0;
    for (let index = 0; index < input.length; index++) {
      let item = descriptor(input, String(index));
      if (!item || !descriptor(item, "value")) return { ok: !1 };
      let parsed = validateVisualImage(item.value);
      if (!parsed.ok) return { ok: !1 };
      total += parsed.value.data.length;
      let key2 = visualImageKey(parsed.value);
      if (total > VISUAL_LIMITS.maxTotalBase64Chars || keys4.has(key2)) return { ok: !1 };
      keys4.add(key2), images.push(parsed.value);
    }
    return { ok: !0, value: images };
  } catch {
    return { ok: !1 };
  }
}
function validateVisualImage(input) {
  try {
    if (!optionalShape(input, ["kind", "source", "format", "width", "height", "data"], ["canvas"])) return { ok: !1 };
    let kind = read(input, "kind"), source = read(input, "source"), format = read(input, "format"), width = read(input, "width"), height = read(input, "height"), data = read(input, "data");
    if (!whole(width, 1, VISUAL_LIMITS.maxDimension) || !whole(height, 1, VISUAL_LIMITS.maxDimension) || width * height > VISUAL_LIMITS.maxPixels) return { ok: !1 };
    if (typeof data != "string" || data.length === 0 || data.length > VISUAL_LIMITS.maxBase64Chars || data.length % 4 !== 0 || !test(BASE64, data)) return { ok: !1 };
    if (kind === "webgl" ? !(source === "readPixels" && format === "rgba" || source === "toDataURL" && format === "png") : kind !== "canvas" || !(source === "getImageData" && format === "rgba" || source === "toDataURL" && format === "png")) return { ok: !1 };
    if (format === "rgba") {
      if (data.length / 4 * 3 - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0) !== width * height * 4) return { ok: !1 };
    } else {
      if (data.length < 44) return { ok: !1 };
      let header = decode(data.slice(0, 44)), byte = (i) => header.charCodeAt(i), uint = (i) => byte(i) * 16777216 + byte(i + 1) * 65536 + byte(i + 2) * 256 + byte(i + 3);
      if (header.slice(0, 8) !== `PNG\r

` || uint(8) !== 13 || header.slice(12, 16) !== "IHDR" || uint(16) !== width || uint(20) !== height) return { ok: !1 };
    }
    let hasCanvas = descriptor(input, "canvas") !== void 0, canvas = hasCanvas ? visualCanvas(read(input, "canvas")) : null;
    return hasCanvas && canvas === null ? { ok: !1 } : canvas && (canvas.renderer === "webgl" || canvas.renderer === "webgl2") != (kind === "webgl") && canvas.renderer !== "unknown" ? { ok: !1 } : { ok: !0, value: { kind, source, format, width, height, data, ...canvas ? { canvas } : {} } };
  } catch {
    return { ok: !1 };
  }
}
function validateVisualUiRequest(input) {
  try {
    if (typeof input != "object" || input === null) return { ok: !1 };
    let type = read(input, "type");
    return shape(input, type === "ui-visual-set" ? ["schemaVersion", "type", "tabId", "documentKey", "reportRevision", "enabled"] : ["schemaVersion", "type", "tabId", "documentKey"]) ? read(input, "schemaVersion") !== 1 || !whole(read(input, "tabId"), 0, 2147483647) || !key(read(input, "documentKey")) ? { ok: !1 } : type === "ui-visual-set" && (!whole(read(input, "reportRevision"), 0, Number.MAX_SAFE_INTEGER) || typeof read(input, "enabled") != "boolean") ? { ok: !1 } : type !== "ui-visual-set" && type !== "ui-visual-get" ? { ok: !1 } : { ok: !0, value: input } : { ok: !1 };
  } catch {
    return { ok: !1 };
  }
}
function validateVisualPageRequest(input) {
  try {
    if (typeof input != "object" || input === null) return { ok: !1 };
    if (read(input, "schemaVersion") !== 1) return { ok: !1 };
    let type = read(input, "type");
    if ((type === "visual-ready" || type === "visual-limited") && shape(input, ["schemaVersion", "type"])) return { ok: !0, value: { schemaVersion: 1, type } };
    if (read(input, "type") === "visual-frame" && shape(input, ["schemaVersion", "type", "image"])) {
      let image = validateVisualImage(read(input, "image"));
      if (image.ok) return { ok: !0, value: { schemaVersion: 1, type: "visual-frame", image: image.value } };
    }
    return { ok: !1 };
  } catch {
    return { ok: !1 };
  }
}
function validateVisualCacheState(input) {
  try {
    if (!optionalShape(input, ["schemaVersion", "type", "cacheToken", "images"], ["truncated"]) || read(input, "schemaVersion") !== 1 || read(input, "type") !== "visual-cache-state") return { ok: !1 };
    let cacheToken = read(input, "cacheToken"), rawImages = read(input, "images"), images = validateVisualImages(rawImages), truncated = read(input, "truncated");
    return typeof cacheToken != "string" || !test(CACHE_TOKEN, cacheToken) || !images.ok || descriptor(input, "truncated") && typeof truncated != "boolean" ? { ok: !1 } : { ok: !0, value: {
      schemaVersion: 1,
      type: "visual-cache-state",
      cacheToken,
      images: images.value,
      ...typeof truncated == "boolean" ? { truncated } : {}
    } };
  } catch {
    return { ok: !1 };
  }
}

// packages/contracts/src/rtc-details.ts
var RTC_LIMITS = Object.freeze({ maxConnections: 32, maxServers: 8, maxBytes: 32768, maxDocuments: 8, idleMs: 6e5, flushMs: 250 }), RTC_STATES = ["new", "connecting", "connected", "disconnected", "failed", "closed", "unknown"], RTC_DURATIONS = ["open", "under-1s", "1-10s", "10s-plus", "unknown"], get = Object.getOwnPropertyDescriptor, keys = Object.getOwnPropertyNames, isArray = Array.isArray, isInteger = Number.isSafeInteger, exec = Function.prototype.call.bind(RegExp.prototype.exec), test2 = (re, text2) => exec(re, text2) !== null, lower = Function.prototype.call.bind(String.prototype.toLowerCase), at = Function.prototype.call.bind(String.prototype.charCodeAt), TOKEN = /^[a-f0-9]{32}$/;
var MAX_COUNT2 = 2147483647;
function read2(v, key2) {
  return get(v, key2)?.value;
}
function shape2(v, fields4) {
  if (typeof v != "object" || v === null || keys(v).length !== fields4.length) return !1;
  for (let i = 0; i < fields4.length; i++) {
    let d = get(v, fields4[i]);
    if (!d || !get(d, "value")) return !1;
  }
  return !0;
}
function integer2(v, min = 0, max = MAX_COUNT2) {
  return typeof v == "number" && isInteger(v) && v >= min && v <= max;
}
function documentKey(v) {
  return typeof v == "string" && v.length > 0 && v.length <= 128;
}
function token(v) {
  return typeof v == "string" && test2(TOKEN, v);
}
function host(v) {
  if (typeof v != "string" || v.length < 1 || v.length > 253) return !1;
  if (test2(/^\[[0-9a-f:]{2,45}\]$/, v)) {
    for (let i = 0; i < v.length; i++) if (at(v, i) === 58) return !0;
    return !1;
  }
  if (!test2(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/, v)) return !1;
  let length = 0, previous = 0;
  for (let i = 0; i <= v.length; i++) {
    let c = i === v.length ? 46 : at(v, i);
    if (c === 46) {
      if (length === 0 || length > 63 || previous === 45) return !1;
      length = 0;
    } else {
      if (length === 0 && c === 45) return !1;
      length++;
    }
    previous = c;
  }
  return !0;
}
function validateRtcSnapshot(value) {
  try {
    if (!shape2(value, ["revision", "total", "omitted", "captureLimited", "connections"])) return { ok: !1 };
    let revision = read2(value, "revision"), total = read2(value, "total"), omitted = read2(value, "omitted"), captureLimited = read2(value, "captureLimited"), raw = read2(value, "connections");
    if (!integer2(revision) || !integer2(total) || !integer2(omitted) || typeof captureLimited != "boolean" || !isArray(raw) || raw.length > RTC_LIMITS.maxConnections || total < raw.length || omitted > total) return { ok: !1 };
    let connections = [], chars = 128, ids2 = /* @__PURE__ */ new Set();
    for (let i = 0; i < raw.length; i++) {
      let c = read2(raw, String(i));
      if (!shape2(c, ["id", "created", "closed", "connected", "state", "duration", "configurationChanges", "servers", "truncated"])) return { ok: !1 };
      let id4 = read2(c, "id"), created = read2(c, "created"), closed = read2(c, "closed"), connected = read2(c, "connected"), state = read2(c, "state"), duration = read2(c, "duration"), configurationChanges = read2(c, "configurationChanges"), truncated = read2(c, "truncated"), s = read2(c, "servers");
      if (!integer2(id4, 1) || ids2.has(id4) || id4 > total || typeof created != "boolean" || typeof closed != "boolean" || typeof connected != "boolean" || !RTC_STATES.includes(state) || !RTC_DURATIONS.includes(duration) || !integer2(configurationChanges) || typeof truncated != "boolean" || !isArray(s) || s.length > RTC_LIMITS.maxServers) return { ok: !1 };
      ids2.add(id4);
      let servers = [], endpoints = /* @__PURE__ */ new Set();
      chars += 240;
      for (let j = 0; j < s.length; j++) {
        let item = read2(s, String(j));
        if (!shape2(item, ["scheme", "host", "port", "transport", "configured", "candidate", "error"])) return { ok: !1 };
        let scheme = read2(item, "scheme"), h = read2(item, "host"), port = read2(item, "port"), transport = read2(item, "transport"), configured = read2(item, "configured"), candidate = read2(item, "candidate"), error4 = read2(item, "error");
        if (!["stun", "stuns", "turn", "turns"].includes(scheme) || !host(h) || port !== null && !integer2(port, 1, 65535) || transport !== null && transport !== "udp" && transport !== "tcp" || typeof configured != "boolean" || typeof candidate != "boolean" || typeof error4 != "boolean") return { ok: !1 };
        let key2 = scheme + "|" + h + "|" + port + "|" + transport;
        if (endpoints.has(key2)) return { ok: !1 };
        if (endpoints.add(key2), chars += h.length + 140, chars > RTC_LIMITS.maxBytes) return { ok: !1 };
        servers.push({ scheme, host: h, port, transport, configured, candidate, error: error4 });
      }
      connections.push({ id: id4, created, closed, connected, state, duration, configurationChanges, servers, truncated });
    }
    return { ok: !0, value: { revision, total, omitted, captureLimited, connections } };
  } catch {
    return { ok: !1 };
  }
}
function validateRtcUiRequest(v) {
  try {
    return !shape2(v, ["schemaVersion", "type", "tabId", "documentKey"]) || read2(v, "schemaVersion") !== 1 || read2(v, "type") !== "ui-rtc-get" || !integer2(read2(v, "tabId")) || !documentKey(read2(v, "documentKey")) ? { ok: !1 } : { ok: !0, value: v };
  } catch {
    return { ok: !1 };
  }
}
function validateRtcPageRequest(v) {
  try {
    if (shape2(v, ["schemaVersion", "type"]) && read2(v, "schemaVersion") === 1 && read2(v, "type") === "rtc-ready") return { ok: !0, value: { schemaVersion: 1, type: "rtc-ready" } };
    if (!shape2(v, ["schemaVersion", "type", "token", "snapshot"]) || read2(v, "schemaVersion") !== 1 || read2(v, "type") !== "rtc-snapshot" || !token(read2(v, "token"))) return { ok: !1 };
    let snapshot = validateRtcSnapshot(read2(v, "snapshot"));
    return snapshot.ok ? { ok: !0, value: { schemaVersion: 1, type: "rtc-snapshot", token: read2(v, "token"), snapshot: snapshot.value } } : { ok: !1 };
  } catch {
    return { ok: !1 };
  }
}

// packages/contracts/src/permission-checks.ts
var MAX_PERMISSION_CHECKS = PERMISSION_NAMES.length * 5, names2 = new Set(PERMISSION_NAMES), qualities = new Set(COUNT_QUALITIES), keys2 = ["permission", "kind", "result", "count", "countQuality"];
function readPermissionChecks(value) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > MAX_PERMISSION_CHECKS || Reflect.ownKeys(value).length !== value.length + 1) return null;
    let out = [], seen = /* @__PURE__ */ new Set();
    for (let i = 0; i < value.length; i++) {
      let item = Object.getOwnPropertyDescriptor(value, String(i));
      if (!item || !Object.hasOwn(item, "value")) return null;
      let row = item.value;
      if (typeof row != "object" || row === null || Array.isArray(row) || Reflect.ownKeys(row).length !== keys2.length) return null;
      let prototype = Object.getPrototypeOf(row);
      if (prototype !== Object.prototype && prototype !== null) return null;
      let values = [];
      for (let key3 of keys2) {
        let field3 = Object.getOwnPropertyDescriptor(row, key3);
        if (!field3 || !field3.enumerable || !Object.hasOwn(field3, "value")) return null;
        values.push(field3.value);
      }
      let [permission, kind, result, count3, countQuality] = values;
      if (typeof permission != "string" || !names2.has(permission) || typeof countQuality != "string" || !qualities.has(countQuality) || typeof count3 != "number" || !Number.isInteger(count3) || count3 < 1 || count3 > 2147483647 || !(kind === "permission" && (result === "granted" || result === "denied" || result === "prompt")) && !(kind === "policy" && (result === "allowed" || result === "blocked"))) return null;
      let key2 = permission + "|" + kind + "|" + result;
      if (seen.has(key2)) return null;
      seen.add(key2), out.push({
        permission,
        kind,
        result,
        count: count3,
        countQuality
      });
    }
    return out;
  } catch {
    return null;
  }
}

// packages/contracts/src/local-ports.ts
function readRequestedLocalPorts(value) {
  try {
    if (typeof value != "object" || value === null || Array.isArray(value) || Reflect.ownKeys(value).length !== 2) return null;
    let prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    let portsField = Object.getOwnPropertyDescriptor(value, "ports"), truncatedField = Object.getOwnPropertyDescriptor(value, "truncated");
    if (!portsField?.enumerable || !Object.hasOwn(portsField, "value") || !truncatedField?.enumerable || !Object.hasOwn(truncatedField, "value") || typeof truncatedField.value != "boolean") return null;
    let values = portsField.value;
    if (!Array.isArray(values) || Object.getPrototypeOf(values) !== Array.prototype || values.length > 128 || Reflect.ownKeys(values).length !== values.length + 1) return null;
    let ports = [], seen = /* @__PURE__ */ new Set();
    for (let index = 0; index < values.length; index++) {
      let field3 = Object.getOwnPropertyDescriptor(values, String(index));
      if (!field3?.enumerable || !Object.hasOwn(field3, "value")) return null;
      let port = field3.value;
      if (typeof port != "number" || !Number.isInteger(port) || port < 0 || port > 65535 || seen.has(port) || Object.is(port, -0)) return null;
      ports.push(port), seen.add(port);
    }
    return ports.sort((first, second) => first - second), { ports, truncated: truncatedField.value };
  } catch {
    return null;
  }
}

// packages/contracts/src/response-headers.ts
var RESPONSE_HEADER_NAMES = [
  "accept-ch",
  "critical-ch",
  "permissions-policy",
  "feature-policy",
  "nel",
  "report-to",
  "reporting-endpoints",
  "secure-session-registration",
  "sec-session-registration",
  "secure-session-challenge",
  "sec-session-challenge",
  "use-as-dictionary",
  "set-login",
  "content-security-policy",
  "strict-transport-security",
  "cross-origin-opener-policy",
  "cross-origin-embedder-policy",
  "x-frame-options"
], CLIENT_HINT_NAMES = [
  "sec-ch-ua",
  "sec-ch-ua-mobile",
  "sec-ch-ua-platform",
  "sec-ch-ua-arch",
  "sec-ch-ua-bitness",
  "sec-ch-ua-model",
  "sec-ch-ua-platform-version",
  "sec-ch-ua-full-version",
  "sec-ch-ua-full-version-list",
  "sec-ch-ua-wow64",
  "sec-ch-ua-form-factors",
  "device-memory",
  "sec-ch-device-memory",
  "dpr",
  "sec-ch-dpr",
  "width",
  "sec-ch-width",
  "viewport-width",
  "sec-ch-viewport-width",
  "sec-ch-viewport-height",
  "rtt",
  "downlink",
  "ect",
  "save-data",
  "sec-ch-prefers-color-scheme",
  "sec-ch-prefers-reduced-motion",
  "sec-ch-prefers-reduced-transparency"
];
function field(value, key2) {
  let entry = Object.getOwnPropertyDescriptor(value, key2);
  return entry?.enumerable && Object.hasOwn(entry, "value") ? entry.value : void 0;
}
function readResponseHeaders(value) {
  try {
    if (!value || typeof value != "object" || Array.isArray(value) || Reflect.ownKeys(value).length !== 2) return null;
    let entries = field(value, "entries"), truncated = field(value, "truncated");
    if (!Array.isArray(entries) || entries.length > RESPONSE_HEADER_NAMES.length || Reflect.ownKeys(entries).length !== entries.length + 1 || typeof truncated != "boolean") return null;
    let output = [], seen = /* @__PURE__ */ new Set();
    for (let index = 0; index < entries.length; index++) {
      let row = field(entries, String(index));
      if (!row || typeof row != "object" || Array.isArray(row) || Reflect.ownKeys(row).length !== 3) return null;
      let name = field(row, "name"), count3 = field(row, "count"), hints = field(row, "clientHints");
      if (typeof name != "string" || !RESPONSE_HEADER_NAMES.includes(name) || seen.has(name) || typeof count3 != "number" || !Number.isSafeInteger(count3) || count3 < 1 || count3 > 2147483647 || !Array.isArray(hints) || hints.length > CLIENT_HINT_NAMES.length || Reflect.ownKeys(hints).length !== hints.length + 1 || name !== "accept-ch" && name !== "critical-ch" && hints.length > 0) return null;
      let clientHints = [];
      for (let hintIndex = 0; hintIndex < hints.length; hintIndex++) {
        let hint = field(hints, String(hintIndex));
        if (typeof hint != "string" || !CLIENT_HINT_NAMES.includes(hint) || clientHints.includes(hint)) return null;
        clientHints.push(hint);
      }
      seen.add(name), output.push({ name, count: count3, clientHints });
    }
    return { entries: output, truncated };
  } catch {
    return null;
  }
}
function mergeResponseHeaders(previous, incoming) {
  let result = readResponseHeaders(previous) ?? { entries: [], truncated: !1 }, update = readResponseHeaders(incoming);
  if (!update) return { ...result, truncated: !0 };
  result.truncated ||= update.truncated;
  for (let row of update.entries) {
    let prior = result.entries.find((entry) => entry.name === row.name);
    if (!prior) result.entries.push(row);
    else {
      prior.count + row.count >= 2147483647 && (result.truncated = !0), prior.count = Math.min(2147483647, prior.count + row.count);
      for (let hint of row.clientHints) prior.clientHints.includes(hint) || prior.clientHints.push(hint);
    }
  }
  result.entries.sort((left, right) => RESPONSE_HEADER_NAMES.indexOf(left.name) - RESPONSE_HEADER_NAMES.indexOf(right.name));
  for (let row of result.entries) row.clientHints.sort();
  return result;
}

// packages/contracts/src/pro-recording.ts
var PRO_LIMITS = Object.freeze({ durationMs: 6e5, maxPages: 100, maxTabs: 16, maxResourcesPerPage: 500, maxResources: 5e3, maxDocumentsPerPage: 24, maxBytes: 3 * 1024 * 1024, maxUrlChars: 512, maxTitleChars: 200, maxPendingRequests: 1024 }), PRO_LIMITATIONS = ["started-mid-page", "service-worker-restarted", "navigation-gap", "resource-limit", "page-limit", "document-limit", "event-limit", "storage-error", "permission-limited", "unsupported-contexts", "redacted-urls"], PRO_STOP_REASONS = ["manual", "timeout", "tab-closed", "access-revoked", "storage-error", "limit"], PRO_RESOURCE_TYPES = ["main_frame", "sub_frame", "stylesheet", "script", "image", "font", "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket", "webtransport", "webbundle", "other"], get2 = Object.getOwnPropertyDescriptor;
function read3(v, k) {
  return get2(v, k)?.value;
}
function shape3(v, fields4) {
  return typeof v != "object" || v === null || Array.isArray(v) || Object.getOwnPropertyNames(v).length !== fields4.length ? !1 : fields4.every((k) => {
    let d = get2(v, k);
    return d !== void 0 && get2(d, "value") !== void 0;
  });
}
function integer3(v, max = 2147483647) {
  return typeof v == "number" && Number.isSafeInteger(v) && v >= 0 && v <= max;
}
function epoch(v) {
  return integer3(v, 864e13);
}
function text(v, max = 512) {
  return typeof v == "string" && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v);
}
function id(v, max = 128) {
  return text(v, max) && /^[A-Za-z0-9_:.-]+$/.test(v);
}
function list(v, max, check) {
  if (!Array.isArray(v) || v.length > max) return !1;
  for (let i = 0; i < v.length; i++) {
    let d = get2(v, String(i));
    if (!d || !get2(d, "value") || !check(d.value)) return !1;
  }
  return !0;
}
function member(v, values) {
  return values.includes(v);
}
function codes(v, values, max = 64) {
  return list(v, max, (x) => member(x, values)) && new Set(v).size === v.length;
}
function countObject(v, fields4) {
  return shape3(v, fields4) && fields4.every((k) => integer3(read3(v, k)));
}
function displayUrl(v) {
  if (!text(v, PRO_LIMITS.maxUrlChars) || /[?#@\s\\]/.test(v)) return !1;
  try {
    let u = new URL(v);
    return ["http:", "https:", "ws:", "wss:"].includes(u.protocol) && !u.username && !u.password && u.hostname.length > 0;
  } catch {
    return !1;
  }
}
function boundedPlain(value) {
  let chars = 0, nodes = 0;
  function walk(v, depth) {
    if (++nodes > 2e5 || depth > 12) return !1;
    if (typeof v == "string")
      return chars += v.length, chars <= PRO_LIMITS.maxBytes;
    if (v === null || typeof v == "boolean" || typeof v == "number" && Number.isFinite(v)) return !0;
    if (typeof v != "object") return !1;
    let proto = Object.getPrototypeOf(v), array3 = Array.isArray(v);
    if (proto !== (array3 ? Array.prototype : Object.prototype) && proto !== null || Object.getOwnPropertySymbols(v).length > 0) return !1;
    let fields4 = Object.getOwnPropertyNames(v);
    if (fields4.length > 5001 || array3 && fields4.length !== v.length + 1) return !1;
    for (let key2 of fields4) {
      if (array3 && key2 === "length") continue;
      if (key2 === "__proto__" || key2 === "prototype" || key2 === "constructor" || key2 === "toJSON" || (chars += key2.length + 8, chars > PRO_LIMITS.maxBytes)) return !1;
      let d = get2(v, key2);
      if (!d || !get2(d, "value") || !walk(d.value, depth + 1)) return !1;
    }
    return !0;
  }
  return walk(value, 0);
}
function technique(v) {
  return shape3(v, ["techniqueId", "count", "countQuality", "phases", "signalCodes", "evidenceSource", "integrity", "interpretation", "interpretationConfidence", "attributionConfidence", "firstBucket", "lastBucket"]) ? member(v.techniqueId, TECHNIQUE_IDS) && integer3(v.count) && member(v.countQuality, COUNT_QUALITIES) && codes(v.phases, PHASES, 5) && codes(v.signalCodes, SIGNAL_CODES, SIGNAL_CODES.length) && member(v.evidenceSource, EVIDENCE_SOURCES) && member(v.integrity, INTEGRITIES) && member(v.interpretation, INTERPRETATIONS) && member(v.interpretationConfidence, INTERPRETATION_CONFIDENCES) && member(v.attributionConfidence, ATTRIBUTION_CONFIDENCES) && integer3(v.firstBucket) && integer3(v.lastBucket) : !1;
}
function finding(v) {
  let fields4 = ["findingId", "ruleId", "ruleVersion", "techniqueId", "interpretation", "interpretationConfidence", "evidenceIds", "counterEvidenceCodes", "limitationCodes", "vendorMatchIds"];
  return typeof v == "object" && v !== null && get2(v, "coverageRef") && fields4.push("coverageRef"), shape3(v, fields4) ? ["findingId", "ruleId", "ruleVersion"].every((k) => text(v[k])) && member(v.techniqueId, TECHNIQUE_IDS) && member(v.interpretation, INTERPRETATIONS) && member(v.interpretationConfidence, INTERPRETATION_CONFIDENCES) && ["evidenceIds", "counterEvidenceCodes", "limitationCodes", "vendorMatchIds"].every((k) => list(v[k], 64, (x) => text(x))) && (v.coverageRef === void 0 || text(v.coverageRef)) : !1;
}
function vendor(v) {
  return shape3(v, ["vendorId", "vendorConfidence", "ruleIds", "evidenceSource", "integrity"]) && text(v.vendorId) && member(v.vendorConfidence, VENDOR_MATCHES) && list(v.ruleIds, 64, (x) => text(x)) && member(v.evidenceSource, EVIDENCE_SOURCES) && member(v.integrity, INTEGRITIES);
}
function report(v) {
  let fields4 = ["reportRevision", "documentKey", "host", "coverageState", "coverageFlags", "techniques", "findings", "vendors", "dropped", "observedSince", "scopeMode"];
  if (typeof v == "object" && v !== null && get2(v, "permissionChecks") !== void 0 && fields4.push("permissionChecks"), typeof v == "object" && v !== null && get2(v, "apiOperations") !== void 0 && fields4.push("apiOperations"), typeof v == "object" && v !== null && get2(v, "extensionResources") !== void 0 && fields4.push("extensionResources"), typeof v == "object" && v !== null && get2(v, "requestedLocalPorts") !== void 0 && fields4.push("requestedLocalPorts"), typeof v == "object" && v !== null && get2(v, "responseHeaders") !== void 0 && fields4.push("responseHeaders"), !shape3(v, fields4) || Object.hasOwn(v, "permissionChecks") && readPermissionChecks(v.permissionChecks) === null || Object.hasOwn(v, "apiOperations") && readApiOperations(v.apiOperations) === null || Object.hasOwn(v, "extensionResources") && readExtensionResources(v.extensionResources) === null) return !1;
  if (Object.hasOwn(v, "responseHeaders")) {
    let headers = readResponseHeaders(v.responseHeaders);
    if (!headers || !Array.isArray(v.techniques)) return !1;
    let total = headers.entries.reduce((sum, entry) => Math.min(2147483647, sum + entry.count), 0), rows = v.techniques.filter((value) => value?.techniqueId === "DET-074");
    if (rows.length !== (total > 0 ? 1 : 0) || rows.some((value) => value.count !== total || value.evidenceSource !== "browser-network" || value.integrity !== "browser-observed" || !Array.isArray(value.phases) || value.phases.length !== 0 || !Array.isArray(value.signalCodes) || value.signalCodes.length !== 0 || value.attributionConfidence !== "frame-only" || value.firstBucket !== 0 || value.lastBucket !== 0 || value.interpretation !== "unknown" || value.interpretationConfidence !== "unassessed" || value.countQuality !== (headers.truncated || total === 2147483647 ? "lower-bound" : "exact"))) return !1;
  } else if (Array.isArray(v.techniques) && v.techniques.some((value) => value?.techniqueId === "DET-074")) return !1;
  return Object.hasOwn(v, "requestedLocalPorts") && (readRequestedLocalPorts(v.requestedLocalPorts) === null || !Array.isArray(v.techniques) || !v.techniques.some((value) => value?.techniqueId === "DET-060" && value.count > 0 && value.evidenceSource === "browser-network" && value.integrity === "browser-observed")) ? !1 : integer3(v.reportRevision) && id(v.documentKey) && (v.host === null || text(v.host, 253)) && member(v.coverageState, COVERAGE_STATES) && codes(v.coverageFlags, COVERAGE_FLAGS) && list(v.techniques, 128, technique) && list(v.findings, 256, finding) && list(v.vendors, 128, vendor) && countObject(v.dropped, ["observations", "batches", "findings", "hosts", "counters", "transport"]) && (v.observedSince === null || epoch(v.observedSince)) && member(v.scopeMode, SCOPE_MODES);
}
function resource(v) {
  if (!shape3(v, ["id", "url", "domain", "relation", "type", "requestCount", "completedCount", "failedCount", "redirectCount", "firstSeenAt", "lastSeenAt", "statusCodes", "durationTotalMs"])) return !1;
  let statuses = v.statusCodes;
  return id(v.id) && displayUrl(v.url) && text(v.domain, 253) && member(v.relation, ["same-site", "cross-site", "unknown"]) && member(v.type, PRO_RESOURCE_TYPES) && ["requestCount", "completedCount", "failedCount", "redirectCount"].every((k) => integer3(v[k])) && epoch(v.firstSeenAt) && epoch(v.lastSeenAt) && v.lastSeenAt >= v.firstSeenAt && list(statuses, 16, (x) => integer3(x, 599) && x >= 100) && new Set(statuses).size === statuses.length && integer3(v.durationTotalMs, Number.MAX_SAFE_INTEGER);
}
function validateProRequest(v) {
  try {
    if (typeof v != "object" || v === null || read3(v, "schemaVersion") !== 1) return { ok: !1 };
    let type = read3(v, "type");
    if (type === "ui-pro-get") {
      let fields4 = get2(v, "tabId") ? ["schemaVersion", "type", "tabId"] : ["schemaVersion", "type"];
      if (shape3(v, fields4) && (fields4.length === 2 || integer3(read3(v, "tabId")))) return { ok: !0, value: v };
    } else {
      if (type === "ui-pro-start" && shape3(v, ["schemaVersion", "type", "tabId"]) && integer3(read3(v, "tabId"))) return { ok: !0, value: v };
      if ((type === "ui-pro-stop" || type === "ui-pro-clear") && shape3(v, ["schemaVersion", "type", "sessionId"]) && id(read3(v, "sessionId"), 64)) return { ok: !0, value: v };
    }
    return { ok: !1 };
  } catch {
    return { ok: !1 };
  }
}
function validateProSession(v) {
  try {
    if (!boundedPlain(v)) return { ok: !1 };
    if (!shape3(v, ["schemaVersion", "id", "domain", "siteKey", "startTabId", "status", "startedAt", "deadlineAt", "stoppedAt", "stopReason", "pages", "limitations", "dropped"]) || v.schemaVersion !== 1 || !id(v.id, 64) || !text(v.domain, 253) || !text(v.siteKey, 253) || !integer3(v.startTabId) || !member(v.status, ["recording", "stopped"]) || !epoch(v.startedAt) || !epoch(v.deadlineAt) || v.deadlineAt - v.startedAt !== PRO_LIMITS.durationMs || !codes(v.limitations, PRO_LIMITATIONS) || !countObject(v.dropped, ["pages", "resources", "documents", "events"])) return { ok: !1 };
    if (v.status === "recording" ? v.stoppedAt !== null || v.stopReason !== null : !epoch(v.stoppedAt) || v.stoppedAt < v.startedAt || v.stoppedAt > v.deadlineAt || !member(v.stopReason, PRO_STOP_REASONS)) return { ok: !1 };
    let resources = 0, chars = 1024, ids2 = /* @__PURE__ */ new Set();
    return !list(v.pages, PRO_LIMITS.maxPages, (p) => {
      let pageFields = ["id", "tabId", "documentKey", "url", "title", "startedAt", "endedAt", "reports", "resources"]; if (Object.hasOwn(p, "apiValues")) pageFields.push("apiValues"); if (Object.hasOwn(p, "cookies")) pageFields.push("cookies"); if (Object.hasOwn(p, "tagManager")) pageFields.push("tagManager"); if (Object.hasOwn(p, "socialNetworks")) pageFields.push("socialNetworks"); if (Object.hasOwn(p, "beacons")) pageFields.push("beacons"); if (Object.hasOwn(p, "backgroundActivity")) pageFields.push("backgroundActivity"); if (Object.hasOwn(p, "cookieProbes")) pageFields.push("cookieProbes"); if (Object.hasOwn(p, "cookieWriters")) pageFields.push("cookieWriters"); if (Object.hasOwn(p, "cookieValues")) pageFields.push("cookieValues"); if (Object.hasOwn(p, "requestValues")) pageFields.push("requestValues");
      if (!readAdvancedPageFields(p, v) || Object.hasOwn(p, "cookies") && readCookieSnapshot(p.cookies) === null || Object.hasOwn(p, "tagManager") && readTagManagerDocuments(p.tagManager) === null || Object.hasOwn(p, "socialNetworks") && readSocialDocuments(p.socialNetworks) === null || Object.hasOwn(p, "apiValues") && proValueDocuments(p.apiValues, readApiResultEntries) === null || !shape3(p, pageFields) || !id(p.id) || ids2.has(p.id) || !integer3(p.tabId) || !id(p.documentKey) || !displayUrl(p.url) || !text(p.title, PRO_LIMITS.maxTitleChars) || !epoch(p.startedAt) || p.startedAt < v.startedAt || p.startedAt > v.deadlineAt || p.endedAt !== null && (!epoch(p.endedAt) || p.endedAt < p.startedAt || p.endedAt > v.deadlineAt) || (ids2.add(p.id), !list(p.reports, PRO_LIMITS.maxDocumentsPerPage, report) || !list(p.resources, PRO_LIMITS.maxResourcesPerPage, resource))) return !1;
      let reportKeys = p.reports.map((item) => item.documentKey), entries = p.resources;
      return new Set(reportKeys).size !== reportKeys.length || new Set(entries.map((item) => item.id)).size !== entries.length || entries.some((item) => item.firstSeenAt < v.startedAt || item.lastSeenAt > v.deadlineAt) || v.status === "stopped" && p.endedAt === null || (resources += p.resources.length, resources > PRO_LIMITS.maxResources) ? !1 : (chars += JSON.stringify(p).length, chars <= PRO_LIMITS.maxBytes);
    }) || new TextEncoder().encode(JSON.stringify(normalizeProCookieMetadata(v))).byteLength > PRO_LIMITS.maxBytes ? { ok: !1 } : { ok: !0, value: normalizeProCookieMetadata(v) };
  } catch {
    return { ok: !1 };
  }
}

// packages/contracts/src/protection.ts
var PROTECTION_FEATURES = [
  "window-management",
  "compute-pressure",
  "idle-detection",
  "local-fonts",
  "canvas-readback",
  "webgl",
  "webgpu",
  "audio",
  "webrtc",
  "webassembly",
  "battery",
  "network-information",
  "keyboard",
  "client-hints",
  "clipboard-read",
  "media-enumeration",
  "media-capture",
  "geolocation",
  "generic-sensors",
  "bluetooth",
  "usb",
  "serial",
  "hid",
  "midi",
  "gamepads",
  "speech-voices",
  "service-worker",
  "push",
  "background-sync",
  "periodic-sync",
  "notifications",
  "storage-estimate",
  "videoframe-readback",
  "screen-extended",
  "webcodecs-capabilities",
  "media-capabilities",
  "encrypted-media",
  "hdcp-policy",
  "autoplay-policy",
  "webrtc-codecs",
  "device-motion",
  "hardware-concurrency",
  "device-memory",
  "performance-memory",
  "cpu-performance",
  "touch-points",
  "webxr",
  "speech-recognition",
  "shape-detection",
  "handwriting-recognition",
  "webnn",
  "builtin-ai-models",
  "translation-ai",
  "screen-wake-lock",
  "picture-in-picture",
  "document-picture-in-picture",
  "fullscreen",
  "pointer-lock",
  "file-system-pickers",
  "protocol-handlers",
  "installed-related-apps",
  "media-session",
  "opfs",
  "cookie-store",
  "document-cookie",
  "storage-buckets",
  "persistent-storage",
  "indexeddb-enumeration",
  "cache-storage",
  "legacy-quota",
  "cast-discovery",
  "send-beacon",
  "fetch-later",
  "websocket",
  "webtransport",
  "platform-authenticator",
  "web-share",
  "credential-management",
  "fedcm-user-info",
  "payment-probes",
  "storage-access",
  "private-state-tokens",
  "background-fetch",
  "shared-worker",
  "dedicated-worker",
  "clipboard-write",
  "permission-probes",
  "reporting-observer",
  "feature-policy",
  "webassembly-compile",
  "webassembly-instantiate",
  "webassembly-compile-streaming",
  "webassembly-instantiate-streaming",
  "webassembly-validate",
  "webassembly-module",
  "webassembly-instance",
  "webassembly-memory",
  "webassembly-memory-grow",
  "webassembly-memory-buffer",
  "webassembly-module-imports",
  "webassembly-module-exports",
  "webassembly-module-custom-sections",
  "webassembly-instance-exports",
  "webassembly-table",
  "webassembly-table-length",
  "webassembly-table-grow",
  "webassembly-table-get",
  "webassembly-table-set",
  "webassembly-global",
  "webassembly-global-value-of",
  "webassembly-global-value",
  "webassembly-global-value-set",
  "webassembly-tag",
  "webassembly-exception",
  "webassembly-exception-is",
  "webassembly-exception-get-arg",
  "webassembly-exception-stack",
  "webassembly-compile-error",
  "webassembly-link-error",
  "webassembly-runtime-error",
  "webassembly-suspending",
  "webassembly-promising",
  "webassembly-suspend-error",
  "webassembly-memory-to-fixed-length-buffer",
  "webassembly-memory-to-resizable-buffer",
  "webassembly-tag-type"
], MAX_PROTECTION_SITES = 128, PROTECTION_SETTINGS_KEY = "protection:v1", PROTECTION_PENDING_KEY = "protection:pending:v1";
var DEFAULT_PROTECTION_SETTINGS = Object.freeze({
  schemaVersion: 1,
  revision: 0,
  enabled: !1,
  preset: "limited",
  global: Object.freeze([]),
  sites: Object.freeze([])
}), FEATURE_SET = new Set(PROTECTION_FEATURES), LIMITED = ["window-management", "compute-pressure", "idle-detection", "local-fonts"], STRICT = [
  ...LIMITED,
  "canvas-readback",
  "battery",
  "network-information",
  "keyboard",
  "client-hints"
];
function isProtectionHost(value) {
  if (!isSanitizedHost(value)) return !1;
  try {
    return new URL("https://" + value + "/").hostname === value;
  } catch {
    return !1;
  }
}
function dataRecord(value, keys4) {
  if (typeof value != "object" || value === null || Array.isArray(value) || Reflect.ownKeys(value).length !== keys4.length) return null;
  let result = /* @__PURE__ */ Object.create(null);
  for (let key2 of keys4) {
    let descriptor3 = Object.getOwnPropertyDescriptor(value, key2);
    if (!descriptor3 || !Object.hasOwn(descriptor3, "value")) return null;
    result[key2] = descriptor3.value;
  }
  return result;
}
function readArray(value, limit, read4) {
  if (!Array.isArray(value)) return null;
  let length = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (typeof length != "number" || !Number.isInteger(length) || length < 0 || length > limit) return null;
  let result = [];
  for (let index = 0; index < length; index++) {
    let descriptor3 = Object.getOwnPropertyDescriptor(value, index);
    if (!descriptor3 || !Object.hasOwn(descriptor3, "value")) return null;
    let entry = read4(descriptor3.value);
    if (entry === null) return null;
    result.push(entry);
  }
  return result;
}
function readRules(value) {
  let seen = /* @__PURE__ */ new Set();
  return readArray(value, PROTECTION_FEATURES.length, (entry) => {
    let record2 = dataRecord(entry, ["feature", "state"]);
    if (!record2) return null;
    let feature = record2.feature, state = record2.state;
    return typeof feature != "string" || !FEATURE_SET.has(feature) || seen.has(feature) || state !== "allow" && state !== "block" ? null : (seen.add(feature), { feature, state });
  });
}
function readProtectionSettings(value) {
  try {
    let record2 = dataRecord(value, ["schemaVersion", "revision", "enabled", "preset", "global", "sites"]);
    if (!record2 || record2.schemaVersion !== 1) return null;
    let revision = record2.revision, enabled2 = record2.enabled, preset = record2.preset;
    if (typeof revision != "number" || !Number.isSafeInteger(revision) || revision < 0 || typeof enabled2 != "boolean" || preset !== "limited" && preset !== "strict" && preset !== "custom") return null;
    let global = readRules(record2.global);
    if (global === null) return null;
    let hosts = /* @__PURE__ */ new Set(), sites = readArray(record2.sites, MAX_PROTECTION_SITES, (entry) => {
      let site = dataRecord(entry, ["host", "disabled", "rules"]);
      if (!site) return null;
      let host2 = site.host, disabled2 = site.disabled;
      if (!isProtectionHost(host2) || hosts.has(host2) || typeof disabled2 != "boolean") return null;
      let rules2 = readRules(site.rules);
      return rules2 === null ? null : (hosts.add(host2), { host: host2, disabled: disabled2, rules: rules2 });
    });
    return sites === null ? null : { schemaVersion: 1, revision, enabled: enabled2, preset, global, sites };
  } catch {
    return null;
  }
}
function effectiveProtection(settings, host2) {
  if (!settings.enabled || !isProtectionHost(host2)) return [];
  let site = settings.sites.find((entry) => entry.host === host2);
  if (site?.disabled) return [];
  let blocked = new Set(settings.preset === "strict" ? STRICT : settings.preset === "limited" ? LIMITED : []);
  for (let rule of [...settings.global, ...site?.rules ?? []])
    rule.state === "block" ? blocked.add(rule.feature) : blocked.delete(rule.feature);
  return PROTECTION_FEATURES.filter((feature) => blocked.has(feature));
}
function readProtectionObservations(value) {
  try {
    let seen = /* @__PURE__ */ new Set();
    return readArray(value, PROTECTION_FEATURES.length, (entry) => {
      let row = dataRecord(entry, ["feature", "installed", "unavailable", "removed", "blocked", "stopped"]);
      if (!row) return null;
      let feature = row.feature;
      if (typeof feature != "string" || !FEATURE_SET.has(feature) || seen.has(feature) || typeof row.stopped != "boolean") return null;
      for (let key2 of ["installed", "unavailable", "removed", "blocked"]) {
        let count3 = row[key2];
        if (typeof count3 != "number" || !Number.isInteger(count3) || count3 < 0 || count3 > (key2 === "blocked" ? 65535 : 16)) return null;
      }
      return row.removed > row.installed ? null : (seen.add(feature), {
        feature,
        installed: row.installed,
        unavailable: row.unavailable,
        removed: row.removed,
        blocked: row.blocked,
        stopped: row.stopped
      });
    });
  } catch {
    return null;
  }
}
function readProtectionUiRequest(value) {
  try {
    if (typeof value != "object" || value === null) return null;
    let type = Object.getOwnPropertyDescriptor(value, "type")?.value, record2 = dataRecord(value, type === "ui-protection-set" ? ["schemaVersion", "type", "tabId", "settings"] : type === "ui-protection-reload" ? ["schemaVersion", "type", "tabId", "documentId"] : ["schemaVersion", "type", "tabId"]);
    if (!record2 || record2.schemaVersion !== 1) return null;
    let tabId = record2.tabId;
    if (tabId !== null && (typeof tabId != "number" || !Number.isSafeInteger(tabId) || tabId < 0)) return null;
    if (type === "ui-protection-get") return { schemaVersion: 1, type, tabId };
    if (type === "ui-protection-set") {
      let settings = readProtectionSettings(record2.settings);
      return settings ? { schemaVersion: 1, type, tabId, settings } : null;
    }
    if (type === "ui-protection-reload") {
      let documentId2 = record2.documentId;
      return tabId !== null && typeof documentId2 == "string" && /^[A-Za-z0-9_-]{1,64}$/.test(documentId2) ? { schemaVersion: 1, type, tabId, documentId: documentId2 } : null;
    }
    return null;
  } catch {
    return null;
  }
}

// packages/contracts/src/rtc-values.ts
var RTC_VALUE_LIMITS = Object.freeze({ fields: 96, index: 31, bytes: 12e3, sourceChars: 32768, sourceLines: 512 }), RTC_VALUE_PROFILES = ["capabilities", "description", "configuration", "certificate", "stats", "certificate-storage", "media-settings"], RTC_CODEC_MIME_TYPES = [
  "audio/opus",
  "audio/PCMU",
  "audio/PCMA",
  "audio/G722",
  "audio/ISAC",
  "audio/CN",
  "audio/telephone-event",
  "audio/red",
  "video/VP8",
  "video/VP9",
  "video/H264",
  "video/H265",
  "video/AV1",
  "video/rtx",
  "video/red",
  "video/ulpfec",
  "video/flexfec-03"
], RTC_HEADER_EXTENSION_URIS = [
  "urn:ietf:params:rtp-hdrext:ssrc-audio-level",
  "urn:ietf:params:rtp-hdrext:csrc-audio-level",
  "urn:ietf:params:rtp-hdrext:sdes:mid",
  "urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id",
  "urn:ietf:params:rtp-hdrext:sdes:repaired-rtp-stream-id",
  "urn:ietf:params:rtp-hdrext:toffset",
  "urn:3gpp:video-orientation",
  "http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time",
  "http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01",
  "http://www.webrtc.org/experiments/rtp-hdrext/playout-delay",
  "http://www.webrtc.org/experiments/rtp-hdrext/video-content-type",
  "http://www.webrtc.org/experiments/rtp-hdrext/video-timing",
  "http://www.webrtc.org/experiments/rtp-hdrext/color-space",
  "http://www.webrtc.org/experiments/rtp-hdrext/abs-capture-time",
  "http://www.webrtc.org/experiments/rtp-hdrext/video-layers-allocation00",
  "https://aomediacodec.github.io/av1-rtp-spec/#dependency-descriptor-rtp-header-extension"
], RTC_FMTP_PATTERN = "^(?:(?:apt|level-asymmetry-allowed|packetization-mode|profile-id|level-id|tier-flag|minptime|maxplaybackrate|sprop-maxcapturerate|stereo|sprop-stereo|useinbandfec|usedtx|maxaveragebitrate|max-fr|tx-mode|L|D|repair-window)=[0-9]{1,9}|profile-level-id=[A-Fa-f0-9]{6})(?:;(?:(?:apt|level-asymmetry-allowed|packetization-mode|profile-id|level-id|tier-flag|minptime|maxplaybackrate|sprop-maxcapturerate|stereo|sprop-stereo|useinbandfec|usedtx|maxaveragebitrate|max-fr|tx-mode|L|D|repair-window)=[0-9]{1,9}|profile-level-id=[A-Fa-f0-9]{6})){0,15}$", RTC_VALUE_FIELDS = {
  "codec.mimeType": { type: "enum", values: RTC_CODEC_MIME_TYPES },
  "codec.clockRate": { type: "integer", maximum: 384e3 },
  "codec.channels": { type: "integer", maximum: 32 },
  "codec.payloadType": { type: "integer", maximum: 127 },
  "codec.mediaSection": { type: "integer", maximum: 31 },
  "codec.parameters": { type: "pattern", pattern: RTC_FMTP_PATTERN, maximum: 256 },
  "headerExtension.uri": { type: "enum", values: RTC_HEADER_EXTENSION_URIS },
  "headerExtension.id": { type: "integer", maximum: 255 },
  "headerExtension.mediaSection": { type: "integer", maximum: 31 },
  "description.type": { type: "enum", values: ["offer", "answer", "pranswer", "rollback"] },
  "media.kind": { type: "enum", values: ["audio", "video", "application"] },
  "media.protocol": { type: "enum", values: ["UDP/TLS/RTP/SAVPF", "RTP/SAVPF", "UDP/DTLS/SCTP", "DTLS/SCTP"] },
  "media.payloadTypes": { type: "pattern", pattern: "^(?:[0-9]|[1-9][0-9]|1[01][0-9]|12[0-7])(?: (?:[0-9]|[1-9][0-9]|1[01][0-9]|12[0-7])){0,31}$", maximum: 127 },
  "media.direction": { type: "enum", values: ["sendrecv", "sendonly", "recvonly", "inactive"] },
  "media.rtcpMux": { type: "boolean" },
  "dtls.setup": { type: "enum", values: ["active", "passive", "actpass", "holdconn"] },
  "certificate.sha-256": { type: "pattern", pattern: "^[A-Fa-f0-9]{2}(?::[A-Fa-f0-9]{2}){31}$", maximum: 95 },
  "certificate.sha-384": { type: "pattern", pattern: "^[A-Fa-f0-9]{2}(?::[A-Fa-f0-9]{2}){47}$", maximum: 143 },
  "certificate.sha-512": { type: "pattern", pattern: "^[A-Fa-f0-9]{2}(?::[A-Fa-f0-9]{2}){63}$", maximum: 191 },
  "certificate.expires": { type: "integer", maximum: 864e13 },
  "configuration.bundlePolicy": { type: "enum", values: ["balanced", "max-compat", "max-bundle"] },
  "configuration.iceTransportPolicy": { type: "enum", values: ["all", "relay"] },
  "configuration.rtcpMuxPolicy": { type: "enum", values: ["require", "negotiate"] },
  "configuration.iceCandidatePoolSize": { type: "integer", maximum: 255 },
  "configuration.certificates": { type: "integer", maximum: 32 },
  "storage.operation": { type: "enum", values: ["put", "add", "result"] },
  "storage.completion": { type: "enum", values: ["request-returned", "value-returned"] },
  "stats.type": { type: "enum", values: ["codec", "inbound-rtp", "outbound-rtp", "certificate", "transport", "peer-connection", "data-channel"] },
  "stats.encoderImplementation": { type: "enum", values: ["libvpx", "OpenH264", "ExternalEncoder", "ExternalEncoder (Unknown)", "VideoToolbox", "MediaCodec"] },
  "stats.decoderImplementation": { type: "enum", values: ["libvpx", "OpenH264", "ExternalDecoder", "ExternalDecoder (Unknown)", "VideoToolbox", "MediaCodec", "FFmpeg", "libaom", "dav1d"] },
  "stats.powerEfficientEncoder": { type: "boolean" },
  "stats.powerEfficientDecoder": { type: "boolean" },
  "stats.dtlsState": { type: "enum", values: ["new", "connecting", "connected", "closed", "failed"] },
  "media.width": { type: "integer", maximum: 65535 },
  "media.height": { type: "integer", maximum: 65535 },
  "media.frameRate": { type: "number", maximum: 1e4 },
  "media.aspectRatio": { type: "number", maximum: 65535 },
  "media.sampleRate": { type: "integer", maximum: 384e3 },
  "media.sampleSize": { type: "integer", maximum: 128 },
  "media.channelCount": { type: "integer", maximum: 32 },
  "media.echoCancellation": { type: "boolean" },
  "media.noiseSuppression": { type: "boolean" },
  "media.autoGainControl": { type: "boolean" }
}, RTC_VALUE_OPERATIONS = [
  ["RTCPeerConnection.getConfiguration", "configuration"],
  ["RTCPeerConnection.configurationSnapshot", "configuration"],
  ["RTCCertificate.getFingerprints", "certificate"],
  ["RTCRtpSender.getCapabilities", "capabilities"],
  ["RTCRtpReceiver.getCapabilities", "capabilities"],
  ["RTCRtpSender.getParameters", "capabilities"],
  ["RTCRtpReceiver.getParameters", "capabilities"],
  ["RTCSessionDescription.sdp", "description"],
  ["RTCSessionDescription.toJSON", "description"],
  ["RTCStatsReport.get", "stats"],
  ["IDBObjectStore.put", "certificate-storage"],
  ["IDBObjectStore.add", "certificate-storage"],
  ["IDBRequest.result", "certificate-storage"],
  ["MediaStreamTrack.getSettings", "media-settings"]
], profiles = new Map(RTC_VALUE_OPERATIONS), mapGet3 = Map.prototype.get;
function rtcValueProfile(operation) {
  return apply3(mapGet3, profiles, [operation]) ?? null;
}
function rtcValueSource(operation) {
  return operation === "RTCPeerConnection.configurationSnapshot" || operation === "IDBObjectStore.put" || operation === "IDBObjectStore.add" || operation === "IDBRequest.result" ? "native-snapshot" : "returned";
}
var descriptor2 = Object.getOwnPropertyDescriptor, own = Object.hasOwn, keys3 = Reflect.ownKeys, array = Array.isArray, apply3 = Reflect.apply, includes = Array.prototype.includes, regexpExec = RegExp.prototype.exec, finite = Number.isFinite, integer4 = Number.isSafeInteger, objectIs = Object.is, create = Object.create, define = Object.defineProperty, startsWith = String.prototype.startsWith, patterns = Object.fromEntries(Object.entries(RTC_VALUE_FIELDS).flatMap(([name, spec]) => spec.type === "pattern" ? [[name, new RegExp(spec.pattern)]] : []));
function field2(value, key2) {
  let found = descriptor2(value, key2);
  return found && found.enumerable && own(found, "value") ? found.value : void 0;
}
function exact(value, count3) {
  return value !== null && typeof value == "object" && !array(value) && keys3(value).length === count3;
}
function rtcValueFieldAllowed(profile, name) {
  let prefix = (value) => apply3(startsWith, name, [value]);
  return profile === "certificate" ? prefix("certificate.") : profile === "certificate-storage" ? prefix("certificate.") || prefix("storage.") : profile === "configuration" ? prefix("certificate.") || prefix("configuration.") : profile === "capabilities" ? prefix("codec.") || prefix("headerExtension.") : profile === "stats" ? prefix("stats.") || prefix("codec.") || prefix("certificate.") : profile === "media-settings" ? prefix("media.") && !apply3(includes, ["media.kind", "media.protocol", "media.payloadTypes", "media.direction", "media.rtcpMux"], [name]) : prefix("codec.") || prefix("headerExtension.") || prefix("description.") || prefix("dtls.") || apply3(includes, ["media.kind", "media.protocol", "media.payloadTypes", "media.direction", "media.rtcpMux", "certificate.sha-256", "certificate.sha-384", "certificate.sha-512"], [name]);
}
function validRtcFieldValue(name, value) {
  if (!own(RTC_VALUE_FIELDS, name)) return !1;
  let spec = RTC_VALUE_FIELDS[name];
  return spec ? spec.type === "boolean" ? typeof value == "boolean" : spec.type === "enum" ? typeof value == "string" && apply3(includes, spec.values, [value]) : spec.type === "pattern" ? typeof value == "string" && value.length <= spec.maximum && apply3(regexpExec, patterns[name], [value]) !== null : typeof value == "number" && finite(value) && !objectIs(value, -0) && value >= 0 && value <= spec.maximum && (spec.type !== "integer" || integer4(value)) : !1;
}
function rtcValueBytes(value) {
  let bytes = 256;
  for (let index = 0; index < value.fields.length; index++) {
    let entry = value.fields[index];
    bytes += 80 + entry.name.length + (typeof entry.value == "string" ? entry.value.length * 6 : 32);
  }
  return bytes;
}
function readRtcValue(value) {
  try {
    if (!exact(value, 5) || field2(value, "kind") !== "webrtc") return null;
    let profile = field2(value, "profile"), source = field2(value, "source"), rows = field2(value, "fields"), truncated = field2(value, "truncated");
    if (typeof profile != "string" || !apply3(includes, RTC_VALUE_PROFILES, [profile]) || source !== "returned" && source !== "native-snapshot" || typeof truncated != "boolean" || !array(rows) || rows.length > RTC_VALUE_LIMITS.fields || keys3(rows).length !== rows.length + 1) return null;
    let fields4 = [], seen = create(null);
    for (let index = 0; index < rows.length; index++) {
      let row = field2(rows, "" + index);
      if (!exact(row, 3)) return null;
      let name = field2(row, "name"), position = field2(row, "index"), content = field2(row, "value");
      if (typeof name != "string" || !own(RTC_VALUE_FIELDS, name) || !rtcValueFieldAllowed(profile, name) || typeof position != "number" || !integer4(position) || position < 0 || position > RTC_VALUE_LIMITS.index || !validRtcFieldValue(name, content) || profile === "configuration" && source === "returned" && apply3(startsWith, name, ["certificate."])) return null;
      let key2 = name + ":" + position;
      if (seen[key2]) return null;
      seen[key2] = !0, define(fields4, index, { __proto__: null, value: { name, index: position, value: content }, enumerable: !0, configurable: !0, writable: !0 });
    }
    let result = { kind: "webrtc", profile, source, fields: fields4, truncated };
    return rtcValueBytes(result) <= RTC_VALUE_LIMITS.bytes ? result : null;
  } catch {
    return null;
  }
}

// packages/contracts/src/api-results.ts
var API_RESULTS_LIMITS = Object.freeze({ rows: 256, stringChars: 256, vectorItems: 16, bytes: 65536, batchRows: 32, queryMs: 200 }), WEBGL_RESULT_PARAMETERS = [
  [7936, "VENDOR"],
  [7937, "RENDERER"],
  [7938, "VERSION"],
  [35724, "SHADING_LANGUAGE_VERSION"],
  [37445, "UNMASKED_VENDOR_WEBGL"],
  [37446, "UNMASKED_RENDERER_WEBGL"],
  [3379, "MAX_TEXTURE_SIZE"],
  [34076, "MAX_CUBE_MAP_TEXTURE_SIZE"],
  [34024, "MAX_RENDERBUFFER_SIZE"],
  [3386, "MAX_VIEWPORT_DIMS"],
  [34921, "MAX_VERTEX_ATTRIBS"],
  [35660, "MAX_VERTEX_TEXTURE_IMAGE_UNITS"],
  [34930, "MAX_TEXTURE_IMAGE_UNITS"],
  [35661, "MAX_COMBINED_TEXTURE_IMAGE_UNITS"],
  [36347, "MAX_VERTEX_UNIFORM_VECTORS"],
  [36349, "MAX_FRAGMENT_UNIFORM_VECTORS"],
  [36348, "MAX_VARYING_VECTORS"],
  [33901, "ALIASED_POINT_SIZE_RANGE"],
  [33902, "ALIASED_LINE_WIDTH_RANGE"],
  [3410, "RED_BITS"],
  [3411, "GREEN_BITS"],
  [3412, "BLUE_BITS"],
  [3413, "ALPHA_BITS"],
  [3414, "DEPTH_BITS"],
  [3415, "STENCIL_BITS"],
  [32936, "SAMPLE_BUFFERS"],
  [32937, "SAMPLES"],
  [34047, "MAX_TEXTURE_MAX_ANISOTROPY_EXT"],
  [34467, "COMPRESSED_TEXTURE_FORMATS"],
  [32883, "MAX_3D_TEXTURE_SIZE"],
  [35071, "MAX_ARRAY_TEXTURE_LAYERS"],
  [36063, "MAX_COLOR_ATTACHMENTS"],
  [34852, "MAX_DRAW_BUFFERS"],
  [36203, "MAX_ELEMENT_INDEX"],
  [33001, "MAX_ELEMENTS_INDICES"],
  [33e3, "MAX_ELEMENTS_VERTICES"],
  [37157, "MAX_FRAGMENT_INPUT_COMPONENTS"],
  [35657, "MAX_FRAGMENT_UNIFORM_COMPONENTS"],
  [37154, "MAX_VERTEX_OUTPUT_COMPONENTS"],
  [35659, "MAX_VARYING_COMPONENTS"],
  [35658, "MAX_VERTEX_UNIFORM_COMPONENTS"],
  [35375, "MAX_UNIFORM_BUFFER_BINDINGS"],
  [35376, "MAX_UNIFORM_BLOCK_SIZE"],
  [35380, "UNIFORM_BUFFER_OFFSET_ALIGNMENT"],
  [33390, "MAX_UNIFORM_LOCATIONS"],
  [35374, "MAX_COMBINED_UNIFORM_BLOCKS"],
  [35371, "MAX_VERTEX_UNIFORM_BLOCKS"],
  [35373, "MAX_FRAGMENT_UNIFORM_BLOCKS"],
  [35377, "MAX_COMBINED_VERTEX_UNIFORM_COMPONENTS"],
  [35379, "MAX_COMBINED_FRAGMENT_UNIFORM_COMPONENTS"]
], WEBGL_RESULT_EXTENSIONS = [
  "WEBGL_debug_renderer_info",
  "WEBGL_debug_shaders",
  "WEBGL_lose_context",
  "WEBGL_draw_buffers",
  "WEBGL_compressed_texture_s3tc",
  "WEBGL_compressed_texture_s3tc_srgb",
  "WEBGL_compressed_texture_etc",
  "WEBGL_compressed_texture_etc1",
  "WEBGL_compressed_texture_astc",
  "WEBGL_compressed_texture_pvrtc",
  "WEBGL_depth_texture",
  "EXT_texture_filter_anisotropic",
  "EXT_disjoint_timer_query",
  "EXT_disjoint_timer_query_webgl2",
  "EXT_color_buffer_float",
  "EXT_color_buffer_half_float",
  "EXT_float_blend",
  "EXT_shader_texture_lod",
  "EXT_frag_depth",
  "EXT_sRGB",
  "OES_texture_float",
  "OES_texture_float_linear",
  "OES_texture_half_float",
  "OES_texture_half_float_linear",
  "OES_standard_derivatives",
  "OES_element_index_uint",
  "OES_vertex_array_object",
  "ANGLE_instanced_arrays"
], additional = [
  ["Navigator", "DET-025", ["userAgent", "platform", "vendor", "language", "languages", "appVersion", "appName", "appCodeName", "product", "productSub", "vendorSub"]],
  ["Navigator", "DET-027", ["plugins", "mimeTypes", "pdfViewerEnabled"]],
  ["Navigator", "DET-028", ["webdriver"]],
  ["Window", "DET-030", ["innerWidth", "innerHeight", "devicePixelRatio", "visualViewport"]],
  ["VisualViewport", "DET-030", ["offsetLeft", "offsetTop", "pageLeft", "pageTop", "width", "height", "scale"]],
  ["Navigator", "DET-032", ["hardwareConcurrency"]],
  ["Navigator", "DET-033", ["deviceMemory"]],
  ["Navigator", "DET-034", ["maxTouchPoints"]],
  ["Date", "DET-035", ["getTimezoneOffset"]],
  ["Intl.Collator", "DET-036", ["resolvedOptions"]],
  ["Intl.DateTimeFormat", "DET-036", ["resolvedOptions"]],
  ["Intl.NumberFormat", "DET-036", ["resolvedOptions"]],
  ["Intl.PluralRules", "DET-036", ["resolvedOptions"]],
  ["Intl.RelativeTimeFormat", "DET-036", ["resolvedOptions"]],
  ["Intl.ListFormat", "DET-036", ["resolvedOptions"]],
  ["Intl.Segmenter", "DET-036", ["resolvedOptions"]],
  ["Intl.DisplayNames", "DET-036", ["resolvedOptions"]],
  ["Window", "DET-037", ["matchMedia"]],
  ["CSS", "DET-038", ["supports"]],
  ["Navigator", "DET-040", ["getBattery"]],
  ["BatteryManager", "DET-040", ["charging", "chargingTime", "dischargingTime", "level"]],
  ["Navigator", "DET-041", ["connection"]],
  ["NetworkInformation", "DET-041", ["type", "effectiveType", "rtt", "downlink", "downlinkMax", "saveData"]],
  ["Document", "DET-049", ["cookie"]],
  ["Clipboard", "DET-069", ["read", "readText", "write", "writeText"]],
  ["WebGLShaderPrecisionFormat", "DET-011", ["rangeMin", "rangeMax", "precision"]],
  ["Element", "DET-005", ["getClientRects", "getBoundingClientRect"]],
  ["HTMLElement", "DET-005", ["offsetWidth", "offsetHeight"]],
  ["Range", "DET-006", ["getClientRects", "getBoundingClientRect"]],
  ["SVGGraphicsElement", "DET-007", ["getBBox"]],
  ["SVGTextContentElement", "DET-007", ["getComputedTextLength", "getSubStringLength"]],
  ["FontFaceSet", "DET-008", ["check", "load", "values", "keys", "entries", "forEach", "iterator"]],
  ["Window", "DET-009", ["queryLocalFonts"]],
  ["MediaQueryList", "DET-037", ["matches"]],
  ["Permissions", "DET-039", ["query"]],
  ["PermissionStatus", "DET-039", ["state"]],
  ["Notification", "DET-039", ["permission"]],
  ["Geolocation", "DET-044", ["getCurrentPosition", "watchPosition"]],
  ["Bluetooth", "DET-045", ["getAvailability", "getDevices", "requestDevice"]],
  ["USB", "DET-046", ["getDevices", "requestDevice"]],
  ["HID", "DET-046", ["getDevices", "requestDevice"]],
  ["Serial", "DET-046", ["getPorts", "requestPort"]],
  ["Navigator", "DET-047", ["getGamepads"]],
  ["XRSystem", "DET-048", ["isSessionSupported", "requestSession"]],
  ["CookieStore", "DET-049", ["get", "getAll", "set", "delete"]],
  ["Storage", "DET-050", ["getItem", "setItem", "removeItem", "clear", "key"]],
  ["IDBFactory", "DET-051", ["open", "deleteDatabase", "databases"]],
  ["CacheStorage", "DET-052", ["open", "match", "has", "delete", "keys"]],
  ["Cache", "DET-052", ["match", "matchAll", "add", "addAll", "put", "delete", "keys"]],
  ["StorageManager", "DET-053", ["estimate", "persist", "persisted"]],
  ["Document", "DET-054", ["hasStorageAccess", "requestStorageAccess", "hasUnpartitionedCookieAccess", "requestStorageAccessFor"]],
  ["ServiceWorkerContainer", "DET-063", ["register", "getRegistration", "getRegistrations"]],
  ["PublicKeyCredential", "DET-069", ["isUserVerifyingPlatformAuthenticatorAvailable", "isConditionalMediationAvailable", "getClientCapabilities"]]
], SENSITIVE = /* @__PURE__ */ new Set([
  "Document.cookie",
  "Clipboard.read",
  "Clipboard.readText",
  "AudioBuffer.getChannelData",
  "AudioBuffer.copyFromChannel",
  "AnalyserNode.getFloatFrequencyData",
  "AnalyserNode.getByteFrequencyData",
  "AnalyserNode.getFloatTimeDomainData",
  "AnalyserNode.getByteTimeDomainData",
  "PressureRecord.time",
  "ScreenDetailed.label",
  "Storage.getItem",
  "Storage.key",
  "CookieStore.get",
  "CookieStore.getAll",
  "MLContext.readTensor",
  "MLContext.compute",
  "MLTensor.shape",
  "MLOperand.shape"
]);
for (let [operation, techniqueId] of API_OPERATION_DEFINITIONS)
  (techniqueId === "DET-071" && !operation.endsWith(".availability") && !operation.endsWith(".params") && !operation.endsWith(".create") || techniqueId === "DET-072" && operation.endsWith(".detect")) && SENSITIVE.add(operation);
var definitions2 = /* @__PURE__ */ new Map(), ASYNC = /* @__PURE__ */ new Set([
  "Navigator.getBattery",
  "Clipboard.read",
  "Clipboard.readText",
  "Clipboard.write",
  "Clipboard.writeText",
  "Window.fetch",
  "Window.queryLocalFonts",
  "FontFaceSet.load",
  "Permissions.query",
  "Geolocation.getCurrentPosition",
  "Geolocation.watchPosition",
  "Bluetooth.getAvailability",
  "Bluetooth.getDevices",
  "Bluetooth.requestDevice",
  "USB.getDevices",
  "USB.requestDevice",
  "HID.getDevices",
  "HID.requestDevice",
  "Serial.getPorts",
  "Serial.requestPort",
  "XRSystem.isSessionSupported",
  "XRSystem.requestSession",
  "CookieStore.get",
  "CookieStore.getAll",
  "CookieStore.set",
  "CookieStore.delete",
  "IDBFactory.open",
  "IDBFactory.deleteDatabase",
  "IDBFactory.databases",
  "CacheStorage.open",
  "CacheStorage.match",
  "CacheStorage.has",
  "CacheStorage.delete",
  "CacheStorage.keys",
  "Cache.match",
  "Cache.matchAll",
  "Cache.add",
  "Cache.addAll",
  "Cache.put",
  "Cache.delete",
  "Cache.keys",
  "StorageManager.estimate",
  "StorageManager.persist",
  "StorageManager.persisted",
  "Document.hasStorageAccess",
  "Document.requestStorageAccess",
  "Document.hasUnpartitionedCookieAccess",
  "Document.requestStorageAccessFor",
  "ServiceWorkerContainer.register",
  "ServiceWorkerContainer.getRegistration",
  "ServiceWorkerContainer.getRegistrations",
  "PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable",
  "PublicKeyCredential.isConditionalMediationAvailable",
  "PublicKeyCredential.getClientCapabilities"
]);
for (let [operation, techniqueId, , kind] of API_OPERATION_DEFINITIONS) definitions2.set(operation, {
  operation,
  techniqueId,
  sensitive: SENSITIVE.has(operation),
  asynchronous: kind === "async-call",
  numericVector: !1,
  typeOnly: !1
});
for (let [prefix, techniqueId, keys4] of additional) for (let key2 of keys4) {
  let operation = prefix + "." + key2;
  definitions2.set(operation, { operation, techniqueId, sensitive: SENSITIVE.has(operation), asynchronous: ASYNC.has(operation), numericVector: !1, typeOnly: !1 });
}
for (let operation of ["Window.fetch", "Navigator.sendBeacon"]) definitions2.set(operation, {
  operation,
  techniqueId: "DET-059",
  sensitive: !1,
  asynchronous: ASYNC.has(operation),
  numericVector: !1,
  typeOnly: !1
});
var vectorParameters = /* @__PURE__ */ new Set(["MAX_VIEWPORT_DIMS", "ALIASED_POINT_SIZE_RANGE", "ALIASED_LINE_WIDTH_RANGE", "COMPRESSED_TEXTURE_FORMATS"]), glParameters = new Map(WEBGL_RESULT_PARAMETERS), glExtensions = new Map(WEBGL_RESULT_EXTENSIONS.map((name) => [name.toLowerCase(), name]));
for (let prefix of ["WebGLRenderingContext", "WebGL2RenderingContext"]) {
  for (let name of ["getParameter", "getExtension", "getSupportedExtensions", "getShaderPrecisionFormat", "readPixels"]) {
    let operation = prefix + "." + name;
    definitions2.set(operation, {
      operation,
      techniqueId: name === "readPixels" ? "DET-012" : "DET-011",
      asynchronous: !1,
      sensitive: name === "readPixels",
      typeOnly: name === "getParameter",
      numericVector: !1
    });
  }
  for (let [, name] of WEBGL_RESULT_PARAMETERS) {
    let operation = prefix + ".getParameter." + name;
    definitions2.set(operation, { operation, techniqueId: "DET-011", asynchronous: !1, sensitive: !1, numericVector: vectorParameters.has(name), typeOnly: !1 });
  }
  for (let name of WEBGL_RESULT_EXTENSIONS) {
    let operation = prefix + ".getExtension." + name;
    definitions2.set(operation, { operation, techniqueId: "DET-011", asynchronous: !1, sensitive: !1, numericVector: !1, typeOnly: !1 });
  }
}
for (let permission of [
  "camera",
  "microphone",
  "geolocation",
  "notifications",
  "clipboard-read",
  "clipboard-write",
  "persistent-storage",
  "background-sync",
  "midi",
  "sensors",
  "payment-handler",
  "screen-wake-lock",
  "window-management",
  "local-fonts",
  "display-capture",
  "storage-access",
  "unknown"
]) {
  let operation = "PermissionStatus.state." + permission;
  definitions2.set(operation, { operation, techniqueId: "DET-039", asynchronous: !1, sensitive: !1, numericVector: !1, typeOnly: !1 });
}
for (let prefix of ["FeaturePolicy", "PermissionsPolicy"]) for (let method of ["allowsFeature", "features", "allowedFeatures", "getAllowlistForFeature"]) {
  let operation = prefix + "." + method;
  definitions2.set(operation, { operation, techniqueId: "DET-039", asynchronous: !1, sensitive: method === "getAllowlistForFeature", numericVector: !1, typeOnly: !1 });
}
definitions2.set("RTCPeerConnection.configurationSnapshot", {
  operation: "RTCPeerConnection.configurationSnapshot",
  techniqueId: "DET-056",
  sensitive: !1,
  asynchronous: !1,
  numericVector: !1,
  typeOnly: !0
});
for (let definition of definitions2.values()) rtcValueProfile(definition.operation) && (definition.typeOnly = !0);
for (let member2 of ["localDescription", "currentLocalDescription", "pendingLocalDescription", "remoteDescription", "currentRemoteDescription", "pendingRemoteDescription"]) {
  let definition = definitions2.get("RTCPeerConnection." + member2);
  definition && (definition.typeOnly = !0);
}
var API_RESULT_DEFINITIONS = Object.freeze([...definitions2.values()]), apply4 = Reflect.apply, mapGet4 = Map.prototype.get, lowerCase = String.prototype.toLowerCase;
function apiResultDefinition(operation) {
  return typeof operation != "string" || operation.length > 128 ? null : apply4(mapGet4, definitions2, [operation]) ?? null;
}
var own2 = Object.getOwnPropertyDescriptor, keysOf = Reflect.ownKeys, hasOwn2 = Object.hasOwn, isArray2 = Array.isArray, finite2 = Number.isFinite, integer5 = Number.isInteger, is = Object.is, create2 = Object.create, define2 = Object.defineProperty, test3 = RegExp.prototype.test;
var DOCUMENT = /^[A-Za-z0-9_:.-]{1,160}$/;
function fields(value, names4) {
  if (typeof value != "object" || value === null || isArray2(value) || keysOf(value).length !== names4.length) return null;
  let result = create2(null);
  for (let index = 0; index < names4.length; index++) {
    let name = names4[index], descriptor3 = own2(value, name);
    if (!descriptor3 || !hasOwn2(descriptor3, "value") || descriptor3.enumerable !== !0) return null;
    result[name] = descriptor3.value;
  }
  return result;
}
function nonNegative(value, maximum = 2147483647) {
  return typeof value == "number" && integer5(value) && value >= 0 && value <= maximum;
}
function readValue(value) {
  if (typeof value != "object" || value === null) return null;
  let kind = own2(value, "kind")?.value;
  if (kind === "webrtc") return readRtcValue(value);
  if (kind === "null" || kind === "undefined") return fields(value, ["kind"]) ? { kind } : null;
  if (kind === "unobserved") {
    let reason = fields(value, ["kind", "reason"])?.reason;
    return reason !== "object" && reason !== "async" && reason !== "exception" && reason !== "sensitive" && reason !== "limit" && reason !== "unsupported" ? null : { kind, reason };
  }
  if (kind === "number-array") {
    let raw = fields(value, ["kind", "values"])?.values;
    if (!isArray2(raw) || raw.length > API_RESULTS_LIMITS.vectorItems || keysOf(raw).length !== raw.length + 1) return null;
    let values = [];
    for (let index = 0; index < raw.length; index++) {
      let descriptor3 = own2(raw, index);
      if (!descriptor3 || !hasOwn2(descriptor3, "value")) return null;
      let element = descriptor3.value;
      if (!(typeof element == "number" && finite2(element) && !is(element, -0)) && element !== "NaN" && element !== "Infinity" && element !== "-Infinity" && element !== "-0") return null;
      define2(values, index, { __proto__: null, value: element, enumerable: !0, configurable: !0, writable: !0 });
    }
    return { kind, values };
  }
  let record2 = fields(value, ["kind", "value"]);
  if (!record2) return null;
  let content = record2.value;
  return kind === "number" && typeof content == "number" && finite2(content) && !is(content, -0) ? { kind, value: content } : kind === "boolean" && typeof content == "boolean" ? { kind, value: content } : kind === "string" && typeof content == "string" && content.length <= API_RESULTS_LIMITS.stringChars ? { kind, value: content } : kind === "special-number" && (content === "NaN" || content === "Infinity" || content === "-Infinity" || content === "-0") ? { kind, value: content } : null;
}
function apiResultEntryBytes(entry) {
  return entry.operation.length + 192 + (entry.value.kind === "string" ? entry.value.value.length * 6 : entry.value.kind === "number-array" ? entry.value.values.length * 32 : entry.value.kind === "webrtc" ? rtcValueBytes(entry.value) : 0);
}
function readApiResultEntries(value, maximum = API_RESULTS_LIMITS.rows) {
  try {
    if (!isArray2(value) || value.length > maximum || keysOf(value).length !== value.length + 1) return null;
    let result = [], seen = create2(null), bytes = 512;
    for (let index = 0; index < value.length; index++) {
      let item = own2(value, index);
      if (!item || !hasOwn2(item, "value")) return null;
      let row = fields(item.value, ["operation", "techniqueId", "phase", "value"]);
      if (!row) return null;
      let definition = apiResultDefinition(row.operation), phase = row.phase;
      if (!definition || row.techniqueId !== definition.techniqueId || phase !== "returned-sync" && phase !== "threw-sync" && phase !== "settlement-unobserved") return null;
      let preview = readValue(row.value);
      if (!preview || phase !== "threw-sync" && definition.asynchronous !== (phase === "settlement-unobserved") || !definition.asynchronous && preview.kind === "unobserved" && preview.reason === "async" || phase === "threw-sync" && (preview.kind !== "unobserved" || preview.reason !== "exception") || phase !== "threw-sync" && preview.kind === "unobserved" && preview.reason === "exception" || phase !== "threw-sync" && definition.sensitive && (preview.kind !== "unobserved" || preview.reason !== "sensitive") || preview.kind === "webrtc" && (phase !== "returned-sync" || preview.profile !== rtcValueProfile(definition.operation) || preview.source !== rtcValueSource(definition.operation)) || phase !== "threw-sync" && definition.typeOnly && preview.kind !== "webrtc" && (preview.kind !== "unobserved" || preview.reason !== "unsupported") || preview.kind === "number-array" && !definition.numericVector || phase === "settlement-unobserved" && !definition.sensitive && (preview.kind !== "unobserved" || preview.reason !== "async")) return null;
      let key2 = definition.operation + ":" + phase;
      if (seen[key2]) return null;
      seen[key2] = !0;
      let entry = { operation: definition.operation, techniqueId: definition.techniqueId, phase, value: preview };
      if (bytes += apiResultEntryBytes(entry), bytes > API_RESULTS_LIMITS.bytes) return null;
      define2(result, index, { __proto__: null, value: entry, enumerable: !0, configurable: !0, writable: !0 });
    }
    return result;
  } catch {
    return null;
  }
}
function readApiResultsUiRequest(value) {
  try {
    let record2 = fields(value, ["schemaVersion", "type", "tabId", "frameId", "documentKey"]);
    return !record2 || record2.schemaVersion !== 1 || record2.type !== "ui-api-results" || !nonNegative(record2.tabId) || !nonNegative(record2.frameId) || typeof record2.documentKey != "string" || !apply4(test3, DOCUMENT, [record2.documentKey]) ? null : { schemaVersion: 1, type: "ui-api-results", tabId: record2.tabId, frameId: record2.frameId, documentKey: record2.documentKey };
  } catch {
    return null;
  }
}
function readApiResultsCache(value) {
  try {
    let record2 = fields(value, ["schemaVersion", "type", "available", "epoch", "rows", "truncated"]);
    if (!record2 || record2.schemaVersion !== 1 || record2.type !== "api-results-cache" || typeof record2.available != "boolean" || !nonNegative(record2.epoch) || typeof record2.truncated != "boolean") return null;
    let rows = readApiResultEntries(record2.rows);
    return !rows || !record2.available && rows.length > 0 ? null : { schemaVersion: 1, type: "api-results-cache", available: record2.available, epoch: record2.epoch, rows, truncated: record2.truncated };
  } catch {
    return null;
  }
}

// packages/attribution/src/psl-index.json
var psl_index_default = { sha256: "4b673689999dbaca60b93fa3e1da5752505ef9717b1c4dc44acbfdafd35679ea", rules: [`0:a00trk9--nx
2:27qjf--nx
2:e9ebgn--nx
2:nbb0c7abgm--nx
1:12oa08--nx
2:apg6qpcbgm--nx
2:hbbgm--nx
2:rdceqa08--nx
1:28ugbgm--nx
2:eyh3la2ckx--nx
2:qbd9--nx
1:32wqq1--nx
2:60a0y8--nx
1:4x1d77xrck--nx
1:61f4a3abgm--nx
2:2yqyn--nx
2:5b06t--nx
2:axq--nx
2:ec7q--nx
2:lbgw--nx
1:883xnn--nx
1:9d2c24--nx
1:aa
2:it
1:b
2:.gro
3:lim
3:moc
3:sr
3:ten
3:ude
3:vog
3:yldnerb.pohs
2:abila
2:c
2:ihsot
2:m
2:n
1:c
2:.ba
4:m
4:n
3:cb
4:g
4:q
3:dino
3:ep
3:fn
3:ks
4:y
3:ln
3:no
3:oc
3:pi-on
4:ohsdaerpsym
3:sn
3:tn
3:un
3:vedwa.*
3:xob
3:ysrab
2:ima
3:rfa
3:sroc
1:dats
2:neit
3:oh
2:om
2:sa
2:tl
1:eg
1:fc
2:ob
1:g
2:emo
2:naripi
2:oy
1:hskihs
1:idem
5:.remarf
2:hs
2:k
3:on
2:sa
4:.nomead
5:snduolc
5:xid
1:jnin
1:kaso
2:dov
2:ede
2:usto
1:l
2:.gro
3:moc
3:ofni
3:rep
4:nb
3:ten
4:ni
3:ude
3:vog
2:irgnahs
2:lenisiuc
4:rbmuder
1:m
2:.ca
3:gro
3:oc
3:sserp
3:ten
3:vog
2:ahokoy
2:e00sf7vqn--nx
2:m
1:n
2:.gro
3:moc
3:oc
3:ten
4:la
3:vog
2:av
2:is
2:olecrab
2:tea
1:p
2:.bog`, `3:ca
3:dem
4:ls
3:gni
4:ro
3:moc
5:n
3:oba
3:ten
3:ude
2:c
2:g7hyabgm--nx
2:ra
4:.461e
5:6pi
5:emoh
5:iru
5:nru
5:rdda-ni
5:siri
2:s
1:q
2:.eman
3:gro
3:hcs
3:lim
3:moc
3:ten
3:ude
3:vog
1:raz
2:emac
2:f4a3abgm--nx
2:n
3:d5uhf8le58r4w--nx
2:ukas
1:s
2:.bup
3:dem
3:gro
3:hcs
3:moc
3:ten
3:ude
3:vog
2:ac
4:.uban.iu
2:iv
1:tad
2:elhta
2:led
2:oyot
1:u
2:.acinniv
4:emirc
4:ihzhziropaz
5:stynniv
5:ttaprakaz
4:sedo
5:sedo
4:tlay
4:vatlop
3:bs
3:cc
3:dargovorik
4:o
5:roghzu
7:hhzu
4:tl
3:ehzhziropaz
4:nvir
4:t
3:fi
4:ni
3:gl
4:ro
3:hk
3:istvinrehc
4:ykstynlemhk
10:vypork
3:kc
4:m
4:snagul
7:hul
5:tenod
6:ul
5:viknarf-onavi
6:orteporpend
14:ind
3:liponret
4:opotsabes
10:ves
4:p
3:mk
4:oc
4:s
4:yrk
3:nc
4:d
4:i
4:osrehk
4:v
4:ylov
3:oc
4:nvor
3:pd
4:p
4:z
3:rc
4:imotihz
4:k
4:ymotyhz
3:sk
3:ten
4:l
4:z
3:ude
3:v
4:c
4:ealokin
5:ik
4:ialokym
5:hinrehc
5:krahk
5:vl
5:yk
4:k
4:l`, `4:og
6:inrehc
5:krahk
4:r
3:xc
3:yikstinlemhk
4:mus
4:sakrehc
5:sakrehc
5:tvonrehc
3:zib
4:u
1:v
2:aj
2:bb
2:et
2:iv
1:waniko
1:xa
2:iacal
1:yogan
1:z.bew
3:ca
4:in
5:rga
3:gro
3:lim
4:oohcs
3:mon
4:t
3:oc
4:gn
3:radnorg
3:sin
3:ten
4:la
3:ude
3:vog
3:wal
2:zip
5:.korgn
0:b00ave5a9iabgm--nx
1:125qhx--nx
2:68quv--nx
2:e2kc1--nx
1:2xtbgm--nx
1:3b2kcc--nx
2:jca1d--nx
1:461rfz--nx
3:qif--nx
2:96rzc--nx
1:88uvor--nx
1:a0dc4xbgm--nx
2:c
2:her
2:n
2:ra
2:t
1:b
2:.erots
3:gro
3:moc
3:oc
4:fni
3:ten
3:ude
3:vog
4:t
3:zib
2:a
1:cj
2:s
1:dhesa08--nx
2:mi
1:ew
1:g
1:l
2:.gro
3:moc
3:ten
3:ude
3:vog
2:m
1:s
2:.gro
3:moc
3:ten
3:ude
3:vog
1:tc-retarebsnegmrev--nx
1:ulc
4:.elej
5:snduolc
5:ysrab
4:smas
2:p
3:.di.*
4:nik.*
4:ysrab
1:wp-gnutarebsnegmrev--nx
0:c11q54--nx
2:hbgw--nx
1:2e9c2czf--nx
1:44ub1km--nx
2:a1e--nx
2:byj9q--nx
2:erd5a9b1kcb--nx
1:84xx2g--nx
2:c9jrb2h--nx
1:9jrb2h--nx
5:54--nx
5:9s--nx
4:ceg--nx
5:h3--nx
5:s2--nx
1:a
2:.gro
3:hcs
3:kcabdeef
3:lim
3:moc
3:rrd
3:smrof
3:ten
3:ude
3:vog
2:3a09--nx
10:.ca1o--nx`, `11:gva1c--nx
11:hca1o--nx
12:za09--nx
11:ta1d--nx
11:ua08--nx
1:ba
2:b
2:ci
2:f76a0c7ylqbgm--nx
2:sh
1:c
2:.ce
3:eugaelysatnaf
4:zyrs
3:gnipparcs
3:ku
3:liamwt
3:nwaps.secnatsni
3:pi-duolc
3:revres-emag
3:snduolc
4:otohpym
4:pparevelc
4:seccaptf
4:u
3:ue
4:g
4:wcc
3:xsc
2:0atf7b45--nx
2:a1l--nx
1:e
2:.21k
3:apc
3:bog
4:up
3:cisp
4:od
3:dem
3:esab
4:uc
4:yg
3:fehc
4:orp
3:gba
4:ne
4:ro
4:tkm
3:hcet
3:jol
3:lag
5:iciffo
5:s
4:im
4:ut
3:mda
4:oc
4:se
3:ngd
4:if
4:om
5:rga
3:ocsid
4:fni
4:ir
5:u
4:rp
3:pprr
3:qisp
3:rab
4:bi
4:tn
4:ut
3:tal
4:en
5:v
4:ned
5:oc
6:do
4:of
4:qra
4:ra
3:ude
3:vog
3:xxx
2:beuq
2:n
2:smoc
1:fdh
1:ilohtac
2:nagro
3:ilc
3:osanap
2:sum
2:tic
1:l
2:.gro
3:moc
3:oc
3:ten
3:ude
3:vog
3:yo
2:l
1:m
2:.mt
3:ossa
2:p1akcq--nx
1:n
2:.mon
3:ossa
2:i
2:p
1:relcel
1:s
2:.gro
3:moc
3:ten
3:ude
3:vog
1:t
2:s
2:w
1:v
2:.e0.*
3:gro
3:lim
3:moc`, `3:sndym
3:ten
3:ude
3:vg
5:.d
4:og
1:wp
1:yn
0:d2urzc--nx
1:31wrpk--nx
2:c4b11--nx
3:9jrcpf--nx
1:5xq55--nx
1:697uto--nx
1:75yrpk--nx
1:9ctdvkce--nx
1:a
2:d
2:er
2:olnwod
1:b
2:.ca
3:di
3:gro
3:hcs
3:ia
3:lim
3:moc
3:oc
4:fni
3:ten
4:i
3:ude
3:vog
4:t
2:2babgm--nx
1:c
2:.cc
3:vog
2:g9a2g2b0ae0chclc--nx
1:em
3:bulc
2:r
3:k
2:sopxe
2:timil
2:w
1:fc
1:g
2:.ude
3:vog
1:hd3tbgm--nx
2:p
2:t
1:i
2:.ased
3:bew
3:ca
3:e
4:noz
3:hcs
3:ia
3:lim
3:oc
4:g
3:pok
3:ro
3:sepnop
3:ten
3:ykft9--nx
4:m
3:zib
2:b
2:ordna
2:p
2:rdam
1:liub
5:.0v
6:frusdniw
6:yadotpihs
2:og
2:row
1:m
2:.ri
1:nab
3:l
4:raas
2:ob
2:uf
1:oof
2:rp
1:ractiderc
4:yalcrab
3:ugnav
2:ef506w4b--nx
2:k
3:.oc
4:ude
3:jh3a1habgm--nx
2:of
1:s
2:.dem
3:gro
3:moc
3:ofni
3:ten
3:ude
3:vog
4:t
2:m
3:kcrem
1:t
2:excwkcc--nx
2:l
1:uolc
5:.2k.3s
9:bps-ur.3s
16:bl
16:etisbew
9:citsale
9:etisbew
9:ksm-ur.3s
16:bl
16:etisbew
6:abura-vnej.1ti
17:abura.rue.1ti
7:tcepsrep
7:xo`, `9:.ku
10:nt
6:baltam
7:dnevar
7:ewilek
13:.sc
6:citsalej.piv
6:drayknil
6:elej
7:mohsnd
7:tisotnegam.*
8:oj
6:gnitsohdnert.ed
19:hc
6:letemirp
14:.ku
8:varal
6:medaid
7:ialcer.ac
14:ku
14:su
6:ndctegeb.*
7:evueluk
7:woru
6:paz
6:qhelbavresbo
6:rehcnar-no.*
8:polroov
8:vres-enilno
7:gtsh
7:opav
8:tnemele
6:scitats.*
7:ecivres-nosinu
6:tenraxa.1-se
7:ikcatsno.snur
7:lobevres
7:negreme
7:sinogatna
6:ululetoj
6:wcs.gnilebaltrams
10:koobelacs
10:latemerab.1-rap-rf
22:sma-ln
20:2-rap-rf
10:rap-rf.3s
17:bdgm
19:r
17:cnf
20:.snoitcnuf
17:etisbew-3s
17:hwtd
17:kfak
17:lbcs
18:dd
17:mhw
17:rfi
17:s8k
20:.sedon
17:tipkcoc
10:s8k
11:ecnatsni.bup
20:virp
11:ma-ln.3s
17:bdgm
19:r
17:etisbew-3s
17:hwtd
17:kfak
17:lbcs
18:dd
17:mhw
17:rfi
17:s8k
20:.sedon
17:tipkcoc
10:waw-lp.3s
17:bdgm
19:r
17:etisbew-3s
17:hwtd
17:kfak
17:lbcs
18:dd
17:rfi
17:s8k
20:.sedon
17:tipkcoc
6:xelpciffart
8:vnoc
12:.1-tsae-su
17:ew-ue
6:yawocne.ue
1:za5cbgn--nx
0:e153wlf--nx
2:7a1hbbgm--nx
2:ta3kg--nx
1:2a6a1b6b1i--nx
1:3ma0e1cvr--nx
1:418txh--nx
1:707b0e3--nx
1:a
2:.ca
3:gro
3:hcs
3:lim
3:oc
3:ten
3:vog
2:09--nx
1:b
2:.ca
3:etisbew321
3:gnitsohbew
3:lrusnart.*
3:nevueluk.yxorpze
3:pohsdaerpsym
3:snduolc
5:oitulostsohretni.duolc
3:ym
2:ortal
2:ut
4:uoy
1:c0krbd4--nx
12:.a2qbd8--nx
13:b8adbeh--nx
13:c6ytdgbd4--nx
13:d8lhbd5--nx`, `2:alp
5:.oc
3:ps
5:.fh
8:.citats
6:lla4sx
6:rebu
6:sonoi-ppa
6:tcejorp
7:negayolped
7:safym
8:ohebiv
6:uyieh
5:artxe
3:sla
2:i
3:ffo
2:nad
4:iler
4:nif
4:rusni
9:efil
9:srelevart
3:eics
2:rofria
1:d
2:.1sndnyd
3:42pi-nyd
4:6emoh
5:vpi
3:7erauqs
3:amil4
3:bow-nrefeilgitsng--nx
4:rb-ni
4:ur
4:vz-nelletsebgitsng--nx
3:cessndd
9:nyd
3:decalpb
3:ecnatsni-so-duolcwb.*
4:daregtmueart
4:luhcsvresi
4:mohsnd
4:nihcamyek
4:tiesbew321
3:gifnocecapsbew
3:hcierebsnoissuksid
3:kcodluhcs
4:eegnietsi
3:lsd-ni
3:moc
4:rofttalpluhcs
4:uhcob-inu-rhur
18:.con.oi
3:n-i-g-o-l
4:esgnutiel
4:iemtsi
5:lreb-ni
11:yd
4:norblieh-sh.ti.hcraeser-segap
19:segap
4:pv-ni
3:oc
4:rp-ytinummoc
3:ph21
4:iog
7:ol
4:ohsdaerpsym
3:rentrapdeeps.remotsuc
5:su-lautriv
7:lautriv
5:tadpusnd
6:tub-ni
6:uor-ym
5:vres-ebucl
11:mohym
9:bew-emoh
17:.nyd
9:luhcs
3:snd-nufiat
7:sehcsimanyd
7:tenretni
6:isoc.nyd
6:mieh
6:ps
6:vrs
4:oper-nvs
9:tig
4:sndd
8:.nyd
9:sndnyd
3:tcennocnonex.*
3:vresi-niem
9:tset
3:xi2
3:yawetag-llawerif
11:ym
4:ksurf.*
4:m
4:srab
4:tic-amil
3:ztenmitbel
7:sadtretteuf
2:art
2:isdoow
3:ug
2:on--nx
1:e
2:.bil
3:dem
3:eif
3:gro
3:irp
3:kiir
3:moc
3:pia
3:ude
3:vog
2:ei
2:ffoc
2:gg
2:rf
3:ged
1:fac
3:s
2:il
1:g
2:.byc`, `3:cll
3:enilno
3:gro
3:loohcs
3:moc
3:ten
4:vp
3:ude
3:vog
3:xnt
2:af
3:gtrom
3:p
4:.grebedoc
5:kselp
5:mea
5:sndp
6:ruelfxued
5:tsohcitats
5:wolfyeh
5:xlh
6:obym
5:ycvrp
6:kcor
3:rots
3:yov
2:elloc
2:nahcxe
4:ro
6:.hcet
2:roeg
2:ug
1:i
2:.pohsdaerpsym
3:vog
2:tilop
2:vbba
3:om
1:j
2:.fo
3:gro
3:oc
3:ten
1:k
2:.ca
4:s
3:em
4:n
3:ibom
3:oc
4:fni
4:g
3:ro
2:ib
3:l
3:n
1:ladmrif
3:s
4:rof
2:ba
3:ib
4:dua
2:caro
3:ric
2:dnik
2:g
3:oog
2:ibom
3:ms
2:lasal
3:erauqa
2:ppa
5:.tni
9:.duolc.*
16:r.*
18:1-htron-pa.*
26:ue.*
22:uos-pa.*
20:lartnec-su.*
28:ue.*
20:tsae-su.*
22:ew-su.*
18:2-htuos-pa.*
20:lartnec-su.*
20:tsae-su.*
22:ew-su.*
18:3-tsew-su.*
2:uhcs
2:yts
5:efil
1:m
2:.432i
4:pct
5:v
3:66c
3:ailisarb
3:ca
4:ooh.xorpes
3:duolcnepo
8:sd
3:gro
4:s-raegelif
3:kcatsegde
4:org
3:noitatsksid
3:oc
4:tnigol
5:poh
3:pion
5:snart.etis
4:ohbew
3:raegelif
4:idcm
4:ofsnd
3:sdym
4:ndd
4:ti
4:umhol
3:ten
4:farc
4:sacdnuos
5:ohon
3:ude
3:virp
4:og
3:xobym
3:ygolonys
4:srab`, `2:ag
3:n
4:.citeneek
5:reganampsi
7:h.togrof
5:sih.togrof
2:em
2:irp
2:orhc
2:w
1:n
2:goloc
2:ilno
6:.egats-oree
7:koob
7:llecpael
7:oree
7:redliubetisbew
7:sndmieh
7:ysrab
3:w
2:o
3:.ecivres
5:tisbew
4:nik.*
3:hp
3:latipac
3:tsegdirb
6:rif
3:z
4:.amil
5:notirt.*
5:sporez-1grp
11:.*
5:tikcats
2:ruoblem
1:om
1:p
2:.bog
3:gro
3:lim
3:moc
5:n
3:ten
3:ude
2:irg
2:yks
1:r
2:.bilten
3:moc
3:nac
3:ossa
2:ac
4:htlaeh
3:pmoc
3:wtfos
2:bc
2:eh
2:if
2:ots
5:.erawpohs
7:saberots
6:yflles
7:srab
2:taeht
2:uces
3:sni
3:tinruf
4:necca
3:za
1:s
2:.a
4:disnim321
3:b
4:ibnal
4:rofmok
3:c
4:a
3:d
4:b
4:narb
5:ubroflanummok
3:e
3:f
3:g
4:ro
3:h
4:f
3:i
4:trap
3:k
4:shf
3:l
3:m
4:oc
4:t
3:n
4:mygskurbrutan
3:o
3:p
4:ohsdaerpsym
4:p
3:r
4:owebdluocti
3:s
4:serp
4:yspoi
3:t
3:u
3:vhf
3:w
3:x
4:uvmok
3:y
3:z
2:ac
4:.vas
3:el
3:hc
2:ier
3:urc
2:nesemoh
2:roh
2:uoh
1:tad
3:tse
6:.etupmoc.*
6:laer`, `5:lla
2:is
4:.amgif
6:reduolc.*
6:vnac.ym
5:bewwuoj
5:derauqspw
5:edocyalp
6:lej
6:nieffac
8:lnigol
6:rauqs
7:ocevon
6:winmo
5:hsmroftalp.*
5:laicosnepo
6:enapc
6:os
5:neyb
6:oiton
7:yc
5:oc
5:retup
5:sihtedam
6:pvtsaf
5:tfarcecruos
6:hrs
6:pgtahc
6:roppus
6:st.*
5:vog-amgif
5:wcs
8:.sma
9:waw
6:eiverp
6:olfyeh
5:xevnoc
11:.1-tsae-su
16:ew-ue
6:obeip
5:ysrab
4:bew
7:.remarf
2:ov
2:ra
2:tioled
3:ol
2:utitsni
1:ulb
2:qinilc
4:tuob
1:v
2:.21e
3:ai
3:bew
4:ib
4:og
3:cer
5:t
3:ednerpme
4:rots
3:gro
3:lim
3:moc
5:n
4:rif
3:oc
4:fni
3:rar
3:stra
3:ten
4:ni
3:ude
3:vog
2:as
2:e3gerb2h--nx
2:il
4:.mea
5:pwe.*
5:xlh
3:rd
3:ssergorp
2:ol
1:wkct--nx
2:r
1:xul
1:y
2:.gro
3:lim
3:moc
3:ten
3:ude
3:vog
0:f0f3rkcg--nx
1:198xim--nx
1:280xim--nx
1:7vqn--nx
1:a
2:.gro
3:moc
3:ten
3:ude
3:vog
1:b
2:.vog
2:wa9bgm--nx
1:c
2:a1p--nx
9:.a14--nx
10:b8lea1j--nx
10:cavc0aaa08--nx
11:ma09--nx
10:fa1a09--nx
11:ea1j--nx
10:gva1c--nx
10:nha1h--nx
10:pda1j--nx
10:zila1h--nx
2:ns
1:ea1j--nx
1:g
1:iam
1:la1d--nx
2:og
1:n
2:.bew
3:cer
3:erots`, `3:moc
4:rif
3:ofni
3:rehto
5:p
3:stra
3:ten
1:orp
1:p
2:.gro
3:moc
3:ude
1:rus
1:t
2:.hcs
2:w
3:.sndd
1:w
2:.hcs
3:zib
0:g24wq55--nx
2:8zrf6--nx
1:344sd3--nx
2:91w6j--nx
11:.a5wqmg--nx
12:d22svcw--nx
13:5xq55--nx
12:gla0do--nx
12:m1qtxm--nx
12:vta0cu--nx
1:455ses--nx
1:5mzt5--nx
1:69vqhr--nx
1:78a4d5a4prebgm--nx
2:rb2c--nx
1:a
2:.gro
3:jbo
3:moc
5:n
3:oc
3:ten
2:vd
1:b
2:.0
3:1
3:2
3:3
3:4
3:5
3:6
3:7
3:8
3:9
3:a
3:b
3:c
3:d
3:e
3:f
3:g
3:h
3:i
3:j
3:k
3:l
3:m
3:n
3:o
3:p
3:q
3:r
3:s
3:t
3:u
3:v
3:w
3:x
3:y
4:srab
3:z
1:c
2:b
2:za9a0cbgm--nx
1:e
2:.ca
3:em
5:an
3:gro
3:ics
3:lim
3:moc
3:nue
3:ofni
3:ten
4:rops
3:ude
3:vog
4:t
2:a
1:g
2:.gro
3:hsadtob
3:lenap
8:.nomead
3:oc
3:saak
3:ten
4:ikcats
3:ylp.6d
7:ta.*
1:ia
2:v
1:k
2:.ea
3:gro
3:lim
3:moc
3:su
3:ten
3:ude
3:vog
3:xx
1:m
2:.drp
3:gro
3:lim
3:moc`, `5:n
3:oc
3:ude
3:vog
2:pk
1:n
2:.clp
3:dtl
3:eman
3:gro
3:hcs
3:i
4:bom
3:lim
4:oc
3:moc
4:rif
3:neg
3:ogn
3:ten
3:ude
3:vog
3:zib
6:.gl
7:ld
7:no
7:oc
8:g
2:aw
2:i
3:b
4:mulp
3:car
3:dart
4:dew
3:hsif
4:tolc
3:kiv
4:oob
6:c
3:ls
3:naelc
4:iart
3:p
4:pohs
3:reenigne
5:tac
3:tad
4:ekram
4:hgil
4:lusnoc
4:neg
4:ov
4:soh
7:.tfarcnepo
3:vig
5:l
2:o
3:s
2:urehcisrev
3:smas
1:od
2:lb
2:og
4:.duolc
5:etalsnart
5:tnetnocresu.*
1:p.*
1:r2n084qlj--nx
2:ebmoolb
2:o
3:.77ndc.c
11:sr
4:aremacytirucesym
5:tneimip
6:sivretla
5:xor
5:z
4:bew-llams
4:cimanyd-pi
4:dab-yrev-si
5:esufnocsim
6:vas-si
5:nuof-si
5:oog-yrev-si
5:uolcarfniarodef
9:ehtgnituor
9:mw
11:.ateb
4:ea
5:cin-yrev-si
5:grofloot
9:peh
5:las-4-ffuts
6:poeparodef
5:m-morf
6:agevres
6:ohruoyslles
5:nozdop
5:rehwongniogyldlob
6:iwym
6:uces-77ndc.nigiro.lss
5:tadidnac-a-si
6:is-ybboh
8:golb
4:fehc-a-si
4:golbymdaer
4:keeg-a-si
10:si
5:h
5:nut
4:lacol-si
5:iamwt
6:ve-yrev-si
5:lawerif-ym
12:ym
5:sd-ni
4:macssecca
5:edom-elbac
4:nafblm
7:cfu
7:egelloc
7:lfn
7:scitlec-a-si
8:niurb-a-si
8:tap-a-si
7:xos-a-si
5:ibptth`, `5:orviop
5:pj
6:v-ni
4:ojodsnd
5:tpaz
7:oh
4:pi-on
6:fles
5:ohbew
6:tksedeerf
5:tfemoh
8:vres
7:ym
4:regatop
6:ppepteews
6:su-xunil-a-si
5:vdmac
4:sailanyd
9:snd
6:nymsd
5:balfmw
6:bevres
5:dikcet.3s
6:ylimaf
5:egapsf
6:irfotatophcuoc
5:j
5:koob-daer
5:ltbup
5:nd-won
7:deerf
7:emoh
7:golb
7:kcud
7:mood
7:nyd
10:.emoh
11:og
7:pd
8:s
7:rvd
7:tog
7:uolc
5:sa-skcik
6:ndd
5:tnemhcattaomb
5:u
4:tcejorparodef.duolc
18:gts.so.ppa
18:so.ppa
7:riderbew
5:eews-yrev-si
6:nretniehtfodne
12:fodne
5:hgink-a-si
5:sixetnod
11:seod
6:oh-emag
7:l-si
4:ue
6:.ac
7:dc
7:eb
8:d
8:e
8:i
8:m
8:s
7:gb
8:n
7:hc
7:if
8:s
7:kd
8:m
8:s
8:u
7:la
8:i
8:n
8:p
7:nc
8:i
7:on
8:r
8:ssa
7:pj
7:rf
8:g
8:h
8:k
8:t
7:se
8:i
8:u
7:ta
8:en
8:i
8:l
8:m
8:ni
8:p
7:ua
8:de
8:h
8:l
8:r
7:vl
7:yc
8:m
7:zc
8:n
4:vresnyd
4:xinuemoh
5:unilemoh
4:ylimafxut
5:raidanetah
5:srab
2:ubmah
4:oj
1:s
2:.delacsne
3:gro
3:moc
3:ten
3:ude
3:vog
2:gb639j43us5--nx`, `1:t
1:u
2:.ca
4:s
3:en
3:gro
3:lim
3:moc
3:oc
4:g
3:ro
3:su
3:ude
3:vog
1:v
2:.ude
2:a1c--nx
1:wsa08--nx
0:h0ee5a3ld2ckx--nx
1:4wc3o--nx
10:.a2xyc3o--nx
12:3j0hc3m--nx
12:ve4b3c0oc21--nx
11:id1kzuc3h--nx
11:l8bxi8ifc21--nx
11:rb0ef1c21--nx
1:88yvfe--nx
2:a7maabgm--nx
1:b
2:.gro
3:moc
3:ten
3:ude
3:vog
2:mg
1:c
2:.7erauqs
3:amil4
3:duolc-drayknil
3:egarotstcejbo.amr
17:gpl
4:lacsduolc.amr.stcejbo
14:gpl.stcejbo
14:tsuc
4:tisbew321
3:gniksnd
3:ph21
4:ohsdaerpsym
3:sndtog
6:uolc
3:tenerif.*
11:cvs.*
3:wolf.ea.1pla
9:nigneppa
3:xi2
3:ytic-amil
2:aoc
2:et
4:.spparevelc
2:ir
4:euz
2:raes
3:uhc
2:sob
2:taw
5:s
1:d0sbgp--nx
1:f2lpbgm--nx
2:k
1:g
2:.gro
3:lim
3:moc
3:ten
3:ude
3:vog
3:zib
1:k
2:.gro
3:moc
3:ten
3:ude
3:vog
1:m
2:a1j--nx
1:ocir
1:p
2:.gro
3:i
3:lim
3:moc
3:ogn
3:snduolc
3:ten
3:ude
3:vog
1:s
2:.adtob
3:elbavol
3:gnabhsah
4:ro
3:lim
3:moc
4:roftalp.su
12:tne
12:ue
3:ten
4:ropelet
3:vog
3:won
2:ac
3:nom
2:id
3:f
3:ri
1:t
2:.ca
3:enilno
3:im
3:ni
3:oc
4:g
3:pohs
3:ro
3:ten
2:iaf
2:laeh
6:.arh`, `2:orxer
2:rae
1:vo
3:.lopdren
1:zb
0:i3tupk--nx
1:7a0oi--nx
1:a
2:.ffo
3:gro
3:moc
3:remarf
3:sppaolik
3:ten
3:uwu
2:1p--nx
2:bud
2:dnuyh
2:tnihc
1:b
2:.gro
3:moc
3:oc
3:ro
3:ude
2:ahduba
2:o
3:m
4:.duolcsd
5:ysrab
2:s
1:c
2:.ayb-tropora--nx
3:ca
3:de
3:gro
3:moc
3:oc
4:g
4:ssa
3:ro
3:su
3:ten
4:ni
3:ude
3:vuog
2:cug
2:t
1:ddk
2:ua
1:ebhf--nx
2:piat
1:f
2:.aw5-nenikkh--nx
3:dnala
3:iki
4:spak
3:mroftalpduolc.if
3:pohsdaerpsym
3:uvisitok321
3:yd
2:onas
1:g
2:.dom
4:tl
3:gro
3:moc
3:ude
3:vog
1:hcatih
3:ra
2:sabodoy
3:ibustim
1:juohs
1:k
2:.gro
3:moc
3:ofni
3:ten
3:ude
3:vog
3:zib
2:b4gc--nx
2:iw
4:.remarf
2:nisleh
2:s
2:uzus
1:l
2:drahcir
2:iamsi
1:maim
1:n
2:.bew
4:og
3:ca
3:gro
3:lim
3:moc
5:n
3:ni
3:oc
4:fni
3:ten
4:ni
3:ude
3:zib
2:airpic
2:ihgrobmal
3:m
2:re
1:om
1:rarref
1:s
2:.5f
3:egaptig
3:ppatig
2:ed
1:tic
3:nifni
2:rahb
1:ut
1:v
2:.21k
3:gro
3:moc
3:oc
3:ten`, `1:wik
1:xarp
3:t
1:yf
0:j6pqgza9iabgm--nx
1:8da1tabbgl--nx
1:b
2:.acirfa
3:eto
3:gro
3:moc
4:siruot
3:oc
5:e
4:fni
4:noce
4:rga
4:tser
3:russa
3:setcetihcra
4:risiol
4:tacova
3:ten
4:naruatser
3:ude
3:vinu
3:yenom
1:d
1:f
2:.ca
3:di
3:eman
3:gro
3:lim
3:moc
3:ofni
4:rp
3:ten
3:ude
3:vog
3:zib
1:nj
1:s
1:t
2:.bew
3:cin
3:eman
3:gro
3:lim
3:moc
3:oc
4:g
3:ten
4:ni
4:set
3:ude
3:vog
3:zib
1:yqx94qit--nx
0:k8uxp3--nx
1:924tcf--nx
1:arfel
1:c.*
3:www!
2:abdeef
3:lb
2:ebdnul
2:ilc
2:rem
5:e
1:d
2:.edisemmejh321
4:rots
3:ger
3:mrif
3:oc
3:pohsdaerpsym
3:zib
2:t
1:ees
2:samet
1:f.*
1:h
2:.a4ya0cu--nx
4:5wqmg--nx
3:b3qa0do--nx
3:cni
3:d22svcw--nx
5:3rvcl--nx
4:5xq55--nx
4:tl
3:ga0nt--nx
4:la0do--nx
4:ro
3:i050qmg--nx
4:7a0oi--nx
4:xa0km--nx
3:m1qtxm--nx
4:oc
3:npqic--nx
3:ten
3:ude
3:vdi
4:og
4:ta0cu--nx
3:xva0fz--nx
2:n
1:itsob
2:vdnas
1:l
2:.bew
3:ca
4:os
3:dtl
3:gro
3:hcs
3:letoh
3:moc
3:nssa
3:ogn
3:prg
3:ten
4:ni
3:ude
3:vog
2:at
2:cd
2:is`, `1:m
2:.eman
3:fni
3:gro
3:moc
3:ten
3:ude
3:vog
1:nab
4:cfdh
4:etats
4:mmoc
4:ten
5:fos
4:u
2:i
3:l
4:.ahcarots.sfpi
6:vnac
5:bewd.*
5:citeneek
6:mnioj
5:egarotstfn.sfpi
5:hte.*
5:noyc
5:pepym
5:resworbni.*
5:s3w.sfpi
5:ztirfym
3:p
1:oob
1:p
2:.bew
4:og
3:ca
3:gog
4:ro
3:kog
3:maf
4:oc
3:pkg
4:og
3:sog
3:ten
3:ude
3:vog
3:zib
1:row
4:.retup
5:yxorp-enigami
4:ten
7:.etirwppa
8:htumiza
8:mea
8:nolt
8:oc
9:vra
8:secla.*
1:s
2:.gro
1:t
1:u
2:.ca
4:lp
3:dtl
3:ecilop
4:m
4:tismin
3:gro
6:.gul
10:g
7:sgul
7:yrettolylkeew
15:tiniffa
9:tneelffar
3:hcs.*
3:lenap-tnednepedni
3:nnoc
4:oissimmoc-layor
14:tnednepedni
3:oc
5:.bunsorter.tsuc
6:enilnoysrab
6:omida
6:pi-on
7:ohsdaerpsym
6:tfihsreyal.j
6:vres-hn
6:ysrab
4:rpoc
3:psoh
3:shn
4:ppaduolcvogelcaro.*
3:ten
4:nmyp
4:seuqni-tnednepedni
3:vog
6:.ecivres
7:ipa
7:ngiapmac
3:weiver-tnednepedni
3:yriuqni-cilbup
11:tnednepedni
4:srab
0:l04sr4w--nx
1:a
2:.gro
3:lim
3:moc
3:ten
3:ude
3:vog
2:bolg
6:.etirwppa
2:c
2:ed
2:g
3:el
2:icnanif
9:.oc
9:lpl
4:os
3:romem
3:tnedurp
2:nif
3:oitanretni
2:tigid
4:pac`, `5:soh
3:ned
3:ot
1:c
2:.bog
3:lim
3:oc
3:snduolc
3:vog
1:dil
1:edatic
2:nahc
3:nahc
7:rehtaew
2:t
3:oh
3:ria
3:tam
2:vart
1:f8fpbgo--nx
4:tbgm--nx
2:a
2:n
1:g
2:.gro
3:moc
3:oc
3:ten
3:ude
1:hd
2:op
1:i
2:.21k
3:ca
3:fdi
3:gro
3:inum
3:oc
5:.egapvar
6:redrotibat
6:tibatym
3:ten
3:vog
2:af
3:me
5:.hcuotni
6:kwat.p
6:otkwat.p
4:g
4:toh
2:m
2:r
1:labesab
4:teksab
10:.sua
11:zn
5:oof
3:c
3:mt
2:ed
3:hs
2:ihmailliw
2:j
1:m
2:.ca
3:esserp
3:gro
3:moc
3:ofni
4:ssa
3:rp
3:ten
4:ra
4:sni
3:ude
3:vog
4:uog
1:n
2:.etisbew321
3:lrusnart.*
3:nomed
5:rtsic
3:oc
3:pohsdaerpsym
3:retsulc-gnitsoh
3:vog
3:yalphk
2:o
1:oa
2:btuf
2:l
3:.gmo
2:oc
4:.ed
5:rotnemele
3:hcs
2:rit
2:u
1:p
2:.2uoy
3:acindiws
7:gel
4:dg
5:ortso
5:urawon
4:idem
5:mraw
5:nydg
4:keloguld
8:rtso
5:slopolam
5:tsu
5:ytsyrut
4:lip
5:okzs
6:w-awolats
7:oksnok
4:mrifd
4:nerapohs
5:img
5:zcel
4:rog-aibab
10:nelej
7:j
7:z
4:syn
4:tsaim
4:waleib`, `7:i
7:o
6:zsraw
5:onamil
6:tainop
4:zeiwolaib
5:mol
3:ceiwalselob
7:onsos
8:rtso
5:leim
7:zrogz
4:orw
4:p
3:dem
4:ia
4:ragrats
4:uolcinu
8:sds
3:ecilrog
6:naibap
6:weinreiks
7:ilg
7:ohcarats
10:orp
8:klop
8:tak
5:yzreibok
4:icsjuoniws
5:ksromop
5:saldop
4:lahdop
5:opo
4:napokaz
4:tatselaer
5:iselpmis
4:zromop
5:swozam
3:galble
4:ezrbolok
9:nrat
4:ro
3:hcyzrblaw
3:icsomohcurein
4:grat
4:klawus
3:kcolp
4:erut
5:walcolw
4:inbyr
6:diws
6:sark
4:le
4:onas
5:tsylaib
4:robel
7:lam
4:sals
5:jazel
5:nadg
5:puls
5:rowezrp
3:lcolw
4:er
5:vart
4:iam
5:m
3:moc
5:dar
5:n
5:tyb
4:sg
5:iruot
4:t
5:a
3:nagaz
5:nzop
4:ibul
5:cezczs
5:lbul
5:molow
5:nok
5:zdeb
7:obeiws
4:uleiw
5:rot
4:ytzslo
5:zrtek
6:seic
3:oc
4:fni
4:kcelo
5:sleib
5:zdolk
4:lkan
4:nleim
5:pek
5:tuk
6:yzczs
5:zcopo
6:eing
6:rowaj
4:rga
4:tnokd
5:ua
4:wejarg
5:ogarm
3:peeb
5:lks
8:emoh
4:klwwortso
4:ohs
7:-ecremmoce
7:daerpsym
3:romophcaz
3:sklofc
4:os
3:taiwop
4:en
4:opos
4:ra
4:sezc
3:ude
3:virp
4:og
6:.aio
8:p
8:s`, `9:w
7:bnip
10:w
7:ci
7:dtiw
7:eko
8:ssp
10:w
7:fiw
7:gimu
8:u
7:hiiw
7:migu
8:rio
8:u
9:o
7:nds
10:ipz
7:oks
8:p
9:pu
8:s
8:wtsorats
7:pa
8:sp
10:mk
10:pk
10:wk
8:um
9:p
8:wk
8:z
7:rhcso
8:ksw
8:p
8:s
7:si
8:oiw
8:u
8:zu
7:talusnok
7:wgzr
8:ip
9:rg
9:w
8:m
8:oo
9:pu
8:u
9:imzw
7:zkw
8:ouw
3:walcorw
6:sizdow
5:w
4:ogolg
5:kark
6:ul
6:zsurp
5:raz
6:gew
5:trabul
6:sugua
5:zcoks
6:sezr
3:xes
3:ybuzsak
4:dazczseib
5:ikseb
4:hcyt
4:njes
5:lod-zreimizak
4:pal
4:rogt
5:uzam
4:walup
4:zutrak
3:zam-awar
4:caprak
5:iwol
5:zsogdyb
4:dalezc
6:reis
5:ol
4:ib
4:reigz
4:silak
6:p
5:uklo
2:l
1:ras
2:f
2:s
1:s
2:.gro
3:moc
3:ten
3:ude
3:vog
1:t
2:.vog
1:ubnatsi
1:x3b689qq6--nx
1:yc5rb54--nx
0:m00tsb3--nx
1:1qtxm--nx
1:981rvj--nx
1:a
2:.enummoc
3:gro
3:moc
3:oc
4:idar
3:ten
2:c
3:bew
2:dretsma
2:erts
3:t
4:.citsalej
5:esruocsid
2:fma
2:xq--nx
1:b
2:.gro
3:moc
3:ten
3:ude`, `3:vog
2:i
1:c
2:.moc
3:oc
3:ten
3:vog
1:d
2:.gro
3:moc
3:oc
3:ten
3:ude
3:vog
1:f
2:.gro
3:moc
3:oidar
3:resu.*
3:ten
3:ude
2:i
1:g
2:vu96d8syzf--nx
1:h
1:i
2:.ca
3:gro
3:moc
3:oc
5:.clp
6:dtl
3:ten
4:t
3:vt
2:k
2:rbg4--nx
1:j.*
1:k
2:.drp
3:erianiretev
4:sserp
3:gro
3:lim
3:moc
5:n
4:t
3:nicedem
3:ossa
3:pooc
3:seriaton
4:neicamrahp
4:sa
3:ude
3:vog
4:uog
1:lif
2:ohkcots
1:m.*
1:o
2:.dem
3:gro
3:moc
4:uesum
3:oc
4:rp
3:ten
3:ude
3:vog
2:b
2:c
3:.0x
4:121sesaila
5:dna1-sppa
4:2aq
4:3pmevres
4:ac-morf
6:irfa
5:g-morf
6:oy-sehcaet
5:i-morf
5:m-morf
6:all-a-si
9:amai
5:p-morf
6:c-a-si
5:remacytirucesym
5:s
5:tadtsudgniht
6:emta
5:v-morf
5:w-morf
5:z
4:bew-sndnyd
7:arukas
7:draiw.segap
7:ottad
4:camytirucesemoh
5:d-morf
5:esyrcs
5:itsalej.omed
5:n-morf
6:vym
5:pkroweht
6:ytirucesemoh
5:rievres
5:s-morf
4:daerotffuts
5:ebme-detsoh-avnac
6:calpb
6:ifitrec-si
14:ton-si
6:rewopenignepw
19:.sj
6:tsoh-scodehtdaer
10:2a
10:ecapsppa
5:i-morf
6:parpc
6:rgevissam.saap
5:m-morf
5:n-morf
6:abeht-htiw-si
5:om-vog-su-p3-naissalta.*
6:rpnonduolcwm
5:s-morf
5:uolc-noitatsyalp
10:revelc.secivres.*`, `9:ehtgnituor
9:hr
9:iafaw.dej
16:yr
9:meaeboda
17:.ved.*
9:nevia.*
9:panqym
15:-ahpla
16:ved
9:sanym
10:metsystuo
9:vedj
12:pw
5:vreser
5:wetomer
4:ebutuoyhtiw
5:capsylop
6:iffo-sndnyd
7:vedlootx
6:rofselas.mroftalp.gts-redliub-edoc.tset.100.*
5:d
6:-morf
6:oc.redliub-gts.*
17:ved.*
16:.*
8:avnac
8:elgoog
7:nil.recnalabedon.*
11:srebmem
8:neve.1-su
15:ue
13:2-su
15:ue
13:3-su
15:ue
13:4-su
15:ue
5:erf-sndnyd
8:sndd
5:filflahevres
5:garots-77ndc
6:de-yltsaf
6:nahcxeevres
6:rof-no
5:ihcet-a-si
6:p-sekil
5:kauqevres
6:irtsretnuocevres
5:lbitpa-no
6:googhtiw
5:magevres
6:ina-otni-si
6:oh-sndnyd
9:ta-sndnyd
5:n-morf
6:ilnoysrab
6:og-si
5:pacsledom
5:ralfduolcyrt
6:ehwynanohtyp
18:.ue
6:ihcec
5:srun-a-si
5:tinuarepo
7:s-ybboh
8:aloy
8:bew-evil
8:elpmis
8:rodabew
8:tipohs
8:xiw
6:omer-sndnyd
6:ysgolb
5:vals-elcibuc-a-si
6:itavresnoc-a-si
5:zamkcar
6:eelg
6:iig
4:fehc-a-si
4:gnigats-raeghtua
12:swennwot
7:ksndd
7:robsikrow
7:tsoh-bt.etis
11:edalbderiw
11:ovip
11:unyd
5:ofgp
6:lb-sndnyd
8:anetah
8:sihtsetirw
4:hn-morf
5:o-morf
4:ico-remotsuc.*
17:ico.*
17:pco.*
17:sco.*
5:fiwehtno
5:h-morf
5:kiw-sndnyd
5:m-morf
5:paerocne
6:detsoh
5:r-morf
5:w-morf
5:zihcppa
6:nilppa
4:jn-morf
4:ka-morf
6:erfocsic
5:cils-si
5:eeg-a-si
10:si
8:sndd
5:h
5:latsnaebcitsale
20:.1-htron-ue
25:uos-em
29:fa
29:pa
29:ue
23:lartnec-ac
31:em
31:li
31:ue
23:tsae-as
28:pa`, `28:su
28:vog-su
27:htron-pa
29:uos-pa
25:ew-su
28:ue
28:vog-su
21:2-htuos-ue
23:tsae-su
27:htron-pa
29:uos-pa
25:ew-su
28:ue
21:3-tsaehtron-pa
29:uos-pa
25:ew-ue
21:5-tsaehtuos-pa
21:7-tsaehtuos-pa
5:nil-kaerts
5:o-morf
5:radhtiwtliub
6:ow-sndnyd
9:ta-sndnyd
8:ten-orehkcats
5:sedal
5:u
4:la-morf
6:colottad
6:rebil-a-si
6:tropqhylauq.*
5:f-morf
5:i-morf
6:am-sndnyd
8:detsohpw
5:lecelffaw
5:rihwyap.*
6:u-elpmis
8:taen
4:mme0.*
5:n-morf
5:rofepyt.orp
9:rerac-htlaeh
8:talp-evird
5:sacrasevres
5:uirarret-yltsaf
4:nacilbuper-a-si
6:f-sllub-a-si
7:racsan-a-si
6:icisum-a-si
7:ratrebil-a-si
6:tarukas
5:c
5:dchsums
7:umpw
5:eerg-a-si
5:i-morf
6:jod
5:m-morf
5:oehtnaptog
6:isam-al-a-tse
6:rtap-el-tse
6:siam-al-a-tse
7:replausunu
5:pj
5:t-morf
4:oc
5:hce-namtsop
5:idutsxiw
5:jodsnd
5:m-morf
6:ed-baltlow
5:niloxip
5:tingocnozama.1-htron-ue.htua
22:uos-em.htua
26:fa.htua
26:pa.htua
26:ue.htua
20:lartnec-ac.htua
28:em.htua
28:li.htua
28:ue.htua
28:xm.htua
20:tsae-as.htua
25:pa.htua
25:su.htua
28:spif-htua
25:vog-su.spif-htua
24:htron-pa.htua
26:uos-pa.htua
22:ew-ac.htua
25:su.htua
28:spif-htua
25:ue.htua
25:vog-su.spif-htua
18:2-htuos-pa.htua
26:ue.htua
20:lartnec-ue.htua
20:tsae-su.htua
28:spif-htua
24:htron-pa.htua
26:uos-pa.htua
22:ew-su.htua
28:spif-htua
25:ue.htua
18:3-tsaehtron-pa.htua
26:uos-pa.htua
22:ew-ue.htua
18:4-tsaehtuos-pa.htua
18:5-tsaehtuos-pa.htua
18:7-tsaehtuos-pa.htua
6:tadym
4:p2pevres
5:3-detalosi-naissalta.*
7:naissalta.*
5:aelutym
5:i-sndnyd
6:fles
6:ogol
6:ruoyesol
10:hctid
6:ymeerf
8:teg
5:mirhselbmub
5:ohsdaerpsym
8:uneviv
5:pa-emas
8:selucreh
7:anis`, `11:piv
7:esaberif
7:iparts
13:.aidem
7:k1
7:nuspu
7:oifilauq
7:roetem
13:.ue
7:snrettapcigam
7:tilmaerts
7:ukoreh
7:yfilpma
5:tfevres
6:thevres
4:r081
5:a-morf
6:tskcor-a-si
5:b
6:asnd
5:ediverp-yb-detsoh.saap
9:orpnwo
7:ner.ppa
10:no
6:ebevres
7:nigne-na-si
6:ggolb-a-si
6:hcaet-a-si
7:pargotohp-a-si
6:krow-drah-a-si
6:ngised-a-si
7:iartlanosrep-a-si
9:tretne-na-si
7:nurppaswa.*
7:trapqhylauq.*
6:pacsdnal-a-si
7:eekkoob-a-si
6:retac-a-si
6:subq
6:tnecysrab
8:iap-a-si
8:uh-a-si
6:vres-ki.cpj-rev-duolcj
14:duolcj
11:sndnyd
12:pvtsaf
10:bdym
10:inim
10:nmad
10:pc
10:sak
6:yalp-a-si
7:wal-a-si
6:zilibomdeepsegap
5:g
5:ituob
5:mgrp.nex
5:o-morf
6:pav-no
6:sivdalaicnanif-a-si
6:tareleccalabolgswa
7:ca-na-si
8:od-a-si
7:susaym
5:p-morf
5:uas-o-nyd
6:etsoh.duolc-gar
12:hc-duolc-gar
7:ugolb-nom-tse
6:omuhevres
4:saapod
6:ilanyd
9:snd
6:nduolcym
7:ymsd
6:vnac-sued
10:remarf
5:bal-ecir
6:bevres
5:cduolcababila
6:ip-sndnyd
8:evres
7:tcatytiruces
5:dylimaf
5:ecapsnaecolatigid.*
7:ived-anelab
6:itilitu3
6:lahw-eht-sevas
6:mag-otni-si
6:tiiis
8:sro
7:yskciuq
6:ugaelyajyarg
5:fpi-eralfduolc
9:fc
5:iht2tniop
6:murud
6:paelgoog
8:tneltneg
5:jfac
5:k-morf
6:aerf-ten
6:colbegrof
10:pohsym
6:nilkaerts
5:m-morf
5:nd-pmet
7:d-pi
8:unyd
8:yard
7:golb
7:htiwssem
7:looc1
7:mood
7:rba
7:tog
6:kselp
6:nyd
6:ootrac-otni-si
5:o-xobeerf
6:xobeerf
5:ppa-avnac
8:duolcelcaro.*
13:vogelcaro.*
8:nived.*
8:raeghtua
8:swa
8:tneg`, `5:rac-otni-si
6:entrap-paelut
7:tsohmaerd
5:sel-rof-slles
7:rtca-na-si
6:ibodym
5:tcejboedonil.*
11:rtluv.*
6:nemelepiuq.*
6:saeb-cihtym.allicno
19:zno
18:ilay
18:lacarac
18:regitnef
20:motsuc
18:sv
18:toleco
18:x
19:nihps
20:yl
5:u
5:wanozama.1-3s
16:etupmoc.*
16:htron-ue-3s
24:.3s
25:9duolc-swa.stessa-weivbew
31:.sfv
33:tessa-weivbew
25:adbmal-tcejbo-3s
25:dorp-iupparme
30:oidutsrme
30:skoobetonrme
25:etisbew-3s
25:ipa-etucexe
25:kcatslaud.3s
35:tniopssecca-3s
25:tniopssecca-3s
18:uos-em-3s
24:.3s
25:9duolc-swa.stessa-weivbew
31:.sfv
33:tessa-weivbew
25:adbmal-tcejbo-3s
25:dorp-iupparme
30:oidutsrme
30:skoobetonrme
25:etisbew-3s
25:ipa-etucexe
25:kcatslaud.3s
35:tniopssecca-3s
25:tniopssecca-3s
22:fa.3s
25:9duolc-swa.stessa-weivbew
31:.sfv
33:tessa-weivbew
25:adbmal-tcejbo-3s
25:dorp-iupparme
30:oidutsrme
30:skoobetonrme
25:etisbew-3s
25:ipa-etucexe
25:kcatslaud.3s
35:etisbew-3s
35:tniopssecca-3s
25:tniopssecca-3s
22:pa-3s
24:.3s
25:9duolc-swa.stessa-weivbew
31:.sfv
33:tessa-weivbew
25:adbmal-tcejbo-3s
25:dorp-iupparme
30:oidutsrme
30:skoobetonrme
25:etisbew-3s
25:ipa-etucexe
25:kcatslaud.3s
35:etisbew-3s
35:tniopssecca-3s
25:tniopssecca-3s
25:yawetag-scitylana
22:ue.3s
25:9duolc-swa.stessa-weivbew
31:.sfv
33:tessa-weivbew
25:adbmal-tcejbo-3s
25:dorp-iupparme
30:oidutsrme
30:skoobetonrme
25:etisbew-3s
25:ipa-etucexe
25:kcatslaud.3s
35:etisbew-3s
35:tniopssecca-3s
25:tniopssecca-3s
16:lanretxe-3s
18:rtnec-ac-3s
26:.3s
27:9duolc-swa.stessa-weivbew
33:.sfv
35:tessa-weivbew
27:adbmal-tcejbo-3s
27:dorp-iupparme
32:oidutsrme
32:skoobetonrme
27:etisbew-3s
27:ipa-etucexe
27:kcatslaud.3s
37:etisbew-3s
37:spif-3s
42:tniopssecca-3s
37:tniopssecca-3s
27:spif-3s
32:tniopssecca-3s
27:tniopssecca-3s
24:em.3s
27:adbmal-tcejbo-3s
27:dorp-iupparme
32:oidutsrme
32:skoobetonrme
27:etisbew-3s
27:ipa-etucexe
27:kcatslaud.3s
37:etisbew-3s
37:tniopssecca-3s
27:tniopssecca-3s
24:li.3s
27:9duolc-swa.stessa-weivbew`, `33:.sfv
27:adbmal-tcejbo-3s
27:dorp-iupparme
32:oidutsrme
32:skoobetonrme
27:etisbew-3s
27:ipa-etucexe
27:kcatslaud.3s
37:etisbew-3s
37:tniopssecca-3s
27:tniopssecca-3s
24:ue-3s
26:.3s
27:9duolc-swa.stessa-weivbew
33:.sfv
35:tessa-weivbew
27:adbmal-tcejbo-3s
27:dorp-iupparme
32:oidutsrme
32:skoobetonrme
27:etisbew-3s
27:ipa-etucexe
27:kcatslaud.3s
37:etisbew-3s
37:tniopssecca-3s
27:tniopssecca-3s
27:yawetag-scitylana
16:tsae-as-3s
24:etisbew-3s
23:.3s
24:9duolc-swa.stessa-weivbew
30:.sfv
32:tessa-weivbew
24:adbmal-tcejbo-3s
24:dorp-iupparme
29:oidutsrme
29:skoobetonrme
24:etisbew-3s
24:ipa-etucexe
24:kcatslaud.3s
34:etisbew-3s
34:tniopssecca-3s
24:tniopssecca-3s
21:pa-3s
23:.3s
24:9duolc-swa.stessa-weivbew
30:.sfv
32:tessa-weivbew
24:adbmal-tcejbo-3s
24:dorp-iupparme
29:oidutsrme
29:skoobetonrme
24:etisbew-3s
24:ipa-etucexe
24:kcatslaud.3s
34:tniopssecca-3s
24:tniopssecca-3s
21:su
23:-etisbew-3s
23:.3s
24:9duolc-swa.stessa-weivbew
30:.sfv
32:tessa-weivbew
24:adbmal-tcejbo-3s
24:detacerped-3s
25:orp-iupparme
29:oidutsrme
29:skoobetonrme
24:etisbew-3s
24:ipa-etucexe
24:kcatslaud.3s
34:etisbew-3s
34:spif-3s
39:tniopssecca-3s
34:tniopssecca-3s
24:spif-3s
29:tniopssecca-3s
24:tniopssecca-3s
24:yawetag-scitylana
21:vog-su-3s
28:spif-3s
27:.3s
28:adbmal-tcejbo-3s
28:dorp-iupparme
33:oidutsrme
33:skoobetonrme
28:etisbew-3s
28:ipa-etucexe
28:kcatslaud.3s
38:etisbew-3s
38:spif-3s
43:tniopssecca-3s
38:tniopssecca-3s
28:spif-3s
33:tniopssecca-3s
28:tniopssecca-3s
20:htron-pa-3s
29:etisbew-3s
28:.3s
29:9duolc-swa.stessa-weivbew
35:.sfv
37:tessa-weivbew
29:adbmal-tcejbo-3s
29:dorp-iupparme
34:oidutsrme
34:skoobetonrme
29:etisbew-3s
29:ipa-etucexe
29:kcatslaud.3s
39:etisbew-3s
39:tniopssecca-3s
29:tniopssecca-3s
29:yawetag-scitylana
22:uos-pa-3s
29:etisbew-3s
28:.3s
29:9duolc-swa.stessa-weivbew
35:.sfv
37:tessa-weivbew
29:adbmal-tcejbo-3s
29:dorp-iupparme
34:oidutsrme
34:skoobetonrme
29:etisbew-3s
29:ipa-etucexe
29:kcatslaud.3s
39:etisbew-3s
39:tniopssecca-3s`, `29:tniopssecca-3s
29:yawetag-scitylana
18:ew-ac.3s
24:adbmal-tcejbo-3s
24:dorp-iupparme
29:oidutsrme
29:skoobetonrme
24:etisbew-3s
24:ipa-etucexe
24:kcatslaud.3s
34:etisbew-3s
34:spif-3s
39:tniopssecca-3s
34:tniopssecca-3s
24:spif-3s
29:tniopssecca-3s
24:tniopssecca-3s
21:su-3s
24:etisbew-3s
23:.3s
24:9duolc-swa.stessa-weivbew
30:.sfv
32:tessa-weivbew
24:adbmal-tcejbo-3s
24:dorp-iupparme
29:oidutsrme
29:skoobetonrme
24:etisbew-3s
24:ipa-etucexe
24:kcatslaud.3s
34:etisbew-3s
34:spif-3s
39:tniopssecca-3s
34:tniopssecca-3s
24:spif-3s
29:tniopssecca-3s
24:tniopssecca-3s
21:ue-3s
24:etisbew-3s
23:.3s
24:9duolc-swa.stessa-weivbew
30:.sfv
32:tessa-weivbew
24:adbmal-tcejbo-3s
24:detacerped-3s
25:orp-iupparme
29:oidutsrme
29:skoobetonrme
24:etisbew-3s
24:ipa-etucexe
24:kcatslaud.3s
34:etisbew-3s
34:tniopssecca-3s
24:tniopssecca-3s
24:yawetag-scitylana
21:vog-su-3s
28:etisbew-3s
28:spif-3s
27:.3s
28:adbmal-tcejbo-3s
28:dorp-iupparme
33:oidutsrme
33:skoobetonrme
28:etisbew-3s
28:ipa-etucexe
28:kcatslaud.3s
38:etisbew-3s
38:spif-3s
43:tniopssecca-3s
38:tniopssecca-3s
28:spif-3s
33:tniopssecca-3s
28:tniopssecca-3s
14:2-htuos-pa.3s
25:adbmal-tcejbo-3s
25:dorp-iupparme
30:oidutsrme
30:skoobetonrme
25:etisbew-3s
25:ipa-etucexe
25:kcatslaud.3s
35:etisbew-3s
35:tniopssecca-3s
25:tniopssecca-3s
22:ue.3s
25:adbmal-tcejbo-3s
25:dorp-iupparme
30:oidutsrme
30:skoobetonrme
25:etisbew-3s
25:ipa-etucexe
25:kcatslaud.3s
35:etisbew-3s
35:tniopssecca-3s
25:tniopssecca-3s
16:lartnec-ue.3s
27:adbmal-tcejbo-3s
27:dorp-iupparme
32:oidutsrme
32:skoobetonrme
27:etisbew-3s
27:ipa-etucexe
27:kcatslaud.3s
37:etisbew-3s
37:tniopssecca-3s
27:tniopssecca-3s
16:tsae-su-3s
23:.3s
24:9duolc-swa.stessa-weivbew
30:.sfv
32:tessa-weivbew
24:adbmal-tcejbo-3s
24:detacerped-3s
25:orp-iupparme
29:oidutsrme
29:skoobetonrme
24:etisbew-3s
24:ipa-etucexe
24:kcatslaud.3s
34:etisbew-3s
34:spif-3s
39:tniopssecca-3s
34:tniopssecca-3s
24:spif-3s
29:tniopssecca-3s
24:tniopssecca-3s
24:yawetag-scitylana
20:htron-pa-3s`, `28:.3s
29:9duolc-swa.stessa-weivbew
35:.sfv
37:tessa-weivbew
29:adbmal-tcejbo-3s
29:dorp-iupparme
34:oidutsrme
34:skoobetonrme
29:etisbew-3s
29:ipa-etucexe
29:kcatslaud.3s
39:etisbew-3s
39:tniopssecca-3s
29:tniopssecca-3s
29:yawetag-scitylana
22:uos-pa-3s
29:etisbew-3s
28:.3s
29:9duolc-swa.stessa-weivbew
35:.sfv
37:tessa-weivbew
29:adbmal-tcejbo-3s
29:dorp-iupparme
34:oidutsrme
34:skoobetonrme
29:etisbew-3s
29:ipa-etucexe
29:kcatslaud.3s
39:etisbew-3s
39:tniopssecca-3s
29:tniopssecca-3s
29:yawetag-scitylana
18:ew-su-3s
24:etisbew-3s
23:.3s
24:9duolc-swa.stessa-weivbew
30:.sfv
32:tessa-weivbew
24:adbmal-tcejbo-3s
24:detacerped-3s
25:orp-iupparme
29:oidutsrme
29:skoobetonrme
24:etisbew-3s
24:ipa-etucexe
24:kcatslaud.3s
34:etisbew-3s
34:spif-3s
39:tniopssecca-3s
34:tniopssecca-3s
24:spif-3s
29:tniopssecca-3s
24:tniopssecca-3s
24:yawetag-scitylana
21:ue-3s
23:.3s
24:9duolc-swa.stessa-weivbew
30:.sfv
32:tessa-weivbew
24:adbmal-tcejbo-3s
24:dorp-iupparme
29:oidutsrme
29:skoobetonrme
24:etisbew-3s
24:ipa-etucexe
24:kcatslaud.3s
34:tniopssecca-3s
24:tniopssecca-3s
14:3-tsaehtron-pa-3s
28:.3s
29:9duolc-swa.stessa-weivbew
35:.sfv
37:tessa-weivbew
29:adbmal-tcejbo-3s
29:dorp-iupparme
34:oidutsrme
34:skoobetonrme
29:etisbew-3s
29:ipa-etucexe
29:kcatslaud.3s
39:etisbew-3s
39:tniopssecca-3s
29:tniopssecca-3s
22:uos-pa.3s
29:adbmal-tcejbo-3s
29:dorp-iupparme
34:oidutsrme
34:skoobetonrme
29:etisbew-3s
29:ipa-etucexe
29:kcatslaud.3s
39:etisbew-3s
39:tniopssecca-3s
29:tniopssecca-3s
18:ew-ue-3s
23:.3s
24:9duolc-swa.stessa-weivbew
30:.sfv
32:tessa-weivbew
24:adbmal-tcejbo-3s
24:dorp-iupparme
29:oidutsrme
29:skoobetonrme
24:etisbew-3s
24:ipa-etucexe
24:kcatslaud.3s
34:etisbew-3s
34:tniopssecca-3s
24:tniopssecca-3s
15:s
14:4-tsaehtuos-pa.3s
29:adbmal-tcejbo-3s
29:dorp-iupparme
34:oidutsrme
34:skoobetonrme
29:etisbew-3s
29:ipa-etucexe
29:kcatslaud.3s
39:etisbew-3s
39:tniopssecca-3s
29:tniopssecca-3s
14:5-tsaehtuos-pa.3s
29:adbmal-tcejbo-3s
29:detacerped-3s
29:etisbew-3s
29:ipa-etucexe
29:kcatslaud.3s
39:etisbew-3s`, `39:tniopssecca-3s
29:tniopssecca-3s
14:ble.*
14:etupmoc.*
14:labolg-3s.tniopssecca.parm
14:sdr.1-htuos-em.*
26:fa.*
26:pa.*
20:lartnec-ac.*
28:em.*
28:li.*
28:ue.*
28:xm.*
20:tsae-as.*
25:pa.*
25:su.*
25:vog-su.*
24:htron-pa.*
30:su.*
26:uos-pa.*
22:ew-ac.*
25:su.*
25:ue.*
25:vog-su.*
18:2-htuos-pa.*
20:lartnec-ue.*
20:tsae-pa.*
25:su.*
24:htron-pa.*
26:uos-pa.*
22:ew-su.*
25:ue.*
18:3-tsaehtron-pa.*
26:uos-pa.*
22:ew-ue.*
18:4-tsaehtuos-pa.*
18:5-tsaehtuos-pa.*
18:6-tsaehtuos-pa.*
18:7-tsaehtuos-pa.*
14:wolfria.1-htron-ue.*
26:uos-em.*
30:fa.*
30:pa.*
30:ue.*
24:lartnec-ac.*
32:em.*
32:li.*
32:ue.*
24:tsae-as.*
29:pa.*
29:su.*
28:htron-pa.*
30:uos-pa.*
26:ew-ac.*
29:su.*
29:ue.*
22:2-htuos-pa.*
30:ue.*
24:lartnec-ue.*
24:tsae-su.*
28:htron-pa.*
30:uos-pa.*
26:ew-su.*
29:ue.*
22:3-tsaehtron-pa.*
30:uos-pa.*
26:ew-ue.*
22:4-tsaehtuos-pa.*
22:5-tsaehtuos-pa.*
22:7-tsaehtuos-pa.*
5:yasdrocsid
4:tarcomed-a-si
5:c-morf
6:ejorpelbavol
7:tedatad.ecnatsni
15:omed
5:eel-si
8:rebu-si
6:notlacol
5:hgilfhtiwletoh
5:i
6:batym
6:nelp-1al
12:su
12:ue
5:m-morf
5:natnuocca-na-si
6:eduts-a-si
7:gatnegreme.weiverp
9:yolped
7:r-ot-ecaps
7:tnocresuahcom
16:rtul.*
15:buhtig
15:ecapsppa
16:donil.pi
17:ualc
21:.emarf
16:lbavresbo.citats
16:vat
15:iaatem.*
17:o.*
16:ua.*
15:kaerts
15:pl
15:rosruc.*
5:opsedoc
8:golb
8:ppa
11:.r.*
5:sihcrana-a-si
14:na-si
7:laicos-a-si
7:pareht-a-si
7:tra-na-si
7:xetnod
11:seod
6:oh-ecapsbew
8:piym
8:sfn
5:u-morf
6:nyekcoh-asi
5:v-morf
4:u-rof-slles
5:4
5:e
5:oynahtretramssi
5:r`, `6:ug-a-si
8:sndd
4:ved-selucreh
5:n-morf
5:rdlf
5:w-morf
4:weiverp-emas
5:olpwons-yrt
6:zok
4:xbsbf.sppa
5:em
5:inuemoh
5:obdnas-44esab
5:t-morf
5:unilemoh
4:yalerottad
6:p-csbus
6:wetag-llawerif
5:dnacsekil
6:uts-tcejorp.ved
5:fipohsym
5:k-morf
6:niksisnd
5:raidanetah
6:otceridevitcaym
5:ugoo
5:w-morf
5:xalagkeeg
6:orpmapson.duolc
21:.563o
4:zesdrocsid
5:tilbcitats-proc-w
16:ssellaitnederc-w
16:w
3:inu
2:m
2:or
2:tsla
1:p
2:.eman
3:nwo
1:raf
4:etats
1:s
1:t
2:.gro
3:lim
3:moc
5:n
3:oc
3:ten
3:ude
3:vog
1:uesum
2:rof
1:z
2:.ca
3:gro
3:hcs
3:lim
3:moc
3:oc
4:fni
3:ten
3:ude
3:vog
3:zib
0:n315rmi--nx
1:abrud
2:cilbuper
2:f
3:.mkm
2:grompj
2:hkaga
2:m
2:ol
2:ssin
2:uhix
3:qna
2:varac
2:yalo
1:b
2:.gro
3:moc
3:oc
3:ten
3:ude
3:vog
2:c
1:c
2:.ah
3:bh
3:ca
4:s
3:d5xq55--nx
4:g
4:s
4:uolcpanqym
3:edoc-avnac
4:h
4:tisavnac.ym
3:gla0do--nx
4:ro
3:ha
4:q
4:s
5:.sa
3:i7a0oi--nx
4:h
3:jb
4:f
4:shk
4:t
4:x
4:z
3:kh
3:lh
4:im
4:j
3:mn
4:oc
6:.rekamegas.1-htron-nc.koobeton
28:oiduts
19:tsewhtron-nc.koobeton
32:oiduts
7:secivresbewnozama.no.1-htron-nc.ppabew-refsnart
39:wolfria.*
30:tsewhtron-nc.ppabew-refsnart`, `43:wolfria.*
8:wanozama.1-htron-nc.3s
28:adbmal-tcejbo-3s
28:detacerped-3s
29:orp-iupparme
33:oidutsrme
33:skoobetonrme
28:etisbew-3s
28:ipa-etucexe
28:kcatslaud.3s
38:etisbew-3s
38:tniopssecca-3s
28:sdr.*
28:tniopssecca-3s
19:tsewhtron-nc.3s
32:adbmal-tcejbo-3s
32:dorp-iupparme
37:oidutsrme
37:skoobetonrme
32:etisbew-3s
32:ipa-etucexe
32:kcatslaud.3s
42:tniopssecca-3s
32:sdr.*
32:tniopssecca-3s
17:be.1-htron-nc
22:tsewhtron-nc
18:le.*
17:etupmoc.*
17:wolfria.1-htron-nc.*
27:tsewhtron-nc.*
3:nh
4:l
4:s
4:y
3:om
3:qc
3:sg
4:j
4:ppa-avnac
3:tcennockciuq.tcerid
4:en
3:ude
3:vog
3:wt
3:xg
4:j
4:n
4:s
3:zg
4:x
2:b
1:dg
3:.ypnc
2:ka
1:edrag
2:erg
2:fuak
2:hctik
2:ilibommi
3:w
2:m
2:po
2:r
3:ednaalv
2:sier
2:ves
1:g
2:.ca
3:gro
3:moc
3:ten
3:ude
3:vog
2:ised
6:.cihparg
7:ssb
4:irev
1:h
2:.bog
3:gro
3:lim
3:moc
3:ten
3:ude
1:i
2:.ac
3:bew
4:u
3:ca
4:in
3:dni
3:em
4:sabapus
3:g5
4:6
4:p
4:ro
3:ia
4:hled
4:nmula
3:knab
4:u
3:levart
4:im
4:oohcs
3:ma
4:oc
4:rif
3:nc
4:eg
4:if
3:oc
4:fni
4:i
4:rea
5:p
3:pooc
4:u
3:rahib
4:d
4:e
3:sc
4:er
4:nduolc
4:senisub
4:u
4:vedni`, `3:tarajug
4:en
6:retni
4:ni
4:sop
3:ude
3:vog
4:t
3:ysrab
3:zib
2:elknivlac
2:griv
2:ks
2:lreb
6:.sndd
2:p
2:v
2:w
2:x
1:k
2:.gro
3:ten
3:ude
3:vog
1:leok
2:ocnil
1:m
2:.cyn
3:gro
3:ude
3:vog
1:odnol
2:ihsaf
3:no
4:utiderc
3:siv
6:orue
3:tacude
9:.oc
5:dnuof
5:tsyalp
4:cetorp
5:ua
6:rtsnoc
2:kin
2:las
2:mrom
2:nac
2:pq
3:uoc
2:siam
3:pe
3:scire
2:tron
3:sob
2:zama
1:p
2:.gro
3:oc
3:ten
3:ude
3:vog
2:k
1:rec
3:yab
2:op
1:s
2:.gro
3:moc
3:tra
3:ude
3:vinu
4:uog
1:t
2:.dni
4:uolcegnaro
3:gro
3:ltni
3:moc
6:nim
4:siruot
3:nif
3:ofni
4:srep
3:sne
3:tan
4:en
3:vog
2:m
1:uf
3:.pciv
7:y
7:z
4:sm
2:r
3:.arail
9:.nari
5:vnac
4:bdnevar
4:dliub.*
5:uolc
4:edoc.*
5:lbavol
6:deen
5:sabatad.*
5:tirwppa.*
4:lav
7:.bew
5:ecrev
5:per
4:noitargim.*
4:retropno
4:tikcats
5:nempoleved
4:xiw
2:stad
2:xamay
2:y
1:v
2:.alnos
4:ohhnahk
10:t
3:ca
4:ouhphnib
4:uhphniv
3:di
3:eman
4:rtneb`, `4:uh
6:neihtauht
3:gnaboac
6:igah
8:cab
8:na
9:eik
11:t
8:uah
6:nad
6:rtcos
6:uqneyut
5:odmal
6:hpiah
6:lhniv
6:nkad
6:udhnib
8:iah
4:ro
3:hnibaoh
7:gnauq
7:hnin
7:iaht
6:dhnib
7:man
6:mihcohohphnaht
6:ncab
7:gnauq
7:yat
6:tah
6:vart
4:tlaeh
3:ia
5:bney
5:coal
5:gngnauq
5:laig
5:ngnod
4:onah
4:rtgnauq
3:kalkad
3:manah
6:gnauq
4:oc
4:utnok
3:naehgn
5:gnol
5:kcab
5:uhthnib
11:n
4:eibneid
5:ygnuh
6:ugniaht
7:hp
4:osgnal
3:ofni
4:htnac
6:uhp
4:i
4:rp
3:pahtgnod
3:ten
4:ni
3:uahcial
5:mac
5:tgnuv-airab
4:de
4:eilcab
3:vog
3:zib
1:worc
3:t
4:epac
0:o76i4orfy--nx
1:a
2:.bp
3:de
3:go
4:ro
3:oc
3:ti
3:ude
3:vg
4:og
2:boat
1:b
2:.acisum
6:tilop
4:i
5:carcomed
6:neic
5:goloce
9:ncet
5:medaca
6:onoce
5:rtap
7:sudni
5:vilob
4:negidni
5:icidem
4:serpme
4:tsiver
4:vitarepooc
3:bew
4:og
3:dulas
3:erbmon
4:tra
6:oped
8:snart
3:golb
4:ro
3:ikiw
3:lanoicanirulp
8:seforp
5:rutan
4:im
3:moc
3:ofni
4:lbeup
4:rga
4:tneimivom
3:saiciton
3:taskt
4:en
4:ni
3:ude
3:vt`, `2:h
2:iew
2:olg
1:c
2:.apdr.sretsulc.*
9:selrvrs.*
3:drc
5:rac
3:esabapus
11:.egarots
13:mitlaer
3:gro
3:ipym
3:lim
4:per
7:.di
3:moc
5:n
3:osmu
3:pato.*
3:segapdael
8:l
4:ndih
3:ten
4:ilperdellawerif
19:.di
5:mx.*
3:ude
3:vog
2:a
2:e
2:in
2:mara
2:sedarb
3:ic
1:d
2:.bew
4:og
3:dls
3:gro
3:lim
3:moc
3:ten
4:ra
3:ude
3:vog
2:agoba
2:if
2:zd7acbgm--nx
1:ec
2:div
3:or
1:f
2:ni
4:.dlawttim
5:egdelwonk-fo-lerrab
19:lerrab
7:ellocevoli
6:ht-skorg
6:rom-rof-ereh
6:tadpusn
13:d
5:llatiswonk
5:macrvd
5:ofni-v
5:pi-on
7:fles
6:ohbew
5:revres3opyt
11:dlawttim
6:uo-rof
5:siht-skorg
6:nd-cimanyd
8:nyd
8:uolc
5:tsrifyam
5:ysrab
5:zmurof
1:gel
2:n
3:am
3:ib
1:hwsohw
1:i
2:.0pci
7:.war.*
3:1pci
7:.war.*
3:8302
3:aminifed
4:tad-b
3:baltig
4:uhtig
3:citeneek
3:detpyrcs.tneilc
4:raobelgaeb
4:uolcropav
3:ecivedniser
4:donppad.sndnyd
7:repyh
4:egipa
4:lacsnoom.*
5:bbub.ndc
5:ej
4:nilnigol
4:sufxob
4:tibeulb
6:snoehtnap
5:newtu
5:ybeeb.saap
4:varb
8:.s.*
3:gnalkrad
5:igatsniser.secived
6:tsoh-br.etis
10:ytsoh
4:ro
3:kcoregrof.di
4:oobtig
5:rgn
8:.as
9:ni
9:pa
10:j
9:su
9:ua
10:e
4:ramytefasresworb`, `3:lim
3:moc
5:n
4:roftalp-evird
3:naicisum
4:mtsp
8:.kcom
4:yded
3:oc
4:idutsxiw
5:r-no.*
4:toq
3:popilol
4:pa-arusah
6:etybeeb.1dkes
3:rddaym
4:eniatnoceruza.*
5:tsneum-hf
5:vrescisab
9:lautriv
4:ial.sppa
3:s3k-no.*
4:codehtdaer
4:gnihtbew
4:nemeis-om
4:olots.*
4:ppaelbbub
7:olik
7:revelc
4:tacdnas
5:ekcit
3:tekcubtib
5:n
4:ibelet
5:gude
4:netnocresuseebduolc
4:raedon.egats
4:setwolfbew
5:udgniht.cersid.dvreser
20:tsuc
13:dorp.tsuc
13:gnitset.dvreser
21:tsuc
13:ved.dvreser
17:tsuc
3:ude
3:vog
3:wolfbew
3:xbdrym
4:cq
6:.sys.*
4:rotide
3:ysrab
3:zzq
2:b
2:dar
3:ua
4:ts
6:.ia
2:j
2:r
2:syhp
1:j
2:.dhp
3:gne
4:ro
3:hcs
3:ia
4:rga
3:lim
3:mf
4:oc
3:rep
3:ten
3:ude
3:vog
4:t
1:llag
3:o
1:m
2:.gro
3:moc
3:ten
3:ude
3:vog
2:g
2:il
4:.hte.*
2:mi
2:orp
1:n
2:.a0b-ekhgnark--nx
5:c-iehsrgev--nx
5:g-lksedlig--nx
5:k-negnanvk--nx
4:1p-nedragy--nx
5:q-asierrs--nx
7:grebsnt--nx
7:lado-rs--nx
7:negnidl--nx
8:orf-rs--nx
7:regnayh--nx
7:ssofenh--nx
5:r-datsgrt--nx
5:s-ladrjts--nx
5:v-ysenner--nx
8:vrejks--nx
4:3g-datsobegh--nx
4:45-dnaleprj--nx
7:goksnerl--nx
7:tednalyh--nx
5:6-neladnjm--nx
5:s-antouvachb--nx
7:impouvtalm--nx
5:y-agrjnevvad--nx
7:ikhvlaraeb--nx
4:7k-antouvacchb--nx
4:8k-rekie-erv--nx
5:l-ladrua-rs--nx
5:m-darehsdrk--nx
4:a
5:.sg
4:bct-eimeuvejsemn--nx
4:ddo
5:iisevvad
5:leig
6:ov
5:narts`, `5:uas
4:f1-l--nx
7:s--nx
5:2-h--nx
4:g10aq0-ineve--nx
5:av
5:ev
5:lot
5:rajnevvad
9:u
4:h
4:iz-lf--nx
4:jddadab
5:sel
4:kel
5:hojsarak
5:iivagnael
12:g
8:ran
4:lf
5:lahrevo
5:oms
6:s
5:sennev
5:t-ilm--nx
7:tom--nx
5:u-edr--nx
6:s
4:muar
4:n0-tsr--nx
5:2-dob--nx
5:5-asir--nx
7:tals--nx
5:ar
7:-i-om
7:f
7:t
6:t
5:douvsatvid
5:kiv
5:mos
5:nod
5:ra
5:sen
5:taouvatheig
6:ouvacchab
11:hab
10:n
9:iag
9:samo
11:ttvid
5:z-rey--nx
4:op-ladr--nx
7:sens--nx
5:q-nagv--nx
5:r-asns--nx
5:s-kjks--nx
5:v-murb--nx
5:w-anrf--nx
10:t--nx
7:ublk--nx
4:ppol
4:q0-tbaol--nx
8:soum--nx
8:veib--nx
5:x-ipphl--nx
7:rembh--nx
8:imph--nx
5:y-tinks--nx
4:rf-atsr--nx
5:g-anms--nx
9:nd--nx
7:edrf--nx
8:ngs--nx
7:murs--nx
7:netl--nx
7:olmb--nx
7:sorr--nx
5:h-alms--nx
8:yrf--nx
7:emjt--nx
5:i-lboh--nx
7:rsir--nx
7:ydar--nx
9:na--nx
8:ksa--nx
8:lem--nx
8:rul--nx
9:yd--nx
6:stu
5:j-drav--nx
7:rolf--nx
7:sdav--nx
5:kua
5:l-drojf--nx
7:lares--nx
5:m-tlohr--nx
5:n-esans--nx
5:olf
5:p-sdnil--nx
5:s-ladrl--nx
5:tih
5:v-rvsyt--nx
4:sans
6:ons
5:iar
6:erdron
8:ros
5:lag
7:h
5:mor
8:t
5:sir
5:uf
4:tkoulonka
5:la
5:p-raddjb--nx
5:r-agrjnu--nx
5:saeframmah
6:orf
6:ro
5:u-vreiks--nx
4:uh-dnusel--nx
5:i-drojfk--nx
7:vleslm--nx
5:j-ekerom--nx
5:k-rekrem--nx
5:u-dnalr--nx`, `7:goksr--nx
7:sensk--nx
5:v-nekyr--nx
5:w-kabrd--nx
8:ivjg--nx
7:oryso--nx
5:y-ydnas--nx
8:mrak--nx
8:nart--nx
9:nif--nx
8:reva--nx
5:z-smort--nx
4:v
5:.sg
5:ledatskork
5:reiks
4:wh-antouvn--nx
4:x9-dlofts--nx.aoq-relv--nx
5:d-nmaherk--nx
5:f-dnalnks--nx
5:h-neltloh--nx
5:i-drgeppo--nx
5:j-gvegnal--nx
10:lreb--nx
5:m-negnilr--nx
5:n-drojfvk--nx
4:y7-ujdaehal--nx
5:8-antouvig--nx
5:b-dlofrs--nx
7:goksmr--nx
7:kivryr--nx
7:retslj--nx
5:e-nejsom--nx
5:f-yramah--nx
9:edni--nx
10:tso--nx
8:slrak--nx
9:tivk--nx
5:g-regark--nx
5:orf
4:z9-drojfstb--nx
3:b25-akiivagael--nx
4:53ay7-olousech--nx
4:aiy-gv--nx
5:le-tlb--nx
10:s--nx
5:n0-ydr--nx
4:c0-dnal-erdns--nx
5:z-netot-erts--nx
4:gg-regnarav-rs--nx
5:o-nejssendnas--nx
4:ju-erdils-ertsy--nx
4:nj-dnalh-goksrua--nx
4:qq-ladsmor-go-erm--nx.ari-yreh--nx
26:ednas
5:s-neslahsladrjts--nx
3:ca4s-atsaefrmmh--nx
5:8m-dnusynnrb--nx
5:il-tl--nx
5:le-slg--nx
5:n5-rdib--nx
5:op-drgl--nx
5:uw-ynnrb--nx
3:daqx-tggrv--nx
5:reh
8:nnivk
8:sdork
8:uas
5:tsebi
8:kkar
8:llyh
8:nnan
7:gort
7:kalf
8:irderf
7:levev
7:mirg
7:obegah
7:rah
8:ejg
4:barm-jdddb--nx
4:ie
6:rah
6:setivk
7:ladman
4:lofros
7:tsev.ednas
9:o.relav
4:nal-erdnos
11:ron
7:adroh.so
7:dron.ag5-b--nx
13:ri-yreh--nx
12:ob
12:yoreh
7:em
9:lejh
8:proj
8:vi
7:gyb
7:naks
7:oh-goksrua
8:rf
7:ro
8:ua
7:tros
6:rts
9:edevt
10:lab
10:mloh
6:sellil
7:naitsirk
7:rof
5:ul
7:os
6:s
7:dim
8:lejt
7:eguah
8:la
7:kkoh
7:lavk
7:naitsirk
7:raf
8:ege
10:ie
7:tef
7:yonnorb`, `4:rablavs
11:.sg
6:geppo
7:la
5:ojfa
9:dniv
9:k
9:vk
8:die
8:ednas
9:kkelf
8:llins
8:riel
9:ots
8:slab
9:tab
9:yt
7:les
6:ts
4:ureksub.sen
3:eayb-yrettn--nx
4:dar
5:isemmejh321
5:lom
5:rof
4:ggyr
5:nats
5:roneu
4:imeuvejsemaan
9:sekaal
5:rjea
4:jdef
6:oks
5:les
4:keraom
5:hgnaark
5:iregnir
5:kot
8:s
5:sig
6:uaf
4:lbmab
5:kyb
5:lav
6:ehtats
5:oh
4:mit
5:ojt
4:narg
5:gos
5:meh
5:reil
5:te
5:ummok
5:yrb
4:r
5:dils-ertsev
14:yo
5:ua
5:vod
4:saans
4:tleijt
5:robraa
5:spaav
4:urg
3:f62ats-ugsrop--nx
4:a10-ujvrekkhr--nx
5:7k-tajjrv-attm--nx
4:o
5:.sg
5:h
4:s
5:.sg
4:v
5:.sg
3:g5aly-yrn--nx
11:v--nx
4:allor
5:vegnal
7:lreb
4:nav
7:snellu
5:org
4:oksdie
7:mor
7:nerol
7:ro
4:reb
7:adnar
7:edyps
7:sdie
8:elf
8:gnok
8:not
5:obspras
4:uahatsla
3:h0alu-ysm--nx
4:74ay8-akiivagg--nx
5:5ay7-atkoulok--nx
4:a
5:.sg
3:iehsragev
4:khavlaraeb
5:s
4:lma
4:mpouvtalam
4:pphal
4:rrounaddleid
4:ssaneve
3:j0aoq-ysgv--nx
4:94bawh-akhojrk--nx
3:kabord
5:jks
5:lleis
4:iv
6:aklejps
6:lam
7:evs
7:u
6:mag
6:nel
6:ojg
6:ral
8:n
7:epok
7:iel
7:yor
6:sah`, `7:kel
4:kabene
4:ojsarak
4:ramdeh.aoq-relv--nx
11:relav
11:so
7:elet.ag5-b--nx
12:ob
8:ra
3:la
5:danrus
6:dnumurb
7:ron
6:egnard
7:ndua
8:te
7:smeh
8:sin
7:ttin
6:gis
7:nyl
6:kro
6:lem
7:lejfttah
8:of
7:uag-ertdim
8:s
6:nam
7:era
7:gos
7:ib
8:nroh
8:r
7:kos
7:nus
7:oj
6:o-dron
8:ros
6:ppo
6:ra
8:l
8:nram
7:egne
8:l
8:v
7:is
7:ojts
8:ts
7:ua-dron
10:ros
8:h
6:sejg
8:nivk
8:ryf
7:kav
7:mor-go-erom.ednas
19:yoreh
7:uag
6:tlas
7:rajh
7:suan
6:vla
8:e-rots
7:u-go-eron
6:yt
5:ksedlig
5:resa
4:bibeklof
7:seklyf
4:es
6:dah
4:h
5:.sg
4:im
5:syrt
4:lejf
5:ovetsua
7:gnit
7:ksa
7:sdie
4:n
5:.sg
4:o
5:.sg
5:boh
5:g
5:h
4:r
5:.sg
3:marah
5:vk
4:f
5:.sg
4:h
5:.sg
4:iehdnort
7:rtsua
7:ssej
6:rkrejb
5:ksa
4:ol
4:t
5:.sg
4:udom
5:esum
5:rab
6:drejg
6:evle
6:os
6:uh
5:ttals
3:nagav
6:okssman
5:jlis
5:khous
5:or
5:rg
6:rev
4:eddosen
8:ton
6:lah
6:ragyo
7:ojfsam
5:giets
6:nalas
9:lab
8:navk
8:targ`, `9:ddosen
8:val
9:essov
7:idol
8:lar
7:yl
6:reb
5:iks
5:ksrot
6:yor
5:ladgnos
8:ner
9:ojm
8:om
7:tloh
6:ug
5:mmard
5:ojsom
8:sendnas
5:ppolg
5:slahsladrojts
6:o
5:tol
7:t-ertsev
13:o
6:roh
5:vlykkys
8:nav
5:yam-naj
12:.sg
4:gorf
5:ujb
4:idnaort
5:etslu
5:vnarg
4:kob
4:maherka
4:nit
5:urgsrop
4:orf-dron
8:ros
4:raieb
5:evats
4:sfev
4:uaks
4:yrts
3:o6axi-ygvtsev--nx
4:c
4:dob
5:rav
4:ievs
4:kssouf
4:lmob
5:ousadna
8:echac
5:so
7:.sg
4:msdeks
4:niekotuak
4:regark
5:olf
5:yoso
4:sdav
5:mort
3:ped
4:ohsdaerpsym
4:pakdron
5:elk
3:raddjab
6:iab
5:jtif
5:luag
5:mah
5:vsyt
4:egnakiel
9:ro
8:merb
8:nat
9:mas
8:rav-ros
8:srop
8:talf
8:vats
9:el
8:yoh
7:ivsgnok
5:il
5:jkniets
5:kanvej
7:rem
7:sgnir
8:nellu
6:ie-erden
11:vo
6:ram
6:sa
5:lajf
7:vh
5:mbah
6:mahellil
5:nnul
5:tsloj
7:ul
5:yo
4:impah
4:m
5:.sg
4:osir
4:t
5:.sg
3:sadnil
4:endnas
6:edga
7:krib
10:k
8:som
7:ve
6:meh
8:jg
6:nroh-go-ejve
6:sa
7:ednil
7:ko
7:of
7:yt
6:tsev
4:gv
4:hf`, `4:igaval
4:oror
5:sman
4:sofenoh
6:m
6:v
4:uhlem
6:sreka.sen
3:tabaol
5:gaov
6:grav
5:jjrav-attam
5:lab
7:s
5:soum
5:ts
5:veib
6:our
4:ednalyoh
5:f
5:snyt
6:rokomsdeks
6:sen
5:vtpiks
4:inaks
4:lohar
4:n
5:.sg
4:oma
4:s
5:.sg
5:efremmah
5:or
4:terdi
3:ub
5:.sg
5:alk
5:edna
6:gnir
6:nner
5:les
4:drab
7:eb
4:gnasrop
5:vi
4:jdaehala
5:jedub
5:varekkhar
4:ksiouf
4:ndiaegadvoug
5:taed
3:virp
4:leslam
3:ybessen
5:nart
5:sebel
5:tsev
4:odar
6:na
8:s
6:or
5:gavtsev
5:ksa
5:lem
5:mrak
5:nart
6:nif
7:orb
5:ramah
7:n
7:v
6:edni
7:tso
8:ton
7:va
6:ul
6:yd
5:sam
6:enner
6:gav
6:lrak
6:tivk
5:vrejks
2:aki
2:isac
3:tal
2:u
1:ob
2:f
2:hay
2:o
2:ttat
1:r
2:.cer
3:erots
3:gro
3:moc
5:n
4:rif
4:t
3:oc
4:fni
3:pohs
3:stra
3:tn
3:www
3:ysrab
2:ea
4:.aac
6:cgd
6:idem
5:bulc
9:orea
5:ciffartria
7:taborea
5:ecalptekram
7:nallievrus-ria
10:ubma
9:netniam
9:rusni
8:erefnoc
6:gnahcxe
6:mordorea
6:nigne
8:lria
8:zagam
6:rawtfos
5:gnidart`, `9:ilg
12:arap
12:gnah
8:ldnahdnuorg
9:ledom
8:noollab
8:retac
8:sael
8:tlusnoc
9:uhcarap
8:vidyks
5:hcraeser
5:ixat
5:lanruoj
6:euf
6:icnuoc
6:ortnoc
12:-ciffart-ria
5:ngised
6:oinu
8:tacifitrec
10:ercer
10:gitsevni-tnedicca
12:van
10:icossa
16:-regnessap
11:valivic
10:redef
9:cudorp
9:neverp-tnedicca
5:ograc
5:pihsnoipmahc
6:uorg
10:gnikrow
5:redart
7:enigne
7:korb
7:niart
7:trahc
6:ohtua
7:tacude
5:scitsigol
6:ecivres
7:r
6:krow
6:serp
10:xe
6:tnega
5:tfarcria
11:otor
6:hgierf
9:lf
10:orcim
6:liubemoh
6:natlusnoc
7:eduts
8:mniatretne
10:revog
9:piuqe
6:olip
6:ropria
6:silanruoj
8:tneics
5:werc
6:ohs
5:ycnegreme
6:dobper
6:tefas
3:rref
3:z
2:p
3:.aaa
5:ca
5:pc
4:citeneek
4:dem
4:gne
4:korgn
4:rab
5:uj
4:snduolc
4:tacova
5:cca
5:hcer
4:wal
4:ysrab
1:s
2:.em
3:gro
3:moc
3:syevrus
3:ten
3:ude
3:vog
1:t
2:.0x
3:116
3:ayo
3:gro
3:lim
3:moc
3:sulpnpv
3:tcennockciuq.tcerid
4:en
4:ten
3:ude
3:vog
2:ohp
3:m
3:v
3:yk
2:tol
2:ua
1:viv
2:lov
1:xas
1:ykot
0:paehc
2:g
2:m
2:s
1:eej
1:g
2:.gro
3:ibom
3:moc
3:ossa
3:ten`, `3:ude
1:ir
3:.nalc
2:v
3:.sndih
2:z
1:j
2:.0g0
4:j0
4:o0o
4:t0
3:a35xq6f--nx
5:xqi0ostn--nx
4:5wtb6--nx
4:85uwuu--nx
4:9xtlk--nx
4:ad
4:bats
5:ihc
8:.abihciakoy
10:don
10:mahim
12:yeragan
14:tat
10:rabom
12:gan
12:hihci
11:uagedos
12:kas
12:ustak
10:sos
11:ufomihs
10:tamihcay
11:iran
10:wagimanah
15:o
13:omak
12:kihci
12:zustum
11:ihsak
10:yagamak
11:imonihci
9:eakas
10:nagot
9:iazni
10:esohc
10:hasa
11:sabanuf
12:ohc
10:kato
12:zok
10:musi
10:orihs
10:rakihabihsokoy
11:odim
12:tak
11:ukujuk
10:usihs
9:nanohc
13:yk
9:odiakustoy
11:ustam
10:hsonhot
10:karihs
12:t
11:iba
10:nihsaran
10:sobimanim
10:tasarihsimao
13:imot
10:uhc
10:yihcay
9:ukujno
10:sayaru
11:timik
12:tuf
10:zarasik
4:ccah
5:ed
4:gas
7:.agas
9:matamah
11:yik
10:ihsak
9:rat
9:tagatik
11:hatik
10:ira
13:ihsin
8:ekaira
9:nimimak
8:iakneg
9:garuyk
10:o
9:hcamo
11:uo
10:siorihs
9:kaznak
9:modukuf
9:ragonihsoy
11:mi
8:nezih
8:ukat
10:ohuok
9:sot
10:tarak
5:ihs
8:.akok
10:mahagan
12:yirom
11:ihsakat
10:rabiam
10:wagoton
9:emiharot
10:nokih
9:houyr
9:iazaihsin
10:esok
10:kustakat
10:moihsagih
9:namihcahimo
11:nok
9:ohsia
10:mag
10:tasoyot
11:ok
11:tir
9:usay`, `11:tasuk
12:o
4:kaso
8:.adawihsik
11:eki
10:kanoyot
12:sakaayahihc
13:oihsagih
11:oadat
11:uziak
10:mayas
15:akaso
11:odak
10:rabustam
12:wihsak
11:ediijuf
10:takarih
11:ik
12:us
10:wagayen
13:odoyihsagih
9:eson
10:tawanojihs
9:honim
9:iakas
10:hcugirom
11:sayabadnot
12:iakat
14:t
13:n
12:oyimusihsagih
10:karabi
12:sim
11:ustakat
10:muzi
10:rijat
11:otamuk
9:nanak
12:nah
13:es
9:oay
10:naganihcawak
12:simuzi
12:tak
11:eba
11:ikibah
11:oyot
10:tanim
11:iad
11:omamihs
10:uhc
9:ustoimuzi
12:tes
5:oukuf
10:.adamay
13:eos
12:gno
13:ok
13:usak
12:hiku
12:kawayim
13:uzii
12:makan
14:yasih
15:im
12:rawak
12:tagon
14:kah
16:num
16:t
13:umo
12:wagakan
16:nay
16:t
15:ias
14:ko
16:rih
12:yihsa
13:usak
11:emay
13:uruk
12:taruk
12:us
11:ianohs
13:raihcat
12:goruk
12:hcukuf
13:sagih
15:hukuy
14:in
12:kagako
14:muzim
13:iust
13:o
13:ustani
12:manim
13:otihsoynihs
13:u
12:rogo
13:ugasas
12:usu
11:nesiek
13:zub
15:kihc
11:ogukihc
12:hak
13:ot
13:ukihc
12:jono
13:ukihc
12:kayim
12:nihsukihc
12:to
12:uhc
11:ufiazad
12:gnihs
12:stoyot
7:zihs
11:.abmetog
13:damihs
14:eijuf
14:ihsoy
14:omihs
13:kouzihs
13:mihsim
13:rabiah
15:honikam
13:tawi`, `13:wagekak
16:ukik
15:kijuf
13:yimonijuf
12:iara
14:sok
13:hcamirom
13:juf
13:kazeamo
16:ustam
13:mannak
15:ta
13:nukonuzi
13:orukuf
12:nohenawak
12:onosus
13:ti
12:ustamamah
13:zamun
15:wak
14:i
15:ay
15:ihsagih
18:in
16:manim
15:mihs
4:mahokoy.*
12:ytic!
6:tias
10:.adihsoy
13:ot
13:usah
12:kadih
14:sa
13:oarihs
14:s
12:matias
14:yas
15:orom
16:tah
15:ustamihsagih
13:ihsagurust
14:jawak
13:uri
12:ni
12:wageko
16:man
15:ikot
15:o
14:kara
15:ihsoy
16:mak
14:ru
14:zorokot
12:yagamuk
15:ihsok
15:otah
14:kuf
13:imo
12:ziin
11:ebakusak
12:ogawak
12:sogo
12:ttas
12:zokoy
11:ibaraw
12:hcugawak
13:soyim
14:ubustam
12:iroy
12:kato
13:ihs
13:uk
14:stawi
12:makoyr
13:ihsoy
14:juf
13:uziimak
11:naznar
11:odakas
12:ihsay
12:jnoh
12:nago
14:nim
13:imijuf
13:nah
13:oy
12:rihsayim
13:otagan
12:tasim
17:ak
13:igus
13:omatik
12:zak
11:ubihcihc
19:ihsagih
12:sonuok
12:ynah
6:yakaw
11:.adira
14:notimak
13:kadih
13:maharihs
16:im
15:yakaw
17:tik
16:oduk
13:ruustakihcan
15:y
13:sauy
13:wagadira
17:zok
16:orih
15:konik
13:yok
13:zok
12:ebanat
13:dawi
12:igarustak
13:jiat
13:mani
12:naniak
12:obog
13:nimik
13:tasim
14:omihsah
19:uk
12:ugnihs`, `9:o
10:.ajos
12:koasak
12:mayako
15:ust
13:ihsayah
12:rabi
13:ukawaihsin
12:wiaka
14:nam
11:egakay
12:kaw
11:igan
12:hcukasa
15:otes
13:sahakat
12:kasim
13:ihsaruk
12:miin
11:nanemuk
12:ezib
11:ohsotas
12:jnihs
12:namat
13:imagak
12:ohs
12:uhcibik
7:ot
9:.adamay
11:got
11:koakat
11:mayetat
14:ot
11:nahoj
11:riat
11:wakiinakan
15:reman
10:ebayo
12:oruk
10:ihasa
12:ciimak
12:sahanuf
11:kuzanu
11:mani
14:ot
12:ih
10:nezuyn
10:otnan
10:uhcuf
11:stimukuf
11:zimi
12:ou
5:ihsogak
12:.amayuok
15:ihsogak
14:si
14:yonak
13:ebanawak
14:natakan
17:imanim
15:uka
14:tomoonihsin
13:iadnesamustas
14:kazarukam
15:oih
14:mama
15:uzi
14:usuy
13:nesi
13:oknik
14:os
14:tomustam
13:uzimurat
9:rih
12:.akan
16:s
14:mayukuf
15:ihsorihihsagih
16:jate
17:imakikaso
14:rabohs
16:hekat
17:im
15:es
14:tiak
14:wiad
13:ekato
14:ruk
13:ihciakustah
17:mono
17:nihs
15:sinares
16:oyim
14:manimasa
14:uk
13:negokikesnij
13:ognoh
14:namuk
13:uhcuf
8:ukot
12:.abihci
14:mihsukot
19:stamok
16:m
14:wagakan
13:egihsustam
13:igum
14:hcoganas
15:soyim
14:kijaw
14:manim
15:uzia
14:ukihsihs
13:nana
16:iak
13:onati
14:turan
10:uf
12:.abatuf
14:mato
16:yenak
17:irok
15:ihsim
18:ukuf
15:os
15:uko
14:raboihsatik
15:uganat`, `14:takatik
16:mawak
16:rih
14:wagakus
17:emas
17:uy
16:kamat
18:rihs
18:sa
17:ihsi
16:nah
15:ohs
13:egnabuzia
14:iman
14:tad
16:tii
13:iadnab
14:enet
14:hsagih
16:iimagak
14:kawi
16:zimuzi
15:ubay
14:minuk
14:rook
15:ustamay
13:nihsiat
13:ogetomo
15:ihsin
15:nan
15:omihs
14:no
16:duruf
16:rih
14:rihsawani
14:tamay
16:simuzia
13:urahim
14:stamakawuzia
14:ziaihsin
17:nay
5:nug
8:.abawak
10:doyihc
10:kanna
11:oihsoy
13:juf
13:mot
10:mayakat
11:ustagaihsagih
10:nihsatak
11:nak
10:rahonagan
11:nak
11:o
11:ukati
12:mamat
10:tamun
11:inomihs
11:o
10:wakubihs
11:iem
11:ohs
9:ihsabeam
13:yabetat
10:kasakat
13:esi
10:makanim
11:uzio
10:ogamust
10:rodim
9:ojonakan
10:neu
11:oyikust
10:tnihs
9:ukomnan
10:stasuk
10:yrik
5:rep
4:nibmab
5:nog
5:ob
4:ppacihc
4:ran
7:.abihsak
9:dakatotamay
10:u
11:o
9:guraki
9:mayatikimak
16:omihs
12:irokotamay
10:oki
9:rahihsak
11:n
9:wageson
11:knet
8:ekayim
9:ozamay
9:sog
9:ustim
8:iarukas
10:wak
9:garustak
9:hciomihs
10:sinawak
9:jo
9:kamnak
11:toruk
9:makawak
9:nos
9:rnet
10:otakat
10:ugeh
8:odna
10:oyo
9:gnas
9:jnihs
9:nihsoy
15:ihsagih
9:tomarawat
9:yrok
6:rikik
4:tagamay
11:.adihsio
13:katarihs
14:ourust
13:mayakan`, `17:rum
16:enak
16:onimak
13:rukho
13:tagamay
17:nuf
15:hakat
15:kas
13:wagekas
16:orumam
15:kihsin
17:m
15:zanabo
16:enoy
16:ot
13:zuy
12:eagas
13:bonamay
13:dii
13:nihsagih
13:o
12:iagan
14:nohs
13:hasa
14:sinawak
13:nugo
12:odnet
13:jnihs
13:ynan
12:ukohak
7:iin
10:.aga
12:kium
13:oagan
12:munou
17:imanim
12:tabihs
14:giin
13:ioy
12:wagioti
14:kikes
14:zuy
13:irak
12:yijo
11:ekustim
12:mabust
11:ianiat
12:hcamakot
12:kazawihsak
15:omuzi
12:magat
14:karum
13:o
11:nanust
12:esog
11:odas
12:ihcot
12:jnas
12:kihay
13:oym
12:mak
12:naga
12:ries
11:uories
12:steoj
5:ika
8:.ago
10:kasok
11:oimak
10:tago
14:rihcah
11:ika
14:atik
10:waki
11:oyk
9:emojog
10:natim
10:suranihsagih
10:tado
11:okoy
9:ihsoyirom
10:magatak
10:naokimak
9:nesiad
9:ohakin
10:jnoh
14:iruy
10:nuzak
10:rihson
10:tasijuf
14:m
10:yjnoh
9:ukobmes
10:oppah
7:in
6:o
7:.adakatognub
9:masah
10:ihsemih
9:su
9:tekat
10:ih
11:o
8:eonokok
9:ustimak
8:ijih
9:kasinuk
10:ias
10:usu
9:mukust
8:onoognub
8:ufuy
9:juk
9:ppeb
9:suk
5:nayn
4:wagak
9:.amihsoan
11:rihotok
11:wagakihsagih
15:ya
10:emaguram
10:ijnonak
12:ustnez
11:kunas
11:monihcu
10:ohsonot
11:nnam`, `11:yotim
10:ustamakat
13:odat
11:zatu
8:nak
11:.adustam
13:kusokoy
16:tarih
13:maz
13:nibe
13:ragihsaimanim
15:hesi
16:imagas
15:wado
17:guy
14:uim
15:kamak
13:tikamay
13:wakia
16:oyik
16:umas
15:sijuf
13:yimonin
12:enokah
13:saya
12:iakan
13:esiak
13:gusta
13:hsuz
13:kasagihc
13:o
13:ukust
12:onadah
13:sio
13:tamay
6:kihsi
11:.adanihcu
13:gak
13:kihs
13:mijaw
13:tabust
14:ikawak
13:wazanak
12:igurust
13:hcionon
13:mon
13:ukah
12:nasukah
12:oanan
13:ton
16:akan
12:ukohak
13:stamok
13:zimana
14:us
6:niko
10:.ahan
12:marat
13:ijemuk
13:uru
12:nedak
14:zi
13:no
12:rahihsin
14:rih
12:wakihsi
14:niko
12:yehi
12:zonig
11:eosaru
12:seay
11:ihsagih
12:jomihs
12:kagihsi
14:not
13:ihsakot
12:maginuk
14:kihsug
14:maz
13:igo
13:otekat
12:nuga
16:noy
11:namoti
13:timoy
13:wonig
12:ijikan
13:k
11:ogan
12:jnan
12:tiadatik
16:imanim
11:ubotom
12:kusugakan
21:atik
17:imot
12:rabanoy
15:eah
4:yogan.*
10:ytic!
5:p
4:zomim
3:bus
3:c204ugv--nx
4:462a0t7--nx
4:678z7vq5d--nx
4:94ptr5--nx
4:a
4:mpopilol
3:d-2
4:17sql1--nx
4:3thr--nx
4:520xbz--nx
5:40sj5--nx
4:787tlk--nx
5:ptlk--nx
4:861ti4--nx
4:a
4:e
5:tfarcdnah
4:neirflrig
9:yob
5:om
4:ooftac
3:e16thr--nx
4:51a4m2--nx
5:9ny7k--nx
4:bok.*`, `8:ytic!
4:damydaer
4:eweep
4:garotsarukas.10ksi.3s
17:20ksi.3s
4:ibmoz
5:m
6:.abot
8:kasustam
9:uzus
8:mahim
10:yemak
11:im
9:ihs
8:nawuk
8:wiem
10:k
7:ebani
8:ogawak
8:si
10:imanim
7:iarataw
8:gusim
8:hasa
9:ciakkoy
8:kamat
10:sosik
10:t
9:iat
8:raban
7:odat
8:hik
8:namuk
9:ihseru
9:odu
10:mok
7:ust
4:kilbew
4:lasrepus
4:mihe
8:.amahataway
13:iin
12:yustam
11:ijawu
13:imak
10:taki
14:man
9:ebot
9:ianoh
10:kasam
10:rabami
9:nania
10:egokamuk
10:oot
9:ojias
10:kihcu
10:nustam
10:uhcukokihs
10:yi
12:es
9:ukohik
10:zo
4:n
5:.arukas
6:lapo
6:nerukom
7:riheg
6:omomus
6:stnim
6:teniesa.resu
6:xob-liam
6:yrovi
6:zapot
5:amihs
10:.adamah
13:ho
13:usam
12:kustay
12:ma
13:ihsonihsin
19:ko
12:wakih
11:enamihs
12:ustam
11:igaka
13:usay
12:konikak
12:mikih
11:nannu
11:omukay
14:zi
16:ihsagih
16:uko
12:nawust
12:tasim
11:ustog
12:yamat
5:nep
4:rotsnoihsaf
4:srev
4:tawi
8:.abahay
10:damay
11:on
10:koirom
10:tahonat
12:katnezukir
11:imus
10:wasijuf
13:uzim
11:ihs
9:ehonihci
14:n
13:uk
10:tawi
9:iaduf
11:murak
11:wak
10:hcusto
11:siamak
13:ukuzihs
10:joboj
11:uk
10:kamanah
13:uzuk
12:sagenak
11:esonihci
10:makatik`, `11:uziarih
15:wi
9:okayim
10:norih
12:t
10:tanufo
9:uhso
5:isarap
5:saman
5:tococ
4:ulbybab
3:g3zsiu--nx
4:71qstn--nx
4:jw
4:l
4:olbanetah
7:looc
3:h03pv23--nx
4:13ynr--nx
4:22tsiu--nx
4:61qqle--nx
4:o-hu
4:sulb
3:i54urkm--nx
4:adnes.*
10:ytic!
5:zosbew
4:ced
4:gayim
9:.adukak
11:magoihs
13:kihs
12:ihsustam
20:ihsagih
12:unawi
11:rawago
12:iho
11:tabihs
13:rum
11:wagano
13:kuruf
12:iat
11:yimot
12:ukaw
10:emot
11:nimes
10:ihsiorihs
11:kamonihsi
13:sawak
14:o
11:mak
11:rataw
12:omuram
13:tan
10:oaz
11:jagat
11:tasim
12:omamay
10:ufir
11:kirnasimanim
12:uhsakihcihs
5:ihcot
10:.agah
14:kihsa
13:ust
12:kom
12:mayo
15:usarak
13:unak
12:raboihsusan
14:watho
13:iho
13:ukas
12:takihsin
13:iay
12:wakonimak
14:zenakat
12:yimonustu
13:oihs
11:eiiju
12:kustomihs
12:nufawi
11:iakihci
12:getom
13:ihcot
13:on
11:okihsam
13:kin
12:nas
12:sioruk
12:tab
11:ubim
12:san
4:hcia
8:.adnah
10:ma
12:hakat
13:im
12:yuni
11:ihsibot
14:ust
10:rahat
12:tihs
11:ik
11:uihsagih
12:kawi
10:tihc
11:ok
12:yot
10:wakoyot
12:zani
10:yimonihci
12:rak
9:einak
10:kaoyot
11:usa
10:manokot
10:noyot
9:iagusak
11:kot
11:sia
10:eot
10:hasairawo
11:cugo
11:sahoyot
12:oyim
10:kamok
12:zako`, `11:ihssi
10:motay
10:rogamag
9:nanikeh
12:ok
10:ihssin
9:ogot
10:ihsin
10:jna
10:rihsnihs
10:suf
10:tes
9:ubo
10:raho
10:soyik
11:takihs
10:yrihc
10:zah
6:ok
8:.adusay
10:kadih
10:mayotom
10:rahim
13:usuy
11:umakan
10:sot
13:ihsin
10:wagatik
13:odoyin
12:kas
13:o
9:iesieg
10:hco
13:k
10:jamu
10:ka
12:sus
11:usto
10:magak
12:k
10:rahan
9:omukus
10:ni
11:ust
14:ihsagih
10:torum
10:yot
13:o
9:ukoknan
10:zimihsasot
6:ugamay
12:.amayukot
15:ihso
14:toyot
13:ebu
14:subat
13:igah
14:kesonomihs
14:nukawi
14:rakih
13:nanuhs
13:otagan
13:uba
14:foh
14:otim
14:stamaduk
14:uy
5:sanamay
12:.adihsoyijuf
14:mayabat
14:rahoneu
15:ustakihsin
14:wakayah
17:ijuf
16:suran
15:ohs
13:egusok
13:iak
14:hcimakan
15:sanamay
16:od
14:kasarin
15:ufeuf
16:sto
13:okakanamay
15:ihcugawakijuf
14:nihso
14:tasimawakihci
15:ukoh
14:uhc
13:spla-imanim
13:ubnan
15:onim
14:fok
14:hsok
14:rust
6:ubon
4:ix
4:karabi
10:.abukust
12:gok
12:kan
15:ihcatih
12:masak
14:timo
14:wi
13:ihsak
13:ustomihs
12:ni
12:rahihcu
14:way
13:uagimusak
14:ihcust
12:tagamay
15:eman
13:oihcatih
12:wagarukas
15:o
13:os
12:yimoihcatih
14:rom
11:ebomot
12:dirot
12:not
12:tadomihs
11:iakas
14:ot
13:rao`, `12:esukihc
12:gahakat
12:hasa
13:catih
12:karabi
14:saguyr
13:ihsani
13:uy
12:ma
12:rukustamat
11:odnab
12:giad
12:him
12:kati
12:rihsijuf
12:soj
12:tasorihs
13:im
12:yihcay
11:ufius
12:kihsu
12:simak
6:sagan
11:.amabo
14:ihsust
13:natawak
13:rabamihs
14:umo
15:ustam
13:wijihc
13:yahasi
12:iakias
13:hies
13:kasagan
14:i
13:masah
12:neznu
12:obesas
13:darih
13:teso
14:og
16:imaknihs
12:ustigot
15:onihcuk
15:uf
8:wak.*
12:ytic!
6:zayim
11:.abiihs
13:guyh
13:koebon
14:ustorom
13:mihsuk
13:remihsin
14:uatik
13:takatik
15:mim
13:wagatik
16:odak
13:ya
12:ebanakat
13:sakog
12:ihsayabok
13:kazakat
17:yim
13:manimawak
14:otinuk
16:nihs
12:nanihcin
12:ojik
14:onokayim
13:nibe
14:ust
13:tias
12:urahakat
4:rocep
6:moa
9:.adawot
11:turust
11:wasim
10:ehonihcah
17:ihs
14:nas
14:og
14:ukor
11:sario
10:ianarih
11:ganayati
11:hsioruk
11:jehon
11:kasorih
11:makihsah
11:nawo
11:ramodakan
12:omoa
10:ognihs
11:kkat
10:uragust
11:stum
6:ttot
10:.arahawak
13:uotok
12:sakaw
14:sim
11:egok
11:irottot
11:nanihcin
11:oganoy
12:nih
12:tanimiakas
11:ubnan
12:zay
13:ihc
4:ukuf
8:.adeki
10:gurust
10:mabo
12:hakat
13:im
12:yustak
10:sakaw
9:eabas
9:iakas
10:ho
10:jiehie
10:ukuf
9:nezihce
16:imanim`, `9:ono
3:k26rtl8--nx
4:43qtr5--nx
5:ytjd--nx
4:522tin--nx
4:797ti4--nx
4:cigid
6:ht
6:sevol
4:ee
4:limybab
4:nat
5:upatilol
3:l33ussp--nx
4:eccabew.resu
12:sr
5:llarap
4:lik
4:oof
4:rigetuc
3:m11tqqq--nx
4:41s3c--nx
4:a0
4:ef
4:sioge
3:n30sql1--nx
4:65zqhe--nx
4:aebyllej
5:ilognom
6:viv
4:iam
4:n7p7qrt0--nx
4:oolas
6:mflah
5:ruk
5:staw
3:o131rot--nx
4:7qrbk--nx
4:aic
4:c
4:diakkoh
11:.adeki
13:gakihset
13:hcebihs
13:kadih
14:ufib
15:narihs
13:mayiruk
14:hot
14:ihsorihatik
17:ukuf
14:oras
14:usta
13:riba
17:ka
16:o
16:uruf
14:ozo
14:ugakihsagih
15:oyot
13:sakim
13:tagikust
15:mun
13:wagakan
18:uf
17:nus
20:imak
15:karu
16:ihasa
18:sagih
17:kat
17:mak
16:omihs
16:um
15:zimawi
14:ine
14:oyk
13:yot
12:eamustam
14:nan
13:bakihs
15:yak
14:onoroh
15:to
13:ian
13:kihsam
14:ufoto
13:nakami
13:ppoko
18:ihsin
13:sotihc
13:tad
16:okah
13:uonikat
12:iabib
14:mokamot
14:nakkaw
17:oroh
16:wi
15:eomak
15:ihsatu
15:okik
15:ustamoruk
19:sakan
13:eib
13:hcioy
15:ubmek
16:irihs
14:sase
15:ekka
15:oknar
15:uesom
13:jufirihsir
13:kamamihs
14:iat
15:n
13:matik
14:otoyot
13:oakihs
15:rihs
13:rahs
15:kihsi
15:mot
14:ihsaba
17:ir
14:otarib
12:nahctuk
14:rorum`, `14:se
14:tokahs
13:uber
12:okayot
13:mire
14:ukay
13:naruf
18:imak
21:nim
13:orih
13:rihibo
16:suk
14:obah
15:hib
17:hsimak
16:sa
15:pnan
15:yan
14:umen
13:tasoyik
14:eko
14:ukoh
12:ubassa
13:kotnihs
13:massaw
14:uo
13:ppakiin
15:enioto
17:nuk
15:ip
13:rato
13:sakat
14:tebe
17:ia
18:hs
20:a
18:robon
17:me
18:om
19:takan
17:noh
19:tamah
17:omik
18:s
18:t
17:ukir
18:ppihc
18:st
15:onihsnihs
15:ufuras
14:uaru
13:yru
16:koh
13:zimihs
19:ok
5:nu
4:g
5:iti
5:oyh
8:.abmat
10:dnas
10:gusak
10:kat
11:ooyot
12:y
11:uzarakat
10:mayasas
11:irah
10:wagani
13:okak
12:kihci
14:mak
13:oy
10:yihsa
12:monihsin
9:iasak
10:hsaka
12:iat
13:nawak
10:jawa
14:imanim
11:emih
10:kagoa
12:sagama
13:ukuf
12:wihsin
11:ihsog
12:m
10:mati
10:oia
10:rogimak
9:nannas
10:esnonihs
9:ogasa
14:kat
10:ka
10:nikat
11:o
11:ustat
10:rihsay
10:sihs
10:tomus
10:yas
9:ubay
10:gnihs
4:hih
4:konip
4:lbetah
6:s
5:ik
4:mol
4:nagan
9:.abukah
11:daw
13:yim
12:eki
13:u
12:ii
11:kasay
14:uki
13:zus
12:ihsoo
12:ousay
11:mayakat
14:ii
12:ihsukufosik
13:jii
12:ukihc`, `11:ni
13:hsetat
12:uzii
11:rah
12:ugot
11:saim
11:tagamay
12:oyim
11:wagakan
15:n
14:o
13:kustam
13:ziurak
12:onim
16:imanim
12:ukoo
13:s
14:omihs
11:yako
13:rih
10:eakas
11:nagamok
11:subo
10:igakat
11:hasa
12:ca
14:mo
16:nanihs
13:uonamay
12:sukagot
11:kakas
13:mimanim
13:to
12:iaatik
14:imanim
12:oa
12:uzihcom
11:makawak
12:ijuf
12:o
13:t
11:rato
12:ijoihs
12:omakat
10:nana
11:esnoawazon
10:ohukas
11:nagan
13:kan
12:ihc
13:muza
12:ustat
11:romok
11:sigan
13:k
11:tomustam
10:ukas
12:ohukihc
11:stamega
4:ob
5:m
5:pac
4:roppas.*
11:ytic!
4:tomamuk
11:.agamay
13:rahihsin
13:sukama
19:imak
13:tamanim
12:enufim
12:ihcukik
13:kihsam
14:u
13:nugo
17:imanim
13:romakat
12:oara
13:rihsustay
13:sa
13:tamay
14:omamuk
16:us
14:u
15:koyg
13:yohc
12:usagan
13:zo
6:yk
8:.abmatoyk
10:kies
11:oemak
11:uzaw
10:mayihcukuf
15:sagih
14:muk
10:nihsamay
10:rawatiju
10:taway
11:ik
9:ebanat
15:oyk
12:ya
10:di
10:ni
9:iju
10:kazamayo
10:manim
9:natnan
9:ognatoyk
10:kum
10:mak
10:rihsamayimanim
10:ygakan
11:kakoagan
13:s
11:oj
9:uruziam
10:zayim
11:ik
4:wtc1--nx
4:ykot
8:.adihcam
12:mus
11:oyihc
10:katim
11:ihsustak
10:mat`, `13:uko
12:yarumihsagih
21:sum
11:ihsagoa
14:ika
14:o
15:t
14:uzuok
12:ren
10:rahonih
12:wasago
11:iadok
11:umah
10:ssuf
10:tik
11:o
10:waganihs
13:ode
12:kara
13:ihcat
10:yagates
11:ubihs
9:eamok
10:donih
10:mo
11:urukihsagih
10:soyik
9:ienagok
10:gani
10:hcada
13:tinuk
11:sabati
10:jnubukok
11:oihcah
10:manigus
9:ohuzim
10:jihcah
10:nakan
11:ih
13:sasum
11:urika
10:rugem
10:tamayihsagih
12:nim
11:iat
11:ok
10:uhc
10:yknub
9:ufohc
10:hcuf
10:kujnihs
3:paehc
5:rc
4:ohseht
7:iiawak
7:yub
5:lf
5:pevol
6:ydnac
5:rdkcab
7:niar
3:r2xro6--nx
4:atselttil
4:ednu
6:wohc
5:h
5:ilf
5:ppep
7:irts
7:u
5:taerg
6:tib
4:g
5:r
4:ks
4:o
5:on
4:ufekaf
3:s9nvfe--nx
4:dom
4:ndym
4:pihc
5:oo
4:remagten
4:sikhcnerf
4:ubloohcs
5:ruci
5:srev
4:xvp4--nx
3:tacyssup
5:obgip
4:erces
5:vlev
4:hginyad
4:netnocresu
4:sidas
4:ub
5:ollihc
3:u4rvp8--nx
4:fig
7:.adeki
10:ih
9:kimot
9:mayakat
10:ihsah
9:ne
9:rahagikes
15:makak
13:sak
9:tagamay
13:tik
9:wagibi
12:ustakan
11:karihs
17:ihsagih
8:ekatim
9:uawak
8:igohakas
9:hcapna
11:uonaw
9:kago
10:es
10:ot
9:manuzim
10:ijat
9:nak
9:urat
8:nanig`, `8:odog
9:jug
9:makonim
9:nim
9:roy
9:sihcih
8:ufig
9:sotom
10:tamasak
11:oay
4:hc
5:suykatik.*
14:ytic!
4:pup
4:stoknot
4:ynup
3:wgp
4:onsetihw
3:x5ytlk--nx
4:irtam
3:yadynnus
4:dr
4:knarc
4:loh
5:rig
4:moolg
4:ob
4:ppih
6:olf
4:raidanetah
5:gna
7:uh
4:u6d27srjd--nx
4:vaeh
3:z72thr--nx
4:eej
5:lur
1:k
2:.art
3:gro
3:moc
3:per
3:ude
3:vog
1:leh
2:l
1:m
2:.uj
2:ac
4:.fme.ta
2:j
1:n.*
2:d
1:og
2:hpih
3:s
4:.enilnoysrab
6:rawpohs
6:sab
5:xilpoh
5:ysrab
2:oc
2:t
3:.ldaw.*
5:ldtn
1:pa
3:.44esab
4:ahcom
5:rusah
4:b2e
5:ew
5:sc
7:.weiverp
5:uhtig
6:lckcah
4:deepseroc
6:tsoh.*
4:edualc
5:erf-korgn
5:gatskrelc
5:kalfwons.*
14:kniletavirp.*
5:lbavol
5:nilnigol
5:ralfduolc
5:sabnwaps
5:tupmocegde
5:varb
9:.s.*
4:frusdniw
4:hsadtob
4:ilressem
5:nayul
4:keelf-no
5:nalfhtron.*
5:orgn
5:relc
4:law
5:ecrev
6:napysae
5:lecpael
4:maerdepyt
4:naecolatigidno
5:epedoc
6:rim
6:via
5:ur.*
8:sltm.*
6:spu.*
4:opxe
8:.gnigats
16:.no
9:no
4:poon
4:rcne
8:.dnetnorf
5:emarf
7:saw
6:poleved.*
6:tup
5:ubaez
4:selucrehno
6:tirps
5:jasudem
5:nrettapcigam
5:porez.*
4:tayn
5:egdag`, `7:eb.*
5:ibelet
6:lmaerts
7:per
10:.di
5:luavreve.yaler
5:xenw
4:weiverptekcor
5:olfrettulf
4:xevnoc
5:lpp
4:yadotpihs
6:wliar.pu
5:filten
1:raa
3:hs
1:uekam
2:llag
2:org
5:.esruocsid
5:cts
5:kouk
5:nayalo
1:vsr
1:xece4ibgm--nx
0:qa
2:3a9y--nx
1:g
1:i
2:.gro
3:lim
3:moc
3:ten
3:ude
3:vog
1:m
1:se
0:ra
2:.acisum
4:sanes
3:bog
3:ges
4:ro
3:lautum
4:im
3:moc
3:pooc
3:rut
3:teb
5:n
4:ni
3:ude
3:vog
2:4d5a4prebgm--nx
2:b
3:.evloser
2:c
2:eydoog
2:los
2:tat
3:s
4:uen
2:ugaj
1:b
2:.21g
3:abacoros
6:iuc
5:itiruc
4:cnogoas
4:dicerapa
4:gniram
4:i
5:naiog
5:ramatnas
4:nerom
5:irdnol
4:op
4:pacam
5:irolf
5:maj
7:s
4:rief
4:tsivaob
3:b
4:aj
4:ib
4:mi
4:sb
3:cba
4:er
5:t
4:js
4:sp
4:t
5:e
3:dem
4:mb
4:nf
5:i
4:rt
3:ednarganipmac
4:ficer
4:hct
5:t
4:llivnioj
4:rdnaotnas
3:fdj
4:ed
4:gg
4:ne
5:i
3:gel
6:.ab
8:m
8:p
7:bp
7:ca
8:s
7:ec
8:p
8:s
7:fd
7:gm
7:ip
7:jr
7:la
7:ma
7:nr`, `7:og
8:r
8:t
7:pa
8:s
7:rp
8:r
7:se
8:m
8:r
7:tm
5:s
4:ls
5:z
4:nc
5:e
5:o
4:ol
6:b
6:f
6:v
4:pp
4:ro
3:hvp
3:idu
4:kiw
4:nana
4:oretin
4:pa
4:rc
5:eurab
4:sp
4:te
4:xat
3:laicos
5:tan
6:rof
4:el
4:im
4:sq
3:ma
4:da
4:egatnoc
5:leb
4:f
4:ic
4:oc
6:.etiselpmis
5:n.*
3:nce
3:oaliel
5:riebir
4:ce
5:narboir
5:saso
4:do
5:ranreboas
4:eg
5:t
4:ib
5:dar
5:ecam
5:r
4:rp
4:ta
5:erpoir
3:per
4:m
5:e
5:t
4:ooc
4:pa
4:se
3:qra
3:raf
4:ga
4:odavlas
5:j
4:tn
4:ut
3:saixac
5:mlap
5:nipmac
4:ed
4:uanam
5:j
5:m
3:tam
4:eb
5:d
5:n
5:v
4:nc
4:of
5:n
4:ra
4:sf
3:ucaug9
4:de
4:ja
4:rg
3:vda
4:ed
4:og
6:.ab
8:m
8:p
7:bp
7:ca
8:s
7:ec
8:p
8:s
7:fd
7:gm
7:ip
7:jr
7:la
7:ma
7:nr
7:og
8:r
8:t
7:pa
8:s
7:rp
8:r
7:se`, `8:m
8:r
7:tm
4:rs
4:t
3:xiv
3:zhb
4:ls
4:oc
5:f
4:yx
1:c
2:.as
3:ca
3:de
3:if
3:oc
4:g
3:ro
1:e.*
2:bew
2:ccos
2:eb
3:nigne
4:oip
3:rac
2:gniarg
5:rheob
2:hsok
3:taew
4:orb
2:itnorf
2:kcol
3:op
4:rb
2:laed
3:ffeahcs
2:mal
2:nes
2:pinuj
2:taeht
3:law
3:nec
3:snom
4:ubkcolb
3:upmoc
2:vocsid
4:rdnal
3:resbo
2:ywal
2:zifp
1:f
2:.aterg
3:bew-no
6:etis321
3:drp
3:ecitsuj-reissiuh
5:narf-ne-setsitned-sneigrurihc
4:lipuog
4:rianiretev
3:hny
3:icc
4:rgabmahc
3:moc
5:n
4:t
3:neicamrahp
4:icedem
3:ossa
3:pohsdaerpsym
3:selbatpmoc-strepxe
5:riaton
5:tsitned-sneigrurihc
5:uova
4:ndk
4:o-xbf
7:obeerf
5:xbf
6:obeerf
3:tacova
4:rop
7:orea
3:vuog
3:xobided
2:avc7ylqbgm--nx
2:s
1:g
2:.etiselpmis
3:gro
3:moc
3:ten
3:ude
3:vog
3:ysrab
1:h
2:.eman
3:moc
5:rf
3:yldnerb.pohs
3:zi
2:ur
1:i
2:.a61f4a3abgm--nx
4:rf4a3abgm--nx
3:ca
3:di
3:egdenavra
3:golbatsiv
4:ro
3:hcs
3:oc
3:ten
3:vog
2:ah
3:per
2:ew
2:lf
1:k
2:.10c
3:ca
4:s
3:em
4:n
4:p
4:r
3:gk
3:ia
4:ggnoeyg`, `4:kv
4:pa-vile
3:kubgnoeyg
8:uhc
6:noej
3:lim
4:uoes
3:mangnoeyg
8:uhc
6:noej
3:naslu
6:ub
4:dc-vile
4:oehcni
6:jead
5:wgnag
3:oc
4:g
4:i
3:ro
3:se
4:h
4:m
4:nd-vile
3:ti
3:ugead
4:jej
5:gnawg
3:vmm
2:cilf
1:l
2:.gro
3:moc
3:ten
3:ude
3:vog
1:m
2:.vog
1:n
2:.gro
3:moc
3:ofni
3:ten
3:ude
3:vog
3:zib
1:ohtua
2:tca
4:od
3:laer
1:p
2:.alsi
3:ca
3:eman
3:forp
3:gro
3:moc
3:ofni
4:rp
3:ten
4:se
3:ude
3:vog
3:zib
1:s
1:t
2:.21k
3:bew
3:cn
5:.vog
3:eman
3:gro
3:kst
3:leb
5:t
4:im
4:op
3:moc
3:neg
3:ofni
3:pek
3:rd
3:sbb
3:ten
3:ude
3:va
4:og
4:t
3:zib
2:f
2:m
1:vd
0:s8sqif--nx
1:9zqif--nx
1:a
2:.vog
2:birappnb
2:gev
2:lliv
2:mtsirhc
2:s
1:b
2:.ew
3:gro
3:moc
3:ten
3:ude
3:vog
2:oj
2:s
2:u
1:cihparg
3:p
3:tylana
2:od
1:da
2:d
2:ik
2:l
2:niwriaf
3:omaid
2:oogemoh
2:rac
1:e
2:.bewim321
4:og
3:gro
3:moc`, `5:n
3:pohsdaerpsym
3:ude
2:civres
8:.enilnigol
2:dd2bgm--nx
3:oc
5:.owo.*
2:hctaw
3:guh
2:ilppus
3:rtsudni
3:treporp
10:yrrek
2:jaiv
2:law
3:cycrotom
3:gnis
3:pats
2:mag
5:.yelp
7:zeehs
3:oh
3:reh
2:nut
2:ohs
2:picer
2:rit
3:utcip
8:.7331
5:nev
2:sirpretne
4:urc
3:ruoc
2:taicossa
2:vig
1:g
2:nidloh
1:h5c822qif--nx
1:i
2:a09--nx
2:nnet
2:rap
2:targ
1:kcor
5:.ecapsbew
6:snddym
6:tikcats
6:ytic-amil
3:us
2:hxda08--nx
2:row
1:l
2:.ca
4:s
3:gro
3:oc
4:fni
3:ten
3:ude
3:vog
3:zib
2:aed
3:tner
2:essurb
3:toh
6:yrrek
2:lahsram
2:m
2:oot
5:.rdda.nyd
10:ym
1:m
2:.etisinim
3:gro
3:moc
3:ten
3:ude
3:vog
2:b
2:etsys
7:.nerim
8:tniopthgink
2:ialc
1:naf
3:gorf
3:ol
2:iagrab
4:mod
3:giro
2:oitacav
5:cudorp
5:ulos
3:puoc
1:odnoc
2:geuj
2:ppaz
2:tohp
6:.remarf
3:ua
1:p
2:.ces
3:gro
3:moc
3:olp
3:ten
3:ude
3:vog
2:ihsralohcs
3:lihp
3:t
2:u
1:r
2:.ca
3:gro
3:ni
3:oc
3:ude
3:vog
3:xo
3:yldnerb.pohs
4:srab
2:ac
3:p
3:tiug
2:c
2:edliub
8:.etisduolc`, `3:erac
3:gor
3:levart
3:mraf
3:nniw
4:trap
3:wolf
2:otcartnoc
4:omatat
2:pj
2:uot
1:s
2:.em
3:gro
3:hcs
3:moc
3:oc
3:ten
3:ude
3:vog
3:zib
2:alg
2:enisub
8:.oc
4:tif
3:rp
5:xe
7:nacirema
3:xnal
2:iws
1:taeb
3:ob
2:ekcit
4:ram
2:fig
2:hcay
3:gilf
2:natnuocca
3:emtrapa
6:sevni
4:ve
6:.nibook
7:oc
2:rap
1:u
2:.ac
5:.21k
6:bil
6:cc
4:g
5:.21k
6:bil
6:cc
4:i
5:.21k
6:bil
6:cc
4:l
5:.21k
6:bil
6:cc
4:m
5:.21k
9:.hcorap
10:rthc
10:tvp
6:bil
6:cc
4:p
5:.21k
6:bil
6:cc
4:si
4:v
5:.21k
6:bil
6:cc
4:w
5:.21k
6:aes
7:ilartnec
8:pmylo
6:bil
6:cc
6:dnesnwot-trop
8:omder
7:rahcro-trop
6:eladrevlis
8:ttaes
7:uvelleb
6:lsi-egdirbniab
6:maiuqoh
7:iuqes
6:needreba
7:otlehs
9:ner
9:remerb
9:sgnik
6:obsluop
6:robrah-gig
6:selegna-trop
7:ilahehc
7:krof
6:tniop-worray
7:ropyek
6:woldul-trop
3:cd
5:.21k
6:bil
6:cc
4:n
5:.21k
6:bil
6:cc
4:s
5:.21k
6:bil
6:cc
3:delacsne.xhp
4:i
5:.21k
6:bil
6:cc
4:m
5:.21k
6:bil
6:cc
4:n`, `4:s
5:.bil
6:cc
4:uolcrim
3:ed
5:.cc
4:las-4-dnal
10:ffuts
4:m
5:.21k
6:bil
6:cc
5:anrevres
4:n
5:.21k
6:bil
6:cc
3:hn
5:.21k
6:bil
6:cc
4:o
5:.21k
6:bil
6:cc
3:ih
5:.bil
6:cc
4:m
5:.21k
6:bil
6:cc
7:et
6:goc
6:neg
7:otae
6:robra-nna
6:sum
6:tsd
6:wanethsaw
4:nd
4:pa-eruza
4:r
5:.bil
6:cc
4:v
5:.21k
6:bil
6:cc
4:w
5:.21k
6:bil
6:cc
3:jn
5:.21k
6:bil
6:cc
3:ka
5:.21k
6:bil
6:cc
4:o
5:.21k
6:bil
6:cc
3:la
5:.21k
6:bil
6:cc
4:f
5:.21k
6:bil
6:cc
4:i
5:.21k
6:bil
6:cc
3:mn
5:.21k
6:bil
6:cc
3:nafflog
4:i
5:.21k
6:bil
6:cc
4:m
5:.21k
6:bil
6:cc
4:sn
4:t
5:.21k
6:bil
6:cc
3:oc
5:.21k
6:bil
6:cc
4:gn
4:m
5:.21k
6:bil
6:cc
4:ttniop
3:pion
3:ra
5:.21k
6:bil
6:cc
4:o
5:.21k
6:bil
6:cc
4:p
5:.21k
6:bil
6:cc
3:sa
5:.21k
6:bil
6:cc
4:etisbeweruza
4:k
5:.21k
6:bil
6:cc
4:m`, `5:.21k
6:cc
4:nddeerf
6:uolc
3:tc
5:.21k
6:bil
6:cc
4:m
5:.21k
6:bil
6:cc
4:sohoileh
4:u
5:.21k
6:bil
6:cc
4:v
5:.21k
6:bil
6:cc
3:ug
5:.21k
6:bil
6:cc
3:vn
5:.21k
6:bil
6:cc
4:rs
6:.hg
7:lg
4:w
5:.cc
3:xt
5:.21k
6:bil
6:cc
3:yb-si
4:k
5:.21k
6:bil
6:cc
4:n
5:.21k
6:bil
6:cc
4:w
5:.21k
6:bil
6:cc
3:za
5:.21k
6:bil
6:cc
2:ah
4:uab
2:bria
2:col
2:e
3:.ytrap.resu
2:ineserf
2:lp
4:.tiyalp
11:.htiw
12:ta.*
2:xel
4:n
1:vt
1:w
2:.66duolc
3:gro
3:moc
3:rosivda.*
3:sndnyd
4:tepym
3:ten
3:ude
3:vog
2:a
3:.no.1-htron-ue.lru-adbmal
18:ppabew-refsnart
18:wolfria.*
11:uos-em.lru-adbmal
18:ppabew-refsnart
18:wolfria.*
15:fa.lru-adbmal
18:ppabew-refsnart
18:wolfria.*
15:pa.lru-adbmal
18:ppabew-refsnart
18:wolfria.*
15:ue.lru-adbmal
18:ppabew-refsnart
18:wolfria.*
9:lartnec-ac.lru-adbmal
20:ppabew-refsnart
20:wolfria.*
17:em.ppabew-refsnart
20:wolfria.*
17:li.ppabew-refsnart
20:wolfria.*
17:ue.lru-adbmal
20:ppabew-refsnart
20:wolfria.*
17:xm.ppabew-refsnart
9:tsae-as.lru-adbmal
17:ppabew-refsnart
17:wolfria.*
14:pa.lru-adbmal
17:ppabew-refsnart
17:wolfria.*
14:su.lru-adbmal
17:ppabew-refsnart
17:wolfria.*
14:vog-su.ppabew-refsnart
21:spif-ppabew-refsnart
13:htron-pa.lru-adbmal
22:ppabew-refsnart
22:wolfria.*
15:uos-pa.lru-adbmal
22:ppabew-refsnart
22:wolfria.*
11:ew-ac.ppabew-refsnart
17:wolfria.*
14:su.lru-adbmal
17:ppabew-refsnart
17:wolfria.*`, `14:ue.lru-adbmal
17:ppabew-refsnart
17:wolfria.*
14:vog-su.ppabew-refsnart
21:spif-ppabew-refsnart
7:2-htuos-pa.ppabew-refsnart
18:wolfria.*
15:ue.ppabew-refsnart
18:wolfria.*
9:lartnec-ue.ppabew-refsnart
20:wolfria.*
9:tsae-su.lru-adbmal
17:ppabew-refsnart
17:wolfria.*
13:htron-pa.lru-adbmal
22:ppabew-refsnart
22:wolfria.*
15:uos-pa.lru-adbmal
22:ppabew-refsnart
22:wolfria.*
11:ew-su.lru-adbmal
17:ppabew-refsnart
17:wolfria.*
14:ue.lru-adbmal
17:ppabew-refsnart
17:wolfria.*
7:3-tsaehtron-pa.lru-adbmal
22:ppabew-refsnart
22:wolfria.*
15:uos-pa.lru-adbmal
22:ppabew-refsnart
22:wolfria.*
11:ew-ue.lru-adbmal
17:ppabew-refsnart
17:wolfria.*
7:4-tsaehtuos-pa.ppabew-refsnart
22:wolfria.*
7:5-tsaehtuos-pa.ppabew-refsnart
22:wolfria.*
7:7-tsaehtuos-pa.ppabew-refsnart
4:rekamegas.1-htron-ue.koobeton
25:oiduts
18:uos-em.koobeton
25:oiduts
22:fa.koobeton
25:oiduts
22:pa.gnilebal
25:koobeton
25:oiduts
22:ue.koobeton
25:oiduts
16:lartnec-ac.gnilebal
27:koobeton
27:oiduts
27:spif-koobeton
24:em.koobeton
27:oiduts
24:li.koobeton
27:oiduts
24:ue.gnilebal
27:koobeton
27:oiduts
16:tsae-as.koobeton
24:oiduts
21:pa.koobeton
24:oiduts
21:su.gnilebal
24:koobeton
24:oiduts
24:spif-koobeton
21:vog-su.koobeton
28:oiduts
28:spif-koobeton
33:oiduts
20:htron-pa.gnilebal
29:koobeton
29:oiduts
22:uos-pa.gnilebal
29:koobeton
29:oiduts
18:ew-ac.koobeton
24:spif-koobeton
21:su.koobeton
24:oiduts
24:spif-koobeton
21:ue.gnilebal
24:koobeton
24:oiduts
21:vog-su.koobeton
28:oiduts
28:spif-koobeton
33:oiduts
14:2-htuos-pa.koobeton
22:ue.koobeton
25:oiduts
16:lartnec-ue.koobeton
27:oiduts
16:tsae-su.gnilebal
24:koobeton
24:oiduts
24:spif-koobeton
20:htron-pa.gnilebal
29:koobeton
29:oiduts
22:uos-pa.gnilebal
29:koobeton
29:oiduts
18:ew-su.gnilebal
24:koobeton
24:oiduts
24:spif-koobeton
21:ue.gnilebal
24:koobeton
24:oiduts
14:3-tsaehtron-pa.koobeton
29:oiduts
22:uos-pa.koobeton
29:oiduts
18:ew-ue.koobeton
24:oiduts
14:4-tsaehtuos-pa.koobeton
14:stnemirepxe.*
4:tsoper.etavirp.*
2:eiver
7:.mea
3:n
4:.elbaeciton
2:odniw`, `1:yalcrab
2:ot
0:t0srzc--nx
1:a
2:.4
3:amil4
3:ca
5:.hts
3:emohsnd
4:tiesbew321
3:gniliamerutuf
6:tsoherutuf
3:oc
4:fnistro.nednuk.*
12:xe.*
3:ph21
4:ohsdaerpsym
3:reuefknuf.neiw
4:o
3:smcerutuf.*
13:ni.*
13:xe.*
3:vg
4:irp
3:xi2
3:ym
4:tic-amil
2:c
2:e
3:s
2:hc
2:l
2:mami
2:rcomed
1:b
2:.gro
3:moc
3:ten
3:ude
3:vog
2:b
2:gl
1:catnoc
2:eles
3:rid
6:.p2pbil
6:txen
1:dimhcs
1:e
2:.eman
3:gro
3:moc
3:ofni
3:ten
3:ude
3:vog
3:zib
2:b
2:em
2:grat
2:id
2:kcirc
3:ram
2:n
3:.1dna1-sppa
4:46vpi
4:5ed
5:inu
4:6vnyd
4:77ndc.r
5:erauqs
4:al-morf
6:moob
5:minifed
5:remacytirucesym
5:tadsyawla
5:z
4:bboi
5:ewdarym
5:g
5:lyltsaf
12:.pam
4:cbaz
5:imanyd-snd
6:nagro-gnitae
6:tats-oieboda
5:paidemym
4:decalpb
6:ziamaka
5:feruza
5:hiamaka
5:irgevissam.saap.1-gs
23:nol
23:rf
23:yn
21:2-nol
23:yn
5:nab-eht-ni
5:uolc-snd
9:ehtgnituor
9:ftc
9:meaeboda
9:nievas.cdi-etsedron
17:itsalej
9:xednay
15:.egarots
17:tisbew
4:ecnarusnihtlaehezitavirp
6:rofelacs.j
5:gdeeruza
8:iamaka
5:ht-no-eciffo
5:lacsnoom
6:ibom-eruza
6:omlennut
5:mantenym.ns
6:ecnuob
6:itnuroieboda
6:ohtanyd
6:tcerider
5:nilno-evreser
6:ozdop
5:ralfduolc
14:.ndc
6:ehurht
5:s
6:abapus
5:tis-repparcs`, `7:usegde
5:zamaym
8:kcar
4:faeletis
5:crs.cos
9:resu
5:ehc-a-si
5:fgg
4:gnigats-deziamaka
13:hiamaka
12:egdeiamaka
13:tiusegde
12:iamaka
12:nigiroiamaka
12:yekegde
7:reesnes
7:sirkcilc
5:olbevres
4:hsadtob
5:vo.gnitsoh.*
8:saapbew.*
4:iamaka
5:nayul
5:pa-eruza
7:duolcvogsu.eroc.bew
24:olb
23:elif
18:subecivres
4:keeg-a-si
10:si
5:ipo
5:u
4:labolgeralfduolc.ndc
6:colottad
5:iamwt
5:meteh
5:sd-ni
6:s-77ndc
4:macasac
7:ih
5:urofniem
4:nafagp
7:lhn
6:ibed
7:llerk
5:ceralfduolc.ndc
5:dcduabkcalb
5:i
6:giroiamaka
5:o-drowyek
7:evil
7:revres
5:pv-ni
5:srh.spv
4:oc-morf
5:duppa
5:jodsnd
5:lefam
5:ned
8:.xobdnas
6:refnino
5:rp-ytinummoc
5:tlacol.*
6:tadym
4:pci.*
5:i-etsef
7:on
7:sndd
6:emoh
6:fles
6:nwo
5:j
5:mac-dnab-ta
5:o-oidar-mah
6:hbew
7:sdaerpsym
5:paduolc
12:vogsu
5:tfemoh
8:vres
5:usnd
4:reganamciffart
18:vogsu
6:tsulcyduolc
6:vres-xnk
5:vdslennahc
15:.u
4:sailanyd
9:snd
6:nymsd
5:bbevres
5:dylimaf
5:egde-ndc
6:rauqs
6:suohsyub
6:tisbeweruza
17:.10-2lartnecailartsua
22:sulartnechtuos
24:tsae
26:ew
21:3sutsae
26:ew
21:5sutsaehtron
30:uos
21:aidnihtuos
26:lartnec
26:tsew
23:satsae
29:htuos
21:egatsaisatsae
26:sulartnechtron
22:poruehtron
27:tsew
21:htronacirfahtuos
26:dnalaezwen
30:reztiws
26:eau
26:nawiat
26:ylati
27:namreg
23:uosaerok
26:ecnarf
26:ku
26:lizarb
26:nedews
21:lartnecadanac
29:erok
29:idnioij`, `30:lartsua
30:senodni
28:dnalop
28:eau
29:cnarf
29:lihc
28:htuosaidni
28:learsi
28:muigleb
28:nedews
29:iaps
28:ocixem
28:rataq
28:tsewynamreg
21:paue2sutsae
25:sulartnec
21:sulartnec
30:htron
32:uos
30:tsew
23:tsae
25:ew
21:tsaeadanac
26:ilartsua
27:rtsua
25:htuosailartsua
30:lizarb
25:kramned
25:napaj
25:yawron
23:ewacirfahtuos
26:idnioij
27:syalam
25:dnalreztiws
25:htronlearsi
30:nawiat
25:ku
25:napaj
25:yawron
18:p.*
7:ys
5:kekokohcs
5:nd-won
7:aka
7:d
8:unyd
7:golb
7:npv
6:oitcnufduolc
5:ppacitatseruza
19:.1
20:2
21:sutsae
25:ew
20:3
20:4
20:5
20:6
20:7
20:aisatsae
20:eporuetsew
20:sulartnec
5:sa-skcik
6:ecca-citats
10:duolc
5:t
6:.c.*
5:wodniw.eroc.bew
18:olb
17:elif
12:subecivres
4:tadies
5:ceffeym
7:jorprot
14:.segap
7:lespohs
5:enretnifodne
6:smem
5:farcenimevres
5:i-ekorb
7:seod
8:lles
8:teg
5:nessidym
7:tnocresuv
6:orfduolc
5:reclacol
5:sacynaeralfduolc.ndc
6:ixetnod
6:oh-spv
12:.citsalej.cir
22:lta
22:sjn
8:gnik
5:yrps
4:uh
5:nyd
5:r
4:ved-anafarg
8:naissalta.dorp.ndc
4:xinuemoh
5:spym
5:tsale.1ots-slj
11:2ots-slj
11:3ots-slj
5:unilemoh
4:yap-csbus
6:wetag-llawerif
5:ekegde
5:ffijduolc
14:.ed-1arf
15:su-1tsew
5:golonysym
5:ltsaf.dorp.a
16:labolg
11:lss.a
15:b
15:labolg
11:pam
11:slteerf
5:n-morf
6:ofipi
5:srab
4:za-morf
5:tirfym
2:p
2:tcip
2:v`, `1:fig
2:osorcim
1:g
2:.bog
3:dni
3:gro
3:lim
3:moc
3:ten
3:ude
1:h
2:.dem
3:gro
3:ler
4:op
3:moc
4:rif
3:ofni
4:rp
4:srep
5:sa
3:pohs
5:oc
3:ten
4:luda
4:r
5:a
3:ude
3:vuog
1:i
2:.a2n-loritds--nx
4:7e-etsoaellav--nx
4:8c-aneseclrof--nx
5:i-lrofanesec--nx
4:at
4:b
4:c
5:cul
4:dv
4:iblo-oipmet
8:oipmet
5:cserb
5:drabmol
5:ggof
6:urep
5:lgup
6:icis
7:me-oigger
9:oigger
6:uig-aizenev-iluirf
17:iluirf
10:ev-iluirf
12:iluirf
10:v-iluirf
11:iluirf
9:aizenev-iluirf
16:iluirf
9:ev-iluirf
11:iluirf
9:v-iluirf
10:iluirf
5:nabrev
7:cul
7:pmac
7:tac
6:idras
6:obrac-saiselgi
11:saiselgi
6:resi
5:otsip
5:rbalac
11:-oigger
11:oigger
7:mu
6:dna-attelrab-inart
10:inart-attelrab
9:attelrabinart
9:inartattelrab
9:ssela
6:epmi
6:ugil
5:tnelav-obiv
11:obiv
5:vap
5:zenev
7:ps-al
9:al
6:irog
4:liuqal
5:leib
5:osso-oisuc-onabrev
4:mor
5:rap
4:n
5:acsot
5:edom
6:is
6:sec-ilrof
9:ilrof
5:gamor-ailime
10:ailime
6:edras
11:-dus
11:dus
6:olob
5:issem
6:tal
5:ne
7:var
5:ocna
6:merc
6:rev
6:vas
4:oneg
4:p
4:r
5:acsep
6:rrac-assam
10:assam
8:ef
6:von
5:etam
5:tsailgo
12:-lled
12:lled
4:s
5:ip
5:sam-ararrac`, `8:ararrac
5:ucaris
6:gar
4:t
5:acilisab
6:recam
5:resac
5:soa
8:-d-ellav
11:lav
10:ellav
10:lav
9:ellav
8:d-ellav
10:lav
9:ellav
8:ellav
5:telrab-airdna-inart
12:inart-airdna
11:airdnainart
11:inartairdna
7:ssinatlac
4:udap
4:v
5:odap
6:neg
6:tnam
4:znairb-alled-e-aznom
12:znom
10:alledeaznom
11:znom
10:eaznom
6:ecaip
8:iv
7:soc
7:top
6:om
3:b-23
5:46
5:61
4:3c-lorit-ds-onitnert--nx
4:be-etsoa-ellav--nx
12:dellav--nx
4:c
5:f-anesec-lrof--nx
5:m-lrof-anesec--nx
4:he-etsoa-d-ellav--nx
4:m
5:u
4:o2-loritds-nezob--nx
4:sn-loritds-naslab--nx
19:ub--nx
14:nitnert--nx
4:v
5:6-lorit-dsnitnert--nx
5:7-loritds-nitnert--nx
14:onitnert--nx
4:zr-lorit-ds-nitnert--nx
15:onitnert--nx
5:s-loritds-onitnert--nx
3:cf
4:is
4:l
4:m
4:p
4:r
4:v
3:dp
4:u
5:olcnys
3:ec
5:cel
5:inev
5:nerolf
4:f
4:g
5:apemoh321
5:ida-a-onitnert
10:onitnert
9:otla
13:-onitnert
13:onitnert
8:a-onitnert
9:onitnert
8:otla
12:-onazlob
15:itnert
12:onitnert
4:hcram
4:l
4:m
5:ohsnd
6:r
4:nidu
5:onedrop
7:isorf
6:torc
4:p
4:r
4:serav
5:ilom
4:t
5:nomeip
5:seirt
6:oa
8:-d-eellav
9:eellav
8:deellav
8:eellav
4:v
4:znerif
3:ga
4:b
4:f
4:il
4:o
4:p
4:r
4:up
4:vf
3:hc
3:ib
4:c
4:dol
4:f
4:l
5:lecrev
5:opan`, `5:rof-anesec
8:anesec
4:m
4:napart
6:rt-attelrab-airdna
8:attelrabairdna
5:imir
5:ret
4:p
4:r
5:ab
6:ilgac
6:ssas
4:s
5:idnirb
4:teihc
7:r
5:sa
4:v
3:la
5:c
4:b
4:c
4:om
5:rit-deus-nitnert
14:onitnert
13:nitnert
13:onitnert
10:us-nitnert
13:onitnert
12:nitnert
12:onitnert
9:s-onitnert
10:onitnert
8:deus
12:-naslab
17:ub
14:ezob
14:itnert
13:onitnert
12:nitnert
12:onitnert
9:us-naslab
16:ub
13:ezob
13:itnert
12:onitnert
11:nitnert
8:s-onitnert
9:onitnert
3:mac
4:f
4:i
4:ol
4:r
3:na
5:lim
5:slab
7:ub
4:b
4:c
4:e
5:en.cj
5:v
5:zob
4:irut
4:m
5:p
4:p
4:r
4:t
3:oa
5:v
4:b
5:retiv
4:c
5:cel
4:enuc
4:g
5:ivor
4:idem-onadipmac
8:onadipmac
5:pmet-aiblo
9:aiblo
5:rdnos
5:zal
4:l
4:m
5:agreb
6:ret
5:oc
5:ref
7:lap
4:n
5:adipmac-oidem
12:oidem
6:lim
6:tsiro
6:zlob
5:ecip-ilocsa
9:ilocsa
5:ibru-orasep
9:orasep
6:lleva
6:rot
6:tnert
5:relas
6:ovil
5:ulleb
4:p
4:r
5:asep-onibru
9:onibru
6:znatac
5:oun
4:s
5:ivert
5:sabopmac
4:t
5:arp
5:enev
6:ssorg
5:narat
6:egirga
7:rt
7:veneb
4:zzera
6:urba`, `3:pa
4:ohsdaerpsym
4:s
4:t
3:qa
3:ra
5:m
5:s
4:b
5:a
4:c
4:f
4:g
4:k
4:me
4:o
4:p
4:s
4:t
4:v
3:sab
5:iselgi-ainobrac
11:ainobrac
4:b
4:c
4:elpan
4:i
4:m
4:ot
5:xbi
6:obdaili
4:s
4:t
4:v
3:ta
4:b
4:c
4:l
4:m
4:nomdeip
4:o
4:p
4:v
3:ude
4:l
4:n
4:p
4:s
3:va
4:og
4:p
4:s
4:t
4:v
3:ydrabmol
4:ellav-atsoa
9:atsoa
4:licis
4:nacsut
3:zal
4:b
4:c
4:p
2:derc
2:er
2:f
2:m
2:utni
1:je3a3abgm--nx
1:kh
1:l
2:.vog
2:uda
1:m
2:.gro
3:moc
3:ten
3:ude
1:namorockivdnas
3:ruatser
3:tnuocca
2:eg
3:meganam
4:piuqe
3:r
2:i
3:.ue
3:m
3:opdlog
2:opud
2:uocsid
1:ob
2:cs
4:.em
5:gro
5:oc
5:vog
8:.ecivres
8:ym
2:d
2:g
2:h
2:j
2:oferab
2:pedemoh
3:s
1:p
2:.bewanigap321
3:emon
3:gro
3:lbup
3:moc
3:ten
4:ni
3:ude
3:vog
1:ra
3:mlaw
4:s
2:epxe
2:oper
4:pus
7:.ysrab
4:s
1:s
2:.adaxiabme
4:rarik
3:emotoas`, `4:picnirp
4:rots
3:gro
3:lim
3:moc
3:nc.*
3:oc
4:dalusnoc
4:hoileh
6:n
3:ten
3:ude
2:af
2:eb
3:r
3:uq
2:i
3:rolf
3:tned
2:oh
4:.2pw
5:duolcrim
5:elej
6:tiseerf
5:flah
5:lenapysae
6:rupmet
5:spvtsaf
6:seccaduolc
5:tegdag
6:lob
6:negreme
6:safym
5:vedumpw
6:resi
3:p
4:sua
2:urt
1:t
2:.eman
3:gro
3:lim
3:moc
3:oc
4:fni
4:rp
3:ten
3:ude
3:vog
3:zib
2:ayh
2:n
2:o
3:bba
3:irram
1:uognah
1:xen
1:y
2:.gro
1:ztej
0:u25te9--nx
2:yssp--nx
1:a
2:.as
4:w
3:civ
3:di
4:lq
3:fnoc
3:gro
3:moc
6:.pohsdaerpsym
7:stelduolc.lem
3:nsa
3:sat
3:tca
4:en
4:n
3:ude
6:.as
8:w
7:cilohtac
9:v
7:dlq
7:sat
7:tca
8:n
7:wsn
3:vog
6:.as
8:w
7:civ
7:dlq
7:sat
3:wsn
3:zo
2:ti
1:c
2:.bog
3:fni
3:gro
3:moc
3:tan
4:en
3:ude
2:i
1:de
3:.tir.segap-tig
2:iab
1:e
2:.axn.*
3:emohsnd
3:lrusnart.*
3:odagod.citsalej
3:pwtcerid
3:secivresbewnozama.no.1-tsae-ed-csue.pdi-otingoc.htua
4:ndps
6:uolc
4:ruelfxued
3:wvrp
3:ysrab
1:g
2:.bew
3:gro
3:maug
4:oc
3:ofni
3:ten`, `3:ude
3:vog
1:h
2:.0002
3:acitore
4:idem
4:kitore
3:edszot
3:gro
3:ilus
3:letoh
3:malker
4:lif
4:t
4:urof
3:naltagni
3:oc
4:ediv
4:fni
4:levynok
4:nisac
3:pohs
3:rarga
3:sakal
5:zatu
4:emag
4:wen
3:tlob
4:rops
3:virp
3:xes
5:zs
3:ytic
3:zsagoj
2:os
2:sut
1:l
2:.etisbew321
1:m
2:.ca
3:gro
3:moc
3:oc
3:ro
3:ten
3:vog
1:n
2:.duolcesirpretne
3:eniesrem
6:m
3:tenkcahs
2:em
4:.enilnoysrab
5:ysrab
1:oggnaw
2:y
3:c
1:r
2:.aikymlak
5:rikhsab
5:vodrom
4:yegyda
3:bps
3:ca
3:duolcrim
3:eniram
4:rpcm
3:gbc
4:ro
3:ianatsuk
3:kihclan
4:sm
5:rogitayp
3:liamdlc.bh
5:m
3:moc
3:natsegad
3:onijym
9:.gnidnal.*
13:tsoh.*
10:murtceps.*
10:spv.*
3:pp
3:rib
5:dcm
8:.spv
6:orue
5:midalv
3:sar
4:itym
3:ten
4:ni
3:u4an
4:de
3:vog
5:n
3:ynzorg
3:zakvakidalv
2:myc
2:p
2:ug
1:s
2:.adgolov
5:nagarak
4:gulak
4:igroeg
5:kymlak
5:lerak
5:nemra
5:rikhsab
5:ssakahk
5:vodrom
5:zahkba
4:lut
4:rahkub
4:vut
4:yegyda
4:znep
3:bps
3:dabaghsa
5:rgonilest
3:gunel
3:ianatsuk
4:hcos
4:ovan
4:ttailgot
3:kalhsygnam
4:ihclan`, `4:slegnahkra
5:m
5:namrum
7:yrb
6:ibuytka
7:nbo
5:tiort
5:vorkop
3:locarak
4:ybmaj
3:nagruk
5:jiabreza
5:tsegad
7:hkazak-htron
14:tsae
3:ovonavi
3:radonsark
4:imidalv
3:tenxe
4:nekhsat
7:mihc
3:vohsalab
5:n
3:ynzorg
3:zakvakidalv
4:emret
2:tamok
3:ijuf
4:masih
1:v
2:.gro
3:moc
3:ten
3:ude
1:ykuyr
0:vb
1:c
2:.di
3:emon
4:rots
3:gro
3:lbup
3:moc
3:ten
4:ni
3:ude
3:ved
1:ed
3:.2r
4:a-si
6:ton-si
4:codeberg
4:daolyap
5:oog-a-si
4:eerf-korgn
5:garots.3t
7:tsgts.*
9:lcl.*
5:nilnigol
5:rahbew.*
5:varb
9:.s.*
4:gnigats-oned
5:olbraeb
5:ts.*
4:hcetaidem
5:sadtob
4:ipaegarots.3t
4:kcatslluf-a-si
5:orgn
4:lcl.*
5:ecrev
6:nap
5:lecpael
5:ooc-si
4:mrc.aa.*
9:p.*
9:w.*
8:ba.*
9:p.*
9:w.*
8:ca.*
9:p.*
9:w.*
8:d.*
9:a.*
9:p.*
9:w.*
8:ea.*
9:p.*
9:w.*
8:fa.*
9:p.*
9:w.*
8:ic.*
8:w.*
4:nepedoc
5:srh
4:oned
4:pl
6:.ipa
7:stcejbo
5:ohsuneviv
5:pa-rettalp
5:re
7:.bew
4:rddaym
5:esworbni.*
6:yalplacol
4:segap
5:rekrow
7:niatnocnur
4:tilper
10:.arik
11:deer
12:i
12:racip
11:ekip
12:saelererp
11:frow
11:gnigats
11:kcops
12:rik
11:labolg
11:mik
11:odo
12:ksis
11:rehcra`, `13:kcah
15:ut
14:ir
11:senob
12:irap
12:maet
11:tiprat
11:ulus
11:yawenaj
12:elsew
12:ranac
6:mx
5:luavreve.yaler
5:reclacol.resu.*
4:vresi
4:weiverpbuhtig
4:xdom
5:obdnas-ahcom
4:yawetag.*
5:lf
5:srab
1:ih
1:l
2:.di
3:fnoc
3:gro
3:lim
3:moc
3:nsa
3:ten
3:ude
3:vog
1:m
2:.eman
3:gro
3:lim
3:moc
4:uesum
3:ofni
4:rea
5:p
3:pooc
3:ten
4:ni
3:ude
3:vog
3:zib
1:og
2:m
1:rt
1:s
2:.bog
3:der
3:gro
3:moc
3:ude
1:t
2:.arukas
3:bew-eht-no
3:morf
3:naht-esrow
8:retteb
3:sndnyd
2:d
2:i
2:won
1:uqhv--nx
0:wa
2:.moc
2:l
1:b
2:.ca
3:gro
3:oc
3:ten
3:vog
1:c
2:.gro
3:moc
3:ten
3:ude
2:cp
1:eiver
2:n
3:.tekcorhtiwtliub.*
2:s
1:g
2:.xn
1:k
2:.bme
3:dni
3:gro
3:moc
3:ten
3:ude
3:vog
1:m
2:.ca
3:gro
3:moc
3:oc
3:pooc
3:ten
4:ni
3:ude
3:vog
3:zib
2:b
1:ocsom
2:h
3:s
4:.sm
2:n
3:.ereh
4:nyd
4:pmt
2:w
1:p
2:.344x
3:snduolc
3:vog
1:r
2:.ca
3:gro
3:lim
3:oc
3:pooc
3:ten`, `3:vog
2:n
1:t
2:.bulc
3:emag
3:gro
3:lim
4:ru
3:moc
6:.reliamym
3:sndym
3:ten
3:ude
3:vdi
4:og
3:zibe
1:z
2:.ca
3:gro
3:lim
3:oc
3:vog
0:xa
2:t
1:c
2:.dehcraeser
3:hta
3:ofni
3:sezziuq
4:lennuf
4:nduolc
4:rotaluclac
4:tnemssessa
5:set
3:vog
3:wonyap
1:edef
3:nay
2:ma
4:nab
2:rof
2:s
1:ilften
1:jt
1:m
2:.bog
3:gro
3:moc
3:ten
3:ude
2:g
2:ma2ibgy--nx
1:ob
3:x
2:f
2:rex
1:rbgn--nx
1:s
2:.vog
1:xamjt
4:kt
2:x
0:y4punu--nx
1:7rr03--nx
1:ad
3:iloh
4:rfkcalb
3:ot
5:.emyfilauqerp
2:g
3:.segap
2:lp
2:p
3:ila
2:rot
2:ssin
2:wdaorb
1:b
2:.fo
3:hcetaidem
3:lim
3:moc
3:vog
2:ab
2:gur
1:c
2:.ca
3:dtl
3:gro
3:lim
3:moc
6:.ecrofelacs.j
4:t
3:orp
3:segolke
4:serp
3:ten
3:vog
3:zib
2:amrahp
2:nega
1:ddadog
2:uts
1:ekcoh
2:ndys
3:om
3:rotta
2:snikcm
1:g
2:.gro
3:moc
3:oc
3:ten
3:ude
3:vog
2:olonhcet
10:.oc
2:rene
1:hpargotohp
1:id
3:.enigami
5:sruocsid
1:k
2:.gro
3:moc
3:ten
3:ude
2:s`, `1:l
2:.clp
3:dem
4:i
3:gro
3:hcs
3:moc
3:ten
3:ude
3:vog
2:f
2:imaf
6:nacirema
2:la
3:il
2:ppus
1:m
2:.eman
3:gro
3:lim
3:moc
3:ten
3:ude
3:vog
3:zib
2:edaca
7:.laiciffo
2:ra
1:napmoc
7:.xobym
2:os
1:oj
2:s
1:p
2:.gro
3:lim
3:moc
3:pooc
3:ten
3:ude
3:vog
1:recorg
3:grus
3:llag
3:viled
2:lewej
2:otcerid
2:tnuoc
2:uxul
1:s
2:.gro
3:lim
3:moc
3:ten
3:ude
3:vog
1:tefas
2:ic
3:ledif
3:nummoc
9:.bdnevar
10:gon
10:murofym
3:rahc
4:uces
3:srevinu
2:laer
2:rap
3:eporp
2:uaeb
1:u
2:.bug
3:gro
3:lim
3:moc
3:ten
3:ude
3:vg
2:b
3:tseb
1:van
1:xes
0:za
2:.eman
3:gro
3:lim
3:moc
3:oc
4:fni
4:rp
3:pp
3:ten
4:ni
3:ude
3:vog
3:zib
1:b
2:.az
3:gro
3:jsg
3:moc
3:oc
3:sndym
3:ten
3:ude
3:vog
1:c
2:.4e
3:9yxorptnetnoc.csr
3:inum.duolc.rsu
14:tlf
3:mlaer
4:urtnecatem.duolc.*
15:motsuc
3:oc
3:vog
1:d
2:.cos
3:gro
3:lop
3:moc
4:t
3:ossa
3:ten
4:ra
3:ude
3:vog
1:ib`, `3:.duolcsd
4:eht-rof
5:mos-rof
5:rom-rof
4:izoj
4:liartevitca
4:nafamm
4:pi-duolc
7:on
6:fles
5:ohbew
5:tfym
4:retteb-rof
4:sndnyd
7:uolc
4:xro
3:g
1:k
2:.duolcj
3:gro
3:lim
3:moc
3:ten
3:ude
3:vog
1:m
2:.ca
3:gro
3:lim
3:oc
3:ten
3:ude
3:vda
4:og
1:n
2:.asq-irom--nx
3:ca
3:gro
3:htlaeh
3:irc
5:oam
4:wi
6:k
3:keeg
3:lim
4:oohcs
3:neg
3:oc
3:snduolc
3:ten
4:nemailrap
4:vog
2:a
3:niflla
1:rawhcs
1:s
2:.ca
3:gro
3:oc
1:t
2:.ca
4:s
3:em
4:n
3:ibom
3:letoh
4:im
3:oc
4:fni
4:g
3:ro
3:vt
1:u
2:.gro
3:moc
3:oc
3:ten
2:rwon
1:yx
3:.enieffac
5:xe
4:hsadtob
4:lennutnepo
4:tibelet.*
1:zub`] };

// packages/attribution/src/psl.ts
function unpackRules(packed) {
  let previous = "";
  return packed.split(`
`).map((row) => {
    let colon = row.indexOf(":");
    return previous = previous.slice(0, Number(row.slice(0, colon))) + row.slice(colon + 1), [...previous].reverse().join("");
  });
}

// packages/attribution/src/index.ts
var rules = new Set(unpackRules(psl_index_default.rules.join(`
`)));
function toAsciiHost(input) {
  if (typeof input != "string" || !input || input.length > 65536 || /[\s\\]/.test(input)) return null;
  try {
    let isUrl = input.includes("://");
    if (!isUrl && ["/", "@", "?", "#"].some((part) => input.includes(part))) return null;
    let u = new URL(isUrl ? input : "http://" + input);
    if (!["http:", "https:", "ws:", "wss:"].includes(u.protocol)) return null;
    let h = u.hostname.toLowerCase().replace(/\.$/, "");
    return h.startsWith("[") || h.length <= 253 && h.split(".").every((l) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l)) ? h : null;
  } catch {
    return null;
  }
}
function v4Class(n) {
  let a = n[0], b = n[1];
  return a === 127 ? "loopback" : a === 169 && b === 254 ? "link-local" : a === 10 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 ? "private" : "public";
}
function parseIpLiteral(input) {
  let h = toAsciiHost(input);
  if (h === null) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return { version: 4, category: v4Class(h.split(".").map(Number)) };
  if (!h.startsWith("[")) return null;
  let parts = h.slice(1, -1).split("::"), left = parts[0] ? parts[0].split(":").map((x) => parseInt(x, 16)) : [], right = parts[1] ? parts[1].split(":").map((x) => parseInt(x, 16)) : [], words = parts.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill(0), ...right] : left, category = "public";
  return words.slice(0, 7).every((w) => w === 0) && words[7] === 1 ? category = "loopback" : (words[0] & 65472) === 65152 ? category = "link-local" : (words[0] & 65024) === 64512 ? category = "ULA" : words.slice(0, 5).every((w) => w === 0) && words[5] === 65535 && (category = v4Class([words[6] >> 8, words[6] & 255, words[7] >> 8, words[7] & 255])), { version: 6, category };
}
function registrableDomain(input, index = rules) {
  let h = toAsciiHost(input);
  if (h === null || parseIpLiteral(h) !== null) return null;
  let labels2 = h.split("."), suffix = 0;
  for (let i = 0; i < labels2.length; i++) {
    let candidate = labels2.slice(i).join(".");
    if (index.has("!" + candidate)) return labels2.slice(i).join(".");
    index.has(candidate) && (suffix = Math.max(suffix, labels2.length - i)), i > 0 && index.has("*." + candidate) && (suffix = Math.max(suffix, labels2.length - i + 1));
  }
  return suffix > 0 && labels2.length > suffix ? labels2.slice(-suffix - 1).join(".") : null;
}
function redactHost(input) {
  let h = toAsciiHost(input);
  if (h === null) return { kind: "unknown" };
  let ip = parseIpLiteral(h);
  if (ip) return { kind: "ip", value: ip.category };
  if (h === "localhost" || h.endsWith(".localhost")) return { kind: "local", value: "localhost" };
  if (h.endsWith(".local")) return { kind: "local", value: "local" };
  if (!h.includes(".")) return { kind: "local", value: "single-label" };
  let domain = registrableDomain(h);
  return domain === null ? { kind: "unknown" } : { kind: "registrable", value: domain };
}
function reportHost(input) {
  let h = redactHost(input);
  return h.kind === "registrable" ? h.value : null;
}
function siteRelation(a, b) {
  if (typeof a != "string" || typeof b != "string") return "unknown";
  try {
    let ua = new URL(a), ub = new URL(b);
    if (ua.origin === "null" || ub.origin === "null" || !/^https?:$/.test(ua.protocol) || !/^https?:$/.test(ub.protocol)) return "opaque";
    if (ua.origin === ub.origin) return "same-origin";
    if (ua.protocol === ub.protocol && ua.hostname === ub.hostname && (parseIpLiteral(ua.hostname) || redactHost(ua.hostname).kind === "local")) return "same-site";
    let da = registrableDomain(ua.hostname), db = registrableDomain(ub.hostname);
    return !da || !db ? "unknown" : ua.protocol === ub.protocol && da === db ? "same-site" : "cross-site";
  } catch {
    return "unknown";
  }
}

// packages/background/src/sender.ts
var DOCUMENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/, LIFECYCLES = /* @__PURE__ */ new Set(["prerender", "active", "cached", "pending_deletion"]), FRAME_TYPES = /* @__PURE__ */ new Set(["outermost_frame", "fenced_frame", "sub_frame"]);
function selfOrigin(runtimeId) {
  return "chrome-extension://" + runtimeId;
}
function schemeOf(url) {
  return url.startsWith("https://") ? "https:" : url.startsWith("http://") ? "http:" : null;
}
function readLifecycle(value) {
  return typeof value == "string" && LIFECYCLES.has(value) ? value : null;
}
function readFrameType(value) {
  return typeof value == "string" && FRAME_TYPES.has(value) ? value : null;
}
function readPageSender(sender, runtimeId) {
  if (sender.id !== runtimeId) return { ok: !1, reason: "foreign-extension" };
  if (sender.origin === selfOrigin(runtimeId)) return { ok: !1, reason: "extension-page" };
  let tabId = sender.tab?.id;
  if (typeof tabId != "number" || !Number.isInteger(tabId) || tabId < 0) return { ok: !1, reason: "no-tab" };
  let frameId = sender.frameId;
  if (typeof frameId != "number" || !Number.isInteger(frameId) || frameId < 0) return { ok: !1, reason: "no-frame" };
  let documentId2 = sender.documentId;
  if (typeof documentId2 != "string" || !DOCUMENT_ID_RE.test(documentId2)) return { ok: !1, reason: "no-document-id" };
  let url = typeof sender.url == "string" ? sender.url : "", origin = typeof sender.origin == "string" ? sender.origin : "", scheme = schemeOf(url), host2 = scheme !== null ? sanitizeHost(url) : null;
  if (host2 === null && (scheme = schemeOf(origin), host2 = scheme !== null ? sanitizeHost(origin) : null), host2 === null || scheme === null)
    return url.length === 0 && origin.length === 0 ? { ok: !1, reason: "bad-url" } : { ok: !1, reason: "opaque-origin" };
  let documentLifecycle = readLifecycle(sender.documentLifecycle), frameType = readFrameType(sender.frameType);
  return {
    ok: !0,
    context: {
      tabId,
      frameId,
      documentId: documentId2,
      documentKey: makeDocumentKey(tabId, frameId, documentId2),
      host: host2,
      originPattern: scheme + "//" + host2 + "/*",
      documentLifecycle,
      frameType
    }
  };
}
function verifyUiSender(sender, runtimeId) {
  if (sender.id !== runtimeId) return !1;
  let own3 = selfOrigin(runtimeId);
  return sender.origin !== own3 ? !1 : sender.tab === void 0 ? !0 : typeof sender.url == "string" && sender.url.startsWith(own3 + "/");
}
function redactSenderContext(context) {
  return { ...context, host: reportHost(context.host), originPattern: null };
}

// packages/export/src/index.ts
function createExportPreview(report2, now, includeHost = !1) {
  let first = report2.techniques.reduce((min, t) => Math.min(min, t.firstBucket), 2147483647);
  return {
    schemaVersion: 1,
    redacted: !0,
    documentOrdinal: 1,
    reportRevision: report2.reportRevision,
    report: {
      host: includeHost ? reportHost(report2.host) : null,
      coverageState: report2.coverageState,
      coverageFlags: [...report2.coverageFlags],
      techniques: report2.techniques.map((t) => ({
        techniqueId: t.techniqueId,
        count: t.count,
        countQuality: t.countQuality,
        phases: [...t.phases],
        signalCodes: [...t.signalCodes],
        evidenceSource: t.evidenceSource,
        integrity: t.integrity,
        interpretation: t.interpretation,
        interpretationConfidence: t.interpretationConfidence,
        attributionConfidence: t.attributionConfidence,
        firstBucket: Math.max(0, t.firstBucket - first),
        lastBucket: Math.max(0, t.lastBucket - first)
      })),
      findings: report2.findings.map((f) => ({
        findingId: f.findingId,
        ruleId: f.ruleId,
        ruleVersion: f.ruleVersion,
        techniqueId: f.techniqueId,
        interpretation: f.interpretation,
        interpretationConfidence: f.interpretationConfidence,
        evidenceIds: [...f.evidenceIds],
        counterEvidenceCodes: [...f.counterEvidenceCodes],
        limitationCodes: [...f.limitationCodes],
        vendorMatchIds: [...f.vendorMatchIds],
        ...f.coverageRef === void 0 ? {} : { coverageRef: f.coverageRef }
      })),
      vendors: report2.vendors.map((v) => ({
        vendorId: v.vendorId,
        vendorConfidence: v.vendorConfidence,
        ruleIds: [...v.ruleIds],
        evidenceSource: v.evidenceSource,
        integrity: v.integrity
      })),
      dropped: {
        observations: report2.dropped.observations,
        batches: report2.dropped.batches,
        findings: report2.dropped.findings,
        hosts: report2.dropped.hosts,
        counters: report2.dropped.counters,
        transport: report2.dropped.transport
      },
      observationAgeMinutes: report2.observedSince === null ? null : Math.min(2147483647, Math.max(0, Math.floor((now - report2.observedSince) / 6e4))),
      scopeMode: report2.scopeMode,
      ...report2.permissionChecks === void 0 ? {} : { permissionChecks: report2.permissionChecks.map((row) => ({
        permission: row.permission,
        kind: row.kind,
        result: row.result,
        count: row.count,
        countQuality: row.countQuality
      })) },
      ...report2.apiOperations === void 0 ? {} : { apiOperations: report2.apiOperations.map((row) => ({
        apiOperation: row.apiOperation,
        phase: row.phase,
        count: row.count,
        countQuality: row.countQuality
      })) },
      ...report2.requestedLocalPorts === void 0 ? {} : { requestedLocalPorts: {
        ports: [...report2.requestedLocalPorts.ports],
        truncated: report2.requestedLocalPorts.truncated
      } },
      ...report2.extensionResources === void 0 ? {} : { extensionResources: report2.extensionResources.map((row) => ({
        target: row.target,
        method: row.method,
        phase: row.phase,
        count: row.count,
        countQuality: row.countQuality
      })) },
      ...report2.responseHeaders === void 0 ? {} : { responseHeaders: readResponseHeaders(report2.responseHeaders) }
    }
  };
}

// packages/engine/src/arith.ts
function satAdd(a, b) {
  let sum = a + b;
  return sum >= 2147483647 ? 2147483647 : sum;
}
var QUALITY_RANK = { exact: 0, sampled: 1, "lower-bound": 2 };
function worstQuality(a, b) {
  return QUALITY_RANK[a] >= QUALITY_RANK[b] ? a : b;
}
function sortByEnumOrder(values, order) {
  let index = /* @__PURE__ */ new Map();
  return order.forEach((v, i) => index.set(v, i)), [...new Set(values)].sort((x, y) => (index.get(x) ?? 0) - (index.get(y) ?? 0));
}

// packages/engine/src/coverage.ts
var DEFAULT_COVERAGE_CONTEXT = Object.freeze({
  scopeMode: "off",
  accessGranted: !1,
  restricted: !1,
  paused: !1,
  inaccessibleFrames: 0
}), COVERAGE_PRECEDENCE = [
  "unsupported",
  "no-access",
  "paused",
  "degraded",
  "late-start",
  "partial",
  "active"
], COVERAGE_FLAG_STATE = Object.freeze({
  "restricted-page": "unsupported",
  "no-host-permission": "no-access",
  revoked: "no-access",
  paused: "paused",
  truncated: "degraded",
  throttled: "degraded",
  "budget-exceeded": "degraded",
  "bridge-ring-overflow": "degraded",
  "channel-gap": "degraded",
  "protocol-mismatch": "degraded",
  "late-start": "late-start",
  "hook-failed": "partial",
  "descriptor-nonconfigurable": "partial",
  "unsupported-realm": "partial",
  "worker-not-observed": "partial",
  "network-limited": "partial",
  "frames-inaccessible": "partial"
}), RANK = new Map(COVERAGE_PRECEDENCE.map((s, i) => [s, i]));
function rank(state) {
  return RANK.get(state) ?? COVERAGE_PRECEDENCE.length;
}
function computeCoverageState(flags, ctx = DEFAULT_COVERAGE_CONTEXT) {
  let best = "active", consider = (s) => {
    rank(s) < rank(best) && (best = s);
  };
  ctx.restricted && consider("unsupported"), (ctx.scopeMode === "off" || !ctx.accessGranted) && consider("no-access"), ctx.paused && consider("paused"), ctx.inaccessibleFrames > 0 && consider("partial");
  for (let f of flags) {
    let s = COVERAGE_FLAG_STATE[f];
    s !== void 0 && consider(s);
  }
  return best;
}
function coverageRef(state, flags) {
  let mask = 0;
  for (let f of flags) {
    let i = COVERAGE_FLAGS.indexOf(f);
    i >= 0 && (mask |= 1 << i);
  }
  return "cov-" + state + "-" + mask.toString(16).padStart(4, "0");
}

// packages/engine/src/codes.ts
var LIMITATION_CODES = Object.freeze({
  /** Evidence came from MAIN-world hooks and can be forged by the page (REQ-004). */
  pageControlledEvidence: "page-controlled-evidence",
  /** The purpose of the call (fingerprinting or not) is not observable. */
  purposeUnknown: "purpose-unknown",
  /** Whether the result is unique or stable was never measured (REQ-001: no fingerprint is computed). */
  uniquenessNotEstablished: "uniqueness-not-established",
  /** At least one readout threw synchronously (e.g. tainted canvas): an attempt, not a successful read. */
  readbackAttemptedFailed: "readback-attempted-failed",
  /** Thresholds are proposed, not calibrated on a corpus (ADR-010 pending). */
  uncalibratedThreshold: "uncalibrated-threshold",
  /** Counters or coverage were degraded (late start, hook failure, sampling, losses); confidence was capped. */
  coverageIncomplete: "coverage-incomplete",
  /** Vendor catalog is disabled in this build; no vendor linkage was attempted. */
  catalogDisabled: "catalog-disabled",
  /** DET-003 aggregates measureText/fillText/strokeText; the v1 contract has no per-API split. */
  textOpsUndifferentiated: "text-ops-undifferentiated",
  /** Counts cover the document lifetime; no bounded activity window can be inferred. */
  noTimeWindow: "no-time-window"
}), COUNTER_EVIDENCE_CODES = Object.freeze({
  /** Text volume typical for an editor/chart/text renderer rather than a probe. */
  highVolumeRendering: "high-volume-rendering"
}), ALL_LIMITATION_CODES = Object.freeze(Object.values(LIMITATION_CODES)), ALL_COUNTER_EVIDENCE_CODES = Object.freeze(
  Object.values(COUNTER_EVIDENCE_CODES)
);

// packages/engine/src/rules/types.ts
function findingId(ruleId, ruleVersion, techniqueId, interpretation) {
  return ruleId + "-v" + ruleVersion + "-" + techniqueId + "-" + interpretation;
}
function evidenceIdsOf(counters, max = 64) {
  let ids2 = counters.map((c) => counterKey(c.techniqueId, c.phase, c.signalCodes, c.apiOperation, c.extensionResource));
  return [...new Set(ids2)].sort().slice(0, max);
}
function makeFinding(d) {
  let f = {
    findingId: findingId(d.ruleId, d.ruleVersion, d.techniqueId, d.interpretation),
    ruleId: d.ruleId,
    ruleVersion: d.ruleVersion,
    techniqueId: d.techniqueId,
    interpretation: d.interpretation,
    interpretationConfidence: d.interpretationConfidence,
    evidenceIds: d.evidenceIds,
    counterEvidenceCodes: [...new Set(d.counterEvidenceCodes)],
    limitationCodes: [...new Set(d.limitationCodes)],
    vendorMatchIds: []
  };
  return d.coverageRef !== void 0 && (f.coverageRef = d.coverageRef), f;
}

// packages/engine/src/rules/api-use.ts
var API_USE_RULE_ID = "api-use-generic", API_USE_RULE_VERSION = "1";
function createGenericApiUseRule(claimed2) {
  let techniqueIds = TECHNIQUE_IDS.filter((id4) => !claimed2.has(id4));
  return Object.freeze({
    ruleId: API_USE_RULE_ID,
    ruleVersion: API_USE_RULE_VERSION,
    techniqueIds,
    evaluate(input) {
      let byTechnique = /* @__PURE__ */ new Map();
      for (let c of input.counters) {
        if (claimed2.has(c.techniqueId)) continue;
        let list2 = byTechnique.get(c.techniqueId);
        list2 === void 0 ? byTechnique.set(c.techniqueId, [c]) : list2.push(c);
      }
      let findings = [];
      for (let id4 of TECHNIQUE_IDS) {
        let list2 = byTechnique.get(id4);
        list2 !== void 0 && findings.push(
          makeFinding({
            ruleId: API_USE_RULE_ID,
            ruleVersion: API_USE_RULE_VERSION,
            techniqueId: id4,
            interpretation: "api-use",
            interpretationConfidence: "unassessed",
            evidenceIds: evidenceIdsOf(list2),
            counterEvidenceCodes: [],
            limitationCodes: [LIMITATION_CODES.pageControlledEvidence, LIMITATION_CODES.purposeUnknown],
            ...input.coverageRef !== void 0 ? { coverageRef: input.coverageRef } : {}
          })
        );
      }
      return findings;
    }
  });
}

// packages/engine/src/rules/thresholds/canvas-readback.v2.json
var canvas_readback_v2_default = {
  ruleVersion: "2",
  calibrated: !1,
  minReadoutsForPattern: 2,
  maxTextOpsPerReadout: 8,
  highVolumeTextOps: 200,
  patternConfidence: "low",
  possibleConfidence: "low",
  maxConfidence: "low"
};

// packages/engine/src/techniques.ts
var CANVAS_TECHNIQUE_IDS = ["DET-001", "DET-002", "DET-003", "DET-004"], CANVAS_SET = new Set(CANVAS_TECHNIQUE_IDS);
function isCanvasTechnique(id4) {
  return CANVAS_SET.has(id4);
}
var CANVAS_READOUT_TECHNIQUE_IDS = ["DET-002", "DET-001", "DET-004"], TECHNIQUE_LABEL_KEYS = Object.freeze({
  "DET-001": "card_api_use_canvas_export",
  "DET-002": "card_api_use_canvas_readback",
  "DET-003": "card_api_use_canvas_text",
  "DET-004": "card_api_use_offscreen"
}), TECHNIQUE_API_NAMES = Object.freeze({
  "DET-001": "toDataURL / toBlob",
  "DET-002": "getImageData",
  "DET-003": "measureText / fillText / strokeText",
  "DET-004": "OffscreenCanvas"
});

// packages/engine/src/rules/canvas.ts
var CANVAS_RULE_ID = "canvas-readback-after-text", CANVAS_RULE_VERSION = canvas_readback_v2_default.ruleVersion, RULE_PARAMS = Object.freeze({
  ...canvas_readback_v2_default,
  // Legacy ratio/volume values are preserved for audit history, but are not evaluated in v2.
  patternConfidence: canvas_readback_v2_default.patternConfidence,
  possibleConfidence: canvas_readback_v2_default.possibleConfidence,
  maxConfidence: canvas_readback_v2_default.maxConfidence
}), READOUT_SIGNALS = /* @__PURE__ */ new Set(["readback-after-text", "export-after-text"]), READOUT_SET = new Set(CANVAS_READOUT_TECHNIQUE_IDS), DEGRADING_SIGNALS = /* @__PURE__ */ new Set([
  "late-start",
  "hook-failed",
  "hook-replaced",
  "sample-budget-exceeded"
]), DEGRADING_FLAGS = /* @__PURE__ */ new Set([
  "late-start",
  "hook-failed",
  "descriptor-nonconfigurable",
  "truncated",
  "throttled",
  "channel-gap",
  "budget-exceeded",
  "bridge-ring-overflow",
  "protocol-mismatch"
]);
function isReadoutTechnique(id4) {
  return READOUT_SET.has(id4);
}
function canvasStats(counters, coverageFlags) {
  let stats = {
    readouts: 0,
    readoutsByTechnique: {},
    failedAttempts: 0,
    textOps: 0,
    degraded: coverageFlags.some((f) => DEGRADING_FLAGS.has(f)),
    readoutCounters: [],
    textCounters: []
  };
  for (let c of counters)
    if (isCanvasTechnique(c.techniqueId)) {
      if ((c.countQuality !== "exact" || c.signalCodes.some((s) => DEGRADING_SIGNALS.has(s))) && (stats.degraded = !0), c.techniqueId === "DET-003") {
        c.phase === "returned-sync" && c.signalCodes.includes("text-drawn") && (stats.textOps += c.count, stats.textCounters.push(c));
        continue;
      }
      if (isReadoutTechnique(c.techniqueId)) {
        if (c.phase === "threw-sync") {
          stats.failedAttempts += c.count;
          continue;
        }
        c.phase === "returned-sync" && c.signalCodes.some((s) => READOUT_SIGNALS.has(s)) && (stats.readouts += c.count, stats.readoutsByTechnique[c.techniqueId] = (stats.readoutsByTechnique[c.techniqueId] ?? 0) + c.count, stats.readoutCounters.push(c));
      }
    }
  return stats;
}
function primaryReadoutTechnique(stats) {
  let best = CANVAS_READOUT_TECHNIQUE_IDS[0], bestCount = -1;
  for (let id4 of CANVAS_READOUT_TECHNIQUE_IDS) {
    let n = stats.readoutsByTechnique[id4] ?? 0;
    n > bestCount && (best = id4, bestCount = n);
  }
  return best;
}
var CONFIDENCE_RANK = {
  unassessed: 0,
  low: 1,
  medium: 2,
  high: 3
};
function capConfidence(c) {
  let ceiling = CONFIDENCE_RANK[RULE_PARAMS.maxConfidence] < CONFIDENCE_RANK.low ? RULE_PARAMS.maxConfidence : "low";
  return CONFIDENCE_RANK[c] > CONFIDENCE_RANK[ceiling] ? ceiling : c;
}
function evaluateCanvas(input) {
  let byTechnique = /* @__PURE__ */ new Map();
  for (let c of input.counters) {
    if (!isCanvasTechnique(c.techniqueId)) continue;
    let list2 = byTechnique.get(c.techniqueId);
    list2 === void 0 ? byTechnique.set(c.techniqueId, [c]) : list2.push(c);
  }
  if (byTechnique.size === 0) return [];
  let findings = [], base = {
    ruleId: CANVAS_RULE_ID,
    ruleVersion: CANVAS_RULE_VERSION,
    ...input.coverageRef !== void 0 ? { coverageRef: input.coverageRef } : {}
  };
  for (let id4 of CANVAS_TECHNIQUE_IDS) {
    let list2 = byTechnique.get(id4);
    if (list2 === void 0) continue;
    let attemptFailed = isReadoutTechnique(id4) && list2.some((c) => c.phase === "threw-sync");
    findings.push(
      makeFinding({
        ...base,
        techniqueId: id4,
        interpretation: "api-use",
        interpretationConfidence: "unassessed",
        evidenceIds: evidenceIdsOf(list2),
        counterEvidenceCodes: [],
        limitationCodes: [
          LIMITATION_CODES.pageControlledEvidence,
          LIMITATION_CODES.purposeUnknown,
          ...attemptFailed ? [LIMITATION_CODES.readbackAttemptedFailed] : []
        ]
      })
    );
  }
  let stats = canvasStats(input.counters, input.coverageFlags);
  if (stats.textOps === 0 || stats.readouts < RULE_PARAMS.minReadoutsForPattern) return findings;
  let confidence = capConfidence(stats.degraded ? "low" : RULE_PARAMS.possibleConfidence);
  return findings.push(
    makeFinding({
      ...base,
      techniqueId: primaryReadoutTechnique(stats),
      interpretation: "possible-fingerprinting",
      interpretationConfidence: confidence,
      evidenceIds: evidenceIdsOf([...stats.readoutCounters, ...stats.textCounters]),
      counterEvidenceCodes: [],
      limitationCodes: [
        LIMITATION_CODES.pageControlledEvidence,
        LIMITATION_CODES.purposeUnknown,
        LIMITATION_CODES.uniquenessNotEstablished,
        LIMITATION_CODES.uncalibratedThreshold,
        LIMITATION_CODES.noTimeWindow,
        ...stats.failedAttempts > 0 ? [LIMITATION_CODES.readbackAttemptedFailed] : [],
        ...stats.degraded ? [LIMITATION_CODES.coverageIncomplete] : []
      ]
    })
  ), findings;
}
var canvasRule = Object.freeze({
  ruleId: CANVAS_RULE_ID,
  ruleVersion: CANVAS_RULE_VERSION,
  techniqueIds: CANVAS_TECHNIQUE_IDS,
  evaluate: evaluateCanvas
});

// packages/engine/src/rules/index.ts
var claimed = new Set(canvasRule.techniqueIds), RULES = Object.freeze([canvasRule, createGenericApiUseRule(claimed)]);
function runRules(input, rules2 = RULES) {
  let findings = [], seen = /* @__PURE__ */ new Set(), dropped = 0;
  for (let rule of rules2)
    for (let f of rule.evaluate(input)) {
      if (seen.has(f.findingId)) {
        dropped++;
        continue;
      }
      if (findings.length >= BUDGETS.maxFindingsPerDocument) {
        dropped++;
        continue;
      }
      seen.add(f.findingId), findings.push(f);
    }
  return { findings, dropped };
}

// packages/engine/src/attribution.ts
function attributionConfidence(e) {
  if (e.scriptKind === "inline" || e.scriptKind === "eval" || e.scriptKind === "blob" || e.scriptKind === "unknown") return "unknown";
  if (e.scriptKind === "external" && e.evidenceSource === "browser-network" && e.integrity === "browser-observed" && e.scriptUrl) {
    try {
      let url = new URL(e.scriptUrl);
      if (url.protocol === "http:" || url.protocol === "https:") return "exact-resource";
    } catch {
    }
    return "unknown";
  }
  return e.frameBound ? "frame-only" : "unknown";
}

// packages/engine/src/network-findings.ts
function browserNetworkFindings(counters, coverageRef2) {
  let out = [];
  for (let techniqueId of ["DET-058", "DET-060", "DET-061"]) {
    let entries = counters.filter((counter) => counter.techniqueId === techniqueId && counter.count > 0);
    if (!entries.length) continue;
    let pattern = techniqueId === "DET-060" && entries.some((counter) => counter.signalCodes.includes("local-multi-port")), dns = techniqueId === "DET-061" && entries.some((counter) => counter.signalCodes.includes("unique-subdomains"));
    out.push(makeFinding({
      ruleId: dns ? "browser-dns-series" : "browser-network-attempt",
      ruleVersion: "1",
      techniqueId,
      interpretation: dns ? "dns-test-pattern" : pattern ? "local-probe-pattern" : "api-use",
      interpretationConfidence: pattern || dns ? "low" : "unassessed",
      evidenceIds: evidenceIdsOf(entries),
      counterEvidenceCodes: [],
      limitationCodes: [LIMITATION_CODES.purposeUnknown, ...pattern || dns ? [LIMITATION_CODES.uncalibratedThreshold] : []],
      coverageRef: coverageRef2
    }));
  }
  return out;
}

// packages/engine/src/permission-checks.ts
var names3 = new Map(PERMISSION_NAMES.map((name) => ["permission-" + name, name])), results = /* @__PURE__ */ new Map([
  ["permission-granted", { kind: "permission", result: "granted" }],
  ["permission-denied", { kind: "permission", result: "denied" }],
  ["permission-prompt", { kind: "permission", result: "prompt" }],
  ["policy-allowed", { kind: "policy", result: "allowed" }],
  ["policy-blocked", { kind: "policy", result: "blocked" }]
]);
function summarizePermissionChecks(counters) {
  let rows = /* @__PURE__ */ new Map();
  for (let counter of counters) {
    if (counter.techniqueId !== "DET-039" || counter.phase !== "returned-sync" || counter.count <= 0 || counter.signalCodes.length !== 3 || !counter.signalCodes.includes("api-use")) continue;
    let permission, result, nameCount = 0, resultCount = 0;
    for (let code2 of counter.signalCodes) {
      let name = names3.get(code2), state = results.get(code2);
      name !== void 0 && (permission = name, nameCount++), state !== void 0 && (result = state, resultCount++);
    }
    if (nameCount !== 1 || resultCount !== 1 || permission === void 0 || result === void 0) continue;
    let key2 = permission + "|" + result.kind + "|" + result.result, previous = rows.get(key2);
    if (previous) {
      let total = previous.count + counter.count;
      previous.count = Math.min(2147483647, total), previous.countQuality = total > 2147483647 ? "lower-bound" : worstQuality(previous.countQuality, counter.countQuality);
    } else rows.set(key2, { permission, ...result, count: counter.count, countQuality: counter.countQuality });
  }
  return [...rows].sort(([a], [b]) => a.localeCompare(b)).map(([, row]) => row);
}

// packages/engine/src/projection.ts
var EngineInvariantError = class extends Error {
  violations;
  constructor(violations) {
    super("projection violates the redaction allowlist: " + violations.join("; ")), this.name = "EngineInvariantError", this.violations = violations;
  }
}, enumSpec = (values) => ({ t: "enum", values: new Set(values) }), count = { t: "int", min: 0, max: 2147483647 }, id2 = { t: "string", max: BUDGETS.maxIdChars, re: /^[A-Za-z0-9_-]+$/ }, code = { t: "string", max: BUDGETS.maxIdChars, re: /^[a-z0-9-]+$/ }, evidenceId = { t: "string", max: BUDGETS.maxStringChars, re: /^[A-Za-z0-9.|,_-]+$/ }, FINDING_ALLOWLIST = {
  t: "object",
  keys: {
    findingId: id2,
    ruleId: id2,
    ruleVersion: { t: "string", max: BUDGETS.maxIdChars, re: /^[A-Za-z0-9.-]+$/ },
    techniqueId: enumSpec(TECHNIQUE_IDS),
    interpretation: enumSpec(INTERPRETATIONS),
    interpretationConfidence: enumSpec(INTERPRETATION_CONFIDENCES),
    evidenceIds: { t: "array", items: evidenceId, max: 64 },
    counterEvidenceCodes: { t: "array", items: code, max: 32 },
    limitationCodes: { t: "array", items: code, max: 32 },
    vendorMatchIds: { t: "array", items: id2, max: 32 },
    coverageRef: id2
  },
  optional: /* @__PURE__ */ new Set(["coverageRef"])
}, TECHNIQUE_SUMMARY_ALLOWLIST = {
  t: "object",
  keys: {
    techniqueId: enumSpec(TECHNIQUE_IDS),
    count,
    countQuality: enumSpec(COUNT_QUALITIES),
    phases: { t: "array", items: enumSpec(PHASES), max: PHASES.length },
    signalCodes: { t: "array", items: enumSpec(SIGNAL_CODES), max: SIGNAL_CODES.length },
    evidenceSource: enumSpec(EVIDENCE_SOURCES),
    integrity: enumSpec(INTEGRITIES),
    interpretation: enumSpec(INTERPRETATIONS),
    interpretationConfidence: enumSpec(INTERPRETATION_CONFIDENCES),
    attributionConfidence: enumSpec(ATTRIBUTION_CONFIDENCES),
    firstBucket: count,
    lastBucket: count
  }
}, VENDOR_SUMMARY_ALLOWLIST = {
  t: "object",
  keys: {
    vendorId: id2,
    vendorConfidence: enumSpec(VENDOR_MATCHES),
    ruleIds: { t: "array", items: id2, max: 32 },
    evidenceSource: enumSpec(EVIDENCE_SOURCES),
    integrity: enumSpec(INTEGRITIES)
  }
}, PROJECTION_ALLOWLIST = {
  t: "object",
  keys: {
    reportRevision: count,
    documentKey: { t: "string", max: BUDGETS.maxDocumentKeyChars, re: /^[A-Za-z0-9_:.-]+$/ },
    host: { t: "nullable", inner: { t: "host" } },
    coverageState: enumSpec(COVERAGE_STATES),
    coverageFlags: { t: "array", items: enumSpec(COVERAGE_FLAGS), max: COVERAGE_FLAGS.length },
    techniques: { t: "array", items: TECHNIQUE_SUMMARY_ALLOWLIST, max: BUDGETS.maxCountersPerDocumentGroup },
    findings: { t: "array", items: FINDING_ALLOWLIST, max: BUDGETS.maxFindingsPerDocument },
    vendors: { t: "array", items: VENDOR_SUMMARY_ALLOWLIST, max: BUDGETS.maxHostsPerDocument },
    dropped: {
      t: "object",
      keys: { observations: count, batches: count, findings: count, hosts: count, counters: count, transport: count }
    },
    observedSince: { t: "nullable", inner: { t: "int", min: 0, max: Number.MAX_SAFE_INTEGER } },
    scopeMode: enumSpec(SCOPE_MODES),
    permissionChecks: { t: "array", max: MAX_PERMISSION_CHECKS, items: { t: "object", keys: {
      permission: enumSpec(PERMISSION_NAMES),
      kind: enumSpec(PERMISSION_CHECK_KINDS),
      result: enumSpec(PERMISSION_CHECK_RESULTS),
      count: { t: "int", min: 1, max: 2147483647 },
      countQuality: enumSpec(COUNT_QUALITIES)
    } } },
    apiOperations: { t: "array", max: BUDGETS.maxCountersPerDocumentGroup, items: { t: "object", keys: {
      apiOperation: enumSpec(API_OPERATIONS),
      phase: enumSpec(PHASES),
      count: { t: "int", min: 1, max: 2147483647 },
      countQuality: enumSpec(COUNT_QUALITIES)
    } } },
    requestedLocalPorts: { t: "object", keys: {
      ports: { t: "array", items: { t: "int", min: 0, max: 65535 }, max: 128 },
      truncated: { t: "boolean" }
    } },
    extensionResources: { t: "array", max: BUDGETS.maxCountersPerDocumentGroup, items: { t: "object", keys: {
      target: enumSpec(EXTENSION_TARGET_KEYS),
      method: enumSpec(EXTENSION_RESOURCE_METHODS),
      phase: enumSpec(PHASES),
      count: { t: "int", min: 1, max: 2147483647 },
      countQuality: enumSpec(COUNT_QUALITIES)
    } } },
    responseHeaders: { t: "object", keys: {
      entries: { t: "array", max: RESPONSE_HEADER_NAMES.length, items: { t: "object", keys: {
        name: enumSpec(RESPONSE_HEADER_NAMES),
        count: { t: "int", min: 1, max: 2147483647 },
        clientHints: { t: "array", max: CLIENT_HINT_NAMES.length, items: enumSpec(CLIENT_HINT_NAMES) }
      } } },
      truncated: { t: "boolean" }
    } }
  },
  optional: /* @__PURE__ */ new Set(["permissionChecks", "apiOperations", "requestedLocalPorts", "extensionResources", "responseHeaders"])
};
function isPlainObject(v) {
  if (typeof v != "object" || v === null || Array.isArray(v)) return !1;
  let proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}
function walkAllowlist(value, spec, path, out) {
  switch (spec.t) {
    case "nullable":
      if (value === null) return;
      walkAllowlist(value, spec.inner, path, out);
      return;
    case "host":
      isSanitizedHost(value) || out.push(path + ": not a sanitized host");
      return;
    case "enum":
      (typeof value != "string" || !spec.values.has(value)) && out.push(path + ": not an allowed enum member");
      return;
    case "int":
      (typeof value != "number" || !Number.isInteger(value) || value < spec.min || value > spec.max) && out.push(path + ": not an integer in range");
      return;
    case "boolean":
      typeof value != "boolean" && out.push(path + ": not a boolean");
      return;
    case "string":
      (typeof value != "string" || value.length < 1 || value.length > spec.max || !spec.re.test(value)) && out.push(path + ": string outside the allowed alphabet or length");
      return;
    case "array": {
      if (!Array.isArray(value)) {
        out.push(path + ": not an array");
        return;
      }
      value.length > spec.max && out.push(path + ": too many items"), value.forEach((item, i) => walkAllowlist(item, spec.items, path + "[" + String(i) + "]", out));
      return;
    }
    case "object": {
      if (!isPlainObject(value)) {
        out.push(path + ": not a plain object");
        return;
      }
      for (let key2 of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(spec.keys, key2)) {
          out.push(path + "." + key2 + ": key not in allowlist");
          continue;
        }
        let child = spec.keys[key2];
        child !== void 0 && walkAllowlist(value[key2], child, path + "." + key2, out);
      }
      for (let key2 of Object.keys(spec.keys))
        spec.optional?.has(key2) !== !0 && (Object.prototype.hasOwnProperty.call(value, key2) || out.push(path + "." + key2 + ": missing"));
      return;
    }
  }
}
function verifyProjection(value) {
  let out = [];
  try {
    if (walkAllowlist(value, PROJECTION_ALLOWLIST, "$", out), isPlainObject(value) && Object.hasOwn(value, "permissionChecks") && readPermissionChecks(value.permissionChecks) === null && out.push("$.permissionChecks: invalid paired permission checks"), isPlainObject(value) && Object.hasOwn(value, "apiOperations") && readApiOperations(value.apiOperations) === null && out.push("$.apiOperations: invalid operation summaries"), isPlainObject(value) && Object.hasOwn(value, "extensionResources") && readExtensionResources(value.extensionResources) === null && out.push("$.extensionResources: invalid resource summaries"), isPlainObject(value) && Object.hasOwn(value, "requestedLocalPorts") && (readRequestedLocalPorts(value.requestedLocalPorts) === null || !Array.isArray(value.techniques) || !value.techniques.some((technique2) => technique2.techniqueId === "DET-060" && technique2.count > 0 && technique2.evidenceSource === "browser-network" && technique2.integrity === "browser-observed")) && out.push("$.requestedLocalPorts: invalid browser-owned port list"), isPlainObject(value) && Array.isArray(value.techniques)) {
      let headers = value.techniques.filter((technique2) => technique2.techniqueId === "DET-074"), header = headers[0], details = Object.hasOwn(value, "responseHeaders") ? readResponseHeaders(value.responseHeaders) : void 0, total = details?.entries.reduce((sum, entry) => Math.min(2147483647, sum + entry.count), 0) ?? 0;
      (details === null || headers.length !== (total > 0 ? 1 : 0) || header && (!details || header.count !== total || header.evidenceSource !== "browser-network" || header.integrity !== "browser-observed" || header.phases.length !== 0 || header.signalCodes.length !== 0 || header.interpretation !== "unknown" || header.attributionConfidence !== "frame-only" || header.firstBucket !== 0 || header.lastBucket !== 0 || header.interpretationConfidence !== "unassessed" || header.countQuality !== (details.truncated || total === 2147483647 ? "lower-bound" : "exact"))) && out.push("$.responseHeaders: invalid browser-owned header metadata");
    }
  } catch {
    out.push("$: exception while walking");
  }
  return out;
}
var INTERPRETATION_STRENGTH = {
  "fingerprinting-pattern": 0,
  "possible-fingerprinting": 1,
  "local-probe-pattern": 1,
  "dns-test-pattern": 1,
  unknown: 2,
  "api-use": 3
};
function strongestFinding(findings, techniqueId) {
  let best;
  for (let f of findings)
    f.techniqueId === techniqueId && (best === void 0 || INTERPRETATION_STRENGTH[f.interpretation] < INTERPRETATION_STRENGTH[best.interpretation]) && (best = f);
  return best;
}
function summarizeTechniques(report2) {
  let groups = /* @__PURE__ */ new Map();
  for (let c of report2.counters) {
    if (c.techniqueId === "DET-074") continue;
    let list2 = groups.get(c.techniqueId);
    list2 === void 0 ? groups.set(c.techniqueId, [c]) : list2.push(c);
  }
  let out = [];
  for (let techniqueId of TECHNIQUE_IDS) {
    let list2 = groups.get(techniqueId);
    if (list2 === void 0) continue;
    let total = 0, quality = "exact", first = 2147483647, last = 0, phases = [], signals = [];
    for (let c of list2) {
      total + c.count > 2147483647 && (quality = "lower-bound"), total = satAdd(total, c.count), quality = worstQuality(quality, c.countQuality), first = Math.min(first, c.firstBucket), last = Math.max(last, c.lastBucket), phases.push(c.phase);
      for (let s of c.signalCodes) signals.push(s);
    }
    report2.dropped.counters > 0 && (quality = "lower-bound");
    let f = strongestFinding(report2.findings, techniqueId), interpretation = f?.interpretation ?? "api-use", interpretationConfidence = f?.interpretationConfidence ?? "unassessed";
    out.push({
      techniqueId,
      count: total,
      countQuality: quality,
      phases: sortByEnumOrder(phases, PHASES),
      signalCodes: sortByEnumOrder(signals, SIGNAL_CODES),
      evidenceSource: "page-hook",
      integrity: "page-controlled",
      interpretation,
      interpretationConfidence,
      attributionConfidence: attributionConfidence({ evidenceSource: "page-hook", integrity: "page-controlled", frameBound: !0, scriptKind: "unknown" }),
      firstBucket: first,
      lastBucket: last
    });
  }
  return out;
}
function projectFinding(f, catalogEnabled) {
  let limitationCodes = catalogEnabled || f.limitationCodes.includes(LIMITATION_CODES.catalogDisabled) ? f.limitationCodes.slice() : [...f.limitationCodes, LIMITATION_CODES.catalogDisabled].slice(0, 32), out = {
    findingId: f.findingId,
    ruleId: f.ruleId,
    ruleVersion: f.ruleVersion,
    techniqueId: f.techniqueId,
    interpretation: f.interpretation,
    interpretationConfidence: f.interpretationConfidence,
    evidenceIds: f.evidenceIds.slice(0, 64),
    counterEvidenceCodes: f.counterEvidenceCodes.slice(0, 32),
    limitationCodes,
    vendorMatchIds: f.vendorMatchIds.slice(0, 32)
  };
  return f.coverageRef !== void 0 && (out.coverageRef = f.coverageRef), out;
}
function projectReport(report2, opts) {
  let network = opts.browserNetworkCounters ?? [];
  if (network.length > 4 || network.some((counter) => Object.hasOwn(counter, "apiOperation") || Object.hasOwn(counter, "extensionResource") || !["DET-058", "DET-060", "DET-061"].includes(counter.techniqueId) || counter.phase !== "attempted" || !Number.isInteger(counter.count) || counter.count < 0 || counter.count > 2147483647 || counter.signalCodes[0] !== "api-use" || counter.signalCodes.length < 1 || counter.signalCodes.length > 2 || (counter.techniqueId === "DET-061" ? counter.signalCodes.length !== 2 || counter.signalCodes[1] !== "unique-subdomains" || counter.countQuality !== "lower-bound" : counter.signalCodes.length === 2 && (counter.techniqueId !== "DET-060" || counter.signalCodes[1] !== "local-multi-port"))))
    throw new EngineInvariantError(["browser network counters outside the internal allowlist"]);
  let positiveNetwork = network.filter((counter) => counter.count > 0), browserIds = new Set(positiveNetwork.map((counter) => counter.techniqueId)), findings = [...browserNetworkFindings(positiveNetwork, coverageRef(report2.coverageState, report2.coverageFlags)), ...report2.findings.filter((finding2) => !browserIds.has(finding2.techniqueId))], findingOverflow = Math.max(0, findings.length - BUDGETS.maxFindingsPerDocument), projectedReport = browserIds.size ? {
    ...report2,
    counters: [...report2.counters.filter((counter) => !browserIds.has(counter.techniqueId)), ...positiveNetwork],
    findings
  } : report2, catalogEnabled = opts.catalogEnabled === !0, vendors = catalogEnabled ? (opts.vendors ?? []).slice(0, BUDGETS.maxHostsPerDocument).map((v) => ({
    vendorId: v.vendorId,
    vendorConfidence: v.vendorConfidence,
    ruleIds: v.ruleIds.slice(0, 32),
    evidenceSource: v.evidenceSource,
    integrity: v.integrity
  })) : [], observedSince = opts.observedSince !== void 0 ? opts.observedSince : projectedReport.counters.length > 0 || vendors.length > 0 ? report2.createdAt : null, projection = {
    reportRevision: report2.revision,
    documentKey: report2.documentKey,
    host: report2.host === null || isSanitizedHost(report2.host) ? reportHost(report2.host) : report2.host,
    coverageState: report2.coverageState,
    coverageFlags: sortByEnumOrder(report2.coverageFlags, COVERAGE_FLAGS),
    techniques: summarizeTechniques(projectedReport).map((technique2) => browserIds.has(technique2.techniqueId) ? { ...technique2, evidenceSource: "browser-network", integrity: "browser-observed", attributionConfidence: "frame-only" } : technique2),
    findings: findings.slice(0, BUDGETS.maxFindingsPerDocument).map((f) => projectFinding(f, catalogEnabled)),
    vendors,
    dropped: {
      observations: report2.dropped.observations,
      batches: report2.dropped.batches,
      findings: satAdd(report2.dropped.findings, findingOverflow),
      hosts: report2.dropped.hosts,
      counters: report2.dropped.counters,
      transport: report2.dropped.transport
    },
    observedSince,
    scopeMode: opts.scopeMode
  }, permissionChecks = summarizePermissionChecks(projectedReport.counters);
  permissionChecks.length && (projection.permissionChecks = permissionChecks);
  let operations = projectedReport.counters.filter((counter) => counter.apiOperation !== void 0 && counter.count > 0);
  if (operations.some((counter) => !apiOperationAllows(counter.apiOperation, counter.techniqueId, counter.phase) || counter.signalCodes.length !== 1 || counter.signalCodes[0] !== "api-use")) throw new EngineInvariantError(["invalid operation counter"]);
  operations.length && (projection.apiOperations = operations.map((counter) => ({
    apiOperation: counter.apiOperation,
    phase: counter.phase,
    count: counter.count,
    countQuality: report2.dropped.counters > 0 ? "lower-bound" : counter.countQuality
  })));
  let resources = projectedReport.counters.filter((counter) => counter.extensionResource !== void 0 && counter.count > 0);
  if (resources.length && (projection.extensionResources = resources.map((counter) => {
    let resource2 = readExtensionResource(counter.extensionResource);
    if (!resource2 || counter.apiOperation !== void 0 || !extensionResourceAllows(resource2, counter.techniqueId, counter.phase) || counter.signalCodes.length !== 1 || counter.signalCodes[0] !== "api-use") throw new EngineInvariantError(["invalid extension resource counter"]);
    return {
      ...resource2,
      phase: counter.phase,
      count: counter.count,
      countQuality: report2.dropped.counters > 0 ? "lower-bound" : counter.countQuality
    };
  })), opts.requestedLocalPorts !== void 0 && browserIds.has("DET-060")) {
    let ports = readRequestedLocalPorts(opts.requestedLocalPorts);
    if (ports === null) throw new EngineInvariantError(["invalid requested local ports"]);
    projection.requestedLocalPorts = ports;
  }
  if (findingOverflow > 0 && !projection.coverageFlags.includes("truncated")) {
    projection.coverageFlags = sortByEnumOrder([...projection.coverageFlags, "truncated"], COVERAGE_FLAGS), ["active", "partial", "late-start"].includes(projection.coverageState) && (projection.coverageState = "degraded");
    let ref = coverageRef(projection.coverageState, projection.coverageFlags);
    projection.findings = projection.findings.map((finding2) => ({ ...finding2, coverageRef: ref }));
  }
  let violations = verifyProjection(projection);
  if (violations.length > 0) throw new EngineInvariantError(violations);
  return opts.responseHeaders === void 0 ? projection : attachResponseHeaders(projection, opts.responseHeaders);
}
function attachResponseHeaders(projection, value) {
  let responseHeaders = readResponseHeaders(value);
  if (!responseHeaders) throw new EngineInvariantError(["invalid response headers"]);
  let techniques = projection.techniques.filter((technique2) => technique2.techniqueId !== "DET-074"), count3 = responseHeaders.entries.reduce((sum, entry) => Math.min(2147483647, sum + entry.count), 0);
  count3 > 0 && techniques.push({
    techniqueId: "DET-074",
    count: count3,
    countQuality: responseHeaders.truncated || count3 === 2147483647 ? "lower-bound" : "exact",
    phases: [],
    signalCodes: [],
    evidenceSource: "browser-network",
    integrity: "browser-observed",
    interpretation: "unknown",
    interpretationConfidence: "unassessed",
    attributionConfidence: "frame-only",
    firstBucket: 0,
    lastBucket: 0
  });
  let result = { ...projection, techniques, responseHeaders }, violations = verifyProjection(result);
  if (violations.length) throw new EngineInvariantError(violations);
  return result;
}

// packages/background/src/chrome-api.ts
var systemClock = { now: () => Date.now() };

// packages/catalog/src/vendors.runtime.json
var vendors_runtime_default = {
  "catalogVersion": "curated-2026-10-10.1",
  "rules": [
    {
      "id": "turnstile-loader-v1",
      "vendorId": "cloudflare-turnstile",
      "matcher": {
        "scheme": "https",
        "hostExact": "challenges.cloudflare.com",
        "pathExact": "/turnstile/v0/api.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "recaptcha-loader-v1",
      "vendorId": "google-recaptcha",
      "matcher": {
        "scheme": "https",
        "hostExact": "www.google.com",
        "pathExact": "/recaptcha/api.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "hcaptcha-loader-v1",
      "vendorId": "hcaptcha",
      "matcher": {
        "scheme": "https",
        "hostExact": "js.hcaptcha.com",
        "pathExact": "/1/api.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "datadome-loader-v1",
      "vendorId": "datadome",
      "matcher": {
        "scheme": "https",
        "hostExact": "js.datadome.co",
        "pathExact": "/tags.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "sift-loader-v1",
      "vendorId": "sift",
      "matcher": {
        "scheme": "https",
        "hostExact": "cdn.sift.com",
        "pathExact": "/s.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "maxmind-device-loader-v1",
      "vendorId": "maxmind-minfraud",
      "matcher": {
        "scheme": "https",
        "hostExact": "device.maxmind.com",
        "pathExact": "/js/device.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "maxmind-module-loader-v1",
      "vendorId": "maxmind-minfraud",
      "matcher": {
        "scheme": "https",
        "hostExact": "device.maxmind.com",
        "pathExact": "/js/device-module.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "threatmetrix-h-loader-v1",
      "vendorId": "threatmetrix",
      "matcher": {
        "scheme": "https",
        "hostExact": "h.online-metrix.net",
        "pathExact": "/fp/tags.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "threatmetrix-h-api-loader-v1",
      "vendorId": "threatmetrix",
      "matcher": {
        "scheme": "https",
        "hostExact": "h-api.online-metrix.net",
        "pathExact": "/fp/tags.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "arkose-client-loader-v1",
      "vendorId": "arkose",
      "matcher": {
        "scheme": "https",
        "hostExact": "client-api.arkoselabs.com",
        "pathTemplate": "arkose-v2-public-key",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "recaptcha-net-loader-v1",
      "vendorId": "google-recaptcha",
      "matcher": {
        "scheme": "https",
        "hostExact": "www.recaptcha.net",
        "pathExact": "/recaptcha/api.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "recaptcha-enterprise-loader-v1",
      "vendorId": "google-recaptcha",
      "matcher": {
        "scheme": "https",
        "hostExact": "www.google.com",
        "pathExact": "/recaptcha/enterprise.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "recaptcha-net-enterprise-loader-v1",
      "vendorId": "google-recaptcha",
      "matcher": {
        "scheme": "https",
        "hostExact": "www.recaptcha.net",
        "pathExact": "/recaptcha/enterprise.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "seon-dfsdk-v6-loader-v1",
      "vendorId": "seon",
      "matcher": {
        "scheme": "https",
        "hostExact": "cdn.dfsdk.com",
        "pathExact": "/js/v6/agent.umd.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "seon-deviceinf-v6-loader-v1",
      "vendorId": "seon",
      "matcher": {
        "scheme": "https",
        "hostExact": "cdn.deviceinf.com",
        "pathExact": "/js/v6/agent.umd.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "seon-intelligence-v6-loader-v1",
      "vendorId": "seon",
      "matcher": {
        "scheme": "https",
        "hostExact": "cdn.seonintelligence.com",
        "pathExact": "/js/v6/agent.umd.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "seon-v5-loader-v1",
      "vendorId": "seon",
      "matcher": {
        "scheme": "https",
        "hostExact": "cdn.seon.io",
        "pathExact": "/js/v5/agent.prod.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "human-sensor-loader-v1",
      "vendorId": "human",
      "matcher": {
        "scheme": "https",
        "hostExact": "client.perimeterx.net",
        "pathTemplate": "human-app-sensor",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "human-captcha-loader-v1",
      "vendorId": "human",
      "matcher": {
        "scheme": "https",
        "hostExact": "captcha.px-cdn.net",
        "pathTemplate": "human-app-captcha",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "fingerprint-v3-loader-v1",
      "vendorId": "fingerprint",
      "matcher": {
        "scheme": "https",
        "hostExact": "fpjscdn.net",
        "pathTemplate": "fingerprint-v3-key",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "fingerprint-v3-iife-loader-v1",
      "vendorId": "fingerprint",
      "matcher": {
        "scheme": "https",
        "hostExact": "fpjscdn.net",
        "pathTemplate": "fingerprint-v3-key-iife",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "fingerprint-v4-loader-v1",
      "vendorId": "fingerprint",
      "matcher": {
        "scheme": "https",
        "hostExact": "fpjscdn.net",
        "pathTemplate": "fingerprint-v4-key",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "fingerprint-v3-npm-loader-v1",
      "vendorId": "fingerprint",
      "matcher": {
        "scheme": "https",
        "hostExact": "fpnpmcdn.net",
        "pathTemplate": "fingerprint-v3-npm-loader",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "fingerprintjs-v5-loader-v1",
      "vendorId": "fingerprintjs",
      "matcher": {
        "scheme": "https",
        "hostExact": "openfpcdn.io",
        "pathExact": "/fingerprintjs/v5",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "fingerprintjs-v5-iife-loader-v1",
      "vendorId": "fingerprintjs",
      "matcher": {
        "scheme": "https",
        "hostExact": "openfpcdn.io",
        "pathExact": "/fingerprintjs/v5/iife.min.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "geetest-v4-loader-v1",
      "vendorId": "geetest",
      "matcher": {
        "scheme": "https",
        "hostExact": "static.geetest.com",
        "pathExact": "/v4/gt4.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "geetest-v3-loader-v1",
      "vendorId": "geetest",
      "matcher": {
        "scheme": "https",
        "hostExact": "static.geetest.com",
        "pathExact": "/static/js/gt.0.5.0.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "yandex-smartcaptcha-loader-v1",
      "vendorId": "yandex-smartcaptcha",
      "matcher": {
        "scheme": "https",
        "hostExact": "smartcaptcha.cloud.yandex.ru",
        "pathExact": "/captcha.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "kount-ddc-loader-v1",
      "vendorId": "kount",
      "matcher": {
        "scheme": "https",
        "hostExact": "ssl.kaptcha.com",
        "pathExact": "/collect/sdk",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "signifyd-loader-v1",
      "vendorId": "signifyd",
      "matcher": {
        "scheme": "https",
        "hostExact": "cdn-scripts.signifyd.com",
        "pathExact": "/api/script-tag.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "iovation-loader-v1",
      "vendorId": "iovation",
      "matcher": {
        "scheme": "https",
        "hostExact": "mpsnare.iesnare.com",
        "pathExact": "/snare.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "cybersource-production-loader-v1",
      "vendorId": "cybersource",
      "matcher": {
        "scheme": "https",
        "hostExact": "h.online-metrix.net",
        "pathExact": "/fp/tags.js",
        "publicOrgId": "k8vif92e",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "cybersource-sandbox-loader-v1",
      "vendorId": "cybersource",
      "matcher": {
        "scheme": "https",
        "hostExact": "h.online-metrix.net",
        "pathExact": "/fp/tags.js",
        "publicOrgId": "1snn5n9w",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "fraudlabs-pro-loader-v1",
      "vendorId": "fraudlabs-pro",
      "matcher": {
        "scheme": "https",
        "hostExact": "cdn.fraudlabspro.com",
        "pathExact": "/s.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "adyen-live-data-loader-v1",
      "vendorId": "adyen",
      "matcher": {
        "scheme": "https",
        "hostExact": "checkoutshopper-live.adyen.com",
        "pathExact": "/checkoutshopper/assets/js/datacollection/datacollection.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "adyen-test-data-loader-v1",
      "vendorId": "adyen",
      "matcher": {
        "scheme": "https",
        "hostExact": "checkoutshopper-test.adyen.com",
        "pathExact": "/checkoutshopper/assets/js/datacollection/datacollection.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "forter-3ds-loader-v1",
      "vendorId": "forter",
      "matcher": {
        "scheme": "https",
        "hostExact": "sdk.checkouttools.com",
        "pathExact": "/v1.2/managedOrders.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "paypal-fraudnet-loader-v1",
      "vendorId": "paypal-fraudnet",
      "matcher": {
        "scheme": "https",
        "hostExact": "c.paypal.com",
        "pathExact": "/da/r/fb.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "alibaba-captcha-loader-v1",
      "vendorId": "alibaba-captcha",
      "matcher": {
        "scheme": "https",
        "hostExact": "o.alicdn.com",
        "pathExact": "/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "tencent-global-captcha-loader-v1",
      "vendorId": "tencent-captcha",
      "matcher": {
        "scheme": "https",
        "hostExact": "ca.turing.captcha.qcloud.com",
        "pathExact": "/TJNCaptcha-global.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "mtcaptcha-loader-v1",
      "vendorId": "mtcaptcha",
      "matcher": {
        "scheme": "https",
        "hostExact": "service.mtcaptcha.com",
        "pathExact": "/mtcv1/client/mtcaptcha.min.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "tencent-current-captcha-loader-v1",
      "vendorId": "tencent-captcha",
      "matcher": {
        "scheme": "https",
        "hostExact": "turing.captcha.qcloud.com",
        "pathExact": "/TJCaptcha.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "tencent-legacy-captcha-loader-v1",
      "vendorId": "tencent-captcha",
      "matcher": {
        "scheme": "https",
        "hostExact": "turing.captcha.qcloud.com",
        "pathExact": "/TCaptcha.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "baidu-waf-nox-loader-v1",
      "vendorId": "baidu-waf-captcha",
      "matcher": {
        "scheme": "https",
        "hostExact": "sec-captcha-waf.cdn.bcebos.com",
        "pathExact": "/static/wb/1.0/nox_20241230.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "baidu-waf-tox-loader-v1",
      "vendorId": "baidu-waf-captcha",
      "matcher": {
        "scheme": "https",
        "hostExact": "sec-captcha-waf.cdn.bcebos.com",
        "pathExact": "/static/wb/1.0/tox_20241230.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "friendly-captcha-hcaptcha-module-loader-v1",
      "vendorId": "friendly-captcha",
      "matcher": {
        "scheme": "https",
        "hostExact": "cdn.jsdelivr.net",
        "pathExact": "/npm/@friendlycaptcha/sdk@1.0.2/contrib/hcaptcha-site.min.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "friendly-captcha-hcaptcha-compat-loader-v1",
      "vendorId": "friendly-captcha",
      "matcher": {
        "scheme": "https",
        "hostExact": "cdn.jsdelivr.net",
        "pathExact": "/npm/@friendlycaptcha/sdk@1.0.2/contrib/hcaptcha-site.compat.min.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "sumsub-websdk-loader-v1",
      "vendorId": "sumsub",
      "matcher": {
        "scheme": "https",
        "hostExact": "static.sumsub.com",
        "pathExact": "/idensic/static/sns-websdk-builder.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "mtcaptcha-fallback-loader-v1",
      "vendorId": "mtcaptcha",
      "matcher": {
        "scheme": "https",
        "hostExact": "service2.mtcaptcha.com",
        "pathExact": "/mtcv1/client/mtcaptcha2.min.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "trustdecision-behavior-loader-v1",
      "vendorId": "trustdecision",
      "matcher": {
        "scheme": "https",
        "hostExact": "static.trustdecision.com",
        "pathExact": "/tdbh/tdbehavior.min.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "netease-yidun-loader-1-v1",
      "vendorId": "netease-yidun",
      "matcher": {
        "scheme": "https",
        "hostExact": "cstaticdun.126.net",
        "pathExact": "/load.min.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "netease-yidun-loader-2-v1",
      "vendorId": "netease-yidun",
      "matcher": {
        "scheme": "https",
        "hostExact": "cstatic.dun.163yun.com",
        "pathExact": "/load.min.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "netease-yidun-loader-3-v1",
      "vendorId": "netease-yidun",
      "matcher": {
        "scheme": "https",
        "hostExact": "cstaticdun-v6.126.net",
        "pathExact": "/load.min.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "netease-yidun-loader-4-v1",
      "vendorId": "netease-yidun",
      "matcher": {
        "scheme": "https",
        "hostExact": "cstatic-v6.dun.163yun.com",
        "pathExact": "/load.min.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "friendly-captcha-module-loader-v1",
      "vendorId": "friendly-captcha",
      "matcher": {
        "scheme": "https",
        "hostExact": "cdn.jsdelivr.net",
        "pathExact": "/npm/@friendlycaptcha/sdk@1.0.2/site.min.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "friendly-captcha-compat-loader-v1",
      "vendorId": "friendly-captcha",
      "matcher": {
        "scheme": "https",
        "hostExact": "cdn.jsdelivr.net",
        "pathExact": "/npm/@friendlycaptcha/sdk@1.0.2/site.compat.min.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "clearsale-behavior-loader-v1",
      "vendorId": "clearsale",
      "matcher": {
        "scheme": "https",
        "hostExact": "device.clearsale.com.br",
        "pathExact": "/p/fp.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "socure-device-risk-loader-v1",
      "vendorId": "socure",
      "matcher": {
        "scheme": "https",
        "hostExact": "sdk.dv.socure.io",
        "pathExact": "/latest/device-risk-sdk.js",
        "resourceType": "script"
      },
      "sourceAccessedAt": "2026-09-13",
      "reviewDueAt": "2027-03-13T00:00:00.000Z"
    },
    {
      "id": "forter-cdn-resource-v1",
      "vendorId": "forter",
      "matcher": {
        "scheme": "https",
        "hostGroup": "forter-cdn-v1",
        "resourceTypes": [
          "script",
          "xmlhttprequest",
          "image",
          "ping"
        ]
      },
      "sourceAccessedAt": "2026-10-10",
      "reviewDueAt": "2027-01-10T00:00:00.000Z"
    },
    {
      "id": "forter-cloudfront-connect-v1",
      "vendorId": "forter",
      "matcher": {
        "scheme": "https",
        "hostGroup": "forter-cloudfront-connect-v1",
        "resourceTypes": [
          "xmlhttprequest",
          "image",
          "ping"
        ]
      },
      "sourceAccessedAt": "2026-10-10",
      "reviewDueAt": "2027-01-10T00:00:00.000Z"
    },
    {
      "id": "forter-cloudfront-script-v1",
      "vendorId": "forter",
      "matcher": {
        "scheme": "https",
        "hostGroup": "forter-cloudfront-script-v1",
        "resourceTypes": [
          "script"
        ]
      },
      "sourceAccessedAt": "2026-10-10",
      "reviewDueAt": "2027-01-10T00:00:00.000Z"
    }
  ]
};

// packages/catalog/src/path-templates.ts
var VENDOR_PATH_TEMPLATES = {
  "arkose-v2-public-key": /^\/v2\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\/api\.js$/,
  "fingerprint-v3-key": /^\/v3\/[a-zA-Z0-9_-]{8,64}$/,
  "fingerprint-v3-key-iife": /^\/v3\/[a-zA-Z0-9_-]{8,64}\/iife\.min\.js$/,
  "fingerprint-v4-key": /^\/v4\/[a-zA-Z0-9_-]{8,64}$/,
  "fingerprint-v3-npm-loader": /^\/v3\/[a-zA-Z0-9_-]{8,64}\/loader_v3\.[0-9]{1,3}\.[0-9]{1,3}\.js$/,
  "human-app-sensor": /^\/PX[a-zA-Z0-9]{4,32}\/main\.min\.js$/,
  "human-app-captcha": /^\/PX[a-zA-Z0-9]{4,32}\/captcha\.js$/
};
function matchesVendorPathTemplate(template, path) {
  return path.length <= 128 && Object.hasOwn(VENDOR_PATH_TEMPLATES, template) && VENDOR_PATH_TEMPLATES[template]?.test(path) === !0;
}

// packages/catalog/src/public-routing.ts
function matchesPublicOrgId(url, expected) {
  if (/%(?![a-fA-F0-9]{2})/.test(url.search)) return !1;
  let count3 = 0;
  for (let [key2, value] of url.searchParams)
    if (key2.toLowerCase() === "org_id" && (key2 !== "org_id" || value !== expected || ++count3 > 1))
      return !1;
  return count3 === 1 && url.search.slice(1).split("&").includes("org_id=" + expected);
}

// packages/catalog/src/matcher.ts
function matchOf(rule) {
  return {
    vendorId: rule.vendorId,
    ruleId: rule.id,
    vendorConfidence: "documented-resource",
    evidenceSource: "browser-network",
    integrity: "browser-observed"
  };
}
function pathMatches(rule, path) {
  return rule.matcher.pathExact !== void 0 ? path === rule.matcher.pathExact : rule.matcher.pathTemplate !== void 0 && matchesVendorPathTemplate(rule.matcher.pathTemplate, path);
}
function createVendorResourceMatcher(approvedRules) {
  let entries = approvedRules.slice(0, 64).map((rule) => ({
    rule,
    start: Date.parse(rule.sourceAccessedAt),
    end: Date.parse(rule.reviewDueAt)
  })), current = (entry, now) => Number.isFinite(now) && Number.isFinite(entry.start) && Number.isFinite(entry.end) && entry.start <= now && now < entry.end && entry.rule.matcher.scheme === "https" && entry.rule.matcher.resourceType === "script";
  return {
    /** Caller establishes completion, permissions and browser document identity.
     * A URL alone cannot authenticate a resource or prove script execution. */
    matchVendorResource(url, resourceType, nowMs) {
      if (typeof url != "string" || url.length > 4096 || resourceType !== "script" || !Number.isFinite(nowMs) || !url.startsWith("https://") || /[\u0000-\u0020\u007f\\]/.test(url)) return [];
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        return [];
      }
      if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" || parsed.port !== "" || parsed.pathname.length > 128) return [];
      let matches = [];
      for (let entry of entries)
        if (current(entry, nowMs) && parsed.hostname === entry.rule.matcher.hostExact && pathMatches(entry.rule, parsed.pathname)) {
          if (entry.rule.matcher.publicOrgId !== void 0 && !matchesPublicOrgId(parsed, entry.rule.matcher.publicOrgId))
            continue;
          if (matches.push(matchOf(entry.rule)), matches.length === 4) break;
        }
      return matches;
    },
    lookupVendorResourceRule(ruleId, nowMs) {
      if (typeof ruleId != "string" || ruleId.length > 64) return null;
      let entry = entries.find(({ rule }) => rule.id === ruleId);
      return entry !== void 0 && current(entry, nowMs) ? matchOf(entry.rule) : null;
    },
    hasEnabledVendorResourceRules(nowMs) {
      return entries.some((entry) => current(entry, nowMs));
    }
  };
}


// ADR-043: Forter resource matcher
var legacyVendorResourceMatcher = createVendorResourceMatcher;
createVendorResourceMatcher = function(approvedRules) {
  return (function createForterResourceMatcher(legacy, approvedRules, policy) {
  const groups = {
    'forter-cdn-resource-v1': ['forter-cdn-v1', ['script', 'xmlhttprequest', 'image', 'ping']],
    'forter-cloudfront-connect-v1': ['forter-cloudfront-connect-v1', ['xmlhttprequest', 'image', 'ping']],
    'forter-cloudfront-script-v1': ['forter-cloudfront-script-v1', ['script']],
  };
  const entries = approvedRules.slice(0, 64).flatMap(rule => {
    const definition = groups[rule.id], matcher = rule.matcher;
    if (!definition || rule.vendorId !== 'forter' || !matcher || matcher.scheme !== 'https' ||
        Object.keys(matcher).sort().join(',') !== 'hostGroup,resourceTypes,scheme' ||
        matcher.hostGroup !== definition[0] || !Array.isArray(matcher.resourceTypes) ||
        matcher.resourceTypes.join(',') !== definition[1].join(',') ||
        rule.sourceAccessedAt !== policy.sourceAccessedAt || rule.reviewDueAt !== policy.reviewDueAt) return [];
    return [{ rule, start: Date.parse(rule.sourceAccessedAt), end: Date.parse(rule.reviewDueAt) }];
  });
  const connect = new Set(policy.connectHosts), scripts = new Set(policy.scriptHosts);
  const current = (entry, now) => Number.isFinite(now) && entry.start <= now && now < entry.end;
  const match = entry => ({ vendorId: 'forter', ruleId: entry.rule.id,
    vendorConfidence: 'documented-resource', evidenceSource: 'browser-network', integrity: 'browser-observed' });
  const hostMatches = (group, host) => {
    if (group === 'forter-cloudfront-connect-v1') return connect.has(host);
    if (group === 'forter-cloudfront-script-v1') return scripts.has(host);
    // Dedicated CDN namespace only. A tenant/visitor label is matched transiently,
    // never returned or stored by this matcher. Corporate www/docs/portal excluded.
    return group === 'forter-cdn-v1' && host.length <= 253 &&
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)?cdn[0-9]{0,3}\.forter\.com$/.test(host);
  };
  return {
    matchVendorResource(url, type, now) {
      const previous = legacy.matchVendorResource(url, type, now);
      if (typeof url !== 'string' || url.length > 4096 || !url.startsWith('https://') ||
          !['script', 'xmlhttprequest', 'image', 'ping'].includes(type) || !Number.isFinite(now) ||
          /[\u0000-\u0020\u007f\\]/.test(url)) return previous;
      let parsed;
      try { parsed = new URL(url); } catch { return previous; }
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return previous;
      // CSP documents these dedicated endpoint hosts, not a stable request path.
      // No query, path, cookie, response body or customer ID enters a match result.
      for (const entry of entries) if (current(entry, now) && entry.rule.matcher.resourceTypes.includes(type) &&
          hostMatches(entry.rule.matcher.hostGroup, parsed.hostname)) return [...previous, match(entry)].slice(0, 4);
      return previous;
    },
    lookupVendorResourceRule(id, now) {
      const previous = legacy.lookupVendorResourceRule(id, now);
      if (previous) return previous;
      const entry = entries.find(entry => entry.rule.id === id && current(entry, now));
      return entry ? match(entry) : null;
    },
    hasEnabledVendorResourceRules(now) {
      return legacy.hasEnabledVendorResourceRules(now) || entries.some(entry => current(entry, now));
    },
  };
})(legacyVendorResourceMatcher(approvedRules), approvedRules, {"sourceAccessedAt":"2026-10-10","reviewDueAt":"2027-01-10T00:00:00.000Z","connectHosts":["d2o5idwacg3gyw.cloudfront.net","dz8rit8v72mig.cloudfront.net","db7q4jg5rkhk8.cloudfront.net","d94qwxh6czci4.cloudfront.net","dr6vcclmzwk74.cloudfront.net","d6wfl40rgh70w.cloudfront.net","d6rak4b14t5gp.cloudfront.net","d3k4bt74u9esq1.cloudfront.net","d1ezzflfzltk6e.cloudfront.net","d3nocrch4qti4v.cloudfront.net","duuytoqss3gu4.cloudfront.net","df45ay5pw60dy.cloudfront.net"],"scriptHosts":["dlthst9q2beh8.cloudfront.net","d2nww8zpyj5pk0.cloudfront.net","d2w2nqfk3z9hdt.cloudfront.net"]});
};
// ADR-043: end Forter resource matcher

// packages/catalog/src/vendors.rtc.runtime.json
var vendors_rtc_runtime_default = {
  catalogVersion: "rtc-curated-2026-09-13.2",
  rules: [
    {
      id: "threatmetrix-aa-turn-v1",
      vendorId: "threatmetrix",
      matcher: {
        hostExact: "aa.online-metrix.net",
        schemes: [
          "stun",
          "turn",
          "turns"
        ]
      },
      sourceAccessedAt: "2026-09-13",
      reviewDueAt: "2026-10-12T00:00:00.000Z"
    },
    {
      id: "fingerprint-turn-family-v1",
      vendorId: "fingerprint",
      matcher: {
        hostTemplate: "fingerprint-turn-region-v1",
        schemes: [
          "stun",
          "turn",
          "turns"
        ]
      },
      sourceAccessedAt: "2026-09-13",
      reviewDueAt: "2026-12-13T00:00:00.000Z"
    }
  ]
};

// packages/catalog/src/rtc-matcher.ts
function hostnameMatcher(value) {
  return typeof value.hostExact == "string" && value.hostTemplate === void 0 ? { hostExact: value.hostExact } : value.hostTemplate === "fingerprint-turn-region-v1" && value.hostExact === void 0 ? { hostTemplate: value.hostTemplate } : null;
}
function matchesRtcVendorHostname(matcher2, hostname) {
  if (typeof hostname != "string" || hostname.length > 253) return !1;
  if (matcher2.hostExact !== void 0) return matcher2.hostTemplate === void 0 && matcher2.hostExact === hostname;
  if (matcher2.hostTemplate !== "fingerprint-turn-region-v1") return !1;
  if (hostname === "turn.fpjs.io") return !0;
  let suffix = "-turn.fpjs.io";
  if (!hostname.endsWith(suffix)) return !1;
  let region = hostname.slice(0, -suffix.length);
  return region.length >= 1 && region.length <= 16 && !/[^a-z0-9]/.test(region);
}
function matchOf2(rule) {
  return {
    vendorId: rule.vendorId,
    ruleId: rule.id,
    vendorConfidence: "weak-signal",
    evidenceSource: "page-hook",
    integrity: "page-controlled"
  };
}
function createRtcVendorMatcher(approvedRules) {
  return (function createReviewAwareRtcVendorMatcher(approvedRules, policy = RTC_REVIEW_POLICY) {
    const entries = approvedRules.slice(0, 16).flatMap(rule => {
      const matcher = rule.matcher;
      const exact = typeof matcher.hostExact === 'string' && matcher.hostTemplate === undefined;
      const family = matcher.hostTemplate === 'fingerprint-turn-region-v1' && matcher.hostExact === undefined;
      if ((!exact && !family) || typeof rule.sourceAccessedAt !== 'string' || typeof rule.reviewDueAt !== 'string') return [];
      const start = Date.parse(rule.sourceAccessedAt), end = Date.parse(rule.reviewDueAt);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
      const staleEligible = rule.id === policy.ruleId && rule.vendorId === policy.vendorId &&
        matcher.hostExact === policy.hostExact && matcher.hostTemplate === undefined &&
        rule.sourceAccessedAt === policy.sourceAccessedAt && rule.reviewDueAt === policy.reviewDueAt &&
        policy.expiryAction === 'downgrade_to_stale_hint' && Array.isArray(matcher.schemes) &&
        matcher.schemes.length === 3 && ['stun', 'turn', 'turns'].every(scheme => matcher.schemes.includes(scheme));
      return [{ rule, start, end, staleEligible }];
    });
    const eligible = (entry, now) => Number.isFinite(now) && entry.start <= now && (now < entry.end || entry.staleEligible);
    const match = (entry, now) => ({
      vendorId: entry.rule.vendorId,
      ruleId: now >= entry.end && entry.staleEligible ? policy.staleRuleId : entry.rule.id,
      vendorConfidence: 'weak-signal', evidenceSource: 'page-hook', integrity: 'page-controlled',
    });
    const matchesHost = (matcher, hostname) => {
      if (matcher.hostExact !== undefined) return matcher.hostExact === hostname;
      if (hostname === 'turn.fpjs.io') return true;
      const suffix = '-turn.fpjs.io';
      if (!hostname.endsWith(suffix)) return false;
      const region = hostname.slice(0, -suffix.length);
      return region.length >= 1 && region.length <= 16 && !/[^a-z0-9]/.test(region);
    };
    return {
      matchVendorRtcServer(hostname, scheme, nowMs) {
        if (typeof hostname !== 'string' || hostname.length > 253 ||
            (scheme !== 'stun' && scheme !== 'turn' && scheme !== 'turns') || !Number.isFinite(nowMs)) return [];
        for (const entry of entries) if (eligible(entry, nowMs) && matchesHost(entry.rule.matcher, hostname) && entry.rule.matcher.schemes.includes(scheme)) return [match(entry, nowMs)];
        return [];
      },
      lookupVendorRtcRule(ruleId, nowMs) {
        if (typeof ruleId !== 'string' || ruleId.length > 64 || !Number.isFinite(nowMs)) return null;
        const entry = entries.find(entry => entry.rule.id === ruleId || entry.staleEligible && ruleId === policy.staleRuleId && nowMs >= entry.end);
        return entry && eligible(entry, nowMs) ? match(entry, nowMs) : null;
      },
    };
  })(approvedRules, {"ruleId":"threatmetrix-aa-turn-v1","staleRuleId":"threatmetrix-aa-turn-v1-stale","vendorId":"threatmetrix","hostExact":"aa.online-metrix.net","sourceAccessedAt":"2026-09-13","reviewDueAt":"2026-10-12T00:00:00.000Z","expiryAction":"downgrade_to_stale_hint"});
}

// packages/catalog/src/index.ts
var matcher = createVendorResourceMatcher(vendors_runtime_default.rules), matchVendorResource = matcher.matchVendorResource, lookupVendorResourceRule = matcher.lookupVendorResourceRule, hasEnabledVendorResourceRules = matcher.hasEnabledVendorResourceRules, rtcMatcher = createRtcVendorMatcher(vendors_rtc_runtime_default.rules), matchVendorRtcServer = rtcMatcher.matchVendorRtcServer, lookupVendorRtcRule = rtcMatcher.lookupVendorRtcRule;

// packages/background/src/network-counters.ts
function addRequestedLocalPort(value, port, incomplete = !1) {
  let ports = value?.ports.slice() ?? [], truncated = value?.truncated === !0 || incomplete;
  return typeof port != "number" || !Number.isInteger(port) || port < 0 || port > 65535 || Object.is(port, -0) ? truncated = !0 : ports.includes(port) || (ports.length >= 128 ? truncated = !0 : (ports.push(port), ports.sort((first, second) => first - second))), { ports, truncated };
}
function readNetworkCounters(value) {
  if (!Array.isArray(value) || value.length > 4) return [];
  let result = [], keys4 = /* @__PURE__ */ new Set();
  for (let item of value) {
    if (!item || typeof item != "object" || Array.isArray(item)) return [];
    let c = item;
    if (Object.keys(c).length !== 7 || !["DET-058", "DET-060", "DET-061"].includes(c.techniqueId) || c.phase !== "attempted" || !["exact", "lower-bound"].includes(c.countQuality) || !Array.isArray(c.signalCodes) || !(c.techniqueId !== "DET-061" && c.signalCodes.length === 1 && c.signalCodes[0] === "api-use" || c.techniqueId === "DET-060" && c.signalCodes.length === 2 && c.signalCodes[0] === "api-use" && c.signalCodes[1] === "local-multi-port" || c.techniqueId === "DET-061" && c.countQuality === "lower-bound" && c.signalCodes.length === 2 && c.signalCodes[0] === "api-use" && c.signalCodes[1] === "unique-subdomains") || !["count", "firstBucket", "lastBucket"].every((key3) => Number.isSafeInteger(c[key3]) && c[key3] >= 0 && c[key3] <= 2147483647) || c.firstBucket > c.lastBucket) return [];
    let counter = {
      techniqueId: c.techniqueId,
      phase: "attempted",
      signalCodes: [...c.signalCodes],
      count: c.count,
      countQuality: c.countQuality,
      firstBucket: c.firstBucket,
      lastBucket: c.lastBucket
    }, key2 = counterKey(counter.techniqueId, counter.phase, counter.signalCodes);
    if (keys4.has(key2)) return [];
    keys4.add(key2), result.push(counter);
  }
  return result;
}
function incrementNetworkCounters(value, websocket, local, multiPort, limited, bucket, dnsUnique = 0) {
  let result = readNetworkCounters(value);
  for (let techniqueId of ["DET-058", "DET-060"]) {
    if (techniqueId === "DET-058" ? !websocket : !local) continue;
    let signalCodes = techniqueId === "DET-060" && multiPort ? ["api-use", "local-multi-port"] : ["api-use"], entry = result.find((c) => c.techniqueId === techniqueId && c.signalCodes.length === signalCodes.length);
    entry || (entry = { techniqueId, phase: "attempted", signalCodes, count: 0, countQuality: "exact", firstBucket: bucket, lastBucket: bucket }, result.push(entry)), entry.count === 2147483647 && (entry.countQuality = "lower-bound"), entry.count = Math.min(2147483647, entry.count + 1), entry.firstBucket = Math.min(entry.firstBucket, bucket), entry.lastBucket = Math.max(entry.lastBucket, bucket);
  }
  if (Number.isSafeInteger(dnsUnique) && dnsUnique > 0 && dnsUnique <= 64) {
    let entry = result.find((counter) => counter.techniqueId === "DET-061");
    entry || (entry = {
      techniqueId: "DET-061",
      phase: "attempted",
      signalCodes: ["api-use", "unique-subdomains"],
      count: 0,
      countQuality: "lower-bound",
      firstBucket: bucket,
      lastBucket: bucket
    }, result.push(entry)), entry.count = Math.min(2147483647, entry.count + dnsUnique), entry.firstBucket = Math.min(entry.firstBucket, bucket), entry.lastBucket = Math.max(entry.lastBucket, bucket);
  }
  if (limited) for (let entry of result) entry.countQuality = "lower-bound";
  return result;
}

/* clear-reset:document-reset:start */
function resetDocument(report, meta, fence) {
  const cleared = newReport(report.tabId, report.frameId, report.documentId, null, report.lifecycle, [], fence.at);
  cleared.revision = Math.max(satAdd2(report.revision, 1), fence.reportRevision);
  const next = newMeta(report.documentKey, fence.at);
  next.bound = meta.bound;
  next.paused = fence.paused ?? meta.paused;
  next.revoked = meta.revoked;
  next.accessGranted = meta.accessGranted !== false;
  if (meta.scheme !== void 0) next.scheme = meta.scheme;
  next.cleared = true;
  next.clearEpoch = fence.bridgeSessionId;
  next.clearBootIds = [...fence.sensorBootIds];
  next.sensorSeen = fence.sensorBootIds.length > 0;
  return { report: cleared, meta: next };
}
function clearedFromBinding(binding, fence) {
  const report = newReport(binding.tabId, binding.frameId, binding.documentId, null, mapLifecycle(binding.documentLifecycle), [], fence.at);
  const meta = newMeta(binding.documentKey, fence.at);
  meta.bound = true;
  meta.accessGranted = binding.accessGranted !== false;
  if (binding.scheme !== void 0) meta.scheme = binding.scheme;
  return resetDocument(report, meta, fence);
}
/* clear-reset:document-reset:end */
// packages/background/src/documents.ts
var MAX_BOOTS_PER_DOCUMENT = 4, MAX_SESSIONS_PER_DOCUMENT = 4, MAX_EVICTED_KEYS = 256, MAX_BINDINGS_PER_TAB = 128, MAX_DOCUMENTS_GLOBAL = 1024;
function bindingKey(tabId, frameId, prerender = !1) {
  return String(tabId) + ":" + String(frameId) + (prerender ? ":p" : "");
}
function satAdd2(a, b) {
  let s = a + b;
  return s > 2147483647 ? 2147483647 : s;
}
var QUALITY_RANK2 = { exact: 0, sampled: 1, "lower-bound": 2 };
function weakerQuality(a, b) {
  return QUALITY_RANK2[a] >= QUALITY_RANK2[b] ? a : b;
}
function withFlag(flags, flag) {
  return flags.includes(flag) ? [...flags] : [...flags, flag];
}
function mapLifecycle(lifecycle) {
  switch (lifecycle) {
    case "prerender":
      return "prerender";
    case "cached":
      return "bfcache";
    case "pending_deletion":
      return "closed";
    default:
      return "committed";
  }
}
function deriveCoverageState(flags, meta) {
  let current = flags.filter((f) => f !== "paused" && f !== "revoked" && f !== "no-host-permission");
  return meta.degraded && !current.includes("truncated") && current.push("truncated"), computeCoverageState(current, {
    scopeMode: "site",
    accessGranted: !meta.revoked && meta.accessGranted !== !1,
    restricted: !1,
    paused: meta.paused,
    inaccessibleFrames: meta.sensorSeen ? 0 : 1
  });
}
function createInitialState() {
  return {
    reports: /* @__PURE__ */ new Map(),
    metas: /* @__PURE__ */ new Map(),
    bindings: /* @__PURE__ */ new Map(),
    tabs: /* @__PURE__ */ new Map(),
    attempts: /* @__PURE__ */ new Map(),
    quarantine: [],
    unavailableFrames: /* @__PURE__ */ new Map(),
    evictedKeys: [],
    unattributed: { requests: 0, orphanBatches: 0, orphanObservations: 0, lastOrphanReason: null },
    notes: { lifecycleFallbackCommits: 0, engineFailures: 0 }
  };
}
function newReport(tabId, frameId, documentId2, host2, lifecycle, flags, at2) {
  let meta = { paused: !1, revoked: !1, degraded: !1, sensorSeen: !1 };
  return {
    schemaVersion: 1,
    documentKey: makeDocumentKey(tabId, frameId, documentId2),
    tabId,
    frameId,
    documentId: documentId2,
    host: reportHost(host2),
    lifecycle,
    createdAt: at2,
    updatedAt: at2,
    revision: 0,
    coverageState: deriveCoverageState(flags, meta),
    coverageFlags: flags,
    counters: [],
    findings: [],
    hosts: [],
    watermark: null,
    dropped: { ...EMPTY_DROPPED }
  };
}
function newMeta(documentKey3, at2) {
  return {
    documentKey: documentKey3,
    paused: !1,
    revoked: !1,
    bound: !0,
    lastActivityAt: at2,
    firstObservationAt: null,
    routeSegments: 0,
    lateInjection: !1,
    sensorSeen: !1,
    degraded: !1,
    folded: {},
    counterKeyFormat: "index-v1",
    boots: [],
    sessions: []
  };
}
function cloneReport(r) {
  return { ...r, coverageFlags: [...r.coverageFlags], dropped: { ...r.dropped } };
}
function cloneMeta(m) {
  return {
    ...m,
    folded: { ...m.folded },
    boots: m.boots.map((b) => ({ sensorBootId: b.sensorBootId, counts: { ...b.counts } })),
    sessions: m.sessions.map((s) => ({ ...s }))
  };
}
function touch(report2, at2) {
  report2.revision = satAdd2(report2.revision, 1), report2.updatedAt = at2;
}
var Draft = class {
  constructor(base) {
    this.base = base;
  }
  base;
  r = null;
  m = null;
  b = null;
  t = null;
  a = null;
  q = null;
  f = null;
  e = null;
  u = null;
  n = null;
  effects = [];
  persistKeys = /* @__PURE__ */ new Set();
  get reports() {
    return this.r ??= new Map(this.base.reports);
  }
  get metas() {
    return this.m ??= new Map(this.base.metas);
  }
  get bindings() {
    return this.b ??= new Map(this.base.bindings);
  }
  get tabs() {
    return this.t ??= new Map(this.base.tabs);
  }
  get attempts() {
    return this.a ??= new Map(this.base.attempts);
  }
  get quarantine() {
    return this.q ??= [...this.base.quarantine];
  }
  get unavailableFrames() {
    return this.f ??= new Map(this.base.unavailableFrames);
  }
  get evictedKeys() {
    return this.e ??= [...this.base.evictedKeys];
  }
  get unattributed() {
    return this.u ??= { ...this.base.unattributed };
  }
  get notes() {
    return this.n ??= { ...this.base.notes };
  }
  readReport(key2) {
    return (this.r ?? this.base.reports).get(key2);
  }
  readMeta(key2) {
    return (this.m ?? this.base.metas).get(key2);
  }
  readBinding(key2) {
    return (this.b ?? this.base.bindings).get(key2);
  }
  persist(documentKey3, immediate) {
    if (this.persistKeys.has(documentKey3)) {
      if (immediate) {
        let existing = this.effects.find((e) => e.type === "persist" && e.documentKey === documentKey3);
        existing !== void 0 && existing.type === "persist" && (existing.immediate = !0);
      }
      return;
    }
    this.persistKeys.add(documentKey3), this.effects.push({ type: "persist", documentKey: documentKey3, immediate });
  }
  remove(documentKeys) {
    documentKeys.length > 0 && this.effects.push({ type: "remove", documentKeys });
  }
  persistIndex() {
    this.effects.some((e) => e.type === "persist-index") || this.effects.push({ type: "persist-index" });
  }
  /** Delete a document and remember its key so a later re-commit is marked `truncated`. */
  evictDocument(key2, keepBinding = !0) {
    if (keepBinding)
      for (let [slot, binding] of this.finish().bindings) binding.documentKey === key2 && (this.bindings.set(slot, { ...binding, apiResultsResetRequired: !0 }), this.persistIndex());
    else {
      for (let [bk, b] of this.finish().bindings) b.documentKey === key2 && this.bindings.delete(bk);
      this.persistIndex();
    }
    this.reports.delete(key2), this.metas.delete(key2);
    let ring = this.evictedKeys;
    ring.includes(key2) || (ring.push(key2), ring.length > MAX_EVICTED_KEYS && ring.shift());
  }
  finish() {
    return {
      reports: this.r ?? this.base.reports,
      metas: this.m ?? this.base.metas,
      bindings: this.b ?? this.base.bindings,
      tabs: this.t ?? this.base.tabs,
      attempts: this.a ?? this.base.attempts,
      quarantine: this.q ?? this.base.quarantine,
      unavailableFrames: this.f ?? this.base.unavailableFrames,
      evictedKeys: this.e ?? this.base.evictedKeys,
      unattributed: this.u ?? this.base.unattributed,
      notes: this.n ?? this.base.notes
    };
  }
};
function totalForKey(meta, key2) {
  let total = meta.folded[key2] ?? 0;
  for (let boot of meta.boots) {
    let c = boot.counts[key2];
    c !== void 0 && (total = satAdd2(total, c));
  }
  return total;
}
function runEngine(d, report2, meta, deps) {
  report2.coverageState = deriveCoverageState(report2.coverageFlags, meta);
  let findings;
  try {
    findings = deps.deriveFindings(report2);
  } catch {
    d.notes.engineFailures = satAdd2(d.notes.engineFailures, 1), meta.degraded = !0, report2.coverageState = deriveCoverageState(report2.coverageFlags, meta), report2.findings = [];
    return;
  }
  let cap = meta.findingsCap ?? BUDGETS.maxFindingsPerDocument;
  report2.dropped.findings = Math.max(0, findings.length - cap), report2.dropped.findings > 0 && (report2.coverageFlags = withFlag(report2.coverageFlags, "budget-exceeded")), report2.coverageState = deriveCoverageState(report2.coverageFlags, meta);
  let ref = coverageRef(report2.coverageState, report2.coverageFlags);
  report2.findings = findings.slice(0, cap).map((f) => ({ ...f, coverageRef: ref }));
}
function finalize(d, report2, meta, at2) {
  meta.lastActivityAt = at2, report2.coverageState = deriveCoverageState(report2.coverageFlags, meta);
  let ref = coverageRef(report2.coverageState, report2.coverageFlags);
  report2.findings = report2.findings.map((f) => ({ ...f, coverageRef: ref })), touch(report2, at2), d.reports.set(report2.documentKey, report2), d.metas.set(report2.documentKey, meta);
}
function markAncestorFrameGap(d, child, at2) {
  let visited = /* @__PURE__ */ new Set(), marked = !1, current = child;
  for (; current.parentDocumentId !== null && visited.size < MAX_BINDINGS_PER_TAB; ) {
    if (current.documentLifecycle !== null && current.documentLifecycle !== "active" || visited.has(current.documentKey)) return marked;
    visited.add(current.documentKey);
    let parent = [...d.finish().bindings.values()].find((binding) => binding.tabId === current.tabId && binding.documentId === current.parentDocumentId);
    if (!parent || parent.documentLifecycle !== null && parent.documentLifecycle !== "active") return marked;
    let report2 = d.readReport(parent.documentKey), meta = d.readMeta(parent.documentKey);
    if (!report2 || !meta || meta.accessGranted === !1 || meta.revoked) return marked;
    if (marked = !0, !report2.coverageFlags.includes("frames-inaccessible")) {
      let copy = cloneReport(report2);
      copy.coverageFlags = withFlag(copy.coverageFlags, "frames-inaccessible"), finalize(d, copy, cloneMeta(meta), at2), d.persist(parent.documentKey, !1);
    }
    current = parent;
  }
  return marked;
}
function expireUnavailableFrames(d, at2) {
  for (let [key2, receivedAt] of d.finish().unavailableFrames)
    at2 - receivedAt >= BUDGETS.outOfOrderTtlMs && d.unavailableFrames.delete(key2);
}
function hasFrameGap(report2, meta, binding) {
  return meta?.accessGranted === !1 && binding.originPending !== !0 || report2?.coverageFlags.some((flag) => flag === "hook-failed" || flag === "unsupported-realm" || flag === "descriptor-nonconfigurable" || flag === "frames-inaccessible") === !0;
}
function hasPendingFrameOrigin(state, documentKey3) {
  let root = [...state.bindings.values()].find((binding) => binding.documentKey === documentKey3);
  if (!root || root.documentLifecycle !== null && root.documentLifecycle !== "active") return !1;
  let children = /* @__PURE__ */ new Map();
  for (let binding of state.bindings.values()) {
    if (binding.tabId !== root.tabId || binding.parentDocumentId === null || binding.documentLifecycle !== null && binding.documentLifecycle !== "active") continue;
    let siblings = children.get(binding.parentDocumentId) ?? [];
    siblings.push(binding), children.set(binding.parentDocumentId, siblings);
  }
  let queue = [root.documentId], visited = /* @__PURE__ */ new Set();
  for (let i = 0; i < queue.length && visited.size < MAX_BINDINGS_PER_TAB; i++) {
    let id4 = queue[i];
    if (!visited.has(id4)) {
      visited.add(id4);
      for (let child of children.get(id4) ?? []) {
        if (child.originPending === !0 && child.accessGranted === !1) return !0;
        !visited.has(child.documentId) && queue.length < MAX_BINDINGS_PER_TAB && queue.push(child.documentId);
      }
    }
  }
  return !1;
}
function materialize(d, tabId, frameId, documentId2, at2) {
  let key2 = makeDocumentKey(tabId, frameId, documentId2), binding = d.readBinding(bindingKey(tabId, frameId)), prerender = !1;
  if ((binding === void 0 || binding.documentId !== documentId2) && (binding = d.readBinding(bindingKey(tabId, frameId, !0)), prerender = !0), binding === void 0 || binding.documentId !== documentId2 || !admission(d, tabId, frameId === 0 && !prerender, at2, !1)) return null;
  let flags = d.evictedKeys.includes(key2) ? ["truncated"] : [], lifecycle = prerender ? "prerender" : mapLifecycle(binding.documentLifecycle), report2 = newReport(tabId, frameId, documentId2, binding.host, lifecycle, flags, at2), meta = newMeta(key2, at2);
  return binding.scheme !== void 0 && (meta.scheme = binding.scheme), meta.accessGranted = binding.accessGranted !== !1, report2.coverageState = deriveCoverageState(flags, meta), { report: report2, meta };
}
function projectIfTop(d, binding) {
  (binding.frameType !== null ? binding.frameType === "outermost_frame" : binding.frameId === 0) && d.tabs.set(binding.tabId, { tabId: binding.tabId, activeTopDocumentKey: binding.documentKey });
}
function promoteIfActivated(d, report2, lifecycle) {
  if (report2.lifecycle !== "prerender" || lifecycle !== "active") return report2;
  let promoted = cloneReport(report2);
  promoted.lifecycle = "committed";
  let pKey = bindingKey(report2.tabId, report2.frameId, !0), pBinding = d.readBinding(pKey);
  if (pBinding !== void 0 && pBinding.documentId === report2.documentId) {
    d.bindings.delete(pKey);
    let mainKey = bindingKey(report2.tabId, report2.frameId), previous = d.readBinding(mainKey);
    previous !== void 0 && previous.documentKey !== report2.documentKey && unbindDocument(d, previous.documentKey, "closed", promoted.updatedAt);
    let binding = { ...pBinding, documentLifecycle: "active", boundAt: promoted.updatedAt };
    d.bindings.set(mainKey, binding), projectIfTop(d, binding), d.persistIndex();
  }
  return promoted;
}
function applyBatch(d, ctx, batch, at, deps) {
  const key = ctx.documentKey;
  if (ctx.documentLifecycle === "active") migratePrerender(d, ctx.tabId, ctx.frameId, ctx.documentId, at);
  let report = d.readReport(key);
  let meta = d.readMeta(key);
  if (report === void 0 || meta === void 0) {
    const created = materialize(d, ctx.tabId, ctx.frameId, ctx.documentId, at);
    if (created === null) return { status: "quarantined", documentKey: key, lastCommittedBatchSeq: 0, paused: false, protocolOk: true };
    report = created.report;
    meta = created.meta;
  } else {
    report = cloneReport(report);
    meta = cloneMeta(meta);
  }
  if (meta.revoked || meta.accessGranted === false) {
    return { status: "revoked", documentKey: key, lastCommittedBatchSeq: 0, paused: true, protocolOk: false };
  }
  if (meta.clearEpoch !== void 0 && (batch.bridgeSessionId !== meta.clearEpoch || !meta.clearBootIds?.includes(batch.sensorBootId))) {
    return { status: "duplicate", documentKey: key, lastCommittedBatchSeq: 0, paused: meta.paused, protocolOk: true };
  }
  let session = meta.sessions.find((s) => s.bridgeSessionId === batch.bridgeSessionId);
  if (meta.paused) {
    return {
      status: "paused",
      documentKey: key,
      lastCommittedBatchSeq: session?.lastCommittedBatchSeq ?? 0,
      paused: true,
      protocolOk: true
    };
  }
  if (session === void 0) {
    if (batch.batchSeq > 1 && meta.sessions.length === 0 && report.watermark === null && !meta.sensorSeen && report.counters.length === 0) report.coverageFlags = withFlag(report.coverageFlags, "truncated");
    if (meta.sessions.length >= MAX_SESSIONS_PER_DOCUMENT) meta.sessions.shift();
    session = { bridgeSessionId: batch.bridgeSessionId, lastCommittedBatchSeq: report.coverageFlags.includes("truncated") ? batch.batchSeq - 1 : 0 };
    meta.sessions.push(session);
  } else if (batch.batchSeq <= session.lastCommittedBatchSeq) {
    return {
      status: "duplicate",
      documentKey: key,
      lastCommittedBatchSeq: session.lastCommittedBatchSeq,
      paused: false,
      protocolOk: true
    };
  }
  if (meta.cleared) session.lastCommittedBatchSeq = batch.batchSeq - 1;
  const gap = batch.batchSeq - session.lastCommittedBatchSeq - 1;
  if (gap > 0) {
    report.dropped.batches = satAdd2(report.dropped.batches, gap);
    report.coverageFlags = withFlag(report.coverageFlags, "channel-gap");
  }
  session.lastCommittedBatchSeq = batch.batchSeq;
  report.watermark = { bridgeSessionId: batch.bridgeSessionId, lastCommittedBatchSeq: batch.batchSeq };
  if (meta.cleared) {
    delete meta.cleared;
    report.host = reportHost(ctx.host);
    report.createdAt = at;
  }
  if (batch.observations.length > 0) {
    let boot = meta.boots.find((b) => b.sensorBootId === batch.sensorBootId);
    if (boot === void 0) {
      if (meta.boots.length >= MAX_BOOTS_PER_DOCUMENT) {
        report.coverageFlags = withFlag(report.coverageFlags, "budget-exceeded");
        report.counters = report.counters.map((c) => ({ ...c, countQuality: "lower-bound" }));
        report.dropped.observations = satAdd2(report.dropped.observations, batch.observations.length);
        finalize(d, report, meta, at);
        d.persist(key, true);
        return { status: "committed", documentKey: key, lastCommittedBatchSeq: batch.batchSeq, paused: false, protocolOk: true };
      }
      boot = { sensorBootId: batch.sensorBootId, counts: {} };
      meta.boots.push(boot);
    }
    const counters = /* @__PURE__ */ new Map();
    const slots = /* @__PURE__ */ new Map();
    for (const c of report.counters) {
      const ck = counterKey(c.techniqueId, c.phase, c.signalCodes, c.apiOperation, c.extensionResource);
      slots.set(ck, String(counters.size));
      counters.set(ck, c);
    }
    for (const obs of batch.observations) {
      const ck = counterKey(obs.techniqueId, obs.phase, obs.signalCodes, obs.apiOperation, obs.extensionResource);
      const existing = counters.get(ck);
      if (existing === void 0 && counters.size >= BUDGETS.maxCountersPerDocumentGroup) {
        report.dropped.counters = satAdd2(report.dropped.counters, 1);
        report.dropped.observations = satAdd2(report.dropped.observations, 1);
        report.coverageFlags = withFlag(report.coverageFlags, "budget-exceeded");
        continue;
      }
      const slot = slots.get(ck) ?? String(counters.size);
      slots.set(ck, slot);
      const prev = boot.counts[slot];
      boot.counts[slot] = prev === void 0 ? obs.count : Math.max(prev, obs.count);
      const total = totalForKey(meta, slot);
      if (existing === void 0) {
        counters.set(ck, {
          techniqueId: obs.techniqueId,
          ...obs.apiOperation === void 0 ? {} : { apiOperation: obs.apiOperation },
          ...obs.extensionResource === void 0 ? {} : { extensionResource: { ...obs.extensionResource } },
          phase: obs.phase,
          signalCodes: [...obs.signalCodes].sort(),
          count: total,
          countQuality: obs.countQuality,
          firstBucket: obs.intervalBucket,
          lastBucket: obs.intervalBucket
        });
      } else {
        counters.set(ck, {
          ...existing,
          count: total,
          countQuality: weakerQuality(existing.countQuality, obs.countQuality),
          firstBucket: Math.min(existing.firstBucket, obs.intervalBucket),
          lastBucket: Math.max(existing.lastBucket, obs.intervalBucket)
        });
      }
    }
    report.counters = [...counters.values()];
  }
  for (const flag of batch.coverageDelta) {
    if (flag === "revoked" || flag === "paused" || flag === "no-host-permission" || flag === "restricted-page" || flag === "truncated" || flag === "late-start" || flag === "frames-inaccessible" || flag === "network-limited") continue;
    report.coverageFlags = withFlag(report.coverageFlags, flag);
  }
  if (meta.lateInjection) report.coverageFlags = withFlag(report.coverageFlags, "late-start");
  report = promoteIfActivated(d, report, ctx.documentLifecycle);
  if (batch.observations.length > 0) meta.sensorSeen = true;
  if (meta.firstObservationAt === null && batch.observations.length > 0) meta.firstObservationAt = at;
  runEngine(d, report, meta, deps);
  finalize(d, report, meta, at);
  const binding = [...d.finish().bindings.values()].find((entry) => entry.documentKey === key);
  if (binding && hasFrameGap(report, meta, binding)) markAncestorFrameGap(d, binding, at);
  d.persist(key, true);
  return { status: "committed", documentKey: key, lastCommittedBatchSeq: batch.batchSeq, paused: false, protocolOk: true };
}
function enqueueQuarantine(d, entry) {
  let q = d.quarantine;
  if (!q.some(
    (e) => e.documentKey === entry.documentKey && e.batch.bridgeSessionId === entry.batch.bridgeSessionId && e.batch.batchSeq === entry.batch.batchSeq
  )) {
    if (q.length >= BUDGETS.maxOutOfOrderEntriesGlobal) {
      let dropped = q.shift();
      dropped !== void 0 && orphan(d, dropped, "quarantine-full");
    }
    q.push(entry);
  }
}
function orphan(d, entry, reason) {
  let u = d.unattributed;
  u.orphanBatches = satAdd2(u.orphanBatches, 1), u.orphanObservations = satAdd2(u.orphanObservations, entry.batch.observations.length), u.lastOrphanReason = reason;
}
function expireQuarantine(d, at2) {
  let base = d.finish().quarantine;
  if (base.length === 0) return;
  let expired = base.filter((e) => at2 - e.receivedAt >= BUDGETS.outOfOrderTtlMs);
  if (expired.length === 0) return;
  for (let e of expired) orphan(d, e, "quarantine-expired");
  let keep = base.filter((e) => at2 - e.receivedAt < BUDGETS.outOfOrderTtlMs);
  d.quarantine.length = 0, d.quarantine.push(...keep);
}
function drainQuarantine(d, documentKey3, at2, deps) {
  let base = d.finish().quarantine, matching = base.filter((e) => e.documentKey === documentKey3);
  if (matching.length === 0) return;
  let rest = base.filter((e) => e.documentKey !== documentKey3);
  d.quarantine.length = 0, d.quarantine.push(...rest), matching.sort(
    (a, b) => a.batch.bridgeSessionId === b.batch.bridgeSessionId ? a.batch.batchSeq - b.batch.batchSeq : a.receivedAt - b.receivedAt
  );
  for (let e of matching) applyBatch(d, e.sender, e.batch, at2, deps);
}
function unbindDocument(d, documentKey3, lifecycle, at2) {
  let report2 = d.readReport(documentKey3), meta = d.readMeta(documentKey3);
  if (report2 === void 0 || meta === void 0) return;
  let r = cloneReport(report2), m = cloneMeta(meta);
  m.bound = !1, r.lifecycle === "committed" && (r.lifecycle = lifecycle), finalize(d, r, m, at2), d.persist(documentKey3, !1);
}
function retireFrameTree(d, root, at2) {
  let retired = /* @__PURE__ */ new Set([root.documentId]), prerender = root.documentLifecycle === "prerender";
  for (let pass = 0; pass < MAX_BINDINGS_PER_TAB; pass++) {
    let changed = !1;
    for (let binding of d.finish().bindings.values())
      binding.tabId !== root.tabId || binding.documentLifecycle === "prerender" !== prerender || !binding.parentDocumentId || !retired.has(binding.parentDocumentId) || retired.has(binding.documentId) || (retired.add(binding.documentId), changed = !0);
    if (!changed) break;
  }
  for (let [slot, binding] of d.finish().bindings)
    binding.tabId !== root.tabId || binding.documentLifecycle === "prerender" !== prerender || !retired.has(binding.documentId) || (d.bindings.delete(slot), d.unavailableFrames.delete(binding.documentKey), unbindDocument(d, binding.documentKey, "closed", at2));
  d.persistIndex();
}
function migratePrerender(d, tabId, frameId, documentId2, at2) {
  let target = makeDocumentKey(tabId, frameId, documentId2);
  for (let [bk, binding] of d.finish().bindings) {
    if (!bk.endsWith(":p") || binding.tabId !== tabId || binding.documentId !== documentId2 || binding.documentKey === target) continue;
    let report2 = d.readReport(binding.documentKey), meta = d.readMeta(binding.documentKey), previous = d.readBinding(bindingKey(tabId, frameId));
    previous !== void 0 && previous.documentKey !== target && unbindDocument(d, previous.documentKey, "closed", at2), d.bindings.delete(bk);
    let active6 = { ...binding, frameId, documentKey: target, documentLifecycle: "active", boundAt: at2 };
    if (d.bindings.set(bindingKey(tabId, frameId), active6), report2 !== void 0 && meta !== void 0) {
      d.reports.delete(binding.documentKey), d.metas.delete(binding.documentKey);
      let r = { ...cloneReport(report2), documentKey: target, frameId, lifecycle: "committed" }, m = { ...cloneMeta(meta), documentKey: target };
      finalize(d, r, m, at2), d.remove([binding.documentKey]), d.persist(target, !1);
    }
    projectIfTop(d, active6), d.persistIndex();
    return;
  }
}
function admission(d, tabId, top, at2, newBinding = !0, existingKey = null) {
  let needsReport = existingKey === null || d.readReport(existingKey) === void 0;
  if (needsReport && d.finish().reports.size >= MAX_DOCUMENTS_GLOBAL) {
    let victim2 = planEviction(d.finish()).find((key2) => d.readMeta(key2)?.bound === !1);
    victim2 && (d.evictDocument(victim2, !1), d.remove([victim2]));
  }
  let state = d.finish(), perTab = [...state.bindings.values()].filter((b) => b.tabId === tabId).length;
  if ((!newBinding || perTab < MAX_BINDINGS_PER_TAB && state.bindings.size < MAX_DOCUMENTS_GLOBAL) && (!needsReport || state.reports.size < MAX_DOCUMENTS_GLOBAL)) return !0;
  let topKey = state.tabs.get(tabId)?.activeTopDocumentKey;
  if (topKey) {
    let r = d.readReport(topKey), m = d.readMeta(topKey);
    if (r && m) {
      let copy = cloneReport(r);
      copy.coverageFlags = withFlag(copy.coverageFlags, "budget-exceeded"), finalize(d, copy, cloneMeta(m), at2), d.persist(topKey, !1);
    }
  }
  if (!top) return !1;
  let victim = planEviction(d.finish(), existingKey === null ? /* @__PURE__ */ new Set() : /* @__PURE__ */ new Set([existingKey]))[0];
  return victim ? (d.evictDocument(victim, !1), d.remove([victim]), !0) : !1;
}
function onCommitted(d, ev, deps) {
  expireUnavailableFrames(d, ev.at);
  let key2 = makeDocumentKey(ev.tabId, ev.frameId, ev.documentId), outermost = ev.frameType === "outermost_frame" || ev.frameType === null && ev.frameId === 0;
  ev.documentLifecycle === "active" && migratePrerender(d, ev.tabId, ev.frameId, ev.documentId, ev.at), ev.frameType !== null && ev.documentLifecycle !== null || (d.notes.lifecycleFallbackCommits = satAdd2(d.notes.lifecycleFallbackCommits, 1));
  let isPrerender = ev.documentLifecycle === "prerender", bKey = bindingKey(ev.tabId, ev.frameId, isPrerender), previous = d.readBinding(bKey);
  if (previous !== void 0 && previous.documentKey !== key2 && !outermost && retireFrameTree(d, previous, ev.at), (previous === void 0 || d.readReport(key2) === void 0) && !admission(d, ev.tabId, outermost && !isPrerender, ev.at, previous === void 0, key2)) {
    previous && (d.bindings.delete(bKey), unbindDocument(d, previous.documentKey, "closed", ev.at), d.persistIndex());
    return;
  }
  if (outermost && !isPrerender) {
    let retained = /* @__PURE__ */ new Set([ev.documentId]);
    for (let pass = 0; pass < MAX_BINDINGS_PER_TAB; pass++) {
      let changed = !1;
      for (let b of d.finish().bindings.values()) b.tabId === ev.tabId && b.parentDocumentId && retained.has(b.parentDocumentId) && !retained.has(b.documentId) && (retained.add(b.documentId), changed = !0);
      if (!changed) break;
    }
    for (let [bk, b] of d.finish().bindings)
      b.tabId !== ev.tabId || bk === bKey || bk.endsWith(":p") || retained.has(b.documentId) || (d.bindings.delete(bk), unbindDocument(d, b.documentKey, "closed", ev.at));
  }
  if (previous !== void 0 && previous.documentKey !== key2 && d.readMeta(previous.documentKey)?.bound !== !1 && unbindDocument(d, previous.documentKey, "closed", ev.at), !isPrerender) {
    let pKey = bindingKey(ev.tabId, ev.frameId, !0), p = d.readBinding(pKey);
    p !== void 0 && p.documentId === ev.documentId && d.bindings.delete(pKey);
  }
  let binding = {
    tabId: ev.tabId,
    frameId: ev.frameId,
    documentId: ev.documentId,
    documentKey: key2,
    parentDocumentId: ev.parentDocumentId,
    frameType: ev.frameType,
    documentLifecycle: ev.documentLifecycle,
    host: ev.accessGranted === !1 ? null : reportHost(ev.host),
    ...ev.scheme === void 0 ? {} : { scheme: ev.scheme },
    boundAt: ev.at,
    accessGranted: ev.accessGranted !== !1,
    originPending: ev.originPending === !0 && ev.accessGranted === !1 && !d.finish().unavailableFrames.has(key2),
    ...previous?.documentKey === key2 && previous.apiResultsResetRequired !== void 0 ? { apiResultsResetRequired: previous.apiResultsResetRequired } : d.evictedKeys.includes(key2) ? { apiResultsResetRequired: !0 } : {}
  };
  d.bindings.set(bKey, binding), d.attempts.delete(bindingKey(ev.tabId, ev.frameId));
  let existing = d.readReport(key2), existingMeta = d.readMeta(key2), isTop = ev.frameType !== null ? ev.frameType === "outermost_frame" : ev.frameId === 0;
  if (existing !== void 0 && existingMeta !== void 0) {
    let r = cloneReport(existing), m = cloneMeta(existingMeta);
    m.bound = !0, r.lifecycle = mapLifecycle(ev.documentLifecycle), ev.scheme !== void 0 && (m.scheme = ev.scheme), m.accessGranted = ev.accessGranted !== !1, m.accessGranted && !m.revoked && (r.coverageFlags = r.coverageFlags.filter((flag) => flag !== "no-host-permission")), r.host = binding.host, finalize(d, r, m, ev.at), d.persist(key2, !1);
  } else {
    let flags = d.evictedKeys.includes(key2) ? ["truncated"] : [], report2 = newReport(ev.tabId, ev.frameId, ev.documentId, binding.host, mapLifecycle(ev.documentLifecycle), flags, ev.at), meta = newMeta(key2, ev.at);
    ev.scheme !== void 0 && (meta.scheme = ev.scheme), meta.accessGranted = ev.accessGranted !== !1, meta.accessGranted || (report2.coverageFlags = withFlag(report2.coverageFlags, "no-host-permission")), report2.coverageState = deriveCoverageState(report2.coverageFlags, meta), d.reports.set(key2, report2), d.metas.set(key2, meta), isTop && !isPrerender && d.persist(key2, !1);
  }
  isTop && !isPrerender && (ev.documentLifecycle === "active" || ev.documentLifecycle === null) && d.tabs.set(ev.tabId, { tabId: ev.tabId, activeTopDocumentKey: key2 }), d.persistIndex(), drainQuarantine(d, key2, ev.at, deps), ev.accessGranted === !1 && !binding.originPending && markAncestorFrameGap(d, binding, ev.at), d.finish().unavailableFrames.has(key2) && markAncestorFrameGap(d, binding, ev.at) && d.unavailableFrames.delete(key2);
  for (let child of d.finish().bindings.values())
    child.tabId === ev.tabId && child.parentDocumentId === ev.documentId && (d.finish().unavailableFrames.has(child.documentKey) || hasFrameGap(d.readReport(child.documentKey), d.readMeta(child.documentKey), child)) && markAncestorFrameGap(d, child, ev.at) && d.unavailableFrames.delete(child.documentKey);
}
function onTabRemoved(d, tabId) {
  let removed = [];
  for (let [key2, report2] of d.finish().reports)
    report2.tabId === tabId && (removed.push(key2), d.reports.delete(key2), d.metas.delete(key2));
  for (let [bk, b] of d.finish().bindings) b.tabId === tabId && d.bindings.delete(bk);
  for (let [ak, a] of d.finish().attempts) a.tabId === tabId && d.attempts.delete(ak);
  for (let key2 of d.finish().unavailableFrames.keys()) key2.startsWith(String(tabId) + ":") && d.unavailableFrames.delete(key2);
  d.tabs.delete(tabId);
  let q = d.finish().quarantine;
  if (q.some((e) => e.sender.tabId === tabId)) {
    let keep = q.filter((e) => e.sender.tabId !== tabId);
    for (let e of q) e.sender.tabId === tabId && orphan(d, e, "tab-closed");
    d.quarantine.length = 0, d.quarantine.push(...keep);
  }
  d.remove(removed), d.persistIndex();
}
function onTabReplaced(d, addedTabId, removedTabId, at2) {
  for (let [bk, b] of d.finish().bindings)
    b.tabId === removedTabId && (d.bindings.delete(bk), unbindDocument(d, b.documentKey, "closed", at2));
  for (let [ak, a] of d.finish().attempts) a.tabId === removedTabId && d.attempts.delete(ak);
  d.tabs.delete(removedTabId);
  for (let [bk, b] of d.finish().bindings) {
    if (b.tabId !== addedTabId || !bk.endsWith(":p")) continue;
    let report2 = d.readReport(b.documentKey);
    if (report2 === void 0) continue;
    let promoted = promoteIfActivated(d, report2, "active"), meta = d.readMeta(b.documentKey);
    meta !== void 0 && (finalize(d, promoted, cloneMeta(meta), at2), d.persist(b.documentKey, !1));
  }
  d.persistIndex();
}
function onNetworkHost(d, ev, deps) {
  if (ev.tabId < 0) {
    d.unattributed.requests = satAdd2(d.unattributed.requests, 1);
    return;
  }
  let frameId = ev.frameId;
  let documentId = null;
  if (ev.resourceType === "sub_frame" && ev.parentDocumentId !== null && ev.parentFrameId !== null && ev.parentFrameId >= 0) {
    frameId = ev.parentFrameId;
    documentId = ev.parentDocumentId;
  } else if (ev.documentId !== null) {
    documentId = ev.documentId;
  }
  if (documentId === null) {
    d.unattributed.requests = satAdd2(d.unattributed.requests, 1);
    return;
  }
  const key = makeDocumentKey(ev.tabId, frameId, documentId);
  let report = d.readReport(key);
  let meta = d.readMeta(key);
  if (report === void 0 || meta === void 0) {
    const created = materialize(d, ev.tabId, frameId, documentId, ev.at);
    if (created === null) {
      d.unattributed.requests = satAdd2(d.unattributed.requests, 1);
      return;
    }
    report = created.report;
    meta = created.meta;
  } else {
    report = cloneReport(report);
    meta = cloneMeta(meta);
  }
  if (meta.revoked || meta.paused || meta.accessGranted === false) return;
  if (meta.cleared) {
    delete meta.cleared;
    report.host = d.readBinding(bindingKey(ev.tabId, ev.frameId))?.host ?? null;
    report.createdAt = ev.at;
  }
  const hosts = [...report.hosts];
  const redacted = redactHost(ev.host);
  const registrableDomain = redacted.kind === "registrable" ? redacted.value : void 0;
  const category = ev.category ?? (redacted.kind === "registrable" ? void 0 : redacted.kind === "unknown" ? "unknown" : redacted.value);
  const relation = ev.relation ?? "unknown";
  const ruleIds = [];
  for (const id of (ev.ruleIds ?? []).slice(0, 32)) {
    if (lookupVendorResourceRule(id, ev.at) !== null && !ruleIds.includes(id)) ruleIds.push(id);
  }
  const bucket = Math.max(0, Math.floor((ev.at - report.createdAt) / 1e3));
  const idx = hosts.findIndex((h) => h.registrableDomain === registrableDomain && h.category === category && h.relation === relation);
  if (idx >= 0) {
    const h = hosts[idx];
    if (h !== void 0) {
      const merged = [...h.ruleIds];
      for (const id of ruleIds) {
        if (merged.includes(id)) continue;
        if (merged.length >= 32) {
          report.coverageFlags = withFlag(report.coverageFlags, "budget-exceeded");
          break;
        }
        merged.push(id);
      }
      hosts[idx] = { ...h, requestCount: satAdd2(h.requestCount, 1), lastSeenBucket: bucket, ruleIds: merged.sort() };
      if (ruleIds.length > 0 && meta.firstObservationAt === null) meta.firstObservationAt = ev.at;
    }
  } else if (hosts.length >= BUDGETS.maxHostsPerDocument) {
    report.dropped.hosts = satAdd2(report.dropped.hosts, 1);
    report.coverageFlags = withFlag(report.coverageFlags, "budget-exceeded");
  } else {
    hosts.push({
      ...registrableDomain === void 0 ? { category } : { registrableDomain },
      relation,
      evidenceSource: "browser-network",
      integrity: "browser-observed",
      requestCount: 1,
      firstSeenBucket: bucket,
      lastSeenBucket: bucket,
      ruleIds: ruleIds.sort()
    });
    if (ruleIds.length > 0 && meta.firstObservationAt === null) meta.firstObservationAt = ev.at;
  }
  report.hosts = hosts;
  runEngine(d, report, meta, deps);
  finalize(d, report, meta, ev.at);
  d.persist(key, false);
}
function onTtlTick(d, at2) {
  expireQuarantine(d, at2), expireUnavailableFrames(d, at2);
  for (let [key2, attempt] of d.finish().attempts) at2 - attempt.startedAt >= BUDGETS.inactiveDocumentTtlMs && d.attempts.delete(key2);
  let expired = [];
  for (let [key2, meta] of d.finish().metas)
    !meta.bound && at2 - meta.lastActivityAt >= BUDGETS.inactiveDocumentTtlMs && expired.push(key2);
  for (let key2 of expired) d.evictDocument(key2, !1);
  d.remove(expired);
}
function onRevoked(d, documentKeys, at2, unresolvedOrigin = !1) {
  for (let key2 of documentKeys) {
    for (let [slot, binding] of d.finish().bindings) if (binding.documentKey === key2) {
      let denied2 = { ...binding, accessGranted: !1, originPending: unresolvedOrigin && binding.originPending === !0 };
      d.bindings.set(slot, denied2), denied2.originPending || markAncestorFrameGap(d, denied2, at2), d.persistIndex();
    }
    let report2 = d.readReport(key2), meta = d.readMeta(key2);
    if (report2 === void 0 || meta === void 0) continue;
    let r = cloneReport(report2), m = cloneMeta(meta);
    r.counters = [], r.findings = [], r.hosts = [], r.watermark = null, r.host = null, r.coverageFlags = unresolvedOrigin ? r.coverageFlags.filter((flag) => flag !== "revoked" && flag !== "no-host-permission") : ["revoked"], m.accessGranted = !1, m.revoked = !unresolvedOrigin, unresolvedOrigin && (m.sensorSeen = !1), m.firstObservationAt = null, m.networkCounters = [], delete m.networkCounterEpoch, delete m.requestedLocalPorts, delete m.responseHeaders, m.boots = [], m.folded = {}, m.sessions = [], finalize(d, r, m, at2), d.persist(key2, !0);
  }
}
function onDegraded(d, key2, truncate, at2) {
  let report2 = d.readReport(key2), meta = d.readMeta(key2);
  if (report2 === void 0 || meta === void 0) return;
  let r = cloneReport(report2), m = cloneMeta(meta);
  if (m.degraded = !0, truncate) {
    let keepFindings = Math.floor(r.findings.length / 2), keepHosts = Math.floor(r.hosts.length / 2);
    m.findingsCap = keepFindings, r.dropped.findings = satAdd2(r.dropped.findings, r.findings.length - keepFindings), r.dropped.hosts = satAdd2(r.dropped.hosts, r.hosts.length - keepHosts), r.findings = r.findings.slice(0, keepFindings), r.hosts = r.hosts.slice(0, keepHosts), r.coverageFlags = withFlag(r.coverageFlags, "truncated");
  }
  finalize(d, r, m, at2);
}
function reduce(state, event, deps) {
  let d = new Draft(state), batch;
  switch (event.type) {
    case "navigation:before": {
      if (d.finish().attempts.size >= MAX_DOCUMENTS_GLOBAL && !d.finish().attempts.has(bindingKey(event.tabId, event.frameId))) break;
      d.attempts.set(bindingKey(event.tabId, event.frameId), {
        tabId: event.tabId,
        frameId: event.frameId,
        startedAt: event.at,
        host: reportHost(event.host)
      });
      break;
    }
    case "navigation:committed":
      onCommitted(d, event, deps);
      break;
    case "navigation:error": {
      d.attempts.delete(bindingKey(event.tabId, event.frameId));
      for (let [bk, binding] of d.finish().bindings)
        bk.endsWith(":p") && binding.tabId === event.tabId && binding.documentId === event.documentId && retireFrameTree(d, binding, event.at);
      break;
    }
    case "navigation:route": {
      let key2 = makeDocumentKey(event.tabId, event.frameId, event.documentId), meta = d.readMeta(key2), report2 = d.readReport(key2);
      if (meta !== void 0 && report2 !== void 0) {
        let m = cloneMeta(meta);
        m.routeSegments = satAdd2(m.routeSegments, 1), m.lastActivityAt = event.at, d.metas.set(key2, m);
        let promoted = promoteIfActivated(d, report2, event.documentLifecycle);
        promoted !== report2 && (finalize(d, promoted, m, event.at), d.persist(key2, !1));
      }
      break;
    }
    case "navigation:completed": {
      let key2 = makeDocumentKey(event.tabId, event.frameId, event.documentId), report2 = d.readReport(key2), meta = d.readMeta(key2);
      if (report2 !== void 0 && meta !== void 0) {
        let promoted = promoteIfActivated(d, report2, event.documentLifecycle);
        promoted !== report2 && (finalize(d, promoted, cloneMeta(meta), event.at), d.persist(key2, !1));
      }
      break;
    }
    case "tab:removed":
      onTabRemoved(d, event.tabId);
      break;
    case "tab:replaced":
      onTabReplaced(d, event.addedTabId, event.removedTabId, event.at);
      break;
    case "batch": {
      expireQuarantine(d, event.at), batch = applyBatch(d, event.sender, event.batch, event.at, deps), batch.status === "quarantined" && enqueueQuarantine(d, { documentKey: event.sender.documentKey, sender: { ...event.sender, host: reportHost(event.sender.host), originPattern: null }, batch: event.batch, receivedAt: event.at });
      break;
    }
    case "network:host":
      onNetworkHost(d, event, deps);
      break;
    case "network:headers": {
      let headers = readResponseHeaders(event.headers);
      if (!headers || !headers.entries.length && !headers.truncated) break;
      let binding = [...d.finish().bindings.values()].find((item) => item.documentKey === event.documentKey);
      if (!binding || binding.accessGranted !== !0 || binding.originPending || binding.documentLifecycle !== null && binding.documentLifecycle !== "active") break;
      let created = d.readReport(event.documentKey) && d.readMeta(event.documentKey) ? null : materialize(d, binding.tabId, binding.frameId, binding.documentId, event.at), report2 = d.readReport(event.documentKey) ?? created?.report, meta = d.readMeta(event.documentKey) ?? created?.meta;
      if (!report2 || !meta || meta.paused || meta.revoked || meta.accessGranted === !1) break;
      let nextReport = cloneReport(report2), nextMeta = cloneMeta(meta);
      nextMeta.responseHeaders = mergeResponseHeaders(nextMeta.responseHeaders, headers), headers.entries.length && (nextMeta.firstObservationAt ??= event.at), nextMeta.responseHeaders.truncated && (nextReport.coverageFlags = withFlag(nextReport.coverageFlags, "network-limited")), finalize(d, nextReport, nextMeta, event.at), d.persist(event.documentKey, !1);
      break;
    }
    case "network:unattributed":
      d.unattributed.requests = satAdd2(d.unattributed.requests, 1);
      break;
    case "network:observed": {
      if (event.dnsUnique !== void 0 && (!Number.isSafeInteger(event.dnsUnique) || event.dnsUnique < 1 || event.dnsUnique > 64)) break;
      let binding = [...d.finish().bindings.values()].find((item) => item.documentKey === event.documentKey);
      if (!binding || binding.accessGranted !== !0 || binding.documentLifecycle !== null && binding.documentLifecycle !== "active") break;
      let created = d.readReport(event.documentKey) && d.readMeta(event.documentKey) ? null : materialize(d, binding.tabId, binding.frameId, binding.documentId, event.at), report2 = d.readReport(event.documentKey) ?? created?.report, meta = d.readMeta(event.documentKey) ?? created?.meta;
      if (!report2 || !meta || meta.paused || meta.revoked || meta.accessGranted === !1 || !/^[A-Za-z0-9_-]{1,64}$/.test(event.epoch)) break;
      let r = cloneReport(report2), m = cloneMeta(meta), bucket = Math.min(2147483647, Math.max(0, Math.floor((event.at - r.createdAt) / 1e3)));
      event.local && (m.requestedLocalPorts = addRequestedLocalPort(
        m.requestedLocalPorts,
        event.localPort,
        m.requestedLocalPorts === void 0 && (m.networkCounters?.some((counter) => counter.techniqueId === "DET-060" && counter.count > 0) ?? !1)
      )), m.networkCounters = incrementNetworkCounters(m.networkCounters ?? [], event.websocket, event.local, event.multiPort, event.limited, bucket, event.dnsUnique), m.networkCounterEpoch ??= event.epoch, m.firstObservationAt ??= event.at, event.limited && (r.coverageFlags = withFlag(r.coverageFlags, "network-limited")), finalize(d, r, m, event.at), d.persist(event.documentKey, !1);
      break;
    }
    case "network:reset": {
      let report2 = d.readReport(event.documentKey), meta = d.readMeta(event.documentKey);
      if (!report2 || !meta || !meta.networkCounters?.length && !meta.requestedLocalPorts && !meta.responseHeaders) break;
      let r = cloneReport(report2), m = cloneMeta(meta);
      m.networkCounters = [], delete m.networkCounterEpoch, delete m.requestedLocalPorts, delete m.responseHeaders, r.counters.length === 0 && !r.hosts.some((host2) => host2.ruleIds.length > 0) && (m.firstObservationAt = null), r.coverageFlags = withFlag(r.coverageFlags, "network-limited"), finalize(d, r, m, event.at), d.persist(event.documentKey, !0);
      break;
    }
    case "network:limited": {
      let report2 = d.readReport(event.documentKey), meta = d.readMeta(event.documentKey);
      if (!report2 || !meta || meta.revoked || meta.accessGranted === !1) break;
      let r = cloneReport(report2), m = cloneMeta(meta);
      r.coverageFlags = withFlag(r.coverageFlags, "network-limited"), m.degraded = !0, m.networkCounters && (m.networkCounters = m.networkCounters.map((counter) => ({ ...counter, countQuality: "lower-bound" }))), m.requestedLocalPorts = { ports: m.requestedLocalPorts?.ports.slice() ?? [], truncated: !0 }, finalize(d, r, m, event.at), d.persist(event.documentKey, !1);
      break;
    }
    case "vendor:updated": {
      let report2 = d.readReport(event.documentKey), meta = d.readMeta(event.documentKey);
      if (!report2 || !meta) break;
      finalize(d, cloneReport(report2), cloneMeta(meta), event.at), d.persist(event.documentKey, !1);
      break;
    }
    case "ttl-tick":
      onTtlTick(d, event.at);
      break;
    case "ui:pause":
    case "ui:resume": {
      let report2 = d.readReport(event.documentKey), meta = d.readMeta(event.documentKey);
      if (report2 !== void 0 && meta !== void 0) {
        let r = cloneReport(report2), m = cloneMeta(meta);
        m.paused = event.type === "ui:pause", m.paused && (r.coverageFlags = withFlag(r.coverageFlags, "paused")), finalize(d, r, m, event.at), d.persist(event.documentKey, !0);
      }
      break;
    }
    case "ui:clear": {
      const report = d.readReport(event.documentKey);
      const meta = d.readMeta(event.documentKey);
      if (report !== void 0 && meta !== void 0) {
        const cleared = resetDocument(report, meta, event.fence ?? { documentKey: report.documentKey, bridgeSessionId: "reset-required", sensorBootIds: [], at: event.at, reportRevision: satAdd2(report.revision, 1) });
        d.reports.set(event.documentKey, cleared.report);
        d.metas.set(event.documentKey, cleared.meta);
        d.persist(event.documentKey, true);
      }
      break;
    }
    case "injection:late": {
      for (let b of d.finish().bindings.values()) {
        if (!event.documentKeys.includes(b.documentKey)) continue;
        let report2 = d.readReport(b.documentKey), meta = d.readMeta(b.documentKey);
        if (report2 === void 0 || meta === void 0) continue;
        let r = cloneReport(report2), m = cloneMeta(meta);
        m.lateInjection = !0, r.coverageFlags = withFlag(r.coverageFlags, "late-start"), finalize(d, r, m, event.at), d.persist(b.documentKey, !1);
      }
      break;
    }
    case "frame:unavailable": {
      expireUnavailableFrames(d, event.at);
      let child = [...d.finish().bindings.values()].find((b) => b.tabId === event.tabId && b.frameId === event.frameId && b.documentId === event.documentId);
      if (child?.originPending) {
        for (let [slot, binding] of d.finish().bindings) binding === child && d.bindings.set(slot, { ...binding, originPending: !1 });
        d.persistIndex();
      }
      if (child && markAncestorFrameGap(d, child, event.at)) break;
      let key2 = makeDocumentKey(event.tabId, event.frameId, event.documentId);
      if (!d.finish().unavailableFrames.has(key2)) {
        if (d.finish().unavailableFrames.size >= BUDGETS.maxOutOfOrderEntriesGlobal) {
          let oldest = d.finish().unavailableFrames.keys().next().value;
          oldest !== void 0 && d.unavailableFrames.delete(oldest);
        }
        d.unavailableFrames.set(key2, event.at);
      }
      break;
    }
    case "frames:retired": {
      for (let key2 of event.documentKeys) {
        let binding = [...d.finish().bindings.values()].find((entry) => entry.documentKey === key2);
        binding && binding.frameId !== 0 && (binding.documentLifecycle === null || binding.documentLifecycle === "active") && retireFrameTree(d, binding, event.at);
      }
      break;
    }
    case "transport:stopped": {
      let report2 = d.readReport(event.documentKey), meta = d.readMeta(event.documentKey);
      if (!report2 || !meta || !meta.bound || meta.revoked || meta.accessGranted === !1) break;
      if (!report2.coverageFlags.includes(event.reason)) {
        let copy = cloneReport(report2);
        copy.coverageFlags = withFlag(copy.coverageFlags, event.reason), finalize(d, copy, cloneMeta(meta), event.at), d.persist(event.documentKey, !0);
      }
      break;
    }
    case "transport:dropped": {
      let report2 = d.readReport(event.documentKey), meta = d.readMeta(event.documentKey);
      if (report2 === void 0 || meta === void 0 || meta.revoked || meta.accessGranted === !1) break;
      let r = cloneReport(report2);
      r.dropped.transport = satAdd2(r.dropped.transport, event.count), r.coverageFlags = withFlag(r.coverageFlags, "throttled"), finalize(d, r, cloneMeta(meta), event.at), d.persist(event.documentKey, !1);
      break;
    }
    case "scope:access": {
      for (let [key2, binding] of d.finish().bindings)
        binding.documentKey === event.documentKey && d.bindings.set(key2, {
          ...binding,
          accessGranted: event.accessGranted,
          originPending: event.accessGranted ? !1 : binding.originPending === !0,
          host: event.accessGranted ? reportHost(event.host) : null
        });
      let report2 = d.readReport(event.documentKey), meta = d.readMeta(event.documentKey);
      if (report2 !== void 0 && meta !== void 0) {
        let r = cloneReport(report2), m = cloneMeta(meta);
        if (m.accessGranted = event.accessGranted, r.host = event.accessGranted ? reportHost(event.host) : null, event.accessGranted ? (m.revoked = !1, r.coverageFlags = r.coverageFlags.filter((f) => f !== "no-host-permission" && f !== "revoked")) : m.revoked || (r.coverageFlags = withFlag(r.coverageFlags, "no-host-permission")), finalize(d, r, m, event.at), d.persist(event.documentKey, !1), !event.accessGranted) {
          let binding = [...d.finish().bindings.values()].find((entry) => entry.documentKey === event.documentKey);
          binding && !binding.originPending && markAncestorFrameGap(d, binding, event.at);
        }
      }
      d.persistIndex();
      break;
    }
    case "scope:revoked":
      onRevoked(d, event.documentKeys, event.at, event.unresolvedOrigin);
      break;
    case "document:degraded":
      onDegraded(d, event.documentKey, event.truncate, event.at);
      break;
    case "document:evict": {
      let removed = [];
      for (let key2 of event.documentKeys)
        d.readReport(key2) !== void 0 && (d.evictDocument(key2, !1), removed.push(key2));
      d.remove(removed);
      break;
    }
  }
  let result = { state: d.finish(), effects: d.effects };
  return batch !== void 0 && (result.batch = batch), result;
}
function selectDocumentKey(state, tabId, frameId) {
  return frameId !== void 0 ? state.bindings.get(bindingKey(tabId, frameId))?.documentKey ?? null : state.tabs.get(tabId)?.activeTopDocumentKey ?? null;
}
function isProjected(state, documentKey3) {
  for (let t of state.tabs.values()) if (t.activeTopDocumentKey === documentKey3) return !0;
  return !1;
}
function planEviction(state, exclude = /* @__PURE__ */ new Set()) {
  let unbound = [], bound = [];
  for (let meta of state.metas.values())
    exclude.has(meta.documentKey) || isProjected(state, meta.documentKey) || (meta.bound ? bound : unbound).push(meta);
  let byActivity = (a, b) => a.lastActivityAt - b.lastActivityAt;
  return unbound.sort(byActivity), bound.sort(byActivity), [...unbound, ...bound].map((m) => m.documentKey);
}
function boundedRecord(value, depth, remaining) {
  if (--remaining.nodes < 0 || depth > 8) return !1;
  if (typeof value == "string") return value.length <= BUDGETS.maxStringChars;
  if (value === null || typeof value != "object") return !0;
  let entries = Object.entries(value);
  return entries.length > BUDGETS.maxBridgeRecordsPerDocument ? !1 : entries.every(([key2, item]) => key2.length <= BUDGETS.maxStringChars && boundedRecord(item, depth + 1, remaining));
}
function estimateReportBytes(report2, meta) {
  if (meta.responseHeaders !== void 0 && readResponseHeaders(meta.responseHeaders) === null || report2.counters.length > BUDGETS.maxCountersPerDocumentGroup || report2.findings.length > BUDGETS.maxFindingsPerDocument || report2.hosts.length > BUDGETS.maxHostsPerDocument || meta.boots.length > MAX_BOOTS_PER_DOCUMENT || meta.sessions.length > MAX_SESSIONS_PER_DOCUMENT || (meta.networkCounters?.length ?? 0) > 4) return 1 / 0;
  for (let boot of meta.boots) if (Object.keys(boot.counts).length > BUDGETS.maxCountersPerDocumentGroup) return 1 / 0;
  let record2 = { v: 1, report: report2, meta };
  return boundedRecord(record2, 0, { nodes: 2e4 }) ? new TextEncoder().encode(JSON.stringify(record2)).byteLength : 1 / 0;
}

// packages/background/src/engine-port.ts
var noopEngine = {
  deriveFindings() {
    return [];
  }
};

// packages/background/src/projection.ts
var PHASE_ORDER = new Map(PHASES.map((p, i) => [p, i]));
function projectVendors(report2, at2 = Date.now()) {
  let byVendor = /* @__PURE__ */ new Map();
  for (let h of report2.hosts)
    for (let ruleId of h.ruleIds) {
      let match = lookupVendorResourceRule(ruleId, at2);
      if (match === null) continue;
      let existing = byVendor.get(match.vendorId);
      existing === void 0 ? byVendor.set(match.vendorId, {
        vendorId: match.vendorId,
        vendorConfidence: "documented-resource",
        ruleIds: [ruleId],
        evidenceSource: "browser-network",
        integrity: "browser-observed"
      }) : existing.ruleIds.length < 32 && !existing.ruleIds.includes(ruleId) && existing.ruleIds.push(ruleId);
    }
  let vendors = [...byVendor.values()];
  for (let vendor2 of vendors) vendor2.ruleIds.sort();
  return vendors.sort((a, b) => a.vendorId < b.vendorId ? -1 : a.vendorId > b.vendorId ? 1 : 0);
}
function mergeVendorSummaries(...groups) {
  let vendors = /* @__PURE__ */ new Map(), rank2 = { none: 0, "weak-signal": 1, "multi-signal": 2, "documented-resource": 3 };
  for (let group of groups) for (let value of group) {
    let previous = vendors.get(value.vendorId);
    if (!previous || rank2[value.vendorConfidence] > rank2[previous.vendorConfidence])
      (vendors.size < 128 || previous) && vendors.set(value.vendorId, { ...value, ruleIds: value.ruleIds.slice(0, 32) });
    else if (value.vendorConfidence === previous.vendorConfidence && value.evidenceSource === previous.evidenceSource && value.integrity === previous.integrity)
      for (let ruleId of value.ruleIds) previous.ruleIds.length < 32 && !previous.ruleIds.includes(ruleId) && previous.ruleIds.push(ruleId);
  }
  for (let value of vendors.values()) value.ruleIds.sort();
  return [...vendors.values()].sort((a, b) => a.vendorId.localeCompare(b.vendorId));
}
function projectReport2(report2, meta, scopeMode, at2 = Date.now(), additionalVendors = [], vendorObservedAt = null) {
  let denied2 = meta.revoked || meta.accessGranted === !1 || scopeMode === "off", vendors = denied2 ? [] : mergeVendorSummaries(projectVendors(report2, at2), additionalVendors), observedSince = meta.firstObservationAt === null ? vendorObservedAt : vendorObservedAt === null ? meta.firstObservationAt : Math.min(meta.firstObservationAt, vendorObservedAt);
  return projectReport(report2, {
    scopeMode,
    catalogEnabled: hasEnabledVendorResourceRules(at2) || additionalVendors.length > 0,
    vendors,
    observedSince: denied2 ? null : observedSince,
    browserNetworkCounters: denied2 ? [] : meta.networkCounters ?? [],
    ...!denied2 && meta.responseHeaders ? { responseHeaders: meta.responseHeaders } : {},
    ...!denied2 && meta.requestedLocalPorts ? { requestedLocalPorts: meta.requestedLocalPorts } : {}
  });
}

// packages/background/src/rate-limit.ts
var MAX_BUCKETS = 1024, IDLE_MS = 1e4;
function refill(bucket, capacity, now) {
  let elapsed = now - bucket.updatedAt;
  elapsed > 0 && (bucket.tokens = Math.min(capacity, bucket.tokens + elapsed / 1e3 * capacity), bucket.updatedAt = now);
}
var RateLimiter = class {
  documents = /* @__PURE__ */ new Map();
  tabs = /* @__PURE__ */ new Map();
  global = { tokens: BUDGETS.maxBatchesPerSecondGlobal, updatedAt: 0 };
  lastSweep = 0;
  /** True when the batch may be processed; false when any of the three budgets is exhausted. */
  tryConsume(documentKey3, tabId, now) {
    this.sweep(now);
    let doc = this.bucket(this.documents, documentKey3, BUDGETS.maxBatchesPerSecondPerDocument, now), tab = this.bucket(this.tabs, tabId, BUDGETS.maxBatchesPerSecondPerTab, now);
    return refill(this.global, BUDGETS.maxBatchesPerSecondGlobal, now), doc.tokens < 1 || tab.tokens < 1 || this.global.tokens < 1 ? !1 : (doc.tokens -= 1, tab.tokens -= 1, this.global.tokens -= 1, !0);
  }
  bucket(map, key2, capacity, now) {
    let b = map.get(key2);
    if (b === void 0) {
      if (map.size >= MAX_BUCKETS) {
        let first = map.keys().next();
        first.done || map.delete(first.value);
      }
      return b = { tokens: capacity, updatedAt: now }, map.set(key2, b), b;
    }
    return refill(b, capacity, now), b;
  }
  sweep(now) {
    if (!(now - this.lastSweep < IDLE_MS)) {
      this.lastSweep = now;
      for (let [k, b] of this.documents) now - b.updatedAt > IDLE_MS && this.documents.delete(k);
      for (let [k, b] of this.tabs) now - b.updatedAt > IDLE_MS && this.tabs.delete(k);
    }
  }
};

/* clear-reset:clear-journal:start */
var CLEAR_FENCES_KEY = "clear-epochs:v1";
function readClearFence(raw) {
  if (!isRecord(raw) || Object.keys(raw).some((key) => !["documentKey", "bridgeSessionId", "sensorBootIds", "at", "paused", "reportRevision"].includes(key))) return null;
  const { documentKey, bridgeSessionId, sensorBootIds, at } = raw;
  if (typeof documentKey !== "string" || documentKey.length < 1 || documentKey.length > 128 || typeof bridgeSessionId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(bridgeSessionId) || !Number.isSafeInteger(at) || at < 0 || !Array.isArray(sensorBootIds) || sensorBootIds.length > 4 || sensorBootIds.some((id) => typeof id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) || new Set(sensorBootIds).size !== sensorBootIds.length || raw["paused"] !== void 0 && typeof raw["paused"] !== "boolean" || !Number.isSafeInteger(raw["reportRevision"]) || raw["reportRevision"] < 0 || raw["reportRevision"] > 2147483647) return null;
  return {
    documentKey,
    bridgeSessionId,
    sensorBootIds: [...sensorBootIds],
    at,
    reportRevision: raw["reportRevision"],
    ...raw["paused"] === void 0 ? {} : { paused: raw["paused"] }
  };
}
function clearFenceBytes(fences) {
  return new TextEncoder().encode(CLEAR_FENCES_KEY + JSON.stringify({ v: 1, documents: [...fences.values()] })).byteLength;
}
/* clear-reset:clear-journal:end */
/* clear-reset:session-key-enumeration:start */
async function sessionStorageKeys(storage) {
  if (typeof storage.getKeys === "function") return storage.getKeys();
  return Object.keys(await storage.get(null));
}
/* clear-reset:session-key-enumeration:end */
// packages/background/src/repository.ts
var DOC_KEY_PREFIX = "doc:", INDEX_KEY = "index", STORED_VERSION = 1;
function isRecord(v) {
  return typeof v == "object" && v !== null && !Array.isArray(v);
}
function isQuotaError(e) {
  let message = e instanceof Error ? e.message : typeof e == "string" ? e : "";
  return /quota/i.test(message);
}
var HOST_CATEGORIES = /* @__PURE__ */ new Set(["loopback", "link-local", "private", "ULA", "public", "localhost", "local", "single-label", "unknown"]), RELATIONS = /* @__PURE__ */ new Set(["same-origin", "same-site", "cross-site", "opaque", "unknown"]);
function redactStoredHosts(value) {
  if (!Array.isArray(value)) return [];
  let out = [];
  for (let h of value.slice(0, BUDGETS.maxHostsPerDocument)) {
    if (!isRecord(h)) continue;
    let domain = reportHost(h.registrableDomain), category = h.category;
    if (domain === null && (typeof category != "string" || !HOST_CATEGORIES.has(category))) continue;
    let relation = typeof h.relation == "string" && RELATIONS.has(h.relation) ? h.relation : "unknown", count3 = (n) => typeof n == "number" && Number.isFinite(n) ? Math.min(2147483647, Math.max(0, Math.floor(n))) : 0;
    out.push({
      ...domain === null ? { category } : { registrableDomain: domain },
      relation,
      evidenceSource: "browser-network",
      integrity: "browser-observed",
      requestCount: count3(h.requestCount),
      firstSeenBucket: count3(h.firstSeenBucket),
      lastSeenBucket: count3(h.lastSeenBucket),
      ruleIds: Array.isArray(h.ruleIds) ? h.ruleIds.filter((id4) => typeof id4 == "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id4)).slice(0, 32) : []
    });
  }
  return out;
}
function readStoredDocument(key, value) {
  if (!key.startsWith(DOC_KEY_PREFIX) || !isRecord(value) || value["v"] !== STORED_VERSION) return null;
  const report = value["report"];
  const meta = value["meta"];
  if (!isRecord(report) || !isRecord(meta)) return null;
  const portsField = Object.getOwnPropertyDescriptor(meta, "requestedLocalPorts");
  const requestedLocalPorts = portsField && Object.hasOwn(portsField, "value") ? readRequestedLocalPorts(portsField.value) : null;
  if (portsField && (!portsField.enumerable || requestedLocalPorts === null)) return null;
  const headersField = Object.getOwnPropertyDescriptor(meta, "responseHeaders");
  const responseHeaders = headersField && Object.hasOwn(headersField, "value") ? readResponseHeaders(headersField.value) : null;
  if (headersField && (!headersField.enumerable || responseHeaders === null)) return null;
  const documentKey = key.slice(DOC_KEY_PREFIX.length);
  if (report["schemaVersion"] !== 1 || report["documentKey"] !== documentKey || meta["documentKey"] !== documentKey) return null;
  if (!Array.isArray(report["counters"]) || !Array.isArray(report["findings"]) || !Array.isArray(report["hosts"]) || !Array.isArray(report["coverageFlags"]) || !isRecord(report["dropped"]) || !Array.isArray(meta["boots"]) || !Array.isArray(meta["sessions"]) || !isRecord(meta["folded"]) || report["counters"].length > BUDGETS.maxCountersPerDocumentGroup || report["findings"].length > BUDGETS.maxFindingsPerDocument || report["hosts"].length > BUDGETS.maxHostsPerDocument || meta["boots"].length > 4 || meta["sessions"].length > 4) {
    return null;
  }
  if (meta["cleared"] !== void 0 && typeof meta["cleared"] !== "boolean") return null;
  if (meta["cleared"] === true && (report["counters"].length !== 0 || report["findings"].length !== 0 || report["hosts"].length !== 0 || report["host"] !== null || report["watermark"] !== null)) return null;
  if (meta["clearEpoch"] !== void 0 && readClearFence({ documentKey, bridgeSessionId: meta["clearEpoch"], sensorBootIds: meta["clearBootIds"], at: 0, reportRevision: report["revision"] }) === null) return null;
  if (meta["counterKeyFormat"] !== void 0 && meta["counterKeyFormat"] !== "index-v1") return null;
  const slots = /* @__PURE__ */ new Map();
  try {
    for (const [i, counter] of report["counters"].entries()) {
      const c = counter;
      if (Object.hasOwn(c, "apiOperation")) {
        const keys = ["techniqueId", "phase", "signalCodes", "count", "countQuality", "firstBucket", "lastBucket", "apiOperation"];
        if (Reflect.ownKeys(c).length !== keys.length || keys.some((key2) => {
          const field = Object.getOwnPropertyDescriptor(c, key2);
          return !field || !field.enumerable || !Object.hasOwn(field, "value");
        }) || !isApiOperation(c.apiOperation) || !apiOperationAllows(c.apiOperation, c.techniqueId, c.phase) || !Array.isArray(c.signalCodes) || c.signalCodes.length !== 1 || c.signalCodes[0] !== "api-use") return null;
      }
      if (Object.hasOwn(c, "extensionResource")) {
        const keys = ["techniqueId", "phase", "signalCodes", "count", "countQuality", "firstBucket", "lastBucket", "extensionResource"];
        if (Reflect.ownKeys(c).length !== keys.length || keys.some((key2) => {
          const field = Object.getOwnPropertyDescriptor(c, key2);
          return !field?.enumerable || !Object.hasOwn(field, "value");
        })) return null;
        const resource = readExtensionResource(c.extensionResource);
        if (!resource || !extensionResourceAllows(resource, c.techniqueId, c.phase) || !Array.isArray(c.signalCodes) || c.signalCodes.length !== 1 || c.signalCodes[0] !== "api-use" || !Number.isSafeInteger(c.count) || c.count < 0 || c.count > 2147483647 || !["exact", "sampled", "lower-bound"].includes(c.countQuality) || !Number.isSafeInteger(c.firstBucket) || !Number.isSafeInteger(c.lastBucket) || c.firstBucket < 0 || c.lastBucket < c.firstBucket || c.lastBucket > 2147483647) return null;
      }
      const ck = counterKey(c.techniqueId, c.phase, c.signalCodes, c.apiOperation, c.extensionResource);
      if (slots.has(ck)) return null;
      slots.set(ck, String(i));
    }
  } catch {
    return null;
  }
  const boots = [];
  for (const boot of meta["boots"]) {
    if (!isRecord(boot) || typeof boot["sensorBootId"] !== "string" || !isRecord(boot["counts"])) return null;
    const counts = {};
    for (const [key2, count] of Object.entries(boot["counts"])) {
      const slot = meta["counterKeyFormat"] === "index-v1" ? key2 : slots.get(key2);
      if (slot === void 0 || !/^(0|[1-9][0-9]*)$/.test(slot) || Number(slot) >= report["counters"].length || typeof count !== "number" || !Number.isInteger(count) || count < 0 || count > 2147483647) return null;
      counts[slot] = count;
    }
    boots.push({ sensorBootId: boot["sensorBootId"], counts });
  }
  return {
    v: STORED_VERSION,
    report: { ...report, host: reportHost(report["host"]), hosts: redactStoredHosts(report["hosts"]) },
    meta: {
      ...meta,
      counterKeyFormat: "index-v1",
      boots,
      ...requestedLocalPorts === null ? {} : { requestedLocalPorts },
      ...responseHeaders === null ? {} : { responseHeaders },
      networkCounters: typeof meta["networkCounterEpoch"] === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(meta["networkCounterEpoch"]) ? readNetworkCounters(meta["networkCounters"]) : [],
      networkCounterEpoch: typeof meta["networkCounterEpoch"] === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(meta["networkCounterEpoch"]) ? meta["networkCounterEpoch"] : void 0
    }
  };
}
function readStoredIndex(value) {
  if (!isRecord(value) || value.v !== STORED_VERSION) return null;
  let bindings = value.bindings, tabs = value.tabs;
  if (!Array.isArray(bindings) || !Array.isArray(tabs)) return null;
  let savedAt = typeof value.savedAt == "number" ? value.savedAt : 0;
  return {
    v: STORED_VERSION,
    bindings: bindings.filter((b) => isRecord(b) && typeof b.documentKey == "string" && typeof b.tabId == "number").map((b) => ({ ...b, host: reportHost(b.host) })),
    tabs: tabs.filter((t) => isRecord(t) && typeof t.tabId == "number"),
    savedAt,
    evictedKeys: Array.isArray(value.evictedKeys) ? value.evictedKeys.filter((k) => typeof k == "string" && k.length <= 128).slice(-256) : []
  };
}
function redactedIndex(index) {
  return { ...index, bindings: index.bindings.map((b) => ({ ...b, host: reportHost(b.host) })) };
}
var SessionRepository = class {
  constructor(storage) {
    this.storage = storage;
  }
  storage;
  /** Per-document serialized promise queue: one read-modify-write of a snapshot at a time (A10). */
  queues = /* @__PURE__ */ new Map();
  writes = Promise.resolve();
  write(task) {
    let next = this.writes.then(task, task);
    return this.writes = next.catch(() => {
    }), next;
  }
  /** TRUSTED_CONTEXTS where available (Chrome 102+); the default is already trusted-only. */
  async init() {
    if (typeof this.storage.setAccessLevel == "function")
      try {
        await this.storage.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
      } catch {
      }
  }
  /** Runs `task` after every earlier task for the same document; different documents run independently. */
  run(documentKey3, task) {
    let result = (this.queues.get(documentKey3) ?? Promise.resolve()).then(task, task), settled = result.then(
      () => {
      },
      () => {
      }
    );
    return this.queues.set(documentKey3, settled), settled.then(() => {
      this.queues.get(documentKey3) === settled && this.queues.delete(documentKey3);
    }), result;
  }
  async loadAll(isCurrent = () => true) {
    const keys = await sessionStorageKeys(this.storage);
    if (!isCurrent()) throw new Error("history-access-changed");
    const items = await this.storage.get(keys.filter(key => key === INDEX_KEY || key === CLEAR_FENCES_KEY || key.startsWith(DOC_KEY_PREFIX)));
    if (!isCurrent()) throw new Error("history-access-changed");
    const journal = items[CLEAR_FENCES_KEY];
    this.fences = /* @__PURE__ */ new Map();
    this.fenceSize = 0;
    if (journal !== void 0) {
      if (!isRecord(journal) || journal["v"] !== 1 || !Array.isArray(journal["documents"]) || journal["documents"].length > 1024) throw new Error("clear-journal");
      for (const value of journal["documents"]) {
        const fence = readClearFence(value);
        if (fence === null || this.fences.has(fence.documentKey)) throw new Error("clear-journal");
        this.fences.set(fence.documentKey, fence);
      }
      this.fenceSize = clearFenceBytes(this.fences);
    }
    const documents = [];
    let discarded = 0;
    const discardedKeys = [];
    let index = null;
    for (const key of Object.keys(items)) {
      if (key === INDEX_KEY) {
        index = readStoredIndex(items[key]);
        if (index === null) {
          discarded++;
          discardedKeys.push(key);
        }
        continue;
      }
      if (!key.startsWith(DOC_KEY_PREFIX)) continue;
      const doc = readStoredDocument(key, items[key]);
      if (doc === null) {
        discarded++;
        discardedKeys.push(key);
      } else {
        const fence = this.fences.get(doc.report.documentKey);
        documents.push(fence !== void 0 && doc.meta.clearEpoch !== fence.bridgeSessionId ? { v: 1, ...resetDocument(doc.report, doc.meta, fence) } : doc);
      }
    }
    if (index !== null) for (const fence of this.fences.values()) {
      if (documents.some((doc) => doc.report.documentKey === fence.documentKey)) continue;
      const binding = index.bindings.find((entry) => entry.documentKey === fence.documentKey);
      if (binding !== void 0) documents.push({ v: 1, ...clearedFromBinding(binding, fence) });
    }
    if (discardedKeys.length > 0) await this.write(() => {
      if (!isCurrent()) throw new Error("history-access-changed");
      return this.storage.remove(discardedKeys);
    });
    const migrated = {};
    if (index !== null) migrated[INDEX_KEY] = redactedIndex(index);
    for (const doc of documents) migrated[DOC_KEY_PREFIX + doc.report.documentKey] = doc;
    if (Object.keys(migrated).length > 0) await this.write(() => {
      if (!isCurrent()) throw new Error("history-access-changed");
      return this.storage.set(migrated);
    });
    if (!isCurrent()) throw new Error("history-access-changed");
    return { index, documents, discarded };
  }
  /** Snapshot + watermark (+ index when dirty) in exactly one set() call. Never throws. */
  async commit(documentKey3, record2, index) {
    let rounded = (at2) => Math.floor(at2 / 1e3) * 1e3, stored = {
      v: 1,
      report: {
        ...record2.report,
        createdAt: rounded(record2.report.createdAt),
        updatedAt: rounded(record2.report.updatedAt),
        host: reportHost(record2.report.host),
        hosts: redactStoredHosts(record2.report.hosts)
      },
      meta: {
        ...record2.meta,
        lastActivityAt: rounded(record2.meta.lastActivityAt),
        firstObservationAt: record2.meta.firstObservationAt === null ? null : rounded(record2.meta.firstObservationAt)
      }
    }, items = { [DOC_KEY_PREFIX + documentKey3]: stored };
    index !== null && (items[INDEX_KEY] = redactedIndex(index));
    try {
      return await this.write(() => this.storage.set(items)), { ok: !0 };
    } catch (e) {
      return { ok: !1, failure: isQuotaError(e) ? "quota" : "storage" };
    }
  }
  async remove(documentKeys, forgetFences = true) {
    if (documentKeys.length === 0) return true;
    try {
      await this.write(async () => {
        await this.storage.remove(documentKeys.map((k) => DOC_KEY_PREFIX + k));
        if (forgetFences && documentKeys.some((key) => this.fences.has(key))) {
          const next = new Map(this.fences);
          for (const key of documentKeys) next.delete(key);
          await this.storage.set({ [CLEAR_FENCES_KEY]: { v: 1, documents: [...next.values()] } });
          this.fences = next;
          this.fenceSize = clearFenceBytes(next);
        }
      });
      return true;
    } catch {
      return false;
    }
  }
  async saveIndex(index) {
    try {
      return await this.write(() => this.storage.set({ [INDEX_KEY]: redactedIndex(index) })), !0;
    } catch {
      return !1;
    }
  }
  /** Real usage as Chrome estimates it (session quota is a memory estimate, not JSON length); null if unavailable. */
  async bytesInUse(keys4 = null) {
    if (typeof this.storage.getBytesInUse != "function") return null;
    try {
      let n = await this.storage.getBytesInUse(keys4);
      return typeof n == "number" && Number.isFinite(n) && n >= 0 ? n : null;
    } catch {
      return null;
    }
  }
  async clearAll(keepKeys = [], keepKey = null) {
    try {
      return await Promise.all([...this.queues.values()]), await this.write(async () => {
        // ADR-047 (B9): keepKey (optional) keeps more keys; only an exact `true` keeps, a throwing predicate removes.
        let kept = (key2) => {
          if (keepKeys.includes(key2)) return !0;
          if (typeof keepKey != "function") return !1;
          try {
            return keepKey(key2) === !0;
          } catch {
            return !1;
          }
        };
        if (keepKeys.length === 0 && typeof keepKey != "function") await this.storage.clear();
        else {
          let keys = await sessionStorageKeys(this.storage), remove = keys.filter((key2) => !kept(key2));
          remove.length > 0 && await this.storage.remove(remove);
        }
        /* clear-reset:clear-all-cache */
        if (!kept(CLEAR_FENCES_KEY)) { this.fences.clear(); this.fenceSize = 0; }
      }), !0;
    } catch {
      return !1;
    }
  }

fences = /* @__PURE__ */ new Map();

fenceSize = 0;

clearFence(documentKey) {
    return this.fences.get(documentKey);
  }

get clearFenceBytes() {
    return this.fenceSize;
  }

runMany(documentKeys, task) {
    const keys = [...new Set(documentKeys)];
    const previous = keys.map((key) => this.queues.get(key) ?? Promise.resolve());
    const result = Promise.all(previous).then(task);
    const settled = result.then(() => void 0, () => void 0);
    for (const key of keys) this.queues.set(key, settled);
    void settled.then(() => {
      for (const key of keys) if (this.queues.get(key) === settled) this.queues.delete(key);
    });
    return result;
  }

async commitMany(records, index) {
    const rounded = (at) => Math.floor(at / 1e3) * 1e3;
    const items = {};
    for (const [documentKey, record] of records) {
      const stored = {
        v: 1,
        report: {
          ...record.report,
          createdAt: rounded(record.report.createdAt),
          updatedAt: rounded(record.report.updatedAt),
          host: reportHost(record.report.host),
          hosts: redactStoredHosts(record.report.hosts)
        },
        meta: {
          ...record.meta,
          lastActivityAt: rounded(record.meta.lastActivityAt),
          firstObservationAt: record.meta.firstObservationAt === null ? null : rounded(record.meta.firstObservationAt)
        }
      };
      items[DOC_KEY_PREFIX + documentKey] = stored;
    }
    if (index !== null) items[INDEX_KEY] = redactedIndex(index);
    try {
      await this.write(() => this.storage.set(items));
      return { ok: true };
    } catch (e) {
      return { ok: false, failure: isQuotaError(e) ? "quota" : "storage" };
    }
  }

async commitClear(fences, estimatedSessionBytes = 0) {
    return this.write(async () => {
      const next = new Map(this.fences);
      for (const fence of fences) {
        if (readClearFence(fence) === null) throw new Error("clear-fence");
        next.set(fence.documentKey, fence);
      }
      if (next.size > 1024) throw new Error("clear-fence-budget");
      const nextBytes = clearFenceBytes(next);
      const usage = await this.bytesInUse();
      if ((usage ?? estimatedSessionBytes) - this.fenceSize + nextBytes > BUDGETS.maxSessionTotalBytes) return { committed: false, cleaned: false };
      try {
        await this.storage.set({ [CLEAR_FENCES_KEY]: { v: 1, documents: [...next.values()] } });
      } catch {
        try {
          const actual = (await this.storage.get(CLEAR_FENCES_KEY))[CLEAR_FENCES_KEY];
          if (!isRecord(actual) || JSON.stringify(actual) !== JSON.stringify({ v: 1, documents: [...next.values()] })) return { committed: false, cleaned: false };
        } catch {
          return { committed: false, cleaned: false };
        }
      }
      this.fences = next;
      this.fenceSize = nextBytes;
      try {
        await this.storage.remove(fences.map((fence) => DOC_KEY_PREFIX + fence.documentKey));
        return { committed: true, cleaned: true };
      } catch {
        return { committed: true, cleaned: false };
      }
    });
  }
};

// packages/contracts/src/data-consent.ts
var DATA_CONSENT_KEY = "data-consent:v1", DATA_CONSENT_PENDING_KEY = "data-consent:pending-v1";
function fields2(value, names4) {
  if (typeof value != "object" || value === null || Array.isArray(value) || Reflect.ownKeys(value).length !== names4.length) return null;
  let result = /* @__PURE__ */ Object.create(null);
  for (let name of names4) {
    let descriptor3 = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor3 || !Object.hasOwn(descriptor3, "value") || !descriptor3.enumerable) return null;
    result[name] = descriptor3.value;
  }
  return result;
}
function readDataConsentRequest(value) {
  try {
    let short = fields2(value, ["schemaVersion", "type"]);
    if (short?.schemaVersion === 1 && short.type === "ui-data-consent-get") return { schemaVersion: 1, type: "ui-data-consent-get" };
    let record2 = fields2(value, ["schemaVersion", "type", "version", "accepted"]);
    return !record2 || record2.schemaVersion !== 1 || record2.type !== "ui-data-consent-set" || record2.version !== 1 || typeof record2.accepted != "boolean" ? null : { schemaVersion: 1, type: "ui-data-consent-set", version: 1, accepted: record2.accepted };
  } catch {
    return null;
  }
}
function storedDataConsent(value) {
  try {
    let record2 = fields2(value, ["version", "accepted"]);
    return record2?.version === 1 && record2.accepted === !0;
  } catch {
    return !1;
  }
}

// packages/background/src/scope.ts
var SCOPE_PREFS_KEY = "scope", FULL_ACCESS_DEFAULT_KEY = "scope:full-access-default-v1", ACTIVE_TABS_KEY = "active-tabs", ISOLATED_SCRIPT_ID = "detector-isolated-v1", MAIN_SCRIPT_ID = "detector-main-v1", ISOLATED_SCRIPT_FILE = "bridge.js", MAIN_SCRIPT_FILE = "hook.main.js", EARLY_MAIN_SCRIPT_FILE = "hook.early.js", ALL_SITES_PATTERNS = ["http://*/*", "https://*/*"], ALL_NETWORK_ACCESS_PATTERNS = [...ALL_SITES_PATTERNS, "ws://*/*", "wss://*/*"], CONTAINS_CACHE_MS = 5e3, REGISTRATION_CACHE_MS = 1e3, MAX_CONTAINS_CACHE = 512, SCOPE_SET2 = new Set(SCOPE_MODES);
function hostPatterns(host2) {
  return ["http://" + host2 + "/*", "https://" + host2 + "/*"];
}
function patternCoversHost(pattern, host2) {
  if (pattern === "<all_urls>") return !0;
  let schemeEnd = pattern.indexOf("://");
  if (schemeEnd <= 0) return !1;
  let scheme = pattern.slice(0, schemeEnd);
  if (scheme !== "*" && scheme !== "http" && scheme !== "https" && scheme !== "ws" && scheme !== "wss") return !1;
  let rest = pattern.slice(schemeEnd + 3), slash = rest.indexOf("/");
  if (slash < 0) return !1;
  let patternHost = rest.slice(0, slash).toLowerCase();
  if (patternHost === "*") return !0;
  if (patternHost.startsWith("*.")) {
    let suffix = patternHost.slice(2);
    return host2 === suffix || host2.endsWith("." + suffix);
  }
  return patternHost === host2;
}
function readPrefs(value) {
  let fallback = { v: 1, scopeMode: "off", hosts: [] };
  if (typeof value != "object" || value === null || Array.isArray(value)) return fallback;
  let v = value;
  if (v.v !== 1) return fallback;
  let mode = v.scopeMode, hostsRaw = v.hosts, scopeMode = typeof mode == "string" && SCOPE_SET2.has(mode) ? mode : "off", hosts = [];
  if (Array.isArray(hostsRaw)) {
    for (let h of hostsRaw)
      if (isSanitizedHost(h) && !hosts.includes(h) && hosts.push(h), hosts.length >= BUDGETS.maxHostsPerDocument) break;
  }
  return { v: 1, scopeMode, hosts };
}
var ScopeController = class {
  constructor(api, clock, testBootstrap = !1) {
    this.api = api;
    this.clock = clock;
    this.testBootstrap = testBootstrap;
  }
  api;
  clock;
  testBootstrap;
  prefs = { v: 1, scopeMode: "off", hosts: [] };
  /** ADR-047 (W3): assigned by background.js; called after detector-main-v1 was registered or updated. */
  onMainRegistered = null;
  /** ADR-113: assigned by background.js before start(); decides whether the observation sensors stay out of pages next to Antidetect. */
  sensorGate = null;
  consentAccepted = !1;
  dataConsentLoaded = !1;
  fullAccessDefaultApplied = !1;
  get hasDataConsent() {
    return this.consentAccepted;
  }
  /** Origin patterns the browser reports as granted (permissions.getAll). */
  grantedOrigins = [];
  grantedAllSites = !1;
  requiredAllSites = !1;
  /** Static host_permissions from the manifest that are actually granted (test profile only). */
  staticPatterns = [];
  /** Successful activeTab injection, bounded by trusted tab/document identity (F003/F110). */
  activeTabs = /* @__PURE__ */ new Map();
  containsCache = /* @__PURE__ */ new Map();
  matchOriginAsFallbackSupported = null;
  registrationOk = !0;
  /** Match patterns the browser reports for BOTH detector scripts; [] when either is missing. */
  registeredMatches = [];
  registeredAt = 0;
  mutationChain = Promise.resolve();
  registrationRunning = null;
  registrationDirty = !1;
  activeSaveChain = Promise.resolve();
  accessGeneration = 0;
  accessMutations = 0;
  get accessReady() {
    return this.consentAccepted && this.accessMutations === 0;
  }
  serialize(task) {
    this.accessMutations++;
    let next = this.mutationChain.then(task, task).finally(() => {
      this.accessMutations--;
    });
    return this.mutationChain = next.catch(() => {
    }), next;
  }
  async saveActiveTabs() {
    let next = this.activeSaveChain.then(() => this.api.storage.session.set({ [ACTIVE_TABS_KEY]: [...this.activeTabs].map(([tabId, grant]) => ({ tabId, ...grant })) }));
    this.activeSaveChain = next.catch(() => {
    }), await next;
  }
  async load() {
    try {
      let items = await this.api.storage.local.get([SCOPE_PREFS_KEY, DATA_CONSENT_KEY, FULL_ACCESS_DEFAULT_KEY]), pending = await this.api.storage.session.get(DATA_CONSENT_PENDING_KEY);
      // ADR-041: installation enables ordinary observation once; saved decisions stay authoritative.
      if (!Object.hasOwn(items, DATA_CONSENT_KEY) && !Object.hasOwn(pending, DATA_CONSENT_PENDING_KEY)) {
        let defaults = { [DATA_CONSENT_KEY]: { version: 1, accepted: !0 } };
        await this.api.storage.local.set(defaults);
        Object.assign(items, defaults);
      }
      this.consentAccepted = pending[DATA_CONSENT_PENDING_KEY] !== !0 && storedDataConsent(items[DATA_CONSENT_KEY]), this.fullAccessDefaultApplied = items[FULL_ACCESS_DEFAULT_KEY] === !0, this.prefs = readPrefs(items[SCOPE_PREFS_KEY]);
    } catch (error4) {
      this.consentAccepted = !1, this.prefs = { v: 1, scopeMode: "off", hosts: [] };
      throw error4;
    } finally {
      this.dataConsentLoaded = !0;
    }
    await this.refreshGrants();
  }
  async refreshGrants() {
    this.accessGeneration++, this.containsCache.clear();
    let all = await this.api.permissions.getAll(), origins = Array.isArray(all.origins) ? all.origins.filter((o) => typeof o == "string") : [];
    this.grantedOrigins = origins, this.grantedAllSites = origins.includes("<all_urls>") || origins.includes("http://*/*") && origins.includes("https://*/*");
    let manifestHosts = [];
    try {
      let hp = this.api.runtime.getManifest().host_permissions;
      manifestHosts = Array.isArray(hp) ? hp.filter((p) => typeof p == "string") : [];
    } catch {
      manifestHosts = [];
    }
    this.staticPatterns = manifestHosts.filter((p) => this.testBootstrap && origins.includes(p)), this.requiredAllSites = manifestHosts.includes("<all_urls>") || manifestHosts.includes("http://*/*") && manifestHosts.includes("https://*/*");
  }
  async applyFullAccessDefault() {
    if (!this.consentAccepted || !this.requiredAllSites || !this.grantedAllSites) return;
    let saved = await this.api.storage.local.get([SCOPE_PREFS_KEY, FULL_ACCESS_DEFAULT_KEY]);
    if (saved[FULL_ACCESS_DEFAULT_KEY] === !0) return;
    if (Object.hasOwn(saved, SCOPE_PREFS_KEY)) {
      await this.api.storage.local.set({ [FULL_ACCESS_DEFAULT_KEY]: !0 });
      this.fullAccessDefaultApplied = !0;
      return;
    }
    let next = { v: 1, scopeMode: "all-sites", hosts: [] };
    await this.api.storage.local.set({ [SCOPE_PREFS_KEY]: next, [FULL_ACCESS_DEFAULT_KEY]: !0 }), this.prefs = next, this.fullAccessDefaultApplied = !0;
  }
  /** Startup: load prefs, verify grants, reconcile registrations (static test grants included). */
  async startup() {
    await this.serialize(async () => {
      try {
        if (await this.load(), await this.applyFullAccessDefault(), (await this.api.storage.local.get(SCOPE_PREFS_KEY))[SCOPE_PREFS_KEY] === void 0 && this.testBootstrap && this.staticPatterns.length > 0) {
          let hosts = this.staticPatterns.map((p) => p.slice(p.indexOf("://") + 3, -2));
          this.prefs = readPrefs({ v: 1, scopeMode: "site", hosts });
        }
        let stored = (await this.api.storage.session.get(ACTIVE_TABS_KEY))[ACTIVE_TABS_KEY];
        if (this.prefs.scopeMode === "active-tab" && Array.isArray(stored))
          for (let entry of stored.slice(0, BUDGETS.maxHostsPerDocument))
            entry && Number.isInteger(entry.tabId) && entry.tabId >= 0 && typeof entry.documentId == "string" && /^[A-Za-z0-9_-]{1,64}$/.test(entry.documentId) && this.activeTabs.set(entry.tabId, { documentId: entry.documentId });
        await this.saveActiveTabs(), await this.reconcilePrefs();
      } catch (error4) {
        throw this.suspendDataConsent(), error4;
      } finally {
        await this.loadSensorGate(), await this.ensureRegistration();
      }
    });
  }
  getScopeMode() {
    return this.consentAccepted ? this.prefs.scopeMode : "off";
  }
  getState() {
    return { scopeMode: this.getScopeMode(), hosts: this.consentAccepted ? [...this.prefs.hosts] : [], grantedAllSites: this.grantedAllSites, managed: !1, sensorsQuiet: this.sensorsWithheld() };
  }
  setDataConsent(accepted) {
    return this.serialize(async () => {
      this.suspendDataConsent(), await this.ensureRegistration();
      try {
        await this.refreshGrants();
        let next = accepted && !this.fullAccessDefaultApplied && this.prefs.scopeMode === "off" && this.requiredAllSites && this.grantedAllSites ? { v: 1, scopeMode: "all-sites", hosts: [] } : this.prefs, applied = this.fullAccessDefaultApplied || accepted;
        return await this.saveActiveTabs(), await this.api.storage.local.set({
          [DATA_CONSENT_KEY]: { version: 1, accepted },
          [SCOPE_PREFS_KEY]: next,
          [FULL_ACCESS_DEFAULT_KEY]: applied
        }), this.prefs = next, this.fullAccessDefaultApplied = applied, await this.api.storage.session.remove(DATA_CONSENT_PENDING_KEY), this.consentAccepted = accepted, await this.ensureRegistration(), !0;
      } catch {
        return this.consentAccepted = !1, await this.ensureRegistration(), !1;
      }
    });
  }
  suspendDataConsent() {
    this.consentAccepted = !1, this.accessGeneration++, this.containsCache.clear(), this.activeTabs.clear();
  }
  async beginDataConsentChange() {
    this.suspendDataConsent();
    let saved = await Promise.allSettled([
      this.api.storage.session.set({ [DATA_CONSENT_PENDING_KEY]: !0 }),
      this.api.storage.local.set({ [DATA_CONSENT_KEY]: { version: 1, accepted: !1 } })
    ]);
    return await this.ensureRegistration(), saved.some((result) => result.status === "fulfilled");
  }
  /** Guard for the network observer: no host access at all means nothing to attribute. */
  hasAnyHostAccess() {
    return this.consentAccepted && (this.desiredMatches().length > 0 || this.prefs.scopeMode === "active-tab" && this.activeTabs.size > 0);
  }
  isHostGrantedSync(host2, scheme) {
    for (let p of this.grantedOrigins) if (patternCoversHost(p, host2) && (p === "<all_urls>" || (scheme === void 0 ? /^(?:http|https|\*):\/\//.test(p) : p.startsWith(scheme + "://") || (scheme === "http" || scheme === "https") && p.startsWith("*://")))) return !0;
    return !1;
  }
  hasBroadNetworkAccess() {
    return this.consentAccepted && (this.grantedOrigins.includes("<all_urls>") || ALL_NETWORK_ACCESS_PATTERNS.every((pattern) => this.grantedOrigins.includes(pattern)));
  }
  isTabActiveTabGranted(tabId, host2, documentId2) {
    let grant = this.activeTabs.get(tabId);
    return this.consentAccepted && this.prefs.scopeMode === "active-tab" && host2 !== null && grant !== void 0 && documentId2 !== void 0 && grant.documentId === documentId2;
  }
  // REQ-012: retained browser permissions never override the user's selected scope.
  inScope(host2, tabId, documentId2, scheme) {
    return !this.consentAccepted || host2 === null ? !1 : this.isTabActiveTabGranted(tabId, host2, documentId2) ? !0 : this.prefs.scopeMode === "all-sites" ? this.grantedAllSites : this.prefs.scopeMode === "site" ? this.prefs.hosts.includes(host2) && this.isHostGrantedSync(host2, scheme) : !1;
  }
  /** ScopeAccess for sender verification: activeTab set, then permissions.contains (cached briefly). */
  async isGranted(originPattern, tabId, documentId2) {
    if (await this.mutationChain, !this.accessReady) return !1;
    let generation = this.accessGeneration, host2 = originPattern.slice(originPattern.indexOf("://") + 3, originPattern.length - 2);
    if (!this.inScope(host2, tabId, documentId2)) return !1;
    if (this.isTabActiveTabGranted(tabId, host2, documentId2)) return !0;
    let now = this.clock.now(), cacheKey = documentId2 === void 0 ? null : String(tabId) + ":" + documentId2, cached = cacheKey === null ? void 0 : this.containsCache.get(cacheKey);
    if (cached !== void 0 && now - cached.at < CONTAINS_CACHE_MS) return cached.granted;
    let granted = await this.api.permissions.contains({ origins: [originPattern] });
    return !this.accessReady || generation !== this.accessGeneration || !this.inScope(host2, tabId, documentId2) ? !1 : (this.containsCache.size >= MAX_CONTAINS_CACHE && this.containsCache.clear(), cacheKey !== null && this.containsCache.set(cacheKey, { granted, at: now }), granted);
  }
  /** SW side of ui-set-scope: verifies the permission is already granted, persists prefs, (un)registers. */
  setScope(request) {
    return this.serialize(() => this.setScopeNow(request));
  }
  async setScopeNow(request) {
    if (!this.consentAccepted && request.scopeMode !== "off") return { ok: !1, code: "no-access" };
    if (this.containsCache.clear(), request.scopeMode === "site") {
      let host2 = request.host;
      if (!isSanitizedHost(host2)) return { ok: !1, code: "no-access" };
      if (!(await Promise.all(hostPatterns(host2).map((p) => this.contains([p])))).some(Boolean)) return { ok: !1, code: "no-access" };
      let hosts = this.prefs.hosts.filter((h) => h !== host2);
      for (hosts.push(host2); hosts.length > BUDGETS.maxHostsPerDocument; ) hosts.shift();
      this.prefs = { v: 1, scopeMode: "site", hosts };
    } else if (request.scopeMode === "all-sites") {
      if (!await this.contains([...ALL_SITES_PATTERNS])) return { ok: !1, code: "no-access" };
      this.prefs = { ...this.prefs, scopeMode: "all-sites" };
    } else
      this.prefs = { ...this.prefs, scopeMode: request.scopeMode };
    this.activeTabs.clear(), await this.saveActiveTabs();
    try {
      await this.api.storage.local.set({ [SCOPE_PREFS_KEY]: this.prefs, [FULL_ACCESS_DEFAULT_KEY]: !0 });
    } catch {
    }
    return await this.refreshGrants(), await this.ensureRegistration(), { ok: !0, scope: this.getState() };
  }
  /** active-tab mode: late injection of both worlds into the tab the popup was opened on (activeTab grant). */
  injectNow(tabId, host2, documentId2) {
    return this.serialize(() => this.injectNowCurrent(tabId, host2, documentId2));
  }
  async injectNowCurrent(tabId, host2, documentId2) {
    if (!this.consentAccepted || host2 === null || documentId2 === void 0) return !1;
    let generation = this.accessGeneration;
    try {
      if (await this.api.scripting.executeScript({
        target: { tabId, documentIds: [documentId2] },
        files: [ISOLATED_SCRIPT_FILE],
        world: "ISOLATED",
        injectImmediately: !0
      }), !this.consentAccepted || generation !== this.accessGeneration) return !1;
      await this.api.scripting.executeScript({
        target: { tabId, documentIds: [documentId2] },
        files: [MAIN_SCRIPT_FILE],
        world: "MAIN",
        injectImmediately: !0
      });
    } catch {
      return !1;
    }
    let current = (await this.api.webNavigation.getAllFrames({ tabId }))?.find((f) => f.frameId === 0);
    if (!this.consentAccepted || generation !== this.accessGeneration || current?.documentId !== documentId2) return !1;
    let previousGrant = this.activeTabs.get(tabId);
    if (this.activeTabs.delete(tabId), this.activeTabs.size >= BUDGETS.maxHostsPerDocument) return !1;
    this.activeTabs.set(tabId, { documentId: documentId2 });
    let previous = this.prefs;
    this.prefs = { ...this.prefs, scopeMode: "active-tab" };
    try {
      await this.api.storage.local.set({ [SCOPE_PREFS_KEY]: this.prefs, [FULL_ACCESS_DEFAULT_KEY]: !0 }), await this.saveActiveTabs();
    } catch {
      this.activeTabs.delete(tabId), previousGrant !== void 0 && this.activeTabs.set(tabId, previousGrant), this.prefs = previous;
      try {
        await this.api.storage.local.set({ [SCOPE_PREFS_KEY]: previous }), await this.saveActiveTabs();
      } catch {
      }
      return !1;
    }
    return this.accessGeneration++, await this.ensureRegistration(), !0;
  }
  async reconcileActiveTabs(live) {
    for (let [tabId, grant] of this.activeTabs) live.has(String(tabId) + ":" + grant.documentId) || this.activeTabs.delete(tabId);
    await this.saveActiveTabs();
  }
  noteTabRemoved(tabId) {
    this.activeTabs.delete(tabId) && this.saveActiveTabs().catch(() => {
    });
  }
  /** activeTab access ends when the tab navigates to another origin (ADR-003 «Последствия»). */
  noteTopCommit(tabId, host2, documentId2) {
    let grant = this.activeTabs.get(tabId);
    return grant !== void 0 && documentId2 !== grant.documentId ? (this.accessGeneration++, this.noteTabRemoved(tabId), !0) : !1;
  }
  async onPermissionsChanged() {
    await this.serialize(async () => {
      await this.refreshGrants(), await this.applyFullAccessDefault(), await this.reconcilePrefs(), await this.ensureRegistration();
    });
  }
  async reconcilePrefs() {
    // Keep a fresh, not-yet-granted installation eligible for its one-time default.
    if (this.consentAccepted && this.requiredAllSites && !this.grantedAllSites && !this.fullAccessDefaultApplied) {
      let saved = await this.api.storage.local.get(SCOPE_PREFS_KEY);
      if (!Object.hasOwn(saved, SCOPE_PREFS_KEY)) return;
    }
    let hosts = this.prefs.hosts.filter((h) => this.isHostGrantedSync(h)), scopeMode = this.prefs.scopeMode;
    (scopeMode === "site" && hosts.length === 0 || scopeMode === "all-sites" && !this.grantedAllSites) && (scopeMode = "off"), this.prefs = { v: 1, hosts, scopeMode }, await this.api.storage.local.set({ [SCOPE_PREFS_KEY]: this.prefs });
  }
  get registrationHealthy() {
    return this.registrationOk;
  }
  noteRegistered(matches) {
    this.registeredMatches = [...matches], this.registeredAt = this.clock.now();
  }
  /** Re-reads the browser's registration (throttled). Never throws; an API failure counts as "nothing registered". */
  async refreshRegistration() {
    let now = this.clock.now();
    if (!(now - this.registeredAt < REGISTRATION_CACHE_MS)) {
      this.registeredAt = now;
      try {
        let existing = await this.api.scripting.getRegisteredContentScripts({ ids: [ISOLATED_SCRIPT_ID, MAIN_SCRIPT_ID] }), isolated = existing.find((s) => s.id === ISOLATED_SCRIPT_ID)?.matches ?? [], main = existing.find((s) => s.id === MAIN_SCRIPT_ID)?.matches ?? [];
        this.registeredMatches = existing.length === 2 ? main.filter((p) => isolated.includes(p)) : [];
      } catch {
        this.registeredMatches = [];
      }
    }
  }
  /** Both detector scripts are registered for the host: sensors were injected at document_start (REQ-006). */
  sensorsRegisteredFor(host2, scheme) {
    if (!this.consentAccepted) return !1;
    for (let p of this.registeredMatches)
      if (patternCoversHost(p, host2) && (scheme === void 0 || p === "<all_urls>" || p.startsWith("*://") || p.startsWith(scheme + "://")))
        return !0;
    return !1;
  }
  /** Individually granted patterns selected by the current scope. */
  desiredMatches() {
    if (!this.consentAccepted) return [];
    let out = [];
    if (this.prefs.scopeMode === "all-sites" && this.grantedAllSites) out.push(...ALL_SITES_PATTERNS);
    else if (this.prefs.scopeMode === "site")
      for (let h of this.prefs.hosts) for (let p of hostPatterns(h))
        this.grantedOrigins.some((g) => (g === "<all_urls>" || g.startsWith("*://") || g.startsWith(p.slice(0, p.indexOf("://") + 3))) && patternCoversHost(g, h)) && out.push(p);
    return out;
  }
  /** ADR-113: the sensors are being kept out of the sites in scope because the user asked for it and Antidetect is on. */
  sensorsWithheld() {
    return this.consentAccepted && this.sensorGate?.quiet() === !0 && this.desiredMatches().length > 0;
  }
  async loadSensorGate() {
    try {
      await this.sensorGate?.load();
    } catch {
    }
  }
  async contains(origins) {
    try {
      return await this.api.permissions.contains({ origins });
    } catch {
      return !1;
    }
  }
  buildScripts(matches, withFallback) {
    let base = { matches, allFrames: !0, runAt: "document_start", persistAcrossSessions: !0 }, fallback = withFallback ? { matchOriginAsFallback: !0 } : {};
    return [
      { id: ISOLATED_SCRIPT_ID, js: [ISOLATED_SCRIPT_FILE], world: "ISOLATED", ...base, ...fallback },
      { id: MAIN_SCRIPT_ID, js: [EARLY_MAIN_SCRIPT_FILE], world: "MAIN", ...base, ...fallback }
    ];
  }
  /** Registers/updates/unregisters detector-isolated-v1 + detector-main-v1 to match the desired scope. */
  ensureRegistration() {
    return this.registrationDirty = !0, this.registrationRunning !== null ? this.registrationRunning : (this.registrationRunning = (async () => {
      for (let pass = 0; pass < 3 && this.registrationDirty; pass++)
        this.registrationDirty = !1, await this.reconcileRegistration();
      this.registrationDirty && (this.registrationOk = !1);
    })().finally(() => {
      this.registrationRunning = null;
    }), this.registrationRunning);
  }
  async reconcileRegistration() {
    let ids2 = [ISOLATED_SCRIPT_ID, MAIN_SCRIPT_ID], withheld = this.sensorsWithheld(), matches = withheld ? [] : this.desiredMatches();
    withheld && this.sensorGate?.noteWithheld(!0);
    try {
      let existing = await this.api.scripting.getRegisteredContentScripts({ ids: ids2 });
      if (matches.length === 0) {
        existing.length > 0 && await this.api.scripting.unregisterContentScripts({ ids: existing.map((script) => script.id) }), this.registrationOk = !0, this.noteRegistered([]), withheld || this.sensorGate?.noteWithheld(!1);
        return;
      }
      let useUpdate = existing.length === ids2.length;
      !useUpdate && existing.length > 0 && await this.api.scripting.unregisterContentScripts({ ids: existing.map((script) => script.id) });
      let withFallback = this.matchOriginAsFallbackSupported !== !1;
      try {
        let scripts = this.buildScripts(matches, withFallback);
        useUpdate ? await this.api.scripting.updateContentScripts(scripts) : await this.api.scripting.registerContentScripts(scripts), withFallback && (this.matchOriginAsFallbackSupported = !0);
      } catch (e) {
        let message = e instanceof Error ? e.message : String(e);
        if (!withFallback || !/matchOriginAsFallback/.test(message)) throw e;
        this.matchOriginAsFallbackSupported = !1;
        let scripts = this.buildScripts(matches, !1);
        useUpdate ? await this.api.scripting.updateContentScripts(scripts) : await this.api.scripting.registerContentScripts(scripts);
      }
      this.sensorGate?.noteWithheld(!1);
      this.registrationOk = !0, this.noteRegistered(matches);
      // ADR-047 (W3): the module re-registers its MAIN after detector-main-v1, so hook.early.js sees native APIs first.
      try {
        this.onMainRegistered?.();
      } catch {
      }
    } catch {
      this.registrationOk = !1, this.noteRegistered([]);
    }
  }
};

// packages/background/src/visual-preview.ts
var MAX_VISUAL_DOCUMENTS = VISUAL_LIMITS.maxDocuments, VISUAL_IDLE_MS = VISUAL_CACHE_IDLE_MS, VISUAL_OWNER_KEY = "visual-owners-v1", VISUAL_READ_TIMEOUT_MS = 1500, TOUCH_MS = 6e4, disabled = () => ({ schemaVersion: 1, type: "visual-control", enabled: !1, remainingMs: 0 }), control = () => ({ schemaVersion: 1, type: "visual-control", enabled: !0, remainingMs: VISUAL_LIMITS.leaseMs }), rejected = () => ({ schemaVersion: 1, type: "visual-frame-ack", accepted: !1, cacheToken: null, remainingMs: 0 }), error = (code2) => ({ schemaVersion: 1, type: "error", code: code2 }), active = (lifecycle) => lifecycle == null || lifecycle === "active", documentId = (value) => typeof value == "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value), token2 = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) => value.toString(16).padStart(2, "0")).join(""), VisualPreviewManager = class {
  constructor(runtime) {
    this.runtime = runtime;
  }
  runtime;
  documents = /* @__PURE__ */ new Map();
  operations = /* @__PURE__ */ new Set();
  recoveries = /* @__PURE__ */ new Map();
  expiryTimer = null;
  writeTail = Promise.resolve();
  started = null;
  loaded = !1;
  discardOnLoad = !1;
  stopped = !1;
  send(context, message) {
    try {
      this.runtime.api.tabs.sendMessage(context.tabId, message, { frameId: context.frameId, documentId: context.documentId }).catch(() => {
      });
    } catch {
    }
  }
  persist() {
    if (!this.loaded || this.stopped) return Promise.resolve();
    let owners = [...this.documents.values()].map((record2) => ({
      tabId: record2.context.tabId,
      frameId: record2.context.frameId,
      documentId: record2.context.documentId,
      topDocumentId: record2.topDocumentId,
      cacheToken: record2.cacheToken,
      lastUsedAt: Math.floor(record2.lastUsedAt / 1e3) * 1e3
    })), next = this.writeTail.catch(() => {
    }).then(() => this.runtime.api.storage.session.set({ [VISUAL_OWNER_KEY]: { v: 1, owners } }));
    return this.writeTail = next, next.catch(() => {
    }), next;
  }
  /** Explicit policy changes await this before acknowledging success to privileged UI. */
  async flush() {
    this.started && await this.started, await this.writeTail;
  }
  /** Called once after normal document/scope hydration, before buffered events are released. */
  start() {
    return this.started ? this.started : (this.started = this.load(), this.started);
  }
  async load() {
    let hadRegistry = !1;
    try {
      let raw = (await this.runtime.api.storage.session.get(VISUAL_OWNER_KEY))[VISUAL_OWNER_KEY];
      if (hadRegistry = raw !== void 0, !this.discardOnLoad && raw && typeof raw == "object") {
        let value = raw, owners = value.owners;
        if (value.v === 1 && Array.isArray(owners) && owners.length <= MAX_VISUAL_DOCUMENTS)
          for (let candidate of owners) {
            if (!candidate || typeof candidate != "object") continue;
            let entry = candidate, tabId = entry.tabId, frameId = entry.frameId, id4 = entry.documentId, topDocumentId = entry.topDocumentId, cacheToken = entry.cacheToken, lastUsedAt = entry.lastUsedAt;
            if (Object.keys(entry).sort().join(",") !== "cacheToken,documentId,frameId,lastUsedAt,tabId,topDocumentId" || typeof tabId != "number" || !Number.isSafeInteger(tabId) || tabId < 0 || tabId > 2147483647 || typeof frameId != "number" || !Number.isSafeInteger(frameId) || frameId < 0 || frameId > 2147483647 || !documentId(id4) || !documentId(topDocumentId) || typeof cacheToken != "string" || !/^[a-f0-9]{32}$/.test(cacheToken) || typeof lastUsedAt != "number" || !Number.isSafeInteger(lastUsedAt) || lastUsedAt < 0 || lastUsedAt > this.runtime.now() || this.runtime.now() - lastUsedAt >= VISUAL_IDLE_MS) continue;
            let context = {
              tabId,
              frameId,
              documentId: id4,
              documentKey: tabId + ":" + frameId + ":" + id4,
              host: null,
              originPattern: null,
              documentLifecycle: "active",
              frameType: null
            }, browser = await this.authorize(context);
            !browser || browser.top.documentId !== topDocumentId || this.discardOnLoad || this.stopped || this.documents.set(context.documentKey, {
              context,
              topDocumentId,
              cacheToken,
              lastUsedAt,
              lastTouchAt: lastUsedAt,
              images: /* @__PURE__ */ new Map(),
              truncated: !1,
              needsRecovery: !0
            });
          }
      }
    } catch {
    }
    this.loaded = !0, this.stopped || (hadRegistry && await this.persist().catch(() => {
    }), this.armExpiry());
  }
  /** Worker disposal is not a user clear. Retained copies/metadata survive normal SW suspension. */
  stop() {
    this.stopped = !0;
    for (let operation of this.operations) operation.invalid = !0;
    this.expiryTimer !== null && clearTimeout(this.expiryTimer), this.expiryTimer = null, this.documents.clear();
  }
  invalidate(test4) {
    for (let operation of this.operations) test4(operation.context) && (operation.invalid = !0);
  }
  discard(key2) {
    this.invalidate((context) => context.documentKey === key2);
    let record2 = this.documents.get(key2);
    record2 && (this.send(record2.context, disabled()), this.documents.delete(key2), this.persist());
  }
  clear() {
    this.discardOnLoad = !0, this.invalidate(() => !0), this.expiryTimer !== null && clearTimeout(this.expiryTimer), this.expiryTimer = null;
    for (let key2 of this.documents.keys()) this.discard(key2);
    this.persist();
  }
  clearDocument(documentKey3) {
    this.discard(documentKey3);
  }
  prune() {
    let now = this.runtime.now();
    for (let [key2, record2] of this.documents) now - record2.lastUsedAt >= VISUAL_IDLE_MS && this.discard(key2);
  }
  armExpiry() {
    this.expiryTimer !== null && clearTimeout(this.expiryTimer), this.expiryTimer = null;
    let next = 1 / 0;
    for (let record2 of this.documents.values()) next = Math.min(next, record2.lastUsedAt + VISUAL_IDLE_MS);
    !this.stopped && Number.isFinite(next) && (this.expiryTimer = setTimeout(() => {
      this.expiryTimer = null, this.prune(), this.armExpiry();
    }, Math.max(1, next - this.runtime.now())));
  }
  onBrowserEvent(event) {
    if (event.type === "tab:removed" || event.type === "tab:replaced") {
      let tabId = event.type === "tab:removed" ? event.tabId : event.removedTabId;
      this.invalidate((context) => context.tabId === tabId);
      for (let [key2, record2] of this.documents) record2.context.tabId === tabId && this.discard(key2);
    }
    if (event.type === "navigation:committed" && active(event.documentLifecycle)) {
      this.invalidate((context) => context.tabId === event.tabId && (event.frameId === 0 || context.frameId === event.frameId));
      for (let [key2, record2] of this.documents)
        record2.context.tabId === event.tabId && (event.frameId === 0 ? record2.topDocumentId !== event.documentId : record2.context.frameId === event.frameId && record2.context.documentId !== event.documentId) && this.discard(key2);
    }
  }
  afterEvent(event) {
    if (event.type === "ui:clear") {
      this.clearDocument(event.documentKey);
      return;
    }
    if (event.type === "navigation:committed") {
      for (let operation of this.operations) this.runtime.state.metas.get(operation.context.documentKey)?.bound === !1 && (operation.invalid = !0);
      for (let key2 of this.documents.keys()) this.runtime.state.metas.get(key2)?.bound === !1 && this.discard(key2);
    }
    if ((event.type === "ui:pause" || event.type === "transport:stopped") && this.discard(event.documentKey), event.type === "scope:revoked" || event.type === "frames:retired" || event.type === "document:evict")
      for (let key2 of event.documentKeys) this.discard(key2);
    event.type === "scope:access" && !event.accessGranted && this.discard(event.documentKey);
  }
  async browserFrames(tabId) {
    let frames;
    try {
      frames = await this.runtime.api.webNavigation.getAllFrames({ tabId });
    } catch {
      return null;
    }
    if (!Array.isArray(frames) || frames.length > 1024) return null;
    let top = frames.find((frame) => frame.frameId === 0 && active(frame.documentLifecycle));
    return !top || typeof top.documentId != "string" || top.errorOccurred ? null : { top, frames };
  }
  frameOrigin(frame, frames) {
    let current = frame;
    for (let depth = 0; current && depth < 128; depth++) {
      let host2 = sanitizeHost(current.url), scheme = current.url.startsWith("https://") ? "https" : current.url.startsWith("http://") ? "http" : null;
      if (host2 && scheme) return { host: host2, scheme, pattern: scheme + "://" + host2 + "/*" };
      if (current.url !== "about:blank" && current.url !== "about:srcdoc") return null;
      let parentId = current.parentDocumentId;
      if (!parentId) return null;
      current = frames.find((candidate) => candidate.documentId === parentId && active(candidate.documentLifecycle));
    }
    return null;
  }
  permittedMeta(key2) {
    let meta = this.runtime.state.metas.get(key2);
    return !meta || meta.bound && !meta.paused && !meta.revoked;
  }
  async authorize(context, operation) {
    if (operation?.invalid || this.stopped || !this.permittedMeta(context.documentKey)) return null;
    let browser = await this.browserFrames(context.tabId), frame = browser?.frames.find((candidate) => candidate.frameId === context.frameId && candidate.documentId === context.documentId && active(candidate.documentLifecycle)), origin = browser && frame ? this.frameOrigin(frame, browser.frames) : null;
    if (!browser || !frame || frame.errorOccurred || !origin || context.originPattern !== null && (origin.pattern !== context.originPattern || origin.host !== context.host) || !await this.runtime.scope.isGranted(origin.pattern, context.tabId, context.documentId) || operation?.invalid || this.stopped || !this.permittedMeta(context.documentKey)) return null;
    let binding = [...this.runtime.state.bindings.values()].find((item) => item.tabId === context.tabId && item.frameId === context.frameId && active(item.documentLifecycle));
    return binding && binding.documentId !== context.documentId ? null : browser;
  }
  begin(context) {
    if (this.stopped || this.operations.size >= VISUAL_LIMITS.maxPending) return null;
    let operation = { context, invalid: !1 };
    return this.operations.add(operation), operation;
  }
  admit(context, topDocumentId) {
    this.prune();
    let existing = this.documents.get(context.documentKey);
    if (existing) return existing;
    if (this.documents.size >= MAX_VISUAL_DOCUMENTS) {
      let oldestKey, oldestAt = 1 / 0;
      for (let [key2, record3] of this.documents) record3.lastUsedAt < oldestAt && (oldestAt = record3.lastUsedAt, oldestKey = key2);
      oldestKey !== void 0 && this.discard(oldestKey);
    }
    let record2 = {
      context,
      topDocumentId,
      cacheToken: token2(),
      images: /* @__PURE__ */ new Map(),
      truncated: !1,
      needsRecovery: !1,
      lastUsedAt: this.runtime.now(),
      lastTouchAt: this.runtime.now()
    };
    return this.documents.set(context.documentKey, record2), this.armExpiry(), record2;
  }
  touch(record2, notify) {
    let now = this.runtime.now();
    record2.lastUsedAt = now, now - record2.lastTouchAt >= TOUCH_MS && (record2.lastTouchAt = now, notify && this.send(record2.context, { schemaVersion: 1, type: "visual-cache-touch", cacheToken: record2.cacheToken }), this.persist()), this.armExpiry();
  }
  state(documentKey3, enabled2 = !0) {
    this.prune();
    let record2 = this.documents.get(documentKey3);
    return {
      schemaVersion: 1,
      type: "visual-state",
      documentKey: documentKey3,
      enabled: enabled2,
      remainingMs: enabled2 ? VISUAL_LIMITS.leaseMs : 0,
      images: record2 ? [...record2.images.values()].map((image) => ({ ...image })) : [],
      ...record2?.truncated ? { truncated: !0 } : {}
    };
  }
  recover(record2) {
    let old = this.recoveries.get(record2.context.documentKey);
    if (old) return old;
    let recovery = (async () => {
      let timer;
      try {
        let raw = await Promise.race([
          this.runtime.api.tabs.sendMessage(
            record2.context.tabId,
            { schemaVersion: 1, type: "visual-cache-read", cacheToken: record2.cacheToken },
            { frameId: record2.context.frameId, documentId: record2.context.documentId }
          ),
          new Promise((resolve) => {
            timer = setTimeout(() => resolve(null), VISUAL_READ_TIMEOUT_MS);
          })
        ]);
        if (this.documents.get(record2.context.documentKey) !== record2 || this.stopped || this.runtime.now() - record2.lastUsedAt >= VISUAL_IDLE_MS) return !1;
        let checked = validateVisualCacheState(raw);
        if (!checked.ok || checked.value.cacheToken !== record2.cacheToken) return !1;
        let browser = await this.authorize(record2.context);
        if (!browser || browser.top.documentId !== record2.topDocumentId || this.documents.get(record2.context.documentKey) !== record2) return !1;
        for (let image of checked.value.images) retainVisualImage(record2.images, image) || (record2.truncated = !0);
        return checked.value.truncated && (record2.truncated = !0), record2.needsRecovery = !1, this.touch(record2, !1), !0;
      } catch {
        return !1;
      } finally {
        timer !== void 0 && clearTimeout(timer);
      }
    })();
    return this.recoveries.set(record2.context.documentKey, recovery), recovery.finally(() => {
      this.recoveries.get(record2.context.documentKey) === recovery && this.recoveries.delete(record2.context.documentKey);
    }), recovery;
  }
  async ui(request) {
    await this.runtime.whenReady(), await this.start();
    let report2 = this.runtime.state.reports.get(request.documentKey);
    if (!report2) return error("not-found");
    if (report2.tabId !== request.tabId) return error("document-mismatch");
    if (request.type === "ui-visual-set" && report2.revision !== request.reportRevision) return error("stale-revision");
    if (request.type === "ui-visual-set" && !request.enabled)
      return this.discard(request.documentKey), await this.flush(), this.state(request.documentKey, !1);
    let context = {
      tabId: request.tabId,
      frameId: report2.frameId,
      documentId: report2.documentId,
      documentKey: request.documentKey,
      host: null,
      originPattern: null,
      documentLifecycle: "active",
      frameType: null
    }, operation = this.begin(context);
    if (!operation) return error("no-access");
    try {
      let browser = await this.authorize(context, operation);
      if (!browser) return error("no-access");
      let binding = [...this.runtime.state.bindings.values()].find((item) => item.tabId === request.tabId && item.frameId === report2.frameId && active(item.documentLifecycle));
      if (!binding || binding.documentId !== report2.documentId) return error("no-access");
      if (request.type === "ui-visual-set" && this.runtime.state.reports.get(request.documentKey) !== report2) return error("stale-revision");
      this.prune();
      let record2 = this.documents.get(request.documentKey);
      if (record2) {
        if (record2.topDocumentId !== browser.top.documentId)
          return this.discard(request.documentKey), await this.flush(), error("no-access");
        if (record2.needsRecovery && !await this.recover(record2)) return operation.invalid ? error("no-access") : this.state(request.documentKey);
        if (operation.invalid || this.documents.get(request.documentKey) !== record2 || !this.permittedMeta(request.documentKey)) return error("no-access");
        this.touch(record2, !0);
      } else request.type === "ui-visual-set" && this.send(context, control());
      return this.state(request.documentKey);
    } finally {
      this.operations.delete(operation);
    }
  }
  async page(message, context) {
    if (!this.runtime.scope.dataConsentLoaded) return error("no-access");
    if (!this.runtime.scope.hasDataConsent) return Object.getOwnPropertyDescriptor(message, "type")?.value === "visual-ready" ? disabled() : rejected();
    let request = validateVisualPageRequest(message);
    if (!request.ok) return error("invalid-request");
    let reject = () => request.value.type === "visual-ready" ? disabled() : rejected();
    if (!active(context.documentLifecycle) || !context.originPattern || !this.permittedMeta(context.documentKey)) return reject();
    let operation = this.begin(context);
    if (!operation) return reject();
    try {
      if (!await this.runtime.whenPageReady(context.documentKey)) return reject();
      await this.start();
      let browser = await this.authorize(context, operation);
      if (!browser) return reject();
      if (request.value.type === "visual-ready") return control();
      let record2 = this.admit(context, browser.top.documentId), retained = request.value.type === "visual-frame" && retainVisualImage(record2.images, request.value.image);
      retained || (record2.truncated = !0), this.touch(record2, !1);
      try {
        await this.persist();
      } catch {
        return this.discard(context.documentKey), rejected();
      }
      return operation.invalid || this.documents.get(context.documentKey) !== record2 || !this.permittedMeta(context.documentKey) ? rejected() : {
        schemaVersion: 1,
        type: "visual-frame-ack",
        accepted: !0,
        cacheToken: record2.cacheToken,
        remainingMs: VISUAL_IDLE_MS,
        ...retained ? {} : { retained: !1 },
        ...record2.truncated ? { truncated: !0 } : {}
      };
    } finally {
      this.operations.delete(operation);
    }
  }
  route(message, sender) {
    let type = typeof message == "object" && message !== null ? Object.getOwnPropertyDescriptor(message, "type")?.value : void 0;
    if (type !== "ui-visual-get" && type !== "ui-visual-set" && type !== "visual-ready" && type !== "visual-frame" && type !== "visual-limited") return null;
    if (verifyUiSender(sender, this.runtime.api.runtime.id)) {
      let checked = validateVisualUiRequest(message);
      return checked.ok ? this.ui(checked.value) : Promise.resolve(error("invalid-request"));
    }
    let read4 = readPageSender(sender, this.runtime.api.runtime.id);
    return !read4.ok || type !== "visual-ready" && type !== "visual-frame" && type !== "visual-limited" ? Promise.resolve(error("unauthorized-sender")) : this.page(message, read4.context);
  }
};

// packages/background/src/rtc-details.ts
var RTC_STORAGE_KEY = "rtc-details-v1", RTC_MAX_DOCUMENTS = RTC_LIMITS.maxDocuments, RTC_MAX_GRANTS = 128, RTC_IDLE_MS = RTC_LIMITS.idleMs, RTC_MAX_PENDING = 8, active2 = (value) => value == null || value === "active", id3 = (value) => typeof value == "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value), token3 = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) => value.toString(16).padStart(2, "0")).join(""), denied = () => ({ schemaVersion: 1, type: "rtc-control", enabled: !1, token: null, reset: !0 }), enabled = (grant) => ({ schemaVersion: 1, type: "rtc-control", enabled: !0, token: grant.token, reset: !1 }), ack = (accepted, reset = !1) => ({ schemaVersion: 1, type: "rtc-ack", accepted, reset }), error2 = (code2) => ({ schemaVersion: 1, type: "error", code: code2 }), clone = (snapshot) => ({ ...snapshot, connections: snapshot.connections.map((connection) => ({ ...connection, servers: connection.servers.map((server) => ({ ...server })) })) }), RtcDetailsManager = class {
  constructor(runtime) {
    this.runtime = runtime;
  }
  runtime;
  grants = /* @__PURE__ */ new Map();
  operations = /* @__PURE__ */ new Set();
  writingDocuments = /* @__PURE__ */ new Set();
  rates = /* @__PURE__ */ new Map();
  rateGlobal = { at: 0, count: 0 };
  timer = null;
  started = null;
  loaded = !1;
  stopped = !1;
  discardOnLoad = !1;
  dirty = !1;
  writer = null;
  /** ADR-024: expose reviewed identities only, from an accepted, live, authorized snapshot. */
  vendorEvidence(documentKey3) {
    let empty = () => ({ observations: [], observedAt: null }), grant = this.grants.get(documentKey3), meta = this.runtime.state.metas.get(documentKey3);
    if (!this.loaded || this.stopped || !grant?.snapshot || grant.acceptedRevision !== grant.snapshot.revision || this.runtime.now() - grant.lastUsedAt >= RTC_IDLE_MS || !meta?.bound || meta.paused || meta.revoked || meta.accessGranted === !1 || !this.runtime.scope.accessReady || this.runtime.scope.getScopeMode() === "off") return empty();
    let binding = [...this.runtime.state.bindings.values()].find((item) => item.documentKey === documentKey3 && active2(item.documentLifecycle)), top = this.runtime.state.tabs.get(grant.context.tabId)?.activeTopDocumentKey;
    if (!binding || top !== `${grant.context.tabId}:0:${grant.topDocumentId}`) return empty();
    let observations = [], seen = /* @__PURE__ */ new Set();
    for (let connection of grant.snapshot.connections) for (let server of connection.servers)
      if (!(!server.configured && !server.candidate && !server.error))
        for (let match of matchVendorRtcServer(server.host, server.scheme, this.runtime.now())) {
          let occurrenceRuleId = match.ruleId === "threatmetrix-aa-turn-v1-stale" ? "threatmetrix-aa-turn-v1" : match.ruleId;
          let occurrenceId = `${occurrenceRuleId}:${connection.id}:${connection.configurationChanges}`;
          seen.has(occurrenceId) || (seen.add(occurrenceId), observations.push({ occurrenceId, vendor: {
            vendorId: match.vendorId,
            vendorConfidence: match.vendorConfidence,
            ruleIds: [match.ruleId],
            evidenceSource: match.evidenceSource,
            integrity: match.integrity
          } }));
        }
    return { observations, observedAt: observations.length ? grant.lastUsedAt : null };
  }
  /** Structural upper estimate includes all eight bounded snapshots and their storage identities. */
  estimatedBytes() {
    let bytes = 128;
    for (let grant of this.grants.values()) grant.snapshot && (bytes += grant.bytes + 1024);
    return bytes;
  }
  sendReset(context) {
    try {
      this.runtime.api.tabs.sendMessage(
        context.tabId,
        { schemaVersion: 1, type: "rtc-reset" },
        { frameId: context.frameId, documentId: context.documentId }
      ).catch(() => {
      });
    } catch {
    }
  }
  /** Coalesce writes: at most one storage request plus one current bounded snapshot, never a payload queue. */
  persist() {
    if (!this.loaded || this.stopped) return Promise.resolve();
    if (this.dirty = !0, this.writer) return this.writer;
    let next = (async () => {
      for (; this.dirty && !this.stopped; ) {
        this.dirty = !1;
        let documents = [...this.grants.values()].filter((grant) => grant.snapshot !== null).map((grant) => ({
          tabId: grant.context.tabId,
          frameId: grant.context.frameId,
          documentId: grant.context.documentId,
          topDocumentId: grant.topDocumentId,
          token: grant.token,
          lastUsedAt: Math.floor(grant.lastUsedAt / 1e3) * 1e3,
          snapshot: clone(grant.snapshot)
        }));
        await this.runtime.api.storage.session.set({ [RTC_STORAGE_KEY]: { v: 1, documents } });
      }
    })();
    return this.writer = next, next.then(() => {
      this.writer === next && (this.writer = null);
    }, () => {
      this.writer === next && (this.writer = null), this.dirty = !0;
    }), next;
  }
  async flush() {
    this.started && await this.started, this.dirty ? await this.persist() : this.writer && await this.writer;
  }
  start() {
    return this.started || (this.started = this.load()), this.started;
  }
  async load() {
    let hadData = !1;
    try {
      let raw = (await this.runtime.api.storage.session.get(RTC_STORAGE_KEY))[RTC_STORAGE_KEY];
      hadData = raw !== void 0;
      let value = raw;
      if (!this.discardOnLoad && value?.v === 1 && Array.isArray(value.documents) && value.documents.length <= RTC_MAX_DOCUMENTS)
        for (let candidate of value.documents) {
          if (!candidate || typeof candidate != "object" || Object.keys(candidate).sort().join(",") !== "documentId,frameId,lastUsedAt,snapshot,tabId,token,topDocumentId") continue;
          let entry = candidate, tabId = entry.tabId, frameId = entry.frameId, documentId2 = entry.documentId, topDocumentId = entry.topDocumentId, savedToken = entry.token, lastUsedAt = entry.lastUsedAt;
          if (typeof tabId != "number" || !Number.isSafeInteger(tabId) || tabId < 0 || tabId > 2147483647 || typeof frameId != "number" || !Number.isSafeInteger(frameId) || frameId < 0 || frameId > 2147483647 || !id3(documentId2) || !id3(topDocumentId) || typeof savedToken != "string" || !/^[a-f0-9]{32}$/.test(savedToken) || typeof lastUsedAt != "number" || !Number.isSafeInteger(lastUsedAt) || lastUsedAt < 0 || lastUsedAt % 1e3 !== 0 || lastUsedAt > this.runtime.now() || this.runtime.now() - lastUsedAt >= RTC_IDLE_MS) continue;
          let checked = validateRtcSnapshot(entry.snapshot);
          if (!checked.ok || checked.value.total === 0) continue;
          let context = { tabId, frameId, documentId: documentId2, documentKey: tabId + ":" + frameId + ":" + documentId2 }, operation = this.begin(context, !0);
          if (operation)
            try {
              let browser = await this.authorize(context, operation);
              if (!browser || browser.top.documentId !== topDocumentId || this.discardOnLoad) continue;
              this.grants.set(context.documentKey, {
                context,
                topDocumentId,
                ancestors: operation.ancestors,
                token: savedToken,
                lastUsedAt,
                snapshot: checked.value,
                acceptedRevision: checked.value.revision,
                bytes: this.snapshotBytes(checked.value)
              });
            } finally {
              this.operations.delete(operation);
            }
        }
    } catch {
    }
    this.loaded = !0, this.stopped || (hadData && await this.persist().catch(() => {
    }), this.armExpiry());
  }
  stop() {
    this.stopped = !0;
    for (let operation of this.operations) operation.invalid = !0;
    this.timer !== null && clearTimeout(this.timer), this.timer = null, this.grants.clear();
  }
  begin(context, hydration = !1) {
    let maximum = this.loaded || hydration ? RTC_MAX_PENDING : RTC_MAX_PENDING - 1;
    if (this.stopped || this.operations.size >= maximum) return null;
    let operation = { context, ancestors: [], invalid: !1 };
    return this.operations.add(operation), operation;
  }
  invalidate(test4) {
    for (let operation of this.operations) test4(operation.context) && (operation.invalid = !0);
  }
  discard(key2) {
    this.invalidate((context) => context.documentKey === key2);
    let grant = this.grants.get(key2);
    grant && (this.grants.delete(key2), this.sendReset(grant.context), grant.snapshot && (this.runtime.dispatch({ type: "vendor:updated", documentKey: key2, at: this.runtime.now() }), this.persist().catch(() => {
    })));
  }
  clearDocument(key2) {
    this.discard(key2);
  }
  clear() {
    this.discardOnLoad = !0, this.invalidate(() => !0);
    for (let key2 of this.grants.keys()) this.discard(key2);
    this.persist().catch(() => {
    }), this.armExpiry();
  }
  /** Budget pressure drops this optional detail channel before degrading ordinary observation counters. */
  async dropForBudget() {
    this.clear(), await this.flush();
  }
  prune() {
    let now = this.runtime.now();
    for (let [key2, grant] of this.grants) now - grant.lastUsedAt >= RTC_IDLE_MS && this.discard(key2);
  }
  armExpiry() {
    this.timer !== null && clearTimeout(this.timer), this.timer = null;
    let next = 1 / 0;
    for (let grant of this.grants.values()) next = Math.min(next, grant.lastUsedAt + RTC_IDLE_MS);
    !this.stopped && Number.isFinite(next) && (this.timer = setTimeout(() => {
      this.timer = null, this.prune(), this.armExpiry();
    }, Math.max(1, next - this.runtime.now())));
  }
  onBrowserEvent(event) {
    if (event.type === "tab:removed" || event.type === "tab:replaced") {
      let tabId = event.type === "tab:removed" ? event.tabId : event.removedTabId;
      this.invalidate((context) => context.tabId === tabId);
      for (let [key2, grant] of this.grants) grant.context.tabId === tabId && this.discard(key2);
    }
    if (event.type === "navigation:committed" && active2(event.documentLifecycle)) {
      this.invalidate((context) => context.tabId === event.tabId && (event.frameId === 0 || context.frameId === event.frameId));
      for (let operation of this.operations) operation.context.tabId === event.tabId && operation.ancestors.some((ancestor) => ancestor.frameId === event.frameId && ancestor.documentId !== event.documentId) && (operation.invalid = !0);
      for (let [key2, grant] of this.grants) grant.context.tabId === event.tabId && (event.frameId === 0 ? grant.topDocumentId !== event.documentId : grant.context.frameId === event.frameId && grant.context.documentId !== event.documentId || grant.ancestors.some((ancestor) => ancestor.frameId === event.frameId && ancestor.documentId !== event.documentId)) && this.discard(key2);
    }
  }
  afterEvent(event) {
    if ((event.type === "ui:clear" || event.type === "ui:pause" || event.type === "transport:stopped") && this.discard(event.documentKey), event.type === "scope:revoked" || event.type === "frames:retired" || event.type === "document:evict") for (let key2 of event.documentKeys) this.discard(key2);
    if (event.type === "scope:access" && !event.accessGranted && this.discard(event.documentKey), event.type === "navigation:committed") {
      for (let operation of this.operations) this.runtime.state.metas.get(operation.context.documentKey)?.bound === !1 && (operation.invalid = !0);
      for (let key2 of this.grants.keys()) this.runtime.state.metas.get(key2)?.bound === !1 && this.discard(key2);
    }
  }
  permitted(key2) {
    let meta = this.runtime.state.metas.get(key2);
    return !meta || meta.bound && !meta.paused && !meta.revoked;
  }
  async authorize(context, operation, sender) {
    if (operation.invalid || this.stopped || !this.permitted(context.documentKey)) return null;
    let frames;
    try {
      frames = await this.runtime.api.webNavigation.getAllFrames({ tabId: context.tabId });
    } catch {
      return null;
    }
    if (!Array.isArray(frames) || frames.length > 1024) return null;
    let top = frames.find((frame2) => frame2.frameId === 0 && active2(frame2.documentLifecycle)), frame = frames.find((item) => item.frameId === context.frameId && item.documentId === context.documentId && active2(item.documentLifecycle));
    if (!top || !id3(top.documentId) || top.errorOccurred || !frame || frame.errorOccurred) return null;
    let ancestors = [], parentFrame = frame;
    for (let depth = 0; depth < 128 && parentFrame.frameId !== 0; depth++) {
      let parent = frames.find((item) => active2(item.documentLifecycle) && (parentFrame.parentDocumentId ? item.documentId === parentFrame.parentDocumentId : item.frameId === parentFrame.parentFrameId));
      if (!parent || !id3(parent.documentId) || parent === parentFrame) break;
      ancestors.push({ frameId: parent.frameId, documentId: parent.documentId }), parentFrame = parent;
    }
    operation.ancestors = ancestors;
    let origin = frame;
    for (let depth = 0; depth < 128; depth++) {
      let host2 = sanitizeHost(origin.url), scheme = origin.url.startsWith("https://") ? "https" : origin.url.startsWith("http://") ? "http" : null;
      if (host2 && scheme) {
        let pattern = scheme + "://" + host2 + "/*";
        if (sender && (sender.originPattern !== pattern || sender.host !== host2) || !await this.runtime.scope.isGranted(pattern, context.tabId, context.documentId) || operation.invalid || this.stopped || !this.permitted(context.documentKey)) return null;
        let binding = [...this.runtime.state.bindings.values()].find((item) => item.tabId === context.tabId && item.frameId === context.frameId && active2(item.documentLifecycle));
        return binding && binding.documentId !== context.documentId ? null : { top, frames };
      }
      if (origin.url !== "about:blank" && origin.url !== "about:srcdoc" || !origin.parentDocumentId) return null;
      let parent = frames.find((item) => item.documentId === origin.parentDocumentId && active2(item.documentLifecycle));
      if (!parent) return null;
      origin = parent;
    }
    return null;
  }
  snapshotBytes(snapshot) {
    return new TextEncoder().encode(JSON.stringify(snapshot)).byteLength;
  }
  consume(key2) {
    let now = this.runtime.now();
    if ((now - this.rateGlobal.at >= 1e3 || now < this.rateGlobal.at) && (this.rateGlobal = { at: now, count: 0 }), this.rateGlobal.count >= 64) return !1;
    let bucket = this.rates.get(key2);
    return (!bucket || now - bucket.at >= 1e3 || now < bucket.at) && (!bucket && this.rates.size >= RTC_MAX_GRANTS && this.rates.delete(this.rates.keys().next().value), bucket = { at: now, count: 0 }, this.rates.set(key2, bucket)), bucket.count >= 8 ? !1 : (bucket.count++, this.rateGlobal.count++, !0);
  }
  admit(context, topDocumentId, ancestors) {
    this.prune();
    let existing = this.grants.get(context.documentKey);
    if (existing) return existing;
    if (this.grants.size >= RTC_MAX_GRANTS) {
      let oldest;
      for (let grant2 of this.grants.values()) !grant2.snapshot && (!oldest || grant2.lastUsedAt < oldest.lastUsedAt) && (oldest = grant2);
      oldest && this.discard(oldest.context.documentKey);
    }
    let grant = { context, topDocumentId, ancestors, token: token3(), lastUsedAt: this.runtime.now(), snapshot: null, acceptedRevision: 0, bytes: 0 };
    return this.grants.set(context.documentKey, grant), this.armExpiry(), grant;
  }
  admitSnapshot(grant) {
    if (grant.snapshot) return;
    let records = [...this.grants.values()].filter((item) => item.snapshot !== null);
    if (records.length < RTC_MAX_DOCUMENTS) return;
    let oldest = records[0];
    for (let item of records) item.lastUsedAt < oldest.lastUsedAt && (oldest = item);
    this.discard(oldest.context.documentKey);
  }
  async page(message, context) {
    if (!this.runtime.scope.dataConsentLoaded) return error2("no-access");
    if (!this.runtime.scope.hasDataConsent) return Object.getOwnPropertyDescriptor(message, "type")?.value === "rtc-ready" ? denied() : ack(!1, !0);
    if (!this.consume(context.documentKey)) return ack(!1);
    let checked = validateRtcPageRequest(message);
    if (!checked.ok) return error2("invalid-request");
    let reject = () => checked.value.type === "rtc-ready" ? denied() : ack(!1, !0);
    if (!active2(context.documentLifecycle) || !context.originPattern || !this.permitted(context.documentKey)) return reject();
    if (this.writingDocuments.has(context.documentKey)) return ack(!1);
    let operation = this.begin(context);
    if (!operation) return ack(!1);
    this.writingDocuments.add(context.documentKey);
    try {
      if (!await this.runtime.whenPageReady(context.documentKey)) return reject();
      await this.start();
      let browser = await this.authorize(context, operation, context);
      if (!browser) return reject();
      this.prune();
      let request = checked.value;
      if (request.type === "rtc-ready") return enabled(this.admit(context, browser.top.documentId, operation.ancestors));
      let grant = this.grants.get(context.documentKey);
      if (!grant || grant.token !== request.token || grant.topDocumentId !== browser.top.documentId) return ack(!1, !0);
      if (grant.snapshot && request.snapshot.revision <= grant.snapshot.revision || request.snapshot.total === 0) return ack(!0);
      let bytes = this.snapshotBytes(request.snapshot);
      if (bytes > RTC_LIMITS.maxBytes) return error2("invalid-request");
      this.admitSnapshot(grant), grant.snapshot = request.snapshot, grant.bytes = bytes, grant.lastUsedAt = this.runtime.now(), this.armExpiry();
      try {
        await this.persist();
      } catch {
        return this.discard(context.documentKey), error2("invalid-request");
      }
      if (operation.invalid || this.grants.get(context.documentKey) !== grant || !this.permitted(context.documentKey)) return ack(!1, !0);
      let current = await this.authorize(context, operation, context);
      return !current || current.top.documentId !== grant.topDocumentId || this.grants.get(context.documentKey) !== grant ? (this.grants.get(context.documentKey) === grant && this.discard(context.documentKey), ack(!1, !0)) : (grant.acceptedRevision = request.snapshot.revision, this.runtime.dispatch({ type: "vendor:updated", documentKey: context.documentKey, at: this.runtime.now() }), this.runtime.enforceTotalBudget(), ack(!0));
    } finally {
      this.writingDocuments.delete(context.documentKey), this.operations.delete(operation);
    }
  }
  async ui(request) {
    await this.runtime.whenReady(), await this.start();
    let report2 = this.runtime.state.reports.get(request.documentKey);
    if (!report2) return error2("not-found");
    if (report2.tabId !== request.tabId) return error2("document-mismatch");
    let context = { tabId: report2.tabId, frameId: report2.frameId, documentId: report2.documentId, documentKey: request.documentKey }, operation = this.begin(context);
    if (!operation) return error2("no-access");
    try {
      let browser = await this.authorize(context, operation);
      if (!browser || ![...this.runtime.state.bindings.values()].find((item) => item.documentKey === context.documentKey && active2(item.documentLifecycle))) return error2("no-access");
      this.prune();
      let grant = this.grants.get(context.documentKey);
      return grant && grant.topDocumentId !== browser.top.documentId ? (this.discard(context.documentKey), error2("no-access")) : { schemaVersion: 1, type: "rtc-state", documentKey: context.documentKey, snapshot: grant?.snapshot ? clone(grant.snapshot) : null };
    } finally {
      this.operations.delete(operation);
    }
  }
  route(message, sender) {
    let type = typeof message == "object" && message !== null ? Object.getOwnPropertyDescriptor(message, "type")?.value : void 0;
    if (type !== "rtc-ready" && type !== "rtc-snapshot" && type !== "ui-rtc-get") return null;
    if (verifyUiSender(sender, this.runtime.api.runtime.id)) {
      let checked = validateRtcUiRequest(message);
      return checked.ok ? this.ui(checked.value) : Promise.resolve(error2("invalid-request"));
    }
    let read4 = readPageSender(sender, this.runtime.api.runtime.id);
    return !read4.ok || type === "ui-rtc-get" ? Promise.resolve(error2("unauthorized-sender")) : this.page(message, read4.context);
  }
};

// apps/extension/_locales/ru/messages.json
var badge_tooltip = { message: "Наблюдаемых техник во вкладке и её фреймах: $N$", placeholders: { n: { content: "$1" } } };

// apps/extension/_locales/en/messages.json
var badge_tooltip2 = { message: "Observed techniques in this tab and its frames: $N$", placeholders: { n: { content: "$1" } } };

// apps/extension/_locales/zh_CN/messages.json
var badge_tooltip3 = { message: "此标签页及其框架中观察到的技术数：$N$", placeholders: { n: { content: "$1" } } };

// apps/extension/_locales/vi/messages.json
var badge_tooltip4 = { message: "Số kỹ thuật được ghi nhận trong thẻ này và các khung: $N$", placeholders: { n: { content: "$1" } } };

// apps/extension/_locales/es/messages.json
var badge_tooltip5 = { message: "Técnicas observadas en esta pestaña y sus marcos: $N$", placeholders: { n: { content: "$1" } } };

// apps/extension/_locales/ar/messages.json
var badge_tooltip6 = { message: "التقنيات المرصودة في علامة التبويب هذه وإطاراتها: $N$", placeholders: { n: { content: "$1" } } };

// apps/extension/_locales/uk/messages.json
var badge_tooltip7 = { message: "Спостережені техніки в цій вкладці та її фреймах: $N$", placeholders: { n: { content: "$1" } } };

// apps/extension/_locales/fr/messages.json
var badge_tooltip8 = { message: "Techniques observées dans cet onglet et ses cadres : $N$", placeholders: { n: { content: "$1" } } };

// apps/extension/_locales/pt_BR/messages.json
var badge_tooltip9 = { message: "Técnicas observadas nesta aba e em seus frames: $N$", placeholders: { n: { content: "$1" } } };

// apps/extension/_locales/hi/messages.json
var badge_tooltip10 = { message: "इस टैब और उसके फ़्रेम में देखी गई तकनीकें: $N$", placeholders: { n: { content: "$1" } } };

// apps/extension/_locales/ur/messages.json
var badge_tooltip11 = { message: "اس ٹیب اور اس کے فریم میں دیکھی گئی تکنیکیں: $N$", placeholders: { n: { content: "$1" } } };

// apps/extension/_locales/ja/messages.json
var badge_tooltip12 = { message: "このタブとフレームで観測された手法：$N$", placeholders: { n: { content: "$1" } } };

// packages/background/src/badge-label.ts
var BADGE_LANGUAGE_KEY = "ui-language-v1", labels = {"ru":{"message":"Наблюдаемых техник во вкладке и её фреймах: $N$","placeholders":{"n":{"content":"$1"}}},"en":{"message":"Observed techniques in this tab and its frames: $N$","placeholders":{"n":{"content":"$1"}}},"zh_CN":{"message":"此标签页及其框架中观察到的技术数：$N$","placeholders":{"n":{"content":"$1"}}},"vi":{"message":"Số kỹ thuật được ghi nhận trong thẻ này và các khung: $N$","placeholders":{"n":{"content":"$1"}}},"es":{"message":"Técnicas observadas en esta pestaña y sus marcos: $N$","placeholders":{"n":{"content":"$1"}}},"ar":{"message":"التقنيات المرصودة في علامة التبويب هذه وإطاراتها: $N$","placeholders":{"n":{"content":"$1"}}},"uk":{"message":"Спостережені техніки в цій вкладці та її фреймах: $N$","placeholders":{"n":{"content":"$1"}}},"fr":{"message":"Techniques observées dans cet onglet et ses cadres : $N$","placeholders":{"n":{"content":"$1"}}},"pt_BR":{"message":"Técnicas observadas nesta aba e em seus frames: $N$","placeholders":{"n":{"content":"$1"}}},"hi":{"message":"इस टैब और उसके फ़्रेम में देखी गई तकनीकें: $N$","placeholders":{"n":{"content":"$1"}}},"ur":{"message":"اس ٹیب اور اس کے فریم میں دیکھی گئی تکنیکیں: $N$","placeholders":{"n":{"content":"$1"}}},"ja":{"message":"このタブとフレームで観測された手法：$N$","placeholders":{"n":{"content":"$1"}}},"de":{"message":"Beobachtete Techniken in diesem Tab und seinen Frames: $N$","placeholders":{"n":{"content":"$1"}}},"pl":{"message":"Zaobserwowane techniki w tej karcie i jej ramkach: $N$","placeholders":{"n":{"content":"$1"}}},"id":{"message":"Teknik yang diamati di tab ini dan bingkainya: $N$","placeholders":{"n":{"content":"$1"}}},"mr":{"message":"या टॅब व फ्रेममध्ये पाहिलेल्या तंत्रपद्धती: $N$","placeholders":{"n":{"content":"$1"}}},"te":{"message":"ఈ ట్యాబ్, దాని ఫ్రేమ్‌లలో గమనించిన పద్ధతులు: $N$","placeholders":{"n":{"content":"$1"}}},"ko":{"message":"이 탭과 프레임에서 관찰한 기술: $N$","placeholders":{"n":{"content":"$1"}}},"ta":{"message":"இந்தத் தாவல் மற்றும் ஃப்ரேம்களில் கண்ட நுட்பங்கள்: $N$","placeholders":{"n":{"content":"$1"}}},"yue":{"message":"呢个分页同佢嘅框架入面观察到嘅技术数：$N$","placeholders":{"n":{"content":"$1"}}},"wuu":{"message":"迭个标签页搭伊个框架里向观察到个技术数：$N$","placeholders":{"n":{"content":"$1"}}}};
function badgeLanguage(value) {
  return typeof value == "string" && Object.hasOwn(labels, value) ? value : null;
}
function badgeBrowserLanguage(value) {
  let base = value.toLowerCase().replaceAll("_", "-").split("-")[0];
  return base === "zh" || base === "cmn" ? "zh_CN" : base === "pt" ? "pt_BR" : badgeLanguage(base) ?? "en";
}
function badgeLabel(language, count3) {
  return language === null ? null : labels[language]?.message.replace(/\$N\$/g, String(count3)) ?? null;
}

// packages/background/src/badge.ts
// ADR-042/045: toolbar follows the two master controls; observation OFF takes priority.
function toolbarAppearance(observing, blocking) {
  let mode = !observing ? "off" : blocking ? "blocking" : "observing";
  let prefix = mode === "off" ? "gray-" : mode === "blocking" ? "green-" : "";
  return { mode, path: Object.fromEntries([16, 32, 48, 128].map(size => [size, "icons/" + prefix + size + ".png"])),
    badge: mode === "blocking" ? "ON" : "", color: mode === "blocking" ? "#168451" : mode === "off" ? "#8D929C" : "#DC2626" };
}
var COUNTED_IDS = new Set(TECHNIQUE_IDS.filter((id4) => id4 !== "DET-067" && id4 !== "DET-068")), BADGE_UPDATE_MS = 250, BADGE_BACKGROUND_COLOR = "#DC2626", BADGE_TEXT_COLOR = "#FFFFFF", MAX_ACTION_OPERATIONS = 4;
function active3(binding) {
  return binding.documentLifecycle === null || binding.documentLifecycle === "active";
}
function countTabTechniques(state, tabId, hasAccess) {
  let topKey = state.tabs.get(tabId)?.activeTopDocumentKey;
  if (!topKey || !hasAccess(topKey)) return 0;
  let bindings = /* @__PURE__ */ new Map();
  for (let b of state.bindings.values())
    b.tabId === tabId && active3(b) && bindings.set(b.documentId, b);
  let top = [...bindings.values()].find((b) => b.documentKey === topKey && b.frameId === 0);
  if (!top || top.accessGranted === !1) return 0;
  let techniques = /* @__PURE__ */ new Set();
  for (let binding of bindings.values()) {
    let cursor = binding, seen = /* @__PURE__ */ new Set();
    for (; cursor.documentKey !== topKey && seen.size < MAX_BINDINGS_PER_TAB; ) {
      if (seen.has(cursor.documentId) || cursor.parentDocumentId === null) {
        cursor = void 0;
        break;
      }
      if (seen.add(cursor.documentId), cursor = bindings.get(cursor.parentDocumentId), !cursor) break;
    }
    if (!cursor || cursor.documentKey !== topKey) continue;
    let meta = state.metas.get(binding.documentKey);
    if (!meta?.bound || meta.revoked || meta.accessGranted === !1 || binding.accessGranted === !1 || !hasAccess(binding.documentKey)) continue;
    let report2 = state.reports.get(binding.documentKey);
    if (!(!report2 || report2.tabId !== tabId)) {
      for (let counter of report2.counters)
        counter.count > 0 && COUNTED_IDS.has(counter.techniqueId) && techniques.add(counter.techniqueId);
      for (let counter of meta.networkCounters ?? [])
        counter.count > 0 && COUNTED_IDS.has(counter.techniqueId) && techniques.add(counter.techniqueId);
    }
  }
  return techniques.size;
}
var BadgeManager = class {
  constructor(api, state, hasAccess, controls = () => ({ observing: !0, blocking: !1 })) {
    this.api = api;
    this.state = state;
    this.hasAccess = hasAccess;
    this.controls = controls;
  }
  api;
  state;
  hasAccess;
  controls;
  work = /* @__PURE__ */ new Map();
  displayed = /* @__PURE__ */ new Map();
  timer = null;
  // ADR-047 protect badge fields start
  /** Assigned by background.js (B8): firewall prompts of the module «Защита» in a tab ({ text, color, title }) or null. */
  protect = () => null;
  /** Tabs whose badge colour and title the module set: tabId -> "fw" or the restored "<colour>|<title>". */
  protectTabs = /* @__PURE__ */ new Map();
  // ADR-047 protect badge fields end
  running = 0;
  started = !1;
  stopped = !1;
  language = null;
  languageRevision = 0;
  onLanguageChanged = (changes, area) => {
    if (this.stopped || area !== "local" || !(BADGE_LANGUAGE_KEY in changes)) return;
    let value = changes[BADGE_LANGUAGE_KEY]?.newValue;
    this.languageRevision++, this.updateLanguage(badgeLanguage(value));
  };
  start() {
    if (this.started || this.stopped || !this.api.action) return;
    this.started = !0, this.api.storage.onChanged?.addListener(this.onLanguageChanged);
    let languageRevision = this.languageRevision;
    this.api.storage.local.get(BADGE_LANGUAGE_KEY).then((data) => {
      !this.stopped && this.languageRevision === languageRevision && this.updateLanguage(badgeLanguage(data[BADGE_LANGUAGE_KEY]));
    }).catch(() => {
    }), this.markAll(), this.api.tabs.query({}).then((tabs) => {
      if (!this.stopped)
        for (let tab of tabs.slice(0, MAX_DOCUMENTS_GLOBAL)) typeof tab.id == "number" && this.mark(tab.id);
    }).catch(() => {
    });
  }
  stop() {
    this.stopped = !0, this.api.storage.onChanged?.removeListener?.(this.onLanguageChanged), this.timer !== null && clearTimeout(this.timer), this.timer = null, this.work.clear(), this.displayed.clear(), this.protectTabs.clear();
  }
  updateLanguage(language) {
    if (this.language !== language) {
      this.language = language;
      for (let tabId of this.work.keys()) this.mark(tabId);
      for (let tabId of this.displayed.keys()) this.displayed.set(tabId, "pending");
      this.markAll();
    }
  }
  mark(tabId) {
    if (this.stopped || !this.api.action || tabId !== null && (!Number.isInteger(tabId) || tabId < 0)) return;
    let item = this.work.get(tabId);
    if (!item) {
      // Keep the master update independent of a full queue of tab counters.
      // Known native counters always get their cleanup; at most 256 owners + 256 queued tabs + master.
      if (tabId !== null && !this.displayed.has(tabId) && this.work.size - Number(this.work.has(null)) >= MAX_DOCUMENTS_GLOBAL) return;
      item = { version: 0, dirty: !1, inFlight: !1, removed: !1 }, this.work.set(tabId, item);
    }
    item.version++, item.dirty = !0, item.removed = !1, this.schedule();
  }
  markAll() {
    // Global defaults also cover fresh/restricted tabs that have no captured document.
    this.mark(null);
    for (let tabId of this.work.keys()) this.mark(tabId);
    for (let tabId of this.displayed.keys()) this.mark(tabId);
    for (let tabId of this.state().tabs.keys()) this.mark(tabId);
    for (let tabId of this.protectTabs.keys()) this.mark(tabId);
  }
  afterEvent(event, before) {
    if (this.api.action)
      if (event.type === "tab:removed" || event.type === "tab:replaced") {
        let removed = event.type === "tab:removed" ? event.tabId : event.removedTabId;
        this.displayed.delete(removed), this.protectTabs.delete(removed);
        let item = this.work.get(removed);
        item?.inFlight ? (item.version++, item.removed = !0, item.dirty = !1) : this.work.delete(removed), event.type === "tab:replaced" && this.mark(event.addedTabId);
      } else if ("tabId" in event) this.mark(event.tabId);
      else if (event.type === "batch") this.mark(event.sender.tabId);
      else if ("documentKey" in event) this.markDocument(event.documentKey, before);
      else if ("documentKeys" in event) for (let key2 of event.documentKeys) this.markDocument(key2, before);
      else event.type === "ttl-tick" && this.markAll();
  }
  markDocument(key2, before) {
    let report2 = before.reports.get(key2) ?? this.state().reports.get(key2);
    if (report2) {
      this.mark(report2.tabId);
      return;
    }
    for (let binding of before.bindings.values()) if (binding.documentKey === key2) {
      this.mark(binding.tabId);
      return;
    }
  }
  schedule() {
    let global = this.work.get(null);
    !this.started || this.stopped || this.timer !== null || !(global?.dirty && !global.inFlight || this.running < MAX_ACTION_OPERATIONS - 1 && [...this.work.values()].some((item) => item.dirty && !item.inFlight)) || (this.timer = setTimeout(() => {
      this.timer = null, this.drain();
    }, BADGE_UPDATE_MS));
  }
  drain() {
    if (!this.stopped) {
      let run = (tabId, item) => {
        item.dirty = !1, item.inFlight = !0, this.running++;
        this.update(tabId, item).finally(() => {
          this.running--, item.inFlight = !1, !item.dirty && this.work.get(tabId) === item && this.work.delete(tabId), this.schedule();
        });
      };
      // One physical slot belongs to master status, even when frame reads stall.
      let global = this.work.get(null);
      global?.dirty && !global.inFlight && !global.removed && run(null, global);
      let ordered = [...this.work].sort(([a], [b]) => Number(this.displayed.has(b)) - Number(this.displayed.has(a)));
      for (let [tabId, item] of ordered) {
        if (this.running >= MAX_ACTION_OPERATIONS - 1) break;
        tabId === null || !item.dirty || item.inFlight || item.removed || run(tabId, item);
      }
      this.schedule();
    }
  }
  async update(tabId, item) {
    let action = this.api.action;
    if (!action) return;
    let controls = this.controls(), appearance = toolbarAppearance(controls.observing, controls.blocking);
    let version = item.version, current = () => !this.stopped && !item.removed && item.version === version && this.work.get(tabId) === item,
      count3 = appearance.mode === "observing" && tabId !== null ? countTabTechniques(this.state(), tabId, this.hasAccess) : 0;
    if (count3 > 0) {
      let frames;
      try {
        frames = await this.api.webNavigation.getAllFrames({ tabId });
      } catch {
        frames = null;
      }
      if (!current()) return;
      if (!Array.isArray(frames) || frames.length > MAX_DOCUMENTS_GLOBAL || frames.some((f) => typeof f.documentId != "string" || !Number.isInteger(f.frameId))) count3 = 0;
      else {
      let live = new Map(frames.map((frame) => [frame.frameId, frame])), state = this.state(), bindings = new Map(state.bindings);
      for (let [id4, binding] of bindings) {
        if (binding.tabId !== tabId) continue;
        let frame = live.get(binding.frameId);
        !(!frame && binding.frameId !== 0 && binding.scheme === void 0) && (!frame || frame.documentId !== binding.documentId || frame.documentLifecycle !== void 0 && frame.documentLifecycle !== "active") && bindings.delete(id4);
      }
      count3 = countTabTechniques({ ...state, bindings }, tabId, this.hasAccess);
      }
    }
    // Never forget a live native override. Reserve its bounded slot before writing.
    // Further tabs inherit the global appearance until a counter slot becomes free.
    if (tabId !== null && count3 > 0 && !this.displayed.has(tabId) && this.displayed.size - Number(this.displayed.has(null)) >= MAX_DOCUMENTS_GLOBAL) count3 = 0;
    // ADR-047 protect badge start
    // Firewall prompts of the module «Защита» win over the tab text in every mode: "1"…"9+" on the module colour
    // with its tooltip. A tab the module coloured gets the global colour and title back (again after a global
    // appearance change); the set of such tabs is bounded like the counters.
    let firewall = null, globalTitle = appearance.mode === "observing" ? "Detect Expert" : "Detect Expert — " + (appearance.mode === "off" ? "OFF" : "ON");
    if (tabId !== null) {
      try {
        firewall = this.protect(tabId, this.language);
      } catch {
        firewall = null;
      }
      if (typeof firewall != "object" || firewall === null || typeof firewall.text != "string" || firewall.text === "" || typeof firewall.color != "string" || typeof firewall.title != "string" || !this.protectTabs.has(tabId) && this.protectTabs.size >= MAX_DOCUMENTS_GLOBAL) firewall = null;
    }
    let restored = appearance.color + "|" + globalTitle, restore = tabId !== null && firewall === null && this.protectTabs.has(tabId) && this.protectTabs.get(tabId) !== restored;
    let displayKey = appearance.mode + ":" + count3 + (firewall === null ? "" : ":fw:" + firewall.text + ":" + firewall.color + ":" + firewall.title);
    if (this.displayed.get(tabId) === displayKey && !restore) return;
    if (tabId === null || count3 > 0 || firewall !== null || this.displayed.has(tabId)) this.displayed.set(tabId, "pending");
    // ADR-047 protect badge end
    let target = tabId === null ? {} : { tabId };
    let operations = tabId === null ? [
      // Master appearance is global; only observed counts have tab-specific text.
      () => action.setIcon({ path: appearance.path }),
      () => action.setBadgeBackgroundColor({ ...target, color: appearance.color }),
      () => action.setBadgeTextColor({ ...target, color: BADGE_TEXT_COLOR }),
      () => action.setTitle({ ...target, title: appearance.mode === "observing" ? "Detect Expert" : "Detect Expert — " + (appearance.mode === "off" ? "OFF" : "ON") }),
      () => action.setBadgeText({ ...target, text: appearance.badge })
    // ADR-047 protect badge operations start
    ] : [() => action.setBadgeText({ tabId, text: firewall !== null ? firewall.text : appearance.mode === "observing" && count3 > 0 ? String(count3) : null })], ok = !0;
    if (firewall !== null) this.protectTabs.set(tabId, "fw"), operations.push(() => action.setBadgeBackgroundColor({ tabId, color: firewall.color }), () => action.setTitle({ tabId, title: firewall.title }));
    else if (restore) operations.push(() => action.setBadgeBackgroundColor({ tabId, color: appearance.color }), () => action.setTitle({ tabId, title: globalTitle }));
    // ADR-047 protect badge operations end
    for (let operation of operations) {
      if (!current()) return;
      try {
        await operation();
      } catch {
        ok = !1;
      }
    }
    if (ok && current()) {
      tabId === null || count3 > 0 || firewall !== null ? this.displayed.set(tabId, displayKey) : this.displayed.delete(tabId);
      restore && this.protectTabs.has(tabId) && this.protectTabs.set(tabId, restored);
    }
  }
};

// packages/background/src/pro-redaction.ts
var ROUTES = new Set("account accounts api app assets auth authentication blog browser browserleaks canvas cart catalog categories checkout client contact css dashboard data docs download fingerprint fonts forgot-password home images img index js javascript login logout main media news oauth password password-recovery pixelscan privacy product products profile recover recovery register registration reset reset-password resources script scripts search service services settings signup static status styles terms test tests user users v1 v2 v3 vendor vendors webgl webgpu webrtc".split(" ")), EXTENSIONS = /* @__PURE__ */ new Set(["js", "mjs", "css", "png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "woff", "woff2", "ttf", "wasm", "json", "html", "htm", "php", "aspx", "map"]);
function safeProUrl(value) {
  if (typeof value != "string" || value.length > 16384) return null;
  try {
    let parsed = new URL(value);
    if (!["http:", "https:", "ws:", "wss:"].includes(parsed.protocol)) return null;
    let host2 = toAsciiHost(parsed.hostname);
    if (!host2) return null;
    let domain = registrableDomain(host2) ?? host2, path = parsed.pathname.split("/").slice(1, 13).map((part) => {
      if (!part) return "";
      let lower2 = part.toLowerCase();
      if (ROUTES.has(lower2)) return lower2;
      let dot = lower2.lastIndexOf("."), extension = dot >= 0 ? lower2.slice(dot + 1) : "";
      if (EXTENSIONS.has(extension)) {
        let stem = lower2.slice(0, dot);
        return (ROUTES.has(stem) ? stem : ":resource") + "." + extension;
      }
      return ":segment";
    }).join("/"), scheme = parsed.protocol === "https:" || parsed.protocol === "wss:" ? "https" : "http";
    return { url: parsed.protocol + "//" + domain + (parsed.port ? ":" + parsed.port : "") + "/" + path, domain, siteKey: domain, scheme };
  } catch {
    return null;
  }
}
function safeProTitle(value) {
  return typeof value != "string" ? "" : value.slice(0, 1e3).replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/https?:\/\/\S+/gi, "[URL]").replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email]").replace(/[a-z0-9_-]{24,}/gi, "[id]").replace(/\b\d{7,}\b/g, "[id]").replace(/\s+/g, " ").trim().slice(0, 200);
}
function safeProResourceUrl(target, selectedSite) {
  if (target.siteKey === selectedSite) return target;
  let host2 = redactHost(target.domain);
  if (host2.kind === "registrable") return target;
  let domain = (host2.kind === "unknown" ? "unknown" : host2.value.toLowerCase()) + ".invalid";
  return { ...target, url: target.url.replace("//" + target.domain, "//" + domain), domain, siteKey: domain };
}

// packages/background/src/pro-counter-history.ts
function browserSource(report2, meta) {
  if (!meta.networkCounterEpoch || !meta.networkCounters?.length) return null;
  let { networkCounters, ...ordinaryMeta } = meta;
  return { report: { ...report2, counters: networkCounters }, meta: {
    ...ordinaryMeta,
    counterKeyFormat: "index-v1",
    boots: [{ sensorBootId: meta.networkCounterEpoch, counts: Object.fromEntries(networkCounters.map((c, index) => [String(index), c.count])) }]
  } };
}
function bootCounters(report2, meta) {
  let keys4 = report2.counters.map((c) => counterKey(c.techniqueId, c.phase, c.signalCodes, c.apiOperation, c.extensionResource)), known = new Set(keys4);
  return meta.boots.map((boot) => ({ sensorBootId: boot.sensorBootId, counts: Object.entries(boot.counts).flatMap(([slot, count3]) => {
    let key2 = meta.counterKeyFormat === "index-v1" ? keys4[Number(slot)] : slot;
    return key2 !== void 0 && known.has(key2) ? [[key2, count3]] : [];
  }) }));
}
function createProCounterHistory(report2, meta) {
  let limited = report2.dropped.counters > 0, counters = structuredClone(report2.counters);
  if (limited) for (let counter of counters) counter.countQuality = "lower-bound";
  let result = { documentKey: report2.documentKey, tabId: report2.tabId, counters, boots: bootCounters(report2, meta), limited }, browser = browserSource(report2, meta);
  if (browser) {
    let value = createProCounterHistory(browser.report, browser.meta);
    result.browser = { counters: value.counters, boots: value.boots, limited: value.limited };
  }
  return result;
}
function mergeProCounterHistory(history, report2, meta) {
  let result = structuredClone(history);
  result.limited ||= report2.dropped.counters > 0;
  let counters = new Map(result.counters.map((c) => [counterKey(c.techniqueId, c.phase, c.signalCodes, c.apiOperation, c.extensionResource), c])), source = new Map(report2.counters.map((c) => [counterKey(c.techniqueId, c.phase, c.signalCodes, c.apiOperation, c.extensionResource), c]));
  for (let incoming of bootCounters(report2, meta)) {
    let boot = result.boots.find((item) => item.sensorBootId === incoming.sensorBootId);
    if (!boot) {
      if (result.boots.length >= MAX_BOOTS_PER_DOCUMENT) {
        result.limited = !0;
        continue;
      }
      boot = { sensorBootId: incoming.sensorBootId, counts: [] }, result.boots.push(boot);
    }
    let maxima = new Map(boot.counts);
    for (let [key2, count3] of incoming.counts) {
      let old = maxima.get(key2) ?? 0, current = source.get(key2), counter = counters.get(key2);
      if (!counter && counters.size >= BUDGETS.maxCountersPerDocumentGroup) {
        result.limited = !0;
        continue;
      }
      counter || (counter = { ...current, count: 0, signalCodes: [...current.signalCodes] }, counters.set(key2, counter));
      let sum = counter.count + Math.max(0, count3 - old);
      sum > 2147483647 && (result.limited = !0), counter.count = Math.min(2147483647, sum), counter.countQuality = counter.countQuality === "lower-bound" || current.countQuality === "lower-bound" ? "lower-bound" : counter.countQuality === "sampled" || current.countQuality === "sampled" ? "sampled" : "exact", counter.firstBucket = Math.min(counter.firstBucket, current.firstBucket), counter.lastBucket = Math.max(counter.lastBucket, current.lastBucket), maxima.set(key2, Math.max(old, count3));
    }
    boot.counts = [...maxima];
  }
  if (result.counters = [...counters.values()], result.limited) for (let counter of result.counters) counter.countQuality = "lower-bound";
  let browser = browserSource(report2, meta);
  if (browser) {
    let value = result.browser ? mergeProCounterHistory({ documentKey: history.documentKey, tabId: history.tabId, ...result.browser }, browser.report, browser.meta) : createProCounterHistory(browser.report, browser.meta);
    result.browser = { counters: value.counters, boots: value.boots, limited: value.limited }, result.limited ||= value.limited;
  }
  return result;
}
function shape4(v, keys4) {
  return typeof v != "object" || v === null || Array.isArray(v) || Object.getOwnPropertySymbols(v).length || Object.getOwnPropertyNames(v).length !== keys4.length || Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null ? !1 : keys4.every((key2) => Object.getOwnPropertyDescriptor(v, key2)?.get === void 0 && Object.getOwnPropertyDescriptor(v, key2)?.set === void 0 && Object.hasOwn(v, key2));
}
function array2(v, max) {
  return !Array.isArray(v) || v.length > max || Object.getOwnPropertyNames(v).length !== v.length + 1 || Object.getOwnPropertySymbols(v).length ? !1 : Array.from({ length: v.length }, (_, index) => Object.getOwnPropertyDescriptor(v, String(index))).every((d) => d && Object.hasOwn(d, "value"));
}
var count2 = (v) => typeof v == "number" && Number.isSafeInteger(v) && v >= 0 && v <= 2147483647;
function readProCounterHistory(value) {
  try {
    let hasBrowser = typeof value == "object" && value !== null && Object.hasOwn(value, "browser");
    if (!shape4(value, ["documentKey", "tabId", "counters", "boots", "limited", ...hasBrowser ? ["browser"] : []]) || typeof value.documentKey != "string" || !/^[A-Za-z0-9_:.-]{1,128}$/.test(value.documentKey) || !count2(value.tabId) || !value.documentKey.startsWith(String(value.tabId) + ":") || typeof value.limited != "boolean" || !array2(value.counters, BUDGETS.maxCountersPerDocumentGroup) || !array2(value.boots, MAX_BOOTS_PER_DOCUMENT)) return null;
    let counters = [], keys4 = /* @__PURE__ */ new Set();
    for (let item of value.counters) {
      let hasOperation = typeof item == "object" && item !== null && Object.hasOwn(item, "apiOperation"), hasResource = typeof item == "object" && item !== null && Object.hasOwn(item, "extensionResource");
      if (hasOperation && hasResource || !shape4(item, ["techniqueId", "phase", "signalCodes", "count", "countQuality", "firstBucket", "lastBucket", ...hasOperation ? ["apiOperation"] : [], ...hasResource ? ["extensionResource"] : []]) || !TECHNIQUE_IDS.includes(item.techniqueId) || !PHASES.includes(item.phase) || !COUNT_QUALITIES.includes(item.countQuality) || !count2(item.count) || !count2(item.firstBucket) || !count2(item.lastBucket) || item.firstBucket > item.lastBucket || !array2(item.signalCodes, BUDGETS.maxSignalCodesPerObservation) || !item.signalCodes.every((s) => SIGNAL_CODES.includes(s)) || new Set(item.signalCodes).size !== item.signalCodes.length) return null;
      let counter = item;
      if (hasOperation && (!isApiOperation(counter.apiOperation) || !apiOperationAllows(counter.apiOperation, counter.techniqueId, counter.phase) || counter.signalCodes.length !== 1 || counter.signalCodes[0] !== "api-use")) return null;
      let resource2 = hasResource ? readExtensionResource(counter.extensionResource) : null;
      if (hasResource && (!resource2 || !extensionResourceAllows(resource2, counter.techniqueId, counter.phase) || counter.signalCodes.length !== 1 || counter.signalCodes[0] !== "api-use")) return null;
      let key2 = counterKey(counter.techniqueId, counter.phase, counter.signalCodes, counter.apiOperation, counter.extensionResource);
      if (keys4.has(key2)) return null;
      keys4.add(key2), counters.push({ ...counter, signalCodes: [...counter.signalCodes] });
    }
    let boots = [], ids2 = /* @__PURE__ */ new Set();
    for (let item of value.boots) {
      if (!shape4(item, ["sensorBootId", "counts"]) || typeof item.sensorBootId != "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(item.sensorBootId) || ids2.has(item.sensorBootId) || !array2(item.counts, BUDGETS.maxCountersPerDocumentGroup)) return null;
      let entries = [], seen = /* @__PURE__ */ new Set();
      for (let entry of item.counts) {
        if (!array2(entry, 2) || entry.length !== 2 || typeof entry[0] != "string" || !keys4.has(entry[0]) || seen.has(entry[0]) || !count2(entry[1])) return null;
        seen.add(entry[0]), entries.push([entry[0], entry[1]]);
      }
      ids2.add(item.sensorBootId), boots.push({ sensorBootId: item.sensorBootId, counts: entries });
    }
    let result = { documentKey: value.documentKey, tabId: value.tabId, counters, boots, limited: value.limited };
    if (hasBrowser) {
      let browser = value.browser;
      if (!shape4(browser, ["counters", "boots", "limited"])) return null;
      let parsed = readProCounterHistory({ documentKey: result.documentKey, tabId: result.tabId, ...browser });
      if (!parsed || readNetworkCounters(parsed.counters).length !== parsed.counters.length) return null;
      result.browser = { counters: parsed.counters, boots: parsed.boots, limited: parsed.limited };
    }
    return result;
  } catch {
    return null;
  }
}

// packages/background/src/pro-recording.ts
var PRO_STORAGE_KEY = "pro-recording-v1", PRO_ALARM_NAME = "detect-expert-pro-deadline", PRO_NETWORK_FILTER = { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] }, TYPES = /* @__PURE__ */ new Set(["main_frame", "sub_frame", "stylesheet", "script", "image", "font", "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket", "webtransport", "other"]), MAX_PENDING = 256, MAX_INFLIGHT = 512, MAX_EVENTS = 5e4, PERSIST_MS = 250, sat = (a, b = 1) => Math.min(2147483647, a + b), error3 = (code2) => ({ schemaVersion: 1, type: "error", code: code2 }), record = (v) => typeof v == "object" && v !== null && !Array.isArray(v), ProRecordingManager = class {
  constructor(runtime) {
    this.runtime = runtime;
    this.cookieCapture = new ProCookieCapture(this);
    this.vendorRedirects = createRuntimeVendorRedirects(runtime, this);
  }
  runtime;
  session = null;
  trackedTabs = /* @__PURE__ */ new Set();
  currentPages = /* @__PURE__ */ new Map();
  baselines = /* @__PURE__ */ new Map();
  requests = /* @__PURE__ */ new Map();
  counterHistory = /* @__PURE__ */ new Map();
  pending = [];
  hydrated = !1;
  disposed = !1;
  commandBusy = !1;
  commandEpoch = 0;
  events = 0;
  pendingDropped = 0;
  revision = 0;
  persistedRevision = 0;
  persistTimer = null;
  deadlineTimer = null;
  write = null;
  alarmOperation = Promise.resolve();
  nextPage = 1;
  nextResource = 1;
  estimatedBytes = 4096;
  sizes = /* @__PURE__ */ new Map();
  hasSession() {
    return this.session !== null;
  }
  headerPeriod(tabId, documentKey3) {
    if (!this.hydrated || !this.checkDeadline()) return null;
    let page = this.pageFor(tabId);
    return page && (documentKey3 === void 0 || page.documentKey === documentKey3) ? { sessionId: this.session.id, pageId: page.id } : null;
  }
  async start() {
    try {
      let saved = (await this.runtime.api.storage.session.get(PRO_STORAGE_KEY))[PRO_STORAGE_KEY];
      this.restore(saved);
    } catch {
    }
    if (this.hydrated = !0, this.session?.status === "recording")
      if (this.limit("service-worker-restarted"), this.runtime.now() >= this.session.deadlineAt) this.finish("timeout", this.session.deadlineAt);
      else {
        let tabs = await this.runtime.api.tabs.query({}).catch(() => []), live = new Set(tabs.flatMap((t) => typeof t.id == "number" ? [t.id] : []));
        for (let tabId of this.trackedTabs) live.has(tabId) || (this.closePage(tabId), this.trackedTabs.delete(tabId));
        for (let tab of tabs) if (typeof tab.id == "number" && this.trackedTabs.has(tab.id)) {
          let top = (await this.runtime.api.webNavigation.getAllFrames({ tabId: tab.id }).catch(() => null))?.find((f) => f.frameId === 0 && f.documentLifecycle !== "prerender" && f.documentLifecycle !== "cached"), safe = safeProUrl(top?.url ?? tab.url), current = this.pageFor(tab.id);
          !safe || !this.sameSite(safe) ? this.closePage(tab.id) : top?.documentId && (!current || current.documentKey !== `${tab.id}:0:${top.documentId}` || current.url !== safe.url) && (this.limit("navigation-gap"), this.newPage(tab.id, `${tab.id}:0:${top.documentId}`, safe, this.runtime.now(), !0));
        }
        if (this.trackedTabs.size === 0) this.finish("tab-closed");
        else if (!this.rootAccess())
          this.limit("permission-limited"), this.finish("access-revoked");
        else {
          this.armDeadline(); this.cookieCapture.start(); this.captureValues().catch(() => this.limit("event-limit"));
          let before = { ...this.runtime.state, reports: /* @__PURE__ */ new Map() };
          for (let binding of this.runtime.state.bindings.values()) this.currentPages.has(binding.tabId) && this.afterEvent({ type: "scope:access", documentKey: binding.documentKey, host: binding.host, accessGranted: !0, at: this.runtime.now() }, before);
        }
      }
    for (let action of this.pending.splice(0)) action();
    this.session && this.pendingDropped > 0 && (this.limit("event-limit"), this.session.dropped.events = sat(this.session.dropped.events, this.pendingDropped)), this.pendingDropped = 0, this.session && (this.mark(), await this.flush());
  }
  restore(value) {
    if (!record(value) || value.version !== 1) return;
    let checked = validateProSession(value.session);
    if (!checked.ok) return;
    let session = checked.value;
    if (JSON.stringify(session).length * 2 > PRO_LIMITS.maxBytes) return;
    this.session = session;
    let tabs = value.trackedTabs;
    if (Array.isArray(tabs) && tabs.length <= PRO_LIMITS.maxTabs) for (let id4 of tabs) Number.isSafeInteger(id4) && id4 >= 0 && this.trackedTabs.add(id4);
    let pages = value.currentPages;
    if (Array.isArray(pages) && pages.length <= PRO_LIMITS.maxTabs) for (let pair of pages)
      Array.isArray(pair) && pair.length === 2 && this.trackedTabs.has(pair[0]) && session.pages.some((p) => p.id === pair[1] && p.tabId === pair[0] && p.endedAt === null) && this.currentPages.set(pair[0], pair[1]);
    let baselines = value.baselines;
    if (Array.isArray(baselines) && baselines.length <= PRO_LIMITS.maxTabs * PRO_LIMITS.maxDocumentsPerPage) for (let b of baselines) {
      if (!record(b) || typeof b.pageId != "string" || typeof b.documentKey != "string" || b.documentKey.length > 128 || ![...this.currentPages.values()].includes(b.pageId) || !Array.isArray(b.counts) || b.counts.length > 128 || !Array.isArray(b.vendors) || b.vendors.length > 128) continue;
      let counts = [];
      for (let pair of b.counts) Array.isArray(pair) && typeof pair[0] == "string" && pair[0].length <= 512 && /^[A-Za-z0-9.|,_-]+$/.test(pair[0]) && Number.isSafeInteger(pair[1]) && pair[1] >= 0 && pair[1] <= 2147483647 && counts.push([pair[0], pair[1]]);
      let vendors = b.vendors.filter((v) => typeof v == "string" && /^[a-z0-9_-]{1,64}$/i.test(v)), rtcKeys = Array.isArray(b.rtcKeys) ? b.rtcKeys.slice(0, 256).filter((v) => typeof v == "string" && /^[a-z0-9_:-]{1,128}$/i.test(v)) : [], browserCounts = [];
      if (Object.hasOwn(b, "browserCounts")) {
        let entries = b.browserCounts, seen = /* @__PURE__ */ new Set();
        if (!Array.isArray(entries) || entries.length > 4) {
          this.limit("storage-error"), this.finish("storage-error");
          return;
        }
        for (let pair of entries) {
          if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] != "string" || !/^(?:DET-058\|attempted\|api-use|DET-060\|attempted\|api-use(?:,local-multi-port)?|DET-061\|attempted\|api-use,unique-subdomains)$/.test(pair[0]) || seen.has(pair[0]) || !Number.isSafeInteger(pair[1]) || pair[1] < 0 || pair[1] > 2147483647) {
            this.limit("storage-error"), this.finish("storage-error");
            return;
          }
          seen.add(pair[0]), browserCounts.push([pair[0], pair[1]]);
        }
      }
      let baseline = { pageId: b.pageId, documentKey: b.documentKey, counts, browserCounts, vendors, rtcKeys }, portsIncomplete = Object.getOwnPropertyDescriptor(b, "localPortsIncomplete");
      if (portsIncomplete) {
        if (!portsIncomplete.enumerable || !Object.hasOwn(portsIncomplete, "value") || typeof portsIncomplete.value != "boolean") {
          this.limit("storage-error"), this.finish("storage-error");
          return;
        }
        baseline.localPortsIncomplete = portsIncomplete.value;
      }
      this.baselines.set(baseline.pageId + "|" + baseline.documentKey, baseline);
    }
    let requests = value.requests;
    if (Array.isArray(requests) && requests.length <= MAX_INFLIGHT) for (let r of requests) {
      if (!record(r) || typeof r.id != "string" || !/^[a-z0-9_.:-]{1,128}$/i.test(r.id) || !Number.isSafeInteger(r.tabId) || !this.trackedTabs.has(r.tabId) || !record(r.target) || !TYPES.has(r.type)) continue;
      let target = safeProUrl(r.target.url);
      if (!target || target.url !== r.target.url || typeof r.at != "number" || r.at < session.startedAt || r.at > session.deadlineAt) continue;
      let pageId = typeof r.pageId == "string" && session.pages.some((p) => p.id === r.pageId) ? r.pageId : null, resourceId = typeof r.resourceId == "string" && session.pages.some((p) => p.id === pageId && p.resources.some((resource2) => resource2.id === r.resourceId)) ? r.resourceId : null, documentKey3 = typeof r.documentKey == "string" && r.documentKey.length <= 128 && /^[A-Za-z0-9_:.-]+$/.test(r.documentKey) ? r.documentKey : null, bit = (n) => n === 1 ? 1 : 0, endedAt = typeof r.endedAt == "number" && Number.isSafeInteger(r.endedAt) && r.endedAt >= r.at && r.endedAt <= session.deadlineAt ? r.endedAt : null, status = typeof r.status == "number" && Number.isInteger(r.status) && r.status >= 100 && r.status <= 599 ? r.status : null, ruleIds = Array.isArray(r.ruleIds) ? r.ruleIds.slice(0, 32).filter((id4) => typeof id4 == "string" && lookupVendorResourceRule(id4, this.runtime.now()) !== null) : [];
      this.requests.set(r.id, { id: r.id, tabId: r.tabId, pageId, resourceId, documentKey: documentKey3, ruleIds, target, type: r.type, at: r.at, completed: bit(r.completed), failed: bit(r.failed), redirects: bit(r.redirects), status, endedAt });
    }
    this.events = typeof value.events == "number" && Number.isSafeInteger(value.events) ? Math.max(0, Math.min(MAX_EVENTS, value.events)) : 0, this.nextPage = session.pages.length + 1, this.nextResource = session.pages.reduce((n, p) => n + p.resources.length, 0) + 1;
    for (let page of session.pages) {
      this.size("page:" + page.id, 2048);
      for (let entry of page.apiValues ?? []) this.size("values:" + page.id + "|" + entry.documentKey, JSON.stringify(entry).length * 2 + 256);
      for (let entry of page.tagManager ?? []) this.size("loaders:" + page.id + "|" + entry.documentKey, JSON.stringify(entry).length * 2 + 256);
      if (page.cookies) this.size("cookies:" + page.id, JSON.stringify(page.cookies).length * 2 + 512);
      if (page.socialNetworks) this.size("social:" + page.id, JSON.stringify(page.socialNetworks).length * 2 + 256);
      if (page.cookieValues) this.size("cookieValues:" + page.id, JSON.stringify(page.cookieValues).length * 2 + 512);
      if (page.requestValues) this.size("requestValues:" + page.id, JSON.stringify(page.requestValues).length * 2 + 512);
      for (const field of ["beacons", "backgroundActivity", "cookieProbes", "cookieWriters"]) if (page[field]) this.size(field + ":" + page.id, JSON.stringify(page[field]).length * 2 + 256);
      for (let report2 of page.reports) this.size("report:" + page.id + "|" + report2.documentKey, JSON.stringify(report2).length * 2 + 256);
      for (let resource2 of page.resources) this.size("resource:" + resource2.id, 1024 + 2 * (resource2.url.length + resource2.domain.length));
    }
    for (let [key2, base] of this.baselines) this.size("baseline:" + key2, JSON.stringify(base).length * 2 + 128);
    for (let [key2, request] of this.requests) this.size("request:" + key2, JSON.stringify(request).length * 2 + 256);
    let histories = value.counterHistory;
    if (histories !== void 0)
      if (!Array.isArray(histories) || histories.length > PRO_LIMITS.maxTabs * PRO_LIMITS.maxDocumentsPerPage)
        this.limit("storage-error"), this.finish("storage-error");
      else for (let raw of histories) {
        let history = readProCounterHistory(raw);
        if (!history || !this.currentPages.has(history.tabId) || this.counterHistory.has(history.documentKey)) {
          this.limit("storage-error"), this.finish("storage-error");
          break;
        }
        this.size("history:" + history.documentKey, JSON.stringify(history).length * 2 + 256) && this.counterHistory.set(history.documentKey, history);
      }
  }
  route(message, sender) {
    if (!record(message) || typeof message.type != "string" || !message.type.startsWith("ui-pro-")) return null;
    if (!verifyUiSender(sender, this.runtime.api.runtime.id)) return Promise.resolve(error3("unauthorized-sender"));
    let checked = validateProRequest(message);
    return checked.ok ? (async () => {
      await this.runtime.whenReady();
      let request = checked.value;
      if (this.checkDeadline(), request.type === "ui-pro-get") return this.stateResponse(request.tabId);
      if (this.commandBusy) return error3("invalid-request");
      this.commandBusy = !0;
      try {
        return request.type === "ui-pro-start" ? await this.begin(request.tabId) : !this.session || this.session.id !== request.sessionId ? error3("stale-revision") : request.type === "ui-pro-stop" ? await this.stopWithValues() : (await this.clear(), this.stateResponse());
      } finally {
        this.commandBusy = !1;
      }
    })() : Promise.resolve(error3("invalid-request"));
  }
  async currentTab(tabId) {
    if (!Number.isSafeInteger(tabId) || tabId < 0) return null;
    let generation = this.runtime.scope.accessGeneration;
    if (!this.runtime.scope.accessReady) return null;
    let tab = this.runtime.api.tabs.get ? await this.runtime.api.tabs.get(tabId).catch(() => null) : (await this.runtime.api.tabs.query({}).catch(() => [])).find((t) => t.id === tabId) ?? null;
    if (!this.runtime.scope.accessReady || generation !== this.runtime.scope.accessGeneration) return null;
    let frames = await this.runtime.api.webNavigation.getAllFrames({ tabId }).catch(() => null);
    if (!this.runtime.scope.accessReady || generation !== this.runtime.scope.accessGeneration) return null;
    let top = frames?.find((f) => f.frameId === 0 && f.documentLifecycle !== "prerender" && f.documentLifecycle !== "cached"), safe = safeProUrl(top?.url ?? tab?.url), permissionHost = toAsciiHost(top?.url ?? tab?.url);
    return safe && permissionHost && typeof top?.documentId == "string" ? { safe, permissionHost, tab: tab ?? {}, documentId: top.documentId } : null;
  }
  async stateResponse(tabId) {
    let current = tabId === void 0 ? null : await this.currentTab(tabId);
    return this.checkDeadline(), {
      schemaVersion: 1,
      type: "pro-state",
      session: this.session === null ? null : structuredClone(this.session),
      currentDomain: current?.safe.domain ?? null,
      canStart: !!current && this.session?.status !== "recording" && this.runtime.scope.hasAnyHostAccess() && this.runtime.scope.inScope(current.permissionHost, tabId, current.documentId, current.safe.scheme)
    };
  }

  proValueCaptures = new Map();
  proValueAttempts = new Map();
  proValueControlEpoch = {};
  proValueBaselines = new Map();
  proLoaderBaselines = new Map();
  proValuePending = new Set();
  proValueEpoch = null;
  async boundedPro(operation) {
    if (this.proValuePending.size >= 4) throw Error("pro-read-capacity");
    const native = Promise.resolve().then(operation); this.proValuePending.add(native);
    native.then(() => this.proValuePending.delete(native), () => this.proValuePending.delete(native));
    let timer;
    try { return await Promise.race([native, new Promise((_, reject) => { timer = setTimeout(() => reject(Error("pro-read-timeout")), 600); })]); } finally { clearTimeout(timer); }
  }
  proValueTimer = null;
  proValueBusy = !1;
  proValueWork = null;
  proValueWorkEpoch = null;
  async captureValues() {
    if (this.proValueWork) {
      const previous = this.proValueWork, epoch = this.proValueWorkEpoch;
      await previous;
      if (this.proValueWork === previous) this.proValueWork = null;
      if (epoch !== this.proValueControlEpoch && this.checkDeadline()) return this.captureValues();
      return;
    }
    this.proValueWorkEpoch = this.proValueControlEpoch;
    const work = this.captureValueWork(); this.proValueWork = work;
    try { return await work; } finally { if (this.proValueWork === work) this.proValueWork = null; }
  }
  async captureValueWork() {
    if (this.proValueBusy || !this.checkDeadline()) return;
    this.proValueBusy = !0;
    let sessionId = this.session.id, generation = this.runtime.scope.accessGeneration, controlEpoch = this.proValueControlEpoch, deadline = Date.now() + 3000;
    try {
      let candidates = [...this.runtime.state.bindings.values()].filter(binding => this.trackedTabs.has(binding.tabId) && this.pageFor(binding.tabId) && this.belongsToPage(binding.documentKey, this.pageFor(binding.tabId)) && binding.documentLifecycle !== "cached" && binding.documentLifecycle !== "prerender");
      if (candidates.length > 24) this.limit("document-limit");
      candidates = candidates.slice(0, 24);
      this.proValueEpoch ??= crypto.randomUUID().slice(0, 8);
      const liveCaptures = new Map(candidates.map(binding => [binding.documentKey, sessionId + "-" + this.pageFor(binding.tabId).id + "-" + this.proValueEpoch]));
      const liveBaselines = new Set([...liveCaptures].map(([key, token]) => token + "|" + key));
      for (const [key, token] of this.proValueCaptures) if (liveCaptures.get(key) !== token) this.proValueCaptures.delete(key);
      for (const key of this.proValueBaselines.keys()) if (!liveBaselines.has(key)) this.proValueBaselines.delete(key);
      for (const key of this.proLoaderBaselines.keys()) if (!liveBaselines.has(key)) this.proLoaderBaselines.delete(key);
      for (let binding of candidates) {
        if (Date.now() >= deadline || this.proValuePending.size >= 4) { this.limit("event-limit"); break; }
        if (this.proValueControlEpoch !== controlEpoch || !this.checkDeadline() || this.session.id !== sessionId || this.runtime.scope.accessGeneration !== generation) return;
        const page = this.pageFor(binding.tabId), request = { tabId: binding.tabId, frameId: binding.frameId, documentKey: binding.documentKey }, operation = { documentKey: binding.documentKey, tabId: binding.tabId, invalid: !1 };
        if (!this.runtime.apiResults.trackOperation(operation)) { this.limit("event-limit"); continue; }
        try {
        const current = () => {
          let live;
          for (const candidate of this.runtime.state.bindings.values()) if (candidate.documentKey === binding.documentKey) { live = candidate; break; }
          // ADR-072: a pause followed by resume still invalidates this operation.
          const meta = this.runtime.state.metas?.get(binding.documentKey);
          return !operation.invalid && !meta?.paused && !meta?.revoked && meta?.accessGranted !== false && live?.accessGranted !== false && !live?.originPending && this.runtime.scope.accessReady !== false && this.proValueControlEpoch === controlEpoch && this.checkDeadline() && this.session.id === sessionId && this.runtime.scope.accessGeneration === generation && this.pageFor(binding.tabId) === page && live?.documentId === binding.documentId && live?.tabId === binding.tabId && live?.frameId === binding.frameId && live.documentLifecycle !== "cached" && live.documentLifecycle !== "prerender" && this.belongsToPage(binding.documentKey, page);
        };
        try { if (!await this.boundedPro(() => current() && this.runtime.apiResults.authorize(request, operation))) continue; } catch { this.limit("event-limit"); continue; }
        if (!current()) continue;
        const key = binding.documentKey, captureToken = sessionId + "-" + page.id + "-" + this.proValueEpoch, initialized = this.proValueCaptures.get(key) === captureToken;
        const baselineKey = captureToken + "|" + key;
        if (!initialized && !this.proLoaderBaselines.has(baselineKey)) this.proLoaderBaselines.set(baselineKey, page.tagManager?.find(item => item.documentKey === key)?.rows ?? []);
        // A worker restart starts a fresh MAIN history epoch. Retained report rows form
        // the baseline, so the new epoch is added without recounting an older sensor.
        if (!initialized && !this.proValueBaselines.has(baselineKey)) {
          const retained = page.apiValues?.find(item => item.documentKey === key);
          if (retained) this.proValueBaselines.set(baselineKey, retained.rows);
        }
        let response;
        try { response = await this.boundedPro(() => {
          if (!current()) return;
          // Retain the native target before dispatch, including timeout/unavailable outcomes.
          // Keep up to 128 native targets until stop, including temporarily absent/BFCache bindings.
          if (!this.proValueAttempts.has(key) && this.proValueAttempts.size >= 128) { this.limit("document-limit"); return; }
          const previous = this.proValueAttempts.get(key);
          if (previous && previous.token !== captureToken) this.stopProValueAttempt(previous);
          this.proValueAttempts.set(key, { tabId: binding.tabId, frameId: binding.frameId, documentId: binding.documentId, token: captureToken });
          return this.runtime.api.tabs.sendMessage(binding.tabId, { schemaVersion: 1, type: initialized ? "pro-values-read" : "pro-values-start", sessionId: captureToken }, { frameId: binding.frameId, documentId: binding.documentId });
        }); } catch { continue; }
        if (!current()) continue;
        try { if (!await this.boundedPro(() => this.runtime.apiResults.authorize(request, operation))) continue; } catch { this.limit("event-limit"); continue; }
        if (!current()) continue;
        if (!response || response.schemaVersion !== 1 || response.type !== "pro-values-cache" || response.sessionId !== captureToken || typeof response.available !== "boolean" || typeof response.truncated !== "boolean") continue;
        let rows = proValueRows(response.rows, readApiResultEntries);
        const loaders = Object.hasOwn(response, "loaderRows") ? readLoaderRows(response.loaderRows) : [];
        if (!loaders || Object.hasOwn(response, "loaderTruncated") && typeof response.loaderTruncated !== "boolean") continue;
        if (!rows || !response.available) {
          this.limit("event-limit"); this.proValueCaptures.delete(key);
          const existing = page.apiValues?.find(item => item.documentKey === key);
          if (existing) this.proValueBaselines.set(captureToken + "|" + key, existing.rows);
          continue;
        }
        this.proValueCaptures.set(key, captureToken);
        const loaderIndex = page.tagManager?.findIndex(item => item.documentKey === key) ?? -1;
        const retainedLoaders = loaderIndex >= 0 ? page.tagManager[loaderIndex] : null;
        const loaderRows = mergeLoaderRows(retainedLoaders?.rows ?? [], loaders, this.proLoaderBaselines.get(baselineKey) ?? []);
        if (!loaderRows) continue;
        const loaderEntry = { documentKey: key, rows: loaderRows, truncated: response.loaderTruncated === true || retainedLoaders?.truncated === true };
        page.tagManager ??= [];
        if (loaderIndex < 0 && page.tagManager.length >= 24) { this.limit("document-limit"); continue; }
        if (!this.size("loaders:" + page.id + "|" + key, 256 + JSON.stringify(loaderEntry).length * 2)) return;
        if (loaderIndex < 0) page.tagManager.push(loaderEntry); else page.tagManager[loaderIndex] = loaderEntry;
        if (loaderEntry.truncated) this.limit("event-limit");
        page.apiValues ??= [];
        let index = page.apiValues.findIndex(item => item.documentKey === key), existing = index >= 0 ? page.apiValues[index] : null;
        let combined = new Map((existing?.rows ?? []).map(row => [proValueKey(row), row]));
        const baseline = new Map((this.proValueBaselines.get(captureToken + "|" + key) ?? []).map(row => [proValueKey(row), row.count]));
        for (const row of rows) { const slot = proValueKey(row), previous = combined.get(slot), count = Math.min(2147483647, row.count + (baseline.get(slot) ?? 0)); combined.set(slot, { ...row, count: Math.max(previous?.count ?? 0, count) }); }
        const admitted = []; let bytes = 512, truncated = response.truncated || (existing?.truncated ?? false);
        for (const row of combined.values()) { const cost = 256 + proValueKey(row).length * 2; if (admitted.length >= 256 || bytes + cost > 65536) { truncated = true; continue; } bytes += cost; admitted.push(row); }
        let entry = { documentKey: key, rows: admitted, truncated };
        if (index < 0 && page.apiValues.length >= 24) { this.limit("document-limit"); continue; }
        if (!this.size("values:" + page.id + "|" + key, JSON.stringify(entry).length * 2 + 256)) return;
        if (index < 0) page.apiValues.push(entry); else page.apiValues[index] = entry;
        if (entry.truncated) this.limit("event-limit");
        this.mark();
        } finally { this.runtime.apiResults.releaseOperation(operation); }
      }
    } finally {
      this.proValueBusy = !1;
      if (this.proValueControlEpoch === controlEpoch && this.checkDeadline() && this.proValueTimer === null) this.proValueTimer = setTimeout(() => { this.proValueTimer = null; this.captureValues().catch(() => this.limit("event-limit")); }, 750);
    }
  }
  async resumeValueCapture(documentKey, resumeBridge) {
    if (!this.checkDeadline()) { await resumeBridge(); return; }
    // Light pause clears MAIN values. Rearm that document before acknowledging
    // resume, without waiting for an unavailable READ and another polling tick.
    const controlEpoch = this.proValueControlEpoch = {};
    if (this.proValueTimer !== null) clearTimeout(this.proValueTimer);
    this.proValueTimer = null;
    this.proValueCaptures.delete(documentKey);
    for (const key of this.proValueBaselines.keys()) if (key.endsWith("|" + documentKey)) this.proValueBaselines.delete(key);
    for (const key of this.proLoaderBaselines.keys()) if (key.endsWith("|" + documentKey)) this.proLoaderBaselines.delete(key);
    try { await this.boundedPro(resumeBridge); } catch { this.limit("event-limit"); }
    if (this.proValueControlEpoch !== controlEpoch || !this.checkDeadline()) return;
    await this.captureValues().catch(() => this.limit("event-limit"));
  }
  stopProValueAttempt(attempt) {
    try { Promise.resolve(this.runtime.api.tabs.sendMessage(attempt.tabId, { schemaVersion: 1, type: "pro-values-stop", sessionId: attempt.token }, { frameId: attempt.frameId, documentId: attempt.documentId })).catch(() => {}); } catch {}
  }
  stopValueCapture() {
    this.proValueControlEpoch = {};
    this.proValueEpoch = null;
    if (this.proValueTimer !== null) clearTimeout(this.proValueTimer);
    this.proValueTimer = null;
    for (const attempt of this.proValueAttempts.values()) this.stopProValueAttempt(attempt);
    this.proValueAttempts.clear(); this.proValueCaptures.clear(); this.proValueBaselines.clear(); this.proLoaderBaselines.clear();
  }
  async stopWithValues() { await this.captureValues(); await this.cookieCapture.capture(true); this.finish("manual"); await this.flush(); return this.stateResponse(); }

  async begin(tabId) {
    if (this.session?.status === "recording") return error3("invalid-request");
    let epoch2 = this.commandEpoch, current = await this.currentTab(tabId);
    if (epoch2 !== this.commandEpoch) return error3("stale-revision");
    if (!current || !this.runtime.scope.inScope(current.permissionHost, tabId, current.documentId, current.safe.scheme)) return error3("no-access");
    let now = this.runtime.now();
    this.resetMemory(), this.session = {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      domain: current.safe.domain,
      siteKey: current.safe.siteKey,
      startTabId: tabId,
      status: "recording",
      startedAt: now,
      deadlineAt: now + PRO_LIMITS.durationMs,
      stoppedAt: null,
      stopReason: null,
      pages: [],
      limitations: ["started-mid-page", "unsupported-contexts", "redacted-urls"],
      dropped: { pages: 0, resources: 0, documents: 0, events: 0 }
    }, this.runtime.scope.getState().grantedAllSites || this.limit("permission-limited"), this.trackedTabs.add(tabId);
    let page = this.newPage(tabId, `${tabId}:0:${current.documentId}`, current.safe, now, !0);
    return page && safeProUrl(current.tab.url)?.url === current.safe.url && (page.title = safeProTitle(current.tab.title)), this.armDeadline(), this.cookieCapture.start(), this.mark(), await this.captureValues(), await this.cookieCapture.capture(), await this.flush(), this.stateResponse(tabId);
  }
  async clear() {
    this.commandEpoch++, this.pending.length = 0, this.pendingDropped = 0, this.resetMemory(), this.session = null, this.mark(), await this.flush();
  }
  resetMemory() {
    this.vendorRedirects.clear();
    this.cookieCapture.stop();
    this.runtime.proCookieValues?.stop();
    this.runtime.proRequestValues?.stop();
    this.stopValueCapture();
    this.trackedTabs.clear(), this.currentPages.clear(), this.baselines.clear(), this.requests.clear(), this.counterHistory.clear(), this.events = 0, this.nextPage = 1, this.nextResource = 1, this.sizes.clear(), this.estimatedBytes = 4096, this.cancelDeadline();
  }
  limit(limitation) {
    this.session && !this.session.limitations.includes(limitation) && this.session.limitations.push(limitation);
  }
  checkDeadline() {
    return !this.runtime.scope.hasDataConsent || !this.session || this.session.status !== "recording" || this.disposed ? !1 : this.runtime.now() >= this.session.deadlineAt ? (this.finish("timeout", this.session.deadlineAt), !1) : !0;
  }
  onAlarm(name) {
    name === PRO_ALARM_NAME && this.enqueue(() => {
      this.checkDeadline(), this.flush();
    });
  }
  armDeadline() {
    this.deadlineTimer !== null && (clearTimeout(this.deadlineTimer), this.deadlineTimer = null);
    let session = this.session;
    !session || session.status !== "recording" || (this.alarmOperation = this.alarmOperation.then(async () => {
      this.session?.id !== session.id || this.session.status !== "recording" || await this.runtime.api.alarms?.create(PRO_ALARM_NAME, { when: session.deadlineAt });
    }).catch(() => this.limit("unsupported-contexts")), this.deadlineTimer = setTimeout(() => {
      this.deadlineTimer = null, this.checkDeadline(), this.flush();
    }, Math.max(0, session.deadlineAt - this.runtime.now())));
  }
  cancelDeadline() {
    this.deadlineTimer !== null && (clearTimeout(this.deadlineTimer), this.deadlineTimer = null), this.alarmOperation = this.alarmOperation.then(async () => {
      await this.runtime.api.alarms?.clear(PRO_ALARM_NAME);
    }).catch(() => {
    });
  }
  finish(reason, at2 = this.runtime.now()) {
    if (!this.session || this.session.status !== "recording") return;
    this.cookieCapture.stop();
    this.runtime.proCookieValues?.stop();
    this.runtime.proRequestValues?.stop();
    this.stopValueCapture();
    let ended = Math.max(this.session.startedAt, Math.min(this.session.deadlineAt, at2));
    for (let tabId of this.currentPages.keys()) this.closePage(tabId, ended);
    this.session.status = "stopped", this.session.stopReason = reason, this.session.stoppedAt = ended, this.requests.size > 0 && this.limit("navigation-gap"), this.requests.clear(), this.baselines.clear(), this.counterHistory.clear();
    for (let key2 of this.sizes.keys()) (key2.startsWith("request:") || key2.startsWith("baseline:") || key2.startsWith("history:")) && this.size(key2, 0);
    this.cancelDeadline(), this.mark();
  }
  enqueue(action) {
    if (!this.disposed) {
      if (this.hydrated) {
        action();
        return;
      }
      this.pending.length < MAX_PENDING ? this.pending.push(action) : this.pendingDropped = sat(this.pendingDropped);
    }
  }
  sameSite(safe) {
    return this.session?.siteKey === safe.siteKey;
  }
  pageFor(tabId) {
    let id4 = this.currentPages.get(tabId);
    return this.session?.pages.find((page) => page.id === id4);
  }
  pageById(id4) {
    return this.session?.pages.find((page) => page.id === id4);
  }
  closePage(tabId, at2 = this.runtime.now(), preserveCounterHistory = !1) {
    let page = this.pageFor(tabId);
    if (page) {
      page.endedAt = Math.max(page.startedAt, Math.min(this.session.deadlineAt, at2));
      for (let [key2, base] of this.baselines) base.pageId === page.id && (this.baselines.delete(key2), this.size("baseline:" + key2, 0));
    }
    if (this.currentPages.delete(tabId), !preserveCounterHistory) for (let [key2, history] of this.counterHistory) history.tabId === tabId && (this.counterHistory.delete(key2), this.size("history:" + key2, 0));
  }
  baseline(page, documentKey3, projection) {
    let key2 = page.id + "|" + documentKey3;
    if (!this.baselines.has(key2) && [...this.baselines.values()].filter((base2) => base2.pageId === page.id).length >= PRO_LIMITS.maxDocumentsPerPage) {
      this.limit("document-limit"), this.session.dropped.documents = sat(this.session.dropped.documents);
      return;
    }
    let counters = this.counterHistory.has(documentKey3) ? this.effectiveCounters(documentKey3) ?? [] : projection ? this.runtime.state.reports.get(documentKey3)?.counters ?? [] : [], browserCounters = this.counterHistory.get(documentKey3)?.browser?.counters ?? (projection ? this.runtime.state.metas.get(documentKey3)?.networkCounters ?? [] : []);
    if (!this.checkDeadline()) return;
    let base = {
      pageId: page.id,
      documentKey: documentKey3,
      counts: counters.map((c) => [counterKey(c.techniqueId, c.phase, c.signalCodes, c.apiOperation, c.extensionResource), c.count]),
      browserCounts: browserCounters.map((c) => [counterKey(c.techniqueId, c.phase, c.signalCodes), c.count]),
      vendors: projection?.vendors.map((v) => v.vendorId) ?? [],
      rtcKeys: projection ? this.runtime.rtc.vendorEvidence(documentKey3).observations.map((item) => item.occurrenceId) : []
    };
    this.size("baseline:" + key2, JSON.stringify(base).length * 2 + 128) && this.baselines.set(key2, base);
  }
  newPage(tabId, documentKey3, safe, at2, baseline) {
    let session = this.session;
    if (!session || session.status !== "recording") return null;
    if (this.runtime.resetNetworkProbeWindows([...this.runtime.state.bindings.values()].filter((binding) => binding.tabId === tabId).map((binding) => binding.documentKey), tabId, at2), this.closePage(tabId, at2, this.pageFor(tabId)?.documentKey === documentKey3), session.pages.length >= PRO_LIMITS.maxPages)
      return session.dropped.pages = sat(session.dropped.pages), this.limit("page-limit"), this.finish("limit", at2), null;
    let page = { id: "page-" + this.nextPage++, tabId, documentKey: documentKey3, url: safe.url, title: "", startedAt: at2, endedAt: null, reports: [], resources: [] };
    this.runtime.proCookieValues?.beginPage(page);
    this.runtime.proRequestValues?.beginPage(page);
    if (!this.size("page:" + page.id, 2048))
      return session.dropped.pages = sat(session.dropped.pages), null;
    if (session.pages.push(page), this.currentPages.set(tabId, page.id), baseline) for (let binding of this.runtime.state.bindings.values()) binding.tabId === tabId && this.belongsToPage(binding.documentKey, page) && this.baseline(page, binding.documentKey, this.runtime.projectionByKey(binding.documentKey));
    for (let request of this.requests.values()) request.pageId === null && request.tabId === tabId && (request.type === "main_frame" ? request.target.url === safe.url : request.documentKey === documentKey3) && (request.pageId = page.id, this.addRequest(page, request), request.endedAt !== null && request.ruleIds.length === 0 && (this.completeResource(request), this.dropRequest(request.id)));
    return this.mark(), this.cookieCapture.request(), page;
  }
  /** Sanitization happens synchronously, before any pre-hydration buffering. */
  onNavigation(details, route2 = !1) {
    if (!this.runtime.scope.hasDataConsent || this.hydrated && !this.checkDeadline() || !Number.isSafeInteger(details.tabId) || details.tabId < 0 || details.frameId !== 0 || typeof details.documentId != "string" || details.documentId.length > 128 || details.documentLifecycle === "prerender" || details.documentLifecycle === "cached") return;
    let safe = safeProUrl(details.url), tabId = details.tabId, documentKey3 = `${tabId}:0:${details.documentId}`, at2 = this.runtime.now();
    this.enqueue(() => {
      if (!this.checkDeadline() || !this.trackedTabs.has(tabId)) return;
      if (!safe || !this.sameSite(safe)) {
        this.closePage(tabId, at2), this.limit("navigation-gap"), this.mark();
        return;
      }
      let current = this.pageFor(tabId);
      !route2 && current?.documentKey === documentKey3 && current.url === safe.url || (this.newPage(tabId, documentKey3, safe, at2, route2), this.updateTitle(tabId, documentKey3, safe.url));
    });
  }
  async updateTitle(tabId, documentKey3, url) {
    if (!this.runtime.api.tabs.get) return;
    let tab = await this.runtime.api.tabs.get(tabId).catch(() => null), page = this.pageFor(tabId);
    !this.checkDeadline() || !page || page.documentKey !== documentKey3 || page.url !== url || safeProUrl(tab?.url)?.url !== url || (page.title = safeProTitle(tab?.title), this.mark());
  }
  onTabUpdated(tabId, tab) {
    if (!this.runtime.scope.hasDataConsent || this.hydrated && !this.checkDeadline()) return;
    let safe = safeProUrl(tab.url), title = safeProTitle(tab.title);
    this.enqueue(() => {
      let page = this.pageFor(tabId);
      this.checkDeadline() && page && safe && this.sameSite(safe) && page.url === safe.url && (page.title = title, this.mark());
    });
  }
  onTabCreated(tab) {
    if (!this.runtime.scope.hasDataConsent) return;
    let id4 = tab.id, opener = tab.openerTabId;
    this.enqueue(() => {
      if (!(!this.checkDeadline() || typeof id4 != "number" || typeof opener != "number" || !this.trackedTabs.has(opener) || !this.pageFor(opener))) {
        if (this.trackedTabs.size >= PRO_LIMITS.maxTabs) {
          this.limit("page-limit"), this.session.dropped.pages = sat(this.session.dropped.pages), this.mark();
          return;
        }
        this.trackedTabs.add(id4), this.mark();
      }
    });
  }
  onTabRemoved(tabId) {
    this.enqueue(() => {
      !this.checkDeadline() || !this.trackedTabs.has(tabId) || (this.closePage(tabId), this.trackedTabs.delete(tabId), this.trackedTabs.size === 0 && this.finish("tab-closed"), this.mark());
    });
  }
  onTabReplaced(added, removed) {
    this.enqueue(() => {
      !this.checkDeadline() || !this.trackedTabs.has(removed) || (this.closePage(removed), this.trackedTabs.delete(removed), this.trackedTabs.add(added), this.limit("navigation-gap"), this.mark());
    });
  }
  onPermissionsChanged() {
    this.cookieCapture.request();
    this.checkDeadline() && (this.limit("permission-limited"), this.rootAccess() || this.finish("access-revoked"), this.mark());
  }
  rootAccess() {
    if (!this.session || !this.runtime.scope.hasAnyHostAccess() || this.runtime.scope.getScopeMode() === "off") return !1;
    for (let pageId of this.currentPages.values()) {
      let page = this.pageById(pageId), safe = safeProUrl(page?.url), documentId2 = page?.documentKey.split(":").slice(2).join(":");
      if (page && safe && documentId2 && this.runtime.scope.inScope(safe.domain, page.tabId, documentId2, safe.scheme)) return !0;
    }
    return this.runtime.scope.isHostGrantedSync(this.session.domain, "https") || this.runtime.scope.isHostGrantedSync(this.session.domain, "http");
  }
  belongsToPage(documentKey3, page) {
    if (documentKey3 === page.documentKey) return !0;
    let bindings = [...this.runtime.state.bindings.values()].filter((b) => b.tabId === page.tabId && b.documentLifecycle !== "cached" && b.documentLifecycle !== "prerender"), cursor = bindings.find((b) => b.documentKey === documentKey3), seen = /* @__PURE__ */ new Set();
    for (; cursor && seen.size < 128; ) {
      if (cursor.documentKey === page.documentKey) return !0;
      if (seen.has(cursor.documentKey)) return !1;
      seen.add(cursor.documentKey), cursor = bindings.find((b) => b.documentId === cursor.parentDocumentId);
    }
    return !1;
  }
  afterEvent(event, before) {
    if (!this.hydrated || !this.checkDeadline()) return;
    if (event.type === "network:reset" || event.type === "scope:revoked") {
      let keys4 = event.type === "network:reset" ? [event.documentKey] : event.documentKeys;
      for (let key3 of keys4) {
        let history = this.counterHistory.get(key3);
        history?.browser && (delete history.browser, this.size("history:" + key3, JSON.stringify(history).length * 2 + 256));
        for (let base of this.baselines.values()) base.documentKey === key3 && (base.browserCounts = []);
      }
    }
    if (event.type === "ui:pause" || event.type === "scope:revoked") {
      let keys4 = event.type === "ui:pause" ? [event.documentKey] : event.documentKeys;
      for (let base of this.baselines.values()) keys4.includes(base.documentKey) && (base.rtcKeys = []);
    }
    if (event.type === "navigation:committed") {
      let page2 = this.pageFor(event.tabId);
      if (page2) for (let request of this.requests.values())
        request.tabId !== event.tabId || request.pageId !== null && request.pageId !== page2.id || request.type === "main_frame" || !request.documentKey || !this.belongsToPage(request.documentKey, page2) || (request.pageId === null && (request.pageId = page2.id, this.addRequest(page2, request)), request.endedAt !== null && (this.completeResource(request), this.addVendors(page2, request.documentKey, request.ruleIds, request.endedAt), this.dropRequest(request.id)), this.mark());
    }
    let key2 = null;
    if (event.type === "batch" ? key2 = event.sender.documentKey : "documentKey" in event ? key2 = event.documentKey : event.type === "navigation:committed" || event.type === "navigation:completed" || event.type === "navigation:route" ? key2 = `${event.tabId}:${event.frameId}:${event.documentId}` : event.type === "network:host" && (key2 = `${event.tabId}:${event.resourceType === "sub_frame" ? event.parentFrameId : event.frameId}:${event.resourceType === "sub_frame" ? event.parentDocumentId : event.documentId}`), !key2 || before.reports.get(key2) === this.runtime.state.reports.get(key2)) return;
    let report2 = this.runtime.state.reports.get(key2);
    if (!report2) return;
    let headerPeriod = event.type === "network:headers" && event.proPeriod?.sessionId === this.session?.id ? event.proPeriod : null, page = headerPeriod ? this.pageById(headerPeriod.pageId) : this.pageFor(report2.tabId);
    if (!page || !this.belongsToPage(key2, page)) return;
    if (event.type === "network:observed" && (event.at < page.startedAt || event.preVisitAt === page.startedAt)) {
      let baseKey = page.id + "|" + key2;
      this.baselines.has(baseKey) || this.baseline(page, key2, null);
      let base = this.baselines.get(baseKey);
      if (base) {
        let previous = new Map((before.metas.get(key2)?.networkCounters ?? []).map((c) => [counterKey(c.techniqueId, c.phase, c.signalCodes), c.count])), baseline = new Map(base.browserCounts);
        for (let counter of this.runtime.state.metas.get(key2)?.networkCounters ?? []) {
          let slot = counterKey(counter.techniqueId, counter.phase, counter.signalCodes);
          baseline.set(slot, sat(baseline.get(slot) ?? 0, Math.max(0, counter.count - (previous.get(slot) ?? 0))));
        }
        base.browserCounts = [...baseline], this.size("baseline:" + baseKey, JSON.stringify(base).length * 2 + 128);
      }
    }
    let localAttempt = event.type === "network:observed" && event.local && event.at >= page.startedAt && event.preVisitAt !== page.startedAt;
    this.updateReport(
      page,
      key2,
      localAttempt ? event.localPort : void 0,
      event.type === "network:limited" || localAttempt && event.localPort === void 0,
      event.type === "network:headers" && event.proPeriod && event.proPeriod.sessionId === this.session?.id && event.proPeriod.pageId === page.id ? event.headers : void 0
    );
  }
  updateReport(page, key2, localPort, portsLimited = !1, headerDelta) {
    let baseKey = page.id + "|" + key2, baseline = this.baselines.get(baseKey);
    if (baseline || (this.baseline(page, key2, null), baseline = this.baselines.get(baseKey)), !baseline || !this.checkDeadline() || portsLimited && !baseline.localPortsIncomplete && (baseline.localPortsIncomplete = !0, !this.size("baseline:" + baseKey, JSON.stringify(baseline).length * 2 + 128)))
      return null;
    let retainedCounters = this.effectiveCounters(key2);
    if (!this.checkDeadline()) return null;
    let retainedBrowser = this.counterHistory.get(key2)?.browser?.counters, index = page.reports.findIndex((report2) => report2.documentKey === key2), previousReport = index >= 0 ? page.reports[index] : void 0, previousCount = previousReport?.techniques.find((item) => item.techniqueId === "DET-060" && item.evidenceSource === "browser-network" && item.integrity === "browser-observed")?.count ?? 0, saturatedLocal = (retainedBrowser ?? this.runtime.state.metas.get(key2)?.networkCounters ?? []).some((counter) => counter.techniqueId === "DET-060" && counter.count === 2147483647), projection = this.runtime.recordingProjection(
      key2,
      new Map(baseline.counts),
      page.startedAt,
      retainedCounters,
      new Map(baseline.browserCounts),
      retainedBrowser,
      sat(previousCount, localPort === void 0 ? 0 : 1)
    );
    if (!projection) return null;
    let rtc = this.runtime.rtc.vendorEvidence(key2), newRtcVendors = rtc.observations.filter((item) => !baseline.rtcKeys.includes(item.occurrenceId)).map((item) => item.vendor), snapshot = { ...projection, vendors: mergeVendorSummaries(
      projection.vendors.filter((v) => v.evidenceSource === "browser-network" && !baseline.vendors.includes(v.vendorId)),
      newRtcVendors
    ) }, headers = headerDelta ? mergeResponseHeaders(previousReport?.responseHeaders, headerDelta) : previousReport?.responseHeaders;
    if (headers && (snapshot = attachResponseHeaders(snapshot, headers), headers.entries.length)) {
      let previousSince = previousReport?.observedSince ?? Math.max(page.startedAt, Math.min(page.endedAt ?? this.runtime.now(), this.runtime.now()));
      snapshot.observedSince = snapshot.observedSince === null ? previousSince : Math.min(snapshot.observedSince, previousSince);
    }
    newRtcVendors.length > 0 && rtc.observedAt !== null && (snapshot.observedSince ??= Math.max(page.startedAt, rtc.observedAt));
    let localCount = snapshot.techniques.find((item) => item.techniqueId === "DET-060" && item.evidenceSource === "browser-network" && item.integrity === "browser-observed")?.count ?? 0;
    if (localCount > 0) {
      let previousPorts = previousReport?.requestedLocalPorts, incomplete = saturatedLocal || baseline.localPortsIncomplete === !0 || localCount > previousCount + (localPort === void 0 ? 0 : 1) || previousPorts === void 0 && previousCount > 0;
      localPort !== void 0 ? snapshot.requestedLocalPorts = addRequestedLocalPort(
        previousPorts,
        localPort,
        incomplete
      ) : previousPorts ? snapshot.requestedLocalPorts = { ports: previousPorts.ports.slice(), truncated: previousPorts.truncated || incomplete } : snapshot.requestedLocalPorts = { ports: [], truncated: !0 };
    }
    if (index >= 0) {
      if (snapshot.vendors = mergeVendorSummaries(snapshot.vendors, page.reports[index].vendors), snapshot.vendors.length > 0 && (snapshot.observedSince ??= page.reports[index].observedSince), !this.size("report:" + baseKey, JSON.stringify(snapshot).length * 2 + 256)) return null;
      page.reports[index] = snapshot;
    } else if (page.reports.length < PRO_LIMITS.maxDocumentsPerPage) {
      if (!this.size("report:" + baseKey, JSON.stringify(snapshot).length * 2 + 256)) return null;
      page.reports.push(snapshot);
    } else
      return this.limit("document-limit"), this.session.dropped.documents = sat(this.session.dropped.documents), this.baselines.delete(baseKey), this.size("baseline:" + baseKey, 0), null;
    return this.mark(), snapshot;
  }
  onRequest(details, phase) {
    const carriedRules = carriedVendorRuleIds(this.runtime, this.vendorRedirects, details, phase, this);
    if (!this.runtime.scope.hasDataConsent || this.hydrated && !this.checkDeadline() || !Number.isSafeInteger(details.tabId) || details.tabId < 0 || !TYPES.has(details.type) || typeof details.requestId != "string" || !/^[a-z0-9_.:-]{1,128}$/i.test(details.requestId)) return;
    let rawTarget = safeProUrl(details.url);
    if (!rawTarget) return;
    let target = safeProResourceUrl(rawTarget, this.session?.siteKey ?? null), tabId = details.tabId, id4 = details.requestId, type = details.type, at2 = this.runtime.now(), status = typeof details.statusCode == "number" && Number.isInteger(details.statusCode) && details.statusCode >= 100 && details.statusCode <= 599 ? details.statusCode : null, rules2 = phase === "completed" && status !== null && (status >= 200 && status < 300 || status === 304) ? matchVendorResource(details.url, type, at2) : [], documentKey3 = typeof details.documentId == "string" ? `${tabId}:${details.frameId}:${details.documentId}` : null, scheme = details.url.startsWith("wss:") ? "wss" : details.url.startsWith("ws:") ? "ws" : target.scheme, granted = this.runtime.scope.isHostGrantedSync(toAsciiHost(details.url) ?? "", scheme);
    this.enqueue(() => {
      if (!(!this.checkDeadline() || !granted || !this.trackedTabs.has(tabId))) {
        if (phase === "before") {
          let current = this.pageFor(tabId), pendingNavigation = [...this.requests.values()].some((r) => r.tabId === tabId && r.type === "main_frame" && r.pageId === null && this.sameSite(r.target));
          if ((type === "main_frame" ? !this.sameSite(target) : !current && !pendingNavigation) || this.requests.has(id4)) return;
          if (++this.events > MAX_EVENTS) {
            this.session.dropped.events = sat(this.session.dropped.events), this.limit("event-limit"), this.finish("limit");
            return;
          }
          if (this.requests.size >= MAX_INFLIGHT) {
            this.limit("event-limit"), this.session.dropped.events = sat(this.session.dropped.events), this.mark();
            return;
          }
          let belongs = current && (!documentKey3 || this.belongsToPage(documentKey3, current)), request = { id: id4, tabId, pageId: type === "main_frame" || !belongs ? null : current.id, resourceId: null, documentKey: documentKey3, ruleIds: [], target, type, at: at2, completed: 0, failed: 0, redirects: 0, status: null, endedAt: null };
          if (!this.size("request:" + id4, JSON.stringify(request).length * 2 + 256)) {
            this.session.dropped.events = sat(this.session.dropped.events);
            return;
          }
          this.requests.set(id4, request), request.pageId && this.addRequest(current, request);
        } else {
          let request = this.requests.get(id4);
          if (!request || request.target.url !== target.url || (request.completed = phase === "completed" ? 1 : 0, request.failed = phase === "error" ? 1 : 0, request.redirects = phase === "redirect" ? 1 : 0, request.endedAt = at2, request.status = status, request.ruleIds = [...new Set([...rules2.map((rule) => rule.ruleId), ...carriedRules])], !this.size("request:" + id4, JSON.stringify(request).length * 2 + 256))) return;
          let page = this.pageById(request.pageId);
          if (page)
            this.completeResource(request), request.ruleIds.length && documentKey3 === request.documentKey && this.addVendors(page, documentKey3, request.ruleIds, at2), this.dropRequest(id4);
          else if (request.type === "main_frame" && (phase === "error" || phase === "redirect")) {
            let origin = this.pageFor(tabId);
            origin ? (request.pageId = origin.id, this.addRequest(origin, request), this.completeResource(request)) : this.limit("navigation-gap"), this.dropRequest(id4);
          }
        }
        this.mark();
      }
    });
  }
  addRequest(page, request) {
    let session = this.session, resource2 = page.resources.find((r) => r.url === request.target.url && r.type === request.type);
    if (!resource2) {
      if (page.resources.length >= PRO_LIMITS.maxResourcesPerPage || this.nextResource > PRO_LIMITS.maxResources) {
        this.limit("resource-limit"), session.dropped.resources = sat(session.dropped.resources);
        return;
      }
      if (resource2 = {
        id: "resource-" + this.nextResource++,
        url: request.target.url,
        domain: request.target.domain,
        relation: request.target.siteKey === session.siteKey ? "same-site" : registrableDomain(request.target.domain) ? "cross-site" : "unknown",
        type: request.type,
        requestCount: 0,
        completedCount: 0,
        failedCount: 0,
        redirectCount: 0,
        firstSeenAt: request.at,
        lastSeenAt: request.at,
        statusCodes: [],
        durationTotalMs: 0
      }, !this.size("resource:" + resource2.id, 1024 + 2 * (resource2.url.length + resource2.domain.length))) {
        session.dropped.resources = sat(session.dropped.resources);
        return;
      }
      page.resources.push(resource2);
    }
    resource2.requestCount = sat(resource2.requestCount), resource2.firstSeenAt = Math.min(resource2.firstSeenAt, request.at), resource2.lastSeenAt = Math.max(resource2.lastSeenAt, request.at), request.resourceId = resource2.id;
  }
  completeResource(request) {
    let resource2 = this.pageById(request.pageId)?.resources.find((r) => r.id === request.resourceId);
    resource2 && (resource2.completedCount = sat(resource2.completedCount, request.completed), resource2.failedCount = sat(resource2.failedCount, request.failed), resource2.redirectCount = sat(resource2.redirectCount, request.redirects), resource2.lastSeenAt = Math.max(resource2.lastSeenAt, request.endedAt ?? request.at), resource2.durationTotalMs = sat(resource2.durationTotalMs, Math.max(0, (request.endedAt ?? request.at) - request.at)), request.status !== null && !resource2.statusCodes.includes(request.status) && resource2.statusCodes.length < 16 && resource2.statusCodes.push(request.status));
  }
  addVendors(page, documentKey3, ruleIds, at2) {
    if (ruleIds.length === 0 || documentKey3 === null || !this.belongsToPage(documentKey3, page)) return;
    let meta = this.runtime.state.metas.get(documentKey3);
    if (!meta || meta.paused || meta.revoked || meta.accessGranted === !1) return;
    let report2 = this.updateReport(page, documentKey3);
    if (report2) {
      for (let id4 of ruleIds) {
        let rule = lookupVendorResourceRule(id4, this.runtime.now());
        rule && (report2.vendors = mergeVendorSummaries(report2.vendors, [{
          vendorId: rule.vendorId,
          vendorConfidence: "documented-resource",
          ruleIds: [rule.ruleId],
          evidenceSource: "browser-network",
          integrity: "browser-observed"
        }]));
      }
      report2.vendors.length > 0 && (report2.observedSince ??= Math.max(page.startedAt, at2)), this.size("report:" + page.id + "|" + documentKey3, JSON.stringify(report2).length * 2 + 256);
    }
  }
  /** Called before Light removes its document model. This affects only an active recording's current documents. */
  onLightClear(documentKey3) {
    if (!this.checkDeadline()) return;
    for (let base of this.baselines.values()) base.documentKey === documentKey3 && (base.rtcKeys = []);
    let report2 = this.runtime.state.reports.get(documentKey3), meta = this.runtime.state.metas.get(documentKey3);
    if (!report2 || !meta) return;
    let page = this.pageFor(report2.tabId);
    if (!page || !this.belongsToPage(documentKey3, page) || !this.baselines.has(page.id + "|" + documentKey3) && !page.reports.some((item) => item.documentKey === documentKey3)) return;
    let previous = this.counterHistory.get(documentKey3);
    if (!previous && [...this.counterHistory.values()].filter((item) => item.tabId === report2.tabId).length >= PRO_LIMITS.maxDocumentsPerPage) {
      this.limit("document-limit"), this.session.dropped.documents = sat(this.session.dropped.documents), this.finish("limit");
      return;
    }
    let history = previous ? mergeProCounterHistory(previous, report2, meta) : createProCounterHistory(report2, meta);
    this.size("history:" + documentKey3, JSON.stringify(history).length * 2 + 256) && this.counterHistory.set(documentKey3, history), this.mark();
  }
  effectiveCounters(documentKey3) {
    let previous = this.counterHistory.get(documentKey3);
    if (!previous) return;
    let report2 = this.runtime.state.reports.get(documentKey3), meta = this.runtime.state.metas.get(documentKey3);
    if (!report2 || !meta) return previous.counters;
    let history = mergeProCounterHistory(previous, report2, meta);
    return this.size("history:" + documentKey3, JSON.stringify(history).length * 2 + 256) ? (this.counterHistory.set(documentKey3, history), history.limited && this.limit("event-limit"), history.counters) : previous.counters;
  }
  mark() {
    this.revision++, !(this.disposed || this.persistTimer !== null) && (this.persistTimer = setTimeout(() => {
      this.persistTimer = null, this.flush();
    }, PERSIST_MS));
  }
  /** Per-entry estimates bound admission synchronously; no full-session serialization on hot events. */
  size(key2, bytes) {
    let previous = this.sizes.get(key2) ?? 0;
    return this.estimatedBytes + bytes - previous > PRO_LIMITS.maxBytes ? (this.limit("resource-limit"), this.finish("limit"), !1) : (this.estimatedBytes += bytes - previous, bytes === 0 ? this.sizes.delete(key2) : this.sizes.set(key2, bytes), !0);
  }
  dropRequest(id4) {
    this.requests.delete(id4), this.size("request:" + id4, 0);
  }
  async flush() {
    if (this.persistTimer !== null && (clearTimeout(this.persistTimer), this.persistTimer = null), this.write)
      return await this.write, this.persistedRevision < this.revision ? this.flush() : void 0;
    if (this.persistedRevision === this.revision) return;
    let revision = this.revision, stored = this.session ? { version: 1, session: this.session, trackedTabs: [...this.trackedTabs], currentPages: [...this.currentPages], baselines: [...this.baselines.values()], requests: [...this.requests.values()], counterHistory: [...this.counterHistory.values()], events: this.events } : null;
    if (stored && JSON.stringify(stored).length * 2 > PRO_LIMITS.maxBytes) {
      this.limit("resource-limit"), this.finish("limit");
      let bytes = JSON.stringify(stored).length * 2;
      for (; this.session.pages.length && bytes > PRO_LIMITS.maxBytes; ) {
        let page = this.session.pages.pop();
        bytes -= JSON.stringify(page).length * 2, this.session.dropped.pages = sat(this.session.dropped.pages), this.session.dropped.resources = sat(this.session.dropped.resources, page.resources.length), this.session.dropped.documents = sat(this.session.dropped.documents, page.reports.length);
      }
      stored = { ...stored, currentPages: [], baselines: [], requests: [], counterHistory: [] };
    }
    let snapshot = stored === null ? null : structuredClone(stored);
    this.write = (async () => {
      try {
        snapshot === null ? await this.runtime.api.storage.session.remove(PRO_STORAGE_KEY) : await this.runtime.api.storage.session.set({ [PRO_STORAGE_KEY]: snapshot }), this.persistedRevision = revision;
      } catch {
        if (this.limit("storage-error"), this.finish("storage-error"), this.persistedRevision = this.revision, this.session) try {
          await this.runtime.api.storage.session.set({ [PRO_STORAGE_KEY]: { version: 1, session: structuredClone(this.session), trackedTabs: [], currentPages: [], baselines: [], requests: [], counterHistory: [], events: this.events } });
        } catch {
        }
      }
    })();
    try {
      await this.write;
    } finally {
      this.write = null;
    }
  }
  dispose() {
    this.cookieCapture.stop();
    this.runtime.proCookieValues?.stop();
    this.runtime.proRequestValues?.stop();
    this.stopValueCapture();
    this.disposed = !0, this.persistTimer !== null && (clearTimeout(this.persistTimer), this.persistTimer = null), this.deadlineTimer !== null && (clearTimeout(this.deadlineTimer), this.deadlineTimer = null);
  }
};

// packages/background/src/local-probe-window.ts
var LOCAL_PROBE_LIMITS = Object.freeze({ documents: 32, targets: 8, ports: 16, requests: 128 }), LocalProbeWindow = class {
  documents = /* @__PURE__ */ new Map();
  clear(documentKey3) {
    documentKey3 === void 0 ? this.documents.clear() : this.documents.delete(documentKey3);
  }
  retain(current) {
    for (let key2 of this.documents.keys()) current.has(key2) || this.documents.delete(key2);
  }
  get size() {
    return this.documents.size;
  }
  expire(at2) {
    for (let [key2, state] of this.documents) {
      if (at2 < state.at || at2 - state.at >= 1e4) {
        this.documents.delete(key2);
        continue;
      }
      for (let [id4, seen] of state.requests) at2 - seen >= 1e4 && state.requests.delete(id4);
      for (let [host2, ports] of state.targets) {
        for (let [port, seen] of ports) at2 - seen >= 1e4 && ports.delete(port);
        ports.size === 0 && state.targets.delete(host2);
      }
    }
  }
  get nextExpiry() {
    let next = 1 / 0;
    for (let state of this.documents.values()) {
      next = Math.min(next, state.at + 1e4);
      for (let seen of state.requests.values()) next = Math.min(next, seen + 1e4);
      for (let ports of state.targets.values()) for (let seen of ports.values()) next = Math.min(next, seen + 1e4);
    }
    return next;
  }
  record(documentKey3, requestId, target, port, at2, now = at2) {
    let limited = !1, evictedDocumentKey;
    if (this.expire(now), at2 > now || now - at2 >= 1e4) return { duplicate: !1, multiPort: !1, limited: !0 };
    let state = this.documents.get(documentKey3);
    if (!state) {
      if (this.documents.size >= LOCAL_PROBE_LIMITS.documents) {
        let oldest = null, oldestAt = 1 / 0;
        for (let [key2, entry] of this.documents) entry.at < oldestAt && (oldest = key2, oldestAt = entry.at);
        oldest !== null && (this.documents.delete(oldest), evictedDocumentKey = oldest), limited = !0;
      }
      state = { at: at2, requests: /* @__PURE__ */ new Map(), targets: /* @__PURE__ */ new Map() }, this.documents.set(documentKey3, state);
    }
    state.at = Math.max(state.at, at2);
    for (let [id4, seen] of state.requests) now - seen >= 1e4 && state.requests.delete(id4);
    if (state.requests.has(requestId)) return { duplicate: !0, multiPort: !1, limited };
    if (state.requests.size >= LOCAL_PROBE_LIMITS.requests)
      return { duplicate: !0, multiPort: !1, limited: !0 };
    state.requests.set(requestId, at2);
    for (let [host2, ports2] of state.targets) {
      for (let [value, seen] of ports2) now - seen >= 1e4 && ports2.delete(value);
      ports2.size === 0 && state.targets.delete(host2);
    }
    let eviction = evictedDocumentKey === void 0 ? {} : { evictedDocumentKey };
    if (target === null || !Number.isInteger(port) || port < 1 || port > 65535) return { duplicate: !1, multiPort: !1, limited, ...eviction };
    let ports = state.targets.get(target);
    if (!ports) {
      if (state.targets.size >= LOCAL_PROBE_LIMITS.targets) return { duplicate: !1, multiPort: !1, limited: !0 };
      ports = /* @__PURE__ */ new Map(), state.targets.set(target, ports);
    }
    if (!ports.has(port) && ports.size >= LOCAL_PROBE_LIMITS.ports) {
      let oldest = 0, oldestAt = 1 / 0;
      for (let [value, seen] of ports) seen < oldestAt && (oldest = value, oldestAt = seen);
      ports.delete(oldest), limited = !0;
    }
    return ports.set(port, Math.max(ports.get(port) ?? at2, at2)), { duplicate: !1, multiPort: ports.size >= 4, limited, ...eviction };
  }
};

// packages/background/src/dns-probe-window.ts
var DNS_PROBE_LIMITS = Object.freeze({ documents: 32, domains: 8, names: 64, requests: 128, hashes: 64 });
function isDnsProbeHostname(host2, domain) {
  if (host2 === domain || !host2.endsWith("." + domain)) return !1;
  let label = host2.slice(0, host2.indexOf("."));
  return label.length >= 8 && label.length <= 63 && /^[a-z0-9]+$/.test(label) && /[a-z]/.test(label) && /[0-9]/.test(label) && new Set(label).size >= 4;
}
var DnsProbeWindow = class {
  documents = /* @__PURE__ */ new Map();
  get size() {
    return this.documents.size;
  }
  clear(documentKey3) {
    documentKey3 === void 0 ? this.documents.clear() : this.documents.delete(documentKey3);
  }
  retain(keys4) {
    for (let key2 of this.documents.keys()) keys4.has(key2) || this.documents.delete(key2);
  }
  expire(now) {
    for (let [key2, document] of this.documents) {
      if (now < document.at || now - document.at >= 1e4) {
        this.documents.delete(key2);
        continue;
      }
      for (let [request, at2] of document.requests) now - at2 >= 1e4 && document.requests.delete(request);
      for (let [domain, window] of document.domains) {
        for (let [token4, entry] of window.names) now - entry.at >= 1e4 && window.names.delete(token4);
        window.names.size || document.domains.delete(domain);
      }
    }
  }
  get nextExpiry() {
    let next = 1 / 0;
    for (let document of this.documents.values()) {
      next = Math.min(next, document.at + 1e4);
      for (let at2 of document.requests.values()) next = Math.min(next, at2 + 1e4);
      for (let window of document.domains.values()) for (let entry of window.names.values()) next = Math.min(next, entry.at + 1e4);
    }
    return next;
  }
  record(documentKey3, requestId, domain, token4, at2, now = at2) {
    if (this.expire(now), at2 > now || now - at2 >= 1e4) return { count: 0, limited: !0 };
    let evictedDocumentKey, document = this.documents.get(documentKey3);
    if (!document) {
      if (this.documents.size >= DNS_PROBE_LIMITS.documents) {
        let oldestAt = 1 / 0;
        for (let [key2, entry2] of this.documents) entry2.at < oldestAt && (oldestAt = entry2.at, evictedDocumentKey = key2);
        evictedDocumentKey !== void 0 && this.documents.delete(evictedDocumentKey);
      }
      document = { at: at2, requests: /* @__PURE__ */ new Map(), domains: /* @__PURE__ */ new Map() }, this.documents.set(documentKey3, document);
    }
    let eviction = evictedDocumentKey === void 0 ? {} : { evictedDocumentKey };
    if (document.at = Math.max(document.at, at2), document.requests.has(requestId)) return { count: 0, limited: !1, ...eviction };
    if (document.requests.size >= DNS_PROBE_LIMITS.requests) return { count: 0, limited: !0, ...eviction };
    document.requests.set(requestId, at2);
    let window = document.domains.get(domain);
    if (!window) {
      if (document.domains.size >= DNS_PROBE_LIMITS.domains) return { count: 0, limited: !0, ...eviction };
      window = { names: /* @__PURE__ */ new Map() }, document.domains.set(domain, window);
    }
    let entry = window.names.get(token4);
    if (entry) entry.at = Math.max(entry.at, at2);
    else {
      if (window.names.size >= DNS_PROBE_LIMITS.names) return { count: 0, limited: !0, ...eviction };
      window.names.set(token4, { at: at2, reported: !1 });
    }
    let count3 = 0;
    if (window.names.size >= 8) for (let name of window.names.values())
      name.reported || (name.reported = !0, count3++);
    return { count: count3, limited: evictedDocumentKey !== void 0, ...eviction };
  }
};

// packages/background/src/network-attempts.ts
var NETWORK_ATTEMPT_FILTER = { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] }, NETWORK_PENDING_LIMIT = 128, NETWORK_PENDING_MS = 2e3, NetworkAttemptObserver = class {
  constructor(runtime) {
    this.runtime = runtime;
  }
  runtime;
  window = new LocalProbeWindow();
  dnsWindow = new DnsProbeWindow();
  hashing = /* @__PURE__ */ new Set();
  hashSalt = null;
  pending = [];
  timer = null;
  timerAt = 1 / 0;
  flushing = !1;
  startupLoss = !1;
  resets = /* @__PURE__ */ new Map();
  /** Identity-only loss markers can be attached if the exact pending document later commits. */
  losses = /* @__PURE__ */ new Map();
  resetWindows(documentKeys, tabId, cutoffAt = this.runtime.now()) {
    if (documentKeys === void 0) this.window.clear();
    else for (let key2 of documentKeys) this.window.clear(key2);
    if (documentKeys === void 0) this.dnsWindow.clear();
    else for (let key2 of documentKeys) this.dnsWindow.clear(key2);
    let tabs = tabId === void 0 ? new Set(documentKeys?.map((key2) => Number(key2.split(":")[0])) ?? [...this.runtime.state.tabs.keys()]) : /* @__PURE__ */ new Set([tabId]);
    for (let id4 of tabs)
      this.resets.size >= 32 && this.resets.delete(this.resets.keys().next().value), this.resets.set(id4, cutoffAt);
    for (let event of this.pending) tabs.has(event.tabId) && (event.preVisitAt = cutoffAt);
  }
  clear(documentKey3) {
    this.window.clear(documentKey3), this.dnsWindow.clear(documentKey3), documentKey3 === void 0 ? this.losses.clear() : this.losses.delete(documentKey3), this.pending = documentKey3 === void 0 ? [] : this.pending.filter((event) => event.documentKey !== documentKey3), documentKey3 === void 0 && (this.startupLoss = !1, this.resets.clear(), this.timer !== null && clearTimeout(this.timer), this.timer = null, this.timerAt = 1 / 0);
  }
  onBeforeRequest(details) {
    if (this.runtime.canCollectBrowserData())
      try {
        if (typeof details.url != "string" || details.url.length > 65536 || this.runtime.hydrationComplete && (!this.runtime.scope.accessReady || !this.runtime.scope.hasAnyHostAccess())) return;
        let url = new URL(details.url), scheme = url.protocol.slice(0, -1);
        if (scheme !== "http" && scheme !== "https" && scheme !== "ws" && scheme !== "wss") return;
        let host2 = toAsciiHost(url.hostname);
        if (host2 === null) return;
        let category = redactHost(host2), local = category.kind === "ip" && category.value !== "public" || category.kind === "local" && category.value !== "single-label", websocket = details.type === "websocket" && (scheme === "ws" || scheme === "wss"), dnsDomain = !local && !websocket && (scheme === "http" || scheme === "https") && details.type === "xmlhttprequest" && category.kind === "registrable" && isDnsProbeHostname(host2, category.value) ? category.value : null;
        if (!local && !websocket && dnsDomain === null) return;
        if (!Number.isInteger(details.tabId) || details.tabId < 0 || !Number.isInteger(details.frameId) || details.frameId < 0 || typeof details.documentId != "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(details.documentId) || typeof details.requestId != "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(details.requestId)) {
          if (this.runtime.hydrationComplete && this.runtime.scope.getScopeMode() === "all-sites" && this.runtime.scope.hasBroadNetworkAccess()) {
            let source2 = new URL(details.initiator ?? "");
            (source2.protocol === "http:" || source2.protocol === "https:") && this.runtime.dispatch({ type: "network:unattributed", at: this.runtime.now() });
          }
          return;
        }
        if (details.documentLifecycle !== void 0 && details.documentLifecycle !== "active") return;
        let source = new URL(details.initiator ?? ""), origin = new URL(source.origin), sourceHost = toAsciiHost(origin.hostname);
        if (sourceHost === null || origin.protocol !== "http:" && origin.protocol !== "https:") return;
        let event = {
          documentKey: makeDocumentKey(details.tabId, details.frameId, details.documentId),
          tabId: details.tabId,
          documentId: details.documentId,
          requestId: details.requestId,
          host: dnsDomain ?? host2,
          port: dnsDomain === null ? url.port ? Number(url.port) : scheme === "https" || scheme === "wss" ? 443 : 80 : 0,
          scheme,
          sourceHost,
          sourceScheme: origin.protocol === "https:" ? "https" : "http",
          websocket,
          local,
          at: this.runtime.now(),
          startup: !this.runtime.hydrationComplete,
          generation: this.runtime.scope.accessGeneration,
          ...dnsDomain === null ? {} : { dnsDomain, dnsTargetGranted: this.runtime.scope.isHostGrantedSync(host2, scheme) }
        }, meta = this.runtime.state.metas.get(event.documentKey);
        if (meta?.paused || meta?.revoked || (!event.startup || dnsDomain !== null) && !this.allowed(event)) return;
        let authorized = this.runtime.hydrationComplete && this.runtime.canObserveNetworkDocument(event.documentKey);
        if (authorized && dnsDomain === null) this.accept(event);
        else {
          if (this.runtime.hydrationComplete && !authorized && !this.waitingForDocument(event)) return;
          if (dnsDomain !== null && this.hashing.size >= DNS_PROBE_LIMITS.hashes) {
            this.lost(event);
            return;
          }
          this.pending.length >= NETWORK_PENDING_LIMIT && this.lost(this.pending.shift()), this.pending.push(event), dnsDomain !== null && this.hashDnsHost(event, host2);
        }
        this.schedule();
      } catch {
      }
  }
  allowed(event) {
    let scope = this.runtime.scope;
    return scope.accessReady && (!event.startup || scope.getScopeMode() === "all-sites" && scope.hasBroadNetworkAccess()) && (event.startup || event.generation === scope.accessGeneration) && scope.inScope(event.sourceHost, event.tabId, event.documentId, event.sourceScheme) && scope.isHostGrantedSync(event.sourceHost, event.sourceScheme) && (event.dnsDomain === void 0 ? scope.isHostGrantedSync(event.host, event.scheme) : event.dnsTargetGranted === !0);
  }
  hashDnsHost(event, host2) {
    this.hashing.add(event);
    let input;
    try {
      let salt = this.hashSalt ??= crypto.getRandomValues(new Uint8Array(16)), encoded = new TextEncoder().encode(host2);
      input = new Uint8Array(salt.length + encoded.length), input.set(salt), input.set(encoded, salt.length), encoded.fill(0);
    } catch {
      this.hashing.delete(event), this.pending = this.pending.filter((pending) => pending !== event), this.lost(event);
      return;
    }
    (async () => {
      try {
        let pendingDigest = crypto.subtle.digest("SHA-256", input);
        input.fill(0);
        let digest = await pendingDigest;
        if (!this.pending.includes(event)) return;
        event.dnsToken = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join(""), this.flush();
      } catch {
        this.pending.includes(event) && (this.pending = this.pending.filter((pending) => pending !== event), this.lost(event));
      } finally {
        input.fill(0), this.hashing.delete(event), this.schedule();
      }
    })();
  }
  waitingForDocument(event) {
    let meta = this.runtime.state.metas.get(event.documentKey);
    return meta ? meta.paused || meta.revoked ? !1 : [...this.runtime.state.bindings.values()].some((binding) => binding.documentKey === event.documentKey && binding.originPending === !0 && (binding.documentLifecycle === null || binding.documentLifecycle === "active")) : !0;
  }
  accept(event) {
    let resetAt = this.resets.get(event.tabId);
    if (event.dnsDomain !== void 0) {
      if (!event.dnsToken || event.preVisitAt !== void 0 || resetAt !== void 0 && event.at < resetAt) return;
      let result2 = this.dnsWindow.record(event.documentKey, event.requestId, event.dnsDomain, event.dnsToken, event.at, this.runtime.now());
      result2.evictedDocumentKey && this.runtime.canObserveNetworkDocument(result2.evictedDocumentKey) && this.runtime.dispatch({ type: "network:limited", documentKey: result2.evictedDocumentKey, at: this.runtime.now() }), result2.count > 0 ? this.runtime.dispatch({
        type: "network:observed",
        documentKey: event.documentKey,
        websocket: !1,
        local: !1,
        multiPort: !1,
        dnsUnique: result2.count,
        limited: result2.limited,
        epoch: this.runtime.state.metas.get(event.documentKey)?.networkCounterEpoch ?? crypto.randomUUID(),
        at: event.at
      }) : result2.limited && this.runtime.dispatch({ type: "network:limited", documentKey: event.documentKey, at: this.runtime.now() });
      return;
    }
    let result = this.window.record(event.documentKey, event.requestId, event.local && event.preVisitAt === void 0 && (resetAt === void 0 || event.at >= resetAt) ? event.host : null, event.port, event.at, this.runtime.now());
    if (result.evictedDocumentKey && this.runtime.canObserveNetworkDocument(result.evictedDocumentKey) && this.runtime.dispatch({ type: "network:limited", documentKey: result.evictedDocumentKey, at: this.runtime.now() }), result.duplicate) {
      result.limited && this.runtime.dispatch({ type: "network:limited", documentKey: event.documentKey, at: this.runtime.now() });
      return;
    }
    this.runtime.dispatch({
      type: "network:observed",
      documentKey: event.documentKey,
      websocket: event.websocket,
      local: event.local,
      multiPort: result.multiPort,
      limited: result.limited,
      ...event.local ? { localPort: event.port } : {},
      epoch: this.runtime.state.metas.get(event.documentKey)?.networkCounterEpoch ?? crypto.randomUUID(),
      ...event.preVisitAt === void 0 ? {} : { preVisitAt: event.preVisitAt },
      at: event.at
    });
  }
  lost(event) {
    if (!this.runtime.hydrationComplete) {
      event.startup && (this.startupLoss = !0);
      return;
    }
    this.allowed(event) && (this.runtime.canObserveNetworkDocument(event.documentKey) ? this.runtime.dispatch({ type: "network:limited", documentKey: event.documentKey, at: this.runtime.now() }) : (this.losses.size >= NETWORK_PENDING_LIMIT && this.losses.delete(this.losses.keys().next().value), this.losses.set(event.documentKey, this.runtime.now())), this.runtime.dispatch({ type: "network:unattributed", at: this.runtime.now() }));
  }
  flush() {
    if (!this.flushing) {
      this.flushing = !0;
      try {
        let now = this.runtime.now();
        this.window.expire(now), this.dnsWindow.expire(now);
        for (let [tabId, at2] of this.resets) (now < at2 || now - at2 >= 1e4) && this.resets.delete(tabId);
        for (let [key2, at2] of this.losses)
          now < at2 || now - at2 >= 1e4 ? this.losses.delete(key2) : this.runtime.canObserveNetworkDocument(key2) && (this.losses.delete(key2), this.runtime.dispatch({ type: "network:limited", documentKey: key2, at: now }));
        let pending = this.pending;
        this.pending = [];
        for (let event of pending) {
          if (now < event.at || now - event.at >= NETWORK_PENDING_MS) {
            this.lost(event);
            continue;
          }
          if (!this.runtime.hydrationComplete) {
            this.pending.push(event);
            continue;
          }
          this.allowed(event) && (this.runtime.canObserveNetworkDocument(event.documentKey) ? event.dnsDomain !== void 0 && event.dnsToken === void 0 ? this.pending.push(event) : this.accept(event) : this.waitingForDocument(event) && this.pending.push(event));
        }
        if (this.runtime.hydrationComplete && this.startupLoss && (this.startupLoss = !1, this.runtime.scope.getScopeMode() === "all-sites" && this.runtime.scope.hasBroadNetworkAccess())) {
          this.runtime.dispatch({ type: "network:unattributed", at: now });
          for (let key2 of this.runtime.state.reports.keys()) this.runtime.canObserveNetworkDocument(key2) && this.runtime.dispatch({ type: "network:limited", documentKey: key2, at: now });
        }
      } finally {
        this.flushing = !1, this.schedule();
      }
    }
  }
  afterEvent(event, before) {
    if (event.type === "network:observed" || event.type === "network:host" || event.type === "network:limited" || event.type === "network:unattributed") return;
    if (event.type === "network:reset" && this.clear(event.documentKey), event.type === "tab:removed" || event.type === "tab:replaced") {
      let tabId = event.type === "tab:removed" ? event.tabId : event.removedTabId;
      this.pending = this.pending.filter((attempt) => attempt.tabId !== tabId), this.resets.delete(tabId);
      for (let key2 of this.losses.keys()) key2.startsWith(String(tabId) + ":") && this.losses.delete(key2);
    }
    if (event.type === "scope:revoked" || event.type === "frames:retired" || event.type === "document:evict") for (let key2 of event.documentKeys) this.clear(key2);
    (event.type === "ui:clear" || event.type === "ui:pause") && this.clear(event.documentKey);
    let current = new Set([...this.runtime.state.bindings.values()].filter((b) => b.documentLifecycle === null || b.documentLifecycle === "active").map((b) => b.documentKey));
    this.window.retain(current), this.dnsWindow.retain(current);
    for (let binding of before.bindings.values()) current.has(binding.documentKey) || this.clear(binding.documentKey);
    (event.type === "navigation:committed" || event.type === "scope:access" || event.type === "batch") && this.flush();
  }
  schedule() {
    let deadline = Math.min(this.window.nextExpiry, this.dnsWindow.nextExpiry);
    for (let event of this.pending) deadline = Math.min(deadline, event.at + NETWORK_PENDING_MS);
    for (let at2 of this.losses.values()) deadline = Math.min(deadline, at2 + 1e4);
    this.timer !== null && deadline >= this.timerAt || (this.timer !== null && clearTimeout(this.timer), this.timer = null, this.timerAt = deadline, deadline !== 1 / 0 && (this.timer = setTimeout(() => {
      this.timer = null, this.timerAt = 1 / 0, this.flush();
    }, Math.max(1, deadline - this.runtime.now()))));
  }
};

// packages/background/src/protection-plan.ts
var PROTECTION_SCRIPT_PREFIX = "detector-protection-v1-", PROTECTION_SCRIPT_IDS = PROTECTION_FEATURES.map((feature) => PROTECTION_SCRIPT_PREFIX + feature);
function protectionScriptFile(feature) {
  return "protection." + feature + ".js";
}
function buildProtectionScripts(settings, scopeMatches) {
  if (!settings.enabled) return [];
  let scope = [...new Set(scopeMatches.filter((pattern) => pattern.startsWith("http://") || pattern.startsWith("https://")))];
  if (scope.length === 0) return [];
  let global = effectiveProtection({ ...settings, sites: [] }, "protection.invalid"), sites = settings.sites.map((site) => ({ host: site.host, blocked: effectiveProtection(settings, site.host) })), result = [];
  for (let feature of PROTECTION_FEATURES) {
    let globalBlock = global.includes(feature), matches = globalBlock ? [...scope] : sites.filter((site) => site.blocked.includes(feature)).flatMap((site) => hostPatterns(site.host).filter((pattern) => scope.some((grant) => grant.startsWith(pattern.slice(0, pattern.indexOf("://") + 3)) && patternCoversHost(grant, site.host))));
    if (matches.length === 0) continue;
    let excludeMatches = globalBlock ? sites.filter((site) => !site.blocked.includes(feature)).flatMap((site) => hostPatterns(site.host)) : [];
    result.push({
      id: PROTECTION_SCRIPT_PREFIX + feature,
      js: [protectionScriptFile(feature)],
      matches,
      excludeMatches,
      world: "MAIN",
      runAt: "document_start",
      allFrames: !0,
      matchOriginAsFallback: !1,
      persistAcrossSessions: !0
    });
  }
  return result;
}

// packages/background/src/protection.ts
// 1.1.0 login-compatibility migration: keep rules, require an explicit new enable.
var PROTECTION_COMPATIBILITY_KEY = "protection:compatibility:1.1.0";
function failure(code2) {
  return { schemaVersion: 1, type: "protection-error", code: code2 };
}
async function bounded(operation, fallback) {
  let timer;
  try {
    return await Promise.race([operation.catch(() => fallback), new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallback), 1e3);
    })]);
  } finally {
    timer !== void 0 && clearTimeout(timer);
  }
}
var ProtectionController = class {
  constructor(api, scope, onChange = () => {}) {
    this.api = api;
    this.scope = scope;
    this.onChange = onChange;
  }
  api;
  scope;
  onChange;
  settings = DEFAULT_PROTECTION_SETTINGS;
  registration = "inactive";
  cleanupIncomplete = !1;
  chain = Promise.resolve();
  pending = 0;
  startup = null;
  accessUnavailable = !1;
  start() {
    return this.startup ??= this.serialize(async () => {
      let valid = !0, interrupted = !1;
      try {
        let stored = await this.api.storage.local.get([PROTECTION_SETTINGS_KEY, PROTECTION_PENDING_KEY, PROTECTION_COMPATIBILITY_KEY]), saved = stored[PROTECTION_SETTINGS_KEY];
        interrupted = stored[PROTECTION_PENDING_KEY] === !0;
        let parsed = saved === void 0 ? DEFAULT_PROTECTION_SETTINGS : readProtectionSettings(saved);
        valid = parsed !== null, this.settings = parsed ?? DEFAULT_PROTECTION_SETTINGS;
        if (stored[PROTECTION_COMPATIBILITY_KEY] !== !0) {
          // Persist the marker with the disabled policy in one write; a failed write stays disabled.
          if (this.settings.enabled) {
            this.settings = { ...this.settings, enabled: !1, revision: Math.min(this.settings.revision + 1, Number.MAX_SAFE_INTEGER) };
            interrupted = !0;
          }
          await this.api.storage.local.set({
            [PROTECTION_SETTINGS_KEY]: this.settings,
            [PROTECTION_COMPATIBILITY_KEY]: !0,
            [PROTECTION_PENDING_KEY]: interrupted
          });
        }
      } catch {
        valid = !1;
        this.settings = { ...this.settings, enabled: !1 };
      }
      await this.reconcile(), (!valid || interrupted || this.registration !== "ready") && await this.stopOpenDocuments(), valid || (this.registration = "error"), interrupted && this.registration !== "error" && await this.finishApplication();
    }), this.startup;
  }
  serialize(operation) {
    let next = this.chain.then(operation, operation);
    return this.chain = next.catch(() => {
    }), next.finally(() => { try { this.onChange(); } catch {} });
  }
  async reconcile() {
    let desired = buildProtectionScripts(this.settings, this.accessUnavailable || !this.scope.accessReady ? [] : this.scope.desiredMatches()).filter(script => !["detector-protection-v1-webrtc", "detector-protection-v1-websocket", "detector-protection-v1-webtransport"].includes(script.id));
    try {
      let existing = await this.api.scripting.getRegisteredContentScripts({ ids: PROTECTION_SCRIPT_IDS }), remove = existing.filter((script) => !desired.some((next) => next.id === script.id)).map((script) => script.id);
      remove.length > 0 && await this.api.scripting.unregisterContentScripts({ ids: remove });
      let update = desired.filter((script) => existing.some((previous) => previous.id === script.id)), add = desired.filter((script) => !existing.some((previous) => previous.id === script.id));
      update.length > 0 && await this.api.scripting.updateContentScripts(update), add.length > 0 && await this.api.scripting.registerContentScripts(add);
      let actual = await this.api.scripting.getRegisteredContentScripts({ ids: PROTECTION_SCRIPT_IDS }), list2 = (items) => [...items ?? []].sort().join(`
`);
      if (actual.length !== desired.length || desired.some((script) => !actual.some((registered) => registered.id === script.id && list2(registered.matches) === list2(script.matches) && list2(registered.excludeMatches) === list2(script.excludeMatches) && list2(registered.js) === list2(script.js) && registered.world === "MAIN" && registered.runAt === "document_start" && registered.allFrames === !0 && registered.persistAcrossSessions === !0 && registered.matchOriginAsFallback !== !0))) throw new Error("registration-mismatch");
      this.registration = desired.length > 0 ? "ready" : "inactive";
    } catch {
      this.registration = "error";
      try {
        let existing = await this.api.scripting.getRegisteredContentScripts({ ids: PROTECTION_SCRIPT_IDS });
        existing.length > 0 && await this.api.scripting.unregisterContentScripts({ ids: existing.map((script) => script.id) });
      } catch {
        this.cleanupIncomplete = !0;
      }
    }
  }
  async stopOpenDocuments() {
    try {
      let tabs = await this.api.tabs.query({});
      tabs.length > 128 && (this.cleanupIncomplete = !0), await Promise.all(tabs.slice(0, 128).map(async (tab) => {
        tab.id !== void 0 && await bounded(this.api.tabs.sendMessage(tab.id, { schemaVersion: 1, type: "protection-stop" }), void 0);
      }));
    } catch {
      this.cleanupIncomplete = !0;
    }
  }
  async finishApplication() {
    try {
      await this.api.storage.local.set({ [PROTECTION_PENDING_KEY]: !1 });
    } catch {
      this.registration = "error";
    }
  }
  suspendAccess() {
    return this.accessUnavailable = !0, this.serialize(async () => {
      await this.reconcile(), await this.stopOpenDocuments(), this.registration = "error";
    });
  }
  async accessChanged() {
    await this.start(), await this.serialize(async () => {
      let active6 = this.settings.enabled || this.registration !== "inactive";
      this.accessUnavailable = !1, await this.reconcile(), active6 && await this.stopOpenDocuments();
    });
  }
  async get(tabId) {
    await this.start(), await this.chain;
    let state = {
      schemaVersion: 1,
      type: "protection-state",
      settings: readProtectionSettings(this.settings),
      registration: this.registration,
      cleanupIncomplete: this.cleanupIncomplete,
      tabId,
      host: null,
      documentId: null,
      configured: [],
      observations: [],
      liveRead: "unavailable",
      integrity: "page-controlled"
    };
    if (tabId === null) return state;
    try {
      let frame = (await this.api.webNavigation.getAllFrames({ tabId }))?.find((entry) => entry.frameId === 0);
      if (!frame || !frame.documentId) return state;
      let host2 = sanitizeHost(frame.url);
      if (host2 === null || !frame.url.startsWith("https://") && !frame.url.startsWith("http://")) return state;
      state.host = host2, state.documentId = frame.documentId;
      let scheme = frame.url.startsWith("https://") ? "https" : "http", accessGeneration = this.scope.accessGeneration;
      if (this.accessUnavailable || !this.scope.accessReady || !await this.scope.isGranted(scheme + "://" + host2 + "/*", tabId, frame.documentId) || !this.scope.accessReady || accessGeneration !== this.scope.accessGeneration || this.accessUnavailable) return state;
      state.configured = effectiveProtection(this.settings, host2);
      let response = await bounded(this.api.tabs.sendMessage(
        tabId,
        { schemaVersion: 1, type: "protection-query" },
        { frameId: 0, documentId: frame.documentId }
      ), void 0), observations = readProtectionObservations(response);
      if ((await this.api.webNavigation.getAllFrames({ tabId }))?.find((entry) => entry.frameId === 0)?.documentId !== frame.documentId || !this.scope.accessReady || this.accessUnavailable || accessGeneration !== this.scope.accessGeneration)
        return state.host = null, state.documentId = null, state.configured = [], state;
      observations !== null && (state.observations = observations, state.liveRead = "received");
    } catch {
    }
    return state;
  }
  async set(settings, tabId) {
    return await this.start(), await this.serialize(async () => {
      let parsed = readProtectionSettings(settings);
      if (!parsed) return failure("invalid-request");
      if (parsed.revision !== this.settings.revision || parsed.revision >= Number.MAX_SAFE_INTEGER) return failure("stale-revision");
      let next = { ...parsed, revision: parsed.revision + 1 };
      try {
        await this.api.storage.local.set({ [PROTECTION_SETTINGS_KEY]: next, [PROTECTION_PENDING_KEY]: !0 });
      } catch {
        return failure("storage-error");
      }
      let wasEnabled = this.settings.enabled;
      return this.settings = next, this.cleanupIncomplete = !1, await this.reconcile(), (wasEnabled || next.enabled) && await this.stopOpenDocuments(), this.registration !== "error" && await this.finishApplication(), null;
    }) ?? this.get(tabId);
  }
  route(message, sender, whenReady) {
    if (typeof message != "object" || message === null) return null;
    let type = Object.getOwnPropertyDescriptor(message, "type")?.value;
    if (typeof type != "string" || !type.startsWith("ui-protection-")) return null;
    if (!verifyUiSender(sender, this.api.runtime.id)) return Promise.resolve(failure("unauthorized-sender"));
    let request = readProtectionUiRequest(message);
    return request ? this.pending >= 4 ? Promise.resolve(failure("busy")) : (this.pending++, (async () => {
      if (await whenReady(), request.type === "ui-protection-get") return this.get(request.tabId);
      if (request.type === "ui-protection-set") return this.set(request.settings, request.tabId);
      await this.start(), await this.chain;
      // A pending navigation can still report the old committed document ID.
      // Never let its stale reload request cancel the user's new destination.
      const reloadable = (tab) => tab?.id === request.tabId && tab.pendingUrl === void 0;
      if (!this.api.tabs.get || !reloadable(await this.api.tabs.get(request.tabId))) return failure("stale-document");
      let frame = (await this.api.webNavigation.getAllFrames({ tabId: request.tabId }))?.find((entry) => entry.frameId === 0);
      if (frame?.documentId !== request.documentId) return failure("stale-document");
      if (!frame.url.startsWith("https://") && !frame.url.startsWith("http://") || this.registration === "error" || !this.api.tabs.reload) return failure("no-access");
      const target = await this.api.tabs.get(request.tabId);
      if (!reloadable(target) || target.url !== frame.url) return failure("stale-document");
      await this.api.tabs.reload(request.tabId);
      return this.get(request.tabId);
    })().catch(() => failure("no-access")).finally(() => {
      this.pending--;
    })) : Promise.resolve(failure("invalid-request"));
  }
};

// ADR-017: Pro values
var PRO_TECHNICAL_OPERATIONS = {"Navigator.languages":["languages","DET-025"],"Navigator.plugins":["plugins","DET-027"],"Navigator.mimeTypes":["mime-types","DET-027"],"NavigatorUAData.brands":["ua-data","DET-026"],"NavigatorUAData.toJSON":["ua-data","DET-026"],"Window.matchMedia":["media-query","DET-037"],"Element.getBoundingClientRect":["geometry","DET-005"],"Element.getClientRects":["geometry","DET-005"],"Range.getBoundingClientRect":["geometry","DET-006"],"Range.getClientRects":["geometry","DET-006"],"SVGGraphicsElement.getBBox":["geometry","DET-007"],"CanvasRenderingContext2D.measureText":["text-metrics","DET-003"],"OffscreenCanvasRenderingContext2D.measureText":["text-metrics","DET-003"],"WebGLRenderingContext.getSupportedExtensions":["webgl-extensions","DET-011"],"WebGL2RenderingContext.getSupportedExtensions":["webgl-extensions","DET-011"],"Intl.Collator.resolvedOptions":["intl","DET-036"],"Intl.DateTimeFormat.resolvedOptions":["intl","DET-036"],"Intl.NumberFormat.resolvedOptions":["intl","DET-036"],"Intl.PluralRules.resolvedOptions":["intl","DET-036"],"Intl.RelativeTimeFormat.resolvedOptions":["intl","DET-036"],"Intl.ListFormat.resolvedOptions":["intl","DET-036"],"Intl.Segmenter.resolvedOptions":["intl","DET-036"],"Intl.DisplayNames.resolvedOptions":["intl","DET-036"]};
var PRO_TECHNICAL_FIELDS = {"languages":{"language":"string"},"plugins":{"name":"string","description":"string","filename":"string","length":"number"},"mime-types":{"type":"string","description":"string","suffixes":"string"},"ua-data":{"brand":"string","version":"string","mobile":"boolean","platform":"string"},"media-query":{"media":"string","matches":"boolean"},"geometry":{"x":"number","y":"number","width":"number","height":"number","top":"number","right":"number","bottom":"number","left":"number"},"text-metrics":{"width":"number","actualBoundingBoxLeft":"number","actualBoundingBoxRight":"number","fontBoundingBoxAscent":"number","fontBoundingBoxDescent":"number","actualBoundingBoxAscent":"number","actualBoundingBoxDescent":"number","emHeightAscent":"number","emHeightDescent":"number","hangingBaseline":"number","alphabeticBaseline":"number","ideographicBaseline":"number"},"webgl-extensions":{"extension":"string"},"intl":{"locale":"string","usage":"string","sensitivity":"string","collation":"string","caseFirst":"string","calendar":"string","numberingSystem":"string","timeZone":"string","hourCycle":"string","weekday":"string","era":"string","year":"string","month":"string","day":"string","dayPeriod":"string","hour":"string","minute":"string","second":"string","timeZoneName":"string","dateStyle":"string","timeStyle":"string","style":"string","currency":"string","currencyDisplay":"string","currencySign":"string","unit":"string","unitDisplay":"string","notation":"string","compactDisplay":"string","signDisplay":"string","roundingMode":"string","roundingPriority":"string","trailingZeroDisplay":"string","type":"string","pluralCategory":"string","numeric":"string|boolean","granularity":"string","fallback":"string","languageDisplay":"string","fractionalSecondDigits":"number","minimumIntegerDigits":"number","minimumFractionDigits":"number","maximumFractionDigits":"number","minimumSignificantDigits":"number","maximumSignificantDigits":"number","roundingIncrement":"number","ignorePunctuation":"boolean","hour12":"boolean","useGrouping":"string|boolean"}};
var proTechnicalContractNative = (function captureTechnicalContractIntrinsics() {
  const apply = Reflect.apply, includes = Array.prototype.includes, define = Object.defineProperty, exec = RegExp.prototype.exec, own = Object.getOwnPropertyDescriptor, has = Object.hasOwn;
  return { own, keys: Reflect.ownKeys, has, array: Array.isArray, integer: Number.isSafeInteger, finite: Number.isFinite, is: Object.is,
    data: (object, name) => { const d = own(object, name); return d && has(d, 'value') ? d.value : undefined; },
    includes: (a, v) => apply(includes, a, [v]), push: (a, v) => define(a, a.length, { __proto__: null, value: v, writable: true, configurable: true, enumerable: true }), test: (re, v) => apply(exec, re, [v]) !== null };
})();
function readProTechnicalValue(value, operation) {
  const n = proTechnicalContractNative;
  try {
    const expected = n.has(PRO_TECHNICAL_OPERATIONS, operation) ? PRO_TECHNICAL_OPERATIONS[operation] : null;
    if (!expected || !value || typeof value !== 'object' || n.keys(value).length !== 4) return null;
    const kind = n.data(value, 'kind'), profile = n.data(value, 'profile'), fields = n.data(value, 'fields'), truncated = n.data(value, 'truncated');
    if (kind !== 'technical' || profile !== expected[0] || typeof truncated !== 'boolean' || !n.array(fields) || fields.length > 128 || n.keys(fields).length !== fields.length + 1) return null;
    const allowed = PRO_TECHNICAL_FIELDS[profile], output = [], identities = [];
    let bytes = 256;
    for (let i = 0; i < fields.length; i++) {
      const field = n.data(fields, i);
      if (!field || typeof field !== 'object' || n.keys(field).length !== 4) return null;
      const name = n.data(field, 'name'), index = n.data(field, 'index'), type = n.data(field, 'kind'), item = n.data(field, 'value');
      if (typeof name !== 'string' || !n.has(allowed, name) || !n.integer(index) || index < 0 || index > 127 || typeof type !== 'string') return null;
      const expectedType = allowed[name], identity = name + ':' + index;
      if (n.includes(identities, identity)) return null;
      if (type === 'special-number') {
        if (expectedType !== 'number' || !n.includes(['NaN', 'Infinity', '-Infinity', '-0'], item)) return null;
      } else {
        if (type !== expectedType && !(expectedType === 'string|boolean' && (type === 'string' || type === 'boolean'))) return null;
        if (typeof item !== type) return null;
        if (type === 'string' && (item.length > 256 || n.test(/[\u0000-\u001f\u007f]/, item))) return null;
        if (type === 'number' && (!n.finite(item) || n.is(item, -0))) return null;
      }
      bytes += 64 + name.length * 2 + (typeof item === 'string' ? item.length * 2 : 16);
      if (bytes > 8192) return null;
      n.push(identities, identity); n.push(output, { name, index, kind: type, value: item });
    }
    return { kind: 'technical', profile, fields: output, truncated };
  } catch { return null; }
}
function readProTechnicalRow(row) {
  const n = proTechnicalContractNative;
  try {
    if (!row || typeof row !== 'object' || n.keys(row).length !== 4) return null;
    const operation = n.data(row, 'operation'), techniqueId = n.data(row, 'techniqueId'), phase = n.data(row, 'phase');
    if (typeof operation !== 'string' || !n.has(PRO_TECHNICAL_OPERATIONS, operation) || PRO_TECHNICAL_OPERATIONS[operation][1] !== techniqueId || phase !== 'returned-sync') return null;
    const value = readProTechnicalValue(n.data(row, 'value'), operation);
    return value ? [{ operation, techniqueId, phase, value }] : null;
  } catch { return null; }
}

var proValueIntrinsics = (function captureProIntrinsics() {
  const apply = Reflect.apply, define = Object.defineProperty, includes = Array.prototype.includes, test = RegExp.prototype.exec;
  const hasOwn = Object.hasOwn;
  const MapCtor = Map, SetCtor = Set, get = Map.prototype.get, set = Map.prototype.set, clear = Map.prototype.clear;
  const setHas = Set.prototype.has, add = Set.prototype.add, size = Object.getOwnPropertyDescriptor(Set.prototype, 'size').get;
  return { MapCtor, SetCtor, mapGet: (map, key) => apply(get, map, [key]), mapSet: (map, key, value) => apply(set, map, [key, value]), mapClear: map => apply(clear, map, []), setHas: (set, key) => apply(setHas, set, [key]), setAdd: (set, key) => apply(add, set, [key]), setSize: set => apply(size, set, []), descriptor: Object.getOwnPropertyDescriptor, keys: Reflect.ownKeys, finite: Number.isFinite, abs: Math.abs, is: Object.is, hasOwn, push: (array, value) => define(array, array.length, { __proto__: null, value, writable: true, configurable: true, enumerable: true }), includes: (array, value) => apply(includes, array, [value]), test: (pattern, value) => apply(test, pattern, [value]) !== null };
})();
function proValueFallback(operation, techniqueId, phase, value) {
  const surfaces = { 'HTMLCanvasElement.toDataURL': 'DET-001', 'HTMLCanvasElement.toBlob': 'DET-001', 'CanvasRenderingContext2D.getImageData': 'DET-002', 'CanvasRenderingContext2D.measureText': 'DET-003', 'OffscreenCanvasRenderingContext2D.measureText': 'DET-003', 'OffscreenCanvasRenderingContext2D.getImageData': 'DET-004', 'OffscreenCanvas.convertToBlob': 'DET-004' };
  if (typeof operation !== 'string' || !proValueIntrinsics.hasOwn(surfaces, operation) || surfaces[operation] !== techniqueId || !proValueIntrinsics.includes(['attempted', 'returned-sync', 'threw-sync', 'settlement-unobserved'], phase)) return null;
  if (!value || typeof value !== 'object' || proValueIntrinsics.keys(value).length !== 2 || proValueIntrinsics.descriptor(value, 'kind')?.value !== 'unobserved' || proValueIntrinsics.descriptor(value, 'reason')?.value !== 'sensitive') return null;
  return [{ operation, techniqueId, phase, value: { kind: 'unobserved', reason: 'sensitive' } }];
}

function proValueParameters(operation, args) {
  const result = [];
  if (!args) return result;
  let numeric = 0, allowed = null;
  if (proValueIntrinsics.test(/^(?:CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D)\.getImageData$/, operation)) numeric = 4;
  else if (proValueIntrinsics.test(/^(?:WebGLRenderingContext|WebGL2RenderingContext)\.getParameter\./, operation)) numeric = 1;
  else if (operation === 'WebAssembly.Memory.grow') numeric = 1;
  else if (proValueIntrinsics.test(/^(?:HTMLCanvasElement|OffscreenCanvas)\.getContext$/, operation)) allowed = ['2d', 'webgl', 'webgl2', 'experimental-webgl', 'webgpu', 'bitmaprenderer'];
  else if (proValueIntrinsics.test(/^(?:RTCRtpSender|RTCRtpReceiver)\.getCapabilities$/, operation)) allowed = ['audio', 'video'];
  for (let index = 0; index < numeric && index < args.length; index++) {
    const value = args[index];
    if (typeof value === 'number' && proValueIntrinsics.finite(value) && proValueIntrinsics.abs(value) <= 2147483647) proValueIntrinsics.push(result, { name: 'arg' + index, kind: 'number', value: proValueIntrinsics.is(value, -0) ? 0 : value });
  }
  if (allowed && typeof args[0] === 'string' && proValueIntrinsics.includes(allowed, args[0])) proValueIntrinsics.push(result, { name: 'arg0', kind: 'string', value: args[0] });
  // Only primitive technical queries. Never measureText text, font sample text,
  // request bodies, arbitrary option objects, or any argument coercion.
  let queries = 0;
  if (operation === 'CSS.supports') queries = 2;
  else if (operation === 'Window.matchMedia' || operation === 'FontFaceSet.check' || operation === 'FontFaceSet.load' || operation === 'HTMLMediaElement.canPlayType' || operation === 'MediaSource.isTypeSupported' || operation === 'MediaRecorder.isTypeSupported' || operation === 'ImageDecoder.isTypeSupported') queries = 1;
  for (let index = 0; index < queries && index < args.length; index++) {
    const query = args[index];
    if (typeof query === 'string' && query.length <= 256 && !proValueIntrinsics.test(/[\u0000-\u001f\u007f]|(?:url\s*\(|(?:https?|data|blob|file):)/i, query)) proValueIntrinsics.push(result, { name: 'arg' + index, kind: 'string', value: query });
  }
  return result;
}

function proValueKey(row) {
  const value = row.value;
  // Length prefixes distinguish delimiters inside already validated technical strings.
  const part = item => { const text = typeof item + ':' + item; return text.length + ':' + text; };
  let key = part(row.operation) + part(row.phase) + part(value.kind);
  if (value.kind === 'unobserved') key += part(value.reason);
  else if (value.kind === 'number-array') for (let index = 0; index < value.values.length; index++) key += part(value.values[index]);
  else if (value.kind === 'webrtc') {
    key += part(value.profile) + part(value.source) + part(value.truncated);
    for (let index = 0; index < value.fields.length; index++) { const field = value.fields[index]; key += part(field.name) + part(field.index) + part(field.value); }
  } else if (value.kind === 'technical') {
    key += part(value.profile) + part(value.truncated);
    for (let index = 0; index < value.fields.length; index++) { const field = value.fields[index]; key += part(field.name) + part(field.index) + part(field.kind) + part(field.value); }
  } else if (proValueIntrinsics.hasOwn(value, 'value')) key += part(value.value);
  for (let index = 0; index < row.parameters.length; index++) { const parameter = row.parameters[index]; key += part(parameter.name) + part(parameter.kind) + part(parameter.value); }
  return key;
}

function createProParameterBudget() {
  const native = proValueIntrinsics, states = new native.MapCtor();
  return {
    admit(row) {
      if (!row.parameters.length) return true;
      let key = '';
      for (let i = 0; i < row.parameters.length; i++) {
        const p = row.parameters[i], part = p.name + ':' + p.kind + ':' + p.value;
        key += part.length + ':' + part;
      }
      let known = native.mapGet(states, row.operation);
      if (known && native.setHas(known, key)) return true;
      if (known && native.setSize(known) >= 32) return false;
      if (!known) { known = new native.SetCtor(); native.mapSet(states, row.operation, known); }
      native.setAdd(known, key);
      return true;
    },
    reset() { native.mapClear(states); }
  };
}

function proValueRows(value, validate) {
  try {
    const own = Object.getOwnPropertyDescriptor;
    if (!Array.isArray(value) || value.length > 256 || Reflect.ownKeys(value).length !== value.length + 1) return null;
    const rows = [], seen = new Set();
    let bytes = 512;
    for (let index = 0; index < value.length; index++) {
      const item = own(value, index)?.value;
      const names = ['operation', 'techniqueId', 'phase', 'value', 'parameters', 'count'];
      if (!item || typeof item !== 'object' || Reflect.ownKeys(item).length !== names.length || names.some(name => !Object.hasOwn(own(item, name) ?? {}, 'value'))) return null;
      const inputRow = { operation: own(item, 'operation').value, techniqueId: own(item, 'techniqueId').value, phase: own(item, 'phase').value, value: own(item, 'value').value };
      const base = readProTechnicalRow(inputRow) ?? validate([inputRow]) ?? proValueFallback(inputRow.operation, inputRow.techniqueId, inputRow.phase, inputRow.value);
      if (!base || base.length !== 1) return null;
      const count = own(item, 'count').value, input = own(item, 'parameters').value;
      if (!Number.isSafeInteger(count) || count < 1 || count > 2147483647 || !Array.isArray(input) || input.length > 4 || Reflect.ownKeys(input).length !== input.length + 1) return null;
      const parameters = [];
      for (let position = 0; position < input.length; position++) {
        const parameter = own(input, position)?.value;
        if (!parameter || typeof parameter !== 'object' || Reflect.ownKeys(parameter).length !== 3 || ['name', 'kind', 'value'].some(name => !Object.hasOwn(own(parameter, name) ?? {}, 'value'))) return null;
        parameters.push({ name: own(parameter, 'name').value, kind: own(parameter, 'kind').value, value: own(parameter, 'value').value });
      }
      // Reconstruct a primitive argument vector and apply the same allowlist as MAIN.
      const args = [];
      for (const parameter of parameters) {
        if (typeof parameter.name !== 'string' || !/^arg[0-3]$/.test(parameter.name) || (parameter.kind !== 'number' && parameter.kind !== 'string') || typeof parameter.value !== parameter.kind) return null;
        const index = Number(parameter.name.slice(3));
        if (Object.hasOwn(args, index)) return null;
        args[index] = parameter.value;
      }
      const canonical = proValueParameters(base[0].operation, args);
      if (canonical.length !== parameters.length || canonical.some((parameter, index) => parameter.name !== parameters[index].name || parameter.kind !== parameters[index].kind || !Object.is(parameter.value, parameters[index].value))) return null;
      const row = { ...base[0], parameters, count }, key = proValueKey(row);
      if (seen.has(key)) return null;
      seen.add(key);
      bytes += 256 + key.length * 2;
      if (bytes > 65536) return null;
      rows.push(row);
    }
    return rows;
  } catch {
    return null;
  }
}

function proValueDocuments(value, validate) {
  try {
    if (!Array.isArray(value) || value.length > 24 || Reflect.ownKeys(value).length !== value.length + 1) return null;
    const result = [], seen = new Set();
    for (let index = 0; index < value.length; index++) {
      const item = Object.getOwnPropertyDescriptor(value, index)?.value;
      if (!item || typeof item !== 'object' || Reflect.ownKeys(item).length !== 3) return null;
      const documentKey = Object.getOwnPropertyDescriptor(item, 'documentKey')?.value;
      const truncated = Object.getOwnPropertyDescriptor(item, 'truncated')?.value;
      const rows = proValueRows(Object.getOwnPropertyDescriptor(item, 'rows')?.value, validate);
      if (typeof documentKey !== 'string' || !/^[A-Za-z0-9_:.-]{1,160}$/.test(documentKey) || typeof truncated !== 'boolean' || !rows || seen.has(documentKey)) return null;
      seen.add(documentKey);
      result.push({ documentKey, rows, truncated });
    }
    return result;
  } catch {
    return null;
  }
}
// packages/background/src/api-results.ts
var active4 = (lifecycle) => lifecycle == null || lifecycle === "active", unavailable = (documentKey3) => ({
  schemaVersion: 1,
  type: "api-results-state",
  documentKey: documentKey3,
  available: !1,
  integrity: "page-controlled",
  rows: [],
  truncated: !0
}), ApiResultsManager = class {
  constructor(runtime) {
    this.runtime = runtime;
  }
  runtime;
  operations = /* @__PURE__ */ new Set();
  resets = /* @__PURE__ */ new Map();
  binding(documentKey3) {
    return [...this.runtime.state.bindings.values()].find((binding) => binding.documentKey === documentKey3 && active4(binding.documentLifecycle));
  }
  // ADR-072: UI operations and Pro share the same bounded invalidation ledger.
  trackOperation(operation) {
    if (this.operations.has(operation)) return !operation.invalid;
    if (this.operations.size >= 8 || operation.invalid) return !1;
    this.operations.add(operation); return !0;
  }
  releaseOperation(operation) { this.operations.delete(operation); }
  invalidate(documentKey3) {
    for (let operation of this.operations) (documentKey3 === void 0 || operation.documentKey === documentKey3) && (operation.invalid = !0);
  }
  afterEvent(event) {
    if ((event.type === "ui:pause" || event.type === "ui:clear" || event.type === "transport:stopped") && this.invalidate(event.documentKey), event.type === "scope:access" && !event.accessGranted && this.invalidate(event.documentKey), event.type === "scope:revoked" || event.type === "frames:retired" || event.type === "document:evict")
      for (let key2 of event.documentKeys) this.invalidate(key2);
    if (event.type === "navigation:committed" || event.type === "tab:removed" || event.type === "tab:replaced") {
      let tabId = event.type === "tab:replaced" ? event.removedTabId : event.tabId;
      for (let operation of this.operations) operation.tabId === tabId && (operation.invalid = !0);
    }
  }
  async reset(documentKey3) {
    let binding = this.binding(documentKey3);
    if (!binding || this.resets.has(documentKey3)) return !1;
    let native = this.resets.get(documentKey3);
    if (!native) {
      if (this.resets.size >= 4) return !1;
      native = (async () => {
        try {
          let response = await this.runtime.api.tabs.sendMessage(
            binding.tabId,
            { schemaVersion: 1, type: "api-results-reset" },
            { frameId: binding.frameId, documentId: binding.documentId }
          );
          if (typeof response != "object" || response === null) return !1;
          let fields4 = response;
          return fields4.schemaVersion === 1 && fields4.type === "api-results-reset-ack" && typeof fields4.epoch == "number" && Number.isInteger(fields4.epoch) && fields4.epoch >= 0 && fields4.epoch < 2147483647;
        } catch {
          return !1;
        }
      })(), this.resets.set(documentKey3, native), native.finally(() => {
        this.resets.delete(documentKey3);
      });
    }
    let timer;
    try {
      return await Promise.race([native, new Promise((resolve) => {
        timer = setTimeout(() => resolve(!1), 1e3);
      })]);
    } finally {
      timer !== void 0 && clearTimeout(timer);
    }
  }
  async prepareClear(documentKey3, markerPersisted = !1) {
    this.invalidate(documentKey3), this.runtime.markApiResultsReset([documentKey3], !0);
    let reset = await this.reset(documentKey3);
    return { ready: reset || markerPersisted || await this.runtime.persistApiResultsReset(), reset };
  }
  async authorize(request, operation) {
    if (operation.invalid || !this.runtime.scope.accessReady) return !1;
    let projection = this.runtime.getProjection(request.tabId, request.frameId);
    if (projection?.documentKey !== request.documentKey || projection.coverageState === "paused" || projection.coverageState === "no-access") return !1;
    let binding = this.binding(request.documentKey), meta = this.runtime.state.metas.get(request.documentKey);
    if (!binding || binding.tabId !== request.tabId || binding.frameId !== request.frameId || binding.accessGranted === !1 || binding.originPending || meta?.paused || meta?.revoked || meta?.accessGranted === !1) return !1;
    let frames = await this.runtime.api.webNavigation.getAllFrames({ tabId: request.tabId });
    if (!Array.isArray(frames) || frames.length > 1024) return !1;
    let frame = frames.find((frame2) => frame2.frameId === request.frameId && frame2.documentId === binding.documentId && active4(frame2.documentLifecycle));
    if (!frame || frame.errorOccurred) return !1;
    let current = frame, host2 = null, scheme = null;
    for (let depth = 0; depth < 128 && (host2 = sanitizeHost(current.url), scheme = current.url.startsWith("https://") ? "https" : current.url.startsWith("http://") ? "http" : null, !(host2 !== null && scheme !== null)); depth++) {
      if (current.url !== "about:blank" && current.url !== "about:srcdoc") return !1;
      let parent = frames.find((candidate) => candidate.documentId === current.parentDocumentId && active4(candidate.documentLifecycle));
      if (!parent) return !1;
      current = parent;
    }
    if (host2 === null || scheme === null || operation.invalid) return !1;
    let generation = this.runtime.scope.accessGeneration;
    const granted = await this.runtime.scope.isGranted(scheme + "://" + host2 + "/*", request.tabId, binding.documentId);
    const live = this.binding(request.documentKey), currentMeta = this.runtime.state.metas.get(request.documentKey), currentProjection = this.runtime.getProjection(request.tabId, request.frameId);
    return granted && !operation.invalid && generation === this.runtime.scope.accessGeneration && this.runtime.scope.accessReady && live?.documentId === binding.documentId && live.accessGranted !== false && !live.originPending && !currentMeta?.paused && !currentMeta?.revoked && currentMeta?.accessGranted !== false && currentProjection?.documentKey === request.documentKey && currentProjection.coverageState !== "paused" && currentProjection.coverageState !== "no-access";
  }
  async read(request, operation) {
    if (await this.runtime.whenReady(), !await this.authorize(request, operation) || this.binding(request.documentKey)?.apiResultsResetRequired && (!await this.reset(request.documentKey) || operation.invalid || !await this.authorize(request, operation) || (this.runtime.markApiResultsReset([request.documentKey], !1), !await this.runtime.persistApiResultsReset())))
      return unavailable(request.documentKey);
    let binding = this.binding(request.documentKey);
    if (!binding || operation.invalid) return unavailable(request.documentKey);
    let generation = this.runtime.scope.accessGeneration, response = await this.runtime.api.tabs.sendMessage(
      request.tabId,
      { schemaVersion: 1, type: "api-results-query" },
      { frameId: request.frameId, documentId: binding.documentId }
    ), cache = readApiResultsCache(response);
    return !cache || operation.invalid || generation !== this.runtime.scope.accessGeneration || this.binding(request.documentKey)?.apiResultsResetRequired || !await this.authorize(request, operation) ? unavailable(request.documentKey) : {
      schemaVersion: 1,
      type: "api-results-state",
      documentKey: request.documentKey,
      integrity: "page-controlled",
      available: cache.available,
      rows: cache.rows,
      truncated: cache.truncated
    };
  }
  route(message, sender) {
    if (typeof message != "object" || message === null || Object.getOwnPropertyDescriptor(message, "type")?.value !== "ui-api-results") return null;
    if (!verifyUiSender(sender, this.runtime.api.runtime.id)) return Promise.resolve({ schemaVersion: 1, type: "error", code: "unauthorized-sender" });
    let request = readApiResultsUiRequest(message);
    if (!request) return Promise.resolve({ schemaVersion: 1, type: "error", code: "invalid-request" });
    if (this.operations.size >= 4) return Promise.resolve(unavailable(request.documentKey));
    let operation = { documentKey: request.documentKey, tabId: request.tabId, invalid: !1 };
    this.operations.add(operation);
    let work = this.read(request, operation).catch(() => unavailable(request.documentKey)).finally(() => this.operations.delete(operation)), timer;
    return Promise.race([work, new Promise((resolve) => {
      timer = setTimeout(() => {
        operation.invalid = !0, resolve(unavailable(request.documentKey));
      }, 2e3);
    })]).finally(() => {
      timer !== void 0 && clearTimeout(timer);
    });
  }
};

// packages/background/src/response-headers.ts
function normalizeResponseHeaders(value, readHints = !0) {
  let result = { entries: [], truncated: !1 };
  if (!Array.isArray(value)) return result;
  value.length > 64 && (result.truncated = !0);
  for (let index = 0; index < Math.min(value.length, 64); index++) {
    let entry = Object.getOwnPropertyDescriptor(value, String(index)), row = entry && Object.hasOwn(entry, "value") ? entry.value : null;
    if (!row || typeof row != "object") {
      result.truncated = !0;
      continue;
    }
    let nameField = Object.getOwnPropertyDescriptor(row, "name"), rawName = nameField && Object.hasOwn(nameField, "value") ? nameField.value : null;
    if (typeof rawName != "string" || rawName.length > 128) {
      result.truncated = !0;
      continue;
    }
    let name = rawName.toLowerCase();
    if (!RESPONSE_HEADER_NAMES.includes(name)) continue;
    let normalized = result.entries.find((entry2) => entry2.name === name);
    if (normalized || (normalized = { name, count: 1, clientHints: [] }, result.entries.push(normalized)), !readHints || name !== "accept-ch" && name !== "critical-ch") continue;
    let bodyField = Object.getOwnPropertyDescriptor(row, "value"), body = bodyField && Object.hasOwn(bodyField, "value") ? bodyField.value : null;
    if (typeof body != "string" || body.length > 4096) {
      result.truncated = !0;
      continue;
    }
    for (let token4 of body.split(",")) {
      let hint = token4.trim().toLowerCase();
      if (!CLIENT_HINT_NAMES.includes(hint)) {
        hint !== "" && (result.truncated = !0);
        continue;
      }
      normalized.clientHints.includes(hint) || normalized.clientHints.push(hint);
    }
  }
  return result;
}
var RESPONSE_HEADERS_FILTER = { urls: ["http://*/*", "https://*/*"] }, ResponseHeadersObserver = class {
  constructor(runtime) {
    this.runtime = runtime;
  }
  runtime;
  navigations = /* @__PURE__ */ new Map();
  limiter = new RateLimiter();
  navigationLoss = !1;
  clear() {
    this.navigations.clear(), this.navigationLoss = !1;
  }
  onBrowserEvent(event) {
    if (!this.runtime.canBufferRedactedBrowserData()) return null;
    let at2 = this.runtime.now();
    for (let [slot, owner] of this.navigations)
      at2 - owner.at > 6e4 ? (owner.response && (this.navigationLoss = !0), this.navigations.delete(slot)) : owner.response && at2 - owner.response.at > 2e3 && (owner.response.headers = { entries: [], truncated: !0 });
    if (event.type === "navigation:before") {
      let slot = bindingKey(event.tabId, event.frameId), previous = this.navigations.get(slot);
      if (previous?.response && (this.navigationLoss = !0), this.navigations.size >= 128 && !this.navigations.has(slot)) {
        let first = this.navigations.keys().next();
        first.done || (this.navigations.get(first.value)?.response && (this.navigationLoss = !0), this.navigations.delete(first.value));
      }
      this.navigations.set(slot, {
        requestId: null,
        documentKey: null,
        ambiguous: previous !== void 0 && previous.documentKey === null,
        completed: !1,
        response: null,
        at: at2
      });
    } else if (event.type === "navigation:committed") {
      let slot = bindingKey(event.tabId, event.frameId), owner = this.navigations.get(slot), documentKey3 = makeDocumentKey(event.tabId, event.frameId, event.documentId);
      if (owner && ((!owner.requestId || owner.documentKey !== null) && (owner.ambiguous = !0), owner.documentKey = documentKey3, owner.completed && (this.navigations.delete(slot), owner.response)))
        return this.observationEvent(documentKey3, owner.response, owner.ambiguous);
      if (this.navigationLoss) return {
        type: "network:headers",
        documentKey: documentKey3,
        headers: { entries: [], truncated: !0 },
        ...this.runtime.hydrationComplete ? {} : { requiresAllSitesAccess: !0 },
        at: at2
      };
    } else if (event.type === "navigation:error") this.navigations.delete(bindingKey(event.tabId, event.frameId));
    else if (event.type === "tab:removed" || event.type === "tab:replaced") {
      let tabId = event.type === "tab:removed" ? event.tabId : event.removedTabId;
      for (let slot of this.navigations.keys()) slot.startsWith(String(tabId) + ":") && this.navigations.delete(slot);
    }
    return null;
  }
  onBeforeRequest(details) {
    if (!this.runtime.canBufferRedactedBrowserData() || details.type !== "main_frame" && details.type !== "sub_frame") return;
    let owner = this.navigations.get(bindingKey(details.tabId, details.frameId));
    !owner || typeof details.requestId != "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(details.requestId) || (owner.documentKey !== null || owner.requestId !== null && owner.requestId !== details.requestId ? owner.ambiguous = !0 : owner.requestId = details.requestId);
  }
  observationEvent(documentKey3, observation, ambiguous = !1) {
    let expired = this.runtime.now() - observation.at > 2e3, accessChanged = !observation.requiresAllSitesAccess && observation.accessGeneration !== this.runtime.scope.accessGeneration, headers = ambiguous || expired || accessChanged ? { entries: [], truncated: !0 } : observation.headers, proPeriod = observation.proPeriod;
    if (proPeriod?.navigation) {
      let committed = this.runtime.pro.headerPeriod(Number(documentKey3.split(":")[0]), documentKey3);
      proPeriod = committed?.sessionId === proPeriod.sessionId ? { ...committed, navigation: !1 } : null;
    }
    return {
      type: "network:headers",
      documentKey: documentKey3,
      headers: this.navigationLoss ? { ...headers, truncated: !0 } : headers,
      ...observation.requiresAllSitesAccess ? { requiresAllSitesAccess: !0 } : {},
      proPeriod,
      at: observation.at
    };
  }
  onCompleted = (details) => {
    let runtime = this.runtime;
    if (!runtime.canBufferRedactedBrowserData()) return;
    let requiresAllSitesAccess = !runtime.hydrationComplete;
    if (!requiresAllSitesAccess && (!runtime.scope.accessReady || !runtime.scope.hasAnyHostAccess()) || !Number.isSafeInteger(details.tabId) || details.tabId < 0 || !Number.isSafeInteger(details.frameId) || details.frameId < 0 || typeof details.url != "string") return;
    let host2 = sanitizeHost(details.url), scheme = details.url.startsWith("https://") ? "https" : details.url.startsWith("http://") ? "http" : null;
    if (!host2 || !scheme || !requiresAllSitesAccess && !runtime.scope.isHostGrantedSync(host2, scheme)) return;
    if (details.type !== "main_frame") {
      let initiator = typeof details.initiator == "string" ? details.initiator : "", initiatorHost = sanitizeHost(initiator), initiatorScheme = initiator.startsWith("https://") ? "https" : initiator.startsWith("http://") ? "http" : null;
      if (!initiatorHost || !initiatorScheme || !requiresAllSitesAccess && !runtime.scope.isHostGrantedSync(initiatorHost, initiatorScheme)) return;
    }
    let slot = bindingKey(details.tabId, details.frameId), candidate = details.type === "main_frame" || details.type === "sub_frame" ? this.navigations.get(slot) : void 0, owner = candidate && candidate.requestId === details.requestId && runtime.now() - candidate.at <= 6e4 ? candidate : void 0, explicitDocument = typeof details.documentId == "string" && /^[A-Za-z0-9_-]{1,64}$/.test(details.documentId), documentKey3 = explicitDocument ? makeDocumentKey(details.tabId, details.frameId, details.documentId) : owner?.documentKey ?? null;
    if (owner && (owner.completed = !0), documentKey3 !== null && !requiresAllSitesAccess && !runtime.canObserveNetworkDocument(documentKey3)) return;
    let at2 = runtime.now(), headers;
    try {
      if (headers = normalizeResponseHeaders(details.responseHeaders, !1), !headers.entries.length && !headers.truncated) {
        owner?.documentKey && this.navigations.delete(slot);
        return;
      }
      if (documentKey3 === null && !owner) {
        this.navigationLoss = !0;
        let binding = runtime.state.bindings.get(slot);
        binding && runtime.canObserveNetworkDocument(binding.documentKey) && !runtime.state.metas.get(binding.documentKey)?.responseHeaders?.truncated && runtime.dispatch({ type: "network:headers", documentKey: binding.documentKey, headers: { entries: [], truncated: !0 }, at: at2 });
        return;
      }
      if (this.limiter.tryConsume(documentKey3 ?? "navigation:" + slot, details.tabId, at2)) headers = normalizeResponseHeaders(details.responseHeaders);
      else {
        if (documentKey3 !== null && runtime.state.metas.get(documentKey3)?.responseHeaders?.truncated) return;
        headers = { entries: [], truncated: !0 };
      }
    } catch {
      headers = { entries: [], truncated: !0 };
    }
    let period = runtime.pro.headerPeriod(details.tabId), observation = {
      headers,
      at: at2,
      accessGeneration: runtime.scope.accessGeneration,
      requiresAllSitesAccess,
      proPeriod: period ? { ...period, navigation: details.type === "main_frame" } : null
    };
    if (documentKey3 === null) {
      owner && (owner.response = observation);
      return;
    }
    owner && this.navigations.delete(slot), runtime.dispatch(this.observationEvent(documentKey3, observation, !explicitDocument && owner?.ambiguous === !0));
  };
};
function createResponseHeadersListener(runtime) {
  return runtime.responseHeaders.onCompleted;
}

// packages/contracts/src/google-ids.ts
var GOOGLE_IDS_LIMITS = Object.freeze({
  headerChars: 4096,
  rows: 8,
  ids: 256,
  documents: 8,
  pending: 32,
  documentBytes: 65536,
  ttlMs: 6e5,
  navigationMs: 2e3
}), GOOGLE_IDS_DOMAINS = Object.freeze([
  "google.com",
  "google.co.uk",
  "google.de",
  "google.fr",
  "google.es",
  "google.it",
  "google.ru",
  "google.com.br",
  "google.co.jp",
  "google.co.in",
  "google.ca",
  "google.com.au",
  "youtube.com",
  "doubleclick.net",
  "doubleclick.com",
  "googlesyndication.com",
  "googleadservices.com",
  "googleapis.com",
  "gstatic.com",
  "googleusercontent.com",
  "googlevideo.com",
  "ytimg.com",
  "recaptcha.net"
]);
function isGoogleIdsHost(host2) {
  return typeof host2 == "string" && host2.length <= 253 && /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(host2) && GOOGLE_IDS_DOMAINS.some((domain) => host2 === domain || host2.endsWith("." + domain));
}
function isClientDataHeader(value) {
  if (typeof value != "string" || value.length === 0 || value.length > GOOGLE_IDS_LIMITS.headerChars || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return !1;
  try {
    return btoa(atob(value)) === value;
  } catch {
    return !1;
  }
}
function fields3(value, names4) {
  if (typeof value != "object" || value === null || Array.isArray(value) || Reflect.ownKeys(value).length !== names4.length) return null;
  let result = /* @__PURE__ */ Object.create(null);
  for (let name of names4) {
    let descriptor3 = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor3 || !Object.hasOwn(descriptor3, "value") || !descriptor3.enumerable) return null;
    result[name] = descriptor3.value;
  }
  return result;
}
var nonNegative2 = (value) => typeof value == "number" && Number.isSafeInteger(value) && !Object.is(value, -0) && value >= 0 && value <= 2147483647, documentKey2 = (value) => typeof value == "string" && /^\d{1,10}:\d{1,10}:[A-Za-z0-9_-]{1,64}$/.test(value);
function readGoogleIdsRequest(value) {
  try {
    let record2 = fields3(value, ["schemaVersion", "type", "tabId", "frameId", "documentKey"]);
    return !record2 || record2.schemaVersion !== 1 || record2.type !== "ui-google-ids" || !nonNegative2(record2.tabId) || !nonNegative2(record2.frameId) || !documentKey2(record2.documentKey) || !record2.documentKey.startsWith(record2.tabId + ":" + record2.frameId + ":") ? null : { schemaVersion: 1, type: "ui-google-ids", tabId: record2.tabId, frameId: record2.frameId, documentKey: record2.documentKey };
  } catch {
    return null;
  }
}

// packages/background/src/google-ids.ts
var GOOGLE_IDS_FILTER = { urls: GOOGLE_IDS_DOMAINS.map((host2) => "https://*." + host2 + "/*") }, active5 = (lifecycle) => lifecycle == null || lifecycle === "active", validId = (value) => typeof value == "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value), validNumber = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 2147483647;
function normalizeGoogleClientData(headers, host2) {
  let empty = (status) => ({ host: host2, status, header: null });
  if (!Array.isArray(headers) || headers.length > 128) return empty("unavailable");
  let selected = null;
  for (let index = 0; index < headers.length; index++) {
    let item = Object.getOwnPropertyDescriptor(headers, index);
    if (!item || !Object.hasOwn(item, "value") || typeof item.value != "object" || item.value === null) return empty("unavailable");
    let name = Object.getOwnPropertyDescriptor(item.value, "name");
    if (!name || !Object.hasOwn(name, "value") || typeof name.value != "string" || name.value.length > 128) return empty("unavailable");
    if (name.value.toLowerCase() !== "x-client-data") continue;
    if (selected) return empty("invalid");
    let field3 = Object.getOwnPropertyDescriptor(item.value, "value");
    !field3 || !Object.hasOwn(field3, "value") || typeof field3.value != "string" ? selected = empty("unavailable") : field3.value.length > GOOGLE_IDS_LIMITS.headerChars ? selected = empty("too-large") : isClientDataHeader(field3.value) ? selected = { host: host2, status: "observed", header: field3.value } : selected = empty("invalid");
  }
  return selected ?? empty("not-present");
}
var GoogleIdsManager = class {
  constructor(runtime) {
    this.runtime = runtime;
  }
  runtime;
  snapshots = /* @__PURE__ */ new Map();
  navigations = /* @__PURE__ */ new Map();
  limiter = new RateLimiter();
  operations = /* @__PURE__ */ new Set();
  supported = !1;
  epoch = 0;
  limited = !1;
  setSupported(value) {
    this.supported = value, value || this.clear();
  }
  clear() {
    this.snapshots.clear(), this.navigations.clear(), this.limited = !1, this.epoch++;
    for (let operation of this.operations) operation.invalid = !0;
  }
  prune() {
    let now = this.runtime.now();
    for (let [key2, snapshot] of this.snapshots) {
      for (let [host2, entry] of snapshot.entries) now - entry.at >= GOOGLE_IDS_LIMITS.ttlMs && (snapshot.entries.delete(host2), snapshot.truncated = !0);
      snapshot.entries.size === 0 && (this.snapshots.delete(key2), this.limited = !0);
    }
    for (let [slot, navigation] of this.navigations)
      navigation.observation && now - navigation.observation.at >= GOOGLE_IDS_LIMITS.navigationMs && (navigation.observation = null, navigation.ambiguous = !0, this.limited = !0), now - navigation.at >= 6e4 && (this.navigations.delete(slot), this.limited = !0);
  }
  discard(tabId, frameId) {
    let prefix = tabId + ":" + (frameId === void 0 ? "" : frameId + ":");
    for (let key2 of this.snapshots.keys()) key2.startsWith(prefix) && this.snapshots.delete(key2);
    this.epoch++;
  }
  onBrowserEvent(event) {
    if (this.runtime.scope.hasDataConsent)
      if (this.prune(), event.type === "navigation:before") {
        let slot = bindingKey(event.tabId, event.frameId), previous = this.navigations.get(slot);
        if (this.navigations.size >= GOOGLE_IDS_LIMITS.pending && !previous) {
          let first = this.navigations.keys().next();
          first.done || this.navigations.delete(first.value), this.limited = !0;
        }
        this.navigations.set(slot, {
          at: this.runtime.now(),
          generation: this.runtime.scope.accessGeneration,
          requestId: null,
          ambiguous: previous !== void 0,
          committedHostMatches: !1,
          observation: null
        });
      } else if (event.type === "navigation:committed") {
        let navigation = this.navigations.get(bindingKey(event.tabId, event.frameId));
        navigation && (navigation.committedHostMatches = event.scheme === "https" && event.host === navigation.observation?.row.host);
      } else event.type === "navigation:error" && this.navigations.delete(bindingKey(event.tabId, event.frameId));
  }
  afterEvent(event) {
    if (this.prune(), event.type === "navigation:committed") {
      if (!active5(event.documentLifecycle)) return;
      let slot = bindingKey(event.tabId, event.frameId), navigation = this.navigations.get(slot);
      if (this.navigations.delete(slot), this.discard(event.tabId, event.frameId === 0 ? void 0 : event.frameId), event.frameId === 0) for (let pending of this.navigations.keys()) pending.startsWith(event.tabId + ":") && this.navigations.delete(pending);
      let key2 = makeDocumentKey(event.tabId, event.frameId, event.documentId);
      if (!navigation?.observation) return;
      if (navigation.ambiguous || navigation.generation !== this.runtime.scope.accessGeneration || !navigation.committedHostMatches || !this.runtime.canObserveNetworkDocument(key2)) {
        this.limited = !0;
        return;
      }
      this.store(key2, navigation.observation.row, navigation.observation.at);
    } else if (event.type === "ui:pause" || event.type === "ui:clear" || event.type === "transport:stopped" || event.type === "scope:access" && !event.accessGranted) {
      this.snapshots.delete(event.documentKey);
      let [tab, frame] = event.documentKey.split(":");
      this.navigations.delete(bindingKey(Number(tab), Number(frame))), this.epoch++;
    } else if (event.type === "scope:revoked" || event.type === "frames:retired" || event.type === "document:evict") {
      for (let key2 of event.documentKeys) {
        this.snapshots.delete(key2);
        let [tab, frame] = key2.split(":");
        this.navigations.delete(bindingKey(Number(tab), Number(frame)));
      }
      this.epoch++;
    } else if (event.type === "tab:removed" || event.type === "tab:replaced") {
      let tabId = event.type === "tab:removed" ? event.tabId : event.removedTabId;
      this.discard(tabId);
      for (let slot of this.navigations.keys()) slot.startsWith(tabId + ":") && this.navigations.delete(slot);
    }
  }
  onBeforeRequest(details) {
    if (!this.runtime.scope.hasDataConsent || details.type !== "main_frame" && details.type !== "sub_frame") return;
    let navigation = this.navigations.get(bindingKey(details.tabId, details.frameId));
    !navigation || typeof details.requestId != "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(details.requestId) || (navigation.requestId !== null && navigation.requestId !== details.requestId ? (navigation.ambiguous = !0, navigation.observation = null, this.limited = !0) : navigation.requestId = details.requestId);
  }
  store(key2, row, at2) {
    let snapshot = this.snapshots.get(key2);
    if (!snapshot) {
      if (this.snapshots.size >= GOOGLE_IDS_LIMITS.documents) {
        let first = this.snapshots.keys().next();
        first.done || (this.snapshots.delete(first.value), this.epoch++), this.limited = !0;
      }
      snapshot = { entries: /* @__PURE__ */ new Map(), truncated: !1 }, this.snapshots.set(key2, snapshot);
    }
    if (!snapshot.entries.has(row.host) && snapshot.entries.size >= GOOGLE_IDS_LIMITS.rows) {
      let first = snapshot.entries.keys().next();
      first.done || (snapshot.entries.delete(first.value), this.epoch++), snapshot.truncated = !0;
    }
    snapshot.entries.set(row.host, { row, at: at2 }), row.status !== "observed" && row.status !== "not-present" && (snapshot.truncated = !0);
  }
  onSendHeaders = (details) => {
    let runtime = this.runtime;
    if (this.prune(), !this.supported || !runtime.hydrationComplete || !runtime.scope.accessReady || !runtime.scope.hasAnyHostAccess() || !validNumber(details.tabId) || !validNumber(details.frameId) || !active5(details.documentLifecycle) || typeof details.url != "string" || !details.url.startsWith("https://")) return;
    let host2 = sanitizeHost(details.url);
    if (!isGoogleIdsHost(host2) || !runtime.scope.isHostGrantedSync(host2, "https")) return;
    if (details.type !== "main_frame") {
      let initiator = details.initiator, origin = typeof initiator == "string" ? sanitizeHost(initiator) : null, scheme = initiator?.startsWith("https://") ? "https" : initiator?.startsWith("http://") ? "http" : null;
      if (!origin || !scheme || !runtime.scope.isHostGrantedSync(origin, scheme)) return;
    }
    let navigation = details.type === "main_frame" || details.type === "sub_frame", slot = bindingKey(details.tabId, details.frameId), owner = navigation ? this.navigations.get(slot) : void 0;
    if (navigation && (runtime.scope.getScopeMode() !== "all-sites" || !runtime.scope.getState().grantedAllSites || !owner || owner.ambiguous || owner.requestId !== details.requestId || owner.generation !== runtime.scope.accessGeneration)) {
      this.limited = !0;
      return;
    }
    let key2 = !navigation && validId(details.documentId) ? makeDocumentKey(details.tabId, details.frameId, details.documentId) : null;
    if (!navigation && (!key2 || !runtime.canObserveNetworkDocument(key2))) return;
    let now = runtime.now();
    if (!this.limiter.tryConsume(key2 ?? "navigation:" + slot, details.tabId, now)) {
      this.limited = !0;
      return;
    }
    let row;
    try {
      row = normalizeGoogleClientData(details.requestHeaders, host2);
    } catch {
      row = { host: host2, status: "unavailable", header: null };
    }
    navigation && owner ? (owner.observation && owner.observation.row.host !== host2 && (this.limited = !0), owner.observation = { row, at: now }) : key2 && this.store(key2, row, now);
  };
  state(key2, coverageState, entries = [], truncated = !0) {
    return {
      schemaVersion: 1,
      type: "google-ids-state",
      documentKey: key2,
      evidenceSource: "browser-network",
      integrity: "browser-observed",
      coverageState,
      entries,
      truncated
    };
  }
  async read(request, operation) {
    let runtime = this.runtime;
    if (await runtime.whenReady(), this.prune(), !this.supported) return this.state(request.documentKey, "unsupported");
    if (runtime.state.metas.get(request.documentKey)?.paused) return this.state(request.documentKey, "paused");
    let generation = runtime.scope.accessGeneration, allowed = () => !operation.invalid && operation.epoch === this.epoch && generation === runtime.scope.accessGeneration && runtime.canObserveNetworkDocument(request.documentKey) && runtime.getProjection(request.tabId, request.frameId)?.documentKey === request.documentKey;
    if (!allowed()) return this.state(request.documentKey, "no-access");
    let frames = await runtime.api.webNavigation.getAllFrames({ tabId: request.tabId });
    if (!allowed() || !Array.isArray(frames) || frames.length > 1024) return this.state(request.documentKey, "no-access");
    let frame = frames.find((item) => item.frameId === request.frameId && makeDocumentKey(request.tabId, item.frameId, item.documentId ?? "") === request.documentKey && active5(item.documentLifecycle) && !item.errorOccurred);
    if (!frame) return this.state(request.documentKey, "no-access");
    let current = frame;
    for (let depth = 0; depth < 128 && (current.url === "about:blank" || current.url === "about:srcdoc"); depth++) {
      let parent = frames.find((item) => item.documentId === current.parentDocumentId && active5(item.documentLifecycle) && !item.errorOccurred);
      if (!parent) return this.state(request.documentKey, "no-access");
      current = parent;
    }
    let host2 = sanitizeHost(current.url), scheme = current.url.startsWith("https://") ? "https" : current.url.startsWith("http://") ? "http" : null;
    if (!host2 || !scheme || !await runtime.scope.isGranted(scheme + "://" + host2 + "/*", request.tabId, frame.documentId) || !allowed())
      return this.state(request.documentKey, "no-access");
    let snapshot = this.snapshots.get(request.documentKey), captured = [...snapshot?.entries.values() ?? []].map((entry) => ({ row: { ...entry.row }, at: entry.at }));
    for (let { row } of captured)
      if (!runtime.scope.isHostGrantedSync(row.host, "https") || !await runtime.api.permissions.contains({ origins: ["https://" + row.host + "/*"] }) || !allowed())
        return this.state(request.documentKey, "no-access");
    let currentFrames = await runtime.api.webNavigation.getAllFrames({ tabId: request.tabId });
    if (!allowed() || !Array.isArray(currentFrames) || currentFrames.length > 1024 || !currentFrames.some((item) => item.frameId === request.frameId && item.documentId === frame.documentId && active5(item.documentLifecycle) && !item.errorOccurred)) return this.state(request.documentKey, "no-access");
    this.prune();
    let entries = captured.filter((entry) => runtime.now() - entry.at < GOOGLE_IDS_LIMITS.ttlMs).map((entry) => entry.row);
    return this.state(request.documentKey, "partial", entries, this.limited || entries.length !== captured.length || (snapshot?.truncated ?? !1));
  }
  route(message, sender) {
    if (typeof message != "object" || message === null || Object.getOwnPropertyDescriptor(message, "type")?.value !== "ui-google-ids") return null;
    if (!verifyUiSender(sender, this.runtime.api.runtime.id)) return Promise.resolve({ schemaVersion: 1, type: "error", code: "unauthorized-sender" });
    let request = readGoogleIdsRequest(message);
    if (!request) return Promise.resolve({ schemaVersion: 1, type: "error", code: "invalid-request" });
    if (this.operations.size >= 4) return Promise.resolve(this.state(request.documentKey, "degraded"));
    let operation = { epoch: this.epoch, invalid: !1 };
    this.operations.add(operation);
    let work = this.read(request, operation).catch(() => this.state(request.documentKey, "no-access")).finally(() => this.operations.delete(operation)), timer;
    return Promise.race([work, new Promise((resolve) => {
      timer = setTimeout(() => {
        operation.invalid = !0, resolve(this.state(request.documentKey, "degraded"));
      }, 2e3);
    })]).finally(() => {
      timer !== void 0 && clearTimeout(timer);
    });
  }
};

// packages/background/src/runtime.ts
function uiError(code2) {
  return { schemaVersion: 1, type: "error", code: code2 };
}
function ack2(lastCommittedBatchSeq, paused, protocolOk) {
  return { schemaVersion: 1, type: "ack", lastCommittedBatchSeq, paused, protocolOk };
}
var BackgroundRuntime = class {
  state = createInitialState();
  scope;
  repository;
  limiter = new RateLimiter();
  api;
  visual;
  rtc;
  badge;
  pro;
  networkAttempts;
  protection;
  apiResults;
  responseHeaders;
  googleIds;
  engine;
  clock;
  maxPending;
  persistDebounceMs;
  ttlIntervalMs;
  maxPersistAttempts;
  ready;
  resolveReady = () => {
  };
  isReady = !1;
  started = !1;
  consentChain = Promise.resolve();
  consentPending = 0;
  pending = [];
  pendingDropped = 0;
  pendingNetworkLoss = !1;
  pendingPageBatches = 0;
  pendingPageDrops = /* @__PURE__ */ new Map();
  dirtyDocs = /* @__PURE__ */ new Set();
  indexDirty = !1;
  indexRevision = 0;
  indexTimer = null;
  persistTimers = /* @__PURE__ */ new Map();
  /** Last watermark that reached storage per document (ACK reports this, never the in-memory one). */
  persisted = /* @__PURE__ */ new Map();
  transportDrops = /* @__PURE__ */ new Map();
  estimated = /* @__PURE__ */ new Map();
  lastMeasuredBytes = null;
  lastBudgetCheck = 0;
  budgetCheckRunning = !1;
  budgetCheckCompletion = Promise.resolve();
  persistFailures = 0;
  persistCooldownUntil = 0;
  degraded = !1;
  ttlTimer = null;
  lastSweepAt = -1 / 0;
  lastFrameReconcileAt = 0;
  frameReconcileRunning = !1;
  frameReconcileCursor = 0;
  /** Only identities actually exposed by getAllFrames can later be proven absent by that API. */
  enumeratedFrames = /* @__PURE__ */ new Set();
  constructor(api, options = {}) {
    this.api = api, this.apiResults = new ApiResultsManager(this), this.responseHeaders = new ResponseHeadersObserver(this), this.googleIds = new GoogleIdsManager(this), this.visual = new VisualPreviewManager(this), this.rtc = new RtcDetailsManager(this), this.badge = new BadgeManager(api, () => this.state, (key2) => this.hasDocumentAccess(key2), () => ({ observing: this.scope.hasDataConsent && this.scope.getScopeMode() !== "off", blocking: this.protection.settings.enabled && this.protection.registration !== "error" && !this.protection.accessUnavailable })), this.pro = new ProRecordingManager(this), this.networkAttempts = new NetworkAttemptObserver(this), this.engine = options.engine ?? noopEngine, this.clock = options.clock ?? systemClock, this.maxPending = options.maxPendingEvents ?? 256, this.persistDebounceMs = options.persistDebounceMs ?? BUDGETS.flushMaxMs, this.ttlIntervalMs = options.ttlIntervalMs ?? 6e4, this.maxPersistAttempts = Math.max(1, Math.min(3, options.maxPersistAttempts ?? 3)), this.scope = new ScopeController(api, this.clock, options.testBootstrap), this.protection = new ProtectionController(api, this.scope, () => { this.badge.markAll(); this.apiConfiguration?.legacyChanged(); }), this.repository = new SessionRepository(api.storage.session), this.ready = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
    this.cookies = new CookieInspector(this, { host: sanitizeHost, redact: redactHost, site: registrableDomain });
    this.proCookieValues = new ProCookieValuesObserver(this, { site: registrableDomain });
    this.proRequestValues = new ProRequestValuesObserver(this, { site: registrableDomain });
    this.social = new SocialNetworkObserver(this, { host: sanitizeHost, redact: redactHost });
    this.thirdParty = new ThirdPartyObserver(this, { host: sanitizeHost, redact: redactHost });
    this.vendorRedirects = createRuntimeVendorRedirects(this);
    this.beacons = new BeaconObserver(this, { host: sanitizeHost, redact: redactHost });
    this.backgroundActivity = new BackgroundActivityObserver(this, { redact: redactHost });
    this.cookieWriters = new CookieWriterObserver(this, { redact: redactHost });
    this.cookieProbe = new CookieProbe(this.cookies, { onUpdate: snapshot => retainCookieProbe(this.pro, snapshot) });
    this.siteIcons = new SiteFaviconCache(api, {
      ready: this.ready,
      host: url => reportHost(sanitizeHost(url)),
      authorize: ({ tabId, frame, origin }) => this.scope.accessReady && this.scope.inScope(sanitizeHost(frame.url), tabId, frame.documentId, origin.startsWith("https:") ? "https" : "http")
    });
  }
  now() {
    return this.clock.now();
  }
  whenReady() {
    return this.ready;
  }
  get hydrationComplete() {
    return this.isReady && this.historyLoaded;
  }
  canCollectBrowserData() {
    if (this.scope.hasDataConsent) return true;
    if (!this.isReady) this.pendingNetworkLoss = true;
    return false;
  }
  canBufferRedactedBrowserData() {
    return this.scope.hasDataConsent || !this.scope.dataConsentLoaded;
  }
  /** P07 / REQ-011: the message listener must not retain unlimited payloads during hydration. */
  async whenPageReady(documentKey) {
    if (this.isReady && this.historyLoaded && this.historyLoading === null) return true;
    if (this.pendingPageBatches >= BUDGETS.maxOutOfOrderEntriesGlobal) {
      this.pendingDropped = Math.min(BUDGETS.maxCount, this.pendingDropped + 1);
      this.countTransportDrop(documentKey);
      return false;
    }
    this.pendingPageBatches++;
    try {
      await this.ready;
      await this.ensureHistory();
      return true;
    } finally {
      this.pendingPageBatches--;
    }
  }
  // ---------------------------------------------------------------------------
  // Hydration (A10): restore snapshots, bindings and watermarks, reconcile with live frames, then drain.
  // ---------------------------------------------------------------------------
  async start() {
    if (this.started) return this.ready;
    this.started = true;
    try {
      await this.repository.init();
      await this.scope.startup();
      if (this.scope.hasDataConsent) {
        await this.ensureHistory();
      } else if (!await this.discardUnconsentedData()) this.degraded = true;
    } catch {
      this.state = createInitialState();
      this.degraded = true;
      if (!this.scope.hasDataConsent) await this.discardUnconsentedData();
    }
    this.isReady = true;
    this.finishHistoryReadiness();
    this.badge.start();
    this.resolveReady();
    this.lastFrameReconcileAt = this.now();
    this.ttlTick();
    if (this.ttlIntervalMs > 0 && this.ttlTimer === null) {
      this.ttlTimer = setInterval(() => this.ttlTick(), this.ttlIntervalMs);
    }
    await this.protection.start();
    void this.siteIcons.refresh();
}
  documentAccess = /* @__PURE__ */ new Map();
  hasDocumentAccess(key2) {
    return this.scope.accessReady && this.documentAccess.get(key2) === this.scope.accessGeneration;
  }
  grantDocumentAccess(key2) {
    this.scope.accessReady && this.documentAccess.set(key2, this.scope.accessGeneration);
  }
  canObserveNetworkDocument(key) {
    return this.isReady && this.historyLoaded && this.hasNetworkDocumentAccess(key);
  }
  hasNetworkDocumentAccess(key2) {
    if (!this.hasDocumentAccess(key2)) return !1;
    let [tab, frame] = key2.split(":"), binding = this.state.bindings.get(bindingKey(Number(tab), Number(frame))), meta = this.state.metas.get(key2);
    return binding?.documentKey === key2 && binding.accessGranted === !0 && (binding.documentLifecycle === null || binding.documentLifecycle === "active") && !meta?.paused && !meta?.revoked && meta?.accessGranted !== !1;
  }
  /** A new explicit Pro observation period starts a fresh ephemeral classifier window. */
  resetNetworkProbeWindows(documentKeys, tabId, cutoffAt) {
    this.networkAttempts.resetWindows(documentKeys, tabId, cutoffAt);
  }
  hydrate(index, documents) {
    let reports = new Map(this.state.reports), metas = new Map(this.state.metas), bindings = new Map(this.state.bindings), tabs = new Map(this.state.tabs);
    for (let doc of documents) {
      let meta = { ...doc.meta, bound: doc.meta.bound };
      Object.keys(meta.folded).length > 0 && (meta.boots = [], meta.folded = {}, meta.degraded = !0, doc.report.coverageFlags = ["truncated"]), meta.findingsCap ??= BUDGETS.maxFindingsPerDocument, reports.set(doc.report.documentKey, doc.report), metas.set(doc.report.documentKey, meta), this.persisted.set(doc.report.documentKey, new Map(meta.sessions.map((w) => [w.bridgeSessionId, w.lastCommittedBatchSeq]))), this.estimated.set(doc.report.documentKey, estimateReportBytes(doc.report, meta));
    }
    if (index !== null) {
      for (let b of index.bindings) {
        let isPrerender = b.documentLifecycle === "prerender", binding = reports.has(b.documentKey) || b.apiResultsResetRequired === !1 ? b : { ...b, apiResultsResetRequired: !0 };
        bindings.set(String(b.tabId) + ":" + String(b.frameId) + (isPrerender ? ":p" : ""), binding);
        let meta = metas.get(b.documentKey);
        meta !== void 0 && meta.bound && metas.set(b.documentKey, { ...meta, bound: !0 });
      }
      for (let t of index.tabs) tabs.set(t.tabId, t);
    }
    this.state = { ...this.state, reports, metas, bindings, tabs, evictedKeys: index?.evictedKeys ?? [] };
  }
  /** Reconciliation with tabs.query + webNavigation.getAllFrames (ADR-005 §6); stale bindings are dropped. */
  async reconcile() {
    let live = /* @__PURE__ */ new Set(), liveDocuments = /* @__PURE__ */ new Set(), unavailableTabs = /* @__PURE__ */ new Set(), commits = [], tabs = [];
    try {
      tabs = await this.api.tabs.query({});
    } catch {
      this.sweepExpired(this.now());
      return;
    }
    for (let tab of tabs) {
      if (typeof tab.id != "number" || tab.id < 0) continue;
      let frames = null;
      try {
        frames = await this.api.webNavigation.getAllFrames({ tabId: tab.id });
      } catch {
        frames = null;
      }
      if (!Array.isArray(frames)) {
        unavailableTabs.add(tab.id), this.degraded = !0;
        continue;
      }
      for (let f of frames)
        typeof f.documentId != "string" || typeof f.frameId != "number" || (f.frameId === 0 && live.add(String(tab.id) + ":" + f.documentId), liveDocuments.add(String(tab.id) + ":" + f.frameId + ":" + f.documentId), this.enumeratedFrames.size < 1024 && this.enumeratedFrames.add(String(tab.id) + ":" + f.frameId + ":" + f.documentId), commits.push({
          type: "navigation:committed",
          tabId: tab.id,
          frameId: f.frameId,
          documentId: f.documentId,
          parentDocumentId: typeof f.parentDocumentId == "string" ? f.parentDocumentId : null,
          frameType: readFrameType(f.frameType),
          documentLifecycle: readLifecycle(f.documentLifecycle),
          host: sanitizeHost(f.url),
          ...f.url.startsWith("https://") ? { scheme: "https" } : f.url.startsWith("http://") ? { scheme: "http" } : {},
          at: this.now()
        }));
    }
    await this.scope.reconcileActiveTabs(live);
    let liveTabIds = new Set(tabs.flatMap((tab) => typeof tab.id == "number" ? [tab.id] : [])), projections = new Map(this.state.tabs);
    for (let id4 of projections.keys()) liveTabIds.has(id4) || projections.delete(id4);
    projections.size !== this.state.tabs.size && (this.state = { ...this.state, tabs: projections }, this.markIndexDirty(), this.scheduleIndexFlush());
    let stale = [];
    for (let b of this.state.bindings.values())
      unavailableTabs.has(b.tabId) || liveDocuments.has(b.documentKey) || liveTabIds.has(b.tabId) && (b.documentLifecycle === "cached" || b.documentLifecycle === "prerender" || b.frameId !== 0 && b.scheme === void 0 && !this.enumeratedFrames.has(b.documentKey)) || stale.push(b);
    let staleKeys = new Set(stale.map((binding) => binding.documentKey)), boundKeys = new Set([...this.state.bindings.values()].map((binding) => binding.documentKey)), staleMetas = [...this.state.metas.values()].filter((meta) => meta.bound && (staleKeys.has(meta.documentKey) || !boundKeys.has(meta.documentKey) && !unavailableTabs.has(this.state.reports.get(meta.documentKey)?.tabId ?? -1) && !liveDocuments.has(meta.documentKey)));
    if (stale.length > 0 || staleMetas.length > 0) {
      let bindings = new Map(this.state.bindings), metas = new Map(this.state.metas);
      for (let b of stale)
        for (let [k, v] of bindings) v === b && bindings.delete(k);
      for (let meta of staleMetas)
        metas.set(meta.documentKey, { ...meta, bound: !1 }), this.dirtyDocs.add(meta.documentKey), this.schedulePersist(meta.documentKey);
      this.state = { ...this.state, bindings, metas }, this.markIndexDirty(), this.scheduleIndexFlush();
    }
    this.sweepExpired(this.now());
    for (let event of commits) this.apply(event);
  }
  /** F013/F017: bounded, non-overlapping frame cleanup while a long-lived SPA keeps this SW alive. */
  async reconcileFrames() {
    const now = this.now();
    if (!this.isReady || !this.historyLoaded || this.frameReconcileRunning || now >= this.lastFrameReconcileAt && now - this.lastFrameReconcileAt < 1e4) return;
    this.lastFrameReconcileAt = now;
    this.frameReconcileRunning = true;
    try {
      const boundKeys = new Set([...this.state.bindings.values()].map((binding) => binding.documentKey));
      for (const key of this.enumeratedFrames) if (!boundKeys.has(key)) this.enumeratedFrames.delete(key);
      const tabIds = [...new Set([...this.state.bindings.values()].map((binding) => binding.tabId))];
      const count = Math.min(16, tabIds.length);
      for (let i = 0; i < count; i++) {
        const tabId = tabIds[(this.frameReconcileCursor + i) % tabIds.length];
        if (tabId === void 0) continue;
        const topKey = this.state.tabs.get(tabId)?.activeTopDocumentKey;
        const snapshot = [...this.state.bindings.values()].filter((binding) => binding.tabId === tabId);
        let frames;
        try {
          frames = await this.api.webNavigation.getAllFrames({ tabId });
        } catch {
          continue;
        }
        if (!Array.isArray(frames) || frames.length > 1024 || frames.some((frame) => typeof frame.documentId !== "string" || typeof frame.frameId !== "number") || this.state.tabs.get(tabId)?.activeTopDocumentKey !== topKey) continue;
        const top = frames.find((frame) => frame.frameId === 0 && frame.documentLifecycle !== "prerender" && frame.documentLifecycle !== "cached");
        if (!top?.documentId || String(tabId) + ":0:" + top.documentId !== topKey) continue;
        const live = /* @__PURE__ */ new Set();
        for (const frame of frames) {
          if (typeof frame.documentId !== "string" || typeof frame.frameId !== "number") continue;
          const key = String(tabId) + ":" + frame.frameId + ":" + frame.documentId;
          live.add(key);
          if (this.enumeratedFrames.size < 1024) this.enumeratedFrames.add(key);
        }
        const retired = snapshot.filter((binding) => binding.frameId !== 0 && (binding.documentLifecycle === null || binding.documentLifecycle === "active") && (binding.scheme !== void 0 || this.enumeratedFrames.has(binding.documentKey)) && !live.has(binding.documentKey) && this.state.bindings.get(bindingKey(tabId, binding.frameId)) === binding);
        if (retired.length > 0) this.apply({ type: "frames:retired", documentKeys: retired.map((binding) => binding.documentKey), at: this.now() });
      }
      this.frameReconcileCursor = tabIds.length === 0 ? 0 : (this.frameReconcileCursor + count) % tabIds.length;
    } finally {
      this.frameReconcileRunning = false;
    }
  }
  // ---------------------------------------------------------------------------
  // Event application and effects
  // ---------------------------------------------------------------------------
  /** Browser events: buffered (bounded) until hydration finished, then applied in order. */
  dispatch(event) {
    if (!this.scope.hasDataConsent) {
      if (this.isReady) return;
      if (event.type === "navigation:committed") event = { ...event, host: null, accessGranted: false, originPending: true };
      else if (event.type === "navigation:before") event = { ...event, host: null };
      else if (!(!this.scope.dataConsentLoaded && (event.type === "network:host" || event.type === "network:headers")) && event.type !== "navigation:error" && event.type !== "tab:removed" && event.type !== "tab:replaced") return;
    }
    this.visual.onBrowserEvent(event);
    this.rtc.onBrowserEvent(event);
    this.googleIds.onBrowserEvent(event);
    const pendingHeaders = this.responseHeaders.onBrowserEvent(event);
    if (event.type === "navigation:before") event = { ...event, host: null };
    if (event.type === "navigation:committed") {
      const accessGranted = this.scope.accessReady && this.scope.inScope(event.host, event.tabId, event.documentId, event.scheme);
      const top = event.frameType === "outermost_frame" || event.frameType === null && event.frameId === 0;
      if (top && event.documentLifecycle !== "prerender" && this.scope.noteTopCommit(event.tabId, event.host, event.documentId)) {
        for (const key of this.documentAccess.keys()) if (key.startsWith(String(event.tabId) + ":")) this.documentAccess.delete(key);
        this.reconcileAccess();
      }
      event = { ...event, host: reportHost(event.host), accessGranted, originPending: event.originPending === true || !top && (!this.isReady || !this.scope.accessReady) };
    }
    if (!this.isReady || !this.historyLoaded || this.historyLoading !== null) {
      if (this.pending.length >= this.maxPending) {
        const dropped = this.pending.shift();
        if (dropped?.type === "network:host" || dropped?.type === "network:headers") this.pendingNetworkLoss = true;
        this.pendingDropped++;
      }
      this.pending.push(event);
      if (pendingHeaders) this.dispatch(pendingHeaders);
      return;
    }
    if (event.type === "navigation:committed" || event.type === "tab:removed") this.sweepExpired(this.now());
    this.apply(event);
    if (pendingHeaders) this.dispatch(pendingHeaders);
    if (event.type === "navigation:committed") void this.reconcileFrames();
  }
  /** Synchronous reduce + state swap; effects are scheduled (persists queued per document). */
  apply(event, inQueueFor = null) {
    if (!this.historyLoaded || !this.scope.hasDataConsent) return { state: this.state, effects: [] };
    if (event.type === "network:observed" && !this.canObserveNetworkDocument(event.documentKey)) return { state: this.state, effects: [] };
    if (event.type === "network:headers" && (!this.hasNetworkDocumentAccess(event.documentKey) || event.requiresAllSitesAccess && (!this.scope.accessReady || this.scope.getScopeMode() !== "all-sites" || !this.scope.getState().grantedAllSites))) return { state: this.state, effects: [] };
    let accessExpired = false;
    if (event.type === "navigation:before") event = { ...event, host: null };
    if (event.type === "navigation:committed") {
      const top = event.frameType === "outermost_frame" || event.frameType === null && event.frameId === 0;
      if (top && event.documentLifecycle !== "prerender") accessExpired = this.scope.noteTopCommit(event.tabId, event.host, event.documentId);
      const accessKey = String(event.tabId) + ":" + event.frameId + ":" + event.documentId;
      const originPending = !top && (event.originPending === true || event.host === null && event.scheme === void 0);
      const broadStartupAccess = event.originPending === true && event.scheme !== void 0 && this.scope.accessReady && this.scope.getScopeMode() === "all-sites" && this.scope.getState().grantedAllSites;
      const accessGranted = broadStartupAccess || (!this.isReady || originPending) && this.hasDocumentAccess(accessKey) || (event.accessGranted ?? (this.scope.accessReady && this.scope.inScope(event.host, event.tabId, event.documentId, event.scheme)));
      if (accessGranted) this.grantDocumentAccess(accessKey);
      else this.documentAccess.delete(accessKey);
      const host = event.host ?? (originPending && accessGranted ? this.state.reports.get(accessKey)?.host ?? null : null);
      event = { ...event, host: accessGranted ? reportHost(host) : null, accessGranted, originPending: originPending && !accessGranted };
    }
    if (event.type === "network:host") {
      if (event.requiresAllSitesAccess && (!this.scope.accessReady || this.scope.getScopeMode() !== "all-sites" || !this.scope.getState().grantedAllSites)) return { state: this.state, effects: [] };
      const parent = event.resourceType === "sub_frame" && event.parentDocumentId !== null && event.parentFrameId !== null && event.parentFrameId >= 0;
      const documentId = parent ? event.parentDocumentId : event.documentId;
      const frameId = parent ? event.parentFrameId : event.frameId;
      const binding = [...this.state.bindings.values()].find((b) => b.tabId === event.tabId && b.frameId === frameId && b.documentId === documentId);
      if (!binding || !this.hasDocumentAccess(binding.documentKey)) return { state: this.state, effects: [] };
    }
    if (event.type === "tab:removed") {
      for (const key of this.documentAccess.keys()) if (key.startsWith(String(event.tabId) + ":")) this.documentAccess.delete(key);
    }
    const before = this.state;
    const result = reduce(this.state, event, this.engine);
    this.state = result.state;
    if (event.type === "navigation:committed") {
      const key = String(event.tabId) + ":" + event.frameId + ":" + event.documentId;
      const fence = this.repository.clearFence(key);
      if (fence !== void 0 && this.state.metas.get(key)?.clearEpoch !== fence.bridgeSessionId) {
        this.state = reduce(this.state, { type: "ui:clear", documentKey: key, fence, at: this.now() }, this.engine).state;
      }
    }
    this.visual.afterEvent(event);
    this.rtc.afterEvent(event);
    this.apiResults.afterEvent(event);
    this.googleIds.afterEvent(event);
    this.networkAttempts.afterEvent(event, before);
    this.pro.afterEvent(event, before);
    this.proCookieValues.onEvent(event); this.proRequestValues.onEvent(event);
    if (this.documentAccess.size > 1024) {
      this.documentAccess.clear();
      this.reconcileAccess();
    }
    this.runEffects(result.effects, inQueueFor, before);
    if (accessExpired) this.reconcileAccess();
    this.badge.afterEvent(event, before);
    return result;
  }
  runEffects(effects, inQueueFor, before) {
    for (let effect of effects)
      switch (effect.type) {
        case "persist":
          if (this.dirtyDocs.add(effect.documentKey), effect.documentKey === inQueueFor) break;
          effect.immediate ? this.queuePersist(effect.documentKey) : this.schedulePersist(effect.documentKey);
          break;
        case "remove":
          for (let key2 of effect.documentKeys) this.queueRemove(key2, [...before.bindings.values()].some((binding) => binding.documentKey === key2));
          break;
        case "persist-index":
          this.markIndexDirty(), this.scheduleIndexFlush();
          break;
      }
  }
  queuePersist(documentKey3) {
    let timer = this.persistTimers.get(documentKey3);
    timer !== void 0 && (clearTimeout(timer), this.persistTimers.delete(documentKey3)), this.repository.run(documentKey3, () => this.persistNow(documentKey3));
  }
  schedulePersist(documentKey3) {
    if (this.persistTimers.has(documentKey3)) return;
    let timer = setTimeout(() => {
      this.persistTimers.delete(documentKey3), this.repository.run(documentKey3, () => this.persistNow(documentKey3));
    }, this.persistDebounceMs);
    this.persistTimers.set(documentKey3, timer);
  }
  queueRemove(documentKey, resetPreview) {
    const timer = this.persistTimers.get(documentKey);
    if (timer !== void 0) {
      clearTimeout(timer);
      this.persistTimers.delete(documentKey);
    }
    this.dirtyDocs.delete(documentKey);
    this.persisted.delete(documentKey);
    this.estimated.delete(documentKey);
    void this.repository.run(documentKey, async () => {
      if (resetPreview && (this.state.evictedKeys.includes(documentKey) || [...this.state.bindings.values()].some((binding) => binding.documentKey === documentKey && binding.apiResultsResetRequired)) && !await this.persistApiResultsReset()) return;
      const tabId = Number(documentKey.split(":", 1)[0]);
      await this.repository.remove([documentKey], !this.state.tabs.has(tabId));
    });
    this.markIndexDirty();
    this.scheduleIndexFlush();
  }
  markIndexDirty() {
    this.indexDirty = !0, this.indexRevision++;
  }
  scheduleIndexFlush() {
    this.indexTimer === null && (this.indexTimer = setTimeout(() => {
      this.indexTimer = null, this.flushIndex();
    }, BUDGETS.flushMinMs));
  }
  /** Flushes the index unless a document commit already carried it. */
  async flushIndex() {
    if (!this.historyLoaded) return;
    if (!this.indexDirty || this.now() < this.persistCooldownUntil) return;
    const revision = this.indexRevision;
    const ok = await this.repository.saveIndex(this.buildIndex());
    if (ok && revision === this.indexRevision) this.indexDirty = false;
  }
  buildIndex() {
    return { v: 1, evictedKeys: [...this.state.evictedKeys], bindings: [...this.state.bindings.values()].map((b) => ({ ...b, boundAt: Math.floor(b.boundAt / 1e3) * 1e3 })), tabs: [...this.state.tabs.values()], savedAt: Math.floor(this.now() / 1e3) * 1e3 };
  }
  markApiResultsReset(documentKeys, required) {
    let keys4 = new Set(documentKeys), bindings = new Map(this.state.bindings), changed = !1;
    for (let [slot, binding] of bindings) if (keys4.has(binding.documentKey) && binding.apiResultsResetRequired === !0 !== required) {
      let next = { ...binding };
      next.apiResultsResetRequired = required, bindings.set(slot, next), changed = !0;
    }
    changed && (this.state = { ...this.state, bindings }, this.markIndexDirty());
  }
  async persistApiResultsReset() {
    if (!this.historyLoaded) return false;
    const revision = this.indexRevision;
    const ok = await this.repository.saveIndex(this.buildIndex());
    if (ok && revision === this.indexRevision) this.indexDirty = false;
    return ok;
  }
  /**
   * Persists one document (must run inside its queue). Bounded: at most maxPersistAttempts set() calls;
   * on quota/storage errors the document is degraded+truncated and LRU inactive documents are evicted
   * between attempts. Returns false when storage kept failing (in-memory state stays, ACK stays behind).
   */
  async persistNow(documentKey) {
    if (!this.historyLoaded) return false;
    if (this.now() < this.persistCooldownUntil) return false;
    this.foldTransportDrops(documentKey);
    for (let attempt = 0; attempt < this.maxPersistAttempts; attempt++) {
      const report = this.state.reports.get(documentKey);
      const meta = this.state.metas.get(documentKey);
      if (report === void 0 || meta === void 0) {
        this.dirtyDocs.delete(documentKey);
        return true;
      }
      let estimate = estimateReportBytes(report, meta);
      for (let shrink = 0; estimate > BUDGETS.maxReportSerializedBytes && shrink < 9; shrink++) {
        this.apply({ type: "document:degraded", documentKey, truncate: true, at: this.now() }, documentKey);
        const r2 = this.state.reports.get(documentKey);
        const m2 = this.state.metas.get(documentKey);
        if (r2 === void 0 || m2 === void 0) return true;
        estimate = estimateReportBytes(r2, m2);
      }
      if (estimate > BUDGETS.maxReportSerializedBytes) {
        this.degraded = true;
        return false;
      }
      const current = this.state.reports.get(documentKey);
      const currentMeta = this.state.metas.get(documentKey);
      if (current === void 0 || currentMeta === void 0) return true;
      const record = { v: 1, report: current, meta: currentMeta };
      const indexRevision = this.indexRevision;
      const index = this.indexDirty ? this.buildIndex() : null;
      const result = await this.repository.commit(documentKey, record, index);
      if (result.ok) {
        if (this.state.reports.get(documentKey) === current) this.dirtyDocs.delete(documentKey);
        if (index !== null && indexRevision === this.indexRevision) this.indexDirty = false;
        this.estimated.set(documentKey, estimate);
        this.persisted.set(documentKey, new Map(currentMeta.sessions.map((w) => [w.bridgeSessionId, w.lastCommittedBatchSeq])));
        void this.enforceTotalBudget();
        this.onProtectReportPersisted?.(documentKey, current, currentMeta);
        return true;
      }
      this.persistFailures++;
      this.degraded = true;
      if (!this.state.reports.has(documentKey) || !this.state.metas.has(documentKey)) return false;
      this.apply({ type: "document:degraded", documentKey, truncate: true, at: this.now() }, documentKey);
      const victims = planEviction(this.state, /* @__PURE__ */ new Set([documentKey])).slice(0, 8);
      if (victims.length > 0) {
        this.apply({ type: "document:evict", documentKeys: victims, at: this.now() }, documentKey);
      }
    }
    this.persistCooldownUntil = this.now() + 5e3;
    return false;
  }
  /** ADR-023 gives the separately bounded Pro recording its own allowance; Light retains its 4 MiB. */
  async ordinaryMeasuredBytes() {
    let total = await this.repository.bytesInUse();
    // ADR-047 protect session budget start
    // The module's own storage.session data (bounded at 1 MiB, vendored maxProtectSessionBytes) never evicts reports.
    if (this.lastMeasuredBytes = total, total !== null && typeof this.protectSessionKeys == "function") {
      let protectKeys = null;
      try {
        protectKeys = await this.protectSessionKeys();
      } catch {
        protectKeys = null;
      }
      let protectBytes = Array.isArray(protectKeys) && protectKeys.length > 0 ? await this.repository.bytesInUse(protectKeys) : 0;
      protectBytes !== null && (total = Math.max(0, total - Math.min(protectBytes, 1048576)));
    }
    if (total === null || !this.pro.hasSession()) return total;
    // ADR-047 protect session budget end
    let pro = await this.repository.bytesInUse([PRO_STORAGE_KEY]);
    return pro === null ? null : Math.max(0, total - Math.min(pro, PRO_LIMITS.maxBytes));
  }
  /** Ordinary session budget: browser memory estimate, with the separate Pro allowance removed. */
  async enforceTotalBudget(force = !1) {
    let now = this.now();
    if (this.budgetCheckRunning)
      return force ? (await this.budgetCheckCompletion, this.enforceTotalBudget(!0)) : void 0;
    if (!force && now - this.lastBudgetCheck < 1e3) return;
    this.budgetCheckRunning = !0;
    let completeBudgetCheck = () => {
    };
    this.budgetCheckCompletion = new Promise((resolve) => {
      completeBudgetCheck = resolve;
    }), this.lastBudgetCheck = now;
    try {
      let measured = await this.ordinaryMeasuredBytes(), bytes = measured ?? this.estimatedTotal();
      if (bytes <= BUDGETS.maxSessionTotalBytes || this.rtc.estimatedBytes() > 128 && (await this.rtc.dropForBudget().catch(() => {
        this.degraded = !0;
      }), bytes = await this.ordinaryMeasuredBytes() ?? this.estimatedTotal(), bytes <= BUDGETS.maxSessionTotalBytes))
        return;
      let candidates = planEviction(this.state);
      for (let key2 of candidates) {
        if (bytes <= BUDGETS.maxSessionTotalBytes) break;
        let size = measured === null ? null : await this.repository.bytesInUse(["doc:" + key2]), report2 = this.state.reports.get(key2), meta = this.state.metas.get(key2);
        !report2 || !meta || isProjected(this.state, key2) || (bytes -= size ?? this.estimated.get(key2) ?? estimateReportBytes(report2, meta), this.apply({ type: "document:evict", documentKeys: [key2], at: now }));
      }
      if (bytes > BUDGETS.maxSessionTotalBytes) {
        if (await Promise.all(candidates.map((key2) => this.repository.run(key2, async () => {
        }))), bytes = await this.ordinaryMeasuredBytes() ?? this.estimatedTotal(), bytes <= BUDGETS.maxSessionTotalBytes) return;
        let projected = [...this.state.metas.keys()].filter((k) => isProjected(this.state, k));
        projected.sort((a, b) => (this.estimated.get(b) ?? 0) - (this.estimated.get(a) ?? 0));
        for (let key2 of projected.slice(0, 4))
          this.apply({ type: "document:degraded", documentKey: key2, truncate: !0, at: now }), this.queuePersist(key2);
      }
    } finally {
      this.budgetCheckRunning = !1, completeBudgetCheck();
    }
  }
  /** Sum of the exact sizes measured at each persist (docs/PROJECT_RULES.md: no re-serialization of every report per check). */
  estimatedTotal() {
    let total = this.repository.clearFenceBytes;
    for (const v of this.estimated.values()) total += v;
    total += this.rtc.estimatedBytes();
    return total;
  }
  ttlTick() {
    this.isReady && (this.sweepExpired(this.now()), this.reconcileFrames());
  }
  /** P02 / F171: events resume retention after SW suspension; at most one scan per 30 seconds. */
  sweepExpired(now) {
    if (!this.historyLoaded) return;
    if (now >= this.lastSweepAt && now - this.lastSweepAt < 3e4) return;
    this.lastSweepAt = now;
    this.apply({ type: "ttl-tick", at: now });
  }
  stop() {
    this.googleIds.clear(), this.networkAttempts.clear(), this.pro.dispose(), this.badge.stop(), this.visual.stop(), this.rtc.stop(), this.ttlTimer !== null && (clearInterval(this.ttlTimer), this.ttlTimer = null), this.indexTimer !== null && (clearTimeout(this.indexTimer), this.indexTimer = null);
    for (let t of this.persistTimers.values()) clearTimeout(t);
    this.persistTimers.clear();
  }
  // ---------------------------------------------------------------------------
  // Content channel
  // ---------------------------------------------------------------------------
  /** F020: persist a trusted transport stop before the ACK disables further diagnostics. */
  async recordTerminalStop(ctx, reason) {
    if (!await this.whenPageReady(ctx.documentKey)) return;
    await this.repository.run(ctx.documentKey, async () => {
      const meta = this.state.metas.get(ctx.documentKey);
      if (!meta?.bound || meta.revoked) return;
      if (reason === "revoked") {
        this.documentAccess.delete(ctx.documentKey);
        this.apply({ type: "scope:revoked", documentKeys: [ctx.documentKey], at: this.now() }, ctx.documentKey);
      } else if (this.hasDocumentAccess(ctx.documentKey)) {
        this.apply({ type: "transport:stopped", documentKey: ctx.documentKey, reason, at: this.now() }, ctx.documentKey);
      } else return;
      await this.persistNow(ctx.documentKey);
      await this.visual.flush();
      await this.rtc.flush();
    });
  }
  persistedSeq(documentKey3, bridgeSessionId) {
    return this.persisted.get(documentKey3)?.get(bridgeSessionId) ?? 0;
  }
  lastPersistedSeq(documentKey3, bridgeSessionId) {
    if (bridgeSessionId !== void 0) return this.persistedSeq(documentKey3, bridgeSessionId);
    let id4 = this.state.reports.get(documentKey3)?.watermark?.bridgeSessionId;
    return id4 === void 0 ? 0 : this.persistedSeq(documentKey3, id4);
  }
  isPaused(documentKey3) {
    return this.state.metas.get(documentKey3)?.paused === !0;
  }
  /** Rejected/throttled input costs the document a transport drop and the `throttled` flag. */
  countTransportDrop(documentKey) {
    if (!this.isReady || !this.historyLoaded) {
      if (!this.pendingPageDrops.has(documentKey) && this.pendingPageDrops.size >= BUDGETS.maxOutOfOrderEntriesGlobal) return;
      this.pendingPageDrops.set(documentKey, Math.min(BUDGETS.maxCount, (this.pendingPageDrops.get(documentKey) ?? 0) + 1));
      return;
    }
    const meta = this.state.metas.get(documentKey);
    if (!meta || meta.revoked || meta.accessGranted === false) return;
    if (!this.transportDrops.has(documentKey) && this.transportDrops.size >= 1024) return;
    this.transportDrops.set(documentKey, Math.min(BUDGETS.maxCount, (this.transportDrops.get(documentKey) ?? 0) + 1));
    this.schedulePersist(documentKey);
  }
  foldTransportDrops(documentKey3) {
    let count3 = this.transportDrops.get(documentKey3);
    count3 !== void 0 && (this.transportDrops.delete(documentKey3), this.apply({ type: "transport:dropped", documentKey: documentKey3, count: count3, at: this.now() }, documentKey3));
  }
  admitBatch(ctx) {
    this.isReady && this.sweepExpired(this.now());
    let allowed = this.limiter.tryConsume(ctx.documentKey, ctx.tabId, this.now());
    return allowed || this.countTransportDrop(ctx.documentKey), allowed;
  }
  /** Validated batch from a verified page sender: dedup -> merge -> engine -> save -> ACK (REQ-009). */
  async handleBatch(ctx, batch, admitted = false) {
    await this.ready;
    await this.ensureHistory();
    if (!this.scope.hasDataConsent) return { ...ack2(0, true, true), stopReason: "revoked" };
    this.sweepExpired(this.now());
    if (!this.scope.accessReady) throw new Error("access-changing");
    if (ctx.originPattern !== null) {
      if (!this.scope.inScope(ctx.host, ctx.tabId, ctx.documentId, ctx.originPattern.startsWith("https:") ? "https" : "http")) {
        await this.recordTerminalStop(ctx, "revoked");
        return { ...ack2(0, true, true), stopReason: "revoked" };
      }
      this.grantDocumentAccess(ctx.documentKey);
    }
    ctx = redactSenderContext(ctx);
    if (!admitted && !this.admitBatch(ctx)) {
      return ack2(this.persistedSeq(ctx.documentKey, batch.bridgeSessionId), this.isPaused(ctx.documentKey), true);
    }
    return this.repository.run(ctx.documentKey, async () => {
      if (!this.scope.hasDataConsent) return { ...ack2(0, true, true), stopReason: "revoked" };
      if (!this.scope.accessReady || !this.hasDocumentAccess(ctx.documentKey) && this.state.metas.get(ctx.documentKey)?.accessGranted !== false && !this.state.metas.get(ctx.documentKey)?.revoked) throw new Error("access-changing");
      if (!this.hasDocumentAccess(ctx.documentKey)) return { ...ack2(0, true, true), stopReason: "revoked" };
      const meta = this.state.metas.get(ctx.documentKey);
      if (meta?.accessGranted === false || meta?.revoked) this.apply({ type: "scope:access", documentKey: ctx.documentKey, host: ctx.host, accessGranted: true, at: this.now() }, ctx.documentKey);
      if (meta?.clearEpoch !== void 0 && meta.clearBootIds?.length === 0 && meta.bound) {
        await this.commitClear([ctx.documentKey]);
        return ack2(0, false, true);
      }
      this.foldTransportDrops(ctx.documentKey);
      const result = this.apply({ type: "batch", sender: ctx, batch, at: this.now() }, ctx.documentKey);
      const outcome = result.batch;
      if (outcome === void 0) return ack2(0, false, true);
      switch (outcome.status) {
        case "committed": {
          const ok = await this.persistNow(ctx.documentKey);
          if (!this.scope.hasDataConsent) return { ...ack2(0, true, true), stopReason: "revoked" };
          if (!this.scope.accessReady || !this.hasDocumentAccess(ctx.documentKey) && this.state.metas.get(ctx.documentKey)?.accessGranted !== false && !this.state.metas.get(ctx.documentKey)?.revoked) throw new Error("access-changing");
          if (!this.hasDocumentAccess(ctx.documentKey)) return { ...ack2(0, true, true), stopReason: "revoked" };
          return ack2(ok ? outcome.lastCommittedBatchSeq : this.persistedSeq(ctx.documentKey, batch.bridgeSessionId), false, true);
        }
        case "duplicate": {
          if (this.dirtyDocs.has(ctx.documentKey)) await this.persistNow(ctx.documentKey);
          return ack2(this.persistedSeq(ctx.documentKey, batch.bridgeSessionId), false, true);
        }
        case "paused":
          return ack2(this.persistedSeq(ctx.documentKey, batch.bridgeSessionId), true, true);
        case "revoked":
          return { ...ack2(0, true, true), stopReason: "revoked" };
        case "quarantined":
          return ack2(0, false, true);
      }
    });
  }
  // ---------------------------------------------------------------------------
  // UI channel (read-only projections; pause/resume/clear/export verified against documentKey + revision)
  // ---------------------------------------------------------------------------
  getProjection(tabId, frameId) {
    let key2 = selectDocumentKey(this.state, tabId, frameId);
    return key2 === null ? null : this.projectionByKey(key2);
  }
  projectionByKey(documentKey) {
    if (!this.scope.hasDataConsent) return null;
    if (this.clearingDocs.has(documentKey)) return null;
    const report = this.state.reports.get(documentKey);
    const meta = this.state.metas.get(documentKey);
    if (report === void 0 || meta === void 0 || meta.cleared && !meta.paused) return null;
    const originPending = meta.accessGranted === false && [...this.state.bindings.values()].some((binding) => binding.documentKey === documentKey && binding.originPending === true);
    const pending = this.transportDrops.get(documentKey) ?? 0;
    let flags = pending > 0 && !report.coverageFlags.includes("throttled") ? [...report.coverageFlags, "throttled"] : report.coverageFlags;
    if (!flags.includes("frames-inaccessible") && hasPendingFrameOrigin(this.state, documentKey)) flags = [...flags, "frames-inaccessible"];
    if (meta.accessGranted !== false && !meta.revoked && this.scope.getScopeMode() !== "off" && (!this.scope.hasBroadNetworkAccess() || this.api.__detectExpertCapabilities?.networkDocumentIdentity === false) && !flags.includes("network-limited")) {
      flags = [...flags, "network-limited"];
    }
    try {
      const coverageState = deriveCoverageState(flags, meta);
      const currentCoverage = coverageRef(coverageState, flags);
      const rtcEvidence = this.rtc.vendorEvidence(documentKey);
      return projectReport2(
        {
          ...report,
          coverageFlags: flags,
          coverageState,
          counters: originPending ? [] : report.counters,
          hosts: originPending ? [] : report.hosts,
          findings: originPending ? [] : report.findings.map((finding) => ({ ...finding, coverageRef: currentCoverage })),
          dropped: { ...report.dropped, transport: Math.min(BUDGETS.maxCount, report.dropped.transport + pending) }
        },
        originPending ? { ...meta, firstObservationAt: null } : meta,
        this.scope.getScopeMode(),
        this.now(),
        rtcEvidence.observations.map((observation) => observation.vendor),
        rtcEvidence.observedAt
      );
    } catch {
      return null;
    }
  }
  /** ADR-023: derive Pro findings only from counters observed after this visit's baseline. */
  recordingProjection(documentKey3, baseline, startedAt, retainedCounters, browserBaseline = /* @__PURE__ */ new Map(), retainedBrowserCounters, minimumLocalAttempts = 0) {
    let report2 = this.state.reports.get(documentKey3), meta = this.state.metas.get(documentKey3), ordinary = this.projectionByKey(documentKey3);
    if (!report2 || !meta || !ordinary || ordinary.coverageState === "no-access") return null;
    let counters = (retainedCounters ?? report2.counters).flatMap((counter) => {
      let previous = baseline.get(counterKey(counter.techniqueId, counter.phase, counter.signalCodes, counter.apiOperation, counter.extensionResource)) ?? 0, count3 = Math.max(0, counter.count - (counter.count < previous ? 0 : previous));
      return count3 ? [{ ...counter, count: count3, signalCodes: [...counter.signalCodes] }] : [];
    }), deltaReport = { ...report2, counters, findings: [], coverageState: ordinary.coverageState, coverageFlags: ordinary.coverageFlags }, browserCounters = retainedBrowserCounters ?? meta.networkCounters ?? [], networkCounters = browserCounters.flatMap((counter) => {
      let previous = browserBaseline.get(counterKey(counter.techniqueId, counter.phase, counter.signalCodes)) ?? 0, count3 = Math.max(0, counter.count - (counter.count < previous ? 0 : previous));
      return count3 ? [{ ...counter, count: count3, signalCodes: [...counter.signalCodes] }] : [];
    }), saturatedLocal = browserCounters.find((counter) => counter.techniqueId === "DET-060" && counter.count === BUDGETS.maxCount), localCount = networkCounters.filter((counter) => counter.techniqueId === "DET-060").reduce((sum, counter) => sum + counter.count, 0);
    if (saturatedLocal && minimumLocalAttempts > localCount) {
      let retained = networkCounters.find((counter) => counter.techniqueId === "DET-060" && counter.signalCodes.length === 1);
      retained ? (retained.count += minimumLocalAttempts - localCount, retained.countQuality = "lower-bound") : networkCounters.push({
        techniqueId: "DET-060",
        phase: "attempted",
        signalCodes: ["api-use"],
        count: minimumLocalAttempts - localCount,
        countQuality: "lower-bound",
        firstBucket: saturatedLocal.firstBucket,
        lastBucket: saturatedLocal.lastBucket
      });
    }
    try {
      let findings = this.engine.deriveFindings(deltaReport).slice(0, BUDGETS.maxFindingsPerDocument), rtcEvidence = this.rtc.vendorEvidence(documentKey3), recordingMeta = { ...meta, networkCounters };
      return delete recordingMeta.requestedLocalPorts, delete recordingMeta.responseHeaders, { ...projectReport2(
        { ...deltaReport, findings },
        recordingMeta,
        this.scope.getScopeMode(),
        this.now(),
        rtcEvidence.observations.map((observation) => observation.vendor),
        rtcEvidence.observedAt
      ), observedSince: counters.length || networkCounters.length ? Math.max(startedAt, ordinary.observedSince ?? startedAt) : null };
    } catch {
      return null;
    }
  }
  /**
   * SW -> bridge control (ADR-004 changelog, F030): tells the document's ISOLATED bridge to pause/resume at once.
   * Best effort: a document without a bridge has no listener, and a paused bridge never sends, so an Ack could
   * never carry `paused: false` on its own.
   */
  sendControl(documentKey3, command) {
    let report2 = this.state.reports.get(documentKey3);
    if (report2 === void 0) return;
    let message = { schemaVersion: 1, type: "bridge-control", command };
    try {
      return this.api.tabs.sendMessage(report2.tabId, message, { frameId: report2.frameId, documentId: report2.documentId }).catch(() => {
      });
    } catch {
    }
  }
  checkDocument(tabId, documentKey, reportRevision) {
    const report = this.state.reports.get(documentKey);
    const meta = this.state.metas.get(documentKey);
    if (report === void 0 || meta?.cleared && !meta.paused) return "not-found";
    if (report.tabId !== tabId) return "document-mismatch";
    if (reportRevision !== null && report.revision !== reportRevision) return "stale-revision";
    return null;
  }
  async pause(tabId, documentKey, reportRevision) {
    await this.ready;
    await this.ensureHistory();
    return this.repository.run(documentKey, async () => {
      const error = this.checkDocument(tabId, documentKey, reportRevision);
      if (error !== null) return uiError(error);
      this.vendorRedirects.clearDocument(documentKey); this.pro.vendorRedirects.clearDocument(documentKey);
    this.cookies.forget(documentKey); this.proCookieValues.forget(documentKey); this.proRequestValues.forget(documentKey); this.social.forget(documentKey); this.thirdParty.forget(documentKey); this.beacons.forget(documentKey); this.backgroundActivity.forget(documentKey); this.cookieWriters.forget(documentKey); void this.cookieProbe.invalidate(documentKey); this.precursor?.forget(documentKey);
    const previewReset = await this.apiResults.prepareClear(documentKey);
      if (!previewReset.ready) return uiError("no-access");
      if (previewReset.reset) this.markApiResultsReset([documentKey], false);
      this.apply({ type: "ui:pause", documentKey, at: this.now() }, documentKey);
      await this.persistNow(documentKey);
      await this.visual.flush();
      await this.rtc.flush();
      this.sendControl(documentKey, "pause");
      return { schemaVersion: 1, type: "ok", reportRevision: this.state.reports.get(documentKey)?.revision ?? null };
    });
  }
  async resume(tabId, documentKey, reportRevision) {
    await this.ready;
    await this.ensureHistory();
    return this.repository.run(documentKey, async () => {
      const error = this.checkDocument(tabId, documentKey, reportRevision);
      if (error !== null) return uiError(error);
      this.apply({ type: "ui:resume", documentKey, at: this.now() }, documentKey);
      await this.persistNow(documentKey);
      await this.pro.resumeValueCapture(documentKey, () => this.sendControl(documentKey, "resume"));
      return { schemaVersion: 1, type: "ok", reportRevision: this.state.reports.get(documentKey)?.revision ?? null };
    });
  }
  async clear(tabId, documentKey, reportRevision) {
    await this.ready;
    await this.ensureHistory();
    return this.repository.run(documentKey, async () => {
      const error = this.checkDocument(tabId, documentKey, reportRevision);
      if (error !== null) return uiError(error);
      const previewReset = await this.apiResults.prepareClear(documentKey);
      if (!previewReset.ready) return uiError("no-access");
      this.vendorRedirects.clearDocument(documentKey); this.pro.vendorRedirects.clearDocument(documentKey);
    this.cookies.forget(documentKey); this.proCookieValues.forget(documentKey); this.proRequestValues.forget(documentKey); this.social.forget(documentKey); this.thirdParty.forget(documentKey); this.beacons.forget(documentKey); this.backgroundActivity.forget(documentKey); this.cookieWriters.forget(documentKey); void this.cookieProbe.invalidate(documentKey); this.precursor?.forget(documentKey);
    this.pro.onLightClear(documentKey);
      await this.pro.flush();
      await this.commitClear([documentKey]);
      if (previewReset.reset) this.markApiResultsReset([documentKey], false);
      this.badge.mark(tabId);
      this.visual.clearDocument(documentKey);
      this.rtc.clearDocument(documentKey);
      this.networkAttempts.clear(documentKey);
      await this.visual.flush();
      await this.rtc.flush();
      this.markIndexDirty();
      if (!await this.persistApiResultsReset()) return uiError("no-access");
      return { schemaVersion: 1, type: "ok", reportRevision: null };
    });
  }
  /**
   * ui-clear-session (options page): every document report of the session is deleted, in memory and in
   * storage.session; bindings and scope prefs stay, so observed documents start a fresh report on their next batch.
   * Each document is cleared inside its own serialized queue (no interleaving with a commit of that document).
   */
  async clearSession() {
    await this.ready;
    await this.ensureHistory();
    this.onProtectClearSession?.();
    const savedReportsPurge = await withProReportHistoryPurge(async () => {
    this.vendorRedirects.clear(); this.pro.vendorRedirects.clear();
    this.cookies.clear(); this.proCookieValues.clear(); this.proRequestValues.clear(); this.social.clear(); this.thirdParty.clear(); this.beacons.clear(); this.backgroundActivity.clear(); this.cookieWriters.clear(); void this.cookieProbe.invalidate(); this.precursor?.clear();
    const precursorCleared = Promise.resolve(this.precursorModes?.clear() ?? true).catch(() => false);
    const keys = [...this.state.reports.keys()];
    this.apiResults.invalidate();
    this.googleIds.clear();
    this.markApiResultsReset(keys, true);
    if (keys.length > 0 && !await this.persistApiResultsReset()) return uiError("no-access");
    await this.pro.clear();
    this.visual.clear();
    this.rtc.clear();
    this.networkAttempts.clear();
    const pendingResets = new Map(keys.map((documentKey) => [documentKey, this.apiResults.prepareClear(documentKey, true)]));
    await this.repository.runMany(keys, () => this.commitClear(keys));
    for (const documentKey of keys) {
      const previewReset = await pendingResets.get(documentKey);
      if (previewReset?.reset) this.markApiResultsReset([documentKey], false);
    }
    this.markIndexDirty();
    this.badge.markAll();
    await this.visual.flush();
    await this.rtc.flush();
    if (!await this.persistApiResultsReset()) return uiError("no-access");
    if (!await precursorCleared) return uiError("no-access");
    return { schemaVersion: 1, type: "ok", reportRevision: null };
    });
    return savedReportsPurge.ok ? savedReportsPurge.value : uiError("no-access");
  }
  /** Export preview = exactly the redacted projection shown in the UI (REQ-013); no raw data. */
  async exportPreview(tabId, documentKey, reportRevision, includeHost = false) {
    await this.ready;
    await this.ensureHistory();
    const error = this.checkDocument(tabId, documentKey, reportRevision);
    if (error !== null) return uiError(error);
    const report = this.projectionByKey(documentKey);
    if (report === null) return uiError("not-found");
    const preview = createExportPreview(report, this.now(), includeHost);
    return { schemaVersion: 1, type: "export-preview", preview };
  }
  /** ui-inject-now (active-tab mode): late injection under the activeTab grant; the tab's documents get `late-start`. */
  async injectNow(tabId) {
    await this.ready;
    await this.ensureHistory();
    const key = selectDocumentKey(this.state, tabId);
    const seenBefore = new Set([...this.state.metas].filter(([, meta]) => meta.sensorSeen).map(([id]) => id));
    let frames;
    try {
      frames = await this.api.webNavigation.getAllFrames({ tabId });
    } catch {
      return uiError("no-access");
    }
    const top = frames?.find((f) => f.frameId === 0 && f.documentLifecycle !== "prerender");
    if (!top || typeof top.documentId !== "string") return uiError("no-access");
    const injectedKey = String(tabId) + ":0:" + top.documentId;
    if (this.state.metas.get(injectedKey)?.revoked) return uiError("no-access");
    const host = sanitizeHost(top.url);
    const ok = await this.scope.injectNow(tabId, host, top.documentId);
    if (!ok) return uiError("no-access");
    this.grantDocumentAccess(String(tabId) + ":0:" + top.documentId);
    this.apply({ type: "scope:access", documentKey: String(tabId) + ":0:" + top.documentId, host, accessGranted: true, at: this.now() });
    if (!seenBefore.has(injectedKey)) this.apply({ type: "injection:late", documentKeys: [injectedKey], at: this.now() });
    this.reconcileAccess();
    this.badge.markAll();
    return { schemaVersion: 1, type: "ok", reportRevision: key === null ? null : this.state.reports.get(key)?.revision ?? null };
  }
  changeDataConsent(accepted) {
    if (this.consentPending >= 4) return Promise.resolve(false);
    this.consentPending++;
    const operation = this.consentChain.then(async () => {
      await this.ready;
      this.scope.suspendDataConsent();
      const blocked = this.scope.beginDataConsentChange();
      const cleared = await this.discardUnconsentedData();
      if (!await blocked) return false;
      const saved = await this.scope.setDataConsent(accepted && cleared);
      if (!cleared || !saved) return false;
      if (accepted) {
        await this.reconcile();
        this.reconcileAccess();
        await this.visual.start();
        await this.rtc.start();
        await this.pro.start();
        await this.protection.accessChanged();
        void this.siteIcons.refresh();
      }
      this.badge.markAll();
      return true;
    }).catch(async () => {
      this.scope.suspendDataConsent();
      await this.discardUnconsentedData();
      return false;
    }).finally(() => {
      this.consentPending--;
    });
    this.consentChain = operation;
    return operation;
  }
  async currentDataConsent() {
    return await this.ready, await this.consentChain, this.scope.hasDataConsent;
  }
  async discardUnconsentedData() {
    const savedReportsPurge = await withProReportHistoryPurge(async () => {
    this.vendorRedirects.clear(); this.pro.vendorRedirects.clear();
    this.cookies.clear(); this.proCookieValues.clear(); this.proRequestValues.clear(); this.social.clear(); this.thirdParty.clear(); this.beacons.clear(); this.backgroundActivity.clear(); this.cookieWriters.clear(); void this.cookieProbe.invalidate(); this.precursor?.clear();
    const precursorCleared = Promise.resolve(this.precursorModes?.clear() ?? true).catch(() => false);
    for (const key of this.state.reports.keys()) this.sendControl(key, "pause");
    this.apiResults.invalidate();
    this.googleIds.clear();
    this.responseHeaders.clear();
    this.networkAttempts.clear();
    this.visual.clear();
    this.rtc.clear();
    const proCleared = this.pro.clear();
    this.state = createInitialState();
    this.documentAccess.clear();
    this.pending.length = 0;
    this.pendingPageDrops.clear();
    this.pendingNetworkLoss = false;
    this.transportDrops.clear();
    this.dirtyDocs.clear();
    this.persisted.clear();
    this.estimated.clear();
    this.enumeratedFrames.clear();
    if (this.indexTimer !== null) clearTimeout(this.indexTimer);
    this.indexTimer = null;
    for (const timer of this.persistTimers.values()) clearTimeout(timer);
    this.persistTimers.clear();
    this.indexDirty = false;
    this.indexRevision++;
    this.badge.markAll();
    const cleanup = await Promise.allSettled([
      proCleared, this.siteIcons.invalidate(),
      this.visual.flush(),
      this.rtc.flush(),
      this.protection.suspendAccess(),
      this.api.tabs.query({}).then((tabs) => {
        for (const tab of tabs.slice(0, 128)) if (tab.id !== void 0)
          void this.api.tabs.sendMessage(tab.id, { schemaVersion: 1, type: "bridge-control", command: "pause" }).catch(() => void 0);
      })
    ]);
    const cleared = await this.repository.clearAll([DATA_CONSENT_PENDING_KEY], this.keepProtectSessionKey);
    this.historyLoaded = cleared;
    this.persisted.clear();
    this.estimated.clear();
    return cleared && cleanup.every((result) => result.status === "fulfilled") && await precursorCleared;
    });
    return savedReportsPurge.ok ? savedReportsPurge.value : false;
  }
  /** Permission change (grant or revoke): refresh grants, reconcile registration, revoke documents out of scope. */
  async onPermissionsChanged() {
    await this.siteIcons.invalidate().catch(() => {});
    this.vendorRedirects.clear(); this.pro.vendorRedirects.clear();
    this.cookies.clear(); this.proCookieValues.clear(); this.proRequestValues.clear(); this.social.clear(); this.thirdParty.clear(); this.beacons.clear(); this.backgroundActivity.clear(); this.cookieWriters.clear(); void this.cookieProbe.invalidate(); this.precursor?.clear();
    this.apiResults.invalidate();
    this.googleIds.clear();
    this.responseHeaders.clear();
    this.networkAttempts.clear();
    this.visual.clear();
    this.rtc.clear();
    await this.ready;
    this.documentAccess.clear();
    this.badge.markAll();
    try {
      await this.scope.onPermissionsChanged();
    } catch (error) {
      await this.protection.suspendAccess();
      throw error;
    }
    await this.protection.accessChanged();
    this.pro.onPermissionsChanged();
    await this.ensureHistory();
    this.documentAccess.clear();
    await this.reconcile();
    this.reconcileAccess();
    this.badge.markAll();
    await Promise.all([...this.dirtyDocs].map((key) => this.repository.run(key, () => this.persistNow(key))));
    await this.flushIndex();
    await this.visual.flush();
    await this.rtc.flush();
    void this.siteIcons.refresh();
}
  reconcileAccess(restoring = !1) {
    if (!this.scope.hasBroadNetworkAccess()) for (let [key2, meta] of this.state.metas)
      (meta.networkCounters?.length || meta.requestedLocalPorts || meta.responseHeaders) && this.apply({ type: "network:reset", documentKey: key2, at: this.now() });
    let denied2 = /* @__PURE__ */ new Set();
    for (let binding of this.state.bindings.values())
      this.hasDocumentAccess(binding.documentKey) || denied2.add(binding.documentKey);
    for (let [key2, report2] of this.state.reports)
      this.hasDocumentAccess(key2) || denied2.add(key2);
    for (let key2 of denied2) {
      let meta = this.state.metas.get(key2), pendingOrigin = [...this.state.bindings.values()].some((binding) => binding.documentKey === key2 && binding.originPending === !0), preservePendingHistory = restoring && pendingOrigin && this.scope.getScopeMode() === "all-sites" && this.scope.getState().grantedAllSites;
      meta && !meta.revoked && !preservePendingHistory && (meta.sensorSeen || (meta.networkCounters?.length ?? 0) > 0 || meta.requestedLocalPorts || meta.responseHeaders || (this.state.reports.get(key2)?.hosts.length ?? 0) > 0) && this.apply({
        type: "scope:revoked",
        documentKeys: [key2],
        ...restoring && pendingOrigin && this.scope.hasAnyHostAccess() ? { unresolvedOrigin: !0 } : {},
        at: this.now()
      }), this.transportDrops.delete(key2), this.apply({ type: "scope:access", documentKey: key2, host: null, accessGranted: !1, at: this.now() });
    }
    this.state = { ...this.state, quarantine: this.state.quarantine.filter((q) => this.hasDocumentAccess(q.documentKey)) };
    for (let key2 of this.dirtyDocs) this.schedulePersist(key2);
  }
  diagnostics() {
    return {
      ready: this.isReady,
      pendingDropped: this.pendingDropped,
      pendingPageBatches: this.pendingPageBatches,
      persistFailures: this.persistFailures,
      degraded: this.degraded,
      estimatedBytes: this.estimatedTotal(),
      lastMeasuredBytes: this.lastMeasuredBytes,
      reports: this.state.reports.size,
      quarantine: this.state.quarantine.length,
      orphanBatches: this.state.unattributed.orphanBatches,
      unattributedRequests: this.state.unattributed.requests,
      lifecycleFallbackCommits: this.state.notes.lifecycleFallbackCommits,
      engineFailures: this.state.notes.engineFailures
    };
  }

historyLoaded = false;
historyLoading = null;
clearingDocs = /* @__PURE__ */ new Set();
resetRequests = /* @__PURE__ */ new Map();
async ensureHistory() {
    if (this.historyLoading !== null) return this.historyLoading;
    if (this.historyLoaded || !this.scope.hasDataConsent) return;
    const attempt = (async () => {
      const accessGeneration = this.scope.accessGeneration;
      const loaded = await this.repository.loadAll(() => this.scope.hasDataConsent && this.scope.accessGeneration === accessGeneration);
      if (!this.scope.hasDataConsent || this.scope.accessGeneration !== accessGeneration) throw new Error("history-access-changed");
      this.hydrate(loaded.index, loaded.documents);
      this.historyLoaded = true;
      await this.reconcile();
      if (!this.scope.hasDataConsent || this.scope.accessGeneration !== accessGeneration) throw new Error("history-access-changed");
      this.reconcileAccess(true);
      await this.visual.start();
      await this.rtc.start();
      await this.pro.start();
      if (!this.scope.hasDataConsent || this.scope.accessGeneration !== accessGeneration) throw new Error("history-access-changed");
      const buffered = this.pending.splice(0, this.pending.length);
      for (const event of buffered) this.apply(event);
      this.reconcileAccess(true);
      if (this.isReady) this.finishHistoryReadiness();
    })();
    this.historyLoading = attempt;
    try {
      await attempt;
    } catch (error) {
      this.historyLoaded = false;
      this.state = createInitialState();
      this.persisted.clear();
      this.estimated.clear();
      this.documentAccess.clear();
      this.degraded = true;
      throw error;
    } finally {
      if (this.historyLoading === attempt) this.historyLoading = null;
    }
  }
finishHistoryReadiness() {
    if (!this.historyLoaded) return;
    this.networkAttempts.flush();
    if (this.pendingNetworkLoss) {
      for (const key of this.state.reports.keys()) if (this.hasDocumentAccess(key)) {
        this.apply({ type: "network:limited", documentKey: key, at: this.now() });
      }
    }
    for (const [key, count] of this.pendingPageDrops) {
      const meta = this.state.metas.get(key);
      if (!meta || meta.revoked || meta.accessGranted === false) continue;
      this.transportDrops.set(key, count);
      this.schedulePersist(key);
    }
    this.pendingPageDrops.clear();
  }
async commitClear(keys) {
    for (const key of keys) this.clearingDocs.add(key);
    try {
      await this.commitClearRecords(keys);
    } finally {
      for (const key of keys) this.clearingDocs.delete(key);
    }
  }
async commitClearRecords(keys) {
    if (keys.length === 0) return;
    const at = this.now();
    const fences = [];
    try {
      for (const key of keys) if (this.state.reports.has(key) && this.state.metas.has(key)) fences.push(await this.resetHistoryActor(key));
    } catch (error) {
      for (const key of keys) this.apply({ type: "transport:dropped", documentKey: key, count: 1, at: this.now() }, key);
      throw error;
    }
    if (fences.length === 0) return;
    for (const fence of fences) fence.reportRevision = Math.min(BUDGETS.maxCount, (this.state.reports.get(fence.documentKey)?.revision ?? fence.reportRevision) + 1);
    let result;
    try {
      result = await this.repository.commitClear(fences, this.estimatedTotal());
    } catch {
      result = { committed: false, cleaned: false };
    }
    if (!result.committed) {
      this.persistFailures++;
      this.degraded = true;
      for (const key of keys) this.apply({ type: "transport:dropped", documentKey: key, count: 1, at: this.now() }, key);
      throw new Error("clear-storage");
    }
    for (const fence of fences) {
      const key = fence.documentKey;
      this.pro.onLightClear(key);
      this.apply({ type: "ui:clear", documentKey: key, fence, at }, key);
      const timer = this.persistTimers.get(key);
      if (timer !== void 0) {
        clearTimeout(timer);
        this.persistTimers.delete(key);
      }
      this.dirtyDocs.delete(key);
      this.transportDrops.delete(key);
      this.persisted.delete(key);
      const report = this.state.reports.get(key), meta = this.state.metas.get(key);
      if (report !== void 0 && meta !== void 0) this.estimated.set(key, estimateReportBytes(report, meta));
    }
    if (!result.cleaned) throw new Error("clear-cleanup");
  }
async resetHistoryActor(documentKey) {
    const report = this.state.reports.get(documentKey), meta = this.state.metas.get(documentKey);
    if (report === void 0 || meta === void 0) throw new Error("clear-missing");
    const resetId = "reset-" + crypto.randomUUID().replaceAll("-", "");
    const retired = { documentKey, bridgeSessionId: resetId, sensorBootIds: [], at: this.now(), paused: meta.paused, reportRevision: Math.min(BUDGETS.maxCount, report.revision + 1) };
    if (!meta.bound || meta.revoked || meta.accessGranted === false || report.lifecycle === "bfcache" || report.lifecycle === "closed") return retired;
    if (this.resetRequests.has(documentKey) || this.resetRequests.size >= 4) throw new Error("reset-busy");
    let native;
    try {
      native = this.api.tabs.sendMessage(report.tabId, { schemaVersion: 1, type: "bridge-control", command: "reset", resetId }, { frameId: report.frameId, documentId: report.documentId });
    } catch {
      native = Promise.reject(new Error("reset-unavailable"));
    }
    this.resetRequests.set(documentKey, native);
    void native.then(() => {
      if (this.resetRequests.get(documentKey) === native) this.resetRequests.delete(documentKey);
    }, () => {
      if (this.resetRequests.get(documentKey) === native) this.resetRequests.delete(documentKey);
    });
    let timer;
    try {
      const raw = await Promise.race([native, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("reset-timeout")), 2500);
      })]);
      const response = validateBridgeResetAck(raw);
      if (!response.ok || response.value.resetId !== resetId) throw new Error("reset-invalid");
      return { ...retired, bridgeSessionId: response.value.bridgeSessionId, sensorBootIds: response.value.sensorBootIds, at: this.now() };
    } catch (error) {
      if (!meta.sensorSeen && meta.boots.length === 0) return retired;
      throw error;
    } finally {
      if (timer !== void 0) clearTimeout(timer);
    }
  }
};

// packages/background/src/handlers.ts
function readField(message, field3) {
  if (!(typeof message != "object" || message === null))
    return message[field3];
}
function ack3(lastCommittedBatchSeq, paused, protocolOk) {
  return { schemaVersion: 1, type: "ack", lastCommittedBatchSeq, paused, protocolOk };
}
async function routeUi(runtime, message) {
  let request = validateUiRequest(message);
  if (!request.ok) return uiError("invalid-request");
  await runtime.whenReady(), runtime.sweepExpired(runtime.now());
  let r = request.value;
  if (!runtime.scope.hasDataConsent && r.type !== "ui-get-scope" && r.type !== "ui-get-report" && r.type !== "ui-clear-session") return uiError("no-access");
  switch (r.type) {
    case "ui-get-report":
      return await runtime.whenReady(), await runtime.scope.refreshRegistration(), { schemaVersion: 1, type: "report", report: r.frameId === void 0 ? runtime.getProjection(r.tabId) : runtime.getProjection(r.tabId, r.frameId) };
    case "ui-pause":
      return runtime.pause(r.tabId, r.documentKey, r.reportRevision);
    case "ui-resume":
      return runtime.resume(r.tabId, r.documentKey, r.reportRevision);
    case "ui-clear":
      return runtime.clear(r.tabId, r.documentKey, r.reportRevision);
    case "ui-set-scope": {
      await runtime.whenReady();
      let result;
      try {
        result = await runtime.scope.setScope(r);
      } catch {
        return await runtime.protection.suspendAccess(), uiError("no-access");
      }
      return result.ok ? (await runtime.onPermissionsChanged(), runtime.scope.registrationHealthy ? { schemaVersion: 1, type: "scope", scope: runtime.scope.getState() } : uiError("no-access")) : uiError(result.code);
    }
    case "ui-export-preview":
      return runtime.exportPreview(r.tabId, r.documentKey, r.reportRevision, r.includeHost);
    case "ui-get-scope":
      return await runtime.whenReady(), { schemaVersion: 1, type: "scope", scope: runtime.scope.getState() };
    case "ui-inject-now":
      return runtime.injectNow(r.tabId);
    case "ui-clear-session":
      return runtime.clearSession();
  }
}
async function routePage(runtime, message, sender) {
  let read4 = readPageSender(sender, runtime.api.runtime.id);
  if (!read4.ok)
    return read4.reason === "opaque-origin" && readField(message, "type") === "sensor-events" ? (runtime.dispatch({ type: "frame:unavailable", tabId: sender.tab.id, frameId: sender.frameId, documentId: sender.documentId, at: runtime.now() }), { ...ack3(0, !0, !0), stopReason: "revoked" }) : uiError("unauthorized-sender");
  let ctx = read4.context;
  if (readField(message, "type") !== "sensor-events") return uiError("unauthorized-sender");
  if (!runtime.scope.dataConsentLoaded) return uiError("no-access");
  if (!runtime.scope.hasDataConsent) return { ...ack3(0, !0, !0), stopReason: "revoked" };
  if (readField(message, "schemaVersion") !== 1)
    return await runtime.recordTerminalStop(ctx, "protocol-mismatch"), ack3(0, !0, !1);
  if (!runtime.admitBatch(ctx)) {
    let session = typeof message == "object" && message !== null ? message.bridgeSessionId : void 0;
    return ack3(runtime.lastPersistedSeq(ctx.documentKey, typeof session == "string" ? session : void 0), runtime.isPaused(ctx.documentKey), !0);
  }
  let batch = validatePageBatch(message);
  return batch.ok ? await runtime.whenPageReady(ctx.documentKey) ? runtime.scope.hasDataConsent ? ctx.originPattern !== null && await runtime.scope.isGranted(ctx.originPattern, ctx.tabId, ctx.documentId) ? runtime.handleBatch(ctx, batch.value, !0) : (await runtime.recordTerminalStop(ctx, "revoked"), { ...ack3(0, !0, !0), stopReason: "revoked" }) : { ...ack3(0, !0, !0), stopReason: "revoked" } : ack3(runtime.lastPersistedSeq(ctx.documentKey, batch.value.bridgeSessionId), !1, !0) : (runtime.countTransportDrop(ctx.documentKey), ack3(runtime.lastPersistedSeq(ctx.documentKey), runtime.isPaused(ctx.documentKey), !0));
}
async function route(runtime, message, sender) {
  // ADR-048: existing trusted sender checks are passed unchanged to the configuration controller.
  const apiConfigurationRoute = runtime.apiConfiguration?.route(message, sender);
  if (apiConfigurationRoute !== null && apiConfigurationRoute !== undefined) return apiConfigurationRoute;
  // ADR-113: the sensor-quiet setting of the Antidetect page (extension pages only; page senders get null here and fall through).
  const sensorQuietRoute = runtime.sensorQuiet?.route(message, sender);
  if (sensorQuietRoute !== null && sensorQuietRoute !== undefined) return sensorQuietRoute;
  let messageType = typeof message == "object" && message !== null ? Object.getOwnPropertyDescriptor(message, "type")?.value : null;
  if (messageType === "ui-data-consent-get" || messageType === "ui-data-consent-set") {
    if (!verifyUiSender(sender, runtime.api.runtime.id)) return uiError("unauthorized-sender");
    let request = readDataConsentRequest(message);
    return request ? (await runtime.whenReady(), request.type === "ui-data-consent-set" && !await runtime.changeDataConsent(request.accepted) ? uiError("no-access") : { schemaVersion: 1, type: "data-consent-state", version: 1, accepted: await runtime.currentDataConsent() }) : uiError("invalid-request");
  }
  if (verifyUiSender(sender, runtime.api.runtime.id) && (await runtime.whenReady(), !runtime.scope.hasDataConsent))
    return messageType === "ui-get-scope" || messageType === "ui-get-report" || messageType === "ui-clear-session" ? routeUi(runtime, message) : uiError("no-access");
  if (messageType === "ui-get-beacons" || messageType === "ui-get-background-activity" || messageType === "ui-refresh-background-activity" || ["ui-start-cookie-probe", "ui-get-cookie-probe", "ui-cancel-cookie-probe"].includes(messageType)) {
    if (!verifyUiSender(sender, runtime.api.runtime.id)) return uiError("unauthorized-sender");
    const reader = messageType === "ui-get-beacons" ? readBeaconRequest : messageType.includes("background-activity") ? readBackgroundRequest : readCookieProbeRequest;
    const request = reader(message); if (!request) return uiError("invalid-request");
    if (messageType === "ui-get-beacons") return runtime.beacons.read(request);
    if (messageType.includes("background-activity")) return runtime.backgroundActivity.read(request);
    return messageType === "ui-start-cookie-probe" ? runtime.cookieProbe.start(request) : messageType === "ui-cancel-cookie-probe" ? runtime.cookieProbe.cancel(request) : runtime.cookieProbe.read(request);
  }
  if (messageType === "ui-get-cookie-writers") {
    if (!verifyUiSender(sender, runtime.api.runtime.id)) return uiError("unauthorized-sender");
    const request = readCookieWriterRequest(message);
    return request ? runtime.cookieWriters.read(request) : uiError("invalid-request");
  }
  if (messageType === "ui-get-precursor-zone") {
    if (!verifyUiSender(sender, runtime.api.runtime.id)) return uiError("unauthorized-sender");
    return await readPrecursorZone(runtime, message) ?? uiError("invalid-request");
  }
  if (messageType === "ui-get-precursor") {
    if (!verifyUiSender(sender, runtime.api.runtime.id)) return uiError("unauthorized-sender");
    const request = readPrecursorRequest(message); return request ? runtime.precursor.read(request) : uiError("invalid-request");
  }
  if (messageType === "ui-get-third-party") {
    if (!verifyUiSender(sender, runtime.api.runtime.id)) return uiError("unauthorized-sender");
    const request = readThirdPartyRequest(message); return request ? runtime.thirdParty.read(request) : uiError("invalid-request");
  }
  if (messageType === "ui-get-social-networks") {
    if (!verifyUiSender(sender, runtime.api.runtime.id)) return uiError("unauthorized-sender");
    const request = readSocialRequest(message); return request ? runtime.social.read(request) : uiError("invalid-request");
  }
  if (messageType === "ui-get-cookies") {
    if (!verifyUiSender(sender, runtime.api.runtime.id)) return uiError("unauthorized-sender");
    const request = readCookieRequest(message);
    return request ? runtime.cookies.read(request) : uiError("invalid-request");
  }
  if (messageType === "ui-get-cookie-view" || messageType === "ui-get-cookie-value") {
    if (!verifyUiSender(sender, runtime.api.runtime.id)) return uiError("unauthorized-sender");
    const request = messageType === "ui-get-cookie-view" ? readCookieViewRequest(message) : readCookieValueRequest(message);
    if (!request) return uiError("invalid-request");
    const result = messageType === "ui-get-cookie-view" ? await runtime.cookies.read(request) : await runtime.cookies.values.reveal(request);
    const admitted = messageType === "ui-get-cookie-view" ? readCookieView(result) : readCookieValueResult(result);
    if (messageType === "ui-get-cookie-view" && admitted?.snapshot.documentKey === request.documentKey || messageType === "ui-get-cookie-value" && admitted?.documentKey === request.documentKey && admitted.handle === request.handle) return admitted;
    const code = result && typeof result === "object" ? Object.getOwnPropertyDescriptor(result, "code")?.value : null;
    return uiError(code === "stale-revision" ? "stale-revision" : "no-access");
  }
  if (messageType === "ui-clear-site-cookies") {
    if (!verifyUiSender(sender, runtime.api.runtime.id)) return uiError("unauthorized-sender");
    const request = readClearCookiesRequest(message);
    if (!request) return uiError("invalid-request");
    const result = await runtime.cookies.clearSite(request);
    const cleared = readClearCookiesResult(result);
    if (cleared?.documentKey === request.documentKey) return cleared;
    const errorCode = result && typeof result === "object" ? Object.getOwnPropertyDescriptor(result, "code")?.value : null;
    return uiError(errorCode === "stale-revision" ? "stale-revision" : "no-access");
  }
  let googleIds = runtime.googleIds.route(message, sender);
  if (googleIds !== null) return googleIds;
  let apiResults = runtime.apiResults.route(message, sender);
  if (apiResults !== null) return apiResults;
  let protection = runtime.protection.route(message, sender, () => runtime.whenReady());
  if (protection !== null) return protection;
  let pro = runtime.pro.route(message, sender);
  if (pro !== null) return pro;
  let visual = runtime.visual.route(message, sender);
  if (visual !== null) return visual;
  let rtc = runtime.rtc.route(message, sender);
  return rtc !== null ? rtc : verifyUiSender(sender, runtime.api.runtime.id) ? routeUi(runtime, message) : routePage(runtime, message, sender);
}
function createMessageListener(runtime) {
  // ADR-047: the module types (exact `type`, protect-sw.js) get false and no sendResponse here.
  return (message, sender, sendResponse) => runtime.ownsMessage?.(message) ? !1 : (route(runtime, message, sender).then(sendResponse, () => {
    sendResponse(uiError("invalid-request"));
  }), !0);
}

// packages/background/src/network.ts
var NETWORK_RESOURCE_TYPES = ["script", "xmlhttprequest", "sub_frame", "other", "image", "ping"], NETWORK_FILTER = {
  urls: ["http://*/*", "https://*/*"],
  types: [...NETWORK_RESOURCE_TYPES]
}, TYPE_SET = new Set(NETWORK_RESOURCE_TYPES);
// ADR-057 vendor redirect attribution start
function createRuntimeVendorRedirects(runtime, pro = null) {
  return createVendorRedirectTracker({
    match: matchVendorResource,
    now: () => runtime.now(),
    onLimit: (_reason, identity) => {
      const documentKey = makeDocumentKey(identity.tabId, identity.frameId, identity.documentId);
      if (runtime.canObserveNetworkDocument(documentKey)) runtime.dispatch({ type: "network:limited", documentKey, at: runtime.now() });
      else runtime.dispatch({ type: "network:unattributed", at: runtime.now() });
      if (pro?.checkDeadline()) { pro.limit("event-limit"); pro.mark(); }
    }
  });
}
function carriedVendorRuleIds(runtime, tracker, details, phase, pro = null) {
  const scope = runtime.scope;
  if (!scope.hasDataConsent || !scope.accessReady) { tracker.clear(); return []; }
  if (typeof details.url !== "string") return [];
  const documentKey = makeDocumentKey(details.tabId, details.frameId, details.documentId);
  const meta = runtime.state.metas.get(documentKey);
  const host = sanitizeHost(details.url), initiator = typeof details.initiator === "string" ? details.initiator : "";
  const sourceHost = sanitizeHost(initiator), scheme = details.url.startsWith("https:") ? "https" : "http";
  const sourceScheme = initiator.startsWith("https:") ? "https" : "http";
  const allowed = !!host && !!sourceHost && scope.isHostGrantedSync(host, scheme) &&
    scope.isHostGrantedSync(sourceHost, sourceScheme) && scope.inScope(sourceHost, details.tabId, details.documentId, sourceScheme) &&
    !meta?.paused && !meta?.revoked && meta?.accessGranted !== false &&
    (phase !== "completed" || runtime.canObserveNetworkDocument(documentKey)) &&
    (!pro || pro.checkDeadline() && pro.trackedTabs.has(details.tabId));
  return tracker.observe(details, phase, {
    allowed,
    scopeKey: String(scope.accessGeneration) + ":" + scope.getScopeMode() + ":" + (pro?.session?.id ?? "light")
  }).filter(id => lookupVendorResourceRule(id, runtime.now()) !== null);
}
// ADR-057 vendor redirect attribution end

function createNetworkListener(runtime) {
  return (details) => {
    const carriedRules = carriedVendorRuleIds(runtime, runtime.vendorRedirects, details, "completed");
    if (!runtime.canBufferRedactedBrowserData()) return;
    let requiresAllSitesAccess = !runtime.hydrationComplete;
    if (!requiresAllSitesAccess && !runtime.scope.hasAnyHostAccess() || typeof details.type != "string" || !TYPE_SET.has(details.type)) return;
    let host2 = sanitizeHost(details.url);
    if (host2 === null) return;
    let initiator = typeof details.initiator == "string" ? details.initiator : "", initiatorHost = sanitizeHost(initiator);
    if (!initiatorHost || !requiresAllSitesAccess && (!runtime.scope.isHostGrantedSync(host2, details.url.startsWith("https:") ? "https" : "http") || !runtime.scope.isHostGrantedSync(initiatorHost, initiator.startsWith("https:") ? "https" : "http"))) return;
    let redacted = redactHost(host2), relation = siteRelation(details.url, initiator), at2 = runtime.now(), status = details.statusCode, ruleIds = typeof status == "number" && Number.isInteger(status) && (status >= 200 && status <= 299 || status === 304) ? [...new Set([...matchVendorResource(details.url, details.type, at2).map((match) => match.ruleId), ...carriedRules])] : [];
    runtime.dispatch({
      type: "network:host",
      tabId: typeof details.tabId == "number" ? details.tabId : -1,
      frameId: typeof details.frameId == "number" ? details.frameId : 0,
      documentId: typeof details.documentId == "string" ? details.documentId : null,
      parentFrameId: typeof details.parentFrameId == "number" ? details.parentFrameId : null,
      parentDocumentId: typeof details.parentDocumentId == "string" ? details.parentDocumentId : null,
      resourceType: details.type,
      host: redacted.kind === "registrable" ? redacted.value : "",
      ...redacted.kind === "registrable" ? {} : { category: redacted.kind === "unknown" ? "unknown" : redacted.value },
      relation,
      ruleIds,
      ...requiresAllSitesAccess ? { requiresAllSitesAccess: !0 } : {},
      at: at2
    });
  };
}

// packages/background/src/observers.ts
function ids(details) {
  return typeof details.tabId != "number" || typeof details.frameId != "number" || details.tabId < 0 || details.frameId < 0 ? null : { tabId: details.tabId, frameId: details.frameId };
}
function createNavigationObservers(runtime) {
  let route2 = (details) => {
    let id4 = ids(details);
    id4 === null || typeof details.documentId != "string" || (runtime.pro.onNavigation(details, !0), runtime.dispatch({
      type: "navigation:route",
      tabId: id4.tabId,
      frameId: id4.frameId,
      documentId: details.documentId,
      documentLifecycle: readLifecycle(details.documentLifecycle),
      at: runtime.now()
    }));
  };
  return {
    onBeforeNavigate(details) {
      let id4 = ids(details);
      id4 !== null && runtime.dispatch({ type: "navigation:before", tabId: id4.tabId, frameId: id4.frameId, host: sanitizeHost(details.url), at: runtime.now() });
    },
    onCommitted(details) {
      let id4 = ids(details);
      if (id4 === null || typeof details.documentId != "string") return;
      runtime.pro.onNavigation(details);
      let host2 = sanitizeHost(details.url), frameType = readFrameType(details.frameType), documentLifecycle = readLifecycle(details.documentLifecycle);
      runtime.dispatch({
        type: "navigation:committed",
        tabId: id4.tabId,
        frameId: id4.frameId,
        documentId: details.documentId,
        parentDocumentId: typeof details.parentDocumentId == "string" ? details.parentDocumentId : null,
        frameType,
        documentLifecycle,
        host: host2,
        ...details.url.startsWith("https://") ? { scheme: "https" } : details.url.startsWith("http://") ? { scheme: "http" } : {},
        at: runtime.now()
      });
    },
    onErrorOccurred(details) {
      let id4 = ids(details);
      id4 !== null && runtime.dispatch({
        type: "navigation:error",
        tabId: id4.tabId,
        frameId: id4.frameId,
        documentId: typeof details.documentId == "string" ? details.documentId : null,
        at: runtime.now()
      });
    },
    onHistoryStateUpdated: route2,
    onReferenceFragmentUpdated: route2,
    onCompleted(details) {
      let id4 = ids(details);
      id4 === null || typeof details.documentId != "string" || runtime.dispatch({
        type: "navigation:completed",
        tabId: id4.tabId,
        frameId: id4.frameId,
        documentId: details.documentId,
        documentLifecycle: readLifecycle(details.documentLifecycle),
        at: runtime.now()
      });
    },
    onTabRemoved(tabId) {
      typeof tabId == "number" && (runtime.pro.onTabRemoved(tabId), runtime.scope.noteTabRemoved(tabId), runtime.dispatch({ type: "tab:removed", tabId, at: runtime.now() }));
    },
    onTabReplaced(addedTabId, removedTabId) {
      typeof addedTabId != "number" || typeof removedTabId != "number" || (runtime.pro.onTabReplaced(addedTabId, removedTabId), runtime.scope.noteTabRemoved(removedTabId), runtime.dispatch({ type: "tab:replaced", addedTabId, removedTabId, at: runtime.now() }));
    },
    onPermissionsAdded() {
      runtime.onPermissionsChanged();
    },
    onPermissionsRemoved() {
      runtime.onPermissionsChanged();
    }
  };
}

// packages/background/src/index.ts
function createBackground(api, options = {}) {
  let runtime = new BackgroundRuntime(api, options);
  runtime.precursor = new PrecursorObserver(runtime);
  return {
    runtime,
    onMessage: createMessageListener(runtime),
    navigation: createNavigationObservers(runtime),
    network: {
      onCompleted: createNetworkListener(runtime),
      filter: NETWORK_FILTER,
      onResponseCompleted: createResponseHeadersListener(runtime),
      responseHeadersFilter: RESPONSE_HEADERS_FILTER,
      onBeforeRequest: (details) => {
        runtime.networkAttempts.onBeforeRequest(details);
      },
      attemptFilter: NETWORK_ATTEMPT_FILTER
    },
    start: () => runtime.start()
  };
}

// apps/extension/entrypoints/background.ts
var engine = {
  deriveFindings(report2) {
    return runRules({
      counters: report2.counters,
      coverageFlags: report2.coverageFlags,
      coverageRef: coverageRef(report2.coverageState, report2.coverageFlags)
    }).findings;
  }
};
var background = createBackground(chrome, {
  engine,
  testBootstrap: !1
});
chrome.runtime.onMessage.addListener(background.onMessage);
chrome.webNavigation.onBeforeNavigate.addListener(background.navigation.onBeforeNavigate);
chrome.webNavigation.onCommitted.addListener(background.navigation.onCommitted);
chrome.webNavigation.onErrorOccurred.addListener(background.navigation.onErrorOccurred);
chrome.webNavigation.onHistoryStateUpdated.addListener(background.navigation.onHistoryStateUpdated);
chrome.webNavigation.onReferenceFragmentUpdated.addListener(background.navigation.onReferenceFragmentUpdated);
chrome.webNavigation.onCompleted.addListener(background.navigation.onCompleted);
chrome.tabs.onRemoved.addListener(background.navigation.onTabRemoved);
chrome.tabs.onReplaced.addListener(background.navigation.onTabReplaced);
chrome.webRequest.onCompleted.addListener(background.network.onCompleted, background.network.filter);
chrome.webRequest.onCompleted.addListener(background.network.onResponseCompleted, background.network.responseHeadersFilter, ["responseHeaders"]);
chrome.webRequest.onCompleted.addListener(details => background.runtime.cookies.observe(details), { urls: ["http://*/*", "https://*/*"] });
chrome.webRequest.onSendHeaders.addListener(details => background.runtime.cookies.observe(details), { urls: ["http://*/*", "https://*/*"] });
try {
  chrome.webRequest.onSendHeaders.addListener(details => background.runtime.proCookieValues.observe(details), { urls: ["http://*/*", "https://*/*"] }, ["requestHeaders", "extraHeaders"]);
  background.runtime.proCookieValues.setSupported(true);
} catch { background.runtime.proCookieValues.setSupported(false); }
try {
  chrome.webRequest.onSendHeaders.addListener(details => background.runtime.proRequestValues.observe(details), { urls: ["http://*/*", "https://*/*"] }, ["requestHeaders", "extraHeaders"]);
  background.runtime.proRequestValues.setSupported(true);
} catch { background.runtime.proRequestValues.setSupported(false); }
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    background.runtime.responseHeaders.onBeforeRequest(details), background.runtime.googleIds.onBeforeRequest(details);
  },
  { urls: ["http://*/*", "https://*/*"], types: ["main_frame", "sub_frame"] }
);
try {
  chrome.webRequest.onSendHeaders.addListener(background.runtime.googleIds.onSendHeaders, GOOGLE_IDS_FILTER, ["requestHeaders", "extraHeaders"]), background.runtime.googleIds.setSupported(!0);
} catch {
  background.runtime.googleIds.setSupported(!1);
}
chrome.webRequest.onBeforeRequest.addListener(background.network.onBeforeRequest, background.network.attemptFilter);
chrome.webRequest.onBeforeRequest.addListener(details => background.runtime.social.observe(details), { urls: ["http://*/*", "https://*/*"] });
chrome.webRequest.onBeforeRequest.addListener((details) => {
  background.runtime.pro.onRequest(details, "before");
}, PRO_NETWORK_FILTER);
chrome.webRequest.onCompleted.addListener((details) => background.runtime.pro.onRequest(details, "completed"), PRO_NETWORK_FILTER);
chrome.webRequest.onBeforeRedirect.addListener((details) => background.runtime.pro.onRequest(details, "redirect"), PRO_NETWORK_FILTER);
chrome.webRequest.onErrorOccurred.addListener((details) => background.runtime.pro.onRequest(details, "error"), PRO_NETWORK_FILTER);
chrome.tabs.onCreated.addListener((tab) => background.runtime.pro.onTabCreated(tab));
chrome.tabs.onUpdated.addListener((tabId, _change, tab) => background.runtime.pro.onTabUpdated(tabId, tab));
chrome.alarms.onAlarm.addListener((alarm) => background.runtime.pro.onAlarm(alarm.name));
chrome.permissions.onAdded.addListener(background.navigation.onPermissionsAdded);
chrome.permissions.onRemoved.addListener(background.navigation.onPermissionsRemoved);
chrome.runtime.onInstalled.addListener(() => {
});
// ADR-047 protect integration start
// The opt-in module «Защита» (protect-sw.js, Chrome only; a no-op stub in Firefox) is linked only through these
// injection fields (port plan §2.1 B8). Its own runtime.onMessage listener (registered when protect-sw.js evaluated,
// before this body) answers its message types; the production listener answers everything else.
var protectBadgeLanguage = () => {
  try {
    return badgeBrowserLanguage(String(chrome.i18n.getUILanguage()));
  } catch {
    return "en";
  }
};
background.runtime.ownsMessage = (message) => {
  try {
    return protectHost.owns(message) === true;
  } catch {
    return false;
  }
};
background.runtime.badge.protect = (tabId, language) => protectHost.badgeFor(tabId, language ?? protectBadgeLanguage());
background.runtime.scope.onMainRegistered = () => protectHost.observationMainRegistered();
background.runtime.onProtectReportPersisted = (documentKey, report, meta) => {
  try {
    protectHost.reportPersisted(documentKey, report, meta, (tabId, documentId) => {
      for (const binding of background.runtime.state.bindings.values()) if (binding.tabId === tabId && binding.documentId === documentId) return binding;
      return null;
    });
  } catch {
  }
};
background.runtime.onProtectClearSession = () => {
  try {
    protectHost.clearSession();
  } catch {
  }
};
// Exact module keys of storage.session (getKeys reads no values); the in-memory list when getKeys is unavailable.
// B9: the production data-consent wipe keeps exactly the module's keys (isProtectSessionKey of protect-sw.js).
background.runtime.keepProtectSessionKey = (key) => typeof key == "string" && isProtectSessionKey(key) === true;
background.runtime.protectSessionKeys = async () => {
  const known = protectHost.sessionKeys();
  if (!Array.isArray(known) || known.length === 0) return [];
  try {
    const all = await chrome.storage.session.getKeys();
    return Array.isArray(all) ? all.filter((key) => typeof key == "string" && isProtectSessionKey(key)) : known;
  } catch {
    return known;
  }
};
protectHost.attach({
  hostGranted: (host, scheme) => background.runtime.scope.isHostGrantedSync(host, scheme),
  markBadge: (tabId) => background.runtime.badge.mark(tabId),
  markAllBadges: () => background.runtime.badge.markAll()
});
// ADR-047 protect integration end
// ADR-048 API configuration integration start
background.runtime.apiConfiguration = new ApiConfigurationController({
  api: chrome, legacy: background.runtime.protection, scope: background.runtime.scope,
  whenReady: () => background.runtime.whenReady(), verifyUiSender, readPageSender
});
background.runtime.proxy = installProxyService(chrome, { privacyOverlay: createProxyPrivacyOverlay(chrome, background.runtime.apiConfiguration) });
void background.runtime.proxy.ready.finally(() => background.runtime.apiConfiguration.start()).catch(() => {});
chrome.permissions.onAdded.addListener(() => background.runtime.apiConfiguration.legacyChanged());
chrome.permissions.onRemoved.addListener(() => background.runtime.apiConfiguration.legacyChanged());
chrome.tabs.onRemoved.addListener(tabId => background.runtime.apiConfiguration.removed(tabId));
// ADR-048 API configuration integration end
// ADR-075: independent, Options-only service; no change to detector hooks.
background.runtime.autosurf = installAutosurfService(chrome);
// ADR-113 sensor quiet integration start
// The user's choice not to run the observation sensors next to Antidetect (sensor-quiet.js). Assigned once, before background.start().
background.runtime.sensorQuiet = new SensorQuietGate({ api: chrome, scope: background.runtime.scope, whenReady: () => background.runtime.whenReady(), verifyUiSender });
background.runtime.scope.sensorGate = background.runtime.sensorQuiet;
{
  // A document opened while the sensors were withheld reports "paused" (REQ-006); every reader of a projection goes through this method.
  const ordinaryProjection = background.runtime.projectionByKey.bind(background.runtime);
  background.runtime.projectionByKey = documentKey => presentQuietCoverage(ordinaryProjection(documentKey), background.runtime.state.reports.get(documentKey), background.runtime.state.metas.get(documentKey), background.runtime.sensorQuiet, coverageRef);
}
// ADR-113 sensor quiet integration end
// ADR-101: selected profile in one explicitly opened, extension-owned window.
background.runtime.fingerprintEngine = installFingerprintEngineService(chrome, {
  isActive: () => background.runtime.apiConfiguration.active() && background.runtime.apiConfiguration.configuration?.antidetectEnabled === true && background.runtime.apiConfiguration.registration === 'ready',
  getProfile: async () => {
    const controller = background.runtime.apiConfiguration;
    await controller.start(); await controller.legacy.chain;
    return { configuration: controller.configuration, revision: controller.revision,
      active: controller.active() && controller.registration === 'ready', matches: controller.scope.desiredMatches() };
  },
  prepareWorker: async (configuration, { host }) => {
    const controller = background.runtime.apiConfiguration, entries = customEntries(configuration, host);
    return prepareFingerprintWorkerSource(configuration, { host,
      mathSeed: await controller.mathSeed.prepare(entries), canvasSeed: await controller.canvasSeed.prepare(entries) });
  }
});
// ADR-076: opt-in, fixed read-only Cloudflare API, RAM-only credential.
background.runtime.precursorModes = installPrecursorModesService(chrome, { consent: () => background.runtime.scope.hasDataConsent === true, whenReady: () => background.runtime.whenReady() });
background.start();

// ADR-029 third-party browser listeners start
chrome.webRequest.onBeforeRequest.addListener(details => background.runtime.thirdParty.observe(details, "before"), PRO_NETWORK_FILTER);
chrome.webRequest.onCompleted.addListener(details => background.runtime.thirdParty.observe(details, "completed"), PRO_NETWORK_FILTER);
chrome.webRequest.onErrorOccurred.addListener(details => background.runtime.thirdParty.observe(details, "error"), PRO_NETWORK_FILTER);
chrome.webRequest.onBeforeRedirect.addListener(details => background.runtime.thirdParty.observe(details, "redirect"), PRO_NETWORK_FILTER);
// ADR-029 third-party browser listeners end

// ADR-030 beacon browser listeners start
chrome.webRequest.onBeforeRequest.addListener(details => background.runtime.beacons.observe(details, "before"), BEACON_REQUEST_FILTER, ["requestBody"]);
chrome.webRequest.onCompleted.addListener(details => background.runtime.beacons.observe(details, "completed"), BEACON_REQUEST_FILTER);
chrome.webRequest.onErrorOccurred.addListener(details => background.runtime.beacons.observe(details, "error"), BEACON_REQUEST_FILTER);
chrome.webRequest.onBeforeRedirect.addListener(details => background.runtime.beacons.observe(details, "redirect"), BEACON_REQUEST_FILTER);
// ADR-030 beacon browser listeners end

// ADR-035 native favicon listeners start
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "complete" || typeof change.favIconUrl === "string") void background.runtime.siteIcons.collect(tabId);
});
chrome.tabs.onRemoved.addListener(tabId => background.runtime.siteIcons.removed(tabId));
// ADR-035 native favicon listeners end

// ADR-057 vendor redirect listeners start
chrome.webRequest.onBeforeRequest.addListener(details => { carriedVendorRuleIds(background.runtime, background.runtime.vendorRedirects, details, "before"); }, background.network.filter);
chrome.webRequest.onBeforeRedirect.addListener(details => { carriedVendorRuleIds(background.runtime, background.runtime.vendorRedirects, details, "redirect"); }, background.network.filter);
chrome.webRequest.onErrorOccurred.addListener(details => { carriedVendorRuleIds(background.runtime, background.runtime.vendorRedirects, details, "error"); }, background.network.filter);
chrome.tabs.onRemoved.addListener(tabId => { background.runtime.vendorRedirects.clearTab(tabId); background.runtime.pro.vendorRedirects.clearTab(tabId); });
chrome.tabs.onReplaced.addListener((_added, removed) => { background.runtime.vendorRedirects.clearTab(removed); background.runtime.pro.vendorRedirects.clearTab(removed); });
// ADR-057 vendor redirect listeners end

// ADR-074 Precursor resource observation
chrome.webRequest.onCompleted.addListener(details => { void background.runtime.precursor.observe(details); }, { urls: ["https://*/cdn-cgi/challenge-platform/*"], types: ["script"] }, ["responseHeaders"]);
chrome.tabs.onRemoved.addListener(tabId => background.runtime.precursor.clearTab(tabId));
chrome.tabs.onReplaced.addListener((_added, removed) => background.runtime.precursor.clearTab(removed));
chrome.webNavigation.onCommitted.addListener(details => {
  if (Number.isSafeInteger(details.tabId) && details.tabId >= 0 && Number.isSafeInteger(details.frameId) && details.frameId >= 0 && typeof details.documentId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(details.documentId))
    background.runtime.precursor.forget(details.tabId + ":" + details.frameId + ":" + details.documentId, "navigation");
});
