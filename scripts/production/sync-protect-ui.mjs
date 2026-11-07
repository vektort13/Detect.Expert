// ADR-047 (S3, port plan §2.5 U1–U6, H1): wires the islands of the opt-in module «Защита» (protect-ui.js, built by
// build-protect.mjs) into the production popup, side panel and Options bundles. Idempotent; every place is found by an
// anchor string, never by a line number; `--check` changes nothing and exits 1 when a file is out of date.
//   U1 popup.js / sidepanel.js / options.js: `import { createProtectHostUi } from "./protect-ui.js";` right after the
//      Preact prefix marker (the hash of the prefix pinned in lint-inventory.json does not change);
//   U2 the host factory block after the shared blocking UI block (production Preact pieces: u3, d2, h2, A2);
//   U3 popup / side panel: shared API/Firewall row, then the report island (empty while the module is off);
//   U4 Options: the shared API/Firewall launcher row (ADR-051);
//   U5 Options: ProtectOptionsRoute — options.html#protect|#firewall|#history|#requests render the module page;
//   U6 Options: the root renders ProtectOptionsRoute instead of OptionsApp (protection.html keeps ProtectionPageApp);
//   H1 popup.html / sidepanel.html / options.html: protect.css last.
// Every insertion lies outside the locale block that updateProductionLocales rewrites on each build.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const directory = resolve(import.meta.dirname, '../../apps/production-extension');
const check = process.argv.includes('--check');

export const PREFIX_MARKER = '// packages/ui/src/view-models/message.ts\n';
export const DEPENDENCY = 'import { createProtectHostUi } from "./protect-ui.js";\n';
export const MANAGEMENT_DEPENDENCY = 'import { createManagementUi } from "./management-ui.js";\n';
export const NAVIGATION_DEPENDENCY = 'import { openManagement, adoptManagementEntry } from "./management-navigation.js";\n';
export const GUARD_DEPENDENCY = 'import { createGuardLaunchersUi, guardLauncherHasFirewall } from "./guard-launchers-ui.js";\n';
// ADR-103: group labels of the shared launcher row come from the local navigation labels.
export const GROUP_LABEL_DEPENDENCY = 'import { managementNavigationLabels } from "./management-navigation-labels.js";\n';
export const FACTORY_ANCHOR = '// end shared protection UI\n';
export const FACTORY_BEGIN = '// apps/production-protect/protect-host-ui — ADR-047\n';
export const FACTORY_END = '// end protect host UI\n';
export const FACTORY = FACTORY_BEGIN
  + GROUP_LABEL_DEPENDENCY
  + 'var { ProtectIsland, ProtectPage, isProtectHash } = createProtectHostUi({ h: u3, useState: d2, useEffect: h2, useRef: A2, useLocale, uiLocale, translate: (key, substitutions) => t3(key, substitutions), LanguagePicker });\n'
  + 'var { AntidetectLauncher, DpiGuardLauncher, UnavailableFirewallLauncher } = createGuardLaunchersUi({ h: u3, useState: d2, useEffect: h2, useRef: A2, useLocale, translate: (key, substitutions) => t3(key, substitutions), browserApi: chrome });\n'
  + 'var redesignGroupLabel = (group) => managementNavigationLabels(uiLocale())[group];\n'
  + FACTORY_END;
export const INSPECTOR_LAUNCHER = '    u3(ProtectionLauncher, { tabId: session.tabId, documentKey: session.report?.documentKey ?? null }, session.tabId),\n';
export const INSPECTOR_ISLAND = '    u3(ProtectIsland, { surface, tabId: session.tabId, openSidePanel: session.openSidePanel }, "protect-island"),\n';
export const OPTIONS_LAUNCHER = '    /* @__PURE__ */ u3(ProtectionLauncher, { tabId: null }),\n';
export const OPTIONS_ISLAND = '    u3(ProtectIsland, { surface: "options-launcher" }),\n';
// ADR-051: shared layout; the original API launcher remains intact inside the pair.
export const TOOLS_BEGIN = '    // ADR-051 shared launcher row start\n';
export const TOOLS_END = '    // ADR-051 shared launcher row end\n';
const tools = (launcher, embedded = false) => TOOLS_BEGIN
  + '    ' + (embedded ? '!embedded && ' : '') + 'u3("div", { class: "inspector-tools", "data-inspector-tools": true, children: [\n'
  + '    u3("p", { class: "inspector-tools__group", "data-inspector-tools-group": "defense", children: redesignGroupLabel("defense") }, "group-defense"),\n'
  + launcher
  + '    guardLauncherHasFirewall(chrome) ? u3(ProtectIsland, { surface: "launcher" }, "firewall-launcher") : u3(UnavailableFirewallLauncher, {}, "firewall-unavailable-launcher"),\n'
  + '    u3(DpiGuardLauncher, {}, "dpi-guard-launcher"),\n'
  + '    u3("p", { class: "inspector-tools__group", "data-inspector-tools-group": "attack", children: redesignGroupLabel("attack") }, "group-attack"),\n'
  + '    u3(AntidetectLauncher, { tabId: ' + (embedded ? 'null' : 'session.tabId') + ' }, "antidetect-launcher"),\n'
  + '    ] }),\n' + TOOLS_END;
export const INSPECTOR_TOOLS = tools(INSPECTOR_LAUNCHER);
export const OPTIONS_TOOLS = tools(OPTIONS_LAUNCHER, true);
export const ROUTE_ANCHOR = '// apps/extension/entrypoints/options/options.tsx\n';
export const ROUTE_BEGIN = '// apps/production-protect/protect-options-route — ADR-047\n';
export const ROUTE_END = '// end protect options route\n';
export const ROUTE = ROUTE_BEGIN + [
  'var { ManagementApp } = createManagementUi({ h: u3, useState: d2, useEffect: h2, useRef: A2, useLocale, translate: (key, substitutions) => t3(key, substitutions), LanguagePicker, OptionsApp, ProtectionPageApp, ProtectIsland, ProtectionLauncher, ApiConfigurationEditor: ProtectionSettings, sendUiRequest, browserApi: chrome });',
  'function ProtectOptionsRoute() {',
  '  let [ready, setReady] = d2(false);',
  '  h2(() => {',
  '    if (location.pathname === "/protection.html") { location.replace(chrome.runtime.getURL("options.html") + location.search + "#api"); return; }',
  '    let mounted = true;',
  '    adoptManagementEntry(chrome).then(render => { if (mounted && render) setReady(true); }, () => { if (mounted) setReady(true); });',
  '    return () => { mounted = false; };',
  '  }, []);',
  '  return location.pathname === "/protection.html" || !ready ? null : u3(ManagementApp, {});',
  '}',
].join('\n') + '\n' + ROUTE_END;
export const ROOT_BEFORE = 'u3(location.pathname === "/protection.html" ? ProtectionPageApp : OptionsApp, {}), root)';
export const LEGACY_ROOT_AFTER = 'u3(location.pathname === "/protection.html" ? ProtectionPageApp : ProtectOptionsRoute, {}), root)';
export const ROOT_AFTER = 'u3(ProtectOptionsRoute, {}), root)';
export const STYLESHEET_ANCHOR = '    <link rel="stylesheet" href="button-surfaces.css" />\n';
export const STYLESHEET = '    <link rel="stylesheet" href="protect.css" />\n';

function count(source, needle) {
  let n = 0;
  for (let i = source.indexOf(needle); i >= 0; i = source.indexOf(needle, i + needle.length)) n++;
  return n;
}

function once(source, needle, name, what) {
  const n = count(source, needle);
  if (n !== 1) throw new Error(name + ': ' + what + ' found ' + n + ' times (expected once)');
  return source.indexOf(needle);
}

/** Inserts `text` right after `anchor` unless it is already there. */
function insertAfter(source, anchor, text, name, what) {
  if (source.includes(anchor + text)) {
    if (count(source, text) !== 1) throw new Error(name + ': ' + what + ' duplicated');
    return source;
  }
  if (source.includes(text)) throw new Error(name + ': ' + what + ' present at an unexpected place');
  const at = once(source, anchor, name, what + ' anchor');
  return source.slice(0, at + anchor.length) + text + source.slice(at + anchor.length);
}

/** Replaces the marked block in place, or inserts it right after (`after`) or before `anchor`. */
function block(source, begin, end, text, anchor, after, name, what) {
  const first = source.indexOf(begin);
  if (first >= 0) {
    if (count(source, begin) !== 1) throw new Error(name + ': ' + what + ' duplicated');
    const last = source.indexOf(end, first + begin.length);
    if (last < 0) throw new Error(name + ': ' + what + ' end marker missing');
    return source.slice(0, first) + text + source.slice(last + end.length);
  }
  const at = once(source, anchor, name, what + ' anchor');
  if (after) return source.slice(0, at + anchor.length) + text + source.slice(at + anchor.length);
  return source.slice(0, at) + text + '\n' + source.slice(at);
}

function pairLaunchers(source, options, name) {
  const row = options ? OPTIONS_TOOLS : INSPECTOR_TOOLS;
  if (source.includes(TOOLS_BEGIN)) {
    return block(source, TOOLS_BEGIN, TOOLS_END, row, '', false, name, 'shared launcher row');
  }
  const launcher = options ? OPTIONS_LAUNCHER : INSPECTOR_LAUNCHER;
  const island = options ? OPTIONS_ISLAND : INSPECTOR_ISLAND;
  const legacy = insertAfter(source, launcher, island, name, 'legacy island');
  once(legacy, launcher + island, name, 'legacy launcher pair');
  return legacy.replace(launcher + island, row + (options ? '' : island));
}

export function patchBundle(name, before) {
  let source = before;
  source = source.replace('import { openManagement } from "./management-navigation.js";\n', NAVIGATION_DEPENDENCY);
  source = insertAfter(source, PREFIX_MARKER, DEPENDENCY, name, 'U1 protect-ui.js import');
  source = insertAfter(source, DEPENDENCY, NAVIGATION_DEPENDENCY, name, 'management navigation import');
  source = insertAfter(source, NAVIGATION_DEPENDENCY, GUARD_DEPENDENCY, name, 'guard launchers import');
  // ADR-103: the generic Options entry (popup gear) opens the Пульт.
  source = source.replaceAll('await chrome.runtime.openOptionsPage();', 'await openManagement("hub", null, chrome);').replaceAll('await openManagement("settings", null, chrome);', 'await openManagement("hub", null, chrome);');
  source = block(source, FACTORY_BEGIN, FACTORY_END, FACTORY, FACTORY_ANCHOR, true, name, 'U2 host factory');
  if (name === 'options.js') {
    source = insertAfter(source, GUARD_DEPENDENCY, MANAGEMENT_DEPENDENCY, name, 'management shell import');
    source = source.replace('function OptionsApp() {', 'function OptionsApp({ embedded = false } = {}) {');
    source = source.replace('u3(ConsentedOptions, { consent })', 'u3(ConsentedOptions, { consent, embedded })');
    source = source.replace('function ConsentedOptions({ consent }) {', 'function ConsentedOptions({ consent, embedded = false }) {');
    source = source.replaceAll('u3("header", { class: "header options-language-header",', '!embedded && u3("header", { class: "header options-language-header",');
    source = source.replaceAll('!embedded && !embedded && ', '!embedded && ');
    source = pairLaunchers(source, true, name);
    source = block(source, ROUTE_BEGIN, ROUTE_END, ROUTE, ROUTE_ANCHOR, false, name, 'U5 Options route');
    if (!source.includes(ROOT_AFTER)) {
      const previous = source.includes(LEGACY_ROOT_AFTER) ? LEGACY_ROOT_AFTER : ROOT_BEFORE;
      once(source, previous, name, 'U6 Options root');
      source = source.replace(previous, ROOT_AFTER);
    }
    once(source, ROOT_AFTER, name, 'U6 Options root');
    if (source.indexOf(ROUTE_BEGIN) > source.indexOf(ROUTE_ANCHOR)) throw new Error(name + ': U5 Options route after the entrypoint');
  } else {
    source = pairLaunchers(source, false, name);
  }
  // The factory follows the shared blocking UI block, which follows the Preact prefix and the production hooks.
  if (source.indexOf(FACTORY_BEGIN) < source.indexOf(FACTORY_ANCHOR)) throw new Error(name + ': host factory before the shared blocking UI block');
  for (const needle of ['function useLocale()', 'function uiLocale()', 'function LanguagePicker()']) {
    if (!source.includes(needle)) throw new Error(name + ': ' + needle + ' missing');
  }
  return source;
}

export function patchPage(name, before) {
  return insertAfter(before, STYLESHEET_ANCHOR, STYLESHEET, name, 'H1 protect.css');
}

function store(name, before, after, stale) {
  if (before === after) return;
  if (check) stale.push(name);
  else writeFileSync(resolve(directory, name), after, 'utf8');
}

function main() {
  const stale = [];
  for (const name of ['popup.js', 'sidepanel.js', 'options.js']) {
    const before = readFileSync(resolve(directory, name), 'utf8');
    store(name, before, patchBundle(name, before), stale);
  }
  for (const name of ['popup.html', 'sidepanel.html', 'options.html']) {
    const before = readFileSync(resolve(directory, name), 'utf8');
    store(name, before, patchPage(name, before), stale);
  }
  for (const name of ['options.html', 'protection.html']) {
    const before = readFileSync(resolve(directory, name), 'utf8');
    const stylesheet = '    <link rel="stylesheet" href="management-ui.css" />\n';
    let after = before.includes(stylesheet) ? before : before.replace('  </head>', stylesheet + '  </head>');
    if (name === 'options.html') {
      const cookies = '    <link rel="stylesheet" href="cookies-ui.css" />\n';
      after = after.includes(cookies) ? after : after.replace(STYLESHEET_ANCHOR, cookies + STYLESHEET_ANCHOR);
      const proxy = '    <link rel="stylesheet" href="proxy-ui.css" />\n';
      after = after.includes(proxy) ? after : after.replace(STYLESHEET_ANCHOR, proxy + STYLESHEET_ANCHOR);
    }
    store(name, before, after, stale);
  }
  if (stale.length > 0) {
    for (const name of stale) console.error('sync-protect-ui: ' + name + ' out of date (run node scripts/production/sync-protect-ui.mjs)');
    process.exit(1);
  }
  console.log('protect UI: islands, Options launcher, #protect route and protect.css synchronized' + (check ? ' (check)' : ''));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  try {
    main();
  } catch (error) {
    console.error('sync-protect-ui: ' + (error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
