// ADR-064: generated document-start opaque protocol guard.
"use strict";
(() => {
  // apps/production-extension/antidetect-block-runtime.js
  function installAntidetectBlocks(realm, entries) {
    const previous = installAntidetectBlocks.__detectExpertBlockIntrinsics;
    const intrinsics = previous || {
      getOwn: Object.getOwnPropertyDescriptor,
      getPrototype: Object.getPrototypeOf,
      define: Object.defineProperty,
      freeze: Object.freeze,
      isArray: Array.isArray,
      NativeDOMException: DOMException
    };
    if (!previous) intrinsics.define(installAntidetectBlocks, "__detectExpertBlockIntrinsics", { __proto__: null, value: intrinsics.freeze(intrinsics) });
    const { getOwn, getPrototype, define, isArray, NativeDOMException } = intrinsics;
    const LIMIT = 65535, rows = [], selected = { __proto__: null };
    const state = { installed: 0, removed: 0, unavailable: 0, blocked: 0 };
    function own(target, key) {
      if (target === null || typeof target !== "object" && typeof target !== "function") return void 0;
      return getOwn(target, key)?.value;
    }
    function descriptor(target, key) {
      for (let depth = 0; target !== null && target !== void 0 && depth < 16; depth++, target = getPrototype(target)) {
        const field = getOwn(target, key);
        if (field) return { target, field };
      }
      return null;
    }
    function increment(row, key) {
      if (row[key] < LIMIT) row[key]++;
      if (state[key] < LIMIT) state[key]++;
    }
    function push(array, value) {
      define(array, array.length, { __proto__: null, value, enumerable: true, configurable: true, writable: true });
    }
    if (isArray(entries)) for (let index = 0; index < entries.length && index < 512; index++) {
      const entry = entries[index], id = own(entry, "id");
      if (own(entry, "mode") === "on" && (id === "webrtc" || id === "websocket" || id === "webtransport")) selected[id] = true;
    }
    const errorType = own(realm, "DOMException");
    const Denial = typeof errorType === "function" ? errorType : NativeDOMException;
    const transportConstructor = "WebTransport";
    const features = [
      ["webrtc", ["RTCPeerConnection", "webkitRTCPeerConnection", "mozRTCPeerConnection"]],
      ["websocket", ["WebSocket", "WebSocketStream"]],
      ["webtransport", [transportConstructor]]
    ];
    for (let index = 0; index < features.length; index++) {
      const id = features[index][0], names = features[index][1];
      if (selected[id] !== true) continue;
      const row = { id, installed: 0, removed: 0, unavailable: 0, blocked: 0 };
      push(rows, row);
      let present = false;
      for (let item = 0; item < names.length; item++) {
        let blockedAntidetectConstructor2 = function() {
          increment(row, "blocked");
          throw new Denial("Blocked by detect.expert", "SecurityError");
        };
        var blockedAntidetectConstructor = blockedAntidetectConstructor2;
        const name = names[item];
        let found;
        try {
          found = descriptor(realm, name);
        } catch {
          increment(row, "unavailable");
          continue;
        }
        if (!found) continue;
        const original = found.field.value;
        if (typeof original !== "function") {
          if (found.field.get !== void 0 || found.field.set !== void 0) {
            present = true;
            try {
              if (!found.field.configurable) throw 0;
              define(found.target, name, {
                __proto__: null,
                value: void 0,
                configurable: true,
                enumerable: found.field.enumerable === true,
                writable: true
              });
              increment(row, "installed");
              increment(row, "removed");
            } catch {
              increment(row, "unavailable");
            }
          }
          continue;
        }
        present = true;
        const prototype = own(original, "prototype");
        if (prototype !== null && (typeof prototype === "object" || typeof prototype === "function")) {
          try {
            const constructor = getOwn(prototype, "constructor");
            if (!constructor || constructor.configurable || constructor.writable === true) {
              define(prototype, "constructor", {
                __proto__: null,
                configurable: constructor?.configurable ?? true,
                enumerable: constructor?.enumerable ?? false,
                writable: constructor?.writable ?? true,
                value: blockedAntidetectConstructor2
              });
              increment(row, "installed");
            } else increment(row, "unavailable");
          } catch {
            increment(row, "unavailable");
          }
        }
        try {
          if (found.field.configurable || found.field.writable) {
            define(found.target, name, { __proto__: null, ...found.field, value: void 0 });
            increment(row, "installed");
            increment(row, "removed");
          } else increment(row, "unavailable");
        } catch {
          increment(row, "unavailable");
        }
      }
      if (!present) increment(row, "unavailable");
    }
    return {
      snapshot() {
        const features2 = [];
        for (let index = 0; index < rows.length; index++) push(features2, { ...rows[index] });
        return { ...state, features: features2 };
      }
    };
  }

  // apps/production-extension/antidetect-block-opaque.entry.js
  if (["about:", "blob:", "data:"].includes(globalThis.location?.protocol)) {
    const marker = /* @__PURE__ */ Symbol.for("detect.expert/api-custom/document/v2");
    if (Object.getOwnPropertyDescriptor(globalThis, marker)?.value !== true) installAntidetectBlocks(globalThis, [{ id: "webrtc", mode: "on" }]);
  }
})();
