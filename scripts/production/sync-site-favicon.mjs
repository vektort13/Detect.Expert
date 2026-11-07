// ADR-035: repeatable native favicon integration; no wire/permission/CSP mutation.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const directory = resolve(import.meta.dirname, '../../apps/production-extension'), check = process.argv.includes('--check');
function store(file, before, after) {
  if (check) { if (before !== after) throw new Error(file + ': favicon synchronization required'); }
  else if (before !== after) writeFileSync(resolve(directory, file), after, 'utf8');
}
{
  const file = 'background.js', before = readFileSync(resolve(directory, file), 'utf8'); let source = before;
  const dependency = 'import { SiteFaviconCache } from "./site-favicon.js";\n';
  if (!source.includes(dependency)) source = dependency + source;
  const instance = `    this.siteIcons = new SiteFaviconCache(api, {
      ready: this.ready,
      host: url => reportHost(sanitizeHost(url)),
      authorize: ({ tabId, frame, origin }) => this.scope.accessReady && this.scope.inScope(sanitizeHost(frame.url), tabId, frame.documentId, origin.startsWith("https:") ? "https" : "http")
    });
`;
  if (!source.includes('this.siteIcons = new SiteFaviconCache(')) source = source.replace('    this.social = new SocialNetworkObserver(this, { host: sanitizeHost, redact: redactHost });', '    this.social = new SocialNetworkObserver(this, { host: sanitizeHost, redact: redactHost });\n' + instance.trimEnd());
  if (!source.includes('proCleared,\n      this.siteIcons.invalidate(),')) source = source.replace('      proCleared,\n', '      proCleared,\n      this.siteIcons.invalidate(),\n');
  if (!source.includes('  async onPermissionsChanged() {\n    await this.siteIcons.invalidate().catch(() => {});')) source = source.replace('  async onPermissionsChanged() {\n    this.cookies.clear();', '  async onPermissionsChanged() {\n    await this.siteIcons.invalidate().catch(() => {});\n    this.cookies.clear();');
  source = source.replace('  async onPermissionsChanged() {\n    await this.siteIcons.invalidate();', '  async onPermissionsChanged() {\n    await this.siteIcons.invalidate().catch(() => {});');
  source = source.replace('await this.protection.start();\n  }\n  documentAccess', 'await this.protection.start();\n    void this.siteIcons.refresh();\n  }\n  documentAccess');
  source = source.replace('await this.protection.accessChanged()), this.badge.markAll(), !0);', 'await this.protection.accessChanged(), void this.siteIcons.refresh()), this.badge.markAll(), !0);');
  source = source.replace('await this.flushIndex(), await this.visual.flush(), await this.rtc.flush();\n  }\n  reconcileAccess', 'await this.flushIndex(), await this.visual.flush(), await this.rtc.flush();\n    void this.siteIcons.refresh();\n  }\n  reconcileAccess');
  const listeners = `\n// ADR-035 native favicon listeners start
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "complete" || typeof change.favIconUrl === "string") void background.runtime.siteIcons.collect(tabId);
});
chrome.tabs.onRemoved.addListener(tabId => background.runtime.siteIcons.removed(tabId));
// ADR-035 native favicon listeners end
`;
  if (!source.includes('// ADR-035 native favicon listeners start')) source += listeners;
  if (!source.includes(instance.trimEnd()) || !source.includes('this.siteIcons.invalidate()') || !source.includes('void this.siteIcons.refresh()')) throw new Error('background: favicon lifecycle boundaries missing');
  store(file, before, source);
}
for (const file of ['popup.js', 'sidepanel.js', 'report.js']) {
  const before = readFileSync(resolve(directory, file), 'utf8'); let source = before;
  const dependency = 'import { createSiteIconUi' + (file === 'report.js' ? ', waitForSiteIcons' : '') + ' } from "./site-favicon-ui.js";\nvar { SiteIcon, SiteLabel } = createSiteIconUi({ h: u3, useState: d2, useEffect: h2, browserApi: chrome });\n';
  if (!source.includes(dependency)) source = source.replace('// packages/ui/src/view-models/message.ts\n', '// packages/ui/src/view-models/message.ts\n' + dependency);
  source = source.replace('dir: "auto", children: report2.host ?? t3("host_unknown") })', 'dir: "auto", children: u3(SiteLabel, { host: report2.host, label: report2.host ?? t3("host_unknown") }) })');
  if (file === 'report.js') {
    source = source.replace('class: "pro-report-domain report-code", children: session.domain })', 'class: "pro-report-domain report-code", children: u3(SiteLabel, { host: session.domain, size: 24 }) })');
    source = source.replace('class: "report-code", children: report2.host ?? t3("host_unknown") })', 'class: "report-code", children: u3(SiteLabel, { host: report2.host, label: report2.host ?? t3("host_unknown") }) })');
    source = source.replace('class: "pro-report-map__root", children: /* @__PURE__ */ u3("span", { class: "report-code", children: domain })', 'class: "pro-report-map__root", children: /* @__PURE__ */ u3("span", { class: "report-code", children: u3(SiteLabel, { host: domain }) })');
    source = source.replace('Promise.all([document.fonts.ready, waitForCompanyImages(document)])).then(([, imagesReady]) => imagesReady,', 'Promise.all([document.fonts.ready, waitForCompanyImages(document), waitForSiteIcons(document)])).then(([, imagesReady, siteIconsReady]) => imagesReady && siteIconsReady,');
  } else {
    source = source.replace('u3("dd", { dir: "auto", children: current?.currentDomain ?? t3("host_unknown") })', 'u3("dd", { dir: "auto", children: u3(SiteLabel, { host: current?.currentDomain, label: current?.currentDomain ?? t3("host_unknown") }) })');
    source = source.replace('u3("dd", { dir: "auto", children: session.domain })', 'u3("dd", { dir: "auto", children: u3(SiteLabel, { host: session.domain }) })');
    const label = '    report2?.host ? u3("p", { class: "inspector-site", children: u3(SiteLabel, { host: report2.host, size: 24 }) }) : null,\n';
    if (!source.includes('class: "inspector-site"')) source = source.replace('    /* @__PURE__ */ u3(Brand, { onOpenOptions: session.openOptions }),\n', '    /* @__PURE__ */ u3(Brand, { onOpenOptions: session.openOptions }),\n' + label);
  }
  if (!source.includes(dependency) || file !== 'report.js' && !source.includes('class: "inspector-site"') || file === 'report.js' && !source.includes('waitForSiteIcons(document)')) throw new Error(file + ': favicon display boundary missing');
  store(file, before, source);
}
for (const file of ['popup.html', 'sidepanel.html', 'report.html']) {
  const before = readFileSync(resolve(directory, file), 'utf8');
  const source = before.includes('href="site-favicon.css"') ? before : before.replace('    <link rel="stylesheet" href="company-ui.css" />', '    <link rel="stylesheet" href="company-ui.css" />\n    <link rel="stylesheet" href="site-favicon.css" />');
  if (!source.includes('href="site-favicon.css"')) throw new Error(file + ': company style integration required before favicon');
  store(file, before, source);
}
console.log('Site favicon: bounded native-tab PNG cache, shared analysis/Pro/print' + (check ? ' (check)' : ''));
