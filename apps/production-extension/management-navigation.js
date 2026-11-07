// Generated from production-protect/src/ui/management-navigation.ts; do not edit.
const SECTIONS = /* @__PURE__ */ new Set(["hub", "firewall", "api", "antidetect", "settings", "browser-debug", "cookies", "autosurf", "proxy", "contacts", "protect", "history", "requests"]);
const MAX_CONTEXTS = 1024;
const MAX_PENDING = 16;
const LOCK_NAME = "detect.expert/management-navigation/v1";
const queues = /* @__PURE__ */ new WeakMap();
function validTabId(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 2147483647;
}
function ownOptions(raw, base) {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  try {
    const url = new URL(raw);
    return url.protocol === base.protocol && url.host === base.host && url.pathname === "/options.html" && url.username === "" && url.password === "" ? url : null;
  } catch {
    return null;
  }
}
function existingTarget(url) {
  const values = url?.searchParams.getAll("tabId") ?? [];
  if (values.length !== 1 || !/^(0|[1-9][0-9]{0,9})$/.test(values[0] ?? "")) return null;
  const value = Number(values[0]);
  return validTabId(value) ? value : null;
}
function destination(base, section, tabId, current) {
  const url = new URL("options.html", base);
  const target = section === "api" || section === "antidetect" ? tabId : existingTarget(current);
  if (target !== null) url.searchParams.set("tabId", String(target));
  url.hash = section;
  return url.href;
}
async function candidates(api, base) {
  if (typeof api.runtime.getContexts === "function") {
    const contexts = await api.runtime.getContexts({ contextTypes: ["TAB"] });
    if (!Array.isArray(contexts) || contexts.length > MAX_CONTEXTS) throw new Error("management-context-budget");
    const own = base.protocol + "//" + base.host;
    return contexts.flatMap((context) => {
      const url = ownOptions(context.documentUrl, base);
      return context.contextType === "TAB" && context.frameId === 0 && context.documentOrigin === own && validTabId(context.tabId) && validTabId(context.windowId) && url !== null ? [{ tabId: context.tabId, windowId: context.windowId, url, context: true }] : [];
    });
  }
  if (typeof api.tabs.query !== "function") return [];
  const tabs = await api.tabs.query({ url: new URL("options.html", base).href + "*" });
  if (!Array.isArray(tabs) || tabs.length > MAX_CONTEXTS) throw new Error("management-tab-budget");
  return tabs.flatMap((tab) => {
    const url = ownOptions(tab.pendingUrl ?? tab.url, base);
    return validTabId(tab.id) && validTabId(tab.windowId) && url !== null ? [{ tabId: tab.id, windowId: tab.windowId, url, context: false }] : [];
  });
}
async function currentCandidate(api, base, candidate) {
  let tab;
  try {
    tab = await api.tabs.get(candidate.tabId);
  } catch {
    return null;
  }
  if (tab.id !== candidate.tabId || tab.windowId !== candidate.windowId) return null;
  let raw = tab.pendingUrl ?? tab.url;
  if (typeof raw === "string") {
    const url2 = ownOptions(raw, base);
    return url2 === null ? null : { tab, url: url2 };
  }
  if (!candidate.context) return null;
  const contexts = await api.runtime.getContexts({ contextTypes: ["TAB"], tabIds: [candidate.tabId], frameIds: [0] });
  if (!Array.isArray(contexts) || contexts.length > MAX_CONTEXTS) return null;
  const own = base.protocol + "//" + base.host;
  const matches = contexts.filter((context) => context.contextType === "TAB" && context.frameId === 0 && context.tabId === candidate.tabId && context.windowId === candidate.windowId && context.documentOrigin === own && ownOptions(context.documentUrl, base) !== null);
  if (matches.length !== 1) return null;
  try {
    tab = await api.tabs.get(candidate.tabId);
  } catch {
    return null;
  }
  if (tab.id !== candidate.tabId || tab.windowId !== candidate.windowId) return null;
  raw = tab.pendingUrl ?? tab.url;
  const url = typeof raw === "string" ? ownOptions(raw, base) : ownOptions(matches[0]?.documentUrl, base);
  return url === null ? null : { tab, url };
}
async function navigate(section, tabId, api) {
  try {
    const base = new URL(api.runtime.getURL(""));
    if (!["chrome-extension:", "moz-extension:"].includes(base.protocol) || base.host === "" || base.username !== "" || base.password !== "") return false;
    const seen = /* @__PURE__ */ new Set();
    const found = (await candidates(api, base)).sort((a, b) => a.tabId - b.tabId);
    for (const candidate of found) {
      if (seen.has(candidate.tabId)) continue;
      seen.add(candidate.tabId);
      const current = await currentCandidate(api, base, candidate);
      if (current === null) continue;
      await api.tabs.update(candidate.tabId, { url: destination(base, section, tabId, current.url), active: true });
      if (typeof api.windows?.update === "function") await api.windows.update(current.tab.windowId, { focused: true });
      return true;
    }
    let windowId;
    if (typeof api.windows?.getLastFocused === "function") {
      try {
        const window = await api.windows.getLastFocused({ windowTypes: ["normal"] });
        if (window.type === "normal" && validTabId(window.id)) windowId = window.id;
      } catch {
      }
    }
    const made = await api.tabs.create({ url: destination(base, section, tabId, null), active: true, ...windowId === void 0 ? {} : { windowId } });
    const focus = made?.windowId ?? windowId;
    if (validTabId(focus) && typeof api.windows?.update === "function") await api.windows.update(focus, { focused: true });
    if (validTabId(made?.id) && typeof api.runtime.getContexts === "function") {
      let ready = false;
      for (const delay of [0, 20, 50, 100, 200, 400, 800, 1200]) {
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
        if ((await candidates(api, base)).some((candidate) => candidate.tabId === made.id)) {
          ready = true;
          break;
        }
      }
      if (!ready) return false;
    }
    return true;
  } catch {
    return false;
  }
}
function serial(browserApi, action) {
  let queue = queues.get(browserApi);
  if (queue === void 0) {
    queue = { tail: Promise.resolve(), count: 0 };
    queues.set(browserApi, queue);
  }
  if (queue.count >= MAX_PENDING) return Promise.resolve(false);
  queue.count++;
  const run = queue.tail.then(async () => {
    const locks = globalThis.navigator?.locks;
    if (typeof locks?.request === "function") {
      try {
        return await locks.request(LOCK_NAME, action);
      } catch {
        return false;
      }
    }
    return action();
  });
  queue.tail = run.then(() => void 0, () => void 0);
  return run.finally(() => {
    queue.count--;
  });
}
function openManagement(section, tabId = null, browserApi = chrome) {
  if (!SECTIONS.has(section) || tabId !== null && !validTabId(tabId) || browserApi === null || typeof browserApi !== "object") return Promise.resolve(false);
  return serial(browserApi, () => navigate(section, tabId, browserApi));
}
async function adoptManagementEntry(browserApi = chrome) {
  if (browserApi === null || typeof browserApi !== "object") return true;
  let entryWindow, entryDocument, entryHref;
  try {
    entryWindow = globalThis.window;
    if (entryWindow !== entryWindow.top) return true;
    entryDocument = entryWindow.document;
    entryHref = entryWindow.location.href;
    const base = new URL(browserApi.runtime.getURL(""));
    const url = ownOptions(entryHref, base);
    if (!["chrome-extension:", "moz-extension:"].includes(base.protocol) || url === null || url.search !== "" || url.hash !== "") return true;
  } catch {
    return true;
  }
  let forwarded = false;
  await serial(browserApi, async () => {
    try {
      const base = new URL(browserApi.runtime.getURL(""));
      const initial = await browserApi.tabs.getCurrent();
      if (!validTabId(initial?.id) || !validTabId(initial.windowId)) return true;
      const ownEntry = { tabId: initial.id, windowId: initial.windowId, url: new URL(entryHref), context: typeof browserApi.runtime.getContexts === "function" };
      const remainsEntry = async () => {
        if (entryWindow.closed || entryWindow.document !== entryDocument || entryWindow.location.href !== entryHref) return false;
        const current = await currentCandidate(browserApi, base, ownEntry);
        return current !== null && current.url.search === "" && current.url.hash === "" && !entryWindow.closed && entryWindow.document === entryDocument && entryWindow.location.href === entryHref;
      };
      if (!await remainsEntry()) return true;
      const found = (await candidates(browserApi, base)).filter((candidate) => candidate.tabId < ownEntry.tabId).sort((a, b) => a.tabId - b.tabId);
      for (const candidate of found) {
        if (!await remainsEntry()) return true;
        const winner = await currentCandidate(browserApi, base, candidate);
        if (winner === null) continue;
        await browserApi.tabs.update(candidate.tabId, { url: destination(base, "hub", null, winner.url), active: true });
        if (typeof browserApi.windows?.update === "function") await browserApi.windows.update(winner.tab.windowId, { focused: true });
        if (!await remainsEntry()) return true;
        entryWindow.close();
        forwarded = entryWindow.closed;
        return !forwarded;
      }
      return true;
    } catch {
      return true;
    }
  });
  return !forwarded;
}
export {
  adoptManagementEntry,
  openManagement
};
