// Reproduce only the background feature modules and explicit generic callbacks.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { backgroundSensorRuntimeSource } from './background-activity-runtime.mjs';
import { backgroundBridgeRuntimeSource } from './background-activity-bridge-runtime.mjs';
const root = resolve(import.meta.dirname, '../..'), check = process.argv.includes('--check');
const canonical = readFileSync(resolve(root, 'packages/contracts/src/background-activity.mjs'), 'utf8');
const contractFile = resolve(root, 'apps/production-extension/background-activity-contracts.js');
if (check) { if (readFileSync(contractFile, 'utf8') !== canonical) throw Error('background contract synchronization needed'); }
else writeFileSync(contractFile, canonical);
for (const name of ['hook.early.js', 'hook.main.js']) {
  const file = resolve(root, 'apps/production-extension', name), before = readFileSync(file, 'utf8'); let source = before;
  const marker = '  // packages/sensors/src/pro-loader.ts', ownMarker = '  // packages/sensors/src/background-activity.ts';
  const start = source.indexOf(ownMarker), end = source.indexOf(marker);
  if (end < 0 || start >= end) throw Error(name + ': background module boundary');
  const ownEndMarker = '  // packages/sensors/src/background-activity:end\n\n', ownEnd = source.indexOf(ownEndMarker, start);
  if (start >= 0 && ownEnd < start) throw Error(name + ': background end boundary');
  source = source.slice(0, start >= 0 ? start : end) + backgroundSensorRuntimeSource + source.slice(start >= 0 ? ownEnd + ownEndMarker.length : end);
  const init = '    socialCollector = socialSensorSupport.createCollector();', addition = '\n    backgroundCollector = backgroundSensorSupport.createCollector();';
  if (!source.includes('    backgroundCollector = backgroundSensorSupport.createCollector();')) { if (!source.includes(init)) throw Error(name + ': collector initializer'); source = source.replace(init, init + addition); }
  const clear = 'this.socialCollector.reset();';
  if (!source.includes('this.backgroundCollector.reset();')) { if (!source.includes(clear)) throw Error(name + ': clear boundary'); source = source.replace(clear, 'this.backgroundCollector.reset(); this.socialCollector.reset();'); }
  const control = '        if (getDescriptor(data2, "channel")?.value === "detect.expert/social/v1")';
  const ownControl = '        if (getDescriptor(data2, "channel")?.value === "detect.expert/background/v1") { this.apiResults.backgroundCollector.handleControl(data2, this.hooks.enabled, this.env); return; }\n';
  if (!source.includes(ownControl)) { if (!source.includes(control)) throw Error(name + ': control boundary'); source = source.replace(control, ownControl + control); }
  const install = '    socialSensorSupport.install(runtime, realm, { wrapMethod, wrapSetter });';
  const ownInstall = '    backgroundSensorSupport.install(runtime, realm, { wrapMethod });\n';
  if (!source.includes(ownInstall)) { if (!source.includes(install)) throw Error(name + ': install boundary'); source = source.replace(install, ownInstall + install); }
  const callback = '        label === "Navigator.sendBeacon" && runtime.observeSocialBeacon?.(args, threw);';
  const ownCallback = '        runtime.observeBackgroundOperation?.(label, args, threw);\n';
  if (!source.includes(ownCallback)) { if (!source.includes(callback)) throw Error(name + ': generic callback boundary'); source = source.replace(callback, ownCallback + callback); }
  const capability = ': wrapResultMethod(selected, member, observe, options);';
  const ownCapability = ': backgroundSensorSupport.observes(operation) ? wrapMethod(selected, member, (_receiver, args, threw, _error, value) => { runtime.observeBackgroundOperation?.(operation, args, threw); observe(threw, value); }, options) : wrapResultMethod(selected, member, observe, options);';
  if (!source.includes(ownCapability)) { if (!source.includes(capability)) throw Error(name + ': capability callback boundary'); source = source.replace(capability, ownCapability); }
  if (check && source !== before) throw Error(name + ': background synchronization needed');
  if (!check && source !== before) writeFileSync(file, source);
  console.log((check ? 'checked ' : 'synchronized ') + name + ' background activity');
}
{
  const file = resolve(root, 'apps/production-extension/bridge.js'), before = readFileSync(file, 'utf8'); let source = before;
  const marker = '  // packages/collector/src/api-results.ts', ownMarker = '  // packages/collector/src/background-activity.ts';
  const start = source.indexOf(ownMarker), end = source.indexOf(marker);
  if (end < 0 || start >= end) throw Error('bridge: background module boundary');
  const ownEndMarker = '  // packages/collector/src/background-activity:end\n\n', ownEnd = source.indexOf(ownEndMarker, start);
  if (start >= 0 && ownEnd < start) throw Error('bridge: background end boundary');
  source = source.slice(0, start >= 0 ? start : end) + backgroundBridgeRuntimeSource + source.slice(start >= 0 ? ownEnd + ownEndMarker.length : end);
  const install = 'startBrowserSocialValuesBridge(),';
  if (!source.includes('startBrowserBackgroundValuesBridge();') && !source.includes('startBrowserBackgroundValuesBridge(),')) {
    if (source.includes(install)) source = source.replace(install, 'startBrowserSocialValuesBridge(), startBrowserBackgroundValuesBridge(),');
    else if (source.includes('startBrowserSocialValuesBridge();')) source = source.replace('startBrowserSocialValuesBridge();', 'startBrowserSocialValuesBridge(), startBrowserBackgroundValuesBridge();');
    else throw Error('bridge: background install boundary');
  }
  if (check && source !== before) throw Error('bridge: background synchronization needed');
  if (!check && source !== before) writeFileSync(file, source);
  console.log((check ? 'checked ' : 'synchronized ') + 'bridge background activity');
}
