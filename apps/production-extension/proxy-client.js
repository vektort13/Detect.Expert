// ADR-070: this channel is available only to the extension's top-level Options.
import { PROXY_PORT, PROXY_LIMITS, PROXY_SAFE_CODES, PROXY_PHASES, ProxyError, proxyFail, proxyRecord, validateProxyConfiguration, validateProxyDiagnosticResult, validateProxyCheckResult, validateProxyBundle, isOwnProxyOptions, safeProxyError } from './proxy-shared.js';
const states = new Set(['off', 'connecting', 'connected', 'blocked', 'error', 'conflict', 'permission-required']);
const codes = new Set(PROXY_SAFE_CODES);
function checkedSnapshot(value) {
  if (!proxyRecord(value) || !proxyRecord(value.status) || !states.has(value.status.state)) proxyFail('operation-failed');
  const configuration = validateProxyConfiguration(value.configuration), status = { state: value.status.state };
  if (codes.has(value.status.code)) status.code = value.status.code;
  if (PROXY_PHASES.includes(value.status.phase)) status.phase = value.status.phase;
  if (typeof value.status.retryable === 'boolean') status.retryable = value.status.retryable;
  if (configuration.profiles.some(profile => profile.id === value.status.profileId)) status.profileId = value.status.profileId;
  if (proxyRecord(value.status.endpoint) && typeof value.status.endpoint.host === 'string' && value.status.endpoint.host.length <= 253 && Number.isInteger(value.status.endpoint.port)) status.endpoint = { host: value.status.endpoint.host, port: value.status.endpoint.port };
  const c = value.host?.capabilities;
  // http/https are absent from an older companion; a missing key reads as false (it cannot dial that upstream).
  const host = value.host?.available === true && value.host.version === 1 && proxyRecord(c) && ['socks5', 'openvpn', 'vless', 'vault'].every(key => typeof c[key] === 'boolean') && ['http', 'https'].every(key => c[key] === undefined || typeof c[key] === 'boolean') ? { available: true, version: 1, capabilities: { socks5: c.socks5, http: c.http === true, https: c.https === true, openvpn: c.openvpn, vless: c.vless, vault: c.vault } } : { available: false };
  let diagnostic;
  if (value.diagnostic?.state === 'pass') {
    const { state: ignored, ...result } = value.diagnostic; void ignored;
    diagnostic = validateProxyDiagnosticResult(result);
  } else if (value.diagnostic?.state === 'fail' && codes.has(value.diagnostic.code)) diagnostic = { state: 'fail', code: value.diagnostic.code, ...(PROXY_PHASES.includes(value.diagnostic.phase) ? { phase: value.diagnostic.phase } : {}), ...(typeof value.diagnostic.retryable === 'boolean' ? { retryable: value.diagnostic.retryable } : {}) };
  return { configuration, status, host, ...(diagnostic ? { diagnostic } : {}) };
}
export function createProxyClient(browserApi = globalThis.chrome, { env = globalThis, onChange = () => {}, deadline = PROXY_LIMITS.requestMs + 1500 } = {}) {
  const api = env.browser?.runtime?.id === browserApi?.runtime?.id ? env.browser : browserApi;
  let port = null, disposed = false, sequence = 0;
  const pending = new Map();
  const notify = value => { try { onChange(value); } catch { /* A rendering callback never changes authorization. */ } };
  function check() { if (!isOwnProxyOptions(api, env)) proxyFail('unauthorized'); if (disposed) proxyFail('inactive'); }
  function open() {
    check(); if (port) return port;
    const current = api.runtime.connect({ name: PROXY_PORT }); port = current;
    current.onDisconnect.addListener(() => { if (port !== current) return; void api.runtime.lastError; port = null; for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new ProxyError('operation-failed')); } pending.clear(); });
    current.onMessage.addListener(message => {
      if (port !== current || !proxyRecord(message) || message.v !== 1) return;
      if (message.type === 'change') { try { notify(checkedSnapshot(message.snapshot)); } catch { /* Malformed projection ignored. */ } return; }
      const item = pending.get(message.id); if (!item || typeof message.ok !== 'boolean') return;
      pending.delete(message.id); clearTimeout(item.timer);
      if (['checkProfile', 'exportProfiles'].includes(item.op)) {
        if (!message.ok) { item.reject(new ProxyError(codes.has(message.error?.code) ? message.error.code : 'operation-failed', message.error)); return; }
        try {
          const value = item.op === 'checkProfile' ? validateProxyCheckResult(message.result) : validateProxyBundle(message.result);
          if (item.op === 'checkProfile' && value.profileId !== item.payload.id || item.op === 'exportProfiles' && item.payload !== null && (value.profiles.length !== 1 || value.profiles[0].id !== item.payload)) proxyFail('native-protocol');
          item.resolve(value);
        } catch (error) { item.reject(safeProxyError(error)); }
        return;
      }
      let snapshot;
      try { snapshot = checkedSnapshot(message.snapshot); notify(snapshot); } catch (error) { item.reject(safeProxyError(error)); return; }
      if (message.ok) item.resolve(snapshot); else item.reject(new ProxyError(codes.has(message.error?.code) ? message.error.code : 'operation-failed', message.error));
    });
    return current;
  }
  function request(op, payload) {
    try {
      check(); if (pending.size > 0) proxyFail('busy');
      const current = open(), id = 'ui-' + (++sequence);
      return new Promise((resolve, reject) => {
        const item = { resolve, reject, timer: null, op, payload: op === 'checkProfile' ? { id: payload?.id } : op === 'exportProfiles' ? payload : undefined };
        // A timeout reports uncertainty but retains the physical pending slot until settlement.
        item.timer = setTimeout(() => reject(new ProxyError('timeout')), deadline);
        pending.set(id, item);
        try { current.postMessage({ v: 1, id, op, ...(payload === undefined ? {} : { payload }) }); } catch { clearTimeout(item.timer); pending.delete(id); reject(new ProxyError('operation-failed')); }
      });
    } catch (error) { return Promise.reject(safeProxyError(error)); }
  }
  function requestAccess({ native = false, privacy = false, clipboard = false } = {}) {
    try {
      check();
      // Firefox rejects requests for required-only permissions. The immutable
      // own manifest can be inspected synchronously without losing the gesture.
      const required = new Set(api.runtime.getManifest?.().permissions ?? []);
      const permissions = [...(native ? ['nativeMessaging'] : []), ...(privacy ? ['privacy'] : []), ...(clipboard ? ['clipboardWrite'] : [])].filter(permission => !required.has(permission));
      if (permissions.length === 0) return request('load');
      if (typeof api.permissions?.request !== 'function') proxyFail('unsupported');
      // Keep the native prompt in the user's click stack; never relay permission requests through SW.
      const action = api.permissions.request({ permissions });
      return Promise.resolve(action).then(granted => { check(); if (granted !== true) proxyFail('permission-denied'); return request('load'); }, () => { proxyFail('permission-denied'); });
    } catch (error) { return Promise.reject(safeProxyError(error)); }
  }
  return { load: () => request('load'), requestAccess, restartNative: () => request('restartNative'), saveProfile: input => request('saveProfile', input), deleteProfile: id => request('deleteProfile', id), saveSettings: config => request('saveSettings', config), connect: id => request('connect', id), disconnect: () => request('disconnect'), hostStatus: () => request('hostStatus'), diagnose: url => request('diagnose', url), checkProfile: input => request('checkProfile', input), exportProfiles: (id = null) => request('exportProfiles', id), dispose() { disposed = true; for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new ProxyError('inactive')); } pending.clear(); if (port) { const current = port; port = null; current.disconnect(); } } };
}
