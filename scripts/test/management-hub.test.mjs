// ADR-103: «Пульт» helpers stay read-only and map module states to the approved tones and labels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HUB_STATE_TONE, readHubAttention, hubAttentionItems } from '../../apps/production-extension/management-hub.js';
import { REDESIGN_KEYS, REDESIGN_LANGUAGES, redesignLabels, redesignRowLengths } from '../../apps/production-extension/redesign-labels.js';
import { PRODUCTION_LANGUAGES } from '../production-languages.mjs';

function fakeBrowser({ permissions = [], optional = [], withUserScripts = true, granted = [], manifestThrows = false } = {}) {
  const calls = [];
  const api = {
    runtime: {
      getManifest: () => { calls.push('getManifest'); if (manifestThrows) throw Error('no manifest'); return { permissions, optional_permissions: optional }; },
      sendMessage: async () => { calls.push('sendMessage'); },
    },
    permissions: {
      contains: async query => { calls.push('contains:' + query.permissions.join(',')); return query.permissions.every(name => granted.includes(name)); },
      request: async () => { calls.push('request'); return true; },
      remove: async () => { calls.push('remove'); return true; },
    },
    storage: { local: { set: async () => { calls.push('storage.set'); }, remove: async () => { calls.push('storage.remove'); } } },
  };
  if (withUserScripts) api.userScripts = {};
  return { api, calls };
}
const readOnly = calls => calls.every(call => call === 'getManifest' || call.startsWith('contains:'));

test('ADR-103 attention: Chrome required userScripts available and optional cookies granted need no attention', async () => {
  const { api, calls } = fakeBrowser({ permissions: ['userScripts'], optional: ['cookies'], granted: ['cookies'] });
  assert.deepEqual(await readHubAttention(api), { scripts: false, cookies: false });
  assert.ok(readOnly(calls), 'only manifest reads and permissions.contains: ' + calls.join(' '));
});

test('ADR-103 attention: a missing userScripts API (developer toggle off) and a missing optional cookies grant are reported', async () => {
  const { api, calls } = fakeBrowser({ permissions: ['userScripts'], optional: ['cookies'], withUserScripts: false });
  assert.deepEqual(await readHubAttention(api), { scripts: true, cookies: true });
  assert.ok(readOnly(calls) && !calls.includes('request'), 'never requests a permission: ' + calls.join(' '));
});

test('ADR-103 attention: Firefox optional userScripts follow permissions.contains', async () => {
  assert.equal((await readHubAttention(fakeBrowser({ optional: ['userScripts'] }).api)).scripts, true);
  assert.equal((await readHubAttention(fakeBrowser({ optional: ['userScripts'], granted: ['userScripts'] }).api)).scripts, false);
  assert.equal((await readHubAttention(fakeBrowser({}).api)).scripts, false, 'no userScripts in the manifest: nothing to report');
});

test('ADR-103 attention: a failing manifest read degrades to no attention instead of throwing', async () => {
  const { api, calls } = fakeBrowser({ manifestThrows: true });
  assert.deepEqual(await readHubAttention(api), { scripts: false, cookies: false });
  assert.ok(readOnly(calls));
});

test('ADR-103 attention items: userScripts only matters for a used Antidetect; errors and inactive modules keep section order; cookies last', () => {
  const labels = redesignLabels('ru'), sectionLabel = section => section.toUpperCase();
  assert.deepEqual(hubAttentionItems({ antidetect: 'off' }, { scripts: true, cookies: false }, labels, sectionLabel), []);
  const items = hubAttentionItems({ detector: 'active', api: 'error', firewall: 'inactive', antidetect: 'active', autosurf: 'off', proxy: 'error' }, { scripts: true, cookies: true }, labels, sectionLabel);
  assert.deepEqual(items.map(item => item.id), ['scripts', 'error-api', 'inactive-firewall', 'error-proxy', 'cookies']);
  assert.deepEqual(items.map(item => item.section), ['antidetect', 'api', 'firewall', 'proxy', 'cookies']);
  assert.equal(items[1].title, 'API: ' + labels.attnError);
  assert.equal(items[2].title, 'FIREWALL: ' + labels.attnInactive);
});

test('ADR-103 decision 3: OFF and unknown are neutral, red is reserved for errors', () => {
  assert.deepEqual({ ...HUB_STATE_TONE }, { active: 'ok', off: 'off', paused: 'warn', connecting: 'warn', inactive: 'warn', error: 'err', unknown: 'off' });
  assert.deepEqual(Object.entries(HUB_STATE_TONE).filter(([, tone]) => tone === 'err').map(([state]) => state), ['error']);
});

test('ADR-103 labels: every production language has a complete local row', () => {
  const lengths = redesignRowLengths();
  for (const [language, length] of Object.entries(lengths)) assert.equal(length, REDESIGN_KEYS.length, language + ': row length');
  const english = redesignLabels('en');
  for (const { id } of PRODUCTION_LANGUAGES) {
    const labels = redesignLabels(id);
    for (const key of REDESIGN_KEYS) assert.ok(typeof labels[key] === 'string' && labels[key].trim() === labels[key] && labels[key].length > 0, id + '/' + key);
    if (id !== 'en') assert.notEqual(labels.hub, english.hub, id + ': the hub label is localized, not the English fallback');
  }
  assert.ok(REDESIGN_LANGUAGES.length >= 20);
});

test('ADR-103 decision 2: Russian mode labels and section names are exact', () => {
  const ru = redesignLabels('ru');
  assert.deepEqual([ru.modeInherit, ru.modeAllow, ru.modeBlock, ru.modeCustom], ['Как в пресете', 'Разрешить', 'Блокировать', 'Своё значение']);
  assert.deepEqual([ru.hub, ru.analysis], ['Пульт', 'Анализ']);
});

// ---- ADR-107: the command palette searches sections, Antidetect levels and editor commands.
import { readFileSync } from 'node:fs';
import { foldSearchText, rankPaletteEntries, createManagementHub, PALETTE_RESULTS, PALETTE_QUERY_MAX } from '../../apps/production-extension/management-hub.js';
import { buildPaletteEntries, managementSectionForHash, managementHashForSection, MANAGEMENT_TABS } from '../../apps/production-extension/management-ui.js';
import { ANTIDETECT_CATEGORIES } from '../../apps/production-extension/antidetect-ui.js';
import { fingerprintDeviceLabels } from '../../apps/production-extension/fingerprint-device-labels.js';
import { MANAGEMENT_SECTION_ENGLISH } from '../../apps/production-extension/management-navigation-labels.js';

test('ADR-107 palette folding: case, ё to е, accents and compatibility forms fold; й, Hangul and kana stay what they are', () => {
  assert.equal(foldSearchText('ЁЛКА Ёжик'), 'елка ежик');
  assert.equal(foldSearchText('Configuración Réseau Änderungen'), 'configuracion reseau anderungen');
  assert.equal(foldSearchText('Tìm kiếm'), 'tim kiem', 'Vietnamese tones fold');
  assert.equal(foldSearchText('Устройство мой'), 'устройство мой', 'й is a letter, not an accent');
  assert.equal(foldSearchText('ＡＰＩ　Ｇｕａｒｄ'), 'api guard', 'full-width Latin');
  assert.equal(foldSearchText('검색'), '검색'); assert.equal(foldSearchText('ガード'), 'ガード', 'kana recomposed after folding');
  assert.equal(foldSearchText('खोलें'), 'खोलें', 'Devanagari vowel signs are not accents');
  for (const value of [null, undefined, 7, {}, ['a']]) assert.equal(foldSearchText(value), '');
});

const entry = (id, label, extra = {}) => ({ id, label, run: () => {}, ...extra });
test('ADR-107 palette ranking: every typed word must match; whole word, then prefix, then inside, then initials', () => {
  const entries = [
    entry('inside', 'Profilesettings'), entry('initials', 'Browser Debug'), entry('prefix', 'Settingsmanager'), entry('whole', 'Settings'),
    entry('keyword', 'Настройки', { keywords: 'Settings' }), entry('group', 'Theme', { group: 'Settings' }),
  ];
  assert.deepEqual(rankPaletteEntries(entries, 'settings').map(item => item.id), ['whole', 'keyword', 'group', 'prefix', 'inside'], 'label before keywords and group at the same level');
  assert.deepEqual(rankPaletteEntries(entries, 'bd').map(item => item.id), ['initials']);
  assert.deepEqual(rankPaletteEntries(entries, 'browser debug').map(item => item.id), ['initials']);
  assert.deepEqual(rankPaletteEntries(entries, 'browser settings').map(item => item.id), [], 'every word must match the same entry');
  assert.deepEqual(rankPaletteEntries(entries, 'НАСТРОЙ').map(item => item.id), ['keyword'], 'case-insensitive prefix');
  assert.deepEqual(rankPaletteEntries([entry('yo', 'Ёлка'), entry('ye', 'Елка')], 'елка').map(item => item.id), ['yo', 'ye'], 'ё matches е both ways');
  assert.deepEqual(rankPaletteEntries([entry('v', 'Tìm kiếm')], 'tim').map(item => item.id), ['v']);
  assert.deepEqual(rankPaletteEntries(entries, '').map(item => item.id), entries.map(item => item.id), 'an empty query keeps the given order');
  assert.deepEqual(rankPaletteEntries(entries, '  ,;  ').map(item => item.id), entries.map(item => item.id));
  const many = Array.from({ length: 50 }, (_, index) => entry('e' + index, 'Item ' + index));
  assert.equal(rankPaletteEntries(many, 'item').length, PALETTE_RESULTS); assert.equal(rankPaletteEntries(many, '').length, PALETTE_RESULTS);
  assert.deepEqual(rankPaletteEntries(many, 'item 7').map(item => item.id), ['e7', 'e17', 'e27', 'e37', 'e47'], 'numbers are words: the whole number first, then numbers that contain it');
  assert.equal(rankPaletteEntries(many, 'x'.repeat(PALETTE_QUERY_MAX * 4)).length, 0);
  assert.deepEqual(rankPaletteEntries(null, 'a'), []); assert.deepEqual(rankPaletteEntries([null, entry('ok', 'Ok')], 'ok').map(item => item.id), ['ok']);
});

const fakeEntries = ({ locale = 'ru', commands = [], calls = [] } = {}) => buildPaletteEntries({
  h: (type, props) => ({ type, props }), icon: section => ({ type: 'svg', props: { section } }), locale, labels: redesignLabels(locale),
  sectionLabel: section => 'section:' + section, translate: key => 'tr:' + key, groupLabel: section => 'group:' + section,
  choose: section => calls.push(['choose', section]), openAntidetect: level => calls.push(['antidetect', level]), openPrecursor: () => calls.push(['precursor']), commands });

test('ADR-107 palette entries: all sections with English names, the five Antidetect levels, and only the closed list of editor commands', () => {
  const calls = [], entries = fakeEntries({ calls });
  assert.deepEqual(entries.filter(item => !item.id.startsWith('antidetect:')).map(item => item.id), [...MANAGEMENT_TABS, 'browser-debug', 'precursor']);
  assert.deepEqual(entries.filter(item => item.id.startsWith('antidetect:')).map(item => item.id), ANTIDETECT_CATEGORIES.map(level => 'antidetect:' + level));
  const ru = fingerprintDeviceLabels('ru');
  assert.deepEqual(entries.filter(item => item.id.startsWith('antidetect:')).map(item => item.label), [ru.quick_title, ru.level_device_title, ru.level_os_title, ru.level_browser_title, ru.level_network_title]);
  for (const section of MANAGEMENT_TABS) assert.ok(entries.find(item => item.id === section).keywords.includes(MANAGEMENT_SECTION_ENGLISH[section]), section + ': English name as a keyword');
  // English typing finds localized entries; Russian typing finds the level.
  assert.equal(rankPaletteEntries(entries, 'settings')[0].id, 'settings'); assert.equal(rankPaletteEntries(entries, 'api guard')[0].id, 'api');
  assert.equal(rankPaletteEntries(entries, 'network')[0].id, 'antidetect:network'); assert.equal(rankPaletteEntries(entries, 'сеть')[0].id, 'antidetect:network');
  assert.equal(rankPaletteEntries(entries, 'быстр')[0].id, 'antidetect:quick');
  rankPaletteEntries(entries, 'устройство')[0].run(); rankPaletteEntries(entries, 'cookies')[0].run();
  assert.deepEqual(calls, [['antidetect', 'device'], ['choose', 'cookies']]);
  for (const item of entries) assert.doesNotMatch(item.id + ' ' + item.keywords, /grant|permission|разреш/iu, item.id + ': no permission-requesting entry');
});

test('ADR-107 palette commands: profiles load into preview by name, actions open their level first, labels in every language', () => {
  for (const { id: locale } of PRODUCTION_LANGUAGES) {
    const order = [], commands = [
      { id: 'fingerprint-profiles:load-profile:p1', source: 'fingerprint-profiles', kind: 'load-profile', name: 'Офис ' + String.fromCharCode(0x202e) + 'ext', run: () => order.push('load') },
      { id: 'fingerprint-profiles:randomize:randomize', source: 'fingerprint-profiles', kind: 'randomize', name: null, run: () => order.push('randomize') },
      { id: 'fingerprint-profiles:export-profile:export-profile', source: 'fingerprint-profiles', kind: 'export-profile', name: null, run: () => order.push('export') },
      { id: 'antidetect-network:apply-network:apply-network', source: 'antidetect-network', kind: 'apply-network', name: null, run: () => { throw new Error('gone'); } },
    ];
    const entries = fakeEntries({ locale, commands, calls: order }), labels = redesignLabels(locale), actions = entries.slice(-4);
    const [before, after] = labels.paletteLoadProfile.split('{name}');
    assert.equal(actions[0].label, before + commands[0].name + after, locale);
    assert.deepEqual(actions[0].display, [before, { type: 'bdi', props: { children: commands[0].name } }, after], locale + ': the saved name is isolated');
    assert.equal(actions[0].group, 'tr:fingerprint_library');
    assert.deepEqual(actions.slice(1).map(item => item.label), [labels.paletteRandomize, labels.paletteExport, labels.paletteApplyNetwork], locale);
    actions[0].run(); actions[1].run(); actions[3].run();
    assert.deepEqual(order, [['antidetect', 'quick'], 'load', ['antidetect', 'quick'], 'randomize', ['antidetect', 'network']], locale + ': navigation first; a vanished editor never throws');
    if (locale === 'ru') assert.equal(rankPaletteEntries(entries, 'офис')[0].id, commands[0].id, 'the profile name is searchable');
    assert.equal(rankPaletteEntries(entries, 'randomize')[0].id, commands[1].id, locale + ': English keywords');
  }
});

test('ADR-107 palette: old hashes keep working and nothing is stored, neither queries nor a recent list', () => {
  for (const [hash, section] of [['#hub', 'hub'], ['#antidetect', 'antidetect'], ['#protect', 'firewall'], ['#firewall', 'firewall'], ['#history', 'firewall'], ['#requests', 'firewall'], ['#api', 'api'], ['#protection', 'api'], ['#detector', 'detector'], ['#cookies', 'cookies'], ['#autosurf', 'autosurf'], ['#proxy', 'proxy'], ['#integrations', 'integrations'], ['#settings', 'settings'], ['#contacts', 'contacts'], ['#browser-debug', 'browser-debug'], ['', 'hub'], ['#unknown', 'hub']]) assert.equal(managementSectionForHash(hash), section, hash);
  assert.equal(managementHashForSection('antidetect'), '#antidetect');
  for (const file of ['management-hub.js', 'ui-shortcuts.js']) {
    const source = readFileSync(new URL('../../apps/production-extension/' + file, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');
    for (const banned of ['localStorage', 'sessionStorage', 'storage.local', 'storage.session', 'indexedDB', 'recent']) assert.ok(!source.includes(banned), file + ': ' + banned);
  }
});

test('ADR-107 palette component: ranked results, position-based option ids, the dialog closes before a command runs', () => {
  const slots = [], effects = []; let cursor = 0, tree;
  const hooks = {
    useState(initial) { const slot = slots[cursor++] ??= { value: initial }; return [slot.value, next => { slot.value = typeof next === 'function' ? next(slot.value) : next; }]; },
    useRef(initial) { return (slots[cursor++] ??= { ref: { current: initial } }).ref; },
    useEffect(callback) { cursor++; effects.push(callback); },
  };
  const { CommandPalette } = createManagementHub({ ...hooks, h: (type, props) => ({ type, props }), useLocale: () => 'en', translate: key => key, browserApi: {}, sectionLabel: section => section, icon: () => null });
  const order = [], dialog = { open: true, close() { this.open = false; order.push('close'); } };
  const entries = [entry('a', 'Proxy', { run: () => order.push('run') }), entry('b', 'Settings', { keywords: 'Preferences' })];
  const render = () => { cursor = 0; tree = CommandPalette({ open: true, onClose: () => order.push('onClose'), entries }); };
  const find = (node, predicate) => { if (Array.isArray(node)) { for (const child of node) { const found = find(child, predicate); if (found) return found; } return null; } if (!node?.props) return null; return predicate(node) ? node : find(node.props.children, predicate); };
  render(); slots[0].ref.current = dialog;
  const input = find(tree, node => node.props['data-command-palette-input']);
  assert.equal(input.props.maxLength, PALETTE_QUERY_MAX);
  input.props.onInput({ currentTarget: { value: 'pref' } }); render();
  const options = []; (function collect(node) { if (Array.isArray(node)) return node.forEach(collect); if (!node?.props) return; if (node.props.role === 'option') options.push(node); collect(node.props.children); })(tree);
  assert.deepEqual(options.map(node => [node.props.id, node.props['data-command-option']]), [['command-palette-option-0', 'b']], 'keywords match; ids follow the position');
  assert.equal(find(tree, node => node.props['data-command-palette-input']).props['aria-activedescendant'], 'command-palette-option-0');
  find(tree, node => node.props['data-command-palette-input']).props.onInput({ currentTarget: { value: 'proxy' } }); render();
  find(tree, node => node.props['data-command-palette-input']).props.onKeyDown({ key: 'Enter', preventDefault() {} });
  assert.deepEqual(order, ['close', 'onClose', 'run'], 'focus returns to the page and the live regions are reachable before the command runs');
});
