import { execFileSync } from 'node:child_process';
import { auditInputs, scanCode } from './code-checks.mjs';
import { assertBundledDependencies } from './sbom.mjs';
// esbuild-based extension build (ADR-002). Deterministic, auditable output: no hashes in file names, no
// minification, no sourcemaps in the local (release) profile, no runtime imports in MAIN/ISOLATED bundles.
// Usage: node scripts/build.mjs --profile local|test|test-optional [--watch] [--sourcemap]
//   --sourcemap  inline sourcemaps; allowed for test profiles only
//   --watch      rebuild JS bundles on change (manifest and static files are copied once)

import { build, context } from 'esbuild';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appDir = join(root, 'apps', 'extension');
const PROFILES = ['local', 'test', 'test-optional'];

function fail(message) {
  console.error('build: ' + message);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { profile: 'local', watch: false, sourcemap: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--profile') {
      i++;
      if (i >= argv.length) fail('--profile requires a value');
      out.profile = argv[i];
    } else if (arg.startsWith('--profile=')) {
      out.profile = arg.slice('--profile='.length);
    } else if (arg === '--watch') {
      out.watch = true;
    } else if (arg === '--sourcemap') {
      out.sourcemap = true;
    } else {
      fail('unknown argument ' + arg);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!PROFILES.includes(args.profile)) fail('unknown profile "' + args.profile + '" (expected local|test|test-optional)');
if (args.sourcemap && args.profile === 'local') fail('sourcemaps are not allowed in the local (release) profile');

const outDir = join(root, 'dist', args.profile);
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

/** world: sw | main | isolated | ui. MAIN/ISOLATED bundles are IIFEs and must have no runtime imports. */
const BUNDLES = [
  { entry: 'entrypoints/background.ts', out: 'background.js', format: 'esm', world: 'sw' },
  { entry: 'entrypoints/hook.main.ts', out: 'hook.early.js', format: 'iife', world: 'main' },
  { entry: 'entrypoints/hook.main.ts', out: 'hook.main.js', format: 'iife', world: 'main' },
  { entry: 'entrypoints/bridge.ts', out: 'bridge.js', format: 'iife', world: 'isolated' },
  { entry: 'entrypoints/popup/popup.tsx', out: 'popup.js', format: 'esm', world: 'ui' },
  { entry: 'entrypoints/sidepanel/sidepanel.tsx', out: 'sidepanel.js', format: 'esm', world: 'ui' },
  { entry: 'entrypoints/options/options.tsx', out: 'options.js', format: 'esm', world: 'ui' },
];

const STATIC = [
  ['../../NOTICE', 'NOTICE'],
  ['../../packages/attribution/data/public_suffix_list.dat', 'third-party/public_suffix_list.dat'],
  ['../../packages/attribution/data/PSL-LICENSE.txt', 'third-party/PSL-LICENSE.txt'],
  ['../../packages/ui/src/styles/ui.css', 'ui.css'],
  ['entrypoints/popup/popup.html', 'popup.html'],
  ['entrypoints/popup/popup.css', 'popup.css'],
  ['entrypoints/sidepanel/sidepanel.html', 'sidepanel.html'],
  ['entrypoints/sidepanel/sidepanel.css', 'sidepanel.css'],
  ['entrypoints/options/options.html', 'options.html'],
  ['entrypoints/options/options.css', 'options.css'],
  ['_locales', '_locales'],
  ['public/icons', 'icons'],
];

function bundleOptions(bundle) {
  return {
    entryPoints: [join(appDir, bundle.entry)],
    outfile: join(outDir, bundle.out),
    metafile: true,
    bundle: true,
    format: bundle.format,
    platform: 'browser',
    target: ['chrome119'],
    charset: 'utf8',
    legalComments: 'none',
    minify: false,
    treeShaking: true,
    sourcemap: args.sourcemap ? 'inline' : false,
    jsx: 'automatic',
    jsxImportSource: 'preact',
    define: { 'process.env.NODE_ENV': '"production"', __BUILD_PROFILE__: JSON.stringify(args.profile), __EARLY_CAPTURE__: String(bundle.out === 'hook.early.js') },
    minifySyntax: true,
    logLevel: 'warning',
    absWorkingDir: root,
  };
}

async function emitManifest() {
  const result = await build({
    entryPoints: [join(appDir, 'manifest.ts')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
    logLevel: 'silent',
    absWorkingDir: root,
  });
  const code = result.outputFiles[0].text;
  const mod = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
  const manifest = mod.buildManifest(args.profile, version);
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

function copyStatic() {
  for (const [src, dst] of STATIC) {
    const from = join(appDir, src);
    if (!existsSync(from)) fail('missing static input ' + src + ' (run "pnpm icons" for icons)');
    cpSync(from, join(outDir, dst), { recursive: true });
  }
}

function verifyBundle(bundle) {
  const text = readFileSync(join(outDir, bundle.out), 'utf8');
  const problems = [];
  if (/^\s*import\s/m.test(text)) problems.push('contains an import statement (everything must be bundled)');
  if (/^\s*export\s/m.test(text)) problems.push('contains an export statement');
  if (/\brequire\s*\(/.test(text)) problems.push('contains require()');
  if (/\bimport\s*\(/.test(text)) problems.push('contains dynamic import()');
  if (bundle.world === 'main' && /\bchrome\./.test(text)) problems.push('MAIN bundle references chrome.*');
  if (!args.sourcemap && /sourceMappingURL/.test(text)) problems.push('contains a sourcemap comment');
  return problems;
}

function verifyManifestRefs(manifest) {
  const refs = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    manifest.side_panel.default_path,
    manifest.options_ui.page,
    ...Object.values(manifest.icons),
    '_locales/' + manifest.default_locale + '/messages.json',
  ];
  for (const ref of refs) {
    if (!existsSync(join(outDir, ref))) fail('manifest references a missing file: ' + ref);
  }
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

async function main() {
  execFileSync(process.execPath, [join(root, 'scripts/gen-psl.mjs'), '--check'], { stdio: 'inherit' });
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const manifest = await emitManifest();
  copyStatic();

  if (args.watch) {
    const contexts = await Promise.all(BUNDLES.map((b) => context(bundleOptions(b))));
    await Promise.all(contexts.map((c) => c.watch()));
    console.log('build: watching profile "' + args.profile + '" -> ' + outDir + ' (static files and manifest copied once)');
    return;
  }

  const results = await Promise.all(BUNDLES.map((b) => build(bundleOptions(b))));
  for (const result of results) assertBundledDependencies(result.metafile.inputs);

  const problems = [];
  results.forEach((result, i) => problems.push(...auditInputs(result.metafile.inputs, BUNDLES[i].world)));
  for (const b of BUNDLES) problems.push(...scanCode(readFileSync(join(outDir, b.out), 'utf8'), b.out, { html: b.world !== 'ui' }).map((hit) => b.out + ': ' + hit));
  for (const b of BUNDLES) for (const p of verifyBundle(b)) problems.push(b.out + ': ' + p);
  if (problems.length > 0) {
    for (const p of problems) console.error('build: ' + p);
    process.exit(1);
  }
  verifyManifestRefs(manifest);

  console.log('build: profile "' + args.profile + '" version ' + version + ' -> ' + outDir);
  for (const name of [...BUNDLES.map((b) => b.out), 'manifest.json']) {
    const file = join(outDir, name);
    console.log('  ' + name.padEnd(16) + String(statSync(file).size).padStart(8) + ' B  sha256 ' + sha256(file).slice(0, 16));
  }
}

await main();
