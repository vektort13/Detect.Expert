import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const canonical = readFileSync(resolve(root, 'packages/contracts/src/inspection.mjs'), 'utf8');
writeFileSync(resolve(root, 'apps/production-extension/inspection-contracts.js'), canonical);
const names = ['readCookieSnapshot', 'readLoaderRows', 'readTagManagerDocuments', 'readSocialRows', 'readSocialDocuments', 'normalizeProCookieMetadata'];
const embedded = '// ADR-021 inspection contract start\nvar inspectionContracts = (() => {\n' + canonical.replaceAll('export ', '') + '\nreturn { ' + names.join(', ') + ' };\n})();\nvar ' + names.map(name => name + ' = inspectionContracts.' + name).join(', ') + ';\n// ADR-021 inspection contract end\n';
for (const name of ['background.js', 'bridge.js', 'popup.js', 'sidepanel.js', 'report.js']) {
  const file = resolve(root, 'apps/production-extension', name);
  let source = readFileSync(file, 'utf8');
  if (name === 'bridge.js') {
    const start = source.indexOf('// ADR-021 inspection contract start\n');
    if (start >= 0) { const end = source.indexOf('// ADR-021 inspection contract end\n', start) + '// ADR-021 inspection contract end\n'.length; source = source.slice(0, start) + source.slice(end); }
    source = embedded + source;
  } else {
    const declaration = 'import { ' + names.join(', ') + ' } from "./inspection-contracts.js";\n';
    source = source.replace(/^import \{ readCookieSnapshot, readLoaderRows, readTagManagerDocuments(?:, readSocialRows, readSocialDocuments)?(?:, normalizeProCookieMetadata)? \} from "\.\/inspection-contracts\.js";\n/m, '');
    const marker = '// packages/ui/src/view-models/message.ts\n';
    if (name === 'background.js') source = declaration + source;
    else { if (!source.includes(marker)) throw new Error('missing UI dependency boundary: ' + name); source = source.replace(marker, marker + declaration); }
  }
  for (const variable of ['p', 'p3']) {
    const marker = `if (Object.hasOwn(${variable}, "apiValues")) pageFields.push("apiValues");`;
    const suffix = ` if (Object.hasOwn(${variable}, "cookies")) pageFields.push("cookies"); if (Object.hasOwn(${variable}, "tagManager")) pageFields.push("tagManager"); if (Object.hasOwn(${variable}, "socialNetworks")) pageFields.push("socialNetworks");`;
    const oldSuffix = ` if (Object.hasOwn(${variable}, "cookies")) pageFields.push("cookies"); if (Object.hasOwn(${variable}, "tagManager")) pageFields.push("tagManager");`;
    if (source.includes(marker + oldSuffix) && !source.includes(marker + suffix)) source = source.replaceAll(marker + oldSuffix, marker + suffix);
    else if (source.includes(marker) && !source.includes(marker + suffix)) source = source.replaceAll(marker, marker + suffix);
    const guard = `if (Object.hasOwn(${variable}, "apiValues") && proValueDocuments(`;
    const extended = `if (Object.hasOwn(${variable}, "cookies") && readCookieSnapshot(${variable}.cookies) === null || Object.hasOwn(${variable}, "tagManager") && readTagManagerDocuments(${variable}.tagManager) === null || Object.hasOwn(${variable}, "socialNetworks") && readSocialDocuments(${variable}.socialNetworks) === null || Object.hasOwn(${variable}, "apiValues") && proValueDocuments(`;
    const oldExtended = `if (Object.hasOwn(${variable}, "cookies") && readCookieSnapshot(${variable}.cookies) === null || Object.hasOwn(${variable}, "tagManager") && readTagManagerDocuments(${variable}.tagManager) === null || Object.hasOwn(${variable}, "apiValues") && proValueDocuments(`;
    if (source.includes(oldExtended)) source = source.replaceAll(oldExtended, extended);
    if (source.includes(guard)) source = source.replaceAll(guard, extended);
  }
  writeFileSync(file, source);
}
