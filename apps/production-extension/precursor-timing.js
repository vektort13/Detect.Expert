// DET-CF-PRECURSOR-001 / ADR-074/076: passive native resource metadata in ISOLATED.
// This file is inlined by sync-precursor-runtime; no MAIN channel or raw URL leaves the realm.
export function classifyPrecursorTimingResource(raw, origin) {
  if (typeof raw !== 'string' || raw.length > 16384 || !raw.startsWith('https://') || /[\\\u0000-\u0020\u007f]/.test(raw)) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash && url.origin === origin &&
      /^\/cdn-cgi\/challenge-platform\/h\/g\/scripts\/precursor\/[a-f0-9]{12}\/main\.js$/.test(url.pathname) ? 'cf-precursor-versioned-loader-v1' : null;
  } catch { return null; }
}

export function readPrecursorTimingCache(value) {
  try {
    const own = (object, key) => object && typeof object === 'object' ? Object.getOwnPropertyDescriptor(object, key)?.value : undefined;
    const keys = ['schemaVersion', 'type', 'available', 'ruleIds', 'revision', 'truncated'];
    if (!value || typeof value !== 'object' || Array.isArray(value) || Reflect.ownKeys(value).length !== keys.length ||
      !keys.every(key => { const descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor?.enumerable && Object.hasOwn(descriptor, 'value'); }) ||
      own(value, 'schemaVersion') !== 1 || own(value, 'type') !== 'precursor-timing-cache' || typeof own(value, 'available') !== 'boolean' ||
      typeof own(value, 'truncated') !== 'boolean' || !Number.isSafeInteger(own(value, 'revision')) || own(value, 'revision') < 0 || own(value, 'revision') > 2147483647) return null;
    const rules = own(value, 'ruleIds'), length = own(rules, 'length');
    if (!Array.isArray(rules) || ![0, 1].includes(length) || Reflect.ownKeys(rules).length !== length + 1 ||
      length === 1 && own(rules, '0') !== 'cf-precursor-versioned-loader-v1' || !own(value, 'available') && length !== 0) return null;
    return { schemaVersion: 1, type: 'precursor-timing-cache', available: own(value, 'available'), ruleIds: length ? ['cf-precursor-versioned-loader-v1'] : [], revision: own(value, 'revision'), truncated: own(value, 'truncated') };
  } catch { return null; }
}

export function startPrecursorTimingBridge(env) {
  const own = (value, key) => value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
  const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Reflect.ownKeys(value).length === keys.length &&
    keys.every(key => { const field = Object.getOwnPropertyDescriptor(value, key); return field?.enumerable && Object.hasOwn(field, 'value'); });
  const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
  let observer = null, enabled = true, suspended = false, available = env.available === true, truncated = false;
  let observed = false, observedAt = -Infinity, revision = 0, cutoff = -Infinity, started = false, fallbackRead = false;
  let sessionId = null, lastResetId = null, windowAt = -Infinity, windowEntries = 0;
  const advance = () => { if (revision < 2147483647) ++revision; else { available = false; truncated = true; observed = false; } };
  const reset = () => {
    observed = false; observedAt = -Infinity; cutoff = env.now(); truncated = false;
    fallbackRead = true; windowAt = cutoff; windowEntries = 0; advance();
    // Drop queued old deliveries without clearing or resizing the page's own timing buffer.
    try { observer?.takeRecords(); } catch { truncated = true; }
  };
  const record = entries => {
    if (!enabled || suspended || !available) return;
    const now = env.now();
    if (!Number.isFinite(now)) { truncated = true; return; }
    if (now < windowAt || now - windowAt >= 1000) { windowAt = now; windowEntries = 0; }
    if (!Array.isArray(entries) || entries.length > 2048 || windowEntries + entries.length > 4096) { truncated = true; return; }
    windowEntries += entries.length;
    for (const entry of entries) {
      try {
        const start = env.start(entry);
        if (!Number.isFinite(start) || start < 0 || start <= cutoff || start > now || env.initiator(entry) !== 'script') continue;
        const rule = env.classify(env.name(entry), env.origin());
        if (rule === null) continue;
        const status = env.status(entry);
        // Firefox 138 retains application/javascript; newer normalization may use text/javascript.
        if (!Number.isInteger(status) || !(status >= 200 && status <= 299 || status === 304) || !['text/javascript', 'application/javascript'].includes(env.contentType(entry))) continue;
        observed = true; observedAt = now; advance();
      } catch { truncated = true; }
    }
  };
  const connect = () => {
    if (observer || !enabled || suspended || !available) return;
    try { observer = env.observe(record, !started); started = true; }
    catch {
      truncated = true;
      if (!fallbackRead) { fallbackRead = true; try { record(env.entries()); } catch { available = false; } }
    }
  };
  const disconnect = () => { try { observer?.disconnect(); } catch {} observer = null; };
  const snapshot = () => {
    const now = env.now();
    if (observed && (!Number.isFinite(now) || now < observedAt || now - observedAt >= 600000)) { observed = false; advance(); }
    return { schemaVersion: 1, type: 'precursor-timing-cache', available: available && enabled && !suspended,
      ruleIds: available && enabled && !suspended && observed ? ['cf-precursor-versioned-loader-v1'] : [], revision, truncated };
  };
  connect();
  env.onCommand((trusted, message, respond) => {
    if (!trusted) return false;
    const type = own(message, 'type');
    if (type === 'bridge-control' && own(message, 'schemaVersion') === 1) {
      const command = own(message, 'command');
      if (['pause', 'stop', 'resume'].includes(command) && exact(message, ['schemaVersion', 'type', 'command'])) {
        reset(); enabled = command === 'resume'; if (!enabled) disconnect(); else connect();
      } else if (command === 'reset' && exact(message, ['schemaVersion', 'type', 'command', 'resetId']) && id(own(message, 'resetId')) && lastResetId !== own(message, 'resetId')) {
        reset(); lastResetId = own(message, 'resetId');
      }
      // The core collector owns bridge-control ACKs; do not race its responder.
      return false;
    }
    if (type === 'precursor-timing-reset' && exact(message, ['schemaVersion', 'type', 'resetId']) && own(message, 'schemaVersion') === 1 && id(own(message, 'resetId'))) {
      if (lastResetId !== own(message, 'resetId')) { reset(); lastResetId = own(message, 'resetId'); }
      respond({ schemaVersion: 1, type: 'precursor-timing-reset-ack', resetId: lastResetId }); return false;
    }
    if (type !== 'precursor-timing-query' || !exact(message, ['schemaVersion', 'type', 'sessionId']) || own(message, 'schemaVersion') !== 1 || !id(own(message, 'sessionId'))) return false;
    // Event-page/SW replacement cannot adopt a producer already queried by an older instance.
    if (sessionId !== null && sessionId !== own(message, 'sessionId')) reset();
    sessionId = own(message, 'sessionId'); connect();
    try { if (observer?.takeRecords) record(observer.takeRecords()); } catch { truncated = true; }
    respond(snapshot()); return false;
  });
  env.onHide(() => { reset(); suspended = true; disconnect(); });
  env.onRestore(() => { reset(); suspended = false; connect(); });
  env.onBufferFull(() => { truncated = true; });
}

export function installPrecursorTimingBridge(start, classify, trust, api) {
  // Chrome has exact native network identity; avoid a second unused resource observer.
  try {
    // getBrowserInfo is not exposed in Firefox 138 content scripts; getURL is native in both realms.
    if (typeof api?.runtime?.getURL !== 'function' || !api.runtime.getURL('').startsWith('moz-extension://')) return;
    const apply = Reflect.apply, descriptor = Object.getOwnPropertyDescriptor;
    const getter = (prototype, key) => descriptor(prototype, key)?.get;
    const name = getter(PerformanceEntry.prototype, 'name'), time = getter(PerformanceEntry.prototype, 'startTime');
    const initiator = getter(PerformanceResourceTiming.prototype, 'initiatorType'), status = getter(PerformanceResourceTiming.prototype, 'responseStatus');
    const contentType = getter(PerformanceResourceTiming.prototype, 'contentType');
    const getEntries = Performance.prototype.getEntriesByType, now = Performance.prototype.now;
    start({ available: [name, time, initiator, status, contentType, getEntries, now].every(value => typeof value === 'function'),
      name: entry => apply(name, entry, []), start: entry => apply(time, entry, []), initiator: entry => apply(initiator, entry, []),
      status: entry => apply(status, entry, []), contentType: entry => apply(contentType, entry, []), classify,
      origin: () => location.origin, now: () => apply(now, performance, []), entries: () => apply(getEntries, performance, ['resource']),
      observe: (record, buffered) => { const observer = new PerformanceObserver(list => record(list.getEntries())); observer.observe({ type: 'resource', buffered }); return observer; },
      onCommand: listener => api.runtime.onMessage.addListener((message, sender, respond) => listener(trust(sender), message, respond)),
      onHide: listener => window.addEventListener('pagehide', listener),
      onRestore: listener => window.addEventListener('pageshow', event => { if (event.persisted) listener(); }),
      onBufferFull: listener => performance.addEventListener('resourcetimingbufferfull', listener) });
  } catch { /* Missing browser timing support stays unavailable. */ }
}
