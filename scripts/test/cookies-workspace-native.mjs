// ADR-069: genuine native cookie operations in disposable profiles, owned fixtures only.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launchOwnedManagement, until } from './management-browser-fixture.mjs';
import { writeEvidence } from './native-evidence.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';
import { COOKIE_FILES } from './cookies-workspace-delivery.mjs';

const root = resolve(import.meta.dirname, '../..'), browser = process.argv.includes('--firefox') ? 'firefox' : 'chrome';
mkdirSync(join(root, '.tmp'), { recursive: true });
const run = mkdtempSync(join(root, '.tmp/cookies-workspace-' + browser + '-')), frozen = join(run, 'frozen');
cpSync(join(root, 'dist', browser), frozen, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const evidence = { at: new Date().toISOString(), browser, run, result: 'RUNNING', rawUserDataRead: false, disposableProfile: true,
  hashes: Object.fromEntries(COOKIE_FILES.map(file => [file, hash(readFileSync(join(frozen, file)))])), checks: [], layouts: [], locales: [] };
const check = value => { evidence.checks.push(value); console.log('  ok ' + value); };
let opened, phase = 'optional baseline';
const bridge = `import {createCookiesWorkspaceController} from './cookies-workspace-controller.js';
import * as core from './cookie-transfer-core.js'; import * as crypto from './cookie-transfer-crypto.js';
const api=globalThis.browser??globalThis.chrome;let controller=createCookiesWorkspaceController(api);
export async function invoke(method,json){try{return {ok:true,value:await controller[method](...JSON.parse(json))}}catch(e){return {ok:false,code:e.code??'unknown'}}}
export async function fixture(method,json){const args=JSON.parse(json);if(method==='native')return api.cookies[args[0]](...args.slice(1));if(method==='parse')return core.parseCookieImport(args[0]);if(method==='export')return core.exportCookieRecords(args[0],args[1]);if(method==='reset'){controller.dispose();controller=createCookiesWorkspaceController(api);return true}if(method==='crypto'){const a=await crypto.encryptCookieTransfer(args[0],'owned fixture');const b=await crypto.decryptCookieTransfer(a,'owned fixture');return {same:b===args[0],plain:a.includes('OWNED_COOKIE_VALUE')}}throw Error('unknown fixture command')}
`;
async function boot(directory, label) {
  const subrun = join(run, label); mkdirSync(subrun, { recursive: true });
  const downloadDirectory = join(subrun, 'downloads');
  opened = await launchOwnedManagement({ root, run: subrun, extension: directory, browser, evidence, downloadDirectory, dark: browser === 'firefox' && label === 'native' });
  opened.downloadDirectory = downloadDirectory;
  await opened.goto(opened.base + 'options.html#cookies');
  await until(() => opened.evaluate(() => document.querySelector('[data-management-tab="cookies"]')?.getAttribute('aria-selected') === 'true'), 'Cookies management tab');
  await opened.evaluate(async () => { const api = globalThis.browser ?? globalThis.chrome; window.__cookiesBridge = await import(api.runtime.getURL('cookies-native-bridge.js')); return true; });
}
const invoke = (method, args = []) => opened.evaluate(({ method, json }) => window.__cookiesBridge.invoke(method, json), { method, json: JSON.stringify(args) });
const fixture = (method, args = []) => opened.evaluate(({ method, json }) => window.__cookiesBridge.fixture(method, json), { method, json: JSON.stringify(args) });
const success = async (method, args = []) => { const result = await invoke(method, args); assert.equal(result.ok, true, method + ': ' + result.code); return result.value; };
try {
  writeFileSync(join(frozen, 'cookies-native-bridge.js'), bridge);
  await boot(frozen, 'baseline'); evidence.version = opened.version;
  const baseline = await success('access'); assert.equal(baseline.status, 'permission-required');
  await until(() => opened.evaluate(() => document.querySelector('[data-cookies-grant]')?.disabled === false), 'explicit optional grant control');
  assert.equal(await opened.evaluate(() => document.querySelectorAll('[data-cookies-record]').length), 0);
  check('production optional access remains ungranted; opening Cookies does not create a native cookie snapshot');
  await opened.close(); opened = null;

  phase = 'owned permission fixture';
  const extension = join(run, 'permission-fixture'); cpSync(frozen, extension, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(extension, 'manifest.json')));
  manifest.optional_permissions = manifest.optional_permissions.filter(value => value !== 'cookies'); manifest.permissions.push('cookies');
  writeFileSync(join(extension, 'manifest.json'), JSON.stringify(manifest, null, 2));
  evidence.fixtureManifestHash = hash(readFileSync(join(extension, 'manifest.json')));
  await boot(extension, 'native');
  const access = await success('access'); assert.equal(access.status, 'ready'); assert.ok(access.stores.length);
  const storeId = access.stores[0].id, domain = 'owned-cookie.example.com', now = Math.floor(Date.now() / 1000);
  const fixturePath = browser === 'chrome' ? '/private%3Fliteral%23fragment/encoded/' : '/private?literal#fragment/../';
  evidence.capabilities = access.capabilities; evidence.stores = access.stores;
  const base = { name: 'owned-base', value: 'OWNED_COOKIE_VALUE', domain, path: '/', hostOnly: true, secure: true, httpOnly: true,
    sameSite: 'lax', session: true, expirationDate: null, storeId: 'source-store', partitionKey: null, firstPartyDomain: null };
  const records = [base, { ...base, name: 'owned-empty', value: '' }, { ...base, name: 'owned-insecure', secure: false, httpOnly: false }, { ...base, name: 'owned-persistent', session: false, expirationDate: now + 3600.125 },
    { ...base, name: 'owned-domain', domain: '.example.com', hostOnly: false },
    { ...base, name: 'owned-path', path: fixturePath, value: '%D0%BA+%2F%25' },
    { ...base, name: 'owned-path', path: '/', value: 'different-root-value' },
    { ...base, name: 'owned-partition', sameSite: 'no_restriction', partitionKey: { topLevelSite: 'https://example.com', hasCrossSiteAncestor: false } }];
  records.push({ ...base, name: 'owned-partition', sameSite: 'no_restriction', partitionKey: { topLevelSite: 'https://example.com', hasCrossSiteAncestor: true } });
  if (access.capabilities.unspecifiedSameSite !== false) records.push({ ...base, name: 'owned-unspecified', sameSite: 'unspecified' });
  if (browser === 'firefox') records.push({ ...base, name: 'owned-fpi', firstPartyDomain: 'example.org' });
  const document = (await fixture('export', [records, { browser: 'unknown' }])).text;
  const unmapped = await success('prepareImport', [document]); assert.equal(unmapped.errors.length, records.length);
  assert.equal((await fixture('native', ['getAll', { domain: 'example.com', storeId, partitionKey: {}, ...(browser === 'firefox' ? { firstPartyDomain: null } : {}) }])).length, 0);
  const preview = await success('updateImport', [unmapped.token, { storeMap: { 'source-store': storeId }, policy: 'skip' }]);
  assert.deepEqual(preview.errors, []); assert.equal(JSON.stringify(preview).includes('OWNED_COOKIE_VALUE'), false);
  const applied = await success('applyImport', [preview.token]); assert.equal(applied.failed, 0, JSON.stringify(applied)); assert.equal(applied.applied, records.length);
  check('whole-file preview requires target-store mapping and writes nothing; native Apply preserves session/persistent, empty, HttpOnly, SameSite, domain and deep literal paths');

  phase = 'native snapshot and portable roundtrip';
  let snapshot = await success('load', [{ storeId, domain: 'example.com' }]); assert.equal(snapshot.count, records.length); assert.equal(snapshot.truncated, false);
  assert.equal(JSON.stringify(snapshot).includes('OWNED_COOKIE_VALUE'), false); assert.equal(snapshot.rows.some(row => Object.hasOwn(row, 'value')), false);
  const exported = await success('prepareExport', [snapshot.token]); const parsed = await fixture('parse', [exported.text]);
  assert.equal(parsed.cookies.length, records.length); assert.equal(parsed.cookies.find(row => row.name === 'owned-empty').value, '');
  assert.equal(parsed.cookies.find(row => row.name === 'owned-path' && row.path !== '/').path, fixturePath);
  const partitioned = parsed.cookies.filter(row => row.name === 'owned-partition'); assert.equal(partitioned.length, 2);
  assert.deepEqual(partitioned.map(row => row.partitionKey.hasCrossSiteAncestor).sort(), [false, true]);
  if (browser === 'firefox') assert.equal(parsed.cookies.find(row => row.name === 'owned-fpi').firstPartyDomain, 'example.org');
  evidence.nativePartitionKeys = partitioned.map(row => row.partitionKey);
  assert.deepEqual(await fixture('crypto', [exported.text]), { same: true, plain: false });
  const unsafeDomain = (await fixture('export', [[{ ...base, domain: '.com', hostOnly: false }], { browser: 'unknown' }])).text;
  const domainPreview = await success('prepareImport', [unsafeDomain, { storeMap: { 'source-store': storeId } }]); assert.equal(domainPreview.errors[0]?.code, 'invalid-domain');
  if (access.capabilities.unspecifiedSameSite === false) {
    const unavailable = (await fixture('export', [[{ ...base, name: 'owned-unspecified', sameSite: 'unspecified' }], { browser: 'unknown' }])).text;
    const unsupported = await success('prepareImport', [unavailable, { storeMap: { 'source-store': storeId } }]); assert.equal(unsupported.errors.length, 1);
    assert.equal((await invoke('applyImport', [unsupported.token])).ok, false, 'an unsupported SameSite state is never rewritten as None');
  }
  if (browser === 'chrome') {
    const unsafePath = (await fixture('export', [[{ ...base, name: 'owned-path', path: '/private?literal#fragment/encoded/' }], { browser: 'unknown' }])).text;
    const pathPreview = await success('prepareImport', [unsafePath, { storeMap: { 'source-store': storeId }, policy: 'overwrite' }]); assert.equal(pathPreview.errors[0]?.code, 'invalid-path');
    assert.equal((await invoke('applyImport', [pathPreview.token])).ok, false);
  }
  snapshot = await success('load', [{ storeId: '*', domain: 'example.com' }]); assert.equal(snapshot.count, records.length);
  assert.equal((await success('prepareExport', [snapshot.token])).text, exported.text, 'rejected native aliases cannot overwrite a canonical sibling');
  const deleted = await success('remove', [snapshot.rows.map(row => row.id)]); assert.equal(deleted.applied, records.length);
  const empty = await success('load', [{ storeId, domain: 'example.com' }]); assert.equal(empty.count, 0);
  const restore = await success('prepareImport', [exported.text, { storeMap: { [storeId]: storeId } }]);
  assert.equal((await success('applyImport', [restore.token])).applied, records.length);
  snapshot = await success('load', [{ storeId, domain: 'example.com' }]); const roundtrip = await success('prepareExport', [snapshot.token]); assert.equal(roundtrip.text, exported.text);
  check('native backup/delete/restore returns the identical deterministic JSON including CHIPS isolation and Firefox FPI; WebCrypto encrypted file roundtrip stays local');

  phase = 'edit and optimistic conflicts';
  let row = snapshot.rows.find(row => row.name === 'owned-base'); assert.equal(await success('reveal', [row.id]), 'OWNED_COOKIE_VALUE');
  const edited = await success('describe', [row.id]); edited.value = 'OWNED_EDITED_VALUE'; assert.equal((await success('save', [row.id, edited])).applied, 1);
  assert.equal((await success('undo')).applied, 1);
  snapshot = await success('load', [{ storeId, domain: 'example.com' }]); row = snapshot.rows.find(row => row.name === 'owned-base');
  await fixture('native', ['set', { url: 'https://' + domain + '/', name: 'owned-base', value: 'EXTERNAL_FIXTURE_CHANGE', path: '/', secure: true, httpOnly: true, sameSite: 'lax', storeId }]);
  const stale = await invoke('reveal', [row.id]); assert.equal(stale.ok, false); assert.equal(stale.code, 'conflict');
  const bad = await invoke('prepareImport', [document.replace('"formatVersion": 1', '"formatVersion": 99'), { storeMap: { 'source-store': storeId } }]); assert.equal(bad.ok, false);
  check('explicit reveal/edit and conflict-aware undo work; external native edits and incompatible file versions reject without writes');

  phase = 'foreign formats';
  const foreign = JSON.stringify([{ name: 'owned-editor', value: '', domain, path: '/', hostOnly: true, secure: true, httpOnly: false, sameSite: 'lax', session: true, storeId: 'foreign' }]);
  const fp = await success('prepareImport', [foreign, { storeMap: { foreign: storeId } }]); assert.equal((await success('applyImport', [fp.token])).applied, 1);
  const ns = '# Netscape HTTP Cookie File\n#HttpOnly_' + domain + '\tFALSE\t/\tTRUE\t0\towned-netscape\tvalue with spaces\n';
  const np = await success('prepareImport', [ns, { storeMap: { import: storeId } }]);
  if (access.capabilities.unspecifiedSameSite === false) {
    assert.equal(np.errors[0]?.code, 'unsupported-samesite'); assert.equal((await invoke('applyImport', [np.token])).ok, false);
    assert.equal((await fixture('native', ['getAll', { domain, name: 'owned-netscape', storeId }])).length, 0);
  } else assert.equal((await success('applyImport', [np.token])).applied, 1);
  check('Cookie-Editor JSON imports natively; Netscape imports when its unspecified SameSite state is representable and otherwise rejects before writing');

  phase = 'lifecycle';
  snapshot = await success('load', [{ storeId, domain: 'example.com' }]); await success('setActive', [false]); await success('setActive', [true]);
  assert.equal((await invoke('prepareExport', [snapshot.token])).ok, false);
  check('leaving workspace invalidates value-bearing snapshots, previews and undo references');

  phase = 'actual workspace controls';
  const ready = () => opened.evaluate(() => document.querySelector('[data-cookies-workspace]')?.getAttribute('aria-busy') === 'false');
  await until(ready, 'workspace ready');
  await opened.fill('[data-cookies-domain]', 'example.com');
  await opened.click('[data-cookies-load]');
  await until(() => opened.evaluate(() => Boolean(document.querySelector('[data-cookies-count]'))), 'native table loaded');
  assert.equal(await opened.evaluate(() => document.body.textContent.includes('EXTERNAL_FIXTURE_CHANGE')), false);
  await opened.click('[data-cookies-create]'); await until(() => opened.evaluate(() => Boolean(document.querySelector('[data-cookies-dialog="editor"]'))), 'create editor');
  await opened.fill('[data-cookies-field="name"]', 'owned-ui-cookie'); await opened.fill('[data-cookies-field="domain"]', domain); await opened.fill('[data-cookies-field="value"]', 'OWNED_UI_VALUE');
  await opened.click('[data-cookies-save]'); await until(() => opened.evaluate(() => !document.querySelector('[data-cookies-dialog]') && Boolean(document.querySelector('[data-cookies-result]'))), 'native UI save');
  await opened.click('[data-cookies-load]'); await until(ready, 'refresh after UI save');
  await opened.fill('[data-cookies-search]', 'owned-ui-cookie');
  const uiRow = await until(() => opened.evaluate(() => document.querySelector('[data-cookies-record]')?.getAttribute('data-cookies-record') ?? null), 'created UI row');
  await opened.click('[data-cookies-reveal="' + uiRow + '"]');
  await until(() => opened.evaluate(() => document.querySelector('[data-cookies-value]')?.textContent === 'OWNED_UI_VALUE'), 'explicit UI reveal');
  await opened.click('[data-cookies-edit="' + uiRow + '"]');
  await until(() => opened.evaluate(() => Boolean(document.querySelector('[data-cookies-dialog="editor"]'))), 'UI edit');
  // The dialog intentionally schedules its initial focus on the next animation frame.
  // Let that focus settle before Playwright's empty-value keyboard action can be redirected.
  await opened.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
  assert.equal(await opened.evaluate(() => document.querySelector('[data-cookies-field="name"]').disabled), true);
  await opened.fill('[data-cookies-field="value"]', ''); await opened.click('[data-cookies-field="secure"]');
  assert.equal(await opened.evaluate(() => document.querySelector('[data-cookies-field="value"]').value), '', 'empty edit remains after the next field change');
  await opened.click('[data-cookies-save]');
  await until(() => opened.evaluate(() => !document.querySelector('[data-cookies-dialog]')), 'UI edit saved');
  const uiEdited = (await fixture('native', ['getAll', { domain, name: 'owned-ui-cookie', storeId }]))[0]; assert.equal(uiEdited.value, ''); assert.equal(uiEdited.secure, false);
  await opened.click('[data-cookies-load]'); await until(ready, 'UI export refresh');
  await opened.click('[data-cookies-export]'); await opened.click('[data-cookies-export-prepare]');
  await until(() => opened.evaluate(() => Boolean(document.querySelector('[data-cookies-export-preview] textarea'))), 'exact export preview');
  const actualPreview = await opened.evaluate(() => document.querySelector('[data-cookies-export-preview] textarea').value);
  assert.equal(JSON.parse(actualPreview).cookies.find(row => row.name === 'owned-ui-cookie').value, '');
  const downloadFile = join(opened.downloadDirectory, 'detect-expert-cookies.json');
  if (browser === 'chrome') {
    const pending = opened.context.waitForEvent('download'); await opened.click('[data-cookies-download]'); const download = await pending; await download.saveAs(downloadFile);
  } else { await opened.click('[data-cookies-download]'); await until(() => existsSync(downloadFile), 'native Firefox JSON download'); }
  assert.equal(readFileSync(downloadFile, 'utf8'), actualPreview, 'download is byte-identical to the confirmed preview');
  await opened.click('[data-cookies-cancel]');
  await opened.click('[data-cookies-import]');
  const uiImport = (await fixture('export', [[{ ...base, name: 'owned-ui-import' }], { browser: 'unknown' }])).text;
  await opened.fill('[data-cookies-import-text]', uiImport); await opened.click('[data-cookies-import-prepare]');
  await until(() => opened.evaluate(() => Boolean(document.querySelector('[data-cookies-import-preview]'))), 'UI import preview');
  assert.equal((await fixture('native', ['getAll', { domain, name: 'owned-ui-import', storeId }])).length, 0);
  await opened.evaluate(storeId => { const select = document.querySelector('[data-cookies-map-store="source-store"]'); select.value = storeId; select.dispatchEvent(new Event('change', { bubbles: true })); }, storeId);
  await until(() => opened.evaluate(() => document.querySelector('[data-cookies-import-apply]')?.disabled === false), 'mapped UI import');
  await opened.click('[data-cookies-import-apply]'); await until(() => opened.evaluate(() => !document.querySelector('[data-cookies-dialog]')), 'UI import applied');
  assert.equal((await fixture('native', ['getAll', { domain, name: 'owned-ui-import', storeId }])).length, 1);
  await opened.fill('[data-cookies-search]', ''); await opened.click('[data-cookies-load]'); await until(ready, 'final UI data');
  await until(() => opened.evaluate(() => document.querySelector('[data-cookies-export]')?.disabled === false), 'settled export availability');
  await opened.screenshot(join(run, 'cookies-populated.png'));
  check('actual Cookies controls create/reveal/edit an empty value, lock identity, download byte-identical JSON and apply a mapped import only after confirmation');

  phase = 'localized UI';
  for (const locale of PRODUCTION_LANGUAGES) {
    await opened.evaluate(async locale => { const api = globalThis.browser ?? globalThis.chrome; await api.storage.local.set({ 'ui-language-v1': locale }); }, locale.id);
    await until(() => opened.evaluate(expected => (document.querySelector('[data-management-shell]')?.lang ?? document.documentElement.lang).toLowerCase() === expected, locale.id.replace('_', '-').toLowerCase()), 'locale ' + locale.id);
    const unresolved = await opened.evaluate(() => /cookies_workspace_|browser_debug_|management_tab_cookies/.test(document.body.textContent)); assert.equal(unresolved, false, locale.id);
    evidence.locales.push(locale.id);
  }
  for (const locale of ['ru', 'ar']) {
    await opened.evaluate(async locale => { const api = globalThis.browser ?? globalThis.chrome; await api.storage.local.set({ 'ui-language-v1': locale }); }, locale);
    for (const theme of browser === 'chrome' ? ['light', 'dark'] : ['dark']) for (const width of [1180, 580, 340]) {
      await opened.media({ colorScheme: theme });
      await opened.viewport(width, 900); await until(() => opened.evaluate(() => document.readyState === 'complete'), 'layout');
      const layout = await opened.evaluate(() => ({ width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1, direction: document.documentElement.dir, dark: matchMedia('(prefers-color-scheme: dark)').matches }));
      assert.equal(layout.width, width); assert.equal(layout.dark, theme === 'dark'); assert.equal(layout.overflow, false, locale + ':' + width); evidence.layouts.push({ locale, theme, ...layout });
    }
  }
  await opened.screenshot(join(run, 'cookies-ar-narrow.png'));
  check('Cookies navigation and workspace resolve all21 locales and fit Russian/Arabic desktop and narrow layouts');
  evidence.result = 'PASS'; console.log('PASS Cookies ' + browser + ' native: ' + evidence.checks.length + ' checks');
} catch (error) { evidence.result = 'FAIL'; evidence.phase = phase; evidence.error = error.message; throw error; }
finally {
  try { if (opened) await opened.close(); } finally {
    writeEvidence('cookies-workspace/' + browser + '.json', evidence);
  }
}
