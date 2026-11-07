// MAIN/ISOLATED handshake (ADR-004 §9, E04-02 case 8). Both worlds start independently: the bridge announces
// itself with an unbound `bridge-hello` (sensorBootId = UNBOUND_SENSOR_BOOT_ID) on a short bounded retry, and
// answers every new `sensor-hello` once with a `bridge-hello` bound to that boot. Boot ids are routing only,
// never authentication (REQ-004).

import { CHANNEL, PROTOCOL_VERSION, UNBOUND_SENSOR_BOOT_ID } from '@detect-expert/contracts';
import type { BridgeStopReason } from '@detect-expert/contracts';
import type { CollectorEnv, TimerHandle } from './env';

/** Re-exported for callers that only know the collector (single source: @detect-expert/contracts). */
export { UNBOUND_SENSOR_BOOT_ID };

export interface HandshakeOptions {
  /** Total unbound bridge-hello posts (initial + retries) while no sensor has answered. */
  helloRetries: number;
  helloIntervalMs: number;
  /** Bounded set of sensor boots accepted as senders (re-injection races). */
  maxKnownBoots: number;
}

export class Handshake {
  // Replay state shares the bounded boot lifetime (REQ-011, F032).
  private readonly boots = new Map<string, { lastSeq: number }>();
  private timer: TimerHandle | null = null;
  private tries = 0;
  private stopped = false;

  constructor(
    private readonly env: CollectorEnv,
    private bridgeSessionId: string,
    private readonly isPaused: () => boolean,
    private readonly options: HandshakeOptions,
    private readonly onMissing: () => void = () => undefined,
  ) {}

  /** ADR-073: adopt the fresh epoch and rebind only its new boots (re-handshakes under the new session). */
  reset(bridgeSessionId: string, boots: readonly string[]): void {
    this.clearTimer();
    this.bridgeSessionId = bridgeSessionId;
    this.boots.clear();
    for (const boot of boots) this.bind(boot);
  }

  /** Swap a boot that answered a reset for its rotated successor, keeping the bounded route set. */
  replace(oldBoot: string, nextBoot: string): void {
    this.boots.delete(oldBoot);
    this.bind(nextBoot);
  }

  start(): void {
    this.tries = 1;
    this.sendHello(UNBOUND_SENSOR_BOOT_ID);
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.stopped || this.boots.size > 0) return;
    if (this.tries >= this.options.helloRetries) { this.onMissing(); return; }
    this.timer = this.env.setTimer(() => {
      this.timer = null;
      if (this.stopped || this.boots.size > 0) return;
      this.tries++;
      this.sendHello(UNBOUND_SENSOR_BOOT_ID);
      this.scheduleRetry();
    }, this.options.helloIntervalMs);
  }

  /** First accepted routes survive churn even before their first data batch (F031; not authentication). */
  bind(sensorBootId: string): boolean {
    if (this.stopped || this.boots.has(sensorBootId)) return false;
    if (this.boots.size >= this.options.maxKnownBoots) return false;
    this.boots.set(sensorBootId, { lastSeq: 0 });
    this.clearTimer();
    this.sendHello(sensorBootId);
    return true;
  }

  /** Forgets a boot (e.g. after a bridge-stop for protocol mismatch). */
  unbind(sensorBootId: string): void {
    this.boots.delete(sensorBootId);
  }

  isKnown(sensorBootId: string): boolean {
    return this.boots.has(sensorBootId);
  }

  /** Routing heuristic, never authentication: a page cannot advance the watermark arbitrarily (F004). */
  acceptSequence(sensorBootId: string, seq: number): boolean {
    const record = this.boots.get(sensorBootId);
    if (record === undefined || seq <= record.lastSeq || seq - record.lastSeq > 64) return false;
    record.lastSeq = seq;
    return true;
  }

  get bootIds(): string[] {
    return [...this.boots.keys()];
  }

  sendHello(sensorBootId: string): void {
    this.env.postToPage({
      channel: CHANNEL,
      sensorBootId,
      type: 'bridge-hello',
      protocolVersion: PROTOCOL_VERSION,
      bridgeSessionId: this.bridgeSessionId,
      paused: this.isPaused(),
    });
  }

  sendPause(paused: boolean): void {
    for (const sensorBootId of this.boots.keys()) {
      this.env.postToPage({ channel: CHANNEL, sensorBootId, type: paused ? 'bridge-pause' : 'bridge-resume' });
    }
  }

  /** bridge-stop to one boot, or to every known boot when `sensorBootId` is null. */
  sendStop(reason: BridgeStopReason, sensorBootId: string | null): void {
    const targets = sensorBootId === null ? this.boots.keys() : [sensorBootId];
    for (const id of targets) this.env.postToPage({ channel: CHANNEL, sensorBootId: id, type: 'bridge-stop', reason });
  }

  stop(): void {
    this.stopped = true;
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.env.clearTimer(this.timer);
      this.timer = null;
    }
  }
}
