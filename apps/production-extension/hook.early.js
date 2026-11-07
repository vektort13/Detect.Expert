"use strict";
(() => {
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
  var PROTOCOL_VERSION = 1, CHANNEL = "detect.expert/v1", UNBOUND_SENSOR_BOOT_ID = "unbound", SIGNAL_CODES = [
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
  ];
  var COVERAGE_FLAGS = [
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
  ];
  var COUNT_QUALITIES = ["exact", "sampled", "lower-bound"], PHASES = [
    "attempted",
    "returned-sync",
    "threw-sync",
    "async-returned",
    "settlement-unobserved"
  ], SCOPE_MODES = ["off", "active-tab", "site", "all-sites"], SENSOR_STATES = ["active", "paused", "degraded", "stopped"], BRIDGE_STOP_REASONS = ["protocol-mismatch", "revoked", "scope-changed", "unload"], BRIDGE_CONTROL_COMMANDS = ["pause", "resume", "reset"];

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
  function apiOperationAllows(operation, techniqueId, phase) {
    let definition = apiOperationDefinition(operation);
    return definition !== null && definition.techniqueId === techniqueId && (phase === "threw-sync" || phase === (definition.kind === "async-call" ? "settlement-unobserved" : "returned-sync"));
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
  function extensionResourceAllows(resource, techniqueId, phase) {
    return techniqueId === "DET-059" && (phase === "threw-sync" || phase === (resource.method === "fetch" || resource.method === "xhr-send" ? "settlement-unobserved" : "returned-sync"));
  }

  // packages/contracts/src/validate.ts
  var capturedApply = Reflect.apply, capturedKeys = Object.keys, capturedIsArray = Array.isArray, capturedHasOwn = Object.prototype.hasOwnProperty, capturedSetHas = Set.prototype.has, capturedSetSize = Object.getOwnPropertyDescriptor(Set.prototype, "size").get, capturedInteger = Number.isInteger, capturedRegexExec = RegExp.prototype.exec;
  function setContains(set3, value) {
    return capturedApply(capturedSetHas, set3, [value]);
  }
  var TECHNIQUE_SET = new Set(TECHNIQUE_IDS), SIGNAL_SET = new Set(SIGNAL_CODES), COVERAGE_SET = new Set(COVERAGE_FLAGS), COUNT_QUALITY_SET = new Set(COUNT_QUALITIES), PHASE_SET = new Set(PHASES), SCOPE_SET = new Set(SCOPE_MODES), SENSOR_STATE_SET = new Set(SENSOR_STATES), STOP_REASON_SET = new Set(BRIDGE_STOP_REASONS), CONTROL_COMMAND_SET = new Set(BRIDGE_CONTROL_COMMANDS), ID_RE = /^[A-Za-z0-9_-]+$/;
  var FORBIDDEN_KEYS = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]), MAX_ENUM_CHARS = 64, MAX_TYPE_CHARS = 32;
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
    let keys2 = capturedKeys(obj);
    if (keys2.length > capturedApply(capturedSetSize, allowed, [])) return path + ": too many keys";
    for (let i = 0; i < keys2.length; i++) {
      let k = keys2[i];
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
  function readBool(v) {
    return typeof v == "boolean" ? v : null;
  }
  function readInt(v, min3, max) {
    return typeof v != "number" || !capturedInteger(v) || v < min3 || v > max ? null : v === 0 ? 0 : v;
  }
  function readEnum(v, set3) {
    return typeof v == "string" && v.length <= MAX_ENUM_CHARS && setContains(set3, v) ? v : null;
  }
  var OBS_KEYS = ["techniqueId", "count", "countQuality", "phase", "signalCodes", "intervalBucket"], OBS_KEY_SET = /* @__PURE__ */ new Set([...OBS_KEYS, "apiOperation", "extensionResource"]);
  var BATCH_KEYS = [
    "schemaVersion",
    "type",
    "sensorBootId",
    "bridgeSessionId",
    "batchSeq",
    "observations",
    "coverageDelta"
  ], BATCH_KEY_SET = new Set(BATCH_KEYS);
  var SENSOR_HELLO_KEYS = ["channel", "sensorBootId", "type", "protocolVersion", "startedLate", "coverageFlags"], SENSOR_BATCH_KEYS = ["channel", "sensorBootId", "type", "sensorSeq", "observations", "coverageDelta"], SENSOR_STATUS_KEYS = ["channel", "sensorBootId", "type", "state", "coverageFlags", "droppedSinceLast"], SENSOR_HELLO_SET = new Set(SENSOR_HELLO_KEYS), SENSOR_BATCH_SET = new Set(SENSOR_BATCH_KEYS), SENSOR_STATUS_SET = new Set(SENSOR_STATUS_KEYS);
  function readMessageType(input) {
    let t = input.type;
    return typeof t == "string" && t.length >= 1 && t.length <= MAX_TYPE_CHARS ? t : null;
  }
  function readPageMessageHeader(input, path) {
    if (input.channel !== CHANNEL) return fail(path + ".channel");
    let sensorBootId = readId(input.sensorBootId);
    return sensorBootId === null ? fail(path + ".sensorBootId") : { ok: !0, value: sensorBootId };
  }
  var BRIDGE_HELLO_KEYS = ["channel", "sensorBootId", "type", "protocolVersion", "bridgeSessionId", "paused"], BRIDGE_SIMPLE_KEYS = ["channel", "sensorBootId", "type"], BRIDGE_STOP_KEYS = ["channel", "sensorBootId", "type", "reason"], BRIDGE_HELLO_SET = new Set(BRIDGE_HELLO_KEYS), BRIDGE_SIMPLE_SET = new Set(BRIDGE_SIMPLE_KEYS), BRIDGE_STOP_SET = new Set(BRIDGE_STOP_KEYS);
  function bridgeMessage(input) {
  if (!isObjectLike(input)) return fail("bridge: not an object");
  const type = readMessageType(input);
  if (type === null) return fail("bridge.type");
  switch (type) {
    case "bridge-reset": {
      const required = ["channel", "sensorBootId", "type", "resetId"];
      const error = checkKeys(input, new Set(required), required, type);
      if (error !== null) return fail(error);
      const header = readPageMessageHeader(input, type);
      if (!header.ok) return header;
      const resetId = readId(input["resetId"]);
      return resetId === null ? fail("bridge-reset.resetId") : { ok: true, value: { channel: CHANNEL, sensorBootId: header.value, type, resetId } };
    }
    case "bridge-hello": {
      const keyError = checkKeys(input, BRIDGE_HELLO_SET, BRIDGE_HELLO_KEYS, type);
      if (keyError !== null) return fail(keyError);
      const header = readPageMessageHeader(input, type);
      if (!header.ok) return header;
      const protocolVersion = readInt(input["protocolVersion"], 0, 2147483647);
      if (protocolVersion === null) return fail(type + ".protocolVersion");
      const bridgeSessionId = readId(input["bridgeSessionId"]);
      if (bridgeSessionId === null) return fail(type + ".bridgeSessionId");
      const paused = readBool(input["paused"]);
      if (paused === null) return fail(type + ".paused");
      return {
        ok: true,
        value: { channel: CHANNEL, sensorBootId: header.value, type, protocolVersion, bridgeSessionId, paused }
      };
    }
    case "bridge-pause":
    case "bridge-resume": {
      const keyError = checkKeys(input, BRIDGE_SIMPLE_SET, BRIDGE_SIMPLE_KEYS, type);
      if (keyError !== null) return fail(keyError);
      const header = readPageMessageHeader(input, type);
      if (!header.ok) return header;
      return { ok: true, value: { channel: CHANNEL, sensorBootId: header.value, type } };
    }
    case "bridge-stop": {
      const keyError = checkKeys(input, BRIDGE_STOP_SET, BRIDGE_STOP_KEYS, type);
      if (keyError !== null) return fail(keyError);
      const header = readPageMessageHeader(input, type);
      if (!header.ok) return header;
      const reason = readEnum(input["reason"], STOP_REASON_SET);
      if (reason === null) return fail(type + ".reason");
      return { ok: true, value: { channel: CHANNEL, sensorBootId: header.value, type, reason } };
    }
    default:
      return fail("bridge.type");
  }
}
  function validateBridgeMessage(input) {
    try {
      return bridgeMessage(input);
    } catch {
      return fail("bridge: exception");
    }
  }
  var BRIDGE_CONTROL_KEYS = ["schemaVersion", "type", "command"], BRIDGE_CONTROL_SET = new Set(BRIDGE_CONTROL_KEYS);
  var UI_GET_REPORT_REQUIRED = ["schemaVersion", "type", "tabId"], UI_GET_REPORT_SET = /* @__PURE__ */ new Set([...UI_GET_REPORT_REQUIRED, "frameId"]), UI_REVISION_KEYS = ["schemaVersion", "type", "tabId", "documentKey", "reportRevision"], UI_REVISION_SET = new Set(UI_REVISION_KEYS), UI_EXPORT_SET = /* @__PURE__ */ new Set([...UI_REVISION_KEYS, "includeHost"]), UI_SET_SCOPE_REQUIRED = ["schemaVersion", "type", "scopeMode"], UI_SET_SCOPE_SET = /* @__PURE__ */ new Set([...UI_SET_SCOPE_REQUIRED, "host"]), UI_GET_SCOPE_KEYS = ["schemaVersion", "type"], UI_GET_SCOPE_SET = new Set(UI_GET_SCOPE_KEYS), UI_INJECT_NOW_KEYS = ["schemaVersion", "type", "tabId"], UI_INJECT_NOW_SET = new Set(UI_INJECT_NOW_KEYS);

  // packages/contracts/src/visual-preview.ts
  var VISUAL_CHANNEL = "detect.expert/visual/v1", VISUAL_LIMITS = Object.freeze({
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
  });
  var VISUAL_OPERATIONS = [
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
  ], VISUAL_CACHE_IDLE_MS = 10 * 6e4, descriptor = Object.getOwnPropertyDescriptor, names = Object.getOwnPropertyNames, integer = Number.isSafeInteger, test = Function.prototype.call.bind(RegExp.prototype.test);
  var BOOT = /^boot-[a-f0-9]{24}$/;
  function read(value, key) {
    return descriptor(value, key)?.value;
  }
  function shape(value, keys2) {
    if (typeof value != "object" || value === null || names(value).length !== keys2.length) return !1;
    for (let i = 0; i < keys2.length; i++) {
      let d = descriptor(value, keys2[i]);
      if (!d || !descriptor(d, "value")) return !1;
    }
    return !0;
  }
  function whole(value, min3, max) {
    return typeof value == "number" && integer(value) && value >= min3 && value <= max;
  }
  function control(value) {
    return typeof read(value, "enabled") == "boolean" && whole(read(value, "remainingMs"), 0, VISUAL_LIMITS.leaseMs);
  }
  function validateVisualConfigMessage(input) {
    try {
      if (!shape(input, ["channel", "type", "sensorBootId", "enabled", "remainingMs"]) || read(input, "channel") !== VISUAL_CHANNEL || read(input, "type") !== "visual-config" || !control(input)) return { ok: !1 };
      let boot = read(input, "sensorBootId");
      return typeof boot == "string" && test(BOOT, boot) ? { ok: !0, value: input } : { ok: !1 };
    } catch {
      return { ok: !1 };
    }
  }

  // packages/contracts/src/rtc-details.ts
  var RTC_DETAILS_CHANNEL = "detect.expert/rtc/v1", RTC_LIMITS = Object.freeze({ maxConnections: 32, maxServers: 8, maxBytes: 32768, maxDocuments: 8, idleMs: 6e5, flushMs: 250 });
  var isInteger = Number.isSafeInteger, exec = Function.prototype.call.bind(RegExp.prototype.exec), test2 = (re, text) => exec(re, text) !== null, lower = Function.prototype.call.bind(String.prototype.toLowerCase), at = Function.prototype.call.bind(String.prototype.charCodeAt);
  var MAX_COUNT2 = 2147483647;
  function integer2(v, min3 = 0, max = MAX_COUNT2) {
    return typeof v == "number" && isInteger(v) && v >= min3 && v <= max;
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
  function parseRtcServerUrl(value) {
    if (typeof value != "string" || value.length > 512) return null;
    let parts = exec(/^(stun|stuns|turn|turns):(\[[0-9a-f:]+\]|[a-z0-9.-]+)(?::([0-9]{1,5}))?(?:\?transport=(udp|tcp))?$/, lower(value));
    if (!parts || !host(parts[2])) return null;
    let port2 = parts[3] === void 0 ? null : +parts[3];
    return port2 !== null && !integer2(port2, 1, 65535) ? null : { scheme: parts[1], host: parts[2], port: port2, transport: parts[4] ?? null };
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
  var descriptor2 = Object.getOwnPropertyDescriptor, own = Object.hasOwn, keys = Reflect.ownKeys, array = Array.isArray, apply3 = Reflect.apply, includes = Array.prototype.includes, regexpExec = RegExp.prototype.exec, finite = Number.isFinite, integer3 = Number.isSafeInteger, objectIs = Object.is, create = Object.create, define = Object.defineProperty, startsWith = String.prototype.startsWith, patterns = Object.fromEntries(Object.entries(RTC_VALUE_FIELDS).flatMap(([name, spec]) => spec.type === "pattern" ? [[name, new RegExp(spec.pattern)]] : []));
  function field(value, key) {
    let found = descriptor2(value, key);
    return found && found.enumerable && own(found, "value") ? found.value : void 0;
  }
  function exact(value, count) {
    return value !== null && typeof value == "object" && !array(value) && keys(value).length === count;
  }
  function rtcValueFieldAllowed(profile, name) {
    let prefix = (value) => apply3(startsWith, name, [value]);
    return profile === "certificate" ? prefix("certificate.") : profile === "certificate-storage" ? prefix("certificate.") || prefix("storage.") : profile === "configuration" ? prefix("certificate.") || prefix("configuration.") : profile === "capabilities" ? prefix("codec.") || prefix("headerExtension.") : profile === "stats" ? prefix("stats.") || prefix("codec.") || prefix("certificate.") : profile === "media-settings" ? prefix("media.") && !apply3(includes, ["media.kind", "media.protocol", "media.payloadTypes", "media.direction", "media.rtcpMux"], [name]) : prefix("codec.") || prefix("headerExtension.") || prefix("description.") || prefix("dtls.") || apply3(includes, ["media.kind", "media.protocol", "media.payloadTypes", "media.direction", "media.rtcpMux", "certificate.sha-256", "certificate.sha-384", "certificate.sha-512"], [name]);
  }
  function validRtcFieldValue(name, value) {
    if (!own(RTC_VALUE_FIELDS, name)) return !1;
    let spec = RTC_VALUE_FIELDS[name];
    return spec ? spec.type === "boolean" ? typeof value == "boolean" : spec.type === "enum" ? typeof value == "string" && apply3(includes, spec.values, [value]) : spec.type === "pattern" ? typeof value == "string" && value.length <= spec.maximum && apply3(regexpExec, patterns[name], [value]) !== null : typeof value == "number" && finite(value) && !objectIs(value, -0) && value >= 0 && value <= spec.maximum && (spec.type !== "integer" || integer3(value)) : !1;
  }
  function rtcValueBytes(value) {
    let bytes2 = 256;
    for (let index = 0; index < value.fields.length; index++) {
      let entry = value.fields[index];
      bytes2 += 80 + entry.name.length + (typeof entry.value == "string" ? entry.value.length * 6 : 32);
    }
    return bytes2;
  }
  function readRtcValue(value) {
    try {
      if (!exact(value, 5) || field(value, "kind") !== "webrtc") return null;
      let profile = field(value, "profile"), source3 = field(value, "source"), rows = field(value, "fields"), truncated = field(value, "truncated");
      if (typeof profile != "string" || !apply3(includes, RTC_VALUE_PROFILES, [profile]) || source3 !== "returned" && source3 !== "native-snapshot" || typeof truncated != "boolean" || !array(rows) || rows.length > RTC_VALUE_LIMITS.fields || keys(rows).length !== rows.length + 1) return null;
      let fields2 = [], seen = create(null);
      for (let index = 0; index < rows.length; index++) {
        let row = field(rows, "" + index);
        if (!exact(row, 3)) return null;
        let name = field(row, "name"), position = field(row, "index"), content = field(row, "value");
        if (typeof name != "string" || !own(RTC_VALUE_FIELDS, name) || !rtcValueFieldAllowed(profile, name) || typeof position != "number" || !integer3(position) || position < 0 || position > RTC_VALUE_LIMITS.index || !validRtcFieldValue(name, content) || profile === "configuration" && source3 === "returned" && apply3(startsWith, name, ["certificate."])) return null;
        let key = name + ":" + position;
        if (seen[key]) return null;
        seen[key] = !0, define(fields2, index, { __proto__: null, value: { name, index: position, value: content }, enumerable: !0, configurable: !0, writable: !0 });
      }
      let result = { kind: "webrtc", profile, source: source3, fields: fields2, truncated };
      return rtcValueBytes(result) <= RTC_VALUE_LIMITS.bytes ? result : null;
    } catch {
      return null;
    }
  }

  // packages/contracts/src/api-results.ts
  var API_RESULTS_CHANNEL = "detect.expert/api-results/v1", API_RESULTS_LIMITS = Object.freeze({ rows: 256, stringChars: 256, vectorItems: 16, bytes: 65536, batchRows: 32, queryMs: 200 }), WEBGL_RESULT_PARAMETERS = [
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
  for (let [prefix, techniqueId, keys2] of additional) for (let key of keys2) {
    let operation = prefix + "." + key;
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
  for (let member of ["localDescription", "currentLocalDescription", "pendingLocalDescription", "remoteDescription", "currentRemoteDescription", "pendingRemoteDescription"]) {
    let definition = definitions2.get("RTCPeerConnection." + member);
    definition && (definition.typeOnly = !0);
  }
  var API_RESULT_DEFINITIONS = Object.freeze([...definitions2.values()]), apply4 = Reflect.apply, mapGet4 = Map.prototype.get, lowerCase = String.prototype.toLowerCase;
  function webglResultOperation(prefix, method, parameter) {
    let base = prefix + "." + method;
    if (method === "getParameter" && typeof parameter == "number") {
      let name = apply4(mapGet4, glParameters, [parameter]);
      if (name) return base + "." + name;
    }
    if (method === "getExtension" && typeof parameter == "string" && parameter.length <= 64) {
      let name = apply4(mapGet4, glExtensions, [apply4(lowerCase, parameter, [])]);
      if (name) return base + "." + name;
    }
    return base;
  }
  function apiResultDefinition(operation) {
    return typeof operation != "string" || operation.length > 128 ? null : apply4(mapGet4, definitions2, [operation]) ?? null;
  }
  var own2 = Object.getOwnPropertyDescriptor, keysOf = Reflect.ownKeys, hasOwn2 = Object.hasOwn, isArray = Array.isArray, finite2 = Number.isFinite, integer4 = Number.isInteger;
  var create2 = Object.create;
  var test3 = RegExp.prototype.test, ID = /^[A-Za-z0-9_-]{1,64}$/;
  function fields(value, names2) {
    if (typeof value != "object" || value === null || isArray(value) || keysOf(value).length !== names2.length) return null;
    let result = create2(null);
    for (let index = 0; index < names2.length; index++) {
      let name = names2[index], descriptor18 = own2(value, name);
      if (!descriptor18 || !hasOwn2(descriptor18, "value") || descriptor18.enumerable !== !0) return null;
      result[name] = descriptor18.value;
    }
    return result;
  }
  function nonNegative(value, maximum = 2147483647) {
    return typeof value == "number" && integer4(value) && value >= 0 && value <= maximum;
  }
  function apiResultEntryBytes(entry) {
    return entry.operation.length + 192 + (entry.value.kind === "string" ? entry.value.value.length * 6 : entry.value.kind === "number-array" ? entry.value.values.length * 32 : entry.value.kind === "webrtc" ? rtcValueBytes(entry.value) : 0);
  }
  function readApiResultsControl(value) {
    try {
      let record = fields(value, ["channel", "type", "requestId", "epoch"]);
      return !record || record.channel !== API_RESULTS_CHANNEL || record.type !== "api-results-read" && record.type !== "api-results-reset" || typeof record.requestId != "string" || !apply4(test3, ID, [record.requestId]) || !nonNegative(record.epoch) ? null : { channel: API_RESULTS_CHANNEL, type: record.type, requestId: record.requestId, epoch: record.epoch };
    } catch {
      return null;
    }
  }

  // packages/sensors/src/wrap.ts
  var apply5 = Reflect.apply, construct = Reflect.construct, NativeProxy = Proxy, rawDefineProperty = Object.defineProperty, hasOwn3 = Function.prototype.call.bind(Object.prototype.hasOwnProperty), create3 = Object.create;
  function defineProperty(target, key, descriptor18) {
    let clean = create3(null);
    hasOwn3(descriptor18, "value") && (clean.value = descriptor18.value), hasOwn3(descriptor18, "writable") && (clean.writable = descriptor18.writable === !0), hasOwn3(descriptor18, "get") && (clean.get = descriptor18.get), hasOwn3(descriptor18, "set") && (clean.set = descriptor18.set), hasOwn3(descriptor18, "enumerable") && (clean.enumerable = descriptor18.enumerable === !0), hasOwn3(descriptor18, "configurable") && (clean.configurable = descriptor18.configurable === !0), rawDefineProperty(target, key, clean);
  }
  var getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor, getOwnPropertyNames = Object.getOwnPropertyNames, getOwnPropertySymbols = Object.getOwnPropertySymbols, getPrototypeOf = Object.getPrototypeOf, setPrototypeOf = Object.setPrototypeOf;
  function createHookContext() {
    return { enabled: !0, observerErrors: 0 };
  }
  var defaultContext = createHookContext(), observing = !1, registry = /* @__PURE__ */ new WeakMap();
  function labelOf(key) {
    return typeof key == "symbol" ? "Symbol(" + (key.description ?? "") + ")" : String(key);
  }
  function noteObserverError(ctx) {
    ctx.observerErrors < 2147483647 && ctx.observerErrors++;
    try {
      ctx.onObserverError?.();
    } catch {
    }
  }
  function unsupported(kind, target, key, reason) {
    return {
      status: "unsupported",
      kind,
      target,
      key,
      label: labelOf(key),
      reason,
      coverageFlag: reason === "non-configurable" ? "descriptor-nonconfigurable" : "hook-failed"
    };
  }
  function existingHandle(target, key) {
    let perTarget = registry.get(target);
    return perTarget === void 0 ? null : perTarget.get(key) ?? null;
  }
  function remember(target, key, handle) {
    let perTarget = registry.get(target);
    perTarget === void 0 && (perTarget = /* @__PURE__ */ new Map(), registry.set(target, perTarget)), perTarget.set(key, handle);
  }
  function forget(target, key) {
    registry.get(target)?.delete(key);
  }
  function copyFunctionMeta(wrapper, original) {
    let keys2 = ["length", "name"];
    for (let i = 0; i < keys2.length; i++) {
      let k = keys2[i], d = getOwnPropertyDescriptor(original, k);
      if (d !== void 0 && hasOwn3(d, "value"))
        try {
          defineProperty(wrapper, k, { value: d.value, writable: !1, enumerable: !1, configurable: !0 });
        } catch {
        }
    }
  }
  function makeHandle(kind, target, key, originalDescriptor, isOwned) {
    let handle = {
      status: "installed",
      kind,
      target,
      key,
      label: labelOf(key),
      isOwned,
      restore() {
        if (!isOwned()) return !1;
        try {
          defineProperty(target, key, originalDescriptor);
        } catch {
          return !1;
        }
        return forget(target, key), !0;
      }
    };
    return remember(target, key, handle), handle;
  }
  function installMethodWrapper(target, key, desc, wrapper, options) {
    options?.copyNameAndLength !== !1 && copyFunctionMeta(wrapper, desc.value);
    try {
      // REQ-002 / ADR-006: keep the function prototype of the original realm.
      setPrototypeOf(wrapper, getPrototypeOf(desc.value));
      defineProperty(target, key, {
        value: wrapper,
        writable: desc.writable === !0,
        enumerable: desc.enumerable === !0,
        configurable: !0
      });
    } catch {
      return unsupported("method", target, key, "define-failed");
    }
    return makeHandle("method", target, key, desc, () => {
      let d = getOwnPropertyDescriptor(target, key);
      return d !== void 0 && hasOwn3(d, "value") && d.value === wrapper;
    });
  }
  function wrapPreparedMethod(target, key, prepare, observe, options) {
    let existing = existingHandle(target, key);
    if (existing !== null) return existing;
    let desc = getOwnPropertyDescriptor(target, key);
    if (desc === void 0) return unsupported("method", target, key, "missing");
    if (desc.configurable !== !0) return unsupported("method", target, key, "non-configurable");
    if (!hasOwn3(desc, "value") || typeof desc.value != "function") return unsupported("method", target, key, "not-a-method");
    let original = desc.value, ctx = options?.context ?? defaultContext, { wrapper } = {
      wrapper() {
        let prepared = !1, state;
        if (ctx.enabled && !observing) {
          observing = !0;
          try {
            state = prepare(this, arguments), prepared = !0;
          } catch {
            noteObserverError(ctx);
          } finally {
            observing = !1;
          }
        }
        let result, error, threw = !1;
        try {
          result = apply5(original, this, arguments);
        } catch (caught) {
          error = caught, threw = !0;
        }
        if (prepared && ctx.enabled && !observing) {
          observing = !0;
          try {
            observe(state, this, arguments, threw);
          } catch {
            noteObserverError(ctx);
          } finally {
            observing = !1;
          }
        }
        if (threw) throw error;
        return result;
      }
    };
    return installMethodWrapper(target, key, desc, wrapper, options);
  }
  function wrapMethod(target, key, observe, options) {
    let existing = existingHandle(target, key);
    if (existing !== null) return existing;
    let desc = getOwnPropertyDescriptor(target, key);
    if (desc === void 0) return unsupported("method", target, key, "missing");
    if (desc.configurable !== !0) return unsupported("method", target, key, "non-configurable");
    if (!hasOwn3(desc, "value") || typeof desc.value != "function") return unsupported("method", target, key, "not-a-method");
    let original = desc.value, ctx = options?.context ?? defaultContext, { wrapper } = {
      wrapper() {
        let threw = !1, error, result;
        try {
          result = apply5(original, this, arguments);
        } catch (e) {
          threw = !0, error = e;
        }
        if (ctx.enabled && !observing) {
          observing = !0;
          try {
            observe(this, arguments, threw, error, result);
          } catch {
            noteObserverError(ctx);
          } finally {
            observing = !1;
          }
        }
        if (threw) throw error;
        return result;
      }
    };
    return installMethodWrapper(target, key, desc, wrapper, options);
  }
  function wrapOutcomeMethod(target, key, observe, options) {
    let existing = existingHandle(target, key);
    if (existing !== null) return existing;
    let desc = getOwnPropertyDescriptor(target, key);
    if (desc === void 0) return unsupported("method", target, key, "missing");
    if (desc.configurable !== !0) return unsupported("method", target, key, "non-configurable");
    if (!hasOwn3(desc, "value") || typeof desc.value != "function") return unsupported("method", target, key, "not-a-method");
    let original = desc.value, ctx = options?.context ?? defaultContext, { wrapper } = {
      wrapper() {
        let threw = !1, error, result;
        try {
          result = apply5(original, this, arguments);
        } catch (e) {
          threw = !0, error = e;
        }
        if (ctx.enabled && !observing) {
          observing = !0;
          try {
            observe(threw);
          } catch {
            noteObserverError(ctx);
          } finally {
            observing = !1;
          }
        }
        if (threw) throw error;
        return result;
      }
    };
    return installMethodWrapper(target, key, desc, wrapper, options);
  }
  function wrapResultMethod(target, key, observe, options) {
    let existing = existingHandle(target, key);
    if (existing !== null) return existing;
    let desc = getOwnPropertyDescriptor(target, key);
    if (desc === void 0) return unsupported("method", target, key, "missing");
    if (desc.configurable !== !0) return unsupported("method", target, key, "non-configurable");
    if (!hasOwn3(desc, "value") || typeof desc.value != "function") return unsupported("method", target, key, "not-a-method");
    let original = desc.value, ctx = options?.context ?? defaultContext, { wrapper } = {
      wrapper() {
        let threw = !1, error, result;
        try {
          result = apply5(original, this, arguments);
        } catch (caught) {
          threw = !0, error = caught;
        }
        if (ctx.enabled && !observing) {
          observing = !0;
          try {
            observe(threw, result, arguments);
          } catch {
            noteObserverError(ctx);
          } finally {
            observing = !1;
          }
        }
        if (threw) throw error;
        return result;
      }
    };
    return installMethodWrapper(target, key, desc, wrapper, options);
  }
  function wrapGetter(target, key, observe, options) {
    let existing = existingHandle(target, key);
    if (existing !== null) return existing;
    let desc = getOwnPropertyDescriptor(target, key);
    if (desc === void 0) return unsupported("getter", target, key, "missing");
    if (desc.configurable !== !0) return unsupported("getter", target, key, "non-configurable");
    if (!hasOwn3(desc, "get") || typeof desc.get != "function") return unsupported("getter", target, key, "not-a-getter");
    let original = desc.get, ctx = options?.context ?? defaultContext, { wrapper } = {
      wrapper() {
        let threw = !1, error, result;
        try {
          result = apply5(original, this, arguments);
        } catch (e) {
          threw = !0, error = e;
        }
        if (ctx.enabled && !observing) {
          observing = !0;
          try {
            observe(this, threw, error, result);
          } catch {
            noteObserverError(ctx);
          } finally {
            observing = !1;
          }
        }
        if (threw) throw error;
        return result;
      }
    };
    options?.copyNameAndLength !== !1 && copyFunctionMeta(wrapper, original);
    let next = { get: wrapper, enumerable: desc.enumerable === !0, configurable: !0 };
    desc.set !== void 0 && (next.set = desc.set);
    // One registry handle owns both accessor functions; preserve native setter semantics.
    if (typeof desc.set === "function" && typeof options?.observeSetter === "function") {
      const originalSetter = desc.set, observeSetter = options.observeSetter;
      const setter = function(value) {
        let threw = !1, error, result;
        try { result = apply5(originalSetter, this, arguments); } catch (caught) { threw = !0; error = caught; }
        if (ctx.enabled && !observing) {
          observing = !0;
          try { observeSetter(this, arguments, threw, error, result); }
          catch { noteObserverError(ctx); }
          finally { observing = !1; }
        }
        if (threw) throw error;
        return result;
      };
      options?.copyNameAndLength !== !1 && copyFunctionMeta(setter, originalSetter);
      try { setPrototypeOf(setter, getPrototypeOf(originalSetter)); } catch { return unsupported("getter", target, key, "define-failed"); }
      next.set = setter;
    }
    try {
      setPrototypeOf(wrapper, getPrototypeOf(original));
      defineProperty(target, key, next);
    } catch {
      return unsupported("getter", target, key, "define-failed");
    }
    return makeHandle("getter", target, key, desc, () => {
      let d = getOwnPropertyDescriptor(target, key);
      return d !== void 0 && hasOwn3(d, "get") && d.get === wrapper && d.set === next.set;
    });
  }
  function wrapSetter(target, key, observe, options) {
    let existing = existingHandle(target, key);
    if (existing !== null) return existing;
    let desc = getOwnPropertyDescriptor(target, key);
    if (desc === void 0) return unsupported("setter", target, key, "missing");
    if (desc.configurable !== !0) return unsupported("setter", target, key, "non-configurable");
    if (!hasOwn3(desc, "set") || typeof desc.set != "function") return unsupported("setter", target, key, "not-a-setter");
    let original = desc.set, ctx = options?.context ?? defaultContext, { wrapper } = {
      wrapper() {
        let threw = !1, error, result;
        try {
          result = apply5(original, this, arguments);
        } catch (e) {
          threw = !0, error = e;
        }
        if (ctx.enabled && !observing) {
          observing = !0;
          try {
            observe(this, arguments, threw, error, result);
          } catch {
            noteObserverError(ctx);
          } finally {
            observing = !1;
          }
        }
        if (threw) throw error;
        return result;
      }
    };
    options?.copyNameAndLength !== !1 && copyFunctionMeta(wrapper, original);
    let next = { set: wrapper, enumerable: desc.enumerable === !0, configurable: !0 };
    desc.get !== void 0 && (next.get = desc.get);
    try {
      setPrototypeOf(wrapper, getPrototypeOf(original));
      defineProperty(target, key, next);
    } catch {
      return unsupported("setter", target, key, "define-failed");
    }
    return makeHandle("setter", target, key, desc, () => {
      let d = getOwnPropertyDescriptor(target, key);
      return d !== void 0 && hasOwn3(d, "set") && d.set === wrapper && d.get === desc.get;
    });
  }
  var SKIPPED_STATICS = /* @__PURE__ */ new Set(["prototype", "length", "name", "arguments", "caller"]);
  function wrapConstructor(target, key, observe, options) {
    let existing = existingHandle(target, key);
    if (existing !== null) return existing;
    let desc = getOwnPropertyDescriptor(target, key);
    if (desc === void 0) return unsupported("constructor", target, key, "missing");
    if (desc.configurable !== !0) return unsupported("constructor", target, key, "non-configurable");
    if (!hasOwn3(desc, "value") || typeof desc.value != "function") return unsupported("constructor", target, key, "not-a-constructor");
    let original = desc.value, protoDesc = getOwnPropertyDescriptor(original, "prototype");
    if (protoDesc === void 0 || !hasOwn3(protoDesc, "value")) return unsupported("constructor", target, key, "not-a-constructor");
    let ctx = options?.context ?? defaultContext;
    function invoke(thisArg, args, newTarget) {
      let threw = !1, error, result;
      try {
        result = newTarget === void 0 ? apply5(original, thisArg, args) : construct(original, args, newTarget === wrapper ? original : newTarget);
      } catch (e) {
        threw = !0, error = e;
      }
      if (ctx.enabled && !observing) {
        observing = !0;
        try {
          observe(args, newTarget, threw, error, result);
        } catch {
          noteObserverError(ctx);
        } finally {
          observing = !1;
        }
      }
      if (threw) throw error;
      return result;
    }
    function constructAdapter() {
      return invoke(void 0, arguments, this);
    }
    let wrapper = new NativeProxy(function() {
      return invoke(this, arguments, void 0);
    }, {
      __proto__: null,
      construct(_target, args, newTarget) {
        return apply5(constructAdapter, newTarget, args);
      }
    });
    try {
      defineProperty(wrapper, "prototype", {
        value: protoDesc.value,
        writable: protoDesc.writable === !0,
        enumerable: !1,
        configurable: !1
      });
      for (let k of [...getOwnPropertyNames(original), ...getOwnPropertySymbols(original)]) {
        if (SKIPPED_STATICS.has(k)) continue;
        let d = getOwnPropertyDescriptor(original, k);
        d !== void 0 && defineProperty(wrapper, k, d);
      }
      if (setPrototypeOf(wrapper, getPrototypeOf(original)), options?.copyNameAndLength !== !1)
        for (let k of ["length", "name"]) {
          let d = getOwnPropertyDescriptor(original, k);
          d !== void 0 && hasOwn3(d, "value") && defineProperty(wrapper, k, d);
        }
    } catch {
      return unsupported("constructor", target, key, "define-failed");
    }
    try {
      defineProperty(target, key, {
        value: wrapper,
        writable: desc.writable === !0,
        enumerable: desc.enumerable === !0,
        configurable: !0
      });
    } catch {
      return unsupported("constructor", target, key, "define-failed");
    }
    return makeHandle("constructor", target, key, desc, () => {
      let d = getOwnPropertyDescriptor(target, key);
      return d !== void 0 && hasOwn3(d, "value") && d.value === wrapper;
    });
  }

  // packages/sensors/src/intrinsics.ts
  var defineProperty2 = Object.defineProperty;
  function arrayPush(a, value) {
    return defineProperty2(a, a.length, { __proto__: null, value, writable: !0, enumerable: !0, configurable: !0 }), a.length;
  }
  function arraySlice(a, start = 0, end = a.length) {
    let out = [];
    for (let i = start; i < end && i < a.length; i++) arrayPush(out, a[i]);
    return out;
  }
  function arraySplice(a, start, count) {
    let end = start + count < a.length ? start + count : a.length;
    for (let i = end; i < a.length; i++) a[start + i - end] = a[i];
    a.length -= end - start;
  }
  var arrayIncludes = Function.prototype.call.bind(Array.prototype.includes), arraySort = Function.prototype.call.bind(Array.prototype.sort), setHas = Function.prototype.call.bind(Set.prototype.has), setAdd = Function.prototype.call.bind(Set.prototype.add), setForEach = Function.prototype.call.bind(Set.prototype.forEach), mapSize = Function.prototype.call.bind(Object.getOwnPropertyDescriptor(Map.prototype, "size").get), mapForEach = Function.prototype.call.bind(Map.prototype.forEach), weakSetHas = Function.prototype.call.bind(WeakSet.prototype.has), weakSetAdd = Function.prototype.call.bind(WeakSet.prototype.add), weakSetDelete = Function.prototype.call.bind(WeakSet.prototype.delete);
  function setArray(set3) {
    let out = [];
    return setForEach(set3, (value) => {
      arrayPush(out, value);
    }), out;
  }

  // packages/sensors/src/codes.ts
  function indexOf(list) {
    let out = /* @__PURE__ */ Object.create(null);
    return list.forEach((value, i) => {
      out[value] = i;
    }), Object.freeze(out);
  }
  var PHASE_SHIFT = 17, TECHNIQUE_SHIFT = 21, PHASE_BITS = 15, MASK_BITS = 131071, LEGACY_SIGNALS = 17, EXTENDED_BASE = 2 ** 43, EXTENDED_PHASES = 8, OPERATION_BASE = 2 ** 31, EXTENSION_RESOURCE_BASE = 2 ** 32, floor = Math.floor, safeInteger = Number.isSafeInteger;
  if (SIGNAL_CODES.length > 43 || PHASES.length > EXTENDED_PHASES || TECHNIQUE_IDS.length > 128)
    throw new Error("codes: key layout cannot represent the contract enums");
  var TECHNIQUE_INDEX = indexOf(TECHNIQUE_IDS), PHASE_INDEX = indexOf(PHASES), API_OPERATION_INDEX = indexOf(API_OPERATIONS), EXTENSION_METHOD_INDEX = indexOf(EXTENSION_RESOURCE_METHODS);
  function extensionResourceKey(resourceIndex, phaseIndex) {
    return EXTENSION_RESOURCE_BASE + resourceIndex * EXTENDED_PHASES + phaseIndex;
  }
  function operationKey(operationIndex, phaseIndex) {
    return OPERATION_BASE + operationIndex * EXTENDED_PHASES + phaseIndex;
  }
  var SIGNAL_BIT = (() => {
    let out = {};
    return SIGNAL_CODES.forEach((code, i) => {
      out[code] = 2 ** i;
    }), Object.freeze(out);
  })();
  function signalMaskOf(codes) {
    let mask = 0;
    for (let i = 0; i < codes.length; i++) {
      let duplicate = !1;
      for (let j = 0; j < i; j++) if (codes[j] === codes[i]) {
        duplicate = !0;
        break;
      }
      duplicate || (mask += SIGNAL_BIT[codes[i]]);
    }
    return mask;
  }
  function compositeKey(techniqueIndex, phaseIndex, signalMask) {
    return signalMask > MASK_BITS ? -((techniqueIndex * EXTENDED_PHASES + phaseIndex) * EXTENDED_BASE + signalMask) : techniqueIndex << TECHNIQUE_SHIFT | phaseIndex << PHASE_SHIFT | signalMask & MASK_BITS;
  }
  function decodeKey(key) {
    if (!safeInteger(key)) return null;
    if (key >= EXTENSION_RESOURCE_BASE) {
      let offset = key - EXTENSION_RESOURCE_BASE, resourceIndex = floor(offset / EXTENDED_PHASES), target = EXTENSION_TARGET_KEYS[floor(resourceIndex / EXTENSION_RESOURCE_METHODS.length)], method = EXTENSION_RESOURCE_METHODS[resourceIndex % EXTENSION_RESOURCE_METHODS.length], phase2 = PHASES[offset % EXTENDED_PHASES];
      return target === void 0 || method === void 0 || phase2 === void 0 || !extensionResourceAllows({ target, method }, "DET-059", phase2) ? null : { techniqueId: "DET-059", phase: phase2, signalCodes: ["api-use"], extensionResource: { target, method } };
    }
    if (key >= OPERATION_BASE) {
      let offset = key - OPERATION_BASE, definition = API_OPERATION_DEFINITIONS[floor(offset / EXTENDED_PHASES)], phase2 = PHASES[offset % EXTENDED_PHASES];
      return !definition || phase2 === void 0 || !apiOperationAllows(definition[0], definition[1], phase2) ? null : { techniqueId: definition[1], apiOperation: definition[0], phase: phase2, signalCodes: ["api-use"] };
    }
    let techniqueIndex, phaseIndex, mask, extended = key < 0;
    if (extended) {
      let packed = floor(-key / EXTENDED_BASE);
      if (mask = -key - packed * EXTENDED_BASE, mask <= MASK_BITS || mask >= 2 ** SIGNAL_CODES.length) return null;
      techniqueIndex = floor(packed / EXTENDED_PHASES), phaseIndex = packed % EXTENDED_PHASES;
    } else {
      if (key >= 2 ** 31) return null;
      techniqueIndex = key >>> TECHNIQUE_SHIFT, phaseIndex = key >>> PHASE_SHIFT & PHASE_BITS, mask = key & MASK_BITS;
    }
    let techniqueId = TECHNIQUE_IDS[techniqueIndex], phase = PHASES[phaseIndex];
    if (techniqueId === void 0 || phase === void 0) return null;
    let signalCodes = [];
    for (let i = 0; i < (extended ? SIGNAL_CODES.length : LEGACY_SIGNALS); i++)
      if (extended ? floor(mask / 2 ** i) % 2 !== 0 : (mask & 1 << i) !== 0) {
        let code = SIGNAL_CODES[i];
        code !== void 0 && arrayPush(signalCodes, code);
      }
    return arraySort(signalCodes), { techniqueId, phase, signalCodes };
  }

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
  // ADR-030 beacon MAIN sensor start
  var beaconEndpointProjector = (function createBeaconEndpointProjector() {
  const apply = Reflect.apply, exec = RegExp.prototype.exec, lower = String.prototype.toLowerCase, descriptor = Object.getOwnPropertyDescriptor;
  const matches = (pattern, value) => apply(exec, pattern, [value]) !== null;
  return input => {
    const raw = descriptor(input, 'url')?.value;
    if (typeof raw !== 'string' || raw.length > 32768) return null;
    const parsed = apply(exec, /^https:\/\/([a-z0-9.-]+)(?::443)?(\/[^?#]*)?(?:[?#][\s\S]*)?$/i, [raw]);
    if (!parsed) return null;
    const host = apply(lower, parsed[1], []), path = parsed[2] ?? '/'; let service, profile;
    if (matches(/^(?:www|region1|analytics)\.google-analytics\.com$/, host)) {
      if (path === '/mp/collect') { service = 'google-analytics'; profile = 'ga4-mp-v1'; }
      else if (path === '/g/collect' || path === '/j/collect') { service = 'google-analytics'; profile = 'ga4-browser-v1'; }
    } else if (matches(/^(?:www\.googleadservices\.com|www\.google\.com|googleads\.g\.doubleclick\.net)$/, host) && matches(/^\/pagead\/(?:1p-)?(?:conversion|viewthroughconversion)\/[0-9]{1,20}\/?$/, path)) { service = 'google-ads'; profile = 'google-ads-browser-v1'; }
    else if (host === 'www.facebook.com' && matches(/^\/tr\/?$/, path)) { service = 'meta'; profile = 'meta-browser-v1'; }
    else if (host === 'graph.facebook.com' && matches(/^\/v[0-9]{1,2}\.[0-9]{1,2}\/[0-9]{1,24}\/events\/?$/, path)) { service = 'meta'; profile = 'meta-capi-v1'; }
    else if (host === 'analytics.tiktok.com' && matches(/^\/api\/v[12]\/(?:pixel|i18n\/pixel)\/?$/, path)) { service = 'tiktok'; profile = 'tiktok-browser-v1'; }
    else if (host === 'business-api.tiktok.com' && path === '/open_api/v1.3/event/track/') { service = 'tiktok'; profile = 'tiktok-events-v1'; }
    else if (matches(/^mc\.(?:yandex\.(?:ru|com|com\.tr|kz|by)|webvisor\.org)$/, host)) {
      if (matches(/^\/watch\/[0-9]{1,20}\/?$/, path)) { service = 'yandex'; profile = 'yandex-watch-v1'; }
      else if (path === '/collect') { service = 'yandex'; profile = 'yandex-mp-v1'; }
    } else if (host === 'px.ads.linkedin.com' && matches(/^\/collect\/?$/, path)) { service = 'linkedin'; profile = 'linkedin-image-v1'; }
    else if (host === 'api.linkedin.com' && path === '/rest/conversionEvents') { service = 'linkedin'; profile = 'linkedin-capi-v1'; }
    if (!profile) return null;
    return { service, profile, destinationHost: host, schemaConfidence: 'endpoint-only', events: [], money: [], identifiers: { clientId: 'unknown', browserId: 'unknown', sessionId: 'unknown', userId: 'unknown', hashedEmail: 'unknown', hashedPhone: 'unknown' }, consent: { gcs: 'unknown', gcd: 'unknown', adUserData: 'unknown', adPersonalization: 'unknown' }, parameterNames: [], decodeStatus: 'endpoint-only' };
  };
})();
  var beaconSensorSupport = (function createBeaconSensorSupport(decode) {
  const apply = Reflect.apply, descriptor = Object.getOwnPropertyDescriptor;
  const NativeMap = Map, NativeWeakMap = WeakMap, stringify = JSON.stringify;
  const mapGet = Map.prototype.get, mapSet = Map.prototype.set, mapEach = Map.prototype.forEach, weakGet = WeakMap.prototype.get, weakSet = WeakMap.prototype.set;
  const push = Array.prototype.push, own = (object, key) => descriptor(object, key)?.value;
  const guarded = [];
  for (const [object, keys] of [
    [String.prototype, ['includes', 'split', 'slice', 'replace', 'startsWith', 'endsWith', 'toUpperCase']],
    [Array.prototype, ['includes', 'map', 'some', 'flatMap', 'reduce', 'push', 'slice', 'toJSON', Symbol.iterator]], [Object.prototype, ['toJSON']],
    [Map.prototype, ['get', 'set', 'values', Symbol.iterator]], [Set.prototype, ['has', 'add']],
    [RegExp.prototype, ['test', 'exec']], [Object, ['getOwnPropertyDescriptor', 'hasOwn', 'fromEntries', 'create']],
    [Reflect, ['ownKeys']], [Number, ['isFinite']], [Object, ['is']], [JSON, ['parse', 'stringify']],
    [Object.getPrototypeOf(new NativeMap().entries()), ['next']], [Object.getPrototypeOf([].values()), ['next']],
  ]) for (const key of keys) { const entry = descriptor(object, key); guarded.push([object, key, entry?.value, entry?.get, entry?.set]); }
  const stable = () => { for (let index = 0; index < guarded.length; ++index) { const expected = guarded[index], entry = descriptor(expected[0], expected[1]); if (entry?.value !== expected[2] || entry?.get !== expected[3] || entry?.set !== expected[4]) return false; } return true; };
  function createCollector() {
    let rows = new NativeMap(), nodes = new NativeWeakMap(), xhr = new NativeWeakMap(), rowCount = 0, nodeCount = 0, xhrCount = 0, bytes = 256, truncated = false, lastReadAt = -Infinity;
    return {
      reset() { rows = new NativeMap(); nodes = new NativeWeakMap(); xhr = new NativeWeakMap(); rowCount = 0; nodeCount = 0; xhrCount = 0; bytes = 256; truncated = false; lastReadAt = -Infinity; },
      prepare(raw, method) {
        if (typeof raw !== 'string' || !stable()) { if (typeof raw === 'string') truncated = true; return null; }
        return decode({ url: raw, method: method === 'GET' || method === 'POST' || method === 'PUT' ? method : 'unknown', bodyAvailable: false });
      },
      record(decoded, requestType, method, source, node = null, force = false) {
        if (!decoded || !stable()) return;
        const attribution = source(), script = attribution?.script ?? null;
        const row = { ...decoded, method: method === 'GET' || method === 'POST' || method === 'PUT' ? method : 'unknown', requestType: ['image', 'xmlhttprequest', 'ping', 'script'].includes(requestType) ? requestType : 'other', count: 1, completedCount: 0, failedCount: 0, redirectCount: 0, statusCodes: [], evidenceSource: 'page-hook', integrity: 'page-controlled', attributionConfidence: script ? attribution.attributionConfidence : 'unknown', initiatorHost: null, script };
        const key = apply(stringify, JSON, [row]);
        if (node !== null && (typeof node === 'object' || typeof node === 'function')) {
          const previous = apply(weakGet, nodes, [node]);
          if (!force && previous === key) return;
          if (previous === undefined && nodeCount++ >= 512) { truncated = true; return; }
          apply(weakSet, nodes, [node, key]);
        }
        const previous = apply(mapGet, rows, [key]);
        if (previous) { if (previous.count < 2147483647) previous.count++; return; }
        const cost = 256 + key.length * 2;
        if (rowCount >= 32 || bytes + cost > 12000) { truncated = true; return; }
        rowCount++; bytes += cost; apply(mapSet, rows, [key, row]);
      },
      open(receiver, args, threw) {
        if (receiver === null || typeof receiver !== 'object') return;
        const prior = apply(weakGet, xhr, [receiver]);
        if (prior === undefined && xhrCount++ >= 512) { truncated = true; return; }
        const decoded = !threw ? this.prepare(args[1], args[0]) : null;
        apply(weakSet, xhr, [receiver, decoded ? { decoded, method: args[0] } : null]);
      },
      send(receiver, source) { const entry = apply(weakGet, xhr, [receiver]); if (entry) this.record(entry.decoded, 'xmlhttprequest', entry.method, source); },
      snapshot() { const output = []; apply(mapEach, rows, [row => apply(push, output, [row])]); return { rows: output, truncated }; },
      handleControl(data, enabled, env) {
        if (!data || typeof data !== 'object' || own(data, 'channel') !== 'detect.expert/beacon/v1' || own(data, 'type') !== 'beacon-values-read') return;
        const requestId = own(data, 'requestId');
        if (typeof requestId !== 'string' || !/^beacon-[0-9]{1,10}$/.test(requestId)) return;
        const now = env.now(); if (now - lastReadAt < 500) return; lastReadAt = now;
        const snapshot = enabled && stable() ? this.snapshot() : { rows: [], truncated: true };
        env.postMessage({ channel: 'detect.expert/beacon/v1', type: 'beacon-values-batch', requestId, enabled, rows: snapshot.rows, truncated: snapshot.truncated });
      },
    };
  }
  function install(runtime) {
    const collector = runtime.apiResults.beaconCollector; let generation = runtime.apiResults.generation;
    const active = () => { if (generation !== runtime.apiResults.generation) { generation = runtime.apiResults.generation; collector.reset(); } return runtime.hooks.enabled; };
    runtime.observeBeaconRequest = (raw, type, method, source, node, force) => { if (active()) collector.record(collector.prepare(raw, method), type, method, source, node, force); };
    runtime.observeBeaconXhrOpen = (receiver, args, threw) => { if (active()) collector.open(receiver, args, threw); };
    runtime.observeBeaconXhrSend = (receiver, source) => { if (active()) collector.send(receiver, source); };
    runtime.onStop(() => collector.reset());
  }
  return { createCollector, install };
})(beaconEndpointProjector);
  // ADR-030 beacon MAIN sensor end

  // packages/sensors/src/social-network.ts
  var socialNetworkDetector = (function createSocialNetworkDetector(trustedURL = false) {
  const apply = Reflect.apply, descriptor = Object.getOwnPropertyDescriptor;
  const NativeURL = descriptor(globalThis, 'URL')?.value;
  const nativeSource = Function.prototype.toString, exec = RegExp.prototype.exec;
  const ends = String.prototype.endsWith, includes = Array.prototype.includes;
  const match = (pattern, value) => apply(exec, pattern, [value]) !== null;
  const native = fn => typeof fn === 'function' && match(/\[native code\]/, apply(nativeSource, fn, []));
  const getters = Object.create(null);
  let ready = false;
  try {
    if (typeof NativeURL === 'function' && (trustedURL || native(NativeURL))) {
      const prototype = descriptor(NativeURL, 'prototype')?.value;
      ready = !!prototype;
      for (const key of ['protocol', 'hostname', 'pathname', 'username', 'password', 'port']) {
        const entry = prototype && descriptor(prototype, key);
        if (!entry || typeof entry.get !== 'function' || !trustedURL && !native(entry.get)) { ready = false; break; }
        getters[key] = entry.get;
      }
    }
  } catch { ready = false; }
  const field = (url, key) => apply(getters[key], url, []);
  const suffix = (host, domain) => host === domain || apply(ends, host, ['.' + domain]);
  const services = [
    ['facebook', ['facebook.com', 'facebook.net']], ['instagram', ['instagram.com']],
    ['x', ['twitter.com', 'x.com', 't.co', 'ads-twitter.com']], ['linkedin', ['linkedin.com', 'licdn.com']],
    ['tiktok', ['tiktok.com']], ['snapchat', ['snapchat.com', 'sc-static.net']],
    ['pinterest', ['pinterest.com', 'pinimg.com']], ['reddit', ['reddit.com', 'redditmedia.com', 'redditstatic.com']],
    ['discord', ['discord.com', 'discordapp.com']], ['twitch', ['twitch.tv']],
    ['youtube', ['youtube.com', 'youtube-nocookie.com']], ['github', ['github.com']],
    ['gitlab', ['gitlab.com']], ['vk', ['vk.com', 'vk.ru', 'vkuser.net']],
    ['ok', ['ok.ru']], ['weibo', ['weibo.com']], ['wechat', ['weixin.qq.com', 'wx.qq.com']], ['qq', ['qq.com']],
    ['telegram', ['telegram.org']], ['line', ['line.me', 'line-scdn.net']],
    ['google', ['accounts.google.com', 'apis.google.com', 'googletagmanager.com', 'google-analytics.com', 'analytics.google.com', 'googleadservices.com', 'googlesyndication.com', 'doubleclick.net']],
    ['microsoft', ['login.microsoftonline.com', 'login.live.com', 'bat.bing.com']], ['apple', ['appleid.apple.com']],
    ['spotify', ['accounts.spotify.com']], ['steam', ['steamcommunity.com']],
    ['yahoo', ['login.yahoo.com']], ['tumblr', ['tumblr.com']],
    ['quora', ['quora.com']], ['disqus', ['disqus.com']], ['yandex', ['yandex.ru', 'yandex.com']], ['mailru', ['mail.ru']],
    ['kakao', ['kakao.com', 'kakaocdn.net', 'bc.ad.daum.net']], ['naver', ['naver.com', 'naver.net']],
    ['baidu', ['baidu.com']], ['bluesky', ['bsky.app']], ['sharethis', ['sharethis.com']],
    ['douyin', ['douyin.com']], ['mastodon', ['mastodon.social', 'mastodon.online']], ['addthis', ['addthis.com']],
    ['whatsapp', ['whatsapp.com', 'wa.me']], ['viber', ['viber.com']], ['threads', ['threads.com', 'threads.net']],
    ['vimeo', ['vimeo.com']], ['dailymotion', ['dailymotion.com']], ['soundcloud', ['soundcloud.com']],
  ];
  const types = ['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'webtransport', 'webbundle', 'other'];
  function parse(raw, source = false) {
    if (!ready || typeof raw !== 'string' || raw.length > 4096 || match(/[\u0000-\u0020\u007f\\]/, raw)) return null;
    try {
      const url = new NativeURL(raw);
      const protocol = field(url, 'protocol');
      if ((protocol !== 'https:' && !(source && protocol === 'http:')) || field(url, 'username') || field(url, 'password') || !source && field(url, 'port')) return null;
      return { host: field(url, 'hostname'), path: field(url, 'pathname') };
    } catch { return null; }
  }
  function classify(raw, requestType = 'other', method = 'GET') {
    if (!apply(includes, types, [requestType])) return null;
    const url = parse(raw);
    if (!url) return null;
    const { host, path } = url;
    // These CDNs are shared by products: only a documented path identifies the
    // provider. Other resources on the same host remain unclassified.
    const kakaoPixel = host === 't1.daumcdn.net' && path === '/kas/static/kp.js';
    const douyinSdk = host === 'unpkg.byted-static.com' && match(/^\/bridge\/douyin_open\/[0-9]+\.[0-9]+\.[0-9]+\/lib\/douyin_open\.umd\.js$/, path);
    let service = kakaoPixel ? 'kakao' : douyinSdk ? 'douyin' : null;
    for (const [id, domains] of services) {
      if (service) break;
      for (let index = 0; index < domains.length; index++) if (suffix(host, domains[index])) { service = id; break; }
      if (service) break;
    }
    if (!service) return null;
    let endpoint = 'service', kind = 'service-request';
    const trackingSdk = requestType === 'script' && (
      host === 'connect.facebook.net' && match(/^\/[a-z]{2}_[A-Z]{2}\/fbevents\.js$/, path) ||
      host === 'static.ads-twitter.com' && path === '/uwt.js' ||
      host === 'snap.licdn.com' && path === '/li.lms-analytics/insight.min.js' ||
      host === 'analytics.tiktok.com' && path === '/i18n/pixel/events.js' ||
      host === 'sc-static.net' && path === '/scevent.min.js' ||
      host === 's.pinimg.com' && path === '/ct/core.js' ||
      host === 'www.redditstatic.com' && path === '/ads/pixel.js' ||
      host === 'd.line-scdn.net' && path === '/n/line_tag/public/release/v1/lt.js' ||
      host === 'a.quora.com' && path === '/qevents.js' ||
      (host === 'mc.yandex.ru' || host === 'mc.yandex.com') && match(/^\/metrika\/(?:tag|watch)\.js$/, path) ||
      host === 'top-fwz1.mail.ru' && path === '/js/code.js' ||
      host === 'bat.bing.com' && path === '/bat.js' ||
      host === 'www.googletagmanager.com' && path === '/gtag/js' ||
      host === 'www.google-analytics.com' && (path === '/analytics.js' || path === '/ga.js') ||
      host === 'www.googleadservices.com' && path === '/pagead/conversion.js' ||
      host === 'wcs.naver.net' && path === '/wcslog.js' ||
      host === 'hm.baidu.com' && path === '/hm.js' || kakaoPixel);
    const sdk = requestType === 'script' && (
      host === 'connect.facebook.net' && match(/^\/[a-z]{2}_[A-Z]{2}\/sdk\.js$/, path) ||
      host === 'platform.twitter.com' && path === '/widgets.js' ||
      host === 'telegram.org' && path === '/js/telegram-widget.js' ||
      host === 'accounts.google.com' && path === '/gsi/client' ||
      host === 'apis.google.com' && match(/^\/js\/(?:api|platform|api:client)\.js$/, path) ||
      host === 'www.googletagmanager.com' && path === '/gtm.js' ||
      host === 't1.kakaocdn.net' && match(/^\/kakao_js_sdk\/[0-9]+\.[0-9]+\.[0-9]+\/kakao\.min\.js$/, path) ||
      host === 'res.wx.qq.com' && match(/^\/open\/js\/jweixin-[0-9]+\.[0-9]+\.[0-9]+\.js$/, path) ||
      host === 'platform-api.sharethis.com' && path === '/js/sharethis.js' ||
      host === 'www.instagram.com' && path === '/embed.js' ||
      (host === 'www.threads.com' || host === 'threads.com') && path === '/embed.js' ||
      host === 'player.vimeo.com' && path === '/api/player.js' ||
      host === 'geo.dailymotion.com' && match(/^\/(?:libs\/)?player\/[a-zA-Z0-9_-]{1,64}\.js$/, path) ||
      host === 'w.soundcloud.com' && path === '/player/api.js' || douyinSdk);
    const pixel = (
      suffix(host, 'facebook.com') && (path === '/tr' || path === '/tr/') ||
      (host === 'px.ads.linkedin.com' || host === 'dc.ads.linkedin.com') && (path === '/collect' || path === '/collect/') ||
      host === 'ct.pinterest.com' && (path === '/v3' || path === '/v3/') ||
      host === 'tr.snapchat.com' && (path === '/p' || path === '/p/') ||
      (host === 'analytics.twitter.com' || host === 'analytics.x.com' || host === 't.co') && match(/^\/i\/adsctp?$/, path) ||
      host === 'alb.reddit.com' && (path === '/rp.gif' || path === '/rp') ||
      host === 'tr.line.me' && path === '/tag.gif' ||
      host === 'q.quora.com' && match(/^\/_\/ad\/[a-zA-Z0-9_-]{1,128}\/pixel$/, path) ||
      (host === 'mc.yandex.ru' || host === 'mc.yandex.com') && match(/^\/watch\/[0-9]{1,32}$/, path) ||
      host === 'top-fwz1.mail.ru' && path === '/counter' ||
      host === 'bat.bing.com' && match(/^\/action\/[0-9]{1,32}$/, path) ||
      suffix(host, 'google-analytics.com') && (path === '/g/collect' || path === '/collect' || path === '/__utm.gif') ||
      host === 'analytics.google.com' && path === '/g/collect' ||
      host === 'bc.ad.daum.net' && path === '/bc') &&
      apply(includes, ['image', 'xmlhttprequest', 'ping', 'other'], [requestType]);
    const embedded = (requestType === 'sub_frame' || requestType === 'script') && (
      service === 'youtube' && match(/^\/embed(?:\/|$)/, path) ||
      service === 'facebook' && match(/^\/plugins(?:\/|$)/, path) ||
      service === 'instagram' && match(/(?:^\/embed(?:\/|$)|\/embed\/?$)/, path) ||
      service === 'x' && (host === 'platform.twitter.com' || host === 'syndication.twitter.com') ||
      service === 'disqus' && (requestType === 'script' && path === '/embed.js' || requestType === 'sub_frame' && match(/^\/embed(?:\/|$)/, path)) ||
      service === 'bluesky' && host === 'embed.bsky.app' && (path === '/static/embed.js' || match(/^\/embed\//, path)) ||
      service === 'vimeo' && host === 'player.vimeo.com' && match(/^\/video\//, path) ||
      service === 'dailymotion' && (host === 'geo.dailymotion.com' && path === '/player.html' || match(/^\/embed\/video\//, path)) ||
      service === 'soundcloud' && host === 'w.soundcloud.com' && (path === '/player/' || path === '/player'));
    const login = match(/^\/(?:login(?:\.php)?|signin|sign-in|ServiceLogin|i\/flow\/login|accounts\/login|auth\/login)(?:\/|$)/, path);
    const oauth = match(/(?:^|\/)(?:oauth(?:2)?|authorize|authorization|dialog\/oauth)(?:\/|$)/, path);
    if (trackingSdk) { endpoint = 'sdk'; kind = 'tracking-sdk'; }
    else if (sdk) { endpoint = 'sdk'; kind = 'sdk-load'; }
    else if (pixel) { endpoint = 'pixel'; kind = 'tracking-pixel'; }
    else if (embedded) { endpoint = 'embed'; kind = 'embedded-content'; }
    else if (login || oauth) {
      endpoint = oauth ? 'oauth' : 'login';
      kind = requestType === 'main_frame' ? 'authentication-navigation' :
        requestType === 'sub_frame' ? 'authentication-frame' :
        login && (requestType === 'image' || requestType === 'script') ? 'possible-login-probe' : 'authentication-request';
    }
    const cleanMethod = typeof method === 'string' && apply(includes, ['GET', 'POST', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'UNKNOWN'], [method]) ? method : 'UNKNOWN';
    return { service, kind, endpoint, method: cleanMethod, requestType };
  }
  function script(raw) {
    const url = parse(raw, true);
    if (!url || !match(/^[a-z0-9.-]{1,253}$/, url.host)) return null;
    // Host redaction with the bundled PSL happens at the privileged boundary.
    // MAIN never retains arbitrary paths or script identifiers.
    const fixed = /\/(main|client|script|sdk|gtm|fbevents|widgets|tracker|analytics)\.(js|mjs)$/;
    const found = apply(exec, fixed, [url.path]);
    return { host: url.host, pathTemplate: found ? '/' + found[1] + '.' + found[2] : '/<script>' };
  }
  return { classify, script, ready };
})();
  var socialSensorSupport = (function createSocialSensorSupport(detector, trustedNatives = false) {
  const apply = Reflect.apply, descriptor = Object.getOwnPropertyDescriptor, getPrototype = Object.getPrototypeOf;
  const NativeError = descriptor(globalThis, 'Error')?.value, NativeMap = Map, NativeWeakMap = WeakMap;
  const mapGet = Map.prototype.get, mapSet = Map.prototype.set, mapEach = Map.prototype.forEach;
  const weakGet = WeakMap.prototype.get, weakSet = WeakMap.prototype.set;
  const push = Array.prototype.push, slice = String.prototype.slice, indexOf = String.prototype.indexOf;
  const upper = String.prototype.toUpperCase, lower = String.prototype.toLowerCase, find = Array.prototype.find, hasOwn = Object.hasOwn;
  const exec = RegExp.prototype.exec, fnSource = Function.prototype.toString;
  const matches = (pattern, value) => apply(exec, pattern, [value]) !== null;
  const native = fn => typeof fn === 'function' && (trustedNatives || matches(/\[native code\]/, apply(fnSource, fn, [])));
  const ownValue = (object, key) => object && descriptor(object, key)?.value;
  function createCollector() {
    let rows = new NativeMap(), nodes = new NativeWeakMap(), nodeCount = 0, rowCount = 0, samples = 0, bytes = 512, truncated = !detector.ready, lastReadAt = -Infinity;
    return {
      reset() { rows = new NativeMap(); nodes = new NativeWeakMap(); nodeCount = 0; rowCount = 0; samples = 0; bytes = 512; truncated = !detector.ready; lastReadAt = -Infinity; },
      limited() { truncated = true; },
      sample() { if (samples >= 64) { truncated = true; return false; } samples++; return true; },
      record(match, source, node = null, force = false) {
        if (!match) return;
        const script = source?.script ?? null, confidence = script ? source.attributionConfidence : 'unknown';
        const key = match.service + '|' + match.kind + '|' + match.endpoint + '|' + match.method + '|' + match.requestType + '|' + confidence + '|' + (script?.host ?? '') + '|' + (script?.pathTemplate ?? '');
        if (node !== null && (typeof node === 'object' || typeof node === 'function')) {
          const previous = apply(weakGet, nodes, [node]);
          if (!force && previous === key) return;
          if (previous === undefined && nodeCount >= 512) { truncated = true; return; }
          if (previous === undefined) nodeCount++;
          apply(weakSet, nodes, [node, key]);
        }
        const previous = apply(mapGet, rows, [key]);
        if (previous) { if (previous.count < 2147483647) previous.count++; return; }
        const cost = 256 + key.length * 2;
        if (bytes + cost > 12000 || rowCount >= 64) { truncated = true; return; }
        bytes += cost; rowCount++;
        apply(mapSet, rows, [key, { ...match, count: 1, evidenceSource: 'page-hook', integrity: 'page-controlled', attributionConfidence: confidence, initiatorHost: null, script }]);
      },
      snapshot() {
        const output = [];
        apply(mapEach, rows, [row => apply(push, output, [{ ...row, script: row.script ? { ...row.script } : null }])]);
        return { rows: output, truncated };
      },
      handleControl(data, enabled, env) {
        if (!data || typeof data !== 'object' || ownValue(data, 'channel') !== 'detect.expert/social/v1' || ownValue(data, 'type') !== 'social-values-read') return;
        const requestId = ownValue(data, 'requestId');
        if (typeof requestId !== 'string' || !matches(/^social-[0-9]{1,10}$/, requestId)) return;
        const now = env.now();
        if (now - lastReadAt < 500) return;
        lastReadAt = now;
        const snapshot = enabled ? this.snapshot() : { rows: [], truncated: true };
        env.postMessage({ channel: 'detect.expert/social/v1', type: 'social-values-batch', requestId, enabled, rows: snapshot.rows, truncated: snapshot.truncated });
      },
    };
  }
  function stackSource(raw, collector) {
    if (typeof raw !== 'string') { collector.limited(); return null; }
    if (raw.length > 8192) collector.limited();
    const bounded = apply(slice, raw, [0, 8192]);
    let start = apply(indexOf, bounded, ['\n']) + 1;
    if (!start) return null;
    for (let index = 0; index < 8 && start < bounded.length; index++) {
      const next = apply(indexOf, bounded, ['\n', start]), end = next < 0 ? bounded.length : next;
      const line = apply(slice, bounded, [start, end]); start = end + 1;
      if (!matches(/^\s+at\s|^[^@]*@/, line)) continue;
      const found = apply(exec, /(?:^\s+at\s+|@|\()(https:\/\/[^\s)]+)\)?$/, [line]);
      if (!found) continue;
      const position = apply(exec, /:[0-9]+(?::[0-9]+)?$/, [found[1]]);
      if (!position) continue;
      const script = detector.script(apply(slice, found[1], [0, position.index]));
      if (script) return { script, attributionConfidence: 'sampled-stack' };
    }
    if (start < bounded.length) collector.limited();
    return null;
  }
  function install(runtime, realm, wrappers, nativeCheck = native) {
    const collector = runtime.apiResults.socialCollector;
    if (!detector.ready) { collector.limited(); return; }
    const prototype = key => ownValue(ownValue(realm, key), 'prototype');
    const getter = (object, key) => { const entry = object && descriptor(object, key); return typeof entry?.get === 'function' && nativeCheck(entry.get) ? entry.get : null; };
    const scriptPrototype = prototype('HTMLScriptElement'), nodePrototype = prototype('Node');
    const scriptURL = getter(scriptPrototype, 'src'), currentScript = getter(prototype('Document'), 'currentScript');
    const connected = getter(nodePrototype, 'isConnected'), nodeName = getter(nodePrototype, 'nodeName');
    let document;
    try { const entry = descriptor(realm, 'document'); document = entry?.value ?? (nativeCheck(entry?.get) ? apply(entry.get, realm, []) : null); } catch { collector.limited(); }
    const read = (fn, receiver) => { if (!fn) return null; try { return apply(fn, receiver, []); } catch { return null; } };
    let xhr = new NativeWeakMap(), xhrAdmissions = 0, generation = runtime.apiResults.generation;
    const active = () => {
      if (generation !== runtime.apiResults.generation) { generation = runtime.apiResults.generation; collector.reset(); xhr = new NativeWeakMap(); xhrAdmissions = 0; }
      return runtime.hooks.enabled;
    };
    const source = () => {
      const executing = read(currentScript, document), script = executing ? detector.script(read(scriptURL, executing)) : null;
      if (script) return { script, attributionConfidence: 'exact-resource' };
      if (!collector.sample() || !nativeCheck(NativeError)) { collector.limited(); return null; }
      try {
        for (const key of ['prepareStackTrace', 'stackTraceLimit']) {
          let object = NativeError;
          for (let depth = 0; object && depth < 8; depth++, object = getPrototype(object)) {
            const entry = descriptor(object, key);
            if (!entry) continue;
            if (!hasOwn(entry, 'value') || key === 'prepareStackTrace' && entry.value !== undefined || key === 'stackTraceLimit' && (typeof entry.value !== 'number' || entry.value < 0 || entry.value > 100)) { collector.limited(); return null; }
            break;
          }
        }
        const stack = descriptor(new NativeError(), 'stack');
        if (!stack || typeof stack.value !== 'string') { collector.limited(); return null; }
        return stackSource(stack.value, collector);
      } catch { collector.limited(); return null; }
    };
    const requestPrototype = prototype('Request'), requestURL = getter(requestPrototype, 'url'), requestMethod = getter(requestPrototype, 'method');
    const inputURL = input => {
      if (typeof input === 'string') return input;
      return read(requestURL, input);
    };
    const record = (raw, requestType, method, node = null, force = false) => {
      if (!active()) return;
      const match = detector.classify(raw, requestType, method);
      let attribution, attributed = false;
      const sharedSource = () => { if (!attributed) { attribution = source(); attributed = true; } return attribution; };
      if (match) collector.record(match, sharedSource(), node, force);
      runtime.observeBeaconRequest?.(raw, requestType, method, sharedSource, node, force);
    };
    runtime.observeSocialFetch = (args, threw) => {
      if (threw || !active()) return;
      // Options may be a Proxy or contain accessors. Even descriptor inspection
      // changes observable page semantics, so never inspect the options object.
      const method = args[1] === undefined || args[1] === null ? typeof args[0] === 'string' ? 'GET' : read(requestMethod, args[0]) : 'UNKNOWN';
      record(inputURL(args[0]), 'xmlhttprequest', typeof method === 'string' ? method : 'UNKNOWN');
    };
    runtime.observeSocialBeacon = (args, threw) => {
      if (!threw && active()) record(inputURL(args[0]), 'ping', 'POST');
    };
    runtime.observeSocialXhrOpen = (receiver, args, threw) => {
      if (!active() || receiver === null || typeof receiver !== 'object') return;
      runtime.observeBeaconXhrOpen?.(receiver, args, threw);
      const prior = apply(weakGet, xhr, [receiver]);
      if (prior === undefined && xhrAdmissions >= 512) { collector.limited(); return; }
      if (prior === undefined) xhrAdmissions++;
      const match = !threw && detector.classify(args[1], 'xmlhttprequest', typeof args[0] === 'string' ? apply(upper, args[0], []) : 'UNKNOWN');
      apply(weakSet, xhr, [receiver, match ? { match } : null]);
    };
    runtime.observeSocialXhrSend = (receiver, threw) => {
      if (threw || !active()) return;
      const value = apply(weakGet, xhr, [receiver]);
      let attribution, attributed = false;
      const sharedSource = () => { if (!attributed) { attribution = source(); attributed = true; } return attribution; };
      if (value) collector.record(value.match, sharedSource());
      runtime.observeBeaconXhrSend?.(receiver, sharedSource);
    };
    const urls = [
      ['HTMLImageElement', 'image'], ['HTMLScriptElement', 'script'], ['HTMLIFrameElement', 'sub_frame'],
    ].map(([name, type]) => ({ name, type, prototype: prototype(name), getter: getter(prototype(name), 'src') }));
    const nodeEntry = node => {
      const name = read(nodeName, node);
      return name === 'IMG' || name === 'img' ? urls[0] :
        name === 'SCRIPT' || name === 'script' ? urls[1] :
        name === 'IFRAME' || name === 'iframe' ? urls[2] : null;
    };
    runtime.observeSocialSource = (name, receiver, args, threw) => {
      if (threw || !active()) return;
      const selected = apply(find, urls, [entry => entry.name === name]);
      if (!selected || selected.type !== 'image' && read(connected, receiver) !== true) return;
      record(read(selected.getter, receiver), selected.type, 'GET', receiver, true);
    };
    runtime.observeSocialAttribute = (receiver, args, threw) => {
      if (threw || !active() || typeof args[0] !== 'string' || args[0].length !== 3 || apply(lower, args[0], []) !== 'src') return;
      const entry = nodeEntry(receiver);
      if (!entry || entry.type !== 'image' && read(connected, receiver) !== true) return;
      record(read(entry.getter, receiver), entry.type, 'GET', receiver, true);
    };
    runtime.observeSocialInsertedNode = (node, threw) => {
      if (threw || !active()) return;
      if (nodeName) {
        // Native Node branding rejects spoofed prototypes and bypasses own
        // nodeName/src getters. Ordinary DOM insertions need no throwing src
        // probes. XHTML names can be lowercase; no value is coerced.
        const entry = nodeEntry(node);
        if (!entry || read(connected, node) !== true) return;
        record(read(entry.getter, node), entry.type, 'GET', node);
        return;
      }
      // Compatibility fallback only when the native Node getter is absent.
      if (read(connected, node) !== true) return;
      for (const entry of urls) {
        const raw = read(entry.getter, node);
        if (raw !== null) { record(raw, entry.type, 'GET', node); return; }
      }
    };
    const attach = handle => { if (handle) { runtime.attach([handle]); if (handle.status !== 'installed') collector.limited(); } };
    const element = prototype('Element');
    if (nativeCheck(descriptor(element ?? {}, 'setAttribute')?.value)) attach(wrappers.wrapMethod(element, 'setAttribute', (receiver, args, threw) => runtime.observeSocialAttribute(receiver, args, threw), { context: runtime.hooks }));
    else collector.limited();
    const iframe = apply(find, urls, [entry => entry.name === 'HTMLIFrameElement']);
    if (nativeCheck(descriptor(iframe?.prototype ?? {}, 'src')?.set)) attach(wrappers.wrapSetter(iframe.prototype, 'src', (receiver, args, threw) => runtime.observeSocialSource('HTMLIFrameElement', receiver, args, threw), { context: runtime.hooks }));
    else collector.limited();
    if (nativeCheck(descriptor(realm, 'open')?.value)) attach(wrappers.wrapMethod(realm, 'open', (_receiver, args, threw) => { if (!threw) record(args[0], 'main_frame', 'GET'); }, { context: runtime.hooks }));
    else collector.limited();
    // CredentialsContainer.get is observed by the generic DET-059 family.
    // Its arbitrary options cannot be inspected safely or prove FedCM use.
    const login = prototype('NavigatorLogin');
    if (nativeCheck(descriptor(login ?? {}, 'setStatus')?.value)) attach(wrappers.wrapMethod(login, 'setStatus', (_receiver, _args, threw) => {
      if (!threw && active()) collector.record({ service: 'unknown', kind: 'login-status-api', endpoint: 'login-status', method: 'UNKNOWN', requestType: 'other' }, source());
    }, { context: runtime.hooks }));
    runtime.onStop(() => { collector.reset(); xhr = new NativeWeakMap(); xhrAdmissions = 0; });
    if (!document || !currentScript || !scriptURL || !connected) collector.limited();
  }
  return { createCollector, stackSource, install };
})(socialNetworkDetector);

  // packages/sensors/src/background-activity.ts
  var backgroundSensorContracts = (function createBackgroundActivityContracts() {
  const operations = Object.freeze(['ServiceWorkerContainer.register', 'ServiceWorkerContainer.getRegistration', 'ServiceWorkerContainer.getRegistrations', 'PushManager.subscribe', 'PushManager.getSubscription', 'PushManager.permissionState', 'SyncManager.register', 'SyncManager.getTags', 'PeriodicSyncManager.register', 'PeriodicSyncManager.getTags', 'PeriodicSyncManager.unregister', 'Notification.requestPermission']);
  const field = (value, key) => value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
  const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, 'value'));
  const document = value => typeof value === 'string' && /^[A-Za-z0-9_:.-]{1,160}$/.test(value);
  const count = (value, max = 2147483647) => Number.isSafeInteger(value) && value >= 0 && value <= max;
  const host = value => typeof value === 'string' && value.length <= 253 && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value) && !value.includes('..');
  const paths = Object.freeze(['/', '/<scope>', '/<worker>', '/<script>', '/sw.js', '/service-worker.js', '/worker.js', '/firebase-messaging-sw.js', '/main.js', '/app.js', '/bundle.js', '/sdk.js', '/gtm.js', '/fbevents.js', '/bat.js']);
  const resource = value => value === null ? null : exact(value, ['host', 'pathTemplate']) && host(field(value, 'host')) && paths.includes(field(value, 'pathTemplate')) ? { host: field(value, 'host'), pathTemplate: field(value, 'pathTemplate') } : false;
  const list = (value, max, read) => {
    if (!Array.isArray(value) || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) return null;
    const output = [];
    for (let index = 0; index < value.length; index++) { const descriptor = Object.getOwnPropertyDescriptor(value, index); if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null; const item = read(descriptor.value); if (item === null) return null; output.push(item); }
    return output;
  };
  function readRows(value) {
    try {
      const seen = new Set();
      return list(value, 64, item => {
        const keys = ['operation', 'phase', 'count', 'evidenceSource', 'integrity', 'attributionConfidence', 'script', 'worker'];
        if (!exact(item, keys) || !operations.includes(field(item, 'operation')) || !['async-returned', 'threw-sync'].includes(field(item, 'phase')) || !count(field(item, 'count')) || field(item, 'count') < 1 || field(item, 'evidenceSource') !== 'page-hook' || field(item, 'integrity') !== 'page-controlled' || !['exact-resource', 'sampled-stack', 'unknown'].includes(field(item, 'attributionConfidence'))) return null;
        const script = resource(field(item, 'script')), worker = resource(field(item, 'worker'));
        if (script === false || worker === false || (script === null) !== (field(item, 'attributionConfidence') === 'unknown') || field(item, 'operation') !== 'ServiceWorkerContainer.register' && worker !== null) return null;
        const key = [field(item, 'operation'), field(item, 'phase'), field(item, 'attributionConfidence'), script?.host ?? '', script?.pathTemplate ?? '', worker?.host ?? '', worker?.pathTemplate ?? ''].join('|');
        if (seen.has(key)) return null; seen.add(key);
        return Object.fromEntries(keys.map(key => [key, key === 'script' ? script : key === 'worker' ? worker : field(item, key)]));
      });
    } catch { return null; }
  }
  function readInventory(value) {
    try {
      const keys = ['status', 'secureContext', 'supported', 'permissions', 'registrationCount', 'pushSubscriptionCount', 'syncTagCount', 'periodicTagCount', 'registrations', 'truncated', 'checkedAt'];
      if (!exact(value, keys) || !['available', 'unsupported', 'unavailable'].includes(field(value, 'status')) || typeof field(value, 'secureContext') !== 'boolean' || typeof field(value, 'truncated') !== 'boolean' || !count(field(value, 'checkedAt'), Number.MAX_SAFE_INTEGER)) return null;
      const supported = field(value, 'supported'), permissions = field(value, 'permissions'), supportKeys = ['serviceWorker', 'push', 'sync', 'periodicSync'], permissionKeys = ['notifications', 'push', 'sync', 'periodicSync'];
      if (!exact(supported, supportKeys) || !supportKeys.every(key => typeof field(supported, key) === 'boolean') || !exact(permissions, permissionKeys) || !permissionKeys.every(key => ['granted', 'denied', 'prompt', 'unsupported', 'unknown'].includes(field(permissions, key)))) return null;
      for (const key of ['registrationCount', 'pushSubscriptionCount', 'syncTagCount', 'periodicTagCount']) if (field(value, key) !== null && !count(field(value, key), key === 'registrationCount' || key === 'pushSubscriptionCount' ? 4096 : 65536)) return null;
      const registrations = list(field(value, 'registrations'), 16, item => {
        if (!exact(item, ['scope', 'script', 'state', 'pushSubscribed', 'syncTagCount', 'periodicTagCount'])) return null;
        const scope = resource(field(item, 'scope')), script = resource(field(item, 'script'));
        if (!scope || scope === false || script === false || !['activated', 'installing', 'installed', 'activating', 'redundant', 'unknown'].includes(field(item, 'state')) || field(item, 'pushSubscribed') !== null && typeof field(item, 'pushSubscribed') !== 'boolean' || !['syncTagCount', 'periodicTagCount'].every(key => field(item, key) === null || count(field(item, key), 4096))) return null;
        return { scope, script, state: field(item, 'state'), pushSubscribed: field(item, 'pushSubscribed'), syncTagCount: field(item, 'syncTagCount'), periodicTagCount: field(item, 'periodicTagCount') };
      });
      if (!registrations || field(value, 'registrationCount') !== null && field(value, 'registrationCount') < registrations.length || field(value, 'status') !== 'available' && registrations.length || field(value, 'status') === 'unsupported' && field(supported, 'serviceWorker')) return null;
      return { ...Object.fromEntries(keys.map(key => [key, field(value, key)])), supported: Object.fromEntries(supportKeys.map(key => [key, field(supported, key)])), permissions: Object.fromEntries(permissionKeys.map(key => [key, field(permissions, key)])), registrations };
    } catch { return null; }
  }
  function readCache(value) {
    try {
      if (!exact(value, ['schemaVersion', 'type', 'available', 'rows', 'truncated', 'inventory']) || field(value, 'schemaVersion') !== 1 || field(value, 'type') !== 'background-values-cache' || typeof field(value, 'available') !== 'boolean' || typeof field(value, 'truncated') !== 'boolean') return null;
      const rows = readRows(field(value, 'rows')), inventory = readInventory(field(value, 'inventory'));
      return rows && inventory && (field(value, 'available') || !rows.length) ? { schemaVersion: 1, type: 'background-values-cache', available: field(value, 'available'), rows, truncated: field(value, 'truncated'), inventory } : null;
    } catch { return null; }
  }
  function readSnapshot(value) {
    try {
      const keys = ['schemaVersion', 'type', 'documentKey', 'coverageState', 'observedAt', 'rows', 'truncated', 'inventory'];
      if (!exact(value, keys) || field(value, 'schemaVersion') !== 1 || field(value, 'type') !== 'background-activity-state' || !document(field(value, 'documentKey')) || !['active', 'partial', 'degraded', 'no-access', 'paused', 'unsupported'].includes(field(value, 'coverageState')) || !count(field(value, 'observedAt'), Number.MAX_SAFE_INTEGER) || typeof field(value, 'truncated') !== 'boolean') return null;
      const rows = readRows(field(value, 'rows')), inventory = readInventory(field(value, 'inventory'));
      if (!rows || !inventory || ['no-access', 'paused', 'unsupported'].includes(field(value, 'coverageState')) && (rows.length || inventory.registrations.length || inventory.status === 'available')) return null;
      return { ...Object.fromEntries(keys.map(key => [key, field(value, key)])), rows, inventory };
    } catch { return null; }
  }
  function readRequest(value) {
    try {
      const keys = ['schemaVersion', 'type', 'tabId', 'frameId', 'documentKey'];
      if (!exact(value, keys) || field(value, 'schemaVersion') !== 1 || !['ui-get-background-activity', 'ui-refresh-background-activity'].includes(field(value, 'type')) || !count(field(value, 'tabId')) || !count(field(value, 'frameId')) || !document(field(value, 'documentKey')) || !field(value, 'documentKey').startsWith(`${field(value, 'tabId')}:${field(value, 'frameId')}:`)) return null;
      return Object.fromEntries(keys.map(key => [key, field(value, key)]));
    } catch { return null; }
  }
  function readDocuments(value) {
    try {
      const seen = new Set(); let rows = 0;
      return list(value, 24, item => { const snapshot = readSnapshot(item); if (!snapshot || seen.has(snapshot.documentKey) || (rows += snapshot.rows.length) > 256) return null; seen.add(snapshot.documentKey); return snapshot; });
    } catch { return null; }
  }
  return { operations, readRows, readInventory, readCache, readSnapshot, readRequest, readDocuments };
})();
  var backgroundResourceRedactor = (function createBackgroundResourceRedactor(trustedNatives = false) {
  const descriptor = Object.getOwnPropertyDescriptor, apply = Reflect.apply;
  const NativeURL = descriptor(globalThis, 'URL')?.value, fnString = Function.prototype.toString, exec = RegExp.prototype.exec;
  const native = value => typeof value === 'function' && (trustedNatives || apply(exec, /\[native code\]/, [apply(fnString, value, [])]) !== null);
  const getter = key => { const value = NativeURL && descriptor(NativeURL.prototype, key)?.get; return native(value) ? value : null; };
  const protocol = getter('protocol'), hostname = getter('hostname'), pathname = getter('pathname');
  const ready = native(NativeURL) && protocol && hostname && pathname;
  const basenames = ['sw.js', 'service-worker.js', 'worker.js', 'firebase-messaging-sw.js', 'main.js', 'app.js', 'bundle.js', 'sdk.js', 'gtm.js', 'fbevents.js', 'bat.js'];
  const slice = String.prototype.slice, lastIndex = String.prototype.lastIndexOf, includes = Array.prototype.includes;
  return (raw, base, kind = 'worker') => {
    if (!ready || typeof raw !== 'string' || raw.length > 16384 || typeof base !== 'string' && base !== undefined) return null;
    try {
      const url = new NativeURL(raw, base), scheme = apply(protocol, url, []), host = apply(hostname, url, []), path = apply(pathname, url, []);
      if (scheme !== 'https:' && scheme !== 'http:' || !host || host.length > 253 || apply(exec, /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/, [host]) === null || apply(exec, /\.\./, [host]) !== null) return null;
      const basename = apply(slice, path, [apply(lastIndex, path, ['/']) + 1]);
      const pathTemplate = kind === 'scope' ? path === '/' ? '/' : '/<scope>' : apply(includes, basenames, [basename]) ? '/' + basename : kind === 'script' ? '/<script>' : '/<worker>';
      return { host, pathTemplate };
    } catch { return null; }
  };
})();
  var backgroundSensorSupport = (function createBackgroundSensorSupport(contracts, redact, trustedNatives = false) {
  const apply = Reflect.apply, descriptor = Object.getOwnPropertyDescriptor, getPrototype = Object.getPrototypeOf, hasOwn = Object.hasOwn;
  const NativeMap = Map, mapGet = Map.prototype.get, mapSet = Map.prototype.set, mapEach = Map.prototype.forEach;
  const push = Array.prototype.push, includes = Array.prototype.includes, slice = String.prototype.slice, indexOf = String.prototype.indexOf, exec = RegExp.prototype.exec;
  const NativeError = descriptor(globalThis, 'Error')?.value, fnString = Function.prototype.toString;
  const match = (pattern, raw) => apply(exec, pattern, [raw]) !== null;
  const native = value => typeof value === 'function' && (trustedNatives || match(/\[native code\]/, apply(fnString, value, [])));
  const own = (value, key) => value && descriptor(value, key)?.value;
  function createCollector() {
    let rows = new NativeMap(), rowCount = 0, bytes = 256, truncated = false, samples = 0, lastRead = -Infinity;
    return {
      reset() { rows = new NativeMap(); rowCount = 0; bytes = 256; truncated = false; samples = 0; lastRead = -Infinity; },
      limited() { truncated = true; },
      sample() { if (samples >= 64) { truncated = true; return false; } ++samples; return true; },
      record(operation, phase, source, worker) {
        const script = source?.script ?? null, confidence = script ? source.attributionConfidence : 'unknown';
        const key = [operation, phase, confidence, script?.host ?? '', script?.pathTemplate ?? '', worker?.host ?? '', worker?.pathTemplate ?? ''].join('|');
        const previous = apply(mapGet, rows, [key]);
        if (previous) { if (previous.count < 2147483647) ++previous.count; return; }
        const cost = 192 + key.length * 2;
        if (rowCount >= 64 || bytes + cost > 12000) { truncated = true; return; }
        bytes += cost; ++rowCount;
        apply(mapSet, rows, [key, { operation, phase, count: 1, evidenceSource: 'page-hook', integrity: 'page-controlled', attributionConfidence: confidence, script, worker }]);
      },
      snapshot() { const output = []; apply(mapEach, rows, [row => apply(push, output, [{ ...row, script: row.script ? { ...row.script } : null, worker: row.worker ? { ...row.worker } : null }])]); return { rows: output, truncated }; },
      handleControl(data, enabled, env) {
        if (!data || typeof data !== 'object' || own(data, 'channel') !== 'detect.expert/background/v1' || own(data, 'type') !== 'background-values-read') return;
        const requestId = own(data, 'requestId'); if (typeof requestId !== 'string' || !match(/^background-[0-9]{1,10}$/, requestId)) return;
        const now = env.now(); if (now - lastRead < 500) return; lastRead = now;
        const snapshot = enabled ? this.snapshot() : { rows: [], truncated: true };
        env.postMessage({ channel: 'detect.expert/background/v1', type: 'background-values-batch', requestId, enabled, rows: snapshot.rows, truncated: snapshot.truncated });
      },
    };
  }
  function stackSource(raw, collector) {
    if (typeof raw !== 'string') return null;
    if (raw.length > 8192) collector.limited();
    const bounded = apply(slice, raw, [0, 8192]); let start = apply(indexOf, bounded, ['\n']) + 1;
    if (!start) return null;
    for (let index = 0; index < 8 && start < bounded.length; ++index) {
      const next = apply(indexOf, bounded, ['\n', start]), end = next < 0 ? bounded.length : next;
      const line = apply(slice, bounded, [start, end]); start = end + 1;
      const found = apply(exec, /(?:^\s+at\s+|@|\()(https?:\/\/[^\s)]+)\)?$/, [line]); if (!found) continue;
      const position = apply(exec, /:[0-9]+(?::[0-9]+)?$/, [found[1]]); if (!position) continue;
      const script = redact(apply(slice, found[1], [0, position.index]), undefined, 'script');
      if (script) return { script, attributionConfidence: 'sampled-stack' };
    }
    return null;
  }
  function install(runtime, realm, wrappers, nativeCheck = native) {
    const collector = runtime.apiResults.backgroundCollector;
    const prototype = key => own(own(realm, key), 'prototype');
    const getter = (target, key) => { const entry = target && descriptor(target, key); return nativeCheck(entry?.get) ? entry.get : null; };
    const currentScript = getter(prototype('Document'), 'currentScript'), scriptURL = getter(prototype('HTMLScriptElement'), 'src'), documentURL = getter(prototype('Document'), 'URL');
    let document, generation = runtime.apiResults.generation;
    try { const entry = descriptor(realm, 'document'); document = entry?.value ?? (nativeCheck(entry?.get) ? apply(entry.get, realm, []) : null); } catch { collector.limited(); }
    const read = (fn, receiver) => { if (!fn) return null; try { return apply(fn, receiver, []); } catch { return null; } };
    const source = () => {
      const executing = read(currentScript, document), script = executing ? redact(read(scriptURL, executing), undefined, 'script') : null;
      if (script) return { script, attributionConfidence: 'exact-resource' };
      if (!collector.sample() || !nativeCheck(NativeError)) return null;
      try {
        for (const key of ['prepareStackTrace', 'stackTraceLimit']) for (let object = NativeError, depth = 0; object && depth < 8; object = getPrototype(object), ++depth) {
          const entry = descriptor(object, key); if (!entry) continue;
          if (!hasOwn(entry, 'value') || key === 'prepareStackTrace' && entry.value !== undefined || key === 'stackTraceLimit' && (typeof entry.value !== 'number' || entry.value < 0 || entry.value > 100)) { collector.limited(); return null; }
          break;
        }
        return stackSource(descriptor(new NativeError(), 'stack')?.value, collector);
      } catch { collector.limited(); return null; }
    };
    runtime.observeBackgroundOperation = (label, args, threw) => {
      if (!runtime.hooks.enabled || !apply(includes, contracts.operations, [label])) return;
      if (generation !== runtime.apiResults.generation) { generation = runtime.apiResults.generation; collector.reset(); }
      const worker = label === 'ServiceWorkerContainer.register' && typeof args[0] === 'string' ? redact(args[0], read(documentURL, document) ?? undefined, 'worker') : null;
      collector.record(label, threw ? 'threw-sync' : 'async-returned', source(), worker);
    };
    const notification = own(realm, 'Notification');
    if (notification && nativeCheck(descriptor(notification, 'requestPermission')?.value)) {
      const handle = wrappers.wrapMethod(notification, 'requestPermission', (_receiver, args, threw) => runtime.observeBackgroundOperation('Notification.requestPermission', args, threw), { context: runtime.hooks });
      if (handle) runtime.attach([handle]);
      if (handle?.status !== 'installed') collector.limited();
    }
    runtime.onStop(() => collector.reset());
  }
  return { createCollector, install, stackSource, observes: label => apply(includes, contracts.operations, [label]) };
})(backgroundSensorContracts, backgroundResourceRedactor);
  // packages/sensors/src/background-activity:end

  // packages/sensors/src/pro-loader.ts
  var loaderSensorSupport = (function createLoaderSensorSupport(trustedURL = false) {
  const apply = Reflect.apply, descriptor = Object.getOwnPropertyDescriptor;
  const NativeURL = descriptor(globalThis, 'URL')?.value, NativeError = descriptor(globalThis, 'Error')?.value;
  const NativeMap = Map, NativeWeakMap = WeakMap;
  const mapGet = Map.prototype.get, mapSet = Map.prototype.set, mapEach = Map.prototype.forEach;
  const weakGet = WeakMap.prototype.get, weakSet = WeakMap.prototype.set;
  const fnSource = Function.prototype.toString, push = Array.prototype.push;
  const exec = RegExp.prototype.exec, slice = String.prototype.slice, indexOf = String.prototype.indexOf;
  const hasOwn = Object.prototype.hasOwnProperty, getPrototype = Object.getPrototypeOf, decode = decodeURIComponent;
  const urlGet = Object.create(null);
  const matches = (pattern, value) => apply(exec, pattern, [value]) !== null;
  const nativeFunction = fn => typeof fn === 'function' && matches(/\[native code\]/, apply(fnSource, fn, []));
  let urlReady = false;
  try {
    if (typeof NativeURL === 'function' && (trustedURL || nativeFunction(NativeURL))) {
      const prototype = descriptor(NativeURL, 'prototype')?.value;
      urlReady = !!prototype;
      for (const key of ['protocol', 'hostname', 'pathname', 'search', 'username', 'password', 'port']) {
        let object = prototype, entry;
        for (let depth = 0; object && depth < 8; depth++, object = getPrototype(object)) { entry = descriptor(object, key); if (entry) break; }
        if (!entry || typeof entry.get !== 'function' || !trustedURL && !nativeFunction(entry.get)) { urlReady = false; break; }
        urlGet[key] = entry.get;
      }
    }
  } catch { urlReady = false; }
  const urlField = (url, key) => apply(urlGet[key], url, []);
  function googleId(query) {
    let result = null;
    let start = 1;
    while (start <= query.length) {
      const next = apply(indexOf, query, ['&', start]);
      const end = next < 0 ? query.length : next;
      const field = apply(slice, query, [start, end]), equal = apply(indexOf, field, ['=']);
      start = end + 1;
      const key = decode(equal < 0 ? field : apply(slice, field, [0, equal]));
      if (key !== 'id') continue;
      if (result !== null || equal < 0) return null;
      result = decode(apply(slice, field, [equal + 1]));
    }
    return result;
  }
  function classify(raw) {
    if (!urlReady || typeof raw !== 'string' || raw.length > 4096 || matches(/[\u0000-\u0020\u007f]/, raw)) return null;
    try {
      const url = new NativeURL(raw), scheme = urlField(url, 'protocol');
      if (scheme !== 'https:' && scheme !== 'http:' || urlField(url, 'username') || urlField(url, 'password') || urlField(url, 'port')) return null;
      const host = urlField(url, 'hostname'), path = urlField(url, 'pathname');
      if (host === 'dynamic.criteo.com' && path === '/js/ld/ld.js') return 'criteo';
      if (host === 'bat.bing.com' && path === '/bat.js') return 'bing-uet';
      if (scheme !== 'https:') return null;
      if (host === 'www.googletagmanager.com') {
        const id = googleId(urlField(url, 'search'));
        if (id !== null && path === '/gtm.js' && matches(/^GTM-[A-Za-z0-9]+$/, id)) return 'google-tag-manager';
        if (id !== null && path === '/gtag/js' && matches(/^AW-[0-9]+$/, id)) return 'google-ads';
        if (id !== null && path === '/gtag/js' && matches(/^(?:G-[A-Za-z0-9]+|UA-[0-9]+-[0-9]+)$/, id)) return 'google-analytics';
      }
      if (host === 'www.google-analytics.com' && path === '/analytics.js') return 'google-analytics';
      if (host === 'connect.facebook.net' && path === '/en_US/fbevents.js') return 'facebook-pixel';
      if (host === 'static.hotjar.com' && matches(/^\/c\/hotjar-[0-9]{1,32}\.js$/, path)) return 'hotjar';
      if (host === 'analytics.tiktok.com' && path === '/i18n/pixel/events.js') return 'tiktok-pixel';
      if (host === 'snap.licdn.com' && path === '/li.lms-analytics/insight.min.js') return 'linkedin-insight';
      if (host === 'www.clarity.ms' && matches(/^\/tag\/[A-Za-z0-9]{1,64}$/, path)) return 'microsoft-clarity';
      return null;
    } catch { return null; }
  }
  function createCollector() {
    let rows = new NativeMap(), nodes = new NativeWeakMap(), nodeCount = 0, samples = 0, truncated = !urlReady, unavailable = !urlReady;
    return {
      reset() { rows = new NativeMap(); nodes = new NativeWeakMap(); nodeCount = 0; samples = 0; truncated = unavailable; },
      unavailable() { unavailable = true; truncated = true; },
      limited() { truncated = true; },
      sample() { if (samples >= 64) { truncated = true; return false; } samples++; return true; },
      record(target, confidence, node, force = false) {
        if (!(target === 'google-analytics' || target === 'google-ads' || target === 'facebook-pixel' || target === 'hotjar' || target === 'criteo' || target === 'tiktok-pixel' || target === 'linkedin-insight' || target === 'bing-uet' || target === 'microsoft-clarity') || confidence !== 'exact-resource' && confidence !== 'sampled-stack' || node === null || typeof node !== 'object' && typeof node !== 'function') return;
        const key = target + ':' + confidence;
        const prior = apply(weakGet, nodes, [node]);
        if (!force && prior === key) return;
        if (prior === undefined) {
          if (nodeCount >= 512) { truncated = true; return; }
          nodeCount++;
        }
        apply(weakSet, nodes, [node, key]);
        const row = apply(mapGet, rows, [key]);
        if (row) { if (row.count < 2147483647) row.count++; }
        else apply(mapSet, rows, [key, { source: 'google-tag-manager', target, attributionConfidence: confidence, evidenceSource: 'page-hook', integrity: 'page-controlled', count: 1 }]);
      },
      snapshot() {
        const output = [];
        apply(mapEach, rows, [row => apply(push, output, [{ source: row.source, target: row.target, attributionConfidence: row.attributionConfidence, evidenceSource: row.evidenceSource, integrity: row.integrity, count: row.count }])]);
        return { rows: output, truncated };
      },
    };
  }
  function stackSource(raw, collector) {
    if (typeof raw !== 'string') { collector.limited(); return false; }
    if (raw.length > 8192) collector.limited();
    const bounded = apply(slice, raw, [0, 8192]);
    let start = apply(indexOf, bounded, ['\n']) + 1;
    if (start === 0) return false;
    for (let index = 1; index <= 8 && start < bounded.length; index++) {
      const next = apply(indexOf, bounded, ['\n', start]), end = next < 0 ? bounded.length : next;
      const line = apply(slice, bounded, [start, end]); start = end + 1;
      if (!matches(/^\s+at\s|^[^@]*@/, line)) continue;
      // Only the final frame location, never a function name or nested query URL.
      const found = apply(exec, /(?:^\s+at\s+|@|\()(https:\/\/[^\s)]+)\)?$/, [line]);
      if (!found) continue;
      const location = found[1], position = apply(exec, /:[0-9]+(?::[0-9]+)?$/, [location]);
      if (!position) continue;
      const candidate = apply(slice, location, [0, position.index]);
      if (classify(candidate) === 'google-tag-manager') return true;
    }
    if (start < bounded.length) collector.limited();
    return false;
  }
  function install(runtime, realm, wrappers, nativeCheck) {
    const collector = runtime.apiResults.loaderCollector;
    if (!urlReady) { collector.unavailable(); return; }
    const native = nativeCheck || nativeFunction;
    const ownValue = (object, key) => object && descriptor(object, key)?.value;
    const prototype = key => ownValue(ownValue(realm, key), 'prototype');
    const getter = (object, key) => { const fn = descriptor(object, key)?.get; return native(fn) ? fn : null; };
    const script = prototype('HTMLScriptElement'), docProto = prototype('Document'), nodeProto = prototype('Node');
    const scriptUrl = script && getter(script, 'src'), current = docProto && getter(docProto, 'currentScript');
    const connected = nodeProto && getter(nodeProto, 'isConnected');
    let document;
    try { const entry = descriptor(realm, 'document'); document = entry?.value ?? (native(entry?.get) ? apply(entry.get, realm, []) : null); } catch { collector.unavailable(); return; }
    if (!scriptUrl || !current || !connected || !document || !nodeProto) { collector.unavailable(); return; }
    const active = () => runtime.hooks.enabled && !!runtime.apiResults.proSession;
    const read = (fn, receiver) => { try { return apply(fn, receiver, []); } catch { return null; } };
    const source = () => {
      const executing = read(current, document);
      if (executing && classify(read(scriptUrl, executing)) === 'google-tag-manager') return 'exact-resource';
      if (!collector.sample()) return null;
      // Never invoke page-installed stack accessors/formatters. A non-data stack is unsupported.
      if (!native(NativeError)) { collector.limited(); return null; }
      try {
        for (let keyIndex = 0; keyIndex < 2; keyIndex++) {
          const key = keyIndex === 0 ? 'prepareStackTrace' : 'stackTraceLimit';
          let object = NativeError, depth = 0;
          for (; object && depth < 8; depth++, object = getPrototype(object)) {
            const entry = descriptor(object, key);
            if (!entry) continue;
            if (!apply(hasOwn, entry, ['value']) || key === 'prepareStackTrace' && entry.value !== undefined || key === 'stackTraceLimit' && (typeof entry.value !== 'number' || entry.value < 0 || entry.value > 100)) { collector.limited(); return null; }
            break;
          }
          if (object && depth >= 8) { collector.limited(); return null; }
        }
        const stack = descriptor(new NativeError(), 'stack');
        if (!stack || typeof stack.value !== 'string') { collector.limited(); return null; }
        return stackSource(stack.value, collector) ? 'sampled-stack' : null;
      } catch { collector.limited(); return null; }
    };
    const prepareNode = node => {
      if (!active()) return null;
      const target = classify(read(scriptUrl, node));
      if (!target || target === 'google-tag-manager') return null;
      const confidence = source();
      return confidence ? { node, target, confidence, sessionId: runtime.apiResults.proSession } : null;
    };
    const attach = handle => { if (handle) { runtime.attach([handle]); if (handle.status !== 'installed') collector.unavailable(); } };
    for (const name of ['appendChild', 'insertBefore', 'replaceChild']) {
      const method = descriptor(nodeProto, name)?.value;
      if (!native(method)) { collector.unavailable(); continue; }
      attach(wrappers.wrapPreparedMethod(nodeProto, name, (_receiver, args) => prepareNode(args[0]), (state, _receiver, args, threw) => {
        runtime.observeSocialInsertedNode?.(args[0], threw);
        if (state && !threw && active() && state.sessionId === runtime.apiResults.proSession && read(connected, state.node) === true && classify(read(scriptUrl, state.node)) === state.target) collector.record(state.target, state.confidence, state.node);
      }, { context: runtime.hooks }));
    }
    const setter = descriptor(script, 'src')?.set;
    if (native(setter)) runtime.observeLoaderScriptSource = (receiver, args, threw) => {
      if (threw || !active() || typeof args[0] !== 'string' || read(connected, receiver) !== true) return;
      const state = prepareNode(receiver);
      if (state) collector.record(state.target, state.confidence, state.node, true);
    };
    else collector.unavailable();
  }
  return { classify, createCollector, stackSource, install };
})();

  // packages/sensors/src/api-results.ts
  // ADR-066 value capture policy start
  var valueCapturePolicy66 = (() => {
    const marker = /* @__PURE__ */ Symbol.for("detect.expert/api-custom/value-capture-deny/v1");
    const descriptor = Object.getOwnPropertyDescriptor;
    const extensible = Object.isExtensible;
    const define = Object.defineProperty;
    const apply = Reflect.apply;
    const NativeWeakMap = WeakMap, NativeWeakSet = WeakSet;
    const get = WeakMap.prototype.get, set = WeakMap.prototype.set;
    const has = WeakSet.prototype.has, add = WeakSet.prototype.add;
    const policies = new NativeWeakMap();
    function policy(owner) {
      let value = apply(get, policies, [owner]);
      if (!value) {
        value = { realms: [], known: new NativeWeakSet(), denied: false, callbacks: [] };
        apply(set, policies, [owner, value]);
      }
      return value;
    }
    function deny(value) {
      if (value.denied) return;
      value.denied = true;
      value.realms.length = 0;
      const callbacks = value.callbacks;
      value.callbacks = [];
      for (let index = 0; index < callbacks.length; index++) try {
        callbacks[index]();
      } catch {
      }
    }
    function bindValueCapturePolicy(alias, owner) {
      apply(set, policies, [alias, policy(owner)]);
    }
    function registerValueCaptureRealm(owner, realm) {
      const value = policy(owner);
      if (value.denied) return;
      try {
        if (!realm || typeof realm !== "object" && typeof realm !== "function" || !extensible(realm)) {
          deny(value);
          return;
        }
        if (!apply(has, value.known, [realm])) {
          if (value.realms.length >= 1024) {
            deny(value);
            return;
          }
          apply(add, value.known, [realm]);
          define(value.realms, value.realms.length, { __proto__: null, value: realm, writable: true, configurable: true, enumerable: true });
        }
        if (descriptor(realm, marker) !== void 0) deny(value);
      } catch {
        deny(value);
      }
    }
    function valueCaptureDenied(owner) {
      const value = policy(owner);
      if (value.denied) return true;
      try {
        for (let index = 0; index < value.realms.length; index++) {
          const realm = value.realms[index];
          if (!extensible(realm) || descriptor(realm, marker) !== void 0) {
            deny(value);
            return true;
          }
        }
      } catch {
        deny(value);
        return true;
      }
      return false;
    }
    function onValueCaptureDenied(owner, cleanup) {
      const value = policy(owner);
      if (valueCaptureDenied(owner)) {
        try {
          cleanup();
        } catch {
        }
        return;
      }
      if (value.callbacks.length >= 8) {
        deny(value);
        try {
          cleanup();
        } catch {
        }
        return;
      }
      define(value.callbacks, value.callbacks.length, { __proto__: null, value: cleanup, writable: true, configurable: true, enumerable: true });
    }
    
    return { bindValueCapturePolicy, registerValueCaptureRealm, valueCaptureDenied, onValueCaptureDenied };
  })();
  var { bindValueCapturePolicy, registerValueCaptureRealm, valueCaptureDenied, onValueCaptureDenied } = valueCapturePolicy66;
  // ADR-066 value capture policy end
  var apply6 = Reflect.apply, mapGet5 = Map.prototype.get, mapSet = Map.prototype.set, mapClear = Map.prototype.clear, mapForEach2 = Map.prototype.forEach, mapSize2 = Object.getOwnPropertyDescriptor(Map.prototype, "size").get, is = Object.is, isFinite = Number.isFinite, isNaN = Number.isNaN, NativeMap = Map, typedPrototype = Object.getPrototypeOf(Uint8Array.prototype), typedLength = Object.getOwnPropertyDescriptor(typedPrototype, "length").get, typedBuffer = Object.getOwnPropertyDescriptor(typedPrototype, "buffer").get, typedAt = Object.getOwnPropertyDescriptor(typedPrototype, "at").value, ordinaryBufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength").get;
  function numeric(value) {
    return is(value, -0) ? "-0" : isNaN(value) ? "NaN" : isFinite(value) ? value : value > 0 ? "Infinity" : "-Infinity";
  }
  function numericVector(result) {
    try {
      let length = apply6(typedLength, result, []);
      if (typeof length != "number") return { kind: "unobserved", reason: "object" };
      if (length > API_RESULTS_LIMITS.vectorItems) return { kind: "unobserved", reason: "limit" };
      let buffer = apply6(typedBuffer, result, []);
      apply6(ordinaryBufferLength, buffer, []);
      let values = [];
      for (let index = 0; index < length; index++) {
        let value = apply6(typedAt, result, [index]);
        if (typeof value != "number") return { kind: "unobserved", reason: "unsupported" };
        arrayPush(values, numeric(value));
      }
      return { kind: "number-array", values };
    } catch {
      return { kind: "unobserved", reason: "object" };
    }
  }
  function previewReturnedValue(operation, phase, result, allowNumericVectors = !1) {
    let definition = apiResultDefinition(operation);
    return definition ? phase === "threw-sync" ? { kind: "unobserved", reason: "exception" } : definition.sensitive ? { kind: "unobserved", reason: "sensitive" } : definition.typeOnly ? { kind: "unobserved", reason: "unsupported" } : phase === "settlement-unobserved" ? { kind: "unobserved", reason: "async" } : definition.numericVector && result !== null && typeof result == "object" ? allowNumericVectors ? numericVector(result) : { kind: "unobserved", reason: "unsupported" } : result === null ? { kind: "null" } : result === void 0 ? { kind: "undefined" } : typeof result == "boolean" ? { kind: "boolean", value: result } : typeof result == "number" ? is(result, -0) ? { kind: "special-number", value: "-0" } : isNaN(result) ? { kind: "special-number", value: "NaN" } : isFinite(result) ? { kind: "number", value: result } : { kind: "special-number", value: result > 0 ? "Infinity" : "-Infinity" } : typeof result == "string" ? result.length <= API_RESULTS_LIMITS.stringChars ? { kind: "string", value: result } : { kind: "unobserved", reason: "limit" } : { kind: "unobserved", reason: typeof result == "object" || typeof result == "function" ? "object" : "unsupported" } : null;
  }
  var ApiResultRecorder = class {
    constructor(allowNumericVectors = !1) {
      this.allowNumericVectors = allowNumericVectors;
    }
    allowNumericVectors;
    rows = new NativeMap();
    truncated = !1;
    bytes = 512;
    lastOperation = "";
    lastPhase = "returned-sync";
    lastEntry;
    epoch = 0;
    lastReadAt = -1 / 0;
    resetGeneration = 0;
    get generation() {
      return this.resetGeneration;
    }
    recordRtc(operation, value, args) {
      if (valueCaptureDenied(this)) return;
      let definition = apiResultDefinition(operation);
      if (!definition || definition.asynchronous || definition.sensitive || rtcValueProfile(operation) !== value.profile || rtcValueSource(operation) !== value.source) return;
      let checked = readRtcValue(value);
      if (!checked) {
        this.truncated = !0;
        return;
      }
      this.storePro({ operation, techniqueId: definition.techniqueId, phase: "returned-sync", value: checked, parameters: proValueParameters(operation, args), count: 1 });
      this.store({ operation, techniqueId: definition.techniqueId, phase: "returned-sync", value: checked });
    }
    markLimited() {
      this.truncated = !0;
    }

    cookieWriterCollector = typeof cookieWriterSupport === "undefined" ? null : cookieWriterSupport.createCollector();
    loaderCollector = loaderSensorSupport.createCollector();
    socialCollector = socialSensorSupport.createCollector();
    backgroundCollector = backgroundSensorSupport.createCollector();
    beaconCollector = beaconSensorSupport.createCollector();
    proSession = "";
    proRows = new NativeMap();
    proParameterBudget = typeof createProParameterBudget === "undefined" ? null : createProParameterBudget();
    proBytes = 512;
    proTruncated = !1;
    proLastReadAt = -1 / 0;
    recordPro(operation, phase, result, args, proTechnique) {
      if (valueCaptureDenied(this)) return;
      if (!this.proSession) return;
      const technical = this.projectTechnical?.(operation, phase, result);
      if (technical) { this.storePro({ operation, techniqueId: PRO_TECHNICAL_OPERATIONS[operation][1], phase, value: technical, parameters: proValueParameters(operation, args), count: 1 }); return; }
      let definition = apiResultDefinition(operation);
      if (!definition) { const fallback = proValueFallback(operation, proTechnique, phase, { kind: "unobserved", reason: "sensitive" }); if (fallback) this.storePro({ ...fallback[0], parameters: proValueParameters(operation, args), count: 1 }); return; }
      let value = previewReturnedValue(operation, phase, result, this.allowNumericVectors);
      if (value) this.storePro({ operation, techniqueId: definition.techniqueId, phase, value, parameters: proValueParameters(operation, args), count: 1 });
    }
    storePro(row) {
      if (valueCaptureDenied(this)) return;
      if (!this.proSession) return;
      let key = proValueKey(row), previous = apply6(mapGet5, this.proRows, [key]);
      if (previous) { previous.count = previous.count < 2147483647 ? previous.count + 1 : 2147483647; return; }
      let cost = 256 + key.length * 2;
      if (apply6(mapSize2, this.proRows, []) >= 256 || this.proBytes + cost > 65536) { this.proTruncated = !0; return; }
      if (this.proParameterBudget && !this.proParameterBudget.admit(row)) { this.proTruncated = !0; return; }
      this.proBytes += cost;
      apply6(mapSet, this.proRows, [key, row]);
    }
    clearPro() {
      this.proParameterBudget?.reset();
      try { this.onProSessionChanged?.(false); } catch {}
      this.loaderCollector.reset(), this.proSession = "", apply6(mapClear, this.proRows, []), this.proBytes = 512, this.proTruncated = !1, this.proLastReadAt = -1 / 0;
    }
    handleProControl(data, enabled, env) {
      enabled = enabled && !valueCaptureDenied(this);
      let own = getDescriptor, channel = own(data, "channel")?.value, type = own(data, "type")?.value;
      let sessionId = own(data, "sessionId")?.value, requestId = own(data, "requestId")?.value;
      if (channel !== "detect.expert/pro-values/v1" || typeof sessionId !== "string" || !/^[A-Za-z0-9-]{1,64}$/.test(sessionId) || typeof requestId !== "string" || !/^pro-[0-9]{1,10}$/.test(requestId)) return;
      if (type === "pro-values-stop") { if (this.proSession === sessionId) this.clearPro(); return; }
      if (type !== "pro-values-start" && type !== "pro-values-read") return;
      if (type === "pro-values-start" && this.proSession !== sessionId) { this.clearPro(); if (enabled) { this.proSession = sessionId; try { this.onProSessionChanged?.(true); } catch {} } }
      let now = env.now();
      if (now - this.proLastReadAt < 500) return;
      this.proLastReadAt = now;
      const active = enabled && this.proSession === sessionId;
      let rows = [];
      if (active) apply6(mapForEach2, this.proRows, [row => arrayPush(rows, row)]);
      let index = 0, batch = 0;
      while (index < rows.length && batch < 63) {
        let entries = [], bytes = 512;
        while (index < rows.length && entries.length < 32) {
          let row = rows[index], cost = 256 + proValueKey(row).length * 2;
          if (bytes + cost > 16384) break;
          arrayPush(entries, row), bytes += cost, index++;
        }
        const denied = valueCaptureDenied(this);
        env.postMessage({ channel, type: "pro-values-batch", sessionId, requestId, batchSeq: batch++, final: denied, enabled: active && !denied, rows: denied ? [] : entries, truncated: denied ? false : this.proTruncated });
        if (denied) return;
        if (!entries.length) break;
      }
      const denied = valueCaptureDenied(this);
      const loaders = active && !denied ? this.loaderCollector.snapshot() : { rows: [], truncated: false };
      env.postMessage({ channel, type: "pro-values-batch", sessionId, requestId, batchSeq: batch, final: true, enabled: active && !denied, rows: [], truncated: !denied && (this.proTruncated || index < rows.length), loaderRows: loaders.rows, loaderTruncated: loaders.truncated });
    }

    record(operation, phase, result) {
      if (valueCaptureDenied(this)) return;
      let cached = operation === this.lastOperation && phase === this.lastPhase, key = cached ? "" : operation + ":" + phase, previous = cached ? this.lastEntry : apply6(mapGet5, this.rows, [key]);
      if (previous) {
        let value2 = previous.value;
        if ((value2.kind === "number" || value2.kind === "boolean" || value2.kind === "string") && is(value2.value, result) || value2.kind === "null" && result === null || value2.kind === "undefined" && result === void 0 || value2.kind === "unobserved" && (value2.reason === "sensitive" || phase !== "returned-sync" || value2.reason === "object" && !apiResultDefinition(operation)?.numericVector && result !== null && (typeof result == "object" || typeof result == "function"))) return;
      }
      let definition = apiResultDefinition(operation);
      if (!definition) return;
      if (!previous && apply6(mapSize2, this.rows, []) >= API_RESULTS_LIMITS.rows) {
        this.truncated = !0;
        return;
      }
      let value = previewReturnedValue(operation, phase, result, this.allowNumericVectors);
      value !== null && this.store({ operation, techniqueId: definition.techniqueId, phase, value });
    }
    store(entry) {
      if (valueCaptureDenied(this)) return;
      let key = entry.operation + ":" + entry.phase, previous = apply6(mapGet5, this.rows, [key]);
      if (!previous && apply6(mapSize2, this.rows, []) >= API_RESULTS_LIMITS.rows) {
        this.truncated = !0;
        return;
      }
      let bytes2 = this.bytes - (previous ? apiResultEntryBytes(previous) : 0) + apiResultEntryBytes(entry);
      bytes2 > API_RESULTS_LIMITS.bytes && (this.truncated = !0, entry.value = { kind: "unobserved", reason: apiResultDefinition(entry.operation)?.typeOnly ? "unsupported" : "limit" }, bytes2 = this.bytes - (previous ? apiResultEntryBytes(previous) : 0) + apiResultEntryBytes(entry), bytes2 > API_RESULTS_LIMITS.bytes) || (this.bytes = bytes2, this.lastOperation = entry.operation, this.lastPhase = entry.phase, this.lastEntry = entry, apply6(mapSet, this.rows, [key, entry]), (entry.value.kind === "unobserved" && entry.value.reason === "limit" || entry.value.kind === "webrtc" && entry.value.truncated) && (this.truncated = !0));
    }
    snapshot() {
      if (valueCaptureDenied(this)) return { rows: [], truncated: false };
      let rows = [];
      return apply6(mapForEach2, this.rows, [(row) => {
        arrayPush(rows, {
          ...row,
          value: row.value.kind === "number-array" ? { kind: "number-array", values: arraySlice(row.value.values) } : row.value.kind === "webrtc" ? readRtcValue(row.value) : { ...row.value }
        });
      }]), { rows, truncated: this.truncated };
    }
    clear() {
      this.cookieWriterCollector?.reset(); this.backgroundCollector.reset(); this.socialCollector.reset(); this.beaconCollector.reset(); this.clearPro();
      apply6(mapClear, this.rows, []), this.truncated = !1, this.bytes = 512, this.lastOperation = "", this.lastEntry = void 0, this.resetGeneration++;
    }
    handleControl(control2, enabled, env) {
      enabled = enabled && !valueCaptureDenied(this);
      if ((control2.epoch !== this.epoch || control2.type === "api-results-reset") && (this.clear(), this.epoch = control2.epoch), control2.type !== "api-results-read") return;
      let now = env.now();
      if (now - this.lastReadAt < 1e3) return;
      this.lastReadAt = now;
      let snapshot = enabled ? this.snapshot() : { rows: [], truncated: !1 }, index = 0, batchSeq = 0;
      do {
        let rows = [], bytes2 = 512;
        for (; index < snapshot.rows.length && rows.length < API_RESULTS_LIMITS.batchRows; ) {
          let row = snapshot.rows[index], cost = apiResultEntryBytes(row);
          if (bytes2 + cost > 16384) break;
          arrayPush(rows, row), bytes2 += cost, index++;
        }
        const denied = valueCaptureDenied(this);
        env.postMessage({
          channel: API_RESULTS_CHANNEL,
          type: "api-results-batch",
          requestId: control2.requestId,
          epoch: this.epoch,
          batchSeq,
          final: denied || index >= snapshot.rows.length,
          enabled: enabled && !denied,
          rows: denied ? [] : rows,
          truncated: denied ? false : snapshot.truncated
        }), batchSeq++;
        if (denied) return;
      } while (index < snapshot.rows.length && batchSeq < 64);
    }
  };

  // packages/sensors/src/runtime.ts
  var STARTUP_QUEUE_MAX = 32, BUCKET_MS = BUDGETS.flushMinMs, FLUSH_MS = BUDGETS.flushMinMs, PHASE_ATTEMPTED = PHASE_INDEX.attempted, apply7 = Reflect.apply, getDescriptor = Object.getOwnPropertyDescriptor, hasOwn4 = Function.prototype.call.bind(Object.prototype.hasOwnProperty), getPrototype = Object.getPrototypeOf, functionSource = Function.prototype.call.bind(Function.prototype.toString), stringIncludes = Function.prototype.call.bind(String.prototype.includes), floor2 = Math.floor, NO_ARGS = Object.freeze([]), mapGet6 = Function.prototype.call.bind(Map.prototype.get), mapSet2 = Function.prototype.call.bind(Map.prototype.set);
  function browserEnv(w, earlyCaptureGuaranteed = !1) {
    let nativeFunction = (value) => {
      if (typeof value != "function" || !stringIncludes(functionSource(value), "[native code]"))
        throw new Error("sensor environment unavailable");
      return value;
    }, descriptor18 = (object, key) => {
      let current = object;
      for (let depth = 0; current !== null && depth < 16; depth++) {
        let d = getDescriptor(current, key);
        if (d !== void 0) return d;
        current = getPrototype(current);
      }
      throw new Error("sensor environment unavailable");
    }, read2 = (object, key, accessorAllowed = !1) => {
      let d = descriptor18(object, key);
      if (getDescriptor(d, "value") !== void 0) return d.value;
      if (!accessorAllowed) throw new Error("sensor environment unavailable");
      return apply7(nativeFunction(d.get), object, NO_ARGS);
    }, objectValue = (value) => {
      if (typeof value != "object" || value === null) throw new Error("sensor environment unavailable");
      return value;
    }, doc = objectValue(read2(w, "document", !0)), startedLate = read2(doc, "readyState", !0) !== "loading", post = nativeFunction(read2(w, "postMessage")), add2 = nativeFunction(read2(w, "addEventListener")), remove3 = nativeFunction(read2(w, "removeEventListener")), st = nativeFunction(read2(w, "setTimeout")), ct = nativeFunction(read2(w, "clearTimeout")), perf = objectValue(read2(w, "performance", !0)), perfNow = nativeFunction(read2(perf, "now")), cr = objectValue(read2(w, "crypto", !0)), grv = nativeFunction(read2(cr, "getRandomValues")), eventClass = nativeFunction(read2(w, "MessageEvent")), eventProto = objectValue(read2(eventClass, "prototype")), sourceGetter = nativeFunction(descriptor18(eventProto, "source").get), dataGetter = nativeFunction(descriptor18(eventProto, "data").get);
    return {
      self: w,
      postMessage: (message) => {
        apply7(post, w, [message, "*"]);
      },
      addEventListener: (type, listener) => {
        apply7(add2, w, [type, listener]);
      },
      removeEventListener: (type, listener) => {
        apply7(remove3, w, [type, listener]);
      },
      setTimeout: (callback, ms) => apply7(st, w, [callback, ms]),
      clearTimeout: (handle) => {
        apply7(ct, w, [handle]);
      },
      now: () => apply7(perfNow, perf, NO_ARGS),
      randomBytes: (length) => apply7(grv, cr, [new Uint8Array(length)]),
      startedLate,
      earlyCaptureGuaranteed: earlyCaptureGuaranteed && !startedLate,
      // F133: live MessageEvent getters may hide revoke messages; failed brand checks are ignored by onMessage.
      readMessage: (event) => ({ source: apply7(sourceGetter, event, NO_ARGS), data: apply7(dataGetter, event, NO_ARGS) })
    };
  }
  function makeBootId(env) {
    let bytes2 = env.randomBytes(12), out = "boot-";
    for (let i = 0; i < bytes2.length; i++) {
      let b = bytes2[i] ?? 0;
      out += (b < 16 ? "0" : "") + b.toString(16);
    }
    return out;
  }
  /* clear-reset:sensor-intrinsics:start */
var clearResetMap = Function.prototype.call.bind(Map.prototype.clear), clearResetFlag = Function.prototype.call.bind(Set.prototype.delete);
/* clear-reset:sensor-intrinsics:end */
var SensorRuntime = class {
    sensorBootId;
    apiResults;
    /** Shared with every hook installed for this runtime; `enabled` is the pause switch. */
    hooks = createHookContext();
    /** P04: association histories cannot cross an interval in which native mutations were unobserved. */
    historyEpoch = {};
    env;
    /** ADR-017: opt-in preview reuses this realm's guarded transport, including sandbox child routing. */
    get visualEnv() {
      return this.env;
    }
    stopCleanups = [];
    /** Bounded internal resource cleanup, independent of wrapper ownership restoration. */
    onStop(cleanup) {
      if (this.stopped || this.stopCleanups.length >= 16) {
        try {
          cleanup();
        } catch {
        }
        return;
      }
      arrayPush(this.stopCleanups, cleanup);
    }
    bootAt;
    counters = /* @__PURE__ */ new Map();
    // One canonical entry is enough for the common repeated-API hot loop. Entries are never replaced.
    lastCounterKey = -1;
    lastCounter;
    dirty = [];
    flags = /* @__PURE__ */ new Set();
    flagDelta = [];
    handles = [];
    unsupportedHooks = 0;
    reportedObserverErrors = 0;
    dropped = 0;
    sensorSeq = 0;
    timer = null;
    timerFailed = !1;
    handshake = !1;
    paused = !1;
    stopped = !1;
    started = !1;
    statusDirty = !1;
    stopResult = null;
    constructor(env) {
      this.env = env; this.apiResults = new ApiResultRecorder(env.earlyCaptureGuaranteed === !0 && !env.startedLate);
      bindValueCapturePolicy(this.apiResults, this);
      onValueCaptureDenied(this, () => this.apiResults.clear());
      registerValueCaptureRealm(this, env.self);
      this.hooks.onObserverError = () => {
        this.statusDirty = !0, this.scheduleFlush();
      }, this.bootAt = env.now(), this.sensorBootId = makeBootId(env), env.startedLate && this.addFlag("late-start");
    }
    get earlyCaptureGuaranteed() {
      return this.env.earlyCaptureGuaranteed === !0 && !this.env.startedLate;
    }
    // -------------------------------------------------------------------------
    // Hooks
    // -------------------------------------------------------------------------
    /** Registers wrap results: installed handles for ownership-checked restore, unsupported ones as coverage flags. */
    attach(results) {
      for (let i = 0; i < results.length; i++) {
        let r = results[i];
        r.status === "installed" ? arrayIncludes(this.handles, r) || arrayPush(this.handles, r) : (this.unsupportedHooks++, this.addFlag(r.coverageFlag));
      }
    }
    addFlag(flag) {
      setHas(this.flags, flag) || (setAdd(this.flags, flag), arrayPush(this.flagDelta, flag), this.statusDirty = !0);
    }
    // -------------------------------------------------------------------------
    // Hot path
    // -------------------------------------------------------------------------
    /**
     * Increments the counter for (technique index, phase index, signal mask). Hot path: no string work for an
     * existing key and no clock read per call — the clock is read once per aggregate per flush window (when the
     * entry turns dirty), so `intervalBucket` is the bucket of the first increment since the previous flush;
     * later increments in that window are at most one bucket (250 ms) later. Local ordering only (contract).
     */
    record(techniqueIndex, phaseIndex, signalMask, apiOperationIndex, resourceIndex) {
      if (!this.hooks.enabled) return;
      let key = resourceIndex !== void 0 ? extensionResourceKey(resourceIndex, phaseIndex) : apiOperationIndex === void 0 ? compositeKey(techniqueIndex, phaseIndex, signalMask) : operationKey(apiOperationIndex, phaseIndex), entry = key === this.lastCounterKey ? this.lastCounter : mapGet6(this.counters, key);
      if (entry === void 0) {
        let created = this.createEntry(key, techniqueIndex);
        if (created === null) return;
        entry = created;
      }
      key !== this.lastCounterKey && mapGet6(this.counters, key) === entry && (this.lastCounterKey = key, this.lastCounter = entry), entry.count < 2147483647 ? entry.count++ : entry.countQuality = "lower-bound", entry.dirty || (entry.lastBucket = this.bucket(), arrayPush(this.dirty, entry), entry.dirty = !0), this.scheduleFlush();
    }
    recordOperation(operationIndex, phaseIndex) {
      if (!this.hooks.enabled) return;
      let definition = API_OPERATION_DEFINITIONS[operationIndex];
      definition && this.record(TECHNIQUE_INDEX[definition[1]], phaseIndex, SIGNAL_BIT["api-use"], operationIndex);
    }
    recordResult(operation, phaseIndex, result, args) {
      if (this.hooks.enabled) this.apiResults.recordPro(operation, PHASES[phaseIndex], result, args);
      this.hooks.enabled && (phaseIndex === PHASE_INDEX["returned-sync"] ? this.apiResults.record(operation, "returned-sync", result) : phaseIndex === PHASE_INDEX["threw-sync"] ? this.apiResults.record(operation, "threw-sync", void 0) : phaseIndex === PHASE_INDEX["settlement-unobserved"] && this.apiResults.record(operation, "settlement-unobserved", void 0));
    }
    get resultGeneration() {
      return this.apiResults.generation;
    }
    recordRtcValue(operation, value, args) {
      this.hooks.enabled && this.apiResults.recordRtc(operation, value, args);
    }
    limitRtcValues() {
      this.hooks.enabled && this.apiResults.markLimited();
    }
    recordExtensionResource(targetIndex2, methodIndex, phaseIndex) {
      this.record(
        TECHNIQUE_INDEX["DET-059"],
        phaseIndex,
        SIGNAL_BIT["api-use"],
        void 0,
        targetIndex2 * EXTENSION_RESOURCE_METHODS.length + methodIndex
      );
    }
    /** DET-066 fixed sampling counts actual samples, never extrapolated calls. Existing lower bounds win. */
    recordSampled(techniqueIndex, phaseIndex, signalMask) {
      if (!this.hooks.enabled) return;
      this.record(techniqueIndex, phaseIndex, signalMask);
      let entry = mapGet6(this.counters, compositeKey(techniqueIndex, phaseIndex, signalMask));
      entry?.countQuality === "exact" && (entry.countQuality = "sampled");
    }
    bucket() {
      let b = floor2((this.env.now() - this.bootAt) / BUCKET_MS);
      return b > 2147483647 ? 2147483647 : b > 0 ? b : 0;
    }
    /** New key: bounded by the startup queue before handshake and by maxCountersPerDocumentGroup after. */
    createEntry(key, techniqueIndex) {
      let limit = this.handshake ? BUDGETS.maxCountersPerDocumentGroup : STARTUP_QUEUE_MAX;
      if (mapSize(this.counters) >= limit) {
        let fold = mapGet6(this.counters, compositeKey(techniqueIndex, PHASE_ATTEMPTED, 0));
        return this.addFlag("budget-exceeded"), fold !== void 0 ? (fold.countQuality = "lower-bound", fold) : (this.dropped < 2147483647 && this.dropped++, this.statusDirty = !0, this.scheduleFlush(), null);
      }
      let decoded = decodeKey(key);
      if (decoded === null) return null;
      let entry = {
        techniqueId: decoded.techniqueId,
        ...hasOwn4(decoded, "apiOperation") ? { apiOperation: decoded.apiOperation } : {},
        ...hasOwn4(decoded, "extensionResource") ? { extensionResource: decoded.extensionResource } : {},
        phase: decoded.phase,
        signalCodes: decoded.signalCodes,
        count: 0,
        countQuality: "exact",
        lastBucket: 0,
        dirty: !1
      };
      return mapSet2(this.counters, key, entry), entry;
    }
    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------
    /** Subscribes to bridge messages and announces the sensor. Idempotent. */
    start() {
      this.started || this.stopped || (this.started = !0, this.env.addEventListener("message", this.onMessage), this.env.addEventListener("pagehide", this.onPageHide), this.postHello());
    }
    postHello() {
      let hello = {
        channel: CHANNEL,
        sensorBootId: this.sensorBootId,
        type: "sensor-hello",
        protocolVersion: PROTOCOL_VERSION,
        startedLate: this.env.startedLate,
        coverageFlags: setArray(this.flags)
      };
      this.post(hello);
    }
    pause() {
      this.paused || this.stopped || (this.apiResults.clear(), this.paused = !0, this.historyEpoch = {}, this.hooks.enabled = !1, this.cancelTimer(), this.addFlag("paused"), this.handshake && this.postStatus());
    }
    resume() {
      !this.paused || this.stopped || (this.paused = !1, this.hooks.enabled = !0, this.statusDirty = !0, this.handshake && (this.postStatus(), this.dirty.length > 0 && this.scheduleFlush()));
    }
    /**
     * Stops observing, posts the final aggregate when the bridge can still take it, restores hooks whose
     * descriptor we still own, and reports which ones stayed (the page must be reloaded to remove them).
     */
    stop(reason) {
      if (this.stopResult !== null) return this.stopResult;
      reason === "revoked" && this.addFlag("revoked"), reason === "protocol-mismatch" && this.addFlag("protocol-mismatch"), this.handshake && !this.paused && reason !== "protocol-mismatch" && this.flush(), this.stopped = !0, this.hooks.enabled = !1, this.apiResults.clear(), this.cancelTimer();
      let restored = [], cleanups = arraySlice(this.stopCleanups);
      this.stopCleanups.length = 0;
      for (let i = 0; i < cleanups.length; i++)
        try {
          cleanups[i]();
        } catch {
        }
      let notRestored = [];
      for (let i = 0; i < this.handles.length; i++) {
        let h = this.handles[i];
        arrayPush(h.restore() ? restored : notRestored, h.label);
      }
      return this.postStatus(), this.started && (this.env.removeEventListener("message", this.onMessage), this.env.removeEventListener("pagehide", this.onPageHide)), this.stopResult = {
        reason,
        restored,
        notRestored,
        cleanup: this.handles.length === 0 ? "none" : notRestored.length === 0 ? "complete" : "partial"
      }, this.stopResult;
    }
    snapshot() {
      let counters = [];
      return mapForEach(this.counters, (e) => {
        arrayPush(counters, {
          techniqueId: e.techniqueId,
          ...hasOwn4(e, "apiOperation") ? { apiOperation: e.apiOperation } : {},
          ...hasOwn4(e, "extensionResource") ? { extensionResource: { ...e.extensionResource } } : {},
          phase: e.phase,
          signalCodes: arraySlice(e.signalCodes),
          count: e.count,
          countQuality: e.countQuality,
          lastBucket: e.lastBucket
        });
      }), {
        counters,
        size: mapSize(this.counters),
        dropped: this.dropped,
        flags: setArray(this.flags),
        state: this.state(),
        handshake: this.handshake,
        sensorSeq: this.sensorSeq,
        observerErrors: this.hooks.observerErrors
      };
    }
    // -------------------------------------------------------------------------
    // Bridge messages (page-forgeable: routing only, REQ-004)
    // -------------------------------------------------------------------------
    onMessage = (event) => {
      try {
        if (typeof event != "object" || event === null) return;
        let { source: source3, data: data2 } = this.env.readMessage(event);
        if (source3 !== this.env.self || typeof data2 != "object" || data2 === null) return;
        if (getDescriptor(data2, "channel")?.value === "detect.expert/beacon/v1") { this.apiResults.beaconCollector.handleControl(data2, this.hooks.enabled, this.env); return; }
        if (getDescriptor(data2, "channel")?.value === "detect.expert/background/v1") { this.apiResults.backgroundCollector.handleControl(data2, this.hooks.enabled, this.env); return; }
        if (getDescriptor(data2, "channel")?.value === "detect.expert/social/v1") { this.apiResults.socialCollector.handleControl(data2, this.hooks.enabled, this.env); return; }
        if (getDescriptor(data2, "channel")?.value === "detect.expert/cookie-writers/v1") { this.apiResults.cookieWriterCollector?.handleControl(data2, this.hooks.enabled, this.env); return; }
        if (getDescriptor(data2, "channel")?.value === "detect.expert/pro-values/v1") { this.apiResults.handleProControl(data2, this.hooks.enabled, this.env); return; }
        if (getDescriptor(data2, "channel")?.value === API_RESULTS_CHANNEL) {
          let control2 = readApiResultsControl(data2);
          control2 && this.apiResults.handleControl(control2, this.hooks.enabled, this.env);
          return;
        }
        if (data2.channel !== CHANNEL) return;
        let result = validateBridgeMessage(data2);
        if (!result.ok) return;
        let msg = result.value;
      /* clear-reset:sensor-routing */
      if (msg.type === "bridge-reset") {
        if (msg.sensorBootId === this.sensorBootId || (this.lastReset?.resetId === msg.resetId && msg.sensorBootId === this.lastReset.sensorBootId)) this.reset(msg.resetId);
        return;
      }
        if (msg.sensorBootId === UNBOUND_SENSOR_BOOT_ID) {
          msg.type === "bridge-hello" && !this.handshake && !this.stopped && this.postHello();
          return;
        }
        if (msg.sensorBootId !== this.sensorBootId) return;
        switch (msg.type) {
          case "bridge-hello":
            if (this.handshake || this.stopped || msg.protocolVersion !== PROTOCOL_VERSION)
              return;
            this.handshake = !0, msg.paused ? this.pause() : (this.dirty.length > 0 || this.statusDirty || this.dropped > 0) && this.flush();
            return;
          case "bridge-pause":
            this.pause();
            return;
          case "bridge-resume":
            this.resume();
            return;
          case "bridge-stop":
            this.stop(msg.reason);
            return;
          default:
            return;
        }
      } catch {
      }
    };
    onPageHide = () => {
      this.handshake && !this.paused && !this.stopped && this.flush();
    };
    // -------------------------------------------------------------------------
    // Emission
    // -------------------------------------------------------------------------
    onTimer = () => {
      this.timer = null, this.flush();
    };
    scheduleFlush() {
      if (!(this.timerFailed || this.timer !== null || !this.handshake || this.paused || this.stopped))
        try {
          this.timer = this.env.setTimeout(this.onTimer, FLUSH_MS);
        } catch {
          this.timerFailed = !0, this.reportEmissionError();
        }
    }
    cancelTimer() {
      this.timer !== null && (this.env.clearTimeout(this.timer), this.timer = null);
    }
    /** Posts every dirty aggregate (cumulative totals; the SW merges by max) in batches of <= 32. */
    flush() {
      try {
        this.flushPending();
      } catch {
        this.reportEmissionError();
      }
    }
    reportEmissionError() {
      this.hooks.observerErrors < 2147483647 && this.hooks.observerErrors++, this.statusDirty = !0;
      try {
        this.addFlag("hook-failed"), this.postStatus();
      } catch {
      }
    }
    flushPending() {
      if (this.cancelTimer(), !(!this.handshake || this.paused || this.stopped)) {
        this.hooks.observerErrors > this.reportedObserverErrors && (this.reportedObserverErrors = this.hooks.observerErrors, this.addFlag("hook-failed"));
        for (let emitted = 0; this.dirty.length > 0 && emitted < BUDGETS.maxCountersPerDocumentGroup; emitted += BUDGETS.maxBatchEvents) {
          let chunk = arraySlice(this.dirty, 0, BUDGETS.maxBatchEvents), observations = [];
          for (let i = 0; i < chunk.length; i++) {
            let e = chunk[i];
            arrayPush(observations, {
              techniqueId: e.techniqueId,
              ...hasOwn4(e, "apiOperation") ? { apiOperation: e.apiOperation } : {},
              ...hasOwn4(e, "extensionResource") ? { extensionResource: { ...e.extensionResource } } : {},
              count: e.count,
              countQuality: e.countQuality,
              phase: e.phase,
              signalCodes: arraySlice(e.signalCodes),
              intervalBucket: e.lastBucket
            });
          }
          this.sensorSeq < 2147483647 && this.sensorSeq++;
          let batch = {
            channel: CHANNEL,
            sensorBootId: this.sensorBootId,
            type: "sensor-batch",
            sensorSeq: this.sensorSeq,
            observations,
            coverageDelta: this.flagDelta
          };
          if (!this.post(batch)) throw new Error("sensor post failed");
          this.flagDelta = [], arraySplice(this.dirty, 0, chunk.length);
          for (let i = 0; i < chunk.length; i++) chunk[i].dirty = !1;
        }
        (this.statusDirty || this.dropped > 0) && this.postStatus();
      }
    }
    state() {
      return this.stopped ? "stopped" : this.paused ? "paused" : this.unsupportedHooks > 0 || this.hooks.observerErrors > 0 ? "degraded" : "active";
    }
    postStatus() {
      let status = {
        channel: CHANNEL,
        sensorBootId: this.sensorBootId,
        type: "sensor-status",
        state: this.state(),
        coverageFlags: setArray(this.flags),
        droppedSinceLast: this.dropped
      };
      this.post(status) && (this.dropped = 0, this.statusDirty = !1);
    }
    post(message) {
      try {
        return this.env.postMessage(message), !0;
      } catch {
        return !1;
      }
    }
  
lastReset = null;

reset(resetId) {
  if (this.stopped) return;
  if (this.lastReset?.resetId === resetId) { this.post(this.lastReset); this.postHello(); return; }
  const oldBoot = this.sensorBootId;
  this.cancelTimer(); clearResetMap(this.counters);
  this.lastCounterKey = -1; this.lastCounter = undefined;
  this.dirty.length = 0; this.dropped = 0;
  clearResetFlag(this.flags, 'budget-exceeded'); clearResetFlag(this.flags, 'channel-gap'); clearResetFlag(this.flags, 'truncated');
  this.flagDelta = []; this.sensorSeq = 0; this.historyEpoch = {}; this.bootAt = this.env.now();
  this.sensorBootId = makeBootId(this.env).slice(0, 20) + '-' + resetId.slice(-32);
  this.handshake = false;
  this.lastReset = { channel: CHANNEL, type: 'sensor-reset', sensorBootId: oldBoot, resetId, nextSensorBootId: this.sensorBootId, coverageFlags: setArray(this.flags) };
  this.post(this.lastReset); this.postHello();
}
};

  // packages/sensors/src/visual-activity.ts
  var WeakMapCtor = WeakMap, get = Function.prototype.call.bind(WeakMap.prototype.get), set = Function.prototype.call.bind(WeakMap.prototype.set), create4 = Object.create, finite3 = Number.isFinite, slice = Function.prototype.call.bind(String.prototype.slice), isObject = (value) => typeof value == "object" && value !== null, VisualActivity = class {
    constructor(boot, changed, limited) {
      this.boot = boot;
      this.changed = changed;
      this.limited = limited;
    }
    boot;
    changed;
    limited;
    records = new WeakMapCtor();
    images = new WeakMapCtor();
    count = 0;
    imageCount = 0;
    lookup(receiver) {
      return isObject(receiver) ? get(this.records, receiver) : void 0;
    }
    make(receiver, renderer) {
      if (this.count >= VISUAL_LIMITS.maxCanvases) {
        this.limited();
        return;
      }
      let record = {
        id: this.boot + ":" + ++this.count,
        renderer,
        operations: create4(null),
        readbacks: 0,
        sources: 0,
        image: null,
        queued: !1,
        omitted: !1
      };
      return set(this.records, receiver, record), record;
    }
    context(receiver, result, type) {
      if (!isObject(receiver) || !isObject(result)) return;
      let renderer = type === "experimental-webgl" ? "webgl" : type;
      if (renderer !== "2d" && renderer !== "webgl" && renderer !== "webgl2" && renderer !== "webgpu" && renderer !== "bitmaprenderer") return;
      let record = this.lookup(result) ?? this.lookup(receiver) ?? this.make(receiver, renderer);
      record && (record.renderer === "unknown" && (record.renderer = renderer, record.image?.format === "png" && (renderer === "webgl" || renderer === "webgl2") && (record.image.kind = "webgl"), this.changed(record)), set(this.records, receiver, record), set(this.records, result, record));
    }
    mark(record, operation) {
      record.operations[operation] || (record.operations[operation] = !0, record.queued || this.changed(record));
    }
    readback(receiver, renderer, source3) {
      if (!isObject(receiver)) return;
      let record = this.lookup(receiver) ?? this.make(receiver, renderer);
      if (record)
        return record.readbacks < VISUAL_LIMITS.maxReadbacks && record.readbacks++, record.readbacks === 2 && this.mark(record, "repeat-readback"), record.sources !== 0 && (record.sources & source3) === 0 && this.mark(record, "multiple-readback-formats"), record.sources |= source3, record.image && !record.queued && this.changed(record), record;
    }
    snapshot(record) {
      let operations = [];
      for (let index = 0; index < VISUAL_OPERATIONS.length; index++) {
        let operation = VISUAL_OPERATIONS[index];
        record.operations[operation] && arrayPush(operations, operation);
      }
      return { id: record.id, renderer: record.renderer, operations, readbacks: record.readbacks };
    }
    reset(receiver) {
      let record = this.lookup(receiver);
      record && this.mark(record, "canvas-reset");
    }
    imageSource(receiver, value) {
      if (!isObject(receiver)) return;
      let svg = typeof value == "string" && slice(value, 0, 18) === "data:image/svg+xml";
      if (get(this.images, receiver) !== void 0) {
        set(this.images, receiver, svg);
        return;
      }
      svg && this.imageCount < VISUAL_LIMITS.maxCanvases && (this.imageCount++, set(this.images, receiver, !0));
    }
    bitmap(receiver, result) {
      let record = this.lookup(receiver);
      !record || !isObject(result) || (set(this.records, result, record), this.mark(record, "bitmap-transfer"));
    }
    offscreen(receiver, result) {
      if (!isObject(receiver) || !isObject(result)) return;
      let record = this.lookup(receiver) ?? this.make(receiver, "unknown");
      record && (set(this.records, result, record), this.mark(record, "offscreen-transfer"));
    }
    action(receiver, name, args) {
      let record = this.lookup(receiver);
      if (!record) return;
      let mark = (operation) => this.mark(record, operation);
      if (name === "fillText" || name === "strokeText") mark("text");
      else if (name === "drawImage") {
        mark("image-copy"), args.length === 9 && mark("cropped-copy");
        let source3 = this.lookup(args[0]);
        source3?.operations["cropped-copy"] && mark("recombined-copy"), source3?.operations["flip-y"] && record.operations["flip-y"] && mark("flip-back-copy"), (source3?.renderer === "webgl" || source3?.renderer === "webgl2") && mark("webgl-to-2d"), isObject(args[0]) && get(this.images, args[0]) && mark("svg-source");
      } else if (name === "putImageData") mark("pixel-write");
      else if (name === "fillRect" || name === "clearRect") mark("fill");
      else if (name === "createLinearGradient" || name === "createRadialGradient" || name === "createConicGradient") mark("gradient");
      else if (name === "createPattern") mark("pattern");
      else if (name === "arc" || name === "fill" || name === "stroke" || name === "rect") mark("path");
      else if (name === "scale" || name === "translate" || name === "rotate" || name === "transform" || name === "setTransform" || name === "resetTransform") {
        mark("transform");
        for (let index = 0; index < args.length && index < 6; index++) {
          let value = args[index];
          typeof value == "number" && finite3(value) && value % 1 !== 0 && mark("fractional");
        }
        name === "scale" ? (typeof args[0] == "number" && args[0] < 0 && mark("flip-x"), typeof args[1] == "number" && args[1] < 0 && mark("flip-y")) : (name === "setTransform" || name === "transform") && args.length >= 6 && args[1] === 0 && args[2] === 0 && (typeof args[0] == "number" && args[0] < 0 && mark("flip-x"), typeof args[3] == "number" && args[3] < 0 && mark("flip-y"));
      } else if (name === "globalAlpha") mark("alpha");
      else if (name === "globalCompositeOperation") mark("composite");
      else if (name === "texImage2D" || name === "texSubImage2D") {
        mark("texture-upload");
        let sourceIndex = args.length === 6 ? 5 : args.length === 7 ? 6 : 8, source3 = this.lookup(args[sourceIndex]);
        source3?.renderer === "2d" ? mark("2d-to-webgl") : (source3?.renderer === "webgl" || source3?.renderer === "webgl2") && mark("webgl-to-webgl");
      } else name === "createShader" || name === "shaderSource" || name === "compileShader" || name === "linkProgram" || name === "useProgram" ? mark("shader") : name === "drawArrays" || name === "drawElements" || name === "clear" ? mark("gpu-draw") : name === "finish" || name === "flush" ? mark("gpu-sync") : name === "getParameter" || name === "getSupportedExtensions" || name === "getShaderPrecisionFormat" ? mark("gl-parameters") : name === "getExtension" ? (args[0] === "EXT_disjoint_timer_query" || args[0] === "EXT_disjoint_timer_query_webgl2") && mark("timer-extension") : name === "beginQuery" || name === "endQuery" ? ((args[0] === 35887 || args[0] === 36202) && mark("occlusion-query"), args[0] === 35007 && mark("timer-query")) : name === "getQueryParameter" ? mark("query-read") : name === "pixelStorei" ? (args[0] === 37440 && (args[1] === !0 || args[1] === 1) && mark("flip-y"), args[0] === 37441 && (args[1] === !0 || args[1] === 1) && mark("alpha")) : name === "transferControlToOffscreen" ? mark("offscreen-transfer") : name === "createImageBitmap" && mark("bitmap-create");
    }
    clear() {
      this.records = new WeakMapCtor(), this.images = new WeakMapCtor();
    }
  };

  // packages/sensors/src/visual.ts
  // ADR-066 canonical visual capture start
  var visualCaptureSupport66 = (() => {
    const descriptor = Object.getOwnPropertyDescriptor;
    const create = Object.create;
    const getPrototype = Object.getPrototypeOf;
    const apply = Reflect.apply;
    const own = Function.prototype.call.bind(Object.prototype.hasOwnProperty);
    const slice = Function.prototype.call.bind(String.prototype.slice);
    const charCode = Function.prototype.call.bind(String.prototype.charCodeAt);
    const includes = Function.prototype.call.bind(String.prototype.includes);
    const functionSource = Function.prototype.call.bind(Function.prototype.toString);
    const regexTest = Function.prototype.call.bind(RegExp.prototype.test);
    const integer = Number.isSafeInteger;
    const ceil = Math.ceil;
    const decode = atob;
    const WeakMapCtor = WeakMap;
    const weakGet = Function.prototype.call.bind(WeakMap.prototype.get);
    const weakSet = Function.prototype.call.bind(WeakMap.prototype.set);
    const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
    const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const PNG_PREFIX = "data:image/png;base64,";
    function nativeGetter(target, key) {
      const getter = target && descriptor(target, key)?.get;
      return typeof getter === "function" && includes(functionSource(getter), "[native code]") ? getter : null;
    }
    function nativePrototype(name) {
      const constructor = descriptor(globalThis, name);
      if (!constructor || !own(constructor, "value") || typeof constructor.value !== "function") return null;
      const prototype = descriptor(constructor.value, "prototype");
      return prototype && own(prototype, "value") && typeof prototype.value === "object" ? prototype.value : null;
    }
    const imagePrototype = nativePrototype("ImageData");
    const imageWidth = nativeGetter(imagePrototype, "width");
    const imageHeight = nativeGetter(imagePrototype, "height");
    const imageBytes = nativeGetter(imagePrototype, "data");
    const imageColorSpace = nativeGetter(imagePrototype, "colorSpace");
    const typedPrototype = getPrototype(Uint8Array.prototype);
    const typedLength = nativeGetter(typedPrototype, "length");
    const typedBuffer = nativeGetter(typedPrototype, "buffer");
    const typedKind = nativeGetter(typedPrototype, Symbol.toStringTag);
    const bufferLength = nativeGetter(ArrayBuffer.prototype, "byteLength");
    function dimensions(width, height) {
      return typeof width === "number" && typeof height === "number" && integer(width) && integer(height) && width > 0 && height > 0 && width <= VISUAL_LIMITS.maxDimension && height <= VISUAL_LIMITS.maxDimension && width * height <= VISUAL_LIMITS.maxPixels;
    }
    function bytes(value, kind, length, exact = true) {
      if (typeof value !== "object" || value === null || apply(typedKind, value, []) !== kind) return null;
      const available = apply(typedLength, value, []);
      if (exact ? available !== length : available < length) return null;
      const buffer = apply(typedBuffer, value, []);
      if (apply(bufferLength, buffer, []) < length) return null;
      return value;
    }
    function encode(value, length, offset = 0) {
      let out = "";
      for (let i = 0; i < length; i += 3) {
        const start = offset + i;
        const a = value[start], b = i + 1 < length ? value[start + 1] : 0, c = i + 2 < length ? value[start + 2] : 0;
        out += ALPHABET[a >> 2] + ALPHABET[(a & 3) << 4 | b >> 4] + (i + 1 < length ? ALPHABET[(b & 15) << 2 | c >> 6] : "=") + (i + 2 < length ? ALPHABET[c & 63] : "=");
      }
      return out;
    }
    const captures = new WeakMapCtor();
    function visualCaptureFor(runtime) {
      return weakGet(captures, runtime)?.capture;
    }
    function installVisualCapture(runtime, _realm = globalThis) {
      const existing = weakGet(captures, runtime);
      if (existing) {
        existing.registerRealm(_realm);
        return existing.capture;
      }
      const env = runtime.visualEnv;
      let expires = 0;
      let timer = null;
      const epoch = runtime.historyEpoch;
      let seen = 0;
      let capturedCount = 0;
      let capturedChars = 0;
      let deliveredFrames = 0;
      let deliveredChars = 0;
      let limited = false;
      let limitSent = false;
      let flushTimer = null;
      let transportEnabled = false;
      let pending = create(null);
      let pendingRecords = create(null);
      let pendingIndices = create(null);
      let pendingCount = 0;
      let drainingCount = 0;
      let stopped = false;
      let helloTimer = null;
      let helloCount = 0;
      let lastHello = -Infinity;
      let policyDenied = false;
      const unsafePack = new WeakMapCtor();
      const markLimited = () => {
        limited = true;
        schedule();
      };
      const activity = new VisualActivity(runtime.sensorBootId, (record) => {
        if (record.image) queue(record.image, record);
      }, markLimited);
      const disable = () => {
        expires = 0;
        transportEnabled = false;
        pending = create(null);
        pendingCount = 0;
        pendingRecords = create(null);
        pendingIndices = create(null);
        activity.clear();
        if (flushTimer !== null) {
          env.clearTimeout(flushTimer);
          flushTimer = null;
        }
        if (timer !== null) {
          env.clearTimeout(timer);
          timer = null;
        }
      };
      const denyPolicy = () => {
        policyDenied = true;
        disable();
        drainingCount = 0;
        if (helloTimer !== null) {
          env.clearTimeout(helloTimer);
          helloTimer = null;
        }
      };
      const registerRealm = (realm) => {
        registerValueCaptureRealm(runtime, realm);
      };
      const denied = () => valueCaptureDenied(runtime);
      const expire = () => {
        if ((pendingCount > 0 || drainingCount > 0 || limited) && transportEnabled && !limitSent && !stopped && runtime.hooks.enabled && epoch === runtime.historyEpoch) {
          limitSent = true;
          try {
            env.postMessage({ channel: VISUAL_CHANNEL, type: "visual-limited", sensorBootId: runtime.sensorBootId });
          } catch {
          }
        }
        disable();
      };
      const alive = () => {
        if (!expires || stopped) return false;
        if (!runtime.hooks.enabled || epoch !== runtime.historyEpoch) {
          disable();
          return false;
        }
        if (env.now() >= expires) {
          expire();
          return false;
        }
        return true;
      };
      const active = (kind, receiver) => {
        const record = activity.lookup(receiver);
        if (record?.image || record?.omitted) return false;
        if (capturedCount >= VISUAL_LIMITS.maxImages) {
          markLimited();
          return false;
        }
        return typeof receiver === "object" && receiver !== null ? record?.image === null : (seen & kind) === 0;
      };
      const drain = () => {
        if (denied()) return;
        if (flushTimer !== null) {
          env.clearTimeout(flushTimer);
          flushTimer = null;
        }
        if (!transportEnabled || !alive()) return;
        const queued = pending, records = pendingRecords, count = pendingCount;
        pending = create(null);
        pendingCount = 0;
        pendingRecords = create(null);
        pendingIndices = create(null);
        drainingCount = count;
        for (let index = 0; index < count && transportEnabled && alive(); index++) {
          if (denied()) return;
          const raw = queued[index], record = records[index];
          drainingCount = count - index;
          if (!raw) continue;
          const image = record ? { ...raw, canvas: activity.snapshot(record) } : raw;
          if (record) record.queued = false;
          if (deliveredFrames >= VISUAL_LIMITS.maxFrames || deliveredChars + image.data.length > VISUAL_LIMITS.maxTotalBase64Chars * 2) {
            limited = true;
            continue;
          }
          deliveredFrames++;
          deliveredChars += image.data.length;
          if (denied()) return;
          env.postMessage({ channel: VISUAL_CHANNEL, type: "visual-image", sensorBootId: runtime.sensorBootId, image });
        }
        drainingCount = 0;
        if (limited && !limitSent && transportEnabled && alive()) {
          limitSent = true;
          env.postMessage({ channel: VISUAL_CHANNEL, type: "visual-limited", sensorBootId: runtime.sensorBootId });
        }
      };
      const schedule = () => {
        if (!transportEnabled || !alive()) return;
        if (expires - env.now() <= 250) drain();
        else if (flushTimer === null) flushTimer = env.setTimeout(drain, 250);
      };
      const queue = (image, record) => {
        if (denied()) return;
        if (record?.queued) return;
        const key = record?.id ?? image.kind;
        const previous = pendingIndices[key];
        if (previous !== void 0) {
          pending[previous] = image;
          if (record) pendingRecords[previous] = record;
        } else {
          if (pendingCount >= VISUAL_LIMITS.maxImages) {
            markLimited();
            return;
          }
          pendingIndices[key] = pendingCount;
          pending[pendingCount] = image;
          if (record) pendingRecords[pendingCount] = record;
          pendingCount++;
        }
        if (record) record.queued = true;
        if (deliveredFrames === 0) drain();
        else schedule();
      };
      const send = (image, kind, receiver) => {
        if (denied()) return;
        if (!active(kind, receiver)) {
          if (alive() && capturedCount >= VISUAL_LIMITS.maxImages) markLimited();
          return;
        }
        if (capturedChars + image.data.length > VISUAL_LIMITS.maxTotalBase64Chars) {
          markLimited();
          return;
        }
        capturedCount++;
        capturedChars += image.data.length;
        const record = activity.lookup(receiver);
        if (record) record.image = image;
        else seen |= kind;
        queue(image, record);
      };
      const fits = (length, receiver) => {
        if (capturedChars + length <= VISUAL_LIMITS.maxTotalBase64Chars) return true;
        const record = activity.lookup(receiver);
        if (record) record.omitted = true;
        markLimited();
        return false;
      };
      const hello = () => {
        helloTimer = null;
        if (stopped || policyDenied || helloCount >= 4) return;
        helloCount++;
        lastHello = env.now();
        env.postMessage({ channel: VISUAL_CHANNEL, type: "visual-hello", sensorBootId: runtime.sensorBootId });
      };
      const onMessage = (event) => {
        try {
          if (stopped || denied() || typeof event !== "object" || event === null) return;
          const message = env.readMessage(event);
          if (message.source !== env.self) return;
          if (typeof message.data === "object" && message.data !== null && descriptor(message.data, "channel")?.value === CHANNEL) {
            const checked = validateBridgeMessage(message.data);
            if (!checked.ok) return;
            const boot = descriptor(checked.value, "sensorBootId")?.value;
            if (boot !== runtime.sensorBootId && boot !== UNBOUND_SENSOR_BOOT_ID) return;
            const type = descriptor(checked.value, "type")?.value;
            if (type === "bridge-hello" && descriptor(checked.value, "protocolVersion")?.value === PROTOCOL_VERSION && helloCount < 4 && helloTimer === null) {
              const elapsed = env.now() - lastHello;
              if (elapsed >= 250) hello();
              else helloTimer = env.setTimeout(hello, 250 - elapsed);
            } else if (boot === runtime.sensorBootId && type === "bridge-pause") disable();
            return;
          }
          const valid = validateVisualConfigMessage(message.data);
          if (!valid.ok || descriptor(valid.value, "sensorBootId")?.value !== runtime.sensorBootId) return;
          const enabled = descriptor(valid.value, "enabled")?.value === true;
          const remaining = descriptor(valid.value, "remainingMs")?.value;
          if (typeof remaining !== "number" || !integer(remaining) || remaining < 0 || remaining > VISUAL_LIMITS.leaseMs) return;
          if (!alive()) return;
          if (!enabled || remaining === 0) {
            transportEnabled = false;
            return;
          }
          const now = env.now();
          if (now + remaining < expires) {
            expires = now + remaining;
            if (timer !== null) env.clearTimeout(timer);
            timer = env.setTimeout(expire, remaining);
          }
          transportEnabled = true;
          drain();
        } catch {
        }
      };
      const capture = {
        context(receiver, result, type) {
          if (alive()) activity.context(receiver, result, type);
        },
        action(receiver, name, args) {
          if (alive()) activity.action(receiver, name, args);
        },
        reset(receiver) {
          if (alive()) activity.reset(receiver);
        },
        imageSource(receiver, value) {
          if (alive()) activity.imageSource(receiver, value);
        },
        bitmap(receiver, result) {
          if (alive()) activity.bitmap(receiver, result);
        },
        offscreen(receiver, result) {
          if (alive()) activity.offscreen(receiver, result);
        },
        imageData(result, receiver) {
          if (denied()) return;
          if (!alive()) return;
          activity.readback(receiver, "2d", 1);
          if (!active(1, receiver) || !imageWidth || !imageHeight || !imageBytes) return;
          try {
            const width = apply(imageWidth, result, []), height = apply(imageHeight, result, []);
            if (!dimensions(width, height)) return;
            if (imageColorSpace && apply(imageColorSpace, result, []) !== "srgb") return;
            const length = width * height * 4;
            if (!fits(ceil(length / 3) * 4, receiver)) return;
            const data = bytes(apply(imageBytes, result, []), "Uint8ClampedArray", length);
            if (data) send({ kind: "canvas", source: "getImageData", format: "rgba", width, height, data: encode(data, length) }, 1, receiver);
          } catch {
          }
        },
        dataUrl(result, receiver) {
          if (denied()) return;
          if (!alive()) return;
          const record = activity.readback(receiver, "unknown", 2);
          const kind = record?.renderer === "webgl" || record?.renderer === "webgl2" ? "webgl" : "canvas";
          if (!active(1, receiver) || typeof result !== "string" || result.length > VISUAL_LIMITS.maxBase64Chars + PNG_PREFIX.length || slice(result, 0, PNG_PREFIX.length) !== PNG_PREFIX) return;
          try {
            const data = slice(result, PNG_PREFIX.length);
            if (!fits(data.length, receiver)) return;
            if (data.length < 44 || data.length % 4 !== 0 || !regexTest(BASE64, data)) return;
            const header = decode(slice(data, 0, 44));
            const uint = (i) => charCode(header, i) * 16777216 + charCode(header, i + 1) * 65536 + charCode(header, i + 2) * 256 + charCode(header, i + 3);
            const width = uint(16), height = uint(20);
            if (slice(header, 0, 8) !== "PNG\r\n\n" || uint(8) !== 13 || slice(header, 12, 16) !== "IHDR" || !dimensions(width, height)) return;
            send({ kind, source: "toDataURL", format: "png", width, height, data }, 1, receiver);
          } catch {
          }
        },
        readPixels(receiver, args, webgl2 = false) {
          if (denied()) return;
          if (!alive()) return;
          activity.readback(receiver, "webgl", 4);
          if (!active(2, receiver) || typeof receiver !== "object" || receiver === null || weakGet(unsafePack, receiver)) return;
          try {
            if (args.length < 7) return;
            const width = args[2], height = args[3];
            if (!dimensions(width, height) || args[4] !== 6408 || args[5] !== 5121) return;
            const length = width * height * 4;
            const rawOffset = webgl2 && args.length > 7 ? args[7] : 0;
            const offset = rawOffset === void 0 ? 0 : rawOffset;
            if (typeof offset !== "number" || !integer(offset) || offset < 0 || !integer(offset + length)) return;
            if (!fits(ceil(length / 3) * 4, receiver)) return;
            const data = bytes(args[6], "Uint8Array", offset + length, false);
            if (data) send({ kind: "webgl", source: "readPixels", format: "rgba", width, height, data: encode(data, length, offset) }, 2, receiver);
          } catch {
          }
        },
        pixelStore(receiver, args) {
          if (typeof receiver !== "object" || receiver === null) return;
          const parameter = args[0], value = args[1];
          if (typeof parameter !== "number" || parameter === 3333 && value !== 1 && value !== 2 && value !== 4 || (parameter === 3330 || parameter === 3331 || parameter === 3332) && value !== 0) weakSet(unsafePack, receiver, true);
        },
        stop() {
          if (stopped) return;
          stopped = true;
          disable();
          if (helloTimer !== null) {
            env.clearTimeout(helloTimer);
            helloTimer = null;
          }
          env.removeEventListener("message", onMessage);
        }
      };
      weakSet(captures, runtime, { capture, registerRealm });
      onValueCaptureDenied(runtime, denyPolicy);
      registerRealm(_realm);
      runtime.onStop(capture.stop);
      if (runtime.hooks.enabled && !policyDenied) {
        expires = env.now() + VISUAL_LIMITS.leaseMs;
        timer = env.setTimeout(expire, VISUAL_LIMITS.leaseMs);
        env.addEventListener("message", onMessage);
        hello();
      }
      return capture;
    }
    
    return { visualCaptureFor, installVisualCapture };
  })();
  var visualCaptureFor = visualCaptureSupport66.visualCaptureFor;
  var installVisualCapture = visualCaptureSupport66.installVisualCapture;
  // ADR-066 canonical visual capture end

  // packages/sensors/src/canvas.ts
  var WeakSetCtor = WeakSet, WeakMapCtor3 = WeakMap, weakGet2 = Function.prototype.call.bind(WeakMap.prototype.get), weakPut = Function.prototype.call.bind(WeakMap.prototype.set), getOwnPropertyDescriptor2 = Object.getOwnPropertyDescriptor, T_EXPORT = TECHNIQUE_INDEX["DET-001"], T_READBACK = TECHNIQUE_INDEX["DET-002"], T_TEXT = TECHNIQUE_INDEX["DET-003"], T_OFFSCREEN = TECHNIQUE_INDEX["DET-004"], P_ATTEMPTED = PHASE_INDEX.attempted, P_RETURNED = PHASE_INDEX["returned-sync"], P_THREW = PHASE_INDEX["threw-sync"], P_ASYNC = PHASE_INDEX["settlement-unobserved"], S_API = SIGNAL_BIT["api-use"], S_DRAWN = SIGNAL_BIT["text-drawn"], S_MEASURED = SIGNAL_BIT["text-measured"], S_AFTER_TEXT = SIGNAL_BIT["readback-after-text"], CANVAS = "HTMLCanvasElement", CONTEXT_2D = "CanvasRenderingContext2D", OFFSCREEN = "OffscreenCanvas", OFFSCREEN_CONTEXT_2D = "OffscreenCanvasRenderingContext2D";
  function prototypeOf(realm, name) {
    let d = getOwnPropertyDescriptor2(realm, name);
    if (d === void 0 || !("value" in d) || typeof d.value != "function") return null;
    let p = getOwnPropertyDescriptor2(d.value, "prototype");
    return p === void 0 || !("value" in p) || typeof p.value != "object" || p.value === null ? null : p.value;
  }
  function installCanvasSensor(runtime, realm = globalThis) {
    let results = [], skipped = [], options = { context: runtime.hooks }, visual = visualCaptureFor(runtime), textDrawn = new WeakSetCtor(), textContexts = new WeakSetCtor(), canvasContexts = new WeakMapCtor3(), contextCanvases = new WeakMapCtor3(), historyEpoch = runtime.historyEpoch, refreshHistory = () => {
      historyEpoch !== runtime.historyEpoch && (historyEpoch = runtime.historyEpoch, textDrawn = new WeakSetCtor(), textContexts = new WeakSetCtor());
    }, selfCanvas = (thisArg) => typeof thisArg == "object" && thisArg !== null ? thisArg : null, linkedCanvas = (context) => weakGet2(contextCanvases, context), contextReturned = (thisArg, args, threw, _error, result) => {
      if (threw) return;
      let canvas = selfCanvas(thisArg), context = selfCanvas(result);
      canvas === null || context === null || (refreshHistory(), weakPut(canvasContexts, canvas, context), weakPut(contextCanvases, context, canvas), visual?.context(canvas, context, args[0]), weakSetHas(textContexts, context) && weakSetAdd(textDrawn, canvas));
    }, readback = (technique, okPhase, tracked, preview, operation) => (thisArg, _args, threw, _error, result) => {
      if (runtime.apiResults.proSession && operation) { runtime.apiResults.recordPro(operation, PHASES[threw ? P_THREW : okPhase], void 0, _args, technique === T_READBACK ? "DET-002" : technique === T_OFFSCREEN ? "DET-004" : "DET-001"); }
      refreshHistory();
      let mask = S_API;
      if (threw) {
        runtime.record(technique, P_THREW, mask);
        return;
      }
      let receiver = selfCanvas(thisArg);
      receiver !== null && weakSetHas(tracked(), receiver) && (mask |= S_AFTER_TEXT), runtime.record(technique, okPhase, mask), visual && preview && visual[preview](result, thisArg);
    }, textDraw = (thisArg, args, threw) => {
      if (refreshHistory(), threw) {
        runtime.record(T_TEXT, P_THREW, S_API | S_DRAWN);
        return;
      }
      let context = selfCanvas(thisArg);
      if (context !== null) {
        weakSetAdd(textContexts, context);
        let canvas = linkedCanvas(context);
        canvas !== void 0 && weakSetAdd(textDrawn, canvas);
      }
      runtime.record(T_TEXT, P_RETURNED, S_API | S_DRAWN), visual?.action(thisArg, "fillText", args);
    }, textMeasure = operation => (_receiver, _args, threw, _error, result) => {
      runtime.record(T_TEXT, threw ? P_THREW : P_RETURNED, S_API | S_MEASURED);
      if (runtime.apiResults.proSession) runtime.apiResults.recordPro(operation, PHASES[threw ? P_THREW : P_RETURNED], result, void 0, "DET-003");
    }, install = (proto, key, observe) => {
      arrayPush(results, wrapMethod(proto, key, observe, options));
    }, installClears = (proto) => {
      let cleared = (thisArg, _args, threw) => {
        if (threw) return;
        refreshHistory();
        let context = selfCanvas(thisArg);
        if (context === null) return;
        visual && visual.action(context, "clearRect", _args), weakSetDelete(textContexts, context);
        let canvas = linkedCanvas(context);
        canvas !== void 0 && weakSetDelete(textDrawn, canvas);
      };
      getOwnPropertyDescriptor2(proto, "clearRect") !== void 0 && install(proto, "clearRect", cleared), getOwnPropertyDescriptor2(proto, "reset") !== void 0 && install(proto, "reset", (receiver, args, threw, error, result) => {
        cleared(receiver, args, threw, error, result), threw || visual?.reset(receiver);
      });
    }, installDimensions = (proto) => {
      let resized = (thisArg, _args, threw) => {
        if (threw) return;
        let canvas = selfCanvas(thisArg);
        if (canvas === null) return;
        visual?.reset(canvas), refreshHistory(), weakSetDelete(textDrawn, canvas);
        let context = weakGet2(canvasContexts, canvas);
        context !== void 0 ? weakSetDelete(textContexts, context) : textContexts = new WeakSetCtor();
      };
      arrayPush(results, wrapSetter(proto, "width", resized, options)), arrayPush(results, wrapSetter(proto, "height", resized, options));
    }, installActivity = (proto) => {
      if (visual) {
        for (let key of [
          "drawImage",
          "putImageData",
          "fillRect",
          "createLinearGradient",
          "createRadialGradient",
          "createConicGradient",
          "createPattern",
          "arc",
          "fill",
          "stroke",
          "rect",
          "scale",
          "translate",
          "rotate",
          "transform",
          "setTransform",
          "resetTransform"
        ])
          getOwnPropertyDescriptor2(proto, key) !== void 0 && install(proto, key, (receiver, args, threw) => {
            threw || visual.action(receiver, key, args);
          });
        for (let key of ["globalAlpha", "globalCompositeOperation"])
          getOwnPropertyDescriptor2(proto, key) !== void 0 && arrayPush(results, wrapSetter(proto, key, (receiver, args, threw) => {
            threw || visual.action(receiver, key, args);
          }, options));
      }
    }, canvasProto = prototypeOf(realm, CANVAS);
    canvasProto === null ? arrayPush(skipped, CANVAS) : (installDimensions(canvasProto), install(canvasProto, "getContext", contextReturned), getOwnPropertyDescriptor2(canvasProto, "transferControlToOffscreen") !== void 0 && install(canvasProto, "transferControlToOffscreen", (receiver, _args, threw, _error, result) => {
      threw || (runtime.addFlag("worker-not-observed"), visual?.offscreen(receiver, result));
    }), install(canvasProto, "toDataURL", readback(T_EXPORT, P_RETURNED, () => textDrawn, "dataUrl", "HTMLCanvasElement.toDataURL")), install(canvasProto, "toBlob", readback(T_EXPORT, P_ATTEMPTED, () => textDrawn, void 0, "HTMLCanvasElement.toBlob")));
    let ctxProto = prototypeOf(realm, CONTEXT_2D);
    ctxProto === null ? arrayPush(skipped, CONTEXT_2D) : (install(ctxProto, "getImageData", readback(T_READBACK, P_RETURNED, () => textContexts, "imageData", "CanvasRenderingContext2D.getImageData")), arrayPush(results, wrapMethod(ctxProto, "measureText", textMeasure("CanvasRenderingContext2D.measureText"), options)), install(ctxProto, "fillText", textDraw), install(ctxProto, "strokeText", textDraw), installClears(ctxProto), installActivity(ctxProto));
    let offscreenProto = prototypeOf(realm, OFFSCREEN);
    offscreenProto === null ? arrayPush(skipped, OFFSCREEN) : (installDimensions(offscreenProto), install(offscreenProto, "getContext", contextReturned), install(offscreenProto, "convertToBlob", readback(T_OFFSCREEN, P_ASYNC, () => textDrawn, void 0, "OffscreenCanvas.convertToBlob")), visual && getOwnPropertyDescriptor2(offscreenProto, "transferToImageBitmap") !== void 0 && install(offscreenProto, "transferToImageBitmap", (receiver, _args, threw, _error, result) => {
      threw || visual.bitmap(receiver, result);
    }));
    let offscreenCtxProto = prototypeOf(realm, OFFSCREEN_CONTEXT_2D);
    return offscreenCtxProto === null ? arrayPush(skipped, OFFSCREEN_CONTEXT_2D) : (install(offscreenCtxProto, "getImageData", readback(T_OFFSCREEN, P_RETURNED, () => textContexts, "imageData", "OffscreenCanvasRenderingContext2D.getImageData")), arrayPush(results, wrapMethod(offscreenCtxProto, "measureText", textMeasure("OffscreenCanvasRenderingContext2D.measureText"), options)), install(offscreenCtxProto, "fillText", textDraw), install(offscreenCtxProto, "strokeText", textDraw), installClears(offscreenCtxProto), installActivity(offscreenCtxProto)), visual && getOwnPropertyDescriptor2(realm, "createImageBitmap") !== void 0 && install(realm, "createImageBitmap", (_receiver, args, threw) => {
      threw || visual.action(args[0], "createImageBitmap", args);
    }), runtime.attach(results), { results, skipped };
  }

  // packages/sensors/src/child-realms.ts
  var CHILD_REALM_CHANNEL = "detect.expert/child-realm/v1", SENSOR_MARK = /* @__PURE__ */ Symbol.for("detect.expert/sensor/v1"), apply9 = Reflect.apply, define2 = Object.defineProperty, descriptor4 = Object.getOwnPropertyDescriptor, create6 = Object.create, functionSource3 = Function.prototype.call.bind(Function.prototype.toString), includes3 = Function.prototype.call.bind(String.prototype.includes), getPrototype3 = Object.getPrototypeOf, NO_ARGS2 = Object.freeze([]), MapCtor = Map, mapGet7 = Function.prototype.call.bind(Map.prototype.get), mapSet3 = Function.prototype.call.bind(Map.prototype.set), mapDelete = Function.prototype.call.bind(Map.prototype.delete), mapClear2 = Function.prototype.call.bind(Map.prototype.clear);
  function native(value) {
    if (typeof value != "function" || !includes3(functionSource3(value), "[native code]")) throw new Error("child realm environment unavailable");
    return value;
  }
  function ownData(object, key) {
    let found = descriptor4(object, key);
    return found && descriptor4(found, "value") ? found.value : void 0;
  }
  function nativeMember(object, key) {
    let current = object;
    for (let depth = 0; current !== null && depth < 16; depth++) {
      let found = descriptor4(current, key);
      if (found) return native(ownData(found, "value"));
      current = getPrototype3(current);
    }
    throw new Error("child realm environment unavailable");
  }
  function startChildRealmManager(parentRuntime, parentWindow = window, installForRealm = (runtime, realm) => {
    installCanvasSensor(runtime, realm);
  }) {
    let parentEnv = parentRuntime.visualEnv;
    if (parentEnv.self !== parentWindow) throw new Error("child realm parent environment mismatch");
    let documentDescriptor = descriptor4(parentWindow, "document");
    if (!documentDescriptor || documentDescriptor.configurable !== !1) throw new Error("child realm identity unavailable");
    let getDocument = native(ownData(documentDescriptor, "get")), add2 = nativeMember(parentWindow, "addEventListener"), remove3 = nativeMember(parentWindow, "removeEventListener"), dispatch = nativeMember(parentWindow, "dispatchEvent"), MessageEventCtor = native(ownData(parentWindow, "MessageEvent")), transitionEvent = native(ownData(parentWindow, "PageTransitionEvent")), transitionPrototype = ownData(transitionEvent, "prototype"), getPersisted = native(ownData(descriptor4(transitionPrototype, "persisted"), "get")), clone = nativeMember(parentWindow, "structuredClone"), children = new MapCtor(), stopped = !1, stopping = !1, childIndex = (source3, hint = -1) => {
      if (hint >= 0 && ownData(parentWindow, "" + hint) === source3) return hint;
      for (let i = 0; i < BUDGETS.maxOutOfOrderEntriesGlobal; i++) if (ownData(parentWindow, "" + i) === source3) return i;
      return -1;
    }, closingDocument = (event) => {
      if (typeof event != "object" || event === null) return !1;
      try {
        let trusted = descriptor4(event, "isTrusted");
        return trusted?.configurable === !1 && apply9(native(ownData(trusted, "get")), event, NO_ARGS2) === !0 && apply9(getPersisted, event, NO_ARGS2) === !1;
      } catch {
        return !1;
      }
    }, current = (record) => {
      if (!record.active || stopped) return !1;
      try {
        return apply9(getDocument, record.window, NO_ARGS2) !== record.document ? !1 : (record.index = childIndex(record.window, record.index), record.index >= 0);
      } catch {
        return !1;
      }
    }, retire = (record, finalDiagnostic = !1) => {
      if (!(!record.active || record.retiring)) {
        if (record.retiring = !0, finalDiagnostic && current(record))
          try {
            record.runtime?.stop("local");
          } catch {
          }
        record.active = !1, mapDelete(children, record.window);
        try {
          record.runtime?.stop("local");
        } catch {
        }
        mapForEach(record.listeners, (listener) => {
          try {
            apply9(remove3, record.window, [listener.type, listener.callback]);
          } catch {
          }
        }), mapClear2(record.listeners);
      }
    }, manager = {
      get size() {
        return mapSize(children);
      },
      stop() {
        stopped || stopping || (stopping = !0, parentEnv.removeEventListener("message", onMessage), parentEnv.removeEventListener("pagehide", onPageHide), mapForEach(children, (record) => retire(record, !0)), stopped = !0);
      }
    }, install = (source3) => {
      if (source3 === parentWindow || stopped || stopping) return;
      let old = mapGet7(children, source3);
      if (old && current(old)) return;
      if (old && retire(old), mapForEach(children, (record2) => {
        current(record2) || retire(record2);
      }), mapSize(children) >= BUDGETS.maxOutOfOrderEntriesGlobal) {
        parentRuntime.addFlag("budget-exceeded");
        return;
      }
      let childDocument = apply9(getDocument, source3, NO_ARGS2), index = childIndex(source3);
      if (typeof childDocument != "object" || childDocument === null || index < 0 || descriptor4(source3, SENSOR_MARK) !== void 0) return;
      let record = { window: source3, document: childDocument, index, runtime: null, active: !0, retiring: !1, listeners: new MapCtor() }, childEnv = {
        self: source3,
        startedLate: !0,
        earlyCaptureGuaranteed: !1,
        now: parentEnv.now,
        randomBytes: parentEnv.randomBytes,
        clearTimeout: parentEnv.clearTimeout,
        readMessage: parentEnv.readMessage,
        setTimeout(callback, ms) {
          return parentEnv.setTimeout(() => {
            if (!current(record)) {
              retire(record);
              return;
            }
            callback();
          }, ms);
        },
        addEventListener(type, listener) {
          let wrapped = (event) => {
            if (!current(record)) {
              retire(record);
              return;
            }
            let childStop = !1;
            if (type === "message" && typeof event == "object" && event !== null)
              try {
                let message = parentEnv.readMessage(event);
                if (message.source === source3 && typeof message.data == "object" && message.data !== null && ownData(message.data, "channel") === CHANNEL) {
                  let parsed = validateBridgeMessage(message.data);
                  parsed.ok && parsed.value.sensorBootId === record.runtime?.sensorBootId && (childStop = parsed.value.type === "bridge-stop");
                }
              } catch {
                return;
              }
            listener(event), (childStop || type === "pagehide" && closingDocument(event)) && retire(record);
          };
          mapSet3(record.listeners, listener, { type, callback: wrapped }), apply9(add2, source3, [type, wrapped]);
        },
        removeEventListener(type, listener) {
          let wrapped = mapGet7(record.listeners, listener);
          wrapped && (apply9(remove3, source3, [type, wrapped.callback]), mapDelete(record.listeners, listener));
        },
        postMessage(message) {
          if (!current(record)) {
            retire(record);
            return;
          }
          let data2 = apply9(clone, parentWindow, [message]), event = new MessageEventCtor("message", { source: source3, data: data2 });
          apply9(dispatch, source3, [event]);
        }
      }, guard = create6(null);
      guard.value = !0, guard.writable = !1, guard.enumerable = !1, guard.configurable = !1, mapSet3(children, source3, record);
      try {
        define2(source3, SENSOR_MARK, guard);
        let runtime = new SensorRuntime(childEnv);
        record.runtime = runtime, installForRealm(runtime, source3), runtime.start();
      } catch {
        retire(record), parentRuntime.addFlag("hook-failed");
      }
    };
    function onMessage(event) {
      try {
        if (stopped || typeof event != "object" || event === null) return;
        let { source: source3, data: data2 } = parentEnv.readMessage(event);
        if (source3 === parentWindow && typeof data2 == "object" && data2 !== null && ownData(data2, "channel") === CHANNEL) {
          let parsed = validateBridgeMessage(data2);
          if (!parsed.ok || parsed.value.sensorBootId !== parentRuntime.sensorBootId) return;
          parsed.value.type === "bridge-stop" && manager.stop();
          return;
        }
        if (typeof source3 != "object" || source3 === null || data2 !== CHILD_REALM_CHANNEL) return;
        install(source3);
      } catch {
      }
    }
    function onPageHide(event) {
      closingDocument(event) && manager.stop();
    }
    let iframeConstructor = ownData(parentWindow, "HTMLIFrameElement"), iframePrototype = typeof iframeConstructor == "function" ? ownData(iframeConstructor, "prototype") : null;
    if (typeof iframePrototype == "object" && iframePrototype !== null) {
      let context = createHookContext(), windowHook = wrapGetter(iframePrototype, "contentWindow", (_receiver, threw, _error, result) => {
        !threw && typeof result == "object" && result !== null && install(result);
      }, { context }), documentHook = wrapGetter(iframePrototype, "contentDocument", (_receiver, threw, _error, result) => {
        if (!(threw || typeof result != "object" || result === null))
          for (let index = 0; index < BUDGETS.maxOutOfOrderEntriesGlobal; index++) {
            let child = ownData(parentWindow, "" + index);
            if (!(typeof child != "object" || child === null))
              try {
                if (apply9(getDocument, child, NO_ARGS2) === result) {
                  install(child);
                  return;
                }
              } catch {
              }
          }
      }, { context });
      parentRuntime.attach([windowHook, documentHook]);
    }
    return parentRuntime.onStop(manager.stop), parentEnv.addEventListener("message", onMessage), parentEnv.addEventListener("pagehide", onPageHide), manager;
  }

  // packages/sensors/src/geometry.ts
  var descriptor5 = Object.getOwnPropertyDescriptor, hasOwn5 = Function.prototype.call.bind(Object.prototype.hasOwnProperty), FONT_ITERATOR = Symbol.iterator;
  function prototype(realm, name) {
    let value = descriptor5(realm, name);
    if (!value || !hasOwn5(value, "value") || typeof value.value != "function") return null;
    let proto = descriptor5(value.value, "prototype");
    return proto && hasOwn5(proto, "value") && typeof proto.value == "object" && proto.value !== null ? proto.value : null;
  }
  function installGeometrySensor(runtime, realm = globalThis) {
    let results = [], skipped = [];
    if (!runtime.hooks.enabled) return { results, skipped };
    let options = { context: runtime.hooks }, method = (target, key, id, label, asynchronous = !1) => {
      if (!descriptor5(target, key)) {
        arrayPush(skipped, key === FONT_ITERATOR ? "Symbol.iterator" : key);
        return;
      }
      let technique = TECHNIQUE_INDEX[id];
      arrayPush(results, wrapMethod(target, key, (_this, args, threw, _error, result) => {
        let phase = threw ? PHASE_INDEX["threw-sync"] : asynchronous ? PHASE_INDEX["settlement-unobserved"] : PHASE_INDEX["returned-sync"];
        runtime.record(technique, phase, SIGNAL_BIT["api-use"]), runtime.recordResult(label, phase, result, args);
      }, options));
    }, family = (name, id, methods, getters = []) => {
      try {
        let target = prototype(realm, name);
        if (!target) {
          arrayPush(skipped, name);
          return;
        }
        for (let key of methods) method(target, key, id, name + "." + key);
        let technique = TECHNIQUE_INDEX[id];
        for (let key of getters) {
          if (!descriptor5(target, key)) {
            arrayPush(skipped, name + "." + key);
            continue;
          }
          let label = name + "." + key;
          arrayPush(results, wrapGetter(target, key, (_this, threw, _error, result) => {
            let phase = threw ? PHASE_INDEX["threw-sync"] : PHASE_INDEX["returned-sync"];
            runtime.record(technique, phase, SIGNAL_BIT["api-use"]), runtime.recordResult(label, phase, result);
          }, options));
        }
      } catch {
        runtime.addFlag("hook-failed");
      }
    };
    family("Element", "DET-005", ["getClientRects", "getBoundingClientRect"]), family("HTMLElement", "DET-005", [], ["offsetWidth", "offsetHeight"]), family("Range", "DET-006", ["getClientRects", "getBoundingClientRect"]), family("SVGGraphicsElement", "DET-007", ["getBBox"]), family("SVGTextContentElement", "DET-007", ["getComputedTextLength", "getSubStringLength"]);
    try {
      let fontSet = prototype(realm, "FontFaceSet");
      if (fontSet) {
        method(fontSet, "check", "DET-008", "FontFaceSet.check"), method(fontSet, "load", "DET-008", "FontFaceSet.load", !0);
        for (let key of ["values", "keys", "entries", "forEach", FONT_ITERATOR]) method(
          fontSet,
          key,
          "DET-008",
          "FontFaceSet." + (key === FONT_ITERATOR ? "iterator" : key)
        );
      } else arrayPush(skipped, "FontFaceSet");
    } catch {
      runtime.addFlag("hook-failed");
    }
    try {
      method(realm, "queryLocalFonts", "DET-009", "Window.queryLocalFonts", !0);
    } catch {
      runtime.addFlag("hook-failed");
    }
    return runtime.attach(results), { results, skipped };
  }

  // packages/sensors/src/webgl.ts
  var getDescriptor2 = Object.getOwnPropertyDescriptor, hasOwn6 = Function.prototype.call.bind(Object.prototype.hasOwnProperty), T_CAPABILITIES = TECHNIQUE_INDEX["DET-011"], T_READBACK2 = TECHNIQUE_INDEX["DET-012"], P_RETURNED2 = PHASE_INDEX["returned-sync"], P_THREW2 = PHASE_INDEX["threw-sync"], P_UNSETTLED = PHASE_INDEX["settlement-unobserved"], S_API2 = SIGNAL_BIT["api-use"], stringIndexOf = Function.prototype.call.bind(String.prototype.indexOf), stringSlice = Function.prototype.call.bind(String.prototype.slice);
  function prototypeOf2(realm, name) {
    let descriptor18 = getDescriptor2(realm, name);
    if (!descriptor18 || !hasOwn6(descriptor18, "value") || typeof descriptor18.value != "function") return null;
    let prototype3 = getDescriptor2(descriptor18.value, "prototype");
    return prototype3 && hasOwn6(prototype3, "value") && typeof prototype3.value == "object" && prototype3.value !== null ? prototype3.value : null;
  }
  function installGraphicsSensor(runtime, realm = globalThis) {
    let results = [], skipped = [];
    if (!runtime.hooks.enabled) return { results, skipped };
    let options = { context: runtime.hooks }, visual = visualCaptureFor(runtime), query = (prefix, name) => (receiver, args, threw, _error, result) => {
      runtime.record(T_CAPABILITIES, threw ? P_THREW2 : P_RETURNED2, S_API2), runtime.recordResult(webglResultOperation(prefix, name, args.length > 0 ? args[0] : void 0), threw ? P_THREW2 : P_RETURNED2, result, args), threw || visual?.action(receiver, name, args);
    }, readback = (webgl2) => (receiver, args, threw) => {
      runtime.record(T_READBACK2, threw ? P_THREW2 : P_RETURNED2, S_API2), runtime.recordResult((webgl2 ? "WebGL2RenderingContext" : "WebGLRenderingContext") + ".readPixels", threw ? P_THREW2 : P_RETURNED2, void 0), !threw && visual && visual.readPixels(receiver, args, webgl2);
    };
    for (let name of ["WebGLRenderingContext", "WebGL2RenderingContext", "GPU", "GPUAdapter", "GPUDevice", "GPUAdapterInfo", "GPUSupportedLimits", "GPUShaderModule"])
      try {
        let prototype3 = prototypeOf2(realm, name);
        if (prototype3 === null) {
          arrayPush(skipped, name);
          continue;
        }
        if (name !== "WebGLRenderingContext" && name !== "WebGL2RenderingContext")
          for (let index = 0; index < API_OPERATION_DEFINITIONS.length; index++) {
            let definition = API_OPERATION_DEFINITIONS[index];
            if (definition[2] !== "webgpu") continue;
            let separator = stringIndexOf(definition[0], ".");
            if (stringSlice(definition[0], 0, separator) !== name) continue;
            let key = stringSlice(definition[0], separator + 1);
            if (getDescriptor2(prototype3, key) === void 0) {
              arrayPush(skipped, definition[0]);
              continue;
            }
            let operation = API_OPERATION_INDEX[definition[0]], returned = definition[3] === "async-call" ? P_UNSETTLED : P_RETURNED2, handle = definition[3] === "get" ? wrapGetter(prototype3, key, (_receiver, threw, _error, result) => {
              runtime.recordOperation(operation, threw ? P_THREW2 : returned), runtime.recordResult(definition[0], threw ? P_THREW2 : returned, result);
            }, options) : wrapResultMethod(prototype3, key, (threw, result) => {
              runtime.recordOperation(operation, threw ? P_THREW2 : returned), runtime.recordResult(definition[0], threw ? P_THREW2 : returned, result);
            }, options);
            arrayPush(results, handle), runtime.attach([handle]);
          }
        else {
          for (let key of ["getParameter", "getExtension", "getSupportedExtensions", "getShaderPrecisionFormat"])
            arrayPush(results, wrapMethod(prototype3, key, query(name, key), options));
          if (arrayPush(results, wrapMethod(prototype3, "readPixels", readback(name === "WebGL2RenderingContext"), options)), visual && getDescriptor2(prototype3, "pixelStorei") && arrayPush(results, wrapMethod(prototype3, "pixelStorei", (receiver, args, threw) => {
            threw || (visual.pixelStore(receiver, args), visual.action(receiver, "pixelStorei", args));
          }, options)), visual) for (let key of [
            "texImage2D",
            "texSubImage2D",
            "createShader",
            "shaderSource",
            "compileShader",
            "linkProgram",
            "useProgram",
            "drawArrays",
            "drawElements",
            "clear",
            "finish",
            "flush",
            "beginQuery",
            "endQuery",
            "getQueryParameter"
          ])
            getDescriptor2(prototype3, key) !== void 0 && arrayPush(results, wrapMethod(prototype3, key, (receiver, args, threw) => {
              threw || visual.action(receiver, key, args);
            }, options));
        }
      } catch {
        runtime.addFlag("hook-failed");
      }
    try {
      let precision = prototypeOf2(realm, "WebGLShaderPrecisionFormat");
      if (precision) for (let key of ["rangeMin", "rangeMax", "precision"])
        getDescriptor2(precision, key) && arrayPush(results, wrapGetter(precision, key, (_receiver, threw, _error, result) => {
          runtime.record(T_CAPABILITIES, threw ? P_THREW2 : P_RETURNED2, S_API2), runtime.recordResult("WebGLShaderPrecisionFormat." + key, threw ? P_THREW2 : P_RETURNED2, result);
        }, options));
    } catch {
      runtime.addFlag("hook-failed");
    }
    return runtime.attach(results), { results, skipped };
  }

  // packages/sensors/src/rtc-details.ts
  // ADR-066 canonical RTC details policy start
  var installRtcCapture = (() => {
    const descriptor = Object.getOwnPropertyDescriptor;
    const apply = Reflect.apply;
    const source = Function.prototype.call.bind(Function.prototype.toString);
    const includes = Function.prototype.call.bind(String.prototype.includes);
    const own = Function.prototype.call.bind(Object.prototype.hasOwnProperty);
    const array = Array.isArray;
    const integer = Number.isSafeInteger;
    const WeakMapCtor = WeakMap;
    const WeakRefCtor = WeakRef;
    const weakGet = Function.prototype.call.bind(WeakMap.prototype.get);
    const weakSet = Function.prototype.call.bind(WeakMap.prototype.set);
    const deref = Function.prototype.call.bind(WeakRef.prototype.deref);
    const NO_ARGS = Object.freeze([]);
    const MAX = 2147483647;
    const min = Math.min;
    const finite = Number.isFinite;
    const EVENT_TYPES = ["icecandidate", "icecandidateerror", "connectionstatechange"];
    function prototype(name) {
      const constructor = descriptor(globalThis, name);
      if (!constructor || !own(constructor, "value") || typeof constructor.value !== "function") return null;
      const value = descriptor(constructor.value, "prototype")?.value;
      return typeof value === "object" && value !== null ? value : null;
    }
    function native(target, key, getter = false) {
      const d = target && descriptor(target, key);
      const f = getter ? d?.get : d?.value;
      return typeof f === "function" && includes(source(f), "[native code]") ? f : null;
    }
    const pc = prototype("RTCPeerConnection");
    const configuration = native(pc, "getConfiguration");
    const connectionState = native(pc, "connectionState", true);
    const eventTarget = prototype("EventTarget");
    const add = native(eventTarget, "addEventListener");
    const remove = native(eventTarget, "removeEventListener");
    const eventPrototype = prototype("Event");
    const eventType = native(eventPrototype, "type", true);
    const eventTargetGetter = native(eventPrototype, "target", true);
    const candidateGetter = native(prototype("RTCPeerConnectionIceEvent"), "candidate", true);
    const eventUrl = native(prototype("RTCPeerConnectionIceEvent"), "url", true);
    const candidateUrl = native(prototype("RTCIceCandidate"), "url", true);
    const errorUrl = native(prototype("RTCPeerConnectionIceErrorEvent"), "url", true);
    const captures = new WeakMapCtor();
    function installRtcCapture(runtime, onConfiguration) {
      const existing = weakGet(captures, runtime);
      if (existing) return existing;
      if (!configuration || !connectionState || !add || !remove || !eventType || !eventTargetGetter) return void 0;
      const env = runtime.visualEnv;
      let objects = new WeakMapCtor();
      let rows = [];
      let total = 0;
      let omitted = 0;
      let revision = 0;
      let estimated = 128;
      let captureLimited = false;
      let epoch = runtime.historyEpoch;
      let transportEpoch = 0;
      let timer = null;
      let stopped = false;
      let dirty = false;
      let helloTimer = null;
      let helloCount = 0;
      let helloStarted = false;
      let bridgeRequested = false;
      const detach = (entry) => {
        if (!entry.attached) return;
        const instance = deref(entry.ref);
        if (instance) for (let i = 0; i < EVENT_TYPES.length; i++) {
          try {
            apply(remove, instance, [EVENT_TYPES[i], entry.listener, true]);
          } catch {
          }
        }
        entry.attached = false;
      };
      const reset = () => {
        for (let i = 0; i < rows.length; i++) detach(rows[i]);
        rows = [];
        objects = new WeakMapCtor();
        total = 0;
        omitted = 0;
        estimated = 128;
        captureLimited = false;
        epoch = runtime.historyEpoch;
        if (timer !== null) env.clearTimeout(timer);
        timer = null;
        dirty = false;
        if (helloTimer !== null) env.clearTimeout(helloTimer);
        helloTimer = null;
        helloCount = 0;
        helloStarted = false;
        bridgeRequested = false;
        revision = min(MAX, revision + 1);
      };
      const active = () => {
        if (valueCaptureDenied(runtime)) return false;
        if (epoch !== runtime.historyEpoch) reset();
        return !stopped && runtime.hooks.enabled;
      };
      const snapshot = () => {
        if (valueCaptureDenied(runtime)) return { revision, total: 0, omitted: 0, captureLimited: false, connections: [] };
        const connections = [];
        for (let i = 0; i < rows.length; i++) {
          const entry = rows[i];
          const servers = [];
          for (let j = 0; j < entry.row.servers.length; j++) arrayPush(servers, { ...entry.row.servers[j] });
          arrayPush(connections, { ...entry.row, servers });
        }
        return { revision, total, omitted, captureLimited, connections };
      };
      const flush = () => {
        timer = null;
        if (!active() || !dirty || total === 0) return;
        const value = snapshot();
        if (valueCaptureDenied(runtime)) return;
        dirty = false;
        env.postMessage({ channel: RTC_DETAILS_CHANNEL, type: "rtc-snapshot", sensorBootId: runtime.sensorBootId, epoch: transportEpoch, snapshot: value });
      };
      const changed = () => {
        if (!active()) return;
        revision = min(MAX, revision + 1);
        dirty = true;
        if (timer === null && !stopped) timer = env.setTimeout(flush, RTC_LIMITS.flushMs);
      };
      const server = (entry, raw, kind) => {
        if (!active()) return;
        const endpoint = parseRtcServerUrl(raw);
        if (!endpoint) {
          entry.row.truncated = true;
          captureLimited = true;
          return;
        }
        let previous;
        for (let i = 0; i < entry.row.servers.length; i++) {
          const s = entry.row.servers[i];
          if (s.scheme === endpoint.scheme && s.host === endpoint.host && s.port === endpoint.port && s.transport === endpoint.transport) {
            previous = s;
            break;
          }
        }
        if (previous) {
          previous[kind] = true;
          return;
        }
        const cost = endpoint.host.length + 140;
        if (entry.row.servers.length >= RTC_LIMITS.maxServers || estimated + cost > RTC_LIMITS.maxBytes - 512) {
          entry.row.truncated = true;
          captureLimited = true;
          return;
        }
        estimated += cost;
        const value = { ...endpoint, configured: false, candidate: false, error: false };
        value[kind] = true;
        arrayPush(entry.row.servers, value);
      };
      const config = (instance, entry, snapshotValue) => {
        if (!active()) return;
        try {
          const raw = snapshotValue ?? apply(configuration, instance, NO_ARGS);
          if (!active()) return;
          if (typeof raw !== "object" || raw === null) throw new Error("native configuration unavailable");
          try {
            onConfiguration?.(raw);
          } catch {
            runtime.limitRtcValues();
          }
          const servers = descriptor(raw, "iceServers")?.value;
          if (servers === void 0) return;
          if (!array(servers)) throw new Error("native server list unavailable");
          const length = descriptor(servers, "length")?.value;
          if (typeof length !== "number" || !integer(length) || length < 0) throw new Error("native server list unavailable");
          if (length > RTC_LIMITS.maxServers) {
            entry.row.truncated = true;
            captureLimited = true;
          }
          for (let i = 0; i < min(length, RTC_LIMITS.maxServers); i++) {
            const item = descriptor(servers, "" + i)?.value;
            if (typeof item !== "object" || item === null) continue;
            const urls = descriptor(item, "urls")?.value;
            if (typeof urls === "string") server(entry, urls, "configured");
            else if (array(urls)) {
              const count = descriptor(urls, "length")?.value;
              if (typeof count !== "number" || !integer(count) || count < 0) continue;
              if (count > RTC_LIMITS.maxServers) {
                entry.row.truncated = true;
                captureLimited = true;
              }
              for (let j = 0; j < min(count, RTC_LIMITS.maxServers); j++) server(entry, descriptor(urls, "" + j)?.value, "configured");
            }
          }
        } catch {
          captureLimited = true;
          entry.row.truncated = true;
        }
      };
      const state = (instance, entry) => {
        if (!active()) return;
        try {
          const value = apply(connectionState, instance, NO_ARGS);
          if (value === "new" || value === "connecting" || value === "connected" || value === "disconnected" || value === "failed" || value === "closed") {
            entry.row.state = value;
            if (value === "connected") entry.row.connected = true;
          }
        } catch {
          captureLimited = true;
        }
      };
      const seen = (value, created = false, configurationValue, originalConfiguration) => {
        if (!active() || typeof value !== "object" || value === null) return void 0;
        const known = weakGet(objects, value);
        if (known !== void 0) return known ?? void 0;
        let initial;
        const reusable = runtime.visualEnv.earlyCaptureGuaranteed === true && !runtime.visualEnv.startedLate && originalConfiguration === configuration;
        try {
          initial = reusable && configurationValue !== void 0 ? configurationValue : apply(configuration, value, NO_ARGS);
        } catch {
          return void 0;
        }
        if (!active()) return void 0;
        total = min(MAX, total + 1);
        if (rows.length >= RTC_LIMITS.maxConnections || estimated + 240 > RTC_LIMITS.maxBytes - 512) {
          omitted = min(MAX, omitted + 1);
          weakSet(objects, value, null);
          changed();
          return void 0;
        }
        const row = { id: total, created, closed: false, connected: false, state: "unknown", duration: "open", configurationChanges: 0, servers: [], truncated: false };
        const entry = { row, ref: new WeakRefCtor(value), start: env.now(), attached: false, listener: () => void 0 };
        arrayPush(rows, entry);
        estimated += 240;
        weakSet(objects, value, entry);
        config(value, entry, initial);
        state(value, entry);
        if (!active()) return void 0;
        entry.listener = (event) => {
          if (!active() || !entry.attached || typeof event !== "object" || event === null) return;
          const instance = deref(entry.ref);
          if (!instance) return;
          try {
            if (apply(eventTargetGetter, event, NO_ARGS) !== instance) return;
            const trusted = descriptor(event, "isTrusted");
            if (!trusted?.get || trusted.configurable || !includes(source(trusted.get), "[native code]") || apply(trusted.get, event, NO_ARGS) !== true) return;
            const type = apply(eventType, event, NO_ARGS);
            if (type === "icecandidate") {
              let url;
              if (candidateGetter && candidateUrl) {
                const candidate = apply(candidateGetter, event, NO_ARGS);
                if (typeof candidate === "object" && candidate !== null) url = apply(candidateUrl, candidate, NO_ARGS);
              }
              if ((url === void 0 || url === null || url === "") && eventUrl) url = apply(eventUrl, event, NO_ARGS);
              if (typeof url === "string" && url.length > 0) server(entry, url, "candidate");
            } else if (type === "icecandidateerror" && errorUrl) {
              const url = apply(errorUrl, event, NO_ARGS);
              if (typeof url === "string" && url.length > 0) server(entry, url, "error");
            } else if (type === "connectionstatechange") state(instance, entry);
            changed();
          } catch {
            captureLimited = true;
            changed();
          }
        };
        try {
          for (let i = 0; i < EVENT_TYPES.length; i++) apply(add, value, [EVENT_TYPES[i], entry.listener, true]);
          entry.attached = true;
        } catch {
          captureLimited = true;
          entry.attached = true;
          detach(entry);
        }
        changed();
        startHello();
        return entry;
      };
      const hello = () => {
        helloTimer = null;
        if (!active() || helloCount >= 4 || bridgeRequested) return;
        if (epoch !== runtime.historyEpoch) {
          reset();
          return;
        }
        helloCount++;
        env.postMessage({ channel: RTC_DETAILS_CHANNEL, type: "rtc-hello", sensorBootId: runtime.sensorBootId, epoch: transportEpoch });
        if (helloCount < 4) helloTimer = env.setTimeout(hello, 500);
      };
      const startHello = () => {
        if (!active() || helloStarted || bridgeRequested) return;
        helloStarted = true;
        hello();
      };
      const onMessage = (event) => {
        try {
          if (stopped || valueCaptureDenied(runtime) || typeof event !== "object" || event === null) return;
          const message = env.readMessage(event);
          if (message.source !== env.self || typeof message.data !== "object" || message.data === null) return;
          const data = message.data;
          const channel = descriptor(data, "channel")?.value;
          if (channel === RTC_DETAILS_CHANNEL && descriptor(data, "sensorBootId")?.value === runtime.sensorBootId) {
            const type = descriptor(data, "type")?.value;
            if (type === "rtc-reset") {
              const next = descriptor(data, "epoch")?.value;
              if (typeof next === "number" && integer(next) && next >= 0 && next <= MAX) {
                transportEpoch = next;
                reset();
              }
            } else if (type === "rtc-request" && descriptor(data, "epoch")?.value === transportEpoch) {
              const observing = active();
              bridgeRequested = true;
              helloCount = 4;
              if (helloTimer !== null) env.clearTimeout(helloTimer);
              helloTimer = null;
              if (observing && total > 0) {
                dirty = true;
                if (timer === null) timer = env.setTimeout(flush, 0);
              }
            }
          } else if (channel === CHANNEL) {
            const type = descriptor(data, "type")?.value;
            if (type !== "bridge-pause" && type !== "bridge-stop" || descriptor(data, "sensorBootId")?.value !== runtime.sensorBootId) return;
            const checked = validateBridgeMessage(data);
            if (checked.ok && checked.value.sensorBootId === runtime.sensorBootId && (checked.value.type === "bridge-pause" || checked.value.type === "bridge-stop")) reset();
          }
        } catch {
        }
      };
      const capture = {
        seen(value, created, configurationValue, originalConfiguration) {
          seen(value, created, configurationValue, originalConfiguration);
        },
        configured(value) {
          if (!active() || typeof value !== "object" || value === null) return;
          const known = weakGet(objects, value);
          const entry = seen(value);
          if (!entry) return;
          entry.row.configurationChanges = min(MAX, entry.row.configurationChanges + 1);
          if (known) config(value, entry);
          changed();
        },
        closed(value) {
          const entry = seen(value);
          if (!entry || entry.row.closed) return;
          entry.row.closed = true;
          entry.row.state = "closed";
          const ms = env.now() - entry.start;
          entry.row.duration = !entry.row.created || !finite(ms) || ms < 0 ? "unknown" : ms < 1e3 ? "under-1s" : ms < 1e4 ? "1-10s" : "10s-plus";
          detach(entry);
          changed();
        }
      };
      weakSet(captures, runtime, capture);
      onValueCaptureDenied(runtime, reset);
      if (!valueCaptureDenied(runtime)) {
        env.addEventListener("message", onMessage);
        env.addEventListener("pagehide", flush);
      }
      runtime.onStop(() => {
        stopped = true;
        reset();
        if (helloTimer !== null) env.clearTimeout(helloTimer);
        env.removeEventListener("message", onMessage);
        env.removeEventListener("pagehide", flush);
      });
      return capture;
    }
    
    return installRtcCapture;
  })();
  // ADR-066 canonical RTC details policy end

  // packages/sensors/src/rtc-values.ts
  var descriptor7 = Object.getOwnPropertyDescriptor, own5 = Object.hasOwn, array3 = Array.isArray, apply11 = Reflect.apply, functionSource4 = Function.prototype.toString, includes5 = String.prototype.includes, lower2 = String.prototype.toLowerCase, indexOf2 = String.prototype.indexOf, slice3 = String.prototype.slice, trim = String.prototype.trim, regexpExec2 = RegExp.prototype.exec, NativeNumber = Number, integer7 = Number.isSafeInteger, min2 = Math.min, NativeMap2 = Map, NativeWeakMap = WeakMap, mapGet8 = Map.prototype.get, mapSet4 = Map.prototype.set, weakGet4 = WeakMap.prototype.get, weakSet3 = WeakMap.prototype.set, mapClear3 = Map.prototype.clear, NO_ARGS4 = Object.freeze([]), MIME_TYPES = new NativeMap2(RTC_CODEC_MIME_TYPES.map((value) => [value.toLowerCase(), value]));
  function nativeRtcFunction(value) {
    return typeof value == "function" && apply11(includes5, apply11(functionSource4, value, NO_ARGS4), ["[native code]"]);
  }
  function data(value, name) {
    if (value === null || typeof value != "object" && typeof value != "function") return;
    let field2 = descriptor7(value, name);
    return field2 && own5(field2, "value") ? field2.value : void 0;
  }
  function nativeGetter2(owner, name) {
    let prototype3 = data(data(globalThis, owner), "prototype"), value = prototype3 && descriptor7(prototype3, name)?.get;
    return nativeRtcFunction(value) ? value : null;
  }
  function nativeMethod(owner, name) {
    let value = data(data(data(globalThis, owner), "prototype"), name);
    return nativeRtcFunction(value) ? value : null;
  }
  function splitFixed(value, separator, maximum) {
    let result = [], offset = 0;
    for (let index = 0; index < maximum; index++) {
      let position = apply11(indexOf2, value, [separator, offset]);
      if (arrayPush(result, apply11(slice3, value, [offset, position < 0 ? value.length : position])), position < 0) break;
      offset = position + separator.length;
    }
    return result;
  }
  var Preview = class {
    value;
    bytes = 256;
    seen = new NativeMap2();
    constructor(profile, source3 = "returned") {
      this.value = { kind: "webrtc", profile, source: source3, fields: [], truncated: !1 };
    }
    add(name, index, value) {
      if (value === void 0) return;
      if (!validRtcFieldValue(name, value) || !integer7(index) || index < 0 || index > RTC_VALUE_LIMITS.index) {
        this.value.truncated = !0;
        return;
      }
      let key = name + ":" + index;
      if (apply11(mapGet8, this.seen, [key])) return;
      let cost = 80 + name.length + (typeof value == "string" ? value.length * 6 : 32);
      if (this.value.fields.length >= RTC_VALUE_LIMITS.fields || this.bytes + cost > RTC_VALUE_LIMITS.bytes) {
        this.value.truncated = !0;
        return;
      }
      this.bytes += cost, apply11(mapSet4, this.seen, [key, !0]), arrayPush(this.value.fields, { name, index, value });
    }
    list(value, visit) {
      if (!array3(value)) {
        value !== void 0 && (this.value.truncated = !0);
        return;
      }
      let length = data(value, "length");
      if (typeof length != "number" || !integer7(length) || length < 0) {
        this.value.truncated = !0;
        return;
      }
      length > RTC_VALUE_LIMITS.index + 1 && (this.value.truncated = !0);
      for (let index = 0; index < min2(length, RTC_VALUE_LIMITS.index + 1); index++) visit(data(value, "" + index), index);
    }
  };
  function mime(value) {
    return typeof value == "string" && value.length <= 64 ? apply11(mapGet8, MIME_TYPES, [apply11(lower2, value, NO_ARGS4)]) ?? value : value;
  }
  function parameters(preview, value, index) {
    if (value === void 0 || value === "") return;
    if (typeof value != "string" || value.length > 512) {
      preview.value.truncated = !0;
      return;
    }
    let tokens = splitFixed(value, ";", 17);
    tokens.length > 16 && (preview.value.truncated = !0);
    let output = "";
    for (let position = 0; position < min2(tokens.length, 16); position++) {
      let token = apply11(trim, tokens[position], NO_ARGS4);
      if (!validRtcFieldValue("codec.parameters", token)) {
        preview.value.truncated = !0;
        continue;
      }
      output += (output ? ";" : "") + token;
    }
    output && preview.add("codec.parameters", index, output);
  }
  function codec(preview, row, index) {
    preview.add("codec.mimeType", index, mime(data(row, "mimeType"))), preview.add("codec.clockRate", index, data(row, "clockRate")), preview.add("codec.channels", index, data(row, "channels")), preview.add("codec.payloadType", index, data(row, "payloadType")), parameters(preview, data(row, "sdpFmtpLine"), index);
  }
  function fingerprints(preview, rows, certificateIndex) {
    preview.list(rows, (row, index) => {
      let algorithm = data(row, "algorithm");
      if (algorithm !== "sha-256" && algorithm !== "sha-384" && algorithm !== "sha-512") {
        preview.value.truncated = !0;
        return;
      }
      preview.add("certificate." + algorithm, certificateIndex ?? index, data(row, "value"));
    });
  }
  function previewRtcCapabilities(value) {
    let preview = new Preview("capabilities");
    return preview.list(data(value, "codecs"), (row, index) => codec(preview, row, index)), preview.list(data(value, "headerExtensions"), (row, index) => {
      preview.add("headerExtension.uri", index, data(row, "uri")), preview.add("headerExtension.id", index, data(row, "id"));
    }), preview.value;
  }
  function previewRtcDescription(value, type) {
    let preview = new Preview("description");
    if (preview.add("description.type", 0, type), typeof value != "string" || value.length > RTC_VALUE_LIMITS.sourceChars)
      return preview.value.truncated = !0, preview.value;
    let lines = splitFixed(value, `
`, RTC_VALUE_LIMITS.sourceLines + 1);
    lines.length > RTC_VALUE_LIMITS.sourceLines && (preview.value.truncated = !0);
    let media = -1, kind = "", codecIndex = 0, extensionIndex = 0, certificateIndex = 0, codecs = new NativeMap2(), match = (pattern, line) => apply11(regexpExec2, pattern, [line]);
    for (let index = 0; index < min2(lines.length, RTC_VALUE_LIMITS.sourceLines); index++) {
      let line = apply11(trim, lines[index], NO_ARGS4);
      if (line.length > 1024) {
        preview.value.truncated = !0;
        continue;
      }
      let section = match(/^m=(audio|video|application) [0-9]{1,5} ([A-Z0-9/]+) (.{1,127})$/, line);
      if (section) {
        media++, kind = section[1], preview.add("media.kind", media, kind), preview.add("media.protocol", media, section[2]), kind !== "application" && preview.add("media.payloadTypes", media, section[3]);
        continue;
      }
      let fingerprint = match(/^a=fingerprint:(sha-256|sha-384|sha-512) ([A-Fa-f0-9:]{95,191})$/, line);
      if (fingerprint) {
        preview.add("certificate." + fingerprint[1], certificateIndex++, fingerprint[2]);
        continue;
      }
      let setup = match(/^a=setup:(active|passive|actpass|holdconn)$/, line);
      if (setup) {
        preview.add("dtls.setup", min2(31, media < 0 ? 0 : media), setup[1]);
        continue;
      }
      if (media < 0 || media > RTC_VALUE_LIMITS.index) continue;
      let mapping = match(/^a=rtpmap:([0-9]{1,3}) ([A-Za-z0-9.+-]{1,40})\/([0-9]{1,6})(?:\/([0-9]{1,2}))?$/, line);
      if (mapping) {
        let slot = codecIndex++;
        apply11(mapSet4, codecs, [media + ":" + mapping[1], slot]), preview.add("codec.mediaSection", slot, media), preview.add("codec.mimeType", slot, mime(kind + "/" + mapping[2])), preview.add("codec.payloadType", slot, NativeNumber(mapping[1])), preview.add("codec.clockRate", slot, NativeNumber(mapping[3])), mapping[4] && preview.add("codec.channels", slot, NativeNumber(mapping[4]));
        continue;
      }
      let fmtp = match(/^a=fmtp:([0-9]{1,3}) (.{1,512})$/, line);
      if (fmtp) {
        let slot = apply11(mapGet8, codecs, [media + ":" + fmtp[1]]);
        slot === void 0 ? preview.value.truncated = !0 : parameters(preview, fmtp[2], slot);
        continue;
      }
      let extension = match(/^a=extmap:([0-9]{1,3})(?:\/(?:sendrecv|sendonly|recvonly|inactive))? ([^ ]{1,256})(?: .*)?$/, line);
      if (extension) {
        let slot = extensionIndex++;
        preview.add("headerExtension.mediaSection", slot, media), preview.add("headerExtension.id", slot, NativeNumber(extension[1])), preview.add("headerExtension.uri", slot, extension[2]);
        continue;
      }
      let direction = match(/^a=(sendrecv|sendonly|recvonly|inactive)$/, line);
      direction && preview.add("media.direction", media, direction[1]), line === "a=rtcp-mux" && preview.add("media.rtcpMux", media, !0);
    }
    return preview.value;
  }
  function previewRtcStats(value) {
    let preview = new Preview("stats"), type = data(value, "type");
    if (preview.add("stats.type", 0, type), type === "codec" && codec(preview, value, 0), type === "certificate" && fingerprints(preview, [{ algorithm: data(value, "fingerprintAlgorithm"), value: data(value, "fingerprint") }]), type === "inbound-rtp" || type === "outbound-rtp") {
      let properties = ["encoderImplementation", "decoderImplementation", "powerEfficientEncoder", "powerEfficientDecoder"];
      for (let index = 0; index < properties.length; index++) {
        let property = properties[index];
        preview.add("stats." + property, 0, data(value, property));
      }
    }
    return type === "transport" && preview.add("stats.dtlsState", 0, data(value, "dtlsState")), preview.value;
  }
  function previewRtcMediaSettings(value) {
    let preview = new Preview("media-settings"), properties = ["width", "height", "frameRate", "aspectRatio", "sampleRate", "sampleSize", "channelCount", "echoCancellation", "noiseSuppression", "autoGainControl"];
    for (let index = 0; index < properties.length; index++) {
      let property = properties[index];
      preview.add("media." + property, 0, data(value, property));
    }
    return preview.value;
  }
  var captures3 = new NativeWeakMap(), certificateMethods;
  function installRtcValueCapture(runtime) {
    let existing = apply11(weakGet4, captures3, [runtime]);
    if (existing) return existing;
    if (runtime.visualEnv.earlyCaptureGuaranteed !== !0 || runtime.visualEnv.startedLate) return;
    let certificateExpires = null, certificateFingerprints = null;
    try {
      certificateMethods || (certificateMethods = { expires: nativeGetter2("RTCCertificate", "expires"), fingerprints: nativeMethod("RTCCertificate", "getFingerprints") }), certificateExpires = certificateMethods.expires, certificateFingerprints = certificateMethods.fingerprints;
    } catch {
      runtime.limitRtcValues();
    }
    let generation = runtime.resultGeneration, windowAt = -1 / 0, count = 0, limited = new NativeMap2(), admit = (operation, profile, source3) => {
      if (!runtime.hooks.enabled) return !1;
      let now = runtime.visualEnv.now();
      return (generation !== runtime.resultGeneration || now - windowAt >= 1e3 || now < windowAt) && (generation = runtime.resultGeneration, windowAt = now, count = 0, apply11(mapClear3, limited, NO_ARGS4)), count++ < 32 ? !0 : (runtime.limitRtcValues(), profile === "certificate-storage" || apply11(mapGet8, limited, [operation]) || (apply11(mapSet4, limited, [operation, !0]), runtime.recordRtcValue(operation, { kind: "webrtc", profile, source: source3, fields: [], truncated: !0 })), !1);
    }, certificate = (preview, value, index) => {
      if (!certificateExpires || !certificateFingerprints) return !1;
      let expires;
      try {
        expires = apply11(certificateExpires, value, NO_ARGS4);
      } catch {
        return !1;
      }
      preview.add("certificate.expires", index, expires);
      try {
        fingerprints(preview, apply11(certificateFingerprints, value, NO_ARGS4), index);
      } catch {
        preview.value.truncated = !0;
      }
      return !0;
    }, configuration2 = (raw, source3) => {
      let operation = source3 === "returned" ? "RTCPeerConnection.getConfiguration" : "RTCPeerConnection.configurationSnapshot";
      if (!admit(operation, "configuration", source3)) return;
      let preview = new Preview("configuration", source3), properties = ["bundlePolicy", "iceTransportPolicy", "rtcpMuxPolicy", "iceCandidatePoolSize"];
      for (let position = 0; position < properties.length; position++) {
        let property = properties[position];
        preview.add("configuration." + property, 0, data(raw, property));
      }
      let certificates = data(raw, "certificates");
      if (array3(certificates)) {
        let length = data(certificates, "length");
        if (preview.add("configuration.certificates", 0, length), source3 === "native-snapshot") {
          typeof length == "number" && length > 4 && (preview.value.truncated = !0);
          for (let index = 0; typeof length == "number" && index < min2(length, 4); index++)
            certificate(preview, data(certificates, "" + index), index) || (preview.value.truncated = !0);
        }
      }
      runtime.recordRtcValue(operation, preview.value);
    }, capture = {
      returned(operation, value, args) {
        let profile = rtcValueProfile(operation);
        if (!profile || profile === "certificate-storage") return !1;
        if (profile === "configuration")
          return configuration2(value, "returned"), !0;
        if (!admit(operation, profile, "returned")) return !0;
        let preview;
        if (profile === "capabilities") preview = previewRtcCapabilities(value);
        else if (profile === "certificate") {
          let result = new Preview("certificate");
          fingerprints(result, value), preview = result.value;
        } else profile === "description" ? preview = operation === "RTCSessionDescription.sdp" ? previewRtcDescription(value) : previewRtcDescription(data(value, "sdp"), data(value, "type")) : profile === "stats" ? preview = previewRtcStats(value) : preview = previewRtcMediaSettings(value);
        return runtime.recordRtcValue(operation, preview, args), !0;
      },
      configuration(value) {
        configuration2(value, "native-snapshot");
      },
      stored(operation, value, threw) {
        if (threw || value === null || typeof value != "object" || !admit(operation, "certificate-storage", "native-snapshot")) return !1;
        let preview = new Preview("certificate-storage", "native-snapshot");
        return certificate(preview, value, 0) ? (threw || (preview.add("storage.operation", 0, operation === "IDBRequest.result" ? "result" : operation === "IDBObjectStore.put" ? "put" : "add"), preview.add("storage.completion", 0, operation === "IDBRequest.result" ? "value-returned" : "request-returned"), runtime.recordRtcValue(operation, preview.value)), !0) : !1;
      }
    };
    return apply11(weakSet3, captures3, [runtime, capture]), capture;
  }

  // packages/sensors/src/webrtc.ts
  var descriptor8 = Object.getOwnPropertyDescriptor, hasOwn7 = Function.prototype.call.bind(Object.prototype.hasOwnProperty), WeakSetCtor2 = WeakSet, T_INFORMATION = TECHNIQUE_INDEX["DET-057"], P_RETURNED3 = PHASE_INDEX["returned-sync"], P_THREW3 = PHASE_INDEX["threw-sync"], P_UNSETTLED2 = PHASE_INDEX["settlement-unobserved"], S_API3 = SIGNAL_BIT["api-use"], CONNECTION_NAMES = ["RTCPeerConnection", "webkitRTCPeerConnection"], CONSTRUCTOR_OPERATION = API_OPERATION_INDEX[CONNECTION_NAMES[0]], RTC_OPERATIONS = API_OPERATION_DEFINITIONS.filter((definition) => definition[2] === "webrtc" && definition[3] !== "construct"), CANDIDATE_GETTERS = [
    "candidate",
    "sdpMid",
    "sdpMLineIndex",
    "foundation",
    "component",
    "priority",
    "address",
    "protocol",
    "port",
    "type",
    "tcpType",
    "relatedAddress",
    "relatedPort",
    "usernameFragment"
  ];
  function prototypeOf3(realm, name) {
    let constructor = descriptor8(realm, name);
    if (!constructor || !hasOwn7(constructor, "value") || typeof constructor.value != "function") return null;
    let prototype3 = descriptor8(constructor.value, "prototype");
    return prototype3 && hasOwn7(prototype3, "value") && typeof prototype3.value == "object" && prototype3.value !== null ? prototype3.value : null;
  }
  function installWebRTCSensor(runtime, realm = globalThis) {
    let results = [], skipped = [];
    if (!runtime.hooks.enabled) return { results, skipped };
    let options = { context: runtime.hooks }, seenPrototypes = new WeakSetCtor2(), values = installRtcValueCapture(runtime), details = installRtcCapture(runtime, values?.configuration), constructed = (_args, _newTarget, threw, _error, result) => {
      runtime.recordOperation(CONSTRUCTOR_OPERATION, threw ? P_THREW3 : P_RETURNED3), runtime.recordResult("RTCPeerConnection", threw ? P_THREW3 : P_RETURNED3, result), threw || details?.seen(result, !0);
    }, information = (_receiver, threw) => runtime.record(T_INFORMATION, threw ? P_THREW3 : P_RETURNED3, S_API3);
    for (let name of ["RTCRtpSender", "RTCRtpReceiver"])
      try {
        let field2 = descriptor8(realm, name);
        if (!field2 || !hasOwn7(field2, "value") || typeof field2.value != "function" || !descriptor8(field2.value, "getCapabilities")) {
          arrayPush(skipped, name + ".getCapabilities");
          continue;
        }
        let operation = name === "RTCRtpSender" ? "RTCRtpSender.getCapabilities" : "RTCRtpReceiver.getCapabilities", saved = descriptor8(field2.value, "getCapabilities"), returnedNative = !!saved && hasOwn7(saved, "value") && nativeRtcFunction(saved.value), result = wrapResultMethod(field2.value, "getCapabilities", (threw, value, args) => {
          let phase = threw ? P_THREW3 : P_RETURNED3;
          runtime.recordOperation(API_OPERATION_INDEX[operation], phase), (threw || !returnedNative || !values?.returned(operation, value, args)) && runtime.recordResult(operation, phase, value, args);
        }, options);
        arrayPush(results, result), runtime.attach([result]);
      } catch {
        runtime.addFlag("hook-failed");
      }
    let getters = (prototype3, interfaceName, keys2) => {
      for (let i = 0; i < keys2.length; i++) {
        let key = keys2[i];
        try {
          descriptor8(prototype3, key) === void 0 ? arrayPush(skipped, interfaceName + "." + key) : arrayPush(results, wrapGetter(prototype3, key, information, options));
        } catch {
          runtime.addFlag("hook-failed");
        }
      }
    }, operationHook = (target, member, operation, kind) => {
      let saved = descriptor8(target, member);
      if (!saved) {
        arrayPush(skipped, operation);
        return;
      }
      let original = hasOwn7(saved, kind === "get" ? "get" : "value") ? kind === "get" ? saved.get : saved.value : void 0, returnedNative = nativeRtcFunction(original), storage = operation === "IDBObjectStore.put" || operation === "IDBObjectStore.add" || operation === "IDBRequest.result", connection = operation.startsWith("RTCPeerConnection."), observe = (receiver, args, threw, result2) => {
        let phase = threw ? P_THREW3 : kind === "async-call" ? P_UNSETTLED2 : P_RETURNED3;
        if (storage) {
          returnedNative && values?.stored(operation, operation === "IDBRequest.result" ? result2 : args.length > 0 ? args[0] : void 0, threw) && runtime.recordOperation(API_OPERATION_INDEX[operation], phase);
          return;
        }
        runtime.recordOperation(API_OPERATION_INDEX[operation], phase), (threw || kind === "async-call" || !returnedNative || !values?.returned(operation, result2)) && runtime.recordResult(operation, phase, result2, args), !threw && connection && (member === "close" ? details?.closed(receiver) : member === "setConfiguration" ? details?.configured(receiver) : member === "getConfiguration" && returnedNative ? details?.seen(receiver, !1, result2, original) : kind !== "get" && details?.seen(receiver));
      }, result = kind === "get" ? wrapGetter(target, member, (receiver, threw, _error, value) => observe(receiver, [], threw, value), options) : wrapMethod(target, member, (receiver, args, threw, _error, value) => observe(receiver, args, threw, value), options);
      arrayPush(results, result), runtime.attach([result]);
    };
    for (let i = 0; i < CONNECTION_NAMES.length; i++) {
      let name = CONNECTION_NAMES[i];
      try {
        let prototype3 = prototypeOf3(realm, name);
        if (prototype3 === null) {
          arrayPush(skipped, name);
          continue;
        }
        let constructor = descriptor8(realm, name)?.value;
        if (i === 0 && descriptor8(constructor, "generateCertificate") && operationHook(constructor, "generateCertificate", "RTCPeerConnection.generateCertificate", "async-call"), arrayPush(results, wrapConstructor(realm, name, constructed, options)), weakSetHas(seenPrototypes, prototype3)) continue;
        weakSetAdd(seenPrototypes, prototype3);
        for (let index = 0; index < RTC_OPERATIONS.length; index++) {
          let [operation, , , kind] = RTC_OPERATIONS[index];
          if (!(!operation.startsWith("RTCPeerConnection.") || operation === "RTCPeerConnection.generateCertificate"))
            try {
              operationHook(prototype3, operation.slice(18), operation, kind);
            } catch {
              runtime.addFlag("hook-failed");
            }
        }
      } catch {
        runtime.addFlag("hook-failed");
      }
    }
    for (let index = 0; index < RTC_OPERATIONS.length; index++) {
      let [operation, , , kind] = RTC_OPERATIONS[index];
      if (operation.startsWith("RTCPeerConnection.")) continue;
      let separator = operation.indexOf(".");
      try {
        let prototype3 = prototypeOf3(realm, operation.slice(0, separator));
        prototype3 ? operationHook(prototype3, operation.slice(separator + 1), operation, kind) : arrayPush(skipped, operation);
      } catch {
        runtime.addFlag("hook-failed");
      }
    }
    let informationNames = ["RTCPeerConnectionIceEvent", "RTCIceCandidate"];
    for (let i = 0; i < informationNames.length; i++) {
      let name = informationNames[i];
      try {
        let prototype3 = prototypeOf3(realm, name);
        if (prototype3 === null) {
          arrayPush(skipped, name);
          continue;
        }
        getters(prototype3, name, name === "RTCPeerConnectionIceEvent" ? ["candidate"] : CANDIDATE_GETTERS);
      } catch {
        runtime.addFlag("hook-failed");
      }
    }
    return runtime.attach(results), { results, skipped };
  }

  // packages/sensors/src/screen-events.ts
  var WeakMapCtor5 = WeakMap, get2 = Function.prototype.call.bind(WeakMap.prototype.get), set2 = Function.prototype.call.bind(WeakMap.prototype.set), remove2 = Function.prototype.call.bind(WeakMap.prototype.delete), targets2 = new WeakMapCtor5();
  function rememberScreenTarget(runtime, receiver, kind) {
    if (typeof receiver != "object" || receiver === null) return;
    let state = get2(targets2, runtime);
    if (state || (state = { count: 0, receivers: new WeakMapCtor5() }, set2(targets2, runtime, state), runtime.onStop(() => remove2(targets2, runtime))), get2(state.receivers, receiver) === void 0) {
      if (state.count >= 128) {
        runtime.addFlag("budget-exceeded");
        return;
      }
      state.count++, set2(state.receivers, receiver, kind);
    }
  }
  function screenEventOperation(runtime, receiver, type, adding) {
    if (typeof receiver != "object" || receiver === null) return null;
    let state = get2(targets2, runtime), kind = state ? get2(state.receivers, receiver) : void 0;
    return kind === "Screen" && type === "change" ? adding ? "Screen.addEventListener" : "Screen.removeEventListener" : kind === "ScreenDetails" && (type === "screenschange" || type === "currentscreenchange") ? adding ? "ScreenDetails.addEventListener" : "ScreenDetails.removeEventListener" : null;
  }

  // packages/sensors/src/environment.ts
  var descriptor9 = Object.getOwnPropertyDescriptor, hasOwn8 = Function.prototype.call.bind(Object.prototype.hasOwnProperty), RETURNED = PHASE_INDEX["returned-sync"], THREW = PHASE_INDEX["threw-sync"], UNSETTLED = PHASE_INDEX["settlement-unobserved"], API_USE = SIGNAL_BIT["api-use"];
  function dataObject(owner, name) {
    let value = descriptor9(owner, name);
    return !value || !hasOwn8(value, "value") ? null : value.value !== null && (typeof value.value == "object" || typeof value.value == "function") ? value.value : null;
  }
  function installEnvironmentSensor(runtime, realm = globalThis) {
    let results = [], skipped = [];
    if (!runtime.hooks.enabled) return { results, skipped };
    let options = { context: runtime.hooks }, object = (owner, name) => {
      try {
        let result = dataObject(owner, name);
        if (result === null) {
          arrayPush(skipped, name);
          let d = descriptor9(owner, name);
          d && !hasOwn8(d, "value") && runtime.addFlag("hook-failed");
        }
        return result;
      } catch {
        return runtime.addFlag("hook-failed"), null;
      }
    }, prototype3 = (owner, name) => {
      let constructor = object(owner, name);
      return constructor === null ? null : object(constructor, "prototype");
    }, getters = (target, name, keys2, id) => {
      if (target === null) return;
      let technique = TECHNIQUE_INDEX[id];
      for (let i = 0; i < keys2.length; i++) {
        let key = keys2[i];
        try {
          let d = descriptor9(target, key);
          if (!d) {
            arrayPush(skipped, name + "." + key);
            continue;
          }
          if (hasOwn8(d, "value")) {
            arrayPush(skipped, name + "." + key), d.configurable || runtime.addFlag("descriptor-nonconfigurable");
            continue;
          }
          let label = name + "." + key, operation = API_OPERATION_INDEX[label], handle = wrapGetter(target, key, (receiver, threw, _error, result) => {
            operation === void 0 ? runtime.record(technique, threw ? THREW : RETURNED, API_USE) : runtime.recordOperation(operation, threw ? THREW : RETURNED), runtime.recordResult(label, threw ? THREW : RETURNED, result), threw || ((name === "Screen" || name === "ScreenDetailed") && rememberScreenTarget(runtime, receiver, "Screen"), name === "ScreenDetails" && (rememberScreenTarget(runtime, receiver, "ScreenDetails"), key === "currentScreen" && rememberScreenTarget(runtime, result, "Screen")));
          }, options);
          arrayPush(results, handle), runtime.attach([handle]);
        } catch {
          runtime.addFlag("hook-failed");
        }
      }
    }, method = (target, name, key, id, asynchronous = !1) => {
      if (target === null) return;
      let technique = TECHNIQUE_INDEX[id];
      try {
        if (!descriptor9(target, key)) {
          arrayPush(skipped, name + "." + key);
          return;
        }
        let label = name + "." + key, operation = API_OPERATION_INDEX[label], handle = wrapResultMethod(target, key, (threw, result, args) => {
          let phase = threw ? THREW : asynchronous ? UNSETTLED : RETURNED;
          operation === void 0 ? runtime.record(technique, phase, API_USE) : runtime.recordOperation(operation, phase), runtime.recordResult(label, phase, result, args);
        }, options);
        arrayPush(results, handle), runtime.attach([handle]);
      } catch {
        runtime.addFlag("hook-failed");
      }
    }, navigator = prototype3(realm, "Navigator");
    getters(navigator, "Navigator", [
      "userAgent",
      "platform",
      "vendor",
      "language",
      "languages",
      "appVersion",
      "appName",
      "appCodeName",
      "product",
      "productSub",
      "vendorSub"
    ], "DET-025"), getters(navigator, "Navigator", ["userAgentData"], "DET-026");
    let ua = prototype3(realm, "NavigatorUAData");
    getters(ua, "NavigatorUAData", ["brands", "mobile", "platform"], "DET-026"), method(ua, "NavigatorUAData", "toJSON", "DET-026"), method(ua, "NavigatorUAData", "getHighEntropyValues", "DET-026", !0), getters(navigator, "Navigator", ["plugins", "mimeTypes", "pdfViewerEnabled"], "DET-027"), getters(navigator, "Navigator", ["webdriver"], "DET-028");
    let screen = prototype3(realm, "Screen");
    try {
      let screenDescriptor = descriptor9(realm, "screen");
      if (screenDescriptor && hasOwn8(screenDescriptor, "get") && typeof screenDescriptor.get == "function") {
        let handle = wrapGetter(realm, "screen", (_receiver, threw, _error, result) => {
          threw || rememberScreenTarget(runtime, result, "Screen");
        }, options);
        arrayPush(results, handle), runtime.attach([handle]);
      }
    } catch {
      runtime.addFlag("hook-failed");
    }
    getters(screen, "Screen", ["width", "height", "availWidth", "availHeight", "colorDepth", "pixelDepth", "orientation"], "DET-029"), getters(prototype3(realm, "ScreenOrientation"), "ScreenOrientation", ["angle", "type"], "DET-029"), getters(realm, "Window", ["innerWidth", "innerHeight", "outerWidth", "outerHeight", "screenX", "screenY", "screenLeft", "screenTop", "devicePixelRatio", "visualViewport"], "DET-030"), getters(prototype3(realm, "VisualViewport"), "VisualViewport", ["offsetLeft", "offsetTop", "pageLeft", "pageTop", "width", "height", "scale"], "DET-030"), getters(screen, "Screen", ["isExtended", "availLeft", "availTop"], "DET-031"), method(realm, "Window", "getScreenDetails", "DET-031", !0);
    let screenDetails = prototype3(realm, "ScreenDetails");
    getters(screenDetails, "ScreenDetails", ["screens", "currentScreen"], "DET-031"), getters(prototype3(realm, "ScreenDetailed"), "ScreenDetailed", [
      "left",
      "top",
      "devicePixelRatio",
      "label",
      "isPrimary",
      "isInternal"
    ], "DET-031");
    for (let key of ["open", "moveTo", "moveBy", "resizeTo", "resizeBy"]) method(realm, "Window", key, "DET-031");
    method(prototype3(realm, "Element"), "Element", "requestFullscreen", "DET-031", !0), method(prototype3(realm, "Document"), "Document", "exitFullscreen", "DET-031", !0);
    for (let [target, name, keys2] of [
      [screen, "Screen", ["onchange"]],
      [screenDetails, "ScreenDetails", ["onscreenschange", "oncurrentscreenchange"]]
    ])
      if (target)
        for (let key of keys2)
          try {
            if (!descriptor9(target, key)) {
              arrayPush(skipped, name + "." + key);
              continue;
            }
            let operation = API_OPERATION_INDEX[name + "." + key], handle = wrapSetter(target, key, (receiver, _args, threw, _error, result) => {
              runtime.recordOperation(operation, threw ? THREW : RETURNED), runtime.recordResult(name + "." + key, threw ? THREW : RETURNED, result), threw || rememberScreenTarget(runtime, receiver, name);
            }, options);
            arrayPush(results, handle), runtime.attach([handle]);
          } catch {
            runtime.addFlag("hook-failed");
          }
    getters(navigator, "Navigator", ["hardwareConcurrency"], "DET-032"), getters(navigator, "Navigator", ["deviceMemory"], "DET-033"), getters(navigator, "Navigator", ["maxTouchPoints"], "DET-034"), method(prototype3(realm, "Date"), "Date", "getTimezoneOffset", "DET-035");
    let intl = object(realm, "Intl");
    if (intl !== null) {
      let names2 = ["Collator", "DateTimeFormat", "NumberFormat", "PluralRules", "RelativeTimeFormat", "ListFormat", "Segmenter", "DisplayNames"];
      for (let i = 0; i < names2.length; i++) method(prototype3(intl, names2[i]), "Intl." + names2[i], "resolvedOptions", "DET-036");
    }
    method(realm, "Window", "matchMedia", "DET-037"), method(object(realm, "CSS"), "CSS", "supports", "DET-038"), method(navigator, "Navigator", "getBattery", "DET-040", !0), getters(prototype3(realm, "BatteryManager"), "BatteryManager", ["charging", "chargingTime", "dischargingTime", "level"], "DET-040"), getters(navigator, "Navigator", ["connection"], "DET-041"), getters(prototype3(realm, "NetworkInformation"), "NetworkInformation", ["type", "effectiveType", "rtt", "downlink", "downlinkMax", "saveData"], "DET-041");
    for (let name of ["PressureObserver", "IdleDetector"])
      try {
        if (object(realm, name) !== null) {
          let handle = wrapConstructor(realm, name, (_args, _newTarget, threw, _error, result) => {
            runtime.recordOperation(API_OPERATION_INDEX[name], threw ? THREW : RETURNED), runtime.recordResult(name, threw ? THREW : RETURNED, result);
          }, options);
          arrayPush(results, handle), runtime.attach([handle]);
        }
      } catch {
        runtime.addFlag("hook-failed");
      }
    getters(object(realm, "PressureObserver"), "PressureObserver", ["knownSources"], "DET-042");
    let pressure = prototype3(realm, "PressureObserver");
    method(pressure, "PressureObserver", "observe", "DET-042", !0);
    for (let key of ["unobserve", "disconnect", "takeRecords"]) method(pressure, "PressureObserver", key, "DET-042");
    getters(prototype3(realm, "PressureRecord"), "PressureRecord", ["source", "state", "time"], "DET-042"), method(prototype3(realm, "PressureRecord"), "PressureRecord", "toJSON", "DET-042"), method(object(realm, "IdleDetector"), "IdleDetector", "requestPermission", "DET-043", !0);
    let idle = prototype3(realm, "IdleDetector");
    return method(idle, "IdleDetector", "start", "DET-043", !0), getters(idle, "IdleDetector", ["userState", "screenState"], "DET-043"), runtime.attach(results), { results, skipped };
  }

  // packages/sensors/src/extension-resource.ts
  var NativeURL = URL, apply12 = Reflect.apply, startsWith2 = String.prototype.startsWith, regexpExec3 = RegExp.prototype.exec, idPattern = /^[a-p]{32}$/, protocol = Object.getOwnPropertyDescriptor(NativeURL.prototype, "protocol").get, hostname = Object.getOwnPropertyDescriptor(NativeURL.prototype, "hostname").get, username = Object.getOwnPropertyDescriptor(NativeURL.prototype, "username").get, password = Object.getOwnPropertyDescriptor(NativeURL.prototype, "password").get, port = Object.getOwnPropertyDescriptor(NativeURL.prototype, "port").get;
  function extensionResourceId(input) {
    if (typeof input != "string" || input.length > 4096 || !apply12(startsWith2, input, ["chrome-extension://"])) return null;
    try {
      let parsed = new NativeURL(input), id = apply12(hostname, parsed, []);
      return apply12(protocol, parsed, []) === "chrome-extension:" && !apply12(username, parsed, []) && !apply12(password, parsed, []) && !apply12(port, parsed, []) && apply12(regexpExec3, idPattern, [id]) !== null ? id : null;
    } catch {
      return null;
    }
  }

  // packages/sensors/src/browser-requests.ts
  var descriptor10 = Object.getOwnPropertyDescriptor, own6 = Function.prototype.call.bind(Object.prototype.hasOwnProperty), FETCH_METHOD_INDEX = EXTENSION_RESOURCE_METHODS.indexOf("fetch"), NativeWeakMap2 = WeakMap, weakGet5 = Function.prototype.call.bind(WeakMap.prototype.get), weakSet4 = Function.prototype.call.bind(WeakMap.prototype.set), weakDelete = Function.prototype.call.bind(WeakMap.prototype.delete);
  function objectReceiver(receiver) {
    return receiver !== null && (typeof receiver == "object" || typeof receiver == "function");
  }
  function targetIndex(input) {
    let id = extensionResourceId(input);
    return id === null ? null : extensionTargetIndex(id) ?? 0;
  }
  function dataObject2(target, key) {
    let field2 = descriptor10(target, key);
    if (!field2 || !own6(field2, "value")) return null;
    let value = field2.value;
    return typeof value == "object" && value !== null || typeof value == "function" ? value : null;
  }
  function installBrowserRequestSensor(runtime, realm = globalThis) {
    let results = [], skipped = [];
    if (!runtime.hooks.enabled) return { results, skipped };
    let options = { context: runtime.hooks }, visual = visualCaptureFor(runtime), attach = (result) => {
      arrayPush(results, result), runtime.attach([result]);
    }, method = (target, key, id, label, asynchronous = !0) => {
      if (!descriptor10(target, key)) {
        arrayPush(skipped, key);
        return;
      }
      let technique = TECHNIQUE_INDEX[id], phase = PHASE_INDEX[asynchronous ? "settlement-unobserved" : "returned-sync"], operation = API_OPERATION_INDEX[label];
      attach(wrapResultMethod(target, key, (threw, result, args) => {
        runtime.observeBackgroundOperation?.(label, args, threw);
        label === "Navigator.sendBeacon" && runtime.observeSocialBeacon?.(args, threw);
        operation === void 0 ? runtime.record(technique, threw ? PHASE_INDEX["threw-sync"] : phase, SIGNAL_BIT["api-use"]) : runtime.recordOperation(operation, threw ? PHASE_INDEX["threw-sync"] : phase), runtime.recordResult(label, threw ? PHASE_INDEX["threw-sync"] : phase, result, args);
      }, options));
    }, family = (name, id, methods, asynchronous = !0, staticMethods = !1) => {
      try {
        let constructor = dataObject2(realm, name), target = constructor && (staticMethods ? constructor : dataObject2(constructor, "prototype"));
        if (!target) {
          arrayPush(skipped, name);
          return;
        }
        for (let key of typeof methods == "string" ? [methods] : methods)
          try {
            method(target, key, id, name + "." + key, asynchronous);
          } catch {
            runtime.addFlag("hook-failed");
          }
      } catch {
        runtime.addFlag("hook-failed");
      }
    };
    family("Geolocation", "DET-044", ["getCurrentPosition", "watchPosition"]), family("Bluetooth", "DET-045", ["getAvailability", "getDevices", "requestDevice"]), family("USB", "DET-046", ["getDevices", "requestDevice"]), family("HID", "DET-046", ["getDevices", "requestDevice"]), family("Serial", "DET-046", ["getPorts", "requestPort"]), family("Navigator", "DET-047", ["getGamepads"], !1), family("XRSystem", "DET-048", ["isSessionSupported", "requestSession"]), family("CookieStore", "DET-049", ["get", "getAll", "set", "delete"]);
    try {
      let constructor = dataObject2(realm, "Document"), target = constructor && dataObject2(constructor, "prototype");
      target && descriptor10(target, "cookie") ? attach(wrapGetter(target, "cookie", (_receiver, threw) => {
        runtime.recordOperation(API_OPERATION_INDEX["Document.cookie.get"], PHASE_INDEX[threw ? "threw-sync" : "returned-sync"]), runtime.recordResult("Document.cookie", PHASE_INDEX[threw ? "threw-sync" : "returned-sync"], void 0);
      }, { ...options, observeSetter(receiver, args, threw) {
        runtime.recordOperation(API_OPERATION_INDEX["Document.cookie.set"], PHASE_INDEX[threw ? "threw-sync" : "returned-sync"]);
        runtime.observeCookieWrite?.(receiver, args, threw);
      } })) : arrayPush(skipped, "Document.cookie");
    } catch {
      runtime.addFlag("hook-failed");
    }
    family("Storage", "DET-050", ["getItem", "setItem", "removeItem", "clear", "key"], !1), family("IDBFactory", "DET-051", ["open", "deleteDatabase", "databases"]), family("CacheStorage", "DET-052", ["open", "match", "has", "delete", "keys"]), family("Cache", "DET-052", ["match", "matchAll", "add", "addAll", "put", "delete", "keys"]), family("StorageManager", "DET-053", ["estimate", "persist", "persisted"]), family("Document", "DET-054", ["hasStorageAccess", "requestStorageAccess", "hasUnpartitionedCookieAccess", "requestStorageAccessFor"]);
    let recordRequest = (target, methodIndex, threw, reference = !1) => {
      let phase = PHASE_INDEX[threw ? "threw-sync" : reference ? "returned-sync" : "settlement-unobserved"];
      target === null ? reference || runtime.record(TECHNIQUE_INDEX["DET-059"], phase, SIGNAL_BIT["api-use"]) : runtime.recordExtensionResource(target, methodIndex, phase);
    };
    try {
      descriptor10(realm, "fetch") ? attach(wrapMethod(realm, "fetch", (_receiver, args, threw) => {
        recordRequest(targetIndex(args.length > 0 ? args[0] : void 0), FETCH_METHOD_INDEX, threw), runtime.observeSocialFetch?.(args, threw), runtime.recordResult("Window.fetch", PHASE_INDEX[threw ? "threw-sync" : "settlement-unobserved"], void 0);
      }, options)) : arrayPush(skipped, "fetch");
    } catch {
      runtime.addFlag("hook-failed");
    }
    let requests = new NativeWeakMap2(), epoch = runtime.historyEpoch, admissions = 0, reset = () => {
      requests = new NativeWeakMap2(), epoch = runtime.historyEpoch, admissions = 0;
    };
    runtime.onStop(reset);
    try {
      let constructor = dataObject2(realm, "XMLHttpRequest"), target = constructor && dataObject2(constructor, "prototype");
      target ? (descriptor10(target, "open") ? attach(wrapPreparedMethod(target, "open", (receiver, args) => {
        if (epoch !== runtime.historyEpoch && reset(), !objectReceiver(receiver)) return null;
        let previous = weakGet5(requests, receiver);
        weakDelete(requests, receiver);
        let candidate = targetIndex(args[1]);
        if (candidate === null) return null;
        if (previous === void 0 && admissions >= 512)
          return runtime.addFlag("budget-exceeded"), null;
        previous === void 0 && admissions++;
        let state = { epoch, candidate, target: null };
        return weakSet4(requests, receiver, state), state;
      }, (state, receiver, _args, threw) => {
        runtime.observeSocialXhrOpen?.(receiver, _args, threw);
        !state || !objectReceiver(receiver) || weakGet5(requests, receiver) !== state || (threw || state.epoch !== runtime.historyEpoch ? weakDelete(requests, receiver) : state.target = state.candidate);
      }, options)) : arrayPush(skipped, "XMLHttpRequest.open"), descriptor10(target, "send") ? attach(wrapPreparedMethod(target, "send", (receiver) => objectReceiver(receiver) ? weakGet5(requests, receiver) : void 0, (state, _receiver, _args, threw) => {
        runtime.observeSocialXhrSend?.(_receiver, threw);
        recordRequest(state?.epoch === runtime.historyEpoch ? state.target : null, EXTENSION_METHOD_INDEX["xhr-send"], threw);
      }, options)) : arrayPush(skipped, "XMLHttpRequest.send")) : arrayPush(skipped, "XMLHttpRequest");
    } catch {
      runtime.addFlag("hook-failed");
    }
    for (let [name, methodIndex] of [["HTMLImageElement", EXTENSION_METHOD_INDEX["image-src"]], ["HTMLScriptElement", EXTENSION_METHOD_INDEX["script-src"]]])
      try {
        let constructor = dataObject2(realm, name), target = constructor && dataObject2(constructor, "prototype");
        target && descriptor10(target, "src") ? attach(wrapSetter(target, "src", (receiver, args, threw) => {
          recordRequest(targetIndex(args[0]), methodIndex, threw, !0), runtime.observeSocialSource?.(name, receiver, args, threw), name === "HTMLScriptElement" && runtime.observeLoaderScriptSource?.(receiver, args, threw), !threw && name === "HTMLImageElement" && visual?.imageSource(receiver, args[0]);
        }, options)) : arrayPush(skipped, name + ".src");
      } catch {
        runtime.addFlag("hook-failed");
      }
    return family("Navigator", "DET-059", "sendBeacon", !1), family("CredentialsContainer", "DET-059", "get"), family("ServiceWorkerContainer", "DET-063", ["register", "getRegistration", "getRegistrations"]), family("PublicKeyCredential", "DET-069", ["isUserVerifyingPlatformAuthenticatorAvailable", "isConditionalMediationAvailable", "getClientCapabilities"], !0, !0), { results, skipped };
  }

  // packages/sensors/src/timing.ts
  var descriptor11 = Object.getOwnPropertyDescriptor, hasOwn9 = Function.prototype.call.bind(Object.prototype.hasOwnProperty), TECHNIQUE = TECHNIQUE_INDEX["DET-066"], API = SIGNAL_BIT["api-use"], RETURNED2 = PHASE_INDEX["returned-sync"], THREW2 = PHASE_INDEX["threw-sync"];
  function dataObject3(owner, key) {
    let d = descriptor11(owner, key);
    if (!d || !hasOwn9(d, "value")) return null;
    let value = d.value;
    return typeof value == "object" && value !== null || typeof value == "function" ? value : null;
  }
  function installTimingSensor(runtime, realm = globalThis) {
    let results = [], skipped = [];
    if (!runtime.hooks.enabled) return { results, skipped };
    let method = (target, name, sampled) => {
      try {
        if (!descriptor11(target, name)) {
          arrayPush(skipped, name);
          return;
        }
        let returned = 0, thrown = 0, result = wrapOutcomeMethod(target, name, (threw) => {
          if (sampled) {
            if (threw) {
              let take = thrown === 0;
              if (thrown = thrown + 1 & 63, !take) return;
            } else {
              let take = returned === 0;
              if (returned = returned + 1 & 63, !take) return;
            }
            runtime.recordSampled(TECHNIQUE, threw ? THREW2 : RETURNED2, API);
          } else runtime.record(TECHNIQUE, threw ? THREW2 : RETURNED2, API);
        }, { context: runtime.hooks });
        arrayPush(results, result), runtime.attach([result]);
      } catch {
        runtime.addFlag("hook-failed");
      }
    };
    try {
      let constructor = dataObject3(realm, "Performance"), prototype3 = constructor && dataObject3(constructor, "prototype");
      if (prototype3) {
        method(prototype3, "now", !0);
        for (let name of ["mark", "measure", "getEntries", "getEntriesByName", "getEntriesByType"]) method(prototype3, name, !1);
      } else arrayPush(skipped, "Performance");
    } catch {
      runtime.addFlag("hook-failed");
    }
    try {
      let constructor = dataObject3(realm, "Date");
      constructor ? method(constructor, "now", !0) : arrayPush(skipped, "Date");
    } catch {
      runtime.addFlag("hook-failed");
    }
    return { results, skipped };
  }

  // packages/sensors/src/wasm.ts
  var webAssemblyObserverSupport = (function createWebAssemblyObserverSupport(registry, surfaces) {
  const apply = Reflect.apply, descriptor = Object.getOwnPropertyDescriptor, define = Object.defineProperty;
  const prototypeOf = Object.getPrototypeOf, setPrototypeOf = Object.setPrototypeOf, own = Object.hasOwn;
  const NativeWeakMap = WeakMap, NativeWeakSet = WeakSet;
  const NativeWeakRef = typeof WeakRef === 'function' ? WeakRef : null;
  const deref = NativeWeakRef && NativeWeakRef.prototype.deref;
  const weakGet = WeakMap.prototype.get, weakSet = WeakMap.prototype.set;
  const setHas = WeakSet.prototype.has, setAdd = WeakSet.prototype.add;
  const states = new NativeWeakMap();
  const legacy = new Set(['WebAssembly.compile', 'WebAssembly.instantiate', 'WebAssembly.compileStreaming', 'WebAssembly.instantiateStreaming', 'WebAssembly.validate', 'WebAssembly.Module', 'WebAssembly.Instance', 'WebAssembly.Memory', 'WebAssembly.Memory.grow', 'WebAssembly.Memory.buffer']);
  const legacyHas = Set.prototype.has;
  const functionSource = Function.prototype.toString, includes = String.prototype.includes;
  const nativeFunction = value => typeof value === 'function' && apply(includes, apply(functionSource, value, []), ['[native code]']);
  let notifying = false;
  const append = (array, value) => define(array, array.length, { __proto__: null, value, writable: true, configurable: true, enumerable: true });
  const data = (object, key) => {
    if (object === null || typeof object !== 'object' && typeof object !== 'function') return undefined;
    const field = descriptor(object, key);
    return field && own(field, 'value') ? field.value : undefined;
  };
  function observerError(runtime) {
    const context = runtime.hooks;
    if (context.observerErrors < 2147483647) context.observerErrors++;
    try { context.onObserverError?.(); } catch { /* Never replace a native exception. */ }
  }
  function count(runtime, operation, phase) {
    if (runtime.hooks.enabled) runtime.recordOperation(operation, phase);
  }
  function copyMeta(wrapper, original) {
    setPrototypeOf(wrapper, prototypeOf(original));
    for (const name of ['name', 'length']) {
      const field = descriptor(original, name);
      if (field && own(field, 'value')) define(wrapper, name, field);
    }
    return wrapper;
  }
  // Global.value owns both slots. Installing independent getter/setter handles would lose ownership.
  // Concise methods retain native accessor non-constructibility, including borrowed setter calls.
  function accessor(runtime, target, property, getOperation, setOperation) {
    const previous = descriptor(target, property);
    if (!previous || previous.configurable !== true) return { status: 'unsupported', kind: 'getter', target, key: property, label: property,
      reason: previous ? 'non-configurable' : 'missing', coverageFlag: previous ? 'descriptor-nonconfigurable' : 'hook-failed' };
    const originalGet = previous.get, originalSet = previous.set;
    function invoke(original, receiver, args, operation) {
      let value, error, threw = false;
      try { value = apply(original, receiver, args); } catch (caught) { error = caught; threw = true; }
      if (operation !== undefined && runtime.hooks.enabled && !notifying) {
        notifying = true;
        try { count(runtime, operation, registry.phaseIndex[threw ? 'threw-sync' : 'returned-sync']); }
        catch { observerError(runtime); }
        finally { notifying = false; }
      }
      if (threw) throw error;
      return value;
    }
    const callbacks = {
      get() { return invoke(originalGet, this, arguments, getOperation); },
      set(value) { return invoke(originalSet, this, arguments, setOperation); }
    };
    const next = { ...previous };
    if (typeof originalGet === 'function' && getOperation !== undefined) next.get = copyMeta(callbacks.get, originalGet);
    if (typeof originalSet === 'function' && setOperation !== undefined) next.set = copyMeta(callbacks.set, originalSet);
    define(target, property, next);
    const isOwned = () => {
      const current = descriptor(target, property);
      return !!current && current.get === next.get && current.set === next.set;
    };
    return { status: 'installed', kind: 'getter', target, key: property, label: property, isOwned,
      restore() { if (!isOwned()) return false; try { define(target, property, previous); return true; } catch { return false; } }
    };
  }
  function constructorAlias(original, replacement) {
    const prototype = data(original, 'prototype');
    if (prototype === null || typeof prototype !== 'object') return null;
    const previous = descriptor(prototype, 'constructor');
    // Do not rewrite a page-supplied alias, inherited property or frozen prototype.
    if (!previous || previous.configurable !== true || !own(previous, 'value') || previous.value !== original) return null;
    define(prototype, 'constructor', { ...previous, value: replacement });
    const isOwned = () => descriptor(prototype, 'constructor')?.value === replacement;
    return { status: 'installed', kind: 'constructor', target: prototype, key: 'constructor', label: 'constructor', isOwned,
      restore() { if (!isOwned()) return false; try { define(prototype, 'constructor', previous); return true; } catch { return false; } }
    };
  }
  function createStackGetter(runtime, original, operation, active) {
    // This factory has no instance/result binding: the wrapper cannot keep an Exception alive.
    const { get } = { get() {
      let value, error, threw = false;
      try { value = apply(original, this, arguments); } catch (caught) { threw = true; error = caught; }
      if (active() && runtime.hooks.enabled && !notifying) {
        notifying = true;
        try { count(runtime, operation, registry.phaseIndex[threw ? 'threw-sync' : 'returned-sync']); }
        catch { observerError(runtime); }
        finally { notifying = false; }
      }
      if (threw) throw error;
      return value;
    } };
    return copyMeta(get, original);
  }
  function createStackTracker(runtime, operation, attach) {
    const seen = new NativeWeakSet(), ring = [];
    let cursor = 0, evicted = false, active = true, attached = false;
    const isActive = () => active;
    const handle = { status: 'installed', kind: 'getter', target: null, key: 'stack', label: 'WebAssembly.Exception.stack.instances',
      isOwned: isActive,
      restore() {
        active = false;
        let complete = !evicted;
        for (let index = 0; index < ring.length; index++) {
          const entry = ring[index], instance = apply(deref, entry.reference, []);
          if (!instance) continue;
          try {
            const current = descriptor(instance, 'stack');
            if (!current || current.get !== entry.wrapper || current.set !== entry.setter) { complete = false; continue; }
            define(instance, 'stack', { ...current, get: entry.getter });
          } catch { complete = false; }
        }
        ring.length = 0;
        return complete;
      }
    };
    return { observe(instance) {
      if (!active || !runtime.hooks.enabled || instance === null || typeof instance !== 'object' || apply(setHas, seen, [instance])) return;
      if (!NativeWeakRef) { runtime.addFlag('hook-failed'); return; }
      const field = descriptor(instance, 'stack');
      // Never read a stack getter, inspect its return or retain an own data stack string.
      if (!field) return;
      if (own(field, 'value') || field.configurable !== true || typeof field.get !== 'function') { runtime.addFlag('hook-failed'); return; }
      const wrapper = createStackGetter(runtime, field.get, operation, isActive);
      const reference = new NativeWeakRef(instance);
      define(instance, 'stack', { ...field, get: wrapper });
      apply(setAdd, seen, [instance]);
      const entry = { reference, getter: field.get, setter: field.set, wrapper };
      if (ring.length < 128) append(ring, entry);
      else { ring[cursor] = entry; cursor = (cursor + 1) % 128; evicted = true; }
      if (!attached) { attached = true; attach(handle); }
    } };
  }
  function install(runtime, realm, wrappers, nativeCheck = nativeFunction) {
    const results = [], skipped = [];
    if (!runtime.hooks.enabled) return { results, skipped };
    let state = apply(weakGet, states, [runtime]);
    if (!state) { state = { realms: new NativeWeakSet(), stack: null }; apply(weakSet, states, [runtime, state]); }
    if (apply(setHas, state.realms, [realm])) return { results, skipped };
    apply(setAdd, state.realms, [realm]);
    let namespace;
    try { namespace = data(realm, 'WebAssembly'); }
    catch { runtime.addFlag('hook-failed'); return { results, skipped }; }
    if (namespace === null || typeof namespace !== 'object') { append(skipped, 'WebAssembly'); return { results, skipped }; }
    const options = { context: runtime.hooks }, owners = Object.create(null);
    const attach = handle => { if (handle) { append(results, handle); runtime.attach([handle]); } };
    function targetFor(surface) {
      if (surface.target === 'namespace') return namespace;
      let constructor = owners[surface.owner];
      if (constructor === undefined) constructor = owners[surface.owner] = data(namespace, surface.owner);
      return surface.target === 'static' ? constructor : data(constructor, 'prototype');
    }
    // Static functions must be wrapped before wrapConstructor copies their descriptors.
    for (let pass = 0; pass < 2; pass++) for (let index = 0; index < surfaces.length; index++) {
      const surface = surfaces[index];
      if ((surface.kind === 'construct') !== (pass === 1)) continue;
      const operation = surface.operation, operationIndex = registry.operationIndex[operation];
      if (operationIndex === undefined) { append(skipped, operation); continue; }
      try {
        const target = targetFor(surface), field = target && descriptor(target, surface.property);
        if (!field) { append(skipped, operation); continue; }
        const returned = registry.phaseIndex[surface.kind === 'async-call' ? 'settlement-unobserved' : 'returned-sync'];
        const record = threw => count(runtime, operationIndex, threw ? registry.phaseIndex['threw-sync'] : returned);
        const wasLegacy = apply(legacyHas, legacy, [operation]);
        if (surface.kind === 'construct') {
          const original = data(target, surface.property);
          const trackStack = operation === 'WebAssembly.Exception' && nativeCheck(original) && registry.operationIndex['WebAssembly.Exception.stack'] !== undefined;
          if (trackStack && !state.stack) state.stack = createStackTracker(runtime, registry.operationIndex['WebAssembly.Exception.stack'], attach);
          const handle = wrappers.wrapConstructor(target, surface.property, (_args, _newTarget, threw, _error, value) => {
            if (trackStack && !threw) state.stack.observe(value);
            record(threw);
            if (wasLegacy) runtime.recordResult(operation, threw ? registry.phaseIndex['threw-sync'] : returned, value);
          }, options);
          attach(handle);
          if (handle.status === 'installed') attach(constructorAlias(original, data(target, surface.property)));
        } else if (surface.kind === 'get' || surface.kind === 'set') {
          let counterpart;
          for (let other = 0; other < surfaces.length; other++) {
            const candidate = surfaces[other];
            if (candidate.target === surface.target && candidate.owner === surface.owner && candidate.property === surface.property && candidate.kind !== surface.kind && (candidate.kind === 'get' || candidate.kind === 'set')) { counterpart = candidate; break; }
          }
          if (counterpart) {
            if (surface.kind === 'set') continue;
            if (typeof field.get !== 'function') { append(skipped, operation); continue; }
            attach(accessor(runtime, target, surface.property, operationIndex, typeof field.set === 'function' ? registry.operationIndex[counterpart.operation] : undefined));
            if (typeof field.set !== 'function') append(skipped, counterpart.operation);
          } else if (surface.kind === 'get') attach(wrappers.wrapGetter(target, surface.property, (_receiver, threw, _error, value) => {
            record(threw);
            if (wasLegacy) runtime.recordResult(operation, threw ? registry.phaseIndex['threw-sync'] : returned, value);
          }, options));
          else attach(wrappers.wrapSetter(target, surface.property, (_receiver, _args, threw) => record(threw), options));
        } else if (wasLegacy) attach(wrappers.wrapResultMethod(target, surface.property, (threw, value, args) => {
          record(threw);
          runtime.recordResult(operation, threw ? registry.phaseIndex['threw-sync'] : returned, value, operation === 'WebAssembly.Memory.grow' ? args : undefined);
        }, options));
        else attach(wrappers.wrapOutcomeMethod(target, surface.property, record, options));
      } catch { runtime.addFlag('hook-failed'); append(skipped, operation); }
    }
    return { results, skipped };
  }
  return { install };
})({ operationIndex: API_OPERATION_INDEX, phaseIndex: PHASE_INDEX }, [{"feature":"webassembly-compile","operation":"WebAssembly.compile","target":"namespace","property":"compile","kind":"async-call"},{"feature":"webassembly-instantiate","operation":"WebAssembly.instantiate","target":"namespace","property":"instantiate","kind":"async-call"},{"feature":"webassembly-compile-streaming","operation":"WebAssembly.compileStreaming","target":"namespace","property":"compileStreaming","kind":"async-call"},{"feature":"webassembly-instantiate-streaming","operation":"WebAssembly.instantiateStreaming","target":"namespace","property":"instantiateStreaming","kind":"async-call"},{"feature":"webassembly-validate","operation":"WebAssembly.validate","target":"namespace","property":"validate","kind":"call"},{"feature":"webassembly-module","operation":"WebAssembly.Module","target":"namespace","property":"Module","kind":"construct"},{"feature":"webassembly-instance","operation":"WebAssembly.Instance","target":"namespace","property":"Instance","kind":"construct"},{"feature":"webassembly-memory","operation":"WebAssembly.Memory","target":"namespace","property":"Memory","kind":"construct"},{"feature":"webassembly-memory-grow","operation":"WebAssembly.Memory.grow","target":"prototype","owner":"Memory","property":"grow","kind":"call"},{"feature":"webassembly-memory-buffer","operation":"WebAssembly.Memory.buffer","target":"prototype","owner":"Memory","property":"buffer","kind":"get"},{"feature":"webassembly-module-imports","operation":"WebAssembly.Module.imports","target":"static","owner":"Module","property":"imports","kind":"call"},{"feature":"webassembly-module-exports","operation":"WebAssembly.Module.exports","target":"static","owner":"Module","property":"exports","kind":"call"},{"feature":"webassembly-module-custom-sections","operation":"WebAssembly.Module.customSections","target":"static","owner":"Module","property":"customSections","kind":"call"},{"feature":"webassembly-instance-exports","operation":"WebAssembly.Instance.exports","target":"prototype","owner":"Instance","property":"exports","kind":"get"},{"feature":"webassembly-table","operation":"WebAssembly.Table","target":"namespace","property":"Table","kind":"construct"},{"feature":"webassembly-table-length","operation":"WebAssembly.Table.length","target":"prototype","owner":"Table","property":"length","kind":"get"},{"feature":"webassembly-table-grow","operation":"WebAssembly.Table.grow","target":"prototype","owner":"Table","property":"grow","kind":"call"},{"feature":"webassembly-table-get","operation":"WebAssembly.Table.get","target":"prototype","owner":"Table","property":"get","kind":"call"},{"feature":"webassembly-table-set","operation":"WebAssembly.Table.set","target":"prototype","owner":"Table","property":"set","kind":"call"},{"feature":"webassembly-global","operation":"WebAssembly.Global","target":"namespace","property":"Global","kind":"construct"},{"feature":"webassembly-global-value-of","operation":"WebAssembly.Global.valueOf","target":"prototype","owner":"Global","property":"valueOf","kind":"call"},{"feature":"webassembly-global-value","operation":"WebAssembly.Global.value","target":"prototype","owner":"Global","property":"value","kind":"get"},{"feature":"webassembly-global-value-set","operation":"WebAssembly.Global.value.set","target":"prototype","owner":"Global","property":"value","kind":"set"},{"feature":"webassembly-tag","operation":"WebAssembly.Tag","target":"namespace","property":"Tag","kind":"construct"},{"feature":"webassembly-exception","operation":"WebAssembly.Exception","target":"namespace","property":"Exception","kind":"construct"},{"feature":"webassembly-exception-is","operation":"WebAssembly.Exception.is","target":"prototype","owner":"Exception","property":"is","kind":"call"},{"feature":"webassembly-exception-get-arg","operation":"WebAssembly.Exception.getArg","target":"prototype","owner":"Exception","property":"getArg","kind":"call"},{"feature":"webassembly-exception-stack","operation":"WebAssembly.Exception.stack","target":"prototype","owner":"Exception","property":"stack","kind":"get"},{"feature":"webassembly-compile-error","operation":"WebAssembly.CompileError","target":"namespace","property":"CompileError","kind":"construct"},{"feature":"webassembly-link-error","operation":"WebAssembly.LinkError","target":"namespace","property":"LinkError","kind":"construct"},{"feature":"webassembly-runtime-error","operation":"WebAssembly.RuntimeError","target":"namespace","property":"RuntimeError","kind":"construct"},{"feature":"webassembly-suspending","operation":"WebAssembly.Suspending","target":"namespace","property":"Suspending","kind":"construct"},{"feature":"webassembly-promising","operation":"WebAssembly.promising","target":"namespace","property":"promising","kind":"call"},{"feature":"webassembly-suspend-error","operation":"WebAssembly.SuspendError","target":"namespace","property":"SuspendError","kind":"construct"},{"feature":"webassembly-memory-to-fixed-length-buffer","operation":"WebAssembly.Memory.toFixedLengthBuffer","target":"prototype","owner":"Memory","property":"toFixedLengthBuffer","kind":"call"},{"feature":"webassembly-memory-to-resizable-buffer","operation":"WebAssembly.Memory.toResizableBuffer","target":"prototype","owner":"Memory","property":"toResizableBuffer","kind":"call"},{"feature":"webassembly-tag-type","operation":"WebAssembly.Tag.type","target":"prototype","owner":"Tag","property":"type","kind":"call"}]);
  function installWebAssemblySensor(runtime, realm = globalThis) { return webAssemblyObserverSupport.install(runtime, realm, { wrapConstructor, wrapGetter, wrapSetter, wrapOutcomeMethod, wrapResultMethod }); }

  // packages/sensors/src/permissions.ts
  var descriptor13 = Object.getOwnPropertyDescriptor, create7 = Object.create, apply13 = Reflect.apply, own8 = Function.prototype.call.bind(Object.prototype.hasOwnProperty), source2 = Function.prototype.call.bind(Function.prototype.toString), includes6 = Function.prototype.call.bind(String.prototype.includes), NO_ARGS5 = [], TECHNIQUE2 = TECHNIQUE_INDEX["DET-039"], PERMISSIONS = [
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
  ], POLICY_FAMILIES = ["FeaturePolicy", "PermissionsPolicy"], POLICY_METHODS = ["allowsFeature", "features", "allowedFeatures", "getAllowlistForFeature"];
  function permissionName(value) {
    switch (value) {
      case "camera":
      case "video_capture":
        return "camera";
      case "microphone":
      case "audio_capture":
        return "microphone";
      case "clipboard-read":
      case "clipboard_read":
        return "clipboard-read";
      case "clipboard-write":
      case "clipboard_write":
        return "clipboard-write";
      case "persistent-storage":
      case "durable_storage":
        return "persistent-storage";
      case "background-sync":
      case "background_sync":
        return "background-sync";
      case "payment-handler":
      case "payment_handler":
        return "payment-handler";
      case "screen-wake-lock":
      case "screen_wake_lock":
        return "screen-wake-lock";
      case "local-fonts":
      case "local_fonts":
        return "local-fonts";
      case "display-capture":
      case "display_capture":
        return "display-capture";
      case "geolocation":
      case "notifications":
      case "midi":
      case "sensors":
      case "window-management":
      case "storage-access":
        return value;
      default:
        return "unknown";
    }
  }
  function policyFeature(value) {
    switch (value) {
      case "camera":
      case "microphone":
      case "geolocation":
      case "clipboard-read":
      case "clipboard-write":
      case "midi":
      case "payment-handler":
      case "screen-wake-lock":
      case "window-management":
      case "local-fonts":
      case "display-capture":
      case "storage-access":
        return value;
      case "accelerometer":
      case "gyroscope":
      case "magnetometer":
        return "sensors";
      default:
        return "unknown";
    }
  }
  function dataObject4(target, key) {
    let field2 = descriptor13(target, key);
    if (!field2 || !own8(field2, "value")) return null;
    let value = field2.value;
    return typeof value == "object" && value !== null || typeof value == "function" ? value : null;
  }
  function installPermissionsSensor(runtime, realm = globalThis) {
    let results = [], skipped = [];
    if (!runtime.hooks.enabled) return { results, skipped };
    let options = { context: runtime.hooks }, stateMasks = create7(null), policyMasks = create7(null);
    for (let index = 0; index < PERMISSIONS.length; index++) {
      let name = PERMISSIONS[index], code = `permission-${name}`;
      stateMasks[name] = {
        granted: signalMaskOf(["api-use", code, "permission-granted"]),
        denied: signalMaskOf(["api-use", code, "permission-denied"]),
        prompt: signalMaskOf(["api-use", code, "permission-prompt"])
      }, policyMasks[name] = {
        allowed: signalMaskOf(["api-use", code, "policy-allowed"]),
        blocked: signalMaskOf(["api-use", code, "policy-blocked"])
      };
    }
    let policyEnumeration = signalMaskOf(["api-use", "policy-enumeration"]), attach = (result) => {
      arrayPush(results, result), runtime.attach([result]);
    }, record = (threw, mask = SIGNAL_BIT["api-use"]) => {
      runtime.record(TECHNIQUE2, PHASE_INDEX[threw ? "threw-sync" : "returned-sync"], mask);
    }, preview = (name, threw, value) => runtime.recordResult(
      name,
      PHASE_INDEX[threw ? "threw-sync" : "returned-sync"],
      value
    ), prototype3 = (family) => {
      let constructor = dataObject4(realm, family);
      return constructor && dataObject4(constructor, "prototype");
    };
    try {
      let target = prototype3("Permissions");
      target && descriptor13(target, "query") ? attach(wrapOutcomeMethod(target, "query", (threw) => {
        runtime.recordOperation(API_OPERATION_INDEX["Permissions.query"], PHASE_INDEX[threw ? "threw-sync" : "settlement-unobserved"]), runtime.recordResult("Permissions.query", PHASE_INDEX[threw ? "threw-sync" : "settlement-unobserved"], void 0);
      }, options)) : arrayPush(skipped, "Permissions.query");
    } catch {
      runtime.addFlag("hook-failed");
    }
    try {
      let target = prototype3("PermissionStatus");
      if (target && descriptor13(target, "state")) {
        let nameField = descriptor13(target, "name"), getter = nameField && own8(nameField, "get") ? nameField.get : null, nameGetter = runtime.earlyCaptureGuaranteed && typeof getter == "function" && includes6(source2(getter), "[native code]") ? getter : null;
        attach(wrapGetter(target, "state", (receiver, threw, _error, value) => {
          if (threw || value !== "granted" && value !== "denied" && value !== "prompt") {
            record(threw), preview("PermissionStatus.state", threw, value);
            return;
          }
          let name = "unknown";
          if (nameGetter)
            try {
              name = permissionName(apply13(nameGetter, receiver, NO_ARGS5));
            } catch {
            }
          record(!1, stateMasks[name][value]), preview("PermissionStatus.state." + name, !1, value);
        }, options));
      } else arrayPush(skipped, "PermissionStatus.state");
    } catch {
      runtime.addFlag("hook-failed");
    }
    try {
      let target = dataObject4(realm, "Notification");
      target && descriptor13(target, "permission") ? attach(wrapGetter(target, "permission", (_receiver, threw, _error, value) => {
        let state = value === "default" ? "prompt" : value;
        record(threw, !threw && (state === "granted" || state === "denied" || state === "prompt") ? stateMasks.notifications[state] : SIGNAL_BIT["api-use"]), preview("Notification.permission", threw, value);
      }, options)) : arrayPush(skipped, "Notification.permission");
    } catch {
      runtime.addFlag("hook-failed");
    }
    let previousPolicyTarget = null;
    for (let index = 0; index < POLICY_FAMILIES.length; index++) {
      let family = POLICY_FAMILIES[index];
      try {
        let target = prototype3(family);
        if (!target) {
          arrayPush(skipped, family);
          continue;
        }
        if (target === previousPolicyTarget) continue;
        previousPolicyTarget = target;
        for (let method = 0; method < POLICY_METHODS.length; method++) {
          let key = POLICY_METHODS[method];
          try {
            if (!descriptor13(target, key)) {
              arrayPush(skipped, `${family}.${key}`);
              continue;
            }
            attach(key === "allowsFeature" ? wrapMethod(target, key, (_receiver, args, threw, _error, value) => {
              let name = !threw && args.length === 1 ? policyFeature(args[0]) : "unknown", mask = name !== "unknown" && typeof value == "boolean" ? policyMasks[name][value ? "allowed" : "blocked"] : policyEnumeration;
              record(threw, mask), preview(family + "." + key, threw, value);
            }, options) : wrapOutcomeMethod(target, key, (threw) => {
              record(threw, policyEnumeration);
            }, options));
          } catch {
            runtime.addFlag("hook-failed");
          }
        }
      } catch {
        runtime.addFlag("hook-failed");
      }
    }
    return { results, skipped };
  }

  // packages/sensors/src/interaction.ts
  var descriptor14 = Object.getOwnPropertyDescriptor, own9 = Function.prototype.call.bind(Object.prototype.hasOwnProperty), TECHNIQUE3 = TECHNIQUE_INDEX["DET-043"], RETURNED3 = PHASE_INDEX["returned-sync"], THREW3 = PHASE_INDEX["threw-sync"], LISTENER_USE = signalMaskOf(["api-use", "movement-listener"]), COORDINATE_READ = signalMaskOf(["api-use", "pointer-coordinate-read"]);
  function dataObject5(target, key) {
    let field2 = descriptor14(target, key);
    if (!field2 || !own9(field2, "value")) return null;
    let value = field2.value;
    return typeof value == "object" && value !== null || typeof value == "function" ? value : null;
  }
  function installInteractionSensor(runtime, realm = globalThis) {
    let results = [], skipped = [];
    if (!runtime.hooks.enabled) return { results, skipped };
    let options = { context: runtime.hooks }, attach = (result) => {
      arrayPush(results, result), runtime.attach([result]);
    }, prototype3 = (name) => {
      let constructor = dataObject5(realm, name);
      if (!constructor) {
        arrayPush(skipped, name);
        let field2 = descriptor14(realm, name);
        return field2 && !own9(field2, "value") && runtime.addFlag("hook-failed"), null;
      }
      return dataObject5(constructor, "prototype");
    };
    try {
      let target = prototype3("EventTarget");
      target && attach(wrapMethod(target, "addEventListener", (receiver, args, threw) => {
        extendedSurfacesSupport.observeDeviceEvent(runtime, receiver, args, threw);
        if (args.length < 2) return;
        let type = args[0];
        if (typeof type == "string" && (type === "mousemove" || type === "pointermove" || type === "pointerrawupdate")) {
          let callback = args[1];
          (typeof callback == "function" || typeof callback == "object" && callback !== null) && runtime.record(TECHNIQUE3, threw ? THREW3 : RETURNED3, LISTENER_USE);
        }
        if (type === "change" || type === "screenschange" || type === "currentscreenchange") {
          let callback = args[1];
          if (typeof callback == "function" || typeof callback == "object" && callback !== null) {
            let operation = screenEventOperation(runtime, receiver, type, !0);
            operation !== null && runtime.recordOperation(API_OPERATION_INDEX[operation], threw ? THREW3 : RETURNED3);
          }
        }
      }, options)), target && (dataObject5(realm, "Screen") || dataObject5(realm, "ScreenDetails")) && descriptor14(target, "removeEventListener") && attach(wrapMethod(target, "removeEventListener", (receiver, args, threw) => {
        if (args.length < 2) return;
        let type = args[0];
        if (type !== "change" && type !== "screenschange" && type !== "currentscreenchange") return;
        let callback = args[1];
        if (typeof callback != "function" && (typeof callback != "object" || callback === null)) return;
        let operation = screenEventOperation(runtime, receiver, type, !1);
        operation !== null && runtime.recordOperation(API_OPERATION_INDEX[operation], threw ? THREW3 : RETURNED3);
      }, options));
    } catch {
      runtime.addFlag("hook-failed");
    }
    let setters = (target, label) => {
      let keys2 = ["onmousemove", "onpointermove", "onpointerrawupdate"];
      for (let index = 0; index < keys2.length; index++) {
        let key = keys2[index];
        try {
          if (!descriptor14(target, key)) {
            arrayPush(skipped, label + "." + key);
            continue;
          }
          attach(wrapSetter(target, key, (_receiver, args, threw) => {
            let callback = args[0];
            (typeof callback == "function" || typeof callback == "object" && callback !== null) && runtime.record(TECHNIQUE3, threw ? THREW3 : RETURNED3, LISTENER_USE);
          }, options));
        } catch {
          runtime.addFlag("hook-failed");
        }
      }
    };
    setters(realm, "Window");
    let names2 = ["Document", "HTMLElement", "SVGElement", "MathMLElement"];
    for (let index = 0; index < names2.length; index++)
      try {
        let name = names2[index], target = prototype3(name);
        target && setters(target, name);
      } catch {
        runtime.addFlag("hook-failed");
      }
    try {
      let target = prototype3("MouseEvent");
      if (target) {
        let keys2 = ["clientX", "clientY", "screenX", "screenY", "pageX", "pageY", "offsetX", "offsetY", "movementX", "movementY", "x", "y"];
        for (let index = 0; index < keys2.length; index++) {
          let key = keys2[index];
          try {
            if (!descriptor14(target, key)) {
              arrayPush(skipped, "MouseEvent." + key);
              continue;
            }
            attach(wrapGetter(target, key, (_receiver, threw) => {
              runtime.record(TECHNIQUE3, threw ? THREW3 : RETURNED3, COORDINATE_READ);
            }, options));
          } catch {
            runtime.addFlag("hook-failed");
          }
        }
      }
    } catch {
      runtime.addFlag("hook-failed");
    }
    return { results, skipped };
  }

  // packages/sensors/src/audio.ts
  var descriptor15 = Object.getOwnPropertyDescriptor, own10 = Function.prototype.call.bind(Object.prototype.hasOwnProperty), indexOf3 = Function.prototype.call.bind(String.prototype.indexOf), slice4 = Function.prototype.call.bind(String.prototype.slice);
  function dataObject6(owner, key) {
    let field2 = descriptor15(owner, key);
    if (!field2 || !own10(field2, "value")) return null;
    let value = field2.value;
    return value !== null && (typeof value == "object" || typeof value == "function") ? value : null;
  }
  function installAudioSensor(runtime, realm = globalThis) {
    let results = [], skipped = [];
    if (!runtime.hooks.enabled) return { results, skipped };
    let options = { context: runtime.hooks }, attach = (result) => {
      arrayPush(results, result), runtime.attach([result]);
    }, install = (operation, name, property, kind) => {
      try {
        let constructor = dataObject6(realm, name);
        if (constructor === null) {
          arrayPush(skipped, name);
          let field2 = descriptor15(realm, name);
          field2 && !own10(field2, "value") && runtime.addFlag("hook-failed");
          return;
        }
        let operationIndex = API_OPERATION_INDEX[operation], phase = PHASE_INDEX[kind === "async-call" ? "settlement-unobserved" : "returned-sync"];
        if (property === null) {
          attach(wrapConstructor(realm, name, (_args, _newTarget, threw, _error, result) => {
            runtime.recordOperation(operationIndex, threw ? PHASE_INDEX["threw-sync"] : phase), runtime.recordResult(operation, threw ? PHASE_INDEX["threw-sync"] : phase, result);
          }, options));
          return;
        }
        let target = dataObject6(constructor, "prototype");
        if (!target || !descriptor15(target, property)) {
          arrayPush(skipped, operation);
          return;
        }
        attach(kind === "get" ? wrapGetter(target, property, (_receiver, threw, _error, result) => {
          runtime.recordOperation(operationIndex, threw ? PHASE_INDEX["threw-sync"] : phase), runtime.recordResult(operation, threw ? PHASE_INDEX["threw-sync"] : phase, result);
        }, options) : wrapResultMethod(target, property, (threw, result) => {
          runtime.recordOperation(operationIndex, threw ? PHASE_INDEX["threw-sync"] : phase), runtime.recordResult(operation, threw ? PHASE_INDEX["threw-sync"] : phase, result);
        }, options));
      } catch {
        runtime.addFlag("hook-failed");
      }
    };
    for (let operationIndex = 0; operationIndex < API_OPERATION_DEFINITIONS.length; operationIndex++) {
      let [operation, , mechanism, kind] = API_OPERATION_DEFINITIONS[operationIndex];
      if (mechanism !== "audio") continue;
      let separator = indexOf3(operation, ".");
      install(operation, separator < 0 ? operation : slice4(operation, 0, separator), separator < 0 ? null : slice4(operation, separator + 1), kind);
    }
    return install("AudioContext", "webkitAudioContext", null, "construct"), install("OfflineAudioContext", "webkitOfflineAudioContext", null, "construct"), { results, skipped };
  }

  // packages/sensors/src/webnn.ts
  var descriptor16 = Object.getOwnPropertyDescriptor, hasOwn10 = Object.hasOwn, SURFACES = API_OPERATION_DEFINITIONS.filter((definition) => definition[2] === "webnn").map((definition) => {
    let operation = definition[0], separator = operation.indexOf(".");
    return {
      operation,
      kind: definition[3],
      owner: separator < 0 ? operation : operation.slice(0, separator),
      member: separator < 0 ? operation : operation.slice(separator + 1)
    };
  });
  function installWebNNSensor(runtime, realm = globalThis) {
    let results = [], skipped = [];
    if (!runtime.hooks.enabled) return { results, skipped };
    for (let index = 0; index < SURFACES.length; index++) {
      let { owner, member, operation, kind } = SURFACES[index];
      try {
        let ordinal = API_OPERATION_INDEX[operation], returned = PHASE_INDEX[kind === "async-call" ? "settlement-unobserved" : "returned-sync"], observe = (threw, result2, args) => {
          let phase = threw ? PHASE_INDEX["threw-sync"] : returned;
          runtime.recordOperation(ordinal, phase), runtime.recordResult(operation, phase, result2, args);
        }, options = { context: runtime.hooks }, field2 = descriptor16(realm, owner);
        if (kind === "construct") {
          if (!field2 || !hasOwn10(field2, "value") || typeof field2.value != "function") {
            arrayPush(skipped, operation);
            continue;
          }
          let result2 = wrapConstructor(realm, owner, (_args, _newTarget, threw, _error, value) => observe(threw, value), options);
          arrayPush(results, result2), runtime.attach([result2]);
          continue;
        }
        let prototype3 = field2 && hasOwn10(field2, "value") && typeof field2.value == "function" ? descriptor16(field2.value, "prototype") : null;
        if (!prototype3 || !hasOwn10(prototype3, "value") || typeof prototype3.value != "object" || prototype3.value === null || !descriptor16(prototype3.value, member)) {
          arrayPush(skipped, operation);
          continue;
        }
        let result = kind === "get" ? wrapGetter(prototype3.value, member, (_receiver, threw, _error, value) => observe(threw, value), options) : wrapResultMethod(prototype3.value, member, observe, options);
        arrayPush(results, result), runtime.attach([result]);
      } catch {
        runtime.addFlag("hook-failed");
      }
    }
    return { results, skipped };
  }

  // packages/sensors/src/capabilities.ts
  var descriptor17 = Object.getOwnPropertyDescriptor, hasOwn11 = Object.hasOwn, MECHANISMS = ["media-capabilities", "media-devices", "speech", "drm", "browser-capabilities", "builtin-ai", "recognition", "app-integration"], STATIC = [
    "MediaSource.isTypeSupported",
    "AudioDecoder.isConfigSupported",
    "AudioEncoder.isConfigSupported",
    "VideoDecoder.isConfigSupported",
    "VideoEncoder.isConfigSupported",
    "ImageDecoder.isTypeSupported",
    "SpeechRecognition.available",
    "SpeechRecognition.install",
    "Intl.supportedValuesOf",
    "PerformanceObserver.supportedEntryTypes",
    "Notification.maxActions",
    "BarcodeDetector.getSupportedFormats"
  ], SURFACES2 = API_OPERATION_DEFINITIONS.filter((definition) => MECHANISMS.includes(definition[2]) && !definition[0].startsWith("RTCRtp") && definition[0] !== "Permissions.query").map((definition) => {
    let operation = definition[0], separator = operation.indexOf(".");
    return {
      operation,
      kind: definition[3],
      owner: separator < 0 ? operation : operation.slice(0, separator),
      member: separator < 0 ? operation : operation.slice(separator + 1),
      static: STATIC.includes(operation) || definition[2] === "builtin-ai" && (operation.endsWith(".availability") || operation.endsWith(".params") || operation.endsWith(".create"))
    };
  });
  function dataObject7(owner, key) {
    let field2 = descriptor17(owner, key);
    if (!field2 || !hasOwn11(field2, "value")) return null;
    let value = field2.value;
    return value !== null && (typeof value == "object" || typeof value == "function") ? value : null;
  }
  function installCapabilitySensor(runtime, realm = globalThis) {
    let results = [], skipped = [];
    if (!runtime.hooks.enabled) return { results, skipped };
    let rtcValues = installRtcValueCapture(runtime);
    for (let index = 0; index < SURFACES2.length; index++) {
      let { operation, kind, owner, member, static: isStatic } = SURFACES2[index];
      try {
        let namespace = owner === "Window" ? realm : dataObject7(realm, owner), target = owner === "Window" || isStatic ? namespace : namespace && dataObject7(namespace, "prototype"), selected = kind === "construct" ? realm : target;
        if (!selected || !descriptor17(selected, member)) {
          arrayPush(skipped, operation);
          continue;
        }
        let ordinal = API_OPERATION_INDEX[operation], saved = operation === "MediaStreamTrack.getSettings" ? descriptor17(selected, member) : void 0, returnedNative = !!saved && hasOwn11(saved, "value") && nativeRtcFunction(saved.value), returned = PHASE_INDEX[kind === "async-call" ? "settlement-unobserved" : "returned-sync"], observe = (threw, value, args) => {
          let phase = threw ? PHASE_INDEX["threw-sync"] : returned;
          runtime.recordOperation(ordinal, phase), (operation !== "MediaStreamTrack.getSettings" || threw || !returnedNative || !rtcValues?.returned(operation, value)) && runtime.recordResult(operation, phase, value, args);
        }, options = { context: runtime.hooks }, result = kind === "construct" ? wrapConstructor(selected, member, (_args, _newTarget, threw, _error, value) => observe(threw, value), options) : kind === "get" ? wrapGetter(selected, member, (_receiver, threw, _error, value) => observe(threw, value), options) : backgroundSensorSupport.observes(operation) ? wrapMethod(selected, member, (_receiver, args, threw, _error, value) => { runtime.observeBackgroundOperation?.(operation, args, threw); observe(threw, value); }, options) : wrapResultMethod(selected, member, observe, options);
        arrayPush(results, result), runtime.attach([result]);
      } catch {
        runtime.addFlag("hook-failed");
      }
    }
    return { results, skipped };
  }

  // ADR-038 cookie writers start
  // packages/sensors/src/cookie-writers.ts
  var cookieWriterSupport = (function createCookieWriterSupport(detector, socialSupport, trustedNatives = false) {
  const apply = Reflect.apply, descriptor = Object.getOwnPropertyDescriptor, getPrototype = Object.getPrototypeOf;
  const NativeError = descriptor(globalThis, 'Error')?.value, NativeMap = Map;
  const mapGet = Map.prototype.get, mapSet = Map.prototype.set, mapEach = Map.prototype.forEach;
  const push = Array.prototype.push, slice = String.prototype.slice, charCode = String.prototype.charCodeAt;
  const exec = RegExp.prototype.exec, fnSource = Function.prototype.toString, hasOwn = Object.hasOwn, finite = Number.isFinite;
  const matches = (pattern, value) => apply(exec, pattern, [value]) !== null;
  const native = fn => typeof fn === 'function' && (trustedNatives || matches(/\[native code\]/, apply(fnSource, fn, [])));
  const own = (value, key) => value && (typeof value === 'object' || typeof value === 'function') ? descriptor(value, key)?.value : undefined;
  const validName = name => typeof name === 'string' && matches(/^[!#$%&'*+\-.^_\x60|~0-9A-Za-z]{1,256}$/, name);
  function cookieName(raw) {
    if (typeof raw !== 'string') return null;
    // Inspect at most 512 prefix code units. Never slice, decode or retain the value.
    const limit = raw.length < 512 ? raw.length : 512;
    let start = 0, end = -1;
    while (start < limit) { const code = apply(charCode, raw, [start]); if (code !== 32 && code !== 9) break; ++start; }
    for (let index = start; index < limit; ++index) {
      const code = apply(charCode, raw, [index]);
      if (code === 61) { end = index; break; }
      if (code === 59 || code < 32 && code !== 9 || code > 126) return null;
    }
    if (end < 0) return null;
    while (end > start) { const code = apply(charCode, raw, [end - 1]); if (code !== 32 && code !== 9) break; --end; }
    if (end - start > 256) return null;
    const name = apply(slice, raw, [start, end]);
    return validName(name) ? name : null;
  }
  function createCollector() {
    let rows = new NativeMap(), rowCount = 0, bytes = 512, samples = 0, truncated = !detector.ready, lastReadAt = -Infinity;
    return {
      reset() { rows = new NativeMap(); rowCount = 0; bytes = 512; samples = 0; truncated = !detector.ready; lastReadAt = -Infinity; },
      limited() { truncated = true; },
      sample() { if (samples >= 64) { truncated = true; return false; } ++samples; return true; },
      record(name, phase, source) {
        if (!validName(name) || phase !== 'returned-sync' && phase !== 'threw-sync') { truncated = true; return; }
        let script = null, confidence = 'unknown';
        const candidate = own(source, 'script'), attribution = own(source, 'attributionConfidence');
        if (candidate && (attribution === 'exact-resource' || attribution === 'sampled-stack')) {
          const host = own(candidate, 'host'), pathTemplate = own(candidate, 'pathTemplate');
          if (typeof host === 'string' && host.length <= 253 && matches(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/, host) && !matches(/\.\./, host) && typeof pathTemplate === 'string' && matches(/^\/(?:<script>|(?:main|client|script|sdk|gtm|fbevents|widgets|tracker|analytics)\.(?:js|mjs))$/, pathTemplate)) { script = { host, pathTemplate }; confidence = attribution; }
          else truncated = true;
        }
        const key = name.length + ':' + name + ':' + phase + ':' + confidence + ':' + (script ? script.host : '') + ':' + (script ? script.pathTemplate : '');
        const previous = apply(mapGet, rows, [key]);
        if (previous) { if (previous.count < 2147483647) ++previous.count; else truncated = true; return; }
        const cost = 512 + key.length * 2;
        if (rowCount >= 64 || bytes + cost > 24576) { truncated = true; return; }
        bytes += cost; ++rowCount;
        apply(mapSet, rows, [key, { name, phase, script, attributionConfidence: confidence, evidenceSource: 'page-hook', integrity: 'page-controlled', count: 1 }]);
      },
      snapshot() {
        const output = [];
        apply(mapEach, rows, [row => apply(push, output, [{ ...row, script: row.script ? { ...row.script } : null }])]);
        return { rows: output, truncated };
      },
      handleControl(data, enabled, env) {
        if (own(data, 'channel') !== 'detect.expert/cookie-writers/v1' || own(data, 'type') !== 'cookie-writers-read') return;
        const requestId = own(data, 'requestId');
        if (typeof requestId !== 'string' || !matches(/^cookie-writers-[0-9]{1,10}$/, requestId)) return;
        const now = env.now(); if (!finite(now) || now - lastReadAt < 500) return;
        lastReadAt = now;
        const snapshot = enabled ? this.snapshot() : { rows: [], truncated: true };
        env.postMessage({ channel: 'detect.expert/cookie-writers/v1', type: 'cookie-writers-batch', requestId, enabled, rows: snapshot.rows, truncated: snapshot.truncated });
      },
    };
  }
  function install(runtime, realm, nativeCheck = native) {
    const collector = runtime.apiResults.cookieWriterCollector;
    const prototype = key => own(own(realm, key), 'prototype');
    const getter = (object, key) => { const entry = object && descriptor(object, key); return typeof entry?.get === 'function' && nativeCheck(entry.get) ? entry.get : null; };
    const currentScript = getter(prototype('Document'), 'currentScript'), scriptURL = getter(prototype('HTMLScriptElement'), 'src');
    let document;
    try { const entry = descriptor(realm, 'document'); document = entry?.value ?? (nativeCheck(entry?.get) ? apply(entry.get, realm, []) : null); } catch { collector.limited(); }
    const read = (fn, receiver) => { if (!fn) return null; try { return apply(fn, receiver, []); } catch { return null; } };
    let generation = runtime.apiResults.generation;
    const active = () => {
      if (generation !== runtime.apiResults.generation) { generation = runtime.apiResults.generation; collector.reset(); }
      return runtime.hooks.enabled;
    };
    const source = () => {
      const executing = read(currentScript, document), script = executing ? detector.script(read(scriptURL, executing)) : null;
      if (script) return { script, attributionConfidence: 'exact-resource' };
      if (!collector.sample() || !nativeCheck(NativeError)) { collector.limited(); return null; }
      try {
        // The same bounded stack parser as Social; never invoke page formatters.
        for (let index = 0; index < 2; ++index) {
          const key = index === 0 ? 'prepareStackTrace' : 'stackTraceLimit';
          let object = NativeError, depth = 0;
          for (; object && depth < 8; ++depth, object = getPrototype(object)) {
            const entry = descriptor(object, key);
            if (!entry) continue;
            if (!hasOwn(entry, 'value') || key === 'prepareStackTrace' && entry.value !== undefined || key === 'stackTraceLimit' && (typeof entry.value !== 'number' || entry.value < 0 || entry.value > 100)) { collector.limited(); return null; }
            break;
          }
          if (object && depth >= 8) { collector.limited(); return null; }
        }
        const stack = descriptor(new NativeError(), 'stack');
        if (!stack || typeof stack.value !== 'string') { collector.limited(); return null; }
        return socialSupport.stackSource(stack.value, collector);
      } catch { collector.limited(); return null; }
    };
    runtime.observeCookieWrite = (receiver, args, threw) => {
      if (!active() || !document || receiver !== document) return;
      const name = cookieName(args[0]);
      if (name === null) { collector.limited(); return; }
      collector.record(name, threw ? 'threw-sync' : 'returned-sync', source());
    };
    runtime.onStop(() => collector.reset());
    if (!document || !currentScript || !scriptURL || !detector.ready) collector.limited();
  }
  return { cookieName, createCollector, install };
})(socialNetworkDetector, socialSensorSupport);

  // ADR-038 cookie writers end
  // ADR-038 surfaces start
  // packages/sensors/src/worker-surfaces.ts
  var workerSurfacesSupport = (function createWorkerSurfacesSupport() {
  const descriptor = Object.getOwnPropertyDescriptor, getPrototype = Object.getPrototypeOf;
  const define = Object.defineProperty, apply = Reflect.apply, source = Function.prototype.toString;
  const exec = RegExp.prototype.exec, integer = Number.isSafeInteger;
  const native = value => typeof value === 'function' && apply(exec, /\[native code\]/, [apply(source, value, [])]) !== null;
  const own = (object, key) => object && descriptor(object, key)?.value;
  const push = (array, value) => define(array, array.length, { __proto__: null, value, writable: true, enumerable: true, configurable: true });
  // Read descriptors only. Unknown accessors are not invoked to discover an interface.
  function member(object, key, depthLimit = 8) {
    for (let depth = 0; object && depth < depthLimit; ++depth, object = getPrototype(object)) {
      const entry = descriptor(object, key);
      if (entry) return { owner: object, value: own(entry, 'value') };
    }
    return null;
  }
  function install(runtime, realm, wrappers, operationIndex, phaseIndex, nativeCheck = native) {
    const results = [], skipped = [], workletOwners = [];
    if (!runtime.hooks.enabled) return { results, skipped };
    const options = { context: runtime.hooks };
    const installOne = (label, target, key, kind) => {
      try {
        const ordinal = own(operationIndex, label), returned = own(phaseIndex, kind === 'method' ? 'settlement-unobserved' : 'returned-sync');
        const thrown = own(phaseIndex, 'threw-sync');
        if (!integer(ordinal) || ordinal < 0 || !integer(returned) || returned < 0 || !integer(thrown) || thrown < 0) {
          push(skipped, label); runtime.addFlag('hook-failed'); return;
        }
        if (!target || !nativeCheck(own(target, key))) { push(skipped, label); return; }
        const observe = threw => {
          // The wrapper owns argument forwarding and exception/Promise identity.
          // This callback reads no URL, options, constructor result or foreign Promise.
          runtime.recordOperation(ordinal, threw ? thrown : returned);
          if (!threw) runtime.addFlag('worker-not-observed');
        };
        const handle = kind === 'constructor'
          ? wrappers.wrapConstructor(target, key, (_args, _newTarget, threw) => observe(threw), options)
          : wrappers.wrapMethod(target, key, (_receiver, _args, threw) => observe(threw), options);
        if (handle) { push(results, handle); runtime.attach([handle]); }
        else { push(skipped, label); runtime.addFlag('hook-failed'); }
      } catch { push(skipped, label); runtime.addFlag('hook-failed'); }
    };
    const constructors = ['Worker', 'SharedWorker'];
    for (let index = 0; index < constructors.length; ++index) {
      const label = constructors[index];
      try { installOne(label, member(realm, label)?.owner, label, 'constructor'); }
      catch { push(skipped, label); runtime.addFlag('hook-failed'); }
    }
    // Worklet.addModule is shared by AudioWorklet/PaintWorklet. Some browsers expose
    // only a subtype constructor; follow its prototype without reading CSS/audio getters.
    const interfaces = ['Worklet', 'AudioWorklet', 'PaintWorklet'];
    for (let index = 0; index < interfaces.length; ++index) {
      try {
        const constructor = member(realm, interfaces[index])?.value;
        if (typeof constructor !== 'function' || !nativeCheck(constructor)) continue;
        const target = member(own(constructor, 'prototype'), 'addModule')?.owner;
        if (!target) continue;
        let duplicate = false;
        for (let previous = 0; previous < workletOwners.length; ++previous) if (workletOwners[previous] === target) duplicate = true;
        if (duplicate) continue;
        push(workletOwners, target); installOne('Worklet.addModule', target, 'addModule', 'method');
      } catch { runtime.addFlag('hook-failed'); }
    }
    if (!workletOwners.length) push(skipped, 'Worklet.addModule');
    return { results, skipped };
  }
  return { install };
})();

  // packages/sensors/src/extended-surfaces.ts
  var extendedSurfaceDefinitions = [["Accelerometer","DET-042","device-sensor","construct"],["Gyroscope","DET-042","device-sensor","construct"],["LinearAccelerationSensor","DET-042","device-sensor","construct"],["GravitySensor","DET-042","device-sensor","construct"],["Magnetometer","DET-042","device-sensor","construct"],["AbsoluteOrientationSensor","DET-042","device-sensor","construct"],["RelativeOrientationSensor","DET-042","device-sensor","construct"],["WebTransport","DET-058","webtransport","construct"],["CredentialsContainer.create","DET-069","webauthn","async-call"],["Clipboard.read","DET-069","clipboard","async-call"],["Clipboard.readText","DET-069","clipboard","async-call"],["Clipboard.write","DET-069","clipboard","async-call"],["Clipboard.writeText","DET-069","clipboard","async-call"],["GPUBuffer.mapAsync","DET-014","webgpu","async-call"],["GPUBuffer.getMappedRange","DET-014","webgpu","call"],["GPUBuffer.unmap","DET-014","webgpu","call"],["Window.addEventListener.deviceorientation","DET-042","device-sensor","call"],["Window.ondeviceorientation","DET-042","device-sensor","set"],["Window.addEventListener.devicemotion","DET-042","device-sensor","call"],["Window.ondevicemotion","DET-042","device-sensor","set"],["Window.addEventListener.deviceorientationabsolute","DET-042","device-sensor","call"],["Window.ondeviceorientationabsolute","DET-042","device-sensor","set"]];
  var extendedSurfacesSupport = (function createExtendedSurfacesSupport(registry, definitions) {
  const apply = Reflect.apply, descriptor = Object.getOwnPropertyDescriptor, hasOwn = Object.hasOwn;
  const fnSource = Function.prototype.toString, exec = RegExp.prototype.exec, push = Array.prototype.push;
  const indexOf = String.prototype.indexOf, slice = String.prototype.slice;
  const NativeWeakMap = WeakMap, NativeWeakSet = WeakSet;
  const weakGet = WeakMap.prototype.get, weakSet = WeakMap.prototype.set, weakDelete = WeakMap.prototype.delete;
  const setHas = WeakSet.prototype.has, setAdd = WeakSet.prototype.add;
  const states = new NativeWeakMap();
  const native = value => typeof value === 'function' && apply(exec, /\[native code\]/, [apply(fnSource, value, [])]) !== null;
  const own = (value, key) => {
    if (value === null || typeof value !== 'object' && typeof value !== 'function') return null;
    const property = descriptor(value, key);
    return property && hasOwn(property, 'value') ? property.value : null;
  };
  const phase = (threw, asynchronous = false) => registry.phaseIndex[threw ? 'threw-sync' : asynchronous ? 'settlement-unobserved' : 'returned-sync'];
  function record(runtime, operation, technique, threw, asynchronous = false) {
    if (!runtime.hooks.enabled) return;
    const index = registry.operationIndex[operation], phaseIndex = phase(threw, asynchronous);
    if (index === undefined) runtime.record(registry.techniqueIndex[technique], phaseIndex, registry.apiUse);
    else runtime.recordOperation(index, phaseIndex);
  }
  function flag(runtime) { try { runtime.addFlag('hook-failed'); } catch { /* Observer diagnostics cannot affect the page. */ } }
  function isRegisteredWindow(runtime, receiver) {
    const state = apply(weakGet, states, [runtime]);
    return !!state && receiver !== null && (typeof receiver === 'object' || typeof receiver === 'function') && apply(setHas, state.realms, [receiver]);
  }
  function observeDeviceEvent(runtime, receiver, args, threw) {
    // Three exact primitive comparisons precede any state lookup, callback access or observer work.
    const type = args[0];
    if (type !== 'deviceorientation' && type !== 'devicemotion' && type !== 'deviceorientationabsolute') return;
    if (!runtime.hooks.enabled || !isRegisteredWindow(runtime, receiver)) return;
    const callback = args[1];
    if (typeof callback !== 'function' && (callback === null || typeof callback !== 'object')) return;
    record(runtime, 'Window.addEventListener.' + type, 'DET-042', threw);
  }
  function install(runtime, realm, wrappers, nativeCheck = native) {
    const results = [], skipped = [];
    if (!runtime.hooks.enabled) return { results, skipped };
    let state = apply(weakGet, states, [runtime]);
    if (!state) {
      state = { realms: new NativeWeakSet() };
      apply(weakSet, states, [runtime, state]);
      runtime.onStop(() => apply(weakDelete, states, [runtime]));
    }
    if (apply(setHas, state.realms, [realm])) return { results, skipped };
    apply(setAdd, state.realms, [realm]);
    const options = { context: runtime.hooks };
    const attach = handle => { if (handle) { apply(push, results, [handle]); runtime.attach([handle]); } };
    for (let index = 0; index < definitions.length; ++index) {
      const definition = definitions[index], operation = definition[0], technique = definition[1], kind = definition[3];
      // EventTarget already has the interaction wrapper: root dispatches its callback to observeDeviceEvent.
      if (operation === 'Window.addEventListener.deviceorientation' || operation === 'Window.addEventListener.devicemotion' || operation === 'Window.addEventListener.deviceorientationabsolute') continue;
      try {
        if (kind === 'construct') {
          if (!nativeCheck(own(realm, operation))) { apply(push, skipped, [operation]); continue; }
          attach(wrappers.wrapConstructor(realm, operation, (_args, _newTarget, threw) => record(runtime, operation, technique, threw), options));
          continue;
        }
        const dot = apply(indexOf, operation, ['.']), owner = apply(slice, operation, [0, dot]), key = apply(slice, operation, [dot + 1]);
        const constructor = own(realm, owner), prototype = own(constructor, 'prototype');
        if (kind === 'set') {
          const target = descriptor(realm, key) ? realm : prototype;
          if (!target || !nativeCheck(descriptor(target, key)?.set)) { apply(push, skipped, [operation]); continue; }
          attach(wrappers.wrapSetter(target, key, (receiver, args, threw) => {
            if (typeof args[0] === 'function' && isRegisteredWindow(runtime, receiver)) record(runtime, operation, technique, threw);
          }, options));
        } else {
          if (!prototype || !nativeCheck(own(prototype, key))) { apply(push, skipped, [operation]); continue; }
          attach(wrappers.wrapMethod(prototype, key, (_receiver, _args, threw) => record(runtime, operation, technique, threw, kind === 'async-call'), options));
        }
      } catch { flag(runtime); apply(push, skipped, [operation]); }
    }
    return { results, skipped };
  }
  return { install, observeDeviceEvent };
})({ techniqueIndex: TECHNIQUE_INDEX, operationIndex: API_OPERATION_INDEX, phaseIndex: PHASE_INDEX, apiUse: SIGNAL_BIT["api-use"] }, extendedSurfaceDefinitions);
  // packages/sensors/src/extended-surfaces:end

  // packages/sensors/src/math-signature.ts
  var mathSignatureSupport = (function createMathSignatureSupport() {
  const descriptor = Object.getOwnPropertyDescriptor, getPrototype = Object.getPrototypeOf;
  const define = Object.defineProperty, apply = Reflect.apply, fnSource = Function.prototype.toString;
  const exec = RegExp.prototype.exec, integer = Number.isSafeInteger;
  const NativeWeakMap = WeakMap, get = WeakMap.prototype.get, set = WeakMap.prototype.set;
  const states = new NativeWeakMap();
  const own = (object, key) => object && descriptor(object, key)?.value;
  const native = value => typeof value === 'function' && apply(exec, /\[native code\]/, [apply(fnSource, value, [])]) !== null;
  const push = (array, value) => define(array, array.length, { __proto__: null, value, writable: true, enumerable: true, configurable: true });
  function mathObject(realm) {
    for (let depth = 0; realm && depth < 8; ++depth, realm = getPrototype(realm)) {
      const entry = descriptor(realm, 'Math');
      if (entry) return own(entry, 'value');
    }
    return null;
  }
  function install(runtime, realm, wrappers, techniques, phases, signals, nativeCheck = native) {
    const previous = apply(get, states, [runtime]);
    if (previous) return previous;
    const trig = own(techniques, 'DET-022'), pow = own(techniques, 'DET-023');
    const returned = own(phases, 'returned-sync'), thrown = own(phases, 'threw-sync');
    const api = own(signals, 'api-use'), pattern = own(signals, 'known-numeric-pattern');
    const indexes = [trig, pow, returned, thrown, api, pattern];
    for (let index = 0; index < indexes.length; ++index) if (!integer(indexes[index]) || indexes[index] < 0) {
      runtime.addFlag('hook-failed'); return null;
    }
    if (api < 1 || pattern < 1 || api === pattern) { runtime.addFlag('hook-failed'); return null; }
    const mask = api | pattern, options = { context: runtime.hooks };
    let active = false, stopped = false, handles = [];
    const reset = () => {
      active = false;
      for (let index = 0; index < handles.length; ++index) {
        try { if (!handles[index].restore()) runtime.addFlag('hook-failed'); }
        catch { runtime.addFlag('hook-failed'); }
      }
      handles = [];
    };
    const installOne = (target, key, technique, first, second) => {
      try {
        if (!target || !nativeCheck(own(target, key))) { runtime.addFlag('hook-failed'); return; }
        const binary = key === 'pow';
        const handle = wrappers.wrapMethod(target, key, (_receiver, args, threw) => {
          // Read only primitive arguments from the wrapper's own arguments object.
          // No coercion, result access, clock, stack, attribution or value recording.
          if (!active || args.length !== (binary ? 2 : 1) || typeof args[0] !== 'number' || args[0] !== first) return;
          if (binary && (typeof args[1] !== 'number' || args[1] !== second)) return;
          runtime.record(technique, threw ? thrown : returned, mask);
        }, options);
        if (handle?.status === 'installed') push(handles, handle);
        else if (handle) runtime.attach([handle]);
        else runtime.addFlag('hook-failed');
      } catch { runtime.addFlag('hook-failed'); }
    };
    const setActive = enabled => {
      if (enabled !== true) { reset(); return; }
      if (stopped || active || !runtime.hooks.enabled) return;
      active = true;
      let target;
      try { target = mathObject(realm); } catch { runtime.addFlag('hook-failed'); }
      if (!target || typeof target !== 'object') { runtime.addFlag('hook-failed'); return; }
      installOne(target, 'sin', trig, -1e300);
      installOne(target, 'cos', trig, 10.000000000123);
      installOne(target, 'tan', trig, -1e300);
      installOne(target, 'acos', trig, 0.123124234234234242);
      installOne(target, 'acosh', trig, 1e308);
      installOne(target, 'asin', trig, 0.123124234234234242);
      installOne(target, 'pow', pow, 3.141592653589793, -100);
    };
    const recorder = runtime.apiResults, originalCallback = own(recorder, 'onProSessionChanged');
    const onChange = enabled => {
      try { if (typeof originalCallback === 'function') apply(originalCallback, recorder, [enabled]); }
      finally { setActive(enabled); }
    };
    const stop = () => {
      stopped = true; reset();
      if (own(recorder, 'onProSessionChanged') === onChange) recorder.onProSessionChanged = originalCallback;
    };
    const state = { setActive, stop, get active() { return active; }, get installed() { return handles.length; } };
    apply(set, states, [runtime, state]);
    recorder.onProSessionChanged = onChange;
    runtime.onStop(stop);
    const session = own(recorder, 'proSession');
    if (typeof session === 'string' && session.length > 0) setActive(true);
    return state;
  }
  return { install };
})();

  // ADR-038 surfaces end
  // ADR-039 technical projector start
var createProTechnicalProjector = (function createProTechnicalSupport() {
  const apply = Reflect.apply, descriptor = Object.getOwnPropertyDescriptor, has = Object.hasOwn;
  const keys = Object.keys, isArray = Array.isArray, finite = Number.isFinite, integer = Number.isSafeInteger, same = Object.is;
  const fnSource = Function.prototype.toString, exec = RegExp.prototype.exec, define = Object.defineProperty, indexOf = String.prototype.indexOf, lastIndexOf = String.prototype.lastIndexOf, slice = String.prototype.slice;
  const NativeMap = Map, get = Map.prototype.get, set = Map.prototype.set;
  const matches = (re, value) => apply(exec, re, [value]) !== null;
  const appendOwn = (array, value) => define(array, array.length, { __proto__: null, value, writable: true, configurable: true, enumerable: true });
  const native = fn => typeof fn === 'function' && matches(/\[native code\]/, apply(fnSource, fn, []));
  const data = (object, name) => { const d = object && (typeof object === 'object' || typeof object === 'function') ? descriptor(object, name) : null; return d && has(d, 'value') ? d.value : undefined; };
  return function createProTechnicalProjector(realm, early, registry, schemas) {
  const proto = name => data(data(realm, name), 'prototype');
  const getter = (name, key) => { const d = descriptor(proto(name) ?? {}, key), fn = d && has(d, 'get') ? d.get : null; return native(fn) ? fn : null; };
  const method = (name, key) => { const fn = data(proto(name), key); return native(fn) ? fn : null; };
  const trusted = new NativeMap(), branded = new NativeMap();
  const put = (map, key, value) => apply(set, map, [key, value]);
  const lookup = (map, key) => apply(get, map, [key]);
  if (!early) return () => null;
  // Captured before any of our wrappers are installed; no late-runtime native claims.
  const operationNames = keys(registry);
  for (let i = 0; i < operationNames.length; i++) {
    const operation = operationNames[i], firstDot = apply(indexOf, operation, ['.']), lastDot = apply(lastIndexOf, operation, ['.']);
    const owner = apply(slice, operation, [0, firstDot]), last = apply(slice, operation, [lastDot + 1]);
    let target;
    if (owner === 'Window') target = realm;
    else if (owner === 'Intl') target = data(data(data(realm, 'Intl'), apply(slice, operation, [firstDot + 1, lastDot])), 'prototype');
    else target = proto(owner);
    const d = target && descriptor(target, last), fn = d && (has(d, 'value') ? d.value : has(d, 'get') ? d.get : null);
    if (native(fn)) put(trusted, operation, true);
  }
  const brands = [['DOMRectReadOnly', keys(schemas.geometry)], ['SVGRect', ['x', 'y', 'width', 'height']], ['TextMetrics', keys(schemas['text-metrics'])], ['MediaQueryList', ['media', 'matches']], ['Plugin', ['name', 'description', 'filename', 'length']], ['MimeType', ['type', 'description', 'suffixes']]];
  for (let i = 0; i < brands.length; i++) {
    const name = brands[i][0], fields = brands[i][1];
    const readers = [];
    for (let j = 0; j < fields.length; j++) { const field = fields[j], read = getter(name, field); if (read) appendOwn(readers, [field, read]); }
    put(branded, name, readers);
  }
  const rectLength = getter('DOMRectList', 'length'), rectItem = method('DOMRectList', 'item');
  const pluginLength = getter('PluginArray', 'length'), pluginItem = method('PluginArray', 'item');
  const mimeLength = getter('MimeTypeArray', 'length'), mimeItem = method('MimeTypeArray', 'item');
  return function project(operation, phase, result) {
    if (phase !== 'returned-sync' || !lookup(trusted, operation) || !result || typeof result !== 'object') return null;
    const profile = registry[operation][0], fields = [];
    let truncated = false, bytes = 256, stopped = false, validCollection = false;
    function append(name, index, value) {
      const type = typeof value;
      let kind = type;
      if (type === 'number' && (!finite(value) || same(value, -0))) { kind = 'special-number'; value = same(value, -0) ? '-0' : value !== value ? 'NaN' : value > 0 ? 'Infinity' : '-Infinity'; }
      else if (type !== 'string' && type !== 'number' && type !== 'boolean') return false;
      if (type === 'string' && (value.length > 256 || matches(/[\u0000-\u001f\u007f]/, value))) { truncated = true; return false; }
      const cost = 64 + name.length * 2 + (typeof value === 'string' ? value.length * 2 : 16);
      if (fields.length >= 128 || bytes + cost > 8192) { truncated = true; stopped = true; return false; }
      bytes += cost; appendOwn(fields, { name, index, kind, value }); return true;
    }
    function ownField(object, name, output = name, index = 0) {
      const d = descriptor(object, name);
      if (d && has(d, 'value')) append(output, index, d.value);
    }
    function strings(array, field) {
      if (!isArray(array)) return;
      const length = data(array, 'length');
      if (!integer(length) || length < 0) return;
      validCollection = true;
      if (length > 128) truncated = true;
      for (let i = 0; i < length && i < 128 && !stopped; i++) {
        const d = descriptor(array, i);
        if (d && has(d, 'value') && typeof d.value === 'string') append(field, i, d.value);
      }
    }
    function brandedFields(object, name, index = 0) {
      const readers = lookup(branded, name);
      let observed = false;
      for (let i = 0; i < readers.length && !stopped; i++) {
        const field = readers[i][0], read = readers[i][1];
        // Native brand checks reject Proxy/forged objects without reading page getters.
        try { if (append(field, index, apply(read, object, []))) observed = true; } catch {}
      }
      return observed;
    }
    function list(object, lengthGetter, itemMethod, brand, max) {
      if (!lengthGetter || !itemMethod) return;
      const length = apply(lengthGetter, object, []);
      if (!integer(length) || length < 0) return;
      validCollection = true;
      if (length > max) truncated = true;
      for (let i = 0; i < length && i < max && !stopped; i++) brandedFields(apply(itemMethod, object, [i]), brand, i);
    }
    function brands(array) {
      if (!isArray(array)) return;
      const length = data(array, 'length');
      if (!integer(length) || length < 0) return;
      validCollection = true;
      if (length > 32) truncated = true;
      for (let i = 0; i < length && i < 32 && !stopped; i++) {
        const brand = data(array, i);
        if (brand && typeof brand === 'object') { ownField(brand, 'brand', 'brand', i); ownField(brand, 'version', 'version', i); }
      }
    }
    try {
      if (profile === 'languages') strings(result, 'language');
      else if (profile === 'webgl-extensions') strings(result, 'extension');
      else if (profile === 'intl') {
        const names = keys(schemas.intl);
        for (let i = 0; i < names.length && !stopped; i++) if (names[i] !== 'pluralCategory') ownField(result, names[i]);
        const plural = data(result, 'pluralCategories'); if (plural) strings(plural, 'pluralCategory');
      } else if (profile === 'geometry') {
        if (operation === 'Element.getClientRects' || operation === 'Range.getClientRects') list(result, rectLength, rectItem, 'DOMRectReadOnly', 16);
        else if (!brandedFields(result, 'DOMRectReadOnly') && operation === 'SVGGraphicsElement.getBBox') brandedFields(result, 'SVGRect');
      } else if (profile === 'text-metrics') brandedFields(result, 'TextMetrics');
      else if (profile === 'media-query') brandedFields(result, 'MediaQueryList');
      else if (profile === 'plugins') list(result, pluginLength, pluginItem, 'Plugin', 32);
      else if (profile === 'mime-types') list(result, mimeLength, mimeItem, 'MimeType', 42);
      else if (profile === 'ua-data') {
        if (operation === 'NavigatorUAData.brands') brands(result);
        else { ownField(result, 'mobile'); ownField(result, 'platform'); const array = data(result, 'brands'); if (array) brands(array); }
      }
      // An empty valid native collection is represented; missing brand support is not.
      return fields.length || validCollection ? { kind: 'technical', profile, fields, truncated } : null;
    } catch { return null; }
  };
  };
})();
  // ADR-039 technical projector end
  // apps/extension/entrypoints/hook.main.ts
  function installSensors(runtime, realm) {
    registerValueCaptureRealm(runtime, realm);
    runtime.apiResults.projectTechnical = createProTechnicalProjector(realm, runtime.earlyCaptureGuaranteed, PRO_TECHNICAL_OPERATIONS, PRO_TECHNICAL_FIELDS);
    mathSignatureSupport.install(runtime, realm, { wrapMethod }, TECHNIQUE_INDEX, PHASE_INDEX, SIGNAL_BIT);
    cookieWriterSupport.install(runtime, realm);
    workerSurfacesSupport.install(runtime, realm, { wrapConstructor, wrapMethod }, API_OPERATION_INDEX, PHASE_INDEX);
    extendedSurfacesSupport.install(runtime, realm, { wrapMethod, wrapConstructor, wrapSetter });
    backgroundSensorSupport.install(runtime, realm, { wrapMethod });
    socialSensorSupport.install(runtime, realm, { wrapMethod, wrapSetter });
    beaconSensorSupport.install(runtime);
    loaderSensorSupport.install(runtime, realm, { wrapPreparedMethod, wrapSetter });
    try {
      installVisualCapture(runtime, realm);
    } catch {
      runtime.addFlag("hook-failed");
    }
    installCanvasSensor(runtime, realm), installGeometrySensor(runtime, realm), installGraphicsSensor(runtime, realm), installAudioSensor(runtime, realm), installWebRTCSensor(runtime, realm), installEnvironmentSensor(runtime, realm), installBrowserRequestSensor(runtime, realm), installTimingSensor(runtime, realm), installWebAssemblySensor(runtime, realm), installWebNNSensor(runtime, realm), installPermissionsSensor(runtime, realm), installCapabilitySensor(runtime, realm), installInteractionSensor(runtime, realm);
  }
  (() => {
    let MARK = /* @__PURE__ */ Symbol.for("detect.expert/sensor/v1");
    if (Object.getOwnPropertyDescriptor(window, MARK) === void 0) {
      try {
        Object.defineProperty(window, MARK, { value: !0, writable: !1, enumerable: !1, configurable: !1 });
      } catch {
        return;
      }
      try {
        let runtime = new SensorRuntime(browserEnv(window, !0));
        try {
          startChildRealmManager(runtime, window, installSensors);
        } catch {
          runtime.addFlag("hook-failed");
        }
        try {
          installSensors(runtime, window), runtime.start();
        } catch {
          runtime.stop("local");
        }
      } catch {
      }
    }
  })();
})();
