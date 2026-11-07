// One-time, guarded source migration of the recovered production runtime (ADR-017).
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runtimeSource } from './pro-values-runtime.mjs';
const root = resolve(import.meta.dirname, '../..');
const directory = resolve(root, 'apps/production-extension');
function change(name, callback) {
  const file = resolve(directory, name);
  let source = readFileSync(file, 'utf8');
  if (source.includes('// ADR-017: Pro values')) return;
  const replace = (before, after) => {
    if (!source.includes(before)) throw new Error(name + ': missing anchor ' + before.slice(0, 90));
    source = source.replace(before, after);
  };
  callback(replace, () => source);
  writeFileSync(file, source);
}
const sensor = String.raw`
    proSession = "";
    proRows = new NativeMap();
    proBytes = 512;
    proTruncated = !1;
    proLastReadAt = -1 / 0;
    recordPro(operation, phase, result, args) {
      if (valueCaptureDenied(this)) return;
      if (!this.proSession) return;
      let definition = apiResultDefinition(operation);
      if (!definition) return;
      let value = previewReturnedValue(operation, phase, result, this.allowNumericVectors);
      if (value) this.storePro({ operation, techniqueId: definition.techniqueId, phase, value, parameters: proValueParameters(operation, args), count: 1 });
    }
    storePro(row) {
      if (valueCaptureDenied(this)) return;
      if (!this.proSession) return;
      let key = proValueKey(row), previous = apply6(mapGet5, this.proRows, [key]);
      if (previous) { previous.count = previous.count < 2147483647 ? previous.count + 1 : 2147483647; return; }
      let cost = 256 + key.length * 2;
      if (apply6(mapSize2, this.proRows, []) >= 256 || this.proBytes + cost > 65536) { this.proTruncated = !0; return; }
      this.proBytes += cost;
      apply6(mapSet, this.proRows, [key, row]);
    }
    clearPro() {
      this.proSession = "", apply6(mapClear, this.proRows, []), this.proBytes = 512, this.proTruncated = !1, this.proLastReadAt = -1 / 0;
    }
    handleProControl(data, enabled, env) {
      enabled = enabled && !valueCaptureDenied(this);
      let own = getDescriptor, channel = own(data, "channel")?.value, type = own(data, "type")?.value;
      let sessionId = own(data, "sessionId")?.value, requestId = own(data, "requestId")?.value;
      if (channel !== "detect.expert/pro-values/v1" || typeof sessionId !== "string" || !/^[A-Za-z0-9-]{1,64}$/.test(sessionId) || typeof requestId !== "string" || !/^pro-[0-9]{1,10}$/.test(requestId)) return;
      if (type === "pro-values-stop") { if (this.proSession === sessionId) this.clearPro(); return; }
      if (type !== "pro-values-start" && type !== "pro-values-read") return;
      if (type === "pro-values-start" && this.proSession !== sessionId) { this.clearPro(); if (enabled) this.proSession = sessionId; }
      let now = env.now();
      if (now - this.proLastReadAt < 500) return;
      this.proLastReadAt = now;
      let rows = [];
      if (enabled && this.proSession === sessionId) apply6(mapForEach2, this.proRows, [row => arrayPush(rows, row)]);
      for (let index = 0, batch = 0; index < rows.length || batch === 0; batch++) {
        let entries = [], bytes = 512;
        while (index < rows.length && entries.length < 32) {
          let row = rows[index], cost = 256 + proValueKey(row).length * 2;
          if (bytes + cost > 16384) break;
          arrayPush(entries, row), bytes += cost, index++;
        }
        env.postMessage({ channel, type: "pro-values-batch", sessionId, requestId, batchSeq: batch, final: index >= rows.length, enabled: enabled && this.proSession === sessionId, rows: entries, truncated: this.proTruncated });
        if (index >= rows.length || batch >= 63) break;
      }
    }
`;
for (const name of ['hook.early.js', 'hook.main.js']) change(name, replace => {
  replace('  // packages/sensors/src/api-results.ts', '  // ADR-017: Pro values\n' + runtimeSource + '\n  // packages/sensors/src/api-results.ts');
  replace('    record(operation, phase, result) {', sensor + '\n    record(operation, phase, result) {');
  replace('    recordRtc(operation, value) {', '    recordRtc(operation, value) {');
  replace('this.store({ operation, techniqueId: definition.techniqueId, phase: "returned-sync", value: checked });', 'this.storePro({ operation, techniqueId: definition.techniqueId, phase: "returned-sync", value: checked, parameters: [], count: 1 });\n      this.store({ operation, techniqueId: definition.techniqueId, phase: "returned-sync", value: checked });');
  replace('    clear() {\n      apply6(mapClear, this.rows, [])', '    clear() {\n      this.clearPro();\n      apply6(mapClear, this.rows, [])');
  replace('        if (getDescriptor(data2, "channel")?.value === API_RESULTS_CHANNEL)', '        if (getDescriptor(data2, "channel")?.value === "detect.expert/pro-values/v1") { this.apiResults.handleProControl(data2, this.hooks.enabled, this.env); return; }\n        if (getDescriptor(data2, "channel")?.value === API_RESULTS_CHANNEL)');
  replace('    recordResult(operation, phaseIndex, result) {', '    recordResult(operation, phaseIndex, result, args) {\n      if (this.hooks.enabled) this.apiResults.recordPro(operation, PHASES[phaseIndex], result, args);');
  // Existing wrappers preserve the original argument object; an extra observer argument is internal only.
  replace('            observe(threw, result);', '            observe(threw, result, arguments);');
  replace('wrapResultMethod(target, key, (threw, result) => {\n        operation', 'wrapResultMethod(target, key, (threw, result, args) => {\n        operation');
  replace('runtime.recordResult(label, threw ? PHASE_INDEX["threw-sync"] : phase, result);', 'runtime.recordResult(label, threw ? PHASE_INDEX["threw-sync"] : phase, result, args);');
  replace('wrapResultMethod(target, key, (threw, result) => {\n          let phase', 'wrapResultMethod(target, key, (threw, result, args) => {\n          let phase');
  replace('runtime.recordResult(label, phase, result);', 'runtime.recordResult(label, phase, result, args);');
  replace('runtime.recordResult(operation, phase, result2), !threw && connection', 'runtime.recordResult(operation, phase, result2, args), !threw && connection');
});

const bridge = String.raw`
  function startProValuesBridge() {
    let pending = null, sequence = 0;
    const finish = (available) => {
      if (!pending) return;
      let current = pending; pending = null; clearTimeout(current.timer);
      current.respond({ schemaVersion: 1, type: "pro-values-cache", sessionId: current.sessionId, available, rows: available ? current.rows : [], truncated: current.truncated || !available });
    };
    window.addEventListener("message", event => {
      let data = event.data;
      if (event.source !== window || !pending || !data || typeof data !== "object" || data.channel !== "detect.expert/pro-values/v1" || data.type !== "pro-values-batch" || pending.admitted++ >= 64) return;
      if (data.requestId !== pending.requestId || data.sessionId !== pending.sessionId || data.batchSeq !== pending.batch || typeof data.final !== "boolean" || typeof data.enabled !== "boolean" || typeof data.truncated !== "boolean") return;
      let rows = proValueRows(data.rows, readApiResultEntries);
      if (!rows || rows.length > 32 || pending.rows.length + rows.length > 256) { pending.truncated = !0; return; }
      let bytes = rows.reduce((sum, row) => sum + 256 + proValueKey(row).length * 2, 512);
      if (bytes > 16384 || pending.bytes + bytes > 65536) { pending.truncated = !0; return; }
      pending.bytes += bytes; pending.batch++; pending.truncated ||= data.truncated;
      pending.rows.push(...rows);
      if (data.final) finish(data.enabled && proValueRows(pending.rows, readApiResultEntries) !== null);
    });
    chrome.runtime.onMessage.addListener((data, sender, respond) => {
      if (!isOwnServiceWorker(sender) || !data || typeof data !== "object" || Reflect.ownKeys(data).length !== 3 || data.schemaVersion !== 1 || typeof data.sessionId !== "string" || !/^[A-Za-z0-9-]{1,64}$/.test(data.sessionId)) return !1;
      if (!["pro-values-start", "pro-values-read", "pro-values-stop"].includes(data.type)) return !1;
      if (data.type === "pro-values-stop") { finish(!1); window.postMessage({ channel: "detect.expert/pro-values/v1", ...data, requestId: "pro-" + ++sequence }, "*"); respond({ schemaVersion: 1, type: "pro-values-stopped" }); return !1; }
      if (pending || sequence >= 2147483647) { respond({ schemaVersion: 1, type: "pro-values-cache", sessionId: data.sessionId, available: !1, rows: [], truncated: !0 }); return !1; }
      let requestId = "pro-" + ++sequence;
      pending = { sessionId: data.sessionId, requestId, respond, rows: [], batch: 0, admitted: 0, bytes: 512, truncated: !1, timer: setTimeout(() => finish(!1), 300) };
      window.postMessage({ channel: "detect.expert/pro-values/v1", type: data.type, sessionId: data.sessionId, requestId }, "*");
      return !0;
    });
    window.addEventListener("pagehide", () => finish(!1));
  }
`;
change('bridge.js', replace => {
  replace('  // packages/collector/src/api-results.ts', '  // ADR-017: Pro values\n' + runtimeSource + '\n' + bridge + '\n  // packages/collector/src/api-results.ts');
  replace('startBrowserProtectionBridge(), startBrowserApiResultsBridge();', 'startBrowserProtectionBridge(), startBrowserApiResultsBridge(), startProValuesBridge();');
});

const manager = String.raw`
  proValueCaptures = new Map();
  proValueTimer = null;
  proValueBusy = !1;
  async captureValues() {
    if (this.proValueBusy || !this.checkDeadline()) return;
    this.proValueBusy = !0;
    let sessionId = this.session.id, generation = this.runtime.scope.accessGeneration;
    try {
      let candidates = [...this.runtime.state.bindings.values()].filter(binding => this.trackedTabs.has(binding.tabId) && this.pageFor(binding.tabId) && this.belongsToPage(binding.documentKey, this.pageFor(binding.tabId)) && binding.documentLifecycle !== "cached" && binding.documentLifecycle !== "prerender");
      if (candidates.length > 24) this.limit("document-limit");
      for (let binding of candidates.slice(0, 24)) {
        if (!this.checkDeadline() || this.session.id !== sessionId || this.runtime.scope.accessGeneration !== generation) return;
        const page = this.pageFor(binding.tabId), request = { tabId: binding.tabId, frameId: binding.frameId, documentKey: binding.documentKey }, operation = { documentKey: binding.documentKey, tabId: binding.tabId, invalid: !1 };
        if (!await this.runtime.apiResults.authorize(request, operation)) continue;
        const key = binding.documentKey, initialized = this.proValueCaptures.get(key) === sessionId;
        let response;
        try { response = await this.runtime.api.tabs.sendMessage(binding.tabId, { schemaVersion: 1, type: initialized ? "pro-values-read" : "pro-values-start", sessionId }, { frameId: binding.frameId, documentId: binding.documentId }); } catch { continue; }
        if (!this.checkDeadline() || this.session.id !== sessionId || this.runtime.scope.accessGeneration !== generation || this.pageFor(binding.tabId) !== page || !await this.runtime.apiResults.authorize(request, operation)) continue;
        if (!response || response.schemaVersion !== 1 || response.type !== "pro-values-cache" || response.sessionId !== sessionId || typeof response.available !== "boolean" || typeof response.truncated !== "boolean") continue;
        let rows = proValueRows(response.rows, readApiResultEntries);
        if (!rows || !response.available) { this.limit("event-limit"); continue; }
        this.proValueCaptures.set(key, sessionId);
        page.apiValues ??= [];
        let entry = { documentKey: key, rows, truncated: response.truncated }, index = page.apiValues.findIndex(item => item.documentKey === key);
        if (index < 0 && page.apiValues.length >= 24) { this.limit("document-limit"); continue; }
        if (!this.size("values:" + page.id + "|" + key, JSON.stringify(entry).length * 2 + 256)) return;
        if (index < 0) page.apiValues.push(entry); else page.apiValues[index] = entry;
        if (response.truncated) this.limit("event-limit");
        this.mark();
      }
    } finally {
      this.proValueBusy = !1;
      if (this.checkDeadline() && this.proValueTimer === null) this.proValueTimer = setTimeout(() => { this.proValueTimer = null; this.captureValues().catch(() => this.limit("event-limit")); }, 750);
    }
  }
  stopValueCapture() {
    if (this.proValueTimer !== null) clearTimeout(this.proValueTimer);
    this.proValueTimer = null;
    let sessionId = this.session?.id;
    for (let binding of this.runtime.state.bindings.values()) if (sessionId && this.proValueCaptures.get(binding.documentKey) === sessionId) this.runtime.api.tabs.sendMessage(binding.tabId, { schemaVersion: 1, type: "pro-values-stop", sessionId }, { frameId: binding.frameId, documentId: binding.documentId }).catch(() => {});
    this.proValueCaptures.clear();
  }
  async stopWithValues() { await this.captureValues(); this.finish("manual"); await this.flush(); return this.stateResponse(); }
`;
change('background.js', (replace, read) => {
  replace('// packages/background/src/api-results.ts', '// ADR-017: Pro values\n' + runtimeSource + '\n// packages/background/src/api-results.ts');
  replace('  async begin(tabId) {', manager + '\n  async begin(tabId) {');
  replace('(this.finish("manual"), await this.flush(), this.stateResponse())', 'await this.stopWithValues()');
  replace('this.armDeadline(), this.mark(), await this.flush(), this.stateResponse(tabId);', 'this.armDeadline(), this.mark(), await this.captureValues(), await this.flush(), this.stateResponse(tabId);');
  replace('  resetMemory() {\n    this.trackedTabs.clear()', '  resetMemory() {\n    this.stopValueCapture();\n    this.trackedTabs.clear()');
  replace('    let ended = Math.max(this.session.startedAt', '    this.stopValueCapture();\n    let ended = Math.max(this.session.startedAt');
  replace('    this.disposed = !0, this.persistTimer', '    this.stopValueCapture();\n    this.disposed = !0, this.persistTimer');
  replace('    if (this.trackedTabs.size === 0) this.finish("tab-closed");', '    if (this.trackedTabs.size === 0) this.finish("tab-closed");');
  // Hydration resumes only current documents, and MAIN starts a new history after restart.
  replace('    let checked = validateProSession(value.session);', '    let checked = validateProSession(value.session);');
  patchPageValidator(replace, read());
});
function patchPageValidator(replace, source) {
  const needle = 'if (!shape';
  const pageStart = source.indexOf(needle, source.indexOf('return !list(', source.lastIndexOf('function validateProSession')));
  const end = source.indexOf(' || !id(', pageStart);
  if (pageStart < 0 || end < 0) throw new Error('page validator anchor missing');
  const original = source.slice(pageStart, end);
  const shapeName = original.includes('shape3(') ? 'shape3' : 'shape';
  const pageName = original.includes('(p3,') ? 'p3' : 'p';
  replace(original, `let pageFields = ["id", "tabId", "documentKey", "url", "title", "startedAt", "endedAt", "reports", "resources"]; if (Object.hasOwn(${pageName}, "apiValues")) pageFields.push("apiValues");\n      if (Object.hasOwn(${pageName}, "apiValues") && proValueDocuments(${pageName}.apiValues, ${source.includes('var proBaseRead') ? 'proBaseRead' : 'readApiResultEntries'}) === null || !${shapeName}(${pageName}, pageFields)`);
}
const render = String.raw`
function ProApiValues({ rows }) {
  return rows?.length ? u3("dl", { class: "pro-api-values", children: rows.map((row, index) => u3("div", { class: "pro-api-values__row", children: [
    u3("dt", { children: [u3("code", { dir: "ltr", children: row.operation }), " · ", t3("detail_counts"), ": ", row.count] }),
    u3("dd", { children: [
      row.parameters.length ? u3("p", { children: row.parameters.map(parameter => u3("code", { dir: "ltr", children: parameter.name + " = " + parameter.value })) }) : null,
      u3("span", { children: t3("phase_" + row.phase.replace(/-/g, "_")) + " · " }),
      u3(ApiReturnedValue, { row })
    ] })
  ] }, index)) }) : null;
}
`;
const background = readFileSync(resolve(directory, 'background.js'), 'utf8');
const contracts = background.slice(0, background.indexOf('// packages/attribution/src/psl-index.json'));
for (const name of ['popup.js', 'sidepanel.js', 'report.js']) change(name, (replace, read) => {
  const base = name === 'report.js' ? '\nvar proBaseRead = (() => {\n' + contracts + '\nreturn readApiResultEntries;\n})();\n' : '';
  replace('// packages/contracts/src/pro-recording.ts', '// ADR-017: Pro values\n' + runtimeSource + base + '\n// packages/contracts/src/pro-recording.ts');
  patchPageValidator(replace, read());
  const anchor = name === 'report.js' ? 'function DocumentFindings({ report: report2, ordinal }) {' : 'function DocumentDetails({ report: report2, ordinal }) {';
  replace(anchor, render + '\n' + anchor.replace('ordinal })', 'ordinal, values })'));
  if (name === 'report.js') {
    replace('function Method({ card, signals, operations, ports }) {', 'function Method({ card, signals, operations, ports, values }) {');
    replace('    card.techniqueId === "DET-060" || card.techniqueId === "DET-061" ?', '    u3(ProApiValues, { rows: values }),\n    card.techniqueId === "DET-060" || card.techniqueId === "DET-061" ?');
    replace('ports: report2.requestedLocalPorts }, card.id)', 'ports: report2.requestedLocalPorts, values: values?.filter(row => row.techniqueId === card.techniqueId) }, card.id)');
    replace('report: report2, ordinal: reportIndex + 1 }, report2.documentKey)', 'report: report2, ordinal: reportIndex + 1, values: page.apiValues?.find(value => value.documentKey === report2.documentKey)?.rows ?? [] }, report2.documentKey)');
  } else {
    replace('report: report2, ordinal: index + 1 }, report2.documentKey)', 'report: report2, ordinal: index + 1, values: page.apiValues?.find(value => value.documentKey === report2.documentKey)?.rows ?? [] }, report2.documentKey)');
    replace('        /* @__PURE__ */ u3("code", { dir: "ltr", children: item.techniqueId }),', '        /* @__PURE__ */ u3("code", { dir: "ltr", children: item.techniqueId }),\n        u3(ProApiValues, { rows: values?.filter(row => row.techniqueId === item.techniqueId) }),');
  }
});
for (const file of ['pro.css', 'report.css']) {
  const path = resolve(directory, file);
  writeFileSync(path, readFileSync(path, 'utf8') + '\n/* ADR-017: bounded per-operation Pro samples. */\n.pro-api-values { margin: .75rem 0; overflow-wrap: anywhere; }\n.pro-api-values__row { padding: .5rem; border-inline-start: 2px solid #ef5350; margin-block: .5rem; }\n.pro-api-values dt { font-weight: 600; }\n.pro-api-values dd { margin-inline-start: 0; }\n.pro-api-values code { white-space: pre-wrap; }\n');
}
console.log('Pro values: MAIN, isolated bridge, recording, preview and printable report updated');
