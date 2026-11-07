// ADR-017. Separate ephemeral image channel; the ordinary collector, ring and ACK never see pixels.
import { VISUAL_CHANNEL, VISUAL_LIMITS, VISUAL_CACHE_IDLE_MS, mergeVisualImage, retainVisualImage, visualImageKey, validateBridgeVisualControl, validateVisualSensorMessage, validateVisualFrameAck, validateVisualCacheRequest } from '@detect-expert/contracts';
import type { VisualConfigMessage, VisualPageRequest, VisualImage, VisualCacheState } from '@detect-expert/contracts';
import { createBrowserCollectorEnv, isOwnServiceWorker } from './env';
import type { CollectorEnv } from './env';

export interface VisualBridgeEnv extends Omit<CollectorEnv, 'postToPage' | 'sendToBackground' | 'randomHex'> {
  postToPage(message: VisualConfigMessage): void;
  sendToBackground(message: VisualPageRequest): Promise<unknown>;
  /** Separate synchronous reply, available only to the trusted extension channel. Never MAIN. */
  onCacheRequest(listener: (fromExtension: boolean, message: unknown) => VisualCacheState | null): void;
}

/** SW authorization is necessary even if the page forges a visual-config in MAIN. */
export function startVisualBridge(env: VisualBridgeEnv): void {
  let expiresAt = 0;
  let configVersion = 0;
  const pending = new Set<string>();
  const pendingImages = new Map<string, VisualImage>();
  const queued = new Map<string, VisualImage>();
  let receivedFrames = 0;
  let receivedChars = 0;
  let truncated = false;
  let limitPending = false;
  let limitSent = false;
  let terminal = false;
  const boots = new Map<string, number>();
  const retained = new Map<string, VisualImage>();
  let cacheToken: string | null = null;
  let cacheExpiresAt = 0;
  let cacheTimer: unknown = null;
  let cacheVersion = 0;
  let sendSequence = 0;
  let ownerSequence = 0;
  const clearCache = (): void => {
    cacheVersion++;
    queued.clear();
    retained.clear(); cacheToken = null; cacheExpiresAt = 0;
    truncated = false; limitPending = false;
    if (cacheTimer !== null) { env.clearTimer(cacheTimer); cacheTimer = null; }
  };
  const touchCache = (remainingMs = VISUAL_CACHE_IDLE_MS): void => {
    if (cacheTimer !== null) env.clearTimer(cacheTimer);
    cacheExpiresAt = env.now() + remainingMs;
    cacheTimer = env.setTimer(clearCache, remainingMs);
  };
  const field = (value: unknown, key: string): unknown => typeof value === 'object' && value !== null ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
  const sendConfig = (boot: string): void => {
    const remainingMs = Math.min(VISUAL_LIMITS.leaseMs, Math.max(0, Math.floor(expiresAt - env.now())));
    env.postToPage({ channel: VISUAL_CHANNEL, type: 'visual-config', sensorBootId: boot, enabled: remainingMs > 0 && !terminal, remainingMs });
  };
  const applyConfig = (raw: unknown): void => {
    const parsed = validateBridgeVisualControl(raw);
    if (!parsed.ok || terminal) return;
    configVersion++;
    expiresAt = parsed.value.enabled ? env.now() + parsed.value.remainingMs : 0;
    if (!parsed.value.enabled || parsed.value.remainingMs === 0) clearCache();
    for (const boot of boots.keys()) sendConfig(boot);
  };
  const disable = (): void => {
    configVersion++;
    expiresAt = 0;
    queued.clear();
    for (const boot of boots.keys()) sendConfig(boot);
  };
  const ready = (): void => {
    if (terminal || !env.isContextAlive()) return;
    const version = configVersion;
    void env.sendToBackground({ schemaVersion: 1, type: 'visual-ready' }).then(response => {
      if (version === configVersion) applyConfig(response);
    }, () => { if (version === configVersion) disable(); });
  };
  const markLimited = (): void => { truncated = true; if (!limitSent) limitPending = true; };
  const drain = (): void => {
    if (terminal || !env.isContextAlive() || expiresAt === 0) return;
    if (env.now() >= expiresAt && queued.size > 0) { queued.clear(); markLimited(); }
    while (pending.size < 2 && (queued.size > 0 || limitPending)) {
      const entry = queued.entries().next().value as [string, VisualImage] | undefined;
      const key = entry?.[0] ?? 'limited', image = entry?.[1];
      if (pending.has(key)) return;
      if (entry) { queued.delete(key); pendingImages.set(key, entry[1]); }
      else { limitPending = false; limitSent = true; }
      pending.add(key);
      const version = configVersion, retentionVersion = cacheVersion, sequence = ++sendSequence;
      const request: VisualPageRequest = image ? { schemaVersion: 1, type: 'visual-frame', image } : { schemaVersion: 1, type: 'visual-limited' };
      void env.sendToBackground(request).then(response => {
        if (version !== configVersion || retentionVersion !== cacheVersion || terminal || !env.isContextAlive()) return;
        const ack = validateVisualFrameAck(response);
        if (!ack.ok) { applyConfig(response); return; }
        if (!ack.value.accepted || ack.value.cacheToken === null) { clearCache(); disable(); return; }
        if (cacheToken !== ack.value.cacheToken) {
          if (sequence < ownerSequence) return;
          retained.clear(); cacheToken = ack.value.cacheToken; ownerSequence = sequence;
        }
        if (ack.value.truncated) truncated = true;
        if (image && ack.value.retained !== false && !retainVisualImage(retained, image)) markLimited();
        touchCache(ack.value.remainingMs);
      }, () => { if (version === configVersion) { markLimited(); disable(); } }).finally(() => {
        pending.delete(key); pendingImages.delete(key); drain();
      });
    }
  };
  env.onWindowMessage((fromSelf, raw) => {
    try {
      if (!fromSelf || terminal || !env.isContextAlive() || field(raw, 'channel') !== VISUAL_CHANNEL) return;
      const type = field(raw, 'type');
      if (type !== 'visual-hello') {
        const boot = field(raw, 'sensorBootId');
        if (expiresAt === 0 || typeof boot !== 'string' || !boots.has(boot)) return;
        if (env.now() >= expiresAt && type === 'visual-image') { markLimited(); drain(); return; }
        if (receivedFrames >= VISUAL_LIMITS.maxFrames) { markLimited(); drain(); return; }
        receivedFrames++;
      }
      const parsed = validateVisualSensorMessage(raw);
      if (!parsed.ok) return;
      const message = parsed.value;
      if (message.type === 'visual-hello') {
        const last = boots.get(message.sensorBootId);
        if (last !== undefined && env.now() - last < 250) return;
        if (last === undefined && boots.size >= 4) return;
        boots.set(message.sensorBootId, env.now());
        sendConfig(message.sensorBootId);
        return;
      }
      if (!boots.has(message.sensorBootId)) return;
      if (message.type === 'visual-limited') { markLimited(); drain(); return; }
      if (message.image.canvas && !message.image.canvas.id.startsWith(message.sensorBootId + ':')) return;
      const key = visualImageKey(message.image);
      const previous = queued.get(key) ?? pendingImages.get(key) ?? retained.get(key);
      const merged = mergeVisualImage(previous, message.image);
      if (merged === previous) return;
      receivedChars += message.image.data.length;
      if (receivedChars > VISUAL_LIMITS.maxTotalBase64Chars * 2) { markLimited(); drain(); return; }
      const owned = new Map<string, VisualImage>([...retained, ...pendingImages, ...queued]);
      owned.set(key, merged);
      let memory = 0;
      for (const image of owned.values()) memory += image.data.length;
      const identities = new Set([...retained.keys(), ...queued.keys(), ...pendingImages.keys(), key]);
      if (memory > VISUAL_LIMITS.maxTotalBase64Chars || identities.size > VISUAL_LIMITS.maxImages) { markLimited(); drain(); return; }
      queued.set(key, merged);
      drain();
    } catch { /* Synthetic/proxy page data is untrusted and never breaks the normal collector. */ }
  });
  env.onControlMessage((fromExtension, raw) => {
    if (!fromExtension) return;
    if (field(raw, 'type') === 'bridge-control' && (field(raw, 'command') === 'pause' || field(raw, 'command') === 'stop')) {
      clearCache();
      disable();
      if (field(raw, 'command') === 'stop') terminal = true;
      return;
    }
    applyConfig(raw);
  });
  env.onCacheRequest((fromExtension, raw) => {
    if (!fromExtension || terminal || !env.isContextAlive()) return null;
    const request = validateVisualCacheRequest(raw);
    if (!request.ok) return null;
    if (cacheToken !== null && env.now() >= cacheExpiresAt) clearCache();
    if (cacheToken !== request.value.cacheToken) return null;
    touchCache();
    if (request.value.type === 'visual-cache-touch') return null;
    return { schemaVersion: 1, type: 'visual-cache-state', cacheToken, images: [...retained.values()].map(image => ({ ...image })),
      ...(truncated ? { truncated: true } : {}) };
  });
  env.onPageHide(() => { clearCache(); disable(); });
  env.onPageShow(persisted => { if (persisted) ready(); });
  ready();
}

export function startBrowserVisualBridge(): void {
  const env = createBrowserCollectorEnv();
  startVisualBridge({ ...env,
    onCacheRequest(listener) {
      try {
        chrome.runtime.onMessage.addListener((message: unknown, sender: chrome.runtime.MessageSender, sendResponse) => {
          const response = listener(isOwnServiceWorker(sender), message);
          if (response !== null) sendResponse(response);
          return false;
        });
      } catch { /* Invalidated extension context cannot return pixels. */ }
    },
    postToPage(message) { try { window.postMessage(message, '*'); } catch { /* Context closed. */ } },
    sendToBackground(message) {
      try { return chrome.runtime.sendMessage(message); }
      catch (error) { return Promise.reject(error); }
    },
  });
}
