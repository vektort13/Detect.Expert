// ADR-070: reproducible user-installed native artifact, separate from extension.
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, cpSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { archiveProduction } from './build-production.mjs';
const root=resolve(import.meta.dirname,'..'),source=join(root,'native/proxy'),output=join(root,'release/proxy-native/windows-amd64');
if(process.platform!=='win32'||process.arch!=='x64')throw Error('This companion package targets Windows x64.');
function run(executable,args,options={}){const result=spawnSync(executable,args,{stdio:'inherit',windowsHide:true,...options});if(result.status!==0)throw Error('Native build failed.');}
const compiler=join(root,'.tmp/proxy-engines-cache/go/bin/go.exe');
if(process.argv.includes('--engines')||!existsSync(compiler)||!existsSync(join(output,'engines/engines.json')))run(process.execPath,[join(root,'scripts/build-proxy-engines.mjs')]);
mkdirSync(output,{recursive:true});
const checkEnvironment={...process.env,GOTOOLCHAIN:'local'};
// vet and a fresh (uncached) test run gate every build of the companion
run(compiler,['vet','./host'],{cwd:source,env:checkEnvironment});
run(compiler,['test','-count=1','./host'],{cwd:source,env:checkEnvironment});
run(compiler,['build','-trimpath','-ldflags=-s -w','-o',join(output,'detect-expert-proxy.exe'),'./host'],{cwd:source,env:{...process.env,CGO_ENABLED:'0',GOOS:'windows',GOARCH:'amd64',GOTOOLCHAIN:'local'}});
for(const file of ['Install.ps1','Uninstall.ps1','LICENSE',...readdirSync(source).filter(name=>/^README([.][A-Za-z-]+)?[.]md$/.test(name))])copyFileSync(join(source,file),join(output,file));
const deliveredSource=resolve(output,'source/companion');
if(!deliveredSource.startsWith(resolve(root,'release/proxy-native')+sep))throw Error('Unsafe native source output path.');
rmSync(deliveredSource,{recursive:true,force:true});
cpSync(source,deliveredSource,{recursive:true});
function files(directory){return readdirSync(directory).sort().flatMap(name=>{const file=join(directory,name);return statSync(file).isDirectory()?files(file):[file];});}
const listing=files(output).filter(file=>relative(output,file).replaceAll('\\','/')!=='companion.json').map(file=>({path:relative(output,file).replaceAll('\\','/'),bytes:statSync(file).size,sha256:createHash('sha256').update(readFileSync(file)).digest('hex')}));
const manifest={format:'detect.expert.proxy-companion',version:1,platform:'windows-x64',files:listing};writeFileSync(join(output,'companion.json'),JSON.stringify(manifest,null,2)+'\n');
const archive=archiveProduction(output),file=join(root,'release/Detect.Expert-Proxy-Companion-windows-x64.zip');writeFileSync(file,archive);
console.log(JSON.stringify({file,files:listing.length,bytes:archive.length,sha256:createHash('sha256').update(archive).digest('hex')}));
