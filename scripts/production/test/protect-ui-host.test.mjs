// ADR-047 (S3, port plan §2.5, §5.2): wiring of the module «Защита» islands into the production popup, side panel and
// Options (scripts/production/sync-protect-ui.mjs, U1–U6, H1) and the host factory of protect-ui.js. No browser: the
// rendered islands are checked natively by scripts/test/protect-ui-native.mjs.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { build } from 'esbuild';
import * as sync from '../sync-protect-ui.mjs';

const root = resolve(import.meta.dirname, '../../..');
const ext = join(root, 'apps/production-extension');
const read = (name) => readFileSync(join(ext, name), 'utf8');
const BUNDLES = ['popup.js', 'sidepanel.js', 'options.js'];
const PAGES = ['popup.html', 'sidepanel.html', 'options.html'];

function count(source, needle) {
  return source.split(needle).length - 1;
}

/** The bundle without the S3 insertions (what the backup had at these places). */
function unpatch(name, source) {
  let out = source.replace(sync.PREFIX_MARKER + sync.DEPENDENCY, sync.PREFIX_MARKER).replace(sync.FACTORY, '').replace(sync.GUARD_DEPENDENCY, '');
  out = out.replace(name === 'options.js' ? sync.OPTIONS_TOOLS : sync.INSPECTOR_TOOLS,
    name === 'options.js' ? sync.OPTIONS_LAUNCHER : sync.INSPECTOR_LAUNCHER);
  if (name === 'options.js') {
    out = out.replace(sync.OPTIONS_ISLAND, '').replace(sync.ROUTE + '\n', '').replace(sync.ROOT_AFTER, sync.ROOT_BEFORE);
  } else {
    out = out.replace(sync.INSPECTOR_ISLAND, '');
  }
  return out;
}

test('sync-protect-ui: --check passes and a second run changes nothing', () => {
  const result = spawnSync(process.execPath, [join(root, 'scripts/production/sync-protect-ui.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  for (const name of BUNDLES) assert.equal(sync.patchBundle(name, read(name)), read(name), name);
  for (const name of PAGES) assert.equal(sync.patchPage(name, read(name)), read(name), name);
});

test('sync-protect-ui: the shipped bundles are exactly the unpatched bundles plus U1–U6 (Preact prefix untouched)', () => {
  for (const name of BUNDLES) {
    const shipped = read(name);
    const before = unpatch(name, shipped);
    for (const marker of ['protect-ui.js', 'ProtectIsland', 'ProtectPage', 'isProtectHash', 'ProtectOptionsRoute', 'createProtectHostUi']) assert.equal(before.includes(marker), false, name + ' keeps ' + marker + ' after unpatch');
    assert.equal(sync.patchBundle(name, before), shipped, name);
    const marker = sync.PREFIX_MARKER;
    assert.equal(shipped.slice(0, shipped.indexOf(marker)), before.slice(0, before.indexOf(marker)), name + ': Preact prefix');
    assert.equal(count(shipped, sync.DEPENDENCY), 1, name);
    assert.equal(count(shipped, sync.FACTORY_BEGIN), 1, name);
  }
  // Pages: protect.css is the only addition.
  for (const name of PAGES) assert.equal(sync.patchPage(name, read(name).replace(sync.STYLESHEET, '')), read(name), name);
});

test('insertion points: four guard launchers keep their requested order, report follows, route precedes entrypoint', () => {
  for (const name of ['popup.js', 'sidepanel.js']) {
    const source = read(name);
    const view = source.slice(source.indexOf('function InspectorView('), source.indexOf('\n}\n', source.indexOf('function InspectorView(')));
    assert.ok(view.includes(sync.INSPECTOR_TOOLS + sync.INSPECTOR_ISLAND), name + ': reports follow the shared launcher row');
    assert.ok(view.indexOf(sync.INSPECTOR_ISLAND) < view.indexOf('hidden: mode.mode !== "light"'), name + ': island above the Light panel');
    assert.ok(source.indexOf(sync.FACTORY_ANCHOR) < source.indexOf(sync.FACTORY_BEGIN), name + ': factory after the shared blocking UI');
    assert.ok(source.indexOf(sync.FACTORY_BEGIN) < source.indexOf('function InspectorView('), name + ': factory before the inspector');
    // ADR-103: «Защита» (API Guard, Firewall, DPI Guard) precedes «Атака» (Antidetect).
    const order = ['"data-inspector-tools-group": "defense"', sync.INSPECTOR_LAUNCHER, 'guardLauncherHasFirewall(chrome)', 'u3(DpiGuardLauncher,', '"data-inspector-tools-group": "attack"', 'u3(AntidetectLauncher,'].map(needle => sync.INSPECTOR_TOOLS.indexOf(needle));
    assert.ok(order.every(index => index >= 0), 'every launcher and group label is present');
    assert.deepEqual([...order].sort((a, b) => a - b), order, 'defense group, then attack group');
  }
  const options = read('options.js');
  const app = options.slice(options.indexOf('function ConsentedOptions('), options.indexOf('\n}\n', options.indexOf('function ConsentedOptions(')));
  assert.ok(app.includes(sync.OPTIONS_TOOLS), 'Options: API and Firewall share a launcher row');
  assert.ok(options.indexOf(sync.ROUTE_BEGIN) < options.indexOf(sync.ROUTE_ANCHOR));
  assert.equal(count(options, sync.ROOT_AFTER), 1);
  assert.equal(options.includes(sync.ROOT_BEFORE), false);
  assert.ok(sync.ROUTE.includes('location.replace(chrome.runtime.getURL("options.html") + location.search + "#api")'), 'legacy API entry retains query and redirects before mounting management');
  for (const name of PAGES) {
    const links = [...read(name).matchAll(/<link rel="stylesheet" href="([^"]+)" \/>/g)].map((m) => m[1]);
    const moduleLinks = links.filter(value => !['management-ui.css', 'management-workspaces.css', 'management-navigation-groups.css', 'workspace-controls-ui.css', 'workspace-controls-host.css', 'detector-ui.css', 'detector-pointer-ui.css', 'detector-history-ui.css', 'contacts-ui.css', 'redesign.css', 'theme-picker.css', 'themes.css', 'ui-typography.css', 'external-menu.css'].includes(value));
    assert.equal(moduleLinks.at(-1), 'protect.css', name + ': module style follows shared surfaces');
    assert.equal(moduleLinks.at(-2), 'button-surfaces.css', name);
    assert.equal(count(read(name), 'protect.css'), 1, name);
    const finalStyles = ['theme-picker.css', 'themes.css', 'ui-typography.css', ...(name === 'options.html' ? [] : ['external-menu.css']), 'redesign.css'];
    assert.deepEqual(links.slice(-finalStyles.length), finalStyles, name + ': appearance styles follow module styles');
    assert.equal(links.filter(value => value === 'external-menu.css').length, name === 'options.html' ? 0 : 1, name + ': external styles stay scoped to popup/sidepanel');
    if (name === 'options.html') assert.ok(links.indexOf('management-ui.css') < links.indexOf('management-workspaces.css'));
    else assert.equal(links.includes('management-workspaces.css'), false, name + ': internal workspace styles stay out of popup/sidepanel');
  }
});

test('Options entry delegates to the management shell and legacy API entry redirects before mounting it', () => {
  const route = read('options.js').slice(read('options.js').indexOf(sync.ROUTE_BEGIN), read('options.js').indexOf(sync.ROUTE_END));
  const run = (hash, pathname = '/options.html') => {
    const effects = [];
    const replacements = [];
    const transport = async () => ({ ok: false, code: 'unavailable' });
    const context = vm.createContext({
      location: { hash, pathname, search: '?tabId=17', replace: value => replacements.push(value) },
      chrome: { runtime: { getURL: value => 'chrome-extension://own/' + value } },
      d2: () => [true, () => {}],
      h2: (effect, deps) => effects.push({ effect, deps }),
      u3: (type, props) => ({ type, props }),
      A2: () => {}, useLocale: () => 'en', t3: key => key,
      LanguagePicker: 'LanguagePicker', ProtectionPageApp: 'ProtectionPageApp', ProtectIsland: 'ProtectIsland', ProtectionLauncher: 'ProtectionLauncher',
      OptionsApp: 'OptionsApp', ProtectionSettings: 'ProtectionSettings',
      sendUiRequest: transport,
      createManagementUi: host => {
        assert.equal(host.OptionsApp, 'OptionsApp');
        assert.equal(host.ProtectionPageApp, 'ProtectionPageApp');
        assert.equal(host.ProtectIsland, 'ProtectIsland');
        assert.equal(host.sendUiRequest, transport, 'management receives the existing validated read-only transport');
        return { ManagementApp: 'ManagementApp' };
      },
    });
    vm.runInContext(route + '\nvar result = ProtectOptionsRoute();', context);
    return { result: context.result, effects, replacements };
  };
  for (const hash of ['#protect', '#firewall', '#history', '#requests', '#api', '#contacts', '#settings', '']) assert.equal(run(hash).result.type, 'ManagementApp', hash);
  const legacy = run('', '/protection.html');
  assert.equal(legacy.result, null, 'no module mounts under the old API pathname');
  legacy.effects[0].effect();
  assert.deepEqual(legacy.replacements, ['chrome-extension://own/options.html?tabId=17#api']);
});

/** Fake production host: records the vnodes the factory builds. */
function fakeHost(locale) {
  const effects = [];
  return {
    effects,
    host: {
      h: (type, props, key) => ({ type, props, key }),
      useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
      useEffect: (effect, deps) => effects.push({ effect, deps }),
      useRef: (initial) => ({ current: initial }),
      useLocale: () => locale,
      uiLocale: () => locale,
      translate: (key) => 'production:' + key,
      LanguagePicker: 'LanguagePicker',
    },
  };
}

test('host factory of protect-ui.js: empty container, page header, hash routes, no chrome needed', async () => {
  const ui = await import(pathToFileURL(join(ext, 'protect-ui.js')).href);
  for (const name of ['createProtectHostUi', 'isProtectHash', 'mountIsland', 'mountRequestsPage', 'PROTECT_SURFACES']) assert.ok(name in ui, name);
  assert.deepEqual([...ui.PROTECT_SURFACES], ['popup', 'sidepanel', 'launcher', 'options-launcher', 'options-page']);
  const { host, effects } = fakeHost('ru');
  const made = ui.createProtectHostUi(host);
  assert.deepEqual(Object.keys(made).sort(), ['ProtectIsland', 'ProtectPage', 'isProtectHash']);
  const island = made.ProtectIsland({ surface: 'popup', tabId: 7, openSidePanel: () => {} });
  assert.equal(island.type, 'div');
  assert.equal(island.props.class, 'protect-island');
  assert.equal(island.props['data-protect-island'], 'popup');
  assert.equal(island.props.children, undefined, 'the production page renders the container empty');
  assert.equal(effects.length, 2, 'mount effect + update effect');
  assert.deepEqual(effects[0].deps, ['popup']);
  assert.equal(effects[0].effect(), undefined, 'no element yet: nothing mounted, nothing thrown');
  effects[1].effect();
  for (const hash of ['#protect', '#firewall', '#history', '#requests']) assert.equal(made.isProtectHash(hash), true, hash);
  for (const hash of ['', '#', 'protect', '#protect/x', '#observation', '#PROTECT']) assert.equal(made.isProtectHash(hash), false, hash);

  for (const [locale, title, lang] of [['ru', 'Firewall', 'ru'], ['en', 'Firewall', 'en'], ['de', 'Firewall', 'en']]) {
    const page = fakeHost(locale);
    const fresh = ui.createProtectHostUi(page.host).ProtectPage();
    assert.equal(fresh.type, 'main');
    assert.equal(fresh.props.class, 'app app--options blocking-page protect-page');
    const [header, body] = fresh.props.children;
    const [back, h1, picker] = header.props.children;
    assert.equal(back.type, 'a');
    assert.equal(back.props.children, 'production:protection_back');
    assert.equal(back.props.href, 'options.html', 'no chrome: plain relative link');
    assert.equal(h1.props.lang, lang, locale);
    assert.equal(h1.props.dir, 'ltr');
    assert.equal(h1.props.children, title, locale);
    assert.equal(picker.type, 'LanguagePicker');
    assert.equal(body.props.surface, 'options-page');
  }
});

// ADR-111: the host island is the only way the Options shell can hand the launcher its Tour button (toolSlot). The island itself is replaced by a recorder, so the arguments the host
// gives it can be read without a DOM: the slot goes in on mount and on every later update, and anything that is not a function becomes null.
test('host island forwards the launcher slot (toolSlot) to the island on mount and on every update; anything but a function becomes null', async () => {
  const bundled = await build({ stdin: { resolveDir: root, loader: 'ts', contents: "export { createProtectHostUi } from './apps/production-protect/src/ui/host.ts';" }, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
    tsconfig: join(root, 'apps/production-protect/tsconfig.json'), plugins: [{ name: 'record-island', setup(builder) {
      builder.onResolve({ filter: /^\.\/islands$/ }, () => ({ path: 'islands', namespace: 'record' }));
      builder.onLoad({ filter: /^islands$/, namespace: 'record' }, () => ({ contents: 'export const PROTECT_OPTIONS_HASH = "#protect"; export const mountIsland = (...args) => { globalThis.__islandCalls.push(["mount", ...args]); return { update: (...next) => globalThis.__islandCalls.push(["update", ...next]), unmount() {} }; };' }));
      builder.onResolve({ filter: /^\.\/i18n-shim$/ }, () => ({ path: 'shim', namespace: 'record' }));
      builder.onLoad({ filter: /^shim$/, namespace: 'record' }, () => ({ contents: 'export const moduleLocaleOf = (value) => value; export const setProductionLocale = () => {}; export const t = (key) => key;' }));
    } }] });
  const { createProtectHostUi } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
  const maker = () => () => null, calls = (globalThis.__islandCalls = []);
  try {
    for (const [given, forwarded] of [[maker, maker], [undefined, null], [null, null], ['tour', null], [{}, null], [42, null]]) {
      calls.length = 0;
      const { host, effects } = fakeHost('en'), island = createProtectHostUi(host).ProtectIsland({ surface: 'launcher', ...(given === undefined ? {} : { toolSlot: given }) });
      island.props.ref.current = { fake: 'element' }; effects[0].effect(); effects[1].effect();
      assert.deepEqual(calls.map(call => call[0]), ['mount', 'update'], 'the island is mounted, then updated');
      assert.deepEqual(calls[0].slice(1), [island.props.ref.current, 'launcher', { tabId: null, openSidePanel: null, locale: 'en', toolSlot: forwarded }], 'mount: ' + String(given));
      assert.deepEqual(calls[1].slice(1), [{ tabId: null, openSidePanel: null, locale: 'en', toolSlot: forwarded }], 'update: ' + String(given));
    }
    // The slot reaches every later update too: refs persist between renders here, as they do in Preact, so a second render updates the island that the first one mounted.
    calls.length = 0; const slots = [], effects = []; let cursor = 0;
    const host = { ...fakeHost('ru').host, useRef: initial => (slots[cursor++] ??= { current: initial }), useEffect: (effect, deps) => effects.push({ effect, deps }) }, made = createProtectHostUi(host);
    const render = props => { cursor = 0; effects.length = 0; return made.ProtectIsland({ surface: 'launcher', ...props }); };
    const island = render({ toolSlot: maker }); island.props.ref.current = { fake: 'element' }; effects[0].effect(); effects[1].effect();
    const replacement = () => () => null; render({ toolSlot: replacement }); effects[1].effect();
    assert.deepEqual(calls.map(call => call[0]), ['mount', 'update', 'update']); assert.equal(calls[1][1].toolSlot, maker); assert.equal(calls[2][1].toolSlot, replacement, 'a later render hands the island the new slot');
  } finally { delete globalThis.__islandCalls; }
});

test('Firefox stub of protect-ui.js exports the names the production bundles use and renders nothing', async () => {
  const stub = await import(pathToFileURL(join(root, 'apps/production-protect/firefox/protect-ui.js')).href);
  const made = stub.createProtectHostUi(fakeHost('ru').host);
  assert.deepEqual(Object.keys(made).sort(), ['ProtectIsland', 'ProtectPage', 'isProtectHash']);
  assert.equal(made.ProtectIsland({ surface: 'popup' }), null);
  assert.equal(made.ProtectIsland({ surface: 'launcher' }), null);
  assert.equal(made.ProtectIsland({ surface: 'launcher', toolSlot: () => () => null }), null, 'ADR-111: the Options shell hands a slot only where the module exists, and the stub would ignore it');
  assert.equal(made.ProtectPage(), null);
  assert.equal(made.isProtectHash('#protect'), false, 'Firefox: #protect stays the production Options');
  assert.equal(typeof stub.mountRequestsPage, 'function');
});

test('requests.html: production stylesheets, the module stylesheet, one module script', () => {
  const page = read('requests.html');
  const links = [...page.matchAll(/<link rel="stylesheet" href="([^"]+)" \/>/g)].map((m) => m[1]);
  assert.deepEqual(links, ['ui.css', 'button-surfaces.css', 'protect.css', 'requests.css']);
  assert.ok(page.includes('<body class="protect-requests">'));
  assert.deepEqual([...page.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]), ['<script type="module" src="requests.js">']);
  assert.equal(/\bon[a-z]+\s*=/i.test(page), false, 'no inline handlers');
});
