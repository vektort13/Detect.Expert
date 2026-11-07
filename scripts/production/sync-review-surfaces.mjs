// ADR-038: shared operation definitions and passive document-side hooks.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { EXTENDED_API_OPERATIONS, extendedSurfacesRuntimeSource } from './extended-surfaces-runtime.mjs';
import { workerSurfacesRuntimeSource } from './worker-surfaces-runtime.mjs';
import { mathSignatureRuntimeSource } from './math-signature-runtime.mjs';
const root = resolve(import.meta.dirname, '../..'), check = process.argv.includes('--check');
const files = ['hook.main.js', 'hook.early.js', 'bridge.js', 'background.js', 'popup.js', 'sidepanel.js', 'report.js', 'options.js'];
const additions = [...EXTENDED_API_OPERATIONS, ['Worker', 'DET-064', 'worker', 'construct'], ['SharedWorker', 'DET-064', 'worker', 'construct'], ['Worklet.addModule', 'DET-064', 'worker', 'async-call'], ['Document.cookie.get', 'DET-049', 'storage', 'get'], ['Document.cookie.set', 'DET-049', 'storage', 'set']];
const marker = 'var API_OPERATION_DEFINITIONS = ', endMarker = ', API_OPERATIONS =';
let definitionCount = 0;
for (const name of files) {
  const file = resolve(root, 'apps/production-extension', name), before = readFileSync(file, 'utf8'); let source = before;
  const start = source.indexOf(marker), end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) {
    if (name === 'options.js') continue;
    throw Error(name + ': operation registry missing');
  }
  const definitions = runInNewContext('(' + source.slice(start + marker.length, end) + ')', {}, { timeout: 1000 });
  const names = new Set(definitions.map(row => row[0]));
  for (const row of additions) if (!names.has(row[0])) { definitions.push([...row]); names.add(row[0]); }
  definitionCount = definitions.length;
  const encoded = '[\n' + definitions.map(row => '  ' + JSON.stringify(row)).join(',\n') + '\n]';
  source = source.slice(0, start + marker.length) + encoded + source.slice(end);
  source = source.replace(/API_MECHANISMS = (\[[\s\S]*?\])(?=, apply)/g, (_match, encoded) => {
    const mechanisms = JSON.parse(encoded);
    for (const row of definitions) if (!mechanisms.includes(row[2])) mechanisms.push(row[2]);
    return 'API_MECHANISMS = ' + JSON.stringify(mechanisms, null, 2);
  });
  if (name.startsWith('hook.')) {
    const blockStart = '  // ADR-038 surfaces start\n', blockEnd = '  // ADR-038 surfaces end\n';
    const from = source.indexOf(blockStart), to = source.indexOf(blockEnd, from);
    const block = blockStart + workerSurfacesRuntimeSource + extendedSurfacesRuntimeSource + mathSignatureRuntimeSource + blockEnd;
    if (from >= 0) { if (to < from) throw Error('surface module boundary'); source = source.slice(0, from) + block + source.slice(to + blockEnd.length); }
    const installMarker = '  // apps/extension/entrypoints/hook.main.ts\n';
    if (!source.includes(installMarker)) throw Error(name + ': installer boundary');
    if (from < 0) source = source.replace(installMarker, block + installMarker);
    const install = '  function installSensors(runtime, realm) {\n';
    const setup = '    workerSurfacesSupport.install(runtime, realm, { wrapConstructor, wrapMethod }, API_OPERATION_INDEX, PHASE_INDEX);\n    extendedSurfacesSupport.install(runtime, realm, { wrapMethod, wrapConstructor, wrapSetter });\n';
    if (!source.includes(setup)) { if (!source.includes(install)) throw Error(name + ': installer'); source = source.replace(install, install + setup); }
    const mathSetup = '    mathSignatureSupport.install(runtime, realm, { wrapMethod }, TECHNIQUE_INDEX, PHASE_INDEX, SIGNAL_BIT);\n';
    if (!source.includes(mathSetup)) source = source.replace(install, install + mathSetup);
    const stop = '      try { this.onProSessionChanged?.(false); } catch {}\n';
    if (!source.includes(stop)) source = source.replace('    clearPro() {\n', '    clearPro() {\n' + stop);
    source = source.replace('if (enabled) this.proSession = sessionId;', 'if (enabled) { this.proSession = sessionId; try { this.onProSessionChanged?.(true); } catch {} }');
    const event = 'target && attach(wrapMethod(target, "addEventListener", (receiver, args, threw) => {\n';
    const observe = '        extendedSurfacesSupport.observeDeviceEvent(runtime, receiver, args, threw);\n';
    if (!source.includes(observe)) { if (!source.includes(event)) throw Error(name + ': interaction callback'); source = source.replace(event, event + observe); }
  }
  if (check && source !== before) throw Error(name + ': review surface synchronization required');
  if (!check && source !== before) writeFileSync(file, source);
}
const canonicalPath = resolve(root, 'packages/contracts/src/review-operations.json'), canonical = JSON.stringify({ adr: 'ADR-038', operations: additions }, null, 2) + '\n';
if (check) { if (readFileSync(canonicalPath, 'utf8') !== canonical) throw Error('review operations drift'); }
else writeFileSync(canonicalPath, canonical);
console.log((check ? 'checked' : 'synchronized') + ' review surfaces: ' + definitionCount + ' operations');
