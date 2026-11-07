// ADR-078: additive inspector-only integration; no detector, report or message changes.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const check = process.argv.includes('--check'), changes = [];
function insert(source, anchor, addition) {
  if (source.includes(addition)) return source;
  if (source.split(anchor).length !== 2) throw Error('Site systems integration boundary: ' + anchor);
  return source.replace(anchor, anchor + addition);
}
for (const name of ['popup', 'sidepanel']) {
  const path = resolve(root, 'apps/production-extension/' + name + '.js'), before = readFileSync(path, 'utf8');
  const importLine = 'import { createSiteSystemsUi } from "./site-systems-ui.js";\n';
  let after = before;
  if (after.includes(importLine)) {
    if (after.split(importLine).length !== 2) throw Error('Duplicate site systems import');
    after = after.replace(importLine, '');
  }
  const importAnchor = 'import { createIdentificationUi, identificationCounts } from "./identification-ui.js";\n';
  if (after.split(importAnchor).length !== 2) throw Error('Site systems import boundary');
  // Preserve the existing identification → Precursor contiguous sync boundary.
  after = after.replace(importAnchor, importLine + importAnchor);
  after = insert(after, 'var { IdentificationNavigation, useCookieWriters, useCookies, useSocial, useThirdParty, CookiePanel, SocialPanel, ThirdPartyPanel, CookieWritersTable, ProCookieSnapshot, ProSocialSnapshot, ProTagManagerSection } = createIdentificationUi({ h: u3, useState: d2, useEffect: h2, useRef: A2, useLocale, browserApi: chrome, translate: (key, substitutions) => t3(key, substitutions) });\n',
    'var { SiteSystemsCatalog } = createSiteSystemsUi({ h: u3, useState: d2, useEffect: h2, useLocale, translate: (key, substitutions) => t3(key, substitutions) });\n');
  // ADR-103 (owner): the dated catalogue is listed inside the recognized services section, not beside it.
  const legacy = '      // ADR-078: local dated catalogue associations, outside observed vendor results.\n      u3(SiteSystemsCatalog, { host: report2?.host ?? null, visible: mode.mode === "light" && session.loaded, id: prefix + "-site-systems-catalog" }),\n';
  if (after.includes(legacy)) after = after.replace(legacy, '');
  const anchor = '          catalogAvailable: CATALOG_AVAILABLE,\n          vendors,\n';
  const component = '          // ADR-078/103: dated catalogue systems, labelled by source and outside counters.\n          catalog: u3(SiteSystemsCatalog, { host: report2?.host ?? null, visible: mode.mode === "light" && session.loaded, id: prefix + "-site-systems-catalog" }),\n';
  if (!after.includes(component)) {
    if (after.split(anchor).length !== 2) throw Error('Site systems component boundary');
    after = after.replace(anchor, anchor + component);
  }
  if (after !== before) changes.push({ path, after });
  const htmlPath = resolve(root, 'apps/production-extension/' + name + '.html'), htmlBefore = readFileSync(htmlPath, 'utf8');
  const htmlAfter = insert(htmlBefore, '    <link rel="stylesheet" href="company-ui.css" />', '\n    <link rel="stylesheet" href="site-systems-ui.css" />');
  if (htmlAfter !== htmlBefore) changes.push({ path: htmlPath, after: htmlAfter });
}
if (check && changes.length) throw Error('Site systems synchronization needed: ' + changes.map(item => item.path).join(', '));
if (!check) for (const { path, after } of changes) writeFileSync(path, after);
console.log((check ? 'checked' : 'synchronized') + ' site systems inspector catalogue');
