// ADR-047 (S2, port plan §2.7): the module «Защита» is Chrome-only. Firefox gets three inert stubs (same export
// names) and none of the other module files; its manifest has no module permission.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { productionManifest, validateProductionManifest, verifyProtectDelivery } from '../../build-production.mjs';
import { PROTECT_CHROME_ONLY, PROTECT_CHROME_REQUIRED_PERMISSIONS, PROTECT_FIREFOX_STUBS, PROTECT_OUTPUTS } from '../protect-files.mjs';

const root = resolve(import.meta.dirname, '../../..');
const ext = join(root, 'apps/production-extension');

function exportNames(file) {
  const code = readFileSync(file, 'utf8');
  return code.slice(code.lastIndexOf('export {')).match(/\{([^}]*)\}/)[1].split(',').map((s) => s.trim().split(/\s+as\s+/).at(-1)).filter(Boolean).sort();
}

test('stubs cover exactly the three non-optional module files and export the same names as the real bundles', async () => {
  assert.deepEqual(Object.keys(PROTECT_FIREFOX_STUBS).sort(), ['protect-sw.js', 'protect-ui.js', 'protect.css']);
  assert.deepEqual([...PROTECT_CHROME_ONLY, ...Object.keys(PROTECT_FIREFOX_STUBS)].sort(), [...PROTECT_OUTPUTS].sort());
  for (const name of ['protect-sw.js', 'protect-ui.js']) {
    const stub = await import(pathToFileURL(join(root, PROTECT_FIREFOX_STUBS[name])).href);
    assert.deepEqual(Object.keys(stub).sort(), exportNames(join(ext, name)), name + ': export names drift');
  }
  const ui = await import(pathToFileURL(join(root, PROTECT_FIREFOX_STUBS['protect-ui.js'])).href);
  const host = ui.createProtectHostUi({});
  assert.equal(host.ProtectIsland({ surface: 'popup' }), null);
  assert.equal(host.ProtectPage(), null);
  assert.equal(host.isProtectHash('#protect'), false);
  assert.equal(await ui.mountRequestsPage(null), undefined);
  assert.doesNotMatch(readFileSync(join(root, PROTECT_FIREFOX_STUBS['protect.css']), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''), /\S/, 'protect.css stub has no rules');
  for (const stub of Object.values(PROTECT_FIREFOX_STUBS)) {
    const code = readFileSync(join(root, stub), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    assert.doesNotMatch(code, /\bchrome\.|\bbrowser\.|addListener|\bimport\b/, stub + ' is inert');
  }
});

test('manifests: Chrome requires declarativeNetRequestWithHostAccess (owner Q1), Firefox has no module permission', () => {
  const chrome = productionManifest('chrome', '1.1.0'), firefox = productionManifest('firefox', '1.1.0');
  for (const permission of PROTECT_CHROME_REQUIRED_PERMISSIONS) {
    assert.ok(chrome.permissions.includes(permission), permission);
    assert.equal(chrome.optional_permissions.includes(permission), false);
    assert.equal(firefox.permissions.includes(permission), false);
    assert.equal(firefox.optional_permissions.includes(permission), false);
  }
  assert.deepEqual(validateProductionManifest(chrome, 'chrome'), []);
  assert.deepEqual(validateProductionManifest(firefox, 'firefox'), []);
});

test('delivery check: Chrome must carry every module file; Firefox only the stubs, byte for byte', (t) => {
  mkdirSync(join(root, '.tmp'), { recursive: true });
  const dir = mkdtempSync(join(root, '.tmp', 'protect-delivery-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const chrome = join(dir, 'chrome'), firefox = join(dir, 'firefox');
  mkdirSync(chrome); mkdirSync(firefox);
  for (const name of PROTECT_OUTPUTS) writeFileSync(join(chrome, name), 'x');
  assert.doesNotThrow(() => verifyProtectDelivery(chrome, 'chrome'));
  rmSync(join(chrome, 'protect.main.js'));
  assert.throws(() => verifyProtectDelivery(chrome, 'chrome'), /missing module file protect\.main\.js/);
  for (const [name, stub] of Object.entries(PROTECT_FIREFOX_STUBS)) cpSync(join(root, stub), join(firefox, name));
  assert.doesNotThrow(() => verifyProtectDelivery(firefox, 'firefox'));
  writeFileSync(join(firefox, 'gpc.main.js'), 'x');
  assert.throws(() => verifyProtectDelivery(firefox, 'firefox'), /Chrome-only module file in Firefox: gpc\.main\.js/);
  rmSync(join(firefox, 'gpc.main.js'));
  writeFileSync(join(firefox, 'protect-sw.js'), readFileSync(join(ext, 'protect-sw.js')));
  assert.throws(() => verifyProtectDelivery(firefox, 'firefox'), /Firefox stub expected for protect-sw\.js/);
});
