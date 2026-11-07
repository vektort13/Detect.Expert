// ADR-029: reproduce passive browser inventory and trusted ISOLATED timing bridge.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { startThirdPartyTimingBridge } from '../../apps/production-extension/third-party-observer.js';
const root = resolve(import.meta.dirname, '../..'), check = process.argv.includes('--check');
const canonical = readFileSync(resolve(root, 'packages/contracts/src/third-party.mjs'), 'utf8');
const contractFile = resolve(root, 'apps/production-extension/third-party-contracts.js');
if (check) { if (readFileSync(contractFile, 'utf8') !== canonical) throw Error('third-party contract synchronization needed'); }
else writeFileSync(contractFile, canonical);
const put = (file, before, after) => { if (check && before !== after) throw Error(file + ': third-party synchronization needed'); if (!check && before !== after) writeFileSync(resolve(root, 'apps/production-extension', file), after); };
{
  const file = 'background.js', before = readFileSync(resolve(root, 'apps/production-extension', file), 'utf8'); let source = before;
  const imports = 'import { ThirdPartyObserver } from "./third-party-observer.js";\nimport { readThirdPartyRequest } from "./third-party-contracts.js";\n';
  if (!source.includes(imports)) source = imports + source;
  const constructor = '    this.social = new SocialNetworkObserver(this, { host: sanitizeHost, redact: redactHost });';
  const install = '\n    this.thirdParty = new ThirdPartyObserver(this, { host: sanitizeHost, redact: redactHost });';
  if (!source.includes(install)) { if (!source.includes(constructor)) throw Error('third-party constructor boundary'); source = source.replace(constructor, constructor + install); }
  source = source.replaceAll('this.cookies.forget(documentKey3); this.social.forget(documentKey3);', 'this.cookies.forget(documentKey3); this.social.forget(documentKey3); this.thirdParty.forget(documentKey3);');
  source = source.replaceAll('this.cookies.clear(); this.social.clear();', 'this.cookies.clear(); this.social.clear(); this.thirdParty.clear();');
  // The preceding replacements are idempotent after removing repeated tails.
  source = source.replaceAll('this.thirdParty.forget(documentKey3); this.thirdParty.forget(documentKey3);', 'this.thirdParty.forget(documentKey3);');
  source = source.replaceAll('this.thirdParty.clear(); this.thirdParty.clear();', 'this.thirdParty.clear();');
  const route = '  if (messageType === "ui-get-third-party") {\n    if (!verifyUiSender(sender, runtime.api.runtime.id)) return uiError("unauthorized-sender");\n    const request = readThirdPartyRequest(message); return request ? runtime.thirdParty.read(request) : uiError("invalid-request");\n  }\n';
  const routeBoundary = '  if (messageType === "ui-get-social-networks") {';
  if (!source.includes(route)) { if (!source.includes(routeBoundary)) throw Error('third-party route boundary'); source = source.replace(routeBoundary, route + routeBoundary); }
  const start = '// ADR-029 third-party browser listeners start\n', end = '// ADR-029 third-party browser listeners end\n';
  const listeners = start + ['before', 'completed', 'error', 'redirect'].map((phase, index) => 'chrome.webRequest.' + ['onBeforeRequest', 'onCompleted', 'onErrorOccurred', 'onBeforeRedirect'][index] + '.addListener(details => background.runtime.thirdParty.observe(details, "' + phase + '"), PRO_NETWORK_FILTER);').join('\n') + '\n' + end;
  const priorStart = source.indexOf(start);
  if (priorStart >= 0) { const priorEnd = source.indexOf(end, priorStart); if (priorEnd < 0) throw Error('third-party listeners end'); source = source.slice(0, priorStart) + listeners + source.slice(priorEnd + end.length); }
  else source += '\n' + listeners;
  put(file, before, source);
}
{
  const file = 'bridge.js', before = readFileSync(resolve(root, 'apps/production-extension', file), 'utf8'); let source = before;
  const background = readFileSync(resolve(root, 'apps/production-extension/background.js'), 'utf8');
  const attributionStart = background.indexOf('// packages/attribution/src/psl-index.json\n'), attributionEnd = background.indexOf('// packages/background/src/sender.ts\n', attributionStart);
  if (attributionStart < 0 || attributionEnd < 0) throw Error('offline PSL boundary');
  const attribution = background.slice(attributionStart, attributionEnd);
  const start = '  // ADR-029 third-party timing bridge start\n', end = '  // ADR-029 third-party timing bridge end\n';
  const bridge = start + '  var thirdPartyTimingContracts = (() => {\n' + canonical.replaceAll('export ', '') + '\nreturn { thirdPartyPathTemplate };\n})();\n' +
    '  var thirdPartyTimingAttribution = (() => {\n' + attribution + '\nreturn { redactHost };\n})();\n' +
    '  var startThirdPartyTimingBridge = (' + startThirdPartyTimingBridge.toString() + ');\n' +
    '  function startBrowserThirdPartyTimingBridge() {\n' +
    '    const apply = Reflect.apply, descriptor = Object.getOwnPropertyDescriptor;\n' +
    '    const read = (prototype, name) => descriptor(prototype, name)?.get;\n' +
    '    const name = read(PerformanceEntry.prototype, "name"), start = read(PerformanceEntry.prototype, "startTime"), initiator = read(PerformanceResourceTiming.prototype, "initiatorType");\n' +
    '    startThirdPartyTimingBridge({\n' +
    '      name: entry => apply(name, entry, []), start: entry => apply(start, entry, []), initiator: entry => apply(initiator, entry, []),\n' +
    '      redact: thirdPartyTimingAttribution.redactHost, path: thirdPartyTimingContracts.thirdPartyPathTemplate,\n' +
    '      now: () => performance.now(), entries: () => performance.getEntriesByType("resource"),\n' +
    '      observe: (record, buffered = true) => { const observer = new PerformanceObserver(list => record(list.getEntries())); observer.observe({ type: "resource", buffered }); return observer; },\n' +
    '      onCommand: listener => chrome.runtime.onMessage.addListener((message, sender, respond) => listener(isOwnServiceWorker(sender), message, respond)),\n' +
    '      onHide: listener => window.addEventListener("pagehide", listener), onRestore: listener => window.addEventListener("pageshow", event => { if (event.persisted) listener(); }),\n' +
    '      onBufferFull: listener => performance.addEventListener("resourcetimingbufferfull", listener),\n' +
    '    });\n  }\n' + end;
  const priorStart = source.indexOf(start);
  if (priorStart >= 0) { const priorEnd = source.indexOf(end, priorStart); if (priorEnd < 0) throw Error('third-party bridge end'); source = source.slice(0, priorStart) + bridge + source.slice(priorEnd + end.length); }
  else { const boundary = '  // packages/collector/src/api-results.ts\n'; if (!source.includes(boundary)) throw Error('third-party bridge insertion boundary'); source = source.replace(boundary, bridge + '\n' + boundary); }
  const install = 'startBrowserSocialValuesBridge();';
  if (!source.includes('startBrowserThirdPartyTimingBridge();')) { if (!source.includes(install)) throw Error('third-party bridge install boundary'); source = source.replace(install, 'startBrowserSocialValuesBridge(), startBrowserThirdPartyTimingBridge();'); }
  put(file, before, source);
}
console.log((check ? 'checked' : 'synchronized') + ' third-party contracts, observer and timing bridge');
