// @detect-expert/collector — ISOLATED-world bridge (E04-02 page side, spec Part II A5-A7, ADR-004).
// Ownership: spec Part VI I2. Depends on @detect-expert/contracts only; touches window/chrome.* in env.ts only.
//
// Protocol notes for the sensor owner (packages/sensors):
// - The first bridge-hello is a broadcast with sensorBootId = UNBOUND_SENSOR_BOOT_ID ('unbound'); a sensor that
//   sees it re-sends sensor-hello, and the bridge answers once with a bridge-hello bound to that sensorBootId.
// - sensor-batch observations carry the sensor's CUMULATIVE total per (techniqueId, phase, signalCodes); the
//   bridge merges by max (never sums) and the SW merges by max again (ADR-004 §7). sensorSeq must strictly
//   increase per boot (lower/equal = replay, dropped).
// - Rejected channel-tagged messages (malformed, unknown boot, replay) are counted and surface on the wire as the
//   `throttled` coverage flag (ADR-004 §6 / acceptance "flood 10^5 -> throttled").

export { startCollector, DEFAULT_COLLECTOR_OPTIONS } from './collector';
export type { Collector, CollectorOptions, CollectorSnapshot, CollectorState, CollectorStats } from './collector';
export { createBrowserCollectorEnv } from './env';
export type { CollectorEnv, TimerHandle } from './env';
export { ingestWindowMessage } from './listen';
export type { IngestResult } from './listen';
export { AggregateRing } from './ring';
export type { AddOutcome, AggregateRecord, BatchEntry } from './ring';
export { RateLimiter } from './rate-limit';
export { Handshake, UNBOUND_SENSOR_BOOT_ID } from './handshake';
export type { HandshakeOptions } from './handshake';
export { Deliverer, readAck, isFatalTransportError } from './deliver';
export type { DeliveryHooks, DeliveryOptions, DeliveryStats } from './deliver';
