// ADR-038: document-scoped cookie writer transport and Pro lifecycle.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cookieWriterBridgeRuntimeSource } from './cookie-writer-bridge-runtime.mjs';
const root = resolve(import.meta.dirname, '../..'), check = process.argv.includes('--check');
const read = file => readFileSync(resolve(root, file), 'utf8');
const canonical = read('packages/contracts/src/cookie-writers.mjs');
for (const name of ['hook.main.js', 'hook.early.js', 'bridge.js', 'background.js', 'popup.js', 'sidepanel.js', 'report.js']) {
  const file = resolve(root, 'apps/production-extension', name), before = readFileSync(file, 'utf8'); let source = before;
  if (name.startsWith('hook.')) {
    source = source.replace('this.stopCleanups.length >= 8', 'this.stopCleanups.length >= 16');
    if (!source.includes('proParameterBudget = ')) source = source.replace('    proRows = new NativeMap();', '    proRows = new NativeMap();\n    proParameterBudget = typeof createProParameterBudget === "undefined" ? null : createProParameterBudget();');
    const cost = '      this.proBytes += cost;';
    const gate = '      if (this.proParameterBudget && !this.proParameterBudget.admit(row)) { this.proTruncated = !0; return; }\n';
    if (!source.includes(gate)) { if (!source.includes(cost)) throw Error('Pro cost boundary'); source = source.replace(cost, gate + cost); }
    if (!source.includes('this.proParameterBudget?.reset();')) source = source.replace('    clearPro() {\n', '    clearPro() {\n      this.proParameterBudget?.reset();\n');
  }
  if (name === 'bridge.js') {
    const start = '// ADR-038 writer bridge start\n', end = '// ADR-038 writer bridge end\n';
    const a = source.indexOf(start), b = source.indexOf(end, a);
    if (a >= 0) { if (b < a) throw Error('writer bridge boundary'); source = source.slice(0, a) + source.slice(b + end.length); }
    const module = '  var readCookieWriterRows = (() => {\n' + canonical.replaceAll('export ', '') + '\nreturn readCookieWriterRows;\n})();\n';
    const anchor = '  // apps/extension/entrypoints/bridge.ts\n';
    if (!source.includes(anchor)) throw Error('bridge installer');
    source = source.replace(anchor, start + module + cookieWriterBridgeRuntimeSource + end + anchor);
    if (!source.includes('startBrowserCookieWriterBridge(),')) source = source.replace('startBrowserVisualBridge(),', 'startBrowserCookieWriterBridge(), startBrowserVisualBridge(),');
  }
  if (['background.js', 'popup.js', 'sidepanel.js', 'report.js'].includes(name)) {
    for (const p of ['p', 'p3']) {
      const anchor = `if (Object.hasOwn(${p}, "cookieProbes")) pageFields.push("cookieProbes");`;
      if (source.includes(anchor) && !source.includes(`if (Object.hasOwn(${p}, "cookieWriters"))`)) source = source.replaceAll(anchor, anchor + ` if (Object.hasOwn(${p}, "cookieWriters")) pageFields.push("cookieWriters");`);
    }
  }
  if (name === 'background.js') {
    const imports = 'import { CookieWriterObserver } from "./cookie-writer-observer.js";\nimport { readCookieWriterRequest } from "./cookie-writers-contracts.js";\n';
    if (!source.includes(imports)) source = imports + source;
    const anchor = '    this.backgroundActivity = new BackgroundActivityObserver(this, { redact: redactHost });';
    if (!source.includes('this.cookieWriters = new CookieWriterObserver')) { if (!source.includes(anchor)) throw Error('writer initializer'); source = source.replace(anchor, anchor + '\n    this.cookieWriters = new CookieWriterObserver(this, { redact: redactHost });'); }
    source = source.replaceAll('this.backgroundActivity.forget(documentKey3);', 'this.backgroundActivity.forget(documentKey3); this.cookieWriters.forget(documentKey3);').replaceAll('this.cookieWriters.forget(documentKey3); this.cookieWriters.forget(documentKey3);', 'this.cookieWriters.forget(documentKey3);');
    source = source.replaceAll('this.backgroundActivity.clear();', 'this.backgroundActivity.clear(); this.cookieWriters.clear();').replaceAll('this.cookieWriters.clear(); this.cookieWriters.clear();', 'this.cookieWriters.clear();');
    const route = '  if (messageType === "ui-get-cookie-writers") {\n    if (!verifyUiSender(sender, runtime.api.runtime.id)) return uiError("unauthorized-sender");\n    const request = readCookieWriterRequest(message);\n    return request ? runtime.cookieWriters.read(request) : uiError("invalid-request");\n  }\n';
    if (!source.includes(route)) source = source.replace('  if (messageType === "ui-get-third-party") {', route + '  if (messageType === "ui-get-third-party") {');
    source = source.replace('for (const field of ["beacons", "backgroundActivity", "cookieProbes"])', 'for (const field of ["beacons", "backgroundActivity", "cookieProbes", "cookieWriters"])');
  }
  if (check && source !== before) throw Error(name + ': review channel drift');
  if (!check && source !== before) writeFileSync(file, source);
}
console.log((check ? 'checked' : 'synchronized') + ' review channels');
