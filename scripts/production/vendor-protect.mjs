// ADR-047 (S1): byte copy of the opt-in module «Защита» (ADR-020, commit 722fae8) into vendor/protect-722fae8/.
// Every file comes from `git show <commit>:<path>` (the stored blob, no eol conversion) and is recorded with its
// sha256 and git blob id in apps/production-protect/VENDOR.json. The vendored tree is never edited by hand: the
// production adapter lives in apps/production-protect/src and the build in scripts/production/build-protect.mjs.
// Usage:
//   node scripts/production/vendor-protect.mjs [--commit <sha>]   write vendor/protect-722fae8/** and VENDOR.json
//   node scripts/production/vendor-protect.mjs --check            verify the tree against VENDOR.json (no git needed;
//                                                                 with the commit available also against git)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const VENDOR_COMMIT = '722fae8cd8044bcc2d2ae388ba2e0e89e204d3d4';
export const VENDOR_DIR = 'vendor/protect-722fae8';
export const VENDOR_MANIFEST = 'apps/production-protect/VENDOR.json';

/** Source packages of the module (src, test, package.json each). */
export const VENDOR_PACKAGES = Object.freeze(['contracts', 'engine', 'attribution', 'catalog', 'background', 'collector', 'sensors', 'ui', 'export']);
const ENTRY_FILES = new Set(['protect.ts', 'protect.main.ts', 'protect-on.ts', 'protect-policy.ts', 'gpc.main.ts']);
const EXACT_FILES = new Set([
  'apps/extension/_locales/ru/messages.json',
  'apps/extension/_locales/en/messages.json',
  'scripts/code-checks.mjs',
  'scripts/privacy-checks.mjs',
  'scripts/privacy-observers.mjs',
  'scripts/privacy-scan.mjs',
  'tests/fixture-server.mjs',
  'fixtures/privacy/protect-canary-page.html',
  'fixtures/privacy/protect-attribution-canary.html',
  'fixtures/privacy/canaries.json',
  'docs/decisions/ADR-020.md',
  'runbooks/manual-chrome-check.md',
  'tsconfig.base.json',
]);

/** Selection rule of the vendored tree (port plan §1.1), applied to `git ls-tree -r --name-only <commit>`. */
export function isVendorPath(path) {
  if (EXACT_FILES.has(path)) return true;
  const pkg = /^packages\/([^/]+)\/(src\/.+|test\/.+|package\.json)$/.exec(path);
  if (pkg !== null) return VENDOR_PACKAGES.includes(pkg[1]);
  if (path.startsWith('apps/extension/entrypoints/')) {
    const rest = path.slice('apps/extension/entrypoints/'.length);
    if (ENTRY_FILES.has(rest)) return true;
    if (rest.startsWith('requests/')) return true;
    return /^test-only\/protect-tripwire\.[^/]+$/.test(rest);
  }
  if (path.startsWith('tests/extension/protect/')) return true;
  if (/^tests\/privacy\/[^/]*protect[^/]*$/.test(path)) return true;
  return path.startsWith('fixtures/protect/');
}

function fail(message) {
  console.error('vendor-protect: ' + message);
  process.exit(1);
}

function git(args, options = {}) {
  return execFileSync('git', args, { cwd: root, maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...options });
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Git blob id of the bytes (sha1 of "blob <size>\0" + bytes). */
export function blobId(bytes) {
  return createHash('sha1').update('blob ' + String(bytes.length) + '\0').update(bytes).digest('hex');
}

/** Hash of the whole tree: sha256 over "path\tsha256\n" lines in path order. */
export function treeHash(files) {
  return sha256(files.map((f) => f.path + '\t' + f.sha256 + '\n').join(''));
}

function filesUnder(dir, base = dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort().flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? filesUnder(full, base) : [relative(base, full).split(sep).join('/')];
  });
}

function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Selected paths of the commit with their blob ids (one ls-tree call). */
function listCommit(commit) {
  const text = git(['ls-tree', '-r', '--full-tree', commit]).toString('utf8');
  const out = [];
  for (const line of text.split('\n')) {
    if (line === '') continue;
    const m = /^(\d+) (\w+) ([0-9a-f]{40})\t(.+)$/.exec(line);
    if (m === null) throw new Error('unexpected ls-tree line: ' + line);
    if (m[2] !== 'blob' || !isVendorPath(m[4])) continue;
    out.push({ path: m[4], blob: m[3], mode: m[1] });
  }
  return out.sort((x, y) => compare(x.path, y.path));
}

function resolveCommit(commit) {
  try {
    return git(['rev-parse', '--verify', commit + '^{commit}']).toString('utf8').trim();
  } catch {
    return null;
  }
}

function writeVendor(commitArg) {
  const commit = resolveCommit(commitArg);
  if (commit === null) fail('commit ' + commitArg + ' is not reachable from ' + root);
  const listed = listCommit(commit);
  if (listed.length === 0) fail('no vendored paths in ' + commit);
  const target = join(root, VENDOR_DIR);
  if (!target.startsWith(join(root, 'vendor') + sep)) fail('unsafe vendor directory');
  rmSync(target, { recursive: true, force: true });
  const files = [];
  for (const entry of listed) {
    if (entry.mode !== '100644') fail('unexpected file mode ' + entry.mode + ' for ' + entry.path);
    const bytes = git(['show', commit + ':' + entry.path]);
    const blob = blobId(bytes);
    if (blob !== entry.blob) fail('git show bytes differ from the blob of ' + entry.path);
    const file = join(target, ...entry.path.split('/'));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
    files.push({ path: entry.path, bytes: bytes.length, sha256: sha256(bytes), blob });
  }
  const manifest = {
    schema: 1,
    adr: 'ADR-047',
    note: 'Byte copy of the module «Защита» (ADR-020) sources; written by scripts/production/vendor-protect.mjs with git show <commit>:<path>. Never edit vendor/protect-722fae8 by hand.',
    commit,
    directory: VENDOR_DIR,
    selection: 'packages/{' + VENDOR_PACKAGES.join(',') + '}/{src/**,test/**,package.json}; apps/extension/entrypoints/{' + [...ENTRY_FILES].join(',') + ',requests/**,test-only/protect-tripwire.*}; ' + [...EXACT_FILES].join('; ') + '; tests/extension/protect/**; tests/privacy/*protect*; fixtures/protect/**',
    fileCount: files.length,
    totalBytes: files.reduce((sum, f) => sum + f.bytes, 0),
    treeSha256: treeHash(files),
    files,
  };
  mkdirSync(dirname(join(root, VENDOR_MANIFEST)), { recursive: true });
  writeFileSync(join(root, VENDOR_MANIFEST), JSON.stringify(manifest, null, 2) + '\n');
  console.log('vendor-protect: ' + String(files.length) + ' files (' + String(manifest.totalBytes) + ' B) from ' + commit + ' -> ' + VENDOR_DIR);
  console.log('  tree sha256 ' + manifest.treeSha256);
}

/** Verifies vendor/protect-722fae8 against VENDOR.json (and against git when the commit is reachable). */
export function checkVendor() {
  const problems = [];
  const manifestFile = join(root, VENDOR_MANIFEST);
  if (!existsSync(manifestFile)) return { problems: [VENDOR_MANIFEST + ' is missing'], files: 0, git: false };
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  if (manifest.schema !== 1 || manifest.directory !== VENDOR_DIR || manifest.commit !== VENDOR_COMMIT) problems.push('VENDOR.json header does not match ' + VENDOR_DIR + ' @ ' + VENDOR_COMMIT);
  const recorded = Array.isArray(manifest.files) ? manifest.files : [];
  const onDisk = filesUnder(join(root, VENDOR_DIR));
  const recordedPaths = new Set(recorded.map((f) => f.path));
  for (const path of onDisk) if (!recordedPaths.has(path)) problems.push('extra file in ' + VENDOR_DIR + ': ' + path);
  for (const f of recorded) {
    if (!isVendorPath(f.path)) problems.push('VENDOR.json lists a path outside the selection: ' + f.path);
    const file = join(root, VENDOR_DIR, ...f.path.split('/'));
    if (!existsSync(file)) {
      problems.push('missing vendored file ' + f.path);
      continue;
    }
    const bytes = readFileSync(file);
    if (bytes.length !== f.bytes || sha256(bytes) !== f.sha256) problems.push('changed vendored file ' + f.path + ' (sha256 differs from VENDOR.json)');
    else if (blobId(bytes) !== f.blob) problems.push('blob id of ' + f.path + ' differs from VENDOR.json');
  }
  const sorted = [...recorded].sort((x, y) => compare(x.path, y.path));
  if (sorted.some((f, i) => f !== recorded[i])) problems.push('VENDOR.json files are not in path order');
  if (manifest.fileCount !== recorded.length) problems.push('VENDOR.json fileCount differs from its file list');
  if (manifest.totalBytes !== recorded.reduce((sum, f) => sum + f.bytes, 0)) problems.push('VENDOR.json totalBytes differs from its file list');
  if (manifest.treeSha256 !== treeHash(recorded)) problems.push('VENDOR.json treeSha256 differs from its file list');
  let gitChecked = false;
  if (resolveCommit(VENDOR_COMMIT) === VENDOR_COMMIT) {
    gitChecked = true;
    const listed = listCommit(VENDOR_COMMIT);
    const byPath = new Map(recorded.map((f) => [f.path, f]));
    if (listed.length !== recorded.length) problems.push('selection of ' + VENDOR_COMMIT + ' has ' + String(listed.length) + ' files, VENDOR.json ' + String(recorded.length));
    for (const entry of listed) {
      const f = byPath.get(entry.path);
      if (f === undefined) problems.push('not vendored: ' + entry.path);
      else if (f.blob !== entry.blob) problems.push('blob of ' + entry.path + ' differs from git ' + VENDOR_COMMIT);
    }
  }
  return { problems, files: recorded.length, git: gitChecked, treeSha256: manifest.treeSha256 };
}

function main(argv) {
  let commit = VENDOR_COMMIT;
  let check = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--check') check = true;
    else if (argv[i] === '--commit') commit = argv[++i] ?? fail('--commit requires a value');
    else fail('unknown argument ' + argv[i]);
  }
  if (check) {
    const result = checkVendor();
    if (result.problems.length > 0) {
      for (const p of result.problems) console.error('vendor-protect: ' + p);
      process.exit(1);
    }
    console.log('vendor-protect: OK (' + String(result.files) + ' files match VENDOR.json' + (result.git ? ' and git ' + VENDOR_COMMIT : '; commit not reachable, git comparison skipped') + ')');
    return;
  }
  writeVendor(commit);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main(process.argv.slice(2));
