// ADR-073: guarded clear/history edits to the delivered BackgroundRuntime.
// The constructor and all unrelated members/modules remain byte-identical.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { transformSync } from 'esbuild';
import { namedClass } from './clear-reset-tools.mjs';

const BASE = {
  "countTransportDrop": "2a07527b11dcf25ef75fb9f019408663a1708dce29440ecce8bf04f890120cf4",
  "reconcileFrames": "b4bee37513989cd4a739b9509bbdae1cdf28a22ddddf87d444421bee514b0e5d",
  "canObserveNetworkDocument": "fd243bdac023872d48d91ea0a1c98a69127cd8a93accce1f2612d8417add4baf",
  "constructor": "316326f7e213144738e89e4a20a4f7eaef586868a6d723ba6aa2cbee376fbe6f",
  "hydrationComplete": "14fd5b9ac12b101f0291de6fb218ef8510e53310eb16959c6d40654909f4ab1b",
  "canCollectBrowserData": "b86bc6b10b95f2d261a078c77f494bd846f620bacf2fdb09091bd609c2e0f785",
  "canBufferRedactedBrowserData": "a088d93634cc79fa8649e640d0d8e13261e0a9c371d10e545152c54cd5b48c9e",
  "whenPageReady": "a5982252c2336afa702d0b2e8825d4c83ead9069d52706b3d658a7290457cb6e",
  "start": "2a7ce5b2c84497e4079b653cc9ea1ef97a7407db62453c0d736f090600f7c79d",
  "dispatch": "2d07383378561bd2be6416511995bdad1e734b6184bdfca3c1e55fac56dc024b",
  "apply": "1a2e17722e97fe5b6f162f4bad4819ec7b56cd159caab2f5c9d76dbf6956c152",
  "queueRemove": "b3014de35ee4a79f6bf65c34d0cf10c53b29f7bbf7c13e275cea864628434099",
  "flushIndex": "bf22b9b5d1e3df974d00b3087d5a21315f709284892e5539796ea143b9e9dbd8",
  "persistApiResultsReset": "4630b09da88468c62638e2676037239e450efd27fc9494471f623a17a06ce39d",
  "persistNow": "fc06f118ec5c4415827e5712cd68530a696165fc1517d6068f35002ebe3d152d",
  "sweepExpired": "de566920a80be7d24cf791f5ee5294f44172ab7f5ebc3268f573ebc0a677d83c",
  "recordTerminalStop": "84947e6dfe48cc980e3dd3f703369915093f217a72eca3519fc3e7be47328a20",
  "handleBatch": "d8b98d75ca29b9d0b37ac21ffd8b5d237fa8c15d1696a3b12f9b446e9ac08186",
  "projectionByKey": "13f43ddab93e82e72a2e0770f3a2eed28a497b1478b3aea705a70e3771e41bb6",
  "checkDocument": "77f740ff9c5d4d9d3eb7d357fa878969ea0fa034b524745217705c30bee92c5c",
  "pause": "176b2e338195c57a530195f14e9eae97615bcfb1be6b2477e45c5231969bc48e",
  "resume": "0ffc76d9ad45a9bee9fe2a13e63051aa9fe7f96925fb2aaa3572b164b135d637",
  "clear": "18c13b9d9430052b944b54d96958f3865cb5703036b27b043249a1992da0d0b2",
  "clearSession": "d512e466e118374046fdada12ff58e6adaa16704da191b6423d9fa0feac1b944",
  "exportPreview": "5135a0bde88a9236ed88f29b0e43d3fe6e4de864f6cab9978152df5b65725447",
  "injectNow": "aec0294c2689a4f96bfc6fdf9e86fa3165019f547ad6eb91a88382d170519f2b",
  "changeDataConsent": "ca9b4d6609df0ca0d4447ae8b7a26f0b024edf132ecdfca6d8baff91817c988a",
  "discardUnconsentedData": "59ea94e6338416a0d00d1b878341f33ff25a82335a24321ffe86f0989a36c8d1",
  "onPermissionsChanged": "65720829f0abee0f94721fba93e1e99365827233d5f0d177b591a1fbf39d1a26",
  "estimatedTotal": "2460b8702b3081d1b6b27145fafa456510b996bae674fb35a4f47f40ed7e76ef"
};

const root = resolve(import.meta.dirname, '../..');
const hash = text => createHash('sha256').update(text).digest('hex');
const fields = ['historyLoaded', 'historyLoading', 'clearingDocs', 'resetRequests'];
const addedMethods = ['ensureHistory', 'finishHistoryReadiness', 'commitClear', 'commitClearRecords', 'resetHistoryActor'];
// ADR-097: exact previously reviewed production methods, before archive fences.
const REVIEWED_HISTORY_MIGRATIONS = {
  clearSession: 'd85f4acd51d8da70d6d1686eef6d4121661d50b54c15dcd1632172a0a920b1da',
  discardUnconsentedData: 'd0a54a0847b582a16e535dfc2866a8ec489889d54712db55c79d71d8394b8e94',
};
const HISTORY_IMPORT = 'import { withProReportHistoryPurge } from "./pro-report-history.js";';
const PROTECT_IMPORT = 'import { protectHost, isProtectSessionKey } from "./protect-sw.js";\n';
const API_IMPORT = 'import { ApiConfigurationController } from "./api-configuration-controller.js";\n';
// Reviewed first ADR-073 application: only add cancellation of queued loader migrations after consent purge.
const REVIEWED_MIGRATIONS = { ensureHistory: 'b0c1e25db9222a034c3927f0e881a48638e512331d99eb7a5e67f1e8769cc62d' };
export const clearRuntimeMembers = Object.freeze([...Object.keys(BASE).filter(name => name !== 'constructor'), ...fields, ...addedMethods]);

function replaceOnce(text, before, after, member) {
  if (text.split(before).length !== 2) throw Error('BackgroundRuntime.' + member + ': production preservation anchor changed: ' + before);
  return text.replace(before, after);
}
const documentSidecars = `this.vendorRedirects.clearDocument(documentKey); this.pro.vendorRedirects.clearDocument(documentKey);
    this.cookies.forget(documentKey); this.proCookieValues.forget(documentKey); this.proRequestValues.forget(documentKey); this.social.forget(documentKey); this.thirdParty.forget(documentKey); this.beacons.forget(documentKey); this.backgroundActivity.forget(documentKey); this.cookieWriters.forget(documentKey); void this.cookieProbe.invalidate(documentKey); this.precursor?.forget(documentKey);`;
const sessionSidecars = `this.vendorRedirects.clear(); this.pro.vendorRedirects.clear();
    this.cookies.clear(); this.proCookieValues.clear(); this.proRequestValues.clear(); this.social.clear(); this.thirdParty.clear(); this.beacons.clear(); this.backgroundActivity.clear(); this.cookieWriters.clear(); void this.cookieProbe.invalidate(); this.precursor?.clear();`;

/** Merge only reviewed shipped additions that the historical canonical TS does not own. */
function preserveProduction(name, body) {
  const replace = (before, after) => { body = replaceOnce(body, before, after, name); };
  if (name === 'start') body = body.slice(0, -1) + '  void this.siteIcons.refresh();\n}';
  if (name === 'apply') replace('this.pro.afterEvent(event, before);', 'this.pro.afterEvent(event, before);\n    this.proCookieValues.onEvent(event); this.proRequestValues.onEvent(event);');
  if (name === 'pause') replace('const previewReset =', documentSidecars + '\n    const previewReset =');
  if (name === 'clear') replace('this.pro.onLightClear(documentKey);', documentSidecars + '\n    this.pro.onLightClear(documentKey);');
  if (name === 'resume') replace('this.sendControl(documentKey, "resume");', 'await this.pro.resumeValueCapture(documentKey, () => this.sendControl(documentKey, "resume"));');
  if (name === 'clearSession') {
    replace('const keys =', 'this.onProtectClearSession?.();\n    ' + sessionSidecars + '\n    const precursorCleared = Promise.resolve(this.precursorModes?.clear() ?? true).catch(() => false);\n    const keys =');
    replace('return { schemaVersion: 1, type: "ok", reportRevision: null };', 'if (!await precursorCleared) return uiError("no-access");\n    return { schemaVersion: 1, type: "ok", reportRevision: null };');
  }
  if (name === 'projectionByKey') replace('!this.scope.hasBroadNetworkAccess()', '(!this.scope.hasBroadNetworkAccess() || this.api.__detectExpertCapabilities?.networkDocumentIdentity === false)');
  if (name === 'persistNow') replace('void this.enforceTotalBudget();', 'void this.enforceTotalBudget();\n        this.onProtectReportPersisted?.(documentKey, current, currentMeta);');
  if (name === 'injectNow') replace('this.reconcileAccess();', 'this.reconcileAccess();\n    this.badge.markAll();');
  if (name === 'changeDataConsent') replace('await this.protection.accessChanged();', 'await this.protection.accessChanged();\n        void this.siteIcons.refresh();');
  if (name === 'discardUnconsentedData') {
    replace('for (const key of this.state.reports.keys())', sessionSidecars + '\n    const precursorCleared = Promise.resolve(this.precursorModes?.clear() ?? true).catch(() => false);\n    for (const key of this.state.reports.keys())');
    replace('proCleared,', 'proCleared, this.siteIcons.invalidate(),');
    replace('this.repository.clearAll([DATA_CONSENT_PENDING_KEY])', 'this.repository.clearAll([DATA_CONSENT_PENDING_KEY], this.keepProtectSessionKey)');
    replace('return cleared && cleanup.every((result) => result.status === "fulfilled");', 'return cleared && cleanup.every((result) => result.status === "fulfilled") && await precursorCleared;');
  }
  if (name === 'onPermissionsChanged') {
    replace('this.apiResults.invalidate();', 'await this.siteIcons.invalidate().catch(() => {});\n    ' + sessionSidecars + '\n    this.apiResults.invalidate();');
    body = body.slice(0, -1) + '  void this.siteIcons.refresh();\n}';
  }
  if (name === 'clearSession') {
    replace('this.onProtectClearSession?.();', 'this.onProtectClearSession?.();\n    const savedReportsPurge = await withProReportHistoryPurge(async () => {');
    if (!body.endsWith('\n  }')) throw Error('clearSession archive fence closing anchor drift');
    body = body.slice(0, -4) + '\n    });\n    return savedReportsPurge.ok ? savedReportsPurge.value : uiError("no-access");\n  }';
  }
  if (name === 'discardUnconsentedData') {
    replace('async discardUnconsentedData() {', 'async discardUnconsentedData() {\n    const savedReportsPurge = await withProReportHistoryPurge(async () => {');
    if (!body.endsWith('\n  }')) throw Error('discardUnconsentedData archive fence closing anchor drift');
    body = body.slice(0, -4) + '\n    });\n    return savedReportsPurge.ok ? savedReportsPurge.value : false;\n  }';
  }
  // These symbols already exist in the delivered bundle under esbuild's collision suffixes.
  return body.replace(/\back\(/g, 'ack2(').replace(/\bprojectReport\(/g, 'projectReport2(');
}

function members(source, filename) {
  const { tree, node } = namedClass(source, 'BackgroundRuntime', filename);
  const entries = new Map();
  for (const item of node.members) {
    const name = item.name?.text ?? 'constructor';
    if (entries.has(name)) throw Error(filename + ': duplicate BackgroundRuntime member: ' + name);
    entries.set(name, { node: item, text: item.getText(tree) });
  }
  return { tree, node, entries };
}

export function patchClearRuntime(source) {
  const canonical = readFileSync(resolve(root, 'baseline-ts/packages/background/src/runtime.ts'), 'utf8');
  const compiled = transformSync(canonical, { loader: 'ts', target: 'es2022', charset: 'utf8', legalComments: 'none', minify: false }).code;
  const donor = members(compiled, 'canonical-runtime.js'), target = members(source, 'background.js');
  if (hash(target.entries.get('constructor')?.text ?? '') !== BASE.constructor) throw Error('BackgroundRuntime constructor drift; review production extras');
  const edits = [], additions = [];
  for (const name of clearRuntimeMembers) {
    const from = donor.entries.get(name);
    if (!from) throw Error('Canonical clear/runtime member missing: ' + name);
    const desired = preserveProduction(name, from.text), current = target.entries.get(name);
    if (current?.text === desired) continue;
    if (Object.hasOwn(BASE, name)) {
      if (!current || ![BASE[name], REVIEWED_HISTORY_MIGRATIONS[name]].filter(Boolean).includes(hash(current.text))) throw Error('BackgroundRuntime.' + name + ': source drift; review changed boundary');
      edits.push([current.node.getStart(target.tree), current.node.end, desired]);
    } else {
      if (current) {
        if (hash(current.text) !== REVIEWED_MIGRATIONS[name]) throw Error('BackgroundRuntime.' + name + ': inserted member drift');
        edits.push([current.node.getStart(target.tree), current.node.end, desired]);
        continue;
      }
      additions.push(desired);
    }
  }
  if (additions.length) edits.push([target.node.end - 1, target.node.end - 1, '\n' + additions.join('\n') + '\n']);
  for (const [start, end, replacement] of edits.sort((a, b) => b[0] - a[0])) source = source.slice(0, start) + replacement + source.slice(end);
  if (source.split(HISTORY_IMPORT).length > 2) throw Error('Duplicate archive purge import');
  if (!source.startsWith(PROTECT_IMPORT)) throw Error('Archive purge import requires the existing first-line Protect import');
  const existingImports = PROTECT_IMPORT + API_IMPORT;
  if (!source.startsWith(existingImports)) throw Error('Archive purge import requires the existing API controller import order');
  const importBlock = source.match(/^(?:import[^\n]*\n)+/u)?.[0];
  if (!importBlock) throw Error('Archive purge import requires the existing contiguous import block');
  if (source.includes(HISTORY_IMPORT)) {
    if (!importBlock.endsWith(HISTORY_IMPORT + '\n')) throw Error('Archive purge import ordering drift');
    return source;
  }
  return importBlock + HISTORY_IMPORT + '\n' + source.slice(importBlock.length);
}
