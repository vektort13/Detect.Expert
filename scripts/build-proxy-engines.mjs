// ADR-070: build-time only pinned native engines; no runtime downloads.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const definitions = join(root, 'native', 'proxy', 'engines');
const pins = JSON.parse(await readFile(join(definitions, 'pins.json'), 'utf8'));
const cache = join(root, '.tmp', 'proxy-engines-cache');
const output = join(root, 'release', 'proxy-native', pins.platform, 'engines');
const sha = data => createHash('sha256').update(data).digest('hex');
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Pinned engine build currently targets Windows amd64.');
await mkdir(cache, { recursive: true });
await mkdir(output, { recursive: true });

async function download(item, source = false) {
  const filename = source ? item.sourceFilename : item.filename;
  const expected = source ? item.sourceSha256 : item.sha256;
  const path = join(cache, filename);
  let data;
  try { data = await readFile(path); } catch { /* Download only absent build inputs. */ }
  if (data && sha(data) !== expected) throw new Error(`Cached input checksum mismatch: ${filename}`);
  if (!data) {
    const response = await fetch(source ? item.sourceUrl : item.url, { signal: AbortSignal.timeout(180_000) });
    if (!response.ok) throw new Error(`Build input failed: ${filename} (${response.status})`);
    data = Buffer.from(await response.arrayBuffer());
    if (data.length > 128 * 1024 * 1024 || sha(data) !== expected) throw new Error(`Downloaded input checksum mismatch: ${filename}`);
    await writeFile(path, data, { flag: 'wx' });
  }
  console.log(`Verified ${filename} ${expected}`);
  return path;
}
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, windowsHide: true, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, ...options });
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})\n${result.stdout || ''}\n${result.stderr || result.error || ''}`);
  return `${result.stdout || ''}${result.stderr || ''}`;
}
async function extract(archive, target) {
  await mkdir(target, { recursive: true });
  run('tar', ['-xf', archive, '-C', target]);
}
const [goArchive, ovpnArchive, xrayArchive, xraySourceArchive] = await Promise.all([
  download(pins.go), download(pins.openvpn), download(pins.xray), download(pins.xray, true),
]);
const go = join(cache, 'go', 'bin', 'go.exe');
try { await stat(go); } catch { await extract(goArchive, cache); }
const goVersion = run(go, ['version']).trim();
if (!goVersion.includes(`${pins.go.version} windows/amd64`)) throw new Error('Unexpected Go toolchain');
const work = await mkdtemp(join(cache, 'build-'));
await extract(ovpnArchive, work);
const source = join(work, `go-openvpn-${pins.openvpn.commit}`);
const cli = join(source, 'cmd', 'openvpn2socks');
// Isolate git-apply from the surrounding application's repository root.
run('git', ['init', '--quiet'], { cwd: source });
for (const patch of ['openvpn-dns-fail-closed.patch', 'openvpn-plain-tls-control.patch', 'openvpn-stdin-profile.patch', 'openvpn-tunnel-dns-tcp.patch', 'openvpn-negotiated-keys.patch']) {
  run('git', ['apply', '--check', join(definitions, patch)], { cwd: source });
  run('git', ['apply', join(definitions, patch)], { cwd: source });
}
if ((await readFile(join(cli, 'resolver.go'), 'utf8')).includes('lookup = net.DefaultResolver.LookupNetIP')) throw new Error('Tunnel-only DNS patch was not applied');
await copyFile(join(definitions, 'detect_dns_test.go.txt'), join(cli, 'detect_dns_test.go'));
for (const file of ['stdin_profile.go', 'detect_stdin_test.go', 'tunnel_dns_tcp.go', 'detect_dns_tcp_test.go']) await copyFile(join(definitions, `${file}.txt`), join(cli, file));
await copyFile(join(definitions, 'plain_control.go.txt'), join(source, 'internal', 'session', 'detect_plain_control.go'));
await copyFile(join(definitions, 'detect_plain_control_test.go.txt'), join(source, 'internal', 'session', 'detect_plain_control_test.go'));
for (const file of ['legacy_keys.go', 'detect_legacy_keys_test.go']) await copyFile(join(definitions, `${file}.txt`), join(source, 'internal', 'control', file));
await copyFile(join(definitions, 'local_session.go.txt'), join(source, 'internal', 'reliable', 'detect_local_session.go'));
await copyFile(join(definitions, 'detect_legacy_session_test.go.txt'), join(source, 'internal', 'session', 'detect_legacy_session_test.go'));
const environment = { ...process.env, GOTOOLCHAIN: 'local', CGO_ENABLED: '0', GOOS: 'windows', GOARCH: 'amd64', GOWORK: 'off' };
console.log('Testing OpenVPN core, profile parser, and tunnel-only DNS policy...');
const coreTests = run(go, ['test', './...'], { cwd: source, env: environment, timeout: 300_000 });
const cliTests = run(go, ['test', './...'], { cwd: cli, env: environment, timeout: 300_000 });
console.log(coreTests.trim());
console.log(cliTests.trim());
// Include all source dependencies that actually enter the shipped executable.
run(go, ['mod', 'vendor'], { cwd: cli, env: environment, timeout: 180_000 });
run(go, ['build', '-mod=vendor', '-trimpath', '-buildvcs=false', '-ldflags=-s -w -buildid=', '-o', join(output, 'openvpn2socks.exe'), '.'], { cwd: cli, env: environment, timeout: 300_000 });
const xrayWork = join(work, 'xray');
await extract(xrayArchive, xrayWork);
await copyFile(join(xrayWork, 'xray.exe'), join(output, 'xray.exe'));
const sourceOutput = join(output, 'source');
await mkdir(sourceOutput, { recursive: true });
// Hidden directories (version control, editor and tool settings) are not part of the corresponding source.
await cp(source, join(sourceOutput, 'go-openvpn'), { recursive: true, filter: async path => !(basename(path).startsWith('.') && (await stat(path)).isDirectory()) });
// One vendored comment points at a settings file that is not shipped; the reference is dropped, the code is untouched.
const netstack = join(sourceOutput, 'go-openvpn', 'cmd', 'openvpn2socks', 'vendor', 'github.com', 'n0madic', 'go-tun2net', 'netstack.go');
await writeFile(netstack, (await readFile(netstack, 'utf8')).replace(/\(\w+\.md point 10 failure mode\)/u, '(failure mode 10 of the design notes)'));
await copyFile(ovpnArchive, join(sourceOutput, pins.openvpn.filename));
await copyFile(xraySourceArchive, join(sourceOutput, pins.xray.sourceFilename));
await copyFile(join(definitions, 'openvpn-dns-fail-closed.patch'), join(sourceOutput, 'openvpn-dns-fail-closed.patch'));
for (const file of ['openvpn-plain-tls-control.patch', 'openvpn-stdin-profile.patch', 'openvpn-tunnel-dns-tcp.patch', 'detect_dns_test.go.txt', 'plain_control.go.txt', 'detect_plain_control_test.go.txt', 'stdin_profile.go.txt', 'detect_stdin_test.go.txt', 'tunnel_dns_tcp.go.txt', 'detect_dns_tcp_test.go.txt']) await copyFile(join(definitions, file), join(sourceOutput, file.replace(/\.txt$/, '')));
for (const file of ['openvpn-negotiated-keys.patch', 'legacy_keys.go.txt', 'detect_legacy_keys_test.go.txt', 'local_session.go.txt', 'detect_legacy_session_test.go.txt']) await copyFile(join(definitions, file), join(sourceOutput, file.replace(/\.txt$/, '')));
for (const file of ['README.md', 'pins.json']) await copyFile(join(definitions, file), join(output, file));
await copyFile(join(definitions, 'BUILD-SOURCE.md'), join(sourceOutput, 'BUILD-SOURCE.md'));
await copyFile(fileURLToPath(import.meta.url), join(sourceOutput, 'build-proxy-engines.mjs'));
for (const file of await readdir(xrayWork)) if (/license/i.test(file)) await copyFile(join(xrayWork, file), join(sourceOutput, `xray-${file}`));
const manifest = {
  schemaVersion: 1, platform: pins.platform, toolchain: goVersion,
  engines: [
    { id: 'xray', filename: 'xray.exe', version: pins.xray.version, sha256: sha(await readFile(join(output, 'xray.exe'))), license: pins.xray.license },
    { id: 'openvpn2socks', filename: 'openvpn2socks.exe', commit: pins.openvpn.commit, sha256: sha(await readFile(join(output, 'openvpn2socks.exe'))), license: pins.openvpn.license, dns: 'tunnel-only', systemTun: false },
  ],
  tests: { core: coreTests.trim().split(/\r?\n/), cli: cliTests.trim().split(/\r?\n/) },
};
await writeFile(join(output, 'engines.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Pinned proxy engines ready: ${output}`);
