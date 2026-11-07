// Shared evidence folder and package staging for native tests (scripts/test/*-native.mjs).
// Evidence lives in test-results/production-<version of apps/production-extension/manifest.json>/, never in a
// hard-coded release folder. Readers of evidence written by natives that still use the old hard-coded
// test-results/production-1.1.0 folder fall back to it and are told so (`legacy: true`); the caller still has to
// verify the hashes inside, so an old file can never pass for the current build.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '../..');
export const PRODUCTION_SOURCE = join(ROOT, 'apps/production-extension');
// Folders written by natives before this helper existed (oldest last).
export const LEGACY_EVIDENCE_VERSIONS = Object.freeze(['1.1.0']);

export function productionVersion(root = ROOT) {
  const manifest = JSON.parse(readFileSync(join(root, 'apps/production-extension/manifest.json'), 'utf8'));
  if (typeof manifest.version !== 'string' || !/^\d+(?:\.\d+){1,3}$/u.test(manifest.version)) throw new Error('production manifest version is missing or invalid');
  return manifest.version;
}

export function evidenceRoot(version = productionVersion()) { return join(ROOT, 'test-results', 'production-' + version); }

// Relative, forward or back slashes, no empty, '.' or '..' segment: an evidence path can never leave its folder.
function segments(path) {
  if (typeof path !== 'string' || path === '' || isAbsolute(path)) throw new Error('evidence path must be relative: ' + String(path));
  const parts = path.split(/[\\/]/u);
  if (parts.some(part => part === '' || part === '.' || part === '..')) throw new Error('evidence path must stay inside the evidence folder: ' + path);
  return parts;
}

export function evidencePath(path, version = productionVersion()) { return join(evidenceRoot(version), ...segments(path)); }

export function evidenceDirectory(path) {
  const directory = path === undefined ? evidenceRoot() : evidencePath(path);
  mkdirSync(directory, { recursive: true });
  return directory;
}

// JSON data is written pretty-printed with a final newline; strings and Buffers are written as they are.
export function writeEvidence(path, data) {
  const target = evidencePath(path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data, null, 2) + '\n');
  return target;
}

// The newest existing copy: the current version folder first, then the legacy folders.
export function findEvidence(path) {
  for (const [version, legacy] of [[productionVersion(), false], ...LEGACY_EVIDENCE_VERSIONS.map(version => [version, true])]) {
    const candidate = evidencePath(path, version);
    if (existsSync(candidate)) return { path: candidate, version, legacy };
  }
  return null;
}

export function readEvidence(path) {
  const found = findEvidence(path);
  return found ? { ...found, value: JSON.parse(readFileSync(found.path, 'utf8')) } : null;
}

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const fileHashes = (directory, files) => Object.fromEntries(files.map(file => [file, sha256(readFileSync(join(directory, file)))]));

// ---- package staging ---------------------------------------------------------------------------------------------
// `dist`   copies dist/<browser> (what the lead's build produced and what ships);
// `source` assembles the same package from apps/production-extension WITHOUT regenerating locales (only the proxy
//          agent regenerates _locales). It mirrors buildProduction in scripts/build-production.mjs: file selection,
//          origin rewrites, Firefox protect stubs and adapter wrapping, and the generated manifest.
//          scripts/test/native-suites.test.mjs fails when those anchors change in build-production.mjs.
export const ADAPTER_WRAPPED = Object.freeze(['background.js', 'bridge.js', 'api-custom-relay.js', 'api-custom-media-relay.js', 'popup.js', 'sidepanel.js', 'options.js', 'report.js']);
export const BRIDGE_CONTEXT = Object.freeze(['bridge.js', 'api-custom-relay.js', 'api-custom-media-relay.js']);
export const BACKGROUND_ORIGIN = Object.freeze({ from: 'return "chrome-extension://" + runtimeId;', to: 'return chrome.runtime.getURL("").replace(/\\/$/, "");' });
export const BRIDGE_ORIGIN = Object.freeze({ from: 'let own3 = "chrome-extension://" + id;', to: 'let own3 = chrome.runtime.getURL("").replace(/\\/$/, "");' });

export async function assembleExtension(browser, target) {
  assert.ok(browser === 'chrome' || browser === 'firefox', 'browser must be chrome or firefox');
  const { productionManifest } = await import('../build-production.mjs');
  const { PROTECT_CHROME_ONLY, PROTECT_FIREFOX_STUBS } = await import('../production/protect-files.mjs');
  const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version, adapter = readFileSync(join(PRODUCTION_SOURCE, 'browser-adapter.js'), 'utf8');
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(PRODUCTION_SOURCE).sort()) {
    if (['manifest.json', 'browser-adapter.js', 'PROVENANCE.json'].includes(entry) || entry.endsWith('.md')) continue;
    if (browser === 'firefox' && PROTECT_CHROME_ONLY.includes(entry)) continue;
    if (browser === 'firefox' && Object.hasOwn(PROTECT_FIREFOX_STUBS, entry)) { cpSync(join(ROOT, PROTECT_FIREFOX_STUBS[entry]), join(target, entry)); continue; }
    cpSync(join(PRODUCTION_SOURCE, entry), join(target, entry), { recursive: true });
    if (!entry.endsWith('.js')) continue;
    let code = readFileSync(join(PRODUCTION_SOURCE, entry), 'utf8');
    if (entry === 'background.js') {
      assert.ok(code.includes(BACKGROUND_ORIGIN.from) || code.includes('chrome.runtime.getURL("").replace'), 'missing background origin boundary');
      code = code.replace(BACKGROUND_ORIGIN.from, BACKGROUND_ORIGIN.to);
    }
    if (entry === 'bridge.js') code = code.replace(BRIDGE_ORIGIN.from, BRIDGE_ORIGIN.to);
    if (browser === 'firefox' && ADAPTER_WRAPPED.includes(entry)) {
      const context = entry === 'background.js' ? 'background' : BRIDGE_CONTEXT.includes(entry) ? 'bridge' : 'ui';
      code = adapter + '\nvar chrome = createFirefoxAdapter(globalThis.browser, ' + JSON.stringify(context) + ');\n' + code;
    }
    writeFileSync(join(target, entry), code, 'utf8');
  }
  writeFileSync(join(target, 'manifest.json'), JSON.stringify(productionManifest(browser, version), null, 2) + '\n');
  return target;
}

export async function stageExtension({ browser, target, from = 'dist' }) {
  if (from === 'source') return { directory: await assembleExtension(browser, target), packaging: 'assembled from apps/production-extension' };
  assert.equal(from, 'dist', 'from must be dist or source');
  const directory = join(ROOT, 'dist', browser);
  assert.ok(existsSync(join(directory, 'manifest.json')), 'dist/' + browser + ' is missing: the lead builds it (node scripts/build-production.mjs --browser all)');
  cpSync(directory, target, { recursive: true });
  return { directory: target, packaging: 'dist/' + browser };
}

// Files whose packaged bytes must equal the source (Firefox options.js carries the adapter in front of the exact source).
export function sourceMismatches(directory, files, browser) {
  const stale = [];
  for (const file of files) {
    const packaged = readFileSync(join(directory, file)), source = readFileSync(join(PRODUCTION_SOURCE, file));
    const same = browser === 'firefox' && ADAPTER_WRAPPED.includes(file) ? packaged.toString('utf8').endsWith(source.toString('utf8')) : file === 'background.js' || file === 'bridge.js' ? true : packaged.equals(source);
    if (!same) stale.push(file);
  }
  return stale;
}
