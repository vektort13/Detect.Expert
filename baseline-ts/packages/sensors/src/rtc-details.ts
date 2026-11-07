// ADR-020 / DET-056/057: event-driven, bounded ICE server history. No peer IP/SDP/credentials.
import { CHANNEL, RTC_DETAILS_CHANNEL, RTC_LIMITS, parseRtcServerUrl, validateBridgeMessage } from '@detect-expert/contracts';
import type { RtcConnection, RtcServer, RtcSnapshot } from '@detect-expert/contracts';
import type { SensorRuntime } from './runtime';
import { arrayPush } from './intrinsics';
import { valueCaptureDenied, onValueCaptureDenied } from './value-capture-policy';

const descriptor = Object.getOwnPropertyDescriptor;
const apply = Reflect.apply;
const source = Function.prototype.call.bind(Function.prototype.toString) as (fn: Function) => string;
const includes = Function.prototype.call.bind(String.prototype.includes) as (value: string, part: string) => boolean;
const own = Function.prototype.call.bind(Object.prototype.hasOwnProperty) as (v: object, k: string) => boolean;
const array = Array.isArray;
const integer = Number.isSafeInteger;
const WeakMapCtor = WeakMap;
const WeakRefCtor = WeakRef;
const weakGet = Function.prototype.call.bind(WeakMap.prototype.get) as <T>(map: WeakMap<object, T>, key: object) => T | undefined;
const weakSet = Function.prototype.call.bind(WeakMap.prototype.set) as <T>(map: WeakMap<object, T>, key: object, value: T) => unknown;
const deref = Function.prototype.call.bind(WeakRef.prototype.deref) as (value: WeakRef<object>) => object | undefined;
const NO_ARGS: readonly unknown[] = Object.freeze([]);
const MAX = 2147483647;
const min = Math.min;
const finite = Number.isFinite;
const EVENT_TYPES = ['icecandidate', 'icecandidateerror', 'connectionstatechange'] as const;
function prototype(name: string): object | null {
  const constructor = descriptor(globalThis, name);
  if (!constructor || !own(constructor, 'value') || typeof constructor.value !== 'function') return null;
  const value: unknown = descriptor(constructor.value, 'prototype')?.value;
  return typeof value === 'object' && value !== null ? value : null;
}
function native(target: object | null, key: string, getter = false): Function | null {
  const d = target && descriptor(target, key);
  const f: unknown = getter ? d?.get : d?.value;
  return typeof f === 'function' && includes(source(f), '[native code]') ? f : null;
}
// Parent-realm references are reused for genuine same-origin child instances, like visual native getters.
const pc = prototype('RTCPeerConnection');
const configuration = native(pc, 'getConfiguration');
const connectionState = native(pc, 'connectionState', true);
const eventTarget = prototype('EventTarget');
const add = native(eventTarget, 'addEventListener');
const remove = native(eventTarget, 'removeEventListener');
const eventPrototype = prototype('Event');
const eventType = native(eventPrototype, 'type', true);
const eventTargetGetter = native(eventPrototype, 'target', true);
const candidateGetter = native(prototype('RTCPeerConnectionIceEvent'), 'candidate', true);
const eventUrl = native(prototype('RTCPeerConnectionIceEvent'), 'url', true);
const candidateUrl = native(prototype('RTCIceCandidate'), 'url', true);
const errorUrl = native(prototype('RTCPeerConnectionIceErrorEvent'), 'url', true);

interface Tracked { row: RtcConnection; ref: WeakRef<object>; start: number; listener: (event: unknown) => void; attached: boolean }
export interface RtcCapture { seen(value: unknown, created?: boolean, configuration?: unknown, originalConfiguration?: unknown): void; configured(value: unknown): void; closed(value: unknown): void }
const captures = new WeakMapCtor<object, RtcCapture>();

export function installRtcCapture(runtime: SensorRuntime, onConfiguration?: (value: unknown) => void): RtcCapture | undefined {
  const existing = weakGet(captures, runtime);
  if (existing) return existing;
  // Metadata is unavailable if native dependencies were detectably replaced. Ordinary counters continue.
  if (!configuration || !connectionState || !add || !remove || !eventType || !eventTargetGetter) return undefined;
  const env = runtime.visualEnv;
  let objects = new WeakMapCtor<object, Tracked | null>();
  let rows: Tracked[] = [];
  let total = 0;
  let omitted = 0;
  let revision = 0;
  let estimated = 128;
  let captureLimited = false;
  let epoch = runtime.historyEpoch;
  let transportEpoch = 0;
  let timer: unknown = null;
  let stopped = false;
  let dirty = false;
  let helloTimer: unknown = null;
  let helloCount = 0;
  let helloStarted = false;
  let bridgeRequested = false;
  const detach = (entry: Tracked): void => {
    if (!entry.attached) return;
    const instance = deref(entry.ref);
    if (instance) for (let i = 0; i < EVENT_TYPES.length; i++) {
      try { apply(remove!, instance, [EVENT_TYPES[i], entry.listener, true]); } catch { /* Native ownership best effort. */ }
    }
    entry.attached = false;
  };
  const reset = (): void => {
    for (let i = 0; i < rows.length; i++) detach(rows[i]!);
    rows = []; objects = new WeakMapCtor<object, Tracked | null>(); total = 0; omitted = 0; estimated = 128; captureLimited = false;
    epoch = runtime.historyEpoch;
    if (timer !== null) env.clearTimeout(timer);
    timer = null; dirty = false;
    if (helloTimer !== null) env.clearTimeout(helloTimer);
    helloTimer = null; helloCount = 0; helloStarted = false; bridgeRequested = false;
    revision = min(MAX, revision + 1);
  };
  const active = (): boolean => {
    if (valueCaptureDenied(runtime)) return false;
    if (epoch !== runtime.historyEpoch) reset();
    return !stopped && runtime.hooks.enabled;
  };
  const snapshot = (): RtcSnapshot => {
    if (valueCaptureDenied(runtime)) return { revision, total: 0, omitted: 0, captureLimited: false, connections: [] };
    const connections: RtcConnection[] = [];
    for (let i = 0; i < rows.length; i++) {
      const entry = rows[i]!;
      const servers: RtcServer[] = [];
      for (let j = 0; j < entry.row.servers.length; j++) arrayPush(servers, { ...entry.row.servers[j]! });
      arrayPush(connections, { ...entry.row, servers });
    }
    return { revision, total, omitted, captureLimited, connections };
  };
  const flush = (): void => {
    timer = null;
    if (!active() || !dirty || total === 0) return;
    const value = snapshot();
    if (valueCaptureDenied(runtime)) return;
    dirty = false;
    env.postMessage({ channel: RTC_DETAILS_CHANNEL, type: 'rtc-snapshot', sensorBootId: runtime.sensorBootId, epoch: transportEpoch, snapshot: value });
  };
  const changed = (): void => {
    if (!active()) return;
    revision = min(MAX, revision + 1); dirty = true;
    if (timer === null && !stopped) timer = env.setTimeout(flush, RTC_LIMITS.flushMs);
  };
  const server = (entry: Tracked, raw: unknown, kind: 'configured' | 'candidate' | 'error'): void => {
    if (!active()) return;
    const endpoint = parseRtcServerUrl(raw);
    if (!endpoint) { entry.row.truncated = true; captureLimited = true; return; }
    let previous: RtcServer | undefined;
    for (let i = 0; i < entry.row.servers.length; i++) {
      const s = entry.row.servers[i]!;
      if (s.scheme === endpoint.scheme && s.host === endpoint.host && s.port === endpoint.port && s.transport === endpoint.transport) { previous = s; break; }
    }
    if (previous) { previous[kind] = true; return; }
    const cost = endpoint.host.length + 140;
    if (entry.row.servers.length >= RTC_LIMITS.maxServers || estimated + cost > RTC_LIMITS.maxBytes - 512) {
      entry.row.truncated = true; captureLimited = true; return;
    }
    estimated += cost;
    const value: RtcServer = { ...endpoint, configured: false, candidate: false, error: false };
    value[kind] = true; arrayPush(entry.row.servers, value);
  };
  const config = (instance: object, entry: Tracked, snapshotValue?: unknown): void => {
    if (!active()) return;
    try {
      // The ONLY extra API read: native browser-owned snapshot. Never inspect constructor/setter arguments.
      const raw: unknown = snapshotValue ?? apply(configuration!, instance, NO_ARGS);
      if (!active()) return;
      if (typeof raw !== 'object' || raw === null) throw new Error('native configuration unavailable');
      try { onConfiguration?.(raw); } catch { runtime.limitRtcValues(); }
      const servers: unknown = descriptor(raw, 'iceServers')?.value;
      if (servers === undefined) return;
      if (!array(servers)) throw new Error('native server list unavailable');
      const length: unknown = descriptor(servers, 'length')?.value;
      if (typeof length !== 'number' || !integer(length) || length < 0) throw new Error('native server list unavailable');
      if (length > RTC_LIMITS.maxServers) { entry.row.truncated = true; captureLimited = true; }
      for (let i = 0; i < min(length, RTC_LIMITS.maxServers); i++) {
        const item: unknown = descriptor(servers, '' + i)?.value;
        if (typeof item !== 'object' || item === null) continue;
        const urls: unknown = descriptor(item, 'urls')?.value;
        if (typeof urls === 'string') server(entry, urls, 'configured');
        else if (array(urls)) {
          const count: unknown = descriptor(urls, 'length')?.value;
          if (typeof count !== 'number' || !integer(count) || count < 0) continue;
          if (count > RTC_LIMITS.maxServers) { entry.row.truncated = true; captureLimited = true; }
          for (let j = 0; j < min(count, RTC_LIMITS.maxServers); j++) server(entry, descriptor(urls, '' + j)?.value, 'configured');
        }
      }
    } catch { captureLimited = true; entry.row.truncated = true; }
  };
  const state = (instance: object, entry: Tracked): void => {
    if (!active()) return;
    try {
      const value: unknown = apply(connectionState!, instance, NO_ARGS);
      if (value === 'new' || value === 'connecting' || value === 'connected' || value === 'disconnected' || value === 'failed' || value === 'closed') {
        entry.row.state = value;
        if (value === 'connected') entry.row.connected = true;
      }
    } catch { captureLimited = true; }
  };
  const seen = (value: unknown, created = false, configurationValue?: unknown, originalConfiguration?: unknown): Tracked | undefined => {
    if (!active() || typeof value !== 'object' || value === null) return undefined;
    const known = weakGet(objects, value);
    if (known !== undefined) return known ?? undefined;
    // Brand-check before counting a fake/subclass return. No own properties of an arbitrary instance.
    let initial: unknown;
    const reusable = runtime.visualEnv.earlyCaptureGuaranteed === true && !runtime.visualEnv.startedLate && originalConfiguration === configuration;
    try { initial = reusable && configurationValue !== undefined ? configurationValue : apply(configuration!, value, NO_ARGS); } catch { return undefined; }
    if (!active()) return undefined;
    total = min(MAX, total + 1);
    if (rows.length >= RTC_LIMITS.maxConnections || estimated + 240 > RTC_LIMITS.maxBytes - 512) {
      omitted = min(MAX, omitted + 1); weakSet(objects, value, null); changed(); return undefined;
    }
    const row: RtcConnection = { id: total, created, closed: false, connected: false, state: 'unknown', duration: 'open', configurationChanges: 0, servers: [], truncated: false };
    const entry: Tracked = { row, ref: new WeakRefCtor(value), start: env.now(), attached: false, listener: () => undefined };
    arrayPush(rows, entry); estimated += 240; weakSet(objects, value, entry);
    config(value, entry, initial); state(value, entry);
    if (!active()) return undefined;
    entry.listener = (event: unknown): void => {
      if (!active() || !entry.attached || typeof event !== 'object' || event === null) return;
      const instance = deref(entry.ref);
      if (!instance) return;
      try {
        // isTrusted is an unforgeable own accessor on native Event instances. Brand-check target first.
        if (apply(eventTargetGetter!, event, NO_ARGS) !== instance) return;
        const trusted = descriptor(event, 'isTrusted');
        if (!trusted?.get || trusted.configurable || !includes(source(trusted.get), '[native code]') || apply(trusted.get, event, NO_ARGS) !== true) return;
        const type: unknown = apply(eventType!, event, NO_ARGS);
        if (type === 'icecandidate') {
          let url: unknown;
          if (candidateGetter && candidateUrl) {
            const candidate: unknown = apply(candidateGetter, event, NO_ARGS);
            if (typeof candidate === 'object' && candidate !== null) url = apply(candidateUrl, candidate, NO_ARGS);
          }
          if ((url === undefined || url === null || url === '') && eventUrl) url = apply(eventUrl, event, NO_ARGS);
          if (typeof url === 'string' && url.length > 0) server(entry, url, 'candidate');
        } else if (type === 'icecandidateerror' && errorUrl) {
          const url: unknown = apply(errorUrl, event, NO_ARGS);
          if (typeof url === 'string' && url.length > 0) server(entry, url, 'error');
        } else if (type === 'connectionstatechange') state(instance, entry);
        changed();
      } catch { captureLimited = true; changed(); }
    };
    try {
      for (let i = 0; i < EVENT_TYPES.length; i++) apply(add!, value, [EVENT_TYPES[i], entry.listener, true]);
      entry.attached = true;
    } catch { captureLimited = true; entry.attached = true; detach(entry); }
    changed(); startHello(); return entry;
  };
  const hello = (): void => {
    helloTimer = null;
    if (!active() || helloCount >= 4 || bridgeRequested) return;
    if (epoch !== runtime.historyEpoch) { reset(); return; }
    helloCount++; env.postMessage({ channel: RTC_DETAILS_CHANNEL, type: 'rtc-hello', sensorBootId: runtime.sensorBootId, epoch: transportEpoch });
    if (helloCount < 4) helloTimer = env.setTimeout(hello, 500);
  };
  // Descriptors/control routing stay installed from document_start; network-free idle pages need no
  // RTC readiness requests. The first genuine instance is still captured synchronously, even at close(0ms).
  const startHello = (): void => {
    if (!active() || helloStarted || bridgeRequested) return;
    helloStarted = true;
    hello();
  };
  const onMessage = (event: unknown): void => {
    try {
      if (stopped || valueCaptureDenied(runtime) || typeof event !== 'object' || event === null) return;
      const message = env.readMessage(event);
      if (message.source !== env.self || typeof message.data !== 'object' || message.data === null) return;
      const data = message.data as object;
      const channel: unknown = descriptor(data, 'channel')?.value;
      if (channel === RTC_DETAILS_CHANNEL && descriptor(data, 'sensorBootId')?.value === runtime.sensorBootId) {
        const type: unknown = descriptor(data, 'type')?.value;
        if (type === 'rtc-reset') {
          const next: unknown = descriptor(data, 'epoch')?.value;
          if (typeof next === 'number' && integer(next) && next >= 0 && next <= MAX) { transportEpoch = next; reset(); }
        }
        else if (type === 'rtc-request' && descriptor(data, 'epoch')?.value === transportEpoch) {
          const observing = active();
          bridgeRequested = true; helloCount = 4;
          if (helloTimer !== null) env.clearTimeout(helloTimer);
          helloTimer = null;
          if (observing && total > 0) { dirty = true; if (timer === null) timer = env.setTimeout(flush, 0); }
        }
      } else if (channel === CHANNEL) {
        const type: unknown = descriptor(data, 'type')?.value;
        if ((type !== 'bridge-pause' && type !== 'bridge-stop') || descriptor(data, 'sensorBootId')?.value !== runtime.sensorBootId) return;
        const checked = validateBridgeMessage(data);
        if (checked.ok && checked.value.sensorBootId === runtime.sensorBootId && (checked.value.type === 'bridge-pause' || checked.value.type === 'bridge-stop')) reset();
      }
    } catch { /* MAIN messages are untrusted routing only. */ }
  };
  const capture: RtcCapture = {
    seen(value, created, configurationValue, originalConfiguration) { seen(value, created, configurationValue, originalConfiguration); },
    configured(value) {
      if (!active() || typeof value !== 'object' || value === null) return;
      const known = weakGet(objects, value);
      const entry = seen(value);
      if (!entry) return;
      entry.row.configurationChanges = min(MAX, entry.row.configurationChanges + 1);
      // First observation already took the native current-configuration snapshot in seen().
      if (known) config(value, entry);
      changed();
    },
    closed(value) {
      const entry = seen(value);
      if (!entry || entry.row.closed) return;
      entry.row.closed = true; entry.row.state = 'closed';
      const ms = env.now() - entry.start;
      entry.row.duration = !entry.row.created || !finite(ms) || ms < 0 ? 'unknown' : ms < 1000 ? 'under-1s' : ms < 10000 ? '1-10s' : '10s-plus';
      detach(entry); changed();
    },
  };
  weakSet(captures, runtime, capture);
  onValueCaptureDenied(runtime, reset);
  if (!valueCaptureDenied(runtime)) {
    env.addEventListener('message', onMessage);
    env.addEventListener('pagehide', flush);
  }
  runtime.onStop(() => { stopped = true; reset(); if (helloTimer !== null) env.clearTimeout(helloTimer); env.removeEventListener('message', onMessage); env.removeEventListener('pagehide', flush); });
  return capture;
}
