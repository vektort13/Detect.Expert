import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, extensionIdOf, getServiceWorker, repoRoot, test } from './harness';

const EXPECTED_PERMISSIONS = ['activeTab', 'scripting', 'storage', 'webRequest', 'webNavigation', 'sidePanel'];

/** chrome.i18n follows the browser UI locale, not default_locale: accept the ru or en message for a key. */
function localized(key: string): RegExp {
  const variants = ['ru', 'en'].map((locale) => {
    const table = JSON.parse(readFileSync(path.join(repoRoot, 'apps', 'extension', '_locales', locale, 'messages.json'), 'utf8')) as Record<string, { message: string }>;
    const message = table[key]?.message;
    if (typeof message !== 'string') throw new Error('missing locale key ' + key + ' in ' + locale);
    return message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  return new RegExp('^(' + variants.join('|') + ')$');
}

test('extension loads and the service worker answers stub messages', async ({ ext, fixtures }) => {
  const sw = await getServiceWorker(ext.context);
  const id = extensionIdOf(sw);
  expect(id).toMatch(/^[a-p]{32}$/);

  const manifest = await sw.evaluate(() => chrome.runtime.getManifest());
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.permissions).toEqual(EXPECTED_PERMISSIONS);
  expect(manifest.host_permissions).toEqual(['http://127.0.0.1/*']);
  expect(manifest.optional_host_permissions).toEqual(['http://*/*', 'https://*/*']);
  expect(manifest.incognito).toBe('not_allowed');
  expect(manifest.content_scripts).toBeUndefined();

  // Privileged UI channel: a page of this extension asks the SW.
  const page = await ext.context.newPage();
  await page.goto('chrome-extension://' + id + '/popup.html');
  await expect(page.locator('.app__title')).toHaveText(localized('popupTitle'));

  // Test profile only: the static loopback grant is an explicit `site 127.0.0.1` scope, never an implicit
  // "off but observing" state (F001/F002, ADR-003 §3). The release profile starts with `off` (no grant at all).
  const scope = await page.evaluate(() => chrome.runtime.sendMessage({ schemaVersion: 1, type: 'ui-get-scope' }));
  expect(scope).toEqual({
    schemaVersion: 1,
    type: 'scope',
    scope: { scopeMode: 'site', hosts: ['127.0.0.1'], grantedAllSites: false, managed: false },
  });

  const report = await page.evaluate(() => chrome.runtime.sendMessage({ schemaVersion: 1, type: 'ui-get-report', tabId: 1 }));
  expect(report).toEqual({ schemaVersion: 1, type: 'report', report: null });

  const invalid = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'ui-clear' }));
  expect(invalid).toEqual({ schemaVersion: 1, type: 'error', code: 'invalid-request' });

  // all-sites needs a granted optional host permission (ADR-003 §1); the SW answers no-access without one.
  const notImplemented = await page.evaluate(() =>
    chrome.runtime.sendMessage({ schemaVersion: 1, type: 'ui-set-scope', scopeMode: 'all-sites' }),
  );
  expect(notImplemented).toEqual({ schemaVersion: 1, type: 'error', code: 'no-access' });

  // Popup rendered the scope label from the SW answer (browser UI locale: ru or en).
  await expect(page.locator('.value')).toHaveText(localized('scopeSite'));

  // Fixture servers are reachable on two distinct loopback origins.
  const fixturePage = await ext.context.newPage();
  for (const origin of fixtures.origins) {
    const response = await fixturePage.goto(origin + '/index.html');
    expect(response?.status()).toBe(200);
    await expect(fixturePage).toHaveTitle('detect.expert fixture');
  }
});
