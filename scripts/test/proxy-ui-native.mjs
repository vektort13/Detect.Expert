// ADR-070 / E22-25 + ADR-103 round 5: real Options Proxy controls in disposable browser profiles (the redesigned manager: ARIA grid,
// details panel, Add sheet, selection bar, disclosure sections). Looks, contrast and keyboard-only use are proxy-ui-visual-native.mjs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { stageExtension } from './native-evidence.mjs';
import { join, resolve } from 'node:path';
import { launchOwnedManagement, until } from './management-browser-fixture.mjs';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';
import { PROXY_WORKSPACE_MESSAGES } from '../production-locales-proxy.mjs';

const root = resolve(import.meta.dirname, '../..'), browser = process.argv.includes('--firefox') ? 'firefox' : 'chrome';
const files = ['proxy-ui.js','proxy-ui-model.js','proxy-ui-icons.js','proxy-list-ui.js','proxy-peek-ui.js','proxy-sheet-ui.js','proxy-route-ui.js','proxy-ui.css','proxy-history.js','identity-bundles.js','fingerprint-region-data.js','fingerprint-region-names.js','proxy-client.js','proxy-shared.js','proxy-service.js','proxy-privacy.js','webrtc-network-controller.js','management-ui.js','management-ui.css','management-navigation.js','options.html','options.js','options.css','manifest.json'];
mkdirSync(join(root, '.tmp'), { recursive: true });
// `--extension <dir>` checks an unpacked candidate instead of dist; its evidence
// and screenshots then stay in the run folder, never the release evidence paths. `--from-source` assembles the package from
// apps/production-extension (the locales as they are in the tree) and keeps its evidence in the run folder as well.
const overrideIndex = process.argv.indexOf('--extension'), override = overrideIndex > 0 && process.argv[overrideIndex + 1] ? resolve(process.argv[overrideIndex + 1]) : null;
const fromSource = process.argv.includes('--from-source'), privateRun = Boolean(override) || fromSource;
const run = mkdtempSync(join(root, '.tmp/proxy-ui-' + browser + '-')), frozen = join(run, 'frozen'), screenshots = privateRun ? join(run, 'screenshots') : join(root, 'test-results/prod/reports/2026-10-21-proxy');
if (override) cpSync(override, frozen, { recursive: true }); else await stageExtension({ browser, target: frozen, from: fromSource ? 'source' : 'dist' });
mkdirSync(screenshots, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const evidence = { at: new Date().toISOString(), browser, run, extensionSource: override ? 'override' : fromSource ? 'source' : 'dist', result: 'RUNNING', rawUserDataRead: false, disposableProfile: true, externalConnectionAttempted: false,
  hashes: Object.fromEntries(files.map(file => [file, hash(readFileSync(join(frozen, file)))])), checks: [], layouts: [], locales: [], screenshots: [] };
const check = text => { evidence.checks.push(text); console.log('  ok ' + text); };
let opened, phase = 'startup';
const ready = () => until(() => opened.evaluate(() => document.querySelector('[data-proxy-workspace]')?.getAttribute('aria-busy') === 'false' && document.querySelector('[data-proxy-new]')?.disabled === false), 'Proxy metadata ready');
const edit = key => '[data-proxy-field="' + key + '"]';
// The sections under the route card are disclosures: "profiles" means all of them closed, the list alone.
async function selectPanel(panel) {
  if (panel === 'profiles') {
    const open = await opened.evaluate(() => document.querySelector('[data-proxy-panel][aria-expanded="true"]')?.dataset.proxyPanel ?? null);
    if (open) await opened.click('[data-proxy-panel="' + open + '"]');
    await until(() => opened.evaluate(() => !document.querySelector('[data-proxy-panel-body]')), 'Proxy panels closed'); return;
  }
  const expanded = await opened.evaluate(panel => document.querySelector('[data-proxy-panel="' + panel + '"]')?.getAttribute('aria-expanded') === 'true', panel);
  if (!expanded) await opened.click('[data-proxy-panel="' + panel + '"]');
  await until(() => opened.evaluate(panel => Boolean(document.querySelector('[data-proxy-panel-body="' + panel + '"]')), panel), 'Proxy panel ' + panel);
}
// ADR-103 removed the workspace subtitle; the routing radio label of the route card is the one rendered string that differs in all
// 21 catalogs (zh_CN and wuu share the rest).
async function setLocale(locale) {
  await opened.evaluate(async locale => { const api = globalThis.browser ?? globalThis.chrome; await api.storage.local.set({ 'ui-language-v1': locale }); }, locale);
  await until(() => opened.evaluate(expected => document.querySelector('[data-proxy-route-mode="include"]')?.closest('label')?.textContent.trim() === expected, PROXY_WORKSPACE_MESSAGES[locale].proxy_workspace_selected_domains), 'Proxy locale ' + locale);
}
const stored = () => opened.evaluate(async () => { const api = globalThis.browser ?? globalThis.chrome; return (await api.storage.local.get('proxy-configuration:v1'))['proxy-configuration:v1'] ?? null; });
const noCanaries = () => opened.evaluate(() => ![...document.querySelectorAll('input,textarea')].some(field => /OWNED_UI_PASSWORD|OWNED_CONFIG_CANARY|OWNED_PRIVATE_QUERY|5e7b5c1f/.test(field.value)));
// The same without the private test address, which belongs to the analyzer and lives until the page is left.
const noCredentials = () => opened.evaluate(() => ![...document.querySelectorAll('input,textarea')].some(field => /OWNED_UI_PASSWORD|OWNED_CONFIG_CANARY|5e7b5c1f/.test(field.value)));
async function capture(file) {
  await opened.evaluate(async () => { document.activeElement?.blur?.(); window.scrollTo(0, 0); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); return true; });
  assert.equal(await opened.evaluate(() => scrollY), 0, 'screenshots start at the top so sticky navigation cannot leave an earlier scroll-position artifact');
  const path = join(screenshots, file); await opened.screenshot(path); evidence.screenshots.push({ file, sha256: hash(readFileSync(path)), scrollY: 0 });
}
const sheetOpen = () => opened.evaluate(() => { const dialog = document.querySelector('dialog[data-proxy-editor]'); return Boolean(dialog?.open); });
const closeSheet = async () => { await opened.click('[data-proxy-cancel]'); await until(() => opened.evaluate(() => !document.querySelector('[data-proxy-editor]')), 'sheet closed'); };
const openSheet = async type => { await opened.click('[data-proxy-new]'); await until(sheetOpen, 'Add sheet'); if (type && type !== 'socks5') await opened.click('[data-proxy-type-option="' + type + '"]'); await until(() => opened.evaluate(type => document.querySelector('[data-proxy-editor]')?.getAttribute('data-proxy-editor') === (type || 'socks5'), type), 'sheet kind ' + (type || 'socks5')); };
const openAddMenuItem = async hook => { await opened.click('[data-proxy-menu="add"]'); await opened.click(hook); };
const rowCount = () => opened.evaluate(() => document.querySelectorAll('[data-proxy-profile]').length);
// What the browser tells the page when its tab goes to the background: visibilityState "hidden" and a visibilitychange event. The
// override makes the page's own handler run exactly as it does for a real tab switch (a second window does not hide this tab).
async function hidePage() {
  await opened.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); return true; });
  await until(() => opened.evaluate(() => !document.querySelector('[data-proxy-editor]') && document.querySelector('[data-proxy-workspace]')?.getAttribute('aria-busy') !== 'true'), 'page hidden');
  await opened.evaluate(() => { delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); return true; });
}
try {
  phase = 'production baseline';
  const downloads = join(run, 'downloads');
  opened = await launchOwnedManagement({ root, run, extension: frozen, browser, evidence, dark: browser === 'firefox', downloadDirectory: downloads });
  evidence.version = opened.version;
  await opened.goto(opened.base + 'options.html#proxy'); await ready();
  const tabs = await opened.evaluate(() => [...document.querySelectorAll('[data-management-tab]')].map(tab => tab.dataset.managementTab));
  // ADR-103: the hub leads; Анализ, Защита, Атака, Инструменты (Integrations existed before ADR-103).
  assert.deepEqual(tabs, ['hub','detector','api','firewall','antidetect','autosurf','cookies','proxy','integrations','settings','contacts']);
  assert.equal(await opened.evaluate(() => document.querySelector('[data-management-tab="proxy"]').getAttribute('aria-selected')), 'true');
  assert.equal(await opened.evaluate(() => document.querySelector('[data-proxy-state]').dataset.proxyState), 'off');
  await selectPanel('analyzer');
  assert.equal(await opened.evaluate(() => document.querySelector('[data-proxy-check]')?.disabled), true);
  assert.equal(await opened.evaluate(() => document.querySelector('[data-proxy-check-target]')?.value), 'https://api.ipify.org/?format=json');
  await opened.evaluate(() => { document.querySelector('[data-proxy-check]').click(); return true; });
  const before = await stored(); assert.ok(before === null || before.enabled === false);
  const nativeGranted = await opened.evaluate(() => (globalThis.browser ?? globalThis.chrome).permissions.contains({ permissions: ['nativeMessaging'] })); assert.equal(nativeGranted, false);
  await selectPanel('companion'); assert.equal(await opened.evaluate(() => Boolean(document.querySelector('[data-proxy-companion-check]'))), true);
  assert.equal(await opened.evaluate(() => (globalThis.browser ?? globalThis.chrome).permissions.contains({ permissions: ['nativeMessaging'] })), false);
  assert.deepEqual(await stored(), before);
  await selectPanel('profiles');
  check('unmodified production manifest opens Proxy between Cookies and Contacts, remains OFF with explicit analyzer disabled and leaves optional native access ungranted without configuration changes');

  phase = 'empty state and native metadata Save';
  const empty = await opened.evaluate(() => ({ manager: Boolean(document.querySelector('[data-proxy-manager]')), grid: Boolean(document.querySelector('[data-proxy-table]')), actions: ['data-proxy-empty-new', 'data-proxy-empty-bulk', 'data-proxy-empty-file'].map(hook => Boolean(document.querySelector('[' + hook + ']'))), batchDisabled: document.querySelector('[data-proxy-check-visible]')?.disabled }));
  assert.deepEqual(empty, { manager: true, grid: false, actions: [true, true, true], batchDisabled: true });
  await openSheet();
  const kinds = await opened.evaluate(() => [...document.querySelectorAll('[data-proxy-type-option]')].map(button => ({ type: button.dataset.proxyTypeOption, checked: button.getAttribute('aria-checked'), path: button.querySelector('svg path')?.getAttribute('d') })));
  assert.deepEqual(kinds.map(kind => kind.type), ['socks5','http','https','vless','openvpn']); assert.equal(new Set(kinds.map(kind => kind.path)).size, 5, 'a distinct glyph for each kind'); assert.ok(kinds.every(kind => kind.path)); assert.deepEqual(kinds.map(kind => kind.checked), ['true','false','false','false','false']);
  evidence.protocolCards = kinds;
  for (const [key, value] of Object.entries({ name: 'Owned Proxy UI', host: '127.0.0.1', port: '19081' })) await opened.fill(edit(key), value);
  await opened.click('[data-proxy-save-profile]');
  await until(() => opened.evaluate(() => !document.querySelector('[data-proxy-editor]') && document.querySelector('[data-proxy-profile]')), 'profile saved'); await ready();
  const saved = await stored(), profile = saved.profiles.find(profile => profile.name === 'Owned Proxy UI'); assert.ok(profile);
  assert.deepEqual(Object.keys(profile).sort(), ['id','name','type','host','port','native'].sort()); assert.equal(profile.host, '127.0.0.1'); assert.equal(profile.port, 19081); assert.equal(profile.native, false); assert.equal(saved.enabled, false); assert.equal(saved.killSwitch, true);
  assert.equal(await opened.evaluate(() => document.querySelector('[data-proxy-state]').dataset.proxyState), 'off');
  const grid = await opened.evaluate(() => { const table = document.querySelector('[data-proxy-table]'); return { role: table.getAttribute('role'), heads: table.querySelectorAll('[role="columnheader"]').length, rows: table.querySelectorAll('[role="row"]').length, copy: Boolean(document.querySelector('[data-proxy-list-menu]')), batch: Boolean(document.querySelector('[data-proxy-check-visible]')), sort: Boolean(document.querySelector('[data-proxy-sort]')), colcount: table.getAttribute('aria-colcount') }; });
  assert.deepEqual(grid, { role: 'grid', heads: 9, rows: 2, copy: true, batch: true, sort: true, colcount: '9' });
  for (const attr of ['data-proxy-connect', 'data-proxy-check-profile', 'data-proxy-more']) assert.equal(await opened.evaluate(({ attr, id }) => Boolean(document.querySelector('[' + attr + '="' + id + '"]')?.getAttribute('aria-label')), { attr, id: profile.id }), true, attr);
  await opened.click('[data-proxy-more="' + profile.id + '"]');
  for (const attr of ['data-proxy-edit', 'data-proxy-duplicate', 'data-proxy-copy-profile', 'data-proxy-remove']) assert.equal(await opened.evaluate(({ attr, id }) => (document.querySelector('[' + attr + '="' + id + '"]')?.textContent.trim().length ?? 0) > 0, { attr, id: profile.id }), true, attr + ' is a named menu item');
  await opened.click('[data-proxy-edit="' + profile.id + '"]'); await until(sheetOpen, 'edit sheet'); await opened.fill(edit('name'), 'Owned Proxy UI saved'); await opened.click('[data-proxy-save-profile]');
  await until(() => opened.evaluate(() => !document.querySelector('[data-proxy-editor]')), 'renamed profile'); await ready();
  assert.equal((await stored()).profiles[0].name, 'Owned Proxy UI saved');
  await opened.fill('[data-proxy-search]', 'does-not-exist'); await until(async () => (await rowCount()) === 0, 'search without a match'); assert.equal(await opened.evaluate(() => Boolean(document.querySelector('[data-proxy-no-results]'))), true);
  await opened.fill('[data-proxy-search]', ''); await until(async () => (await rowCount()) === 1, 'profile filter cleared');
  check('empty state offers the three ways in; the Add sheet saves metadata, the list is an ARIA grid with nine named columns and accessible row actions in a menu, rename works, and filter/sort/batch/full-JSON controls exist without automatic reads or checks');

  phase = 'secret lifecycle and typed editors';
  await selectPanel('analyzer'); await opened.fill('[data-proxy-check-target]', 'https://owned.example.test/?OWNED_PRIVATE_QUERY=1');
  await openSheet(); await opened.fill(edit('password'), 'OWNED_UI_PASSWORD');
  assert.equal(await opened.evaluate(() => document.querySelector('[data-proxy-field="password"]').type), 'password');
  await opened.click('[data-proxy-reveal="password"]'); assert.equal(await opened.evaluate(() => document.querySelector('[data-proxy-field="password"]').type), 'text', 'the eye toggles only the type');
  await opened.click('[data-proxy-reveal="password"]'); assert.equal(await opened.evaluate(() => document.querySelector('[data-proxy-field="password"]').type), 'password');
  await closeSheet(); assert.equal(await noCredentials(), true, 'Cancel erases the unsaved password'); assert.equal(await opened.evaluate(() => document.querySelector('[data-proxy-check-target]').value), 'https://owned.example.test/?OWNED_PRIVATE_QUERY=1', 'the analyzer address is not a credential and stays until the page is left');
  await openSheet(); await opened.fill(edit('password'), 'OWNED_UI_PASSWORD');
  await opened.evaluate(() => { location.hash = '#contacts'; return true; });
  await until(noCanaries, 'navigating away clears Proxy credentials'); await opened.evaluate(() => { location.hash = '#proxy'; return true; }); await ready();
  assert.equal(await opened.evaluate(() => Boolean(document.querySelector('[data-proxy-editor]'))), false); assert.equal(await noCanaries(), true);
  await selectPanel('routing');
  assert.equal(await opened.evaluate(() => { const field = document.querySelector('[data-proxy-kill-switch]'); return field.checked && field.disabled; }), true);
  assert.equal(await opened.evaluate(() => [...document.querySelectorAll('[data-proxy-domains]')].length), 2);
  await selectPanel('profiles');
  await openSheet('vless');
  const uri = 'vless://5e7b5c1f-8b45-4e1f-9b9d-0eed6882f4cc@relay.example.test:443?encryption=none&security=tls&type=tcp#Owned';
  await opened.fill('[data-proxy-paste]', uri.replace('vless:', 'vless\\:')); await opened.click('[data-proxy-parse]');
  assert.equal(await opened.evaluate(() => document.querySelector('[data-proxy-field="uri"]').type), 'password');
  assert.equal(await opened.evaluate(() => document.querySelector('[data-proxy-field="uri"]').value), uri);
  assert.equal(await opened.evaluate(() => document.querySelector('[data-proxy-paste]').value), '');
  await hidePage(); await until(noCanaries, 'hiding the parent tab clears the VLESS link'); assert.equal(await opened.evaluate(() => Boolean(document.querySelector('[data-proxy-editor]'))), false);
  await ready(); assert.equal(await opened.evaluate(() => document.querySelector('[data-proxy-check-target]')?.value ?? 'https://api.ipify.org/?format=json'), 'https://api.ipify.org/?format=json', 'the private test address is gone as well');
  await openSheet('openvpn');
  await opened.evaluate(() => { const field = document.querySelector('[data-proxy-file]'), transfer = new DataTransfer(); transfer.items.add(new File(['client\ndev tun\nproto udp\nremote vpn.example.test 1194\n# OWNED_CONFIG_CANARY\n'], 'owned.ovpn', { type: 'text/plain' })); field.files = transfer.files; field.dispatchEvent(new Event('change', { bubbles: true })); return true; });
  await until(() => opened.evaluate(() => document.querySelector('[data-proxy-field="config"]').value.includes('OWNED_CONFIG_CANARY')), 'owned .ovpn File read');
  assert.equal(await opened.evaluate(() => document.querySelector('[data-proxy-file]').value), '');
  assert.equal(await opened.evaluate(() => Boolean(document.querySelector('[data-proxy-field="username"]') && document.querySelector('[data-proxy-field="password"]'))), true);
  await opened.evaluate(() => { window.dispatchEvent(new Event('pagehide')); return true; }); await until(noCanaries, 'BFCache pagehide clears the OpenVPN text'); assert.equal(await opened.evaluate(() => Boolean(document.querySelector('[data-proxy-editor]'))), false);
  await opened.evaluate(() => { window.dispatchEvent(new Event('pageshow')); return true; }); await ready();
  assert.equal((await stored()).profiles.length, 1);
  check('real SOCKS/VLESS/OpenVPN editors expose manual credentials, a password eye that only toggles the input type, masked smart-paste and owned .ovpn import; Cancel, navigating away, parent-tab hide and pagehide erase unsaved secrets without creating profiles');

  phase = 'metadata export'; await ready();
  const exportFile = join(downloads, 'Detect.Expert-proxy-profiles.json');
  if (browser === 'chrome') { const pending = opened.context.waitForEvent('download'); await opened.click('[data-proxy-export]'); const download = await pending; await download.saveAs(exportFile); }
  else { await opened.click('[data-proxy-export]'); await until(() => existsSync(exportFile), 'native metadata download'); }
  const exported = readFileSync(exportFile, 'utf8'); assert.deepEqual(JSON.parse(exported), await stored()); assert.doesNotMatch(exported, /OWNED_UI_PASSWORD|OWNED_CONFIG_CANARY|OWNED_PRIVATE_QUERY|5e7b5c1f|"password"|"username"|"uri"|"diagnostic"/);
  check('native JSON download is canonical saved metadata and excludes unsaved passwords, VLESS links and OpenVPN text');

  phase = '21 localized views';
  const unresolved = /proxy_workspace_|browser_debug_|management_tab_proxy|[{](shown|total|done|passed|failed|count|name|time|session)[}]/;
  for (const language of PRODUCTION_LANGUAGES) {
    await setLocale(language.id);
    for (const panel of ['routing','analyzer','companion']) {
      await selectPanel(panel);
      const missing = await opened.evaluate(source => new RegExp(source).test(document.querySelector('[data-proxy-workspace]').textContent), unresolved.source); assert.equal(missing, false, language.id + '/' + panel);
      assert.equal(await opened.evaluate(panel => document.querySelector('[data-proxy-panel="' + panel + '"]').textContent.trim(), panel), PROXY_WORKSPACE_MESSAGES[language.id]['proxy_workspace_' + panel]);
    }
    await selectPanel('profiles');
    const list = await opened.evaluate(() => ({ heads: [...document.querySelectorAll('[data-proxy-table] [role="columnheader"]')].map(head => (head.textContent.trim() || head.querySelector('[aria-label]')?.getAttribute('aria-label') || '')), summary: document.querySelector('[data-proxy-count]')?.textContent.trim() }));
    assert.ok(list.heads.length === 9 && list.heads.every(head => head.length > 0), language.id + ' column names'); assert.equal(list.summary, '1', language.id);
    evidence.locales.push(language.id);
  }
  check('all21 actual catalogs render the Proxy header, the grid column names and the Routing/Analyzer/Companion sections without unresolved localization keys or placeholders');

  phase = 'responsive dark and RTL layouts';
  for (const locale of ['ru', 'ar']) {
    await setLocale(locale); await openSheet('vless');
    for (const theme of browser === 'chrome' ? ['light','dark'] : ['dark']) for (const width of [1180,580,340]) {
      await opened.media({ colorScheme: theme }); await opened.viewport(width, 900);
      const layout = await opened.evaluate(() => ({ width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1, direction: getComputedStyle(document.querySelector('[data-proxy-workspace]')).direction, dark: matchMedia('(prefers-color-scheme: dark)').matches,
        controls: [...document.querySelectorAll('dialog[data-proxy-editor] input,dialog[data-proxy-editor] textarea,dialog[data-proxy-editor] select')].filter(field => field.getClientRects().length).map(field => { const rect = field.getBoundingClientRect(); return { left: rect.left, right: rect.right, width: rect.width }; }) }));
      assert.equal(layout.width, width); assert.equal(layout.overflow, false, locale + '/' + theme + '/' + width); assert.equal(layout.direction, locale === 'ar' ? 'rtl' : 'ltr'); assert.equal(layout.dark, theme === 'dark');
      assert.ok(layout.controls.length > 0 && layout.controls.every(rect => rect.width > 0 && rect.left >= -1 && rect.right <= width + 1), 'form controls fit ' + width); evidence.layouts.push({ locale, theme, ...layout });
      await capture(browser + '-proxy-' + locale + '-' + theme + '-' + width + '.png');
    }
    await closeSheet();
  }
  await selectPanel('routing');
  await capture(browser + '-proxy-routing-ar-dark.png');
  assert.equal((await stored()).enabled, false); assert.equal(await opened.evaluate(() => (globalThis.browser ?? globalThis.chrome).permissions.contains({ permissions: ['nativeMessaging'] })), false);
  await selectPanel('profiles');
  check('Russian/Arabic Add sheets at1180/580/340px fit their fields without horizontal overflow, preserve RTL and render in native dark/light');

  // ADR-070 (UI only): the notice that some proxy types need the separate Windows companion, with a real link to its GitHub download.
  // This browser has no companion and no native access, so the state loads with the companion unknown and the notice is expected. The
  // link is clicked for real only in Chromium and only against a local stub (every github.com request of the browser is answered by the
  // test; nothing reaches the network); Firefox is checked by its attributes alone, because its driver cannot answer a request.
  phase = 'companion download notice';
  const DOWNLOAD_URL = 'https://github.com/vektort13/Detect.Expert/releases/latest';
  const noticeFacts = () => opened.evaluate(() => {
    const notice = document.querySelector('[data-proxy-companion-notice]'), link = notice?.querySelector('a[data-proxy-companion-download="notice"]');
    if (!notice || !link) return null;
    const box = element => { const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height }; };
    const title = notice.querySelector('.pm-companion-notice-title'), body = notice.querySelector('.pm-banner-text'), label = link.querySelector('span:not(.proxy-workspace-sr)'), hint = link.querySelector('.proxy-workspace-sr'), frame = notice.getBoundingClientRect();
    const parts = { title, body, link }, clipped = Object.entries(parts).filter(([, element]) => element.scrollWidth > element.clientWidth + 1).map(([name]) => name);
    const outside = Object.entries({ icon: notice.querySelector('svg'), ...parts }).filter(([, element]) => { const rect = element.getBoundingClientRect(); return rect.left < frame.left - 1 || rect.right > frame.right + 1; }).map(([name]) => name);
    return { count: document.querySelectorAll('[data-proxy-companion-notice]').length, links: document.querySelectorAll('[data-proxy-companion-download="notice"]').length, role: notice.getAttribute('role'), aria: notice.getAttribute('aria-label'),
      title: title.textContent.trim(), body: body.textContent.trim(), label: label.textContent.trim(), hint: hint.textContent.trim(), hintWidth: hint.getBoundingClientRect().width, tag: link.tagName, href: link.getAttribute('href'), origin: link.origin, target: link.target, rel: [...link.relList].sort(),
      direction: getComputedStyle(notice).direction, parent: notice.parentElement?.className, notice: box(notice), link: box(link), master: box(document.querySelector('.pm-master')), list: box(document.querySelector('[data-proxy-manager]')),
      overflow: document.documentElement.scrollWidth - innerWidth, width: innerWidth, clipped, outside };
  });
  function expectNotice(facts, language, width) {
    const messages = PROXY_WORKSPACE_MESSAGES[language], where = language + '/' + width;
    assert.ok(facts, where + ': the notice is on the page'); assert.deepEqual([facts.count, facts.links], [1, 1], where + ': one notice with one link');
    assert.equal(facts.title, messages.proxy_workspace_companion_notice_title, where); assert.equal(facts.body, messages.proxy_workspace_companion_notice, where);
    assert.equal(facts.label, messages.proxy_workspace_companion_download, where); assert.equal(facts.hint, messages.proxy_workspace_companion_new_tab, where); assert.ok(facts.hintWidth <= 1.5, where + ': the new-tab hint is for screen readers only');
    assert.equal(facts.role, 'region', where); assert.equal(facts.aria, messages.proxy_workspace_companion_notice_title, where); assert.equal(facts.parent, 'pm-messages', where + ': it sits in the message stack under the route card');
    assert.deepEqual([facts.tag, facts.href, facts.origin, facts.target, facts.rel], ['A', DOWNLOAD_URL, 'https://github.com', '_blank', ['noopener', 'noreferrer']], where + ': a real link to the pinned address, opened in a new tab without opener or referrer');
    assert.deepEqual(facts.clipped, [], where + ': no clipped text'); assert.deepEqual(facts.outside, [], where + ': nothing sticks out of the card');
    assert.ok(facts.overflow <= 0, where + ': no horizontal scroll (' + facts.overflow + ')'); assert.ok(facts.notice.left >= -1 && facts.notice.right <= facts.width + 1, where + ': the card fits the window');
    assert.equal(facts.direction, ['ar', 'ur'].includes(language) ? 'rtl' : 'ltr', where);
    assert.ok(facts.master.bottom <= facts.notice.top + 1 && facts.notice.bottom <= facts.list.top + 1, where + ': between the route card and the list, overlapping neither');
    assert.ok(facts.link.height >= (width < 700 ? 43.5 : 24) && facts.link.width >= 24, where + ': the link is a usable target (' + Math.round(facts.link.height) + ' px high)');
  }
  await setLocale('en'); await opened.media({ colorScheme: 'light' }); await opened.viewport(1180, 900); await selectPanel('profiles');
  const first = await noticeFacts(); expectNotice(first, 'en', 1180); evidence.companionNotice = first; const storedBefore = await stored();
  assert.equal(await opened.evaluate(() => (globalThis.browser ?? globalThis.chrome).permissions.contains({ permissions: ['nativeMessaging'] })), false, 'showing the notice asks for no permission');
  await capture(browser + '-proxy-companion-notice-en-1180.png');
  if (browser === 'chrome') {
    const context = opened.context, requests = [];
    await context.route('https://github.com/**', route => { requests.push({ url: route.request().url(), headers: route.request().headers() }); return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title><p>stub</p>' }); });
    const pagesBefore = context.pages().length;
    const [popup] = await Promise.all([context.waitForEvent('page', { timeout: 15000 }), opened.click('[data-proxy-companion-download="notice"]')]);
    try {
      await popup.waitForLoadState('domcontentloaded');
      assert.equal(popup.url(), DOWNLOAD_URL, 'the link opens the pinned address'); assert.equal(context.pages().length, pagesBefore + 1, 'in a new tab, not in the Options tab');
      assert.equal(await popup.evaluate(() => window.opener), null, 'the new tab has no opener'); assert.equal(await popup.evaluate(() => document.referrer), '', 'and no referrer');
      assert.deepEqual(requests.map(request => request.url), [DOWNLOAD_URL], 'exactly one request, the one the person asked for'); assert.equal('referer' in requests[0].headers, false);
      assert.ok((await opened.evaluate(() => location.href)).startsWith(opened.base + 'options.html'), 'the Options tab stayed where it was'); assert.equal((await noticeFacts())?.count, 1);
    } finally { await popup.close(); await context.unroute('https://github.com/**'); }
  } else {
    // The attributes above are what the browser acts on; the click itself would leave for the real address.
    assert.equal(await opened.evaluate(() => document.querySelector('a[data-proxy-companion-download="notice"]').matches('a[href][target="_blank"][rel~="noopener"][rel~="noreferrer"]')), true);
  }
  assert.deepEqual(await stored(), storedBefore, 'the notice and its link change nothing that is stored'); assert.equal(storedBefore.enabled, false);
  // Both places of the link: the notice, and the Companion section (which also says where the archive comes from).
  await selectPanel('companion');
  const panelLink = await opened.evaluate(() => { const link = document.querySelector('[data-proxy-panel-body="companion"] a[data-proxy-companion-download="panel"]'); return link ? { href: link.getAttribute('href'), target: link.target, rel: [...link.relList].sort(), install: link.closest('[data-proxy-panel-body]').querySelector('.pm-install li').textContent.trim() } : null; });
  assert.deepEqual({ href: panelLink?.href, target: panelLink?.target, rel: panelLink?.rel }, { href: DOWNLOAD_URL, target: '_blank', rel: ['noopener', 'noreferrer'] });
  assert.ok(panelLink.install.startsWith(PROXY_WORKSPACE_MESSAGES.en.proxy_workspace_companion_install), 'the install step names GitHub Releases'); assert.match(panelLink.install, /GitHub \(Releases\)/);
  await capture(browser + '-proxy-companion-panel-en-1180.png');
  await selectPanel('profiles');
  for (const width of [1180, 340]) {
    await opened.viewport(width, 900);
    for (const language of PRODUCTION_LANGUAGES) { await setLocale(language.id); expectNotice(await noticeFacts(), language.id, width); }
  }
  await setLocale('en'); await opened.viewport(1180, 900);
  check('the companion notice (' + DOWNLOAD_URL + ') shows in the message stack between the route card and the list while the companion is unknown, with its heading, text and one real link that opens a new tab without opener or referrer' + (browser === 'chrome' ? ' (clicked against a local stub: one request, no referer, no opener, the Options tab unchanged)' : ' (attributes only in Firefox)') + '; the Companion section repeats the link; it stores nothing and asks for no permission');
  check('in all 21 actual catalogs the notice renders its own heading, text and link label at 1180 and 340 px with no clipped text, nothing outside its card, no horizontal scroll, the right direction and a 44 px link on the narrow window');
  phase = 'companion notice layouts';
  for (const locale of ['ru', 'ar', 'de']) {
    await setLocale(locale);
    for (const theme of browser === 'chrome' ? ['light', 'dark'] : ['dark']) for (const width of [1180, 580, 340]) {
      await opened.media({ colorScheme: theme }); await opened.viewport(width, 900);
      expectNotice(await noticeFacts(), locale, width);
      await capture(browser + '-proxy-companion-notice-' + locale + '-' + theme + '-' + width + '.png');
    }
  }
  await opened.media({ colorScheme: 'light' }); await opened.viewport(1180, 900); await setLocale('en');
  check('Russian, Arabic and German notices fit 1180/580/340 px in light and dark: wrapped text, the link under the text on the narrow window, mirrored in Arabic');

  // ADR-107: list import dialog, live paste preview, session helper, status chips and honest notes.
  phase = 'list import and list UX'; await setLocale('en'); await opened.media({ colorScheme: 'light' }); await opened.viewport(1180, 900); await selectPanel('profiles');
  await openSheet();
  await opened.fill('[data-proxy-paste]', 'socks5://OWNED_BULK_LOGIN:OWNED_UI_PASSWORD@127.0.0.1:19090');
  await until(() => opened.evaluate(() => /127\.0\.0\.1:19090/.test(document.querySelector('[data-proxy-paste-preview="ok"]')?.textContent ?? '')), 'live paste preview');
  assert.equal(await opened.evaluate(() => /OWNED_BULK_LOGIN|OWNED_UI_PASSWORD/.test(document.querySelector('[data-proxy-workspace]').textContent)), false);
  assert.equal(await opened.evaluate(() => document.querySelector('[data-proxy-field="host"]').value), '');
  await opened.fill(edit('username'), 'OWNED_BULK_LOGIN'); await opened.click('[data-proxy-random-session]');
  await until(() => opened.evaluate(() => /^OWNED_BULK_LOGIN-session-[a-z0-9]{10}$/.test(document.querySelector('[data-proxy-field="username"]').value)), 'random session in the visible format');
  await closeSheet(); await until(noCanaries, 'editor cancel erases the paste and login');
  const listText = ['127.0.0.1:19082 #Bulk direct', '127.0.0.1:19083:OWNED_BULK_LOGIN:OWNED_UI_PASSWORD#X #Bulk auth', '127.0.0.1:19082 #Bulk copy', 'ftp://127.0.0.1:2121'].join('\n');
  const bulkState = () => opened.evaluate(() => { const dialog = document.querySelector('dialog[data-proxy-bulk]'); return dialog ? { step: dialog.dataset.proxyBulk, open: dialog.open, modal: dialog.matches(':modal'), focused: dialog.contains(document.activeElement), rows: [...dialog.querySelectorAll('[data-proxy-bulk-line]')].map(row => row.dataset.state), secret: /OWNED_UI_PASSWORD/.test(dialog.textContent) } : null; });
  await openAddMenuItem('[data-proxy-bulk-open]'); await until(async () => (await bulkState())?.open === true, 'list import dialog');
  let bulk = await bulkState(); assert.equal(bulk.modal, true); assert.equal(bulk.focused, true); assert.equal(bulk.step, 'paste');
  await opened.fill('[data-proxy-bulk-text]', listText); await opened.click('[data-proxy-bulk-parse]');
  await until(async () => (await bulkState())?.step === 'preview', 'list preview'); bulk = await bulkState();
  assert.deepEqual(bulk.rows, ['ready', 'ready', 'duplicate', 'error']); assert.equal(bulk.secret, false);
  // The dialog's own cancel event (Escape) erases the pasted text and parsed rows.
  await opened.evaluate(() => { document.querySelector('dialog[data-proxy-bulk]').dispatchEvent(new Event('cancel', { cancelable: true })); return true; });
  await until(async () => (await bulkState()) === null, 'Escape closes the list import'); assert.equal(await noCanaries(), true);
  await openAddMenuItem('[data-proxy-bulk-open]'); await until(async () => (await bulkState())?.open === true, 'list import reopened');
  await opened.fill('[data-proxy-bulk-text]', ['127.0.0.1:19082 #Bulk direct', '127.0.0.1:19082 #Bulk copy', 'ftp://127.0.0.1:2121', '[::1]:19084 #Bulk v6'].join('\n')); await opened.click('[data-proxy-bulk-parse]');
  await until(async () => (await bulkState())?.step === 'preview', 'direct list preview'); assert.deepEqual((await bulkState()).rows, ['ready', 'duplicate', 'error', 'ready']);
  await opened.click('[data-proxy-bulk-save]'); await until(async () => (await bulkState()) === null && Boolean(await opened.evaluate(() => document.querySelector('[data-proxy-imported="2"]'))), 'list rows saved one by one'); await ready();
  const afterImport = await stored(), bulkProfiles = afterImport.profiles.filter(profile => profile.name.startsWith('Bulk '));
  assert.deepEqual(bulkProfiles.map(profile => [profile.name, profile.host, profile.port, profile.native]).sort(), [['Bulk direct', '127.0.0.1', 19082, false], ['Bulk v6', '::1', 19084, false]]);
  assert.equal(afterImport.enabled, false); assert.equal(await opened.evaluate(() => (globalThis.browser ?? globalThis.chrome).permissions.contains({ permissions: ['nativeMessaging'] })), false);
  await opened.click('[data-proxy-imported-close]');
  await opened.click('[data-proxy-status-chip="pass"]'); await until(async () => (await rowCount()) === 0, 'nothing passed without a check');
  assert.equal(await opened.evaluate(() => Boolean(document.querySelector('[data-proxy-no-results]'))), true);
  await opened.click('[data-proxy-status-chip="unchecked"]'); await until(async () => (await rowCount()) === 3, 'unchecked rows'); await opened.click('[data-proxy-status-chip="all"]');
  assert.equal(await opened.evaluate(() => [...document.querySelectorAll('[data-proxy-health]')].every(cell => cell.dataset.state === 'unknown' && cell.querySelector('svg[data-glyph="unknown"]'))), true);
  // Keyboard structure in the real page: the chip groups and the density switch are toolbars with ONE tab stop each, and the section
  // starts with a skip link that lands on the list.
  assert.deepEqual(await opened.evaluate(() => ['data-proxy-filter', 'data-proxy-status-filter', 'data-proxy-density'].map(name => { const group = document.querySelector('[' + name + ']'), buttons = [...group.querySelectorAll('button')]; return [group.getAttribute('role'), group.getAttribute('aria-orientation'), buttons.length > 1, buttons.filter(button => button.tabIndex === 0).length]; })), [['toolbar', 'horizontal', true, 1], ['toolbar', 'horizontal', true, 1], ['toolbar', 'horizontal', true, 1]], 'each chip group is one tab stop');
  assert.equal(await opened.evaluate(() => { const workspace = document.querySelector('[data-proxy-workspace]'); return workspace.querySelector('button, input, select, textarea, a[href], [tabindex="0"]') === workspace.querySelector('[data-proxy-skip]'); }), true, 'the skip link is the first stop of the section');
  assert.equal(await opened.evaluate(() => { document.querySelector('[data-proxy-skip]').click(); return document.activeElement?.matches('[data-proxy-profile]') === true; }), true, 'the skip link lands on a row of the list');
  for (const width of [580, 340]) {
    await opened.viewport(width, 900); await openAddMenuItem('[data-proxy-bulk-open]'); await until(async () => (await bulkState())?.open === true, 'narrow list import ' + width);
    await opened.fill('[data-proxy-bulk-text]', listText); await opened.click('[data-proxy-bulk-parse]'); await until(async () => (await bulkState())?.step === 'preview', 'narrow preview ' + width);
    const fit = await opened.evaluate(() => { const rect = document.querySelector('dialog[data-proxy-bulk]').getBoundingClientRect(); return { overflow: document.documentElement.scrollWidth > innerWidth + 1, left: rect.left, right: rect.right, width: innerWidth, statusVisible: [...document.querySelectorAll('[data-proxy-bulk-status]')].every(node => { const box = node.getBoundingClientRect(); return box.width > 0 && box.left >= rect.left - 1 && box.right <= rect.right + 1; }) }; });
    assert.equal(fit.overflow, false, 'no page overflow ' + width); assert.ok(fit.left >= -1 && fit.right <= fit.width + 1, 'dialog fits ' + width); assert.equal(fit.statusVisible, true, 'row status visible without sideways scrolling ' + width); evidence.layouts.push({ dialog: true, ...fit });
    await capture(browser + '-proxy-list-import-' + width + '.png');
    await opened.click('[data-proxy-bulk-cancel]'); await until(async () => (await bulkState()) === null, 'narrow cancel ' + width); assert.equal(await noCanaries(), true);
  }
  await opened.viewport(1180, 900);
  await selectPanel('analyzer'); assert.equal(await opened.evaluate(() => Boolean(document.querySelector('[data-proxy-tcp-note]')?.textContent.includes('p0f'))), true);
  await selectPanel('routing'); assert.equal(await opened.evaluate(() => Boolean(document.querySelector('[data-proxy-direct-note]') && document.querySelector('#pm-tile-protectWebRTC-detail')?.textContent.includes('TURN') && document.querySelector('[data-proxy-setting="protectWebRTC"]')?.getAttribute('aria-describedby') === 'pm-tile-protectWebRTC-detail')), true);
  await selectPanel('profiles');
  check('list import is a real modal: preview marks ready/duplicate/error rows without passwords, Escape and Cancel erase the text, direct rows save one by one without native access, status chips/glyphs, live paste preview, random session, honest notes, one tab stop per chip group, a skip link to the list, and 580/340px fit');

  // ---- Round 5: HTTP and HTTPS editors, the country picker, the import type and the saved check history ---------------------------
  // The manual check itself needs the companion (a native permission prompt), so the history is seeded in the real storage key with
  // the stored shape and the real page renders, reads and clears it; the recording path is covered by the unit tests.
  const NL = String.fromCharCode(10), DOT = String.fromCodePoint(0xb7), DASH = String.fromCodePoint(0x2014), HISTORY_KEY = 'proxy-check-history:v1';
  const historyStored = () => opened.evaluate(async key => { const api = globalThis.browser ?? globalThis.chrome; return (await api.storage.local.get(key))[key] ?? null; }, HISTORY_KEY);
  const peekOpen = id => opened.evaluate(id => Boolean(document.querySelector('[data-proxy-peek="' + id + '"]')), id);
  const openPeek = async id => { if (!(await peekOpen(id))) await opened.click('[data-proxy-open="' + id + '"]'); await until(() => peekOpen(id), 'details of ' + id); };
  const seedHistory = async id => {
    const now = Date.now(), hour = 3600000, entry = patch => ({ firstAt: now, lastAt: now, checks: 1, ok: true, code: '', ms: 80, dns: 'ok', tls: 'ok', status: 200, ip: '203.0.113.10', ...patch });
    const seed = { version: 1, enabled: true, items: { [id]: [entry({ firstAt: now - 50 * hour, lastAt: now - 40 * hour, checks: 5 }), entry({ firstAt: now - 30 * hour, lastAt: now - 30 * hour, ok: false, code: 'auth-failed', ms: 0, dns: 'unknown', tls: 'unknown', status: 0, ip: '' }), entry({ firstAt: now - hour, lastAt: now - hour, ip: '203.0.113.11', ms: 123 })] } };
    await opened.evaluate(async ({ key, seed }) => { const api = globalThis.browser ?? globalThis.chrome; await api.storage.local.set({ [key]: seed }); return true; }, { key: HISTORY_KEY, seed });
    await opened.click('[data-management-tab="contacts"]'); await opened.click('[data-management-tab="proxy"]'); await ready();
    // Leaving the tab drops the displayed history; coming back reads the store again, so wait for the footer that shows it is readable.
    await until(() => opened.evaluate(() => Boolean(document.querySelector('[data-proxy-history-footer]'))), 'history read from storage'); await openPeek(id);
    await until(() => opened.evaluate(id => document.querySelectorAll('[data-proxy-history="' + id + '"] [data-proxy-history-entry]').length === 3, id), 'history timeline of ' + id);
    return seed;
  };
  const press = key => opened.evaluate(key => { document.querySelector('[data-proxy-country-input]').dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); return true; }, key);
  const composing = key => opened.evaluate(key => { document.querySelector('[data-proxy-country-input]').dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, isComposing: true })); return true; }, key);
  const countryState = () => opened.evaluate(() => { const input = document.querySelector('[data-proxy-country-input]'); return { value: input.value, expanded: input.getAttribute('aria-expanded'), options: document.querySelectorAll('[data-proxy-country-option]').length, first: document.querySelector('[data-proxy-country-option]')?.dataset.proxyCountryOption ?? null }; });

  phase = 'round 5 HTTP editor and country picker'; await setLocale('en'); await opened.media({ colorScheme: 'light' }); await opened.viewport(1180, 900); await selectPanel('profiles');
  await openSheet('http');
  assert.deepEqual(await opened.evaluate(() => [...document.querySelectorAll('[data-proxy-type-option]')].map(card => card.dataset.proxyTypeOption)), ['socks5','http','https','vless','openvpn']);
  assert.equal(await opened.evaluate(() => document.querySelector('[data-proxy-field="port"]').value), '8080');
  assert.equal(await opened.evaluate(() => /not encrypted/.test(document.querySelector('[data-proxy-type-detail="http"]').textContent) && /CONNECT/.test(document.querySelector('[data-proxy-relay-detail]').textContent)), true);
  for (const [key, value] of Object.entries({ name: 'Owned HTTP proxy', host: '127.0.0.1', port: '19085' })) await opened.fill(edit(key), value);
  await opened.click('[data-proxy-country-input]');
  await until(async () => { const state = await countryState(); return state.expanded === 'true' && state.options > 200; }, 'country list opens with every region');
  await opened.fill('[data-proxy-country-input]', 'germ'); await until(async () => (await countryState()).first === 'DE', 'country search ranks Germany first');
  await opened.fill('[data-proxy-country-input]', 'zzzz'); await until(() => opened.evaluate(() => document.querySelectorAll('[data-proxy-country-option]').length === 0 && /No countries found/.test(document.querySelector('[data-proxy-country-status]').textContent)), 'no result is announced');
  await opened.fill('[data-proxy-country-input]', 'ital'); await until(async () => (await countryState()).first === 'IT', 'search by name');
  await composing('Enter'); assert.equal((await countryState()).expanded, 'true', 'an IME composition never picks');
  await press('Escape'); assert.equal((await countryState()).expanded, 'false'); assert.equal(await sheetOpen(), true, 'Escape on the open list closes the list, not the sheet');
  await opened.fill('[data-proxy-country-input]', 'ital'); await until(async () => (await countryState()).first === 'IT', 'search again'); await press('ArrowDown'); await press('Enter');
  await until(async () => (await countryState()).value === 'Italy ' + DOT + ' IT', 'keyboard pick');
  await opened.click('[data-proxy-country-clear]'); await until(async () => (await countryState()).value === '', 'tag cleared');
  await opened.click('[data-proxy-country-input]'); await opened.fill('[data-proxy-country-input]', 'germ'); await until(async () => (await countryState()).first === 'DE', 'search for Germany');
  await opened.click('[data-proxy-country-option="DE"]'); await until(async () => (await countryState()).value === 'Germany ' + DOT + ' DE', 'pointer pick');
  await opened.click('[data-proxy-save-profile]'); await until(() => opened.evaluate(() => !document.querySelector('[data-proxy-editor]')), 'HTTP profile saved'); await ready();
  const httpProfile = (await stored()).profiles.find(profile => profile.name === 'Owned HTTP proxy'); assert.ok(httpProfile);
  assert.deepEqual(httpProfile, { id: httpProfile.id, name: 'Owned HTTP proxy', type: 'http', host: '127.0.0.1', port: 19085, native: false, country: 'DE' });
  assert.equal(await opened.evaluate(id => document.querySelector('[data-proxy-profile="' + id + '"] [data-proxy-country="DE"]')?.textContent.replace(/\s+/g, ' ').trim(), httpProfile.id), 'DE Germany');
  await opened.fill('[data-proxy-search]', 'de'); await until(() => opened.evaluate(id => Boolean(document.querySelector('[data-proxy-profile="' + id + '"]')), httpProfile.id), 'the tag is searchable by its code'); await opened.fill('[data-proxy-search]', '');
  await opened.click('[data-proxy-more="' + httpProfile.id + '"]'); await opened.click('[data-proxy-edit="' + httpProfile.id + '"]'); await until(() => opened.evaluate(() => document.querySelector('[data-proxy-field="name"]')?.value === 'Owned HTTP proxy'), 'edit opens');
  await opened.click('[data-proxy-country-clear]'); await opened.click('[data-proxy-save-profile]'); await until(() => opened.evaluate(() => !document.querySelector('[data-proxy-editor]')), 'tag-only edit saved'); await ready();
  assert.deepEqual((await stored()).profiles.find(profile => profile.id === httpProfile.id), { id: httpProfile.id, name: 'Owned HTTP proxy', type: 'http', host: '127.0.0.1', port: 19085, native: false });
  assert.equal(await opened.evaluate(() => (globalThis.browser ?? globalThis.chrome).permissions.contains({ permissions: ['nativeMessaging'] })), false, 'a login-free HTTP profile and its tag never ask for the companion');
  check('the HTTP editor prefills 8080, states the unencrypted hop and the CONNECT relay, and the real country combobox filters by name and code, ignores an IME Enter, closes on Escape (the list, not the sheet), picks by keyboard and pointer, clears, and a tag edit saves metadata only');

  phase = 'round 5 import type';
  await openAddMenuItem('[data-proxy-bulk-open]'); await until(async () => (await bulkState())?.open === true, 'import dialog for the type');
  assert.deepEqual(await opened.evaluate(() => [...document.querySelectorAll('[data-proxy-bulk-type] option')].map(option => option.value)), ['socks5','http','https']);
  await opened.evaluate(() => { const select = document.querySelector('[data-proxy-bulk-type]'); select.value = 'https'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; });
  await opened.fill('[data-proxy-bulk-text]', ['127.0.0.1:19086 #Typed TLS', 'http://127.0.0.1:19087 #Explicit HTTP', 'socks5://127.0.0.1:19088 #Explicit SOCKS', 'ftp://127.0.0.1:21'].join(NL)); await opened.click('[data-proxy-bulk-parse]');
  await until(async () => (await bulkState())?.step === 'preview', 'typed preview');
  assert.deepEqual(await opened.evaluate(() => [...document.querySelectorAll('dialog[data-proxy-bulk] [data-proxy-bulk-line]')].map(row => [row.dataset.state, row.querySelector('[data-proxy-type-pill]')?.getAttribute('data-proxy-type-pill') ?? null])), [['ready','https'],['ready','http'],['ready','socks5'],['error',null]]);
  await opened.click('[data-proxy-bulk-save]'); await until(async () => (await bulkState()) === null && Boolean(await opened.evaluate(() => document.querySelector('[data-proxy-imported="3"]'))), 'typed rows saved'); await ready();
  assert.deepEqual((await stored()).profiles.filter(profile => profile.name.startsWith('Typed') || profile.name.startsWith('Explicit')).map(profile => [profile.name, profile.type, profile.port, profile.native]).sort(), [['Explicit HTTP','http',19087,false],['Explicit SOCKS','socks5',19088,false],['Typed TLS','https',19086,false]]);
  assert.equal(await opened.evaluate(() => (globalThis.browser ?? globalThis.chrome).permissions.contains({ permissions: ['nativeMessaging'] })), false);
  await opened.click('[data-proxy-imported-close]');
  check('the import dialog types lines without a scheme (HTTPS here), keeps an explicit http:// or socks5:// line as written, refuses ftp:// and saves login-free rows without the companion');

  phase = 'round 5 saved check history';
  const seed = await seedHistory(httpProfile.id), seededStore = await historyStored(); assert.deepEqual(seededStore, seed);
  assert.equal(await opened.evaluate(id => Boolean(document.querySelector('[data-proxy-ip-changed-summary="' + id + '"]')), httpProfile.id), true, 'the newest stay shows another exit IP than the one before the failure');
  const rows = await opened.evaluate(id => [...document.querySelectorAll('[data-proxy-history="' + id + '"] [data-proxy-history-entry]')].map(row => ({ state: row.dataset.state, ip: row.querySelector('[data-proxy-history-ip]')?.textContent ?? null, ms: row.querySelector('[data-proxy-history-ms]').textContent, status: row.querySelector('[data-proxy-history-status]')?.textContent ?? null, changed: Boolean(row.querySelector('[data-proxy-ip-changed]')), stay: row.querySelector('[data-proxy-history-stay]')?.textContent ?? null, result: row.querySelector('[data-proxy-history-result]').textContent })), httpProfile.id);
  assert.deepEqual(rows.map(row => [row.state, row.ip, row.ms, row.status, row.changed]), [['pass','203.0.113.11','123 ms','HTTP 200',true],['fail',null,DASH,null,false],['pass','203.0.113.10','80 ms','HTTP 200',false]]);
  assert.equal(rows[0].stay, null); assert.match(rows[2].stay, new RegExp('^Same exit IP since .+ ' + DOT + ' checks: 5$')); assert.match(rows[1].result, /Check failed.*auth-failed/);
  assert.equal(await opened.evaluate(id => { const panel = document.querySelector('[data-proxy-peek="' + id + '"]'), title = document.getElementById(panel.getAttribute('aria-labelledby')); return panel.tagName + '/' + panel.getAttribute('role') + '/' + Boolean(title && title.textContent.trim()); }, httpProfile.id), 'ASIDE/region/true', 'the details panel is a labelled region');
  assert.equal(await opened.evaluate(id => [...document.querySelectorAll('[data-proxy-history="' + id + '"] [data-proxy-history-flag]')].every(flag => flag.querySelector('svg') && flag.querySelector('.proxy-workspace-sr').textContent.length > 3), httpProfile.id), true, 'every DNS/TLS flag has a glyph and a spoken sentence');
  assert.equal(await opened.evaluate(id => Boolean(document.querySelector('[data-proxy-peek="' + id + '"] [data-proxy-spark] svg[role="img"][aria-label]')), httpProfile.id), true, 'the latency trend has a text alternative');
  assert.deepEqual(await historyStored(), seededStore, 'looking at the history changes nothing in storage');
  // The switch under the list: off keeps the entries and stops recording; on is back to the default.
  assert.equal(await opened.evaluate(() => document.querySelector('[data-proxy-history-save]').checked), true);
  await opened.click('[data-proxy-history-save]'); await until(async () => (await historyStored())?.enabled === false, 'the switch is stored'); assert.deepEqual((await historyStored()).items, seed.items, 'the entries stay');
  assert.equal(await opened.evaluate(() => document.querySelector('[data-proxy-history-save]').checked), false);
  await opened.click('[data-proxy-history-save]'); await until(async () => (await historyStored())?.enabled === true, 'the switch is back on'); assert.deepEqual(await historyStored(), seed);
  check('seeded in the stored shape, the history renders in the details panel newest first as stays (the same exit IP is one row with its first time and check count), marks the changed exit IP, names its trend for assistive technology and leaves storage untouched while being read');

  phase = 'round 5 history in 21 languages';
  for (const language of PRODUCTION_LANGUAGES) {
    await setLocale(language.id); await openPeek(httpProfile.id); await openSheet('https');
    await until(() => opened.evaluate(() => Boolean(document.querySelector('[data-proxy-country-input]')) && Boolean(document.querySelector('[data-proxy-history]'))), 'editor and history in ' + language.id);
    const probe = await opened.evaluate(id => { const text = document.querySelector('[data-proxy-workspace]').textContent; return { unresolved: /proxy_workspace_|browser_debug_/.test(text) || /[{]time[}]|[{]count[}]/.test(text), title: document.getElementById('proxy-history-title-' + id).textContent.trim(), stay: document.querySelector('[data-proxy-history-stay]')?.textContent ?? '', country: document.querySelector('[data-proxy-country-input]').placeholder, hint: document.querySelector('[data-proxy-country-hint]').textContent }; }, httpProfile.id);
    const messages = PROXY_WORKSPACE_MESSAGES[language.id];
    assert.equal(probe.unresolved, false, language.id); assert.equal(probe.title, messages.proxy_workspace_history_title, language.id); assert.equal(probe.country, messages.proxy_workspace_country_none, language.id); assert.equal(probe.hint, messages.proxy_workspace_country_hint, language.id);
    assert.ok(probe.stay.includes('5') && !probe.stay.includes('{'), language.id + ' stay line: ' + probe.stay);
    await closeSheet();
  }
  await setLocale('en');
  check('in all 21 actual catalogs the HTTPS editor with its country picker and the details panel history render their authored copy, the stay sentence is filled in, and no key or placeholder is left unresolved');

  phase = 'round 5 history layouts';
  for (const locale of ['ru', 'ar']) {
    await setLocale(locale); await openPeek(httpProfile.id);
    for (const theme of browser === 'chrome' ? ['light','dark'] : ['dark']) for (const width of [1180,580,340]) {
      await opened.media({ colorScheme: theme }); await opened.viewport(width, 900);
      const layout = await opened.evaluate(() => { const peek = document.querySelector('[data-proxy-peek]'), list = document.querySelector('[data-proxy-table]'), box = peek.getBoundingClientRect(), side = list.getBoundingClientRect(); return { width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1, direction: getComputedStyle(document.querySelector('[data-proxy-workspace]')).direction, history: Boolean(document.querySelector('[data-proxy-history-table]')), position: getComputedStyle(peek).position, besideList: box.left >= side.right - 1 || box.right <= side.left + 1, inside: box.left >= -1 && box.right <= innerWidth + 1 }; });
      assert.equal(layout.width, width); assert.equal(layout.overflow, false, 'history ' + locale + '/' + theme + '/' + width); assert.equal(layout.direction, locale === 'ar' ? 'rtl' : 'ltr'); assert.equal(layout.history, true); assert.equal(layout.inside, true, 'the details panel stays inside the window');
      if (width >= 1100) assert.equal(layout.besideList, true, 'two panes: the details panel sits beside the list'); else assert.equal(layout.position, 'fixed', 'narrow: the details panel is a sheet over the list');
      evidence.layouts.push({ history: true, locale, theme, ...layout });
      await capture(browser + '-proxy-history-' + locale + '-' + theme + '-' + width + '.png');
    }
  }
  await opened.media({ colorScheme: 'light' }); await opened.viewport(1180, 900); await setLocale('en');
  check('with the details panel and its history open, Russian and Arabic fit 1180/580/340 px in light and dark without horizontal overflow, the panel sits beside the list on wide windows and becomes a sheet on narrow ones, and RTL is kept');

  phase = 'round 5 clearing history';
  await openPeek(httpProfile.id);
  await opened.click('[data-proxy-history-clear="' + httpProfile.id + '"]'); await until(() => opened.evaluate(id => Boolean(document.querySelector('[data-proxy-history-confirm="' + id + '"]')), httpProfile.id), 'confirmation');
  assert.deepEqual(await historyStored(), seed, 'asking changes nothing'); await opened.click('[data-proxy-history-keep]'); assert.deepEqual(await historyStored(), seed);
  await opened.click('[data-proxy-history-clear="' + httpProfile.id + '"]'); await opened.click('[data-proxy-history-clear-confirm="' + httpProfile.id + '"]');
  await until(async () => (await historyStored()) === null, 'the key is gone once nothing is left');
  await until(() => opened.evaluate(id => Boolean(document.querySelector('[data-proxy-history-empty="' + id + '"]')) && /Check history cleared/.test(document.querySelector('[data-proxy-notice]')?.textContent ?? ''), httpProfile.id), 'empty state and notice');
  await seedHistory(httpProfile.id); await opened.click('[data-proxy-history-clear-all]'); await opened.click('[data-proxy-history-clear-confirm="all"]'); await until(async () => (await historyStored()) === null, 'clear all');
  const seededAgain = await seedHistory(httpProfile.id);
  await opened.click('[data-proxy-more="' + httpProfile.id + '"]'); await opened.click('[data-proxy-edit="' + httpProfile.id + '"]'); await until(() => opened.evaluate(() => document.querySelector('[data-proxy-field="name"]')?.value === 'Owned HTTP proxy'), 'edit for rename');
  await opened.fill(edit('name'), 'Owned HTTP renamed'); await opened.click('[data-proxy-save-profile]'); await until(() => opened.evaluate(() => !document.querySelector('[data-proxy-editor]')), 'renamed'); await ready();
  assert.deepEqual(await historyStored(), seededAgain, 'a rename keeps the history');
  await opened.click('[data-proxy-more="' + httpProfile.id + '"]'); await opened.click('[data-proxy-edit="' + httpProfile.id + '"]'); await until(() => opened.evaluate(() => document.querySelector('[data-proxy-field="host"]')?.value === '127.0.0.1'), 'edit for host');
  await opened.fill(edit('host'), '127.0.0.2'); await opened.click('[data-proxy-save-profile]'); await until(() => opened.evaluate(() => !document.querySelector('[data-proxy-editor]')), 'host changed'); await ready();
  await until(async () => (await historyStored()) === null, 'changing the connection clears the history that described the old server');
  await seedHistory(httpProfile.id); await opened.click('[data-proxy-more="' + httpProfile.id + '"]'); await opened.click('[data-proxy-remove="' + httpProfile.id + '"]'); await opened.click('[data-proxy-remove-confirm]'); await until(() => opened.evaluate(id => !document.querySelector('[data-proxy-profile="' + id + '"]'), httpProfile.id), 'profile removed'); await ready();
  await until(async () => (await historyStored()) === null, 'deleting the profile removes its history');
  check('Clear history asks first, clears one profile or all and removes the key when nothing is left; a rename keeps the history, a changed connection or a deleted profile removes it');
  assert.equal(await opened.evaluate(() => (globalThis.browser ?? globalThis.chrome).permissions.contains({ permissions: ['nativeMessaging'] })), false);

  evidence.result = 'PASS'; console.log('PASS Proxy UI ' + browser + ': ' + evidence.checks.length + ' native checks');
} catch (error) { evidence.result = 'FAIL'; evidence.phase = phase; evidence.error = error.message; if (opened) try { await opened.screenshot(join(run, 'failed.png')); } catch {} throw error; }
finally {
  try { if (opened) await opened.close(); } finally { const output = privateRun ? join(run, 'ui-' + browser + '.json') : join(root, 'test-results/production-1.1.0/proxy/ui-' + browser + '.json'); mkdirSync(resolve(output, '..'), { recursive: true }); writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n'); }
}
