// ADR-064: a view of the existing CAS-protected API configuration, never a second settings store.
import { validateApiConfiguration, validateApiValue, API_MATH_FUNCTIONS } from './api-configuration.js';

const clone = value => JSON.parse(JSON.stringify(value));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const MODE = Object.freeze({ bypass: 'inherit', off: 'allow', on: 'block', custom: 'spoof' });
const REVERSE = Object.freeze({ inherit: 'bypass', allow: 'off', block: 'on', spoof: 'custom' });
const FAILURES = new Set(['stale-revision', 'privacy-permission-required', 'early-access-required', 'conflicting-webrtc-devices', 'invalid-value', 'storage-error', 'permission-denied', 'browser-toggle-required', 'unsupported', 'inactive', 'busy', 'operation-failed']);
export class AntidetectError extends Error { constructor(code = 'operation-failed') { super(FAILURES.has(code) ? code : 'operation-failed'); this.code = this.message; } }
const fail = code => { throw new AntidetectError(code); };
export const ANTIDETECT_PROFILE_DEFAULT = Object.freeze({ addresses: null, iceTransportPolicy: 'preserve', randomizeDevices: false, freshCertificates: false, deviceLifetime: 'session' });
export const ANTIDETECT_MATH_DEFAULT = Object.freeze({ algorithm: 'deterministic-ulp-v1', functions: API_MATH_FUNCTIONS });

export function ipv4MappedIpv6(input) {
  if (typeof input !== 'string' || !/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(input) || input.split('.').some(part => Number(part) > 255)) fail('invalid-value');
  const [a, b, c, d] = input.split('.').map(Number);
  return '::ffff:' + (a * 256 + b).toString(16) + ':' + (c * 256 + d).toString(16);
}
export function antidetectDraft(configuration) {
  const row = id => configuration.apis.find(item => item.id === id), rtc = row('webrtc'), media = row('media-enumeration'), math = row('math-transcendentals');
  if (!rtc || !media || !row('websocket') || !row('webtransport')) fail('invalid-value');
  const profile = rtc.selected.kind === 'value' ? clone(rtc.selected.value) : clone(ANTIDETECT_PROFILE_DEFAULT);
  const devices = { mode: media.mode === 'custom' ? 'custom' : profile.randomizeDevices ? 'random' : media.mode === 'bypass' ? 'inherit' : media.mode === 'on' ? 'blocked' : 'original',
    lifetime: profile.deviceLifetime, values: media.selected.kind === 'value' ? clone(media.selected.value) : [] };
  if (!math) fail('invalid-value');
  return { enabled: configuration.antidetectEnabled, mode: MODE[rtc.mode], profile, devices, websocket: MODE[row('websocket').mode], webtransport: MODE[row('webtransport').mode], networkPolicy: configuration.webrtcNetworkPolicy,
    math: { mode: MODE[math.mode], profile: math.selected.kind === 'value' ? clone(math.selected.value) : clone(ANTIDETECT_MATH_DEFAULT) } };
}
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !keys.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) || keys.some(key => !Object.hasOwn(value, key))) fail('invalid-value');
}
function remember(row, value, suffix) {
  row.selected = clone(value);
  if ([...row.presets, ...row.userValues].some(item => same(item.value, value))) return;
  if (row.userValues.length >= 1000) fail('invalid-value');
  let number = 1; while (row.userValues.some(item => item.id === 'antidetect-' + suffix + '-' + number)) number++;
  row.userValues.push({ id: 'antidetect-' + suffix + '-' + number, label: 'Antidetect ' + number, value: clone(value) });
}
export function applyAntidetectDraft(configuration, input) {
  exact(input, ['enabled', 'mode', 'profile', 'devices', 'websocket', 'webtransport', 'networkPolicy', 'math']);
  exact(input.devices, ['mode', 'lifetime', 'values']);
  exact(input.math, ['mode', 'profile']);
  if (!['inherit', 'allow', 'spoof'].includes(input.math.mode)) fail('invalid-value');
  const checkedMath = validateApiValue('math-transcendentals', { kind: 'value', value: input.math.profile }); if (!checkedMath.ok) fail('invalid-value');
  if (typeof input.enabled !== 'boolean' || typeof input.mode !== 'string' || !Object.hasOwn(REVERSE, input.mode) || !['inherit', 'allow', 'block'].includes(input.websocket) || !['inherit', 'allow', 'block'].includes(input.webtransport) || !['original', 'random', 'custom', 'inherit', 'blocked'].includes(input.devices.mode) || !['session', 'site'].includes(input.devices.lifetime)) fail('invalid-value');
  const checkedDevices = validateApiValue('media-enumeration', { kind: 'value', value: input.devices.values }); if (!checkedDevices.ok) fail('invalid-value');
  const checked = validateApiConfiguration(configuration); if (!checked.ok) fail('invalid-value');
  const next = clone(checked.value), before = antidetectDraft(checked.value), row = id => next.apis.find(item => item.id === id);
  next.antidetectEnabled = input.enabled; next.webrtcNetworkPolicy = input.networkPolicy;
  if (input.math.mode !== before.math.mode) row('math-transcendentals').mode = REVERSE[input.math.mode];
  if (input.math.mode === 'spoof' || !same(checkedMath.value.value, before.math.profile)) remember(row('math-transcendentals'), checkedMath.value, 'math');
  if (input.mode !== before.mode) row('webrtc').mode = REVERSE[input.mode];
  for (const id of ['websocket', 'webtransport']) if (input[id] !== before[id]) row(id).mode = REVERSE[input[id]];
  const checkedProfile = validateApiValue('webrtc', { kind: 'value', value: input.profile }); if (!checkedProfile.ok) fail('invalid-value');
  const safeDevices = { mode: input.devices.mode, lifetime: input.devices.lifetime, values: checkedDevices.value.value };
  const deviceChanged = !same(safeDevices, before.devices), profile = clone(checkedProfile.value.value);
  if (deviceChanged) {
    profile.randomizeDevices = input.devices.mode === 'random'; profile.deviceLifetime = input.devices.lifetime;
    if (input.devices.mode === 'custom') {
      const value = validateApiValue('media-enumeration', { kind: 'value', value: input.devices.values }); if (!value.ok) fail('invalid-value');
      remember(row('media-enumeration'), value.value, 'devices'); row('media-enumeration').mode = 'custom';
    } else row('media-enumeration').mode = input.devices.mode === 'inherit' ? 'bypass' : input.devices.mode === 'blocked' ? 'on' : 'off';
  }
  if (input.mode === 'spoof' || !same(profile, before.profile)) {
    if (input.devices.mode === 'custom') profile.randomizeDevices = false;
    const value = validateApiValue('webrtc', { kind: 'value', value: profile }); if (!value.ok) fail('invalid-value');
    remember(row('webrtc'), value.value, 'webrtc');
  }
  const result = validateApiConfiguration(next); if (!result.ok) fail(result.error.code === 'conflicting-webrtc-devices' ? result.error.code : 'invalid-value');
  return result.value;
}

export function createAntidetectController(browserApi = globalThis.chrome, { onChange = () => {}, onInvalidate = () => {}, tabId = null } = {}) {
  const api = globalThis.browser?.runtime?.id === browserApi?.runtime?.id ? globalThis.browser : browserApi;
  let saved = null, visible = true, disposed = false, busy = false, epoch = 0, reading = 0;
  let changedRevision = -1, indeterminateChange = false;
  const validTab = tabId === null || Number.isInteger(tabId) && tabId >= 0 && tabId <= 2147483647;
  function check(token = epoch) {
    if (!validTab || disposed || !visible || token !== epoch) fail('inactive');
    try {
      const own = new URL(api.runtime.getURL('options.html')), actual = new URL(globalThis.location.href);
      if (globalThis.window !== globalThis.window.top || !['chrome-extension:', 'moz-extension:'].includes(own.protocol) || actual.protocol !== own.protocol || actual.host !== own.host || actual.pathname !== own.pathname) fail('inactive');
    } catch { fail('inactive'); }
  }
  function state(response) {
    if (!response || response.schemaVersion !== 1 || response.type !== 'api-config-state' || !Number.isSafeInteger(response.revision) || response.revision < 0 || !['ready', 'inactive', 'error'].includes(response.registration) || typeof response.reloadRequired !== 'boolean') fail(response?.code);
    const checked = validateApiConfiguration(response.configuration); if (!checked.ok) fail('operation-failed');
    return { ...response, configuration: checked.value };
  }
  async function project(value) {
    const draft = antidetectDraft(value.configuration), apiEnabled = value.configuration.enabled, effective = {};
    for (const [id, mode] of [['webrtc', draft.mode], ['websocket', draft.websocket], ['webtransport', draft.webtransport], ['math', draft.math.mode]]) {
      const enabled = mode === 'spoof' ? draft.enabled : mode === 'allow' ? true : apiEnabled;
      effective[id] = value.registration === 'error' ? 'error' : !enabled ? 'inactive' : value.reloadRequired ? 'reload-required' : mode === 'inherit' ? 'inherited' : mode === 'allow' ? 'allow' : id === 'math' && !draft.math.profile.functions.length ? 'empty' : value.registration !== 'ready' ? 'scope-inactive' : mode;
    }
    const networkEnforcement = { websocket: 'page', webtransport: 'page' }, token = epoch;
    if (typeof api.declarativeNetRequest?.getDynamicRules === 'function') {
      try {
        check(token); const rules = await api.declarativeNetRequest.getDynamicRules(); check(token);
        for (const [id, number] of [['websocket', 300000], ['webtransport', 300001]]) if (rules.some(rule => rule.id === number && rule.priority === 1000 && rule.action?.type === 'block' && Object.keys(rule.action).length === 1 && same(rule.condition, { resourceTypes: [id] }))) networkEnforcement[id] = 'browser';
      } catch { check(token); }
    }
    // The validated configuration of the same reply feeds the read-only overview counts.
    return { draft, apiEnabled, configuration: clone(value.configuration), revision: value.revision, registration: value.registration, earlyAccess: value.earlyAccess ?? 'unsupported', reloadRequired: value.reloadRequired, webrtcNetwork: value.webrtcNetwork,
      effective, networkEnforcement, capabilities: { udp: false, quic: false, ipv6: false, nativeProtocols: typeof api.declarativeNetRequest?.getDynamicRules === 'function' } };
  }
  async function load() {
    check(); if (busy) fail('busy'); const token = epoch, sequence = ++reading;
    let response; try { response = await api.runtime.sendMessage({ schemaVersion: 1, type: 'ui-api-config-get', tabId }); } catch { fail('operation-failed'); }
    check(token); if (sequence !== reading) fail('inactive');
    const candidate = state(response), projected = await project(candidate);
    check(token); if (sequence !== reading) fail('inactive'); saved = candidate; return projected;
  }
  async function commit(configuration) {
    check(); if (busy || !saved) fail('busy');
    const token = epoch, revision = saved.revision; busy = true; ++reading;
    changedRevision = -1; indeterminateChange = false;
    try {
      let response; try { response = await api.runtime.sendMessage({ schemaVersion: 1, type: 'ui-api-config-set', tabId, expectedRevision: revision, configuration }); } catch { fail('operation-failed'); }
      check(token); const candidate = state(response), projected = await project(candidate);
      check(token);
      if (indeterminateChange || changedRevision > candidate.revision) fail('stale-revision');
      saved = candidate; return projected;
    } finally { busy = false; }
  }
  async function save(draft) {
    check(); if (busy || !saved) fail('busy');
    return commit(applyAntidetectDraft(saved.configuration, draft));
  }
  // The page master commits only its accepted field, never an unfinished editor draft.
  async function setEnabled(enabled) {
    check(); if (busy || !saved) fail('busy');
    if (typeof enabled !== 'boolean') fail('invalid-value');
    return commit({ ...saved.configuration, antidetectEnabled: enabled });
  }
  function grant(permission) {
    try { check(); const token = epoch, promise = api.permissions.request({ permissions: [permission] }); return Promise.resolve(promise).then(granted => { check(token); if (!granted) fail('permission-denied'); return load(); }); }
    catch (error) { return Promise.reject(error instanceof AntidetectError ? error : new AntidetectError()); }
  }
  function changed(changes, area) {
    if (disposed || !visible || area !== 'local' || !Object.hasOwn(changes, 'api-configuration:v1')) return;
    const own = (value, key) => value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
    const value = own(own(changes, 'api-configuration:v1'), 'newValue'), revision = own(value, 'revision');
    if (busy) {
      // Our own CAS notification is expected; a newer owner must not paint stale ON.
      if (Number.isSafeInteger(revision) && revision >= 0) changedRevision = Math.max(changedRevision, revision);
      else indeterminateChange = true;
      return;
    }
    // Native storage delivery can follow the CAS reply. An exact accepted echo is not external.
    if (saved && revision === saved.revision && same(own(value, 'configuration'), saved.configuration)) return;
    try { onChange({ reason: 'configuration' }); } catch { /* View notification only. */ }
  }
  function permissionChanged() { if (disposed) return; ++epoch; ++reading; try { onInvalidate({ reason: 'permissions' }); } catch { /* View notification only. */ } }
  api.storage?.onChanged?.addListener(changed); api.permissions?.onRemoved?.addListener(permissionChanged);
  return { load, save, setEnabled, grantEarlyAccess: () => grant('userScripts'), grantPrivacy: () => grant('privacy'),
    openEarlySettings() { check(); return api.tabs.create({ url: 'chrome://extensions/?id=' + api.runtime.id }); },
    setVisible(active) { if (visible !== (active === true)) { visible = active === true; ++epoch; ++reading; } },
    dispose() { if (disposed) return; disposed = true; ++epoch; ++reading; saved = null; api.storage?.onChanged?.removeListener(changed); api.permissions?.onRemoved?.removeListener(permissionChanged); },
  };
}
