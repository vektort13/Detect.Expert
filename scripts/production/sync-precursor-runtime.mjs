// ADR-074 / DET-CF-PRECURSOR-001: preserve the delivered source and ADR-073 lifecycle.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyPrecursorTimingResource, startPrecursorTimingBridge, installPrecursorTimingBridge } from '../../apps/production-extension/precursor-timing.js';

const root = resolve(import.meta.dirname, '../..'), check = process.argv.includes('--check');
const pending = [];
function prepare(relative, transform) {
  const path = resolve(root, relative), before = readFileSync(path, 'utf8'), after = transform(before);
  if (before !== after) pending.push({ path, after, relative });
}
function insert(source, before, after) {
  if (source.includes(after)) return source;
  if (source.split(before).length !== 2) throw Error('Precursor integration boundary: ' + before.slice(0, 100));
  return source.replace(before, after);
}
function lifecycle(source) {
  // Keep the adjacent existing sidecar anchors intact for sync-advanced-runtime.
  source = source.replaceAll('this.thirdParty.forget(documentKey); this.precursor?.forget(documentKey);', 'this.thirdParty.forget(documentKey);')
    .replaceAll('this.thirdParty.clear(); this.precursor?.clear();', 'this.thirdParty.clear();');
  for (const [anchor, addition] of [
    ['void this.cookieProbe.invalidate(documentKey);', ' this.precursor?.forget(documentKey);'],
    ['void this.cookieProbe.invalidate();', ' this.precursor?.clear();']
  ]) source = source.replaceAll(anchor + addition, anchor).replaceAll(anchor, anchor + addition);
  return source;
}
const contract = readFileSync(resolve(root, 'packages/contracts/src/precursor.mjs'), 'utf8');
prepare('apps/production-extension/precursor-contracts.js', () => contract);
prepare('scripts/production/clear-runtime-patches.mjs', lifecycle);
prepare('apps/production-extension/background.js', original => {
  let source = lifecycle(original);
  const anchor = 'import { ThirdPartyObserver } from "./third-party-observer.js";';
  source = insert(source, anchor, anchor + '\nimport { PrecursorObserver } from "./precursor-observer.js";\nimport { readPrecursorRequest } from "./precursor-contracts.js";');
  const factory = '  let runtime = new BackgroundRuntime(api, options);';
  source = insert(source, factory, factory + '\n  runtime.precursor = new PrecursorObserver(runtime);');
  const route = '  if (messageType === "ui-get-third-party") {';
  source = insert(source, route, '  if (messageType === "ui-get-precursor") {\n' +
    '    if (!verifyUiSender(sender, runtime.api.runtime.id)) return uiError("unauthorized-sender");\n' +
    '    const request = readPrecursorRequest(message); return request ? runtime.precursor.read(request) : uiError("invalid-request");\n' +
    '  }\n' + route);
  const listener = '// ADR-074 Precursor resource observation\n' +
    'chrome.webRequest.onCompleted.addListener(details => { void background.runtime.precursor.observe(details); }, { urls: ["https://*/cdn-cgi/challenge-platform/*"], types: ["script"] }, ["responseHeaders"]);\n' +
    'chrome.tabs.onRemoved.addListener(tabId => background.runtime.precursor.clearTab(tabId));\n' +
    'chrome.tabs.onReplaced.addListener((_added, removed) => background.runtime.precursor.clearTab(removed));\n';
  if (!source.includes(listener)) {
    if (source.includes('// ADR-074 Precursor resource observation')) throw Error('Precursor listener drift');
    source += '\n' + listener;
  }
  source = source.replace('background.runtime.precursor.forget(details.tabId + ":" + details.frameId + ":" + details.documentId);', 'background.runtime.precursor.forget(details.tabId + ":" + details.frameId + ":" + details.documentId, "navigation");');
  source = insert(source, listener, listener + 'chrome.webNavigation.onCommitted.addListener(details => {\n' +
    '  if (Number.isSafeInteger(details.tabId) && details.tabId >= 0 && Number.isSafeInteger(details.frameId) && details.frameId >= 0 && typeof details.documentId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(details.documentId))\n' +
    '    background.runtime.precursor.forget(details.tabId + ":" + details.frameId + ":" + details.documentId, "navigation");\n' +
    '});\n');
  return source;
});
prepare('apps/production-extension/bridge.js', source => {
  const start = '  // ADR-076 Precursor native timing bridge start\n', end = '  // ADR-076 Precursor native timing bridge end\n';
  const block = start +
    '  var classifyPrecursorTimingResource = (' + classifyPrecursorTimingResource.toString() + ');\n' +
    '  var startPrecursorTimingBridge = (' + startPrecursorTimingBridge.toString() + ');\n' +
    '  var installPrecursorTimingBridge = (' + installPrecursorTimingBridge.toString() + ');\n' + end;
  const from = source.indexOf(start);
  if (from >= 0) { const to = source.indexOf(end, from); if (to < 0) throw Error('Precursor timing bridge end'); source = source.slice(0, from) + source.slice(to + end.length + (source[to + end.length] === '\n' ? 1 : 0)); }
  // ADR-038 owns the contiguous writer block immediately before the entrypoint.
  // Install before that owned boundary so either synchronization order is stable.
  const boundary = '// ADR-038 writer bridge start\n';
  if (source.split(boundary).length !== 2) throw Error('Precursor timing bridge boundary');
  source = source.replace(boundary, block + '\n' + boundary);
  const install = 'startBrowserThirdPartyTimingBridge();';
  return insert(source, install, install + '\n      installPrecursorTimingBridge(startPrecursorTimingBridge, classifyPrecursorTimingResource, isOwnServiceWorker, chrome);');
});
for (const file of ['popup.js', 'sidepanel.js']) prepare('apps/production-extension/' + file, source => {
  const anchor = 'import { createIdentificationUi, identificationCounts } from "./identification-ui.js";';
  source = insert(source, anchor, anchor + '\nimport { createPrecursorUi } from "./precursor-ui.js";\n' +
    'var { PrecursorPanel } = createPrecursorUi({ h: u3, useState: d2, useEffect: h2, useRef: A2, useLocale, browserApi: chrome, translate: (key, substitutions) => t3(key, substitutions) });');
  const panel = '    u3(ProtectIsland, { surface, tabId: session.tabId, openSidePanel: session.openSidePanel }, "protect-island"),';
  const oldPanel = '    u3(PrecursorPanel, { session, enabled: true }),';
  const embeddedPanel = '    u3(PrecursorPanel, { session, enabled: !embedded }),';
  const target = file === 'popup.js' ? embeddedPanel : oldPanel;
  source = source.replace(file === 'popup.js' ? oldPanel : embeddedPanel, target);
  return insert(source, panel, panel + '\n' + target);
});
for (const file of ['popup.html', 'sidepanel.html']) prepare('apps/production-extension/' + file, source => {
  const link = '    <link rel="stylesheet" href="identification-ui.css" />';
  return insert(source, link, link + '\n    <link rel="stylesheet" href="precursor-ui.css" />');
});
if (check && pending.length) throw Error('Precursor synchronization needed: ' + pending.map(item => item.relative).join(', '));
for (const { path, after } of check ? [] : pending) writeFileSync(path, after);
console.log((check ? 'checked' : 'synchronized') + ' Precursor contracts, observer, UI and lifecycle');
