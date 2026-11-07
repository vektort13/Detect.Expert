import { scanCode } from './code-checks.mjs';
import { version as esbuildVersion } from 'esbuild';
import { validateBrowserSupport, validateManifest } from './release-checks.mjs';
import { releasePreflight } from './release-preflight.mjs';
import { verifySbom } from './sbom.mjs';
// Release gate for the local (release) profile: builds, verifies the compiled manifest against
// apps/extension/permissions.allowlist.json, scans dist for forbidden content, checks icons and manifest
// references, then writes a deterministic zip to release/detect.expert-<version>.zip and prints its sha256.
// Usage: node scripts/release-verify.mjs

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist', 'local');
const problems = [];

function problem(message) {
  problems.push(message);
}

function listFiles(dir, out = [], base = dir) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) listFiles(full, out, base);
    else out.push(relative(base, full).split('\\').join('/'));
  }
  return out;
}

// 1. Build the release profile with the same script developers use.
let lockfileSha256;
try { lockfileSha256 = releasePreflight(root); verifySbom(root); console.log('release-verify: SBOM lockfile hash and inventory verified'); }
catch (error) { console.error('release-verify: ' + error.message); process.exit(1); }
const buildResult = spawnSync(process.execPath, [join(root, 'scripts', 'build.mjs'), '--profile', 'local'], {
  stdio: 'inherit',
  cwd: root,
});
if (buildResult.status !== 0) {
  console.error('release-verify: build failed');
  process.exit(1);
}

// 2. Manifest vs allowlist.
const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
const allow = JSON.parse(readFileSync(join(root, 'apps', 'extension', 'permissions.allowlist.json'), 'utf8'));

problems.push(...validateManifest(manifest, allow));
const support = JSON.parse(readFileSync(join(root, 'browser-support.json'), 'utf8'));
problems.push(...validateBrowserSupport(manifest, support));

// 3. Scan dist content.
const ALLOWED_DIST_URL_HOSTS = new Set(['www.w3.org']); // XML namespaces inside the Preact renderer
const files = listFiles(dist);
for (const rel of files) {
  const ext = rel.slice(rel.lastIndexOf('.'));
  if (ext === '.map') problem('sourcemap file in dist: ' + rel);
  if (!['.js', '.html', '.css', '.json'].includes(ext)) continue;
  const text = readFileSync(join(dist, rel), 'utf8');
  if (ext === '.js' && /readTabIdOverride|tabId=|__BUILD_PROFILE__|__p05/.test(text)) problem(rel + ': retained test scaffolding');
  if (ext === '.js') for (const hit of scanCode(text, rel, { html: !['popup.js', 'sidepanel.js', 'options.js'].includes(rel) })) problem(rel + ': ' + hit);
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/\beval\s*\(/.test(line)) problem(rel + ':' + (i + 1) + ': eval()');
    if (/\bnew\s+Function\b/.test(line)) problem(rel + ':' + (i + 1) + ': Function constructor');
    if (/sourceMappingURL/.test(line)) problem(rel + ':' + (i + 1) + ': sourcemap comment');
    const re = /\bhttps?:\/\/([a-z0-9][a-z0-9.-]*)/gi;
    let m;
    while ((m = re.exec(line)) !== null) {
      if (!ALLOWED_DIST_URL_HOSTS.has(m[1].toLowerCase())) problem(rel + ':' + (i + 1) + ': remote URL ' + m[0]);
    }
  }
}

// 4. Icons and manifest references.
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
for (const size of ['16', '32', '48', '128']) {
  const ref = manifest.icons?.[size];
  if (ref !== 'icons/' + size + '.png') problem('icons.' + size + ' must be icons/' + size + '.png');
  const file = join(dist, 'icons', size + '.png');
  if (!existsSync(file)) problem('missing icon ' + size + '.png (run pnpm icons)');
  else if (!readFileSync(file).subarray(0, 8).equals(PNG_MAGIC)) problem('icon ' + size + '.png is not a PNG');
}
for (const ref of [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  manifest.side_panel?.default_path,
  manifest.options_ui?.page,
  '_locales/ru/messages.json',
  '_locales/en/messages.json',
]) {
  if (typeof ref !== 'string' || !existsSync(join(dist, ref))) problem('manifest references a missing file: ' + ref);
}

if (problems.length > 0) {
  for (const p of problems) console.error('release-verify: ' + p);
  console.error('release-verify: FAILED with ' + problems.length + ' problem(s)');
  process.exit(1);
}

// 5. Deterministic zip (sorted entries, fixed DOS timestamp 1980-01-01, deflate level 9, UTF-8 names).
function zipDirectory(dir, entries) {
  const DOS_TIME = 0;
  const DOS_DATE = (1 << 5) | 1; // 1980-01-01
  const locals = [];
  const central = [];
  let offset = 0;
  for (const rel of entries) {
    const data = readFileSync(join(dir, rel));
    const deflated = deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const payload = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;
    const name = Buffer.from(rel, 'utf8');
    const crc = crc32(data) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, payload);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(DOS_TIME, 12);
    cd.writeUInt16LE(DOS_DATE, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(payload.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);

    offset += local.length + name.length + payload.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

const releaseDir = join(root, 'release');
mkdirSync(releaseDir, { recursive: true });
const zipName = 'detect.expert-' + manifest.version + '.zip';
const zipPath = join(releaseDir, zipName);
const zip = zipDirectory(dist, files);
writeFileSync(zipPath, zip);
const sha = createHash('sha256').update(zip).digest('hex');
console.log('release-verify: OK');
console.log('  manifest permissions: ' + manifest.permissions.join(', '));
console.log('  files in package: ' + files.length);
console.log('  ' + relative(root, zipPath).split('\\').join('/') + '  ' + zip.length + ' B');
console.log('  sha256 ' + sha);

// F076: record the exact toolchain; cross-machine reproducibility remains an acceptance task.
writeFileSync(join(releaseDir, zipName + '.toolchain.json'), JSON.stringify({ node: process.version, zlib: process.versions.zlib, esbuild: esbuildVersion, platform: process.platform, arch: process.arch, packageSha256: sha, lockfileSha256 }, null, 2) + '\n');
