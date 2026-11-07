// ADR-075 / REQ-001, REQ-004, REQ-005, REQ-011: explicit local Autosurfer workspace.
export const AUTOSURF_PORT = 'detect-expert/autosurf/v1';
export const AUTOSURF_SESSION_KEY = 'autosurf-session:v1';
export const AUTOSURF_ALARM = 'detect-expert/autosurf/watchdog/v1';
export const AUTOSURF_LIMITS = Object.freeze({ urls: 200, urlLength: 2048, configBytes: 262144, checkpointBytes: 1048576, visits: 200, events: 500, samples: 1200, ports: 8, commands: 16, navigationMs: 45000, nativeMs: 10000, watchdogMs: 30000 });
export const AUTOSURF_DEFAULT_CONFIGURATION = Object.freeze({ urls: Object.freeze([]), sampleCount: 0, cycles: 1, depth: 0, dwellMinSec: 20, dwellMaxSec: 60, gapMinSec: 5, gapMaxSec: 20, maxRunMinutes: 60, scroll: true, hover: true, seed: 1, order: 'shuffle', metrics: false });
export const AUTOSURF_STATUSES = Object.freeze(['idle', 'running', 'paused', 'completed', 'stopped', 'error']);
export const AUTOSURF_PHASES = Object.freeze(['opening', 'navigating', 'settling', 'interacting', 'gap']);
export const AUTOSURF_CODES = Object.freeze(['invalid-input', 'unauthorized', 'unsupported', 'permission-required', 'stale-revision', 'busy', 'inactive', 'storage-unavailable', 'timeout', 'native-error', 'debugger-detached', 'tab-closed', 'tab-replaced', 'tab-discarded', 'window-blurred', 'manual-navigation', 'external-navigation', 'navigation-error', 'navigation-timeout', 'challenge', 'http-403', 'http-429', 'permission-revoked', 'restored', 'user-paused', 'user-stopped', 'complete', 'run-limit', 'result-limit', 'clock-changed']);
const codes = new Set(AUTOSURF_CODES);
export class AutosurfError extends Error { constructor(code) { super(codes.has(code) ? code : 'native-error'); this.code = codes.has(code) ? code : 'native-error'; } }
export function autosurfFail(code) { throw new AutosurfError(code); }
export function autosurfSafeCode(error) {
  const code = error?.code;
  if (codes.has(code)) return code;
  return ({ 'autosurf-busy': 'busy', 'autosurf-timeout': 'timeout', 'autosurf-detached': 'debugger-detached', 'autosurf-stale': 'manual-navigation', 'autosurf-unsupported': 'unsupported', 'autosurf-native-error': 'native-error', 'autosurf-hidden': 'window-blurred', 'autosurf-challenge': 'challenge', 'autosurf-invalid-result': 'native-error' })[code] ?? 'native-error';
}
export function autosurfRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  return Reflect.ownKeys(value).every(key => typeof key === 'string' && Object.getOwnPropertyDescriptor(value, key)?.enumerable === true && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
}
function exact(value, required, optional = []) {
  if (!autosurfRecord(value) || required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) autosurfFail('invalid-input');
}
function integer(value, min, max) { if (!Number.isSafeInteger(value) || value < min || value > max) autosurfFail('invalid-input'); return value; }
export function validateAutosurfUrl(value, { discovered = false, origin = null } = {}) {
  if (typeof value !== 'string' || value.length < 1 || value.length > AUTOSURF_LIMITS.urlLength || value.trim() !== value || /[\u0000-\u0020\u007f-\u009f\u202a-\u202e\u2066-\u2069\\]/u.test(value)) autosurfFail('invalid-input');
  let url; try { url = new URL(value); } catch { autosurfFail('invalid-input'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || (origin !== null && url.origin !== origin)) autosurfFail('invalid-input');
  if (discovered && (url.search || url.hash || /(?:^|\/)(?:logout|logoff|signout|sign-out|delete|remove|destroy|unsubscribe|checkout|cart|basket|payment|pay|purchase|buy|order|admin|account|login|signin|auth|oauth|register|signup|download|export|import|api)(?:[\/._-]|$)/i.test(decodeSafe(url.pathname)))) autosurfFail('invalid-input');
  return url.href;
}
function decodeSafe(value) { try { return decodeURIComponent(value); } catch { autosurfFail('invalid-input'); } }
export function validateAutosurfConfiguration(value) {
  exact(value, Object.keys(AUTOSURF_DEFAULT_CONFIGURATION));
  if (!Array.isArray(value.urls) || value.urls.length > AUTOSURF_LIMITS.urls || Reflect.ownKeys(value.urls).some(key => key !== 'length' && (!/^(0|[1-9][0-9]*)$/.test(String(key)) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value.urls, key), 'value')))) autosurfFail('invalid-input');
  for (let index = 0; index < value.urls.length; index++) if (!Object.hasOwn(value.urls, index)) autosurfFail('invalid-input');
  const urls = value.urls.map(url => validateAutosurfUrl(url));
  if (new Set(urls).size !== urls.length) autosurfFail('invalid-input');
  const config = { urls, sampleCount: integer(value.sampleCount, 0, 200), cycles: integer(value.cycles, 1, 5), depth: integer(value.depth, 0, 3), dwellMinSec: integer(value.dwellMinSec, 5, 600), dwellMaxSec: integer(value.dwellMaxSec, 5, 600), gapMinSec: integer(value.gapMinSec, 1, 300), gapMaxSec: integer(value.gapMaxSec, 1, 300), maxRunMinutes: integer(value.maxRunMinutes, 1, 480), scroll: value.scroll, hover: value.hover, seed: integer(value.seed, 0, 0xffffffff), order: value.order, metrics: value.metrics };
  if (config.dwellMinSec > config.dwellMaxSec || config.gapMinSec > config.gapMaxSec || !['sequential', 'shuffle'].includes(config.order) || ['scroll', 'hover', 'metrics'].some(key => typeof config[key] !== 'boolean') || new TextEncoder().encode(JSON.stringify(config)).length > AUTOSURF_LIMITS.configBytes) autosurfFail('invalid-input');
  return config;
}
export function createDefaultAutosurfConfiguration() { return validateAutosurfConfiguration({ ...AUTOSURF_DEFAULT_CONFIGURATION, urls: [] }); }
export function validateAutosurfCommand(value) {
  exact(value, ['v', 'id', 'op'], ['payload']);
  if (value.v !== 1 || typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value.id) || !['load', 'save', 'start', 'pause', 'resume', 'stop', 'clear', 'export'].includes(value.op)) autosurfFail('invalid-input');
  if (['load', 'export'].includes(value.op)) { if (Object.hasOwn(value, 'payload')) autosurfFail('invalid-input'); return { v: 1, id: value.id, op: value.op }; }
  exact(value.payload, value.op === 'save' ? ['revision', 'configuration'] : ['revision']);
  const payload = { revision: integer(value.payload.revision, 0, Number.MAX_SAFE_INTEGER - 1) };
  if (value.op === 'save') payload.configuration = validateAutosurfConfiguration(value.payload.configuration);
  return { v: 1, id: value.id, op: value.op, payload };
}
export function isOwnAutosurfOptions(api, env = globalThis) {
  try { const win = env.window ?? env, actual = new URL(env.location.href), expected = new URL(api.runtime.getURL('options.html')); return win.top === win && actual.protocol === expected.protocol && actual.host === expected.host && actual.pathname === expected.pathname && !actual.username && !actual.password; } catch { return false; }
}
export function isAutosurfUiSender(api, sender) {
  try {
    const expected = new URL(api.runtime.getURL('options.html'));
    const own = raw => { const url = new URL(raw); return url.protocol === expected.protocol && url.host === expected.host && url.pathname === expected.pathname && !url.username && !url.password; };
    return sender.id === api.runtime.id && own(sender.url) && (sender.frameId === undefined || sender.frameId === 0) && (!sender.origin || sender.origin === expected.protocol + '//' + expected.host) && (sender.tab === undefined || sender.frameId === 0 && (sender.tab.url === undefined || own(sender.tab.url)));
  } catch { return false; }
}
export function autosurfRandom(seed) { let state = seed >>> 0; return () => { state = (state + 0x6d2b79f5) >>> 0; let next = Math.imul(state ^ state >>> 15, 1 | state); next ^= next + Math.imul(next ^ next >>> 7, 61 | next); return ((next ^ next >>> 14) >>> 0) / 4294967296; }; }
export function createAutosurfVisitRandom(seed, position, depth) {
  integer(seed, 0, 0xffffffff); integer(position, 0, 999); integer(depth, 0, 3);
  const key = seed ^ Math.imul(position, 0x9e3779b1) ^ Math.imul(depth, 0x85ebca6b);
  // Independent streams keep dwell/gap and link choice stable when the number
  // of pointer actions changes. No page URL or page-controlled seed is used.
  return { schedule: autosurfRandom(key ^ 0xa341316c), behavior: autosurfRandom(key ^ 0xc8013ea4), links: autosurfRandom(key ^ 0xad90777d) };
}
export function createAutosurfPlan(config) {
  const checked = validateAutosurfConfiguration(config), random = autosurfRandom(checked.seed), indexes = checked.urls.map((_, index) => index);
  if (checked.order === 'shuffle' || checked.sampleCount > 0) for (let index = indexes.length - 1; index > 0; index--) { const pick = Math.floor(random() * (index + 1)); [indexes[index], indexes[pick]] = [indexes[pick], indexes[index]]; }
  const selected = indexes.slice(0, checked.sampleCount || indexes.length);
  if (checked.order === 'sequential') selected.sort((a, b) => a - b);
  return Array.from({ length: checked.cycles }, () => selected).flat();
}
