// ADR-107 round 5 in a real packaged Options page (Chromium and Firefox): tags and notes, the 7-day trash, temporary profiles (with the early
// registration following them, and in Chromium a REAL browser restart) and the machine-local profile-to-proxy link with "Apply with proxy".
// node scripts/test/fingerprint-identity-native.mjs [--firefox] [--from-source]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launchOwnedManagement, until, pause } from './management-browser-fixture.mjs';
import { stageExtension, writeEvidence } from './native-evidence.mjs';
import { createApiConfiguration, updateApiConfiguration, exportApiConfiguration } from '../../apps/production-extension/api-configuration.js';
import { generateConsistentDevice, snapshotFingerprintProfile, storeFingerprintProfile } from '../../apps/production-extension/fingerprint-profiles.js';

const root = resolve(import.meta.dirname, '../..'), browser = process.argv.includes('--firefox') ? 'firefox' : 'chrome', fromSource = process.argv.includes('--from-source'), LF = String.fromCharCode(10);
mkdirSync(join(root, '.tmp'), { recursive: true }); const run = mkdtempSync(join(root, '.tmp/fingerprint-identity-')), extension = join(run, 'extension');
const staged = await stageExtension({ browser, target: extension, from: fromSource ? 'source' : 'dist' });
const files = ['fingerprint-profiles.js', 'fingerprint-profiles-controller.js', 'fingerprint-profile-ui.js', 'fingerprint-library-ui.js', 'fingerprint-identity-labels.js', 'fingerprint-trash.js', 'fingerprint-temporary.js', 'identity-bundles.js', 'api-configuration-controller.js', 'options.js'];
const evidence = { browser, run, packaging: staged.packaging, at: new Date().toISOString(), result: 'RUNNING', checks: [], hashes: Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(join(extension, file))).digest('hex')])) };
// The Proxy workspace's own port client, loaded as a module script in the page's main world. Firefox's WebDriver scripts run in a sandbox
// realm whose Object.prototype differs from the page's, so a client imported there would reject every port message; the page world is what
// the shipped Options UI uses. Everything crosses the boundary as JSON text.
const bridgeSource = [
  "import { createProxyClient } from './proxy-client.js';",
  "const api = globalThis.browser ?? globalThis.chrome;",
  "async function run(text) {",
  "  const { op, input } = JSON.parse(text), client = createProxyClient(api, { env: globalThis, deadline: 20000 });",
  "  try {",
  "    if (op === 'prepare') {",
  "      const first = await client.load(); await client.saveSettings({ ...first.configuration, protectWebRTC: false, disablePrediction: false });",
  "      const saved = await client.saveProfile(input);",
  "      return JSON.stringify({ ok: true, id: saved.configuration.profiles.find(profile => profile.name === input.name).id });",
  "    }",
  "    if (op === 'status') { const snapshot = await client.load(); return JSON.stringify({ ok: true, state: snapshot.status.state, profileId: snapshot.status.profileId ?? null, autoConnect: snapshot.configuration.autoConnect }); }",
  "    if (op === 'disconnect') { await client.disconnect(); return JSON.stringify({ ok: true }); }",
  "    return JSON.stringify({ ok: false, code: 'unknown-op' });",
  "  } catch (error) { return JSON.stringify({ ok: false, code: error?.code ?? 'operation-failed' }); } finally { client.dispose(); }",
  "}",
  "globalThis.__identityBridge = { run };",
  ""
].join(String.fromCharCode(10));
writeFileSync(join(extension, 'identity-native-bridge.js'), bridgeSource); evidence.fixtureBridgeSHA256 = createHash('sha256').update(bridgeSource).digest('hex');
// An owned page that reports what a site sees at its first script.
const server = createServer((request, response) => { request.resume(); response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end('<!doctype html><script>window.__identityFirst={cpu:navigator.hardwareConcurrency,language:navigator.language,zone:Intl.DateTimeFormat().resolvedOptions().timeZone};</script><h1>Owned identity fixture</h1>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = 'http://127.0.0.1:' + server.address().port;
let opened, phase = 'startup', navigation = 0;
const check = value => { evidence.checks.push(value); console.log('  ok ' + value); };
const evaluate = (fn, value) => opened.evaluate(fn, value);
const shotDirectory = process.env.IDENTITY_SHOTS ? resolve(process.env.IDENTITY_SHOTS) : null;
const shot = async name => { if (!shotDirectory) return; mkdirSync(shotDirectory, { recursive: true }); try { await opened.screenshot(join(shotDirectory, browser + '-' + name + '.png')); } catch { /* a picture is only a diagnostic */ } };
const send = message => evaluate(message => (globalThis.browser ?? globalThis.chrome).runtime.sendMessage({ schemaVersion: 1, ...message }), message);
const state = () => send({ type: 'ui-api-config-get', tabId: null });
const row = (value, id) => value.configuration.apis.find(item => item.id === id);
const area = (name, key) => evaluate(async ({ name, key }) => (await (globalThis.browser ?? globalThis.chrome).storage[name].get(key))[key] ?? null, { name, key });
const ready = () => until(() => evaluate(() => document.querySelector('[data-profile-panel]')?.getAttribute('aria-busy') === 'false' && Boolean(document.querySelector('[data-profile-generate]')) && document.querySelector('[data-antidetect-app]')?.getAttribute('aria-busy') === 'false'), 'profile ready');
const exists = selector => evaluate(selector => Boolean(document.querySelector(selector)), selector);
const gone = (selector, label) => until(async () => !(await exists(selector)), label ?? 'gone ' + selector);
const appears = (selector, label) => until(() => exists(selector), label ?? 'appears ' + selector);
const bootBridge = () => evaluate(() => new Promise((resolve, reject) => {
  if (window.__identityBridge) { resolve(true); return; }
  const api = globalThis.browser ?? globalThis.chrome, script = document.createElement('script'); script.type = 'module'; script.src = api.runtime.getURL('identity-native-bridge.js');
  script.onload = () => resolve(true); script.onerror = () => reject(Error('identity-bridge-load')); document.head.append(script);
}));
async function proxyCommand(op, input) {
  await bootBridge();
  const result = JSON.parse(await evaluate(({ op, input }) => window.__identityBridge.run(JSON.stringify({ op, input })), { op, input: input ?? null }));
  assert.equal(result.ok, true, 'proxy ' + op + ': ' + (result.code ?? 'failed')); return result;
}
async function refresh() {
  const url = opened.base + 'options.html?identity-native=' + (++navigation) + '#antidetect';
  await opened.goto(url);
  await until(() => evaluate(url => location.href === url && document.readyState === 'complete' && document.querySelector('[data-antidetect-app]')?.getAttribute('aria-busy') === 'false' && Boolean(document.querySelector('[data-antidetect-category="quick"]')), url), 'Antidetect ready');
  await opened.click('[data-antidetect-category="quick"]'); await ready();
}
const usable = selector => evaluate(selector => { const button = document.querySelector(selector); return Boolean(button) && !button.disabled && button.getAttribute('aria-disabled') !== 'true'; }, selector);
async function press(selector) { await until(() => usable(selector), 'usable ' + selector); await opened.click(selector); await ready(); await pause(80); const error = await evaluate(() => document.querySelector('[data-profile-error]')?.textContent); assert.ok(!error, error); }
// The browser delivers a real input event for fill(); Enter is dispatched as the key event the tag field listens for.
const enter = selector => evaluate(selector => document.querySelector(selector).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })), selector);
const inRow = (id, attribute) => '[data-profile-row="' + id + '"] [data-profile-' + attribute + ']';
const select = (selector, value) => evaluate(({ selector, value }) => { const input = document.querySelector(selector); if (!input) throw Error('Missing ' + selector); input.value = value; input.dispatchEvent(new Event('change', { bubbles: true })); }, { selector, value });
const importPreview = async text => { await evaluate(text => { const input = document.querySelector('[data-profile-file]'), transfer = new DataTransfer(); transfer.items.add(new File([text], 'identity.json', { type: 'application/json' })); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true })); }, text); await ready(); };
const probe = () => evaluate(async origin => { const api = globalThis.browser ?? globalThis.chrome, url = origin + '/probe?' + Date.now(), tab = await api.tabs.create({ url, active: false }); try { for (let index = 0; index < 150; index++) { const tabState = await api.tabs.get(tab.id); if (tabState.status === 'complete' && tabState.url === url) { const result = await api.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: () => globalThis.__identityFirst ?? null }); if (result[0]?.result) return result[0].result; } await new Promise(resolve => setTimeout(resolve, 40)); } throw Error('Owned identity probe timeout'); } finally { await api.tabs.remove(tab.id); } }, origin);
const launch = async () => { const next = await launchOwnedManagement({ root, run, extension, browser, evidence, dark: false }); opened = next; return next; };
const bring = async () => { await opened.goto(opened.base + 'options.html#settings'); await until(() => evaluate(() => Boolean(document.querySelector('[data-management-shell]'))), 'shell'); };
// Seeds the library through the same revision-checked protocol the page uses, in Node with the repository modules.
const ENV = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36', uaMajor: 153, brand: 'chrome', platform: 'windows', hardwareConcurrency: 8 };
function profileRecord(label, id, cpu, rows = {}, extra = {}) {
  let config = createApiConfiguration();
  for (const [rowId, value] of Object.entries({ 'hardware-concurrency': cpu, ...rows })) config = updateApiConfiguration(config, rowId, { mode: 'custom', selected: { kind: 'value', value } }).value;
  return { ...snapshotFingerprintProfile(config, label, id), ...extra };
}
const ALPHA = 'fp-' + 'a1'.repeat(16), BETA = 'fp-' + 'b2'.repeat(16);
try {
  opened = await launch(); evidence.version = opened.version;
  await bring(); await send({ type: 'ui-data-consent-set', version: 1, accepted: true }); await send({ type: 'ui-set-scope', scopeMode: 'all-sites' }); await refresh();
  if (browser === 'firefox') { await opened.click('[data-antidetect-grant-early]'); await ready(); }
  const baseline = await probe(), initial = await state();
  const tokyo = { timezone: { timeZone: 'Asia/Tokyo', offsetMinutes: -540 }, 'navigator-language': 'ja-JP' };
  let seeded = createApiConfiguration(); seeded = storeFingerprintProfile(seeded, profileRecord('Alpha', ALPHA, 6, {}, { tags: ['seed'], note: 'seeded note' })); seeded = storeFingerprintProfile(seeded, profileRecord('Beta', BETA, 14, tokyo));
  seeded = { ...seeded, antidetectEnabled: true };
  const seededState = await send({ type: 'ui-api-config-set', expectedRevision: initial.revision, tabId: null, configuration: seeded });
  assert.equal(seededState.type, 'api-config-state', JSON.stringify(seededState).slice(0, 200)); await refresh();
  assert.equal(row(await state(), 'hardware-concurrency').mode, 'bypass', 'the applied settings are still the native ones'); assert.deepEqual((await probe()).cpu, baseline.cpu);
  check('seeded two library profiles through the revision-checked protocol; the master is on and the applied settings are native');

  phase = 'tags and notes';
  await opened.click(inRow(ALPHA, 'pick')); await appears('[data-profile-meta="' + ALPHA + '"]');
  const before = await state(); assert.equal(await usable('[data-profile-meta-save]'), false, 'nothing to save yet');
  await opened.fill('[data-profile-tag-input]', 'work,'); await opened.fill('[data-profile-tag-input]', 'Eu,'); await opened.fill('[data-profile-tag-input]', 'zed'); await enter('[data-profile-tag-input]');
  await opened.fill('[data-profile-note-input]', 'first line' + LF + 'second line');
  assert.equal((await state()).revision, before.revision, 'editing never writes'); await until(() => usable('[data-profile-meta-save]'), 'Save usable');
  await press('[data-profile-meta-save]');
  const tagged = (await state()).configuration.fingerprintProfiles.find(profile => profile.id === ALPHA);
  assert.deepEqual(tagged.tags, ['Eu', 'seed', 'work', 'zed']); assert.equal(tagged.note, 'first line' + LF + 'second line'); assert.equal((await state()).revision, before.revision + 1);
  assert.deepEqual((await state()).configuration.apis, before.configuration.apis, 'only the library changed');
  assert.equal(await evaluate(id => document.querySelectorAll('[data-profile-row="' + id + '"] [data-profile-tag]').length, ALPHA), 3, 'three chips on the row'); assert.equal(await evaluate(id => document.querySelector('[data-profile-row="' + id + '"] [data-profile-tags-more]')?.getAttribute('data-profile-tags-more'), ALPHA), '1', 'and "+1"');
  await opened.fill('[data-profile-search]', 'zed'); assert.equal(await evaluate(() => document.querySelectorAll('[data-profile-library] > [data-profile-row]').length), 1);
  await opened.fill('[data-profile-search]', 'second'); assert.equal(await evaluate(() => document.querySelectorAll('[data-profile-library] > [data-profile-row]').length), 1, 'the note is searched'); await opened.fill('[data-profile-search]', '');
  await opened.click('[data-profile-filters-toggle]'); await appears('[data-profile-filter="tag:work"]'); await opened.click('[data-profile-filter="tag:work"]');
  assert.equal(await evaluate(() => document.querySelectorAll('[data-profile-library] > [data-profile-row]').length), 1, 'the tag filter'); await opened.click('[data-profile-clear-filters]');
  const exported = await evaluate(() => { document.querySelector('[data-profile-export]').click(); return null; }); void exported; await until(() => exists('[data-profile-export-json]'), 'export text');
  const portable = JSON.parse(await evaluate(() => document.querySelector('[data-profile-export-json]').value)); assert.deepEqual(portable.fingerprintProfiles.find(profile => profile.id === ALPHA).tags, ['Eu', 'seed', 'work', 'zed']); assert.equal(portable.fingerprintProfiles.find(profile => profile.id === ALPHA).note, 'first line' + LF + 'second line');
  // An import shows tags and notes before anything is written.
  const incoming = structuredClone((await state()).configuration); incoming.fingerprintProfiles.push(profileRecord('Imported', 'fp-' + 'c3'.repeat(16), 5, {}, { tags: ['fresh'], note: 'from a file' }));
  incoming.fingerprintProfiles.sort((a, b) => a.id < b.id ? -1 : 1);
  const revision = (await state()).revision; await importPreview(exportApiConfiguration(incoming));
  await appears('[data-profile-library-changes]'); assert.equal((await state()).revision, revision, 'a preview writes nothing');
  assert.equal(await evaluate(() => document.querySelector('[data-profile-library-change="new"] [data-profile-library-change-tags] .fingerprint-tag')?.textContent), 'fresh'); assert.equal(await evaluate(() => document.querySelector('[data-profile-library-change="new"] [data-profile-library-change-note]')?.textContent), 'from a file');
  await opened.click('[data-profile-cancel]'); await gone('[data-profile-library-changes]');
  check('tags and a two-line note: typed with commas and Enter, saved with one write, three chips and "+1" on the row, searched and filtered, exported, and shown in an import preview before it is written');

  phase = 'trash';
  await refresh(); const library = (await state()).configuration.fingerprintProfiles.map(profile => profile.id); assert.deepEqual(library.sort(), [ALPHA, BETA].sort());
  await press(inRow(ALPHA, 'delete'));
  const trashed = await area('local', 'fingerprint-trash:v1'); assert.equal(trashed.version, 1); assert.equal(trashed.items.length, 1); assert.equal(trashed.items[0].profile.id, ALPHA); assert.deepEqual(trashed.items[0].profile.tags, ['Eu', 'seed', 'work', 'zed']); assert.ok(Number.isSafeInteger(trashed.items[0].deletedAt));
  assert.deepEqual((await state()).configuration.fingerprintProfiles.map(profile => profile.id), [BETA]); assert.equal(await exists('[data-profile-undo-kept]'), true, 'the Undo line says it is kept');
  await opened.click('[data-profile-trash-toggle]'); await appears('[data-profile-trash-row="' + ALPHA + '"]');
  assert.equal(await evaluate(() => document.querySelector('[data-profile-trash-row] [data-profile-trash-left]')?.getAttribute('data-profile-trash-left')), 'true'); assert.equal(await evaluate(() => document.querySelector('[data-profile-trash-row]').getAttribute('data-profile-trash-days')), '7');
  await opened.click('[data-profile-trash-restore="' + ALPHA + '"]'); await ready(); await pause(80);
  const restored = (await state()).configuration.fingerprintProfiles.find(profile => profile.id === ALPHA); assert.ok(restored, 'restored under its own id'); assert.deepEqual(restored.tags, ['Eu', 'seed', 'work', 'zed']); assert.equal(restored.note, 'first line' + LF + 'second line');
  assert.equal(await area('local', 'fingerprint-trash:v1'), null, 'the trash key is gone when the trash is empty');
  // Delete forever asks first; the trash is not part of the portable configuration.
  await opened.click('[data-profile-trash-toggle]'); await gone('[data-profile-trash]'); await press(inRow(ALPHA, 'delete')); await opened.click('[data-profile-trash-toggle]'); await appears('[data-profile-trash-row="' + ALPHA + '"]');
  await opened.click('[data-profile-trash-delete="' + ALPHA + '"]'); await appears('[data-profile-trash-confirm="one"]'); assert.equal((await area('local', 'fingerprint-trash:v1')).items.length, 1, 'asking changes nothing');
  await opened.click('[data-profile-trash-confirm-cancel]'); await gone('[data-profile-trash-confirm]'); await opened.click('[data-profile-trash-delete="' + ALPHA + '"]'); await appears('[data-profile-trash-confirm="one"]'); await opened.click('[data-profile-trash-confirm-yes]');
  await gone('[data-profile-trash-row="' + ALPHA + '"]'); assert.equal(await area('local', 'fingerprint-trash:v1'), null); assert.ok(!(await state()).configuration.fingerprintProfiles.some(profile => profile.id === ALPHA));
  // Seven days: an aged item is removed when the library opens, one in its last day says so.
  const record = trashed.items[0].profile; const now = Date.now();
  await evaluate(async ({ record, now }) => { const api = globalThis.browser ?? globalThis.chrome; const copy = (id, age) => ({ profile: { ...record, id }, deletedAt: now - age, index: 0 }); await api.storage.local.set({ 'fingerprint-trash:v1': { version: 1, items: [copy('fp-' + 'd4'.repeat(16), 7 * 86400000 + 60000), copy('fp-' + 'e5'.repeat(16), 6 * 86400000 + 43200000)] } }); }, { record, now });
  await refresh(); await opened.click('[data-profile-trash-toggle]'); await appears('[data-profile-trash]');
  assert.equal(await evaluate(() => document.querySelectorAll('[data-profile-trash-row]').length), 1, 'the expired item is gone'); assert.equal(await evaluate(() => document.querySelector('[data-profile-trash-row]').getAttribute('data-profile-trash-days')), '1');
  assert.equal((await area('local', 'fingerprint-trash:v1')).items.length, 1, 'and was removed from storage as well');
  await opened.click('[data-profile-trash-empty]'); await appears('[data-profile-trash-confirm="all"]'); await opened.click('[data-profile-trash-confirm-yes]'); await appears('[data-profile-empty="trash"]'); assert.equal(await area('local', 'fingerprint-trash:v1'), null);
  check('the trash: the copy is stored before the library changes, Restore returns the profile under its own id with tags and note, Delete forever and Empty trash ask first, an item past seven days is pruned on open and the last day is marked');

  phase = 'temporary profile';
  await refresh(); const appliedBefore = await state(), nativeProbe = await probe();
  await until(() => usable('[data-profile-temporary-new]'), 'New temporary identity usable'); await opened.click('[data-profile-temporary-new]'); await appears('[data-profile-temporary]'); await ready(); await pause(150);
  const during = await state(); assert.notDeepEqual(during.configuration.apis, appliedBefore.configuration.apis, 'the generated identity is applied'); assert.deepEqual(during.configuration.fingerprintProfiles, appliedBefore.configuration.fingerprintProfiles, 'and not added to the library');
  const temporary = await area('local', 'fingerprint-temporary:v1'); assert.deepEqual(Object.keys(temporary).sort(), ['label', 'previous', 'startedAt', 'version']); assert.ok(await area('session', 'fingerprint-temporary-live:v1'), 'the session marker is set');
  assert.deepEqual(temporary.previous.apis.map(entry => [entry.id, entry.mode]), appliedBefore.configuration.apis.map(entry => [entry.id, entry.mode]), 'the remembered rows are the applied ones before');
  const duringProbe = await probe(); assert.equal(duringProbe.cpu, row(during, 'hardware-concurrency').selected.value, 'a new document sees the temporary identity at its first script'); evidence.temporaryCpu = [nativeProbe.cpu, duringProbe.cpu];
  await opened.click('[data-profile-temporary-end]'); await gone('[data-profile-temporary]'); await ready(); await pause(150);
  assert.deepEqual((await state()).configuration.apis, appliedBefore.configuration.apis, 'End restores the remembered rows'); assert.equal(await area('local', 'fingerprint-temporary:v1'), null); assert.equal(await area('session', 'fingerprint-temporary-live:v1'), null); assert.deepEqual(await probe(), nativeProbe);
  // A library profile applied temporarily; ending returns to the original, never stacking.
  await opened.click(inRow(BETA, 'pick')); await appears('[data-profile-peek-temporary]'); await opened.click('[data-profile-peek-temporary]'); await appears('[data-profile-temporary]'); await ready(); await pause(150);
  assert.equal(row(await state(), 'hardware-concurrency').selected.value, 14); assert.equal(await exists('[data-profile-temporary-save]'), false, 'a library profile needs no Save to library'); assert.equal((await probe()).cpu, 14);
  await until(() => usable('[data-profile-temporary-new]'), 'New temporary identity usable'); await opened.click('[data-profile-temporary-new]'); await ready(); await pause(150);
  assert.deepEqual((await area('local', 'fingerprint-temporary:v1')).previous.apis.map(entry => [entry.id, entry.mode, entry.selected]), appliedBefore.configuration.apis.map(entry => [entry.id, entry.mode, entry.selected]), 'the second temporary profile keeps the ORIGINAL state');
  check('a generated temporary identity: applied at once, kept out of the library, seen by a new document at its first script, the remembered rows and the session marker stored, End restores them; a second one never stacks' + (browser === 'firefox' ? '' : ''));

  if (browser === 'chrome') {
    phase = 'browser restart';
    const restartRevision = (await state()).revision, active = await state(); assert.ok(await area('session', 'fingerprint-temporary-live:v1')); assert.notDeepEqual(active.configuration.apis, appliedBefore.configuration.apis);
    await opened.close(); opened = await launch(); await bring();
    // The service worker has started again; the record had no marker (storage.session is empty after a restart), so it was reverted before anything registered.
    await until(async () => (await area('local', 'fingerprint-temporary:v1')) === null, 'record removed by the service worker'); await refresh();
    const afterRestart = await state(); assert.deepEqual(afterRestart.configuration.apis, appliedBefore.configuration.apis, 'the state before the temporary profile is back'); assert.ok(afterRestart.revision > restartRevision, 'through the revision-checked write');
    assert.equal(afterRestart.configuration.antidetectEnabled, true, 'the master stays'); assert.equal(await exists('[data-profile-temporary]'), false); assert.equal(await area('session', 'fingerprint-temporary-live:v1'), null);
    assert.deepEqual((await probe()), nativeProbe); assert.deepEqual(afterRestart.configuration.fingerprintProfiles.map(profile => profile.id).sort(), [BETA].sort());
    check('a REAL browser restart (the same profile directory reopened): the service worker reverts the temporary profile before registering, the page sees the native values again, the master and the library stay');
  }

  phase = 'profile-to-proxy link';
  await refresh();
  // The Proxy workspace's own port, from this Options page: a direct HTTP profile without credentials (nothing native, no secret), tagged Germany.
  const proxyId = (await proxyCommand('prepare', { name: 'Native exit', type: 'http', host: '127.0.0.1', port: 18123, country: 'DE' })).id;
  await refresh(); await opened.click(inRow(BETA, 'pick')); await appears('[data-profile-bundle-select]');
  const options = await evaluate(() => [...document.querySelectorAll('[data-profile-bundle-select] option')].map(option => [option.value, option.textContent]));
  assert.deepEqual(options[0], ['', options[0][1]]); assert.ok(options.some(([value, label]) => value === proxyId && label.includes('Native exit') && label.includes('HTTP 127.0.0.1:18123')), JSON.stringify(options)); assert.ok(options.find(([value]) => value === proxyId)[1].includes('Germany') || options.find(([value]) => value === proxyId)[1].includes('DE'), 'the country tag is shown');
  const quiet = (await state()).revision; await select('[data-profile-bundle-select]', proxyId); await until(async () => (await area('local', 'identity-bundles:v1')) !== null, 'link stored');
  assert.deepEqual(await area('local', 'identity-bundles:v1'), { version: 1, links: { [BETA]: proxyId } }); assert.equal((await state()).revision, quiet, 'the link is not part of the configuration');
  // Beta claims Tokyo while the linked proxy is tagged Germany: the hint names the country.
  await until(() => exists('[data-profile-peek-issue="proxy-country-region"]'), 'the proxy-country hint');
  assert.match(await evaluate(() => document.querySelector('[data-profile-peek-issue="proxy-country-region"]').textContent), /Germany|\(DE\)/u);
  // Apply with proxy: the profile first, then the saved proxy; the two results are reported separately.
  await until(() => usable('[data-profile-peek-apply-proxy]'), 'Apply with proxy usable'); await opened.click('[data-profile-peek-apply-proxy]'); await appears('[data-profile-bundle-result]'); await ready(); await pause(150);
  await until(() => exists('[data-profile-bundle-result-proxy]'), 'proxy result');
  assert.equal(await evaluate(() => document.querySelector('[data-profile-bundle-result-profile]')?.getAttribute('data-profile-bundle-result-profile')), 'ok'); assert.equal(await evaluate(() => document.querySelector('[data-profile-bundle-result-proxy]')?.getAttribute('data-profile-bundle-result-proxy')), 'ok', 'the proxy was connected by the click');
  assert.equal(row(await state(), 'hardware-concurrency').selected.value, 14, 'the profile is applied');
  const connected = await proxyCommand('status');
  assert.deepEqual({ state: connected.state, profileId: connected.profileId, autoConnect: connected.autoConnect }, { state: 'connected', profileId: proxyId, autoConnect: false }, 'connected to the linked proxy, and no autoConnect was created');
  await proxyCommand('disconnect');
  // Removing the link; the link of a deleted profile does not outlive the next write.
  await select('[data-profile-bundle-select]', ''); await until(async () => (await area('local', 'identity-bundles:v1')) === null, 'link removed');
  check('the link: a saved proxy is chosen from the Proxy workspace list (name, protocol, endpoint, country), stored in one machine-local key outside the configuration, drives the proxy-country hint, and "Apply with proxy" applies the profile and then connects that proxy by the click, without autoConnect');

  phase = 'layout';
  // The new library controls in a real page: long tags and a note, the trash with a last-day item, the link with its hint, the temporary banner;
  // in English light at 1180, then Arabic (right to left) and Russian in the dark at 520 and 340 CSS pixels. Nothing may leave the viewport.
  {
    const current = await state(), next = structuredClone(current.configuration);
    next.fingerprintProfiles = next.fingerprintProfiles.map(profile => profile.id === BETA ? { ...profile, tags: ['production', 'Europe', 'long-tag-name-24-chars-x', 'fourth', 'fifth'], note: 'A longer note for the layout' + LF + 'on two lines' } : profile);
    const written = await send({ type: 'ui-api-config-set', expectedRevision: current.revision, tabId: null, configuration: next }); assert.equal(written.type, 'api-config-state', JSON.stringify(written).slice(0, 200));
    const record = next.fingerprintProfiles.find(profile => profile.id === BETA), stamp = Date.now();
    await evaluate(async ({ record, stamp }) => { const api = globalThis.browser ?? globalThis.chrome; const copy = (id, name, age) => ({ profile: { ...record, id, label: name }, deletedAt: stamp - age, index: 0 }); await api.storage.local.set({ 'fingerprint-trash:v1': { version: 1, items: [copy('fp-' + 'f6'.repeat(16), 'Deleted yesterday', 86400000), copy('fp-' + 'a7'.repeat(16), 'Deleted last-week profile with a long name', 6 * 86400000 + 43200000)] } }); }, { record, stamp });
    await refresh(); await opened.click(inRow(BETA, 'pick')); await appears('[data-profile-bundle-select]'); await select('[data-profile-bundle-select]', proxyId); await until(() => exists('[data-profile-peek-issue="proxy-country-region"]'), 'the hint for the layout');
    await until(() => usable('[data-profile-temporary-new]'), 'New temporary identity usable'); await opened.click('[data-profile-temporary-new]'); await appears('[data-profile-temporary]'); await ready(); await pause(120);
    const measure = () => evaluate(() => {
      const panel = document.querySelector('[data-profile-panel]'), limit = innerWidth + 1, out = [];
      for (const node of panel.querySelectorAll('*')) { const box = node.getBoundingClientRect(); if (box.width > 0 && (box.right > limit || box.left < -1) && !node.closest('[data-profile-json],[data-profile-export-json],pre,textarea')) out.push((node.getAttribute('data-profile-panel') ?? node.className?.toString().split(' ')[0] ?? node.tagName) + ' ' + Math.round(box.left) + '..' + Math.round(box.right)); }
      return { width: innerWidth, scroll: document.documentElement.scrollWidth, rtl: document.documentElement.dir === 'rtl', dark: matchMedia('(prefers-color-scheme: dark)').matches, outside: out.slice(0, 6) };
    });
    evidence.layouts = [];
    for (const { language, width, dark } of [{ language: 'en', width: 1180, dark: false }, { language: 'ar', width: 520, dark: true }, { language: 'ar', width: 340, dark: true }, { language: 'ru', width: 340, dark: true }]) {
      await evaluate(async language => { await (globalThis.browser ?? globalThis.chrome).storage.local.set({ 'ui-language-v1': language }); }, language);
      await opened.media({ colorScheme: dark ? 'dark' : 'light' }); await opened.viewport(width, 1000); await pause(250);
      for (const view of ['library', 'trash']) {
        if (view === 'trash') { await opened.click('[data-profile-trash-toggle]'); await appears('[data-profile-trash-row]'); await pause(120); }
        const layout = await measure(); evidence.layouts.push({ language, width, view, ...layout });
        assert.equal(layout.rtl, language === 'ar', language + ' direction'); if (browser === 'chrome') assert.equal(layout.dark, dark, language + ' colour scheme');
        assert.ok(layout.scroll <= layout.width + 1, language + ' ' + view + ' at ' + width + ' scrolls sideways: ' + layout.scroll);
        assert.deepEqual(layout.outside, [], language + ' ' + view + ' at ' + width + ' has parts outside the viewport');
        await shot('layout-' + language + '-' + width + '-' + view);
        if (view === 'trash') { await opened.click('[data-profile-trash-toggle]'); await gone('[data-profile-trash]'); }
      }
    }
    await opened.viewport(1180, 900); await opened.media({ colorScheme: 'light' }); await evaluate(async () => { await (globalThis.browser ?? globalThis.chrome).storage.local.set({ 'ui-language-v1': 'en' }); }); await pause(120);
    await opened.click('[data-profile-temporary-end]'); await gone('[data-profile-temporary]'); await ready();
    check('layout: tags, note, link, hint, trash and the temporary banner stay inside the viewport in English (1180), Arabic (right to left, 520 and 340) and Russian (340)' + (browser === 'chrome' ? ', light and dark' : '; the colour scheme is not emulated in Firefox'));
  }

  evidence.result = 'PASS';
} catch (error) {
  evidence.result = 'FAIL'; evidence.phase = phase; evidence.error = String(error.message).slice(0, 700);
  if (opened) try { evidence.page = await evaluate(() => ({ error: document.querySelector('[data-profile-error]')?.textContent ?? null, notice: document.querySelector('[data-profile-notice]')?.textContent ?? null, temporary: Boolean(document.querySelector('[data-profile-temporary]')) })); } catch { /* the page is gone */ }
  if (opened) try { await opened.screenshot(join(run, 'failure.png')); } catch { /* no page */ }
  throw error;
} finally {
  if (opened) try { await opened.close(); } catch { /* already closed */ }
  await new Promise(resolve => server.close(resolve));
  writeEvidence('antidetect-profiles/identity-' + browser + '.json', JSON.stringify(evidence, null, 2) + LF);
}
console.log('Fingerprint identity ' + browser + ': ' + evidence.checks.length + ' checks PASS');
void generateConsistentDevice;
