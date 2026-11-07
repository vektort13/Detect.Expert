// ADR-020: owner-requested ICE server metadata, separate from ordinary observations/export.
// Page controlled. No client candidate addresses, SDP, credentials or payloads are allowed.
export const RTC_DETAILS_CHANNEL = 'detect.expert/rtc/v1' as const;
export const RTC_LIMITS = Object.freeze({ maxConnections: 32, maxServers: 8, maxBytes: 32768, maxDocuments: 8, idleMs: 600000, flushMs: 250 });
export const RTC_STATES = ['new', 'connecting', 'connected', 'disconnected', 'failed', 'closed', 'unknown'] as const;
export const RTC_DURATIONS = ['open', 'under-1s', '1-10s', '10s-plus', 'unknown'] as const;
export interface RtcServer {
  scheme: 'stun' | 'stuns' | 'turn' | 'turns';
  /** ICE server host only; never a local/remote peer candidate address. IPv6 uses brackets. */
  host: string;
  port: number | null;
  transport: 'udp' | 'tcp' | null;
  configured: boolean;
  candidate: boolean;
  error: boolean;
}
export interface RtcConnection {
  id: number;
  created: boolean;
  closed: boolean;
  connected: boolean;
  state: typeof RTC_STATES[number];
  duration: typeof RTC_DURATIONS[number];
  configurationChanges: number;
  servers: RtcServer[];
  truncated: boolean;
}
export interface RtcSnapshot { revision: number; total: number; omitted: number; captureLimited: boolean; connections: RtcConnection[] }
export interface RtcUiRequest { schemaVersion: 1; type: 'ui-rtc-get'; tabId: number; documentKey: string }
export type RtcPageRequest = { schemaVersion: 1; type: 'rtc-ready' }
  | { schemaVersion: 1; type: 'rtc-snapshot'; token: string; snapshot: RtcSnapshot };
export interface RtcStateResponse { schemaVersion: 1; type: 'rtc-state'; documentKey: string; snapshot: RtcSnapshot | null }
export interface RtcControl { schemaVersion: 1; type: 'rtc-control'; enabled: boolean; token: string | null; reset: boolean }
export interface RtcAck { schemaVersion: 1; type: 'rtc-ack'; accepted: boolean; reset: boolean }
export type RtcSensorMessage = { channel: typeof RTC_DETAILS_CHANNEL; type: 'rtc-hello'; sensorBootId: string; epoch: number }
  | { channel: typeof RTC_DETAILS_CHANNEL; type: 'rtc-snapshot'; sensorBootId: string; epoch: number; snapshot: RtcSnapshot };

type Checked<T> = { ok: true; value: T } | { ok: false };
const get = Object.getOwnPropertyDescriptor;
const keys = Object.getOwnPropertyNames;
const isArray = Array.isArray;
const isInteger = Number.isSafeInteger;
const exec = Function.prototype.call.bind(RegExp.prototype.exec) as (re: RegExp, text: string) => RegExpExecArray | null;
const test = (re: RegExp, text: string): boolean => exec(re, text) !== null;
const lower = Function.prototype.call.bind(String.prototype.toLowerCase) as (text: string) => string;
const at = Function.prototype.call.bind(String.prototype.charCodeAt) as (text: string, index: number) => number;
const TOKEN = /^[a-f0-9]{32}$/;
const BOOT = /^boot-[a-f0-9]{24}$/;
const MAX_COUNT = 2147483647;
function read(v: object, key: string): unknown { return get(v, key)?.value; }
function shape(v: unknown, fields: readonly string[]): v is object {
  if (typeof v !== 'object' || v === null || keys(v).length !== fields.length) return false;
  for (let i = 0; i < fields.length; i++) { const d = get(v, fields[i]!); if (!d || !get(d, 'value')) return false; }
  return true;
}
function integer(v: unknown, min = 0, max = MAX_COUNT): v is number { return typeof v === 'number' && isInteger(v) && v >= min && v <= max; }
function documentKey(v: unknown): v is string { return typeof v === 'string' && v.length > 0 && v.length <= 128; }
function token(v: unknown): v is string { return typeof v === 'string' && test(TOKEN, v); }
function host(v: unknown): v is string {
  if (typeof v !== 'string' || v.length < 1 || v.length > 253) return false;
  if (test(/^\[[0-9a-f:]{2,45}\]$/, v)) { for (let i = 0; i < v.length; i++) if (at(v, i) === 58) return true; return false; }
  if (!test(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/, v)) return false;
  let length = 0, previous = 0;
  for (let i = 0; i <= v.length; i++) {
    const c = i === v.length ? 46 : at(v, i);
    if (c === 46) { if (length === 0 || length > 63 || previous === 45) return false; length = 0; }
    else { if (length === 0 && c === 45) return false; length++; }
    previous = c;
  }
  return true;
}

/** Primitive browser-provided ICE URL only. Query values other than transport and credentials are rejected. */
export function parseRtcServerUrl(value: unknown): Pick<RtcServer, 'scheme' | 'host' | 'port' | 'transport'> | null {
  if (typeof value !== 'string' || value.length > 512) return null;
  const parts = exec(/^(stun|stuns|turn|turns):(\[[0-9a-f:]+\]|[a-z0-9.-]+)(?::([0-9]{1,5}))?(?:\?transport=(udp|tcp))?$/, lower(value));
  if (!parts || !host(parts[2])) return null;
  const port = parts[3] === undefined ? null : +parts[3];
  if (port !== null && !integer(port, 1, 65535)) return null;
  return { scheme: parts[1] as RtcServer['scheme'], host: parts[2], port, transport: (parts[4] ?? null) as RtcServer['transport'] };
}

export function validateRtcSnapshot(value: unknown): Checked<RtcSnapshot> {
  try {
    if (!shape(value, ['revision', 'total', 'omitted', 'captureLimited', 'connections'])) return { ok: false };
    const revision = read(value, 'revision'), total = read(value, 'total'), omitted = read(value, 'omitted'), captureLimited = read(value, 'captureLimited');
    const raw = read(value, 'connections');
    if (!integer(revision) || !integer(total) || !integer(omitted) || typeof captureLimited !== 'boolean' || !isArray(raw) || raw.length > RTC_LIMITS.maxConnections || total < raw.length || omitted > total) return { ok: false };
    const connections: RtcConnection[] = [];
    let chars = 128;
    const ids = new Set<number>();
    for (let i = 0; i < raw.length; i++) {
      const c: unknown = read(raw, String(i));
      if (!shape(c, ['id', 'created', 'closed', 'connected', 'state', 'duration', 'configurationChanges', 'servers', 'truncated'])) return { ok: false };
      const id = read(c, 'id'), created = read(c, 'created'), closed = read(c, 'closed'), connected = read(c, 'connected');
      const state = read(c, 'state'), duration = read(c, 'duration'), configurationChanges = read(c, 'configurationChanges'), truncated = read(c, 'truncated');
      const s = read(c, 'servers');
      if (!integer(id, 1) || ids.has(id) || id > total || typeof created !== 'boolean' || typeof closed !== 'boolean' || typeof connected !== 'boolean' ||
          !(RTC_STATES as readonly unknown[]).includes(state) || !(RTC_DURATIONS as readonly unknown[]).includes(duration) ||
          !integer(configurationChanges) || typeof truncated !== 'boolean' || !isArray(s) || s.length > RTC_LIMITS.maxServers) return { ok: false };
      ids.add(id);
      const servers: RtcServer[] = [];
      const endpoints = new Set<string>();
      chars += 240;
      for (let j = 0; j < s.length; j++) {
        const item: unknown = read(s, String(j));
        if (!shape(item, ['scheme', 'host', 'port', 'transport', 'configured', 'candidate', 'error'])) return { ok: false };
        const scheme = read(item, 'scheme'), h = read(item, 'host'), port = read(item, 'port'), transport = read(item, 'transport');
        const configured = read(item, 'configured'), candidate = read(item, 'candidate'), error = read(item, 'error');
        if (!['stun', 'stuns', 'turn', 'turns'].includes(scheme as string) || !host(h) || (port !== null && !integer(port, 1, 65535)) ||
            (transport !== null && transport !== 'udp' && transport !== 'tcp') || typeof configured !== 'boolean' || typeof candidate !== 'boolean' || typeof error !== 'boolean') return { ok: false };
        const key = scheme + '|' + h + '|' + port + '|' + transport;
        if (endpoints.has(key)) return { ok: false };
        endpoints.add(key);
        chars += h.length + 140;
        if (chars > RTC_LIMITS.maxBytes) return { ok: false };
        servers.push({ scheme: scheme as RtcServer['scheme'], host: h, port, transport, configured, candidate, error });
      }
      connections.push({ id, created, closed, connected, state: state as RtcConnection['state'], duration: duration as RtcConnection['duration'], configurationChanges, servers, truncated });
    }
    return { ok: true, value: { revision, total, omitted, captureLimited, connections } };
  } catch { return { ok: false }; }
}
export function validateRtcUiRequest(v: unknown): Checked<RtcUiRequest> {
  try {
    if (!shape(v, ['schemaVersion', 'type', 'tabId', 'documentKey']) || read(v, 'schemaVersion') !== 1 || read(v, 'type') !== 'ui-rtc-get' || !integer(read(v, 'tabId')) || !documentKey(read(v, 'documentKey'))) return { ok: false };
    return { ok: true, value: v as RtcUiRequest };
  } catch { return { ok: false }; }
}
export function validateRtcPageRequest(v: unknown): Checked<RtcPageRequest> {
  try {
    if (shape(v, ['schemaVersion', 'type']) && read(v, 'schemaVersion') === 1 && read(v, 'type') === 'rtc-ready') return { ok: true, value: { schemaVersion: 1, type: 'rtc-ready' } };
    if (!shape(v, ['schemaVersion', 'type', 'token', 'snapshot']) || read(v, 'schemaVersion') !== 1 || read(v, 'type') !== 'rtc-snapshot' || !token(read(v, 'token'))) return { ok: false };
    const snapshot = validateRtcSnapshot(read(v, 'snapshot'));
    return snapshot.ok ? { ok: true, value: { schemaVersion: 1, type: 'rtc-snapshot', token: read(v, 'token') as string, snapshot: snapshot.value } } : { ok: false };
  } catch { return { ok: false }; }
}
export function validateRtcStateResponse(v: unknown): Checked<RtcStateResponse> {
  try {
    if (!shape(v, ['schemaVersion', 'type', 'documentKey', 'snapshot']) || read(v, 'schemaVersion') !== 1 || read(v, 'type') !== 'rtc-state' || !documentKey(read(v, 'documentKey'))) return { ok: false };
    const raw = read(v, 'snapshot');
    const snapshot = raw === null ? null : validateRtcSnapshot(raw);
    return snapshot === null || snapshot.ok ? { ok: true, value: { schemaVersion: 1, type: 'rtc-state', documentKey: read(v, 'documentKey') as string, snapshot: snapshot?.value ?? null } } : { ok: false };
  } catch { return { ok: false }; }
}
export function validateRtcControl(v: unknown): Checked<RtcControl> {
  try {
    if (!shape(v, ['schemaVersion', 'type', 'enabled', 'token', 'reset']) || read(v, 'schemaVersion') !== 1 || read(v, 'type') !== 'rtc-control' || typeof read(v, 'enabled') !== 'boolean' || typeof read(v, 'reset') !== 'boolean') return { ok: false };
    if (read(v, 'enabled') ? !token(read(v, 'token')) : read(v, 'token') !== null) return { ok: false };
    return { ok: true, value: v as RtcControl };
  } catch { return { ok: false }; }
}
export function validateRtcSensorMessage(v: unknown): Checked<RtcSensorMessage> {
  try {
    if (typeof v !== 'object' || v === null || read(v, 'channel') !== RTC_DETAILS_CHANNEL || typeof read(v, 'sensorBootId') !== 'string' || !test(BOOT, read(v, 'sensorBootId') as string) || !integer(read(v, 'epoch'))) return { ok: false };
    if (read(v, 'type') === 'rtc-hello' && shape(v, ['channel', 'type', 'sensorBootId', 'epoch'])) return { ok: true, value: v as RtcSensorMessage };
    if (read(v, 'type') !== 'rtc-snapshot' || !shape(v, ['channel', 'type', 'sensorBootId', 'epoch', 'snapshot'])) return { ok: false };
    const snapshot = validateRtcSnapshot(read(v, 'snapshot'));
    return snapshot.ok ? { ok: true, value: { channel: RTC_DETAILS_CHANNEL, type: 'rtc-snapshot', sensorBootId: read(v, 'sensorBootId') as string, epoch: read(v, 'epoch') as number, snapshot: snapshot.value } } : { ok: false };
  } catch { return { ok: false }; }
}
