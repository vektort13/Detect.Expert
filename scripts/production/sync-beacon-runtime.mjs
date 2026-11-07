// ADR-030: reproduce shared decoder, browser observer and source-attributed MAIN calls.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createBeaconEndpointProjector, createBeaconSensorSupport, startBeaconValuesBridge } from './beacon-sensor-runtime.mjs';
const root = resolve(import.meta.dirname, '../..'), check = process.argv.includes('--check');
const read = file => readFileSync(resolve(root, file), 'utf8');
const canonical = read('packages/contracts/src/beacons.mjs');
const put = (file, before, after) => { if (check && before !== after) throw Error(file + ': beacon synchronization needed'); if (!check && before !== after) writeFileSync(resolve(root, file), after); };
const contract = 'apps/production-extension/beacon-contracts.js';
put(contract, existsSync(resolve(root, contract)) ? read(contract) : '', canonical);
// Import only after writing the runtime contract on the first synchronization.
const { startBeaconTimingBridge } = await import('../../apps/production-extension/beacon-observer.js');
const replaceBlock = (source, start, end, block, boundary) => {
  const from = source.indexOf(start);
  if (from < 0) { if (!source.includes(boundary)) throw Error('beacon insertion boundary'); return source.replace(boundary, block + '\n' + boundary); }
  const to = source.indexOf(end, from); if (to < 0) throw Error('beacon end boundary');
  return source.slice(0, from) + block + source.slice(to + end.length);
};
const decoder = read('apps/production-extension/beacon-decoder.js').replace(/^import .*;\r?\n/gm, '').replaceAll('export ', '');
const contracts = 'var beaconContracts = (() => {\n' + canonical.replaceAll('export ', '') + '\nreturn { BEACON_EVENTS, BEACON_CURRENCIES, beaconDecimal, readBeaconScriptRows, readBeaconSnapshot, readBeaconDocuments };\n})();\n';
const decoderRuntime = 'var beaconDecoder = (() => {\nconst URL=globalThis.URL, URLSearchParams=globalThis.URLSearchParams, Map=globalThis.Map, Set=globalThis.Set, String=globalThis.String, Object=globalThis.Object, Array=globalThis.Array, Number=globalThis.Number, RegExp=globalThis.RegExp, Reflect=globalThis.Reflect, JSON=globalThis.JSON, TextDecoder=globalThis.TextDecoder, ArrayBuffer=globalThis.ArrayBuffer, Uint8Array=globalThis.Uint8Array;\nconst {BEACON_EVENTS,BEACON_CURRENCIES,beaconDecimal}=beaconContracts;\n' + decoder + '\nreturn {decodeBeacon};\n})();\n';
{
  const file = 'apps/production-extension/background.js', before = read(file); let source = before;
  const imports = 'import { BEACON_REQUEST_FILTER } from "./beacon-decoder.js";\n';
  if (!source.includes(imports)) source = imports + source;
  const start = '// ADR-030 beacon browser listeners start\n', end = '// ADR-030 beacon browser listeners end\n';
  const block = start + ['before', 'completed', 'error', 'redirect'].map((phase, index) => 'chrome.webRequest.' + ['onBeforeRequest', 'onCompleted', 'onErrorOccurred', 'onBeforeRedirect'][index] + '.addListener(details => background.runtime.beacons.observe(details, "' + phase + '"), BEACON_REQUEST_FILTER' + (index === 0 ? ', ["requestBody"]' : '') + ');').join('\n') + '\n' + end;
  source = source.includes(start) ? replaceBlock(source, start, end, block, '') : source + '\n' + block;
  put(file, before, source);
}
for (const name of ['hook.early.js', 'hook.main.js']) {
  const file = 'apps/production-extension/' + name, before = read(file); let source = before;
  const start = '  // ADR-030 beacon MAIN sensor start\n', end = '  // ADR-030 beacon MAIN sensor end\n';
  const block = start + '  var beaconEndpointProjector = (' + createBeaconEndpointProjector.toString() + ')();\n  var beaconSensorSupport = (' + createBeaconSensorSupport.toString() + ')(beaconEndpointProjector);\n' + end;
  source = replaceBlock(source, start, end, block, '  // packages/sensors/src/social-network.ts\n');
  const collector = '    socialCollector = socialSensorSupport.createCollector();';
  if (!source.includes('    beaconCollector = beaconSensorSupport.createCollector();')) source = source.replace(collector, collector + '\n    beaconCollector = beaconSensorSupport.createCollector();');
  source = source.replace('this.socialCollector.reset(); this.clearPro();', 'this.socialCollector.reset(); this.beaconCollector.reset(); this.clearPro();');
  const control = '        if (getDescriptor(data2, "channel")?.value === "detect.expert/social/v1")';
  const ownControl = '        if (getDescriptor(data2, "channel")?.value === "detect.expert/beacon/v1") { this.apiResults.beaconCollector.handleControl(data2, this.hooks.enabled, this.env); return; }\n';
  if (!source.includes(ownControl)) source = source.replace(control, ownControl + control);
  const install = '    socialSensorSupport.install(runtime, realm, { wrapMethod, wrapSetter });';
  if (!source.includes('    beaconSensorSupport.install(runtime);')) source = source.replace(install, install + '\n    beaconSensorSupport.install(runtime);');
  put(file, before, source);
}
{
  const file = 'apps/production-extension/bridge.js', before = read(file); let source = before;
  const start = '  // ADR-030 beacon bridge start\n', end = '  // ADR-030 beacon bridge end\n';
  const block = start + contracts + decoderRuntime + '  var startBeaconTimingBridge = (' + startBeaconTimingBridge.toString() + ');\n  var startBeaconValuesBridge = (' + startBeaconValuesBridge.toString() + ');\n' +
    '  function startBrowserBeaconBridges() {\n' +
    '    const apply=Reflect.apply, descriptor=Object.getOwnPropertyDescriptor;\n' +
    '    const name=descriptor(PerformanceEntry.prototype,"name")?.get, start=descriptor(PerformanceEntry.prototype,"startTime")?.get, initiator=descriptor(PerformanceResourceTiming.prototype,"initiatorType")?.get;\n' +
    '    const env={onCommand: listener=>chrome.runtime.onMessage.addListener((message,sender,respond)=>listener(isOwnServiceWorker(sender),message,respond)),onHide:listener=>window.addEventListener("pagehide",listener)};\n' +
    '    startBeaconTimingBridge({...env,decode:beaconDecoder.decodeBeacon,name:entry=>apply(name,entry,[]),start:entry=>apply(start,entry,[]),initiator:entry=>apply(initiator,entry,[]),now:()=>performance.now(),entries:()=>performance.getEntriesByType("resource"),observe:(record,buffered)=>{const observer=new PerformanceObserver(list=>record(list.getEntries()));observer.observe({type:"resource",buffered});return observer;},onRestore:listener=>window.addEventListener("pageshow",event=>{if(event.persisted)listener();}),onBufferFull:listener=>performance.addEventListener("resourcetimingbufferfull",listener)});\n' +
    '    startBeaconValuesBridge({...env,onPage:listener=>window.addEventListener("message",event=>listener(event.source===window,event.data)),post:message=>window.postMessage(message,"*"),later:(callback,delay)=>setTimeout(callback,delay),cancel:timer=>clearTimeout(timer),now:()=>performance.now()},beaconContracts.readBeaconScriptRows);\n' +
    '  }\n' + end;
  source = replaceBlock(source, start, end, block, '  // packages/collector/src/api-results.ts\n');
  const install = 'startBrowserSocialValuesBridge(),';
  if (!source.includes('startBrowserBeaconBridges(),') && !source.includes('startBrowserBeaconBridges();')) {
    if (!source.includes(install)) throw Error('beacon bridge installation boundary');
    source = source.replace(install, 'startBrowserSocialValuesBridge(), startBrowserBeaconBridges(),');
  }
  put(file, before, source);
}
console.log((check ? 'checked' : 'synchronized') + ' beacons runtime');
