// ADR-020: bounded metadata transport. The authorization token never enters MAIN.
import { CHANNEL, PROTOCOL_VERSION, RTC_DETAILS_CHANNEL, RTC_LIMITS, validateRtcControl, validateRtcSensorMessage, validateSensorMessage } from '@detect-expert/contracts';
import type { RtcSnapshot } from '@detect-expert/contracts';
import { createBrowserCollectorEnv } from './env';
import type { CollectorEnv } from './env';

export interface RtcBridgeEnv extends Pick<CollectorEnv, 'onWindowMessage' | 'onControlMessage' | 'onPageHide' | 'setTimer' | 'clearTimer' | 'now' | 'isContextAlive'> {
  postToPage(message: unknown): void;
  sendToBackground(message: unknown): Promise<unknown>;
}
const RESPONSE_DEADLINE_MS = 2000;
const MAX_UNSETTLED_REQUESTS = 4;

export function startRtcBridge(env: RtcBridgeEnv): void {
  let boot: string | null = null;
  let rtcSeen = false;
  let token: string | null = null;
  let pending: RtcSnapshot | null = null;
  let generation = 0;
  let ready = false;
  let sending = false;
  let timer: unknown = null;
  let stopped = false;
  let paused = false;
  let attempts = 0;
  let lastInput = -Infinity;
  let lastSent = -Infinity;
  let lastHandshake = -Infinity;
  // Deadlines cannot cancel Chrome's underlying Promise. Keep this cap across clear/pause epochs.
  let unsettledRequests = 0;
  let capacityBlocked = false;
  const post = (type: 'rtc-request' | 'rtc-reset'): void => {
    if (boot) env.postToPage({ channel: RTC_DETAILS_CHANNEL, type, sensorBootId: boot, epoch: generation });
  };
  const schedule = (ms: number = RTC_LIMITS.flushMs): void => {
    if (rtcSeen && !stopped && !paused && timer === null) timer = env.setTimer(() => { timer = null; void drain(); }, ms);
  };
  const hasCapacity = (): boolean => {
    if (unsettledRequests < MAX_UNSETTLED_REQUESTS) return true;
    capacityBlocked = true;
    return false;
  };
  const request = (message: unknown): Promise<unknown> => {
    unsettledRequests++;
    return new Promise((resolve, reject) => {
      let waiting = true;
      let completed = false;
      const deadline = env.setTimer(() => {
        waiting = false;
        reject(new Error('RTC response deadline exceeded'));
      }, RESPONSE_DEADLINE_MS);
      const complete = (ok: boolean, value: unknown): void => {
        if (completed) return;
        completed = true;
        unsettledRequests--;
        const late = !waiting;
        if (waiting) {
          waiting = false;
          env.clearTimer(deadline);
          if (ok) resolve(value); else reject(value);
        }
        // Only a real extension response can free a slot. Its late payload is discarded;
        // any recovery uses the current epoch, scope and token through the normal drain.
        if (capacityBlocked || (late && attempts >= 4)) {
          capacityBlocked = false;
          attempts = 0;
          schedule();
        }
      };
      try { void env.sendToBackground(message).then(value => complete(true, value), error => complete(false, error)); }
      catch (error) { complete(false, error); }
    });
  };
  const reset = (): void => {
    generation++; pending = null; token = null; ready = false; sending = false; attempts = 0; lastHandshake = -Infinity;
    if (timer !== null) env.clearTimer(timer);
    timer = null;
    post('rtc-reset');
  };
  const handshake = async (): Promise<void> => {
    if (!rtcSeen || ready || stopped || paused || attempts >= 4 || !boot || !env.isContextAlive()) return;
    if (!hasCapacity()) return;
    const delay = RTC_LIMITS.flushMs - (env.now() - lastHandshake);
    if (delay > 0) { schedule(delay); return; }
    ready = true; lastHandshake = env.now();
    const version = generation;
    try {
      const raw = await request({ schemaVersion: 1, type: 'rtc-ready' });
      if (version !== generation || stopped) return;
      const response = validateRtcControl(raw);
      if (!response.ok) throw new Error('invalid rtc control');
      if (!response.value.enabled) { reset(); paused = true; return; }
      if (response.value.reset) { reset(); schedule(); return; }
      token = response.value.enabled ? response.value.token : null;
      if (token) { attempts = 0; post('rtc-request'); if (pending) schedule(); }
    } catch { if (version === generation && attempts++ < 3) schedule(); }
    finally { if (version === generation) ready = false; }
  };
  const drain = async (): Promise<void> => {
    if (stopped || paused || sending || !env.isContextAlive()) return;
    if (token === null) { await handshake(); return; }
    if (!pending) return;
    if (!hasCapacity()) return;
    const elapsed = env.now() - lastSent;
    if (elapsed < RTC_LIMITS.flushMs) { schedule(RTC_LIMITS.flushMs - elapsed); return; }
    sending = true; lastSent = env.now();
    const snapshot = pending;
    const version = generation;
    try {
      const raw: unknown = await request({ schemaVersion: 1, type: 'rtc-snapshot', token, snapshot });
      if (version !== generation || stopped) return;
      if (!raw || typeof raw !== 'object') throw new Error('missing rtc acknowledgement');
      const response = raw as Record<string, unknown>;
      if (response['schemaVersion'] !== 1 || response['type'] !== 'rtc-ack' || typeof response['accepted'] !== 'boolean' || typeof response['reset'] !== 'boolean') throw new Error('invalid rtc acknowledgement');
      if (response['reset']) { reset(); schedule(); return; }
      if (!response['accepted']) throw new Error('rtc snapshot not committed');
      if (pending === snapshot) pending = null;
      attempts = 0;
    } catch { if (version === generation && attempts++ < 3) schedule(250 * attempts); }
    finally { if (version === generation) { sending = false; if (pending !== snapshot && pending) schedule(); } }
  };
  env.onWindowMessage((fromSelf, data) => {
    if (!fromSelf || stopped || !env.isContextAlive() || typeof data !== 'object' || data === null) return;
    const type = Object.getOwnPropertyDescriptor(data, 'type')?.value;
    const channel = Object.getOwnPropertyDescriptor(data, 'channel')?.value;
    if (channel === CHANNEL) {
      if (boot !== null || type !== 'sensor-hello') return;
      const ordinary = validateSensorMessage(data);
      if (!ordinary.ok || ordinary.value.type !== 'sensor-hello' || ordinary.value.protocolVersion !== PROTOCOL_VERSION) return;
      boot = ordinary.value.sensorBootId;
      // MAIN's RTC listener exists before ordinary hello. Route an early trusted reset
      // even while paused, before the first lazy RTC record can be created and cleared.
      if (generation > 0) post('rtc-reset');
      return;
    }
    if (paused || channel !== RTC_DETAILS_CHANNEL) return;
    // Limit validation work on hostile floods. Real snapshots are at most four per second.
    if (type === 'rtc-snapshot' && env.now() - lastInput < 100) return;
    if (type === 'rtc-snapshot') lastInput = env.now();
    const message = validateRtcSensorMessage(data);
    if (!message.ok || (boot !== null && boot !== message.value.sensorBootId)) return;
    // A trusted pause/clear can precede MAIN installation. Learn its first hello route,
    // then align MAIN with the existing reset epoch; never admit a pre-reset snapshot.
    if (boot === null && message.value.type === 'rtc-hello' && message.value.epoch !== generation) {
      boot = message.value.sensorBootId;
      rtcSeen = true;
      post('rtc-reset');
      schedule();
      return;
    }
    if (message.value.epoch !== generation) return;
    boot = message.value.sensorBootId;
    rtcSeen = true;
    if (message.value.type === 'rtc-snapshot') {
      if (!pending || message.value.snapshot.revision >= pending.revision) pending = message.value.snapshot;
      attempts = 0;
    }
    if (!token) void handshake(); else if (pending) schedule();
  });
  env.onControlMessage((fromExtension, data) => {
    if (!fromExtension || !data || typeof data !== 'object') return;
    const value = data as Record<string, unknown>;
    if (value['schemaVersion'] !== 1) return;
    if (value['type'] === 'rtc-reset') { reset(); if (!stopped) schedule(); }
    if (value['type'] === 'bridge-control') {
      const command = value['command'];
      if (command === 'pause' || command === 'stop') { reset(); paused = true; stopped = command === 'stop'; }
      else if (command === 'resume' && !stopped) { paused = false; schedule(); }
    }
  });
  env.onPageHide(() => { if (pending && token && !sending) { lastSent = -Infinity; void drain(); } });
}
export function startBrowserRtcBridge(): void {
  const env = createBrowserCollectorEnv();
  startRtcBridge({ ...env,
    postToPage(message) { try { window.postMessage(message, '*'); } catch { /* Invalidated document. */ } },
    sendToBackground(message) { try { return chrome.runtime.sendMessage(message); } catch (error) { return Promise.reject(error); } },
  });
}
