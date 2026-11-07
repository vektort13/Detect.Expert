// Repacks the Windows proxy companion after its executables were signed with Authenticode.
//
//   node scripts/repack-signed-companion.mjs [--check]
//
// Input:  release/Detect.Expert-Proxy-Companion-windows-x64/   the package folder with the signed executables
//         release/proxy-native/windows-amd64/                  the unsigned build the tests ran against
// Output: companion.json and engines/engines.json refreshed in the signed folder,
//         release/Detect.Expert-Proxy-Companion-windows-x64.zip written (deterministic).
//
// What it checks before it writes anything:
//   1. every executable has a valid Authenticode signature with a trusted timestamp;
//   2. every signed executable is the tested build plus its signature and nothing else: with the certificate table removed and the
//      PE checksum ignored, the bytes are identical to the unsigned file.
// Install.ps1 verifies every file of the package against companion.json, so the manifest must be refreshed after signing.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { archiveProduction } from './build-production.mjs';

const root = resolve(import.meta.dirname, '..');
const signedDir = join(root, 'release/Detect.Expert-Proxy-Companion-windows-x64');
const builtDir = join(root, 'release/proxy-native/windows-amd64');
const archivePath = join(root, 'release/Detect.Expert-Proxy-Companion-windows-x64.zip');
export const SIGNED_EXECUTABLES = Object.freeze(['detect-expert-proxy.exe', 'engines/xray.exe', 'engines/openvpn2socks.exe']);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** The PE file with its certificate table cut off and the checksum cleared, for comparison with the unsigned build. */
export function withoutSignature(bytes) {
  const buffer = Buffer.from(bytes);
  const peOffset = buffer.readUInt32LE(0x3c);
  if (buffer.toString('latin1', peOffset, peOffset + 4) !== 'PE\0\0') throw new Error('Not a PE file.');
  const optional = peOffset + 24;
  if (buffer.readUInt16LE(optional) !== 0x20b) throw new Error('Only PE32+ (64-bit) files are supported.');
  const checksumAt = optional + 64, securityAt = optional + 112 + 4 * 8;
  const certificateOffset = buffer.readUInt32LE(securityAt), certificateSize = buffer.readUInt32LE(securityAt + 4);
  let end = buffer.length;
  if (certificateOffset !== 0) {
    if (certificateOffset + certificateSize !== buffer.length) throw new Error('The certificate table is not at the end of the file.');
    end = certificateOffset;
  }
  const result = Buffer.from(buffer.subarray(0, end));
  result.writeUInt32LE(0, checksumAt); result.writeUInt32LE(0, securityAt); result.writeUInt32LE(0, securityAt + 4);
  return result;
}

function signature(path) {
  const script = "$s = Get-AuthenticodeSignature -LiteralPath $env:SIGNED_FILE; [pscustomobject]@{ status = [string]$s.Status; subject = $s.SignerCertificate.Subject; thumbprint = $s.SignerCertificate.Thumbprint; timestamped = [bool]$s.TimeStamperCertificate; notAfter = $s.SignerCertificate.NotAfter.ToString('o') } | ConvertTo-Json -Compress";
  const run = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, env: { ...process.env, SIGNED_FILE: path } });
  if (run.status !== 0) throw new Error('Could not read the signature of ' + path + ': ' + run.stderr);
  return JSON.parse(run.stdout);
}

function listFiles(directory) {
  return readdirSync(directory).sort().flatMap(name => { const file = join(directory, name); return statSync(file).isDirectory() ? listFiles(file) : [file]; });
}

function main() {
  const check = process.argv.includes('--check');
  if (process.platform !== 'win32') throw new Error('Signature verification needs Windows.');
  for (const directory of [signedDir, builtDir]) if (!existsSync(directory)) throw new Error('Missing ' + directory);

  const report = [];
  for (const name of SIGNED_EXECUTABLES) {
    const signedFile = join(signedDir, name), builtFile = join(builtDir, name);
    const info = signature(signedFile);
    if (info.status !== 'Valid') throw new Error(name + ': signature status is ' + info.status + ', expected Valid.');
    if (!info.timestamped) throw new Error(name + ': the signature has no trusted timestamp.');
    const signedBytes = readFileSync(signedFile), builtBytes = readFileSync(builtFile);
    if (!withoutSignature(signedBytes).equals(withoutSignature(builtBytes))) throw new Error(name + ': the signed file differs from the tested build beyond the signature.');
    report.push({ file: name, signer: info.subject.split(',')[0], thumbprint: info.thumbprint, validUntil: info.notAfter.slice(0, 10), builtSha256: sha256(builtBytes), signedSha256: sha256(signedBytes) });
  }

  // engines/engines.json keeps the hash of what is shipped and, next to it, the hash of the unsigned build the tests ran against.
  const enginesPath = join(signedDir, 'engines/engines.json');
  const engines = JSON.parse(readFileSync(enginesPath, 'utf8'));
  for (const engine of engines.engines) {
    const row = report.find(item => item.file === 'engines/' + engine.filename);
    if (!row) throw new Error('No executable for engine ' + engine.id);
    engine.sha256 = row.signedSha256; engine.unsignedSha256 = row.builtSha256;
  }
  const enginesText = JSON.stringify(engines, null, 2) + '\n';

  const files = listFiles(signedDir).filter(file => relative(signedDir, file).split('\\').join('/') !== 'companion.json').map(file => {
    const path = relative(signedDir, file).split('\\').join('/');
    const bytes = path === 'engines/engines.json' ? Buffer.from(enginesText) : readFileSync(file);
    return { path, bytes: bytes.length, sha256: sha256(bytes) };
  });
  const manifestText = JSON.stringify({ format: 'detect.expert.proxy-companion', version: 1, platform: 'windows-x64', files }, null, 2) + '\n';

  if (check) {
    const same = readFileSync(enginesPath, 'utf8') === enginesText && readFileSync(join(signedDir, 'companion.json'), 'utf8') === manifestText;
    console.log(JSON.stringify({ check: same ? 'up to date' : 'OUT OF DATE', executables: report }, null, 2));
    process.exit(same ? 0 : 1);
  }
  writeFileSync(enginesPath, enginesText);
  writeFileSync(join(signedDir, 'companion.json'), manifestText);
  const archive = archiveProduction(signedDir);
  writeFileSync(archivePath, archive);
  console.log(JSON.stringify({ archive: archivePath, files: files.length + 1, bytes: archive.length, sha256: sha256(archive), executables: report }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
