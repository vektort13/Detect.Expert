// E22-19 / ADR-066: real packaged Options, local first-inline fixtures and portable profile books.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launchOwnedManagement, until, pause } from './management-browser-fixture.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';
import { FINGERPRINT_UI_KEYS } from '../production-locales-fingerprint.mjs';
import { stageExtension } from './native-evidence.mjs';
import { windowsFonts, WINDOWS_FONT_GROUPS, REGION_FONT_GROUP_KEYS, regionFontRoots } from '../../apps/production-extension/fingerprint-font-groups.js';
import { fontNoiseModel, removedByNoise } from '../../apps/production-extension/fingerprint-font-noise.js';
// --from-source assembles the package from apps/production-extension instead of copying dist/<browser> (which the lead builds).
const root = resolve(import.meta.dirname, '../..'), browser = process.argv.includes('--firefox') ? 'firefox' : 'chrome', fromSource = process.argv.includes('--from-source');
// --output DIR: write the evidence file there instead of test-results/production-1.1.0/antidetect-profiles.
const outputIndex = process.argv.indexOf('--output'), outputDirectory = outputIndex >= 0 ? resolve(process.argv[outputIndex + 1]) : null;
mkdirSync(join(root, '.tmp'), { recursive: true }); const run = mkdtempSync(join(root, '.tmp/fingerprint-profiles-')), extension = join(run, 'extension'); const staged = await stageExtension({ browser, target: extension, from: fromSource ? 'source' : 'dist' });
const files = ['fingerprint-profiles.js', 'fingerprint-profiles-controller.js', 'fingerprint-profile-ui.js', 'fingerprint-profile-ui.css', 'fingerprint-library-ui.js', 'fingerprint-library-ui.css', 'fingerprint-library-labels.js', 'fingerprint-identity-labels.js', 'fingerprint-trash.js', 'fingerprint-temporary.js', 'identity-bundles.js', 'antidetect-ui.js', 'antidetect-ui.css', 'antidetect-controller.js', 'api-configuration.js', 'api-configuration-controller.js', 'api-custom-registration.js', 'api-custom-canvas-runtime.js', 'api-custom-opaque.canvas-readback.js', 'canvas-profile-seed.js', 'options.html', 'options.js'];
const evidence = { browser, run, packaging: staged.packaging, at: new Date().toISOString(), result: 'RUNNING', checks: [], layouts: [], hashes: Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(join(extension, file))).digest('hex')])) };
const server = createServer((request, response) => { request.resume(); response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end('<!doctype html><script>const c=document.createElement("canvas");c.width=8;c.height=8;const x=c.getContext("2d");x.fillStyle="rgb(90,120,170)";x.fillRect(0,0,8,8);window.__profileFirst={cpu:navigator.hardwareConcurrency,memory:navigator.deviceMemory??null,language:navigator.language,languages:[...navigator.languages],width:screen.width,height:screen.height,depth:screen.colorDepth,pixelDepth:screen.pixelDepth,dpr:devicePixelRatio,userAgent:navigator.userAgent,canvasStable:c.toDataURL()===c.toDataURL(),gl:(()=>{try{const g=document.createElement("canvas").getContext("webgl"),e=g&&g.getExtension("WEBGL_debug_renderer_info");return g&&e?{vendor:g.getParameter(e.UNMASKED_VENDOR_WEBGL),renderer:g.getParameter(e.UNMASKED_RENDERER_WEBGL),maskedVendor:g.getParameter(g.VENDOR),maskedRenderer:g.getParameter(g.RENDERER)}:null}catch(error){return null}})()};</script><h1>Owned profile fixture</h1>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = 'http://127.0.0.1:' + server.address().port;
let opened, phase = 'startup', navigation = 0;
const GPU_CASES = {
  'nvidia-rtx-2080-super': { vendor: 'WebKit', renderer: 'WebKit WebGL', unmaskedVendor: 'Google Inc. (NVIDIA)', unmaskedRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 2080 SUPER (0x00001E81) Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  'amd-rx-6600': { vendor: 'WebKit', renderer: 'WebKit WebGL', unmaskedVendor: 'Google Inc. (AMD)', unmaskedRenderer: 'ANGLE (AMD, AMD Radeon RX 6600 (0x000073FF) Direct3D11 vs_5_0 ps_5_0, D3D11)' },
};
const check = value => { evidence.checks.push(value); console.log('  ok ' + value); };
const evaluate = (fn, value) => opened.evaluate(fn, value);
const send = message => evaluate(message => (globalThis.browser ?? globalThis.chrome).runtime.sendMessage({ schemaVersion: 1, ...message }), message);
const state = () => send({ type: 'ui-api-config-get', tabId: null });
const row = (state, id) => state.configuration.apis.find(item => item.id === id);
const ready = () => until(() => evaluate(() => document.querySelector('[data-profile-panel]')?.getAttribute('aria-busy') === 'false' && Boolean(document.querySelector('[data-profile-generate]')) && document.querySelector('[data-antidetect-app]')?.getAttribute('aria-busy') === 'false'), 'profile ready');
const select = (selector, value) => evaluate(({ selector, value }) => { const input = document.querySelector(selector); if (!input) throw Error('Missing field ' + selector); input.value = value; input.dispatchEvent(new Event('change', { bubbles: true })); }, { selector, value });
async function refresh() {
  const url = opened.base + 'options.html?profiles-native=' + (++navigation) + '#antidetect';
  await opened.goto(url);
  await until(() => evaluate(url => location.href === url && document.readyState === 'complete' &&
    document.querySelector('[data-antidetect-app]')?.getAttribute('aria-busy') === 'false' &&
    Boolean(document.querySelector('[data-antidetect-category="quick"]')), url), 'new Antidetect document ready');
  await opened.click('[data-antidetect-category="quick"]'); await ready();
}
// Generator choices are segmented radios; library actions belong to their own row.
const choose = (attribute, value) => opened.click('[data-profile-' + attribute + '] [data-profile-option="' + value + '"]');
const inRow = (id, attribute) => '[data-profile-row="' + id + '"] [data-profile-' + attribute + ']';
// ADR-107: an Apply that cannot run is aria-disabled (still focusable, with a visible reason), so «usable» reads both attributes; a
// commit waits for its button to be usable (the WebDriver click of the Firefox fixture checks only `disabled`).
const usable = selector => evaluate(selector => { const button = document.querySelector(selector); return Boolean(button) && !button.disabled && button.getAttribute('aria-disabled') !== 'true'; }, selector);
async function commit(selector) { await until(() => usable(selector), 'usable ' + selector); await opened.click(selector); await ready(); await pause(60); const error = await evaluate(() => document.querySelector('[data-profile-error]')?.textContent); assert.ok(!error, error); return state(); }
async function exportPreview() { await opened.click('[data-profile-export]'); return evaluate(() => JSON.parse(document.querySelector('[data-profile-export-json]').value)); }
async function importPreview(text) { await evaluate(text => { const input = document.querySelector('[data-profile-file]'), transfer = new DataTransfer(); transfer.items.add(new File([text], 'owned-profiles.json', { type: 'application/json' })); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true })); }, text); await ready(); }
async function probe() { return evaluate(async origin => { const api = globalThis.browser ?? globalThis.chrome, url = origin + '/probe?' + Date.now(), tab = await api.tabs.create({ url, active: false }); try { for (let index = 0; index < 150; index++) { const tabState = await api.tabs.get(tab.id); if (tabState.status === 'complete' && tabState.url === url) { const result = await api.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: () => globalThis.__profileFirst ?? null }); if (result[0]?.result) return result[0].result; } await new Promise(resolve => setTimeout(resolve, 40)); } throw Error('Owned profile probe timeout'); } finally { await api.tabs.remove(tab.id); } }, origin); }
try {
  opened = await launchOwnedManagement({ root, run, extension, browser, evidence, dark: browser === 'firefox' }); evidence.version = opened.version;
  await opened.goto(opened.base + 'options.html#settings'); await until(() => evaluate(() => Boolean(document.querySelector('[data-management-shell]'))), 'shell');
  await send({ type: 'ui-data-consent-set', version: 1, accepted: true }); await send({ type: 'ui-set-scope', scopeMode: 'all-sites' }); await refresh();
  if (browser === 'firefox') { await opened.click('[data-antidetect-grant-early]'); await ready(); }
  const before = await state(), baseline = await probe(); evidence.nativeWebgl = baseline.gl;
  // A machine whose real adapter equals the first card would pass vacuously, so the test picks a card that differs from it.
  const gpuId = baseline.gl?.renderer === GPU_CASES['nvidia-rtx-2080-super'].unmaskedRenderer ? 'amd-rx-6600' : 'nvidia-rtx-2080-super', GL_PAIR = GPU_CASES[gpuId]; assert.equal(before.configuration.enabled, false); assert.equal(before.configuration.antidetectEnabled, false); assert.equal(before.configuration.fingerprintProfiles.length, 0);
  await choose('device-type', 'desktop'); await choose('os', 'windows-10'); await choose('browser', 'edge'); await select('[data-profile-version]', '150'); await select('[data-profile-screen]', '1920x1080'); await select('[data-profile-gpu]', gpuId); await select('[data-profile-language]', 'de-DE'); await opened.click('[data-profile-generate]'); await ready();
  const generated = await exportPreview(); assert.equal((await state()).revision, before.revision); assert.equal(generated.enabled, false); assert.equal(generated.antidetectEnabled, false); assert.equal(generated.formatVersion, 10); assert.equal(generated.catalogVersion, 11); assert.equal(generated.apis.length, 158);
  assert.equal(generated.apis.find(item => item.id === 'canvas-readback').mode, 'custom'); assert.equal(generated.apis.find(item => item.id === 'navigator-user-agent').mode, 'custom'); assert.match(generated.apis.find(item => item.id === 'navigator-user-agent').selected.value, /Edg\/150\.0\.0\.0$/);
  assert.ok(await evaluate(() => Boolean(document.querySelector('[data-profile-issue="screen-css"]'))));
  assert.deepEqual(generated.apis.find(item => item.id === 'webgl').selected.value, GL_PAIR);
  check('real generator and full JSON preview change no persisted setting, retain master OFF and native engine, and show cross-surface limits');

  phase = 'library save and persistence'; await opened.fill('[data-profile-name]', 'Owned workstation'); const stored = await commit('[data-profile-save-named]');
  assert.equal(stored.revision, before.revision + 1); assert.deepEqual(stored.configuration.apis, before.configuration.apis); assert.equal(stored.configuration.fingerprintProfiles.length, 1); const profileId = stored.configuration.fingerprintProfiles[0].id;
  assert.equal((await exportPreview()).apis.find(item => item.id === 'screen-width').selected.value, 1920);
  const applied = await commit('[data-profile-apply]'); assert.equal(applied.configuration.enabled, false); assert.equal(applied.configuration.antidetectEnabled, false); assert.deepEqual((await probe()), baseline);
  // ADR-107: a row opens its read-only Peek; the "Save as profile" field keeps its own text.
  await refresh(); await opened.click(inRow(profileId, 'pick')); assert.equal(await evaluate(id => document.querySelector('[data-profile-peek="' + id + '"] .fingerprint-peek__title')?.textContent, profileId), 'Owned workstation');
  assert.equal(await evaluate(() => document.querySelector('[data-profile-name]').value), ''); assert.equal((await state()).revision, applied.revision, 'opening the Peek never writes');
  check('Save as profile commits only its complete 158-row library snapshot; Apply is separate; master OFF remains native and reopening restores the saved library');

  phase = 'master and early application'; await opened.click('[data-antidetect-master]');
  assert.equal(await usable('[data-profile-apply]'), false, 'Apply is unavailable right after the master click');
  assert.equal(await evaluate(() => document.querySelector('[data-profile-apply]').disabled), false, 'yet focusable: aria-disabled, not disabled');
  await until(async () => (await state()).configuration.antidetectEnabled, 'Antidetect master saved'); await refresh(); const active = await state(), observed = await probe();
  assert.equal(active.configuration.enabled, before.configuration.enabled, 'enabling Antidetect preserves the independent API Guard master');
  assert.equal(observed.cpu, row(active, 'hardware-concurrency').selected.value); assert.equal(observed.language, 'de-DE');
  // ADR-107 (G): the generator writes Chrome's form of the list (the language, its base, then en-US and en); the page sees exactly the stored list.
  assert.deepEqual(row(active, 'navigator-languages').selected.value, ['de-DE', 'de', 'en-US', 'en']); assert.deepEqual(observed.languages, row(active, 'navigator-languages').selected.value);
  assert.equal(observed.width, 1920); assert.equal(observed.height, 1080); assert.equal(observed.depth, observed.pixelDepth); assert.equal(observed.canvasStable, true); assert.match(observed.userAgent, /Edg\/150\.0\.0\.0$/); assert.notEqual(observed.userAgent, baseline.userAgent);
  const glExposed = Boolean(baseline.gl); if (glExposed) { assert.deepEqual(observed.gl, { vendor: GL_PAIR.unmaskedVendor, renderer: GL_PAIR.unmaskedRenderer, maskedVendor: 'WebKit', maskedRenderer: 'WebKit WebGL' }); assert.notEqual(baseline.gl.renderer, GL_PAIR.unmaskedRenderer); }
  check('The Antidetect master persists immediately on its own and preserves API Guard OFF; after verified early registration a new document sees the selected CPU/language/screen tuple and stable Canvas before its first script' + (glExposed ? ', and the exact ANGLE/Direct3D11 WebGL pair of the chosen catalogue card ' + gpuId : ' (this browser exposes no WebGL, so the WebGL pair was checked only in the generated profile)'));

  phase = 'rename and manual editing'; const beforeRename = await state();
  await opened.click(inRow(profileId, 'rename')); assert.equal((await state()).revision, beforeRename.revision); await opened.fill('[data-profile-rename-input]', 'Owned renamed'); const renamed = await commit('[data-profile-rename-save]'); assert.equal(renamed.configuration.fingerprintProfiles[0].label, 'Owned renamed'); assert.deepEqual(renamed.configuration.apis, beforeRename.configuration.apis);
  await opened.click('.fingerprint-editor > summary'); await select('[data-profile-api]', 'hardware-concurrency'); await select('[data-profile-api-mode]', 'custom'); await select('[data-profile-value-kind]', 'value'); await opened.fill('[data-profile-api-json]', '24'); await opened.click('[data-profile-stage-api]'); assert.equal((await state()).revision, renamed.revision);
  const edited = await commit('[data-profile-apply]'); assert.equal(row(edited, 'hardware-concurrency').selected.value, 24); assert.equal((await probe()).cpu, 24);
  for (const mode of ['off', 'bypass']) { await select('[data-profile-api-mode]', mode); await opened.click('[data-profile-stage-api]'); await commit('[data-profile-apply]'); assert.equal((await probe()).cpu, baseline.cpu); }
  check('confirmed rename changes only the library; per-API editing validates a preview; new documents restore native values in OFF/BYPASS despite a retained Custom selection');

  phase = 'safe JSON and large library'; const beforeImport = await state(); await importPreview('{"formatVersion":5,"formatVersion":5}'); assert.ok(await evaluate(() => Boolean(document.querySelector('[data-profile-error]')))); assert.equal((await state()).revision, beforeImport.revision);
  const many = structuredClone(beforeImport.configuration), template = many.fingerprintProfiles[0];
  many.fingerprintProfiles = Array.from({ length: 100 }, (_, index) => { const value = { ...structuredClone(template), id: 'fp-' + (index + 1).toString(16).padStart(32, '0'), label: 'Native ' + String(index).padStart(3, '0') }; if (index === 77) { const cpu = value.apis.find(row => row.id === 'hardware-concurrency'); cpu.mode = 'custom'; cpu.selected = { kind: 'value', value: 14 }; } return value; });
  await importPreview(JSON.stringify(many)); assert.equal((await state()).revision, beforeImport.revision); assert.equal((await exportPreview()).fingerprintProfiles.length, 100); await commit('[data-profile-apply]');
  await opened.fill('[data-profile-search]', 'Native 077'); assert.equal(await evaluate(() => document.querySelectorAll('[data-profile-library] > [data-profile-row]').length), 1); await opened.click(inRow(many.fingerprintProfiles[77].id, 'pick'));
  const beforeLoad = await state(); await opened.click(inRow(many.fingerprintProfiles[77].id, 'load')); assert.equal((await state()).revision, beforeLoad.revision); assert.equal((await exportPreview()).apis.find(row => row.id === 'hardware-concurrency').selected.value, 14); await commit('[data-profile-apply]'); assert.equal((await probe()).cpu, 14);
  const deleted = await commit(inRow(many.fingerprintProfiles[77].id, 'delete')); assert.equal(deleted.configuration.fingerprintProfiles.length, 99); assert.equal(row(deleted, 'hardware-concurrency').selected.value, 14);
  const undone = await commit('[data-profile-undo-button]'); assert.equal(undone.revision, deleted.revision + 1); assert.equal(undone.configuration.fingerprintProfiles.length, 100); assert.deepEqual(undone.configuration.fingerprintProfiles.find(item => item.id === many.fingerprintProfiles[77].id).apis, many.fingerprintProfiles[77].apis); assert.equal(row(undone, 'hardware-concurrency').selected.value, 14);
  check('duplicate JSON leaves settings intact; 100 full profiles import only through explicit Apply, filter and load without automatic writes; Delete commits at once, Undo restores the same profile, and both preserve the applied settings');

  phase = 'external revisions';
  // 1. An external save that does not overlap the preview (the header master switch, another window) is merged silently: no stale lock.
  const staleBase = await state(); await send({ type: 'ui-api-config-set', expectedRevision: staleBase.revision, tabId: null, configuration: staleBase.configuration });
  await pause(500); assert.equal(await evaluate(() => Boolean(document.querySelector('[data-profile-stale]'))), false, 'a non-overlapping external revision must not lock the editor');
  await opened.click('[data-profile-generate]'); await pause(300); assert.equal(await usable('[data-profile-apply]'), true, 'Apply stays usable after an external save');
  // 2. A save that changes a row the preview also changes is a real conflict: the editor locks and never overwrites the newer settings.
  const rival = await state(), conflicting = structuredClone(rival.configuration), cores = conflicting.apis.find(item => item.id === 'hardware-concurrency'); cores.mode = 'custom'; cores.selected = { kind: 'value', value: 3 };
  await send({ type: 'ui-api-config-set', expectedRevision: rival.revision, tabId: null, configuration: conflicting });
  await until(() => evaluate(() => Boolean(document.querySelector('[data-profile-stale]'))), 'stale indication'); const staleRevision = (await state()).revision;
  assert.equal(await usable('[data-profile-apply]'), false, 'a conflicting draft cannot be applied'); assert.equal((await state()).revision, staleRevision);
  assert.equal(await evaluate(() => document.querySelector('[data-profile-bar]')?.getAttribute('data-profile-bar')), 'stale');
  assert.equal(await usable('[data-profile-bar-keep]'), true, 'ADR-107: «Keep my changes» is offered next to Discard'); await opened.click('[data-profile-bar-discard]');
  await until(() => evaluate(() => !document.querySelector('[data-profile-stale]') && document.querySelector('[data-profile-panel]')?.getAttribute('aria-busy') === 'false'), 'stale cleared by the one-click discard');
  assert.equal(row(await state(), 'hardware-concurrency').selected.value, 3, 'the newer settings win after discarding the draft');
  await refresh(); check('an external save that does not overlap the preview is merged silently, a conflicting one locks the editor, offers one-click discard and never overwrites newer settings');

  // ADR-110 addendum (2026-11-07): the font list noise switch of the generator, in the real packaged Options page. Nothing is applied: the draft is read from the export preview.
  // Addendum 2 (same day): the switch is On when the panel first shows, and the claimed region (the generator's time zone, never the network) adds its regional CJK group.
  phase = 'font list noise'; await refresh();
  const noiseButtons = () => evaluate(() => [...document.querySelectorAll('[data-profile-font-noise] [data-profile-option]')].map(button => [button.getAttribute('data-profile-option'), button.getAttribute('aria-checked'), button.disabled]));
  const fontRow = async () => (await exportPreview()).apis.find(item => item.id === 'canvas-font-policy');
  const generateFonts = async () => { await opened.click('[data-profile-generate]'); await ready(); return (await fontRow()).selected.value.families; };
  assert.deepEqual(await noiseButtons(), [['off', 'false', true], ['on', 'true', true]], 'On by default (owner decision 2026-11-07), and locked while the preset is not Strict');
  assert.equal(await evaluate(() => { const group = document.querySelector('[data-profile-font-noise]'), hint = document.querySelector('[data-profile-font-noise-hint]'); return Boolean(hint) && group.getAttribute('aria-describedby') === hint.id && hint.textContent.trim().length > 60 && group.classList.contains('is-locked'); }), true, 'the hint is attached and the locked switch looks locked');
  await opened.click('[data-profile-presets] [data-profile-preset="strict"]'); await choose('os', 'windows-10'); // library rows carry data-profile-preset too: the radio group scopes the selector
  assert.deepEqual(await noiseButtons(), [['off', 'false', false], ['on', 'true', false]], 'Strict unlocks the switch, still On');
  const plainFonts = windowsFonts(), revisionBefore = (await state()).revision, noisyLists = new Set();
  for (let round = 0; round < 3; round++) {
    const written = await generateFonts();
    assert.equal(written.length, plainFonts.length - 2, 'about 3 % of the optional names are left out'); assert.equal(removedByNoise(plainFonts, written)?.length, 2, 'a valid noise set of the Windows 10 list');
    for (const name of ['Arial', 'Segoe UI', 'Times New Roman', 'Courier New', 'Helvetica']) assert.ok(written.includes(name), name + ' is never left out');
    noisyLists.add(written.join('|'));
  }
  assert.ok(noisyLists.size > 1, 'each generation draws its own seed');
  await choose('font-noise', 'off'); assert.deepEqual(await noiseButtons(), [['off', 'true', false], ['on', 'false', false]]);
  assert.deepEqual(await generateFonts(), plainFonts, 'switch Off: the plain Windows 10 list');
  await choose('font-noise', 'on'); assert.equal((await generateFonts()).length, plainFonts.length - 2, 'On again: the noisy list');
  check('font list noise: the switch is On and locked outside Strict, unlocked in Strict; On leaves exactly 2 of the 57 optional Windows 10 names out of the generated list (never a mandatory one, a different set per generation), Off writes the plain list; nothing is written until Apply');

  // The claimed region: the generator's time zone gives it; every regional list keeps its group and the base-script families of the region, whatever the noise leaves out.
  phase = 'font list region';
  const pickZone = async (query, iana) => {
    await opened.fill('[data-profile-timezone-input]', query);
    await until(() => evaluate(iana => Boolean(document.querySelector('[data-profile-timezone-option="' + iana + '"]')), iana), 'time zone option ' + iana);
    await evaluate(iana => document.querySelector('[data-profile-timezone-option="' + iana + '"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })), iana);
    await until(() => evaluate(iana => document.querySelector('[data-profile-timezone-input]').value.includes(iana), iana), 'time zone shown ' + iana);
  };
  const otherGroups = group => REGION_FONT_GROUP_KEYS.filter(key => key !== group).flatMap(key => WINDOWS_FONT_GROUPS[key]).filter(name => !(group ? WINDOWS_FONT_GROUPS[group] : []).includes(name));
  const regionCases = [['tokyo', 'Asia/Tokyo', 'regionJa'], ['seoul', 'Asia/Seoul', 'regionKo'], ['shanghai', 'Asia/Shanghai', 'regionZhHans'], ['taipei', 'Asia/Taipei', 'regionZhHant'], ['berlin', 'Europe/Berlin', null]], regionLog = [];
  for (const [query, iana, group] of regionCases) {
    await pickZone(query, iana);
    const expected = windowsFonts({ regionGroup: group }), roots = regionFontRoots(group), model = fontNoiseModel(expected, roots);
    for (let round = 0; round < 2; round++) {
      const written = await generateFonts();
      assert.equal(written.length, expected.length - model.limit, iana + ': the limit of the regional list'); assert.equal(removedByNoise(expected, written, model)?.length, model.limit, iana + ': a valid noise set of the regional list');
      for (const name of roots) assert.ok(written.includes(name), iana + ': ' + name + ' is never left out');
      for (const name of otherGroups(group)) assert.ok(!written.includes(name), iana + ': ' + name + ' belongs to another region');
    }
    await choose('font-noise', 'off'); assert.deepEqual(await generateFonts(), expected, iana + ': Off writes the plain list of the claimed region'); await choose('font-noise', 'on');
    regionLog.push(iana + ' ' + String(group) + ' ' + expected.length + '/' + (expected.length - model.limit));
  }
  // Windows 11 + Japan: the six Windows 11 names and the Japanese group together.
  await pickZone('tokyo', 'Asia/Tokyo'); await choose('os', 'windows-11');
  const japan11 = windowsFonts({ windows11: true, regionGroup: 'regionJa' }), japan11Written = await generateFonts();
  assert.equal(japan11Written.length, japan11.length - fontNoiseModel(japan11, regionFontRoots('regionJa')).limit); for (const name of ['Segoe UI Variable', 'Meiryo', 'Yu Mincho', 'MS PGothic']) assert.ok(japan11Written.includes(name), name);
  await opened.click('[data-profile-presets] [data-profile-preset="balanced"]'); assert.deepEqual(await noiseButtons(), [['off', 'false', true], ['on', 'true', true]], 'back to a preset without a font list: locked again');
  assert.equal((await state()).revision, revisionBefore, 'generating and switching write nothing');
  await opened.click('[data-profile-cancel]'); await ready(); // drop the draft without a second page load
  check('font list region: the generator time zone gives the claimed region - Tokyo adds the Japanese group, Seoul the Korean, Shanghai the Simplified Chinese, Taipei the Traditional Chinese, Berlin none; each list keeps its group and the base-script families of the region under the noise, never carries a group of another region, and Off writes the plain list of the claim (' + regionLog.join('; ') + '); Windows 11 + Japan adds Segoe UI Variable; nothing is written until Apply');

  phase = 'localization and layout'; for (const language of PRODUCTION_LANGUAGES) {
    await evaluate(async ({ language, keys }) => { const module = await import('./fingerprint-profile-ui.js'); if (!module.createFingerprintProfileUi) throw Error('Missing profile UI'); await (globalThis.browser ?? globalThis.chrome).storage.local.set({ 'ui-language-v1': language }); await new Promise(resolve => setTimeout(resolve, 45)); const text = document.querySelector('[data-profile-panel]').textContent; if (keys.some(key => text.includes(key)) || /(?:fingerprint_|protection_feature_|antidetect_editor_)[a-z_]+/.test(text)) throw Error('Untranslated profile label'); }, { language: language.id, keys: FINGERPRINT_UI_KEYS });
  }
  await evaluate(async () => { await (globalThis.browser ?? globalThis.chrome).storage.local.set({ 'ui-language-v1': 'ru' }); }); await pause(80); await opened.viewport(1180, 900); await opened.screenshot(join(run, 'profiles-ru-wide.png'));
  await evaluate(async () => { await (globalThis.browser ?? globalThis.chrome).storage.local.set({ 'ui-language-v1': 'ar' }); }); await opened.media({ colorScheme: 'dark' }); await pause(80);
  for (const width of [1180, 520, 340]) { await opened.viewport(width, 900); await pause(70); const layout = await evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, dark: matchMedia('(prefers-color-scheme: dark)').matches, rtl: document.documentElement.dir === 'rtl', cards: [...document.querySelectorAll('.fingerprint-generator,.fingerprint-library,.fingerprint-preview')].map(node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right }; }) })); assert.equal(layout.rtl, true); assert.equal(layout.dark, true); assert.ok(layout.scroll <= layout.width + 1); for (const card of layout.cards) { assert.ok(card.left >= -1); assert.ok(card.right <= layout.width + 1); } evidence.layouts.push(layout); }
  await opened.screenshot(join(run, 'profiles-ar-dark-narrow.png')); check('all 21 locales resolve; actual dark Arabic RTL profile controls fit 1180/520/340px with the colored vertical navigation');
  evidence.result = 'PASS';
} catch (error) { evidence.result = 'FAIL'; evidence.phase = phase; evidence.error = String(error.message).slice(0, 500); if (opened) try { evidence.locks = await evaluate(() => ({ parentDisabled: document.querySelector('[data-profile-panel]')?.getAttribute('data-profile-parent-disabled'), busy: document.querySelector('[data-profile-panel]')?.getAttribute('aria-busy'), staleBanner: Boolean(document.querySelector('[data-profile-stale]')), externalBanner: Boolean(document.querySelector('[data-antidetect-external-change]')), error: document.querySelector('[data-profile-error]')?.textContent ?? null, notice: document.querySelector('[data-profile-notice]')?.textContent ?? null, apply: document.querySelector('[data-profile-apply]')?.disabled })); } catch {} if (opened) try { await opened.screenshot(join(run, 'failure.png')); } catch {} throw error; }
finally { if (opened) await opened.close(); await new Promise(resolve => server.close(resolve)); const output = join(outputDirectory ?? join(root, 'test-results/production-1.1.0/antidetect-profiles'), 'profiles-' + browser + '.json'); mkdirSync(resolve(output, '..'), { recursive: true }); writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n'); }
console.log('Fingerprint profiles ' + browser + ': ' + evidence.checks.length + ' checks PASS');
