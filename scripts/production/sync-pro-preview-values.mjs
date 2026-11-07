// REQ-013: the recorded visit preview includes every retained API value document.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const directory = resolve(import.meta.dirname, '../../apps/production-extension'), check = process.argv.includes('--check');
for (const name of ['popup.js', 'sidepanel.js']) {
  const file = resolve(directory, name), before = readFileSync(file, 'utf8'); let source = before;
  const techniqueValues = '        u3(ProApiValues, { rows: values?.filter(row => row.techniqueId === item.techniqueId) }),\n';
  source = source.replace(techniqueValues, '');
  source = source.replace('function DocumentDetails({ report: report2, ordinal, values })', 'function DocumentDetails({ report: report2, ordinal })');
  const old = '      page.reports.map((report2, index) => /* @__PURE__ */ u3(DocumentDetails, { report: report2, ordinal: index + 1, values: page.apiValues?.find(value => value.documentKey === report2.documentKey)?.rows ?? [] }, report2.documentKey)),\n';
  const current = `      page.reports.map((report2, index) => /* @__PURE__ */ u3(DocumentDetails, { report: report2, ordinal: index + 1 }, report2.documentKey)),
      (page.apiValues ?? []).filter(document => document.rows.length > 0).map((document, index) => u3("section", {
        class: "pro-recorded-values", "data-pro-values-document": document.documentKey, children: [
          u3("h4", { children: [t3("report_data_title"), " · ", page.reports.find(report => report.documentKey === document.documentKey)?.host ?? t3("social_document", [String(index + 1)])] }),
          u3(ProApiValues, { rows: document.rows })
        ]
      }, document.documentKey)),
`;
  if (!source.includes(current)) {
    if (!source.includes(old)) throw Error(name + ': missing Pro visit value boundary');
    source = source.replace(old, current);
  }
  source = source.replace('u3(ProSocialSnapshot, { snapshots: page.socialNetworks })', 'u3(ProSocialSnapshot, { snapshots: page.socialNetworks, page })');
  if (source.includes(techniqueValues)) throw Error(name + ': filtered Pro values remain');
  if (check && source !== before) throw Error(name + ': Pro value preview drift');
  if (!check && source !== before) writeFileSync(file, source);
}
console.log((check ? 'checked' : 'synchronized') + ' Pro visit value preview');
