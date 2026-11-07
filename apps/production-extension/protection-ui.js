import { createApiConfigurationUi } from "./api-configuration-ui.js";
import { openManagement } from "./management-navigation.js";
import { WASM_SURFACES } from "./webassembly-apis.js";
// ADR-033: an explicit settings page keeps API controls outside the inspection view.
export const PROTECTION_MODE_TO_RULE = Object.freeze({ on: 'block', bypass: 'inherit', off: 'allow' });

export function protectionRuleMode(rules, feature) {
  const rule = rules.find(entry => entry.feature === feature);
  return rule?.state === 'block' ? 'on' : rule?.state === 'allow' ? 'off' : 'bypass';
}

export function updateProtectionRule(rules, feature, mode) {
  if (!Object.hasOwn(PROTECTION_MODE_TO_RULE, mode)) return rules;
  const next = rules.filter(entry => entry.feature !== feature), state = PROTECTION_MODE_TO_RULE[mode];
  if (state !== 'inherit') next.push({ feature, state });
  return next;
}

export const API_NAMES = Object.freeze({
  ...Object.fromEntries(WASM_SURFACES.map(({ feature, operation }) => [feature, operation])),
  'window-management': 'Window.getScreenDetails',
  'compute-pressure': 'PressureObserver.observe',
  'idle-detection': 'IdleDetector',
  'local-fonts': 'Window.queryLocalFonts',
  'canvas-readback': 'getImageData / toDataURL',
  webgl: 'Canvas.getContext', webgpu: 'GPU.requestAdapter', audio: 'AudioContext',
  webrtc: 'RTCPeerConnection', webassembly: 'WebAssembly', battery: 'Navigator.getBattery',
  'network-information': 'Navigator.connection', keyboard: 'Navigator.keyboard',
  'client-hints': 'Navigator.userAgentData', 'clipboard-read': 'Clipboard.read',
  'media-enumeration': 'MediaDevices.enumerateDevices', 'media-capture': 'getUserMedia / getDisplayMedia',
  geolocation: 'Navigator.geolocation', 'generic-sensors': 'Accelerometer / Gyroscope / Sensors',
  bluetooth: 'Bluetooth.requestDevice / getDevices / getAvailability', usb: 'USB.requestDevice / getDevices',
  serial: 'Serial.requestPort / getPorts', hid: 'HID.requestDevice / getDevices',
  midi: 'Navigator.requestMIDIAccess', gamepads: 'Navigator.getGamepads',
  'speech-voices': 'SpeechSynthesis.getVoices', 'service-worker': 'ServiceWorkerContainer.register',
  push: 'PushManager.subscribe', 'background-sync': 'SyncManager.register',
  'periodic-sync': 'PeriodicSyncManager.register', notifications: 'Notification.requestPermission',
  'storage-estimate': 'StorageManager.estimate',
  'videoframe-readback': 'VideoFrame.copyTo', 'screen-extended': 'Screen.isExtended',
  'webcodecs-capabilities': 'VideoDecoder.isConfigSupported / ImageDecoder.isTypeSupported',
  'media-capabilities': 'Navigator.mediaCapabilities', 'encrypted-media': 'Navigator.requestMediaKeySystemAccess',
  'hdcp-policy': 'MediaKeys.getStatusForPolicy', 'autoplay-policy': 'Navigator.getAutoplayPolicy',
  'webrtc-codecs': 'RTCRtpSender.getCapabilities / RTCRtpReceiver.getCapabilities',
  'device-motion': 'DeviceMotionEvent / ondevicemotion', 'hardware-concurrency': 'Navigator.hardwareConcurrency',
  'device-memory': 'Navigator.deviceMemory', 'performance-memory': 'performance.memory',
  'cpu-performance': 'Navigator.cpuPerformance', 'touch-points': 'Navigator.maxTouchPoints',
  webxr: 'XRSystem.isSessionSupported / requestSession', 'speech-recognition': 'SpeechRecognition',
  'shape-detection': 'BarcodeDetector / FaceDetector / TextDetector',
  'handwriting-recognition': 'Navigator.createHandwritingRecognizer', webnn: 'ML.createContext',
  'builtin-ai-models': 'LanguageModel / Summarizer / Writer', 'translation-ai': 'Translator / LanguageDetector',
  'screen-wake-lock': 'WakeLock.request', 'picture-in-picture': 'HTMLVideoElement.requestPictureInPicture',
  'document-picture-in-picture': 'documentPictureInPicture.requestWindow', fullscreen: 'Element.requestFullscreen',
  'pointer-lock': 'Element.requestPointerLock', 'file-system-pickers': 'showOpenFilePicker / showDirectoryPicker',
  'protocol-handlers': 'Navigator.registerProtocolHandler', 'installed-related-apps': 'Navigator.getInstalledRelatedApps',
  'media-session': 'Navigator.mediaSession', opfs: 'StorageManager.getDirectory', 'cookie-store': 'Window.cookieStore',
  'document-cookie': 'Document.cookie', 'storage-buckets': 'Navigator.storageBuckets',
  'persistent-storage': 'StorageManager.persist / persisted', 'indexeddb-enumeration': 'IDBFactory.databases',
  'cache-storage': 'Window.caches', 'legacy-quota': 'webkitTemporaryStorage / webkitRequestFileSystem',
  'cast-discovery': 'PresentationRequest.getAvailability / RemotePlayback.watchAvailability',
  'send-beacon': 'Navigator.sendBeacon', 'fetch-later': 'Window.fetchLater', websocket: 'WebSocket / WebSocketStream',
  webtransport: 'WebTransport', 'platform-authenticator': 'PublicKeyCredential.getClientCapabilities',
  'web-share': 'Navigator.share / canShare', 'credential-management': 'CredentialsContainer.get / create / store',
  'fedcm-user-info': 'IdentityProvider.getUserInfo', 'payment-probes': 'PaymentRequest.canMakePayment / hasEnrolledInstrument',
  'storage-access': 'Document.requestStorageAccess', 'private-state-tokens': 'Document.hasPrivateToken / hasRedemptionRecord',
  'background-fetch': 'BackgroundFetchManager.fetch', 'shared-worker': 'SharedWorker', 'dedicated-worker': 'Worker',
  'clipboard-write': 'Clipboard.write / writeText', 'permission-probes': 'Navigator.permissions / Notification.permission',
  'reporting-observer': 'ReportingObserver', 'feature-policy': 'Document.featurePolicy'
});

export const PROTECTION_GROUPS = Object.freeze([
  { id: 'graphics', icon: 'M3 4h18v13H3z M8 21h8 M12 17v4', features: ['canvas-readback', 'webgl', 'webgpu', 'local-fonts', 'window-management', 'videoframe-readback', 'screen-extended'] },
  { id: 'media', icon: 'M9 18V5l12-2v13 M9 7l12-2 M9 18a3 3 0 1 1-3-3 M21 16a3 3 0 1 1-3-3', features: ['audio', 'webrtc', 'media-enumeration', 'media-capture', 'speech-voices', 'webcodecs-capabilities', 'media-capabilities', 'encrypted-media', 'hdcp-policy', 'autoplay-policy', 'webrtc-codecs'] },
  { id: 'device', icon: 'M7 3h10v18H7z M10 6h4 M11 18h2', features: ['battery', 'network-information', 'client-hints', 'keyboard', 'idle-detection', 'compute-pressure', 'geolocation', 'generic-sensors', 'device-motion', 'hardware-concurrency', 'device-memory', 'performance-memory', 'cpu-performance', 'touch-points'] },
  { id: 'hardware', icon: 'M8 3v6 M16 3v6 M5 9h14v3a7 7 0 0 1-14 0z M12 19v3', features: ['bluetooth', 'usb', 'serial', 'hid', 'midi', 'gamepads', 'webxr'] },
  { id: 'background', icon: 'M4 11a8 8 0 1 1 2 6 M4 4v7h7 M12 7v5l3 2', features: ['service-worker', 'push', 'background-sync', 'periodic-sync', 'notifications', 'background-fetch', 'shared-worker', 'dedicated-worker'] },
  { id: 'browser', icon: 'M3 4h18v16H3z M3 9h18 M6 6.5h1 M9 6.5h1', features: ['clipboard-read', 'clipboard-write', 'webassembly', 'permission-probes', 'reporting-observer', 'feature-policy'] },
  { id: 'webassembly', icon: 'M8 3H4v18h4 M16 3h4v18h-4 M10 8l-3 4 3 4 M14 8l3 4-3 4', features: WASM_SURFACES.map(row => row.feature) },
  { id: 'system', icon: 'M8 9V4h12v10h-4 M4 9h12v11H4z M4 12.5h12', features: ['screen-wake-lock', 'picture-in-picture', 'document-picture-in-picture', 'fullscreen', 'pointer-lock', 'file-system-pickers', 'protocol-handlers', 'installed-related-apps', 'media-session'] },
  { id: 'ai', icon: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z', features: ['speech-recognition', 'shape-detection', 'handwriting-recognition', 'webnn', 'builtin-ai-models', 'translation-ai'] },
  { id: 'storage', icon: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3', features: ['storage-estimate', 'legacy-quota', 'persistent-storage', 'indexeddb-enumeration', 'cache-storage', 'opfs', 'storage-buckets', 'cookie-store', 'document-cookie'] },
  { id: 'network', icon: 'M21 12a9 9 0 1 1-18 0a9 9 0 0 1 18 0z M3 12h18 M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9 M12 3c-2.5 2.6-3.8 5.6-3.8 9s1.3 6.4 3.8 9', features: ['cast-discovery', 'websocket', 'webtransport', 'send-beacon', 'fetch-later'] },
  { id: 'identity', icon: 'M3 5h18v14H3z M9 12a2.5 2.5 0 1 0 0-5a2.5 2.5 0 0 0 0 5z M5.5 16.5c.6-1.8 1.9-2.7 3.5-2.7s2.9.9 3.5 2.7 M15 9h3 M15 13h3', features: ['credential-management', 'platform-authenticator', 'fedcm-user-info', 'storage-access', 'private-state-tokens', 'payment-probes', 'web-share'] }
]);

// ADR-046: view-only category filter over the groups. Tags never reach drafts, settings, presets, storage or wire data.
export const PROTECTION_FILTERS = Object.freeze(['all', 'hardware', 'os', 'network', 'browser', 'social']);
function filterTags(lists) {
  const tags = {};
  for (const tag of Object.keys(lists)) for (const feature of lists[tag]) tags[feature] = tag;
  return Object.freeze(tags);
}
// Exactly one tag per feature.
export const PROTECTION_FEATURE_FILTER = filterTags({
  hardware: ['window-management', 'compute-pressure', 'canvas-readback', 'webgl', 'webgpu', 'audio', 'battery', 'media-enumeration', 'media-capture', 'generic-sensors',
    'bluetooth', 'usb', 'serial', 'hid', 'midi', 'gamepads', 'videoframe-readback', 'screen-extended', 'webcodecs-capabilities', 'media-capabilities',
    'encrypted-media', 'hdcp-policy', 'webrtc-codecs', 'device-motion', 'hardware-concurrency', 'device-memory', 'performance-memory', 'cpu-performance', 'touch-points', 'webxr',
    'speech-recognition', 'webnn'],
  os: ['idle-detection', 'local-fonts', 'keyboard', 'clipboard-read', 'geolocation', 'speech-voices', 'notifications', 'screen-wake-lock', 'shape-detection', 'picture-in-picture',
    'document-picture-in-picture', 'handwriting-recognition', 'platform-authenticator', 'file-system-pickers', 'installed-related-apps', 'media-session', 'clipboard-write'],
  network: ['webrtc', 'network-information', 'push', 'background-sync', 'periodic-sync', 'cast-discovery', 'background-fetch', 'send-beacon', 'fetch-later', 'websocket', 'webtransport'],
  browser: ['webassembly', 'client-hints', 'service-worker', 'storage-estimate', 'fullscreen', 'pointer-lock', 'builtin-ai-models', 'translation-ai', 'opfs', 'protocol-handlers',
    'shared-worker', 'dedicated-worker', 'cookie-store', 'document-cookie', 'storage-buckets', 'persistent-storage', 'indexeddb-enumeration', 'cache-storage', 'legacy-quota', 'permission-probes',
    'reporting-observer', 'feature-policy', 'autoplay-policy', ...WASM_SURFACES.map(row => row.feature)],
  social: ['web-share', 'credential-management', 'fedcm-user-info', 'payment-probes', 'storage-access', 'private-state-tokens']
});
// REQ-014: the same channel remains reachable in the same document through another standard API.
export const PROTECTION_PARTIAL = Object.freeze(['device-motion', 'send-beacon', 'fetch-later', 'cookie-store', 'document-cookie', 'clipboard-write', 'storage-access', 'private-state-tokens']);

// Pure: keeps canonical group and row order, hides rows of other tags, drops empty groups; counts are faceted by matches.
export function protectionFilterView(groups, featureFilter, matches, category) {
  const selected = PROTECTION_FILTERS.includes(category) ? category : 'all', counts = {}, visible = [];
  for (const id of PROTECTION_FILTERS) counts[id] = 0;
  let shown = 0;
  for (const group of groups) {
    const features = [];
    for (const feature of group.features) {
      if (!matches(feature)) continue;
      const tag = Object.hasOwn(featureFilter, feature) ? featureFilter[feature] : null;
      counts.all++;
      if (tag !== 'all' && PROTECTION_FILTERS.includes(tag)) counts[tag]++;
      if (selected === 'all' || tag === selected) features.push(feature);
    }
    if (features.length) { visible.push({ id: group.id, icon: group.icon, features }); shown += features.length; }
  }
  return { category: selected, groups: visible, counts, shown };
}

// Shared roving step for radio groups; RTL swaps the horizontal arrows.
export function rovingIndex(key, index, length, rtl = false) {
  if (!Number.isInteger(length) || length < 1) return null;
  const current = Number.isInteger(index) && index >= 0 && index < length ? index : 0;
  if (key === (rtl ? 'ArrowLeft' : 'ArrowRight') || key === 'ArrowDown') return (current + 1) % length;
  if (key === (rtl ? 'ArrowRight' : 'ArrowLeft') || key === 'ArrowUp') return (current - 1 + length) % length;
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  return null;
}

export function createProtectionUi({ h, useState, useEffect, useRef, useLocale, translate, browserApi = globalThis.chrome,
  PROTECTION_FEATURES, MAX_PROTECTION_SITES, readProtectionSettings, readProtectionObservations, isProtectionHost, effectiveProtection, apiConfigurationEnabled = false }) {
  const text = (key, values = []) => translate(key, values);
  const icon = (path, className) => h('span', { class: className, 'aria-hidden': 'true', children: h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.65, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', children: h('path', { d: path }) }) });
  // Event callbacks use only native tab/frame IDs; document reads remain on the adapter.
  const nativeEvents = globalThis.browser && globalThis.browser.runtime?.id === browserApi.runtime?.id ? globalThis.browser : browserApi;
  const validTab = value => value === null || Number.isSafeInteger(value) && value >= 0 && value <= 2147483647;
  const ownRecord = (value, fields) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Reflect.ownKeys(value).length !== fields.length) return null;
    const record = {};
    for (const key of fields) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
      record[key] = descriptor.value;
    }
    return record;
  };
  function readState(raw, tabId) {
    try {
      const value = ownRecord(raw, ['schemaVersion', 'type', 'settings', 'registration', 'cleanupIncomplete', 'tabId', 'host', 'documentId', 'configured', 'observations', 'liveRead', 'integrity']);
      if (!value || value.schemaVersion !== 1 || value.type !== 'protection-state' || !validTab(value.tabId) || value.tabId !== tabId || !['ready', 'inactive', 'error'].includes(value.registration) || typeof value.cleanupIncomplete !== 'boolean' || !['received', 'unavailable'].includes(value.liveRead) || value.integrity !== 'page-controlled') return null;
      const settings = readProtectionSettings(value.settings), observations = readProtectionObservations(value.observations);
      if (!settings || !observations || value.host !== null && !isProtectionHost(value.host) || value.documentId !== null && (typeof value.documentId !== 'string' || !/^[A-Za-z0-9_:.-]{1,160}$/.test(value.documentId)) || (value.host === null) !== (value.documentId === null)) return null;
      if (!Array.isArray(value.configured) || value.configured.length > PROTECTION_FEATURES.length || Reflect.ownKeys(value.configured).length !== value.configured.length + 1) return null;
      const configured = [], seen = new Set();
      for (let index = 0; index < value.configured.length; index++) {
        const feature = Object.getOwnPropertyDescriptor(value.configured, index)?.value;
        if (!PROTECTION_FEATURES.includes(feature) || seen.has(feature)) return null;
        seen.add(feature); configured.push(feature);
      }
      return { ...value, settings, observations, configured };
    } catch { return null; }
  }

  function useProtection(tabId, documentKey) {
    const [view, setView] = useState({ state: null, busy: false, error: false, reason: 'read' });
    const mounted = useRef(false), generation = useRef(0), pending = useRef(null), latest = useRef(null), state = useRef(null), refreshQueued = useRef(false), queuedReason = useRef('read');
    latest.current = { tabId, documentKey };
    const current = job => mounted.current && generation.current === job.generation && latest.current.tabId === job.tabId && latest.current.documentKey === job.documentKey;
    const release = job => {
      if (!job.finished || job.physical !== 0 || pending.current !== job) return;
      pending.current = null;
      if (!mounted.current) return;
      setView(previous => ({ ...previous, busy: false }));
      if (refreshQueued.current) { const reason = queuedReason.current; refreshQueued.current = false; void refresh(reason); }
    };
    const queueRefresh = reason => {
      if (!refreshQueued.current || reason === 'read') queuedReason.current = reason;
      refreshQueued.current = true;
    };
    async function send(job, request) {
      let timer;
      job.physical++;
      const native = Promise.resolve().then(() => browserApi.runtime.sendMessage(request)).catch(() => null).finally(() => { job.physical--; release(job); });
      try {
        const raw = await Promise.race([native, new Promise(resolve => { timer = setTimeout(() => resolve(null), 5000); })]);
        return current(job) ? readState(raw, job.tabId) : null;
      } finally { if (timer !== undefined) clearTimeout(timer); }
    }
    const adopt = (job, response, reason) => {
      if (!current(job) || !response) return false;
      state.current = response;
      setView({ state: response, busy: true, error: response.registration === 'error' || response.cleanupIncomplete, reason });
      return true;
    };
    async function run(action) {
      if (!mounted.current || pending.current || !validTab(latest.current.tabId)) return null;
      const job = { tabId: latest.current.tabId, documentKey: latest.current.documentKey, generation: generation.current, physical: 0, finished: false };
      pending.current = job;
      setView(previous => ({ ...previous, busy: true, error: false }));
      try {
        const result = await action(job);
        if (!result && current(job)) setView(previous => ({ ...previous, error: true }));
        return result;
      } catch {
        if (current(job)) setView(previous => ({ ...previous, error: true }));
        return null;
      } finally { job.finished = true; release(job); }
    }
    async function refresh(reason = 'read') {
      if (pending.current) { queueRefresh(reason); return null; }
      return run(async job => {
        const response = await send(job, { schemaVersion: 1, type: 'ui-protection-get', tabId: job.tabId });
        // Own storage notifications may arrive before the mutation's UI effect renders.
        // A confirming read must preserve that mutation's draft transition.
        const previous = state.current;
        if (reason === 'external' && response && previous && response.host === previous.host && response.documentId === previous.documentId && response.registration === previous.registration && response.cleanupIncomplete === previous.cleanupIncomplete && JSON.stringify(response.settings) === JSON.stringify(previous.settings)) {
          setView(view => ({ ...view, error: response.registration === 'error' || response.cleanupIncomplete }));
          return previous;
        }
        return adopt(job, response, reason) ? response : null;
      });
    }
    async function toggle() {
      const previous = state.current;
      if (!previous) return null;
      const enabled = !previous.settings.enabled;
      return run(async job => {
        const fresh = await send(job, { schemaVersion: 1, type: 'ui-protection-get', tabId: job.tabId });
        if (!fresh) return null;
        if (fresh.settings.enabled === enabled) return adopt(job, fresh, 'read') ? fresh : null;
        const settings = readProtectionSettings({ ...fresh.settings, enabled });
        if (!settings) return null;
        const response = await send(job, { schemaVersion: 1, type: 'ui-protection-set', tabId: job.tabId, settings });
        const reason = fresh.settings.revision === previous.settings.revision && fresh.host === previous.host && fresh.documentId === previous.documentId ? 'master' : 'read';
        return adopt(job, response, reason) ? response : null;
      });
    }
    async function save(input, reload = false, exemptHost = null) {
      const parsed = readProtectionSettings(input), previous = state.current;
      if (!parsed || !previous || reload && (tabId === null || previous.documentId === null)) return null;
      return run(async job => {
        const fresh = await send(job, { schemaVersion: 1, type: 'ui-protection-get', tabId: job.tabId });
        if (!fresh) return null;
        if (fresh.settings.revision !== parsed.revision || fresh.host !== previous.host || fresh.documentId !== previous.documentId) {
          adopt(job, fresh, 'read');
          return null;
        }
        let settings = parsed;
        if (exemptHost !== null) {
          if (exemptHost !== fresh.host || !isProtectionHost(exemptHost)) return null;
          settings = readProtectionSettings({ ...settings, sites: [...settings.sites.filter(site => site.host !== exemptHost), { host: exemptHost, disabled: true, rules: [] }] });
          if (!settings) return null;
        }
        const response = await send(job, { schemaVersion: 1, type: 'ui-protection-set', tabId: job.tabId, settings });
        if (!adopt(job, response, 'save') || response.registration === 'error' || response.cleanupIncomplete) return null;
        if (!reload) return response;
        const loaded = await send(job, { schemaVersion: 1, type: 'ui-protection-reload', tabId: job.tabId, documentId: fresh.documentId });
        if (!current(job)) return null;
        if (!loaded) return null;
        adopt(job, loaded, 'save');
        // A committed navigation schedules its own fresh native read.
        queueRefresh('read');
        return loaded;
      });
    }
    const invalidate = () => {
      generation.current++; state.current = null;
      if (mounted.current) setView({ state: null, busy: pending.current !== null, error: false, reason: 'read' });
      queueRefresh('read');
      if (!pending.current) { refreshQueued.current = false; void refresh(); }
    };
    useEffect(() => {
      mounted.current = true;
      return () => { mounted.current = false; generation.current++; };
    }, []);
    useEffect(() => { invalidate(); }, [tabId, documentKey]);
    useEffect(() => {
      const committed = details => { if (details.tabId === tabId && details.frameId === 0) invalidate(); };
      const removed = removedTab => { if (removedTab === tabId) invalidate(); };
      const permissions = () => invalidate();
      const storage = (changes, area) => { if (area === 'local' && changes && Object.hasOwn(changes, 'protection:v1')) void refresh('external'); };
      const subscriptions = [[nativeEvents.webNavigation?.onCommitted, committed], [nativeEvents.tabs?.onRemoved, removed], [nativeEvents.permissions?.onRemoved, permissions], [nativeEvents.permissions?.onAdded, permissions], [nativeEvents.storage?.onChanged, storage]];
      for (const [event, listener] of subscriptions) event?.addListener(listener);
      return () => {
        for (const [event, listener] of subscriptions) event?.removeListener(listener);
      };
    }, [tabId]);
    return { ...view, refresh: () => refresh('read'), toggle, save };
  }

  function MasterSwitch({ enabled, disabled, onChange }) {
    return h('button', { type: 'button', class: 'blocking-master ' + (enabled ? 'blocking-master--on' : 'blocking-master--off'), role: 'switch', 'aria-checked': enabled, 'aria-label': text('protection_master'), 'data-protection-master': true, 'data-protection-action': 'master', disabled, onClick: onChange,
      children: [h('span', { class: 'blocking-master__dot', 'aria-hidden': 'true' }), h('span', { children: enabled ? 'ON' : 'OFF' })] });
  }
  function ProtectionLauncher({ tabId = null, documentKey = null }) {
    useLocale();
    const protection = useProtection(tabId, documentKey), [opening, setOpening] = useState(false), [openError, setOpenError] = useState(false), active = useRef(false), mounted = useRef(false);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    async function open() {
      if (active.current || !validTab(tabId)) return;
      active.current = true; setOpening(true); setOpenError(false);
      try {
        if (!await openManagement('api', tabId, browserApi)) throw new Error('management-unavailable');
      } catch { if (mounted.current) setOpenError(true); }
      finally { active.current = false; if (mounted.current) setOpening(false); }
    }
    return h('section', { class: 'blocking-launcher', 'data-protection-launcher': true, 'aria-busy': protection.busy || opening, children: [
      h('div', { class: 'blocking-launcher__controls', children: [
        h('button', { type: 'button', class: 'blocking-launcher__open', 'data-protection-open': true, 'data-protection-action': 'open', disabled: opening, onClick: open, 'aria-label': text('protection_open_settings'), children: [h('span', { children: text('protection_title') }), h('span', { class: 'blocking-launcher__chevron', 'aria-hidden': 'true', children: '›' })] }),
        h(MasterSwitch, { enabled: protection.state?.settings.enabled === true, disabled: protection.busy || !protection.state, onChange: protection.toggle })
      ] }),
      protection.error || openError ? h('p', { class: 'blocking-message blocking-message--error', role: 'alert', children: text('protection_error') }) : null
    ] });
  }

  function Segmented({ options, value, label, disabled, onChange, feature }) {
    const focus = useRef(null);
    function keydown(event) {
      const index = options.findIndex(option => option.value === value), last = options.length - 1;
      let next = index;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % options.length;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + options.length) % options.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = last;
      else return;
      event.preventDefault();
      if (!disabled) { onChange(options[next].value); focus.current?.querySelectorAll('button')[next]?.focus(); }
    }
    return h('div', { class: 'blocking-segmented' + (feature ? ' blocking-segmented--states' : ''), role: 'radiogroup', 'aria-label': label, onKeyDown: keydown, ref: focus,
      children: options.map(option => h('button', { type: 'button', role: 'radio', 'aria-checked': option.value === value, tabIndex: option.value === value ? 0 : -1, disabled, class: 'blocking-segmented__option' + (option.value === value ? ' is-selected' : '') + (option.color ? ' blocking-segmented__option--' + option.color : ''), ...option.attributes, onClick: () => onChange(option.value), children: option.label, key: option.value })) });
  }

  const pageRtl = () => globalThis.document?.documentElement?.dir === 'rtl';
  // Hook-free: the parent owns the ref. Selection follows focus; nothing is written.
  function FilterChips({ value, counts, onChange, group }) {
    function keydown(event) {
      const next = rovingIndex(event.key, PROTECTION_FILTERS.indexOf(value), PROTECTION_FILTERS.length, pageRtl());
      if (next === null) return;
      event.preventDefault();
      onChange(PROTECTION_FILTERS[next]);
      group.current?.querySelectorAll('[data-protection-filter]')[next]?.focus();
    }
    return h('div', { class: 'blocking-chips', role: 'radiogroup', 'aria-label': text('protection_filter_label'), 'data-protection-filters': true, ref: group, onKeyDown: keydown,
      children: PROTECTION_FILTERS.map(id => {
        const selected = id === value;
        return h('button', { type: 'button', role: 'radio', 'aria-checked': selected, tabIndex: selected ? 0 : -1, key: id, class: 'blocking-chip' + (selected ? ' is-selected' : ''), 'data-protection-filter': id, onClick: () => onChange(id),
          children: [
            h('span', { class: 'blocking-chip__label', children: text('protection_filter_' + id) }),
            h('span', { class: 'blocking-chip__count', 'aria-hidden': 'true', 'data-protection-filter-count': id, children: counts[id] })
          ] });
      }) });
  }

  function ProtectionSettings({ tabId = null, documentKey = null, global = true }) {
    useLocale();
    const protection = useProtection(tabId, documentKey), [draft, setDraft] = useState(null), [scope, setScope] = useState(tabId === null && global ? 'global' : 'site'), [siteHost, setSiteHost] = useState(null), [hostInput, setHostInput] = useState(''), [filter, setFilter] = useState(''), [onlyConfigured, setOnlyConfigured] = useState(false), [editError, setEditError] = useState(false), draftRef = useRef(null), draftBase = useRef(null), previousHost = useRef(null);
    draftRef.current = draft;
    useEffect(() => {
      const saved = protection.state;
      if (!saved) { setDraft(null); draftBase.current = null; return; }
      const previous = draftRef.current;
      // A master change may preserve local edits only over the exact previous revision.
      const preserveDraft = protection.reason === 'master' && previous && saved.settings.revision === previous.revision + 1;
      const hasEdits = previous && draftBase.current && JSON.stringify(previous) !== JSON.stringify(draftBase.current);
      const externalDraft = hasEdits && (protection.reason === 'external' || protection.reason === 'master' && !preserveDraft);
      setDraft(externalDraft ? { ...previous, enabled: saved.settings.enabled } : preserveDraft ? { ...previous, revision: saved.settings.revision, enabled: saved.settings.enabled } : saved.settings);
      if (!externalDraft) draftBase.current = saved.settings;
      if (siteHost === null || siteHost === previousHost.current) setSiteHost(saved.host);
      previousHost.current = saved.host;
      setEditError(false);
    }, [protection.state]);
    const [category, setCategory] = useState('all'), [announced, setAnnounced] = useState(null);
    const chipsRef = useRef(null), shownRef = useRef(0), touched = useRef(false);
    useEffect(() => {
      // Silent on page load; emptied first so an equal count is announced again.
      if (!touched.current) return undefined;
      setAnnounced(null);
      const timer = setTimeout(() => setAnnounced(shownRef.current), 500);
      return () => clearTimeout(timer);
    }, [category, filter, onlyConfigured]);
    const edit = next => { if (!protection.busy) { setDraft(next); setEditError(false); } };
    if (!draft || !protection.state) return h('section', { class: 'blocking-settings', 'data-protection-settings': true, children: [h('p', { role: protection.error ? 'alert' : 'status', children: text(protection.error ? 'protection_error' : 'statusLoading') }), protection.error ? h('button', { class: 'button', type: 'button', disabled: protection.busy, onClick: protection.refresh, children: text('action_refresh') }) : null] });
    const saved = protection.state, editingSite = scope === 'site', site = draft.sites.find(entry => entry.host === siteHost), rules = editingSite ? site?.rules ?? [] : draft.global;
    const effective = effectiveProtection(editingSite ? { ...draft, enabled: true } : { ...draft, enabled: true, sites: [] }, siteHost ?? 'protection.invalid');
    const dirty = JSON.stringify(saved.settings) !== JSON.stringify(draft), canEdit = !protection.busy && (!editingSite || siteHost !== null);
    const hosts = [...new Set([...(saved.host ? [saved.host] : []), ...draft.sites.map(entry => entry.host)])];
    const features = PROTECTION_FEATURES.filter(feature => (!onlyConfigured || effective.includes(feature)) && (text('protection_feature_' + feature.replaceAll('-', '_')) + ' ' + API_NAMES[feature]).toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
    const matching = new Set(features);
    const view = protectionFilterView(PROTECTION_GROUPS, PROTECTION_FEATURE_FILTER, feature => matching.has(feature), category);
    shownRef.current = view.shown;
    const touch = () => { touched.current = true; };
    const selectCategory = id => { touch(); setCategory(id); };
    const clearFilters = () => { touch(); setCategory('all'); setFilter(''); setOnlyConfigured(false); chipsRef.current?.querySelector('[data-protection-filter="all"]')?.focus(); };
    const updateSite = (disabled, nextRules) => {
      if (!canEdit || !siteHost) return;
      if (!site && draft.sites.length >= MAX_PROTECTION_SITES) { setEditError(true); return; }
      edit({ ...draft, sites: [...draft.sites.filter(entry => entry.host !== siteHost), { host: siteHost, disabled, rules: nextRules }] });
    };
    const scopeOptions = [{ value: 'global', label: text('protection_global'), attributes: { 'data-protection-scope': 'global' } }, { value: 'site', label: text('protection_current_site'), attributes: { 'data-protection-scope': 'site' } }];
    const presetOptions = ['custom', 'limited', 'strict'].map(value => ({ value, label: text('protection_' + value), attributes: { 'data-protection-preset': value } }));
    const ruleRow = feature => {
      const label = feature.startsWith('webassembly-') ? API_NAMES[feature] : text('protection_feature_' + feature.replaceAll('-', '_'));
      const options = ['on', 'bypass', 'off'].map(value => ({ value, label: value.toUpperCase(), color: value, attributes: { 'data-protection-state': value } }));
      const partial = PROTECTION_PARTIAL.includes(feature) ? h('span', { class: 'blocking-rule__partial', 'data-protection-partial': true, title: text('protection_rule_partial_hint'), children: [text('protection_rule_partial'), h('span', { class: 'sr-only', children: ': ' + text('protection_rule_partial_hint') })] }) : null;
      return h('div', { class: 'blocking-rule', 'data-protection-feature': feature, key: feature, children: [h('div', { class: 'blocking-rule__description', children: [h('strong', { class: 'blocking-rule__name', title: label, children: label }), partial, h('code', { class: 'blocking-rule__api', dir: 'ltr', title: API_NAMES[feature], children: API_NAMES[feature] })] }), h(Segmented, { options, value: protectionRuleMode(rules, feature), label, feature, disabled: !canEdit, onChange: mode => { const next = updateProtectionRule(rules, feature, mode); editingSite ? updateSite(site?.disabled ?? false, next) : edit({ ...draft, global: next }); } })] });
    };
    return h('section', { class: 'blocking-settings', 'data-protection-settings': true, 'aria-busy': protection.busy, children: [
      h('div', { class: 'blocking-toolbar', children: [h('div', { class: 'blocking-toolbar__identity', children: [icon('M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z M8 12l3 3 5-6', 'blocking-shield'), h('div', { children: [h('strong', { children: text('protection_master') }), h('div', { class: 'blocking-toolbar__summary', children: [text('protection_rule_count'), ' · ', PROTECTION_FEATURES.length] })] })] }), h(MasterSwitch, { enabled: saved.settings.enabled, disabled: protection.busy, onChange: protection.toggle })] }),
      h('div', { class: 'blocking-controls', children: [
        global ? h('div', { class: 'blocking-control', children: [h('span', { class: 'blocking-control__label', children: text('protection_scope') }), h(Segmented, { options: scopeOptions, value: scope, label: text('protection_scope'), disabled: protection.busy, onChange: setScope })] }) : null,
        h('div', { class: 'blocking-control', children: [h('span', { class: 'blocking-control__label', children: text('protection_preset') }), h(Segmented, { options: presetOptions, value: draft.preset, label: text('protection_preset'), disabled: protection.busy, onChange: value => edit({ ...draft, preset: value }) })] }),
        editingSite ? h('div', { class: 'blocking-site-controls', children: [
          h('label', { class: 'blocking-host-picker', children: [h('span', { children: text('protection_site') }), h('select', { value: siteHost ?? '', 'data-protection-host-picker': true, disabled: protection.busy, onChange: event => setSiteHost(event.currentTarget.value || null), children: [h('option', { value: '', children: text('protection_no_host') }), ...hosts.map(host => h('option', { value: host, children: host, key: host }))] })] }),
          h('div', { class: 'blocking-host-entry', children: [h('input', { type: 'text', inputMode: 'url', dir: 'ltr', maxLength: 253, value: hostInput, 'data-protection-host': true, 'aria-label': text('protection_site'), placeholder: 'example.com', disabled: protection.busy, onInput: event => setHostInput(event.currentTarget.value) }), h('button', { type: 'button', class: 'button', disabled: protection.busy || !isProtectionHost(hostInput) || !draft.sites.some(entry => entry.host === hostInput) && draft.sites.length >= MAX_PROTECTION_SITES, onClick: () => { if (!isProtectionHost(hostInput)) return; setSiteHost(hostInput); if (!draft.sites.some(entry => entry.host === hostInput)) edit({ ...draft, sites: [...draft.sites, { host: hostInput, disabled: false, rules: [] }] }); setHostInput(''); }, children: text('protection_add_site') })] }),
          h('div', { class: 'blocking-site-actions', children: [h('label', { class: 'blocking-checkbox', children: [h('input', { type: 'checkbox', checked: site?.disabled ?? false, disabled: !canEdit, 'data-protection-site-off': true, onChange: event => updateSite(event.currentTarget.checked, rules) }), text('protection_site_off')] }), site ? h('button', { type: 'button', class: 'button button--text', disabled: protection.busy, onClick: () => edit({ ...draft, sites: draft.sites.filter(entry => entry.host !== siteHost) }), children: text('protection_remove_site') }) : null] })
        ] }) : null
      ] }),
      h('div', { class: 'blocking-filter', children: [h('input', { type: 'search', value: filter, 'data-protection-search': true, 'aria-label': text('protection_search'), placeholder: text('protection_search'), onInput: event => { touch(); setFilter(event.currentTarget.value); } }), h('label', { class: 'blocking-checkbox', children: [h('input', { type: 'checkbox', checked: onlyConfigured, onChange: event => { touch(); setOnlyConfigured(event.currentTarget.checked); } }), text('protection_configured')] })] }),
      h('div', { class: 'blocking-categories', 'data-protection-categories': true, children: [
        h(FilterChips, { value: view.category, counts: view.counts, onChange: selectCategory, group: chipsRef }),
        h('span', { class: 'sr-only', role: 'status', 'data-protection-filter-live': true, children: announced === null ? '' : text('protection_filter_shown', [String(announced), String(PROTECTION_FEATURES.length)]) })
      ] }),
      h('div', { class: 'blocking-groups', 'data-protection-filter-active': view.category, children: view.groups.map(group => h('section', { class: 'blocking-group blocking-group--' + group.id, 'data-protection-group': group.id, 'aria-labelledby': 'blocking-group-' + group.id, key: group.id, children: [
        h('h2', { class: 'blocking-group__heading', id: 'blocking-group-' + group.id, children: [icon(group.icon, 'blocking-group__icon'), h('span', { children: text('protection_group_' + group.id) }), h('span', { class: 'blocking-group__count', children: group.features.length })] }),
        h('div', { class: 'blocking-rules', children: group.features.map(feature => ruleRow(feature)) })
      ] })) }),
      view.shown === 0 ? h('div', { class: 'blocking-empty', 'data-protection-empty': true, children: [
        h('p', { class: 'blocking-message', children: text('protection_no_rows') }),
        h('button', { type: 'button', class: 'button', 'data-protection-filter-clear': true, onClick: clearFilters, children: text('protection_filter_clear') })
      ] }) : null,
      h('div', { class: 'blocking-footer', children: [
        h('p', { class: 'blocking-note', 'data-protection-limits': true, children: text('protection_limits') }),
        h('p', { class: 'blocking-message' + (protection.error || editError ? ' blocking-message--error' : ''), 'data-protection-status': true, role: protection.error || editError ? 'alert' : 'status', children: text(protection.error || editError ? 'protection_error' : dirty ? 'protection_dirty' : protection.reason === 'save' || protection.reason === 'master' ? 'protection_saved' : saved.registration === 'ready' ? 'protection_ready' : 'protection_inactive') }),
        h('div', { class: 'blocking-actions', children: [
          h('button', { class: 'button button--primary', type: 'button', 'data-protection-save': true, 'data-protection-action': 'save', disabled: protection.busy || !dirty, onClick: () => protection.save(draft), children: text('protection_save') }),
          tabId !== null ? h('button', { class: 'button', type: 'button', 'data-protection-save-reload': true, 'data-protection-action': 'save-reload', disabled: protection.busy || saved.documentId === null, onClick: () => protection.save(draft, true), children: text('protection_save_reload') }) : null,
          h('button', { class: 'button', type: 'button', 'data-protection-reset': true, disabled: !canEdit, onClick: () => editingSite ? updateSite(false, []) : edit({ ...draft, global: [] }), children: text('protection_reset') }),
          h('button', { class: 'button button--text', type: 'button', disabled: protection.busy, onClick: protection.refresh, title: text('protection_refresh'), 'aria-label': text('protection_refresh'), children: '↻' })
        ] }),
        editingSite && siteHost !== null && siteHost === saved.host && tabId !== null ? h('button', { class: 'button button--text blocking-recovery', type: 'button', disabled: protection.busy || saved.documentId === null, 'data-protection-restore': true, onClick: () => protection.save(draft, true, siteHost), children: text('protection_restore_reload') }) : null
      ] })
    ] });
  }
  const configurationUi = apiConfigurationEnabled ? createApiConfigurationUi({ h, useState, useEffect, useRef, useLocale, browserApi, translate, featureFilter: PROTECTION_FEATURE_FILTER, renderGroupIcon: id => {
    const group = PROTECTION_GROUPS.find(group => group.id === id);
    return group ? icon(group.icon, 'blocking-group__icon') : null;
  } }) : null;
  return { ProtectionLauncher, ProtectionSettings: configurationUi ? configurationUi.ApiConfigurationEditor : ProtectionSettings };
}
