// ADR-073 producer synchronization. Root applies only after reviewing the prepared source patches.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { patchProducer } from './clear-producer-patches.mjs';

const root = resolve(import.meta.dirname, '../..');
const check = process.argv.includes('--check');
const files = ['bridge.js', 'hook.early.js', 'hook.main.js'];
const prepared = files.map(file => {
  const path = resolve(root, 'apps/production-extension', file), before = readFileSync(path, 'utf8');
  return { file, path, before, after: patchProducer(before, file) };
});
const changed = prepared.filter(item => item.before !== item.after);
if (check && changed.length) {
  console.error('clear producers drift: ' + changed.map(item => item.file).join(', '));
  process.exitCode = 1;
} else if (!check) {
  // Prepare every target before writing any target; each rename replaces one complete file.
  for (const item of changed) writeFileSync(item.path + '.clear-reset.tmp', item.after);
  for (const item of changed) renameSync(item.path + '.clear-reset.tmp', item.path);
  console.log('clear producers synchronized: ' + changed.length + ' file(s)');
} else console.log('clear producers are current: 3 files');
