// ADR-049: validated data and packaged installer source registered before page code.
// The generated source is passed to the browser userScripts API; it is never evaluated here.
import { validateApiConfiguration } from './api-configuration.js';
import { PROTECTION_FEATURES } from './api-protection-features.js';
import { installApiCustom } from './api-custom-runtime.js';
import { installApiCustomDocument } from './api-custom-document-runtime.js';
import { installWebRtcCustom } from './api-custom-webrtc-runtime.js';
import { installAntidetectBlocks } from './antidetect-block-runtime.js';
import { installMathCustom } from './api-custom-math-runtime.js';
import { installCanvasCustom } from './api-custom-canvas-runtime.js';
import { installGeolocationCustom } from './api-custom-geolocation-runtime.js';
import { installApiCustomEnvironment } from './api-custom-environment-runtime.js';
import { installIntlCustom } from './api-custom-intl-runtime.js';
import { installSurfaceCustom } from './api-custom-surfaces-runtime.js';
import { installFontShield } from './api-custom-font-shield-runtime.js';
import { hiddenFontNames } from './font-probe-names.js';
import { installMediaCapabilitiesBridge } from './api-custom-media-bridge.js';
import { mediaProfileChannel } from './api-custom-media-profile.js';
import { createMediaCodecMatcher } from './api-custom-media-codecs.js';
import { installMediaTypeHooks } from './api-custom-media-types.js';

export const API_CUSTOM_SCRIPT_PREFIX = 'detector-api-custom-profile-v2-';
export const BUILD_API_CUSTOM_PREFIX = API_CUSTOM_SCRIPT_PREFIX;
const OLD_IDS = new Set(PROTECTION_FEATURES);
const EARLY_BLOCK_IDS = new Set(['webrtc', 'websocket', 'webtransport']);
const ENVIRONMENT_IDS = new Set(['navigator-metadata', 'navigator-plugins', 'screen-geometry', 'css-media', 'css-supports']);
const SURFACE_IDS = new Set(['webgl-capabilities', 'webgpu-capabilities', 'canvas-text-metrics', 'audio-fingerprint', 'audio-metadata', 'clock-precision', 'canvas-font-policy', 'browser-surface', 'webgl-readback']);
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
function exactHost(host) {
  if (typeof host !== 'string' || host.length < 1 || host.length > 253 || !/^[a-z0-9.:[\]-]+$/.test(host) || host.includes('..') || host.endsWith('.')) return false;
  try { return new URL('https://' + host + '/').hostname === host; } catch { return false; }
}
function readPattern(pattern) {
  if (typeof pattern !== 'string' || pattern.length > 2048) return null;
  const match = /^(https?):\/\/([^/]+)(\/[^\s#]*)$/.exec(pattern);
  if (!match) return null;
  const [, scheme, host, path] = match;
  if (host !== '*' && !(host.startsWith('*.') ? exactHost(host.slice(2)) && !host.slice(2).includes(':') : exactHost(host))) return null;
  return { pattern, scheme, host, path };
}
function scopePatterns(values) {
  if (!Array.isArray(values) || values.length > 512) throw new TypeError('Invalid API configuration scope.');
  const expanded = values.flatMap(value => value === '<all_urls>' ? ['http://*/*', 'https://*/*'] : typeof value === 'string' && value.startsWith('*://') ? ['http://' + value.slice(4), 'https://' + value.slice(4)] : [value]);
  return [...new Set(expanded)].sort(compare).map(readPattern).filter(Boolean);
}
function coversHost(grant, host) {
  if (grant.host === '*') return true;
  if (grant.host.startsWith('*.')) { const suffix = grant.host.slice(2); return host === suffix || host.endsWith('.' + suffix); }
  return grant.host === host;
}
function effectiveEntries(configuration, site = null) {
  if (site?.disabled) return [];
  return configuration.apis.flatMap(global => {
    const local = site?.apis.find(entry => entry.id === global.id), row = local && local.mode !== 'bypass' ? local : global;
    if (row.mode === 'custom' && row.id === 'math-transcendentals' && row.selected.value.functions.length === 0) return [];
    return row.mode === 'custom' && configuration.antidetectEnabled ? [{ id: row.id, mode: 'custom', selected: row.selected }] : row.mode === 'on' && configuration.enabled && (!OLD_IDS.has(row.id) || EARLY_BLOCK_IDS.has(row.id)) ? [{ id: row.id, mode: 'on', selected: { kind: 'unset' } }] : [];
  });
}
function literal(value) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
}
// ADR-107: private per-profile keys (64 hex, HMAC of the local noise root, see profile-noise-seed.js) for rows whose portable
// value seed is only part of the profile identity. Field names on the packed entry: audio-fingerprint -> audioKey,
// webgl-readback -> webglKey (+ canvasKey = the Canvas key when canvas-readback is Custom in the same scope, so readPixels and
// the Canvas exports agree), network-information -> networkKey. A Custom row with a value and no valid key is a registration error.
const PROFILE_KEYS = { 'audio-fingerprint': ['audioSeed', 'audioKey', 'Audio'], 'webgl-readback': ['webglSeed', 'webglKey', 'WebGL readback'], 'network-information': ['networkSeed', 'networkKey', 'Network Information'] };
const HEX64 = /^[a-f0-9]{64}$/;
function source(entriesIn, { deviceSeeds, mathSeed, canvasSeed, ...keys }, mediaBitrateBits) {
  // A Custom time zone alone also selects the genuine Intl formatter zone (no metadata-only mode that says Tokyo while Intl formats in the real zone).
  const zoneRow = entriesIn.find(entry => entry.id === 'timezone' && entry.mode === 'custom');
  const hasIntlRow = entriesIn.some(entry => entry.id === 'intl-formatting' && entry.mode === 'custom');
  const withZone = zoneRow && !hasIntlRow ? [...entriesIn.filter(entry => entry.id !== 'intl-formatting'), { id: 'intl-formatting', mode: 'custom', selected: { kind: 'value', value: { timeZone: zoneRow.selected.value.timeZone } } }] : entriesIn;
  // A Custom screen size or pixel ratio alone must also reach matchMedia (device-width/height, resolution), otherwise JS and CSS media queries disagree.
  // The environment evaluator is installed with a css-media row, so add a minimal one: the ratio when present; viewport width/height stay native (no viewport keys).
  // An explicit css-media row keeps its own meaning and is never supplemented or merged with the Screen / ratio rows.
  const selectedNumber = id => withZone.find(entry => entry.id === id && entry.mode === 'custom' && entry.selected.kind === 'value' && typeof entry.selected.value === 'number');
  const ratioRow = selectedNumber('window-device-pixel-ratio');
  const entries = !withZone.some(entry => entry.id === 'css-media') && (ratioRow || selectedNumber('screen-width') || selectedNumber('screen-height')) ?
    [...withZone, { id: 'css-media', mode: 'custom', selected: { kind: 'value', value: ratioRow ? { resolutionDppx: ratioRow.selected.value } : {} } }] : withZone;
  const documentInstaller = installApiCustomDocument.toString(), installer = installApiCustom.toString();
  const hasRtc = entries.some(entry => entry.id === 'webrtc' && entry.mode === 'custom');
  const hasMath = entries.some(entry => entry.id === 'math-transcendentals' && entry.mode === 'custom' && entry.selected.value.functions.length);
  const hasCanvas = entries.some(entry => entry.id === 'canvas-readback' && entry.mode === 'custom');
  const hasGeolocation = entries.some(entry => entry.id === 'geolocation' && entry.mode === 'custom');
  const hasEnvironment = entries.some(entry => ENVIRONMENT_IDS.has(entry.id) && entry.mode === 'custom');
  const hasIntl = entries.some(entry => entry.id === 'intl-formatting' && entry.mode === 'custom');
  const hasSurfaces = entries.some(entry => SURFACE_IDS.has(entry.id) && entry.mode === 'custom');
  // ADR-110: the font row also shields HTML/CSS font probing (one adopted style sheet of @font-face rules for the listed family names).
  const hasFonts = entries.some(entry => entry.id === 'canvas-font-policy' && entry.mode === 'custom' && entry.selected.kind === 'value');
  const media =entries.find(entry => entry.id === 'media-capabilities' && entry.mode === 'custom');
  // Round 5: Custom only lowers what the browser reports. A profile that keeps every flag and hides nothing IS the native answer:
  // no bridge and no hook, the page keeps the native Promise. The type hooks exist only when a codec family is hidden or supported is false.
  const mediaMask = media ? createMediaCodecMatcher().mask(media.selected.value) : 0;
  const mediaLowers = !!media && (mediaMask !== 0 || !media.selected.value.supported || !media.selected.value.smooth || !media.selected.value.powerEfficient);
  const inheritedZone = entries.find(entry => entry.id === 'timezone' && entry.mode === 'custom')?.selected.value?.timeZone;
  const hasIntlRuntime = hasIntl || typeof inheritedZone === 'string';
  const packed = entries.map(entry => {
    if (entry.id === 'intl-formatting' && entry.mode === 'custom' && entry.selected.value.timeZone === undefined && typeof inheritedZone === 'string') {
      return { ...entry, selected: { kind: 'value', value: { ...entry.selected.value, timeZone: inheritedZone } } };
    }
    // ADR-110: only the names the allow-list does not keep travel to the page; the installer never sees the whole list.
    if (entry.id === 'canvas-font-policy' && entry.mode === 'custom' && entry.selected.kind === 'value') return { ...entry, fontShadow: hiddenFontNames(entry.selected.value.families) };
    if (entry.id === 'canvas-readback' && hasCanvas) {
      if (typeof canvasSeed !== 'string' || !/^[a-f0-9]{64}$/.test(canvasSeed)) throw new TypeError('Canvas profiles require a persisted profile seed.');
      return { ...entry, canvasSeed };
    }
    if (entry.id === 'math-transcendentals' && hasMath) {
      if (typeof mathSeed !== 'string' || !/^[a-f0-9]{64}$/.test(mathSeed)) throw new TypeError('Math profiles require a persisted profile seed.');
      return { ...entry, mathSeed };
    }
    const profileKey = Object.hasOwn(PROFILE_KEYS, entry.id) && entry.mode === 'custom' && entry.selected.kind === 'value' ? PROFILE_KEYS[entry.id] : null;
    if (profileKey) {
      const key = keys[profileKey[0]];
      if (typeof key !== 'string' || !HEX64.test(key)) throw new TypeError(profileKey[2] + ' profiles require a persisted profile key.');
      if (entry.id !== 'webgl-readback' || !hasCanvas) return { ...entry, [profileKey[1]]: key };
      if (typeof canvasSeed !== 'string' || !HEX64.test(canvasSeed)) throw new TypeError('Canvas profiles require a persisted profile seed.');
      return { ...entry, webglKey: key, canvasKey: canvasSeed };
    }
    if (entry.id !== 'webrtc' || entry.mode !== 'custom' || !entry.selected.value.randomizeDevices) return entry;
    const deviceSeed = deviceSeeds?.[entry.selected.value.deviceLifetime];
    if (typeof deviceSeed !== 'string' || !/^[a-f0-9]{64}$/.test(deviceSeed)) throw new TypeError('WebRTC device identifiers require a persisted random seed.');
    return { ...entry, deviceSeed };
  });
  return "'use strict';\n(() => {\n" +
    '  const packed = ' + literal(packed) + ';\n' +
    "  const entries = packed.map(entry => ({ id: entry.id, mode: entry.mode, value: entry.selected.kind === 'value' ? entry.selected.value : entry.selected.kind === 'null' ? null : undefined, deviceSeed: entry.deviceSeed, mathSeed: entry.mathSeed, canvasSeed: entry.canvasSeed, audioKey: entry.audioKey, webglKey: entry.webglKey, canvasKey: entry.canvasKey, networkKey: entry.networkKey, fontShadow: entry.fontShadow }));\n" +
    '  const base = (' + installer + '), block = (' + installAntidetectBlocks.toString() + ');\n' +
    (hasRtc ? '  const rtc = (' + installWebRtcCustom.toString() + ');\n' : '') +
    (hasMath ? '  const math = (' + installMathCustom.toString() + ');\n' : '') +
    (hasCanvas ? '  const canvas = (' + installCanvasCustom.toString() + ');\n' : '') +
    (hasGeolocation ? '  const geolocation = (' + installGeolocationCustom.toString() + ');\n' : '') +
    (hasEnvironment ? '  const environment = (' + installApiCustomEnvironment.toString() + ');\n' : '') +
    (hasIntlRuntime ? '  const intl = (' + installIntlCustom.toString() + ');\n' : '') +
    (hasSurfaces ? '  const surfaces = (' + installSurfaceCustom.toString() + ');\n' : '') +
    (hasFonts ? '  const fonts = (' + installFontShield.toString() + ');\n' : '') +
    (mediaLowers ? '  const media = (' + installMediaCapabilitiesBridge.toString() + '), mediaCodecs = (' + createMediaCodecMatcher.toString() + ')();\n' : '') +
    (mediaMask !== 0 ? '  const mediaTypes = (' + installMediaTypeHooks.toString() + ');\n' : '') +
    '  const extendedIds = ' + literal([...ENVIRONMENT_IDS, ...SURFACE_IDS, 'intl-formatting', 'geolocation', ...(media ? ['media-capabilities'] : [])]) + ';\n' +
    // The genuine Intl formatter owns its actual timeZone and formatting slots.
    // The older metadata-only route must not overwrite its resolvedOptions.
    '  const baseEntries = entries.filter(entry => !extendedIds.includes(entry.id) && entry.id !== "webrtc" && entry.id !== "math-transcendentals" && !(entry.id === "canvas-readback" && entry.mode === "custom") && !(entry.mode === "on" && (entry.id === "websocket" || entry.id === "webtransport"))).map(entry => ' + (hasIntl ? 'entry.id === "timezone" && entry.mode === "custom" ? { ...entry, dateOffsetOnly: true } : entry' : 'entry') + ');\n' +
    '  const blockEntries = entries.filter(entry => entry.mode === "on" && (entry.id === "webrtc" || entry.id === "websocket" || entry.id === "webtransport"));\n' +
    '  function install(realm) { if (blockEntries.length) block(realm, blockEntries);' + (hasFonts ? ' fonts(realm, entries);' : '') + (hasSurfaces ? ' surfaces(realm, entries.filter(entry => entry.id !== "browser-surface"));' : '') + (hasIntlRuntime ? ' const intlGuard = intl(realm, entries);' : '') + ' base(realm, baseEntries' + (hasIntlRuntime ? ', intlGuard.nativeContext' : '') + ');' + (mediaLowers ? ' media(realm, '+literal(media.selected.value)+', '+literal({channel:mediaProfileChannel(media.selected.value),bitrateBits:mediaBitrateBits})+', mediaCodecs);' : '') + (mediaMask !== 0 ? ' try { mediaTypes(realm, ' + mediaMask + ', mediaCodecs); } catch { /* the type queries stay native */ }' : '') + (hasEnvironment ? ' environment(realm, entries);' : '') + (hasRtc ? ' rtc(realm, entries);' : '') + (hasMath ? ' math(realm, entries);' : '') + (hasCanvas ? ' canvas(realm, entries);' : '') + (hasGeolocation ? ' geolocation(realm, entries);' : '') + (hasSurfaces ? ' surfaces(realm, entries.filter(entry => entry.id === "browser-surface"));' : '') + ' }\n' +
    // ADR-110: the font shield is bound to a document, so a document that replaces the previous one in a reused window re-adopts it.
    (hasFonts ? '  install.refresh = realm => { fonts(realm, entries); };\n' : '') +
    '  (' + documentInstaller + ')(globalThis, entries, install);\n' +
    '})();\n//# sourceURL=app.js\n';
}
export function apiCustomSiteScriptId(host) {
  if (!exactHost(host)) throw new TypeError('Invalid exact API configuration host.');
  const encoded = [...new TextEncoder().encode(host)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return API_CUSTOM_SCRIPT_PREFIX + 'site-' + encoded;
}
export function buildApiCustomScripts(input, scopeMatches, { deviceSeeds = {}, mathSeed = null, canvasSeed = null, audioSeed = null, webglSeed = null, networkSeed = null, mediaBitrateBits = 32 } = {}) {
  const checked = validateApiConfiguration(input);
  if (!checked.ok) throw new TypeError(checked.error.path + ': ' + checked.error.message);
  const configuration = checked.value;
  if (!configuration.enabled && !configuration.antidetectEnabled) return [];
  const scope = scopePatterns(scopeMatches);
  if (!scope.length) return [];
  const scripts = [], global = effectiveEntries(configuration);
  const seeds = { deviceSeeds, mathSeed, canvasSeed, audioSeed, webglSeed, networkSeed };
  const record = (id, matches, excludeMatches, entries) => ({ id, matches, excludeMatches, js: [{ code: source(entries, seeds, mediaBitrateBits === 64 ? 64 : 32) }],
    runAt: 'document_start', world: 'MAIN', allFrames: true });
  if (global.length) scripts.push(record(API_CUSTOM_SCRIPT_PREFIX + 'global', scope.map(grant => grant.pattern),
    configuration.sites.flatMap(site => ['http://' + site.host + '/*', 'https://' + site.host + '/*']).sort(compare), global));
  for (const site of configuration.sites) {
    const entries = effectiveEntries(configuration, site);
    if (!entries.length) continue;
    const matches = [...new Set(scope.filter(grant => coversHost(grant, site.host)).map(grant => grant.scheme + '://' + site.host + grant.path))].sort(compare);
    if (matches.length) scripts.push(record(apiCustomSiteScriptId(site.host), matches, [], entries));
  }
  return scripts;
}
