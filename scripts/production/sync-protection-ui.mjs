// ADR-033: one shared blocking editor, launched from both inspector modes.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const directory = resolve(import.meta.dirname, '../../apps/production-extension');
const check = process.argv.includes('--check');
const dependency = 'import { createProtectionUi } from "./protection-ui.js";\n';
const begin = '// apps/production-extension/protection-ui — ADR-033\n';
const end = '// end shared protection UI\n';
const factory = begin + 'var { ProtectionLauncher, ProtectionSettings } = createProtectionUi({ h: u3, useState: d2, useEffect: h2, useRef: A2, useLocale, translate: (key, substitutions) => t3(key, substitutions), browserApi: chrome, PROTECTION_FEATURES, MAX_PROTECTION_SITES, readProtectionSettings, readProtectionObservations, isProtectionHost, effectiveProtection, apiConfigurationEnabled: true });\n' + end;
const pageBegin = '// apps/production-extension/protection-page — ADR-033\n';
const pageEnd = '// end standalone protection page\n';
const page = pageBegin + `function ProtectionPageApp({ embedded = false, active = true, observedUsage = null } = {}) {
  useLocale();
  let consent = useDataConsent(), rawTabId = new URLSearchParams(location.search).get("tabId"), parsedTabId = rawTabId !== null && /^(0|[1-9][0-9]{0,15})$/.test(rawTabId) ? Number(rawTabId) : null;
  let targetTabId = Number.isSafeInteger(parsedTabId) && parsedTabId >= 0 ? parsedTabId : null;
  h2(() => { if (!embedded) document.title = t3("protection_page_title") + " — Detect.Expert"; });
  return u3("main", { class: "app app--options blocking-page", children: [
    !embedded && u3("header", { class: "header blocking-page-header", children: [
      u3("a", { class: "button blocking-page-back", href: chrome.runtime.getURL("options.html"), children: t3("protection_back") }),
      u3("h1", { class: "app__title", children: t3("protection_page_title") }),
      u3(LanguagePicker, {})
    ] }),
    consent.state?.accepted ? u3(ProtectionSettings, { tabId: targetTabId, global: true, active, observedUsage }) : u3(DataConsent, { consent })
  ] });
}
` + pageEnd;

function replaceBlock(source, start, stop, replacement, name) {
  const first = source.indexOf(start), last = source.indexOf(stop, first + start.length);
  if (first < 0 || last < first) throw new Error(name + ': integration boundary missing');
  return source.slice(0, first) + replacement + source.slice(last + stop.length);
}
function store(name, before, after) {
  if (check) { if (before !== after) throw new Error(name + ': blocking UI synchronization required'); }
  else if (before !== after) writeFileSync(resolve(directory, name), after, 'utf8');
}
for (const name of ['popup.js', 'sidepanel.js', 'options.js']) {
  const before = readFileSync(resolve(directory, name), 'utf8'); let source = before;
  if (!source.includes(dependency)) {
    const marker = '// packages/ui/src/view-models/message.ts\n';
    if (!source.includes(marker)) throw new Error(name + ': dependency boundary missing');
    source = source.replace(marker, marker + dependency);
  }
  if (source.includes(begin)) source = replaceBlock(source, begin, end, factory, name);
  else {
    const legacy = '// packages/ui/src/components/ProtectionPanel.tsx\n', first = source.indexOf(legacy), last = source.indexOf('\n// ', first + legacy.length);
    if (first < 0 || last < first) throw new Error(name + ': legacy editor missing');
    source = source.slice(0, first) + factory + source.slice(last);
  }
  if (name === 'options.js') {
    source = source.replace('u3(ProtectionPanel, { global: !0 })', 'u3(ProtectionLauncher, { tabId: null })');
    if (source.includes(pageBegin)) source = replaceBlock(source, pageBegin, pageEnd, page, name);
    else {
      const marker = '// apps/extension/entrypoints/options/options.tsx\n';
      if (!source.includes(marker)) throw new Error(name + ': page entrypoint missing');
      source = source.replace(marker, page + '\n' + marker);
    }
    source = source.replace('u3(OptionsApp, {}), root)', 'u3(location.pathname === "/protection.html" ? ProtectionPageApp : OptionsApp, {}), root)');
  } else {
    source = source.replace('      /* @__PURE__ */ u3(ProtectionPanel, { tabId: session.tabId, documentKey: session.report?.documentKey ?? null }, session.tabId),\n', '');
    const launcher = '    u3(ProtectionLauncher, { tabId: session.tabId, documentKey: session.report?.documentKey ?? null }, session.tabId),\n';
    if (!source.includes(launcher)) {
      const marker = '    mode.saveError ?';
      if (!source.includes(marker)) throw new Error(name + ': mode header missing');
      source = source.replace(marker, launcher + marker);
    }
  }
  if (source.includes('ProtectionPanel') || source.includes('function ProtectionEditor')) throw new Error(name + ': legacy editor remains');
  store(name, before, source);
}
for (const name of ['popup.html', 'sidepanel.html', 'options.html']) {
  const before = readFileSync(resolve(directory, name), 'utf8');
  const after = before.includes('href="protection-ui.css"') ? before : before.replace('    <link rel="stylesheet" href="ui.css" />', '    <link rel="stylesheet" href="ui.css" />\n    <link rel="stylesheet" href="protection-ui.css" />');
  store(name, before, after);
}
console.log('blocking UI: shared launcher/editor and standalone page synchronized' + (check ? ' (check)' : ''));
