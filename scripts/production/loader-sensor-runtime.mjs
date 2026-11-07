// REQ-002/004/005/011, ADR-021: bounded, passive, page-controlled Pro loader evidence.
// Serialized into the two MAIN bundles; imports and page URLs never enter the wire.
export function createLoaderSensorSupport(trustedURL = false) {
  const apply = Reflect.apply, descriptor = Object.getOwnPropertyDescriptor;
  const NativeURL = descriptor(globalThis, 'URL')?.value, NativeError = descriptor(globalThis, 'Error')?.value;
  const NativeMap = Map, NativeWeakMap = WeakMap;
  const mapGet = Map.prototype.get, mapSet = Map.prototype.set, mapEach = Map.prototype.forEach;
  const weakGet = WeakMap.prototype.get, weakSet = WeakMap.prototype.set;
  const fnSource = Function.prototype.toString, push = Array.prototype.push;
  const exec = RegExp.prototype.exec, slice = String.prototype.slice, indexOf = String.prototype.indexOf;
  const hasOwn = Object.prototype.hasOwnProperty, getPrototype = Object.getPrototypeOf, decode = decodeURIComponent;
  const urlGet = Object.create(null);
  const matches = (pattern, value) => apply(exec, pattern, [value]) !== null;
  const nativeFunction = fn => typeof fn === 'function' && matches(/\[native code\]/, apply(fnSource, fn, []));
  let urlReady = false;
  try {
    if (typeof NativeURL === 'function' && (trustedURL || nativeFunction(NativeURL))) {
      const prototype = descriptor(NativeURL, 'prototype')?.value;
      urlReady = !!prototype;
      for (const key of ['protocol', 'hostname', 'pathname', 'search', 'username', 'password', 'port']) {
        let object = prototype, entry;
        for (let depth = 0; object && depth < 8; depth++, object = getPrototype(object)) { entry = descriptor(object, key); if (entry) break; }
        if (!entry || typeof entry.get !== 'function' || !trustedURL && !nativeFunction(entry.get)) { urlReady = false; break; }
        urlGet[key] = entry.get;
      }
    }
  } catch { urlReady = false; }
  const urlField = (url, key) => apply(urlGet[key], url, []);
  function googleId(query) {
    let result = null;
    let start = 1;
    while (start <= query.length) {
      const next = apply(indexOf, query, ['&', start]);
      const end = next < 0 ? query.length : next;
      const field = apply(slice, query, [start, end]), equal = apply(indexOf, field, ['=']);
      start = end + 1;
      const key = decode(equal < 0 ? field : apply(slice, field, [0, equal]));
      if (key !== 'id') continue;
      if (result !== null || equal < 0) return null;
      result = decode(apply(slice, field, [equal + 1]));
    }
    return result;
  }
  function classify(raw) {
    if (!urlReady || typeof raw !== 'string' || raw.length > 4096 || matches(/[\u0000-\u0020\u007f]/, raw)) return null;
    try {
      const url = new NativeURL(raw), scheme = urlField(url, 'protocol');
      if (scheme !== 'https:' && scheme !== 'http:' || urlField(url, 'username') || urlField(url, 'password') || urlField(url, 'port')) return null;
      const host = urlField(url, 'hostname'), path = urlField(url, 'pathname');
      if (host === 'dynamic.criteo.com' && path === '/js/ld/ld.js') return 'criteo';
      if (host === 'bat.bing.com' && path === '/bat.js') return 'bing-uet';
      if (scheme !== 'https:') return null;
      if (host === 'www.googletagmanager.com') {
        const id = googleId(urlField(url, 'search'));
        if (id !== null && path === '/gtm.js' && matches(/^GTM-[A-Za-z0-9]+$/, id)) return 'google-tag-manager';
        if (id !== null && path === '/gtag/js' && matches(/^AW-[0-9]+$/, id)) return 'google-ads';
        if (id !== null && path === '/gtag/js' && matches(/^(?:G-[A-Za-z0-9]+|UA-[0-9]+-[0-9]+)$/, id)) return 'google-analytics';
      }
      if (host === 'www.google-analytics.com' && path === '/analytics.js') return 'google-analytics';
      if (host === 'connect.facebook.net' && path === '/en_US/fbevents.js') return 'facebook-pixel';
      if (host === 'static.hotjar.com' && matches(/^\/c\/hotjar-[0-9]{1,32}\.js$/, path)) return 'hotjar';
      if (host === 'analytics.tiktok.com' && path === '/i18n/pixel/events.js') return 'tiktok-pixel';
      if (host === 'snap.licdn.com' && path === '/li.lms-analytics/insight.min.js') return 'linkedin-insight';
      if (host === 'www.clarity.ms' && matches(/^\/tag\/[A-Za-z0-9]{1,64}$/, path)) return 'microsoft-clarity';
      return null;
    } catch { return null; }
  }
  function createCollector() {
    let rows = new NativeMap(), nodes = new NativeWeakMap(), nodeCount = 0, samples = 0, truncated = !urlReady, unavailable = !urlReady;
    return {
      reset() { rows = new NativeMap(); nodes = new NativeWeakMap(); nodeCount = 0; samples = 0; truncated = unavailable; },
      unavailable() { unavailable = true; truncated = true; },
      limited() { truncated = true; },
      sample() { if (samples >= 64) { truncated = true; return false; } samples++; return true; },
      record(target, confidence, node, force = false) {
        if (!(target === 'google-analytics' || target === 'google-ads' || target === 'facebook-pixel' || target === 'hotjar' || target === 'criteo' || target === 'tiktok-pixel' || target === 'linkedin-insight' || target === 'bing-uet' || target === 'microsoft-clarity') || confidence !== 'exact-resource' && confidence !== 'sampled-stack' || node === null || typeof node !== 'object' && typeof node !== 'function') return;
        const key = target + ':' + confidence;
        const prior = apply(weakGet, nodes, [node]);
        if (!force && prior === key) return;
        if (prior === undefined) {
          if (nodeCount >= 512) { truncated = true; return; }
          nodeCount++;
        }
        apply(weakSet, nodes, [node, key]);
        const row = apply(mapGet, rows, [key]);
        if (row) { if (row.count < 2147483647) row.count++; }
        else apply(mapSet, rows, [key, { source: 'google-tag-manager', target, attributionConfidence: confidence, evidenceSource: 'page-hook', integrity: 'page-controlled', count: 1 }]);
      },
      snapshot() {
        const output = [];
        apply(mapEach, rows, [row => apply(push, output, [{ source: row.source, target: row.target, attributionConfidence: row.attributionConfidence, evidenceSource: row.evidenceSource, integrity: row.integrity, count: row.count }])]);
        return { rows: output, truncated };
      },
    };
  }
  function stackSource(raw, collector) {
    if (typeof raw !== 'string') { collector.limited(); return false; }
    if (raw.length > 8192) collector.limited();
    const bounded = apply(slice, raw, [0, 8192]);
    let start = apply(indexOf, bounded, ['\n']) + 1;
    if (start === 0) return false;
    for (let index = 1; index <= 8 && start < bounded.length; index++) {
      const next = apply(indexOf, bounded, ['\n', start]), end = next < 0 ? bounded.length : next;
      const line = apply(slice, bounded, [start, end]); start = end + 1;
      if (!matches(/^\s+at\s|^[^@]*@/, line)) continue;
      // Only the final frame location, never a function name or nested query URL.
      const found = apply(exec, /(?:^\s+at\s+|@|\()(https:\/\/[^\s)]+)\)?$/, [line]);
      if (!found) continue;
      const location = found[1], position = apply(exec, /:[0-9]+(?::[0-9]+)?$/, [location]);
      if (!position) continue;
      const candidate = apply(slice, location, [0, position.index]);
      if (classify(candidate) === 'google-tag-manager') return true;
    }
    if (start < bounded.length) collector.limited();
    return false;
  }
  function install(runtime, realm, wrappers, nativeCheck) {
    const collector = runtime.apiResults.loaderCollector;
    if (!urlReady) { collector.unavailable(); return; }
    const native = nativeCheck || nativeFunction;
    const ownValue = (object, key) => object && descriptor(object, key)?.value;
    const prototype = key => ownValue(ownValue(realm, key), 'prototype');
    const getter = (object, key) => { const fn = descriptor(object, key)?.get; return native(fn) ? fn : null; };
    const script = prototype('HTMLScriptElement'), docProto = prototype('Document'), nodeProto = prototype('Node');
    const scriptUrl = script && getter(script, 'src'), current = docProto && getter(docProto, 'currentScript');
    const connected = nodeProto && getter(nodeProto, 'isConnected');
    let document;
    try { const entry = descriptor(realm, 'document'); document = entry?.value ?? (native(entry?.get) ? apply(entry.get, realm, []) : null); } catch { collector.unavailable(); return; }
    if (!scriptUrl || !current || !connected || !document || !nodeProto) { collector.unavailable(); return; }
    const active = () => runtime.hooks.enabled && !!runtime.apiResults.proSession;
    const read = (fn, receiver) => { try { return apply(fn, receiver, []); } catch { return null; } };
    const source = () => {
      const executing = read(current, document);
      if (executing && classify(read(scriptUrl, executing)) === 'google-tag-manager') return 'exact-resource';
      if (!collector.sample()) return null;
      // Never invoke page-installed stack accessors/formatters. A non-data stack is unsupported.
      if (!native(NativeError)) { collector.limited(); return null; }
      try {
        for (let keyIndex = 0; keyIndex < 2; keyIndex++) {
          const key = keyIndex === 0 ? 'prepareStackTrace' : 'stackTraceLimit';
          let object = NativeError, depth = 0;
          for (; object && depth < 8; depth++, object = getPrototype(object)) {
            const entry = descriptor(object, key);
            if (!entry) continue;
            if (!apply(hasOwn, entry, ['value']) || key === 'prepareStackTrace' && entry.value !== undefined || key === 'stackTraceLimit' && (typeof entry.value !== 'number' || entry.value < 0 || entry.value > 100)) { collector.limited(); return null; }
            break;
          }
          if (object && depth >= 8) { collector.limited(); return null; }
        }
        const stack = descriptor(new NativeError(), 'stack');
        if (!stack || typeof stack.value !== 'string') { collector.limited(); return null; }
        return stackSource(stack.value, collector) ? 'sampled-stack' : null;
      } catch { collector.limited(); return null; }
    };
    const prepareNode = node => {
      if (!active()) return null;
      const target = classify(read(scriptUrl, node));
      if (!target || target === 'google-tag-manager') return null;
      const confidence = source();
      return confidence ? { node, target, confidence, sessionId: runtime.apiResults.proSession } : null;
    };
    const attach = handle => { if (handle) { runtime.attach([handle]); if (handle.status !== 'installed') collector.unavailable(); } };
    for (const name of ['appendChild', 'insertBefore', 'replaceChild']) {
      const method = descriptor(nodeProto, name)?.value;
      if (!native(method)) { collector.unavailable(); continue; }
      attach(wrappers.wrapPreparedMethod(nodeProto, name, (_receiver, args) => prepareNode(args[0]), (state, _receiver, args, threw) => {
        runtime.observeSocialInsertedNode?.(args[0], threw);
        if (state && !threw && active() && state.sessionId === runtime.apiResults.proSession && read(connected, state.node) === true && classify(read(scriptUrl, state.node)) === state.target) collector.record(state.target, state.confidence, state.node);
      }, { context: runtime.hooks }));
    }
    const setter = descriptor(script, 'src')?.set;
    if (native(setter)) runtime.observeLoaderScriptSource = (receiver, args, threw) => {
      if (threw || !active() || typeof args[0] !== 'string' || read(connected, receiver) !== true) return;
      const state = prepareNode(receiver);
      if (state) collector.record(state.target, state.confidence, state.node, true);
    };
    else collector.unavailable();
  }
  return { classify, createCollector, stackSource, install };
}

export const loaderSensorRuntimeSource = '  // packages/sensors/src/pro-loader.ts\n  var loaderSensorSupport = (' + createLoaderSensorSupport.toString() + ')();\n\n';
// Node's standard URL is implemented in JavaScript; this adapter is only used by
// build-time imports/tests. The serialized browser call above has no adapter.
export const loaderSensorSupport = createLoaderSensorSupport(true);
