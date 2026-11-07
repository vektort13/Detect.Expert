// ADR-075: additive integration preserves the delivered detector/Protect runtime.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..'), check = process.argv.includes('--check'), changes = [];
function prepare(relative, transform) {
  const path = resolve(root, relative), before = existsSync(path) ? readFileSync(path, 'utf8') : '', after = transform(before);
  if (before !== after) changes.push({ relative, path, after });
}
function insert(source, anchor, addition) {
  if (source.includes(addition)) return source;
  if (source.split(anchor).length !== 2) throw Error('Autosurf integration boundary: ' + anchor);
  return source.replace(anchor, anchor + addition);
}
const contract = readFileSync(resolve(root, 'packages/contracts/src/autosurf.mjs'), 'utf8');
prepare('apps/production-extension/autosurf-shared.js', () => contract);
prepare('apps/production-extension/background.js', source => {
  // Preserve adjacent imports and the generated ADR-048 block as indivisible anchors.
  source = source.replaceAll('import { installAutosurfService } from "./autosurf-service.js";\n', '')
    .replaceAll('// ADR-075: independent, Options-only service; no change to detector hooks.\nbackground.runtime.autosurf = installAutosurfService(chrome);\n', '');
  source = insert(source, 'import { createProxyPrivacyOverlay } from "./proxy-privacy.js";\n', 'import { installAutosurfService } from "./autosurf-service.js";\n');
  return insert(source, '// ADR-048 API configuration integration end\n',
    '// ADR-075: independent, Options-only service; no change to detector hooks.\nbackground.runtime.autosurf = installAutosurfService(chrome);\n');
});
prepare('apps/production-extension/options.html', source => {
  source = insert(source, '    <link rel="stylesheet" href="cookies-ui.css" />', '\n    <link rel="stylesheet" href="autosurf.css" />');
  return insert(source, '    <link rel="stylesheet" href="autosurf.css" />', '\n    <link rel="stylesheet" href="autosurf-sites.css" />');
});
if (check && changes.length) throw Error('Autosurf synchronization needed: ' + changes.map(item => item.relative).join(', '));
for (const { path, after } of check ? [] : changes) writeFileSync(path, after);
console.log((check ? 'checked' : 'synchronized') + ' Autosurf contract, service and stylesheet');
