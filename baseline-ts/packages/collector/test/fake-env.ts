// Test-only fake of the collector environment: a fake window (message + lifecycle events), a fake
// chrome.runtime (configurable Ack policy) and deterministic ids. Timers/now come from the globals so that
// vitest fake timers drive them.

import { CHANNEL, PROTOCOL_VERSION } from '@detect-expert/contracts';
import type { BridgeMessage, PageBatch, PageObservation } from '@detect-expert/contracts';
import type { CollectorEnv, TimerHandle } from '../src/env';

export interface SentBatch {
  batch: PageBatch;
  at: number;
}

export function ackFor(batch: PageBatch, overrides: Partial<Record<'paused' | 'protocolOk', boolean>> = {}): unknown {
  return {
    schemaVersion: 1,
    type: 'ack',
    lastCommittedBatchSeq: batch.batchSeq,
    paused: overrides.paused ?? false,
    protocolOk: overrides.protocolOk ?? true,
  };
}

export class FakeEnv implements CollectorEnv {
  readonly posted: BridgeMessage[] = [];
  readonly sent: SentBatch[] = [];
  alive = true;
  /** Ack policy: return a value (resolved), a Promise, or throw (rejected). */
  respond: (batch: PageBatch) => unknown = (batch) => ackFor(batch);
  private readonly messageListeners: ((fromSelf: boolean, data: unknown) => void)[] = [];
  private readonly showListeners: ((persisted: boolean) => void)[] = [];
  private readonly hideListeners: ((persisted: boolean) => void)[] = [];
  private readonly controlListeners: ((fromExtension: boolean, data: unknown) => void)[] = [];
  private seed = 0;

  onWindowMessage(listener: (fromSelf: boolean, data: unknown) => void): void {
    this.messageListeners.push(listener);
  }
  onPageShow(listener: (persisted: boolean) => void): void {
    this.showListeners.push(listener);
  }
  onPageHide(listener: (persisted: boolean) => void): void {
    this.hideListeners.push(listener);
  }
  onControlMessage(listener: (fromExtension: boolean, data: unknown) => void): void {
    this.controlListeners.push(listener);
  }
  postToPage(message: BridgeMessage): void {
    this.posted.push(message);
    // Real windows echo the bridge's own messages back to its listener.
    for (const l of this.messageListeners) l(true, message);
  }
  sendToBackground(batch: PageBatch): Promise<unknown> {
    this.sent.push({ batch: JSON.parse(JSON.stringify(batch)) as PageBatch, at: Date.now() });
    if (!this.alive) return Promise.reject(new Error('Extension context invalidated.'));
    try {
      return Promise.resolve(this.respond(batch));
    } catch (error) {
      return Promise.reject(error);
    }
  }
  isContextAlive(): boolean {
    return this.alive;
  }
  now(): number {
    return Date.now();
  }
  setTimer(fn: () => void, ms: number): TimerHandle {
    return setTimeout(fn, ms);
  }
  clearTimer(handle: TimerHandle): void {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  }
  randomHex(bytes: number): string {
    this.seed++;
    return this.seed.toString(16).padStart(bytes * 2, '0');
  }

  /** Delivers a window message; `fromSelf` mirrors event.source === window. */
  emit(data: unknown, fromSelf = true): void {
    for (const l of this.messageListeners) l(fromSelf, data);
  }
  pageshow(persisted: boolean): void {
    for (const l of this.showListeners) l(persisted);
  }
  pagehide(persisted: boolean): void {
    for (const l of this.hideListeners) l(persisted);
  }
  /** Delivers a chrome.runtime.onMessage control message; `fromExtension` mirrors the verified SW sender. */
  control(data: unknown, fromExtension = true): void {
    for (const l of this.controlListeners) l(fromExtension, data);
  }

  postedOfType(type: BridgeMessage['type']): BridgeMessage[] {
    return this.posted.filter((m) => m.type === type);
  }
}

export function obs(overrides: Partial<PageObservation> = {}): PageObservation {
  return {
    techniqueId: 'DET-007',
    count: 1,
    countQuality: 'exact',
    phase: 'returned-sync',
    signalCodes: ['api-use'],
    intervalBucket: 1,
    ...overrides,
  };
}

export function sensorHello(sensorBootId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { channel: CHANNEL, sensorBootId, type: 'sensor-hello', protocolVersion: PROTOCOL_VERSION, startedLate: false, coverageFlags: [], ...overrides };
}

export function sensorBatch(sensorBootId: string, sensorSeq: number, observations: unknown[], coverageDelta: unknown[] = []): Record<string, unknown> {
  return { channel: CHANNEL, sensorBootId, type: 'sensor-batch', sensorSeq, observations, coverageDelta };
}

export function sensorStatus(sensorBootId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { channel: CHANNEL, sensorBootId, type: 'sensor-status', state: 'active', coverageFlags: [], droppedSinceLast: 0, ...overrides };
}
