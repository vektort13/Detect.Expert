// ADR-030: source-attributed page calls remain separate from network outcomes.
export function createBeaconEndpointProjector() {
  const apply = Reflect.apply, exec = RegExp.prototype.exec, lower = String.prototype.toLowerCase, descriptor = Object.getOwnPropertyDescriptor;
  const matches = (pattern, value) => apply(exec, pattern, [value]) !== null;
  return input => {
    const raw = descriptor(input, 'url')?.value;
    if (typeof raw !== 'string' || raw.length > 32768) return null;
    const parsed = apply(exec, /^https:\/\/([a-z0-9.-]+)(?::443)?(\/[^?#]*)?(?:[?#][\s\S]*)?$/i, [raw]);
    if (!parsed) return null;
    const host = apply(lower, parsed[1], []), path = parsed[2] ?? '/'; let service, profile;
    if (matches(/^(?:www|region1|analytics)\.google-analytics\.com$/, host)) {
      if (path === '/mp/collect') { service = 'google-analytics'; profile = 'ga4-mp-v1'; }
      else if (path === '/g/collect' || path === '/j/collect') { service = 'google-analytics'; profile = 'ga4-browser-v1'; }
    } else if (matches(/^(?:www\.googleadservices\.com|www\.google\.com|googleads\.g\.doubleclick\.net)$/, host) && matches(/^\/pagead\/(?:1p-)?(?:conversion|viewthroughconversion)\/[0-9]{1,20}\/?$/, path)) { service = 'google-ads'; profile = 'google-ads-browser-v1'; }
    else if (host === 'www.facebook.com' && matches(/^\/tr\/?$/, path)) { service = 'meta'; profile = 'meta-browser-v1'; }
    else if (host === 'graph.facebook.com' && matches(/^\/v[0-9]{1,2}\.[0-9]{1,2}\/[0-9]{1,24}\/events\/?$/, path)) { service = 'meta'; profile = 'meta-capi-v1'; }
    else if (host === 'analytics.tiktok.com' && matches(/^\/api\/v[12]\/(?:pixel|i18n\/pixel)\/?$/, path)) { service = 'tiktok'; profile = 'tiktok-browser-v1'; }
    else if (host === 'business-api.tiktok.com' && path === '/open_api/v1.3/event/track/') { service = 'tiktok'; profile = 'tiktok-events-v1'; }
    else if (matches(/^mc\.(?:yandex\.(?:ru|com|com\.tr|kz|by)|webvisor\.org)$/, host)) {
      if (matches(/^\/watch\/[0-9]{1,20}\/?$/, path)) { service = 'yandex'; profile = 'yandex-watch-v1'; }
      else if (path === '/collect') { service = 'yandex'; profile = 'yandex-mp-v1'; }
    } else if (host === 'px.ads.linkedin.com' && matches(/^\/collect\/?$/, path)) { service = 'linkedin'; profile = 'linkedin-image-v1'; }
    else if (host === 'api.linkedin.com' && path === '/rest/conversionEvents') { service = 'linkedin'; profile = 'linkedin-capi-v1'; }
    if (!profile) return null;
    return { service, profile, destinationHost: host, schemaConfidence: 'endpoint-only', events: [], money: [], identifiers: { clientId: 'unknown', browserId: 'unknown', sessionId: 'unknown', userId: 'unknown', hashedEmail: 'unknown', hashedPhone: 'unknown' }, consent: { gcs: 'unknown', gcd: 'unknown', adUserData: 'unknown', adPersonalization: 'unknown' }, parameterNames: [], decodeStatus: 'endpoint-only' };
  };
}
export function createBeaconSensorSupport(decode) {
  const apply = Reflect.apply, descriptor = Object.getOwnPropertyDescriptor;
  const NativeMap = Map, NativeWeakMap = WeakMap, stringify = JSON.stringify;
  const mapGet = Map.prototype.get, mapSet = Map.prototype.set, mapEach = Map.prototype.forEach, weakGet = WeakMap.prototype.get, weakSet = WeakMap.prototype.set;
  const push = Array.prototype.push, own = (object, key) => descriptor(object, key)?.value;
  const guarded = [];
  for (const [object, keys] of [
    [String.prototype, ['includes', 'split', 'slice', 'replace', 'startsWith', 'endsWith', 'toUpperCase']],
    [Array.prototype, ['includes', 'map', 'some', 'flatMap', 'reduce', 'push', 'slice', 'toJSON', Symbol.iterator]], [Object.prototype, ['toJSON']],
    [Map.prototype, ['get', 'set', 'values', Symbol.iterator]], [Set.prototype, ['has', 'add']],
    [RegExp.prototype, ['test', 'exec']], [Object, ['getOwnPropertyDescriptor', 'hasOwn', 'fromEntries', 'create']],
    [Reflect, ['ownKeys']], [Number, ['isFinite']], [Object, ['is']], [JSON, ['parse', 'stringify']],
    [Object.getPrototypeOf(new NativeMap().entries()), ['next']], [Object.getPrototypeOf([].values()), ['next']],
  ]) for (const key of keys) { const entry = descriptor(object, key); guarded.push([object, key, entry?.value, entry?.get, entry?.set]); }
  const stable = () => { for (let index = 0; index < guarded.length; ++index) { const expected = guarded[index], entry = descriptor(expected[0], expected[1]); if (entry?.value !== expected[2] || entry?.get !== expected[3] || entry?.set !== expected[4]) return false; } return true; };
  function createCollector() {
    let rows = new NativeMap(), nodes = new NativeWeakMap(), xhr = new NativeWeakMap(), rowCount = 0, nodeCount = 0, xhrCount = 0, bytes = 256, truncated = false, lastReadAt = -Infinity;
    return {
      reset() { rows = new NativeMap(); nodes = new NativeWeakMap(); xhr = new NativeWeakMap(); rowCount = 0; nodeCount = 0; xhrCount = 0; bytes = 256; truncated = false; lastReadAt = -Infinity; },
      prepare(raw, method) {
        if (typeof raw !== 'string' || !stable()) { if (typeof raw === 'string') truncated = true; return null; }
        return decode({ url: raw, method: method === 'GET' || method === 'POST' || method === 'PUT' ? method : 'unknown', bodyAvailable: false });
      },
      record(decoded, requestType, method, source, node = null, force = false) {
        if (!decoded || !stable()) return;
        const attribution = source(), script = attribution?.script ?? null;
        const row = { ...decoded, method: method === 'GET' || method === 'POST' || method === 'PUT' ? method : 'unknown', requestType: ['image', 'xmlhttprequest', 'ping', 'script'].includes(requestType) ? requestType : 'other', count: 1, completedCount: 0, failedCount: 0, redirectCount: 0, statusCodes: [], evidenceSource: 'page-hook', integrity: 'page-controlled', attributionConfidence: script ? attribution.attributionConfidence : 'unknown', initiatorHost: null, script };
        const key = apply(stringify, JSON, [row]);
        if (node !== null && (typeof node === 'object' || typeof node === 'function')) {
          const previous = apply(weakGet, nodes, [node]);
          if (!force && previous === key) return;
          if (previous === undefined && nodeCount++ >= 512) { truncated = true; return; }
          apply(weakSet, nodes, [node, key]);
        }
        const previous = apply(mapGet, rows, [key]);
        if (previous) { if (previous.count < 2147483647) previous.count++; return; }
        const cost = 256 + key.length * 2;
        if (rowCount >= 32 || bytes + cost > 12000) { truncated = true; return; }
        rowCount++; bytes += cost; apply(mapSet, rows, [key, row]);
      },
      open(receiver, args, threw) {
        if (receiver === null || typeof receiver !== 'object') return;
        const prior = apply(weakGet, xhr, [receiver]);
        if (prior === undefined && xhrCount++ >= 512) { truncated = true; return; }
        const decoded = !threw ? this.prepare(args[1], args[0]) : null;
        apply(weakSet, xhr, [receiver, decoded ? { decoded, method: args[0] } : null]);
      },
      send(receiver, source) { const entry = apply(weakGet, xhr, [receiver]); if (entry) this.record(entry.decoded, 'xmlhttprequest', entry.method, source); },
      snapshot() { const output = []; apply(mapEach, rows, [row => apply(push, output, [row])]); return { rows: output, truncated }; },
      handleControl(data, enabled, env) {
        if (!data || typeof data !== 'object' || own(data, 'channel') !== 'detect.expert/beacon/v1' || own(data, 'type') !== 'beacon-values-read') return;
        const requestId = own(data, 'requestId');
        if (typeof requestId !== 'string' || !/^beacon-[0-9]{1,10}$/.test(requestId)) return;
        const now = env.now(); if (now - lastReadAt < 500) return; lastReadAt = now;
        const snapshot = enabled && stable() ? this.snapshot() : { rows: [], truncated: true };
        env.postMessage({ channel: 'detect.expert/beacon/v1', type: 'beacon-values-batch', requestId, enabled, rows: snapshot.rows, truncated: snapshot.truncated });
      },
    };
  }
  function install(runtime) {
    const collector = runtime.apiResults.beaconCollector; let generation = runtime.apiResults.generation;
    const active = () => { if (generation !== runtime.apiResults.generation) { generation = runtime.apiResults.generation; collector.reset(); } return runtime.hooks.enabled; };
    runtime.observeBeaconRequest = (raw, type, method, source, node, force) => { if (active()) collector.record(collector.prepare(raw, method), type, method, source, node, force); };
    runtime.observeBeaconXhrOpen = (receiver, args, threw) => { if (active()) collector.open(receiver, args, threw); };
    runtime.observeBeaconXhrSend = (receiver, source) => { if (active()) collector.send(receiver, source); };
    runtime.onStop(() => collector.reset());
  }
  return { createCollector, install };
}

export function startBeaconValuesBridge(env, readRows) {
  const descriptor = Object.getOwnPropertyDescriptor, ownKeys = Reflect.ownKeys, hasOwn = Object.hasOwn;
  const field = (value, key) => value && typeof value === 'object' ? descriptor(value, key)?.value : undefined;
  const exact = (value, names) => value && typeof value === 'object' && !Array.isArray(value) && ownKeys(value).length === names.length && names.every(name => hasOwn(descriptor(value, name) ?? {}, 'value'));
  let pending = null, sequence = 0, nextReadAt = -Infinity;
  const empty = () => ({ schemaVersion: 1, type: 'beacon-values-cache', available: false, rows: [], truncated: true });
  const finish = (available, rows = [], truncated = true) => {
    if (!pending) return;
    const current = pending; pending = null; env.cancel(current.timer); nextReadAt = env.now() + 500;
    current.respond(available ? { schemaVersion: 1, type: 'beacon-values-cache', available: true, rows, truncated } : empty());
  };
  env.onPage((sameWindow, data) => {
    if (!sameWindow || !pending || !pending.posted || pending.admitted++ >= 8 || !exact(data, ['channel', 'type', 'requestId', 'enabled', 'rows', 'truncated']) || field(data, 'channel') !== 'detect.expert/beacon/v1' || field(data, 'type') !== 'beacon-values-batch' || field(data, 'requestId') !== pending.requestId || typeof field(data, 'enabled') !== 'boolean' || typeof field(data, 'truncated') !== 'boolean') return;
    const rows = readRows(field(data, 'rows'));
    if (rows) finish(field(data, 'enabled'), rows, field(data, 'truncated'));
  });
  env.onCommand((trusted, data, respond) => {
    if (!trusted || !exact(data, ['schemaVersion', 'type']) || field(data, 'schemaVersion') !== 1 || field(data, 'type') !== 'beacon-values-query') return false;
    if (pending || sequence >= 2147483647) { respond(empty()); return false; }
    const requestId = 'beacon-' + ++sequence, current = { requestId, respond, admitted: 0, timer: null, posted: false }; pending = current;
    const post = () => { if (pending !== current) return; current.posted = true; current.timer = env.later(() => finish(false), 400); env.post({ channel: 'detect.expert/beacon/v1', type: 'beacon-values-read', requestId }); };
    const delay = Math.max(0, nextReadAt - env.now()); if (delay) current.timer = env.later(post, delay); else post(); return true;
  });
  env.onHide(() => finish(false));
}
