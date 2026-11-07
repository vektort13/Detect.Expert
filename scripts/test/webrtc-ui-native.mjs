// E22-08: delivered Chrome UI, old JSON migration and actual browser privacy controls in disposable profiles.
// ADR-104: the Antidetect master switch persists by itself; the network save bar only saves the policy draft.
// node scripts/test/webrtc-ui-native.mjs [--from-source]   (--from-source: assemble the package instead of copying dist/chrome)
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { API_CONFIG_CATALOG, API_CONFIG_CATALOG_V2, API_CONFIGURATION_CATALOG_VERSION, API_CONFIGURATION_VERSION, importApiConfiguration } from '../../packages/contracts/src/api-configuration.mjs';
import { evidenceDirectory, stageExtension, writeEvidence } from './native-evidence.mjs';
import { enableChromeUserScripts } from './api-custom-early-native.mjs';
import { WEBRTC_UI_MESSAGES } from '../production-locales-webrtc.mjs';

const root = resolve(import.meta.dirname, '../..'); mkdirSync(join(root, '.tmp'), { recursive: true });
const run = mkdtempSync(join(root, '.tmp/webrtc-ui-native-')), frozen = join(run, 'frozen'), fromSource = process.argv.includes('--from-source');
const staged = await stageExtension({ browser: 'chrome', target: frozen, from: fromSource ? 'source' : 'dist' });
const artifact = evidenceDirectory('webrtc-ui');
const evidence = { at: new Date().toISOString(), run, packaging: staged.packaging, result: 'RUNNING', checks: [], layouts: [], nativePolicies: [], errors: [], externalRequests: [], fixturePermissions: null,
  hashes: Object.fromEntries(['manifest.json', 'api-configuration-ui.js', 'webrtc-configuration-ui.js', 'webrtc-configuration-ui.css', 'api-configuration-controller.js'].map(file => [file, createHash('sha256').update(readFileSync(join(frozen, file))).digest('hex')])) };
let context, page, phase = 'startup';
const send = message => page.evaluate(message => chrome.runtime.sendMessage({ schemaVersion: 1, ...message }), message);
const state = () => send({ type: 'ui-api-config-get', tabId: null });
const ready = async () => { await page.locator('[data-api-configuration-editor][aria-busy="false"]').waitFor(); await page.locator('[data-webrtc-row-configure]').waitFor(); };
const networkReady = async () => { await page.locator('[data-antidetect-app][aria-busy="false"]').waitFor(); await page.locator('[data-antidetect-category="network"]').click(); await page.locator('[data-antidetect-network-policy]').waitFor(); };
const navigate = async section => { const target = new URL(page.url()); target.hash = section; await page.goto(target.href); await (section === 'antidetect' ? networkReady() : ready()); };
const check = text => { console.log('  ok ' + text); evidence.checks.push(text); };
async function launch(extension, profile) {
  context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, viewport: { width: 1100, height: 950 }, args: ['--load-extension=' + extension, '--disable-extensions-except=' + extension] });
  evidence.browser = context.browser().version(); await context.route('**/*', route => { if (/^https?:/.test(route.request().url())) { evidence.externalRequests.push(new URL(route.request().url()).origin); return route.abort(); } return route.continue(); });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'); page = await context.newPage(); page.on('pageerror', error => evidence.errors.push({ phase, error: error.message }));
  await page.goto(new URL('options.html#api', worker.url()).href); await send({ type: 'ui-data-consent-set', version: 1, accepted: true }); await ready();
  await page.evaluate(() => chrome.storage.local.set({ 'ui-language-v1': 'en' })); await page.reload(); await ready(); return new URL(worker.url()).host;
}
async function waitRevision(revision) { await page.waitForFunction(async revision => (await chrome.runtime.sendMessage({ schemaVersion: 1, type: 'ui-api-config-get', tabId: null })).revision > revision, revision); await (new URL(page.url()).hash === '#antidetect' ? networkReady() : ready()); return state(); }
async function nativePolicy() { return page.evaluate(() => chrome.privacy.network.webRTCIPHandlingPolicy.get({})); }
async function savePolicy(value) { const before = await state(); await page.locator('[data-antidetect-network-policy]').selectOption(value); await page.locator('[data-antidetect-save]').click(); return waitRevision(before.revision); }

try {
  const production = JSON.parse(readFileSync(join(frozen, 'manifest.json'))); assert.ok(production.optional_permissions.includes('privacy')); assert.ok(!production.permissions.includes('privacy'));
  phase = 'optional permission absent'; await launch(frozen, join(run, 'optional-profile')); const initial = await state(); assert.equal(initial.configuration.enabled, false);
  assert.equal(await page.evaluate(() => chrome.permissions.contains({ permissions: ['privacy'] })), false);
  phase = 'direct WebRTC entry without Custom'; assert.equal(initial.configuration.apis.find(row => row.id === 'webrtc').mode, 'bypass');
  assert.equal(await page.locator('[data-webrtc-row-configure]').isVisible(), true);
  await page.evaluate(() => { window.__rtcUiWrites = []; chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local') window.__rtcUiWrites.push(Object.keys(changes)); }); });
  await page.locator('[data-webrtc-row-configure]').click(); await page.locator('[data-webrtc-profile-fields]').waitFor();
  assert.deepEqual(await page.locator('[data-webrtc-profile-fields] input[type="checkbox"]').evaluateAll(elements => elements.map(element => element.dataset.webrtcField).sort()), ['addresses', 'certificates', 'devices', 'ipv4-mdns', 'ipv6-mdns']); // catalog 8: mDNS host per family
  for (const kind of ['addresses', 'devices', 'certificates']) assert.equal(await page.locator('[data-webrtc-field="' + kind + '"]').isVisible(), true);
  await page.locator('[data-api-value-name]').fill('Discarded WebRTC draft'); await page.locator('[data-webrtc-field="devices"]').check(); await page.locator('[data-webrtc-field="certificates"]').check();
  await page.locator('.api-config-modal .api-config-actions button:not([data-api-value-save])').click(); await page.locator('[data-webrtc-profile-fields]').waitFor({ state: 'detached' });
  const cancelled = await state(); assert.equal(cancelled.revision, initial.revision); assert.deepEqual(cancelled.configuration, initial.configuration); assert.deepEqual(await page.evaluate(() => window.__rtcUiWrites), []);
  check('master OFF and WebRTC Bypass expose the current row Configure and all three typed controls; cancelling a changed draft writes no storage or configuration');
  phase = 'optional permission absent';
  await navigate('antidetect'); const dormant = await savePolicy('disable_non_proxied_udp');
  assert.equal(dormant.configuration.enabled, false); assert.equal(dormant.configuration.antidetectEnabled, false); assert.equal(dormant.webrtcNetwork.status, 'inactive');
  assert.equal(await page.evaluate(() => chrome.permissions.contains({ permissions: ['privacy'] })), false);
  await page.locator('[data-antidetect-master]').click();
  await page.locator('[data-antidetect-error][role="alert"]').waitFor(); const denied = await state(); assert.equal(denied.revision, dormant.revision); assert.deepEqual(denied.configuration, dormant.configuration);
  evidence.absentPermission = { permissionGranted: false, status: denied.webrtcNetwork.status, unchanged: true }; await context.close(); context = null;
  check('optional privacy starts absent; Antidetect OFF retains a dormant policy, while enabling it without permission is rejected without changing configuration (not a simulated human Deny)');

  const extension = join(run, 'required-privacy-fixture'); cpSync(frozen, extension, { recursive: true }); const fixtureManifest = structuredClone(production);
  fixtureManifest.optional_permissions = fixtureManifest.optional_permissions.filter(permission => permission !== 'privacy'); fixtureManifest.permissions.push('privacy'); writeFileSync(join(extension, 'manifest.json'), JSON.stringify(fixtureManifest, null, 2));
  evidence.fixturePermissions = { productionPrivacy: 'optional', testCopyPrivacy: 'required', purpose: 'Exercise actual get/set/clear without an automated native permission dialog; no production manifest is changed' };
  phase = 'native browser policy'; const id = await launch(extension, join(run, 'required-profile')); const baseline = await nativePolicy();
  await navigate('antidetect'); const offPolicy = await savePolicy('disable_non_proxied_udp'); assert.equal(offPolicy.webrtcNetwork.status, 'inactive'); assert.equal((await nativePolicy()).value, baseline.value);
  await page.locator('[data-antidetect-master]').click(); await waitRevision(offPolicy.revision);
  for (const policy of ['default_public_interface_only', 'disable_non_proxied_udp']) { const saved = await savePolicy(policy), actual = await nativePolicy(); assert.equal(saved.configuration.enabled, false); assert.equal(saved.configuration.antidetectEnabled, true); assert.equal(saved.webrtcNetwork.status, 'applied'); assert.equal(actual.value, policy); assert.equal(actual.levelOfControl, 'controlled_by_this_extension'); evidence.nativePolicies.push({ desired: policy, state: saved.webrtcNetwork, actual, apiMaster: saved.configuration.enabled }); }
  const cleared = await savePolicy('system'), actual = await nativePolicy(); assert.equal(actual.value, baseline.value); assert.notEqual(actual.levelOfControl, 'controlled_by_this_extension'); assert.equal(cleared.configuration.enabled, false);
  evidence.nativePolicies.push({ desired: 'system', state: cleared.webrtcNetwork, actual, baseline }); check('actual Chrome privacy policy get/set/clear/readback works independently of the OFF API master and restores the original browser policy');

  phase = 'legacy JSON migration'; await navigate('api'); const legacy = { format: 'detect.expert/api-configuration', formatVersion: 1, catalogVersion: 2, enabled: false, preset: 'limited', apis: API_CONFIG_CATALOG_V2.map(item => ({ ...structuredClone(item), mode: 'bypass', userValues: [], selected: { kind: 'unset' }, settings: {} })), sites: [] };
  await page.locator('[data-api-config-file]').setInputFiles({ name: 'owned-old-api-config.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacy)) }); await page.locator('[data-api-config-apply="import"]').waitFor();
  const beforeImport = await state(); await page.locator('[data-api-config-apply="import"]').click(); const imported = await waitRevision(beforeImport.revision);
  assert.equal(imported.configuration.formatVersion, API_CONFIGURATION_VERSION); assert.equal(imported.configuration.catalogVersion, API_CONFIGURATION_CATALOG_VERSION); assert.equal(imported.configuration.apis.length, API_CONFIG_CATALOG.length); assert.equal(imported.configuration.webrtcNetworkPolicy, 'system'); assert.equal(imported.configuration.antidetectEnabled, false);
  check('a real format1/catalog2 file imports through preview as format' + API_CONFIGURATION_VERSION + '/catalog' + API_CONFIGURATION_CATALOG_VERSION + ' with all ' + API_CONFIG_CATALOG.length + ' rows and the default independent network policy');

  phase = 'typed profile'; page = await enableChromeUserScripts(context, page, id, evidence); await ready(); await page.locator('[data-protection-search]').fill('webrtc');
  const rtc = page.locator('[data-protection-feature="webrtc"]'); assert.equal((await state()).configuration.apis.find(row => row.id === 'webrtc').mode, 'bypass');
  await page.locator('[data-webrtc-row-configure]').click(); await page.locator('[data-webrtc-profile-fields]').waitFor();
  await page.locator('[data-api-value-name]').fill('Owned RTC profile'); await page.locator('[data-webrtc-field="addresses"]').check();
  const profile = { addresses: { ipv4: { host: '192.0.2.10', stun: '198.51.100.20', turn: null }, ipv6: { host: null, stun: null, turn: '2001:db8::30' } }, iceTransportPolicy: 'relay', randomizeDevices: true, freshCertificates: true, deviceLifetime: 'session' };
  for (const family of ['ipv4', 'ipv6']) for (const key of ['host', 'stun', 'turn']) await page.locator('[data-webrtc-field="' + family + ':' + key + '"]').fill(profile.addresses[family][key] ?? '');
  await page.locator('[data-webrtc-field="iceTransportPolicy"]').selectOption('relay'); await page.locator('[data-webrtc-field="devices"]').check(); await page.locator('[data-webrtc-field="certificates"]').check();
  assert.equal(await page.locator('[data-webrtc-field="deviceLifetime"]').inputValue(), 'session'); const beforeCreate = await state(); await page.locator('[data-api-value-save]').click(); const created = await waitRevision(beforeCreate.revision);
  const selected = created.configuration.apis.find(row => row.id === 'webrtc'); assert.equal(selected.mode, 'custom'); assert.deepEqual(selected.selected, { kind: 'value', value: profile }); assert.equal(selected.userValues[0].label, 'Owned RTC profile'); assert.equal(created.configuration.enabled, false);
  assert.equal(created.revision, beforeCreate.revision + 1); assert.deepEqual(selected.userValues[0].value, selected.selected);
  check('direct Configure from Bypass saves typed IPv4/IPv6, relay, device-session and per-connection DTLS fields as one reusable Custom profile while the master stays OFF');

  phase = 'saved profile reuse'; await page.reload(); await ready(); await page.locator('[data-protection-search]').fill('webrtc');
  assert.deepEqual((await state()).configuration, created.configuration);
  await rtc.locator('[data-webrtc-row-configure]').click(); await page.locator('[data-webrtc-profile-fields]').waitFor(); assert.equal(await page.locator('[data-api-value-name]').inputValue(), 'Owned RTC profile');
  for (const family of ['ipv4', 'ipv6']) for (const key of ['host', 'stun', 'turn']) { const field = page.locator('[data-webrtc-field="' + family + ':' + key + '"]'); assert.equal(await field.inputValue(), profile.addresses[family][key] ?? ''); assert.equal(await field.locator('xpath=ancestor::fieldset[@data-webrtc-family]').locator('legend').innerText(), family === 'ipv4' ? 'IPv4' : 'IPv6'); }
  await page.keyboard.press('Escape'); await page.locator('[data-webrtc-profile-fields]').waitFor({ state: 'detached' });
  await rtc.locator('.api-value-picker').click(); await page.locator('[data-api-value-list="webrtc"]').selectOption('p:' + selected.presets[0].id);
  await rtc.locator('.api-value-picker').click(); await page.locator('[data-api-value-list="webrtc"]').selectOption('u:' + selected.userValues[0].id);
  assert.equal(await page.locator('[data-protection-save]').isDisabled(), true); assert.deepEqual((await state()).configuration, created.configuration); assert.equal((await state()).revision, created.revision);
  check('the persisted profile reopens directly from its row after reload and can be selected from the saved library without duplicate records or extra writes');

  phase = 'JSON export'; await page.locator('[data-api-config-export]').click(); const downloading = page.waitForEvent('download'); await page.locator('[data-api-config-apply="export"]').click(); const download = await downloading, file = join(run, 'export.json'); await download.saveAs(file);
  const output = JSON.parse(readFileSync(file)), checked = importApiConfiguration(JSON.stringify(output)); assert.equal(checked.ok, true); assert.deepEqual(checked.value, created.configuration); assert.equal(output.formatVersion, API_CONFIGURATION_VERSION); assert.equal(output.catalogVersion, API_CONFIGURATION_CATALOG_VERSION); evidence.export = { formatVersion: output.formatVersion, catalogVersion: output.catalogVersion, rows: output.apis.length, profile: selected.selected.value };
  check('downloaded standardized JSON contains the exact current profile/library and network policy at format' + API_CONFIGURATION_VERSION + '/catalog' + API_CONFIGURATION_CATALOG_VERSION);

  for (const layout of [{ locale: 'ru', width: 1100, theme: 'light', forced: 'none' }, { locale: 'ru', width: 390, theme: 'dark', forced: 'none' }, { locale: 'ar', width: 390, theme: 'light', forced: 'active' }]) {
    phase = 'layout ' + layout.locale + '/' + layout.theme; await page.evaluate(locale => chrome.storage.local.set({ 'ui-language-v1': locale }), layout.locale);
    await navigate('antidetect'); await page.waitForFunction(label => document.querySelector('[data-antidetect-native-policy] h4')?.textContent === label, WEBRTC_UI_MESSAGES[layout.locale].protection_webrtc_network_title);
    await page.setViewportSize({ width: layout.width, height: layout.width < 500 ? 844 : 950 }); await page.emulateMedia({ colorScheme: layout.theme, forcedColors: layout.forced, reducedMotion: 'reduce' });
    await page.locator('[data-antidetect-native-policy]').screenshot({ path: join(artifact, 'webrtc-network-' + layout.locale + '-' + layout.theme + '.png') });
    await navigate('api'); await page.locator('[data-protection-search]').fill('webrtc');
    await rtc.screenshot({ path: join(artifact, 'webrtc-entry-' + layout.locale + '-' + layout.theme + '.png') });
    await rtc.locator('.api-value-action').first().click(); await page.locator('[data-webrtc-profile-fields]').waitFor();
    const facts = await page.evaluate(() => ({ dir: document.documentElement.dir, overflow: document.documentElement.scrollWidth > innerWidth + 1, fields: [...document.querySelectorAll('[data-webrtc-profile-fields] input,[data-webrtc-profile-fields] select')].map(element => ({ id: element.dataset.webrtcField, width: element.getBoundingClientRect().width, clipped: element.scrollWidth > element.clientWidth + 1, direction: getComputedStyle(element).direction })) }));
    assert.equal(facts.overflow, false); assert.equal(facts.dir, layout.locale === 'ar' ? 'rtl' : 'ltr'); for (const field of facts.fields) { assert.equal(field.clipped, false, field.id); assert.ok(field.width > 0); if (/^(ipv4|ipv6):(host|stun|turn)$/.test(field.id)) assert.equal(field.direction, 'ltr'); }
    await page.screenshot({ path: join(artifact, 'webrtc-profile-' + layout.locale + '-' + layout.theme + '.png') }); evidence.layouts.push({ ...layout, ...facts }); await page.keyboard.press('Escape'); await page.locator('[data-webrtc-profile-fields]').waitFor({ state: 'detached' });
  }
  const after = await state(); assert.equal(after.revision, created.revision); assert.deepEqual(after.configuration, created.configuration);
  check('RU desktop light, RU narrow dark and AR narrow forced-colors keep typed fields and native-policy controls unclipped; opening/cancelling edits writes nothing');
  assert.deepEqual(evidence.errors, []); assert.deepEqual(evidence.externalRequests, []); evidence.result = 'PASS'; console.log('PASS WebRTC Chrome UI: ' + evidence.checks.length + ' checks / ' + evidence.layouts.length + ' layouts');
} catch (error) { evidence.result = 'FAIL'; evidence.failure = { phase, error: String(error.stack ?? error) }; console.error(evidence.failure); process.exitCode = 1; }
finally { writeEvidence('webrtc-ui/webrtc-ui-chrome' + (fromSource ? '-from-source' : '') + '.json', evidence); await context?.close(); }
