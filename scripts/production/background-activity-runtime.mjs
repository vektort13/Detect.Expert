// REQ-002/004/005/011: fixed passive background API labels, no Promise settlement.
import { createBackgroundActivityContracts } from '../../packages/contracts/src/background-activity.mjs';

export function createBackgroundResourceRedactor(trustedNatives = false) {
  const descriptor = Object.getOwnPropertyDescriptor, apply = Reflect.apply;
  const NativeURL = descriptor(globalThis, 'URL')?.value, fnString = Function.prototype.toString, exec = RegExp.prototype.exec;
  const native = value => typeof value === 'function' && (trustedNatives || apply(exec, /\[native code\]/, [apply(fnString, value, [])]) !== null);
  const getter = key => { const value = NativeURL && descriptor(NativeURL.prototype, key)?.get; return native(value) ? value : null; };
  const protocol = getter('protocol'), hostname = getter('hostname'), pathname = getter('pathname');
  const ready = native(NativeURL) && protocol && hostname && pathname;
  const basenames = ['sw.js', 'service-worker.js', 'worker.js', 'firebase-messaging-sw.js', 'main.js', 'app.js', 'bundle.js', 'sdk.js', 'gtm.js', 'fbevents.js', 'bat.js'];
  const slice = String.prototype.slice, lastIndex = String.prototype.lastIndexOf, includes = Array.prototype.includes;
  return (raw, base, kind = 'worker') => {
    if (!ready || typeof raw !== 'string' || raw.length > 16384 || typeof base !== 'string' && base !== undefined) return null;
    try {
      const url = new NativeURL(raw, base), scheme = apply(protocol, url, []), host = apply(hostname, url, []), path = apply(pathname, url, []);
      if (scheme !== 'https:' && scheme !== 'http:' || !host || host.length > 253 || apply(exec, /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/, [host]) === null || apply(exec, /\.\./, [host]) !== null) return null;
      const basename = apply(slice, path, [apply(lastIndex, path, ['/']) + 1]);
      const pathTemplate = kind === 'scope' ? path === '/' ? '/' : '/<scope>' : apply(includes, basenames, [basename]) ? '/' + basename : kind === 'script' ? '/<script>' : '/<worker>';
      return { host, pathTemplate };
    } catch { return null; }
  };
}

export function createBackgroundSensorSupport(contracts, redact, trustedNatives = false) {
  const apply = Reflect.apply, descriptor = Object.getOwnPropertyDescriptor, getPrototype = Object.getPrototypeOf, hasOwn = Object.hasOwn;
  const NativeMap = Map, mapGet = Map.prototype.get, mapSet = Map.prototype.set, mapEach = Map.prototype.forEach;
  const push = Array.prototype.push, includes = Array.prototype.includes, slice = String.prototype.slice, indexOf = String.prototype.indexOf, exec = RegExp.prototype.exec;
  const NativeError = descriptor(globalThis, 'Error')?.value, fnString = Function.prototype.toString;
  const match = (pattern, raw) => apply(exec, pattern, [raw]) !== null;
  const native = value => typeof value === 'function' && (trustedNatives || match(/\[native code\]/, apply(fnString, value, [])));
  const own = (value, key) => value && descriptor(value, key)?.value;
  function createCollector() {
    let rows = new NativeMap(), rowCount = 0, bytes = 256, truncated = false, samples = 0, lastRead = -Infinity;
    return {
      reset() { rows = new NativeMap(); rowCount = 0; bytes = 256; truncated = false; samples = 0; lastRead = -Infinity; },
      limited() { truncated = true; },
      sample() { if (samples >= 64) { truncated = true; return false; } ++samples; return true; },
      record(operation, phase, source, worker) {
        const script = source?.script ?? null, confidence = script ? source.attributionConfidence : 'unknown';
        const key = [operation, phase, confidence, script?.host ?? '', script?.pathTemplate ?? '', worker?.host ?? '', worker?.pathTemplate ?? ''].join('|');
        const previous = apply(mapGet, rows, [key]);
        if (previous) { if (previous.count < 2147483647) ++previous.count; return; }
        const cost = 192 + key.length * 2;
        if (rowCount >= 64 || bytes + cost > 12000) { truncated = true; return; }
        bytes += cost; ++rowCount;
        apply(mapSet, rows, [key, { operation, phase, count: 1, evidenceSource: 'page-hook', integrity: 'page-controlled', attributionConfidence: confidence, script, worker }]);
      },
      snapshot() { const output = []; apply(mapEach, rows, [row => apply(push, output, [{ ...row, script: row.script ? { ...row.script } : null, worker: row.worker ? { ...row.worker } : null }])]); return { rows: output, truncated }; },
      handleControl(data, enabled, env) {
        if (!data || typeof data !== 'object' || own(data, 'channel') !== 'detect.expert/background/v1' || own(data, 'type') !== 'background-values-read') return;
        const requestId = own(data, 'requestId'); if (typeof requestId !== 'string' || !match(/^background-[0-9]{1,10}$/, requestId)) return;
        const now = env.now(); if (now - lastRead < 500) return; lastRead = now;
        const snapshot = enabled ? this.snapshot() : { rows: [], truncated: true };
        env.postMessage({ channel: 'detect.expert/background/v1', type: 'background-values-batch', requestId, enabled, rows: snapshot.rows, truncated: snapshot.truncated });
      },
    };
  }
  function stackSource(raw, collector) {
    if (typeof raw !== 'string') return null;
    if (raw.length > 8192) collector.limited();
    const bounded = apply(slice, raw, [0, 8192]); let start = apply(indexOf, bounded, ['\n']) + 1;
    if (!start) return null;
    for (let index = 0; index < 8 && start < bounded.length; ++index) {
      const next = apply(indexOf, bounded, ['\n', start]), end = next < 0 ? bounded.length : next;
      const line = apply(slice, bounded, [start, end]); start = end + 1;
      const found = apply(exec, /(?:^\s+at\s+|@|\()(https?:\/\/[^\s)]+)\)?$/, [line]); if (!found) continue;
      const position = apply(exec, /:[0-9]+(?::[0-9]+)?$/, [found[1]]); if (!position) continue;
      const script = redact(apply(slice, found[1], [0, position.index]), undefined, 'script');
      if (script) return { script, attributionConfidence: 'sampled-stack' };
    }
    return null;
  }
  function install(runtime, realm, wrappers, nativeCheck = native) {
    const collector = runtime.apiResults.backgroundCollector;
    const prototype = key => own(own(realm, key), 'prototype');
    const getter = (target, key) => { const entry = target && descriptor(target, key); return nativeCheck(entry?.get) ? entry.get : null; };
    const currentScript = getter(prototype('Document'), 'currentScript'), scriptURL = getter(prototype('HTMLScriptElement'), 'src'), documentURL = getter(prototype('Document'), 'URL');
    let document, generation = runtime.apiResults.generation;
    try { const entry = descriptor(realm, 'document'); document = entry?.value ?? (nativeCheck(entry?.get) ? apply(entry.get, realm, []) : null); } catch { collector.limited(); }
    const read = (fn, receiver) => { if (!fn) return null; try { return apply(fn, receiver, []); } catch { return null; } };
    const source = () => {
      const executing = read(currentScript, document), script = executing ? redact(read(scriptURL, executing), undefined, 'script') : null;
      if (script) return { script, attributionConfidence: 'exact-resource' };
      if (!collector.sample() || !nativeCheck(NativeError)) return null;
      try {
        for (const key of ['prepareStackTrace', 'stackTraceLimit']) for (let object = NativeError, depth = 0; object && depth < 8; object = getPrototype(object), ++depth) {
          const entry = descriptor(object, key); if (!entry) continue;
          if (!hasOwn(entry, 'value') || key === 'prepareStackTrace' && entry.value !== undefined || key === 'stackTraceLimit' && (typeof entry.value !== 'number' || entry.value < 0 || entry.value > 100)) { collector.limited(); return null; }
          break;
        }
        return stackSource(descriptor(new NativeError(), 'stack')?.value, collector);
      } catch { collector.limited(); return null; }
    };
    runtime.observeBackgroundOperation = (label, args, threw) => {
      if (!runtime.hooks.enabled || !apply(includes, contracts.operations, [label])) return;
      if (generation !== runtime.apiResults.generation) { generation = runtime.apiResults.generation; collector.reset(); }
      const worker = label === 'ServiceWorkerContainer.register' && typeof args[0] === 'string' ? redact(args[0], read(documentURL, document) ?? undefined, 'worker') : null;
      collector.record(label, threw ? 'threw-sync' : 'async-returned', source(), worker);
    };
    const notification = own(realm, 'Notification');
    if (notification && nativeCheck(descriptor(notification, 'requestPermission')?.value)) {
      const handle = wrappers.wrapMethod(notification, 'requestPermission', (_receiver, args, threw) => runtime.observeBackgroundOperation('Notification.requestPermission', args, threw), { context: runtime.hooks });
      if (handle) runtime.attach([handle]);
      if (handle?.status !== 'installed') collector.limited();
    }
    runtime.onStop(() => collector.reset());
  }
  return { createCollector, install, stackSource, observes: label => apply(includes, contracts.operations, [label]) };
}

export const backgroundSensorRuntimeSource = '  // packages/sensors/src/background-activity.ts\n  var backgroundSensorContracts = (' + createBackgroundActivityContracts.toString() + ')();\n  var backgroundResourceRedactor = (' + createBackgroundResourceRedactor.toString() + ')();\n  var backgroundSensorSupport = (' + createBackgroundSensorSupport.toString() + ')(backgroundSensorContracts, backgroundResourceRedactor);\n  // packages/sensors/src/background-activity:end\n\n';
export const backgroundSensorSupport = createBackgroundSensorSupport(createBackgroundActivityContracts(), createBackgroundResourceRedactor(true), true);
