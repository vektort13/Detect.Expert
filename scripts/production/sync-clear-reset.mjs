// ADR-073: source-preserving synchronization of all four delivered clear/reset participants.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { patchProducer } from './clear-producer-patches.mjs';
import { patchClearBackground } from './clear-background-patches.mjs';
import { patchClearRuntime } from './clear-runtime-patches.mjs';

const root = resolve(import.meta.dirname, '../..'), check = process.argv.includes('--check');
const prepared = ['background.js', 'bridge.js', 'hook.early.js', 'hook.main.js'].map(file => {
  const path = resolve(root, 'apps/production-extension', file), before = readFileSync(path, 'utf8');
  const after = file === 'background.js' ? patchClearRuntime(patchClearBackground(before)) : patchProducer(before, file);
  return { file, path, before, after };
});
const changed = prepared.filter(item => item.before !== item.after);
if (check && changed.length) {
  console.error('clear/reset synchronization required: ' + changed.map(item => item.file).join(', '));
  process.exitCode = 1;
} else if (!check) {
  // Validate every boundary first, then replace each complete prepared file.
  for (const item of changed) writeFileSync(item.path + '.clear-reset.tmp', item.after);
  for (const item of changed) renameSync(item.path + '.clear-reset.tmp', item.path);
  console.log('clear/reset synchronized: ' + changed.length + ' files');
} else console.log('clear/reset current: 4 delivered files');
