// One audited implementation for the typed Firewall UI and production browser UI.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
export async function syncManagementNavigation({ check = false } = {}) {
  const output = resolve(root, 'apps/production-extension/management-navigation.js');
  const result = await build({ entryPoints: [resolve(root, 'apps/production-protect/src/ui/management-navigation.ts')],
    bundle: false, format: 'esm', platform: 'browser', target: 'es2022', write: false, minify: false, legalComments: 'none', logLevel: 'silent' });
  const source = '// Generated from production-protect/src/ui/management-navigation.ts; do not edit.\n' + result.outputFiles[0].text;
  if (!existsSync(output) || readFileSync(output, 'utf8') !== source) {
    if (check) throw new Error('Management navigation synchronization required.');
    writeFileSync(output, source, 'utf8');
  }
  return output;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await syncManagementNavigation({ check: process.argv.includes('--check') });
  console.log('Management navigation synchronized' + (process.argv.includes('--check') ? ' (check)' : ''));
}
