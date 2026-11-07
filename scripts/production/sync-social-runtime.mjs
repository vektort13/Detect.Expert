// Reproduce the shared passive social sensor and its explicit callback integration.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { socialSensorRuntimeSource } from './social-sensor-runtime.mjs';
import { socialBridgeRuntimeSource } from './social-bridge-runtime.mjs';
const root = resolve(import.meta.dirname, '../..'), check = process.argv.includes('--check');
for (const name of ['hook.early.js', 'hook.main.js']) {
  const file = resolve(root, 'apps/production-extension', name);
  const before = readFileSync(file, 'utf8'); let source = before;
  const marker = '  // packages/sensors/src/pro-loader.ts', ownMarker = '  // packages/sensors/src/social-network.ts';
  const start = source.indexOf(ownMarker), end = source.indexOf(marker);
  if (end < 0 || start >= end) throw new Error(name + ': social module boundary');
  const ownEndMarker = ')(socialNetworkDetector);\n\n', ownEnd = start < 0 ? end : source.indexOf(ownEndMarker, start);
  if (start >= 0 && ownEnd < start) throw new Error(name + ': social end boundary');
  source = source.slice(0, start >= 0 ? start : end) + socialSensorRuntimeSource + source.slice(start < 0 ? end : ownEnd + ownEndMarker.length);
  source = source.replace('    loaderCollector = loaderSensorSupport.createCollector();', '    loaderCollector = loaderSensorSupport.createCollector();\n    socialCollector = socialSensorSupport.createCollector();').replace('    socialCollector = socialSensorSupport.createCollector();\n    socialCollector = socialSensorSupport.createCollector();', '    socialCollector = socialSensorSupport.createCollector();');
  source = source.replace('    clear() {\n      this.clearPro();', '    clear() {\n      this.socialCollector.reset(); this.clearPro();');
  const control = '        if (getDescriptor(data2, "channel")?.value === "detect.expert/pro-values/v1")';
  const socialControl = '        if (getDescriptor(data2, "channel")?.value === "detect.expert/social/v1") { this.apiResults.socialCollector.handleControl(data2, this.hooks.enabled, this.env); return; }\n';
  if (!source.includes(socialControl)) { if (!source.includes(control)) throw new Error(name + ': control boundary'); source = source.replace(control, socialControl + control); }
  const install = '    loaderSensorSupport.install(runtime, realm, { wrapPreparedMethod, wrapSetter });';
  const socialInstall = '    socialSensorSupport.install(runtime, realm, { wrapMethod, wrapSetter });\n';
  if (!source.includes(socialInstall)) source = source.replace(install, socialInstall + install);
  const fetch = 'recordRequest(targetIndex(args.length > 0 ? args[0] : void 0), FETCH_METHOD_INDEX, threw),';
  if (!source.includes('runtime.observeSocialFetch?.(args, threw)')) { if (!source.includes(fetch)) throw new Error(name + ': fetch callback'); source = source.replace(fetch, fetch + ' runtime.observeSocialFetch?.(args, threw),'); }
  const xhrOpen = '        !state || !objectReceiver(receiver) || weakGet5(requests, receiver) !== state ||';
  if (!source.includes('runtime.observeSocialXhrOpen?.(receiver, _args, threw)')) { if (!source.includes(xhrOpen)) throw new Error(name + ': XHR open callback'); source = source.replace(xhrOpen, '        runtime.observeSocialXhrOpen?.(receiver, _args, threw);\n' + xhrOpen); }
  const xhrSend = '        recordRequest(state?.epoch === runtime.historyEpoch ? state.target : null, EXTENSION_METHOD_INDEX["xhr-send"], threw);';
  if (!source.includes('runtime.observeSocialXhrSend?.(_receiver, threw)')) { if (!source.includes(xhrSend)) throw new Error(name + ': XHR send callback'); source = source.replace(xhrSend, '        runtime.observeSocialXhrSend?.(_receiver, threw);\n' + xhrSend); }
  const setter = 'recordRequest(targetIndex(args[0]), methodIndex, threw, !0),';
  if (!source.includes('runtime.observeSocialSource?.(name, receiver, args, threw)')) { if (!source.includes(setter)) throw new Error(name + ': source setter callback'); source = source.replace(setter, setter + ' runtime.observeSocialSource?.(name, receiver, args, threw),'); }
  const resultCallback = '        operation === void 0 ? runtime.record(technique, threw ? PHASE_INDEX["threw-sync"] : phase, SIGNAL_BIT["api-use"])';
  const beaconCallback = '        label === "Navigator.sendBeacon" && runtime.observeSocialBeacon?.(args, threw);\n';
  if (!source.includes(beaconCallback)) { if (!source.includes(resultCallback)) throw new Error(name + ': beacon callback'); source = source.replace(resultCallback, beaconCallback + resultCallback); }
  const finalFamilies = 'return family("Navigator", "DET-059", "sendBeacon", !1), family("ServiceWorkerContainer"';
  const credentialFamily = 'return family("Navigator", "DET-059", "sendBeacon", !1), family("CredentialsContainer", "DET-059", "get"), family("ServiceWorkerContainer"';
  if (!source.includes(credentialFamily)) { if (!source.includes(finalFamilies)) throw new Error(name + ': credentials family'); source = source.replace(finalFamilies, credentialFamily); }
  if (check && source !== before) throw new Error(name + ': social sensor synchronization needed');
  if (!check && source !== before) writeFileSync(file, source);
  console.log((check ? 'checked ' : 'synchronized ') + name + ' social sensor');
}
{
  const file = resolve(root, 'apps/production-extension/bridge.js'), before = readFileSync(file, 'utf8'); let source = before;
  const marker = '  // packages/collector/src/api-results.ts', ownMarker = '  // packages/collector/src/social-network.ts';
  const start = source.indexOf(ownMarker), end = source.indexOf(marker);
  if (end < 0 || start >= end) throw new Error('bridge: social module boundary');
  const ownEndMarker = '    }, readSocialRows);\n  }\n\n', ownEnd = start < 0 ? end : source.indexOf(ownEndMarker, start);
  if (start >= 0 && ownEnd < start) throw new Error('bridge: social end boundary');
  source = source.slice(0, start >= 0 ? start : end) + socialBridgeRuntimeSource + source.slice(start < 0 ? end : ownEnd + ownEndMarker.length);
  const install = 'startBrowserApiResultsBridge(), startProValuesBridge();';
  if (!source.includes('startBrowserSocialValuesBridge();') && !source.includes('startBrowserSocialValuesBridge(),')) { if (!source.includes(install)) throw new Error('bridge: social install boundary'); source = source.replace(install, 'startBrowserApiResultsBridge(), startProValuesBridge(), startBrowserSocialValuesBridge();'); }
  if (check && source !== before) throw new Error('bridge: social synchronization needed');
  if (!check && source !== before) writeFileSync(file, source);
  console.log((check ? 'checked ' : 'synchronized ') + 'bridge social accessor');
}
