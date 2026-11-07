// E22-25: complete native/browser-tested delivery, explicit permission delta.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { archiveProduction, validateProductionManifest } from '../build-production.mjs';
import { SIGNED_EXECUTABLES, withoutSignature } from '../repack-signed-companion.mjs';
import { PROXY_WORKSPACE_KEYS, PROXY_WORKSPACE_MESSAGES } from '../production-locales-proxy.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';
import { MANAGEMENT_SECTIONS } from '../../apps/production-extension/management-ui.js';
import { managementNavigationLabels } from '../../apps/production-extension/management-navigation-labels.js';
import { ownedNativeBindingSource } from './proxy-native-host-fixture.mjs';

const root=resolve(import.meta.dirname,'../..'),directory=join(root,'test-results/production-1.1.0/proxy');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),read=file=>JSON.parse(readFileSync(file,'utf8'));
const report={at:new Date().toISOString(),result:'PASS',permissions:{requiredAdded:['proxy'],optionalAdded:['nativeMessaging','clipboardWrite'],hostPermissionsChanged:false,cspChanged:false},files:[],locales:[],native:[],archives:[]};
assert.equal(MANAGEMENT_SECTIONS.indexOf('proxy'),MANAGEMENT_SECTIONS.indexOf('cookies')+1,'Proxy sits right after Cookies');assert.ok(MANAGEMENT_SECTIONS.indexOf('proxy')<MANAGEMENT_SECTIONS.indexOf('contacts'),'Proxy comes before Contacts');
for(const browser of ['chrome','firefox']){
 const dist=join(root,'dist',browser),manifest=read(join(dist,'manifest.json'));assert.deepEqual(validateProductionManifest(manifest,browser),[]);
 assert.ok(manifest.permissions.includes('proxy'));assert.ok(!manifest.optional_permissions.includes('proxy'));assert.ok(manifest.optional_permissions.includes('nativeMessaging'));assert.ok(!manifest.permissions.includes('nativeMessaging'));
 assert.ok(manifest.optional_permissions.includes('clipboardWrite'));assert.ok(!manifest.permissions.includes('clipboardWrite'));assert.ok(![...manifest.permissions,...manifest.optional_permissions].includes('clipboardRead'));
 const native=read(join(directory,browser+'.json')),auth=read(join(directory,browser+'-native-auth.json')),ui=read(join(directory,'ui-'+browser+'.json'));
 for(const evidence of [native,auth,ui]){assert.equal(evidence.result,'PASS');assert.equal(evidence.disposableProfile,true);}
 assert.ok(native.checks.length>=7);assert.ok(auth.checks.length>=13);assert.ok(ui.checks.length>=6);assert.equal(auth.nativeRegistryRestored,true);assert.equal(auth.nativeHost.vaultIsolatedFromUser,true);
 assert.deepEqual(auth.promotedFixturePermissions,['nativeMessaging','clipboardWrite']);
 const binding=auth.nativeHostBinding;assert.equal(auth.nativeHost.registryNamespaceIsolated,true);assert.equal(binding.onlyNativeHostNameChanged,true);assert.equal(binding.productionName,'com.detect_expert.proxy');assert.match(binding.fixtureName,/^com\.detect_expert\.proxy\.audit_[a-f0-9]{32}$/);
 const deliveredShared=readFileSync(join(dist,'proxy-shared.js'));assert.equal(sha(deliveredShared),binding.originalSHA256);assert.equal(sha(ownedNativeBindingSource(deliveredShared.toString('utf8'),binding.fixtureName)),binding.instrumentedSHA256);
 report.nativeBindingInstrumentation??=[];report.nativeBindingInstrumentation.push({browser,...binding,scope:'one transport-binding literal in a disposable copy; production caller authentication unchanged'});
 for(const [name,hash] of Object.entries(native.hashes)){const bytes=readFileSync(join(dist,name));assert.equal(sha(bytes),hash,browser+' native delivery '+name);assert.ok(bytes.equals(readFileSync(join(root,'apps/production-extension',name))));report.files.push({browser,name,sha256:hash});}
 assert.equal(sha(readFileSync(join(dist,'background.js'))),native.backgroundSHA256);assert.equal(native.backgroundSHA256,auth.backgroundSHA256);
 for(const [name,hash] of Object.entries(ui.hashes))assert.equal(sha(readFileSync(join(dist,name))),hash,browser+' UI delivery '+name);
 assert.equal(sha(readFileSync(join(root,'release/proxy-native/windows-amd64/detect-expert-proxy.exe'))),auth.nativeHost.sha256);
 for(const locale of PRODUCTION_LANGUAGES){const table=read(join(dist,locale.uiOnly?'ui-locales':'_locales',locale.id,'messages.json'));for(const key of PROXY_WORKSPACE_KEYS)assert.equal(table[key]?.message,key==='proxy_workspace_state_off'?managementNavigationLabels(locale.id).off:PROXY_WORKSPACE_MESSAGES[locale.id][key]);assert.equal(table.management_tab_proxy.message,'Proxy');report.locales.push({browser,locale:locale.id,keys:PROXY_WORKSPACE_KEYS.length});}
 const bytes=archiveProduction(dist),archive=join(root,'release','Detect.Expert-'+manifest.version+'-'+browser+'.zip');assert.ok(bytes.equals(readFileSync(archive)));report.archives.push({browser,bytes:bytes.length,sha256:sha(bytes)});
 report.native.push({browser,version:native.version,routing:native.checks.length,auth:auth.checks.length,ui:ui.checks.length});
}
const companion=join(root,'release/proxy-native/windows-amd64'),nativeManifest=read(join(companion,'companion.json'));
for(const file of nativeManifest.files)assert.equal(sha(readFileSync(join(companion,file.path))),file.sha256,'companion '+file.path);
const nativeArchive=join(root,'release/Detect.Expert-Proxy-Companion-windows-x64.zip'),shipped=join(root,'release/Detect.Expert-Proxy-Companion-windows-x64');
if(existsSync(shipped)){
 // The shipped folder holds the signed executables (scripts/repack-signed-companion.mjs): its manifest and archive are checked on their own, and every signed
 // executable must be the tested build plus its signature.
 const shippedManifest=read(join(shipped,'companion.json'));
 for(const file of shippedManifest.files)assert.equal(sha(readFileSync(join(shipped,file.path))),file.sha256,'shipped companion '+file.path);
 const shippedZip=archiveProduction(shipped);assert.ok(shippedZip.equals(readFileSync(nativeArchive)),'the companion ZIP is the deterministic archive of the signed folder');
 for(const name of SIGNED_EXECUTABLES)assert.ok(withoutSignature(readFileSync(join(shipped,name))).equals(withoutSignature(readFileSync(join(companion,name)))),'signed '+name+' is the tested build plus its signature');
 const shippedEngines=read(join(shipped,'engines/engines.json'));for(const engine of shippedEngines.engines){assert.equal(sha(readFileSync(join(shipped,'engines',engine.filename))),engine.sha256);assert.equal(engine.unsignedSha256,sha(readFileSync(join(companion,'engines',engine.filename))));}
 report.companion={files:shippedManifest.files.length,bytes:shippedZip.length,sha256:sha(shippedZip),signed:true};
}else{
 const nativeZip=archiveProduction(companion);assert.ok(nativeZip.equals(readFileSync(nativeArchive)));report.companion={files:nativeManifest.files.length,bytes:nativeZip.length,sha256:sha(nativeZip),signed:false};
}
const engineManifest=read(join(companion,'engines/engines.json'));for(const engine of engineManifest.engines)assert.equal(sha(readFileSync(join(companion,'engines',engine.filename))),engine.sha256);
if(existsSync(join(directory,'provider-native.json'))||process.argv.includes('--require-provider')){
 const provider=read(join(directory,'provider-native.json'));assert.equal(provider.result,'PASS');assert.deepEqual(provider.checks.map(row=>row.protocol),['socks5','vless','openvpn']);for(const row of provider.checks){assert.equal(row.dnsRequestsUseDomainAtyp,true);assert.equal(row.trace.tlsVerified,true);assert.equal(row.trace.status,200);assert.equal(row.analyzer.reachable,true);assert.equal(row.analyzer.remoteDns,true);assert.equal(row.analyzer.tlsVerified,true);assert.equal(row.analyzer.httpStatus,200);assert.deepEqual(Object.keys(row.analyzer).sort(),['elapsedMs','httpStatus','ip','reachable','remoteDns','tlsVerified']);assert.equal(row.localEndpointClosed,true);}report.provider=provider.checks.map(({protocol,trace})=>({protocol,http:trace.status,ip:trace.observedProxyIP}));
 for(const row of provider.checks){assert.equal(row.exportedAllFields,true);assert.equal(row.activeRouteUnchanged,true);assert.equal(row.checkLeavesDisconnected,true);for(const value of [row.activeCheck,row.inactiveCheck]){assert.equal(value.reachable,true);assert.equal(value.remoteDns,true);assert.equal(value.tlsVerified,true);assert.equal(value.httpStatus,200);}if(row.protocol==='openvpn')assert.equal(row.parallelVpnGuard,true);}
 for(const [file,hash] of Object.entries(provider.hashes))assert.equal(sha(readFileSync(join(companion,file))),hash,'real provider-tested native '+file);
 const http=read(join(directory,'http-provider.json'));assert.equal(http.result,'PASS');assert.equal(http.proxyStatus,200);
}else report.provider={status:'not-run',reason:'Requires explicit private provider test input'};
mkdirSync(directory,{recursive:true});writeFileSync(join(directory,'package.json'),JSON.stringify(report,null,2)+'\n');console.log('proxy-package: PASS ('+report.files.length+' routing source/dist hashes, '+report.locales.length+' locale deliveries, '+report.companion.files+' native files, both extension ZIP and companion ZIP)');
