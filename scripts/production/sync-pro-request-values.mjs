// ADR-039: exact Pro-only native request value integration. No manifest changes.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..'), check = process.argv.includes('--check');
const canonical = readFileSync(resolve(root, 'packages/contracts/src/pro-request-values.mjs'), 'utf8');
const contract = resolve(root, 'apps/production-extension/pro-request-values-contracts.js');
if (check) { if (readFileSync(contract, 'utf8') !== canonical) throw Error('Pro request contract drift'); } else writeFileSync(contract, canonical);
for (const name of ['background.js', 'popup.js', 'sidepanel.js', 'report.js']) {
  const file = resolve(root, 'apps/production-extension', name), before = readFileSync(file, 'utf8'); let source = before;
  const insert = (marker, addition, after = true) => {
    if (!source.includes(marker)) throw Error(name + ': request value integration boundary missing: ' + marker);
    let index = 0;
    while ((index = source.indexOf(marker, index)) >= 0) {
      if (after) {
        const end = index + marker.length;
        if (!source.startsWith(addition, end)) source = source.slice(0, end) + addition + source.slice(end);
        index = end + addition.length;
      } else {
        if (source.slice(Math.max(0, index - addition.length), index) !== addition) {
          source = source.slice(0, index) + addition + source.slice(index); index += addition.length;
        }
        index += marker.length;
      }
    }
  };
  for (const variable of ['p', 'p3']) {
    const marker = `if (Object.hasOwn(${variable}, "cookieValues")) pageFields.push("cookieValues");`;
    if (source.includes(marker)) insert(marker, ` if (Object.hasOwn(${variable}, "requestValues")) pageFields.push("requestValues");`);
  }
  if (name === 'background.js') {
    insert('import { ProCookieValuesObserver } from "./pro-cookie-values.js";', 'import { ProRequestValuesObserver } from "./pro-request-values.js";\n', false);
    insert('    this.proCookieValues = new ProCookieValuesObserver(this, { site: registrableDomain });', '\n    this.proRequestValues = new ProRequestValuesObserver(this, { site: registrableDomain });');
    insert('    this.runtime.proCookieValues?.beginPage(page);', '\n    this.runtime.proRequestValues?.beginPage(page);');
    insert('    this.runtime.proCookieValues?.stop();', '\n    this.runtime.proRequestValues?.stop();');
    insert('this.proCookieValues.onEvent(event),', ' this.proRequestValues.onEvent(event),');
    insert('      if (page.cookieValues) this.size("cookieValues:" + page.id, JSON.stringify(page.cookieValues).length * 2 + 512);', '\n      if (page.requestValues) this.size("requestValues:" + page.id, JSON.stringify(page.requestValues).length * 2 + 512);');
    insert('this.proCookieValues.clear();', ' this.proRequestValues.clear();');
    insert('this.proCookieValues.forget(documentKey3);', ' this.proRequestValues.forget(documentKey3);');
    const listener = '} catch { background.runtime.proCookieValues.setSupported(false); }';
    insert(listener, '\ntry {\n  chrome.webRequest.onSendHeaders.addListener(details => background.runtime.proRequestValues.observe(details), { urls: ["http://*/*", "https://*/*"] }, ["requestHeaders", "extraHeaders"]);\n  background.runtime.proRequestValues.setSupported(true);\n} catch { background.runtime.proRequestValues.setSupported(false); }');
  }
  if (check) { if (source !== before) throw Error(name + ': Pro request value sync required'); }
  else if (source !== before) writeFileSync(file, source);
}
