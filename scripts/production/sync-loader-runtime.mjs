// ADR-021: reproduce only the Pro loader module and its two explicit MAIN integration points.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loaderSensorRuntimeSource } from './loader-sensor-runtime.mjs';

const root = new URL('../../', import.meta.url);
const check = process.argv.includes('--check');
for (const name of ['hook.early.js', 'hook.main.js']) {
  const file = new URL('apps/production-extension/' + name, root);
  let source = readFileSync(file, 'utf8');
  const moduleStart = source.indexOf('  // packages/sensors/src/pro-loader.ts');
  const recorderStart = source.indexOf('  // packages/sensors/src/api-results.ts');
  if (recorderStart < 0 || moduleStart >= recorderStart) throw new Error(name + ': module boundaries changed');
  const prefix = source.slice(0, moduleStart >= 0 ? moduleStart : recorderStart);
  source = prefix + loaderSensorRuntimeSource + source.slice(recorderStart);
  const field = '    proSession = "";';
  if (!source.includes('    loaderCollector = loaderSensorSupport.createCollector();')) source = source.replace(field, '    loaderCollector = loaderSensorSupport.createCollector();\n' + field);
  const clearStart = source.indexOf('    clearPro() {'), clearEnd = source.indexOf('    handleProControl(', clearStart);
  if (clearStart < 0 || clearEnd < clearStart) throw new Error(name + ': lifecycle changed');
  const clear = source.slice(clearStart, clearEnd);
  if (!clear.includes('this.loaderCollector.reset()')) source = source.slice(0, clearStart) + clear.replace('this.proSession = "",', 'this.loaderCollector.reset(), this.proSession = "",') + source.slice(clearEnd);
  const controlStart = source.indexOf('    handleProControl('), controlEnd = source.indexOf('\n    record(operation,', controlStart);
  if (controlStart < 0 || controlEnd < controlStart) throw new Error(name + ': read boundaries changed');
  source = source.slice(0, controlStart) + `    handleProControl(data, enabled, env) {
      enabled = enabled && !valueCaptureDenied(this);
      let own = getDescriptor, channel = own(data, "channel")?.value, type = own(data, "type")?.value;
      let sessionId = own(data, "sessionId")?.value, requestId = own(data, "requestId")?.value;
      if (channel !== "detect.expert/pro-values/v1" || typeof sessionId !== "string" || !/^[A-Za-z0-9-]{1,64}$/.test(sessionId) || typeof requestId !== "string" || !/^pro-[0-9]{1,10}$/.test(requestId)) return;
      if (type === "pro-values-stop") { if (this.proSession === sessionId) this.clearPro(); return; }
      if (type !== "pro-values-start" && type !== "pro-values-read") return;
      if (type === "pro-values-start" && this.proSession !== sessionId) { this.clearPro(); if (enabled) { this.proSession = sessionId; try { this.onProSessionChanged?.(true); } catch {} } }
      let now = env.now();
      if (now - this.proLastReadAt < 500) return;
      this.proLastReadAt = now;
      const active = enabled && this.proSession === sessionId;
      let rows = [];
      if (active) apply6(mapForEach2, this.proRows, [row => arrayPush(rows, row)]);
      let index = 0, batch = 0;
      while (index < rows.length && batch < 63) {
        let entries = [], bytes = 512;
        while (index < rows.length && entries.length < 32) {
          let row = rows[index], cost = 256 + proValueKey(row).length * 2;
          if (bytes + cost > 16384) break;
          arrayPush(entries, row), bytes += cost, index++;
        }
        const denied = valueCaptureDenied(this);
        env.postMessage({ channel, type: "pro-values-batch", sessionId, requestId, batchSeq: batch++, final: denied, enabled: active && !denied, rows: denied ? [] : entries, truncated: denied ? false : this.proTruncated });
        if (denied) return;
        if (!entries.length) break;
      }
      const denied = valueCaptureDenied(this);
      const loaders = active && !denied ? this.loaderCollector.snapshot() : { rows: [], truncated: false };
      env.postMessage({ channel, type: "pro-values-batch", sessionId, requestId, batchSeq: batch, final: true, enabled: active && !denied, rows: [], truncated: !denied && (this.proTruncated || index < rows.length), loaderRows: loaders.rows, loaderTruncated: loaders.truncated });
    }
` + source.slice(controlEnd);
  const integration = '    loaderSensorSupport.install(runtime, realm, { wrapPreparedMethod, wrapSetter });';
  if (!source.includes(integration)) {
    const install = '  function installSensors(runtime, realm) {';
    if (!source.includes(install)) throw new Error(name + ': installer boundary changed');
    source = source.replace(install, install + '\n' + integration);
  }
  const legacySource = 'recordRequest(targetIndex(args[0]), methodIndex, threw, !0), !threw && name === "HTMLImageElement"';
  const sharedSource = 'recordRequest(targetIndex(args[0]), methodIndex, threw, !0), name === "HTMLScriptElement" && runtime.observeLoaderScriptSource?.(receiver, args, threw), !threw && name === "HTMLImageElement"';
  const socialSharedSource = 'recordRequest(targetIndex(args[0]), methodIndex, threw, !0), runtime.observeSocialSource?.(name, receiver, args, threw), name === "HTMLScriptElement" && runtime.observeLoaderScriptSource?.(receiver, args, threw), !threw && name === "HTMLImageElement"';
  if (!source.includes(sharedSource) && !source.includes(socialSharedSource)) {
    if (!source.includes(legacySource)) throw new Error(name + ': shared script setter boundary changed');
    source = source.replace(legacySource, sharedSource);
  }
  const previous = readFileSync(file, 'utf8');
  if (check && previous !== source) throw new Error(name + ': loader runtime needs synchronization');
  if (!check && previous !== source) writeFileSync(file, source);
  console.log((check ? 'checked ' : 'synchronized ') + fileURLToPath(file));
}
