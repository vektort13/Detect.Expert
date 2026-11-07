// Catalog 8: the mDNS (.local) Host choice in the real WebRTC editor of the production Options page (Chromium, disposable profile, no network).
// The extension is loaded straight from apps/production-extension (nothing is copied or built). Proves: both choices render with localized text,
// the host field follows the choice, Save writes the exact profile through the real validator and controller, the saved profile reopens
// checked, the typed word never switches the mode, and the editor keeps its layout in long and right-to-left locales.
//   node scripts/test/webrtc-mdns-ui-native.mjs [--screenshots <directory>]
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { WEBRTC_UI_MESSAGES } from '../production-locales-webrtc.mjs';

const root = resolve(import.meta.dirname, '../..'), extension = join(root, 'apps/production-extension');
mkdirSync(join(root, '.tmp'), { recursive: true }); const run = mkdtempSync(join(root, '.tmp/webrtc-mdns-ui-native-'));
const shots = process.argv.includes('--screenshots') ? resolve(process.argv[process.argv.indexOf('--screenshots') + 1]) : null; if (shots) mkdirSync(shots, { recursive: true });
const checks = [], errors = [], external = [];
const check = text => { checks.push(text); console.log('  ok ' + text); };
let context, page;
const send = message => page.evaluate(message => chrome.runtime.sendMessage({ schemaVersion: 1, ...message }), message);
const state = () => send({ type: 'ui-api-config-get', tabId: null });
const ready = async () => { await page.locator('[data-api-configuration-editor][aria-busy="false"]').waitFor(); await page.locator('[data-webrtc-row-configure]').waitFor(); };
async function open() { await page.locator('[data-webrtc-row-configure]').click(); await page.locator('[data-webrtc-profile-fields]').waitFor(); }
const field = key => page.locator('[data-webrtc-field="' + key + '"]');
try {
  context = await chromium.launchPersistentContext(join(run, 'profile'), { channel: 'chromium', headless: true, viewport: { width: 1100, height: 950 }, args: ['--load-extension=' + extension, '--disable-extensions-except=' + extension] });
  const version = context.browser().version();
  await context.route('**/*', route => { if (/^https?:/.test(route.request().url())) { external.push(new URL(route.request().url()).origin); return route.abort(); } return route.continue(); });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'); page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(new URL('options.html#api', worker.url()).href); await send({ type: 'ui-data-consent-set', version: 1, accepted: true }); await ready();
  await page.evaluate(() => chrome.storage.local.set({ 'ui-language-v1': 'en' })); await page.reload(); await ready();
  const english = WEBRTC_UI_MESSAGES.en;

  await open();
  for (const family of ['ipv4', 'ipv6']) {
    const box = field(family + '-mdns'); assert.equal(await box.isVisible(), true); assert.equal(await box.isChecked(), false); assert.equal(await box.isEnabled(), true);
    const group = page.locator('[data-webrtc-family="' + family + '"]');
    assert.equal(await group.locator('.webrtc-config-mdns span').innerText(), english.protection_webrtc_host_mdns);
    assert.equal(await box.getAttribute('aria-describedby'), 'webrtc-mdns-note');
  }
  // ADR-107: one shared note after both families explains the choice once; both checkboxes point at it.
  const note = page.locator('[data-webrtc-profile-fields] [data-webrtc-mdns-note]');
  assert.equal(await note.count(), 1); assert.equal(await note.getAttribute('id'), 'webrtc-mdns-note'); assert.equal(await note.isVisible(), true);
  assert.equal(await note.innerText(), english.protection_webrtc_host_mdns_note); assert.equal(await page.locator('[data-webrtc-family] [data-webrtc-mdns-note]').count(), 0);
  check('both families show the mDNS (.local) choice, unchecked by default; one visible localized note after both families explains it and both checkboxes are tied to it for assistive technology');
  if (shots) await page.screenshot({ path: join(shots, 'editor-en-default.png') });

  await field('ipv4:host').fill('192.0.2.5'); await field('ipv4-mdns').check();
  assert.equal(await field('ipv4:host').isDisabled(), true); assert.equal(await field('ipv4:host').inputValue(), ''); assert.equal(await field('ipv4:host').getAttribute('placeholder'), english.protection_webrtc_host_mdns);
  assert.equal(await field('addresses').isChecked(), true); assert.equal(await field('ipv6:host').isEnabled(), true); assert.equal(await field('ipv4:stun').isEnabled(), true);
  await field('ipv4-mdns').uncheck(); assert.equal(await field('ipv4:host').inputValue(), '192.0.2.5'); assert.equal(await field('ipv4:host').isEnabled(), true);
  await field('ipv4-mdns').check(); await field('ipv4:stun').fill('198.51.100.20'); await field('ipv6-mdns').check(); await field('ipv6:turn').fill('2001:db8::30');
  if (shots) await page.screenshot({ path: join(shots, 'editor-en-both-checked.png') });
  check('choosing mDNS disables and clears only that Host field, unchecking restores the typed literal, the other slots and the other family stay editable');

  await page.locator('[data-api-value-name]').fill('mDNS hosts'); const before = await state(); await page.locator('[data-api-value-save]').click();
  await page.waitForFunction(async revision => (await chrome.runtime.sendMessage({ schemaVersion: 1, type: 'ui-api-config-get', tabId: null })).revision > revision, before.revision); await ready();
  const saved = await state(), row = saved.configuration.apis.find(item => item.id === 'webrtc');
  assert.equal(row.mode, 'custom'); assert.deepEqual(row.selected, { kind: 'value', value: { addresses: { ipv4: { host: 'mdns', stun: '198.51.100.20', turn: null }, ipv6: { host: 'mdns', stun: null, turn: '2001:db8::30' } }, iceTransportPolicy: 'preserve', randomizeDevices: false, freshCertificates: false, deviceLifetime: 'session' } });
  assert.equal(saved.configuration.catalogVersion, 11); assert.equal(row.userValues.at(-1).label, 'mDNS hosts');
  check('Save stores the exact profile (host "mdns" in both families next to real STUN/TURN literals) through the real validator and controller at catalog 8');

  await page.reload(); await ready(); await open(); assert.equal(await page.locator('[data-api-value-name]').inputValue(), 'mDNS hosts');
  for (const family of ['ipv4', 'ipv6']) { assert.equal(await field(family + '-mdns').isChecked(), true); assert.equal(await field(family + ':host').isDisabled(), true); }
  assert.equal(await field('ipv4:stun').inputValue(), '198.51.100.20'); assert.equal(await field('ipv6:turn').inputValue(), '2001:db8::30');
  check('the saved profile reopens with both choices checked and the other fields intact');

  await field('ipv4-mdns').uncheck(); await field('ipv4:host').fill('mdns');
  assert.equal(await field('ipv4-mdns').isChecked(), false, 'typing the word never switches the mode'); assert.equal(await field('ipv4:host').isEnabled(), true);
  const revision = (await state()).revision; await page.locator('[data-api-value-save]').click();
  await page.locator('.api-config-modal [role="alert"]').first().waitFor(); assert.equal((await state()).revision, revision);
  check('the typed word "mdns" stays a rejected literal: Save shows an error and writes nothing; the checkbox is the only way to choose the mode');
  await page.keyboard.press('Escape'); await page.locator('[data-webrtc-profile-fields]').waitFor({ state: 'detached' });

  for (const locale of ['ru', 'de', 'ta', 'te', 'ar', 'ja']) {
    await page.evaluate(locale => chrome.storage.local.set({ 'ui-language-v1': locale }), locale); await page.reload(); await ready(); await open();
    const messages = WEBRTC_UI_MESSAGES[locale];
    assert.equal(await page.locator('[data-webrtc-family="ipv4"] .webrtc-config-mdns span').innerText(), messages.protection_webrtc_host_mdns, locale);
    assert.equal(await page.locator('#webrtc-mdns-note').innerText(), messages.protection_webrtc_host_mdns_note, locale); assert.equal(await page.locator('#webrtc-mdns-note').isVisible(), true, locale);
    for (const width of [1100, 390]) {
      await page.setViewportSize({ width, height: 950 });
      const overflow = await page.evaluate(() => { const modal = document.querySelector('.api-config-modal') ?? document.body; const boxes = [...modal.querySelectorAll('[data-webrtc-family] *, [data-webrtc-mdns-note]')].filter(element => { const rect = element.getBoundingClientRect(); return rect.width && rect.right > modal.getBoundingClientRect().right + 1; }); return { horizontal: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, escaping: boxes.map(element => element.tagName + '.' + element.className).slice(0, 3) }; });
      assert.deepEqual(overflow, { horizontal: false, escaping: [] }, locale + ' ' + width);
      if (shots) await page.screenshot({ path: join(shots, 'editor-' + locale + '-' + width + '.png') });
    }
    await page.setViewportSize({ width: 1100, height: 950 }); await page.keyboard.press('Escape'); await page.locator('[data-webrtc-profile-fields]').waitFor({ state: 'detached' });
  }
  check('Russian, German, Tamil, Telugu, Arabic and Japanese show their own text and the editor stays inside its box at 1100 and 390 px (Arabic right-to-left)');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log(JSON.stringify({ result: 'PASS', browser: version, checks: checks.length, screenshots: shots }));
} catch (error) { console.error(error.stack ?? error); process.exitCode = 1; }
finally { await context?.close(); }
