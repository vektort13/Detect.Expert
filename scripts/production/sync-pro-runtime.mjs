import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runtimeSource } from './pro-values-runtime.mjs';
const root = resolve(import.meta.dirname, '../..');
for (const name of ['hook.early.js', 'hook.main.js', 'bridge.js', 'background.js', 'popup.js', 'sidepanel.js', 'report.js']) {
  const path = resolve(root, 'apps/production-extension', name);
  let source = readFileSync(path, 'utf8');
  const marker = '// ADR-017: Pro values\n';
  const start = source.indexOf(marker) + marker.length;
  const body = source.indexOf('function proValueDocuments(', start);
  const finish = source.indexOf('\n}\n', body) + 3;
  if (start < marker.length || body < start || finish < body) throw new Error('missing Pro runtime markers: ' + name);
  source = source.slice(0, start) + runtimeSource + '\n' + source.slice(finish);
  writeFileSync(path, source);
}
