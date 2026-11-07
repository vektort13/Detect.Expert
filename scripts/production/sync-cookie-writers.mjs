// ADR-038: shared cookie-write metadata, one owned accessor for reads and writes.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cookieWriterRuntimeSource } from './cookie-writer-runtime.mjs';
const root = resolve(import.meta.dirname, '../..'), check = process.argv.includes('--check');
const read = file => readFileSync(resolve(root, file), 'utf8');
const canonical = read('packages/contracts/src/cookie-writers.mjs');
const contractFile = resolve(root, 'apps/production-extension/cookie-writers-contracts.js');
if (check) { if (readFileSync(contractFile, 'utf8') !== canonical) throw Error('Cookie writer contract drift'); }
else writeFileSync(contractFile, canonical);
for (const name of ['hook.main.js', 'hook.early.js']) {
  const file = resolve(root, 'apps/production-extension', name), before = readFileSync(file, 'utf8'); let source = before;
  const fromMarker = '  // ADR-038 cookie writers start\n', toMarker = '  // ADR-038 cookie writers end\n';
  const from = source.indexOf(fromMarker), to = source.indexOf(toMarker, from);
  const block = fromMarker + cookieWriterRuntimeSource + toMarker;
  if (from >= 0) { if (to < from) throw Error('Cookie writers boundary'); source = source.slice(0, from) + block + source.slice(to + toMarker.length); }
  const anchor = '  // apps/extension/entrypoints/hook.main.ts\n';
  if (!source.includes(anchor)) throw Error(name + ': installer boundary');
  if (from < 0) source = source.replace(anchor, block + anchor);
  const field = '    cookieWriterCollector = typeof cookieWriterSupport === "undefined" ? null : cookieWriterSupport.createCollector();\n';
  if (!source.includes(field)) source = source.replace('    loaderCollector = loaderSensorSupport.createCollector();', field + '    loaderCollector = loaderSensorSupport.createCollector();');
  const reset = 'this.backgroundCollector.reset(); this.socialCollector.reset(); this.beaconCollector.reset();';
  if (!source.includes('this.cookieWriterCollector?.reset();')) source = source.replace(reset, 'this.cookieWriterCollector?.reset(); ' + reset);
  const control = '        if (getDescriptor(data2, "channel")?.value === "detect.expert/cookie-writers/v1") { this.apiResults.cookieWriterCollector?.handleControl(data2, this.hooks.enabled, this.env); return; }\n';
  if (!source.includes(control)) source = source.replace('        if (getDescriptor(data2, "channel")?.value === "detect.expert/pro-values/v1")', control + '        if (getDescriptor(data2, "channel")?.value === "detect.expert/pro-values/v1")');
  const install = '    cookieWriterSupport.install(runtime, realm);\n';
  if (!source.includes(install)) source = source.replace('  function installSensors(runtime, realm) {\n', '  function installSensors(runtime, realm) {\n' + install);
  const getterStart = source.indexOf('  function wrapGetter('), getterEnd = source.indexOf('  function wrapSetter(', getterStart);
  let getter = source.slice(getterStart, getterEnd);
  if (!getter.includes('options?.observeSetter')) {
    const old = '    desc.set !== void 0 && (next.set = desc.set);';
    const replacement = `    desc.set !== void 0 && (next.set = desc.set);
    // One registry handle owns both accessor functions; preserve native setter semantics.
    if (typeof desc.set === "function" && typeof options?.observeSetter === "function") {
      const originalSetter = desc.set, observeSetter = options.observeSetter;
      const setter = function(value) {
        let threw = !1, error, result;
        try { result = apply5(originalSetter, this, arguments); } catch (caught) { threw = !0; error = caught; }
        if (ctx.enabled && !observing) {
          observing = !0;
          try { observeSetter(this, arguments, threw, error, result); }
          catch { noteObserverError(ctx); }
          finally { observing = !1; }
        }
        if (threw) throw error;
        return result;
      };
      options?.copyNameAndLength !== !1 && copyFunctionMeta(setter, originalSetter);
      try { setPrototypeOf(setter, getPrototypeOf(originalSetter)); } catch { return unsupported("getter", target, key, "define-failed"); }
      next.set = setter;
    }`;
    if (!getter.includes(old)) throw Error(name + ': getter setter slot');
    getter = getter.replace(old, replacement).replace('d.get === wrapper && d.set === desc.set', 'd.get === wrapper && d.set === next.set');
    source = source.slice(0, getterStart) + getter + source.slice(getterEnd);
  }
  const oldCookie = `target && descriptor10(target, "cookie") ? attach(wrapGetter(target, "cookie", (_receiver, threw) => {
        runtime.record(TECHNIQUE_INDEX["DET-049"], PHASE_INDEX[threw ? "threw-sync" : "returned-sync"], SIGNAL_BIT["api-use"]), runtime.recordResult("Document.cookie", PHASE_INDEX[threw ? "threw-sync" : "returned-sync"], void 0);
      }, options)) : arrayPush(skipped, "Document.cookie");`;
  const newCookie = `target && descriptor10(target, "cookie") ? attach(wrapGetter(target, "cookie", (_receiver, threw) => {
        runtime.recordOperation(API_OPERATION_INDEX["Document.cookie.get"], PHASE_INDEX[threw ? "threw-sync" : "returned-sync"]), runtime.recordResult("Document.cookie", PHASE_INDEX[threw ? "threw-sync" : "returned-sync"], void 0);
      }, { ...options, observeSetter(receiver, args, threw) {
        runtime.recordOperation(API_OPERATION_INDEX["Document.cookie.set"], PHASE_INDEX[threw ? "threw-sync" : "returned-sync"]);
        runtime.observeCookieWrite?.(receiver, args, threw);
      } })) : arrayPush(skipped, "Document.cookie");`;
  if (!source.includes(newCookie)) { if (!source.includes(oldCookie)) throw Error(name + ': cookie accessor'); source = source.replace(oldCookie, newCookie); }
  if (check && source !== before) throw Error(name + ': cookie writer synchronization required');
  if (!check && source !== before) writeFileSync(file, source);
}
console.log((check ? 'checked' : 'synchronized') + ' cookie writer sensors');
