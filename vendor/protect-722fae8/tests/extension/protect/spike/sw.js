// Throwaway ADR-020 spike service worker (tests/extension/protect/spike). Not part of any build or profile.
// spike.spec.ts calls the functions on globalThis.spike through Playwright's worker.evaluate and records what
// Chrome actually does. Synthetic fixtures only; events keep the request shape (case, host, type, method,
// body kind and byte counts), never body content or header values other than Sec-GPC.
'use strict';

const BOOT = Math.random().toString(36).slice(2, 10);
const DNR_PERMISSION = 'declarativeNetRequestWithHostAccess';
const MAX_EVENTS = 5000;
const events = [];
const permissionEvents = [];
const handles = new Map();
let nextHandle = 1;

function caseOf(url) {
  try {
    const u = new URL(url);
    return u.searchParams.get('case') || u.pathname;
  } catch {
    return 'bad-url';
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function bodyShape(rb) {
  if (!rb) return { kind: 'none' };
  if (rb.error) return { kind: 'error', error: String(rb.error) };
  if (rb.formData) {
    let values = 0;
    for (const k of Object.keys(rb.formData)) values += Array.isArray(rb.formData[k]) ? rb.formData[k].length : 0;
    return { kind: 'formData', keys: Object.keys(rb.formData).length, values };
  }
  if (Array.isArray(rb.raw)) {
    let bytes = 0;
    let withBytes = 0;
    let files = 0;
    let empty = 0;
    for (const part of rb.raw) {
      if (part && part.bytes) {
        withBytes++;
        bytes += part.bytes.byteLength;
      } else if (part && part.file !== undefined) files++;
      else empty++;
    }
    return { kind: 'raw', parts: rb.raw.length, withBytes, bytes, files, empty };
  }
  return { kind: 'other', keys: Object.keys(rb) };
}

function gpcOf(headers) {
  if (!Array.isArray(headers)) return 'no-headers';
  for (const h of headers) if (String(h.name).toLowerCase() === 'sec-gpc') return 'value:' + String(h.value);
  return 'absent';
}

function record(label, ev, d, extra) {
  if (events.length >= MAX_EVENTS) return;
  events.push({
    l: label,
    e: ev,
    c: caseOf(d.url),
    host: hostOf(d.url),
    scheme: d.url.split(':')[0],
    type: d.type,
    method: d.method,
    tabId: d.tabId,
    frameId: d.frameId,
    initiator: d.initiator ? hostOf(d.initiator) : null,
    requestId: d.requestId,
    ...extra,
  });
}

function addListener(event, fn, filter, spec) {
  if (spec.length > 0) chrome.webRequest[event].addListener(fn, filter, spec);
  else chrome.webRequest[event].addListener(fn, filter);
}

function errorText(e) {
  return e && typeof e.message === 'string' ? e.message : String(e);
}

/** Runs fn; a promise that never settles is reported as `timeout` instead of hanging the caller. */
async function attempt(fn, ms = 5000) {
  let timer;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout ' + ms + ' ms')), ms);
    });
    return { ok: true, value: await Promise.race([Promise.resolve().then(fn), timeout]) };
  } catch (e) {
    return { ok: false, error: errorText(e) };
  } finally {
    clearTimeout(timer);
  }
}

function dnr() {
  return chrome.declarativeNetRequest;
}

chrome.permissions.onAdded.addListener((p) => {
  permissionEvents.push({ e: 'added', permissions: p.permissions || [], origins: p.origins || [], dnrNow: typeof dnr() });
});
chrome.permissions.onRemoved.addListener((p) => {
  permissionEvents.push({ e: 'removed', permissions: p.permissions || [], origins: p.origins || [], dnrNow: typeof dnr() });
});
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'spike-ping') sendResponse({ boot: BOOT });
  return false;
});

globalThis.spike = {
  boot: BOOT,
  ping() {
    return BOOT;
  },
  manifest() {
    const m = chrome.runtime.getManifest();
    return { optional_permissions: m.optional_permissions || [], permissions: m.permissions || [] };
  },
  permissionEvents() {
    return permissionEvents.slice();
  },
  events(label) {
    return events.filter((x) => label === undefined || x.l === label).map((x) => ({ ...x }));
  },
  clear() {
    events.length = 0;
    permissionEvents.length = 0;
  },
  /** opts: {beforeRequest?: 'body'|'plain', sendHeaders?: 'headers'|'plain', errors?, completed?, tabId?, types?, urls?} */
  listen(label, opts) {
    const filter = { urls: opts.urls || ['http://*/*', 'https://*/*'] };
    if (typeof opts.tabId === 'number') filter.tabId = opts.tabId;
    if (Array.isArray(opts.types)) filter.types = opts.types;
    const list = [];
    const add = (event, spec, fn) => {
      addListener(event, fn, filter, spec);
      list.push([event, fn]);
    };
    if (opts.beforeRequest === 'body') add('onBeforeRequest', ['requestBody'], (d) => record(label, 'before', d, { body: bodyShape(d.requestBody) }));
    if (opts.beforeRequest === 'plain') add('onBeforeRequest', [], (d) => record(label, 'before', d, {}));
    if (opts.sendHeaders === 'headers') add('onSendHeaders', ['requestHeaders'], (d) => record(label, 'send', d, { gpc: gpcOf(d.requestHeaders) }));
    if (opts.sendHeaders === 'plain') add('onSendHeaders', [], (d) => record(label, 'send', d, {}));
    if (opts.errors) add('onErrorOccurred', [], (d) => record(label, 'error', d, { error: d.error }));
    if (opts.completed) add('onCompleted', [], (d) => record(label, 'completed', d, { status: d.statusCode }));
    const id = nextHandle++;
    handles.set(id, list);
    return id;
  },
  unlistenAll() {
    let n = 0;
    for (const list of handles.values()) {
      for (const [event, fn] of list) {
        chrome.webRequest[event].removeListener(fn);
        n++;
      }
    }
    handles.clear();
    return n;
  },
  dnrInfo() {
    const d = dnr();
    if (!d) return { type: typeof d };
    const keys = d.RuleConditionKeys ? Object.values(d.RuleConditionKeys) : null;
    return {
      type: typeof d,
      ruleConditionKeys: keys,
      maxDynamic: d.MAX_NUMBER_OF_DYNAMIC_RULES ?? null,
      maxUnsafeDynamic: d.MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES ?? null,
      maxSession: d.MAX_NUMBER_OF_SESSION_RULES ?? null,
      maxUnsafeSession: d.MAX_NUMBER_OF_UNSAFE_SESSION_RULES ?? null,
      resourceTypes: d.ResourceType ? Object.values(d.ResourceType) : null,
    };
  },
  async getRules() {
    const d = dnr();
    if (!d) return { ok: false, error: 'declarativeNetRequest undefined' };
    return attempt(async () => ({
      dynamic: (await d.getDynamicRules()).map((r) => r.id),
      session: (await d.getSessionRules()).map((r) => r.id),
    }));
  },
  /** Replaces every dynamic and session rule of the spike with the given lists. */
  async setRules(dynamic, session) {
    const d = dnr();
    if (!d) return { ok: false, error: 'declarativeNetRequest undefined' };
    return attempt(async () => {
      const t0 = performance.now();
      const oldDynamic = (await d.getDynamicRules()).map((r) => r.id);
      const oldSession = (await d.getSessionRules()).map((r) => r.id);
      const t1 = performance.now();
      await d.updateDynamicRules({ removeRuleIds: oldDynamic, addRules: dynamic || [] });
      const t2 = performance.now();
      await d.updateSessionRules({ removeRuleIds: oldSession, addRules: session || [] });
      const t3 = performance.now();
      return { dynamic: (dynamic || []).length, session: (session || []).length, readMs: Math.round(t1 - t0), dynamicMs: Math.round(t2 - t1), sessionMs: Math.round(t3 - t2) };
    }, 30000);
  },
  /** Adds and removes one session rule; reports whether updateSessionRules settles within ms. */
  async writeProbe(ms) {
    const d = dnr();
    if (!d) return { ok: false, error: 'declarativeNetRequest undefined' };
    const rule = { id: 199999, priority: 1, action: { type: 'block' }, condition: { requestDomains: ['write-probe.example.net'] } };
    return attempt(async () => {
      const t0 = performance.now();
      await d.updateSessionRules({ removeRuleIds: [199999], addRules: [rule] });
      await d.updateSessionRules({ removeRuleIds: [199999] });
      return { ms: Math.round(performance.now() - t0) };
    }, ms || 5000);
  },
  async allResourceTypes() {
    const d = dnr();
    return d && d.ResourceType ? Object.values(d.ResourceType) : [];
  },
  async contains(permissions, origins) {
    return chrome.permissions.contains({ ...(permissions ? { permissions } : {}), ...(origins ? { origins } : {}) });
  },
  async getAll() {
    return chrome.permissions.getAll();
  },
  async removeDnr() {
    return attempt(() => chrome.permissions.remove({ permissions: [DNR_PERMISSION] }));
  },
  async removeOrigins(origins) {
    return attempt(() => chrome.permissions.remove({ origins }));
  },
  async setAccessLevel() {
    return attempt(() => chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }));
  },
  async resetAccessLevel() {
    return attempt(() => chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }));
  },
  async storageSeed() {
    await chrome.storage.local.set({ 'spike-local': 1 });
    await chrome.storage.session.set({ 'spike-session': 1 });
    return true;
  },
  async register(scripts) {
    return attempt(() => chrome.scripting.registerContentScripts(scripts));
  },
  async registered() {
    return (await chrome.scripting.getRegisteredContentScripts()).map((s) => ({
      id: s.id,
      world: s.world,
      persistAcrossSessions: s.persistAcrossSessions,
      matchOriginAsFallback: s.matchOriginAsFallback,
      excludeMatches: s.excludeMatches || [],
    }));
  },
  async unregisterAll() {
    const ids = (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id);
    if (ids.length > 0) await chrome.scripting.unregisterContentScripts({ ids });
    return ids;
  },
  async tabIdOf(prefix) {
    const tabs = await chrome.tabs.query({});
    const hit = tabs.filter((t) => typeof t.url === 'string' && t.url.startsWith(prefix)).pop();
    return hit && typeof hit.id === 'number' ? hit.id : -1;
  },
  async probeStorage(tabId) {
    return attempt(async () => {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'ISOLATED',
        func: async () => {
          const out = { localType: typeof (chrome.storage && chrome.storage.local), sessionType: typeof (chrome.storage && chrome.storage.session) };
          try {
            out.localKeys = Object.keys(await chrome.storage.local.get(null));
          } catch (e) {
            out.localError = e && e.message ? e.message : String(e);
          }
          try {
            out.sessionKeys = Object.keys(await chrome.storage.session.get(null));
          } catch (e) {
            out.sessionError = e && e.message ? e.message : String(e);
          }
          return out;
        },
      });
      return res ? res.result : null;
    });
  },
  async probeCrypto(tabId, world) {
    return attempt(async () => {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId },
        world,
        func: () => ({ subtle: typeof (globalThis.crypto && globalThis.crypto.subtle), getRandomValues: typeof (globalThis.crypto && globalThis.crypto.getRandomValues), secure: globalThis.isSecureContext }),
      });
      return res ? res.result : null;
    });
  },
  async probeTime(tabId) {
    return attempt(async () => {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'ISOLATED',
        func: () => {
          const el = document.documentElement;
          const out = [];
          for (let i = 0; i < 20; i++) {
            const before = performance.now();
            document.dispatchEvent(new CustomEvent('spike-time-ping'));
            const after = performance.now();
            out.push({ before, after, main: Number(el.dataset.spikeMainNow) });
          }
          return { samples: out, originIsolated: performance.timeOrigin, originMain: Number(el.dataset.spikeMainOrigin) };
        },
      });
      return res ? res.result : null;
    });
  },
  async idbScenario() {
    return attempt(async () => {
      const open = (name, version, upgrade) =>
        new Promise((resolve, reject) => {
          const req = indexedDB.open(name, version);
          let upgraded = false;
          req.onupgradeneeded = () => {
            upgraded = true;
            upgrade(req.result);
          };
          req.onsuccess = () => resolve({ db: req.result, upgraded });
          req.onerror = () => reject(req.error);
          req.onblocked = () => reject(new Error('blocked'));
        });
      const put = (db, value) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(value);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => reject(tx.error);
        });
      const del = (name) =>
        new Promise((resolve, reject) => {
          const req = indexedDB.deleteDatabase(name);
          req.onsuccess = () => resolve(true);
          req.onerror = () => reject(req.error);
          req.onblocked = () => resolve('blocked');
        });
      const first = await open('spike-idb', 1, (db) => db.createObjectStore('kv', { keyPath: 'k' }));
      await put(first.db, { k: 'a' });
      first.db.close();
      const deleted = await del('spike-idb');
      const second = await open('spike-idb', 1, (db) => db.createObjectStore('kv', { keyPath: 'k' }));
      await put(second.db, { k: 'b' });
      second.db.close();
      const upgradeV2 = await open('spike-idb', 2, (db) => db.createObjectStore('extra'));
      const stores = Array.from(upgradeV2.db.objectStoreNames);
      upgradeV2.db.close();
      const databases = indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name + '@' + d.version) : null;
      return { firstUpgraded: first.upgraded, deleted, secondUpgraded: second.upgraded, v2Upgraded: upgradeV2.upgraded, stores, databases };
    });
  },
  async idbRead() {
    return attempt(
      () =>
        new Promise((resolve, reject) => {
          const req = indexedDB.open('spike-idb');
          req.onupgradeneeded = () => {
            req.transaction.abort();
            resolve({ exists: false });
          };
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction('kv', 'readonly');
            const all = tx.objectStore('kv').getAllKeys();
            all.onsuccess = () => {
              resolve({ exists: true, version: db.version, keys: all.result });
              db.close();
            };
            all.onerror = () => reject(all.error);
          };
          req.onerror = () => reject(req.error);
        }),
    );
  },
  async openPopup() {
    return attempt(() => chrome.action.openPopup());
  },
  reload() {
    setTimeout(() => chrome.runtime.reload(), 50);
    return true;
  },
};
