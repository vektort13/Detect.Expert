// ISOLATED collector (E04-02, spec A5/A6/A7, ADR-004). Wires the message gate, handshake, aggregate ring and
// delivery loop. It never reads page globals, DOM text, cookies or URLs (REQ-005); every incoming message is
// page-controlled (REQ-004); every structure is bounded (REQ-011); losses surface as coverage flags (REQ-009).

import { BUDGETS, MAX_COUNT } from '@detect-expert/contracts';
import type {
  Ack,
  BridgeStopReason,
  CoverageFlag,
  SensorBatchMessage,
  SensorHelloMessage,
  SensorStatusMessage,
  SensorResetMessage,
  BridgeResetAck,
} from '@detect-expert/contracts';
import { CHANNEL, PROTOCOL_VERSION, UNBOUND_SENSOR_BOOT_ID, validateBridgeControl, validateBridgeMessage } from '@detect-expert/contracts';
import { Deliverer } from './deliver';
import type { DeliveryOptions, DeliveryStats } from './deliver';
import type { CollectorEnv } from './env';
import { Handshake } from './handshake';
import type { HandshakeOptions } from './handshake';
import { ingestWindowMessage } from './listen';
import { AggregateRing } from './ring';

export interface CollectorOptions extends DeliveryOptions, HandshakeOptions {
  maxRecords: number;
}

export const DEFAULT_COLLECTOR_OPTIONS: Readonly<CollectorOptions> = Object.freeze({
  helloRetries: 10,
  helloIntervalMs: 100,
  maxKnownBoots: 4,
  flushMinMs: BUDGETS.flushMinMs,
  maxBatchEvents: BUDGETS.maxBatchEvents,
  maxBatchesPerSecond: BUDGETS.maxBatchesPerSecondPerDocument,
  ackTimeoutMs: 1000,
  retransmitBaseMs: BUDGETS.flushMaxMs,
  retransmitMaxMs: 8000,
  maxRetransmits: 10,
  maxConsecutiveAbandons: 3,
  maxRecords: BUDGETS.maxBridgeRecordsPerDocument,
});

export type CollectorState = 'active' | 'paused' | 'stopped';

/** Saturating local counters; numbers only, never payload. */
export interface CollectorStats extends DeliveryStats {
  droppedMalformed: number;
  droppedUnknownBoot: number;
  droppedReplayed: number;
  droppedWhilePaused: number;
  observationsAccepted: number;
  /** Sum of sensor-status.droppedSinceLast. */
  sensorDropped: number;
  ringEvictedDirty: number;
  ringEvictedClean: number;
  protocolMismatches: number;
  bfcacheRestores: number;
}

export interface CollectorSnapshot {
  state: CollectorState;
  bridgeSessionId: string;
  sensorBootIds: string[];
  lastBatchSeq: number;
  inFlightBatchSeq: number | null;
  transportSuspended: boolean;
  ringSize: number;
  ringDirty: number;
  pendingCoverage: CoverageFlag[];
  stats: CollectorStats;
}

export interface Collector {
  /** Stops delivery and tells the sensor(s) to stop. */
  stop(reason: BridgeStopReason): void;
  /** Local pause/resume (the SW also drives this through Ack.paused). */
  pause(): void;
  resume(): void;
  snapshot(): CollectorSnapshot;
}

function sat(n: number): number {
  return n >= MAX_COUNT ? MAX_COUNT : n + 1;
}

function satAdd(n: number, delta: number): number {
  const sum = n + delta;
  return sum > MAX_COUNT ? MAX_COUNT : sum;
}

export function startCollector(env: CollectorEnv, overrides: Partial<CollectorOptions> = {}): Collector {
  const options: CollectorOptions = { ...DEFAULT_COLLECTOR_OPTIONS, ...overrides };
  let bridgeSessionId = 'bridge-' + env.randomHex(12);
  const ring = new AggregateRing(options.maxRecords);
  const pendingCoverage = new Set<CoverageFlag>();
  /** Flags already committed to the SW in this bridge session (the report keeps their union; no resend needed). */
  const deliveredCoverage = new Set<CoverageFlag>();
  let state: CollectorState = 'active';
  let bfcacheRestored = false;
  let resetBoots: Set<string> | null = null;
  let lastReset: BridgeResetAck | null = null;
  let resetting: {
    resetId: string;
    targets: Set<string>;
    replies: Map<string, SensorResetMessage>;
    promise: Promise<BridgeResetAck>;
    resolve(value: BridgeResetAck): void;
    reject(reason: Error): void;
    timer: unknown;
  } | null = null;
  const stats: CollectorStats = {
    batchesSent: 0,
    batchesRetransmitted: 0,
    batchesCommitted: 0,
    batchesAbandoned: 0,
    acksInvalid: 0,
    acksNotCommitted: 0,
    acksTimedOut: 0,
    transportFailures: 0,
    droppedMalformed: 0,
    droppedUnknownBoot: 0,
    droppedReplayed: 0,
    droppedWhilePaused: 0,
    observationsAccepted: 0,
    sensorDropped: 0,
    ringEvictedDirty: 0,
    ringEvictedClean: 0,
    protocolMismatches: 0,
    bfcacheRestores: 0,
  };

  const handshake = new Handshake(env, bridgeSessionId, () => state === 'paused', options, () => {
    addFlags(['hook-failed']);
    deliverer.notifyData();
  });

  const deliverer = new Deliverer(env, ring, bridgeSessionId, options, {
    coverageDelta: () => [...pendingCoverage],
    committed: (flags) => {
      for (const f of flags) {
        pendingCoverage.delete(f);
        deliveredCoverage.add(f);
      }
    },
    hasUndeliveredCoverage: () => {
      for (const f of pendingCoverage) if (!deliveredCoverage.has(f)) return true;
      return false;
    },
    sensorBootId: () => handshake.bootIds.at(-1) ?? UNBOUND_SENSOR_BOOT_ID,
    onAck: (ack: Ack, currentControl: boolean) => {
      if (ack.stopReason === 'revoked') { stop('revoked'); return; }
      if (!ack.protocolOk) {
        stats.protocolMismatches = sat(stats.protocolMismatches);
        stop('protocol-mismatch');
        return;
      }
      if (currentControl) setPaused(ack.paused);
    },
    onFatal: () => stop('revoked'),
    onSuspended: () => addFlags(['channel-gap', 'budget-exceeded']),
  });

  function setPaused(paused: boolean): void {
    if (state === 'stopped' || (state === 'paused') === paused) return;
    state = paused ? 'paused' : 'active';
    if (paused) pendingCoverage.add('paused');
    deliverer.setPaused(paused);
    handshake.sendPause(paused);
  }

  function stop(reason: BridgeStopReason): void {
    if (state === 'stopped') return;
    state = 'stopped';
    if (resetting !== null) { env.clearTimer(resetting.timer); resetting.reject(new Error('reset-stopped')); resetting = null; }
    deliverer.stop();
    handshake.sendStop(reason, null);
    handshake.stop();
  }

  function addFlags(flags: readonly CoverageFlag[]): void {
    for (const f of flags) pendingCoverage.add(f);
  }

  /**
   * A message tagged with the bridge channel that the bridge refused (malformed, unknown/evicted boot, replay).
   * Only the page can produce such traffic, so it is reported as `throttled` on the next batch: the report says
   * "messages on the sensor channel were rejected" instead of silently absorbing a flood (ADR-004 §6, REQ-009).
   */
  function rejected(counter: 'droppedMalformed' | 'droppedUnknownBoot' | 'droppedReplayed'): void {
    stats[counter] = sat(stats[counter]);
    pendingCoverage.add('throttled');
    deliverer.notifyData();
  }

  function onHello(message: SensorHelloMessage): void {
    if (resetting !== null) return;
    if (resetBoots !== null && !resetBoots.has(message.sensorBootId)) { rejected('droppedUnknownBoot'); return; }
    if (handshake.isKnown(message.sensorBootId)) {
      // A duplicate page-controlled hello cannot revoke an established route (F035, REQ-004).
      if (message.protocolVersion !== PROTOCOL_VERSION) {
        pendingCoverage.add('channel-gap');
        rejected('droppedMalformed');
      }
      return;
    }
    if (message.protocolVersion !== PROTOCOL_VERSION) {
      stats.protocolMismatches = sat(stats.protocolMismatches);
      pendingCoverage.add('protocol-mismatch');
      handshake.sendStop('protocol-mismatch', message.sensorBootId);
      deliverer.notifyData();
      return;
    }
    if (!handshake.bind(message.sensorBootId)) {
      pendingCoverage.add('channel-gap');
      rejected('droppedUnknownBoot');
      return;
    }
    addFlags(message.coverageFlags);
    if (message.startedLate) pendingCoverage.add('late-start');
    deliverer.notifyData();
  }

  function onBatch(message: SensorBatchMessage): void {
    if (resetting !== null) return;
    const boot = message.sensorBootId;
    if (!handshake.isKnown(boot)) {
      rejected('droppedUnknownBoot');
      return;
    }
    if (state === 'paused') {
      stats.droppedWhilePaused = sat(stats.droppedWhilePaused);
      return;
    }
    if (!handshake.acceptSequence(boot, message.sensorSeq)) {
      pendingCoverage.add('channel-gap');
      rejected('droppedReplayed');
      return;
    }
    const extra = bfcacheRestored ? 'bfcache-restore' : null;
    for (const obs of message.observations) {
      const outcome = ring.add(boot, obs, extra);
      if (outcome === 'evicted-dirty' || outcome === 'evicted-clean') {
        if (outcome === 'evicted-dirty') stats.ringEvictedDirty = sat(stats.ringEvictedDirty);
        else stats.ringEvictedClean = sat(stats.ringEvictedClean);
        pendingCoverage.add('bridge-ring-overflow');
        pendingCoverage.add('channel-gap');
      }
    }
    stats.observationsAccepted = satAdd(stats.observationsAccepted, message.observations.length);
    addFlags(message.coverageDelta);
    deliverer.notifyData();
  }

  function onStatus(message: SensorStatusMessage): void {
    if (resetting !== null) return;
    if (!handshake.isKnown(message.sensorBootId)) {
      rejected('droppedUnknownBoot');
      return;
    }
    addFlags(message.coverageFlags);
    // Sensor status is diagnostic, not authority to change collector pause policy (REQ-004/006).
    // Specific hook limitations retain their partial-coverage meaning; only unexplained loss is a gap.
    if (message.state === 'stopped' || (message.state === 'paused' && state !== 'paused') ||
        (message.state === 'degraded' && message.coverageFlags.length === 0)) pendingCoverage.add('channel-gap');
    if (message.droppedSinceLast > 0) {
      stats.sensorDropped = satAdd(stats.sensorDropped, message.droppedSinceLast);
      pendingCoverage.add('truncated');
    }
    if (pendingCoverage.size > 0) deliverer.notifyData();
  }

  function reset(resetId: string): Promise<BridgeResetAck> {
    if (lastReset?.resetId === resetId) return Promise.resolve(lastReset);
    if (resetting !== null) return resetting.resetId === resetId ? resetting.promise : Promise.reject(new Error('reset-busy'));
    const targets = new Set(handshake.bootIds);
    if (targets.size === 0) return Promise.reject(new Error('reset-no-sensor'));
    let resolve!: (value: BridgeResetAck) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<BridgeResetAck>((yes, no) => { resolve = yes; reject = no; });
    const pending = { resetId, targets, replies: new Map<string, SensorResetMessage>(), promise, resolve, reject, timer: null as unknown };
    resetting = pending;
    deliverer.noteControl();
    deliverer.setPaused(true);
    pending.timer = env.setTimer(() => {
      if (resetting !== pending) return;
      resetting = null;
      for (const [oldBoot, reply] of pending.replies) handshake.replace(oldBoot, reply.nextSensorBootId);
      resetBoots = new Set(handshake.bootIds);
      addFlags(['channel-gap']);
      deliverer.setPaused(state === 'paused');
      deliverer.notifyData();
      reject(new Error('reset-timeout'));
    }, 2000);
    for (const sensorBootId of targets) env.postToPage({ channel: CHANNEL, type: 'bridge-reset', sensorBootId, resetId });
    return promise;
  }

  function onReset(message: SensorResetMessage): void {
    const pending = resetting;
    if (pending === null || pending.resetId !== message.resetId || !pending.targets.has(message.sensorBootId) || pending.replies.has(message.sensorBootId)) return;
    if ([...pending.replies.values()].some((reply) => reply.nextSensorBootId === message.nextSensorBootId) || pending.targets.has(message.nextSensorBootId)) return;
    pending.replies.set(message.sensorBootId, message);
    if (pending.replies.size !== pending.targets.size) return;
    env.clearTimer(pending.timer);
    const sensorBootIds = [...pending.replies.values()].map((reply) => reply.nextSensorBootId);
    bridgeSessionId = 'bridge-' + env.randomHex(12);
    const reply: BridgeResetAck = { schemaVersion: 1, type: 'bridge-reset-ack', resetId: pending.resetId, bridgeSessionId, sensorBootIds };
    resetting = null;
    resetBoots = new Set(sensorBootIds);
    ring.clear();
    pendingCoverage.clear();
    deliveredCoverage.clear();
    bfcacheRestored = false;
    deliverer.reset(bridgeSessionId);
    handshake.reset(bridgeSessionId, sensorBootIds);
    for (const result of pending.replies.values()) addFlags(result.coverageFlags);
    deliverer.setPaused(state === 'paused');
    deliverer.notifyData();
    lastReset = reply;
    pending.resolve(reply);
  }

  env.onWindowMessage((fromSelf, data) => {
    if (state === 'stopped') return;
    try {
    // A conflicting version is page-controlled channel interference, never a policy command.
    if (fromSelf && data && typeof data === 'object' && (data as { channel?: unknown }).channel === CHANNEL &&
        (data as { type?: unknown }).type === 'bridge-hello') {
      const control = validateBridgeMessage(data);
      if (control.ok && control.value.type === 'bridge-hello' && control.value.protocolVersion !== PROTOCOL_VERSION) {
        addFlags(['channel-gap']);
        rejected('droppedMalformed');
      }
    }
    } catch { /* the strict ingress gate below counts hostile getters/proxies once */ }
    const result = ingestWindowMessage(fromSelf, data);
    if (result.kind === 'ignore') return;
    if (result.kind === 'malformed') {
      rejected('droppedMalformed');
      return;
    }
    const message = result.message;
    try {
      if (message.type === 'sensor-hello') onHello(message);
      else if (message.type === 'sensor-batch') onBatch(message);
      else if (message.type === 'sensor-status') onStatus(message);
      else onReset(message);
    } catch {
      // The bridge never throws into the page's event loop; a failed merge is a dropped message.
      rejected('droppedMalformed');
    }
  });

  env.onPageShow((persisted) => {
    if (!persisted || state === 'stopped') return;
    // BFCache restore (spec A7): later observations carry `bfcache-restore`; the current bounded snapshot is
    // resent so the SW can rebuild the document even if it evicted it while cached (merge = max, idempotent).
    bfcacheRestored = true;
    stats.bfcacheRestores = sat(stats.bfcacheRestores);
    // The SW may have evicted the document while it was cached: the snapshot resend carries every flag again.
    for (const f of deliveredCoverage) pendingCoverage.add(f);
    deliveredCoverage.clear();
    ring.markAllDirty();
    deliverer.recover();
    deliverer.notifyData();
  });

  env.onPageHide(() => {
    deliverer.forceFlush();
  });

  // SW -> bridge control (ADR-004 changelog, F030): honoured only from the extension's own service worker
  // (verified in the env); a page cannot reach this channel. Resume must work while paused, because a paused
  // bridge never sends and therefore never sees an Ack carrying paused:false.
  env.onControlMessage((fromExtension, data) => {
    if (!fromExtension || state === 'stopped') return;
    const result = validateBridgeControl(data);
    if (!result.ok) return;
    if (result.value.command === 'reset') return reset(result.value.resetId);
    deliverer.noteControl();
    if (result.value.command === 'stop') {
      stop('revoked');
      return;
    }
    if (result.value.command === 'pause') {
      setPaused(true);
      return;
    }
    setPaused(false);
    deliverer.recover();
  });

  handshake.start();

  return {
    stop,
    pause: () => setPaused(true),
    resume: () => {
      setPaused(false);
      deliverer.recover();
    },
    snapshot: (): CollectorSnapshot => ({
      state,
      bridgeSessionId,
      sensorBootIds: handshake.bootIds,
      lastBatchSeq: deliverer.lastBatchSeq,
      inFlightBatchSeq: deliverer.inFlightBatchSeq,
      transportSuspended: deliverer.isSuspended,
      ringSize: ring.size,
      ringDirty: ring.dirty,
      pendingCoverage: [...pendingCoverage],
      stats: { ...stats, ...deliverer.stats },
    }),
  };
}
