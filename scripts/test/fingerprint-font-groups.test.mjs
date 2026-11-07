// Windows font groups for the Strict canvas font allow-list. Names only (facts about a Windows install): Microsoft's
// published Windows 10/11 font lists + Camoufox essential-fonts.json / font-groups.json (MIT). The allow-list applies only
// in Strict and only to canvas text; it never creates a font.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiConfiguration, validateApiValue, updateApiConfiguration } from '../../apps/production-extension/api-configuration.js';
import { generateConsistentDevice, generateFingerprintConfiguration, applyDevicePatch } from '../../apps/production-extension/fingerprint-profiles.js';
import { WINDOWS_FONT_GROUPS, WINDOWS_FONT_MAX_NAMES, windowsFonts, REGION_FONT_GROUPS, REGION_FONT_GROUP_KEYS, REGION_BASE_FAMILIES, regionFontGroup, regionFontRoots } from '../../apps/production-extension/fingerprint-font-groups.js';
import { regionByCode, regionCodes } from '../../apps/production-extension/fingerprint-region-data.js';
import { noisyFontList } from '../../apps/production-extension/fingerprint-font-noise.js';
import { FONT_BASELINE, describeDevice, fontValues, buildDeviceValues } from '../../apps/production-extension/fingerprint-device-presets.js';

const base = createApiConfiguration();
const val = (configuration, id) => { const row = configuration.apis.find(a => a.id === id); return row?.mode === 'custom' && row.selected.kind === 'value' ? row.selected.value : undefined; };
const valueOf = configuration => id => val(configuration, id);
const families = configuration => val(configuration, 'canvas-font-policy')?.families;
const WIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';
const EARLIER_14 = ['Arial', 'Calibri', 'Cambria', 'Comic Sans MS', 'Consolas', 'Courier New', 'Georgia', 'Impact', 'Lucida Console', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];
const TELLS = ['Segoe UI', 'Segoe UI Light', 'Calibri', 'Marlett', 'MS UI Gothic', 'Franklin Gothic Medium', 'Consolas', 'Courier New'];
const WIN11_ONLY = ['Segoe Fluent Icons', 'Segoe UI Variable', 'Segoe UI Variable Display', 'Segoe UI Variable Small', 'Segoe UI Variable Text', 'Sans Serif Collection'];
// ADR-110 addendum (owner decision 2026-11-07): the platform aliases that a genuine Windows browser resolves are part of core; the Firefox-only ones are in no group.
const ALIASES_SHOWN = ['Courier', 'Helvetica', 'MS Sans Serif', 'MS Serif', 'Times'], ALIASES_HIDDEN = ['Helv', 'MS Shell Dlg', 'MS Shell Dlg 2', 'Tms Rmn'];

// ADR-110 addendum 2 (owner decision 2026-11-07): the families of Microsoft's Feature On Demand packages "Japanese / Korean / Chinese (Simplified) / Chinese
// (Traditional) Supplemental Fonts" (Windows 10 and Windows 11 font lists on learn.microsoft.com, read 2026-11-07). The Family and Font Name columns, styles dropped.
const REGION_GROUPS = {
  regionJa: ['BIZ UDGothic', 'BIZ UDPGothic', 'BIZ UDMincho Medium', 'BIZ UDPMincho Medium', 'Meiryo', 'Meiryo UI', 'MS Mincho', 'MS PMincho', 'UD Digi Kyokasho N-B', 'UD Digi Kyokasho NK-B',
    'UD Digi Kyokasho NK-R', 'UD Digi Kyokasho NP-B', 'UD Digi Kyokasho NP-R', 'UD Digi Kyokasho N-R', 'Yu Mincho', 'Yu Mincho Light', 'Yu Mincho Demibold'],
  regionKo: ['Batang', 'BatangChe', 'Dotum', 'DotumChe', 'Gulim', 'GulimChe', 'Gungsuh', 'GungsuhChe'],
  regionZhHans: ['DengXian', 'DengXian Light', 'KaiTi', 'SimHei'],
  regionZhHant: ['DFKai-SB', 'MingLiU', 'MingLiU_HKSCS', 'PMingLiU'],
};
const CLAIMS = { JP: 'regionJa', KR: 'regionKo', CN: 'regionZhHans', TW: 'regionZhHant' };
const ZONES = { JP: ['Asia/Tokyo', 540], KR: ['Asia/Seoul', 540], CN: ['Asia/Shanghai', 480], SG: ['Asia/Singapore', 480], TW: ['Asia/Taipei', 480], HK: ['Asia/Hong_Kong', 480], MO: ['Asia/Macau', 480], US: ['America/New_York', -300] };
const strictFor = (extra = {}, os = 'windows-11') => generateConsistentDevice(base, { deviceType: 'desktop', os, protection: 'strict', seed: 7, ...extra });

test('the eight groups are frozen, ASCII, short, free of CSS separators and never repeat a name', () => {
  assert.deepEqual(Object.keys(WINDOWS_FONT_GROUPS), ['core', 'win11', 'office', 'panEuropean', 'regionJa', 'regionKo', 'regionZhHans', 'regionZhHant']);
  assert.ok(Object.isFrozen(WINDOWS_FONT_GROUPS));
  const all = [];
  for (const [group, names] of Object.entries(WINDOWS_FONT_GROUPS)) {
    assert.ok(Object.isFrozen(names) && names.length >= 1, group);
    for (const name of names) {
      assert.ok(/^[\x20-\x7e]+$/u.test(name), `${group}: "${name}" is ASCII`);
      assert.ok(name.length <= 128 && name === name.trim() && !/[",;'\\]/u.test(name), `${group}: "${name}" is a bounded, unescaped family name`);
    }
    assert.equal(new Set(names).size, names.length, group + ' has no duplicates');
    all.push(...names);
  }
  assert.equal(new Set(all).size, all.length, 'no name is in two groups');
  assert.ok(all.length <= WINDOWS_FONT_MAX_NAMES && WINDOWS_FONT_MAX_NAMES === 256);
  assert.deepEqual(Object.values(WINDOWS_FONT_GROUPS).map(names => names.length), [96, 6, 115, 6, 17, 8, 4, 4], 'group sizes (core 96 = the 91 families of Microsoft\'s lists + 5 platform aliases, Windows 11 6, Office 115, Pan-European 6, regional Japanese 17, Korean 8, Chinese Simplified 4, Chinese Traditional 4)');
});

test('core carries the Windows tells and the earlier 14 names; the Windows 11 names are not in core', () => {
  for (const name of TELLS) assert.ok(WINDOWS_FONT_GROUPS.core.includes(name), name);
  for (const name of EARLIER_14) assert.ok(WINDOWS_FONT_GROUPS.core.includes(name), name);
  for (const name of ['Segoe UI Emoji', 'MS Gothic', 'Webdings', 'Wingdings', 'Segoe MDL2 Assets', 'Microsoft YaHei', 'Yu Gothic UI', 'Malgun Gothic']) assert.ok(WINDOWS_FONT_GROUPS.core.includes(name), name);
  assert.deepEqual([...WINDOWS_FONT_GROUPS.win11].sort(), [...WIN11_ONLY].sort());
  for (const name of WIN11_ONLY) assert.ok(!WINDOWS_FONT_GROUPS.core.includes(name), name + ' is Windows 11 only');
  // Left out on purpose: Firefox-only aliases and legacy raster families, names absent from Microsoft's lists, localized aliases, software groups.
  for (const name of ['Twemoji Mozilla', ...ALIASES_HIDDEN, 'Roman', 'Small Fonts', 'Nirmala Text', 'Nirmala Text Semilight', 'MingLiU_MSCS-ExtB', 'Fira Code', 'Roboto', 'Liberation Sans', 'Cascadia Code', 'JetBrains Mono']) {
    for (const names of Object.values(WINDOWS_FONT_GROUPS)) assert.ok(!names.includes(name), name);
  }
  // The five aliases a genuine Windows browser resolves are in core, once each, right before the family they stand for.
  for (const name of ALIASES_SHOWN) { assert.equal(WINDOWS_FONT_GROUPS.core.filter(entry => entry === name).length, 1, name); for (const other of ['win11', 'office', 'panEuropean']) assert.ok(!WINDOWS_FONT_GROUPS[other].includes(name), name); }
  assert.deepEqual(WINDOWS_FONT_GROUPS.core.filter(name => ALIASES_SHOWN.includes(name)), ALIASES_SHOWN, 'listed in alphabetical order inside core');
  assert.ok(WINDOWS_FONT_GROUPS.core.indexOf('Courier') + 1 === WINDOWS_FONT_GROUPS.core.indexOf('Courier New') && WINDOWS_FONT_GROUPS.core.indexOf('Times') + 1 === WINDOWS_FONT_GROUPS.core.indexOf('Times New Roman'));
  assert.ok(WINDOWS_FONT_GROUPS.office.includes('Book Antiqua') && WINDOWS_FONT_GROUPS.office.includes('Century Gothic'));
  assert.ok(WINDOWS_FONT_GROUPS.panEuropean.includes('Verdana Pro'));
});

test('windowsFonts: core by default, Windows 11 names only when claimed, Office and Pan-European only on request, always unique and bounded', () => {
  const core = windowsFonts();
  assert.deepEqual(core, [...WINDOWS_FONT_GROUPS.core]); assert.deepEqual(windowsFonts({}), core); assert.deepEqual(windowsFonts('windows'), core); assert.deepEqual(windowsFonts(null), core);
  assert.deepEqual(windowsFonts({ windows11: false }), core);
  assert.deepEqual(windowsFonts({ windows11: true }), [...WINDOWS_FONT_GROUPS.core, ...WINDOWS_FONT_GROUPS.win11]);
  assert.deepEqual(windowsFonts({ office: true }), [...WINDOWS_FONT_GROUPS.core, ...WINDOWS_FONT_GROUPS.office]);
  assert.deepEqual(windowsFonts({ panEuropean: true }), [...WINDOWS_FONT_GROUPS.core, ...WINDOWS_FONT_GROUPS.panEuropean]);
  const everything = windowsFonts({ windows11: true, office: true, panEuropean: true });
  assert.equal(everything.length, 223); assert.equal(new Set(everything).size, everything.length); assert.ok(everything.length <= 256 && everything.every(name => name.length <= 128 && /^[\x20-\x7e]+$/u.test(name)));
  // Truthy but not `true` is not a request; a result is a fresh array each time.
  assert.deepEqual(windowsFonts({ windows11: 'yes', office: 1 }), core);
  windowsFonts().push('Evil Font'); assert.ok(!windowsFonts().includes('Evil Font')); assert.ok(!WINDOWS_FONT_GROUPS.core.includes('Evil Font'));
  let read = false; const accessor = {}; Object.defineProperty(accessor, 'office', { enumerable: true, get() { read = true; return true; } });
  assert.deepEqual(windowsFonts(accessor), core); assert.equal(read, false, 'an accessor is never invoked');
});

test('the validator accepts every combination (caps at 256 names) and the generator writes the group list in Strict only', () => {
  for (const windows11 of [false, true]) for (const office of [false, true]) for (const panEuropean of [false, true]) {
    const raw = { families: windowsFonts({ windows11, office, panEuropean }), fallback: 'sans-serif' };
    assert.equal(validateApiValue('canvas-font-policy', { kind: 'value', value: raw }).ok, true, JSON.stringify({ windows11, office, panEuropean }));
  }
  assert.equal(validateApiValue('canvas-font-policy', { kind: 'value', value: { families: Array.from({ length: 256 }, (_, index) => 'F' + index), fallback: 'sans-serif' } }).ok, true);
  assert.equal(validateApiValue('canvas-font-policy', { kind: 'value', value: { families: Array.from({ length: 257 }, (_, index) => 'F' + index), fallback: 'sans-serif' } }).ok, false);
  const win11 = generateConsistentDevice(base, { deviceType: 'desktop', os: 'windows-11', protection: 'strict', seed: 1 });
  const win10 = generateConsistentDevice(base, { deviceType: 'desktop', os: 'windows-10', protection: 'strict', seed: 1 });
  assert.deepEqual(families(win11.configuration), windowsFonts({ windows11: true })); assert.deepEqual(families(win10.configuration), windowsFonts());
  assert.ok(families(win11.configuration).includes('Segoe UI Variable') && !families(win10.configuration).includes('Segoe UI Variable'));
  assert.equal(val(win11.configuration, 'canvas-font-policy').fallback, 'sans-serif');
  for (const protection of ['compatibility', 'balanced']) assert.equal(val(generateConsistentDevice(base, { deviceType: 'desktop', protection, seed: 1 }).configuration, 'canvas-font-policy'), undefined, protection + ' leaves fonts native');
  // Optional groups: off unless asked for, and only through the options (the UI has no toggle yet).
  const office = generateConsistentDevice(base, { deviceType: 'desktop', os: 'windows-11', protection: 'strict', seed: 1, fontGroups: { office: true, panEuropean: true } });
  assert.deepEqual(families(office.configuration), windowsFonts({ windows11: true, office: true, panEuropean: true }));
  assert.deepEqual(buildDeviceValues({ os: 'windows-10', fonts: true }).values.find(entry => entry.id === 'canvas-font-policy').raw, { families: windowsFonts(), fallback: 'sans-serif' });
  assert.equal(buildDeviceValues({ os: 'windows-10' }).values.some(entry => entry.id === 'canvas-font-policy'), false);
  assert.deepEqual(FONT_BASELINE.families, windowsFonts()); assert.equal(FONT_BASELINE.fallback, 'sans-serif');
});

test('both Strict definitions write the same list: the old recipe generator too, for a Windows claim', () => {
  const chrome = { userAgent: WIN_UA, platform: 'Win32', language: 'en-US', uaData: null };
  const strict = generateFingerprintConfiguration(base, { recipe: 'strict' }, chrome).configuration;
  assert.deepEqual(val(strict, 'canvas-font-policy'), { families: windowsFonts(), fallback: 'sans-serif' });
  assert.equal(validateApiValue('canvas-font-policy', { kind: 'value', value: val(strict, 'canvas-font-policy') }).ok, true);
  // A claim of another system keeps the empty list: Windows names would contradict it.
  const mac = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36', platform: 'MacIntel', language: 'en-US', uaData: null };
  assert.deepEqual(val(generateFingerprintConfiguration(base, { recipe: 'strict' }, mac).configuration, 'canvas-font-policy'), { families: [], fallback: 'sans-serif' });
  assert.equal(val(generateFingerprintConfiguration(base, { recipe: 'balanced' }, chrome).configuration, 'canvas-font-policy'), undefined);
});

test('describeDevice recognises every group combination, the earlier 14-name list and custom lists', () => {
  const describeWith = raw => describeDevice(id => id === 'canvas-font-policy' ? raw : undefined);
  for (const windows11 of [false, true]) for (const office of [false, true]) for (const panEuropean of [false, true]) {
    const found = describeWith({ families: windowsFonts({ windows11, office, panEuropean }), fallback: 'sans-serif' });
    assert.equal(found.fonts, 'windows'); assert.deepEqual(found.fontGroups, { windows11, office, panEuropean });
  }
  const legacy = describeWith({ families: EARLIER_14, fallback: 'sans-serif' });
  assert.equal(legacy.fonts, 'windows', 'a profile saved with the earlier fixed list is still the Windows list'); assert.deepEqual(legacy.fontGroups, { windows11: false, office: false, panEuropean: false });
  for (const raw of [{ families: [], fallback: 'sans-serif' }, { families: ['Arial'], fallback: 'sans-serif' }, { families: windowsFonts(), fallback: 'serif' }, { families: [...windowsFonts()].reverse(), fallback: 'sans-serif' }]) {
    const found = describeWith(raw); assert.equal(found.fonts, 'custom'); assert.equal(found.fontGroups, null);
  }
  const untouched = describeDevice(() => undefined); assert.equal(untouched.fonts, null); assert.equal(untouched.fontGroups, null);
  assert.equal(describeDevice(valueOf(generateConsistentDevice(base, { deviceType: 'laptop', protection: 'strict', seed: 3 }).configuration)).fonts, 'windows');
  assert.deepEqual(fontValues({ windows11: true })[0].raw.families, windowsFonts({ windows11: true }));
});

test('the font control and the OS control keep the Windows 11 names in step with the claimed Windows', () => {
  const win11 = applyDevicePatch(base, { os: 'windows-11', fonts: 'windows' });
  assert.deepEqual(families(win11.configuration), windowsFonts({ windows11: true })); assert.equal(win11.device.fonts, 'windows'); assert.equal(win11.device.fontGroups.windows11, true);
  const win10 = applyDevicePatch(win11.configuration, { os: 'windows-10' });
  assert.deepEqual(families(win10.configuration), windowsFonts()); assert.ok(win10.affected.includes('canvas-font-policy'));
  const back = applyDevicePatch(win10.configuration, { os: 'windows-11' });
  assert.deepEqual(families(back.configuration), windowsFonts({ windows11: true }));
  assert.deepEqual(families(applyDevicePatch(base, { os: 'windows-10', fonts: 'windows' }).configuration), windowsFonts());
  // Optional groups survive an OS change.
  const strict = generateConsistentDevice(base, { deviceType: 'desktop', os: 'windows-11', protection: 'strict', seed: 2, fontGroups: { office: true } }).configuration;
  assert.deepEqual(families(applyDevicePatch(strict, { os: 'windows-10' }).configuration), windowsFonts({ office: true }));
  // Without a font row an OS change writes none, a custom list is left alone, and Native returns the row to the browser.
  assert.ok(!applyDevicePatch(base, { os: 'windows-10' }).affected.includes('canvas-font-policy'));
  const custom = applyDevicePatch(base, { os: 'windows-11' }).configuration;
  assert.equal(val(custom, 'canvas-font-policy'), undefined);
  assert.equal(applyDevicePatch(win11.configuration, { fonts: null }).configuration.apis.find(row => row.id === 'canvas-font-policy').mode, 'bypass');
  assert.throws(() => applyDevicePatch(base, { fonts: 'macos' }), /invalid-value/);
});

// ADR-110 addendum (owner decision 2026-11-07): the five platform aliases joined core. Profiles generated before that hold the core list without them.
test('a list saved before the five aliases joined core is still the Windows list, and the OS control brings it up to date', () => {
  const prior = list => list.filter(name => !ALIASES_SHOWN.includes(name));
  for (const windows11 of [false, true]) for (const office of [false, true]) for (const panEuropean of [false, true]) {
    const groups = { windows11, office, panEuropean }, raw = { families: prior(windowsFonts(groups)), fallback: 'sans-serif' };
    assert.ok(raw.families.length < windowsFonts(groups).length);
    const found = describeDevice(id => id === 'canvas-font-policy' ? raw : undefined);
    assert.equal(found.fonts, 'windows', JSON.stringify(groups)); assert.deepEqual(found.fontGroups, groups); assert.equal(found.fontNoise, false); assert.deepEqual(found.fontHidden, []);
  }
  assert.equal(prior(windowsFonts()).length, 91, 'the earlier core list had 91 names');
  const saved = updateApiConfiguration(base, 'canvas-font-policy', { mode: 'custom', selected: { kind: 'value', value: { families: prior(windowsFonts({ windows11: true })), fallback: 'sans-serif' } } });
  assert.equal(saved.ok, true, saved.error?.message);
  const ten = applyDevicePatch(saved.value, { os: 'windows-10' });
  assert.deepEqual(families(ten.configuration), windowsFonts(), 'the Windows list of today, aliases included');
  for (const name of ALIASES_SHOWN) assert.ok(families(ten.configuration).includes(name), name);
  assert.equal(ten.device.fonts, 'windows'); assert.equal(ten.device.fontNoise, false);
  // A list that is the earlier core list plus a name of the owner's own is a custom list, as before.
  const own = describeDevice(id => id === 'canvas-font-policy' ? { families: [...prior(windowsFonts()), 'Zz Own'], fallback: 'sans-serif' } : undefined);
  assert.equal(own.fonts, 'custom');
});

test('the generated Strict list shows the five aliases for a Windows claim and no Firefox-only alias', () => {
  for (const os of ['windows-10', 'windows-11']) {
    const list = families(generateConsistentDevice(base, { deviceType: 'desktop', os, protection: 'strict', seed: 3 }).configuration);
    for (const name of ALIASES_SHOWN) assert.ok(list.includes(name), os + ' shows ' + name);
    for (const name of ALIASES_HIDDEN) assert.ok(!list.includes(name), os + ' hides ' + name);
  }
  // A claim of another system keeps the empty list: the aliases are hidden with everything else.
  const mac = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36', platform: 'MacIntel', language: 'en-US', uaData: null };
  assert.deepEqual(val(generateFingerprintConfiguration(base, { recipe: 'strict' }, mac).configuration, 'canvas-font-policy'), { families: [], fallback: 'sans-serif' });
});

// ---- ADR-110 addendum 2 (owner decision 2026-11-07): regional CJK groups --------------------------------------------------------------------------------
test('the four regional groups hold exactly the families of Microsoft\'s Japanese, Korean and Chinese supplemental packages: no style, no localized name, nothing from another group', () => {
  assert.deepEqual(REGION_FONT_GROUP_KEYS, Object.keys(REGION_GROUPS)); assert.ok(Object.isFrozen(REGION_FONT_GROUP_KEYS));
  for (const key of REGION_FONT_GROUP_KEYS) assert.deepEqual([...WINDOWS_FONT_GROUPS[key]], REGION_GROUPS[key], key);
  const others = ['core', 'win11', 'office', 'panEuropean'].flatMap(group => WINDOWS_FONT_GROUPS[group].map(name => name.toLowerCase()));
  for (const key of REGION_FONT_GROUP_KEYS) for (const name of WINDOWS_FONT_GROUPS[key]) assert.ok(!others.includes(name.toLowerCase()), name + ' is in no other group');
  // Styles of the tables are not families; FangSong is the CSS generic `fangsong`; the other Feature On Demand packages are not covered.
  const everything = new Set(Object.values(WINDOWS_FONT_GROUPS).flat().map(name => name.toLowerCase()));
  for (const name of ['Meiryo Bold', 'Meiryo Italic', 'Meiryo UI Bold Italic', 'BIZ UDGothic Bold', 'Yu Mincho Regular', 'DengXian Bold', 'FangSong']) assert.ok(!everything.has(name.toLowerCase()), name);
  for (const name of ['Aldhabi', 'Andalus', 'Gisha', 'David', 'Angsana New', 'Mangal', 'Latha', 'Tunga', 'Nyala', 'Vrinda', 'Khmer UI', 'Lao UI', 'Iskoola Pota', 'Estrangelo Edessa']) assert.ok(!everything.has(name.toLowerCase()), name + ' (another package) is not covered');
  // The base families of the same scripts are in core for every claim; the region only makes them mandatory for the noise.
  assert.deepEqual(Object.keys(REGION_BASE_FAMILIES), REGION_FONT_GROUP_KEYS);
  for (const [key, names] of Object.entries(REGION_BASE_FAMILIES)) { assert.ok(Object.isFrozen(names) && names.length >= 1, key); for (const name of names) assert.ok(WINDOWS_FONT_GROUPS.core.includes(name), name + ' is a core family'); }
  assert.deepEqual([...REGION_BASE_FAMILIES.regionJa], ['MS Gothic', 'MS PGothic', 'Yu Gothic']);
});

test('the region table: Japan, Korea, China and Singapore, Taiwan, Hong Kong and Macao take a group; every other region, "Auto" and anything that is not a code takes none', () => {
  assert.deepEqual({ ...REGION_FONT_GROUPS }, { JP: 'regionJa', KR: 'regionKo', KP: 'regionKo', CN: 'regionZhHans', SG: 'regionZhHans', TW: 'regionZhHant', HK: 'regionZhHant', MO: 'regionZhHant' });
  assert.ok(Object.isFrozen(REGION_FONT_GROUPS));
  for (const [code, group] of Object.entries(REGION_FONT_GROUPS)) { assert.ok(REGION_FONT_GROUP_KEYS.includes(group), code); assert.notEqual(regionByCode(code), null, code + ' is a region of the generator data'); assert.equal(regionFontGroup(code), group); assert.equal(regionFontGroup(code.toLowerCase()), group, 'any letter case'); }
  for (const code of regionCodes()) if (!Object.hasOwn(REGION_FONT_GROUPS, code)) assert.equal(regionFontGroup(code), null, code);
  for (const junk of [null, undefined, 5, true, {}, [], 'J', 'JPN', ' JP', 'JP ', 'J P', '', 'XX', 'constructor', '__proto__', 'toString', 'hasOwnProperty']) assert.equal(regionFontGroup(junk), null, String(junk));
  assert.deepEqual(regionFontRoots('regionKo'), [...WINDOWS_FONT_GROUPS.regionKo, 'Malgun Gothic']);
  assert.deepEqual(regionFontRoots('regionJa'), [...WINDOWS_FONT_GROUPS.regionJa, 'MS Gothic', 'MS PGothic', 'Yu Gothic']);
  for (const junk of [null, undefined, 'core', 'regionXx', 'JP', {}]) assert.deepEqual(regionFontRoots(junk), []);
  assert.notEqual(regionFontRoots('regionKo'), regionFontRoots('regionKo'), 'a fresh array');
});

test('windowsFonts adds one regional group last; an unknown or inherited key adds none; the largest list fits the 256-name bound and the validator', () => {
  for (const key of REGION_FONT_GROUP_KEYS) {
    assert.deepEqual(windowsFonts({ regionGroup: key }), [...WINDOWS_FONT_GROUPS.core, ...WINDOWS_FONT_GROUPS[key]], key);
    assert.deepEqual(windowsFonts({ windows11: true, office: true, panEuropean: true, regionGroup: key }), [...WINDOWS_FONT_GROUPS.core, ...WINDOWS_FONT_GROUPS.win11, ...WINDOWS_FONT_GROUPS.office, ...WINDOWS_FONT_GROUPS.panEuropean, ...WINDOWS_FONT_GROUPS[key]]);
  }
  const widest = windowsFonts({ windows11: true, office: true, panEuropean: true, regionGroup: 'regionJa' });
  assert.equal(widest.length, 240); assert.ok(widest.length <= WINDOWS_FONT_MAX_NAMES);
  for (const windows11 of [false, true]) for (const office of [false, true]) for (const panEuropean of [false, true]) for (const regionGroup of [undefined, ...REGION_FONT_GROUP_KEYS]) {
    const list = windowsFonts({ windows11, office, panEuropean, regionGroup });
    assert.equal(validateApiValue('canvas-font-policy', { kind: 'value', value: { families: list, fallback: 'sans-serif' } }).ok, true, JSON.stringify({ windows11, office, panEuropean, regionGroup }));
    assert.equal(new Set(list).size, list.length);
  }
  const plain = windowsFonts({ windows11: true });
  for (const key of ['REGIONJA', 'core', 'office', 'JP', '', 5, null, {}, ['regionJa'], 'constructor']) assert.deepEqual(windowsFonts({ windows11: true, regionGroup: key }), plain, String(key));
  const inherited = Object.create({ regionGroup: 'regionJa' }); inherited.windows11 = true;
  assert.deepEqual(windowsFonts(inherited), plain, 'a key that is not an own property is not read');
  let read = false; const accessor = { windows11: true }; Object.defineProperty(accessor, 'regionGroup', { enumerable: true, get() { read = true; return 'regionJa'; } });
  assert.deepEqual(windowsFonts(accessor), plain); assert.equal(read, false, 'an accessor is never invoked');
});

test('the generator adds the regional group of the claimed region to the Strict Windows list and to nothing else', () => {
  for (const [code, group] of Object.entries(CLAIMS)) {
    const claimed = strictFor({ region: code }), list = families(claimed.configuration), device = describeDevice(valueOf(claimed.configuration));
    assert.deepEqual(list, windowsFonts({ windows11: true, regionGroup: group }), code); assert.equal(device.region, code); assert.equal(device.fontRegion, group);
    assert.deepEqual(device.fontGroups, { windows11: true, office: false, panEuropean: false }, 'the shape of fontGroups did not change'); assert.equal(device.fonts, 'windows'); assert.equal(device.fontNoise, false);
    for (const name of REGION_GROUPS[group]) assert.ok(list.includes(name), code + ' lists ' + name);
    for (const other of REGION_FONT_GROUP_KEYS) if (other !== group) for (const name of REGION_GROUPS[other]) assert.ok(!list.includes(name), code + ' does not list ' + name);
    assert.deepEqual(families(strictFor({ region: code }, 'windows-10').configuration), windowsFonts({ regionGroup: group }), code + ' on Windows 10');
  }
  for (const code of ['SG', 'HK', 'MO', 'KP']) assert.equal(describeDevice(valueOf(strictFor({ region: code }).configuration)).fontRegion, REGION_FONT_GROUPS[code], code);
  // Any other region, no region, and a cleared region: the list of before, with no group.
  const plain = windowsFonts({ windows11: true });
  for (const extra of [{}, { region: 'US' }, { region: 'DE' }, { region: 'IN' }, { region: null }]) { const claimed = strictFor(extra); assert.deepEqual(families(claimed.configuration), plain, JSON.stringify(extra)); assert.equal(describeDevice(valueOf(claimed.configuration)).fontRegion, null); }
  // A lighter preset writes no font list at all, region or not.
  for (const protection of ['compatibility', 'balanced']) assert.equal(val(generateConsistentDevice(base, { deviceType: 'desktop', protection, seed: 7, region: 'JP' }).configuration, 'canvas-font-policy'), undefined, protection);
  // The optional groups combine with the regional one.
  assert.deepEqual(families(strictFor({ region: 'KR', fontGroups: { office: true, panEuropean: true } }).configuration), windowsFonts({ windows11: true, office: true, panEuropean: true, regionGroup: 'regionKo' }));
});

test('the claimed region is the one the time zone rows give: an explicit zone decides, an earlier claim is kept, a cleared claim is none; noise never leaves out the region\'s families', () => {
  for (const [code, [timeZone, offsetMinutes]] of Object.entries(ZONES)) {
    const device = describeDevice(valueOf(strictFor({ timezone: { timeZone, offsetMinutes } }).configuration));
    assert.equal(device.region, code, timeZone); assert.equal(device.fontRegion, regionFontGroup(code), timeZone + ' -> ' + code);
  }
  // The explicit zone is the finer choice: it overrides the region of the same generation, and so do its fonts.
  const conflict = strictFor({ region: 'JP', timezone: { timeZone: 'Asia/Seoul', offsetMinutes: 540 } });
  assert.equal(describeDevice(valueOf(conflict.configuration)).fontRegion, 'regionKo'); assert.deepEqual(families(conflict.configuration), windowsFonts({ windows11: true, regionGroup: 'regionKo' }));
  // A region claim that is already in the configuration is kept when the generator runs without one (Strict rewrites the list for it) and dropped when it is cleared.
  const japan = strictFor({ region: 'JP' }).configuration;
  assert.deepEqual(families(generateConsistentDevice(japan, { deviceType: 'desktop', os: 'windows-11', protection: 'strict', seed: 9 }).configuration), windowsFonts({ windows11: true, regionGroup: 'regionJa' }));
  assert.deepEqual(families(generateConsistentDevice(japan, { deviceType: 'desktop', os: 'windows-11', protection: 'strict', seed: 9, region: null }).configuration), windowsFonts({ windows11: true }));
  // Noise: the same seed gives the same list, and the families of the claimed region are never the ones left out.
  const roots = regionFontRoots('regionJa');
  assert.deepEqual(families(strictFor({ region: 'JP', fontNoise: true }).configuration), noisyFontList(windowsFonts({ windows11: true, regionGroup: 'regionJa' }), 7, roots));
  for (let index = 0; index < 40; index++) { const list = families(strictFor({ region: 'JP', fontNoise: true, seed: 1000 + index }).configuration); for (const name of roots) assert.ok(list.includes(name), 'seed ' + (1000 + index) + ' keeps ' + name); assert.equal(list.length, 119 - 2); }
});

test('the region control and the OS control keep a Windows list in step with the claimed region (noise kept) and leave it alone when the group does not change', () => {
  const generated = strictFor({ fontNoise: true, seed: 31 }).configuration, plain = windowsFonts({ windows11: true });
  const japan = applyDevicePatch(generated, { region: 'JP' });
  assert.equal(japan.device.fontRegion, 'regionJa'); assert.equal(japan.device.fontNoise, true); assert.equal(japan.device.fonts, 'windows'); assert.equal(families(japan.configuration).length, 119 - 2);
  for (const name of REGION_GROUPS.regionJa) assert.ok(families(japan.configuration).includes(name), name);
  assert.ok(japan.affected.includes('canvas-font-policy'));
  // Another region with a group swaps the group; a region without one removes it; both keep the noise.
  const korea = applyDevicePatch(japan.configuration, { region: 'KR' });
  assert.equal(korea.device.fontRegion, 'regionKo'); assert.equal(korea.device.fontNoise, true); assert.ok(!families(korea.configuration).includes('Meiryo') && families(korea.configuration).includes('Batang'));
  const us = applyDevicePatch(korea.configuration, { region: 'US' });
  assert.equal(us.device.fontRegion, null); assert.equal(us.device.fontNoise, true); assert.equal(families(us.configuration).length, plain.length - 2); assert.ok(!families(us.configuration).includes('Batang'));
  assert.equal(applyDevicePatch(japan.configuration, { region: null }).device.fontRegion, null);
  // The same region again, or an unrelated change: the list is not touched (no churn of the noise).
  assert.deepEqual(families(applyDevicePatch(japan.configuration, { region: 'JP' }).configuration), families(japan.configuration));
  assert.deepEqual(families(applyDevicePatch(japan.configuration, { timezone: { timeZone: 'Asia/Tokyo', offsetMinutes: 540 } }).configuration), families(japan.configuration));
  assert.deepEqual(families(applyDevicePatch(japan.configuration, { cores: 8, language: 'ja-JP' }).configuration), families(japan.configuration));
  // A time zone patch moves the region and with it the group; a zone without a region (UTC) leaves no claim and no group.
  assert.equal(applyDevicePatch(generated, { timezone: { timeZone: 'Asia/Shanghai', offsetMinutes: 480 } }).device.fontRegion, 'regionZhHans');
  assert.equal(applyDevicePatch(japan.configuration, { timezone: { timeZone: 'UTC', offsetMinutes: 0 } }).device.fontRegion, null);
  // The OS control keeps the group and the noise; Windows 10 has no Windows 11 names (and the Japanese Windows 10 list still leaves out two names).
  const ten = applyDevicePatch(japan.configuration, { os: 'windows-10' });
  assert.equal(ten.device.fontRegion, 'regionJa'); assert.equal(ten.device.fontNoise, true); assert.equal(families(ten.configuration).length, 113 - 2); assert.ok(!families(ten.configuration).includes('Segoe UI Variable'));
  // The explicit Windows choice writes the plain list of the claimed Windows and region; Browser returns the row to the browser.
  assert.deepEqual(families(applyDevicePatch(japan.configuration, { fonts: 'windows' }).configuration), windowsFonts({ windows11: true, regionGroup: 'regionJa' }));
  assert.equal(applyDevicePatch(japan.configuration, { fonts: null }).configuration.apis.find(row => row.id === 'canvas-font-policy').mode, 'bypass');
  // Without a Windows list a region patch writes no font row.
  const bare = applyDevicePatch(base, { region: 'JP' }); assert.ok(!bare.affected.includes('canvas-font-policy')); assert.equal(val(bare.configuration, 'canvas-font-policy'), undefined);
  assert.throws(() => applyDevicePatch(base, { fonts: 'macos' }), /invalid-value/);
});

test('lists saved before the regional groups are still the Windows lists; a region patch brings them up to date', () => {
  const saved = list => updateApiConfiguration(base, 'canvas-font-policy', { mode: 'custom', selected: { kind: 'value', value: { families: list, fallback: 'sans-serif' } } }).value;
  // Every list of the eight Windows 11 / Office / Pan-European choices without a regional group, as written until now.
  for (const windows11 of [false, true]) for (const office of [false, true]) for (const panEuropean of [false, true]) {
    const groups = { windows11, office, panEuropean }, found = describeDevice(valueOf(saved(windowsFonts(groups))));
    assert.equal(found.fonts, 'windows'); assert.deepEqual(found.fontGroups, groups); assert.equal(found.fontRegion, null); assert.equal(found.fontNoise, false);
  }
  const korea = applyDevicePatch(saved(windowsFonts({ windows11: true })), { region: 'KR' });
  assert.deepEqual(families(korea.configuration), windowsFonts({ windows11: true, regionGroup: 'regionKo' })); assert.equal(korea.device.fontRegion, 'regionKo');
  // A hand-made list with a regional name but not the whole group is a custom list.
  const own = describeDevice(valueOf(saved([...windowsFonts({ windows11: true }), 'Meiryo'])));
  assert.equal(own.fonts, 'custom'); assert.equal(own.fontRegion, null);
});

test('describeDevice recognizes every list of the forty: plain, and with the noise of its own claim', () => {
  const saved = list => updateApiConfiguration(base, 'canvas-font-policy', { mode: 'custom', selected: { kind: 'value', value: { families: list, fallback: 'sans-serif' } } }).value;
  for (const windows11 of [false, true]) for (const office of [false, true]) for (const panEuropean of [false, true]) for (const regionGroup of [undefined, ...REGION_FONT_GROUP_KEYS]) {
    const list = windowsFonts({ windows11, office, panEuropean, regionGroup }), expectRegion = regionGroup ?? null, label = JSON.stringify({ windows11, office, panEuropean, regionGroup });
    const device = describeDevice(valueOf(saved(list)));
    assert.equal(device.fonts, 'windows', label); assert.deepEqual(device.fontGroups, { windows11, office, panEuropean }, label); assert.equal(device.fontRegion, expectRegion, label); assert.equal(device.fontNoise, false, label);
    const noisy = noisyFontList(list, 12345, regionFontRoots(regionGroup)), noisyDevice = describeDevice(valueOf(saved(noisy)));
    assert.equal(noisyDevice.fonts, 'windows', label); assert.equal(noisyDevice.fontRegion, expectRegion, label); assert.equal(noisyDevice.fontNoise, true, label); assert.equal(noisyDevice.fontHidden.length, list.length - noisy.length, label);
  }
  // The lock is part of the recognition: a Japanese list that lacks a family the noise never leaves out (a base-script family or a regional family) is no noisy Windows list,
  // while the same absence in a list without a claimed region is only noise.
  const japanese = windowsFonts({ windows11: true, regionGroup: 'regionJa' }), seen = list => describeDevice(valueOf(saved(list)));
  for (const gone of [['MS PGothic'], ['Meiryo', 'Meiryo UI']]) {
    const found = seen(japanese.filter(name => !gone.includes(name)));
    assert.equal(found.fonts, 'custom', gone.join()); assert.equal(found.fontNoise, null, gone.join()); assert.equal(found.fontRegion, null, gone.join());
  }
  const withoutPGothic = seen(windowsFonts({ windows11: true }).filter(name => name !== 'MS PGothic'));
  assert.equal(withoutPGothic.fonts, 'windows'); assert.equal(withoutPGothic.fontNoise, true); assert.deepEqual(withoutPGothic.fontHidden, ['MS PGothic']);
  assert.equal(describeDevice(() => undefined).fontRegion, null);
});
