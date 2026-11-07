// ADR-037: exact guarded changes to shared Pro wire validation and background integration.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..'), check = process.argv.includes('--check');
const canonical = readFileSync(resolve(root, 'packages/contracts/src/pro-cookie-values.mjs'), 'utf8');
const contract = resolve(root, 'apps/production-extension/pro-cookie-values-contracts.js');
if (check) { if (readFileSync(contract, 'utf8') !== canonical) throw Error('Pro Cookie contract drift'); } else writeFileSync(contract, canonical);
for (const name of ['background.js', 'popup.js', 'sidepanel.js', 'report.js']) {
  const file = resolve(root, 'apps/production-extension', name), before = readFileSync(file, 'utf8'); let source = before;
  for (const variable of ['p', 'p3']) {
    const marker = `if (Object.hasOwn(${variable}, "cookieProbes")) pageFields.push("cookieProbes");`;
    const addition = ` if (Object.hasOwn(${variable}, "cookieValues")) pageFields.push("cookieValues");`;
    if (source.includes(marker) && !source.includes(marker + addition)) source = source.replaceAll(marker, marker + addition);
    source = source.replaceAll(`readAdvancedPageFields(${variable})`, `readAdvancedPageFields(${variable}, ${variable === 'p' ? 'v' : 'v3'})`);
  }
  if (name === 'background.js') {
    if (!source.includes('import { ProCookieValuesObserver }')) source = 'import { ProCookieValuesObserver } from "./pro-cookie-values.js";\n' + source;
    const marker = '    this.cookies = new CookieInspector(this, { host: sanitizeHost, redact: redactHost, site: registrableDomain });';
    if (!source.includes('this.proCookieValues = new ProCookieValuesObserver')) source = source.replace(marker, marker + '\n    this.proCookieValues = new ProCookieValuesObserver(this);');
    source = source.replace('this.proCookieValues = new ProCookieValuesObserver(this);', 'this.proCookieValues = new ProCookieValuesObserver(this, { site: registrableDomain });');
    const page = 'let page = { id: "page-" + this.nextPage++, tabId, documentKey: documentKey3, url: safe.url, title: "", startedAt: at2, endedAt: null, reports: [], resources: [] };';
    if (!source.includes('this.runtime.proCookieValues?.beginPage(page)')) source = source.replace(page, page + '\n    this.runtime.proCookieValues?.beginPage(page);');
    source = source.replaceAll('    this.cookieCapture.stop();\n    this.stopValueCapture();', '    this.cookieCapture.stop();\n    this.runtime.proCookieValues?.stop();\n    this.stopValueCapture();');
    source = source.replaceAll('this.pro.afterEvent(event, before), this.documentAccess', 'this.pro.afterEvent(event, before), this.proCookieValues.onEvent(event), this.documentAccess');
    const budget = '      if (page.socialNetworks) this.size("social:" + page.id, JSON.stringify(page.socialNetworks).length * 2 + 256);';
    if (!source.includes('this.size("cookieValues:" + page.id')) source = source.replace(budget, budget + '\n      if (page.cookieValues) this.size("cookieValues:" + page.id, JSON.stringify(page.cookieValues).length * 2 + 512);');
    source = source.replaceAll('this.cookies.clear(); this.social.clear();', 'this.cookies.clear(); this.proCookieValues.clear(); this.social.clear();');
    source = source.replaceAll('this.cookies.forget(documentKey3); this.social.forget(documentKey3);', 'this.cookies.forget(documentKey3); this.proCookieValues.forget(documentKey3); this.social.forget(documentKey3);');
    const listener = 'chrome.webRequest.onSendHeaders.addListener(details => background.runtime.cookies.observe(details, "request"), { urls: ["http://*/*", "https://*/*"] }, ["requestHeaders"]);';
    if (!source.includes('background.runtime.proCookieValues.observe(details)')) source = source.replace(listener, listener + '\ntry {\n  chrome.webRequest.onSendHeaders.addListener(details => background.runtime.proCookieValues.observe(details), { urls: ["http://*/*", "https://*/*"] }, ["requestHeaders", "extraHeaders"]);\n  background.runtime.proCookieValues.setSupported(true);\n} catch { background.runtime.proCookieValues.setSupported(false); }');
  }
  if (check) { if (source !== before) throw Error(name + ': Pro Cookie sync required'); }
  else if (source !== before) writeFileSync(file, source);
}
