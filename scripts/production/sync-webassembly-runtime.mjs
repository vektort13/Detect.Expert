// ADR-059: one registry and observer implementation in every production execution world.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { WASM_OPERATION_DEFINITIONS } from '../../packages/contracts/src/webassembly-apis.mjs';
import { webAssemblyRuntimeSource } from './webassembly-runtime.mjs';

const root = resolve(import.meta.dirname, '../..');
export const WEBASSEMBLY_BUNDLES = Object.freeze(['hook.main.js', 'hook.early.js', 'bridge.js', 'background.js', 'popup.js', 'sidepanel.js', 'report.js', 'options.js']);
const marker = 'var API_OPERATION_DEFINITIONS = ', endMarker = ', API_OPERATIONS =';
export function synchronizeWebAssemblySource(before, name) {
  let source = before.replaceAll('\r\n', '\n');
  const start = source.indexOf(marker), end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) {
    if (name === 'options.js') return source;
    throw Error(name + ': WebAssembly operation registry missing');
  }
  const definitions = runInNewContext('(' + source.slice(start + marker.length, end) + ')', {}, { timeout: 1000 });
  const names = new Map(definitions.map(row => [row[0], row]));
  for (const row of WASM_OPERATION_DEFINITIONS) {
    const previous = names.get(row[0]);
    if (previous) {
      if (JSON.stringify(previous) !== JSON.stringify(row)) throw Error(name + ': incompatible WebAssembly operation ' + row[0]);
    } else { definitions.push([...row]); names.set(row[0], row); }
  }
  const encoded = '[\n' + definitions.map(row => '  ' + JSON.stringify(row)).join(',\n') + '\n]';
  source = source.slice(0, start + marker.length) + encoded + source.slice(end);
  if (name.startsWith('hook.')) {
    const from = source.indexOf('  // packages/sensors/src/wasm.ts\n');
    const to = source.indexOf('  // packages/sensors/src/permissions.ts\n', from);
    if (from < 0 || to < from) throw Error(name + ': WebAssembly module boundary missing');
    source = source.slice(0, from) + webAssemblyRuntimeSource + source.slice(to);
  }
  return source;
}
export function synchronizeWebAssembly({ check = false, directory = resolve(root, 'apps/production-extension') } = {}) {
  // Read and validate every output before changing one. Preserve all non-Wasm registry indexes.
  const changes = WEBASSEMBLY_BUNDLES.map(name => {
    const file = resolve(directory, name), previous = readFileSync(file, 'utf8');
    return { file, previous, source: synchronizeWebAssemblySource(previous, name) };
  });
  const normalized = changes.map(({ source, file }) => {
    const start = source.indexOf(marker), end = source.indexOf(endMarker, start);
    return start < 0 ? null : { file, registry: source.slice(start + marker.length, end) };
  }).filter(Boolean);
  for (const entry of normalized) if (entry.registry !== normalized[0].registry) throw Error(entry.file + ': execution-world operation registry drift');
  for (const { file, previous, source } of changes) {
    if (check && previous.replaceAll('\r\n', '\n') !== source) throw Error(file + ': WebAssembly synchronization required');
    if (!check && source !== previous) writeFileSync(file, source);
  }
  return { files: changes.length, operations: WASM_OPERATION_DEFINITIONS.length };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const check = process.argv.includes('--check'), result = synchronizeWebAssembly({ check });
  console.log((check ? 'checked' : 'synchronized') + ' WebAssembly: ' + result.operations + ' operations in ' + result.files + ' bundles');
}
