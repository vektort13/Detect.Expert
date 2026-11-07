// ADR-039: canonical Pro-only structured values and bounded technical arguments.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runtimeSource } from './pro-values-runtime.mjs';
import { proTechnicalRuntimeSource } from './pro-technical-values-runtime.mjs';
const root = resolve(import.meta.dirname, '../..'), check = process.argv.includes('--check');
for (const name of ['hook.early.js', 'hook.main.js', 'bridge.js', 'background.js', 'popup.js', 'sidepanel.js', 'report.js']) {
  const path = resolve(root, 'apps/production-extension', name), before = readFileSync(path, 'utf8');
  let source = before.replaceAll('\r\n', '\n');
  const from = source.indexOf('// ADR-017: Pro values'), documents = source.indexOf('function proValueDocuments(', from), end = source.indexOf('\n}', documents) + 2;
  if (from < 0 || documents < from || end < documents) throw Error(name + ': Pro canonical boundary missing');
  source = source.slice(0, from) + '// ADR-017: Pro values\n' + runtimeSource + source.slice(end);
  function replace(oldText, newText) {
    if (source.includes(newText)) return;
    if (!source.includes(oldText)) throw Error(name + ': boundary missing: ' + oldText.slice(0, 100));
    source = source.replace(oldText, newText);
  }
  if (name.startsWith('hook.')) {
    const startMarker = '  // ADR-039 technical projector start\n', endMarker = '  // ADR-039 technical projector end\n';
    const start = source.indexOf(startMarker), finish = source.indexOf(endMarker, start);
    const block = startMarker + proTechnicalRuntimeSource + endMarker;
    if (start >= 0) { if (finish < start) throw Error(name + ': projector boundary'); source = source.slice(0, start) + block + source.slice(finish + endMarker.length); }
    else replace('  // apps/extension/entrypoints/hook.main.ts\n', block + '  // apps/extension/entrypoints/hook.main.ts\n');
    replace('  function installSensors(runtime, realm) {\n', '  function installSensors(runtime, realm) {\n    runtime.apiResults.projectTechnical = createProTechnicalProjector(realm, runtime.earlyCaptureGuaranteed, PRO_TECHNICAL_OPERATIONS, PRO_TECHNICAL_FIELDS);\n');
    replace('      if (!this.proSession) return;\n      let definition = apiResultDefinition(operation);', `      if (!this.proSession) return;
      const technical = this.projectTechnical?.(operation, phase, result);
      if (technical) { this.storePro({ operation, techniqueId: PRO_TECHNICAL_OPERATIONS[operation][1], phase, value: technical, parameters: proValueParameters(operation, args), count: 1 }); return; }
      let definition = apiResultDefinition(operation);`);
    replace('}, textMeasure = operation => (threw) => {', '}, textMeasure = operation => (_receiver, _args, threw, _error, result) => {');
    replace('runtime.apiResults.recordPro(operation, PHASES[threw ? P_THREW : P_RETURNED], void 0, void 0, "DET-003")', 'runtime.apiResults.recordPro(operation, PHASES[threw ? P_THREW : P_RETURNED], result, void 0, "DET-003")');
    source = source.replaceAll('wrapOutcomeMethod(ctxProto, "measureText", textMeasure(', 'wrapMethod(ctxProto, "measureText", textMeasure(').replaceAll('wrapOutcomeMethod(offscreenCtxProto, "measureText", textMeasure(', 'wrapMethod(offscreenCtxProto, "measureText", textMeasure(');
    replace('getters(ua, "NavigatorUAData", ["brands", "mobile", "platform"], "DET-026"), method(ua, "NavigatorUAData", "getHighEntropyValues", "DET-026", !0)', 'getters(ua, "NavigatorUAData", ["brands", "mobile", "platform"], "DET-026"), method(ua, "NavigatorUAData", "toJSON", "DET-026"), method(ua, "NavigatorUAData", "getHighEntropyValues", "DET-026", !0)');
    replace('operation === void 0 ? runtime.record(technique, phase, API_USE) : runtime.recordOperation(operation, phase), runtime.recordResult(label, phase, result);', 'operation === void 0 ? runtime.record(technique, phase, API_USE) : runtime.recordOperation(operation, phase), runtime.recordResult(label, phase, result, args);');
    replace('observe = (threw, value) => {\n          let phase = threw ? PHASE_INDEX["threw-sync"] : returned;', 'observe = (threw, value, args) => {\n          let phase = threw ? PHASE_INDEX["threw-sync"] : returned;');
    replace('runtime.recordResult(operation, phase, value);\n        }, options = { context: runtime.hooks }', 'runtime.recordResult(operation, phase, value, args);\n        }, options = { context: runtime.hooks }');
  }
  if (name === 'popup.js' || name === 'sidepanel.js') {
    const branch = `  if (value?.kind === "technical") return u3("div", { class: "api-result", "data-api-result-operation": row?.operation, "data-technical-profile": value.profile, children: [
    u3("span", { class: "api-result__label", children: t3("api_result_returned") }),
    u3("dl", { class: "api-result__fields", children: value.fields.map(field => u3("div", { children: [
      u3("dt", { children: u3("code", { dir: "ltr", children: field.name + " [" + field.index + "]" }) }),
      u3("dd", { children: u3("code", { class: "api-result__value", "data-api-value": !0, dir: "auto", children: field.kind === "string" ? JSON.stringify(field.value) : String(field.value) }) })
    ] }, field.name + ":" + field.index)) }),
    value.truncated ? u3("span", { class: "api-result__reason", children: t3("rtc_values_limited") }) : null
  ] });\n`;
    if (!source.includes('"data-technical-profile": value.profile')) replace('  if (value?.kind === "webrtc")', branch + '  if (value?.kind === "webrtc")');
  }
  if (check && source !== before.replaceAll('\r\n', '\n')) throw Error(name + ': technical value synchronization required');
  if (!check && source !== before) writeFileSync(path, source);
}
console.log((check ? 'checked' : 'synchronized') + ' Pro technical values in 7 bundles');
