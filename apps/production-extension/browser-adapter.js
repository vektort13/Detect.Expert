// ADR-018 / REQ-004 / REQ-009. Firefox has a Promise API and an event-page background.
// Before Firefox 153, document identity comes from this extension's private ISOLATED realm.
// MAIN payloads never choose identities, frame IDs, destinations or privileged commands.
function createFirefoxAdapter(nativeApi, context) {
  const ENVELOPE = "__detectExpertIsolatedMessageV1";
  const RECIPIENT = "__detectExpertIsolatedRecipientV1";
  const ID = /^[A-Za-z0-9_-]{1,64}$/;
  const ownOrigin = nativeApi.runtime.getURL("").replace(/\/$/, "");
  const generations = new Map();
  const pending = new Map();
  const pendingCommits = new Set();
  const physicalIdentityJobs = new Set();
  const physicalPrecursorFrames = new Set();
  let nextGeneration = 0;
  const maxFrames = 128;
  function bounded(operation) {
    let timer;
    return Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("browser-operation-timeout")), 1500);
    })]).finally(() => clearTimeout(timer));
  }

  function isolatedIdentity() {
    const key = "__detectExpertIsolatedDocumentV1";
    if (!Object.hasOwn(globalThis, key)) {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      const token = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
      Object.defineProperty(globalThis, key, { value: token });
    }
    return globalThis[key];
  }
  const localIdentity = context === "bridge" ? isolatedIdentity() : null;
  const slot = (tabId, frameId) => tabId + ":" + frameId;
  const generation = (tabId, frameId) => generations.get(slot(tabId, frameId)) ?? 0;
  const validFrame = (frame) => frame && Number.isInteger(frame.frameId) && frame.frameId >= 0;
  const ownSender = (sender) => sender.id === nativeApi.runtime.id;
  const uiSender = (sender) => ownSender(sender) && (sender.origin === ownOrigin ||
    typeof sender.url === "string" && sender.url.startsWith(ownOrigin + "/"));

  async function identity(tabId, frameId) {
    const key = slot(tabId, frameId), before = generation(tabId, frameId), previous = pending.get(key);
    if (previous?.generation === before) return previous.promise;
    if (pending.size >= 256 || physicalIdentityJobs.size >= 256) throw new Error("document-identity-capacity");
    const physicalJob = nativeApi.scripting.executeScript({
      target: { tabId, frameIds: [frameId] }, world: "ISOLATED", func: isolatedIdentity,
    });
    physicalIdentityJobs.add(physicalJob);
    physicalJob.then(() => physicalIdentityJobs.delete(physicalJob), () => physicalIdentityJobs.delete(physicalJob));
    const state = { generation: before, promise: null };
    const job = bounded(physicalJob).then((results) => {
      if (generation(tabId, frameId) !== before) throw new Error("stale-document");
      const value = results.find((result) => result.frameId === frameId)?.result;
      if (typeof value !== "string" || !ID.test(value)) throw new Error("document-identity-unavailable");
      return value;
    }).finally(() => { if (pending.get(key) === state) pending.delete(key); });
    state.promise = job;
    pending.set(key, state);
    return job;
  }

  async function frames(tabId) {
    const raw = await bounded(nativeApi.webNavigation.getAllFrames({ tabId }));
    if (!Array.isArray(raw)) return raw;
    if (raw.length > maxFrames) throw new Error("frame-limit");
    const live = await Promise.all(raw.map(async (frame) => {
      if (!validFrame(frame)) return frame;
      const before = generation(tabId, frame.frameId);
      try {
        const documentId = await identity(tabId, frame.frameId);
        const current = await bounded(nativeApi.webNavigation.getFrame({ tabId, frameId: frame.frameId }));
        if (!current || current.url !== frame.url || before !== generation(tabId, frame.frameId)) return { ...frame, documentId: undefined };
        return { ...frame, documentId, frameType: frame.frameId === 0 ? "outermost_frame" : "sub_frame", documentLifecycle: "active" };
      } catch {
        return { ...frame, documentId: undefined };
      }
    }));
    return live.map((frame) => ({ ...frame,
      parentDocumentId: live.find((parent) => parent.frameId === frame.parentFrameId)?.documentId,
    }));
  }

  async function liveFrame(tabId, frameId, expectedId) {
    const before = generation(tabId, frameId);
    const current = await bounded(nativeApi.webNavigation.getFrame({ tabId, frameId }));
    if (!current) throw new Error("stale-document");
    const documentId = await identity(tabId, frameId);
    if (generation(tabId, frameId) !== before || expectedId !== undefined && documentId !== expectedId) throw new Error("stale-document");
    return { ...current, frameId, documentId, documentLifecycle: "active" };
  }

  // ADR-076: logical timeouts never release these physical native lookup slots.
  function precursorFrame({ tabId, frameId, documentId }) {
    if (!Number.isSafeInteger(tabId) || tabId < 0 || !Number.isSafeInteger(frameId) || frameId < 0 || typeof documentId !== "string" || !ID.test(documentId)) return Promise.reject(new Error("invalid-document"));
    if (physicalPrecursorFrames.size >= 4) return Promise.reject(new Error("document-identity-capacity"));
    const before = generation(tabId, frameId), job = Promise.resolve().then(() => nativeApi.webNavigation.getFrame({ tabId, frameId }));
    physicalPrecursorFrames.add(job);
    job.then(() => physicalPrecursorFrames.delete(job), () => physicalPrecursorFrames.delete(job));
    return bounded(job).then(async frame => {
      if (!frame || before !== generation(tabId, frameId)) throw new Error("stale-document");
      const actual = await identity(tabId, frameId);
      if (actual !== documentId || before !== generation(tabId, frameId)) throw new Error("stale-document");
      return { ...frame, frameId, documentId, documentLifecycle: "active" };
    });
  }

  const runtime = new Proxy(nativeApi.runtime, {
    get(target, property) {
      if (property === "sendMessage" && context === "bridge") return (message) => target.sendMessage({
        [ENVELOPE]: localIdentity, payload: message,
      });
      if (property === "onMessage") return {
        addListener(listener) {
          target.onMessage.addListener((message, sender, respond) => {
            if (context === "bridge") {
              if (message?.[RECIPIENT] !== undefined) {
                if (!ownSender(sender) || sender.tab !== undefined || message[RECIPIENT] !== localIdentity) return false;
                return listener(message.payload, sender, respond);
              }
              return listener(message, sender, respond);
            }
            if (context !== "background" || uiSender(sender)) return listener(message, sender, respond);
            // An extension-owned isolated context stamps messages outside the MAIN schema.
            // Missing metadata and delayed messages from a replaced document fail closed.
            if (!ownSender(sender) || !Number.isInteger(sender.tab?.id) || !Number.isInteger(sender.frameId) ||
                typeof message?.[ENVELOPE] !== "string" || !ID.test(message[ENVELOPE])) {
              respond({ schemaVersion: 1, type: "error", code: "unauthorized-sender" });
              return false;
            }
            liveFrame(sender.tab.id, sender.frameId, message[ENVELOPE]).then((frame) => {
              const trustedSender = { ...sender, documentId: frame.documentId, documentLifecycle: "active" };
              return listener(message.payload, trustedSender, respond);
            }).catch(() => respond({ schemaVersion: 1, type: "error", code: "unauthorized-sender" }));
            return true;
          });
        },
      };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  // Content contexts have no tabs/webNavigation/scripting API. Keep their surface narrow.
  if (context === "bridge") return new Proxy(nativeApi, {
    get(target, property) { return property === "runtime" ? runtime : Reflect.get(target, property); },
  });

  // The wrapper keeps the native callback it registered for every page listener, so removeListener and hasListener behave like the native event: the Options
  // page removes its Detector listeners when a section closes, and a missing removeListener threw there and left the next section on its loading state.
  const navigationRegistrations = new Map(), webRequestRegistrations = new Map();
  const registrationsOf = (store, property) => store.get(property) ?? store.set(property, new Map()).get(property);
  const navigation = new Proxy(nativeApi.webNavigation, {
    get(target, property) {
      if (property === "getAllFrames") return ({ tabId }) => frames(tabId);
      if (typeof property === "string" && property.startsWith("on") && target[property]) return {
        addListener(listener, ...args) {
          const registered = registrationsOf(navigationRegistrations, property);
          // A native event ignores the same function added twice.
          if (registered.has(listener)) return;
          const registration = { active: true, owner: {}, native: null }, commitOwner = registration.owner;
          registration.native = (details) => {
            if (!registration.active) return;
            if (property === "onBeforeNavigate") {
              if (generations.size >= 2048) generations.clear();
              generations.set(slot(details.tabId, details.frameId), ++nextGeneration);
              for (const commit of pendingCommits) if (commit.slot === slot(details.tabId, details.frameId)) commit.invalid = true;
              listener(details);
              return;
            }
            if (property === "onErrorOccurred") {
              for (const commit of pendingCommits) if (commit.slot === slot(details.tabId, details.frameId)) commit.invalid = true;
              listener(details);
              return;
            }
            const before = generation(details.tabId, details.frameId);
            // Firefox may deliver COOP onCommitted before getFrame/executeScript
            // see the replacement process. Retry only this native commit, bound
            // to the same navigation generation and exact URL, with a small cap.
            const key = slot(details.tabId, details.frameId), commit = property === "onCommitted" ? { slot: key, owner: commitOwner, invalid: false } : null;
            if (commit) {
              for (const previous of pendingCommits) if (previous.slot === key && previous.owner === commitOwner) previous.invalid = true;
              // Cancelled waits retain their slot until they settle, preventing
              // repeated navigation from freeing unbounded retry timers.
              if (pendingCommits.size >= 128) return;
              pendingCommits.add(commit);
            }
            const current = () => registration.active && before === generation(details.tabId, details.frameId) && (!commit || !commit.invalid && pendingCommits.has(commit));
            const normalize = async () => {
              const delays = commit ? [0, 50, 150, 300] : [0];
              for (const delay of delays) {
                if (delay) await new Promise(resolve => setTimeout(resolve, delay));
                if (!current()) return null;
                try {
                  const frame = await liveFrame(details.tabId, details.frameId);
                  if (!current()) return null;
                  if (frame.url === details.url) return frame;
                } catch { if (!current()) return null; }
              }
              return null;
            };
            normalize().then(async (frame) => {
              if (!frame || !current()) return;
              if (before !== generation(details.tabId, details.frameId) || frame.url !== details.url) return;
              let parentDocumentId;
              if (frame.parentFrameId >= 0) {
                try { parentDocumentId = (await liveFrame(details.tabId, frame.parentFrameId)).documentId; } catch {}
              }
              if (!current()) return;
              return listener({ ...details, documentId: frame.documentId, parentDocumentId,
                parentFrameId: frame.parentFrameId,
                frameType: details.frameId === 0 ? "outermost_frame" : "sub_frame", documentLifecycle: "active",
              });
            }).catch(() => {
              // Native observer callbacks are passive; failed normalization is never admitted.
            }).finally(() => { if (commit) pendingCommits.delete(commit); });
          };
          target[property].addListener(registration.native, ...args);
          registered.set(listener, registration);
        },
        removeListener(listener) {
          const registered = registrationsOf(navigationRegistrations, property), registration = registered.get(listener);
          if (!registration) return;
          registered.delete(listener);
          registration.active = false;
          for (const commit of pendingCommits) if (commit.owner === registration.owner) commit.invalid = true;
          target[property].removeListener?.(registration.native);
        },
        hasListener(listener) { return registrationsOf(navigationRegistrations, property).has(listener); },
      };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  const tabs = new Proxy(nativeApi.tabs, {
    get(target, property) {
      if (property === "onReplaced" && !target.onReplaced) return { addListener() {}, removeListener() {}, hasListener() { return false; } };
      if (property === "sendMessage") return async (tabId, message, options) => {
        if (!options?.documentId) return target.sendMessage(tabId, message, options);
        const frameId = options.frameId ?? (await frames(tabId))?.find((frame) => frame.documentId === options.documentId)?.frameId;
        if (!Number.isInteger(frameId)) throw new Error("stale-document");
        if (message?.type === 'precursor-timing-query' || message?.type === 'precursor-timing-reset') await precursorFrame({ tabId, frameId, documentId: options.documentId });
        else await liveFrame(tabId, frameId, options.documentId);
        return target.sendMessage(tabId, { [RECIPIENT]: options.documentId, payload: message }, { frameId });
      };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  const scripting = new Proxy(nativeApi.scripting, {
    get(target, property) {
      if (property === "executeScript") return (injection) => {
        // Pre-153 Firefox cannot atomically target a document during navigation. Registered
        // document_start hooks remain available; late file injection fails closed.
        if (injection.target?.documentIds) return Promise.reject(new Error("document-targeted-injection-unsupported"));
        return target.executeScript(injection);
      };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  const webRequest = new Proxy(nativeApi.webRequest, {
    get(target, property) {
      if (target[property]?.addListener) return {
        addListener(listener, filter, extra) {
          const registered = registrationsOf(webRequestRegistrations, property);
          if (registered.has(listener)) return;
          const firefoxExtra = extra?.filter((value) => value !== "extraHeaders");
          const wrapped = (details) => {
            // Firefox <153 supplies no authoritative source-document ID for requests.
            // Keep resource logs, but do not invent per-document network attribution.
            const { documentId, parentDocumentId, ...rest } = details;
            return listener(rest);
          };
          if (firefoxExtra) target[property].addListener(wrapped, filter, firefoxExtra);
          else target[property].addListener(wrapped, filter);
          registered.set(listener, wrapped);
        },
        removeListener(listener) {
          const registered = registrationsOf(webRequestRegistrations, property), wrapped = registered.get(listener);
          if (!wrapped) return;
          registered.delete(listener);
          target[property].removeListener?.(wrapped);
        },
        hasListener(listener) { return registrationsOf(webRequestRegistrations, property).has(listener); },
      };
      return Reflect.get(target, property);
    },
  });
  return new Proxy(nativeApi, {
    get(target, property) {
      if (property === "__detectExpertCapabilities") return Object.freeze({ networkDocumentIdentity: false, exactDocumentInjection: false });
      // ADR-076: bounded native/private-ISOLATED identity for one existing frame.
      if (property === "__detectExpertResolveDocument") return precursorFrame;
      if (property === "runtime") return runtime;
      if (property === "webNavigation") return navigation;
      if (property === "tabs") return tabs;
      if (property === "scripting") return scripting;
      if (property === "webRequest") return webRequest;
      if (property === "sidePanel") return { open: () => nativeApi.sidebarAction.open() };
      return Reflect.get(target, property);
    },
  });
}
