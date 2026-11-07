// REQ-002/010/013: repeatable UI-only integration of local company logos.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const directory = resolve(import.meta.dirname, '../../apps/production-extension'), check = process.argv.includes('--check');
function store(file, before, after) {
  if (check) { if (before !== after) throw new Error(file + ': company UI synchronization required'); }
  else if (before !== after) writeFileSync(resolve(directory, file), after, 'utf8');
}
for (const file of ['popup.js', 'sidepanel.js', 'report.js']) {
  const before = readFileSync(resolve(directory, file), 'utf8'); let source = before;
  const dependency = 'import { createCompanyUi' + (file === 'report.js' ? ', waitForCompanyImages' : '') + ' } from "./company-ui.js";\nvar { CompanyLabel } = createCompanyUi({ h: u3 });\n';
  if (!source.includes(dependency)) source = source.replace('// packages/ui/src/view-models/message.ts\n', '// packages/ui/src/view-models/message.ts\n' + dependency);
  source = source.replace('dir: "auto", children: recognition.name }),', 'dir: "auto", children: u3(CompanyLabel, { name: recognition.name, identity: recognition.vendorId, size: "large" }) }),');
  if (file === 'report.js') {
    source = source.replace('u3("h5", { children: vendor2.name }),', 'u3("h5", { children: u3(CompanyLabel, { name: vendor2.name, identity: vendor2.vendorId }) }),');
    source = source.replace('u3("h3", { dir: "auto", children: vendor2.name }),', 'u3("h3", { dir: "auto", children: u3(CompanyLabel, { name: vendor2.name, identity: vendor2.vendorId, size: "large" }) }),');
    source = source.replace('painted.then(() => document.fonts.ready).then(() => !0, () => !1),', 'painted.then(() => Promise.all([document.fonts.ready, waitForCompanyImages(document)])).then(([, imagesReady]) => imagesReady, () => !1),');
  }
  if (!source.includes(dependency)) throw new Error(file + ': company import boundary missing');
  store(file, before, source);
}
{
  const file = 'identification-ui.js', before = readFileSync(resolve(directory, file), 'utf8'); let source = before;
  source = source.replace('import { cookieCompanyMark } from "./cookie-branding.js";', 'import { createCompanyUi } from "./company-ui.js";');
  if (!source.includes('const { CompanyLabel } = createCompanyUi({ h });')) source = source.replace('  const text = (key, substitutions = []) => translate(key, substitutions);', '  const { CompanyLabel } = createCompanyUi({ h });\n  const text = (key, substitutions = []) => translate(key, substitutions);');
  source = source.replace('h("strong", { children: SOCIAL_NAMES[row.service] ?? text("cookie_confidence_unknown") })', 'h("strong", { children: h(CompanyLabel, { name: SOCIAL_NAMES[row.service] ?? text("cookie_confidence_unknown"), identity: row.service }) })');
  source = source.replace('      const mark = cookieCompanyMark(entry.owner);\n', '');
  source = source.replace('      const mark = cookieCompanyMark(entry.owner), nameReference =', '      const nameReference =');
  const liveMark = `        h("span", { class: "cookie-company-mark" + (mark.src ? "" : " cookie-company-mark--fallback"), "data-cookie-brand": mark.brand ?? "monogram", "aria-hidden": "true",
          children: mark.src ? h("img", { src: mark.src, alt: "", width: 24, height: 24 }) : mark.monogram }),
`;
  source = source.replace(liveMark, '');
  source = source.replace('h("p", { class: "cookie-entry__company", children: ownerText(entry.owner) })', 'h("p", { class: "cookie-entry__company", children: h(CompanyLabel, { name: ownerText(entry.owner), identity: entry.owner }) })');
  source = source.replace('entry.owner ? row("cookie_owner", ownerText(entry.owner)) : null,', 'entry.owner ? row("cookie_owner", h(CompanyLabel, { name: ownerText(entry.owner), identity: entry.owner })) : null,');
  const reportMark = 'h("span", { class: "cookie-company-mark" + (mark.src ? "" : " cookie-company-mark--fallback"), "data-cookie-brand": mark.brand ?? "monogram", "aria-hidden": "true", children: mark.src ? h("img", { src: mark.src, alt: "", width: 24, height: 24 }) : mark.monogram }), ownerText(entry.owner)';
  source = source.replace(reportMark, 'h(CompanyLabel, { name: ownerText(entry.owner), identity: entry.owner })');
  source = source.replace('h("strong", { children: SERVICE_NAMES[row.source] })', 'h("strong", { children: h(CompanyLabel, { name: SERVICE_NAMES[row.source], identity: row.source }) })');
  source = source.replace('h("td", { children: SERVICE_NAMES[row.target] })', 'h("td", { children: h(CompanyLabel, { name: SERVICE_NAMES[row.target], identity: row.target }) })');
  if (!source.includes('class: "tag-manager-companies"')) source = source.replace('        h("table", { class: "tag-manager-table", children: [', '        h("div", { class: "tag-manager-companies", children: [...services].map(name => h(CompanyLabel, { name, identity: name, key: name })) }),\n        h("table", { class: "tag-manager-table", children: [');
  if (source.includes('cookieCompanyMark(') || source.includes('mark.src')) throw new Error(file + ': old owner badge remains');
  store(file, before, source);
}
{
  const file = 'advanced-ui.js', before = readFileSync(resolve(directory, file), 'utf8'); let source = before;
  if (!source.includes("import { createCompanyUi } from './company-ui.js';")) source = source.replace("import { readBeaconSnapshot, readBeaconDocuments } from './beacon-contracts.js';", "import { readBeaconSnapshot, readBeaconDocuments } from './beacon-contracts.js';\nimport { createCompanyUi } from './company-ui.js';");
  if (!source.includes('const { CompanyLabel } = createCompanyUi({ h });')) source = source.replace('  const text = (key, substitutions = []) => translate(key, substitutions);', '  const { CompanyLabel } = createCompanyUi({ h });\n  const text = (key, substitutions = []) => translate(key, substitutions);');
  source = source.replace("h('h3', { children: serviceNames[row.service] })", "h('h3', { children: h(CompanyLabel, { name: serviceNames[row.service], identity: row.service }) })");
  store(file, before, source);
}
for (const file of ['popup.html', 'sidepanel.html', 'report.html']) {
  const before = readFileSync(resolve(directory, file), 'utf8');
  const source = before.includes('href="company-ui.css"') ? before : before.replace('    <link rel="stylesheet" href="advanced-ui.css" />', '    <link rel="stylesheet" href="advanced-ui.css" />\n    <link rel="stylesheet" href="company-ui.css" />');
  store(file, before, source);
}
console.log('Company UI: analysis, Pro and print use shared local logos' + (check ? ' (check)' : ''));
