// ADR-087: bounded, data-only Custom profiles. These names select existing APIs;
// schema acceptance does not create a browser feature, device or capability.
export const GL_CUSTOM_PARAMETERS = Object.freeze(['VERSION', 'SHADING_LANGUAGE_VERSION', 'MAX_TEXTURE_SIZE', 'MAX_VIEWPORT_DIMS', 'MAX_VERTEX_ATTRIBS', 'MAX_TEXTURE_IMAGE_UNITS', 'MAX_VERTEX_TEXTURE_IMAGE_UNITS', 'MAX_COMBINED_TEXTURE_IMAGE_UNITS', 'MAX_VERTEX_UNIFORM_VECTORS', 'MAX_FRAGMENT_UNIFORM_VECTORS', 'MAX_VARYING_VECTORS', 'MAX_RENDERBUFFER_SIZE', 'MAX_CUBE_MAP_TEXTURE_SIZE', 'MAX_3D_TEXTURE_SIZE', 'MAX_ARRAY_TEXTURE_LAYERS', 'MAX_DRAW_BUFFERS', 'MAX_COLOR_ATTACHMENTS', 'MAX_SAMPLES', 'MAX_UNIFORM_BUFFER_BINDINGS', 'RED_BITS', 'GREEN_BITS', 'BLUE_BITS', 'ALPHA_BITS', 'DEPTH_BITS', 'STENCIL_BITS', 'SUBPIXEL_BITS', 'MAX_ELEMENT_INDEX', 'ALIASED_LINE_WIDTH_RANGE', 'ALIASED_POINT_SIZE_RANGE']);
export const GPU_CUSTOM_LIMITS = Object.freeze(['maxTextureDimension1D', 'maxTextureDimension2D', 'maxTextureDimension3D', 'maxTextureArrayLayers', 'maxBindGroups', 'maxBindGroupsPlusVertexBuffers', 'maxBindingsPerBindGroup', 'maxDynamicUniformBuffersPerPipelineLayout', 'maxDynamicStorageBuffersPerPipelineLayout', 'maxSampledTexturesPerShaderStage', 'maxSamplersPerShaderStage', 'maxStorageBuffersPerShaderStage', 'maxStorageTexturesPerShaderStage', 'maxUniformBuffersPerShaderStage', 'maxUniformBufferBindingSize', 'maxStorageBufferBindingSize', 'minUniformBufferOffsetAlignment', 'minStorageBufferOffsetAlignment', 'maxVertexBuffers', 'maxBufferSize', 'maxVertexAttributes', 'maxVertexBufferArrayStride', 'maxInterStageShaderVariables', 'maxColorAttachments', 'maxColorAttachmentBytesPerSample', 'maxComputeWorkgroupStorageSize', 'maxComputeInvocationsPerWorkgroup', 'maxComputeWorkgroupSizeX', 'maxComputeWorkgroupSizeY', 'maxComputeWorkgroupSizeZ', 'maxComputeWorkgroupsPerDimension']);
export const BROWSER_DISABLED_GLOBALS = Object.freeze(['SharedArrayBuffer', 'Atomics', 'BigInt64Array', 'BigUint64Array', 'ResizeObserver', 'IntersectionObserver', 'scheduler', 'reportError', 'structuredClone', 'navigation', 'PerformanceObserver', 'WebGL2RenderingContext', 'OffscreenCanvas', 'AudioWorkletNode']);
export const BROWSER_DISABLED_NAVIGATOR = Object.freeze(['gpu', 'usb', 'hid', 'bluetooth', 'serial', 'wakeLock', 'credentials', 'locks', 'presentation', 'keyboard', 'getBattery', 'connection']);
const entry = (id, name, group, values) => ({ id, name, group, spec: { type: id, bundle: id, values } });
function freeze(value) { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child);Object.freeze(value); }return value; }
export const FINGERPRINT_CUSTOM_ENTRIES = freeze([
  entry('navigator-metadata', 'Navigator.appCodeName / product / doNotTrack', 'system', [{ product: 'Gecko', productSub: '20030107', vendorSub: '' }]),
  entry('navigator-plugins', 'Navigator.plugins / mimeTypes', 'system', [{ plugins: [] }]),
  entry('screen-geometry', 'Window.innerWidth / outerWidth / Screen.availLeft', 'graphics', [{ availLeft: 0, availTop: 0 }]),
  entry('css-media', 'Window.matchMedia', 'graphics', [{ colorScheme: 'light', reducedMotion: 'no-preference' }, { colorScheme: 'dark', reducedMotion: 'reduce' }]),
  entry('css-supports', 'CSS.supports', 'graphics', [{ queries: [] }]),
  entry('intl-formatting', 'Intl.DateTimeFormat / NumberFormat', 'system', [{ locale: 'en-US', timeZone: 'UTC' }, { locale: 'de-DE', timeZone: 'Europe/Berlin' }]),
  entry('webgl-capabilities', 'WebGLRenderingContext.getParameter / getSupportedExtensions', 'graphics', [{ parameters: { MAX_TEXTURE_SIZE: 4096 }, extensions: [] }]),
  entry('webgpu-capabilities', 'GPUAdapter.limits / features', 'graphics', [{ features: [] }]),
  entry('canvas-text-metrics', 'CanvasRenderingContext2D.measureText', 'graphics', [{ scale: 1.01 }]),
  entry('audio-fingerprint', 'AudioBuffer.getChannelData / copyFromChannel', 'media', [{ seed: '00112233445566778899aabbccddeeff', amplitude: 0.00001 }]),
  entry('audio-metadata', 'AudioContext.sampleRate / baseLatency / outputLatency', 'media', [{ sampleRate: 48000 }]),
  entry('clock-precision', 'Performance.now / Date.now', 'browser', [{ resolutionMs: 1 }, { resolutionMs: 10 }]),
  entry('canvas-font-policy', 'CanvasRenderingContext2D.font', 'graphics', [{ families: ['sans-serif'], fallback: 'sans-serif' }]),
  entry('browser-surface', 'Window.SharedArrayBuffer / Navigator.gpu', 'browser', [{ disabledGlobals: ['SharedArrayBuffer'], chrome: 'preserve' }]),
  entry('webgl-readback', 'WebGLRenderingContext.readPixels', 'graphics', [{ seed: '00112233445566778899aabbccddeeff' }])
]);

export function validateFingerprintCustomValue(id, value, path, fail) {
  const invalid = (where = path, message = 'Invalid Custom profile value.') => fail('invalid-value', where, message);
  const object = (raw, required, optional = [], nonempty = false, where = path) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid(where);
    const keys = Object.keys(raw);
    if (required.some(key => !Object.hasOwn(raw, key)) || keys.some(key => !required.includes(key) && !optional.includes(key)) || nonempty && keys.length === 0) invalid(where);
  };
  const text = (raw, min = 0, max = 512, where = path) => { if (typeof raw !== 'string' || raw.length < min || raw.length > max) invalid(where); };
  const number = (raw, min, max, integer = false, where = path) => { if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < min || raw > max || integer && !Number.isSafeInteger(raw)) invalid(where); };
  const boolean = raw => { if (typeof raw !== 'boolean') invalid(); };
  const strings = (raw, max, maxLength = 128, allowed = null) => {
    if (!Array.isArray(raw) || raw.length > max) invalid();
    for (const item of raw) { text(item, 1, maxLength);if (allowed && !allowed.includes(item)) invalid(); }
    if (new Set(raw).size !== raw.length) invalid(path, 'Duplicate values are not allowed.');
  };
  const seed = raw => { if (typeof raw !== 'string' || !/^[a-f0-9]{32}$/u.test(raw)) invalid(path, 'Expected a 32-character lowercase hexadecimal seed.'); };
  const output = structuredClone(value);
  if (id === 'navigator-metadata') {
    const names = ['appCodeName', 'appName', 'vendorSub', 'product', 'productSub', 'buildID', 'cookieEnabled', 'doNotTrack', 'pdfViewerEnabled', 'webdriver', 'globalPrivacyControl'];
    object(output, [], names, true);
    for (const [key, raw] of Object.entries(output)) {
      if (['cookieEnabled', 'pdfViewerEnabled', 'webdriver', 'globalPrivacyControl'].includes(key)) boolean(raw);
      else if (key === 'doNotTrack') { if (raw !== null) text(raw, 0, 64); }
      else text(raw, 0, 4096);
    }
  } else if (id === 'navigator-plugins') {
    object(output, ['plugins']);
    if (!Array.isArray(output.plugins) || output.plugins.length > 16) invalid();
    const names = new Set(), mimeTypes = new Map();let total = 0;
    for (const plugin of output.plugins) {
      object(plugin, ['name', 'filename', 'description', 'mimeTypes']);
      for (const key of ['name', 'filename', 'description']) text(plugin[key]);
      if (names.has(plugin.name)) invalid(path, 'Duplicate plugin names.');names.add(plugin.name);
      if (!Array.isArray(plugin.mimeTypes) || plugin.mimeTypes.length > 32 || (total += plugin.mimeTypes.length) > 64) invalid();
      const local = new Set();
      for (const mime of plugin.mimeTypes) {
        object(mime, ['type', 'suffixes', 'description']);text(mime.type, 1, 128);text(mime.suffixes, 0, 256);text(mime.description);
        if (local.has(mime.type)) invalid(path, 'Duplicate plugin MIME type.');local.add(mime.type);
        const prior = mimeTypes.get(mime.type);
        if (prior && (prior.suffixes !== mime.suffixes || prior.description !== mime.description)) invalid(path, 'Conflicting shared MIME metadata.');
        mimeTypes.set(mime.type, mime);
      }
    }
  } else if (id === 'screen-geometry') {
    object(output, [], ['availLeft', 'availTop', 'innerWidth', 'innerHeight', 'outerWidth', 'outerHeight', 'screenX', 'screenY', 'scrollbarsVisible', 'toolbarVisible'], true);
    for (const [key, raw] of Object.entries(output)) {
      if (key.endsWith('Visible')) boolean(raw);
      else if (['availLeft', 'availTop', 'screenX', 'screenY'].includes(key)) number(raw, -131072, 131072, true);
      else number(raw, 1, 32768, true);
    }
  } else if (id === 'css-media') {
    const enums = { colorScheme: ['light', 'dark'], reducedMotion: ['no-preference', 'reduce'], contrast: ['no-preference', 'more', 'less', 'custom'], forcedColors: ['none', 'active'], hover: ['none', 'hover'], pointer: ['none', 'fine', 'coarse'], anyHover: ['none', 'hover'], anyPointer: ['none', 'fine', 'coarse'], displayMode: ['browser', 'fullscreen', 'standalone', 'minimal-ui', 'picture-in-picture', 'window-controls-overlay'], colorGamut: ['srgb', 'p3', 'rec2020'], dynamicRange: ['standard', 'high'], update: ['none', 'slow', 'fast'], overflowBlock: ['none', 'scroll', 'paged'] };
    object(output, [], [...Object.keys(enums), 'grid', 'viewportWidth', 'viewportHeight', 'resolutionDppx'], true);
    for (const [key, raw] of Object.entries(output)) {
      if (enums[key]) { if (!enums[key].includes(raw)) invalid(); }
      else if (key === 'grid') boolean(raw);
      else if (key === 'resolutionDppx') number(raw, 0.1, 16);
      else number(raw, 1, 32768, true);
    }
  } else if (id === 'css-supports') {
    object(output, ['queries']);
    if (!Array.isArray(output.queries) || output.queries.length > 128) invalid();
    const seen = new Set();
    for (const query of output.queries) {
      object(query, ['query', 'supported']);text(query.query, 1, 4096);boolean(query.supported);
      query.query = query.query.trim();text(query.query, 1, 4096);
      if (seen.has(query.query)) invalid(path, 'Duplicate CSS support query.');seen.add(query.query);
    }
  } else if (id === 'intl-formatting') {
    object(output, [], ['locale', 'timeZone', 'calendar', 'numberingSystem'], true);
    if (Object.hasOwn(output, 'locale')) {
      text(output.locale, 1, 128);
      try { const locales = Intl.getCanonicalLocales(output.locale);if (locales.length !== 1) invalid();output.locale = locales[0]; } catch { invalid(path, 'Invalid locale.'); }
    }
    if (Object.hasOwn(output, 'timeZone')) {
      text(output.timeZone, 1, 128);
      try { output.timeZone = new Intl.DateTimeFormat('en', { timeZone: output.timeZone }).resolvedOptions().timeZone; } catch { invalid(path, 'Invalid time zone.'); }
    }
    for (const key of ['calendar', 'numberingSystem']) if (Object.hasOwn(output, key)) {
      text(output[key], 3, 128);if (!/^[a-z0-9]{3,8}(?:-[a-z0-9]{3,8})*$/iu.test(output[key])) invalid();
      output[key] = output[key].toLowerCase();
      try { if (new Intl.DateTimeFormat('en', { [key]: output[key] }).resolvedOptions()[key] !== output[key]) invalid(path, 'Unsupported Intl option.'); } catch { invalid(path, 'Unsupported Intl option.'); }
    }
  } else if (id === 'webgl-capabilities') {
    object(output, [], ['parameters', 'extensions'], true);
    if (Object.hasOwn(output, 'parameters')) {
      object(output.parameters, [], GL_CUSTOM_PARAMETERS, !Object.hasOwn(output, 'extensions'));
      for (const [key, raw] of Object.entries(output.parameters)) {
        if (['VERSION', 'SHADING_LANGUAGE_VERSION'].includes(key)) text(raw, 0, 512);
        else if (['MAX_VIEWPORT_DIMS', 'ALIASED_LINE_WIDTH_RANGE', 'ALIASED_POINT_SIZE_RANGE'].includes(key)) {
          if (!Array.isArray(raw) || raw.length !== 2) invalid();
          for (const item of raw) number(item, 0, Number.MAX_SAFE_INTEGER, key === 'MAX_VIEWPORT_DIMS');
          if (key !== 'MAX_VIEWPORT_DIMS' && raw[0] > raw[1]) invalid();
        } else number(raw, 0, Number.MAX_SAFE_INTEGER, true);
      }
    }
    if (Object.hasOwn(output, 'extensions')) strings(output.extensions, 128, 128);
  } else if (id === 'webgpu-capabilities') {
    object(output, [], ['limits', 'features'], true);
    if (Object.hasOwn(output, 'limits')) {
      object(output.limits, [], GPU_CUSTOM_LIMITS, !Object.hasOwn(output, 'features'));
      for (const [key, raw] of Object.entries(output.limits)) {
        number(raw, 1, key.startsWith('min') ? 256 : Number.MAX_SAFE_INTEGER, true);
        if (key.startsWith('min') && (raw & (raw - 1)) !== 0) invalid(path, 'GPU alignment must be a power of two.');
      }
    }
    if (Object.hasOwn(output, 'features')) strings(output.features, 128, 128);
  } else if (id === 'canvas-text-metrics') {
    object(output, ['scale']);number(output.scale, 0.9, 1.1);
  } else if (id === 'audio-fingerprint') {
    object(output, ['seed'], ['amplitude']);seed(output.seed);
    if (!Object.hasOwn(output, 'amplitude')) output.amplitude = 0.00001;
    number(output.amplitude, 0.0000001, 0.001);
  } else if (id === 'audio-metadata') {
    object(output, [], ['sampleRate', 'baseLatency', 'outputLatency', 'maxChannelCount'], true);
    for (const [key, raw] of Object.entries(output)) {
      if (key === 'sampleRate') number(raw, 8000, 192000, true);
      else if (key === 'maxChannelCount') number(raw, 1, 32, true);
      else number(raw, 0, 10);
    }
  } else if (id === 'clock-precision') {
    object(output, ['resolutionMs']);number(output.resolutionMs, 0.1, 1000);
  } else if (id === 'canvas-font-policy') {
    object(output, ['families', 'fallback']);strings(output.families, 256, 256);text(output.fallback, 1, 256);
    for (const family of [...output.families, output.fallback]) if (!family.trim() || /[\u0000-\u001f\u007f"'\\,;]/u.test(family)) invalid(path, 'Expected one unescaped font family without CSS separators.');
  } else if (id === 'browser-surface') {
    object(output, [], ['disabledGlobals', 'disabledNavigator', 'chrome'], true);
    if (Object.hasOwn(output, 'disabledGlobals')) strings(output.disabledGlobals, BROWSER_DISABLED_GLOBALS.length, 128, BROWSER_DISABLED_GLOBALS);
    if (Object.hasOwn(output, 'disabledNavigator')) strings(output.disabledNavigator, BROWSER_DISABLED_NAVIGATOR.length, 128, BROWSER_DISABLED_NAVIGATOR);
    if (Object.hasOwn(output, 'chrome') && !['hidden', 'preserve'].includes(output.chrome)) invalid();
  } else if (id === 'webgl-readback') {
    object(output, ['seed']);seed(output.seed);
  } else invalid(path, 'Unknown fingerprint Custom bundle.');
  return output;
}
