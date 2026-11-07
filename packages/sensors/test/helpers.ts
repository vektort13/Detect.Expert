// Test-only fakes: a deterministic RuntimeEnv (manual clock, timers, listeners, posted messages) and bridge
// message builders. No DOM.

import { CHANNEL, PROTOCOL_VERSION, validateSensorMessage } from '@detect-expert/contracts';
import type { BridgeStopReason, SensorMessage } from '@detect-expert/contracts';
import type { RuntimeEnv, SensorRuntime } from '../src/index';

interface Timer {
  id: number;
  at: number;
  fn: () => void;
}

export interface FakeEnv {
  env: RuntimeEnv;
  self: object;
  posted: unknown[];
  /** Advances the clock and fires due timers in order. */
  advance(ms: number): void;
  dispatch(type: string, event: unknown): void;
  pendingTimers(): number;
  listenerCount(type: string): number;
  /** Every posted message, asserted valid against the contracts validator. */
  messages(): SensorMessage[];
  batches(): Array<Extract<SensorMessage, { type: 'sensor-batch' }>>;
  statuses(): Array<Extract<SensorMessage, { type: 'sensor-status' }>>;
}

export function makeEnv(options?: { startedLate?: boolean }): FakeEnv {
  let time = 1000;
  let nextId = 1;
  let timers: Timer[] = [];
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const posted: unknown[] = [];
  const self = { fake: 'window' };
  const env: RuntimeEnv = {
    self,
    readMessage: (event) => event as { source: unknown; data: unknown },
    postMessage: (message) => {
      posted.push(message);
    },
    addEventListener: (type, listener) => {
      let set = listeners.get(type);
      if (set === undefined) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(listener);
    },
    removeEventListener: (type, listener) => {
      listeners.get(type)?.delete(listener);
    },
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.push({ id, at: time + ms, fn });
      return id;
    },
    clearTimeout: (handle) => {
      timers = timers.filter((t) => t.id !== handle);
    },
    now: () => time,
    randomBytes: (length) => {
      const out = new Uint8Array(length);
      for (let i = 0; i < length; i++) out[i] = (i * 37 + 11) & 0xff;
      return out;
    },
    startedLate: options?.startedLate ?? false,
    earlyCaptureGuaranteed: options?.startedLate !== true,
  };
  const messages = (): SensorMessage[] =>
    posted.map((m) => {
      const r = validateSensorMessage(m);
      if (!r.ok) throw new Error('posted message is invalid: ' + r.reason);
      return r.value;
    });
  return {
    env,
    self,
    posted,
    advance(ms) {
      const target = time + ms;
      for (;;) {
        const due = timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0];
        if (due === undefined) break;
        time = due.at;
        timers = timers.filter((t) => t.id !== due.id);
        due.fn();
      }
      time = target;
    },
    dispatch(type, event) {
      for (const l of [...(listeners.get(type) ?? [])]) l(event);
    },
    pendingTimers: () => timers.length,
    listenerCount: (type) => listeners.get(type)?.size ?? 0,
    messages,
    batches: () => messages().filter((m): m is Extract<SensorMessage, { type: 'sensor-batch' }> => m.type === 'sensor-batch'),
    statuses: () => messages().filter((m): m is Extract<SensorMessage, { type: 'sensor-status' }> => m.type === 'sensor-status'),
  };
}

export function bridgeHello(
  runtime: SensorRuntime,
  options?: { paused?: boolean; protocolVersion?: number; sensorBootId?: string },
): Record<string, unknown> {
  return {
    channel: CHANNEL,
    sensorBootId: options?.sensorBootId ?? runtime.sensorBootId,
    type: 'bridge-hello',
    protocolVersion: options?.protocolVersion ?? PROTOCOL_VERSION,
    bridgeSessionId: 'bridge-1',
    paused: options?.paused ?? false,
  };
}

export function bridgeSimple(runtime: SensorRuntime, type: 'bridge-pause' | 'bridge-resume'): Record<string, unknown> {
  return { channel: CHANNEL, sensorBootId: runtime.sensorBootId, type };
}

export function bridgeStop(runtime: SensorRuntime, reason: BridgeStopReason): Record<string, unknown> {
  return { channel: CHANNEL, sensorBootId: runtime.sensorBootId, type: 'bridge-stop', reason };
}

/** Delivers a bridge message as a window message event from the realm's own window. */
export function deliver(fake: FakeEnv, data: unknown, source: unknown = fake.self): void {
  fake.dispatch('message', { source, data });
}
