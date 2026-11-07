import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { productionManifest, validateProductionManifest } from '../build-production.mjs';
import { BROWSER_DEBUG_CHROME_OPTIONAL, BROWSER_DEBUG_FIREFOX_OPTIONAL } from '../../apps/production-extension/browser-debug-shared.js';
const optional = browser => browser === 'firefox' ? [...BROWSER_DEBUG_FIREFOX_OPTIONAL, 'userScripts', 'nativeMessaging', 'clipboardWrite', 'notifications'] : [...BROWSER_DEBUG_CHROME_OPTIONAL, 'nativeMessaging', 'clipboardWrite', 'notifications'];

test('unified manifest: each browser retains host/CSP/optional-cookie boundaries', () => {
  for (const browser of ['chrome', 'firefox']) {
    const manifest = productionManifest(browser, '1.1.0'); assert.deepEqual(validateProductionManifest(manifest, browser), []);
    assert.equal(manifest.permissions.includes('debugger'), browser === 'chrome'); assert.deepEqual(manifest.optional_permissions, optional(browser));
    assert.equal(manifest.permissions.includes('privacy'), false, 'ADR-060 native policy remains an optional user grant');
    assert.equal(manifest.optional_host_permissions.length, 0); assert.equal(manifest.content_security_policy.extension_pages.includes('connect-src https://api.cloudflare.com '), true);
  }
});
test('ADR-075: unified Chrome grants debugger once for the built-in Autosurfer', () => {
  // The source manifest carries the release version from package.json.
  const manifest = productionManifest('chrome', JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version); assert.deepEqual(validateProductionManifest(manifest, 'chrome'), []);
  assert.equal(manifest.minimum_chrome_version, '153'); assert.equal(manifest.permissions.filter(permission => permission === 'debugger').length, 1);
  assert.deepEqual(manifest.optional_permissions, optional('chrome')); assert.equal(manifest.background.service_worker, 'background.js');
  assert.deepEqual(manifest, JSON.parse(readFileSync(new URL('../../apps/production-extension/manifest.json', import.meta.url), 'utf8')));
});
for (const minimum of [undefined, '119', '152', '154']) test('production manifest: validator rejects changed browser minimum ' + minimum, () => {
  const manifest = productionManifest('chrome', '1.1.0');
  if (minimum === undefined) delete manifest.minimum_chrome_version; else manifest.minimum_chrome_version = minimum;
  assert.ok(validateProductionManifest(manifest, 'chrome').length > 0);
});
test('production manifest: broader host access or remote connections cannot slip into production packaging', () => {
  for (const change of ['host', 'optional-host', 'connect', 'external', 'oauth']) {
    const manifest = productionManifest('chrome', '1.1.0');
    if (change === 'host') manifest.host_permissions.push('<all_urls>');
    if (change === 'optional-host') manifest.optional_host_permissions.push('https://*/*');
    if (change === 'connect') manifest.content_security_policy.extension_pages = "script-src 'self'; connect-src https://remote.example";
    if (change === 'external') manifest.externally_connectable = { matches: ['https://*/*'] };
    if (change === 'oauth') manifest.oauth2 = { client_id: 'unreviewed', scopes: [] };
    assert.ok(validateProductionManifest(manifest, 'chrome').length > 0, change);
  }
});
test('Firefox construction cannot mutate a subsequent Chrome build', () => {
  const before = productionManifest('chrome', '1.1.0'); productionManifest('firefox', '1.1.0');
  assert.deepEqual(productionManifest('chrome', '1.1.0'), before);
});

test('managed disable-only policy is declared in Chrome, typed as boolean and omitted from Firefox', () => {
  const chrome = productionManifest('chrome', '1.1.0'), firefox = productionManifest('firefox', '1.1.0');
  const schema = JSON.parse(readFileSync(new URL('../../apps/production-protect/src/' + chrome.storage.managed_schema, import.meta.url), 'utf8'));
  assert.equal(schema.type, 'object'); assert.equal(Object.hasOwn(schema, 'additionalProperties'), false, 'Chrome top-level schema requirement');
  assert.deepEqual(Object.keys(schema.properties), ['ProtectModuleDisabled']);
  assert.equal(schema.properties.ProtectModuleDisabled.type, 'boolean');
  assert.equal(Object.hasOwn(schema.properties.ProtectModuleDisabled, 'default'), false, 'policy cannot silently activate the module');
  assert.equal(firefox.storage, undefined);
  for (const storage of [undefined, { managed_schema: '../unsafe.json' }, { managed_schema: 'protect-managed-schema.json', extra: true }]) {
    assert.ok(validateProductionManifest({ ...chrome, storage }, 'chrome').length > 0);
  }
  assert.ok(validateProductionManifest({ ...firefox, storage: chrome.storage }, 'firefox').length > 0);
});

test('retired chrome-dbsc target and package command cannot create a third delivery variant', () => {
  assert.throws(() => productionManifest('chrome-dbsc', '1.1.0'), /unknown browser/);
  assert.ok(validateProductionManifest(productionManifest('chrome', '1.1.0'), 'chrome-dbsc').length > 0);
  const root = new URL('../../', import.meta.url);
  const commands = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')).scripts;
  assert.equal(commands['build:chrome:dbsc'], undefined);
  const result = spawnSync(process.execPath, ['scripts/build-production.mjs', '--browser', 'chrome-dbsc'], { cwd: root, encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /chrome\|firefox\|all expected/);
});

for (const browser of ['chrome', 'firefox']) for (const field of ['permissions', 'optional_permissions']) test(browser + ' rejects additional debugger in ' + field, () => {
  const manifest = productionManifest(browser, '1.1.0'); manifest[field].push('debugger');
  assert.ok(validateProductionManifest(manifest, browser).length > 0);
});

// ADR-047 (owner decision Q1, 2026-10-18): the module «Защита» needs declarativeNetRequestWithHostAccess as a required
// Chrome permission; never the broad blocking/feedback variants or static rulesets; Firefox ships no module permission.
test('ADR-047: required DNR with host access in Chrome only; other DNR forms are rejected', () => {
  const chrome = productionManifest('chrome', '1.1.0'), firefox = productionManifest('firefox', '1.1.0');
  assert.equal(chrome.permissions.filter(permission => permission === 'declarativeNetRequestWithHostAccess').length, 1);
  assert.equal(firefox.permissions.includes('declarativeNetRequestWithHostAccess'), false);
  assert.deepEqual(chrome.optional_permissions, optional('chrome')); assert.deepEqual(firefox.optional_permissions, optional('firefox'));
  const without = productionManifest('chrome', '1.1.0'); without.permissions = without.permissions.filter(permission => permission !== 'declarativeNetRequestWithHostAccess');
  assert.ok(validateProductionManifest(without, 'chrome').length > 0, 'Chrome without the module permission');
  const leaked = productionManifest('firefox', '1.1.0'); leaked.permissions.push('declarativeNetRequestWithHostAccess');
  assert.ok(validateProductionManifest(leaked, 'firefox').length > 0, 'Firefox with the module permission');
  for (const browser of ['chrome', 'firefox']) for (const field of ['permissions', 'optional_permissions']) for (const permission of ['declarativeNetRequest', 'declarativeNetRequestFeedback', 'declarativeNetRequestWithHostAccess']) {
    if (browser === 'chrome' && field === 'permissions' && permission === 'declarativeNetRequestWithHostAccess') continue;
    const manifest = productionManifest(browser, '1.1.0'); manifest[field].push(permission);
    assert.ok(validateProductionManifest(manifest, browser).length > 0, browser + ' ' + field + ' ' + permission);
  }
  const rulesets = productionManifest('chrome', '1.1.0'); rulesets.declarative_net_request = { rule_resources: [] };
  assert.ok(validateProductionManifest(rulesets, 'chrome').length > 0, 'static rulesets');
});
test('ADR-109: connect-src is exactly Cloudflare plus the geolocation catalogue hosts, in order, and nothing else may be added or dropped', async () => {
  const { geoConnectOrigins } = await import('../../apps/production-extension/proxy-geo-shared.js');
  const expected = ['https://api.cloudflare.com', ...geoConnectOrigins()];
  for (const browser of ['chrome', 'firefox']) {
    const manifest = productionManifest(browser, '1.1.0');
    const connect = /connect-src ([^;]+);/.exec(manifest.content_security_policy.extension_pages)[1].split(' ');
    assert.deepEqual(connect, expected);
    assert.equal(connect.filter(origin => origin.startsWith('http://')).join(), 'http://ip-api.com', 'only the free ip-api endpoint is plain HTTP');
    for (const change of ['extra', 'drop', 'wildcard', 'swap']) {
      const changed = productionManifest(browser, '1.1.0');
      const policy = changed.content_security_policy.extension_pages;
      if (change === 'extra') changed.content_security_policy.extension_pages = policy.replace('; base-uri', ' https://remote.example; base-uri');
      if (change === 'drop') changed.content_security_policy.extension_pages = policy.replace(' https://api.ipdata.co', '');
      if (change === 'wildcard') changed.content_security_policy.extension_pages = policy.replace('https://api.ipdata.co', 'https://*.ipdata.co');
      if (change === 'swap') changed.content_security_policy.extension_pages = policy.replace('http://ip-api.com', 'https://ip-api.com');
      assert.ok(validateProductionManifest(changed, browser).includes('unexpected CSP'), browser + ' ' + change);
    }
    assert.equal(manifest.optional_host_permissions.length, 0, 'no optional host permission is added');
  }
});
