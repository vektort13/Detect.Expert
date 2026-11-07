// ADR-103: presentation patches of the popup and side panel Inspector ("Calm glass").
// Idempotent; every place is found by an anchor string, never by a line number;
// `--check` changes nothing and exits 1 when a bundle is out of date.
//   R1 helpers block (labels import, coverage tone, BrandLinks, InspectorSiteCard) before the InspectorView module;
//   R2 Brand keeps the labeled observation switch and links only where Brand stands alone (consent gate);
//   R3 the Inspector shows a site card (host, coverage chip, labeled observation switch) and footer links;
//   R4 mode tabs read «Обзор» / «Запись Pro»; R5 headings follow REQ-007; R6 the clear action is not full-width.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const directory = resolve(import.meta.dirname, '../../apps/production-extension');
const check = process.argv.includes('--check');

export const HELPERS_ANCHOR = '// packages/ui/src/app/InspectorView.tsx\n';
export const HELPERS_BEGIN = '// ADR-103 redesign helpers\n';
export const HELPERS_END = '// end ADR-103 redesign helpers\n';
const link = (href, label) => '      u3("a", { class: "inspector-brand__link", href: "' + href + '", target: "_blank", rel: "noreferrer noopener", children: ["' + label + ' ", u3("span", { "aria-hidden": "true", children: "↗" })] }),\n';
export const HELPERS = HELPERS_BEGIN
  + 'import { redesignLabels } from "./redesign-labels.js";\n'
  + 'var redesignText = (key) => redesignLabels(uiLocale())[key];\n'
  + 'var redesignCoverageTone = (coverage) => coverage?.state === "active" ? "ok" : coverage?.tone === "attention" ? "warn" : coverage?.tone === "error" ? "err" : "off";\n'
  + 'function BrandLinks() {\n'
  + '  return u3("nav", { class: "inspector-brand__links", "aria-label": "detect.expert", children: [\n'
  + link('https://detect.expert', 'detect.expert') + link('https://anti.bot', 'anti.bot') + link('https://antidetect.com', 'antidetect.com')
  + '  ] });\n'
  + '}\n'
  + 'function InspectorSiteCard({ host, coverage, tabId, embedded }) {\n'
  + '  return u3("section", { class: "inspector-sitecard", "data-inspector-sitecard": true, children: [\n'
  + '    u3("div", { class: "inspector-sitecard__site", children: [\n'
  + '      host ? u3("p", { class: "inspector-site", children: u3(SiteLabel, { host, size: 24 }) }) : u3("p", { class: "inspector-site inspector-site--empty", children: t3("host_unknown") }),\n'
  + '      coverage?.title ? u3("span", { class: "rd-chip rd-chip--" + redesignCoverageTone(coverage), "data-coverage-state": coverage.state, children: tm(coverage.title) }) : null\n'
  + '    ] }),\n'
  + '    embedded ? null : u3(ObservationControl, { tabId, labeled: true })\n'
  + '  ] });\n'
  + '}\n'
  + HELPERS_END;

const MODE_TABS_START = '    /* @__PURE__ */ u3("div", { class: "inspector-mode-tabs", children: /* @__PURE__ */ u3(\n';
const MODE_TABS_END = '\n    ) }),\n';
const MODE_TABS_AFTER = '    u3(ProtectIsland, { surface, tabId: session.tabId, openSidePanel: session.openSidePanel }, "protect-island"),\n';
const PRECURSOR_LINE = '    u3(PrecursorPanel, { session, enabled: ';
const LINKS_START = '    /* @__PURE__ */ u3("div", { class: "inspector-brand__links", children: [';
const LINKS_END = '\n  ] });\n}\nfunction TechniqueDetail(';
export const LINKS_AFTER = '    observation ? u3(BrandLinks, {}) : null';
// [from, to, sidepanelTo?]: only the popup InspectorView declares `embedded` (it hosts the Options
// Detector embed); the side panel bundle receives the fixed non-embedded form.
export const REPLACEMENTS = Object.freeze([
  ['function Brand({ onOpenOptions, onOpenSidePanel, tabId = null } = {}) {', 'function Brand({ onOpenOptions, onOpenSidePanel, tabId = null, observation = true } = {}) {'],
  ['      u3(ObservationControl, { tabId })\n      ] }),', '      observation ? u3(ObservationControl, { tabId, labeled: true }) : null\n      ] }),'],
  ['"data-action": "open-options", "aria-label": t3("open_options"), title: t3("open_options"),', '"data-action": "open-options", "aria-label": redesignText("hub"), title: redesignText("hub"),'],
  ['u3(Brand, { onOpenOptions: session.openOptions, onOpenSidePanel: surface === "popup" ? session.openSidePanel : undefined, tabId: session.tabId })', 'u3(Brand, { onOpenOptions: session.openOptions, onOpenSidePanel: surface === "popup" ? session.openSidePanel : undefined, tabId: session.tabId, observation: false })'],
  ['    report2?.host ? u3("p", { class: "inspector-site", children: u3(SiteLabel, { host: report2.host, size: 24 }) }) : null,\n', '    u3(InspectorSiteCard, { host: report2?.host ?? null, coverage: vm.coverage, tabId: session.tabId, embedded }),\n',
   '    u3(InspectorSiteCard, { host: report2?.host ?? null, coverage: vm.coverage, tabId: session.tabId, embedded: false }),\n'],
  ['tabs: [{ id: "light", label: t3("mode_light_tab") }, { id: "pro", label: t3("mode_pro_tab") }]', 'tabs: [{ id: "light", label: redesignText("overview") }, { id: "pro", label: redesignText("proRecording") }]'],
  ['    /* @__PURE__ */ u3("h2", { id: headingId, class: "section__title", children: t3("identification_vendors_title") }),\n    props.navigation ?? null,\n',
   '    props.navigation ? u3("h2", { class: "section__title inspector-observed-title", children: redesignText("observed") }) : null,\n    props.navigation ?? null,\n    /* @__PURE__ */ u3("h2", { id: headingId, class: "section__title" + (props.navigation ? " inspector-vendors-title" : ""), children: t3("vendorsSectionTitle") }),\n'],
  ['u3("p", { class: "inspector-empty", children: t3("vendorsEmpty") })', 'u3("div", { class: "inspector-empty inspector-empty--vendors", children: [u3("strong", { children: redesignText("noVendors") }), u3("span", { class: "small muted", children: redesignText("vendorsHint") })] })'],
  ['            class: "button ui-button-icon",\n            style: { width: "100%" },\n            "data-action": "clear-light-results",', '            class: "button ui-button-icon",\n            "data-action": "clear-light-results",'],
  // Owner: the «Подробности распознавания» mechanism block is removed; dated catalogue systems are
  // listed in its place inside the recognized services section.
  ['    /* @__PURE__ */ u3("details", { class: "vendors-method", children: [\n      /* @__PURE__ */ u3("summary", { children: t3("vendors_details") }),\n      /* @__PURE__ */ u3("div", { children: [\n        /* @__PURE__ */ u3("p", { class: "small muted", children: t3("vendors_mechanism") }),\n        /* @__PURE__ */ u3("p", { class: "small muted", children: t3("vendors_catalog_coverage", [String(CATALOG_PRODUCT_COUNT), String(CATALOG_RULE_COUNT), String(CATALOG_RTC_RULE_COUNT)]) })\n      ] })\n    ] })\n',
   '    props.catalog ?? null\n'],
  ['            /* @__PURE__ */ u3("summary", { children: t3("vendors_details") }),\n            props.scope !== "recording" || expanded',
   '            /* @__PURE__ */ u3("summary", { children: t3("detail_show") }),\n            props.scope !== "recording" || expanded'],
  // The Third Party panel places API use in embedded documents between request kinds and domains.
  ['        u3(ThirdPartyPanel, { thirdParty }),\n      otherGroups.length > 0 || session.frameOverviewsTruncated ? ', '        u3(ThirdPartyPanel, { thirdParty, embedded: otherGroups.length > 0 || session.frameOverviewsTruncated ? '],
  ['t3("inspector_other_documents_limit", [String(FRAME_OVERVIEW_LIMIT)]) }) : null\n      ] }) : null,\n', 't3("inspector_other_documents_limit", [String(FRAME_OVERVIEW_LIMIT)]) }) : null\n      ] }) : null }),\n'],
  ['hidden: mode.mode !== "pro", children: /* @__PURE__ */ u3(ProModeView, { tabId: session.tabId, visible: mode.mode === "pro" }) })\n  ] });',
   'hidden: mode.mode !== "pro", children: /* @__PURE__ */ u3(ProModeView, { tabId: session.tabId, visible: mode.mode === "pro" }) }),\n    embedded ? null : u3(BrandLinks, {})\n  ] });',
   'hidden: mode.mode !== "pro", children: /* @__PURE__ */ u3(ProModeView, { tabId: session.tabId, visible: mode.mode === "pro" }) }),\n    u3(BrandLinks, {})\n  ] });'],
]);

function count(source, needle) {
  let n = 0;
  for (let i = source.indexOf(needle); i >= 0; i = source.indexOf(needle, i + needle.length)) n++;
  return n;
}

export function patchInspector(name, before) {
  let source = before;
  // R1: the helpers block lives right before the InspectorView module.
  const first = source.indexOf(HELPERS_BEGIN);
  if (first >= 0) {
    if (count(source, HELPERS_BEGIN) !== 1) throw new Error(name + ': helpers duplicated');
    const last = source.indexOf(HELPERS_END, first);
    if (last < 0) throw new Error(name + ': helpers end marker missing');
    source = source.slice(0, first) + HELPERS + source.slice(last + HELPERS_END.length);
  } else {
    if (count(source, HELPERS_ANCHOR) !== 1) throw new Error(name + ': InspectorView anchor found ' + count(source, HELPERS_ANCHOR) + ' times');
    const at = source.indexOf(HELPERS_ANCHOR);
    source = source.slice(0, at) + HELPERS + source.slice(at);
  }
  // R2: links leave the standalone Brand only through the observation flag.
  if (!source.includes(LINKS_AFTER + LINKS_END)) {
    const start = source.indexOf(LINKS_START);
    if (start < 0 || count(source, LINKS_START) !== 1) throw new Error(name + ': brand links anchor');
    const end = source.indexOf(LINKS_END, start);
    if (end < 0) throw new Error(name + ': brand links end anchor');
    source = source.slice(0, start) + LINKS_AFTER + source.slice(end);
  }
  // R7: mode tabs follow the module row and its report island (visual and focus order agree).
  const tabsStart = source.indexOf(MODE_TABS_START);
  if (tabsStart < 0 || count(source, MODE_TABS_START) !== 1) throw new Error(name + ': mode tabs anchor');
  const tabsEnd = source.indexOf(MODE_TABS_END, tabsStart);
  if (tabsEnd < 0) throw new Error(name + ': mode tabs end anchor');
  const tabsBlock = source.slice(tabsStart, tabsEnd + MODE_TABS_END.length);
  // The Precursor panel stays directly after the report island (sync-precursor-runtime owns that pair).
  const placement = text => {
    if (count(text, MODE_TABS_AFTER) !== 1) throw new Error(name + ': island anchor');
    const island = text.indexOf(MODE_TABS_AFTER) + MODE_TABS_AFTER.length;
    if (!text.startsWith(PRECURSOR_LINE, island)) throw new Error(name + ': Precursor panel must follow the island');
    return text.indexOf('\n', island) + 1;
  };
  {
    const cut = source.slice(0, tabsStart) + source.slice(tabsEnd + MODE_TABS_END.length);
    const at = placement(cut);
    source = cut.slice(0, at) + tabsBlock + cut.slice(at);
  }
  for (const [from, to, sidepanelTo] of REPLACEMENTS) {
    const target = name === 'sidepanel.js' && sidepanelTo ? sidepanelTo : to;
    // Migrates a side panel bundle that was patched with the popup-only form.
    if (target !== to && source.includes(to)) source = source.split(to).join(target);
    if (source.includes(target)) { if (from !== target && source.includes(from)) throw new Error(name + ': both old and new forms of ' + target.slice(0, 60)); continue; }
    const n = count(source, from);
    if (n < 1) throw new Error(name + ': anchor missing: ' + from.slice(0, 80));
    source = source.split(from).join(target);
  }
  // A free `embedded` read in an InspectorView that does not declare it throws on every render.
  const view = source.indexOf('function InspectorView(');
  const body = source.slice(view, source.indexOf('\n// packages/', view));
  if (!/^function InspectorView\(\{[^}]*\bembedded\b/.test(body) && /(?<![\w.$])embedded(?!\s*:)(?![\w$])/.test(body)) throw new Error(name + ': InspectorView reads embedded without declaring it');
  if (source.indexOf(HELPERS_BEGIN) > source.indexOf('function InspectorView(')) throw new Error(name + ': helpers after the inspector');
  return source;
}

function main() {
  const stale = [];
  for (const name of ['popup.js', 'sidepanel.js']) {
    const file = resolve(directory, name), before = readFileSync(file, 'utf8'), after = patchInspector(name, before);
    if (before === after) continue;
    if (check) stale.push(name); else writeFileSync(file, after, 'utf8');
  }
  if (stale.length) {
    for (const name of stale) console.error('sync-redesign-ui: ' + name + ' out of date (run node scripts/production/sync-redesign-ui.mjs)');
    process.exit(1);
  }
  console.log('redesign UI: popup and side panel Inspector synchronized' + (check ? ' (check)' : ''));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  try { main(); } catch (error) { console.error('sync-redesign-ui: ' + (error instanceof Error ? error.message : String(error))); process.exit(1); }
}
