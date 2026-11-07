// ADR-030/031/032: Pro wire guards, privileged routes and lifetime cleanup.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..'), check = process.argv.includes('--check');
const read = path => readFileSync(resolve(root, path), 'utf8');
const canonical = read('packages/contracts/src/advanced-inspection.mjs');
const moduleSource = canonical.replace("'./beacons.mjs'", "'./beacon-contracts.js'").replace("'./background-activity.mjs'", "'./background-activity-contracts.js'").replace("'./cookie-probe.mjs'", "'./cookie-probe-contracts.js'").replace("'./pro-cookie-values.mjs'", "'./pro-cookie-values-contracts.js'").replace("'./cookie-writers.mjs'", "'./cookie-writers-contracts.js'").replace("'./pro-request-values.mjs'", "'./pro-request-values-contracts.js'");
const contractFile = resolve(root, 'apps/production-extension/advanced-contracts.js');
if (check) { if (readFileSync(contractFile, 'utf8') !== moduleSource) throw Error('advanced contract drift'); } else writeFileSync(contractFile, moduleSource);
for (const name of ['background.js', 'bridge.js', 'popup.js', 'sidepanel.js', 'report.js']) {
  const file = resolve(root, 'apps/production-extension', name), before = readFileSync(file, 'utf8'); let source = before;
  if (name === 'bridge.js') {
    const startMarker = '// ADR-030/031/032 Pro guard start\n', endMarker = '// ADR-030/031/032 Pro guard end\n';
    const start = source.indexOf(startMarker), end = source.indexOf(endMarker, start);
    if (start >= 0) { if (end < start) throw Error('advanced guard boundary'); source = source.slice(0, start) + source.slice(end + endMarker.length); }
    if (check && source !== before) throw Error('bridge: obsolete Pro guard cleanup required');
    if (!check && source !== before) writeFileSync(file, source);
    continue;
  } else {
    const dependency = 'import { readAdvancedPageFields } from "./advanced-contracts.js";\n';
    if (name !== 'background.js' && source.startsWith(dependency)) source = source.slice(dependency.length);
    if (!source.includes(dependency)) {
      if (name === 'background.js') source = dependency + source;
      else { const marker = '// packages/ui/src/view-models/message.ts\n'; if (!source.includes(marker)) throw Error(name + ': dependency boundary'); source = source.replace(marker, marker + dependency); }
    }
  }
  for (const variable of ['p', 'p3']) {
    const marker = `if (Object.hasOwn(${variable}, "socialNetworks")) pageFields.push("socialNetworks");`;
    const addition = ['beacons', 'backgroundActivity', 'cookieProbes'].map(field => ` if (Object.hasOwn(${variable}, "${field}")) pageFields.push("${field}");`).join('');
    if (source.includes(marker) && !source.includes(marker + addition)) source = source.replaceAll(marker, marker + addition);
    const guard = `if (Object.hasOwn(${variable}, "cookies") && readCookieSnapshot`;
    source = source.replaceAll(guard, `if (!readAdvancedPageFields(${variable}) || Object.hasOwn(${variable}, "cookies") && readCookieSnapshot`);
  }
  if (name === 'background.js') {
    const dependency = 'import { BeaconObserver } from "./beacon-observer.js";\nimport { readBeaconRequest } from "./beacon-contracts.js";\nimport { BackgroundActivityObserver } from "./background-activity-observer.js";\nimport { readBackgroundRequest } from "./background-activity-contracts.js";\nimport { CookieProbe } from "./cookie-probe.js";\nimport { readCookieProbeRequest } from "./cookie-probe-contracts.js";\nimport { retainCookieProbe } from "./pro-advanced-capture.js";\n';
    if (!source.includes('import { BeaconObserver }')) source = dependency + source;
    const marker = '    this.thirdParty = new ThirdPartyObserver(this, { host: sanitizeHost, redact: redactHost });';
    const init = '\n    this.beacons = new BeaconObserver(this, { host: sanitizeHost, redact: redactHost });\n    this.backgroundActivity = new BackgroundActivityObserver(this, { redact: redactHost });\n    this.cookieProbe = new CookieProbe(this.cookies, { onUpdate: snapshot => retainCookieProbe(this.pro, snapshot) });';
    if (!source.includes('this.backgroundActivity = new BackgroundActivityObserver')) { if (!source.includes(marker)) throw Error('advanced initializer'); source = source.replace(marker, marker + init); }
    source = source.replace(/this\.thirdParty\.forget\(documentKey3\);(?! this\.beacons\.forget)/g, 'this.thirdParty.forget(documentKey3); this.beacons.forget(documentKey3); this.backgroundActivity.forget(documentKey3); void this.cookieProbe.invalidate(documentKey3);');
    source = source.replace(/this\.thirdParty\.clear\(\);(?! this\.beacons\.clear)/g, 'this.thirdParty.clear(); this.beacons.clear(); this.backgroundActivity.clear(); void this.cookieProbe.invalidate();');
    // Make cleanup substitutions idempotent.
    source = source.replaceAll('void this.cookieProbe.invalidate(documentKey3); this.beacons.forget(documentKey3); this.backgroundActivity.forget(documentKey3); void this.cookieProbe.invalidate(documentKey3);', 'void this.cookieProbe.invalidate(documentKey3);');
    source = source.replaceAll('void this.cookieProbe.invalidate(); this.beacons.clear(); this.backgroundActivity.clear(); void this.cookieProbe.invalidate();', 'void this.cookieProbe.invalidate();');
    const routeMarker = '  if (messageType === "ui-get-third-party") {';
    const routes = '  if (messageType === "ui-get-beacons" || messageType === "ui-get-background-activity" || messageType === "ui-refresh-background-activity" || ["ui-start-cookie-probe", "ui-get-cookie-probe", "ui-cancel-cookie-probe"].includes(messageType)) {\n    if (!verifyUiSender(sender, runtime.api.runtime.id)) return uiError("unauthorized-sender");\n    const reader = messageType === "ui-get-beacons" ? readBeaconRequest : messageType.includes("background-activity") ? readBackgroundRequest : readCookieProbeRequest;\n    const request = reader(message); if (!request) return uiError("invalid-request");\n    if (messageType === "ui-get-beacons") return runtime.beacons.read(request);\n    if (messageType.includes("background-activity")) return runtime.backgroundActivity.read(request);\n    return messageType === "ui-start-cookie-probe" ? runtime.cookieProbe.start(request) : messageType === "ui-cancel-cookie-probe" ? runtime.cookieProbe.cancel(request) : runtime.cookieProbe.read(request);\n  }\n';
    if (!source.includes('const reader = messageType === "ui-get-beacons"')) { if (!source.includes(routeMarker)) throw Error('advanced routes'); source = source.replace(routeMarker, routes + routeMarker); }
    const budgetMarker = '      if (page.socialNetworks) this.size("social:" + page.id, JSON.stringify(page.socialNetworks).length * 2 + 256);';
    const budgets = '\n      for (const field of ["beacons", "backgroundActivity", "cookieProbes"]) if (page[field]) this.size(field + ":" + page.id, JSON.stringify(page[field]).length * 2 + 256);';
    if (!source.includes('for (const field of ["beacons", "backgroundActivity", "cookieProbes"')) { if (!source.includes(budgetMarker)) throw Error('advanced Pro restore budgets'); source = source.replace(budgetMarker, budgetMarker + budgets); }
  }
  if (check && source !== before) throw Error(name + ': advanced runtime synchronization required');
  if (!check && source !== before) writeFileSync(file, source);
}
