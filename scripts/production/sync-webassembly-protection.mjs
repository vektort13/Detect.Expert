// ADR-059: canonical Wasm surfaces generate independent denial switch cases.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WASM_SURFACES } from '../../packages/contracts/src/webassembly-apis.mjs';
import { switchBounds } from './protection-runtime-split.mjs';

export function syncWebAssemblyProtection({ check = false } = {}) {
  const file = resolve(import.meta.dirname, '../../apps/production-extension/protection-runtime.js');
  const before = readFileSync(file, 'utf8'), parts = switchBounds(before);
  const starts = [...parts.body.matchAll(/^ {4}case "([a-z0-9-]+)":/gm)];
  const existing = starts.map((match, index) => ({ id: match[1], code: parts.body.slice(match.index, starts[index + 1]?.index ?? parts.body.length) }));
  const cases = WASM_SURFACES.map(surface => `    case "${surface.feature}":\n      wasmGuard(realm, ${JSON.stringify(surface.target)}, ${JSON.stringify(surface.owner ?? '')}, ${JSON.stringify(surface.property)}, ${JSON.stringify(surface.kind)});\n      break;\n`).join('');
  const after = parts.head + existing.filter(value => !value.id.startsWith('webassembly-')).map(value => value.code).join('') + cases + parts.tail;
  if (after !== before) {
    if (check) throw new Error('WebAssembly protection is out of sync');
    writeFileSync(file, after);
  }
  return { surfaces: WASM_SURFACES.length };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log('WebAssembly protection:', syncWebAssemblyProtection({ check: process.argv.includes('--check') }));
}
