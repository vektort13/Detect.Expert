// E22-21 / ADR-067: ordinary ui-get-report accepts native Firefox frame IDs.
// Only the existing frameId bound changes. Tab IDs, counts and sender checks do not.
// The vendored Protect validator is outside this route and remains byte-identical.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(import.meta.dirname, '../..');
export const UI_FRAME_ID_BUNDLES = Object.freeze(['background.js', 'report.js']);
const marker = '    case "ui-get-report": {';
const endMarker = '    case "ui-pause":';
const before = 'let frameId = readInt(input.frameId, 0, 2147483647);';
const after = 'let frameId = readInt(input.frameId, 0, Number.MAX_SAFE_INTEGER);';

export function patchUiFrameIds(source, name = 'bundle') {
  const start = source.indexOf(marker), end = source.indexOf(endMarker, start);
  if (start < 0 || end <= start || source.indexOf(marker, start + marker.length) >= 0) throw Error(name + ': ui-get-report boundary requires review');
  const block = source.slice(start, end), oldCount = block.split(before).length - 1, newCount = block.split(after).length - 1;
  if (oldCount + newCount !== 1) throw Error(name + ': ui-get-report frameId bound requires review');
  return source.slice(0, start) + block.replace(before, after) + source.slice(end);
}

export function syncUiFrameIds({ check = false, directory = resolve(root, 'apps/production-extension') } = {}) {
  for (const prefix of ['', 'baseline-ts/']) {
    const path = resolve(root, prefix + 'packages/contracts/src/validate.ts'), source = readFileSync(path, 'utf8');
    if (!source.includes("const frameId = readInt(input['frameId'], 0, Number.MAX_SAFE_INTEGER);")) throw Error(prefix + 'canonical ui-get-report frameId bound drift');
  }
  for (const name of UI_FRAME_ID_BUNDLES) {
    const path = resolve(directory, name), source = readFileSync(path, 'utf8'), next = patchUiFrameIds(source, name);
    if (check && next !== source) throw Error(name + ': frameId synchronization required');
    if (!check && next !== source) writeFileSync(path, next);
  }
  return UI_FRAME_ID_BUNDLES.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  console.log((check ? 'checked' : 'synchronized') + ' ui-get-report frame IDs: ' + syncUiFrameIds({ check }) + ' ordinary validators');
}
