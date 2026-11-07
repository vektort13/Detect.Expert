// Display names of operation codes (ADR-017): plain ASCII API names from the built-in list, shown by the UI next
// to a technique. Names describe what was asked, never a value the browser returned. `*-other` / `*-unclassified`
// still carry a technical name here; the UI shows a localized phrase for them instead.

import type { OperationCode } from './operations';

export const OPERATION_API_NAMES: Readonly<Record<OperationCode, string>> = Object.freeze({
  // DET-005
  'get-client-rects': 'Element.getClientRects',
  'get-bounding-client-rect': 'Element.getBoundingClientRect',
  'offset-width': 'HTMLElement.offsetWidth',
  'offset-height': 'HTMLElement.offsetHeight',
  // DET-011
  'param-vendor': 'WebGL getParameter(VENDOR)',
  'param-renderer': 'WebGL getParameter(RENDERER)',
  'param-version': 'WebGL getParameter(VERSION)',
  'param-shading-language-version': 'WebGL getParameter(SHADING_LANGUAGE_VERSION)',
  'param-unmasked-vendor': 'WebGL getParameter(UNMASKED_VENDOR_WEBGL)',
  'param-unmasked-renderer': 'WebGL getParameter(UNMASKED_RENDERER_WEBGL)',
  'param-limit': 'WebGL getParameter(MAX_* and other limits)',
  'param-other': 'WebGL getParameter(other)',
  'param-unclassified': 'WebGL getParameter(?)',
  'ext-debug-renderer-info': 'WebGL getExtension(WEBGL_debug_renderer_info)',
  'ext-other': 'WebGL getExtension(other)',
  'ext-unclassified': 'WebGL getExtension(?)',
  'supported-extensions': 'WebGL getSupportedExtensions',
  'shader-precision-format': 'WebGL getShaderPrecisionFormat',
  // DET-012
  'read-pixels': 'WebGL readPixels',
  // DET-015
  'start-rendering': 'OfflineAudioContext.startRendering',
  'create-oscillator': 'BaseAudioContext.createOscillator',
  'create-dynamics-compressor': 'BaseAudioContext.createDynamicsCompressor',
  'connect-osc-compressor': 'AudioNode.connect(Oscillator->DynamicsCompressor)',
  // DET-016
  'get-channel-data': 'AudioBuffer.getChannelData',
  'copy-from-channel': 'AudioBuffer.copyFromChannel',
  'analyser-float-frequency': 'AnalyserNode.getFloatFrequencyData',
  'analyser-byte-frequency': 'AnalyserNode.getByteFrequencyData',
  'analyser-float-time-domain': 'AnalyserNode.getFloatTimeDomainData',
  'analyser-byte-time-domain': 'AnalyserNode.getByteTimeDomainData',
  // DET-025
  'user-agent': 'Navigator.userAgent',
  platform: 'Navigator.platform',
  vendor: 'Navigator.vendor',
  language: 'Navigator.language',
  languages: 'Navigator.languages',
  // DET-026
  'user-agent-data': 'Navigator.userAgentData',
  'ua-brands': 'NavigatorUAData.brands',
  'ua-mobile': 'NavigatorUAData.mobile',
  'ua-platform': 'NavigatorUAData.platform',
  'ua-to-json': 'NavigatorUAData.toJSON',
  'get-high-entropy-values': 'NavigatorUAData.getHighEntropyValues',
  // DET-029
  width: 'Screen.width',
  height: 'Screen.height',
  'avail-width': 'Screen.availWidth',
  'avail-height': 'Screen.availHeight',
  'color-depth': 'Screen.colorDepth',
  'pixel-depth': 'Screen.pixelDepth',
  orientation: 'Screen.orientation',
  // DET-039
  query: 'Permissions.query',
  'state-location': 'PermissionStatus.state',
  'state-notifications': 'PermissionStatus.state',
  'state-media': 'PermissionStatus.state',
  'state-sensors': 'PermissionStatus.state',
  'state-midi': 'PermissionStatus.state',
  'state-clipboard': 'PermissionStatus.state',
  'state-storage': 'PermissionStatus.state',
  'state-other': 'PermissionStatus.state',
  'state-unclassified': 'PermissionStatus.state',
});

/** ASCII API name of an operation code (never empty for a registry member). */
export function operationApiName(op: OperationCode): string {
  return OPERATION_API_NAMES[op];
}
