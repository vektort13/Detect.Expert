import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCTION_LANGUAGES, EXTENSION_NAME } from './production-languages.mjs';
import { applyProTechnicalCopy, applyProductionCoverageCopy } from './production-locale-corrections.mjs';
import { applyProDetailsCopy } from './production-locales-pro-details.mjs';
import { PRO_DETAILS_CORRECTIONS as KO_TE_PRO_COPY } from './production-locales-pro-ko-te.mjs';
import { PRO_DETAILS_CORRECTIONS as MR_TA_PRO_COPY } from './production-locales-pro-mr-ta.mjs';
import { applyBrowserNeutralCopy } from './production-locales-browser-copy.mjs';
import { applyProGraphCopy } from './production-locales-pro-graph.mjs';
import { applyIdentificationCopy } from './production-locales-identification.mjs';
import { applyCookieReportCopy } from './production-locales-cookie-report.mjs';
import { applyCookiePurposeCopy } from './production-locales-cookie-purposes.mjs';
import { applySocialCopy } from './production-locales-social.mjs';
import { applySocialTrackingCopy } from './production-locales-social-tracking.mjs';
import { applyThirdPartyCopy } from './production-locales-third-party.mjs';
import { applyAdvancedCopy } from './production-locales-advanced.mjs';
import { applyBlockingCopy } from './production-locales-blocking.mjs';
import { applyExpandedBlockingCopy } from './production-locales-blocking-expanded.mjs';
import { applyCatalogBlockingCopy } from './production-locales-blocking-catalog.mjs';
import { applyBlockingFilterCopy } from './production-locales-blocking-filters.mjs';
import { applyProReportCopy } from './production-locales-report.mjs';
import { applyReviewCopy } from './production-locales-review.mjs';
import { applyObservationCopy } from './production-locales-observation.mjs';
import { applyManagementCopy } from './management-locales.mjs';
import { applyWebAssemblyCopy } from './production-locales-webassembly.mjs';
import { applyModeFilterCopy } from './production-locales-mode-filters.mjs';
import { applyModeActionCopy } from './production-locales-mode-actions.mjs';
import { applyWebRtcCopy } from './production-locales-webrtc.mjs';
import { applyWebRtcDiscoveryCopy } from './production-locales-webrtc-discovery.mjs';
import { applyBrowserDebugCopy } from './production-locales-browser-debug.mjs';
import { applyAntidetectCopy } from './production-locales-antidetect.mjs';
import { applyMathCopy } from './production-locales-math.mjs';
import { applyFingerprintCopy } from './production-locales-fingerprint.mjs';
import { applyApiObservedCopy } from './production-locales-api-observed.mjs';
import { applyGuardLauncherCopy } from './production-locales-guard-launchers.mjs';
import { applyCookiesCopy } from './production-locales-cookies.mjs';
import { applyProxyCopy } from './production-locales-proxy.mjs';
import { applyPrecursorCopy } from './production-locales-precursor.mjs';
import { applyPrecursorModesCopy, writePrecursorSettingsLocales } from './production-locales-precursor-modes.mjs';
import { applyAutosurfCopy } from './production-locales-autosurf.mjs';
import { applyAutosurfSitesCopy } from './production-locales-autosurf-sites.mjs';
import { applyMediaCopy } from './production-locales-media.mjs';

export function updateProductionLocales(directory) {
  const tables = {};
  for (const language of PRODUCTION_LANGUAGES) {
    const file = resolve(directory, language.uiOnly ? 'ui-locales' : '_locales', language.id, 'messages.json');
    const table = JSON.parse(readFileSync(file, 'utf8'));
    applyPrecursorCopy(table, language.id);
    applyPrecursorModesCopy(table, language.id);
    applyProTechnicalCopy(table, language.id);
    applyProDetailsCopy(table, language.id);
    for (const [key, message] of Object.entries(KO_TE_PRO_COPY[language.id] ?? {})) table[key].message = message;
    for (const [key, message] of Object.entries(MR_TA_PRO_COPY[language.id] ?? {})) table[key].message = message;
    applyBrowserNeutralCopy(table, language.id);
    applyProGraphCopy(table, language.id);
    applyProductionCoverageCopy(table, language.id);
    applyIdentificationCopy(table, language.id);
    applyCookieReportCopy(table, language.id);
    applyCookiePurposeCopy(table, language.id);
    applySocialCopy(table, language.id);
    applySocialTrackingCopy(table, language.id);
    applyThirdPartyCopy(table, language.id);
    applyAdvancedCopy(table, language.id);
    applyBlockingCopy(table, language.id);
    applyExpandedBlockingCopy(table, language.id);
    applyCatalogBlockingCopy(table, language.id);
    applyBlockingFilterCopy(table, language.id);
    applyProReportCopy(table, language.id);
    applyReviewCopy(table, language.id);
    applyObservationCopy(table, language.id);
    applyManagementCopy(table, language.id);
    applyWebAssemblyCopy(table, language.id);
    applyModeFilterCopy(table, language.id);
    applyModeActionCopy(table, language.id);
    applyWebRtcCopy(table, language.id);
    applyWebRtcDiscoveryCopy(table, language.id);
    applyBrowserDebugCopy(table, language.id);
    applyAntidetectCopy(table, language.id);
    applyMathCopy(table, language.id);
    applyFingerprintCopy(table, language.id);
    applyApiObservedCopy(table, language.id);
    applyGuardLauncherCopy(table, language.id);
    applyCookiesCopy(table, language.id);
    applyProxyCopy(table, language.id);
    applyAutosurfCopy(table, language.id);
    applyAutosurfSitesCopy(table, language.id);
    applyMediaCopy(table, language.id);
    table.extName.message = EXTENSION_NAME;
    writeFileSync(file, JSON.stringify(table, null, 2) + '\n', 'utf8');
    tables[language.id] = table;
  }
  writePrecursorSettingsLocales(directory);
  const tableSource = PRODUCTION_LANGUAGES.map((language, index) =>
    `var messages_default${index === 0 ? '' : index + 1} = ${JSON.stringify(tables[language.id], null, 2)};`
  ).join('\n\n');
  const tableMap = '{ ' + PRODUCTION_LANGUAGES.map((language, index) =>
    `${language.id}: messages_default${index === 0 ? '' : index + 1}`
  ).join(', ') + ' }';
  const languageSource = JSON.stringify(PRODUCTION_LANGUAGES.map(({ uiOnly: _uiOnly, ...language }) => language), null, 2);
  for (const name of ['popup.js', 'sidepanel.js', 'options.js', 'report.js']) {
    const file = resolve(directory, name);
    let source = readFileSync(file, 'utf8');
    const first = Math.max(source.indexOf('// apps/extension/_locales/ru/messages.json'), source.indexOf('// apps/production-extension/locales — generated by scripts/production-locales.mjs'));
    const last = source.indexOf('// packages/ui/src/i18n.ts', first);
    if (first < 0 || last < first) throw new Error(`${name}: locale data boundary missing`);
    source = source.slice(0, first) + '// apps/production-extension/locales — generated by scripts/production-locales.mjs\n' +
      tableSource + '\n\n' + source.slice(last);
    source = source.replace(/LANGUAGES = \[[\s\S]*?\]\.slice\(\)/, `LANGUAGES = ${languageSource}.slice()`);
    source = source.replace(/TABLES = \{[^\n]*?\}, selected =/, `TABLES = ${tableMap}, selected =`);
    source = source.replace(/function matchLocale\(language\) \{[\s\S]*?\n\}/,
      `function matchLocale(language) {\n  let base = language.toLowerCase().replaceAll("_", "-").split("-")[0];\n  return base === "zh" || base === "cmn" ? "zh_CN" : base === "pt" ? "pt_BR" : isUiLocale(base) ? base : "en";\n}`);
    // The established language picker uses SVG flags; add the four requested countries locally.
    if (!source.includes('const colors = flag === "de"')) source = source.replace('function LanguageFlag({ flag }) {', `function LanguageFlag({ flag }) {\n  if (flag === "de" || flag === "pl" || flag === "id" || flag === "kr") {\n    const colors = flag === "de" ? ["#000", "#dd0000", "#ffce00"] : flag === "pl" ? ["#fff", "#dc143c"] : flag === "id" ? ["#e70011", "#fff"] : ["#fff"];\n    return u3("svg", { class: "language-flag", "data-country": flag, viewBox: "0 0 30 20", width: "24", height: "16", "aria-hidden": "true", focusable: "false", children: [\n      ...colors.map((color, index) => u3("rect", { x: 0, y: index * 20 / colors.length, width: 30, height: 20 / colors.length, fill: color })),\n      ...(flag === "kr" ? [u3("path", { d: "M11 10a4 4 0 0 1 8 0c0 2-4 2-4 0s-4-2-4 0", fill: "#cd2e3a" }), u3("path", { d: "M11 10c0-2 4-2 4 0s4 2 4 0a4 4 0 0 1-8 0", fill: "#0047a0" }), u3("path", { d: "M5 5l3-3m-2 4l3-3m-2 4l3-3M20 16l3-3m-2 4l3-3m-2 4l3-3M21 3l3 3m-4-2l3 3m-4-2l3 3M6 13l3 3m-4-2l3 3m-4-2l3 3", stroke: "#000", "stroke-width": ".8" })] : [])\n    ] });\n  }`);
    writeFileSync(file, source, 'utf8');
  }
  const backgroundFile = resolve(directory, 'background.js');
  let background = readFileSync(backgroundFile, 'utf8');
  const labels = Object.fromEntries(PRODUCTION_LANGUAGES.map((language) => [language.id, tables[language.id].badge_tooltip]));
  background = background.replace(/(var BADGE_LANGUAGE_KEY = "ui-language-v1", labels = )\{[^\n]*\};/, (_match, prefix) => prefix + JSON.stringify(labels) + ';');
  background = background.replace('return base === "zh" ? "zh_CN"', 'return base === "zh" || base === "cmn" ? "zh_CN"');
  writeFileSync(backgroundFile, background, 'utf8');
  return { languages: PRODUCTION_LANGUAGES.length, keys: Object.keys(tables.en).length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(updateProductionLocales(resolve(process.argv[2] ?? 'apps/production-extension')));
}
