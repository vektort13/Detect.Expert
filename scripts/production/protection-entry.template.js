// apps/extension/entrypoints/protection.main.ts
(() => {
  try {
    let apply2 = Reflect.apply, own = Object.getOwnPropertyDescriptor, hasOwn2 = Object.hasOwn, mark = /* @__PURE__ */ Symbol.for(PROTECTION_CHANNEL + "/__FEATURE__");
    if (own(globalThis, mark) !== void 0) return;
    Object.defineProperty(globalThis, mark, { __proto__: null, value: !0, configurable: !1 });
    let installation = installProtection(globalThis, "__FEATURE__"), post = window.postMessage, dataGetter = own(MessageEvent.prototype, "data")?.get, sourceGetter = own(MessageEvent.prototype, "source")?.get, clock = Date.now, lastReply = -1 / 0, field = (value, key) => {
      let descriptor = own(value, key);
      return descriptor && hasOwn2(descriptor, "value") ? descriptor.value : void 0;
    };
    window.addEventListener("message", (event) => {
      try {
        if (!dataGetter || !sourceGetter || apply2(sourceGetter, event, []) !== window) return;
        let data = apply2(dataGetter, event, []);
        if (typeof data != "object" || data === null || field(data, "channel") !== PROTECTION_CHANNEL) return;
        let type = field(data, "type");
        if (type === "protection-stop") installation.stop();
        else if (type === "protection-query") {
          let now = clock();
          if (now - lastReply < 250) return;
          lastReply = now, apply2(post, window, [{ channel: PROTECTION_CHANNEL, type: "protection-observation", observation: installation.snapshot() }, "*"]);
        }
      } catch {
      }
    });
  } catch {
  }
})();
