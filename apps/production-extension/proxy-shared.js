// ADR-070 / E22-25: bounded metadata only; credentials belong to the native vault.
// ADR-107 round 5: HTTP/HTTPS upstream proxies and the user's own country tag.
import { regionByCode } from './fingerprint-region-data.js';
export const PROXY_FORMAT = 'detect.expert.proxy';
export const PROXY_VERSION = 1;
export const PROXY_PORT = 'detect.expert.proxy/v1';
export const PROXY_STORAGE_KEY = 'proxy-configuration:v1';
export const PROXY_NATIVE_RESTART_KEY = 'proxy-native-restart:v1';
export const PROXY_NATIVE_HOST = 'com.detect_expert.proxy';
// UI only: where a person gets the optional Windows companion (a separate download, not part of the store package). The extension never
// requests or installs it; the Proxy tab shows this as a plain link that opens in a new tab. A unit test pins the exact form, so a stray
// edit cannot send the link anywhere else.
export const PROXY_COMPANION_DOWNLOAD_URL = 'https://github.com/vektort13/Detect.Expert/releases/latest';
export const PROXY_LIMITS = Object.freeze({ profiles: 100, domains: 256, name: 96, configBytes: 1048576, bundleBytes: 33554432, openVpnBytes: 262144, nativeBytes: 524288, requestMs: 60000 });
export const PROXY_SAFE_CODES = Object.freeze(['unauthorized', 'inactive', 'unsupported', 'invalid-input', 'invalid-config', 'invalid-version', 'duplicate-profile', 'profile-not-found', 'stale-revision', 'busy', 'timeout', 'operation-failed', 'permission-required', 'permission-denied', 'not-controllable', 'not-applied', 'native-unavailable', 'native-protocol', 'native-disconnected', 'native-timeout', 'native-unsupported', 'native-error', 'vault-unavailable', 'profile-unavailable', 'invalid-profile', 'invalid-config-file', 'engine-unavailable', 'engine-failed', 'auth-required', 'connection-failed', 'reconnect-required', 'proxy-error', 'auth-failed', 'dns-failed', 'connection-refused', 'tls-failed', 'reality-failed', 'engine-missing', 'tunnel-disconnected', 'unsupported-profile', 'identity-required', 'capacity', 'privacy-unavailable', 'privacy-conflict', 'privacy-permission-required', 'active-vpn', 'proxy-denied', 'network-unreachable', 'host-unreachable']);
// Profile types. socks5, http and https are reachable by the browser itself when no login is set; with a login (or for VLESS and
// OpenVPN) the browser talks only to the companion's loopback SOCKS5 relay and the companion owns the upstream connection.
export const PROXY_TYPES = Object.freeze(['socks5', 'http', 'https', 'vless', 'openvpn']);
export const PROXY_DIRECT_TYPES = Object.freeze(['socks5', 'http', 'https']);
export const PROXY_PHASES = Object.freeze(['parse', 'auth', 'transport', 'tls', 'reality', 'encryption', 'config', 'endpoint', 'listen', 'socks', 'frame', 'vault', 'native', 'engine', 'tunnel', 'dns', 'disconnect', 'resolve', 'connect', 'handshake', 'proxy', 'ready']);
const codes = new Set(PROXY_SAFE_CODES);
export class ProxyError extends Error { constructor(code, details = null) { super(codes.has(code) ? code : 'operation-failed'); this.name = 'ProxyError'; this.code = this.message; if (PROXY_PHASES.includes(details?.phase)) this.phase = details.phase; if (typeof details?.retryable === 'boolean') this.retryable = details.retryable; } }
export function proxyFail(code) { throw new ProxyError(code); }
export function safeProxyError(error) { return new ProxyError(error instanceof ProxyError ? error.code : 'operation-failed', error instanceof ProxyError ? error : null); }
export function proxyRecord(value) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Reflect.ownKeys(value).every(key => typeof key === 'string' && !['__proto__', 'constructor', 'prototype'].includes(key) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
}
function keys(value, expected, optional = []) { return proxyRecord(value) && Object.keys(value).every(key => expected.includes(key) || optional.includes(key)) && expected.every(key => Object.hasOwn(value, key)); }
export function proxyHost(input) {
  if (typeof input !== 'string' || input.length < 1 || input.length > 253 || /[\s/@?#%\\]/.test(input)) proxyFail('invalid-input');
  let host = input.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (host.includes(':')) {
    if (!/^[a-f0-9:]+$/.test(host)) proxyFail('invalid-input');
    try { return new URL('http://[' + host + ']/').hostname.slice(1, -1); } catch { proxyFail('invalid-input'); }
  }
  if (/^[0-9.]+$/.test(host)) {
    const parts = host.split('.');
    if (parts.length !== 4 || parts.some(part => !/^(0|[1-9][0-9]{0,2})$/.test(part) || Number(part) > 255)) proxyFail('invalid-input');
    return host;
  }
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (!host || !host.split('.').every(part => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))) proxyFail('invalid-input');
  return host;
}
export function proxyPort(value) { if (!Number.isInteger(value) || value < 1 || value > 65535) proxyFail('invalid-input'); return value; }
// The country tag is the user's own note: ISO 3166-1 alpha-2, uppercase, present in the offline region table. It is never
// detected, looked up or checked against an address. User input is strict; a stored well-formed code that a later region table
// no longer knows is dropped instead, so a harmless tag can never invalidate a saved configuration (kill switch: a rejected
// configuration would block the browser).
const COUNTRY_SHAPE = /^[A-Z]{2}$/;
export function proxyCountry(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !COUNTRY_SHAPE.test(value) || regionByCode(value) === null) proxyFail('invalid-input');
  return value;
}
function storedCountry(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !COUNTRY_SHAPE.test(value)) proxyFail('invalid-config');
  return regionByCode(value) === null ? null : value;
}
export function proxyId(value) { if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value)) proxyFail('invalid-input'); return value; }
function domains(values) {
  if (!Array.isArray(values) || values.length > PROXY_LIMITS.domains) proxyFail('invalid-config');
  const result = values.map(value => {
    if (typeof value !== 'string') proxyFail('invalid-config');
    const wildcard = value.startsWith('*.'); const host = proxyHost(wildcard ? value.slice(2) : value);
    if (wildcard && (host.includes(':') || /^[0-9.]+$/.test(host) || !host.includes('.'))) proxyFail('invalid-config');
    return (wildcard ? '*.' : '') + host;
  });
  if (new Set(result).size !== result.length) proxyFail('invalid-config');
  return result.sort();
}
export function createDefaultProxyConfiguration() {
  return { format: PROXY_FORMAT, version: PROXY_VERSION, revision: 0, enabled: false, selectedId: null, profiles: [], routing: { mode: 'all', proxyDomains: [], directDomains: [], bypassLocal: true }, protectWebRTC: true, disablePrediction: true, killSwitch: true, autoConnect: false };
}
export function validateProxyConfiguration(input) {
  try {
    if (!keys(input, ['format', 'version', 'revision', 'enabled', 'selectedId', 'profiles', 'routing', 'protectWebRTC', 'disablePrediction', 'killSwitch', 'autoConnect'])) proxyFail('invalid-config');
    if (input.format !== PROXY_FORMAT || input.version !== PROXY_VERSION) proxyFail('invalid-version');
    if (!Number.isSafeInteger(input.revision) || input.revision < 0 || ['enabled', 'protectWebRTC', 'disablePrediction', 'autoConnect'].some(key => typeof input[key] !== 'boolean')) proxyFail('invalid-config');
    if (input.killSwitch !== true) proxyFail('invalid-config');
    if (!Array.isArray(input.profiles) || input.profiles.length > PROXY_LIMITS.profiles) proxyFail('invalid-config');
    const profiles = input.profiles.map(profile => {
      if (!keys(profile, ['id', 'name', 'type', 'host', 'port', 'native'], ['country']) || typeof profile.name !== 'string' || !profile.name.trim() || profile.name.length > PROXY_LIMITS.name || /[\x00-\x1f\x7f]/.test(profile.name) || !PROXY_TYPES.includes(profile.type) || typeof profile.native !== 'boolean') proxyFail('invalid-config');
      if (!profile.native && !PROXY_DIRECT_TYPES.includes(profile.type)) proxyFail('invalid-config');
      // A saved HTTP/HTTPS profile always shows its endpoint; only the profile kinds that existed before may hide it.
      const hidden = profile.native && ['socks5', 'vless', 'openvpn'].includes(profile.type);
      const host = profile.host === null && hidden ? null : proxyHost(profile.host);
      const port = profile.port === null && hidden ? null : proxyPort(profile.port);
      const country = storedCountry(profile.country);
      return { id: proxyId(profile.id), name: profile.name.trim(), type: profile.type, host, port, native: profile.native, ...(country ? { country } : {}) };
    }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    if (new Set(profiles.map(profile => profile.id)).size !== profiles.length) proxyFail('duplicate-profile');
    if (input.selectedId !== null && !profiles.some(profile => profile.id === input.selectedId)) proxyFail('invalid-config');
    if (input.enabled && input.selectedId === null) proxyFail('invalid-config');
    if (!keys(input.routing, ['mode', 'proxyDomains', 'directDomains', 'bypassLocal']) || !['all', 'include'].includes(input.routing.mode) || typeof input.routing.bypassLocal !== 'boolean') proxyFail('invalid-config');
    const routing = { mode: input.routing.mode, proxyDomains: domains(input.routing.proxyDomains), directDomains: domains(input.routing.directDomains), bypassLocal: input.routing.bypassLocal };
    if (routing.proxyDomains.some(domain => routing.directDomains.includes(domain))) proxyFail('invalid-config');
    return { format: PROXY_FORMAT, version: PROXY_VERSION, revision: input.revision, enabled: input.enabled, selectedId: input.selectedId, profiles, routing, protectWebRTC: input.protectWebRTC, disablePrediction: input.disablePrediction, killSwitch: true, autoConnect: input.autoConnect };
  } catch (error) { if (error instanceof ProxyError && ['invalid-version', 'duplicate-profile'].includes(error.code)) throw error; proxyFail('invalid-config'); }
}
export function parseProxyConfiguration(text) {
  if (typeof text !== 'string' || text.length > PROXY_LIMITS.configBytes) proxyFail('invalid-config');
  try { return validateProxyConfiguration(JSON.parse(text)); } catch (error) { if (error instanceof ProxyError) throw error; proxyFail('invalid-config'); }
}
export function exportProxyConfiguration(config) { return JSON.stringify(validateProxyConfiguration(config), null, 2) + '\n'; }
export function validateProxyProfileInput(input) {
  if (!keys(input, ['name', 'type'], ['id', 'host', 'port', 'username', 'password', 'uri', 'config', 'country']) || typeof input.name !== 'string' || !input.name.trim() || input.name.length > PROXY_LIMITS.name || /[\x00-\x1f\x7f]/.test(input.name)) proxyFail('invalid-input');
  const id = input.id === undefined ? undefined : proxyId(input.id), name = input.name.trim(), type = input.type;
  const country = proxyCountry(input.country), tag = country ? { country } : {};
  const credential = key => { const value = input[key] ?? ''; if (typeof value !== 'string' || value.length > 1024 || /[\x00\r\n]/.test(value)) proxyFail('invalid-input'); return value; };
  if (PROXY_DIRECT_TYPES.includes(type)) {
    if (input.uri !== undefined || input.config !== undefined) proxyFail('invalid-input');
    const username = credential('username'), password = credential('password');
    if (!!password !== !!username || new TextEncoder().encode(username).length > 255 || new TextEncoder().encode(password).length > 255) proxyFail('invalid-input');
    // RFC 7617: the Basic user-id cannot contain a colon, so an HTTP or HTTPS proxy login with one could never be sent as typed.
    if (type !== 'socks5' && username.includes(':')) proxyFail('invalid-input');
    return { ...(id ? { id } : {}), name, type, host: proxyHost(input.host), port: proxyPort(input.port), username, password, ...tag };
  }
  if (type === 'vless') {
    if (input.host !== undefined || input.port !== undefined || input.config !== undefined || input.username !== undefined || input.password !== undefined || typeof input.uri !== 'string' || input.uri.length > 16384 || !input.uri.startsWith('vless://') || /[\x00-\x20\x7f]/.test(input.uri)) proxyFail('invalid-input');
    return { ...(id ? { id } : {}), name, type, uri: normalizeVlessUri(input.uri), ...tag };
  }
  if (type === 'openvpn') {
    if (input.host !== undefined || input.port !== undefined || input.uri !== undefined || typeof input.config !== 'string' || !input.config.trim() || input.config.length > PROXY_LIMITS.openVpnBytes || new TextEncoder().encode(input.config).length > PROXY_LIMITS.openVpnBytes || input.config.includes('\0')) proxyFail('invalid-input');
    return { ...(id ? { id } : {}), name, type, config: input.config, username: credential('username'), password: credential('password'), ...tag };
  }
  proxyFail('invalid-input');
}
// True when the browser cannot reach the profile by itself: VLESS and OpenVPN always, a SOCKS5/HTTP/HTTPS proxy once it has a login.
export const proxyNeedsNative = profile => !PROXY_DIRECT_TYPES.includes(profile?.type) || Boolean(profile.username || profile.password);
const VLESS_PARAMETERS = new Set(['encryption', 'security', 'sni', 'fp', 'pbk', 'sid', 'spx', 'type', 'host', 'path', 'serviceName', 'mode', 'alpn', 'flow', 'headerType', 'seed', 'quicSecurity', 'key', 'packetEncoding', 'allowInsecure', 'authority', 'extra']);
export function normalizeVlessUri(text) {
  if (typeof text !== 'string' || text.length > 16384) proxyFail('invalid-input');
  const normalized = text.trim().replace(/\\([:/?=&_#.-])/g, '$1');
  if (!normalized.startsWith('vless://') || /[\x00-\x20\x7f\\]/.test(normalized)) proxyFail('invalid-input');
  let url;
  try { url = new URL(normalized); } catch { proxyFail('invalid-input'); }
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(url.username) || url.password || !url.hostname || !url.port || url.pathname && url.pathname !== '/') proxyFail('invalid-input');
  proxyHost(url.hostname); proxyPort(Number(url.port));
  const seen = new Set();
  for (const [key, value] of url.searchParams) {
    if (!VLESS_PARAMETERS.has(key) || seen.has(key) || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value)) proxyFail('invalid-input');
    seen.add(key);
  }
  if (url.searchParams.has('encryption') && url.searchParams.get('encryption') !== 'none' || url.searchParams.has('security') && !['none', 'tls', 'reality'].includes(url.searchParams.get('security')) || url.searchParams.has('allowInsecure') && !['false', '0'].includes(url.searchParams.get('allowInsecure'))) proxyFail('invalid-input');
  return url.href;
}
// One-line recognition shared by Parse, the live paste preview and list import.
// Failures carry fixed reason codes only, never the rejected text or a secret.
export const PROXY_LIST_LIMITS = Object.freeze({ lines: 1000, lineChars: 16384 });
export const PROXY_LIST_ORDERS = Object.freeze(['host-first', 'login-first']);
// The type of a line without a scheme; a line with socks5://, socks5h://, http:// or https:// always names its own type.
export const PROXY_LIST_TYPES = Object.freeze(['socks5', 'http', 'https']);
const PROXY_URL_SCHEMES = Object.freeze({ socks5: 'socks5', socks5h: 'socks5', http: 'http', https: 'https' });
export const PROXY_LIST_REASONS = Object.freeze(['invalid-line', 'unsupported-scheme', 'invalid-host', 'invalid-port', 'invalid-credentials', 'invalid-vless', 'invalid-name', 'wrong-order', 'openvpn-config', 'duplicate', 'too-many-lines']);
// Four colon-separated fields without a scheme: host:port:user:password (legacy
// default) or user:password:host:port. The password is the only field that may
// contain ':' or '@'; an IPv6 host needs brackets in the second form.
const PROXY_LEGACY_LINES = Object.freeze({ 'host-first': /^([^:@/]+):(\d{1,5}):([^:]+):(.*)$/, 'login-first': /^([^:]+):(.*):(\[[0-9A-Fa-f:.]+\]|[^:@/[\]]+):(\d{1,5})$/ });
function proxyEndpoint(text) {
  const match = /:(\d+)\/?$/.exec(text);
  if (!match) return { reason: 'invalid-port' };
  const port = Number(match[1]), host = text.slice(0, match.index);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { reason: 'invalid-port' };
  if (!host || host.includes(':') && !/^\[[0-9A-Fa-f:.]+\]$/.test(host)) return { reason: 'invalid-host' };
  try { return { host: proxyHost(host.startsWith('[') ? new URL('http://' + host + '/').hostname : host), port }; } catch { return { reason: 'invalid-host' }; }
}
function proxyLine(raw, order, hint, defaultType = 'socks5') {
  if (!raw || raw.length > 4096 || /[\x00-\x20\x7f\\]/.test(raw)) return { reason: 'invalid-line' };
  let rest = raw, decode = true, credentials = null, type = defaultType;
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(rest);
  if (scheme) {
    const key = scheme[1].toLowerCase();
    // Own keys only: "constructor://" and "toString://" are schemes by syntax and must stay unsupported.
    if (!Object.hasOwn(PROXY_URL_SCHEMES, key)) return { reason: 'unsupported-scheme' };
    type = PROXY_URL_SCHEMES[key];
    rest = rest.slice(scheme[0].length);
  } else {
    const legacy = PROXY_LEGACY_LINES[order].exec(rest);
    // Legacy fields are literal: '%' in such a password is not an escape.
    if (legacy) { decode = false; credentials = order === 'host-first' ? [legacy[3], legacy[4]] : [legacy[1], legacy[2]]; rest = order === 'host-first' ? legacy[1] + ':' + legacy[2] : legacy[3] + ':' + legacy[4]; }
  }
  if (!credentials) {
    // The host never contains '@', so the last one ends the userinfo and a raw
    // '@', '#', '/' or '?' inside the password survives.
    const at = rest.lastIndexOf('@');
    if (at >= 0) { const info = rest.slice(0, at), colon = info.indexOf(':'); credentials = colon < 0 ? [info, ''] : [info.slice(0, colon), info.slice(colon + 1)]; rest = rest.slice(at + 1); }
  }
  const endpoint = proxyEndpoint(rest);
  if (endpoint.reason) {
    const other = order === 'host-first' ? 'login-first' : 'host-first';
    // Only a hint: the line is never reinterpreted in the order not chosen.
    if (hint && !scheme && PROXY_LEGACY_LINES[other].test(raw) && !proxyLine(raw, other, false, defaultType).reason) return { reason: 'wrong-order' };
    return endpoint;
  }
  let [username, password] = credentials ?? ['', ''];
  if (decode) { try { username = decodeURIComponent(username); password = decodeURIComponent(password); } catch { return { reason: 'invalid-credentials' }; } }
  try {
    const { name: ignored, ...profile } = validateProxyProfileInput({ name: 'proxy', type, host: endpoint.host, port: endpoint.port, username, password }); void ignored;
    return { profile, endpoint: { host: profile.host, port: profile.port }, label: '' };
  } catch { return { reason: 'invalid-credentials' }; }
}
function proxyVlessLine(raw) {
  try {
    const uri = normalizeVlessUri(raw), url = new URL(uri);
    let label = '';
    if (url.hash.length > 1) { try { const decoded = decodeURIComponent(url.hash.slice(1)).trim(); if (decoded.length <= PROXY_LIMITS.name && !/[\x00-\x1f\x7f]/.test(decoded)) label = decoded; } catch { /* A fragment name is optional. */ } }
    return { profile: { type: 'vless', uri }, endpoint: { host: proxyHost(url.hostname), port: Number(url.port) }, label };
  } catch { return { reason: 'invalid-vless' }; }
}
function proxyTextResult(text, defaultType) {
  if (typeof text !== 'string' || text.length > PROXY_LIMITS.configBytes) return { reason: 'invalid-line' };
  const raw = text.trim();
  if (/^vless(?:\\)?:\/\//.test(raw)) return proxyVlessLine(raw);
  if (/\r|\n/.test(raw) && /^(?:client|remote\s|<ca>)/m.test(raw)) return { profile: { type: 'openvpn', config: raw }, endpoint: null, label: '' };
  // A single pasted line keeps the established host-first reading; the
  // user:password:host:port reading is used only when that one fails.
  const first = proxyLine(raw, 'host-first', false, defaultType);
  if (!first.reason) return first;
  const second = proxyLine(raw, 'login-first', false, defaultType);
  return second.reason ? first : second;
}
export function parseProxyProfileText(text, { defaultType = 'socks5' } = {}) {
  if (!PROXY_LIST_TYPES.includes(defaultType)) proxyFail('invalid-input');
  const result = proxyTextResult(text, defaultType);
  if (result.reason) proxyFail('invalid-input');
  return result.profile;
}
// Secret-free summary for the live paste preview: type, endpoint and whether a
// login is present. Usernames, passwords, VLESS IDs and configs never appear.
export function inspectProxyText(text, { defaultType = 'socks5' } = {}) {
  if (typeof text !== 'string' || !text.trim()) return { state: 'empty' };
  const result = proxyTextResult(text, PROXY_LIST_TYPES.includes(defaultType) ? defaultType : 'socks5');
  if (result.reason) return { state: 'invalid', reason: result.reason };
  return { state: 'ok', type: result.profile.type, host: result.endpoint?.host ?? null, port: result.endpoint?.port ?? null, credentials: PROXY_DIRECT_TYPES.includes(result.profile.type) && result.profile.username !== '' };
}
export function proxyEndpointLabel(host, port) {
  if (typeof host !== 'string' || !host) return '';
  return (host.includes(':') ? '[' + host + ']' : host) + (Number.isInteger(port) ? ':' + port : '');
}
// Bulk import: one SOCKS5, HTTP, HTTPS or VLESS profile per line, an optional name after
// whitespace followed by '#'. Every non-empty line yields either a profile or a
// fixed reason with its 1-based line number. Exact duplicates inside the paste
// are skipped; saved profiles expose only host and port, so matches warn only.
export function parseProxyProfileList(text, { existing = [], order = 'host-first', defaultType = 'socks5' } = {}) {
  if (typeof text !== 'string' || text.length > PROXY_LIMITS.configBytes || !PROXY_LIST_ORDERS.includes(order) || !PROXY_LIST_TYPES.includes(defaultType) || !Array.isArray(existing)) proxyFail('invalid-input');
  const saved = new Set();
  for (const profile of existing.slice(0, PROXY_LIMITS.profiles)) if (profile && typeof profile.host === 'string' && Number.isInteger(profile.port)) saved.add(JSON.stringify([profile.host, profile.port]));
  const room = Math.max(0, PROXY_LIMITS.profiles - existing.length);
  const lines = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r\n|\r|\n/);
  const openVpn = lines.findIndex(line => /^\s*(?:client|<ca>)\s*$/i.test(line));
  if (openVpn >= 0) return { entries: [{ line: openVpn + 1, reason: 'openvpn-config' }], room };
  const entries = [], seen = new Map();
  let counted = 0;
  for (let index = 0; index < lines.length; index++) {
    const trimmed = lines[index].trim(), line = index + 1;
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (++counted > PROXY_LIST_LIMITS.lines) { entries.push({ line, reason: 'too-many-lines' }); break; }
    if (trimmed.length > PROXY_LIST_LIMITS.lineChars) { entries.push({ line, reason: 'invalid-line' }); continue; }
    const separator = /\s#/.exec(trimmed);
    const body = separator ? trimmed.slice(0, separator.index).trim() : trimmed, label = separator ? trimmed.slice(separator.index + 2).trim() : '';
    if (label.length > PROXY_LIMITS.name || /[\x00-\x1f\x7f]/.test(label)) { entries.push({ line, reason: 'invalid-name' }); continue; }
    const result = /^vless(?:\\)?:\/\//.test(body) ? proxyVlessLine(body) : proxyLine(body, order, true, defaultType);
    if (result.reason) { entries.push({ line, reason: result.reason }); continue; }
    const { profile, endpoint } = result;
    const key = JSON.stringify(profile.type === 'vless' ? ['vless', profile.uri.split('#')[0]] : [profile.type, profile.host, profile.port, profile.username, profile.password]);
    if (seen.has(key)) { entries.push({ line, reason: 'duplicate', duplicateOf: seen.get(key) }); continue; }
    seen.set(key, line);
    entries.push({ line, name: label || result.label || proxyEndpointLabel(endpoint.host, endpoint.port), profile, endpoint, ...(saved.has(JSON.stringify([endpoint.host, endpoint.port])) ? { warning: 'saved-endpoint' } : {}) });
  }
  return { entries, room };
}
export function validateProxyDiagnosticUrl(input) {
  if (typeof input !== 'string' || !/^https?:\/\//i.test(input) || input.length > 2048 || /[\x00-\x20\x7f\\#]/.test(input)) proxyFail('invalid-input');
  let url;
  try { url = new URL(input); } catch { proxyFail('invalid-input'); }
  const authority = input.slice(input.indexOf('//') + 2).split(/[/?#]/, 1)[0];
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || authority.includes('@') || url.href.length > 2048) proxyFail('invalid-input');
  proxyHost(url.hostname);
  if (url.port) proxyPort(Number(url.port));
  return url.href;
}
export function validateProxyDiagnosticResult(input, targetUrl = null) {
  if (!keys(input, ['reachable', 'remoteDns', 'tlsVerified', 'httpStatus', 'ip', 'elapsedMs']) || input.reachable !== true || typeof input.remoteDns !== 'boolean' || typeof input.tlsVerified !== 'boolean' || !Number.isInteger(input.httpStatus) || input.httpStatus < 100 || input.httpStatus > 599 || !Number.isInteger(input.elapsedMs) || input.elapsedMs < 0 || input.elapsedMs > 120000) proxyFail('native-protocol');
  if (targetUrl !== null) {
    const target = new URL(targetUrl), host = proxyHost(target.hostname);
    if (target.protocol === 'https:' && input.tlsVerified !== true || !host.includes(':') && !/^\d+\.\d+\.\d+\.\d+$/.test(host) && input.remoteDns !== true) proxyFail('native-protocol');
  }
  let ip = null;
  if (input.ip !== null) {
    try { ip = proxyHost(input.ip); } catch { proxyFail('native-protocol'); }
    if (!ip.includes(':') && !/^\d+\.\d+\.\d+\.\d+$/.test(ip)) proxyFail('native-protocol');
  }
  return { state: 'pass', reachable: true, remoteDns: input.remoteDns, tlsVerified: input.tlsVerified, httpStatus: input.httpStatus, ip, elapsedMs: input.elapsedMs };
}
export function validateProxyProfileCheck(input) {
  if (!keys(input, ['id', 'url'])) proxyFail('invalid-input');
  return { id: proxyId(input.id), url: validateProxyDiagnosticUrl(input.url) };
}
export function validateProxyCheckResult(input) {
  if (!keys(input, ['profileId', 'diagnostic']) || !proxyRecord(input.diagnostic)) proxyFail('native-protocol');
  const profileId = proxyId(input.profileId), value = input.diagnostic;
  if (value.state === 'pass') { const { state: ignored, ...result } = value; void ignored; return { profileId, diagnostic: validateProxyDiagnosticResult(result) }; }
  if (!keys(value, ['state', 'code'], ['phase', 'retryable']) || value.state !== 'fail' || !codes.has(value.code) || value.phase !== undefined && !PROXY_PHASES.includes(value.phase) || value.retryable !== undefined && typeof value.retryable !== 'boolean') proxyFail('native-protocol');
  return { profileId, diagnostic: { state: 'fail', code: value.code, ...(value.phase ? { phase: value.phase } : {}), ...(typeof value.retryable === 'boolean' ? { retryable: value.retryable } : {}) } };
}
export function validateProxyConnection(metadata, input) {
  if (!proxyRecord(input) || input.type !== metadata.type || Object.keys(input).some(key => ['id', 'name'].includes(key))) proxyFail('native-protocol');
  let checked;
  try { checked = validateProxyProfileInput({ name: metadata.name, ...input }); } catch { proxyFail('native-protocol'); }
  const { name: ignored, ...connection } = checked; void ignored;
  if (metadata.native !== proxyNeedsNative(connection)) proxyFail('native-protocol');
  if (PROXY_DIRECT_TYPES.includes(connection.type) && (connection.host !== metadata.host || connection.port !== metadata.port)) proxyFail('native-protocol');
  if (connection.type === 'vless') { const url = new URL(connection.uri); if (metadata.host !== null && proxyHost(url.hostname) !== metadata.host || metadata.port !== null && Number(url.port) !== metadata.port) proxyFail('native-protocol'); }
  return connection;
}
// Full credentials appear only in this explicit response object, never metadata snapshots.
export function validateProxyBundle(input) {
  if (!keys(input, ['format', 'version', 'revision', 'selectedId', 'enabled', 'routing', 'protectWebRTC', 'disablePrediction', 'autoConnect', 'killSwitch', 'profiles']) || input.format !== 'detect.expert.proxy.bundle' || input.version !== 1 || !Array.isArray(input.profiles) || input.profiles.length > PROXY_LIMITS.profiles) proxyFail('invalid-config');
  const metadata = input.profiles.map(profile => { if (!keys(profile, ['id', 'name', 'type', 'host', 'port', 'native', 'connection'], ['country'])) proxyFail('invalid-config'); const { connection: ignored, ...value } = profile; void ignored; return value; });
  const config = validateProxyConfiguration({ ...input, format: PROXY_FORMAT, profiles: metadata });
  const profiles = config.profiles.map(profile => ({ ...profile, connection: validateProxyConnection(profile, input.profiles.find(item => item.id === profile.id).connection) }));
  const result = { format: 'detect.expert.proxy.bundle', version: 1, revision: config.revision, selectedId: config.selectedId, enabled: config.enabled, routing: config.routing, protectWebRTC: config.protectWebRTC, disablePrediction: config.disablePrediction, autoConnect: config.autoConnect, killSwitch: true, profiles };
  if (new TextEncoder().encode(JSON.stringify(result)).length > PROXY_LIMITS.bundleBytes) proxyFail('capacity');
  return result;
}
// The PAC directive of each upstream kind: SOCKS5 host:port, PROXY (HTTP) host:port, HTTPS host:port (TLS to the proxy).
const PAC_DIRECTIVES = Object.freeze({ socks5: 'SOCKS5', http: 'PROXY', https: 'HTTPS' });
// Where the browser sends proxied traffic: a direct SOCKS5/HTTP/HTTPS profile, or the companion's loopback SOCKS5 relay.
export function proxyRoute(endpoint) {
  const scheme = endpoint?.scheme ?? 'socks5';
  if (!Object.hasOwn(PAC_DIRECTIVES, scheme)) proxyFail('invalid-input');
  return { host: proxyHost(endpoint.host), port: proxyPort(endpoint.port), scheme };
}
// Firefox ProxyInfo for the same route. proxyDNS belongs to SOCKS only: HTTP and HTTPS proxies always receive the host name.
export function buildProxyInfo(endpoint) {
  const { host, port, scheme } = proxyRoute(endpoint);
  return scheme === 'socks5' ? { type: 'socks', host, port, proxyDNS: true, failoverTimeout: 1 } : { type: scheme, host, port, failoverTimeout: 1 };
}
// Literals only. No dnsResolve/isResolvable calls, executable input or DIRECT failover.
export function buildProxyPac(configuration, endpoint) {
  const config = validateProxyConfiguration(configuration), { host, port, scheme } = proxyRoute(endpoint);
  const action = PAC_DIRECTIVES[scheme] + ' ' + (host.includes(':') ? '[' + host + ']' : host) + ':' + port;
  return 'function FindProxyForURL(url, host) {\n' +
    'host = host.toLowerCase().replace(/^\\[|\\]$/g, "").replace(/\\.$/, "");\n' +
    'var direct = ' + JSON.stringify(config.routing.directDomains) + ', include = ' + JSON.stringify(config.routing.proxyDomains) + ';\n' +
    'function match(list) { for (var i=0; i<list.length; i++) { var d=list[i]; if (d.slice(0,2)==="*.") { if (host.length>d.length-1 && host.slice(-(d.length-1))===d.slice(1)) return true; } else if (host===d) return true; } return false; }\n' +
    (config.routing.bypassLocal ? 'if (host==="localhost" || /\\.localhost$|\\.local$/.test(host) || /^[^:.]+$/.test(host) || host==="::1" || /^(?:fc|fd)[0-9a-f]{2}:|^fe[89ab][0-9a-f]:/.test(host) || /^(?:127|10)\\.|^192\\.168\\.|^169\\.254\\./.test(host) || /^172\\.(?:1[6-9]|2[0-9]|3[01])\\./.test(host)) return "DIRECT";\n' : '') +
    'if (match(direct)) return "DIRECT";\n' + (config.routing.mode === 'include' ? 'if (!match(include)) return "DIRECT";\n' : '') +
    'return ' + JSON.stringify(action) + ';\n}\n';
}
export function isOwnProxyOptions(api, env = globalThis) {
  try { const win = env.window ?? env, actual = new URL(env.location.href), expected = new URL(api.runtime.getURL('options.html')); return win.top === win && actual.protocol === expected.protocol && actual.host === expected.host && actual.pathname === expected.pathname && !actual.username && !actual.password; } catch { return false; }
}
export function isProxyUiSender(api, sender) {
  try {
    const actual = new URL(sender.url), expected = new URL(api.runtime.getURL('options.html'));
    const owns = url => url.protocol === expected.protocol && url.host === expected.host && url.pathname === expected.pathname && !url.username && !url.password;
    // Native Options documents opened in a tab carry sender.tab in both engines.
    // Authorization comes from their native exact extension URL and top frame,
    // never from an arbitrary caller-provided tab identity.
    const tabValid = sender.tab === undefined || sender.frameId === 0 && (sender.tab.url === undefined || owns(new URL(sender.tab.url)));
    return sender.id === api.runtime.id && tabValid && (sender.frameId === undefined || sender.frameId === 0) && (!sender.origin || sender.origin === expected.protocol + '//' + expected.host) && owns(actual);
  } catch { return false; }
}
