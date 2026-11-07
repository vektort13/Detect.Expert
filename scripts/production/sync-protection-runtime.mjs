// ADR-045: repeatable synchronization of feature IDs and standalone MAIN scripts.
// ADR-046: each protection.<id>.js carries the shared runtime with only its own switch case.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROTECTION_FEATURES } from '../../packages/contracts/src/protection-features.mjs';
import { splitProtectionRuntime } from './protection-runtime-split.mjs';
const root = resolve(import.meta.dirname, '../..');
const directory = resolve(root, 'apps/production-extension');
const check = process.argv.includes('--check');
function store(file, source) {
  let previous; try { previous = readFileSync(file, 'utf8'); } catch {}
  if (previous === source) return;
  if (check) throw new Error('Protection runtime out of sync: ' + file);
  writeFileSync(file, source);
}
// Validate everything before the first write: stale scripts would still be packaged, so nothing is deleted here.
const known = new Set(PROTECTION_FEATURES);
for (const file of readdirSync(directory)) {
  const match = /^protection\.([a-z0-9-]+)\.js$/.exec(file);
  if (match && !known.has(match[1])) throw new Error('Stale protection script: ' + file);
}
const runtime = readFileSync(resolve(directory, 'protection-runtime.js'), 'utf8').replace('export function installProtection(', 'function installProtection(');
const parts = splitProtectionRuntime(runtime, PROTECTION_FEATURES);
const entry = readFileSync(resolve(import.meta.dirname, 'protection-entry.template.js'), 'utf8');
const ids = JSON.stringify(PROTECTION_FEATURES, null, 2);
for (const file of readdirSync(directory).filter(name => name.endsWith('.js') && !name.startsWith('protection.'))) {
  const path = resolve(directory, file), source = readFileSync(path, 'utf8');
  if (!source.includes('var PROTECTION_FEATURES = [')) continue;
  store(path, source.replace(/var PROTECTION_FEATURES = \[[\s\S]*?\]/g, 'var PROTECTION_FEATURES = ' + ids));
}
for (const feature of PROTECTION_FEATURES) {
  const source = '"use strict";\n(() => {\nconst PROTECTION_CHANNEL = "detect.expert/protection/v1";\n' + parts.get(feature) + '\n' + entry.replaceAll('__FEATURE__', feature) + '\n})();\n';
  store(resolve(directory, 'protection.' + feature + '.js'), source);
}
console.log('Protection runtime: ' + PROTECTION_FEATURES.length + ' rules synchronized' + (check ? ' (check)' : ''));
