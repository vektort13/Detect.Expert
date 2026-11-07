// ADR-057 / REQ-005/009/011: successful, same-origin vendor redirects only.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const path = resolve(root, 'apps/production-extension/background.js');
const check = process.argv.includes('--check');
const before = readFileSync(path, 'utf8');
let source = before;
const replace = (from, to) => {
  if (source.includes(to)) return;
  if (!source.includes(from)) throw Error('vendor redirect integration boundary: ' + from.slice(0, 100));
  source = source.replace(from, to);
};
const imported = 'import { createVendorRedirectTracker } from "./vendor-redirects.js";\n';
source = source.replace(imported, '');
if (!source.startsWith('import { protectHost, isProtectSessionKey } from "./protect-sw.js";')) throw Error('protect import must remain first');
const controllerImport = 'import { ApiConfigurationController } from "./api-configuration-controller.js";\n';
if (!source.includes(controllerImport)) throw Error('API configuration controller import boundary');
const importAt = source.indexOf(controllerImport) + controllerImport.length;
source = source.slice(0, importAt) + imported + source.slice(importAt);

const start = '// ADR-057 vendor redirect attribution start\n';
const end = '// ADR-057 vendor redirect attribution end\n';
const block = start + `function createRuntimeVendorRedirects(runtime, pro = null) {
  return createVendorRedirectTracker({
    match: matchVendorResource,
    now: () => runtime.now(),
    onLimit: (_reason, identity) => {
      const documentKey = makeDocumentKey(identity.tabId, identity.frameId, identity.documentId);
      if (runtime.canObserveNetworkDocument(documentKey)) runtime.dispatch({ type: "network:limited", documentKey, at: runtime.now() });
      else runtime.dispatch({ type: "network:unattributed", at: runtime.now() });
      if (pro?.checkDeadline()) { pro.limit("event-limit"); pro.mark(); }
    }
  });
}
function carriedVendorRuleIds(runtime, tracker, details, phase, pro = null) {
  const scope = runtime.scope;
  if (!scope.hasDataConsent || !scope.accessReady) { tracker.clear(); return []; }
  if (typeof details.url !== "string") return [];
  const documentKey = makeDocumentKey(details.tabId, details.frameId, details.documentId);
  const meta = runtime.state.metas.get(documentKey);
  const host = sanitizeHost(details.url), initiator = typeof details.initiator === "string" ? details.initiator : "";
  const sourceHost = sanitizeHost(initiator), scheme = details.url.startsWith("https:") ? "https" : "http";
  const sourceScheme = initiator.startsWith("https:") ? "https" : "http";
  const allowed = !!host && !!sourceHost && scope.isHostGrantedSync(host, scheme) &&
    scope.isHostGrantedSync(sourceHost, sourceScheme) && scope.inScope(sourceHost, details.tabId, details.documentId, sourceScheme) &&
    !meta?.paused && !meta?.revoked && meta?.accessGranted !== false &&
    (phase !== "completed" || runtime.canObserveNetworkDocument(documentKey)) &&
    (!pro || pro.checkDeadline() && pro.trackedTabs.has(details.tabId));
  return tracker.observe(details, phase, {
    allowed,
    scopeKey: String(scope.accessGeneration) + ":" + scope.getScopeMode() + ":" + (pro?.session?.id ?? "light")
  }).filter(id => lookupVendorResourceRule(id, runtime.now()) !== null);
}
` + end;
const prior = source.indexOf(start);
if (prior >= 0) {
  const finish = source.indexOf(end, prior);
  if (finish < 0) throw Error('vendor redirect integration end boundary');
  source = source.slice(0, prior) + block + source.slice(finish + end.length);
} else replace('function createNetworkListener(runtime) {', block + '\nfunction createNetworkListener(runtime) {');

replace('    this.cookieCapture = new ProCookieCapture(this);',
  '    this.cookieCapture = new ProCookieCapture(this);\n    this.vendorRedirects = createRuntimeVendorRedirects(runtime, this);');
replace('    this.thirdParty = new ThirdPartyObserver(this, { host: sanitizeHost, redact: redactHost });',
  '    this.thirdParty = new ThirdPartyObserver(this, { host: sanitizeHost, redact: redactHost });\n    this.vendorRedirects = createRuntimeVendorRedirects(this);');
replace('  resetMemory() {\n    this.cookieCapture.stop();',
  '  resetMemory() {\n    this.vendorRedirects.clear();\n    this.cookieCapture.stop();');
// Clear ephemeral provenance at the same privacy/session boundaries as other network observers.
source = source.replaceAll('    this.cookies.clear(); this.proCookieValues.clear();',
  '    this.vendorRedirects.clear(); this.pro.vendorRedirects.clear();\n    this.cookies.clear(); this.proCookieValues.clear();');
source = source.replaceAll('    this.vendorRedirects.clear(); this.pro.vendorRedirects.clear();\n    this.vendorRedirects.clear(); this.pro.vendorRedirects.clear();',
  '    this.vendorRedirects.clear(); this.pro.vendorRedirects.clear();');
source = source.replaceAll('      this.cookies.forget(documentKey3); this.proCookieValues.forget(documentKey3);',
  '      this.vendorRedirects.clearDocument(documentKey3); this.pro.vendorRedirects.clearDocument(documentKey3);\n      this.cookies.forget(documentKey3); this.proCookieValues.forget(documentKey3);');
source = source.replaceAll('      this.vendorRedirects.clearDocument(documentKey3); this.pro.vendorRedirects.clearDocument(documentKey3);\n      this.vendorRedirects.clearDocument(documentKey3); this.pro.vendorRedirects.clearDocument(documentKey3);',
  '      this.vendorRedirects.clearDocument(documentKey3); this.pro.vendorRedirects.clearDocument(documentKey3);');

replace('function createNetworkListener(runtime) {\n  return (details) => {',
  'function createNetworkListener(runtime) {\n  return (details) => {\n    const carriedRules = carriedVendorRuleIds(runtime, runtime.vendorRedirects, details, "completed");');
replace('matchVendorResource(details.url, details.type, at2).map((match) => match.ruleId) : [];',
  '[...new Set([...matchVendorResource(details.url, details.type, at2).map((match) => match.ruleId), ...carriedRules])] : [];');
replace('  onRequest(details, phase) {\n    if (!this.runtime.scope.hasDataConsent',
  '  onRequest(details, phase) {\n    const carriedRules = carriedVendorRuleIds(this.runtime, this.vendorRedirects, details, phase, this);\n    if (!this.runtime.scope.hasDataConsent');
replace('request.ruleIds = rules2.map((rule) => rule.ruleId),',
  'request.ruleIds = [...new Set([...rules2.map((rule) => rule.ruleId), ...carriedRules])],');

const listenerStart = '// ADR-057 vendor redirect listeners start\n';
const listenerEnd = '// ADR-057 vendor redirect listeners end\n';
const listeners = listenerStart + ['before', 'redirect', 'error'].map((phase, index) =>
  'chrome.webRequest.' + ['onBeforeRequest', 'onBeforeRedirect', 'onErrorOccurred'][index] +
  '.addListener(details => { carriedVendorRuleIds(background.runtime, background.runtime.vendorRedirects, details, "' + phase + '"); }, background.network.filter);'
).join('\n') + '\n' +
  'chrome.tabs.onRemoved.addListener(tabId => { background.runtime.vendorRedirects.clearTab(tabId); background.runtime.pro.vendorRedirects.clearTab(tabId); });\n' +
  'chrome.tabs.onReplaced.addListener((_added, removed) => { background.runtime.vendorRedirects.clearTab(removed); background.runtime.pro.vendorRedirects.clearTab(removed); });\n' + listenerEnd;
const listenerPrior = source.indexOf(listenerStart);
if (listenerPrior >= 0) {
  const finish = source.indexOf(listenerEnd, listenerPrior);
  if (finish < 0) throw Error('vendor redirect listeners end boundary');
  source = source.slice(0, listenerPrior) + listeners + source.slice(finish + listenerEnd.length);
} else source += '\n' + listeners;

if (check && source !== before) throw Error('vendor redirect synchronization needed');
if (!check && source !== before) writeFileSync(path, source);
console.log((check ? 'checked' : 'synchronized') + ' successful vendor redirect attribution');
