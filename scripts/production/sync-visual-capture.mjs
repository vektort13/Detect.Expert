// ADR-066: reproduce the canonical visual producer without replacing unrelated
// reviewed production sensors. No edits to generated observer code by hand.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';
import { syncValueCapturePolicy } from './sync-value-capture-policy.mjs';
const root = resolve(import.meta.dirname, '../..');
export const canonicalVisualFile = resolve(root, 'baseline-ts/packages/sensors/src/visual.ts');
export function visualCaptureRuntimeSource() {
  const canonical = readFileSync(canonicalVisualFile, 'utf8');
  const source = canonical.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  const compiled = transformSync(source, { loader: 'ts', target: 'es2022', charset: 'utf8', legalComments: 'none', minify: false }).code;
  if (/^\s*(import|export)\s/m.test(compiled)) throw Error('Visual producer must have no runtime imports/exports.');
  return '  // packages/sensors/src/visual.ts\n  // ADR-066 canonical visual capture start\n' +
    '  var visualCaptureSupport66 = (() => {\n' + compiled.split('\n').map(line => '    ' + line).join('\n') +
    '\n    return { visualCaptureFor, installVisualCapture };\n  })();\n' +
    '  var visualCaptureFor = visualCaptureSupport66.visualCaptureFor;\n' +
    '  var installVisualCapture = visualCaptureSupport66.installVisualCapture;\n' +
    '  // ADR-066 canonical visual capture end\n\n';
}
export function syncVisualCapture({ check = false } = {}) {
  syncValueCapturePolicy({ check });
  const replacement = visualCaptureRuntimeSource();
  for (const name of ['hook.early.js', 'hook.main.js']) {
    const file = resolve(root, 'apps/production-extension', name), before = readFileSync(file, 'utf8');
    const from = before.indexOf('  // packages/sensors/src/visual.ts\n'), to = before.indexOf('  // packages/sensors/src/canvas.ts\n', from);
    if (from < 0 || to <= from) throw Error(name + ': canonical visual producer boundaries changed.');
    const after = before.slice(0, from) + replacement + before.slice(to);
    if (check && before !== after) throw Error(name + ': visual producer synchronization required.');
    if (!check && before !== after) writeFileSync(file, after);
  }
  return replacement;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check'); syncVisualCapture({ check });
  console.log((check ? 'checked' : 'synchronized') + ' canonical visual producer');
}
