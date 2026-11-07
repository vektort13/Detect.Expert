// DET-049 / REQ-002/004/005/011: metadata only, serialized into both MAIN bundles.
// The existing Document.cookie accessor owner invokes observeCookieWrite once.
export function createCookieWriterSupport(detector, socialSupport, trustedNatives = false) {
  const apply = Reflect.apply, descriptor = Object.getOwnPropertyDescriptor, getPrototype = Object.getPrototypeOf;
  const NativeError = descriptor(globalThis, 'Error')?.value, NativeMap = Map;
  const mapGet = Map.prototype.get, mapSet = Map.prototype.set, mapEach = Map.prototype.forEach;
  const push = Array.prototype.push, slice = String.prototype.slice, charCode = String.prototype.charCodeAt;
  const exec = RegExp.prototype.exec, fnSource = Function.prototype.toString, hasOwn = Object.hasOwn, finite = Number.isFinite;
  const matches = (pattern, value) => apply(exec, pattern, [value]) !== null;
  const native = fn => typeof fn === 'function' && (trustedNatives || matches(/\[native code\]/, apply(fnSource, fn, [])));
  const own = (value, key) => value && (typeof value === 'object' || typeof value === 'function') ? descriptor(value, key)?.value : undefined;
  const validName = name => typeof name === 'string' && matches(/^[!#$%&'*+\-.^_\x60|~0-9A-Za-z]{1,256}$/, name);
  function cookieName(raw) {
    if (typeof raw !== 'string') return null;
    // Inspect at most 512 prefix code units. Never slice, decode or retain the value.
    const limit = raw.length < 512 ? raw.length : 512;
    let start = 0, end = -1;
    while (start < limit) { const code = apply(charCode, raw, [start]); if (code !== 32 && code !== 9) break; ++start; }
    for (let index = start; index < limit; ++index) {
      const code = apply(charCode, raw, [index]);
      if (code === 61) { end = index; break; }
      if (code === 59 || code < 32 && code !== 9 || code > 126) return null;
    }
    if (end < 0) return null;
    while (end > start) { const code = apply(charCode, raw, [end - 1]); if (code !== 32 && code !== 9) break; --end; }
    if (end - start > 256) return null;
    const name = apply(slice, raw, [start, end]);
    return validName(name) ? name : null;
  }
  function createCollector() {
    let rows = new NativeMap(), rowCount = 0, bytes = 512, samples = 0, truncated = !detector.ready, lastReadAt = -Infinity;
    return {
      reset() { rows = new NativeMap(); rowCount = 0; bytes = 512; samples = 0; truncated = !detector.ready; lastReadAt = -Infinity; },
      limited() { truncated = true; },
      sample() { if (samples >= 64) { truncated = true; return false; } ++samples; return true; },
      record(name, phase, source) {
        if (!validName(name) || phase !== 'returned-sync' && phase !== 'threw-sync') { truncated = true; return; }
        let script = null, confidence = 'unknown';
        const candidate = own(source, 'script'), attribution = own(source, 'attributionConfidence');
        if (candidate && (attribution === 'exact-resource' || attribution === 'sampled-stack')) {
          const host = own(candidate, 'host'), pathTemplate = own(candidate, 'pathTemplate');
          if (typeof host === 'string' && host.length <= 253 && matches(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/, host) && !matches(/\.\./, host) && typeof pathTemplate === 'string' && matches(/^\/(?:<script>|(?:main|client|script|sdk|gtm|fbevents|widgets|tracker|analytics)\.(?:js|mjs))$/, pathTemplate)) { script = { host, pathTemplate }; confidence = attribution; }
          else truncated = true;
        }
        const key = name.length + ':' + name + ':' + phase + ':' + confidence + ':' + (script ? script.host : '') + ':' + (script ? script.pathTemplate : '');
        const previous = apply(mapGet, rows, [key]);
        if (previous) { if (previous.count < 2147483647) ++previous.count; else truncated = true; return; }
        const cost = 512 + key.length * 2;
        if (rowCount >= 64 || bytes + cost > 24576) { truncated = true; return; }
        bytes += cost; ++rowCount;
        apply(mapSet, rows, [key, { name, phase, script, attributionConfidence: confidence, evidenceSource: 'page-hook', integrity: 'page-controlled', count: 1 }]);
      },
      snapshot() {
        const output = [];
        apply(mapEach, rows, [row => apply(push, output, [{ ...row, script: row.script ? { ...row.script } : null }])]);
        return { rows: output, truncated };
      },
      handleControl(data, enabled, env) {
        if (own(data, 'channel') !== 'detect.expert/cookie-writers/v1' || own(data, 'type') !== 'cookie-writers-read') return;
        const requestId = own(data, 'requestId');
        if (typeof requestId !== 'string' || !matches(/^cookie-writers-[0-9]{1,10}$/, requestId)) return;
        const now = env.now(); if (!finite(now) || now - lastReadAt < 500) return;
        lastReadAt = now;
        const snapshot = enabled ? this.snapshot() : { rows: [], truncated: true };
        env.postMessage({ channel: 'detect.expert/cookie-writers/v1', type: 'cookie-writers-batch', requestId, enabled, rows: snapshot.rows, truncated: snapshot.truncated });
      },
    };
  }
  function install(runtime, realm, nativeCheck = native) {
    const collector = runtime.apiResults.cookieWriterCollector;
    const prototype = key => own(own(realm, key), 'prototype');
    const getter = (object, key) => { const entry = object && descriptor(object, key); return typeof entry?.get === 'function' && nativeCheck(entry.get) ? entry.get : null; };
    const currentScript = getter(prototype('Document'), 'currentScript'), scriptURL = getter(prototype('HTMLScriptElement'), 'src');
    let document;
    try { const entry = descriptor(realm, 'document'); document = entry?.value ?? (nativeCheck(entry?.get) ? apply(entry.get, realm, []) : null); } catch { collector.limited(); }
    const read = (fn, receiver) => { if (!fn) return null; try { return apply(fn, receiver, []); } catch { return null; } };
    let generation = runtime.apiResults.generation;
    const active = () => {
      if (generation !== runtime.apiResults.generation) { generation = runtime.apiResults.generation; collector.reset(); }
      return runtime.hooks.enabled;
    };
    const source = () => {
      const executing = read(currentScript, document), script = executing ? detector.script(read(scriptURL, executing)) : null;
      if (script) return { script, attributionConfidence: 'exact-resource' };
      if (!collector.sample() || !nativeCheck(NativeError)) { collector.limited(); return null; }
      try {
        // The same bounded stack parser as Social; never invoke page formatters.
        for (let index = 0; index < 2; ++index) {
          const key = index === 0 ? 'prepareStackTrace' : 'stackTraceLimit';
          let object = NativeError, depth = 0;
          for (; object && depth < 8; ++depth, object = getPrototype(object)) {
            const entry = descriptor(object, key);
            if (!entry) continue;
            if (!hasOwn(entry, 'value') || key === 'prepareStackTrace' && entry.value !== undefined || key === 'stackTraceLimit' && (typeof entry.value !== 'number' || entry.value < 0 || entry.value > 100)) { collector.limited(); return null; }
            break;
          }
          if (object && depth >= 8) { collector.limited(); return null; }
        }
        const stack = descriptor(new NativeError(), 'stack');
        if (!stack || typeof stack.value !== 'string') { collector.limited(); return null; }
        return socialSupport.stackSource(stack.value, collector);
      } catch { collector.limited(); return null; }
    };
    runtime.observeCookieWrite = (receiver, args, threw) => {
      if (!active() || !document || receiver !== document) return;
      const name = cookieName(args[0]);
      if (name === null) { collector.limited(); return; }
      collector.record(name, threw ? 'threw-sync' : 'returned-sync', source());
    };
    runtime.onStop(() => collector.reset());
    if (!document || !currentScript || !scriptURL || !detector.ready) collector.limited();
  }
  return { cookieName, createCollector, install };
}

export const cookieWriterRuntimeSource = '  // packages/sensors/src/cookie-writers.ts\n  var cookieWriterSupport = (' + createCookieWriterSupport.toString() + ')(socialNetworkDetector, socialSensorSupport);\n\n';
