// REQ-002: preserve action handlers while moving settings and adding local SVGs.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const directory = resolve(import.meta.dirname, '../../apps/production-extension'), check = process.argv.includes('--check');
const dependency = 'import { createActionIcons } from "./ui-action-icons.js";\n';
const oldFactory = 'var { GearIcon, BroomIcon } = createActionIcons(u3);\n';
const factory = 'var { GearIcon, BroomIcon, PinIcon } = createActionIcons(u3);\n';
function store(name, before, after) {
  if (check) { if (before !== after) throw new Error(name + ': UI actions synchronization required'); }
  else if (before !== after) writeFileSync(resolve(directory, name), after, 'utf8');
}
for (const name of ['popup.js', 'sidepanel.js']) {
  const before = readFileSync(resolve(directory, name), 'utf8'); let source = before;
  if (!source.includes(dependency)) source = source.replace('// packages/ui/src/view-models/message.ts\n', '// packages/ui/src/view-models/message.ts\n' + dependency);
  source = source.replace(oldFactory, factory);
  if (!source.includes(factory)) source = source.replace('// packages/ui/src/app/InspectorView.tsx\n', '// packages/ui/src/app/InspectorView.tsx\n' + factory);
  source = source.replace('function Brand() {', 'function Brand({ onOpenOptions } = {}) {');
  source = source.replace('function Brand({ onOpenOptions, tabId = null } = {}) {', 'function Brand({ onOpenOptions, onOpenSidePanel, tabId = null } = {}) {');
  source = source.replace('function Brand({ onOpenOptions } = {}) {', 'function Brand({ onOpenOptions, onOpenSidePanel } = {}) {');
  const old = '          /* @__PURE__ */ u3(LanguagePicker, {})\n        ] }),';
  const previousControls = `          u3("div", { class: "inspector-header-controls", children: [
            u3("button", { type: "button", class: "inspector-settings-button", "data-action": "open-options", "aria-label": t3("open_options"), title: t3("open_options"), onClick: onOpenOptions ?? (async () => { try { await chrome.runtime.openOptionsPage(); } catch {} }), children: u3(GearIcon, {}) }),
            u3(LanguagePicker, {})
          ] })
        ] }),`;
  const controls = previousControls.replace('            u3(LanguagePicker, {})\n', '            u3(LanguagePicker, {}),\n            typeof onOpenSidePanel === "function" ? u3("button", { type: "button", class: "inspector-pin-button", "data-action": "open-sidepanel", "aria-label": t3("open_sidepanel"), title: t3("open_sidepanel"), onClick: () => { onOpenSidePanel(); }, children: u3(PinIcon, {}) }) : null\n');
  source = source.replace(previousControls, controls);
  if (!source.includes('class: "inspector-header-controls"')) {
    if (!source.includes(old)) throw new Error(name + ': brand language boundary missing');
    source = source.replace(old, controls);
  }
  source = source.replace('    /* @__PURE__ */ u3(Brand, {}),\n    /* @__PURE__ */ u3("div", { class: "inspector-mode-tabs"', '    /* @__PURE__ */ u3(Brand, { onOpenOptions: session.openOptions }),\n    /* @__PURE__ */ u3("div", { class: "inspector-mode-tabs"');
  source = source.replace('u3(Brand, { onOpenOptions: session.openOptions, tabId: session.tabId })', 'u3(Brand, { onOpenOptions: session.openOptions, onOpenSidePanel: surface === "popup" ? session.openSidePanel : undefined, tabId: session.tabId })');
  source = source.replace('u3(Brand, { onOpenOptions: session.openOptions })', 'u3(Brand, { onOpenOptions: session.openOptions, onOpenSidePanel: surface === "popup" ? session.openSidePanel : undefined })');
  const panelFooter = `        /* @__PURE__ */ u3("div", { class: "actions", children: [
          surface === "popup" ? /* @__PURE__ */ u3("button", { type: "button", class: "button button--text", onClick: () => {
            session.openSidePanel();
          }, children: t3("open_sidepanel") }) : null
        ] })
`;
  source = source.replace(panelFooter, '');
  const footer = `          /* @__PURE__ */ u3("button", { type: "button", class: "button button--text", onClick: () => {
            session.openOptions();
          }, children: [
            /* @__PURE__ */ u3("span", { "aria-hidden": "true", children: "⚙ " }),
            t3("open_options")
          ] }),
`;
  source = source.replace(footer, '');
  source = source.replace('class: "button pro-clear-results",', 'class: "button pro-clear-results ui-button-icon",');
  source = source.replace('}, children: t3(recording ? "pro_stop_clear" : "action_clear_results") }),', '}, children: [u3(BroomIcon, {}), u3("span", { children: t3(recording ? "pro_stop_clear" : "action_clear_results") })] }),');
  source = source.replace('            class: "button",\n            style: { width: "100%" },\n            "data-action": "clear-light-results",', '            class: "button ui-button-icon",\n            style: { width: "100%" },\n            "data-action": "clear-light-results",');
  source = source.replace('            children: t3("action_clear_results")', '            children: [u3(BroomIcon, {}), u3("span", { children: t3("action_clear_results") })]');
  if (!source.includes(dependency) || !source.includes(factory) || !source.includes('"data-action": "open-sidepanel"') || !source.includes('onOpenSidePanel: surface === "popup" ? session.openSidePanel : undefined') || source.includes('children: "⚙ "') || source.includes('}, children: t3("open_sidepanel") }) : null')) throw new Error(name + ': action integration incomplete');
  store(name, before, source);
}
for (const name of ['popup.html', 'sidepanel.html']) {
  const before = readFileSync(resolve(directory, name), 'utf8');
  const source = before.includes('href="ui-actions.css"') ? before : before.replace('    <link rel="stylesheet" href="ui.css" />', '    <link rel="stylesheet" href="ui.css" />\n    <link rel="stylesheet" href="ui-actions.css" />');
  store(name, before, source);
}
console.log('UI actions: settings/language/pin header and broom icons synchronized' + (check ? ' (check)' : ''));
