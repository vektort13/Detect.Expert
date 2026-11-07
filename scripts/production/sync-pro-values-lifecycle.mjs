// ADR-038: a lost read acknowledgement must not lose ownership of an active Pro realm.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { classMember } from './clear-reset-tools.mjs';

const root = resolve(import.meta.dirname, '../..'), check = process.argv.includes('--check');
const LEGACY_RESUME_DIRECT = 'dcc81a0a64e0c090c57213c2338020b9fd462902eeda387d7aa01ebac788099a';
const REVIEWED_RESUME = new Set([
  '0ffc76d9ad45a9bee9fe2a13e63051aa9fe7f96925fb2aaa3572b164b135d637', // Original minified Pro callback.
  'cafd48770462bf4415cd6d2f4bba23cd9ea524c6953063ea7d3e8200463578dc', // ADR-073 formatted callback + ensureHistory.
]);

/** Keep the original migration, and accept only the exact separately reviewed ADR-073 resume member. */
export function patchRuntimeResumeLifecycle(source) {
  const found = classMember(source, 'BackgroundRuntime', 'resume', 'background.js');
  const hash = text => createHash('sha256').update(text).digest('hex');
  const current = hash(found.text);
  if (REVIEWED_RESUME.has(current)) return source;
  if (current !== LEGACY_RESUME_DIRECT) throw Error('background.js: Pro resume lifecycle source drift');
  const before = 'this.sendControl(documentKey3, "resume"), { schemaVersion: 1, type: "ok", reportRevision:';
  const after = 'await this.pro.resumeValueCapture(documentKey3, () => this.sendControl(documentKey3, "resume")), { schemaVersion: 1, type: "ok", reportRevision:';
  if (found.text.split(before).length !== 2) throw Error('background.js: missing legacy Pro resume lifecycle boundary');
  const desired = found.text.replace(before, after);
  if (!REVIEWED_RESUME.has(hash(desired))) throw Error('background.js: unexpected Pro resume lifecycle migration');
  return source.slice(0, found.node.getStart(found.tree)) + desired + source.slice(found.node.end);
}
const resumeValueCapture = `  async resumeValueCapture(documentKey, resumeBridge) {
    if (!this.checkDeadline()) { await resumeBridge(); return; }
    // Light pause clears MAIN values. Rearm that document before acknowledging
    // resume, without waiting for an unavailable READ and another polling tick.
    const controlEpoch = this.proValueControlEpoch = {};
    if (this.proValueTimer !== null) clearTimeout(this.proValueTimer);
    this.proValueTimer = null;
    this.proValueCaptures.delete(documentKey);
    for (const key of this.proValueBaselines.keys()) if (key.endsWith("|" + documentKey)) this.proValueBaselines.delete(key);
    for (const key of this.proLoaderBaselines.keys()) if (key.endsWith("|" + documentKey)) this.proLoaderBaselines.delete(key);
    try { await this.boundedPro(resumeBridge); } catch { this.limit("event-limit"); }
    if (this.proValueControlEpoch !== controlEpoch || !this.checkDeadline()) return;
    await this.captureValues().catch(() => this.limit("event-limit"));
  }
`;
const changes = {
  'background.js': [
    ['  proValueCaptures = new Map();', '  proValueCaptures = new Map();\n  proValueAttempts = new Map();\n  proValueControlEpoch = {};'],
    ['  proValueWork = null;\n  async captureValues() {\n    if (this.proValueWork) return this.proValueWork;\n    const work = this.captureValueWork(); this.proValueWork = work;', `  proValueWork = null;
  proValueWorkEpoch = null;
  async captureValues() {
    if (this.proValueWork) {
      const previous = this.proValueWork, epoch = this.proValueWorkEpoch;
      await previous;
      if (this.proValueWork === previous) this.proValueWork = null;
      if (epoch !== this.proValueControlEpoch && this.checkDeadline()) return this.captureValues();
      return;
    }
    this.proValueWorkEpoch = this.proValueControlEpoch;
    const work = this.captureValueWork(); this.proValueWork = work;`],
    ['let sessionId = this.session.id, generation = this.runtime.scope.accessGeneration, deadline = Date.now() + 3000;', 'let sessionId = this.session.id, generation = this.runtime.scope.accessGeneration, controlEpoch = this.proValueControlEpoch, deadline = Date.now() + 3000;'],
    ['        if (!this.checkDeadline() || this.session.id !== sessionId || this.runtime.scope.accessGeneration !== generation) return;', '        if (this.proValueControlEpoch !== controlEpoch || !this.checkDeadline() || this.session.id !== sessionId || this.runtime.scope.accessGeneration !== generation) return;'],
    ['        try { if (!await this.boundedPro(() => this.runtime.apiResults.authorize(request, operation))) continue; } catch { this.limit("event-limit"); continue; }\n        const key = binding.documentKey,', `        const current = () => {
          let live;
          for (const candidate of this.runtime.state.bindings.values()) if (candidate.documentKey === binding.documentKey) { live = candidate; break; }
          return this.proValueControlEpoch === controlEpoch && this.checkDeadline() && this.session.id === sessionId && this.runtime.scope.accessGeneration === generation && this.pageFor(binding.tabId) === page && live?.documentId === binding.documentId && live?.tabId === binding.tabId && live?.frameId === binding.frameId && live.documentLifecycle !== "cached" && live.documentLifecycle !== "prerender" && this.belongsToPage(binding.documentKey, page);
        };
        try { if (!await this.boundedPro(() => current() && this.runtime.apiResults.authorize(request, operation))) continue; } catch { this.limit("event-limit"); continue; }
        if (!current()) continue;
        const key = binding.documentKey,`],
    ['        try { response = await this.boundedPro(() => this.runtime.api.tabs.sendMessage(binding.tabId, { schemaVersion: 1, type: initialized ? "pro-values-read" : "pro-values-start", sessionId: captureToken }, { frameId: binding.frameId, documentId: binding.documentId })); } catch { continue; }', `        try { response = await this.boundedPro(() => {
          if (!current()) return;
          // Retain the native target before dispatch, including timeout/unavailable outcomes.
          // Keep up to 128 native targets until stop, including temporarily absent/BFCache bindings.
          if (!this.proValueAttempts.has(key) && this.proValueAttempts.size >= 128) { this.limit("document-limit"); return; }
          const previous = this.proValueAttempts.get(key);
          if (previous && previous.token !== captureToken) this.stopProValueAttempt(previous);
          this.proValueAttempts.set(key, { tabId: binding.tabId, frameId: binding.frameId, documentId: binding.documentId, token: captureToken });
          return this.runtime.api.tabs.sendMessage(binding.tabId, { schemaVersion: 1, type: initialized ? "pro-values-read" : "pro-values-start", sessionId: captureToken }, { frameId: binding.frameId, documentId: binding.documentId });
        }); } catch { continue; }`],
    ['        if (!this.checkDeadline() || this.session.id !== sessionId || this.runtime.scope.accessGeneration !== generation || this.pageFor(binding.tabId) !== page ) continue;', '        if (!current()) continue;'],
    ['        if (!this.checkDeadline() || this.session.id !== sessionId || this.runtime.scope.accessGeneration !== generation || this.pageFor(binding.tabId) !== page) continue;', '        if (!current()) continue;'],
    ['      if (this.checkDeadline() && this.proValueTimer === null) this.proValueTimer = setTimeout(', '      if (this.proValueControlEpoch === controlEpoch && this.checkDeadline() && this.proValueTimer === null) this.proValueTimer = setTimeout('],

    ['      this.api.tabs.sendMessage(report2.tabId, message, { frameId: report2.frameId, documentId: report2.documentId }).catch(() => {', '      return this.api.tabs.sendMessage(report2.tabId, message, { frameId: report2.frameId, documentId: report2.documentId }).catch(() => {'],
    [`  stopValueCapture() {
    if (this.proValueTimer !== null) clearTimeout(this.proValueTimer);
    this.proValueTimer = null;
    let sessionId = this.session?.id;
    for (let binding of this.runtime.state.bindings.values()) { const token = this.proValueCaptures.get(binding.documentKey); if (sessionId && token?.startsWith(sessionId + "-")) this.runtime.api.tabs.sendMessage(binding.tabId, { schemaVersion: 1, type: "pro-values-stop", sessionId: token }, { frameId: binding.frameId, documentId: binding.documentId }).catch(() => {}); }
    this.proValueCaptures.clear(); this.proValueBaselines.clear(); this.proLoaderBaselines.clear();
  }`, `  stopProValueAttempt(attempt) {
    try { Promise.resolve(this.runtime.api.tabs.sendMessage(attempt.tabId, { schemaVersion: 1, type: "pro-values-stop", sessionId: attempt.token }, { frameId: attempt.frameId, documentId: attempt.documentId })).catch(() => {}); } catch {}
  }
  stopValueCapture() {
    this.proValueControlEpoch = {};
    this.proValueEpoch = null;
    if (this.proValueTimer !== null) clearTimeout(this.proValueTimer);
    this.proValueTimer = null;
    for (const attempt of this.proValueAttempts.values()) this.stopProValueAttempt(attempt);
    this.proValueAttempts.clear(); this.proValueCaptures.clear(); this.proValueBaselines.clear(); this.proLoaderBaselines.clear();
  }`],
  ],
  'bridge.js': [
    ['  function startProValuesBridge() {\n    let pending = null, sequence = 0;', '  function startProValuesBridge() {\n    let pending = null, sequence = 0, retiredFull = false;\n    const retired = new Set();'],
    ['      if (data.type === "pro-values-stop") { finish(!1); window.postMessage({ channel: "detect.expert/pro-values/v1", ...data, requestId: "pro-" + ++sequence }, "*"); respond({ schemaVersion: 1, type: "pro-values-stopped" }); return !1; }', `      if (data.type === "pro-values-stop") {
        // A trusted delayed start for a retired token must not reinstall Pro hooks.
        // Never evict tombstones: after 128 tokens this document rejects new recording.
        if (!retired.has(data.sessionId)) { if (retired.size < 128) retired.add(data.sessionId); else retiredFull = true; }
        if (pending?.sessionId === data.sessionId) finish(!1);
        window.postMessage({ channel: "detect.expert/pro-values/v1", ...data, requestId: "pro-" + (sequence = Math.min(2147483647, sequence + 1)) }, "*");
        respond({ schemaVersion: 1, type: "pro-values-stopped" }); return !1;
      }`],
    ['      if (pending || sequence >= 2147483647) { respond({ schemaVersion: 1, type: "pro-values-cache",', '      if (pending || retiredFull || retired.has(data.sessionId) || sequence >= 2147483647) { respond({ schemaVersion: 1, type: "pro-values-cache",'],
  ],
};
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
for (const [name, patches] of Object.entries(changes)) {
  const path = resolve(root, 'apps/production-extension', name), before = readFileSync(path, 'utf8');
  let source = before.replaceAll('\r\n', '\n');
  for (const [oldText, newText] of patches) {
    // ADR-072 owns the strengthened current guard; its dedicated gate checks it.
    if (name === 'background.js' && source.includes('// ADR-072: a pause followed by resume') && newText.includes('const current = () => {') && !source.includes(oldText)) continue;
    // Some inserts retain their complete old anchor; do not duplicate those.
    // Other replacements can share the same new guard: its presence elsewhere
    // must not skip an old guard that still exists after a different await.
    if (newText.includes(oldText) && source.includes(newText)) continue;
    if (source.includes(oldText)) source = source.replace(oldText, newText);
    else if (!source.includes(newText)) throw Error(name + ': missing Pro lifecycle boundary: ' + oldText.slice(0, 80));
  }
  if (name === 'background.js') {
    source = patchRuntimeResumeLifecycle(source);
    const existing = source.indexOf('  async resumeValueCapture(documentKey, resumeBridge) {');
    const boundary = source.indexOf('  stopProValueAttempt(attempt) {');
    if (boundary < 0 || existing >= boundary) throw Error('missing Pro resume lifecycle boundary');
    source = source.slice(0, existing < 0 ? boundary : existing) + resumeValueCapture + source.slice(boundary);
  }
  if (check && source !== before.replaceAll('\r\n', '\n')) throw Error(name + ': Pro lifecycle drift');
  if (!check && source !== before) writeFileSync(path, source);
}
console.log((check ? 'checked' : 'synchronized') + ' Pro values lifecycle');
}
