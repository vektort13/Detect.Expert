// ADR-076: additive production integration; one owner of the new API boundary.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..'),check=process.argv.includes('--check'),changes=[];
function prepare(file,transform){const path=resolve(root,file),before=existsSync(path)?readFileSync(path,'utf8'):'',after=transform(before);if(before!==after)changes.push({file,path,after});}
function insert(source,anchor,addition){if(source.includes(addition))return source;if(source.split(anchor).length!==2)throw Error('Precursor modes integration: '+anchor);return source.replace(anchor,anchor+addition);}
prepare('apps/production-extension/precursor-modes-contracts.js',()=>readFileSync(resolve(root,'packages/contracts/src/precursor-modes.mjs'),'utf8'));
prepare('apps/production-extension/background.js',source=>{
  source=insert(source,'import { installAutosurfService } from "./autosurf-service.js";\n','import { installPrecursorModesService } from "./precursor-modes-service.js";\nimport { readPrecursorZone } from "./precursor-zone-route.js";\n');
  source=source.replace('installPrecursorModesService(chrome, { consent: () => background.runtime.scope.hasDataConsent === true })','installPrecursorModesService(chrome, { consent: () => background.runtime.scope.hasDataConsent === true, whenReady: () => background.runtime.whenReady() })');
  source=insert(source,'background.runtime.autosurf = installAutosurfService(chrome);\n','// ADR-076: opt-in, fixed read-only Cloudflare API, RAM-only credential.\nbackground.runtime.precursorModes = installPrecursorModesService(chrome, { consent: () => background.runtime.scope.hasDataConsent === true, whenReady: () => background.runtime.whenReady() });\n');
  const route='  if (messageType === "ui-get-precursor-zone") {\n    if (!verifyUiSender(sender, runtime.api.runtime.id)) return uiError("unauthorized-sender");\n    return await readPrecursorZone(runtime, message) ?? uiError("invalid-request");\n  }\n';
  if(!source.includes(route))source=source.replace('  if (messageType === "ui-get-precursor") {',route+'  if (messageType === "ui-get-precursor") {');
  // Notification grants and unrelated host permission changes must preserve this connection.
  for(const name of ['clearSession','discardUnconsentedData']) {
    const start=source.indexOf('  async '+name+'() {'),end=source.indexOf('\n  }',start);
    if(start<0||end<0)throw Error('Missing lifecycle '+name);
    let body=source.slice(start,end);
    if(!body.includes('const precursorCleared =')) {
      body=body.replace('this.precursor?.clear(); this.precursorModes?.clear();','this.precursor?.clear();\n    const precursorCleared = Promise.resolve(this.precursorModes?.clear() ?? true).catch(() => false);');
      if(name==='clearSession')body=body.replace('return { schemaVersion: 1, type: "ok", reportRevision: null };','if (!await precursorCleared) return uiError("no-access");\n    return { schemaVersion: 1, type: "ok", reportRevision: null };');
      else body=body.replace('return cleared && cleanup.every((result) => result.status === "fulfilled");','return cleared && cleanup.every((result) => result.status === "fulfilled") && await precursorCleared;');
    }
    source=source.slice(0,start)+body+source.slice(end);
  }
  return source;
});
if(check&&changes.length)throw Error('Precursor modes synchronization needed: '+changes.map(item=>item.file).join(', '));
for(const {path,after}of check?[]:changes)writeFileSync(path,after);
console.log((check?'checked':'synchronized')+' Precursor modes');
