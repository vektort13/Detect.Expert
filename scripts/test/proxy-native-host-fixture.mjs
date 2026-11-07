// E22-25: temporary exact-host native registrations and an isolated owned vault.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve, sep } from 'node:path';
const literal = value => "'" + value.replaceAll("'", "''") + "'";
function ps(script) { const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, encoding: 'utf8', timeout: 30000 }); if (result.status !== 0) throw Error('owned native registry operation failed'); return result.stdout; }
const productionHostName = 'com.detect_expert.proxy';
const hostLiteral = "export const PROXY_NATIVE_HOST = 'com.detect_expert.proxy';";
export function createOwnedNativeHostName() { return productionHostName + '.audit_' + randomUUID().replaceAll('-', ''); }
export function ownedNativeBindingSource(source, hostName) {
  assert.match(hostName, /^com\.detect_expert\.proxy\.audit_[a-f0-9]{32}$/);
  assert.equal(source.split(hostLiteral).length, 2, 'exactly one delivered native host binding');
  return source.replace(hostLiteral, "export const PROXY_NATIVE_HOST = '" + hostName + "';");
}
export function ownedNativeHostPaths(browser, hostName) {
  assert.ok(['chrome', 'firefox'].includes(browser));
  assert.match(hostName, /^com\.detect_expert\.proxy\.audit_[a-f0-9]{32}$/);
  const vendors = browser === 'chrome' ? ['Google\\Chrome', 'Chromium'] : ['Mozilla'];
  return vendors.map(vendor => 'Software\\' + vendor + '\\NativeMessagingHosts\\' + hostName);
}
// Only a disposable extension copy receives this one-literal transport binding.
// Production bytes and native caller checks remain separately attested.
export function isolateOwnedNativeBinding({ directory, hostName }) {
  const path = join(directory, 'proxy-shared.js'), source = readFileSync(path, 'utf8'), instrumented = ownedNativeBindingSource(source, hostName);
  writeFileSync(path, instrumented);
  const sha = value => createHash('sha256').update(value).digest('hex');
  return { productionName: productionHostName, fixtureName: hostName, originalSHA256: sha(source), instrumentedSHA256: sha(instrumented), onlyNativeHostNameChanged: true };
}
export async function registerOwnedProxyHost({ root, run, opened, browser, hostName }) {
  assert.equal(process.platform, 'win32');
  const paths = ownedNativeHostPaths(browser, hostName);
  const directory = join(run, 'native-host'), dataDirectory = join(run, 'native-data'), pidFile = join(run, 'native-child.pid');
  mkdirSync(directory, { recursive: true }); mkdirSync(dataDirectory, { recursive: true });
  const executable = join(directory, 'detect-expert-proxy.exe'), launcher = join(directory, 'owned-native-launcher.exe');
  copyFileSync(join(root, 'release/proxy-native/windows-amd64/detect-expert-proxy.exe'), executable);
  const extensionId = await opened.evaluate(() => (globalThis.browser ?? globalThis.chrome).runtime.id), origin = opened.base;
  const caller = browser === 'chrome' ? origin : extensionId;
  writeFileSync(join(directory, 'allowed-callers.json'), JSON.stringify([caller]));
  const goSource = 'package main\nimport("os";"os/exec";"strconv")\nfunc main(){os.Setenv("APPDATA",' + JSON.stringify(dataDirectory) + ');c:=exec.Command(' + JSON.stringify(executable) + ',os.Args[1:]...);c.Stdin=os.Stdin;c.Stdout=os.Stdout;c.Stderr=os.Stderr;if c.Start()!=nil{os.Exit(1)};os.WriteFile(' + JSON.stringify(pidFile) + ',[]byte(strconv.Itoa(c.Process.Pid)),0600);if c.Wait()!=nil{os.Exit(1)}}\n';
  const sourceFile = join(directory, 'launcher.go'); writeFileSync(sourceFile, goSource);
  const compiler = join(root, '.tmp/proxy-engines-cache/go/bin/go.exe');
  const built = spawnSync(compiler, ['build', '-trimpath', '-ldflags=-s -w', '-o', launcher, sourceFile], { windowsHide: true, encoding: 'utf8', env: { ...process.env, CGO_ENABLED: '0', GOTOOLCHAIN: 'local' } }); assert.equal(built.status, 0, 'owned native vault isolator build');
  const manifest = { name: hostName, description: 'Owned Detect Expert Proxy fixture', path: launcher, type: 'stdio', ...(browser === 'chrome' ? { allowed_origins: [origin] } : { allowed_extensions: [extensionId] }) };
  const manifestFile = join(directory, 'native-host.json'); writeFileSync(manifestFile, JSON.stringify(manifest));
  const backupFile = join(run, 'native-registry-backup.json');
  const setup = "$ErrorActionPreference='Stop';$r=[Microsoft.Win32.Registry]::CurrentUser;$b=@();foreach($p in @(" + paths.map(literal).join(',') + ")){$k=$r.OpenSubKey($p);$e=$null-ne$k;if($e){$k.Close();throw 'owned native registration already exists'};$v=$null;$kind='String';$present=$false;if($e){$present=$k.GetValueNames()-contains '';if($present){$v=$k.GetValue('', $null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames);if($v-isnot[string]){throw 'unsupported prior native path'};$kind=$k.GetValueKind('').ToString()};$k.Close()};$b+=@{path=$p;exists=$e;present=$present;value=$v;kind=$kind}};[IO.File]::WriteAllText(" + literal(backupFile) + ",($b|ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)));foreach($p in @(" + paths.map(literal).join(',') + ")){$k=$r.CreateSubKey($p);$k.SetValue(''," + literal(manifestFile) + ",[Microsoft.Win32.RegistryValueKind]::String);$k.Close()}";
  const restore = () => {
    if (!existsSync(backupFile)) return;
    const backup = JSON.parse(readFileSync(backupFile, 'utf8'));
    const rows = Array.isArray(backup) ? backup : [backup];
    assert.equal(rows.length, paths.length);
    let script = "$ErrorActionPreference='Stop';$r=[Microsoft.Win32.Registry]::CurrentUser;";
    for (const row of rows) {
      assert.ok(paths.includes(row.path));
      script += '$owned=$r.OpenSubKey(' + literal(row.path) + ');if($null-eq$owned-or$owned.GetValue(\'\')-ne' + literal(manifestFile) + "){throw 'native registration changed externally'};$owned.Close();";
      if (!row.exists) script += '$r.DeleteSubKey(' + literal(row.path) + ',$false);';
      else if (!row.present) script += '$k=$r.OpenSubKey(' + literal(row.path) + ",$true);$k.DeleteValue('',$false);$k.Close();";
      else { assert.ok(['String', 'ExpandString'].includes(row.kind)); script += '$k=$r.OpenSubKey(' + literal(row.path) + ",$true);$k.SetValue(''," + literal(row.value) + ',[Microsoft.Win32.RegistryValueKind]::' + row.kind + ');$k.Close();'; }
      script += '$verified=$r.OpenSubKey(' + literal(row.path) + ');';
      if (!row.exists) script += "if($null-ne$verified){$verified.Close();throw 'native registration leaf not removed'};";
      else {
        script += "if($null-eq$verified){throw 'native registration leaf not restored'};";
        if (!row.present) script += "if($verified.GetValueNames()-contains ''){$verified.Close();throw 'native registration default not removed'};";
        else script += "if($verified.GetValue('', $null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) -cne " + literal(row.value) + " -or $verified.GetValueKind('').ToString() -ne " + literal(row.kind) + "){$verified.Close();throw 'native registration value or kind not restored'};";
        script += '$verified.Close();';
      }
    }
    ps(script);
  };
  try { ps(setup); } catch (error) { restore(); throw error; }
  return { directory, dataDirectory, executable, hash: createHash('sha256').update(readFileSync(executable)).digest('hex'), launcherHash: createHash('sha256').update(readFileSync(launcher)).digest('hex'), registryKeys: paths.length, restore,
    killOwnedHost() { const pid = Number(readFileSync(pidFile, 'utf8')); assert.ok(Number.isSafeInteger(pid) && pid > 0); const actual = resolve(executable); assert.ok(actual.startsWith(resolve(run) + sep)); ps("$ErrorActionPreference='Stop';$p=Get-CimInstance Win32_Process -Filter " + literal('ProcessId=' + pid) + ';if($null-eq$p-or$p.ExecutablePath-ne' + literal(actual) + "){throw 'unexpected native fixture process'};Stop-Process -Id " + pid + ' -Force'); }
  };
}
