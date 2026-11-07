// REQ-002/004/005/011: bounded passive observations associated with DET-059 requests.
import { createSocialNetworkDetector } from '../../apps/production-extension/social-network-detector.js';

export function createSocialSensorSupport(detector, trustedNatives = false) {
  const apply = Reflect.apply, descriptor = Object.getOwnPropertyDescriptor, getPrototype = Object.getPrototypeOf;
  const NativeError = descriptor(globalThis, 'Error')?.value, NativeMap = Map, NativeWeakMap = WeakMap;
  const mapGet = Map.prototype.get, mapSet = Map.prototype.set, mapEach = Map.prototype.forEach;
  const weakGet = WeakMap.prototype.get, weakSet = WeakMap.prototype.set;
  const push = Array.prototype.push, slice = String.prototype.slice, indexOf = String.prototype.indexOf;
  const upper = String.prototype.toUpperCase, lower = String.prototype.toLowerCase, find = Array.prototype.find, hasOwn = Object.hasOwn;
  const exec = RegExp.prototype.exec, fnSource = Function.prototype.toString;
  const matches = (pattern, value) => apply(exec, pattern, [value]) !== null;
  const native = fn => typeof fn === 'function' && (trustedNatives || matches(/\[native code\]/, apply(fnSource, fn, [])));
  const ownValue = (object, key) => object && descriptor(object, key)?.value;
  function createCollector() {
    let rows = new NativeMap(), nodes = new NativeWeakMap(), nodeCount = 0, rowCount = 0, samples = 0, bytes = 512, truncated = !detector.ready, lastReadAt = -Infinity;
    return {
      reset() { rows = new NativeMap(); nodes = new NativeWeakMap(); nodeCount = 0; rowCount = 0; samples = 0; bytes = 512; truncated = !detector.ready; lastReadAt = -Infinity; },
      limited() { truncated = true; },
      sample() { if (samples >= 64) { truncated = true; return false; } samples++; return true; },
      record(match, source, node = null, force = false) {
        if (!match) return;
        const script = source?.script ?? null, confidence = script ? source.attributionConfidence : 'unknown';
        const key = match.service + '|' + match.kind + '|' + match.endpoint + '|' + match.method + '|' + match.requestType + '|' + confidence + '|' + (script?.host ?? '') + '|' + (script?.pathTemplate ?? '');
        if (node !== null && (typeof node === 'object' || typeof node === 'function')) {
          const previous = apply(weakGet, nodes, [node]);
          if (!force && previous === key) return;
          if (previous === undefined && nodeCount >= 512) { truncated = true; return; }
          if (previous === undefined) nodeCount++;
          apply(weakSet, nodes, [node, key]);
        }
        const previous = apply(mapGet, rows, [key]);
        if (previous) { if (previous.count < 2147483647) previous.count++; return; }
        const cost = 256 + key.length * 2;
        if (bytes + cost > 12000 || rowCount >= 64) { truncated = true; return; }
        bytes += cost; rowCount++;
        apply(mapSet, rows, [key, { ...match, count: 1, evidenceSource: 'page-hook', integrity: 'page-controlled', attributionConfidence: confidence, initiatorHost: null, script }]);
      },
      snapshot() {
        const output = [];
        apply(mapEach, rows, [row => apply(push, output, [{ ...row, script: row.script ? { ...row.script } : null }])]);
        return { rows: output, truncated };
      },
      handleControl(data, enabled, env) {
        if (!data || typeof data !== 'object' || ownValue(data, 'channel') !== 'detect.expert/social/v1' || ownValue(data, 'type') !== 'social-values-read') return;
        const requestId = ownValue(data, 'requestId');
        if (typeof requestId !== 'string' || !matches(/^social-[0-9]{1,10}$/, requestId)) return;
        const now = env.now();
        if (now - lastReadAt < 500) return;
        lastReadAt = now;
        const snapshot = enabled ? this.snapshot() : { rows: [], truncated: true };
        env.postMessage({ channel: 'detect.expert/social/v1', type: 'social-values-batch', requestId, enabled, rows: snapshot.rows, truncated: snapshot.truncated });
      },
    };
  }
  function stackSource(raw, collector) {
    if (typeof raw !== 'string') { collector.limited(); return null; }
    if (raw.length > 8192) collector.limited();
    const bounded = apply(slice, raw, [0, 8192]);
    let start = apply(indexOf, bounded, ['\n']) + 1;
    if (!start) return null;
    for (let index = 0; index < 8 && start < bounded.length; index++) {
      const next = apply(indexOf, bounded, ['\n', start]), end = next < 0 ? bounded.length : next;
      const line = apply(slice, bounded, [start, end]); start = end + 1;
      if (!matches(/^\s+at\s|^[^@]*@/, line)) continue;
      const found = apply(exec, /(?:^\s+at\s+|@|\()(https:\/\/[^\s)]+)\)?$/, [line]);
      if (!found) continue;
      const position = apply(exec, /:[0-9]+(?::[0-9]+)?$/, [found[1]]);
      if (!position) continue;
      const script = detector.script(apply(slice, found[1], [0, position.index]));
      if (script) return { script, attributionConfidence: 'sampled-stack' };
    }
    if (start < bounded.length) collector.limited();
    return null;
  }
  function install(runtime, realm, wrappers, nativeCheck = native) {
    const collector = runtime.apiResults.socialCollector;
    if (!detector.ready) { collector.limited(); return; }
    const prototype = key => ownValue(ownValue(realm, key), 'prototype');
    const getter = (object, key) => { const entry = object && descriptor(object, key); return typeof entry?.get === 'function' && nativeCheck(entry.get) ? entry.get : null; };
    const scriptPrototype = prototype('HTMLScriptElement'), nodePrototype = prototype('Node');
    const scriptURL = getter(scriptPrototype, 'src'), currentScript = getter(prototype('Document'), 'currentScript');
    const connected = getter(nodePrototype, 'isConnected'), nodeName = getter(nodePrototype, 'nodeName');
    let document;
    try { const entry = descriptor(realm, 'document'); document = entry?.value ?? (nativeCheck(entry?.get) ? apply(entry.get, realm, []) : null); } catch { collector.limited(); }
    const read = (fn, receiver) => { if (!fn) return null; try { return apply(fn, receiver, []); } catch { return null; } };
    let xhr = new NativeWeakMap(), xhrAdmissions = 0, generation = runtime.apiResults.generation;
    const active = () => {
      if (generation !== runtime.apiResults.generation) { generation = runtime.apiResults.generation; collector.reset(); xhr = new NativeWeakMap(); xhrAdmissions = 0; }
      return runtime.hooks.enabled;
    };
    const source = () => {
      const executing = read(currentScript, document), script = executing ? detector.script(read(scriptURL, executing)) : null;
      if (script) return { script, attributionConfidence: 'exact-resource' };
      if (!collector.sample() || !nativeCheck(NativeError)) { collector.limited(); return null; }
      try {
        for (const key of ['prepareStackTrace', 'stackTraceLimit']) {
          let object = NativeError;
          for (let depth = 0; object && depth < 8; depth++, object = getPrototype(object)) {
            const entry = descriptor(object, key);
            if (!entry) continue;
            if (!hasOwn(entry, 'value') || key === 'prepareStackTrace' && entry.value !== undefined || key === 'stackTraceLimit' && (typeof entry.value !== 'number' || entry.value < 0 || entry.value > 100)) { collector.limited(); return null; }
            break;
          }
        }
        const stack = descriptor(new NativeError(), 'stack');
        if (!stack || typeof stack.value !== 'string') { collector.limited(); return null; }
        return stackSource(stack.value, collector);
      } catch { collector.limited(); return null; }
    };
    const requestPrototype = prototype('Request'), requestURL = getter(requestPrototype, 'url'), requestMethod = getter(requestPrototype, 'method');
    const inputURL = input => {
      if (typeof input === 'string') return input;
      return read(requestURL, input);
    };
    const record = (raw, requestType, method, node = null, force = false) => {
      if (!active()) return;
      const match = detector.classify(raw, requestType, method);
      let attribution, attributed = false;
      const sharedSource = () => { if (!attributed) { attribution = source(); attributed = true; } return attribution; };
      if (match) collector.record(match, sharedSource(), node, force);
      runtime.observeBeaconRequest?.(raw, requestType, method, sharedSource, node, force);
    };
    runtime.observeSocialFetch = (args, threw) => {
      if (threw || !active()) return;
      // Options may be a Proxy or contain accessors. Even descriptor inspection
      // changes observable page semantics, so never inspect the options object.
      const method = args[1] === undefined || args[1] === null ? typeof args[0] === 'string' ? 'GET' : read(requestMethod, args[0]) : 'UNKNOWN';
      record(inputURL(args[0]), 'xmlhttprequest', typeof method === 'string' ? method : 'UNKNOWN');
    };
    runtime.observeSocialBeacon = (args, threw) => {
      if (!threw && active()) record(inputURL(args[0]), 'ping', 'POST');
    };
    runtime.observeSocialXhrOpen = (receiver, args, threw) => {
      if (!active() || receiver === null || typeof receiver !== 'object') return;
      runtime.observeBeaconXhrOpen?.(receiver, args, threw);
      const prior = apply(weakGet, xhr, [receiver]);
      if (prior === undefined && xhrAdmissions >= 512) { collector.limited(); return; }
      if (prior === undefined) xhrAdmissions++;
      const match = !threw && detector.classify(args[1], 'xmlhttprequest', typeof args[0] === 'string' ? apply(upper, args[0], []) : 'UNKNOWN');
      apply(weakSet, xhr, [receiver, match ? { match } : null]);
    };
    runtime.observeSocialXhrSend = (receiver, threw) => {
      if (threw || !active()) return;
      const value = apply(weakGet, xhr, [receiver]);
      let attribution, attributed = false;
      const sharedSource = () => { if (!attributed) { attribution = source(); attributed = true; } return attribution; };
      if (value) collector.record(value.match, sharedSource());
      runtime.observeBeaconXhrSend?.(receiver, sharedSource);
    };
    const urls = [
      ['HTMLImageElement', 'image'], ['HTMLScriptElement', 'script'], ['HTMLIFrameElement', 'sub_frame'],
    ].map(([name, type]) => ({ name, type, prototype: prototype(name), getter: getter(prototype(name), 'src') }));
    const nodeEntry = node => {
      const name = read(nodeName, node);
      return name === 'IMG' || name === 'img' ? urls[0] :
        name === 'SCRIPT' || name === 'script' ? urls[1] :
        name === 'IFRAME' || name === 'iframe' ? urls[2] : null;
    };
    runtime.observeSocialSource = (name, receiver, args, threw) => {
      if (threw || !active()) return;
      const selected = apply(find, urls, [entry => entry.name === name]);
      if (!selected || selected.type !== 'image' && read(connected, receiver) !== true) return;
      record(read(selected.getter, receiver), selected.type, 'GET', receiver, true);
    };
    runtime.observeSocialAttribute = (receiver, args, threw) => {
      if (threw || !active() || typeof args[0] !== 'string' || args[0].length !== 3 || apply(lower, args[0], []) !== 'src') return;
      const entry = nodeEntry(receiver);
      if (!entry || entry.type !== 'image' && read(connected, receiver) !== true) return;
      record(read(entry.getter, receiver), entry.type, 'GET', receiver, true);
    };
    runtime.observeSocialInsertedNode = (node, threw) => {
      if (threw || !active()) return;
      if (nodeName) {
        // Native Node branding rejects spoofed prototypes and bypasses own
        // nodeName/src getters. Ordinary DOM insertions need no throwing src
        // probes. XHTML names can be lowercase; no value is coerced.
        const entry = nodeEntry(node);
        if (!entry || read(connected, node) !== true) return;
        record(read(entry.getter, node), entry.type, 'GET', node);
        return;
      }
      // Compatibility fallback only when the native Node getter is absent.
      if (read(connected, node) !== true) return;
      for (const entry of urls) {
        const raw = read(entry.getter, node);
        if (raw !== null) { record(raw, entry.type, 'GET', node); return; }
      }
    };
    const attach = handle => { if (handle) { runtime.attach([handle]); if (handle.status !== 'installed') collector.limited(); } };
    const element = prototype('Element');
    if (nativeCheck(descriptor(element ?? {}, 'setAttribute')?.value)) attach(wrappers.wrapMethod(element, 'setAttribute', (receiver, args, threw) => runtime.observeSocialAttribute(receiver, args, threw), { context: runtime.hooks }));
    else collector.limited();
    const iframe = apply(find, urls, [entry => entry.name === 'HTMLIFrameElement']);
    if (nativeCheck(descriptor(iframe?.prototype ?? {}, 'src')?.set)) attach(wrappers.wrapSetter(iframe.prototype, 'src', (receiver, args, threw) => runtime.observeSocialSource('HTMLIFrameElement', receiver, args, threw), { context: runtime.hooks }));
    else collector.limited();
    if (nativeCheck(descriptor(realm, 'open')?.value)) attach(wrappers.wrapMethod(realm, 'open', (_receiver, args, threw) => { if (!threw) record(args[0], 'main_frame', 'GET'); }, { context: runtime.hooks }));
    else collector.limited();
    // CredentialsContainer.get is observed by the generic DET-059 family.
    // Its arbitrary options cannot be inspected safely or prove FedCM use.
    const login = prototype('NavigatorLogin');
    if (nativeCheck(descriptor(login ?? {}, 'setStatus')?.value)) attach(wrappers.wrapMethod(login, 'setStatus', (_receiver, _args, threw) => {
      if (!threw && active()) collector.record({ service: 'unknown', kind: 'login-status-api', endpoint: 'login-status', method: 'UNKNOWN', requestType: 'other' }, source());
    }, { context: runtime.hooks }));
    runtime.onStop(() => { collector.reset(); xhr = new NativeWeakMap(); xhrAdmissions = 0; });
    if (!document || !currentScript || !scriptURL || !connected) collector.limited();
  }
  return { createCollector, stackSource, install };
}

export const socialSensorRuntimeSource = '  // packages/sensors/src/social-network.ts\n  var socialNetworkDetector = (' + createSocialNetworkDetector.toString() + ')();\n  var socialSensorSupport = (' + createSocialSensorSupport.toString() + ')(socialNetworkDetector);\n\n';
export const socialSensorSupport = createSocialSensorSupport(createSocialNetworkDetector(true), true);
