// ADR-101: compile only selected configuration data into a closed native-engine plan.
import { validateApiConfiguration } from './api-configuration.js';

export const FINGERPRINT_ENGINE_LIMITS = Object.freeze({ maxCommands: 6, maxResetCommands: 5, maxFields: 512, maxDimension: 32768, maxDpr: 16, maxConcurrency: 1024, maxSelectedPixels: 64 * 1024 * 1024 });
// These are measured command capabilities, not detection of the current browser.
export const FINGERPRINT_ENGINE_NATIVE_FEATURES = Object.freeze({ colorScheme: true, reducedMotion: true, contrast: true, forcedColors: true, colorGamut: true, dynamicRange: false, hover: false, pointer: false, anyHover: false, anyPointer: false, displayMode: false, update: false, overflowBlock: false, cssSupports: false });
const MEDIA = Object.freeze({ colorScheme: 'prefers-color-scheme', reducedMotion: 'prefers-reduced-motion', contrast: 'prefers-contrast', forcedColors: 'forced-colors', colorGamut: 'color-gamut' });
const ORIENTATION = Object.freeze({ 'portrait-primary': 'portraitPrimary', 'portrait-secondary': 'portraitSecondary', 'landscape-primary': 'landscapePrimary', 'landscape-secondary': 'landscapeSecondary' });
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
function freeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const item of Object.values(value)) freeze(item); Object.freeze(value); } return value; }
function error(code, ids = [], fields = []) { return freeze({ ok: false, error: { code, ids, fields } }); }
function headerData(value) {
  if (typeof value === 'string') return !/[\u0000-\u001f\u007f]/.test(value);
  if (!value || typeof value !== 'object') return true;
  return Object.values(value).every(headerData);
}
function hostValid(host) {
  if (typeof host !== 'string' || host.length < 1 || host.length > 253 || !/^[a-z0-9.:[\]-]+$/.test(host)) return false;
  try { return new URL('https://' + host + '/').hostname === host && !host.includes('..') && !host.endsWith('.'); } catch { return false; }
}

/** Pure compiler. host is used only for existing exact-site inheritance, never returned. */
export function compileFingerprintEngineProfile(input, options = {}) {
  let host = null;
  try {
    if (!options || typeof options !== 'object' || Array.isArray(options)) return error('invalid-options');
    const keys = Reflect.ownKeys(options);
    if (keys.some(key => key !== 'host')) return error('invalid-options');
    if (keys.length) {
      const descriptor = Object.getOwnPropertyDescriptor(options, 'host');
      if (!descriptor || !own(descriptor, 'value')) return error('invalid-options');
      host = descriptor.value;
    }
    if (host !== null && !hostValid(host)) return error('invalid-host');
  } catch { return error('invalid-options'); }
  const validated = validateApiConfiguration(input);
  if (!validated.ok) return error('invalid-configuration');
  const config = validated.value, site = host === null ? null : config.sites.find(item => item.host === host);
  const commands = [], resetCommands = [], handled = new Map(), unsupported = [];
  const active = new Map();
  if (config.antidetectEnabled && !site?.disabled) for (const global of config.apis) {
    const local = site?.apis.find(row => row.id === global.id), row = local && local.mode !== 'bypass' ? local : global;
    if (row.mode === 'custom') active.set(row.id, row.selected.kind === 'value' ? row.selected.value : row.selected.kind === 'null' ? null : undefined);
  }
  const fieldHandled = (id, field) => { if (!handled.has(id)) handled.set(id, []); if (!handled.get(id).includes(field)) handled.get(id).push(field); };
  const unsupportedFields = (id, fields, reason = 'native-override-unavailable') => { if (fields.length) unsupported.push({ id, fields, reason }); };
  const command = (method, params, reset = null) => { commands.push({ method, params }); if (reset) resetCommands.unshift(reset); };
  const value = id => active.get(id), geometry = value('screen-geometry') ?? {}, media = value('css-media') ?? {}, intl = value('intl-formatting') ?? {};
  let conflict = null;
  function choose(aId, aValue, aField, bId, bValue, bField) {
    if (aValue !== undefined && bValue !== undefined && aValue !== bValue) { conflict ??= error('conflicting-values', [aId, bId], [aField, bField]); return undefined; }
    return aValue ?? bValue;
  }
  const width = choose('screen-geometry', geometry.innerWidth, 'innerWidth', 'css-media', media.viewportWidth, 'viewportWidth');
  const height = choose('screen-geometry', geometry.innerHeight, 'innerHeight', 'css-media', media.viewportHeight, 'viewportHeight');
  const dpr = choose('window-device-pixel-ratio', value('window-device-pixel-ratio'), 'value', 'css-media', media.resolutionDppx, 'resolutionDppx');
  if (conflict) return conflict;
  if ((width === undefined) !== (height === undefined)) return error('incomplete-viewport', ['screen-geometry', 'css-media'], ['innerWidth', 'innerHeight', 'viewportWidth', 'viewportHeight']);
  const screenWidth = value('screen-width'), screenHeight = value('screen-height'), orientation = value('screen-orientation');
  if ((screenWidth === undefined) !== (screenHeight === undefined)) return error('incomplete-screen', ['screen-width', 'screen-height'], ['value']);
  // Bound explicitly selected pixel areas. Unselected native dimensions/DPR stay
  // unobserved; this is not an assertion about every browser allocation.
  const factor = (dpr ?? 1) ** 2;
  if (width !== undefined && width * height * factor > FINGERPRINT_ENGINE_LIMITS.maxSelectedPixels || screenWidth !== undefined && screenWidth * screenHeight * factor > FINGERPRINT_ENGINE_LIMITS.maxSelectedPixels) return error('engine-pixel-budget', ['screen-geometry', 'css-media', 'screen-width', 'screen-height', 'window-device-pixel-ratio'], ['width', 'height', 'dpr']);
  if (width !== undefined || dpr !== undefined || screenWidth !== undefined || orientation !== undefined) {
    // Native zero sentinels preserve unselected viewport/DPR rather than sampling them.
    const params = { width: width ?? 0, height: height ?? 0, deviceScaleFactor: dpr ?? 0, mobile: false };
    if (screenWidth !== undefined) { params.screenWidth = screenWidth; params.screenHeight = screenHeight; fieldHandled('screen-width', 'value'); fieldHandled('screen-height', 'value'); }
    if (orientation !== undefined) { params.screenOrientation = { type: ORIENTATION[orientation.type], angle: orientation.angle }; fieldHandled('screen-orientation', 'type'); fieldHandled('screen-orientation', 'angle'); }
    for (const field of ['innerWidth', 'innerHeight']) if (own(geometry, field)) fieldHandled('screen-geometry', field);
    for (const field of ['viewportWidth', 'viewportHeight', 'resolutionDppx']) if (own(media, field)) fieldHandled('css-media', field);
    if (dpr !== undefined && active.has('window-device-pixel-ratio')) fieldHandled('window-device-pixel-ratio', 'value');
    command('Emulation.setDeviceMetricsOverride', params, { method: 'Emulation.clearDeviceMetricsOverride', params: {} });
  }
  const features = [];
  for (const [field, name] of Object.entries(MEDIA)) if (own(media, field)) { features.push({ name, value: media[field] }); fieldHandled('css-media', field); }
  if (features.length) command('Emulation.setEmulatedMedia', { features }, { method: 'Emulation.setEmulatedMedia', params: { features: [] } });
  if (own(intl, 'locale')) { command('Emulation.setLocaleOverride', { locale: intl.locale }, { method: 'Emulation.setLocaleOverride', params: { locale: '' } }); fieldHandled('intl-formatting', 'locale'); }
  const legacy = value('timezone');
  const zone = choose('intl-formatting', intl.timeZone, 'timeZone', 'timezone', legacy?.timeZone === undefined ? undefined : new Intl.DateTimeFormat('en', { timeZone: legacy.timeZone }).resolvedOptions().timeZone, 'timeZone');
  if (conflict) return conflict;
  if (zone !== undefined) {
    command('Emulation.setTimezoneOverride', { timezoneId: zone }, { method: 'Emulation.setTimezoneOverride', params: { timezoneId: '' } });
    if (own(intl, 'timeZone')) fieldHandled('intl-formatting', 'timeZone');
    if (legacy) fieldHandled('timezone', 'timeZone');
  }
  if (active.has('hardware-concurrency')) { command('Emulation.setHardwareConcurrencyOverride', { hardwareConcurrency: value('hardware-concurrency') }); fieldHandled('hardware-concurrency', 'value'); }
  const ua = value('navigator-user-agent'), language = value('navigator-language'), languages = value('navigator-languages'), platform = value('navigator-platform'), hints = value('client-hints');
  if (language !== undefined && languages !== undefined && language !== languages[0]) return error('conflicting-values', ['navigator-language', 'navigator-languages'], ['value', '0']);
  if (ua !== undefined) {
    if (/[\u0000-\u001f\u007f]/.test(ua) || ua.length === 0) return error('invalid-user-agent', ['navigator-user-agent'], ['value']);
    if (!headerData(platform) || !headerData(hints)) return error('invalid-user-agent-metadata', ['navigator-platform', 'client-hints'], ['value']);
    const params = { userAgent: ua };
    if (platform !== undefined) { params.platform = platform; fieldHandled('navigator-platform', 'value'); }
    if (languages !== undefined || language !== undefined) {
      params.acceptLanguage = (languages ?? [language]).join(',');
      if (language !== undefined) fieldHandled('navigator-language', 'value');
      if (languages !== undefined) fieldHandled('navigator-languages', 'value');
    }
    if (hints !== undefined) {
      // CDP requires all high-entropy base fields; never fabricate missing values.
      const required = ['platformVersion', 'architecture', 'model'];
      if (required.every(field => own(hints, field))) {
        params.userAgentMetadata = { ...hints };
        if (own(params.userAgentMetadata, 'uaFullVersion')) { params.userAgentMetadata.fullVersion = params.userAgentMetadata.uaFullVersion; delete params.userAgentMetadata.uaFullVersion; }
        for (const field of Object.keys(hints)) fieldHandled('client-hints', field);
      }
    }
    fieldHandled('navigator-user-agent', 'value'); command('Emulation.setUserAgentOverride', params, { method: 'Emulation.setUserAgentOverride', params: { userAgent: '' } });
  }
  for (const [id, selected] of active) {
    const fields = selected !== null && typeof selected === 'object' && !Array.isArray(selected) ? Object.keys(selected) : ['value'];
    const missing = fields.filter(field => !handled.get(id)?.includes(field));
    unsupportedFields(id, missing, id === 'timezone' ? 'fixed-offset-is-not-native-timezone' : id === 'client-hints' && ua !== undefined ? 'incomplete-native-user-agent-metadata' : 'native-override-unavailable');
  }
  if (commands.length > FINGERPRINT_ENGINE_LIMITS.maxCommands || resetCommands.length > FINGERPRINT_ENGINE_LIMITS.maxResetCommands || unsupported.reduce((sum, item) => sum + item.fields.length, 0) > FINGERPRINT_ENGINE_LIMITS.maxFields) return error('engine-plan-limit');
  return freeze({ ok: true, status: unsupported.length ? 'partial' : commands.length ? 'ready' : 'empty', commands, resetCommands, handledIds: [...handled.keys()], handledFields: [...handled].map(([id, fields]) => ({ id, fields })), unsupported, nativeFeatureSupport: FINGERPRINT_ENGINE_NATIVE_FEATURES,
    lifecycle: { ownedTabOnly: true, detachRequired: true, closeOwnedTarget: true, hardwareConcurrencyReset: 'detach', userAgentReset: 'close-owned-target', outerGeometryRestored: false } });
}
